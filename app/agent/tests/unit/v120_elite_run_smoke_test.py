"""v1.2.0 ELITE lane: DatabricksInspire.run() offline in Ultra High, and Good/High on the shared path.

Reuses the CORE smoke harness (every subsystem outside the selection path is a recording double).
Ultra High must skip the early domain clustering, dedup globally, score, run the elite stage, cluster
ONLY the final set, renumber it in final-rank order and stamp `quality_mode`. No mode runs a per-domain
value pass (INTEGRATION-3: combined scoring is the single Priority source). Good and High run the base
call sequence minus that pass, and since INTEGRATION-3 also end with the final-rank renumber: a
differential run against the base notebook (dev 3e2543e) proves the same use cases, the same LLM calls
and the same funnel ledger minus the `value_scoring` stage, with the ids reassigned in final-rank order.
"""
import json
import os
import re
import sys
import threading

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import load_agent_namespace, reference_notebook  # noqa: E402
from v120_run_offline_smoke_test import _build, quiet_root_logger  # noqa: E402,F401

BASE_COMMIT = "3e2543e"
JUDGE = "ULTRA_HIGH_ELITE_JUDGE_PROMPT"
BOB = "BEST_OF_BEST_SCORING_PROMPT"
COMBINED = "COMBINED_VALUE_QUALITY_SCORE_PROMPT"


def col(name, dtype, comment=""):
    return {"name": name, "type": dtype, "comment": comment, "nullable": True, "tags": {}}


EVIDENCE = {f"cat.sch.{t}": {"comment": f"One row per {t} event", "table_type": "MANAGED", "tags": {},
                             "last_altered": None, "primary_key": ["id"], "foreign_keys": [],
                             "columns": {"id": col("id", "BIGINT", "Key"), "amount": col("amount", "DECIMAL(12,2)", "Value"),
                                         "event_ts": col("event_ts", "TIMESTAMP", "Event time")}}
            for t in ("orders", "items", "stores")}


def combined_scorer(uc_id):
    return {"use_case_id": uc_id, "quality_label": "High", "quality_score": 4.0, "priority_score": 7.0,
            "value_score": 4.2, "feasibility_score": 3.6,
            "quality_summary": "Columns `id` and `amount` aggregated by store give the KPI that drives the outcome."}


def assessment(table, **over):
    a = {"decision": f"Which {table} to prioritise each week", "decision_owner": f"{table} lead", "cadence": "weekly",
         "kpi": f"{table} fulfilment cost", "kpi_direction": "decrease",
         "value_driver": f"`cat.sch.{table}.amount` per `cat.sch.{table}.id` drives the weekly decision",
         "value_tier": "Material", "signal_columns": [f"cat.sch.{table}.amount", f"cat.sch.{table}.event_ts"],
         "outcome_definition": None, "time_column": f"cat.sch.{table}.event_ts",
         "entity_key_column": f"cat.sch.{table}.id", "join_path": [], "build_path": "SQL feature table and a forecast job",
         "blockers": [], "runtime_assumptions": [], "fatal_flaws": [], "red_team": "Late events",
         "red_team_category": "RESIDUAL_RISK",
         "scores": {"business_value": 9, "evidence_strength": 9, "implementability": 8, "actionability": 8},
         "verdict": "ELITE", "verdict_reason": "Grounded weekly decision"}
    a.update(over)
    return a


