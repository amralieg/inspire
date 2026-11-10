import json
from types import SimpleNamespace

import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import _inspire, _left_by, _spec
from v143_vibes_test import BUILT, LIVE, _locked, _run

RISKY = "Put the riskiest customers first"
WEEKDAYS = "Only check on weekdays"
MAP = "Add a map of the regions"


def _router_asks(prompt):
    block = prompt.split("by number:\n", 1)[1].split("\n\n", 1)[0]
    return [line.split(". ", 1)[1] for line in block.splitlines() if ". " in line]


def _llm(inst, routes, fail=None, fails=0):
    seen = []

    def llm(kind, prompt, schema):
        seen.append((kind, prompt))
        if kind == "route":
            if fail and (not fails or sum(k == "route" for k, _p in seen) <= fails):
                raise RuntimeError(fail)
            asks = _router_asks(prompt)
            return {"routes": [{"ask": next(n for n, ask in enumerate(asks, 1) if words.lower() in ask.lower()), "asset": asset,
                                "words": words} for asset, words in routes.items()]}
        if kind == "split":
            text = prompt.split('"""\n', 1)[1].split('\n"""', 1)[0]
            return {"asks": [{"ask": line, "check": None} for line in text.splitlines() if line.strip()]}
        shown = next((line[2:] for line in prompt.split("<<<\n", 1)[1].split("\n>>>", 1)[0].splitlines() if line.startswith("- ")), "")
        count = prompt.count("\n") + 1
        return {"checks": [{"n": n, "status": "done", "evidence": shown[:30]} for n in range(1, count)]}

    inst._implement_vibes_llm = llm
    return seen


def _vibe(previous, text=f"{RISKY}. {WEEKDAYS}.", keep="keep"):
    return dict(previous, vibes=text, vibe_previous=keep)


def _builder(built, name, fields, artifact=None):
    def build(context, runner):
        built.append((name, context["assets"].get(name), dict(context["spec"]["outputs"])))
        if artifact is not None:
            context.setdefault("artifacts", {})[name] = artifact
        return dict(fields)

    return build


def _final(inst):
    return inst.updates[-1]


def test_a_choice_for_the_version_before_must_be_keep_or_remove_and_needs_a_vibe(agent_ns):
    spec, errors = _spec(agent_ns, vibes=RISKY, vibe_previous="Keep")
    assert errors == [] and spec["vibes"] == RISKY and spec["vibe_previous"] == "keep"
    spec, errors = _spec(agent_ns, vibes=RISKY)
    assert errors == [] and "vibe_previous" not in spec, "a first build has no version before it, so the spec may leave the choice out"
    assert _spec(agent_ns, vibes=RISKY, vibe_previous="archive")[1][0].startswith("vibe_previous 'archive' must be keep or remove")
    assert _spec(agent_ns, vibe_previous="keep")[1] == ["vibe_previous needs vibes: it says what happens to the version before a vibe"]
    assert _spec(agent_ns, vibes="v" * 2001, vibe_previous="keep")[1] == ["the MVP vibes are 2,001 characters; at most 2,000 are allowed"]
    spec, errors = _spec(agent_ns, vibes="   ", vibe_previous="")
    assert errors == [] and "vibes" not in spec and "vibe_previous" not in spec
    assert _spec(agent_ns, vibes=RISKY, vibe_previous="keep", rollback_outputs={"dashboard": 1})[1] == [
        "a vibe and a roll back cannot run in the same version"]


def test_uninstall_and_remove_kept_are_checked_and_uninstall_stands_alone(agent_ns):
    spec, errors = _spec(agent_ns, uninstall=True)
    assert errors == [] and spec["uninstall"] is True
    assert "uninstall" not in _spec(agent_ns, uninstall=False)[0]
    assert _spec(agent_ns, uninstall="yes")[1] == ["uninstall must be true or false, not 'yes'"]
    spec, errors = _spec(agent_ns, remove_kept=[1, "2", 1])
    assert errors == [] and spec["remove_kept"] == [1, 2]
    assert _spec(agent_ns, remove_kept=[0])[1] == ["remove_kept 0 must be a version number, 1 or more"]
    assert _spec(agent_ns, uninstall=True, vibes=RISKY, vibe_previous="keep")[1] == [
        "Uninstall All removes everything this use case built, so it cannot also rebuild, vibe, roll back or remove a kept version in "
        "the same version"]


HOST = "https://adb-42.example.net/serving-endpoints/router/invocations"
TOKEN = "dapi" + "ab" * 16


