"""Inspire records the access it raises when it shares a dashboard, Genie Agent or App, and when a use case is taken out of one that
others share it takes back only that access, only where no remaining use case needs it, and never from an owner or a manager; the
App's service principal loses its reads of the departed use case's tables, offline."""
import json

import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import (GRANT_REASONS, INSPIRE_OWNS, READS, REASONS_VIEW, SHELL_FILES, VALID, _access_spark, _dashboard,
                                 _deploy_inspire, _inspire, _left_by, _NB_SPEC, _spec, sdk_stub)
from v142_merge_test import DASH, HOST_BOARD, _genie_answer
from v161_shared_records_test import _record_locks
from v161_shared_rebuild_test import _joiner_board
from v161_shared_take_out_test import HOST, KEY, OURS_PREFIX, _app_taker, _hub, _taker

PERMS = "/api/2.0/permissions/dashboards/dA"
OWNER = {"user_name": "owner@example.com", "all_permissions": [{"permission_level": "CAN_MANAGE", "inherited": False}]}


def _who(name, level, inherited=False, key="user_name"):
    return {key: name, "all_permissions": [{"permission_level": level, "inherited": inherited}]}


def _raised(name, level="CAN_RUN", before="", kind="user"):
    return {"type": kind, "name": name, "level": level, "before": before}


def _builder(principals, uc="N01-U07", session=777, version=2):
    return {"session_id": session, "use_case_id": uc, "spec_version": version, "status": "ready",
            "spec_json": {"use_case_name": "Sales", "sharing": {"principals": [{"type": "user", "name": p} for p in principals]}}}


def _select(inst, holders, own=()):
    inst.selected = []

    def select(where, args, order=None):
        inst.selected.append((where, args))
        return [dict(r) for r in (holders if "asset" in args else own)]

    inst._implement_select = select


def _dashboard_taker(ns, acl, holders, carried, own=(), put=None):
    ours = json.loads(_dashboard())
    merged, _p = ns["implement_merge_dashboard"](HOST_BOARD, ours, OURS_PREFIX, "N01-U01")
    routes = {("GET", "/api/2.0/lakeview/dashboards/dA"): dict(DASH, serialized_dashboard=json.dumps(merged)),
              ("PATCH", "/api/2.0/lakeview/dashboards/dA"): {}, ("POST", "/api/2.0/lakeview/dashboards/dA/published"): {},
              ("GET", PERMS): {"access_control_list": acl}, ("PUT", PERMS): put if put is not None else {}}
    inst = _taker(ns, routes, [], carried)
    _select(inst, holders, own)
    return inst


def _puts(inst, path=PERMS):
    return [c[2]["access_control_list"] for c in inst.calls if c[:2] == ("PUT", path)]


def test_the_access_inspire_raises_is_recorded_with_the_level_each_principal_had_and_never_for_one_who_had_it(agent_ns):
    current = {"access_control_list": [_who("viewer@example.com", "CAN_VIEW"), _who("runner@example.com", "CAN_RUN"),
                                       _who("readers", "CAN_VIEW", inherited=True, key="group_name")]}
    principals = [{"type": "user", "name": n} for n in ("viewer@example.com", "runner@example.com", "new@example.com")]
    principals.append({"type": "group", "name": "readers"})
    assert agent_ns["implement_raised"](current, principals, "CAN_RUN") == [
        _raised("viewer@example.com", before="CAN_VIEW"), _raised("new@example.com"), _raised("readers", kind="group")], \
        "a principal who already could run it is never recorded; one who could only see it inherited goes back to nothing direct"


def test_taking_back_access_drops_only_what_inspire_raised_back_to_the_level_it_was(agent_ns):
    current = {"access_control_list": [OWNER, _who("viewer@example.com", "CAN_RUN"), _who("only@example.com", "CAN_RUN"),
                                       _who("bumped@example.com", "CAN_EDIT"), _who("before@example.com", "CAN_RUN"),
                                       {"user_name": "admin@example.com", "all_permissions": [
                                           {"permission_level": "CAN_RUN", "inherited": False},
                                           {"permission_level": "CAN_MANAGE", "inherited": True}]},
                                       _who("folder@example.com", "CAN_VIEW", inherited=True)]}
    revoke = [_raised("viewer@example.com", before="CAN_VIEW"), _raised("only@example.com"), _raised("bumped@example.com"),
              _raised("owner@example.com"), _raised("admin@example.com")]
    acl, revoked = agent_ns["implement_revoke_acl"](current, revoke)
    assert revoked == [{"type": "user", "name": "viewer@example.com"}, {"type": "user", "name": "only@example.com"}]
    assert acl == [{"user_name": "owner@example.com", "permission_level": "CAN_MANAGE"},
                   {"user_name": "viewer@example.com", "permission_level": "CAN_VIEW"},
                   {"user_name": "bumped@example.com", "permission_level": "CAN_EDIT"},
                   {"user_name": "before@example.com", "permission_level": "CAN_RUN"},
                   {"user_name": "admin@example.com", "permission_level": "CAN_RUN"}], \
        "the owner, a manager, one someone raised further and one who had it before keep what they have; inherited access is not set"
    assert agent_ns["implement_revoke_acl"](current, [_raised("before@example.com", level="CAN_USE")]) == (None, []), \
        "a level Inspire did not leave in place is not Inspire's to take back"


