"""v1.0.3 B11 — Drop `temperature` from ai_query modelParameters when the endpoint rejects it.

Prior v1.0.2 bug (all 6 corpora, 84-205 rejections each):
  * claude-opus-4-8 and claude-opus-4-7 endpoints reject `temperature`
    in `modelParameters` with error "The model does not support the
    parameter(s): temperature. Please remove and retry."
  * The exception handler in `_call_ai_query` treated the error as a
    generic exception, exhausting retries and cascading. 30-60 min
    wasted per run.

v1.0.3 root-cause fix (§8.5 industry-agnostic — no hardcoded model lists):
  * SQL construction omits `temperature` for an endpoint known to reject it.
  * Exception handler detects `"does not support the parameter"`
    AND `"temperature"` in the error message, records the endpoint,
    emits `[G32 TEMPERATURE_REJECTED_ADAPTED FIRED]`, and
    `continue`s the loop so the SAME model is retried without
    temperature on the next attempt.

v1.2.0 RUNTIME: the per-endpoint record moved from AIAgent class attributes into the run-wide
`LLM_ENDPOINT_HEALTH` registry (shared with the startup probe and the unusable-endpoint circuit breaker),
`_llm_request_params` returns temperature=None for such endpoints, and the retry without temperature no
longer uses up a retry attempt.

Tests exercise source contract (§8.1 method + call-site) AND runtime
behaviour (SQL string with vs without temperature).
"""
import ast
import os
import re
import sys
import threading

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import agent_source, load_agent_namespace, method_node


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def test_agent_version_is_v103_or_later():
    import re
    from _agentload import agent_version
    m = re.match(r'^v(\d+)\.(\d+)\.(\d+)$', agent_version())
    assert m is not None, f"agent version must match single-digit semver, got {agent_version()!r}"
    parts = tuple(int(m.group(i)) for i in (1, 2, 3))
    assert parts >= (1, 0, 3), f"single-digit semver (§3a): expected >= v1.0.3, got {agent_version()!r}"


def test_temperature_support_lives_in_one_run_wide_registry(ns):
    """One store for temperature support: the endpoint registry. AIAgent keeps no second copy."""
    health = ns["LLM_ENDPOINT_HEALTH"]
    assert callable(health.accepts_temperature) and callable(health.mark_temperature_unsupported)
    AIAgent = ns["AIAgent"]
    assert not hasattr(AIAgent, "_no_temperature_endpoints"), "a second temperature store would drift (DRY)"


class _CapturingSpark:
    def __init__(self):
        self.queries = []

    def sql(self, query, args=None):
        self.queries.append(query)
        return type("R", (), {"collect": lambda self_: []})()


def test_sql_construction_consults_cache(ns):
    """Request params and the shared SQL builder both drop temperature for an endpoint that rejects it."""
    from _agentload import fresh_agent_namespace
    import logging
    fresh = fresh_agent_namespace()
    fresh["LLM_ENDPOINT_HEALTH"].mark_temperature_unsupported("databricks-x")
    agent = fresh["AIAgent"](spark=_CapturingSpark(), logger=logging.getLogger("b11"), worker_llm_config="x",
                             judge_llm_config="x", prompt_templates={"T": "{x}"})
    rejecting = {"llm_endpoint_name": "databricks-x", "llm_output_context_tokens_count": 1000}
    accepting = {"llm_endpoint_name": "databricks-y", "llm_output_context_tokens_count": 1000}
    assert agent._llm_request_params(rejecting, "SUMMARY_GEN_PROMPT")[1] is None
    assert agent._llm_request_params(accepting, "SUMMARY_GEN_PROMPT")[1] == 0.5
    spark = _CapturingSpark()
    fresh["_ai_query_rows"](spark, "databricks-x", "p", 100, temperature=None)
    fresh["_ai_query_rows"](spark, "databricks-y", "p", 100, temperature=0.5)
    assert "'temperature'" not in spark.queries[0]
    assert "'temperature', CAST(0.5 AS DOUBLE)" in spark.queries[1]
    src = agent_source()
    assert re.search(
        r"_model_params_sql\s*=\s*f?\"named_struct\('max_tokens', \{max_output_tokens\}\)\"",
        src,
    ), "no-temperature branch must build `named_struct('max_tokens', ...)` WITHOUT the temperature field"


