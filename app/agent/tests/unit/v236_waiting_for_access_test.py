import json
import pathlib
import re

from v141_app_shell_test import PAGE, call, shell
import shell_db
import shell_core


DENIED = "[INSUFFICIENT_PERMISSIONS] Insufficient privileges: User does not have SELECT on Table 'main.s.orders'."
SHELL_SOURCE = pathlib.Path(shell_core.__file__).read_text(encoding="utf-8")
WORKSPACE_READS = ("run_sql", "call", "genie_ask", "genie_message")


def refusing(*args, **kwargs):
    raise shell_db.QueryError(DENIED)


def read_routes() -> list:
    found = set(re.findall(r'route == \("(GET|POST)", "([^"]+)"\)', SHELL_SOURCE))
    return sorted((m, n) for m, n in found if not shell_core.is_write_route(m, n))


def strip_compare(node):
    if isinstance(node, dict):
        node.pop("compare", None)
        for value in node.values():
            strip_compare(value)
    elif isinstance(node, list):
        for value in node:
            strip_compare(value)
    return node


def reading_page():
    page = strip_compare(json.loads(json.dumps(PAGE)))
    page["result_table"] = "main.inspire.n01_u05_out"
    return page


def refused_shell(tmp_path):
    s, sp_ws, user_ws, _made = shell(tmp_path, pages=[reading_page()])
    for ws in (sp_ws, user_ws):
        for name in WORKSPACE_READS:
            setattr(ws, name, refusing)
    return s


def test_a_data_route_the_App_cannot_read_answers_a_typed_waiting_state_not_a_502(tmp_path):
    s = refused_shell(tmp_path)
    s.overview = refusing
    status, body = call(s, "POST", "overview", {}, body={"page": PAGE["id"]})
    assert status == 200, (status, body)
    assert body["state"] == "waiting_for_access"
    assert body["tables"] == ["main.s.orders"]
    assert body["message"] == shell_core.WAITING_FOR_ACCESS
    assert "GRANT" not in body["message"] and "@" not in body["message"]


def test_every_read_route_answers_the_waiting_state_under_a_refusal_never_a_502(tmp_path):
    s = refused_shell(tmp_path)
    routes = read_routes()
    assert len(routes) >= 30, routes
    waiting = []
    for method, name in routes:
        body = json.dumps({"page": PAGE["id"]}).encode() if method == "POST" else b""
        status, answer = s.handle(method, name, {"page": PAGE["id"]}, {}, body)
        assert status != 502, (method, name, answer)
        if status == 200 and isinstance(answer, dict) and answer.get("state") == "waiting_for_access":
            waiting.append((method, name))
    assert {n for _m, n in waiting} >= {"overview", "summary", "trends", "money", "impact", "records/fields", "records/batches", "page", "defaults", "runs", "filters"}, waiting


def test_writes_keep_their_current_refusal_and_non_permission_errors_stay_502(tmp_path):
    s, _sp_ws, _user_ws, _made = shell(tmp_path)
    assert shell_core.is_write_route("POST", "records/edit") and shell_core.is_write_route("POST", "alerts/save")
    assert not shell_core.is_write_route("GET", "runs") and not shell_core.is_write_route("POST", "page")

    def broken(*args, **kwargs):
        raise shell_db.QueryError("warehouse stopped")
    s.runs = broken
    status, body = call(s, "GET", "runs", {"page": PAGE["id"]})
    assert status == 502 and "error" in body


def test_a_page_body_with_a_per_card_no_access_becomes_the_waiting_state_even_beside_data(tmp_path):
    s, _sp_ws, _user_ws, _made = shell(tmp_path, pages=[reading_page()])
    s.settings["unread_owners"] = {"main.s.orders": "data-eng", "main.s.other": "a@example.com"}
    s.settings["unread"] = {"main.s.orders": ["GRANT SELECT ON TABLE `main`.`s`.`orders` TO `app-sp`"]}
    partial = {"kpis": {"k1": {"value": 4}}, "charts": {}, "tables": {}, "errors": {"chart:pareto": "No access to main.s.orders"}}
    s.page_data = lambda *args, **kwargs: partial
    status, body = s.handle("POST", "page", {}, {}, b'{"page": "%s"}' % PAGE["id"].encode())
    assert status == 200, (status, body)
    assert body["state"] == "waiting_for_access", "the card text is replaced by the one waiting view, not shown beside the data"
    assert body["owners"] == ["data-eng"], "the owner is the one who can grant it, never an email address"
    assert "kpis" not in body and "@" not in json.dumps(body)


def test_a_card_text_on_a_route_outside_the_card_routes_keeps_its_data(tmp_path):
    s, _sp_ws, _user_ws, _made = shell(tmp_path, pages=[reading_page()])
    partial = {"kpis": {"k1": {"value": 4}}, "errors": {"chart:pareto": "No access to main.s.orders"}}
    s.overview = lambda *args, **kwargs: partial
    status, body = s.handle("POST", "overview", {}, {}, b'{"page": "%s"}' % PAGE["id"].encode())
    assert status == 200 and body.get("kpis") == {"k1": {"value": 4}}, "the overview keeps its readable cards (existing contract)"
