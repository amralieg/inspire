import json
import os
import re
import sqlite3
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_core
import shell_db
import shell_pg
import shell_sql
from v141_app_shell_test import SETTINGS, call
from v142_edits_test import COLUMNS, TABLE, edit_page
from v144_app_data_test import ACTION_COLUMNS, DECIDE, EDITOR, LISTED, MODIFY, DataWorkspace, records, shell
from v148_app_hub_test import HISTORY_TYPES

PLAN = ("ai_next_action", "ai_expected_result", "ai_other_option", "ai_evidence", "value_at_stake_formula")
AI_FIELDS = [{"name": n, "type": "STRING", "type_text": "STRING"}
             for n in ("ai_explanation", "ai_confidence_reason", "ai_facts_hash", "ai_facts", "confidence_level", "ai_cat_driver",
                       "ai_cat_fix")]
PLAN_FIELDS = [{"name": n, "type": "STRING", "type_text": "STRING"} for n in PLAN]
EXPLAINED = COLUMNS + ACTION_COLUMNS + AI_FIELDS
PICK = "COALESCE(c.`_inspire_ai_cat_driver`, 'Not explained yet') IN (:p0, :p1)"
SUMMARY_SQL = (f"SELECT * FROM `main`.`pricing`.`loss_desk_out_summary` WHERE `use_case_id` = :p0 ORDER BY `updated_at` DESC "
               f"NULLS LAST LIMIT 1")
CONFIG = {"endpoint": "databricks-claude-sonnet-4", "categories": {
    "ai_cat_driver": {"meaning": "what moved the record", "values": ["Price", "Volume"]},
    "bad name": {"meaning": "never shown", "values": ["x", "y"]}}, "unexplained": "Not explained yet"}
RUN = {"use_case_id": "N01-U05", "run_id": "r-9", "as_of_date": "2026-10-15", "summary": "Discount loss fell 4% on the run before.",
       "ai_endpoint": "databricks-claude-sonnet-4", "ai_config": json.dumps(CONFIG), "act_now_records": 0, "review_records": 0,
       "records": 120, "value_at_stake": None, "currency": "USD", "decision_basis": "measured", "act_now_amount": 5000.0,
       "review_amount": 1000.0, "nothing_to_act": "No record has 1000 USD or more at stake; the largest is 640 USD.",
       "updated_at": "2026-10-15T08:00:00.000Z", "not_reliable": None, "act_now_capacity": None, "over_capacity_records": None,
       "impact_kind": "money", "impact_unit": "USD", **dict.fromkeys(("kpi_name", "kpi_source", "kpi_direction", "kpi_unit", "kpi_baseline",
                                                                      "kpi_baseline_on", "kpi_latest", "kpi_target", "kpi_target_text",
                                                                      "kpi_status", "kpi_reason", "kpi_measured_at"))}


class AiWorkspace(DataWorkspace):
    def __init__(self, counts=(), summary=None, summary_error=None, columns=None, **kw):
        super().__init__(columns=EXPLAINED if columns is None else columns, **kw)
        self.counts, self.summary, self.summary_error = list(counts), summary, summary_error

    def answer(self, sql, params):
        if " AS f, COALESCE(" in sql:
            if "ai" in self.fail:
                raise self.fail["ai"]
            return {"columns": [], "rows": self.counts, "truncated": False}
        if sql.startswith("SELECT * FROM `main`.`pricing`.`loss_desk_out_summary`"):
            if self.summary_error:
                raise self.summary_error
            return {"columns": [], "rows": [] if self.summary is None else [self.summary], "truncated": False}
        return super().answer(sql, params)


