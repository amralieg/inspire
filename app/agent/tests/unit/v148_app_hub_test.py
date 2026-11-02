import copy
import datetime
import json
import os
import re
import sqlite3
import sys
import threading

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_core
import shell_db
import shell_pg
import shell_sql
from v141_app_shell_test import PAGE, SETTINGS, app_dir, call

sqlglot = pytest.importorskip("sqlglot")

TABLE = "main.pricing.loss_desk_out"
OTHER_TABLE = "main.finance.invoice_out"
PERSON = "@".join(["pat.lee", "example.com"])
TODAY = datetime.datetime(2026, 10, 24, 12, 0, tzinfo=datetime.timezone.utc).timestamp()
HISTORY_TYPES = {"record_key": "STRING", "valid_from": "TIMESTAMP", "valid_to": "TIMESTAMP", "is_current": "BOOLEAN", "change_source": "STRING",
                 "changed_by": "STRING"}
TYPES = {"entity_id": "STRING", "rank": "INT", "value_at_stake": "DOUBLE", "as_of_date": "DATE", **HISTORY_TYPES, **shell_sql.ACTION_TYPES,
         **shell_sql.CLOSE_TYPES, **shell_sql.KEPT_TYPES}
COLUMNS = ("record_key", "entity_id", "entity_label", "priority_tier", "rank", "category", "value_at_stake", "ai_explanation", "ai_cat_driver",
           "action_owner", "action_status", "action_due", "action_note", "dismiss_reason", "action_outcome", "realized_value", "realized_note",
           "snooze_until", "action_batch", "action_batch_note", "action_batch_values", "joined_at", "use_case_id", "run_id", "as_of_date",
           "valid_from", "valid_to", "is_current", "change_source", "changed_by", "edited_by_person", "not_listed_since")
RUNS = {"r8": "2026-08-01", "r0": "2026-09-01", "r1": "2026-09-29", "r2": "2026-10-06", "r3": "2026-10-13", "r4": "2026-10-20"}


def version(key, tier, stake, run=None, at=None, source="run", current=True, ends=None, **values):
    run = run or "r4"
    row = dict.fromkeys(COLUMNS)
    row.update(record_key=key, entity_id=key, entity_label=f"Item {key}", priority_tier=tier, rank=int(key[1:]), category="A",
               value_at_stake=stake, use_case_id="N01-U05", run_id=run, as_of_date=RUNS[run], valid_from=at or f"{RUNS[run]} 06:00:00",
               valid_to=ends, is_current=1 if current else 0, change_source=source, changed_by=f"run {run}" if source == "run" else PERSON)
    row.update(values)
    return row


ROWS = [
    version("k1", "Act now", 900.0, action_owner=PERSON, action_status="In progress", action_due="2026-10-20", ai_explanation="Margin fell.",
            ai_cat_driver="Price"),
    version("k2", "Act now", 5000.0, ai_cat_driver="Volume"),
    version("k2", "Review", 10.0, run="r3", current=False, ends="2026-10-20 06:00:00"),
    version("k3", "Review", 300.0, action_status="New", category="B"),
    version("k4", "Monitor", 50.0, action_owner="sam", action_status="In progress", action_due="2026-11-02"),
    version("k5", "Monitor", 10.0),
    version("k6", "Act now", 2000.0, run="r1", current=False, ends="2026-10-05 09:00:00"),
    version("k6", "Act now", 2000.0, run="r1", at="2026-10-05 09:00:00", source="action", action_status="Dismissed", dismiss_reason="Known"),
    version("k7", "Act now", 1200.0, run="r0", current=False, ends="2026-09-20 10:00:00"),
    version("k7", "Act now", 1200.0, run="r0", at="2026-09-20 10:00:00", source="action", current=False, ends="2026-10-06 06:00:00",
            action_status="Done"),
    version("k7", "Monitor", 100.0, run="r2", action_status="Done", action_outcome="Resolved"),
    version("k8", "Act now", 700.0, run="r8", current=False, ends="2026-08-10 08:00:00"),
    version("k8", "Act now", 700.0, run="r8", at="2026-08-10 08:00:00", source="action", current=False, ends="2026-09-03 06:00:00",
            action_status="Done"),
    version("k9", "Act now", 400.0, run="r1", current=False, ends="2026-10-10 11:00:00"),
    version("k9", "Act now", 400.0, run="r1", at="2026-10-10 11:00:00", source="action", current=False, ends="2026-10-13 06:00:00",
            action_status="Done"),
    version("k9", "Act now", 450.0, run="r3", action_status="Done", action_outcome="Still flagged"),
    version("k10", "Act now", 9000.0, source="delete"),
]


