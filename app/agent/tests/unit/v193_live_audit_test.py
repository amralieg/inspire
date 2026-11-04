"""v1.9.3 live-audit fixes.

1. Inspire runs on serverless environment 4 only: on any other serverless environment main() stops
   before the launch gate with one plain message, instead of failing 12 minutes later on a missing
   module the environment-4 assets rely on.
2. The stratified trim records why each use case was left out: the trim target, the theme cap or a
   hard veto, and the funnel counts the same codes.
3. Progress inside generation, subdomain detection and prioritization moves with each batch: every
   batch stage declares its batch count, and a new declaration rebases the percent so it never stalls.
4. The straggler budget is taken from round-0 batches only, counts unfinished ones as slower than
   every finished one and never falls inside the spread of the batches that finished.
"""
import os
import re
import sys
import threading
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import agent_source  # noqa: E402
from v120_artifacts_support import make_inspire  # noqa: E402
from v190_progress_and_recovery_test import _ViewSpark, _plan, _stop, _writer  # noqa: E402
from v121_retry_and_dedup_test import scorer, ucs_n, wait_or_cancel  # noqa: E402
from v180_user_count_test import _fake_bob, _inspire, _ucs  # noqa: E402

AGENT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
JOB_PARAMS = os.path.join(os.path.dirname(AGENT), "backend", "lib", "inspireJobParams.js")


@pytest.mark.parametrize("environ,version", [
    ({"DATABRICKS_RUNTIME_VERSION": "client.2.5", "IS_SERVERLESS": "TRUE"}, "2"),
    ({"DATABRICKS_RUNTIME_VERSION": "client.3.6", "IS_SERVERLESS": "TRUE"}, "3"),
    ({"DATABRICKS_RUNTIME_VERSION": "client.5.1"}, "5"),
    ({"DATABRICKS_ENV_VERSION": "3"}, "3"),
])
def test_another_serverless_environment_is_named_with_the_one_inspire_runs_on(agent_ns, environ, version):
    problem = agent_ns["inspire_environment_problem"](environ)
    supported = agent_ns["GENIE_NOTEBOOK_ENV_VERSION"]
    assert problem.startswith(f"Inspire runs on serverless environment {supported}, and this run is on serverless "
                              f"environment {version},"), problem
    assert f"Set the environment version to {supported}" in problem
    assert "No module named" not in problem and "\n" not in problem


@pytest.mark.parametrize("environ", [
    {"DATABRICKS_RUNTIME_VERSION": "client.4.10", "DATABRICKS_ENV_VERSION": "4", "IS_SERVERLESS": "TRUE"},
    {"DATABRICKS_RUNTIME_VERSION": "client.4"},
    {"DATABRICKS_ENV_VERSION": "4"},
    {"DATABRICKS_RUNTIME_VERSION": "15.4"},
    {"DATABRICKS_RUNTIME_VERSION": "16.4.x-scala2.12"},
    {"DATABRICKS_ENV_VERSION": "3; see https://example.net"},
    {},
])
def test_environment_4_and_compute_that_is_not_serverless_pass(agent_ns, environ):
    assert agent_ns["inspire_environment_problem"](environ) == ""


def test_the_supported_environment_is_the_one_the_app_launches(agent_ns):
    with open(JOB_PARAMS, encoding="utf-8") as handle:
        launched = re.search(r"const INSPIRE_ENVIRONMENT_VERSION = '(\d+)';", handle.read()).group(1)
    assert launched == agent_ns["GENIE_NOTEBOOK_ENV_VERSION"]


def test_main_stops_before_the_launch_gate_on_environment_3(fresh_ns, monkeypatch):
    monkeypatch.setenv("DATABRICKS_RUNTIME_VERSION", "client.3.6")
    monkeypatch.delenv("DATABRICKS_ENV_VERSION", raising=False)
    reached = []
    fresh_ns["print_ascii_banner"] = lambda: None
    fresh_ns["recreate_deferred_widgets"] = lambda *a, **k: reached.append("widgets")
    fresh_ns["_detect_is_job_context"] = lambda: reached.append("gate") or True
    with pytest.raises(fresh_ns["InspireAssetError"]) as stopped:
        fresh_ns["main"]()
    assert "serverless environment 3" in str(stopped.value)
    assert reached == []


