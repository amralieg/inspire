import copy
import json
import re
import statistics
import urllib.parse

import pytest

from _agentload import agent_source
from v140_implement_test import ALERT, _alert_inspire, _calls_to, _deploy_inspire, _output_context, SHELL_FILES, READS, sdk_stub  # noqa: F401
from v141_app_shell_test import PAGE, SETTINGS, call
from v148_app_hub_test import PERSON, ROWS, SqliteWorkspace, hub_page, hub_shell, to_sqlite, version
from v120_genie_support import build_inspire

import shell_alerts
import shell_core
import shell_db
import shell_sql

TABLE = "main.pricing.loss_desk_out"
FOLDER = "/Workspace/Users/owner@example.com/acme_implemented/Sales/alerts/loss-desk"
ADMIN = "@".join(("owner", "example.com"))
SAM = "@".join(("sam.ray", "example.com"))
LEE = "@".join(("lee.kim", "example.com"))
ON = dict(SETTINGS, options=dict(SETTINGS["options"], decisions=True, alerts=True), alert_folder=FOLDER)
ME = {"x-forwarded-email": PERSON, "x-forwarded-host": "loss-desk-1.example.com"}
WATCH = {"what": "records", "filters": {"category": ["A"]}, "operator": ">=", "threshold": 2, "basis": "fixed"}
HISTORY = shell_sql.HISTORY_COLUMNS + ("category", "run_id", "as_of_date")


class _StddevSamp:
    def __init__(self):
        self.values = []

    def step(self, value):
        if value is not None:
            self.values.append(float(value))

    def finalize(self):
        return statistics.stdev(self.values) if len(self.values) > 1 else None


class AlertsWorkspace(SqliteWorkspace):
    def __init__(self, tables=None, users=(PERSON, SAM, LEE, ADMIN), fail=None):
        super().__init__(tables)
        self.db.create_aggregate("STDDEV_SAMP", 1, _StddevSamp)
        self.users, self.alerts, self.calls, self.next_id, self.broken = list(users), {}, [], 9000, dict(fail or {})

    def call(self, method, path, body=None, params=None, timeout=60):
        self.calls.append((method, path, copy.deepcopy(body), dict(params or {})))
        for (m, p), error in self.broken.items():
            if m == method and path.startswith(p):
                raise error
        if path == "/api/2.0/workspace/list":
            folder = params["path"]
            if folder != FOLDER:
                raise shell_db.QueryError(f"GET /api/2.0/workspace/list answered HTTP 404: Path ({folder}) doesn't exist.")
            return {"objects": [{"object_type": "ALERT", "object_id": int(i), "path": f"{folder}/{a['display_name']}.dbalert.json"}
                                for i, a in self.alerts.items() if a["lifecycle_state"] == "ACTIVE"]}
        if path == "/api/2.0/preview/scim/v2/Users":
            wanted = re.match(r'^userName eq "(.*)"$', params["filter"]).group(1)
            hits = [{"userName": u, "active": True} for u in self.users if u.lower() == wanted.lower()]
            return {"totalResults": len(hits), "Resources": hits} if hits else {"totalResults": 0}
        if path == "/api/2.0/alerts" and method == "POST":
            if any(a["display_name"] == body["display_name"] and a["lifecycle_state"] == "ACTIVE" for a in self.alerts.values()):
                raise shell_db.QueryError("POST /api/2.0/alerts answered HTTP 400: A node of same type ALERT_V2 already exists")
            for s in body["evaluation"]["notification"].get("subscriptions") or []:
                if s["user_email"] not in self.users:
                    raise shell_db.QueryError(f"POST /api/2.0/alerts answered HTTP 400: Failed to get user id for email: {s['user_email']}")
            self.next_id += 1
            alert = dict(copy.deepcopy(body), id=str(self.next_id), lifecycle_state="ACTIVE", owner_user_name="app-sp",
                         parent_path=body["parent_path"])
            self.alerts[alert["id"]] = alert
            return copy.deepcopy(alert)
        ident = path.rsplit("/", 1)[-1]
        alert = self.alerts.get(ident)
        if alert is None:
            raise shell_db.QueryError(f"{method} {path} answered HTTP 404: Node not found")
        if method == "GET":
            return copy.deepcopy(alert)
        if method == "PATCH":
            if alert["lifecycle_state"] != "ACTIVE":
                raise shell_db.QueryError(f"PATCH {path} answered HTTP 400: Cannot rename an asset that is in the trash.")
            for key in params["update_mask"].split(","):
                alert[key] = copy.deepcopy(body[key])
            return copy.deepcopy(alert)
        if method == "DELETE":
            alert["lifecycle_state"] = "DELETED"
            return {}
        raise AssertionError(f"unexpected {method} {path}")

    def posted(self):
        return [body for m, p, body, _q in self.calls if (m, p) == ("POST", "/api/2.0/alerts")]


def alerts_shell(tmp_path, settings=ON, rows=None, users=(PERSON, SAM, LEE, ADMIN), fail=None):
    ws = AlertsWorkspace({"loss_desk_out": ROWS if rows is None else rows}, users, fail)
    s, ws, _made = hub_shell(tmp_path, settings=settings, ws=ws)
    return s, ws


def save(s, headers=ME, **changes):
    body = dict({"page": "n01_u05", "name": "Category A grows", "watch": WATCH, "schedule": "daily", "emails": [PERSON]}, **changes)
    return call(s, "POST", "alerts/save", headers=headers, body=body)


