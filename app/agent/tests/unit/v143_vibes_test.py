import json

import pytest

from _agentload import agent_source
from v120_artifacts_support import FakeSpark
from v140_implement_test import (ALERT, OURS_APP, READS, SHELL_FILES, VALID, _alert_inspire, _calls_to, _churn_page, _deploy_inspire,
                                 _FileRunner, _left_by, _NB_SPEC, _output_context, _probe_inspire, _spec, _writer, sdk_stub)
from v142_dash_test import _doc, _flow, _published, _runner as _pages
from v142_genie_test import _definition, _deploy_inspire as _space_inspire, _rich_space
from v142_merge_test import DASH, _dashboard_inspire, _host_page, _merge_flow

VIBES = "Answer in plain words, put the riskiest customers first and always show the region"
GOOD = "SELECT COUNT(*) > 10 AS triggered FROM main.s.orders WHERE status = 'refund'"
ALL = {**VALID["outputs"], **ALERT}
LABELS = {"genie_space": "Genie Agent", "dashboard": "Dashboard", "app": "App", "alert": "Alert"}
ASSETS = {"genie_space": "g1", "dashboard": "d1", "app": "churn-desk", "alert": "al-1", "preview_run_id": 5}
BUILT = {"notebook_path": "/W/nb", "job_id": 77, "last_preview_run_id": 5, "result_rows": 40, "dashboard_id": "d1",
         "dashboard_url": "https://h/d", "genie_space_id": "g1", "app_name": "churn-desk", "alert_id": "al-1"}
LIVE = {name: {"state": "ready", "spec_version": 2} for name in LABELS}
NOT_DONE = [{"ask": "Add a map of the regions", "reason": "no table holds a location"}]
GONE_WARNING = "Dashboard: v1 could not be put back because the Dashboard no longer exists, so Inspire builds a new Dashboard with Genie instead"
SNAPSHOT_SQL = ("SELECT asset_snapshots FROM `main`.`inspire`.__inspire_implement WHERE session_id = :sid AND use_case_id = :uc AND "
                "spec_version = :v")


class _NoGenie:
    def run(self, *args, **kwargs):
        raise AssertionError("a rollback never asks Genie")


def _no_loop(*args, **kwargs):
    raise AssertionError("a rollback never runs a Genie round")


def _raising(message):
    def check(sql, require_rows=False, limit=20):
        raise RuntimeError(message)

    return check


def _vibed(ns, **outputs):
    return _spec(ns, outputs={**ALL, **outputs})


def _saved(artifact, version=1, vibes="", merged_into=""):
    return version, {"artifact": artifact, "vibes": vibes, "spec_version": version, "merged_into": merged_into}


def _block(ns, name, vibes=VIBES):
    where = {"genie_space": 'a top-level "vibes_not_done" array of genie_space.json',
             "alert": "the file vibes_not_done.json in your working folder, a JSON array"}.get(
        name, 'a top-level "vibes_not_done" array of page.json')
    return ns["implement_vibes_block"]({f"{name}_vibes": vibes}, name, where)


def _not_done_space():
    return json.dumps(dict(json.loads(_definition(_rich_space())), vibes_not_done=NOT_DONE))


def _locked(ns, previous_outputs=None, responder=None):
    inst = _probe_inspire(ns, responder or (lambda statement: []), {})
    previous = dict(VALID, outputs={**ALL, **(previous_outputs or {})})
    inst._implement_previous = lambda target: {"spec_version": 2, "spec_json": previous}
    inst._implement_carried = lambda target: (dict(BUILT), _left_by(2, json.loads(json.dumps(LIVE))))
    inst._implement_fill_and_preview = lambda *args: pytest.fail("an outputs-only version never re-runs the notebook")
    inst._implement_dashboard = inst._implement_genie_space = inst._implement_alert = _not_in_version
    inst._implement_app = lambda context, runner: None if "app" in context.get("repoint", ()) else _not_in_version(context, runner)
    return inst, previous


def _not_in_version(context, runner):
    pytest.fail("this output is not part of the version")


def _run(inst, spec, version=3):
    return inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": version, "spec_json": spec},
                                      (5150, "N01-U01", version))


def _verdicts(inst, asks, status="done", evidence=None):
    seen = []

    def llm(kind, prompt, schema):
        seen.append(kind)
        if kind == "split":
            return {"asks": [{"ask": ask, "check": None} for ask in asks]}
        shown = next((line[2:] for line in prompt.split("<<<\n", 1)[1].split("\n>>>", 1)[0].splitlines() if line.startswith("- ")), "")
        return {"checks": [{"n": n, "status": status, "evidence": evidence or shown[:30]} for n in range(1, len(asks) + 1)]}

    inst._implement_vibes_llm = llm
    return seen


def test_vibes_are_stripped_text_and_blank_for_an_output_that_is_not_selected(agent_ns):
    spec, errors = _vibed(agent_ns, dashboard_vibes="  Put the top 10 first \n", app_vibes="Add a map", genie_space_vibes=None,
                          alert=False, alert_vibes="Page me")
    assert errors == []
    out = spec["outputs"]
    assert [out[f"{n}_vibes"] for n in LABELS] == ["", "Put the top 10 first", "Add a map", ""]
    assert all(_spec(agent_ns)[0]["outputs"][f"{n}_vibes"] == "" for n in LABELS), "a spec without vibes normalizes to blank vibes"
    assert _vibed(agent_ns, alert=False, alert_vibes=7)[1] == [], "the vibes of an output that is not selected are not checked"


@pytest.mark.parametrize("name", list(LABELS))
def test_vibes_hold_2000_characters_and_longer_or_non_text_vibes_are_errors_never_cut(agent_ns, name):
    spec, errors = _vibed(agent_ns, **{f"{name}_vibes": "  " + "v" * 2000 + "\n"})
    assert errors == [] and spec["outputs"][f"{name}_vibes"] == "v" * 2000
    spec, errors = _vibed(agent_ns, **{f"{name}_vibes": "v" * 2001})
    assert errors == [f"the {LABELS[name]} vibes are 2,001 characters; at most 2,000 are allowed"]
    assert spec["outputs"][f"{name}_vibes"] == "v" * 2001
    for bad, shown in ((5, "5"), (["a"], '["a"]'), ({"a": 1}, '{"a":1}'), (True, "true")):
        assert _vibed(agent_ns, **{f"{name}_vibes": bad})[1] == [f"outputs.{name}_vibes must be text, not {shown}"], bad
    assert agent_ns["IMPLEMENT_OUTPUT_LABELS"] == LABELS


def test_rollback_outputs_become_whole_versions_and_every_bad_one_is_named(agent_ns):
    spec, errors = _spec(agent_ns, outputs=ALL, rollback_outputs={"app": "3", "alert": 1, "dashboard": 2.0})
    assert errors == [] and list(spec["rollback_outputs"].items()) == [("dashboard", 2), ("app", 3), ("alert", 1)]
    assert _spec(agent_ns)[0]["rollback_outputs"] == {}
    for rollback, error in (({"pdf": 1}, "rollback output 'pdf' is not one of genie_space, dashboard, app, alert"),
                            ({" alert ": 1}, "rollback output ' alert ' is not one of genie_space, dashboard, app, alert"),
                            ({"alert": 1}, "the Alert cannot be rolled back: it is not selected"),
                            ({"app": 0}, "rollback_outputs.app 0 must be a version number, 1 or more"),
                            ({"app": -2}, "rollback_outputs.app -2 must be a version number, 1 or more"),
                            ({"app": "two"}, "rollback_outputs.app 'two' must be a version number, 1 or more"),
                            ({"app": True}, "rollback_outputs.app true must be a version number, 1 or more"),
                            ({"app": 1.5}, "rollback_outputs.app 1.5 must be a version number, 1 or more"),
                            ({"app": None}, "rollback_outputs.app null must be a version number, 1 or more")):
        assert _spec(agent_ns, rollback_outputs=rollback)[1] == [error], rollback
    both = _spec(agent_ns, retry_outputs=["dashboard"], rollback_outputs={"dashboard": 1, "app": 1})
    assert both[1] == ["the Dashboard cannot be retried and rolled back in the same version"]
    assert _spec(agent_ns, rollback_outputs=["dashboard"])[1] == ["rollback_outputs must be an object"]


