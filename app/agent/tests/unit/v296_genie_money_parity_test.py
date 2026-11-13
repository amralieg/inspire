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


RUN_TABLE = "main.ops.queue_out"
SQLITE_TABLE = "queue_out"
RUN_COLUMNS = ("record_key", "use_case_id", "is_current", "change_source", "priority_tier", "value_at_stake", "as_of_date")
RUN_USE_CASE = "N09-U05"
RUN_PAGE = {
    "datasets": [{"name": "queue", "sql": f"SELECT priority_tier, value_at_stake, as_of_date FROM {RUN_TABLE} AS t WHERE "
                                             f"t.use_case_id = '{RUN_USE_CASE}' AND t.is_current AND t.change_source <> 'delete'"}],
    "filters": [{"id": "as_of", "label": "As of", "type": "date_range", "grain": "month", "columns": {"queue": "as_of_date"}}],
    "kpis": [{"id": "stake", "label": KPI_LABEL, "dataset": "queue", "format": "currency",
              "expression": "SUM(CASE WHEN priority_tier IN ('Act now', 'Review') THEN value_at_stake END)"}],
}
# one fixture for the run total, the App's KPI and the Genie answer: flagged closed rows count; a Monitor row, an undated row, a
# future-dated row, another use case's row and a closed version are left out
RUN_ROWS = [
    ("a", RUN_USE_CASE, 1, "run", "Act now", 100.0, "2025-01-01"),
    ("b", RUN_USE_CASE, 1, "run", "Review", 25.0, "2025-01-01"),
    ("c", RUN_USE_CASE, 1, "run", "Monitor", 500.0, "2025-01-01"),
    ("d", RUN_USE_CASE, 1, "run", "Act now", 1000.0, None),
    ("e", RUN_USE_CASE, 1, "run", "Act now", 800.0, "2099-01-01"),
    ("f", "N09-U06", 1, "run", "Act now", 9999.0, "2025-01-01"),
    ("g", RUN_USE_CASE, 0, "run", "Act now", 7777.0, "2025-01-01"),
]


def _run_run(sql):
    """Databricks SQL over the run fixture: the three-part table name stands for the SQLite table."""
    text = sql.replace("`main`.`ops`.`queue_out`", SQLITE_TABLE).replace(RUN_TABLE, SQLITE_TABLE)
    return money._run(text, table=SQLITE_TABLE, columns=RUN_COLUMNS, rows=RUN_ROWS)


def test_the_run_total_equals_the_app_kpi_and_the_genie_total_on_the_same_rows(agent_ns):
    run = _run_run(agent_ns["inspire_run_total_sql"](RUN_TABLE, RUN_USE_CASE, list(RUN_COLUMNS), {"basis": "measured"}))[0]["value"]
    app = _run_run(shell_sql.kpi_query(RUN_PAGE, "stake", {})[0])[0]["value"]
    genie = _run_run(_genie_query(agent_ns, RUN_PAGE, KPI_LABEL))[0]["value"]
    assert run == app == genie == 125.0, "only the flagged, dated, closed-period rows: 100 Act now and 25 Review"


def test_a_run_without_a_date_column_has_no_run_total_rather_than_an_unruled_one(agent_ns):
    assert agent_ns["inspire_run_total_sql"](RUN_TABLE, RUN_USE_CASE, ["value_at_stake", "priority_tier"], {"basis": "measured"}) \
        == "SELECT CAST(NULL AS DOUBLE) AS value"


COUNT_ROWS = [
    ("a", RUN_USE_CASE, 1, "run", "Act now", 100.0, "2025-01-01"),
    ("b", RUN_USE_CASE, 1, "run", "Review", 25.0, "2025-01-01"),
    ("c", RUN_USE_CASE, 1, "run", "Monitor", 500.0, "2025-01-01"),
    ("d", RUN_USE_CASE, 1, "run", "Act now", 1000.0, None),
    ("e", RUN_USE_CASE, 1, "run", "Act now", 800.0, "2099-01-01"),
    ("f", "N09-U06", 1, "run", "Act now", 9999.0, "2025-01-01"),
    ("g", RUN_USE_CASE, 0, "run", "Act now", 7777.0, "2025-01-01"),
]
COUNT_PAGE = {
    "datasets": [{"name": "queue", "sql": f"SELECT priority_tier, value_at_stake, as_of_date FROM {RUN_TABLE} AS t WHERE "
                                             f"t.use_case_id = '{RUN_USE_CASE}' AND t.is_current AND t.change_source <> 'delete'"}],
    "filters": [{"id": "as_of", "label": "As of", "type": "date_range", "grain": "month", "columns": {"queue": "as_of_date"}}],
    "kpis": [{"id": "act_now", "label": "Act now", "dataset": "queue", "expression": "COUNT_IF(priority_tier = 'Act now')"},
             {"id": "review", "label": "Review", "dataset": "queue", "expression": "COUNT_IF(priority_tier = 'Review')"},
             {"id": "records", "label": "Records", "dataset": "queue", "expression": "COUNT(*)"}],
}


def _run_counts(agent_ns, rows):
    text = agent_ns["inspire_outcome_sql"](RUN_TABLE, RUN_USE_CASE, list(RUN_COLUMNS), None)
    return _run_counts_rows(text, rows)


def _run_counts_rows(sql, rows):
    text = sql.replace("`main`.`ops`.`queue_out`", SQLITE_TABLE).replace(RUN_TABLE, SQLITE_TABLE)
    return money._run(text, table=SQLITE_TABLE, columns=RUN_COLUMNS, rows=rows)[0]


def _app_counts(rows):
    out = {}
    for kpi in ("act_now", "review", "records"):
        text = shell_sql.kpi_query(COUNT_PAGE, kpi, {})[0].replace(RUN_TABLE, SQLITE_TABLE)
        out[kpi] = money._run(text, table=SQLITE_TABLE, columns=RUN_COLUMNS, rows=rows)[0]["value"]
    return out


def test_the_run_counts_equal_the_app_counts_on_one_fixture(agent_ns):
    run = _run_counts(agent_ns, COUNT_ROWS)
    app = _app_counts(COUNT_ROWS)
    assert (run["act_now_records"], run["review_records"], run["records"]) == (app["act_now"], app["review"], app["records"]) == (2, 1, 4), \
        "undated rows count on both sides, the dated row after today counts on neither, another use case's and a closed version's rows never count"


def test_nothing_to_act_follows_the_app_at_the_same_boundary(agent_ns):
    """A run whose only current row is dated after today has nothing to act on, as the App shows; the same row dated today flips it."""
    import datetime
    today = datetime.date.today().isoformat()
    future = [("e", RUN_USE_CASE, 1, "run", "Act now", 800.0, "2099-01-01")]
    boundary = [("e", RUN_USE_CASE, 1, "run", "Act now", 800.0, today)]
    reasons = {}
    for label, rows in (("future", future), ("boundary", boundary)):
        run = _run_counts(agent_ns, rows)
        app = _app_counts(rows)
        assert (run["act_now_records"], run["review_records"], run["records"]) == (app["act_now"], app["review"], app["records"])
        reasons[label] = agent_ns["inspire_nothing_to_act"](run, None, "")
        assert reasons[label] == agent_ns["inspire_nothing_to_act"](
            {"act_now_records": app["act_now"], "review_records": app["review"], "records": app["records"]}, None, "")
    assert reasons["future"] is not None and reasons["boundary"] is None
