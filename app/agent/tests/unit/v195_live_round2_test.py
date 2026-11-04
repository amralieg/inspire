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


def _signal_stub(inst, failing):
    inst.discovery_type = "Deep"
    inst.deep_evidence = type("Deep", (), {"signal_spent_seconds": 0.0, "summary": lambda self: {}})()
    inst._load_elite_evidence = lambda use_cases: {}
    inst.asked = []

    def ask(batch, _schema, skip_cache, evidence=None):
        inst.asked += [uc["No"] for uc in batch]
        return {uc["No"]: {"No": uc["No"]} for uc in batch}
    inst._ask_signal_roles = ask
    inst._signal_spec = lambda uc, item, evidence: ({"No": uc["No"]}, "")
    inst._signal_record = lambda deep, spec, reason, profiles: (
        {"status": "failed", "check": "lever", "reason": f"{spec['No']} does not move"} if spec["No"] in failing
        else {"status": "passed", "check": "lever", "reason": "it moves"})
    return inst


def test_the_trim_fills_the_target_with_use_cases_the_data_backs(agent_ns):
    inst = _fake_bob(_inspire(agent_ns, {"count": 93, "mode": "exactly"}))
    ucs = _ucs(100, themes=40)
    failing = {ucs[i]["No"] for i in (0, 5, 17, 40, 66, 90)}
    _signal_stub(inst, failing)
    out = inst._apply_best_of_best_selection(ucs, [], {})
    assert len(out) == 93, "6 of the first 93 fail the data signal check, so the next 6 survivors take their places"
    assert not {uc["No"] for uc in out} & failing
    assert all(uc["data_signal"]["status"] == "passed" for uc in out)
    assert sorted(inst.asked) == sorted({uc["No"] for uc in ucs[:99]}), "each use case is asked about once"
    dropped = [uc for uc in ucs if uc["No"] in failing]
    assert all(uc["selection_drop_reason"].startswith("the data shows no signal: ") for uc in dropped)
    assert _funnel(inst, "stratified_trim")["out"] == 93


def test_the_check_after_selection_does_not_ask_again_for_checked_use_cases(agent_ns):
    inst = _fake_bob(_inspire(agent_ns, {"count": 93, "mode": "exactly"}))
    ucs = _ucs(100, themes=40)
    _signal_stub(inst, {ucs[3]["No"]})
    out = inst._apply_best_of_best_selection(ucs, [], {})
    asked = list(inst.asked)
    kept, dropped = inst._check_data_signal(out, [])
    assert inst.asked == asked and len(kept) == 93 and dropped == []


def test_a_use_case_the_user_asked_for_is_not_dropped_by_the_check_before_the_trim(agent_ns):
    requests = [{"id": "R1", "ask": "price elasticity use cases", "minimum": 1}]
    inst = _fake_bob(_inspire(agent_ns, {"count": 93, "mode": "exactly"}, requests))
    ucs = _ucs(100, themes=40)
    ucs[95]["user_request"] = "R1"
    _signal_stub(inst, {ucs[95]["No"], ucs[2]["No"]})
    out = inst._apply_best_of_best_selection(ucs, [], {})
    assert ucs[95] in out and ucs[95]["data_signal"]["status"] == "no_signal"
    assert ucs[2] not in out and len(out) == 93


def test_a_dropped_use_case_picked_again_for_a_domain_is_judged_on_its_first_record(agent_ns):
    inst = _fake_bob(_inspire(agent_ns, domains=["Legal"]))
    ucs = _ucs(20)
    ucs[4]["Business Domain"] = "Legal"
    _signal_stub(inst, {ucs[4]["No"]})
    kept, dropped = inst._check_data_signal(ucs, [])
    assert ucs[4] in kept and ucs[4]["data_signal"]["status"] == "no_signal", "the only Legal use case is kept"
    asked = list(inst.asked)
    inst.user_business_domains = []
    ucs[4]["data_signal"] = {"status": "failed", "check": "lever", "reason": "U004 does not move"}
    kept, dropped = inst._check_data_signal(ucs, [])
    assert inst.asked == asked and dropped == [ucs[4]]


def test_a_failed_check_after_selection_keeps_the_earlier_records(agent_ns):
    inst = _fake_bob(_inspire(agent_ns, {"count": 93, "mode": "exactly"}))
    ucs = _ucs(100, themes=40)
    _signal_stub(inst, set())
    out = inst._apply_best_of_best_selection(ucs, [], {})
    extra = _ucs(101)[100]

    def broken(*_a, **_kw):
        raise RuntimeError("the endpoint is down")
    inst._ask_signal_roles = broken
    inst._signal_record = broken
    kept, dropped = inst._check_data_signal(out + [extra], [])
    assert len(kept) == 94 and dropped == []
    assert all(uc["data_signal"]["status"] == "passed" for uc in out) and "data_signal" not in extra


