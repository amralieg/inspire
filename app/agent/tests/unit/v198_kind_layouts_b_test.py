"""The process_flow, location_view, network_explorer and agent_chat layouts: their examples, the validator rules that reject a bad page,
the Genie rating route and the dashboard chart each new chart type becomes, offline."""
import copy
import json
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SHELL = os.path.join(ROOT, "agent", "app_shell")
SERVER = os.path.join(SHELL, "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_core  # noqa: E402
import shell_db  # noqa: E402
import shell_sql  # noqa: E402
from v141_app_shell_test import SETTINGS, FakeResponse, FakeWorkspace, app_dir, call, workspace  # noqa: E402

LAYOUTS = ("process_flow", "location_view", "network_explorer", "agent_chat")
with open(os.path.join(SHELL, "kinds.json"), encoding="utf-8") as _handle:
    KINDS = json.load(_handle)
EXAMPLES = {}
for _name in LAYOUTS:
    with open(os.path.join(SHELL, "examples", f"{_name}.json"), encoding="utf-8") as _handle:
        EXAMPLES[_name] = json.load(_handle)


def example(name, **changes):
    out = copy.deepcopy(EXAMPLES[name])
    out.update(changes)
    return out


def problems(page):
    return shell_sql.spec_problems(page) or shell_sql.quality_problems(page)


def layout(ident):
    return next(l for l in KINDS["layouts"] if l["id"] == ident)


def chart(page, ident):
    return next(c for c in page["charts"] if c["id"] == ident)


@pytest.mark.parametrize("name", LAYOUTS)
def test_each_example_page_passes_the_validator_reads_its_companion_tables_and_its_layout_is_served(name):
    page = EXAMPLES[name]
    assert layout(name)["enabled"] is True and name in shell_sql.enabled_layouts()
    assert page["layout"] == name and page["version"] == 2
    assert problems(page) == []
    assert shell_sql.contract_problems(page) == []
    assert layout(name)["sections"][0] == "todo"


@pytest.mark.parametrize("name", ("process_flow", "location_view", "network_explorer"))
def test_each_decision_layout_names_its_choices_with_a_status_and_a_reason_list_for_the_dismissal(name):
    choices = layout(name)["choices"]
    assert len(choices) >= 2 and len({c["id"] for c in choices}) == len(choices)
    assert {c["status"] for c in choices} <= {"Done", "In progress", "Dismissed"}
    dismissed = [c for c in choices if c["status"] == "Dismissed"]
    assert len(dismissed) == 1 and len(dismissed[0]["reasons"]) >= 3
    assert shell_sql.public_parts(EXAMPLES[name])["choices"] == choices


def test_agent_chat_has_no_contract_and_needs_five_to_twelve_distinct_questions():
    assert layout("agent_chat")["contract"] is None
    assert layout("agent_chat")["min_items"] == {"suggested_questions": 5}
    page = EXAMPLES["agent_chat"]
    assert 5 <= len(page["questions"]) <= 12 and problems(page) == []
    few = example("agent_chat", questions=page["questions"][:4])
    assert any("5 to 12" in p for p in problems(few)), problems(few)
    many = example("agent_chat", questions=[f"Which region grew most in month {i}?" for i in range(13)])
    assert any("5 to 12" in p for p in problems(many)), problems(many)
    twice = example("agent_chat", questions=page["questions"][:4] + [page["questions"][0]])
    assert "each suggested question is asked once" in problems(twice), problems(twice)


def test_agent_chat_rejects_record_actions_and_a_switched_off_genie_because_genie_answers_only(capsys):
    records = copy.deepcopy(EXAMPLES["process_flow"]["records"])
    with_records = example("agent_chat", records=records)
    found = problems(with_records)
    assert any("only answers questions through Genie and records no decisions" in p for p in found), found
    off = example("agent_chat", genie=None)
    assert any("needs its Genie Agent" in p for p in problems(off)), problems(off)
    assert "[KIND-CHAT FIRED]" in capsys.readouterr().out


def test_only_a_page_without_chart_sections_may_draw_no_charts():
    chat = EXAMPLES["agent_chat"]
    assert chat.get("charts") in (None, []) and problems(chat) == []
    assert shell_sql.chart_sections(chat) is False
    process = example("process_flow", charts=[])
    assert any("chart" in p for p in problems(process)), problems(process)
    assert shell_sql.chart_sections(EXAMPLES["process_flow"]) is True


def test_a_map_point_sums_no_coordinates_and_a_graph_names_its_groups_as_text(capsys):
    page = example("location_view")
    chart(page, "points")["y"][1]["expression"] = "SUM(g.lat)"
    assert any("latitude" in p or "lat" in p for p in problems(page)), problems(page)
    page = example("network_explorer")
    chart(page, "graph")["y"][1]["format"] = "number"
    assert any("text" in p for p in problems(page)), problems(page)
    assert "[KIND-CHART FIRED]" in capsys.readouterr().out


@pytest.mark.parametrize("name, ident", [("process_flow", "map"), ("process_flow", "cycle"), ("location_view", "countries"),
                                        ("location_view", "points"), ("network_explorer", "graph")])
def test_a_new_chart_type_is_refused_on_a_page_without_a_layout_and_kept_on_its_own_layout(name, ident, capsys):
    kind = chart(example(name), ident)["type"]
    refusal = f"chart {ident} is a {kind}, which only a laid-out page draws"
    assert not any(refusal in p for p in shell_sql.part_problems(example(name)))
    plain = example(name, layout=shell_sql.DEFAULT_LAYOUT)
    assert any(refusal in p for p in shell_sql.part_problems(plain)), shell_sql.part_problems(plain)
    assert "[KIND-CHART FIRED]" in capsys.readouterr().out


def test_the_server_and_the_app_agree_on_which_chart_types_load_which_lazy_module():
    with open(os.path.join(SHELL, "web", "src", "kindCharts.js"), encoding="utf-8") as handle:
        line = next(l for l in handle.read().splitlines() if l.startswith("export const KIND_LAZY = "))
    app = dict(pair.strip().split(": ") for pair in line.split("{", 1)[1].rsplit("}", 1)[0].replace("'", "").split(","))
    assert app == shell_sql.KIND_LAZY_CHARTS
    assert not set(shell_sql.KIND_LAZY_CHARTS) & set(shell_sql.LAZY_CHARTS)


def test_the_box_plot_takes_exactly_five_measures_and_no_series_and_the_process_map_needs_its_to_step():
    page = example("process_flow")
    chart(page, "cycle")["y"] = chart(page, "cycle")["y"][:4]
    assert any("cycle" in p for p in problems(page)), problems(page)
    page = example("process_flow")
    chart(page, "cycle")["series"] = {"column": "region", "top": 5}
    assert any("cycle" in p for p in problems(page)), problems(page)
    page = example("process_flow")
    del chart(page, "map")["series"]
    assert any("map" in p for p in problems(page)), problems(page)


def test_a_process_map_that_does_not_read_the_transitions_table_is_rejected():
    page = example("process_flow")
    moves = next(d for d in page["datasets"] if d["name"] == chart(page, "map")["dataset"])
    assert "__transitions" in moves["sql"]
    moves["sql"] = moves["sql"].replace("__transitions", "__moves")
    found = shell_sql.contract_problems(page)
    assert any("__transitions" in p for p in found), found


def test_series_charts_order_by_the_category_and_others_by_their_first_measure():
    page = EXAMPLES["process_flow"]
    flow_sql = shell_sql.chart_query(page, "map", {})[0]
    box_sql = shell_sql.chart_query(page, "cycle", {})[0]
    assert "ORDER BY 1 ASC" in flow_sql and "LIMIT 5000" in flow_sql
    assert "ORDER BY 2 DESC" in box_sql


class RatingWorkspace(FakeWorkspace):
    def __init__(self):
        super().__init__()
        self.rated = []

    def genie_feedback(self, space, conversation, message, rating):
        self.rated.append((space, conversation, message, rating))


def rating_shell(tmp_path, settings=None):
    ws = RatingWorkspace()
    s = shell_core.Shell(app_dir(tmp_path, settings), env={"DATABRICKS_WAREHOUSE_ID": "wh1", "DATABRICKS_HOST": "dbc-1.example.com"},
                         sp_factory=lambda: ws, user_factory=lambda host, token: ws)
    return s, ws


def test_genie_feedback_sends_the_rating_and_rejects_a_bad_rating_or_bad_ids(tmp_path, capsys):
    s, ws = rating_shell(tmp_path)
    body = {"conversation_id": "c1", "message_id": "m1", "rating": "POSITIVE"}
    assert call(s, "POST", "genie/feedback", body=body) == (200, {"rating": "POSITIVE"})
    assert ws.rated == [(SETTINGS["genie"]["space_id"], "c1", "m1", "POSITIVE")]
    assert "[GENIE-FEEDBACK FIRED]" in capsys.readouterr().out
    assert call(s, "POST", "genie/feedback", body=dict(body, rating="LOVE"))[0] == 400
    assert call(s, "POST", "genie/feedback", body=dict(body, message_id="m1/../../x"))[0] == 400
    assert call(s, "POST", "genie/feedback", body=dict(body, rating=None))[0] == 400
    assert len(ws.rated) == 1


def test_genie_feedback_is_refused_when_genie_is_off(tmp_path):
    off = dict(SETTINGS, genie=None, genie_note="The Genie Agent did not build")
    s, ws = rating_shell(tmp_path, off)
    status, out = call(s, "POST", "genie/feedback", body={"conversation_id": "c1", "message_id": "m1", "rating": "NEGATIVE"})
    assert status == 409 and ws.rated == []


def test_the_workspace_posts_the_rating_to_the_genie_message_feedback_api():
    ws, session = workspace([FakeResponse(payload={})])
    ws.genie_feedback("sp1", "c1", "m1", "NEGATIVE")
    assert session.calls[0]["method"] == "POST"
    assert session.calls[0]["url"].endswith("/api/2.0/genie/spaces/sp1/conversations/c1/messages/m1/feedback")
    assert session.calls[0]["body"] == {"rating": "NEGATIVE"}


def test_every_new_chart_type_becomes_a_dashboard_bar_and_drops_the_measures_a_bar_cannot_show(agent_ns):
    widgets = agent_ns["IMPLEMENT_DASHBOARD_CHART_WIDGETS"]
    assert {t: widgets[t] for t in ("flow", "box", "graph", "map_points", "map_regions")} == dict.fromkeys(
        ("flow", "box", "graph", "map_points", "map_regions"), "bar")
    assert {"flow", "box", "graph", "map_points", "map_regions"} <= set(shell_sql.CHART_TYPES)
    flat = agent_ns["implement_dashboard_flat"]
    points = chart(EXAMPLES["location_view"], "points")
    assert [y["label"] for y in flat(points)["y"]] == [points["y"][0]["label"]]
    graph = chart(EXAMPLES["network_explorer"], "graph")
    assert flat(graph)["series"] is None and len(flat(graph)["y"]) == 1
    flow = chart(EXAMPLES["process_flow"], "map")
    assert flat(flow)["series"] == flow["series"] and len(flat(flow)["y"]) == 1
    box = chart(EXAMPLES["process_flow"], "cycle")
    assert flat(box) is box
    measure = lambda dataset, name, expression, y: {"name": name, "expression": expression}  # noqa: E731
    made = agent_ns["_implement_dashboard_chart"]("c0", dict(points, hint="h"), [], measure)
    assert [f["name"] for f in made["queries"][0]["query"]["fields"]] == ["entity", "c0_m0"]
    assert made["spec"]["widgetType"] == "bar"
