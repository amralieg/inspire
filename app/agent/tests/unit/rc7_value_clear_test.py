"""A record that leaves Done stops counting: the saved value is cleared, and the totals of the ledger exclude it. Run on SQLite."""
import sqlite3

import shell_facts as F

LEDGER = "led"
RESULT = "main.pricing.res"
FOUND = {"session_id": "42", "run_id": "9001", "kind": "money", "currency": "EUR", "unit": None}
TOTALS = ("SELECT COALESCE(SUM(saved), 0) FROM (SELECT saved, ROW_NUMBER() OVER (PARTITION BY session_id, result_table, use_case_id, "
          "record_key ORDER BY recorded_at DESC, run_id DESC) AS rn FROM led WHERE record_key IS NOT NULL) WHERE rn = 1")


def _on_sqlite(sql):
    return sql.replace("`main`.`pricing`.`res`", "res").replace("current_timestamp()", "CURRENT_TIMESTAMP")


def _engine():
    db = sqlite3.connect(":memory:")
    db.execute(F.ledger_create_sql(LEDGER))
    db.execute("CREATE TABLE res (record_key TEXT, change_source TEXT, action_batch TEXT)")
    db.execute("INSERT INTO led (session_id, result_table, use_case_id, run_id, record_key, kind, currency, unit, at_stake, saved, "
               "recorded_by, recorded_at) VALUES ('42', ?, 'N1', '9001', NULL, 'money', 'EUR', NULL, 1000, NULL, NULL, '2026-01-01 00:00:00')",
               (RESULT,))
    return db


def _act(db, keys, status, batch):
    db.executemany("INSERT INTO res VALUES (?, 'action', ?)", [(k, batch) for k in keys])
    return db


SEQ = [0]


def _stamped(db, statement, params=()):
    before = db.execute("SELECT COALESCE(MAX(rowid), 0) FROM led").fetchone()[0]
    db.execute(statement, params)
    SEQ[0] += 1
    db.execute("UPDATE led SET recorded_at = ? WHERE rowid > ?", (f"2026-11-10 10:{SEQ[0]:02d}:00", before))


def _save(db, keys, value, batch):
    _act(db, keys, "Done", batch)
    _stamped(db, _on_sqlite(F.ledger_saved_from_batch_sql(LEDGER, RESULT, "action_batch", batch, FOUND, "N1", value, "owner")))


def _reopen(db, keys, batch):
    _act(db, keys, "In progress", batch)
    _stamped(db, _on_sqlite(F.ledger_clear_from_batch_sql(LEDGER, RESULT, "N1", "action_batch", batch, "owner")))


def _total(db):
    return db.execute(TOTALS).fetchone()[0]


def test_a_saved_value_counts_until_the_record_is_reopened_and_then_the_totals_exclude_it():
    db = _engine()
    _save(db, ["k1"], 300, "B1")
    assert _total(db) == 300
    _reopen(db, ["k1"], "B2")
    assert _total(db) == 0, "reopened work is not counted"


def test_reopening_one_record_leaves_the_others_counted_and_writes_no_row_for_a_record_never_counted():
    db = _engine()
    _save(db, ["k1", "k2"], 300, "B1")
    assert _total(db) == 600
    _reopen(db, ["k1", "k3"], "B2")
    assert _total(db) == 300, "k2 stays counted, k3 was never counted and adds nothing"
    assert db.execute("SELECT COUNT(*) FROM led WHERE record_key = 'k3'").fetchone()[0] == 0


def test_a_record_saved_again_after_reopening_counts_its_new_value():
    db = _engine()
    _save(db, ["k1"], 300, "B1")
    _reopen(db, ["k1"], "B2")
    _save(db, ["k1"], 120, "B3")
    assert _total(db) == 120
