"""v1.9.0 progress and step recovery.

The session progress is the share of the planned work that is done, so a run that has finished
scoring but not its documents is far from 99%. A cancelled LLM attempt whose retry succeeds ends
as a success that names its retry count; an attempt nobody recovered keeps its warning.
"""
import os
import re
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from v120_artifacts_support import CapturingLogger, FakeSpark  # noqa: E402
from v120_runtime_reliability_test import RecordingLogger, make_agent  # noqa: E402

LEAST_SQL = re.compile(r"completed_percent = LEAST\(99\.0, CAST\(FLOOR\(completed_percent \+ ([0-9.]+)\) AS DOUBLE\)\)")
GREATEST_SQL = re.compile(r"completed_percent = GREATEST\(COALESCE\(completed_percent, 0\.0\), ([0-9.]+)\)")
LANGUAGES = ["English", "Arabic", "French"]
CHOICES = ["PDF Catalog", "Presentation"]


class _ViewSpark(FakeSpark):
    def createDataFrame(self, rows, schema=None):
        frame = super().createDataFrame(rows, schema)
        frame.createOrReplaceTempView = lambda name: None
        return frame


def _writer(ns, spark, tmp_path, monkeypatch, **widgets):
    monkeypatch.setattr(ns["tempfile"], "tempdir", str(tmp_path), raising=False)
    return ns["AtomicWriter"](spark, CapturingLogger(), "cat.inspire", 4242, widget_values=widgets)


def _plan(writer, languages=LANGUAGES, choices=CHOICES, operation="Discover Use Cases", genie_limit=10):
    plan = getattr(writer, "plan_progress", None)
    if plan is not None:
        plan(languages=languages, choices=choices, from_json=False, operation=operation, genie_limit=genie_limit)


def _session_percent(spark):
    percent = 0.0
    for statement in spark.statements:
        if "__inspire_session" not in statement or not statement.startswith("UPDATE"):
            continue
        least, greatest = LEAST_SQL.search(statement), GREATEST_SQL.search(statement)
        if least:
            percent = min(99.0, float(int(percent + float(least.group(1)))))
        elif greatest:
            percent = max(percent, float(greatest.group(1)))
        elif "completed_percent = 100.0" in statement:
            percent = 100.0
    return percent


def _emit_rows(writer, stage, count, prefix):
    for i in range(count):
        step_id = writer.emit_step(stage_name=stage, step_name=f"{prefix} {i}", sub_step_name="Working",
                                   progress_increment=1.0, message="working", status="started")
        writer.emit_step(stage_name=stage, step_name=f"{prefix} {i}", sub_step_name="Done", progress_increment=1.0,
                         message="done", status="ended_success", step_id=step_id)


def _replay_until_documents(writer):
    for stage, count in (("Setup", 3), ("Business Understanding", 3), ("Data Preparation", 4),
                         ("Use Case Design", 40), ("Business Domain Clustering", 20),
                         ("Use Case Prioritization", 60)):
        for chunk in range(0, count, 20):
            _emit_rows(writer, stage, min(20, count - chunk), f"{stage} {chunk}")
            writer.flush_pending(force=True)


def _stop(writer):
    writer._session_writer.stop(drain_timeout=5.0)


def test_progress_after_scoring_stays_far_below_99_while_documents_are_still_due(agent_ns, tmp_path, monkeypatch):
    spark = _ViewSpark()
    writer = _writer(agent_ns, spark, tmp_path, monkeypatch, operation="Discover Use Cases")
    try:
        _plan(writer)
        _replay_until_documents(writer)
    finally:
        _stop(writer)
    percent = _session_percent(spark)
    assert 0 < percent <= 75, f"progress read {percent}% with every translation, document and notebook still due"


def test_progress_never_moves_backward_and_reaches_100_only_at_finalize(agent_ns, tmp_path, monkeypatch):
    spark = _ViewSpark()
    writer = _writer(agent_ns, spark, tmp_path, monkeypatch, operation="Discover Use Cases")
    seen = []
    try:
        _plan(writer)
        for stage, count in (("Setup", 3), ("Use Case Design", 10), ("Use Case Prioritization", 30),
                             ("Localization", 40), ("Executive Readout", 12), ("Implementation Planning", 25)):
            _emit_rows(writer, stage, count, stage)
            writer.flush_pending(force=True)
            writer.plan_use_cases(60)
            seen.append(writer.planned_percent())
        assert seen == sorted(seen), seen
        assert seen[-1] <= 99
        writer.flush_pending(force=True, finalize=True, final_results_json={})
    finally:
        _stop(writer)
    assert _session_percent(spark) == 100.0


