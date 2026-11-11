import json
import re

import pytest

import _agentload
from v140_implement_test import VALID, _left_by, _probe_inspire, _spec
from v143_vibes_test import _run
from v152_mvp_vibe_test import _llm

TREND = "Add a weekly trend of customers at risk"
HOLDOUT = "Hold out the last 8 weeks when you score the model"
PAGER = "Email the planners when more than 10 customers are at risk"
SORT = "Sort the regions by value"
OLD = "Make the old chart a line"
NOTEBOOK = "the analysis notebook that computes the results (columns, model, time windows, scoring)"
UNTICKED = "it names the Alert, which is not ticked for this use case"
NEEDS_PREVIOUS = ("vibe_previous must be keep or remove, because this use case has a built version: it says what happens to the "
                  "version before this vibe")
CELL = {"cell_type": "code", "source": ["# Score the churn risk\nmodel = fit(baseline, holdout='last 8 weeks')\n"], "metadata": {}}
BEFORE_CELL = {"cell_type": "code", "source": ["# Fit the baseline\nmodel = fit(baseline)\n"], "metadata": {}}
BUILDS = ("genie_space", "dashboard", "app", "alert")
FIELDS = {"dashboard": {"dashboard_id": "d1", "dashboard_url": "https://h/d"},
          "genie_space": {"genie_space_id": "g1", "genie_space_url": "https://h/genie/rooms/g1"},
          "app": {"app_name": "churn-desk", "app_url": "https://churn-desk.example", "app_health": "running"},
          "alert": {"alert_id": "al-1", "alert_url": "https://h/al"}}
REBUILT = {"genie_space": {"state": "ready", "spec_version": 2, "title": "Churn agent"},
           "dashboard": {"state": "ready", "spec_version": 2, "title": "Churn board"},
           "app": {"state": "ready", "spec_version": 2},
           "dashboard:by_region": {"state": "ready", "spec_version": 2, "title": "Customers by region"},
           "dashboard:old": {"state": "failed", "spec_version": 2}}
CARRIED = {"notebook_path": "/W/nb", "job_id": 77, "last_preview_run_id": 5, "result_rows": 40, "dashboard_id": "d1",
           "dashboard_url": "https://h/d", "genie_space_id": "g1", "app_name": "churn-desk"}


ARTIFACTS = {"genie_space": {"title": "Churn agent", "serialized_space": {"instructions": "Answer about churn"}},
             "dashboard": {"title": "Customers at risk", "charts": []}, "app": {"id": "n01_u01", "title": "Churn desk"},
             "alert": {"condition_text": "", "condition_sql": "SELECT 1", "name": "Churn alert", "trigger": "more than 10 at risk",
                       "schedule": "every Monday at 06:00", "destinations": ["owner@example.com"]}}


def _building(calls, name, fields=None):
    def build(context, runner):
        calls.append((name, dict(context["spec"]["outputs"]), context["assets"].get(name)))
        context.setdefault("artifacts", {})[name] = json.loads(json.dumps(ARTIFACTS[name]))
        return dict(fields or FIELDS[name])

    return build


def _first_build(agent_ns, calls):
    inst = _probe_inspire(agent_ns, None, {})
    inst._implement_previous = lambda target: {}
    inst._implement_carried = lambda target: ({}, {})
    inst._implement_claim_notebook = lambda use_case, spec, key, asset_status, current="": "/W/nb"
    inst._implement_notebook_modified_at = lambda path: 1000
    inst._implement_export_text = lambda path: json.dumps(
        {"cells": [CELL if any(call[0] == "write" for call in calls) else BEFORE_CELL]})
    inst._implement_runner = lambda uc: "runner"
    inst._implement_write_notebook = lambda uc, spec, previous, key, current="": calls.append(
        ("write", uc.get("_implement_notes"), json.loads(json.dumps(spec)), previous)) or "/W/nb"
    inst._implement_fill_and_preview = lambda uc_id, key, use_case, spec, previous, path, names, runner, refill: (
        calls.append(("fill", refill)) or ({"status": "written", "rows_written": 12}, 77, {}))
    for name in BUILDS:
        setattr(inst, f"_implement_{name}", _building(calls, name))
    return inst


def _rebuild(agent_ns, calls):
    inst = _first_build(agent_ns, calls)
    inst._implement_previous = lambda target: {"spec_version": 2, "spec_json": json.loads(json.dumps(VALID))}
    inst._implement_carried = lambda target: (dict(CARRIED), _left_by(2, json.loads(json.dumps(REBUILT))))
    inst._implement_refresh_run_controls = lambda uc_id, key, use_case, spec_nb, path, status, warnings: None
    return inst


