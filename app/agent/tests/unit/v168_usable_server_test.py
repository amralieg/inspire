"""The App server for a person who works a long decision list: a running refresh says which step it is on, how far it is and about
how long is left, read from the stage marks the use case's notebook writes; the list and the hub take a window of actions (this
hour, today, this week, this month, all open) and a top-N limit ranked by stake, with overdue records always shown and snoozed ones
back on their date; one act covers every record that matches the list's filters as of the moment the person loaded it, with a note
on any status and a batch id; batches can be listed and undone; and similar records are found by the page's own grouping columns.
The shapes are the ones tests/fixtures/app_usability_contract.json gives the web, on Delta and on a real Postgres, offline."""
import copy
import datetime
import json
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
from v141_app_shell_test import app_dir, call  # noqa: E402
from v142_edits_test import edit_page  # noqa: E402
from v144_app_data_test import DECIDE, EDITOR, PERSON, TRACKED, DataWorkspace, current  # noqa: E402
from v144_app_ops_test import JobsWorkspace, WEEKLY, job_run, ops_settings, summary_row  # noqa: E402
from v145_lakebase_test import PG_SCHEMA, create, postgres  # noqa: E402,F401
from v165_scale_test import HistoryWorkspace  # noqa: E402
from v120_artifacts_support import FakeSpark  # noqa: E402
from v130_genie_run_controls_test import _controls, _dbutils, _launcher  # noqa: E402

UTC = datetime.timezone.utc
NOW = datetime.datetime(2026, 10, 27, 9, 30, tzinfo=UTC)
CONTRACT = json.load(open(os.path.join(ROOT, "tests", "fixtures", "app_usability_contract.json"), encoding="utf-8"))
SUMMARY = "main.pricing.loss_desk_out_summary"
STAGES = ["Checking the settings", "Running the use case", "Writing the results", "Explaining the records", "Writing the summary"]


def us(stamp: datetime.datetime) -> int:
    return int(stamp.timestamp() * 1000000)


def shape(value):
    if isinstance(value, dict):
        return {k: shape(v) for k, v in value.items()}
    if isinstance(value, list):
        return [shape(value[0])] if value else []
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, int):
        return "int"
    return "null" if value is None else type(value).__name__


def same_shape(served, fixture):
    assert shape(served) == shape(fixture), json.dumps({"served": shape(served), "fixture": shape(fixture)}, indent=1)


def marker(index, at, rows_total=None, run=None, done=False, state=None, reason="", cancelled=False):
    return json.dumps({"run": us(run or datetime.datetime(2026, 10, 27, 9, 0, 30, tzinfo=UTC)), "index": index, "total": len(STAGES),
                       "stages": STAGES, "rows_done": 0 if rows_total else None, "rows_total": rows_total, "at": us(at),
                       "state": state or ("done" if done else "running"), "reason": reason, "cancelled": cancelled})


def stages_log(start: datetime.datetime, rows: int):
    marks, at = [], start
    for name, spent, total in zip(STAGES, (60, 600, 240, 600, 60), (None, None, rows, rows, None)):
        marks.append({"stage": name, "index": STAGES.index(name) + 1, "at": us(at), "rows_total": total})
        at += datetime.timedelta(seconds=spent)
    return json.dumps({"stages": marks, "ended": us(at)})


class MarkedJobs(JobsWorkspace):
    def __init__(self, properties=None, **kw):
        super().__init__(**kw)
        self.properties = properties or {}

    def table_properties(self, name):
        return self.properties.get(name)


def jobs_shell(tmp_path, sp, settings=None):
    s = shell_core.Shell(app_dir(tmp_path, settings or ops_settings(), [edit_page()]),
                         env={"DATABRICKS_WAREHOUSE_ID": "wh1", "DATABRICKS_HOST": "ws.example.com"},
                         sp_factory=lambda: sp, user_factory=lambda host, token: sp, clock=lambda: NOW.timestamp())
    return s


def running(stage=4, rows=900, at=None, run=None, history=True):
    runs = [job_run(301, "2026-10-27T09:00:00Z", life="RUNNING"),
            job_run(300, "2026-10-26T09:00:00Z", "2026-10-26T09:25:00Z"), job_run(299, "2026-10-25T09:00:00Z", "2026-10-25T09:25:00Z")]
    summary = [summary_row("r300", "2026-10-26T09:25:00Z", run_stages=stages_log(datetime.datetime(2026, 10, 26, 9, 0, 30, tzinfo=UTC), 600)),
               summary_row("r299", "2026-10-25T09:25:00Z", run_stages=stages_log(datetime.datetime(2026, 10, 25, 9, 0, 30, tzinfo=UTC), 600))]
    mark = marker(stage, at or NOW - datetime.timedelta(seconds=600), rows if stage in (3, 4) else None, run)
    return MarkedJobs(job_runs=runs, runs=WEEKLY, summary=summary if history else [], properties={SUMMARY: {shell_sql.STAGE_PROPERTY: mark}})


def test_a_running_refresh_says_its_step_rows_percent_and_time_left_from_the_steps_of_earlier_runs(tmp_path):
    s = jobs_shell(tmp_path, running())
    status, out = call(s, "GET", "freshness", query={"page": "n01_u05"}, headers={"x-forwarded-email": PERSON})
    assert status == 200, out
    fixture = CONTRACT["freshness"]["response"]
    same_shape(out["active"], fixture["active"])
    picked = {k: out["active"][k] for k in ("stage", "stage_index", "stage_total", "rows_done", "rows_total", "percent", "eta_s")}
    assert picked == {k: fixture["active"][k] for k in picked}, picked
    assert out["active"]["source"] == "job" and out["active"]["confirmed"] is True and out["typical_s"] == 1500


def test_the_hub_overview_carries_the_running_refresh_progress(tmp_path):
    sp = running()
    s = jobs_shell(tmp_path, sp)
    progress = s.run_progress(sp, "sp", edit_page())
    assert progress["stage"] == "Explaining the records" and progress["percent"] == 81 and progress["eta_s"] == 360
    s.settings["jobs"] = {}
    assert s.run_progress(sp, "sp", edit_page()) is None, "a page with no job of its own has no refresh to show"


def test_each_finished_run_says_how_long_each_step_took(tmp_path):
    sp = running()
    s = jobs_shell(tmp_path, sp)
    status, out = call(s, "GET", "runs", query={"page": "n01_u05"}, headers={"x-forwarded-email": PERSON})
    assert status == 200, out
    done = next(r for r in out["runs"] if r["stages"])
    same_shape(done["stages"][:1], CONTRACT["runs"]["run_fields"]["stages"][:1])
    assert [(t["stage"], t["spent_s"], t["rows_total"]) for t in done["stages"]] == [
        ("Checking the settings", 60, None), ("Running the use case", 600, None), ("Writing the results", 240, 600),
        ("Explaining the records", 600, 600), ("Writing the summary", 60, None)]
    assert shell_core.run_stage_times("not json") == [] and shell_core.run_stage_times(json.dumps({"stages": []})) == []
    assert shell_core.run_stage_times(json.dumps({"stages": [{"stage": "x", "at": 9}], "ended": 5})) == [], "a step that ends before it starts is dropped"


@pytest.mark.parametrize("elapsed, typical, eta", [(600, 1500, 900), (1600, 1500, None), (600, None, None)])
def test_without_step_timings_the_time_left_is_the_usual_run_minus_the_time_spent_and_never_made_up(elapsed, typical, eta):
    mark = shell_core.stage_marker({shell_sql.STAGE_PROPERTY: marker(2, NOW - datetime.timedelta(seconds=30))})
    view = shell_core.run_progress_view(mark, {}, us(NOW), us(NOW - datetime.timedelta(seconds=elapsed)), typical)
    assert (view["stage"], view["stage_index"], view["stage_total"], view["percent"], view["eta_s"]) == (
        "Running the use case", 2, 5, 20, eta)
    bare = shell_core.run_progress_view(None, {}, us(NOW), us(NOW - datetime.timedelta(seconds=elapsed)), typical)
    assert bare == {"stage": None, "stage_index": None, "stage_total": None, "rows_done": None, "rows_total": None, "percent": None,
                    "eta_s": eta, "silent_since": None}, "with no stage mark the App says only what the job's timing tells"


@pytest.mark.parametrize("raw", ["not json", json.dumps([1]), json.dumps({"run": 1, "at": 1, "index": 6, "total": 5, "stages": STAGES}),
                                 json.dumps({"run": 1, "at": 1, "index": 1, "total": 5, "stages": STAGES[:4]}),
                                 json.dumps({"run": -1, "at": 1, "index": 1, "total": 5, "stages": STAGES, "state": "running"}),
                                 json.dumps({"run": 1, "at": 1, "index": 1, "total": 5, "stages": STAGES}),
                                 json.dumps({"run": 1, "at": 1, "index": 1, "total": 5, "stages": STAGES, "state": "paused"})])
def test_a_marker_the_app_cannot_trust_is_ignored(raw):
    assert shell_core.stage_marker({shell_sql.STAGE_PROPERTY: raw}) is None


def test_a_marker_left_by_an_earlier_run_or_a_finished_run_shows_no_step(tmp_path):
    stale = running(run=datetime.datetime(2026, 10, 26, 9, 0, 30, tzinfo=UTC))
    s = jobs_shell(tmp_path, stale)
    active = call(s, "GET", "freshness", query={"page": "n01_u05"}, headers={"x-forwarded-email": PERSON})[1]["active"]
    assert active["run_id"] == "301" and active["stage"] is None and active["percent"] is None
    (tmp_path / "done").mkdir()
    finished = running()
    finished.properties[SUMMARY][shell_sql.STAGE_PROPERTY] = marker(5, NOW, done=True)
    active = call(jobs_shell(tmp_path / "done", finished), "GET", "freshness", query={"page": "n01_u05"},
                  headers={"x-forwarded-email": PERSON})[1]["active"]
    assert active["stage"] is None and active["eta_s"] is None


