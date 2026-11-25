"""REQ-313, REQ-314: an App read that the person cannot read answers the waiting state (the Permission Required path), and a write
that the warehouse refuses answers 403, never a 502 gateway failure. A failure that is not a refusal keeps its status."""
import json

from v141_app_shell_test import PAGE, call
from v236_waiting_for_access_test import refused_shell

import shell_db  # noqa: E402  (v141 puts the App shell server on sys.path)

DENIED = "[INSUFFICIENT_PERMISSIONS] Insufficient privileges: User does not have SELECT on Table 'main.s.orders'."


def refusing_http(*args, **kwargs):
    raise shell_db.HttpError(403, f"you cannot read main.s.orders in Unity Catalog ({DENIED})")


def failing_query(*args, **kwargs):
    raise shell_db.QueryError("SQL failed: syntax error at or near 'FROM'")


def test_a_read_refused_with_a_403_answers_the_waiting_state_not_plain_text(tmp_path):
    s = refused_shell(tmp_path)
    s.overview = refusing_http
    status, body = call(s, "POST", "overview", {}, body={"page": PAGE["id"]})
    assert status == 200, (status, body)
    assert body["state"] == "waiting_for_access"
    assert body["tables"] == ["main.s.orders"]


def test_a_write_the_warehouse_refuses_answers_403_not_502(tmp_path):
    s = refused_shell(tmp_path)
    s.record_act = lambda headers, data: (_ for _ in ()).throw(shell_db.QueryError(DENIED))
    status, body = call(s, "POST", "records/act", {}, body={"page": PAGE["id"]})
    assert status == 403, (status, body)
    assert "main.s.orders" in json.dumps(body)


def test_a_read_failure_that_is_not_a_refusal_still_answers_502_with_no_waiting_state(tmp_path):
    s = refused_shell(tmp_path)
    s.overview = failing_query
    status, body = call(s, "POST", "overview", {}, body={"page": PAGE["id"]})
    assert status == 502, (status, body)
    assert body.get("state") != "waiting_for_access"


def test_a_write_failure_that_is_not_a_refusal_still_answers_502(tmp_path):
    s = refused_shell(tmp_path)
    s.record_act = lambda headers, data: (_ for _ in ()).throw(shell_db.QueryError("SQL failed: syntax error at or near 'FROM'"))
    status, body = call(s, "POST", "records/act", {}, body={"page": PAGE["id"]})
    assert status == 502, (status, body)


def test_a_write_refusal_carries_the_waiting_state_and_the_grants_the_person_copies(tmp_path):
    s = refused_shell(tmp_path)
    s.record_act = lambda headers, data: (_ for _ in ()).throw(shell_db.QueryError(DENIED))
    status, body = call(s, "POST", "records/act", {}, {"x-forwarded-email": "amr@example.com"}, body={"page": PAGE["id"]})
    assert status == 403, (status, body)
    assert body["state"] == "waiting_for_access" and body["tables"] == ["main.s.orders"]
    grants = [g for p in body["permissions"] for g in p["statements"]]
    assert "GRANT SELECT ON TABLE `main`.`s`.`orders` TO `amr@example.com`" in grants  # REQ-518: the dialog asks at table level
    assert body["permissions"][0]["principal"] == "amr@example.com"


def test_a_write_refusal_with_no_signed_in_person_still_waits_but_names_no_grantee(tmp_path):
    s = refused_shell(tmp_path)
    s.record_act = lambda headers, data: (_ for _ in ()).throw(shell_db.QueryError(DENIED))
    status, body = call(s, "POST", "records/act", {}, body={"page": PAGE["id"]})
    assert status == 403 and body["state"] == "waiting_for_access"
    assert "permissions" not in body, "no blank grantee is ever written"
