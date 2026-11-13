"""A principal dropped from a use case's sharing list loses only the access Inspire raised for it, the App's service principal loses
its Lakebase reads of a departed page's copies, principals match by type and name, and a join never counts for a same-named App made
again later, offline."""
import json

from v120_artifacts_support import FakeSpark
from v140_implement_test import INSPIRE_OWNS, READS, SHELL_FILES, _access_spark, _inspire, _spec, sdk_stub
from v142_merge_test import HOST_APP, _merge_flow
from v146_lakebase_build_test import LIVE, NEW_APP, PG, _created, _lakebase, _lakebase_deploy
from v161_shared_grants_test import OWNER, _builder, _raised, _select, _who
from v161_shared_take_out_test import KEY, _taker

DASH_PERMS = "/api/2.0/permissions/dashboards/d1"
OLD, NEW = "2026-10-01T10:00:00Z", "2026-10-29T10:00:00Z"
STALE = ("sales-desk was deleted and made again after this use case joined it, so this use case is not in it")


def _sharer(ns, acl, holders=(), own=(), holder_status=None):
    inst = _inspire(ns, _access_spark(INSPIRE_OWNS))
    inst.calls = []

    def api(method, path, body=None, query=None):
        inst.calls.append((method, path, body))
        if (method, path) == ("GET", DASH_PERMS):
            return {"access_control_list": acl}
        return {}

    inst._implement_api = api
    _select(inst, list(holders), list(own))
    inst._implement_carried = lambda target: ({"dashboard_id": "d1"}, holder_status or {})
    return inst


def _shared(ns, *names):
    return dict(_spec(ns)[0], sharing={"principals": [{"type": "user", "name": n} for n in names]})


def _puts(inst, path=DASH_PERMS):
    return [c[2]["access_control_list"] for c in inst.calls if c[:2] == ("PUT", path)]


def _user(name, level):
    return {"user_name": name, "permission_level": level}


def test_a_principal_dropped_from_the_sharing_list_loses_only_what_inspire_raised_for_it(agent_ns):
    acl = [OWNER, _who("dropped@example.com", "CAN_RUN"), _who("kept@example.com", "CAN_RUN"), _who("prior@example.com", "CAN_RUN"),
           _who("other@example.com", "CAN_RUN")]
    inst = _sharer(agent_ns, acl, [_builder(["other@example.com"])])
    record = {"people": [_raised("dropped@example.com"), _raised("kept@example.com"), _raised("other@example.com")]}
    status = {"dashboard": {"state": "ready"}, "grants": {"dashboard": {"d1": record}}}
    warnings = inst._implement_share("N01-U01", "main.inspire.churn_out", _shared(agent_ns, "kept@example.com"), {"dashboard": "d1"}, None,
                                     asset_status=status)
    assert warnings == []
    assert _puts(inst) == [[_user("owner@example.com", "CAN_MANAGE"), _user("kept@example.com", "CAN_RUN"),
                            _user("prior@example.com", "CAN_RUN"), _user("other@example.com", "CAN_RUN")]], \
        "the dropped one loses it; one who had it before Inspire and one another use case shares with keep it"
    assert status["grants"]["dashboard"]["d1"] == {"people": [_raised("kept@example.com")]}
    step = [e for e in inst.emitted if e.get("step_name") == "Sharing"][-1]
    assert "Dashboard: Inspire took back the access it gave dropped@example.com on it" in step["message"]


def test_a_level_inspire_raised_above_what_the_use_case_now_shares_drops_to_the_new_level(agent_ns):
    acl = [OWNER, _who("kept@example.com", "CAN_EDIT")]
    inst = _sharer(agent_ns, acl)
    status = {"grants": {"dashboard": {"d1": {"people": [_raised("kept@example.com", level="CAN_EDIT", before="CAN_VIEW")]}}}}
    inst._implement_share("N01-U01", "main.inspire.churn_out", _shared(agent_ns, "kept@example.com"), {"dashboard": "d1"}, None,
                          asset_status=status)
    assert _puts(inst) == [[_user("owner@example.com", "CAN_MANAGE"), _user("kept@example.com", "CAN_RUN")]]
    assert status["grants"]["dashboard"]["d1"]["people"] == [_raised("kept@example.com", before="CAN_VIEW")], \
        "it still holds what it raised, now at the lower level, and still goes back to CAN VIEW when it leaves"


def test_an_empty_sharing_list_takes_back_everything_inspire_raised_and_an_older_record_names_who_may_keep_access(agent_ns):
    acl = [OWNER, _who("dropped@example.com", "CAN_RUN")]
    inst = _sharer(agent_ns, acl)
    status = {"grants": {"dashboard": {"d1": {"people": [_raised("dropped@example.com")]}}}}
    assert inst._implement_share("N01-U01", "main.inspire.churn_out", _shared(agent_ns), {"dashboard": "d1"}, None, asset_status=status) == []
    assert _puts(inst) == [[_user("owner@example.com", "CAN_MANAGE")]]
    assert status["grants"]["dashboard"]["d1"] == {"people": []}
    own = [{"spec_version": 1, "spec_json": {"sharing": {"principals": [{"type": "user", "name": "dropped@example.com"},
                                                                      {"type": "user", "name": "kept@example.com"}]}}}]
    older = _sharer(agent_ns, acl, own=own)
    warnings = older._implement_share("N01-U01", "main.inspire.churn_out", _shared(agent_ns, "kept@example.com"), {"dashboard": "d1"}, None,
                                      asset_status={})
    assert _puts(older) == []
    assert warnings == ["Sharing Dashboard: an older Inspire shared this use case and kept no record of the access it gave, so "
                        "dropped@example.com may still open the dashboard d1; check who may open it"]