def test_more_languages_and_more_use_cases_mean_a_lower_share_at_the_same_point(agent_ns, tmp_path, monkeypatch):
    def percent_after_scoring(languages, use_cases):
        writer = _writer(agent_ns, _ViewSpark(), tmp_path, monkeypatch, operation="Discover Use Cases")
        try:
            _plan(writer, languages=languages)
            writer.plan_use_cases(use_cases)
            _emit_rows(writer, "Use Case Prioritization", 10, "Scoring")
            return writer.planned_percent()
        finally:
            _stop(writer)
    one, three = percent_after_scoring(["English"], 100), percent_after_scoring(LANGUAGES, 100)
    assert three < one, (one, three)
    fewer, more = percent_after_scoring(LANGUAGES, 30), percent_after_scoring(LANGUAGES, 200)
    assert more < fewer, (fewer, more)


def test_the_plan_is_logged_and_runtime_warnings_do_not_count_as_work(agent_ns, tmp_path, monkeypatch):
    writer = _writer(agent_ns, _ViewSpark(), tmp_path, monkeypatch, operation="Discover Use Cases")
    try:
        _plan(writer)
        assert writer.logger.matching("[PROGRESS-PLAN FIRED]")
        before = writer.planned_percent()
        for i in range(30):
            writer.emit_step(stage_name="Localization", step_name=f"notice {i}", status="ended_warning",
                             result_json={agent_ns["RUNTIME_WARNING_KEY"]: True})
        assert writer.planned_percent() == before
    finally:
        _stop(writer)


def test_an_implement_run_is_planned_on_its_use_cases_only(agent_ns, tmp_path, monkeypatch):
    writer = _writer(agent_ns, _ViewSpark(), tmp_path, monkeypatch, operation="Generate Use Cases")
    try:
        _plan(writer, operation="Generate Use Cases")
        writer.plan_use_cases(4)
        assert set(writer.progress_plan.phases) == {"setup", "implementation"}
        _emit_rows(writer, "Generate Notebooks", 4, "UC")
        assert 0 < writer.planned_percent() < 99
    finally:
        _stop(writer)


def test_every_story_stage_is_planned_or_deliberately_outside_the_plan(agent_ns):
    phase_of = agent_ns["RunProgressPlan"].phase_of
    outside = {"Inspire Journey", "Inspire Progress"}
    stages = {stage for stage, _title in agent_ns["PROMPT_STORY_TITLES"].values()}
    stages.add(agent_ns["BEST_OF_BEST_STORY_TITLE"][0])
    unplanned = sorted(stage for stage in stages - outside if phase_of(stage) is None)
    assert not unplanned, unplanned


class _Rows:
    def __init__(self):
        self.lock = threading.Lock()
        self.events = []
        self.next_id = 100

    def __call__(self, prompt_name, step_name, status, message, result_json, step_id):
        with self.lock:
            if step_id is None:
                self.next_id += 1
                step_id = self.next_id
            self.events.append({"prompt": prompt_name, "step": step_name, "status": status, "message": message,
                                "payload": dict(result_json or {}), "step_id": step_id})
            return step_id

    def final(self):
        with self.lock:
            last = {}
            for event in self.events:
                last[event["step_id"]] = event
            return last

    def wait_for(self, predicate, seconds=5.0):
        end = time.time() + seconds
        while time.time() < end:
            if predicate(self.final()):
                return True
            time.sleep(0.02)
        return False


def _agent(ns):
    agent = make_agent(ns, object(), RecordingLogger())
    rows = _Rows()
    agent.status_emitter = rows
    agent._build_started_status = lambda prompt, step, variables: (f"{prompt} started", {})
    agent._build_success_status = lambda prompt, step, raw, schema: (f"{prompt} done", {})
    agent._load_and_format_prompt = lambda prompt, variables: "prompt text"
    return agent, rows


def _scorer(ns, agent):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = RecordingLogger()
    obj._STRAGGLER_FLOOR_SECONDS = 0.2
    obj.ai_agent = agent
    return obj


def _wait_or_cancel(ns, seconds):
    end = time.time() + seconds
    while time.time() < end:
        if ns["_is_thread_cancelled"]():
            raise RuntimeError("cancelled")
        time.sleep(0.01)
    return "late answer"


def _score_with(ns, agent, ucs, slow_calls, per_task_timeout=0.3):
    calls, lock = {"n": 0}, threading.Lock()

    def fake_call(prompt, prompt_name, *args, **kwargs):
        with lock:
            calls["n"] += 1
            n = calls["n"]
        if n in slow_calls:
            return _wait_or_cancel(ns, 5)
        return "ok"

    agent._call_ai_query = fake_call

    def score(label, batch, skip_cache):
        raw = agent.run_worker(step_name=f"Score_{label}", worker_prompt_path="SCORE_PROMPT", prompt_vars={},
                               response_schema=None)
        return {uc["No"]: {"ok": True} for uc in batch} if raw == "ok" else {}

    return _scorer(ns, agent)._score_with_split_retry(ucs, score, len(ucs), "Test", per_task_timeout=per_task_timeout)


