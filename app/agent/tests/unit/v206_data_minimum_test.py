import os
import sys
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v120_artifacts_support import FakeSpark
from v120_genie_support import build_inspire
from v153_signal_check_test import SALES, Loader, Agent, answer, deep_inspire, uc

KEY = (5150, "N01-U01", 3)
FEW = {"n": 1000, "outcome_values": 2, "positives": 11, "sd0": 2.0, "p0": 5.0, "q0": 3.0}
MANY = {"n": 5000, "outcome_values": 2, "positives": 900, "sd0": 2.0, "p0": 5.0, "q0": 3.0}
FEW_TEXT = "History holds too few past examples of the outcome (11); at least 200 are needed to learn from."


def outcome_responder(row):
    def respond(statement):
        if "AS outcome_values" in statement:
            return [row]
        if statement.startswith("SELECT COUNT(*) AS n FROM"):
            return [{"n": row["n"]}]
        raise AssertionError(f"unexpected statement: {statement}")
    return respond


def churn(uc_id="N01-U01", **extra):
    return dict(uc(uc_id, "Classification"), **extra)


def roles_answer(uc_id="N01-U01"):
    return {"results": [answer(uc_id, {"outcome": "is_return", "signals": ["net_profit"]})]}


class UndatedLoader:
    def get_metadata_evidence(self, tables):
        return {t: {"columns": {"store_id": {"name": "store_id", "type": "bigint"},
                                "quantity": {"name": "quantity", "type": "int"}}, "foreign_keys": []} for t in tables}


def builder(agent_ns, mode, answers=(), responder=None, loader=None, **attrs):
    spark = FakeSpark(responder=responder or (lambda s: (_ for _ in ()).throw(AssertionError(s))))
    agent = Agent(list(answers))
    inst = build_inspire(agent_ns, loader=loader or Loader(), agent=agent, spark=spark, discovery_type=mode, **attrs)
    inst.logger = MagicMock()
    inst._implement_update = MagicMock()
    inst._build_schema_details_from_use_cases = lambda ucs: []
    return inst, agent, spark


def logged(inst, level):
    return [str(call.args[0]) for call in getattr(inst.logger, level).call_args_list]


def test_discover_drops_the_use_case_whose_outcome_history_is_below_the_minimum(agent_ns):
    ucs = [churn("N01-U01"), churn("N01-U02")]
    answers = [{"results": [answer("N01-U01", {"outcome": "is_return", "signals": ["net_profit"]}),
                            answer("N01-U02", {"outcome": "is_return", "signals": ["net_profit"]})]}]
    rows = iter([FEW, MANY])

    def respond(statement):
        if "AS outcome_values" in statement:
            return [next(rows)]
        return [{"n": 5000}]

    inst, _agent, _spark = deep_inspire(agent_ns, answers, respond)
    kept, dropped = inst._check_data_signal(ucs, [])
    assert [u["No"] for u in dropped] == ["N01-U01"] and [u["No"] for u in kept] == ["N01-U02"]
    assert dropped[0]["selection_drop_reason"] == f"the data shows no signal: {FEW_TEXT}"
    drops = [line for line in logged(inst, "info") if line.startswith("[SIGNAL-CHECK] dropped N01-U01")]
    assert len(drops) == 1 and "(11); at least 200" in drops[0]
    assert inst.signal_check_outcome["dropped"] == 1 and inst.signal_check_outcome["passed"] == 1
    assert "1 dropped" in [line for line in logged(inst, "info") if line.startswith("[SIGNAL-CHECK FIRED]")][0]


def test_discover_keeps_a_user_requested_use_case_below_the_minimum_with_its_shortfall(agent_ns):
    ucs = [churn("N01-U01", user_request="R1")]
    inst, _agent, _spark = deep_inspire(agent_ns, [roles_answer()], outcome_responder(FEW))
    inst._user_use_case_requests = lambda: {"R1": {"id": "R1", "ask": "a churn model", "minimum": 1}}
    kept, dropped = inst._check_data_signal(ucs, [])
    assert dropped == [] and kept == ucs
    record = ucs[0]["data_signal"]
    assert record["status"] == "no_signal" and record["data_reason"] == FEW_TEXT
    assert ucs[0]["Data Evidence"]["signal"]["status"] == "no_signal"


