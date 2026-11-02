"""v1.2.0 ELITE lane: the Ultra High elite stage end to end at the selection level.

`_select_scored_use_cases` in Ultra High runs the candidate pool (High+ plus a bounded second
look), Best-of-Best on every candidate with a prescreen, the elite judge in batches with split
retries, deterministic verification, the absolute bar with an independent second opinion for near
misses, overlap dedup that keeps the stronger twin, user-domain coverage picks and the zero-elite
outcome. The real Best-of-Best scorer, judge parser and retry machinery run; only the LLM answers
are scripted.
"""
import copy
import json
import logging
import os
import re
import sys
import threading

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import load_agent_namespace  # noqa: E402
from v120_elite_verification_test import EVIDENCE  # noqa: E402


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()

JUDGE = "ULTRA_HIGH_ELITE_JUDGE_PROMPT"
BOB = "BEST_OF_BEST_SCORING_PROMPT"
DIMS = ("business_value", "evidence_strength", "implementability", "actionability")
CONTEXT = {"business_context": "A multi-region operator", "industry": "General", "strategic_goals": ["Reduce Cost"],
           "business_priorities": ["Grow repeat orders"], "strategic_initiative": "Customer analytics",
           "value_chain": "Order to delivery", "revenue_model": "Order revenue"}


def ids(text):
    return re.findall(r"### Use Case: (\S+) - ", text or "")


class Agent:
    def __init__(self):
        self.calls = []
        self.lock = threading.Lock()
        self.prompt_templates = {}
        self.bob = {}
        self.judge = {}
        self.second = {}
        self.dedup_keep = None
        self.fail_judge_once = set()
        self.bob_skip = set()

    def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema=None, model_override=None,
                   timeout_override=None, max_retries_override=None, start_from_model=None, skip_cache=False,
                   temperature_override=None):
        with self.lock:
            self.calls.append({"prompt": worker_prompt_path, "vars": dict(prompt_vars), "skip_cache": skip_cache,
                               "start_from_model": start_from_model, "model_override": model_override,
                               "step": step_name})
        if worker_prompt_path == BOB:
            out = []
            for uc_id in ids(prompt_vars["use_cases_to_validate"]):
                if uc_id in self.bob_skip:
                    continue
                gates = self.bob.get(uc_id, 8)
                gates = gates if isinstance(gates, dict) else {f"D{i}": gates for i in range(1, 20)}
                out.append({"No": uc_id, "bob_scores": gates, "idea_theme": "Theme", "bob_justification_short": "ok"})
            return json.dumps(out)
        if worker_prompt_path == JUDGE:
            table = self.second if "SecondOpinion" in str(step_name) else self.judge
            out = []
            for uc_id in ids(prompt_vars["use_cases_to_judge"]):
                with self.lock:
                    if uc_id in self.fail_judge_once and not skip_cache:
                        continue
                item = table.get(uc_id)
                if item is not None:
                    out.append(dict(item, No=uc_id))
            return json.dumps(out)
        if worker_prompt_path == "REVIEW_USE_CASES_PROMPT":
            seen = re.findall(r"^\| (\S+) \|", prompt_vars["use_case_markdown"], re.MULTILINE)
            keep = [i for i in seen if i not in ("ID", "---") and (self.dedup_keep is None or i in self.dedup_keep)]
            return "use_case_id,honesty_score,honesty_justification\n" + "\n".join(f"{i},90,keep" for i in keep)
        raise AssertionError(f"unexpected prompt {worker_prompt_path}")

    def prompts(self, name):
        return [c for c in self.calls if c["prompt"] == name]


class Storage:
    def __init__(self):
        self.md = None

    def load_schema_markdown(self, tag="schema_markdown"):
        return self.md

    def save_schema_markdown(self, markdown, tag="schema_markdown"):
        self.md = markdown

    def load_schema_details(self, name="all_columns_for_sql"):
        return []


class Writer:
    def __init__(self):
        self.steps = []

    def emit_step(self, **kw):
        self.steps.append(kw)
        return len(self.steps)