def test_ai_columns_are_read_only_and_never_listed_as_business_changes():
    fields = {f["name"]: f for f in shell_sql.change_fields(EXPLAINED)}
    for name in ("ai_explanation", "ai_confidence_reason", "ai_facts_hash", "ai_facts", "confidence_level", "ai_cat_driver", "ai_cat_fix"):
        assert (fields[name]["role"], fields[name]["editable"]) == ("ai", False), name
    assert (fields["entity_label"]["role"], fields["entity_label"]["editable"]) == ("business", True)
    near = {f["name"]: f["role"] for f in shell_sql.change_fields([{"name": n, "type": "STRING"} for n in (
        "ai_cat_", "ai_cat_Driver", "ai_cat_" + "x" * 41, "ai_category", "my_ai_explanation", "ai_next_actions", "value_at_stake")])}
    assert set(near.values()) == {"business"}, "only the agent's own AI names are read-only"


def test_the_next_action_evidence_and_formula_columns_are_read_only_ai_columns():
    fields = {f["name"]: f for f in shell_sql.change_fields(EXPLAINED + PLAN_FIELDS)}
    for name in PLAN:
        assert (fields[name]["role"], fields[name]["editable"]) == ("ai", False), name
    older = shell_sql.change_fields(EXPLAINED)
    assert not {f["name"] for f in older} & set(PLAN), "a table without the newer columns lists only what it has"


def test_the_edit_form_refuses_an_ai_column(tmp_path):
    s, ws, _made = shell(tmp_path, settings=MODIFY, ws=AiWorkspace())
    status, out = call(s, "POST", "records/edit", headers=EDITOR, body={"page": "n01_u05", "record_key": "k1", "valid_from_us": "101",
                                                                       "values": {"ai_explanation": "my own words", "confidence_level": "High"}})
    assert status == 400 and out["error"] == "ai_explanation, confidence_level cannot be changed in the App"
    assert not ws.queries("MERGE INTO")


def test_the_edit_form_refuses_the_next_action_and_formula_columns(tmp_path):
    s, ws, _made = shell(tmp_path, settings=MODIFY, ws=AiWorkspace(columns=EXPLAINED + PLAN_FIELDS))
    status, out = call(s, "POST", "records/edit", headers=EDITOR, body={"page": "n01_u05", "record_key": "k1", "valid_from_us": "101",
                                                                       "values": {"ai_next_action": "x", "value_at_stake_formula": "y"}})
    assert status == 400 and out["error"] == "ai_next_action, value_at_stake_formula cannot be changed in the App"
    assert not ws.queries("MERGE INTO")
    status, out = call(s, "GET", "records/fields", headers=EDITOR, query={"page": "n01_u05"})
    assert status == 200 and {f["name"]: (f["role"], f["editable"]) for f in out["fields"] if f["name"] in PLAN} == {
        n: ("ai", False) for n in PLAN}


def test_the_list_carries_the_reasoning_and_categories_of_each_record_s_current_version(tmp_path):
    counts = [{"f": "ai_cat_driver", "v": "Volume", "n": 3}, {"f": "ai_cat_driver", "v": "Price", "n": 3},
              {"f": "ai_cat_driver", "v": "Not explained yet", "n": 7}, {"f": "ai_cat_fix", "v": "Not explained yet", "n": 13}]
    s, ws, _made = shell(tmp_path, ws=AiWorkspace(counts=counts))
    status, out = records(s)
    assert status == 200 and not ws.queries(" AS f, COALESCE(") and out["ai"]["counted"] is False, \
        "no screen shows the counts, so a plain list read never scans every record to count them"
    assert out["ai"]["categories"] == [{"name": "ai_cat_driver", "options": []}, {"name": "ai_cat_fix", "options": []}]
    status, out = records(s, ai_counts=True)
    assert status == 200
    (sql, _params), = ws.queries(" OFFSET ")
    assert ("CAST(`ai_explanation` AS STRING) AS `_inspire_ai_explanation`, CAST(`confidence_level` AS STRING) AS "
            "`_inspire_confidence_level`, CAST(`ai_cat_driver` AS STRING) AS `_inspire_ai_cat_driver`, CAST(`ai_cat_fix` AS STRING) AS "
            "`_inspire_ai_cat_fix`, CAST(`not_listed_since` AS TIMESTAMP) AS `_inspire_missing` FROM `main`.`pricing`.`loss_desk_out` WHERE "
            "`is_current`") in sql
    assert "c.`_inspire_ai_explanation`, c.`_inspire_confidence_level`, c.`_inspire_ai_cat_driver`, c.`_inspire_ai_cat_fix`" in sql
    assert "ai_confidence_reason" not in sql and "ai_facts" not in sql, "the list reads only what each row shows"
    assert out["ai"] == {"columns": {"ai_explanation": "_inspire_ai_explanation", "confidence_level": "_inspire_confidence_level",
                                     "ai_cat_driver": "_inspire_ai_cat_driver", "ai_cat_fix": "_inspire_ai_cat_fix"},
                         "categories": [{"name": "ai_cat_driver", "options": [{"value": "Not explained yet", "n": 7},
                                                                              {"value": "Price", "n": 3}, {"value": "Volume", "n": 3}]},
                                        {"name": "ai_cat_fix", "options": [{"value": "Not explained yet", "n": 13}]}],
                         "picked": {}, "counted": True}
    assert records(s, ai_counts="yes") == (400, {"error": "mine, changed and ai_counts take true or false"})


