"""Decision 1B on the App's KPI tile: a compared KPI reads its own dataset as the result table stood when the previous run ended, with
the same expression and the same filters, through the one definition the dashboard and the Lakebase copy share; a first run, or a
filter the previous run cannot answer, gives no earlier value rather than a wrong one, offline."""
import copy
import json
import os
import sqlite3
import sys

import pytest

TESTS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(TESTS))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
for folder in (SERVER, TESTS):
    if folder not in sys.path:
        sys.path.insert(0, folder)

import shell_core  # noqa: E402
import shell_db  # noqa: E402
import shell_pg  # noqa: E402
import shell_sql  # noqa: E402
from v141_app_shell_test import PAGE, SETTINGS, FakeWorkspace, app_dir, call  # noqa: E402
from v145_lakebase_test import RECORD_COLUMNS, RECORDS_VIEW, ROW, backend, lakebase_shell  # noqa: E402

RESULT = "main.inspire.churn_out"
QUOTED = "`main`.`inspire`.`churn_out`"
COLUMNS = ["record_key", "valid_from", "valid_to", "is_current", "change_source", "changed_by", "run_id", "value", "category", "segment"]
RECORDS_SQL = (f"SELECT o.record_key, o.value, o.category, o.segment FROM {RESULT} AS o "
               f"WHERE o.is_current AND o.change_source <> 'delete'")
PREVIOUS_VIEW = "main.pricing_lb.n01_u05__records_previous"


def _page(**changes):
    page = copy.deepcopy(PAGE)
    page["result_table"] = RESULT
    page["datasets"] = [dict(d, sql=RECORDS_SQL) if d["name"] == "records" else d for d in page["datasets"]]
    page["filters"].append({"id": "segment", "type": "multi_select", "label": "Segment", "columns": {"records": "segment"}})
    page["kpis"].append({"id": "listed_value", "label": "Value on the list", "dataset": "records", "expression": "SUM(value)",
                         "format": "number", "good": "up", "compare": True})
    page.update(changes)
    return page


def _db(runs):
    db = sqlite3.connect(":memory:")
    db.create_function("IF", 3, lambda c, a, b: a if c else b)
    db.execute("CREATE TABLE churn_out (record_key TEXT, valid_from TEXT, valid_to TEXT, is_current INT, change_source TEXT, changed_by TEXT, "
               "run_id TEXT, value REAL, category TEXT, segment TEXT)")
    later = "11:00" if runs > 1 else None
    rows = [("a", "10:00", later, int(runs == 1), "run", "job", "r1", 1.0, "Books", None),
            ("b", "10:00", later, int(runs == 1), "run", "job", "r1", 2.0, "Music", None)]
    if runs > 1:
        rows += [("a", "11:00", None, 1, "run", "job", "r2", 1.0, "Books", "x"),
                 ("b", "11:00", None, 1, "run", "job", "r2", 5.0, "Music", "x"),
                 ("c", "11:05", "12:00", 0, "run", "job", "r2", 7.0, "Music", "x"),
                 ("c", "12:00", None, 1, "action", "pat", "r2", 7.0, "Music", "x")]
    db.executemany("INSERT INTO churn_out VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", rows)
    return db


def _local(sql):
    return sql.replace(QUOTED, "churn_out").replace(RESULT, "churn_out").replace(" AS STRING)", " AS TEXT)")


def _tile(runs, ident, values=None, page=None):
    page = page or _page()
    kpi = next(k for k in page["kpis"] if k["id"] == ident)
    sql, params = shell_sql.kpi_query(page, ident, values or {}, shell_sql.previous_rows(page, kpi["dataset"], COLUMNS))
    rows = _db(runs).execute(_local(sql), {p["name"]: p["value"] for p in params}).fetchall()
    return dict(rows)