def test_exception_handler_detects_temperature_rejection(ns):
    """Handler MUST detect the specific 'does not support the parameter(s): temperature' error."""
    src = agent_source()
    # Detection pattern: both 'does not support the parameter' AND 'temperature' in error_msg.
    assert "does not support the parameter" in src, \
        "temperature-rejection detector must match the verbatim error string"
    assert "_is_temperature_rejected" in src, \
        "detector must be flagged via a named boolean (readability)"


def test_sentinel_G32_present(ns):
    """[G32 TEMPERATURE_REJECTED_ADAPTED FIRED] sentinel must be emitted on adaptation."""
    src = agent_source()
    assert "[G32 TEMPERATURE_REJECTED_ADAPTED FIRED]" in src, \
        "sentinel line for adaptive drop must exist in the source"


def test_handler_adds_model_and_continues(ns):
    """On temperature rejection: record the endpoint AND continue (retry same model, no cascade)."""
    src = agent_source()
    assert "LLM_ENDPOINT_HEALTH.mark_temperature_unsupported(model" in src, \
        "handler must record the rejecting endpoint in the run-wide registry"
    m = re.search(r"_is_temperature_rejected[\s\S]{0,1200}?continue", src)
    assert m is not None, "handler must `continue` after caching (retry same model)"


def test_no_temperature_branch_not_tautology(ns):
    """§8.3 tautology probe: the two branches produce DIFFERENT SQL structures."""
    src = agent_source()
    with_temp = re.search(
        r"_model_params_sql\s*=\s*f?\"(named_struct\('max_tokens', \{max_output_tokens\}, 'temperature',[^\"]*)\"",
        src,
    )
    without_temp = re.search(
        r"_model_params_sql\s*=\s*f?\"(named_struct\('max_tokens', \{max_output_tokens\}\))\"",
        src,
    )
    assert with_temp is not None and without_temp is not None
    assert with_temp.group(1) != without_temp.group(1), \
        "branches must produce distinguishable SQL (tautology guard)"
    assert "'temperature'" not in without_temp.group(1), \
        "no-temperature branch must NOT reference 'temperature' in the SQL"


def test_cache_isolated_from_default_ns_pollution(ns):
    """The registry is module-level state and must start empty in a fresh namespace."""
    from _agentload import fresh_agent_namespace
    fresh = fresh_agent_namespace()
    assert fresh["LLM_ENDPOINT_HEALTH"].snapshot() == {"unusable": {}, "temperature_unsupported": [], "probed": [], "demoted": [],
                                                       "json_format": []}


def test_cache_membership_semantics(ns):
    """Recording an endpoint is idempotent and thread-safe end-to-end: exactly one recorder wins."""
    from _agentload import fresh_agent_namespace
    fresh = fresh_agent_namespace()
    health = fresh["LLM_ENDPOINT_HEALTH"]
    wins = []
    lock = threading.Lock()

    def record():
        first = health.mark_temperature_unsupported("databricks-claude-opus-4-8")
        with lock:
            wins.append(first)

    threads = [threading.Thread(target=record) for _ in range(16)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(5)
    assert wins.count(True) == 1 and len(wins) == 16
    health.mark_temperature_unsupported("databricks-claude-opus-4-7")
    assert health.snapshot()["temperature_unsupported"] == ["databricks-claude-opus-4-7", "databricks-claude-opus-4-8"]
    assert health.accepts_temperature("databricks-claude-opus-4-6") is True
