"""v1.4.0 use-case kinds: the data check each kind needs before it is kept.

1. A scenario needs at least two levers whose values move the outcome.
2. A measured impact needs a control group with enough rows and enough history before the change.
3. A process needs at least three distinct steps on real case rows.
4. Each minimum is a runtime parameter, and a use case the instructions ask for stays with thin data.
5. A stated kind whose companion tables its tables cannot fill is relabelled to its technique's own kind.
6. Deep reads the data for the forecast, scenario, impact and process checks. Standard reads no data: it decides from
   column types alone what they can decide, and marks the rest data not checked without dropping the use case.
"""
import json
import os
import sys
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v120_artifacts_support import FakeSpark  # noqa: E402
from v120_genie_support import StatusRecorder, build_inspire  # noqa: E402

ORDERS = "main.s.orders"
LEDGER = "main.s.ledger"
TEXT_DATED = "main.s.visits"
COLUMNS = {ORDERS: {"order_id": "bigint", "status": "string", "event_time": "timestamp", "store": "string",
                    "price": "double", "discount": "double", "units": "int"},
           LEDGER: {"ledger_id": "bigint", "category": "string", "branch": "string", "amount": "double"},
           TEXT_DATED: {"visit_id": "bigint", "stage": "string", "visit_date": "string", "spend": "double"}}
SCENARIO = {"levers": ["price", "discount"], "outcome": "units"}
IMPACT = {"group": "store", "time": "event_time"}
PROCESS = {"case_key": "order_id", "step": "status", "time": "event_time"}


class Agent:
    def __init__(self, answers):
        self.answers = list(answers)
        self.calls = []

    def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema=None, timeout_override=None,
                   skip_cache=False, **_kw):
        self.calls.append({"prompt": worker_prompt_path, "vars": dict(prompt_vars), "skip_cache": skip_cache})
        return json.dumps(self.answers.pop(0) if self.answers else {"results": []})


class Loader:
    def get_metadata_evidence(self, tables):
        return {t: {"columns": {name: {"name": name, "type": kind} for name, kind in COLUMNS[t].items()}, "foreign_keys": []}
                for t in tables if t in COLUMNS}


def uc(uc_id, technique, kind=None, **extra):
    out = {"No": uc_id, "Name": f"Use case {uc_id}", "Analytics Technique": technique, "Tables Involved": ORDERS,
           "Business Domain": "Sales", "Inspire Score": 4.0, "scoring_status": "scored", **extra}
    if kind:
        out["use_case_kind"] = kind
    return out


def answer(uc_id, roles, table=ORDERS):
    return {"No": uc_id, "table": table, "roles": roles, "note": ""}


def responder(rows):
    def respond(statement):
        for marker, row in rows.items():
            if marker in statement:
                return [row]
        raise AssertionError(f"unexpected statement: {statement}")
    return respond


def deep_inspire(agent_ns, answers, rows, **attrs):
    spark = FakeSpark(responder=responder(rows))
    agent = Agent(answers)
    inst = build_inspire(agent_ns, loader=Loader(), agent=agent)
    inst.logger = MagicMock()
    inst.discovery_type = "Deep"
    inst.deep_evidence = agent_ns["DeepEvidence"](spark, "Deep", MagicMock())
    inst.discovery_evidence = {"profiles": {ORDERS: {"rows": 1000, "sampled": False, "columns": {}}},
                               "join_matches": [], "data_access": {}}
    inst._emit_pipeline_status = StatusRecorder()
    inst.user_business_domains = []
    for key, value in attrs.items():
        setattr(inst, key, value)
    return inst, agent, spark


ONE_LEVER = {"n": 1000, "c0": 0.4, "v0": 30, "c1": 0.01, "v1": 30}
TWO_LEVERS = {"n": 1000, "c0": 0.4, "v0": 30, "c1": -0.2, "v1": 30}
SHORT_HISTORY = {"n": 1000, "compared_groups": 2, "control_rows": 400, "span_days": 28, "periods": 28}
LONG_HISTORY = {"n": 1000, "compared_groups": 2, "control_rows": 400, "span_days": 120, "periods": 120}
TWO_STEPS = {"n": 1000, "steps": 2, "cases": 300, "periods": 60}
FIVE_STEPS = {"n": 1000, "steps": 5, "cases": 300, "periods": 60}
NAMES = {"levers": "price, discount", "outcome": "units", "group": "store", "step": "status"}


