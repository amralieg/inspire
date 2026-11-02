"""v1.2.0 ARTIFACTS lane: session writer, lock, /tmp fallbacks, language codes and run outcome.

D1-07 submit_and_wait reports failure and timeout; session init/finalize surface a lost write;
D1-08 the storage, spool and log fallbacks reuse the B17 mkdtemp pattern; D1-13 the session stores
the canonical quality mode; D1-14 the lock is one atomic MERGE and never fail-open; D1-18 the session
tables are quoted; D1-19 ISO 639-1 codes for every documents language; failed artifact steps are
recorded in the session result_json while the run stays successful with a WARNING.
"""
import json
import os
import re
import threading
import time
import types

import pytest

from v120_artifacts_support import CapturingLogger, FakeSpark, make_inspire


class _FailingSpark:
    def __init__(self, error="AnalysisException: table not found", delay=0.0):
        self.error = error
        self.delay = delay
        self.calls = []

    def sql(self, statement):
        self.calls.append(statement)
        if self.delay:
            time.sleep(self.delay)
        if self.error:
            raise RuntimeError(self.error)
        return self


def _writer(ns, spark, **kw):
    return ns["SessionMutationWriter"](spark, "`c`.`s`.__inspire_session", 11, CapturingLogger(),
                                       base_backoff_seconds=0.01, **kw)


def test_submit_and_wait_reports_sql_failure(agent_ns):
    writer = _writer(agent_ns, _FailingSpark())
    try:
        assert writer.submit_and_wait("UPDATE t SET x = 1", tag="t", timeout=5.0) is False
    finally:
        writer.stop(drain_timeout=5.0)


def test_submit_and_wait_reports_timeout(agent_ns):
    writer = _writer(agent_ns, _FailingSpark(error=None, delay=1.0))
    try:
        assert writer.submit_and_wait("UPDATE t SET x = 1", tag="slow", timeout=0.1) is False
        assert writer.logger.matching("[G19 SINGLE_WRITER TIMEOUT]", level="ERROR")
    finally:
        writer.stop(drain_timeout=5.0)


def test_submit_and_wait_reports_success_and_fails_fast_once_stopped(agent_ns):
    spark = _FailingSpark(error=None)
    writer = _writer(agent_ns, spark)
    assert writer.submit_and_wait("UPDATE t SET x = 1", tag="ok", timeout=5.0) is True
    writer.stop(drain_timeout=5.0)
    started = time.time()
    assert writer.submit_and_wait("UPDATE t SET x = 2", tag="late", timeout=30.0) is False
    assert time.time() - started < 5.0
    assert writer.logger.matching("[G19 SINGLE_WRITER STOPPED]", level="ERROR")


def _atomic_writer(ns, spark, tmp_path, monkeypatch, **widget_values):
    monkeypatch.setattr(ns["tempfile"], "tempdir", str(tmp_path), raising=False)
    return ns["AtomicWriter"](spark, CapturingLogger(), "my-cat.inspire", 5150, widget_values=widget_values)


def test_session_tables_are_quoted(agent_ns, tmp_path, monkeypatch):
    writer = _atomic_writer(agent_ns, FakeSpark(), tmp_path, monkeypatch)
    try:
        assert writer.session_table == "`my-cat`.`inspire`.__inspire_session"
        assert writer.steps_table == "`my-cat`.`inspire`.__inspire_step"
        assert writer.lock_table == "`my-cat`.`inspire`.__inspire_lock"
    finally:
        writer._session_writer.stop(drain_timeout=5.0)


def test_initialize_session_raises_when_the_session_row_is_not_written(agent_ns, tmp_path, monkeypatch):
    def responder(statement):
        if statement.startswith("MERGE INTO"):
            raise RuntimeError("PERMISSION_DENIED: MODIFY on __inspire_session")
        return []
    writer = _atomic_writer(agent_ns, FakeSpark(responder=responder), tmp_path, monkeypatch)
    try:
        with pytest.raises(RuntimeError, match="could not be recorded"):
            writer.initialize_session()
    finally:
        writer._session_writer.stop(drain_timeout=5.0)