class Loader:
    def __init__(self, evidence=None, fail=False):
        self.evidence = copy.deepcopy(EVIDENCE if evidence is None else evidence)
        self.fail = fail
        self.requests = []
        self.foreign_key_graph = {}

    def get_metadata_evidence(self, tables):
        self.requests.append(list(tables))
        if self.fail:
            raise RuntimeError("information_schema unavailable")
        return {t: copy.deepcopy(self.evidence[t]) for t in tables if t in self.evidence}

    def get_table_comment(self, catalog, schema, table):
        return (self.evidence.get(f"{catalog}.{schema}.{table}") or {}).get("comment") or ""

    def get_primary_key(self, catalog, schema, table):
        return list((self.evidence.get(f"{catalog}.{schema}.{table}") or {}).get("primary_key") or [])

    def get_table_relations(self, catalog, schema, table):
        return []

    def get_sampling_info(self, catalog, schema, table):
        return None


SCHEMA = [("c", "s", t, c["name"], c["type"], c["comment"]) for t in ("orders", "customers")
          for c in EVIDENCE[f"c.s.{t}"]["columns"].values()]


def inspire(ns, user_domains=None, loader=None):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = logging.getLogger("v120_elite_selection")
    obj.use_cases_quality = "Ultra High"
    obj.quality_filter_acceptable = {"High", "Very High", "Ultra High"}
    obj.user_business_domains = list(user_domains or [])
    obj.funnel_ledger = []
    obj.final_inspire_results_json = {}
    obj.atomic_writer = Writer()
    obj.ai_agent = Agent()
    obj.storage_manager = Storage()
    obj.data_loader = loader or Loader()
    obj.llm_timeout_seconds = 30
    obj.parsed_generation_instructions = {}
    obj.merged_business_context = {}
    obj.business_name = "Acme"
    obj.session_id = 7
    obj.max_parallelism = 4
    obj.registry_lock = threading.Lock()
    obj._find_join_path = lambda tables: {"connected": True, "path": ["c.s.orders.customer_id -> c.s.customers.customer_id"],
                                          "strength": "declared"}
    return obj


def make_uc(no, quality="High", value=4.0, inspire_score=7.0, domain="", name=None, tables="c.s.orders, c.s.customers",
            **extra):
    uc = {"No": no, "Name": name or f"Forecast weekly customer orders {no}", "type": "AI", "Analytics Technique": "Forecasting",
          "Statement": f"Statement {no}", "Solution": "Model weekly orders", "Business Value": "Value",
          "Tables Involved": tables, "High Level Design": "Aggregate and forecast", "Beneficiary": "Ops",
          "Sponsor": "COO", "Business Domain": domain, "Quality": quality, "Value": value,
          "Inspire Score": inspire_score, "Priority": 7.0, "scoring_status": "scored"}
    uc.update(extra)
    return uc


def assessment(**over):
    a = {"decision": "Which customers get a weekly call", "decision_owner": "Retention lead", "cadence": "weekly",
         "kpi": "Repeat order rate", "kpi_direction": "increase",
         "value_driver": "Falling `c.s.orders.amount` per `c.s.customers.customer_id` triggers the call",
         "value_tier": "Material", "signal_columns": ["c.s.orders.amount", "c.s.orders.ordered_at"],
         "outcome_definition": None, "time_column": "c.s.orders.ordered_at",
         "entity_key_column": "c.s.customers.customer_id",
         "join_path": ["c.s.orders.customer_id = c.s.customers.customer_id"], "build_path": "SQL plus MLflow",
         "blockers": [], "runtime_assumptions": [], "fatal_flaws": [], "red_team": "Late order capture",
         "red_team_category": "RESIDUAL_RISK",
         "scores": {"business_value": 9, "evidence_strength": 8, "implementability": 8, "actionability": 9},
         "verdict": "ELITE", "verdict_reason": "Grounded weekly decision"}
    scores = over.pop("scores", None)
    a.update(over)
    if scores:
        a["scores"] = dict(a["scores"], **scores)
    return a


def select(obj, ucs):
    return obj._select_scored_use_cases(ucs, SCHEMA, dict(CONTEXT))


def stages(obj):
    return [e["stage"] for e in obj.funnel_ledger]


def ledger(obj, stage):
    return [e for e in obj.funnel_ledger if e["stage"] == stage][-1]


# ---------------------------------------------------------------- candidate pool


