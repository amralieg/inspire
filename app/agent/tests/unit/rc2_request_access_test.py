"""REQ-311: the App shell's Request for Access sends each grant as the person it is for, only where a destination is set, and says plainly
when it cannot. The contract matches the Inspire App backend (backend/lib/accessRequest.js).
"""
from urllib.parse import quote

from v141_app_shell_test import call, shell
from v236_waiting_for_access_test import reading_page

import shell_core  # noqa: E402  (v141 puts the App shell server on sys.path)

WHO = "signed-in@example.com"
APP_ID = "11111111-2222-3333-4444-555555555555"
GRANTS = [
    f"GRANT USE CATALOG ON CATALOG `main` TO `{WHO}`",
    f"GRANT USE SCHEMA ON SCHEMA `main`.`s` TO `{WHO}`",
    f"GRANT SELECT ON TABLE `main`.`s`.`orders` TO `{WHO}`",
]
OWNER = {"destinations": [{"destination_id": "owner@example.com", "destination_type": "EMAIL"}]}


class FakeWs:
    """ws.call(method, path, body=None, params=None): answers keyed by (method, path) or (method, path, SCIM filter)."""

    def __init__(self, answers):
        self.answers, self.calls = answers, []

    def call(self, method, path, body=None, params=None, timeout=60):
        self.calls.append({"method": method, "path": path, "body": body, "params": params})
        filt = (params or {}).get("filter")
        for key in ((method, path, filt), (method, path)):
            if key in self.answers:
                hit = self.answers[key]
                if isinstance(hit, Exception):
                    raise hit
                return hit
        raise RuntimeError(f"no fake for {method} {path} {filt or ''}")

    def posts(self):
        return [c for c in self.calls if c["method"] == "POST"]


DESTS = {
    ("GET", "/api/3.0/rfa/destinations/catalog/main"): OWNER,
    ("GET", f"/api/3.0/rfa/destinations/schema/{quote('main.s', safe='')}"): OWNER,
    ("GET", f"/api/3.0/rfa/destinations/table/{quote('main.s.orders', safe='')}"): OWNER,
}


def test_the_requestable_grants_group_by_grantee_and_securable_and_leave_other_securable_types_out():
    got = shell_core.rfa_requests(GRANTS + [f"GRANT CAN_USE ON WAREHOUSE `w` TO `{WHO}`", f"GRANT SELECT ON TABLE `main`.`s`.`orders` TO `{WHO}`"])
    assert got == [
        {"grantee": WHO, "securable": {"type": "CATALOG", "full_name": "main"}, "permissions": ["USE_CATALOG"]},
        # REQ-518: the table SELECT asks on the table, never on the schema.
        {"grantee": WHO, "securable": {"type": "SCHEMA", "full_name": "main.s"}, "permissions": ["USE_SCHEMA"]},
        {"grantee": WHO, "securable": {"type": "TABLE", "full_name": "main.s.orders"}, "permissions": ["SELECT"]},
    ]


def test_check_is_offered_when_a_destination_is_set_and_no_request_is_posted_by_a_check():
    ws = FakeWs(dict(DESTS))
    got = shell_core.rfa_check(ws, WHO, GRANTS)
    assert got["offered"] is True and got["destinations"] == ["owner@example.com"] and got["reason"] == ""
    assert ws.posts() == []


def test_send_posts_one_request_for_the_person_with_no_behalf_of_and_a_comment_the_API_accepts():
    ws = FakeWs({**DESTS, ("POST", "/api/3.0/rfa/requests"): {"responses": []}})
    got = shell_core.rfa_send(ws, WHO, GRANTS)
    assert {k: v for k, v in got.items() if k != "links"} == {"sent": True, "destinations": ["owner@example.com"], "reason": ""}
    (post,) = ws.posts()
    assert len(post["body"]["requests"]) == 1
    request = post["body"]["requests"][0]
    assert "behalf_of" not in request
    assert request["comment"] == shell_core.RFA_COMMENT and len(request["comment"]) <= 200
    assert [p["securable"]["full_name"] for p in request["securable_permissions"]] == ["main", "main.s", "main.s.orders"]  # REQ-518: the table SELECT is on the table


def test_an_App_grant_is_resolved_to_its_service_principal_and_sent_as_its_own_request():
    scim = ("GET", "/api/2.0/preview/scim/v2/ServicePrincipals", f'applicationId eq "{APP_ID}"')
    ws = FakeWs({**DESTS, scim: {"Resources": [{"id": "sp-scim-7"}]}, ("POST", "/api/3.0/rfa/requests"): {}})
    got = shell_core.rfa_send(ws, WHO, [GRANTS[0], f"GRANT SELECT ON TABLE `main`.`s`.`orders` TO `{APP_ID}`"])
    assert got["sent"] is True
    (post,) = ws.posts()
    assert len(post["body"]["requests"]) == 2
    for_app = next(r for r in post["body"]["requests"] if "behalf_of" in r)
    assert for_app["behalf_of"] == {"id": "sp-scim-7", "principal_type": "SERVICE_PRINCIPAL"}


