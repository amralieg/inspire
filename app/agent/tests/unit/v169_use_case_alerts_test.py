import copy
import io
import json
import os
import subprocess
import sys

import pytest

from v148_app_hub_test import PERSON, ROWS, hub_page
from v149_app_alerts_test import FOLDER, LEE, ME, SAM, WATCH, alerts_shell, save
from v141_app_shell_test import call

import shell_alerts
import shell_sql

TABLE = "main.pricing.loss_desk_out"
SERVER = os.path.dirname(shell_alerts.__file__)
HOST = "https://dbc-1.example.com"
TYPES = {"record_key": "STRING", "entity_id": "STRING", "entity_label": "STRING", "priority_tier": "STRING", "rank": "INT",
         "category": "STRING", "value_at_stake": "DOUBLE", "units": "LONG", "confidence_level": "DOUBLE", "held_back": "BOOLEAN",
         "use_case_id": "STRING", "run_id": "STRING", "as_of_date": "DATE", "valid_from": "TIMESTAMP", "valid_to": "TIMESTAMP",
         "is_current": "BOOLEAN", "change_source": "STRING", "changed_by": "STRING"}


def manifest(types=None):
    return {"schema": {"columns": [{"name": name, "type_name": kind, "type_text": kind} for name, kind in (types or TYPES).items()]}}


def step(op, args, v=shell_alerts.CLI_VERSION):
    out = io.StringIO()
    assert shell_alerts.cli(io.StringIO(json.dumps({"v": v, "op": op, "args": args})), out) == 0
    return json.loads(out.getvalue())


def ok(op, args):
    got = step(op, args)
    assert got["ok"] is True, got
    return got["result"]


def refused(op, args):
    got = step(op, args)
    assert got["ok"] is False, got
    return got["status"], got["error"]


def made_page(**changes):
    args = dict({"table": TABLE, "manifest": manifest(), "page_id": "n01_u05", "title": "Price-loss desk", "segments": ["category"]}, **changes)
    return ok("page", args)


def test_an_alert_page_for_a_use_case_with_no_app_reads_only_the_latest_run_and_offers_tiers_segments_and_numeric_totals():
    page = made_page(segments=["category", "category", "entity_label", "ghost", "value_at_stake"])
    assert page["datasets"] == [{"name": "records", "sql": f"SELECT * FROM `main`.`pricing`.`loss_desk_out` WHERE {shell_sql.CURRENT_ROWS}"}]
    assert [f["id"] for f in page["filters"]] == ["tier", "segment_category", "segment_entity_label"], \
        "the tier and each named text segment the table has, once each; a numeric or missing column is no segment"
    assert page["filters"][0] == {"id": "tier", "type": "multi_select", "label": "Tier", "columns": {"records": "priority_tier"}}
    assert [k["expression"] for k in page["kpis"]] == ["SUM(`value_at_stake`)", "SUM(`units`)"], \
        "business numbers only: no rank, no AI score, no history or holdout column"
    assert page["kpis"][0]["label"] == "Total value at stake" and page["result_table"] == TABLE
    measures = [m["id"] for m in shell_sql.watch_measures(page)]
    assert measures == ["records", "total_value_at_stake", "total_units"]
    query = shell_sql.watch_query(page, {"what": "records", "filters": {"tier": ["Act now"]}, "operator": ">=", "threshold": 1, "basis": "fixed"})
    assert "WHERE is_current AND change_source <> 'delete') AS d WHERE CAST(`priority_tier` AS STRING) IN ('Act now')" in query["query"], \
        "rows to act on by tier, counted on the latest run only"


def test_an_alert_page_is_refused_for_a_name_that_is_not_a_table():
    status, error = refused("page", {"table": "not a table", "manifest": manifest(), "page_id": "p"})
    assert status == 400 and "is not a catalog.schema.table name" in error


def stored(ws, planned):
    body = copy.deepcopy(planned["body"])
    ws.next_id += 1
    alert = dict(body, id=str(ws.next_id), lifecycle_state="ACTIVE", owner_user_name=PERSON)
    ws.alerts[alert["id"]] = alert
    return alert


def save_args(page, **data):
    return {"page": page, "data": dict({"name": "Act now grows", "watch": dict(WATCH, filters={}), "schedule": "daily", "emails": [PERSON]}, **data),
            "person": PERSON, "admin": False, "alerts": [], "warehouse": "wh1", "link": "", "folder": FOLDER, "manifest": manifest()}


