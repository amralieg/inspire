import ast
import json

import pytest

from _agentload import method_node
from v120_artifacts_support import make_inspire


def _parsed(count=None, requests=None):
    return {"use_case_count": count, "use_case_requests": list(requests or []), "per_prompt_instructions": {},
            "interpretation_status": "ok"}


def _inspire(agent_ns, count=None, requests=None, domains=(), **attrs):
    inst = make_inspire(agent_ns, parsed_generation_instructions=_parsed(count, requests),
                        user_business_domains=list(domains), **attrs)
    inst._emit_pipeline_status = lambda **_kw: None
    return inst


def _ucs(n, themes=12, domains=("Sales", "Operations", "Finance"), technique="Classification"):
    return [{"No": f"U{i:03d}", "Name": f"Use case {i}", "Business Domain": domains[i % len(domains)],
             "Analytics Technique": technique, "Quality": "High", "scoring_status": "scored",
             "Inspire Score": round(9.0 - i * 0.01, 3), "Priority": 7.0, "theme_seed": f"Theme {i % themes}"}
            for i in range(n)]


def _fake_bob(inst):
    def score(use_cases, _schema, **_kw):
        for index, uc in enumerate(use_cases):
            uc["bob_status"] = "scored"
            uc["bob_score"] = round(9.5 - index * 0.05, 3)
            uc["bob_hard_veto_gate"] = None
            uc["idea_theme"] = uc["theme_seed"]
        inst.bob_calls = getattr(inst, "bob_calls", 0) + 1
        return use_cases
    inst._score_best_of_best = score
    return inst


def _messages(inst, level=None):
    return [msg for lvl, msg in inst.logger.records if level is None or lvl == level]


@pytest.mark.parametrize("value,expected", [
    ({"count": 30, "mode": "about", "scope": "catalog"}, (30, "about", "catalog", 24, 36)),
    ({"count": 7, "mode": "about"}, (7, "about", "catalog", 6, 8)),
    ({"count": "12", "mode": "exactly"}, (12, "exactly", "catalog", 12, 12)),
    ({"count": 40.0, "mode": "at most"}, (40, "at_most", "catalog", 0, 40)),
    ({"count": 50, "mode": "at-least"}, (50, "at_least", "catalog", 50, None)),
    ({"count": 25, "mode": "exactly", "scope": "per domain"}, (25, "exactly", "per_domain", 25, 25)),
    ({"count": 30}, (30, "about", "catalog", 24, 36)),
])
def test_the_count_parser_reads_the_number_the_mode_and_the_bounds(agent_ns, value, expected):
    parsed = agent_ns["parse_use_case_count"](value)
    assert (parsed["count"], parsed["mode"], parsed["scope"], parsed["low"], parsed["high"]) == expected


@pytest.mark.parametrize("value", [None, "", {}])
def test_no_count_means_no_user_count(agent_ns, value):
    assert agent_ns["parse_use_case_count"](value) is None


@pytest.mark.parametrize("value", [{"count": 0}, {"count": -3}, {"count": "thirty"}, {"count": True}, {"count": 10001},
                                   {"count": 2.5}, {"count": 30, "mode": "roughly"}, {"count": 30, "scope": "team"}, 30,
                                   "about 30"])
def test_the_count_parser_refuses_anything_else(agent_ns, value):
    with pytest.raises(ValueError):
        agent_ns["parse_use_case_count"](value)


def test_an_unusable_count_warns_once_and_no_user_count_applies(agent_ns):
    inst = _inspire(agent_ns, count={"count": "lots"})
    assert inst._user_use_case_count() is None and inst._user_use_case_count() is None
    assert len([m for m in _messages(inst, "WARNING") if "[USE-CASE-COUNT]" in m]) == 1


