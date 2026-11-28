"""c43_budget (REQ-585 item 2, R11.2): a Discover run that hits its time budget is labelled partial, never complete.

TECHNICAL_CONTEXT.runtime.discover_time_budget_minutes (default 0 = no budget, today's behaviour). run() stamps
self._run_started_at = time.time() at its start. DatabricksInspire._discover_budget_spent() -> bool is True only when the budget
is > 0 and the elapsed minutes reach it. Each Pass 1 batch worker checks it before calling _process_batch_with_retry; a batch it
skips returns no use cases and is counted in self.budget_partial = {"budget_minutes", "skipped_batches", "total_batches"}.
With budget_partial set: _run_outcome_warnings() names the budget and "<skipped> of <total>" batches, and
_merge_run_outcome_into_results() sets results["run_partial"] = True, results["run_partial_reason"] (same text) and run_status is
never "success". Without it there is no run_partial key."""
import ast
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from v120_funnel_integrity_test import method_node  # noqa: E402
from v120_metadata_evidence_test import make_inspire  # noqa: E402


def set_budget(ns, minutes):
    ns["TECHNICAL_CONTEXT"]["runtime"]["discover_time_budget_minutes"] = minutes


def test_1_default_budget_is_off(agent_ns, fresh_ns):
    assert fresh_ns["TECHNICAL_CONTEXT"]["runtime"]["discover_time_budget_minutes"] == 0


def test_2_budget_spent_only_when_set_and_reached(agent_ns):
    saved = agent_ns["TECHNICAL_CONTEXT"]["runtime"].get("discover_time_budget_minutes")
    try:
        obj = make_inspire(agent_ns)
        obj._run_started_at = time.time() - 10_000
        set_budget(agent_ns, 0)
        assert obj._discover_budget_spent() is False
        set_budget(agent_ns, 1)
        assert obj._discover_budget_spent() is True
        obj._run_started_at = time.time() - 50
        assert obj._discover_budget_spent() is False
    finally:
        set_budget(agent_ns, saved if saved is not None else 0)


def test_3_run_stamps_its_start_and_pass1_checks_the_budget_before_each_batch():
    run = method_node("DatabricksInspire", "run")
    stamps = [n for n in ast.walk(run) if isinstance(n, ast.Assign) and any(ast.unparse(t) == "self._run_started_at" for t in n.targets)]
    assert stamps, "run() must stamp self._run_started_at"
    worker = next(n for n in ast.walk(run) if isinstance(n, ast.FunctionDef) and n.name == "_pass1_worker")
    calls = [n for n in ast.walk(worker) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)]
    check = [n.lineno for n in calls if n.func.attr == "_discover_budget_spent"]
    gen = [n.lineno for n in calls if n.func.attr == "_process_batch_with_retry"]
    assert check and gen and min(check) < min(gen)
    assert "budget_partial" in ast.unparse(worker)


def test_4_partial_run_is_labelled_and_warned(agent_ns):
    obj = make_inspire(agent_ns)
    obj.budget_partial = {"budget_minutes": 30, "skipped_batches": 3, "total_batches": 10}
    warnings = obj._run_outcome_warnings()
    hit = [w for w in warnings if "time budget" in w.lower()]
    assert hit and "30" in hit[0] and "3 of 10" in hit[0]
    results = obj._merge_run_outcome_into_results()
    assert results["run_partial"] is True and "3 of 10" in results["run_partial_reason"]
    assert results["run_status"] != "success"


def test_5_no_budget_hit_means_no_partial_label(agent_ns):
    obj = make_inspire(agent_ns)
    results = obj._merge_run_outcome_into_results()
    assert "run_partial" not in results
    assert not [w for w in obj._run_outcome_warnings() if "time budget" in w.lower()]
