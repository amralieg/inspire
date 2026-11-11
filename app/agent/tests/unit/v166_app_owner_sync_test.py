import json

import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import VALID, _churn_page, _inspire, _left_by
from v142_merge_test import _restyle_inspire, _serve_files
from v144_app_ops_test import JobsWorkspace, ops_shell, signed
from v157_genie_repoint_test import GENIE, OWN_APP, _own_files
from v163_hold_gate_test import _repoint_run
from v164_inside_inspire_deploy_test import FOLDER, ID, LIVE_RECORD, _app_calls, _builder, _hosted_spec, _written
import shell_core

FIRST, SECOND, KEEP, RUNNER = "first@example.com", "second@example.com", "keep@example.com", "runner@example.com"
OWN, OTHER = "n01_u01", "n02_u01"
REFUSED = "Only the owners of this use case can change its settings"


def _previous(owners=(KEEP,), by=FIRST):
    spec = json.loads(json.dumps(VALID))
    spec["outputs"]["app_owners"] = list(owners)
    return {"spec_version": 2, "created_by": by, "spec_json": spec}


def _files(ns, tmp_path, held_owners):
    files = _own_files(ns, tmp_path, GENIE, page_genie=GENIE)
    path = next(p for p in files if p.endswith("/inspire_app.json"))
    settings = json.loads(files[path])
    settings["use_case_owners"] = {OWN: list(held_owners)}
    files[path] = json.dumps(settings)
    return files


def _version(ns, tmp_path, monkeypatch, held_owners, previous, by, status=None):
    tmp_path.mkdir(parents=True, exist_ok=True)
    inst = _restyle_inspire(ns, tmp_path, monkeypatch, _files(ns, tmp_path, held_owners), app=OWN_APP)
    carried = inst._implement_carried(None)[0]
    left = _left_by(2, {"app": dict({"state": "ready", "spec_version": 2}, **(status or {}))})
    inst._implement_carried = lambda t: (dict(carried), json.loads(json.dumps(left)))
    inst._implement_previous = lambda t: previous
    inst._implement_folder_access = lambda use_case, key, requester: []
    inst.scheduled = []
    inst._implement_schedule = lambda uc_id, job_id, schedule: inst.scheduled.append(schedule["cron"])
    spec = json.loads(json.dumps(previous["spec_json"]))
    spec["schedule"] = dict(spec["schedule"], cron="0 0 7 ? * MON")
    return inst, {"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": spec, "created_by": by}


def _app_reads(inst):
    return [c for c in inst.calls if c[:2] == ("GET", "/api/2.0/apps/churn-desk")]


def _deployed(inst):
    assert len(inst.deployed) == 1, inst.deployed
    files = inst.deployed[0][1]
    settings = json.loads(files["inspire_app.json"])
    return settings, [json.loads(files[f"pages/{p}.json"]) for p in settings["pages"]]


@pytest.mark.parametrize("owners", [(KEEP,), ()], ids=["with_an_app_owner", "without_app_owners"])
def test_a_version_that_touches_no_app_part_moves_the_app_s_owners_with_inspire_s_both_ways(agent_ns, tmp_path, monkeypatch, owners):
    inst, target = _version(agent_ns, tmp_path, monkeypatch, [FIRST, *owners], _previous(owners), SECOND)
    assert inst._implement_one_locked(target, (5150, "N01-U01", 3)) == "ready", inst.updates[-1]
    assert inst.scheduled == ["0 0 7 ? * MON"], "the version changes the schedule only"
    settings, pages = _deployed(inst)
    live = dict(target, spec_version=3)
    assert settings["use_case_owners"] == {OWN: agent_ns["implement_owners"](live)} == {OWN: [SECOND, *owners]}
    assert shell_core.settings_problems(settings, pages) == []
    (tmp_path / "app").mkdir()
    shell = ops_shell(tmp_path / "app", JobsWorkspace(), settings=settings, pages=pages)[0]
    page = shell.page(OWN)
    for person, allowed in ((SECOND, True), (FIRST, False), *((o, True) for o in owners)):
        assert (shell.owner_refusal(signed(person), page, shell_core.SETTING_WORDS) == "") is allowed, person
        assert (agent_ns["implement_settings_refusal"](live, person, 4) == "") is allowed, person
    assert shell.owner_refusal(signed(FIRST), page, shell_core.SETTING_WORDS) == REFUSED, "the person who lost the right is refused in the App"
    assert (settings["admin"], settings["genie"]) == (SECOND, GENIE), "the App keeps all but the people it names"
    assert "the App churn-desk now names the owners of v3 as the people who may change this use case's settings" in [
        e.get("message") for e in inst.emitted if e.get("status") == "ended_success"]
    assert inst.updates[-1]["asset_status"]["app"] == {"state": "ready", "spec_version": 2, "health": "passed"}


