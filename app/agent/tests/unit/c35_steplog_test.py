"""c35_steplog (R1.1, P0): every Discover step writes one row to <inspire_db>.__inspire_step_ledger (Contract 1), so the critical path can be measured.

The ledger is a per-run buffer. A step (a PipelineStepRun, or an AI call outside any step) collects the model names, call count, estimated tokens,
retries and rate-limit errors of the AI calls made inside it; every funnel stage adds a row with candidates_in/out. Rows are written with one INSERT
per newly seen stage plus one final flush, on success, error and cancel. TECHNICAL_CONTEXT.runtime.step_ledger (default true) switches it off; the
App's step table and the use-case output must not change either way."""
import json
import logging
import os
import pathlib
import random
import sys
import tempfile
import threading
import types

import pytest

UNIT = os.path.dirname(os.path.abspath(__file__))
TESTS = os.path.dirname(UNIT)
for _p in (UNIT, TESTS, os.path.join(TESTS, "scripts")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import _agentload  # noqa: E402
import v120_speed_profile as sp  # noqa: E402
from v120_funnel_integrity_test import make_inspire, make_uc  # noqa: E402
from v120_runtime_reliability_test import GOOD, FakeConnectSpark, RecordingLogger, make_agent, use_roster  # noqa: E402

LEDGER = "__inspire_step_ledger"
COLUMNS = ["session_id", "job_run_id", "stage", "step", "started_at", "ended_at", "duration_ms", "status", "models", "llm_calls",
           "tokens_in", "tokens_out", "tokens_estimated", "retries", "rate_limit_errors", "candidates_in", "candidates_out",
           "sql_statements", "sql_ms", "flags_json", "event_at"]


@pytest.fixture()
def ns():
    return _agentload.fresh_agent_namespace()


class LedgerSpark:
    """Records every statement the ledger sends; answers nothing."""

    def __init__(self):
        self.statements = []
        self._lock = threading.Lock()

    def sql(self, query, args=None):
        with self._lock:
            self.statements.append(str(query))
        return types.SimpleNamespace(collect=lambda: [])

    def appends(self):
        return [q for q in self.statements if q.lstrip().upper().startswith("INSERT") and LEDGER in q]

    def touching(self):
        return [q for q in self.statements if LEDGER in q]


def _target(obj, spark=None):
    writer = obj.atomic_writer
    writer.spark = spark or LedgerSpark()
    writer.inspire_database = "cat.db"
    writer.enabled = True
    obj.session_id = 77
    return writer.spark


def _throttling_agent(ns):
    use_roster(ns, GOOD)
    ns["_cancellable_sleep"] = lambda seconds, poll_interval=1.0: False
    seen = {"thrown": False}
    lock = threading.Lock()

    def responder(op):
        with lock:
            if "first prompt" in op["args"]["prompt_text"] and not seen["thrown"]:
                seen["thrown"] = True
                raise RuntimeError("429 Too Many Requests: REQUEST_LIMIT_EXCEEDED on endpoint " + GOOD)
        return "an answer"

    return make_agent(ns, FakeConnectSpark(responder), RecordingLogger(), retries=2)


def test_default_flag_is_on(ns):
    assert ns["TECHNICAL_CONTEXT"]["runtime"]["step_ledger"] is True


def test_1_step_row_counts_calls_retry_rate_limit_tokens_and_models(ns):
    agent = _throttling_agent(ns)
    owner = make_inspire(ns)
    spark = _target(owner)
    ledger = ns["StepLedger"].start(owner)
    with owner._pipeline_step("Use Case Prioritization", "Unit Step", "working"):
        agent._call_ai_query("first prompt", "BASE_USE_CASE_GEN_PROMPT")
        agent._call_ai_query("second prompt", "BASE_USE_CASE_GEN_PROMPT")
    ledger.finish("ok")
    rows = [r for r in ledger.written if r["step"] == "Unit Step"]
    assert len(rows) == 1, ledger.written
    row = rows[0]
    assert set(COLUMNS) <= set(row)
    assert (row["llm_calls"], row["retries"], row["rate_limit_errors"]) == (2, 1, 1)
    assert row["tokens_in"] > 0 and row["tokens_out"] > 0 and row["tokens_estimated"] is True
    assert row["models"] and GOOD.replace("databricks-", "") in row["models"]
    assert row["duration_ms"] >= 0 and row["status"] == "ok" and row["stage"] == "Use Case Prioritization"
    assert row["job_run_id"] == ns["current_job_run_id"]() and row["session_id"] == 77
    assert len(spark.appends()) == 1 and "CREATE TABLE IF NOT EXISTS" in " ".join(spark.touching())


def _speed_run(ns, flag, fail=False):
    ns["TECHNICAL_CONTEXT"]["runtime"]["step_ledger"] = flag
    random.seed(0)
    with tempfile.TemporaryDirectory(prefix="c35_steplog_") as tmp:
        obj, ai_spark = sp.build(ns, pathlib.Path(tmp), "Good")
        spark = _target(obj)
        if fail:
            def boom(ucs, lang):
                raise RuntimeError("clustering failed")
            obj._cluster_domains_and_subdomains = boom
        logging.disable(logging.CRITICAL)
        try:
            if fail:
                with pytest.raises(Exception):
                    obj.run()
            else:
                obj.run()
        finally:
            logging.disable(logging.NOTSET)
        final = (obj.recorded["tracking"] or [[]])[-1]
    return obj, ai_spark, spark, final


def test_2_offline_run_has_no_unattributed_calls_and_every_prompt_has_a_step(ns):
    obj, ai_spark, spark, _final = _speed_run(ns, True)
    rows = ns["StepLedger"].last.written
    assert rows
    assert sum(r["llm_calls"] for r in rows if r["step"] == "unattributed") == 0
    called = {sp.prompt_name(op["args"].get("prompt_text", "")) for op in ai_spark.ops} - {"OTHER"}
    assert called == set(sp.PROMPT_MARKERS)
    named = {name for r in rows for name in json.loads(r["flags_json"]).get("prompts", {})}
    assert called <= named, called - named
    assert sum(r["llm_calls"] for r in rows) == len(ai_spark.ops)


def test_3_appends_do_not_exceed_stages_plus_one(ns):
    _obj, _ai, spark, _final = _speed_run(ns, True)
    stages = {r["stage"] for r in ns["StepLedger"].last.written}
    assert 1 <= len(spark.appends()) <= len(stages) + 1, (len(spark.appends()), sorted(stages))


def test_4_exception_in_a_step_still_flushes_with_status_error(ns):
    agent = _throttling_agent(ns)
    owner = make_inspire(ns)
    spark = _target(owner)
    ledger = ns["StepLedger"].start(owner)
    with pytest.raises(ValueError):
        with owner._pipeline_step("Use Case Prioritization", "Failing Step", "working"):
            agent._call_ai_query("second prompt", "BASE_USE_CASE_GEN_PROMPT")
            raise ValueError("step failed")
    ledger.finish("error")
    rows = [r for r in ledger.written if r["step"] == "Failing Step"]
    assert len(rows) == 1 and rows[0]["status"] == "error" and rows[0]["llm_calls"] == 1
    assert len(spark.appends()) >= 1 and ns["StepLedger"].active is None


def test_4_failing_run_flushes_what_it_buffered(ns):
    _obj, _ai, spark, _final = _speed_run(ns, True, fail=True)
    assert ns["StepLedger"].active is None
    assert ns["StepLedger"].last.written and spark.appends()
    assert sum(r["llm_calls"] for r in ns["StepLedger"].last.written) > 0


def test_5_flag_off_writes_nothing_and_changes_nothing(ns):
    off = _speed_run(ns, False)
    assert off[2].touching() == [] and ns["StepLedger"].last is None
    on = _speed_run(ns, True)
    assert on[2].appends()

    def steps(obj):
        return sorted((s.get("stage_name"), s.get("step_name"), s.get("sub_step_name"), s.get("status"))
                      for s in obj.atomic_writer.steps)

    assert steps(off[0]) == steps(on[0]) and steps(on[0])
    assert [u["No"] for u in off[3]] == [u["No"] for u in on[3]] and off[3]
    assert off[3] == on[3]


def test_6_goal_filter_rows_record_candidates_for_both_calls(ns):
    def responder(prompt_name, prompt_vars, skip_cache):
        ids = [i for i in __import__("re").findall(r"^\| (\S+) \|", prompt_vars["use_cases_table"], __import__("re").M)[1:]]
        return "\n".join(f"{i},{'NO' if i.endswith('9') else 'YES'}" for i in ids)

    owner = make_inspire(ns, responder, parsed_generation_instructions={
        "goal_setting": {"has_goal": True, "goal_description": "Reduce fraud losses"}})
    _target(owner)
    ledger = ns["StepLedger"].start(owner)
    first = [make_uc(f"U{i}") for i in range(1, 8)] + [make_uc("U19")]
    second = [make_uc(f"V{i}") for i in range(1, 4)]
    kept_first = owner._filter_use_cases_by_goal_alignment(first, stage="goal_alignment")
    kept_second = owner._filter_use_cases_by_goal_alignment(second, stage="goal_alignment_post_catchall")
    ledger.finish("ok")
    by_step = {r["step"]: r for r in ledger.written}
    assert (by_step["goal_alignment"]["candidates_in"], by_step["goal_alignment"]["candidates_out"]) == (len(first), len(kept_first)) == (8, 7)
    assert (by_step["goal_alignment_post_catchall"]["candidates_in"],
            by_step["goal_alignment_post_catchall"]["candidates_out"]) == (len(second), len(kept_second)) == (3, 3)