def test_alert_query_measures_a_dataset_against_a_fixed_number():
    query = shell_sql.alert_query("SUM(`value_at_stake`)", "<", 3, source="SELECT * FROM t", conditions=["`a` = 'x'", "`b` = 'y'"])
    assert query == {"query": "WITH latest AS (SELECT * FROM (SELECT * FROM t) AS d WHERE `a` = 'x' AND `b` = 'y'),\n"
                              "watched_value AS (SELECT SUM(`value_at_stake`) AS watched_value FROM latest)\n"
                              "SELECT watched_value FROM watched_value",
                     "column": "watched_value", "operator": "LESS_THAN", "threshold": 3.0}


@pytest.mark.parametrize("args,kwargs,needle", [
    (("COUNT(*)", "=>", 1), {"source": "SELECT 1"}, "compares with one of >=, >, =, !=, <, <="),
    (("COUNT(*)", ">", 1, "median"), {"source": "SELECT 1"}, "fixed or a baseline"),
    (("COUNT(*)", ">", float("nan")), {"source": "SELECT 1"}, "is a number"),
    (("COUNT(*)", ">", True), {"source": "SELECT 1"}, "is a number"),
    (("COUNT(*)", "=", 1, "baseline"), {"table": TABLE}, "rise or a fall"),
    (("COUNT(*)", ">", 1, "baseline"), {"source": "SELECT 1", "table": TABLE, "columns": HISTORY}, "its dataset must read the result table"),
    (("COUNT(*)", ">", 1, "baseline"), {"source": f"SELECT * FROM {TABLE}", "table": TABLE, "columns": ()},
     "whose columns Inspire must read"),
    (("COUNT(*)", ">", 1, "baseline"), {"source": f"SELECT * FROM {TABLE}", "columns": HISTORY}, "its dataset must read the result table"),
    (("COUNT(*)", ">", 1), {}, "an alert reads one dataset"),
    (("COUNT(*)", ">", 1), {"table": TABLE}, "an alert reads one dataset"),
    (("COUNT(*)", ">", 1), {"source": "SELECT 1", "name": "bad name"}, "is not a column or dataset name"),
])
def test_alert_query_refuses_what_an_alert_cannot_evaluate(args, kwargs, needle):
    with pytest.raises(ValueError, match=re.escape(needle)):
        shell_sql.alert_query(*args, **kwargs)


def test_the_agent_build_time_alert_is_the_app_builder_with_the_tier_count(agent_ns):
    for name in ("OPERATORS", "BASELINE_DIRECTIONS", "BASELINE_SIGMAS", "BASELINE_MIN_RUNS", "BASELINE_RUNS", "GONE"):
        assert agent_ns[f"IMPLEMENT_ALERT_{name}"] == getattr(shell_sql, f"ALERT_{name}"), name
    assert agent_ns["IMPLEMENT_ALERT_THRESHOLD_BASES"] == shell_sql.ALERT_BASES
    outputs = {"alert_tiers": "act_now_review", "alert_operator": "<", "alert_threshold": 4, "alert_threshold_basis": "baseline"}
    for condition in ("", "SELECT TRUE AS triggered -- note"):
        built = agent_ns["implement_alert_query"](shell_sql, TABLE, outputs, condition, columns=HISTORY)
        assert built == shell_sql.alert_query("COUNT_IF(priority_tier IN ('Act now', 'Review'))", "<", 4.0, "baseline",
                                              source=shell_sql.records_sql(TABLE), table=TABLE, columns=HISTORY, name="tier_rows",
                                              extra=agent_ns["IMPLEMENT_ALERT_RUN_COLUMNS"], condition=condition)
    assert 'shell_sql = self._implement_app_shell()[1]["shell_sql"]' in agent_source() and \
        'query = implement_alert_query(shell_sql, context["result_table"], outputs, condition_sql,' in agent_source(), \
        "the build-time alert is built by the App shell's builder"
    assert "def alert_query(" not in agent_source() and "history AS (" not in agent_source(), "the agent keeps no second alert builder"


def baseline_rows():
    rows, days = [], ("2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06")
    for at, (day, count) in enumerate(zip(days, (2, 0, 4, 2, 2, 2))):
        ends = f"{days[at + 1]} 06:00:00" if at + 1 < len(days) else "2026-10-20 06:00:00"
        rows += [version(f"h{day[-1]}{i}", "Act now", 10.0, current=False, ends=ends, run_id=f"run{day[-1]}", as_of_date=day,
                         valid_from=f"{day} 06:00:00", category="A") for i in range(count)]
        rows.append(version(f"b{day[-1]}", "Act now", 10.0, current=False, ends=ends, run_id=f"run{day[-1]}", as_of_date=day,
                            valid_from=f"{day} 06:00:00", category="B"))
    rows += [version(f"c{i}", "Act now", 10.0, category="A") for i in range(9)]
    return rows


def run(ws, query):
    return ws.run_sql("wh1", query["query"], [], 5)["rows"][0]


def test_a_filtered_baseline_reads_each_earlier_run_as_it_left_the_list_and_skips_a_run_the_filter_leaves_empty(tmp_path):
    ws = AlertsWorkspace({"loss_desk_out": baseline_rows()})
    page = hub_page()
    query = shell_sql.watch_query(page, dict(WATCH, basis="baseline", operator=">"), shell_sql.HISTORY_COLUMNS + ("category", "run_id",
                                                                                                                  "as_of_date"))
    row = run(ws, query)
    assert (row["history_runs"], row["baseline_mean"], row["previous_run_value"]) == (5, 2.4, 2), \
        "the run of 2026-10-02 had no category A record, so it has no value, as the tile shows no earlier value for it"
    assert row["watched_value"] == 9 and row["threshold_basis"] == "baseline" and row["alert_value"] == 1, row
    assert ") AS d WHERE CAST(`category` AS STRING) IN ('A')),\n" in query["query"].split("history AS")[0], "the filter narrows every run"
    assert query["query"].count("WITH runs AS (") == 1 and "latest AS (" not in query["query"], "one read serves the latest and earlier runs"


