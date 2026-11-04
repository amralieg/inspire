"""v1.3.0 _ailogs in Semunity's design: one row per attempt (retries, cascade hops, probes), a terminal
exhausted row, no row for a cache hit, agent = inspire; the AtomicWriter spool inserts outside the lock,
caps chunks by bytes, re-sends through an insert-only MERGE, quarantines, and a JSONL fallback."""
import ast
import hashlib
import json
import logging
import os
import re
import threading
import time
import types

import pytest

from _agentload import agent_source
from v120_artifacts_support import CapturingLogger
from v120_runtime_llm_client_test import FakeSpark as LlmSpark, _agent

SEMUNITY_AILOGS_COLUMNS = [
    ("ailogs_id", "STRING"), ("request_id", "STRING"), ("session_id", "BIGINT"),
    ("attempt", "INT"), ("agent", "STRING"), ("prompt", "STRING"), ("endpoint", "STRING"),
    ("temperature", "DOUBLE"), ("parameters", "STRING"), ("request", "STRING"),
    ("response", "STRING"), ("request_length", "BIGINT"), ("request_tokens", "BIGINT"),
    ("response_length", "BIGINT"), ("response_tokens", "BIGINT"), ("status", "STRING"),
    ("start_time", "TIMESTAMP"), ("end_time", "TIMESTAMP"), ("request_hash", "STRING"),
    ("server_ingested_at", "TIMESTAMP"),
]
SEMUNITY_AILOG_STATUSES = ("success", "failed", "timedout", "exhausted", "hedged")


@pytest.fixture
def recorder(agent_ns, monkeypatch):
    fresh = agent_ns["AILogRecorder"]()
    rows = []
    fresh.attach(77, rows.append)
    monkeypatch.setitem(agent_ns, "AILOG_RECORDER", fresh)
    fresh.rows = rows
    return fresh


def test_columns_types_statuses_and_clustering_equal_semunity(agent_ns):
    assert list(agent_ns["AILOGS_COLUMNS"]) == SEMUNITY_AILOGS_COLUMNS
    assert agent_ns["AILOGS_STATUSES"] == SEMUNITY_AILOG_STATUSES
    assert agent_ns["AILOGS_TABLE"] == "_ailogs" and agent_ns["AILOGS_AGENT"] == "inspire"
    ddl = agent_ns["ailogs_create_table_sql"]("`c`.`s`.`_ailogs`")
    assert ddl.startswith("CREATE TABLE IF NOT EXISTS `c`.`s`.`_ailogs` (`ailogs_id` STRING COMMENT 'Identifier: ailogs_id', "
                          "`request_id` STRING COMMENT 'Identifier: request_id'")
    assert "`request` STRING COMMENT 'ailogs request'" in ddl
    assert ("USING DELTA CLUSTER BY (`session_id`, `agent`) TBLPROPERTIES ('delta.enableDeletionVectors' = 'true', "
            "'delta.enableRowTracking' = 'true') COMMENT 'Append-only log of every LLM call attempt") in ddl


def test_static_guard_every_live_call_carries_a_log_context(agent_ns):
    tree = ast.parse(agent_source())
    calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and getattr(n.func, "id", None) == "_ai_query_rows"]
    assert len(calls) == 2 and all("log_attempt" in {k.arg for k in c.keywords} for c in calls)
    assigns = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef):
            for sub in ast.walk(node):
                if isinstance(sub, ast.Constant) and isinstance(sub.value, str) and "ai_query('" in sub.value \
                        and sub.value.lstrip().upper().startswith("SELECT"):
                    assigns.setdefault(node.name, 0)
                    assigns[node.name] += 1
    assert set(assigns) <= {"_ai_query_rows"}, assigns
    registered = {p["prompt_name"] for p in agent_ns["TECHNICAL_CONTEXT"]["prompts_models"]}
    literal_names = {k.value.value for n in ast.walk(tree) if isinstance(n, ast.Call)
                     for k in n.keywords if k.arg in ("prompt_name", "worker_prompt_path")
                     and isinstance(k.value, ast.Constant) and isinstance(k.value.value, str)}
    assert literal_names - {"BASE_USE_CASE_GEN_PROMPT"} <= registered, literal_names - registered
    assert {"ENDPOINT_PROBE", "Assign_User_Domains", "canonicalize_sponsor_beneficiary_roles",
            "PlaceholderDomainRename"} <= registered


