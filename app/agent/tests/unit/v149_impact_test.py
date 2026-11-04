import ast
import inspect
import json
import os
import re
import sqlite3
import sys
import threading
import zlib

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_alerts
import shell_core
import shell_db
import shell_pg
import shell_sql
from _agentload import agent_source
from v141_app_shell_test import SETTINGS, app_dir, call
from v148_app_hub_test import COLUMNS as HUB_COLUMNS, ROWS as HUB_ROWS, TODAY, TYPES as MONEY_TYPES, hub_page, to_sqlite
from v149_app_money_test import EXPRESSION, FIELD_TYPES, FORMULA, MONEY_COLUMNS, OWNER, MoneyWorkspace, _shell as money_shell
from v120_artifacts_support import FakeSpark
from v140_implement_test import ALERT, _alert_inspire, _output_context, _spec
from v145_lakebase_test import postgres  # noqa: F401

sqlglot = pytest.importorskip("sqlglot")

TABLE = "main.pricing.loss_desk_out"
PERSON = "@".join(["pat.lee", "example.com"])
CLOSE = ("realized_value", "realized_note", "held_back", "run_tier")
COLUMNS = HUB_COLUMNS + tuple(c for c in CLOSE if c not in HUB_COLUMNS)
TYPES = {"entity_id": "STRING", "rank": "INT", "value_at_stake": "DOUBLE", "action_due": "DATE", "as_of_date": "DATE", "valid_from": "TIMESTAMP",
         "valid_to": "TIMESTAMP", "is_current": "BOOLEAN", "realized_value": "DOUBLE", "held_back": "BOOLEAN", "snooze_until": "DATE",
         "joined_at": "TIMESTAMP"}
RUNS = {"r0": "2026-09-15", "r1": "2026-09-29", "r2": "2026-10-06", "r3": "2026-10-13", "r4": "2026-10-20"}


def v(key, tier, stake, run, at=None, source="run", current=True, ends=None, **values):
    row = dict.fromkeys(COLUMNS)
    row.update(record_key=key, entity_id=key, entity_label=f"Item {key}", priority_tier=tier, rank=1, category="A", value_at_stake=stake,
               use_case_id="N01-U05", run_id=run, as_of_date=RUNS[run], valid_from=at or f"{RUNS[run]} 06:00:00", valid_to=ends,
               is_current=1 if current else 0, change_source=source, changed_by=f"run {run}" if source == "run" else PERSON)
    row.update(values)
    return row


ROWS = [
    v("a1", "Act now", 1000.0, "r4", held_back=0, run_tier="Act now"),
    v("a2", "Review", 300.0, "r4", action_status="In progress", held_back=0, run_tier="Review"),
    v("a3", "Held back", 500.0, "r4", held_back=1, run_tier="Act now", action_due="2026-10-30"),
    v("f1", "Act now", 1200.0, "r1", current=False, ends="2026-10-02 10:00:00"),
    v("f1", "Act now", 1200.0, "r1", at="2026-10-02 10:00:00", source="action", current=False, ends="2026-10-06 06:00:00", action_status="Done"),
    v("f1", "Monitor", 100.0, "r2", current=False, ends="2026-10-07 09:00:00", action_status="Done", action_outcome="Resolved"),
    v("f1", "Monitor", 100.0, "r2", at="2026-10-07 09:00:00", source="action", current=False, ends="2026-10-20 06:00:00", action_status="Done",
      action_outcome="Resolved", realized_value=900.0, realized_note="Repriced"),
    v("f1", "Monitor", 100.0, "r4", action_status="Done", action_outcome="Resolved", realized_value=900.0, realized_note="Repriced", held_back=0,
      run_tier="Monitor"),
    v("f2", "Act now", 700.0, "r0", current=False, ends="2026-09-20 08:00:00"),
    v("f2", "Act now", 700.0, "r0", at="2026-09-20 08:00:00", source="action", current=False, ends="2026-10-06 06:00:00", action_status="Done"),
    v("f3", "Act now", 400.0, "r2", current=False, ends="2026-10-08 11:00:00"),
    v("f3", "Act now", 400.0, "r2", at="2026-10-08 11:00:00", source="action", current=False, ends="2026-10-20 06:00:00", action_status="Done"),
    v("f3", "Act now", 450.0, "r4", action_status="Done", action_outcome="Still flagged", held_back=0, run_tier="Act now"),
    v("f4", "Act now", 50.0, "r4", current=False, ends="2026-10-22 09:00:00", held_back=0, run_tier="Act now"),
    v("f4", "Act now", 50.0, "r4", at="2026-10-22 09:00:00", source="action", action_status="Done", held_back=0, run_tier="Act now"),
    v("c1", "Act now", 800.0, "r3", current=False, ends="2026-10-14 10:00:00", held_back=0, run_tier="Act now"),
    v("c1", "Act now", 800.0, "r3", at="2026-10-14 10:00:00", source="action", current=False, ends="2026-10-20 06:00:00",
      action_status="Could not fix", held_back=0, run_tier="Act now"),
    v("c1", "Monitor", 0.0, "r4", action_status="Could not fix", action_outcome="Resolved", held_back=0, run_tier="Monitor"),
    v("d1", "Act now", 2000.0, "r1", current=False, ends="2026-10-05 09:00:00"),
    v("d1", "Act now", 2000.0, "r1", at="2026-10-05 09:00:00", source="action", action_status="Dismissed", dismiss_reason="The store closed"),
    v("d2", "Review", 90.0, "r2", current=False, ends="2026-10-09 09:00:00"),
    v("d2", "Review", 90.0, "r2", at="2026-10-09 09:00:00", source="action", action_status="Dismissed", dismiss_reason=" The store closed "),
    v("d3", "Review", 60.0, "r1", current=False, ends="2026-09-30 09:00:00"),
    v("d3", "Review", 60.0, "r1", at="2026-09-30 09:00:00", source="action", action_status="Dismissed", dismiss_reason="Known issue"),
    v("r1", "Act now", 250.0, "r2", current=False, ends="2026-10-07 10:00:00"),
    v("r1", "Act now", 250.0, "r2", at="2026-10-07 10:00:00", source="action", current=False, ends="2026-10-08 10:00:00", action_status="Done"),
    v("r1", "Act now", 250.0, "r2", at="2026-10-08 10:00:00", source="action", action_status="In progress"),
    v("x1", "Act now", 9000.0, "r1", current=False, ends="2026-10-03 10:00:00"),
    v("x1", "Act now", 9000.0, "r1", at="2026-10-03 10:00:00", source="action", current=False, ends="2026-10-04 10:00:00", action_status="Done"),
    v("x1", "Act now", 9000.0, "r1", at="2026-10-04 10:00:00", source="delete", action_status="Done"),
    v("h1", "Held back", 600.0, "r3", current=False, ends="2026-10-20 06:00:00", held_back=1, run_tier="Act now"),
    v("h1", "Monitor", 100.0, "r4", held_back=1, run_tier="Monitor"),
    v("h2", "Held back", 700.0, "r4", held_back=1, run_tier="Act now"),
    v("s1", "Act now", 300.0, "r3", current=False, ends="2026-10-20 06:00:00", held_back=0, run_tier="Act now"),
    v("s1", "Monitor", 20.0, "r4", held_back=0, run_tier="Monitor"),
    v("s2", "Review", 200.0, "r3", current=False, ends="2026-10-20 06:00:00", held_back=0, run_tier="Review"),
]


