"""A money KPI over rows in several currencies is never one summed number: the App reads each currency's total, offline."""
import os
import datetime
import re
import sqlite3
import sys

import sqlglot

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_sql  # noqa: E402

CLOSED = "2025-01-01"
ROWS = [
    {"value_at_stake": 100.0, "currency_code": "AED", "channel": "web", "event_month": CLOSED},
    {"value_at_stake": 25.0, "currency_code": "AED", "channel": "web", "event_month": CLOSED},
    {"value_at_stake": 50.0, "currency_code": "USD", "channel": "web", "event_month": CLOSED},
    {"value_at_stake": 10.0, "currency_code": "AED", "channel": "agent", "event_month": CLOSED},
]

PAGE = {
    "id": "n04_u05",
    "datasets": [{"name": "rows", "sql": "SELECT value_at_stake, currency_code, channel, event_month FROM stake_rows"}],
    "filters": [{"id": "currency", "label": "Currency", "type": "multi_select", "columns": {"rows": "currency_code"}},
                {"id": "channel", "label": "Sales channel", "type": "multi_select", "columns": {"rows": "channel"}},
                {"id": "ticket_month", "label": "Ticket month", "type": "date_range", "grain": "month", "default": "12m",
                 "columns": {"rows": "event_month"}}],
    "charts": [
        {"id": "monthly", "dataset": "rows", "type": "line", "x": {"column": "event_month", "kind": "time"},
         "y": [{"expression": "SUM(value_at_stake)", "format": "currency", "currency": "USD"}]},
        {"id": "by_channel", "dataset": "rows", "type": "horizontal_bar", "x": {"column": "channel", "kind": "category"},
         "y": [{"expression": "SUM(value_at_stake)", "format": "currency", "currency": "USD"}]},
    ],
    "kpis": [
        {"id": "exposure", "label": "Revenue at stake", "dataset": "rows", "expression": "SUM(value_at_stake)",
         "format": "currency", "currency": "USD", "good": "down"},
        {"id": "results", "label": "Results", "dataset": "rows", "expression": "COUNT(*)", "format": "integer", "good": "down"},
    ],
}


def _run(sql):
    db = sqlite3.connect(":memory:")
    db.execute("CREATE TABLE stake_rows (value_at_stake REAL, currency_code TEXT, channel TEXT, event_month TEXT)")
    db.executemany("INSERT INTO stake_rows VALUES (?, ?, ?, ?)",
                   [(r["value_at_stake"], r["currency_code"], r["channel"], r["event_month"]) for r in ROWS])
    text = sqlglot.transpile(sql, read="databricks", write="sqlite")[0]
    text = re.sub(r"(TIMESTAMP_TRUNC|DATE_TRUNC)\(\s*(CURRENT_DATE\s*,\s*MONTH|'?MONTH'?\s*,\s*CURRENT_DATE)\s*\)",
                  "date('now', 'start of month')", text, flags=re.I)
    cursor = db.execute(text)
    names = [c[0] for c in cursor.description]
    return [dict(zip(names, row)) for row in cursor.fetchall()]


def test_a_money_kpi_over_several_currencies_is_split_per_currency_in_the_query():
    sql, _ = shell_sql.kpi_query(PAGE, "exposure", {})
    rows = _run(sql)
    assert {(r["currency"], r["value"]) for r in rows if r["period"] == "now"} == {("AED", 135.0), ("USD", 50.0)}


def test_mixed_currencies_never_come_back_as_one_total():
    rows = _run(shell_sql.kpi_query(PAGE, "exposure", {})[0])
    shown = shell_sql.kpi_values(rows)
    assert shown["now"] is None, "a total of AED and USD is not a number the App may show"
    assert shown["by_currency"] == [{"currency": "AED", "now": 135.0, "before": None}, {"currency": "USD", "now": 50.0, "before": None}]


def test_a_single_currency_money_kpi_keeps_one_number():
    rows = [{"period": "now", "currency": "USD", "value": 50.0}]
    assert shell_sql.kpi_values(rows) == {"now": 50.0, "before": None, "by_currency": [
        {"currency": "USD", "now": 50.0, "before": None}]}
    assert shell_sql.kpi_values([{"period": "now", "value": 7.0}]) == {"now": 7.0, "before": None}


def test_a_money_kpi_split_by_a_filter_adds_up_one_currency_per_group():
    sql, _ = shell_sql.kpi_split_query(PAGE, "exposure", "channel", {}, 50)
    got = {(r["x"], r["s"], r["y0"]) for r in _run(sql)}
    assert got == {("web", "AED", 125.0), ("web", "USD", 50.0), ("agent", "AED", 10.0)}


def test_a_count_kpi_is_not_split_and_keeps_its_one_number():
    sql, _ = shell_sql.kpi_query(PAGE, "results", {})
    assert "GROUP BY" not in sql
    assert _run(sql) == [{"period": "now", "value": 4}]
    assert shell_sql.kpi_values(_run(sql)) == {"now": 4, "before": None}


def test_a_money_kpi_on_a_dataset_without_a_currency_filter_keeps_one_number():
    page = dict(PAGE, filters=[])
    sql, _ = shell_sql.kpi_query(page, "exposure", {})
    assert "GROUP BY" not in sql


def test_genie_is_told_never_to_add_amounts_in_different_currencies(agent_ns):
    rule = agent_ns["genie_value_at_stake_rule"]("predicted")
    assert "Amounts in different currencies are never added together" in rule
    assert "no total is given across currencies unless every row shares one currency" in rule