def test_watch_query_counts_the_filtered_list_with_safely_quoted_values():
    page = hub_page()
    query = shell_sql.watch_query(page, dict(WATCH, filters={"category": ["it's", "back\\slash"]}))
    assert "WHERE CAST(`category` AS STRING) IN ('it\\'s', 'back\\\\slash')" in query["query"]
    assert query["query"].startswith(f"WITH latest AS (SELECT * FROM (SELECT * FROM {TABLE} WHERE is_current AND change_source <> 'delete') AS d")
    kpi = shell_sql.watch_query(page, dict(WATCH, what="k1", operator="<", threshold=5.5))
    assert "SUM(value_at_stake) AS watched_value" in kpi["query"] and "FROM (SELECT as_of_date, category, value_at_stake FROM" in kpi["query"]
    assert (kpi["operator"], kpi["threshold"]) == ("LESS_THAN", 5.5)


@pytest.mark.parametrize("watch,names,needle", [
    (dict(WATCH, what="nope"), (), "the page has no KPI 'nope' to watch"),
    (dict(WATCH, filters={"run_date": {"from": "2026-01-01", "to": "2026-02-01"}}), (), "filters on segments, not on the dates of Run date"),
    (dict(WATCH, filters={"ghost": ["A"]}), (), "the page has no filter 'ghost'"),
    (dict(WATCH, basis="baseline", operator=">"), (),
     "so Records on the list cannot be compared with earlier runs; use a fixed number"),
    (dict(WATCH, what="k0", basis="baseline", operator=">", filters={}), (),
     "Inspire could not read the columns of the result table"),
])
def test_watch_query_refuses_an_alert_it_cannot_build(watch, names, needle):
    with pytest.raises(ValueError, match=re.escape(needle)):
        shell_sql.watch_query(hub_page(), watch, names)
    no_list = hub_page(records=None, datasets=[d for d in hub_page()["datasets"] if d["name"] != "records"])
    with pytest.raises(ValueError, match="the page has no decision list to watch"):
        shell_sql.watch_query(no_list, WATCH)
    unreached = hub_page(filters=[f if f["id"] != "category" else dict(f, columns={"trend": "category"}) for f in hub_page()["filters"]])
    with pytest.raises(ValueError, match="the filter Category does not reach Records on the list"):
        shell_sql.watch_query(unreached, WATCH)


def assigned_rows():
    return [
        version("k1", "Act now", 1.0, current=False, ends="2026-10-24 11:10:00", action_owner=None),
        version("k1", "Act now", 1.0, source="action", at="2026-10-24 11:10:00", action_owner=PERSON, changed_by=SAM),
        version("k2", "Act now", 1.0, current=False, ends="2026-10-24 11:20:00"),
        version("k2", "Act now", 1.0, source="action", at="2026-10-24 11:20:00", action_owner=PERSON, changed_by=PERSON),
        version("k3", "Act now", 1.0, current=False, ends="2026-10-24 10:20:00"),
        version("k3", "Act now", 1.0, source="action", at="2026-10-24 10:20:00", action_owner=PERSON, changed_by=SAM),
        version("k4", "Act now", 1.0, current=False, ends="2026-10-24 11:30:00"),
        version("k4", "Act now", 1.0, source="action", current=False, at="2026-10-24 11:30:00", ends="2026-10-24 11:40:00",
                action_owner=PERSON, changed_by=SAM),
        version("k4", "Act now", 1.0, source="action", at="2026-10-24 11:40:00", action_owner=LEE, changed_by=SAM),
        version("k5", "Act now", 1.0, source="action", current=False, at="2026-10-23 09:00:00", ends="2026-10-24 11:50:00",
                action_owner=PERSON.upper(), changed_by=SAM),
        version("k5", "Act now", 1.0, source="action", at="2026-10-24 11:50:00", action_owner=PERSON, action_status="Done", changed_by=SAM),
    ]


def test_the_assignment_alert_counts_records_someone_else_gave_the_owner_in_the_last_full_hour():
    ws = AlertsWorkspace({"loss_desk_out": assigned_rows()})
    query = shell_sql.assigned_query(TABLE, PERSON.upper(), "'2026-10-24 12:00:00'")
    sql = to_sqlite(query["query"]).replace("'2026-10-24 12:00:00' - INTERVAL '1' HOUR", "'2026-10-24 11:00:00'")
    rows = ws.db.execute(sql).fetchall()
    assert rows == [(1,)], ("k1 counts; k2 the owner took themselves; k3 was before the hour; k4 went on to someone else; k5 only "
                           "changed status for the same owner")
    assert (query["column"], query["operator"], query["threshold"]) == ("assigned", "GREATER_THAN", 0.0)
    live = shell_sql.assigned_query(TABLE, PERSON)["query"]
    assert ("`valid_from` >= date_trunc('HOUR', current_timestamp()) - INTERVAL 1 HOUR AND `valid_from` < "
            "date_trunc('HOUR', current_timestamp())") in live


