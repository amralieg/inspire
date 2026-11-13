"""One measure, one rule: the App's money KPI and the Genie answer to it read the same rows with the App's money rule (closed periods,
undated and future-dated rows left out, one total per currency). Count KPIs keep the App's future-date rule. The SQL checked here is the
SQL the product writes, run offline against one fixture."""
import os
import re
import sys

import pytest

TESTS = os.path.dirname(os.path.abspath(__file__))
if TESTS not in sys.path:
    sys.path.insert(0, TESTS)

import money_currency_split_test as money  # noqa: E402
import shell_sql  # noqa: E402
from v218_kpi_genie_parity_test import genie_block  # noqa: E402

KPI_LABEL = "Revenue at stake"
UNDATED_AND_FUTURE = [(1000.0, "AED", "web", None, None), (800.0, "AED", "web", "2099-01-01", None)]
ROWS = [(r["value_at_stake"], r["currency_code"], r["channel"], r["event_month"], r.get("fx_rate")) for r in money.ROWS]
END_OF_QUERY = re.compile(r"\n  (?:The page narrows|Split it)|\n- ")

def _app_totals(rows):
    shown = shell_sql.kpi_values(money._run(shell_sql.kpi_query(money.PAGE, "exposure", {})[0], rows=rows))
    return {row["currency"]: row["now"] for row in shown["by_currency"]}


def _genie_query(agent_ns, page, label):
    block = genie_block(agent_ns)("N09-U05", page)
    head = f"- When asked for {label}, use exactly: "
    start = block.index(head) + len(head)
    end = END_OF_QUERY.search(block, start)
    return block[start:end.start() if end else len(block)]


def _genie_totals(query, rows):
    return {row["currency_code"]: row["value"] for row in money._run(query, rows=rows)}


def test_the_genie_query_totals_match_the_app_kpi_on_rows_with_undated_and_future_dates(agent_ns):
    rows = ROWS + UNDATED_AND_FUTURE
    query = _genie_query(agent_ns, money.PAGE, KPI_LABEL)
    assert _genie_totals(query, rows) == _app_totals(rows) == {"AED": 135.0, "USD": 50.0}


def test_the_genie_query_keeps_one_total_per_currency(agent_ns):
    assert "GROUP BY" in _genie_query(agent_ns, money.PAGE, KPI_LABEL), "amounts in different currencies are never added together"


def test_a_count_kpi_keeps_undated_rows_and_leaves_out_future_dated_rows_as_the_app_does(agent_ns):
    rows = ROWS + UNDATED_AND_FUTURE
    app = money._run(shell_sql.kpi_query(money.PAGE, "results", {})[0], rows=rows)[0]["value"]
    genie = money._run(_genie_query(agent_ns, money.PAGE, "Results"), rows=rows)[0]["value"]
    assert app == genie == 5, "4 closed-period rows plus the undated one; the 2099 row is left out on both sides"


def test_a_genie_kpi_without_the_app_shell_is_refused_rather_than_answered_from_raw_rows(agent_ns):
    with pytest.raises(RuntimeError, match="App shell"):
        agent_ns["implement_genie_kpi_block"]("N09-U05", money.PAGE)
