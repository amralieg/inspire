import json

import pytest

from v120_artifacts_support import CapturingLogger, FakeSpark
from v140_implement_test import OURS_APP, VALID, _app_flow, _app_shell, _left_by
from v142_merge_test import HOST_APP, OWN_SOURCE, _host_files, _host_page, _restyle_inspire, _router, _serve_files

OWN_APP = {"name": "churn-desk", "description": OURS_APP, "url": "https://churn-desk.example/",
           "active_deployment": {"source_code_path": OWN_SOURCE}, "compute_status": {"state": "ACTIVE"},
           "service_principal_client_id": "sp-1"}
GENIE = {"space_id": "g1", "title": "N01-U01 Predict churn"}
NOT_READY = "Ask Genie is off because this use case's Genie Agent is not ready: it was not built"
CHECK_FAILED = "page n01_u01: kpi:revenue failed: TABLE_OR_VIEW_NOT_FOUND"


def _own_files(ns, tmp_path, genie, page_genie=None):
    page = _host_page(ns, "N01-U01", "Churn desk")
    if page_genie is not None:
        page.update(genie=page_genie or None, genie_note="" if page_genie else NOT_READY)
    files = _host_files(ns, tmp_path, source=OWN_SOURCE, pages=[page], title="N01-U01 Predict churn", genie=None)
    settings = json.loads(files[f"{OWN_SOURCE}/inspire_app.json"])
    settings.update(genie=genie, genie_note="" if genie else NOT_READY)
    files[f"{OWN_SOURCE}/inspire_app.json"] = json.dumps(settings)
    return files


def _flow(ns, tmp_path, monkeypatch, files, app=OWN_APP, outputs=None, assets=None):
    inst, context, seen = _app_flow(ns, tmp_path / "flow", outputs=outputs, assets={"genie_space": "g1"} if assets is None else assets)
    del inst._implement_app_host
    _serve_files(ns, monkeypatch, files)
    inst._implement_api, _calls = _router({("GET", f"/api/2.0/apps/{app['name']}"): app})
    inst._implement_notebook_paths = lambda uc, key: ("/W/acme_implemented/Sales", "/W/acme_implemented/Sales/N01-U01")
    inst._implement_runner = inst._genie_runner_factory = lambda uc: pytest.fail("pointing the App at its Genie Agent needs no Genie Code")
    inst._implement_genie_loop = lambda *a, **k: pytest.fail("pointing the App at its Genie Agent never asks Genie")
    context["repoint"] = ["app"]
    return inst, context, seen


def _deployed(seen):
    name, files, reads, space_id = seen["deployed"][0]
    settings = json.loads(files["inspire_app.json"])
    return name, settings, [json.loads(files[f"pages/{p}.json"]) for p in settings["pages"]], reads, space_id


def _messages(inst, status):
    return [e.get("message") for e in inst.emitted if e.get("status") == status]


