"""The Dashboard builder draws every page shape the App builder can produce: each kind layout's example page, with and without a
decision list, offline."""
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

EXAMPLES = sorted(n[:-5] for n in os.listdir(os.path.join(SHELL, "examples")) if n.endswith(".json"))


def example(name):
    with open(os.path.join(SHELL, "examples", f"{name}.json"), encoding="utf-8") as handle:
        return json.load(handle)


@pytest.fixture
def nb_sql(agent_ns, tmp_path):
    payload = agent_ns["implement_app_shell_payload"](agent_ns["inspire_notebook_asset"]("app_shell"))
    return agent_ns["implement_app_shell_modules"](str(tmp_path / "_shell"), payload["files"])["shell_sql"]


def _widgets(doc):
    return {item["widget"]["name"]: item["widget"] for board in doc["pages"] for item in board["layout"]}


def _header(doc):
    return "".join(_widgets(doc)["header"]["multilineTextboxSpec"]["lines"])


def test_the_examples_cover_layouts_with_and_without_a_decision_list():
    decides = {name: shell_sql.public_layout(example(name))["decides"] for name in EXAMPLES}
    assert {n for n, d in decides.items() if not d} >= {"dashboard", "agent_chat"}
    assert decides["scenario_lab"]


@pytest.mark.parametrize("name", EXAMPLES)
def test_the_dashboard_builds_from_every_layout_example_page(agent_ns, nb_sql, name):
    page = example(name)
    decides = shell_sql.public_layout(page)["decides"]
    doc = agent_ns["implement_dashboard_from_page"](page, nb_sql, "main.demo.thing_out", {})
    widgets, names = _widgets(doc), [d["name"] for d in doc["datasets"]]
    assert ("records" in widgets) is decides, name
    assert (shell_sql.RECORDS_DATASET in names) is decides, name
    assert ("then act on the rows of" in _header(doc)) is (decides or bool(page.get("tables"))), name
    if decides:
        assert page["records"]["title"] in _header(doc)


def test_a_dashboard_layout_page_has_no_records_and_still_draws_its_kpis_charts_and_tables(agent_ns, nb_sql):
    page = example("dashboard")
    assert "records" not in page and shell_sql.RECORDS_DATASET not in [d["name"] for d in page["datasets"]]
    doc = agent_ns["implement_dashboard_from_page"](page, nb_sql, "main.demo.thing_out", {})
    widgets = _widgets(doc)
    assert {f"kpi_{i}" for i in range(len(page["kpis"]))} <= set(widgets)
    assert {f"chart_{i}" for i in range(len(page["charts"]))} <= set(widgets)
    assert {f"table_{i}" for i in range(len(page.get("tables") or []))} <= set(widgets)
    assert "records" not in agent_ns["implement_dashboard_drawn"](page, doc)


def test_a_layout_with_a_decision_list_that_lost_its_records_section_names_the_missing_section(agent_ns, nb_sql):
    page = copy.deepcopy(example("location_view"))
    page.pop("records")
    with pytest.raises(RuntimeError, match="records section"):
        agent_ns["implement_dashboard_from_page"](page, nb_sql, "main.demo.thing_out", {})


def test_a_layout_with_a_decision_list_that_lost_its_records_dataset_names_the_missing_dataset(agent_ns, nb_sql):
    page = copy.deepcopy(example("location_view"))
    page["datasets"] = [d for d in page["datasets"] if d["name"] != shell_sql.RECORDS_DATASET]
    with pytest.raises(RuntimeError, match=f"dataset named {shell_sql.RECORDS_DATASET}"):
        agent_ns["implement_dashboard_from_page"](page, nb_sql, "main.demo.thing_out", {})


def _allowed(page):
    return sorted({t for d in page["datasets"] for t in __import__("re").findall(r"\b(main\.[a-z_]+\.[a-z_]+)", d["sql"])})


@pytest.mark.parametrize("name", EXAMPLES)
def test_the_dashboard_check_asks_for_the_decision_list_only_on_a_page_that_has_one(agent_ns, nb_sql, name):
    page = example(name)
    doc = agent_ns["implement_dashboard_from_page"](page, nb_sql, "main.demo.thing_out", {})
    decision = nb_sql.RECORDS_DATASET if isinstance(page.get("records"), dict) else ""
    _doc, errors = agent_ns["check_dashboard_definition"](doc, _allowed(page) + ["main.demo.thing_out"], decision)
    assert not [e for e in errors if "no dataset named" in e or "must be the decision list" in e], (name, errors)
    if not decision:
        assert not [e for e in errors if "decision list" in e], (name, errors)


def test_the_dashboard_check_still_refuses_a_missing_decision_list_when_it_is_asked_for(agent_ns, nb_sql):
    page = example("dashboard")
    doc = agent_ns["implement_dashboard_from_page"](page, nb_sql, "main.demo.thing_out", {})
    _doc, errors = agent_ns["check_dashboard_definition"](doc, _allowed(page) + ["main.demo.thing_out"], nb_sql.RECORDS_DATASET)
    assert any(f"no dataset named {nb_sql.RECORDS_DATASET}" in e for e in errors), errors


def test_a_column_filter_ask_on_the_records_of_a_page_without_a_decision_list_is_refused_not_skipped(agent_ns, nb_sql):
    gate = agent_ns["implement_vibes_gate"]
    page = example("dashboard")
    verdict = gate({"kind": "column_filter", "value": "region"}, page, "records", "App page x", {"shell_sql": nb_sql})
    assert verdict is not None and verdict[0] is False and "is not a table" in verdict[1], verdict
    listed = example("location_view")
    verdict = gate({"kind": "column_filter", "value": "region"}, listed, "records", "App page x", {"shell_sql": nb_sql})
    assert verdict is not None and "is not a table" not in verdict[1], verdict