def test_one_row_per_attempt_with_full_request_and_response(agent_ns, recorder):
    spark = LlmSpark(responder=lambda query, args: "hello back")
    agent = _agent(agent_ns, spark)
    out = agent._call_ai_query("Say hello", "T")
    assert out == "hello back"
    assert len(recorder.rows) == 1
    row = recorder.rows[0]
    assert set(row) == {name for name, _ in SEMUNITY_AILOGS_COLUMNS} - {"server_ingested_at"}
    assert row["agent"] == "inspire" and row["session_id"] == 77 and row["attempt"] == 1 and row["status"] == "success"
    assert row["prompt"] == "T" and re.fullmatch(r"[0-9a-f]{32}", row["request_id"]) and row["ailogs_id"] != row["request_id"]
    sent = spark.calls[0][1]["prompt_text"]
    assert row["request"] == sent and sent.endswith("Say hello") and sent.startswith("### USER DIRECTIVES")
    assert row["request_hash"] == hashlib.sha256(sent.encode("utf-8")).hexdigest()
    assert row["request_tokens"] == round(len(sent) / 3.2) and row["response"] == "hello back"
    params = json.loads(row["parameters"])
    assert list(params) == sorted(params) and "max_tokens" in params
    assert row["endpoint"] in spark.calls[0][0]


def test_cascade_hops_share_a_request_and_end_with_an_exhausted_row(agent_ns, recorder, monkeypatch):
    monkeypatch.setitem(agent_ns, "_cancellable_sleep", lambda seconds: False)

    def responder(query, args):
        raise RuntimeError("boom: unknown failure")
    agent = _agent(agent_ns, LlmSpark(responder=responder))
    with pytest.raises(Exception):
        agent._call_ai_query("Say hello", "T")
    rows = recorder.rows
    assert len({r["request_id"] for r in rows}) == 1
    assert [r["attempt"] for r in rows] == list(range(1, len(rows) + 1))
    assert all(r["status"] == "failed" for r in rows[:-1]) and len({r["endpoint"] for r in rows[:-1]}) == len(rows) - 1
    last = rows[-1]
    assert last["status"] == "exhausted" and last["endpoint"] == "" and last["response"].startswith("exhausted")


def test_retry_on_the_same_model_is_a_new_attempt(agent_ns, recorder, monkeypatch):
    monkeypatch.setitem(agent_ns, "_cancellable_sleep", lambda seconds: False)
    state = {"n": 0}

    def responder(query, args):
        state["n"] += 1
        if state["n"] == 1:
            raise RuntimeError("503 Service Unavailable: temporarily unavailable")
        return "ok"
    agent = agent_ns["AIAgent"](spark=LlmSpark(responder=responder), logger=logging.getLogger("v130_ailogs"),
                                worker_llm_config="x", judge_llm_config="x", prompt_templates={"T": "{x}"},
                                default_timeout_seconds=30, max_retry_attempts=1)
    assert agent._call_ai_query("hi", "T") == "ok"
    assert [(r["attempt"], r["status"]) for r in recorder.rows] == [(1, "failed"), (2, "success")]
    assert recorder.rows[0]["endpoint"] == recorder.rows[1]["endpoint"]


def test_cache_hit_writes_no_row(agent_ns, recorder):
    spark = LlmSpark(responder=lambda query, args: "fresh")
    agent = _agent(agent_ns, spark)
    agent._llm_cache_dir = "/tmp/inspire-cache-test"
    agent._llm_cache_get = lambda prompt, endpoint, params: "from cache"
    assert agent._call_ai_query("hi", "T") == "from cache"
    assert recorder.rows == [] and spark.calls == []


