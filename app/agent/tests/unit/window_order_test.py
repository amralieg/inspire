"""The two ranked orders of a Work list. A window puts overdue records on top, earliest due first, as the Window copy promises,
then the rest by value. The overview's money ranking keeps value first, because its day column is not a due date."""
import os
import sqlite3
import sys

SERVER = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_sql  # noqa: E402

ROWS = [("a", "2020-01-01", 10.0), ("b", "2020-06-01", 900.0), ("c", "2099-01-01", 500.0), ("d", "2099-02-01", 800.0)]


def keys_in(order):
    db = sqlite3.connect(":memory:")
    db.execute("CREATE TABLE t (k TEXT, due TEXT, stake REAL)")
    db.executemany("INSERT INTO t VALUES (?, ?, ?)", ROWS)
    return [row[0] for row in db.execute(f"SELECT k FROM t ORDER BY {order}")]


def test_a_work_list_puts_overdue_records_first_earliest_due_first_then_the_rest_by_value():
    order = shell_sql.due_first_order("stake", "due", "'2026-01-01'", "k")
    assert keys_in(order) == ["a", "b", "d", "c"]


def test_the_overview_money_ranking_keeps_value_first_and_is_not_reordered_by_due_date():
    order = shell_sql.stake_first_order("stake", "due", "'2026-01-01'", "k")
    assert keys_in(order) == ["b", "d", "c", "a"]
