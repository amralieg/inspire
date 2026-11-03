"""My work shows the signed-in person what they did in a period, across every use case of the App: the records they fixed, closed as
not a real issue or could not fix, assigned and noted, the money of their fixes split into measured, reported and estimated, their records
per active hour, their median time to close and their largest closed record. Every number comes from the change history filtered to the
person and the period inside one bounded statement per use case; a fix someone undid, someone else's fix and a fix outside the period never
count. Owners set minutes_per_record through the settings, and My work turns it into an estimate of the hours saved."""
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
from v120_artifacts_support import FakeSpark  # noqa: E402
from v141_app_shell_test import SETTINGS, call  # noqa: E402
from v148_app_hub_test import COLUMNS, PERSON, TABLE, TYPES, hub_page, hub_shell, to_sqlite, version  # noqa: E402
from v168_overview_done_today_test import SAM, TypedWorkspace, micros_of  # noqa: E402

sqlglot = pytest.importorskip("sqlglot")

OWNER = "@".join(["owner", "example.com"])
WORK_ROWS = [
    version("a1", "Act now", 1000.0, run="r3", current=False, ends="2026-10-20 09:00:00"),
    version("a1", "Act now", 1000.0, run="r3", at="2026-10-20 09:00:00", source="action", current=False, ends="2026-10-22 06:00:00",
            action_status="Done"),
    version("a1", "Monitor", 100.0, at="2026-10-22 06:00:00", action_status="Done", action_outcome="Resolved"),
    version("a2", "Act now", 2000.0, current=False, ends="2026-10-21 10:00:00"),
    version("a2", "Act now", 2000.0, at="2026-10-21 10:00:00", source="action", action_status="Done", realized_value=500.0),
    version("a3", "Act now", 300.0, current=False, ends="2026-10-22 11:00:00"),
    version("a3", "Act now", 300.0, at="2026-10-22 11:00:00", source="action", action_status="Dismissed", dismiss_reason="Known"),
    version("a4", "Act now", 400.0, current=False, ends="2026-10-23 08:15:00"),
    version("a4", "Act now", 400.0, at="2026-10-23 08:15:00", source="action", action_status="Could not fix"),
    version("a5", "Act now", 9000.0, current=False, ends="2026-10-22 09:00:00"),
    version("a5", "Act now", 9000.0, at="2026-10-22 09:00:00", source="action", action_status="Done", changed_by=SAM, realized_value=9000.0),
    version("a6", "Act now", 800.0, run="r1", current=False, ends="2026-10-10 06:00:00"),
    version("a6", "Act now", 800.0, run="r1", at="2026-10-10 06:00:00", source="action", action_status="Done", realized_value=50.0),
    version("a7", "Act now", 700.0, current=False, ends="2026-10-21 12:00:00"),
    version("a7", "Act now", 700.0, at="2026-10-21 12:00:00", source="action", current=False, ends="2026-10-21 13:00:00",
            action_status="Done", realized_value=7000.0),
    version("a7", "Act now", 700.0, at="2026-10-21 13:00:00", source="action", action_status="New"),
    version("a8", "Act now", 600.0, current=False, ends="2026-10-22 14:00:00"),
    version("a8", "Act now", 600.0, at="2026-10-22 14:00:00", source="action", current=False, ends="2026-10-22 14:30:00",
            action_status="In progress", action_owner=SAM),
    version("a8", "Act now", 600.0, at="2026-10-22 14:30:00", source="action", action_status="In progress", action_owner=SAM,
            action_note="Called the supplier"),
    version("a9", "Act now", 300.0, current=False, ends="2026-10-20 21:00:00"),
    version("a9", "Act now", 300.0, at="2026-10-20 21:00:00", source="action", action_status="Dismissed", dismiss_reason="Known"),
]
WEEK_ORDER = ["a4", "a8", "a8", "a3", "a7", "a7", "a2", "a9", "a1"]


class AssumptionsWorkspace(TypedWorkspace):
    def __init__(self, tables, edits=()):
        super().__init__(tables=tables)
        self.db.execute('CREATE TABLE "loss_desk_out_assumptions" (use_case_id, name, value, changed_by, changed_at, note, text_value)')
        self.db.executemany('INSERT INTO "loss_desk_out_assumptions" VALUES (?, ?, ?, ?, ?, ?, ?)', list(edits))

    def run_sql(self, warehouse, sql, params, limit=5000):
        if not sql.startswith("INSERT INTO"):
            return super().run_sql(warehouse, sql, params, limit)
        with self.lock:
            self.sql.append((sql, params, limit))
            self.db.execute(to_sqlite(sql), {p["name"]: p["value"] for p in params})
        return {"columns": [], "rows": [{"num_affected_rows": 1, "num_inserted_rows": 1}], "truncated": False}


