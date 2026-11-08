"""Performance shows one use case for the signed-in person: the money of their fixes, the items they cleared as a share of what the whole
team cleared in the same period (a share, never a rank), the weekly trend of their closes, their median time to close next to the team
median, their outcome mix, their false-alarm rate and the overdue items they own. Every figure comes from the same my_work statement, so
the person's numbers and the team's numbers stand on the same rules: a close someone undid never counts for anyone."""
import datetime
import os
import re
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
for folder in (SERVER, os.path.dirname(os.path.abspath(__file__))):
    if folder not in sys.path:
        sys.path.insert(0, folder)

import shell_core  # noqa: E402
import shell_pg  # noqa: E402
import shell_sql  # noqa: E402
from v148_app_hub_test import COLUMNS, PERSON, TABLE, hub_page, version  # noqa: E402
from v168_overview_done_today_test import SAM  # noqa: E402
from v179_my_work_test import WORK_ROWS, my_work, work_shell  # noqa: E402

sqlglot = pytest.importorskip("sqlglot")

KIM = "@".join(["kim.ito", "example.com"])
EMPTY_TEAM = {"closed": {"fixed": 0, "dismissed": 0, "could_not": 0}, "total": 0, "people": 0, "close": {"n": 0, "median_hours": None}}
NO_OUTCOMES = {"left": 0, "missing": 0, "resolved": 0, "flagged": 0, "unchecked": 0}


def page_of(s, who=PERSON, **body):
    status, out = my_work(s, who=who, **body)
    assert status == 200 and out["errors"] == {}, out
    return out["pages"]["n01_u05"]


def owned(key, due, status="In progress", owner=PERSON, **values):
    return version(key, "Act now", 100.0, at="2026-10-21 09:00:00", source="action", action_status=status, action_owner=owner,
                   action_due=due, **values)


def test_my_closes_are_a_share_of_what_the_whole_team_closed_in_the_same_period(tmp_path):
    s, _ws, _made = work_shell(tmp_path)
    page = page_of(s, window="week")
    assert page["team"] == {"closed": {"fixed": 3, "dismissed": 2, "could_not": 1}, "total": 6, "people": 2,
                            "close": {"n": 6, "median_hours": 52.0}}, "Sam's a5 joins my five closes; the undone a7 counts for no one"
    mine = page["worked"]["fixed"] + page["worked"]["dismissed"] + page["worked"]["could_not"]
    assert (mine, page["team"]["total"]) == (5, 6)
    assert "rank" not in page["team"] and "rank" not in page, "a share of the team total, never a leaderboard place"
    assert page_of(s, who=SAM, window="week")["team"] == page["team"], "everyone reads the same team total"


def test_the_team_median_uses_every_close_of_the_period_and_mine_only_my_own(tmp_path):
    s, _ws, _made = work_shell(tmp_path)
    page = page_of(s, window="week")
    assert page["close"] == {"n": 5, "median_hours": 53.0} and page["team"]["close"] == {"n": 6, "median_hours": 52.0}, \
        "Sam's 51 hours on a5 moves the team middle to the mean of 51 and 53"
    everything = page_of(s, window="all")
    assert everything["team"]["total"] == 7 and everything["team"]["close"]["median_hours"] == 53.0


def test_the_weekly_trend_counts_my_closes_per_monday_week_and_keeps_empty_weeks_between(tmp_path):
    s, _ws, _made = work_shell(tmp_path)
    assert page_of(s, window="week")["weeks"] == [{"week": "2026-10-19", "n": 5}]
    assert page_of(s, window="all")["weeks"] == [{"week": "2026-10-05", "n": 1}, {"week": "2026-10-12", "n": 0}, {"week": "2026-10-19", "n": 5}], \
        "a6 on October 10 falls in the week of October 5; the week of October 12 had none and still shows as 0"
    assert page_of(s, who=SAM, window="all")["weeks"] == [{"week": "2026-10-19", "n": 1}]


def test_the_weekly_trend_keeps_at_most_the_capped_number_of_latest_weeks():
    days = [{"label": "2025-01-06", "n": 2}, {"label": "2026-10-21", "n": 1}, {"label": None, "n": 9}, {"label": "not a day", "n": 9}]
    weeks = shell_core.weeks_of(days)
    assert len(weeks) == shell_sql.CAPS["my_work_weeks"] and weeks[-1] == {"week": "2026-10-19", "n": 1}
    assert all(w["n"] == 0 for w in weeks[:-1]), "the week of January 2025 is older than the cap, and bad days are skipped"
    assert shell_core.weeks_of([]) == []
    assert shell_core.weeks_of([{"label": "2026-02-30", "n": 4}, {"label": "2026-10-25T00:00:00Z", "n": 2}]) == [{"week": "2026-10-19", "n": 2}], \
        "an impossible day is skipped and a timestamp counts on its day"


def test_the_outcome_mix_reads_what_a_later_run_found_on_my_fixes(tmp_path):
    s, _ws, _made = work_shell(tmp_path)
    assert page_of(s, window="week")["outcomes"] == dict(NO_OUTCOMES, resolved=1, unchecked=1), \
        "a1 was resolved by the run of October 22; a2 has no later run yet"
    assert page_of(s, who=SAM, window="week")["outcomes"] == dict(NO_OUTCOMES, unchecked=1)