def hub_page(ident="n01_u05", table=TABLE, use_case="N01-U05", **changes):
    page = copy.deepcopy(PAGE)
    page.update(id=ident, use_case_id=use_case, title=f"Desk {ident}", result_table=table,
                datasets=[{"name": "trend", "sql": f"SELECT as_of_date, category, value_at_stake FROM {table}"},
                          {"name": "records", "sql": f"SELECT * FROM {table} WHERE is_current AND change_source <> 'delete'"}],
                filters=[{"id": "run_date", "type": "date_range", "label": "Run date", "grain": "month", "default": "12m",
                          "columns": {"trend": "as_of_date", "records": "as_of_date"}},
                         {"id": "category", "type": "multi_select", "label": "Category", "columns": {"trend": "category", "records": "category"}}],
                kpis=[{"id": f"k{i}", "label": f"Money {i}", "dataset": "trend", "expression": "SUM(value_at_stake)", "format": "currency",
                       "currency": "USD"} for i in range(3)],
                charts=[{"id": f"c{i}", "title": f"Chart {i}", "hint": "Money by category.", "type": "bar", "dataset": "trend",
                         "x": {"column": "category", "kind": "category"}, "y": [{"label": "Money", "expression": "SUM(value_at_stake)"}]}
                        for i in range(3)],
                tables=[],
                records={"title": "Things to fix", "key": "entity_id", "label": "entity_label", "rank": "rank", "tier": "priority_tier",
                         "columns": [{"column": "value_at_stake", "label": "Could save", "format": "currency", "currency": "USD"}]})
    page.update(changes)
    return page


def to_sqlite(sql: str) -> str:
    tree = sqlglot.parse_one(re.sub(r":(p\d+)", r":\1", sql), read="databricks")
    for table in tree.find_all(sqlglot.exp.Table):
        table.set("catalog", None)
        table.set("db", None)
    return tree.sql(dialect="sqlite").replace("AS TIMESTAMPTZ)", "AS TEXT)")


class SqliteWorkspace:
    def __init__(self, tables=None, fail=None, barrier=None):
        self.sql, self.fail, self.barrier = [], dict(fail or {}), barrier
        self.lock = threading.Lock()
        self.db = sqlite3.connect(":memory:", check_same_thread=False)
        self.db.create_function("UNIX_MICROS", 1, lambda value: len(str(value)))
        for name, rows in ({"loss_desk_out": ROWS} if tables is None else tables).items():
            self.db.execute(f'CREATE TABLE "{name}" ({", ".join(chr(34) + c + chr(34) for c in COLUMNS)})')
            self.db.executemany(f'INSERT INTO "{name}" VALUES ({", ".join("?" for _ in COLUMNS)})', [tuple(r[c] for c in COLUMNS) for r in rows])

    def run_sql(self, warehouse, sql, params, limit=5000):
        with self.lock:
            self.sql.append((sql, params, limit))
        for marker, error in self.fail.items():
            if marker in sql:
                raise error
        if self.barrier and "'item' AS `kind`" in sql:
            self.barrier.wait()
        with self.lock:
            try:
                cursor = self.db.execute(to_sqlite(sql), {p["name"]: p["value"] for p in params})
            except sqlite3.OperationalError as error:
                found = "TABLE_OR_VIEW_NOT_FOUND" if "no such table" in str(error) else "SQL_ERROR"
                raise shell_db.QueryError(f"[{found}] {error}") from error
            names = [c[0] for c in cursor.description]
            rows = [dict(zip(names, row)) for row in cursor.fetchall()]
        return {"columns": [{"name": n, "type": TYPES.get(n, "STRING"), "type_text": TYPES.get(n, "STRING")} for n in names],
                "rows": rows[:limit], "truncated": len(rows) > limit}

    def queries(self, marker):
        return [(sql, params) for sql, params, _limit in self.sql if marker in sql]


