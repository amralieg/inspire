"""v1.2.0 CORE lane, WS1 funnel integrity: K1 (score the gated list, content-keyed caches),
K2 (context reaches generation and the table filter), K3 (BoB context/schema/retry), K4 (no
fabricated scores; unscored UCs never selected), K5 (no padding; zero-accepted outcome), the
Priority/Priority Score mismatch, the skip_cache retry sweep, the selection funnel ledger, domain
coverage picks, latent NameErrors (D2-04) and the generation/filter register items in this region.

Every behavioural test fails on the v1.1.3 notebook; must-exclude cases keep filters honest.
"""
import ast
import builtins
import copy
import json
import logging
import os
import re
import string
import symtable
import sys
import threading

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import agent_source, method_node  # noqa: E402


class FakeStorage:
    def __init__(self):
        self.scored = {}
        self.schema_md = None

    def load_scored_use_cases(self, tag="combined_scored"):
        return copy.deepcopy(self.scored.get(tag))

    def save_scored_use_cases(self, data, tag="combined_scored"):
        self.scored[tag] = copy.deepcopy(data)

    def load_schema_markdown(self, tag="schema_markdown"):
        return self.schema_md

    def save_schema_markdown(self, markdown, tag="schema_markdown"):
        self.schema_md = markdown


class FakeAgent:
    def __init__(self, responder):
        self.responder = responder
        self.calls = []
        self._lock = threading.Lock()
        self.prompt_templates = {"BASE_USE_CASE_GEN_PROMPT": "generate"}

    def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema=None, model_override=None,
                   timeout_override=None, max_retries_override=None, start_from_model=None, skip_cache=False,
                   temperature_override=None):
        with self._lock:
            self.calls.append({"step": step_name, "prompt": worker_prompt_path, "vars": dict(prompt_vars),
                               "skip_cache": skip_cache})
        return self.responder(worker_prompt_path, prompt_vars, skip_cache)

    def _call_ai_query(self, prompt, prompt_name, response_schema=None, **kw):
        with self._lock:
            self.calls.append({"prompt": prompt_name, "vars": {"prompt_text": prompt},
                               "skip_cache": kw.get("skip_cache", False)})
        return self.responder(prompt_name, {"prompt_text": prompt}, kw.get("skip_cache", False))

    def set_language(self, language):
        return None


class FakeWriter:
    def __init__(self):
        self.steps = []

    def emit_step(self, **kw):
        self.steps.append(kw)
        return len(self.steps)


def make_inspire(ns, responder=None, **attrs):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = logging.getLogger("v120_core")
    obj.storage_manager = FakeStorage()
    obj.ai_agent = FakeAgent(responder or (lambda *a: ""))
    obj.atomic_writer = FakeWriter()
    obj.parsed_generation_instructions = {}
    obj.merged_business_context = {}
    obj.business_name = "Acme"
    obj.llm_timeout_seconds = 30
    obj.use_cases_quality = "Good"
    obj.quality_filter_acceptable = {"Medium", "High", "Very High", "Ultra High"}
    obj.user_business_domains = []
    obj.funnel_ledger = []
    obj.final_inspire_results_json = {}
    obj.registry_lock = threading.Lock()
    obj.global_table_names = set()
    obj.max_parallelism = 4
    for key, value in attrs.items():
        setattr(obj, key, value)
    return obj


def make_uc(no, domain="Sales", statement=None, **extra):
    uc = {"No": no, "Name": f"Forecast demand {no}", "type": "AI", "Analytics Technique": "Forecasting",
          "Statement": statement or f"Statement for {no}", "Solution": "Model it", "Business Value": "Value",
          "Tables Involved": "c.s.orders", "High Level Design": "Aggregate and model",
          "Business Domain": domain, "Quality": "Pending", "Priority": 0.0}
    uc.update(extra)
    return uc


def ids_in(markdown):
    return re.findall(r"### Use Case: (\S+) - ", markdown or "")


def combined_rec(uc_id, label="High", q=4.0, p=8.0, **extra):
    rec = {"use_case_id": uc_id, "quality_label": label, "quality_score": q, "priority_score": p,
           "value_score": 4.2, "feasibility_score": 3.6, "roi": 4.0, "strategic_alignment": 4.0,
           "quality_summary": "Columns `a` and `b` aggregated monthly give a KPI that drives the stated outcome."}
    rec.update(extra)
    return rec


def combined_responder(make_records):
    def responder(prompt_name, prompt_vars, skip_cache):
        assert prompt_name == "COMBINED_VALUE_QUALITY_SCORE_PROMPT"
        return json.dumps(make_records(ids_in(prompt_vars["use_cases_to_validate"]), skip_cache))
    return responder


def bob_rec(uc_id, gates=None, theme="Demand"):
    scores = gates if gates is not None else {f"D{i}": 7 for i in range(1, 20)}
    return {"No": uc_id, "bob_scores": scores, "idea_theme": theme, "bob_justification_short": "ok"}


# ---------------------------------------------------------------- K4 / F-02 / F-03 / F-16


def test_K4_combined_missing_uc_is_retried_then_unscored_never_medium(agent_ns):
    def make(ids, skip_cache):
        return [combined_rec(i) for i in ids if i != "U2"]

    obj = make_inspire(agent_ns, combined_responder(make))
    ucs = [make_uc("U1"), make_uc("U2"), make_uc("U3")]
    obj._score_combined_value_and_quality(ucs, [])
    u1, u2, u3 = ucs
    assert u1["scoring_status"] == "scored" and u1["Quality"] == "High"
    assert u2["scoring_status"] == "unscored"
    assert u2["Quality"] == "Unscored" and "Quality Score" not in u2
    assert u2.get("Quality") != "Medium"
    retry_calls = [c for c in obj.ai_agent.calls if "U2" in ids_in(c["vars"]["use_cases_to_validate"]) and c["skip_cache"]]
    assert retry_calls, "the missing UC must be re-sent with the cache bypassed"
    assert all(ids_in(c["vars"]["use_cases_to_validate"]) == ["U2"] or len(ids_in(c["vars"]["use_cases_to_validate"])) < 3
               for c in retry_calls), "retries must use smaller batches"


def test_K4_combined_retry_recovers_uc(agent_ns):
    def make(ids, skip_cache):
        return [combined_rec(i) for i in ids if skip_cache or i != "U2"]

    obj = make_inspire(agent_ns, combined_responder(make))
    ucs = [make_uc("U1"), make_uc("U2")]
    obj._score_combined_value_and_quality(ucs, [])
    assert [u["scoring_status"] for u in ucs] == ["scored", "scored"]


@pytest.mark.parametrize("bad", [
    {"quality_label": "Great"},
    {"quality_score": None},
    {"priority_score": "n/a"},
    {"quality_score": 42},
])
def test_K4_combined_invalid_record_is_not_accepted(agent_ns, bad):
    obj = make_inspire(agent_ns)
    good = combined_rec("U1")
    broken = combined_rec("U2", **bad)
    out = obj._parse_combined_score_response(json.dumps([good, broken]), [make_uc("U1"), make_uc("U2")])
    assert set(out) == {"U1"}


def test_K4_combined_parser_ignores_ids_outside_batch_and_normalizes_label(agent_ns):
    obj = make_inspire(agent_ns)
    out = obj._parse_combined_score_response(json.dumps([combined_rec("U1", label="very high"), combined_rec("ZZ")]),
                                             [make_uc("U1")])
    assert set(out) == {"U1"} and out["U1"]["quality_label"] == "Very High"
    assert obj._parse_combined_score_response("not json", [make_uc("U1")]) == {}
    assert obj._parse_combined_score_response("", [make_uc("U1")]) == {}


def test_K4_default_combined_scores_removed(agent_ns):
    assert not hasattr(agent_ns["DatabricksInspire"], "_default_combined_scores")
    assert not hasattr(agent_ns["DatabricksInspire"], "_assign_default_quality_scores")


