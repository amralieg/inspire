"""v1.0.9 P30 Genie instruction crispness, re-based on the v1.3.0 self-contained Genie Code instruction.

The user pastes the instruction into Genie Code and Genie Code builds and runs the whole notebook from it, so the prompt
must ask for seven fixed sections, stay short, carry the stop rule and the definition of done, and never mention the
retired notebook harness (GENIE SLOT cells, run controls, the contract check). The old v1.0.9 rules that caused invented
numbers, deleted jobs and over-engineered notebooks stay banned.
"""
import os
import re
import string
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import agent_source, load_agent_namespace

KEY = "USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT"
SECTIONS = ("## 1. Goal", "## 2. Data", "## 3. Parameters", "## 4. Readiness Check", "## 5. Build Steps",
            "## 6. Method and Acceptance", "## 7. Business Output", "## 8. Definition of Done")
BANNED = (
    "20%+", "~Y%", "Impact on Accuracy", "estimated accuracy improvement", "reduces accuracy by",
    "Self-critique", "self-critique", "rating the implementation 1-10",
    "Table Discovery (MANDATORY)", "Lineage and Relationship Discovery (MANDATORY)", "ALL tables listed in the Enrichment Opportunities section MUST be loaded",
    "exactly 4 cells", "temp_results", "approximately 25-40 columns", "Do NOT describe join paths",
    "NEVER fabricate data using random number generators", "w.jobs.delete", "Job cleanup", "delete the job",
    "LATEST registered model", "main_train", "main_infer", "ai_sys_confidence", "databricks-gpt-oss-120b",
    "ZERO executable code", "ai_query is the FINAL EXPLANATION layer only",
    "GENIE SLOT", "Contract check", "contract-check", "InspireReadinessStop", "Inspire cells", "run controls", "Smoke test",
)
REQUIRED_PLACEHOLDERS = ("decision", "decision_owner", "cadence", "kpi", "kpi_direction", "value_tier", "outcome_definition",
                         "time_column", "entity_key_column", "join_path", "signal_columns", "build_path", "blockers",
                         "beneficiary", "sponsor", "readiness_thresholds", "code_structure_mandate", "execution_family", "model_name")


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def _prompt(ns):
    return ns["PROMPT_TEMPLATES"][KEY]


def _word_count(text):
    return len(re.findall(r"\S+", text))


def test_A_prompt_declares_the_eight_sections_in_order(ns):
    prompt = _prompt(ns)
    positions = [prompt.find(header) for header in SECTIONS]
    assert all(p >= 0 for p in positions), dict(zip(SECTIONS, positions))
    assert positions == sorted(positions)


def test_B_template_word_count_between_600_and_1800(ns):
    count = _word_count(_prompt(ns))
    assert 600 <= count <= 1800, count


def test_B_method_and_done_sections_stay_short(ns):
    prompt = _prompt(ns)
    method = prompt[prompt.index(SECTIONS[5]):prompt.index(SECTIONS[6])]
    done = prompt[prompt.index(SECTIONS[7]):]
    assert 40 <= _word_count(method) <= 200
    assert 30 <= _word_count(done) <= 200


def test_C_banned_phrases_are_absent(ns):
    prompt = _prompt(ns)
    present = [phrase for phrase in BANNED if phrase in prompt]
    assert present == []


def test_C_banned_phrase_check_is_not_a_tautology():
    poisoned = ("An estimated accuracy improvement (20%+). Add a Self-critique cell. Job cleanup: delete the job. "
                "Fill the GENIE SLOT cells until the Contract check prints PASSED.")
    assert {p for p in BANNED if p in poisoned} >= {"20%+", "Self-critique", "Job cleanup", "delete the job", "estimated accuracy improvement",
                                                   "GENIE SLOT", "Contract check"}


def test_D_decision_block_and_slot_placeholders_are_present(ns):
    fields = {f for _, f, _, _ in string.Formatter().parse(_prompt(ns)) if f}
    missing = [name for name in REQUIRED_PLACEHOLDERS if name not in fields]
    assert missing == []


def test_D_decision_field_tuple_is_shared_with_the_notebook_card(ns):
    keys = ns["DatabricksInspire"]._GENIE_DECISION_KEYS
    card = {key for key, _label in ns["DatabricksInspire"]._ELITE_CARD_FIELDS}
    fields = {f for _, f, _, _ in string.Formatter().parse(_prompt(ns)) if f}
    assert set(keys) <= card and set(keys) <= fields


def test_E_stop_rule_and_definition_of_done_are_explicit(ns):
    prompt = _prompt(ns)
    assert "**STOP RULE:**" in prompt and "writes nothing, and stops" in prompt and "{acceptance_stop_rule}" in prompt
    assert "No approved model yet" in ns["DatabricksInspire"]._GENIE_ACCEPTANCE_STOP["model"]
    assert "never lowers a threshold, fabricates data, drops a check or switches to other tables" in prompt
    assert "Genie Code reads ONLY this instruction" in prompt and "the business output table has every column listed above" in prompt
    assert "Never fabricate unobserved inputs" in prompt and "Seeded sampling and seeded simulation are allowed" in prompt


def test_F_deployed_notebook_carries_the_redesigned_prompt():
    src = agent_source()
    assert "Genie Code reads ONLY this instruction" in src and "GENIE SLOT" not in src
    assert "3 PARTS (A-C)" not in src
