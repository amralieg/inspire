"""v1.3.0: a long parallel wait writes a heartbeat to the run log once a minute, naming its step, so a
live tail can tell slow model calls from a hung driver."""
import ast
import time

from _agentload import agent_ast
from v120_runtime_reliability_test import RecordingLogger


def _beats(log):
    return [msg for level, msg in log.records if level == "INFO" and msg.startswith("[WAIT-HEARTBEAT]")]


def test_a_long_wait_on_an_executor_context_logs_its_step_counts_and_elapsed_time(agent_ns, monkeypatch):
    monkeypatch.setitem(agent_ns, "WAIT_HEARTBEAT_LOG_SECONDS", 0.05)
    log = RecordingLogger()
    with agent_ns["_SafeExecutorContext"](max_workers=2, thread_name_prefix="t", logger=log, name="Translation") as ctx:
        futures = [ctx.submit(time.sleep, 2.5), ctx.submit(time.sleep, 2.5)]
        assert len(list(ctx.completed(futures, timeout=30))) == 2
    beats = _beats(log)
    assert beats, log.records
    assert beats[0].startswith("[WAIT-HEARTBEAT] Translation: 0/2 done, 2 in progress, ")
    assert beats[0].endswith("s elapsed of 30s")


def test_a_wait_shorter_than_a_minute_writes_no_heartbeat(agent_ns):
    log = RecordingLogger()
    with agent_ns["_SafeExecutorContext"](max_workers=1, thread_name_prefix="t", logger=log, name="Quick") as ctx:
        assert len(list(ctx.completed([ctx.submit(time.sleep, 0.1)], timeout=30))) == 1
    assert _beats(log) == []
    assert agent_ns["WAIT_HEARTBEAT_LOG_SECONDS"] == 60


def test_parallel_execution_logs_the_heartbeat_with_its_task_name(agent_ns, monkeypatch):
    monkeypatch.setitem(agent_ns, "WAIT_HEARTBEAT_LOG_SECONDS", 0.05)
    log = RecordingLogger()
    out = agent_ns["ParallelExecutor"].execute_parallel(
        tasks=[(time.sleep, (1.2,)), (time.sleep, (1.2,))], max_workers=2, task_name="Pass 2 generation",
        logger=log, total_timeout=60)
    assert out == [None, None]
    beats = _beats(log)
    assert beats, log.records
    assert beats[0].startswith("[WAIT-HEARTBEAT] Pass 2 generation: 0/2 done, 2 in progress, ")
    assert beats[0].endswith("s elapsed of 60s")


def test_split_retry_scoring_logs_the_heartbeat_with_its_stage_label(agent_ns, monkeypatch):
    from v120_artifacts_support import make_inspire
    monkeypatch.setitem(agent_ns, "WAIT_HEARTBEAT_LOG_SECONDS", 0.05)
    obj = make_inspire(agent_ns)

    def score(label, batch, skip_cache):
        time.sleep(1.2)
        return {uc["No"]: {"ok": True} for uc in batch}
    scores, unscored = obj._score_with_split_retry([{"No": f"U{i}"} for i in range(4)], score, 2, "BestOfBestJudge",
                                                   per_task_timeout=30)
    assert len(scores) == 4 and unscored == {}
    beats = _beats(obj.logger)
    assert beats, obj.logger.records
    assert beats[0].startswith("[WAIT-HEARTBEAT] BestOfBestJudge: 0/2 done, 2 in progress, ")


def test_a_single_long_model_call_writes_its_wait_to_the_run_log_once_a_minute(agent_ns, monkeypatch):
    from v120_runtime_llm_client_test import FakeSpark
    log = RecordingLogger()
    agent = agent_ns["AIAgent"](spark=FakeSpark(responder=lambda query, args: "ok"), logger=log,
                                prompt_templates={"T": "{x}"}, default_timeout_seconds=30,
                                max_retry_attempts=0)
    real = agent_ns["_run_tagged_spark_work"]

    def slow(spark_session, work, timeout_seconds=None, tag_prefix="inspire", label="spark", on_wait=None, logger=None,
             poll_seconds=1.0):
        for elapsed in (61.0, 75.0, 125.0):
            on_wait(elapsed)
        return real(spark_session, work, timeout_seconds=timeout_seconds, tag_prefix=tag_prefix, label=label, logger=logger)
    monkeypatch.setitem(agent_ns, "_run_tagged_spark_work", slow)
    assert agent._call_ai_query("hi", "T")
    waits = [msg for level, msg in log.records if level == "DEBUG" and "Still waiting" in msg]
    assert [msg.split(" elapsed")[0] for msg in waits] == ["[T] Still waiting... 61s", "[T] Still waiting... 125s"]


def test_a_wait_without_a_time_limit_says_so(agent_ns):
    log = RecordingLogger()
    agent_ns["_log_wait_heartbeat"](log, "Genie waves", 1, 3, 2, 61.4, None)
    assert log.records == [("INFO", "[WAIT-HEARTBEAT] Genie waves: 1/3 done, 2 in progress, 61s elapsed with no time limit")]


def test_every_wait_on_an_executor_context_uses_its_named_wait():
    callers = []
    for node in ast.walk(agent_ast()):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for call in ast.walk(node):
                if isinstance(call, ast.Call) and getattr(call.func, "id", "") == "safe_as_completed":
                    callers.append(node.name)
    assert callers == ["completed"], "a direct safe_as_completed call has no step name, so its heartbeat cannot say which step waits"
