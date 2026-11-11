import json
import os

import psycopg
import pytest

from rc7p_per_user_lakebase_test import enforced_pg  # noqa: F401  (the real Postgres cluster the App role reads from)
from v140_implement_test import _churn_page
from v145_lakebase_test import shell_pg, shell_sql

CASES = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fixtures", "row_filter_cases.json")))
ROW = "_inspire_row"
RESULT = "main.inspire.churn_out"
MAP = "main.sec.user_region"
GROUP_MAP = "main.sec.map"


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_python_classifier_agrees_with_the_shared_cases(case):
    got = shell_pg.row_filter_mapping(case["body"], case["column"], case["parameter"])
    assert got == case["expect"]


def test_a_row_filter_on_a_key_the_result_carries_is_enforced_and_names_its_mapping():
    plan = shell_pg.enforce_plan([{"table": "main.sec.sales", "column": "region", "parameter": "region_key",
                                   "body": f"EXISTS (SELECT 1 FROM {MAP} m WHERE m.region = region_key AND m.user_email = current_user())"}],
                                 ["region", "value"], [])
    assert plan == {"enforced": True, "enforce": [{"column": "region", "map": MAP, "key": "region", "principal": "user_email"}],
                    "masked": [], "reason": ""}


def test_a_key_the_result_does_not_carry_falls_back_to_delta_with_the_reason_shown():
    plan = shell_pg.enforce_plan([{"table": "main.sec.sales", "column": "brand", "parameter": "brand_key",
                                   "body": f"EXISTS (SELECT 1 FROM {MAP} m WHERE m.brand = brand_key AND m.user_email = current_user())"}],
                                 ["region", "value"], [])
    assert plan["enforced"] is False and plan["enforce"] is None
    assert plan["reason"] == "the result table has no brand column to carry the row filter of main.sec.sales"


def test_a_masked_key_column_is_never_enforced_on_its_copy():
    masked = shell_pg.enforce_plan(_plan_filters(), ["region", "value"], ["region"])
    assert masked["enforced"] is False and "a column mask hides region" in masked["reason"]


def _owner(agent_ns):
    return next(v for v in agent_ns.values() if isinstance(v, type) and hasattr(v, "_implement_lakebase_filter"))


def _plan_filters():
    return [{"table": "main.sec.sales", "column": "region", "parameter": "region_key",
             "body": f"EXISTS (SELECT 1 FROM {MAP} m WHERE m.region = region_key AND m.user_email = current_user())"}]


def test_two_filtered_source_tables_are_each_anded_into_the_view_through_their_own_mapping():
    filters = _plan_filters() + [dict(_plan_filters()[0], table="main.sec.other", body=f"EXISTS (SELECT 1 FROM {GROUP_MAP} m WHERE m.region = region_key AND m.grp = current_user())")]
    plan = shell_pg.enforce_plan(filters, ["region"], [])
    assert plan["enforced"] is True
    assert [e["map"] for e in plan["enforce"]] == [MAP, GROUP_MAP]


def test_a_second_filter_whose_key_the_result_lacks_refuses_the_whole_result_table_with_its_reason():
    filters = _plan_filters() + [dict(_plan_filters()[0], table="main.sec.other", column="brand", parameter="brand_key",
                                      body=f"EXISTS (SELECT 1 FROM {GROUP_MAP} m WHERE m.brand = brand_key AND m.grp = current_user())")]
    plan = shell_pg.enforce_plan(filters, ["region"], [])
    assert plan["enforced"] is False and "no brand column to carry the row filter of main.sec.other" in plan["reason"]


def test_a_dataset_that_reads_a_masked_column_is_named_so_it_can_run_on_delta(agent_ns):
    copies = [{"key": "k1", "dataset": "trend", "page": "p", "enforced": True, "masked": ["ssn"],
               "body": "SELECT region, ssn FROM main.inspire.churn_out"},
              {"key": "k2", "dataset": "other", "page": "p", "enforced": True, "masked": ["ssn"],
               "body": "SELECT region, SUM(value) AS v FROM main.inspire.churn_out GROUP BY region"},
              {"key": "k3", "dataset": "", "page": "p", "enforced": True, "masked": ["ssn"], "body": "SELECT ssn FROM t"}]
    named = agent_ns["implement_lakebase_masked_datasets"](copies)
    assert [c["key"] for c in named] == ["k1"] and named[0]["reads_masked"] == ["ssn"]


def test_an_unreadable_row_filter_is_refused_not_guessed():
    plan = shell_pg.enforce_plan([{"table": "main.sec.sales", "unreadable": True}], ["region"], [])
    assert plan["enforced"] is False and plan["reason"] == "Inspire could not read the row filter of main.sec.sales"


