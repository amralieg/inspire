"""a04_prioritise (REQ-573 R10.7, R10.9): deterministic scheduling before measurement, full text for selected only.

R10.7: no global LLM ranking before measurement. A cheap deterministic priority (measured exposure, loss-pool share,
KPI computability, table readiness; never an LLM score) schedules which candidates are measured first, and each
scheduling batch carries a deliberately varied exploration sample (20% of the batch, at least 1, seeded from the
session id, spread across table group x mechanism x kind strata). Measurement runs in schedule order before any
COMBINED_VALUE_QUALITY_SCORE_PROMPT, BEST_OF_BEST_SCORING_PROMPT or ULTRA_HIGH_ELITE_JUDGE_PROMPT call.

R10.9: generation writes compact text; the long write-up fields (Solution, Business Value, High Level Design) are
written by USE_CASE_FULL_TEXT_PROMPT only for the selected use cases; every other candidate keeps its compact fields.

Pure tests call inspire_priority / inspire_schedule directly; run tests go through the offline harness
(v120_run_offline_smoke_test._build) with a recorder of every LLM prompt name and every measurement batch.
"""
import json
import logging
import os
import random
import re
import sys
import threading

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v120_run_offline_smoke_test import _build  # noqa: E402
from v120_modes_context_test import GEN_HEADER, gen_row, make_obj  # noqa: E402

ACCEPT_ALL = {"Low", "Medium", "High", "Very High", "Ultra High"}
RANKING_PROMPTS = {"COMBINED_VALUE_QUALITY_SCORE_PROMPT", "BEST_OF_BEST_SCORING_PROMPT", "ULTRA_HIGH_ELITE_JUDGE_PROMPT"}
FULL_TEXT_PROMPT = "USE_CASE_FULL_TEXT_PROMPT"
LONG_FIELDS = ("Solution", "Business Value", "High Level Design")
LLM_SCORE_FIELDS = {"Priority": 10.0, "priority_score": 10.0, "Quality": "Ultra High", "Quality Score": 5.0,
                    "Inspire Score": 9.9, "honesty_score": 99, "bob_score": 10.0, "elite_score": 10.0}


def _fn(ns, name):
    fn = ns.get(name)
    assert callable(fn), f"R10.7/R10.9: the notebook defines no {name}() yet"
    return fn


def _method(ns, name):
    fn = getattr(ns["DatabricksInspire"], name, None)
    assert callable(fn), f"R10.7/R10.9: DatabricksInspire has no {name}() yet"
    return fn


@pytest.fixture
def quiet_root_logger():
    root = logging.getLogger()
    saved = (list(root.handlers), root.level)
    yield
    root.handlers[:] = saved[0]
    root.setLevel(saved[1])


@pytest.fixture
def rt(agent_ns, monkeypatch):
    runtime = agent_ns["TECHNICAL_CONTEXT"]["runtime"]

    def put(key, value):
        monkeypatch.setitem(runtime, key, value)
    return put


# ---------------------------------------------------------------- neutral candidates


def cand(no, table, share=None, exposure=None, computable=False, mechanism="cost", kind="forecast", **extra):
    uc = {"No": no, "Name": f"Plan {no}", "Statement": f"Decide {no}", "Tables Involved": table,
          "value_mechanism": mechanism, "use_case_kind": kind}
    if share is not None:
        uc["loss_pool_id"] = f"lp_{no}"
    if exposure is not None:
        uc["measured_exposure"] = exposure
    if computable:
        uc["KPIs"] = [{"name": "Weekly amount", "table": table, "column": "amount", "computable": True}]
    uc.update(extra)
    return uc