def work_shell(tmp_path, rows=None, decisions=True, edits=(), pages=None):
    ws = AssumptionsWorkspace({"loss_desk_out": WORK_ROWS if rows is None else rows}, edits)
    ws.db.create_function("UNIX_MICROS", 1, micros_of)
    settings = dict(SETTINGS, options=dict(SETTINGS["options"], decisions=decisions), use_case_owners={"n01_u05": [OWNER]})
    return hub_shell(tmp_path, settings=settings, pages=pages, ws=ws)


def my_work(s, who=PERSON, **body):
    return call(s, "POST", "my_work", headers={"x-forwarded-email": who} if who else {}, body=body)


def test_the_week_counts_only_my_standing_closes_assignments_and_notes(tmp_path):
    s, _ws, _made = work_shell(tmp_path)
    status, out = my_work(s, window="week")
    assert status == 200 and out["errors"] == {}, out
    page = out["pages"]["n01_u05"]
    assert page["worked"] == {"fixed": 2, "dismissed": 2, "could_not": 1, "assigned": 1, "notes": 1, "changes": 9, "records": 7}, \
        "a1 and a2 fixed; a7 was fixed and undone; Sam's a5 and the October 10 fix of a6 are someone else's or outside the week"
    assert page["active_hours"] == 8, "the assignment at 14:00 and the note at 14:30 share one clock hour"
    assert out["period"] == {"window": "week", "zone": "UTC", "today": "2026-10-24", "start_day": "2026-10-19", "end_day": "2026-10-26"}
    assert out["person"] == PERSON and out["total"] == 9


def test_the_money_of_my_fixes_is_split_into_measured_reported_and_estimated(tmp_path):
    s, _ws, _made = work_shell(tmp_path)
    page = my_work(s, window="week")[1]["pages"]["n01_u05"]
    assert page["money"] == {"measured": {"n": 1, "money": 900.0}, "reported": {"n": 1, "money": 500.0},
                             "estimated": {"n": 2, "money": 3000.0}}, "a1 measured 1,000 less the 100 a later run still found"
    assert page["best"]["key"] == "a1" and page["best"]["basis"] == "measured" and page["best"]["money"] == 900.0
    assert page["best"]["label"] == "Item a1" and page["priced"] is True
    assert page["money"]["reported"]["money"] != 7000.0 + 500.0, "the undone fix of a7 never reports its 7,000"


def test_the_median_time_to_close_takes_the_middle_close_or_the_mean_of_the_two_middle_ones(tmp_path):
    s, _ws, _made = work_shell(tmp_path)
    week = my_work(s, window="week")[1]["pages"]["n01_u05"]["close"]
    assert week == {"n": 5, "median_hours": 53.0}, "15, 28, 53, 74.25 and 171 hours from first listed to closed"
    everything = my_work(s, window="all")[1]["pages"]["n01_u05"]
    assert everything["close"] == {"n": 6, "median_hours": 63.62}, "a6 adds 264 hours, so the middle two are 53 and 74.25"
    assert everything["worked"]["fixed"] == 3


def test_the_activity_is_newest_first_and_pages_by_whole_pages(tmp_path, monkeypatch):
    monkeypatch.setitem(shell_sql.CAPS, "my_work_rows", 4)
    s, _ws, _made = work_shell(tmp_path)
    first = my_work(s, window="week")[1]
    assert [a["key"] for a in first["activity"]] == WEEK_ORDER[:4] and first["size"] == 4 and first["total"] == 9
    assert [a["kind"] for a in first["activity"]] == ["could_not", "note", "assigned", "dismissed"]
    assert all(a["page"] == "n01_u05" for a in first["activity"])
    second = my_work(s, window="week", offset=4)[1]
    assert [a["key"] for a in second["activity"]] == WEEK_ORDER[4:8]
    assert [a["kind"] for a in second["activity"]] == ["changed", "fixed", "fixed", "dismissed"], "the undo shows as a change"
    assert [a["key"] for a in my_work(s, window="week", offset=8)[1]["activity"]] == WEEK_ORDER[8:]