def test_a_genie_agent_change_without_an_app_rebuild_points_the_built_app_at_it(agent_ns):
    validate, plan_fn = agent_ns["validate_implement_spec"], agent_ns["implement_plan"]
    before = validate(VALID)[0]
    assets = {"dashboard": "d1", "genie_space": "g1", "app": "churn-desk", "preview_run_id": 7}

    def plan(spec, held=None, previous=None):
        current, errors = validate(json.loads(json.dumps(spec)))
        assert errors == [], errors
        return plan_fn(previous or before, current, assets if held is None else held, has_built_notebook=True)

    retried = plan(dict(VALID, retry_outputs=["genie_space"]))
    assert (retried["refresh"], retried["build"], retried["repoint"]) == (["genie_space"], [], ["app"])
    renamed = plan(dict(VALID, outputs=dict(VALID["outputs"], genie_space_name="Churn questions")))
    assert (renamed["refresh"], renamed["repoint"]) == (["genie_space"], ["app"]), "a renamed Genie Agent is renamed on the App page"
    unforced = dict(before, outputs=dict(before["outputs"], genie_space=False))
    added = plan(VALID, held=dict(assets, genie_space=None), previous=unforced)
    assert (added["build"], added["repoint"]) == (["genie_space"], ["app"]), \
        "a Genie Agent added to an App built before the App needed one is asked by its page"
    vibed = plan(dict(VALID, outputs=dict(VALID["outputs"], genie_space_vibes="Answer in plain words"), retry_outputs=["genie_space"]))
    assert (vibed["refresh"], vibed["repoint"]) == (["genie_space"], ["app"]), \
        "a vibed Genie Agent keeps its id, but its page may still ask another use case's Genie Agent or none, so the App page is checked"
    assert plan(dict(VALID, retry_outputs=["dashboard"]))["repoint"] == []
    assert validate(dict(VALID, outputs=dict(VALID["outputs"], genie_space=False)))[0]["outputs"]["genie_space"] is True, \
        "an App always has a Genie Agent, so no version takes it away from a built App"
    for spec, held, why in ((dict(VALID, retry_outputs=["genie_space", "app"]), None, "the App is rebuilt with it anyway"),
                            (dict(VALID, retry_outputs=["genie_space"]), dict(assets, app=None), "the App is built with it"),
                            (dict(VALID, outputs=dict(VALID["outputs"], app=False), retry_outputs=["genie_space"]), None, "no App is chosen"),
                            (dict(VALID, retry_outputs=["dashboard"]), None, "the Genie Agent does not change"),
                            (dict(VALID, config=dict(VALID["config"], widgets={"top_k": 50})), None, "a refill rebuilds the App")):
        assert plan(spec, held)["repoint"] == [], why


def test_a_page_that_joined_a_hub_before_it_had_its_own_genie_agent_is_pointed_at_it_without_genie(agent_ns, tmp_path, monkeypatch):
    host, joined = _host_page(agent_ns), _host_page(agent_ns, "N01-U01", "Churn desk")
    assert "genie" not in joined
    inst, context, seen = _flow(agent_ns, tmp_path, monkeypatch, _host_files(agent_ns, tmp_path, pages=[host, joined]), app=HOST_APP,
                                outputs={"merge": {"app": "sales-desk"}})
    fields = inst._implement_app(context, None)
    core = _app_shell(agent_ns, tmp_path)[1]["shell_core"]
    name, settings, pages, reads, space_id = _deployed(seen)
    assert (name, space_id, settings["pages"]) == ("sales-desk", "g1", ["n01_u07", "n01_u01"])
    assert core.page_genie(settings, pages, pages[1]) == (GENIE, "")
    assert core.page_genie(settings, pages, pages[0]) == ({"space_id": "gA", "title": "Sales questions"}, ""), \
        "the hub's own page keeps asking its own Genie Agent"
    assert pages[0] == host and {k: v for k, v in pages[1].items() if k not in ("genie", "genie_note")} == joined
    assert core.settings_problems(settings, pages) == []
    assert set(context["allowed"]) <= set(reads), "the App may read what this use case's Genie Agent reads"
    assert fields["_asset"] == {"merged_into": "sales-desk", "page": "n01_u01"} and len(seen["checked"]) == 1
    assert "the App sales-desk now asks this use case's Genie Agent" in _messages(inst, "ended_success")


@pytest.mark.parametrize("held", [None, {"space_id": "g1", "title": "Churn questions"}, {"space_id": "g0", "title": GENIE["title"]}],
                         ids=["genie_was_not_ready", "genie_renamed", "genie_replaced"])
def test_an_app_whose_page_asks_a_different_genie_agent_is_redeployed_asking_this_use_cases_own(agent_ns, tmp_path, monkeypatch, held):
    inst, context, seen = _flow(agent_ns, tmp_path, monkeypatch, _own_files(agent_ns, tmp_path, held, page_genie=held or {}))
    fields = inst._implement_app(context, None)
    name, settings, pages, _reads, space_id = _deployed(seen)
    assert (name, space_id, settings["genie"], settings["genie_note"]) == ("churn-desk", "g1", GENIE, "")
    assert (pages[0]["genie"], pages[0]["genie_note"]) == (GENIE, "")
    assert (settings["style"], settings["layout"], settings["palette"], settings["theme"]) == ("b", "tabs", "ocean", "dark"), \
        "only the Genie Agent changes; the App keeps its look"
    assert fields["_asset"] == {"page": "n01_u01"} and "_warnings" not in fields, "a re-point is a deploy, so it records the page"