def test_an_app_inside_inspire_shows_the_step_unconfirmed_and_drops_it_after_the_job_timeout(tmp_path):
    sp = running(stage=2, history=False)
    inside = ops_settings(auth="user", host="inspire")
    viewer = {"x-forwarded-email": PERSON, "x-forwarded-access-token": "tok"}
    s = jobs_shell(tmp_path, sp, inside)
    assert s.inside is True
    out = call(s, "GET", "freshness", query={"page": "n01_u05"}, headers=viewer)[1]
    same_shape(out["active"], CONTRACT["freshness"]["inside_active"])
    assert out["active"] == dict(CONTRACT["freshness"]["inside_active"], started="2026-10-27T09:00:30Z")
    assert out["reason"] == shell_core.USER_JOBS and out["can_refresh"] is False
    assert [c for c in sp.calls if c[0] in ("list", "get-run")] == [], "an App inside Inspire never reads the job"
    old = NOW - datetime.timedelta(seconds=shell_core.RUN_TIMEOUT_S + 60)
    sp.properties[SUMMARY][shell_sql.STAGE_PROPERTY] = marker(2, old, run=old)
    (tmp_path / "old").mkdir()
    late = jobs_shell(tmp_path / "old", sp, inside)
    assert call(late, "GET", "freshness", query={"page": "n01_u05"}, headers=viewer)[1]["active"] is None


def inside_shell(tmp_path, sp):
    return jobs_shell(tmp_path, sp, ops_settings(auth="user", host="inspire")), {"x-forwarded-email": PERSON, "x-forwarded-access-token": "tok"}


def freshness_of(s, headers=None):
    return call(s, "GET", "freshness", query={"page": "n01_u05"}, headers=headers or {"x-forwarded-email": PERSON})[1]


@pytest.mark.parametrize("state, reason, cancelled, result", [
    ("stopped", "The run stopped on RuntimeError: the model step failed", False, "failed"),
    ("stopped", "The run was cancelled.", True, "canceled"),
    ("done", "", False, "succeeded")])
def test_a_run_that_stopped_or_finished_never_shows_as_running_and_inside_inspire_says_how_it_ended(tmp_path, state, reason, cancelled,
                                                                                                 result):
    sp = running(stage=2)
    ended = datetime.datetime(2026, 10, 27, 9, 12, tzinfo=UTC)
    sp.properties[SUMMARY][shell_sql.STAGE_PROPERTY] = marker(2 if state == "stopped" else 5, ended, state=state, reason=reason,
                                                              cancelled=cancelled)
    s, viewer = inside_shell(tmp_path, sp)
    out = freshness_of(s, viewer)
    assert out["active"] is None, "a run that wrote its last mark is never shown running"
    same_shape(out["last_run"], CONTRACT["freshness"]["inside_last_run"])
    assert (out["last_run"]["state"], out["last_run"]["result"], out["last_run"]["message"], out["last_run"]["duration_s"]) == (
        state, result, reason, 690)
    if state == "stopped" and not cancelled:
        assert out["last_run"] == CONTRACT["freshness"]["inside_last_run"]
    (tmp_path / "job").mkdir()
    confirmed = freshness_of(jobs_shell(tmp_path / "job", sp))["active"]
    assert confirmed["state"] == "running" and confirmed["stage"] is None and confirmed["percent"] is None, \
        "a job still finishing after its last mark shows no step and no percent"


@pytest.mark.parametrize("quiet_s, silent", [(1100, False), (1199, False), (1201, True), (3000, True)])
def test_a_run_whose_marks_stop_has_no_news_once_its_step_runs_past_twice_the_longest_earlier_run_of_it(tmp_path, quiet_s, silent):
    sp = running(stage=2, at=NOW - datetime.timedelta(seconds=quiet_s))
    s, viewer = inside_shell(tmp_path, sp)
    active = freshness_of(s, viewer)["active"]
    assert active["stage"] == "Running the use case" and active["stage_index"] == 2
    if silent:
        mark = NOW - datetime.timedelta(seconds=quiet_s)
        assert (active["state"], active["result"], active["percent"], active["eta_s"]) == ("silent", "unknown", None, None)
        assert active["silent_since"] == mark.strftime("%Y-%m-%dT%H:%M:%SZ")
        assert active["message"] == f"No news from this run since {mark:%H:%M} UTC. It may have stopped."
    else:
        assert (active["state"], active["result"], active["silent_since"], active["message"]) == ("running", "running", None, ""), \
            "a slow step inside twice its longest earlier run is still running"
        assert active["percent"] is not None and active["eta_s"] is not None
    (tmp_path / "job").mkdir()
    confirmed = freshness_of(jobs_shell(tmp_path / "job", sp))["active"]
    assert confirmed["state"] == "running" and confirmed["confirmed"] is True, "the job's own state stays the job's"
    assert (confirmed["percent"] is None) is silent and (confirmed["message"].startswith("No news from this run since")) is silent


def test_the_silent_contract_example_is_what_the_app_serves(tmp_path):
    sp = running(stage=2, at=NOW - datetime.timedelta(seconds=1300))
    s, viewer = inside_shell(tmp_path, sp)
    assert freshness_of(s, viewer)["active"] == CONTRACT["freshness"]["silent_active"]


def test_the_no_news_bound_is_twice_the_longest_earlier_step_then_the_usual_run_then_an_hour_and_never_under_two_minutes():
    history = {"Running the use case": [(600, None), (450, None)], "Checking the settings": [(10, None)]}
    assert shell_core.silence_bound_s(history, "Running the use case", 900) == 1200
    assert shell_core.silence_bound_s(history, "Writing the results", 900) == 900
    assert shell_core.silence_bound_s({}, "Writing the results", None) == shell_core.SILENT_DEFAULT_S == 3600
    assert shell_core.silence_bound_s(history, "Checking the settings", 900) == shell_core.SILENT_FLOOR_S == 120, \
        "a step that took seconds still waits out the 15 s the App holds a table's properties"
    rows = [{"run_stages": stages_log(datetime.datetime(2026, 10, 26, 9, tzinfo=UTC), 600)},
            {"run_stages": stages_log(datetime.datetime(2026, 10, 25, 9, tzinfo=UTC), 600)}, {"run_stages": "not json"}]
    assert shell_core.usual_run_s(rows) == 1560 and shell_core.usual_run_s([]) is None


def test_without_step_history_inside_inspire_the_usual_run_bounds_the_silence_and_without_either_an_hour_does(tmp_path):
    for quiet_s, history, state in ((1500, True, "running"), (1300, False, "running"), (3500, False, "running"), (3700, False, "silent")):
        sp = running(stage=2, at=NOW - datetime.timedelta(seconds=quiet_s), history=history)
        if history:
            sp.summary = [summary_row("r300", "2026-10-26T09:25:00Z", run_stages=json.dumps({"stages": [
                {"stage": "Checking the settings", "index": 1, "at": 0, "rows_total": None}], "ended": 1600 * 1000000}))]
        folder = tmp_path / f"{quiet_s}_{history}"
        folder.mkdir()
        s, viewer = inside_shell(folder, sp)
        assert freshness_of(s, viewer)["active"]["state"] == state, (quiet_s, history)


def test_a_lost_run_past_the_job_timeout_is_no_longer_active_and_inside_inspire_says_there_was_no_news(tmp_path):
    started = NOW - datetime.timedelta(seconds=shell_core.RUN_TIMEOUT_S + 60)
    sp = running(stage=3, at=started + datetime.timedelta(seconds=90), run=started)
    s, viewer = inside_shell(tmp_path, sp)
    out = freshness_of(s, viewer)
    assert out["active"] is None
    assert (out["last_run"]["state"], out["last_run"]["result"], out["last_run"]["ended"]) == ("lost", "unknown", None)
    assert out["last_run"]["message"] == f"No news from this run since {started + datetime.timedelta(seconds=90):%H:%M} UTC. It may have stopped."
    yesterday = NOW - datetime.timedelta(days=1)
    sp.properties[SUMMARY][shell_sql.STAGE_PROPERTY] = marker(3, yesterday, run=yesterday)
    (tmp_path / "day").mkdir()
    s, viewer = inside_shell(tmp_path / "day", sp)
    assert freshness_of(s, viewer)["last_run"]["message"] == f"No news from this run since Oct 26 at {yesterday:%H:%M} UTC. It may have stopped."


def _stage_marks(spark):
    marks = []
    for statement in spark.statements:
        if "'inspire.run_stage' = '" in statement:
            marks.append(json.loads(statement.split("'inspire.run_stage' = '", 1)[1][:-2].replace("\\'", "'")))
    return marks


def _main_run(agent_ns, use_case, fail_marks=False):
    ns, _call = _controls(agent_ns)
    child = agent_ns["INSPIRE_CHILD_MARKER"]

    def respond(statement):
        if fail_marks and "'inspire.run_stage'" in statement and '"state": "running"' not in statement:
            raise RuntimeError("PERMISSION_DENIED: cannot alter the summary")
        return []

    spark = FakeSpark(responder=respond)
    ns["spark"] = spark
    dbu = _dbutils(**{child: "1", "refresh_requested_by": "schedule", "result_table": "main.inspire.n01_u01_churn_out"})
    dbu.notebook.exit = dbu.notebook.exits.append
    ns["dbutils"] = dbu
    ns["run_use_case"] = use_case
    launcher, _calls = _launcher(ns)
    printed = []
    return ns, spark, printed, lambda: ns["inspire_main"](dbu=dbu, launcher_cls=launcher, out=printed.append)


@pytest.mark.parametrize("raised, reason, cancelled", [
    (RuntimeError("the model step failed\nat line 7"), "The run stopped on RuntimeError: the model step failed", False),
    (KeyboardInterrupt(), "The run was cancelled.", True)])
def test_a_run_that_fails_or_is_cancelled_writes_a_stopped_mark_with_its_reason_and_still_raises(agent_ns, raised, reason, cancelled):
    def use_case():
        raise raised

    ns, spark, printed, run = _main_run(agent_ns, use_case)
    with pytest.raises(type(raised)):
        run()
    marks = _stage_marks(spark)
    assert [(m["index"], m["state"]) for m in marks] == [(1, "running"), (2, "running"), (2, "stopped")]
    assert (marks[-1]["reason"], marks[-1]["cancelled"]) == (reason, cancelled)
    assert not any(s.startswith("MERGE INTO") and "`run_stages`" in s for s in spark.statements), \
        "a stopped run's step timings never feed the time left of later runs"
    assert "INSPIRE_RUN_LOG" not in ns