def test_settings_keep_alerts_off_unless_set_and_need_a_folder_when_on():
    assert shell_core.settings_problems(SETTINGS, [PAGE]) == [], "an App built before alerts keeps working"
    assert shell_core.settings_problems(ON, [PAGE]) == []
    missing = dict(ON)
    missing.pop("alert_folder")
    assert "the App sends alerts, so its settings need alert_folder, the workspace folder that keeps them" in shell_core.settings_problems(
        missing, [PAGE])
    assert any("alert_folder must be a workspace folder path" in p for p in shell_core.settings_problems(dict(ON, alert_folder="relative"),
                                                                                                         [PAGE]))
    user = dict(ON, auth="user", options=dict(ON["options"], decisions=False))
    assert "an App where each viewer sees only their own data cannot send alerts" in shell_core.settings_problems(user, [PAGE])
    assert any("alerts to true or false when they set it" in p for p in shell_core.settings_problems(
        dict(SETTINGS, options=dict(SETTINGS["options"], alerts="yes")), [PAGE]))
    broken = shell_core.settings_problems(dict(ON, options=["alerts"]), [PAGE])
    assert any(p.startswith("the App options must set") for p in broken), "options that are not an object are a problem, not a crash"
    assert shell_alerts.folder_problems({"options": ["alerts"]}) == []


def test_the_app_says_whether_alerts_are_on_and_why_not(tmp_path):
    s, _ws = alerts_shell(tmp_path / "on")
    assert call(s, "GET", "app")[1]["alerting"] == {"on": True, "reason": ""}
    assert call(s, "GET", "app")[1]["options"]["alerts"] is True
    s, _ws = alerts_shell(tmp_path / "off", settings=SETTINGS)
    assert call(s, "GET", "app")[1]["alerting"] == {"on": False, "reason": ""}
    status, out = save(s)
    assert status == 409 and "Alerts are off for this App" in out["error"]
    user = dict(SETTINGS, auth="user")
    s, _ws = alerts_shell(tmp_path / "user", settings=user)
    info = call(s, "GET", "app", headers={"x-forwarded-access-token": "t", "x-forwarded-email": PERSON})[1]
    assert info["alerting"]["on"] is False and info["alerting"]["reason"].startswith("This App shows each person only their own data")
    assert "\u2014" not in info["alerting"]["reason"] and "\u2013" not in info["alerting"]["reason"]


def test_people_create_list_edit_pause_and_delete_their_own_alerts_as_the_service_principal(tmp_path):
    s, ws = alerts_shell(tmp_path)
    status, out = save(s, emails=[PERSON.upper(), SAM, SAM])
    assert status == 200, out
    [body] = ws.posted()
    assert body["parent_path"] == FOLDER and body["warehouse_id"] == "wh1"
    assert body["schedule"] == {"quartz_cron_schedule": "0 0 8 * * ?", "timezone_id": "UTC", "pause_status": "UNPAUSED"}
    assert body["evaluation"]["notification"] == {"notify_on_ok": True, "subscriptions": [{"user_email": PERSON}, {"user_email": SAM}]}
    assert body["evaluation"]["source"]["name"] == "watched_value" and body["evaluation"]["comparison_operator"] == "GREATER_THAN_OR_EQUAL"
    assert body["evaluation"]["threshold"] == {"value": {"double_value": 2.0}}
    meta = shell_alerts.read_meta(body["query_text"])
    assert meta == {"v": 1, "kind": "watch", "page": "n01_u05", "by": PERSON, "name": "Category A grows", "watch": dict(WATCH, threshold=2.0),
                    "schedule": "daily", "token": meta["token"], "notify_on_ok": True}
    assert body["display_name"] == f"Category A grows ({meta['token']})"
    assert body["custom_summary"] == "Category A grows: Records on the list is at least 2"
    assert body["custom_description"].splitlines() == [
        "What fired: Records on the list on Desk n01_u05 is at least 2, counting only Category: A.",
        f"Why this threshold: 2 is the number {PERSON} set for this alert in the App.", "How often it checks: every day at 08:00 UTC.",
        "What to do first:", "1. Open the decision list (https://loss-desk-1.example.com/?open=n01_u05) and work its rows by rank, top "
        "first; each row's recommended action says what to do with it.", "Where to look:", "App: https://loss-desk-1.example.com/?open=n01_u05",
        "When it clears: you get one more email when it returns to OK.", f"Set up in the App by {PERSON}."]
    assert "Item k" not in body["custom_description"] and "record_key" not in body["query_text"].split("\n", 1)[0]
    listed = call(s, "GET", "alerts", {"page": "n01_u05"}, headers=ME)[1]
    [mine] = listed["alerts"]
    assert (mine["kind"], mine["by"], mine["state"], mine["can_change"], mine["emails"], mine["email_count"]) == (
        "watch", PERSON, "unknown", True, [PERSON, SAM], 2)
    assert mine["url"] == f"https://dbc-1.example.com/sql/alerts-v2/{mine['id']}"
    assert listed["caps"] == {"app": 20, "person": 10, "used": 1, "mine": 1}
    other = call(s, "GET", "alerts", {"page": "n01_u05"}, headers={"x-forwarded-email": SAM})[1]["alerts"][0]
    assert (other["can_change"], other["emails"], other["email_count"]) == (False, [], 2), "only the creator sees who it emails"
    status, edited = save(s, id=mine["id"], name="Category A doubles", watch=dict(WATCH, threshold=4), schedule="hourly", emails=[LEE])
    assert status == 200, edited
    patch = [(b, q) for m, p, b, q in ws.calls if m == "PATCH"][-1]
    assert patch[1] == {"update_mask": "display_name,query_text,custom_summary,custom_description,evaluation,schedule"}
    assert patch[0]["display_name"] == f"Category A doubles ({meta['token']})" and "parent_path" not in patch[0]
    assert ws.alerts[mine["id"]]["schedule"]["quartz_cron_schedule"] == "0 0 * * * ?"
    assert shell_alerts.read_meta(ws.alerts[mine["id"]]["query_text"])["by"] == PERSON, "an edit keeps who set it up"
    status, paused = call(s, "POST", "alerts/pause", headers=ME, body={"id": mine["id"], "paused": True})
    assert status == 200 and paused["alert"]["state"] == "paused"
    assert ws.alerts[mine["id"]]["schedule"] == {"quartz_cron_schedule": "0 0 * * * ?", "timezone_id": "UTC", "pause_status": "PAUSED"}
    status, out = call(s, "POST", "alerts/delete", headers=ME, body={"id": mine["id"]})
    assert status == 200 and out == {"deleted": mine["id"]}
    assert call(s, "GET", "alerts", {"page": "n01_u05"}, headers=ME)[1]["alerts"] == []