def test_main_goes_on_to_the_launch_gate_on_environment_4(fresh_ns, monkeypatch):
    monkeypatch.setenv("DATABRICKS_RUNTIME_VERSION", "client.4.10")

    class Reached(Exception):
        pass

    def gate():
        raise Reached()

    fresh_ns["print_ascii_banner"] = lambda: None
    fresh_ns["recreate_deferred_widgets"] = lambda *a, **k: None
    fresh_ns["_detect_is_job_context"] = gate
    with pytest.raises(Reached):
        fresh_ns["main"]()


def _trim(bobs, vetoed=()):
    return [{"No": f"U{i}", "idea_theme": theme, "bob_score": bob,
             "bob_hard_veto_gate": "D3" if i in vetoed else None} for i, (theme, bob) in enumerate(bobs)]


def test_the_trim_records_the_target_the_theme_cap_and_the_hard_veto_apart(agent_ns):
    obj = make_inspire(agent_ns)
    a = [("A", 9.9 - i * 0.1) for i in range(10)]
    b = [("B", 8.9 - i * 0.1) for i in range(5)]
    c = [("C", 7.9 - i * 0.1) for i in range(5)]
    ucs = _trim(a + b + c + [("C", 9.95)], vetoed={20})
    drops = {}
    out = obj._stratified_trim_by_theme(ucs, target_max=8, theme_max_share=0.5, drops=drops)
    by_no = {uc["No"]: drops.get(id(uc), (None, ""))[0] for uc in ucs}
    assert sorted(uc["No"] for uc in out) == sorted(["U0", "U1", "U2", "U3", "U10", "U11", "U12", "U15"])
    assert not {id(uc) for uc in out} & set(drops), "a kept use case never carries a drop reason"
    assert [n for n, code in by_no.items() if code == "theme_cap"] == [f"U{i}" for i in range(4, 10)]
    assert [n for n, code in by_no.items() if code == "over_target"] == ["U13", "U14", "U16", "U17", "U18", "U19"]
    assert by_no["U20"] == "hard_veto" and drops[id(ucs[20])][1] == "hard veto on gate Data Granularity (D3)"
    assert drops[id(ucs[4])][1] == "trimmed: its idea theme 'A' already holds the 4 use cases one theme may keep"
    assert drops[id(ucs[13])][1].startswith("trimmed: the catalog is trimmed to 8 use cases")
    line = [m for _lvl, m in obj.logger.records if m.startswith("Stratified trim:")][-1]
    assert "6 left out because the 8 slots went to stronger use cases, 6 over the per-theme cap of 4" in line


def test_the_trim_with_more_themes_than_places_records_the_target(agent_ns):
    obj = make_inspire(agent_ns)
    ucs = _trim([(f"T{i // 2}", 9.0 - i * 0.1) for i in range(10)])
    drops = {}
    out = obj._stratified_trim_by_theme(ucs, target_max=3, drops=drops)
    assert len(out) == 3 and len(drops) == 7
    assert {code for code, _reason in drops.values()} == {"over_target"}
    assert all("5 idea themes" in reason for _code, reason in drops.values())


def test_the_trim_to_one_place_names_one_use_case_and_one_idea_theme(agent_ns):
    obj = make_inspire(agent_ns)
    ucs = _trim([("A", 9.9), ("A", 9.8), ("A", 9.7)])
    drops = {}
    out = obj._stratified_trim_by_theme(ucs, target_max=1, drops=drops)
    assert [u["No"] for u in out] == ["U0"]
    reasons = {reason for _code, reason in drops.values()}
    assert reasons == {"trimmed: the catalog is trimmed to 1 use case and the use cases fall into 1 idea theme, "
                       "so only the best use case of the strongest themes is kept"}