def test_K4_truncated_array_salvages_complete_scored_objects(agent_ns):
    obj = make_inspire(agent_ns)
    truncated = ("[" + json.dumps(combined_rec("U1")) + ", " + json.dumps(combined_rec("U2"))
                 + ', {"use_case_id": "U3", "quality_label": "Hi')
    out = obj._parse_combined_score_response(truncated, [make_uc("U1"), make_uc("U2"), make_uc("U3")])
    assert set(out) == {"U1", "U2"}
    assert "U3" not in out


def test_K4_degenerate_or_empty_array_scores_nothing(agent_ns):
    obj = make_inspire(agent_ns)
    assert obj._parse_combined_score_response("[", [make_uc("U1")]) == {}
    assert obj._parse_combined_score_response("[\n", [make_uc("U1")]) == {}
    assert obj._parse_combined_score_response("```json\n[", [make_uc("U1")]) == {}


def test_K4_salvage_still_rejects_invalid_and_foreign_records(agent_ns):
    obj = make_inspire(agent_ns)
    truncated = ("[" + json.dumps(combined_rec("U1")) + ", " + json.dumps(combined_rec("U2", quality_label="Great"))
                 + ", " + json.dumps(combined_rec("ZZ")) + ', {"use_case_id": "U9"')
    out = obj._parse_combined_score_response(truncated, [make_uc("U1"), make_uc("U2")])
    assert set(out) == {"U1"}


def test_F02_partial_cache_keyed_on_content_not_ids_and_names(agent_ns):
    def make(ids, skip_cache):
        return [combined_rec(i) for i in ids]

    obj = make_inspire(agent_ns, combined_responder(make))
    ucs = [make_uc("U1"), make_uc("U2")]
    obj._score_combined_value_and_quality(ucs, [])
    first_calls = len(obj.ai_agent.calls)
    changed = [make_uc("U1"), make_uc("U2", statement="A completely different problem statement")]
    obj._score_combined_value_and_quality(changed, [])
    sent_after = [ids_in(c["vars"]["use_cases_to_validate"]) for c in obj.ai_agent.calls[first_calls:]]
    assert any("U2" in batch for batch in sent_after), "changed UC content must be re-scored, not served from cache"


def test_F02_identical_content_reuses_cache(agent_ns):
    def make(ids, skip_cache):
        return [combined_rec(i) for i in ids]

    obj = make_inspire(agent_ns, combined_responder(make))
    obj._score_combined_value_and_quality([make_uc("U1"), make_uc("U2")], [])
    n = len(obj.ai_agent.calls)
    again = [make_uc("U1"), make_uc("U2")]
    obj._score_combined_value_and_quality(again, [])
    assert len(obj.ai_agent.calls) == n
    assert all(u["scoring_status"] == "scored" for u in again)


def test_F03_failure_never_overwrites_a_good_cached_score(agent_ns):
    obj = make_inspire(agent_ns)
    ucs = [make_uc("U1"), make_uc("U2")]
    base_vars_probe = make_inspire(agent_ns, combined_responder(lambda ids, s: [combined_rec(i, label="Very High") for i in ids if i == "U1"]))
    base_vars_probe.storage_manager = obj.storage_manager
    base_vars_probe._score_combined_value_and_quality([make_uc("U1"), make_uc("U2")], [])

    def boom(prompt_name, prompt_vars, skip_cache):
        raise RuntimeError("endpoint down")

    obj.ai_agent = FakeAgent(boom)
    obj._score_combined_value_and_quality(ucs, [])
    assert ucs[0]["Quality"] == "Very High" and ucs[0]["scoring_status"] == "scored"
    assert ucs[1]["scoring_status"] == "unscored"
    sent = [ids_in(c["vars"]["use_cases_to_validate"]) for c in obj.ai_agent.calls]
    assert sent and all("U1" not in batch for batch in sent), "cached UC must not be re-sent (F-16)"


def test_F02_fingerprint_changes_with_content_and_context(agent_ns):
    fp = agent_ns["DatabricksInspire"]._use_case_set_fingerprint
    base = [make_uc("U1"), make_uc("U2")]
    assert fp(base, {"a": 1}) == fp([make_uc("U2"), make_uc("U1")], {"a": 1})
    assert fp(base, {"a": 1}) != fp([make_uc("U1"), make_uc("U2", statement="x")], {"a": 1})
    assert fp(base, {"a": 1}) != fp(base, {"a": 2})
    assert fp(base, {"a": 1}) != fp(base[:1], {"a": 1})


# ---------------------------------------------------------------- Priority mismatch


def test_priority_and_priority_score_come_from_combined_scoring(agent_ns):
    obj = make_inspire(agent_ns, combined_responder(lambda ids, s: [combined_rec(i, q=4.0, p=4.0) for i in ids]))
    uc = make_uc("U1", Priority=9.5)
    obj._score_combined_value_and_quality([uc], [])
    assert uc["Priority"] == 4.0 and uc["Priority Score"] == 4.0
    obj._apply_inspire_scores([uc])
    rt = agent_ns["TECHNICAL_CONTEXT"]["runtime"]
    expected = round(rt["inspire_score_quality_weight"] * 8.0 + rt["inspire_score_priority_weight"] * 4.0, 2)
    assert uc["Inspire Score"] == expected


def test_inspire_score_never_defaults(agent_ns):
    obj = make_inspire(agent_ns)
    good = make_uc("U1", scoring_status="scored", **{"Quality Score": 3.0, "Priority": 6.0, "Quality": "Medium"})
    missing_priority = make_uc("U2", scoring_status="scored", **{"Quality Score": 3.0, "Quality": "Medium"})
    missing_priority["Priority"] = None
    unscored = make_uc("U3", scoring_status="unscored")
    obj._apply_inspire_scores([good, missing_priority, unscored])
    assert good["Inspire Score"] is not None
    assert missing_priority["scoring_status"] == "unscored" and "Inspire Score" not in missing_priority
    assert "Inspire Score" not in unscored
    assert obj._compute_inspire_score(make_uc("U4", scoring_status="scored")) is None


# ---------------------------------------------------------------- K3 BoB


def test_K3_bob_gets_merged_context_and_schema(agent_ns):
    captured = []

    def responder(prompt_name, prompt_vars, skip_cache):
        captured.append(prompt_vars)
        return json.dumps([bob_rec(i) for i in ids_in(prompt_vars["use_cases_to_validate"])])

    obj = make_inspire(agent_ns, responder)
    schema = [("c", "s", "orders", "order_id", "bigint", "pk"), ("c", "s", "orders", "amount", "double", "")]
    context = {"business_context": "Ctx", "industry": "Ind", "strategic_goals": ["G1"], "business_priorities": ["P1"],
               "strategic_initiative": "SI", "value_chain": "VC", "revenue_model": "RM"}
    obj._score_best_of_best([make_uc("U1")], schema, **obj._grading_context(context))
    pv = captured[0]
    assert pv["business_context"] == "Ctx" and pv["industry"] == "Ind"
    assert "strategic_goals" not in pv and "business_priorities" not in pv
    assert "G1" not in json.dumps(pv) and "P1" not in json.dumps(pv)
    assert pv["strategic_initiative"] == "SI" and pv["value_chain"] == "VC" and pv["revenue_model"] == "RM"
    assert "orders" in pv["schema_details"] and "amount" in pv["schema_details"]
    assert pv["schema_details"] == obj._build_schema_markdown_for_validation(schema)


