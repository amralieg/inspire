"""Plan and Forecast modes: plan versions with reasons, line overrides recorded on a version, plan vs actuals, the forecast review
queue with overrides read against the model, accuracy and override lift, and the _plans table the notebook builds and grants."""
import copy
import json
import os
import re
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_db  # noqa: E402
import shell_facts  # noqa: E402
import shell_sql  # noqa: E402
from v141_app_shell_test import SETTINGS, call  # noqa: E402
from v144_app_data_test import DECIDE, EDITOR, DataWorkspace, shell  # noqa: E402
from v198_kind_layouts_test import PLANNER, forecast  # noqa: E402

BOSS = "@".join(["boss", "example.com"])
INJECTION = "x'); DROP TABLE main.supply.production_out; --"
CELL = re.compile(r":p\d+|CAST\(NULL AS [A-Z]+\)|current_timestamp\(\)")


def plan_row(plan_id, entry, status, at, reason="", line_key=None, value=None, recommended=None, period=None, by=None):
    return {"plan_id": plan_id, "entry": entry, "status": status, "changed_at": at, "reason": reason, "line_key": line_key,
            "value": value, "recommended": recommended, "period": period, "changed_by": by or EDITOR["x-forwarded-email"]}


PID1, PID2 = "a" * 32, "b" * 32


class PlanWorkspace(DataWorkspace):
    def __init__(self, plans=None, series=None, point=None, accuracy=None, lift=None, lines=None, constraints=None, missing=False,
                 refuse=False, **kw):
        super().__init__(**kw)
        self.plans, self.series, self.point = list(plans or []), series or [], point
        self.accuracy, self.lift, self.lines, self.constraints = accuracy, lift, lines or [], constraints or []
        self.missing, self.refuse, self.tick = missing, refuse, 0

    def inserted_plans(self):
        return [(sql, params) for sql, params, _limit in self.sql if sql.startswith("INSERT INTO") and "_plans" in sql]

    def answer(self, sql, params):
        if "_plans" in sql and self.missing:
            raise shell_db.QueryError("[TABLE_OR_VIEW_NOT_FOUND] The table or view cannot be found")
        if sql.startswith("INSERT INTO") and "_plans" in sql:
            if self.refuse:
                raise shell_db.QueryError("PERMISSION_DENIED: User does not have MODIFY on Table")
            values = {p["name"]: p["value"] for p in params}
            cells = CELL.findall(sql.split(" VALUES (", 1)[1])
            names = ("use_case_id",) + shell_sql.PLAN_COLUMNS
            row = {n: (values[c[1:]] if c.startswith(":") else None) for n, c in zip(names, cells)}
            for n in ("value", "recommended"):
                row[n] = None if row[n] is None else float(row[n])
            self.tick += 1
            row["changed_at"] = f"2026-11-08 10:00:{self.tick:02d}"
            self.plans.append(row)
            return {"columns": [], "rows": [], "truncated": False}
        if sql.startswith("SELECT `plan_id`"):
            return {"columns": [], "rows": sorted(self.plans, key=lambda r: r["changed_at"], reverse=True), "truncated": False}
        for marker, rows in (("WITH o AS", lambda: [self.lift] if self.lift else []), ("__constraints", lambda: self.constraints),
                             ("WITH g AS", lambda: self.series), ("SELECT s.`forecast` FROM", lambda: self.point or []),
                             ("AS `abs_error`", lambda: [self.accuracy] if self.accuracy else []),
                             ("AS d LIMIT 2000", lambda: self.lines)):
            if marker in sql:
                return {"columns": [], "rows": rows(), "truncated": False}
        return super().answer(sql, params)


def planner_shell(tmp_path, settings=DECIDE, ws=None):
    return shell(tmp_path, settings=settings, pages=[dict(copy.deepcopy(PLANNER), id="n01_u05")], ws=ws or PlanWorkspace())


def forecast_shell(tmp_path, settings=DECIDE, ws=None):
    return shell(tmp_path, settings=settings, pages=[forecast(id="n01_u05")], ws=ws or PlanWorkspace())