def _session_writes(spark):
    return [s for s in spark.statements if "__inspire_session" in s and s.startswith(("MERGE", "UPDATE", "INSERT"))]


def test_a_generate_run_on_an_existing_session_keeps_its_row(agent_ns, tmp_path, monkeypatch):
    spark = FakeSpark(responder=lambda s: [{"session_id": 5150}] if s.startswith("SELECT session_id FROM") else [])
    writer = _atomic_writer(agent_ns, spark, tmp_path, monkeypatch, operation="Generate Use Cases", business="Acme")
    try:
        writer.initialize_session()
        assert writer.attached_to_existing_session is True
        writer._update_session_ready("2026-10-24 12:01:00")
        assert writer._finalize_session("2026-10-24 12:05:00", final_results_json={"ailogs_check": {"passed": 7}}) is True
    finally:
        writer._session_writer.stop(drain_timeout=5.0)
    writes = _session_writes(spark)
    assert len(writes) == 3, writes
    for statement in writes:
        assert statement.startswith("UPDATE") and "SET last_updated = TIMESTAMP(" in statement, statement
        for column in ("results_json", "inspire_json", "completed_on", "create_at", "operation_mode", "completed_percent"):
            assert column not in statement, ("a regeneration rewrote the Discover session's results", column)
    assert writer.logger.matching("[SESSION-ATTACH FIRED]")


def test_a_discover_run_or_a_generate_run_without_a_row_writes_the_session_row(agent_ns, tmp_path, monkeypatch):
    for operation, rows in (("Discover Use Cases", [{"session_id": 5150}]), ("Generate Use Cases", [])):
        spark = FakeSpark(responder=lambda s, rows=rows: rows if s.startswith("SELECT session_id FROM") else [])
        writer = _atomic_writer(agent_ns, spark, tmp_path, monkeypatch, operation=operation, business="Acme")
        try:
            writer.initialize_session()
            assert writer.attached_to_existing_session is False, operation
            writer._finalize_session("2026-10-24 12:05:00", final_results_json={"domains": []})
        finally:
            writer._session_writer.stop(drain_timeout=5.0)
        writes = _session_writes(spark)
        assert writes[0].startswith("MERGE INTO") and "target.results_json = source.results_json" in writes[0], operation
        assert any("results_json = parse_json(" in s and "completed_on = TIMESTAMP(" in s for s in writes[1:]), operation


def test_a_generate_run_that_cannot_read_its_session_keeps_the_row(agent_ns, tmp_path, monkeypatch):
    def responder(statement):
        if statement.startswith("SELECT session_id FROM"):
            raise RuntimeError("TEMPORARILY_UNAVAILABLE")
        return []
    spark = FakeSpark(responder=responder)
    writer = _atomic_writer(agent_ns, spark, tmp_path, monkeypatch, operation="Generate Use Cases", business="Acme")
    try:
        writer.initialize_session()
    finally:
        writer._session_writer.stop(drain_timeout=5.0)
    assert writer.attached_to_existing_session is True
    assert not [s for s in _session_writes(spark) if s.startswith("MERGE")], "a failed read never turns into an overwrite"
    assert writer.logger.matching("keeps any existing row as it is", level="WARNING")


def test_an_attached_regeneration_never_fails_on_its_last_updated_write(agent_ns, tmp_path, monkeypatch):
    def responder(statement):
        if statement.startswith("SELECT session_id FROM"):
            return [{"session_id": 5150}]
        if statement.startswith("UPDATE") and "SET last_updated" in statement:
            raise RuntimeError("PERMISSION_DENIED: MODIFY on __inspire_session")
        return []
    writer = _atomic_writer(agent_ns, FakeSpark(responder=responder), tmp_path, monkeypatch, operation="Generate Use Cases")
    writer._consume_pending_events_stream = lambda ts, chunk_size=300: (0, 0, 0.0)
    writer.initialize_session()
    writer.finalize_pipeline(final_results_json={"ailogs_check": {}})
    assert writer.session_finalized is True, "the Discover completion stands, so the regeneration's work is not failed"
    assert writer.logger.matching("the session keeps its Discover completion", level="WARNING")


