import os
import string
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import load_agent_namespace

BASELINE_RENDERED_CHARS = {"BASE+HIGH": 91994, "COMBINED": 34821}


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def _fields(template):
    return {f.split(".")[0].split("[")[0] for _, f, _, _ in string.Formatter().parse(template) if f}


def _render(template, extra=None):
    values = {name: "<%s>" % name for name in _fields(template)}
    values.update(extra or {})
    return template.format(**values)


def _scoring_prompts(ns):
    pt = ns["PROMPT_TEMPLATES"]
    return {
        "COMBINED": _render(pt["COMBINED_VALUE_QUALITY_SCORE_PROMPT"]),
        "BOB": _render(pt["BEST_OF_BEST_SCORING_PROMPT"]),
    }


def _base_with_gate(ns):
    pt = ns["PROMPT_TEMPLATES"]
    return _render(pt["BASE_USE_CASE_GEN_PROMPT"], {"quality_gate_block": ns["QUALITY_GATE_HIGH"]})


FORCED_DISTRIBUTION_PHRASES = (
    "DISTRIBUTION EXPECTATION",
    "DISTRIBUTION CHECK",
    "~20% below 3.0",
    "only ~15% at 4.0+",
    "<5% of use cases",
    "rare <5%",
    "If your scores skew higher, you are being lenient",
)

DEFAULT_GRAVITY_PHRASES = (
    "DEFAULT IS 3.0",
    "The DEFAULT score is 3.0",
    "default starting point",
    "resist the urge to give 4.0+",
    "it IS 3.0",
)


@pytest.mark.parametrize("phrase", FORCED_DISTRIBUTION_PHRASES)
def test_no_forced_distribution_in_any_scoring_prompt(ns, phrase):
    for name, text in _scoring_prompts(ns).items():
        assert phrase not in text, (name, phrase)
    assert phrase not in ns["QUALITY_GATE_SCORING_BLOCK"]


@pytest.mark.parametrize("phrase", DEFAULT_GRAVITY_PHRASES)
def test_no_default_score_gravity(ns, phrase):
    for name, text in _scoring_prompts(ns).items():
        assert phrase not in text, (name, phrase)


def test_scoring_block_states_absolute_per_use_case_calibration(ns):
    block = ns["QUALITY_GATE_SCORING_BLOCK"]
    assert "on its own merits" in block
    assert "It is valid for every use case in a batch, or for none, to score high." in block
    assert "no default score" in block
    assert "highest anchor whose evidence is fully present" in block


def test_the_quality_scorer_uses_the_shared_block_once(ns):
    block = ns["QUALITY_GATE_SCORING_BLOCK"].strip()
    assert _scoring_prompts(ns)["COMBINED"].count(block) == 1


def test_bob_has_no_forced_spread(ns):
    bob = _scoring_prompts(ns)["BOB"]
    for phrase in ("Spread scores", "force yourself to differentiate", "the whole point is separation",
                   "Do NOT default to 7-8", "already passed the HARD VETO floor"):
        assert phrase not in bob, phrase
    assert "no forced spread" in bob
    assert "It is valid for every use case in the batch, or for none, to score high." in bob


def test_bob_receives_schema_and_business_context_but_no_strategy(ns):
    fields = _fields(ns["PROMPT_TEMPLATES"]["BEST_OF_BEST_SCORING_PROMPT"])
    for name in ("schema_details", "strategic_initiative", "value_chain", "revenue_model",
                 "business_context", "industry"):
        assert name in fields, name
    for name in ("strategic_goals", "business_priorities"):
        assert name not in fields, name


def test_bob_verifies_grounding_against_schema_and_requires_evidence(ns):
    bob = _scoring_prompts(ns)["BOB"]
    assert "Verify D1-D7 against the AVAILABLE SCHEMA" in bob
    assert "scores 0-2 on D4 and D7" in bob
    assert "cites at least one backticked column from the AVAILABLE SCHEMA" in bob
    assert bob.index("AVAILABLE SCHEMA (THE ONLY DATA THAT EXISTS)") < bob.index("## Use Cases to Score")


@pytest.mark.parametrize("tier", ["**Technical tier (D1-D10):**", "**Business tier (D12-D14):**",
                                  "**Principal-analyst tier (D15-D19):**"])
def test_bob_has_absolute_anchors_per_tier(ns, tier):
    bob = _scoring_prompts(ns)["BOB"]
    start = bob.index(tier)
    section = bob[start:start + 1500]
    for level in ("- 9-10:", "- 7-8:", "- 5-6:", "- 3-4:", "- 0-2:"):
        assert level in section, (tier, level)


def test_bob_target_max_is_selection_only(ns):
    bob = _scoring_prompts(ns)["BOB"]
    assert "must never change how you score any single use case" in bob
    assert "trimmed to a fundable" not in bob


def test_d11_balance_never_lowers_an_individual_score(ns):
    assert "Score D11 = 5.0 for every use case." in ns["QUALITY_GATE_SCORING_BLOCK"]
    assert "Count how many use cases in this batch share the same Business Domain" not in ns["QUALITY_GATE_SCORING_BLOCK"]
    assert "score D11 = 10 for every use case" in _scoring_prompts(ns)["BOB"]
    assert "how distinctive vs the portfolio's cluster centers" not in _scoring_prompts(ns)["BOB"]
    assert "Balance is never a reason to lower the score of an individual use case." in ns["QUALITY_GATE_RULES"]


