"""Fix #1: SessionMutationWriter single-authority queue for __inspire_session writes.

Evidence: rescue commit 9305bd1 body "Delta OCC raised ConcurrentAppendException on
first collision and killed the flush thread"; customer Alshaya crash.

v0.9.0 base bug: main thread `update_session_prompt_context` and background
`AtomicWriterFlush` thread both UPDATE the same `__inspire_session` row.

Fix: every `__inspire_session` mutation is queued to `SessionMutationWriter._queue`
and drained by a single worker thread that retries on ConcurrentAppend with capped
exponential backoff. Sentinel `[G19 SINGLE_WRITER FIRED|RETRY|FAILED]`.
"""
import logging
import threading
import time

import pytest

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import load_agent_namespace


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


class _CapturingLogger:
    def __init__(self):
        self.records = []
        self._lock = threading.Lock()

    def _add(self, level, msg):
        with self._lock:
            self.records.append((level, str(msg)))

    def info(self, msg, *a, **k):
        self._add("INFO", msg)

    def warning(self, msg, *a, **k):
        self._add("WARNING", msg)

    def error(self, msg, *a, **k):
        self._add("ERROR", msg)

    def debug(self, msg, *a, **k):
        self._add("DEBUG", msg)

    def matching(self, needle):
        with self._lock:
            return [r for r in self.records if needle in r[1]]


class _FakeSparkRaiseNTimes:
    def __init__(self, raise_n_times, error_msg="Delta ConcurrentAppendException detected during commit"):
        self.raise_n_times = int(raise_n_times)
        self.error_msg = error_msg
        self.calls = []
        self._call_count = 0
        self._lock = threading.Lock()

    def sql(self, statement):
        with self._lock:
            self.calls.append(statement)
            self._call_count += 1
            should_raise = self._call_count <= self.raise_n_times
        if should_raise:
            raise RuntimeError(self.error_msg)
        return self


class _FakeSparkAlwaysRaises:
    def __init__(self, error_msg):
        self.error_msg = error_msg
        self.calls = []
        self._lock = threading.Lock()

    def sql(self, statement):
        with self._lock:
            self.calls.append(statement)
        raise RuntimeError(self.error_msg)


def test_writer_retries_on_concurrent_append_then_succeeds(ns):
    SessionMutationWriter = ns["SessionMutationWriter"]
    spark = _FakeSparkRaiseNTimes(raise_n_times=2)
    logger = _CapturingLogger()
    writer = SessionMutationWriter(spark, "cat.sch.__inspire_session", 12345, logger, base_backoff_seconds=0.01)
    try:
        writer.submit_and_wait("UPDATE cat.sch.__inspire_session SET completed_percent = 1.0 WHERE session_id = 12345", tag="ready_progress", timeout=5.0)
    finally:
        writer.stop(drain_timeout=5.0)
    assert len(spark.calls) == 3, f"expected 3 calls (2 retries + 1 success), got {len(spark.calls)}"
    fired = logger.matching("[G19 SINGLE_WRITER FIRED]")
    retries = logger.matching("[G19 SINGLE_WRITER RETRY]")
    assert len(fired) == 1, f"expected exactly 1 FIRED log, got {len(fired)}: {fired}"
    assert len(retries) == 2, f"expected 2 RETRY logs, got {len(retries)}: {retries}"
    assert "retries=2" in fired[0][1], f"FIRED log should record retry count: {fired[0][1]}"


def test_writer_fails_after_max_retries_on_persistent_concurrent_append(ns):
    SessionMutationWriter = ns["SessionMutationWriter"]
    spark = _FakeSparkAlwaysRaises("io.delta.exceptions.ConcurrentAppendException: forever")
    logger = _CapturingLogger()
    writer = SessionMutationWriter(spark, "cat.sch.__inspire_session", 999, logger, max_retries=3, base_backoff_seconds=0.01)
    try:
        writer.submit_and_wait("UPDATE cat.sch.__inspire_session SET completed_percent = 1.0", tag="ready_progress", timeout=5.0)
    finally:
        writer.stop(drain_timeout=5.0)
    assert len(spark.calls) == 3, f"expected exactly 3 attempts (max_retries), got {len(spark.calls)}"
    assert len(logger.matching("[G19 SINGLE_WRITER FAILED]")) == 1
    assert len(logger.matching("[G19 SINGLE_WRITER FIRED]")) == 0


