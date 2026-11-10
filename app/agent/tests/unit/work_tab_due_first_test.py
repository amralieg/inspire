"""A Work list with no window keeps the server's due-first order: an overdue record shows first even when it ranks last and
carries the smallest value. The list asks for it with due_first, and a list the user sorted keeps the sort the user chose."""
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
for folder in (SERVER, os.path.dirname(os.path.abspath(__file__))):
    if folder not in sys.path:
        sys.path.insert(0, folder)

from v141_app_shell_test import SETTINGS, call  # noqa: E402
from v148_app_hub_test import PERSON, SqliteWorkspace, hub_shell, version  # noqa: E402

pytest.importorskip("sqlglot")

DECIDE = dict(SETTINGS, options=dict(SETTINGS["options"], decisions=True))
ROWS = [
    version("k1", "Act now", 900.0, action_owner=PERSON, action_status="New", action_due="2099-01-01"),
    version("k2", "Act now", 500.0, action_owner=PERSON, action_status="New", action_due="2099-01-01"),
    version("k9", "Act now", 10.0, action_owner=PERSON, action_status="New", action_due="2020-01-01"),
]


def keys_in_order(tmp_path, **body):
    s, _ws, _made = hub_shell(tmp_path, settings=DECIDE, ws=SqliteWorkspace(tables={"loss_desk_out": ROWS}))
    status, out = call(s, "POST", "records", headers={"x-forwarded-email": PERSON}, body=dict({"page": "n01_u05", "limit": 25}, **body))
    assert status == 200, out
    return [r["record_key"] for r in out["rows"]]


def test_an_overdue_record_shows_first_on_a_work_list_with_no_window_even_when_it_ranks_last(tmp_path):
    assert keys_in_order(tmp_path, due_first=True)[0] == "k9"


def test_the_due_first_order_puts_the_open_records_by_value_after_the_overdue_one(tmp_path):
    assert keys_in_order(tmp_path, due_first=True) == ["k9", "k1", "k2"]


def test_a_list_the_user_sorted_keeps_the_sort_and_is_not_reordered_by_due_date(tmp_path):
    assert keys_in_order(tmp_path, due_first=True, sort={"key": "rank", "dir": "asc"}) == ["k1", "k2", "k9"]