def test_a_cancelled_attempt_whose_retry_succeeds_ends_as_success_with_its_retry_count(agent_ns):
    agent, rows = _agent(agent_ns)
    scores, unscored = _score_with(agent_ns, agent, [{"No": f"U{i}"} for i in range(4)], slow_calls={1})
    assert len(scores) == 4 and not unscored
    first = rows.events[0]["step_id"]
    assert rows.wait_for(lambda final: final.get(first, {}).get("status", "started") != "started"), rows.events
    final = rows.final()
    assert all(event["status"] == "ended_success" for event in final.values()), final
    assert "recovered after 2 retries" in final[first]["message"], final[first]
    assert final[first]["payload"].get("retries") == 2


def test_an_attempt_that_was_never_recovered_keeps_its_warning(agent_ns):
    agent, rows = _agent(agent_ns)
    scores, unscored = _score_with(agent_ns, agent, [{"No": "U0"}], slow_calls=set(range(1, 50)), per_task_timeout=0.2)
    assert not scores and unscored
    assert rows.wait_for(lambda final: final and all(e["status"] != "started" for e in final.values()), seconds=8)
    final = rows.final()
    assert final and all(event["status"] == "ended_warning" for event in final.values()), final
    assert not any("recovered" in event["message"] for event in final.values())


def test_runtime_notices_of_a_call_that_succeeds_are_recovered_and_of_a_failed_call_stay_warnings(agent_ns):
    agent, rows = _agent(agent_ns)

    def impl(prompt, prompt_name, *args):
        agent._emit_runtime_warning(prompt_name, "Call", f"{prompt_name} timeout on model-a after 600s")
        if prompt_name == "FAILING_PROMPT":
            raise RuntimeError("all models failed")
        return "ok"

    agent._call_ai_query_impl = impl
    assert agent._call_ai_query("p", "GOOD_PROMPT") == "ok"
    try:
        agent._call_ai_query("p", "FAILING_PROMPT")
    except RuntimeError:
        pass
    by_prompt = {event["prompt"]: event for event in rows.final().values()}
    assert by_prompt["GOOD_PROMPT"]["status"] == "ended_success", by_prompt
    assert "recovered" in by_prompt["GOOD_PROMPT"]["message"]
    assert by_prompt["FAILING_PROMPT"]["status"] == "ended_warning", by_prompt


def test_a_row_parked_after_its_scope_settled_takes_the_settled_outcome(agent_ns):
    released = []
    scope = agent_ns["StepRecoveryScope"](lambda row, recovered, retries: released.append((row["step"], recovered, retries)))
    scope.count_attempt()
    scope.count_attempt()
    scope.park({"step": "early"})
    assert released == []
    assert scope.settle(True) is True
    scope.park({"step": "late"})
    assert scope.settle(False) is False
    assert released == [("early", True, 1), ("late", True, 1)]


def test_an_unrecovered_child_hands_its_rows_to_the_parent_that_decides(agent_ns):
    released = []
    cls = agent_ns["StepRecoveryScope"]
    parent = cls(lambda row, recovered, retries: released.append((row["step"], recovered)))
    child = cls(lambda row, recovered, retries: released.append(("child", recovered)), parent=parent)
    child.park({"step": "attempt"})
    child.settle(False)
    assert released == []
    parent.settle(False)
    assert released == [("attempt", False)]


def test_scopes_left_open_are_released_as_warnings_at_finalize(agent_ns):
    agent, rows = _agent(agent_ns)
    scope = agent.recovery_scope()
    previous = agent_ns["_bind_recovery_scope"](scope)
    try:
        agent._emit_status("SCORE_PROMPT", "Score_X", "started", "started", {})
        agent._end_attempt("SCORE_PROMPT", "Score_X", "ended_warning", "SCORE_PROMPT cancelled by its parent task", {})
    finally:
        agent_ns["_bind_recovery_scope"](previous)
    assert all(event["status"] == "started" for event in rows.final().values())
    assert agent.release_open_recoveries() == 1
    assert [event["status"] for event in rows.final().values()] == ["ended_warning"]


def test_recovery_bookkeeping_needs_no_state_from_the_constructor(agent_ns):
    cls = agent_ns["AIAgent"]
    bare = cls.__new__(cls)
    scope = bare.recovery_scope()
    assert scope.settle(True) is True
    assert bare.release_open_recoveries() == 0
    built = make_agent(agent_ns, object(), RecordingLogger())
    assert "_status_lock" not in vars(built)
    assert built._status_lock is bare._status_lock is cls._status_lock


def test_worker_threads_inherit_the_scope_of_the_task_that_submitted_them(agent_ns):
    scope = object()
    seen = []
    previous = agent_ns["_bind_recovery_scope"](scope)
    try:
        with agent_ns["_SafeExecutorContext"](max_workers=2, thread_name_prefix="T", name="T") as ctx:
            futures = [ctx.submit(lambda: seen.append(agent_ns["_current_recovery_scope"]())) for _ in range(3)]
            for future in futures:
                future.result(timeout=5)
    finally:
        agent_ns["_bind_recovery_scope"](previous)
    assert seen == [scope, scope, scope]