def test_an_ai_filter_narrows_the_list_before_it_pages_and_never_reaches_the_counts(tmp_path):
    s, ws, _made = shell(tmp_path, ws=AiWorkspace())
    status, _out = records(s, search="tea", ai={"ai_cat_driver": ["Price", "Not explained yet", "Price"], "ai_cat_fix": []}, ai_counts=True)
    assert status == 200
    (sql, params), (total, total_params) = ws.queries(" OFFSET ")[-1], ws.queries("AS total FROM (SELECT 1 FROM f LIMIT")[-1]
    for text in (sql, total):
        assert f"FROM d LEFT JOIN c ON c.`_inspire_key` = d.`record_key` WHERE (" in text and f"AND {PICK.replace(':p0', ':p1').replace(':p1)', ':p2)')}" in text
    assert [p["value"] for p in params] == [p["value"] for p in total_params] == ["%tea%", "Price", "Not explained yet"]
    (counted, counted_params), = ws.queries(" AS f, COALESCE(")
    assert counted_params == [] and "tea" not in counted and ":p" not in counted, "counts show every value at the page's filters"
    assert ("SELECT 'ai_cat_driver' AS f, COALESCE(c.`_inspire_ai_cat_driver`, 'Not explained yet') AS v, COUNT(*) AS n FROM d LEFT JOIN "
            "c ON c.`_inspire_key` = d.`record_key` GROUP BY COALESCE(c.`_inspire_ai_cat_driver`, 'Not explained yet') UNION ALL SELECT "
            "'ai_cat_fix' AS f") in counted


@pytest.mark.parametrize("ai,message", [
    ({"ai_cat_mood": ["x"]}, "the decision list has no AI category 'ai_cat_mood'; its AI categories: ai_cat_driver, ai_cat_fix"),
    ({"ai_cat_driver": "Price"}, "ai_cat_driver takes a list of at most 200 values of 1 to 300 characters"),
    ({"ai_cat_driver": [""]}, "ai_cat_driver takes a list of at most 200 values of 1 to 300 characters"),
    ({"ai_cat_driver": ["x" * 301]}, "ai_cat_driver takes a list of at most 200 values of 1 to 300 characters"),
    ({"ai_cat_driver": [str(i) for i in range(201)]}, "ai_cat_driver takes a list of at most 200 values of 1 to 300 characters"),
    ({"ai_cat_driver": [7]}, "ai_cat_driver takes a list of at most 200 values of 1 to 300 characters"),
    (["ai_cat_driver"], "ai takes an object of AI categories, each with the values to show")])
