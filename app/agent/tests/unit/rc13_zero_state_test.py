"""REQ-147 zero-state panel: page_data flags zero_state only when every drawn chart is flat and its rule finds no exception
in the scope. The flag reuses rule_finds_nothing, so the page shows one 'none found' panel instead of flat charts. When the
rule still finds exceptions, or a chart is not flat, the flag stays off and the charts are drawn as before."""
import os
import sys

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

