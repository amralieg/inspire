"""v1.6.8 BUSINESS NAME: every session row carries the business the person named, trimmed.

main() is the only place the business widget is read. It trims the value before it validates it,
so a name of spaces fails validation like an empty one and a padded name reaches DatabricksInspire
and the session row trimmed. The session row takes business_name from that validated widget value
in the one MERGE that creates the row; the schema migration can never drop that column.
"""
import ast

import pytest

from v120_artifacts_support import FakeSpark
from v120_artifacts_session_test import _atomic_writer, _session_writes
from v120_modes_main_test import NotebookExit, run_main

import _agentload


@pytest.mark.parametrize("given", ["  Acme  ", "Acme\t", "\nAcme"])
def test_a_padded_business_name_reaches_the_run_trimmed(agent_ns, monkeypatch, given):
    captured = run_main(agent_ns, monkeypatch, True, **{"00_business_name": given})
    assert captured["inspire"][0]["business"] == "Acme"


@pytest.mark.parametrize("given", ["", "   ", "\t\n"])
def test_a_blank_business_name_never_starts_a_run(agent_ns, monkeypatch, given):
    with pytest.raises(NotebookExit) as exc:
        run_main(agent_ns, monkeypatch, True, **{"00_business_name": given})
    assert "'Business Name' (00_business_name) is REQUIRED" in str(exc.value)


def test_the_session_row_takes_the_business_name_from_the_widget_even_when_migration_columns_are_missing(agent_ns, tmp_path, monkeypatch):
    def refuse_migration(statement):
        if statement.startswith("ALTER TABLE"):
            raise RuntimeError("PERMISSION_DENIED: MODIFY on __inspire_session")
        return []
    spark = FakeSpark(responder=refuse_migration)
    writer = _atomic_writer(agent_ns, spark, tmp_path, monkeypatch, operation="Discover Use Cases", business="Acme")
    try:
        writer.initialize_session()
    finally:
        writer._session_writer.stop(drain_timeout=5.0)
    assert "discovery_type" in writer._session_missing_columns, "the migration really failed"
    merge = [s for s in _session_writes(spark) if s.startswith("MERGE INTO")]
    assert len(merge) == 1 and "'Acme' AS business_name" in merge[0]
    assert "AS discovery_type" not in merge[0]


def test_business_name_is_never_a_migration_column_and_the_merge_is_the_only_row_insert():
    src = _agentload.agent_source()
    migrate = ast.get_source_segment(src, _agentload.method_node("AtomicWriter", "_migrate_session_table_schema"))
    assert '"business_name"' not in migrate
    columns = ast.get_source_segment(src, _agentload.method_node("AtomicWriter", "_widget_to_columns_map"))
    assert '"business_name": str(wv.get("business", "") or "")' in columns
    assert src.count("MERGE INTO {self.session_table}") == 1
    assert "INSERT INTO {self.session_table}" not in src