def test_a_bad_ai_filter_is_refused_before_any_list_query(tmp_path, ai, message):
    s, ws, _made = shell(tmp_path, ws=AiWorkspace())
    assert records(s, ai=ai) == (400, {"error": message})
    assert not ws.queries(" OFFSET ")


def test_a_table_without_ai_columns_lists_as_before_and_offers_no_ai_filter(tmp_path):
    s, ws, _made = shell(tmp_path)
    status, out = records(s)
    assert status == 200 and out["ai"] == {"columns": {}, "categories": [], "picked": {}, "counted": False}
    assert not ws.queries(" AS f, COALESCE(") and "_inspire_ai" not in ws.queries(" OFFSET ")[0][0]
    assert records(s, ai={"ai_cat_driver": ["Price"]}) == (
        400, {"error": "the decision list has no AI category 'ai_cat_driver'; its AI categories: none"})


def test_a_failed_count_is_reported_without_failing_the_list_and_check_names_it(tmp_path):
    s, _ws, _made = shell(tmp_path, ws=AiWorkspace(fail={"ai": shell_db.QueryError("warehouse stopped")}))
    status, out = records(s, ai_counts=True)
    assert status == 200 and out["errors"] == {"ai": "warehouse stopped"} and out["ai"]["categories"][0]["options"] == []
    problems = s.check({})
    assert "page n01_u05: the AI category counts failed: warehouse stopped" in problems


def _sqlite_run(sql, params, tables):
    sqlglot = pytest.importorskip("sqlglot")
    tree = sqlglot.parse_one(sql, read="databricks")
    for table in tree.find_all(sqlglot.exp.Table):
        table.set("catalog", None)
        table.set("db", None)
    db = sqlite3.connect(":memory:")
    db.create_function("UNIX_MICROS", 1, lambda value: len(str(value)))
    for name, rows in tables.items():
        names = list(rows[0])
        db.execute(f'CREATE TABLE "{name}" ({", ".join(chr(34) + n + chr(34) for n in names)})')
        db.executemany(f'INSERT INTO "{name}" VALUES ({", ".join("?" for _ in names)})', [tuple(r[n] for n in names) for r in rows])
    cursor = db.execute(tree.sql(dialect="sqlite"), {p["name"]: p["value"] for p in params})
    return [dict(zip([c[0] for c in cursor.description], row)) for row in cursor.fetchall()]


def _version(key, driver, current=True, source="run", explanation=None):
    return {"record_key": key, "entity_id": key, "entity_label": f"Item {key}", "priority_tier": "Act now", "rank": int(key[1:]),
            "ai_explanation": explanation, "confidence_level": "High" if explanation else None, "ai_cat_driver": driver,
            "valid_from": f"2026-10-1{int(key[1:]) % 9}", "is_current": current, "change_source": source}


def test_the_ai_filter_and_counts_select_the_right_records_on_a_sql_engine():
    page = edit_page(datasets=[{"name": "records", "sql": f"SELECT * FROM {TABLE} WHERE is_current AND change_source <> 'delete'"}],
                     filters=[], kpis=[], charts=[], records=dict(edit_page()["records"], columns=[]))
    fields = shell_sql.change_fields([{"name": n, "type": HISTORY_TYPES.get(n, "STRING")} for n in (
        "record_key", "entity_id", "entity_label", "priority_tier", "rank", "ai_explanation", "confidence_level", "ai_cat_driver",
        "valid_from", "valid_to", "is_current", "change_source", "changed_by", "use_case_id", "run_id", "as_of_date", "edited_by_person",
        "not_listed_since")])
    context = shell_sql.list_context(page, {"record_key", "entity_id", "entity_label", "priority_tier", "rank"}, fields, False)
    rows = [_version("k1", "Price", explanation="Margin fell."), _version("k2", "Volume", explanation="Units fell."),
            _version("k3", None), _version("k4", "Price", current=False), _version("k4", None),
            _version("k5", "Price", source="delete"), _version("k6", "Price", explanation="Price cut.")]
    tables = {"loss_desk_out": [dict(r, valid_to=None, changed_by="run", use_case_id="N01-U05", run_id="r1", as_of_date="2026-10-15",
                                     edited_by_person=None, not_listed_since=None) for r in rows]}
    request = shell_sql.list_request(page, {"ai": {"ai_cat_driver": ["Price", "Not explained yet"]}}, context)
    plan = shell_sql.list_queries(page, {}, request, context)
    got = _sqlite_run(*plan["rows"], tables)
    assert [(r["record_key"], r["_inspire_ai_cat_driver"], r["_inspire_ai_explanation"]) for r in got] == [
        ("k1", "Price", "Margin fell."), ("k3", None, None), ("k4", None, None), ("k6", "Price", "Price cut.")], \
        "an old version or a deleted record never decides a row's category"
    assert _sqlite_run(*plan["total"], tables) == [{"total": 4}]
    counted = {(r["f"], r["v"]): r["n"] for r in _sqlite_run(*shell_sql.ai_counts_query(page, {}, context), tables)}
    assert counted == {("ai_cat_driver", "Price"): 2, ("ai_cat_driver", "Volume"): 1, ("ai_cat_driver", "Not explained yet"): 2}