def test_no_row_filter_anywhere_is_enforced_with_no_mapping():
    assert shell_pg.enforce_plan([], ["region"], ["ssn"]) == {"enforced": True, "enforce": None, "masked": ["ssn"], "reason": ""}


def _page(agent_ns):
    return agent_ns["implement_app_page"](_churn_page(agent_ns), "N01-U01", {}, RESULT)


def test_the_builder_copies_an_enforced_result_into_base_views_and_a_mapping_copy(agent_ns):
    page = _page(agent_ns)
    plans = {RESULT.lower(): shell_pg.enforce_plan(_plan_filters(), ["region", "value", ROW], ["ssn"])}
    plans[RESULT.lower()]["masked"] = ["ssn"]
    copies = agent_ns["implement_lakebase_copies"]([page], ROW, shell_sql, {})
    enforced = agent_ns["implement_lakebase_enforced"](copies, plans, ROW)
    mapping = [c for c in enforced if c.get("role") == "mapping"]
    data = [c for c in enforced if c.get("role") != "mapping"]
    assert data and all(c["enforced"] and c["masked"] == ["ssn"] and c["enforce"][0]["mapping"] == mapping[0]["key"] for c in data)
    assert len(mapping) == 1 and mapping[0]["body"] == f"SELECT * FROM `main`.`sec`.`user_region`"


def test_a_table_with_no_filter_is_copied_without_a_mapping(agent_ns):
    page = _page(agent_ns)
    plans = {RESULT.lower(): {"enforced": True, "enforce": None, "masked": [], "reason": ""}}
    copies = agent_ns["implement_lakebase_copies"]([page], ROW, shell_sql, {})
    enforced = agent_ns["implement_lakebase_enforced"](copies, plans, ROW)
    assert enforced and all(c["enforce"] is None and c.get("role") != "mapping" for c in enforced)


def test_a_result_table_the_plan_refuses_is_left_out_of_the_copy_entirely(agent_ns):
    page = _page(agent_ns)
    plans = {RESULT.lower(): {"enforced": False, "enforce": None, "masked": [], "reason": "x"}}
    copies = agent_ns["implement_lakebase_copies"]([page], ROW, shell_sql, {})
    assert agent_ns["implement_lakebase_enforced"](copies, plans, ROW) == []


def test_the_backend_lists_app_views_with_their_base_copies_and_never_the_mapping_or_the_base_schema_grant(agent_ns):
    page = _page(agent_ns)
    plans = {RESULT.lower(): shell_pg.enforce_plan(_plan_filters(), ["region", "value", ROW], [])}
    copies = agent_ns["implement_lakebase_enforced"](agent_ns["implement_lakebase_copies"]([page], ROW, shell_sql, {}), plans, ROW)
    for copy in copies:
        copy.update(columns=[{"name": "region", "type": "STRING", "type_text": "STRING"}], pg=f"churn_desk_base.{copy['page']}__t_x",
                    synced=f"c.churn_desk_base.{copy['page']}__t_x")
        copy["app_pg"] = f"churn_desk.{copy['page']}__t_x"
    backend = agent_ns["implement_lakebase_backend"]("pipe-1", copies)
    assert backend["enforced"] is True
    mapping_pg = next(c["pg"] for c in copies if c.get("role") == "mapping")
    for key, entry in backend["tables"].items():
        assert entry["pg"].startswith("churn_desk.") and entry["base"].startswith("churn_desk_base.")
        assert entry["enforce"] == [{"column": "region", "map": mapping_pg, "key": "region", "principal": "user_email"}]
    assert not any(e["pg"].startswith("churn_desk_base.") for e in backend["tables"].values())


def test_an_app_with_no_enforced_table_has_no_enforced_backend(agent_ns):
    page = _page(agent_ns)
    copies = agent_ns["implement_lakebase_copies"]([page], ROW, shell_sql, {})
    for copy in copies:
        copy.update(columns=[{"name": "region", "type": "STRING", "type_text": "STRING"}], pg=f"churn_desk.{copy['page']}__t_x")
    assert "enforced" not in agent_ns["implement_lakebase_backend"]("pipe-1", copies)


def test_the_view_drops_masked_columns_the_copy_would_otherwise_hold(agent_ns):
    sql = agent_ns["implement_lakebase_view_sql"](RESULT, "__lb", "SELECT * FROM main.inspire.churn_out", ROW, exclude=["ssn", "email"])
    assert sql.startswith("CREATE OR REPLACE VIEW `main`.`inspire`.`churn_out__lb` AS SELECT d.* EXCEPT (`ssn`, `email`), ")
    plain = agent_ns["implement_lakebase_view_sql"](RESULT, "__lb", "SELECT 1", ROW)
    assert "SELECT d.*, monotonically_increasing_id()" in plain and "EXCEPT" not in plain