def test_only_the_creator_or_the_admin_changes_an_alert_and_the_built_alert_stays_read_only(tmp_path):
    built = "https://dbc-1.example.com/sql/alerts-v2/55"
    s, ws = alerts_shell(tmp_path, settings=dict(ON, alerts={"n01_u05": built}))
    ident = save(s)[1]["alert"]["id"]
    sam = {"x-forwarded-email": SAM}
    for path, body in (("alerts/save", {"page": "n01_u05", "id": ident, "name": "x", "watch": WATCH, "schedule": "daily", "emails": [SAM]}),
                       ("alerts/pause", {"id": ident, "paused": True}), ("alerts/delete", {"id": ident})):
        status, out = call(s, "POST", path, headers=sam, body=body)
        assert status == 403 and "App's admin" in out["error"], (path, out)
    assert call(s, "POST", "alerts/pause", headers={"x-forwarded-email": ADMIN.upper()}, body={"id": ident, "paused": True})[0] == 200
    listed = call(s, "GET", "alerts", {"page": "n01_u05"}, headers={"x-forwarded-email": ADMIN})[1]
    assert listed["built"] == built and listed["admin"] is True and listed["alerts"][0]["can_change"] is True
    for path in ("alerts/pause", "alerts/delete"):
        status, out = call(s, "POST", path, headers=ME, body={"id": "55", "paused": True})
        assert status == 404 and "the alert set up when the App was built opens in Databricks" in out["error"]
    assert not [c for c in ws.calls if c[1].endswith("/55")], "the App never touches the wizard-built alert"
    status, out = call(s, "POST", "alerts/save", headers={}, body={"page": "n01_u05", "name": "x", "watch": WATCH, "schedule": "daily",
                                                                  "emails": [PERSON]})
    assert status == 401


def test_alerts_go_only_to_workspace_users_and_never_to_typed_addresses_that_are_not(tmp_path):
    s, ws = alerts_shell(tmp_path)
    for emails, needle in (([], "add at least one email address"), (["not-an-email"], "'not-an-email' is not an email address"),
                           (['x"@example.com'], "is not an email address"), ([f"p{i}@example.com" for i in range(21)], "at most 20 people"),
                           (["zz@example.com"], "zz@example.com is not a user of this workspace"),
                           (["zz@example.com", "yy@example.com"], "zz@example.com, yy@example.com are not users of this workspace")):
        status, out = save(s, emails=emails)
        assert status == 400 and needle in out["error"], (emails, out)
    assert ws.posted() == []
    scim = [q for m, p, _b, q in ws.calls if p == "/api/2.0/preview/scim/v2/Users"]
    assert scim[0] == {"filter": 'userName eq "zz@example.com"', "attributes": "userName,active"}


@pytest.mark.parametrize("changes,needle", [
    ({"schedule": "monthly"}, "check the alert hourly, daily or weekly"),
    ({"name": ""}, "name the alert in 1 to 100 characters"),
    ({"paused": "no"}, "paused takes true or false"),
    ({"watch": dict(WATCH, threshold="lots")}, "the threshold must be a number"),
    ({"watch": dict(WATCH, operator="=", basis="baseline")}, "rise or a fall"),
    ({"watch": "records"}, "say what the alert watches"),
])
def test_a_bad_alert_is_refused_before_anything_is_saved(tmp_path, changes, needle):
    s, ws = alerts_shell(tmp_path)
    status, out = save(s, **changes)
    assert status == 400 and needle in out["error"], out
    assert ws.posted() == []


def test_the_app_keeps_at_most_20_alerts_and_10_per_person(tmp_path):
    s, ws = alerts_shell(tmp_path)
    for i in range(10):
        assert save(s, name=f"Mine {i}")[0] == 200
    status, out = save(s, name="Mine 10")
    assert status == 409 and "you already set up 10 alerts in this App" in out["error"]
    for i in range(10):
        assert save(s, headers={"x-forwarded-email": SAM}, name=f"Sam {i}", emails=[SAM])[0] == 200
    status, out = save(s, headers={"x-forwarded-email": LEE}, name="Lee", emails=[LEE])
    assert status == 409 and "this App already keeps 20 alerts" in out["error"]
    assert len(ws.posted()) == 20