def test_a_run_that_succeeds_writes_a_done_mark_after_its_outcome_and_keeps_its_step_timings(agent_ns):
    ns, spark, printed, run = _main_run(agent_ns, lambda: ns["INSPIRE_RUN_LOG"]["written"].append(
        ("main.inspire.n01_u01_churn_out", "N01-U01", "r-7")) or {"status": "written", "rows_written": 3, "as_of_date": "2026-10-01",
                                                                 "run_id": "r-7"})
    run()
    marks = _stage_marks(spark)
    assert [(m["index"], m["state"], m["reason"]) for m in marks] == [(1, "running", ""), (2, "running", ""), (5, "done", "")]
    assert any(s.startswith("MERGE INTO") and "`run_stages`" in s and "Running the use case" in s for s in spark.statements)
    assert any(p.startswith("Use case outcome: ") for p in printed)


def test_a_stopped_mark_that_cannot_be_written_is_printed_and_the_run_s_own_error_still_raises(agent_ns):
    def use_case():
        raise ValueError("bad column zone_id")

    ns, spark, printed, run = _main_run(agent_ns, use_case, fail_marks=True)
    with pytest.raises(ValueError, match="bad column zone_id"):
        run()
    assert any(p.startswith("Run progress: Inspire could not record that this run stopped for the App") and "PERMISSION_DENIED" in p
               for p in printed)
    assert [m["state"] for m in _stage_marks(spark)] == ["running", "running", "stopped"], "the stopped mark is tried once, and only once"


def test_the_app_and_the_notebook_name_the_same_stage_property_and_steps(agent_ns):
    assert agent_ns["INSPIRE_RUN_STAGE_PROPERTY"] == shell_sql.STAGE_PROPERTY
    assert ("running",) + tuple(agent_ns["INSPIRE_RUN_ENDS"]) == shell_sql.STAGE_STATES
    assert agent_ns["INSPIRE_RUN_REASON_CHARS"] == shell_sql.STAGE_REASON_CHARS
    assert list(agent_ns["INSPIRE_RUN_STAGES"]) == STAGES and len(STAGES) <= shell_sql.STAGES_MAX
    assert ("run_stages", "STRING") in agent_ns["INSPIRE_RUN_LOG_COLUMNS"]
    assert "timeout_seconds=14400" in agent_ns["DatabricksInspire"]._JOB_LAUNCHER_CLASS_SOURCE and shell_core.RUN_TIMEOUT_S == 14400


class StageSpark:
    def __init__(self, fail=False):
        self.sql, self.fail = [], fail

    def __call__(self, text):
        self.sql.append(text)
        if self.fail and "TBLPROPERTIES" in text:
            raise RuntimeError("PERMISSION_DENIED: cannot alter")
        return _Rows([])


class _Rows:
    def __init__(self, rows):
        self._rows = rows

    def collect(self):
        return self._rows


def _spark(fail=False):
    holder = type("S", (), {})()
    recorder = StageSpark(fail)
    holder.sql = recorder
    return holder, recorder


def test_the_notebook_marks_each_step_once_on_the_summary_table_and_a_failed_mark_never_stops_the_run(fresh_ns, monkeypatch):
    spark, seen = _spark()
    monkeypatch.setitem(fresh_ns, "spark", spark)
    monkeypatch.setitem(fresh_ns, "inspire_ensure_summary", lambda session, table: seen.sql.append(f"ENSURE {table}"))
    printed = []
    log = fresh_ns["inspire_run_log_start"]("child", "main.pricing.loss_desk_out")
    first = fresh_ns["inspire_run_stage"]("Writing the results", rows_done=0, rows_total=42, out=printed.append)
    again = fresh_ns["inspire_run_stage"]("Writing the results", rows_done=0, rows_total=42, out=printed.append)
    assert first["index"] == 3 and first["total"] == 5 and first["rows_total"] == 42 and again is None
    altered = [t for t in seen.sql if "TBLPROPERTIES" in t]
    assert len(altered) == 1 and altered[0].startswith("ALTER TABLE `main`.`pricing`.`loss_desk_out_summary` SET TBLPROPERTIES ('inspire.run_stage' = '")
    assert seen.sql[0] == "ENSURE main.pricing.loss_desk_out", "the summary table exists before its first mark"
    assert fresh_ns["inspire_run_stage"]("Not a step", out=printed.append) is None
    log["written"].append(("main.pricing.loss_desk_out", "N01-U05", "r1"))
    fresh_ns["inspire_run_log_end"](log, out=printed.append)
    done = [t for t in seen.sql if "TBLPROPERTIES" in t][-1]
    assert '"state": "done"' in done and '"reason": ""' in done
    merged = next(t for t in seen.sql if t.startswith("MERGE INTO") and "run_stages" in t)
    assert "run_ended_at" in merged and "Writing the results" in merged
    failing, _ = _spark(fail=True)
    monkeypatch.setitem(fresh_ns, "spark", failing)
    fresh_ns["inspire_run_log_start"]("child", "main.pricing.loss_desk_out")
    assert fresh_ns["inspire_run_stage"]("Checking the settings", out=printed.append) is None
    assert any(p.startswith("Run progress: Inspire could not record step 1 of 5 for the App") and "the run goes on" in p for p in printed)


def test_the_run_cell_marks_the_settings_and_use_case_steps_and_the_helpers_mark_the_rest(agent_ns):
    template = agent_ns["GENIE_RUN_CONTROLS_TEMPLATE"]
    order = [template.index(t) for t in ("inspire_run_stage(INSPIRE_RUN_STAGES[0]", "inspire_apply_assumptions(",
                                         "inspire_run_stage(INSPIRE_RUN_STAGES[1]", "outcome = use_case()")]
    assert order == sorted(order)
    source = agent_ns["IMPLEMENT_RESULT_HISTORY_SOURCE"]
    for name, index in (("inspire_merge_run", 2), ("inspire_ai_explain", 3), ("inspire_write_summary", 4)):
        body = source[source.index(f"def {name}("):]
        body = body[:body.index("\ndef ", 10)]
        assert f"inspire_run_stage(INSPIRE_RUN_STAGES[{index}]" in body, name
    assert "sparkContext" not in source and ".cache()" not in source and ".persist(" not in source


def test_every_window_starts_and_ends_where_the_person_lives():
    bounds = shell_sql.window_bounds
    assert bounds("all", NOW) == {"window": "all", "today": "2026-10-27"}
    assert bounds("today", NOW) == {"window": "today", "today": "2026-10-27", "start_day": "2026-10-27", "end_day": "2026-10-28",
                                    "start_us": us(datetime.datetime(2026, 10, 27, tzinfo=UTC)),
                                    "end_us": us(datetime.datetime(2026, 10, 28, tzinfo=UTC))}
    dubai = bounds("today", datetime.datetime(2026, 10, 27, 21, 30, tzinfo=UTC), shell_sql.time_zone_of({"time_zone": "Asia/Dubai"})[0])
    assert dubai["today"] == "2026-10-28" and dubai["start_us"] == us(datetime.datetime(2026, 10, 27, 20, tzinfo=UTC))
    hour = bounds("hour", NOW)
    assert (hour["start_day"], hour["end_day"]) == ("2026-10-27", "2026-10-28")
    assert (hour["start_us"], hour["end_us"]) == (us(NOW.replace(minute=0)), us(NOW.replace(minute=0) + datetime.timedelta(hours=1)))
    week = bounds("week", NOW)
    assert (week["start_day"], week["end_day"]) == ("2026-10-26", "2026-11-02")
    month = bounds("month", NOW)
    assert (month["start_day"], month["end_day"]) == ("2026-10-01", "2026-11-01")


def usable_shell(tmp_path, ws, settings=None, pages=None):
    return shell_core.Shell(app_dir(tmp_path, settings or DECIDE, pages or [edit_page(similar_by=["category"])]),
                            env={"DATABRICKS_WAREHOUSE_ID": "wh1", "DATABRICKS_HOST": "dbc-1.example.com"},
                            sp_factory=lambda: ws, user_factory=lambda host, token: ws, clock=lambda: NOW.timestamp())


LOADED = "1973-07-01T00:00:00Z"
HISTORY = [{"version": 42, "operation": "MERGE", "timestamp": "2026-10-27T09:00:00Z"}, {"version": 41, "operation": "MERGE", "timestamp": LOADED}]


class UsableWorkspace(DataWorkspace):
    def __init__(self, matched=3, conflicts=None, batches=None, batch_records=None, similar=None, history=None, **kw):
        super().__init__(**kw)
        self.matched, self.conflict_rows, self.batch_rows = matched, conflicts or [], batches or []
        self.batch_record_rows, self.similar_value = batch_records or [], similar
        self.history, self.history_reads = HISTORY if history is None else history, []

    def table_history(self, warehouse, name, limit=20):
        self.history_reads.append((name, limit))
        if isinstance(self.history, Exception):
            raise self.history
        return self.history

    def answer(self, sql, params):
        if "COUNT(DISTINCT `_inspire_key`) AS total" in sql:
            return {"columns": [], "rows": [{"total": self.matched}], "truncated": False}
        if "AS `_inspire_n` FROM `main`.`pricing`.`loss_desk_out` AS b JOIN" in sql:
            return {"columns": [], "rows": self.conflict_rows, "truncated": False}
        if sql.startswith("SELECT b.`action_batch` AS `batch_id`"):
            return {"columns": [], "rows": self.batch_rows, "truncated": False}
        if "AS `_inspire_done`" in sql:
            return {"columns": [], "rows": self.batch_record_rows, "truncated": False}
        if "SELECT CAST(d.`category` AS STRING) AS `category`" in sql:
            return {"columns": [], "rows": [] if self.similar_value is None else [{"category": self.similar_value}], "truncated": False}
        if "NOT IN (SELECT explode(from_json(" in sql and "MERGE INTO" not in sql:
            if " OFFSET " in sql:
                return {"columns": [], "rows": self.rows, "truncated": False}
            if "AS total FROM (SELECT 1 FROM f LIMIT" in sql:
                return {"columns": [], "rows": [{"total": self.total}], "truncated": False}
        return super().answer(sql, params)