def test_K3_bob_missing_gate_is_retried_never_defaulted_to_5(agent_ns):
    def responder(prompt_name, prompt_vars, skip_cache):
        out = []
        for i in ids_in(prompt_vars["use_cases_to_validate"]):
            gates = {f"D{g}": 8 for g in range(1, 20)}
            if i == "U2":
                del gates["D7"]
            out.append(bob_rec(i, gates))
        return json.dumps(out)

    obj = make_inspire(agent_ns, responder)
    ucs = [make_uc("U1"), make_uc("U2")]
    obj._score_best_of_best(ucs, [])
    assert ucs[0]["bob_status"] == "scored" and ucs[0]["bob_score"] > 0
    assert ucs[1]["bob_status"] == "unscored"
    assert "bob_score" not in ucs[1] and "bob_scores" not in ucs[1]
    assert any(c["skip_cache"] for c in obj.ai_agent.calls), "BoB retries must bypass the cache"


def test_K3_bob_parser_rejects_invalid_gates(agent_ns):
    obj = make_inspire(agent_ns)
    gates_bad = {f"D{g}": 8 for g in range(1, 20)}
    gates_bad["D3"] = 11
    gates_text = {f"D{g}": 8 for g in range(1, 20)}
    gates_text["D4"] = "high"
    raw = json.dumps([bob_rec("A"), bob_rec("B", gates_bad), bob_rec("C", gates_text), {"bob_scores": {}}])
    recs = obj._parse_bob_response(raw, [])
    assert [r["No"] for r in recs] == ["A"]
    assert recs[0]["bob_scores"]["D1"] == 7


def test_K3_bob_uses_parallel_executor_not_raw_as_completed():
    src = ast.unparse(method_node("DatabricksInspire", "_score_best_of_best"))
    assert "as_completed" not in src and "ThreadPoolExecutor" not in src
    assert "_score_with_split_retry" in src
    engine = ast.unparse(method_node("DatabricksInspire", "_score_with_split_retry"))
    assert "_SafeExecutorContext(" in engine and "ctx.cancel(future)" in engine and "per_task_timeout" in engine
    assert "as_completed" not in engine and "ThreadPoolExecutor" not in engine


def test_K3_no_never_assigned_cached_context_reads():
    src = agent_source()
    for name in ("_business_context_cached", "_industry_cached", "_strategic_goals_cached", "_business_priorities_cached"):
        assert name not in src, f"{name} is never assigned; it must not be read"


def test_K3_selection_passes_context_to_bob(agent_ns):
    seen = {}

    def fake_bob(use_cases, schema, **ctx):
        seen.update(ctx)
        seen["schema"] = schema
        for uc in use_cases:
            uc.update({"bob_status": "scored", "bob_score": 7.0, "bob_hard_veto_gate": None, "idea_theme": "T"})
        return use_cases

    obj = make_inspire(agent_ns)
    obj._score_best_of_best = fake_bob
    ctx = {"business_context": "B", "industry": "I", "strategic_goals": ["g"], "business_priorities": ["p"],
           "strategic_initiative": "s", "value_chain": "v", "revenue_model": "r"}
    ucs = [make_uc(f"U{i}", scoring_status="scored", Quality="High", **{"Inspire Score": 7.0}) for i in range(25)]
    obj._select_scored_use_cases(ucs, ["schema-row"], ctx)
    blind = {k: v for k, v in ctx.items() if k not in ("strategic_goals", "business_priorities")}
    assert {k: seen[k] for k in blind} == blind and seen["schema"] == ["schema-row"]
    assert "strategic_goals" not in seen and "business_priorities" not in seen


# ---------------------------------------------------------------- F-10 / F-15


def test_F10_validation_missing_uc_is_rejected(agent_ns):
    obj = make_inspire(agent_ns)
    raw = json.dumps([{"use_case_id": "U1", "validation_status": "APPROVED"}])
    out = obj._parse_validation_response(raw, [make_uc("U1"), make_uc("U2")])
    by_id = {r["use_case_id"]: r for r in out}
    assert by_id["U1"]["validation_status"] == "APPROVED"
    assert by_id["U2"]["validation_status"] == "REJECTED"


def test_F15_dead_sufficiency_stub_removed(agent_ns):
    assert not hasattr(agent_ns["DatabricksInspire"], "_validate_use_case_data_sufficiency_legacy")
    assert "_validate_use_case_data_sufficiency_legacy" not in agent_source()


# ---------------------------------------------------------------- selection: K4 exclusion, K5, coverage picks, funnel


def _scored(no, quality="High", inspire=7.0, domain="Sales", **extra):
    return make_uc(no, domain=domain, scoring_status="scored", Quality=quality, **{"Inspire Score": inspire}, **extra)


def test_unscored_use_case_can_never_reach_the_final_list(agent_ns):
    for mode, acceptable in (("Good", {"Medium", "High", "Very High", "Ultra High"}),
                             ("High", {"High", "Very High", "Ultra High"})):
        obj = make_inspire(agent_ns, use_cases_quality=mode, quality_filter_acceptable=acceptable,
                           user_business_domains=["Ops"])
        unscored_ops = make_uc("X1", domain="Ops", scoring_status="unscored", Quality="Unscored")
        unscored_label_high = make_uc("X2", scoring_status="unscored", Quality="High")
        ucs = [_scored("U1"), unscored_ops, unscored_label_high]
        final, rejected = obj._select_scored_use_cases(ucs, [], {})
        assert [u["No"] for u in final] == ["U1"], (mode, [u["No"] for u in final])
        assert {u["No"] for u in rejected} == {"X1", "X2"}


def test_bob_unscored_use_case_is_excluded(agent_ns):
    def fake_bob(use_cases, schema, **ctx):
        for i, uc in enumerate(use_cases):
            if i == 0:
                uc.update({"bob_status": "unscored", "bob_unscored_reason": "missing gates"})
            else:
                uc.update({"bob_status": "scored", "bob_score": 7.0, "bob_hard_veto_gate": None, "idea_theme": f"T{i}"})
        return use_cases

    obj = make_inspire(agent_ns)
    obj._score_best_of_best = fake_bob
    ucs = [_scored(f"U{i:02d}") for i in range(22)]
    final, _ = obj._select_scored_use_cases(ucs, [], {})
    assert "U00" not in {u["No"] for u in final if u["meets_quality_bar"] == "Y"} and len(final) == 22
    assert [u["No"] for u in final if u["meets_quality_bar"] == "N"] == ["U00"]
    assert any(e["stage"] == "bob_scoring" and e["drops"] == {"unscored": 1} for e in obj.funnel_ledger)


def test_K5_high_zero_at_bar_falls_back_to_medium_tier(agent_ns):
    obj = make_inspire(agent_ns, use_cases_quality="High",
                       quality_filter_acceptable={"High", "Very High", "Ultra High"})
    ucs = [_scored(f"U{i}", quality="Medium", inspire=6.0 + i / 10) for i in range(5)]
    final, rejected = obj._select_scored_use_cases(ucs, [], {})
    assert len(final) == 5
    assert all(u["elite_status"] == "FALLBACK_BELOW_BAR" and u["fallback_kind"] == "tier"
               and u["fallback_bar"] == "High" for u in final)
    assert [u["No"] for u in final][:2] == ["U4", "U3"]
    assert "below the High bar" in final[0]["fallback_reason"]
    assert rejected == []


def test_K5_balanced_small_portfolio_is_not_topped_up(agent_ns):
    obj = make_inspire(agent_ns)
    ucs = [_scored("U1", quality="High"), _scored("U2", quality="Medium"), _scored("U3", quality="Low", inspire=9.9)]
    final, _ = obj._select_scored_use_cases(ucs, [], {})
    assert [(u["No"], u["meets_quality_bar"]) for u in final] == [("U1", "Y"), ("U2", "Y"), ("U3", "N")]
    assert final[2]["fallback_reason"] == "scored Low, below the Good bar"


def test_K5_recovery_and_topup_code_removed_from_run():
    src = ast.unparse(method_node("DatabricksInspire", "run"))
    for token in ("FALLBACK RECOVERED", "Recovery Vetting", "MIN USE CASES TOP-UP", "target_min_use_cases",
                  "fallback_order", "min_use_cases_for_selection", "RuntimeError('Quality filter rejected"):
        assert token not in src, token
    assert "self._report_zero_accepted(" in src


