"""v1.3.1 CONCURRENT MIGRATION: two runs on one Inspire database migrate its shared tables at once.

Live run 2026-11-03 (two Discover runs started together on one database): both added table_joins to
__inspire_usecases in the same second, the second ALTER failed with DELTA_METADATA_CHANGED, and that
run wrote all its use cases without table_joins although the column was there. Every table the agent
migrates goes through AtomicWriter.add_missing_columns, which re-reads the columns after a failed
ALTER, keeps a column another run added, tries a concurrent-update conflict again and reports only a
column that is still missing.
"""
import ast
import re
import time

import pytest

import _agentload
from v120_artifacts_support import FakeSpark
from v120_artifacts_tracking_test import _tracking_obj
from v130_ailogs_test import _writer

CONFLICT = ("[DELTA_METADATA_CHANGED] MetadataChangedException: The metadata of the Delta table has been changed by a "
            "concurrent update. Please try the operation again.")


class Table:
    """A shared table: `other_run_adds` is True when the concurrent run's ALTER adds the column itself."""

    def __init__(self, columns, column, errors, other_run_adds):
        self.columns = set(columns)
        self.column = column
        self.errors = list(errors)
        self.other_run_adds = other_run_adds
        self.alters = []

    def __call__(self, statement):
        if statement.startswith("DESCRIBE TABLE"):
            return [{"col_name": c} for c in sorted(self.columns)]
        match = re.search(r"ADD COLUMN `?(\w+)`? ", statement)
        if match:
            name = match.group(1)
            self.alters.append(name)
            if name == self.column and self.errors:
                if self.other_run_adds:
                    self.columns.add(name)
                raise RuntimeError(self.errors.pop(0))
            self.columns.add(name)
        return []


@pytest.fixture
def sleeps(monkeypatch):
    waited = []
    monkeypatch.setattr(time, "sleep", waited.append)
    return waited


def _tracking(agent_ns, table):
    return _tracking_obj(agent_ns, FakeSpark(responder=table))


def _all_but(agent_ns, column):
    return ["session_id", "id"] + [c for c, _ in agent_ns["DatabricksInspire"]._TRACKING_MIGRATION_COLUMNS if c != column]


def test_a_column_another_run_added_is_kept_and_the_rows_carry_it(agent_ns, sleeps):
    table = Table(_all_but(agent_ns, "table_joins"), "table_joins", [CONFLICT], other_run_adds=True)
    obj = _tracking(agent_ns, table)
    obj._tracking_table_created = False
    obj._create_tracking_table()
    assert obj._tracking_table_created is True
    assert getattr(obj, "failed_steps", []) == [], "a column the other run added is no failure"
    assert "table_joins" in obj._tracking_table_columns, "the session's rows are written with table_joins"
    assert not obj.logger.matching("could not be fully migrated", level="ERROR")
    assert table.alters == ["table_joins"] and sleeps == []


def test_a_concurrent_conflict_is_tried_again_until_the_column_is_added(agent_ns, sleeps):
    table = Table(_all_but(agent_ns, "table_joins"), "table_joins", [CONFLICT], other_run_adds=False)
    obj = _tracking(agent_ns, table)
    assert obj._migrate_tracking_table_schema() == ["table_joins"]
    assert table.alters == ["table_joins", "table_joins"] and sleeps == [0.5]
    assert "table_joins" in obj._tracking_table_columns


def test_a_conflict_that_never_clears_is_reported_after_three_tries(agent_ns, sleeps):
    table = Table(_all_but(agent_ns, "table_joins"), "table_joins", [CONFLICT] * 5, other_run_adds=False)
    obj = _tracking(agent_ns, table)
    with pytest.raises(RuntimeError, match="1 column: \\['table_joins: \\[DELTA_METADATA_CHANGED\\]"):
        obj._migrate_tracking_table_schema()
    assert table.alters == ["table_joins"] * 3 and sleeps == [0.5, 1.0]
    assert "table_joins" not in obj._tracking_table_columns, "a column that is not there is never written"


def test_a_refused_alter_is_reported_at_once_and_never_tried_again(agent_ns, sleeps):
    table = Table(_all_but(agent_ns, "table_joins"), "table_joins", ["PERMISSION_DENIED: MODIFY on table"] * 3,
                  other_run_adds=False)
    obj = _tracking(agent_ns, table)
    with pytest.raises(RuntimeError, match="table_joins: PERMISSION_DENIED"):
        obj._migrate_tracking_table_schema()
    assert table.alters == ["table_joins"] and sleeps == []
    assert "table_joins" not in obj._tracking_table_columns