def test_rollback_is_the_change_class_after_retry_and_a_vibe_change_is_an_outputs_change(agent_ns):
    classify = agent_ns["classify_implement_change"]
    classes = agent_ns["IMPLEMENT_CHANGE_CLASSES"]
    assert classes[classes.index("retry"):] == ("retry", "rollback", "vibe", "remove_kept", "uninstall")
    before = _vibed(agent_ns)[0]
    assert classify(before, _vibed(agent_ns, alert_vibes="Only on weekdays")[0]) == ["outputs"]
    assert classify(before, _spec(agent_ns, outputs=ALL, rollback_outputs={"alert": 1})[0]) == ["rollback"]
    for name in LABELS:
        assert f"{name}_vibes" in agent_ns["IMPLEMENT_OUTPUT_OPTIONS"][name]
        assert f"{name}_vibes" not in agent_ns["IMPLEMENT_RESTYLE_OPTIONS"].get(name, ())


def test_a_vibe_change_refreshes_only_that_output_through_genie(agent_ns):
    plan = agent_ns["implement_plan"]
    before = _vibed(agent_ns)[0]
    for name in LABELS:
        out = plan(before, _vibed(agent_ns, **{f"{name}_vibes": VIBES})[0], ASSETS, has_built_notebook=True)
        assert (out["refresh"], out["build"], out["restyle"], out["refill"], out["rollback"]) == ([name], [], [], False, {}), name
    look_only = plan(before, _vibed(agent_ns, app_look={"palette": "ocean"})[0], ASSETS, has_built_notebook=True)
    assert look_only["restyle"] == ["app"]
    vibed_look = plan(before, _vibed(agent_ns, app_look={"palette": "ocean"}, app_vibes=VIBES)[0], ASSETS, has_built_notebook=True)
    assert vibed_look["refresh"] == ["app"] and vibed_look["restyle"] == [], "a look change that comes with vibes goes through Genie"
    same = plan(_vibed(agent_ns, app_vibes=VIBES)[0], _vibed(agent_ns, app_vibes=f"  {VIBES} ")[0], ASSETS, has_built_notebook=True)
    assert same["classes"] == [] and same["refresh"] == []


def test_a_rolled_back_output_leaves_build_refresh_and_restyle_even_when_its_vibes_changed(agent_ns):
    plan = agent_ns["implement_plan"]
    before = _vibed(agent_ns, dashboard_vibes="v2 asks")[0]
    after = _spec(agent_ns, outputs={**ALL, "dashboard_vibes": "v1 asks", "app_look": {"palette": "ocean"}},
                  data={**VALID["data"], "notes": "use the new extract"}, rollback_outputs={"dashboard": 1, "app": 2, "alert": 1})[0]
    out = plan(before, after, {k: v for k, v in ASSETS.items() if k != "alert"}, has_built_notebook=True)
    assert out["rollback"] == {"dashboard": 1, "app": 2}
    assert out["build"] == ["alert"], "the alert is gone, so it cannot be rolled back and is built again"
    assert out["rollback_built"] == {"alert": {"version": 1, "why": "gone"}}
    assert out["refill"] and out["refresh"] == ["genie_space"] and out["restyle"] == []
    assert out["classes"] == ["data", "outputs", "rollback"] and out["sharing"]
    plain = plan(_vibed(agent_ns)[0], _spec(agent_ns, outputs=ALL, rollback_outputs={"app": 1})[0], ASSETS, has_built_notebook=True)
    assert plain["refresh"] == [] and plain["rollback"] == {"app": 1} and plain["sharing"] and not plain["preview"]
    assert plain["rollback_built"] == {}, "a rollback that can happen is never reported as a build"


def test_a_rollback_that_must_build_names_why_for_a_new_output_and_a_renamed_app(agent_ns):
    plan = agent_ns["implement_plan"]
    unticked = _spec(agent_ns, outputs={**ALL, "dashboard": False})[0]
    out = plan(unticked, _spec(agent_ns, outputs=ALL, rollback_outputs={"dashboard": 1})[0], ASSETS, has_built_notebook=True)
    assert out["build"] == ["dashboard"] and out["rollback"] == {} and out["rollback_built"] == {"dashboard": {"version": 1, "why": "new"}}
    renamed = plan(_vibed(agent_ns)[0], _spec(agent_ns, outputs={**ALL, "app_name": "churn-desk-two"}, rollback_outputs={"app": 2})[0], ASSETS,
                   has_built_notebook=True)
    assert renamed["build"] == ["app"] and renamed["rollback_built"] == {"app": {"version": 2, "why": "renamed"}}
    warn = agent_ns["implement_rollback_built_warning"]
    assert warn("app", renamed["rollback_built"]["app"]) == ("App: v2 could not be put back because the App now has a different name or "
                                                            "target, so Inspire builds a new App with Genie instead")
    assert warn("dashboard", {"version": 1, "why": "new"}) == ("Dashboard: v1 could not be put back because the version before had no "
                                                              "Dashboard, so Inspire builds a new Dashboard with Genie instead")


def test_the_vibes_block_reuses_the_one_supremacy_preamble_and_quotes_the_asks_word_for_word(agent_ns):
    preamble = agent_ns["USER_DIRECTIVE_SUPREMACY_PREAMBLE"]
    for name, label in LABELS.items():
        block = _block(agent_ns, name)
        assert block.startswith(preamble) and block.count(preamble) == 1
        assert f"The customer's asks for this {label}, word for word:\n\"\"\"\n{VIBES}\n\"\"\"\n" in block
        assert "the customer's asks win, without exception" in block and "Inspire's checks still run" in block
        assert "every query must run and pass them" in block and "metadata only" in block and "business output table rules" in block
        assert '"vibes_not_done"' in block or "vibes_not_done.json" in block
        assert '[{"ask": "<the ask, word for word>", "reason": "<one sentence on why>"}]' in block
        assert agent_ns["implement_vibes_block"]({f"{name}_vibes": "  \n "}, name, "x") == ""
        assert agent_ns["implement_vibes_block"]({}, name, "x") == ""
        literal = 'Title it "Churn {kpi_id}" and use {} braces, 100% as typed'
        assert f'"""\n{literal}\n"""' in _block(agent_ns, name, f"  {literal}  ")
    assert agent_source().count("USER DIRECTIVES ARE THE SUPREME AUTHORITY") == 1, "no second preamble is written"


def test_the_genie_agent_prompt_carries_its_vibes_and_without_vibes_it_is_unchanged(agent_ns, tmp_path):
    prompts = {}
    for vibes in ("", VIBES):
        inst, _calls, _ran = _space_inspire(agent_ns, tmp_path)
        runner = _FileRunner([{"exit": 0}], [{"genie_space.json": _definition(_rich_space())}])
        inst._implement_genie_space(_output_context(agent_ns, genie_space_vibes=vibes, app_vibes="App only asks"), runner)
        prompts[vibes] = runner.prompts[0]
    block = _block(agent_ns, "genie_space")
    assert block in prompts[VIBES] and prompts[VIBES].replace(block, "") == prompts[""]
    assert prompts[VIBES].index(block) + len(block) == prompts[VIBES].index("Then reply with only the JSON object")
    assert "App only asks" not in prompts[VIBES]
    assert "SUPREME AUTHORITY" not in prompts[""] and "vibes_not_done" not in prompts[""]


def test_the_dashboard_and_the_app_each_ask_genie_with_their_own_vibes_and_share_a_page_only_without_vibes(agent_ns, tmp_path):
    inst, context, seen = _flow(agent_ns, tmp_path, outputs={"dashboard_vibes": VIBES, "app_vibes": "Show a map"})
    dash = _pages(_churn_page(agent_ns))
    inst._implement_dashboard(context, dash)
    assert _block(agent_ns, "dashboard") in dash.prompts[0] and "Show a map" not in dash.prompts[0]
    app = _pages(_churn_page(agent_ns, title="Map desk"))
    assert inst._implement_app(context, app)["app_name"] == "churn-desk"
    assert len(app.prompts) == 1, "an App with vibes of its own gets its own Genie round"
    assert _block(agent_ns, "app", "Show a map") in app.prompts[0] and VIBES not in app.prompts[0]
    assert json.loads(seen["deployed"][0][1]["pages/n01_u01.json"])["title"] == "Map desk"
    plain, plain_context, _seen = _flow(agent_ns, tmp_path / "plain", outputs={"dashboard_vibes": VIBES})
    plain._implement_dashboard(plain_context, _pages(_churn_page(agent_ns)))
    again = _pages(_churn_page(agent_ns))
    plain._implement_app(plain_context, again)
    assert len(again.prompts) == 1 and "SUPREME AUTHORITY" not in again.prompts[0], \
        "an App without vibes never inherits the page the dashboard's vibes shaped"
    prompts = {}
    for vibes in ("", VIBES):
        other, other_context, _s = _flow(agent_ns, tmp_path / f"p{len(vibes)}", outputs={"app_vibes": vibes})
        runner = _pages(_churn_page(agent_ns))
        other._implement_app(other_context, runner)
        prompts[vibes] = runner.prompts[0]
    assert prompts[VIBES].replace(_block(agent_ns, "app"), "") == prompts[""] and "SUPREME AUTHORITY" not in prompts[""]