def move(s, action, plan_id=None, seen=None, reason=None, headers=None):
    body = {"page": "n01_u05", "action": action}
    body.update({k: v for k, v in (("plan_id", plan_id), ("seen", seen), ("reason", reason)) if v is not None})
    return call(s, "POST", "plans/version", headers=EDITOR if headers is None else headers, body=body)


def test_plan_moves_follow_draft_review_approved_published_and_refuse_every_other_step():
    assert [shell_sql.plan_next_status(*m) for m in (("Draft", "submit"), ("Draft", "approve"), ("In review", "approve"),
                                                      ("In review", "reopen"), ("Approved", "reopen"), ("Approved", "publish"))] == [
        "In review", "Approved", "Approved", "Draft", "Draft", "Published"]
    for current, action in (("Draft", "publish"), ("Published", "reopen"), ("Published", "approve"), ("In review", "submit"),
                            ("Approved", "approve")):
        with pytest.raises(ValueError, match="cannot"):
            shell_sql.plan_next_status(current, action)
    with pytest.raises(ValueError, match="not 'delete'"):
        shell_sql.plan_next_status("Draft", "delete")


def test_plan_reasons_are_required_where_it_matters_capped_and_collapsed():
    assert shell_sql.plan_reason("  Supplier \n is  short ", True, "x") == "Supplier is short"
    assert shell_sql.plan_reason(None, False, "x") == ""
    with pytest.raises(ValueError, match="say why: an approval needs a reason"):
        shell_sql.plan_reason("   ", True, "an approval")
    with pytest.raises(ValueError, match="at most 500 characters"):
        shell_sql.plan_reason("r" * 501, False, "x")
    assert len(shell_sql.plan_reason("r" * 500, True, "x")) == 500
    with pytest.raises(ValueError, match="the reason is text"):
        shell_sql.plan_reason(["a"], True, "x")


def test_plan_versions_fold_the_event_rows_newest_first_with_the_latest_line_decision_winning():
    rows = [plan_row(PID1, "status", "Draft", "2026-11-01 09:00:00"),
            plan_row(PID1, "line", "override", "2026-11-01 09:05:00", "Line down", line_key="K1", value=50.0, recommended=80.0),
            plan_row(PID1, "line", "accept", "2026-11-01 09:06:00", line_key="K2", value=70.0, recommended=70.0),
            plan_row(PID1, "status", "Approved", "2026-11-01 10:00:00", "Fits the limits"),
            plan_row(PID2, "status", "Draft", "2026-11-02 09:00:00"),
            plan_row(PID2, "line", "override", "2026-11-02 09:01:00", "First", line_key="K1", value=10.0, recommended=80.0),
            plan_row(PID2, "line", "accept", "2026-11-02 09:02:00", line_key="K1", value=80.0, recommended=80.0),
            plan_row("not-a-plan", "status", "Published", "2026-11-03 09:00:00")]
    newest, oldest = shell_sql.plan_versions(rows)
    assert (newest["label"], newest["status"], newest["editable"], newest["overrides"], newest["lines_decided"]) == ("Version 2", "Draft", True, [], 1)
    assert newest["lines"]["K1"]["decision"] == "accept"
    assert (oldest["label"], oldest["status"], oldest["editable"]) == ("Version 1", "Approved", False)
    assert [(o["line_key"], o["value"], o["reason"]) for o in oldest["overrides"]] == [("K1", 50.0, "Line down")]
    assert [h["status"] for h in oldest["history"]] == ["Draft", "Approved"] and oldest["history"][-1]["reason"] == "Fits the limits"
    with pytest.raises(KeyError, match="no plan version"):
        shell_sql.plan_version([newest, oldest], "c" * 32)


def test_a_plan_entry_keeps_every_value_in_a_parameter_and_refuses_a_bad_plan_id():
    sql, params = shell_sql.plan_entry_write(dict(PLANNER), PID1, "line", "override", EDITOR["x-forwarded-email"], INJECTION,
                                             line_key=INJECTION, value=5, recommended=7)
    assert INJECTION not in sql and "DROP" not in sql and sql.startswith("INSERT INTO `main`.`supply`.`production_out_plans`")
    assert [p["value"] for p in params].count(INJECTION) == 2 and {"5.0", "7.0"} <= {p["value"] for p in params}
    for bad in ("", "A" * 32, "a" * 31, f"{'a' * 31}'"):
        with pytest.raises(ValueError, match="plan_id"):
            shell_sql.plan_entry_write(dict(PLANNER), bad, "status", "Draft", "e", "")
    with pytest.raises(ValueError, match="entry is status or line"):
        shell_sql.plan_entry_write(dict(PLANNER), PID1, "drop", "Draft", "e", "")


