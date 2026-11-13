"""A Genie answer to a money KPI reads the same rows as the App's KPI: a dated row in a closed period, with undated and future-dated
rows left out, and one total per currency. The Genie space carries the query the App runs, so the two totals match for the same page."""
import os
import re
import sys

import pytest

TESTS = os.path.dirname(os.path.abspath(__file__))
if TESTS not in sys.path:
    sys.path.insert(0, TESTS)

import money_currency_split_test as money  # noqa: E402
import shell_sql  # noqa: E402

KPI_LABEL = "Revenue at stake"
UNDATED_AND_FUTURE = [(1000.0, "AED", "web", None, None), (800.0, "AED", "web", "2099-01-01", None)]
ROWS = [(r["value_at_stake"], r["currency_code"], r["channel"], r["event_month"], r.get("fx_rate")) for r in money.ROWS]
END_OF_QUERY = re.compile(r"\n  (?:The page narrows|Split it)|\n- ")


def _app_totals(rows):
    shown = shell_sql.kpi_values(money._run(shell_sql.kpi_query(money.PAGE, "exposure", {})[0], rows=rows))
    return {row["currency"]: row["now"] for row in shown["by_currency"]}


def _genie_query(agent_ns, shell):
    block = agent_ns["implement_genie_kpi_block"]("N09-U05", money.PAGE, shell)
    head = f"- When asked for {KPI_LABEL}, use exactly: "
    start = block.index(head) + len(head)
    end = END_OF_QUERY.search(block, start)
    return block[start:end.start() if end else len(block)]


def _genie_totals(query, rows):
    return {row["currency_code"]: row["value"] for row in money._run(query, rows=rows)}


def test_the_genie_query_totals_match_the_app_kpi_on_rows_with_undated_and_future_dates(agent_ns):
    rows = ROWS + UNDATED_AND_FUTURE
    query = _genie_query(agent_ns, shell_sql)
    assert _genie_totals(query, rows) == _app_totals(rows) == {"AED": 135.0, "USD": 50.0}


def test_the_genie_query_keeps_one_total_per_currency(agent_ns):
    query = _genie_query(agent_ns, shell_sql)
    assert "GROUP BY" in query, "amounts in different currencies are never added together"


def test_a_money_kpi_without_the_app_shell_is_refused_rather_than_answered_from_raw_rows(agent_ns):
    with pytest.raises(RuntimeError, match="App shell"):
        agent_ns["implement_genie_kpi_block"]("N09-U05", money.PAGE)