def test_finalize_pipeline_raises_after_stopping_the_writer_when_completion_is_lost(agent_ns, tmp_path, monkeypatch):
    def responder(statement):
        if statement.startswith("UPDATE") and "completed_percent = 100.0" in statement:
            raise RuntimeError("PERMISSION_DENIED: UPDATE")
        return []
    spark = FakeSpark(responder=responder)
    writer = _atomic_writer(agent_ns, spark, tmp_path, monkeypatch)
    writer._consume_pending_events_stream = lambda ts, chunk_size=300: (0, 0, 0.0)
    with pytest.raises(RuntimeError, match="completion could not be recorded"):
        writer.finalize_pipeline(final_results_json={"failed_steps": []})
    assert writer.session_finalized is False
    assert not writer._session_writer._worker.is_alive()


def test_session_stores_the_canonical_quality_mode(agent_ns, tmp_path, monkeypatch):
    aliases = agent_ns["USE_CASES_QUALITY_ALIASES"]
    label, canonical = next(iter(aliases.items()))
    writer = _atomic_writer(agent_ns, FakeSpark(), tmp_path, monkeypatch,
                            use_cases_quality=f"  {label.upper()} ")
    try:
        assert writer._widget_to_columns_map()["use_cases_quality"] == canonical
        writer.widget_values["use_cases_quality"] = agent_ns["USE_CASES_QUALITY_VALID"][0].lower()
        assert writer._widget_to_columns_map()["use_cases_quality"] == agent_ns["USE_CASES_QUALITY_VALID"][0]
        writer.widget_values["use_cases_quality"] = "not a mode"
        with pytest.raises(ValueError, match="Valid options"):
            writer._widget_to_columns_map()
    finally:
        writer._session_writer.stop(drain_timeout=5.0)


class _LockSpark(FakeSpark):
    def __init__(self, holders, merge_errors=()):
        super().__init__(responder=self._respond)
        self.holders = holders
        self.merge_errors = list(merge_errors)

    def _respond(self, statement):
        if statement.startswith("MERGE INTO"):
            if self.merge_errors:
                raise RuntimeError(self.merge_errors.pop(0))
            return []
        if statement.startswith("SELECT DISTINCT session_id, holder_note"):
            return [(5150, note) for note in self.holders]
        return []


def _lock_writer(ns, spark, tmp_path, monkeypatch, own=False):
    writer = _atomic_writer(ns, spark, tmp_path, monkeypatch)
    writer._session_writer.stop(drain_timeout=5.0)
    if own:
        spark.holders = ["op" + writer._lock_holder]
    return writer


def test_lock_is_one_atomic_merge_and_acquired_only_when_verified(agent_ns, tmp_path, monkeypatch):
    spark = _LockSpark(holders=[])
    writer = _lock_writer(agent_ns, spark, tmp_path, monkeypatch, own=True)
    assert writer.acquire_lock("Acme's", ttl_seconds=60, holder_note="op") is True
    merges = [s for s in spark.statements if s.startswith("MERGE INTO")]
    assert len(merges) == 1
    assert (f"WHEN MATCHED AND (target.holder_note LIKE '%{writer._lock_holder}' OR target.expires_at < current_timestamp())"
            in merges[0])
    assert f"'op{writer._lock_holder}' AS holder_note" in merges[0]
    assert "'Acme\\'s' AS business_name" in merges[0]
    assert not any(s.startswith(("DELETE", "INSERT")) for s in spark.statements)


def test_lock_held_by_another_live_session_is_not_acquired(agent_ns, tmp_path, monkeypatch):
    writer = _lock_writer(agent_ns, _LockSpark(holders=["op|holder=" + "a" * 32]), tmp_path, monkeypatch)
    assert writer.acquire_lock("Acme") is False