def test_a_plan_version_moves_from_draft_to_published_each_step_recorded_with_its_reason(tmp_path, capsys):
    s, ws, _made = planner_shell(tmp_path)
    status, out = move(s, "new")
    assert status == 200, out
    (version,) = out["versions"]
    assert (version["label"], version["status"], out["contract"], out["can_approve"]) == ("Version 1", "Draft", "plan", True)
    assert "lines" not in version
    status, out = move(s, "new")
    assert status == 409 and "Version 1 is still Draft" in out["error"]
    status, out = move(s, "submit", version["plan_id"], "Draft")
    assert status == 200 and out["versions"][0]["status"] == "In review"
    status, out = move(s, "approve", version["plan_id"], "In review", "Fits the line limits")
    assert status == 200 and out["versions"][0]["status"] == "Approved"
    status, out = move(s, "publish", version["plan_id"], "Approved", "Sent to the plant")
    assert status == 200 and out["versions"][0]["status"] == "Published" and out["versions"][0]["editable"] is False
    assert [(r["entry"], r["status"], r["reason"]) for r in ws.plans] == [
        ("status", "Draft", ""), ("status", "In review", ""), ("status", "Approved", "Fits the line limits"),
        ("status", "Published", "Sent to the plant")]
    assert {r["use_case_id"] for r in ws.plans} == {PLANNER["use_case_id"]}
    assert capsys.readouterr().out.count("[PLAN-VERSION FIRED]") == 4
    status, out = move(s, "new")
    assert status == 200 and [v["label"] for v in out["versions"]] == ["Version 2", "Version 1"]


@pytest.mark.parametrize("action, seen, reason, code, fragment", [
    ("approve", "Draft", None, 400, "an approval or sign-off needs a reason"),
    ("approve", "Draft", "   ", 400, "needs a reason"),
    ("publish", "Draft", "x" * 501, 400, "at most 500 characters"),
    ("reopen", "Draft", None, 400, "reopening it needs a reason"),
    ("publish", "Draft", "Ready", 409, "cannot publish"),
    ("approve", "In review", "Ready", 409, "is Draft now, not In review"),
    ("archive", "Draft", "Ready", 400, "not 'archive'"),
])
def test_a_plan_move_without_its_reason_or_out_of_order_writes_nothing(tmp_path, action, seen, reason, code, fragment):
    ws = PlanWorkspace(plans=[plan_row(PID1, "status", "Draft", "2026-11-01 09:00:00")])
    s, ws, _made = planner_shell(tmp_path, ws=ws)
    status, out = move(s, action, PID1, seen, reason)
    assert status == code and fragment in out["error"], out
    assert ws.inserted_plans() == []


def test_an_older_version_cannot_be_reopened_while_a_newer_one_is_open(tmp_path):
    ws = PlanWorkspace(plans=[plan_row(PID1, "status", "Approved", "2026-11-01 09:00:00"), plan_row(PID2, "status", "Draft", "2026-11-02 09:00:00")])
    s, ws, _made = planner_shell(tmp_path, ws=ws)
    status, out = move(s, "reopen", PID1, "Approved", "Wrong numbers")
    assert status == 409 and "Version 2 is still Draft; finish it before you reopen Version 1" in out["error"]
    assert ws.inserted_plans() == []
    status, out = move(s, "publish", PID1, "Approved", "Ship the approved one")
    assert status == 200 and [v["status"] for v in out["versions"]] == ["Draft", "Published"]