def test_a_user_and_a_group_with_the_same_name_are_two_principals(agent_ns):
    current = {"access_control_list": [OWNER, _who("data", "CAN_RUN"), _who("data", "CAN_RUN", key="group_name")]}
    acl, revoked = agent_ns["implement_revoke_acl"](current, [_raised("data")])
    assert revoked == [{"type": "user", "name": "data"}]
    assert acl == [_user("owner@example.com", "CAN_MANAGE"), {"group_name": "data", "permission_level": "CAN_RUN"}], \
        "the group named data keeps its access when only the user named data is taken back"
    below = agent_ns["implement_principals_below"]({"access_control_list": [_who("data", "CAN_RUN", key="group_name")]},
                                                   [{"type": "user", "name": "data"}], "CAN_RUN")
    assert below == [{"type": "user", "name": "data"}], "a group's access is not the user's"
    assert agent_ns["implement_needed_principals"]([{"principals": [{"type": "group", "name": "Data"}]}], "CAN_RUN") == {("group", "data"): "CAN_RUN"}


def test_a_remaining_use_case_sharing_with_a_group_does_not_keep_the_same_named_user(agent_ns):
    acl = [OWNER, _who("data", "CAN_RUN"), _who("data", "CAN_RUN", key="group_name")]
    inst = _sharer(agent_ns, acl, [dict(_builder([]), spec_json={"sharing": {"principals": [{"type": "group", "name": "data"}]}})])
    status = {"grants": {"dashboard": {"d1": {"people": [_raised("data"), _raised("data", kind="group")]}}}}
    inst._implement_share("N01-U01", "main.inspire.churn_out", _shared(agent_ns), {"dashboard": "d1"}, None, asset_status=status)
    assert _puts(inst) == [[_user("owner@example.com", "CAN_MANAGE"), {"group_name": "data", "permission_level": "CAN_RUN"}]]


def test_the_app_service_principal_loses_its_lakebase_reads_of_a_departed_pages_copies_and_keeps_a_copy_still_read(agent_ns, tmp_path):
    inst = _inspire(agent_ns, FakeSpark())
    inst.local_log_output_dir = str(tmp_path)
    ran = []
    gone = "sales_desk.n01_u09__t_cccc3333"

    def run(env, statements):
        text = [s.as_string(None) for s in statements]
        if any(gone.split(".")[1] in t for t in text):
            raise RuntimeError(f'relation "{gone}" does not exist')
        ran.extend(text)

    inst._implement_lakebase_sql = run
    record = {"name": "sp-7", "sql": [], "genie": [], "lakebase": {"schema": "sales_desk", "tables": [
        "sales_desk.n01_u01__t_aaaa1111", "sales_desk.n01_u07__t_bbbb2222", gone]}}
    needs = {"pages": [], "service_principal": "sp-7", "lakebase_env": {"PGHOST": "pg.example"},
             "settings": {"backend": {"kind": "lakebase", "tables": {"main.inspire.sales_out": {"pg": "sales_desk.n01_u07__t_bbbb2222"}}}}}
    warnings, said, left = inst._implement_revoke_app_sp("sales-desk", record, needs)
    assert ran == ['REVOKE SELECT ON TABLE "sales_desk"."n01_u01__t_aaaa1111" FROM "sp-7"'], \
        "the copy the remaining page reads keeps its grant; a copy already removed has nothing left to take back"
    assert warnings == [] and left["lakebase"]["tables"] == []
    assert said == ["the App's service principal sp-7 no longer reads the Lakebase copies sales_desk.n01_u01__t_aaaa1111 and "
                    f"{gone}; its USAGE on the Lakebase schema stays, because it opens no data by itself"]

    def denied(env, statements):
        if any("cccc3333" in s.as_string(None) for s in statements):
            raise RuntimeError(f'relation "{gone}" does not exist')
        raise RuntimeError("permission denied for table n01_u01__t_aaaa1111")

    inst._implement_lakebase_sql = denied
    warnings, _said, left = inst._implement_revoke_app_sp("sales-desk", record, needs)
    assert warnings == ['App: REVOKE SELECT ON TABLE "sales_desk"."n01_u01__t_aaaa1111" FROM "sp-7" failed on Lakebase, so the App\'s '
                        "service principal may still read that copy: the identity Inspire runs as has no rights on the Lakebase table "
                        'n01_u01__t_aaaa1111; ask the Lakebase project owner to run GRANT ALL PRIVILEGES ON TABLE n01_u01__t_aaaa1111 TO "<identity>"']
    assert left["lakebase"]["tables"] == ["sales_desk.n01_u01__t_aaaa1111"]