def test_the_before_side_reads_the_kpi_s_dataset_as_the_result_table_stood_when_the_previous_run_ended():
    page = _page()
    previous = shell_sql.previous_rows(page, "records", COLUMNS)
    assert previous == shell_sql.runs_compare_sql(RECORDS_SQL, RESULT, COLUMNS, (1,))
    assert previous.endswith(RECORDS_SQL.replace(f"FROM {RESULT} AS o", f"FROM {shell_sql.RUNS_CTE} AS o").replace(
        " FROM", " , o.`_inspire_run` FROM", 1)), previous
    assert "TRUE AS `is_current`" in previous and "'latest'" not in previous and "`_inspire_nth` IN (2)" in previous
    sql, params = shell_sql.kpi_query(page, "items", {"category": ["Books"]}, previous)
    now, before = sql.split(" UNION ALL ")
    assert now == f"SELECT 'now' AS period, COUNT(*) AS value FROM ({RECORDS_SQL}) AS d WHERE CAST(`category` AS STRING) IN (:p0)"
    assert before == (f"SELECT 'before' AS period, CASE WHEN COUNT(*) = 0 THEN NULL ELSE COUNT(*) END AS value FROM ({previous}) AS d "
                      f"WHERE CAST(`category` AS STRING) IN (:p0) LIMIT {shell_sql.CAPS['kpi_rows']}"), \
        "the same expression and the same filters, over the previous run, in one statement capped at the KPI's rows"
    assert params == [{"name": "p0", "value": "Books", "type": "STRING"}]
    unfiltered, _params = shell_sql.kpi_query(page, "items", {}, previous)
    assert "'before' AS period" in unfiltered, "the comparison no longer waits for a date range"
    assert "BETWEEN" not in unfiltered and not hasattr(shell_sql, "previous_range")


def test_a_kpi_compares_its_latest_value_with_the_value_the_previous_run_ended_with():
    assert _tile(2, "items") == {"now": 3, "before": 2}
    assert _tile(2, "listed_value") == {"now": 13.0, "before": 3.0}, "a write after the latest run never moves the previous value"


def test_a_previous_run_that_differs_only_outside_the_filter_shows_no_change():
    assert _tile(2, "items", {"category": ["Books"]}) == {"now": 1, "before": 1}
    assert _tile(2, "listed_value", {"category": ["Books"]}) == {"now": 1.0, "before": 1.0}
    assert _tile(2, "items", {"category": ["Music"]}) == {"now": 2, "before": 1}, "the filter reaches both sides, so a real change shows"


def test_a_first_run_has_no_earlier_value_and_never_a_fake_zero():
    assert _tile(1, "items") == {"now": 2, "before": None}
    assert _tile(1, "listed_value") == {"now": 3.0, "before": None}


def test_a_filter_on_a_column_the_previous_run_did_not_fill_gives_no_earlier_value_not_zero():
    assert _tile(2, "items", {"segment": ["x"]}) == {"now": 3, "before": None}
    assert _tile(2, "items", {"category": ["Home"]}) == {"now": 0, "before": None}, "no previous row in the filter is no earlier value"


def test_only_a_compared_kpi_over_the_result_table_that_keeps_runs_gets_a_before_side():
    page = _page()
    previous = shell_sql.previous_rows(page, "records", COLUMNS)
    assert "'before'" not in shell_sql.kpi_query(dict(page, kpis=[dict(k, compare=False) for k in page["kpis"]]), "items", {}, previous)[0]
    assert "'before'" not in shell_sql.kpi_query(page, "items", {}, None)[0]
    assert shell_sql.previous_rows(page, "trend", COLUMNS) is None, "the trend dataset reads another table, which keeps no runs"
    assert shell_sql.previous_rows(dict(page, result_table=None), "records", COLUMNS) is None
    assert shell_sql.previous_rows(page, "records", None) is None
    assert shell_sql.previous_rows(page, "records", []) is None, "no columns read, no previous run"


@pytest.mark.parametrize("sql,reads", [
    (f"SELECT * FROM {RESULT}", True),
    (f"SELECT * FROM {QUOTED} t", True),
    ("SELECT * FROM `MAIN`.Inspire.`CHURN_OUT` AS t", True),
    (f"SELECT * FROM main.s.orders o\n  LEFT JOIN\n{RESULT} r ON r.id = o.id", True),
    (f"SELECT * FROM {RESULT}_summary", False),
    (f"SELECT * FROM main.s.orders WHERE note = '{RESULT}'", False),
    (f"SELECT * FROM main.s.orders WHERE note = 'from {RESULT}'", False),
    (f"SELECT * FROM main.s.orders -- FROM {RESULT}\n", False),
    (f"SELECT * FROM main.s.orders /* JOIN {RESULT} */", False),
    (f"SELECT * FROM main.inspire.churn_out_v2", False),
])
def test_a_dataset_reads_the_result_table_only_through_a_from_or_join_never_through_a_text_or_a_comment(sql, reads):
    assert shell_sql.reads_table(sql, RESULT) is reads
    assert (not shell_sql.runs_problem(sql, RESULT).startswith("it does not read the result table")) is reads