def test_the_trim_without_a_drops_map_behaves_as_before(agent_ns):
    obj = make_inspire(agent_ns)
    ucs = _trim([("A", 9.9), ("A", 9.8), ("A", 9.7), ("A", 9.6), ("B", 1.0)])
    out = obj._stratified_trim_by_theme(ucs, target_max=4, theme_max_share=0.5)
    assert [u["No"] for u in out] == ["U0", "U1", "U4"]


def _funnel(inst, stage):
    return [entry for entry in inst.funnel_ledger if entry["stage"] == stage][-1]


def test_a_trim_to_the_target_is_not_logged_as_a_theme_cap(agent_ns):
    inst = _fake_bob(_inspire(agent_ns))
    ucs = _ucs(158, themes=36)
    out = inst._apply_best_of_best_selection(ucs, [], {})
    kept = {id(uc) for uc in out}
    trimmed = [uc for uc in ucs if id(uc) not in kept]
    assert trimmed and len(out) < 158
    assert _funnel(inst, "stratified_trim")["drops"] == {"over_target": len(trimmed)}
    assert all(uc["selection_drop_reason"].startswith("trimmed: the catalog is trimmed to ") for uc in trimmed)
    assert not any("theme" in uc["selection_drop_reason"].split(",")[0] for uc in trimmed)


def test_a_trim_where_themes_are_full_is_logged_as_the_theme_cap(agent_ns):
    inst = _fake_bob(_inspire(agent_ns))
    ucs = _ucs(158, themes=2)
    out = inst._apply_best_of_best_selection(ucs, [], {})
    kept = {id(uc) for uc in out}
    trimmed = [uc for uc in ucs if id(uc) not in kept]
    cap = max(1, int(inst._trim_target(agent_ns["TECHNICAL_CONTEXT"]["runtime"]) * 0.15))
    assert len(out) == 2 * cap
    assert _funnel(inst, "stratified_trim")["drops"] == {"theme_cap": len(trimmed)}
    assert all(f"already holds the {cap} use cases one theme may keep" in uc["selection_drop_reason"] for uc in trimmed)


@pytest.mark.parametrize("count,requests,domains", [
    ({"count": 5, "mode": "exactly", "scope": "per_domain"}, [], ()),
    ({"count": 30, "mode": "exactly"}, [{"id": "R1", "ask": "forecasting use cases", "minimum": 3}], ["Legal"]),
    ({"count": 120, "mode": "at_least"}, [], ()),
])
def test_every_use_case_the_count_trim_leaves_out_has_its_reason(agent_ns, count, requests, domains):
    inst = _fake_bob(_inspire(agent_ns, count, requests, domains=domains))
    ucs = _ucs(140, themes=3) if count["mode"] == "at_least" else _ucs(89)
    for uc in ucs[-5:]:
        if requests:
            uc["user_request"] = "R1"
    if domains:
        ucs[-6]["Business Domain"] = "Legal"
    out = inst._apply_best_of_best_selection(ucs, [], {})
    kept = {id(uc) for uc in out}
    trimmed = [uc for uc in ucs if id(uc) not in kept]
    drops = _funnel(inst, "stratified_trim")["drops"]
    assert sum(drops.values()) == len(trimmed)
    assert set(drops) <= {"over_target", "theme_cap"}
    assert all(uc["selection_drop_reason"].startswith("trimmed: ") for uc in trimmed)
    assert not any("selection_drop_reason" in uc for uc in out)


def _gen_plan(ns, use_cases=100):
    plan = ns["RunProgressPlan"]()
    plan.configure(languages=["English"], choices=["PDF Catalog"], operation="Discover Use Cases")
    plan.plan_use_cases(use_cases)
    return plan