def test_a_count_sorted_by_an_action_reads_only_the_list_yet_counts_every_row_the_list_shows_on_a_sql_engine():
    page = edit_page(datasets=[{"name": "records", "sql": f"SELECT * FROM {TABLE} WHERE is_current AND change_source <> 'delete'"}],
                     filters=[], kpis=[], charts=[], records=dict(edit_page()["records"], columns=[]))
    fields = shell_sql.change_fields([{"name": n, "type": HISTORY_TYPES.get(n, "STRING")} for n in (
        "record_key", "entity_id", "entity_label", "priority_tier", "rank", "run_id", "valid_from", "valid_to", "is_current", "change_source",
        "changed_by")] + ACTION_COLUMNS)
    listed = {"record_key", "entity_id", "entity_label", "priority_tier", "rank"}
    context = shell_sql.list_context(page, listed, fields, True)
    owned = lambda key, who, status, **kw: dict(_version(key, None, **kw), action_owner=who, action_status=status, valid_to=None,
                                                changed_by="run", run_id="r1")
    tables = {"loss_desk_out": [owned("k1", "pat", "Open"), owned("k2", "sam", "Done"), owned("k3", None, None),
                                owned("k4", "pat", "Open", current=False), owned("k4", "sam", "Open"), owned("k5", "pat", "Open", source="delete")]}
    plan = lambda ctx, body, who="": shell_sql.list_queries(page, {}, shell_sql.list_request(page, body, ctx), ctx, who)
    by_owner = {"sort": {"key": "action_owner", "dir": "asc"}}
    for body in (by_owner, {"sort": {"key": "action_status", "dir": "desc"}}):
        sorted_plan = plan(context, body)
        assert " c AS (" not in sorted_plan["total"][0] and "JOIN c ON" not in sorted_plan["total"][0], \
            "sorting by an action never needs the current actions to count the list"
        assert _sqlite_run(*sorted_plan["total"], tables) == [{"total": len(_sqlite_run(*sorted_plan["rows"], tables))}] == [{"total": 4}]
    mine = plan(context, dict(by_owner, mine=True), "pat")
    assert "JOIN c ON" in mine["total"][0], "the records a person owns are counted from the current actions"
    assert _sqlite_run(*mine["total"], tables) == [{"total": len(_sqlite_run(*mine["rows"], tables))}] == [{"total": 1}], \
        "k4 belonged to pat in an older version only"
    keyed = shell_sql.list_context(page, listed - {"record_key"}, fields, True)
    assert keyed["join"] == "entity_id" and "JOIN c ON" in plan(keyed, by_owner)["total"][0], \
        "a list joined by another key may hold more than one current row per key, so its count keeps the join"