def test_overdue_items_i_own_are_open_past_due_and_not_snoozed(tmp_path):
    rows = WORK_ROWS + [
        owned("b1", "2026-10-20"), owned("b2", "2026-10-30"), owned("b3", "2026-10-01", status="Done"),
        owned("b4", "2026-10-19", owner=SAM), owned("b5", "2026-10-21", status="New", snooze_until="2026-10-30"),
        owned("b6", "2026-10-22", owner=PERSON.upper(), status=None), owned("b7", None), owned("b8", "2026-10-23", status="Dismissed"),
        owned("b9", "2026-10-18", status="New", snooze_until="2026-10-23"),
    ]
    s, _ws, _made = work_shell(tmp_path, rows=rows)
    overdue = page_of(s, window="week")["overdue"]
    assert [i["key"] for i in overdue["items"]] == ["b9", "b1", "b6"] and overdue["n"] == 3, \
        "earliest due first; b2 is not due yet, b3 and b8 are closed, b4 is Sam's, b5 is snoozed past today, b7 has no due day"
    assert overdue["items"][1] == {"key": "b1", "label": "Item b1", "due": "2026-10-20"}
    assert page_of(s, who=SAM, window="week")["overdue"]["n"] == 1


def test_overdue_items_stop_at_the_cap_but_the_count_stays_whole(tmp_path, monkeypatch):
    monkeypatch.setitem(shell_sql.CAPS, "my_work_overdue", 2)
    rows = WORK_ROWS + [owned(f"c{i}", f"2026-10-{10 + i:02d}") for i in range(1, 6)]
    s, _ws, _made = work_shell(tmp_path, rows=rows)
    overdue = page_of(s, window="week")["overdue"]
    assert [i["key"] for i in overdue["items"]] == ["c1", "c2"] and overdue["n"] == 5


def test_a_use_case_with_no_history_yet_shows_zeros_and_no_trend(tmp_path):
    s, _ws, _made = work_shell(tmp_path, rows=[version("z1", "Act now", 10.0)])
    page = page_of(s, window="all")
    assert page["team"] == EMPTY_TEAM and page["weeks"] == [] and page["outcomes"] == NO_OUTCOMES
    assert page["overdue"] == {"n": 0, "items": []} and page["close"] == {"n": 0, "median_hours": None} and page["best"] is None


def test_null_owner_due_label_and_money_never_break_the_view(tmp_path):
    rows = [version("n1", "Act now", None, current=False, ends="2026-10-21 10:00:00", entity_label=None),
            version("n1", "Act now", None, at="2026-10-21 10:00:00", source="action", action_status="Done", entity_label=None,
                    action_owner=None, action_due=None),
            owned("n2", "2026-10-20", entity_label=None)]
    s, _ws, _made = work_shell(tmp_path, rows=rows)
    page = page_of(s, window="week")
    assert page["worked"]["fixed"] == 1 and page["team"]["total"] == 1 and page["best"] is None
    assert page["money"]["measured"] == {"n": 0, "money": None}
    assert page["overdue"]["items"] == [{"key": "n2", "label": None, "due": "2026-10-20"}]


def test_a_single_person_who_closed_everything_holds_the_whole_share(tmp_path):
    rows = [r for r in WORK_ROWS if r["record_key"] != "a5"]
    s, _ws, _made = work_shell(tmp_path, rows=rows)
    page = page_of(s, window="week")
    assert page["team"]["people"] == 1 and page["team"]["total"] == 5
    assert page["team"]["close"] == page["close"] == {"n": 5, "median_hours": 53.0}, "a team of one: the team median is my own"


def test_someone_who_closed_nothing_sees_the_team_of_one_and_a_zero_share(tmp_path):
    rows = [r for r in WORK_ROWS if r["record_key"] in ("a5",)]
    s, _ws, _made = work_shell(tmp_path, rows=rows)
    page = page_of(s, who=KIM, window="week")
    assert page["team"]["people"] == 1 and page["team"]["total"] == 1 and page["worked"]["changes"] == 0
    assert page["weeks"] == [] and page["close"] == {"n": 0, "median_hours": None} and page["team"]["close"]["median_hours"] is not None


def test_a_page_asks_for_that_use_case_alone_and_an_unknown_page_is_refused(tmp_path):
    s, ws, _made = work_shell(tmp_path)
    status, out = my_work(s, window="week", page="n01_u05")
    assert status == 200 and set(out["pages"]) == {"n01_u05"} and len(ws.queries("'tally' AS `kind`")) == 1
    before = len(ws.queries("'tally' AS `kind`"))
    assert my_work(s, window="week", page="n09_u09") == (400, {"error": "page is the id of a use case of this App, or leave it out for every use case"})
    assert len(ws.queries("'tally' AS `kind`")) == before, "a refused page runs no query"