def test_candidate_pool_rules(ns):
    obj = inspire(ns)
    ucs = [make_uc("H1", "High"), make_uc("V1", "Very High"), make_uc("X1", "Ultra High"),
           make_uc("M_HI", "Medium", value=4.0), make_uc("M_LO", "Medium", value=3.9), make_uc("M_NONE", "Medium", value=None),
           make_uc("L1", "Low", value=5.0), make_uc("U1", "Very High", gate_unverified=["Q3_relevance"])]
    pool, outside = obj._build_elite_candidate_pool(ucs, ns["TECHNICAL_CONTEXT"]["runtime"])
    assert [u["No"] for u in pool] == ["H1", "V1", "X1", "M_HI"]
    assert {u["No"] for u in outside} == {"M_LO", "M_NONE", "L1", "U1"}
    assert ledger(obj, "elite_candidate_pool") == {"stage": "elite_candidate_pool", "in": 8, "out": 4,
                                                   "drops": {"below_quality_bar": 3, "gate_unverified": 1}}
    assert "gate unverified" in ucs[-1]["selection_drop_reason"]


def test_second_look_is_bounded_by_the_highest_value(ns, fresh_ns):
    rt = fresh_ns["TECHNICAL_CONTEXT"]["runtime"]
    rt["ultra_high_second_look_max"] = 2
    obj = inspire(fresh_ns)
    ucs = [make_uc("A", "Medium", value=4.1), make_uc("B", "Medium", value=5.0), make_uc("C", "Medium", value=4.6),
           make_uc("D", "Medium", value=4.6, inspire_score=9.0)]
    pool, outside = obj._build_elite_candidate_pool(ucs, rt)
    assert [u["No"] for u in pool] == ["B", "D"]
    assert {u["No"] for u in outside} == {"A", "C"}
    assert "second-look limit of 2 reached" in ucs[0]["selection_drop_reason"]
    assert ledger(obj, "elite_candidate_pool")["drops"] == {"second_look_limit": 2}


def test_second_look_threshold_is_configurable(ns, fresh_ns):
    rt = fresh_ns["TECHNICAL_CONTEXT"]["runtime"]
    rt["ultra_high_second_look_min_value"] = 9.5
    pool, _ = inspire(fresh_ns)._build_elite_candidate_pool([make_uc("M", "Medium", value=4.5)], rt)
    assert pool == []


# ---------------------------------------------------------------- BoB prescreen


def test_bob_prescreen_drops_unscored_hard_veto_and_below_minimum_with_full_context(ns):
    obj = inspire(ns)
    obj.ai_agent.bob = {"V": dict({f"D{i}": 8 for i in range(1, 20)}, D7=2), "LOW": 4, "OK": 8}
    obj.ai_agent.bob_skip = {"MISS"}
    pool = [make_uc("OK"), make_uc("V"), make_uc("LOW"), make_uc("MISS")]
    survivors = obj._elite_bob_prescreen(pool, SCHEMA, dict(CONTEXT), ns["TECHNICAL_CONTEXT"]["runtime"])
    assert [u["No"] for u in survivors] == ["OK"]
    assert ledger(obj, "elite_bob_prescreen")["drops"] == {"bob_unscored": 1, "hard_veto": 1, "below_prescreen_min": 1}
    assert pool[2]["selection_drop_reason"] == "bob_score 4.0 is below the Ultra High prescreen minimum 5.0"
    assert pool[1]["selection_drop_reason"] == "hard veto on gate D7"
    bob_vars = obj.ai_agent.prompts(BOB)[0]["vars"]
    for key, value in (("business_context", "A multi-region operator"), ("strategic_initiative", "Customer analytics"),
                       ("value_chain", "Order to delivery"), ("revenue_model", "Order revenue")):
        assert bob_vars[key] == value, key
    assert "strategic_goals" not in bob_vars and "business_priorities" not in bob_vars
    assert "Reduce Cost" not in json.dumps(bob_vars) and "Grow repeat orders" not in json.dumps(bob_vars)
    assert "orders" in bob_vars["schema_details"]