@pytest.mark.parametrize("check,family,measures,fragment", [
    ("scenario", "H", {"row_count": 1000, "moving_levers": 1, "strongest_lever_effect": 0.4},
     "Too few of the named levers (price, discount) move units with a correlation of at least 0.05 (1); at least 2"),
    ("impact", "I", {"row_count": 1000, "compared_groups": 1, "periods": 140},
     "Too few values of store hold enough rows to compare a change against a control group (1)"),
    ("impact", "I", {"row_count": 1000, "compared_groups": 2, "control_rows": 400, "history_weeks": 4.0, "periods": 28},
     "too short a history (4.0 weeks); at least 8"),
    ("process", "J", {"row_count": 1000, "steps": 2, "cases": 300, "periods": 60},
     "The status column holds too few distinct steps (2); at least 3"),
])
def test_each_kind_check_drops_data_that_cannot_hold_it(agent_ns, check, family, measures, fragment):
    passed, text = agent_ns["deep_signal_verdict"](family, measures, NAMES, check=check)
    assert passed is False and fragment in text, text


@pytest.mark.parametrize("check,family,measures,fragment", [
    ("scenario", "H", {"row_count": 1000, "moving_levers": 2, "strongest_lever_effect": 0.4},
     "The strongest named lever moves units with a correlation of 0.400; the levers at 0.05 or more number 2."),
    ("impact", "I", {"row_count": 1000, "compared_groups": 2, "control_rows": 400, "history_weeks": 17.1, "periods": 120},
     "The compared groups cover 17.1 weeks of history; the smaller group's row count is 400."),
    ("process", "J", {"row_count": 1000, "steps": 5, "cases": 300, "periods": 60},
     "Distinct steps in the process: 5; cases with two or more steps: 300."),
])
def test_data_that_holds_the_kind_passes_and_says_what_it_found(agent_ns, check, family, measures, fragment):
    passed, text = agent_ns["deep_signal_verdict"](family, measures, NAMES, check=check)
    assert passed is True and text == fragment, text


@pytest.mark.parametrize("key,value,check,family,measures", [
    ("signal_min_levers", 1, "scenario", "H", {"row_count": 1000, "moving_levers": 1, "strongest_lever_effect": 0.4}),
    ("signal_min_impact_weeks", 4, "impact", "I",
     {"row_count": 1000, "compared_groups": 2, "control_rows": 400, "history_weeks": 4.0, "periods": 28}),
    ("signal_min_process_steps", 2, "process", "J", {"row_count": 1000, "steps": 2, "cases": 300, "periods": 60}),
])
def test_each_minimum_is_a_runtime_parameter(agent_ns, monkeypatch, key, value, check, family, measures):
    runtime = agent_ns["TECHNICAL_CONTEXT"]["runtime"]
    assert key in runtime
    assert agent_ns["deep_signal_verdict"](family, measures, NAMES, check=check)[0] is False
    monkeypatch.setitem(runtime, key, value)
    assert agent_ns["deep_signal_verdict"](family, measures, NAMES, check=check)[0] is True


def test_the_queries_read_values_and_the_measures_come_from_them(agent_ns):
    sql, measures = agent_ns["DeepEvidence"].signal_sql, agent_ns["deep_signal_measures"]
    scenario, _ = sql("scenario", "`t`", {"roles": SCENARIO})
    assert "corr(l0, o)" in scenario and "corr(l1, o)" in scenario and "CAST(`discount` AS DOUBLE) AS l1" in scenario
    assert measures("scenario", ONE_LEVER, {"roles": SCENARIO}) == {"row_count": 1000, "moving_levers": 1,
                                                                     "strongest_lever_effect": 0.4}
    flat = dict(TWO_LEVERS, v1=2)
    assert measures("scenario", flat, {"roles": SCENARIO})["moving_levers"] == 1, "a lever with fewer than 3 values never moves"
    impact, _ = sql("impact", "`t`", {"roles": IMPACT}, None, 25)
    assert "WHERE k >= 25 ORDER BY k DESC LIMIT 2" in impact and "DATEDIFF(MAX(d), MIN(d))" in impact
    assert measures("impact", SHORT_HISTORY, {"roles": IMPACT})["history_weeks"] == 4.0
    assert measures("impact", dict(SHORT_HISTORY, compared_groups=1), {"roles": IMPACT}) == {"row_count": 1000, "compared_groups": 1,
                                                                                         "periods": 28}
    process, _ = sql("process", "`t`", {"roles": PROCESS}, 5000)
    assert "pmod(xxhash64(`order_id`), 1000000) < 5000" in process, "cases are sampled whole, by their key"
    assert measures("process", FIVE_STEPS, {"roles": PROCESS}, 0.5) == {"row_count": 2000, "steps": 5, "cases": 600,
                                                                         "periods": 60}


