"""v1.2.0 RUNTIME lane: defects that only showed up in the live v1.1.3 baseline runs.

L1  an auto-detected endpoint that ai_query cannot serve ("not supported for batch inference") was first in every
    cascade and burned one failed attempt per LLM request (55-108 per run).
L2  global dedup was pinned to that same endpoint, so it always fell back to per-domain dedup.
L3  a metadata query timeout silently dropped a table (11 of 12 loaded, one ERROR line).
L4  Spark cancellation handles must be unique per call, so cancelling one call never cancels another.
L5  endpoints that reject `temperature` must be known per endpoint, logged once, and never cost an attempt per call.
L6  business context inferred from the business name alone must be labeled as an assumption, without figures.

The fakes follow Spark Connect semantics: operation tags are thread-local and `interruptTag` cancels only the
operations that carry that tag.
"""
import json
import logging
import os
import re
import sys
import threading
import time
import types
import uuid
from unittest.mock import patch

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from conftest import FakeServingEndpoint, FakeWorkspaceClient  # noqa: E402
from v120_metadata_evidence_test import (CapturingLogger, SqliteSpark, T, drain_tables,  # noqa: E402
                                         sales_model)

BAD = "databricks-claude-opus-5-5"
GOOD = "databricks-claude-opus-4-8"
OTHER = "databricks-claude-opus-4-7"
BATCH_REJECTION = ("[INTERNAL_ERROR] Remote session creation failed: PERMISSION_DENIED: PERMISSION_DENIED: "
                   "Endpoint {ep} is not supported for batch inference. SQLSTATE: XX000")
TEMPERATURE_REJECTION = ("Job aborted due to stage failure: org.apache.spark.SparkException: The model does not "
                         "support the parameter(s): temperature. Please remove and retry.")
CANCELED = "(org.apache.spark.SparkSQLException) [OPERATION_CANCELED] Operation has been canceled. SQLSTATE: HY008"


class FakeConnectSpark:
    def __init__(self, responder):
        self._local = threading.local()
        self._lock = threading.Lock()
        self.ops = []
        self.interrupts = []
        self.responder = responder

    def _tags(self):
        if not hasattr(self._local, "tags"):
            self._local.tags = set()
        return self._local.tags

    def addTag(self, tag):
        self._tags().add(tag)

    def removeTag(self, tag):
        self._tags().discard(tag)

    def interruptTag(self, tag):
        with self._lock:
            self.interrupts.append(tag)
            hits = [op for op in self.ops if tag in op["tags"] and not op["done"]]
        for op in hits:
            op["interrupted"] = True
            op["cancel"].set()
        return [op["id"] for op in hits]

    def sql(self, query, args=None):
        found = re.search(r"ai_query\('([^']+)'", query)
        op = {"endpoint": found.group(1) if found else None, "query": query, "args": dict(args or {}),
              "tags": frozenset(self._tags()), "cancel": threading.Event(), "done": False, "interrupted": False,
              "started": time.monotonic(), "ended": None}
        with self._lock:
            op["id"] = len(self.ops)
            self.ops.append(op)
        spark = self

        class _Result:
            def collect(self_inner):
                try:
                    return [types.SimpleNamespace(ai_response=spark.responder(op))]
                finally:
                    op["ended"] = time.monotonic()
                    op["done"] = True

        return _Result()

    def ops_for(self, endpoint):
        with self._lock:
            return [op for op in self.ops if op["endpoint"] == endpoint]


class RecordingLogger:
    def __init__(self):
        self._lock = threading.Lock()
        self.records = []

    def _log(self, level, msg, *a, **k):
        with self._lock:
            self.records.append((level, str(msg)))

    def debug(self, msg, *a, **k):
        self._log("DEBUG", msg)

    def info(self, msg, *a, **k):
        self._log("INFO", msg)

    def warning(self, msg, *a, **k):
        self._log("WARNING", msg)

    def error(self, msg, *a, **k):
        self._log("ERROR", msg)

    def critical(self, msg, *a, **k):
        self._log("CRITICAL", msg)

    def matching(self, needle, level=None):
        with self._lock:
            return [m for lvl, m in self.records if needle in m and (level is None or lvl == level)]


def use_roster(ns, *endpoints):
    ns["TECHNICAL_CONTEXT"]["models"] = [
        {"name": ep.replace("databricks-", ""), "order": i + 1, "type": "thinker", "size": "large", "enabled": True,
         "llm_endpoint_name": ep, "llm_input_context_tokens_count": 200000, "llm_output_context_tokens_count": 128000}
        for i, ep in enumerate(endpoints)]


