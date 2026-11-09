import datetime
import os
import re
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_core
import shell_facts
import shell_pg
import shell_sql
from v141_app_shell_test import SETTINGS, call
from v148_app_hub_test import COLUMNS, TODAY, hub_page
from v149_impact_test import PERSON, Workspace, shell, v

sqlglot = pytest.importorskip("sqlglot")

DECIDE = dict(SETTINGS, options=dict(SETTINGS["options"], decisions=True))
NOW = datetime.datetime.fromtimestamp(TODAY, datetime.timezone.utc)
SINCE = shell_core.week_start(NOW.date()) - datetime.timedelta(weeks=shell_core.TREND_WEEKS - 1)
NAMES = set(COLUMNS)
TYPED = {"BIGINT": int, "INT": int, "DOUBLE": float}


def micros(value):
    if value is None:
        return None
    text = str(value).replace("T", " ").replace("Z", "")
    stamp = datetime.datetime.fromisoformat(text if " " in text or len(text) > 10 else text + " 00:00:00")
    return int(stamp.replace(tzinfo=datetime.timezone.utc).timestamp() * 1000000)


class TrendWorkspace(Workspace):
    def __init__(self, rows=None, **kw):
        super().__init__(rows=[] if rows is None else rows, **kw)
        self.db.create_function("UNIX_MICROS", 1, micros)

    def job_runs(self, job_id, active_only=False, limit=25):
        return {"runs": [], "more": False}

    def run_sql(self, warehouse, sql, params, limit=5000):
        typed = [dict(p, value=TYPED[p.get("type")](p["value"])) if p.get("type") in TYPED and p.get("value") is not None else p
                 for p in params]
        return super().run_sql(warehouse, sql, typed, limit)


ROWS = [
    v("o1", "Act now", 100.0, "r4", ai_cat_driver="Price"),
    v("o2", "Act now", 200.0, "r1", current=False, ends="2026-10-01 09:00:00", ai_cat_driver="Volume"),
    v("o2", "Act now", 200.0, "r1", at="2026-10-01 09:00:00", source="action", action_status="In progress", action_owner="pat",
      action_due="2026-10-01", ai_cat_driver="Volume"),
    v("o3", "Review", None, "r0", action_status="New", action_owner="  ", joined_at="2026-09-01 00:00:00"),
    v("d1", "Act now", 50.0, "r1", current=False, ends="2026-09-30 06:00:00", ai_cat_driver="Price"),
    v("d1", "Act now", 50.0, "r1", at="2026-09-30 06:00:00", source="action", action_status="Dismissed", ai_cat_driver="Price"),
    v("f1", "Act now", 70.0, "r2", current=False, ends="2026-10-06 12:00:00", ai_cat_driver="Volume"),
    v("f1", "Act now", 70.0, "r2", at="2026-10-06 12:00:00", source="action", action_status="Done", ai_cat_driver="Volume"),
    v("x1", "Act now", 9000.0, "r1", current=False, ends="2026-10-03 10:00:00", ai_cat_driver="Price"),
    v("x1", "Act now", 9000.0, "r1", at="2026-10-03 10:00:00", source="delete", ai_cat_driver="Price"),
]


def trends(s, page="n01_u05", headers=None):
    return call(s, "GET", "trends", query={"page": page}, headers={"x-forwarded-email": PERSON} if headers is None else headers)


def _run(rows, names=NAMES, history=None, model=None, category="ai_cat_driver", page=None, now=NOW):
    ws = TrendWorkspace(rows)
    sql, params = shell_sql.trends_query(page or hub_page(), names, now, SINCE, history, model, category)
    return shell_core.trends_view(ws.run_sql("wh", sql, params)["rows"], SINCE, shell_core.TREND_WEEKS), sql, params


def test_the_trends_query_counts_open_overdue_unassigned_ages_and_money_over_current_versions():
    got, _sql, _params = _run(ROWS)
    assert got["open"] == {"n": 3, "overdue": 1, "unassigned": 2, "ages": {"0-7": 1, "8-30": 1, "over_30": 1}, "money": 300.0}, \
        "a deleted record or a closed one is never open, a blank owner is unassigned, and joined_at wins over the first version for age"