def test_writer_does_not_retry_on_non_concurrent_error(ns):
    SessionMutationWriter = ns["SessionMutationWriter"]
    spark = _FakeSparkAlwaysRaises("AnalysisException: table not found")
    logger = _CapturingLogger()
    writer = SessionMutationWriter(spark, "cat.sch.__inspire_session", 42, logger, max_retries=5, base_backoff_seconds=0.01)
    try:
        writer.submit_and_wait("UPDATE cat.sch.__inspire_session SET x = 1", tag="ready_progress", timeout=5.0)
    finally:
        writer.stop(drain_timeout=5.0)
    assert len(spark.calls) == 1, f"non-OCC errors must not retry; got {len(spark.calls)} calls"
    assert len(logger.matching("[G19 SINGLE_WRITER FAILED]")) == 1


def test_writer_serializes_concurrent_submits_from_multiple_threads(ns):
    SessionMutationWriter = ns["SessionMutationWriter"]
    spark = _FakeSparkRaiseNTimes(raise_n_times=0)
    logger = _CapturingLogger()
    writer = SessionMutationWriter(spark, "cat.sch.__inspire_session", 55, logger, base_backoff_seconds=0.01)
    n_submitters = 8
    per_thread = 5
    def _submit_many(idx):
        for k in range(per_thread):
            writer.submit(f"UPDATE cat.sch.__inspire_session SET n = {idx*100 + k}", tag=f"thread{idx}")
    threads = [threading.Thread(target=_submit_many, args=(i,)) for i in range(n_submitters)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    try:
        writer.stop(drain_timeout=10.0)
    except Exception:
        pass
    expected = n_submitters * per_thread
    assert len(spark.calls) == expected, f"expected {expected} statements, got {len(spark.calls)}"
    assert len(logger.matching("[G19 SINGLE_WRITER FIRED]")) == expected


def test_atomic_writer_routes_all_session_writes_through_queue(ns):
    """Contract test: AtomicWriter's 4 session-write sites all call _execute_session_write
    (i.e. no direct self.spark.sql UPDATE __inspire_session escaping the queue)."""
    import re
    from pathlib import Path
    root = Path(__file__).resolve().parents[2]
    nb_text = (root / "agent" / "dbx_inspire_ai_agent.ipynb").read_text()

    class_body_pattern = re.compile(r'"class AtomicWriter:.*?(?="class [A-Za-z_]|"# COMMAND ---)', re.DOTALL)
    match = class_body_pattern.search(nb_text)
    assert match, "AtomicWriter class not found in notebook"
    body = match.group(0)

    bad = re.findall(r'self\.spark\.sql\([^)]*UPDATE\s+\{self\.session_table\}', body)
    assert not bad, f"Direct spark.sql UPDATE __inspire_session found (must route through _execute_session_write): {bad}"

    for expected_call in [
        "_execute_session_write(merge_sql",
        "_execute_session_write(",
        "_execute_session_write(update_sql",
        "_execute_session_write(finalize_sql",
    ]:
        assert expected_call in body, f"missing call site: {expected_call}"


def test_finalize_pipeline_stops_the_writer(ns):
    """finalize_pipeline must call self._session_writer.stop() so the worker joins
    before the driver exits, otherwise trailing writes are lost."""
    from pathlib import Path
    root = Path(__file__).resolve().parents[2]
    nb_text = (root / "agent" / "dbx_inspire_ai_agent.ipynb").read_text()
    assert "self._session_writer.stop(drain_timeout=15.0)" in nb_text, "finalize_pipeline must stop the writer"


def test_writer_stop_drains_pending_queue(ns):
    SessionMutationWriter = ns["SessionMutationWriter"]
    spark = _FakeSparkRaiseNTimes(raise_n_times=0)
    logger = _CapturingLogger()
    writer = SessionMutationWriter(spark, "cat.sch.__inspire_session", 77, logger, base_backoff_seconds=0.01)
    for i in range(20):
        writer.submit(f"UPDATE cat.sch.__inspire_session SET x = {i}", tag="drain_test")
    writer.stop(drain_timeout=5.0)
    assert len(spark.calls) == 20, f"stop() must drain all pending writes, got {len(spark.calls)}/20"
