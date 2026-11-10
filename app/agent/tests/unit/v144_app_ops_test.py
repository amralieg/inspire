import contextlib
import copy
import datetime
import json
import os
import re
import sys
import threading
import time

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_core  # noqa: E402
import shell_db  # noqa: E402
import shell_sql  # noqa: E402
from v141_app_shell_test import PAGE, SETTINGS, FakeResponse, app_dir, call  # noqa: E402
from v142_edits_test import TableWorkspace, edit_page  # noqa: E402

UTC = datetime.timezone.utc
OWNER = "@".join(("owner", "example.com"))
DANA = "@".join(("dana", "example.com"))
LEE = "@".join(("lee", "example.com"))
SAM = "@".join(("sam", "example.com"))
JOB = "4242"
HOST = "ws.example.com"
JOB_URL = f"https://{HOST}/jobs/{JOB}"
NOW = datetime.datetime(2026, 10, 27, 9, 30, tzinfo=UTC)
ACTIVE = ("QUEUED", "PENDING", "RUNNING", "TERMINATING", "BLOCKED")
ASKED = "refresh_requested_by"


def ms(text: str) -> int:
    return int(datetime.datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp() * 1000)


def job_run(run_id, start, end=None, life="TERMINATED", result="SUCCESS", trigger="PERIODIC", by="schedule", message=""):
    run = {"run_id": run_id, "start_time": ms(start), "end_time": ms(end) if end else 0, "trigger": trigger,
           "state": {"life_cycle_state": life, "result_state": result if life == "TERMINATED" else None, "state_message": message}}
    if by is not None:
        run["job_parameters"] = [{"name": ASKED, "default": "schedule", "value": by}]
    return run


def table_run(run_id, day, ran, n=10, tier="Review"):
    return {"run_id": run_id, "tier": tier, "as_of_date": day, "ran_at": ran, "n": n}


SUMMARY_TABLE = "`main`.`pricing`.`loss_desk_out_summary`"
NO_SUMMARY_TABLE = shell_db.QueryError(f"[TABLE_OR_VIEW_NOT_FOUND] The table or view {SUMMARY_TABLE} cannot be found.")


def summary_row(run_id, updated, **values):
    row = {"use_case_id": "N01-U05", "run_id": run_id, "as_of_date": updated[:10], "summary": f"Run {run_id} found five records to fix.",
           "ai_endpoint": "databricks-claude-sonnet-4", "ai_config": "{}", "act_now_records": 2, "review_records": 3, "records": 40,
           "value_at_stake": 1200.5, "currency": "USD", "decision_basis": "measured", "act_now_amount": 1000.0, "review_amount": 100.0,
           "nothing_to_act": None, "updated_at": updated}
    row.update(values)
    return row


class JobsWorkspace(TableWorkspace):
    def __init__(self, job_runs=None, parameters=True, refuse=None, lag=False, delay=0.0, summary=None, **kw):
        super().__init__(**kw)
        self.job_list = list(job_runs or [])
        self.parameters, self.refuse, self.lag, self.delay = parameters, refuse, lag, delay
        self.summary = summary
        self.calls, self.started, self.kinds, self.guard = [], [], [], threading.Lock()

    def run_sql(self, warehouse, sql, params, limit=5000):
        if f"FROM {SUMMARY_TABLE}" in sql:
            self.sql.append((sql, params, limit))
            return self.summary_rows(sql, params, limit)
        return super().run_sql(warehouse, sql, params, limit)

    def summary_rows(self, sql, params, limit):
        if isinstance(self.summary, Exception):
            raise self.summary
        if self.summary is None:
            raise NO_SUMMARY_TABLE
        rows = sorted(self.summary, key=lambda r: r.get("updated_at") or "", reverse=True)
        picked = [json.loads(p["value"]) for p in params if str(p["value"]).startswith("[")]
        if picked:
            rows = [r for r in rows if str(r["run_id"]) in picked[0]]
        if "AS `run_id`, `updated_at` FROM" in sql:
            rows = [{"run_id": str(r["run_id"]), "updated_at": r.get("updated_at")} for r in rows]
        return {"columns": [], "rows": rows[:limit], "truncated": False}

    def summary_reads(self, index):
        return [(sql, params) for sql, params, _limit in self.sql if f"FROM {SUMMARY_TABLE}" in sql and ("AS `run_id`" in sql) == index
                and (index or "IN (SELECT explode(" in sql)]

    def state_reads(self):
        return [(sql, params) for sql, params, _limit in self.sql if sql == shell_sql.summary_query(edit_page(), 1)[0]]

    def _jobs_call(self, *call_):
        with self.guard:
            self.calls.append(call_)
        if self.refuse:
            raise self.refuse

    def job(self, job_id):
        self._jobs_call("get", job_id)
        if self.parameters == "notebook":
            task = {"task_key": "inspire_task", "notebook_task": {"notebook_path": "/n", "base_parameters": {ASKED: "schedule", "as_of_date": "latest"}}}
            return {"job_id": int(job_id), "settings": {"name": "Inspire job", "tasks": [task]}}
        parameters = [{"name": ASKED, "default": "schedule"}] if self.parameters else [{"name": "as_of", "default": ""}]
        return {"job_id": int(job_id), "settings": {"name": "Inspire job", "parameters": parameters}}

    def job_runs(self, job_id, active_only=False, limit=25):
        self._jobs_call("list", job_id, active_only, limit)
        with self.guard:
            runs = list(self.job_list)
        if active_only:
            mine = {r["run_id"] for r in runs if r.get("_ours")} if self.lag else set()
            runs = [r for r in runs if r["state"]["life_cycle_state"] in ACTIVE and r["run_id"] not in mine]
        return {"runs": [{k: v for k, v in r.items() if k != "_ours"} for r in runs[:limit]], "more": len(runs) > limit}

    def job_run(self, run_id):
        self._jobs_call("get-run", run_id)
        with self.guard:
            return next({k: v for k, v in r.items() if k != "_ours"} for r in self.job_list if str(r["run_id"]) == str(run_id))

    def run_now(self, job_id, parameters=None, kind="job_parameters"):
        self._jobs_call("run-now", job_id, parameters)
        time.sleep(self.delay)
        with self.guard:
            run_id = 9000 + len(self.started)
            self.started.append(parameters)
            self.kinds.append(kind)
            notebook = kind == "notebook_params"
            run = job_run(run_id, "2026-10-27T09:30:00Z", life="QUEUED", trigger="ONE_TIME", by=None if notebook else (parameters or {}).get(ASKED))
            if notebook:
                run["overriding_parameters"] = {"notebook_params": dict(parameters or {})}
            run["_ours"] = True
            self.job_list.insert(0, run)
        return {"run_id": run_id, "number_in_job": run_id}

    def jobs_calls(self, name):
        return [c for c in self.calls if c[0] == name]


def ops_settings(**changes):
    out = dict(copy.deepcopy(SETTINGS), jobs={"n01_u05": JOB}, admin=OWNER, use_case_owners={"n01_u05": [OWNER, DANA, SAM]})
    out.update(changes)
    return out


def ops_shell(tmp_path, sp=None, user=None, settings=None, pages=None, clock=None):
    sp = sp or JobsWorkspace()
    user = user or sp
    now = [NOW.timestamp()] if clock is None else clock
    s = shell_core.Shell(app_dir(tmp_path, settings or ops_settings(), pages or [edit_page()]),
                         env={"DATABRICKS_WAREHOUSE_ID": "wh1", "DATABRICKS_HOST": HOST},
                         sp_factory=lambda: sp, user_factory=lambda host, token: user, clock=lambda: now[0])
    return s, sp, now


def signed(email, token=None, username=None):
    headers = {"x-forwarded-email": email}
    if token:
        headers["x-forwarded-access-token"] = token
    if username:
        headers["x-forwarded-preferred-username"] = username
    return headers


WEEKLY = [table_run("u3", "2026-10-25", "2026-10-25T06:04:00.000Z"), table_run("u2", "2026-10-18", "2026-10-18T06:03:00.000Z"),
          table_run("u1", "2026-10-11", "2026-10-11T06:02:00.000Z")]