def test_the_trends_query_leaves_money_by_reason_to_the_could_save_card():
    got, sql, _params = _run(ROWS)
    assert "stake" not in got, "the Could save, by reason card is the one place money is split by reason"
    assert "SUM(`_t_money`) AS `_t_m`" not in sql and "'stake'" not in sql
    assert got["open"]["money"] == 300.0, "the open total still carries the money"


def test_the_false_alarm_rate_is_the_dismissed_share_of_closed_records_per_reason():
    got, _sql, _params = _run(ROWS)
    assert got["false_alarms"] == {"closed": 2, "dismissed": 1, "rate": 0.5, "reasons": [
        {"reason": "Price", "closed": 1, "dismissed": 1, "rate": 1.0}, {"reason": "Volume", "closed": 1, "dismissed": 0, "rate": 0.0}]}


def test_the_median_time_to_first_action_takes_the_middle_record_and_counts_the_open_ones_still_waiting():
    got, _sql, _params = _run(ROWS)
    assert got["first_action"] == {"n": 3, "median_hours": 24.0, "waiting": 2}, "6 h, 24 h and 51 h give 24 h; o1 and o3 still wait"
    even, _sql, _params = _run([r for r in ROWS if r["record_key"] != "o2"])
    assert even["first_action"]["median_hours"] == 15.0, "an even count averages the two middle records"


def test_inflow_and_cleared_fill_every_week_and_count_a_close_once():
    got, _sql, _params = _run(ROWS)
    weeks = got["weeks"]
    assert len(weeks) == shell_core.TREND_WEEKS and weeks[0]["week"] == SINCE.isoformat()
    assert {w["week"]: (w["new"], w["cleared"]) for w in weeks if w["new"] or w["cleared"]} == {
        "2026-09-14": (1, 0), "2026-09-28": (3, 1), "2026-10-05": (1, 1), "2026-10-19": (1, 0)}


def test_the_backlog_per_run_reads_the_versions_live_at_each_run_and_derives_cleared():
    got, _sql, _params = _run(ROWS)
    assert [(r["run_id"], r["open"], r["new"], r["cleared"]) for r in got["backlog"]] == [
        ("r0", 1, 1, None), ("r1", 4, 3, 0), ("r2", 3, 1, 2), ("r4", 3, 1, 1)]


def test_the_backlog_reads_the_run_log_when_the_app_keeps_one():
    log = [{"ran_at": "2026-10-23 06:00:00", "run_id": "r9", "record_key": "o1", "use_case_id": "N01-U05"}]
    ws = TrendWorkspace(ROWS)
    ws.db.execute('CREATE TABLE "loss_desk_out_log" (ran_at, run_id, record_key, use_case_id)')
    ws.db.executemany('INSERT INTO "loss_desk_out_log" VALUES (?, ?, ?, ?)', [tuple(r.values()) for r in log])
    history = {"log": shell_sql.table_name("main.pricing.loss_desk_out_log"), "tier": None, "columns": [], "run_type": "STRING"}
    sql, params = shell_sql.trends_query(hub_page(), NAMES, NOW, SINCE, history, None, "ai_cat_driver")
    got = shell_core.trends_view(ws.run_sql("wh", sql, params)["rows"], SINCE, shell_core.TREND_WEEKS)
    assert [(r["run_id"], r["open"], r["new"]) for r in got["backlog"]] == [("r9", 3, 0)], "only the logged run, with no new versions of its own"


def test_an_empty_table_gives_zeros_and_no_rates():
    got, _sql, _params = _run([])
    assert got["open"] == {"n": 0, "overdue": 0, "unassigned": 0, "ages": {"0-7": 0, "8-30": 0, "over_30": 0}, "money": None}
    assert got["false_alarms"] == {"closed": 0, "dismissed": 0, "rate": None, "reasons": []}
    assert got["first_action"] == {"n": 0, "median_hours": None, "waiting": 0}
    assert got["backlog"] == [] and all(w["new"] == w["cleared"] == 0 for w in got["weeks"])