def test_K5_high_zero_at_bar_fallback_ships_medium_and_records_outcome(agent_ns):
    obj = make_inspire(agent_ns, use_cases_quality="High",
                       quality_filter_acceptable={"High", "Very High", "Ultra High"})
    ucs = [_scored(f"U{i:02d}", quality="Medium", inspire=float(i)) for i in range(12)]
    ucs.append(make_uc("X", scoring_status="unscored", scoring_unscored_reason="timeout"))
    final, rejected = obj._select_scored_use_cases(ucs, [], {})
    assert len(final) == 12
    assert all(u["elite_status"] == "FALLBACK_BELOW_BAR" and u["fallback_bar"] == "High" for u in final)
    assert [u["No"] for u in final][:3] == ["U11", "U10", "U09"]
    assert "below the High bar" in final[0]["fallback_reason"]
    assert "X" in {u["No"] for u in rejected}
    assert all(u.get("elite_status") != "FALLBACK_BELOW_BAR" for u in rejected)
    out = obj.fallback_outcome
    assert out["accepted"] == 0 and out["fallback"] is True and out["fallback_kind"] == "tier"
    assert out["fallback_count"] == 12 and out["mode"] == "High"
    step = [s for s in obj.atomic_writer.steps if (s.get("result_json") or {}).get("fallback")][-1]
    assert step["status"] == "ended_warning"
    assert any(e["stage"] == "below_bar_kept" and e["out"] == 12 for e in obj.funnel_ledger)
    obj._publish_funnel_ledger()
    assert obj.final_inspire_results_json["selection_outcome"]["fallback"] is True
    assert obj.final_inspire_results_json["selection_outcome"]["accepted"] == 0


def test_good_zero_at_bar_fallback_returns_all_hard_gate_candidates_ranked(agent_ns):
    obj = make_inspire(agent_ns)
    ucs = [_scored("U1", quality="Low", inspire=5.0), _scored("U2", quality="Very Low", inspire=7.0),
           _scored("U3", quality="Low", inspire=6.0)]
    final, rejected = obj._select_scored_use_cases(ucs, [], {})
    assert [u["No"] for u in final] == ["U2", "U3", "U1"]
    assert all(u["elite_status"] == "FALLBACK_BELOW_BAR" and u["fallback_kind"] == "tier"
               and u["fallback_bar"] == "Good" for u in final)
    assert rejected == []
    assert obj.fallback_outcome["fallback_count"] == 3 and obj.fallback_outcome["mode"] == "Good"


def test_no_fallback_when_at_least_one_use_case_clears_the_bar(agent_ns):
    for mode, acceptable, pass_q in (("Good", {"Medium", "High", "Very High", "Ultra High"}, "Medium"),
                                     ("High", {"High", "Very High", "Ultra High"}, "High")):
        obj = make_inspire(agent_ns, use_cases_quality=mode, quality_filter_acceptable=acceptable)
        passing = _scored("P", quality=pass_q, inspire=8.0)
        weak = [_scored("W1", quality="Low", inspire=9.9), _scored("W2", quality="Very Low", inspire=9.8)]
        final, rejected = obj._select_scored_use_cases([passing] + weak, [], {})
        assert [(u["No"], u["meets_quality_bar"]) for u in final] == [("P", "Y"), ("W1", "N"), ("W2", "N")], mode
        assert final[0].get("elite_status") != "FALLBACK_BELOW_BAR", mode
        assert rejected == [], mode
        assert not any(e["stage"] == "zero_bar_fallback" for e in obj.funnel_ledger), mode
        assert getattr(obj, "fallback_outcome", None) is None, mode
        assert obj.quality_bar_outcome["meets"] == 1 and obj._quality_bar_warning() == "", mode


def test_coverage_pick_prevents_the_zero_bar_fallback(agent_ns):
    obj = make_inspire(agent_ns, use_cases_quality="High",
                       quality_filter_acceptable={"High", "Very High", "Ultra High"},
                       user_business_domains=["Ops"])
    ucs = [_scored("O1", quality="Medium", inspire=6.0, domain="Ops",
                   selection_drop_reason="quality 'Medium' is below the High bar"),
           _scored("O2", quality="Low", inspire=5.0, domain="Ops")]
    final, _ = obj._select_scored_use_cases(ucs, [], {})
    assert [(u["No"], u["elite_status"]) for u in final] == [("O1", "DOMAIN_COVERAGE_PICK"), ("O2", "FALLBACK_BELOW_BAR")]
    assert [u["meets_quality_bar"] for u in final] == ["N", "N"]
    assert not any(e["stage"] == "zero_bar_fallback" for e in obj.funnel_ledger)
    assert obj.fallback_outcome["fallback_count"] == 2


def test_fallback_picks_keep_their_real_scores_and_invent_nothing(agent_ns):
    obj = make_inspire(agent_ns, use_cases_quality="High",
                       quality_filter_acceptable={"High", "Very High", "Ultra High"})
    ucs = [_scored("U1", quality="Medium", inspire=6.1), _scored("U2", quality="Medium", inspire=5.2)]
    final, _ = obj._select_scored_use_cases(ucs, [], {})
    by = {u["No"]: u for u in final}
    assert by["U1"]["Inspire Score"] == 6.1 and by["U2"]["Inspire Score"] == 5.2
    assert all(u.get("elite_score") is None for u in final)


def test_true_zero_when_no_candidate_survives_still_reports_zero(agent_ns):
    obj = make_inspire(agent_ns, use_cases_quality="High",
                       quality_filter_acceptable={"High", "Very High", "Ultra High"})
    ucs = [make_uc("X", scoring_status="unscored", scoring_unscored_reason="timeout")]
    final, rejected = obj._select_scored_use_cases(ucs, [], {})
    assert final == []
    assert getattr(obj, "fallback_outcome", None) is None
    result = obj._report_zero_accepted(rejected)
    assert result["message"] == "0 use cases met the High bar" and result["accepted"] == 0
    obj._publish_funnel_ledger()
    assert obj.final_inspire_results_json["selection_outcome"]["accepted"] == 0


def test_coverage_pick_adds_best_scored_uc_for_empty_user_domain(agent_ns):
    obj = make_inspire(agent_ns, user_business_domains=["Sales", "Ops", "Finance"])
    selected = [_scored("S1", domain="Sales")]
    pool = [
        _scored("O1", quality="Low", inspire=5.0, domain="ops", selection_drop_reason="quality 'Low' is below the Good bar"),
        _scored("O2", quality="Low", inspire=6.5, domain="Ops", selection_drop_reason="quality 'Low' is below the Good bar"),
        _scored("O3", quality="High", inspire=9.0, domain="Ops", bob_hard_veto_gate="D2"),
        make_uc("F1", domain="Finance", scoring_status="unscored", Quality="Unscored"),
        _scored("S2", domain="Sales", inspire=9.9),
    ]
    out = obj._apply_domain_coverage_picks(selected, pool, obj.user_business_domains)
    assert [u["No"] for u in out] == ["S1", "O2"], "one pick per empty domain, best non-vetoed, unscored never picked"
    pick = out[1]
    assert pick["elite_status"] == "DOMAIN_COVERAGE_PICK"
    assert "below bar" in pick["coverage_pick_reason"] and "Low" in pick["coverage_pick_reason"]


def test_coverage_pick_vetoed_uc_only_when_no_alternative(agent_ns):
    obj = make_inspire(agent_ns)
    pool = [_scored("O3", domain="Ops", bob_hard_veto_gate="D2", inspire=9.0)]
    out = obj._apply_domain_coverage_picks([], pool, ["Ops"])
    assert [u["No"] for u in out] == ["O3"]


