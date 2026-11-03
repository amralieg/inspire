import json
import logging
import os
import re
import string
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import agent_source, load_agent_namespace

HEADER = "### NON-NEGOTIABLE GENERATION INSTRUCTIONS (MUST FOLLOW STRICTLY)"
SENTINEL = "*(No additional generation instructions provided)*"
BOB = "BEST_OF_BEST_SCORING_PROMPT"


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


class _FakeAgent:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def run_worker(self, **kwargs):
        self.calls.append(kwargs)
        item = self.responses.pop(0) if self.responses else ""
        if isinstance(item, Exception):
            raise item
        return item


class _Harness:
    def __init__(self, ns, raw="", parsed=None, responses=()):
        self.logger = logging.getLogger("v120_generation_instructions_test")
        self.user_generation_instructions = raw
        self.parsed_generation_instructions = parsed if parsed is not None else {}
        self.business_name = "Example Business"
        self.user_strategic_goals = []
        self.ai_agent = _FakeAgent(responses)
        cls = ns["DatabricksInspire"]
        self.section = cls.__dict__["_get_generation_instruction_for_prompt"].__get__(self, _Harness)
        self.interpret = cls.__dict__["_interpret_generation_instructions"].__get__(self, _Harness)
        for name in ("_kind_catalog", "_kind_id_of", "_user_kind_directives"):
            setattr(self, name, cls.__dict__[name].__get__(self, _Harness))


STRUCTURED = {
    "goal_setting": {"has_goal": True, "goal_description": "Reduce unplanned losses across operations"},
    "table_joins": [{"left_table": "c.s.left_tbl", "right_table": "c.s.right_tbl", "join_columns": ["key_id"], "join_type": "left"}],
    "forced_techniques": [{"technique": "Gradient Boosting", "context": "for every classification use case"}],
    "table_ignores": [{"pattern": "tmp_*", "type": "prefix"}],
    "construct_exclusions": ["membership tier program"],
    "change_management_posture": "Conservative",
    "data_characteristics": {"c.s.events_tbl": "no labeled outcomes; monthly snapshots"},
    "per_prompt_instructions": {},
    "interpretation_status": "ok",
}


def _all_prompt_names(ns):
    return set(re.findall(r'_get_generation_instruction_for_prompt\(\s*"([A-Z_]+)"', agent_source()))


def test_d1_12_interpreter_defaults_include_best_of_best(ns):
    h = _Harness(ns, raw="")
    result = h.interpret()
    assert BOB in result["per_prompt_instructions"]
    for key in ("construct_exclusions", "change_management_posture", "data_characteristics"):
        assert key in result, key


def test_d1_12_default_prompt_keys_match_the_interpreter_examples(ns):
    h = _Harness(ns, raw="")
    default_keys = set(h.interpret()["per_prompt_instructions"])
    prompt = ns["PROMPT_TEMPLATES"]["GENERAL_INSTRUCTION_INTERPRETER_PROMPT"].format(generation_instructions="x", business_name="y", kind_ids="forecast")
    blocks = re.findall(r"```json\s*\n(.*?)\n```", prompt, re.DOTALL)
    filled, empty = json.loads(blocks[0]), json.loads(blocks[1])
    assert set(filled["per_prompt_instructions"]) == default_keys
    assert set(empty["per_prompt_instructions"]) == default_keys
    table_rows = set(re.findall(r"^\| `([A-Z_]+)` \|", prompt, re.MULTILINE))
    assert table_rows == default_keys
    assert set(ns["GENERATION_DIRECTIVE_CATEGORIES_BY_PROMPT"]) == default_keys


def test_d1_12_successful_parse_backfills_missing_bob_key(ns):
    reply = json.dumps({"data": {"goal_setting": {"has_goal": False}, "per_prompt_instructions": {"BASE_USE_CASE_GEN_PROMPT": "Prefer joined tables."}}})
    h = _Harness(ns, raw="prefer joined tables", responses=[reply])
    result = h.interpret()
    assert result["per_prompt_instructions"][BOB] == ""
    assert result["interpretation_status"] == "ok"


def test_d1_11_structured_directives_reach_the_generation_prompt(ns):
    h = _Harness(ns, raw="anything", parsed=dict(STRUCTURED))
    text = h.section("BASE_USE_CASE_GEN_PROMPT")
    assert text.startswith(HEADER)
    for needle in ("GOAL: Reduce unplanned losses", "`c.s.left_tbl` and `c.s.right_tbl` are joined on key_id (left join)",
                   "REQUIRED TECHNIQUE: Gradient Boosting (for every classification use case)",
                   "membership tier program", "CHANGE-MANAGEMENT POSTURE: conservative -- every Solution MUST name a baseline fallback",
                   "DATA CHARACTERISTIC of `c.s.events_tbl`: no labeled outcomes"):
        assert needle in text, needle
    assert "IGNORE TABLES" not in text