def test_a_table_without_versioned_history_or_actions_columns_still_runs():
    lean = {"record_key", "valid_from", "valid_to", "is_current", "change_source", "run_id", "use_case_id", "action_status"}
    got, sql, _params = _run(ROWS, names=lean, category=None)
    assert "`action_due`" not in sql and "`joined_at`" not in sql and "`value_at_stake`" not in sql and "`action_owner`" not in sql
    assert got["open"]["n"] == 3 and got["open"]["overdue"] == 0 and got["open"]["unassigned"] == 3 and got["open"]["money"] is None
    assert got["false_alarms"]["reasons"] == [], "no reason column means no per-reason cards"


def test_one_version_per_record_leaves_no_first_action_and_every_open_record_waiting():
    rows = [v(f"n{i}", "Act now", 1.0, "r4", action_due=None, action_owner=None) for i in range(3)]
    got, _sql, _params = _run(rows)
    assert got["first_action"] == {"n": 0, "median_hours": None, "waiting": 3}
    assert got["open"]["overdue"] == 0 and got["open"]["unassigned"] == 3


def test_large_counts_stay_whole_numbers_and_the_reasons_and_runs_stay_capped():
    rows = [v(f"k{i}", "Act now", 1.0, f"r{i % 5}", ai_cat_driver=f"reason {i % 12}") for i in range(600)]
    for r in rows:
        r["valid_from"] = f"2026-10-{10 + int(r['run_id'][1:]):02d} 06:00:00"
    got, sql, _params = _run(rows)
    assert got["open"]["n"] == 600 and isinstance(got["open"]["n"], int)
    assert f"LIMIT {shell_sql.CAPS['trend_reasons']}" in sql and f"LIMIT {shell_sql.CAPS['trend_runs']}" in sql
    assert sum(r["new"] for r in got["backlog"]) == 600


def test_the_trends_query_is_one_statement_with_every_value_bound():
    _got, sql, params = _run(ROWS)
    assert sql.count("WITH ") == 1 and "'New'" not in sql and "'Dismissed'" not in sql and "N01-U05" not in sql
    assert {p["value"] for p in params} >= set(shell_sql.ACTION_STATUSES), "every status is read through page_statuses, never inlined"
    sqlglot.parse_one(sql, read="databricks")
    held = {"main.pricing.loss_desk_out": {"pg": "app.loss_desk_out", "columns": [{"name": c} for c in COLUMNS]}}
    text, _values, read = shell_pg.render(sql, params, held)
    assert '"app"."loss_desk_out"' in text and read


def test_page_statuses_is_the_one_place_the_trends_read_statuses_from():
    got = shell_sql.page_statuses(hub_page())
    assert got == {"all": shell_sql.ACTION_STATUSES, "open": shell_facts.OPEN_STATUSES, "closed": shell_facts.CLOSED_STATUSES,
                   "dismissed": shell_facts.DISMISSED, "unset": shell_sql.ACTION_STATUSES[0]}


def test_close_event_reproduces_the_closing_condition_it_replaced():
    assert shell_facts.close_event() == (f"`change_source` = 'action' AND `action_status` IN ({shell_facts.sql_list(shell_facts.CLOSED_STATUSES)}) "
                                         "AND COALESCE(`_inspire_was`, '') <> `action_status`")
    assert shell_facts.close_event() in "".join(shell_facts.closing_ctes("t", set(COLUMNS)).values())
    assert shell_facts.close_event("`s`", "`w`", ":p1") == "`change_source` = 'action' AND `s` IN (:p1) AND COALESCE(`w`, '') <> `s`"


def test_the_trends_route_serves_the_cards_with_money_and_the_reason(tmp_path):
    ws = TrendWorkspace(ROWS)
    status, out = trends(shell(tmp_path, ws, DECIDE))
    assert status == 200, out
    assert out["actions"] and out["money"] and out["reason"] == "ai_cat_driver" and out["since"] == SINCE.isoformat()
    assert out["open"]["n"] == 3 and out["false_alarms"]["rate"] == 0.5
    assert out["holds"] is True, "the impact table carries held_back and run_tier"
    assert len(ws.queries("AS `_t_raw`")) == 1, "the cards cost one statement"