def build_portfolio():
    rows = []
    for i in range(15):
        rows.append((cand(f"A{i:02d}", "c.s.alpha", share=1, mechanism="cost", kind="forecast"), 0.50 - i * 0.01))
    mechs = ("revenue", "risk", "capacity", "cost", "revenue")
    kinds = ("anomaly", "segmentation", "forecast", "next_best_action", "anomaly")
    for g, base in (("beta", 0.20), ("gamma", 0.15), ("delta", 0.10)):
        for i in range(5):
            rows.append((cand(f"{g[0].upper()}{i:02d}", f"c.s.{g}", share=1, mechanism=mechs[i], kind=kinds[i]),
                         base - i * 0.01))
    cands = [c for c, _ in rows]
    signals = {"pools": {c["loss_pool_id"]: {"pool_id": c["loss_pool_id"], "share": s} for c, s in rows},
               "table_ready": {f"c.s.{g}": 1.0 for g in ("alpha", "beta", "gamma", "delta")}}
    return cands, signals


def schedule(ns, cands, signals, seed="4242", batch_size=10, share=0.2):
    return _fn(ns, "inspire_schedule")(list(cands), signals, seed=seed, batch_size=batch_size, exploration_share=share)


def nos(batch, slot=None):
    return [r["No"] for r in batch if slot is None or r["slot"] == slot]


def score(ns, uc, signals):
    out = _fn(ns, "inspire_priority")(uc, signals)
    assert isinstance(out, dict) and isinstance(out.get("score"), float), out
    return out["score"]


# ---------------------------------------------------------------- pure priority and schedule


def test_1_priority_never_reads_an_llm_score_and_rises_with_each_measured_or_metadata_signal(agent_ns):
    sig = {"pools": {"lp_X": {"pool_id": "lp_X", "share": 0.30}, "lp_Y": {"pool_id": "lp_Y", "share": 0.05}},
           "table_ready": {"c.s.ready": 1.0, "c.s.raw": 0.3}}
    plain = cand("X", "c.s.ready", share=1, exposure=50000.0, computable=True)
    # planted: the same candidate carrying top LLM scores must get exactly the same deterministic priority
    flattered = dict(plain, **LLM_SCORE_FIELDS)
    low_llm = dict(plain, Priority=0.0, priority_score=0.0, Quality="Low", **{"Quality Score": 1.0})
    assert score(agent_ns, flattered, sig) == score(agent_ns, plain, sig) == score(agent_ns, low_llm, sig), \
        "R10.7: an LLM score field changed the deterministic priority"
    # must keep: each measured / metadata signal moves the priority the right way, all else equal
    smaller_pool = dict(plain, loss_pool_id="lp_Y")
    assert score(agent_ns, plain, sig) > score(agent_ns, smaller_pool, sig), "pool share is not a priority signal"
    assert score(agent_ns, plain, sig) > score(agent_ns, dict(plain, measured_exposure=500.0), sig), \
        "measured exposure is not a priority signal"
    no_kpi = {k: v for k, v in plain.items() if k != "KPIs"}
    assert score(agent_ns, plain, sig) > score(agent_ns, no_kpi, sig), "KPI computability is not a priority signal"
    assert score(agent_ns, plain, sig) > score(agent_ns, dict(plain, **{"Tables Involved": "c.s.raw"}), sig), \
        "table readiness is not a priority signal"
    bare = {"No": "Z", "Name": "Plan Z", "Tables Involved": "c.s.unknown"}
    assert score(agent_ns, bare, {"pools": {}, "table_ready": {}}) == 0.0, "a candidate with no signal must score 0.0"


def test_2_the_schedule_is_stable_under_input_order(agent_ns):
    cands, sig = build_portfolio()
    ref = schedule(agent_ns, cands, sig)
    for k in range(5):
        shuffled = list(cands)
        random.Random(k).shuffle(shuffled)
        got = schedule(agent_ns, shuffled, sig)
        assert [nos(b) for b in got] == [nos(b) for b in ref], f"R10.7: input order {k} changed the schedule"
    # ties on priority break by No, never by input position
    tie = [cand("T2", "c.s.alpha", share=1), cand("T1", "c.s.alpha", share=1)]
    tsig = {"pools": {"lp_T1": {"share": 0.2}, "lp_T2": {"share": 0.2}}, "table_ready": {}}
    a = schedule(agent_ns, tie, tsig, batch_size=10)
    b = schedule(agent_ns, list(reversed(tie)), tsig, batch_size=10)
    assert nos(a[0]) == nos(b[0]) == ["T1", "T2"]


