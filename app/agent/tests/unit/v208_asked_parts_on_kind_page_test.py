"""A kind page holds the charts, KPIs and tables the user asks for after its own parts: Inspire sets the page layout from the use case's
kind, so an asked line, bar or table goes in the charts or tables section of that layout and the kind's own parts stay, offline."""
import copy
import json
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SHELL = os.path.join(ROOT, "agent", "app_shell")
SERVER = os.path.join(SHELL, "server")
for folder in (SERVER, os.path.dirname(os.path.abspath(__file__))):
    if folder not in sys.path:
        sys.path.insert(0, folder)

import shell_sql  # noqa: E402


def example(name):
    with open(os.path.join(SHELL, "examples", f"{name}.json"), encoding="utf-8") as handle:
        return json.load(handle)


def corridor_watch(page, section=True):
    out = copy.deepcopy(page)
    out["title"] = "Corridor Watch"
    dataset = out["datasets"][0]["name"]
    columns = [c for c in (out.get("charts") or [{}])[0].get("y") or []][:1] or ["fare_value"]
    asked = [("fare_by_hour", "line"), ("trips_per_corridor", "bar"), ("average_fare_by_pickup", "bar")]
    for ident, kind in asked:
        out.setdefault("charts", []).append(dict(copy.deepcopy(out["charts"][0]), id=ident, type=kind, title=ident.replace("_", " "),
                                                 **({"section": "charts"} if section else {})))
        out["charts"][-1].pop("series", None)
        if not section:
            out["charts"][-1].pop("section", None)
        out["charts"][-1]["y"] = columns
    table = dict(copy.deepcopy((out.get("tables") or [{}])[0]), id="all_corridors", title="All corridors", dataset=dataset)
    table.pop("section", None)
    if section:
        table["section"] = "tables"
    out.setdefault("tables", []).append(table)
    return out


def asked_problems(page):
    names = {"fare_by_hour", "trips_per_corridor", "average_fare_by_pickup", "all_corridors"}
    return [p for p in shell_sql.layout_problems(page, set()) if any(n in p for n in names)]


def test_the_corridor_watch_asks_fit_the_network_page_and_its_graph_stays():
    network = example("network_explorer")
    assert shell_sql.layout_problems(network, set()) == []
    page = corridor_watch(network)
    assert page["layout"] == "network_explorer"
    assert asked_problems(page) == []
    assert any(c.get("section") == "graph" for c in page["charts"]), "the network page keeps its graph"
    sections = shell_sql.public_layout(page)["sections"]
    assert sections[-2:] == ["charts", "tables"] and sections.index("graph") < sections.index("charts")


def test_an_asked_chart_with_no_section_is_told_the_section_it_goes_in_not_a_layout_it_cannot_take():
    found = asked_problems(corridor_watch(example("network_explorer"), section=False))
    assert found and all("decision_queue" not in p for p in found), found
    assert any("chart fare_by_hour names section None; on a network_explorer page a line goes in one of: charts" in p for p in found), found
    assert any("table all_corridors names section None; on a network_explorer page a table goes in one of: " in p
               and p.endswith("tables") for p in found), found


@pytest.mark.parametrize("name", ["network_explorer", "location_view", "planner", "agent_chat", "recommendation_desk"])
def test_every_kind_layout_lists_the_asked_sections_after_its_own_and_the_default_layout_is_unchanged(name):
    own = [str(s) for s in shell_sql.layouts()[name]["sections"]]
    assert shell_sql.layout_sections(name) == own + [s for s in shell_sql.ASKED_SECTIONS if s not in own]
    assert shell_sql.layout_sections(shell_sql.DEFAULT_LAYOUT) == [str(s) for s in shell_sql.layouts()[shell_sql.DEFAULT_LAYOUT]["sections"]]
    assert shell_sql.layout_sections("dashboard") == [str(s) for s in shell_sql.layouts()["dashboard"]["sections"]]


def test_the_asked_sections_do_not_raise_the_chart_minimum_of_a_layout_without_charts_of_its_own():
    chat = {"layout": "agent_chat"}
    assert shell_sql.chart_sections(chat) is False


def test_a_chart_no_section_draws_is_still_refused_and_the_way_out_is_one_genie_can_take():
    page = copy.deepcopy(example("network_explorer"))
    page["charts"].append({"id": "corridor_plan", "type": "gantt", "section": "charts"})
    found = [p for p in shell_sql.layout_problems(page, set()) if "corridor_plan" in p]
    assert found == ["chart corridor_plan is a gantt, which no section of a network_explorer page draws, and Inspire sets the "
                     "network_explorer layout from the use case's kind: draw what it shows as another type, or remove it from this page"]


def test_an_asked_line_in_the_graph_section_is_still_refused():
    page = corridor_watch(example("network_explorer"))
    page["charts"][-3]["section"] = "graph"
    assert any("chart fare_by_hour names section 'graph'; on a network_explorer page a line goes in one of: charts" in p
               for p in asked_problems(page)), asked_problems(page)


def test_inspire_sets_the_kind_layout_on_the_page_genie_writes_and_the_asks_still_fit(agent_ns):
    raw = corridor_watch(example("network_explorer"))
    raw["layout"] = "decision_queue"
    page = agent_ns["implement_app_page"](raw, "N02-U02", {}, layout="network_explorer")
    assert page["layout"] == "network_explorer"
    assert asked_problems(page) == []


def test_the_genie_brief_names_the_asked_sections_of_a_kind_layout(agent_ns):
    brief = agent_ns["implement_layout_brief"]("network_explorer", {}, shell_sql)
    assert "charts (a chart; put any chart here)" in brief and "tables (a table; put tables here)" in brief, brief
    assert "The charts and tables sections come after the Network explorer parts" in brief, brief
    assert "the network_explorer layout stays" in brief