def test_a_version_that_keeps_the_owner_set_neither_reads_nor_redeploys_the_app(agent_ns, tmp_path, monkeypatch):
    inst, target = _version(agent_ns, tmp_path, monkeypatch, [FIRST, KEEP], _previous(), FIRST.upper())
    assert inst._implement_one_locked(target, (5150, "N01-U01", 3)) == "ready", inst.updates[-1]
    assert _app_reads(inst) == [] and inst.deployed == []


def test_an_app_that_already_names_the_new_owners_is_read_and_left_alone(agent_ns, tmp_path, monkeypatch):
    inst, target = _version(agent_ns, tmp_path, monkeypatch, [SECOND, KEEP], _previous(), SECOND)
    assert inst._implement_one_locked(target, (5150, "N01-U01", 3)) == "ready", inst.updates[-1]
    assert _app_reads(inst) and inst.deployed == [], "the App is read to compare whom it names, and nothing is redeployed"


def test_an_owner_write_that_fails_is_flagged_and_written_again_on_the_next_version(agent_ns, tmp_path, monkeypatch):
    inst, target = _version(agent_ns, tmp_path / "first", monkeypatch, [FIRST, KEEP], _previous(), SECOND)

    def broken(context, name, files, reads, space_id="", lakebase=None, page_tables=()):
        raise RuntimeError("the deployment did not start")

    inst._implement_deploy_app = broken
    assert inst._implement_one_locked(target, (5150, "N01-U01", 3)) == "ready_with_warnings"
    stale = agent_ns["IMPLEMENT_APP_OWNERS_STALE"].format(version=3, why="the deployment did not start")
    assert stale == ("App: Inspire could not write the owners of v3 into the App, so in the App the people it named before can still "
                     "change this use case's settings and the new owners cannot yet: the deployment did not start. Inspire writes them "
                     "again on the next version")
    assert stale in inst.updates[-1]["status_message"]
    assert inst.updates[-1]["asset_status"]["app"]["owners_stale"] is True
    again, target = _version(agent_ns, tmp_path / "again", monkeypatch, [FIRST, KEEP], _previous(by=SECOND), SECOND,
                             status={"owners_stale": True})
    assert again._implement_one_locked(target, (5150, "N01-U01", 3)) == "ready", again.updates[-1]
    assert _deployed(again)[0]["use_case_owners"] == {OWN: [SECOND, KEEP]}
    assert "owners_stale" not in again.updates[-1]["asset_status"]["app"]


def test_a_use_case_whose_app_is_gone_unticked_or_new_has_no_app_owners_to_write(agent_ns, tmp_path, monkeypatch):
    inst, target = _version(agent_ns, tmp_path, monkeypatch, [FIRST, KEEP], _previous(), SECOND)
    inst._implement_api = lambda method, path, body=None, query=None: (_ for _ in ()).throw(
        RuntimeError("RESOURCE_DOES_NOT_EXIST: App churn-desk does not exist"))
    assert inst._implement_one_locked(target, (5150, "N01-U01", 3)) == "ready", inst.updates[-1]
    assert inst.deployed == []
    context = {"spec": {"outputs": {"app": False}}, "requested_by": SECOND, "key": (5150, "N01-U01", 3), "uc_id": "N01-U01"}
    assert inst._implement_app_owner_sync(context, _previous(), {"app": "churn-desk"}, {}) == []
    assert inst._implement_app_owner_sync(dict(context, spec=VALID), {}, {"app": "churn-desk"}, {}) == [], "a first version builds its App"
    assert inst._implement_app_owner_sync(dict(context, spec=VALID), _previous(), {"app": None}, {}) == [], "a use case with no App yet"


def test_an_unmet_ask_publishes_with_a_warning_and_names_the_ask(agent_ns, tmp_path, monkeypatch):
    inst, status = _repoint_run(agent_ns, tmp_path, monkeypatch, "Keep the Sales questions panel",
                                {"kind": "text", "value": "N01-U07 Sales questions"}, created_by=(FIRST, SECOND))
    assert status == "ready_with_warnings", "an unmet ask publishes the version with a warning; nothing is held any more"
    assert "Keep the Sales questions panel" in inst.updates[-1]["status_message"], "the unmet ask is named in the published sentence"


def test_a_published_version_names_its_owners_in_the_one_app_deployment_it_makes(agent_ns, tmp_path, monkeypatch):
    inst, status = _repoint_run(agent_ns, tmp_path, monkeypatch, "Show an Ask Genie panel", {"kind": "text", "value": "Ask Genie"},
                                created_by=(FIRST, SECOND))
    assert status in ("ready", "ready_with_warnings"), inst.updates[-1].get("status_message")
    settings, _pages = _deployed(inst)
    assert settings["use_case_owners"] == {OWN: [SECOND]}, "the re-point already writes the new owners, so no second deployment follows"


