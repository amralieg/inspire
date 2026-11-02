"""v1.2.0 ELITE lane: the absolute bar and its contracts.

`_elite_decision` (pure), `_elite_composite`, the ultra_high_* runtime configuration and its
validation, `_final_rank_key` / `_finalize_portfolio_order`, the judge prompt registrations and the
ULTRA_HIGH_ELITE_JUDGE_PROMPT contract. Every failing condition of the bar is proven to exclude, a
clean assessment is proven to pass, and a near miss is proven to need an independent second opinion.
"""
import copy
import json
import os
import re
import string
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import load_agent_namespace  # noqa: E402

DIMS = ("business_value", "evidence_strength", "implementability", "actionability")


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def cfg(**over):
    base = {"ultra_high_min_dimension_score": 8, "ultra_high_near_miss_band": 1,
            "ultra_high_allowed_value_tiers": ["Transformational", "Material"]}
    base.update(over)
    return base


def assessment(**over):
    a = {"verdict": "ELITE", "red_team_verdict": "survives", "value_tier": "Material",
         "scores": {"business_value": 9, "evidence_strength": 8, "implementability": 8, "actionability": 9},
         "second_opinion": None}
    scores = over.pop("scores", None)
    a.update(over)
    if scores:
        a["scores"] = dict(a["scores"], **scores)
    return a


PASSED = {"passed": True, "failures": []}
FAILED = {"passed": False, "failures": ["table not found in the metadata: c.s.x"]}


def decide(ns, a, v=PASSED, c=None):
    return ns["DatabricksInspire"]._elite_decision(a, v, c or cfg())


# ---------------------------------------------------------------- _elite_decision: must include


def test_clean_assessment_is_elite(ns):
    assert decide(ns, assessment()) == ("ELITE", [])


def test_transformational_tier_and_all_tens_are_elite(ns):
    a = assessment(value_tier="transformational", scores={d: 10 for d in DIMS})
    assert decide(ns, a) == ("ELITE", [])


def test_decision_is_pure(ns):
    a = assessment(scores={"implementability": 7})
    before = copy.deepcopy(a)
    decide(ns, a)
    assert a == before


# ---------------------------------------------------------------- _elite_decision: each condition must exclude


@pytest.mark.parametrize("override, gate", [
    ({"verdict": "REJECT"}, "judge_verdict"),
    ({"red_team_verdict": "fatal"}, "red_team"),
    ({"value_tier": "Incremental"}, "value_tier"),
    ({"value_tier": "Marginal"}, "value_tier"),
    ({"value_tier": "Strategic"}, "value_tier"),
] + [({"scores": {d: 6}}, f"score:{d}") for d in DIMS])
def test_each_hard_failure_rejects(ns, override, gate):
    verdict, failed = decide(ns, assessment(**override))
    assert verdict == "REJECT"
    assert gate in failed


def test_failed_verification_rejects_even_with_perfect_scores(ns):
    verdict, failed = decide(ns, assessment(scores={d: 10 for d in DIMS}), FAILED)
    assert verdict == "REJECT" and failed == ["verification"]


def test_missing_or_boolean_scores_reject(ns):
    a = assessment()
    del a["scores"]["actionability"]
    assert decide(ns, a)[0] == "REJECT"
    assert decide(ns, assessment(scores={"business_value": True}))[0] == "REJECT"


@pytest.mark.parametrize("dim", DIMS)
def test_one_point_below_the_bar_is_a_near_miss(ns, dim):
    verdict, failed = decide(ns, assessment(scores={dim: 7}))
    assert verdict == "NEAR_MISS" and failed == [f"score:{dim}"]


def test_judge_near_miss_verdict_with_bar_scores_is_a_near_miss(ns):
    verdict, failed = decide(ns, assessment(verdict="NEAR_MISS"))
    assert verdict == "NEAR_MISS" and failed == ["judge_verdict"]