def test_the_check_follows_the_kind_and_drops_a_use_case_whose_data_cannot_hold_it(agent_ns):
    ucs = [uc("N01-U01", "Simulation", "driver_scenarios"), uc("N01-U02", "Simulation", "driver_scenarios"),
           uc("N01-U03", "Causal Impact"), uc("N01-U04", "Process Mining")]
    answers = [{"results": [answer("N01-U01", SCENARIO), answer("N01-U02", SCENARIO), answer("N01-U03", IMPACT),
                            answer("N01-U04", PROCESS)]}]
    rows = {"corr(l0, o)": ONE_LEVER, "AS compared_groups": SHORT_HISTORY, "AS steps": TWO_STEPS}
    inst, agent, spark = deep_inspire(agent_ns, answers, rows)
    kept, dropped = inst._check_data_signal(ucs, [])
    listing = agent.calls[0]["vars"]["use_cases_listing"]
    assert "check: scenario" in listing and "check: impact" in listing and "check: process" in listing
    assert kept == [] and [u["No"] for u in dropped] == ["N01-U01", "N01-U02", "N01-U03", "N01-U04"]
    assert dropped[0]["selection_drop_reason"].startswith("the data shows no signal: Too few of the named levers")
    assert "too short a history (4.0 weeks)" in dropped[2]["selection_drop_reason"]
    assert "too few distinct steps (2)" in dropped[3]["selection_drop_reason"]


def test_data_that_holds_each_kind_keeps_its_use_case(agent_ns):
    ucs = [uc("N01-U01", "Simulation", "driver_scenarios"), uc("N01-U02", "Causal Impact"), uc("N01-U03", "Process Mining")]
    answers = [{"results": [answer("N01-U01", SCENARIO), answer("N01-U02", IMPACT), answer("N01-U03", PROCESS)]}]
    rows = {"corr(l0, o)": TWO_LEVERS, "AS compared_groups": LONG_HISTORY, "AS steps": FIVE_STEPS}
    inst, _agent, _spark = deep_inspire(agent_ns, answers, rows)
    kept, dropped = inst._check_data_signal(ucs, [])
    assert [u["No"] for u in kept] == ["N01-U01", "N01-U02", "N01-U03"] and dropped == []
    assert all(u["data_signal"]["status"] == "passed" for u in ucs)


def test_a_simulation_stated_as_a_decide_kind_keeps_the_lever_check(agent_ns):
    inst, _agent, _spark = deep_inspire(agent_ns, [], {})
    assert inst._signal_check_of(uc("N01-U01", "Simulation", "inventory_replenishment")) == ("H", "lever")
    assert inst._signal_check_of(uc("N01-U01", "Simulation", "driver_scenarios")) == ("H", "scenario")


def test_a_use_case_the_instructions_ask_for_stays_with_thin_data(agent_ns):
    ucs = [uc("N01-U01", "Process Mining", user_request="R1"), uc("N01-U02", "Process Mining")]
    answers = [{"results": [answer("N01-U01", PROCESS), answer("N01-U02", PROCESS)]}]
    inst, _agent, _spark = deep_inspire(agent_ns, answers, {"AS steps": TWO_STEPS}, parsed_generation_instructions={
        "use_case_requests": [{"id": "R1", "ask": "an order process map", "minimum": 1}]})
    kept, dropped = inst._check_data_signal(ucs, [])
    assert [u["No"] for u in kept] == ["N01-U01"] and [u["No"] for u in dropped] == ["N01-U02"]
    assert "too few distinct steps (2)" in ucs[0]["data_signal"]["reason"]


def test_the_prompt_names_the_roles_of_each_kind_check(agent_ns):
    prompt = agent_ns["PROMPT_TEMPLATES"]["SIGNAL_CHECK_PROMPT"]
    assert '- scenario: "levers" lists 2 to 5 numeric columns' in prompt
    assert '- impact: "group" is the column that separates the rows the change reached from the control rows' in prompt
    assert '- process: "case_key" is the key of one case that moves through the steps' in prompt
    assert '"series_key", "case_key" or "step", whose values Inspire only counts' in prompt