def test_an_export_returns_every_change_up_to_its_cap_and_says_when_it_stopped(tmp_path, monkeypatch):
    s, _ws, _made = work_shell(tmp_path)
    out = my_work(s, window="week", export=True)[1]
    assert [a["key"] for a in out["activity"]] == WEEK_ORDER and out["truncated"] is False
    monkeypatch.setitem(shell_sql.CAPS, "my_work_rows", 2)
    monkeypatch.setitem(shell_sql.CAPS, "my_work_export", 6)
    (tmp_path / "cap").mkdir()
    s, _ws, _made = work_shell(tmp_path / "cap")
    out = my_work(s, window="week", export=True)[1]
    assert [a["key"] for a in out["activity"]] == WEEK_ORDER[:6] and out["truncated"] is True


def test_a_custom_period_counts_whole_days_in_the_person_time_zone(tmp_path):
    s, _ws, _made = work_shell(tmp_path)
    dubai = my_work(s, **{"from": "2026-10-21", "to": "2026-10-22", "time_zone": "Asia/Dubai"})[1]
    page = dubai["pages"]["n01_u05"]
    assert (page["worked"]["fixed"], page["worked"]["dismissed"], page["worked"]["could_not"]) == (1, 2, 0), \
        "a9 at 21:00 UTC on the 20th is 01:00 on the 21st in Dubai; a4 at 08:15 UTC on the 23rd is outside"
    assert dubai["period"]["window"] == "custom" and dubai["period"]["zone"] == "Asia/Dubai" and dubai["period"]["start_day"] == "2026-10-21" and dubai["period"]["end_day"] == "2026-10-23"
    utc = my_work(s, **{"from": "2026-10-21", "to": "2026-10-22"})[1]["pages"]["n01_u05"]
    assert utc["worked"]["dismissed"] == 1, "in UTC a9 falls on the 20th"


def test_someone_else_sees_only_their_own_work(tmp_path):
    s, _ws, _made = work_shell(tmp_path)
    sam = my_work(s, who=SAM.upper(), window="week")[1]["pages"]["n01_u05"]
    assert sam["worked"]["fixed"] == 1 and sam["money"]["reported"] == {"n": 1, "money": 9000.0}
    assert [a["key"] for a in my_work(s, who=SAM, window="week")[1]["activity"]] == ["a5"]
    nobody = my_work(s, who="@".join(["kim.ito", "example.com"]), window="week")[1]["pages"]["n01_u05"]
    assert nobody["worked"]["changes"] == 0 and nobody["best"] is None and nobody["close"] == {"n": 0, "median_hours": None}


def test_the_statement_filters_by_person_and_period_before_it_reads_any_version(tmp_path):
    s, ws, _made = work_shell(tmp_path)
    my_work(s, window="week")
    (sql, params), = ws.queries("'tally' AS `kind`")
    who = next(p["name"] for p in params if p["value"] == PERSON)
    touched = f"`change_source` = 'action' AND lower(`changed_by`) = :{who} AND unix_micros(`valid_from`) >= :p"
    assert sql.count(touched) >= 2, "the close history and the activity both start from the person's changes in the period"
    assert f"LIMIT {shell_sql.CAPS['my_work_rows']}" in sql and SAM not in [p["value"] for p in params]
    assert len(ws.queries("'tally' AS `kind`")) == 1, "one statement per use case"


@pytest.mark.parametrize("body,status,error", [
    ({"window": "year"}, 400, "window must be one of hour, today, week, month, all, or send from and to"),
    ({"from": "2026-10-22", "to": "2026-10-21"}, 400, "from must be on or before to"),
    ({"from": "2026-10-22"}, 400, "from and to take days such as 2026-10-01"),
    ({"from": "2025-01-01", "to": "2026-10-21"}, 400, "pick a period of at most 366 days"),
    ({"from": "2025-09-30", "to": "2026-10-01"}, 400, "pick a period of at most 366 days"),
    ({"from": "2026-02-30", "to": "2026-03-02"}, 400, "from and to take days such as 2026-10-01"),
    ({"from": "2025-09-30", "to": "2026-10-01"}, 400, "pick a period of at most 366 days"),
    ({"from": "2026-02-30", "to": "2026-03-02"}, 400, "from and to take days such as 2026-10-01"),
    ({"window": "week", "from": "2026-10-01", "to": "2026-10-02"}, 400, "send a window or a from and to day, not both"),
    ({"utc_offset_min": 240}, 400, shell_sql.FIXED_OFFSET_GONE),
    ({"offset": 3}, 400, "offset is a whole multiple of 50 from 0 to 9,950"),
    ({"offset": -50}, 400, "offset is a whole multiple of 50 from 0 to 9,950"),
    ({"export": "yes"}, 400, "export is true or false"),
    ({"export": True, "offset": 50}, 400, "an export starts at the first change, so send no offset with it"),
])
def test_a_bad_request_is_refused_before_any_query(tmp_path, body, status, error):
    s, ws, _made = work_shell(tmp_path)
    assert my_work(s, **body) == (status, {"error": error})
    assert not ws.queries("'tally' AS `kind`")