def test_bob_failure_drops_every_candidate(ns):
    obj = inspire(ns)

    def boom(*a, **kw):
        raise RuntimeError("endpoint down")

    obj._score_best_of_best = boom
    survivors = obj._elite_bob_prescreen([make_uc("A"), make_uc("B")], SCHEMA, dict(CONTEXT),
                                         ns["TECHNICAL_CONTEXT"]["runtime"])
    assert survivors == []
    assert ledger(obj, "elite_bob_prescreen")["drops"] == {"bob_unscored": 2}


def test_ultra_high_never_trims_by_theme(ns):
    obj = inspire(ns)
    ucs = [make_uc(f"U{i:03d}", name=f"Forecast weekly orders for segment {i}") for i in range(120)]
    for uc in ucs:
        obj.ai_agent.judge[uc["No"]] = assessment()
    obj._dedup_elite_overlap = lambda elite, stage="elite": elite
    final, _ = select(obj, ucs)
    assert len(final) == 120
    assert "stratified_trim" not in stages(obj)


# ---------------------------------------------------------------- judge, verification, bar


def test_full_stage_order_and_elite_fields(ns):
    obj = inspire(ns)
    ucs = [make_uc("E1"), make_uc("E2", name="Detect late deliveries per customer"), make_uc("L1", "Low")]
    obj.ai_agent.judge = {"E1": assessment(), "E2": assessment(scores={"business_value": 10})}
    final, rejected = select(obj, ucs)
    assert stages(obj) == ["combined_scoring", "elite_candidate_pool", "elite_bob_prescreen", "elite_judge",
                           "elite_evidence_repair", "elite_verification", "elite_second_opinion", "elite_overlap",
                           "elite_domain_coverage", "elite_final", "final_guard"]
    assert {u["No"] for u in final} == {"E1", "E2"} and [u["No"] for u in rejected] == ["L1"]
    for uc in final:
        assert uc["elite_status"] == "ELITE"
        a = uc["elite_assessment"]
        assert a["verification"]["passed"] is True and a["failed_gates"] == [] and a["second_opinion"] is None
        assert set(a) >= {"decision", "decision_owner", "cadence", "kpi", "kpi_direction", "value_driver", "value_tier",
                          "signal_columns", "outcome_definition", "time_column", "entity_key_column", "join_path",
                          "build_path", "blockers", "red_team", "red_team_verdict", "scores", "verdict",
                          "verdict_reason", "second_opinion", "verification"}
    e2 = [u for u in final if u["No"] == "E2"][0]
    assert e2["elite_score"] == round(0.4 * 10 + 0.25 * 8 + 0.2 * 8 + 0.15 * 9, 2)
    assert obj.elite_outcome["elite"] == 2 and obj.elite_outcome["message"] == "2 use cases met the Ultra High bar"
    done = [s for s in obj.atomic_writer.steps if s["result_json"].get("elite") == 2]
    assert done and done[-1]["status"] == "ended_success"


def test_elite_assessment_stores_fully_qualified_columns(ns):
    obj = inspire(ns)
    obj.ai_agent.judge = {"A": assessment(signal_columns=["orders.amount", "ordered_at"], time_column="orders.ordered_at",
                                          entity_key_column="customers.customer_id")}
    final, _ = select(obj, [make_uc("A")])
    a = final[0]["elite_assessment"]
    assert a["signal_columns"] == ["c.s.orders.amount", "c.s.orders.ordered_at"]
    assert a["time_column"] == "c.s.orders.ordered_at" and a["entity_key_column"] == "c.s.customers.customer_id"


def test_judge_runs_in_batches_with_per_batch_schema_context_and_instructions(ns):
    obj = inspire(ns)
    obj.parsed_generation_instructions = {"goal_setting": {"has_goal": True, "goal_description": "Lift repeat orders"},
                                          "interpretation_status": "ok", "per_prompt_instructions": {}}
    tables_seen = []
    real = obj._build_schema_markdown_for_validation

    def spy(details, tables=None):
        tables_seen.append(tables)
        return real(details, tables=tables)

    obj._build_schema_markdown_for_validation = spy
    ucs = [make_uc(f"U{i}") for i in range(7)]
    for uc in ucs:
        obj.ai_agent.judge[uc["No"]] = assessment()
    select(obj, ucs)
    calls = obj.ai_agent.prompts(JUDGE)
    assert sorted(len(ids(c["vars"]["use_cases_to_judge"])) for c in calls) == [2, 5]
    assert all(t == ["c.s.customers", "c.s.orders"] for t in tables_seen if t is not None)
    v = calls[0]["vars"]
    assert "business_priorities" not in v and "strategic_goals" not in v and v["revenue_model"] == "Order revenue"
    assert "Grow repeat orders" not in json.dumps(v)
    assert "GOAL: Lift repeat orders" in v["generation_instructions_section"]
    assert v["min_dimension_score"] == 8 and v["near_miss_band"] == 1
    assert v["allowed_value_tiers"] == '"Transformational" or "Material"'
    assert "Best-of-Best gate scores" in v["use_cases_to_judge"] and "D19=8" in v["use_cases_to_judge"]
    assert "date/timestamp columns: `ordered_at`" in v["use_cases_to_judge"]
    assert "### `c`.`s`.`orders`" in v["schema_details"] and "### `c`.`s`.`customers`" in v["schema_details"]