def test_build_refuses_a_user_kept_use_case_with_the_discover_shortfall_before_genie(agent_ns):
    discovered = churn(user_request="R1")
    inst, _agent, _spark = deep_inspire(agent_ns, [roles_answer()], outcome_responder(FEW))
    inst._user_use_case_requests = lambda: {"R1": {"id": "R1", "ask": "a churn model", "minimum": 1}}
    inst._check_data_signal([discovered], [])
    stored = {key: value for key, value in discovered.items() if key != "data_signal"}
    build, agent, spark = builder(agent_ns, "Deep")
    status = {}
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        build._implement_data_minimum(KEY, {}, stored, status)
    assert str(raised.value).startswith(agent_ns["IMPLEMENT_DATA_MINIMUM_LEAD"] + ": ")
    assert "(11); at least 200" in str(raised.value)
    assert status["data"]["state"] == "failed" and "(11); at least 200" in status["data"]["data_minimum"]
    build._implement_update.assert_called_once_with(KEY, asset_status=status)
    assert spark.statements == [] and agent.calls == [], "the stored shortfall is enough: nothing is read again"
    assert any(line.startswith("[DATA-MINIMUM FIRED] N01-U01: refused before Genie started") for line in logged(build, "warning"))


def test_build_keeps_going_for_a_use_case_that_met_its_minimum(agent_ns):
    discovered = churn()
    inst, _agent, _spark = deep_inspire(agent_ns, [roles_answer()], outcome_responder(MANY))
    inst._check_data_signal([discovered], [])
    assert discovered["data_signal"]["status"] == "passed"
    build, agent, spark = builder(agent_ns, "Deep")
    status = {}
    build._implement_data_minimum(KEY, {}, discovered, status)
    assert status == {} and spark.statements == [] and agent.calls == []
    assert any(line.startswith("[DATA-MINIMUM FIRED] N01-U01: passed before Genie started") for line in logged(build, "info"))


def test_build_measures_a_use_case_discover_could_not_check_and_refuses_it_when_short(agent_ns):
    unchecked = churn(data_signal={"status": "not_checked", "check": "outcome", "family": "A",
                                   "reason": "Data not checked: Standard discovery reads no data."})
    build, agent, spark = builder(agent_ns, "Deep", [roles_answer()], outcome_responder(FEW))
    status = {}
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        build._implement_data_minimum(KEY, {}, unchecked, status)
    assert FEW_TEXT in str(raised.value)
    assert agent.calls and agent.calls[0]["prompt"] == "SIGNAL_CHECK_PROMPT"
    assert any("AS outcome_values" in s for s in spark.statements)


def test_build_measures_an_older_catalog_use_case_that_carries_no_check(agent_ns):
    build, agent, spark = builder(agent_ns, "Deep", [roles_answer()], outcome_responder(MANY))
    status = {}
    build._implement_data_minimum(KEY, {}, churn(), status)
    assert status == {} and any("AS outcome_values" in s for s in spark.statements)


def test_build_never_reads_data_in_standard_and_says_the_check_did_not_run(agent_ns):
    unchecked = churn(data_signal={"status": "not_checked", "check": "outcome", "family": "A",
                                   "reason": "Data not checked: Standard discovery reads no data."})
    build, agent, spark = builder(agent_ns, "Standard")
    build._implement_data_minimum(KEY, {}, unchecked, {})
    assert spark.statements == [] and agent.calls == []
    assert any(line.startswith("[DATA-MINIMUM FIRED] N01-U01: not checked before Genie started")
               for line in logged(build, "info"))


def test_build_refuses_in_standard_when_the_column_types_alone_show_the_gap(agent_ns):
    forecast = dict(uc("N01-U01", "Forecasting"), **{"Tables Involved": "main.s.stock"})
    build, agent, spark = builder(agent_ns, "Standard", [{"results": [answer("N01-U01", {"time": "", "measure": "quantity"},
                                                                             table="main.s.stock")]}], loader=UndatedLoader())
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        build._implement_data_minimum(KEY, {}, forecast, {})
    assert "so there is no history to forecast" in str(raised.value) and spark.statements == []


def test_build_uses_the_minimum_the_user_set_in_the_wizard(agent_ns):
    discovered = churn()
    inst, _agent, _spark = deep_inspire(agent_ns, [roles_answer()], outcome_responder(FEW))
    inst._check_data_signal([discovered], [])
    assert discovered["selection_drop_reason"].endswith(FEW_TEXT)
    build, agent, spark = builder(agent_ns, "Deep")
    status = {}
    build._implement_data_minimum(KEY, {"config": {"widgets": {"min_positives": "10"}}}, discovered, status)
    assert status == {} and spark.statements == []
    with pytest.raises(agent_ns["ImplementBlocked"]):
        build._implement_data_minimum(KEY, {"config": {"widgets": {"min_positives": "12"}}}, discovered, {})


def test_build_checks_the_minimum_before_genie_on_every_notebook_build(agent_ns):
    inst, _agent, _spark = builder(agent_ns, "Deep")
    inst._implement_missing_tables = lambda tables: []
    inst._implement_role_problems = lambda spec, use_case: []
    order = []
    inst._implement_data_minimum = lambda key, spec, use_case, status: order.append((key, use_case["No"]))
    inst._implement_source_checks(KEY, {}, churn(), {})
    assert order == [(KEY, "N01-U01")]