def test_coverage_pick_noop_without_user_domains(agent_ns):
    obj = make_inspire(agent_ns)
    selected = [_scored("S1")]
    assert obj._apply_domain_coverage_picks(selected, [_scored("O1", domain="Ops")], []) == selected


def test_coverage_pick_runs_in_selection_for_every_mode(agent_ns):
    for mode, acceptable in (("Good", {"Medium", "High", "Very High", "Ultra High"}),
                             ("High", {"High", "Very High", "Ultra High"})):
        obj = make_inspire(agent_ns, use_cases_quality=mode, quality_filter_acceptable=acceptable,
                           user_business_domains=["Ops"])
        ucs = [_scored("S1", domain="Sales"), _scored("O1", quality="Low", domain="Ops")]
        final, _ = obj._select_scored_use_cases(ucs, [], {})
        assert "Ops" in {u["Business Domain"] for u in final}, mode


def test_funnel_stage_log_format_and_ledger(agent_ns, caplog):
    obj = make_inspire(agent_ns)
    with caplog.at_level(logging.INFO, logger="v120_core"):
        entry = obj._log_funnel_stage("quality_filter", 10, 7, {"Low": 2, "Medium": 1, "High": 0})
    assert entry == {"stage": "quality_filter", "in": 10, "out": 7, "drops": {"Low": 2, "Medium": 1}}
    assert obj.funnel_ledger[-1] == entry
    assert '[FUNNEL] stage=quality_filter in=10 out=7 drops={"Low": 2, "Medium": 1}' in caplog.text


def test_funnel_ledger_published_into_final_results(agent_ns):
    obj = make_inspire(agent_ns, final_inspire_results_json={"domains": [1]})
    obj._log_funnel_stage("llm_dedup", 5, 4, {})
    ledger = obj._publish_funnel_ledger()
    assert obj.final_inspire_results_json["domains"] == [1]
    assert obj.final_inspire_results_json["funnel_ledger"] == ledger == [{"stage": "llm_dedup", "in": 5, "out": 4, "drops": {}}]
    assert obj.atomic_writer.steps[-1]["result_json"] == {"funnel_ledger": ledger}


def test_selection_records_every_stage_in_order(agent_ns):
    def fake_bob(use_cases, schema, **ctx):
        for i, uc in enumerate(use_cases):
            uc.update({"bob_status": "scored", "bob_score": 7.0, "idea_theme": f"T{i % 3}",
                       "bob_hard_veto_gate": "D9" if i == 1 else None})
        return use_cases

    obj = make_inspire(agent_ns)
    obj._score_best_of_best = fake_bob
    ucs = [_scored(f"U{i:02d}") for i in range(24)] + [_scored("L1", quality="Low")]
    ucs[4]["Name"] = "Predict demand U03"
    obj._select_scored_use_cases(ucs, [], {})
    stages = [e["stage"] for e in obj.funnel_ledger]
    assert stages == ["combined_scoring", "quality_filter", "bob_scoring", "bob_hard_veto",
                      "canonical_title_dedup", "domain_coverage_picks", "final_guard", "below_bar_kept"]
    by = {e["stage"]: e for e in obj.funnel_ledger}
    assert by["quality_filter"]["drops"] == {"Low": 1}
    assert by["bob_hard_veto"]["drops"] == {"D9": 1}
    assert by["canonical_title_dedup"]["drops"] == {"duplicate_decision": 1}
    assert by["final_guard"]["out"] == 22


def test_run_logs_funnel_stages():
    src = ast.unparse(method_node("DatabricksInspire", "run"))
    for stage in ("table_reference_filter", "goal_alignment", "coverage_catchall", "goal_alignment_post_catchall",
                  "domain_clustering", "llm_dedup", "phase_g_gates", "phase_q_gates"):
        assert f"'{stage}'" in src, stage
    assert "'value_scoring'" not in src
    assert "self._publish_funnel_ledger()" in src


# ---------------------------------------------------------------- K1 / K2 wiring in run()


def _call_nodes(func_node, attr):
    return [n for n in ast.walk(func_node) if isinstance(n, ast.Call)
            and isinstance(n.func, ast.Attribute) and n.func.attr == attr]


def test_K1_scoring_runs_on_post_gate_list():
    run = method_node("DatabricksInspire", "run")
    calls = _call_nodes(run, "_score_combined_value_and_quality")
    assert calls
    for call in calls:
        kw = {k.arg: k.value for k in call.keywords}
        assert isinstance(kw.get("use_cases"), ast.Name) and kw["use_cases"].id == "final_consolidated_use_cases"
    src = ast.unparse(run)
    after_gates = src[src.index("_phaseQ_run_integrity_gates("):]
    assert "renumbered_use_cases" not in after_gates, "no stale pre-gate alias may be used after the gates"
    assert "_scored_cache_tag(" in src
    assert "final_consolidated_use_cases, scoring_context, _schema_for_quality" in src


def test_K2_no_shadowed_or_emptied_context_in_run():
    run = method_node("DatabricksInspire", "run")
    src = ast.unparse(run)
    assert "in locals()" not in src
    for name in ("business_context", "business_priorities", "strategic_initiative", "value_chain", "revenue_model", "industry"):
        assigned = [n for n in ast.walk(run) if isinstance(n, ast.Assign)
                    and any(isinstance(t, ast.Name) and t.id == name for t in n.targets)]
        assert not assigned, f"run() must not shadow '{name}' with a local"
    flt = _call_nodes(run, "_filter_business_tables")[0]
    kw = {k.arg: ast.unparse(k.value) for k in flt.keywords}
    assert kw["business_context"] == "ctx_business_context" and kw["industry"] == "ctx_industry"
    gen_calls = _call_nodes(run, "_process_batch_with_retry")
    assert len(gen_calls) == 2
    for call in gen_calls:
        kw = {k.arg: ast.unparse(k.value) for k in call.keywords}
        assert kw["business_context"] == "ctx_business_context"
        assert "business_priorities" not in kw and "strategic_goals" not in kw
        assert kw["strategic_initiative"] == "ctx_strategic_initiative"
        assert kw["value_chain"] == "ctx_value_chain"
        assert kw["revenue_model"] == "ctx_revenue_model"
        assert kw["industry"] == "ctx_industry"


def test_K2_merged_context_carries_industry(agent_ns):
    obj = make_inspire(agent_ns)
    merged = obj._merge_business_contexts({"business_context": "A regional bakery chain.\nMore detail."}, "")
    assert merged["industry"] == "A regional bakery chain."
    merged2 = obj._merge_business_contexts({"business_context": "x", "industry": "Retail"}, "Sales, Ops")
    assert merged2["industry"] == "Retail"


def test_D204_no_undefined_names_anywhere_in_agent(agent_ns):
    src = agent_source()
    top = symtable.symtable(src, "<agent>", "exec")
    problems = []

    def walk(table, path):
        for child in table.get_children():
            p = path + [child.get_name()]
            if child.get_type() == "function":
                for sym in child.get_symbols():
                    name = sym.get_name()
                    if (sym.is_referenced() and sym.is_global() and not sym.is_declared_global()
                            and name not in agent_ns and not hasattr(builtins, name)):
                        problems.append((".".join(p), name))
            walk(child, p)

    walk(top, [])
    assert problems == [], problems


# ---------------------------------------------------------------- generation retries (G-01/G-07/G-08/G-18) and K2 prompt vars