def make_agent(ns, spark, logger, retries=1, timeout=30):
    return ns["AIAgent"](spark=spark, logger=logger, prompt_templates=dict(ns["PROMPT_TEMPLATES"]), default_timeout_seconds=timeout,
                         max_retry_attempts=retries)


def run_concurrently(fn, n):
    results, errors = {}, {}

    def worker(i):
        try:
            results[i] = fn(i)
        except Exception as exc:
            errors[i] = exc

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(60)
    return results, errors


def batch_rejecting(op):
    if op["endpoint"] == BAD:
        raise RuntimeError(BATCH_REJECTION.format(ep=BAD))
    return "ok"


def listing(*names):
    return lambda *a, **k: FakeWorkspaceClient([FakeServingEndpoint(n) for n in names])


# ---------------------------------------------------------------- L1 endpoint capability


def test_L1_startup_probe_keeps_batch_incapable_endpoint_out_and_spends_one_attempt_per_run(fresh_ns):
    spark, log = FakeConnectSpark(batch_rejecting), RecordingLogger()
    with patch("databricks.sdk.WorkspaceClient", listing(BAD, GOOD, OTHER)):
        assert fresh_ns["_apply_auto_detected_endpoints"](log, spark_session=spark) is True
    assert [m["llm_endpoint_name"] for m in fresh_ns["TECHNICAL_CONTEXT"]["models"]] == [GOOD, OTHER]
    assert fresh_ns["get_models_by_type"]("thinker")[0]["llm_endpoint_name"] == GOOD
    agent = make_agent(fresh_ns, spark, log)
    results, errors = run_concurrently(lambda i: agent._call_ai_query(f"prompt {i}", "BASE_USE_CASE_GEN_PROMPT"), 40)
    assert not errors and set(results.values()) == {"ok"}
    assert len(spark.ops_for(BAD)) == 1, "the bad endpoint must cost exactly one attempt per run (the probe)"
    assert len(log.matching("[LLM_ENDPOINT_UNUSABLE FIRED]", "WARNING")) == 1


def test_L1_circuit_breaker_stops_calling_an_endpoint_after_its_first_capability_rejection(fresh_ns):
    use_roster(fresh_ns, BAD, GOOD)
    spark, log = FakeConnectSpark(batch_rejecting), RecordingLogger()
    agent = make_agent(fresh_ns, spark, log)
    for i in range(30):
        assert agent._call_ai_query(f"prompt {i}", "BASE_USE_CASE_GEN_PROMPT") == "ok"
    assert len(spark.ops_for(BAD)) == 1
    assert len(spark.ops_for(GOOD)) == 30
    assert "not supported for batch inference" in fresh_ns["LLM_ENDPOINT_HEALTH"].unusable_reason(BAD)
    assert len(log.matching("[LLM_ENDPOINT_UNUSABLE FIRED]", "WARNING")) == 1


def test_L1_breaker_under_concurrency_never_starts_a_call_to_a_known_bad_endpoint(fresh_ns):
    use_roster(fresh_ns, BAD, GOOD)

    def responder(op):
        if op["endpoint"] == BAD:
            time.sleep(0.4)
            raise RuntimeError(BATCH_REJECTION.format(ep=BAD))
        return "ok"

    spark, log = FakeConnectSpark(responder), RecordingLogger()
    agent = make_agent(fresh_ns, spark, log)
    results, errors = run_concurrently(lambda i: agent._call_ai_query(f"prompt {i}", "BASE_USE_CASE_GEN_PROMPT"), 20)
    assert not errors and len(results) == 20
    bad_ops = spark.ops_for(BAD)
    first_rejection_seen = min(op["ended"] for op in bad_ops)
    assert all(op["started"] <= first_rejection_seen for op in bad_ops)
    agent._call_ai_query("after the rejection", "BASE_USE_CASE_GEN_PROMPT")
    assert len(spark.ops_for(BAD)) == len(bad_ops), "no call may start on an endpoint already known to be unusable"


