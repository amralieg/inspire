import json
import re
import time
from pathlib import Path

import pytest

NOTEBOOK = Path(__file__).resolve().parents[2] / "agent" / "dbx_inspire_ai_agent.ipynb"

CONFLICTS = [
    "[DELTA_CONCURRENT_APPEND.WITHOUT_HINT] A concurrent UPDATE added data to table c.s.__inspire_session",
    "[DELTA_CONCURRENT_DELETE_READ] ConcurrentDeleteReadException: This transaction attempted to read one or more files",
    "[DELTA_CONCURRENT_DELETE_DELETE] ConcurrentDeleteDeleteException",
    "[DELTA_METADATA_CHANGED] MetadataChangedException: The metadata of the Delta table has been changed by a concurrent update.",
    "[DELTA_PROTOCOL_CHANGED] ProtocolChangedException",
    "io.delta.exceptions.ConcurrentTransactionException",
    "[DELTA_CONCURRENT_WRITE] ConcurrentWriteException",
]
NOT_CONFLICTS = [
    "[TABLE_OR_VIEW_NOT_FOUND] The table or view `c`.`s`.`t` cannot be found.",
    "PERMISSION_DENIED: User does not have MODIFY on Table 'c.s.__inspire_session'",
    "[INSUFFICIENT_PERMISSIONS] Insufficient privileges",
    "MAXIMUM_CONCURRENT_RUNS_REACHED",
    "[UNRESOLVED_COLUMN.WITH_SUGGESTION] A column with name `statu` cannot be resolved.",
]


def _cell1():
    return "".join(json.loads(NOTEBOOK.read_text(encoding="utf-8"))["cells"][1]["source"])


class _Logger:
    def __init__(self):
        self.records = []

    def _add(self, level, msg):
        self.records.append((level, str(msg)))

    def info(self, msg, *a, **k):
        self._add("INFO", msg)

    def warning(self, msg, *a, **k):
        self._add("WARNING", msg)

    def error(self, msg, *a, **k):
        self._add("ERROR", msg)

    def debug(self, msg, *a, **k):
        self._add("DEBUG", msg)

    def matching(self, needle, level=None):
        return [m for lv, m in self.records if needle in m and (level is None or lv == level)]


@pytest.fixture
def slept(monkeypatch):
    waits = []
    monkeypatch.setattr(time, "sleep", waits.append)
    return waits


def _failing(errors, result="done"):
    calls = []

    def write():
        calls.append(1)
        if errors:
            raise RuntimeError(errors.pop(0))
        return result
    return write, calls


@pytest.mark.parametrize("message", CONFLICTS)
def test_every_delta_conflict_class_counts_as_a_conflict(agent_ns, message):
    assert agent_ns["inspire_is_write_conflict"](RuntimeError(message))


@pytest.mark.parametrize("message", NOT_CONFLICTS)
def test_other_errors_are_not_conflicts(agent_ns, message):
    assert not agent_ns["inspire_is_write_conflict"](RuntimeError(message))


@pytest.mark.parametrize("message", CONFLICTS)
def test_a_conflict_is_retried_with_growing_jittered_waits(agent_ns, slept, message):
    write, calls = _failing([message] * 4)
    assert agent_ns["inspire_retry_write_conflicts"](write, "the test write") == "done"
    assert len(calls) == 5 and len(slept) == 4
    base = agent_ns["INSPIRE_WRITE_CONFLICT_BASE_SECONDS"]
    for attempt, wait in enumerate(slept, start=1):
        floor = base * 2 ** (attempt - 1)
        assert floor <= wait <= 2 * floor


def test_the_retry_window_covers_about_two_minutes(agent_ns, slept):
    attempts = agent_ns["inspire_write_conflict_attempts"]()
    write, calls = _failing([CONFLICTS[0]] * 1000)
    with pytest.raises(agent_ns["InspireWriteConflict"]):
        agent_ns["inspire_retry_write_conflicts"](write, "the test write")
    assert len(calls) == attempts and attempts >= 8
    assert 60 <= sum(slept) <= 2 * agent_ns["INSPIRE_WRITE_CONFLICT_WINDOW_SECONDS"]
    assert max(slept) <= 2 * agent_ns["INSPIRE_WRITE_CONFLICT_MAX_WAIT_SECONDS"]


@pytest.mark.parametrize("message", NOT_CONFLICTS)
def test_a_non_conflict_is_raised_at_once_without_a_retry(agent_ns, slept, message):
    write, calls = _failing([message])
    with pytest.raises(RuntimeError) as raised:
        agent_ns["inspire_retry_write_conflicts"](write, "the test write")
    assert not isinstance(raised.value, agent_ns["InspireWriteConflict"])
    assert len(calls) == 1 and slept == []