def test_a_joiner_leaving_a_shared_dashboard_takes_back_only_the_access_it_raised_that_no_one_else_needs(agent_ns):
    acl = [OWNER, _who("before@example.com", "CAN_RUN"), _who("only@example.com", "CAN_RUN"), _who("shared@example.com", "CAN_RUN")]
    inst = _dashboard_taker(agent_ns, acl, [_builder(["shared@example.com"])], {"N01-U07": ({"dashboard_id": "dA"}, {})})
    record = {"people": [_raised("only@example.com"), _raised("shared@example.com"), _raised("owner@example.com")]}
    status = {"dashboard": {"state": "ready", "merged_into": "dA"}, "grants": {"dashboard": {"dA": record}}}
    warnings = inst._implement_delete_outputs(["dashboard"], {"dashboard": "dA"}, KEY, None, status, ())
    assert warnings == []
    assert _puts(inst) == [[{"user_name": "owner@example.com", "permission_level": "CAN_MANAGE"},
                            {"user_name": "before@example.com", "permission_level": "CAN_RUN"},
                            {"user_name": "shared@example.com", "permission_level": "CAN_RUN"}]], \
        "the one only this use case shared with loses it; the owner, one who had it before and one the builder shares with keep it"
    assert [c[0] for c in inst.calls].index("PUT") > [c[0] for c in inst.calls].index("POST"), \
        "access is taken back only after the dashboard is published without this use case's pages"
    assert "dA" not in status["grants"]["dashboard"]
    assert status["dashboard"]["note"].endswith("which Inspire published again; Inspire took back the access it gave only@example.com on "
                                                "it; it stays for use case N01-U07")


def test_a_use_case_an_older_inspire_shared_takes_nothing_back_and_names_who_may_keep_access(agent_ns):
    acl = [OWNER, _who("only@example.com", "CAN_RUN"), _who("shared@example.com", "CAN_RUN")]
    own = [{"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 2, "spec_json": {"sharing": {"principals": [
        {"type": "user", "name": "only@example.com"}, {"type": "user", "name": "shared@example.com"}]}}}]
    inst = _dashboard_taker(agent_ns, acl, [_builder(["shared@example.com"])], {"N01-U07": ({"dashboard_id": "dA"}, {})}, own)
    status = {"dashboard": {"state": "ready", "merged_into": "dA"}}
    warnings = inst._implement_delete_outputs(["dashboard"], {"dashboard": "dA"}, KEY, None, status, ())
    assert _puts(inst) == [] and not [c for c in inst.calls if c[:2] == ("GET", PERMS)]
    assert warnings == ["Sharing Dashboard: an older Inspire shared this use case and kept no record of the access it gave, so "
                        "only@example.com may still open the dashboard dA; check who may open it"]


def test_a_failed_take_back_names_who_may_still_open_it_and_keeps_the_record_for_the_next_try(agent_ns):
    acl = [OWNER, _who("only@example.com", "CAN_RUN")]
    inst = _dashboard_taker(agent_ns, acl, [_builder([])], {"N01-U07": ({"dashboard_id": "dA"}, {})},
                            put=RuntimeError("PERMISSION_DENIED: cannot set permissions"))
    status = {"dashboard": {"state": "ready", "merged_into": "dA"}, "grants": {"dashboard": {"dA": {"people": [_raised("only@example.com")]}}}}
    warnings = inst._implement_delete_outputs(["dashboard"], {"dashboard": "dA"}, KEY, None, status, ())
    assert warnings == ["Sharing Dashboard: Inspire could not take back the access it gave only@example.com on the dashboard dA, so they "
                        "may still open it: PERMISSION_DENIED: cannot set permissions"]
    assert status["grants"]["dashboard"]["dA"]["people"] == [_raised("only@example.com")]


