"""SEC-01 AT9 (W6, CUJ3): the MVP App checks, with the viewer's own token, that the viewer can read every source table before it
serves any data. A viewer without SELECT on one source gets 403 from every data endpoint, with a table-level Request for Access
payload naming only that table (request: "person", the permissions entry the access dialog already shows), and no data. With
SELECT, the same endpoints answer 200.

Seam: shell_core.Shell, the existing access dialog (access_found / write_refusal). The source tables are the `sources` list the
Build writes into inspire_app.json."""
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
GRANT = f"GRANT SELECT ON TABLE `main`.`pricing`.`loss_trend` TO `{VIEWER}`"
PAGE_ID = PAGE["id"]
DATA_ENDPOINTS = [
    ("POST", "page", None, {"page": PAGE_ID, "filters": {}}),
    ("GET", "filters", {"page": PAGE_ID}, None),
    ("GET", "filters/options", {"page": PAGE_ID, "filter": "category", "q": "mu"}, None),
    ("GET", "defaults", {"page": PAGE_ID}, None),
    ("POST", "records", None, {"page": PAGE_ID, "filters": {}}),
    ("GET", "freshness", {"page": PAGE_ID}, None),
    ("GET", "summary", {"page": PAGE_ID}, None),
]


class Viewer(FakeWorkspace):
    """The viewer's own workspace client: it cannot read LOCKED unless `reads` is set."""

    def __init__(self, reads):
        super().__init__()
        self.reads = reads

    def run_sql(self, warehouse, sql, params, limit=5000):
        if LOCKED in sql.replace("`", "") and not self.reads:
            self.sql.append((sql, params, limit))
            raise shell_db.QueryError(f"PERMISSION_DENIED: User does not have SELECT on Table '{LOCKED}'")
        return super().run_sql(warehouse, sql, params, limit)


def viewer_shell(tmp_path, reads):
    sp, viewer, made = FakeWorkspace(), Viewer(reads), []

    def user_factory(host, token):
        made.append(token)
        return viewer

    settings = dict(copy.deepcopy(SETTINGS), sources=[LOCKED, OPEN])
    s = shell_core.Shell(app_dir(tmp_path, settings), env=dict(ENV), sp_factory=lambda: sp, user_factory=user_factory)
    return s, sp, viewer, made


def statements_of(out):
    return [sql for entry in (out.get("permissions") or []) if isinstance(entry, dict) for sql in entry.get("statements") or []]


def test_AT9_a_viewer_without_select_on_one_source_gets_403_with_a_table_level_rfa_from_every_data_endpoint(tmp_path):
    for method, path, query, body in DATA_ENDPOINTS:
        sub = tmp_path / path.replace("/", "_")
        sub.mkdir()
        s, sp, _viewer, made = viewer_shell(sub, reads=False)
        status, out = call(s, method, path, query, HEADERS, body)
        assert status == 403, (f"AT9: Not implemented: {method} {path} answered {status}, not 403, to a viewer who cannot read {LOCKED} "
                               f"(no viewer read check before data endpoints): {str(out)[:300]}")
        assert out.get("request") == "person", f"AT9: {path}: the RfA is for the viewer: {out}"
        statements = statements_of(out)
        assert GRANT in statements, f"AT9: {path}: a table-level grant naming {LOCKED} for the viewer: {statements}"
        assert not [x for x in statements if "SELECT ON SCHEMA" in x or "SELECT ON CATALOG" in x], f"AT9: {path}: table level only: {statements}"
        assert not [x for x in statements if "loss_desk_out" in x], f"AT9: {path}: only the table the viewer cannot read is named: {statements}"
        assert not any(out.get(k) for k in ("rows", "kpis", "charts", "options", "values")), f"AT9: {path}: no data is served: {out}"
        assert all("LIMIT 0" in sql for sql, _p, _l in sp.sql), f"AT9: {path}: the App ran data SQL before the check passed: {sp.sql}"
        assert "tok-viewer" in made, f"AT9: {path}: the check runs with the viewer's token"


def test_AT9_with_select_on_every_source_the_data_endpoints_answer_200(tmp_path):
    for method, path, query, body in DATA_ENDPOINTS[:2]:
        sub = tmp_path / path.replace("/", "_")
        sub.mkdir()
        s, _sp, viewer, made = viewer_shell(sub, reads=True)
        status, out = call(s, method, path, query, HEADERS, body)
        assert status == 200, f"{path}: {str(out)[:300]}"
        assert "permissions" not in out, f"{path}: no dialog once the viewer can read: {out}"
        assert "tok-viewer" in made and any("LIMIT 0" in sql for sql, _p, _l in viewer.sql), \
            f"AT9: Not implemented: {path}: no read check ran with the viewer's token (W6): {viewer.sql}"