def test_a_lasting_conflict_names_the_conflict_not_permissions(agent_ns, slept):
    write, _calls = _failing([CONFLICTS[0]] * 1000)
    with pytest.raises(agent_ns["InspireWriteConflict"]) as raised:
        agent_ns["inspire_retry_write_conflicts"](write, "the initialize write to c.s.__inspire_session", max_attempts=3)
    text = str(raised.value)
    assert "conflicted with other Inspire runs" in text and "not missing write access" in text
    assert "DELTA_CONCURRENT_APPEND" in text and "check write access" not in text.lower()


class _Spark:
    def __init__(self, errors):
        self.errors = list(errors)
        self.calls = []

    def sql(self, statement, args=None):
        self.calls.append(statement)
        if self.errors:
            raise RuntimeError(self.errors.pop(0))
        return self


@pytest.mark.parametrize("message", CONFLICTS)
def test_the_session_writer_retries_every_conflict_class(agent_ns, message):
    spark = _Spark([message] * 2)
    logger = _Logger()
    writer = agent_ns["SessionMutationWriter"](spark, "c.s.__inspire_session", 7, logger, base_backoff_seconds=0.001)
    try:
        assert writer.submit_and_wait("UPDATE c.s.__inspire_session SET x = 1 WHERE session_id = 7", tag="initialize", timeout=10)
    finally:
        writer.stop(drain_timeout=5)
    assert len(spark.calls) == 3 and len(logger.matching("[G19 SINGLE_WRITER RETRY]")) == 2
    assert "initialize" not in writer.failures


def _writer_failing(agent_ns, message):
    spark = _Spark([message] * 50)
    writer = agent_ns["SessionMutationWriter"](spark, "c.s.__inspire_session", 7, _Logger(), max_retries=3, base_backoff_seconds=0.001)
    try:
        assert not writer.submit_and_wait("MERGE INTO c.s.__inspire_session", tag="initialize", timeout=10)
    finally:
        writer.stop(drain_timeout=5)
    atomic = object.__new__(agent_ns["AtomicWriter"])
    atomic._session_writer, atomic.session_table, atomic.inspire_database = writer, "c.s.__inspire_session", "c.s"
    return atomic.session_write_failure("initialize")


def test_a_session_setup_conflict_is_reported_as_a_conflict(agent_ns):
    text = _writer_failing(agent_ns, CONFLICTS[0])
    assert "other Inspire runs were writing c.s.__inspire_session at the same time" in text
    assert "your access is fine" in text and "check write access" not in text.lower()


def test_a_denied_session_write_still_points_at_write_access(agent_ns):
    text = _writer_failing(agent_ns, NOT_CONFLICTS[1])
    assert "check write access to c.s" in text and "other Inspire runs" not in text


def test_the_initialize_error_uses_the_real_cause():
    src = _cell1()
    assert "would not see this run: {self.session_write_failure('initialize')}" in src
    assert "the Inspire App would not see this run. Check write access" not in src


TRACKING_TABLES = r"self\.session_table|self\.steps_table|self\.ailogs_table|self\.lock_table|self\._tracking_table_name|implement_table"


def test_every_tracking_merge_names_its_rows_in_the_target_predicate():
    src = _cell1()
    merges = re.findall(r"MERGE INTO \{(?:" + TRACKING_TABLES + r")\}.*?\bON ([^\n]*)", src, re.S)
    assert len(merges) >= 5, merges
    for on in merges:
        assert re.match(r"(target|t)\.`?(session_id|business_name)`? (= \{|IN \()", on), on


def test_every_tracking_update_and_delete_is_scoped_to_its_rows():
    src = _cell1()
    statements = re.findall(r"(?:UPDATE|DELETE FROM) \{(?:" + TRACKING_TABLES + r")\}(.{0,400})", src, re.S)
    assert len(statements) >= 9
    for rest in statements:
        assert re.search(r"WHERE (session_id|business_name) = ", rest), rest[:200]


def test_the_known_merges_carry_the_session_predicate():
    src = _cell1()
    for needle in ("ON target.session_id = {self.session_id} AND target.session_id = source.session_id",
                   "ON t.session_id = {int(self.session_id)} AND t.session_id = s.session_id AND t.event_id = s.event_id",
                   "ON t.`session_id` = {int(self.session_id)} AND t.`session_id` = s.`session_id` AND t.`ailogs_id` = s.`ailogs_id`",
                   "ON t.session_id IN ({sessions}) AND t.session_id = s.session_id AND t.id = s.id",
                   "ON target.business_name = {business_sql} AND target.business_name = source.business_name"):
        assert needle in src, needle


