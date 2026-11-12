import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_sql  # noqa: E402

EXAMPLE = os.path.join(ROOT, "agent", "app_shell", "examples", "entity_matching.json")


def test_the_open_count_is_the_open_records_the_list_shows_and_held_ones_are_on_watch():
    rows = [{"v": "New", "c": None, "l": 1, "n": 3, "m": 0}, {"v": "New", "c": None, "l": 0, "n": 92, "m": 0},
            {"v": "Done", "c": None, "l": 0, "n": 904, "m": 0}, {"v": "Dismissed", "c": None, "l": 0, "n": 1, "m": 0}]
    out = shell_sql.status_counts_of(rows)
    assert out["open"] == 3 and out["watch"] == 92 and out["all"] == 1000
    assert out["statuses"]["Done"] == 904


def test_held_back_open_records_make_the_open_count_zero_so_it_matches_the_empty_list():
    rows = [{"v": "New", "c": None, "l": 0, "n": 95, "m": 0}, {"v": "Done", "c": None, "l": 0, "n": 904, "m": 0},
            {"v": "Dismissed", "c": None, "l": 0, "n": 1, "m": 0}]
    out = shell_sql.status_counts_of(rows)
    assert out["open"] == 0 and out["watch"] == 95


def test_the_count_and_the_list_share_one_open_snooze_and_hold_predicate():
    params = shell_sql._Params()
    listed = shell_sql.window_conditions({"window": "all"}, params, True, "DATE_X", "f")
    assert "NOT COALESCE(f.`_inspire_held`, FALSE)" in listed
    assert "(f.`_inspire_snooze` IS NULL OR f.`_inspire_snooze` <= DATE_X)" in listed
    assert "COALESCE(f.`_inspire_status`, 'New') IN (" in listed[0]
    assert shell_sql.window_conditions({"window": "all"}, params, False, "DATE_X", "c")[0] == listed[0].replace("f.`", "c.`", 1)