def test_the_alert_prompt_carries_its_vibes_and_vibes_alone_now_reach_genie(agent_ns, tmp_path):
    prompts = {}
    for vibes in ("", VIBES):
        inst, _calls, _queries = _alert_inspire(agent_ns, tmp_path, rows=[{"triggered": True}])
        runner = _FileRunner([{"exit": 0}], [{"alert_condition.sql": GOOD}])
        inst._implement_alert(_output_context(agent_ns, **ALERT, alert_condition_text="refunds above 10 today", alert_vibes=vibes),
                              runner)
        prompts[vibes] = runner.prompts[0]
    block = _block(agent_ns, "alert")
    assert prompts[VIBES].replace(block, "") == prompts[""] and "SUPREME AUTHORITY" not in prompts[""]
    assert "true when this holds: 'refunds above 10 today'" in prompts[VIBES]
    inst, calls, _queries = _alert_inspire(agent_ns, tmp_path, rows=[{"triggered": True}])
    runner = _FileRunner([{"exit": 0}], [{"alert_condition.sql": GOOD}])
    fields = inst._implement_alert(_output_context(agent_ns, **ALERT, alert_vibes=VIBES), runner)
    assert len(runner.prompts) == 1 and block in runner.prompts[0]
    assert ("true when the customer's asks below say the alert should fire; the alert already fires when Act now rows in the latest "
            "run >= 1, and this query adds to that") in runner.prompts[0]
    assert fields["_asset"]["condition_text"] == "" and fields["_asset"]["condition_sql"] == GOOD and fields["_asset"]["vibes"] == VIBES
    [(alert, _q)] = _calls_to(calls, "POST", "/api/2.0/alerts")
    assert f"user_condition AS (\n{GOOD}\n)" in alert["query_text"]


def test_an_unchanged_alert_condition_is_reused_only_while_its_vibes_stay_the_same(agent_ns, tmp_path):
    text = "refunds above 10 today"
    recorded = {"alert": {"condition_text": text, "condition_sql": GOOD, "vibes": VIBES}}
    inst, _calls, queries = _alert_inspire(agent_ns, tmp_path, rows=[{"triggered": True}])
    context = dict(_output_context(agent_ns, **ALERT, alert_condition_text=text, alert_vibes=VIBES), asset_status=recorded)
    assert inst._implement_alert(context, _NoGenie())["_asset"]["condition_sql"] == GOOD and queries[0] == GOOD
    runner = _FileRunner([{"exit": 0}], [{"alert_condition.sql": "SELECT TRUE AS triggered FROM main.inspire.churn_out"}])
    changed = dict(_output_context(agent_ns, **ALERT, alert_condition_text=text, alert_vibes="Only on weekdays"), asset_status=recorded)
    inst._implement_alert(changed, runner)
    assert len(runner.prompts) == 1, "new vibes send the condition back to Genie"
    plain = {"alert": {"condition_text": text, "condition_sql": GOOD}}
    old, _c, old_queries = _alert_inspire(agent_ns, tmp_path, rows=[{"triggered": True}])
    old._implement_alert(dict(_output_context(agent_ns, **ALERT, alert_condition_text=text), asset_status=plain), _NoGenie())
    assert old_queries[0] == GOOD, "an alert built before vibes keeps reusing its condition"


def _alert_judge(inst, verdicts):
    judged = []

    def llm(kind, prompt, schema):
        if kind == "split":
            return {"asks": [{"ask": VIBES, "check": None}]}
        judged.append(prompt)
        verdict = verdicts[min(len(judged), len(verdicts)) - 1]
        shown = next(line[2:] for line in prompt.split("<<<\n", 1)[1].split("\n>>>", 1)[0].splitlines() if line.startswith("- "))
        return {"checks": [{"n": 1, "status": verdict, "evidence": shown if verdict == "done" else "the alert names no region",
                            "where": ""}]}

    inst._implement_vibes_llm = llm
    return judged


def test_an_unchanged_alert_that_misses_its_ask_goes_to_genie_before_it_can_hold(agent_ns, tmp_path):
    text = "refunds above 10 today"
    recorded = {"alert": {"condition_text": text, "condition_sql": GOOD, "vibes": VIBES}}
    inst, _calls, queries = _alert_inspire(agent_ns, tmp_path, rows=[{"triggered": True}])
    judged = _alert_judge(inst, ["missing", "done"])
    runner = _FileRunner([{"exit": 0}], [{"alert_condition.sql": GOOD}])
    context = dict(_output_context(agent_ns, **ALERT, alert_condition_text=text, alert_vibes=VIBES), asset_status=recorded)
    fields = inst._implement_alert(context, runner)
    assert len(runner.prompts) == 1 and len(judged) == 2, "the reused condition missed the ask, so Genie got a round before any hold"
    assert context["genie_rounds"] == {"alert": 1} and context["rebuild"]["alert"]["again"] == {"alert": [VIBES]}
    assert fields["_asset"]["condition_sql"] == GOOD
    step = next(event for event in inst.emitted if event["message"].startswith("the alert as it is built misses the user's asks"))
    assert step["message"].endswith("so Genie writes its condition again with up to 3 rounds")


def test_an_unchanged_alert_that_meets_its_ask_is_reused_with_one_check_and_no_genie_round(agent_ns, tmp_path):
    text = "refunds above 10 today"
    recorded = {"alert": {"condition_text": text, "condition_sql": GOOD, "vibes": VIBES}}
    inst, _calls, queries = _alert_inspire(agent_ns, tmp_path, rows=[{"triggered": True}])
    judged = _alert_judge(inst, ["done"])
    context = dict(_output_context(agent_ns, **ALERT, alert_condition_text=text, alert_vibes=VIBES), asset_status=recorded)
    assert inst._implement_alert(context, _NoGenie())["_asset"]["condition_sql"] == GOOD and queries[0] == GOOD
    assert len(judged) == 1 and "genie_rounds" not in context and "alert" not in (context.get("rebuild") or {})
    inst._implement_update = lambda key, **fields: None
    vibed = {"alert": VIBES}
    assert inst._implement_check_output_vibes(context, "alert", vibed, context["artifacts"]["alert"]) == []
    assert len(judged) == 1, "the check of the reused alert is the one the build records"


def test_vibes_not_done_unit_turns_each_ask_into_a_warning_and_rejects_a_bad_shape(agent_ns):
    take = agent_ns["implement_vibes_not_done"]
    data = {"title": "x", "vibes_not_done": NOT_DONE + NOT_DONE + [{"ask": " Page   me ", "reason": "alerts send email"}]}
    assert take(data, {"app_vibes": VIBES}, "app") == (["App vibe not done: Add a map of the regions: no table holds a location",
                                                         "App vibe not done: Page me: alerts send email"], [])
    assert data == {"title": "x"}, "the list is taken out of the artifact"
    stray = {"title": "x", "vibes_not_done": "junk"}
    assert take(stray, {}, "app") == ([], []) and stray == {"title": "x"}, "without vibes a stray list is dropped and says nothing"
    assert take({"vibes_not_done": "junk"}, {"app_vibes": VIBES}, "app")[1] == [
        'vibes_not_done must be a list of {"ask": ..., "reason": ...} objects']
    assert take({"vibes_not_done": [{"ask": "x"}, "y"]}, {"app_vibes": VIBES}, "app")[1] == [
        'each vibes_not_done entry needs an "ask" and a "reason"']
    assert take({"vibes_not_done": []}, {"app_vibes": VIBES}, "app") == ([], [])


def test_the_genie_agent_reports_vibes_it_could_not_do_and_publishes_and_saves_the_definition_without_them(agent_ns, tmp_path):
    inst, calls, _ran = _space_inspire(agent_ns, tmp_path)
    context = _output_context(agent_ns, genie_space_vibes=VIBES)
    bad = json.dumps(dict(json.loads(_definition(_rich_space())), vibes_not_done=["map"]))
    runner = _FileRunner([{"exit": 0}, {"exit": 0}], [{"genie_space.json": bad}, {"genie_space.json": _not_done_space()}])
    fields = inst._implement_genie_space(context, runner)
    assert 'each vibes_not_done entry needs an "ask" and a "reason"' in runner.prompts[1]
    assert fields["_warnings"] == ["Genie Agent vibe not done: Add a map of the regions: no table holds a location"]
    [(body, _q)] = _calls_to(calls, "POST", "/api/2.0/genie/spaces")
    posted = json.loads(body["serialized_space"])
    assert "vibes_not_done" not in body["serialized_space"]
    assert context["artifacts"]["genie_space"] == {"title": "Churn desk", "description": "d", "serialized_space": posted}
    title, description, space, errors = agent_ns["normalize_genie_space"](context["artifacts"]["genie_space"], context["allowed"])
    assert (title, description, space, errors) == ("Churn desk", "d", posted, []), "the saved definition normalizes to itself"


