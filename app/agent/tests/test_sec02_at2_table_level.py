"""SEC-02 AT2-shell (F9; REQ-518): a read refusal in the MVP App asks for SELECT on the tables named, never on the whole schema or catalog.
REQ-408 collapsed read grants to the schema (coarse_grants); under REQ-518 that over-grants every other table of the schema, so the copy
text, the Request for Access payload and the write-refusal dialog stay table level. USE CATALOG and USE SCHEMA stay.

Seam: shell_core.coarse_grants via rfa_requests, Shell.write_refusal and Shell.access_found."""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
UNIT = os.path.join(HERE, "unit")
SERVER = os.path.join(os.path.dirname(HERE), "agent", "app_shell", "server")
for path in (UNIT, SERVER):
    if path not in sys.path:
        sys.path.insert(0, path)

import shell_core  # noqa: E402
from v141_app_shell_test import SETTINGS, FakeWorkspace, app_dir  # noqa: E402

WHO = "ana@example.com"
TABLES = ["main.pricing.loss_trend", "main.pricing.loss_desk_out"]
WIDE = re.compile(r"\b(SELECT|READ METADATA) ON (SCHEMA|CATALOG)\b", re.I)


def grants():
    return [g for t in TABLES for g in shell_core.access_grants(t, WHO)]


def test_AT2_the_copy_text_names_select_per_table_never_on_the_schema():
    out = shell_core.coarse_grants(grants())
    assert [g for g in out if WIDE.search(g)] == [], f"AT2: Not implemented: a read refusal asks for a schema-wide read grant: {out}"
    for table in TABLES:
        c, s, t = table.split(".")
        assert f"GRANT SELECT ON TABLE `{c}`.`{s}`.`{t}` TO `{WHO}`" in out, f"AT2: the table grant stays: {out}"
    assert f"GRANT USE SCHEMA ON SCHEMA `main`.`pricing` TO `{WHO}`" in out, f"AT2: USE SCHEMA stays, once: {out}"


def test_AT2_the_rfa_payload_asks_on_the_table_securables():
    reqs = shell_core.rfa_requests(grants())
    wide = [r for r in reqs if r["securable"]["type"] in ("SCHEMA", "CATALOG") and set(r["permissions"]) & {"SELECT", "READ_METADATA"}]
    assert wide == [], f"AT2: Not implemented: the Request for Access asks SELECT on a schema or catalog: {wide}"
    tables = sorted(r["securable"]["full_name"] for r in reqs if r["securable"]["type"] == "TABLE" and "SELECT" in r["permissions"])
    assert tables == sorted(TABLES), f"AT2: the RfA names each table: {reqs}"


def test_AT2_the_write_refusal_dialog_stays_table_level(tmp_path):
    s = shell_core.Shell(app_dir(tmp_path, dict(SETTINGS)), env={"DATABRICKS_WAREHOUSE_ID": "wh1", "DATABRICKS_HOST": "dbc-1.example.com"},
                         sp_factory=FakeWorkspace, user_factory=lambda host, token: FakeWorkspace())
    body = s.write_refusal({"x-forwarded-email": WHO}, f"PERMISSION_DENIED: User does not have SELECT on Table '{TABLES[0]}'")
    statements = [g for e in body.get("permissions") or [] for g in e.get("statements") or []]
    assert statements, f"AT2: the dialog offers grants: {body}"
    assert [g for g in statements if WIDE.search(g)] == [], f"AT2: Not implemented: the write-refusal dialog asks SELECT ON SCHEMA: {statements}"


def test_AT2_control_write_grants_and_non_uc_lines_pass_through_unchanged():
    lines = [f"GRANT MODIFY ON TABLE `main`.`pricing`.`loss_trend` TO `{WHO}`", "Ask the workspace admin for CAN USE on the warehouse"]
    assert shell_core.coarse_grants(lines) == lines
