"""A build that leaves the Lakebase backend takes the Lakebase sync task off the use case's job, whether it moves the page inside
Inspire, switches the App to Delta tables or renames the App to one on Delta. It removes only the task its own App added, the one
that runs the sync pipeline Inspire recorded for it, and never a task someone else added or pointed at another pipeline, offline."""
import json

import pytest

from v120_artifacts_support import CapturingLogger, FakeSpark
from v140_implement_test import _churn_page, _inspire
from v142_dash_test import _runner as _pages
from v142_merge_test import _serve_files
from v164_inside_inspire_deploy_test import _app_calls, _builder

RUN_TASK = {"task_key": "inspire_task", "notebook_task": {"notebook_path": "/W/nb"}}
OURS = {"task_key": "inspire_lakebase_sync", "pipeline_task": {"pipeline_id": "pipe-1"}, "depends_on": [{"task_key": "inspire_task"}]}
FOREIGN = dict(OURS, pipeline_task={"pipeline_id": "pipe-9"})
ON_LAKEBASE = {"state": "ready", "spec_version": 2, "backend": "lakebase", "sync_pipeline": "pipe-1"}
KEPT = ("App: job 77 keeps its task inspire_lakebase_sync, because Inspire cannot tell that it is the Lakebase sync Inspire added for "
        "this use case's App; remove it from the job if nothing needs it")
REMOVED = {"job_id": 77, "fields_to_remove": ["tasks/inspire_lakebase_sync"]}
OLD_SOURCE = "/W/acme_implemented/Sales/N01-U01/apps/old-desk"


def _job_api(calls, tasks, apps=None, fail=None):
    def api(method, path, body=None, query=None):
        calls.append((method, path, body))
        if (method, path) == ("GET", "/api/2.2/jobs/get"):
            return {"settings": {"tasks": [json.loads(json.dumps(t)) for t in tasks]}}
        if (method, path) == ("POST", "/api/2.2/jobs/update") and fail:
            raise fail
        if method == "GET" and path.startswith("/api/2.0/apps/"):
            name = path.rsplit("/", 1)[1]
            if name not in (apps or {}):
                raise RuntimeError(f"RESOURCE_DOES_NOT_EXIST: App {name} does not exist")
            return apps[name]
        return {}

    return api


def _after(ns, monkeypatch, record=None, before="", app_name="new-desk", tasks=(OURS,), held=None, apps=None, files=None, on=False):
    inst = _inspire(ns, FakeSpark())
    inst.logger = CapturingLogger()
    calls = []
    _serve_files(ns, monkeypatch, files or {})
    inst._implement_api = _job_api(calls, [RUN_TASK, *tasks], apps)
    fields = {"app_name": app_name, "_asset": {"backend": "lakebase" if on else "delta"}}
    context = {"uc_id": "N01-U01", "job_id": 77, "asset_status": {"app": dict(record)} if record else {},
               "assets": {"app": before} if before else {}}
    lakebase = {"held": held or {}, "backend": {"kind": "lakebase", "pipeline_id": "pipe-2", "tables": {}} if on else None}
    inst._implement_lakebase_after(context, fields, lakebase)
    return inst, fields, calls


def _job_writes(calls):
    return [c[2] for c in calls if c[:2] == ("POST", "/api/2.2/jobs/update")]


def test_a_rename_to_an_app_on_delta_removes_the_sync_task_the_old_app_added(agent_ns, monkeypatch):
    _inst, fields, calls = _after(agent_ns, monkeypatch, record=ON_LAKEBASE, before="old-desk")
    assert _job_writes(calls) == [REMOVED]
    assert "_warnings" not in fields and "sync_pipeline" not in fields["_asset"], "the new App owns no sync task"


def test_a_rename_leaves_a_sync_task_someone_pointed_at_another_pipeline_and_says_so(agent_ns, monkeypatch):
    _inst, fields, calls = _after(agent_ns, monkeypatch, record=ON_LAKEBASE, before="old-desk", tasks=(FOREIGN,))
    assert _job_writes(calls) == [], "a task that runs another pipeline is not the one this build added"
    assert fields["_warnings"] == [KEPT]
    _inst, fields, calls = _after(agent_ns, monkeypatch, record=ON_LAKEBASE, before="old-desk",
                                  tasks=({"task_key": "inspire_lakebase_sync", "notebook_task": {"notebook_path": "/W/theirs"}},))
    assert _job_writes(calls) == [] and fields["_warnings"] == [KEPT], "a task of another kind under the same key is never removed"