def _built(calls):
    return [call[0] for call in calls if call[0] in BUILDS]


def _route_prompt(seen):
    prompts = [prompt for kind, prompt in seen if kind == "route"]
    assert len(prompts) == 1, [kind for kind, _prompt in seen]
    return prompts[0]


def test_the_first_build_targets_are_the_ticked_outputs_and_the_notebook_and_never_an_unticked_output_or_a_part(agent_ns):
    targets = agent_ns["implement_vibe_targets"]
    outputs = {"dashboard": True, "genie_space": True, "app": False, "alert": False}
    assert targets({}, outputs) == {"genie_space": "Genie Agent", "dashboard": "Dashboard", "notebook": NOTEBOOK}
    assert agent_ns["IMPLEMENT_VIBE_NOTEBOOK_TARGET"] == NOTEBOOK
    assert targets(None, {}) == {"notebook": NOTEBOOK}, "the notebook is always built, so it is always a target"


def test_the_rebuild_targets_add_the_notebook_and_every_built_part_of_a_ticked_owner_and_leave_out_the_rest(agent_ns):
    status = {"dashboard": {"state": "ready", "title": "Churn  board"}, "genie_space": {"state": "failed", "title": "Old agent"},
              "dashboard:by_region": {"state": "ready_with_warnings", "title": "Customers by region"},
              "dashboard:old": {"state": "failed", "title": "Old"}, "app:page:risk": {"state": "ready", "title": "Risk"},
              "alert": {"state": "ready", "title": "Pager"}, "ai_reasoning": {"state": "ready", "title": "AI reasoning"},
              "value_formula": {"state": "failed"}, "kept": {"state": "kept", "assets": []},
              "notebook": {"state": "ready", "title": "Notebook"}}
    outputs = {"dashboard": True, "genie_space": True, "app": False, "alert": False}
    assert agent_ns["implement_vibe_targets"](status, outputs) == {
        "genie_space": "Genie Agent", "dashboard": "Dashboard (Churn board)", "notebook": NOTEBOOK,
        "ai_reasoning": "AI reasoning (Why each row is flagged, what to do, and how sure)",
        "dashboard:by_region": "dashboard chart by_region (Customers by region)"}


def test_the_route_prompt_says_what_is_built_lists_the_notebook_and_names_the_unticked_outputs(agent_ns):
    prompt = agent_ns["implement_vibe_route_prompt"]
    targets = {"dashboard": "Dashboard", "notebook": NOTEBOOK}
    first, rebuild = prompt([TREND, HOLDOUT], targets, True), prompt([TREND, HOLDOUT], targets, False)
    for text in (first, rebuild):
        assert text.startswith(agent_ns["USER_DIRECTIVE_SUPREMACY_PREAMBLE"])
        assert "keep every ask, in their own words, and never drop, soften, merge away or add one" in text
        assert f"- dashboard: Dashboard\n- notebook: {NOTEBOOK}\n" in text
        assert "Not ticked for this use case, so Inspire does not build them: Genie Agent, App, Alert.\n" in text
        assert f"The customer's asks, word for word, by number:\n1. {TREND}\n2. {HOLDOUT}\n\n" in text and "goes to the notebook" in text
        assert "Every ask gets at least one route and never two routes to the same part" in text and '"ask": <its number>' in text
    assert "Nothing is built for this use case yet" in first and "Nothing is built" not in rebuild
    assert "The parts Inspire built for this use case, or builds in this version, by id:" in rebuild
    every = {name: label for name, label in agent_ns["IMPLEMENT_OUTPUT_LABELS"].items()}
    assert "Not ticked" not in prompt([TREND], dict(every, notebook=NOTEBOOK), False)


def test_an_ask_for_an_unticked_output_goes_to_the_notebook_and_one_for_an_unbuilt_part_to_its_built_owner(agent_ns):
    routes, fallback = agent_ns["implement_vibe_routes"](
        {"routes": [{"ask": 1, "asset": "alert", "words": PAGER}, {"ask": 2, "asset": "notebook", "words": HOLDOUT},
                    {"ask": 3, "asset": "app:page:map", "words": "Add a map"}, {"ask": 4, "asset": "dashboard:old", "words": OLD}]},
        {"dashboard": "Dashboard", "notebook": NOTEBOOK}, [PAGER, HOLDOUT, "Add a map", OLD])
    assert routes == {"notebook": f"{PAGER}\n{HOLDOUT}\nAdd a map", "dashboard": OLD}
    assert fallback == [{"ask": PAGER, "reason": UNTICKED, "asset": "notebook"},
                        {"ask": "Add a map", "reason": "it names app:page:map, which Inspire did not build for this use case",
                         "asset": "notebook"},
                        {"ask": OLD, "reason": "it names dashboard:old, which Inspire did not build for this use case", "asset": "dashboard"}]