class RunFactsWorkspace(UsableWorkspace):
    def answer(self, sql, params):
        from v166_run_facts_test import _ready_facts
        if sql.startswith(f"SELECT * FROM {shell_sql.table_name(SUMMARY)}"):
            return {"columns": [], "rows": [{"run_id": "r5", "updated_at": "2026-10-27T06:10:00Z",
                                             shell_sql.RUN_FACTS_COLUMN: json.dumps(_ready_facts())}], "truncated": False}
        if sql.startswith("SELECT COUNT(*) AS `n`, unix_micros(GREATEST("):
            return {"columns": [], "rows": [{"n": 0, "us": None, "keys": "[]"}], "truncated": False}
        return super().answer(sql, params)


def post(s, path, body, headers=EDITOR):
    return call(s, "POST", path, headers=headers, body=dict({"page": "n01_u05"}, **body))


@pytest.mark.parametrize("body, fragment", [
    ({"window": "year"}, CONTRACT["errors"]["bad_window"]["body"]["error"]),
    ({"window": "today", "window_limit": 0}, "window_limit must be a whole number from 1 to 1000"),
    ({"window": "today", "window_limit": 1001}, "window_limit must be a whole number from 1 to 1000"),
    ({"window": "today", "window_limit": "5"}, "window_limit must be a whole number from 1 to 1000"),
    ({"window_limit": 5}, "window_limit goes with a window"),
    ({"window": "today", "utc_offset_min": 900}, shell_sql.FIXED_OFFSET_GONE),
    ({"exclude": ["k"] * 51}, "exclude takes a list of at most 50 record keys"),
])
def test_a_bad_window_is_refused_with_400_before_any_list_query(tmp_path, body, fragment):
    ws = UsableWorkspace()
    s = usable_shell(tmp_path, ws)
    status, out = post(s, "records", body)
    assert status == 400 and fragment in out["error"], out
    assert ws.queries(" OFFSET ") == []
    if "window" in body and body["window"] == "year":
        status, out = post(s, "overview", {k: v for k, v in body.items()})
        assert status == 400


@pytest.mark.parametrize("path, body", [
    ("records", {"window": "today", "utc_offset_min": 240}),
    ("records", {"window": "today", "utc_offset_min": 240, "time_zone": "Asia/Dubai"}),
    ("overview", {"window": "week", "utc_offset_min": 0}),
])
def test_a_fixed_utc_offset_is_refused_with_the_time_zone_to_send_instead(tmp_path, path, body):
    ws = UsableWorkspace()
    s = usable_shell(tmp_path, ws)
    status, out = post(s, path, body)
    assert (status, out["error"]) == (400, shell_sql.FIXED_OFFSET_GONE), out
    assert ws.queries(" OFFSET ") == [] and "utc_offset_min" not in shell_core.MATCH_VIEW and "utc_offset_min" not in shell_sql.CAPS
    status, out = post(s, "records", {"window": "today", "time_zone": "Asia/Dubai"})
    assert status == 200, out


def test_a_window_on_a_list_that_keeps_no_actions_is_refused(tmp_path):
    ws = UsableWorkspace()
    s = usable_shell(tmp_path, ws, dict(DECIDE, options=dict(DECIDE["options"], decisions=False)))
    status, out = post(s, "records", {"window": "today"})
    assert status == 400 and out["error"] == "this decision list keeps no actions, so it has no window of actions to show"


def test_the_delta_list_ranks_its_window_by_stake_with_the_bounds_as_parameters(tmp_path):
    ws = UsableWorkspace(total=3)
    s = usable_shell(tmp_path, ws)
    body = CONTRACT["records_window"]["request"]["body"]
    status, out = post(s, "records", {k: v for k, v in body.items() if k != "page"})
    assert status == 200, out
    fields = CONTRACT["records_window"]["response_fields"]
    same_shape({k: out[k] for k in fields}, fields)
    assert out["sort"] == fields["sort"] and out["window"] == fields["window"]
    assert out["as_of_us"] == str(us(NOW) - shell_pg.CLOCK_SKEW_S * 1000000)
    (rows, params), (total, total_params) = ws.queries(" OFFSET ")[-1], ws.queries("AS total FROM (SELECT 1 FROM f LIMIT")[-1]
    for text in (rows, total):
        assert "COALESCE(c.`_inspire_status`, 'New') IN ('New', 'In progress')" in text
        assert "(c.`_inspire_snooze` IS NULL OR c.`_inspire_snooze` <= :p0)" in text
        assert "unix_micros(c.`_inspire_joined`) >= :p3" in text
    assert re.search(r"w AS \(SELECT \* FROM f ORDER BY .+ DESC NULLS LAST, CASE WHEN `_inspire_due` < :p0 THEN 0 ELSE 1 END ASC, "
                     r"`_inspire_due` ASC NULLS LAST, `record_key` ASC LIMIT 25\)", rows)
    by = {p["name"]: p for p in params}
    start = datetime.datetime(2026, 10, 26, 20, tzinfo=UTC)
    assert by["p0"] == {"name": "p0", "value": "2026-10-27", "type": "DATE"}
    assert (by["p3"]["value"], by["p3"]["type"]) == (str(us(start)), "BIGINT")
    assert total_params == params[:len(total_params)]


def test_the_hub_takes_the_same_window_and_limit(tmp_path):
    ws = UsableWorkspace()
    s = usable_shell(tmp_path, ws)
    body = CONTRACT["overview_window"]["request"]["body"]
    status, out = call(s, "POST", "overview", headers=EDITOR, body=body)
    assert status == 200, out
    same_shape({k: out[k] for k in CONTRACT["overview_window"]["response_fields"]}, CONTRACT["overview_window"]["response_fields"])
    assert out["window"] == {"window": "week", "limit": 10, "today": "2026-10-27"}
    view = out["pages"]["n01_u05"]
    assert "window_note" not in view and view["runs"]["active"] is None, "the hub reads each page's run progress, none without a job"
    sql = next(q for q, _p, _l in ws.sql if "'item' AS `kind`" in q)
    assert "LIMIT 10)" in sql and "CASE WHEN `day` <" in sql and "c.`_inspire_snooze`" in sql


def test_a_snooze_date_must_be_after_today_and_within_a_year_and_a_status_change_ends_it():
    today = NOW.date()
    for raw, fragment in (("2026-10-27", "after today (2026-10-27)"), ("2027-10-28", "at most 365 days ahead (2027-10-27)"),
                          ("next week", "snooze_until takes a date as YYYY-MM-DD"), (7, "snooze_until takes a date as YYYY-MM-DD")):
        with pytest.raises(ValueError, match=re.escape(fragment)):
            shell_sql.action_values({"snooze_until": raw}, today)
    assert shell_sql.action_values({"snooze_until": " 2026-11-03 "}, today) == {"snooze_until": "2026-11-03"}
    assert shell_sql.action_values({"action_status": "In progress"}, today)["snooze_until"] is None
    assert "snooze_until" not in shell_sql.action_values({"action_owner": "x"}, today), "assigning an owner keeps the snooze"


def test_a_note_goes_with_any_status_and_is_bounded(tmp_path):
    ws = UsableWorkspace()
    s = usable_shell(tmp_path, ws)
    body = CONTRACT["act_keys"]["request"]["body"]
    status, out = post(s, "records/act", {k: v for k, v in body.items() if k != "page"})
    assert status == 200, out
    same_shape(out, CONTRACT["act_keys"]["response"])
    (sql, params), = ws.queries("MERGE INTO")
    assert "Called the store" in [p["value"] for p in params] and "Called the store" not in sql
    assert re.search(r":p\d+ AS `action_batch_note`", sql) and json.loads(next(
        p["value"] for p in params if str(p["value"]).startswith("{"))) == {"action_status": "In progress"}
    status, out = post(s, "records/act", dict({k: v for k, v in body.items() if k != "page"}, values={"note": "x" * 501}))
    assert status == 400 and out["error"] == "note takes at most 500 characters"


def match_body(**changes):
    body = copy.deepcopy(CONTRACT["act_match"]["request"]["body"])
    body.pop("page")
    body.update(changes)
    return body


def test_one_act_covers_every_record_the_filters_match_as_of_the_load_in_one_statement(tmp_path):
    conflict = dict(current("k3", "edit", "sam"), held_back=False, _inspire_n=1)
    ws = UsableWorkspace(matched=3, conflicts=[conflict], inserted=2, columns=TRACKED + [{"name": "held_back", "type": "BOOLEAN"}])
    s = usable_shell(tmp_path, ws)
    status, out = post(s, "records/act", match_body())
    assert status == 200, out
    same_shape(out, CONTRACT["act_match"]["response"])
    assert (out["written"], out["matched"], out["conflicts_count"]) == (2, 3, 1) and re.fullmatch(r"[0-9a-f]{32}", out["batch_id"])
    assert out["conflicts"][0]["record_key"] == "k3" and out["conflicts"][0]["error"].startswith("sam changed this record")
    assert [r for r in ws.history_reads if r[1] == shell_sql.CAPS["act_history"]] == [("main.pricing.loss_desk_out", shell_sql.CAPS["act_history"])]
    (sql, params), = ws.queries("MERGE INTO")
    assert sql.count("JOIN (WITH d AS (SELECT * FROM (") == 2, "the write reads the same filtered list the person saw, as one set"
    assert ("JOIN `main`.`pricing`.`loss_desk_out` VERSION AS OF 41 AS a ON a.`record_key` = b.`record_key` AND a.`valid_from` = "
            "b.`valid_from` AND a.`is_current` WHERE b.`is_current` AND b.`change_source` <> 'delete' AND NOT "
            "COALESCE(b.`held_back`, FALSE)") in sql, "a record acts only when its current version is the one the table held at the load"
    assert "unix_micros(b.`valid_from`)" not in sql
    assert "CAST(`category` AS STRING) IN (" in sql and "explode(from_json(" not in sql.split("JOIN (WITH")[0]
    assert len(ws.queries("SELECT inline(from_json(")) == 0, "a match never sends record keys"
    (conflicts, _params), = ws.queries("AS `_inspire_n` FROM")
    assert "WHERE b.`is_current` AND NOT (b.`action_batch` <=> :p" in conflicts and "VERSION AS OF" not in conflicts