def test_L1_rate_limits_timeouts_and_server_errors_never_trip_the_breaker(fresh_ns):
    use_roster(fresh_ns, BAD, GOOD)
    fresh_ns["_cancellable_sleep"] = lambda seconds, poll_interval=1.0: False
    transient = {"prompt 0": "429 Too Many Requests: REQUEST_LIMIT_EXCEEDED on endpoint " + BAD,
                 "prompt 1": "PERMISSION_DENIED: rate limit exceeded for endpoint " + BAD,
                 "prompt 2": "503 Service Unavailable",
                 "prompt 3": "Request timed out"}
    lock = threading.Lock()

    def responder(op):
        with lock:
            key = op["args"]["prompt_text"].rsplit("\n", 1)[-1]
            if op["endpoint"] == BAD and key in transient:
                raise RuntimeError(transient.pop(key))
        return "ok"

    spark, log = FakeConnectSpark(responder), RecordingLogger()
    agent = make_agent(fresh_ns, spark, log)
    for i in range(5):
        assert agent._call_ai_query(f"prompt {i}", "BASE_USE_CASE_GEN_PROMPT") == "ok"
    assert fresh_ns["LLM_ENDPOINT_HEALTH"].is_usable(BAD)
    assert not log.matching("[LLM_ENDPOINT_UNUSABLE FIRED]")
    assert len(spark.ops_for(GOOD)) == 1, "only the timeout cascades; throttling and server errors retry the same model"
    assert spark.ops_for(BAD)[-1]["id"] == spark.ops[-1]["id"], "the endpoint keeps serving after transient errors"


@pytest.mark.parametrize("message,kind", [
    (BATCH_REJECTION.format(ep=BAD), "endpoint_unusable"),
    ("RESOURCE_DOES_NOT_EXIST: Endpoint with name 'databricks-x' does not exist", "endpoint_unusable"),
    ("PERMISSION_DENIED: User does not have permission 'CAN_QUERY' on endpoint databricks-x", "endpoint_unusable"),
    ("PERMISSION_DENIED: rate limit exceeded for endpoint databricks-x", "throttled"),
    ("429 Too Many Requests", "throttled"),
    ("PERMISSION_DENIED: User does not have USE/SELECT on main.sales.secret", "other"),
    ("[TABLE_OR_VIEW_NOT_FOUND] main.sales.sales_2500", "other"),
    (TEMPERATURE_REJECTION, "temperature_unsupported"),
    (CANCELED, "cancelled"),
    ("LLM call timed out after 300 seconds (model: claude-opus-4-8)", "timeout"),
    ("[gateway] 503 Service Unavailable", "server"),
    ("StatusCode.UNAVAILABLE: connection reset by peer", "server"),
])
def test_L1_error_taxonomy_separates_capability_errors_from_transient_ones(agent_ns, message, kind):
    assert agent_ns["_classify_runtime_error"](RuntimeError(message)) == kind


def test_L1_error_taxonomy_types(agent_ns):
    classify = agent_ns["_classify_runtime_error"]
    assert classify(agent_ns["SparkWorkTimeout"]("x", 2.0, 1, "t")) == "timeout"
    assert classify(agent_ns["SparkWorkCancelled"]("x", "t")) == "cancelled"


def test_L1_auto_detect_promotes_only_endpoints_that_can_answer_a_text_ai_query(fresh_ns):
    endpoints = [FakeServingEndpoint(GOOD),
                 FakeServingEndpoint("databricks-claude-sonnet-4-5", task="llm/v1/embeddings"),
                 FakeServingEndpoint("databricks-claude-sonnet-4-6", ready=False),
                 FakeServingEndpoint("databricks-meta-llama-3-3-70b-instruct", entity_kind="external"),
                 FakeServingEndpoint("databricks-gpt-oss-120b", entity_kind="custom"),
                 types.SimpleNamespace(name="databricks-gpt-oss-20b")]
    log = RecordingLogger()
    with patch("databricks.sdk.WorkspaceClient", lambda *a, **k: FakeWorkspaceClient(endpoints)):
        ranked = fresh_ns["_auto_detect_llm_endpoints"](log, max_endpoints=10)
    assert [m["llm_endpoint_name"] for m in ranked] == [
        GOOD, "databricks-meta-llama-3-3-70b-instruct", "databricks-gpt-oss-120b", "databricks-gpt-oss-20b"]
    excluded = log.matching("[LLM_ENDPOINT_EXCLUDED")
    assert any("sonnet-4-5" in m and "llm/v1/embeddings" in m for m in excluded)
    assert any("sonnet-4-6" in m and "NOT_READY" in m for m in excluded)