def test_the_preview_shows_the_current_value_and_whether_it_would_fire(tmp_path):
    s, ws = alerts_shell(tmp_path)
    status, out = call(s, "POST", "alerts/preview", headers=ME, body={"page": "n01_u05", "watch": WATCH})
    assert status == 200 and out == dict(shell_sql.compare_words(), value=7, fires=True, threshold=2.0, basis="fixed", history_runs=None), out
    status, out = call(s, "POST", "alerts/preview", headers=ME, body={"page": "n01_u05", "watch": dict(WATCH, threshold=8)})
    assert out["fires"] is False
    s, ws = alerts_shell(tmp_path / "b", rows=baseline_rows())
    status, out = call(s, "POST", "alerts/preview", headers=ME, body={"page": "n01_u05", "watch": dict(WATCH, basis="baseline", operator=">")})
    assert status == 200 and (out["value"], out["fires"], out["basis"], out["history_runs"], out["previous"]) == (9, True, "baseline", 5, 2), out
    assert ws.posted() == [], "a preview saves nothing"


def test_the_list_offers_each_measure_with_its_filters_and_whether_it_compares_with_earlier_runs(tmp_path):
    s, _ws = alerts_shell(tmp_path)
    listed = call(s, "GET", "alerts", {"page": "n01_u05"}, headers=ME)[1]
    by = {m["id"]: m for m in listed["measures"]}
    assert list(by) == ["records", "k0", "k1", "k2"]
    assert (by["records"]["label"], by["records"]["filters"], by["records"]["baseline"], by["records"]["baseline_filters"]) == (
        "Records on the list", ["category"], True, ["category"])
    assert by["k0"]["baseline"] is True and by["k0"]["format"] == "currency" and by["k0"]["currency"] == "USD"
    assert [x["id"] for x in listed["schedules"]] == ["hourly", "daily", "weekly"]
    assert listed["operators"] == [">=", ">", "=", "!=", "<", "<="] and listed["baseline_operators"] == [">=", ">", "<=", "<"]


def test_an_unreachable_alerts_folder_says_so_plainly(tmp_path):
    s, _ws = alerts_shell(tmp_path, settings=dict(ON, alert_folder="/Workspace/Users/owner@example.com/gone"))
    status, out = call(s, "GET", "alerts", {"page": "n01_u05"}, headers=ME)
    assert status == 503 and out["error"].startswith("The App cannot reach its alerts folder, so it cannot show or keep alerts.")


def test_an_alert_the_api_reports_deleted_or_without_the_app_header_is_not_listed(tmp_path):
    s, ws = alerts_shell(tmp_path)
    kept = save(s)[1]["alert"]["id"]
    ws.alerts["1"] = {"id": "1", "display_name": "made in the UI", "query_text": "SELECT 1", "lifecycle_state": "ACTIVE", "parent_path": FOLDER}
    ws.alerts[kept]["lifecycle_state"] = "TRASHED"
    s.alerts.forget()
    assert call(s, "GET", "alerts", {"page": "n01_u05"}, headers=ME)[1]["alerts"] == []
    assert shell_alerts.read_meta("-- inspire-app-alert {bad json\nSELECT 1") == {}
    assert shell_alerts.read_meta('-- inspire-app-alert {"v": 2, "kind": "watch"}\nSELECT 1') == {}


def act(s, headers, owner):
    return call(s, "POST", "records/act", headers=headers, body={"page": "n01_u05", "record_keys": ["k2"], "seen": {"k2": "1"},
                                                                 "values": {"action_owner": owner}})


def test_assigning_a_record_sets_up_one_hourly_email_to_the_owner_with_no_record_rows(tmp_path):
    s, ws = alerts_shell(tmp_path)
    s.write_versions = lambda *args, **kwargs: {"num_inserted_rows": 1}
    status, out = act(s, ME, SAM.upper())
    assert status == 200 and out["notice"] == f"{SAM} gets an email about it within the hour.", out
    [body] = ws.posted()
    meta = shell_alerts.read_meta(body["query_text"])
    assert (meta["kind"], meta["owner"], meta["by"], meta["page"]) == ("assigned", SAM, PERSON, "n01_u05")
    assert body["evaluation"]["notification"] == {"notify_on_ok": False, "subscriptions": [{"user_email": SAM}], "retrigger_seconds": 3000}
    assert body["schedule"] == {"quartz_cron_schedule": "0 5 * * * ?", "timezone_id": "UTC", "pause_status": "UNPAUSED"}
    assert body["evaluation"]["source"]["name"] == "assigned" and body["evaluation"]["comparison_operator"] == "GREATER_THAN"
    assert "COUNT(DISTINCT `record_key`) AS assigned" in body["query_text"]
    assert body["custom_summary"] == "New records were assigned to you on Desk n01_u05"
    assert "k2" not in body["custom_description"] and "Item" not in body["custom_description"]
    assert act(s, {"x-forwarded-email": LEE}, SAM)[1]["notice"] == f"{SAM} gets an email about it within the hour."
    assert len(ws.posted()) == 1, "one email alert per owner and page"
    assert "notice" not in act(s, ME, PERSON)[1], "taking a record yourself sends you nothing"
    assert act(s, ME, "zz@example.com")[1]["notice"] == "No email went to zz@example.com: alerts go only to users of this workspace."
    assert act(s, ME, "sam")[1]["notice"] == "No email went to sam: it is not an email address."
    listed = call(s, "GET", "alerts", {"page": "n01_u05"}, headers={"x-forwarded-email": SAM})[1]
    [notice] = listed["alerts"]
    assert (notice["kind"], notice["owner"], notice["can_change"]) == ("assigned", SAM, True), "the owner may pause their own email"
    status, out = save(s, id=notice["id"])
    assert status == 409 and "you can pause it or delete it" in out["error"]
    assert listed["caps"]["used"] == 0, "assignment emails do not count against the alerts people set up"


