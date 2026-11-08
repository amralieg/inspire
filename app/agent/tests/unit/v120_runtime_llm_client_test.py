"""v1.2.0 CORE lane, runtime layer: executor cancellation (A1/A8), LLM client cache key (C-12),
judge retries (C-13), first-attempt budget (C-16), usage counters (C-18), status emission (C-23),
model cascade taxonomy (A7/A10), runtime config (A9), JSON/CSV/log utilities (A4/A11/A13). The A17 event-stream
writer was removed in INTEGRATION-4 because nothing ever bound it to a path (v120_integration_4_test).

Every behavioural test here fails on the v1.1.3 notebook and passes after the fix; filters carry
must-exclude cases so a fix cannot pass by turning the behaviour off.
"""
import ast
import logging
import os
import sys
import threading
import time
import types
import uuid

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import method_node, top_level_defs  # noqa: E402


class FakeSpark:
    def __init__(self, responder=None, delay=0.0):
        self.calls = []
        self._lock = threading.Lock()
        self._responder = responder or (lambda query, args: "ok-response")
        self._delay = delay

    def sql(self, query, args=None):
        with self._lock:
            self.calls.append((query, dict(args or {})))
        if self._delay:
            time.sleep(self._delay)
        text = self._responder(query, args)
        return types.SimpleNamespace(collect=lambda: [types.SimpleNamespace(ai_response=text)])

    def addTag(self, tag):
        return None

    def removeTag(self, tag):
        return None

    def interruptTag(self, tag):
        return None


def _agent(ns, spark, logger_name="v120_runtime"):
    logger = logging.getLogger(logger_name)
    return ns["AIAgent"](spark=spark, logger=logger, prompt_templates={"T": "{x}"}, default_timeout_seconds=30, max_retry_attempts=0)


def _wait_until(predicate, timeout=8.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.02)
    return predicate()


def test_A1_per_task_timeout_cancels_running_task(agent_ns):
    """A1: timeout_per_task used to be checked only after future.done(), so it never bounded a
    running task. It must now cancel the task's in-flight work and report a TimeoutError."""
    PE = agent_ns["ParallelExecutor"]
    is_cancelled = agent_ns["_is_thread_cancelled"]
    seen = {"cancelled_at": None, "calls": 0}

    def slow_llm_like_task():
        start = time.time()
        while time.time() - start < 12:
            if is_cancelled():
                seen["cancelled_at"] = time.time() - start
                raise Exception("Cascade aborted: parent task was cancelled/timed out")
            seen["calls"] += 1
            time.sleep(0.05)
        return "finished"

    t0 = time.time()
    out = PE.execute_parallel(tasks=[slow_llm_like_task], max_workers=1, task_name="T",
                              timeout_per_task=0.3, total_timeout=60, return_exceptions=True)
    assert isinstance(out[0], TimeoutError), f"expected per-task TimeoutError, got {out[0]!r}"
    assert time.time() - t0 < 8, "per-task timeout must not wait for the task's natural end"
    assert _wait_until(lambda: seen["cancelled_at"] is not None), "running task never observed cancellation"
    calls_after_cancel = seen["calls"]
    time.sleep(0.3)
    assert seen["calls"] == calls_after_cancel, "cancelled task kept consuming calls"


def test_A1_per_task_timeout_must_exclude_fast_task(agent_ns):
    PE = agent_ns["ParallelExecutor"]
    out = PE.execute_parallel(tasks=[lambda: "fast", lambda: "also-fast"], max_workers=2, task_name="T",
                              timeout_per_task=30, total_timeout=60, return_exceptions=True)
    assert out == ["fast", "also-fast"]


def test_A1_results_align_with_tasks_on_mixed_outcomes(agent_ns):
    PE = agent_ns["ParallelExecutor"]
    is_cancelled = agent_ns["_is_thread_cancelled"]

    def ok():
        return 1

    def boom():
        raise ValueError("boom")

    def hang():
        while not is_cancelled():
            time.sleep(0.02)
        raise Exception("aborted")

    out = PE.execute_parallel(tasks=[ok, boom, hang], max_workers=3, task_name="T",
                              timeout_per_task=0.2, total_timeout=6, return_exceptions=True)
    assert len(out) == 3
    assert out[0] == 1
    assert isinstance(out[1], ValueError)
    assert isinstance(out[2], TimeoutError)