def test_L1_model_override_to_an_unusable_endpoint_fails_fast_without_a_spark_call(fresh_ns):
    use_roster(fresh_ns, BAD, GOOD)
    fresh_ns["LLM_ENDPOINT_HEALTH"].mark_unusable(BAD, "not supported for batch inference")
    spark = FakeConnectSpark(batch_rejecting)
    agent = make_agent(fresh_ns, spark, RecordingLogger())
    with pytest.raises(fresh_ns["LLMEndpointUnusableError"]):
        agent._call_ai_query("p", "REVIEW_USE_CASES_PROMPT", model_override=BAD)
    assert spark.ops == []


def test_L1_no_usable_endpoint_raises_a_clear_error_without_spark_calls(fresh_ns):
    use_roster(fresh_ns, BAD, OTHER)
    for ep in (BAD, OTHER):
        fresh_ns["LLM_ENDPOINT_HEALTH"].mark_unusable(ep, f"{ep} not supported for batch inference")
    spark = FakeConnectSpark(batch_rejecting)
    agent = make_agent(fresh_ns, spark, RecordingLogger())
    with pytest.raises(fresh_ns["LLMEndpointUnusableError"]) as err:
        agent._call_ai_query("p", "BASE_USE_CASE_GEN_PROMPT")
    assert BAD in str(err.value) and OTHER in str(err.value)
    assert spark.ops == []


def test_L1_manager_report_names_unusable_and_temperature_less_endpoints(fresh_ns):
    use_roster(fresh_ns, BAD, GOOD)
    health = fresh_ns["LLM_ENDPOINT_HEALTH"]
    health.mark_unusable(BAD, "Endpoint is not supported for batch inference")
    health.mark_temperature_unsupported(GOOD)
    agent = make_agent(fresh_ns, FakeConnectSpark(batch_rejecting), RecordingLogger())
    agent._manager.record_call("opus-4-8")
    report = agent.get_manager_stats_report()
    assert f"Unusable endpoint skipped by every cascade: {BAD}" in report
    assert "temperature" in report and GOOD in report


# ---------------------------------------------------------------- L2 global dedup model selection


class _DedupInspire:
    @staticmethod
    def build(ns, agent, logger):
        cls = ns["DatabricksInspire"]
        obj = cls.__new__(cls)
        obj.logger = logger
        obj.ai_agent = agent
        obj.parsed_generation_instructions = {}
        obj.max_parallelism = 4
        obj.atomic_writer = None
        return obj


def test_L2_global_dedup_runs_on_a_usable_thinker_instead_of_falling_back_per_domain(fresh_ns):
    use_roster(fresh_ns, BAD, GOOD)
    ids = {"U1", "U2"}

    def responder(op):
        if op["endpoint"] == BAD:
            raise RuntimeError(BATCH_REJECTION.format(ep=BAD))
        rows = [r for r in re.findall(r"^\| (\S+) \|", op["args"]["prompt_text"], re.M) if r in ids]
        return "use_case_id,honesty_score,honesty_justification\n" + "\n".join(f"{r},90,keep" for r in rows)

    spark, log = FakeConnectSpark(responder), RecordingLogger()
    fresh_ns["_probe_llm_endpoints"](spark, [BAD, GOOD], log)
    obj = _DedupInspire.build(fresh_ns, make_agent(fresh_ns, spark, log), log)
    use_cases = [{"No": "U1", "Name": "Forecast weekly store demand", "Analytics Technique": "Forecasting",
                  "Tables Involved": "c.s.orders", "Statement": "s1", "Business Domain": "Sales"},
                 {"No": "U2", "Name": "Detect late deliveries", "Analytics Technique": "Anomaly Detection",
                  "Tables Involved": "c.s.shipments", "Statement": "s2", "Business Domain": "Ops"}]
    kept = obj._deduplicate_use_cases(use_cases)
    assert [u["No"] for u in kept] == ["U1", "U2"]
    probes = (fresh_ns["_LLM_ENDPOINT_PROBE_PROMPT"], fresh_ns["_LLM_JSON_PROBE_PROMPT"])
    dedup_ops = [op for op in spark.ops if not any(probe in op["args"]["prompt_text"] for probe in probes)]
    assert [op["endpoint"] for op in dedup_ops] == [GOOD], "one global dedup call, on the usable thinker"
    assert not log.matching("Falling back to per-domain"), "global dedup must not fall back"


# ---------------------------------------------------------------- L3 metadata retries and surfacing


