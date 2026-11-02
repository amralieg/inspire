"""The SQL warehouse a use case's App reads, saves and keeps history with: the build's warehouse unless the person picks another, swapped
on a rebuild of the use case's own App with every other resource kept, and the host's when the use case is added to another use case's
App, offline."""
import json

import pytest

from v120_artifacts_support import CapturingLogger
from v140_implement_test import OURS_APP, READS, SHELL_FILES, VALID, _deploy_inspire, _inspire, _spec, sdk_stub  # noqa: F401
from v142_merge_test import HOST_APP, OWN_SOURCE, SOURCE, _host_files, _host_page, _merge_flow, _restyle_inspire

WH1 = {"name": "sql-warehouse", "sql_warehouse": {"id": "wh1", "permission": "CAN_USE"}}
WH2 = {"name": "sql-warehouse", "sql_warehouse": {"id": "wh2", "permission": "CAN_USE"}}
WHA = {"name": "sql-warehouse", "sql_warehouse": {"id": "whA", "permission": "CAN_USE"}}
OWN_JOB = {"name": "job-n01-u01", "job": {"id": "77", "permission": "CAN_MANAGE_RUN"}}
FAILED_DEPLOY = {"deployment_id": "dep1", "status": {"state": "FAILED", "message": "boom"}}
LIVE = [{"deployment_id": "dep1", "status": {"state": "SUCCEEDED"}}, {"url": "https://churn-desk.example/"}]
WAREHOUSE_ERROR = ("outputs.app_warehouse_id {} must be the id of a SQL warehouse: up to 64 letters, digits, dashes and underscores, or "
                   "empty for the SQL warehouse the build uses")


def _outputs(**changes):
    return dict(VALID["outputs"], **changes)


def _held(**changes):
    return dict({"description": OURS_APP, "compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-2",
                 "active_deployment": {"deployment_id": "dep0"}, "resources": [WH1, OWN_JOB]}, **changes)


def _own_deploy(ns, answers, warehouse="wh2"):
    inst, context, calls, imported = _deploy_inspire(ns, answers)
    inst.logger = CapturingLogger()
    context["spec"] = _spec(ns, outputs=_outputs(app_warehouse_id=warehouse))[0]
    context["app_jobs"] = {"n01_u01": "77"}
    return inst, context, calls


def test_an_app_reads_with_the_build_warehouse_unless_the_spec_names_another(agent_ns):
    validate, resolve = agent_ns["validate_implement_spec"], agent_ns["implement_app_warehouse"]
    spec, errors = validate(VALID)
    assert errors == [] and spec["outputs"]["app_warehouse_id"] == "" and resolve(spec) == "wh1", \
        "a spec written before the App had its own warehouse reads with the build's"
    spec, errors = validate(dict(VALID, outputs=_outputs(app_warehouse_id=" wh2 ")))
    assert errors == [] and spec["outputs"]["app_warehouse_id"] == "wh2" and resolve(spec) == "wh2"
    assert spec["config"]["warehouse_id"] == "wh1", "the dashboards and alerts Inspire builds keep the build's warehouse"
    spec, errors = validate(dict(VALID, outputs={"dashboard": True, "app_warehouse_id": "a/b", "inspire_url": VALID["outputs"]["inspire_url"]}))
    assert errors == [] and spec["outputs"]["app_warehouse_id"] == "", "a use case without an App has no App warehouse to check"
    assert resolve({}) == "" and resolve(None) == "" and resolve({"outputs": {"app_warehouse_id": ""}, "config": {}}) == ""


@pytest.mark.parametrize("given,shown", [("a/b?c", "'a/b?c'"), ("wh 2", "'wh 2'"), ("x" * 65, "'" + "x" * 65 + "'")],
                         ids=["path", "space", "too_long"])
def test_an_app_warehouse_that_is_not_a_warehouse_id_is_refused(agent_ns, given, shown):
    spec, errors = agent_ns["validate_implement_spec"](dict(VALID, outputs=_outputs(app_warehouse_id=given)))
    assert WAREHOUSE_ERROR.format(shown) in errors, errors
    assert spec["outputs"]["app_warehouse_id"] == ""


@pytest.mark.parametrize("given,shown", [(True, "true"), (5, "5"), (["wh2"], '["wh2"]')], ids=["flag", "number", "list"])
def test_an_app_warehouse_that_is_not_text_is_refused(agent_ns, given, shown):
    errors = agent_ns["validate_implement_spec"](dict(VALID, outputs=_outputs(app_warehouse_id=given)))[1]
    assert f"outputs.app_warehouse_id must be text, not {shown}" in errors, errors


