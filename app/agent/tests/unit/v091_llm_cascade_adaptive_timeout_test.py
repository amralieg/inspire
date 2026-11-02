"""Fix #5: LLM cascade adaptive timeout + batch-split fallback on exhaustion.

Evidence:
- tpcds v152 log lines 590-687: opus-4-6 timed out at 375s, sonnet-4-6 at 590s,
  opus-4-5 at 154s. Each model got the same fixed timeout budget. When the
  cascade exhausted on timeouts, the caller received a raw Exception (not
  CascadeRebatchError), so the batch was silently dropped -> 0 use cases from
  a large-corpus batch.

v0.9.0 base bug (agent/dbx_inspire_ai_agent.ipynb `_call_ai_query_impl`):
1. `timeout_val` is a single value applied uniformly to every model attempt in
   the cascade, regardless of prompt size. A 200,000-char prompt gets the same
   300s budget as a 20,000-char prompt.
2. Each retry attempt uses the same `timeout_val` -- no fail-fast on 1st attempt.
3. On cascade exhaustion where the last error was a timeout, the raw exception
   is raised. Callers only catch `CascadeRebatchError`, so timeout exhaustion
   is treated as a hard failure with no batch-split retry.

Fix (single commit, root cause per Section 3):
1. Adaptive-timeout scaling: `_adaptive_timeout = base * min(6, prompt_size /
   40000)` -- large prompts get proportionally more time.
2. Fail-fast 1st attempt: `_attempt_timeout = max(60, timeout_val // 2 + 30)` on
   attempt 1 to detect stuck LLMs quickly; full budget on attempts >= 2.
3. Cascade exhaustion with timeout errors raises `CascadeRebatchError` targeting
   half the smallest-model context limit so the caller splits the batch and
   retries with smaller chunks -- 0-UC batches no longer happen silently.
4. Sentinel `[LLM_CASCADE_ADAPTIVE_TIMEOUT FIRED]` emitted on both scaling and
   cascade-exhaustion paths.
"""
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import load_agent_namespace


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def _notebook_body():
    return (Path(__file__).resolve().parents[2] / "agent" / "dbx_inspire_ai_agent.ipynb").read_text()


def test_adaptive_timeout_multiplier_declared(ns):
    body = _notebook_body()
    assert "_adaptive_baseline_chars = 40000" in body, "baseline char threshold must be declared"
    assert "_adaptive_max_multiplier = 6" in body, "max multiplier cap must be declared"
    assert "_size_multiplier = max(1.0, min(" in body, "size multiplier formula must be present"


def test_adaptive_timeout_applied_before_cascade(ns):
    body = _notebook_body()
    idx_apply = body.find("timeout_val = _adaptive_timeout")
    idx_cascade = body.find("# --- Build model cascade ---")
    assert idx_apply != -1, "adaptive timeout must be applied to timeout_val"
    assert idx_cascade != -1, "cascade build anchor must exist"
    assert idx_apply < idx_cascade, "adaptive timeout must be computed BEFORE cascade is built"


def test_adaptive_timeout_sentinel_present(ns):
    body = _notebook_body()
    assert "[LLM_CASCADE_ADAPTIVE_TIMEOUT FIRED]" in body, \
        "must emit [LLM_CASCADE_ADAPTIVE_TIMEOUT FIRED] on adaptive scaling"


def test_first_attempt_gets_full_budget(ns):
    """C-16 (v1.2.0): the half-budget fail-fast first attempt was removed. A timeout on a
    shortened first attempt skipped the same-model retry (G31) and cascaded, so slow-but-viable
    primary models were abandoned and every abandoned call was paid for again downstream."""
    body = _notebook_body()
    assert "if attempt == 1 and attempts_per_model > 1:" not in body, \
        "fail-fast first-attempt branch must be gone (C-16)"
    assert "_attempt_timeout = max(60, int(timeout_val * 0.5) + 30)" not in body, \
        "half-budget first-attempt formula must be gone (C-16)"
    assert "_attempt_timeout = timeout_val" in body, \
        "every attempt must use the full adaptive timeout_val budget"