def test_the_user_count_is_the_trim_target_with_no_random_padding(agent_ns):
    rt = {"target_max_use_cases": 90, "target_max_jitter": 20}
    for sid in range(1000, 1030):
        assert _inspire(agent_ns, {"count": 30, "mode": "about"}, session_id=sid)._trim_target(rt) == 30
        assert _inspire(agent_ns, {"count": 12, "mode": "exactly"}, session_id=sid)._trim_target(rt) == 12
        assert _inspire(agent_ns, {"count": 40, "mode": "at_most"}, session_id=sid)._trim_target(rt) == 40
        assert _inspire(agent_ns, {"count": 150, "mode": "at_least"}, session_id=sid)._trim_target(rt) == 150
        assert 91 <= _inspire(agent_ns, {"count": 50, "mode": "at_least"}, session_id=sid)._trim_target(rt) <= 110
        assert 91 <= _inspire(agent_ns, session_id=sid)._trim_target(rt) <= 110


def test_about_30_ships_30_of_89_and_logs_the_count_and_the_target(agent_ns):
    inst = _fake_bob(_inspire(agent_ns, {"count": 30, "mode": "about", "scope": "catalog"}))
    out = inst._apply_best_of_best_selection(_ucs(89), [], {})
    assert len(out) == 30
    lines = [m for m in _messages(inst) if m.startswith("[USE-CASE-COUNT FIRED]")]
    assert lines and "about 30 use cases (24 to 36) in the catalog" in lines[0] and "the trim target is 30 use cases" in lines[0]


def test_a_count_below_the_best_of_best_minimum_still_cuts_to_the_count(agent_ns):
    inst = _fake_bob(_inspire(agent_ns, {"count": 10, "mode": "exactly"}))
    out = inst._apply_best_of_best_selection(_ucs(18, themes=6), [], {})
    assert len(out) == 10 and inst.bob_calls == 1


def test_a_count_inside_the_about_range_is_never_cut(agent_ns):
    inst = _fake_bob(_inspire(agent_ns, {"count": 30, "mode": "about"}))
    assert len(inst._apply_best_of_best_selection(_ucs(34), [], {})) == 34


def test_the_theme_cap_never_cuts_below_the_user_count(agent_ns):
    inst = _fake_bob(_inspire(agent_ns, {"count": 30, "mode": "exactly"}))
    out = inst._apply_best_of_best_selection(_ucs(60, themes=2), [], {})
    assert len(out) == 30


def test_at_least_keeps_the_user_floor_through_the_built_in_trim(agent_ns):
    inst = _fake_bob(_inspire(agent_ns, {"count": 120, "mode": "at_least"}))
    out = inst._apply_best_of_best_selection(_ucs(140, themes=3), [], {})
    assert len(out) == 120


def test_per_domain_counts_cut_each_domain_to_its_own_count(agent_ns):
    inst = _fake_bob(_inspire(agent_ns, {"count": 5, "mode": "exactly", "scope": "per_domain"}))
    out = inst._apply_best_of_best_selection(_ucs(30, domains=("Sales", "Operations", "Finance")), [], {})
    sizes = {}
    for uc in out:
        sizes[uc["Business Domain"]] = sizes.get(uc["Business Domain"], 0) + 1
    assert sizes == {"Sales": 5, "Operations": 5, "Finance": 5}


def test_requested_use_cases_and_user_domains_are_never_trimmed_away_to_meet_the_count(agent_ns):
    requests = [{"id": "R1", "ask": "forecasting use cases", "minimum": 3}]
    inst = _fake_bob(_inspire(agent_ns, {"count": 30, "mode": "exactly"}, requests, domains=["Legal"]))
    ucs = _ucs(89)
    for uc in ucs[-5:]:
        uc["user_request"] = "R1"
    ucs[-6]["Business Domain"] = "Legal"
    out = inst._apply_best_of_best_selection(ucs, [], {})
    ids = {uc["No"] for uc in out}
    assert len(out) == 30
    assert sum(1 for uc in out if uc.get("user_request") == "R1") == 3, "the minimum is kept, the other requested ones compete"
    assert ucs[-6]["No"] in ids, "the user domain keeps its only use case"