def crc32(text):
    return zlib.crc32(str(text).encode("utf-8"))


class Workspace:
    def __init__(self, rows=None, columns=COLUMNS, fail=None):
        self.sql, self.fail, self.lock = [], dict(fail or {}), threading.Lock()
        self.db = sqlite3.connect(":memory:", check_same_thread=False)
        self.db.create_function("UNIX_MICROS", 1, lambda value: len(str(value)))
        self.db.create_function("CRC32", 1, crc32)
        self.db.create_function("FORMAT_NUMBER", 2, lambda n, d: None if n is None else f"{float(n):,.{int(d)}f}")
        self.db.execute(f'CREATE TABLE "loss_desk_out" ({", ".join(chr(34) + c + chr(34) for c in columns)})')
        self.db.executemany(f'INSERT INTO "loss_desk_out" VALUES ({", ".join("?" for _ in columns)})',
                            [tuple(r.get(c) for c in columns) for r in (ROWS if rows is None else rows)])

    def run_sql(self, warehouse, sql, params, limit=5000):
        with self.lock:
            self.sql.append((sql, params, limit))
        for marker, error in self.fail.items():
            if marker in sql:
                raise error
        with self.lock:
            try:
                cursor = self.db.execute(to_sqlite(sql), {p["name"]: p["value"] for p in params})
            except sqlite3.OperationalError as error:
                found = "TABLE_OR_VIEW_NOT_FOUND" if "no such table" in str(error) else "SQL_ERROR"
                raise shell_db.QueryError(f"[{found}] {error}") from error
            names = [c[0] for c in cursor.description]
            rows = [dict(zip(names, row)) for row in cursor.fetchall()]
        return {"columns": [{"name": n, "type": TYPES.get(n, "STRING"), "type_text": TYPES.get(n, "STRING")} for n in names],
                "rows": rows[:limit], "truncated": len(rows) > limit}

    def queries(self, marker):
        return [(sql, params) for sql, params, _limit in self.sql if marker in sql]


PROMISED = {"value": "The Pricing Manager recovers margin lost to standing discounts.", "benefits": ["Recover margin on discounted items"]}


def shell(tmp_path, ws=None, settings=None, page=None):
    page = page or hub_page(promised=PROMISED)
    tmp_path.mkdir(parents=True, exist_ok=True)
    s = shell_core.Shell(app_dir(tmp_path, dict(settings or SETTINGS, pages=[page["id"]]), [page]),
                         env={"DATABRICKS_WAREHOUSE_ID": "wh1", "DATABRICKS_HOST": "dbc-1.example.com"},
                         sp_factory=lambda: ws, user_factory=lambda host, token: ws, clock=lambda: TODAY)
    return s


def impact(s, page="n01_u05"):
    return call(s, "GET", "impact", query={"page": page}, headers={"x-forwarded-email": PERSON})


def test_the_impact_route_keeps_estimated_reported_and_measured_apart(tmp_path):
    ws = Workspace()
    status, out = impact(shell(tmp_path, ws))
    assert status == 200, out
    assert (out["tracked"], out["money"], out["holds"], out["since"]) == (True, True, True, "2026-10-01")
    assert "actions" not in out and "closing" not in out, "every result table keeps the actions and the amount a fix saved"
    assert out["promised"] == PROMISED, "the catalog's business value comes back next to what was delivered"
    assert out["estimated"] == {"Act now": {"n": 2, "money": 1250.0}, "Review": {"n": 1, "money": 300.0}}, \
        "estimated counts open flagged records only: never a fixed, dismissed, held back, deleted or Monitor one"
    assert out["reported"] == {"n": 1, "n_since": 1, "money": 900.0, "money_since": 900.0}
    assert out["measured"] == {"n": 2, "n_since": 2, "money": 1800.0, "money_since": 1800.0}, \
        "measured is the money at stake when fixed less what a later run still finds: 1200 - 100 for f1 and 700 - 0 for f2, which left"
    assert out["closed"] == {"Done": {"n": 4, "n_since": 3}, "Dismissed": {"n": 3, "n_since": 2}, "Could not fix": {"n": 1, "n_since": 1}}
    assert out["outcomes"] == {"left": 1, "missing": 0, "resolved": 1, "flagged": 1, "unchecked": 1}
    assert out["reasons"] == [{"reason": "The store closed", "n": 2}, {"reason": "Known issue", "n": 1}], "reasons are trimmed and grouped"
    assert out["current"] == {"records": 14, "held": 3}
    records = {r["key"]: r for r in out["records"]}
    assert [r["key"] for r in out["records"]][:2] == ["f1", "f2"] and set(records) == {"f1", "f2", "f3", "f4", "c1", "d1", "d2", "d3"}
    assert (records["f1"]["at_close"], records["f1"]["now"], records["f1"]["measured"], records["f1"]["reported"], records["f1"]["note"]) == \
        (1200.0, 100.0, 1100.0, 900.0, "Repriced")
    assert (records["f2"]["state"], records["f2"]["now"], records["f2"]["measured"]) == ("left", 0, 700.0)
    assert records["d2"]["reason"] == "The store closed" and records["f4"]["state"] == "unchecked"
    assert "x1" not in records and "r1" not in records, "a deleted record and a reopened one are not closed"
    (sql, params), = ws.queries("'estimated' AS `kind`")
    assert [p["value"] for p in params] == ["N01-U05", "2026-10-01"], "one statement scoped to the use case, its quarter as a parameter"


def test_could_not_fix_is_closed_and_checked_but_never_counted_as_measured(tmp_path):
    status, out = impact(shell(tmp_path, Workspace()))
    c1 = next(r for r in out["records"] if r["key"] == "c1")
    assert (status, c1["status"], c1["state"], c1["measured"]) == (200, "Could not fix", "resolved", None), \
        "a later run found it resolved, yet it was not fixed, so no money is credited"
    alone = [r for r in ROWS if r["record_key"] == "c1"]
    _status, only = impact(shell(tmp_path / "c1", Workspace(alone)))
    assert only["measured"]["n"] == 0 and only["measured"]["money"] is None and only["closed"]["Could not fix"]["n"] == 1