def test_the_dashboard_and_the_app_report_vibes_they_could_not_do_and_never_deploy_or_save_the_list(agent_ns, tmp_path):
    page = dict(_churn_page(agent_ns), vibes_not_done=NOT_DONE)
    inst, context, seen = _flow(agent_ns, tmp_path, outputs={"dashboard_vibes": VIBES})
    fields = inst._implement_dashboard(context, _pages(page))
    assert fields == {"dashboard_id": "d9", "dashboard_url": "https://h/dashboardsv3/d9/published",
                      "_warnings": ["Dashboard vibe not done: Add a map of the regions: no table holds a location"]}
    assert "vibes_not_done" not in json.dumps(_doc(seen)) and "vibes_not_done" not in context["page_spec"]
    assert context["artifacts"]["dashboard"] == context["page_spec"]
    app, app_context, app_seen = _flow(agent_ns, tmp_path / "app", outputs={"dashboard": False, "app_vibes": VIBES})
    fields = app._implement_app(app_context, _pages(page))
    assert fields["_warnings"][-1] == "App vibe not done: Add a map of the regions: no table holds a location"
    deployed = json.loads(app_seen["deployed"][0][1]["pages/n01_u01.json"])
    assert "vibes_not_done" not in deployed and app_context["artifacts"]["app"]["title"] == deployed["title"]
    plain, plain_context, plain_seen = _flow(agent_ns, tmp_path / "plain", outputs={"dashboard": False})
    assert not any("vibe not done" in w for w in plain._implement_app(plain_context, _pages(page)).get("_warnings") or [])
    assert "vibes_not_done" not in plain_context["artifacts"]["app"], "a stray list is dropped even without vibes"
    assert "vibes_not_done" not in plain_seen["deployed"][0][1]["pages/n01_u01.json"]


def test_the_alert_reports_vibes_it_could_not_do_from_its_own_file_and_a_broken_file_goes_back_to_genie(agent_ns, tmp_path):
    inst, _calls, _queries = _alert_inspire(agent_ns, tmp_path, rows=[{"triggered": True}])
    runner = _FileRunner([{"exit": 0}, {"exit": 0}], [{"alert_condition.sql": GOOD, "vibes_not_done.json": "[{oops"},
                                                      {"alert_condition.sql": GOOD, "vibes_not_done.json": json.dumps(NOT_DONE)}])
    context = _output_context(agent_ns, **ALERT, alert_vibes=VIBES)
    fields = inst._implement_alert(context, runner)
    assert "vibes_not_done.json is not valid JSON" in runner.prompts[1]
    assert fields["_warnings"] == ["Alert vibe not done: Add a map of the regions: no table holds a location"]
    built = context["artifacts"]["alert"]
    assert {k: built[k] for k in ("condition_text", "condition_sql")} == {"condition_text": "", "condition_sql": GOOD}
    assert (built["name"], built["trigger"], built["recipients"]) == ("N01-U01 Predict churn",
                                                                      "Act now rows in the latest run >= 1", ["owner@example.com"])
    assert built["schedule"][-1].startswith("Runs at ") and "SELECT" not in json.dumps({k: v for k, v in built.items()
                                                                                         if k != "condition_sql"})


def test_a_version_whose_judge_gives_no_usable_answer_is_held_as_unchecked_and_saves_the_candidate(agent_ns, tmp_path):
    inst, calls, _queries = _alert_inspire(agent_ns, tmp_path, rows=[{"triggered": True}])
    previous = dict(VALID, outputs={**ALL, "genie_space": False, "app": False})
    inst._implement_previous = lambda target: {"spec_version": 2, "spec_json": previous}
    inst._implement_carried = lambda target: ({"notebook_path": "/W/nb", "job_id": 77, "result_rows": 40, "dashboard_id": "d1",
                                               "alert_id": "al-1"}, _left_by(2, {"alert": {"state": "ready", "spec_version": 2,
                                                                                           "condition_text": "", "condition_sql": ""}}))
    inst._implement_use_case_row = lambda sid, uc: {"No": "N01-U01", "Name": "Predict churn", "genie_instruction": "Build"}
    inst._row_to_uc = lambda row: dict(row)
    inst._genie_notebook_spec = lambda uc: dict(_NB_SPEC, **_output_context(agent_ns)["notebook_spec"])
    inst._genie_widget_names = lambda instruction, spec: ["result_table"]
    inst._genie_involved_tables = lambda uc: ["main.s.orders"]
    inst._implement_share = lambda *args, **kwargs: []
    swapped = GOOD.replace("main.s.orders", "main.s.orders_v2")
    runner = _FileRunner([{"exit": 0}] * 3, [{"alert_condition.sql": swapped, "vibes_not_done.json": json.dumps(NOT_DONE)}] * 3)
    inst._implement_runner = lambda uc: runner
    inst._implement_dashboard = lambda context, runner: pytest.fail("only the alert's vibes changed")
    seen = _verdicts(inst, ["Add a map of the regions"], status="impossible", evidence="no table holds a location")
    status = _run(inst, dict(previous, outputs={**previous["outputs"], "alert_vibes": VIBES}))
    assert status == "vibe_not_met" and len(runner.prompts) == 1, \
        "a judge that gives no usable answer leaves the ask unchecked, so it never goes back to Genie and the version holds"
    assert seen.count("judge") == 2, "an unusable verdict is asked again once, past the cache, before the ask is unchecked"
    assert "Inspire split them into these asks and checks each one in what you write:\n1. Add a map of the regions\n" in runner.prompts[0]
    final, missed = inst.updates[-1], agent_ns["IMPLEMENT_VIBES_NO_ANSWER"]
    assert final["status"] == "vibe_not_met" and final["asset_status"]["held"]["parts"] == ["alert"]
    assert final["asset_status"]["held"]["reason"].startswith("1 ask could not be checked, so nothing of v3 is published and v2 stays live")
    assert f"Alert: Add a map of the regions: {missed}" in final["asset_status"]["held"]["reason"], \
        "the held reason names the ask and says the check could not run"
    assert "snapshot" not in final["asset_status"]["alert"] and "warnings" not in final["asset_status"]["alert"], \
        "a held alert is not deployed, so its live record gains no snapshot and no warnings of this version"
    tried = [f"round 1: {missed}"]
    assert final["asset_status"]["alert"]["vibes_checks"] == [{"ask": "Add a map of the regions", "status": "missing",
                                                               "evidence": missed, "rounds": 1, "tried": tried}]
    assert final["asset_status"]["checklist_summary"] == {"met": 0, "total": 1}
    shown = f"{missed}. Nothing shows the ask was missed"
    assert final["asset_status"]["checklist"] == [{"n": 1, "requirement": "Add a map of the regions", "part": "alert", "where": "",
                                                   "status": "not_met", "evidence": f"{shown}: press Try again to check it again",
                                                   "fact": shown, "rounds": 1, "tried": tried, "checks": [], "published_anyway": None,
                                                   "unchecked": True}]
    assert "impossible" not in json.dumps(final["asset_status"]) and "doable" not in json.dumps(final["asset_status"])
    saved = next(u for u in inst.updates if "asset_snapshots" in u)
    snapshots = json.loads(saved["asset_snapshots"])
    artifact = snapshots["alert"].pop("artifact")
    assert "alert_id" not in saved and snapshots == {"alert": {"vibes": VIBES, "spec_version": 3, "merged_into": "", "held": True}}
    assert (artifact["condition_text"], artifact["condition_sql"], artifact["recipients"]) == ("", swapped, ["owner@example.com"])
    assert {"name", "trigger", "schedule", "destinations"} <= set(artifact), "the next version compares what a person saw in this one"
    assert _calls_to(calls, "PATCH", "/api/2.0/alerts/al-1") == [] and _calls_to(calls, "POST", "/api/2.0/alerts") == [], \
        "a held version saves no alert: the live one stays as it was"


