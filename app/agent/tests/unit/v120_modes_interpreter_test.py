"""v1.2.0 MODES lane: GENERAL_INSTRUCTION_INTERPRETER_PROMPT (scope item 6).

A user goal sets the scope and the alignment of the portfolio and exempts goal-aligned use cases
from domain / technique balance penalties, but it never exempts them from the quality bar of the
selected mode. The per-prompt examples the interpreter copies its instructions from used to say the
opposite ("MUST NOT be filtered by quality gates"). ULTRA_HIGH_ELITE_JUDGE_PROMPT is listed so the
interpreter writes an instruction for the elite judge as well.
"""
import json
import re

import pytest

ELITE = "ULTRA_HIGH_ELITE_JUDGE_PROMPT"
EXEMPTION_PHRASES = (
    "MUST NOT be filtered by quality gates",
    "MUST NOT be rejected by quality gates",
    "MUST be scored HIGH and MUST NOT be filtered out",
    "Do NOT penalize these use cases on any dimension",
    "do NOT reject goal-aligned use cases on quality grounds",
    "goal-aligned use cases MUST survive ranking",
    "do NOT remove goal-aligned use cases even if they seem similar",
)


@pytest.fixture(scope="module")
def prompt(agent_ns):
    return agent_ns["PROMPT_TEMPLATES"]["GENERAL_INSTRUCTION_INTERPRETER_PROMPT"]


@pytest.fixture(scope="module")
def rendered(prompt):
    return prompt.format(generation_instructions="focus on fraud", business_name="Acme", kind_ids="forecast")


def _examples(rendered):
    blocks = re.findall(r"```json\s*\n(.*?)\n```", rendered, re.DOTALL)
    return json.loads(blocks[0]), json.loads(blocks[1])


def test_no_quality_bar_exemption_remains(prompt):
    for phrase in EXEMPTION_PHRASES:
        assert phrase not in prompt, phrase


def test_goal_rule_exempts_balance_but_never_the_quality_bar(prompt):
    goal = prompt[prompt.index("**2. Goal Setting**"):prompt.index("**3. Forced Techniques**")]
    assert "never penalized for domain or technique balance" in goal
    assert "NEVER exempts a use case from the quality bar of the selected quality mode" in goal
    assert "fails the bar is still filtered out" in goal


def test_scoring_examples_keep_alignment_but_not_an_exemption(rendered):
    filled, _ = _examples(rendered)
    per_prompt = filled["per_prompt_instructions"]
    combined = per_prompt["COMBINED_VALUE_QUALITY_SCORE_PROMPT"]
    assert "same absolute value and quality anchors" in combined
    assert not re.search(r"\b[0-5]\.\d\s*-\s*[0-5]\.\d\b", combined), "no goal-based score band before selection"
    assert "never exempts a use case from the quality bar" in combined
    assert "true duplicates, keep the stronger one" in per_prompt["REVIEW_USE_CASES_PROMPT"]
    for key in ("COMBINED_VALUE_QUALITY_SCORE_PROMPT", ELITE):
        assert "domain or technique balance" in per_prompt[key], key
    assert not {"USE_CASE_QUALITY_SCORE_PROMPT", "USE_CASE_VALUE_SCORE_PROMPT"} & set(per_prompt)


def test_elite_judge_prompt_is_in_both_examples_and_the_reference_table(rendered):
    filled, empty = _examples(rendered)
    assert ELITE in filled["per_prompt_instructions"]
    assert empty["per_prompt_instructions"][ELITE] == ""
    instruction = filled["per_prompt_instructions"][ELITE]
    assert "same absolute elite bar to every use case" in instruction
    assert "never exempts a use case from that bar" in instruction
    assert "USER-DECLARED CONSTRUCT EXCLUSIONS" in instruction and "is never elite" in instruction
    rows = re.findall(r"^\| `([A-Z_]+)` \|(.*)$", rendered, re.MULTILINE)
    elite_rows = [text for name, text in rows if name == ELITE]
    assert len(elite_rows) == 1 and "Ultra High mode only" in elite_rows[0]


def test_examples_list_the_same_prompts_as_the_reference_table(rendered):
    filled, empty = _examples(rendered)
    table = set(re.findall(r"^\| `([A-Z_]+)` \|", rendered, re.MULTILINE))
    assert set(filled["per_prompt_instructions"]) == set(empty["per_prompt_instructions"]) == table


def test_category_structure_is_unchanged(prompt):
    assert len(re.findall(r"^\*\*\d+\. ", prompt, re.MULTILINE)) == 12
    assert "into the 12 structured categories" in prompt and "**8. Best of Best Count** (OPTIONAL)" in prompt
    assert "**9. Use Case Count** (OPTIONAL)" in prompt and "**10. Requested Use Cases** (OPTIONAL)" in prompt
    assert "**11. Use Case Kinds** (OPTIONAL)" in prompt and "**12. Naming Rules** (OPTIONAL)" in prompt


def test_both_examples_leave_the_best_of_best_count_unset(rendered):
    filled, empty = _examples(rendered)
    assert filled["best_of_best_count"] is None and empty["best_of_best_count"] is None