def test_A8_safe_executor_mark_timed_out_reaches_running_task(agent_ns):
    """A8: _SafeExecutorContext.mark_timed_out() only cancelled queued futures; a running LLM
    task kept cascading. Its threads must now observe the cancellation."""
    Ctx = agent_ns["_SafeExecutorContext"]
    is_cancelled = agent_ns["_is_thread_cancelled"]
    observed = threading.Event()

    def task():
        start = time.time()
        while time.time() - start < 10:
            if is_cancelled():
                observed.set()
                return "aborted"
            time.sleep(0.02)
        return "ran-to-end"

    with Ctx(max_workers=1, name="A8") as ctx:
        fut = ctx.submit(task)
        time.sleep(0.2)
        ctx.mark_timed_out()
    assert observed.wait(3), "running task never saw mark_timed_out()"
    assert fut.result(timeout=3) == "aborted"


def test_A8_safe_executor_must_exclude_normal_completion(agent_ns):
    Ctx = agent_ns["_SafeExecutorContext"]
    is_cancelled = agent_ns["_is_thread_cancelled"]
    with Ctx(max_workers=2, name="A8ok") as ctx:
        futs = [ctx.submit(lambda: is_cancelled()) for _ in range(4)]
        results = [f.result(timeout=5) for f in futs]
    assert results == [False, False, False, False]


def test_A8_nested_executor_inherits_parent_cancellation(agent_ns):
    """A task running inside an outer executor submits work to an inner executor. When the outer
    task is cancelled, the inner thread must stop too (it used to be unregistered)."""
    PE = agent_ns["ParallelExecutor"]
    Ctx = agent_ns["_SafeExecutorContext"]
    is_cancelled = agent_ns["_is_thread_cancelled"]
    inner_saw_cancel = threading.Event()

    def inner():
        start = time.time()
        while time.time() - start < 10:
            if is_cancelled():
                inner_saw_cancel.set()
                return "inner-aborted"
            time.sleep(0.02)
        return "inner-finished"

    def outer():
        with Ctx(max_workers=1, name="inner") as ctx:
            fut = ctx.submit(inner)
            return fut.result(timeout=15)

    PE.execute_parallel(tasks=[outer], max_workers=1, task_name="outer", timeout_per_task=0.3,
                        total_timeout=60, return_exceptions=True)
    assert inner_saw_cancel.wait(5), "inner thread did not inherit the outer task's cancellation"


def test_A8_timeout_handler_cancels_function(agent_ns):
    TH = agent_ns["TimeoutHandler"]
    is_cancelled = agent_ns["_is_thread_cancelled"]
    saw = threading.Event()

    def func():
        start = time.time()
        while time.time() - start < 10:
            if is_cancelled():
                saw.set()
                return None
            time.sleep(0.02)

    assert TH.execute_with_timeout(func, timeout_seconds=0.3, fallback="fb") == "fb"
    assert saw.wait(3), "function kept running after TimeoutHandler gave up"


def test_A1_cancellable_sleep(agent_ns):
    sleep_fn = agent_ns["_cancellable_sleep"]
    register = agent_ns["_register_thread_cancel"]
    unregister = agent_ns["_unregister_thread_cancel"]
    t0 = time.time()
    assert sleep_fn(0.2) is False
    assert time.time() - t0 >= 0.18
    ev = threading.Event()
    ev.set()
    register(ev)
    try:
        t1 = time.time()
        assert sleep_fn(30) is True
        assert time.time() - t1 < 2
    finally:
        unregister()


def test_A1_manager_acquire_aborts_when_cancelled(agent_ns):
    Mgr = agent_ns["AIAgentManager"]
    register = agent_ns["_register_thread_cancel"]
    unregister = agent_ns["_unregister_thread_cancel"]
    mgr = Mgr(max_concurrent_ai_calls=1, fallback_chain=[])
    mgr.acquire()
    outcome = {}

    def waiter():
        ev = threading.Event()
        register(ev)
        threading.Timer(0.3, ev.set).start()
        try:
            mgr.acquire()
            outcome["acquired"] = True
        except Exception as e:
            outcome["error"] = str(e)
        finally:
            unregister()

    t = threading.Thread(target=waiter, daemon=True)
    t.start()
    t.join(5)
    try:
        assert "error" in outcome and "cancelled" in outcome["error"], outcome
        assert not mgr._semaphore.acquire(blocking=False), "aborted waiter must not hold a slot"
    finally:
        mgr.release()


