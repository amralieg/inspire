"""A Discover run on a fresh inspire_database schema logged two TABLE_OR_VIEW_NOT_FOUND warnings for __inspire_session: the
background flush read the session's processing_status before initialize_session had created the table. The flush now waits
for the session row, then reads it as before."""
from v120_artifacts_support import CapturingLogger, FakeSpark


def _missing_table(statement):
    if statement.startswith("SELECT processing_status FROM") or statement.startswith("SELECT session_id FROM"):
        raise RuntimeError("[TABLE_OR_VIEW_NOT_FOUND] The table or view `c`.`fresh`.`__inspire_session` cannot be found.")
    return []


def _writer(ns, spark, tmp_path, monkeypatch, **widgets):
    monkeypatch.setattr(ns["tempfile"], "tempdir", str(tmp_path), raising=False)
    return ns["AtomicWriter"](spark, CapturingLogger(), "c.fresh", 7007, widget_values=widgets)


def test_a_flush_before_the_session_exists_reads_nothing_and_warns_nothing(agent_ns, tmp_path, monkeypatch):
    spark = FakeSpark(responder=_missing_table)
    writer = _writer(agent_ns, spark, tmp_path, monkeypatch, operation="Discover Use Cases", business="Acme")
    try:
        assert writer.flush_pending(force=False) == 0
    finally:
        writer._session_writer.stop(drain_timeout=5.0)
    assert not [s for s in spark.statements if "__inspire_session" in s], spark.statements
    assert not [msg for level, msg in writer.logger.records if level == "WARNING"], writer.logger.records


def test_after_the_session_is_written_the_flush_reads_its_status(agent_ns, tmp_path, monkeypatch):
    spark = FakeSpark(responder=lambda s: [{"processing_status": "ready"}] if s.startswith("SELECT processing_status FROM") else [])
    writer = _writer(agent_ns, spark, tmp_path, monkeypatch, operation="Discover Use Cases", business="Acme")
    try:
        writer.initialize_session()
        before = len(spark.statements)
        writer.flush_pending(force=False)
        reads = [s for s in spark.statements[before:] if s.startswith("SELECT processing_status FROM")]
    finally:
        writer._session_writer.stop(drain_timeout=5.0)
    assert len(reads) == 1 and "`c`.`fresh`.__inspire_session WHERE session_id = 7007" in reads[0]
    assert not [msg for level, msg in writer.logger.records if "failed reading processing_status" in msg]


def test_an_attached_session_is_ready_for_the_flush(agent_ns, tmp_path, monkeypatch):
    spark = FakeSpark(responder=lambda s: [{"session_id": 7007}] if s.startswith("SELECT session_id FROM") else [])
    writer = _writer(agent_ns, spark, tmp_path, monkeypatch, operation="Generate Use Cases", business="Acme")
    try:
        writer.initialize_session()
        assert writer.attached_to_existing_session is True
        before = len(spark.statements)
        writer.flush_pending(force=False)
        assert [s for s in spark.statements[before:] if s.startswith("SELECT processing_status FROM")]
    finally:
        writer._session_writer.stop(drain_timeout=5.0)