def _end(plan, stage, step_id):
    plan.observe(stage, "started", step_id)
    plan.observe(stage, "ended_success", step_id)


def _batches(plan, stage, label, count, per_batch, start=0):
    seen = []
    plan.plan_batches(label, count)
    for batch in range(count):
        for unit in range(per_batch):
            _end(plan, stage, f"{label}-{start + batch}-{unit}")
        seen.append(plan._shown())
    return seen


def test_each_generation_batch_moves_the_percent_until_the_last_one(agent_ns):
    plan = _gen_plan(agent_ns)
    _end(plan, "Use Case Design", "start")
    seen = _batches(plan, "Use Case Design", "Pass1Batch", 12, 2)
    assert all(later > earlier for earlier, later in zip(seen, seen[1:])), seen
    assert plan.fraction("generation") < 1.0


def test_without_a_declaration_generation_saturates_on_the_built_in_estimate(agent_ns):
    plan = _gen_plan(agent_ns)
    _end(plan, "Use Case Design", "start")
    for batch in range(12):
        for unit in range(2):
            _end(plan, "Use Case Design", f"b{batch}-{unit}")
    assert plan.fraction("generation") == 1.0, "the estimate of 4 batches is spent long before batch 12"


def test_a_declaration_rebases_the_percent_so_it_neither_drops_nor_stalls(agent_ns):
    plan = _gen_plan(agent_ns)
    for step in range(6):
        _end(plan, "Use Case Design", f"g{step}")
    before = (plan._shown(), plan.percent())
    assert plan.plan_batches("Pass1Batch", 40)
    assert plan._shown() == pytest.approx(before[0]) and plan.percent() == before[1]
    _end(plan, "Use Case Design", "next")
    assert plan._shown() > before[0]


def test_a_batch_stage_declared_mid_prioritization_keeps_moving(agent_ns):
    plan = _gen_plan(agent_ns, use_cases=171)
    _end(plan, "Use Case Prioritization", "p0")
    seen = _batches(plan, "Use Case Prioritization", f"{agent_ns['BEST_OF_BEST_WORKER_PREFIX']}Judge", 35, 1)
    seen += _batches(plan, "Use Case Prioritization", "SignalCheck", 15, 1)
    assert all(later > earlier for earlier, later in zip(seen, seen[1:]))
    assert plan.percent() < 99


@pytest.mark.parametrize("label,count", [("Pass1Batch", -1), ("Pass1Batch", "many"), ("Pass1Batch", None),
                                         ("NotAStage", 3)])
def test_a_bad_count_or_an_unknown_stage_before_any_phase_is_refused(agent_ns, label, count):
    plan = _gen_plan(agent_ns)
    phases = dict(plan.phases)
    assert plan.plan_batches(label, count) is False
    assert plan.phases == phases


def test_an_unlisted_stage_counts_in_the_phase_running_now(agent_ns):
    plan = _gen_plan(agent_ns)
    _end(plan, "Use Case Design", "g0")
    units = plan.phases["generation"][0]
    assert plan.plan_batches("RetryBatch", 3)
    assert plan.phases["generation"][0] == units + 3
    assert plan.plan_batches("RetryBatch", 2)
    assert plan.phases["generation"][0] == units + 5


def test_a_declared_stage_replaces_its_estimate(agent_ns):
    plan = _gen_plan(agent_ns)
    units = plan.phases["generation"][0]
    estimate = plan._estimated_batches(100, 100)
    plan.plan_batches("Pass1Batch", 0)
    plan.plan_batches("Pass2Batch", 0)
    assert plan.phases["generation"][0] == units - 2 * estimate["Pass1Batch"] - 2 * estimate["Pass2Batch"]


