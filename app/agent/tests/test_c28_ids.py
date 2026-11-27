"""REQ-569: use case ids are AIx-UCx. The agent writes them for new runs; one helper maps old Nx-Ux ids; nothing prints Nx-Ux."""
import json
import logging
import os
import re

OLD = re.compile(r"\bN\d+-U\d+\b")
HERE = os.path.dirname(os.path.abspath(__file__))
PROMPTS = os.path.join(HERE, "..", "agent", "app_shell", "prompts.json")


def _inspire(ns):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = logging.getLogger("c28")
    return obj


def test_agent_numbers_new_use_cases_as_aix_ucx(agent_ns):
    ucs = [{"Business Domain": "A", "No": "x1"}, {"Business Domain": "A", "No": "x2"}, {"Business Domain": "B", "No": "x3"}]
    out = _inspire(agent_ns)._number_by_domain(ucs)
    assert [u["No"] for u in out] == ["AI01-UC01", "AI01-UC02", "AI02-UC01"]


def test_helper_maps_old_ids_and_keeps_new_ones(agent_ns):
    show = agent_ns["inspire_display_use_case_id"]
    assert show("N01-U02") == "AI01-UC02"
    assert show("N12-U103") == "AI12-UC103"
    assert show("AI01-UC02") == "AI01-UC02"
    assert show("not an id") == "not an id"
    assert show(None) == ""


def test_helper_parses_both_forms_to_the_same_numbers(agent_ns):
    parse = agent_ns["inspire_parse_use_case_id"]
    assert parse("N03-U07") == parse("AI03-UC07") == (3, 7)
    assert parse("AI-X-U1") is None


def test_natural_sort_orders_new_ids_by_number(agent_ns):
    key = _inspire(agent_ns)._natural_sort_key
    ids = ["AI01-UC10", "AI01-UC02", "AI02-UC01", "AI01-UC01"]
    assert [u["No"] for u in sorted(({"No": i} for i in ids), key=key)] == ["AI01-UC01", "AI01-UC02", "AI01-UC10", "AI02-UC01"]


def test_prompts_show_the_new_id_form_never_the_old_one():
    text = open(PROMPTS, encoding="utf-8").read()
    assert not OLD.search(text), OLD.findall(text)[:3]
    assert re.search(r"AI\d+-UC\d+", text)


def test_the_notebook_builds_no_old_style_id(agent_ns):
    src = open(os.path.join(HERE, "..", "agent", "dbx_inspire_ai_agent.ipynb"), encoding="utf-8").read()
    cells = json.loads(src)["cells"]
    code = "\n".join("".join(c["source"]) for c in cells if c["cell_type"] == "code")
    assert not re.search(r'f"N\{[^}]*\}-U\{', code)
    assert not OLD.search(code), OLD.findall(code)[:3]