def test_every_new_statement_parses_as_databricks_sql_and_renders_for_lakebase():
    sqlglot = pytest.importorskip("sqlglot")
    page = edit_page()
    context = shell_sql.list_context(page, {"record_key", "entity_id"}, shell_sql.change_fields(EXPLAINED), True)
    request = shell_sql.list_request(page, {"ai": {"ai_cat_driver": ["Price"]}, "mine": True, "changed": True}, context)
    plan = shell_sql.list_queries(page, {"category": ["Books"]}, request, context, "pat")
    statements = [plan["rows"], plan["total"], shell_sql.ai_counts_query(page, {"category": ["Books"]}, context),
                  shell_sql.summary_query(page)]
    held = {TABLE: {"pg": "app.loss_desk_out", "columns": [{"name": c["name"]} for c in EXPLAINED]},
            "main.pricing.items": {"pg": "app.items", "columns": [{"name": "item_id"}, {"name": "category"}]}}
    for sql, params in statements:
        sqlglot.parse_one(re.sub(r":p\d+", "'x'", sql), read="databricks")
    for sql, params in statements[:3]:
        text, _values, read = shell_pg.render(sql, params, held)
        assert "COALESCE(" in text and TABLE in read
    with pytest.raises(shell_pg.NotServed, match="loss_desk_out_summary has no copy in Lakebase"):
        shell_pg.render(*statements[3], held)


def test_the_run_summary_reads_the_latest_row_for_the_use_case_with_its_ai_categories(tmp_path):
    s, ws, _made = shell(tmp_path, ws=AiWorkspace(summary=RUN))
    status, out = call(s, "GET", "summary", query={"page": "n01_u05"})
    assert status == 200 and out["note"] == ""
    assert out["run"] == dict({k: RUN[k] for k in shell_core.RUN_SUMMARY_FIELDS}, unit="USD")
    assert out["categories"] == {"ai_cat_driver": {"meaning": "what moved the record", "values": ["Price", "Volume"]}}
    (sql, params), = [(q, p) for q, p in ws.queries("loss_desk_out_summary") if "AS `stamp_us`" not in q]
    assert sql == SUMMARY_SQL and params == [{"name": "p0", "value": "N01-U05", "type": "STRING"}]


def test_the_run_summary_always_reads_delta(tmp_path):
    s, _ws, _made = shell(tmp_path, ws=AiWorkspace(summary=RUN))
    seen = []
    real = s.execute
    s.execute = lambda ws, sql, params, limit, delta=False: (seen.append(delta), real(ws, sql, params, limit, delta))[1]
    call(s, "GET", "summary", query={"page": "n01_u05"})
    assert seen == [True, True], "the summary and the early count of the changes since its run both read Delta"


@pytest.mark.parametrize("summary,error,expected", [
    (None, None, (200, {"run": None, "categories": {}, "note": "no run of this use case has written its summary yet"})),
    (None, shell_db.QueryError("[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`pricing`.`loss_desk_out_summary` cannot be found."),
     (200, {"run": None, "categories": {}, "note": "no run of this use case has written its summary yet"})),
    (None, shell_db.QueryError("PERMISSION_DENIED: User does not have SELECT"), (502, {"error": "PERMISSION_DENIED: User does not have SELECT"})),
    (dict(RUN, ai_config="{not json"), None, (200, {"run": dict({k: RUN[k] for k in shell_core.RUN_SUMMARY_FIELDS}, unit="USD"), "categories": {}, "note": ""})),
    (dict(RUN, ai_config=None), None, (200, {"run": dict({k: RUN[k] for k in shell_core.RUN_SUMMARY_FIELDS}, unit="USD"), "categories": {}, "note": ""})),
    (dict(RUN, ai_config=json.dumps({"categories": ["ai_cat_driver"]})), None,
     (200, {"run": dict({k: RUN[k] for k in shell_core.RUN_SUMMARY_FIELDS}, unit="USD"), "categories": {}, "note": ""})),
    (dict(RUN, ai_config=json.dumps({"categories": {"ai_cat_driver": {"meaning": "what moved", "values": "Price"}}})), None,
     (200, {"run": dict({k: RUN[k] for k in shell_core.RUN_SUMMARY_FIELDS}, unit="USD"),
            "categories": {"ai_cat_driver": {"meaning": "what moved", "values": []}}, "note": ""})),
    (dict(RUN, ai_config=json.dumps(["ai_cat_driver"])), None,
     (200, {"run": dict({k: RUN[k] for k in shell_core.RUN_SUMMARY_FIELDS}, unit="USD"), "categories": {}, "note": ""}))])