def test_unjudged_use_case_is_retried_without_cache_then_excluded(ns):
    obj = inspire(ns)
    ucs = [make_uc("OK"), make_uc("FLAKY"), make_uc("NEVER")]
    obj.ai_agent.judge = {"OK": assessment(), "FLAKY": assessment()}
    obj.ai_agent.fail_judge_once = {"FLAKY"}
    final, _ = select(obj, ucs)
    assert {u["No"] for u in final} == {"OK", "FLAKY"}
    retries = [c for c in obj.ai_agent.prompts(JUDGE) if c["skip_cache"]]
    assert retries and all(set(ids(c["vars"]["use_cases_to_judge"])) <= {"FLAKY", "NEVER"} for c in retries)
    assert ledger(obj, "elite_judge")["drops"] == {"unjudged": 1}
    never = [u for u in ucs if u["No"] == "NEVER"][0]
    assert "elite_status" not in never and "no valid assessment" in never["selection_drop_reason"]


def test_failed_verification_and_bar_gates_are_recorded_in_the_near_miss_ledger(ns):
    obj = inspire(ns)
    ucs = [make_uc("BADCOL"), make_uc("FATAL"), make_uc("TIER"), make_uc("LOWV")]
    obj.ai_agent.judge = {
        "BADCOL": assessment(signal_columns=["c.s.orders.discount_pct"], scores={d: 10 for d in DIMS}),
        "FATAL": assessment(verdict="REJECT", red_team_category="NO_DECISION_CHANGED",
                            fatal_flaws=[{"category": "NO_DECISION_CHANGED", "explanation": "The output only reports"}]),
        "TIER": assessment(value_tier="Incremental", verdict="REJECT"),
        "LOWV": assessment(scores={"business_value": 5}, verdict="REJECT"),
    }
    final, rejected = select(obj, ucs)
    # Zero elites with no coverage pick -> near-miss fallback ships the weak-but-not-wrong candidates
    # ranked by elite score; fatal-flaw rejects (verification failure, fatal flaw) never ship.
    assert [u["No"] for u in final] == ["TIER", "LOWV"]
    assert all(u["elite_status"] == "FALLBACK_BELOW_BAR" and u["fallback_kind"] == "near_miss"
               and u["fallback_bar"] == "Ultra High" for u in final)
    assert "failed check: value_tier" in final[0]["fallback_reason"]
    assert "failed check: score:business_value" in final[1]["fallback_reason"]
    assert {u["No"] for u in rejected} >= {"BADCOL", "FATAL"}
    assert all(u.get("elite_status") != "FALLBACK_BELOW_BAR" for u in rejected)
    assert ledger(obj, "elite_verification")["drops"] == {"verification": 1, "red_team": 1, "value_tier": 1,
                                                          "score:business_value": 1}
    assert ledger(obj, "zero_bar_fallback") == {"stage": "zero_bar_fallback", "in": 4, "out": 2,
                                                "drops": {"near_miss": 2}}
    nm = {n["No"]: n for n in obj.elite_near_miss}
    assert nm["BADCOL"]["failed_gates"] == ["verification"] and nm["BADCOL"]["elite_score"] == 10.0
    assert "discount_pct" in nm["BADCOL"]["reason"]
    assert [n["No"] for n in obj.elite_near_miss][0] == "BADCOL"
    obj._publish_funnel_ledger()
    assert obj.final_inspire_results_json["elite_outcome"]["elite"] == 0
    assert obj.final_inspire_results_json["elite_outcome"]["fallback_picks"] == 2
    assert obj.final_inspire_results_json["selection_outcome"]["fallback"] is True
    assert obj.final_inspire_results_json["selection_outcome"]["fallback_kind"] == "near_miss"
    assert obj.final_inspire_results_json["selection_outcome"]["accepted"] == 0