def test_a_notebook_route_adds_to_the_notebook_vibes_and_rebuilds_it_only_through_them(agent_ns):
    apply = agent_ns["implement_apply_vibe_routes"]
    spec = {"outputs": {"dashboard_vibes": ""}, "data": {"tables": {}, "notes": "Use the new extract"}, "retry_outputs": []}
    routed, changed, errors = apply(spec, {"notebook": HOLDOUT, "dashboard": TREND})
    assert errors == []
    assert routed["data"] == {"tables": {}, "notes": f"Use the new extract\n{HOLDOUT}"}
    assert routed["retry_outputs"] == ["dashboard"], "a notebook vibe rebuilds the notebook through its changed vibes, as the wizard does"
    assert changed == {"dashboard_vibes": TREND} and "notebook_vibes" not in routed["outputs"]
    assert spec["data"]["notes"] == "Use the new extract", "the spec it was given is left as it was"
    again, changed, errors = apply(spec, {"notebook": "use the NEW extract"})
    assert errors == [] and again["data"]["notes"] == "Use the new extract" and changed == {}
    assert again["retry_outputs"] == ["notebook"], "an ask the notebook already holds rebuilds it, never leaving the ask undone"
    _routed, _changed, errors = apply(dict(spec, data={"notes": "n" * 1990}), {"notebook": HOLDOUT})
    assert errors == [f"the notebook would hold {1991 + len(HOLDOUT):,} characters of asks with this vibe, and at most 2,000 are allowed: "
                      "remove some of its earlier asks from its list on the Build page first"]


def test_the_stored_spec_keeps_the_notebook_vibes_a_route_wrote(agent_ns):
    patched = agent_ns["implement_patched_spec"]
    stored = {"outputs": {"dashboard": True}, "data": {"tables": {}, "notes": ""}}
    assert patched(stored, {}, HOLDOUT) == {"outputs": {"dashboard": True}, "data": {"tables": {}, "notes": HOLDOUT}}
    assert patched(stored, {"dashboard_vibes": TREND}) == {"outputs": {"dashboard": True, "dashboard_vibes": TREND},
                                                           "data": {"tables": {}, "notes": ""}}
    assert patched(stored, {}) is stored and patched(json.dumps(stored), {}, HOLDOUT)["data"]["notes"] == HOLDOUT


def test_keep_builds_a_new_copy_only_of_a_built_output_and_never_of_the_notebook(agent_ns):
    side = agent_ns["implement_side_outputs"]
    outputs = {"dashboard": True, "app": True, "alert": True, "genie_space": True}
    routes = {"notebook": HOLDOUT, "ai_reasoning": "Answer in French", "dashboard:kpi": TREND, "alert": PAGER, "app": TREND}
    assert side({"vibe_previous": "keep", "outputs": outputs}, routes, {}, {"dashboard": "d1", "alert": "al-1"}) == (["dashboard"],
                                                                                                                   ["alert"])
    assert side({"vibe_previous": "keep", "outputs": outputs}, {"notebook": HOLDOUT}, {}, {"dashboard": "d1"}) == ([], [])


def test_a_vibe_needs_no_choice_for_the_version_before_in_the_spec_but_a_choice_given_is_still_checked(agent_ns):
    spec, errors = _spec(agent_ns, vibes=TREND)
    assert errors == [] and spec["vibes"] == TREND and "vibe_previous" not in spec
    for blank in (None, "", "   "):
        spec, errors = _spec(agent_ns, vibes=TREND, vibe_previous=blank)
        assert errors == [] and "vibe_previous" not in spec, blank
    assert _spec(agent_ns, vibes=TREND, vibe_previous="archive")[1] == [
        "vibe_previous 'archive' must be keep or remove: it says what happens to the version before this vibe"]
    assert _spec(agent_ns, vibes=TREND, vibe_previous=True)[1] == [
        "vibe_previous true must be keep or remove: it says what happens to the version before this vibe"]
    assert _spec(agent_ns, vibe_previous="keep")[1] == ["vibe_previous needs vibes: it says what happens to the version before a vibe"]


