import ast
import json
import os
import re
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
    lines[start + 1] = re.sub(r'"min_rows": \d+', '"min_rows": 999', lines[start + 1], count=1)
    assert embed.registry_differences(lines, embed.kinds()) == ["GENIE_READINESS_THRESHOLDS in the notebook differs from kinds.json readiness_thresholds"]


def _function(lines, name):
    tree = ast.parse("".join(lines))
    node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
    return ast.get_source_segment("".join(lines), node)


def test_notebook_technique_min_rows_is_the_kinds_json_registry():
    assert _literal(_cell(), "TECHNIQUE_MIN_ROWS") == _kinds()["technique_min_rows"]


def test_notebook_regression_needs_100_rows_and_its_family_fallback_is_unchanged():
    namespace = {
        "TECHNIQUE_MIN_ROWS": _literal(_cell(), "TECHNIQUE_MIN_ROWS"),
        "GENIE_READINESS_THRESHOLDS": _literal(_cell(), "GENIE_READINESS_THRESHOLDS"),
    }
    exec(_function(_cell(), "analysis_minimum_rows"), namespace)
    helper = namespace["analysis_minimum_rows"]
    assert helper("Regression Analysis", "F") == 100
    assert helper("  regression   analysis ", "F") == 100
    assert helper("Trend Analysis", "F") == 1
    assert helper("Entity Matching", "K") == 2


def test_embed_check_catches_a_technique_minimum_edited_by_hand_in_the_notebook():
    lines = list(_cell())
    start, _stop = embed._registry_block(lines, "TECHNIQUE_MIN_ROWS")
    lines[start + 1] = re.sub(r'"Regression Analysis": \d+', '"Regression Analysis": 7', lines[start + 1], count=1)
    assert embed.registry_differences(lines, embed.kinds()) == ["TECHNIQUE_MIN_ROWS in the notebook differs from kinds.json technique_min_rows"]


def test_a_leave_out_filter_keeps_rows_whose_value_is_null_in_the_notebook():
    namespace = {
        "inspire_column": lambda column: f"`{column}`",
        "inspire_sql_list": lambda values: ", ".join(f"'{v}'" for v in values),
        "inspire_sql_literal": lambda value: f"'{value}'",
        "_inspire_re": re,
    }
    text = "".join(_cell())
    start = text.index("def inspire_segment_sql(item):")
    stop = text.index("\ndef ", start + 1)
    exec(text[start:stop], namespace)
    segment = namespace["inspire_segment_sql"]
    leave_out = segment({"column": "status", "op": "not in", "values": ["gold"]})
    assert leave_out == "(CAST(`status` AS STRING) NOT IN ('gold') OR `status` IS NULL)"
    assert segment({"column": "status", "op": "in", "values": ["gold"]}) == "CAST(`status` AS STRING) IN ('gold')"
