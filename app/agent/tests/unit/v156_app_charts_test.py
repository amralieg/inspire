"""The kinds of chart a use case's App draws and the App screens a business user turns off in the wizard: one vocabulary in the
shell, the notebook's spec contract, the prompt and page check Genie gets, the App settings and the screens the App serves, offline."""
import json
import os
import subprocess
import sys

import pytest

from v120_artifacts_support import FakeSpark  # noqa: F401
from v140_implement_test import VALID, _app_flow, _app_shell, _churn_page
from v141_app_shell_test import SETTINGS, call
from v142_merge_test import OWN_SOURCE, _host_files, _host_page, _restyle_inspire
from v149_impact_test import Workspace as ImpactWorkspace, shell as impact_shell
import shell_core
import shell_db
import shell_sql

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
NO_PARETO = "the page draws no biggest first chart: add one of type pareto"
NO_SPLIT = "the page draws no share of a whole chart: add one of type donut"


def _outputs(**changes):
    return dict(VALID["outputs"], **changes)


def _without(page, *types):
    return dict(page, charts=[c for c in page["charts"] if c["type"] not in types])


def test_the_notebook_and_the_shell_name_the_same_chart_kinds_and_screens(agent_ns):
    assert agent_ns["IMPLEMENT_APP_CHART_KINDS"] == shell_sql.CHART_KINDS
    assert tuple(shell_sql.CHART_KIND_TYPES) == shell_sql.CHART_KINDS == tuple(shell_sql.CHART_KIND_LABELS)
    typed = [t for kind in shell_sql.CHART_KINDS for t in shell_sql.CHART_KIND_TYPES[kind]]
    assert sorted(typed + list(shell_sql.LAYOUT_ONLY_CHARTS)) == sorted(shell_sql.CHART_TYPES), \
        "every chart type belongs to exactly one kind, or is drawn only by a layout"
    assert set(shell_sql.CHART_PICK) <= set(shell_sql.CHART_KINDS)
    assert len(shell_sql.CHART_PICK) == agent_ns["IMPLEMENT_APP_CHARTS_MIN"] == shell_sql.CAPS["charts"][0]
    assert tuple(agent_ns["IMPLEMENT_APP_PAGES"]) == shell_core.SCREENS and all(agent_ns["IMPLEMENT_APP_PAGES"].values())
    assert "app_pages" in agent_ns["IMPLEMENT_RESTYLE_OPTIONS"]["app"] and "app_charts" not in agent_ns["IMPLEMENT_RESTYLE_OPTIONS"]["app"]
    assert {"app_charts", "app_pages"} <= set(agent_ns["IMPLEMENT_OUTPUT_OPTIONS"]["app"])


def test_choices_default_to_inspires_pick_and_every_screen_on(agent_ns):
    choices, errors = agent_ns["implement_app_choices"]({"app_access": "sp"})
    assert errors == [] and choices["app_charts"] == [] and choices["app_pages"] == {"runs": True, "impact": True}
    choices, errors = agent_ns["implement_app_choices"]({"app_access": "sp", "app_charts": [" Pareto", "bars", "TREND", "bars"],
                                                          "app_pages": {"impact": False, "runs": None}})
    assert errors == []
    assert choices["app_charts"] == ["trend", "bars", "pareto"], "the kinds keep one order, so reordering them is no change"
    assert choices["app_pages"] == {"runs": True, "impact": False}
    assert agent_ns["implement_app_choices"]({"app_access": "sp", "app_charts": []})[0]["app_charts"] == []


