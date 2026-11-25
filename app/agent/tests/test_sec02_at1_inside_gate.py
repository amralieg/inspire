"""SEC-02 AT1-shell (F1, F8, warehouse RfA, empty sources; REQ-518): the MVP App viewer gate SEC-01 built (viewer_gate) also runs when the
page is served inside Inspire (settings host "inspire"). A viewer who cannot read every source table gets 403 from every data endpoint and
from Genie, before the App says anything about its pages. An empty `sources` list fails closed. A warehouse refusal is not a table refusal:
it names the warehouse and asks for no GRANT SELECT.

Seam: shell_core.Shell.handle (GET app, viewer_gate, VIEWER_CHECK_EXEMPT)."""
import copy
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
UNIT = os.path.join(HERE, "unit")
SERVER = os.path.join(os.path.dirname(HERE), "agent", "app_shell", "server")
for path in (UNIT, SERVER):
    if path not in sys.path:
        sys.path.insert(0, path)

import shell_core  # noqa: E402
import shell_db  # noqa: E402
from v141_app_shell_test import PAGE, SETTINGS, FakeWorkspace, app_dir, call  # noqa: E402

LOCKED = "main.pricing.loss_trend"
OPEN = "main.pricing.loss_desk_out"
VIEWER = "ana@example.com"
HEADERS = {"x-forwarded-access-token": "tok-viewer", "x-forwarded-email": VIEWER}
ENV = {"DATABRICKS_WAREHOUSE_ID": "wh1", "DATABRICKS_HOST": "dbc-1.example.com", "DATABRICKS_CLIENT_ID": "sp-1"}
PAGE_ID = PAGE["id"]
DATA_ENDPOINTS = [
    ("POST", "page", None, {"page": PAGE_ID, "filters": {}}),
    ("GET", "filters", {"page": PAGE_ID}, None),
    ("GET", "filters/options", {"page": PAGE_ID, "filter": "category", "q": "mu"}, None),
    ("GET", "defaults", {"page": PAGE_ID}, None),
    ("POST", "records", None, {"page": PAGE_ID, "filters": {}}),
    ("GET", "freshness", {"page": PAGE_ID}, None),
    ("GET", "summary", {"page": PAGE_ID}, None),
    ("POST", "genie/ask", None, {"page": PAGE_ID, "question": "why did it fall?"}),
]
WAREHOUSE_REFUSAL = "PERMISSION_DENIED: User does not have CAN_USE on warehouse wh1."


class Viewer(FakeWorkspace):
    """The viewer's own client: LOCKED is unreadable unless `reads`; `refusal` makes every probe fail with that text instead."""

    def __init__(self, reads, refusal=None):
        super().__init__()
        self.reads, self.refusal = reads, refusal

    def run_sql(self, warehouse, sql, params, limit=5000):
        if self.refusal:
            self.sql.append((sql, params, limit))
            raise shell_db.QueryError(self.refusal)
        if LOCKED in sql.replace("`", "") and not self.reads:
            self.sql.append((sql, params, limit))
            raise shell_db.QueryError(f"PERMISSION_DENIED: User does not have SELECT on Table '{LOCKED}'")
        return super().run_sql(warehouse, sql, params, limit)


def inside_shell(tmp_path, reads, sources=(LOCKED, OPEN), host="inspire", refusal=None):
    sp, viewer = FakeWorkspace(), Viewer(reads, refusal)
    settings = dict(copy.deepcopy(SETTINGS), sources=list(sources))
    if host:
        settings["host"] = host
    s = shell_core.Shell(app_dir(tmp_path, settings), env=dict(ENV), sp_factory=lambda: sp, user_factory=lambda host, token: viewer)
    return s, sp, viewer


def statements_of(out):
    return [sql for entry in (out.get("permissions") or []) if isinstance(entry, dict) for sql in entry.get("statements") or []]