def test_one_minimum_feeds_discover_build_and_the_genie_instruction(agent_ns):
    th = agent_ns["GENIE_READINESS_THRESHOLDS"]
    passed, text = agent_ns["deep_signal_verdict"]("A", {"row_count": 5000, "positives": th["A"]["min_positives"] - 1,
                                                          "class_rate": 0.1})
    assert passed is False and f"at least {th['A']['min_positives']}" in text
    rules = agent_ns["INSPIRE_READINESS_RULES"]
    assert any(rule[3] == "min_positives" for rule in rules["A"])


def lapse_answer(uc_id="N01-U01", days=7):
    return {"results": [{"No": uc_id, "table": TRIPS_LIKE, "roles": {"outcome": "", "entity_key": "customer_id",
                                                                     "time": "sold_at", "lapse_days": days},
                         "reason": "", "note": ""}]}


TRIPS_LIKE = "main.s.sales_transactions"


class LapseLoader:
    def get_metadata_evidence(self, tables):
        return {t: {"columns": {"customer_id": {"name": "customer_id", "type": "bigint"},
                                "sold_at": {"name": "sold_at", "type": "timestamp"},
                                "amount": {"name": "amount", "type": "double"}}, "foreign_keys": []} for t in tables}


def lapse_responder(row, seen):
    def respond(statement):
        seen.append(statement)
        if "AS positives" in statement and "AS windows" in statement:
            return [row]
        if statement.startswith("SELECT COUNT(*) AS n FROM"):
            return [{"n": row["n"]}]
        raise AssertionError(f"unexpected statement: {statement}")
    return respond


def lapse_inspire(agent_ns, row, days=7):
    seen = []
    inst, agent, spark = deep_inspire(agent_ns, [lapse_answer(days=days)], lapse_responder(row, seen))
    inst.data_loader = LapseLoader()
    return inst, seen


def lapse_uc():
    return dict(uc("N01-U01", "Classification"), **{"Tables Involved": TRIPS_LIKE,
                                                     "Name": "Call the customers most likely to stop buying this month"})


def test_discover_counts_a_derived_stop_outcome_and_drops_it_below_the_minimum(agent_ns):
    ucs = [lapse_uc()]
    inst, seen = lapse_inspire(agent_ns, {"n": 3333, "windows": 2, "cases": 420, "positives": 11})
    kept, dropped = inst._check_data_signal(ucs, [])
    assert kept == [] and [u["No"] for u in dropped] == ["N01-U01"]
    record = dropped[0]["data_signal"]
    assert record["status"] == "failed" and record["reason"] == FEW_TEXT
    assert record["measures"]["positives"] == 11 and record["measures"]["outcome_windows"] == 2
    sql = [s for s in seen if "AS positives" in s][0]
    assert "FLOOR(DATEDIFF(m.last, s.d) / 7)" in sql and "`customer_id` AS e" in sql and "`sold_at`" in sql


def test_discover_keeps_a_derived_stop_outcome_with_enough_history(agent_ns):
    ucs = [lapse_uc()]
    inst, _seen = lapse_inspire(agent_ns, {"n": 90000, "windows": 12, "cases": 24000, "positives": 2400}, days=30)
    kept, dropped = inst._check_data_signal(ucs, [])
    assert dropped == [] and kept[0]["data_signal"]["status"] == "passed"


def test_discover_drops_a_derived_stop_outcome_with_too_few_closed_windows(agent_ns):
    ucs = [lapse_uc()]
    inst, _seen = lapse_inspire(agent_ns, {"n": 90000, "windows": 1, "cases": 24000, "positives": 2400}, days=30)
    _kept, dropped = inst._check_data_signal(ucs, [])
    assert dropped and "too few closed outcome windows (1); at least 2" in dropped[0]["data_signal"]["reason"]


def test_a_derived_stop_outcome_is_sampled_whole_by_entity(agent_ns):
    sql, args = agent_ns["DeepEvidence"].signal_sql("outcome", "`t`", {"roles": {"entity_key": "customer_id", "time": "sold_at"},
                                                                       "outcome_kind": "lapse", "lapse_days": 30}, 5000)
    assert args is None and "pmod(xxhash64(`customer_id`), 1000000) < 5000" in sql
    measures = agent_ns["deep_signal_measures"]("outcome", {"n": 100, "windows": 3, "cases": 40, "positives": 4},
                                                {"roles": {}, "outcome_kind": "lapse"}, 0.5)
    assert measures == {"row_count": 200, "positives": 8, "outcome_windows": 3, "class_rate": 0.1}