def test_only_outputs_that_deployed_save_a_snapshot_and_a_version_with_none_writes_no_column(agent_ns):
    inst, previous = _locked(agent_ns)
    inst._implement_runner = lambda uc: "genie"

    def space(context, runner):
        context.setdefault("artifacts", {})["genie_space"] = {"title": "t", "serialized_space": {"version": 2}}
        return {"genie_space_id": "g1", "genie_space_url": "https://h/genie/rooms/g1", "_asset": {"merged_into": "gA"}}

    def dashboard(context, runner):
        context.setdefault("artifacts", {})["dashboard"] = {"title": "never saved"}
        raise RuntimeError("dataset records failed: warehouse stopped")

    inst._implement_genie_space, inst._implement_dashboard = space, dashboard
    _verdicts(inst, ["Answer in plain words"])
    status = _run(inst, dict(previous, outputs={**ALL, "genie_space_vibes": VIBES, "dashboard_vibes": "Put the top 10 first"}))
    assert status == "vibe_not_met", "the dashboard that did not build leaves its ask unmet, so the version is held"
    assert "Dashboard: Answer in plain words: the Dashboard was not built" in inst.updates[-1]["asset_status"]["held"]["reason"]
    [saved] = [u for u in inst.updates if "asset_snapshots" in u]
    assert set(saved) == {"genie_space_id", "genie_space_url", "asset_snapshots"}
    assert json.loads(saved["asset_snapshots"]) == {"genie_space": {"artifact": {"title": "t", "serialized_space": {"version": 2}},
                                                                    "vibes": VIBES, "spec_version": 3, "merged_into": "gA"}}
    status_of = inst.updates[-1]["asset_status"]
    checked = status_of["genie_space"].pop("vibes_checks")
    assert [(c["ask"], c["status"]) for c in checked] == [("Answer in plain words", "done")]
    assert checked[0]["evidence"] in json.dumps({"title": "t", "serialized_space": {"version": 2}}, sort_keys=True)
    assert status_of["genie_space"].pop("vibes_split") == {"text": VIBES, "asks": [{"ask": "Answer in plain words", "check": None,
                                                                                    "keep": False, "where": ""}]}
    assert status_of["genie_space"] == {"merged_into": "gA", "state": "ready", "spec_version": 3, "snapshot": True,
                                        "title": "N01-U01 Predict churn"}
    assert status_of["dashboard"].pop("vibes_checks") == [{"ask": "Answer in plain words", "status": "missing", "evidence":
                                                           "the Dashboard was not built: dataset records failed: warehouse stopped"}]
    status_of["dashboard"].pop("vibes_split")
    assert status_of["dashboard"] == {"state": "failed", "error": "dataset records failed: warehouse stopped", "spec_version": 3}
    plain, previous = _locked(agent_ns)
    plain._implement_runner = lambda uc: "genie"
    plain._implement_dashboard = lambda context, runner: {"dashboard_id": "d1", "dashboard_url": "https://h/d"}
    _verdicts(plain, ["Answer in plain words"])
    assert _run(plain, dict(previous, outputs={**ALL, "dashboard_vibes": VIBES})) == "vibe_not_met", \
        "a build that leaves nothing to check its asks against is never a silent ready"
    assert ("Dashboard: Answer in plain words: Inspire has nothing built for the Dashboard to check"
            in plain.updates[-1]["asset_status"]["held"]["reason"])
    assert not any("asset_snapshots" in u for u in plain.updates)
    assert "snapshot" not in plain.updates[-1]["asset_status"]["dashboard"]


def test_the_snapshot_column_is_added_to_old_tables_and_kept_out_of_every_default_read(agent_ns, tmp_path, monkeypatch):
    old = [{"col_name": name} for name, _kind in agent_ns["IMPLEMENT_COLUMNS"] if name != "asset_snapshots"]
    spark = FakeSpark(responder=lambda s: old if s.startswith("DESCRIBE TABLE `my-cat`.`inspire`.`__inspire_implement`") else [])
    writer = _writer(agent_ns, spark, tmp_path, monkeypatch)
    try:
        writer._ensure_implement_table()
    finally:
        writer._session_writer.stop(drain_timeout=5.0)
    assert [s for s in spark.statements if " ADD COLUMN " in s] == [
        "ALTER TABLE `my-cat`.`inspire`.`__inspire_implement` ADD COLUMN `asset_snapshots` STRING"]
    assert agent_ns["IMPLEMENT_COLUMNS"][-1] == ("asset_snapshots", "STRING")
    assert "asset_snapshots" not in agent_ns["DatabricksInspire"]._IMPLEMENT_READ_COLUMNS
    inst = _probe_inspire(agent_ns, lambda statement: [], {})
    inst._implement_select("session_id = :sid", {"sid": 1})
    assert inst.spark.statements and "asset_snapshots" not in inst.spark.statements[-1]


@pytest.mark.parametrize("rows,version", [
    ([], 1), ([{"asset_snapshots": None}], 1), ([{"asset_snapshots": "{not json"}], 1), ([{"asset_snapshots": "[1]"}], 1),
    ([{"asset_snapshots": json.dumps({"app": {"artifact": {"title": "x"}}})}], 1),
    ([{"asset_snapshots": json.dumps({"dashboard": {"vibes": "x"}})}], 1),
    ([{"asset_snapshots": json.dumps({"dashboard": {"artifact": "page"}})}], 1),
    ([{"asset_snapshots": json.dumps({"dashboard": {"artifact": {"title": "x"}}})}], 3),
    ([{"asset_snapshots": json.dumps({"dashboard": {"artifact": {"title": "x"}}})}], 4),
])
def test_a_rollback_without_a_saved_earlier_output_fails_with_the_exact_reason(agent_ns, rows, version):
    inst = _probe_inspire(agent_ns, lambda statement: rows if statement.startswith("SELECT asset_snapshots") else [], {})
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        inst._implement_snapshot((5150, "N01-U01", 3), "dashboard", version)
    assert str(raised.value) == f"v{version} has no saved Dashboard to roll back to"
    assert [s for s in inst.spark.statements if s.startswith("SELECT asset_snapshots")] == ([SNAPSHOT_SQL] if version < 3 else [])
    alert = _probe_inspire(agent_ns, lambda s: [{"asset_snapshots": json.dumps({"alert": {"artifact": {"condition_text": "x"}}})}], {})
    with pytest.raises(agent_ns["ImplementBlocked"], match="^v1 has no saved Alert to roll back to$"):
        alert._implement_snapshot((5150, "N01-U01", 3), "alert", 1)


def test_a_rollback_replays_the_saved_artifact_with_no_genie_and_saves_it_again_for_later(agent_ns, capsys):
    saved = {"dashboard": {"artifact": {"id": "n01_u01", "title": "v1 desk"}, "vibes": "Put the top 10 first", "spec_version": 1,
                           "merged_into": ""}, "app": {"artifact": {"id": "n01_u01"}, "vibes": "", "spec_version": 1, "merged_into": ""}}
    inst, previous = _locked(agent_ns, {"dashboard_vibes": "Add a map"},
                             lambda s: [{"asset_snapshots": json.dumps(saved)}] if s.startswith("SELECT asset_snapshots") else [])
    inst._implement_runner = lambda uc: pytest.fail("a rollback never installs or asks Genie")
    replayed = []

    def dashboard(context, runner):
        replayed.append((context["replay"]["dashboard"], runner))
        context.setdefault("artifacts", {})["dashboard"] = context["replay"]["dashboard"][1]["artifact"]
        return {"dashboard_id": "d1", "dashboard_url": "https://h/d"}

    inst._implement_dashboard = dashboard
    asked = _verdicts(inst, ["Put the top 10 first"])
    current = dict(previous, outputs={**previous["outputs"], "dashboard_vibes": "Put the top 10 first"}, rollback_outputs={"dashboard": 1})
    assert _run(inst, current) == "ready"
    assert asked == ["split", "judge"], "the rolled back dashboard is checked against the vibes it was built with"
    assert replayed == [((1, saved["dashboard"]), None)]
    assert inst.updates[0]["change_classes"] == "outputs,rollback"
    assert [s for s in inst.spark.statements if s.startswith("SELECT asset_snapshots")] == [SNAPSHOT_SQL]
    [update] = [u for u in inst.updates if "asset_snapshots" in u]
    assert json.loads(update["asset_snapshots"]) == {"dashboard": dict(saved["dashboard"], spec_version=3)}
    dashboard_status = inst.updates[-1]["asset_status"]["dashboard"]
    assert [c["status"] for c in dashboard_status.pop("vibes_checks")] == ["done"] and dashboard_status.pop("vibes_split")
    assert dashboard_status == {"state": "ready", "spec_version": 3, "snapshot": True, "title": "N01-U01 Predict churn"}
    assert "⏪ [IMPLEMENT-ROLLBACK] N01-U01 dashboard v1 -> v3" in capsys.readouterr().out
    plan = [e for e in inst.emitted if e["step_name"] == "Plan"][0]
    assert "; roll back dashboard to v1" in plan["message"]