def test_the_session_table_keeps_a_column_another_run_added(agent_ns, tmp_path, monkeypatch, sleeps):
    table = Table(["session_id", "enriched_business_context"], "discovery_type", [CONFLICT], other_run_adds=True)
    writer = _writer(agent_ns, FakeSpark(responder=table), tmp_path, monkeypatch)
    writer._migrate_session_table_schema()
    assert "discovery_type" in table.columns and table.alters.count("discovery_type") == 1
    assert writer._session_missing_columns == set()


def test_the_session_table_still_reports_a_refused_column(agent_ns, tmp_path, monkeypatch, sleeps):
    table = Table(["session_id"], "discovery_type", ["PERMISSION_DENIED: MODIFY"], other_run_adds=False)
    writer = _writer(agent_ns, FakeSpark(responder=table), tmp_path, monkeypatch)
    writer._migrate_session_table_schema()
    assert writer._session_missing_columns == {"discovery_type"}


def test_the_step_table_keeps_an_event_id_another_run_added(agent_ns, tmp_path, monkeypatch, sleeps):
    table = Table(["session_id", "step_id"], "event_id", [CONFLICT], other_run_adds=True)
    writer = _writer(agent_ns, FakeSpark(responder=table), tmp_path, monkeypatch)
    assert writer._ensure_steps_event_id() is True
    assert table.alters == ["event_id"]


def test_the_step_table_without_event_id_says_so(agent_ns, tmp_path, monkeypatch, sleeps):
    table = Table(["session_id", "step_id"], "event_id", ["PERMISSION_DENIED: MODIFY"], other_run_adds=False)
    writer = _writer(agent_ns, FakeSpark(responder=table), tmp_path, monkeypatch)
    assert writer._ensure_steps_event_id() is False
    assert writer.logger.matching("Step table has no event_id column (PERMISSION_DENIED", level="WARNING")


def test_the_implement_table_keeps_a_column_another_run_added(agent_ns, tmp_path, monkeypatch, sleeps):
    names = [n for n, _k in agent_ns["IMPLEMENT_COLUMNS"] if n != "asset_snapshots"]
    table = Table(names, "asset_snapshots", [CONFLICT], other_run_adds=True)
    spark = FakeSpark(responder=table)
    writer = _writer(agent_ns, spark, tmp_path, monkeypatch)
    writer._ensure_implement_table()
    assert table.alters == ["asset_snapshots"]
    assert [s for s in spark.statements if " ADD COLUMN " in s] == [
        f"ALTER TABLE {writer.implement_table} ADD COLUMN `asset_snapshots` STRING"]


def test_the_implement_table_raises_on_a_refused_column(agent_ns, tmp_path, monkeypatch, sleeps):
    names = [n for n, _k in agent_ns["IMPLEMENT_COLUMNS"] if n != "asset_snapshots"]
    table = Table(names, "asset_snapshots", ["PERMISSION_DENIED: MODIFY"], other_run_adds=False)
    writer = _writer(agent_ns, FakeSpark(responder=table), tmp_path, monkeypatch)
    with pytest.raises(RuntimeError, match="asset_snapshots: PERMISSION_DENIED"):
        writer._ensure_implement_table()


@pytest.mark.parametrize("table", ["`samples`.`tpcds_sf1`.`store_sales`", "main.sales.orders", "`c`.`s`.inspire_usecases"])
def test_a_table_inspire_does_not_own_is_never_altered(agent_ns, table):
    spark = FakeSpark(responder=Table(["id"], "x", [], other_run_adds=False))
    with pytest.raises(ValueError, match="only adds columns to its own tables"):
        agent_ns["AtomicWriter"].add_missing_columns(spark, table, [("x", "STRING")])
    assert spark.statements == []


def test_every_shared_table_migration_goes_through_the_one_helper():
    src = _agentload.agent_source()
    alters = [line.strip() for line in src.splitlines() if "ADD COLUMN " in line and "spark.sql" in line]
    assert alters == ['spark.sql(f"ALTER TABLE {owned_table} ADD COLUMN {column} {kind}")'], alters
    for cls, method in (("AtomicWriter", "_migrate_session_table_schema"), ("AtomicWriter", "_ensure_steps_event_id"),
                        ("AtomicWriter", "_ensure_implement_table"), ("DatabricksInspire", "_migrate_tracking_table_schema")):
        body = ast.get_source_segment(src, _agentload.method_node(cls, method))
        assert "add_missing_columns(" in body, (cls, method)