ROW_CONCURRENCY = ("'delta.enableDeletionVectors' = 'true'", "'delta.enableRowTracking' = 'true'")


def test_create_ddl_turns_on_clustering_and_row_level_concurrency(agent_ns):
    for sql, key in ((agent_ns["ailogs_create_table_sql"]("c.s.__inspire_ailogs"), "CLUSTER BY (`session_id`, `agent`)"),
                     (agent_ns["implement_table_create_sql"]("c.s.__inspire_implement"), "CLUSTER BY (`session_id`, `use_case_id`)"),
                     (agent_ns["inspire_row_concurrency_sql"](["session_id"]), "CLUSTER BY (session_id)")):
        assert key in sql and all(p in sql for p in ROW_CONCURRENCY), sql
    src = _cell1()
    assert src.count('USING DELTA {inspire_row_concurrency_sql(["session_id"])}') == 3
    assert src.count('USING DELTA {inspire_row_concurrency_sql(["business_name"])}') == 1
    for table, key in (("self.session_table", '["session_id"]'), ("self.steps_table", '["session_id"]'),
                       ("self.lock_table", '["business_name"]'), ("tracking_table", '["session_id"]'),
                       ("self.ailogs_table", "list(AILOGS_CLUSTER_BY)"), ("self.implement_table", '["session_id", "use_case_id"]')):
        assert f"inspire_ensure_row_concurrency(self.spark, {table}, {key}, self.logger)" in src, table


class _Row(dict):
    def asDict(self):
        return dict(self)


class _DetailSpark:
    def __init__(self, detail, deny=None):
        self.detail, self.deny, self.calls = detail, deny, []

    def sql(self, statement):
        self.calls.append(statement)
        if statement.startswith("DESCRIBE DETAIL"):
            return type("R", (), {"collect": lambda _s: [_Row(self.detail)]})()
        if self.deny and statement.startswith("ALTER"):
            raise RuntimeError(self.deny)
        return self


def test_an_old_table_is_altered_once_to_row_level_concurrency(agent_ns):
    spark = _DetailSpark({"properties": {}, "clusteringColumns": [], "partitionColumns": []})
    logger = _Logger()
    assert agent_ns["inspire_ensure_row_concurrency"](spark, "c.s.__inspire_session", ["session_id"], logger)
    alters = [c for c in spark.calls if c.startswith("ALTER")]
    assert alters == ["ALTER TABLE c.s.__inspire_session SET TBLPROPERTIES ('delta.enableDeletionVectors' = 'true', "
                      "'delta.enableRowTracking' = 'true')", "ALTER TABLE c.s.__inspire_session CLUSTER BY (session_id)"]
    assert logger.matching("[ROW-CONCURRENCY FIRED]")


def test_a_ready_table_gets_no_alter_so_no_metadata_commit(agent_ns):
    spark = _DetailSpark({"properties": {"delta.enableDeletionVectors": "true", "delta.enableRowTracking": "true"},
                          "clusteringColumns": ["session_id"], "partitionColumns": []})
    assert agent_ns["inspire_ensure_row_concurrency"](spark, "c.s.__inspire_step", ["session_id"], _Logger())
    assert [c for c in spark.calls if not c.startswith("DESCRIBE")] == []


def test_a_partitioned_table_keeps_its_partitions(agent_ns):
    spark = _DetailSpark({"properties": {}, "clusteringColumns": [], "partitionColumns": ["session_id"]})
    agent_ns["inspire_ensure_row_concurrency"](spark, "c.s.t_part", ["session_id"], _Logger())
    assert not any("CLUSTER BY" in c for c in spark.calls)


def test_an_alter_the_identity_may_not_run_is_tolerated_and_logged_once(agent_ns, slept):
    logger = _Logger()
    table = "c.s.__inspire_denied_alter"
    for _ in range(3):
        spark = _DetailSpark({"properties": {}, "clusteringColumns": [], "partitionColumns": []},
                             deny="PERMISSION_DENIED: User does not have MODIFY on Table")
        assert agent_ns["inspire_ensure_row_concurrency"](spark, table, ["session_id"], logger) is False
    warned = logger.matching("[ROW-CONCURRENCY]", level="WARNING")
    assert len(warned) == 1 and "keeps file-level conflict checks" in warned[0] and slept == []