SHOPS = [("main", "s", "shops", "shop_id", "bigint", ""), ("main", "s", "shops", "revenue", "double", ""),
         ("main", "s", "shops", "rent", "double", "")]
MAPPED = SHOPS + [("main", "s", "shops", "latitude", "double", ""), ("main", "s", "shops", "longitude", "double", "")]


def site_uc(uc_id, **extra):
    return {"No": uc_id, "Name": "Choose the next shop sites", "Analytics Technique": "Optimization",
            "Use Case Kind": "site_territory", "Tables Involved": "main.s.shops", "Business Domain": "Sales",
            "Statement": "New shops open where revenue per rent is low.", "Solution": "Optimize the next 10 sites each quarter.",
            "High Level Design": "Rank candidate sites by `revenue` over `rent`.", **extra}


def q5(agent_ns, ucs, schema, parsed=None):
    inst = build_inspire(agent_ns, loader=Loader(), agent=Agent([]))
    inst.logger = MagicMock()
    inst.parsed_generation_instructions = parsed or {}
    inst._phaseQ5_decision_readiness(ucs, schema)
    return inst


def test_d5_a_kind_whose_companion_tables_the_data_cannot_fill_is_relabelled_to_the_technique_kind(agent_ns):
    uc_ = site_uc("N01-U01")
    inst = q5(agent_ns, [uc_], SHOPS)
    assert (uc_["use_case_kind"], uc_["kind_relabelled_from"]) == ("allocation", "site_territory")
    logged = " ".join(str(call.args[0]) for call in inst.logger.info.call_args_list)
    assert ('[KIND-MATCH FIRED] 1 use case relabelled to the kind of the technique each one uses: N01-U01 "Choose the next shop sites" site_territory -> '
            "allocation (its __geo table needs a geographic column") in logged


def test_d5_a_kind_whose_companion_tables_the_data_can_fill_keeps_its_kind(agent_ns):
    mapped, unmapped = site_uc("N01-U01", **{"Tables Involved": "main.s.stores"}), site_uc("N01-U02")
    q5(agent_ns, [mapped, unmapped], SHOPS + [("main", "s", "stores", *row[3:]) for row in MAPPED])
    assert mapped["Use Case Kind"] == "site_territory" and "kind_relabelled_from" not in mapped
    assert unmapped["kind_relabelled_from"] == "site_territory"


def test_d5_the_companion_check_never_relabels_a_kind_the_instructions_ask_for(agent_ns):
    requested, plain = site_uc("N01-U01", user_request="R1"), site_uc("N01-U02")
    q5(agent_ns, [requested, plain], SHOPS)
    assert requested["Use Case Kind"] == "site_territory" and "kind_relabelled_from" not in requested
    assert plain["kind_relabelled_from"] == "site_territory"
    asked = site_uc("N01-U03")
    q5(agent_ns, [asked], SHOPS, parsed={"use_case_kinds": {"asked": ["site_territory"], "excluded": []}})
    assert asked["Use Case Kind"] == "site_territory" and "kind_relabelled_from" not in asked


def test_d5_a_gap_the_technique_kind_shares_keeps_the_kind_and_flags_it(agent_ns):
    uc_ = {"No": "N01-U01", "Name": "Map the order journey", "Analytics Technique": "Process Mining",
           "Use Case Kind": "process_mining", "Tables Involved": "main.s.shops"}
    inst = q5(agent_ns, [uc_], SHOPS)
    assert uc_["Use Case Kind"] == "process_mining" and "kind_relabelled_from" not in uc_
    assert "Q5_D5_COMPANION_DATA:process_mining" in uc_["gate_flags"]
    assert inst._kind_companion_gap("process_mining", None) == "", "no schema, no companion check"


SHORT_SERIES = {"periods": 18, "median_gap": 30, "first_period": "2024-01-01", "last_period": "2025-06-01", "lag1": 0.1,
                "lag12": 0.5}
FLAT_PRICE = {"n": 1000, "lever_values": 40, "pooled": -0.0006, "within": 0.001}
SERIES = {"time": "event_time", "measure": "units"}
LEVER = {"lever": "price", "outcome": "units"}
MODES = ("Deep", "Standard")
KIND_CHECKS = ("series", "scenario", "impact", "process")


def no_read(statement):
    raise AssertionError(f"Standard discovery sent a statement: {statement}")