class UltraAgent:
    def __init__(self, judge):
        self.judge = judge
        self.calls = []
        self.lock = threading.Lock()
        self.prompt_templates = {}

    def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema=None, **kw):
        with self.lock:
            self.calls.append((worker_prompt_path, kw.get("skip_cache", False), kw.get("start_from_model")))
        if worker_prompt_path == COMBINED:
            found = re.findall(r"### Use Case: (\S+) - ", prompt_vars["use_cases_to_validate"])
            return json.dumps([combined_scorer(i) for i in found])
        if worker_prompt_path == BOB:
            found = re.findall(r"### Use Case: (\S+) - ", prompt_vars["use_cases_to_validate"])
            return json.dumps([{"No": i, "bob_scores": {f"D{g}": 8 for g in range(1, 20)}, "idea_theme": "Demand",
                                "bob_justification_short": "ok"} for i in found])
        if worker_prompt_path == JUDGE:
            out = []
            for uc_id, name in re.findall(r"### Use Case: (\S+) - (.+)", prompt_vars["use_cases_to_judge"]):
                item = self.judge(name.strip())
                if item is not None:
                    out.append(dict(item, No=uc_id))
            return json.dumps(out)
        raise AssertionError(f"unexpected LLM prompt in Ultra High smoke run: {worker_prompt_path}")

    def cleanup_llm_cache(self):
        return None

    def get_manager_stats_report(self):
        return ""

    def prompts(self):
        return [c[0] for c in self.calls]


def build_ultra(ns, tmp_path, judge, user_domains=None):
    obj = _build(ns, tmp_path, "Ultra High", {"High", "Very High", "Ultra High"}, combined_scorer,
                 user_domains=user_domains)
    rec = obj.recorded
    rec.update(cluster=[], dedup=[], assign=[])
    obj.ai_agent = UltraAgent(judge)
    obj.data_loader.foreign_key_graph = {}
    obj.data_loader.get_metadata_evidence = lambda tables: {t: json.loads(json.dumps(EVIDENCE[t])) for t in tables
                                                            if t in EVIDENCE}
    cluster = obj._cluster_domains_and_subdomains

    def cluster_spy(ucs, lang, **kw):
        rec["cluster"].append([u["Name"] for u in ucs])
        rec.setdefault("cluster_kwargs", []).append(kw)
        return cluster(ucs, lang, **kw)

    def dedup_spy(ucs, rank=None):
        rec["dedup"].append((len(ucs), rank is not None))
        return ucs

    def assign_spy(ucs, domains, language):
        rec["assign"].append([u["Name"] for u in ucs])
        for uc in ucs:
            uc["Business Domain"] = "Sales" if "orders" in uc["Tables Involved"] else "Operations"
            uc["Subdomain"] = "General"
        return ucs

    obj._cluster_domains_and_subdomains = cluster_spy
    obj._deduplicate_use_cases = dedup_spy
    obj._assign_to_user_domains = assign_spy
    return obj


def stages(obj):
    return [e["stage"] for e in obj.final_inspire_results_json["funnel_ledger"]]


