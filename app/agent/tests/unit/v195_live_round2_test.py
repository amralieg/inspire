"""v1.9.5 live round 2: the Deep evidence reads move the percent while they run, a declared batch
stage lands the rows queued before it ahead of its LLM calls, the judge spread is recorded before
the trim, and the data signal check runs before the trim so the trim fills the target."""
import os
import sys
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v120_artifacts_support import FakeSpark, make_inspire  # noqa: E402
from v130_evidence_test import _deep_responder, _loader  # noqa: E402
from v190_progress_and_recovery_test import _ViewSpark, _plan, _session_percent, _stop, _writer  # noqa: E402
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


def _ready_writer(agent_ns, spark, tmp_path, monkeypatch):
    writer = _writer(agent_ns, spark, tmp_path, monkeypatch, operation="Discover Use Cases")
    _plan(writer)
    writer._session_ready = True
    writer._get_session_processing_status = lambda: "ready"
    return writer


def test_a_declared_fan_out_lands_the_rows_and_percent_recorded_before_it(agent_ns, tmp_path, monkeypatch):
    spark = _ViewSpark()
    writer = _ready_writer(agent_ns, spark, tmp_path, monkeypatch)
    try:
        writer._flush_interval_seconds = 1.0
        writer._last_flush_attempt_epoch = time.time()
        for stage in ("Setup", "Business Understanding", "Data Preparation"):
            writer.emit_step(stage_name=stage, step_name=f"{stage} done", status="ended_success")
        inst = make_inspire(agent_ns, atomic_writer=writer)
        inst._plan_progress_batches("Pass1Batch", 8)
        landed = [s for s in spark.statements if "__inspire_step" in s and ("INSERT INTO" in s or "MERGE INTO" in s)]
        percent = _session_percent(spark)
    finally:
        _stop(writer)
    assert landed, "the step rows recorded before the fan-out are written before its LLM calls start"
    assert percent > 0, "the session percent recorded before the fan-out is written before its LLM calls start"
    assert writer.logger.matching("[PROGRESS-SETTLE FIRED]")


def test_a_fan_out_with_nothing_pending_starts_at_once(agent_ns, tmp_path, monkeypatch):
    spark = _ViewSpark()
    writer = _ready_writer(agent_ns, spark, tmp_path, monkeypatch)
    try:
        inst = make_inspire(agent_ns, atomic_writer=writer)
        began = time.time()
        inst._plan_progress_batches("Pass1Batch", 8)
        assert time.time() - began < 0.5
        assert not [s for s in spark.statements if "__inspire_step" in s and ("INSERT INTO" in s or "MERGE INTO" in s)]
    finally:
        _stop(writer)


def test_a_write_that_cannot_land_holds_the_fan_out_only_up_to_the_limit(agent_ns, tmp_path, monkeypatch):
    spark = _ViewSpark()
    writer = _ready_writer(agent_ns, spark, tmp_path, monkeypatch)
    try:
        writer._get_session_processing_status = lambda: None
        writer.emit_step(stage_name="Setup", step_name="Setup done", status="ended_success")
        began = time.time()
        assert writer.settle("Pass1Batch", timeout=0.4) is False
        assert time.time() - began < 1.5
        assert writer.logger.matching("[PROGRESS-SETTLE]")
    finally:
        _stop(writer)


def test_a_zero_batch_declaration_does_not_wait(agent_ns, tmp_path, monkeypatch):
    spark = _ViewSpark()
    writer = _ready_writer(agent_ns, spark, tmp_path, monkeypatch)
    try:
        writer._get_session_processing_status = lambda: None
        writer.emit_step(stage_name="Setup", step_name="Setup done", status="ended_success")
        inst = make_inspire(agent_ns, atomic_writer=writer)
        began = time.time()
        inst._plan_progress_batches("Pass2Batch", 0)
        assert time.time() - began < 0.5
    finally:
        _stop(writer)


def _funnel(inst, stage):
    return [entry for entry in inst.funnel_ledger if entry["stage"] == stage][-1]


def _spread_bob(inst, scores):
    def score(use_cases, _schema, **_kw):
        for uc, value in zip(use_cases, scores):
            uc.update(bob_status="scored", bob_score=value, bob_hard_veto_gate=None, idea_theme=uc["theme_seed"])
        return use_cases
    inst._score_best_of_best = score
    return inst


def test_the_judge_spread_is_recorded_before_and_after_the_trim(agent_ns):
    inst = _spread_bob(_inspire(agent_ns), [round(9.6 - i * 0.03, 3) for i in range(158)])
    out = inst._apply_best_of_best_selection(_ucs(158, themes=36), [], {})
    before = _funnel(inst, "bob_hard_veto")["bob_spread"]
    after = _funnel(inst, "stratified_trim")["bob_spread"]
    assert before["n"] == 158 and after["n"] == len(out) < 158
    assert before["sd"] > after["sd"] > 0, "the trim keeps the top, so the kept spread is narrower"
    assert before["min"] < after["min"] and before["max"] == after["max"] == 9.6
    line = inst.logger.matching("[BOB-SPREAD FIRED]")
    assert line and f"sd={before['sd']}" in line[-1][1] and f"sd={after['sd']}" in line[-1][1]


def test_the_judge_spread_is_recorded_when_nothing_is_trimmed(agent_ns):
    inst = _spread_bob(_inspire(agent_ns), [8.0, 7.0, 6.0, 9.0] * 10)
    out = inst._apply_best_of_best_selection(_ucs(40), [], {})
    assert len(out) == 40
    spread = _funnel(inst, "bob_hard_veto")["bob_spread"]
    assert spread == {"n": 40, "sd": 1.132, "min": 6.0, "max": 9.0}
    assert not [entry for entry in inst.funnel_ledger if entry["stage"] == "stratified_trim"]


def test_the_judge_spread_of_identical_scores_is_zero_and_of_none_is_empty(agent_ns):
    spread = agent_ns["DatabricksInspire"]._bob_spread
    assert spread([{"bob_score": 7.5}] * 3) == {"n": 3, "sd": 0.0, "min": 7.5, "max": 7.5}
    assert spread([{"bob_score": 7.5}]) == {"n": 1, "sd": 0.0, "min": 7.5, "max": 7.5}
    assert spread([{"bob_score": None}, {"bob_score": "x"}, {"bob_score": True}, {}]) == \
        {"n": 0, "sd": None, "min": None, "max": None}
    assert spread([{"bob_score": "8.25"}, {"bob_score": 6.25}])["sd"] == pytest.approx(1.414, abs=0.001)