def test_a_timed_out_attempt_is_logged_once_even_when_the_transport_finishes_later(agent_ns, recorder):
    class SlowFirst(LlmSpark):
        sent = 0

        def sql(self, query, args=None):
            SlowFirst.sent += 1
            if SlowFirst.sent == 1:
                time.sleep(2.5)
            return super().sql(query, args)
    agent = _agent(agent_ns, SlowFirst(responder=lambda query, args: "late or fine"))
    assert agent._call_ai_query("hi", "T", timeout_seconds=1) == "late or fine"
    time.sleep(2.0)
    statuses = [(r["attempt"], r["status"]) for r in recorder.rows]
    assert statuses[0] == (1, "timedout") and statuses[-1][1] == "success"
    assert len(statuses) == len({a for a, _ in statuses}), "each attempt is logged exactly once"
    assert recorder.rows[0]["response"] == agent_ns["AILOGS_TIMEOUT_NOTE"]


def test_endpoint_probe_rows_success_and_failure(agent_ns, recorder):
    ok = agent_ns["_probe_llm_endpoint"](LlmSpark(responder=lambda q, a: "OK"), "databricks-x", logging.getLogger("p"))
    assert ok == "usable"

    def broken(query, args):
        raise RuntimeError("RESOURCE_DOES_NOT_EXIST: endpoint databricks-y does not exist")
    agent_ns["_probe_llm_endpoint"](LlmSpark(responder=broken), "databricks-y", logging.getLogger("p"))
    rows = recorder.rows
    assert [(r["prompt"], r["endpoint"], r["status"]) for r in rows] == [
        ("ENDPOINT_PROBE", "databricks-x", "success"), ("ENDPOINT_PROBE", "databricks-x", "success"),
        ("ENDPOINT_PROBE", "databricks-y", "failed"), ("ENDPOINT_PROBE", "", "exhausted")]
    assert "responseFormat" not in rows[0]["parameters"] and json.loads(rows[1]["parameters"])["response_format"]
    assert len({r["request_id"] for r in rows}) == 3, "the plain and the JSON-format probes are separate requests"
    assert recorder.probe_endpoints == {"databricks-x": "success", "databricks-y": "exhausted"}
    assert "probe_endpoint" not in rows[-1], "only Semunity's columns reach the sink"


def test_rows_wait_for_the_session_and_a_failing_sink_never_fails_the_call(agent_ns, monkeypatch):
    pending = agent_ns["AILogRecorder"]()
    monkeypatch.setitem(agent_ns, "AILOG_RECORDER", pending)
    agent = _agent(agent_ns, LlmSpark(responder=lambda q, a: "ok"))
    agent._call_ai_query("before the session", "T")
    landed = []
    pending.attach(901, landed.append)
    assert len(landed) == 1 and landed[0]["session_id"] == 901

    def broken_sink(row):
        raise OSError("disk full")
    pending.attach(901, broken_sink)
    assert agent._call_ai_query("after", "T") == "ok"
    assert pending.dropped == 1