def test_a_rollback_with_nothing_saved_fails_only_that_output_and_the_others_still_build(agent_ns, capsys):
    inst, previous = _locked(agent_ns, None, lambda s: [{"asset_snapshots": json.dumps({"app": {"artifact": {}}})}]
                             if s.startswith("SELECT asset_snapshots") else [])
    inst._implement_runner = lambda uc: "genie"

    def space(context, runner):
        context.setdefault("artifacts", {})["genie_space"] = {"title": "Churn desk"}
        return {"genie_space_id": "g1", "genie_space_url": "https://h/genie/rooms/g1"}

    inst._implement_genie_space = space
    _verdicts(inst, ["Answer in plain words"])
    current = dict(previous, outputs={**ALL, "genie_space_vibes": VIBES}, rollback_outputs={"dashboard": 1, "alert": 3})
    assert _run(inst, current) == "ready_with_warnings"
    final = inst.updates[-1]
    assert final["status_message"] == "Dashboard: v1 has no saved Dashboard to roll back to; Alert: v3 has no saved Alert to roll back to"
    assert final["asset_status"]["dashboard"] == {"state": "failed", "error": "v1 has no saved Dashboard to roll back to", "spec_version": 3}
    assert final["asset_status"]["alert"] == {"state": "failed", "error": "v3 has no saved Alert to roll back to", "spec_version": 3}
    space_status = final["asset_status"]["genie_space"]
    assert [c["status"] for c in space_status.pop("vibes_checks")] == ["done"] and space_status.pop("vibes_split")
    assert space_status == {"state": "ready", "spec_version": 3, "snapshot": True, "title": "N01-U01 Predict churn"}
    assert final["asset_status"]["app"] == {"state": "ready", "spec_version": 2}, "an output outside the version stays as it was"
    out = capsys.readouterr().out
    assert "[IMPLEMENT-ROLLBACK] N01-U01 dashboard v1 -> v3" in out and "[IMPLEMENT-ROLLBACK] N01-U01 alert v3 -> v3" in out
    assert len([s for s in inst.spark.statements if s.startswith("SELECT asset_snapshots")]) == 1, "v3 is never read for v3"


def _gone_dashboard(ns):
    inst, previous = _locked(ns)
    carried = {k: v for k, v in BUILT.items() if not k.startswith("dashboard")}
    gone = dict(json.loads(json.dumps(LIVE)), dashboard={"state": "deleted", "note": "deleted at the user's request in spec v2"})
    inst._implement_carried = lambda target: (dict(carried), _left_by(2, json.loads(json.dumps(gone))))
    return inst, previous


def test_a_rollback_of_a_dashboard_that_is_gone_builds_a_new_one_and_reads_no_snapshot(agent_ns):
    inst, previous = _gone_dashboard(agent_ns)
    inst._implement_runner = lambda uc: "genie"
    built = []

    def dashboard(context, runner):
        built.append(((context.get("replay") or {}).get("dashboard"), runner))
        return {"dashboard_id": "d2", "dashboard_url": "https://h/d2"}

    inst._implement_dashboard = dashboard
    assert _run(inst, dict(previous, rollback_outputs={"dashboard": 1})) == "ready_with_warnings", inst.updates[-1]
    assert built == [(None, "genie")]
    assert [s for s in inst.spark.statements if s.startswith("SELECT asset_snapshots")] == []
    plan = [e for e in inst.emitted if e["step_name"] == "Plan"][0]["message"]
    assert "; build dashboard" in plan and "roll back" not in plan
    final = inst.updates[-1]
    assert final["status_message"] == GONE_WARNING, "the person who asked for a rollback is told a new Dashboard was built instead"
    assert final["asset_status"]["dashboard"]["state"] == "ready"
    assert final["asset_status"]["dashboard"]["warnings"] == [GONE_WARNING.removeprefix("Dashboard: ")]


def test_a_rollback_of_a_gone_dashboard_whose_new_build_fails_says_both(agent_ns, monkeypatch):
    inst, previous = _gone_dashboard(agent_ns)
    inst._implement_runner = lambda uc: "genie"
    waits = []
    monkeypatch.setattr(agent_ns["time"], "sleep", waits.append)

    def dashboard(context, runner):
        raise RuntimeError("the warehouse is stopped")

    inst._implement_dashboard = dashboard
    assert _run(inst, dict(previous, rollback_outputs={"dashboard": 1})) == "ready_with_warnings", inst.updates[-1]
    assert waits == [60, 60], "a stopped warehouse starts on the next query, so each retry waits a minute for it"
    final = inst.updates[-1]
    assert final["status_message"] == f"{GONE_WARNING}; Dashboard: Inspire tried 3 times and could not build it: the warehouse is stopped"
    assert final["asset_status"]["dashboard"]["state"] == "failed"


def test_an_unticked_dashboard_that_is_gone_stays_gone_and_is_not_marked_kept(agent_ns):
    inst, previous = _gone_dashboard(agent_ns)
    current = dict(previous, outputs={**ALL, "dashboard": False}, removed_outputs={"dashboard": "keep"})
    assert _run(inst, current) == "ready", inst.updates[-1]
    assert inst.updates[-1]["asset_status"]["dashboard"] == {"state": "deleted", "note": "deleted at the user's request in spec v2"}


def test_the_genie_agent_rolls_back_in_place_from_its_saved_definition_without_genie(agent_ns, tmp_path):
    inst, calls, _ran = _space_inspire(agent_ns, tmp_path)
    built = _output_context(agent_ns, genie_space_vibes=VIBES)
    inst._implement_genie_space(built, _FileRunner([{"exit": 0}], [{"genie_space.json": _not_done_space()}]))
    posted = json.loads(_calls_to(calls, "POST", "/api/2.0/genie/spaces")[0][0]["serialized_space"])
    again, again_calls, ran = _space_inspire(agent_ns, tmp_path)
    again._implement_genie_loop = _no_loop
    context = dict(_output_context(agent_ns), assets={"genie_space": "s9"}, replay={"genie_space": _saved(built["artifacts"]["genie_space"], 2)})
    fields = again._implement_genie_space(context, _NoGenie())
    assert fields["genie_space_id"] == "s9" and "_warnings" in fields and fields["_warnings"] == []
    [(body, _q)] = _calls_to(again_calls, "PATCH", "/api/2.0/genie/spaces/s9")
    assert json.loads(body["serialized_space"]) == posted and body["title"] == "Churn desk"
    assert _calls_to(again_calls, "POST", "/api/2.0/genie/spaces") == [], "the same Genie Agent is updated, never a second one"
    assert any(s.startswith("SELECT entity_label FROM main.inspire.churn_out") for s in ran), "its checks ran again on the current tables"
    assert context["artifacts"]["genie_space"] == built["artifacts"]["genie_space"]
    steps = [(e["status"], e["message"]) for e in again.emitted if e["step_name"] == "Genie Agent"]
    assert steps[0] == ("started", "rolling the Genie Agent back to the one Genie wrote in v2, with no Genie round; its checks run "
                                   "against the current tables first")
    assert steps[-1] == ("ended_success", "Genie Agent rolled back to v2")


def test_a_genie_agent_rollback_that_no_longer_passes_its_checks_changes_nothing(agent_ns, tmp_path):
    inst, _calls, _ran = _space_inspire(agent_ns, tmp_path)
    built = _output_context(agent_ns)
    inst._implement_genie_space(built, _FileRunner([{"exit": 0}], [{"genie_space.json": _definition(_rich_space())}]))
    again, calls, _r = _space_inspire(agent_ns, tmp_path, failing=("WHERE priority_tier = 'Act now'",))
    again._implement_genie_loop = _no_loop
    context = dict(_output_context(agent_ns), assets={"genie_space": "s9"}, replay={"genie_space": _saved(built["artifacts"]["genie_space"])})
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        again._implement_genie_space(context, _NoGenie())
    assert str(raised.value) == ("the v1 Genie Agent no longer passes its checks against the current tables: the example SQL for "
                                 "'Which customers act now?' failed: [UNRESOLVED_COLUMN] zz cannot be resolved")
    assert [c for c in calls if c[0] in ("POST", "PATCH")] == [], "the live Genie Agent is left as it was"
    assert "artifacts" not in context