def _with_rows(extra):
    global ROWS
    saved = list(ROWS)
    ROWS = saved + extra
    try:
        return _run
    finally:
        ROWS = saved


def test_a_row_without_a_date_is_left_out_of_every_money_total():
    rows = [{"value_at_stake": 1000.0, "currency_code": "AED", "channel": "web", "event_month": None}]
    saved = list(ROWS)
    ROWS[:] = saved + rows
    try:
        got = _run(shell_sql.kpi_query(PAGE, "exposure", {})[0])
    finally:
        ROWS[:] = saved
    assert {(r["currency"], r["value"]) for r in got} == {("AED", 135.0), ("USD", 50.0)}


def test_the_running_period_is_not_compared_as_a_full_month_and_future_rows_never_count():
    this_month = datetime.date.today().replace(day=1).isoformat()
    saved = list(ROWS)
    ROWS[:] = saved + [
        {"value_at_stake": 700.0, "currency_code": "AED", "channel": "web", "event_month": this_month},
        {"value_at_stake": 800.0, "currency_code": "AED", "channel": "web", "event_month": "2099-01-01"},
    ]
    try:
        got = _run(shell_sql.kpi_query(PAGE, "exposure", {})[0])
    finally:
        ROWS[:] = saved
    assert {(r["currency"], r["value"]) for r in got} == {("AED", 135.0), ("USD", 50.0)}


def test_a_money_line_chart_draws_one_series_per_currency():
    got = _run(shell_sql.chart_query(PAGE, "monthly", {})[0])
    assert {(r["x"], r["s"], r["y0"]) for r in got} == {(CLOSED, "AED", 135.0), (CLOSED, "USD", 50.0)}


def test_a_money_bar_chart_names_each_currency_in_its_bars_label():
    got = _run(shell_sql.chart_query(PAGE, "by_channel", {})[0])
    assert {(r["x"], r["y0"]) for r in got} == {("web · AED", 125.0), ("web · USD", 50.0), ("agent · AED", 10.0)}


def test_genie_answers_within_the_page_window_and_says_which_window_it_used(agent_ns):
    rule = agent_ns["genie_value_at_stake_rule"]("predicted")
    assert "Answer within the page's default window, the closed periods of the last 12 months" in rule
    assert "give all-time totals only when the question asks for them, saying so" in rule


def test_the_page_writer_is_told_money_never_adds_currencies_and_windows_skip_undated_rows():
    notebook = os.path.join(ROOT, "agent", "dbx_inspire_ai_agent.ipynb")
    with open(notebook, encoding="utf-8") as handle:
        text = handle.read()
    assert "a currency KPI or chart never adds amounts of different currencies" in text
    assert "so filter `<date> IS NOT NULL` inside the dataset first" in text


CONVERTED_PAGE = dict(PAGE, money={"currency": "convert", "base": "USD", "rates": {"AED": 0.5, "USD": 1.0}})


def test_a_saved_money_rule_is_validated_and_per_currency_is_the_default():
    assert shell_sql.money_rule_problems(None) == []
    assert shell_sql.money_rule_problems({"currency": "per_currency"}) == []
    assert shell_sql.money_rule_problems({"currency": "convert", "base": "USD", "rates": {"AED": 0.27}}) == []
    assert shell_sql.money_rule_problems({"currency": "convert", "base": "NOPE", "rates": {"AED": 0.27}})
    assert shell_sql.money_rule_problems({"currency": "convert", "base": "USD", "rates": {}})
    assert shell_sql.money_rule_problems({"currency": "convert", "base": "USD", "rates": {"AED": -1}})
    assert shell_sql.money_rule_problems({"currency": "convert", "base": "USD", "rates": {"AED": True}})
    assert shell_sql.money_rule_problems({"currency": "sum_everything"})


def test_a_converted_money_kpi_is_one_total_in_the_base_currency_at_the_typed_rates():
    rows = _run(shell_sql.kpi_query(CONVERTED_PAGE, "exposure", {})[0])
    shown = shell_sql.kpi_values(rows)
    assert "by_currency" not in shown, "a converted total is one number"
    assert shown["now"] == 117.5, "AED 135 at 0.5 plus USD 50 at 1"


def test_the_saved_rule_changes_the_totals_only_for_the_page_that_saved_it():
    assert "CASE" not in shell_sql.kpi_query(PAGE, "exposure", {})[0]
    assert "_inspire_converted" in shell_sql.kpi_query(CONVERTED_PAGE, "exposure", {})[0]


def test_the_left_out_line_counts_undated_rows_and_the_running_period_under_the_filters():
    this_month = datetime.date.today().replace(day=1).isoformat()
    saved = list(ROWS)
    ROWS[:] = saved + [
        {"value_at_stake": 1.0, "currency_code": "AED", "channel": "web", "event_month": None},
        {"value_at_stake": 2.0, "currency_code": "AED", "channel": "web", "event_month": this_month},
    ]
    try:
        sql, _ = shell_sql.money_left_out(PAGE, PAGE["kpis"][0], {})
        shown = shell_sql.left_out_text(_run(sql))
    finally:
        ROWS[:] = saved
    assert (shown["undated"], shown["running"]) == (1, 1)
    assert shown["text"] == "1 rows without a date and 1 rows from the running month were left out"


def test_a_page_without_a_period_filter_has_no_left_out_count():
    assert shell_sql.money_left_out(dict(PAGE, filters=[]), PAGE["kpis"][0], {}) is None