def test_a_match_acts_on_the_table_version_the_list_was_read_at_or_is_refused(tmp_path):
    body = match_body()
    loaded = int(body["match"]["as_of_us"])
    for history, status, fragment in (
            ([{"version": 7, "timestamp": "2026-10-27T09:00:00Z"}, {"version": 6, "timestamp": "2026-10-27T08:00:00Z"}], 409,
             CONTRACT["errors"]["stale_list"]["body"]["error"]),
            ([], 409, "the App found no history of main.pricing.loss_desk_out"),
            ([{"version": 3, "timestamp": "not a time"}], 409, "or the App cannot tell when"),
            (shell_core.QueryError("PERMISSION_DENIED: no history"), 502, "could not read the history of main.pricing.loss_desk_out")):
        (tmp_path / str(len(fragment))).mkdir(exist_ok=True)
        ws = UsableWorkspace(history=history)
        s = usable_shell(tmp_path / str(len(fragment)), ws)
        got, out = post(s, "records/act", body)
        assert got == status and fragment in out["error"], out
        assert ws.queries("MERGE INTO") == [] and ws.queries("AS total") == [], "no count and no write without the version"
    (tmp_path / "zero").mkdir()
    ws = UsableWorkspace()
    s = usable_shell(tmp_path / "zero", ws)
    got, out = post(s, "records/act", match_body(match=dict(body["match"], as_of_us="0")))
    assert got == 409 and out["error"] == CONTRACT["errors"]["unknown_copy"]["body"]["error"]
    got, out = post(s, "records/act", match_body(match=dict(body["match"], as_of_us=str(us(NOW) + 60 * 1000000))))
    assert got == 400 and out["error"] == "match as_of_us is later than now; send the as_of_us the list gave you"
    exact = [{"version": 9, "timestamp": loaded // 1000}, {"version": 8, "timestamp": LOADED}, {"version": 10, "timestamp": "2026-10-27T09:00:00Z"}]
    assert s.as_of_version(UsableWorkspace(history=exact), s.by_id["n01_u05"], loaded) == 9, \
        "the newest version committed at or before the load, read from text or milliseconds"
    (tmp_path / "blind").mkdir()
    blind = UsableWorkspace()
    blind.table_history = None
    got, out = post(usable_shell(tmp_path / "blind", blind), "records/act", body)
    assert got == 409 and "cannot read the history" in out["error"] and blind.queries("MERGE INTO") == []


def test_the_history_timestamp_the_statement_api_returns_is_read_as_utc_and_picks_the_version_committed_by_the_load(tmp_path):
    rows = [{"version": "246", "operation": "MERGE", "timestamp": "2026-10-27T09:04:05.000Z", "operationParameters": {}},
            {"version": "245", "operation": "WRITE", "timestamp": "2026-10-27T08:59:59.000Z"}]
    ws = HistoryWorkspace(rows)
    history = ws.table_history("wh1", "main.pricing.loss_desk_out", shell_sql.CAPS["act_history"])
    assert ws.asked == [("wh1", "DESCRIBE HISTORY `main`.`pricing`.`loss_desk_out` LIMIT 200", 200)]
    assert history == [{"version": 246, "operation": "MERGE", "timestamp": "2026-10-27T09:04:05.000Z"},
                       {"version": 245, "operation": "WRITE", "timestamp": "2026-10-27T08:59:59.000Z"}]
    committed = datetime.datetime(2026, 10, 27, 9, 4, 5, tzinfo=UTC)
    assert shell_pg.epoch_of(history[0]["timestamp"], 0) == committed.timestamp()
    s = usable_shell(tmp_path, UsableWorkspace())
    page = s.by_id["n01_u05"]
    assert s.as_of_version(ws, page, us(committed)) == 246, "a load at the commit's own second sees that commit"
    assert s.as_of_version(ws, page, us(committed) - 1) == 245
    with pytest.raises(shell_core.HttpError) as refused:
        s.as_of_version(ws, page, us(datetime.datetime(2026, 10, 27, 8, 59, 58, tzinfo=UTC)))
    assert refused.value.status == 409


def test_the_as_of_a_list_gives_is_when_its_rows_were_read_not_when_it_was_served(tmp_path):
    clock = [NOW.timestamp()]
    ws = UsableWorkspace(total=3)
    ws.table_history = None
    s = shell_core.Shell(app_dir(tmp_path, DECIDE, [edit_page(similar_by=["category"])]),
                         env={"DATABRICKS_WAREHOUSE_ID": "wh1", "DATABRICKS_HOST": "dbc-1.example.com"},
                         sp_factory=lambda: ws, user_factory=lambda host, token: ws, clock=lambda: clock[0])
    first = post(s, "records", {})[1]["as_of_us"]
    clock[0] += 50
    status, out = post(s, "records", {})
    assert status == 200 and len(ws.queries(" OFFSET ")) == 1, "the second read is the cached one"
    assert out["as_of_us"] == first == str(us(NOW) - shell_pg.CLOCK_SKEW_S * 1000000), \
        "a list cached without a table version is as old as its read, so a change in between is a conflict"
    for folder, page, expected, why in (
            ("stamped", result_only_page(), us(NOW) + (50 - shell_core.STAMP_TTL_S - shell_pg.CLOCK_SKEW_S) * 1000000,
             "a list cached under a table version the App checked at most 15 s ago is as current as that check"),
            ("joined", edit_page(similar_by=["category"]), us(NOW) - shell_pg.CLOCK_SKEW_S * 1000000,
             "a list that also reads an input table has no version a run keeps, so it is as old as its read")):
        clock[0] = NOW.timestamp()
        s, stamped = run_facts_shell(tmp_path / folder, page, clock)
        post(s, "records", {})
        clock[0] += 50
        status, out = post(s, "records", {})
        assert status == 200 and len(stamped.queries(" OFFSET ")) == 1
        assert out["as_of_us"] == str(expected), why


def result_only_page():
    page = edit_page(similar_by=["category"])
    records = page["datasets"][1]
    records["sql"] = records["sql"].replace("i.category, i.channel, i.region", "o.category, o.channel, o.region").replace(
        " JOIN main.pricing.items AS i ON i.item_id = o.entity_id", "")
    assert "items" not in records["sql"], records["sql"]
    return page


def run_facts_shell(folder, page, clock):
    folder.mkdir()
    ws = RunFactsWorkspace(total=3)
    s = shell_core.Shell(app_dir(folder, DECIDE, [page]), env={"DATABRICKS_WAREHOUSE_ID": "wh1", "DATABRICKS_HOST": "dbc-1.example.com"},
                         sp_factory=lambda: ws, user_factory=lambda host, token: ws, clock=lambda: clock[0])
    return s, ws


def test_an_act_over_the_cap_is_refused_with_the_exact_count_and_writes_nothing(tmp_path):
    ws = UsableWorkspace(matched=100001)
    s = usable_shell(tmp_path, ws)
    status, out = post(s, "records/act", match_body())
    expected = CONTRACT["act_match"]["over_cap"]
    assert status == expected["status"] and out == expected["body"]
    assert ws.queries("MERGE INTO") == []
    ws.matched = 0
    status, out = post(s, "records/act", match_body())
    assert status == 409 and out["error"] == "no record matches these filters any more; reload the list"


@pytest.mark.parametrize("body, fragment", [
    ({"record_keys": ["k1"], "seen": {"k1": "1"}}, "never both"),
    ({"match": {"filters": {}, "view": {}}}, "match takes filters, view and as_of_us"),
    ({"match": {"filters": {}, "view": {}, "as_of_us": "soon"}}, "as_of_us the list gave you"),
    ({"match": {"filters": {}, "view": {"sort": {}}, "as_of_us": "1"}}, "match view takes only"),
    ({"match": {"filters": [], "view": {}, "as_of_us": "1"}}, "match filters and view are objects"),
    ({"match": {"filters": {"nope": ["x"]}, "view": {}, "as_of_us": "1"}}, "the page has no filter 'nope'"),
    ({"match": {"filters": {}, "view": {"window": "year"}, "as_of_us": "1"}}, "window must be one of"),
])
def test_a_bad_match_is_refused_before_any_write(tmp_path, body, fragment):
    ws = UsableWorkspace()
    s = usable_shell(tmp_path, ws)
    full = match_body(**body) if "match" in body else dict(match_body(), **body)
    status, out = post(s, "records/act", full)
    assert status == 400 and fragment in out["error"], out
    assert ws.queries("MERGE INTO") == []


def test_listing_batches_reads_each_act_with_its_note_and_whether_it_was_undone(tmp_path):
    rows = [{"batch_id": "a" * 32, "editor": PERSON, "at": "2026-10-27T09:10:00.000Z", "n": 2, "batch_values": json.dumps({"action_status": "Done"}),
             "note": "Repriced the shelf", "undone": 1},
            {"batch_id": "b" * 32, "editor": PERSON, "at": "2026-10-27T09:12:00.000Z", "n": 1,
             "batch_values": json.dumps({shell_sql.UNDO_KEY: "a" * 32}), "note": None, "undone": 0}]
    ws = UsableWorkspace(batches=rows)
    s = usable_shell(tmp_path, ws)
    status, out = call(s, "GET", "records/batches", headers=EDITOR, query={"page": "n01_u05"})
    assert status == 200, out
    same_shape({"batches": out["batches"][:1], "limit": out["limit"]}, CONTRACT["batches"]["response"])
    assert [(b["batch_id"], b["undone"], b["undoes"]) for b in out["batches"]] == [("a" * 32, True, None), ("b" * 32, False, "a" * 32)]
    assert out["batches"][0]["values"] == {"action_status": "Done"} and out["batches"][1]["values"] == {}


def test_undo_restores_the_values_before_the_batch_as_new_versions_and_reports_what_it_skipped(tmp_path):
    done = [{"record_key": "k2", "change_source": "edit", "changed_by": "sam", "valid_from": "2026-10-27T09:20:00.000Z", "_inspire_done": 0,
             "_inspire_n": 2}, {"record_key": "k1", "change_source": "action", "changed_by": PERSON, "valid_from": "2026-10-27T09:25:00.000Z",
                                "_inspire_done": 1, "_inspire_n": 2}]
    made = [{"batch_id": "a" * 32, "editor": PERSON, "at": "2026-10-27T09:10:00.000Z", "n": 2, "batch_values": "{}", "note": None, "undone": 0}]
    ws = UsableWorkspace(batch_records=done, inserted=1, batches=made)
    s = usable_shell(tmp_path, ws)
    status, out = post(s, "records/undo", {"batch_id": "a" * 32})
    assert status == 200, out
    same_shape(out, CONTRACT["undo"]["response"])
    assert (out["restored"], out["skipped"], out["undoes"]) == (1, 1, "a" * 32)
    assert [r["record_key"] for r in out["skipped_sample"]] == ["k2"] and out["skipped_sample"][0]["error"].startswith("sam changed")
    (sql, params), = ws.queries("MERGE INTO")
    assert "JOIN `main`.`pricing`.`loss_desk_out` AS p ON p.`record_key` = b.`record_key` AND p.`valid_to` = b.`valid_from`" in sql
    assert "p.`action_status` AS `action_status`" in sql and "p.`snooze_until` AS `snooze_until`" in sql
    assert "b.`action_batch` = :p" in sql and {"a" * 32} <= {p["value"] for p in params}
    undo_values = next(json.loads(p["value"]) for p in params if str(p["value"]).startswith("{"))
    assert undo_values == {shell_sql.UNDO_KEY: "a" * 32}
    for bad in ("", "A" * 32, "a" * 31, "undo"):
        status, out = post(s, "records/undo", {"batch_id": bad})
        assert status == 400 and out["error"] == CONTRACT["errors"]["bad_batch"]["body"]["error"]
    ws.batch_record_rows = []
    status, out = post(s, "records/undo", {"batch_id": "c" * 32})
    assert status == 404


class PersonReader(UsableWorkspace):
    def __init__(self, keys=(), truncated=False, **kw):
        super().__init__(**kw)
        self.keys, self.truncated = list(keys), truncated

    def answer(self, sql, params):
        if sql.startswith("MERGE INTO"):
            raise AssertionError("the person's token never writes a decision")
        if "SELECT DISTINCT `_inspire_key` FROM" in sql:
            return {"columns": [], "rows": [{"_inspire_key": k} for k in self.keys], "truncated": self.truncated}
        if sql.startswith("SELECT DISTINCT `record_key` FROM"):
            return {"columns": [], "rows": [{"record_key": k} for k in self.keys], "truncated": self.truncated}
        return super().answer(sql, params)


def person_shell(tmp_path, reader, writer):
    return shell_core.Shell(app_dir(tmp_path, dict(DECIDE, auth="user"), [edit_page(similar_by=["category"])]),
                            env={"DATABRICKS_WAREHOUSE_ID": "wh1", "DATABRICKS_HOST": "dbc-1.example.com"},
                            sp_factory=lambda: writer, user_factory=lambda host, token: reader, clock=lambda: NOW.timestamp())


SIGNED_IN = dict(EDITOR, **{"x-forwarded-access-token": "tok-a"})


def test_a_per_user_match_reads_the_matching_keys_as_the_person_and_the_app_writes_only_those_keys(tmp_path):
    reader, writer = PersonReader(matched=2, keys=["k1", "k2"]), UsableWorkspace(inserted=2)
    s = person_shell(tmp_path, reader, writer)
    status, out = post(s, "records/act", match_body(), headers=SIGNED_IN)
    assert status == 200, out
    same_shape(out, CONTRACT["act_match"]["response"])
    assert (out["written"], out["matched"], out["left_out"]) == (2, 2, 0)
    assert reader.history_reads and not writer.history_reads, "the person's own read picks the table version"
    (sql, params), = writer.queries("MERGE INTO")
    assert sql.count("JOIN (SELECT explode(from_json(:p0, 'ARRAY<STRING>')) AS `_inspire_key`) AS w") == 2
    assert json.loads(params[0]["value"]) == ["k1", "k2"] and PERSON in [p["value"] for p in params]
    assert "VERSION AS OF 41" in sql and "CAST(`category` AS STRING)" not in sql, "the App never runs the person's filters itself"
    assert [q for q, _p, _l in writer.sql if not q.startswith("MERGE INTO")] == []
    assert reader.queries("CAST(`category` AS STRING) IN (")


def test_a_per_user_match_over_its_cap_or_with_nothing_readable_writes_nothing(tmp_path):
    cap = shell_sql.CAPS["act_match_user"]
    reader, writer = PersonReader(matched=cap + 1), UsableWorkspace(inserted=0)
    s = person_shell(tmp_path, reader, writer)
    status, out = post(s, "records/act", match_body(), headers=SIGNED_IN)
    assert status == 409 and (out["code"], out["cap"], out["matched"]) == ("over_cap", cap, cap + 1)
    reader.matched, reader.keys, reader.truncated = 3, ["k1"] * cap, True
    status, out = post(s, "records/act", match_body(), headers=SIGNED_IN)
    assert status == 409 and out["code"] == "over_cap" and out["cap"] == cap
    reader.keys, reader.truncated = [], False
    status, out = post(s, "records/act", match_body(), headers=SIGNED_IN)
    assert status == 409 and out["code"] == "no_match"
    assert writer.sql == []


def test_a_per_user_undo_restores_only_the_records_the_person_can_read_and_counts_the_rest(tmp_path):
    mine = [{"record_key": "k1", "change_source": "action", "changed_by": PERSON, "valid_from": "2026-10-27T09:25:00.000Z", "_inspire_done": 1,
             "_inspire_n": 1}]
    reader = PersonReader(keys=["k1"], batch_records=mine)
    writer = UsableWorkspace(inserted=1, batch_records=[dict(mine[0], _inspire_n=3)])
    s = person_shell(tmp_path, reader, writer)
    status, out = post(s, "records/undo", {"batch_id": "a" * 32}, headers=SIGNED_IN)
    assert status == 200, out
    assert sorted(out) == sorted(CONTRACT["undo"]["response"])
    assert (out["restored"], out["skipped"], out["skipped_sample"], out["left_out"]) == (1, 0, [], 2)
    (sql, params), = writer.queries("MERGE INTO")
    assert "b.`action_batch` = :p" in sql and "AND b.`record_key` IN (SELECT explode(from_json(:p" in sql
    assert ["k1"] in [json.loads(p["value"]) for p in params if str(p["value"]).startswith("[")]
    reader.keys = []
    writer.sql.clear()
    status, out = post(s, "records/undo", {"batch_id": "b" * 32}, headers=SIGNED_IN)
    assert status == 404 and "you can read" in out["error"] and writer.sql == []


def test_a_page_inside_inspire_without_inspire_s_writer_refuses_decisions_and_with_it_writes_as_inspire(tmp_path):
    reader, writer = DataWorkspace(current=[current("k1", "run", "run 7")]), DataWorkspace()
    inside = dict(DECIDE, auth="user", host="inspire")
    s = shell_core.Shell(app_dir(tmp_path, inside, [edit_page()]), env={"DATABRICKS_WAREHOUSE_ID": "wh1", "DATABRICKS_HOST": "dbc-1.example.com"},
                         sp_factory=lambda: pytest.fail("a page inside Inspire has no service principal"),
                         user_factory=lambda host, token: reader)
    body = {"record_keys": ["k1"], "seen": {"k1": "101"}, "values": {"action_status": "Done"}}
    status, out = post(s, "records/act", body, headers=SIGNED_IN)
    assert status == 403 and out["error"] == shell_core.INSIDE_DECISIONS and writer.sql == [] and reader.queries("MERGE INTO") == []
    (tmp_path / "hosted").mkdir()
    s = shell_core.Shell(app_dir(tmp_path / "hosted", inside, [edit_page()]),
                         env={"DATABRICKS_WAREHOUSE_ID": "wh1", "DATABRICKS_HOST": "dbc-1.example.com"},
                         sp_factory=lambda: pytest.fail("a page inside Inspire has no service principal"),
                         user_factory=lambda host, token: reader, writer_factory=lambda: writer)
    status, out = post(s, "records/act", body, headers=SIGNED_IN)
    assert status == 200 and out["written"] == ["k1"] and len(writer.queries("MERGE INTO")) == 1 and reader.queries("MERGE INTO") == []
    writer.fail["merge"] = shell_core.QueryError("PERMISSION_DENIED: no MODIFY")
    status, out = post(s, "records/act", body, headers=SIGNED_IN)
    assert status == 403 and out["error"].startswith("Nothing was saved: Inspire's service principal records the decisions of this page")


def test_similar_records_come_from_the_page_s_grouping_columns_and_feed_one_match(tmp_path):
    ws = UsableWorkspace(similar="Books", total=1, rows=[{"_inspire_key": "k2", "entity_label": "Item 2", "_inspire_version": "1001"}])
    s = usable_shell(tmp_path, ws)
    query = CONTRACT["similar"]["request"]["query"]
    status, out = call(s, "GET", "records/similar", headers=EDITOR, query=query)
    assert status == 200, out
    same_shape(out, CONTRACT["similar"]["response"])
    assert out["by"] == CONTRACT["similar"]["response"]["by"] and out["count"] == 1
    assert out["match"]["filters"] == {"category": ["Books"]} and out["match"]["view"] == {"window": "all", "exclude": ["k1"]}
    rows_sql = ws.queries(" OFFSET ")[-1][0]
    assert "NOT IN (SELECT explode(from_json(" in rows_sql and "COALESCE(c.`_inspire_status`, 'New') IN ('New', 'In progress')" in rows_sql
    for bad, code in (({"by": "region,nope"}, 400), ({"by": "category,category"}, 400), ({"record_key": ""}, 400)):
        assert call(s, "GET", "records/similar", headers=EDITOR, query=dict(query, **bad))[0] == code, bad
    ws.similar_value = None
    assert call(s, "GET", "records/similar", headers=EDITOR, query=query)[0] == 404
    (tmp_path / "plain").mkdir()
    plain = usable_shell(tmp_path / "plain", UsableWorkspace(), pages=[edit_page()])
    status, out = call(plain, "GET", "records/similar", headers=EDITOR, query=query)
    assert status == 409 and "names no columns to find similar records by" in out["error"]


def test_the_page_spec_records_its_grouping_columns_and_the_shell_checks_them(agent_ns):
    built = agent_ns["implement_app_page"](edit_page(), "N01-U05", {})
    assert built["similar_by"] == ["category", "channel", "region"]
    assert shell_sql.spec_problems(built) == []
    assert agent_ns["IMPLEMENT_SIMILAR_BY"] == shell_sql.CAPS["similar_by"] and agent_ns["IMPLEMENT_RECORDS_DATASET"] == shell_sql.RECORDS_DATASET
    assert shell_sql.similar_by_problems(edit_page(similar_by=["run_date"])) == [
        "similar_by names 'run_date', which is no segment filter of the decision list"]
    assert shell_sql.similar_by_problems(edit_page(similar_by=[])) == ["similar_by takes 1 to 3 distinct filter ids"]
    assert shell_sql.similar_by_problems(edit_page(similar_by=["category", "category"])) == ["similar_by takes 1 to 3 distinct filter ids"]
    assert shell_core.public_page(edit_page(similar_by=["category"]))["similar_by"] == [{"filter": "category", "label": "Category"}]


class HeldLakebase:
    def __init__(self):
        self.tables, self.writes = {}, []

    def run(self, sql, params, limit):
        raise shell_pg.NotHeld(TRACKED)

    def noted(self, note):
        pass

    def pending(self):
        return False

    def wrote(self, keys, plan=None, fetch=None):
        self.writes.append((set(keys), plan, fetch))

    def status(self):
        return {"note": "", "catching_up": False, "synced_at": None}


def test_a_set_write_holds_the_lakebase_copies_until_they_sync_and_never_builds_a_per_key_overlay(tmp_path):
    ws = UsableWorkspace(matched=3, inserted=3)
    s = usable_shell(tmp_path, ws)
    held = s.lakebase = HeldLakebase()
    status, _out = post(s, "records/act", match_body())
    assert status == 200 and len(held.writes) == 1 and held.writes[0][1] is None and held.writes[0][2] is None
    assert s.as_of_us(["lakebase"], NOW.timestamp()) == "0", "a list Lakebase served with no known sync time is never acted on as a set"
    held.status = lambda: {"note": "", "catching_up": False, "synced_at": "2026-10-27T09:20:00Z"}
    assert s.as_of_us(["lakebase"], NOW.timestamp()) == str(us(datetime.datetime(2026, 10, 27, 9, 19, 55, tzinfo=UTC)))
    assert s.as_of_us(["delta"], NOW.timestamp()) == str(us(NOW) - shell_pg.CLOCK_SKEW_S * 1000000)


PG_RESULT = "main.usable.results"
PG_COLUMNS = [{"name": n, "type": t, "type_text": t} for n, t in (
    ("record_key", "STRING"), ("entity_id", "STRING"), ("entity_label", "STRING"), ("priority_tier", "STRING"), ("rank", "INT"),
    ("value_at_stake", "DOUBLE"), ("category", "STRING"), ("as_of_date", "DATE"), ("use_case_id", "STRING"), ("run_id", "STRING"),
    ("valid_from", "TIMESTAMP"), ("valid_to", "TIMESTAMP"), ("is_current", "BOOLEAN"), ("change_source", "STRING"), ("changed_by", "STRING"),
    ("action_owner", "STRING"), ("action_status", "STRING"), ("action_due", "DATE"), ("action_note", "STRING"), ("dismiss_reason", "STRING"),
    ("action_outcome", "STRING"), ("snooze_until", "DATE"), ("action_batch", "STRING"), ("action_batch_note", "STRING"),
    ("action_batch_values", "STRING"), ("joined_at", "TIMESTAMP"), ("held_back", "BOOLEAN"), *shell_sql.KEPT_TYPES.items())]
PG_PAGE = {"version": 1, "id": "u1", "use_case_id": "U-1", "title": "Usable", "question": "Which?", "icon": "tag", "hue": "blue",
           "result_table": PG_RESULT, "similar_by": ["category"],
           "datasets": [{"name": "records", "sql": f"SELECT record_key, entity_id, entity_label, priority_tier, `rank`, value_at_stake, category, "
                                                   f"as_of_date FROM {PG_RESULT} WHERE is_current AND change_source <> 'delete'"}],
           "filters": [{"id": "category", "type": "multi_select", "label": "Category", "columns": {"records": "category"}}],
           "kpis": [], "charts": [], "tables": [],
           "records": {"title": "List", "key": "entity_id", "label": "entity_label", "rank": "rank", "tier": "priority_tier"}}


def row(key, stake=10.0, due=None, status=None, joined=None, snooze=None, held=False, category="Books", at=None, source="run", ends=None,
        batch=None, current_=True):
    stamp = at or datetime.datetime(2026, 10, 27, 9, 0, tzinfo=UTC)
    return {"record_key": key, "entity_id": key, "entity_label": f"Item {key}", "priority_tier": "Act now", "rank": 1, "value_at_stake": stake,
            "category": category, "as_of_date": datetime.date(2026, 10, 27), "use_case_id": "U-1", "run_id": "r1", "valid_from": stamp,
            "valid_to": ends, "is_current": current_, "change_source": source, "changed_by": "run r1" if source == "run" else PERSON,
            "action_owner": None, "action_status": status, "action_due": due, "action_note": None, "dismiss_reason": None,
            "action_outcome": None, "snooze_until": snooze, "action_batch": batch, "action_batch_note": None, "action_batch_values": None,
            "joined_at": joined or datetime.datetime(2026, 10, 1, tzinfo=UTC), "held_back": held, "edited_by_person": False,
            "not_listed_since": None}


@pytest.fixture(scope="module")
def pg(postgres):
    return postgres


def pg_table(pg, name, rows):
    import psycopg
    with psycopg.connect(host=pg["host"], port=pg["port"], dbname="postgres", user="inspire", autocommit=True) as conn, conn.cursor() as cur:
        cur.execute(f'DROP TABLE IF EXISTS "{PG_SCHEMA}"."{name}"')
        create(cur, name, PG_COLUMNS, rows)
    return {shell_pg.uc_key(PG_RESULT): {"pg": f"{PG_SCHEMA}.{name}", "columns": PG_COLUMNS}}


def pg_run(pg, sql, params, tables):
    import psycopg
    text, values, _read = shell_pg.render(sql, params, tables)
    with psycopg.connect(host=pg["host"], port=pg["port"], dbname="postgres", user="inspire", autocommit=True) as conn, conn.cursor() as cur:
        cur.execute(text, values)
        names = [d.name for d in cur.description]
        return [dict(zip(names, r)) for r in cur.fetchall()]


def pg_context():
    dataset = {c["name"]: c["type"] for c in PG_COLUMNS if c["name"] in (
        "record_key", "entity_id", "entity_label", "priority_tier", "rank", "value_at_stake", "category", "as_of_date")}
    context = shell_sql.list_context(PG_PAGE, dataset, shell_sql.change_fields(PG_COLUMNS), True)
    return dict(context, types=dataset, history=None, facts=None, money=[])


WINDOW_ROWS = [row("a", 50, due=datetime.date(2026, 10, 27)), row("b", 500, due=datetime.date(2026, 10, 30)),
               row("c", 10, due=datetime.date(2026, 10, 26)), row("d", 20, joined=datetime.datetime(2026, 10, 27, 9, 5, tzinfo=UTC)),
               row("e", 900, joined=datetime.datetime(2026, 10, 20, tzinfo=UTC)), row("f", 700, due=datetime.date(2026, 10, 27), status="Done"),
               row("g", 800, due=datetime.date(2026, 10, 27), snooze=datetime.date(2026, 10, 28)),
               row("h", 600, due=datetime.date(2026, 10, 27), held=True), row("i", 5, due=datetime.date(2026, 10, 27), snooze=datetime.date(2026, 10, 27)),
               row("j", 300, joined=datetime.datetime(2026, 9, 15, tzinfo=UTC)), row("k", 400, due=datetime.date(2026, 11, 15)),
               dict(row("l", 1), joined_at=None)]


@pytest.mark.parametrize("window, limit, keys, total", [
    ("today", None, ["a", "d", "c", "i"], 4), ("hour", None, ["a", "d", "c", "i"], 4), ("week", None, ["b", "a", "d", "c", "i"], 5),
    ("month", None, ["e", "b", "a", "d", "c", "i"], 6), ("all", None, ["e", "b", "k", "j", "a", "d", "c", "i", "l"], 9),
    ("all", 2, ["e", "b"], 9)])
def test_on_postgres_a_window_leaves_out_what_is_outside_it_keeps_overdue_and_ranks_by_stake(pg, window, limit, keys, total):
    tables = pg_table(pg, f"w_{window}_{limit or 0}", WINDOW_ROWS)
    context = pg_context()
    data = dict({"window": window, "limit": 25}, **({"window_limit": limit} if limit else {}))
    plan = shell_sql.list_queries(PG_PAGE, {}, shell_sql.list_request(PG_PAGE, data, context, NOW), context)
    assert [r["record_key"] for r in pg_run(pg, *plan["rows"], tables)] == keys
    assert pg_run(pg, *plan["total"], tables)[0]["total"] == total
    assert "f" not in keys and "g" not in keys and "h" not in keys, "closed, snoozed and held records are never in a window"


PG_BEFORE = "main.usable.results_before"


def pg_land(pg, name, rows):
    import psycopg
    with psycopg.connect(host=pg["host"], port=pg["port"], dbname="postgres", user="inspire", autocommit=True) as conn, conn.cursor() as cur:
        for r in rows:
            cur.execute(f'UPDATE "{PG_SCHEMA}"."{name}" SET "is_current" = FALSE, "valid_to" = %s WHERE "record_key" = %s AND "is_current"',
                        [r["valid_from"], r["record_key"]])
            cur.execute(f'INSERT INTO "{PG_SCHEMA}"."{name}" VALUES (' + ", ".join(["%s"] * len(PG_COLUMNS)) + ")",
                        [r.get(c["name"]) for c in PG_COLUMNS])


def test_on_postgres_a_match_writes_only_records_unchanged_since_the_load_never_a_held_or_newer_one(pg):
    t0, early, late = (datetime.datetime(2026, 10, 27, 9, m, tzinfo=UTC) for m in (0, 5, 20))
    before = [row("r1"), row("r2"), row("r3", held=True), row("r4", category="Music"), row("r6")]
    after = [row("r1"), row("r2", ends=late, current_=False), row("r2", at=late, source="edit"), row("r3", held=True),
             row("r4", category="Music"), row("r5"), row("r6", ends=early, current_=False), row("r6", at=early)]
    tables = dict(pg_table(pg, "match_rows", after), **{shell_pg.uc_key(PG_BEFORE): pg_table(pg, "match_before", before)[shell_pg.uc_key(PG_RESULT)]})
    context = pg_context()
    request = shell_sql.list_request(PG_PAGE, {"limit": 1}, context, NOW)
    fields = shell_sql.change_fields(PG_COLUMNS)
    plan = shell_sql.list_match_query(PG_PAGE, {"category": ["Books"]}, request, context, PERSON)
    staged, params = shell_sql.version_staged(PG_RESULT, fields, "action", [], PERSON, {"action_status": "Done"},
                                              batch={"id": "a" * 32, "values": "{}"},
                                              match={"keys": plan["keys"], "params": plan["params"], "before": shell_sql.table_name(PG_BEFORE)})
    written = pg_run(pg, staged, params.items, tables)
    assert [(r["record_key"], r["action_status"], r["action_batch"], r["change_source"]) for r in written] == [("r1", "Done", "a" * 32, "action")], \
        "r6 got a version stamped before the load but written after it, so it is not the version the person saw"
    pg_land(pg, "match_rows", written)
    probe = shell_sql.list_match_query(PG_PAGE, {"category": ["Books"]}, request, context, PERSON)
    conflicts = pg_run(pg, *shell_sql.match_conflicts_query(PG_RESULT, probe, "a" * 32, True), tables)
    assert [(r["record_key"], r["held_back"], r["_inspire_n"]) for r in conflicts] == [("r2", False, 4), ("r3", True, 4), ("r5", False, 4),
                                                                                        ("r6", False, 4)]
    total = shell_sql.list_match_query(PG_PAGE, {"category": ["Books"]}, request, context, PERSON)
    assert pg_run(pg, total["total"], total["params"].items, tables)[0]["total"] == 5
    assert shell_sql.snapshot_of(PG_RESULT, 41) == "`main`.`usable`.`results` VERSION AS OF 41"


def test_on_postgres_undo_restores_the_values_before_the_batch_and_skips_a_record_changed_after_it(pg):
    t0, t1, t2 = (datetime.datetime(2026, 10, 27, 9, m, tzinfo=UTC) for m in (0, 15, 20))
    batch = "a" * 32
    rows = [row("r1", status="New", ends=t1, current_=False), row("r1", status="Done", at=t1, source="action", batch=batch),
            row("r2", status="New", ends=t1, current_=False), row("r2", status="Done", at=t1, ends=t2, source="action", batch=batch, current_=False),
            row("r2", status="Done", at=t2, source="edit", batch=batch)]
    tables = pg_table(pg, "undo_rows", rows)
    fields = shell_sql.change_fields(PG_COLUMNS)
    staged, params = shell_sql.version_staged(PG_RESULT, fields, "action", [], PERSON, {}, batch={"id": "b" * 32, "values": "{}"}, undo=batch)
    restored = pg_run(pg, staged, params.items, tables)
    assert [(r["record_key"], r["action_status"], r["action_batch"]) for r in restored] == [("r1", "New", "b" * 32)]
    sql, params = shell_sql.batch_records_query({"result_table": PG_RESULT}, batch, "b" * 32)
    listed = pg_run(pg, sql, params, tables)
    assert [(r["record_key"], r["_inspire_done"], r["_inspire_n"]) for r in listed] == [("r1", 0, 2), ("r2", 0, 2)]


def test_on_postgres_batches_list_each_act_newest_first_and_mark_the_undone_one(pg):
    first, undo = "a" * 32, "b" * 32
    rows = [row("r1", status="Done", at=datetime.datetime(2026, 10, 27, 9, 10, tzinfo=UTC), source="action", batch=first),
            row("r2", status="Done", at=datetime.datetime(2026, 10, 27, 9, 10, tzinfo=UTC), source="action", batch=first),
            row("r3", status="New", at=datetime.datetime(2026, 10, 27, 9, 12, tzinfo=UTC), source="action", batch=undo)]
    rows[0]["action_batch_note"] = "Repriced"
    for r in rows[:2]:
        r["action_batch_values"] = json.dumps({"action_status": "Done"})
    rows[2]["action_batch_values"] = json.dumps({shell_sql.UNDO_KEY: first})
    tables = pg_table(pg, "batch_rows", rows)
    listed = pg_run(pg, *shell_sql.batches_query({"result_table": PG_RESULT, "use_case_id": "U-1"}), tables)
    assert [(r["batch_id"], r["n"], r["undone"], r["note"]) for r in listed] == [(undo, 1, 0, None), (first, 2, 1, "Repriced")]


def test_on_postgres_similar_records_are_open_ones_with_the_same_values_never_the_record_itself(pg):
    rows = [row("k1", 30), row("k2", 20), row("k3", 90, status="Done"), row("k4", 80, snooze=datetime.date(2026, 10, 29)),
            row("k5", 70, category="Music")]
    tables = pg_table(pg, "similar_rows", rows)
    context = pg_context()
    request = shell_sql.list_request(PG_PAGE, {"window": "all", "exclude": ["k1"], "limit": 5}, context, NOW)
    plan = shell_sql.list_queries(PG_PAGE, {"category": ["Books"]}, request, context)
    assert [r["record_key"] for r in pg_run(pg, *plan["rows"], tables)] == ["k2"]
    assert pg_run(pg, *plan["total"], tables)[0]["total"] == 1
    sql, params = shell_sql.similar_values_query(PG_PAGE, context, "k1", shell_sql.similar_filters(PG_PAGE))
    assert pg_run(pg, sql, params, tables) == [{"category": "Books"}]


def test_the_delta_and_lakebase_paths_read_one_window_definition():
    context = pg_context()
    request = shell_sql.list_request(PG_PAGE, {"window": "today", "limit": 25}, context, NOW)
    rows_sql, _params = shell_sql.list_queries(PG_PAGE, {}, request, context)["rows"]
    tables = {shell_pg.uc_key(PG_RESULT): {"pg": "s.results", "columns": PG_COLUMNS}}
    text, _values, _read = shell_pg.render(rows_sql, _params, tables)
    assert text.count("COALESCE(") >= 1 and "_inspire_snooze" in text, "Lakebase renders the very statement Delta runs"


def test_a_run_dates_only_a_new_record_as_joining_and_never_writes_an_act_batch(agent_ns):
    assert agent_ns["INSPIRE_ACT_BATCH_NAMES"] == shell_sql.BATCH_TYPES and agent_ns["INSPIRE_JOINED_AT"] == shell_sql.JOINED_COLUMN
    columns, now = ["entity_id", "run_id", "use_case_id"], "timestamp_micros(1)"
    merge = agent_ns["inspire_history_merge_sql"]("main.s.t", "main.s.t_stage", columns, ["entity_id"], "N01-U01", False, now=now)
    inserted = merge.split("WHEN NOT MATCHED THEN INSERT", 1)[1]
    assert ("u.`snooze_until`, CAST(NULL AS STRING), CAST(NULL AS STRING), CAST(NULL AS STRING), CASE WHEN u._inspire_was_source IS NULL "
            f"THEN {now} ELSE u.`joined_at` END, u._inspire_record_key") in inserted, \
        "a record already on the list keeps the date it joined, even an unknown one, so a run never floods today's window"
    assert "`joined_at` =" not in merge, "restamping an unchanged record leaves the date it joined alone"
    create = agent_ns["inspire_history_create_sql"]("main.s.t", "main.s.t_stage", columns, ["entity_id"], now=now)
    assert (f"CAST(NULL AS STRING) AS `action_batch`, CAST(NULL AS STRING) AS `action_batch_note`, CAST(NULL AS STRING) AS "
            f"`action_batch_values`, {now} AS `joined_at`") in create


def test_on_postgres_an_edit_after_an_act_carries_the_record_s_state_but_not_the_act_s_batch(pg):
    batch = "a" * 32
    acted = row("r1", status="Done", source="action", batch=batch, snooze=datetime.date(2026, 11, 2))
    acted.update(action_batch_note="Repriced", action_batch_values=json.dumps({"action_status": "Done"}))
    tables = pg_table(pg, "edit_rows", [acted])
    fields = shell_sql.change_fields(PG_COLUMNS)
    staged, params = shell_sql.version_staged(PG_RESULT, fields, "edit", [("r1", str(us(acted["valid_from"])))], PERSON,
                                              {"entity_label": "Renamed"})
    (edited,) = pg_run(pg, staged, params.items, tables)
    assert (edited["entity_label"], edited["action_status"], edited["snooze_until"], edited["change_source"]) == (
        "Renamed", "Done", datetime.date(2026, 11, 2), "edit")
    assert (edited["action_batch"], edited["action_batch_note"], edited["action_batch_values"]) == (None, None, None)
    staged, params = shell_sql.version_staged(PG_RESULT, fields, "action", [("r1", str(us(acted["valid_from"])))], PERSON,
                                              {"action_owner": "sam"}, batch={"id": "b" * 32, "values": "{}"})
    (owned,) = pg_run(pg, staged, params.items, tables)
    assert (owned["action_batch"], owned["action_batch_note"], owned["action_status"]) == ("b" * 32, None, "Done"), \
        "a later act carries its own batch and no note but its own"