def test_an_older_approved_version_is_published_while_the_newer_draft_stays_the_one_open(tmp_path):
    ws = PlanWorkspace(plans=[plan_row(PID1, "status", "Approved", "2026-11-01 09:00:00"), plan_row(PID2, "status", "Draft", "2026-11-02 09:00:00")])
    s, ws, _made = planner_shell(tmp_path, ws=ws)
    status, out = move(s, "publish", PID2, "Draft", "Not approved yet")
    assert status == 409 and "cannot publish" in out["error"] and ws.inserted_plans() == []
    status, out = move(s, "publish", PID1, "Approved", "Publish this cycle")
    assert status == 200, out
    assert [(v["plan_id"], v["status"], v["editable"]) for v in out["versions"]] == [(PID2, "Draft", True), (PID1, "Published", False)]
    (_sql, params), = ws.inserted_plans()
    assert {p["value"] for p in params} >= {PID1, "Published", "Publish this cycle"}
    status, out = move(s, "new", None, None)
    assert status == 409 and "Version 2 is still Draft" in out["error"]


def test_an_older_approved_version_cannot_be_published_over_a_newer_published_one(tmp_path):
    ws = PlanWorkspace(plans=[plan_row(PID1, "status", "Approved", "2026-11-01 09:00:00"), plan_row(PID2, "status", "Published", "2026-11-02 09:00:00")])
    s, ws, _made = planner_shell(tmp_path, ws=ws)
    status, out = move(s, "publish", PID1, "Approved", "Late publish")
    assert status == 409 and "Version 2 is already published and is newer than Version 1" in out["error"]
    assert ws.inserted_plans() == []


def test_an_injection_reason_is_saved_as_text_through_a_parameter(tmp_path):
    ws = PlanWorkspace(plans=[plan_row(PID1, "status", "Draft", "2026-11-01 09:00:00")])
    s, ws, _made = planner_shell(tmp_path, ws=ws)
    status, out = move(s, "approve", PID1, "Draft", INJECTION)
    assert status == 200, out
    (sql, params), = ws.inserted_plans()
    assert INJECTION not in sql and INJECTION in {p["value"] for p in params}
    assert out["versions"][0]["history"][-1]["reason"] == INJECTION


def test_only_the_use_case_owners_approve_or_publish_while_anyone_who_decides_may_submit(tmp_path):
    ws = PlanWorkspace(plans=[plan_row(PID1, "status", "Draft", "2026-11-01 09:00:00")])
    s, ws, _made = planner_shell(tmp_path, settings=dict(DECIDE, use_case_owners={"n01_u05": [BOSS]}), ws=ws)
    status, out = call(s, "GET", "plans", query={"page": "n01_u05"}, headers=EDITOR)
    assert status == 200 and out["can_decide"] is True and out["can_approve"] is False and "Only the owners" in out["approve_why"]
    status, out = move(s, "approve", PID1, "Draft", "Looks right")
    assert status == 403 and "Only the owners" in out["error"] and ws.inserted_plans() == []
    status, out = move(s, "submit", PID1, "Draft")
    assert status == 200 and out["versions"][0]["status"] == "In review"
    status, out = move(s, "approve", PID1, "In review", "Looks right", headers={"x-forwarded-email": BOSS})
    assert status == 200 and out["versions"][0]["status"] == "Approved"


def test_plan_routes_need_decisions_on_and_a_plan_or_forecast_page(tmp_path):
    s, ws, _made = planner_shell(tmp_path, settings=SETTINGS)
    status, out = move(s, "new")
    assert status == 403 and "record decisions" in out["error"] and ws.inserted_plans() == []
    status, out = call(s, "GET", "plans", query={"page": "n01_u05"}, headers=EDITOR)
    assert status == 200 and out["can_decide"] is False and out["why"]
    status, out = call(s, "GET", "forecast/review", query={"page": "n01_u05"}, headers=EDITOR)
    assert status == 404 and "no forecast" in out["error"]
    (tmp_path / "f").mkdir()
    s, _ws, _made = forecast_shell(tmp_path / "f")
    status, out = call(s, "GET", "plans/performance", query={"page": "n01_u05"}, headers=EDITOR)
    assert status == 404 and "no plan" in out["error"]


def test_a_missing_plans_table_says_rebuild_on_reads_and_refuses_writes(tmp_path):
    s, ws, _made = planner_shell(tmp_path, ws=PlanWorkspace(missing=True))
    status, out = call(s, "GET", "plans", query={"page": "n01_u05"}, headers=EDITOR)
    assert status == 200 and out["versions"] == [] and "production_out_plans" in out["missing"] and shell_sql.rebuild_action() in out["missing"]
    status, out = move(s, "new")
    assert status == 409 and "does not exist yet" in out["error"]


