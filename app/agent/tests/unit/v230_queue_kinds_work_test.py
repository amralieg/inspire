"""Every queue kind gets its Work section: the page layout the App reads names its work from the kind registry, so a laid-out queue
(monitor, recommendations, process, network, location, explainer, impact, segments) has Work like a decision queue, and plan,
forecast, scenario, explore and ask kinds do not."""
import collections
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

import shell_sql  # noqa: E402

QUEUE_CONTRACTS = {"decision_queue", "monitor", "recommendations", "process", "network", "location", "explainer", "impact", "segments"}

with open(os.path.join(SHELL, "kinds.json"), encoding="utf-8") as handle:
    KINDS = json.load(handle)
LAYOUTS = {layout["id"]: layout for layout in KINDS["layouts"]}


def example(layout):
    name = os.path.join("examples", f"{layout}.json") if layout != "decision_queue" else "example_page.json"
    with open(os.path.join(SHELL, name), encoding="utf-8") as handle:
        page = json.load(handle)
    page["layout"] = layout
    return page


def is_queue_kind(kind):
    return kind["contract"] in QUEUE_CONTRACTS and not LAYOUTS[kind["layout"]].get("informational")


def test_25_of_the_40_kinds_are_queues_by_the_plan_contracts():
    queues = [k for k in KINDS["kinds"] if is_queue_kind(k)]
    assert len(KINDS["kinds"]) == 40
    assert len(queues) == 25
    assert collections.Counter(k["contract"] for k in queues) == {"decision_queue": 5, "monitor": 5, "explainer": 2, "recommendations": 2,
                                                                 "location": 1, "impact": 3, "network": 3, "segments": 3, "process": 1}


@pytest.mark.parametrize("kind", KINDS["kinds"], ids=lambda k: k["id"])
def test_every_queue_kind_page_names_its_work_and_no_other_kind_does(kind):
    page = example(kind["layout"])
    work = shell_sql.public_layout(page)["work"]
    assert work == ("queue" if is_queue_kind(kind) else ""), (kind["id"], kind["layout"], kind["contract"])


def test_an_unknown_layout_has_no_work_and_a_page_with_no_layout_is_a_decision_queue():
    assert shell_sql.layout_work("no_such_layout") == ""
    page = example("decision_queue")
    del page["layout"]
    assert shell_sql.public_layout(page)["work"] == "queue"


def test_the_notebook_copy_of_the_shell_names_the_same_work_for_every_kind(agent_ns, tmp_path):
    payload = agent_ns["implement_app_shell_payload"](agent_ns["inspire_notebook_asset"]("app_shell"))
    nb_sql = agent_ns["implement_app_shell_modules"](str(tmp_path / "_shell"), payload["files"])["shell_sql"]
    for kind in KINDS["kinds"]:
        page = copy.deepcopy(example(kind["layout"]))
        assert nb_sql.public_layout(page)["work"] == shell_sql.public_layout(page)["work"], kind["id"]