def test_routes_carry_each_ask_by_its_number_and_send_an_ask_for_a_part_not_built_to_the_notebook(agent_ns):
    routes = agent_ns["implement_vibe_routes"]
    targets = {"dashboard": "Dashboard", "app:page:risk": "App page risk", "notebook": "the analysis notebook"}
    asks = [f"{RISKY}.", f"{MAP}."]
    got, fallback = routes({"routes": [{"ask": 1, "asset": "dashboard", "words": RISKY},
                                       {"ask": 2, "asset": "app:page:map", "words": "a map somewhere"}]}, targets, asks)
    assert got == {"dashboard": RISKY, "notebook": f"{MAP}."}, "words the person did not write give way to the whole ask"
    assert fallback == [{"ask": f"{MAP}.", "reason": "it names app:page:map, which Inspire did not build for this use case",
                         "asset": "notebook"}]
    both, _fallback = routes({"routes": [{"ask": 1, "asset": "dashboard", "words": RISKY}, {"ask": 1.0, "asset": "notebook", "words": "riskiest"},
                                         {"ask": "2", "asset": "notebook", "words": ""}]}, targets, asks)
    assert both == {"dashboard": RISKY, "notebook": f"riskiest\n{MAP}."}, "one ask may go to two parts, once to each"
    with pytest.raises(ValueError, match="no JSON object"):
        routes(["dashboard"], targets, asks)
    assert agent_ns["implement_vibe_asks"](f"- {RISKY}. {MAP}.\n2) {RISKY}.\n\ne.g. the region") == [f"{RISKY}.", f"{MAP}.", "e.g. the region"]


@pytest.mark.parametrize("answer,problem", [
    ({"routes": [{"ask": 1, "asset": "dashboard", "words": ""}]}, f"the router sent ask 2 ('{MAP}.') to no part"),
    ({"routes": []}, f"the router sent ask 1 ('{RISKY}.') to no part; sent ask 2 ('{MAP}.') to no part"),
    ({"routes": [{"ask": 1, "asset": "dashboard", "words": ""}, {"ask": 1, "asset": "dashboard", "words": RISKY},
                 {"ask": 2, "asset": "notebook", "words": ""}]}, f"the router sent ask 1 ('{RISKY}.') to dashboard twice"),
    ({"routes": [{"ask": 3, "asset": "dashboard", "words": ""}, {"ask": 1, "asset": "dashboard", "words": ""},
                 {"ask": 2, "asset": "notebook", "words": ""}]}, "the router sent ask 3, which the vibe does not have, to dashboard"),
    ({"routes": [{"ask": True, "asset": "dashboard", "words": ""}, {"ask": 2, "asset": "notebook", "words": ""}]},
     f"the router sent ask True, which the vibe does not have, to dashboard; sent ask 1 ('{RISKY}.') to no part"),
], ids=["left_out", "nothing", "doubled", "unknown_number", "not_a_number"])
def test_a_router_answer_that_leaves_an_ask_out_or_sends_one_twice_is_caught_with_a_plain_reason(agent_ns, answer, problem):
    with pytest.raises(ValueError) as caught:
        agent_ns["implement_vibe_routes"](answer, {"dashboard": "Dashboard", "notebook": "the analysis notebook"}, [f"{RISKY}.", f"{MAP}."])
    assert str(caught.value) == problem
    assert agent_ns["raised_by_inspire"](caught.value), "Inspire composed it from the user's own asks, so it is shown as is"


def test_a_router_answer_shows_the_model_s_own_words_only_through_the_one_redaction(agent_ns):
    targets, asks = {"dashboard": "Dashboard", "notebook": "the analysis notebook"}, [f"{RISKY}.", f"{MAP}."]
    with pytest.raises(ValueError) as caught:
        agent_ns["implement_vibe_routes"]({"routes": [{"ask": TOKEN, "asset": HOST, "words": ""},
                                                    {"ask": 1, "asset": "dashboard", "words": ""},
                                                    {"ask": 1, "asset": "dashboard", "words": ""}]}, targets, asks)
    assert str(caught.value) == ("the router sent ask <redacted>, which the vibe does not have, to https://<host>/serving-endpoints/"
                                 "router/invocations; sent ask 1 ('" + RISKY + ".') to dashboard twice; sent ask 2 ('" + MAP + ".') to no part")
    _routes, fallback = agent_ns["implement_vibe_routes"]({"routes": [{"ask": 1, "asset": HOST, "words": ""},
                                                                  {"ask": 2, "asset": "notebook", "words": ""}]}, targets, asks)
    assert fallback == [{"ask": f"{RISKY}.", "reason": "it names https://<host>/serving-endpoints/router/invocations, which Inspire "
                         "did not build for this use case", "asset": "notebook"}]


