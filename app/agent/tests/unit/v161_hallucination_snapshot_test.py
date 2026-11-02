from v120_funnel_integrity_test import HEADER, _gen_harness, _gen_row
from v120_run_offline_smoke_test import _build, quiet_root_logger  # noqa: F401

COLS = [("c", "s", "orders", "id", "bigint", "")]


def _ghost_answer(no, ghost):
    return HEADER + "\n" + _gen_row(no, f"c.s.orders, c.s.{ghost}")


def test_first_prompt_shows_the_phase_snapshot_not_what_other_batches_found_meanwhile(agent_ns):
    obj = _gen_harness(agent_ns, [HEADER + "\n" + _gen_row("N1-1", "c.s.orders")])
    obj._known_hallucinated_tables = {"c.s.pass1_ghost", "c.s.other_batch_ghost"}
    obj._hallucinated_tables_snapshot = frozenset({"c.s.pass1_ghost"})
    obj._process_batch_with_retry(COLS, 1, max_attempts=1)
    schema = obj.ai_agent.calls[0]["vars"]["schema_markdown"]
    assert "c.s.pass1_ghost" in schema
    assert "c.s.other_batch_ghost" not in schema


def test_retry_feedback_carries_the_batch_own_findings_and_the_snapshot_only(agent_ns):
    answers = [_ghost_answer("N1-1", "ghost_one"), _ghost_answer("N1-2", "ghost_two"),
               HEADER + "\n" + _gen_row("N1-3", "c.s.orders")]
    obj = _gen_harness(agent_ns, answers)
    obj._known_hallucinated_tables = set()
    obj._hallucinated_tables_snapshot = frozenset({"c.s.pass1_ghost"})
    responder = obj.ai_agent.responder

    def concurrent_batch_finds_a_ghost(prompt_name, prompt_vars, skip_cache):
        with obj.registry_lock:
            obj._known_hallucinated_tables.add("c.s.other_batch_ghost")
        return responder(prompt_name, prompt_vars, skip_cache)

    obj.ai_agent.responder = concurrent_batch_finds_a_ghost
    out = obj._process_batch_with_retry(COLS, 1, max_attempts=3)
    assert [r["Tables Involved"] for r in out] == ["c.s.orders"]
    second = obj.ai_agent.calls[1]["vars"]["additional_context_section"]
    third = obj.ai_agent.calls[2]["vars"]["additional_context_section"]
    assert "c.s.ghost_one" in second and "c.s.pass1_ghost" in second
    assert "c.s.ghost_one" in third and "c.s.ghost_two" in third and "c.s.pass1_ghost" in third
    assert "c.s.other_batch_ghost" not in second + third
    for call in obj.ai_agent.calls:
        assert "c.s.other_batch_ghost" not in call["vars"]["schema_markdown"]
    assert {"c.s.ghost_one", "c.s.ghost_two"} <= obj._known_hallucinated_tables


def test_partially_hallucinated_answer_is_recorded_for_the_next_phase(agent_ns):
    answer = HEADER + "\n" + _gen_row("N1-1", "c.s.orders") + "\n" + _gen_row("N1-2", "c.s.orders, c.s.half_ghost")
    obj = _gen_harness(agent_ns, [answer])
    obj._known_hallucinated_tables = set()
    out = obj._process_batch_with_retry(COLS, 1, max_attempts=1)
    assert [r["Tables Involved"] for r in out] == ["c.s.orders"]
    assert obj._known_hallucinated_tables == {"c.s.half_ghost"}
    assert obj._snapshot_known_hallucinated_tables() == frozenset({"c.s.half_ghost"})


def test_each_generation_phase_reads_the_tracker_snapshot_taken_at_its_start(fresh_ns, tmp_path, quiet_root_logger):
    def scorer(uc_id):
        return {"use_case_id": uc_id, "quality_label": "High", "quality_score": 4.0, "priority_score": 7.0,
                "quality_summary": "Columns `id` and `amount` aggregated by store give the KPI that drives the outcome."}

    obj = _build(fresh_ns, tmp_path, "Good", {"Medium", "High", "Very High", "Ultra High"}, scorer)
    base = obj._process_batch_with_retry
    seen = {"P1": [], "P2": [], "catch-all": []}

    def generate(column_details, batch_id, **kw):
        phase = str(batch_id).split("_")[0]
        seen[phase].append(getattr(obj, "_hallucinated_tables_snapshot", None))
        with obj.registry_lock:
            obj._known_hallucinated_tables.add(f"cat.sch.{phase.lower()}_{batch_id}_ghost")
        return base(column_details, batch_id, **kw)

    def catch_all(*a, **kw):
        seen["catch-all"].append(getattr(obj, "_hallucinated_tables_snapshot", None))
        return []

    obj._process_batch_with_retry = generate
    obj._retry_missing_table_coverage = catch_all
    obj.run()
    pass1 = {f"cat.sch.p1_P1_{k}_ghost" for k in (1, 2, 3)}
    pass2 = {f"cat.sch.p2_P2_{k}_ghost" for k in (1, 2, 3)}
    assert seen["P1"] == [frozenset()] * 3
    assert seen["P2"] == [frozenset(pass1)] * 3
    assert seen["catch-all"] == [frozenset(pass1 | pass2)]
