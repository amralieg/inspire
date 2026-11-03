"""v1.9.5 live round 2: the Deep evidence reads move the percent while they run, a declared batch
stage lands the rows queued before it ahead of its LLM calls, the judge spread is recorded before
the trim, and the data signal check runs before the trim so the trim fills the target."""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v120_artifacts_support import FakeSpark, make_inspire  # noqa: E402
from v130_evidence_test import _deep_responder, _loader  # noqa: E402
from v190_progress_and_recovery_test import _ViewSpark, _plan, _stop, _writer  # noqa: E402
from v180_user_count_test import _fake_bob, _inspire, _ucs  # noqa: E402


def _details(n_tables):
    rows = []
    for i in range(n_tables):
        rows += [("main", "s", f"t{i}", "id", "bigint"), ("main", "s", f"t{i}", "amount", "double")]
    return rows


def _evidence_inspire(agent_ns, writer):
    spark = FakeSpark(responder=_deep_responder)
    return make_inspire(agent_ns, spark=spark, discovery_type="Deep", data_loader=_loader(), atomic_writer=writer)


def test_the_deep_evidence_reads_move_the_percent_while_they_run(agent_ns, tmp_path, monkeypatch):
    writer = _writer(agent_ns, _ViewSpark(), tmp_path, monkeypatch, operation="Discover Use Cases")
    try:
        _plan(writer)
        for stage, count in (("Setup", 3), ("Business Understanding", 3)):
            for i in range(count):
                writer.emit_step(stage_name=stage, step_name=f"{stage} {i}", status="ended_success")
        writer.emit_step(stage_name="Data Preparation", step_name="Selecting Business Tables", status="started")
        inst = _evidence_inspire(agent_ns, writer)
        seen = []
        emit = writer.emit_step

        def recording(**kw):
            step_id = emit(**kw)
            if kw.get("stage_name") == "Data Preparation":
                seen.append(writer.progress_plan._shown())
            return step_id
        writer.emit_step = recording
        start = writer.progress_plan._shown()
        inst._collect_discovery_evidence(_details(9))
    finally:
        _stop(writer)
    assert len(seen) >= 4, f"{len(seen)} progress rows for 9 profiled tables and the query history"
    assert all(later > earlier for earlier, later in zip([start] + seen, seen)), seen
    assert writer.progress_plan.fraction("tables") < 1.0, "the step that runs the reads is still open"


def test_standard_discovery_declares_no_evidence_reads(agent_ns, tmp_path, monkeypatch):
    writer = _writer(agent_ns, _ViewSpark(), tmp_path, monkeypatch, operation="Discover Use Cases")
    try:
        _plan(writer)
        units = writer.progress_plan.phases["tables"][0]
        inst = make_inspire(agent_ns, spark=FakeSpark(responder=lambda _s: []), discovery_type="Standard",
                            data_loader=_loader(), atomic_writer=writer)
        inst._collect_discovery_evidence(_details(9))
        assert writer.progress_plan.phases["tables"][0] == units
    finally:
        _stop(writer)
