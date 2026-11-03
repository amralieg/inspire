import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

NEW_TECHNIQUES = {
    "Decomposition": "F", "Peer Benchmarking": "F", "Process Mining": "J", "Sequence Analysis": "J",
    "Causal Impact": "I", "Uplift Modeling": "I", "Marketing Mix Modeling": "I", "Threshold Optimization": "H",
    "Queueing": "J", "Controls Testing": "K", "Statistical Process Control": "K", "Entity Matching": "K",
    "Lifetime Value": "E", "Data Agent": "L",
}
CATCH_ALL = {"AI Analysis"}
FAMILIES = set("ABCDEFGHIJKL")


def _prompt_allowed(agent_ns):
    prompt = agent_ns["PROMPT_TEMPLATES"]["BASE_USE_CASE_GEN_PROMPT"]
    block = prompt.split("MUST be ONE of these values:", 1)[1].split("\n\n", 1)[0]
    return set(re.findall(r"^\s*\* `([^`]+)` - ", block, re.M))


def _prompt_family_map(agent_ns):
    prompt = agent_ns["PROMPT_TEMPLATES"]["BASE_USE_CASE_GEN_PROMPT"]
    block = prompt.split("**CANONICAL TECHNIQUE → FAMILY MAPPING**", 1)[1].split("\n\n", 1)[0]
    return [label for line in block.splitlines() if re.match(r"^[A-Z]\. ", line) for label in re.findall(r"`([^`]+)`", line)]


def _registry(agent_ns):
    return set(agent_ns["TECHNIQUE_EXECUTION_FAMILY"])


def test_every_new_technique_is_registered_in_its_family(agent_ns):
    registry = agent_ns["TECHNIQUE_EXECUTION_FAMILY"]
    assert {label: registry.get(label) for label in NEW_TECHNIQUES} == NEW_TECHNIQUES


def test_every_technique_list_holds_the_same_labels(agent_ns):
    registry = _registry(agent_ns)
    cls = agent_ns["DatabricksInspire"]
    assert set(agent_ns["TECHNIQUE_IMPLEMENTATION_GUIDANCE"]) == registry
    assert _prompt_allowed(agent_ns) == registry - CATCH_ALL
    mapped = _prompt_family_map(agent_ns)
    assert sorted(mapped) == sorted(registry - CATCH_ALL), "each allowed technique sits in exactly one prompt family"
    gate_labels = {label for _key, label, _aliases, _methods in cls._TECHNIQUE_FAMILIES}
    assert gate_labels <= registry - CATCH_ALL
    assert registry - CATCH_ALL - gate_labels == {"Segmentation"}, "only Segmentation folds into the Clustering gate family"
    assert registry <= set(cls._TECHNIQUE_VALUE_KEYS)
    english = agent_ns["TranslationService"].ENGLISH_TRANSLATIONS
    for label in registry:
        assert english[cls._TECHNIQUE_VALUE_KEYS[label]] == label


def test_the_kind_registry_and_the_technique_registry_name_the_same_techniques(agent_ns):
    kinds = agent_ns["_inspire_kinds"]()
    registry = set(agent_ns["TECHNIQUE_EXECUTION_FAMILY"])
    assert set(kinds["technique_kind"]) == registry
    assert {t for kind in kinds["kinds"] for t in kind["techniques"]} == registry


def test_every_family_table_names_the_same_families(agent_ns):
    cls = agent_ns["DatabricksInspire"]
    tables = {
        "GENIE_FAMILY_SPECS": agent_ns["GENIE_FAMILY_SPECS"],
        "GENIE_FAMILY_PACKAGES": agent_ns["GENIE_FAMILY_PACKAGES"],
        "GENIE_READINESS_THRESHOLDS": agent_ns["GENIE_READINESS_THRESHOLDS"],
        "GENIE_FAMILY_DECISION_BASIS": agent_ns["GENIE_FAMILY_DECISION_BASIS"],
        "DEEP_SIGNAL_CHECKS": agent_ns["DEEP_SIGNAL_CHECKS"],
        "_GENIE_ACCEPTANCE_TEXT": cls._GENIE_ACCEPTANCE_TEXT,
    }
    for name, table in tables.items():
        assert set(table) == FAMILIES, name
    assert set(agent_ns["INSPIRE_FAMILY_FLAGGING"]) == set("ABCDEFGH"), "the App holds this table; families with no flagging rule read ()"
    assert all(agent_ns["INSPIRE_FAMILY_FLAGGING"].get(family, ()) == () for family in "IJKL")
    assert set(agent_ns["INSPIRE_READINESS_RULES"]) - {"common"} == FAMILIES
    stops = set(cls._GENIE_ACCEPTANCE_STOP) - {"model"}
    assert stops | set(agent_ns["INSPIRE_MODEL_FAMILIES"]) == FAMILIES
    assert set(agent_ns["TECHNIQUE_EXECUTION_FAMILY"].values()) == FAMILIES


