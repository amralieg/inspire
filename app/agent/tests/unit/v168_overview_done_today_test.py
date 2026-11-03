"""The Overview says how many records the signed-in person marked as fixed today in each use case. The count is a column of the
Overview's own statement, read from the close history that statement already joins, so a use case costs no extra statement: a fix that
was undone, someone else's fix, yesterday's fix, a dismissal and a note on a record that was already fixed do not count, one statement
serves every viewer, and a person who is not signed in gets no count."""
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
from v141_app_shell_test import call  # noqa: E402
from v148_app_hub_test import COLUMNS, PERSON, ROWS, TABLE, TYPES, SqliteWorkspace, hub_page, hub_shell, overview, version  # noqa: E402

sqlglot = pytest.importorskip("sqlglot")

SAM = "@".join(["sam.roe", "example.com"])
MINE = "'mine' AS `kind`"
TODAY_ROWS = ROWS + [
    version("k20", "Act now", 100.0, current=False, ends="2026-10-24 09:00:00"),
    version("k20", "Act now", 100.0, at="2026-10-24 09:00:00", source="action", action_status="Done"),
    version("k21", "Act now", 100.0, current=False, ends="2026-10-24 10:00:00"),
    version("k21", "Act now", 100.0, at="2026-10-24 10:00:00", source="action", action_status="Done", changed_by=SAM),
    version("k22", "Act now", 100.0, current=False, ends="2026-10-23 10:00:00"),
    version("k22", "Act now", 100.0, at="2026-10-23 10:00:00", source="action", action_status="Done"),
    version("k23", "Act now", 100.0, current=False, ends="2026-10-24 08:00:00"),
    version("k23", "Act now", 100.0, at="2026-10-24 08:00:00", source="action", current=False, ends="2026-10-24 11:00:00",
            action_status="Done"),
    version("k23", "Act now", 100.0, at="2026-10-24 11:00:00", source="action", action_status="New"),
    version("k24", "Act now", 100.0, current=False, ends="2026-10-24 09:30:00"),
    version("k24", "Act now", 100.0, at="2026-10-24 09:30:00", source="action", action_status="Dismissed", dismiss_reason="Known"),
    version("k25", "Act now", 100.0, current=False, ends="2026-10-24 07:00:00"),
    version("k25", "Act now", 100.0, at="2026-10-24 07:00:00", source="action", current=False, ends="2026-10-24 11:30:00",
            action_status="Done"),
    version("k25", "Monitor", 40.0, at="2026-10-24 11:30:00", action_status="Done"),
    version("k26", "Act now", 100.0, run="r0", current=False, ends="2026-10-10 09:00:00"),
    version("k26", "Act now", 100.0, at="2026-10-10 09:00:00", source="action", current=False, ends="2026-10-24 09:45:00",
            action_status="Done", changed_by=SAM),
    version("k26", "Act now", 100.0, at="2026-10-24 09:45:00", source="action", action_status="Done", action_note="Checked it again"),
]


def micros_of(value):
    if value is None:
        return None
    stamp = datetime.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    stamp = stamp if stamp.tzinfo else stamp.replace(tzinfo=datetime.timezone.utc)
    return (stamp - datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)) // datetime.timedelta(microseconds=1)


def day_us(year, month, day, hour=0):
    return str(micros_of(datetime.datetime(year, month, day, hour, tzinfo=datetime.timezone.utc).isoformat()))


class TypedWorkspace(SqliteWorkspace):
    def run_sql(self, warehouse, sql, params, limit=5000):
        typed = [dict(p, value=int(p["value"])) if p.get("type") == "BIGINT" else p for p in params]
        return super().run_sql(warehouse, sql, typed, limit)


def today_shell(tmp_path, pages=None, rows=None):
    ws = TypedWorkspace(tables={"loss_desk_out": TODAY_ROWS if rows is None else rows})
    ws.db.create_function("UNIX_MICROS", 1, micros_of)
    return hub_shell(tmp_path, pages=pages, ws=ws)


def test_the_count_of_my_fixes_today_is_a_column_of_the_overview_statement_and_adds_no_statement(tmp_path):
    s, ws, _made = today_shell(tmp_path)
    status, out = overview(s)
    assert status == 200 and out["errors"] == {}, out
    assert out["pages"]["n01_u05"]["done"]["mine_today"] == 2, "k20 fixed this morning, and k25, fixed before a later run that kept it fixed"
    (data, _params), = ws.queries("'item' AS `kind`")
    assert MINE in data and len(ws.queries(MINE)) == 1, "the count rides in the same statement as the things to fix"
    assert "lower(v.`_inspire_closer`)" in data and "get_json_object(" not in data and "_inspire_undo`" not in data, \
        "it counts from the close history, never from the batch values or a list of undone batches"
    assert len([q for q in ws.sql if "AS `stamp_us`" not in q[0]]) == 4, "a use case costs the table's columns, the list's columns, its money summary and one data query"