def _gen_harness(agent_ns, responses):
    state = {"i": 0}

    def responder(prompt_name, prompt_vars, skip_cache):
        r = responses[min(state["i"], len(responses) - 1)]
        state["i"] += 1
        return r

    obj = make_inspire(agent_ns, responder,
                       table_id_map={}, id_table_map={}, column_id_map={}, id_column_map={},
                       next_table_id=1, next_column_id=1, user_strategic_goals=[],
                       data_loader=None, data_category_map={"c.s.orders": "TRANSACTIONAL", "c.s.region": "REFERENCE"},
                       global_table_names={"c.s.orders", "c.s.region"},
                       _known_hallucinated_tables=set(), processing_honesty={"total_batch_splits": 0, "batch_split_history": []})
    obj._format_schema_for_prompt = lambda cols: "| table | col |\n" + "\n".join(f"| {c[2]} | {c[3]} |" for c in cols)
    obj._estimate_schema_markdown_size = lambda cols: 100
    obj._business_column_details_global = [("c", "s", "orders", "id", "bigint", ""), ("c", "s", "region", "r", "string", "")]
    return obj


HEADER = '"No","Name","usecase","type","Analytics Technique","Statement","Solution","Business Value","Beneficiary","Sponsor","Tables Involved","High Level Design"'


def _gen_row(no, tables):
    return f'"{no}","Forecast orders {no}","Forecast orders","AI","Forecasting","Orders drop","Model","Value","Ops","COO","{tables}","Aggregate"'


def test_G01_generation_retry_bypasses_cache(agent_ns):
    obj = _gen_harness(agent_ns, ["", HEADER + "\n" + _gen_row("N1-1", "c.s.orders")])
    cols = [("c", "s", "orders", "id", "bigint", "")]
    out = obj._process_batch_with_retry(cols, 1, max_attempts=3)
    assert len(out) == 1
    assert [c["skip_cache"] for c in obj.ai_agent.calls] == [False, True]


def test_a_table_the_batch_sent_is_never_a_hallucination_even_when_the_run_registry_lacks_it(agent_ns):
    obj = _gen_harness(agent_ns, [HEADER + "\n" + _gen_row("N1-1", "c.s.orders, c.s.income_band")])
    obj._business_column_details_global = [("c", "s", "orders", "id", "bigint", "")]
    obj.global_table_names = {"c.s.orders"}
    obj.data_category_map = dict(obj.data_category_map, **{"c.s.income_band": "REFERENCE"})
    cols = [("c", "s", "orders", "id", "bigint", ""), ("c", "s", "income_band", "ib_income_band_sk", "int", "")]
    out = obj._process_batch_with_retry(cols, 1, max_attempts=1)
    assert [r["Tables Involved"] for r in out] == ["c.s.orders, c.s.income_band"]
    invented = _gen_harness(agent_ns, [HEADER + "\n" + _gen_row("N1-2", "c.s.orders, c.s.invented_table")])
    assert invented._process_batch_with_retry(cols, 1, max_attempts=1) == [], "a table nobody sent is still a hallucination"


def test_the_runs_known_business_universe_includes_its_reference_tables(agent_ns):
    obj = _gen_harness(agent_ns, [])
    obj._reference_details_last = [("c", "s", "income_band", "ib_income_band_sk", "int", "")]
    obj._set_known_business_universe([("c", "s", "orders", "id", "bigint", "")])
    assert obj.global_table_names == {"c.s.orders", "c.s.income_band"}
    assert [d[2] for d in obj._business_column_details_global] == ["orders", "income_band"]
    obj._reference_details_last = None
    obj._set_known_business_universe([("c", "s", "orders", "id", "bigint", "")])
    assert obj.global_table_names == {"c.s.orders"}


def test_G08_reference_only_rejection_retries_with_feedback_and_fresh_call(agent_ns):
    obj = _gen_harness(agent_ns, [HEADER + "\n" + _gen_row("N1-1", "c.s.region"),
                                  HEADER + "\n" + _gen_row("N1-2", "c.s.orders")])
    cols = [("c", "s", "orders", "id", "bigint", ""), ("c", "s", "region", "r", "string", "")]
    out = obj._process_batch_with_retry(cols, 1, max_attempts=3)
    assert [r["Tables Involved"] for r in out] == ["c.s.orders"]
    second = obj.ai_agent.calls[1]
    assert second["skip_cache"] is True
    assert "REFERENCE tables" in second["vars"]["additional_context_section"]
    assert second["vars"]["additional_context_section"] != obj.ai_agent.calls[0]["vars"]["additional_context_section"]


def test_K2_generation_prompt_receives_full_context(agent_ns):
    obj = _gen_harness(agent_ns, [HEADER + "\n" + _gen_row("N1-1", "c.s.orders")])
    cols = [("c", "s", "orders", "id", "bigint", "")]
    obj._process_batch_with_retry(cols, 1, business_context="Bakery chain",
                                  strategic_initiative="SI", value_chain="VC", revenue_model="RM", industry="Food retail")
    pv = obj.ai_agent.calls[0]["vars"]
    assert pv["business_context"] == "Bakery chain"
    assert "business_priorities" not in pv and "strategic_goals" not in pv
    assert pv["strategic_initiative"] == "SI" and pv["value_chain"] == "VC" and pv["revenue_model"] == "RM"
    assert pv["industry"] == "Food retail"


def test_K2_generation_signature_takes_no_strategy(agent_ns):
    node = method_node("DatabricksInspire", "_process_batch_with_retry")
    assert not {"business_priorities", "strategic_goals"} & {a.arg for a in node.args.args}
    obj = _gen_harness(agent_ns, [HEADER + "\n" + _gen_row("N1-1", "c.s.orders")])
    with pytest.raises(TypeError):
        obj._process_batch_with_retry([("c", "s", "orders", "id", "bigint", "")], 1, business_priorities="Increase Revenue")


def test_G07_dead_document_context_argument_removed():
    import inspect  # noqa: F401
    node = method_node("DatabricksInspire", "_process_batch_with_retry")
    assert "document_context_markdown" not in [a.arg for a in node.args.args]
    node2 = method_node("DatabricksInspire", "_retry_missing_table_coverage")
    assert "document_context_markdown" not in [a.arg for a in node2.args.args]


def test_G18_noop_subdomain_check_removed_and_was_unreachable(agent_ns):
    assert "_validate_subdomain_rules" not in agent_source()
    obj = make_inspire(agent_ns)
    rows = obj._parse_llm_csv_response(HEADER + "\n" + _gen_row("N1-1", "c.s.orders"), "[t]")
    assert rows and rows[0]["Business Domain"] == "" and rows[0]["Subdomain"] == "", \
        "domains are assigned later, so a subdomain rule check at generation could never fire"


def test_pending_sub_batch_shared_state_removed():
    src = agent_source()
    assert "_pending_sub_batch_results" not in src and "_collect_pending_results" not in src


def test_retry_sites_pass_skip_cache():
    for method in ("_process_batch_with_retry", "_score_combined_value_and_quality", "_score_best_of_best",
                   "_filter_use_cases_by_goal_alignment"):
        node = method_node("DatabricksInspire", method)
        calls = _call_nodes(node, "run_worker")
        assert calls, method
        for call in calls:
            assert "skip_cache" in {k.arg for k in call.keywords}, method
    node = method_node("DatabricksInspire", "_assign_to_user_domains")
    for call in _call_nodes(node, "_call_ai_query"):
        assert "skip_cache" in {k.arg for k in call.keywords}


# ---------------------------------------------------------------- F-11 / F-17 / catch-all context


def test_F11_coverage_is_case_and_backtick_insensitive(agent_ns):
    obj = make_inspire(agent_ns, data_category_map={}, business_scores={"c.s.Orders": 90})
    captured = []
    obj._process_batch_with_retry = lambda *a, **kw: captured.append((a, kw)) or []
    cols = [("c", "s", "Orders", "id", "bigint", "")]
    ucs = [make_uc("U1", **{"Tables Involved": "`C`.`S`.`orders`"})]
    assert obj._retry_missing_table_coverage(ucs, cols, include_business_catchall=True) == []
    assert captured == [], "a table cited with different case/backticks is covered"