def test_an_alter_that_meets_a_conflict_is_retried(agent_ns, slept):
    spark = _DetailSpark({"properties": {"delta.enableDeletionVectors": "true", "delta.enableRowTracking": "true"},
                          "clusteringColumns": [], "partitionColumns": []})
    errors = [CONFLICTS[3]]
    original = spark.sql

    def sql(statement):
        if statement.startswith("ALTER") and errors:
            spark.calls.append(statement)
            raise RuntimeError(errors.pop(0))
        return original(statement)
    spark.sql = sql
    assert agent_ns["inspire_ensure_row_concurrency"](spark, "c.s.__inspire_lock", ["business_name"], _Logger())
    assert [c for c in spark.calls if c.startswith("ALTER")] == ["ALTER TABLE c.s.__inspire_lock CLUSTER BY (business_name)"] * 2
    assert len(slept) == 1


def test_no_second_conflict_classifier_or_short_retry_remains():
    src = _cell1()
    assert "INSPIRE_CONCURRENT_SCHEMA_ERRORS" not in src and "_is_concurrent_error" not in src
    assert 'retryable_errors=["concurrent"]' not in src
    assert '"concurrent" not in' not in src and "'concurrent' not in" not in src and '"concurrent" in str' not in src


class _Frame:
    def __init__(self, rows):
        self.rows = rows

    def collect(self):
        return self.rows


class _ConflictingSpark:
    def __init__(self, conflicts, describe=()):
        self.conflicts, self.describe, self.statements = list(conflicts), list(describe), []

    def sql(self, statement):
        self.statements.append(statement)
        if statement.startswith("DESCRIBE TABLE"):
            return _Frame([{"col_name": name} for name in self.describe])
        if self.conflicts:
            raise RuntimeError(self.conflicts.pop(0))
        if statement.startswith("ALTER TABLE"):
            self.describe.append(statement.split("ADD COLUMN ", 1)[1].split()[0].strip("`"))
        return _Frame([{"num_affected_rows": 1}])


def _generated_run_ns(agent_ns):
    ns = {"__name__": "generated_run"}
    exec(compile(agent_ns["REDACT_SOURCE"], "<redact>", "exec"), ns)
    exec(compile(agent_ns["IMPLEMENT_RESULT_HISTORY_SOURCE"], "<inspire_result_history>", "exec"), ns)
    return ns


def test_the_generated_run_retries_business_output_conflicts_with_only_its_own_source(agent_ns, slept):
    ns = _generated_run_ns(agent_ns)
    assert "RetryHandler" not in ns and "inspire_ensure_row_concurrency" not in ns
    spark, printed = _ConflictingSpark(CONFLICTS[:2]), []
    rows = ns["inspire_sql_retrying"](spark, "MERGE INTO t USING s ON t.k = s.k", "c.s.t", "saving", "the save", printed.append)
    attempts = ns["inspire_write_conflict_attempts"]()
    assert rows == [{"num_affected_rows": 1}] and len(spark.statements) == 3 and len(slept) == 2
    assert printed[-1].endswith(f"(attempt 3 of {attempts})") and 0.5 <= slept[0] <= 1.0 and 1.0 <= slept[1] <= 2.0
    denied = _ConflictingSpark([NOT_CONFLICTS[1]])
    with pytest.raises(RuntimeError, match="PERMISSION_DENIED"):
        ns["inspire_sql_retrying"](denied, "MERGE INTO t", "c.s.t", "saving", "the save", printed.append)
    assert len(denied.statements) == 1


def test_the_generated_run_adds_a_column_through_the_shared_retry_and_reports_a_lasting_conflict(agent_ns, slept):
    ns = _generated_run_ns(agent_ns)
    spark = _ConflictingSpark(CONFLICTS[:1], describe=["id"])
    added, failed, existing = ns["inspire_add_missing_columns"](spark, "c.s.t", [("note", "STRING")])
    assert added == ["note"] and failed == [] and "note" in existing and len(slept) == 1
    stuck = _ConflictingSpark([CONFLICTS[0]] * 100, describe=["id"])
    added, failed, _ = ns["inspire_add_missing_columns"](stuck, "c.s.t", [("note", "STRING")])
    attempts = ns["inspire_write_conflict_attempts"]()
    alters = [s for s in stuck.statements if s.startswith("ALTER TABLE")]
    assert added == [] and len(alters) == attempts and failed[0][0] == "note" and "DELTA_CONCURRENT_APPEND" in failed[0][1]
    raced = _ConflictingSpark(["[FIELDS_ALREADY_EXISTS] Cannot add column, because `note` already exists"], describe=["id"])
    added, failed, existing = ns["inspire_add_missing_columns"](raced, "c.s.t", [("note", "STRING")])
    assert added == [] and failed == [] and "note" in existing