def test_the_builder_leaving_a_shared_dashboard_keeps_access_for_the_people_of_the_use_case_that_keeps_it(agent_ns):
    board = _joiner_board(agent_ns, HOST_BOARD, 5150, "N01-U08", False)
    path = "/api/2.0/permissions/dashboards/d1"
    routes = {("GET", "/api/2.0/lakeview/dashboards/d1"): dict(DASH, dashboard_id="d1", serialized_dashboard=json.dumps(board)),
              ("PATCH", "/api/2.0/lakeview/dashboards/d1"): {}, ("POST", "/api/2.0/lakeview/dashboards/d1/published"): {},
              ("GET", path): {"access_control_list": [OWNER, _who("builder.planner@example.com", "CAN_RUN"),
                                                       _who("heir.planner@example.com", "CAN_RUN")]}, ("PUT", path): {}}
    heir = dict(_builder(["heir.planner@example.com"], uc="N01-U08", session=5150, version=1))
    inst = _taker(agent_ns, routes, [], {"N01-U08": ({"dashboard_id": "d1"}, {"dashboard": {"state": "ready", "merged_into": "d1"}})})
    _select(inst, [heir])
    record = {"people": [_raised("builder.planner@example.com"), _raised("heir.planner@example.com")]}
    status = {"dashboard": {"state": "ready"}, "grants": {"dashboard": {"d1": record}}}
    assert inst._implement_delete_outputs(["dashboard"], {"dashboard": "d1"}, KEY, None, status, ()) == []
    assert _puts(inst, path) == [[{"user_name": "owner@example.com", "permission_level": "CAN_MANAGE"},
                                  {"user_name": "heir.planner@example.com", "permission_level": "CAN_RUN"}]]


def test_a_page_leaving_a_hub_app_takes_back_the_service_principal_s_reads_of_its_tables_and_its_genie_agent(agent_ns, tmp_path, monkeypatch):
    _core, app = _hub(agent_ns, tmp_path, monkeypatch)
    perms, genie = "/api/2.0/permissions/apps/sales-desk", "/api/2.0/permissions/genie/g1"
    extra = {("GET", perms): {"access_control_list": [OWNER, _who("only@example.com", "CAN_USE")]}, ("PUT", perms): {},
             ("GET", "/api/2.0/genie/spaces/gA"): _genie_answer("gA", {"data_sources": {"tables": [{"identifier": "main.s.stores"}]}}),
             ("GET", genie): {"access_control_list": [OWNER, _who("sp-7", "CAN_RUN", key="service_principal_name")]}, ("PUT", genie): {}}
    holders = [dict(HOST, status={}, principals=[])]
    inst = _app_taker(agent_ns, tmp_path, monkeypatch, app, holders, extra)
    table = lambda name, privilege="SELECT": {"privilege": privilege, "level": "table", "object": f"`main`.`inspire`.`{name}`",
                                               "table": f"main.inspire.{name}"}
    sql = [{"privilege": "USE SCHEMA", "level": "schema", "object": "`main`.`inspire`", "table": "main.inspire.churn_out"},
           table("churn_out"), table("churn_out_summary"), table("churn_out_reasons"), table("churn_out_assumptions"),
           table("churn_out_assumptions", "MODIFY"), table("sales_out")]
    record = {"people": [_raised("only@example.com", level="CAN_USE")],
              "service_principal": {"name": "sp-7", "sql": sql, "genie": [{"space_id": "g1", "level": "CAN_RUN", "before": ""}]}}
    status = {"app": {"state": "ready", "merged_into": "sales-desk", "page": "n01_u01_s5150"}, "grants": {"app": {"sales-desk": record}}}
    warnings = inst._implement_delete_outputs(["app"], {"app": "sales-desk"}, KEY, None, status, ())
    assert warnings == []
    revokes = [s for s in inst.spark.statements if s.startswith("REVOKE")]
    assert revokes == [f"REVOKE SELECT ON TABLE `main`.`inspire`.`{t}` FROM `sp-7`" for t in
                       ("churn_out", "churn_out_summary", "churn_out_reasons", "churn_out_assumptions")] + [
        "REVOKE MODIFY ON TABLE `main`.`inspire`.`churn_out_assumptions` FROM `sp-7`"], \
        "the tables the host's page still reads, and the schema, stay readable"
    assert _puts(inst, perms) == [[{"user_name": "owner@example.com", "permission_level": "CAN_MANAGE"}]]
    assert _puts(inst, genie) == [[{"user_name": "owner@example.com", "permission_level": "CAN_MANAGE"}]], \
        "the App no longer asks this use case's Genie Agent, so its service principal may no longer run it"
    assert "sales-desk" not in status["grants"]["app"]
    assert status["app"]["note"].count("Inspire took back the access it gave only@example.com") == 1
    assert ("the App's service principal sp-7 no longer has the access Inspire gave it to main.inspire.churn_out, "
            "main.inspire.churn_out_assumptions, main.inspire.churn_out_reasons and main.inspire.churn_out_summary, nor to the Genie Agent "
            "g1; its USE CATALOG and USE SCHEMA grants stay, because they open no data by themselves") in status["app"]["note"]