def test_poll_loop_uses_attempt_timeout_not_timeout_val(ns):
    """v1.2.0 RUNTIME: the poll loop moved into `_run_tagged_spark_work` (shared with metadata queries and the
    endpoint probe); the per-attempt budget it enforces is still `_attempt_timeout`."""
    import ast
    from _agentload import method_node
    body = _notebook_body()
    calls = [n for n in ast.walk(method_node("AIAgent", "_call_ai_query_impl"))
             if isinstance(n, ast.Call) and getattr(n.func, "id", None) == "_run_tagged_spark_work"]
    assert calls, "_call_ai_query_impl must run ai_query through _run_tagged_spark_work"
    budgets = [ast.unparse(k.value) for c in calls for k in c.keywords if k.arg == "timeout_seconds"]
    assert budgets == ["_attempt_timeout"], f"per-attempt budget must be _attempt_timeout, got {budgets}"
    assert "if timeout_seconds and elapsed >= timeout_seconds:" in body, \
        "the runner must enforce the budget it is given"
    assert "LLM call timed out after {_attempt_timeout} seconds" in body, \
        "post-thread-alive timeout raise must use _attempt_timeout"
    assert "timeout: {_attempt_timeout}s" in body, \
        "heartbeat log must show _attempt_timeout"


def test_cascade_exhaustion_on_timeout_raises_rebatch(ns):
    body = _notebook_body()
    assert "_is_timeout_exhaustion = any(_k in _err_msg_lower for _k in ('timeout', 'timed out', 'deadline', 'time limit'))" in body, \
        "timeout exhaustion detection must scan last_error message"
    assert "if _is_timeout_exhaustion and len(model_cascade) > 0:" in body, \
        "timeout branch must guard on cascade presence"
    assert "raise CascadeRebatchError(f\\\"Cascade exhausted on timeout" in body, \
        "cascade-exhaustion path must raise CascadeRebatchError"
    assert "_target_split_limit = max(4000, _smallest_limit_chars // 2)" in body, \
        "target split limit must be half the smallest model context (min 4000 chars)"


def test_cascade_exhaustion_sentinel_present(ns):
    body = _notebook_body()
    assert "cascade_exhausted models=" in body, \
        "cascade-exhaustion log must include model count"


def test_cascade_rebatch_error_class_still_exists(ns):
    body = _notebook_body()
    assert "class CascadeRebatchError(RuntimeError):" in body, \
        "CascadeRebatchError class must still exist (used as rebatch signal)"


def test_get_context_limit_chars_for_model_reused(ns):
    body = _notebook_body()
    assert "get_context_limit_chars_for_model(_smallest, self.current_language)" in body, \
        "must reuse existing get_context_limit_chars_for_model helper (DRY)"


def test_adaptive_multiplier_math_small_prompt():
    prompt_size_chars = 10000
    baseline = 40000
    max_mult = 6
    mult = max(1.0, min(float(max_mult), prompt_size_chars / float(max(1, baseline))))
    assert mult == 1.0, "small prompts get no scaling (multiplier=1.0)"


def test_adaptive_multiplier_math_medium_prompt():
    prompt_size_chars = 120000
    baseline = 40000
    max_mult = 6
    mult = max(1.0, min(float(max_mult), prompt_size_chars / float(max(1, baseline))))
    assert mult == 3.0, "3x baseline chars -> 3x multiplier"


def test_adaptive_multiplier_math_huge_prompt_capped():
    prompt_size_chars = 500000
    baseline = 40000
    max_mult = 6
    mult = max(1.0, min(float(max_mult), prompt_size_chars / float(max(1, baseline))))
    assert mult == 6.0, "very large prompts capped at max multiplier"


def test_cascade_rebatch_error_carries_split_limit_field(ns):
    """Contract test: callers rely on target_context_limit_chars to split.
    Verify CascadeRebatchError accepts and preserves it."""
    ns_obj = ns
    CascadeRebatchError = ns_obj.get("CascadeRebatchError")
    assert CascadeRebatchError is not None, "CascadeRebatchError must be loadable"
    err = CascadeRebatchError(
        "test",
        target_model_name="worker_small",
        target_model_endpoint="ws_endpoint",
        target_context_limit_chars=15000,
        failed_model_name="worker_large",
    )
    assert err.target_context_limit_chars == 15000
    assert err.target_model_name == "worker_small"
    assert err.failed_model_name == "worker_large"


def test_target_split_limit_forces_meaningful_shrink():
    """Splitting to half the smallest context ensures a real shrink even
    when the smallest model is already used."""
    smallest_limit_chars = 100_000
    target_split_limit = max(4000, smallest_limit_chars // 2)
    assert target_split_limit == 50_000, "target must halve the smallest cascade limit"

    tiny_smallest = 3000
    target_split_limit = max(4000, tiny_smallest // 2)
    assert target_split_limit == 4000, "hard floor at 4000 chars"
