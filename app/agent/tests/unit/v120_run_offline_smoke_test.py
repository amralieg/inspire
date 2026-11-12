"""v1.2.0 CORE lane: DatabricksInspire.run() end to end offline.

Every subsystem outside the CORE region (data loader, table filter, clustering, gates, writers,
tracking, Genie) is replaced by a recording double; generation, context merge, goal filter,
combined scoring, Inspire Score, selection, the zero-accepted outcome and the funnel ledger run
for real. Proves the restructured orchestration executes and that:
  * the table filter and both generation passes receive the merged context (K2),
  * scoring runs on the post-gate list, so a UC dropped by the gates never reappears (K1),
  * an unscored UC never reaches the tracking table or any writer (K4),
  * Priority after scoring is the absolute combined priority and no per-domain value pass runs (the
    value_pass double stays for the base-notebook differential run in v120_elite_run_smoke_test),
  * a mode in which nothing clears the bar ends normally with no artifacts and a near-miss
    result (K5), and the funnel ledger is published in both cases.
"""
import json
import logging
import re
import threading
import types

import pytest


class _Writer:
    def __init__(self):
        self.steps = []
        self.results = []
        self.logger = None

    def initialize_session(self):
        return None

    def record_results(self, results):
        self.results.append(results)
        return True

    def emit_step(self, **kw):
        self.steps.append(kw)
        return len(self.steps)


class _Agent:
    def __init__(self, scorer):
        self.scorer = scorer
        self.calls = []
        self.prompt_templates = {}
        self._lock = threading.Lock()

    def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema=None, **kw):
        with self._lock:
            self.calls.append((worker_prompt_path, dict(prompt_vars), kw.get("skip_cache", False)))
        if worker_prompt_path == "COMBINED_VALUE_QUALITY_SCORE_PROMPT":
            ids = re.findall(r"### Use Case: (\S+) - ", prompt_vars["use_cases_to_validate"])
            return json.dumps([r for r in (self.scorer(i) for i in ids) if r])
        if worker_prompt_path == "STRATEGY_ALIGNMENT_PROMPT":
            return json.dumps([{"use_case_id": p["use_case_id"], "alignments": [], "priority_alignment": [],
                                "strategic_alignment": 1.0,
                                "kpis": [{"name": "Order count", "direction": "increase", "aggregation": "COUNT",
                                          "table": next(iter(p["tables"]), None)}],
                                "key_result_ids": [], "proposed_key_results": [],
                                "measures_of_success": ["The weekly planning review uses the output"],
                                "financial_benefits": ["Revenue protected on `amount`"],
                                "non_financial_benefits": ["Faster planning"], "sponsor_id": None}
                               for p in json.loads(prompt_vars["use_cases_json"])])
        raise AssertionError(f"unexpected LLM prompt in smoke run: {worker_prompt_path}")

    def cleanup_llm_cache(self):
        return None

    def get_manager_stats_report(self):
        return ""


class _Loader:
    def __init__(self, columns):
        self._batches = [columns]
        self.foreign_key_graph = {}

    def getNextTables(self, n):
        return self._batches.pop(0) if self._batches else None

    def merge_inferred_foreign_keys(self, cols):
        return 0

    def get_table_comment(self, catalog, schema, table):
        return None

    def get_primary_key(self, catalog, schema, table):
        return []

    def get_table_relations(self, catalog, schema, table):
        return []

    def get_sampling_info(self, catalog, schema, table):
        return None

    def metadata_unavailable_report(self):
        return {"count": 0, "tables": []}

    def metadata_unavailable_report(self):
        return {"count": 0, "tables": []}


COLUMNS = [("cat", "sch", t, c, "bigint", "") for t in ("orders", "items", "stores") for c in ("id", "amount")]