def test_C12_cache_key_includes_temperature_tokens_and_format(fresh_ns):
    spark = FakeSpark()
    agent = _agent(fresh_ns, spark)
    agent.enable_llm_cache(f"v120c12_{uuid.uuid4().hex[:8]}")
    try:
        agent._call_ai_query("same prompt", "SUMMARY_GEN_PROMPT")
        assert len(spark.calls) == 1
        agent._call_ai_query("same prompt", "SUMMARY_GEN_PROMPT")
        assert len(spark.calls) == 1, "identical request must still be served from cache"
        agent._call_ai_query("same prompt", "SUMMARY_GEN_PROMPT", temperature_override=0.9)
        assert len(spark.calls) == 2, "a different temperature must not reuse the cached answer"
        schema = {"name": "s", "schema": {"type": "object"}}
        agent._call_ai_query("same prompt", "SUMMARY_GEN_PROMPT", response_schema=schema)
        assert len(spark.calls) == 2, "an endpoint the probe did not clear gets the plain request, so its answer is reused"
        first = agent._manager.build_full_cascade("SUMMARY_GEN_PROMPT")[0]["llm_endpoint_name"]
        fresh_ns["LLM_ENDPOINT_HEALTH"].mark_json_format(first, True)
        agent._call_ai_query("same prompt", "SUMMARY_GEN_PROMPT", response_schema=schema)
        assert len(spark.calls) == 3, "a different response format must not reuse the cached answer"
    finally:
        agent.cleanup_llm_cache()


def test_C12_skip_cache_forces_fresh_call(fresh_ns):
    spark = FakeSpark()
    agent = _agent(fresh_ns, spark)
    agent.enable_llm_cache(f"v120c12b_{uuid.uuid4().hex[:8]}")
    try:
        agent._call_ai_query("p", "SUMMARY_GEN_PROMPT", temperature_override=0.2)
        agent._call_ai_query("p", "SUMMARY_GEN_PROMPT", temperature_override=0.2, skip_cache=True)
        assert len(spark.calls) == 2
    finally:
        agent.cleanup_llm_cache()


def test_C13_run_worker_judge_uses_prompt_names_and_skip_cache(fresh_ns):
    spark = FakeSpark()
    agent = _agent(fresh_ns, spark)
    agent.prompt_templates = {"W_PROMPT": "worker {x}", "J_PROMPT": "judge {x} {llm1_output} {llm2_output}"}
    recorded = []

    def fake_call(prompt, prompt_name, response_schema=None, **kw):
        recorded.append((prompt_name, kw.get("skip_cache", False), kw.get("display_name")))
        return '{"domains": [{"domain": "A"}]}' if prompt_name == "W_PROMPT" and len(recorded) % 2 else '{"domains": [{"domain": "B"}]}'

    agent._call_ai_query = fake_call
    attempts = {"n": 0}

    def validation(json_str, task):
        attempts["n"] += 1
        if attempts["n"] == 1:
            raise ValueError("first answer rejected")

    agent.run_worker_judge("Step", "W_PROMPT", "J_PROMPT", {"x": 1}, None,
                           {"MAX_RETRIES": 2, "PROMPT_VARIABLES": {}},
                           task_info_lambda=lambda v: ("domains", ""), validation_lambda=validation)
    names = {r[0] for r in recorded}
    assert names <= {"W_PROMPT", "J_PROMPT"}, f"step names leaked into prompt_name: {names}"
    first_attempt = recorded[:3]
    second_attempt = recorded[3:]
    assert first_attempt[0][1] is False, "first worker of first attempt may use the cache"
    assert first_attempt[1][1] is True, "second worker must ask for an independent sample"
    assert second_attempt and all(r[1] is True for r in second_attempt), "retries must bypass the cache"


def test_C16_every_attempt_uses_full_budget():
    node = method_node("AIAgent", "_call_ai_query_impl")
    assigned = [n for n in ast.walk(node) if isinstance(n, ast.Assign)
                and any(isinstance(t, ast.Name) and t.id == "_attempt_timeout" for t in n.targets)]
    assert assigned, "_attempt_timeout must still be assigned"
    for a in assigned:
        assert isinstance(a.value, ast.Name) and a.value.id == "timeout_val", ast.unparse(a)


def test_C18_usage_counters_are_lock_guarded():
    node = method_node("AIAgent", "_call_ai_query_impl")
    guarded = False
    for w in ast.walk(node):
        if isinstance(w, ast.With) and "_usage_stats_lock" in ast.unparse(w.items[0].context_expr):
            body = "\n".join(ast.unparse(b) for b in w.body)
            guarded = "_total_ai_calls += 1" in body and "_step_stats[prompt_name]['calls'] += 1" in body
    assert guarded