def test_ultra_high_run_end_to_end(agent_ns, tmp_path, quiet_root_logger):
    def judge(name):
        table = name.split()[1]
        if name == "Forecast items demand 2":
            return assessment(table, verdict="REJECT", scores={"business_value": 4, "evidence_strength": 9,
                                                              "implementability": 8, "actionability": 8})
        if name == "Forecast items demand 1":
            return assessment(table, scores={"business_value": 10, "evidence_strength": 10, "implementability": 9,
                                             "actionability": 9})
        return assessment(table)

    obj = build_ultra(agent_ns, tmp_path, judge)
    obj.run()
    rec = obj.recorded
    assert rec["dedup"][0] == (6, False), "global dedup runs on every generated use case before the gates"
    assert rec["dedup"][1] == (3, True), "overlap dedup runs on the elite set with the final rank"
    assert len(rec["cluster"]) == 1, "domain clustering runs exactly once"
    assert sorted(rec["cluster"][0]) == ["Forecast items demand 1", "Forecast items demand 2", "Forecast orders demand 1",
                                         "Forecast orders demand 2"], "the final elite set plus the near-miss ledger"
    assert rec["cluster_kwargs"] == [{"merge_small_domains": False}]

    s = stages(obj)
    for absent in ("value_scoring", "quality_filter", "bob_scoring", "stratified_trim", "domain_coverage_picks"):
        assert absent not in s, absent
    elite_stages = ["combined_scoring", "elite_candidate_pool", "elite_bob_prescreen", "elite_judge",
                    "elite_evidence_repair", "elite_verification", "elite_second_opinion", "elite_overlap",
                    "elite_domain_coverage", "elite_final", "final_guard", "domain_clustering"]
    assert [x for x in s if x in elite_stages] == elite_stages
    assert s.index("llm_dedup") < s.index("phase_g_gates") < s.index("combined_scoring")

    final = rec["tracking"][-1]
    assert [u["No"] for u in final] == ["N01-U01", "N02-U01", "N02-U02"]
    assert [u["Name"] for u in final][0] == "Forecast items demand 1"
    assert [u["Business Domain"] for u in final] == ["Operations", "Sales", "Sales"]
    for uc in final:
        assert uc["elite_status"] == "ELITE" and uc["quality_mode"] == "Ultra High"
        assert uc["elite_assessment"]["verification"]["passed"] is True
        assert uc["Primary Table"] == uc["Tables Involved"]
    assert rec["csv"] and rec["docs"] and rec["excel"] and rec["notebooks"]
    prompts = obj.ai_agent.prompts()
    assert prompts.count(COMBINED) >= 1 and prompts.count(BOB) == 1 and prompts.count(JUDGE) == 1
    outcome = obj.final_inspire_results_json["elite_outcome"]
    assert outcome["elite"] == 3 and outcome["coverage_picks"] == 0
    assert outcome["near_miss"][0]["Name"] == "Forecast items demand 2"
    assert outcome["near_miss"][0]["Business Domain"] == "Operations", "near misses carry the domain of the final clustering"


def test_ultra_high_zero_elite_all_fatal_ships_high_tier_fallback(agent_ns, tmp_path, quiet_root_logger):
    flaw = [{"category": "NO_DECISION_CHANGED", "explanation": "The output only reports demand"}]
    obj = build_ultra(agent_ns, tmp_path, lambda name: assessment(name.split()[1], verdict="REJECT", fatal_flaws=flaw,
                                                                  red_team_category="NO_DECISION_CHANGED"))
    obj.run()
    rec = obj.recorded
    final = rec["tracking"][-1]
    assert final, "every candidate is a fatal-flaw reject, so there is no near miss; the High-tier candidates ship"
    assert all(u["elite_status"] == "FALLBACK_BELOW_BAR" and u["fallback_kind"] == "tier"
               and u["fallback_bar"] == "Ultra High" for u in final)
    assert rec["csv"] and rec["docs"] and rec["excel"] and rec["notebooks"]
    fb = [s for s in obj.atomic_writer.steps if (s.get("result_json") or {}).get("fallback")]
    assert fb and fb[-1]["result_json"]["fallback_kind"] == "high_tier"
    assert obj.final_inspire_results_json["selection_outcome"]["fallback"] is True
    assert obj.final_inspire_results_json["elite_outcome"]["elite"] == 0
    assert obj.final_inspire_results_json["elite_outcome"]["fallback_picks"] == len(final)


def test_ultra_high_zero_elite_with_near_misses_ships_near_miss_fallback(agent_ns, tmp_path, quiet_root_logger):
    obj = build_ultra(agent_ns, tmp_path,
                      lambda name: assessment(name.split()[1], verdict="REJECT", value_tier="Incremental"))
    obj.run()
    rec = obj.recorded
    final = rec["tracking"][-1]
    assert final, "rejected without a fatal flaw -> near misses ship as the closest below-bar candidates"
    assert all(u["elite_status"] == "FALLBACK_BELOW_BAR" and u["fallback_kind"] == "near_miss"
               and "failed check:" in u["fallback_reason"] for u in final)
    assert rec["csv"] and rec["docs"] and rec["notebooks"]
    fb = [s for s in obj.atomic_writer.steps if (s.get("result_json") or {}).get("fallback")]
    assert fb and fb[-1]["result_json"]["fallback_kind"] == "near_miss"
    assert obj.final_inspire_results_json["elite_outcome"]["elite"] == 0
    assert obj.final_inspire_results_json["elite_outcome"]["fallback_picks"] == len(final)


