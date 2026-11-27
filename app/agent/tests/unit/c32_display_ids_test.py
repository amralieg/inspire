"""c32_pyids (REQ-569): every people-facing name the Implement build writes names a use case by its display id AIx-UCx.

A session saved before REQ-569 stores Nx-Uy; its tables are never rewritten, so the stored id stays in every lookup, key, filter and log
line, while the App title, Dashboard name, Genie Agent title, description, instructions and sample questions, notebook file name and
Alert name print AIx-UCy. A new-form id and a text without an id are never changed."""
import json
import os
import sys

import pytest

pytest.importorskip("sqlglot")

TESTS = os.path.dirname(os.path.abspath(__file__))
if TESTS not in sys.path:
    sys.path.insert(0, TESTS)

from v140_implement_test import _churn_page, _FileRunner, _output_context, _output_inspire  # noqa: E402
from v142_dash_test import _doc, _flow, _runner  # noqa: E402
from v142_genie_test import RESULT, _deploy_inspire, _rich_space  # noqa: E402

OLD, NEW, STORED_NEW = "N01-U02", "AI01-UC02", "AI03-UC04"


def _context(ns, uc_id=OLD, **outputs):
    context = _output_context(ns, **outputs)
    context["uc_id"] = uc_id
    context["key"] = (5150, uc_id, 2)
    return context


def _clean(text, new=NEW):
    assert new in text and OLD not in text, text


def test_the_text_helper_maps_every_old_id_inside_a_text_and_nothing_else(agent_ns):
    show = agent_ns["inspire_display_text"]
    assert show(f"{OLD} Churn; also N12-U03, and {NEW}.") == f"{NEW} Churn; also AI12-UC03, and {NEW}."
    assert show(f"{STORED_NEW} Churn") == f"{STORED_NEW} Churn"
    assert show("No id here, UN01-U02x or N1") == "No id here, UN01-U02x or N1" and show(None) == ""


def test_the_default_title_of_a_use_case_prints_the_display_id(agent_ns):
    title = agent_ns["implement_default_title"]
    _clean(title(OLD, {"Name": "Predict churn"}))
    assert title(STORED_NEW, {"Name": "Predict churn"}) == f"{STORED_NEW} Predict churn"
    assert title(OLD, None) == NEW


def test_the_output_titles_print_the_display_id_whether_chosen_or_defaulted(agent_ns):
    title = agent_ns["implement_output_title"]
    for name in ("dashboard", "genie_space", "alert", "app"):
        _clean(title(_context(agent_ns), name, {}))
        chosen = _context(agent_ns, **{f"{name}_name": f"{OLD} chosen name"})
        _clean(title(chosen, name, {}))
    kept = _context(agent_ns, dashboard_name=f"{STORED_NEW} Plain")
    assert title(kept, "dashboard", {}) == f"{STORED_NEW} Plain"
    assert title(_context(agent_ns, dashboard_name="Plain name"), "dashboard", {}) == "Plain name"


def test_the_alert_name_texts_and_digest_print_the_display_id(agent_ns, tmp_path):
    inst, _calls = _output_inspire(agent_ns, tmp_path)
    _clean(inst._implement_alert_name(_context(agent_ns)))
    assert inst._implement_alert_name(_context(agent_ns, alert_name="Plain")) == "Plain"
    shell = inst._implement_app_shell()[1]
    context = _context(agent_ns)
    summary, description = agent_ns["implement_alert_texts"](shell["shell_alerts"], OLD, context["use_case"], context["spec"]["outputs"])
    assert OLD not in summary + description
    body = agent_ns["implement_digest_body"](shell, OLD, context["use_case"], "SELECT 1", "wh", [], {}, "")
    assert OLD not in json.dumps(body) and NEW in json.dumps(body)


def test_the_notebook_file_name_prints_the_display_id_and_a_new_id_is_unchanged(agent_ns, tmp_path):
    inst, _calls = _output_inspire(agent_ns, tmp_path)
    _d, path, name = inst._build_notebook_workspace_paths({"No": OLD, "Name": "Churn", "Business Domain": "Sales", "Subdomain": "X"})
    _clean(name)
    assert OLD not in path
    assert inst._build_notebook_workspace_paths({"No": STORED_NEW, "Name": "Churn"})[2] == f"{STORED_NEW} - Churn"


def test_the_dashboard_display_name_prints_the_display_id_and_its_queries_keep_the_stored_one(agent_ns, tmp_path):
    inst, context, seen = _flow(agent_ns, tmp_path)
    context["uc_id"] = OLD
    inst._implement_dashboard(context, _runner(_churn_page(agent_ns)))
    body = next(c[2] for c in seen["calls"] if c[:2] == ("POST", "/api/2.0/lakeview/dashboards"))
    _clean(body["display_name"])
    assert _doc(seen)["datasets"]


def test_the_genie_title_description_instructions_and_questions_print_the_display_id_but_the_sql_keeps_the_stored_one(agent_ns, tmp_path):
    inst, calls, _ran = _deploy_inspire(agent_ns, tmp_path)
    space = _rich_space()
    space["config"]["sample_questions"][0]["question"] = [f"What does {OLD} say about churn?"]
    space["instructions"]["example_question_sqls"][0]["question"] = [f"What does {OLD} say about churn?"]
    space["instructions"]["text_instructions"][0]["content"] = [f"{OLD} ranks customers.\n"]
    space["instructions"]["example_question_sqls"][0]["sql"] = [f"SELECT entity_label FROM {RESULT} WHERE priority_tier = 'Act now' AND entity_label <> '{OLD}'"]
    definition = json.dumps({"title": f"{OLD} Churn desk", "description": f"For {OLD}", "serialized_space": space})
    runner = _FileRunner([{"exit": 0}], [{"genie_space.json": definition}])
    inst._implement_genie_space(_context(agent_ns), runner)
    (body, _q), = [c[2:] for c in calls if c[:2] == ("POST", "/api/2.0/genie/spaces")]
    posted = json.loads(body["serialized_space"])
    _clean(body["title"] + body["description"])
    assert OLD not in json.dumps(posted["config"]["sample_questions"]) and NEW in json.dumps(posted["config"]["sample_questions"])
    assert OLD not in json.dumps(posted["instructions"]["text_instructions"]) and NEW in json.dumps(posted["instructions"]["text_instructions"])
    assert f"entity_label <> '{OLD}'" in json.dumps(posted["instructions"]["example_question_sqls"])


def test_the_table_scope_of_a_use_case_still_filters_on_the_stored_id(agent_ns):
    sql = agent_ns["inspire_sql_literal"](OLD)
    assert sql == f"'{OLD}'" and agent_ns["inspire_display_use_case_id"](OLD) == NEW
    assert agent_ns["inspire_parse_use_case_id"](OLD) == (1, 2) == agent_ns["inspire_parse_use_case_id"](NEW)