def _not_decided(inst):
    return [u["asset_status"] for u in inst.updates if "checklist" in (u.get("asset_status") or {})][-1]


def test_a_router_that_keeps_failing_builds_nothing_and_lists_every_ask_as_not_decided(agent_ns, monkeypatch):
    monkeypatch.setitem(agent_ns, "IMPLEMENT_ROUTER_BACKOFF_S", 0)
    inst, previous = _locked(agent_ns)
    inst._implement_runner = lambda uc: pytest.fail("a vibe Inspire could not route asks Genie nothing")
    seen = _llm(inst, {}, fail=f"timed out calling {HOST} with {TOKEN}")
    with pytest.raises(agent_ns["ImplementBlocked"]) as blocked:
        _run(inst, _vibe(previous))
    reason = ("the vibe router failed 3 times, the last with: timed out calling https://<host>/serving-endpoints/router/invocations "
              "with <redacted>")
    assert str(blocked.value) == agent_ns["implement_not_decided_text"](reason, 3)
    assert [kind for kind, _prompt in seen] == ["route"] * 3, "three attempts, then the version stops"
    status = _not_decided(inst)
    assert [(e["requirement"], e["status"], e["kind"], e["rounds"], e["evidence"]) for e in status["checklist"]] == [
        (f"{RISKY}.", "not_decided", "not_decided", 0, str(blocked.value)), (f"{WEEKDAYS}.", "not_decided", "not_decided", 0, str(blocked.value))]
    assert status["checklist_summary"] == {"met": 0, "total": 2, "not_decided": 2}
    assert agent_ns["implement_unmet_asks"](status) == [], "an ask the router never placed is not a held ask"
    steps = [(e["status"], e["message"]) for e in inst.emitted if e["step_name"] == "Vibe"]
    assert steps[-1] == ("ended_error", f"the vibe router is out, so Inspire built nothing of v3: {reason}")
    logged = [message for _level, message in inst.logger.matching("[IMPLEMENT-VIBE] N01-U01: the vibe router failed on attempt ")]
    assert len(logged) == 3 and all("<redacted>" in line and "<host>" in line for line in logged)
    assert TOKEN not in json.dumps([inst.updates, inst.emitted, [m for _l, m in inst.logger.records]], default=str)
    assert "adb-42.example.net" not in json.dumps([inst.updates, inst.emitted], default=str)


def test_a_router_that_leaves_an_ask_out_every_time_builds_nothing_and_says_which(agent_ns, monkeypatch):
    monkeypatch.setitem(agent_ns, "IMPLEMENT_ROUTER_BACKOFF_S", 0)
    inst, previous = _locked(agent_ns)
    inst._implement_runner = lambda uc: pytest.fail("a vibe Inspire could not route asks Genie nothing")
    seen = _llm(inst, {"dashboard": RISKY})
    with pytest.raises(agent_ns["ImplementBlocked"]) as blocked:
        _run(inst, _vibe(previous))
    reason = f"the vibe router failed 3 times, the last with: the router sent ask 2 ('{WEEKDAYS}.') to no part"
    assert str(blocked.value) == agent_ns["implement_not_decided_text"](reason, 3)
    assert [kind for kind, _prompt in seen] == ["route"] * 3
    assert {e["status"] for e in _not_decided(inst)["checklist"]} == {"not_decided"}


def test_a_router_that_fails_once_then_answers_routes_the_asks_as_usual(agent_ns, monkeypatch):
    monkeypatch.setitem(agent_ns, "IMPLEMENT_ROUTER_BACKOFF_S", 0)
    inst, previous = _locked(agent_ns)
    inst._implement_runner = lambda uc: "genie"
    built = []
    inst._implement_genie_space = _builder(built, "genie_space", {"genie_space_id": "g1", "genie_space_url": "https://h/genie/rooms/g1"},
                                           {"title": "t", "serialized_space": {"instructions": RISKY}})
    seen = _llm(inst, {"genie_space": RISKY}, fail="the endpoint is busy", fails=1)
    assert _run(inst, _vibe(previous, RISKY, keep="remove")) == "ready", _final(inst)
    assert [kind for kind, _prompt in seen].count("route") == 2
    assert _final(inst)["asset_status"]["vibe"]["routes"] == {"genie_space": RISKY}
    assert [name for name, _asset, _outputs in built] == ["genie_space"]
    assert inst.logger.matching("[IMPLEMENT-VIBE] N01-U01: the vibe router failed on attempt 1 of 3: the endpoint is busy")
    assert not any(((u.get("asset_status") or {}).get("checklist_summary") or {}).get("not_decided") for u in inst.updates)