def test_the_inspire_app_plans_the_same_alert_body_the_app_shell_saves(tmp_path, monkeypatch):
    monkeypatch.setattr(shell_alerts.uuid, "uuid4", lambda: type("U", (), {"hex": "abc123def"})())
    s, ws = alerts_shell(tmp_path)
    assert save(s, emails=[PERSON, SAM])[0] == 200
    [shell_body] = ws.posted()
    planned = ok("save", dict(save_args(hub_page(), name="Category A grows", watch=WATCH, emails=[PERSON, SAM]),
                              link="https://loss-desk-1.example.com/?open=n01_u05"))
    assert (planned["method"], planned["path"], planned["params"]) == ("POST", "/api/2.0/alerts", {})
    assert planned["body"] == shell_body, "one builder: the body the Inspire App sends is the body the App shell sends"
    assert planned["meta"]["by"] == PERSON and planned["body"]["parent_path"] == FOLDER


def test_an_alert_the_inspire_app_made_as_the_person_is_listed_and_changed_in_the_hub_app_and_the_reverse(tmp_path):
    s, ws = alerts_shell(tmp_path)
    mine = stored(ws, ok("save", save_args(hub_page())))
    listed = call(s, "GET", "alerts", {"page": "n01_u05"}, headers=ME)[1]
    [row] = listed["alerts"]
    assert (row["id"], row["by"], row["can_change"], row["owner_user_name"]) == (mine["id"], PERSON, True, PERSON)
    assert row["rule"] == "Records on the list are at least 2" and row["scope"] == ""
    assert call(s, "POST", "alerts/pause", headers=ME, body={"id": mine["id"], "paused": True})[0] == 200
    assert call(s, "POST", "alerts/pause", headers={"x-forwarded-email": SAM}, body={"id": mine["id"], "paused": False})[0] == 403
    made_in_app = save(s, headers={"x-forwarded-email": SAM}, name="Sam watches", emails=[SAM])[1]["alert"]
    seen = ok("listing", {"page": hub_page(), "alerts": list(ws.alerts.values()), "person": PERSON, "admin": False, "host": HOST,
                         "manifest": manifest()})["listing"]
    by = {a["id"]: a for a in seen["alerts"]}
    assert set(by) == {mine["id"], made_in_app["id"]}, "one list: what either side made in the folder"
    assert (by[made_in_app["id"]]["by"], by[made_in_app["id"]]["can_change"], by[made_in_app["id"]]["emails"]) == (SAM, False, [])
    assert by[mine["id"]]["state"] == "paused" and seen["caps"] == {"app": 20, "person": 10, "used": 2, "mine": 1}


def test_the_listing_keeps_this_pages_live_alerts_and_hands_over_the_segment_queries():
    page = made_page()
    alive = ok("save", save_args(page, watch={"what": "records", "filters": {"tier": ["Act now", "Review"]}, "operator": ">", "threshold": 3,
                                             "basis": "fixed"}))
    other = ok("save", save_args(dict(page, id="other_page")))
    gone = ok("save", save_args(page, name="Gone"))
    alerts = [dict(alive["body"], id="1", evaluation=dict(alive["body"]["evaluation"], state="TRIGGERED", last_evaluated_at="2026-10-31T08:00:00Z")),
              dict(other["body"], id="2"), dict(gone["body"], id="3", lifecycle_state="TRASHED"),
              {"id": "4", "query_text": "SELECT 1", "display_name": "made in Databricks"}, "not an alert"]
    out = ok("listing", {"page": page, "alerts": alerts, "person": LEE, "admin": False, "host": HOST, "built": "", "unread": 1,
                         "manifest": manifest()})
    listing = out["listing"]
    [row] = listing["alerts"]
    assert (row["id"], row["state"], row["checked"], row["can_change"], row["emails"]) == ("1", "triggered", "2026-10-31T08:00:00Z", False, [])
    assert row["rule"] == "Records on the list are more than 3" and row["scope"] == "Tier: Act now, Review"
    assert row["url"] == f"{HOST}/sql/alerts-v2/1" and listing["unread"] == 1
    assert listing["caps"]["used"] == 2, "an App counts every alert in its folder, on every page"
    records = next(m for m in listing["measures"] if m["id"] == "records")
    assert (records["min"], records["whole"], records["filters"], records["baseline"]) == (0, True, ["tier", "segment_category"], True)
    total = next(m for m in listing["measures"] if m["id"] == "total_value_at_stake")
    assert (total["min"], total["whole"]) == (None, False)
    assert listing["operator_words"][">="] == "is at least"
    assert [f["id"] for f in out["filters"]] == ["tier", "segment_category"]
    assert out["filters"][0]["sql"].startswith("SELECT v FROM (SELECT DISTINCT CAST(`priority_tier` AS STRING) AS v FROM (SELECT * FROM")
    assert "LIMIT" in out["filters"][0]["sql"] and out["filters"][0]["params"] == []