def test_a_period_of_exactly_366_days_counting_both_ends_is_taken(tmp_path):
    s, _ws, _made = work_shell(tmp_path)
    status, out = my_work(s, **{"from": "2025-10-01", "to": "2026-10-01"})
    assert status == 200 and (out["period"]["start_day"], out["period"]["end_day"]) == ("2025-10-01", "2026-10-02")


def test_a_period_of_exactly_366_days_counting_both_ends_is_taken(tmp_path):
    s, _ws, _made = work_shell(tmp_path)
    status, out = my_work(s, **{"from": "2025-10-01", "to": "2026-10-01"})
    assert status == 200 and (out["period"]["start_day"], out["period"]["end_day"]) == ("2025-10-01", "2026-10-02")


def test_a_person_who_is_not_signed_in_is_asked_to_sign_in(tmp_path):
    s, ws, _made = work_shell(tmp_path)
    assert my_work(s, who=None) == (401, {"error": shell_core.MY_WORK_SIGN_IN})
    assert my_work(s, who="  ") == (401, {"error": shell_core.MY_WORK_SIGN_IN})
    assert not ws.sql


def test_a_use_case_that_keeps_no_actions_says_so_and_runs_no_work_query(tmp_path):
    s, ws, _made = work_shell(tmp_path, decisions=False)
    out = my_work(s, window="week")[1]
    assert out["pages"]["n01_u05"] == {"visible": True, "tracked": False, "note": shell_core.NO_ACTIONS} and out["activity"] == []
    assert not ws.queries("'tally' AS `kind`")


def test_every_use_case_answers_in_parallel_and_the_activity_merges_newest_first(tmp_path):
    other = "main.finance.invoice_out"
    rows = [dict(r, use_case_id="N02-U01") for r in WORK_ROWS if r["record_key"] in ("a2", "a4")]
    pages = [hub_page(), hub_page("n02_u01", table=other, use_case="N02-U01")]
    ws = AssumptionsWorkspace({"loss_desk_out": WORK_ROWS, "invoice_out": rows})
    ws.db.create_function("UNIX_MICROS", 1, micros_of)
    settings = dict(SETTINGS, options=dict(SETTINGS["options"], decisions=True))
    s, _ws, _made = hub_shell(tmp_path, settings=settings, pages=pages, ws=ws)
    out = my_work(s, window="week")[1]
    assert set(out["pages"]) == {"n01_u05", "n02_u01"} and out["total"] == 11
    assert [(a["page"], a["key"]) for a in out["activity"][:2]] == [("n01_u05", "a4"), ("n02_u01", "a4")]


def test_minutes_per_record_is_an_owner_setting_that_my_work_reads_at_once(tmp_path):
    s, ws, _made = work_shell(tmp_path)
    assert my_work(s, window="week")[1]["pages"]["n01_u05"]["minutes"] is None, "no hours saved until an owner sets it"
    view = call(s, "GET", "settings", query={"page": "n01_u05"}, headers={"x-forwarded-email": OWNER})[1]
    minutes = next(x for x in view["settings"] if x["name"] == shell_sql.MY_WORK_MINUTES)
    assert (minutes["group"], minutes["editable"], minutes["value"], minutes["saved"]) == ("impact", True, "", False)
    assert minutes["label"] == "Minutes a person spends per record without Inspire"
    preview = call(s, "POST", "settings/preview", headers={"x-forwarded-email": OWNER},
                   body={"page": "n01_u05", "name": shell_sql.MY_WORK_MINUTES, "value": "6"})
    assert preview == (200, {"exact": True, "moves": [], "text": shell_core.APP_SETTING_AT_ONCE})
    for value, problem in (("0", "minutes_per_record is '0'; allowed: more than 0 and at most 1,440 minutes, or empty"),
                           ("1441", "minutes_per_record is '1441'; allowed: more than 0 and at most 1,440 minutes, or empty")):
        assert call(s, "POST", "settings/save", headers={"x-forwarded-email": OWNER},
                    body={"page": "n01_u05", "name": shell_sql.MY_WORK_MINUTES, "value": value, "was": ""}) == (400, {"error": problem})
    status, saved = call(s, "POST", "settings/save", headers={"x-forwarded-email": OWNER},
                         body={"page": "n01_u05", "name": shell_sql.MY_WORK_MINUTES, "value": "6", "was": ""})
    assert status == 200 and next(x for x in saved["settings"] if x["name"] == shell_sql.MY_WORK_MINUTES)["value"] == "6"
    assert call(s, "POST", "settings/save", headers={"x-forwarded-email": SAM},
                body={"page": "n01_u05", "name": shell_sql.MY_WORK_MINUTES, "value": "8", "was": "6"})[0] == 403