def test_sharing_records_what_it_raised_on_a_shared_dashboard_under_its_asset_lock(agent_ns):
    inst = _inspire(agent_ns, _access_spark(INSPIRE_OWNS))
    calls = []

    def api(method, path, body=None, query=None):
        calls.append((method, path, body))
        if (method, path) == ("GET", "/api/2.0/permissions/dashboards/d1"):
            return {"access_control_list": [OWNER, _who("already@example.com", "CAN_RUN")]}
        return {}

    inst._implement_api = api
    events = []
    _record_locks(inst, events)
    spec = dict(_spec(agent_ns)[0], sharing={"principals": [{"type": "user", "name": "already@example.com"},
                                                            {"type": "user", "name": "new@example.com"}]})
    status = {"dashboard": {"state": "ready"}}
    inst._implement_share("N01-U01", "main.inspire.churn_out", spec, {"dashboard": "d1"}, None, asset_status=status)
    assert status["grants"]["dashboard"]["d1"] == {"people": [_raised("new@example.com")]}
    assert [e for e in events if e[0] != "update"] == [("lock", "dashboard", "d1"), ("unlock", "dashboard", "d1")]
    assert ("PATCH", "/api/2.0/permissions/dashboards/d1", {"access_control_list": [
        {"user_name": "new@example.com", "permission_level": "CAN_RUN"}]}) in calls


def test_sharing_also_records_a_principal_another_use_case_raised_so_whoever_leaves_last_takes_it_back(agent_ns):
    inst = _inspire(agent_ns, _access_spark(INSPIRE_OWNS))
    calls = []

    def api(method, path, body=None, query=None):
        calls.append((method, path))
        if (method, path) == ("GET", "/api/2.0/permissions/dashboards/dA"):
            return {"access_control_list": [OWNER, _who("both@example.com", "CAN_RUN")]}
        return {}

    inst._implement_api = api
    _select(inst, [_builder(["both@example.com"])])
    theirs = {"people": [_raised("both@example.com", before="CAN_VIEW")]}
    inst._implement_carried = lambda target: ({"dashboard_id": "dA"}, {"dashboard": {"state": "ready"}, "grants": {"dashboard": {"dA": theirs}}})
    spec = dict(_spec(agent_ns)[0], sharing={"principals": [{"type": "user", "name": "both@example.com"}]})
    status = {}
    inst._implement_share("N01-U01", "main.inspire.churn_out", spec, {"dashboard": "dA"}, None, asset_status=status)
    assert ("PATCH", "/api/2.0/permissions/dashboards/dA") not in calls, "it already runs it, so nothing is raised"
    assert status["grants"]["dashboard"]["dA"] == {"people": [_raised("both@example.com", before="CAN_VIEW")]}, \
        "the level it had before the other use case raised it is kept, so whichever of the two leaves last takes it back"


def test_an_app_deploy_hands_back_every_sql_grant_it_ran_for_the_service_principal(agent_ns, sdk_stub):
    inst, context, _calls, _imported = _deploy_inspire(agent_ns, [
        RuntimeError("RESOURCE_DOES_NOT_EXIST: app churn-desk"),
        {"compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-1"},
        {"deployment_id": "dep1", "status": {"state": "SUCCEEDED"}}, {"url": "https://churn-desk.example/"}])
    context["reasons_view"] = REASONS_VIEW
    fields = inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    granted = fields["_grants"]
    assert granted["name"] == "sp-1" and granted["genie"] == []
    statements = [agent_ns["implement_grant_sql"](g, "sp-1") for g in granted["sql"]]
    assert statements and all(s in inst.spark.statements for s in statements), "every recorded grant is one Inspire ran"
    reads = sorted({g["table"] for g in granted["sql"] if g["level"] == "table"})
    assert reads == ["main.inspire.churn_out", "main.inspire.churn_out_feedback", REASONS_VIEW, "main.s.orders"]
    assert GRANT_REASONS.format("sp-1") in statements