def test_judge_output_is_normalized_before_the_decision(ns):
    obj = ns["DatabricksInspire"].__new__(ns["DatabricksInspire"])
    item = {"No": "U1", "decision": "d", "kpi": "k", "value_tier": "material", "verdict": "near-miss",
            "red_team_verdict": "Survives", "scores": {"business_value": "9", "evidence_strength": 8.7,
                                                       "implementability": 8, "actionability": 10},
            "signal_columns": ["c.s.t.a", None, ""], "time_column": "null", "outcome_definition": "none",
            "fatal_flaws": [], "red_team_category": "residual risk",
            "runtime_assumptions": [{"kind": "key has repeated rows", "table": "c.s.t", "column": "c.s.t.k",
                                     "statement": "groups hold rows", "central": "true"}]}
    a = obj._normalize_elite_assessment(item)
    assert a["verdict"] == "NEAR_MISS" and a["red_team_verdict"] == "survives" and a["value_tier"] == "Material"
    assert a["scores"] == {"business_value": 9, "evidence_strength": 8, "implementability": 8, "actionability": 10}
    assert a["signal_columns"] == ["c.s.t.a"] and a["time_column"] is None and a["outcome_definition"] is None
    assert a["second_opinion"] is None and a["verification"] is None
    assert a["fatal_flaws"] == [] and a["red_team_category"] == "RESIDUAL_RISK"
    assert a["runtime_assumptions"] == [{"kind": "KEY_HAS_REPEATED_ROWS", "table": "c.s.t", "column": "c.s.t.k",
                                         "statement": "groups hold rows", "central": True}]


VALID_ITEM = {"No": "U1", "decision": "d", "kpi": "k", "value_tier": "Material", "verdict": "ELITE",
              "scores": {d: 9 for d in DIMS}, "fatal_flaws": [], "runtime_assumptions": [],
              "red_team_category": "RESIDUAL_RISK"}


def test_the_valid_base_item_normalizes(ns):
    obj = ns["DatabricksInspire"].__new__(ns["DatabricksInspire"])
    a = obj._normalize_elite_assessment(dict(VALID_ITEM))
    assert a is not None and a["red_team_verdict"] == "survives" and a["fatal_flaws"] == []


@pytest.mark.parametrize("broken", [
    {"scores": None},
    {"scores": {"business_value": 9, "evidence_strength": 8, "implementability": 8}},
    {"scores": {"business_value": 0, "evidence_strength": 8, "implementability": 8, "actionability": 8}},
    {"scores": {"business_value": 11, "evidence_strength": 8, "implementability": 8, "actionability": 8}},
    {"verdict": "MAYBE"},
    {"red_team_verdict": "unclear"},
    {"value_tier": ""},
    {"decision": ""},
    {"kpi": None},
    {"fatal_flaws": None},
    {"runtime_assumptions": None},
    {"red_team_category": None},
    {"red_team_category": "OPERATIONAL"},
    {"fatal_flaws": [{"category": "SOMETHING_ELSE", "explanation": "x"}]},
    {"fatal_flaws": [{"category": "NO_DECISION_CHANGED", "explanation": ""}]},
    {"runtime_assumptions": [{"kind": "ROWS_LOOK_FINE", "table": "c.s.t", "column": "c.s.t.k"}]},
    {"runtime_assumptions": [{"kind": "COLUMN_HAS_VALUES", "table": "", "column": "c.s.t.k"}]},
])
def test_incomplete_judge_items_are_invalid_never_defaulted(ns, broken):
    obj = ns["DatabricksInspire"].__new__(ns["DatabricksInspire"])
    item = dict(VALID_ITEM)
    item.update(broken)
    problems = []
    assert obj._normalize_elite_assessment(item, problems) is None
    assert len(problems) == 1


def test_band_zero_makes_one_point_below_a_reject(ns):
    assert decide(ns, assessment(scores={"implementability": 7}), c=cfg(ultra_high_near_miss_band=0))[0] == "REJECT"


def test_near_miss_band_is_configurable(ns):
    a = assessment(scores={"actionability": 6})
    assert decide(ns, a)[0] == "REJECT"
    assert decide(ns, a, c=cfg(ultra_high_near_miss_band=2))[0] == "NEAR_MISS"


def test_bar_and_allowed_tiers_come_from_config(ns):
    assert decide(ns, assessment(), c=cfg(ultra_high_min_dimension_score=9))[0] == "NEAR_MISS"
    assert decide(ns, assessment(), c=cfg(ultra_high_allowed_value_tiers=["Transformational"]))[0] == "REJECT"