def test_settings_need_an_admin_and_jobs_that_name_known_pages_by_digit_ids():
    good = ops_settings()
    assert shell_core.settings_problems(good, [PAGE]) == []
    assert shell_core.settings_problems(dict(good, jobs={}), [PAGE]) == [], "a page may have no job"
    assert shell_core.settings_problems(dict(good, version=1), [PAGE]) == ["the App settings version must be 2"]
    need_admin = "the App settings need admin, the user name of the person who built the App"
    for admin in (None, 7, ["owner"]):
        assert shell_core.settings_problems(dict(good, admin=admin), [PAGE]) == [need_admin], admin
    assert shell_core.settings_problems({k: v for k, v in good.items() if k != "admin"}, [PAGE]) == [need_admin]
    for admin in ("", "   "):
        assert shell_core.settings_problems(dict(good, admin=admin), [PAGE]) == [], "Inspire may not have read who built the App"
    need_jobs = "the App settings need jobs, an object of page id to the id of the page's job"
    assert shell_core.settings_problems({k: v for k, v in good.items() if k != "jobs"}, [PAGE]) == [need_jobs]
    assert shell_core.settings_problems(dict(good, jobs=["4242"]), [PAGE]) == [need_jobs]
    assert shell_core.settings_problems(dict(good, jobs={"n09_u09": "4242"}), [PAGE]) == [
        "the App settings name a job for page n09_u09, which the App does not have"]
    for bad in ("12a", "", " 42", 4242, None, "1" * 20):
        assert shell_core.settings_problems(dict(good, jobs={"n01_u05": bad}), [PAGE]) == [
            f"the job of page n01_u05 must be a job id of digits, not {bad!r}"], bad


def test_load_app_refuses_settings_without_an_admin(tmp_path):
    with pytest.raises(ValueError, match="need admin"):
        shell_core.load_app(app_dir(tmp_path, {k: v for k, v in ops_settings().items() if k != "admin"}))
    (tmp_path / "unnamed").mkdir()
    assert shell_core.load_app(app_dir(tmp_path / "unnamed", ops_settings(admin="")))


def test_job_runs_page_through_the_list_and_run_now_names_who_asked():
    class Session:
        def __init__(self, answers):
            self.answers, self.calls = list(answers), []

        def request(self, method, url, headers=None, params=None, data=None, timeout=None):
            self.calls.append({"method": method, "url": url, "params": params, "body": json.loads(data) if data else None})
            return self.answers.pop(0)

    first = {"runs": [{"run_id": i} for i in range(25)], "has_more": True, "next_page_token": "t2"}
    second = {"runs": [{"run_id": i} for i in range(25, 50)], "has_more": True, "next_page_token": "t3"}
    session = Session([FakeResponse(payload=first), FakeResponse(payload=second)])
    ws = shell_db.Workspace(HOST, lambda: {"Authorization": "Bearer t"}, session=session)
    out = ws.job_runs(JOB, limit=50)
    assert [r["run_id"] for r in out["runs"]] == list(range(50)) and out["more"] is True
    assert [c["url"] for c in session.calls] == [f"https://{HOST}/api/2.2/jobs/runs/list"] * 2
    assert session.calls[0]["params"] == {"job_id": JOB, "active_only": "false", "limit": 25, "expand_tasks": "false"}
    assert session.calls[1]["params"]["page_token"] == "t2"
    session = Session([FakeResponse(payload={"runs": [{"run_id": 1}], "has_more": False, "next_page_token": "ignored"})])
    ws = shell_db.Workspace(HOST, lambda: {}, session=session)
    assert ws.job_runs(JOB, active_only=True) == {"runs": [{"run_id": 1}], "more": False}
    assert session.calls[0]["params"]["active_only"] == "true" and len(session.calls) == 1
    session = Session([FakeResponse(payload={}), FakeResponse(payload={"run_id": 7}), FakeResponse(payload={"run_id": 8}),
                       FakeResponse(payload={"job_id": 4242}), FakeResponse(payload={"run_id": 7})])
    ws = shell_db.Workspace(HOST, lambda: {}, session=session)
    assert ws.job_runs(JOB) == {"runs": [], "more": False}
    ws.run_now(JOB, {ASKED: DANA})
    ws.run_now(JOB)
    ws.job(JOB)
    ws.job_run("7")
    assert session.calls[1]["url"].endswith("/api/2.2/jobs/run-now") and session.calls[1]["method"] == "POST"
    assert session.calls[1]["body"] == {"job_id": 4242, "job_parameters": {ASKED: DANA}}
    assert session.calls[2]["body"] == {"job_id": 4242}
    assert session.calls[3]["url"].endswith("/api/2.2/jobs/get") and session.calls[3]["params"] == {"job_id": JOB}
    assert session.calls[4]["url"].endswith("/api/2.2/jobs/runs/get") and session.calls[4]["params"] == {"run_id": "7"}
    session = Session([FakeResponse(payload={"run_id": 9})])
    ws = shell_db.Workspace(HOST, lambda: {}, session=session)
    ws.run_now(JOB, {ASKED: DANA}, "notebook_params")
    assert session.calls[0]["body"] == {"job_id": 4242, "notebook_params": {ASKED: DANA}}
    with pytest.raises(ValueError, match="job_parameters or notebook_params"):
        ws.run_now(JOB, {ASKED: DANA}, "python_params")
    assert len(session.calls) == 1


def test_a_job_run_reads_both_state_shapes_its_trigger_and_who_asked():
    legacy = shell_core.job_run_view(job_run(11, "2026-10-26T06:00:00Z", "2026-10-26T06:04:30Z", by=DANA, trigger="ONE_TIME"), JOB_URL)
    assert legacy == {"run_id": "11", "trigger": "manual", "by": DANA, "started": "2026-10-26T06:00:00Z", "ended": "2026-10-26T06:04:30Z",
                      "duration_s": 270, "state": "terminated", "result": "succeeded", "message": "", "url": f"{JOB_URL}/runs/11"}
    status = {"run_id": 12, "start_time": ms("2026-10-26T07:00:00Z"), "end_time": ms("2026-10-26T07:01:00Z"), "run_duration": 50000,
              "trigger": "PERIODIC", "job_parameters": [{"name": ASKED, "default": "schedule"}],
              "status": {"state": "TERMINATED", "termination_details": {"code": "RUN_EXECUTION_ERROR", "message": "Notebook raised"}}}
    view = shell_core.job_run_view(status, JOB_URL)
    assert (view["trigger"], view["by"], view["result"], view["message"], view["duration_s"]) == (
        "scheduled", "the schedule", "failed", "Notebook raised", 50)
    queued = shell_core.job_run_view(job_run(13, "2026-10-27T09:00:00Z", life="QUEUED", by=None, trigger="FILE_ARRIVAL"), "")
    assert (queued["result"], queued["state"], queued["by"], queued["trigger"], queued["ended"], queued["url"]) == (
        "queued", "queued", "the schedule", "file arrival", None, "")
    assert shell_core.job_run_view(job_run(14, "2026-10-27T09:00:00Z", life="RUNNING"), "")["result"] == "running"
    for result, outcome in (("CANCELED", "canceled"), ("MAXIMUM_CONCURRENT_RUNS_REACHED", "skipped"), ("TIMEDOUT", "failed"),
                            ("SUCCESS_WITH_FAILURES", "succeeded")):
        assert shell_core.job_run_view(job_run(15, "2026-10-27T09:00:00Z", "2026-10-27T09:01:00Z", result=result), "")["result"] == outcome
    assert shell_core.job_run_view(job_run(16, "2026-10-27T09:00:00Z", life="SKIPPED", message="Skipped"), "")["result"] == "skipped"
    overridden = dict(job_run(17, "2026-10-27T09:00:00Z", by=None), overriding_parameters={"job_parameters": {ASKED: SAM}})
    assert shell_core.job_run_view(overridden, "")["by"] == SAM
    assert shell_core.requested_by({"job_parameters": [{"name": ASKED, "default": "schedule", "value": "schedule"}]}) == "the schedule"
    notebook = dict(job_run(18, "2026-10-27T09:00:00Z", by=None), overriding_parameters={"notebook_params": {ASKED: DANA, "as_of_date": "latest"}})
    assert shell_core.job_run_view(notebook, "")["by"] == DANA
    assert shell_core.requested_by({"overriding_parameters": {"notebook_params": {ASKED: "schedule"}}}) == "the schedule"


def test_the_requester_goes_where_the_job_declares_it():
    where = shell_core.requester_parameter
    assert where({"parameters": [{"name": ASKED, "default": "schedule"}]}) == "job_parameters"
    inspire = {"tasks": [{"task_key": "inspire_task", "notebook_task": {"notebook_path": "/n", "base_parameters": {ASKED: "schedule"}}}]}
    assert where(inspire) == "notebook_params"
    assert where(dict(inspire, parameters=[{"name": ASKED, "default": "schedule"}])) == "job_parameters"
    for settings in ({}, {"parameters": [{"name": "as_of", "default": ""}]}, {"tasks": [{"notebook_task": {"base_parameters": {"as_of": ""}}}]},
                     {"tasks": [{"spark_python_task": {"parameters": [ASKED]}}]}, {"tasks": ["bad", None]}, {"parameters": ["bad"]}):
        assert where(settings) is None, settings


