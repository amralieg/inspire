"""v1.9.1 every step a run opens is closed, and a failed run ends as failed.

A Started row is closed on its own row, every exit of a step (normal, early return, error,
cancel) closes it, a failed run closes what it left open as errors, and a successful run closes
leftovers as warnings. A failed run records that it ended, never 100% and never ready.
"""
import ast
import os
import sys
from collections import Counter

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import agent_ast  # noqa: E402
from v120_artifacts_support import CapturingLogger  # noqa: E402
from v190_progress_and_recovery_test import _ViewSpark, _agent, _emit_rows, _plan, _session_percent, _stop, _writer  # noqa: E402


class _Steps:
    def __init__(self):
        self.events = []
        self.flushes = []
        self.finalized = []
        self.next_id = 0

    def emit_step(self, **kw):
        step_id = kw.get("step_id")
        if step_id is None:
            self.next_id += 1
            step_id = self.next_id
        self.events.append(dict(kw, step_id=step_id))
        return step_id

    def flush_pending(self, **kw):
        self.flushes.append(kw)

    def finalize_pipeline(self, **kw):
        self.finalized.append(kw)

    def final(self):
        last = {}
        for event in self.events:
            last[event["step_id"]] = event
        return last


def _inspire(ns, agent=None):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = CapturingLogger()
    obj.atomic_writer = _Steps()
    obj.ailogs_check = {}
    obj.session_id = 4242
    obj._merge_run_outcome_into_results = lambda: {}
    obj._run_outcome_warnings = lambda: []
    if agent is not None:
        obj.ai_agent = agent
    return obj


def _start(obj, stage, step, sub="Started"):
    return obj._emit_pipeline_status(stage_name=stage, step_name=step, sub_step_name=sub, message=f"{step} started",
                                     status="started")


def test_an_ended_step_closes_its_started_row_with_no_setup(agent_ns):
    obj = _inspire(agent_ns)
    first = _start(obj, "Data Preparation", "Filter Business Tables")
    other = _start(obj, "Domain Mapping", "Clustering")
    obj._emit_pipeline_status(stage_name="Data Preparation", step_name="Filter Business Tables", sub_step_name="Complete",
                              message="done", status="ended_success")
    final = obj.atomic_writer.final()
    assert set(final) == {first, other}, final
    assert final[first]["status"] == "ended_success"
    assert final[other]["status"] == "started"
    assert [step for _id, _stage, step, _sub in obj._pipeline_open_steps().values()] == ["Clustering"]


def test_an_ended_step_with_no_open_row_writes_a_row_of_its_own(agent_ns):
    obj = _inspire(agent_ns)
    _start(obj, "A", "One")
    ended = obj._emit_pipeline_status(stage_name="A", step_name="Two", sub_step_name="Complete", message="done",
                                      status="ended_success")
    assert len(obj.atomic_writer.final()) == 2
    assert obj.atomic_writer.final()[ended]["status"] == "ended_success"
    assert len(obj._pipeline_open_steps()) == 1


def test_a_failed_run_closes_every_step_it_left_open_as_an_error(agent_ns):
    agent, rows = _agent(agent_ns)
    obj = _inspire(agent_ns, agent)
    obj._pipeline_start_step_id = _start(obj, "Pipeline", "Execution")
    left = [_start(obj, "Use Cases Generation", "Pass 1 batch 3"), _start(obj, "Domain Mapping", "Clustering")]
    agent._emit_status("SCORE_PROMPT", "Score_X", "started", "scoring", {})
    obj.finalize_atomic_writer(success=False, error_message="boom")
    final = obj.atomic_writer.final()
    assert {final[step]["status"] for step in left} == {"ended_error"}, final
    assert final[obj._pipeline_start_step_id]["status"] == "ended_error"
    assert all(event["status"] != "started" for event in final.values()), final
    assert all(event["status"] != "started" for event in rows.final().values()), rows.final()
    assert obj.atomic_writer.flushes[-1]["failed"] is True
    assert obj.atomic_writer.flushes[-1]["finalize"] is True
    assert not obj._pipeline_open_steps()


def test_a_successful_run_closes_leftover_steps_as_warnings_and_says_so(agent_ns):
    agent, rows = _agent(agent_ns)
    obj = _inspire(agent_ns, agent)
    obj._pipeline_start_step_id = _start(obj, "Pipeline", "Execution")
    leftover = _start(obj, "Use Case Prioritization", "Global Semantic Dedup")
    agent._emit_status("SCORE_PROMPT", "Score_Y", "started", "scoring", {})
    obj.finalize_atomic_writer(success=True)
    assert obj.atomic_writer.final()[leftover]["status"] == "ended_warning"
    assert obj.atomic_writer.final()[leftover]["result_json"] == {"closed_at_finalize": True}
    assert [event["status"] for event in rows.final().values()] == ["ended_warning"]
    warned = [msg for level, msg in obj.logger.records if level == "WARNING" and "[OPEN-STEPS CLOSED]" in msg]
    assert len(warned) == 1 and "Global Semantic Dedup" in warned[0] and "SCORE_PROMPT / Score_Y" in warned[0], warned
    assert obj.atomic_writer.finalized[-1]["status"] == "ended_success"