def test_C18_usage_counters_exact_under_concurrency(fresh_ns):
    spark = FakeSpark()
    agent = _agent(fresh_ns, spark)
    AIAgent = fresh_ns["AIAgent"]
    before = AIAgent._total_ai_calls

    def worker(i):
        for j in range(10):
            agent._call_ai_query(f"p-{i}-{j}", "SUMMARY_GEN_PROMPT")

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(60)
    assert AIAgent._total_ai_calls - before == 80
    assert AIAgent._step_stats["SUMMARY_GEN_PROMPT"]["calls"] >= 80


def test_C23_status_emitter_failure_is_logged_once(fresh_ns, caplog):
    def broken_emitter(**kw):
        raise RuntimeError("emitter down")

    agent = fresh_ns["AIAgent"](spark=FakeSpark(), logger=logging.getLogger("v120_c23"),
                                prompt_templates={"T": "x"}, status_emitter=broken_emitter)
    with caplog.at_level(logging.DEBUG, logger="v120_c23"):
        agent._emit_status("P", "S", "started", "m")
        agent._emit_status("P", "S", "ended_success", "m")
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING and "Status emission failed" in r.getMessage()]
    debugs = [r for r in caplog.records if r.levelno == logging.DEBUG and "Status emission failed" in r.getMessage()]
    assert len(warnings) == 1
    assert len(debugs) == 1


def test_A7_auto_detect_preserves_size_taxonomy(agent_ns):
    from unittest.mock import MagicMock, patch

    class EP:
        def __init__(self, name):
            self.name = name

    class WC:
        def __init__(self):
            self.serving_endpoints = types.SimpleNamespace(list=lambda: iter([
                EP("databricks-claude-opus-4-6"), EP("databricks-claude-sonnet-4-6"),
                EP("databricks-gpt-oss-120b"), EP("databricks-gpt-oss-20b")]))

    with patch("databricks.sdk.WorkspaceClient", WC):
        ranked = agent_ns["_auto_detect_llm_endpoints"](MagicMock(), max_endpoints=6)
    by_name = {m["llm_endpoint_name"]: (m["type"], m["size"]) for m in ranked}
    assert by_name["databricks-gpt-oss-120b"] == ("worker", "small")
    assert by_name["databricks-gpt-oss-20b"] == ("worker", "tiny")
    assert by_name["databricks-claude-opus-4-6"] == ("thinker", "large")
    assert by_name["databricks-claude-sonnet-4-6"] == ("worker", "large")


def test_A7_empty_tiny_bucket_cascades_to_nearest_not_opus(fresh_ns):
    tc = fresh_ns["TECHNICAL_CONTEXT"]
    tc["models"] = [m for m in tc["models"] if m["size"] != "tiny"]
    cascade = fresh_ns["get_full_fallback_cascade"]("USE_CASE_TRANSLATE_PROMPT")
    assert cascade, "a prompt whose bucket is empty must still get a cascade"
    assert cascade[0]["size"] == "small", f"nearest bucket first, got {[m['name'] for m in cascade]}"
    assert cascade[0]["type"] != "thinker" or cascade[0]["size"] != "large"
    sizes = [m["size"] for m in cascade]
    assert sizes.index("small") < sizes.index("large")


def test_A7_populated_bucket_must_exclude_backward_models(agent_ns):
    cascade = agent_ns["get_full_fallback_cascade"]("USE_CASE_TRANSLATE_PROMPT")
    assert [m["size"] for m in cascade] == ["tiny"], "a populated bucket must not pull in larger models"


def test_A7_apply_restores_models_when_validation_fails(fresh_ns):
    from unittest.mock import MagicMock
    tc = fresh_ns["TECHNICAL_CONTEXT"]
    original = list(tc["models"])
    fresh_ns["_auto_detect_llm_endpoints"] = lambda logger, max_endpoints=6: [
        {"name": "x", "order": 1, "type": "thinker", "size": "large", "enabled": True,
         "llm_endpoint_name": "databricks-x", "llm_input_context_tokens_count": 1000,
         "llm_output_context_tokens_count": 100}]

    def failing_validation():
        raise ValueError("forced")

    fresh_ns["_validate_model_config"] = failing_validation
    assert fresh_ns["_apply_auto_detected_endpoints"](MagicMock()) is False
    assert tc["models"] == original


def test_A10_cascade_helpers_share_one_source_of_truth(agent_ns):
    for pm in agent_ns["TECHNICAL_CONTEXT"]["prompts_models"]:
        name = pm["prompt_name"]
        assert agent_ns["get_model_cascade_for_prompt"](name) == agent_ns["get_full_fallback_cascade"](name)
    assert agent_ns["get_model_cascade_for_prompt"]("Assign_User_Domains_English") == \
        agent_ns["get_full_fallback_cascade"]("Assign_User_Domains_English")


