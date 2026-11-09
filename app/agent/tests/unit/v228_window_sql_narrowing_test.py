import datetime
import os
import sqlite3
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_sql  # noqa: E402

NOW = datetime.datetime(2026, 11, 4, 10, 30, tzinfo=datetime.timezone.utc)


def micros(stamp):
    return shell_sql.zone_micros(stamp, datetime.timezone.utc)


ROWS = [
    ("overdue", "New", None, False, "2026-10-28", micros(datetime.datetime(2026, 10, 1))),
    ("due_today", "New", None, False, "2026-11-04", micros(datetime.datetime(2026, 10, 1))),
    ("due_this_week", "In progress", None, False, "2026-11-07", micros(datetime.datetime(2026, 10, 1))),
    ("due_next_week", "New", None, False, "2026-11-12", micros(datetime.datetime(2026, 10, 1))),
    ("joined_this_hour", "New", None, False, None, micros(datetime.datetime(2026, 11, 4, 10, 5))),
    ("joined_this_morning", "New", None, False, None, micros(datetime.datetime(2026, 11, 4, 8, 0))),
    ("joined_monday", "New", None, False, None, micros(datetime.datetime(2026, 11, 2, 9, 0))),
    ("joined_last_month", "New", None, False, None, micros(datetime.datetime(2026, 10, 3))),
    ("closed_today", "Fixed", None, False, "2026-11-04", micros(datetime.datetime(2026, 10, 1))),
    ("snoozed", "New", "2026-11-06", False, "2026-11-04", micros(datetime.datetime(2026, 10, 1))),
    ("held", "New", None, True, "2026-11-04", micros(datetime.datetime(2026, 10, 1))),
]


def shown(window):
    db = sqlite3.connect(":memory:")
    db.create_function("unix_micros", 1, lambda value: value)
    db.execute("CREATE TABLE c (`_inspire_key`, `_inspire_status`, `_inspire_snooze`, `_inspire_held`, `_inspire_due`, `_inspire_joined`)")
    db.executemany("INSERT INTO c VALUES (?, ?, ?, ?, ?, ?)", ROWS)
    bounds = shell_sql.window_bounds(window, NOW)
    params = shell_sql._Params()
    today = params.add(bounds["today"], "DATE")
    where = " AND ".join(shell_sql.window_conditions(bounds, params, True, today))
    values = {p["name"]: int(p["value"]) if p["type"] == "BIGINT" else p["value"] for p in params.items}
    keys = [row[0] for row in db.execute(f"SELECT `_inspire_key` FROM c WHERE {where} ORDER BY `_inspire_key`", values)]
    db.close()
    return keys


@pytest.mark.parametrize("window, expected", [
    ("all", ["due_next_week", "due_this_week", "due_today", "joined_last_month", "joined_monday", "joined_this_hour", "joined_this_morning", "overdue"]),
    ("week", ["due_this_week", "due_today", "joined_monday", "joined_this_hour", "joined_this_morning", "overdue"]),
    ("today", ["due_today", "joined_this_hour", "joined_this_morning", "overdue"]),
    ("hour", ["due_today", "joined_this_hour", "overdue"]),
])
def test_the_window_sql_keeps_only_open_records_due_or_joined_inside_it_and_every_overdue_one(window, expected):
    assert shown(window) == expected


def test_each_narrower_window_shows_a_subset_of_the_wider_one():
    hour, today, week, every = (set(shown(w)) for w in ("hour", "today", "week", "all"))
    assert hour < today < week < every
