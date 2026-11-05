import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import _inspire

TABLE = "main.inspire.demand_out"
SERIES = ["series_id", "period", "actual", "forecast", "lower", "upper", "is_future", "method", "backtest_mase"]


def _describe(columns):
    return [{"col_name": name, "data_type": "string"} for name in columns]


def _gates(agent_ns, tables, use_case):
    def respond(statement):
        for table, columns in tables.items():
            if statement == f"DESCRIBE TABLE {agent_ns['inspire_table_name'](table)}":
                return _describe(columns)
        if statement.startswith("DESCRIBE TABLE"):
            raise RuntimeError("[TABLE_OR_VIEW_NOT_FOUND] The table or view cannot be found")
        return []

    inst = _inspire(agent_ns, FakeSpark(responder=respond))
    inst._implement_ai_findings = lambda uc, case, outcome: {"problems": [], "fixable": False}
    inst._implement_run_stale_flags = lambda uc, case, outcome: {}
    inst._implement_run_shared_flag = lambda uc, case, outcome: {}
    inst._implement_run_untested = lambda uc, case, outcome: False
    return inst._implement_preview_gates("N01-U01", use_case, {"run_id": "r-1"}, None)


FORECAST = {"result_table": TABLE, "use_case_kind": "forecast"}


@pytest.mark.parametrize("tables, why", [
    ({}, "does not exist"),
    ({f"{TABLE}__series": ["series_id", "period", "actual", "forecast"]}, "has no column lower, upper, is_future, method, backtest_mase"),
])
def test_a_preview_that_misses_a_companion_table_its_page_draws_is_sent_back_to_genie_with_the_columns(agent_ns, tables, why):
    [gate] = _gates(agent_ns, tables, FORECAST)
    assert gate["kind"] == "notebook" and gate["fixable"] is True
    assert gate["problems"] == [f"run r-1 did not write the companion tables its page draws: {TABLE}__series {why}"]
    assert f"inspire_write_companion(frame, result_table, suffix, columns)" in gate["feedback"]
    assert f"{TABLE}__series: {', '.join(SERIES)}" in gate["feedback"]
    assert gate["event"].startswith("the preview run did not write the companion tables its page draws, sent back to Genie")


def test_a_written_companion_table_and_a_decision_queue_use_case_raise_no_companion_gate(agent_ns):
    assert _gates(agent_ns, {f"{TABLE}__series": SERIES + ["segment"]}, FORECAST) == []
    assert _gates(agent_ns, {}, {"result_table": TABLE, "use_case_kind": "risk_propensity"}) == []
    assert _gates(agent_ns, {}, {"use_case_kind": "forecast"}) == []


def test_the_companion_gate_names_only_the_tables_that_are_missing(agent_ns):
    use_case = {"result_table": TABLE, "use_case_kind": "peer_benchmarking"}
    tables = agent_ns["implement_kind_companion_tables"](use_case)
    assert sorted(tables) == [f"{TABLE}__bridge", f"{TABLE}__peers", f"{TABLE}__variance"]
    [gate] = _gates(agent_ns, {f"{TABLE}__variance": tables[f"{TABLE}__variance"]}, use_case)
    assert gate["problems"] == [f"run r-1 did not write the companion tables its page draws: {TABLE}__bridge does not exist; "
                                f"{TABLE}__peers does not exist"]
    assert f"{TABLE}__variance:" not in gate["feedback"]