def test_no_destination_is_not_offered_and_nothing_is_posted():
    empty = {}
    ws = FakeWs({("GET", "/api/3.0/rfa/destinations/catalog/main"): empty,
                 ("GET", f"/api/3.0/rfa/destinations/schema/{quote('main.s', safe='')}"): empty,
                 ("GET", f"/api/3.0/rfa/destinations/table/{quote('main.s.orders', safe='')}"): empty})
    got = shell_core.rfa_send(ws, WHO, GRANTS)
    assert {k: v for k, v in got.items() if k != "links"} == {"sent": False, "destinations": [], "reason": shell_core.RFA_NO_DESTINATION}
    assert ws.posts() == []


def test_a_grantee_no_directory_entry_names_is_copy_only_with_its_reason():
    ws = FakeWs({**DESTS,
                 ("GET", "/api/2.0/preview/scim/v2/Users", 'userName eq "ghost"'): {"Resources": []},
                 ("GET", "/api/2.0/preview/scim/v2/Groups", 'displayName eq "ghost"'): {"Resources": []}})
    got = shell_core.rfa_check(ws, WHO, ["GRANT SELECT ON TABLE `main`.`s`.`orders` TO `ghost`"])
    assert got["offered"] is False and got["reason"] == shell_core.RFA_NO_PRINCIPAL
    assert ws.posts() == []


def test_a_refused_send_gives_the_workspace_reason():
    ws = FakeWs({**DESTS, ("POST", "/api/3.0/rfa/requests"): RuntimeError("PERMISSION_DENIED: you cannot request this securable")})
    got = shell_core.rfa_send(ws, WHO, GRANTS)
    assert {k: v for k, v in got.items() if k != "links"} == {"sent": False, "destinations": [], "reason": "PERMISSION_DENIED: you cannot request this securable"}


def test_the_route_reads_the_grants_on_the_server_and_answers_the_offer_as_the_viewer(tmp_path):
    s, _sp, _user, _made = shell(tmp_path, pages=[reading_page()])
    ws = FakeWs(dict(DESTS))
    s.user_factory = lambda host, token: ws
    s.access_found = lambda headers: {"tables": [{"table": "main.s.orders", "grants": GRANTS}]}
    status, body = call(s, "POST", "access-request/check", headers={"x-forwarded-email": WHO, "x-forwarded-access-token": "viewer-token"}, body={})
    assert status == 200, (status, body)
    assert {k: v for k, v in body.items() if k != "links"} == {"offered": True, "destinations": ["owner@example.com"], "reason": ""}
    assert ws.posts() == []


def test_the_send_route_is_a_write_and_names_no_grant_from_the_client(tmp_path):
    assert shell_core.is_write_route("POST", "access-request") and not shell_core.is_write_route("POST", "access-request/check")
    s, _sp, _user, _made = shell(tmp_path, pages=[reading_page()])
    ws = FakeWs({**DESTS, ("POST", "/api/3.0/rfa/requests"): {}})
    s.user_factory = lambda host, token: ws
    s.access_found = lambda headers: {"tables": []}
    status, body = call(s, "POST", "access-request", headers={"x-forwarded-email": WHO, "x-forwarded-access-token": "viewer-token"},
                        body={"statements": ["GRANT SELECT ON TABLE `evil`.`x`.`y` TO `me`"]})
    assert status == 200, (status, body)
    assert {k: v for k, v in body.items() if k != "links"} == {"sent": False, "destinations": [], "reason": shell_core.RFA_NO_GRANT}
    assert ws.posts() == []


def test_REQ315_a_table_with_no_destination_of_its_own_falls_back_to_its_schema_then_its_catalog():
    empty = {}
    ws = FakeWs({("GET", f"/api/3.0/rfa/destinations/table/{quote('main.s.orders', safe='')}"): empty,
                 ("GET", f"/api/3.0/rfa/destinations/schema/{quote('main.s', safe='')}"): empty,
                 ("GET", "/api/3.0/rfa/destinations/catalog/main"): OWNER})
    got = shell_core.rfa_check(ws, WHO, [GRANTS[2]])
    assert got["offered"] is True and got["destinations"] == ["owner@example.com"]
    # REQ-518: the table read asks on the table, so the chain starts at the table, then the schema, then the catalog.
    assert [c["path"] for c in ws.calls] == [f"/api/3.0/rfa/destinations/table/{quote('main.s.orders', safe='')}",
                                             f"/api/3.0/rfa/destinations/schema/{quote('main.s', safe='')}",
                                             "/api/3.0/rfa/destinations/catalog/main"]
