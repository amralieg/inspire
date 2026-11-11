import copy
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_core  # noqa: E402
import shell_pg  # noqa: E402
from v141_app_shell_test import PAGE, SETTINGS, FakeWorkspace, app_dir, call  # noqa: E402
from v145_lakebase_test import PG_ENV, PG_SCHEMA, RenderingLakebase, backend  # noqa: E402

ALICE, BOB = "alice@example.com", "bob@example.com"
TOKENS = {"tok-alice": ALICE, "tok-bob": BOB}


def enforced_backend():
    held = backend(True)
    for entry in held["tables"].values():
        names = [col["name"] for col in entry["columns"]]
        column = next((c for c in ("region", "category", "channel") if c in names), names[0])
        entry["base"] = entry["pg"].replace(PG_SCHEMA, f"{PG_SCHEMA}_base", 1)
        entry["enforce"] = [{"column": column, "map": f"{PG_SCHEMA}_base.access", "key": column, "principal": "principal"}]
    held["enforced"] = True
    return held


class Viewer(FakeWorkspace):
    def __init__(self, email):
        super().__init__()
        self.email = email

    def call(self, method, path, body=None, params=None):
        if path == shell_core.SCIM_ME_PATH:
            return {"userName": self.email, "groups": []}
        raise AssertionError(f"unexpected workspace call {method} {path}")


class Recording(RenderingLakebase):
    def __init__(self, settings_backend, env, service, answers=None, log=None):
        super().__init__(settings_backend, env, service, answers)
        self.log = log

    def run(self, sql, params, limit, queued=False, viewer=""):
        self.log.append(viewer)
        return super().run(sql, params, limit, queued)


def enforced_shell(tmp_path):
    users, log = {}, []
    service = FakeWorkspace()

    def user_factory(host, token):
        if token not in users:
            users[token] = Viewer(TOKENS[token])
        return users[token]

    def lakebase_factory(settings_backend, env, svc):
        return Recording(settings_backend, env, svc, log=log)

    settings = dict(SETTINGS, auth="user", backend=enforced_backend())
    s = shell_core.Shell(app_dir(tmp_path, settings, [PAGE]), env=dict(PG_ENV), sp_factory=lambda: service,
                         user_factory=user_factory, lakebase_factory=lakebase_factory)
    return s, service, users, log


def as_user(token, extra=None):
    headers = {"x-forwarded-access-token": token}
    return dict(headers, **(extra or {}))


def test_kpis_and_charts_read_the_copy_as_the_person_who_asked(tmp_path):
    s, service, _users, log = enforced_shell(tmp_path)
    status, out = call(s, "POST", "page", headers=as_user("tok-alice"), body={"page": "n01_u05"})
    assert status == 200, out
    assert log and set(log) == {ALICE}, "every Lakebase read of a KPI or chart carries the viewer, never the service principal"
    assert service.sql == []


def test_the_records_list_reads_the_copy_as_the_person_who_asked(tmp_path):
    s, service, _users, log = enforced_shell(tmp_path)
    status, out = call(s, "POST", "records", headers=as_user("tok-alice"), body={"page": "n01_u05", "filters": {}})
    assert status == 200, out
    assert log and set(log) == {ALICE}
    assert service.sql == []


def test_the_work_view_never_reads_as_the_service_principal_and_any_lakebase_read_is_the_person_who_asked(tmp_path):
    s, service, _users, log = enforced_shell(tmp_path)
    status, out = call(s, "POST", "my_work", headers=as_user("tok-bob", {"x-forwarded-email": BOB}), body={"window": "week"})
    assert status == 200, out
    assert set(log) <= {BOB}, "any Lakebase read of Work carries bob"
    assert service.sql == [], "the service principal read nothing for Work"


def test_genie_answers_run_as_the_person_who_asked_and_never_as_the_service_principal(tmp_path):
    s, service, users, _log = enforced_shell(tmp_path)
    call(s, "POST", "genie/ask", headers=as_user("tok-alice"), body={"question": "Which category lost most?"})
    assert users["tok-alice"].genie, "the Genie question went out with alice's own token"
    assert service.genie == []


def test_an_enforced_app_offers_no_data_download_to_anyone(tmp_path):
    s, _service, _users, _log = enforced_shell(tmp_path)
    status, info = call(s, "GET", "app", headers=as_user("tok-alice"))
    assert status == 200, info
    assert "download" not in info["options"], "a per-user App keeps the rows in the page, so no export can carry another person's rows"


@pytest.mark.parametrize("route,method,body", [
    ("page", "POST", {"page": "n01_u05"}),
    ("records", "POST", {"page": "n01_u05", "filters": {}}),
])
def test_a_forged_email_header_does_not_change_whose_rows_a_route_reads(tmp_path, route, method, body):
    s, _service, _users, log = enforced_shell(tmp_path)
    call(s, method, route, headers=as_user("tok-bob", {"x-forwarded-email": ALICE}), body=body)
    assert log and set(log) == {BOB}, "the header names alice, the token is bob's, and the token decides (must-exclude)"
