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
    "families": [{"id": "predict", "label": "Predict"}, {"id": "run_processes", "label": "Run processes"},
                 {"id": "detect_protect", "label": "Detect and protect"}],
    "layouts": [],
    "technique_kind": {"Classification": "risk_propensity", "Forecasting": "forecast", "Process Mining": "process_mining"},
    "kinds": [
        {"id": "forecast", "num": 5, "family": "predict", "label": "Forecast", "informational": False,
         "techniques": ["Forecasting"]},
        {"id": "risk_propensity", "num": 6, "family": "predict", "label": "Risk and propensity", "informational": False,
         "techniques": ["Classification", "Predictive Modeling"]},
        {"id": "anomaly", "num": 23, "family": "detect_protect", "label": "Anomaly", "informational": False,
         "techniques": ["Anomaly Detection"]},
        {"id": "process_mining", "num": 34, "family": "run_processes", "label": "Process mining", "informational": False,
         "techniques": ["Process Mining"]},
        {"id": "sla_aging", "num": 35, "family": "run_processes", "label": "SLA and aging", "informational": False,
         "techniques": ["Survival Analysis"]},
    ],
}

TECHNIQUE_OF = {"risk_propensity": "Classification", "forecast": "Forecasting", "anomaly": "Anomaly Detection",
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
            "High Level Design": "Train a classification model on orders."}
    keep = dict(base, No="K1", Name="Predict Late Orders to Expedite Shipments", **{"Use Case Kind": "risk_propensity",
                                                                                   "Analytics Technique": "Classification"})
    drop = dict(base, No="X1", Name="Predict Late Orders to Expedite Shipments", **{"Use Case Kind": "process_mining",
                                                                                   "Analytics Technique": "Classification"})
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