def test_a_second_run_of_the_same_session_does_not_share_the_lock(agent_ns, tmp_path, monkeypatch):
    first = _lock_writer(agent_ns, _LockSpark(holders=[]), tmp_path, monkeypatch)
    spark = _LockSpark(holders=["operation=Generate Use Cases" + first._lock_holder])
    second = _lock_writer(agent_ns, spark, tmp_path, monkeypatch)
    assert second.session_id == first.session_id and second._lock_holder != first._lock_holder
    assert second.acquire_lock("Acme") is False, "two Genie jobs of one session must not both regenerate"
    second.release_lock("Acme")
    [delete] = [s for s in spark.statements if s.startswith("DELETE")]
    assert delete.endswith(f"AND holder_note LIKE '%{second._lock_holder}'") and "session_id" not in delete


def test_lock_infrastructure_failure_is_raised_not_fail_open(agent_ns, tmp_path, monkeypatch):
    writer = _lock_writer(agent_ns, _LockSpark(holders=[], merge_errors=["PERMISSION_DENIED: MODIFY"]), tmp_path, monkeypatch)
    with pytest.raises(RuntimeError, match="could not be acquired or verified"):
        writer.acquire_lock("Acme")
    assert writer.logger.matching("PERMISSION_DENIED: MODIFY", level="WARNING")


def test_lock_retries_a_concurrent_conflict(agent_ns, tmp_path, monkeypatch):
    spark = _LockSpark(holders=[], merge_errors=["ConcurrentAppendException: files were added"])
    writer = _lock_writer(agent_ns, spark, tmp_path, monkeypatch, own=True)
    assert writer.acquire_lock("Acme") is True
    assert len([s for s in spark.statements if s.startswith("MERGE INTO")]) == 2


DEAD_HOLDER = "operation=Implement Use Cases spec=9|run=4444444444444444|holder=" + "b" * 32
LIVE_HOLDER = "operation=Implement Use Cases spec=9|run=1234567890000027|holder=" + "c" * 32


class _ReclaimSpark(_LockSpark):
    def __init__(self, holders):
        super().__init__(holders=holders)
        self.after_delete = []

    def _respond(self, statement):
        if statement.startswith("DELETE FROM") and " AND holder_note = " in statement:
            self.holders = [n for n in self.holders if f"holder_note = '{n}'" not in statement] + self.after_delete
            return []
        return super()._respond(statement)


def _run_states(agent_ns, monkeypatch, states):
    asked = []
    monkeypatch.setitem(agent_ns, "job_run_ended", lambda run_id: asked.append(run_id) or (
        {"state": states[run_id], "end_time": 1761400000000} if run_id in states else None))
    return asked


def test_the_lock_records_the_run_that_holds_it(agent_ns, tmp_path, monkeypatch):
    monkeypatch.setitem(agent_ns, "current_job_run_id", lambda: "4444444444444444")
    writer = _lock_writer(agent_ns, _LockSpark(holders=[]), tmp_path, monkeypatch)
    assert re.fullmatch(r"\|run=4444444444444444\|holder=[0-9a-f]{32}", writer._lock_holder)


def test_a_lock_whose_holder_run_ended_is_reclaimed(agent_ns, tmp_path, monkeypatch):
    asked = _run_states(agent_ns, monkeypatch, {"4444444444444444": "CANCELED"})
    spark = _ReclaimSpark(holders=[DEAD_HOLDER])
    writer = _lock_writer(agent_ns, spark, tmp_path, monkeypatch)
    spark.after_delete = ["op" + writer._lock_holder]
    assert writer.acquire_lock("Acme", holder_note="op") is True
    assert asked == ["4444444444444444"]
    [delete] = [s for s in spark.statements if s.startswith("DELETE")]
    assert delete.endswith(f"WHERE business_name = 'Acme' AND holder_note = '{DEAD_HOLDER}'")
    assert len([s for s in spark.statements if s.startswith("MERGE INTO")]) == 2
    assert writer.logger.matching("held by run 4444444444444444, which ended (CANCELED) without releasing it", level="WARNING")