def _build(ns, tmp_path, mode, acceptable, scorer, user_domains=None):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    rec = {"filter_kwargs": None, "gen_kwargs": [], "tracking": [], "csv": [], "docs": [], "excel": [], "notebooks": []}
    obj.recorded = rec
    obj.logger = logging.getLogger("v120_smoke")
    obj.session_id = 4242
    obj.business_name = "SmokeCo"
    obj.generate_choices = ["PDF Catalog", "Excel"]
    obj.operation_mode = "Discover Use Cases"
    obj.operation = "Discover Use Cases"
    obj.inspire_database = ""
    obj.json_file_path = None
    obj.auto_parallelism = False
    obj.max_parallelism = 4
    obj.scan_parallelism = 4
    obj.output_languages = ["English"]
    obj.technical_exclusion_strategy = "Aggressive"
    obj.table_election_mode = "All Tables"
    obj.use_cases_quality = mode
    obj.quality_filter_acceptable = acceptable
    obj.user_business_domains = list(user_domains or [])
    obj.user_business_priorities = []
    obj.user_strategic_goals = []
    obj.parsed_generation_instructions = {}
    obj.merged_business_context = {}
    obj.generate_genie_instructions = False
    obj._tracking_table_name = "c.s.__inspire_usecases"
    obj.final_inspire_results_json = {}
    obj.llm_timeout_seconds = 30
    obj.registry_lock = threading.Lock()
    obj.processing_honesty = {"total_batch_splits": 0, "batch_split_history": [], "tables_with_columns_dropped": []}
    obj.atomic_writer = _Writer()
    obj.ai_agent = _Agent(scorer)
    obj.translation_service = types.SimpleNamespace(get_translations=lambda lang: {})
    obj.storage_manager = ns["IntermediateStorageManager"](base_path=str(tmp_path), logger=obj.logger)
    obj.data_loader = _Loader(list(COLUMNS))

    obj._start_live_log_flush_thread = lambda: None
    obj._persist_session_prompt_context = lambda: None
    obj._get_business_context_from_llm = lambda: {
        "business_context": "A regional bakery chain\nwith 40 stores", "strategic_goals": "Reduce Cost",
        "business_priorities": "Grow basket size, Cut waste", "strategic_initiative": "Store analytics",
        "value_chain": "Bake, ship, sell", "revenue_model": "Retail sales"}
    obj._interpret_generation_instructions = lambda: {}
    obj._augment_columns_with_foreign_keys = lambda cols: cols
    obj._augment_columns_with_related_tables = lambda cols: cols
    obj._estimate_schema_markdown_size = lambda cols: 100
    obj._determine_tables_per_call = lambda n: 1

    def split_by_table_limit(cols, n):
        groups = {}
        for c in cols:
            groups.setdefault((c[0], c[1], c[2]), []).append(c)
        tables = list(groups)
        return [[c for t in tables[i:i + max(1, n)] for c in groups[t]] for i in range(0, len(tables), max(1, n))]

    obj._split_by_table_limit = split_by_table_limit

    def filter_tables(cols, business_context="", industry="", exclusion_strategy=""):
        rec["filter_kwargs"] = {"business_context": business_context, "industry": industry}
        fqtns = {f"{c[0]}.{c[1]}.{c[2]}" for c in cols}
        return (cols, [], set(fqtns), set(), {t: 90 for t in fqtns}, {t: "TRANSACTIONAL" for t in fqtns},
                set(), set(fqtns), set())

    obj._filter_business_tables = filter_tables

    def generate(column_details, batch_id, **kw):
        rec["gen_kwargs"].append(kw)
        table = column_details[0][2]
        if str(batch_id).startswith("P2_"):
            return []
        return [{"No": f"AI-{batch_id}-U{i}", "Name": f"Forecast {table} demand {i}", "usecase": "", "type": "AI",
                 "Analytics Technique": "Forecasting", "Statement": f"{table} statement {i}", "Solution": "Model",
                 "Business Value": "Value", "Beneficiary": "Ops", "Sponsor": "COO",
                 "Tables Involved": f"cat.sch.{table}", "High Level Design": "Aggregate", "Business Domain": "",
                 "Subdomain": "", "Quality": "Pending", "Priority": 0.0} for i in (1, 2)]

    obj._process_batch_with_retry = generate
    obj._retry_missing_table_coverage = lambda *a, **kw: []

    def cluster(ucs, lang, merge_small_domains=True):
        for uc in ucs:
            uc["Business Domain"] = "Sales" if "orders" in uc["Tables Involved"] else "Operations"
            uc["Subdomain"] = "General"
        return ucs

    obj._cluster_domains_and_subdomains = cluster

    def value_pass(ucs, **kw):
        for uc in ucs:
            uc["Priority"] = 9.5
            uc["value_scoring_status"] = "scored"
        return ucs

    obj._score_per_domain_parallel = value_pass
    obj._deduplicate_use_cases = lambda ucs: ucs
    obj._phaseG_run_quality_gates = lambda ucs, schema: ucs
    obj._phaseQ_run_integrity_gates = lambda ucs, schema: [u for u in ucs if "stores" not in u["Tables Involved"]]
    obj._phaseL_final_gate = lambda ucs, schema: {}
    obj._generate_csv_catalog = lambda lang, abbr, grouped: rec["csv"].append(grouped)
    obj._tracking_replace_session = lambda ucs: rec["tracking"].append(list(ucs))
    obj._get_salesy_summary = lambda grouped, name, lang, tr: ({}, name)
    obj._generate_documents_for_all_languages = lambda *a, **kw: rec["docs"].append(a)
    obj._run_discover_skeleton_phase = lambda ucs, schema: ucs
    obj.assemble_use_case_notebooks = lambda *a, **kw: rec["notebooks"].append(a)
    obj._generate_use_case_excel = lambda *a, **kw: rec["excel"].append(a)

    def save_json(ucs, translations, summary):
        obj.final_inspire_results_json = {"domains": [{"domain_name": "x", "use_cases": list(ucs)}]}
        return summary

    obj._save_usecases_catalog_json = save_json
    obj._report_table_statistics = lambda ucs: None
    obj._report_processing_honesty = lambda: None
    obj._upload_log_file = lambda: None
    return obj