@pytest.mark.parametrize("held,outputs,assets,said", [
    (GENIE, None, None, "already asks this use case's Genie Agent"),
    (None, None, {}, "already has Ask Genie off for this use case"),
], ids=["same_genie_agent", "genie_agent_never_built"])
def test_an_app_already_asking_the_right_genie_agent_is_left_alone_without_taking_its_lock(agent_ns, tmp_path, monkeypatch, held,
                                                                                            outputs, assets, said):
    inst, context, seen = _flow(agent_ns, tmp_path, monkeypatch, _own_files(agent_ns, tmp_path, held), outputs=outputs, assets=assets)
    inst._implement_asset_lock = lambda *a, **k: pytest.fail("an App with nothing to change waits for no other build")
    assert inst._implement_app(context, None) is None
    assert seen["deployed"] == [] and seen["checked"] == []
    assert _messages(inst, "ended_success") == [f"the App churn-desk {said}, so it is unchanged"]


def test_an_app_page_still_asking_a_genie_agent_this_use_case_no_longer_has_turns_ask_genie_off_with_the_reason(agent_ns, tmp_path,
                                                                                                                 monkeypatch):
    inst, context, seen = _flow(agent_ns, tmp_path, monkeypatch, _own_files(agent_ns, tmp_path, GENIE, page_genie=GENIE), assets={})
    fields = inst._implement_app(context, None)
    name, settings, pages, reads, space_id = _deployed(seen)
    assert (name, space_id, settings["genie"], settings["genie_note"]) == ("churn-desk", "", None, NOT_READY)
    assert (pages[0]["genie"], pages[0]["genie_note"]) == (None, NOT_READY)
    assert reads == agent_ns["implement_app_page_reads"](pages), "an App without a Genie Agent reads only what its pages show"
    assert fields["_warnings"] == [f"App: {NOT_READY}"]
    assert _messages(inst, "ended_success") == ["the App churn-desk no longer asks a Genie Agent for this use case"]


def test_an_app_whose_pages_fail_todays_checks_is_rebuilt_by_genie_to_ask_its_genie_agent_with_no_warning(agent_ns, tmp_path, monkeypatch):
    inst, context, seen = _flow(agent_ns, tmp_path, monkeypatch, _own_files(agent_ns, tmp_path, None, page_genie={}))
    inst._implement_app_check = lambda work, files, modules, warehouse: seen["checked"].append(files) or [CHECK_FAILED]
    inst._implement_runner = lambda uc: "runner"
    rebuilt = []
    inst._implement_page_spec = lambda context, runner, name, deploy: rebuilt.append((runner, name)) or {"app_name": "churn-desk"}
    fields = inst._implement_app(context, None)
    note = (f"App: its pages no longer passed Inspire's checks ({CHECK_FAILED}), so Genie rebuilt them to ask this use case's Genie "
            "Agent")
    assert seen["deployed"] == [] and len(seen["checked"]) == 1
    assert rebuilt == [("runner", "app")] and fields == {"app_name": "churn-desk"}, "Genie rebuilds the page instead of handing it back"
    assert context["app_host"]["info"] == [note] and context["app_host"]["notes"] == []
    assert _messages(inst, "ended_success")[-1] == note and not _messages(inst, "ended_warning") and not _messages(inst, "ended_error")
    assert "app_rebuild" not in context