def test_routed_words_add_to_the_vibes_the_part_holds_once_and_never_past_the_limit(agent_ns):
    apply = agent_ns["implement_apply_vibe_routes"]
    spec = {"outputs": {"dashboard_vibes": "Use dark colors", "app:page:risk_vibes": RISKY}, "retry_outputs": ["app"]}
    routed, changed, errors = apply(spec, {"dashboard": RISKY, "app:page:risk": RISKY.lower()})
    assert errors == []
    assert routed["outputs"]["dashboard_vibes"] == f"Use dark colors\n{RISKY}"
    assert routed["outputs"]["app:page:risk_vibes"] == RISKY, "words the part already holds are not added twice"
    assert routed["retry_outputs"] == ["app", "dashboard", "app:page:risk"]
    assert changed == {"dashboard_vibes": f"Use dark colors\n{RISKY}", "app:page:risk_vibes": RISKY}
    assert spec["outputs"]["dashboard_vibes"] == "Use dark colors", "the spec it was given is left as it was"
    _routed, _changed, errors = apply({"outputs": {"dashboard_vibes": "v" * 1990}}, {"dashboard": "Add a weekly trend"})
    assert errors == ["the Dashboard would hold 2,009 characters of asks with this vibe, and at most 2,000 are allowed: remove some of "
                      "its earlier asks from its list on the Build page first"]


def test_a_kept_version_gets_a_new_name_that_fits_and_never_stacks_suffixes(agent_ns):
    name, names = agent_ns["implement_side_name"], agent_ns["implement_side_names"]
    assert name("churn-desk", 3, 30, "-") == "churn-desk-v3"
    assert name("churn-desk-v2", 3, 30, "-") == "churn-desk-v3"
    assert name("a" * 30, 12, 30, "-") == "a" * 26 + "-v12" and len(name("a" * 30, 12, 30, "-")) == 30
    assert name("Churn  desk v2", 4, 200, " ") == "Churn desk v4"
    assert names({"app_name": "churn-desk"}, "app", 3, "x") == {"app_name": "churn-desk-v3"}
    assert names({"dashboard_name": ""}, "dashboard", 3, "N01-U01 Predict churn") == {"dashboard_name": "N01-U01 Predict churn v3"}
    assert names({"genie_space_name": "Churn desk"}, "genie_space", 5, "x") == {"genie_space_name": "Churn desk v5"}


def test_only_keep_builds_new_parts_and_alerts_and_shared_parts_change_in_place(agent_ns):
    side = agent_ns["implement_side_outputs"]
    outputs = {"dashboard": True, "app": True, "alert": True, "genie_space": True}
    routes = {"dashboard:kpi": RISKY, "dashboard": RISKY, "alert": WEEKDAYS, "app:page:risk": MAP, "genie_space": RISKY}
    assets = {"dashboard": "d1", "app": "churn-desk", "alert": "al-1", "genie_space": "gA"}
    assert side({"vibe_previous": "remove", "outputs": outputs}, routes, {}, assets) == ([], [])
    status = {"genie_space": {"state": "ready", "merged_into": "gA"}}
    assert side({"vibe_previous": "keep", "outputs": outputs}, routes, status, assets) == (["dashboard", "app"], ["alert", "genie_space"])
    assert side({"vibe_previous": "keep", "outputs": outputs}, routes, status, dict(assets, app=None, alert="")) == (
        ["dashboard"], ["genie_space"]), "an output with nothing built has no version before to keep or change in place"


