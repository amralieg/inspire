"""v1.4.0 use-case kinds: one resolver from a written kind or a technique to a registry kind id.

`_inspire_resolve_kind(value, technique=None)` maps an id, a label (any case or spacing) or a kind number to the kind id,
falls back to the kind of the technique, and returns None when neither names a kind. Every reader of a kind value calls it.
"""
import ast
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import agent_source, method_node  # noqa: E402


def kinds(ns):
    return ns["_inspire_kinds"]()["kinds"]


def test_every_kind_id_resolves_to_itself(agent_ns):
    resolve = agent_ns["_inspire_resolve_kind"]
    for kind in kinds(agent_ns):
        assert resolve(kind["id"]) == kind["id"]
        assert resolve(" " + kind["id"].upper().replace("_", " - ") + " ") == kind["id"]


def test_every_kind_label_resolves_in_any_case_and_spacing(agent_ns):
    resolve = agent_ns["_inspire_resolve_kind"]
    for kind in kinds(agent_ns):
        assert resolve(kind["label"]) == kind["id"]
        assert resolve("  " + "   ".join(kind["label"].upper().split()) + "\t") == kind["id"]
        assert resolve(kind["label"].lower().replace(" ", "_")) == kind["id"]
        assert resolve(f"`{kind['id']}`") == resolve(f'"{kind["label"]}"') == resolve(f"**{kind['label']}**") == kind["id"]


def test_every_kind_number_resolves_alone_or_before_its_label(agent_ns):
    resolve = agent_ns["_inspire_resolve_kind"]
    for kind in kinds(agent_ns):
        assert resolve(kind["num"]) == kind["id"]
        assert resolve(str(kind["num"])) == kind["id"]
        assert resolve(f"{kind['num']}. {kind['label']}") == kind["id"]
        assert resolve(f"{kind['num']}) {kind['id']}") == kind["id"]


def test_a_missing_or_unknown_value_falls_back_to_the_technique(agent_ns):
    resolve = agent_ns["_inspire_resolve_kind"]
    mapping = agent_ns["_inspire_kinds"]()["technique_kind"]
    for technique, kind_id in mapping.items():
        assert resolve(None, technique) == kind_id
        assert resolve("", technique) == kind_id
        assert resolve("not a kind at all", "  " + technique.upper() + " ") == kind_id


def test_a_written_kind_wins_over_the_technique(agent_ns):
    resolve = agent_ns["_inspire_resolve_kind"]
    mapping = agent_ns["_inspire_kinds"]()["technique_kind"]
    technique, technique_kind = next(iter(mapping.items()))
    other = next(k["id"] for k in kinds(agent_ns) if k["id"] != technique_kind)
    assert resolve(other, technique) == other


@pytest.mark.parametrize("value,technique", [
    (None, None), ("", None), ("   ", None), ("not a kind at all", None), ("not a kind at all", "Crystal Ball Gazing"),
    (float("nan"), None), (0, None), (41, None), ("41. Forecasting", None), ("forecasting", None),
    ("forecast cockpit", None), ("_", ""),
])
def test_a_value_that_names_no_kind_resolves_to_none(agent_ns, value, technique):
    assert agent_ns["_inspire_resolve_kind"](value, technique) is None


def test_a_missing_registry_raises_instead_of_guessing(fresh_ns):
    fresh_ns["_INSPIRE_KINDS_REGISTRY"] = None
    fresh_ns["_INSPIRE_KINDS"] = ""
    with pytest.raises(RuntimeError, match="no usable kind registry"):
        fresh_ns["_inspire_resolve_kind"]("forecast")


def test_the_parser_resolves_kinds_through_the_one_helper():
    resolver = method_node("DatabricksInspire", "_resolve_use_case_kind")
    names = {n.func.id for n in ast.walk(resolver) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
    assert "_inspire_resolve_kind" in names
    assert not any(isinstance(n, ast.Subscript) and isinstance(n.slice, ast.Constant) and n.slice.value == "kinds"
                   for n in ast.walk(resolver))


def test_no_second_kind_key_normalizer_exists_in_the_agent():
    src = agent_source()
    assert len(re.findall(r'^def _inspire_resolve_kind\(value, technique=None\)', src, re.M)) == 1
    assert len(re.findall(r'^def _inspire_kind_key\(', src, re.M)) == 1
    assert "def _kind_key(" not in src
