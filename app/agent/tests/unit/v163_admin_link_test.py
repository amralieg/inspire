import json

import pytest

from v141_app_shell_test import SETTINGS, call
from v149_app_money_test import OWNER
from v149_impact_test import PERSON, shell
from v162_admin_usage_test import UsageWorkspace

OWNED = dict(SETTINGS, use_case_owners={"n01_u05": [OWNER]})


def _info(tmp_path, headers, query=None, settings=None):
    ws = UsageWorkspace()
    status, out = call(shell(tmp_path, ws, settings=dict(OWNED, **(settings or {}))), "GET", "app", query=query, headers=headers)
    assert status == 200, out
    return out, ws


@pytest.mark.parametrize("headers,query,settings,admin", [
    ({"x-forwarded-email": OWNER}, None, None, True),
    ({"x-forwarded-preferred-username": PERSON.upper()}, None, {"use_case_owners": {"n01_u05": [PERSON]}}, True),
    ({"x-forwarded-email": PERSON}, None, None, False),
    ({"x-forwarded-email": PERSON}, {"user": OWNER, "email": OWNER, "admin": "true"}, None, False),
    ({"x-forwarded-email": PERSON, "x-forwarded-user": OWNER}, None, None, False),
    ({}, {"user": OWNER}, None, False),
    ({"x-forwarded-email": OWNER}, None, {"use_case_owners": {}}, False),
    ({"x-forwarded-email": OWNER}, None, {"use_case_owners": {"n01_u05": [PERSON]}}, False),
])
def test_the_app_tells_the_browser_to_show_the_admin_link_only_to_an_owner_it_signed_in_itself(tmp_path, headers, query, settings, admin):
    out, ws = _info(tmp_path, headers, query, settings)
    assert out["is_owner"] is admin, "the owner check reads the workspace's own sign-in headers, never what the browser sends"
    _, anonymous = _info(tmp_path / "anonymous", {}, query, settings)
    assert ws.sql == anonymous.sql, "the owner check adds no table read: the App reads the same tables for every person"
    signed = {str(v).lower() for v in headers.values()}
    assert "admin" not in out and (OWNER.lower() in signed or OWNER not in json.dumps(out)), "the App info never names who owns the App"


def test_the_admin_flag_is_worked_out_for_each_request_so_one_owner_never_shows_it_to_the_next_person(tmp_path):
    s = shell(tmp_path, UsageWorkspace(), settings=OWNED)
    flags = [call(s, "GET", "app", headers={"x-forwarded-email": who})[1]["is_owner"] for who in (OWNER, PERSON, OWNER, "")]
    assert flags == [True, False, True, False]


def test_the_admin_link_and_the_admin_page_use_the_same_owner_check(tmp_path):
    for who in (OWNER, PERSON, ""):
        headers = {"x-forwarded-email": who} if who else {}
        s = shell(tmp_path / (who or "out"), UsageWorkspace(), settings=dict(OWNED, jobs={}))
        shown = call(s, "GET", "app", headers=headers)[1]["is_owner"]
        opened = call(s, "GET", "admin/usage", headers=headers)[0] == 200
        assert shown is opened, who