def test_one_overview_statement_serves_every_viewer_and_each_reads_their_own_count(tmp_path):
    s, ws, _made = today_shell(tmp_path)
    assert overview(s)[1]["pages"]["n01_u05"]["done"]["mine_today"] == 2
    asked = len(ws.sql)
    sam = overview(s, headers={"x-forwarded-email": SAM.upper()})[1]["pages"]["n01_u05"]
    assert sam["done"]["mine_today"] == 1, "the same person in another case of letters reads the same count"
    assert len(ws.sql) == asked, "the second viewer within the minute reads the cached statement, so the count never splits the cache"
    (_sql, params), = ws.queries(MINE)
    assert PERSON not in [p["value"] for p in params] and SAM not in [p["value"] for p in params], "no viewer's name is a parameter"


def test_a_person_who_is_not_signed_in_gets_no_count(tmp_path):
    s, _ws, _made = today_shell(tmp_path)
    status, out = call(s, "POST", "overview", headers={}, body={})
    assert status == 200 and out["pages"]["n01_u05"]["done"]["mine_today"] is None
    status, out = overview(s, headers={"x-forwarded-email": "   "})
    assert status == 200 and out["pages"]["n01_u05"]["done"]["mine_today"] is None


def test_the_day_that_counts_is_two_bounds_of_the_person_day_with_a_window_or_without(tmp_path):
    s, ws, _made = today_shell(tmp_path)
    for body in ({"window": "week"}, {}):
        page = overview(s, **body)[1]["pages"]["n01_u05"]
        assert page["done"]["mine_today"] == 2
        sql, params = ws.queries(MINE)[-1]
        values = [(p["value"], p["type"]) for p in params]
        assert (int(day_us(2026, 10, 24)), "BIGINT") in values and (int(day_us(2026, 10, 25)), "BIGINT") in values
        assert "unix_micros(v.`_inspire_closed`) >= :p" in sql and "CAST(v.`_inspire_closed` AS DATE) =" not in sql


def test_more_people_than_the_count_keeps_leaves_the_rest_unknown_rather_than_zero(tmp_path, monkeypatch):
    monkeypatch.setitem(shell_sql.CAPS, "closers_today", 1)
    s, _ws, _made = today_shell(tmp_path)
    assert overview(s)[1]["pages"]["n01_u05"]["done"]["mine_today"] == 2, "the person with the most fixes today is kept"
    (tmp_path / "sam").mkdir()
    s, _ws, _made = today_shell(tmp_path / "sam")
    assert overview(s, headers={"x-forwarded-email": SAM})[1]["pages"]["n01_u05"]["done"]["mine_today"] is None, \
        "one person kept, and it is not Sam, so the App cannot tell how many Sam fixed"
    (tmp_path / "nobody").mkdir()
    s, _ws, _made = today_shell(tmp_path / "nobody")
    other = "@".join(["kim.ito", "example.com"])
    assert overview(s, headers={"x-forwarded-email": other})[1]["pages"]["n01_u05"]["done"]["mine_today"] is None
    monkeypatch.setitem(shell_sql.CAPS, "closers_today", 50)
    (tmp_path / "room").mkdir()
    s, _ws, _made = today_shell(tmp_path / "room")
    assert overview(s, headers={"x-forwarded-email": other})[1]["pages"]["n01_u05"]["done"]["mine_today"] == 0, \
        "with every person kept, someone who fixed nothing today fixed 0"


BETWEEN = (int(day_us(2026, 10, 24)), int(day_us(2026, 10, 25)))


def statement(names, done_between=BETWEEN, window=None, page=None):
    page = page or hub_page()
    fields = shell_sql.change_fields([{"name": c, "type": TYPES.get(c, "STRING")} for c in names])
    context = shell_sql.list_context(page, set(names), fields, True)
    return shell_sql.overview_query(page, {}, {}, context, fields, "2026-10-01", "2026-08-03", window=window, done_between=done_between)