def test_a_fix_measures_from_its_closing_version_even_when_its_amount_is_entered_after_a_run(tmp_path):
    ws = Workspace()
    status, out = call(shell(tmp_path, ws), "POST", "overview", headers={"x-forwarded-email": PERSON}, body={})
    done = out["pages"]["n01_u05"]["done"]
    assert status == 200 and (done["fixed"], done["fixed_q"], done["dismissed"], done["dismissed_q"]) == (4, 3, 3, 2)
    assert (done["saved_n"], done["saved"], done["saved_q_n"], done["saved_q"]) == (2, 1800.0, 2, 1800.0), \
        ("f1's amount was entered after the run that resolved it; the saving still comes from the version that closed it (1200 at stake, "
         "100 left), dated by the first run that found it resolved")
    weeks = {w["week"]: w["saved"] for w in out["pages"]["n01_u05"]["weeks"]}
    assert {k: x for k, x in weeks.items() if x} == {"2026-10-05": 1800.0}


def test_a_held_back_record_never_reaches_the_overview_even_with_a_due_date(tmp_path):
    status, out = call(shell(tmp_path, Workspace()), "POST", "overview", headers={"x-forwarded-email": PERSON}, body={})
    keys = [i["key"] for i in out["pages"]["n01_u05"]["items"]]
    assert status == 200 and "a3" not in keys and "h2" not in keys, "held back records are never things to fix"
    assert {"a1", "a2", "r1"} <= set(keys)
    shown = [dict(r, held_back=0) if r["record_key"] == "a3" else r for r in ROWS]
    _status, out = call(shell(tmp_path / "shown", Workspace(shown)), "POST", "overview", headers={"x-forwarded-email": PERSON}, body={})
    assert "a3" in [i["key"] for i in out["pages"]["n01_u05"]["items"]], "the same record with a due date is listed once it is not held back"


def test_the_holdout_compares_the_flagged_records_shown_and_held_back(tmp_path):
    _status, out = impact(shell(tmp_path, Workspace()))
    assert out["holdout"] == {"shown": {"n": 7, "hits": 3}, "held": {"n": 3, "hits": 1}}, \
        "shown: a1 a2 f3 f4 c1 s1 s2, of which c1 s1 and s2 left or stopped being flagged; held: a3 h1 h2, of which h1"


def test_a_table_of_a_use_case_without_a_holdout_reads_its_impact_without_the_holdout_columns(tmp_path):
    hub = Workspace(HUB_ROWS, HUB_COLUMNS)
    status, out = impact(shell(tmp_path, hub))
    assert status == 200, out
    assert (out["holds"], out["holdout"], out["current"]["held"]) == (False, None, 0)
    assert out["measured"] == {"n": 2, "n_since": 1, "money": 1800.0, "money_since": 1100.0}
    assert not [sql for sql, _p in hub.queries("held_back")], "the holdout columns come only with the holdout, so they are never read without it"


def test_a_page_without_a_result_table_has_no_impact_and_runs_no_query(tmp_path):
    ws = Workspace()
    status, out = impact(shell(tmp_path, ws, page=dict(hub_page(promised=PROMISED), result_table=None)))
    assert (status, out) == (200, {"visible": True, "tracked": False, "note": "this page names no result table, so it has nothing to fix",
                                   "promised": PROMISED})
    assert ws.sql == []
    assert impact(shell(tmp_path / "b", ws), page="nope") == (404, {"error": "the App has no page 'nope'"})


def test_the_pre_deploy_check_names_a_failing_impact_page(tmp_path):
    ws = Workspace(fail={"'estimated' AS `kind`": shell_db.QueryError("[UNRESOLVED_COLUMN] realized_value")})
    problems = shell(tmp_path, ws).check({})
    assert "page n01_u05: the Impact page failed: [UNRESOLVED_COLUMN] realized_value" in problems


def test_the_impact_statement_runs_on_a_real_postgres(postgres, tmp_path):  # noqa: F811
    import psycopg
    page = hub_page()
    fields = shell_sql.change_fields([{"name": c, "type": TYPES.get(c, "STRING")} for c in COLUMNS])
    sql, params = shell_sql.impact_query(page, fields, "2026-10-01")
    pg_types = {"DOUBLE": "double precision", "BOOLEAN": "boolean", "DATE": "date", "TIMESTAMP": "timestamptz", "INT": "integer"}
    held = {shell_pg.uc_key(TABLE): {"pg": "impact.loss_desk_out", "columns": [{"name": c} for c in COLUMNS]}}
    text, values, read = shell_pg.render(sql, params, held)
    with psycopg.connect(host=postgres["host"], port=postgres["port"], dbname="postgres", user="inspire", autocommit=True) as conn, \
            conn.cursor() as cur:
        cur.execute("SET TIME ZONE 'UTC'")
        cur.execute("CREATE SCHEMA IF NOT EXISTS impact")
        cur.execute("DROP TABLE IF EXISTS impact.loss_desk_out")
        cur.execute("CREATE TABLE impact.loss_desk_out (" + ", ".join(f'"{c}" {pg_types.get(TYPES.get(c, "STRING"), "text")}' for c in COLUMNS) + ")")
        for row in ROWS:
            cur.execute(f"INSERT INTO impact.loss_desk_out VALUES ({', '.join(['%s'] * len(COLUMNS))})",
                        [bool(row[c]) if TYPES.get(c) == "BOOLEAN" and row[c] is not None else row[c] for c in COLUMNS])
        cur.execute(text, values)
        names = [d.name for d in cur.description]
        rows = [{n: shell_pg.cell(x) for n, x in zip(names, r)} for r in cur.fetchall()]
    view = shell_core.impact_view(rows)
    assert read == {shell_pg.uc_key(TABLE)}
    sqlite_view = shell_core.impact_view(Workspace().run_sql("wh1", sql, params)["rows"])
    for key in ("estimated", "reported", "measured", "closed", "outcomes", "reasons", "holdout", "current"):
        assert view[key] == sqlite_view[key], key
    assert view["measured"]["money"] == 1800.0 and view["holdout"]["held"] == {"n": 3, "hits": 1}


def test_a_fix_takes_the_money_it_saved_and_only_a_fix_does():
    values = shell_sql.action_values({"action_status": "Done", "realized_value": "1250.5", "realized_note": "  Repriced "})
    assert values == {"action_status": "Done", "dismiss_reason": None, "realized_value": 1250.5, "realized_note": "Repriced",
                      "snooze_until": None}
    assert shell_sql.action_values({"action_status": "Done", "realized_value": "", "realized_note": ""}) == \
        {"action_status": "Done", "dismiss_reason": None, "realized_value": None, "realized_note": None, "snooze_until": None}
    assert shell_sql.action_values({"action_status": "In progress"}) == {"action_status": "In progress", "dismiss_reason": None,
                                                                          "realized_value": None, "realized_note": None,
                                                                          "snooze_until": None}, \
        "reopening a fix clears the money it saved"
    assert shell_sql.action_values({"action_status": "Could not fix"})["action_status"] == "Could not fix"
    for sent, error in (({"action_status": "Could not fix", "realized_value": 5}, "goes only with the Done status"),
                        ({"realized_value": 5}, "goes only with the Done status"),
                        ({"action_status": "Done", "realized_value": -1}, "from 0 to"),
                        ({"action_status": "Done", "realized_value": "ten"}, "as a number"),
                        ({"action_status": "Done", "realized_value": True}, "as a number"),
                        ({"action_status": "Done", "realized_value": float("inf")}, "as a number"),
                        ({"action_status": "Done", "realized_value": 10 ** 16}, "from 0 to"),
                        ({"action_status": "Done", "realized_note": "x" * 501}, "at most 500 characters"),
                        ({"action_status": "Done", "realized_note": 7}, "takes text"),
                        ({"action_status": "Closed"}, "must be one of New, In progress, Done, Dismissed, Could not fix")):
        with pytest.raises(ValueError, match=re.escape(error)):
            shell_sql.action_values(sent)