def test_d1_11_each_prompt_gets_only_its_categories(ns):
    h = _Harness(ns, raw="anything", parsed=dict(STRUCTURED))
    table_filter = h.section("FILTER_BUSINESS_TABLES_PROMPT")
    assert "IGNORE TABLES matching `tmp_*` (prefix)" in table_filter
    assert "TABLE JOIN:" in table_filter
    assert "CONSTRUCTS THAT DO NOT EXIST" not in table_filter
    bob = h.section(BOB)
    for needle in ("GOAL:", "REQUIRED TECHNIQUE:", "CONSTRUCTS THAT DO NOT EXIST", "CHANGE-MANAGEMENT POSTURE:", "DATA CHARACTERISTIC"):
        assert needle in bob, needle
    assert "TABLE JOIN:" not in bob
    summary = h.section("SUMMARY_GEN_PROMPT")
    assert "GOAL:" in summary
    assert "REQUIRED TECHNIQUE" not in summary and "DATA CHARACTERISTIC" not in summary


def test_d1_11_every_requested_prompt_has_a_category_mapping(ns):
    mapping = ns["GENERATION_DIRECTIVE_CATEGORIES_BY_PROMPT"]
    requested = _all_prompt_names(ns)
    assert requested and requested <= set(mapping), requested - set(mapping)
    assert set(mapping) <= set(ns["PROMPT_TEMPLATES"])


def test_instruction_only_output_is_unchanged_from_v113(ns):
    parsed = {"per_prompt_instructions": {"DOMAIN_FINDER_PROMPT": "Keep a dedicated domain for the goal."}, "interpretation_status": "ok"}
    h = _Harness(ns, raw="x", parsed=parsed)
    expected = (HEADER + "\n\nThe following instructions were provided by the user and MUST be followed without exception. "
                "Violating any of these instructions is an IMPLEMENTATION FAILURE.\n\nKeep a dedicated domain for the goal.")
    assert h.section("DOMAIN_FINDER_PROMPT") == expected


def test_no_directives_returns_the_unchanged_sentinel(ns):
    assert _Harness(ns, raw="", parsed={}).section("BASE_USE_CASE_GEN_PROMPT") == SENTINEL
    assert _Harness(ns, raw="", parsed={"per_prompt_instructions": {}}).section(BOB) == SENTINEL


def test_persisted_section_is_not_wrapped_twice(ns):
    h = _Harness(ns, raw="x", parsed=dict(STRUCTURED))
    persisted = h.section("USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT")
    restored = _Harness(ns, raw="", parsed={"per_prompt_instructions": {"USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT": persisted}})
    again = restored.section("USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT")
    assert again == persisted
    assert again.count(HEADER) == 1


def test_interpreter_failure_injects_raw_instructions_verbatim(ns):
    raw = "Join c.s.a with c.s.b on k_id and never use the archive tables."
    h = _Harness(ns, raw=raw, responses=["not json at all", RuntimeError("endpoint down")])
    result = h.interpret()
    assert result["interpretation_status"] == "failed"
    assert len(h.ai_agent.calls) == 2
    text = h.section("BASE_USE_CASE_GEN_PROMPT")
    assert raw in text and text.startswith(HEADER)
    assert raw in h.section(BOB)


def test_empty_interpretation_injects_raw_instructions_verbatim(ns):
    raw = "Focus on whatever matters most to the board."
    reply = json.dumps({"per_prompt_instructions": {}, "goal_setting": {"has_goal": False}})
    h = _Harness(ns, raw=raw, responses=[reply])
    assert h.interpret()["interpretation_status"] == "empty"
    assert raw in h.section("COMBINED_VALUE_QUALITY_SCORE_PROMPT")


def test_uninterpreted_instructions_are_injected_verbatim(ns):
    raw = "Treat every table under the archive schema as out of scope."
    assert raw in _Harness(ns, raw=raw, parsed={}).section("USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT")
    assert _Harness(ns, raw="", parsed={}).section("USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT") == SENTINEL


def test_successful_interpretation_does_not_duplicate_raw_text(ns):
    raw = "RAW-USER-TEXT-MARKER prefer joins"
    parsed = dict(STRUCTURED, per_prompt_instructions={"BASE_USE_CASE_GEN_PROMPT": "Prefer joins."})
    h = _Harness(ns, raw=raw, parsed=parsed)
    assert "RAW-USER-TEXT-MARKER" not in h.section("BASE_USE_CASE_GEN_PROMPT")


def test_malformed_structured_values_are_skipped_not_fatal(ns):
    parsed = {
        "goal_setting": {"has_goal": True, "goal_description": "  "},
        "table_joins": ["not a dict", {"left_table": "a"}, None],
        "forced_techniques": ["Isolation Forest", {"technique": ""}],
        "table_ignores": [{"pattern": ""}],
        "construct_exclusions": "loyalty points",
        "change_management_posture": None,
        "data_characteristics": {"c.s.t": "", "": "orphan"},
        "per_prompt_instructions": None,
        "interpretation_status": "ok",
    }
    text = _Harness(ns, raw="x", parsed=parsed).section("BASE_USE_CASE_GEN_PROMPT")
    assert "REQUIRED TECHNIQUE: Isolation Forest" in text
    assert "loyalty points" in text
    for absent in ("GOAL:", "TABLE JOIN:", "CHANGE-MANAGEMENT POSTURE", "DATA CHARACTERISTIC", "orphan"):
        assert absent not in text, absent
    assert text.count("REQUIRED TECHNIQUE") == 1