def test_the_swap_keeps_an_alias_and_names_a_bare_read_after_its_table():
    def body(sql):
        return shell_sql.runs_compare_sql(sql, RESULT, COLUMNS).split("\n)\n", 1)[1]
    runs = shell_sql.RUNS_CTE
    assert body(f"SELECT o.x FROM {QUOTED} o JOIN main.s.orders AS s ON s.id = o.id") == (
        f"SELECT o.x , o.`_inspire_run` FROM {runs} o JOIN main.s.orders AS s ON s.id = o.id")
    assert body(f"SELECT COUNT(*) FROM {RESULT} WHERE is_current") == (
        f"SELECT COUNT(*) , `churn_out`.`_inspire_run` FROM {runs} AS `churn_out` WHERE is_current GROUP BY `churn_out`.`_inspire_run` ")
    text = f"SELECT '{RESULT}' AS t FROM {RESULT} AS r"
    assert body(text) == f"SELECT '{RESULT}' AS t , r.`_inspire_run` FROM {runs} AS r"


def test_the_page_spec_refuses_a_compared_kpi_whose_dataset_does_not_read_the_result_table():
    page = _page()
    assert shell_sql.spec_problems(page) == []
    over_trend = _page(kpis=[dict(k, compare=True) if k["id"] == "total_loss" else k for k in page["kpis"]])
    assert shell_sql.spec_problems(over_trend) == [
        f"KPI total_loss compares with the previous run, but its dataset trend does not read the result table {RESULT}, the one table "
        "that keeps earlier runs; set compare only on a KPI over that table"]
    named_only = _page(datasets=[dict(d, sql=f"SELECT 1 AS n, '{RESULT}' AS t") if d["name"] == "records" else d
                                 for d in page["datasets"]])
    assert any("KPI items compares with the previous run" in p for p in shell_sql.spec_problems(named_only)), \
        "a dataset that only names the table in a text does not read it"
    assert shell_sql.spec_problems(dict(over_trend, result_table=None)) == [], "Inspire sets the result table, so a draft is not judged"
    assert not any("period before" in p for p in shell_sql.spec_problems(over_trend))


class SchemaWorkspace(FakeWorkspace):
    def __init__(self, columns=COLUMNS, fail=None):
        super().__init__()
        self.columns, self.fail = columns, fail

    def run_sql(self, warehouse, sql, params, limit=5000):
        if sql == f"SELECT * FROM {QUOTED} LIMIT 0":
            self.sql.append((sql, params, limit))
            if self.fail:
                raise shell_db.QueryError(self.fail)
            return {"columns": [{"name": c, "type": "STRING"} for c in self.columns], "rows": [], "truncated": False}
        return super().run_sql(warehouse, sql, params, limit)


def _shell(tmp_path, ws):
    s = shell_core.Shell(app_dir(tmp_path, SETTINGS, [_page()]), env={"DATABRICKS_WAREHOUSE_ID": "wh1", "DATABRICKS_HOST": "dbc-1.example.com"},
                         sp_factory=lambda: ws, user_factory=lambda host, token: ws)
    return s


def test_the_app_compares_each_compared_kpi_with_the_previous_run_and_leaves_the_others_alone(tmp_path):
    ws = SchemaWorkspace()
    status, data = call(_shell(tmp_path, ws), "POST", "page", body={"page": "n01_u05", "filters": {"category": ["Books"]}})
    assert status == 200 and data["errors"] == {}
    assert data["kpis"]["items"] == {"now": 120.0, "before": 100.0} and data["kpis"]["listed_value"] == {"now": 120.0, "before": 100.0}
    assert {k: v for k, v in data["kpis"]["total_loss"].items() if k != "left_out"} == {"now": 120.0, "before": None}, "a KPI without compare has no earlier value"
    kpis = {sql for sql, _p, _l in ws.sql if "'now' AS period" in sql}
    previous = shell_sql.previous_rows(_page(), "records", COLUMNS)
    assert sum(previous in sql for sql in kpis) == 2 and all("BETWEEN" not in sql for sql in kpis)
    assert [sql for sql, _p, _l in ws.sql].count(f"SELECT * FROM {QUOTED} LIMIT 0") == 1, "the result table's columns are read once"


def test_a_result_table_that_cannot_be_read_never_shows_a_made_up_change(tmp_path):
    ws = SchemaWorkspace(fail="PERMISSION_DENIED on churn_out")
    status, data = call(_shell(tmp_path, ws), "POST", "page", body={"page": "n01_u05"})
    assert status == 200 and data["errors"]["kpi:items"] == "PERMISSION_DENIED on churn_out" and "items" not in data["kpis"]
    assert {k: v for k, v in data["kpis"]["total_loss"].items() if k != "left_out"} == {"now": 120.0, "before": None}, "only the compared tiles depend on the result table"