def test_changing_the_app_warehouse_restyles_the_app_without_genie_or_a_notebook_run(agent_ns):
    validate, plan_fn = agent_ns["validate_implement_spec"], agent_ns["implement_plan"]
    assets = {"dashboard": "d1", "genie_space": "g1", "app": "churn-desk", "preview_run_id": 5}
    before = validate(VALID)[0]
    after = validate(dict(VALID, outputs=_outputs(app_warehouse_id="wh2")))[0]
    plan = plan_fn(before, after, assets, has_built_notebook=True)
    assert plan["classes"] == ["outputs"] and plan["refresh"] == ["app"] and plan["restyle"] == ["app"] and not plan["refill"]
    assert "app_warehouse_id" in agent_ns["IMPLEMENT_OUTPUT_OPTIONS"]["app"]
    assert agent_ns["classify_implement_change"](after, after) == []
    assert agent_ns["classify_implement_change"](before, validate(VALID)[0]) == [], "no field means the build's warehouse, as before"


def test_a_new_app_is_created_with_the_warehouse_the_person_picked(agent_ns, sdk_stub):
    def created(warehouse):
        return {"compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-1", "resources": [warehouse, OWN_JOB]}

    gone = RuntimeError("RESOURCE_DOES_NOT_EXIST: app churn-desk")
    inst, context, calls = _own_deploy(agent_ns, [gone, created(WH2)] + LIVE)
    inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert calls[1][:2] == ("POST", "/api/2.0/apps") and not any(c[0] == "PATCH" for c in calls)
    assert calls[1][2]["resources"] == [WH2, OWN_JOB], "the App reads with wh2, never the build's wh1"
    inst, context, calls = _own_deploy(agent_ns, [gone, created(WH1)] + LIVE, "")
    inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert calls[1][2]["resources"] == [WH1, OWN_JOB], "an empty choice is the build's warehouse"


def test_rebuilding_its_own_app_with_another_warehouse_swaps_only_the_warehouse(agent_ns, sdk_stub):
    postgres = agent_ns["implement_app_postgres_resource"]()
    held = _held(resources=[OWN_JOB, WH1, postgres])
    inst, context, calls = _own_deploy(agent_ns, [held, dict(held, resources=[OWN_JOB, WH2, postgres])] + LIVE)
    inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    patches = [c for c in calls if c[0] == "PATCH"]
    assert len(patches) == 1 and patches[0][2]["resources"] == [OWN_JOB, WH2, postgres], \
        "the job and Lakebase resources stay as they were, in place"
    assert ("INFO", "[IMPLEMENT-APP] the App churn-desk reads with SQL warehouse wh2 now, not wh1") in inst.logger.records


def test_rebuilding_its_own_app_on_the_warehouse_it_holds_changes_no_resource(agent_ns, sdk_stub):
    inst, context, calls = _own_deploy(agent_ns, [_held()] + LIVE, "wh1")
    inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert not any(c[0] == "PATCH" for c in calls)
    inst, context, calls = _own_deploy(agent_ns, [_held(resources=[OWN_JOB])] + LIVE)
    inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert not any(c[0] == "PATCH" for c in calls), "an App with no warehouse resource Inspire set is left as it is"


def test_a_warehouse_swap_that_fails_stops_the_build_names_both_warehouses_and_deploys_nothing(agent_ns, sdk_stub):
    inst, context, calls = _own_deploy(agent_ns, [_held(), RuntimeError("PERMISSION_DENIED: no CAN MANAGE on wh2")])
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert str(raised.value) == ("the App churn-desk still reads with SQL warehouse wh1, because Inspire could not move it to SQL "
                                 "warehouse wh2: PERMISSION_DENIED: no CAN MANAGE on wh2; ask the warehouse owner to grant Inspire CAN "
                                 "MANAGE on it, or pick another SQL warehouse for the App")
    assert [c[:2] for c in calls] == [("GET", "/api/2.0/apps/churn-desk"), ("PATCH", "/api/2.0/apps/churn-desk")]
    assert not any("deployments" in c[1] for c in calls) and not inst.uploads


def test_a_swapped_warehouse_is_put_back_when_the_deploy_fails(agent_ns, sdk_stub):
    swapped = _held(resources=[WH2, OWN_JOB])
    inst, context, calls = _own_deploy(agent_ns, [_held(), swapped, FAILED_DEPLOY, {}, {}, {}, {}, {}, swapped, _held()])
    with pytest.raises(RuntimeError, match="the App deployment FAILED: boom"):
        inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    patches = [c[2]["resources"] for c in calls if c[0] == "PATCH"]
    assert patches == [[WH2, OWN_JOB], [WH1, OWN_JOB]], "the build moves the App to wh2, then its undo moves it back to wh1"
    undo = [m for lvl, m in inst.logger.records if lvl == "WARNING" and m.startswith("[IMPLEMENT-UNDO")]
    assert len(undo) == 1 and "gave the App churn-desk back the resources it held before" in undo[0]


def test_an_app_joined_by_another_use_case_never_has_its_warehouse_swapped(agent_ns, sdk_stub):
    host = dict(HOST_APP, resources=[WHA])
    inst, context, calls, _imported = _deploy_inspire(agent_ns, [host, {"deployment_id": "dep1", "status": {"state": "SUCCEEDED"}},
                                                                {"url": "https://sales-desk.example/"}])
    context["spec"] = _spec(agent_ns, outputs=_outputs(merge={"app": "sales-desk"}))[0]
    context["app_host"] = dict(agent_ns["implement_app_host"]("sales-desk"), merged=True, source=SOURCE, app=host)
    assert inst._implement_app_warehouse(context) == "whA", "a joined page reads with the host's warehouse, not the build's wh1"
    inst._implement_deploy_app(context, "sales-desk", {"inspire_app.json": "{}\n"}, ["main.inspire.churn_out"], poll_s=0)
    assert not any(c[0] == "PATCH" for c in calls)