def test_A10_config_helper_follows_runtime_cascade_when_bucket_empty(fresh_ns):
    tc = fresh_ns["TECHNICAL_CONTEXT"]
    tc["models"] = [m for m in tc["models"] if m["size"] != "tiny"]
    cfg = fresh_ns["get_model_config_for_prompt"]("USE_CASE_TRANSLATE_PROMPT")
    assert cfg["size"] == "small", cfg


def test_A9_runtime_keys_documented_and_bounded(agent_ns):
    rt = agent_ns["TECHNICAL_CONTEXT"]["runtime"]
    assert rt["bob_scoring_batch_size"] == 25
    assert rt["bob_theme_max_share"] == 0.15
    assert rt["genie_regen_parallelism"] == 10
    assert 0 <= rt["scoring_split_retry_rounds"] <= 4


@pytest.mark.parametrize("key,bad", [("bob_scoring_batch_size", 1000), ("bob_theme_max_share", 3.0),
                                     ("pass2_temperature", 5.0), ("scoring_split_retry_rounds", 9)])
def test_A9_runtime_validation_rejects_out_of_bounds(fresh_ns, key, bad):
    fresh_ns["TECHNICAL_CONTEXT"]["runtime"][key] = bad
    with pytest.raises(ValueError):
        fresh_ns["_validate_runtime_config"]()


def test_A9_runtime_validation_rejects_missing_key(fresh_ns):
    del fresh_ns["TECHNICAL_CONTEXT"]["runtime"]["bob_scoring_batch_size"]
    with pytest.raises(ValueError):
        fresh_ns["_validate_runtime_config"]()


def test_A11_clean_json_response_ignores_braces_inside_strings(agent_ns):
    import json
    clean = agent_ns["clean_json_response"]
    raw = 'Result follows: {"summary": "uses `{col}` and closes }", "items": [1, 2]} trailing words'
    assert json.loads(clean(raw)) == {"summary": "uses `{col}` and closes }", "items": [1, 2]}
    raw2 = '[{"q": "he said \\"]\\" then left"}, {"q": "ok"}] extra ] text'
    assert json.loads(clean(raw2)) == [{"q": 'he said "]" then left'}, {"q": "ok"}]


def test_A11_clean_json_response_plain_objects_unchanged(agent_ns):
    import json
    clean = agent_ns["clean_json_response"]
    assert json.loads(clean('```json\n{"a": {"b": 1}}\n```')) == {"a": {"b": 1}}


def test_A13_duplicate_filter_never_suppresses_errors(agent_ns):
    F = agent_ns["DuplicateMessageFilter"]
    f = F(window_seconds=60)

    def rec(level):
        return logging.LogRecord("n", level, __file__, 1, "same message", None, None)

    assert f.filter(rec(logging.ERROR)) is True
    assert f.filter(rec(logging.ERROR)) is True
    assert f.filter(rec(logging.CRITICAL)) is True
    assert f.filter(rec(logging.CRITICAL)) is True
    assert f.filter(rec(logging.INFO)) is True
    assert f.filter(rec(logging.INFO)) is False, "duplicate INFO must still be suppressed"


def test_A4_csv_parser_keeps_rows_with_huge_fields(agent_ns):
    parser = agent_ns["CSVParser"]
    big = "x" * 200000
    rows = parser.parse_csv_string(f'"a","b"\n"{big}","2"\n"small","3"\n')
    assert len(rows) == 2 and rows[0]["a"] == big and rows[1]["b"] == "3"


def test_A4_csv_parser_strips_nul_bytes(agent_ns):
    parser = agent_ns["CSVParser"]
    rows = parser.parse_csv_string('"a","b"\n"x\x00y","2"\n')
    assert rows == [{"a": "xy", "b": "2"}]
    assert parser.parse_csv_list('"a","b"\n"x\x00y","2"\n') == [["a", "b"], ["xy", "2"]]


def test_A8_safe_executor_shutdown_cancels_pending_work(agent_ns):
    Ctx = agent_ns["_SafeExecutorContext"]
    is_cancelled = agent_ns["_is_thread_cancelled"]
    saw = threading.Event()

    def task():
        start = time.time()
        while time.time() - start < 10:
            if is_cancelled():
                saw.set()
                return "aborted"
            time.sleep(0.02)

    ctx = Ctx(max_workers=1, name="DocGenLike")
    ctx.submit(task)
    time.sleep(0.2)
    ctx.mark_timed_out()
    ctx.shutdown()
    assert saw.wait(3)