def _select(agent_ns, count, ucs, domains=(), mode="Good"):
    inst = _fake_bob(_inspire(agent_ns, count, domains=domains, use_cases_quality=mode))
    inst.quality_filter_acceptable = {"High", "Very High"}
    return inst, inst._select_scored_use_cases(ucs, [], {})


def test_the_final_count_check_cuts_what_coverage_picks_add_and_keeps_the_picks(agent_ns):
    ucs = _ucs(12, domains=("Sales",))
    ucs[0].update({"Business Domain": "Legal", "Quality": "Low"})
    inst, (selected, rejected) = _select(agent_ns, {"count": 5, "mode": "exactly"}, ucs, domains=["Legal"])
    assert len(selected) == 5
    assert ucs[0] in selected and ucs[0]["elite_status"] == "DOMAIN_COVERAGE_PICK"
    cut = [uc for uc in rejected if str(uc.get("selection_drop_reason", "")).startswith("outside the exactly 5 use cases")]
    assert cut, "a use case over the count says why it left"
    assert {"stage": "user_count", "in": 6, "out": 5, "drops": {"user_count": 1}} in inst.funnel_ledger


def test_the_final_count_check_bounds_ultra_high_which_has_no_cap_of_its_own(agent_ns):
    ucs = _ucs(10, domains=("Sales",))
    inst = _inspire(agent_ns, {"count": 4, "mode": "at_most"}, use_cases_quality="Ultra High")
    inst._select_elite_use_cases = lambda candidates, *_a: (list(candidates), list(candidates))
    selected, rejected = inst._select_scored_use_cases(ucs, [], {})
    assert len(selected) == 4 and len(rejected) == 6
    assert [uc["No"] for uc in selected] == ["U000", "U001", "U002", "U003"]


def test_with_no_user_count_selection_is_unchanged(agent_ns):
    inst, (selected, _rejected) = _select(agent_ns, None, _ucs(12, domains=("Sales",)))
    assert len(selected) == 12 and not any(s["stage"] == "user_count" for s in inst.funnel_ledger)


def test_user_domains_that_outnumber_an_exact_count_are_all_kept_and_the_excess_is_a_warning(agent_ns):
    domains = ["Sales", "Operations", "Finance", "Legal"]
    ucs = _ucs(12, domains=tuple(domains))
    inst, (selected, _rejected) = _select(agent_ns, {"count": 2, "mode": "exactly"}, ucs, domains=domains)
    assert sorted({uc["Business Domain"] for uc in selected}) == sorted(domains) and len(selected) == 4
    warned = [m for m in _messages(inst, "WARNING") if m.startswith("[USE-CASE-COUNT FIRED]")]
    assert len(warned) == 1 and "more use cases than asked are kept" in warned[0] and "never pads" not in warned[0]
    inst, (selected, _rejected) = _select(agent_ns, {"count": 4, "mode": "exactly"}, _ucs(12, domains=tuple(domains)), domains=domains)
    assert len(selected) == 4 and not [m for m in _messages(inst, "WARNING") if m.startswith("[USE-CASE-COUNT FIRED]")]


def test_a_shortfall_is_logged_and_never_padded(agent_ns):
    inst, (selected, _rejected) = _select(agent_ns, {"count": 30, "mode": "about"}, _ucs(12, domains=("Sales",)))
    assert len(selected) == 12
    assert any("never pads" in m for m in _messages(inst, "WARNING"))


def test_the_interpreter_asks_for_the_count_and_the_requests_and_defaults_to_none(agent_ns):
    prompt = agent_ns["PROMPT_TEMPLATES"]["GENERAL_INSTRUCTION_INTERPRETER_PROMPT"]
    assert "**9. Use Case Count**" in prompt and "**10. Requested Use Cases**" in prompt
    assert '"use_case_count": null' in prompt and '"use_case_requests": []' in prompt
    inst = make_inspire(agent_ns, user_generation_instructions="")
    result = inst._interpret_generation_instructions()
    assert result["use_case_count"] is None and result["use_case_requests"] == []