def test_a_first_build_sends_each_ask_to_a_ticked_output_or_the_notebook_and_never_to_an_unticked_one(agent_ns):
    calls = []
    inst = _first_build(agent_ns, calls)
    inst._implement_alert = lambda context, runner: pytest.fail("the alert is not ticked, so it is never built")
    seen = _llm(inst, {"dashboard": TREND, "notebook": HOLDOUT, "alert": PAGER})
    text = f"{TREND}\n{HOLDOUT}\n{PAGER}"
    assert _run(inst, dict(VALID, vibes=text), 1) == "ready_with_warnings", "the ask for the unticked alert goes to Genie's notebook build"
    prompt = _route_prompt(seen)
    assert "Nothing is built for this use case yet" in prompt and f"by number:\n1. {TREND}\n2. {HOLDOUT}\n3. {PAGER}\n" in prompt
    assert (f"by id:\n- genie_space: Genie Agent\n- dashboard: Dashboard\n- app: App\n- notebook: {NOTEBOOK}\n"
            "Not ticked for this use case, so Inspire does not build them: Alert.\n") in prompt
    final = inst.updates[-1]
    notes = f"{HOLDOUT}\n{PAGER}"
    assert final["asset_status"]["vibe"] == {"state": "routed", "text": text, "previous": "", "asks": [TREND, HOLDOUT, PAGER],
                                             "routes": {"dashboard": TREND, "notebook": notes},
                                             "fallback": [{"ask": PAGER, "reason": UNTICKED, "asset": "notebook"}], "spec_version": 1}
    assert (f"Vibe: '{PAGER}' went to the notebook, because {UNTICKED}, so Genie tries it there with up to 3 rounds"
            in final["status_message"])
    writes = [call for call in calls if call[0] == "write"]
    assert len(writes) == 1 and writes[0][1] == notes and writes[0][2]["data"]["notes"] == notes and writes[0][3] is None
    assert ("fill", True) in calls
    assert _built(calls) == ["genie_space", "dashboard", "app"]
    dashboard = next(call for call in calls if call[0] == "dashboard")
    assert dashboard[1]["dashboard_vibes"] == TREND and dashboard[1]["dashboard_name"] == ""
    assert final["spec_json"]["outputs"]["dashboard_vibes"] == TREND and final["spec_json"]["data"]["notes"] == notes
    assert [check["ask"] for check in final["asset_status"]["notebook"]["vibes_checks"]] == [HOLDOUT, PAGER]


def test_a_first_build_ignores_the_choice_for_the_version_before_since_there_is_none(agent_ns):
    calls = []
    inst = _first_build(agent_ns, calls)
    _llm(inst, {"dashboard": TREND})
    assert _run(inst, dict(VALID, vibes=TREND, vibe_previous="keep"), 1) in ("ready", "ready_with_warnings"), inst.updates[-1]
    final = inst.updates[-1]
    assert final["asset_status"]["vibe"]["previous"] == "" and "kept" not in final["asset_status"]
    dashboard = next(call for call in calls if call[0] == "dashboard")
    assert dashboard[1]["dashboard_name"] == "" and dashboard[1]["dashboard_vibes"] == TREND, "nothing is kept, so no name gets a v1"


def test_a_first_build_vibe_the_model_routes_nowhere_builds_nothing_and_lists_the_ask_as_not_decided(agent_ns, monkeypatch):
    monkeypatch.setitem(agent_ns, "IMPLEMENT_ROUTER_BACKOFF_S", 0)
    calls = []
    inst = _first_build(agent_ns, calls)
    seen = _llm(inst, {})
    with pytest.raises(agent_ns["ImplementBlocked"], match="because the vibe router failed 3 time"):
        _run(inst, dict(VALID, vibes=TREND), 1)
    assert calls == [] and [kind for kind, _prompt in seen] == ["route"] * 3, "an ask no route placed starts no build"
    [entry] = [u for u in inst.updates if "checklist" in (u.get("asset_status") or {})][-1]["asset_status"]["checklist"]
    assert (entry["requirement"], entry["status"], entry["rounds"]) == (TREND, "not_decided", 0)
    assert f"the router sent ask 1 ('{TREND}') to no part" in entry["evidence"]


def test_older_apps_per_part_vibes_still_build_without_the_router(agent_ns):
    calls = []
    inst = _first_build(agent_ns, calls)
    seen = _llm(inst, {})
    spec = dict(VALID, outputs={**VALID["outputs"], "dashboard_vibes": TREND}, data=dict(VALID["data"], notes=HOLDOUT))
    assert _run(inst, spec, 1) in ("ready", "ready_with_warnings"), inst.updates[-1]
    assert "route" not in [kind for kind, _prompt in seen]
    assert next(call for call in calls if call[0] == "dashboard")[1]["dashboard_vibes"] == TREND
    assert next(call for call in calls if call[0] == "write")[1] == HOLDOUT
    assert "vibe" not in inst.updates[-1]["asset_status"]
    assert _spec(agent_ns, outputs={**VALID["outputs"], "dashboard_vibes": "v" * 2001})[1] == [
        "the Dashboard vibes are 2,001 characters; at most 2,000 are allowed"]