def test_the_import_time_check_rejects_a_technique_missing_from_the_prompt(fresh_ns):
    fresh_ns["TECHNIQUE_EXECUTION_FAMILY"]["Quantum Divination"] = "F"
    fresh_ns["TECHNIQUE_IMPLEMENTATION_GUIDANCE"]["Quantum Divination"] = "Method: x"
    with pytest.raises(ValueError, match="Quantum Divination"):
        fresh_ns["_validate_technique_registry"]()


def test_the_import_time_check_rejects_a_family_missing_from_a_family_table(fresh_ns):
    del fresh_ns["GENIE_FAMILY_DECISION_BASIS"]["L"]
    with pytest.raises(ValueError, match="GENIE_FAMILY_DECISION_BASIS"):
        fresh_ns["_validate_technique_registry"]()


@pytest.mark.parametrize("label", sorted(NEW_TECHNIQUES))
def test_each_new_label_resolves_to_its_own_gate_family_and_back(agent_ns, label):
    cls = agent_ns["DatabricksInspire"]
    key = cls._technique_family(label)
    assert cls._technique_label(key) == label
    assert cls._canonical_technique(label) == label


@pytest.mark.parametrize("label", sorted(NEW_TECHNIQUES))
def test_each_new_label_has_serverless_guidance_with_the_four_decision_lines(agent_ns, label):
    text = agent_ns["TECHNIQUE_IMPLEMENTATION_GUIDANCE"][label]
    for line in ("Method:", "Baseline:", "Accept:", "If data is insufficient:"):
        assert line in text, (label, line)
    low = text.lower()
    for banned in ("pip install", "%pip", "graphframes", "prophet", "pymc", "causalml", "lifetimes", "dowhy", "sparkcontext", ".cache(", ".persist("):
        assert banned not in low, (label, banned)


def test_erlang_c_is_plain_python_and_benford_uses_scipy(agent_ns):
    guidance = agent_ns["TECHNIQUE_IMPLEMENTATION_GUIDANCE"]
    assert "plain python" in guidance["Queueing"].lower()
    controls = guidance["Controls Testing"].lower()
    assert "benford" in controls and "scipy" in controls


def test_new_families_install_only_pinned_serverless_packages(agent_ns):
    packages = agent_ns["GENIE_FAMILY_PACKAGES"]
    pinned = set(agent_ns["GENIE_ENV_PACKAGE_VERSIONS"])
    for family in "IJKL":
        assert set(packages[family]) <= pinned, family
    assert packages["L"] == ()


@pytest.mark.parametrize("label", sorted(NEW_TECHNIQUES))
def test_each_new_label_is_translated_in_every_language(agent_ns, label):
    ts, cls = agent_ns["TranslationService"], agent_ns["DatabricksInspire"]
    key = cls._TECHNIQUE_VALUE_KEYS[label]
    for language, table in ts.TRANSLATION_FALLBACKS.items():
        assert str(table.get(key) or "").strip(), (language, key)


@pytest.mark.parametrize("label", sorted(NEW_TECHNIQUES))
def test_each_new_family_builds_a_genie_acceptance_section(agent_ns, label):
    cls = agent_ns["DatabricksInspire"]
    family = agent_ns["TECHNIQUE_EXECUTION_FAMILY"][label]
    obj = cls.__new__(cls)
    spec = {"family": family, "decision_basis": agent_ns["GENIE_FAMILY_DECISION_BASIS"][family],
            "thresholds": dict(agent_ns["GENIE_READINESS_THRESHOLDS"][family])}
    section = obj._genie_acceptance_section(spec)
    assert "- Acceptance: " in section and "{" not in section
    assert obj._genie_threshold_text(dict(spec, runtime_assumptions=[]))