def test_an_app_deploy_on_lakebase_records_the_copies_it_let_the_service_principal_read(agent_ns, sdk_stub):
    inst, context, _calls, _imported = _lakebase_deploy(agent_ns, [NEW_APP, _created(agent_ns)] + LIVE)
    fields = inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0, lakebase=_lakebase())
    assert fields["_grants"]["lakebase"] == {"schema": "churn_desk", "tables": [PG]}
    failed, context, _calls, _imported = _lakebase_deploy(agent_ns, [NEW_APP, _created(agent_ns)] + LIVE, grant="permission denied")
    fields = failed._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0, lakebase=_lakebase())
    assert "lakebase" not in fields["_grants"], "a grant that failed is not on record"


def test_a_join_with_an_app_that_was_deleted_and_made_again_under_its_name_takes_nothing_out_of_the_new_one(agent_ns):
    routes = {("GET", "/api/2.0/apps/sales-desk"): dict(HOST_APP, create_time=NEW)}
    inst = _taker(agent_ns, routes)
    status = {"state": "ready", "merged_into": "sales-desk", "page": "n01_u01_s5150", "created": OLD}
    outcome = inst._implement_delete_output("app", "sales-desk", KEY, status=status)
    message = f"App: {STALE}, and Inspire left it as it is"
    assert outcome == {"state": "released", "note": message, "warnings": [], "refused": False}
    assert [c[:2] for c in inst.calls] == [("GET", "/api/2.0/apps/sales-desk")] and inst.selected == [], \
        "nothing is taken out of the new App and nobody else's sharing is read for it"
    same = _taker(agent_ns, routes)
    same._implement_take_out_app = lambda asset_id, key, holders, status: {"state": "released", "note": "taken out"}
    _select(same, [{"session_id": 777, "use_case_id": "N01-U07"}])
    same._implement_carried = lambda target: ({"app_name": "sales-desk"}, {"app": {"state": "ready", "created": NEW}})
    assert same._implement_delete_output("app", "sales-desk", KEY, status=dict(status, created=NEW))["note"].startswith("taken out")


def test_a_holder_whose_join_was_with_an_earlier_app_of_the_same_name_is_not_a_holder_of_the_new_one(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_api = lambda method, path, body=None, query=None: dict(HOST_APP, create_time=NEW)
    rows = [{"session_id": 777, "use_case_id": u, "spec_version": 1, "status": "ready", "spec_json": {"use_case_name": u}}
            for u in ("N01-U07", "N01-U08", "N01-U09")]
    _select(inst, rows)
    created = {"N01-U07": OLD, "N01-U08": NEW, "N01-U09": ""}
    inst._implement_carried = lambda target: ({"app_name": "sales-desk"}, {"app": {
        "state": "ready", "merged_into": "sales-desk", **({"created": created[target["use_case_id"]]} if created[target["use_case_id"]] else {})}})
    holders = inst._implement_output_holders("app", "sales-desk", KEY)
    assert [h["use_case_id"] for h in holders] == ["N01-U08", "N01-U09"], "an older record with no time on it still counts"


def test_joining_an_app_records_when_that_app_was_made_and_a_page_record_of_an_earlier_app_is_never_used(agent_ns, tmp_path, monkeypatch):
    inst, context, _seen, _calls = _merge_flow(agent_ns, tmp_path, monkeypatch, app=dict(HOST_APP, create_time=NEW))
    fields = inst._implement_app(context, None)
    assert fields["_asset"] == {"merged_into": "sales-desk", "page": "n01_u01_s5150", "created": NEW}
    host = {"name": "sales-desk", "app": dict(HOST_APP, create_time=NEW)}
    page = {"asset_status": {"app": {"merged_into": "sales-desk", "page": "n01_u01", "created": OLD}}}
    assert inst._implement_app_recorded_page(page, host) == ""
    assert inst._implement_app_recorded_page({"asset_status": {"app": dict(page["asset_status"]["app"], created=NEW)}}, host) == "n01_u01"


def test_sharing_never_opens_a_same_named_app_made_again_after_the_join(agent_ns):
    inst = _inspire(agent_ns, _access_spark(INSPIRE_OWNS))
    calls = []
    inst._implement_api = lambda method, path, body=None, query=None: calls.append((method, path)) or (
        dict(HOST_APP, create_time=NEW) if path == "/api/2.0/apps/sales-desk" else {})
    spec = _shared(agent_ns, "planner@example.com")
    status = {"app": {"state": "ready", "merged_into": "sales-desk", "created": OLD}}
    warnings = inst._implement_share("N01-U01", "main.inspire.churn_out", spec, {"app": "sales-desk"}, None, asset_status=status)
    assert f"Sharing App: {STALE}, and Inspire did not share it" in warnings
    assert not [c for c in calls if c[1] == "/api/2.0/permissions/apps/sales-desk"]