def test_a_notebook_ask_on_a_rebuild_lands_in_the_notebook_vibes_and_reruns_the_notebook_and_every_output(agent_ns):
    calls = []
    inst = _rebuild(agent_ns, calls)
    seen = _llm(inst, {"notebook": HOLDOUT})
    assert _run(inst, dict(VALID, vibes=HOLDOUT, vibe_previous="remove")) in ("ready", "ready_with_warnings"), inst.updates[-1]
    prompt = _route_prompt(seen)
    assert "The parts Inspire built for this use case, or builds in this version, by id:" in prompt
    assert (f"- genie_space: Genie Agent (Churn agent)\n- dashboard: Dashboard (Churn board)\n- app: App\n- notebook: {NOTEBOOK}\n"
            "- dashboard:by_region: dashboard chart by_region (Customers by region)\n") in prompt
    assert "dashboard:old" not in prompt, "a part that did not build is not a target"
    plan = next(update for update in inst.updates if "change_classes" in update)
    assert plan["change_classes"] == "data,vibe"
    writes = [call for call in calls if call[0] == "write"]
    assert len(writes) == 1 and writes[0][1] == HOLDOUT and writes[0][3] is not None
    assert "notebook" not in writes[0][2]["retry_outputs"], "it is the notebook vibe path, not a rebuild of every cell"
    assert ("fill", True) in calls and _built(calls) == ["genie_space", "dashboard", "app"]
    final = inst.updates[-1]
    assert final["asset_status"]["vibe"] == {"state": "routed", "text": HOLDOUT, "previous": "remove", "asks": [HOLDOUT],
                                             "routes": {"notebook": HOLDOUT}, "fallback": [], "spec_version": 3}
    assert final["spec_json"]["data"]["notes"] == HOLDOUT and final["spec_json"]["outputs"] == VALID["outputs"]
    assert [check["ask"] for check in final["asset_status"]["notebook"]["vibes_checks"]] == [HOLDOUT]
    [entry] = [e for e in final["asset_status"]["checklist"] if e["requirement"] == HOLDOUT]
    assert entry["status"] == "met" and "already_there" not in entry, "the holdout is new in this notebook, so it carries no note"


def test_keep_with_a_notebook_ask_keeps_the_built_dashboard_and_builds_its_new_copy(agent_ns):
    calls = []
    inst = _rebuild(agent_ns, calls)
    inst._implement_dashboard = _building(calls, "dashboard", {"dashboard_id": "d9", "dashboard_url": "https://h/d9"})
    _llm(inst, {"notebook": HOLDOUT, "dashboard": TREND})
    assert _run(inst, dict(VALID, vibes=f"{HOLDOUT}\n{TREND}", vibe_previous="keep")) in ("ready", "ready_with_warnings"), \
        inst.updates[-1]
    dashboard = next(call for call in calls if call[0] == "dashboard")
    assert dashboard[2] is None and dashboard[1]["dashboard_name"] == "N01-U01 Predict churn v3"
    final = inst.updates[-1]
    assert final["asset_status"]["kept"]["assets"] == [{"output": "dashboard", "id": "d1", "url": "https://h/d", "title": "Churn board",
                                                        "version": 2, "kept_in": 3}]
    assert final["spec_json"]["data"]["notes"] == HOLDOUT and final["asset_status"]["vibe"]["previous"] == "keep"


def test_a_rebuild_still_needs_the_choice_for_the_version_before(agent_ns):
    calls = []
    inst = _rebuild(agent_ns, calls)
    seen = _llm(inst, {"dashboard": TREND})
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        _run(inst, dict(VALID, vibes=TREND))
    assert str(raised.value) == NEEDS_PREVIOUS
    assert seen == [] and calls == []