@pytest.mark.parametrize("outputs,needle", [
    ({"app_charts": ["trend", "bars"]}, "pick at least 3 kinds of chart for the App, not 2"),
    ({"app_charts": ["trend", "trend", "bars"]}, "pick at least 3 kinds of chart for the App, not 2"),
    ({"app_charts": ["trend", "bars", "pie"]}, "the App has no kind of chart 'pie'; its kinds are trend, bars, split, pareto, scatter"),
    ({"app_charts": "trend"}, "the App charts must be a list of the kinds of chart the App draws, from trend, bars, split, pareto, scatter"),
    ({"app_pages": {"genie": False}}, "the App has no page 'genie' to turn on or off; Things to fix and Ask Genie are always on, and "
                                      "only runs, impact can be turned off"),
    ({"app_pages": {"overview": False}}, "the App has no page 'overview' to turn on or off"),
    ({"app_pages": {"impact": "no"}}, "the App page impact must be true or false, not 'no'"),
    ({"app_pages": "impact"}, "outputs.app_pages must be an object"),
])
def test_bad_chart_kinds_or_screens_name_the_problem(agent_ns, outputs, needle):
    _choices, errors = agent_ns["implement_app_choices"](dict({"app_access": "sp"}, **outputs))
    assert any(needle in e for e in errors), errors


def test_turning_a_screen_off_restyles_the_app_and_new_chart_kinds_rebuild_its_page(agent_ns):
    validate, plan_fn = agent_ns["validate_implement_spec"], agent_ns["implement_plan"]
    assets = {"dashboard": "d1", "genie_space": "g1", "app": "churn-desk", "preview_run_id": 5}
    before = validate(VALID)[0]
    assert before["outputs"]["app_pages"] == {"runs": True, "impact": True} and before["outputs"]["app_charts"] == []
    screens = validate(dict(VALID, outputs=_outputs(app_pages={"impact": False})))[0]
    plan = plan_fn(before, screens, assets, has_built_notebook=True)
    assert plan["refresh"] == ["app"] and plan["restyle"] == ["app"] and not plan["refill"]
    kinds = validate(dict(VALID, outputs=_outputs(app_charts=["trend", "split", "scatter"])))[0]
    plan = plan_fn(before, kinds, assets, has_built_notebook=True)
    assert plan["refresh"] == ["app"] and plan["restyle"] == [], "new kinds of chart need Genie to write the page again"
    same = validate(dict(VALID, outputs=_outputs(app_pages={"runs": True})))[0]
    assert agent_ns["classify_implement_change"](before, same) == [], "spelling out a default screen is no change"


def test_the_kinds_to_draw_are_the_users_pick_or_inspires_and_never_a_trend_without_a_date(agent_ns):
    kinds = agent_ns["implement_app_chart_kinds"]
    assert kinds({"app": False, "dashboard": True}, shell_sql, True) == ([], False, []), "a dashboard alone keeps Genie's own charts"
    assert kinds({"app": True}, shell_sql, True) == (["trend", "bars", "pareto"], False, [])
    assert kinds({"app": True}, shell_sql, False) == (["bars", "pareto"], False, []), "no note for a kind the user never picked"
    picked, user, notes = kinds({"app": True, "app_charts": ["trend", "split", "scatter"]}, shell_sql, False)
    assert (picked, user) == (["split", "scatter"], True)
    assert notes == ["App: no trend over time chart, which you picked, because the input tables carry no date to draw it over; the App "
                     "draws the other kinds. Pick another kind of chart in App look"]


def test_the_kind_check_rejects_a_page_missing_a_kind_and_passes_one_it_skipped_with_a_reason():
    page = _without(json.loads(open(os.path.join(ROOT, "agent", "app_shell", "example_page.json")).read()), "pareto")
    assert shell_sql.kind_problems(page, ["trend", "bars", "pareto"]) == ([NO_PARETO], [])
    assert shell_sql.kind_problems(page, ["trend", "bars", "pareto"], {"pareto"}) == ([], ["pareto"])
    assert shell_sql.kind_problems(page, ["trend", "bars"]) == ([], [])
    assert shell_sql.kind_problems(page, ["split"], {"pareto"}) == ([NO_SPLIT], [])
    assert shell_sql.kind_problems(dict(page, charts=[{"type": "area"}, "x", {"type": "stacked_bar"}]), ["trend", "bars"]) == ([], [])


