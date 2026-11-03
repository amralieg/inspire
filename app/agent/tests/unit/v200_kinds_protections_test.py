"""v1.4.0 use-case kinds: the trim protections.

1. A theme keeps its floor seat only when its best use case clears the near-par bar: every gate
   passed, no unverified gate, no fatal flaw, Best-of-Best at or above the portfolio median, and a
   Value of 3 or more. A below-bar theme best still competes in the fill, so the count holds.
2. A kind family the data supports strongly keeps one use case when its best one clears the same
   bar and replaces an idea within 1.0 Best-of-Best; the floor holds at most 15% of the places.
3. A kind the instructions ask for is kept even below the bar, labelled below the bar; a kind the
   instructions exclude never appears.
4. One technique holds at most 30% of the places unless no near-par use case of another technique
   is left, and a technique the instructions force is exempt.
5. Every kept use case records why it is there, and the run logs which detected kinds are missing.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _agentload  # noqa: E402
from v120_artifacts_support import make_inspire  # noqa: E402

REGISTRY = {
    "version": 1,
    "families": [{"id": "measure_explain", "label": "Measure and explain"}, {"id": "predict", "label": "Predict"}, {"id": "run_processes", "label": "Run processes"},
                 {"id": "detect_protect", "label": "Detect and protect"}],
    "layouts": [{"id": "decision_queue", "min_items": {"decision_list": 20}},
                {"id": "forecast_cockpit", "min_items": {"at_risk_series": 5, "fan_chart": 1}},
                {"id": "dashboard", "min_items": {"charts": 2}}],
    "technique_kind": {"Classification": "risk_propensity", "Forecasting": "forecast", "Process Mining": "process_mining"},
    "kinds": [
        {"id": "driver_breakdown", "num": 2, "family": "measure_explain", "label": "Driver breakdown", "informational": True,
         "layout": "dashboard", "techniques": ["Decomposition"]},
        {"id": "forecast", "num": 5, "family": "predict", "label": "Forecast", "informational": False,
         "layout": "forecast_cockpit", "techniques": ["Forecasting"]},
        {"id": "risk_propensity", "num": 6, "family": "predict", "label": "Risk and propensity", "informational": False,
         "layout": "decision_queue", "techniques": ["Classification", "Predictive Modeling"]},
        {"id": "anomaly", "num": 23, "family": "detect_protect", "label": "Anomaly", "informational": False,
         "techniques": ["Anomaly Detection"]},
        {"id": "process_mining", "num": 34, "family": "run_processes", "label": "Process mining", "informational": False,
         "techniques": ["Process Mining"],
         "strip_must_remain": "a process map with step durations and the cases that will breach"},
        {"id": "sla_aging", "num": 35, "family": "run_processes", "label": "SLA and aging", "informational": False,
         "techniques": ["Survival Analysis"]},
    ],
}

TECHNIQUE_OF = {"driver_breakdown": "Decomposition", "risk_propensity": "Classification", "forecast": "Forecasting", "anomaly": "Anomaly Detection",
                "process_mining": "Process Mining", "sla_aging": "Survival Analysis"}


@pytest.fixture(scope="module")
def ns():
    namespace = _agentload.fresh_agent_namespace()
    namespace["_inspire_kinds"] = lambda: REGISTRY
    return namespace


@pytest.fixture
def rt(ns, monkeypatch):
    runtime = ns["TECHNICAL_CONTEXT"]["runtime"]
    for key in list(runtime):
        monkeypatch.setitem(runtime, key, runtime[key])
    return runtime


def _inst(ns, parsed=None, detected=None, **attrs):
    inst = make_inspire(ns, parsed_generation_instructions=parsed or {}, user_business_domains=[],
                        detected_kinds=detected or [], **attrs)
    inst._kind_floor_reasons = {}
    return inst


def _uc(no, bob, theme="T1", kind="risk_propensity", value=4.0, technique=None, **extra):
    uc = {"No": no, "Name": f"Use case {no}", "bob_score": bob, "idea_theme": theme, "Use Case Kind": kind,
          "Analytics Technique": technique or TECHNIQUE_OF[kind], "Value": value, "Business Domain": "Sales"}
    uc.update(extra)
    return uc


def _nos(use_cases):
    return sorted(uc["No"] for uc in use_cases)


def _messages(inst, tag):
    return [msg for _lvl, msg in inst.logger.records if tag in msg]


def _theme_pool(near_par=True, **b_extra):
    a = [_uc(f"A{i}", round(9.9 - 0.1 * i, 2), theme="A") for i in range(5)]
    b = [_uc("B0", 9.4 if near_par else 3.0, theme="B", **b_extra)]
    c = [_uc(f"C{i}", 1.0, theme="C") for i in range(6)]
    return a + b + c


def test_a_theme_best_below_the_bar_loses_its_floor_seat_and_a_near_par_one_keeps_it(ns, rt):
    rt["technique_max_share"] = 1.0
    inst = _inst(ns)
    drops = {}
    pool = _theme_pool()
    out = inst._stratified_trim_by_theme(pool, target_max=4, theme_max_share=1.0, drops=drops)
    assert _nos(out) == ["A0", "A1", "A2", "B0"]
    assert {drops[id(uc)][0] for uc in pool if uc["No"].startswith("C")} == {"over_target"}
    assert _messages(inst, "2 of 3 themes held a floor seat")


def test_a_theme_best_under_the_median_competes_in_the_fill(ns, rt):
    rt["technique_max_share"] = 1.0
    inst = _inst(ns)
    pool = [_uc(f"A{i}", round(9.9 - 0.1 * i, 2), theme="A") for i in range(4)]
    pool += [_uc("B0", 9.0, theme="B"), _uc("C0", 1.0, theme="C")]
    out = inst._stratified_trim_by_theme(pool, target_max=4, theme_max_share=1.0)
    assert _nos(out) == ["A0", "A1", "A2", "A3"]
    assert _messages(inst, "1 of 3 themes held a floor seat")


@pytest.mark.parametrize("extra", [{"gate_flags": ["Q5_R18_TECHNIQUE_LABEL_DRIFT:x"]}, {"gate_unverified": ["Q3"]},
                                   {"Value": 2.0},
                                   {"elite_assessment": {"red_team": {"fatal_flaw": True}}}])
def test_a_flagged_or_low_value_theme_best_loses_its_floor_seat(ns, rt, extra):
    rt["technique_max_share"] = 1.0
    inst = _inst(ns)
    pool = _theme_pool()
    pool[5].update(extra)
    out = inst._stratified_trim_by_theme(pool, target_max=4, theme_max_share=1.0)
    assert _nos(out) == ["A0", "A1", "A2", "A3"]


def test_a_count_the_user_set_is_never_lowered_by_the_bar(ns, rt):
    rt["technique_max_share"] = 1.0
    parsed = {"use_case_count": {"count": 5, "mode": "exactly", "scope": "catalog"}}
    inst = _inst(ns, parsed=parsed)
    pool = [_uc(f"A{i}", round(9.9 - 0.1 * i, 2), theme="A") for i in range(3)]
    pool += [_uc("B0", 2.0, theme="B"), _uc("C0", 1.5, theme="C"), _uc("D0", 1.0, theme="D")]
    count = inst._user_use_case_count()
    out = inst._trim_to_user_count(pool, 5, rt, count)
    assert len(out) == 5
    assert {uc["No"]: uc["selection_basis"] for uc in out if uc.get("selection_basis")} == {"A1": "user_request"}


def _family_pool(p_bob=9.0, p_extra=None, n_a=8, n_low=8):
    a = [_uc(f"A{i}", round(9.9 - 0.1 * i, 2)) for i in range(n_a)]
    p = _uc("P0", p_bob, kind="process_mining", **(p_extra or {}))
    low = [_uc(f"L{i}", 1.0, theme="T2") for i in range(n_low)]
    return a + [p] + low


STRONG_PROCESS = [{"id": "process_mining", "strength": 0.9}]


def test_a_strong_family_with_a_near_par_use_case_takes_one_floor_seat(ns, rt):
    rt["technique_max_share"] = 1.0
    inst = _inst(ns, detected=STRONG_PROCESS)
    drops = {}
    out = inst._stratified_trim_by_theme(_family_pool(), target_max=7, theme_max_share=1.0, drops=drops)
    assert "P0" in _nos(out) and "A6" not in _nos(out)
    p = next(uc for uc in out if uc["No"] == "P0")
    assert (p["selection_basis"], p["selection_replaced"], p["selection_score_gap"]) == ("kind_floor", "A6", 0.3)
    victim = [key for key, value in drops.items() if value[0] == "kind_floor"]
    assert len(victim) == 1
    assert _messages(inst, "[KIND-FLOOR FIRED]")


@pytest.mark.parametrize("p_bob,p_extra,target,detected,reason", [
    (8.2, None, 7, STRONG_PROCESS, "scores 1.10 higher"),
    (9.0, {"gate_flags": ["Q3_R14"]}, 7, STRONG_PROCESS, "below the near-par bar: flagged"),
    (9.0, {"Value": 2.5}, 7, STRONG_PROCESS, "below the near-par bar: its Value 2.5"),
    (9.0, None, 6, STRONG_PROCESS, "already holds its 0 of the 6 places"),
    (9.0, None, 7, [{"id": "process_mining", "strength": "weak"}], "its signature is weak"),
])
def test_a_family_floor_seat_is_refused_off_the_bar(ns, rt, p_bob, p_extra, target, detected, reason):
    rt["technique_max_share"] = 1.0
    inst = _inst(ns, detected=detected)
    out = inst._stratified_trim_by_theme(_family_pool(p_bob, p_extra), target_max=target, theme_max_share=1.0)
    assert "P0" not in _nos(out)
    assert reason in inst._kind_floor_reasons["process_mining"]


def test_a_family_takes_at_most_its_seats_and_the_floor_at_most_its_share(ns, rt):
    rt["technique_max_share"] = 1.0
    detected = [{"id": "process_mining", "strength": 0.9}, {"id": "sla_aging", "strength": 0.8}]
    inst = _inst(ns, detected=detected)
    a = [_uc(f"A{i:02d}", round(9.9 - 0.05 * i, 3)) for i in range(20)]
    pool = a + [_uc("P0", 9.0, kind="process_mining"), _uc("S0", 8.99, kind="sla_aging")]
    pool += [_uc(f"L{i:02d}", 1.0, theme="T2") for i in range(20)]
    out = inst._stratified_trim_by_theme(pool, target_max=14, theme_max_share=1.0)
    assert "P0" in _nos(out) and "S0" not in _nos(out)
    rt["kind_floor_seats_per_family"] = 2
    inst = _inst(ns, detected=detected)
    out = inst._stratified_trim_by_theme([dict(uc) for uc in pool], target_max=14, theme_max_share=1.0)
    assert {"P0", "S0"} <= set(_nos(out))
    rt["kind_floor_max_share"] = 0.1
    inst = _inst(ns, detected=detected)
    out = inst._stratified_trim_by_theme([dict(uc) for uc in pool], target_max=14, theme_max_share=1.0)
    assert "P0" in _nos(out) and "S0" not in _nos(out)


def test_a_kind_the_instructions_ask_for_is_kept_below_the_bar_and_labelled(ns, rt):
    rt["technique_max_share"] = 1.0
    parsed = {"use_case_kinds": {"asked": ["Process mining"], "excluded": []}}
    inst = _inst(ns, parsed=parsed)
    out = inst._stratified_trim_by_theme(_family_pool(1.0, {"gate_flags": ["Q3_R14"]}), target_max=7, theme_max_share=1.0)
    p = next(uc for uc in out if uc["No"] == "P0")
    assert (p["elite_status"], p["fallback_kind"], p["selection_basis"]) == ("FALLBACK_BELOW_BAR", "kind_request", "user_request")
    assert "flagged by Q3_R14" in p["fallback_reason"]
    assert id(p) in inst._user_protected_use_cases(out)


def test_a_kind_the_instructions_exclude_never_takes_a_seat(ns, rt):
    rt["technique_max_share"] = 1.0
    parsed = {"use_case_kinds": {"asked": ["process_mining"], "excluded": ["run_processes"]}}
    inst = _inst(ns, parsed=parsed, detected=STRONG_PROCESS)
    pool = _family_pool()
    out = inst._stratified_trim_by_theme(pool, target_max=7, theme_max_share=1.0)
    assert "P0" not in _nos(out)
    inst._log_kind_coverage(out, pool)
    assert "process_mining: excluded by the instructions" in _messages(inst, "[KIND-COVERAGE FIRED]")[0]


SCHEMA = [("main", "sales", "orders", "order_id", "bigint", ""), ("main", "sales", "orders", "amount", "double", "")]


def test_q5_drops_a_use_case_of_an_excluded_kind_and_keeps_the_rest(ns):
    parsed = {"use_case_kinds": {"asked": [], "excluded": ["Process mining"]}}
    inst = _inst(ns, parsed=parsed)
    base = {"Statement": "Late orders cost margin.", "Solution": "Score each order with a classification model.",
            "High Level Design": "Train a classification model on orders.", "Beneficiary": "Fulfilment manager"}
    keep = dict(base, No="K1", Name="Predict Late Orders to Expedite Shipments", **{"Use Case Kind": "risk_propensity",
                                                                                   "Analytics Technique": "Classification"})
    drop = dict(base, No="X1", Name="Predict Late Orders to Expedite Shipments", **{"Use Case Kind": "process_mining",
                                                                                   "Analytics Technique": "Process Mining"})
    kept, dropped = inst._phaseQ5_decision_readiness([keep, drop], SCHEMA)
    assert [uc["No"] for uc in kept] == ["K1"]
    assert [(uc["No"], reason) for uc, reason in dropped] == [("X1", "Q5_KIND_EXCLUDED:process_mining")]


def test_user_kind_directives_map_labels_and_families_and_exclusion_wins(ns):
    inst = _inst(ns)
    parsed = {"use_case_kinds": {"asked": ["Forecast", "process_mining", "nothing like it"],
                                 "excluded": ["detect_protect", "forecast"]}}
    asked, excluded = inst._user_kind_directives(parsed=parsed)
    assert asked == ["process_mining"]
    assert excluded == {"anomaly", "forecast"}
    assert inst._user_kind_directives(parsed={}) == ([], set())


def _technique_pool():
    pool = [_uc(f"A{i}", round(9.9 - 0.1 * i, 2)) for i in range(10)]
    return pool + [_uc("F1", 8.95, kind="forecast"), _uc("F2", 7.0, kind="forecast")]


def test_one_technique_over_its_share_gives_a_place_to_a_near_par_use_case_of_another(ns, rt):
    inst = _inst(ns)
    drops = {}
    out = inst._stratified_trim_by_theme(_technique_pool(), target_max=10, theme_max_share=1.0, drops=drops)
    assert "F1" in _nos(out) and "A9" not in _nos(out) and "F2" not in _nos(out)
    assert [value[0] for value in drops.values()].count("technique_cap") == 1
    assert _messages(inst, "[TECHNIQUE-SHARE FIRED]")


def test_a_technique_the_instructions_force_is_exempt_from_the_share(ns, rt):
    inst = _inst(ns, parsed={"forced_techniques": [{"technique": "Classification", "context": "all use cases"}]})
    pool = [_uc(f"A{i}", round(9.9 - 0.1 * i, 2)) for i in range(5)]
    pool += [_uc(f"N{i}", round(9.45 - 0.1 * i, 2), kind="anomaly") for i in range(5)]
    pool += [_uc("F1", 9.0, kind="forecast"), _uc("F2", 8.98, kind="forecast")]
    out = inst._stratified_trim_by_theme(pool, target_max=10, theme_max_share=1.0)
    techniques = [uc["Analytics Technique"] for uc in out]
    assert (techniques.count("Classification"), techniques.count("Anomaly Detection"), techniques.count("Forecasting")) == (5, 3, 2)


def test_the_technique_share_and_the_swap_gap_are_runtime_parameters(ns, rt):
    rt["technique_max_share"] = 0.5
    rt["kind_floor_max_bob_gap"] = 3.0
    inst = _inst(ns)
    out = inst._stratified_trim_by_theme(_technique_pool(), target_max=10, theme_max_share=1.0)
    assert {"F1", "F2"} <= set(_nos(out)) and "A8" not in _nos(out)
    rt["technique_max_share"] = 1.0
    inst = _inst(ns)
    out = inst._stratified_trim_by_theme(_technique_pool(), target_max=10, theme_max_share=1.0)
    assert "F1" not in _nos(out)


def test_the_prompts_no_longer_carry_the_technique_share_rule():
    text = _agentload.agent_source()
    assert "single technique ≤ 30%" not in text
    assert "No single Analytics Technique above 30%" not in text
    assert "*Technique redundancy:*" not in text


def test_selection_basis_marks_earned_and_user_picks(ns):
    inst = _inst(ns)
    picks = [{"No": "E1"}, {"No": "D1", "elite_status": "DOMAIN_COVERAGE_PICK"},
             {"No": "K1", "selection_basis": "kind_floor", "selection_replaced": "E9", "selection_score_gap": 0.4}]
    inst._stamp_selection_basis(picks)
    assert [(uc["selection_basis"], uc["selection_replaced"], uc["selection_score_gap"]) for uc in picks] == [
        ("earned", "", None), ("user_request", "", None), ("kind_floor", "E9", 0.4)]


def test_kind_coverage_logs_every_missing_detected_kind_with_its_reason(ns):
    detected = [{"id": "forecast", "strength": 0.9}, {"id": "process_mining", "strength": 0.9},
                {"id": "anomaly", "strength": 0.7}, {"id": "sla_aging", "strength": 0.6}]
    inst = _inst(ns, parsed={"use_case_kinds": {"asked": [], "excluded": ["sla_aging"]}}, detected=detected)
    inst._kind_floor_reasons = {"process_mining": "its signature is weak (0.20, a floor seat needs 0.5)"}
    selected = [_uc("F1", 8.0, kind="forecast", selection_basis="earned")]
    universe = selected + [_uc("P1", 4.0, kind="process_mining")]
    inst._log_kind_coverage(selected, universe)
    [line] = _messages(inst, "[KIND-COVERAGE FIRED]")
    assert "detected=4 produced=1" in line
    assert "anomaly: no use case of this kind was generated" in line
    assert "process_mining: its signature is weak" in line
    assert "sla_aging: excluded by the instructions" in line
    assert "forecast:" not in line


def test_kind_coverage_warns_when_floor_picks_sit_far_below_the_portfolio(ns):
    inst = _inst(ns, detected=[{"id": "forecast", "strength": 0.9}])
    selected = [_uc("A1", 9.0), _uc("A2", 9.0), _uc("F1", 7.0, kind="forecast", selection_basis="kind_floor")]
    inst._log_kind_coverage(selected, selected)
    assert any(lvl == "WARNING" and "kind-floor pick average" in msg for lvl, msg in inst.logger.records)


def _q5_uc(no, name, statement, solution, design, owner="Collections lead", kind="risk_propensity", **extra):
    uc = {"No": no, "Name": name, "Statement": statement, "Solution": solution, "High Level Design": design,
          "Beneficiary": owner, "Sponsor": "", "Use Case Kind": kind, "Analytics Technique": TECHNIQUE_OF[kind]}
    uc.update(extra)
    return uc


def _q5(ns, ucs, parsed=None):
    kept, dropped = _inst(ns, parsed=parsed)._phaseQ5_decision_readiness(ucs, SCHEMA)
    return [uc["No"] for uc in kept], {uc["No"]: reason for uc, reason in dropped}


RESTATES_FLAG = ("Flag Late Orders to Expedite Shipments", "Late orders cost margin.",
                 "Expedite each order on the list.", "SELECT order_id FROM orders WHERE is_late = 1 ORDER BY amount")
RESTATES_STATUS = ("List Overdue Invoices for Collectors", "Overdue invoices tie up cash.",
                   "Collectors call each invoice on the list.", "SELECT * FROM invoices WHERE invoice_status = 'overdue'")


def test_t2_a_filter_on_the_column_that_holds_the_answer_is_rejected(ns):
    kept, dropped = _q5(ns, [_q5_uc("F1", *RESTATES_FLAG), _q5_uc("S1", *RESTATES_STATUS)])
    assert kept == []
    assert dropped == {"F1": "Q5_T2_RESTATES_COLUMN:is_late",
                       "S1": "Q5_T2_RESTATES_COLUMN:invoice_status = 'overdue'"}


def test_t2_a_model_that_looks_ahead_of_the_flag_is_kept(ns):
    uc = _q5_uc("P1", "Predict Late Orders Before They Ship", "Late orders cost margin.",
                "Score each open order with a classification model trained on past is_late labels.",
                "Train on orders WHERE is_late = 1 versus on-time orders, then score each open order weekly.")
    assert _q5(ns, [uc, _q5_uc("F1", *RESTATES_FLAG)]) == (["P1"], {"F1": "Q5_T2_RESTATES_COLUMN:is_late"})


def test_t2_and_t4_skip_a_use_case_the_instructions_ask_for(ns):
    asked = [_q5_uc("F1", *RESTATES_FLAG, user_request="R1"),
             _q5_uc("O1", "Score Each Supplier for Delivery Risk", "Late supplies stop lines.",
                    "Score each supplier weekly.", "Classification per supplier.", owner="", user_request="R2")]
    unasked = [_q5_uc("F2", *RESTATES_FLAG), dict(asked[1], No="O2", user_request=None)]
    assert _q5(ns, asked + unasked) == (["F1", "O1"], {"F2": "Q5_T2_RESTATES_COLUMN:is_late", "O2": "Q5_T4_NO_OWNER"})


DECIDES = ("Score Each Supplier for Delivery Risk", "Late supplies stop production lines.",
           "Score each supplier weekly and send buyers the riskiest ones first.", "Classification per supplier on deliveries.")


@pytest.mark.parametrize("change,reason", [
    ({"Beneficiary": "", "Sponsor": "Stakeholders"}, "Q5_T4_NO_OWNER"),
    ({"Statement": "A one-time analysis of supplier delays.", "Solution": "Score suppliers in a one-off study."},
     "Q5_T4_ONE_OFF"),
    ({"Solution": "Rank the top 5 suppliers for buyers to call."}, "Q5_T4_TOO_FEW_ITEMS:5<20"),
    ({"Name": "Model Supplier Delivery Delays", "Statement": "Delays stop production.",
      "Solution": "Build one model of total delay.", "High Level Design": "Aggregate deliveries into one number."},
     "Q5_T4_NO_PER_ITEM_ACTION"),
])
def test_t4_a_use_case_that_fails_the_decision_test_is_rejected(ns, change, reason):
    uc = dict(_q5_uc("D1", *DECIDES), **change)
    assert _q5(ns, [uc]) == ([], {"D1": reason})


def test_t4_a_use_case_with_an_owner_a_cadence_and_a_per_item_action_is_kept(ns):
    one_off_setup = dict(_q5_uc("D2", *DECIDES), Solution="A one-time setup, then score each supplier weekly.")
    forecast = _q5_uc("D3", "Forecast Demand per Store to Set Orders", "Stockouts lose sales.",
                      "Forecast each store weekly and flag the top 5 series at risk.", "Forecasting per store.",
                      kind="forecast")
    too_few = dict(forecast, No="D4", **{"Use Case Kind": "risk_propensity", "Analytics Technique": "Classification"})
    assert _q5(ns, [_q5_uc("D1", *DECIDES), one_off_setup, forecast, too_few]) == (
        ["D1", "D2", "D3"], {"D4": "Q5_T4_TOO_FEW_ITEMS:5<20"})


def test_t4_skips_informational_kinds(ns):
    uc = _q5_uc("I1", "Explain Margin Change by Driver", "Margin moved last quarter.", "Break margin into drivers.",
                "Decomposition of margin.", owner="", kind="driver_breakdown")
    decision = dict(uc, No="I2", **{"Use Case Kind": "risk_propensity"})
    assert _q5(ns, [uc, decision]) == (["I1"], {"I2": "Q5_T4_NO_OWNER"})


def test_t4_minimum_items_is_a_runtime_parameter_when_no_layout_sets_it(ns, rt):
    uc = dict(_q5_uc("D1", *DECIDES, kind="anomaly"), Solution="Rank the top 5 suppliers each week.")
    assert _q5(ns, [uc]) == ([], {"D1": "Q5_T4_TOO_FEW_ITEMS:5<20"})
    rt["decision_min_items_per_cycle"] = 5
    assert _q5(ns, [dict(uc)]) == (["D1"], {})


def test_d5_a_kind_whose_technique_it_does_not_allow_is_relabelled_to_the_technique_kind(ns):
    mismatched = _q5_uc("M1", *DECIDES, kind="forecast", **{"Analytics Technique": "Classification"})
    unmapped = _q5_uc("M2", *DECIDES, kind="forecast", **{"Analytics Technique": "Anomaly Detection"})
    matched = _q5_uc("M3", *DECIDES, kind="forecast", **{"Analytics Technique": "Forecasting"})
    inst = _inst(ns)
    kept, dropped = inst._phaseQ5_decision_readiness([mismatched, unmapped, matched], SCHEMA)
    assert [uc["No"] for uc in kept] == ["M1", "M2", "M3"] and dropped == []
    assert (mismatched["use_case_kind"], mismatched["kind_relabelled_from"]) == ("risk_propensity", "forecast")
    assert "Use Case Kind" not in mismatched
    assert "Q5_D5_KIND_TECHNIQUE_MISMATCH:forecast" in unmapped["gate_flags"] and unmapped["Use Case Kind"] == "forecast"
    assert matched["Use Case Kind"] == "forecast" and "kind_relabelled_from" not in matched
    assert _messages(inst, "[KIND-MATCH FIRED] 1 use case relabelled")


def test_d5_relabelling_applies_the_exclusion_of_the_new_kind(ns):
    uc = _q5_uc("M1", *DECIDES, kind="forecast", **{"Analytics Technique": "Classification"})
    parsed = {"use_case_kinds": {"asked": [], "excluded": ["risk_propensity"]}}
    assert _q5(ns, [uc], parsed=parsed) == ([], {"M1": "Q5_KIND_EXCLUDED:risk_propensity"})


def test_d5_keeps_the_kind_of_a_use_case_the_instructions_ask_for(ns):
    asked_kind = _q5_uc("M1", *DECIDES, kind="forecast", **{"Analytics Technique": "Classification"})
    asked_idea = _q5_uc("M2", *DECIDES, kind="forecast", user_request="R1", **{"Analytics Technique": "Classification"})
    other = _q5_uc("M3", *DECIDES, kind="anomaly", **{"Analytics Technique": "Classification"})
    _q5(ns, [asked_kind, asked_idea, other], parsed={"use_case_kinds": {"asked": ["Forecast"], "excluded": []}})
    assert (asked_kind["Use Case Kind"], asked_idea["Use Case Kind"], other["use_case_kind"]) == (
        "forecast", "forecast", "risk_propensity")


def _twin(no, title, kind, bob, **extra):
    return dict(_uc(no, bob, kind=kind, Name=title, Beneficiary="Procurement lead",
                    **{"Tables Involved": "main.ops.deliveries" if kind == "risk_propensity" else "main.ops.receipts"}), **extra)


def test_d6_decision_twins_of_different_kinds_collapse_to_the_higher_score(ns):
    inst = _inst(ns)
    risk = _twin("R1", "Predict Late Supplier Deliveries for Buyers", "risk_propensity", 8.0)
    forecast = _twin("F1", "Forecast Late Supplier Deliveries per Week", "forecast", 7.5)
    other = _twin("A1", "Detect Duplicate Invoice Payments", "anomaly", 7.0)
    kept = inst._dedup_canonical_titles([risk, forecast, other])
    assert [uc["No"] for uc in kept] == ["R1", "A1"]
    assert forecast["selection_drop_reason"] == 'duplicate decision of "Predict Late Supplier Deliveries for Buyers"'
    assert _messages(inst, "[KIND-TWIN FIRED] 1 use case of another kind")


def test_d6_keeps_twins_the_instructions_ask_for_and_twins_of_one_kind(ns):
    inst = _inst(ns)
    risk = _twin("R1", "Predict Late Supplier Deliveries for Buyers", "risk_propensity", 8.0)
    asked = _twin("F1", "Forecast Late Supplier Deliveries per Week", "forecast", 7.5, user_request="R1")
    same_kind = _twin("F2", "Forecast Late Supplier Deliveries per Week", "risk_propensity", 7.4,
                      **{"Analytics Technique": "Forecasting"})
    carrier = _twin("R2", "Predict Late Carrier Pickups for Buyers", "risk_propensity", 8.0)
    loser = _twin("F3", "Forecast Late Carrier Pickups per Week", "forecast", 7.3)
    kept = [uc["No"] for uc in inst._dedup_canonical_titles([risk, asked, same_kind, carrier, loser])]
    assert "F1" in kept and "R2" in kept and "F3" not in kept


def test_t1_the_scoring_listing_states_what_each_kind_must_hold_after_the_strip_test(ns):
    inst = _inst(ns)
    process = _uc("P1", 8.0, kind="process_mining")
    asked = _uc("P2", 8.0, kind="process_mining", user_request="R1")
    plain = _uc("C1", 8.0)
    listing = inst._build_use_cases_markdown_for_validation([process, asked, plain])
    sections = {block.split(" - ")[0]: block for block in listing.split("### Use Case: ")[1:]}
    must = "after the strip test it must still hold a process map with step durations and the cases that will breach"
    assert must in sections["P1"]
    assert must not in sections["P2"] and "Use Case Kind" not in sections["C1"]
    prompt = ns["PROMPT_TEMPLATES"]["BEST_OF_BEST_SCORING_PROMPT"]
    assert "score D9 0-2 if its design does not deliver that" in prompt


def test_the_kind_comes_from_the_stored_field_or_the_technique_when_no_kind_is_stated(ns):
    stored = _q5_uc("K1", *DECIDES, kind="forecast", **{"Solution": "Rank the top 5 suppliers for buyers to call."})
    stored["use_case_kind"] = stored.pop("Use Case Kind")
    stored["Analytics Technique"] = "Classification"
    by_technique = _q5_uc("K2", *DECIDES, **{"Solution": "Rank the top 5 suppliers for buyers to call."})
    by_technique.pop("Use Case Kind")
    forecast = _q5_uc("K3", *DECIDES, kind="forecast", **{"Solution": "Rank the top 5 suppliers for buyers to call."})
    forecast.pop("Use Case Kind")
    assert _q5(ns, [stored, by_technique, forecast]) == (
        ["K3"], {"K1": "Q5_T4_TOO_FEW_ITEMS:5<20", "K2": "Q5_T4_TOO_FEW_ITEMS:5<20"})
    assert (stored["use_case_kind"], stored["kind_relabelled_from"]) == ("risk_propensity", "forecast")


def test_a_family_named_by_its_label_excludes_every_kind_in_it(ns):
    inst = _inst(ns, parsed={"use_case_kinds": {"asked": [], "excluded": ["Detect and protect", "run processes"]}})
    assert inst._user_kind_directives() == ([], {"anomaly", "process_mining", "sla_aging"})