def test_the_app_record_of_a_use_case_s_owners_is_inspire_s_owner_set_of_the_row_the_run_makes_live(agent_ns):
    row = {"created_by": " Sam@Example.com ", "spec_json": {"outputs": {"app_owners": ["DANA@example.com", "sam@example.com", " lee@example.com"]}}}
    context = {"requested_by": " ".join(row["created_by"].split()), "spec": row["spec_json"]}
    record = agent_ns["implement_app_use_case_owners"]({}, [OWN, OTHER], OWN, agent_ns["implement_run_owners"](context))
    assert record == {OWN: agent_ns["implement_owners"](row)} == {OWN: ["sam@example.com", "dana@example.com", "lee@example.com"]}
    assert agent_ns["implement_run_owners"]({"requested_by": "", "spec": {"outputs": {"app_owners": "sam@example.com"}}}) == [], \
        "a run that names no one who asked and no list of App owners has no owner"


@pytest.mark.parametrize("held_admin,run_as,asked,admin", [
    ("host@example.com", RUNNER, SECOND, "host@example.com"),
    ("", RUNNER, SECOND, SECOND),
    (RUNNER, RUNNER, SECOND, SECOND),
    (RUNNER, RUNNER, "", RUNNER),
], ids=["keeps_the_host_s_admin", "names_the_asker_when_none", "replaces_the_runner_placeholder", "keeps_the_runner_without_an_asker"])
def test_a_shared_app_keeps_its_admin_by_the_merge_s_rule(agent_ns, held_admin, run_as, asked, admin):
    assert agent_ns["implement_app_kept_admin"]({"admin": held_admin}, run_as, asked) == admin


@pytest.mark.parametrize("merged,admin", [(True, "host@example.com"), (False, SECOND)], ids=["shared_app", "own_app"])
def test_rewriting_an_app_s_kept_settings_keeps_a_shared_app_s_admin(agent_ns, merged, admin):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_builder = lambda: RUNNER
    inst._implement_alert_link = lambda context: ""
    inst._implement_app_own_page = lambda context, host: OWN
    held = {"pages": [OTHER, OWN], "admin": "host@example.com", "jobs": {}, "alerts": {}, "use_case_owners": {OTHER: [KEEP], OWN: [FIRST]}}
    host = {"merged": merged, "settings": held, "pages": [{"id": OTHER}, {"id": OWN}]}
    settings = inst._implement_app_kept_settings({"requested_by": SECOND, "spec": {"outputs": {}}, "job_id": 77}, host, shell_core)
    assert settings["admin"] == admin
    assert settings["use_case_owners"] == {OTHER: [KEEP], OWN: [SECOND]}, "only this use case's owners move"


def test_a_page_inside_inspire_whose_owners_change_is_written_into_its_next_version_folder_with_no_app(agent_ns, tmp_path, monkeypatch):
    inst, context, seen = _builder(agent_ns, tmp_path, monkeypatch, asset_status={"app": json.loads(json.dumps(LIVE_RECORD))},
                                   assets={"genie_space": "g1", "app": ID}, version=3)
    page = agent_ns["implement_app_page"](_churn_page(agent_ns), "N01-U01", {}, "main.inspire.churn_out")
    core = inst._implement_app_shell()[1]["shell_core"]
    settings = agent_ns["implement_app_settings"](core.SETTINGS_VERSION, "N01-U01 Predict churn", [page["id"]], None, "Ask Genie is off",
                                                  "2026-10-30T08:00:00Z", context["spec"]["outputs"])
    live = dict(settings, backend={"kind": "delta"}, host="inspire", use_case_owners={page["id"]: [FIRST]})
    _serve_files(agent_ns, monkeypatch, {f"{FOLDER}/v2/inspire_app.json": json.dumps(live),
                                         f"{FOLDER}/v2/pages/{page['id']}.json": json.dumps(page)})
    context["spec"] = _hosted_spec(agent_ns, dashboard=False)
    context["requested_by"] = SECOND
    steps = []
    inst._implement_emit = lambda *args, **kwargs: steps.append(args) or "step"
    status = context["asset_status"]
    warnings = inst._implement_app_owner_sync(context, {"created_by": FIRST, "spec_json": context["spec"]}, {"app": ID}, status)
    written = json.loads(_written(seen["calls"])[f"{FOLDER}/v3/inspire_app.json"])
    assert written["use_case_owners"] == {page["id"]: [SECOND]} and written["host"] == "inspire"
    assert status["app"]["hosted"]["source"] == f"{FOLDER}/v3", "the record names the folder that holds the new owners"
    assert _app_calls(seen["calls"]) == [] and warnings == [], "no Databricks App is read or deployed for a page inside Inspire"
    assert [s[2] for s in steps] == ["the owners of this use case changed: Inspire writes them into the page inside Inspire, without Genie",
                                     "the page inside Inspire now names the owners of v3 as the people who may change this use case's settings"]