def test_an_app_built_before_inspire_recorded_its_sync_reads_the_old_app_to_know_its_pipeline(agent_ns, monkeypatch):
    record = {k: v for k, v in ON_LAKEBASE.items() if k != "sync_pipeline"}
    apps = {"old-desk": {"name": "old-desk", "active_deployment": {"source_code_path": OLD_SOURCE}}}
    files = {f"{OLD_SOURCE}/inspire_app.json": json.dumps({"backend": {"kind": "lakebase", "pipeline_id": "pipe-1"}})}
    _inst, fields, calls = _after(agent_ns, monkeypatch, record=record, before="old-desk", apps=apps, files=files)
    assert _job_writes(calls) == [REMOVED] and "_warnings" not in fields
    inst, fields, calls = _after(agent_ns, monkeypatch, record=record, before="old-desk", apps={}, files={})
    assert _job_writes(calls) == [] and fields["_warnings"] == [KEPT], "an old App Inspire cannot read proves nothing, so the task stays"
    assert any("the App old-desk could not be read" in m for kind, m in inst.logger.records if kind == "WARNING")


def test_a_build_that_leaves_its_old_app_owns_that_app_s_sync_even_when_the_new_app_reads_another_pipeline(agent_ns, monkeypatch):
    record = {k: v for k, v in ON_LAKEBASE.items() if k != "sync_pipeline"}
    apps = {"old-desk": {"name": "old-desk", "active_deployment": {"source_code_path": OLD_SOURCE}}}
    files = {f"{OLD_SOURCE}/inspire_app.json": json.dumps({"backend": {"kind": "lakebase", "pipeline_id": "pipe-1"}})}
    held = {"kind": "lakebase", "pipeline_id": "pipe-7", "tables": {}}
    _inst, fields, calls = _after(agent_ns, monkeypatch, record=record, before="old-desk", app_name="sales-desk", held=held, apps=apps,
                                  files=files)
    assert _job_writes(calls) == [REMOVED] and "_warnings" not in fields, "the task the old App added goes"


def test_a_same_app_switch_to_delta_removes_its_own_sync_and_keeps_one_someone_else_pointed_elsewhere(agent_ns, monkeypatch):
    held = {"kind": "lakebase", "pipeline_id": "pipe-1", "tables": {}}
    record = {k: v for k, v in ON_LAKEBASE.items() if k != "sync_pipeline"}
    _inst, fields, calls = _after(agent_ns, monkeypatch, record=record, before="new-desk", held=held)
    assert _job_writes(calls) == [REMOVED] and "_warnings" not in fields
    _inst, fields, calls = _after(agent_ns, monkeypatch, record=record, before="new-desk", held=held, tasks=(FOREIGN,))
    assert _job_writes(calls) == [] and fields["_warnings"] == [KEPT]
    assert not any(c[1].startswith("/api/2.0/apps/") for c in calls), "the App's own settings already name its pipeline"


def test_an_app_that_never_read_lakebase_makes_no_job_call(agent_ns, monkeypatch):
    for record in ({"state": "ready", "spec_version": 2, "backend": "delta"}, None):
        _inst, fields, calls = _after(agent_ns, monkeypatch, record=record, before="old-desk")
        assert not any("/jobs/" in c[1] for c in calls) and "_warnings" not in fields, record


def test_a_lakebase_app_records_the_sync_it_adds_and_a_failed_build_keeps_that_record(agent_ns, monkeypatch):
    _inst, fields, calls = _after(agent_ns, monkeypatch, record=ON_LAKEBASE, before="new-desk", on=True)
    task = _job_writes(calls)[0]["new_settings"]["tasks"][0]
    assert task["pipeline_task"] == {"pipeline_id": "pipe-2"} and fields["_asset"]["sync_pipeline"] == "pipe-2"
    assert agent_ns["implement_kept_asset"](dict(ON_LAKEBASE, state="failed")) == {"sync_pipeline": "pipe-1"}, \
        "a build that fails keeps the record of the sync task that is still on the job"


def _hosted_move(ns, tmp_path, monkeypatch, tasks, fail=None, record=ON_LAKEBASE):
    inst, context, seen = _builder(ns, tmp_path, monkeypatch, asset_status={"app": dict(record)}, assets={"app": "churn-desk"})
    context["job_id"] = 77
    inst._implement_api = _job_api(seen["calls"], [RUN_TASK, *tasks], fail=fail)
    return inst, context, seen