def test_freshness_names_the_last_success_who_asked_and_the_data_date(tmp_path):
    runs = [job_run(103, "2026-10-27T08:00:00Z", "2026-10-27T08:02:00Z", result="FAILED", trigger="ONE_TIME", by=SAM, message="Table not found"),
            job_run(102, "2026-10-27T07:20:00Z", "2026-10-27T07:25:00Z", trigger="ONE_TIME", by=DANA),
            job_run(101, "2026-10-25T06:00:00Z", "2026-10-25T06:05:00Z")]
    s, sp, _now = ops_shell(tmp_path, JobsWorkspace(job_runs=runs, runs=WEEKLY))
    status, out = call(s, "GET", "freshness", query={"page": "n01_u05"}, headers=signed(SAM))
    assert status == 200, out
    assert out["last_success"] == {"run_id": "102", "trigger": "manual", "by": DANA, "started": "2026-10-27T07:20:00Z",
                                   "ended": "2026-10-27T07:25:00Z", "duration_s": 300, "state": "terminated", "result": "succeeded",
                                   "message": "", "url": f"{JOB_URL}/runs/102"}
    assert out["last_run"]["run_id"] == "103" and out["last_run"]["message"] == "Table not found"
    assert (out["source"], out["has_job"], out["active"], out["can_refresh"], out["reason"]) == ("job", True, None, True, "")
    assert out["run_url"] == f"{JOB_URL}/runs/103"
    assert (out["data_through"], out["cadence_days"], out["overdue"]) == ("2026-10-25", 7, False)
    assert out["typical_s"] == 300, "a refresh says how long a successful run usually takes; the failed run does not count"
    sp.job_list = runs[2:]
    s.cache.clear()
    out = call(s, "GET", "freshness", query={"page": "n01_u05"}, headers=signed(SAM))[1]
    assert out["last_success"]["by"] == "the schedule" and out["last_success"]["trigger"] == "scheduled"


@pytest.mark.parametrize("life, by, started, reason", [
    ("RUNNING", DANA, "2026-10-27T09:14:00Z", f"A refresh is already running, started 09:14 UTC by {DANA}"),
    ("PENDING", "schedule", "2026-10-27T09:14:00Z", "A refresh is already running, started 09:14 UTC by the schedule"),
    ("QUEUED", SAM, "2026-10-27T09:20:00Z", f"A refresh is already waiting to run, queued 09:20 UTC by {SAM}"),
    ("RUNNING", None, "2026-10-26T23:50:00Z", "A refresh is already running, started Oct 26 at 23:50 UTC by the schedule"),
])
def test_freshness_during_any_active_run_refuses_a_refresh_and_says_who_started_it(tmp_path, life, by, started, reason):
    runs = [job_run(201, started, life=life, by=by), job_run(200, "2026-10-25T06:00:00Z", "2026-10-25T06:05:00Z")]
    s, _sp, _now = ops_shell(tmp_path, JobsWorkspace(job_runs=runs, runs=WEEKLY))
    out = call(s, "GET", "freshness", query={"page": "n01_u05"}, headers=signed(DANA))[1]
    assert out["active"]["run_id"] == "201" and out["active"]["state"] == life.lower() and out["active"]["started"] == started
    assert out["can_refresh"] is False and out["reason"] == reason
    assert out["run_url"] == f"{JOB_URL}/runs/201" and out["last_success"]["run_id"] == "200"


def test_a_run_the_build_or_the_jobs_page_started_never_says_the_schedule_started_it(tmp_path):
    build = dict(job_run(31, "2026-10-27T09:14:00Z", life="RUNNING", by=None, trigger="ONE_TIME"),
                 overriding_parameters={"notebook_params": {ASKED: "build", "run_profile": "preview"}})
    by_hand = job_run(32, "2026-10-27T09:14:00Z", life="RUNNING", by="schedule", trigger="ONE_TIME")
    seen = {name: shell_core.job_run_view(run, "") for name, run in (("build", build), ("by_hand", by_hand))}
    assert (seen["build"]["by"], seen["by_hand"]["by"]) == ("the Inspire build", "")
    assert [shell_core.run_trigger(seen[n], {}) for n in ("build", "by_hand")] == ["build", "manual"]
    assert shell_core.run_view(dict(shell_core.blank_run("u1"), job=seen["build"]), {}, edit_page())["by"] == ""
    for run, reason in ((build, "A refresh is already running, started 09:14 UTC by the Inspire build"),
                        (by_hand, "A refresh is already running, started 09:14 UTC")):
        runs = [run, job_run(200, "2026-10-25T06:00:00Z", "2026-10-25T06:05:00Z")]
        (tmp_path / str(run["run_id"])).mkdir()
        s, _sp, _now = ops_shell(tmp_path / str(run["run_id"]), JobsWorkspace(job_runs=runs, runs=WEEKLY))
        out = call(s, "GET", "freshness", query={"page": "n01_u05"}, headers=signed(DANA))[1]
        assert (out["can_refresh"], out["reason"]) == (False, reason)
    scheduled = shell_core.job_run_view(job_run(33, "2026-10-27T09:14:00Z", life="RUNNING", by="schedule"), "")
    assert scheduled["by"] == "the schedule" and shell_core.run_trigger(scheduled, {}) == "schedule"


def test_freshness_shows_the_running_run_ahead_of_the_ones_queued_behind_it(tmp_path):
    runs = [job_run(303, "2026-10-27T09:25:00Z", life="QUEUED", by=SAM), job_run(302, "2026-10-27T09:20:00Z", life="QUEUED", by=DANA),
            job_run(301, "2026-10-27T09:00:00Z", life="RUNNING")]
    s, _sp, _now = ops_shell(tmp_path, JobsWorkspace(job_runs=runs, runs=WEEKLY))
    assert call(s, "GET", "freshness", query={"page": "n01_u05"}, headers=signed(DANA))[1]["active"]["run_id"] == "301"
    queued = shell_core.shown_active([shell_core.job_run_view(r, "") for r in runs[:2]])
    assert queued["run_id"] == "302", "the oldest queued run is the next to start"


def test_freshness_falls_back_to_the_result_table_when_the_page_has_no_job(tmp_path):
    sp = JobsWorkspace(runs=WEEKLY)
    s, _sp, _now = ops_shell(tmp_path, sp, settings=ops_settings(jobs={}))
    out = call(s, "GET", "freshness", query={"page": "n01_u05"}, headers=signed(DANA))[1]
    assert out["has_job"] is False and out["can_refresh"] is False and out["source"] == "table"
    assert out["reason"] == "The App does not refresh this page: it shows its tables as they are"
    assert out["last_success"] == {"run_id": "u3", "started": "2026-10-25T06:04:00.000Z", "ended": None, "trigger": None, "by": None}
    assert out["data_through"] == "2026-10-25" and out["run_url"] == "" and sp.calls == [] and out["typical_s"] is None


def test_freshness_falls_back_to_the_result_table_when_the_jobs_call_is_refused(tmp_path):
    refused = shell_db.QueryError("GET /api/2.2/jobs/runs/list answered HTTP 403: the App may not view this job")
    s, _sp, _now = ops_shell(tmp_path, JobsWorkspace(refuse=refused, runs=WEEKLY))
    status, out = call(s, "GET", "freshness", query={"page": "n01_u05"}, headers=signed(DANA))
    assert status == 200 and out["has_job"] is True and out["can_refresh"] is False and out["source"] == "table"
    assert out["reason"] == f"The App cannot read this page's job, so it cannot refresh it: {refused}"
    assert out["last_success"]["run_id"] == "u3" and out["run_url"] == JOB_URL and out["active"] is None


def test_freshness_falls_back_to_the_result_table_when_the_job_has_no_success_to_show(tmp_path):
    runs = [job_run(9, "2026-10-27T08:00:00Z", "2026-10-27T08:01:00Z", result="FAILED", message="Cluster did not start")]
    s, _sp, _now = ops_shell(tmp_path, JobsWorkspace(job_runs=runs, runs=WEEKLY))
    out = call(s, "GET", "freshness", query={"page": "n01_u05"}, headers=signed(DANA))[1]
    assert out["source"] == "table" and out["last_success"]["run_id"] == "u3" and out["can_refresh"] is True
    assert out["last_run"]["message"] == "Cluster did not start" and out["run_url"] == f"{JOB_URL}/runs/9"


def test_freshness_with_no_runs_anywhere_has_nothing_refreshed_yet(tmp_path):
    s, _sp, _now = ops_shell(tmp_path, JobsWorkspace())
    out = call(s, "GET", "freshness", query={"page": "n01_u05"}, headers=signed(DANA))[1]
    assert (out["last_success"], out["last_run"], out["active"], out["data_through"], out["overdue"]) == (None, None, None, None, False)
    assert out["typical_s"] is None, "no successful run yet, so the App does not guess how long one takes"
    assert out["can_refresh"] is True and out["run_url"] == JOB_URL