def _act_shell(tmp_path, ws):
    settings = dict(SETTINGS, options=dict(SETTINGS["options"], decisions=True))
    return shell(tmp_path, ws, settings=settings, page=hub_page())


def test_acting_on_a_held_back_record_is_refused_with_why(tmp_path):
    ws = Workspace()
    s = _act_shell(tmp_path, ws)
    fields = s.table_fields(ws, None, s.page("n01_u05"))
    sql, _params = shell_sql.version_write(TABLE, fields, "action", [("a3", "1")], PERSON, {"action_status": "Done"})
    assert "AND NOT COALESCE(b.`held_back`, FALSE)" in sql
    edit, _params = shell_sql.version_write(TABLE, fields, "edit", [("a3", "1")], PERSON, {"category": "B"})
    assert "held_back`, FALSE)" not in edit, "an edit of a held back record still works; only actions are refused"
    current = {"a3": {"record_key": "a3", "held_back": True, "change_source": "run", "changed_by": "run r4", "valid_from_us": "9"}}
    s.write_versions = lambda *args, **kwargs: {"num_inserted_rows": 0}
    s.current_versions = lambda ws_, page, keys: current
    body = {"page": "n01_u05", "record_keys": ["a3"], "seen": {"a3": "9"}, "values": {"action_status": "Done"}}
    status, out = call(s, "POST", "records/act", headers={"x-forwarded-email": PERSON}, body=body)
    assert (status, out["error"]) == (409, shell_core.HELD_TEXT)


def test_the_close_and_holdout_columns_are_actions_and_inspire_columns_people_cannot_edit():
    fields = {f["name"]: f for f in shell_sql.change_fields([{"name": c, "type": TYPES.get(c, "STRING")} for c in COLUMNS])}
    assert [(fields[n]["role"], fields[n]["editable"]) for n in CLOSE] == [("action", False), ("action", False), ("holdout", False),
                                                                          ("holdout", False)]


def test_promised_is_checked_and_reaches_the_page():
    page = hub_page(promised=PROMISED)
    assert shell_sql.spec_problems(page) == [] and shell_core.public_page(page)["promised"] == PROMISED
    assert shell_sql.spec_problems(dict(page, promised="text")) == ["the page promised must be an object of the catalog's business value and its benefits"]
    assert shell_sql.spec_problems(dict(page, promised={"value": "x" * 1001})) == ["the page promised value must be text of at most 1000 characters"]
    assert shell_sql.spec_problems(dict(page, promised={"value": "ok", "benefits": ["b"] * 6})) == [
        "the page promised benefits must be at most 5 lines of at most 300 characters"]
    estimate = dict(PROMISED, estimate="AED 2.4K\u20136K a year, if weekly sales value rises 2\u20135%")
    assert shell_sql.spec_problems(dict(page, promised=estimate)) == [] and shell_core.public_page(dict(page, promised=estimate))["promised"] == estimate
    for bad in (["AED"], 12, "x" * 1001):
        assert shell_sql.spec_problems(dict(page, promised=dict(PROMISED, estimate=bad))) == [
            "the page promised estimate must be text of at most 1000 characters"], bad


def test_the_weekly_digest_reads_the_impact_of_the_last_seven_days_in_plain_rows():
    fields = shell_sql.change_fields([{"name": c, "type": TYPES.get(c, "STRING")} for c in COLUMNS])
    sql = shell_sql.digest_query(TABLE, fields, label="entity_label", use_case="N01-U05", impact={"kind": "money", "unit": "USD"})
    sqlglot.parse_one(sql, read="databricks")
    assert "date_sub(current_date(), 7)" in sql and ":p" not in sql, "the alert query takes no parameters and reads the week it runs in"
    week = shell_sql.digest_query(TABLE, fields, label="entity_label", use_case="N01-U05", impact={"kind": "money", "unit": "USD"}, since="CAST('2026-10-06' AS DATE)")
    rows = Workspace().run_sql("wh1", week, [])["rows"]
    assert all(r["send"] == 1 for r in rows)
    assert [(r["figure"], r["amount"]) for r in rows] == [
        ("Money at stake now (estimated)", "1,550 USD"), ("Acted on this week", "1,250 USD"), ("Reported by people this week", "0 USD"),
        ("Measured by later runs this week", "1,800 USD"), ("Closed this week", "4"), ("Recommendations people said were wrong", "38%"),
        ("Held back to measure impact", "43% vs 33%")]
    assert rows[3]["how"] == ("Money at stake when fixed, less what a later run still finds, on 2 fixes a later run confirmed this week; "
                              "1,800 USD on 2 fixes so far")
    assert rows[4]["how"] == "2 fixed, 1 not a real issue, 1 could not fix"
    plain = Workspace([dict(r, held_back=None, run_tier=None) for r in ROWS])
    assert [r["figure"] for r in plain.run_sql("wh1", week, [])["rows"]][-1] == "Recommendations people said were wrong", \
        "a use case that holds nothing back sends no holdout row"
    assert "'O\\'Neil'" in shell_sql.digest_query(TABLE, fields, use_case="O'Neil"), "the use case id is quoted for Spark"


def test_the_holdout_setting_is_off_by_default_and_checked_when_sent(agent_ns):
    out, errors = _spec(agent_ns)
    assert errors == [] and "holdout" not in out, "a spec that sends no holdout cleans to the same spec the App builds"
    out, errors = _spec(agent_ns, holdout={"enabled": True})
    assert errors == [] and out["holdout"] == {"enabled": True, "share": 0.1}
    assert _spec(agent_ns, holdout={"enabled": False, "share": "0.25"})[0]["holdout"] == {"enabled": False, "share": 0.25}
    for holdout, error in (({"share": 0}, "holdout share 0 must be a share above 0 and at most 0.5"),
                           ({"share": 0.6}, "holdout share 0.6 must be a share above 0 and at most 0.5"),
                           ({"share": "ten"}, "holdout share 'ten' must be a share above 0 and at most 0.5"),
                           ({"enabled": "yes"}, "holdout.enabled must be true or false"),
                           ("on", "holdout must be an object")):
        assert error in " ".join(_spec(agent_ns, holdout=holdout)[1]), holdout
    share = agent_ns["implement_holdout_share"]
    assert (share({"enabled": True, "share": 0.2}), share({"enabled": False, "share": 0.2}), share(None)) == (0.2, 0.0, 0.0)