def test_3_the_schedule_is_reproducible_per_seed_and_never_mutates_its_input(agent_ns):
    cands, sig = build_portfolio()
    before = json.dumps(cands, sort_keys=True)
    first = schedule(agent_ns, cands, sig, seed="run-7")
    second = schedule(agent_ns, cands, sig, seed="run-7")
    assert first == second, "R10.7: the same seed gave two schedules"
    assert json.dumps(cands, sort_keys=True) == before, "inspire_schedule mutated the candidates"
    flat = [r["No"] for b in first for r in b]
    assert sorted(flat) == sorted(c["No"] for c in cands) and len(flat) == len(set(flat)), \
        "every candidate must be scheduled exactly once"
    for b in first:
        for r in b:
            assert set(r) >= {"No", "priority", "slot", "stratum"} and r["slot"] in ("priority", "exploration"), r


@pytest.mark.parametrize("batch_size,explore", [(10, 2), (15, 3), (5, 1), (3, 1), (2, 1)])
def test_4_exploration_is_20_percent_of_each_batch_and_at_least_1(agent_ns, batch_size, explore):
    cands, sig = build_portfolio()
    got = schedule(agent_ns, cands, sig, batch_size=batch_size)
    full = [b for b in got if len(b) == batch_size]
    assert full, got
    for b in full:
        assert len(nos(b, "exploration")) == explore, (batch_size, nos(b, "exploration"))
        assert len(nos(b, "priority")) == batch_size - explore


def test_5_the_exploration_sample_is_not_the_next_top_scores_and_spans_other_groups(agent_ns):
    cands, sig = build_portfolio()
    by_score = sorted(cands, key=lambda c: (-score(agent_ns, c, sig), c["No"]))
    first = schedule(agent_ns, cands, sig, batch_size=10)[0]
    assert nos(first, "priority") == [c["No"] for c in by_score[:8]], "the priority slice must be the top 8 by priority"
    explore = [r for r in first if r["slot"] == "exploration"]
    # planted: a naive schedule takes the top 10 by score, all on table group alpha
    assert set(nos(first)) != {c["No"] for c in by_score[:10]}, "R10.7: the batch is only the top scores"
    tables = {next(c for c in cands if c["No"] == r["No"])["Tables Involved"] for r in explore}
    assert "c.s.alpha" not in tables, f"R10.7: exploration stayed in the top group: {nos(explore)}"
    assert len({r["stratum"] for r in explore}) == len(explore) == 2, "exploration rows must come from distinct strata"


def test_6_a_different_seed_changes_only_the_exploration_part(agent_ns):
    cands, sig = build_portfolio()
    base = schedule(agent_ns, cands, sig, seed="0")[0]
    others = [schedule(agent_ns, cands, sig, seed=str(s))[0] for s in range(1, 8)]
    for o in others:
        assert nos(o, "priority") == nos(base, "priority"), "R10.7: the seed changed the priority slice"
    assert any(set(nos(o, "exploration")) != set(nos(base, "exploration")) for o in others), \
        "R10.7: 7 different seeds gave the same exploration sample (it is not seeded)"


def test_7_empty_and_tiny_inputs_never_raise(agent_ns):
    assert schedule(agent_ns, [], {"pools": {}, "table_ready": {}}) == []
    one = schedule(agent_ns, [cand("O1", "c.s.alpha")], {"pools": {}, "table_ready": {}})
    assert [nos(b) for b in one] == [["O1"]]