def test_near_miss_with_a_hard_failure_is_still_rejected(ns):
    verdict, failed = decide(ns, assessment(scores={"implementability": 7}, red_team_verdict="fatal"))
    assert verdict == "REJECT" and {"red_team", "score:implementability"} <= set(failed)


# ---------------------------------------------------------------- second opinion


def second(**over):
    s = assessment(**over)
    s.setdefault("verification", dict(PASSED))
    return s


def test_near_miss_without_second_opinion_never_passes(ns):
    assert decide(ns, assessment(scores={"implementability": 7}))[0] == "NEAR_MISS"


def test_second_opinion_promotes_only_when_the_averaged_scores_clear_the_bar(ns):
    a = assessment(verdict="NEAR_MISS", scores={"implementability": 7}, second_opinion=second(scores={"implementability": 9}))
    assert decide(ns, a) == ("ELITE", [])


def test_a_first_elite_verdict_with_a_sub_bar_score_gets_no_shortcut(ns):
    a = assessment(scores={"implementability": 7}, second_opinion=second())
    verdict, failed = decide(ns, a)
    assert verdict == "NEAR_MISS" and failed == ["score:implementability", "second_opinion_average_below_bar"]


def test_averaged_scores_clearing_the_bar_promote(ns):
    a = assessment(verdict="NEAR_MISS", second_opinion=second(scores={"evidence_strength": 9}))
    assert decide(ns, a) == ("ELITE", [])


def test_second_opinion_near_miss_with_averaged_scores_below_bar_stays_out(ns):
    a = assessment(scores={"implementability": 7},
                   second_opinion=second(verdict="NEAR_MISS", scores={"implementability": 7}))
    verdict, failed = decide(ns, a)
    assert verdict == "NEAR_MISS" and failed[-1] == "second_opinion_average_below_bar"


def test_second_opinion_reject_stays_out(ns):
    a = assessment(scores={"implementability": 7}, second_opinion=second(verdict="REJECT"))
    verdict, failed = decide(ns, a)
    assert verdict == "NEAR_MISS" and failed[-1] == "second_opinion_reject"


def test_second_opinion_with_failed_verification_cannot_promote(ns):
    so = second()
    so["verification"] = dict(FAILED)
    a = assessment(scores={"implementability": 7}, second_opinion=so)
    assert decide(ns, a)[0] == "NEAR_MISS"


def test_second_opinion_never_rescues_a_first_opinion_reject(ns):
    a = assessment(red_team_verdict="fatal", second_opinion=second(scores={d: 10 for d in DIMS}))
    assert decide(ns, a)[0] == "REJECT"


# ---------------------------------------------------------------- composite score


def test_composite_is_the_configured_weighted_sum(ns):
    weights = ns["TECHNICAL_CONTEXT"]["runtime"]["ultra_high_score_weights"]
    a = assessment(scores={"business_value": 10, "evidence_strength": 8, "implementability": 6, "actionability": 4})
    assert ns["DatabricksInspire"]._elite_composite(a, weights) == round(0.4 * 10 + 0.25 * 8 + 0.2 * 6 + 0.15 * 4, 2)


def test_composite_averages_a_second_opinion(ns):
    weights = {"business_value": 0.25, "evidence_strength": 0.25, "implementability": 0.25, "actionability": 0.25}
    a = assessment(scores={d: 8 for d in DIMS}, second_opinion=second(scores={d: 10 for d in DIMS}))
    assert ns["DatabricksInspire"]._elite_composite(a, weights) == 9.0


def test_composite_is_none_without_complete_scores(ns):
    a = assessment()
    del a["scores"]["business_value"]
    assert ns["DatabricksInspire"]._elite_composite(a, {d: 0.25 for d in DIMS}) is None


# ---------------------------------------------------------------- configuration