def _flaky_signal_roles(inst, failures):
    calls = []

    def ask(batch, _schema, skip_cache, evidence=None):
        calls.append(skip_cache)
        if len(calls) <= failures:
            raise RuntimeError("the endpoint is down")
        return {uc["No"]: {"No": uc["No"]} for uc in batch}
    inst._ask_signal_roles = ask
    return calls


def _errors(inst):
    return [line for level, line in inst.logger.records if level == "ERROR"]


def test_a_signal_check_call_that_fails_then_succeeds_on_retry_logs_no_error(agent_ns):
    inst = _fake_bob(_inspire(agent_ns))
    _signal_stub(inst, set())
    calls = _flaky_signal_roles(inst, failures=1)
    kept, dropped = inst._check_data_signal(_ucs(4), [])
    assert calls == [False, True] and len(kept) == 4 and dropped == []
    assert [line for level, line in inst.logger.records if level == "WARNING" and "Signal_Check call" in line]
    assert _errors(inst) == []


def test_a_signal_check_call_that_fails_every_attempt_logs_exactly_one_error_naming_the_call(agent_ns):
    inst = _fake_bob(_inspire(agent_ns))
    _signal_stub(inst, set())
    calls = _flaky_signal_roles(inst, failures=99)
    inst._check_data_signal(_ucs(4), [])
    errors = _errors(inst)
    assert calls == [False, True] and len(errors) == 1, errors
    assert "Signal_Check call" in errors[0] and "the endpoint is down" in errors[0] and "attempt 2 of 2" in errors[0]


def test_too_few_backed_candidates_leave_the_count_short_and_the_log_says_why(agent_ns):
    inst = _fake_bob(_inspire(agent_ns, {"count": 93, "mode": "exactly"}, use_cases_quality="Good"))
    inst.quality_filter_acceptable = {"High", "Very High"}
    ucs = _ucs(100, themes=40)
    failing = {ucs[i]["No"] for i in range(0, 100, 10)}
    _signal_stub(inst, failing)
    selected, rejected = inst._select_scored_use_cases(ucs, [], {})
    assert len(selected) == 90 and not {uc["No"] for uc in selected} & failing
    assert {uc["No"] for uc in rejected} == failing
    assert inst.logger.matching("[SIGNAL-BEFORE-TRIM FIRED] 10 use cases the data does not back")
    short = inst.logger.matching("[USE-CASE-COUNT FIRED]", "WARNING")
    assert short and "10 use cases left because the data shows no signal" in short[-1][1] and "never pads" in short[-1][1]


def test_ultra_high_cuts_to_the_count_only_after_the_data_signal_check(agent_ns):
    inst = _inspire(agent_ns, {"count": 4, "mode": "exactly"}, use_cases_quality="Ultra High")
    ucs = _ucs(10, domains=("Sales",))
    inst._select_elite_use_cases = lambda candidates, *_a: (list(candidates), list(candidates))
    _signal_stub(inst, {"U001", "U002"})
    selected, rejected = inst._select_scored_use_cases(ucs, [], {})
    assert [uc["No"] for uc in selected] == ["U000", "U003", "U004", "U005"]
    assert {"U001", "U002"} <= {uc["No"] for uc in rejected}


def test_a_use_case_kept_only_for_its_domain_drops_once_a_backed_one_of_that_domain_joins(agent_ns):
    inst = _fake_bob(_inspire(agent_ns, domains=["Legal"]))
    ucs = _ucs(20)
    ucs[4]["Business Domain"] = ucs[9]["Business Domain"] = "Legal"
    _signal_stub(inst, {ucs[4]["No"]})
    kept, dropped = inst._check_data_signal(ucs[:5], [])
    assert ucs[4] in kept and ucs[4]["data_signal"]["status"] == "no_signal"
    kept, dropped = inst._check_data_signal(ucs[:10], [])
    assert dropped == [ucs[4]] and ucs[4]["data_signal"] == {"status": "failed", "check": "lever", "reason": "U004 does not move"}
    assert ucs[4]["selection_drop_reason"] == "the data shows no signal: U004 does not move"
    kept, dropped = inst._check_data_signal(ucs[:4] + [ucs[4]], [])
    assert kept == ucs[:5] and ucs[4]["data_signal"]["status"] == "no_signal" and "selection_drop_reason" not in ucs[4]