def test_ultra_high_run_with_user_domains_keeps_them_and_never_reclusters(agent_ns, tmp_path, quiet_root_logger):
    def judge(name):
        table = name.split()[1]
        if table == "items":
            return assessment(table, scores={"business_value": 6, "evidence_strength": 9, "implementability": 8,
                                             "actionability": 8})
        return assessment(table)

    obj = build_ultra(agent_ns, tmp_path, judge, user_domains=["Sales", "Operations"])
    obj.run()
    rec = obj.recorded
    assert rec["cluster"] == []
    assert len(rec["assign"]) == 1 and len(rec["assign"][0]) == 4
    final = rec["tracking"][-1]
    by_domain = {}
    for uc in final:
        by_domain.setdefault(uc["Business Domain"], []).append(uc)
    assert set(by_domain) == {"Sales", "Operations"}
    assert [u["elite_status"] for u in by_domain["Operations"]] == ["DOMAIN_COVERAGE_PICK"]
    assert all(u["elite_status"] == "ELITE" for u in by_domain["Sales"])
    assert [u["No"] for u in final] == ["N01-U01", "N01-U02", "N02-U01"]
    assert final[-1]["Business Domain"] == "Operations", "coverage picks rank after every elite"
    ledger = {e["stage"]: e for e in obj.final_inspire_results_json["funnel_ledger"]}
    assert ledger["domain_clustering"]["in"] == ledger["domain_clustering"]["out"] == 3


@pytest.mark.parametrize("mode, acceptable", [("Good", {"Medium", "High", "Very High", "Ultra High"}),
                                              ("High", {"High", "Very High", "Ultra High"})])
def test_good_and_high_run_the_shared_sequence_and_one_final_renumber(agent_ns, tmp_path, quiet_root_logger, mode,
                                                                      acceptable):
    obj = _build(agent_ns, tmp_path, mode, acceptable, combined_scorer)
    calls = {"cluster": [], "dedup": [], "finalize": []}
    cluster, finalize = obj._cluster_domains_and_subdomains, obj._finalize_portfolio_order

    def cluster_spy(ucs, lang):
        calls["cluster"].append(len(ucs))
        return cluster(ucs, lang)

    def dedup_spy(ucs, **kw):
        calls["dedup"].append((len(ucs), kw))
        return ucs

    def finalize_spy(ucs):
        calls["finalize"].append(len(ucs))
        return finalize(ucs)

    obj._cluster_domains_and_subdomains = cluster_spy
    obj._deduplicate_use_cases = dedup_spy
    obj._finalize_portfolio_order = finalize_spy
    obj._select_elite_use_cases = lambda *a, **kw: (_ for _ in ()).throw(AssertionError("elite stage in " + mode))
    obj.run()
    assert calls == {"cluster": [6], "dedup": [(6, {})], "finalize": [4]}
    s = stages(obj)
    assert not any(x.startswith("elite_") for x in s) and "value_scoring" not in s
    assert s.index("domain_clustering") < s.index("llm_dedup") < s.index("combined_scoring")
    final = obj.recorded["tracking"][-1]
    assert all(u["quality_mode"] == mode and "elite_score" not in u for u in final)


def _base_namespace():
    return load_agent_namespace(str(reference_notebook(BASE_COMMIT)))