def test_self_check_passes_clean_runs_and_fails_each_violation(agent_ns):
    rec = agent_ns["AILogRecorder"]()
    rec.attach(1, lambda row: None)
    base = {"agent": "inspire", "prompt": "T", "endpoint": "e", "session_id": 1}
    rec.record(dict(base, ailogs_id="a", request_id="r1", attempt=1, status="success"))
    rec.record(dict(base, ailogs_id="b", request_id="r2", attempt=1, status="failed"))
    rec.record(dict(base, ailogs_id="c", request_id="r2", attempt=2, status="exhausted", endpoint=""))
    rec.record(dict(base, ailogs_id="d", request_id="r3", attempt=1, status="success"))
    rec.record(dict(base, ailogs_id="e", request_id="r4", attempt=1, status="success"))
    rec.record(dict(base, ailogs_id="f", request_id="r5", attempt=1, status="success"))
    rec.record(dict(base, ailogs_id="g", request_id="r6", attempt=1, status="success"))
    rec.record(dict(base, ailogs_id="h", request_id="r7", attempt=1, status="success"))
    clean = rec.self_check({"T": 6})
    assert clean["passed"] == clean["total"], clean["checks"]
    assert not rec.self_check({"T": 9})["checks"]["attempts_cover_calls"]
    assert not rec.self_check({}, bound_endpoints=["never-probed"])["checks"]["every_endpoint_probed"]
    rec.record(dict(base, ailogs_id="i", request_id="r1", attempt=1, status="success"))
    rec.record(dict(base, ailogs_id="j", request_id="r9", attempt=1, status="failed"))
    rec.record(dict(base, ailogs_id="k", request_id="r9", attempt=2, status="weird"))
    broken = rec.self_check({})["checks"]
    assert not broken["unique_request_attempt"] and not broken["statuses_closed_set"]
    assert not broken["every_request_terminates"]
    noisy = agent_ns["AILogRecorder"]()
    noisy.attach(1, lambda row: None)
    for i in range(4):
        noisy.record(dict(base, ailogs_id=str(i), request_id=f"q{i}", attempt=1, status="failed" if i < 2 else "success"))
    assert not noisy.self_check({})["checks"]["non_success_rate"]
    probing = agent_ns["AILogRecorder"]()
    probing.attach(1, lambda row: None)
    probe = dict(base, prompt="ENDPOINT_PROBE")
    for i in range(6):
        probing.record(dict(probe, ailogs_id=f"p{i}", request_id=f"p{i}", attempt=1, status="failed"))
    for i in range(3):
        probing.record(dict(base, ailogs_id=f"c{i}", request_id=f"c{i}", attempt=1, status="success"))
    report = probing.self_check({})
    assert report["checks"]["non_success_rate"], "failed endpoint probes are expected on a workspace with unusable endpoints"
    assert report["non_success"] == 6 and report["probe_non_success"] == 6
    probing.record(dict(base, ailogs_id="c3", request_id="c3", attempt=1, status="failed"))
    probing.record(dict(base, ailogs_id="c4", request_id="c3", attempt=2, status="exhausted"))
    assert not probing.self_check({})["checks"]["non_success_rate"], "failed real calls still fail the check"


class _ViewFrame:
    def __init__(self, spark, rows, schema):
        self.spark, self.rows, self.schema = spark, rows, schema

    def createOrReplaceTempView(self, name):
        self.spark.views[name] = self.rows


class _WriterSpark:
    def __init__(self, fail=None):
        self.statements, self.views, self.fail = [], {}, fail or (lambda statement: False)
        self.catalog = types.SimpleNamespace(dropTempView=lambda name: self.views.pop(name, None))
        self.lock_states = []

    def sql(self, statement, *args, **kwargs):
        text = " ".join(str(statement).split())
        self.statements.append(text)
        if self.fail(text):
            raise RuntimeError("TEMPORARILY_UNAVAILABLE: commit failed")
        return types.SimpleNamespace(collect=lambda: [])

    def createDataFrame(self, rows, schema=None):
        return _ViewFrame(self, list(rows), schema)


def _writer(agent_ns, spark, tmp_path, monkeypatch):
    monkeypatch.setattr(agent_ns["tempfile"], "tempdir", str(tmp_path), raising=False)
    writer = agent_ns["AtomicWriter"](spark, CapturingLogger(), "c.s", 5150)
    writer._session_writer.stop(drain_timeout=5.0)
    writer._ailogs_ready = True
    return writer


def _ailog_row(agent_ns, request_id, size=10):
    return {"ailogs_id": f"id-{request_id}", "request_id": request_id, "session_id": 5150, "attempt": 1, "agent": "inspire",
            "prompt": "T", "endpoint": "e", "temperature": 0.0, "parameters": "{}", "request": "x" * size,
            "response": "y", "request_length": size, "request_tokens": 1, "response_length": 1, "response_tokens": 1,
            "status": "success", "start_time": "2026-10-21T08:00:00+00:00", "end_time": "2026-10-21T08:00:01+00:00",
            "request_hash": "h"}