def test_a_successful_run_with_nothing_open_logs_no_closing(agent_ns):
    obj = _inspire(agent_ns)
    obj._pipeline_start_step_id = _start(obj, "Pipeline", "Execution")
    obj.finalize_atomic_writer(success=True)
    assert not [msg for _level, msg in obj.logger.records if "[OPEN-STEPS CLOSED]" in msg]
    assert len(obj.atomic_writer.events) == 1


def test_the_llm_agent_closes_the_attempts_it_still_has_open(agent_ns):
    agent, rows = _agent(agent_ns)
    agent._emit_status("SCORE_PROMPT", "Score_A", "started", "a", {})
    agent._emit_status("TRANSLATE_PROMPT", "Arabic", "started", "b", {})
    agent._emit_status("TRANSLATE_PROMPT", "Arabic", "ended_success", "done", {})
    closed = agent.close_open_steps("ended_error", "Pipeline failed")
    assert closed == ["SCORE_PROMPT / Score_A"]
    by_step = {event["step"]: event for event in rows.final().values()}
    assert by_step["Score_A"]["status"] == "ended_error" and by_step["Score_A"]["payload"].get("closed_at_finalize") is True
    assert by_step["Arabic"]["status"] == "ended_success"
    assert agent.close_open_steps("ended_error", "again") == []


def test_a_pipeline_step_closes_on_every_way_out(agent_ns):
    obj = _inspire(agent_ns)

    with obj._pipeline_step("S", "Normal", "working") as run:
        pass
    normal = obj.atomic_writer.final()[run.step_id]
    assert normal["status"] == "ended_success"

    def early():
        with obj._pipeline_step("S", "Early", "working") as step:
            step.finish("ended_warning", "Nothing to do")
            return step
    early_run = early()
    assert obj.atomic_writer.final()[early_run.step_id]["status"] == "ended_warning"
    assert "Nothing to do" in obj.atomic_writer.final()[early_run.step_id]["message"]

    with pytest.raises(ValueError):
        with obj._pipeline_step("S", "Broken", "working") as broken:
            raise ValueError("bad input")
    failed = obj.atomic_writer.final()[broken.step_id]
    assert failed["status"] == "ended_error"
    assert "bad input" in failed["result_json"]["error"]

    with pytest.raises(KeyboardInterrupt):
        with obj._pipeline_step("S", "Stopped", "working") as stopped:
            raise KeyboardInterrupt()
    cancelled = obj.atomic_writer.final()[stopped.step_id]
    assert cancelled["status"] == "ended_error"
    assert cancelled["result_json"]["error"] == agent_ns["INSPIRE_RUN_CANCELLED"] == agent_ns["inspire_run_stop_reason"](KeyboardInterrupt())
    assert len(obj.atomic_writer.final()) == 4
    assert not obj._pipeline_open_steps()


def test_a_pipeline_step_runs_its_work_when_status_rows_cannot_be_written(agent_ns):
    obj = _inspire(agent_ns)

    def refuse(**kw):
        raise RuntimeError("table is gone")
    obj.atomic_writer.emit_step = refuse
    ran = []
    with obj._pipeline_step("S", "Work", "working") as run:
        ran.append(True)
    assert ran == [True] and run.step_id is None


def _keyword(call, name):
    for keyword in call.keywords:
        if keyword.arg == name:
            return keyword.value
    return None


def _text(node):
    return node.value if isinstance(node, ast.Constant) else None