def test_8_runtime_flags_follow_the_c36_flag_pattern_and_are_validated(agent_ns, rt):
    flags = agent_ns["DISCOVER_BOOL_FLAGS"]
    for flag in ("discover_deterministic_schedule", "discover_full_text_selected_only"):
        assert flag in flags, f"{flag} is not a c36 discover flag (DISCOVER_BOOL_FLAGS)"
    runtime = agent_ns["TECHNICAL_CONTEXT"]["runtime"]
    assert runtime.get("discover_schedule_batch") == 10 and runtime.get("discover_exploration_share") == 0.2
    assert runtime.get("full_text_batch_size") == 8
    validate = agent_ns["_validate_runtime_config"]
    validate()
    for key, bad in (("discover_exploration_share", 0.0), ("discover_exploration_share", 1.0),
                     ("discover_schedule_batch", 1), ("full_text_batch_size", 0)):
        rt(key, bad)
        with pytest.raises((TypeError, ValueError)):
            validate()
        rt(key, {"discover_exploration_share": 0.2, "discover_schedule_batch": 10, "full_text_batch_size": 8}[key])
    validate()


# ---------------------------------------------------------------- run(): measurement before any LLM ranking


def _scorer(uc_id):
    return {"use_case_id": uc_id, "quality_label": "High", "quality_score": 4.0, "priority_score": 7.0,
            "quality_summary": "Columns `id` and `amount` aggregated by store give the KPI that drives the outcome."}


def _full_text_answer(prompt_vars):
    rows = json.loads(prompt_vars["use_cases_json"])
    return json.dumps([{"No": r["No"], "Solution": f"Full solution for {r['No']} on `amount` by `id`.",
                        "Business Value": f"Full value for {r['No']}.",
                        "High Level Design": f"Aggregate `amount` by `id` for {r['No']}."} for r in rows])


def _run(ns, tmp_path, scorer=_scorer, schedule_on=True, full_text_on=True, batch=None):
    rtm = ns["TECHNICAL_CONTEXT"]["runtime"]
    saved = {k: rtm.get(k) for k in ("discover_deterministic_schedule", "discover_full_text_selected_only",
                                     "discover_schedule_batch")}
    rtm["discover_deterministic_schedule"] = schedule_on
    rtm["discover_full_text_selected_only"] = full_text_on
    if batch is not None:
        rtm["discover_schedule_batch"] = batch
    try:
        obj = _build(ns, tmp_path, "Good", ACCEPT_ALL, scorer)
        events, lock = [], threading.Lock()
        legacy = obj.ai_agent.run_worker

        def run_worker(step_name, worker_prompt_path, prompt_vars, response_schema=None, **kw):
            with lock:
                events.append(("LLM", worker_prompt_path, dict(prompt_vars)))
            if worker_prompt_path == FULL_TEXT_PROMPT:
                return _full_text_answer(prompt_vars)
            return legacy(step_name, worker_prompt_path, prompt_vars, response_schema, **kw)
        obj.ai_agent.run_worker = run_worker
        generated = []
        gen = obj._process_batch_with_retry

        def generate(column_details, batch_id, **kw):
            out = gen(column_details, batch_id, **kw)
            generated.extend(out)
            return out
        obj._process_batch_with_retry = generate
        if schedule_on:
            _method(ns, "_measure_candidates")
            measure = obj._measure_candidates

            def recorded(use_cases):
                with lock:
                    events.append(("MEASURE", [str(u.get("No")) for u in use_cases], None))
                return measure(use_cases)
            obj._measure_candidates = recorded
        obj.run()
        return obj, events, generated
    finally:
        for k, v in saved.items():
            if v is None:
                rtm.pop(k, None)
            else:
                rtm[k] = v


def _scored_ids(events):
    return [i for kind, name, pv in events if kind == "LLM" and name == "COMBINED_VALUE_QUALITY_SCORE_PROMPT"
            for i in re.findall(r"### Use Case: (\S+) - ", pv["use_cases_to_validate"])]