def test_ailogs_insert_lists_every_column_and_resend_merges_on_the_row_id(agent_ns, tmp_path, monkeypatch):
    spark = _WriterSpark()
    writer = _writer(agent_ns, spark, tmp_path, monkeypatch)
    writer._insert_ailogs_chunk([_ailog_row(agent_ns, "r1")])
    insert = spark.statements[-1]
    assert insert.startswith("INSERT INTO `c`.`s`._ailogs (`ailogs_id`, `request_id`")
    assert "current_timestamp() AS `server_ingested_at`" in insert and "CAST(`start_time` AS TIMESTAMP)" in insert
    writer._insert_ailogs_chunk([_ailog_row(agent_ns, "r1")], resend=True)
    merge = spark.statements[-1]
    assert merge.startswith("MERGE INTO `c`.`s`._ailogs AS t USING (SELECT")
    assert re.search(r"ON t\.`session_id` = \d+ AND t\.`session_id` = s\.`session_id` AND t\.`ailogs_id` = s\.`ailogs_id` WHEN NOT MATCHED THEN INSERT", merge)
    assert "INSERT INTO" not in merge
    assert spark.views == {}, "temp views are dropped"


def test_drain_inserts_outside_the_lock_caps_bytes_and_resends_without_duplicates(agent_ns, tmp_path, monkeypatch):
    spark = _WriterSpark()
    writer = _writer(agent_ns, spark, tmp_path, monkeypatch)
    for i in range(5):
        writer.emit_ailog(_ailog_row(agent_ns, f"r{i}", size=400))
    line = len(json.dumps(_ailog_row(agent_ns, "r0", size=400), ensure_ascii=True, default=str))
    writer._CHUNK_MAX_BYTES = 2 * line + 10
    seen, failed_once = [], []

    def insert_chunk(rows, resend):
        seen.append((len(rows), resend, writer._lock.locked()))
        if len(seen) == 2 and not failed_once:
            failed_once.append(True)
            raise RuntimeError("commit outcome unknown")
        return 0.0
    inserted, _ = writer._drain_spool("ailogs", writer._ailogs_spool_path, "_ailogs_offset", insert_chunk, "ailogs_id")
    assert inserted == 2 and seen == [(2, False, False), (2, False, False)]
    first_offset = writer._ailogs_offset
    assert 0 < first_offset < os.path.getsize(writer._ailogs_spool_path)
    seen.clear()
    inserted, _ = writer._drain_spool("ailogs", writer._ailogs_spool_path, "_ailogs_offset", insert_chunk, "ailogs_id")
    assert seen[0] == (2, True, False), "the failed chunk is re-sent as an idempotent MERGE"
    assert writer._ailogs_offset == os.path.getsize(writer._ailogs_spool_path)


def test_a_chunk_that_keeps_failing_is_quarantined(agent_ns, tmp_path, monkeypatch):
    spark = _WriterSpark()
    writer = _writer(agent_ns, spark, tmp_path, monkeypatch)
    writer.emit_ailog(_ailog_row(agent_ns, "bad"))

    def always_fails(rows, resend):
        raise RuntimeError("TEMPORARILY_UNAVAILABLE: commit failed")
    for _ in range(4):
        writer._drain_spool("ailogs", writer._ailogs_spool_path, "_ailogs_offset", always_fails, "ailogs_id")
        assert writer._ailogs_offset == 0
    writer._drain_spool("ailogs", writer._ailogs_spool_path, "_ailogs_offset", always_fails, "ailogs_id")
    assert writer._ailogs_offset == os.path.getsize(writer._ailogs_spool_path)
    assert writer.logger.matching("quarantined after 5 failures", level="ERROR")
    assert writer.quarantined_rows == {"ailogs": 1}
    assert writer.denied_spool_path("ailogs") == "", "a transient error is retried, never treated as a missing grant"


DENIED = ("(com.databricks.sql.managedcatalog.acl.UnauthorizedAccessException) PERMISSION_DENIED: "
          "User does not have MODIFY on Table 'c.s._ailogs'.")


