"""A display-name change on a built App is a restyle of that App: the App's page and hub titles follow the name, and the
planner treats the change as a restyle, not an unchanged spec."""
import json
import os

FIXTURE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures", "implement_change_classes.json")
RENAMED = "Churn early warning"


def _case():
    fixture = json.load(open(FIXTURE))
    return next(case for case in fixture["cases"] if case["name"] == "display name changed on a built App")


def test_the_restyle_writes_the_new_title_into_the_own_page_and_the_settings(agent_ns):
    settings = {"version": 1, "title": "Forecast demand", "business": ""}
    pages = [{"id": "p1", "title": "Forecast demand", "use_case_id": "N01-U01"}, {"id": "p2", "title": "Other page"}]
    new_settings, new_pages = agent_ns["implement_app_renamed"](settings, pages, "p1", RENAMED)
    files = agent_ns["implement_app_source"]({}, "settings.json", "pages", new_settings, new_pages)
    assert json.loads(files["settings.json"])["title"] == RENAMED
    assert json.loads(files["pages/p1.json"])["title"] == RENAMED
    assert json.loads(files["pages/p2.json"])["title"] == "Other page"
    assert pages[0]["title"] == "Forecast demand", "the held pages are not changed in place"


def test_a_blank_name_or_an_unknown_page_keeps_every_title(agent_ns):
    settings = {"version": 1, "title": "Forecast demand"}
    pages = [{"id": "p1", "title": "Forecast demand"}]
    assert agent_ns["implement_app_renamed"](settings, pages, "p1", "   ")[0]["title"] == "Forecast demand"
    _, unchanged = agent_ns["implement_app_renamed"](settings, pages, "missing", RENAMED)
    assert unchanged[0]["title"] == "Forecast demand"


def test_a_long_name_is_capped_to_the_title_limit(agent_ns):
    new_settings, new_pages = agent_ns["implement_app_renamed"]({"title": "x"}, [{"id": "p1", "title": "x"}], "p1", "n" * 120)
    assert len(new_settings["title"]) == 80 and new_pages[0]["title"] == "n" * 80


def test_a_name_only_change_plans_a_restyle_of_the_built_app(agent_ns):
    case = _case()
    plan = agent_ns["implement_plan"](case["previous"], case["current"], previous_assets={"dashboard": "d1", "genie_space": "g1", "app": "churn-desk"}, has_built_notebook=True)
    assert plan["restyle"] == ["app"]
    assert plan["refresh"] == ["app"]
    assert plan["build"] == []
    assert plan["refill"] is False