def test_the_overdue_branch_is_left_out_when_the_table_keeps_no_owner_or_due_day():
    page = hub_page()
    sql, _params = shell_sql.my_work_query(page, set(COLUMNS) - {"action_due"}, PERSON, {"window": "all", "today": "2026-10-24"}, 50)
    assert "'overdue' AS `kind`" not in sql and "wo AS" not in sql
    full = shell_sql.my_work_query(page, set(COLUMNS), PERSON, {"window": "all", "today": "2026-10-24"}, 50)[0]
    assert "'overdue' AS `kind`" in full and "'team' AS `kind`" in full and "'day' AS `kind`" in full


def test_the_extended_statement_parses_as_databricks_sql_and_renders_for_lakebase():
    page = hub_page()
    bounds = shell_sql.window_bounds("week", datetime.datetime(2026, 10, 24, 12, tzinfo=datetime.timezone.utc))
    sql, params = shell_sql.my_work_query(page, set(COLUMNS), PERSON, bounds, 50)
    sqlglot.parse_one(re.sub(r":p\d+", "'x'", sql), read="databricks")
    held = {TABLE: {"pg": "app.loss_desk_out", "columns": [{"name": c} for c in COLUMNS]}}
    _text, values, read = shell_pg.render(sql, params, held)
    assert read == {TABLE} and PERSON in values.values() and datetime.date(2026, 10, 24) in values.values()
    assert f"LIMIT {shell_sql.CAPS['my_work_overdue']}" in sql and f"LIMIT {shell_sql.CAPS['my_work_weeks']}" in sql


def test_the_row_cap_of_the_statement_holds_every_fixed_branch_with_room():
    fixed = 3 + 3 + 1 + 1 + 1 + 1 + 1 + shell_sql.CAPS["my_work_weeks"] + len(shell_sql.GONE_STATES) + 2 + shell_sql.CAPS["my_work_overdue"]
    assert shell_core.MY_WORK_FIXED_ROWS >= fixed


def late_sunday_rows():
    return [version("z1", "Act now", 100.0, run="r3", current=False, ends="2026-10-18 23:30:00"),
            version("z1", "Act now", 100.0, run="r3", at="2026-10-18 23:30:00", source="action", action_status="Done")]


def test_a_close_late_on_sunday_utc_counts_in_the_monday_week_of_the_person_time_zone(tmp_path):
    s, _ws, _made = work_shell(tmp_path, rows=late_sunday_rows())
    assert page_of(s, window="all", time_zone="Asia/Dubai")["weeks"] == [{"week": "2026-10-19", "n": 1}], \
        "23:30 UTC on Sunday October 18 is 03:30 on Monday October 19 in Dubai"
    assert page_of(s, window="all")["weeks"] == [{"week": "2026-10-12", "n": 1}], "with no zone the same close stays in the UTC week of October 12"
    assert page_of(s, window="all", time_zone="America/New_York")["weeks"] == [{"week": "2026-10-12", "n": 1}], \
        "19:30 on Sunday in New York is still the week of October 12 (must-exclude)"


def test_an_unknown_or_malformed_zone_counts_in_utc_without_an_error(tmp_path):
    s, _ws, _made = work_shell(tmp_path, rows=late_sunday_rows())
    for zone in ("Mars/Olympus_Mons", "not a zone", 42):
        status, out = my_work(s, window="all", time_zone=zone)
        assert status == 200 and out["errors"] == {} and out["period"]["zone"] == "UTC", (zone, out)
        assert out["pages"]["n01_u05"]["weeks"] == [{"week": "2026-10-12", "n": 1}], zone
    with pytest.raises(ValueError, match="is not a time zone the App knows"):
        shell_sql.time_zone_of({"time_zone": "Mars/Olympus_Mons"})


def test_the_week_edges_are_local_mondays_within_the_period_and_the_cap():
    edges = shell_sql.week_edges({"zone": "Asia/Dubai", "today": "2026-10-24", "start_day": "2026-10-14", "end_day": "2026-10-26"}, 53)
    assert edges == [("2026-10-19", int(datetime.datetime(2026, 10, 18, 20, tzinfo=datetime.timezone.utc).timestamp() * 1e6)),
                     ("2026-10-12", int(datetime.datetime(2026, 10, 11, 20, tzinfo=datetime.timezone.utc).timestamp() * 1e6))]
    capped = shell_sql.week_edges({"zone": "UTC", "today": "2026-10-24"}, 3)
    assert [label for label, _us in capped] == ["2026-10-19", "2026-10-12", "2026-10-05"]
    spring = shell_sql.week_edges({"zone": "Europe/Berlin", "today": "2026-03-31", "start_day": "2026-03-23", "end_day": "2026-04-01"}, 53)
    assert [us for _label, us in spring] == [int(datetime.datetime(2026, 3, 29, 22, tzinfo=datetime.timezone.utc).timestamp() * 1e6),
                                            int(datetime.datetime(2026, 3, 22, 23, tzinfo=datetime.timezone.utc).timestamp() * 1e6)], \
        "the Monday after the clocks move starts at 22:00 UTC, the one before at 23:00 UTC"