class TaggedSqliteSpark(SqliteSpark):
    def __init__(self, model, hang_patterns=(), hang_on_match=1, **kw):
        super().__init__(model, **kw)
        self._tag_local = threading.local()
        self.hang_patterns = list(hang_patterns)
        self.hang_on_match = hang_on_match
        self._matches = 0
        self.hung = []
        self.interrupts = []

    def _tags(self):
        if not hasattr(self._tag_local, "tags"):
            self._tag_local.tags = set()
        return self._tag_local.tags

    def addTag(self, tag):
        self._tags().add(tag)

    def removeTag(self, tag):
        self._tags().discard(tag)

    def interruptTag(self, tag):
        with self._lock:
            self.interrupts.append(tag)
            hits = [ev for tags, ev in self.hung if tag in tags]
        for ev in hits:
            ev.set()

    def sql(self, query, args=None, **kwargs):
        hang = None
        with self._lock:
            if any(re.search(p, query, re.I | re.S) for p in self.hang_patterns):
                self._matches += 1
                if self._matches == self.hang_on_match:
                    hang = (frozenset(self._tags()), threading.Event())
                    self.hung.append(hang)
        if hang is not None and hang[1].wait(6):
            raise RuntimeError(CANCELED)
        return super().sql(query, args, **kwargs)


def make_loader(ns, spark, monkeypatch, schemas="main.sales"):
    monkeypatch.setattr(ns["SparkSession"].builder, "getOrCreate", staticmethod(lambda: spark))
    logger = CapturingLogger()
    loader = ns["DataLoader"](catalogs="", schemas=schemas, tables="", logger=logger, enable_two_pass=True,
                              enable_column_sampling=True, max_parallelism=4)
    return loader, logger


SALES_TABLES = {"customers", "orders", "order_lines", "shipment_lines"}


def test_L3_transient_metadata_failures_are_retried_and_no_table_is_lost(fresh_ns, monkeypatch):
    fresh_ns["_METADATA_RETRY_BACKOFF_S"] = (0, 0)
    describe_blips = [(rf"DESCRIBE TABLE `main`\.`sales`\.`{t}`", "503 Service Unavailable") for t in sorted(SALES_TABLES)]
    spark = SqliteSpark(sales_model(), fail_once=[
        (r"column_name.*`columns`", "[TEMPORARILY_UNAVAILABLE] 503 Service Unavailable"),
        (r"column_name.*`columns`", "Request timed out waiting for the metastore"),
    ] + describe_blips)
    loader, logger = make_loader(fresh_ns, spark, monkeypatch)
    rows = drain_tables(loader)
    assert {r[2] for r in rows} == SALES_TABLES
    assert loader.metadata_unavailable_report()["count"] == 0
    assert len(logger.matching("[METADATA_QUERY_RETRY FIRED]", level="WARNING")) == 2


def test_L3_hung_metadata_query_is_interrupted_by_its_own_tag_and_retried(fresh_ns, monkeypatch):
    fresh_ns["_METADATA_QUERY_TIMEOUT_S"] = 0.5
    fresh_ns["_METADATA_RETRY_BACKOFF_S"] = (0, 0)
    spark = TaggedSqliteSpark(sales_model(), hang_patterns=[r"column_name.*`columns`"])
    loader, logger = make_loader(fresh_ns, spark, monkeypatch)
    started = time.monotonic()
    rows = drain_tables(loader)
    assert {r[2] for r in rows} == SALES_TABLES
    assert len(spark.hung) == 1 and len(spark.hung[0][0]) == 1, "the hung query must carry exactly one tag"
    assert spark.interrupts == list(spark.hung[0][0]), "only the hung query's own tag may be interrupted"
    assert any("timeout" in m for m in logger.matching("[METADATA_QUERY_RETRY FIRED]", level="WARNING"))
    assert time.monotonic() - started < 5.5


def test_L3_table_whose_metadata_never_loads_is_reported_not_silently_dropped(fresh_ns, monkeypatch):
    model = sales_model()
    model["main"]["sales"]["secret"] = T([("x", "STRING", None)], info_columns=False)
    spark = SqliteSpark(model, describe_denied={"main.sales.secret"})
    loader, logger = make_loader(fresh_ns, spark, monkeypatch)
    before = len(fresh_ns["NEXT_ACTIONS"].snapshot())
    rows = drain_tables(loader)
    assert {r[2] for r in rows} == SALES_TABLES
    report = loader.metadata_unavailable_report()
    assert report["count"] == 1 and report["tables"][0]["table"] == "main.sales.secret"
    assert "permission denied" in report["tables"][0]["reason"].lower()
    errors = logger.matching("[METADATA_TABLES_UNAVAILABLE FIRED]", level="ERROR")
    assert len(errors) == 1 and "main.sales.secret" in errors[0]
    assert logger.matching("from 4/5 tables", level="INFO")
    assert logger.matching("[METADATA_TABLE_UNAVAILABLE FIRED] table=main.sales.secret", level="WARNING")
    actions = [a for a in fresh_ns["NEXT_ACTIONS"].snapshot()[before:] if a["rule_id"] == "METADATA_TABLE_UNAVAILABLE"]
    assert actions and "main.sales.secret" in actions[0]["evidence"]