def test_ultra_high_defaults(ns):
    rt = ns["TECHNICAL_CONTEXT"]["runtime"]
    assert rt["ultra_high_second_look_min_value"] == 8.0
    assert rt["ultra_high_second_look_max"] == 25
    assert rt["ultra_high_bob_prescreen_min"] == 5.0
    assert rt["ultra_high_judge_batch_size"] == 5
    assert rt["ultra_high_min_dimension_score"] == 8
    assert rt["ultra_high_near_miss_band"] == 1
    assert rt["ultra_high_allowed_value_tiers"] == ["Transformational", "Material"]
    assert rt["ultra_high_score_weights"] == {"business_value": 0.40, "evidence_strength": 0.25,
                                              "implementability": 0.20, "actionability": 0.15}
    assert tuple(ns["ULTRA_HIGH_DIMENSIONS"]) == DIMS
    assert set(rt["ultra_high_allowed_value_tiers"]) <= set(ns["ULTRA_HIGH_VALUE_TIERS"])


@pytest.mark.parametrize("key, bad, exc", [
    ("ultra_high_second_look_min_value", 11.0, ValueError),
    ("ultra_high_second_look_min_value", True, TypeError),
    ("ultra_high_second_look_max", -1, ValueError),
    ("ultra_high_second_look_max", 2.5, TypeError),
    ("ultra_high_bob_prescreen_min", -0.5, ValueError),
    ("ultra_high_judge_batch_size", 0, ValueError),
    ("ultra_high_judge_batch_size", 26, ValueError),
    ("ultra_high_judge_batch_size", True, TypeError),
    ("ultra_high_min_dimension_score", 11, ValueError),
    ("ultra_high_min_dimension_score", 8.5, TypeError),
    ("ultra_high_near_miss_band", 4, ValueError),
    ("ultra_high_allowed_value_tiers", [], ValueError),
    ("ultra_high_allowed_value_tiers", "Material", ValueError),
    ("ultra_high_allowed_value_tiers", ["Material", "Strategic"], ValueError),
    ("ultra_high_allowed_value_tiers", ["Material", "Material"], ValueError),
    ("ultra_high_score_weights", {"business_value": 1.0}, ValueError),
    ("ultra_high_score_weights", {"business_value": 0.5, "evidence_strength": 0.25, "implementability": 0.2,
                                  "actionability": 0.15}, ValueError),
    ("ultra_high_score_weights", {"business_value": 1.2, "evidence_strength": -0.2, "implementability": 0.0,
                                  "actionability": 0.0}, ValueError),
])
def test_runtime_validation_rejects_bad_ultra_high_values(fresh_ns, key, bad, exc):
    fresh_ns["TECHNICAL_CONTEXT"]["runtime"][key] = bad
    with pytest.raises(exc):
        fresh_ns["_validate_runtime_config"]()


def test_runtime_validation_requires_every_ultra_high_key(fresh_ns):
    del fresh_ns["TECHNICAL_CONTEXT"]["runtime"]["ultra_high_judge_batch_size"]
    with pytest.raises(ValueError):
        fresh_ns["_validate_runtime_config"]()


def test_runtime_validation_accepts_a_valid_override(fresh_ns):
    rt = fresh_ns["TECHNICAL_CONTEXT"]["runtime"]
    rt["ultra_high_allowed_value_tiers"] = ["Transformational"]
    rt["ultra_high_score_weights"] = {d: 0.25 for d in DIMS}
    rt["ultra_high_near_miss_band"] = 0
    fresh_ns["_validate_runtime_config"]()


# ---------------------------------------------------------------- final rank and renumbering


def ranked_uc(no, domain="Sales", **extra):
    uc = {"No": no, "Name": no, "Business Domain": domain}
    uc.update(extra)
    return uc


def test_final_rank_key_contract(ns):
    key = ns["DatabricksInspire"]._final_rank_key
    elite = ranked_uc("A", elite_status="ELITE", elite_score=8.4, bob_score=7.0, Priority=8.0)
    assert key(elite) == (0, 0, -8.4, 0, -7.0, 0, -8.0, "A")
    pick = ranked_uc("B", elite_status="DOMAIN_COVERAGE_PICK", elite_score=9.9)
    assert key(pick)[0] == 1
    plain = ranked_uc("C", **{"Inspire Score": 7.5})
    assert key(plain) == (0, 0, -7.5, 1, 0.0, 1, 0.0, "C")
    empty = ranked_uc("D", elite_score=None, **{"Inspire Score": None})
    assert key(empty) == (0, 1, 0.0, 1, 0.0, 1, 0.0, "D")
    assert key(empty) > key(ranked_uc("D", **{"Inspire Score": 0.0}))