def test_charts_not_drawn_is_read_only_for_the_users_own_kinds(agent_ns):
    read = agent_ns["implement_charts_not_drawn"]
    data = {"charts_not_drawn": [{"kind": " Split ", "reason": "  12 channels  are too many parts "}]}
    assert read(data, ["split", "pareto"], True) == ({"split": "12 channels are too many parts"}, []) and "charts_not_drawn" not in data
    assert read({}, ["split"], True) == ({}, []) and read({"charts_not_drawn": []}, ["split"], False) == ({}, [])
    out, errors = read({"charts_not_drawn": [{"kind": "split", "reason": "x"}]}, ["split"], False)
    assert out == {} and errors == ["charts_not_drawn is only for kinds of chart the user picked: draw every kind the rules name and "
                                    "leave charts_not_drawn out"]
    for bad in ([{"kind": "pie", "reason": "x"}], [{"kind": "split"}], ["split"]):
        out, errors = read({"charts_not_drawn": bad}, ["split", "pareto"], True)
        assert out == {} and errors == ['each charts_not_drawn entry needs a "kind", one of split, pareto, and a "reason"'], bad
    assert read({"charts_not_drawn": "split"}, ["split"], True)[1] == ['charts_not_drawn must be a list of {"kind": ..., "reason": ...} objects']


def test_the_app_build_sends_a_page_missing_inspires_pick_back_to_genie(agent_ns, tmp_path):
    inst, context, seen = _app_flow(agent_ns, tmp_path, page=_without(_churn_page(agent_ns), "pareto"))
    inst._implement_app(context, None)
    assert seen["deployed"] == [] and len(seen["errors"]) == 1 and NO_PARETO in seen["errors"][0]
    inst, context, seen = _app_flow(agent_ns, tmp_path / "ok", assets={"genie_space": "g1"})
    assert inst._implement_app(context, None) == {"app_name": "churn-desk", "_asset": {"page": "n01_u01"}} and seen["errors"] == [], \
        "every App deploy records the page of this use case, its own App as well as a joined one"


def test_a_kind_the_user_picked_that_genie_could_not_draw_deploys_with_its_reason_as_a_warning(agent_ns, tmp_path):
    picked = {"app_charts": ["bars", "split", "pareto"]}
    page = dict(_churn_page(agent_ns), charts_not_drawn=[{"kind": "split", "reason": "the loss splits into 12 channels, too many parts"}])
    inst, context, seen = _app_flow(agent_ns, tmp_path, page=page, outputs=picked, assets={"genie_space": "g1"})
    fields = inst._implement_app(context, None)
    assert seen["errors"] == [] and len(seen["deployed"]) == 1
    assert fields["_warnings"] == ["App: no share of a whole chart, which you picked: the loss splits into 12 channels, too many parts. "
                                   "Pick another kind of chart in App look"]
    assert "charts_not_drawn" not in json.loads(seen["deployed"][0][1]["pages/n01_u01.json"])
    inst, context, seen = _app_flow(agent_ns, tmp_path / "silent", outputs=picked)
    inst._implement_app(context, None)
    assert seen["deployed"] == [] and NO_SPLIT in seen["errors"][0], "a picked kind left out with no reason goes back to Genie"
    inst, context, seen = _app_flow(agent_ns, tmp_path / "unasked", page=page)
    inst._implement_app(context, None)
    assert seen["deployed"] == [] and "charts_not_drawn is only for kinds of chart the user picked" in seen["errors"][0]


def test_asked_for_fewer_charts_skips_the_kind_check(agent_ns, tmp_path):
    page = dict(_churn_page(agent_ns), fewer_charts="two  CHARTS are enough")
    page["charts"] = page["charts"][:2]
    inst, context, seen = _app_flow(agent_ns, tmp_path, page=page, outputs={"app_vibes": "Keep it simple: two charts are enough."})
    inst._implement_app(context, None)
    assert seen["errors"] == [] and len(seen["deployed"]) == 1