def test_keep_builds_new_parts_for_what_the_vibe_changes_and_lists_the_old_ones_as_kept(agent_ns):
    inst, previous = _locked(agent_ns)
    inst._implement_runner = lambda uc: "genie"
    built = []
    inst._implement_dashboard = _builder(built, "dashboard", {"dashboard_id": "d9", "dashboard_url": "https://h/d9"},
                                         {"title": "Riskiest customers first", "charts": []})
    inst._implement_alert = _builder(built, "alert", {"alert_id": "al-1", "alert_url": "https://h/al"},
                                     {"condition_text": "", "condition_sql": "SELECT 1", "name": "Churn alert",
                                      "trigger": "fires on weekdays only", "schedule": "every weekday at 06:00",
                                      "destinations": ["owner@example.com"]})
    seen = _llm(inst, {"dashboard": RISKY, "alert": WEEKDAYS})
    assert _run(inst, _vibe(previous)) == "ready", _final(inst)
    route = [prompt for kind, prompt in seen if kind == "route"][0]
    assert "USER DIRECTIVES ARE THE SUPREME AUTHORITY" in route and f"by number:\n1. {RISKY}.\n2. {WEEKDAYS}.\n" in route
    assert "- dashboard: Dashboard (" not in route and "- dashboard: Dashboard\n" in route and "- app: App\n" in route
    assert [(name, asset) for name, asset, _outputs in built] == [("dashboard", None), ("alert", "al-1")]
    dash_outputs = built[0][2]
    assert dash_outputs["dashboard_vibes"] == RISKY and dash_outputs["dashboard_name"] == "N01-U01 Predict churn v3"
    assert built[1][2]["alert_vibes"] == WEEKDAYS and built[1][2]["alert_name"] == previous["outputs"].get("alert_name", "")
    final = _final(inst)
    assert final["asset_status"]["kept"] == {"state": "kept", "assets": [
        {"output": "dashboard", "id": "d1", "url": "https://h/d", "title": "", "version": 2, "kept_in": 3}]}
    assert final["asset_status"]["vibe"] == {"state": "routed", "text": f"{RISKY}. {WEEKDAYS}.", "previous": "keep",
                                             "asks": [f"{RISKY}.", f"{WEEKDAYS}."], "routes": {"dashboard": RISKY, "alert": WEEKDAYS},
                                             "fallback": [], "spec_version": 3}
    assert final["spec_json"]["outputs"]["dashboard_vibes"] == RISKY
    assert final["spec_json"]["outputs"]["dashboard_name"] == "N01-U01 Predict churn v3"
    assert final["spec_json"]["outputs"]["alert_vibes"] == WEEKDAYS and final["spec_json"]["vibes"] == f"{RISKY}. {WEEKDAYS}."
    assert final["asset_status"]["alert"]["notes"] == [
        "changed in place, because a second alert would email the same people twice; its Versions can roll it back to v2"]
    assert "changed in place" not in final["status_message"] and "warnings" not in final["asset_status"]["alert"]
    assert final["asset_status"]["dashboard"]["state"] in ("ready", "ready_with_warnings")
    assert final["asset_status"]["dashboard"].get("spec_version") == 3


def test_remove_changes_the_parts_in_place_and_keeps_nothing(agent_ns):
    inst, previous = _locked(agent_ns)
    inst._implement_runner = lambda uc: "genie"
    built = []
    inst._implement_genie_space = _builder(built, "genie_space", {"genie_space_id": "g1", "genie_space_url": "https://h/genie/rooms/g1"},
                                           {"title": "t", "serialized_space": {"instructions": RISKY}})
    _llm(inst, {"genie_space": RISKY})
    assert _run(inst, _vibe(previous, RISKY, keep="remove")) == "ready", _final(inst)
    assert [(name, asset) for name, asset, _outputs in built] == [("genie_space", "g1")]
    assert built[0][2]["genie_space_name"] == ""
    final = _final(inst)
    assert "kept" not in final["asset_status"] and final["asset_status"]["vibe"]["previous"] == "remove"
    assert final["spec_json"]["outputs"]["genie_space_vibes"] == RISKY and "genie_space_name" not in final["spec_json"]["outputs"]


def test_a_vibe_the_router_gives_a_part_this_mvp_cannot_build_goes_to_the_notebook_so_genie_tries_it_before_anything_can_hold(agent_ns):
    inst, previous = _locked(agent_ns)
    _llm(inst, {"maps": MAP})
    spec = agent_ns["validate_implement_spec"](_vibe(previous, MAP))[0]
    routed, vibe, changed = inst._implement_route_vibe((5150, "N01-U01", 3), spec, json.loads(json.dumps(LIVE)), False)
    fallback = {"ask": MAP, "reason": "it names maps, which Inspire did not build for this use case", "asset": "notebook"}
    assert vibe["routes"] == {"notebook": MAP} and vibe["fallback"] == [fallback] and "not_routed" not in vibe
    assert routed["data"]["notes"] == MAP and changed == {}
    assert agent_ns["implement_version_asks"](routed) is True
    before = agent_ns["validate_implement_spec"](previous)[0]
    assert agent_ns["implement_plan"](before, routed, {}, has_built_notebook=True)["refill"] is True, "Genie rebuilds the notebook for it"
    line = agent_ns["implement_vibe_fallback_line"](fallback)
    assert line == (f"'{MAP}' went to the notebook, because it names maps, which Inspire did not build for this use case, so Genie tries "
                    "it there with up to 3 rounds")
    step = [event for event in inst.emitted if event["step_name"] == "Vibe"][-1]
    assert step["status"] == "ended_warning" and step["message"].endswith(line)


