"""A money KPI over rows in several currencies is never one summed number: the App reads each currency's total, offline."""
import os
import sqlite3
import sys

import sqlglot

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_sql  # noqa: E402

ROWS = [
    {"value_at_stake": 100.0, "currency_code": "AED", "channel": "web"},
    {"value_at_stake": 25.0, "currency_code": "AED", "channel": "web"},
    {"value_at_stake": 50.0, "currency_code": "USD", "channel": "web"},
    {"value_at_stake": 10.0, "currency_code": "AED", "channel": "agent"},
]

PAGE = {
    "id": "n04_u05",
    "datasets": [{"name": "rows", "sql": "SELECT value_at_stake, currency_code, channel FROM stake_rows"}],
    "filters": [{"id": "currency", "label": "Currency", "type": "multi_select", "columns": {"rows": "currency_code"}},
                {"id": "channel", "label": "Sales channel", "type": "multi_select", "columns": {"rows": "channel"}}],
    "kpis": [
        {"id": "exposure", "label": "Revenue at stake", "dataset": "rows", "expression": "SUM(value_at_stake)",
         "format": "currency", "currency": "USD", "good": "down"},
        {"id": "results", "label": "Results", "dataset": "rows", "expression": "COUNT(*)", "format": "integer", "good": "down"},
    ],
}


def _run(sql):
    db = sqlite3.connect(":memory:")
    db.execute("CREATE TABLE stake_rows (value_at_stake REAL, currency_code TEXT, channel TEXT)")
    db.executemany("INSERT INTO stake_rows VALUES (?, ?, ?)", [(r["value_at_stake"], r["currency_code"], r["channel"]) for r in ROWS])
    cursor = db.execute(sqlglot.transpile(sql, read="databricks", write="sqlite")[0])
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
