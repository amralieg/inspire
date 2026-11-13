"""REQ-147 zero-state panel: page_data flags zero_state only when every drawn chart is flat and its rule finds no exception
in the scope. The flag reuses rule_finds_nothing, so the page shows one 'none found' panel instead of flat charts. When the
rule still finds exceptions, or a chart is not flat, the flag stays off and the charts are drawn as before."""
import json
import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from v141_app_shell_test import PAGE, app_dir  # noqa: E402

import shell_core  # noqa: E402
from v141_app_shell_test import ShapedWorkspace  # noqa: E402


def _bar_page():
    # three category bars: the page schema needs 3 to 8 charts, and every one must be a flat category chart for the flag to fire
    chart = next(c for c in PAGE["charts"] if c["id"] == "by_category")
    return dict(PAGE, charts=[dict(chart, id=f"by_category_{i}") for i in range(3)])


def _shell(tmp_path, page, shape):
    ws = ShapedWorkspace(shape)
    s = shell_core.Shell(app_dir(tmp_path, pages=[page]), env={"DATABRICKS_WAREHOUSE_ID": "wh1"}, sp_factory=lambda: ws,
                         user_factory=lambda h, t: ws)
    return s, ws


def _chart_sql(sql):
    return "GROUP BY" in sql and "low_0 AS low" not in sql and "SUM(y0) OVER" not in sql


def _zeros(sql):
    if _chart_sql(sql):
        return [{"x": "Books", "y0": 0.0}, {"x": "Music", "y0": 0.0}, {"x": "Home", "y0": 0.0}]
    return None


def test_flat_chart_whose_rule_finds_nothing_sets_the_zero_state(tmp_path):
    page = _bar_page()
    s, _ws = _shell(tmp_path, page, _zeros)
    out = s.page_data({}, page["id"], {})
    assert out["zero_state"] is not None
    assert out["zero_state"]["charts"] == sorted(c["id"] for c in page["charts"])


def test_flat_chart_whose_rule_still_finds_exceptions_keeps_the_charts(tmp_path, monkeypatch):
    # page_data reads the unfiltered rule through the same cache as the drawn chart, so the exception is set by the rule check itself
    page = _bar_page()
    monkeypatch.setattr(shell_core.Shell, "rule_finds_nothing", lambda self, page, chart, ws, who=None, every_measure=False: False)
    s, _ws = _shell(tmp_path, page, _zeros)
    out = s.page_data({}, page["id"], {})
    assert out["zero_state"] is None
    assert set(out["charts"]) == {c["id"] for c in page["charts"]}


def test_a_chart_with_differing_groups_keeps_the_charts(tmp_path):
    page = _bar_page()

    def shape(sql):
        if _chart_sql(sql):
            return [{"x": "Books", "y0": 1.0}, {"x": "Music", "y0": 0.0}]
        return None

    s, _ws = _shell(tmp_path, page, shape)
    assert s.page_data({}, page["id"], {})["zero_state"] is None



# REQ-147 gap 1: the zero-result panel says how many rows the run checked. The count is the one the run wrote with its summary
# (run_tables, the rows of the scope's table read at run time), carried on the zero state. A summary with no count gives None.
def _summary(run_tables, scope=None):
    segments = [{"scope": scope["scope"], "key": f"{scope['scope']}:1", "table": scope["table"]}] if scope else []
    return [{"run_id": "r1", "run_segments": json.dumps(segments), "run_tables": json.dumps(run_tables)}]


def _zero_page_with_summary(tmp_path, summary):
    base = _bar_page()
    # the page reads its result table through a scope, so the KPI that compares with the previous run is dropped here
    kpis = [{k: v for k, v in kpi.items() if k != "compare"} for kpi in base.get("kpis") or []]
    page = dict(base, run_scopes=True, result_table="main.inspire.churn_out", kpis=kpis)

    def shape(sql):
        if sql.endswith("LIMIT 2") and "_summary" in sql:
            return summary
        return _zeros(sql)

    s, _ws = _shell(tmp_path, page, shape)
    return s.page_data({}, page["id"], {})


def test_the_zero_state_carries_the_rows_the_run_checked_for_its_scope_table(tmp_path):
    table = "main.inspire.churn_out"
    out = _zero_page_with_summary(tmp_path, _summary([{"table": table, "rows": 3333, "rows_total": 3333}],
                                                     scope={"scope": "recent", "table": table}))
    assert out["zero_state"]["rows_checked"] == 3333


def test_the_rows_checked_is_the_scopes_table_not_another_table_of_the_run(tmp_path):
    table = "main.inspire.churn_out"
    out = _zero_page_with_summary(tmp_path, _summary([{"table": "main.inspire.other", "rows": 9, "rows_total": 9},
                                                      {"table": table, "rows": 3333, "rows_total": 9000}],
                                                     scope={"scope": "groups", "table": table}))
    assert out["zero_state"]["rows_checked"] == 3333


def test_a_run_with_one_table_and_no_scope_counts_that_table(tmp_path):
    out = _zero_page_with_summary(tmp_path, _summary([{"table": "main.inspire.churn_out", "rows": 3333, "rows_total": 3333}]))
    assert out["zero_state"]["rows_checked"] == 3333


@pytest.mark.parametrize("summary", [
    None,
    _summary([{"table": "main.inspire.churn_out", "rows_total": 3333}]),
    _summary([{"table": "main.inspire.churn_out", "rows": None, "rows_total": 3333}]),
    _summary([{"table": "main.inspire.other", "rows": 9}, {"table": "main.inspire.third", "rows": 4}]),
], ids=["no_summary", "no_count", "count_missing", "several_tables_no_scope"])
def test_a_missing_count_is_none_and_never_a_false_number(tmp_path, summary):
    out = _zero_page_with_summary(tmp_path, summary)
    assert out["zero_state"] is not None and out["zero_state"]["rows_checked"] is None