def standard_inspire(agent_ns, answers, **attrs):
    spark = FakeSpark(responder=no_read)
    agent = Agent(answers)
    inst = build_inspire(agent_ns, loader=Loader(), agent=agent, spark=spark, discovery_type="Standard", deep_evidence=None)
    inst.logger = MagicMock()
    inst.discovery_evidence = {"profiles": {}, "join_matches": [], "data_access": {}}
    inst._emit_pipeline_status = StatusRecorder()
    inst.user_business_domains = []
    for key, value in attrs.items():
        setattr(inst, key, value)
    return inst, agent, spark


def kind_use_cases(table=ORDERS):
    tables = {"Tables Involved": table}
    return [uc("N01-U01", "Forecasting", **tables), uc("N01-U02", "Simulation", "driver_scenarios", **tables),
            uc("N01-U03", "Causal Impact", **tables), uc("N01-U04", "Process Mining", **tables),
            uc("N01-U05", "Optimization", "allocation", **tables)]


def test_the_modes_tested_are_every_discovery_mode(agent_ns):
    assert tuple(sorted(agent_ns["DISCOVERY_TYPE_VALID"])) == tuple(sorted(MODES))


def test_deep_reads_the_data_for_each_kind_check(agent_ns):
    answers = [{"results": [answer("N01-U01", SERIES), answer("N01-U02", SCENARIO), answer("N01-U03", IMPACT),
                            answer("N01-U04", PROCESS), answer("N01-U05", LEVER)]}]
    rows = {"AS median_gap": SHORT_SERIES, "corr(l0, o)": ONE_LEVER, "AS compared_groups": SHORT_HISTORY,
            "AS steps": TWO_STEPS, "AS pooled": FLAT_PRICE}
    inst, _agent, spark = deep_inspire(agent_ns, answers, rows)
    kept, dropped = inst._check_data_signal(kind_use_cases(), [])
    assert kept == [] and [u["No"] for u in dropped] == ["N01-U01", "N01-U02", "N01-U03", "N01-U04", "N01-U05"]
    assert "1.5 seasonal cycles" in dropped[0]["selection_drop_reason"]
    assert "too few distinct steps (2)" in dropped[3]["selection_drop_reason"]
    assert spark.statements, "Deep reads aggregates of the data"


def test_standard_sends_no_statement_and_marks_what_needs_data_as_data_not_checked(agent_ns):
    ucs = kind_use_cases()
    answers = [{"results": [answer("N01-U01", SERIES), answer("N01-U02", SCENARIO), answer("N01-U03", IMPACT),
                            answer("N01-U04", PROCESS), answer("N01-U05", LEVER)]}]
    inst, agent, spark = standard_inspire(agent_ns, answers)
    kept, dropped = inst._check_data_signal(ucs, [])
    assert spark.statements == [], "Standard discovery never sends a statement against the tables"
    assert inst.deep_evidence is None
    assert [u["No"] for u in kept] == ["N01-U01", "N01-U02", "N01-U03", "N01-U04", "N01-U05"] and dropped == []
    assert [u["data_signal"]["check"] for u in ucs[:4]] == list(KIND_CHECKS)
    assert all(u["data_signal"]["status"] == "not_checked" and u["data_signal"]["reason"].startswith(
        "Data not checked: Standard discovery reads no data, so Inspire did not check that ") for u in ucs[:4])
    assert "at least 2 of the levers move the outcome" in ucs[1]["data_signal"]["reason"]
    assert "at least 3 distinct steps" in ucs[3]["data_signal"]["reason"]
    assert ucs[3]["Data Evidence"]["signal"]["status"] == "not_checked"
    assert "data_signal" not in ucs[4], "a check outside the four kind checks never runs outside Deep"
    assert "N01-U05" not in agent.calls[0]["vars"]["use_cases_listing"]
    access = inst._v130_results_keys()["data_access"]
    assert access["discovery_type"] == "Standard" and access["tables_read_count"] == 0