def test_a_saved_minutes_value_reaches_my_work_and_an_emptied_one_turns_it_off(tmp_path):
    edits = [("N01-U05", shell_sql.MY_WORK_MINUTES, 6.0, OWNER, "2026-10-20 10:00:00", "", None)]
    s, _ws, _made = work_shell(tmp_path, edits=edits)
    assert my_work(s, window="week")[1]["pages"]["n01_u05"]["minutes"] == 6.0
    (tmp_path / "cleared").mkdir()
    cleared = edits + [("N01-U05", shell_sql.MY_WORK_MINUTES, None, OWNER, "2026-10-21 10:00:00", "", None)]
    s, _ws, _made = work_shell(tmp_path / "cleared", edits=cleared)
    assert my_work(s, window="week")[1]["pages"]["n01_u05"]["minutes"] is None
    status, saved = call(s, "POST", "settings/save", headers={"x-forwarded-email": OWNER},
                         body={"page": "n01_u05", "name": shell_sql.MY_WORK_MINUTES, "value": "", "was": ""})
    assert status == 400 and saved == {"error": "minutes_per_record is already empty"}, "emptying an empty value changes nothing"


def test_a_run_skips_minutes_per_record_without_a_word_because_only_the_app_reads_it(fresh_ns):
    rows = [{"name": "act_now_share", "value": 0.1, "changed_by": OWNER, "changed_at": "2026-10-28T09:00:00"},
            {"name": shell_sql.MY_WORK_MINUTES, "value": 6.0, "changed_by": OWNER, "changed_at": "2026-10-29T09:00:00"}]

    def respond(statement):
        return rows if statement.startswith("SELECT name, value, changed_by, changed_at, text_value FROM") else []
    share = {"name": "act_now_share", "kind": "percent", "low": 0.0, "high": 1.0, "whole": False, "low_open": False, "high_open": False,
             "allowed": "0 to 1", "choices": [], "many": False}
    fresh_ns.update(act_now_share=0.05)
    printed = []
    applied = fresh_ns["inspire_apply_assumptions"](FakeSpark(responder=respond), "main.inspire.churn_out", "N01-U01", fresh_ns,
                                                    printed.append, run={"settings": [share], "settings_read": True})
    assert applied == {"act_now_share": 0.1} and shell_sql.MY_WORK_MINUTES not in fresh_ns
    assert len(printed) == 1 and shell_sql.MY_WORK_MINUTES not in printed[0]
    assert fresh_ns["INSPIRE_APP_ONLY_SETTINGS"] == (shell_core.MINUTES_SETTING["name"],), "the run and the App name the same App-only settings"


def test_the_my_work_statement_parses_as_databricks_sql_and_renders_for_lakebase():
    page = hub_page()
    bounds = shell_sql.window_bounds("week", datetime.datetime(2026, 10, 24, 12, tzinfo=datetime.timezone.utc))
    sql, params = shell_sql.my_work_query(page, set(COLUMNS), PERSON, bounds, 50)
    sqlglot.parse_one(re.sub(r":p\d+", "'x'", sql), read="databricks")
    held = {TABLE: {"pg": "app.loss_desk_out", "columns": [{"name": c} for c in COLUMNS]}}
    text, values, read = shell_pg.render(sql, params, held)
    assert read == {TABLE} and sql.count(" UNION ALL ") == 4 and PERSON in values.values()
    everything = shell_sql.my_work_query(page, set(COLUMNS), PERSON, shell_sql.window_bounds("all", datetime.datetime(2026, 10, 24)), 50)[0]
    assert "unix_micros(`valid_from`) >=" not in everything


def test_a_page_without_a_label_or_owner_column_still_lists_the_work():
    page = hub_page(records=dict(hub_page()["records"], label=None))
    names = set(COLUMNS) - {"action_owner", "action_note"}
    sql, _params = shell_sql.my_work_query(page, names, PERSON, {"window": "all"}, 50)
    assert "`action_owner`" not in sql and "`action_note`" not in sql and "CAST(NULL AS STRING) AS `_w_label`" in sql