def hub_shell(tmp_path, settings=None, pages=None, ws=None):
    ws = ws or SqliteWorkspace()
    made = {"user": []}

    def user_factory(host, token):
        made["user"].append(token)
        return ws

    pages = pages or [hub_page()]
    settings = dict(settings or SETTINGS, pages=[p["id"] for p in pages])
    tmp_path.mkdir(parents=True, exist_ok=True)
    s = shell_core.Shell(app_dir(tmp_path, settings, pages), env={"DATABRICKS_WAREHOUSE_ID": "wh1", "DATABRICKS_HOST": "dbc-1.example.com"},
                         sp_factory=lambda: ws, user_factory=user_factory, clock=lambda: TODAY)
    return s, ws, made


def overview(s, headers=None, **body):
    return call(s, "POST", "overview", headers=headers or {"x-forwarded-email": PERSON}, body=body)


def test_the_hub_title_puts_the_business_name_first_and_keeps_the_built_title_without_one(tmp_path):
    s, _ws, _made = hub_shell(tmp_path / "a", settings=dict(SETTINGS, business="  Contoso   Retail "))
    assert call(s, "GET", "app")[1]["title"] == "Contoso Retail - Databricks Inspire Use Cases Hub"
    s, _ws, _made = hub_shell(tmp_path / "b")
    assert call(s, "GET", "app")[1]["title"] == "Pricing desk"


@pytest.mark.parametrize("changes,problem", [
    ({"business": ""}, "the App business must be the business name, 1 to 80 characters"),
    ({"business": "x" * 81}, "the App business must be the business name, 1 to 80 characters"),
    ({"business": 7}, "the App business must be the business name, 1 to 80 characters"),
    ({"alerts": ["n01_u05"]}, "the App alerts must be an object of page id to the https link of the page's alert"),
    ({"alerts": {"other": "https://x.example.com/sql/alerts/1"}}, "the App settings name an alert for page other, which the App does not have"),
    ({"alerts": {"n01_u05": "http://x.example.com/sql/alerts/1"}}, "the alert of page n01_u05 must be an https link, not 'http://x.example.com/sql/alerts/1'")])
def test_a_bad_business_name_or_alert_link_is_refused(changes, problem):
    assert problem in shell_core.settings_problems(dict(SETTINGS, **changes), [PAGE])
    assert shell_core.settings_problems(dict(SETTINGS, business="Contoso Retail", alerts={"n01_u05": "https://x.example.com/sql/alerts/1"}),
                                        [PAGE]) == []


def test_notify_me_opens_the_page_alert_or_else_the_workspace_alerts(tmp_path):
    link = "https://dbc-1.example.com/sql/alerts/77"
    s, _ws, _made = hub_shell(tmp_path / "a", settings=dict(SETTINGS, alerts={"n01_u05": link}))
    info = call(s, "GET", "app")[1]
    assert (info["alerts"], info["alerts_home"]) == ({"n01_u05": link}, "https://dbc-1.example.com/sql/alerts")
    s, _ws, _made = hub_shell(tmp_path / "b")
    assert call(s, "GET", "app")[1]["alerts"] == {}


def test_the_overview_lists_the_open_things_to_fix_with_their_reasoning_owner_due_and_money(tmp_path):
    s, _ws, _made = hub_shell(tmp_path)
    status, out = overview(s)
    assert status == 200, out
    page = out["pages"]["n01_u05"]
    assert (out["today"], out["quarter"], out["since"]) == ("2026-10-24", "2026-10-01", "2026-08-03")
    assert (page["visible"], page["tracked"], page["money"], page["categories"]) == (True, True, True, ["ai_cat_driver"])
    assert "actions" not in page, "every result table keeps the actions, so the Overview never says whether it has them"
    assert [(i["key"], i["tier"], i["money"], i["owner"], i["status"], i["due"], i["reason"]) for i in page["items"]] == [
        ("k2", "Act now", 5000.0, None, None, None, "Volume"),
        ("k1", "Act now", 900.0, PERSON, "In progress", "2026-10-20", "Price"),
        ("k3", "Review", 300.0, None, "New", None, "Not explained yet"),
        ("k4", "Monitor", 50.0, "sam", "In progress", "2026-11-02", "Not explained yet")], \
        "dismissed, done, deleted, old and unflagged records without a due date never reach the to do list"
    assert page["items"][1]["label"] == "Item k1" and page["items"][1]["why"] == "Margin fell."
    assert (page["total"], page["truncated"]) == (4, False)