def test_a_joining_use_case_checks_its_page_on_the_hosts_warehouse(agent_ns, tmp_path, monkeypatch):
    inst, context, seen, _calls = _merge_flow(agent_ns, tmp_path, monkeypatch, app=dict(HOST_APP, resources=[WHA]))
    inst._implement_app(context, None)
    assert seen["errors"] == [] and [warehouse for _files, warehouse in seen["checked"]] == ["whA"]
    same, context, seen, _calls = _merge_flow(agent_ns, tmp_path, monkeypatch, app=dict(HOST_APP, resources=[WHA]),
                                              outputs={"app_warehouse_id": "whA"})
    same._implement_app(context, None)
    assert seen["errors"] == [] and [warehouse for _files, warehouse in seen["checked"]] == ["whA"]


def test_a_joining_use_case_that_names_another_warehouse_is_refused_and_names_the_host_use_case(agent_ns, tmp_path, monkeypatch):
    inst, context, seen, calls = _merge_flow(agent_ns, tmp_path, monkeypatch, app=dict(HOST_APP, resources=[WHA]),
                                             outputs={"app_warehouse_id": "whX"})
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        inst._implement_app(context, None)
    assert str(raised.value) == ("this use case asks the App to read with SQL warehouse whX, but it is added to the App sales-desk, which "
                                 "reads with SQL warehouse whA, the one use case N01-U07 of another Inspire session chose when it built "
                                 "the App; changing it would change the pages of that use case too. Keep the App's SQL warehouse, or "
                                 "create a new App for this use case")
    assert seen["deployed"] == [] and [c[:2] for c in calls] == [("GET", "/api/2.0/apps/sales-desk")]


def test_a_warehouse_only_edit_checks_and_redeploys_the_app_on_the_new_warehouse_without_genie(agent_ns, tmp_path, monkeypatch):
    own_page = _host_page(agent_ns, "N01-U01", "Churn desk")
    files = _host_files(agent_ns, tmp_path, source=OWN_SOURCE, pages=[own_page], title="N01-U01 Predict churn", genie="g1",
                        style="a", layout="sidebar", palette="default", theme="light")
    inst = _restyle_inspire(agent_ns, tmp_path, monkeypatch, files)
    warehouses = []
    inst._implement_app_check = lambda work, files, modules, warehouse: warehouses.append(warehouse) or []
    previous = json.loads(json.dumps(VALID))
    inst._implement_previous = lambda t: {"spec_version": 2, "spec_json": previous}
    current = dict(previous, outputs={**previous["outputs"], "app_warehouse_id": "wh2"})
    status = inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": current},
                                        (5150, "N01-U01", 3))
    assert status == "ready", inst.updates[-1]
    assert warehouses == ["wh2"] and len(inst.deployed) == 1
    messages = [e.get("message") for e in inst.emitted]
    assert "only the look, data backend or SQL warehouse changed: Inspire rewrites the App settings and redeploys it, without Genie" in messages


def test_sharing_a_per_user_app_grants_its_own_warehouse_and_the_dashboard_keeps_the_builds(agent_ns):
    inst = _inspire(agent_ns, type("S", (), {"sql": lambda self, s, args=None: []})())
    grants = []
    inst._implement_grant = lambda kind, object_id, principals, level: grants.append((kind, object_id, level))
    inst._implement_access_rows = lambda table, warnings=None: []
    inst._implement_emit = lambda *a, **k: None
    inst._implement_api = lambda method, path, body=None, query=None: _held(resources=[WH2])
    spec = _spec(agent_ns, outputs=_outputs(app_access="user", app_warehouse_id="wh2"),
                 sharing={"principals": [{"type": "group", "name": "planners"}]})[0]
    inst._implement_share("N01-U01", "main.inspire.churn_out", spec, {"dashboard": "d1", "genie_space": "g1", "app": "churn-desk"}, None)
    assert [g for g in grants if g[0] == "sql/warehouses"] == [("sql/warehouses", "wh1", "CAN_USE"), ("sql/warehouses", "wh2", "CAN_USE")]
    grants.clear()
    shared = _spec(agent_ns, outputs=_outputs(app_access="user"), sharing={"principals": [{"type": "group", "name": "planners"}]})[0]
    inst._implement_api = lambda method, path, body=None, query=None: _held(resources=[WH1])
    inst._implement_share("N01-U01", "main.inspire.churn_out", shared, {"dashboard": "d1", "genie_space": "g1", "app": "churn-desk"}, None)
    assert [g for g in grants if g[0] == "sql/warehouses"] == [("sql/warehouses", "wh1", "CAN_USE")], "one warehouse, one grant"