def test_no_assignment_email_when_alerts_are_off_or_the_alert_cannot_be_made(tmp_path):
    s, ws = alerts_shell(tmp_path / "off", settings=dict(SETTINGS, options=dict(SETTINGS["options"], decisions=True)))
    s.write_versions = lambda *args, **kwargs: {"num_inserted_rows": 1}
    status, out = act(s, ME, SAM)
    assert status == 200 and "notice" not in out and ws.calls == []
    s, ws = alerts_shell(tmp_path / "broken", fail={("POST", "/api/2.0/alerts"): shell_db.QueryError("POST /api/2.0/alerts answered HTTP 403")})
    s.write_versions = lambda *args, **kwargs: {"num_inserted_rows": 1}
    status, out = act(s, ME, SAM)
    assert status == 200 and out["written"] == ["k2"]
    assert out["notice"] == f"No email went to {SAM}: the App could not set up its email (POST /api/2.0/alerts answered HTTP 403)."


def test_the_alert_header_round_trips_and_names_stay_valid_workspace_names():
    meta = {"v": 1, "kind": "watch", "page": "p", "by": PERSON, "name": "a/b", "watch": WATCH, "schedule": "weekly", "token": "abc123"}
    text = shell_alerts.write_meta(meta, "SELECT 1")
    assert text.splitlines()[1] == "SELECT 1" and shell_alerts.read_meta(text) == meta
    s = type("S", (), {"warehouse": "wh1"})()
    body = shell_alerts.Alerts(s).body({"query": "SELECT 1", "column": "c", "operator": "EQUAL", "threshold": 1.0}, meta, "s", "d", [PERSON],
                                       "0 0 8 ? * MON", True)
    assert body["display_name"] == "a-b (abc123)" and body["schedule"]["pause_status"] == "PAUSED"


def test_every_customer_facing_alert_text_is_plain(tmp_path):
    texts = [shell_alerts.USER_REASON, shell_alerts.UNREACHABLE] + [label for _cron, label in shell_alerts.SCHEDULES.values()]
    texts += list(shell_alerts.WORDS.values())
    for text in texts:
        assert "\u2014" not in text and "\u2013" not in text, text


def _settings_inspire(agent_ns, outputs):
    inst = build_inspire(agent_ns)
    inst._implement_builder = lambda: "builder@example.com"
    inst._implement_mvp_dirs = lambda uc, key: {"use_case": "/W/acme/session_5150/sales/N01-U01", "mvp": "/W/acme/session_5150/sales/N01-U01/mvp",
                                                 "version": f"/W/acme/session_5150/sales/N01-U01/mvp/v{key[2]}"}
    context = {"uc_id": "N01-U01", "key": (5150, "N01-U01", 3), "use_case": {"Name": "Predict churn"}, "job_id": 77, "spec": {"outputs": outputs}, "urls": {},
               "app_host": {"name": "churn-desk-ab12", "merged": False}}
    core = type("Core", (), {"SETTINGS_VERSION": 2})
    return inst._implement_app_settings(context, {"shell_core": core}, {"id": "n01_u01"}, None, "off", outputs)


def test_the_alerts_setting_is_off_by_default_and_when_on_names_the_apps_alerts_folder(agent_ns):
    assert agent_ns["IMPLEMENT_APP_OPTIONS"]["alerts"] is False and "alerts" in agent_ns["IMPLEMENT_APP_USER_OFF"]
    assert tuple(agent_ns["IMPLEMENT_APP_OPTIONS"]) == shell_core.OPTIONS and agent_ns["IMPLEMENT_APP_USER_OFF"] == shell_core.USER_OFF
    assert agent_ns["IMPLEMENT_APP_SETTINGS_FILE"] == shell_core.SETTINGS_FILE
    assert agent_ns["implement_app_file_settings"]({"inspire_app.json": "not json"}) == {}
    assert agent_ns["implement_app_file_settings"]({"inspire_app.json": "[1]"}) == {}
    off = _settings_inspire(agent_ns, {"app_access": "sp", "app_name": "churn-desk"})
    assert off["options"]["alerts"] is False and "alert_folder" not in off
    on = _settings_inspire(agent_ns, {"app_access": "sp", "app_name": "churn-desk", "app_options": {"alerts": True}})
    assert on["options"]["alerts"] is True and on["alert_folder"] == "/W/acme/session_5150/sales/N01-U01/mvp/alerts/churn-desk-ab12", \
        "the alerts people set up stay in one folder across every version of the MVP"
    assert shell_core.settings_problems(dict(on, pages=[PAGE["id"]], jobs={}), [PAGE]) == [], "the App accepts what the agent writes"
    user = _settings_inspire(agent_ns, {"app_access": "user", "app_name": "churn-desk", "app_options": {"alerts": True}})
    assert user["options"]["alerts"] is False and "alert_folder" not in user, "per-user Apps send no alerts"
    assert agent_ns["implement_app_sends_alerts"](on) == on["alert_folder"] and agent_ns["implement_app_sends_alerts"](off) == ""
    assert agent_ns["implement_app_sends_alerts"](dict(on, options=dict(on["options"], alerts=False))) == ""
    for odd in (dict(on, options=["alerts"]), dict(on, options=dict(on["options"], alerts="yes")), None, "settings"):
        assert agent_ns["implement_app_sends_alerts"](odd) == "", odd