def test_the_overview_measures_fixes_dismissals_and_savings_a_later_run_confirmed(tmp_path):
    s, _ws, _made = hub_shell(tmp_path)
    page = overview(s)[1]["pages"]["n01_u05"]
    done = page["done"]
    assert (done["fixed"], done["fixed_q"], done["dismissed"], done["dismissed_q"]) == (3, 1, 1, 1)
    assert (done["saved_n"], done["saved"], done["saved_q_n"], done["saved_q"]) == (2, 1800.0, 1, 1100.0), \
        ("a fix counts its money at stake when it was marked done less what a later run still finds on it, once a later run no longer "
         "flags it or drops it; still flagged never counts")
    assert done["first_fixed"].startswith("2026-08-10") and done["first_saved"].startswith("2026-09-03")
    weeks = {w["week"]: w["saved"] for w in page["weeks"]}
    assert len(weeks) == 12 and min(weeks) == "2026-08-03" and max(weeks) == "2026-10-19"
    assert {k: v for k, v in weeks.items() if v} == {"2026-08-31": 700.0, "2026-10-05": 1100.0}


def test_the_overview_reads_when_the_use_case_last_updated_and_when_it_updates_next(tmp_path):
    s, _ws, _made = hub_shell(tmp_path)
    runs = overview(s)[1]["pages"]["n01_u05"]["runs"]
    assert runs == {"updated": "2026-10-20T06:00:00Z", "as_of": "2026-10-20", "cadence_days": 7, "next": "2026-10-27", "stale": False,
                    "count": 6, "failed": False, "active": None}


def test_a_use_case_page_narrows_its_things_to_fix_by_its_filters_and_ai_reason(tmp_path):
    s, ws, _made = hub_shell(tmp_path)
    status, out = overview(s, page="n01_u05", filters={"category": ["A"]}, ai={"ai_cat_driver": ["Price", "Not explained yet"]})
    assert status == 200, out
    assert [i["key"] for i in out["pages"]["n01_u05"]["items"]] == ["k1", "k4"]
    (sql, params), = ws.queries("'item' AS `kind`")
    day = [str(int(datetime.datetime(2026, 10, d, tzinfo=datetime.timezone.utc).timestamp()) * 1000000) for d in (24, 25)]
    assert [p["value"] for p in params] == ["A", "Price", "Not explained yet", "N01-U05", "2026-10-01", "2026-08-03", *day]


@pytest.mark.parametrize("body,status,error", [
    ({"filters": {"category": ["A"]}}, 400, "filters and AI filters apply to one page; name it in page"),
    ({"ai": {"ai_cat_driver": ["Price"]}}, 400, "filters and AI filters apply to one page; name it in page"),
    ({"page": "n01_u05", "filters": {"colour": ["red"]}}, 400, "the page has no filter 'colour'"),
    ({"page": "n01_u05", "ai": {"ai_cat_mood": ["x"]}}, 400, "the decision list has no AI category 'ai_cat_mood'; its AI categories: ai_cat_driver"),
    ({"page": "nope"}, 404, "the App has no page 'nope'")])
def test_a_bad_overview_request_is_refused_before_its_data_query(tmp_path, body, status, error):
    s, ws, _made = hub_shell(tmp_path)
    assert overview(s, **body) == (status, {"error": error})
    assert not ws.queries("'item' AS `kind`")


def test_the_overview_runs_one_data_query_per_use_case_concurrently_and_caches_it(tmp_path):
    pages = [hub_page(), hub_page("n02_u01", OTHER_TABLE, "N02-U01")]
    ws = SqliteWorkspace(tables={"loss_desk_out": ROWS, "invoice_out": ROWS}, barrier=threading.Barrier(2, timeout=5))
    s, ws, _made = hub_shell(tmp_path, pages=pages, ws=ws)
    status, out = overview(s)
    assert status == 200 and out["errors"] == {}, "the two data queries met at the barrier, so they ran at the same time"
    data = ws.queries("'item' AS `kind`")
    assert len(data) == 2 and sorted("invoice_out" in sql for sql, _p in data) == [False, True]
    assert len(ws.sql) == 8, "per use case: the table's columns, the list's columns, its money summary and one data query"
    ws.barrier = None
    overview(s)
    assert len(ws.sql) == 8, "a second look within a minute reads the cache"