@pytest.mark.parametrize("holders", [[DEAD_HOLDER, LIVE_HOLDER], [LIVE_HOLDER]], ids=["one_alive", "alive"])
def test_a_lock_is_not_reclaimed_while_any_holder_run_may_be_alive(agent_ns, tmp_path, monkeypatch, holders):
    _run_states(agent_ns, monkeypatch, {"4444444444444444": "FAILED"})
    spark = _ReclaimSpark(holders=list(holders))
    writer = _lock_writer(agent_ns, spark, tmp_path, monkeypatch)
    assert writer.acquire_lock("Acme") is False
    assert not any(s.startswith("DELETE") for s in spark.statements)


def test_a_lock_is_reclaimed_at_most_once_per_attempt_to_take_it(agent_ns, tmp_path, monkeypatch):
    asked = _run_states(agent_ns, monkeypatch, {"4444444444444444": "FAILED"})
    spark = _LockSpark(holders=[DEAD_HOLDER])
    writer = _lock_writer(agent_ns, spark, tmp_path, monkeypatch)
    assert writer.acquire_lock("Acme") is False, "a reclaim whose delete did not take effect is never treated as a lock taken"
    assert asked == ["4444444444444444"] and len([s for s in spark.statements if s.startswith("DELETE")]) == 1


def test_a_lock_without_a_recorded_run_waits_for_its_expiry(agent_ns, tmp_path, monkeypatch):
    asked = _run_states(agent_ns, monkeypatch, {})
    spark = _ReclaimSpark(holders=["operation=Generate Use Cases|holder=" + "d" * 32, "op|run=|holder=" + "e" * 32])
    writer = _lock_writer(agent_ns, spark, tmp_path, monkeypatch)
    assert writer.acquire_lock("Acme") is False
    assert asked == [] and not any(s.startswith("DELETE") for s in spark.statements)


class _Option:
    def __init__(self, value=None):
        self.value = value

    def isDefined(self):
        return self.value is not None

    def get(self):
        if self.value is None:
            raise RuntimeError("None.get")
        return self.value


def _not_whitelisted(name):
    def call():
        raise RuntimeError(f"py4j.security.Py4JSecurityException: Method {name}() is not whitelisted on class CommandContext")
    return call


@pytest.mark.parametrize("methods,expected", [
    ({"idInJob": lambda: _Option(4444444444444444), "parentRunId": lambda: _Option(5555555555555555)}, "4444444444444444"),
    ({"idInJob": lambda: 4444444444444444, "parentRunId": lambda: 5555555555555555}, "4444444444444444"),
    ({"idInJob": _not_whitelisted("idInJob"), "parentRunId": lambda: _Option(5555555555555555)}, "5555555555555555"),
    ({"idInJob": lambda: _Option(), "parentRunId": lambda: _Option(5555555555555555)}, "5555555555555555"),
    ({"idInJob": lambda: _Option("not a run"), "parentRunId": _not_whitelisted("parentRunId")}, ""),
    ({"idInJob": _not_whitelisted("idInJob"), "parentRunId": _not_whitelisted("parentRunId")}, ""),
], ids=["task_run", "task_run_plain", "task_run_blocked", "task_run_undefined", "not_a_run", "all_blocked"])
def test_the_run_id_comes_from_the_notebook_context(agent_ns, monkeypatch, methods, expected):
    ctx = types.SimpleNamespace(toJson=_not_whitelisted("toJson"), currentRunId=_not_whitelisted("currentRunId"), **methods)
    inner = types.SimpleNamespace(notebook=lambda: types.SimpleNamespace(getContext=lambda: ctx))
    monkeypatch.setitem(agent_ns, "dbutils",
                        types.SimpleNamespace(notebook=types.SimpleNamespace(entry_point=types.SimpleNamespace(getDbutils=lambda: inner))))
    assert agent_ns["current_job_run_id"]() == expected


def test_the_run_id_is_empty_outside_a_job(agent_ns, monkeypatch):
    assert agent_ns["current_job_run_id"]() == "", "the offline harness has no notebook context"
    monkeypatch.delitem(agent_ns, "dbutils", raising=False)
    assert agent_ns["current_job_run_id"]() == ""