def test_9_run_measures_in_schedule_order_before_any_llm_ranking_call(agent_ns, tmp_path, quiet_root_logger):
    obj, events, _ = _run(agent_ns, tmp_path / "new")
    kinds = [(k, n) for k, n, _ in events]
    measures = [i for i, (k, _) in enumerate(kinds) if k == "MEASURE"]
    ranks = [i for i, (k, n) in enumerate(kinds) if k == "LLM" and n in RANKING_PROMPTS]
    assert measures, "R10.7: run() never measured the candidates through _measure_candidates"
    assert ranks and min(ranks) > max(measures), \
        f"R10.7: an LLM ranking call ran before measurement finished: {[n for k, n in kinds if k != 'MEASURE'][:6]}"
    sched = getattr(obj, "discover_schedule", None)
    assert isinstance(sched, list) and sched, "run() publishes no self.discover_schedule"
    assert events[measures[0]][1] == nos(sched[0]), "the first measured batch is not the first scheduled batch"
    measured = {n for k, ids, _ in events if k == "MEASURE" for n in ids}
    assert set(_scored_ids(events)) <= measured, "an unmeasured candidate reached the LLM quality check"
    # must keep: the legacy order stays available behind the flag (R5.4)
    _, legacy, _ = _run(agent_ns, tmp_path / "legacy", schedule_on=False)
    assert any(k == "LLM" and n == "COMBINED_VALUE_QUALITY_SCORE_PROMPT" for k, n, _ in legacy)
    assert not any(k == "MEASURE" for k, _, _ in legacy), "the legacy path must not run the new schedule"


def test_10_the_schedule_is_seeded_from_the_session_id(agent_ns, tmp_path, quiet_root_logger, monkeypatch):
    real = _fn(agent_ns, "inspire_schedule")
    seeds = []

    def spy(use_cases, signals, seed=None, **kw):
        seeds.append(seed)
        return real(use_cases, signals, seed=seed, **kw)
    monkeypatch.setitem(agent_ns, "inspire_schedule", spy)
    obj, _, _ = _run(agent_ns, tmp_path, batch=2)
    assert seeds and all(str(s) == str(obj.session_id) for s in seeds), seeds
    assert all(len(b) <= 2 for b in obj.discover_schedule) and len(obj.discover_schedule) >= 2, obj.discover_schedule


def test_11_measurement_stops_at_the_budget_and_unreached_candidates_are_not_scored(agent_ns, tmp_path, rt):
    rt("discover_schedule_batch", 2)
    obj = _build(agent_ns, tmp_path, "Good", ACCEPT_ALL, _scorer)
    _method(agent_ns, "_measure_scheduled")
    ucs = [cand(f"M{i}", "c.s.orders", **{"Tables Involved": "cat.sch.orders"}) for i in range(6)]
    batches = []
    obj._measure_candidates = lambda b: batches.append([u["No"] for u in b])
    obj._discover_budget_spent = lambda: len(batches) >= 1
    measured, unreached = obj._measure_scheduled(ucs)
    assert len(batches) == 1 and len(measured) == 2 and len(unreached) == 4, (batches, len(measured), len(unreached))
    assert all(u["schedule_state"] == "not_reached" for u in unreached)
    assert all(u["schedule_state"] == "measured" and isinstance(u["schedule_rank"], int) for u in measured)
    # must keep: no budget limit measures everything, in schedule order
    batches.clear()
    obj._discover_budget_spent = lambda: False
    measured, unreached = obj._measure_scheduled([dict(u) for u in ucs])
    assert len(measured) == 6 and unreached == [] and len(batches) == 3


