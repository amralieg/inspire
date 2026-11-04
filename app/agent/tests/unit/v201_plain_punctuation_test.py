"""No message the agent notebook shows a person uses an em or en dash: the sources it ships into every built notebook and the App
(the run controls, the result history, the redaction and the number text), and every message it raises, stops a run with or prints."""
import ast
import json
import os
import re

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
NOTEBOOK = os.path.join(ROOT, "agent", "dbx_inspire_ai_agent.ipynb")
DASH = re.compile("[\u2013\u2014]|&[mn]dash;|&#821[12];")
SHIPPED = ("REDACT_SOURCE", "GENIE_NUMBER_TEXT_SOURCE", "IMPLEMENT_RESULT_HISTORY_SOURCE", "GENIE_RUN_CONTROLS_TEMPLATE")
SHOWN = {"out", "print", "inspire_group_stop", "InspireRunStop", "ValueError", "RuntimeError", "TypeError", "KeyError", "PermissionError"}


def _code():
    cells = json.load(open(NOTEBOOK, encoding="utf-8"))["cells"]
    return [("".join(c["source"]), i) for i, c in enumerate(cells) if c["cell_type"] == "code"]


def _texts(node):
    return [n.value for n in ast.walk(node) if isinstance(n, ast.Constant) and isinstance(n.value, str)]


def _name(func):
    return func.id if isinstance(func, ast.Name) else func.attr if isinstance(func, ast.Attribute) else ""


def dash_messages(source, label):
    tree = ast.parse(source)
    hits = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in SHIPPED for t in node.targets):
            name = next(t.id for t in node.targets if isinstance(t, ast.Name))
            inner = ast.literal_eval(node.value) if isinstance(node.value, ast.Constant) else ""
            hits += [f"{label}:{name}:{i + 1}: {line.strip()[:120]}" for i, line in enumerate(inner.split("\n")) if DASH.search(line)]
            if name != "GENIE_RUN_CONTROLS_TEMPLATE" and inner:
                hits += dash_messages(inner, f"{label}:{name}")
        if isinstance(node, ast.Call) and _name(node.func) in SHOWN:
            hits += [f"{label}:{node.lineno}: {text.strip()[:120]}" for text in _texts(node) if DASH.search(text)]
    return sorted(set(hits))


def test_no_shipped_source_or_shown_message_of_the_notebook_uses_an_em_or_en_dash():
    hits = []
    for source, index in _code():
        hits += dash_messages(source, f"cell {index}")
    assert hits == []


@pytest.mark.parametrize("snippet", [
    'raise ValueError("the table is gone \u2014 choose another")',
    'out(f"Grouping: {n} groups \u2013 moved up")',
    'raise inspire_group_stop("no join &mdash; stop", run)',
    'IMPLEMENT_RESULT_HISTORY_SOURCE = r"""\nprint(\'a \u2014 b\')\n"""',
], ids=["raise", "out", "stop_entity", "shipped"])
def test_a_dash_in_a_shown_message_or_a_shipped_source_is_caught(snippet):
    assert dash_messages(snippet, "x"), "the scan must flag this dash (must-exclude)"


def test_a_dash_in_a_comment_or_an_unshown_string_is_not_a_message():
    assert dash_messages('# a \u2014 b\nPROMPT = "D1\u2013D11 are scored"\nlogger_name = "x"\n', "x") == []