def test_each_viewer_reads_the_overview_as_themselves_and_sees_only_use_cases_they_may_read(tmp_path):
    pages = [hub_page(), hub_page("n02_u01", OTHER_TABLE, "N02-U01")]
    denied = shell_db.QueryError("[INSUFFICIENT_PERMISSIONS] Insufficient privileges: User does not have SELECT on Table 'main.finance.invoice_out'.")
    ws = SqliteWorkspace(fail={"`invoice_out` LIMIT 0": denied})
    s, ws, made = hub_shell(tmp_path, settings=dict(SETTINGS, auth="user"), pages=pages, ws=ws)
    status, out = overview(s, headers={"x-forwarded-access-token": "tok-pat", "x-forwarded-email": PERSON})
    assert status == 200 and made["user"] == ["tok-pat"]
    assert out["pages"]["n02_u01"] == {"visible": False, "tracked": False, "note": ""}
    assert out["pages"]["n01_u05"]["visible"] is True and out["errors"] == {}
    assert call(s, "POST", "overview", body={})[0] == 401


def test_a_refused_read_under_the_service_principal_is_an_error_and_a_missing_table_is_not_ready(tmp_path):
    pages = [hub_page(), hub_page("n02_u01", OTHER_TABLE, "N02-U01")]
    denied = shell_db.QueryError("PERMISSION_DENIED: User does not have SELECT on Table")
    ws = SqliteWorkspace(fail={"`invoice_out` LIMIT 0": denied})
    s, _ws, _made = hub_shell(tmp_path / "a", pages=pages, ws=ws)
    out = overview(s)[1]
    assert out["errors"] == {"n02_u01": "PERMISSION_DENIED: User does not have SELECT on Table"} and "n02_u01" not in out["pages"]
    s, _ws, _made = hub_shell(tmp_path / "b", pages=pages)
    assert overview(s)[1]["pages"]["n02_u01"] == {"visible": True, "tracked": False, "empty": True,
                                                  "note": "no run of this use case has written its results yet"}


def test_a_page_without_a_result_table_has_nothing_to_fix_and_runs_no_query(tmp_path):
    s, ws, _made = hub_shell(tmp_path, pages=[dict(hub_page(), result_table=None)])
    assert overview(s)[1]["pages"]["n01_u05"] == {"visible": True, "tracked": False,
                                                  "note": "this page names no result table, so it has nothing to fix"}
    assert ws.sql == []


def test_a_table_without_money_says_so_and_never_invents_a_saving(tmp_path):
    plain = [{k: v for k, v in r.items() if k != "value_at_stake"} for r in ROWS]
    columns = tuple(c for c in COLUMNS if c in plain[0])
    db_ws = SqliteWorkspace(tables={})
    db_ws.db.execute(f'CREATE TABLE "loss_desk_out" ({", ".join(chr(34) + c + chr(34) for c in columns)})')
    db_ws.db.executemany(f'INSERT INTO "loss_desk_out" VALUES ({", ".join("?" for _ in columns)})', [tuple(r[c] for c in columns) for r in plain])
    s, _ws, _made = hub_shell(tmp_path, ws=db_ws)
    page = overview(s)[1]["pages"]["n01_u05"]
    assert (page["money"], page["weeks"]) == (False, []) and "actions" not in page
    assert page["done"]["saved"] is None and page["done"]["fixed"] == 3, "the fixes people recorded still count without an amount"
    assert {i["key"] for i in page["items"]} == {"k1", "k2", "k3", "k4"} and all(i["money"] is None for i in page["items"])


def test_a_failed_last_job_run_marks_the_use_case_not_updated(tmp_path):
    s, _ws, _made = hub_shell(tmp_path, settings=dict(SETTINGS, jobs={"n01_u05": "42"}))
    views = [{"run_id": "9", "result": "running", "started": None, "duration_s": None},
             {"run_id": "8", "result": "failed", "started": None, "duration_s": 60},
             {"run_id": "7", "result": "succeeded", "started": None, "duration_s": 60}]
    s.job_views = lambda job_id, active, limit: (views, False)
    assert overview(s)[1]["pages"]["n01_u05"]["runs"]["failed"] is True
    views[1]["result"] = "succeeded"
    s.cache.clear()
    assert overview(s)[1]["pages"]["n01_u05"]["runs"]["failed"] is False

    def broken(job_id, active, limit):
        raise shell_db.QueryError("jobs API down")

    s.job_views = broken
    s.cache.clear()
    assert overview(s)[1]["pages"]["n01_u05"]["runs"]["failed"] is False, "the App never claims a failure it could not read"