def test_an_app_that_no_longer_holds_this_use_cases_page_is_refused_with_the_reason(agent_ns, tmp_path, monkeypatch):
    inst, context, seen = _flow(agent_ns, tmp_path, monkeypatch, _host_files(agent_ns, tmp_path), app=HOST_APP,
                                outputs={"merge": {"app": "sales-desk"}})
    with pytest.raises(agent_ns["ImplementBlocked"], match="the App sales-desk holds no page for this use case, so Inspire could not "
                                                            "point it at the Genie Agent; build the App again with Vibe/Add/Remove Features on the Build page"):
        inst._implement_app(context, None)
    assert seen["deployed"] == []


def _version_inspire(ns, tmp_path, monkeypatch, files, runner):
    inst = _restyle_inspire(ns, tmp_path, monkeypatch, files, app=OWN_APP)
    inst.logger = CapturingLogger()
    previous = json.loads(json.dumps(VALID))
    inst._implement_previous = lambda t: {"spec_version": 2, "spec_json": previous}
    inst._implement_runner = runner
    inst._implement_genie_space = lambda context, runner: {"genie_space_id": "g1", "genie_space_url": "https://h/genie/rooms/g1"}
    return inst, {"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": dict(previous, retry_outputs=["genie_space"])}


def test_rebuilding_only_the_genie_agent_points_the_app_at_it_in_the_same_version(agent_ns, tmp_path, monkeypatch):
    made = []
    inst, target = _version_inspire(agent_ns, tmp_path, monkeypatch, _own_files(agent_ns, tmp_path, None, page_genie={}),
                                    lambda uc: made.append(uc) or "runner")
    status = inst._implement_one_locked(target, (5150, "N01-U01", 3))
    assert status == "ready", inst.updates[-1]
    assert made == ["N01-U01"], "Genie Code is installed once, for the Genie Agent only"
    name, deployed, _reads, space_id = inst.deployed[0]
    settings = json.loads(deployed["inspire_app.json"])
    assert (name, space_id, settings["genie"], json.loads(deployed["pages/n01_u01.json"])["genie"]) == ("churn-desk", "g1", GENIE, GENIE)
    final = inst.updates[-1]["asset_status"]
    assert final["app"]["state"] == "ready" and final["app"]["spec_version"] == 3
    assert final["genie_space"]["state"] == "ready" and final["genie_space"]["spec_version"] == 3
    assert any("point the App at this use case's Genie Agent" in str(e.get("message")) for e in inst.emitted)


def test_a_genie_agent_rebuilt_in_place_leaves_an_app_that_already_asks_it_untouched_in_the_same_version(agent_ns, tmp_path, monkeypatch):
    inst, target = _version_inspire(agent_ns, tmp_path, monkeypatch, _own_files(agent_ns, tmp_path, GENIE, page_genie=GENIE),
                                    lambda uc: "runner")
    carried = inst._implement_carried(None)[0]
    inst._implement_carried = lambda t: (dict(carried), _left_by(2, {"app": {"state": "ready", "spec_version": 2}}))
    status = inst._implement_one_locked(target, (5150, "N01-U01", 3))
    assert status == "ready", inst.updates[-1]
    assert inst.deployed == [] and inst.checked == []
    final = inst.updates[-1]["asset_status"]
    assert final["app"] == {"state": "ready", "spec_version": 2} and final["genie_space"]["spec_version"] == 3
    assert "the App churn-desk already asks this use case's Genie Agent, so it is unchanged" in [e.get("message") for e in inst.emitted]


def _vibed_version(agent_ns, tmp_path, monkeypatch, page_genie, space_id):
    inst, target = _version_inspire(agent_ns, tmp_path, monkeypatch, _own_files(agent_ns, tmp_path, page_genie, page_genie=page_genie),
                                    lambda uc: "runner")
    inst._implement_genie_space = lambda context, runner: {"genie_space_id": space_id,
                                                           "genie_space_url": f"https://h/genie/rooms/{space_id}"}
    inst._implement_vibes_asks = lambda *args: []
    inst._implement_check_output_vibes = lambda *args, **kwargs: []
    spec = target["spec_json"]
    target = dict(target, spec_json=dict(spec, outputs=dict(spec["outputs"], genie_space_vibes="Answer in plain words")))
    carried = inst._implement_carried(None)[0]
    inst._implement_carried = lambda t: (dict(carried), _left_by(2, {"app": {"state": "ready", "spec_version": 2},
                                                                    "genie_space": {"state": "ready", "spec_version": 2}}))
    return inst, target