BY_DESIGN = ("No", "result_table", "quality_mode", "value_scoring_status")
V130_BY_DESIGN = ("Strategy Alignment", "Strategy Path", "KPIs", "Expected Key Results", "Measures of Success",
                  "Financial Benefits", "Non-Financial Benefits", "Data Evidence", "Foundations", "use_case_key",
                  "Business Priority Alignment", "Strategic Goals Alignment", "Strategic Alignment",
                  "best_of_best", "best_of_best_reason", "use_case_kind", "kind_family", "kind_label",
                  "kind_family_label", "app_layout", "serving_summary", "method_summary", "value_source",
                  "selection_basis", "selection_replaced", "selection_score_gap")


def _comparable_run(ns, tmp_path, mode, acceptable, user_domains):
    tmp_path.mkdir(parents=True, exist_ok=True)
    obj = _build(ns, tmp_path, mode, acceptable, combined_scorer, user_domains=user_domains)
    obj.run()
    final = obj.recorded["tracking"][-1]
    content = sorted(({k: v for k, v in uc.items() if k not in BY_DESIGN} for uc in final), key=lambda u: u["Name"])
    calls = sorted((c[0], c[2], tuple(re.findall(r"### Use Case: (\S+) - ", c[1].get("use_cases_to_validate", ""))))
                   for c in obj.ai_agent.calls)
    return content, obj.final_inspire_results_json["funnel_ledger"], calls, obj, final


@pytest.mark.parametrize("user_domains", [None, ["Sales", "Operations"]])
@pytest.mark.parametrize("mode, acceptable", [("Good", {"Medium", "High", "Very High", "Ultra High"}),
                                              ("High", {"High", "Very High", "Ultra High"})])
def test_good_and_high_keep_the_base_use_cases_and_renumber_them_in_final_rank_order(
        agent_ns, tmp_path, quiet_root_logger, mode, acceptable, user_domains):
    base = _base_namespace()
    expected = _comparable_run(base, tmp_path / "base", mode, acceptable, user_domains)
    actual = _comparable_run(agent_ns, tmp_path / "head", mode, acceptable, user_domains)
    assert len(expected[0]) == 4 and len(expected[1]) >= 10 and expected[2], "the base run must produce a portfolio"
    strip = lambda rows: [{k: v for k, v in uc.items() if k not in V130_BY_DESIGN} for uc in rows]
    assert strip(actual[0]) == strip(expected[0]), "the selected use cases differ from the base notebook"
    assert [c for c in actual[2] if c[0] != "STRATEGY_ALIGNMENT_PROMPT"] == expected[2], \
        "LLM call sequence differs from the base notebook beyond the post-selection alignment"
    assert any(c[0] == "STRATEGY_ALIGNMENT_PROMPT" for c in actual[2])
    for uc in actual[4]:
        assert uc["best_of_best"] == "N" and uc["best_of_best_reason"].endswith("so it is already the short list"), uc["No"]
        assert uc["Strategic Goals Alignment"] and uc["Business Priority Alignment"], uc["No"]
        assert uc["KPIs"] and uc["Financial Benefits"] and uc["Non-Financial Benefits"], uc["No"]
    assert [e for e in actual[1] if e["stage"] != "feedback_exclusion"] == \
        [e for e in expected[1] if e["stage"] != "value_scoring"], \
        "funnel ledger differs from the base notebook beyond the removed value pass and the feedback stage"
    exclusion = [e for e in actual[1] if e["stage"] == "feedback_exclusion"]
    assert len(exclusion) == 1 and exclusion[0]["in"] == exclusion[0]["out"] and exclusion[0]["drops"] == {}, \
        "without feedback rows the feedback stage excludes nothing"
    head, final = actual[3], actual[4]
    reordered = head._finalize_portfolio_order([dict(u) for u in final])
    assert [u["No"] for u in reordered] == [u["No"] for u in final], "the final list is already in final-rank order"
    assert [u["Name"] for u in reordered] == [u["Name"] for u in final]
    numbers = [u["No"] for u in final]
    assert numbers[0] == "N01-U01" and len(set(numbers)) == len(numbers)