def test_F11_missing_table_still_detected_and_context_passed_as_list(agent_ns):
    obj = make_inspire(agent_ns, data_category_map={}, business_scores={},
                       merged_business_context={"business_context": "B", "business_priorities": ["Increase Revenue"],
                                                "strategic_initiative": "S", "value_chain": "V", "revenue_model": "R",
                                                "industry": "I"})
    captured = []
    obj._process_batch_with_retry = lambda *a, **kw: captured.append((a, kw)) or []
    cols = [("c", "s", "orders", "id", "bigint", ""), ("c", "s", "items", "id", "bigint", "")]
    ucs = [make_uc("U1", **{"Tables Involved": "c.s.orders"})]
    obj._retry_missing_table_coverage(ucs, cols)
    assert len(captured) == 1
    args, kw = captured[0]
    assert {c[2] for c in args[0]} == {"items"}
    assert "business_priorities" not in kw and "strategic_goals" not in kw
    assert kw["industry"] == "I" and kw["business_context"] == "B" and kw["strategic_initiative"] == "S"


def test_F17_repair_only_uses_known_tables(agent_ns):
    obj = make_inspire(agent_ns, global_table_names={"cat.sch.orders"})
    row = {"Tables Involved": "SELECT x FROM cat.sch.orders JOIN cat.sch.ghost", "High Level Design": "cat.sch.orders"}
    assert obj._repair_tables_involved(row["Tables Involved"], row, "[t]") == "cat.sch.orders"
    obj.global_table_names = set()
    assert obj._repair_tables_involved(row["Tables Involved"], row, "[t]") == row["Tables Involved"]


# ---------------------------------------------------------------- D2-12 / D2-21 goal filter


def _goal_obj(agent_ns, responder):
    return make_inspire(agent_ns, responder, parsed_generation_instructions={
        "goal_setting": {"has_goal": True, "goal_description": "Reduce fraud losses"}})


def _goal_ids(prompt_vars):
    return re.findall(r"^\| (\S+) \|", prompt_vars["use_cases_table"], re.M)[1:]


def test_D212_unknown_verdict_retried_then_dropped(agent_ns):
    def responder(prompt_name, prompt_vars, skip_cache):
        lines = []
        for i in _goal_ids(prompt_vars):
            if i == "U1":
                lines.append(f"{i},YES")
            elif i == "U2":
                lines.append(f"{i},NO")
            elif i == "U3":
                lines.append(f"{i},MAYBE")
            elif i == "U4" and skip_cache:
                lines.append(f"{i},YES")
        return "\n".join(lines)

    obj = _goal_obj(agent_ns, responder)
    out = obj._filter_use_cases_by_goal_alignment([make_uc(f"U{i}") for i in range(1, 5)])
    assert [u["No"] for u in out] == ["U1", "U4"]
    assert any(c["skip_cache"] for c in obj.ai_agent.calls)
    entry = obj.funnel_ledger[-1]
    assert entry["stage"] == "goal_alignment" and entry["drops"] == {"not_aligned": 1, "goal_unverified": 1}


def test_D212_verdict_parser_tolerates_table_and_colon_formats(agent_ns):
    def responder(prompt_name, prompt_vars, skip_cache):
        ids = _goal_ids(prompt_vars)
        return "\n".join([f"| {ids[0]} | YES |", f"{ids[1]}: NO", f"`{ids[2]}`, yes", "ID,Aligned"])

    obj = _goal_obj(agent_ns, responder)
    out = obj._filter_use_cases_by_goal_alignment([make_uc("U1"), make_uc("U2"), make_uc("U3")])
    assert [u["No"] for u in out] == ["U1", "U3"]
    assert obj.funnel_ledger[-1]["drops"] == {"not_aligned": 1}


def test_D212_all_rejected_is_not_reverted_to_keep_all(agent_ns):
    obj = _goal_obj(agent_ns, lambda n, pv, s: "\n".join(f"{i},NO" for i in _goal_ids(pv)))
    assert obj._filter_use_cases_by_goal_alignment([make_uc("U1"), make_uc("U2")]) == []


def test_D212_empty_response_is_not_treated_as_aligned(agent_ns):
    obj = _goal_obj(agent_ns, lambda n, pv, s: "")
    assert obj._filter_use_cases_by_goal_alignment([make_uc("U1")]) == []


def test_D212_no_goal_is_a_logged_noop(agent_ns):
    obj = make_inspire(agent_ns)
    ucs = [make_uc("U1")]
    assert obj._filter_use_cases_by_goal_alignment(ucs, stage="goal_alignment_post_catchall") is ucs
    assert obj.funnel_ledger[-1] == {"stage": "goal_alignment_post_catchall", "in": 1, "out": 1, "drops": {}}
    assert obj.ai_agent.calls == []


def test_D221_goal_filter_has_no_shared_state_threads():
    src = ast.unparse(method_node("DatabricksInspire", "_filter_use_cases_by_goal_alignment"))
    assert "ThreadPoolExecutor" not in src and "as_completed" not in src
    assert "aligned_ids.add" not in src and "not_aligned_ids.add" not in src


# ---------------------------------------------------------------- D2-16 user domains


def _domain_obj(agent_ns, responder):
    obj = make_inspire(agent_ns, responder, max_retry_attempts=1, industries=[])

    def detect(name, ucs, lang, timeout_seconds_override=None):
        for u in ucs:
            u["Subdomain"] = f"{name} sub"
        return ucs

    obj._detect_subdomains_for_domain = detect
    obj._merge_duplicate_subdomains = lambda ucs: ucs
    obj._rename_placeholder_domains_from_subdomains = lambda ucs: ucs
    obj._assign_default_subdomains = lambda ucs, name: [u.update(Subdomain=f"General {name}") or u for u in ucs]
    return obj


def _assign_ids(prompt_vars):
    text = prompt_vars.get("prompt_text") or prompt_vars.get("use_cases_csv", "")
    return re.findall(r"^(U\d+),", text, re.M)


def test_D216_invalid_domain_retried_never_dumped_into_first_domain(agent_ns):
    def responder(prompt_name, prompt_vars, skip_cache):
        rows = ["use_case_id,domain"]
        for i in _assign_ids(prompt_vars):
            if prompt_name == "DOMAIN_FINDER_PROMPT":
                rows.append(f"{i},Marketing")
            elif i == "U1":
                rows.append(f"{i},sales")
            elif i == "U2":
                rows.append(f"{i},Marketing")
            elif i == "U3" and skip_cache:
                rows.append(f"{i},Ops")
        return "\n".join(rows)

    obj = _domain_obj(agent_ns, responder)
    ucs = [make_uc("U1", domain=""), make_uc("U2", domain=""), make_uc("U3", domain="")]
    out = obj._assign_to_user_domains(ucs, ["Sales", "Ops"], "English")
    by = {u["No"]: u["Business Domain"] for u in out}
    assert by == {"U1": "Sales", "U2": "Marketing", "U3": "Ops"}, by
    assert any(c["skip_cache"] for c in obj.ai_agent.calls)
    repair = [c for c in obj.ai_agent.calls if c["prompt"] == "DOMAIN_FINDER_PROMPT"]
    assert len(repair) == 1 and repair[0]["skip_cache"] is True
    assert obj.funnel_ledger[-1] == {"stage": "user_domain_assignment", "in": 3, "out": 3, "drops": {}}


def test_D216_llm_failure_does_not_round_robin(agent_ns):
    def responder(prompt_name, prompt_vars, skip_cache):
        raise RuntimeError("down")

    obj = _domain_obj(agent_ns, responder)
    out = obj._assign_to_user_domains([make_uc("U1", domain=""), make_uc("U2", domain="")], ["Sales", "Ops"], "English")
    assert sorted(u["No"] for u in out) == ["U1", "U2"]
    assert len({u["Business Domain"] for u in out}) == 1
    assert not {u["Business Domain"] for u in out} & {"Sales", "Ops"}
    assert all("domain:placeholder" in u["clustering_fallback"] for u in out)