def test_the_prompt_names_the_kinds_and_only_a_user_pick_may_be_left_out_with_a_reason(agent_ns, tmp_path):
    inst, context, seen = _app_flow(agent_ns, tmp_path)
    inst._implement_input_has_dates = lambda context: True
    inst._implement_app(context, None)
    assert ("- Unless you set fewer_charts, draw at least one chart of each of these kinds: trend over time (type line or area or "
            "stacked_area); bars by segment (type bar or horizontal_bar or stacked_bar); biggest first (type pareto).\n") in seen["prompt"]
    assert "charts_not_drawn" not in seen["prompt"]
    inst, context, seen = _app_flow(agent_ns, tmp_path / "picked", outputs={"app_charts": ["trend", "split", "scatter"]})
    inst._implement_app(context, None)
    assert ("draw at least one chart of each of these kinds, which the user picked for the App: share of a whole (type donut); two "
            "measures (type scatter or heatmap). If the results cannot draw one of them, leave it out and list it in a top-level "
            "\"charts_not_drawn\" array as {\"kind\": \"<one of split, scatter>\", \"reason\": \"<why, in plain business words>\"}; "
            "the user reads each reason.\n") in seen["prompt"]
    assert "trend over time" not in seen["prompt"].split("these kinds")[1].split("\n")[0], "no trend when the inputs carry no date"
    inst, context, seen = _app_flow(agent_ns, tmp_path / "dash", outputs={"app": False})
    assert "draw at least one chart of each of these kinds" not in inst._implement_app_prompt(
        context, shell_sql, {"charts": []}, True, "dashboard")


def _check(ns, tmp_path, page, kinds):
    payload, _modules = _app_shell(ns, tmp_path / "shell")
    work = tmp_path / "work_check"
    ns["implement_write_files"](str(work), ns["implement_app_check_files"](payload["files"], False, kinds))
    (work / "page.json").write_text(json.dumps(page))
    done = subprocess.run([sys.executable, str(work / ".inspire_check" / "check_page.py")], cwd=str(tmp_path),
                          capture_output=True, text=True, timeout=60)
    return done.returncode, done.stdout.strip(), payload["example"]


def test_the_page_checker_genie_runs_checks_the_same_kinds(agent_ns, tmp_path):
    payload, _modules = _app_shell(agent_ns, tmp_path / "shell0")
    example = payload["example"]
    assert _check(agent_ns, tmp_path / "a", example, ["trend", "bars", "pareto"])[:2] == (0, "no problems")
    assert _check(agent_ns, tmp_path / "b", _without(example, "pareto"), ["trend", "bars", "pareto"])[:2] == (1, NO_PARETO)
    skipped = dict(_without(example, "pareto"), charts_not_drawn=[{"kind": "pareto", "reason": "one store holds all the loss"}])
    assert _check(agent_ns, tmp_path / "c", skipped, ["trend", "bars", "pareto"])[:2] == (0, "no problems")
    blank = dict(_without(example, "pareto"), charts_not_drawn=[{"kind": "pareto", "reason": "  "}])
    assert _check(agent_ns, tmp_path / "d", blank, ["trend", "bars", "pareto"])[:2] == (1, NO_PARETO)
    assert _check(agent_ns, tmp_path / "e", _without(example, "pareto"), [])[:2] == (0, "no problems")


def test_the_app_build_hands_genie_a_checker_with_the_kinds_it_must_draw(agent_ns, tmp_path):
    inst, context, seen = _app_flow(agent_ns, tmp_path, assets={"genie_space": "g1"})
    inst._implement_app(context, None)
    payload, _modules = _app_shell(agent_ns, tmp_path / "shell")
    assert seen["tools"] == agent_ns["implement_app_check_files"](payload["files"], False, ["bars", "pareto"],
                                                       agent_ns["implement_page_many_sides"](context["result_table"], context.get("artifacts")),
                                                       context.get("app_layout") or "", False)
    assert '["bars", "pareto"]' in seen["tools"][".inspire_check/check_page.py"]