def _previous_backend():
    out = backend(True)
    out["tables"][PREVIOUS_VIEW] = {"pg": "n01_u05_app.n01_u05__p_records", "columns": RECORD_COLUMNS + [ROW]}
    out["previous"] = {"n01_u05": {"records": PREVIOUS_VIEW}}
    return out


def test_a_lakebase_app_reads_the_previous_run_from_its_own_lakebase_copy_and_never_the_warehouse(tmp_path):
    s, ws, lb = lakebase_shell(tmp_path, settings=dict(SETTINGS, backend=_previous_backend()), strict=True)
    status, data = call(s, "POST", "page", body={"page": "n01_u05", "filters": {"category": ["Books"]}})
    assert status == 200 and data["errors"] == {} and data["served"] == ["lakebase"] and ws.sql == []
    assert data["kpis"]["items"] == {"now": 120.0, "before": 100.0}
    compared = [text for text in lb.rendered if "'before'" in text]
    assert len(compared) == 1 and '"n01_u05_app"."n01_u05__p_records"' in compared[0] and '"n01_u05_app"."n01_u05__records"' in compared[0]
    assert shell_pg.previous_sql(s.by_id["n01_u05"], s.backend, "trend") is None
    (tmp_path / "plain").mkdir()
    s, ws, lb = lakebase_shell(tmp_path / "plain", strict=True)
    status, data = call(s, "POST", "page", body={"page": "n01_u05"})
    assert status == 200 and data["kpis"]["items"]["before"] is None and ws.sql == [], "no previous copy, no earlier value"


def test_the_lakebase_backend_checks_each_previous_copy_and_a_write_never_holds_it():
    assert shell_pg.backend_problems(_previous_backend(), "sp", [PAGE]) == []
    bad = _previous_backend()
    bad["previous"] = {"n01_u05": {"records": "main.pricing_lb.not_synced", "missing": PREVIOUS_VIEW}, "other_page": {}}
    assert shell_pg.backend_problems(bad, "sp", [PAGE]) == [
        "page n01_u05 the previous run of dataset records reads main.pricing_lb.not_synced, which the Lakebase backend does not hold",
        "the Lakebase backend names the previous run of dataset missing of page n01_u05, which the page does not have",
        "the Lakebase backend names previous runs of datasets of page other_page, which the App does not have"]
    assert any("previous must be an object" in p for p in shell_pg.backend_problems(dict(_previous_backend(), previous=[]), "sp", [PAGE]))
    assert shell_pg.backend_problems(backend(True), "sp", [PAGE]) == [], "a page with no compared dataset needs no previous copy"
    held = _previous_backend()
    assert shell_pg.uc_key(PREVIOUS_VIEW) in shell_pg.page_tables(PAGE, held), "the App may read the previous copy and is granted it"
    assert shell_pg.uc_key(PREVIOUS_VIEW) not in shell_pg.page_tables(PAGE, held, {shell_pg.uc_key(RECORDS_VIEW)}), \
        "a write after the previous run ended never changes what it left"


CHANGES_VIEW = "main.inspire_lb.n01_u05__lb_changes"


def test_the_grant_covers_the_changes_copy_the_fallback_reads_so_a_write_never_fails_the_list():
    page = dict(PAGE, result_table=RESULT)
    held = dict(backend(True), changes={shell_pg.uc_key(RESULT): CHANGES_VIEW})
    granted = shell_pg.page_tables(page, held)
    assert shell_pg.uc_key(CHANGES_VIEW) in granted, \
        "the App's SQL names the changes copy when Lakebase cannot serve a query and falls back to Delta; without a grant that read fails"
    assert shell_pg.uc_key(CHANGES_VIEW) not in shell_pg.page_tables(page, backend(True)), "a page with no changes copy is granted none"


def _notebook_page(ns, **changes):
    from v140_implement_test import _churn_page
    return ns["implement_app_page"](_churn_page(ns, **changes), "N01-U01", {}, RESULT)