def test_D216_subdomain_timeout_keeps_use_cases(fresh_ns):
    import concurrent.futures as cf

    def responder(prompt_name, prompt_vars, skip_cache):
        return "use_case_id,domain\n" + "\n".join(f"{i},{'Sales' if i == 'U1' else 'Ops'}" for i in _assign_ids(prompt_vars))

    def instant_timeout(futures, timeout=None, **kwargs):
        raise cf.TimeoutError("forced")
        yield

    fresh_ns["safe_as_completed"] = instant_timeout
    obj = _domain_obj(fresh_ns, responder)
    out = obj._assign_to_user_domains([make_uc("U1", domain=""), make_uc("U2", domain="")], ["Sales", "Ops"], "English")
    assert sorted(u["No"] for u in out) == ["U1", "U2"]
    assert {u["No"]: u["Subdomain"] for u in out} == {"U1": "General Sales", "U2": "General Ops"}


# ---------------------------------------------------------------- D2-20 live log / D2-22 language pack


class FakeWorkspace:
    def __init__(self):
        self.imports = []

    def import_(self, path, content, format, overwrite):
        self.imports.append((path, content))


def test_D220_volume_flush_rewrites_the_whole_snapshot_and_skips_unchanged(agent_ns, tmp_path):
    obj = make_inspire(agent_ns)
    src = tmp_path / "log.txt"
    dst = tmp_path / "live.log"
    state = {}
    src.write_bytes(b"line1\n")
    assert obj._flush_live_log_once(str(src), str(dst), "volume", state) == "rewritten"
    assert obj._flush_live_log_once(str(src), str(dst), "volume", state) == "unchanged"
    with open(src, "ab") as f:
        f.write(b"line2\n")
    assert obj._flush_live_log_once(str(src), str(dst), "volume", state) == "rewritten"
    assert dst.read_bytes() == b"line1\nline2\n"
    src.write_bytes(b"new\n")
    assert obj._flush_live_log_once(str(src), str(dst), "volume", state) == "rewritten"
    assert dst.read_bytes() == b"new\n"


def test_D220_workspace_flush_skips_unchanged(fresh_ns, tmp_path):
    import types as _types
    fresh_ns["workspace"] = _types.SimpleNamespace(ImportFormat=_types.SimpleNamespace(AUTO="AUTO"))
    obj = make_inspire(fresh_ns)
    obj.w_client = type("W", (), {})()
    obj.w_client.workspace = FakeWorkspace()
    src = tmp_path / "log.txt"
    src.write_bytes(b"a\n")
    state = {}
    obj._flush_live_log_once(str(src), "/Workspace/x/log.log", "workspace", state)
    obj._flush_live_log_once(str(src), "/Workspace/x/log.log", "workspace", state)
    assert len(obj.w_client.workspace.imports) == 1


def test_D222_language_pack_failure_returns_none_tuple(agent_ns):
    obj = make_inspire(agent_ns)

    def broken(lang):
        raise RuntimeError("set_language failed")

    obj.ai_agent.set_language = broken
    out = obj._translate_and_prepare_language_pack("French", [], {}, "Acme")
    assert out[0] == "French" and out[2] is None


# ---------------------------------------------------------------- class sweeps after the first fixes


def test_K4_dead_global_value_scorer_with_defaults_removed(agent_ns):
    assert not hasattr(agent_ns["DatabricksInspire"], "_score_use_cases_global")


def test_K2_business_context_extraction_retries_without_cache(agent_ns):
    answers = ["not json at all", json.dumps({"business_context": "A bakery chain", "value_chain": "bake, sell"})]

    def responder(prompt_name, prompt_vars, skip_cache):
        return answers.pop(0)

    obj = make_inspire(agent_ns, responder)
    ctx = obj._get_business_context_from_llm()
    assert ctx["business_context"].startswith("[ASSUMPTION inferred from the business name")
    assert ctx["business_context"].endswith("] A bakery chain")
    assert [c["skip_cache"] for c in obj.ai_agent.calls] == [False, True]


def test_K2_business_context_valid_first_answer_is_one_call(agent_ns):
    obj = make_inspire(agent_ns, lambda n, pv, s: json.dumps({"business_context": "x"}))
    ctx = obj._get_business_context_from_llm()
    assert sorted(ctx) == ["business_context", "revenue_model", "strategic_initiative"]
    assert ctx["business_context"].endswith("] x")
    assert ctx["revenue_model"] == ctx["strategic_initiative"] == "UNKNOWN_FROM_METADATA"
    assert len(obj.ai_agent.calls) == 1


def test_A8_run_executors_are_cancellable():
    src = ast.unparse(method_node("DatabricksInspire", "run"))
    assert "ThreadPoolExecutor(" not in src, "run() must not create executors that ignore cancellation"
    assert "_SafeExecutorContext(max_workers=2, thread_name_prefix='CtxInit'" in src
    assert "_SafeExecutorContext(max_workers=1, thread_name_prefix='DocGen'" in src
    assert "doc_generation_executor.mark_timed_out()" in src


def test_D221_processing_honesty_mutations_are_locked():
    node = method_node("DatabricksInspire", "_process_batch_with_retry")
    for target in ("'total_batch_splits'", "'tables_with_columns_dropped'"):
        guarded = False
        for w in ast.walk(node):
            if isinstance(w, ast.With) and "registry_lock" in ast.unparse(w.items[0].context_expr):
                if target in "\n".join(ast.unparse(b) for b in w.body):
                    guarded = True
        assert guarded, target


# ---------------------------------------------------------------- prompt call-site contract


def _template_fields(template):
    names = {f.split(".")[0].split("[")[0] for _, f, _, _ in string.Formatter().parse(template) if f}
    return {n for n in names if re.fullmatch(r"[A-Za-z_]\w*", n)}


def _drive_bob(agent_ns):
    obj = make_inspire(agent_ns, lambda n, pv, s: json.dumps([bob_rec(i) for i in ids_in(pv["use_cases_to_validate"])]))
    obj._score_best_of_best([make_uc("U1")], [("c", "s", "orders", "id", "bigint", "")], business_context="B", industry="I")
    return obj


def _drive_combined(agent_ns):
    obj = make_inspire(agent_ns, combined_responder(lambda ids, skip: [combined_rec(i) for i in ids]))
    obj._score_combined_value_and_quality([make_uc("U1")], [("c", "s", "orders", "id", "bigint", "")])
    return obj


def _drive_goal(agent_ns):
    obj = _goal_obj(agent_ns, lambda n, pv, s: "\n".join(f"{i},YES" for i in _goal_ids(pv)))
    obj._filter_use_cases_by_goal_alignment([make_uc("U1")])
    return obj


def _drive_generation(agent_ns):
    obj = _gen_harness(agent_ns, [HEADER + "\n" + _gen_row("N1-1", "c.s.orders")])
    obj._process_batch_with_retry([("c", "s", "orders", "id", "bigint", "")], 1)
    return obj


@pytest.mark.parametrize("drive", [_drive_bob, _drive_combined, _drive_goal, _drive_generation],
                         ids=["bob", "combined", "goal_alignment", "generation"])
def test_prompt_call_sites_supply_every_template_placeholder(agent_ns, drive):
    obj = drive(agent_ns)
    templates = agent_ns["PROMPT_TEMPLATES"]
    calls = [c for c in obj.ai_agent.calls if c.get("prompt") in templates]
    assert calls
    for call in calls:
        missing = _template_fields(templates[call["prompt"]]) - set(call["vars"])
        assert missing == set(), (call["prompt"], missing)


def test_prompt_contract_check_flags_a_missing_placeholder():
    assert _template_fields("score {use_cases_to_validate} for {industry} {{literal}} {\"json\": 1}") == {
        "use_cases_to_validate", "industry"}
    assert _template_fields("x {schema_details}") - {"use_cases_to_validate"} == {"schema_details"}