def test_every_batch_stage_has_an_estimate_and_a_call_site_that_declares_it(agent_ns):
    stages = agent_ns["PROGRESS_BATCH_STAGES"]
    plan = _gen_plan(agent_ns)
    assert set(plan._estimated_batches(100, 100)) == set(stages)
    source = agent_source()
    judge = agent_ns["DatabricksInspire"]._elite_worker_label("best_of_best", "Judge")
    assert judge in stages and "_score_with_split_retry(use_cases, _judge_batch, batch_size, label," in source
    for label in set(stages) - {judge}:
        declared = (f'_plan_progress_batches("{label}"' in source
                    or re.search(rf'_score_with_split_retry\([^"]{{0,200}}"{label}"', source) is not None)
        assert declared, label


def test_the_split_retry_declares_its_round_0_batches_and_every_retry(agent_ns):
    obj = scorer(agent_ns)
    declared = []
    obj._plan_progress_batches = lambda label, batches: declared.append((label, batches))
    first = set()

    def score(label, batch, skip_cache):
        if "U2" in [u["No"] for u in batch] and not first:
            first.add(label)
            return {}
        return {u["No"]: {"ok": True} for u in batch}

    scores, unscored = obj._score_with_split_retry(ucs_n(10), score, 2, "Test", per_task_timeout=30)
    assert len(scores) == 10 and not unscored
    assert declared == [("Test", 5), ("Test", 1)]


def test_the_writer_and_the_agent_forward_a_declaration(agent_ns, tmp_path, monkeypatch):
    writer = _writer(agent_ns, _ViewSpark(), tmp_path, monkeypatch, operation="Discover Use Cases")
    try:
        _plan(writer)
        units = writer.progress_plan.phases["generation"][0]
        inst = make_inspire(agent_ns, atomic_writer=writer)
        inst._plan_progress_batches("Pass1Batch", 9)
        assert writer.progress_plan.phases["generation"][0] == units + 2 * (9 - 4) + 2 * (9 - 4), "Pass 2 follows Pass 1"
        assert len(writer.logger.matching("[PROGRESS-PLAN FIRED]")) >= 2
        make_inspire(agent_ns)._plan_progress_batches("Pass1Batch", 9)
    finally:
        _stop(writer)


def _timed(ns, durations, hang=()):
    obj = scorer(ns, floor=0.2)
    lock, cut = threading.Lock(), []

    def score(label, batch, skip_cache):
        uc = batch[0]["No"]
        if not skip_cache:
            try:
                wait_or_cancel(ns, 30.0 if uc in hang else durations[uc])
            except RuntimeError:
                with lock:
                    cut.append(uc)
                raise
        return {u["No"]: {"ok": True} for u in batch}

    start = time.time()
    scores, unscored = obj._score_with_split_retry(ucs_n(len(durations)), score, 1, "Test", per_task_timeout=20)
    return scores, unscored, sorted(cut), time.time() - start


def test_batches_inside_the_normal_spread_are_never_cut(agent_ns):
    durations = {f"U{i}": d for i, d in enumerate([0.1, 0.1, 0.1, 0.1, 0.1, 0.5, 0.55, 0.6, 0.7, 0.8])}
    scores, unscored, cut, _elapsed = _timed(agent_ns, durations)
    assert len(scores) == 10 and not unscored
    assert cut == [], "a batch slower than 3x the median of the fast ones but inside the spread is left to finish"


def test_a_hung_batch_among_steady_ones_is_still_cut(agent_ns):
    durations = {f"U{i}": 0.05 for i in range(10)}
    scores, unscored, cut, elapsed = _timed(agent_ns, durations, hang={"U9"})
    assert len(scores) == 10 and not unscored
    assert cut == ["U9"]
    assert elapsed < 5.0


def test_the_budget_waits_until_more_than_half_of_round_0_has_finished(agent_ns):
    durations = {f"U{i}": 0.05 if i < 3 else 1.0 for i in range(8)}
    scores, unscored, cut, _elapsed = _timed(agent_ns, durations)
    assert len(scores) == 8 and not unscored
    assert cut == [], "3 of 8 finished is not more than half, so no budget applies yet"