def test_a_rebuild_sends_an_ask_for_an_unbuilt_part_to_its_owner_and_one_for_an_unticked_output_to_the_notebook(agent_ns):
    calls = []
    inst = _rebuild(agent_ns, calls)
    _llm(inst, {"dashboard:old": OLD, "alert": PAGER})
    status = _run(inst, dict(VALID, vibes=f"{OLD}\n{PAGER}", vibe_previous="remove"))
    final = inst.updates[-1]
    old = next(entry for entry in final["asset_status"]["checklist"] if entry["part"] == "dashboard")
    assert (status, old["status"], old["evidence"]) == ("ready_with_warnings", "not_met", "the built Dashboard has no old chart"), \
        "the rebuilt dashboard has no chart at all, so no judge can meet an ask about its old chart"
    assert final["asset_status"]["vibe"]["routes"] == {"dashboard": OLD, "notebook": PAGER}
    assert final["asset_status"]["vibe"]["fallback"] == [
        {"ask": OLD, "reason": "it names dashboard:old, which Inspire did not build for this use case", "asset": "dashboard"},
        {"ask": PAGER, "reason": UNTICKED, "asset": "notebook"}]
    assert (f"Vibe: '{OLD}' went to the Dashboard, because it names dashboard:old, which Inspire did not build for this use case, so "
            "Genie tries it there with up to 3 rounds") in final["status_message"]
    assert f"Vibe: '{PAGER}' went to the notebook, because {UNTICKED}" in final["status_message"]
    assert ("fill", True) in calls and _built(calls) == ["genie_space", "dashboard", "app"]
    dashboard = next(call for call in calls if call[0] == "dashboard")
    assert dashboard[1]["dashboard_vibes"] == OLD and [check["ask"] for check in final["asset_status"]["dashboard"]["vibes_checks"]] == [OLD]


APP_ASK = "Put the riskiest customers first on the App"
COLUMN = "Add the days since the last order as a column and an App filter"
FRENCH = "Answer in French"
FORMULA = "Count only the weeks left in the season"
REBUILD_NOTE = "this ask changes the analysis, so Inspire rebuilds the notebook and every part after it"
RERUN_NOTE = "this ask changes the AI reasoning, so Inspire runs the notebook again"
EVERY = {"dashboard": "d1", "genie_space": "g1", "app": "churn-desk", "alert": "al-1", "preview_run_id": 5}


def _routed_plan(agent_ns, routes):
    previous = _spec(agent_ns, outputs={**VALID["outputs"], "alert": True, "alert_recipients": ["owner@example.com"]})[0]
    asked = dict(previous, vibes="\n".join(routes.values()), vibe_previous="remove")
    routed, _changed, errors = agent_ns["implement_apply_vibe_routes"](asked, routes)
    assert errors == []
    return agent_ns["implement_plan"](previous, routed, dict(EVERY), has_built_notebook=True)


def _vibe_step(inst):
    return [event for event in inst.emitted if event["step_name"] == "Vibe"][-1]


def test_the_route_prompt_names_part_asks_and_core_asks_and_sends_a_core_ask_to_the_notebook(agent_ns):
    text = agent_ns["implement_vibe_route_prompt"](TREND, {"app": "App", "notebook": NOTEBOOK}, False)
    assert "a column the results do not hold" not in text, "with the notebook a target, a new column is a core ask, not one no part can do"
    assert ("A part ask is about one part's look or behavior (a filter, a chart, a page, the wording, the layout, a Genie question, or "
            "an alert's timing or recipients): it goes to that part alone, so Inspire rebuilds only that part.") in text
    assert ("A core ask changes the analysis itself (the output columns, the entity each row is about, the score or the model, the time "
            "windows, the thresholds or tiers the notebook computes, or the data it reads): it goes to the notebook, so Inspire rebuilds "
            "the notebook and every part after it") in text
    assert "Never send a part ask to the notebook." in text
    assert "a new column shown as an App filter goes to the notebook and to the App" in text


@pytest.mark.parametrize("routes", [{"notebook": HOLDOUT}, {"value_formula": FORMULA}, {"notebook": COLUMN, "app": COLUMN}],
                         ids=["notebook", "money_formula", "notebook_and_app"])
def test_a_core_ask_rebuilds_the_notebook_and_every_built_part_after_it(agent_ns, routes):
    plan = _routed_plan(agent_ns, routes)
    assert plan["refill"] is True and plan["preview"] is True
    assert sorted(plan["refresh"]) == sorted(BUILDS) and plan["build"] == [] and plan["rollback"] == {}


@pytest.mark.parametrize("routes,only", [({"app": APP_ASK}, "app"), ({"dashboard:by_region": SORT}, "dashboard"),
                                         ({"alert": "Check on weekdays only"}, "alert")], ids=["app", "dashboard_chart", "alert"])
def test_a_part_ask_rebuilds_only_that_part_and_never_the_notebook_or_another_part(agent_ns, routes, only):
    plan = _routed_plan(agent_ns, routes)
    assert plan["refill"] is False and plan["preview"] is False and plan["schedule"] is False
    assert plan["refresh"] == [only] and plan["build"] == [] and plan["repoint"] == [] and plan["rollback"] == {}
    others = {name for name in BUILDS if name != only}
    assert others.isdisjoint(set(plan["refresh"]) | set(plan["build"]) | set(plan["repoint"])), f"a {only} ask rebuilt {plan}"