def test_a_build_keeps_the_record_of_the_service_principal_grants_its_app_deploy_ran(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    previous = dict(VALID, outputs={**VALID["outputs"], "app": True, "app_name": "churn-desk"})
    inst._implement_previous = lambda t: {"spec_version": 2, "spec_json": previous}
    held = {"service_principal": {"name": "sp-1", "sql": [{"privilege": "SELECT", "level": "table", "object": "`main`.`s`.`orders`",
                                                           "table": "main.s.orders"}], "genie": []}}
    inst._implement_carried = lambda t: ({"notebook_path": "/W/nb", "job_id": 77, "last_preview_run_id": 5, "result_rows": 40,
                                          "dashboard_id": "d1", "genie_space_id": "g1", "app_name": "churn-desk"},
                                         _left_by(2, {"app": {"state": "ready"}, "grants": {"app": {"churn-desk": held}}}))
    inst.updates = []
    inst._implement_update = lambda key, **f: inst.updates.append(f)
    inst._implement_use_case_row = lambda sid, uc: {"No": "N01-U01", "Name": "Predict churn", "genie_instruction": "Build"}
    inst._row_to_uc = lambda row: dict(row)
    inst._genie_notebook_spec = lambda uc: dict(_NB_SPEC)
    inst._genie_widget_names = lambda instruction, spec: ["result_table"]
    inst._genie_involved_tables = lambda uc: ["main.s.orders"]
    inst._implement_runner = lambda uc: "runner"
    inst._implement_fill_and_preview = lambda *a: pytest.fail("a retry of an output never re-runs the notebook")
    inst._implement_schedule = lambda *a: None
    ran = [{"privilege": "SELECT", "level": "table", "object": "`main`.`inspire`.`churn_out`", "table": "main.inspire.churn_out"},
           {"privilege": "SELECT", "level": "table", "object": "`main`.`s`.`orders`", "table": "main.s.orders"}]
    inst._implement_app = lambda context, runner: {"app_name": "churn-desk", "app_url": "https://churn-desk.example",
                                                   "_grants": {"name": "sp-1", "sql": ran, "genie": []}}
    inst._implement_dashboard = inst._implement_genie_space = inst._implement_alert = lambda c, r: pytest.fail("only the App is retried")
    inst._implement_share = lambda uc, table, spec, assets, job_id, asset_status=None, sources=(): []
    inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3,
                                "spec_json": dict(previous, retry_outputs=["app"])}, (5150, "N01-U01", 3))
    final = inst.updates[-1]
    assert "_grants" not in final
    assert final["asset_status"]["grants"]["app"]["churn-desk"]["service_principal"] == {
        "name": "sp-1", "sql": [held["service_principal"]["sql"][0], ran[0]], "genie": []}, \
        "a grant an earlier version ran stays on record, once, next to the new one"


def test_uninstall_all_says_the_people_it_was_shared_with_keep_the_sql_warehouse(agent_ns):
    from v143_vibes_test import _locked, _run
    inst, previous = _locked(agent_ns)
    inst._implement_notebook_paths = lambda uc, key: ("/W/impl/N01", "/W/impl/N01/nb")
    inst._implement_api = lambda method, path, body=None, query=None: {"description": "Inspire use case N01-U01 (session 5150): x"} \
        if method == "GET" and path.startswith("/api/2.0/apps/") else {}
    inst._implement_api_items = lambda path, key, query=None: []
    inst._implement_delete_digest = lambda uc, digest: []
    inst._implement_output_holders = lambda name, asset, key: []
    inst._implement_own_sharing = lambda key: ([{"type": "group", "name": "planners"}], ["wh1"])
    assert _run(inst, dict(previous, uninstall=True)) == "uninstalled"
    done = [e for e in inst.emitted if e.get("step_name") == "Done"][-1]
    assert done["message"].endswith("the result tables and the history are kept; planners keep CAN USE on the SQL warehouse wh1, which "
                                    "they may use for other work")


def test_the_sharing_inspire_did_for_a_use_case_is_read_from_every_one_of_its_versions(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    rows = [{"spec_version": 1, "spec_json": {"config": {"warehouse_id": "wh1"}, "sharing": {"principals": [{"type": "group", "name": "planners"}]}}},
            {"spec_version": 2, "spec_json": {"config": {"warehouse_id": "wh2"}, "sharing": {"principals": [
                {"type": "group", "name": "Planners"}, {"type": "user", "name": "lead@example.com"}]}}}]
    _select(inst, [], rows)
    assert inst._implement_own_sharing(KEY) == ([{"type": "group", "name": "planners"}, {"type": "user", "name": "lead@example.com"}],
                                                ["wh1", "wh2"])
    assert inst.selected == [("session_id = :sid AND use_case_id = :uc", {"sid": 5150, "uc": "N01-U01"})]
