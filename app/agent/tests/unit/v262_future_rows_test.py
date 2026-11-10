"""Rows dated after today never feed a KPI or chart, and the left-out line counts them, as it counts the undated and running rows."""
import os
import sys

TESTS = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(os.path.dirname(os.path.dirname(TESTS)), "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_sql  # noqa: E402

PAGE = {"id": "n05_u01", "datasets": [{"name": "records", "sql": "SELECT as_of_date, value, region FROM main.s.out"}],
        "filters": [{"id": "run_date", "type": "date_range", "label": "Run date", "grain": "month", "columns": {"records": "as_of_date"}},
                    {"id": "region", "type": "multi_select", "label": "Region", "columns": {"records": "region"}}],
        "kpis": [{"id": "total", "label": "Total", "dataset": "records", "expression": "SUM(value)"}],
        "charts": [{"id": "trend", "dataset": "records", "type": "line", "x": {"column": "as_of_date", "kind": "time"},
                    "y": [{"expression": "SUM(value)"}]}]}


def test_a_kpi_reads_only_rows_not_dated_after_today():
    sql, _params = shell_sql.kpi_query(PAGE, "total", {})
    assert "WHERE `as_of_date` IS NULL OR `as_of_date` <= current_date" in sql


def test_a_chart_reads_only_rows_not_dated_after_today():
    sql, _params = shell_sql.chart_query(PAGE, "trend", {})
    assert "WHERE `as_of_date` IS NULL OR `as_of_date` <= current_date" in sql


def test_a_page_without_a_date_filter_is_read_as_before():
    bare = dict(PAGE, filters=[PAGE["filters"][1]])
    assert shell_sql.future_source(bare, "records", "SELECT 1") == "SELECT 1"


def test_the_left_out_line_counts_rows_dated_after_today_in_words():
    assert shell_sql.left_out_text([{"undated": 0, "running": 0, "future": 1}])["text"] == \
        "0 rows without a date and 0 rows from the running month were left out; 1 row dated after today is left out"
    assert shell_sql.left_out_text([{"future": 3}])["future"] == 3


def test_the_left_out_query_counts_future_rows_for_any_kpi_with_a_date():
    sql, _params = shell_sql.money_left_out(PAGE, PAGE["kpis"][0], {})
    assert "AS future" in sql and "`as_of_date` > current_date()" in sql


def test_a_KPI_with_no_money_rule_says_only_what_it_left_out():
    page = dict(PAGE, kpis=[dict(PAGE["kpis"][0], format="number")])
    line = shell_sql.kpi_left_out(page, page["kpis"][0], [{"undated": 4, "running": 2, "future": 3}])
    assert line == {"undated": 0, "running": 0, "unrated": 0, "future": 3, "text": "3 rows dated after today are left out"}
    assert shell_sql.kpi_left_out(page, page["kpis"][0], [{"future": 0}]) is None
