import ast
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
AGENT = os.path.dirname(os.path.dirname(HERE))
NOTEBOOK = os.path.join(AGENT, "agent", "dbx_inspire_ai_agent.ipynb")
KINDS = os.path.join(AGENT, "agent", "app_shell", "kinds.json")
sys.path.insert(0, os.path.join(AGENT, "agent", "app_shell"))

import embed  # noqa: E402


def _cell():
    with open(NOTEBOOK, encoding="utf-8") as handle:
        return json.load(handle)["cells"][embed.CELL]["source"]


def _literal(lines, name):
    start, stop = embed._registry_block(lines, name)
    return ast.literal_eval("".join(lines[start:stop]).split("=", 1)[1].strip())


def _kinds():
    with open(KINDS, encoding="utf-8") as handle:
        return json.load(handle)


def test_notebook_execution_family_is_the_kinds_json_registry():
    assert _literal(_cell(), "TECHNIQUE_EXECUTION_FAMILY") == _kinds()["execution_family"]


def test_notebook_readiness_thresholds_are_the_kinds_json_registry():
    assert _literal(_cell(), "GENIE_READINESS_THRESHOLDS") == _kinds()["readiness_thresholds"]


def test_embed_check_reports_no_drift_between_the_notebook_and_kinds_json():
    assert embed.registry_differences(_cell(), embed.kinds()) == []


def test_embed_check_catches_a_threshold_edited_by_hand_in_the_notebook():
    lines = list(_cell())
    start, _stop = embed._registry_block(lines, "GENIE_READINESS_THRESHOLDS")
    lines[start + 1] = lines[start + 1].replace('"min_rows": 1', '"min_rows": 9', 1)
    assert embed.registry_differences(lines, embed.kinds()) == ["GENIE_READINESS_THRESHOLDS in the notebook differs from kinds.json readiness_thresholds"]