def test_the_run_controls_bake_the_holdout_into_the_notebook(agent_ns):
    inst = agent_ns["DatabricksInspire"].__new__(agent_ns["DatabricksInspire"])
    inst.business_name = "Acme"
    spec = {"job_slug": "s", "job_tags": {}, "schedule_cron": "", "wait_minutes": 5, "result_table": TABLE, "use_case_id": "N01-U05",
            "decision_basis": "measured", "value_type": "amount", "action_target": "the list"}
    inst._genie_widget_names = lambda instruction, spec: []
    inst._genie_involved_tables = lambda uc: []
    for holdout, expected in (({"enabled": True, "share": 0.15}, 0.15), ({"enabled": False, "share": 0.15}, 0.0), (None, 0.0)):
        use_case = {"Name": "Desk", "Business Value": "Margin", **({"_implement_holdout": holdout} if holdout is not None else {})}
        source = inst._genie_run_controls_source(use_case, spec, "Build")
        run = source.split("\nINSPIRE_RUN = ", 1)[1].split("\n\n\n", 1)[0]
        assert ast.literal_eval(run)["holdout_share"] == expected, holdout


def test_a_run_holds_back_records_by_their_key_and_keeps_them_off_the_to_fix_list(agent_ns):
    share = agent_ns["inspire_holdout_share"]
    assert (share({"holdout_share": 0.1}), share({"holdout_share": 0.9}), share({"holdout_share": "x"}), share({})) == (0.1, 0.0, 0.0, 0.0)
    derived, kinds = agent_ns["inspire_holdout_derived"](["entity_id", "priority_tier", "use_case_id"], ("entity_id",), 0.1, None)
    assert kinds == {"held_back": "BOOLEAN", "run_tier": "STRING"}
    held = "crc32(concat(CAST(s.`use_case_id` AS STRING), '|', CAST(s.`entity_id` AS STRING))) % 10000 < 1000"
    assert derived == {"held_back": held, "run_tier": "CAST(s.`priority_tier` AS STRING)",
                       "priority_tier": f"CASE WHEN {held} AND s.`priority_tier` IN ('Act now', 'Review') THEN 'Held back' ELSE s.`priority_tier` END"}
    off, _kinds = agent_ns["inspire_holdout_derived"](["entity_id", "priority_tier"], ("entity_id",), 0.0, [("held_back", "boolean")])
    assert off == {"held_back": "CAST(NULL AS BOOLEAN)", "run_tier": "CAST(s.`priority_tier` AS STRING)"}, \
        "turning the holdout off puts every record back on the list and still records the run's own tier"
    assert agent_ns["inspire_holdout_derived"](["entity_id", "priority_tier"], ("entity_id",), 0.0, [("entity_id", "string")]) == ({}, {})
    assert agent_ns["inspire_holdout_derived"](["entity_id"], ("entity_id",), 0.1, None) == ({}, {}), "no tier, nothing to hold back"


def test_the_held_back_records_are_the_ones_their_key_hash_picks_and_stay_picked(agent_ns):
    assert crc32("Spark") == 1557323817, "the Python twin of Spark's crc32 gives Spark's documented answer"
    db = sqlite3.connect(":memory:")
    db.create_function("CRC32", 1, crc32)
    db.execute("CREATE TABLE s (use_case_id TEXT, entity_id TEXT, priority_tier TEXT)")
    keys = [f"item-{n}" for n in range(2000)]
    db.executemany("INSERT INTO s VALUES (?, ?, ?)", [("N01-U05", k, "Act now") for k in keys])

    def picked(share):
        expr = agent_ns["inspire_held_back_sql"](share, "CAST(s.`entity_id` AS STRING)", "s")
        sql = sqlglot.transpile(f"SELECT s.entity_id AS k, {expr} AS h FROM s", read="databricks", write="sqlite")[0]
        return {k for k, h in db.execute(sql) if h}

    ten, twenty = picked(0.1), picked(0.2)
    expected = {k for k in keys if crc32(f"N01-U05|{k}") % 10000 < 1000}
    assert ten == expected and 150 <= len(ten) <= 250, len(ten)
    assert picked(0.1) == ten, "a record stays held back or shown run after run"
    assert ten < twenty, "a larger share keeps every record it held back before"
    outside = next(k for k in keys if k not in ten)
    assert crc32(f"N01-U05|{outside}") % 10000 >= 1000, "a record whose hash is past the share is never held back"
    assert agent_ns["inspire_held_back_sql"](0, "k", "s") == "CAST(NULL AS BOOLEAN)"


HIST = [("record_key", "string"), ("valid_from", "timestamp"), ("valid_to", "timestamp"), ("is_current", "boolean"),
        ("change_source", "string"), ("changed_by", "string")]
CORE = [("as_of_date", "date"), ("entity_id", "string"), ("entity_label", "string"), ("rank", "int"), ("priority_tier", "string"),
        ("run_id", "string"), ("use_case_id", "string")]
QUOTED = "`main`.`pricing`.`loss_desk_out`"
STAGE = "main.pricing.loss_desk_out_inspire_stage"


def _merge(ns, target, holdout):
    profile = {"row_count": 3, "use_cases": 1, "use_case_id": "N01-U05", "runs": 1, "run_id": "r-5", "undated": 0, "no_use_case": 0,
               "no_run": 0, "id_unique": True, "label_unique": True}

    def respond(statement):
        if statement == "DESCRIBE TABLE `main`.`pricing`.`loss_desk_out_inspire_stage`":
            return [{"col_name": n, "data_type": k} for n, k in CORE]
        if statement == f"DESCRIBE TABLE {QUOTED}":
            if target is None:
                raise RuntimeError(f"[TABLE_OR_VIEW_NOT_FOUND] The table or view {QUOTED} cannot be found.")
            return [{"col_name": n, "data_type": k} for n, k in target]
        if statement.startswith("SELECT COUNT(*) AS row_count"):
            return [profile]
        if statement.startswith("SELECT COUNT(*) AS kept"):
            return [{"kept": 0}]
        if statement.startswith("SELECT COUNT_IF(t.action_status = 'Dismissed')"):
            return [{"dismissed": 0, "kept_out": 0, "resolved": 0, "still_flagged": 0, **({"held_back": 2} if "held_back" in statement else {})}]
        if statement.startswith("MERGE INTO") and QUOTED in statement.split(" USING ")[0]:
            return [{"num_inserted_rows": 3, "num_updated_rows": 3}]
        if statement == "SELECT unix_micros(current_timestamp()) AS now":
            return [{"now": 1_793_000_000_000_000}]
        if statement.startswith("DESCRIBE HISTORY"):
            return [{"version": 7}]
        return []

    spark, printed = FakeSpark(responder=respond), []
    ns["inspire_merge_run"](spark, TABLE, STAGE, out=printed.append, holdout=holdout)
    return spark.statements, printed