def test_a_genie_vibe_checks_the_app_page_and_leaves_a_page_that_already_asks_it_untouched(agent_ns, tmp_path, monkeypatch):
    inst, target = _vibed_version(agent_ns, tmp_path, monkeypatch, GENIE, "g1")
    status = inst._implement_one_locked(target, (5150, "N01-U01", 3))
    assert status == "ready", inst.updates[-1]
    assert inst.deployed == [] and inst.checked == []
    final = inst.updates[-1]["asset_status"]
    assert final["app"] == {"state": "ready", "spec_version": 2} and final["genie_space"]["spec_version"] == 3
    assert "the App churn-desk already asks this use case's Genie Agent, so it is unchanged" in [e.get("message") for e in inst.emitted]


@pytest.mark.parametrize("held", [{"space_id": "gH", "title": "N01-U07 Sales questions"}, {}], ids=["another_use_case", "ask_genie_off"])
def test_a_genie_vibe_points_a_page_asking_another_genie_agent_or_none_at_its_own(agent_ns, tmp_path, monkeypatch, held):
    inst, target = _vibed_version(agent_ns, tmp_path, monkeypatch, held, "g1")
    status = inst._implement_one_locked(target, (5150, "N01-U01", 3))
    assert status == "ready", inst.updates[-1]
    name, deployed, _reads, space_id = inst.deployed[0]
    assert (name, space_id, json.loads(deployed["pages/n01_u01.json"])["genie"]) == ("churn-desk", "g1", GENIE)
    assert inst.updates[-1]["asset_status"]["app"]["spec_version"] == 3
    assert "the App churn-desk now asks this use case's Genie Agent" in [e.get("message") for e in inst.emitted]


def test_a_genie_agent_a_vibe_build_had_to_recreate_is_asked_by_the_app_page(agent_ns, tmp_path, monkeypatch):
    inst, target = _vibed_version(agent_ns, tmp_path, monkeypatch, GENIE, "g2")
    status = inst._implement_one_locked(target, (5150, "N01-U01", 3))
    assert status == "ready", inst.updates[-1]
    name, deployed, _reads, space_id = inst.deployed[0]
    assert (name, space_id, json.loads(deployed["pages/n01_u01.json"])["genie"]["space_id"]) == ("churn-desk", "g2", "g2")
    assert inst.updates[-1]["asset_status"]["app"]["spec_version"] == 3


def test_a_genie_agent_that_fails_to_rebuild_leaves_the_app_asking_the_one_it_had(agent_ns, tmp_path, monkeypatch):
    def broken(uc):
        raise RuntimeError("the download stopped at 2 of 6 bytes")

    inst, target = _version_inspire(agent_ns, tmp_path, monkeypatch, _own_files(agent_ns, tmp_path, None, page_genie={}), broken)
    carried = inst._implement_carried(None)[0]
    live = {"app": {"state": "ready", "spec_version": 2}, "genie_space": {"state": "ready", "spec_version": 2}}
    inst._implement_carried = lambda t: (dict(carried), _left_by(2, json.loads(json.dumps(live))))
    inst._implement_app = lambda context, runner: pytest.fail("the App is left alone when the Genie Agent did not build")
    status = inst._implement_one_locked(target, (5150, "N01-U01", 3))
    assert status == "ready_with_warnings" and inst.deployed == []
    final = inst.updates[-1]["asset_status"]
    assert final["genie_space"]["state"] == "failed" and final["genie_space"]["spec_version"] == 3
    assert final["app"] == {"state": "ready", "spec_version": 2}, "the App keeps the state of the version that built it"
    assert ("INFO", "[IMPLEMENT-APP] N01-U01: the Genie Agent did not build, so the App keeps asking the one it had") in inst.logger.records