def test_a_count_threshold_must_be_a_whole_number_of_zero_or_more_and_a_total_may_be_any_number(tmp_path):
    page = made_page()
    for threshold, needle in ((-1, "never below 0; set a threshold of 0 or more"), (1.5, "set a whole number as the threshold")):
        status, error = refused("save", save_args(page, watch=dict(WATCH, filters={}, threshold=threshold)))
        assert status == 400 and error.startswith("Records on the list counts rows") and needle in error, error
        assert refused("query", {"page": page, "watch": dict(WATCH, filters={}, threshold=threshold)})[0] == 400
    assert ok("save", save_args(page, watch={"what": "total_value_at_stake", "filters": {}, "operator": "<", "threshold": -250.5,
                                             "basis": "fixed"}))["body"]["evaluation"]["threshold"] == {"value": {"double_value": -250.5}}
    s, ws = alerts_shell(tmp_path)
    status, out = save(s, watch=dict(WATCH, threshold=-3))
    assert status == 400 and "never below 0" in out["error"] and ws.posted() == [], "the hub App applies the same rule"


def test_an_edit_keeps_the_creator_and_token_and_only_the_creator_or_an_admin_may_change_pause_or_delete():
    page = made_page()
    first = ok("save", save_args(page))
    alert = dict(first["body"], id="77")
    edit = ok("save", dict(save_args(page, id="77", name="Renamed", watch=dict(WATCH, filters={}, threshold=5), schedule="weekly"),
                           alerts=[alert], person=PERSON))
    assert (edit["method"], edit["path"], edit["params"]) == ("PATCH", "/api/2.0/alerts/77", {"update_mask": ",".join(shell_alerts.FIELDS)})
    assert "parent_path" not in edit["body"] and edit["meta"]["token"] == first["meta"]["token"] and edit["meta"]["by"] == PERSON
    assert edit["body"]["schedule"]["quartz_cron_schedule"] == "0 0 8 ? * MON"
    for op, args in (("save", dict(save_args(page, id="77"), alerts=[alert], person=SAM)), ("pause", {"alerts": [alert], "id": "77", "paused": True,
                                                                                                         "person": SAM}),
                     ("delete", {"alerts": [alert], "id": "77", "person": SAM})):
        status, error = refused(op, args)
        assert status == 403 and "only the person who set up this alert" in error, (op, error)
    paused = ok("pause", {"alerts": [alert], "id": "77", "paused": True, "person": SAM, "admin": True})
    assert paused == {"id": "77", "meta": first["meta"], "method": "PATCH", "path": "/api/2.0/alerts/77", "params": {"update_mask": "schedule"},
                      "body": {"schedule": dict(alert["schedule"], pause_status="PAUSED")}}
    assert ok("delete", {"alerts": [alert], "id": "77", "person": PERSON}) == {"id": "77", "method": "DELETE", "path": "/api/2.0/alerts/77",
                                                                              "params": {}, "body": None}
    assert refused("pause", {"alerts": [alert], "id": "77", "paused": "yes", "person": PERSON}) == (400, "paused takes true or false")
    assert refused("delete", {"alerts": [alert], "id": "55", "person": PERSON})[0] == 404


def test_the_caps_and_recipients_are_checked_before_anything_is_saved():
    page = made_page()
    mine = [dict(ok("save", save_args(page, name=f"Mine {i}"))["body"], id=str(i)) for i in range(10)]
    status, error = refused("save", dict(save_args(page), alerts=mine))
    assert status == 409 and "you already set up 10 alerts" in error
    for emails, needle in (([], "add at least one email address"), (["nope"], "'nope' is not an email address"),
                           ([f"p{i}@example.com" for i in range(21)], "at most 20 people")):
        status, error = refused("save", save_args(page, emails=emails))
        assert status == 400 and needle in error, (emails, error)
    assert ok("save", save_args(page, emails=[PERSON, PERSON.upper(), SAM]))["body"]["evaluation"]["notification"]["subscriptions"] == [
        {"user_email": PERSON}, {"user_email": SAM}]
    assert refused("save", dict(save_args(page), warehouse=""))[0] == 500
    assert refused("save", dict(save_args(page), folder="relative/folder")) == (500, "the alerts folder must be a workspace folder path, not "
                                                                                     "'relative/folder'")
    assert refused("save", dict(save_args(page), person=""))[0] == 401