def test_the_trends_route_says_why_when_the_list_keeps_no_actions(tmp_path):
    ws = TrendWorkspace(ROWS)
    status, out = trends(shell(tmp_path, ws))
    assert status == 200 and out["actions"] is False and out["note"] == shell_core.NO_ACTIONS
    assert not ws.queries("AS `_t_raw`")


def test_the_trends_view_tolerates_bad_rows():
    got = shell_core.trends_view([{"kind": "in", "k": "x", "n": 3}, {"kind": "run", "k": "r", "at": None, "n": None, "m": None},
                                  {"kind": "first", "n": 1, "secs": -5}], SINCE, 2)
    assert got["weeks"] == [{"week": SINCE.isoformat(), "new": 0, "cleared": 0},
                            {"week": (SINCE + datetime.timedelta(weeks=1)).isoformat(), "new": 0, "cleared": 0}]
    assert got["backlog"] == [{"run_id": "r", "at": None, "open": 0, "new": 0, "cleared": None}]
    assert got["first_action"]["median_hours"] == 0.0


def _focus(tmp_path, focus, rows=ROWS):
    ws = TrendWorkspace(rows)
    status, out = call(shell(tmp_path, ws, DECIDE), "POST", "records", headers={"x-forwarded-email": PERSON},
                       body={"page": "n01_u05", "focus": focus, "limit": 50})
    return status, out, ws


@pytest.mark.parametrize("focus, keys", [("overdue", {"o2"}), ("unassigned", {"o1", "o3"}), ("older", {"o3"})])
def test_the_focus_filter_lists_exactly_the_records_the_card_counted(tmp_path, focus, keys):
    status, out, _ws = _focus(tmp_path, focus)
    assert status == 200, out
    assert {r["record_key"] for r in out["rows"]} == keys


def test_the_focus_filter_must_exclude_closed_and_deleted_records(tmp_path):
    rows = ROWS + [v("z1", "Act now", 1.0, "r4", action_status="Done", action_due="2026-01-01"),
                   v("z2", "Act now", 1.0, "r4", source="delete", action_due="2026-01-01")]
    status, out, _ws = _focus(tmp_path, "overdue", rows)
    assert status == 200 and {r["record_key"] for r in out["rows"]} == {"o2"}, "a Done record past its due date is not overdue"


def test_the_focus_filter_rejects_unknown_values_and_lists_without_actions(tmp_path):
    status, out, _ws = _focus(tmp_path, "late")
    assert status == 400 and all(f in out["error"] for f in shell_sql.FOCUSES)
    ws = TrendWorkspace(ROWS)
    status, out = call(shell(tmp_path / "plain", ws), "POST", "records", headers={"x-forwarded-email": PERSON},
                       body={"page": "n01_u05", "focus": "overdue"})
    assert status == 400 and "keeps no actions" in out["error"]


def test_the_focus_filter_counts_match_the_card(tmp_path):
    ws = TrendWorkspace(ROWS)
    s = shell(tmp_path, ws, DECIDE)
    _status, cards = trends(s)
    for focus, count in (("overdue", cards["open"]["overdue"]), ("unassigned", cards["open"]["unassigned"]),
                         ("older", cards["open"]["ages"]["over_30"])):
        status, out = call(s, "POST", "records", headers={"x-forwarded-email": PERSON},
                           body={"page": "n01_u05", "focus": focus, "status_counts": True})
        assert status == 200 and out["total"] == count, (focus, out.get("total"))