def test_final_rank_orders_elites_before_coverage_picks_then_by_score_then_tie_breaks(ns):
    key = ns["DatabricksInspire"]._final_rank_key
    ucs = [ranked_uc("P", elite_status="DOMAIN_COVERAGE_PICK", elite_score=9.9),
           ranked_uc("E2", elite_status="ELITE", elite_score=8.5, bob_score=7.0),
           ranked_uc("E1", elite_status="ELITE", elite_score=8.5, bob_score=8.0),
           ranked_uc("E3", elite_status="ELITE", elite_score=9.0)]
    assert [u["No"] for u in sorted(ucs, key=key)] == ["E3", "E1", "E2", "P"]


def test_finalize_orders_domains_by_best_member_and_renumbers(ns):
    obj = ns["DatabricksInspire"].__new__(ns["DatabricksInspire"])
    ucs = [ranked_uc("a", "Ops", elite_status="ELITE", elite_score=8.1),
           ranked_uc("b", "Sales", elite_status="ELITE", elite_score=8.9),
           ranked_uc("c", "Ops", elite_status="ELITE", elite_score=9.4),
           ranked_uc("d", "Sales", elite_status="DOMAIN_COVERAGE_PICK", elite_score=9.9),
           ranked_uc("e", "", elite_status="ELITE", elite_score=8.0)]
    out = obj._finalize_portfolio_order(ucs)
    assert [(u["Name"], u["No"]) for u in out] == [("c", "N01-U01"), ("a", "N01-U02"), ("b", "N02-U01"),
                                                    ("d", "N02-U02"), ("e", "N03-U01")]


def test_finalize_handles_empty_input(ns):
    obj = ns["DatabricksInspire"].__new__(ns["DatabricksInspire"])
    assert obj._finalize_portfolio_order([]) == []


# ---------------------------------------------------------------- registrations


JUDGE = "ULTRA_HIGH_ELITE_JUDGE_PROMPT"


def test_judge_prompt_registered_as_thinker_large_low_temperature(ns):
    entries = [pm for pm in ns["TECHNICAL_CONTEXT"]["prompts_models"] if pm["prompt_name"] == JUDGE]
    assert len(entries) == 1
    pm = entries[0]
    assert (pm["model_type"], pm["model_size"], pm["temperature"]) == ("thinker", "large", 0.0)
    assert (pm["stage_name"], pm["step_name"]) == ("Use Case Prioritization", "Elite Selection")
    assert ns["PROMPT_TRACKING_CONFIG"][JUDGE]["step_name"] == "Elite Selection"
    assert ns["get_model_cascade_for_prompt"](JUDGE)[0]["type"] == "thinker"


def test_judge_story_titles_progress_and_interpreter_registration(ns):
    assert ns["PROMPT_STORY_TITLES"][JUDGE] == ("Use Case Prioritization", "Elite Selection")
    assert ns["PROMPT_STORY_STARTED_MESSAGES"][JUDGE] == "Inspire has started the Ultra High elite selection"
    assert JUDGE in ns["MULTI_ENTITY_PROGRESS_PROMPTS"]
    assert ns["GENERATION_DIRECTIVE_CATEGORIES_BY_PROMPT"][JUDGE] == \
        ns["GENERATION_DIRECTIVE_CATEGORIES_BY_PROMPT"]["BEST_OF_BEST_SCORING_PROMPT"]
    interpreter = ns["PROMPT_TEMPLATES"]["GENERAL_INSTRUCTION_INTERPRETER_PROMPT"]
    assert interpreter.count(f'"{JUDGE}"') == 2 and f"| `{JUDGE}` |" in interpreter


def test_judge_prompt_is_inserted_immediately_before_bob(ns):
    keys = list(ns["PROMPT_TEMPLATES"])
    assert keys.index(JUDGE) + 1 == keys.index("BEST_OF_BEST_SCORING_PROMPT")


# ---------------------------------------------------------------- the judge prompt


def _fields(template):
    return {f.split(".")[0].split("[")[0] for _, f, _, _ in string.Formatter().parse(template) if f}