def test_a_permission_error_stops_writing_that_table_once_and_keeps_its_rows_in_the_spool(agent_ns, tmp_path, monkeypatch):
    spark = _WriterSpark()
    writer = _writer(agent_ns, spark, tmp_path, monkeypatch)
    writer.emit_ailog(_ailog_row(agent_ns, "a"))
    calls = []

    def denied(rows, resend):
        calls.append(len(rows))
        raise RuntimeError(DENIED)
    for _ in range(3):
        assert writer._drain_spool("ailogs", writer._ailogs_spool_path, "_ailogs_offset", denied, "ailogs_id") == (0, 0.0)
    writer.emit_ailog(_ailog_row(agent_ns, "b"))
    writer._drain_spool("ailogs", writer._ailogs_spool_path, "_ailogs_offset", denied, "ailogs_id")
    assert calls == [1], "a missing grant is never retried"
    assert writer.denied_spool_path("ailogs") == writer._ailogs_spool_path and writer._ailogs_offset == 0
    warnings = writer.logger.matching("[SPOOL-DENIED FIRED]", level="WARNING")
    assert len(warnings) == 1 and "MODIFY" in warnings[0][1] and writer._ailogs_spool_path in warnings[0][1]
    assert not writer.logger.matching("quarantined", level="ERROR") and writer.quarantined_rows == {}
    assert writer.denied_spool_path("steps") == ""
    rows = [json.loads(line)["request_id"] for line in open(writer._ailogs_spool_path, encoding="utf-8").read().splitlines()]
    assert rows == ["a", "b"], "every row stays in the local spool"


def test_a_denied_ai_call_log_is_copied_next_to_the_live_log_and_fails_the_run_end_check(agent_ns, tmp_path, monkeypatch):
    from v120_artifacts_support import make_inspire
    rec = agent_ns["AILogRecorder"]()
    monkeypatch.setitem(agent_ns, "AILOG_RECORDER", rec)
    writer = _writer(agent_ns, _WriterSpark(), tmp_path, monkeypatch)
    obj = make_inspire(agent_ns, session_id=5150, local_log_output_dir=str(tmp_path), atomic_writer=writer)
    obj._attach_ailogs()
    assert obj._ailogs_live_copy_source() == ""
    agent = _agent(agent_ns, LlmSpark(responder=lambda q, a: "ok"))
    agent._call_ai_query("hi", "T")
    report = obj._close_ailogs()
    assert report["checks"]["rows_reach_the_table"]
    passed, total = report["passed"], report["total"]
    obj.ailogs_check = None

    def denied(rows, resend):
        raise RuntimeError(DENIED)
    writer._drain_spool("ailogs", writer._ailogs_spool_path, "_ailogs_offset", denied, "ailogs_id")
    assert obj._ailogs_live_copy_source() == writer._ailogs_spool_path
    obj._ailogs_live_copy_dst = "/Volumes/c/s/vol_root/logs/biz/session_5150/ailogs.jsonl"
    report = obj._close_ailogs()
    assert report["checks"]["rows_reach_the_table"] is False and (report["passed"], report["total"]) == (passed - 1, total)
    line = obj.logger.matching("[AILOGS CHECK]", level="WARNING")[-1][1]
    assert "rows_reach_the_table" in line and writer._ailogs_spool_path in line
    assert "copied to /Volumes/c/s/vol_root/logs/biz/session_5150/ailogs.jsonl" in line, "the reachable copy is named"


def test_quarantined_rows_fail_the_run_end_check(agent_ns, tmp_path, monkeypatch):
    from v120_artifacts_support import make_inspire
    rec = agent_ns["AILogRecorder"]()
    monkeypatch.setitem(agent_ns, "AILOG_RECORDER", rec)
    writer = _writer(agent_ns, _WriterSpark(), tmp_path, monkeypatch)
    obj = make_inspire(agent_ns, session_id=5150, local_log_output_dir=str(tmp_path), atomic_writer=writer)
    obj._attach_ailogs()
    writer.quarantined_rows["ailogs"] = 2
    report = obj._close_ailogs()
    assert report["checks"]["rows_reach_the_table"] is False
    assert "2 rows quarantined" in obj.logger.matching("[AILOGS CHECK]", level="WARNING")[-1][1]