def test_a_refused_plans_write_names_the_table_and_the_grant(tmp_path):
    s, _ws, _made = planner_shell(tmp_path, ws=PlanWorkspace(refuse=True))
    status, out = move(s, "new")
    assert status == 403 and "production_out_plans" in out["error"] and "MODIFY" in out["error"]


def test_plan_decide_with_a_version_records_the_line_on_it_and_refuses_a_closed_or_unknown_version(tmp_path, capsys):
    ws = PlanWorkspace(plans=[plan_row(PID1, "status", "Draft", "2026-11-01 09:00:00"),
                              plan_row(PID2, "status", "Published", "2026-10-01 09:00:00")])
    s, ws, _made = planner_shell(tmp_path, ws=ws)
    body = {"page": "n01_u05", "record_key": "k1", "seen": "101", "decision": "override", "value": 90, "reason": "Line two is down",
            "recommended": 120}
    status, out = call(s, "POST", "plan/decide", headers=EDITOR, body=dict(body, plan_id=PID1))
    assert status == 200 and out["plan_id"] == PID1, out
    assert len(ws.queries("MERGE INTO")) == 1
    line = ws.plans[-1]
    assert (line["entry"], line["line_key"], line["status"], line["value"], line["recommended"], line["reason"]) == (
        "line", "k1", "override", 90.0, 120.0, "Line two is down")
    assert "[PLAN-LINE FIRED] page=n01_u05 version=Version 2 line=k1 decision=override" in capsys.readouterr().out
    for plan_id, code, fragment in ((PID2, 409, "Published"), ("c" * 32, 404, "no plan version")):
        before = len(ws.queries("MERGE INTO"))
        status, out = call(s, "POST", "plan/decide", headers=EDITOR, body=dict(body, plan_id=plan_id))
        assert status == code and fragment in out["error"]
        assert len(ws.queries("MERGE INTO")) == before
    status, out = call(s, "POST", "plan/decide", headers=EDITOR, body=dict(body, plan_id=PID1, reason=""))
    assert status == 400 and "needs a reason" in out["error"]


def test_plan_performance_compares_the_published_version_with_the_actuals_and_counts_value_realized(tmp_path):
    rows = [plan_row(PID1, "status", "Approved", "2026-11-01 09:00:00"),
            plan_row(PID1, "line", "override", "2026-11-01 09:01:00", "Short of steel", line_key="K2", value=40.0, recommended=60.0),
            plan_row(PID1, "status", "Published", "2026-11-01 10:00:00", "Sent"),
            plan_row(PID2, "status", "Approved", "2026-11-02 09:00:00", "Later draft")]
    lines = [{"record_key": "K1", "entity_label": "Line A", "current_value": 100.0, "recommended_value": 100.5, "objective_contribution": 30.0},
             {"record_key": "K2", "entity_label": "Line B", "current_value": 40.0, "recommended_value": 60.0, "objective_contribution": 20.0},
             {"record_key": "K3", "entity_label": "Line C", "current_value": 10.0, "recommended_value": 50.0, "objective_contribution": 5.0},
             {"record_key": "K4", "entity_label": "Line D", "current_value": None, "recommended_value": 5.0}]
    s, _ws, _made = planner_shell(tmp_path, ws=PlanWorkspace(plans=rows, lines=lines))
    status, out = call(s, "GET", "plans/performance", query={"page": "n01_u05"}, headers=EDITOR)
    assert status == 200, out
    assert out["version"]["plan_id"] == PID1 and out["version"]["status"] == "Published"
    assert (out["counted"], out["on_plan"], out["off_plan"], out["unknown"]) == (4, 2, 1, 1)
    assert out["value_planned"] == 55.0 and out["value_realized"] == 50.0
    first = out["lines"][0]
    assert (first["line_key"], first["state"], first["gap"], first["label"]) == ("K3", "off", -40.0, "Line C")
    k2 = next(l for l in out["lines"] if l["line_key"] == "K2")
    assert k2["overridden"] is True and k2["planned"] == 40.0 and k2["state"] == "on" and k2["reason"] == "Short of steel"