def test_d8_layer3_requires_the_same_question(ns):
    rules = ns["QUALITY_GATE_RULES"]
    assert "SAME entity + SAME metric + SAME question → DUPLICATE" in rules
    assert "operate on the SAME entity + SAME metric → DUPLICATE regardless of wording" not in rules
    for name in ("QUALITY_GATE_HIGH", "QUALITY_GATE_SCORING_BLOCK"):
        assert "same entity + same metric = DUPLICATE" not in ns[name], name
        assert "same entity + same metric → D8 = 1.0" not in ns[name], name
    assert "If any previous use case has the SAME entity + SAME metric → DO NOT GENERATE" not in _base_with_gate(ns)


def test_d8_marks_only_the_weaker_duplicate(ns):
    assert "Give 1.0 only to the weaker use case of the pair" in ns["QUALITY_GATE_SCORING_BLOCK"]
    assert "D8 = 1.0 for the later use case" not in ns["QUALITY_GATE_SCORING_BLOCK"]
    assert "score 0-2 only for the weaker copy of a duplicate pair" in _scoring_prompts(ns)["BOB"]


def test_soft_and_hard_veto_boundaries_do_not_overlap(ns):
    block = ns["QUALITY_GATE_SCORING_BLOCK"]
    assert "- D9 ≤ 2.5 (trivial or weak depth" in block
    assert "- 2.5 < D9 ≤ 3.0 (moderate depth)" in block
    assert "- D10 ≤ 2.0 (technical method" in block
    assert "- 2.0 < D10 ≤ 3.0 (vague deliverable)" in block
    for name, text in _scoring_prompts(ns).items():
        assert "D9 = 2.5-3.0" not in text, name
        assert "D10 = 2.5-3.0" not in text, name


def test_vetoes_weights_and_labels_are_defined_only_in_the_shared_block(ns):
    block = ns["QUALITY_GATE_SCORING_BLOCK"]
    for name, key in (("COMBINED", "COMBINED_VALUE_QUALITY_SCORE_PROMPT"),):
        own = _render(ns["PROMPT_TEMPLATES"][key]).replace(block.strip(), "")
        for phrase in ("HARD VETO", "SOFT VETO", "DIMENSION WEIGHTS", "4.5 - 5.0**: Ultra High", "4.5-5.0=Ultra High"):
            assert phrase not in own, (name, phrase)
    assert block.count("**QUALITY LABEL**") == 1
    assert block.count("Step 2 (HARD VETO)") == 1


def test_d12_to_d19_veto_applies_in_the_quality_scorer(ns):
    prompts = _scoring_prompts(ns)
    for name in ("COMBINED",):
        assert "Any of D12–D19 FAILS as defined below" in prompts[name], name
        assert "D1–D11 are scored 1.0–5.0" in prompts[name], name
        assert "For EACH use case, evaluate the following 11 dimensions" not in prompts[name], name


def test_quality_rules_and_d8_layers_appear_once_per_rendered_prompt(ns):
    rules = ns["QUALITY_GATE_RULES"].strip()
    rendered = {"BASE+HIGH": _base_with_gate(ns), **_scoring_prompts(ns)}
    for name in ("BASE+HIGH", "COMBINED"):
        assert rendered[name].count(rules) == 1, name
        assert rendered[name].count("LAYER 1:") == 1, name
        assert rendered[name].count("LAYER 3:") == 1, name


def test_rendered_lengths_are_below_the_v113_baseline(ns):
    pre = ns["USER_DIRECTIVE_SUPREMACY_PREAMBLE"]
    prompts = _scoring_prompts(ns)
    measured = {
        "BASE+HIGH": len(pre + _base_with_gate(ns)),
        "COMBINED": len(pre + prompts["COMBINED"]),
    }
    for name, baseline in BASELINE_RENDERED_CHARS.items():
        assert measured[name] < baseline, (name, measured[name], baseline)


def test_value_anchors_have_no_invented_multipliers_or_gaps(ns):
    prompts = _scoring_prompts(ns)
    text = prompts["COMBINED"]
    for phrase in (">10x", "5-10x", "2-5x", "> 6 months", "=>6 months", "< 4 weeks", "<4 weeks", "< 2 weeks"):
        assert phrase not in text, phrase
    assert "more than 3 months" in text


def test_combined_scoring_is_strategy_blind(ns):
    combined = _scoring_prompts(ns)["COMBINED"]
    for phrase in ("business_priority_alignment", "strategic_goals_alignment", "Strategic Goals:", "Business Priorities:",
                   "Strategic Alignment * 0.25"):
        assert phrase not in combined, phrase
    assert "Value = (ROI * 0.80) + (TTV * 0.10) + (Reusability * 0.10)" in combined
    assert "Strategic alignment is assessed in a later step, after selection." in combined


def test_quality_scorer_has_no_reject_when_in_doubt_bias(ns):
    quality = _scoring_prompts(ns)["COMBINED"]
    assert "When in doubt, REJECT" not in quality
    assert "APPROVE only if ALL checks pass, otherwise REJECT" not in quality


def test_combined_grounding_rule_does_not_override_the_other_vetoes(ns):
    combined = _scoring_prompts(ns)["COMBINED"]
    assert "DEFAULT TO KEEP" not in combined
    assert "REJECT only for EXPLICIT hallucination" not in combined
    assert "Depth, uniqueness, activation and the D12–D19 business gates are judged by their own rules above." in combined


def test_review_prompt_has_no_count_target(ns):
    review = _render(ns["PROMPT_TEMPLATES"]["REVIEW_USE_CASES_PROMPT"])
    for phrase in ("count > 75", "50-100 UC range", "sweet spot", "Typical removal rate", "drop if in doubt"):
        assert phrase not in review, phrase
    assert "DEDUPLICATION ONLY" in review