def test_the_statement_with_the_count_parses_as_databricks_sql_and_renders_for_lakebase():
    sql, params = statement(COLUMNS)
    sqlglot.parse_one(re.sub(r":p\d+", "'x'", sql), read="databricks")
    held = {TABLE: {"pg": "app.loss_desk_out", "columns": [{"name": c} for c in COLUMNS]}}
    text, values, read = shell_pg.render(sql, params, held)
    assert read == {TABLE} and "'mine' AS \"kind\"" in text and "EXTRACT(EPOCH FROM" in text and BETWEEN[0] in values.values()
    assert sql.count(" UNION ALL ") == 9 and f"LIMIT {shell_sql.CAPS['closers_today']}" in sql
    week = shell_sql.window_bounds("week", datetime.datetime(2026, 10, 24, 12, 0))
    sql, params = statement(COLUMNS, window=dict(week, limit=None))
    since, until = re.findall(r"unix_micros\(v\.`_inspire_closed`\) [<>]=? (:p\d+)", sql)
    named = {p["name"]: p["value"] for p in params}
    assert (named[since[1:]], named[until[1:]]) == tuple(str(b) for b in BETWEEN), "the bounds are values, never the names of other parameters"


def test_a_use_case_that_keeps_no_actions_or_names_no_day_has_no_count():
    sql, _params = statement(COLUMNS, done_between=())
    assert MINE not in sql
    view = shell_core.overview_view([{"kind": "mine", "k": PERSON, "n": 4}], datetime.date(2026, 10, 24), datetime.date(2026, 8, 3), True)
    assert view["done"]["mine_today"] is None, "without the person the view names no count"
    view = shell_core.overview_view([{"kind": "mine", "k": PERSON, "n": 4}], datetime.date(2026, 10, 24), datetime.date(2026, 8, 3), True,
                                    PERSON.upper())
    assert view["done"]["mine_today"] == 4


OTHER_CASE = "N02-U01"
SHARED_ROWS = TODAY_ROWS + [
    version("k40", "Act now", 50.0, current=False, ends="2026-10-24 08:30:00", use_case_id=OTHER_CASE),
    version("k40", "Act now", 50.0, at="2026-10-24 08:30:00", source="action", action_status="Done", use_case_id=OTHER_CASE),
    version("k20", "Act now", 70.0, current=False, ends="2026-10-24 10:30:00", use_case_id=OTHER_CASE),
    version("k20", "Act now", 70.0, at="2026-10-24 10:30:00", source="action", action_status="Done", use_case_id=OTHER_CASE),
    version("k41", "Act now", 50.0, current=False, ends="2026-10-24 09:10:00", use_case_id=OTHER_CASE),
    version("k41", "Act now", 50.0, at="2026-10-24 09:10:00", source="action", action_status="Dismissed", dismiss_reason="Known",
            use_case_id=OTHER_CASE),
]


def test_two_use_cases_in_one_table_each_count_only_their_own_fixes_today(tmp_path):
    pages = [hub_page(), hub_page("n02_u01", use_case=OTHER_CASE)]
    s, ws, _made = today_shell(tmp_path / "alone")
    alone = overview(s)[1]["pages"]["n01_u05"]["done"]
    s, ws, _made = today_shell(tmp_path / "shared", pages=pages, rows=SHARED_ROWS)
    status, out = overview(s)
    assert status == 200 and out["errors"] == {}, out
    mine, other = out["pages"]["n01_u05"]["done"], out["pages"]["n02_u01"]["done"]
    assert mine["mine_today"] == alone["mine_today"] == 2, "the other use case's fixes in the same table are not mine in this use case"
    assert other["mine_today"] == 2, "the other use case counts its own k40 and its own k20, whose key the first use case also has"
    assert (mine["fixed"], mine["dismissed"]) == (alone["fixed"], alone["dismissed"]), "every close count of the Overview is the use case's own"
    assert other["dismissed"] == 1
    for sql, params in ws.queries(MINE):
        assert "`use_case_id` = :p" in sql and {"N01-U05", OTHER_CASE} & {p["value"] for p in params}
    assert len(ws.queries(MINE)) == 2, "still one statement per use case"


ZONE_ROWS = TODAY_ROWS + [
    version("k27", "Act now", 100.0, current=False, ends="2026-10-24 11:40:00"),
    version("k27", "Act now", 100.0, at="2026-10-24 11:40:00", source="action", action_status="Done"),
    version("k28", "Act now", 100.0, current=False, ends="2026-10-24 03:00:00"),
    version("k28", "Act now", 100.0, at="2026-10-24 03:00:00", source="action", action_status="Done"),
]