def test_plan_performance_says_no_plan_until_a_version_is_approved(tmp_path):
    s, ws, _made = planner_shell(tmp_path, ws=PlanWorkspace(plans=[plan_row(PID1, "status", "In review", "2026-11-01 09:00:00")]))
    status, out = call(s, "GET", "plans/performance", query={"page": "n01_u05"}, headers=EDITOR)
    assert status == 200 and out["version"] is None and out["lines"] == []
    assert ws.queries("AS d LIMIT 2000") == []


SERIES = [{"series_id": "S1", "mase": 1.6, "next_period": "2026-12", "forecast": 120.0, "lower": 100.0, "upper": 140.0},
          {"series_id": "S2", "mase": 0.7, "next_period": "2026-12", "forecast": 50.0, "lower": 40.0, "upper": 60.0}]


def test_the_forecast_review_lists_series_at_risk_first_with_the_open_cycle_overrides(tmp_path):
    rows = [plan_row(PID1, "status", "Draft", "2026-11-01 09:00:00"),
            plan_row(PID1, "line", "override", "2026-11-01 09:01:00", "Promo", line_key="S1", value=150.0, recommended=120.0, period="2026-12"),
            plan_row(PID1, "line", "override", "2026-11-01 09:02:00", "Old period", line_key="S2", value=1.0, recommended=50.0, period="2026-11")]
    s, _ws, _made = forecast_shell(tmp_path, ws=PlanWorkspace(plans=rows, series=SERIES))
    status, out = call(s, "GET", "forecast/review", query={"page": "n01_u05"}, headers=EDITOR)
    assert status == 200, out
    assert out["at_risk"] == 1 and out["cycle"]["plan_id"] == PID1 and "lines" not in out["cycle"]
    s1, s2 = out["series"]
    assert s1["at_risk"] is True and s1["override"]["value"] == 150.0 and s1["override"]["reason"] == "Promo"
    assert s2["at_risk"] is False and s2["override"] is None


def test_a_forecast_override_records_the_model_forecast_from_the_series_table_not_the_browser(tmp_path, capsys):
    ws = PlanWorkspace(plans=[plan_row(PID1, "status", "Draft", "2026-11-01 09:00:00")], series=SERIES, point=[{"forecast": 120.0}])
    s, ws, _made = forecast_shell(tmp_path, ws=ws)
    body = {"page": "n01_u05", "plan_id": PID1, "series_id": "S1", "period": "2026-12", "value": 150, "reason": "Promo week",
            "recommended": 999}
    status, out = call(s, "POST", "forecast/override", headers=EDITOR, body=body)
    assert status == 200, out
    line = ws.plans[-1]
    assert (line["line_key"], line["period"], line["value"], line["recommended"], line["reason"]) == ("S1", "2026-12", 150.0, 120.0, "Promo week")
    (point_sql, point_params), = ws.queries("SELECT s.`forecast` FROM")
    assert "S1" not in point_sql and {"S1", "2026-12"} <= {p["value"] for p in point_params}
    assert "[FORECAST-OVERRIDE FIRED] page=n01_u05 cycle=Version 1 series=S1 period=2026-12" in capsys.readouterr().out


@pytest.mark.parametrize("change, code, fragment", [
    ({"reason": ""}, 400, "needs a reason"),
    ({"reason": "r" * 501}, 400, "at most 500 characters"),
    ({"value": "lots"}, 400, "as a number"),
    ({"value": True}, 400, "as a number"),
    ({"value": 1e16}, 400, "as a number"),
    ({"series_id": ""}, 400, "series_id"),
    ({"series_id": "s" * 513}, 400, "series_id"),
    ({"period": "p" * 65}, 400, "period"),
    ({"plan_id": "c" * 32}, 404, "no plan version"),
])
def test_a_bad_forecast_override_writes_nothing(tmp_path, change, code, fragment):
    ws = PlanWorkspace(plans=[plan_row(PID1, "status", "Draft", "2026-11-01 09:00:00")], series=SERIES, point=[{"forecast": 120.0}])
    s, ws, _made = forecast_shell(tmp_path, ws=ws)
    body = dict({"page": "n01_u05", "plan_id": PID1, "series_id": "S1", "period": "2026-12", "value": 150, "reason": "Promo"}, **change)
    status, out = call(s, "POST", "forecast/override", headers=EDITOR, body=body)
    assert status == code and fragment in out["error"], out
    assert ws.inserted_plans() == []