def test_overview_view_buckets_saved_days_into_weeks_and_reads_staleness():
    since = datetime.date(2026, 8, 3)
    rows = [{"kind": "day", "day": "2026-10-05", "money": 100.0}, {"kind": "day", "day": "2026-10-11", "money": 50.0},
            {"kind": "day", "day": "2026-10-12", "money": 7.0},
            {"kind": "run", "k": "a", "day": "2026-09-01", "at": "2026-09-01T06:00:00.000Z"},
            {"kind": "run", "k": "b", "day": "2026-09-08", "at": "2026-09-08 06:00:00"}]
    view = shell_core.overview_view(rows, datetime.date(2026, 10, 24), since, True)
    weeks = {w["week"]: w["saved"] for w in view["weeks"]}
    assert (weeks["2026-10-05"], weeks["2026-10-12"], weeks["2026-09-28"]) == (150.0, 7.0, 0.0)
    assert view["runs"]["stale"] is True and view["runs"]["next"] == "2026-09-15" and view["runs"]["updated"] == "2026-09-08T06:00:00Z"
    empty = shell_core.overview_view([], datetime.date(2026, 10, 24), since, False)
    assert (empty["items"], empty["weeks"], empty["total"], empty["runs"]["updated"], empty["runs"]["next"]) == ([], [], 0, None, None)


@pytest.mark.parametrize("day,quarter,week", [("2026-10-24", "2026-10-01", "2026-10-19"), ("2026-03-31", "2026-01-01", "2026-03-30"),
                                              ("2026-07-01", "2026-07-01", "2026-06-29"), ("2026-12-31", "2026-10-01", "2026-12-28")])
def test_the_quarter_and_week_start_on_their_first_day(day, quarter, week):
    d = datetime.date.fromisoformat(day)
    assert (shell_core.quarter_start(d).isoformat(), shell_core.week_start(d).isoformat()) == (quarter, week)


def test_the_overview_statement_parses_as_databricks_sql_and_renders_for_lakebase():
    page = hub_page()
    fields = shell_sql.change_fields([{"name": c, "type": TYPES.get(c, "STRING")} for c in COLUMNS])
    context = shell_sql.list_context(page, set(COLUMNS), fields, True)
    sql, params = shell_sql.overview_query(page, {"category": ["A"]}, {"ai_cat_driver": ["Price"]}, context, fields, "2026-10-01", "2026-08-03")
    sqlglot.parse_one(re.sub(r":p\d+", "'x'", sql), read="databricks")
    held = {TABLE: {"pg": "app.loss_desk_out", "columns": [{"name": c} for c in COLUMNS]}}
    text, values, read = shell_pg.render(sql, params, held)
    assert read == {TABLE} and "UNION ALL" in text and values["p0"] == "A" and values["p2"] == "N01-U05" and values["p3"] == datetime.date(2026, 10, 1)
    assert sql.count(" UNION ALL ") == 8, "items, six counts, saved days and runs come back in one statement"


def test_the_list_keeps_its_current_version_columns_when_the_overview_adds_its_own():
    page = hub_page()
    fields = shell_sql.change_fields([{"name": c, "type": TYPES.get(c, "STRING")} for c in COLUMNS])
    context = shell_sql.list_context(page, set(COLUMNS), fields, True)
    assert shell_sql._current_cte(context).endswith(
        "CAST(`ai_cat_driver` AS STRING) AS `_inspire_ai_cat_driver`, CAST(`not_listed_since` AS TIMESTAMP) AS `_inspire_missing` FROM "
        "`main`.`pricing`.`loss_desk_out` WHERE `is_current` AND `change_source` <> 'delete'")
    assert (", CAST(`action_due` AS DATE) AS `_inspire_due`, CAST(`not_listed_since` AS TIMESTAMP) AS `_inspire_missing` FROM"
            in shell_sql._current_cte(context, ["CAST(`action_due` AS DATE) AS `_inspire_due`"]))


def test_the_pre_deploy_check_names_a_failing_overview(tmp_path):
    s, ws, _made = hub_shell(tmp_path)
    ws.fail["'item' AS `kind`"] = shell_db.QueryError("[UNRESOLVED_COLUMN] value_at_stake")
    problems = s.check({})
    assert "page n01_u05: the Overview's things to fix failed: [UNRESOLVED_COLUMN] value_at_stake" in problems