@pytest.mark.parametrize("zone, today, count, bounds", [
    (None, "2026-10-24", 4, ((2026, 10, 24), (2026, 10, 25))),
    ("America/Los_Angeles", "2026-10-24", 3, ((2026, 10, 24, 7), (2026, 10, 25, 7))),
    ("Pacific/Auckland", "2026-10-25", 1, ((2026, 10, 24, 11), (2026, 10, 25, 11))),
])
def test_today_is_the_day_in_the_person_time_zone_and_utc_only_when_none_is_sent(tmp_path, zone, today, count, bounds):
    s, ws, _made = today_shell(tmp_path, rows=ZONE_ROWS)
    status, out = overview(s, **({"time_zone": zone} if zone else {}))
    assert status == 200 and out["errors"] == {}, out
    assert out["today"] == today and out["time_zone"] == {"name": zone or "UTC", "sent": bool(zone)}
    assert out["pages"]["n01_u05"]["done"]["mine_today"] == count, "at 12:00 UTC, 03:00 UTC is yesterday in Los Angeles and 11:40 UTC is today in Auckland"
    (_sql, params), = ws.queries(MINE)
    values = [p["value"] for p in params if p["type"] == "BIGINT"]
    assert values[-2:] == [int(day_us(*bounds[0])), int(day_us(*bounds[1]))]


def test_the_window_and_the_count_read_the_same_day_in_the_same_time_zone(tmp_path):
    s, ws, _made = today_shell(tmp_path, rows=ZONE_ROWS)
    out = overview(s, window="today", time_zone="Pacific/Auckland")[1]
    assert out["window"]["today"] == out["today"] == "2026-10-25"
    assert out["pages"]["n01_u05"]["done"]["mine_today"] == 1


@pytest.mark.parametrize("zone, error", [
    ("Mars/Olympus", "time_zone Mars/Olympus is not a time zone the App knows; send its name, such as Asia/Dubai"),
    ("../etc/passwd", "time_zone takes the name of a time zone, such as Asia/Dubai"),
    (5, "time_zone takes the name of a time zone, such as Asia/Dubai"),
    ("Asia/" + "x" * 40, "time_zone takes the name of a time zone, such as Asia/Dubai"),
])
def test_a_time_zone_the_app_cannot_read_is_refused_before_any_query(tmp_path, zone, error):
    s, ws, _made = today_shell(tmp_path)
    status, out = overview(s, time_zone=zone)
    assert (status, out["error"]) == (400, error)
    assert ws.queries(MINE) == []
    status, out = call(s, "POST", "records", headers={"x-forwarded-email": PERSON}, body={"page": "n01_u05", "window": "today", "time_zone": zone})
    assert (status, out["error"]) == (400, error), "the list refuses it the same way"


def test_the_day_follows_the_clock_change_of_the_time_zone():
    now = datetime.datetime(2026, 10, 25, 12, 0, tzinfo=datetime.timezone.utc)
    zoned = shell_sql.window_bounds("today", now, zone=shell_sql.time_zone_of({"time_zone": "Europe/London"})[0])
    fixed = shell_sql.window_bounds("today", now, datetime.timezone(datetime.timedelta(hours=1)))
    hour = 3600 * 1000000
    assert (zoned["start_us"], zoned["end_us"] - zoned["start_us"]) == (int(day_us(2026, 10, 24, 23)), 25 * hour), "the day the clocks go back is 25 hours"
    assert fixed["end_us"] - fixed["start_us"] == 24 * hour
    assert "offset_min" not in shell_sql.window_bounds.__code__.co_varnames, "a day is bounded by a time zone, never a fixed offset"


def test_a_server_without_time_zone_data_counts_the_day_in_utc_and_says_so(tmp_path, monkeypatch):
    def missing(name):
        raise shell_sql.zoneinfo.ZoneInfoNotFoundError(name)
    monkeypatch.setattr(shell_sql.zoneinfo, "ZoneInfo", missing)
    monkeypatch.setattr(shell_sql, "zone_data", lambda: False)
    s, _ws, _made = today_shell(tmp_path, rows=ZONE_ROWS)
    out = overview(s, time_zone="Pacific/Auckland")[1]
    assert out["time_zone"] == {"name": "UTC", "sent": False} and out["today"] == "2026-10-24"
    assert out["pages"]["n01_u05"]["done"]["mine_today"] == 4