@pytest.mark.parametrize("state,status,end_time,expected", [
    ({"life_cycle_state": "TERMINATED", "result_state": "FAILED"}, None, 1761400000123, {"state": "FAILED", "end_time": 1761400000123}),
    ({"life_cycle_state": "INTERNAL_ERROR", "result_state": None}, None, 1761400000123,
     {"state": "INTERNAL_ERROR", "end_time": 1761400000123}),
    ({"life_cycle_state": "RUNNING", "result_state": None}, None, 0, None),
    ({"life_cycle_state": "TERMINATING", "result_state": None}, {"state": "TERMINATED"}, 0, None),
    (None, {"state": "TERMINATED"}, 0, {"state": "TERMINATED", "end_time": None}),
    (None, {"state": "QUEUED"}, 0, None),
], ids=["failed", "internal_error", "running", "terminating", "status_only", "queued"])
def test_job_run_ended_reads_the_run_state(agent_ns, monkeypatch, state, status, end_time, expected):
    import enum

    class Life(enum.Enum):
        TERMINATED = "TERMINATED"
        INTERNAL_ERROR = "INTERNAL_ERROR"
        RUNNING = "RUNNING"
        TERMINATING = "TERMINATING"
        QUEUED = "QUEUED"

    def wrap(fields, key):
        if fields is None:
            return None
        values = dict(fields)
        if values.get(key):
            values[key] = Life[values[key]] if values[key] in Life.__members__ else values[key]
        return types.SimpleNamespace(**values)

    run = types.SimpleNamespace(state=wrap(state, "life_cycle_state"), status=wrap(status, "state"), end_time=end_time)
    asked = []
    client = types.SimpleNamespace(jobs=types.SimpleNamespace(get_run=lambda run_id: asked.append(run_id) or run))
    monkeypatch.setitem(agent_ns, "WorkspaceClient", lambda: client)
    assert agent_ns["job_run_ended"]("4444444444444444") == expected
    assert asked == [4444444444444444]


def test_job_run_ended_is_none_when_the_run_cannot_be_read(agent_ns, monkeypatch):
    def refuse(run_id):
        raise PermissionError("User does not have permission to view this run")

    monkeypatch.setitem(agent_ns, "WorkspaceClient", lambda: types.SimpleNamespace(jobs=types.SimpleNamespace(get_run=refuse)))
    assert agent_ns["job_run_ended"]("4444444444444444") is None


def _deny(directory):
    real_open = open

    def guarded_open(path, *a, **k):
        if os.path.dirname(str(path)) == str(directory):
            raise PermissionError(13, "Permission denied", str(path))
        return real_open(path, *a, **k)
    return guarded_open


def test_b17_writable_file_falls_back_when_the_primary_file_is_not_writable(agent_ns, tmp_path, monkeypatch):
    blocked = tmp_path / "blocked"
    monkeypatch.setattr("builtins.open", _deny(blocked))
    logger = CapturingLogger()
    path = agent_ns["b17_writable_file"](str(blocked / "session_1.jsonl"), "inspire_test_", logger)
    assert os.path.dirname(path) != str(blocked) and os.path.basename(path) == "session_1.jsonl"
    assert os.path.isfile(path)
    assert logger.matching("[B17-FALLBACK]", level="WARNING")


def test_spool_uses_the_fallback_and_console_only_writer_creates_no_spool(agent_ns, tmp_path, monkeypatch):
    blocked = tmp_path / "inspire_atomic_writer"
    monkeypatch.setattr("builtins.open", _deny(blocked))
    writer = _atomic_writer(agent_ns, FakeSpark(), tmp_path, monkeypatch)
    try:
        assert writer._spool_path and os.path.dirname(writer._spool_path) != str(blocked)
        assert os.path.isfile(writer._spool_path) and writer._spool_offset == 0
        assert writer.logger.matching("[B17-FALLBACK]")
    finally:
        writer._session_writer.stop(drain_timeout=5.0)
    console_only = agent_ns["AtomicWriter"](FakeSpark(), CapturingLogger(), "", 1)
    assert console_only._spool_path == "" and console_only._session_writer is None