def test_every_started_pipeline_row_has_an_end_in_the_same_function():
    tree = agent_ast()
    parents = {child: node for node in ast.walk(tree) for child in ast.iter_child_nodes(node)}
    unclosed, checked = [], 0
    for function in ast.walk(tree):
        if not isinstance(function, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        started, ended = [], set()
        for node in ast.walk(function):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "_emit_pipeline_status":
                pair = (_text(_keyword(node, "stage_name")), _text(_keyword(node, "step_name")))
                if _text(_keyword(node, "status")) == "started":
                    started.append((node, pair))
                else:
                    ended.add(pair)
        for node, pair in started:
            checked += 1
            if isinstance(parents.get(node), ast.Expr) and pair not in ended:
                unclosed.append((function.name, node.lineno, pair))
    assert checked >= 6
    assert not unclosed, unclosed


def test_every_kept_started_row_id_is_read_back_to_close_it():
    tree = agent_ast()
    parents = {child: node for node in ast.walk(tree) for child in ast.iter_child_nodes(node)}
    uses = Counter(node.attr for node in ast.walk(tree) if isinstance(node, ast.Attribute))
    uses.update(node.value for node in ast.walk(tree) if isinstance(node, ast.Constant) and isinstance(node.value, str))
    lost = []
    for function in ast.walk(tree):
        if not isinstance(function, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        loaded = {node.id for node in ast.walk(function) if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load)}
        for node in ast.walk(function):
            if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr == "_emit_pipeline_status" and _text(_keyword(node, "status")) == "started"):
                continue
            holder = parents.get(node)
            if not isinstance(holder, ast.Assign):
                continue
            for target in holder.targets:
                if isinstance(target, ast.Name) and target.id not in loaded:
                    lost.append((function.name, node.lineno, target.id))
                if isinstance(target, ast.Attribute) and uses[target.attr] < 2:
                    lost.append((function.name, node.lineno, target.attr))
    assert not lost, lost


def test_the_failed_run_rows_close_the_pipeline_start_row(agent_ns):
    obj = _inspire(agent_ns)
    obj._pipeline_start_step_id = _start(obj, "Pipeline", "Execution")
    obj.finalize_atomic_writer(success=False, error_message="boom")
    final = obj.atomic_writer.final()
    assert len(final) == 1 and final[obj._pipeline_start_step_id]["status"] == "ended_error"


def _finalize_statements(spark):
    return [s for s in spark.statements if "__inspire_session" in s and s.startswith("UPDATE") and "completed_on" in s]


def test_a_failed_run_records_that_it_ended_failed_and_never_reaches_100(agent_ns, tmp_path, monkeypatch):
    spark = _ViewSpark()
    writer = _writer(agent_ns, spark, tmp_path, monkeypatch, operation="Discover Use Cases")
    try:
        _plan(writer)
        _emit_rows(writer, "Setup", 3, "Setup")
        writer.flush_pending(force=True)
        writer.flush_pending(force=True, finalize=True, final_results_json=None, failed=True)
        _emit_rows(writer, "Use Case Design", 4, "Late")
        writer.flush_pending(force=True)
    finally:
        _stop(writer)
    final = _finalize_statements(spark)
    assert len(final) == 1, final
    assert f"processing_status = '{agent_ns['INSPIRE_SESSION_FAILED']}'" in final[0]
    assert "completed_on = TIMESTAMP(" in final[0]
    assert '"completed": false' in final[0]
    assert "completed_percent = 100.0" not in final[0]
    assert 0 < _session_percent(spark) < 100
    after = spark.statements[spark.statements.index(final[0]) + 1:]
    assert not [s for s in after if "__inspire_session" in s and "processing_status" in s], after


def test_a_successful_run_still_ends_at_100_and_ready(agent_ns, tmp_path, monkeypatch):
    spark = _ViewSpark()
    writer = _writer(agent_ns, spark, tmp_path, monkeypatch, operation="Discover Use Cases")
    try:
        _plan(writer)
        _emit_rows(writer, "Setup", 3, "Setup")
        writer.flush_pending(force=True, finalize=True, final_results_json=None)
    finally:
        _stop(writer)
    final = _finalize_statements(spark)
    assert len(final) == 1
    assert "processing_status = 'ready'" in final[0] and "completed_percent = 100.0" in final[0]
    assert '"completed": true' in final[0]
    assert _session_percent(spark) == 100.0


def test_a_cancelled_run_is_finalized_as_failed_before_the_cancel_goes_on():
    main = next(node for node in agent_ast().body if isinstance(node, ast.FunctionDef) and node.name == "main")
    handlers = [h for node in ast.walk(main) if isinstance(node, ast.Try) for h in node.handlers
                if isinstance(h.type, ast.Name) and h.type.id == "KeyboardInterrupt"]
    assert len(handlers) == 1, handlers
    calls = [node for node in ast.walk(handlers[0]) if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
             and node.func.attr == "finalize_atomic_writer"]
    assert len(calls) == 1
    success, reason = _keyword(calls[0], "success"), _keyword(calls[0], "error_message")
    assert isinstance(success, ast.Constant) and success.value is False
    assert isinstance(reason, ast.Name) and reason.id == "INSPIRE_RUN_CANCELLED", "a cancel carries no error text to redact"
    assert isinstance(handlers[0].body[-1], ast.Raise)