def test_a_run_with_a_holdout_writes_who_is_held_back_and_the_run_s_own_tier(agent_ns):
    statements, printed = _merge(agent_ns, CORE + HIST, 0.1)
    added = [s for s in statements if s.startswith(f"ALTER TABLE {QUOTED} ADD COLUMN ")]
    assert {f"ALTER TABLE {QUOTED} ADD COLUMN `held_back` BOOLEAN", f"ALTER TABLE {QUOTED} ADD COLUMN `run_tier` STRING"} <= set(added), added
    assert not any("realized_value" in s or "action_owner" in s for s in added), "the run adds the holdout columns and never an action column"
    merge = next(s for s in statements if s.startswith(f"MERGE INTO {QUOTED} "))
    assert "crc32(concat(CAST(s.`use_case_id` AS STRING), '|', CAST(s.`entity_id` AS STRING))) % 10000 < 1000 AS `held_back`" in merge
    assert "CAST(s.`priority_tier` AS STRING) AS `run_tier`" in merge
    assert "THEN 'Held back' ELSE s.`priority_tier` END AS `priority_tier`" in merge
    assert ("CASE WHEN u.`action_status` IN ('Done', 'Could not fix') AND u.`run_tier` IN ('Act now', 'Review') THEN 'Still flagged' WHEN "
            "u.`action_status` IN ('Done', 'Could not fix') THEN 'Resolved'") in merge, \
        "a fix is judged on the run's own tier, never on the Held back label"
    assert "u.`realized_value`, u.`realized_note`" in merge, "the money a fix saved is carried into every later run"
    assert any(p.startswith("Holdout: 10% of the records, picked by their record key, are held back") for p in printed)
    assert any("held back 2 flagged records from the to fix list to measure the impact" in p for p in printed)
    first, _printed = _merge(agent_ns, None, 0.1)
    create = next(s for s in first if s.startswith(f"CREATE TABLE {QUOTED} AS SELECT"))
    assert "AS `held_back`" in create and "THEN 'Held back'" in create, "the first run holds back records too"


def test_a_run_without_a_holdout_writes_no_holdout_columns(agent_ns):
    statements, printed = _merge(agent_ns, CORE + HIST, 0.0)
    assert not [s for s in statements if "held_back" in s and "_run_log" not in s] and not [p for p in printed if p.startswith("Holdout:")]
    merge = next(s for s in statements if s.startswith(f"MERGE INTO {QUOTED} "))
    assert "u.`action_status` IN ('Done', 'Could not fix') AND u.`priority_tier` IN ('Act now', 'Review')" in merge


def test_a_run_whose_flagged_records_are_all_held_back_says_so_instead_of_nothing_passed(agent_ns):
    columns = [n for n, _k in CORE + HIST] + ["held_back", "run_tier"]
    sql = agent_ns["inspire_outcome_sql"](TABLE, "N01-U05", columns, None)
    assert "COUNT_IF(t.`priority_tier` = 'Held back') AS held_records" in sql
    assert "held_records" not in agent_ns["inspire_outcome_sql"](TABLE, "N01-U05", [n for n, _k in CORE + HIST], None)
    reason = agent_ns["inspire_nothing_to_act"]
    assert reason({"act_now_records": 0, "review_records": 0, "records": 9, "held_records": 2}, None, None) == (
        "Every record the last run flagged is held back to measure the impact of this use case (2 of them), so none is on the to fix list.")
    assert reason({"act_now_records": 1, "review_records": 0, "records": 9, "held_records": 2}, None, None) is None
    assert reason({"act_now_records": 0, "review_records": 0, "records": 9, "held_records": 0}, None, None) == (
        "No record passed this use case's decision test in the last run.")


def test_the_app_page_carries_the_catalog_promise(agent_ns):
    page = agent_ns["implement_app_page"]({"title": "Desk", "promised": {"value": "forged"}}, "N01-U05", {
        "Business Value": "  The Pricing Manager   recovers margin. ", "Financial Benefits": ["Recover margin", "", "Cut write-offs"]})
    assert page["promised"] == {"value": "The Pricing Manager recovers margin.", "benefits": ["Recover margin", "Cut write-offs"]}
    stored = agent_ns["implement_app_page"]({}, "N01-U05", {"Financial Benefits": json.dumps(["One"])})
    assert stored["promised"] == {"value": "", "benefits": ["One"]}
    assert "promised" not in agent_ns["implement_app_page"]({"promised": {"value": "forged"}}, "N01-U05", {}), "only the catalog sets it"


DIGEST_SCHEMA = [{"col_name": c, "data_type": {"DOUBLE": "double", "BOOLEAN": "boolean", "DATE": "date", "TIMESTAMP": "timestamp",
                                               "INT": "int"}.get(TYPES.get(c, "STRING"), "string")} for c in COLUMNS]


def _digest_inspire(ns, tmp_path, answers=None, schema=DIGEST_SCHEMA, summary=None):
    inst, calls, queries = _alert_inspire(ns, tmp_path, answers)
    del inst._implement_digest
    inst._implement_app_shell = lambda: (None, {"shell_sql": shell_sql, "shell_alerts": shell_alerts})

    def respond(statement):
        if statement.startswith("DESCRIBE TABLE `main`.`inspire`.`churn_out`"):
            return schema
        if re.match(r"SELECT (\*|currency) FROM `main`\.`inspire`\.`churn_out_summary`", statement):
            return [summary or {"currency": "USD"}]
        return []

    inst.spark = FakeSpark(responder=respond)
    return inst, calls, queries


def test_the_alert_build_sets_up_a_weekly_impact_email_with_the_existing_alert_code(agent_ns, tmp_path):
    inst, calls, queries = _digest_inspire(agent_ns, tmp_path, {("POST", "/api/2.0/alerts"): {"id": "al-1"}})
    context = _output_context(agent_ns, **ALERT, alert_destinations=[{"id": "dest-0001", "name": "Slack"}])
    context["urls"]["app_url"] = "https://app.example.com/"
    fields = inst._implement_alert(context, None)
    alert, digest = [body for body, _q in [(b, q) for m, p, b, q in calls if (m, p) == ("POST", "/api/2.0/alerts")]]
    assert "_warnings" not in fields and fields["_asset"]["digest_id"] == "al-1"
    fields_seen = shell_sql.change_fields(agent_ns["implement_digest_fields"]([(r["col_name"], r["data_type"]) for r in DIGEST_SCHEMA]))
    assert digest["query_text"] == shell_sql.digest_query("main.inspire.churn_out", fields_seen, label="entity_label", use_case="N01-U01",
                                                          impact={"kind": "money", "unit": "USD"},
                                                          model=shell_sql.money_model({"currency": "USD"}, fields_seen)), \
        "the email reads the digest the App's SQL builder writes"
    assert queries[-1] == digest["query_text"], "the build runs the query once before it saves the email"
    assert digest["schedule"] == {"quartz_cron_schedule": "0 0 8 ? * MON", "timezone_id": "Asia/Dubai", "pause_status": "UNPAUSED"}
    assert digest["evaluation"]["source"] == {"name": "send", "display": "send"}, \
        "the email's result table lists every figure only when the alert reads a column; an aggregate shows just the count"
    assert digest["evaluation"]["threshold"] == {"value": {"double_value": 1.0}}
    assert digest["evaluation"]["notification"]["subscriptions"] == [{"user_email": "owner@example.com"}, {"destination_id": "dest-0001"}]
    assert digest["display_name"] == "N01-U01 Predict churn weekly impact" and digest["parent_path"] == "/W/acme_implemented/Sales"
    assert "Open the Impact page of the App: https://app.example.com/?open=impact" in digest["custom_description"]
    assert "The three amounts are never added together." in digest["custom_description"] and "{{QUERY_RESULT_TABLE}}" in digest["custom_description"]
    assert not re.search("[\u2013\u2014]", digest["custom_description"] + digest["custom_summary"]), "no en or em dash in the email"
    assert alert["schedule"]["pause_status"] == "PAUSED", "the alert itself is unchanged"