@pytest.mark.parametrize("focus", shell_sql.FOCUSES)
def test_a_focused_list_is_never_counted_or_floored_as_the_whole_list(focus):
    request = {"search": "", "mine": False, "changed": False, "ai": {}, "columns": {}, "cursor": None,
               "sort": shell_sql.MONEY_COLUMN, "dir": "desc", "offset": 0, "limit": 50}
    focused = dict(request, focus={"focus": focus})
    context, model = {"join": "record_key", "types": {}, "money": ["m"]}, {"recomputes": True, "changed": True}
    assert shell_sql.unfiltered({}, request) is True
    assert shell_sql.unfiltered({}, focused) is False, "a focused list would show the whole run's total"
    assert shell_sql.list_floor({}, request, context, None, model, False) == {"top": 1000, "on": "c"}
    assert shell_sql.list_floor({}, focused, context, None, model, True) is None, "a money floor sized for the whole list would drop focused rows"


@pytest.mark.parametrize("focus, keys", [("overdue", {"o2"}), ("unassigned", {"o1", "o3"}), ("older", {"o3"}), (None, {"o1", "o2", "o3", "d1", "f1"})])
def test_acting_on_every_match_keeps_the_focus_so_it_touches_only_the_focused_records(tmp_path, focus, keys):
    ws = TrendWorkspace(ROWS)
    s = shell(tmp_path, ws, DECIDE)
    page = s.page("n01_u05")
    sp, who = s.workspace({"x-forwarded-email": PERSON})
    view = {"focus": focus} if focus else {}
    context, request, _fields = s.match_plan(sp, who, page, {}, view, PERSON)
    counted = shell_sql.list_match_query(page, {}, request, context, PERSON)
    got = {r["_inspire_key"] for r in s.execute(sp, counted["keys"], counted["params"].items, 100, delta=True)["rows"]}
    assert got == keys


def test_runs_tell_the_page_whether_the_person_may_run_it_now(tmp_path):
    ws = TrendWorkspace(ROWS)
    page = hub_page()
    owner = shell(tmp_path, ws, dict(DECIDE, jobs={page["id"]: "123"}, use_case_owners={page["id"]: [PERSON]}), page)
    status, out = call(owner, "GET", "runs", query={"page": page["id"]}, headers={"x-forwarded-email": PERSON})
    assert status == 200 and out["can_run"] is True, "the use case owner may run the page's job"
    status, other = call(owner, "GET", "runs", query={"page": page["id"]}, headers={"x-forwarded-email": DECIDE["admin"]})
    assert status == 200 and other["can_run"] is False, "someone who does not own the use case may not"
    status, plain = call(owner, "GET", "runs", query={"page": page["id"]}, headers={})
    assert status == 200 and plain["can_run"] is False, "nobody signed in may never start a run"
    status, nojob = call(shell(tmp_path / "nojob", ws, DECIDE), "GET", "runs", query={"page": page["id"]}, headers={"x-forwarded-email": PERSON})
    assert nojob["can_run"] is False, "a page with no job of its own cannot run"


@pytest.mark.parametrize("route", ["runs", "settings"])
def test_runs_and_settings_offer_run_now_only_when_the_refresh_would_accept_it(tmp_path, route):
    ws = TrendWorkspace(ROWS)
    page = hub_page()
    owned = dict(DECIDE, jobs={page["id"]: "123"}, use_case_owners={page["id"]: [PERSON]})
    headers = {"x-forwarded-email": PERSON}
    status, out = call(shell(tmp_path / "out", ws, owned, page), "GET", route, query={"page": page["id"]}, headers=headers)
    assert status == 200 and out["can_run"] is (route == "runs" or bool(out["settings"]))
    inside = shell(tmp_path / "in", ws, dict(owned, host=shell_core.INSIDE, auth="user"), page)
    signed = dict(headers, **{"x-forwarded-access-token": "tok-a"})
    status, out = call(inside, "GET", route, query={"page": page["id"]}, headers=signed)
    assert status == 200 and out["can_run"] is False, "inside Inspire a refresh answers 403, so no Run now is offered"
    status, refused = call(inside, "POST", "refresh", body={"page": page["id"]}, headers=signed)
    assert status == 403


def test_the_trends_route_refuses_a_write():
    assert not re.search(r'route == \("POST", "trends"\)', open(os.path.join(SERVER, "shell_core.py")).read())
