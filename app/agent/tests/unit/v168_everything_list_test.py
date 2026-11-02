"""A list read with no window shows every record, open and closed. Each closed record says who closed it, when, the note or reason they
left and the batch of that close, read in one statement for the closed records on the page from the same close history the Overview
joins, so the list statement itself stays the one Lakebase serves. A record that was closed and then reopened shows no closer, a close that
was itself an undo says so, and a list read with a window shows only open records and reads no close history."""
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
for folder in (SERVER, os.path.dirname(os.path.abspath(__file__))):
    if folder not in sys.path:
        sys.path.insert(0, folder)

import shell_db  # noqa: E402
import shell_sql  # noqa: E402
from v141_app_shell_test import SETTINGS, call  # noqa: E402
from v148_app_hub_test import PERSON, SqliteWorkspace, hub_shell, version  # noqa: E402

pytest.importorskip("sqlglot")

SAM = "@".join(["sam.roe", "example.com"])
B1, B2, B3 = "1" * 32, "2" * 32, "3" * 32
DECIDE = dict(SETTINGS, options=dict(SETTINGS["options"], decisions=True))
CLOSED = ("_inspire_closed_by", "_inspire_closed_at", "_inspire_closed_batch", "_inspire_closed_undo", "_inspire_closed_note",
          "_inspire_closed_reason", "_inspire_closed_comment")
ROWS = [
    version("r1", "Act now", 900.0, current=False, ends="2026-10-22 09:00:00"),
    version("r1", "Act now", 900.0, at="2026-10-22 09:00:00", source="action", current=False, ends="2026-10-23 06:00:00",
            action_status="Done", changed_by=SAM, action_batch=B1, action_batch_note=" Repriced the shelf ", action_note="Called the store",
            action_batch_values='{"action_status": "Done"}'),
    version("r1", "Monitor", 100.0, at="2026-10-23 06:00:00", action_status="Done", action_note="Called the store", action_batch=B1),
    version("r2", "Review", 300.0, current=False, ends="2026-10-21 10:00:00"),
    version("r2", "Review", 300.0, at="2026-10-21 10:00:00", source="action", action_status="Dismissed", dismiss_reason="Known issue",
            action_batch=B2, action_batch_values='{"action_status": "Dismissed"}'),
    version("r3", "Act now", 500.0, current=False, ends="2026-10-21 08:00:00"),
    version("r3", "Act now", 500.0, at="2026-10-21 08:00:00", source="action", current=False, ends="2026-10-21 09:00:00",
            action_status="Done", action_batch=B1),
    version("r3", "Act now", 500.0, at="2026-10-21 09:00:00", source="action", action_status="New", action_batch=B3,
            action_batch_values='{"undo": "' + B1 + '"}'),
    version("r4", "Act now", 700.0, current=False, ends="2026-10-20 08:00:00"),
    version("r4", "Act now", 700.0, at="2026-10-20 08:00:00", source="action", current=False, ends="2026-10-20 09:00:00",
            action_status="New", action_batch=B2),
    version("r4", "Act now", 700.0, at="2026-10-20 09:00:00", source="action", action_status="Could not fix", action_batch=B3,
            action_batch_values='{"undo": "' + B2 + '"}'),
    version("r5", "Act now", 50.0),
]


def records(tmp_path, **body):
    s, ws, _made = hub_shell(tmp_path, settings=DECIDE, ws=SqliteWorkspace(tables={"loss_desk_out": ROWS}))
    status, out = call(s, "POST", "records", headers={"x-forwarded-email": PERSON}, body=dict({"page": "n01_u05", "limit": 25}, **body))
    assert status == 200, out
    return {r["record_key"]: r for r in out["rows"]}, out, ws


def test_a_list_with_no_window_shows_every_record_and_each_closed_one_says_who_closed_it_when_and_why(tmp_path):
    rows, out, _ws = records(tmp_path)
    assert set(rows) == {"r1", "r2", "r3", "r4", "r5"} and out["window"] is None
    r1, r2 = rows["r1"], rows["r2"]
    assert (r1["_inspire_status"], r1["_inspire_closed_by"], str(r1["_inspire_closed_at"])[:16], r1["_inspire_closed_batch"]) == (
        "Done", SAM, "2026-10-22 09:00", B1), "the closer is the person whose action closed it, not the run that wrote it again"
    assert (r1["_inspire_closed_note"], r1["_inspire_closed_comment"], r1["_inspire_closed_reason"]) == ("Repriced the shelf", "Called the store", None)
    assert not r1["_inspire_closed_undo"]
    assert (r2["_inspire_status"], r2["_inspire_closed_by"], r2["_inspire_closed_reason"], r2["_inspire_closed_batch"]) == (
        "Dismissed", PERSON, "Known issue", B2)