def test_the_lakebase_build_copies_each_compared_dataset_as_the_previous_run_left_it(agent_ns):
    page = _notebook_page(agent_ns)
    compared = {k["dataset"] for k in page["kpis"] if k.get("compare")}
    assert compared == {"records"}
    copies = agent_ns["implement_lakebase_copies"]([page], "_inspire_row", shell_sql, {RESULT: COLUMNS})
    previous = [c for c in copies if c.get("previous")]
    assert [(c["key"], c["dataset"]) for c in previous] == [(f"{RESULT}__lbp_records", "records")]
    assert previous[0]["body"] == shell_sql.previous_rows(page, "records", COLUMNS)
    assert previous[0]["sql"].startswith(f"CREATE OR REPLACE VIEW {QUOTED[:-1]}__lbp_records` AS SELECT d.*")
    assert agent_ns["implement_lakebase_pg_table"](previous[0], []).startswith("n01_u01__p_records_")
    assert not [c for c in agent_ns["implement_lakebase_copies"]([page], "_inspire_row", shell_sql, {}) if c.get("previous")], \
        "a result table whose columns Inspire could not read gets no previous copy"
    for c in copies:
        c.update(pg=f"s.{c['key'].split('.')[-1]}", columns=[])
    built = agent_ns["implement_lakebase_backend"]("pipe-1", copies)
    assert built["previous"] == {"n01_u01": {"records": f"{RESULT}__lbp_records"}}
    assert f"{RESULT}__lbp_records" not in built["datasets"]["n01_u01"].values()
    other = dict(page, id="n02_u01")
    kept = agent_ns["implement_app_kept_backend"](dict(built, previous=dict(built["previous"], n02_u01={"records": "x.y.z"})), [page], shell_pg)
    assert kept["previous"] == built["previous"] and f"{RESULT}__lbp_records" in kept["tables"]
    assert agent_ns["implement_app_kept_backend"](built, [other], shell_pg)["previous"] == {}


def test_the_dashboard_compares_through_the_same_definition_and_never_through_a_text_naming_the_table(agent_ns):
    from v142_dash_test import _page as dash_page
    page = dash_page(agent_ns)
    page = dict(page, kpis=[dict(k, compare=True) for k in page["kpis"]])
    schema = [(name, "string") for name in COLUMNS]
    history = agent_ns["implement_dashboard_history"](page, shell_sql, RESULT, schema)
    records = next(i for i, k in enumerate(page["kpis"]) if k["dataset"] == shell_sql.RECORDS_DATASET)
    sql = agent_ns["implement_dashboard_dataset_sql"](page, page["kpis"][records]["dataset"], shell_sql)
    assert history["datasets"][history["compared"][records]] == shell_sql.runs_compare_sql(sql, RESULT, COLUMNS)
    assert history["datasets"][history["compared"][records]].count("main.s.orders") == sql.count("main.s.orders") == 1
    texted = dict(page, datasets=[dict(d, sql=f"SELECT o.* , '{RESULT}' AS t FROM main.s.orders AS o") if d["name"] == "trend" else d
                                  for d in page["datasets"]])
    trend = [i for i, k in enumerate(texted["kpis"]) if k["dataset"] == "trend"]
    assert trend and not set(trend) & set(agent_ns["implement_dashboard_history"](texted, shell_sql, RESULT, schema)["compared"])
    assert "implement_dataset_at_previous_run" not in agent_ns and "_IMPLEMENT_FROM_ALIAS_RE" not in agent_ns


def test_the_app_prompt_and_the_app_say_previous_run_with_one_no_earlier_text(agent_ns, tmp_path):
    shown = shell_sql.CHANGE_WORDS["story_none"]
    assert shown == "with no earlier run to compare"
    from v140_implement_test import _app_flow
    inst, context, seen = _app_flow(agent_ns, tmp_path)
    inst._implement_app(context, None)
    prompt = seen["prompt"]
    assert f"compare true shows the change since the previous run: the same expression and filters over `{context['result_table']}`" in prompt
    assert f"Set compare only on a KPI whose dataset reads `{context['result_table']}`" in prompt
    assert f"when there is no earlier run the App writes '{shown}'" in prompt
    assert "period before" not in prompt and "earlier period" not in prompt
    with open(os.path.join(ROOT, "agent", "app_shell", "example_page.json"), encoding="utf-8") as handle:
        example = json.load(handle)
    assert "period before" not in example["story"] and "{items:change} on the previous run" in example["story"]
    assert [k["id"] for k in example["kpis"] if k.get("compare")] == ["items"]
    assert shell_sql.spec_problems(dict(example, result_table="main.pricing.loss_desk_out")) == [], \
        "the example compares only a KPI over its result table"