def test_12_priority_signals_come_from_loss_pools_and_table_labels_never_an_llm(agent_ns, tmp_path):
    obj = _build(agent_ns, tmp_path, "Good", ACCEPT_ALL, _scorer)
    sig_fn = _method(agent_ns, "_priority_signals")
    obj.loss_pools = [{"pool_id": "lp1", "table": "cat.sch.orders", "share": 0.4, "material": True},
                      {"pool_id": "lp2", "table": "cat.sch.items", "share": None, "material": None}]
    obj.data_category_map = {"cat.sch.orders": "TRANSACTIONAL", "cat.sch.items": "MASTER", "cat.sch.codes": "REFERENCE"}
    sig = sig_fn(obj)
    assert sig["pools"]["lp1"]["share"] == 0.4 and sig["pools"]["lp2"]["share"] is None
    ready = sig["table_ready"]
    assert ready["cat.sch.orders"] > ready["cat.sch.items"] > ready["cat.sch.codes"] > 0
    # planted: no attribute -> empty signals, never a raise
    bare = _build(agent_ns, tmp_path / "bare", "Good", ACCEPT_ALL, _scorer)
    for attr in ("loss_pools", "data_category_map"):
        bare.__dict__.pop(attr, None)
    assert sig_fn(bare) == {"pools": {}, "table_ready": {}}


# ---------------------------------------------------------------- R10.9 full text for the selected only


def test_13_generation_asks_for_compact_text_when_full_text_is_for_selected_only(agent_ns, rt):
    instruction = agent_ns.get("INSPIRE_COMPACT_TEXT_INSTRUCTION")
    assert isinstance(instruction, str) and all(f in instruction for f in LONG_FIELDS), \
        "R10.9: no INSPIRE_COMPACT_TEXT_INSTRUCTION naming the long fields"
    assert "{text_detail}" in agent_ns["PROMPT_TEMPLATES"]["BASE_USE_CASE_GEN_PROMPT"]
    for on, expect_var, expect_detail in ((True, instruction, "compact"), (False, "", "full")):
        rt("discover_full_text_selected_only", on)
        obj = make_obj(agent_ns, lambda *a: GEN_HEADER + "\n" + gen_row("N1-1"), table_id_map={}, id_table_map={},
                       column_id_map={}, id_column_map={}, next_table_id=1, next_column_id=1, data_loader=None,
                       data_category_map={"c.s.orders": "TRANSACTIONAL"}, global_table_names={"c.s.orders"},
                       _known_hallucinated_tables=set(),
                       processing_honesty={"total_batch_splits": 0, "batch_split_history": []})
        obj._format_schema_for_prompt = lambda cols: "| table | col |\n" + "\n".join(f"| {c[2]} | {c[3]} |" for c in cols)
        obj._estimate_schema_markdown_size = lambda cols: 100
        obj._business_column_details_global = [("c", "s", "orders", "id", "bigint", "")]
        out = obj._process_batch_with_retry([("c", "s", "orders", "id", "bigint", "")], 1)
        assert obj.ai_agent.calls[0]["vars"].get("text_detail") == expect_var, on
        assert out and all(u.get("text_detail") == expect_detail for u in out), (on, [u.get("text_detail") for u in out])


def test_14_run_writes_full_text_once_per_selected_use_case_and_never_for_the_others(agent_ns, tmp_path,
                                                                                    quiet_root_logger):
    obj, events, generated = _run(agent_ns, tmp_path / "on", schedule_on=False)
    final = obj.recorded["tracking"][-1]
    sent = [r["No"] for k, n, pv in events if k == "LLM" and n == FULL_TEXT_PROMPT
            for r in json.loads(pv["use_cases_json"])]
    assert final, "the harness selected nothing"
    assert sorted(sent) == sorted(u["No"] for u in final) and len(sent) == len(final), \
        f"R10.9: full text calls covered {sent}, selected are {[u['No'] for u in final]}"
    for uc in final:
        assert uc.get("text_detail") == "full" and uc["Solution"].startswith("Full solution for "), uc.get("No")
    selected = {u["No"] for u in final}
    unselected = [u for u in generated if u["No"] not in selected]
    assert unselected, "the harness must drop some candidates"
    for uc in unselected:
        assert uc["No"] not in sent
        assert uc.get("text_detail") != "full" and not str(uc.get("Solution", "")).startswith("Full solution"), uc["No"]
    # must keep: the flag off writes no full text call
    _, legacy, _ = _run(agent_ns, tmp_path / "off", schedule_on=False, full_text_on=False)
    assert not any(k == "LLM" and n == FULL_TEXT_PROMPT for k, n, _ in legacy)