def test_standard_drops_what_the_column_types_alone_rule_out(agent_ns):
    ucs = kind_use_cases(LEDGER)[:4]
    answers = [{"results": [answer("N01-U01", {"time": "", "measure": "amount"}, LEDGER),
                            answer("N01-U02", {"levers": ["amount"], "outcome": "amount"}, LEDGER),
                            answer("N01-U03", {"group": "branch", "time": ""}, LEDGER),
                            answer("N01-U04", {"case_key": "ledger_id", "step": "category", "time": ""}, LEDGER)]}]
    inst, _agent, spark = standard_inspire(agent_ns, answers)
    kept, dropped = inst._check_data_signal(ucs, [])
    assert spark.statements == []
    assert kept == [] and [u["No"] for u in dropped] == ["N01-U01", "N01-U02", "N01-U03", "N01-U04"]
    assert all(u["data_signal"]["status"] == "failed" for u in ucs)
    assert dropped[0]["selection_drop_reason"] == (
        "the data shows no signal: From the column types alone: none of its tables (main.s.ledger) has a date or "
        "timestamp column, or a key that joins to one, so there is no history to forecast.")
    assert "so there is no before and after to compare" in dropped[2]["selection_drop_reason"]
    assert "so the steps cannot be put in order" in dropped[3]["selection_drop_reason"]
    assert dropped[1]["selection_drop_reason"].endswith(
        "its tables (main.s.ledger) hold 1 numeric measure column (amount), and a scenario needs at least 3: "
        "2 levers to change and an outcome they move.")


def test_standard_keeps_a_date_held_as_text_for_the_data_to_decide(agent_ns):
    ucs = kind_use_cases(TEXT_DATED)[:1] + kind_use_cases(TEXT_DATED)[3:4]
    answers = [{"results": [answer("N01-U01", {"time": "visit_date", "measure": "spend"}, TEXT_DATED),
                            answer("N01-U04", {"case_key": "visit_id", "step": "stage", "time": "visit_date"}, TEXT_DATED)]}]
    inst, _agent, spark = standard_inspire(agent_ns, answers)
    kept, dropped = inst._check_data_signal(ucs, [])
    assert spark.statements == [] and dropped == [] and [u["No"] for u in kept] == ["N01-U01", "N01-U04"]
    assert all(u["data_signal"]["status"] == "not_checked" for u in ucs)


def test_a_must_have_use_case_is_kept_and_flagged_in_every_mode(agent_ns):
    instructions = {"use_case_requests": [{"id": "R1", "ask": "an order process map", "minimum": 1}]}
    for mode in MODES:
        table = ORDERS if mode == "Deep" else LEDGER
        roles = PROCESS if mode == "Deep" else {"case_key": "ledger_id", "step": "category", "time": ""}
        ucs = [uc("N01-U01", "Process Mining", user_request="R1", **{"Tables Involved": table}),
               uc("N01-U02", "Process Mining", **{"Tables Involved": table})]
        answers = [{"results": [answer("N01-U01", roles, table), answer("N01-U02", roles, table)]}]
        if mode == "Deep":
            inst, _agent, _spark = deep_inspire(agent_ns, answers, {"AS steps": TWO_STEPS},
                                                parsed_generation_instructions=instructions)
        else:
            inst, _agent, _spark = standard_inspire(agent_ns, answers, parsed_generation_instructions=instructions)
        kept, dropped = inst._check_data_signal(ucs, [])
        assert [u["No"] for u in kept] == ["N01-U01"] and [u["No"] for u in dropped] == ["N01-U02"], mode
        assert ucs[0]["data_signal"]["status"] == "no_signal", mode
        assert "Inspire kept it because the instructions ask for an order process map" in ucs[0]["data_signal"]["reason"]


def test_standard_never_builds_a_data_reader(agent_ns):
    spark = FakeSpark(responder=no_read)
    with pytest.raises(agent_ns["StandardModeDataReadError"]):
        agent_ns["DeepEvidence"](spark, "Standard", MagicMock())
    reads = agent_ns["deep_signal_check_reads"]
    others = ("lever", "outcome", "groups", "text", "measure", "basket", "features")
    assert [reads(check, "Standard") for check in KIND_CHECKS + others] == ["metadata"] * 4 + [""] * len(others)
    assert all(reads(check, "Deep") == "data" for check in KIND_CHECKS + others)
    assert spark.statements == []


def test_the_standard_disclaimer_still_says_no_data_was_read(agent_ns):
    ts = agent_ns["TranslationService"]
    assert all("doc_data_access_standard_checks" not in texts
               for texts in [ts.ENGLISH_TRANSLATIONS, *ts.TRANSLATION_FALLBACKS.values()])
    ucs = kind_use_cases()[:1]
    inst, _agent, _spark = standard_inspire(agent_ns, [{"results": [answer("N01-U01", SERIES)]}])
    inst._check_data_signal(ucs, [])
    t = dict(ts.ENGLISH_TRANSLATIONS)
    model = inst._document_model("English", t, {}, {"Sales": ucs}, "Acme")
    _title, items = inst._doc_disclaimer(model, t)
    assert items[0] == t["doc_data_access_standard"]
    assert "read no customer data" in items[0]