def test_a_kept_part_whose_new_build_fails_stays_live_and_is_not_listed_as_kept(agent_ns, monkeypatch):
    inst, previous = _locked(agent_ns)
    inst._implement_runner = lambda uc: "genie"
    monkeypatch.setattr(agent_ns["time"], "sleep", lambda seconds: None)

    def dashboard(context, runner):
        assert context["assets"]["dashboard"] is None
        raise RuntimeError("the warehouse is stopped")

    inst._implement_dashboard = dashboard
    _llm(inst, {"dashboard": RISKY})
    assert _run(inst, _vibe(previous, RISKY)) == "ready_with_warnings", "the ask of a part that did not build is not met; the other parts still publish"
    final = _final(inst)
    assert ("Dashboard: v2 stays live, because the new one of v3 did not build; ") in final["status_message"]
    assert "v3 is published with 1 unmet ask (not met or could not be checked)" in final["status_message"]
    assert "kept" not in final["asset_status"]
    assert not any(u.get("dashboard_id", "d1") != "d1" for u in inst.updates), "the row keeps pointing at the live dashboard"


def _api(inst, apps=None):
    calls = []

    def api(method, path, body=None, query=None):
        calls.append((method, path, body))
        if method == "GET" and path.startswith("/api/2.0/apps/"):
            return {"description": "Inspire use case N01-U01 (session 5150): Predict churn"} if apps is None else apps
        return {}

    inst._implement_api = api
    inst._implement_api_items = lambda path, key, query=None: []
    return calls


def test_uninstall_all_deletes_every_output_the_kept_ones_the_job_and_the_notebook_and_keeps_the_results(agent_ns):
    inst, previous = _locked(agent_ns)
    kept = {"state": "kept", "assets": [{"output": "dashboard", "id": "d0", "url": "https://h/d0", "title": "v1", "version": 1}]}
    inst._implement_carried = lambda target: (dict(BUILT), _left_by(2, dict(json.loads(json.dumps(LIVE)), kept=kept)))
    inst._implement_mvp_dirs = lambda uc, key: {"use_case": "/W/impl/N01", "mvp": "/W/impl/N01/mvp", "version": f"/W/impl/N01/mvp/v{key[2]}"}
    calls = _api(inst)
    listed = {"/W/impl/N01/mvp": [{"object_type": "DIRECTORY", "path": "/W/impl/N01/mvp/v1"},
                                  {"object_type": "DIRECTORY", "path": "/W/impl/N01/mvp/v2"}]}
    inst._implement_folder_objects = lambda folder: listed.get(folder, [])
    inst._implement_delete_digest = lambda uc, digest: []
    assert _run(inst, dict(previous, uninstall=True)) == "uninstalled"
    deleted = [(m, p) for m, p, _b in calls if m == "DELETE"]
    assert deleted == [("DELETE", "/api/2.0/genie/spaces/g1"), ("DELETE", "/api/2.0/lakeview/dashboards/d1"),
                       ("DELETE", "/api/2.0/apps/churn-desk"), ("DELETE", "/api/2.0/alerts/al-1"),
                       ("DELETE", "/api/2.0/lakeview/dashboards/d0")]
    posted = [(p, b) for m, p, b in calls if m == "POST"]
    assert ("/api/2.2/jobs/delete", {"job_id": 77}) in posted
    assert ("/api/2.0/workspace/delete", {"path": "/W/nb", "recursive": True}) in posted
    for path in ("/W/impl/N01/mvp/v1/apps/churn-desk", "/W/impl/N01/mvp/v2/apps/churn-desk", "/W/impl/N01/mvp/alerts/churn-desk",
                 "/W/apps/churn-desk", "/W/alerts/churn-desk", "/W/impl/N01"):
        assert ("/api/2.0/workspace/delete", {"path": path, "recursive": True}) in posted, \
            f"{path}: every version's App source, the alerts, an MVP built before the MVP folders and the use case folder go"
    final = _final(inst)
    assert final["status"] == "uninstalled" and final["status_message"] == "", "the row holds only what was left, so the page never repeats itself"
    assert final["notebook_path"] is None and final["job_id"] is None and final["dashboard_id"] is None and final["app_name"] is None
    assert final["asset_status"]["notebook"]["state"] == "deleted" and final["asset_status"]["kept"] == {"state": "kept", "assets": []}
    assert all(final["asset_status"][name]["state"] == "deleted" for name in ("genie_space", "dashboard", "app", "alert"))
    assert not any(s.upper().startswith(("DROP", "DELETE FROM", "TRUNCATE")) for s in inst.spark.statements), "results are kept"