def test_the_dashboard_rolls_back_in_place_from_its_saved_page_and_a_failed_check_publishes_nothing(agent_ns, tmp_path):
    inst, built, seen = _flow(agent_ns, tmp_path, outputs={"dashboard_vibes": VIBES})
    inst._implement_dashboard(built, _pages(_churn_page(agent_ns, title="Desk as it was in v1")))
    page = built["artifacts"]["dashboard"]
    again, context, again_seen = _flow(agent_ns, tmp_path / "again", assets={"dashboard": "d9"})
    again._implement_genie_loop = _no_loop
    context["replay"] = {"dashboard": _saved(page)}
    fields = again._implement_dashboard(context, _NoGenie())
    assert fields == {"dashboard_id": "d9", "dashboard_url": "https://h/dashboardsv3/d9/published"}
    assert [c[:2] for c in _published(again_seen)] == [("PATCH", "/api/2.0/lakeview/dashboards/d9"),
                                                       ("POST", "/api/2.0/lakeview/dashboards/d9/published")]
    assert _doc(again_seen) == _doc(seen) and context["artifacts"]["dashboard"] == page
    broken, broken_context, broken_seen = _flow(agent_ns, tmp_path / "broken", assets={"dashboard": "d9"}, fail="main.inspire.churn_out")
    broken._implement_genie_loop = _no_loop
    broken_context["replay"] = {"dashboard": _saved(page, 4)}
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        broken._implement_dashboard(broken_context, _NoGenie())
    assert str(raised.value) == ("the v4 Dashboard no longer passes its checks against the current tables: dataset records failed: "
                                 "UNRESOLVED_COLUMN: boom")
    assert _published(broken_seen) == [] and broken_seen["calls"] == []


def test_the_app_rolls_back_to_its_saved_page_under_the_same_name_and_a_failed_check_deploys_nothing(agent_ns, tmp_path):
    inst, built, seen = _flow(agent_ns, tmp_path, outputs={"dashboard": False})
    inst._implement_app(built, _pages(_churn_page(agent_ns, title="Desk as it was in v1")))
    page = built["artifacts"]["app"]
    again, context, again_seen = _flow(agent_ns, tmp_path / "again", outputs={"dashboard": False}, assets={"app": "churn-desk"})
    again._implement_genie_loop = _no_loop
    context["replay"] = {"app": _saved(page)}
    assert again._implement_app(context, _NoGenie())["app_name"] == "churn-desk"
    name, files, _reads, _space = again_seen["deployed"][0]
    assert name == "churn-desk" and files["pages/n01_u01.json"] == seen["deployed"][0][1]["pages/n01_u01.json"]
    failing = lambda work, files, modules, warehouse: ["page n01_u01: chart:by_category failed: UNRESOLVED_COLUMN"]
    broken, broken_context, broken_seen = _flow(agent_ns, tmp_path / "broken", outputs={"dashboard": False},
                                                assets={"app": "churn-desk"}, _implement_app_check=failing)
    broken._implement_genie_loop = _no_loop
    broken_context["replay"] = {"app": _saved(page)}
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        broken._implement_app(broken_context, _NoGenie())
    assert str(raised.value) == ("the v1 App no longer passes its checks against the current tables: the App was run at its default "
                                 "filters and page n01_u01: chart:by_category failed: UNRESOLVED_COLUMN")
    assert broken_seen["deployed"] == []


def test_the_alert_rolls_back_in_place_to_its_saved_condition_and_a_failed_check_saves_nothing(agent_ns, tmp_path):
    inst, calls, queries = _alert_inspire(agent_ns, tmp_path, {("PATCH", "/api/2.0/alerts/al-1"): {"id": "al-1"}},
                                          rows=[{"triggered": True}])
    inst._implement_runner = lambda uc: pytest.fail("a rollback never installs Genie Code")
    inst._implement_genie_loop = _no_loop
    artifact = {"condition_text": "refunds above 10 today", "condition_sql": GOOD}
    context = dict(_output_context(agent_ns, **ALERT, alert_condition_text="refunds above 10 this week", alert_vibes=VIBES),
                   assets={"alert": "al-1"}, replay={"alert": _saved(artifact, 2, VIBES)})
    fields = inst._implement_alert(context, None)
    [(body, _q)] = _calls_to(calls, "PATCH", "/api/2.0/alerts/al-1")
    assert f"user_condition AS (\n{GOOD}\n)" in body["query_text"] and queries[0] == GOOD
    assert _calls_to(calls, "POST", "/api/2.0/alerts") == []
    assert (fields["alert_id"], fields["_asset"]["condition_text"], fields["_asset"]["vibes"]) == ("al-1", "refunds above 10 today", VIBES)
    assert "_warnings" not in fields and {k: context["artifacts"]["alert"][k] for k in artifact} == artifact
    plain = dict(_output_context(agent_ns, **ALERT), assets={"alert": "al-1"},
                 replay={"alert": _saved({"condition_text": "", "condition_sql": ""}, 2)})
    other, other_calls, other_queries = _alert_inspire(agent_ns, tmp_path, rows=[{"tier_rows": 0}])
    other._implement_genie_loop = _no_loop
    other._implement_alert(plain, None)
    assert "user_condition" not in other_queries[0], "an alert saved without a condition rolls back to the plain tier alert"
    broken, broken_calls, _q = _alert_inspire(agent_ns, tmp_path)
    broken._implement_run_query_check = _raising("TABLE_OR_VIEW_NOT_FOUND: main.s.orders")
    broken._implement_genie_loop = _no_loop
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        broken._implement_alert(dict(context, replay={"alert": _saved(artifact, 2, VIBES)}), None)
    assert str(raised.value) == ("the v2 Alert no longer passes its checks against the current tables: TABLE_OR_VIEW_NOT_FOUND: "
                                 "main.s.orders")
    assert [c for c in broken_calls if c[0] in ("POST", "PATCH")] == []
    saving, saving_calls, _q = _alert_inspire(agent_ns, tmp_path,
                                              {("PATCH", "/api/2.0/alerts/al-1"): RuntimeError("INTERNAL_ERROR: the alerts service did not answer")},
                                              rows=[{"triggered": True}])
    saving._implement_genie_loop = _no_loop
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        saving._implement_alert(dict(context, replay={"alert": _saved(artifact, 2, VIBES)}), None)
    assert str(raised.value) == "the alert could not be saved: INTERNAL_ERROR: the alerts service did not answer", \
        "a failure after the checks passed keeps its own reason"
    locked, _calls, _q = _alert_inspire(agent_ns, tmp_path, {("PATCH", "/api/2.0/alerts/al-1"): RuntimeError("PERMISSION_DENIED")},
                                        rows=[{"triggered": True}])
    locked._implement_genie_loop = _no_loop
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        locked._implement_alert(dict(context, replay={"alert": _saved(artifact, 2, VIBES)}), None)
    assert str(raised.value) == ("The identity Inspire builds as can open the alert al-1 of this use case but cannot change it, so Inspire did "
                                 "not change it: give that identity Can manage on it, or delete it so Inspire builds a new one, then build again")


def test_a_merged_dashboard_rolls_back_through_the_merge_path_into_its_host(agent_ns, tmp_path):
    routes = {("GET", "/api/2.0/lakeview/dashboards/dA"): DASH, ("PATCH", "/api/2.0/lakeview/dashboards/dA"): {"etag": "e2"},
              ("POST", "/api/2.0/lakeview/dashboards/dA/published"): {}}
    inst, calls = _dashboard_inspire(agent_ns, tmp_path, routes)
    inst._implement_genie_loop = _no_loop
    page = agent_ns["implement_app_page"](_churn_page(agent_ns, title="Desk as it was in v1"), "N01-U01", {}, "main.inspire.churn_out")
    context = dict(_output_context(agent_ns, merge={"dashboard": "dA"}), assets={"dashboard": "dA"},
                   asset_status={"dashboard": {"state": "ready", "merged_into": "dA"}}, replay={"dashboard": _saved(page, 1, "", "dA")})
    fields = inst._implement_dashboard(context, _NoGenie())
    assert fields == {"dashboard_id": "dA", "dashboard_url": "https://h/dashboardsv3/dA/published", "_asset": {"merged_into": "dA"}}
    assert [c[:2] for c in calls] == [("GET", "/api/2.0/lakeview/dashboards/dA"), ("GET", "/api/2.0/lakeview/dashboards/dA"),
                                      ("PATCH", "/api/2.0/lakeview/dashboards/dA"), ("POST", "/api/2.0/lakeview/dashboards/dA/published")]
    board = json.loads(calls[2][2]["serialized_dashboard"])
    assert [p["name"] for p in board["pages"]][:2] == ["home", "filters"]
    assert "N01-U01 Desk as it was in v1" in [p["displayName"] for p in board["pages"]]


def test_a_merged_app_rolls_back_through_the_merge_path_and_keeps_the_hosts_pages(agent_ns, tmp_path, monkeypatch):
    inst, context, seen, _calls = _merge_flow(agent_ns, tmp_path, monkeypatch)
    inst._implement_genie_loop = _no_loop
    page = agent_ns["implement_app_page"](_churn_page(agent_ns, title="Desk as it was in v1"), "N01-U01", {}, "main.inspire.churn_out")
    context["replay"] = {"app": _saved(page, 1, "", "sales-desk")}
    fields = inst._implement_app(context, _NoGenie())
    name, files, _reads, _space = seen["deployed"][0]
    assert name == "sales-desk" and fields["_asset"]["merged_into"] == "sales-desk"
    assert json.loads(files["pages/n01_u01_s5150.json"])["title"] == "Desk as it was in v1"
    assert json.loads(files["pages/n01_u07.json"]) == _host_page(agent_ns), "the host's own page is deployed unchanged"