def test_metadata_evidence_failure_ships_high_tier_fallback(ns):
    obj = inspire(ns, loader=Loader(fail=True))
    obj.ai_agent.judge = {"A": assessment()}
    final, _ = select(obj, [make_uc("A")])
    # Verification failure is a fatal flaw, so there is no near miss; the run is not wasted -> the
    # High-tier candidate ships labelled below the Ultra High bar (owner directive: give what you got).
    assert [u["No"] for u in final] == ["A"]
    assert final[0]["elite_status"] == "FALLBACK_BELOW_BAR" and final[0]["fallback_kind"] == "tier"
    assert "closest to the Ultra High bar" in final[0]["fallback_reason"]
    assert ledger(obj, "elite_verification")["drops"] == {"verification": 1}
    assert ledger(obj, "zero_bar_fallback")["drops"] == {"high_tier": 1}


# ---------------------------------------------------------------- second opinion


def test_near_miss_gets_one_independent_uncached_second_opinion_from_the_next_model(ns):
    obj = inspire(ns)
    ucs = [make_uc("N1"), make_uc("N2", name="Detect late deliveries per customer"),
           make_uc("N3", name="Rank customers by repeat potential")]
    near = assessment(verdict="NEAR_MISS", scores={"implementability": 7})
    obj.ai_agent.judge = {"N1": near, "N2": near, "N3": near}
    obj.ai_agent.second = {"N1": assessment(scores={"implementability": 9}),
                           "N2": assessment(verdict="NEAR_MISS", scores={"implementability": 7}),
                           "N3": assessment(verdict="REJECT", scores={"business_value": 4})}
    final, _ = select(obj, ucs)
    assert [u["No"] for u in final] == ["N1"]
    second_calls = [c for c in obj.ai_agent.prompts(JUDGE) if "SecondOpinion" in c["step"]]
    first_calls = [c for c in obj.ai_agent.prompts(JUDGE) if "SecondOpinion" not in c["step"]]
    cascade = ns["get_full_fallback_cascade"](JUDGE)
    assert second_calls and all(c["start_from_model"] == cascade[1]["llm_endpoint_name"] for c in second_calls)
    assert first_calls and all(c["start_from_model"] == cascade[0]["llm_endpoint_name"] for c in first_calls), \
        "with no calibrated judge in the roster, every first opinion starts on the first healthy judge endpoint"
    assert cascade[1]["llm_endpoint_name"] != cascade[0]["llm_endpoint_name"]
    assert all(c["skip_cache"] is True for c in second_calls)
    n1 = final[0]["elite_assessment"]
    assert n1["second_opinion"]["model"] == cascade[1]["llm_endpoint_name"]
    assert n1["second_opinion"]["verification"]["passed"] is True
    assert final[0]["elite_score"] == round(0.4 * 9 + 0.25 * 8 + 0.2 * 8 + 0.15 * 9, 2)
    assert ledger(obj, "elite_second_opinion") == {"stage": "elite_second_opinion", "in": 3, "out": 1,
                                                   "drops": {"not_confirmed": 2}}
    gates = {n["No"]: n["failed_gates"] for n in obj.elite_near_miss}
    assert gates["N2"][-1] == "second_opinion_average_below_bar" and gates["N3"][-1] == "second_opinion_reject"


def test_second_opinion_order_is_shuffled_deterministically(ns):
    def order(session_id):
        obj = inspire(ns)
        obj.session_id = session_id
        ucs = [make_uc(f"N{i}", name=f"Forecast segment {i} orders") for i in range(5)]
        for uc in ucs:
            obj.ai_agent.judge[uc["No"]] = assessment(verdict="NEAR_MISS", scores={"implementability": 7})
        select(obj, ucs)
        call = [c for c in obj.ai_agent.prompts(JUDGE) if "SecondOpinion" in c["step"]][0]
        return ids(call["vars"]["use_cases_to_judge"])

    first = order(7)
    assert first == order(7)
    assert sorted(first) == [f"N{i}" for i in range(5)]
    assert any(order(s) != [f"N{i}" for i in range(5)] for s in (7, 8, 9))