def test_the_build_creates_the_alerts_folder_and_gives_the_app_service_principal_can_manage(agent_ns, sdk_stub):
    inst, context, calls, _imported = _deploy_inspire(agent_ns, [
        RuntimeError("RESOURCE_DOES_NOT_EXIST: app churn-desk"),
        {"compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-1"},
        {"object_id": 4242}, {"deployment_id": "dep1", "status": {"state": "SUCCEEDED"}}, {"url": "https://churn-desk.example/"}])
    made = []
    inst.w_client.workspace.mkdirs = made.append
    folder = "/W/acme_implemented/Sales/alerts/churn-desk"
    files = dict(SHELL_FILES, **{"inspire_app.json": json.dumps({"options": {"alerts": True}, "alert_folder": folder})})
    fields = inst._implement_deploy_app(context, "churn-desk", files, READS, "g1", poll_s=0)
    assert "_warnings" not in fields, fields
    assert folder in made and ("GET", "/api/2.0/workspace/get-status", None) in calls
    assert ("directories", 4242, [{"type": "service_principal", "name": "sp-1"}], "CAN_MANAGE") in inst.genie_grants
    assert calls.index(("GET", "/api/2.0/workspace/get-status", None)) < calls.index(
        ("POST", "/api/2.0/apps/churn-desk/deployments", {"source_code_path": "/W/acme_implemented/Sales/apps/churn-desk", "mode": "SNAPSHOT"}))
    inst, context, _calls, _i = _deploy_inspire(agent_ns, [
        RuntimeError("RESOURCE_DOES_NOT_EXIST: app churn-desk"),
        {"compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-1"},
        RuntimeError("PERMISSION_DENIED: folder"), {"deployment_id": "dep1", "status": {"state": "SUCCEEDED"}}, {"url": "https://churn-desk.example/"}])
    fields = inst._implement_deploy_app(context, "churn-desk", files, READS, "g1", poll_s=0)
    assert fields["_warnings"] == [f"App: people cannot set up alerts in it yet, because Inspire could not give its service principal CAN "
                                   f"MANAGE on the alerts folder {folder}: PERMISSION_DENIED: folder. Give it CAN MANAGE on that folder, or "
                                   "build the App again with Vibe/Add/Remove Features on the Build page"]


def test_turning_alerts_off_pauses_the_alerts_people_set_up(agent_ns, sdk_stub):
    folder = "/W/acme_implemented/Sales/alerts/churn-desk"
    inst, context, calls, _imported = _deploy_inspire(agent_ns, [
        {"compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-1", "description": "Inspire use case N01-U01 (session 5150): x"},
        {"deployment_id": "dep1", "status": {"state": "SUCCEEDED"}}, {"url": "https://churn-desk.example/"},
        {"objects": [{"object_type": "ALERT", "object_id": 11}, {"object_type": "ALERT", "object_id": 12},
                     {"object_type": "ALERT", "object_id": 13}, {"object_type": "NOTEBOOK", "object_id": 14}]},
        {"id": "11", "schedule": {"quartz_cron_schedule": "0 0 8 * * ?", "timezone_id": "UTC", "pause_status": "UNPAUSED"}},
        {"id": "11"},
        {"id": "12", "schedule": {"pause_status": "PAUSED"}},
        {"id": "13", "lifecycle_state": "DELETED", "schedule": {"pause_status": "UNPAUSED"}}])
    inst._implement_app_before = lambda *a, **k: None
    inst._implement_owns_app = lambda uc, app: True
    context["app_host"] = {"name": "churn-desk", "merged": False, "settings": {"options": {"alerts": True}, "alert_folder": folder}}
    fields = inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, "", poll_s=0)
    assert fields["_notes"] == ["App: alerts are off now, so Inspire paused the 1 alert people set up in it; turn alerts on again "
                                "to resume it"]
    assert "_warnings" not in fields, "pausing the alerts of an App whose alerts were turned off is a fact, not a warning"
    assert ("PATCH", "/api/2.0/alerts/11", {"schedule": {"quartz_cron_schedule": "0 0 8 * * ?", "timezone_id": "UTC",
                                                         "pause_status": "PAUSED"}}) in calls
    assert not [c for c in calls if c[0] == "PATCH" and c[1] != "/api/2.0/alerts/11"], "paused or deleted alerts are left alone"


def test_a_build_time_alert_the_api_reports_deleted_is_made_again_without_patching_it(agent_ns, tmp_path):
    inst, calls, _q = _alert_inspire(agent_ns, tmp_path, {("GET", "/api/2.0/alerts/al-1"): {"id": "al-1", "lifecycle_state": "DELETED"},
                                                         ("POST", "/api/2.0/alerts"): {"id": "al-2"}})
    fields = inst._implement_alert(dict(_output_context(agent_ns, **ALERT), assets={"alert": "al-1"}), None)
    assert fields["alert_id"] == "al-2" and _calls_to(calls, "PATCH", "/api/2.0/alerts/al-1") == []
    trashed = RuntimeError("INVALID_PARAMETER_VALUE: Cannot rename an asset that is in the trash. Restore the asset first and then rename it.")
    inst, calls, _q = _alert_inspire(agent_ns, tmp_path, {("PATCH", "/api/2.0/alerts/al-1"): trashed, ("POST", "/api/2.0/alerts"): {"id": "al-3"}})
    assert inst._implement_alert(dict(_output_context(agent_ns, **ALERT), assets={"alert": "al-1"}), None)["alert_id"] == "al-3"
    assert agent_ns["implement_alert_gone"]({"lifecycle_state": "trashed"}) and not agent_ns["implement_alert_gone"]({})
