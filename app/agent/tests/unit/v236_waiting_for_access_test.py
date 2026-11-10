import json

from v141_app_shell_test import PAGE, call, shell
import shell_db
import shell_core


DENIED = "[INSUFFICIENT_PERMISSIONS] Insufficient privileges: User does not have SELECT on Table 'main.s.orders'."


def refusing(name):
    def raise_denied(*args, **kwargs):
        raise shell_db.QueryError(DENIED)
    return raise_denied


def test_a_data_route_the_App_cannot_read_answers_a_typed_waiting_state_not_a_502(tmp_path):
    s, _sp_ws, _user_ws, _made = shell(tmp_path)
    s.overview = refusing("overview")
    status, body = call(s, "POST", "overview", {}, body={"page": PAGE["id"]})
    assert status == 200, (status, body)
    assert body["state"] == "waiting_for_access"
    assert body["tables"] == ["main.s.orders"]
    assert body["message"] == shell_core.WAITING_FOR_ACCESS
    assert "@" not in json.dumps(body["message"])
    assert "GRANT" not in body["message"], "the GRANT is under detail, never in the friendly message"


def test_only_the_App_data_routes_turn_a_refusal_into_the_waiting_state(tmp_path):
    s, _sp_ws, _user_ws, _made = shell(tmp_path)
    s.runs = refusing("runs")
    status, body = call(s, "GET", "runs", {"page": PAGE["id"]})
    assert status == 502 and "error" in body
    assert ("GET", "runs") not in shell_core.WAITING_FOR_ACCESS_ROUTES
