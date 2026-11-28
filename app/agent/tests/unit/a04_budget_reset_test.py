"""a04_budget_reset (REQ-585 item 2, R11.2 follow-up; T-BUDGET-01): per-run outcome state is reset at the start of run().

Defect class: DatabricksInspire.run() stamps _run_started_at but never clears the outcome attributes that
_run_outcome_warnings() / _merge_run_outcome_into_results() read (budget_partial, failed_steps, translation_gaps), so a
second run() on the same instance reports the first run's partial label, failed steps and translation gaps.

The tests drive the real run() through the offline smoke harness (v120_run_offline_smoke_test._build): run 1 hits the
time budget through the real Pass 1 skip path and then records a failed step and a translation gap; run 2 on the same
instance has no budget hit and must carry none of them. Guards: a failure recorded during a run still reaches that run's
results, and a budget hit in the current run is still labelled partial.
"""
import logging
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from v120_run_offline_smoke_test import _build  # noqa: E402

ACCEPT_ALL = {"Low", "Medium", "High", "Very High", "Ultra High"}


def _scorer(uc_id):
    return {"use_case_id": uc_id, "quality_label": "High", "quality_score": 4.0, "priority_score": 7.0,
            "quality_summary": "Columns `id` and `amount` aggregated by store give the KPI that drives the outcome."}


@pytest.fixture
def quiet_root_logger():
    root = logging.getLogger()
    saved = (list(root.handlers), root.level)
    yield
    root.handlers[:] = saved[0]
    root.setLevel(saved[1])


@pytest.fixture
def budget(agent_ns):
    runtime = agent_ns["TECHNICAL_CONTEXT"]["runtime"]
    saved = runtime.get("discover_time_budget_minutes")
    yield runtime
    runtime["discover_time_budget_minutes"] = saved if saved is not None else 0


def _reload(obj):
    """Give the instance fresh input batches, as a second run() on the same object would read them."""
    obj.data_loader._batches = [list(obj.data_loader._batches_seed)]
    obj.final_inspire_results_json = {}


def _first_run_hits_budget(agent_ns, tmp_path, budget):
    obj = _build(agent_ns, tmp_path, "Good", ACCEPT_ALL, _scorer)
    obj.data_loader._batches_seed = list(obj.data_loader._batches[0])
    budget["discover_time_budget_minutes"] = 30
    obj._discover_budget_spent = lambda: True
    try:
        obj.run()
    except Exception:
        pass  # a run whose every batch was skipped may end early; only its outcome state matters here
    assert obj.budget_partial, "precondition: run 1 must hit the budget through the real Pass 1 skip path"
    obj._record_failed_step("CSV catalog", "English", "disk full in run 1")
    obj._record_translation_gaps("Run1Lang", {"use_cases": 2, "untranslated_use_cases": ["X-1"]})
    del obj._discover_budget_spent
    budget["discover_time_budget_minutes"] = 0
    _reload(obj)
    return obj


def test_1_second_run_has_no_partial_label_from_the_first(agent_ns, tmp_path, budget, quiet_root_logger):
    obj = _first_run_hits_budget(agent_ns, tmp_path, budget)
    obj.run()
    assert not obj.budget_partial, f"run 2 kept run 1's budget_partial: {obj.budget_partial}"
    results = obj._merge_run_outcome_into_results()
    assert "run_partial" not in results, results.get("run_partial_reason")
    assert not [w for w in obj._run_outcome_warnings() if "time budget" in w.lower()]


def test_2_second_run_drops_first_run_failed_steps(agent_ns, tmp_path, budget, quiet_root_logger):
    obj = _first_run_hits_budget(agent_ns, tmp_path, budget)
    obj.run()
    stale = [f for f in (getattr(obj, "failed_steps", None) or []) if "run 1" in f.get("error", "")]
    assert not stale, f"run 2 still reports run 1's failed steps: {stale}"
    assert not [f for f in obj.final_inspire_results_json.get("failed_steps") or [] if "run 1" in f.get("error", "")]


def test_3_second_run_drops_first_run_translation_gaps(agent_ns, tmp_path, budget, quiet_root_logger):
    obj = _first_run_hits_budget(agent_ns, tmp_path, budget)
    obj.run()
    assert "Run1Lang" not in (getattr(obj, "translation_gaps", None) or {}), obj.translation_gaps
    assert "Run1Lang" not in (obj.final_inspire_results_json.get("translation_gaps") or {})


def test_4_guard_failure_recorded_during_the_run_is_kept(agent_ns, tmp_path, budget, quiet_root_logger):
    obj = _build(agent_ns, tmp_path, "Good", ACCEPT_ALL, _scorer)
    budget["discover_time_budget_minutes"] = 0

    def failing_csv(lang, abbr, grouped):
        obj._record_failed_step("CSV catalog", lang, "disk full in this run")

    obj._generate_csv_catalog = failing_csv
    obj.run()
    assert [f for f in obj.failed_steps if f["error"] == "disk full in this run"]
    assert [f for f in obj.final_inspire_results_json["failed_steps"] if f["error"] == "disk full in this run"]


def test_5_guard_budget_hit_in_the_current_run_is_still_partial(agent_ns, tmp_path, budget, quiet_root_logger):
    obj = _build(agent_ns, tmp_path, "Good", ACCEPT_ALL, _scorer)
    budget["discover_time_budget_minutes"] = 30
    obj._discover_budget_spent = lambda: True
    try:
        obj.run()
    except Exception:
        pass
    assert obj.budget_partial and obj.budget_partial["skipped_batches"] >= 1
    results = obj._merge_run_outcome_into_results()
    assert results["run_partial"] is True and results["run_status"] != "success"