def test_a_forecast_override_needs_an_open_cycle_and_a_known_future_point(tmp_path):
    ws = PlanWorkspace(plans=[plan_row(PID1, "status", "Approved", "2026-11-01 09:00:00")], series=SERIES, point=[{"forecast": 120.0}])
    s, ws, _made = forecast_shell(tmp_path, ws=ws)
    body = {"page": "n01_u05", "plan_id": PID1, "series_id": "S1", "period": "2026-12", "value": 150, "reason": "Promo"}
    status, out = call(s, "POST", "forecast/override", headers=EDITOR, body=body)
    assert status == 409 and "Approved" in out["error"] and ws.inserted_plans() == []
    (tmp_path / "gone").mkdir()
    ws = PlanWorkspace(plans=[plan_row(PID1, "status", "Draft", "2026-11-01 09:00:00")], series=SERIES, point=[])
    s, ws, _made = forecast_shell(tmp_path / "gone", ws=ws)
    status, out = call(s, "POST", "forecast/override", headers=EDITOR, body=body)
    assert status == 404 and "no future forecast" in out["error"] and ws.inserted_plans() == []


def test_forecast_accuracy_reports_error_bias_mase_and_the_lift_of_overrides_over_the_model(tmp_path):
    accuracy = {"n": 40, "abs_error": 100.0, "abs_actual": 1000.0, "signed_error": -50.0, "mase": 0.9, "series": 4}
    lift = {"n": 3, "model_error": 30.0, "people_error": 18.0, "helped": 2, "hurt": 1}
    s, ws, _made = forecast_shell(tmp_path, ws=PlanWorkspace(accuracy=accuracy, lift=lift))
    status, out = call(s, "GET", "forecast/accuracy", query={"page": "n01_u05"}, headers=EDITOR)
    assert status == 200, out
    assert out == {"points": 40, "series": 4, "error": 0.1, "bias": -0.05, "mase": 0.9, "overrides": 3, "helped": 2, "hurt": 1,
                   "lift": pytest.approx(0.4), "lift_note": ""}
    (lift_sql, lift_params), = ws.queries("WITH o AS")
    assert "ROW_NUMBER() OVER (PARTITION BY `line_key`, `period`" in lift_sql and lift_params[0]["value"] == "N02-U03"
    assert shell_sql.forecast_accuracy({"n": 5, "abs_error": 1, "abs_actual": 0}, {"n": 2, "model_error": 0})["error"] is None
    worse = shell_sql.forecast_accuracy({}, {"n": 1, "model_error": 10.0, "people_error": 15.0, "hurt": 1})
    assert worse["lift"] == pytest.approx(-0.5) and worse["points"] == 0


def test_forecast_accuracy_without_a_plans_table_still_shows_the_model_error(tmp_path):
    accuracy = {"n": 10, "abs_error": 5.0, "abs_actual": 50.0, "signed_error": 5.0, "mase": 1.2, "series": 1}
    s, _ws, _made = forecast_shell(tmp_path, ws=PlanWorkspace(accuracy=accuracy, missing=True))
    status, out = call(s, "GET", "forecast/accuracy", query={"page": "n01_u05"}, headers=EDITOR)
    assert status == 200 and out["error"] == 0.1 and out["lift"] is None and "demand_out_plans" in out["lift_note"]


def test_the_plans_table_is_a_companion_the_page_owns():
    assert shell_facts.PLANS_SUFFIX in shell_facts.COMPANION_SUFFIXES and shell_sql.PLANS_SUFFIX == shell_facts.PLANS_SUFFIX
    assert shell_sql.plans_table(dict(PLANNER)) == "`main`.`supply`.`production_out_plans`"