def test_overdue_reuses_the_run_health_cadence_of_the_result_table_then_of_the_job(tmp_path):
    late = [table_run("u2", "2026-10-15", "2026-10-15T06:00:00Z"), table_run("u1", "2026-10-08", "2026-10-08T06:00:00Z")]
    s, _sp, _now = ops_shell(tmp_path, JobsWorkspace(runs=late))
    out = call(s, "GET", "freshness", query={"page": "n01_u05"}, headers=signed(DANA))[1]
    assert (out["overdue"], out["cadence_days"], out["data_through"]) == (True, 7, "2026-10-15")
    (tmp_path / "ontime").mkdir()
    s, _sp, _now = ops_shell(tmp_path / "ontime", JobsWorkspace(runs=WEEKLY))
    assert call(s, "GET", "freshness", query={"page": "n01_u05"}, headers=signed(DANA))[1]["overdue"] is False
    weekly_job = [job_run(2, "2026-10-15T06:00:00Z", "2026-10-15T06:05:00Z"), job_run(1, "2026-10-08T06:00:00Z", "2026-10-08T06:05:00Z")]
    (tmp_path / "plain").mkdir()
    plain = copy.deepcopy(PAGE)
    s, _sp, _now = ops_shell(tmp_path / "plain", JobsWorkspace(job_runs=weekly_job), pages=[plain])
    out = call(s, "GET", "freshness", query={"page": "n01_u05"}, headers=signed(DANA))[1]
    assert (out["overdue"], out["cadence_days"], out["data_through"], out["source"]) == (True, 7, None, "job")
    assert out["last_success"]["run_id"] == "2"


def test_freshness_in_user_mode_offers_the_refresh_to_the_owners_only_and_reads_jobs_as_the_app(tmp_path):
    sp = JobsWorkspace(job_runs=[job_run(1, "2026-10-25T06:00:00Z", "2026-10-25T06:05:00Z")])
    user = TableWorkspace(runs=WEEKLY)
    s, _sp, _now = ops_shell(tmp_path, sp, user=user, settings=ops_settings(auth="user"))
    assert call(s, "GET", "freshness", query={"page": "n01_u05"}, headers=signed(LEE))[0] == 401
    out = call(s, "GET", "freshness", query={"page": "n01_u05"}, headers=signed(LEE, "tok-l"))[1]
    assert out["can_refresh"] is False and out["reason"] == "Only the owners of this use case can run it now"
    assert call(s, "GET", "freshness", query={"page": "n01_u05"}, headers=signed(DANA, "tok-d"))[1]["can_refresh"] is True
    assert out["data_through"] == "2026-10-25" and out["last_success"]["run_id"] == "1"
    out = call(s, "GET", "freshness", query={"page": "n01_u05"}, headers=signed(OWNER.upper(), "tok-o"))[1]
    assert out["can_refresh"] is True and out["reason"] == ""
    assert sp.jobs_calls("list") and not any("AS ran_at" in q for q, _p, _l in sp.sql)


def test_freshness_reads_the_job_at_most_every_few_seconds(tmp_path):
    s, sp, now = ops_shell(tmp_path, JobsWorkspace(runs=WEEKLY))
    for _ in range(3):
        call(s, "GET", "freshness", query={"page": "n01_u05"}, headers=signed(DANA))
    assert len(sp.jobs_calls("list")) == 2
    now[0] += 6
    call(s, "GET", "freshness", query={"page": "n01_u05"}, headers=signed(SAM))
    assert len(sp.jobs_calls("list")) == 4


def test_refresh_starts_the_job_with_who_asked_and_the_banner_sees_it_at_once(tmp_path):
    s, sp, _now = ops_shell(tmp_path, JobsWorkspace(runs=WEEKLY))
    assert call(s, "GET", "freshness", query={"page": "n01_u05"}, headers=signed(DANA))[1]["active"] is None
    status, out = call(s, "POST", "refresh", headers=signed(DANA), body={"page": "n01_u05"})
    assert status == 200 and out == {"run_id": "9000", "state": "queued"}
    assert sp.jobs_calls("run-now") == [("run-now", JOB, {ASKED: DANA})] and sp.jobs_calls("get") == [("get", JOB)]
    fresh = call(s, "GET", "freshness", query={"page": "n01_u05"}, headers=signed(SAM))[1]
    assert fresh["active"]["run_id"] == "9000" and fresh["active"]["by"] == DANA and fresh["can_refresh"] is False
    assert fresh["reason"] == f"A refresh is already waiting to run, queued 09:30 UTC by {DANA}"


def test_refresh_of_an_inspire_job_names_who_asked_as_a_notebook_parameter(tmp_path):
    s, sp, _now = ops_shell(tmp_path, JobsWorkspace(parameters="notebook", runs=WEEKLY))
    status, out = call(s, "POST", "refresh", headers=signed(DANA), body={"page": "n01_u05"})
    assert status == 200 and out == {"run_id": "9000", "state": "queued"}
    assert sp.jobs_calls("run-now") == [("run-now", JOB, {ASKED: DANA})] and sp.kinds == ["notebook_params"]
    fresh = call(s, "GET", "freshness", query={"page": "n01_u05"}, headers=signed(SAM))[1]
    assert fresh["active"]["by"] == DANA and fresh["reason"] == f"A refresh is already waiting to run, queued 09:30 UTC by {DANA}"
    status, out = call(s, "POST", "refresh", headers=signed(SAM), body={"page": "n01_u05"})
    assert status == 409 and DANA in out["error"] and len(sp.started) == 1


def test_refresh_of_a_job_without_the_parameter_starts_it_with_no_parameters(tmp_path):
    s, sp, _now = ops_shell(tmp_path, JobsWorkspace(parameters=False))
    assert call(s, "POST", "refresh", headers=signed(DANA), body={"page": "n01_u05"})[0] == 200
    assert sp.jobs_calls("run-now") == [("run-now", JOB, None)]


def test_a_second_refresh_while_one_is_queued_or_running_is_refused_with_409(tmp_path):
    s, sp, _now = ops_shell(tmp_path, JobsWorkspace())
    assert call(s, "POST", "refresh", headers=signed(DANA), body={"page": "n01_u05"})[0] == 200
    status, out = call(s, "POST", "refresh", headers=signed(SAM), body={"page": "n01_u05"})
    assert status == 409 and out == {"error": f"A refresh is already waiting to run, queued 09:30 UTC by {DANA}"}
    assert len(sp.jobs_calls("run-now")) == 1
    (tmp_path / "scheduled").mkdir()
    s, sp, _now = ops_shell(tmp_path / "scheduled", JobsWorkspace(job_runs=[job_run(5, "2026-10-27T09:14:00Z", life="RUNNING")]))
    status, out = call(s, "POST", "refresh", headers=signed(SAM), body={"page": "n01_u05"})
    assert status == 409 and out["error"] == "A refresh is already running, started 09:14 UTC by the schedule"
    assert sp.jobs_calls("run-now") == [] and sp.jobs_calls("list") == [("list", JOB, True, 25)]