def test_the_interpreter_keeps_a_count_only_answer_as_parsed(agent_ns):
    class Agent:
        def run_worker(self, **_kw):
            return json.dumps({"use_case_count": {"count": 30, "mode": "about", "scope": "catalog"},
                               "use_case_requests": [{"id": "R1", "ask": "forecasting use cases", "minimum": 3}],
                               "per_prompt_instructions": {}})
    inst = make_inspire(agent_ns, user_generation_instructions="target about 30 use cases, at least 3 forecasting",
                        ai_agent=Agent())
    parsed = inst._interpret_generation_instructions()
    assert parsed["interpretation_status"] == "ok"
    assert inst._user_use_case_count()["count"] == 30
    assert inst._user_use_case_requests() == {"R1": {"id": "R1", "ask": "forecasting use cases", "minimum": 3, "name": ""}}


def test_requests_get_ids_and_a_minimum_of_one_when_none_is_stated(agent_ns):
    inst = _inspire(agent_ns, requests=[{"ask": "a churn model"}, {"id": "R1", "ask": "  fraud   detection ", "minimum": "2"},
                                        {"id": "x", "ask": "pricing", "minimum": 0}, {"ask": ""}, "forecasts"])
    assert inst._user_use_case_requests() == {"R1": {"id": "R1", "ask": "a churn model", "minimum": 1, "name": ""},
                                              "R2": {"id": "R2", "ask": "fraud detection", "minimum": 2, "name": ""},
                                              "R3": {"id": "R3", "ask": "pricing", "minimum": 1, "name": ""}}


def test_the_scorer_sees_the_requests_and_only_a_known_request_id_is_kept(agent_ns):
    requests = [{"id": "R1", "ask": "forecasting use cases", "minimum": 3}]
    inst = _inspire(agent_ns, requests=requests)
    section = inst._get_generation_instruction_for_prompt("COMBINED_VALUE_QUALITY_SCORE_PROMPT")
    assert "REQUESTED USE CASES R1: forecasting use cases (at least 3)" in section
    assert '"user_request": ""' in agent_ns["PROMPT_TEMPLATES"]["COMBINED_VALUE_QUALITY_SCORE_PROMPT"]
    item = {"quality_label": "High", "quality_score": 4.0, "priority_score": 7.0}
    raw = json.dumps([dict(item, use_case_id="A", user_request="r1"), dict(item, use_case_id="B", user_request="R9"),
                      dict(item, use_case_id="C")])
    scores = inst._parse_combined_score_response(raw, [{"No": "A"}, {"No": "B"}, {"No": "C"}])
    assert [scores[k]["user_request"] for k in "ABC"] == ["R1", "", ""]
    uc = {"No": "A", "user_request": "stale"}
    agent_ns["DatabricksInspire"]._apply_combined_score(uc, scores["A"])
    assert uc["user_request"] == "R1"
    agent_ns["DatabricksInspire"]._apply_combined_score(uc, scores["B"])
    assert "user_request" not in uc


def test_one_tagger_names_the_requests_and_the_interpreter_no_longer_routes_them_to_the_signal_check(agent_ns):
    interpreter = agent_ns["PROMPT_TEMPLATES"]["GENERAL_INSTRUCTION_INTERPRETER_PROMPT"]
    assert "user_requested" not in interpreter
    categories = agent_ns["GENERATION_DIRECTIVE_CATEGORIES_BY_PROMPT"]
    assert [name for name, keys in categories.items() if "use_case_requests" in keys] == ["COMBINED_VALUE_QUALITY_SCORE_PROMPT"]


def test_the_best_of_best_prompt_names_the_same_trim_target(agent_ns):
    src = ast.unparse(method_node("DatabricksInspire", "_score_best_of_best"))
    assert "self._trim_target(rt)" in src and 'rt["target_max_use_cases"]' not in src and "rt['target_max_use_cases']" not in src