def test_a_rebuild_updates_the_same_weekly_email_and_a_failure_leaves_the_alert_ready(agent_ns, tmp_path):
    inst, calls, _q = _digest_inspire(agent_ns, tmp_path, {("PATCH", "/api/2.0/alerts/dg-7"): {"id": "dg-7"}})
    context = dict(_output_context(agent_ns, **ALERT), asset_status={"alert": {"state": "ready", "digest_id": "dg-7"}})
    fields = inst._implement_alert(context, None)
    assert fields["_asset"]["digest_id"] == "dg-7" and [p for m, p, _b, _q2 in calls if m == "PATCH"] == ["/api/2.0/alerts/dg-7"]
    broken, _calls, _q = _digest_inspire(agent_ns, tmp_path / "b")
    checked = broken._implement_run_query_check

    def check(sql, require_rows=False, limit=20):
        if "AS `figure`" in sql:
            raise RuntimeError("[UNRESOLVED_COLUMN] A column with name `valid_from` cannot be resolved")
        return checked(sql, require_rows, limit)

    broken._implement_run_query_check = check
    fields = broken._implement_alert(dict(context, asset_status={"alert": {"digest_id": "dg-7"}}), None)
    assert fields["alert_id"] == "al-1" and fields["_asset"]["digest_id"] == "dg-7", "a failed email keeps the one built before"
    assert fields["_warnings"] == ["Alert: the weekly impact email could not be set up, so it is not sent: [UNRESOLVED_COLUMN] A column with "
                                   "name `valid_from` cannot be resolved"]


def test_deleting_the_alert_deletes_its_weekly_email_and_a_failed_build_keeps_its_id(agent_ns, tmp_path):
    inst, calls, _q = _digest_inspire(agent_ns, tmp_path)
    assert inst._implement_delete_digest("N01-U01", "dg-7") == [] and ("DELETE", "/api/2.0/alerts/dg-7") in [(m, p) for m, p, _b, _q2 in calls]
    gone, _calls, _q = _digest_inspire(agent_ns, tmp_path / "b", {("DELETE", "/api/2.0/alerts/dg-8"): RuntimeError("PERMISSION_DENIED: no")})
    assert gone._implement_delete_digest("N01-U01", "dg-8") == ["Alert: Inspire could not delete the weekly impact email dg-8 of N01-U01: "
                                                                "PERMISSION_DENIED: no"]
    kept = agent_ns["implement_kept_asset"]
    assert (kept({"state": "ready", "digest_id": "dg-7", "trigger": "x"}), kept(None), kept({"digest_id": ""})) == ({"digest_id": "dg-7"}, {}, {})
    source = agent_source()
    assert source.count("implement_kept_asset(asset_status.get(name))") >= 3, "unticked, released and failed outputs keep the email's id"
    assert "warnings += self._implement_delete_digest(key[1], digest) if digest else []" in source


LIVE_ALERT_KEYS = {"display_name", "query_text", "warehouse_id", "custom_summary", "custom_description", "evaluation", "schedule"}
LIVE_EVALUATION_KEYS = {"source", "comparison_operator", "threshold", "empty_result_state", "notification"}
LIVE_NOTIFICATION_KEYS = {"notify_on_ok", "retrigger_seconds", "subscriptions"}


def _scim(inst, users):
    api = inst._implement_api

    def call(method, path, body=None, query=None):
        if path == "/api/2.0/preview/scim/v2/Users":
            asked = re.search(r'userName eq "([^"]*)"', (query or {}).get("filter", "")).group(1)
            return {"Resources": [{"userName": u, "active": True} for u in users if u.lower() == asked.lower()]}
        return api(method, path, body, query)

    inst._implement_api = call


def test_the_alert_and_its_weekly_email_go_only_to_the_workspace_users_the_alert_names(agent_ns, tmp_path):
    inst, calls, _q = _digest_inspire(agent_ns, tmp_path, {("POST", "/api/2.0/alerts"): {"id": "al-1"}})
    _scim(inst, ["owner@example.com", "b@example.com", "admin@example.com"])
    context = _output_context(agent_ns, alert=True, alert_recipients=["Owner@Example.com", "b@example.com"],
                              alert_destinations=[{"id": "dest-0001", "name": "Slack"}])
    inst._implement_alert(context, None)
    [(update, _u)] = [(b, q) for m, p, b, q in calls if (m, p) == ("POST", "/api/2.2/jobs/update")]
    assert update["new_settings"]["tasks"][0]["alert_task"]["subscribers"] == [
        {"user_name": "owner@example.com"}, {"user_name": "b@example.com"}, {"destination_id": "dest-0001"}], \
        "the job task notifies the workspace user names of the typed addresses, nobody else"
    alert, digest = [b for m, p, b, q in calls if (m, p) == ("POST", "/api/2.0/alerts")]
    assert alert["evaluation"]["notification"]["subscriptions"] == [], "the alert itself emails nobody; its job task does"
    assert digest["evaluation"]["notification"]["subscriptions"] == [
        {"user_email": "owner@example.com"}, {"user_email": "b@example.com"}, {"destination_id": "dest-0001"}]
    assert "admin@example.com" not in json.dumps([alert, digest, update]), "never the App owner or anyone the user did not name"


def test_an_alert_recipient_who_is_not_a_workspace_user_stops_the_alert_before_anything_is_saved(agent_ns, tmp_path):
    inst, calls, _q = _digest_inspire(agent_ns, tmp_path)
    _scim(inst, ["owner@example.com"])
    context = _output_context(agent_ns, alert=True, alert_recipients=["owner@example.com", "outsider@example.org"])
    with pytest.raises(agent_ns["ImplementBlocked"], match=re.escape(
            "outsider@example.org is not a user of this workspace, and an alert emails only workspace users; change the alert recipients")):
        inst._implement_alert(context, None)
    assert not [p for m, p, _b, _q2 in calls if m in ("POST", "PATCH")], \
        "Databricks refuses the address on the weekly email and drops it silently on the job task, so nothing is saved"