def test_the_app_settings_carry_the_screens_and_a_join_keeps_the_hubs(agent_ns, tmp_path):
    inst, context, seen = _app_flow(agent_ns, tmp_path, outputs={"app_pages": {"runs": False}})
    inst._implement_app(context, None)
    settings = json.loads(seen["deployed"][0][1]["inspire_app.json"])
    assert settings["screens"] == {"runs": False, "impact": True}
    host = {"merged": True, "owner": ("N01-U02", "777"), "pages": [{"id": "n01_u02"}],
            "settings": dict(SETTINGS, screens={"runs": True, "impact": False}, pages=["n01_u02"])}
    merged, _pages, _page = agent_ns["implement_app_merge"](host, dict(settings, screens={"runs": False, "impact": True}),
                                                            {"id": "n01_u01", "use_case_id": "N01-U01"}, 5150, {})
    assert merged["screens"] == {"runs": True, "impact": False}, "a page joining a hub never changes the hub's screens"


def _shell(tmp_path, settings):
    return impact_shell(tmp_path, ImpactWorkspace(fail={"'estimated' AS `kind`": shell_db.QueryError("[UNRESOLVED_COLUMN] realized_value")}),
                 settings=dict(SETTINGS, **settings))


def test_the_shell_serves_the_screens_and_skips_the_impact_check_when_impact_is_off(tmp_path):
    on = _shell(tmp_path / "on", {})
    assert call(on, "GET", "app")[1]["screens"] == {"runs": True, "impact": True, "performance": True}
    assert any("the Impact page failed" in p for p in on.check({})), "the check still runs Impact while it is on"
    off = _shell(tmp_path / "off", {"screens": {"impact": False}})
    assert call(off, "GET", "app")[1]["screens"] == {"runs": True, "impact": False, "performance": True}
    assert not any("Impact" in p for p in off.check({})), "a hidden Impact screen never blocks the build"


@pytest.mark.parametrize("screens,ok", [
    ({"runs": False, "impact": False}, True),
    ({}, True),
    ({"genie": False}, False),
    ({"runs": "no"}, False),
    (["runs"], False),
])
def test_the_shell_rejects_screens_it_does_not_have(screens, ok):
    page = json.loads(open(os.path.join(ROOT, "agent", "app_shell", "example_page.json")).read())
    page = dict(page, id="n01_u05")
    problems = [p for p in shell_core.settings_problems(dict(SETTINGS, screens=screens), [page]) if "screens" in p]
    assert (problems == []) is ok, problems
    if not ok:
        assert problems == ["the App screens must set runs, impact, performance to true or false, the screens the App shows"]


def test_a_screens_only_edit_rewrites_the_settings_without_genie(agent_ns, tmp_path, monkeypatch):
    own_page = _host_page(agent_ns, "N01-U01", "Churn desk")
    files = _host_files(agent_ns, tmp_path, source=OWN_SOURCE, pages=[own_page], title="N01-U01 Predict churn", genie="g1",
                        style="a", layout="sidebar", palette="default", theme="light")
    inst = _restyle_inspire(agent_ns, tmp_path, monkeypatch, files)
    previous = json.loads(json.dumps(VALID))
    inst._implement_previous = lambda t: {"spec_version": 2, "spec_json": previous}
    current = dict(previous, outputs={**previous["outputs"], "app_pages": {"impact": False}})
    status = inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": current},
                                        (5150, "N01-U01", 3))
    assert status == "ready", inst.updates[-1]
    settings = json.loads(inst.deployed[0][1]["inspire_app.json"])
    assert settings["screens"] == {"runs": True, "impact": False} and settings["layout"] == "sidebar"