def test_a_reopened_record_names_no_closer_and_a_close_that_was_an_undo_says_so(tmp_path):
    rows, _out, _ws = records(tmp_path)
    assert rows["r3"]["_inspire_status"] == "New" and all(rows["r3"][c] in (None, 0, False) for c in CLOSED), \
        "closed and then put back, so it is open and nobody closed it"
    assert rows["r5"]["_inspire_status"] is None and all(rows["r5"][c] in (None, 0, False) for c in CLOSED)
    r4 = rows["r4"]
    assert (r4["_inspire_status"], r4["_inspire_closed_batch"], bool(r4["_inspire_closed_undo"])) == ("Could not fix", B3, True), \
        "an undo that closed a record is not itself undone from the record"


def test_a_list_with_a_window_shows_only_open_records_and_reads_no_close_history(tmp_path):
    rows, out, ws = records(tmp_path, window="all")
    assert set(rows) == {"r3", "r5"} and out["window"]["window"] == "all"
    assert not any(c in r for r in rows.values() for c in CLOSED)
    assert ws.queries("_inspire_closer") == [] and ws.queries("hk AS (") == []


def test_the_close_facts_come_from_one_statement_for_the_closed_records_on_the_page_and_the_list_keeps_its_own(tmp_path):
    _rows, _out, ws = records(tmp_path)
    (sql, params), = ws.queries("_inspire_closer")
    assert sorted(p["value"] for p in params) == ["N01-U05", "r1", "r2", "r4"], "only the closed records on the page are looked up, in this use case"
    assert "`use_case_id` = :p0 AND `record_key` IN (:p1, :p2, :p3)" in sql
    assert " OFFSET " not in sql and "hk AS (" in sql and "explode(" not in sql
    (listed, _params), = ws.queries(" OFFSET ")
    assert "hk AS (" not in listed and "_inspire_closer" not in listed, "the list statement reads no close history, so Lakebase can still serve it"
    (tmp_path / "w").mkdir()
    _rows, _out, windowed = records(tmp_path / "w", window="all")
    assert len(ws.sql) == len(windowed.sql) + 1, "Everything costs one statement more than a window, never one per record"


def test_a_close_that_cannot_be_read_leaves_the_list_whole_and_says_why(tmp_path):
    s, ws, _made = hub_shell(tmp_path, settings=DECIDE,
                             ws=SqliteWorkspace(tables={"loss_desk_out": ROWS}, fail={"_inspire_closer": shell_db.QueryError("warehouse stopped")}))
    status, out = call(s, "POST", "records", headers={"x-forwarded-email": PERSON}, body={"page": "n01_u05", "limit": 25})
    assert status == 200 and out["errors"] == {"closed": "warehouse stopped"}
    assert len(out["rows"]) == 5 and all(r["_inspire_closed_by"] is None and r["_inspire_closed_undo"] is False for r in out["rows"])


def test_a_list_that_keeps_no_actions_reads_no_close_history(tmp_path):
    s, ws, _made = hub_shell(tmp_path, ws=SqliteWorkspace(tables={"loss_desk_out": ROWS}))
    status, out = call(s, "POST", "records", headers={"x-forwarded-email": PERSON}, body={"page": "n01_u05", "limit": 25})
    assert status == 200 and out["actions"] is False
    assert not any(c in r for r in out["rows"] for c in CLOSED)
    assert ws.queries("_inspire_closer") == []
    assert set(shell_sql.CLOSED_FIELDS) == set(CLOSED)


def test_the_close_history_keeps_to_the_columns_the_table_has():
    names = {"record_key", "valid_from", "valid_to", "is_current", "change_source", "changed_by", "action_status", "action_outcome", "dismiss_reason"}
    page = {"use_case_id": "N01-U05"}
    sql, params = shell_sql.closed_query(page, "`main`.`pricing`.`loss_desk_out`", ["r1"], names)
    assert "`use_case_id` = :p0 AND `record_key` IN (:p1)" in sql and [p["value"] for p in params] == ["N01-U05", "r1"], \
        "a record key another use case in the same table also has never lends it that use case's close"
    for missing in ("`action_note`", "`action_batch`", "`action_batch_note`", "`action_batch_values`"):
        assert missing not in sql, missing
    full, _params = shell_sql.closed_query(page, "`main`.`pricing`.`loss_desk_out`", ["r1"], names | set(shell_sql.ACTION_TYPES))
    assert all(c in full for c in ("`action_note`", "`action_batch`", "`action_batch_note`", "`action_batch_values`"))
    alone, params = shell_sql.closed_query({}, "`main`.`pricing`.`loss_desk_out`", ["r1"], names)
    assert "use_case_id" not in alone and [p["value"] for p in params] == ["r1"], "a page that names no use case is not narrowed by one"