def test_a_blank_name_is_named_after_its_rule_only_when_the_inspire_app_asks_and_the_app_shell_still_refuses_it(tmp_path):
    page = made_page()
    named = ok("save", dict(save_args(page, name="  "), name_from_rule=True))
    assert named["meta"]["name"] == "Records on the list are at least 2"
    assert named["body"]["display_name"] == f"Records on the list are at least 2 ({named['meta']['token']})"
    assert refused("save", save_args(page, name="")) == (400, "name the alert in 1 to 100 characters")
    s, ws = alerts_shell(tmp_path)
    status, out = save(s, name="")
    assert status == 400 and out["error"] == "name the alert in 1 to 100 characters" and ws.posted() == []


def test_the_preview_reads_the_statement_result_the_inspire_app_ran():
    result = {"manifest": {"schema": {"columns": [{"name": "watched_value", "type_name": "LONG", "type_text": "BIGINT"}]}},
              "result": {"data_array": [["7"]]}}
    assert ok("preview", {"watch": WATCH, "result": result}) == dict(shell_sql.compare_words(), value=7, fires=True, threshold=2.0,
                                                                     basis="fixed", history_runs=None)
    assert ok("preview", {"watch": dict(WATCH, threshold=9), "result": result})["fires"] is False
    assert ok("preview", {"watch": WATCH, "result": {}})["value"] is None


def test_the_alert_steps_answer_every_bad_request_with_a_status_and_a_message():
    assert refused("page", {})[0] == 400
    assert step("listing", {}, v=99) == {"ok": False, "status": 400, "error": "send an alert step of version 1"}
    status, error = refused("drop", {})
    assert status == 400 and "there is no alert step 'drop'" in error
    out = io.StringIO()
    shell_alerts.cli(io.StringIO(json.dumps({"v": 1, "op": "listing", "args": []})), out)
    assert json.loads(out.getvalue()) == {"ok": False, "status": 400, "error": "send the alert step's arguments as an object"}
    out = io.StringIO()
    shell_alerts.cli(io.StringIO("not json"), out)
    assert json.loads(out.getvalue())["ok"] is False


def test_the_alert_steps_run_as_a_plain_python_process_from_the_shell_files_with_no_web_server_and_no_token(tmp_path):
    for name in ("shell_alerts.py", "shell_sql.py", "shell_facts.py", "shell_db.py", "shell_redact.py"):
        (tmp_path / name).write_text(open(os.path.join(SERVER, name), encoding="utf-8").read(), encoding="utf-8")
    request = json.dumps({"v": 1, "op": "page", "args": {"table": TABLE, "manifest": manifest(), "page_id": "n01_u05"}})
    done = subprocess.run([sys.executable, "-B", "-E", "-s", "-c", "import sys; sys.path.insert(0, sys.argv[1]); import shell_alerts; "
                           "sys.exit(shell_alerts.cli())", str(tmp_path)], input=request, capture_output=True, text=True, cwd="/",
                          env={"PATH": os.environ.get("PATH", ""), "LANG": "C.UTF-8"}, timeout=60)
    assert done.returncode == 0, done.stderr
    assert json.loads(done.stdout)["result"]["id"] == "n01_u05"
    assert sorted(p.name for p in tmp_path.iterdir()) == ["shell_alerts.py", "shell_db.py", "shell_facts.py", "shell_redact.py", "shell_sql.py"], \
        "no bytecode left behind"


def test_the_hub_app_rows_now_say_the_rule_and_who_owns_the_alert_in_databricks(tmp_path):
    s, ws = alerts_shell(tmp_path, rows=ROWS)
    assert save(s)[0] == 200
    [row] = call(s, "GET", "alerts", {"page": "n01_u05"}, headers=ME)[1]["alerts"]
    assert row["rule"] == "Records on the list are at least 2" and row["scope"] == "Category: A" and row["owner_user_name"] == "app-sp"
    assert ws.posted()[0]["evaluation"]["notification"]["subscriptions"] == [{"user_email": PERSON}]