def test_each_output_refresh_updates_its_existing_asset_and_a_failed_check_leaves_it_untouched(agent_ns, tmp_path, sdk_stub):
    dash, dash_context, dash_seen = _flow(agent_ns, tmp_path / "d", outputs={"dashboard_vibes": VIBES}, assets={"dashboard": "d9"})
    dash._implement_dashboard(dash_context, _pages(_churn_page(agent_ns)))
    assert [c[:2] for c in _published(dash_seen)] == [("PATCH", "/api/2.0/lakeview/dashboards/d9"),
                                                      ("POST", "/api/2.0/lakeview/dashboards/d9/published")]
    broken, broken_context, broken_seen = _flow(agent_ns, tmp_path / "db", outputs={"dashboard_vibes": VIBES}, assets={"dashboard": "d9"},
                                                fail="main.inspire.churn_out")
    with pytest.raises(RuntimeError, match="still failed after 3 Genie rounds"):
        broken._implement_dashboard(broken_context, _pages(*[_churn_page(agent_ns)] * 3))
    assert broken_seen["calls"] == []
    space, space_calls, _ran = _space_inspire(agent_ns, tmp_path)
    space._implement_genie_space(dict(_output_context(agent_ns, genie_space_vibes=VIBES), assets={"genie_space": "s9"}),
                                 _FileRunner([{"exit": 0}], [{"genie_space.json": _definition(_rich_space())}]))
    written = [c[:2] for c in space_calls if c[0] in ("POST", "PATCH") and "/conversation" not in c[1] and "start-" not in c[1]]
    assert written == [("PATCH", "/api/2.0/genie/spaces/s9")]
    stuck, stuck_calls, _r = _space_inspire(agent_ns, tmp_path)
    stuck._implement_run_query_check = _raising("[UNRESOLVED_COLUMN] zz")
    with pytest.raises(RuntimeError, match="still failed after 3 Genie rounds"):
        stuck._implement_genie_space(dict(_output_context(agent_ns, genie_space_vibes=VIBES), assets={"genie_space": "s9"}),
                                     _FileRunner([{"exit": 0}] * 3, [{"genie_space.json": _definition(_rich_space())}] * 3))
    assert [c for c in stuck_calls if c[0] in ("POST", "PATCH")] == []
    app, app_context, app_seen = _flow(agent_ns, tmp_path / "a", outputs={"dashboard": False, "app_vibes": VIBES},
                                       assets={"app": "churn-desk"})
    app._implement_app(app_context, _pages(_churn_page(agent_ns)))
    assert [d[0] for d in app_seen["deployed"]] == ["churn-desk"]
    deploy, deploy_context, deploy_calls, _imported = _deploy_inspire(agent_ns, [
        {"description": OURS_APP, "compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-2"},
        {"deployment_id": "dep1", "status": {"state": "SUCCEEDED"}}, {"url": "https://churn-desk.example/"}])
    deploy._implement_deploy_app(deploy_context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert ("POST", "/api/2.0/apps") not in [c[:2] for c in deploy_calls], "the App is redeployed under its name, never created again"
    failing = lambda work, files, modules, warehouse: ["page n01_u01: chart:by_category failed: warehouse stopped"]
    held, held_context, held_seen = _flow(agent_ns, tmp_path / "ab", outputs={"dashboard": False, "app_vibes": VIBES},
                                          assets={"app": "churn-desk"}, _implement_app_check=failing)
    with pytest.raises(RuntimeError, match="still failed after 3 Genie rounds"):
        held._implement_app(held_context, _pages(*[_churn_page(agent_ns)] * 3))
    assert held_seen["deployed"] == []
    alert, alert_calls, _q = _alert_inspire(agent_ns, tmp_path, {("PATCH", "/api/2.0/alerts/al-1"): {"id": "al-1"}},
                                            rows=[{"triggered": True}])
    alert._implement_alert(dict(_output_context(agent_ns, **ALERT, alert_vibes=VIBES), assets={"alert": "al-1"}),
                           _FileRunner([{"exit": 0}], [{"alert_condition.sql": GOOD}]))
    assert len(_calls_to(alert_calls, "PATCH", "/api/2.0/alerts/al-1")) == 1 and _calls_to(alert_calls, "POST", "/api/2.0/alerts") == []
    quiet, quiet_calls, _q = _alert_inspire(agent_ns, tmp_path)
    quiet._implement_run_query_check = _raising("boom")
    with pytest.raises(RuntimeError, match="still failed after 3 Genie rounds"):
        quiet._implement_alert(dict(_output_context(agent_ns, **ALERT, alert_vibes=VIBES), assets={"alert": "al-1"}),
                               _FileRunner([{"exit": 0}] * 3, [{"alert_condition.sql": GOOD}] * 3))
    assert [c for c in quiet_calls if c[0] in ("POST", "PATCH")] == []


def _noted(ns, notes, **changes):
    spec = json.loads(json.dumps(VALID))
    spec["data"] = dict(spec["data"], notes=notes)
    spec.update(changes)
    return ns["validate_implement_spec"](spec)


def test_round_50_the_notebook_vibes_hold_2000_characters_and_longer_or_non_text_ones_are_errors_never_cut(agent_ns):
    spec, errors = _noted(agent_ns, "  " + "n" * 2000 + "\n")
    assert errors == [] and spec["data"]["notes"] == "n" * 2000
    spec, errors = _noted(agent_ns, "n" * 2001)
    assert errors == ["the notebook vibes are 2,001 characters; at most 2,000 are allowed"] and spec["data"]["notes"] == "n" * 2001
    for bad, shown in ((5, "5"), (["a"], '["a"]'), ({"a": 1}, '{"a":1}'), (True, "true")):
        assert _noted(agent_ns, bad)[1] == [f"data.notes must be text, not {shown}"], bad
    assert _noted(agent_ns, None)[0]["data"]["notes"] == ""


def test_round_50_the_notebook_vibes_reach_genie_word_for_word_and_a_change_rewrites_the_notebook_and_refreshes_every_output(agent_ns):
    markdown = agent_ns["implement_choices_markdown"]
    asks = "Score the baseline and every candidate on the same held-out baskets, and print each one's hit count."
    before, after = _noted(agent_ns, "")[0], _noted(agent_ns, asks)[0]
    text = markdown(after)
    assert f'- The customer\'s asks for this notebook, word for word: """{asks}""" They are explicit user directives' in text
    assert "note on the data" not in text and "customer's asks" not in markdown(before)
    assert agent_ns["classify_implement_change"](before, after) == ["data"]
    plan = agent_ns["implement_plan"](before, after, ASSETS, has_built_notebook=True)
    chosen = [n for n in agent_ns["IMPLEMENT_OUTPUTS"] if after["outputs"].get(n)]
    assert plan["refill"] is True and plan["refresh"] == chosen and chosen
    changed = markdown(_noted(agent_ns, "Only score baskets of 3 or more items.")[0], after)
    assert "Withdrawn since the earlier version: The customer's asks for this notebook" in changed and asks in changed


def test_round_50_rebuilding_the_notebook_refills_it_reruns_it_and_has_genie_recheck_every_cell(agent_ns):
    spec, errors = _spec(agent_ns, retry_outputs=["notebook", " notebook "])
    assert errors == [] and spec["retry_outputs"] == ["notebook"]
    before = _spec(agent_ns)[0]
    assert agent_ns["classify_implement_change"](before, spec) == ["retry"]
    plan = agent_ns["implement_plan"](before, spec, ASSETS, has_built_notebook=True)
    chosen = [n for n in agent_ns["IMPLEMENT_OUTPUTS"] if spec["outputs"].get(n)]
    assert (plan["refill"], plan["preview"], plan["schedule"], plan["build"], plan["refresh"]) == (True, True, True, [], chosen)
    retried = _spec(agent_ns, retry_outputs=["dashboard"])[0]
    assert agent_ns["implement_plan"](before, retried, ASSETS, has_built_notebook=True)["refill"] is False, \
        "retrying an output never rewrites the notebook"
    recheck = "The user asked for the notebook to be built again. Check every cell against the instruction and the platform rules"
    assert recheck in agent_ns["implement_choices_markdown"](spec, before)
    assert recheck not in agent_ns["implement_choices_markdown"](spec), "a first build has nothing to build again"
    assert recheck not in agent_ns["implement_choices_markdown"](retried, before)
    assert _spec(agent_ns, retry_outputs=["pdf"])[1] == ["retry output 'pdf' is not one of notebook, genie_space, dashboard, app, alert"]