def _render(ns):
    template = ns["PROMPT_TEMPLATES"][JUDGE]
    values = {name: "<%s>" % name for name in _fields(template)}
    values.update(min_dimension_score=8, near_miss_band=1, allowed_value_tiers='"Transformational" or "Material"')
    return template.format(**values)


def test_judge_prompt_is_absolute_and_never_a_curve(ns):
    text = _render(ns)
    for needle in ("There is no quota, no curve, no ranking within the batch and no default score",
                   "Every use case in the batch may be ELITE, or none may be",
                   "Missing evidence means a lower score, never a middle score",
                   "re-judge every use case from the evidence"):
        assert needle in text, needle
    for banned in ("Spread scores", "DISTRIBUTION", "DEFAULT IS", "~20%", "top 10", "at most 20"):
        assert banned not in text, banned
    for dim in DIMS:
        section = text[text.index(f"**{dim}**"):]
        for anchor in ("- 9-10:", "- 7-8:", "- 5-6:", "- 3-4:", "- 1-2:"):
            assert anchor in section[:1500], (dim, anchor)


def test_judge_prompt_requires_every_assessment_field_and_metadata_only_evidence(ns):
    text = _render(ns)
    for field in ("decision", "decision_owner", "cadence", "kpi", "kpi_direction", "value_driver", "value_tier",
                  "signal_columns", "outcome_definition", "label_timing", "time_column", "entity_key_column", "join_path",
                  "build_path", "blockers", "runtime_assumptions", "fatal_flaws", "red_team", "red_team_category",
                  "verdict_reason"):
        assert f"`{field}`" in text, field
    for category in ns["ULTRA_HIGH_FATAL_FLAW_CATEGORIES"] + (ns["ULTRA_HIGH_RESIDUAL_RISK"],):
        assert f'"{category}"' in text, category
    for kind in ns["INSPIRE_ASSUMPTION_RULES"]:
        assert f'"{kind}"' in text, kind
    assert '`red_team_verdict` is derived by Inspire from `fatal_flaws`' in text and "do not return it" in text
    assert "strongest reason this use case fails or becomes shelfware" in text
    assert "No data values are available" in text
    assert "Never state money amounts, percentages or multipliers" in text
    assert "only from the use case's own Tables Involved" in text
    for tier in ns["ULTRA_HIGH_VALUE_TIERS"]:
        assert f'"{tier}"' in text, tier
    assert 'every dimension scores at least 8, `value_tier` is "Transformational" or "Material"' in text


def test_judge_prompt_example_parses_into_a_valid_assessment(ns):
    text = _render(ns)
    block = re.search(r"```json\s*\n(.*?)\n```", text, re.DOTALL).group(1)
    example = json.loads(block)
    assert isinstance(example, list) and len(example) == 1
    obj = ns["DatabricksInspire"].__new__(ns["DatabricksInspire"])
    normalized = obj._normalize_elite_assessment(example[0])
    assert normalized is not None
    assert set(normalized["scores"]) == set(DIMS)
    assert normalized["verdict"] in ("ELITE", "NEAR_MISS", "REJECT")


def test_judge_prompt_is_industry_agnostic_and_never_asks_for_row_data(ns):
    text = ns["PROMPT_TEMPLATES"][JUDGE].lower()
    for word in ("retail", "bank", "airline", "hospital", "patient", "insurance", "telecom", "bakery", "loan",
                 "sku", "churn", "fraud", "claims", "subscriber", "store"):
        assert not re.search(r"\b%s\b" % word, text), word
    assert ns["audit_prompts_for_data_access_leak"]({JUDGE: ns["PROMPT_TEMPLATES"][JUDGE]}) == []


def test_judge_prompt_gets_the_user_directive_preamble_once(ns):
    agent = ns["AIAgent"].__new__(ns["AIAgent"])
    agent.prompt_templates = ns["PROMPT_TEMPLATES"]
    import logging
    agent.logger = logging.getLogger("v120_elite_prompt")
    values = {name: "<%s>" % name for name in _fields(ns["PROMPT_TEMPLATES"][JUDGE])}
    rendered = agent._load_and_format_prompt(JUDGE, values)
    pre = ns["USER_DIRECTIVE_SUPREMACY_PREAMBLE"]
    assert rendered.startswith(pre) and rendered.count(pre) == 1