def test_the_plan_notes_name_each_table_that_reads_delta_and_why(agent_ns):
    notes = agent_ns["implement_lakebase_plan_notes"]({
        "main.inspire.a": {"enforced": True, "enforce": None, "masked": [], "reason": ""},
        "main.inspire.b": {"enforced": False, "enforce": None, "masked": [], "reason": "the result table has no brand column"}})
    assert notes == ["App: main.inspire.b uses Standard pages, not Fast pages, because the result table has no brand column"]


def test_the_builder_reads_a_source_filter_and_its_function_as_unity_catalog_returns_them(agent_ns):
    responses = {
        "/api/2.1/unity-catalog/tables/main.sec.sales": {"row_filter": {"function_name": "main.sec.fn", "input_column_names": ["region"]}},
        "/api/2.1/unity-catalog/functions/main.sec.fn": {"routine_definition": "RETURN EXISTS (SELECT 1 FROM main.sec.user_region m "
                                                                                 "WHERE m.region = region_key AND m.user_email = current_user())",
                                                         "input_params": {"parameters": [{"name": "region_key"}]}},
        "/api/2.1/unity-catalog/tables/main.sec.plain": {"columns": []},
    }
    inst = _Inst(responses)
    found = _owner(agent_ns)._implement_lakebase_filter(inst, "main.sec.sales")
    assert found == {"table": "main.sec.sales", "column": "region", "parameter": "region_key",
                     "body": "RETURN EXISTS (SELECT 1 FROM main.sec.user_region m WHERE m.region = region_key AND m.user_email = current_user())"}
    assert _owner(agent_ns)._implement_lakebase_filter(inst, "main.sec.plain") is None
    assert _owner(agent_ns)._implement_lakebase_filter(inst, "main.sec.gone")["unreadable"] is True


class _Inst:
    def __init__(self, responses):
        self.responses = responses

    def _implement_lakebase_find(self, path):
        if path not in self.responses:
            raise RuntimeError("PERMISSION_DENIED: no SELECT on the table")
        return self.responses[path]


def test_the_enforced_view_sql_the_builder_emits_runs_on_postgres_and_keeps_each_viewer_to_their_rows(enforced_pg, agent_ns):
    entry = {"pg": "bapp.orders", "base": "bbase.orders",
             "enforce": [{"column": "region", "map": "bbase.user_region", "key": "region", "principal": "user_email"}]}
    with psycopg.connect(host=enforced_pg["host"], port=enforced_pg["port"], dbname="postgres", user="inspire", autocommit=True) as conn:
        conn.execute("CREATE SCHEMA IF NOT EXISTS bbase AUTHORIZATION inspire_owner")
        conn.execute("CREATE SCHEMA IF NOT EXISTS bapp AUTHORIZATION inspire_owner")
        conn.execute("SET ROLE inspire_owner")
        conn.execute("CREATE TABLE bbase.orders (region text, value bigint, ssn text)")
        conn.execute("INSERT INTO bbase.orders VALUES ('North', 1, 'a'), ('South', 2, 'b'), ('North', 3, 'c')")
        conn.execute("CREATE TABLE bbase.user_region (user_email text, region text)")
        conn.execute("INSERT INTO bbase.user_region VALUES ('ann@example.com', 'North')")
        conn.execute(shell_pg.enforcing_view_sql(entry))
        conn.execute("RESET ROLE")
        conn.execute("GRANT USAGE ON SCHEMA bapp TO app_sp")
        conn.execute("GRANT SELECT ON bapp.orders TO app_sp")
    try:
        with psycopg.connect(host=enforced_pg["host"], port=enforced_pg["port"], dbname="postgres", user="app_sp", autocommit=True) as conn:
            conn.execute("SELECT set_config('inspire.viewer', %s, true)", ("ann@example.com",))
            rows = conn.execute("SELECT value FROM bapp.orders ORDER BY value").fetchall()
            assert rows == []
        with psycopg.connect(host=enforced_pg["host"], port=enforced_pg["port"], dbname="postgres", user="app_sp", autocommit=False) as conn:
            conn.execute("SELECT set_config('inspire.viewer', %s, true)", ("ann@example.com",))
            assert conn.execute("SELECT value FROM bapp.orders ORDER BY value").fetchall() == [(1,), (3,)]
            conn.rollback()
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            with psycopg.connect(host=enforced_pg["host"], port=enforced_pg["port"], dbname="postgres", user="app_sp", autocommit=True) as conn:
                conn.execute("SELECT ssn FROM bbase.orders")
    finally:
        with psycopg.connect(host=enforced_pg["host"], port=enforced_pg["port"], dbname="postgres", user="inspire", autocommit=True) as conn:
            conn.execute("DROP SCHEMA IF EXISTS bapp CASCADE")
            conn.execute("DROP SCHEMA IF EXISTS bbase CASCADE")