def test_AT1_inside_inspire_a_viewer_without_select_gets_403_from_every_data_endpoint_and_genie(tmp_path):
    for method, path, query, body in DATA_ENDPOINTS:
        sub = tmp_path / path.replace("/", "_")
        sub.mkdir()
        s, sp, _viewer = inside_shell(sub, reads=False)
        status, out = call(s, method, path, query, HEADERS, body)
        assert status == 403, (f"AT1: Not implemented: inside Inspire, {method} {path} answered {status}, not 403, to a viewer who cannot read "
                               f"{LOCKED} (viewer_gate returns None when self.inside): {str(out)[:300]}")
        assert out.get("request") == "person", f"AT1: {path}: the RfA is for the viewer: {out}"
        assert out.get("tables") == [LOCKED], f"AT1: {path}: the RfA names only the unreadable table: {out}"
        assert sp.sql == [] and sp.genie == [], f"AT1: {path}: the App ran nothing for the refused viewer: {sp.sql[:2]} {sp.genie[:2]}"


def test_AT1_an_empty_sources_list_fails_closed_inside_and_outside_inspire(tmp_path):
    for host in ("inspire", None):
        sub = tmp_path / f"host_{host}"
        sub.mkdir()
        s, sp, _viewer = inside_shell(sub, reads=True, sources=(), host=host)
        status, out = call(s, "POST", "page", None, HEADERS, {"page": PAGE_ID, "filters": {}})
        assert status == 403, (f"AT1: Not implemented: host={host}: an App with no `sources` serves data unchecked (answered {status}): "
                               f"{str(out)[:300]}")
        assert sp.sql == [], f"AT1: host={host}: no query ran for an App whose sources are unknown: {sp.sql[:2]}"


def test_AT1_get_app_answers_403_with_the_rfa_before_any_page_metadata(tmp_path):
    s, _sp, _viewer = inside_shell(tmp_path, reads=False)
    status, out = call(s, "GET", "app", None, HEADERS, None)
    text = str(out)
    assert status == 403, f"AT1: Not implemented: GET app answers {status} before the viewer gate runs: {text[:300]}"
    assert out.get("request") == "person", f"AT1: GET app refusal is the viewer's RfA: {text[:300]}"
    for leak in (PAGE_ID, SETTINGS["title"], SETTINGS["subtitle"]):
        assert leak not in text, f"AT1: GET app refusal carries no page metadata ({leak!r}): {text[:300]}"


def test_AT1_a_warehouse_refusal_names_the_warehouse_and_asks_for_no_table_grant(tmp_path):
    s, _sp, _viewer = inside_shell(tmp_path, reads=True, host=None, refusal=WAREHOUSE_REFUSAL)
    status, out = call(s, "POST", "page", None, HEADERS, {"page": PAGE_ID, "filters": {}})
    statements = statements_of(out)
    assert status == 403, f"AT1: a probe the warehouse refuses still refuses the data: {status} {str(out)[:300]}"
    assert not [g for g in statements if "GRANT SELECT" in g], (
        f"AT1: Not implemented: a warehouse CAN_USE refusal is shown as a missing table read (NO_ACCESS matches PERMISSION_DENIED): {statements}")
    assert "wh1" in str(out) and "warehouse" in str(out).lower(), f"AT1: the refusal names the warehouse: {str(out)[:300]}"


def test_AT1_CUJ3_control_a_viewer_with_select_opens_the_page_inside_and_outside_inspire(tmp_path):
    for host in ("inspire", None):
        sub = tmp_path / f"ok_{host}"
        sub.mkdir()
        s, _sp, _viewer = inside_shell(sub, reads=True, host=host)
        for method, path, query, body in (("GET", "app", None, None), ("POST", "page", None, {"page": PAGE_ID, "filters": {}})):
            status, out = call(s, method, path, query, HEADERS, body)
            assert status == 200, f"host={host} {method} {path}: {str(out)[:300]}"


def test_AT1_CUJ3_control_outside_inspire_the_sec01_gate_still_refuses(tmp_path):
    s, _sp, _viewer = inside_shell(tmp_path, reads=False, host=None)
    status, out = call(s, "POST", "page", None, HEADERS, {"page": PAGE_ID, "filters": {}})
    assert status == 403 and out.get("tables") == [LOCKED], str(out)[:300]