def test_storage_manager_falls_back_when_base_path_is_unwritable(agent_ns, tmp_path):
    missing = tmp_path / "does" / "not" / "exist"
    logger = CapturingLogger()
    manager = agent_ns["IntermediateStorageManager"](base_path=str(missing), logger=logger)
    manager.initialize()
    try:
        assert os.path.isdir(manager.temp_dir) and not manager.temp_dir.startswith(str(missing))
        assert logger.matching("[B17-FALLBACK]", level="WARNING")
    finally:
        manager.cleanup()


SUPPORTED = {
    "English": "en", "French": "fr", "German": "de", "Spanish": "es", "Hindi": "hi", "Chinese (Mandarin)": "zh",
    "Japanese": "ja", "Arabic": "ar", "Portuguese": "pt", "Russian": "ru", "Swedish": "sv", "Danish": "da",
    "Norwegian": "no", "Finnish": "fi", "Italian": "it", "Polish": "pl", "Romanian": "ro", "Ukrainian": "uk",
    "Dutch": "nl", "Korean": "ko", "Indonesian": "id", "Malay": "ms", "Tamil": "ta",
}


def test_every_documents_language_gets_its_iso_code(agent_ns):
    obj = make_inspire(agent_ns)
    assert {lang: obj._get_lang_abbr(lang) for lang in SUPPORTED} == SUPPORTED
    assert obj._get_lang_abbr("Chinese (Simplified)") == "zh"
    assert len(set(SUPPORTED.values())) == len(SUPPORTED)


def test_failed_steps_are_recorded_once_and_reach_the_session_result(agent_ns):
    obj = make_inspire(agent_ns)
    obj._record_failed_step("PDF Catalog", "Arabic", RuntimeError("weasyprint missing"))
    obj._record_failed_step("PDF Catalog", "Arabic", RuntimeError("weasyprint missing again"))
    obj._record_failed_step("Tracking Table", "", "replace failed")
    assert [(f["step"], f["language"]) for f in obj.failed_steps] == [("PDF Catalog", "Arabic"), ("Tracking Table", "")]
    assert obj.final_inspire_results_json["failed_steps"] == obj.failed_steps
    assert len(obj.logger.matching("[ARTIFACT STEP FAILED] step=PDF Catalog", level="WARNING")) == 1


def test_failed_steps_survive_the_json_catalog_replacing_the_results(agent_ns, monkeypatch):
    obj = make_inspire(agent_ns, column_id_map={}, id_column_map={}, table_id_map={}, id_table_map={},
                       catalogs_str="main", schemas_str="", generation_path="/Workspace/out")
    monkeypatch.setattr(agent_ns["workspace"], "ImportFormat", type("F", (), {"AUTO": "AUTO"}), raising=False)
    obj._record_failed_step("Use Case Excel", "English", "upload failed")
    obj._save_usecases_catalog_json([{"No": "N01-U01", "Name": "Demo", "Business Domain": "Sales"}], {}, summary_dict={"Executive": "x"})
    assert obj.final_inspire_results_json["domains"]
    assert obj.final_inspire_results_json["failed_steps"][0]["step"] == "Use Case Excel"
    saved = next(iter(obj.w_client.workspace.files.values()))
    assert b"failed_steps" not in saved


def test_processing_report_warns_about_failed_steps(agent_ns, monkeypatch):
    printed = []
    monkeypatch.setitem(agent_ns["DatabricksInspire"]._report_processing_honesty.__globals__, "log_print",
                        lambda msg, level="INFO": printed.append((level, msg)))
    obj = make_inspire(agent_ns)
    obj._record_failed_step("Presentation", "French", "python-pptx missing")
    obj._record_translation_gaps("French", {"use_cases": 2, "untranslated_use_cases": 1, "fields": {"Statement": 2}})
    obj._report_processing_honesty()
    warnings = [m for level, m in printed if level == "WARNING"]
    assert any("1 artifact step failed" in m for m in warnings)
    assert any("Presentation (French): python-pptx missing" in m for m in warnings)
    assert any("French: 2 use cases contain text shown in English" in m for m in warnings)
    assert obj.final_inspire_results_json["translation_gaps"]["French"]["use_cases"] == 2