def test_the_notebook_creates_the_plans_table_with_the_columns_the_app_writes(agent_ns):
    columns = [name for name, _kind in agent_ns["INSPIRE_PLAN_COLUMNS"]]
    assert columns == ["use_case_id", *shell_sql.PLAN_COLUMNS]
    assert agent_ns["INSPIRE_PLANS_SUFFIX"] == shell_facts.PLANS_SUFFIX
    assert agent_ns["INSPIRE_PLAN_CONTRACTS"] == shell_sql.PLAN_CONTRACTS
    sql = agent_ns["inspire_plans_create_sql"]("main.supply.production_out")
    assert sql.startswith("CREATE TABLE IF NOT EXISTS `main`.`supply`.`production_out_plans` (use_case_id STRING, plan_id STRING")
    assert "changed_at TIMESTAMP" in sql and "value DOUBLE" in sql
    assert agent_ns["inspire_plans_table"]("main.supply.production_out") in agent_ns["implement_companion_tables"]("main.supply.production_out")


def test_the_notebook_finds_the_plan_and_forecast_pages_and_skips_the_others(agent_ns):
    pages = {"pages/a.json": json.dumps({"result_table": "main.s.plan_out", "layout": "planner"}),
             "pages/b.json": json.dumps({"result_table": "main.s.fc_out", "layout": "forecast_cockpit"}),
             "pages/c.json": json.dumps({"result_table": "main.s.queue_out", "layout": "decision_queue"}),
             "pages/d.json": json.dumps({"result_table": "main.s.queue2_out"}),
             "pages/e.json": json.dumps({"result_table": "main.s.lab_out", "layout": "scenario_lab"}),
             "pages/f.json": "{not json", "other/g.json": json.dumps({"result_table": "main.s.x", "layout": "planner"})}
    assert agent_ns["implement_app_planned_tables"](pages) == {"main.s.plan_out", "main.s.fc_out"}
    assert agent_ns["implement_layout_contract"]({"id": "planner"}) == "plan"


def _grants(spark):
    return [s for s in spark.statements if s.startswith("GRANT") and " ON TABLE " in s]


def test_the_app_service_principal_gets_select_and_modify_on_the_plans_table(agent_ns, caplog):
    from v150_app_owners_access_test import Catalog
    from v140_implement_test import _inspire
    spark = Catalog(schema=[("entity_id", "string")])
    inst = _inspire(agent_ns, spark)
    ran = []
    assert inst._implement_app_plan_grants("main.inspire.churn_out", "sp-7", ran) == []
    assert any(s.startswith("CREATE TABLE IF NOT EXISTS `main`.`inspire`.`churn_out_plans`") for s in spark.statements)
    assert _grants(spark) == ["GRANT SELECT ON TABLE `main`.`inspire`.`churn_out_plans` TO `sp-7`",
                              "GRANT MODIFY ON TABLE `main`.`inspire`.`churn_out_plans` TO `sp-7`"]
    assert {g["table"] for g in ran if g.get("level") == "table"} == {"main.inspire.churn_out_plans"}
    spark.statements.clear()
    inst._implement_app_write_grants("main.inspire.churn_out", "sp-7", {}, [], [])
    assert not [s for s in spark.statements if "churn_out_plans" in s], "a page without a plan or forecast gets no plans table"


def test_a_plans_table_the_notebook_cannot_create_becomes_a_named_warning(agent_ns):
    from v150_app_owners_access_test import Catalog
    from v140_implement_test import _inspire
    spark = Catalog(schema=[("entity_id", "string")], fail={"CREATE TABLE IF NOT EXISTS `main`.`inspire`.`churn_out_plans`": RuntimeError("no CREATE")})
    inst = _inspire(agent_ns, spark)
    warnings = inst._implement_app_plan_grants("main.inspire.churn_out", "sp-7", [])
    assert len(warnings) == 1 and "churn_out_plans" in warnings[0] and "could not create it" in warnings[0]
    assert agent_ns["IMPLEMENT_PLANS_REFUSED"] in warnings[0] and _grants(spark) == []


def test_the_app_build_grants_the_plans_table_for_plan_and_forecast_pages_in_both_access_modes(agent_ns):
    source = "\n".join("".join(c["source"]) for c in __import__("json").load(open(os.path.join(ROOT, "agent", "dbx_inspire_ai_agent.ipynb")))["cells"])
    assert source.count("planned = implement_app_planned_tables(files)") == 2
    assert source.count("warnings += self._implement_app_plan_grants(table, client_id, ran) if table in planned else []") == 2