def _race(s, n=8):
    results, gate = [], threading.Barrier(n)

    def click(i):
        gate.wait()
        results.append(call(s, "POST", "refresh", headers=signed("@".join((f"user{i}", "example.com"))), body={"page": "n01_u05"})[0])

    threads = [threading.Thread(target=click, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    return sorted(results)


RACERS = ["@".join((f"user{i}", "example.com")) for i in range(8)]


def test_two_concurrent_refreshes_start_exactly_one_run(tmp_path):
    s, sp, _now = ops_shell(tmp_path, JobsWorkspace(delay=0.15), settings=ops_settings(use_case_owners={"n01_u05": RACERS}))
    assert _race(s) == [200] + [409] * 7
    assert len(sp.started) == 1
    (tmp_path / "unlocked").mkdir()
    s, sp, _now = ops_shell(tmp_path / "unlocked", JobsWorkspace(delay=0.15), settings=ops_settings(use_case_owners={"n01_u05": RACERS}))
    s.job_lock = lambda job_id: contextlib.nullcontext()
    _race(s)
    assert len(sp.started) > 1, "without the lock the check-then-start races, which is what the lock prevents"


def test_refresh_remembers_the_run_it_started_while_the_runs_list_lags(tmp_path):
    s, sp, _now = ops_shell(tmp_path, JobsWorkspace(lag=True))
    assert call(s, "POST", "refresh", headers=signed(DANA), body={"page": "n01_u05"})[0] == 200
    status, out = call(s, "POST", "refresh", headers=signed(SAM), body={"page": "n01_u05"})
    assert status == 409 and DANA in out["error"] and len(sp.started) == 1
    sp.job_list[0]["state"] = {"life_cycle_state": "TERMINATED", "result_state": "SUCCESS", "state_message": ""}
    assert call(s, "POST", "refresh", headers=signed(SAM), body={"page": "n01_u05"})[0] == 200
    assert len(sp.started) == 2


def test_the_banner_shows_the_run_a_refresh_started_while_the_runs_list_lags(tmp_path):
    s, sp, now = ops_shell(tmp_path, JobsWorkspace(lag=True))
    assert call(s, "POST", "refresh", headers=signed(DANA), body={"page": "n01_u05"})[0] == 200
    fresh = call(s, "GET", "freshness", query={"page": "n01_u05"}, headers=signed(SAM))[1]
    assert fresh["active"] and fresh["active"]["run_id"] == "9000" and fresh["active"]["by"] == DANA, fresh["active"]
    assert fresh["can_refresh"] is False and fresh["reason"] == f"A refresh is already waiting to run, queued 09:30 UTC by {DANA}"
    sp.job_list[0]["state"] = {"life_cycle_state": "TERMINATED", "result_state": "SUCCESS", "state_message": ""}
    now[0] += 6
    fresh = call(s, "GET", "freshness", query={"page": "n01_u05"}, headers=signed(SAM))[1]
    assert fresh["active"] is None and fresh["can_refresh"] is True, "the run it started ended, so the banner lets go of it"


@pytest.mark.parametrize("auth", ["user", "sp"])
def test_refresh_is_for_the_owners_in_either_mode_by_the_button_and_by_the_route(tmp_path, auth):
    sp = JobsWorkspace(job_runs=[job_run(1, "2026-10-25T06:00:00Z", "2026-10-25T06:05:00Z")])
    s, _sp, _now = ops_shell(tmp_path, sp, user=TableWorkspace(runs=WEEKLY), settings=ops_settings(auth=auth))
    fresh = call(s, "GET", "freshness", query={"page": "n01_u05"}, headers=signed(LEE, "tok-l"))[1]
    assert fresh["can_refresh"] is False and fresh["reason"] == "Only the owners of this use case can run it now"
    for route in ("refresh", "settings/run"):
        assert call(s, "POST", route, headers=signed(LEE, "tok-l"), body={"page": "n01_u05"}) == (
            403, {"error": "Only the owners of this use case can run it now"})
    assert sp.jobs_calls("run-now") == []
    assert call(s, "POST", "refresh", headers=signed(DANA, "tok-d"), body={"page": "n01_u05"})[0] == 200
    status, out = call(s, "POST", "settings/run", headers=signed(SAM, "tok-s"), body={"page": "n01_u05"})
    assert status == 409 and "already waiting to run" in out["error"] and len(sp.started) == 1


def test_refresh_in_user_mode_starts_for_an_owner_of_the_use_case_named_by_email_or_user_name(tmp_path):
    sp, user = JobsWorkspace(), TableWorkspace()
    s, _sp, _now = ops_shell(tmp_path, sp, user=user, settings=ops_settings(auth="user"))
    status, out = call(s, "POST", "refresh", headers=signed(LEE, "tok-l"), body={"page": "n01_u05"})
    assert status == 403 and out == {"error": "Only the owners of this use case can run it now"}
    assert sp.jobs_calls("run-now") == [] and sp.calls == []
    status, out = call(s, "POST", "refresh", headers=signed(OWNER.title(), "tok-o"), body={"page": "n01_u05"})
    assert status == 200 and sp.jobs_calls("run-now") == [("run-now", JOB, {ASKED: OWNER.title()})]
    (tmp_path / "username").mkdir()
    s, sp, _now = ops_shell(tmp_path / "username", JobsWorkspace(), user=TableWorkspace(),
                            settings=ops_settings(auth="user", use_case_owners={"n01_u05": ["owner"]}))
    assert call(s, "POST", "refresh", headers=signed(LEE, "tok-l"), body={"page": "n01_u05"})[0] == 403
    assert call(s, "POST", "refresh", headers=signed(LEE, "tok-o", username="Owner"), body={"page": "n01_u05"})[0] == 200


@pytest.mark.parametrize("auth", ["user", "sp"])
def test_an_app_that_names_no_owner_says_no_one_can_refresh_it_in_either_mode(tmp_path, auth):
    unnamed = "No one can run this use case from the App, because the App names no owner of it; build it again with Vibe/Add/Remove Features on Inspire's Build page"
    sp = JobsWorkspace(job_runs=[job_run(1, "2026-10-25T06:00:00Z", "2026-10-25T06:05:00Z")])
    s, _sp, _now = ops_shell(tmp_path, sp, user=TableWorkspace(runs=WEEKLY), settings=ops_settings(auth=auth, admin="  ", use_case_owners={}))
    for who in (DANA, OWNER):
        out = call(s, "GET", "freshness", query={"page": "n01_u05"}, headers=signed(who, "tok"))[1]
        assert out["can_refresh"] is False and out["reason"] == unnamed, who
        assert call(s, "POST", "refresh", headers=signed(who, "tok"), body={"page": "n01_u05"}) == (403, {"error": unnamed})
    assert sp.jobs_calls("run-now") == []


def test_refresh_refuses_the_anonymous_and_starts_for_a_signed_in_owner(tmp_path):
    s, sp, _now = ops_shell(tmp_path, JobsWorkspace())
    status, out = call(s, "POST", "refresh", body={"page": "n01_u05"})
    assert status == 401 and out["error"] == "Sign in so the App can record who asked for the run" and sp.calls == []
    assert call(s, "POST", "refresh", headers=signed(SAM), body={"page": "n01_u05"})[0] == 200


def test_refresh_needs_a_page_with_a_job_and_reports_a_refused_jobs_call(tmp_path):
    s, sp, _now = ops_shell(tmp_path, JobsWorkspace(), settings=ops_settings(jobs={}))
    status, out = call(s, "POST", "refresh", headers=signed(DANA), body={"page": "n01_u05"})
    assert status == 409 and "does not refresh this page" in out["error"] and sp.calls == []
    assert call(s, "POST", "refresh", headers=signed(DANA), body={"page": "nope"})[0] == 404
    (tmp_path / "refused").mkdir()
    refused = shell_db.QueryError("GET /api/2.2/jobs/runs/list answered HTTP 403: the App may not view this job")
    s, sp, _now = ops_shell(tmp_path / "refused", JobsWorkspace(refuse=refused))
    status, out = call(s, "POST", "refresh", headers=signed(DANA), body={"page": "n01_u05"})
    assert status == 502 and "HTTP 403" in out["error"] and sp.jobs_calls("run-now") == []


def test_refresh_returns_pending_when_the_new_run_cannot_be_read_yet(tmp_path):
    class Lost(JobsWorkspace):
        def job_run(self, run_id):
            raise shell_db.QueryError("GET /api/2.2/jobs/runs/get answered HTTP 404: no such run")

    s, _sp, _now = ops_shell(tmp_path, Lost())
    assert call(s, "POST", "refresh", headers=signed(DANA), body={"page": "n01_u05"})[1] == {"run_id": "9000", "state": "pending"}


JOB_HISTORY = [
    job_run(408, "2026-10-27T08:00:00Z", "2026-10-27T08:06:00Z", result="FAILED", trigger="ONE_TIME", by=SAM, message="Table not found"),
    job_run(407, "2026-10-25T06:00:00Z", "2026-10-25T06:03:00Z"),
    job_run(406, "2026-10-24T06:00:00Z", "2026-10-24T06:01:00Z", result="CANCELED", trigger="ONE_TIME", by=DANA, message="Canceled by Dana"),
    job_run(405, "2026-10-18T06:00:00Z", "2026-10-18T06:02:00Z", trigger="ONE_TIME", by=DANA),
    job_run(404, "2026-10-11T06:00:00Z", "2026-10-11T06:01:00Z"),
    job_run(403, "2026-09-20T06:00:00Z", "2026-09-20T06:10:00Z", result="FAILED", message="Old failure"),
]


def test_run_health_lists_the_job_runs_with_the_stats_of_the_run_versions_they_wrote(tmp_path):
    table = WEEKLY + [table_run("u0", "2026-10-04", "2026-10-04T06:00:00Z"),
                      table_run("u3", "2026-10-25", "2026-10-25T06:04:00.000Z", n=5, tier="Act now")]
    s, sp, _now = ops_shell(tmp_path, JobsWorkspace(job_runs=JOB_HISTORY, runs=table))
    status, out = call(s, "GET", "runs", query={"page": "n01_u05"}, headers=signed(DANA))
    assert status == 200, out
    assert sp.jobs_calls("list") == [("list", JOB, False, 50)]
    rows = out["runs"]
    assert [r["job_run_id"] for r in rows] == ["408", "407", "406", "405", "404", None, "403"]
    assert [r["run_id"] for r in rows] == [None, "u3", None, "u2", "u1", "u0", None]
    assert rows[1]["records"] == 15
    assert rows[1]["to_fix"] == 15 and rows[4]["to_fix"] == 10, "without a run summary the Act now and Review records are the things to fix"
    assert (rows[1]["status"], rows[1]["trigger"], rows[1]["by"], rows[1]["error"]) == ("done", "schedule", "", "")
    assert (rows[1]["started"], rows[1]["duration_s"], rows[1]["segments"], rows[1]["tables"]) == ("2026-10-25T06:00:00Z", 180, None, None)
    assert rows[0]["records"] is None and rows[0]["status"] == "failed" and rows[0]["to_fix"] is None
    assert (rows[0]["error"], rows[0]["by"], rows[0]["trigger"], rows[0]["url"]) == ("Table not found", SAM, "refresh", f"{JOB_URL}/runs/408")
    assert rows[2]["status"] == "canceled" and rows[2]["error"] == "Canceled by Dana"
    assert (rows[0]["error_code"], rows[1]["error_code"], rows[2]["error_code"]) == ("missing_table", "", ""), \
        "only a failed run says what kind of failure it was"
    assert rows[5]["job_run_id"] is None and rows[5]["status"] == "done", "a run older than the listed job runs still shows"
    assert out == {"runs": rows, "total": 7, "offset": 0, "limit": 20, "job": {"id": JOB, "url": JOB_URL, "error": ""}, "errors": {}, "can_run": True}
    assert set(rows[0]) == {"run_id", "job_run_id", "url", "started", "ended", "duration_s", "status", "trigger", "by", "segments", "tables",
                            "stages", "grouping", "records", "to_fix", "could_save", "currency", "unit", "impact_kind", "summary",
                            "nothing_to_act", "error", "error_code", "scope", "scope_text", "facts"}
    assert rows[0]["grouping"] is None, "a run with no run_grouping record shows no grouping"
    assert not any("AS people" in q for q, _p, _l in sp.sql), "the Runs tab no longer counts people, so the App does not ask"


def test_a_run_version_matches_the_job_run_whose_window_holds_it_up_to_five_minutes_after_it_ends():
    views = [shell_core.job_run_view(job_run(2, "2026-10-20T06:00:00Z", "2026-10-20T06:10:00Z"), ""),
             shell_core.job_run_view(job_run(1, "2026-10-20T05:00:00Z", "2026-10-20T05:10:00Z"), "")]
    table = [{"run_id": "a", "ran_at": "2026-10-20T06:14:59Z", "as_of_date": "2026-10-20"},
             {"run_id": "b", "ran_at": "2026-10-20T05:15:01Z", "as_of_date": "2026-10-20"},
             {"run_id": "c", "ran_at": "2026-10-20T04:59:59Z", "as_of_date": "2026-10-19"}]
    merged = shell_core.merge_runs(table, views, NOW)
    by = {r["run_id"]: (r["job"] or {}).get("run_id") for r in merged}
    assert by == {"a": "2", "b": None, "c": None, None: "1"}
    running = [shell_core.job_run_view(job_run(3, "2026-10-27T09:00:00Z", life="RUNNING"), "")]
    assert shell_core.merge_runs([{"run_id": "d", "ran_at": "2026-10-27T09:29:00Z"}], running, NOW)[0]["job"]["run_id"] == "3"
    assert shell_core.merge_runs([], [], NOW) == []


def test_a_refresh_says_how_long_a_successful_run_usually_takes_from_the_runs_it_read():
    views = [shell_core.job_run_view(r, "") for r in JOB_HISTORY]
    assert shell_core.typical_s(views) == 120, "only successful runs count; failed and canceled runs do not"
    assert shell_core.typical_s([]) is None and shell_core.typical_s(views[:1]) is None
    even = [shell_core.job_run_view(job_run(i, "2026-10-20T06:00:00Z", f"2026-10-20T06:0{i}:00Z"), "") for i in (1, 2, 3, 4)]
    assert shell_core.typical_s(even) == 150


def test_run_health_without_a_job_or_with_a_refused_jobs_call_still_lists_the_table_runs(tmp_path):
    s, sp, _now = ops_shell(tmp_path, JobsWorkspace(runs=WEEKLY), settings=ops_settings(jobs={}))
    out = call(s, "GET", "runs", query={"page": "n01_u05"}, headers=signed(DANA))[1]
    assert out["job"] is None and [r["run_id"] for r in out["runs"]] == ["u3", "u2", "u1"]
    assert sp.calls == [] and all(r["job_run_id"] is None for r in out["runs"])
    (tmp_path / "refused").mkdir()
    refused = shell_db.QueryError("GET /api/2.2/jobs/runs/list answered HTTP 403: the App may not view this job")
    s, _sp, _now = ops_shell(tmp_path / "refused", JobsWorkspace(runs=WEEKLY, refuse=refused))
    status, out = call(s, "GET", "runs", query={"page": "n01_u05"}, headers=signed(DANA))
    assert status == 200 and out["job"]["error"] == str(refused)
    assert [r["run_id"] for r in out["runs"]] == ["u3", "u2", "u1"]


def test_run_health_before_any_run_is_empty_but_says_so(tmp_path):
    s, _sp, _now = ops_shell(tmp_path, JobsWorkspace())
    out = call(s, "GET", "runs", query={"page": "n01_u05"}, headers=signed(DANA))[1]
    assert (out["runs"], out["total"], out["job"], out["errors"]) == ([], 0, {"id": JOB, "url": JOB_URL, "error": ""}, {})


def test_the_app_info_link_host_and_the_job_links_share_one_host_rule(tmp_path):
    s, _sp, _now = ops_shell(tmp_path, JobsWorkspace())
    info = call(s, "GET", "app", headers=signed(DANA))[1]
    assert info["genie"]["url"].startswith(f"https://{HOST}/genie/rooms/") and s.job_url(JOB) == JOB_URL
    assert "admin" not in info and JOB not in json.dumps(info)


SEGMENTS = json.dumps([{"column": "category", "values": ["Books", "Music"]}, {"column": "store_id", "values": [12, 4]}])
TABLES = json.dumps([{"table": "main.pricing.items", "rows": 1200, "updated_at": "2026-10-25T05:00:00Z"},
                     {"table": "main.pricing.loss_trend", "rows": "88", "updated_at": None}])
MISSING = "[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`pricing`.`items` cannot be found."


def test_runs_join_each_run_summary_by_run_id_to_its_job_run_and_say_what_it_covered_and_read(tmp_path):
    summary = [summary_row("u3", "2026-10-25T06:05:00.000Z", run_started_at="2026-10-25T06:00:30.000Z", run_ended_at="2026-10-25T06:05:10.000Z",
                           run_trigger="schedule", run_segments=SEGMENTS, run_tables=TABLES),
               summary_row("u4", "2026-10-27T08:05:00.000Z", run_started_at="2026-10-27T08:00:40.000Z", run_ended_at=None, run_trigger="refresh",
                           run_segments="[]", run_tables="[]", records=0, act_now_records=0, review_records=0, value_at_stake=None, summary="",
                           nothing_to_act="No record has 1000 USD or more at stake; the largest is 640 USD.")]
    jobs = [job_run(408, "2026-10-27T08:00:00Z", "2026-10-27T08:06:00Z", result="FAILED", trigger="ONE_TIME", by=SAM, message=MISSING),
            job_run(407, "2026-10-25T06:00:00Z", "2026-10-25T06:06:00Z")]
    sp = JobsWorkspace(job_runs=jobs, runs=[table_run("u3", "2026-10-25", "2026-10-25T06:04:00.000Z", n=40)], summary=summary)
    s, _sp, _now = ops_shell(tmp_path, sp)
    status, out = call(s, "GET", "runs", query={"page": "n01_u05"}, headers=signed(DANA))
    assert status == 200 and out["errors"] == {} and out["total"] == 2
    latest, scheduled = out["runs"]
    assert (latest["run_id"], latest["job_run_id"], latest["status"], latest["trigger"], latest["by"]) == ("u4", "408", "failed", "refresh", SAM)
    assert (latest["started"], latest["duration_s"]) == ("2026-10-27T08:00:00Z", 360), "the job run's own clock wins"
    assert (latest["segments"], latest["tables"], latest["records"], latest["to_fix"], latest["could_save"]) == ([], [], 0, 0, None)
    assert latest["error"] == shell_sql.PLAIN_ERRORS["missing_table"] and latest["nothing_to_act"].startswith("No record has 1000 USD") and latest["summary"] == ""
    assert latest["error_code"] == "missing_table", "the run keeps the error class of the raw job message, and only the answer is made plain"
    assert MISSING not in json.dumps(out), "no raw warehouse error reaches the page"
    assert scheduled["segments"] == [{"column": "category", "label": "Category", "values": ["Books", "Music"], "more": 0},
                                     {"column": "store_id", "label": "Store id", "values": ["12", "4"], "more": 0}]
    unscoped = {"rows_total": None, "scoped": False}
    assert scheduled["tables"] == [dict(unscoped, table="main.pricing.items", rows=1200, updated_at="2026-10-25T05:00:00Z"),
                                   dict(unscoped, table="main.pricing.loss_trend", rows=88, updated_at=None)]
    assert (scheduled["scope"], scheduled["scope_text"], scheduled["facts"]) == (None, "", {}), "a run that recorded no scope states none"
    assert (scheduled["records"], scheduled["to_fix"], scheduled["could_save"], scheduled["currency"], scheduled["unit"],
            scheduled["impact_kind"]) == (40, 5, 1200.5, "USD", "USD", "money"), "a run from before the impact unit is money in its currency"
    assert (scheduled["status"], scheduled["trigger"], scheduled["error"]) == ("done", "schedule", "")
    assert scheduled["summary"] == "Run u3 found five records to fix."
    (index_sql, index_params), = sp.summary_reads(index=True)
    assert index_sql == (f"SELECT CAST(`run_id` AS STRING) AS `run_id`, `updated_at` FROM {SUMMARY_TABLE} WHERE `use_case_id` = :p0 "
                         f"ORDER BY `updated_at` DESC NULLS LAST LIMIT {shell_sql.CAPS['runs_rows']}")
    (sql, params), = sp.summary_reads(index=False)
    assert sql == (f"SELECT * FROM {SUMMARY_TABLE} WHERE `use_case_id` = :p0 AND CAST(`run_id` AS STRING) IN (SELECT explode(from_json(:p1, "
                   f"'ARRAY<STRING>'))) ORDER BY `updated_at` DESC NULLS LAST LIMIT 2")
    assert params[0]["value"] == "N01-U05" and json.loads(params[1]["value"]) == ["u4", "u3"]
    assert len(sp.state_reads()) == 1, "the table's runs come from the counts the latest run kept in its summary row, read once"
    assert all("INSERT" not in q.upper() and "MERGE" not in q.upper() for q, _p, _l in sp.sql)


def test_runs_come_newest_first_twenty_to_a_page_and_each_page_reads_only_its_own_details(tmp_path):
    sp = JobsWorkspace(summary=[summary_row(f"r{i:02d}", f"2026-09-{i + 1:02d}T06:00:00.000Z") for i in range(25)])
    s, _sp, _now = ops_shell(tmp_path, sp, settings=ops_settings(jobs={}))
    first = call(s, "GET", "runs", query={"page": "n01_u05"}, headers=signed(DANA))[1]
    assert (first["total"], first["offset"], first["limit"]) == (25, 0, 20)
    assert [r["run_id"] for r in first["runs"]] == [f"r{i:02d}" for i in range(24, 4, -1)]
    assert first["runs"][0]["started"] == "2026-09-25T06:00:00.000Z" and first["runs"][0]["status"] == "done"
    second = call(s, "GET", "runs", query={"page": "n01_u05", "offset": "20"}, headers=signed(DANA))[1]
    assert [r["run_id"] for r in second["runs"]] == ["r04", "r03", "r02", "r01", "r00"] and second["offset"] == 20
    assert [len(json.loads(p[1]["value"])) for _q, p in sp.summary_reads(index=False)] == [20, 5]
    beyond = call(s, "GET", "runs", query={"page": "n01_u05", "offset": "40"}, headers=signed(DANA))[1]
    assert beyond["runs"] == [] and beyond["total"] == 25 and len(sp.summary_reads(index=False)) == 2
    for bad in ("-1", "x", "1.5", "1" * 10, " 2 0"):
        status, out = call(s, "GET", "runs", query={"page": "n01_u05", "offset": bad}, headers=signed(DANA))
        assert status == 400 and "offset must be a whole number" in out["error"], bad


def test_runs_from_summaries_older_than_the_run_columns_show_what_they_hold_and_never_guess(tmp_path):
    older = summary_row("u3", "2026-10-25T06:05:00.000Z")
    oldest = {k: v for k, v in summary_row("u2", "2026-10-18T06:05:00.000Z").items() if k in ("use_case_id", "run_id", "summary", "updated_at")}
    s, _sp, _now = ops_shell(tmp_path, JobsWorkspace(runs=WEEKLY, summary=[older, oldest]), settings=ops_settings(jobs={}))
    status, out = call(s, "GET", "runs", query={"page": "n01_u05"}, headers=signed(DANA))
    assert status == 200 and out["errors"] == {}
    u3, u2, u1 = out["runs"]
    assert (u3["status"], u3["trigger"], u3["segments"], u3["tables"], u3["duration_s"]) == ("done", "", None, None, None)
    assert (u3["records"], u3["to_fix"], u3["could_save"], u3["started"]) == (40, 5, 1200.5, "2026-10-25T06:04:00.000Z")
    assert (u2["records"], u2["to_fix"], u2["could_save"], u2["summary"]) == (10, 10, None, "Run u2 found five records to fix."), \
        "a summary without counts falls back to the rows the run wrote"
    assert (u1["summary"], u1["records"]) == ("", 10)


def test_a_run_whose_end_is_not_recorded_and_whose_job_is_unknown_is_not_called_done(tmp_path):
    started = summary_row("u9", "2026-10-27T09:00:00.000Z", run_started_at="2026-10-27T09:00:00.000Z", run_ended_at=None, run_trigger="build")
    ended = summary_row("u8", "2026-10-26T09:10:00.000Z", run_started_at="2026-10-26T09:00:00.000Z", run_ended_at="2026-10-26T09:10:30.000Z")
    s, _sp, _now = ops_shell(tmp_path, JobsWorkspace(summary=[started, ended]), settings=ops_settings(jobs={}))
    u9, u8 = call(s, "GET", "runs", query={"page": "n01_u05"}, headers=signed(DANA))[1]["runs"]
    assert (u9["status"], u9["trigger"], u9["started"], u9["duration_s"]) == ("unfinished", "build", "2026-10-27T09:00:00.000Z", None)
    assert (u8["status"], u8["duration_s"]) == ("done", 630)


def test_runs_without_a_summary_table_or_with_a_refused_read_still_list_the_job_and_table_runs(tmp_path):
    jobs = JOB_HISTORY[:2]
    s, sp, _now = ops_shell(tmp_path, JobsWorkspace(job_runs=jobs, runs=WEEKLY[:1]))
    out = call(s, "GET", "runs", query={"page": "n01_u05"}, headers=signed(DANA))[1]
    assert out["errors"] == {} and [r["job_run_id"] for r in out["runs"]] == ["408", "407"] and out["runs"][1]["run_id"] == "u3"
    assert sp.summary_reads(index=False) == [], "an App built before run summaries has no summary table, and that is not an error"
    denied = shell_db.QueryError("PERMISSION_DENIED: User does not have SELECT on loss_desk_out_summary")
    (tmp_path / "denied").mkdir()
    s, _sp, _now = ops_shell(tmp_path / "denied", JobsWorkspace(job_runs=jobs, runs=WEEKLY[:1], summary=denied))
    status, out = call(s, "GET", "runs", query={"page": "n01_u05"}, headers=signed(DANA))
    assert status == 200 and out["errors"] == {"summary": str(denied)} and len(out["runs"]) == 2

    class DetailsDenied(JobsWorkspace):
        def summary_rows(self, sql, params, limit):
            if "AS `run_id`" not in sql:
                raise denied
            return super().summary_rows(sql, params, limit)

    (tmp_path / "details").mkdir()
    s, _sp, _now = ops_shell(tmp_path / "details", DetailsDenied(runs=WEEKLY[:1], summary=[summary_row("u3", "2026-10-25T06:05:00.000Z")]),
                             settings=ops_settings(jobs={}))
    status, out = call(s, "GET", "runs", query={"page": "n01_u05"}, headers=signed(DANA))
    assert status == 200 and out["errors"] == {"details": str(denied)}
    assert out["runs"][0]["run_id"] == "u3" and out["runs"][0]["records"] == 10 and out["runs"][0]["summary"] == ""


def test_runs_of_a_page_without_a_result_table_list_its_job_runs_and_read_no_table(tmp_path):
    plain = copy.deepcopy(PAGE)
    s, sp, _now = ops_shell(tmp_path, JobsWorkspace(job_runs=JOB_HISTORY[:2]), pages=[plain])
    status, out = call(s, "GET", "runs", query={"page": "n01_u05"}, headers=signed(DANA))
    assert status == 200 and [r["job_run_id"] for r in out["runs"]] == ["408", "407"] and out["errors"] == {}
    assert out["job"] == {"id": JOB, "url": JOB_URL, "error": ""} and sp.sql == []
    (tmp_path / "bare").mkdir()
    s, sp, _now = ops_shell(tmp_path / "bare", JobsWorkspace(), settings=ops_settings(jobs={}), pages=[plain])
    status, out = call(s, "GET", "runs", query={"page": "n01_u05"}, headers=signed(DANA))
    assert status == 200 and (out["runs"], out["total"], out["job"]) == ([], 0, None) and sp.sql == [] and sp.calls == []


def test_a_run_that_just_ended_shows_in_the_runs_within_seconds(tmp_path):
    sp = JobsWorkspace(summary=[summary_row("u1", "2026-10-26T06:05:00.000Z")])
    s, _sp, now = ops_shell(tmp_path, sp, settings=ops_settings(jobs={}))
    assert [r["run_id"] for r in call(s, "GET", "runs", query={"page": "n01_u05"}, headers=signed(DANA))[1]["runs"]] == ["u1"]
    sp.summary.append(summary_row("u2", "2026-10-27T09:29:00.000Z"))
    now[0] += shell_core.JOB_TTL_S + 1
    assert [r["run_id"] for r in call(s, "GET", "runs", query={"page": "n01_u05"}, headers=signed(DANA))[1]["runs"]] == ["u2", "u1"]


def test_the_run_history_always_reads_delta(tmp_path):
    s, _sp, _now = ops_shell(tmp_path, JobsWorkspace(runs=WEEKLY[:1], summary=[summary_row("u3", "2026-10-25T06:05:00.000Z")]))
    seen = []
    real = s.execute
    s.execute = lambda ws, sql, params, limit, delta=False, queued=False: (seen.append((SUMMARY_TABLE in sql and "AS `stamp_us`" not in sql, delta)), real(ws, sql, params, limit, delta, queued))[1]
    call(s, "GET", "runs", query={"page": "n01_u05"}, headers=signed(DANA))
    assert sorted(d for summary, d in seen if summary) == [True, True, True], "the index, the latest run's kept counts and the details"


def test_the_run_history_statements_parse_as_databricks_sql():
    sqlglot = pytest.importorskip("sqlglot")
    page = edit_page()
    for sql, _params in (shell_sql.summary_query(page, 5000, index=True), shell_sql.summary_query(page, 2, run_ids=["u1", "u2"])):
        sqlglot.parse_one(re.sub(r":p\d+", "'x'", sql), read="databricks")


def test_run_segments_and_tables_read_what_the_run_wrote_and_never_guess():
    page = edit_page()
    seg = shell_core.run_segments
    assert seg(page, "[]") == [] and seg(page, []) == [], "an empty list means the run covered all the data"
    for odd in (None, "", "not json", '{"column": "category"}', "7", '[{"values": ["x"]}]', '[{"column": "c", "values": "x"}]', '["Books"]'):
        assert seg(page, odd) is None, odd
    assert seg(page, '[{"column": "CATEGORY", "values": ["Books"]}, {"bad": 1}]') == [
        {"column": "CATEGORY", "label": "Category", "values": ["Books"], "more": 0}], "a filter names the column, whatever its case"
    assert seg(page, '[{"column": "store", "values": []}]') == [], "a segment with no values restricts nothing"
    big = seg(page, json.dumps([{"column": "store_id", "values": list(range(250))}]))[0]
    assert (big["label"], len(big["values"]), big["values"][:2], big["more"]) == ("Store id", shell_sql.CAPS["values"], ["0", "1"], 50)
    tables = shell_core.run_tables
    assert tables("[]") == [] and tables(None) is None and tables("{bad") is None and tables('[{"rows": 1}]') is None
    read = tables(json.dumps([{"table": " main.s.t ", "rows": True}, {"table": "main.s.u", "rows": -1, "updated_at": ""},
                              {"table": "main.s.v", "rows": 2.0}, {"table": "main.s.w", "rows": "x"}, {"table": ""}, "main.s.z"]))
    none = {"rows_total": None, "scoped": False, "updated_at": None}
    assert read == [dict(none, table="main.s.t", rows=None), dict(none, table="main.s.u", rows=None), dict(none, table="main.s.v", rows=2),
                    dict(none, table="main.s.w", rows=None)]
    scoped = tables(json.dumps([{"table": "main.s.t", "rows": 900, "rows_total": 48000, "scoped": True}, {"table": "main.s.u", "scoped": "yes"}]))
    assert [(t["rows"], t["rows_total"], t["scoped"]) for t in scoped] == [(900, 48000, True), (None, None, False)]
    assert seg(page, json.dumps([{"column": "category", "values": ["Books"]}, {"scope": "records", "key": "records:x", "records": 1000}])) == [
        {"column": "category", "label": "Category", "values": ["Books"], "more": 0}], "the First run scope is no segment of the run"


def test_a_run_says_what_started_it_and_how_it_ended_from_the_summary_first_then_the_job():
    def view(**kw):
        return shell_core.job_run_view(job_run(1, "2026-10-27T09:00:00Z", "2026-10-27T09:05:00Z", **kw), "")

    trigger, state = shell_core.run_trigger, shell_core.run_state
    assert [trigger(None, {"run_trigger": t}) for t in ("schedule", " Build ", "REFRESH", "nonsense", None)] == [
        "schedule", "build", "refresh", "", ""]
    assert trigger(view(by=DANA, trigger="ONE_TIME"), {}) == "refresh"
    assert trigger(view(), {}) == "schedule" and trigger(view(trigger="RETRY"), {}) == "retry"
    assert trigger(view(trigger="ONE_TIME", by=None), {"run_trigger": "build"}) == "build", "the run's own record wins"
    assert trigger(view(trigger="ONE_TIME", by=None), {}) == "manual"
    assert [state(view(result=r), {"run_ended_at": None}) for r in ("SUCCESS", "FAILED", "CANCELED", "MAXIMUM_CONCURRENT_RUNS_REACHED")] == [
        "done", "failed", "canceled", "skipped"]
    assert state(view(life="RUNNING"), {}) == "running" and state(view(life="QUEUED"), {}) == "queued"
    assert (state(None, {"run_ended_at": None}), state(None, {"run_ended_at": "2026-10-27T09:05:00Z"}), state(None, {})) == (
        "unfinished", "done", "done")


def test_a_run_shows_only_a_real_amount_it_could_save():
    def saved(stake):
        return shell_core.run_view(shell_core.blank_run("u1"), {"value_at_stake": stake}, edit_page())["could_save"]

    assert [saved(v) for v in (1250.5, 0, 7)] == [1250.5, 0, 7]
    for odd in (float("nan"), float("inf"), float("-inf"), True, "1250", None):
        assert saved(odd) is None, odd


def test_a_non_owner_sees_no_other_peoples_failed_or_canceled_runs_but_keeps_the_schedule_and_their_own(tmp_path):
    table = WEEKLY + [table_run("u0", "2026-10-04", "2026-10-04T06:00:00Z")]
    s, sp, _now = ops_shell(tmp_path, JobsWorkspace(job_runs=JOB_HISTORY, runs=table))
    status, out = call(s, "GET", "runs", query={"page": "n01_u05"}, headers=signed(LEE))
    assert status == 200, out
    shown = [r["job_run_id"] for r in out["runs"]]
    assert "408" not in shown and "406" not in shown, "a failed or canceled run that someone else started is for the owners only"
    assert {"407", "405", "404", "403"} <= set(shown), "the schedule's runs and a run that did not fail stay visible to a viewer"
    assert all(r["error"] == "" for r in out["runs"] if r["by"] not in ("", SAM, DANA)), "no other person's failure text reaches a viewer"
    status, owner = call(s, "GET", "runs", query={"page": "n01_u05"}, headers=signed(DANA))
    assert status == 200, owner
    assert {"408", "406"} <= {r["job_run_id"] for r in owner["runs"]}, "an owner still sees every failed run"
    assert out["total"] == owner["total"] - 2, "the total counts only the runs this viewer is shown"


def test_freshness_shows_a_non_owner_no_other_peoples_failed_run_as_the_last_run(tmp_path):
    runs = [job_run(103, "2026-10-27T08:00:00Z", "2026-10-27T08:02:00Z", result="FAILED", trigger="ONE_TIME", by=SAM, message="Table not found"),
            job_run(102, "2026-10-27T07:20:00Z", "2026-10-27T07:25:00Z", trigger="ONE_TIME", by=DANA),
            job_run(101, "2026-10-25T06:00:00Z", "2026-10-25T06:05:00Z")]
    s, sp, _now = ops_shell(tmp_path, JobsWorkspace(job_runs=runs, runs=WEEKLY))
    status, out = call(s, "GET", "freshness", query={"page": "n01_u05"}, headers=signed(LEE))
    assert status == 200, out
    assert out["last_run"]["run_id"] == "102", "the failed run of someone else is not the last run a non-owner sees"
    assert "Table not found" not in repr(out) and f"{JOB_URL}/runs/103" not in repr(out)
    assert out["last_success"]["run_id"] == "102"