def test_uninstall_takes_this_use_case_out_of_a_part_another_use_case_shares_and_never_deletes_it(agent_ns):
    inst, previous = _locked(agent_ns)
    inst._implement_notebook_paths = lambda uc, key: ("/W/impl/N01", "/W/impl/N01/nb")
    calls = _api(inst)
    inst._implement_delete_digest = lambda uc, digest: []
    holder = {"session_id": 9, "use_case_id": "N02-U01", "joining": False, "name": "", "status": {}}
    inst._implement_output_holders = lambda name, asset, key: [holder] if name == "dashboard" else []
    assert _run(inst, dict(previous, uninstall=True)) == "uninstalled"
    final = _final(inst)
    assert final["status_message"] == "", "taking its part out is what was asked, not a warning"
    assert final["asset_status"]["dashboard"]["state"] == "released" and final["asset_status"]["dashboard"]["taken_out_of"] == "d1"
    assert ("DELETE", "/api/2.0/lakeview/dashboards/d1") not in [(m, p) for m, p, _b in calls]


def test_remove_kept_deletes_only_the_kept_parts_of_those_versions_and_never_the_live_ones(agent_ns):
    inst, previous = _locked(agent_ns)
    kept = {"state": "kept", "assets": [{"output": "dashboard", "id": "d0", "url": "", "title": "", "version": 1},
                                        {"output": "app", "id": "churn-desk-v2", "url": "", "title": "", "version": 2}]}
    inst._implement_carried = lambda target: (dict(BUILT), _left_by(2, dict(json.loads(json.dumps(LIVE)), kept=kept)))
    inst._implement_notebook_paths = lambda uc, key: ("/W/impl/N01", "/W/impl/N01/nb")
    calls = _api(inst)
    assert _run(inst, dict(previous, remove_kept=[1])) == "ready", _final(inst)
    assert [(m, p) for m, p, _b in calls if m == "DELETE"] == [("DELETE", "/api/2.0/lakeview/dashboards/d0")]
    assert _final(inst)["asset_status"]["kept"]["assets"] == [kept["assets"][1]]
    assert not any("dashboard_id" in u and u["dashboard_id"] is None for u in inst.updates), "the live dashboard's id is never cleared"


def test_a_kept_part_inspire_could_not_remove_stays_listed_so_the_next_remove_can_try_again(agent_ns):
    inst, previous = _locked(agent_ns)
    kept = {"state": "kept", "assets": [{"output": "dashboard", "id": "d0", "url": "", "title": "", "version": 1},
                                        {"output": "app", "id": "churn-desk-v1", "url": "", "title": "", "version": 1}]}
    inst._implement_carried = lambda target: (dict(BUILT), _left_by(2, dict(json.loads(json.dumps(LIVE)), kept=kept)))
    inst._implement_notebook_paths = lambda uc, key: ("/W/impl/N01", "/W/impl/N01/nb")
    holder = {"session_id": 9, "use_case_id": "N02-U01", "joining": False, "name": "", "status": {}}
    inst._implement_output_holders = lambda name, asset, key: [holder] if asset == "d0" else []
    calls = _api(inst, apps={"description": "Finance team tool"})
    _run(inst, dict(previous, remove_kept=[1]))
    final = _final(inst)
    assert final["asset_status"]["kept"]["assets"] == [kept["assets"][1]], \
        "the App Inspire refused to delete is still tracked; the dashboard this use case was taken out of is not"
    assert "App: churn-desk-v1 is no longer this use case's App, so Inspire did not delete it" in final["status_message"]
    assert ("DELETE", "/api/2.0/lakeview/dashboards/d0") not in [(m, p) for m, p, _b in calls], "a shared kept dashboard is never deleted"
    assert ("DELETE", "/api/2.0/apps/churn-desk-v1") not in [(m, p) for m, p, _b in calls]