def test_a_move_from_a_lakebase_app_into_inspire_removes_the_sync_task_that_app_added(agent_ns, tmp_path, monkeypatch):
    inst, context, seen = _hosted_move(agent_ns, tmp_path, monkeypatch, [OURS])
    fields = inst._implement_app(context, _pages(_churn_page(agent_ns)))
    assert _job_writes(seen["calls"]) == [REMOVED] and fields["_asset"]["placement"] == "inspire"
    assert "sync_pipeline" not in fields["_asset"] and not any("inspire_lakebase_sync" in w for w in fields.get("_warnings") or [])
    assert _app_calls(seen["calls"]) == [], "the old App itself is left as it is"


def test_a_move_into_inspire_keeps_a_sync_task_someone_else_added(agent_ns, tmp_path, monkeypatch):
    inst, context, seen = _hosted_move(agent_ns, tmp_path, monkeypatch, [FOREIGN])
    fields = inst._implement_app(context, _pages(_churn_page(agent_ns)))
    assert _job_writes(seen["calls"]) == [] and KEPT in fields["_warnings"]


def test_a_held_move_into_inspire_leaves_the_job_as_it_is(agent_ns, tmp_path, monkeypatch):
    inst, context, seen = _hosted_move(agent_ns, tmp_path, monkeypatch, [OURS])
    context["hold_mode"] = True
    with pytest.raises(agent_ns["ImplementCandidate"]):
        inst._implement_app(context, _pages(_churn_page(agent_ns)))
    assert not any("/jobs/" in c[1] for c in seen["calls"]), "a held version never goes live, so the live App keeps its sync"


def test_a_sync_task_that_cannot_be_removed_is_a_warning_and_stays_on_record_for_the_next_build(agent_ns, tmp_path, monkeypatch):
    inst, context, seen = _hosted_move(agent_ns, tmp_path, monkeypatch, [OURS], fail=RuntimeError("PERMISSION_DENIED: job 77"))
    fields = inst._implement_app(context, _pages(_churn_page(agent_ns)))
    assert ("App: job 77 still syncs Lakebase after each run, because Inspire could not remove that task: PERMISSION_DENIED: job 77. "
            f"Remove the task {agent_ns['IMPLEMENT_LAKEBASE_TASK_KEY']} from the job" in fields["_warnings"])
    assert fields["_asset"]["sync_pipeline"] == "pipe-1"
    again, context, seen = _hosted_move(agent_ns, tmp_path / "again", monkeypatch, [OURS],
                                        record={"placement": "inspire", "hosted": fields["_asset"]["hosted"], "sync_pipeline": "pipe-1",
                                                "state": "ready", "spec_version": 2})
    context["key"] = (5150, "N01-U01", 3)
    retried = again._implement_app(context, _pages(_churn_page(agent_ns)))
    assert _job_writes(seen["calls"]) == [REMOVED] and "sync_pipeline" not in retried["_asset"], "the next build removes it"


def _deleting_app(ns, tasks, status):
    inst = _inspire(ns, FakeSpark())
    inst.calls, inst.updates = [], []
    inst._implement_update = lambda key, **f: inst.updates.append(f)
    inst._implement_emit = lambda *a, **k: None
    owned = {"description": "Inspire use case N01-U01 (session 5150): Predict churn"}
    inst._implement_api = _job_api(inst.calls, [RUN_TASK, *tasks], apps={"churn-desk": owned})
    inst._implement_app_leftovers = lambda name, dirs: []
    return inst._implement_delete_output("app", "churn-desk", (5150, "N01-U01", 3), job_id=77, status=dict(status)), inst.calls


def test_deleting_an_app_removes_only_the_sync_task_it_added(agent_ns):
    outcome, calls = _deleting_app(agent_ns, [OURS], ON_LAKEBASE)
    assert _job_writes(calls) == [REMOVED] and outcome["warnings"] == [] and ("DELETE", "/api/2.0/apps/churn-desk", None) in calls
    outcome, calls = _deleting_app(agent_ns, [FOREIGN], ON_LAKEBASE)
    assert _job_writes(calls) == [] and outcome["warnings"] == [KEPT] and outcome["refused"] is False
    outcome, calls = _deleting_app(agent_ns, [OURS], {"state": "ready", "spec_version": 2, "backend": "delta"})
    assert not any("/jobs/" in c[1] for c in calls) and outcome["warnings"] == [], "a Delta App had no sync task to look for"