def test_an_ai_reasoning_ask_reruns_the_notebook_without_rewriting_it_or_rebuilding_a_part(agent_ns):
    plan = _routed_plan(agent_ns, {"ai_reasoning": FRENCH})
    assert (plan["refill"], plan["preview"], plan["refresh"], plan["build"]) == (False, True, [], [])


def test_the_core_notes_say_exactly_what_the_plan_does(agent_ns):
    notes = agent_ns["IMPLEMENT_VIBE_CORE_NOTES"]
    assert notes == {"notebook": REBUILD_NOTE, "ai_reasoning": RERUN_NOTE, "value_formula": REBUILD_NOTE}
    assert set(notes) == {"notebook", *agent_ns["IMPLEMENT_NOTEBOOK_ASSETS"]}
    for asset, note in notes.items():
        plan = _routed_plan(agent_ns, {asset: HOLDOUT})
        rebuilds_all = plan["refill"] and sorted(plan["refresh"]) == sorted(BUILDS)
        assert plan["preview"] is True and (note == REBUILD_NOTE) == rebuilds_all, asset


def test_the_vibe_step_gives_one_line_per_route_and_says_why_a_core_ask_rebuilds_more(agent_ns):
    lines = agent_ns["implement_vibe_sent_lines"]
    routes = {"app": APP_ASK, "notebook": HOLDOUT, "ai_reasoning": FRENCH}
    fallback = {"ask": PAGER, "reason": UNTICKED, "asset": "notebook"}
    assert lines(routes, [fallback], False) == [
        f"sent to App: {APP_ASK}", f"sent to Notebook: {HOLDOUT}; {REBUILD_NOTE}", f"sent to AI reasoning: {FRENCH}; {RERUN_NOTE}",
        f"'{PAGER}' went to the notebook, because {UNTICKED}, so Genie tries it there with up to 3 rounds"]
    assert lines(routes, [], True) == [f"sent to App: {APP_ASK}", f"sent to Notebook: {HOLDOUT}", f"sent to AI reasoning: {FRENCH}"], \
        "a first build builds every part anyway, so no ask is said to rebuild more"
    assert lines(routes, [fallback], False)[-1] == agent_ns["implement_vibe_fallback_line"](fallback), "the step and the warning say it alike"


def test_an_app_ask_on_a_rebuild_rebuilds_only_the_app(agent_ns):
    calls = []
    inst = _rebuild(agent_ns, calls)
    _llm(inst, {"app": APP_ASK})
    assert _run(inst, dict(VALID, vibes=APP_ASK, vibe_previous="remove")) in ("ready", "ready_with_warnings"), inst.updates[-1]
    assert _built(calls) == ["app"] and not [call for call in calls if call[0] in ("write", "fill")]
    filling = next(update for update in inst.updates if "change_classes" in update)
    assert filling["status_message"] == "Genie refreshes the App"
    assert not [u for u in inst.updates if "{" in str(u.get("status_message") or "") or str(u.get("status_message") or "").startswith("plan:")]
    plan = next(e for e in inst.emitted if e["step_name"] == "Plan")["result_json"]["plan"]
    assert (plan["refill"], plan["preview"], plan["build"], plan["refresh"], plan["repoint"]) == (False, False, [], ["app"], [])
    step = _vibe_step(inst)
    assert (step["status"], step["message"], step["result_json"]["lines"]) == ("ended_success", f"sent to App: {APP_ASK}",
                                                                               [f"sent to App: {APP_ASK}"])


def test_a_core_and_a_part_ask_rebuild_everything_and_the_vibe_step_logs_one_line_per_route(agent_ns):
    calls = []
    inst = _rebuild(agent_ns, calls)
    _llm(inst, {"notebook": COLUMN, "app": COLUMN})
    assert _run(inst, dict(VALID, vibes=COLUMN, vibe_previous="remove")) in ("ready", "ready_with_warnings"), inst.updates[-1]
    assert ("fill", True) in calls and _built(calls) == ["genie_space", "dashboard", "app"]
    expected = [f"sent to Notebook: {COLUMN}; {REBUILD_NOTE}", f"sent to App: {COLUMN}"]
    step = _vibe_step(inst)
    assert (step["status"], step["message"], step["result_json"]["lines"]) == ("ended_success", "\n".join(expected), expected)
    logged = [message for _level, message in inst.logger.matching("N01-U01 \u00b7 Vibe: sent to ")]
    assert logged == [f"[Implement Use Cases] N01-U01 \u00b7 Vibe: {line}" for line in expected], "every log line names its use case"