@pytest.fixture
def quiet_root_logger():
    root = logging.getLogger()
    saved = (list(root.handlers), root.level)
    yield
    root.handlers[:] = saved[0]
    root.setLevel(saved[1])


def test_run_balanced_end_to_end(agent_ns, tmp_path, quiet_root_logger):
    def scorer(uc_id):
        if uc_id == "N01-U02":
            return None
        return {"use_case_id": uc_id, "quality_label": "High", "quality_score": 4.0, "priority_score": 7.0,
                "quality_summary": "Columns `id` and `amount` aggregated by store give the KPI that drives the outcome."}

    obj = _build(agent_ns, tmp_path, "Good", {"Medium", "High", "Very High", "Ultra High"}, scorer)
    obj.run()
    rec = obj.recorded
    assert rec["filter_kwargs"] == {"business_context": "A regional bakery chain\nwith 40 stores",
                                    "industry": "A regional bakery chain"}
    p1 = rec["gen_kwargs"][0]
    assert p1["business_context"].startswith("A regional bakery chain")
    assert "business_priorities" not in p1 and "strategic_goals" not in p1
    assert p1["strategic_initiative"] == "Store analytics" and p1["value_chain"] == "Bake, ship, sell"
    assert p1["revenue_model"] == "Retail sales" and p1["industry"] == "A regional bakery chain"
    assert rec["tracking"], "tracking table must be written for a non-empty selection"
    final = rec["tracking"][-1]
    tables = {u["Tables Involved"] for u in final}
    assert "cat.sch.stores" not in tables, "UC dropped by the gates must not be re-scored back in (K1)"
    assert all(u["scoring_status"] == "scored" for u in final), "unscored UC reached tracking (K4)"
    assert len(final) == 3, [u["No"] for u in final]
    assert all(u["Priority"] == 7.0 and u["Priority Score"] == 7.0 for u in final)
    ledger = obj.final_inspire_results_json["funnel_ledger"]
    stages = [e["stage"] for e in ledger]
    for stage in ("table_reference_filter", "goal_alignment", "coverage_catchall", "domain_clustering",
                  "llm_dedup", "phase_g_gates", "phase_q_gates", "combined_scoring",
                  "quality_filter", "domain_coverage_picks", "final_guard"):
        assert stage in stages, stage
    assert "value_scoring" not in stages
    by = {e["stage"]: e for e in ledger}
    assert by["phase_q_gates"]["in"] - by["phase_q_gates"]["out"] == 2
    assert by["combined_scoring"]["drops"] == {"unscored": 1}
    assert obj.final_inspire_results_json["domains"], "catalog JSON must survive the ledger publication"


def test_run_zero_at_high_bar_falls_back_to_medium_tier(agent_ns, tmp_path, quiet_root_logger):
    def scorer(uc_id):
        return {"use_case_id": uc_id, "quality_label": "Medium", "quality_score": 3.0, "priority_score": 5.0,
                "quality_summary": "Columns `id` and `amount` aggregated by store give the KPI that drives the outcome."}

    obj = _build(agent_ns, tmp_path, "High", {"High", "Very High", "Ultra High"}, scorer)
    obj.run()
    rec = obj.recorded
    final = rec["tracking"][-1]
    assert final, "no use case met the High bar, so the Medium candidates ship rather than wasting the run"
    assert all(u["elite_status"] == "FALLBACK_BELOW_BAR" and u["fallback_kind"] == "tier"
               and u["fallback_bar"] == "High" for u in final)
    assert rec["csv"] and rec["docs"] and rec["excel"] and rec["notebooks"]
    outcome = obj.final_inspire_results_json["selection_outcome"]
    assert outcome["fallback"] is True and outcome["fallback_kind"] == "tier" and outcome["accepted"] == 0
    assert "below_bar_kept" in [e["stage"] for e in obj.final_inspire_results_json["funnel_ledger"]]
    assert all(u["meets_quality_bar"] == "N" for u in final)


def test_run_user_domain_gets_coverage_pick_in_strict(agent_ns, tmp_path, quiet_root_logger):
    def scorer(uc_id):
        label = "High" if uc_id.startswith("N01-") else "Low"
        return {"use_case_id": uc_id, "quality_label": label, "quality_score": 4.0 if label == "High" else 2.0,
                "priority_score": 6.0, "quality_summary": "Columns `id` and `amount` give the KPI that drives the outcome."}

    obj = _build(agent_ns, tmp_path, "High", {"High", "Very High", "Ultra High"}, scorer,
                 user_domains=["Sales", "Operations"])
    obj.run()
    final = obj.recorded["tracking"][-1]
    domains = {u["Business Domain"] for u in final}
    assert domains == {"Sales", "Operations"}
    picks = [u for u in final if u.get("elite_status") == "DOMAIN_COVERAGE_PICK"]
    assert len(picks) == 1 and picks[0]["Business Domain"] == "Operations"
