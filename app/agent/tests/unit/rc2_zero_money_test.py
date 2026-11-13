"""REQ-147 / REQ-141 zero-money publish: a money chart that is zero for every group because the rule finds no exception must
publish, even when the same chart also counts the records the rule tested (a non-money measure that is nonzero). The zero-state
panel is built only when every measure is zero, so 'none found' never sits over records that were tested. A wrong measure, one
whose money is nonzero in the unfiltered scope, still gets the design note. An empty scope (zero matches) publishes too."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from v141_app_shell_test import PAGE, app_dir  # noqa: E402

import shell_core  # noqa: E402
import shell_sql  # noqa: E402
from v141_app_shell_test import ShapedWorkspace  # noqa: E402

MONEY = {"label": "Money at stake", "expression": "SUM(value)", "format": "currency", "currency": "USD"}
RECORDS = {"label": "Records tested", "expression": "COUNT(*)", "format": "integer"}


def _page(money_rows, records_rows):
    """Three bar charts over the records dataset, each with a money measure and a records measure. money_rows and records_rows are
    the (y0, y1) values for the two groups of the unfiltered scope; the same rows come back for the default filters."""
    chart = next(c for c in PAGE["charts"] if c["id"] == "by_category")
    charts = [dict(chart, id=f"by_category_{i}", type="bar", y=[dict(MONEY), dict(RECORDS)]) for i in range(3)]
    return dict(PAGE, charts=charts), money_rows, records_rows


def _shape(page, unfiltered_money, records_rows, empty=False):
    """Chart queries return the group rows; the unfiltered rule query (no WHERE) returns unfiltered_money, the default-filter query
    returns zero money. Records counts are the same for both. empty=True returns no chart rows at all (zero matches)."""
    unfiltered = {shell_sql.chart_query(page, c["id"], {})[0] for c in page["charts"]}

    def shape(sql):
        if "GROUP BY" not in sql or "low_0 AS low" in sql or "SUM(y0) OVER" in sql:
            return None
        if empty:
            return []
        money = unfiltered_money if sql in unfiltered else 0.0
        return [{"x": "Books", "y0": money, "y1": records_rows[0]}, {"x": "Music", "y0": money, "y1": records_rows[1]}]

    return shape


def _shell(tmp_path, page, shape):
    ws = ShapedWorkspace(shape)
    s = shell_core.Shell(app_dir(tmp_path, pages=[page]), env={"DATABRICKS_WAREHOUSE_ID": "wh1"}, sp_factory=lambda: ws,
                         user_factory=lambda h, t: ws)
    return s, ws


def test_flat_money_with_tested_records_and_no_money_exception_publishes(tmp_path):
    # 569 records tested (the records measure is nonzero), money zero for every group, and the unfiltered rule has no money exception
    page, _m, records = _page(0.0, (3.0, 5.0))
    s, _ws = _shell(tmp_path, page, _shape(page, 0.0, records))
    problems = s.check({})
    assert [p for p in problems if "ranks nothing" in p] == [], problems


def test_flat_money_whose_unfiltered_rule_finds_money_stays_strict(tmp_path):
    # a wrong measure: money is zero at the default filters, but the rule has 7 units at stake in the scope
    page, _m, records = _page(0.0, (3.0, 5.0))
    s, _ws = _shell(tmp_path, page, _shape(page, 7.0, records))
    flat = [p for p in s.check({}) if "ranks nothing" in p]
    assert len(flat) == 3 and all("gives every group the same Money at stake (0)" in p for p in flat), flat


def test_records_tested_alone_do_not_build_the_zero_state(tmp_path):
    # money zero and records nonzero: the charts stay drawn, the 'none found' panel is not built over tested records
    page, _m, records = _page(0.0, (3.0, 5.0))
    s, _ws = _shell(tmp_path, page, _shape(page, 0.0, records))
    assert s.page_data({}, page["id"], {})["zero_state"] is None


def test_zero_matches_publish_the_zero_state_and_no_empty_tile_fails_the_app(tmp_path):
    # zero matches: every chart is empty, the whole scope is empty, so nothing ranks and no tile fails the App
    page, _m, records = _page(0.0, (0.0, 0.0))
    s, _ws = _shell(tmp_path, page, _shape(page, 0.0, records, empty=True))
    out = s.page_data({}, page["id"], {})
    assert out["zero_state"] is not None and out["zero_state"]["charts"] == sorted(c["id"] for c in page["charts"])
    empty = [p for p in s.check({}) if "returned no rows" in p]
    assert empty == [], empty


def test_empty_tile_with_rows_in_the_whole_scope_still_fails(tmp_path):
    # the filters, not the data, emptied the tile: the whole scope has rows, so the App still says so
    page, _m, records = _page(0.0, (3.0, 5.0))
    unfiltered = {shell_sql.chart_query(page, c["id"], {})[0] for c in page["charts"]}

    def shape(sql):
        if "GROUP BY" not in sql or "low_0 AS low" in sql or "SUM(y0) OVER" in sql:
            return None
        # the whole scope has rows; only the default filters (a dated window) hold none
        if sql in unfiltered:
            return [{"x": "Books", "y0": 0.0, "y1": 3.0}, {"x": "Music", "y0": 0.0, "y1": 5.0}]
        return []

    s, _ws = _shell(tmp_path, page, shape)
    empty = [p for p in s.check({}) if "returned no rows at the default filters" in p]
    assert len(empty) == 3, empty


def test_zero_matches_money_kpi_with_no_value_publishes(tmp_path):
    # a money KPI over an empty scope is NULL: the scope holds no rows at all, so the KPI shows no value and the App still publishes
    page, _m, records = _page(0.0, (0.0, 0.0))

    def shape(sql):
        if "'now' AS period" in sql:
            return [{"period": "now", "value": None}]
        if sql.startswith("SELECT 1 FROM ("):
            return []
        if "GROUP BY" in sql and "low_0 AS low" not in sql and "SUM(y0) OVER" not in sql:
            return []
        return None

    s, _ws = _shell(tmp_path, page, shape)
    problems = s.check({})
    assert [p for p in problems if "KPI total_loss has no value" in p] == [], problems


def test_zero_matches_filters_with_no_values_publish(tmp_path):
    # the filters read their values from the same empty scope, so they offer nothing to pick and the App still publishes
    page, _m, records = _page(0.0, (0.0, 0.0))

    def shape(sql):
        if sql.startswith("SELECT v FROM") or sql.startswith("SELECT 1 FROM ("):
            return []
        return None

    s, _ws = _shell(tmp_path, page, shape)
    problems = s.check({})
    assert [p for p in problems if "found no values to pick" in p or "found no dates" in p] == [], problems