@pytest.mark.parametrize("schema", ["IMPLEMENT_VIBE_ROUTE_SCHEMA", "IMPLEMENT_VIBES_SPLIT_SCHEMA", "IMPLEMENT_VIBES_JUDGE_SCHEMA"])
def test_a_bare_vibe_schema_reaches_the_endpoint_with_the_name_every_json_schema_format_needs(fresh_ns, schema):
    model = {"llm_endpoint_name": "json-endpoint", "llm_output_context_tokens_count": 64000}
    fresh_ns["LLM_ENDPOINT_HEALTH"].mark_json_format("json-endpoint", True)
    params = fresh_ns["AIAgent"]._llm_request_params
    sent = json.loads(params(None, model, "implement_vibes_route", fresh_ns[schema])[2])
    assert sent == {"type": "json_schema", "json_schema": {"name": "implement_vibes_route", "schema": fresh_ns[schema]}}, \
        "an endpoint that checks the format refuses a json_schema with no name, and the run then drops the format for that endpoint"
    named = {"name": "role_canonicalization", "schema": {"type": "object"}}
    assert json.loads(params(None, model, "canonicalize_sponsor_beneficiary_roles", named)[2])["json_schema"] == named
    assert json.loads(params(None, model, "SIGNAL_CHECK_PROMPT")[2])["json_schema"] == fresh_ns["JSON_ARRAY_RESPONSE_SCHEMA"]
    fresh_ns["LLM_ENDPOINT_HEALTH"].mark_json_format("json-endpoint", False)
    assert params(None, model, "implement_vibes_route", fresh_ns[schema])[2] == "", "an endpoint that refused the format gets none"


def test_no_message_sends_the_person_to_a_part_card_that_the_one_vibe_box_replaced():
    assert re.findall(r"(?:on|from) its card|vibe one part|shorten them", _agentload.agent_source()) == []


def test_a_notebook_ask_the_judge_proves_only_with_a_line_the_notebook_before_had_holds_and_says_why(agent_ns):
    calls = []
    inst = _rebuild(agent_ns, calls)
    inst._implement_export_text = lambda path: json.dumps({"cells": [CELL]})
    _llm(inst, {"notebook": HOLDOUT})
    assert _run(inst, dict(VALID, vibes=HOLDOUT, vibe_previous="remove")) == "ready_with_warnings", \
        "the judge's only proof is a line the notebook before already had, which shows nothing about this ask, so it is not met"
    [entry] = [e for e in inst.updates[-1]["asset_status"]["checklist"] if e["requirement"] == HOLDOUT]
    assert entry["status"] == "not_met" and "already_there" not in entry
    assert entry["evidence"].startswith("the check quoted '") and "which the version before already showed" in entry["evidence"]


def test_the_same_notebook_ask_the_judge_finds_missing_on_the_built_notebook_still_holds(agent_ns):
    calls = []
    inst = _rebuild(agent_ns, calls)
    inst._implement_export_text = lambda path: json.dumps({"cells": [CELL]})
    _llm(inst, {"notebook": HOLDOUT})
    routed = inst._implement_vibes_llm
    inst._implement_vibes_llm = lambda kind, prompt, schema: (
        {"checks": [{"n": 1, "status": "missing", "evidence": "no cell holds out any weeks"}]} if kind == "judge"
        else routed(kind, prompt, schema))
    assert _run(inst, dict(VALID, vibes=HOLDOUT, vibe_previous="remove")) == "ready_with_warnings", \
        "an ask the built notebook does not meet holds, whatever the notebook before had"
    [entry] = [e for e in inst.updates[-1]["asset_status"]["checklist"] if e["requirement"] == HOLDOUT]
    assert entry["status"] == "not_met" and "already_there" not in entry


@pytest.mark.parametrize("plan, said", [
    ({"refill": True, "build": ["genie_space", "dashboard", "app"], "refresh": [], "rollback": {}},
     "Genie rebuilds the notebook and builds the Genie Agent, Dashboard and App"),
    ({"refill": False, "build": [], "refresh": ["dashboard", "app"], "rollback": {"alert": 2}}, "Genie refreshes the Dashboard and App and rolls back the Alert"),
    ({"refill": False, "build": [], "refresh": [], "rollback": {}, "retable": [], "preview": True}, "Genie keeps everything it built"),
])
def test_the_build_status_says_the_plan_in_plain_words_and_never_as_json(agent_ns, plan, said):
    message = agent_ns["implement_plan_message"](plan)
    assert message == said
    assert "{" not in message and "[" not in message and "_" not in message