def test_15_zero_selected_makes_no_full_text_call_and_never_raises(agent_ns, tmp_path, quiet_root_logger):
    _method(agent_ns, "_write_full_text")
    obj, events, _ = _run(agent_ns, tmp_path, scorer=lambda uc_id: None, schedule_on=False)
    assert not obj.recorded["tracking"] or not obj.recorded["tracking"][-1]
    assert not any(k == "LLM" and n == FULL_TEXT_PROMPT for k, n, _ in events)
    direct = make_obj(agent_ns, lambda *a: (_ for _ in ()).throw(AssertionError("no call expected")))
    assert direct._write_full_text([]) == {"written": 0, "kept_compact": {}}


def test_16_full_text_batches_and_keeps_compact_text_on_failure_missing_or_invented_columns(agent_ns, rt):
    _method(agent_ns, "_write_full_text")
    rt("full_text_batch_size", 2)

    def responder(prompt_name, prompt_vars, skip_cache):
        assert prompt_name == FULL_TEXT_PROMPT
        rows = json.loads(prompt_vars["use_cases_json"])
        out = []
        for r in rows:
            if r["No"] == "S1":
                out.append({"No": "S1", "Solution": "Rank `amount` by `id` weekly.", "Business Value": "Full value S1.",
                            "High Level Design": "Sum `amount` per `id`."})
            if r["No"] == "S2":
                out.append({"No": "S2", "Solution": "Use `ghost_rate` to plan.", "Business Value": "Full value S2.",
                            "High Level Design": "Join `ghost_rate`."})
        out.append({"No": "NOT_SELECTED", "Solution": "x", "Business Value": "x", "High Level Design": "x"})
        return json.dumps(out)

    obj = make_obj(agent_ns, responder)
    obj._business_column_details_global = [("c", "s", "orders", "id", "bigint", ""),
                                           ("c", "s", "orders", "amount", "double", "")]
    sel = [{"No": n, "Name": f"Plan {n}", "Statement": f"Decide {n}", "Tables Involved": "c.s.orders",
            "Solution": "Model", "Business Value": "Value", "High Level Design": "Aggregate", "text_detail": "compact"}
           for n in ("S1", "S2", "S3")]
    summary = obj._write_full_text(sel)
    assert len(obj.ai_agent.calls) == 2, "3 selected at batch size 2 must be 2 calls"
    s1, s2, s3 = sel
    assert s1["text_detail"] == "full" and s1["Solution"] == "Rank `amount` by `id` weekly."
    assert s2["text_detail"] == "compact" and s2["Solution"] == "Model", "an invented column must keep the compact text"
    assert s3["text_detail"] == "compact" and s3["Solution"] == "Model"
    assert summary == {"written": 1, "kept_compact": {"S2": "invented_columns", "S3": "no_text_returned"}}, summary
    assert all(u["No"] != "NOT_SELECTED" for u in sel) and len(sel) == 3

    def boom(*a):
        raise RuntimeError("endpoint down token=abc123")
    failing = make_obj(agent_ns, boom)
    failing._business_column_details_global = obj._business_column_details_global
    again = [dict(u, Solution="Model", text_detail="compact") for u in sel]
    summary = failing._write_full_text(again)
    assert summary["written"] == 0 and set(summary["kept_compact"]) == {"S1", "S2", "S3"}
    assert all(v.startswith("full_text_failed") and "abc123" not in v for v in summary["kept_compact"].values())
    assert all(u["Solution"] == "Model" and u["text_detail"] == "compact" for u in again)