def test_every_alert_body_inspire_saves_comes_from_the_one_builder_whose_fields_the_live_api_accepted(agent_ns, tmp_path):
    inst, calls, _q = _digest_inspire(agent_ns, tmp_path, {("POST", "/api/2.0/alerts"): {"id": "al-1"}})
    inst._implement_alert(_output_context(agent_ns, **ALERT), None)
    alert, digest = [b for m, p, b, q in calls if (m, p) == ("POST", "/api/2.0/alerts")]
    for body in (alert, digest):
        assert set(body) - {"parent_path"} == LIVE_ALERT_KEYS and set(body["evaluation"]) == LIVE_EVALUATION_KEYS
        assert set(body["evaluation"]["notification"]) <= LIVE_NOTIFICATION_KEYS
    assert digest["evaluation"]["notification"] == {"notify_on_ok": False, "retrigger_seconds": 60,
                                                    "subscriptions": [{"user_email": "owner@example.com"}]}
    assert alert["evaluation"]["notification"] == {"notify_on_ok": True, "retrigger_seconds": 60, "subscriptions": []}
    source = agent_source()
    assert source.count('"notification": {') == 0 and source.count('"evaluation": {') == 0, \
        "the notebook builds no alert body of its own; the App's builder is the only one"
    assert inspect.getsource(shell_alerts).count('"evaluation": {') == 1


def _money_digest_sql(ns, tmp_path, ws):
    inst, calls, _q = _alert_inspire(ns, tmp_path)
    del inst._implement_digest
    inst._implement_app_shell = lambda: (None, {"shell_sql": shell_sql, "shell_alerts": shell_alerts})
    kinds = {"DOUBLE": "double", "INT": "int", "DATE": "date", "TIMESTAMP": "timestamp", "BOOLEAN": "boolean"}

    def respond(statement):
        if statement.startswith("DESCRIBE TABLE `main`.`pricing`.`loss_desk_out`"):
            return [{"col_name": c, "data_type": kinds.get(dict(MONEY_TYPES, **FIELD_TYPES).get(c, "STRING"), "string")} for c in MONEY_COLUMNS]
        if re.match(r"SELECT (\*|currency) FROM `main`\.`pricing`\.`loss_desk_out_summary`", statement):
            cur = ws.db.execute('SELECT * FROM "loss_desk_out_summary" ORDER BY "updated_at" DESC LIMIT 1')
            return [dict(zip([d[0] for d in cur.description], row)) for row in cur.fetchall()]
        return []

    inst.spark = FakeSpark(responder=respond)
    inst._implement_alert(dict(_output_context(ns, **ALERT), uc_id="N01-U05", result_table=TABLE), None)
    return [b for m, p, b, q in calls if (m, p) == ("POST", "/api/2.0/alerts")][-1]["query_text"]


def _digest_estimated(ws, sql):
    rows = ws.run_sql("wh1", sql.replace("date_sub(current_date(), 7)", "CAST('2026-10-21' AS DATE)"), [])["rows"]
    return next(r["amount"] for r in rows if r["figure"] == "Money at stake now (estimated)")


def _impact_estimated(s):
    status, out = call(s, "GET", "impact", query={"page": "n01_u05"}, headers={"x-forwarded-email": PERSON})
    assert status == 200, out
    return f"{sum(t['money'] for t in out['estimated'].values()):,.0f} USD"


def test_the_weekly_email_shows_the_money_the_impact_page_shows_after_an_owner_changes_an_assumption(agent_ns, tmp_path):
    ws = MoneyWorkspace()
    ws.db.create_function("FORMAT_NUMBER", 2, lambda n, d: None if n is None else f"{float(n):,.{int(d)}f}")
    s, ws, _made = money_shell(tmp_path / "app", ws)
    digest = _money_digest_sql(agent_ns, tmp_path / "nb", ws)
    assert (_digest_estimated(ws, digest), _impact_estimated(s)) == ("6,200 USD", "6,200 USD"), "both show the money the run wrote"
    status, _out = call(s, "POST", "money/assumption", headers={"x-forwarded-email": OWNER},
                        body={"page": "n01_u05", "name": "PRICE", "value": 30, "was": 20, "note": "list price went up"})
    assert status == 200
    assert (_digest_estimated(ws, digest), _impact_estimated(s)) == ("9,300 USD", "9,300 USD"), \
        "the email built before the change reads the new price at query time, as the Impact page does: 90+500+30 units x 30 x 0.5"
    ws.db.execute('UPDATE "loss_desk_out" SET "value_at_stake" = "units" * 30 * 0.5 + CASE WHEN "record_key" = \'k2\' THEN 0.7 ELSE 0 END '
                  'WHERE "value_at_stake" IS NOT NULL')
    ws.db.execute('INSERT INTO "loss_desk_out_summary" ("use_case_id", "run_id", "currency", "value_formula", "value_expression", '
                  '"value_assumptions", "updated_at") VALUES (?, ?, ?, ?, ?, ?, ?)',
                  ("N01-U05", "r5", "USD", FORMULA, EXPRESSION, json.dumps([{"name": "PRICE", "value": 30.0, "kind": "money"},
                                                                            {"name": "KEEP", "value": 0.5, "kind": "percent"}]),
                   "2026-10-27 07:00:00"))
    s.cache.clear()
    assert (_digest_estimated(ws, digest), _impact_estimated(s)) == ("9,301 USD", "9,301 USD"), \
        "once a run applied the price, both show exactly the money that run wrote, not the arithmetic again"


def test_held_back_is_explained_by_one_sentence_wherever_people_read_it(agent_ns, tmp_path):
    meaning = shell_sql.HELD_MEANING
    s = shell(tmp_path / "app", Workspace())
    status, info = call(s, "GET", "app", headers={"x-forwarded-email": PERSON})
    assert status == 200 and info["held_meaning"] == meaning, "the App's record panel and Impact page read it from the server"
    assert shell_core.HELD_TEXT.startswith(meaning), "refusing an action on a held back record says the same"
    status, money = call(s, "GET", "money", query={"page": "n01_u05"}, headers={"x-forwarded-email": PERSON})
    assert status == 200 and money["held"] == meaning, "the money panel names the tiers, so it explains held back too"
    plain, _ws, _made = money_shell(tmp_path / "plain", MoneyWorkspace())
    status, money = call(plain, "GET", "money", query={"page": "n01_u05"}, headers={"x-forwarded-email": PERSON})
    assert status == 200 and money["model"]["assumptions"] and money["held"] == "", "a use case that holds nothing back is not told about it"
    inst, calls, _q = _digest_inspire(agent_ns, tmp_path / "nb", {("POST", "/api/2.0/alerts"): {"id": "al-1"}})
    inst._implement_alert(_output_context(agent_ns, **ALERT), None)
    digest = [b for m, p, b, q in calls if (m, p) == ("POST", "/api/2.0/alerts")][-1]
    assert meaning in digest["custom_description"] and meaning in agent_ns["implement_held_back_fact"](shell_sql)
    assert not re.search("[\u2013\u2014]", meaning)