def test_a_missing_or_odd_summary_says_why_and_a_refused_read_is_an_error(tmp_path, summary, error, expected):
    s, _ws, _made = shell(tmp_path, ws=AiWorkspace(summary=summary, summary_error=error))
    assert call(s, "GET", "summary", query={"page": "n01_u05"}) == expected


def test_a_summary_older_than_the_outcome_columns_shows_what_it_has(tmp_path):
    old = {k: RUN[k] for k in ("use_case_id", "run_id", "as_of_date", "summary", "ai_endpoint", "ai_config", "updated_at")}
    s, _ws, _made = shell(tmp_path, ws=AiWorkspace(summary=old))
    status, out = call(s, "GET", "summary", query={"page": "n01_u05"})
    assert status == 200 and out["run"]["summary"] == RUN["summary"] and out["run"]["nothing_to_act"] is None
    assert out["run"]["act_now_records"] is None, "an old summary never claims a count it does not hold"


def test_a_page_without_a_result_table_has_no_run_summary_and_no_query_runs(tmp_path):
    bare = edit_page()
    bare.pop("result_table")
    s, ws, _made = shell(tmp_path, settings=SETTINGS, pages=[bare], ws=AiWorkspace(summary=RUN))
    assert call(s, "GET", "summary", query={"page": "n01_u05"}) == (
        200, {"run": None, "categories": {}, "note": "this page names no result table, so it has no run summary"})
    assert not ws.queries("loss_desk_out_summary")
    (tmp_path / "x").mkdir()
    s, ws, _made = shell(tmp_path / "x", settings=SETTINGS, pages=[edit_page(use_case_id="")], ws=AiWorkspace(summary=RUN))
    call(s, "GET", "summary", query={"page": "n01_u05"})
    (sql, params), = [(q, p) for q, p in ws.queries("loss_desk_out_summary") if "AS `stamp_us`" not in q]
    assert "WHERE" not in sql and params == []


def test_the_shell_names_the_agent_s_ai_and_summary_contract(agent_ns):
    written = set(agent_ns["INSPIRE_AI_NAMES"]) | {agent_ns["INSPIRE_AI_FACTS"], agent_ns["INSPIRE_CONFIDENCE"]}
    assert written <= set(shell_sql.AI_COLUMNS), "every AI column a run writes is read-only in the App"
    assert set(shell_sql.AI_COLUMNS) - written <= set(PLAN), "the App knows only the agreed newer AI columns beyond what runs write"
    assert shell_sql.AI_CATEGORY.pattern == agent_ns["INSPIRE_AI_CATEGORY_NAME"]
    assert shell_sql.AI_UNEXPLAINED == agent_ns["INSPIRE_AI_UNEXPLAINED"]
    assert shell_sql.SUMMARY_SUFFIX == agent_ns["INSPIRE_AI_SUMMARY_SUFFIX"]
    created = agent_ns["inspire_ai_summary_create_sql"]("main.pricing.loss_desk_out")
    written = set(re.findall(r"(?:\(|, )([a-z_]+) [A-Z]+", created))
    assert set(shell_core.RUN_SUMMARY_FIELDS) <= written, "the App reads only columns the runs write"
    assert set(agent_ns["INSPIRE_CONFIDENCE_LEVELS"]) == {"High", "Medium", "Low"}