def test_no_second_model_near_misses_ship_as_fallback(ns, fresh_ns):
    tc = fresh_ns["TECHNICAL_CONTEXT"]
    tc["models"] = [m for m in tc["models"] if m["name"] == "claude-opus-4-6"]
    obj = inspire(fresh_ns)
    obj.ai_agent.judge = {"N1": assessment(verdict="NEAR_MISS", scores={"implementability": 7})}
    final, _ = select(obj, [make_uc("N1")])
    # No second model -> N1 stays below the bar, but it is a near miss (no fatal flaw), so with zero
    # elites it ships as the closest below-bar candidate rather than wasting the run.
    assert [u["No"] for u in final] == ["N1"]
    assert final[0]["elite_status"] == "FALLBACK_BELOW_BAR" and final[0]["fallback_kind"] == "near_miss"
    assert ledger(obj, "elite_second_opinion")["drops"] == {"second_opinion_unavailable": 1}
    assert obj.elite_near_miss[0]["failed_gates"][-1] == "second_opinion_unavailable"


# ---------------------------------------------------------------- overlap


def test_overlap_dedup_keeps_the_higher_elite_score_twin_even_when_the_llm_keeps_the_weaker(ns):
    obj = inspire(ns)
    weak = make_uc("W", name="Forecast weekly customer orders")
    strong = make_uc("S", name="Predict weekly customer orders")
    other = make_uc("O", name="Detect late deliveries per customer")
    obj.ai_agent.judge = {"W": assessment(), "S": assessment(scores={"business_value": 10, "actionability": 10}),
                          "O": assessment()}
    obj.ai_agent.dedup_keep = {"W", "O"}
    final, _ = select(obj, [weak, strong, other])
    assert {u["No"] for u in final} == {"S", "O"}
    assert "elite_status" not in weak and "stronger elite use case" in weak["selection_drop_reason"]
    assert ledger(obj, "elite_overlap") == {"stage": "elite_overlap", "in": 3, "out": 2, "drops": {"duplicate": 1}}
    review = obj.ai_agent.prompts("REVIEW_USE_CASES_PROMPT")
    assert len(review) == 1 and review[0]["start_from_model"] and not review[0]["model_override"]


# ---------------------------------------------------------------- coverage picks and zero elite


def assign_by_table(obj):
    def assign(ucs, domains, language):
        for uc in ucs:
            uc["Business Domain"] = domains[0] if "Forecast" in uc["Name"] else domains[1]
            uc["Subdomain"] = "General"
        obj.assigned.append([u["No"] for u in ucs])
        return [dict(u) for u in ucs]

    obj.assigned = []
    obj._assign_to_user_domains = assign


def test_pool_is_assigned_to_user_domains_before_judging_and_empty_domain_gets_a_labelled_pick(ns):
    obj = inspire(ns, user_domains=["Sales", "Operations"])
    assign_by_table(obj)
    ucs = [make_uc("S1"), make_uc("O1", name="Detect late deliveries per customer")]
    obj.ai_agent.judge = {"S1": assessment(), "O1": assessment(scores={"actionability": 5}, verdict="REJECT")}
    final, universe = select(obj, ucs)
    assert obj.assigned == [["S1", "O1"]]
    by = {u["No"]: u for u in final}
    assert by["S1"]["elite_status"] == "ELITE" and by["S1"]["Business Domain"] == "Sales"
    assert by["O1"]["elite_status"] == "DOMAIN_COVERAGE_PICK" and by["O1"]["Business Domain"] == "Operations"
    assert "Domain coverage pick, below bar" in by["O1"]["coverage_pick_reason"]
    assert "score:actionability" in by["O1"]["coverage_pick_reason"]
    assert obj.elite_outcome["message"] == "1 use case met the Ultra High bar; 1 domain coverage pick ships labelled below bar"
    assert all(u is not ucs[0] for u in final), "the elite stage keeps working on the assigned copies"