def test_removing_an_app_also_removes_its_lakebase_copies_source_and_alerts_folder(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst.updates = []
    inst._implement_update = lambda key, **f: inst.updates.append(f)
    calls = _api(inst)
    retired = []
    inst._implement_lakebase_listed = lambda schema, before, named: {f"{schema}.records"}
    inst._implement_lakebase_retire = lambda gone: retired.append(set(gone))
    assert inst._implement_delete_output("app", "churn-desk", (5150, "N01-U01", 3), dirs=["/W/impl/N01"])["warnings"] == []
    assert retired == [{"churn_desk.records"}]
    folders = [b["path"] for m, p, b in calls if p == "/api/2.0/workspace/delete"]
    assert folders == ["/W/impl/N01/apps/churn-desk", agent_ns["implement_app_alert_folder"]("/W/impl/N01", "churn-desk")]
    foreign = _inspire(agent_ns, FakeSpark())
    foreign._implement_update = lambda key, **f: None
    foreign_calls = _api(foreign, apps={"description": "Finance team tool"})
    foreign._implement_lakebase_retire = lambda gone: pytest.fail("an App Inspire did not delete keeps its Lakebase copies")
    assert "no longer this use case's App" in foreign._implement_delete_output("app", "churn-desk", (5150, "N01-U01", 3),
                                                                                dirs=["/W/impl/N01"])["note"]
    assert [p for m, p, b in foreign_calls if p == "/api/2.0/workspace/delete"] == []


def test_an_uninstalled_notebook_and_job_are_never_carried_into_the_next_mvp(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    rows = [{"spec_version": 4, "status": "uninstalled", "notebook_path": None, "job_id": None, "dashboard_id": None,
             "asset_status": {"notebook": {"state": "deleted"}, "dashboard": {"state": "deleted"}}},
            {"spec_version": 3, "status": "ready", "notebook_path": "/W/nb", "job_id": 77, "last_preview_run_id": 5, "dashboard_id": "d1",
             "result_rows": 40, "asset_status": {"notebook": {"state": "ready", "spec_version": 3}}}]
    inst._implement_select = lambda where, args, order="": rows
    carried, _status = inst._implement_carried({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 5})
    assert carried == {"result_rows": 40}
    rows[0]["asset_status"] = {}
    carried, _status = inst._implement_carried({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 5})
    assert carried["notebook_path"] == "/W/nb" and carried["job_id"] == 77, "without an uninstall the notebook carries as before"


def test_the_first_mvp_after_an_uninstall_builds_from_scratch_like_the_first_version(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    seen = []
    ready = {"spec_version": 3, "status": "ready", "spec_json": {"outputs": {"dashboard": True}}}
    gone = {"spec_version": 4, "status": "uninstalled", "spec_json": {"outputs": {"dashboard": True}}}

    def select(where, args, order=""):
        seen.append((where, dict(args)))
        return list(rows)

    inst._implement_select = select
    target = {"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 5}
    rows = [gone, ready]
    assert inst._implement_previous(target) == {}
    assert ":gone" in seen[-1][0] and seen[-1][1]["gone"] == "uninstalled"
    rows = [ready]
    assert inst._implement_previous(target) == ready, "without an uninstall the last built version is the one to compare with"
    spec = _spec(agent_ns)[0]
    plan = agent_ns["implement_plan"](None, spec, {})
    assert plan["classes"] == ["initial"] and plan["refill"] and plan["schedule"] and plan["sharing"]
    assert plan["build"] == [n for n in agent_ns["IMPLEMENT_OUTPUTS"] if spec["outputs"].get(n)]


def test_an_uninstalled_version_is_settled_when_its_run_is_requested_again_but_never_counts_as_built(agent_ns):
    assert "uninstalled" in agent_ns["IMPLEMENT_STATUSES"] and "uninstalled" not in agent_ns["IMPLEMENT_DONE_STATUSES"]
    inst = _inspire(agent_ns, FakeSpark())
    inst.inspire_database = "c.s"
    inst.atomic_writer = SimpleNamespace(_ensure_implement_table=lambda: None)
    inst._implement_targets = lambda: []
    inst._implement_requested_row = lambda: {"use_case_id": "N01-U01", "spec_version": 3, "status": "uninstalled"}
    inst._run_implement_mode()
    assert inst._implement_outcomes == {"N01-U01": "uninstalled"}
    inst._implement_requested_row = lambda: {"use_case_id": "N01-U01", "spec_version": 3, "status": "failed", "status_message": "x"}
    with pytest.raises(RuntimeError):
        inst._run_implement_mode()


def test_the_vibe_a_version_routed_is_never_carried_into_the_next_version(agent_ns):
    inst, previous = _locked(agent_ns)
    routed = {"state": "routed", "text": RISKY, "previous": "keep", "routes": {"dashboard": RISKY}, "fallback": [], "spec_version": 2}
    inst._implement_carried = lambda target: (dict(BUILT), _left_by(2, dict(json.loads(json.dumps(LIVE)), vibe=routed)))
    assert _run(inst, previous) == "ready", _final(inst)
    assert all("vibe" not in (u.get("asset_status") or {}) for u in inst.updates)
