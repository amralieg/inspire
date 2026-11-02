"""A use case added to another use case's Hub App warns about sharing it only for the people who cannot open that Hub yet."""
from v120_artifacts_support import FakeSpark
from v140_implement_test import _inspire, _spec
from v142_merge_test import HOST_APP

PERMS = "/api/2.0/permissions/apps/sales-desk"
CAN_USE = [{"permission_level": "CAN_USE"}]


def _share(agent_ns, acl=None, refuse=False, principals=None):
    base = _spec(agent_ns)[0]
    spec = dict(base, sharing={"principals": principals}) if principals else base
    inst = _inspire(agent_ns, FakeSpark())
    calls, granted = [], []

    def api(method, path, body=None, query=None):
        calls.append((method, path))
        if path == PERMS:
            if refuse:
                raise RuntimeError("PERMISSION_DENIED: cannot read the permissions of sales-desk")
            return {"access_control_list": acl or []}
        return dict(HOST_APP) if method == "GET" else {}

    inst._implement_api = api
    inst._implement_access_rows = lambda table, warnings=None: None
    inst._implement_grant = lambda kind, obj, who, level: granted.append((kind, obj, level))
    warnings = inst._implement_share("N01-U01", "main.inspire.churn_out", spec, {"app": "sales-desk"}, None)
    return inst, warnings, calls, granted


def test_a_hub_everyone_shared_can_already_open_gives_no_sharing_warning(agent_ns):
    _inst, warnings, calls, granted = _share(agent_ns, acl=[{"group_name": "planners", "all_permissions": CAN_USE}])
    assert warnings == []
    assert ("GET", PERMS) in calls and ("PATCH", PERMS) not in calls
    assert not any(kind == "apps" for kind, _obj, _level in granted), "the Hub's own use case decides who opens it"


def test_a_hub_all_account_users_may_open_gives_no_sharing_warning(agent_ns):
    _inst, warnings, _calls, _granted = _share(agent_ns, acl=[{"group_name": "users", "all_permissions": CAN_USE}])
    assert warnings == []


def test_a_hub_some_shared_people_cannot_open_names_only_them(agent_ns):
    principals = [{"type": "group", "name": "planners"}, {"type": "group", "name": "buyers"}]
    _inst, warnings, _calls, granted = _share(agent_ns, acl=[{"group_name": "Planners", "all_permissions": CAN_USE},
                                                             {"group_name": "buyers", "all_permissions": [{"permission_level": "CAN_VIEW"}]}],
                                              principals=principals)
    assert warnings == ["Sharing App: sales-desk belongs to use case N01-U07, so Inspire did not share it with buyers; that use case's "
                        "sharing decides who opens it"]
    assert not any(kind == "apps" for kind, _obj, _level in granted)


def test_a_hub_whose_permissions_cannot_be_read_names_everyone_and_logs_why(agent_ns):
    inst, warnings, _calls, _granted = _share(agent_ns, refuse=True)
    assert warnings == ["Sharing App: sales-desk belongs to use case N01-U07, so Inspire did not share it with planners; that use case's "
                        "sharing decides who opens it"]
    logged = [m for level, m in inst.logger.records if level == "WARNING"]
    assert any("sales-desk" in m and "PERMISSION_DENIED" in m for m in logged), logged