def test_uncovered_domain_without_pool_candidate_assigns_the_remaining_scored_use_cases(ns):
    obj = inspire(ns, user_domains=["Sales", "Operations"])
    assign_by_table(obj)
    ucs = [make_uc("S1"), make_uc("O_LOW", "Low", name="Detect late deliveries per customer")]
    obj.ai_agent.judge = {"S1": assessment()}
    final, _ = select(obj, ucs)
    assert obj.assigned == [["S1"], ["O_LOW"]]
    pick = [u for u in final if u["elite_status"] == "DOMAIN_COVERAGE_PICK"]
    assert [u["No"] for u in pick] == ["O_LOW"] and pick[0]["Business Domain"] == "Operations"
    assert "quality 'Low' is below the Ultra High bar" in pick[0]["coverage_pick_reason"]


def test_only_coverage_picks_ship_labelled_when_nothing_clears_the_bar(ns):
    obj = inspire(ns, user_domains=["Sales"])
    assign_by_table(obj)
    obj.ai_agent.judge = {"S1": assessment(scores={"business_value": 6}, verdict="REJECT"),
                          "S2": assessment(scores={"business_value": 5}, verdict="REJECT")}
    final, _ = select(obj, [make_uc("S1"), make_uc("S2")])
    assert [(u["No"], u["elite_status"]) for u in final] == [("S1", "DOMAIN_COVERAGE_PICK")]
    assert obj.elite_outcome["elite"] == 0 and obj.elite_outcome["coverage_picks"] == 1
    assert obj.elite_outcome["message"].startswith("0 use cases met the Ultra High bar; 1 domain coverage pick")
    done = [s for s in obj.atomic_writer.steps if "coverage_picks" in s["result_json"]]
    assert done[-1]["status"] == "ended_warning"


def test_zero_elite_without_user_domains_ships_near_miss_fallback(ns):
    obj = inspire(ns)
    obj.ai_agent.judge = {"A": assessment(verdict="REJECT")}
    final, rejected = select(obj, [make_uc("A"), make_uc("B", "Low")])
    # A is judged and rejected without a fatal flaw (verdict REJECT, survives red team, verification
    # passes) -> it is a near miss and ships as the closest below-bar candidate. B is below the pool.
    assert [u["No"] for u in final] == ["A"]
    assert final[0]["elite_status"] == "FALLBACK_BELOW_BAR" and final[0]["fallback_kind"] == "near_miss"
    assert final[0]["fallback_bar"] == "Ultra High"
    assert "B" in {u["No"] for u in rejected}
    assert ledger(obj, "elite_final") == {"stage": "elite_final", "in": 2, "out": 0, "drops": {"not_selected": 2}}
    assert obj.elite_outcome["fallback_picks"] == 1
    assert "closest candidate" in obj.elite_outcome["message"]


def test_unscored_use_cases_never_enter_the_elite_stage(ns):
    obj = inspire(ns)
    obj.ai_agent.judge = {"A": assessment(), "X": assessment()}
    ucs = [make_uc("A"), make_uc("X", scoring_status="unscored", Quality="Unscored")]
    final, rejected = select(obj, ucs)
    assert [u["No"] for u in final] == ["A"] and [u["No"] for u in rejected] == ["X"]
    assert final[0]["elite_status"] == "ELITE"
    judged = [i for c in obj.ai_agent.prompts(JUDGE) for i in ids(c["vars"]["use_cases_to_judge"])]
    assert judged == ["A"]
    assert ledger(obj, "combined_scoring")["drops"] == {"unscored": 1}


def test_good_and_high_selection_do_not_touch_the_elite_stage(ns):
    for mode, acceptable in (("Good", {"Medium", "High", "Very High", "Ultra High"}),
                             ("High", {"High", "Very High", "Ultra High"})):
        obj = inspire(ns)
        obj.use_cases_quality = mode
        obj.quality_filter_acceptable = acceptable
        obj._select_elite_use_cases = lambda *a, **kw: (_ for _ in ()).throw(AssertionError("elite stage in " + mode))
        final, _ = select(obj, [make_uc("A"), make_uc("B", "Medium")])
        assert not any(s.startswith("elite_") for s in stages(obj)), mode
        assert all("elite_status" not in u and "elite_score" not in u for u in final), mode