def test_steps_keep_their_shape_and_gain_an_event_id_only_when_migrated(agent_ns, tmp_path, monkeypatch):
    spark = _WriterSpark()
    writer = _writer(agent_ns, spark, tmp_path, monkeypatch)
    row = {"session_id": 5150, "step_id": 1, "stage_name": "s", "step_name": "t", "sub_step_name": "", "progress_increment": 1.0,
           "message": "m", "status": "ended_success", "result_json": {}, "event_id": "e1"}
    writer._steps_event_id = False
    assert writer._insert_steps_chunk([row], "2026-10-21 08:00:00") == 1.0
    assert "event_id" not in spark.statements[-1] and spark.statements[-1].startswith("INSERT INTO `c`.`s`.__inspire_step")
    writer._steps_event_id = True
    writer._insert_steps_chunk([row], "2026-10-21 08:00:00", resend=True)
    assert spark.statements[-1].startswith("MERGE INTO `c`.`s`.__inspire_step AS t")
    assert "t.event_id = s.event_id" in spark.statements[-1]
    spark.statements.clear()
    assert writer._ensure_steps_event_id() is True
    assert spark.statements == ["DESCRIBE TABLE `c`.`s`.__inspire_step",
                                "ALTER TABLE `c`.`s`.`__inspire_step` ADD COLUMN event_id STRING"]


def test_without_a_database_rows_go_to_the_jsonl_next_to_the_live_log(agent_ns, tmp_path, monkeypatch):
    from v120_artifacts_support import make_inspire
    rec = agent_ns["AILogRecorder"]()
    monkeypatch.setitem(agent_ns, "AILOG_RECORDER", rec)
    obj = make_inspire(agent_ns, session_id=42, local_log_output_dir=str(tmp_path),
                       atomic_writer=types.SimpleNamespace(enabled=False))
    obj._attach_ailogs()
    assert obj._ailogs_jsonl_path == os.path.join(str(tmp_path), "ailogs.jsonl")
    agent = _agent(agent_ns, LlmSpark(responder=lambda q, a: "ok"))
    agent._call_ai_query("hi", "T")
    lines = open(obj._ailogs_jsonl_path, encoding="utf-8").read().splitlines()
    row = json.loads(lines[0])
    assert row["session_id"] == 42 and row["agent"] == "inspire" and row["server_ingested_at"]
    report = obj._close_ailogs()
    assert report["rows"] == 1 and report["checks"]["every_request_terminates"]


def test_without_a_database_the_ailogs_check_runs_before_the_end_of_run_log_capture(agent_ns, tmp_path, monkeypatch):
    from v120_artifacts_support import make_inspire
    rec = agent_ns["AILogRecorder"]()
    monkeypatch.setitem(agent_ns, "AILOG_RECORDER", rec)
    obj = make_inspire(agent_ns, session_id=43, local_log_output_dir=str(tmp_path), atomic_writer=None)
    obj._attach_ailogs()
    agent = _agent(agent_ns, LlmSpark(responder=lambda q, a: "ok"))
    agent._call_ai_query("hi", "T")
    obj._upload_log_file()
    messages = [msg for _level, msg in obj.logger.records]
    check = next(i for i, msg in enumerate(messages) if msg.startswith("[AILOGS CHECK]"))
    capture = next(i for i, msg in enumerate(messages) if msg == "[G28 END_OF_RUN_LOG_CAPTURE FIRED]")
    assert check < capture
    assert obj.ailogs_check["rows"] == 1
    first = obj.ailogs_check
    obj.logger.records.clear()
    obj.finalize_atomic_writer(success=True)
    assert obj.ailogs_check is first
    assert not any(msg.startswith("[AILOGS CHECK]") for _level, msg in obj.logger.records)
    agent._call_ai_query("after close", "T")
    assert len(open(obj._ailogs_jsonl_path, encoding="utf-8").read().splitlines()) == 1