def test_L3_batch_budget_timeout_records_unfinished_tables_and_cancels_their_queries(fresh_ns, monkeypatch):
    fresh_ns["_METADATA_BATCH_TIMEOUT_S"] = 1
    model = sales_model()
    model["main"]["sales"]["slow"] = T([("x", "STRING", None)], info_columns=False)
    spark = TaggedSqliteSpark(model, hang_patterns=[r"DESCRIBE TABLE `main`\.`sales`\.`slow`"], hang_on_match=2)
    loader, logger = make_loader(fresh_ns, spark, monkeypatch)
    rows = drain_tables(loader)
    assert {r[2] for r in rows} == SALES_TABLES
    entry = [e for e in loader.metadata_unavailable_report()["tables"] if e["table"] == "main.sales.slow"]
    assert entry and "1s batch budget" in entry[0]["reason"]
    deadline = time.monotonic() + 4
    while not spark.interrupts and time.monotonic() < deadline:
        time.sleep(0.05)
    assert spark.interrupts == list(spark.hung[0][0]), "the abandoned DESCRIBE must be interrupted by its own tag"


def test_L3_safe_as_completed_yields_work_that_finished_before_the_deadline(agent_ns):
    import concurrent.futures
    sac = agent_ns["safe_as_completed"]
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        fast = pool.submit(lambda: time.sleep(0.3) or "fast")
        slow = pool.submit(lambda: time.sleep(3) or "slow")
        got = []
        with pytest.raises(concurrent.futures.TimeoutError):
            for future in sac([fast, slow], timeout=1.0):
                got.append(future.result())
    assert got == ["fast"], "a future that finished before the deadline must be yielded, not reported as timed out"


def test_L3_parallel_executor_keeps_results_that_finished_before_the_total_timeout(agent_ns):
    out = agent_ns["ParallelExecutor"].execute_parallel(
        tasks=[lambda: time.sleep(0.65) or "finished", lambda: time.sleep(5) or "late"], max_workers=2, task_name="T",
        total_timeout=0.8, return_exceptions=True)
    assert out[0] == "finished"
    assert isinstance(out[1], TimeoutError)


# ---------------------------------------------------------------- L4 unique cancellation handles


def test_L4_one_timed_out_llm_call_never_cancels_concurrent_calls(fresh_ns):
    use_roster(fresh_ns, GOOD)

    def responder(op):
        if "SLOW" in op["args"]["prompt_text"]:
            if op["cancel"].wait(10):
                raise RuntimeError(CANCELED)
            return "late"
        if op["cancel"].wait(2.0):
            raise RuntimeError(CANCELED)
        return "ok"

    spark, log = FakeConnectSpark(responder), RecordingLogger()
    agent = make_agent(fresh_ns, spark, log, retries=0)

    def call(i):
        if i == 0:
            return agent._call_ai_query("SLOW request", "SUMMARY_GEN_PROMPT", model_override=GOOD, timeout_seconds=1)
        return agent._call_ai_query(f"fast request {i}", "SUMMARY_GEN_PROMPT", model_override=GOOD)

    results, errors = run_concurrently(call, 14)
    assert set(errors) == {0} and "timed out" in str(errors[0])
    assert [results[i] for i in range(1, 14)] == ["ok"] * 13
    slow_op = next(op for op in spark.ops if "SLOW" in op["args"]["prompt_text"])
    assert spark.interrupts == list(slow_op["tags"])
    assert [op["id"] for op in spark.ops if op["interrupted"]] == [slow_op["id"]]
    assert all(len(op["tags"]) == 1 for op in spark.ops)
    assert len({tag for op in spark.ops for tag in op["tags"]}) == len(spark.ops)


def test_L4_cancellation_handle_does_not_depend_on_a_32_bit_prefix(fresh_ns, monkeypatch):
    use_roster(fresh_ns, GOOD)
    counter = iter(range(1, 10_000))
    monkeypatch.setattr(uuid, "uuid4", lambda: uuid.UUID(int=(0xABCDEF01 << 96) | next(counter)))

    def responder(op):
        wait = 12 if "SLOW" in op["args"]["prompt_text"] else 6.5
        if op["cancel"].wait(wait):
            raise RuntimeError(CANCELED)
        return "ok"

    spark = FakeConnectSpark(responder)
    agent = make_agent(fresh_ns, spark, RecordingLogger(), retries=0)

    def call(i):
        if i == 0:
            return agent._call_ai_query("SLOW request", "SUMMARY_GEN_PROMPT", model_override=GOOD, timeout_seconds=1)
        time.sleep(0.2)
        return agent._call_ai_query("fast request", "SUMMARY_GEN_PROMPT", model_override=GOOD)

    results, errors = run_concurrently(call, 2)
    assert set(errors) == {0}
    assert results[1] == "ok", "interrupting the timed-out call must not cancel a call whose tag shares a prefix"


def test_L4_safe_executor_cancel_targets_one_task_only(agent_ns):
    ctx_cls = agent_ns["_SafeExecutorContext"]
    is_cancelled = agent_ns["_is_thread_cancelled"]
    seen = {}

    def task(i):
        start = time.time()
        while time.time() - start < 1.5:
            if is_cancelled():
                seen[i] = "cancelled"
                return "cancelled"
            time.sleep(0.02)
        seen[i] = "finished"
        return "finished"

    with ctx_cls(max_workers=3, name="L4") as ctx:
        futures = [ctx.submit(task, i) for i in range(3)]
        time.sleep(0.2)
        assert ctx.cancel(futures[0]) is True
        outcomes = [f.result(timeout=5) for f in futures]
    assert outcomes == ["cancelled", "finished", "finished"]
    assert ctx.cancel(object()) is False


def test_L4_tagged_spark_work_interrupts_only_its_own_operation(agent_ns):
    run = agent_ns["_run_tagged_spark_work"]

    def responder(op):
        wait = 10 if op["query"] == "HANG" else 1.0
        if op["cancel"].wait(wait):
            raise RuntimeError(CANCELED)
        return "ok"

    spark = FakeConnectSpark(responder)

    def call(i):
        query = "HANG" if i == 0 else f"q{i}"
        return run(spark, lambda: spark.sql(query).collect()[0].ai_response,
                   timeout_seconds=0.5 if i == 0 else 20, tag_prefix="t", label=f"w{i}")

    results, errors = run_concurrently(call, 8)
    assert set(errors) == {0} and isinstance(errors[0], agent_ns["SparkWorkTimeout"])
    assert [results[i] for i in range(1, 8)] == ["ok"] * 7
    hang_op = next(op for op in spark.ops if op["query"] == "HANG")
    assert spark.interrupts == list(hang_op["tags"])


# ---------------------------------------------------------------- L5 temperature capability


def temperature_rejecting(no_temperature):
    def responder(op):
        if op["endpoint"] in no_temperature and "'temperature'" in op["query"]:
            raise RuntimeError(TEMPERATURE_REJECTION)
        return "ok"
    return responder


def test_L5_probe_records_temperature_support_and_calls_never_rediscover_it(fresh_ns):
    temp_ok = "databricks-claude-opus-4-6"
    spark, log = FakeConnectSpark(temperature_rejecting({GOOD})), RecordingLogger()
    with patch("databricks.sdk.WorkspaceClient", listing(GOOD, temp_ok)):
        assert fresh_ns["_apply_auto_detected_endpoints"](log, spark_session=spark) is True
    assert fresh_ns["LLM_ENDPOINT_HEALTH"].accepts_temperature(GOOD) is False
    agent = make_agent(fresh_ns, spark, log)
    results, errors = run_concurrently(lambda i: agent._call_ai_query(f"prompt {i}", "BASE_USE_CASE_GEN_PROMPT"), 20)
    assert not errors and len(results) == 20
    with_temperature = [op for op in spark.ops_for(GOOD) if "'temperature'" in op["query"]]
    assert len(with_temperature) == 1, "only the startup probe may send temperature to an endpoint that rejects it"
    json_probes = [op for op in spark.ops_for(GOOD) if fresh_ns["_LLM_JSON_PROBE_PROMPT"] in op["args"]["prompt_text"]]
    assert len(json_probes) == 1, "strict JSON support is probed once at startup, never per call"
    assert len(spark.ops_for(GOOD)) == 22, "1 temperature probe + 1 JSON probe + 20 calls"
    agent._call_ai_query("goal check", "GOAL_ALIGNMENT_FILTER_PROMPT", model_override=temp_ok)
    assert "'temperature', CAST(0.0 AS DOUBLE)" in spark.ops_for(temp_ok)[-1]["query"]
    assert len(log.matching("[G32 TEMPERATURE_REJECTED_ADAPTED FIRED]", "WARNING")) == 1


def test_L5_runtime_temperature_rejection_retries_same_model_without_using_an_attempt(fresh_ns):
    use_roster(fresh_ns, GOOD)
    spark, log = FakeConnectSpark(temperature_rejecting({GOOD})), RecordingLogger()
    agent = make_agent(fresh_ns, spark, log)
    assert agent._call_ai_query("p", "SUMMARY_GEN_PROMPT", model_override=GOOD, max_retries=0) == "ok"
    first = spark.ops_for(GOOD)
    assert len(first) == 2 and "'temperature'" in first[0]["query"] and "'temperature'" not in first[1]["query"]
    for i in range(5):
        agent._call_ai_query(f"p{i}", "SUMMARY_GEN_PROMPT", model_override=GOOD, max_retries=0)
    assert len(spark.ops_for(GOOD)) == 7
    assert all("'temperature'" not in op["query"] for op in spark.ops_for(GOOD)[1:])
    assert len(log.matching("[G32 TEMPERATURE_REJECTED_ADAPTED FIRED]", "WARNING")) == 1


def test_L5_endpoints_that_accept_temperature_keep_the_configured_value(fresh_ns):
    use_roster(fresh_ns, GOOD)
    spark = FakeConnectSpark(temperature_rejecting(set()))
    agent = make_agent(fresh_ns, spark, RecordingLogger())
    agent._call_ai_query("p", "GOAL_ALIGNMENT_FILTER_PROMPT")
    agent._call_ai_query("p", "SUMMARY_GEN_PROMPT")
    queries = [op["query"] for op in spark.ops]
    assert "'temperature', CAST(0.0 AS DOUBLE)" in queries[0]
    assert "'temperature', CAST(0.5 AS DOUBLE)" in queries[1]


# ---------------------------------------------------------------- L6 business context from a name


class _ContextAgent:
    def __init__(self, answer):
        self.answer = answer
        self.calls = []

    def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema=None, skip_cache=False, **kw):
        self.calls.append(prompt_vars)
        return self.answer


def test_L6_name_inferred_business_context_is_labeled_and_carries_no_revenue_figures(fresh_ns):
    cls = fresh_ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = RecordingLogger()
    obj.business_name = "acme_weather"
    obj.ai_agent = _ContextAgent(json.dumps({"honesty_score": 90, "honesty_justification": "x", "data": {
        "business_context": "A global weather media company with $1.2 billion in annual revenue",
        "strategic_goals": "Increase Revenue (subscriptions), Reduce Cost (automation)",
        "business_priorities": "Grow premium subscriptions",
        "strategic_initiative": "Expanding ad-supported forecast apps",
        "value_chain": "Collect observations, forecast, distribute",
        "revenue_model": "Subscriptions, advertising (USD 300 million), enterprise licensing",
    }}))
    ctx = obj._get_business_context_from_llm()
    label = "[ASSUMPTION inferred from the business name 'acme_weather' only, not evidenced by the metadata] "
    for field in ("business_context", "value_chain"):
        assert ctx[field].startswith(label), field
    assert "1.2 billion" not in ctx["business_context"] and "UNKNOWN_FROM_METADATA" in ctx["business_context"]
    assert ctx["revenue_model"] == ctx["strategic_initiative"] == "UNKNOWN_FROM_METADATA"
    assert ctx["strategic_goals"] == "Increase Revenue (subscriptions), Reduce Cost (automation)"
    assert ctx["business_priorities"] == [label + "Grow premium subscriptions"]


def test_L6_label_is_idempotent_and_leaves_unknown_fields_alone(agent_ns):
    label_fn = agent_ns["label_inferred_business_context"]
    once = label_fn({"business_context": "Bakes bread", "revenue_model": "UNKNOWN_FROM_METADATA",
                     "value_chain": "", "strategic_initiative": None}, "acme")
    assert once["revenue_model"] == once["strategic_initiative"] == "UNKNOWN_FROM_METADATA"
    assert once["value_chain"] == ""
    assert label_fn(once, "acme") == once
    assert label_fn("not a dict", "acme") == "not a dict"
