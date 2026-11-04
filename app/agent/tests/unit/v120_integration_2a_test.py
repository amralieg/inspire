"""v1.2.0 INTEGRATION-2A: cross-lane fixes after merging MODES (Good / High / Ultra High) into ELITE.

1. Selection has no keep-all Coverage branch: every canonical mode applies its label filter.
2. `min_use_cases_for_selection` is gone from the runtime config and its bounds.
3. `_is_ultra_high_mode()` reads the mode through the one canonical parser.
4. Elite evidence repair: an assessment that fails metadata verification only on its own citations
   gets ONE uncached re-judge with the exact failures and the tables' real columns before it is
   rejected; data that lacks the needed column stays rejected and a repair never repeats.
5. Q3 reads the shared `_TEMPORAL_FAMILIES`.
6. Relabelled use cases: Q3 R2/R14 accept topic clustering on text columns, Q5 R18 compares canonical
   technique labels.
7. The elite judge never receives a fabricated context default.

Every behavioural fix has a case that fails on dev ee43d66 and a must-exclude case.
"""
import ast
import copy
import json
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import ROOT, agent_source, load_agent_namespace, method_node, notebook_cells  # noqa: E402
from v120_elite_selection_test import (CONTEXT, JUDGE, SCHEMA, Agent, Loader, assessment, ids, inspire, ledger,  # noqa: E402
                                       make_uc, select, stages)
from v120_elite_verification_test import EVIDENCE, col  # noqa: E402
from v120_gate_recalibration_test import SCHEMA as GATE_SCHEMA  # noqa: E402
from v120_gate_recalibration_test import U, make, reasons  # noqa: E402
from v120_elite_run_smoke_test import UltraAgent, build_ultra  # noqa: E402
from v120_elite_run_smoke_test import assessment as run_assessment  # noqa: E402
from v120_modes_quality_test import _cleanup, _construct, restore_root_logger  # noqa: E402,F401
from v120_run_offline_smoke_test import quiet_root_logger  # noqa: E402,F401

REPAIR_STEP = "EliteEvidenceRepair"


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


# ---------------------------------------------------------------- 1. no keep-all Coverage branch


def test_selection_has_no_keep_all_coverage_branch():
    src = ast.unparse(method_node("DatabricksInspire", "_select_scored_use_cases"))
    assert "acceptable is None" not in src
    assert "Coverage Mode" not in src and "No quality filtering applied" not in src
    pool = ast.unparse(method_node("DatabricksInspire", "_build_elite_candidate_pool"))
    assert "quality_filter_acceptable or" not in pool


@pytest.mark.parametrize("mode,kept", [("Good", ["H", "M"]), ("High", ["H"])])
def test_every_canonical_mode_applies_its_label_filter(fresh_ns, tmp_path, restore_root_logger, mode, kept):
    obj = _construct(fresh_ns, tmp_path, use_cases_quality=mode)
    try:
        obj.funnel_ledger = []
        ucs = [make_uc("H", "High", name="Forecast weekly customer orders"),
               make_uc("M", "Medium", name="Detect late deliveries per customer"),
               make_uc("L", "Low", name="Rank customers by repeat potential")]
        final, rejected = obj._select_scored_use_cases(ucs, [], {})
        assert [u["No"] for u in final if u["meets_quality_bar"] == "Y"] == kept
        below = [u for u in final if u["meets_quality_bar"] == "N"]
        assert {u["No"] for u in below} == {"H", "M", "L"} - set(kept) and rejected == []
        assert all(u["fallback_reason"] == "scored %s, below the %s bar" % (u["Quality"], mode) for u in below)
        assert "below the %s bar" % mode in [u for u in ucs if u["No"] == "L"][0]["selection_drop_reason"]
    finally:
        _cleanup(obj)


def test_quality_mode_aliases_live_only_in_the_alias_table():
    src = agent_source()
    tree = ast.parse(src)
    alias_table = [n for n in tree.body if isinstance(n, ast.Assign)
                   and any(getattr(t, "id", None) == "USE_CASES_QUALITY_ALIASES" for t in n.targets)][0]
    lines = src.split("\n")
    outside = "\n".join(lines[:alias_table.lineno - 1] + lines[alias_table.end_lineno:])
    for legacy in ("Coverage Mode (All)", "Strict Quality", "Very High Quality", "Good Quality"):
        assert legacy not in outside, legacy


# ---------------------------------------------------------------- 2. min_use_cases_for_selection removed


def test_min_use_cases_for_selection_is_not_a_runtime_setting(agent_ns):
    assert "min_use_cases_for_selection" not in agent_ns["TECHNICAL_CONTEXT"]["runtime"]
    assert "min_use_cases_for_selection" not in agent_source()


def test_runtime_config_still_validates_and_still_rejects_out_of_bounds(fresh_ns):
    fresh_ns["_validate_runtime_config"]()
    fresh_ns["TECHNICAL_CONTEXT"]["runtime"]["aggressive_prune_threshold"] = 0
    with pytest.raises(ValueError, match="aggressive_prune_threshold"):
        fresh_ns["_validate_runtime_config"]()


# ---------------------------------------------------------------- 3. one canonical mode source


@pytest.mark.parametrize("value,expected", [("Ultra High", True), ("ultra high", True), ("  ULTRA HIGH ", True),
                                            ("High", False), ("Good", False), ("Very High Quality", False),
                                            ("Strict Quality", False), ("Coverage Mode (All)", False), (None, False),
                                            ("", False)])
def test_is_ultra_high_mode_reads_the_canonical_parser(agent_ns, value, expected):
    obj = agent_ns["DatabricksInspire"].__new__(agent_ns["DatabricksInspire"])
    obj.use_cases_quality = value
    assert obj._is_ultra_high_mode() is expected


def test_is_ultra_high_mode_rejects_an_unknown_mode_instead_of_running_good(agent_ns):
    obj = agent_ns["DatabricksInspire"].__new__(agent_ns["DatabricksInspire"])
    obj.use_cases_quality = "Ultra"
    with pytest.raises(ValueError, match="Valid options"):
        obj._is_ultra_high_mode()


def test_is_ultra_high_mode_delegates_to_canonical_use_cases_quality():
    src = ast.unparse(method_node("DatabricksInspire", "_is_ultra_high_mode"))
    assert "canonical_use_cases_quality(" in src


# ---------------------------------------------------------------- 4. elite evidence repair


STOCK = {"comment": "Stock on hand per item", "table_type": "MANAGED", "tags": {}, "last_altered": None,
         "columns": {c["name"]: c for c in (col("item_id", "BIGINT", "Item key"), col("on_hand", "INT", "Units on hand"),
                                            col("bin_label", "STRING"))},
         "primary_key": ["item_id"], "foreign_keys": []}


class RepairAgent(Agent):
    def __init__(self):
        super().__init__()
        self.repair = {}

    def run_worker(self, step_name, worker_prompt_path, prompt_vars, **kw):
        if worker_prompt_path == JUDGE and str(step_name).startswith(REPAIR_STEP):
            with self.lock:
                self.calls.append({"prompt": REPAIR_STEP, "vars": dict(prompt_vars), "skip_cache": kw.get("skip_cache"),
                                   "start_from_model": kw.get("start_from_model"), "step": step_name})
            found = ids(prompt_vars["use_cases_to_judge"])
            return json.dumps([dict(self.repair[i], No=i) for i in found if i in self.repair])
        return super().run_worker(step_name, worker_prompt_path, prompt_vars, **kw)


def repair_inspire(ns, user_domains=None):
    evidence = dict(copy.deepcopy(EVIDENCE), **{"c.s.stock": copy.deepcopy(STOCK)})
    obj = inspire(ns, user_domains=user_domains, loader=Loader(evidence=evidence))
    obj.ai_agent = RepairAgent()
    return obj


def repair_calls(obj):
    return obj.ai_agent.prompts(REPAIR_STEP)


def stock_assessment(**over):
    base = dict(signal_columns=["c.s.stock.on_hand"], entity_key_column="c.s.stock.item_id", join_path=[],
                value_driver="Falling `c.s.stock.on_hand` per `c.s.stock.item_id` triggers the weekly reorder")
    base.update(over)
    return assessment(**base)


@pytest.mark.parametrize("slip,failure", [
    ({"signal_columns": ["c.s.orders.amout", "c.s.orders.ordered_at"]},
     "signal column not found in the use case's tables: c.s.orders.amout"),
    ({"time_column": "c.s.orders.order_day_text"},
     "time column c.s.orders.order_day_text is STRING, not DATE or TIMESTAMP"),
    ({"join_path": ["c.s.orders.cust_id = c.s.customers.customer_id"]},
     "join column not found in the use case's tables: c.s.orders.cust_id"),
])
def test_citation_slip_with_an_existing_correct_column_becomes_elite_after_one_repair(ns, slip, failure):
    obj = repair_inspire(ns)
    obj.ai_agent.judge = {"A": assessment(**slip)}
    obj.ai_agent.repair = {"A": assessment()}
    final, _ = select(obj, [make_uc("A")])
    assert [(u["No"], u["elite_status"]) for u in final] == [("A", "ELITE")]
    calls = repair_calls(obj)
    assert len(calls) == 1 and calls[0]["skip_cache"] is True
    assert calls[0]["start_from_model"] == obj._pinned_elite_judge(), "the repair re-judges on the run's pinned judge"
    text = calls[0]["vars"]["use_cases_to_judge"]
    assert failure in text
    assert "`amount` DECIMAL(10,2) (Order value)" in text and "`ordered_at` TIMESTAMP (Order time)" in text
    assert "`segment` STRING" in text and "`order_day_text` STRING" in text
    a = final[0]["elite_assessment"]
    assert a["verification"]["passed"] is True
    assert a["evidence_repair"] == {"failures": [failure], "outcome": "passed"}
    assert ledger(obj, "elite_evidence_repair") == {"stage": "elite_evidence_repair", "in": 1, "out": 1, "drops": {}}


def test_repair_runs_between_the_judge_and_the_verification_ledger(ns):
    obj = repair_inspire(ns)
    obj.ai_agent.judge = {"A": assessment(signal_columns=["c.s.orders.amout"])}
    obj.ai_agent.repair = {"A": assessment()}
    select(obj, [make_uc("A")])
    s = stages(obj)
    assert s.index("elite_judge") < s.index("elite_evidence_repair") < s.index("elite_verification")
    assert ledger(obj, "elite_verification") == {"stage": "elite_verification", "in": 1, "out": 1, "drops": {}}


def test_missing_time_column_in_the_data_stays_rejected_after_exactly_one_repair(ns):
    obj = repair_inspire(ns)
    obj.ai_agent.judge = {"S": stock_assessment(time_column="c.s.stock.bin_label")}
    obj.ai_agent.repair = {"S": stock_assessment(time_column=None)}
    final, rejected = select(obj, [make_uc("S", tables="c.s.stock")])
    assert rejected == [], "the one candidate is rejected from elite but ships below bar, so nothing is left unselected"
    assert [u["No"] for u in final] == ["S"] and final[0]["fallback_kind"] == "tier", \
        "rejected from elite on a fatal verification failure, but the run ships the closest High-tier candidate below bar"
    assert len(repair_calls(obj)) == 1
    a = final[0]["elite_assessment"]
    assert a["evidence_repair"] == {"failures": ["time column c.s.stock.bin_label is STRING, not DATE or TIMESTAMP"],
                                    "outcome": "failed"}
    assert a["failed_gates"] == ["verification"]
    assert "Forecasting needs a DATE or TIMESTAMP time column and none is cited" in a["verification"]["failures"]
    assert "evidence repair failed" in final[0]["selection_drop_reason"]
    assert ledger(obj, "elite_evidence_repair")["drops"] == {"verification": 1}
    assert ledger(obj, "elite_verification")["drops"] == {"verification": 1}


def test_missing_outcome_column_in_the_data_stays_rejected_after_exactly_one_repair(ns):
    obj = repair_inspire(ns)
    first = stock_assessment(time_column=None,
                             outcome_definition={"column": "c.s.stock.stockout_flag", "derived_from": [], "rule": "",
                                                 "label_timing": "same_window"})
    repaired = stock_assessment(time_column=None,
                                outcome_definition={"column": "c.s.stock.stocked_out", "derived_from": [], "rule": "",
                                                    "label_timing": "same_window"})
    obj.ai_agent.judge = {"C": first}
    obj.ai_agent.repair = {"C": repaired}
    final, rejected = select(obj, [make_uc("C", tables="c.s.stock", **{"Analytics Technique": "Classification"})])
    assert [u["No"] for u in final] == ["C"] and final[0]["fallback_kind"] == "tier"
    assert len(repair_calls(obj)) == 1
    failures = final[0]["elite_assessment"]["verification"]["failures"]
    assert "outcome column not found in the use case's tables: c.s.stock.stocked_out" in failures
    assert any("needs an outcome column that exists" in f for f in failures)
    assert final[0]["elite_assessment"]["evidence_repair"]["outcome"] == "failed"


def test_a_repaired_assessment_is_never_repaired_again(ns):
    obj = repair_inspire(ns)
    uc = make_uc("S", tables="c.s.stock")
    obj.ai_agent.judge = {"S": stock_assessment(time_column="c.s.stock.bin_label")}
    obj.ai_agent.repair = {"S": stock_assessment(time_column="c.s.stock.counted_at")}
    select(obj, [uc])
    assert len(repair_calls(obj)) == 1
    rt = ns["TECHNICAL_CONTEXT"]["runtime"]
    evidence = obj._load_elite_evidence([uc])
    obj._repair_elite_evidence([uc], SCHEMA, evidence, dict(CONTEXT), rt)
    assert len(repair_calls(obj)) == 1, "a second verification failure must never trigger a second repair"
    assert uc["elite_assessment"]["evidence_repair"]["outcome"] == "failed"


def test_second_opinion_citation_failure_never_triggers_a_repair(ns):
    obj = repair_inspire(ns)
    obj.ai_agent.judge = {"N": assessment(verdict="NEAR_MISS", signal_columns=["c.s.orders.amout"],
                                          scores={"implementability": 7})}
    obj.ai_agent.repair = {"N": assessment(verdict="NEAR_MISS", scores={"implementability": 7})}
    obj.ai_agent.second = {"N": assessment(signal_columns=["c.s.orders.amout"])}
    final, rejected = select(obj, [make_uc("N")])
    assert [u["No"] for u in final] == ["N"] and final[0]["fallback_kind"] == "near_miss", \
        "a second-opinion rejection has no fatal flaw, so it ships as the closest near miss below bar"
    assert len(repair_calls(obj)) == 1
    a = final[0]["elite_assessment"]
    assert a["evidence_repair"]["outcome"] == "passed"
    assert a["second_opinion"]["verification"]["passed"] is False
    assert a["failed_gates"][-1] == "second_opinion_reject"


def test_failure_of_the_use_cases_own_tables_is_never_repaired(ns):
    obj = repair_inspire(ns)
    obj.ai_agent.judge = {"G": assessment()}
    obj.ai_agent.repair = {"G": assessment()}
    final, _ = select(obj, [make_uc("G", tables="c.s.orders, c.s.customers, c.s.ghost")])
    assert [u["No"] for u in final] == ["G"] and final[0]["fallback_kind"] == "tier" and repair_calls(obj) == []
    assert ledger(obj, "elite_evidence_repair") == {"stage": "elite_evidence_repair", "in": 0, "out": 0, "drops": {}}


def test_a_use_case_the_judge_itself_rejects_is_not_repaired(ns):
    obj = repair_inspire(ns)
    obj.ai_agent.judge = {"R": assessment(verdict="REJECT", signal_columns=["c.s.orders.amout"],
                                          scores={"business_value": 4})}
    obj.ai_agent.repair = {"R": assessment()}
    final, _ = select(obj, [make_uc("R")])
    assert [u["No"] for u in final] == ["R"] and final[0]["fallback_kind"] == "tier" and repair_calls(obj) == []


def test_unanswered_repair_keeps_the_original_rejection(ns):
    obj = repair_inspire(ns)
    obj.ai_agent.judge = {"A": assessment(signal_columns=["c.s.orders.amout"])}
    final, rejected = select(obj, [make_uc("A")])
    assert [u["No"] for u in final] == ["A"] and final[0]["fallback_kind"] == "tier"
    a = final[0]["elite_assessment"]
    assert a["evidence_repair"]["outcome"] == "unjudged"
    assert a["verification"]["failures"] == ["signal column not found in the use case's tables: c.s.orders.amout"]
    assert ledger(obj, "elite_evidence_repair")["drops"] == {"unjudged": 1}
    assert all(c["skip_cache"] is True for c in repair_calls(obj))


def test_repair_happens_once_per_use_case_in_a_mixed_batch(ns):
    obj = repair_inspire(ns)
    ucs = [make_uc("OK"), make_uc("SLIP", name="Detect late deliveries per customer"),
           make_uc("STOCK", tables="c.s.stock", name="Forecast weekly stock on hand")]
    obj.ai_agent.judge = {"OK": assessment(), "SLIP": assessment(entity_key_column="c.s.customers.cust_id"),
                          "STOCK": stock_assessment(time_column="c.s.stock.bin_label")}
    obj.ai_agent.repair = {"SLIP": assessment(), "STOCK": stock_assessment(time_column=None)}
    final, _ = select(obj, ucs)
    assert {u["No"] for u in final if u["meets_quality_bar"] == "Y"} == {"OK", "SLIP"}
    assert [u["No"] for u in final if u["meets_quality_bar"] == "N"] == ["STOCK"]
    repaired = [i for c in repair_calls(obj) for i in ids(c["vars"]["use_cases_to_judge"])]
    assert sorted(repaired) == ["SLIP", "STOCK"]
    assert ledger(obj, "elite_evidence_repair") == {"stage": "elite_evidence_repair", "in": 2, "out": 1,
                                                    "drops": {"verification": 1}}


class RepairUltraAgent(UltraAgent):
    def __init__(self, judge, repair):
        super().__init__(judge)
        self.repair = repair

    def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema=None, **kw):
        if worker_prompt_path == JUDGE and str(step_name).startswith(REPAIR_STEP):
            with self.lock:
                self.calls.append((REPAIR_STEP, kw.get("skip_cache", False), kw.get("start_from_model")))
            out = []
            for uc_id, name in re.findall(r"### Use Case: (\S+) - (.+)", prompt_vars["use_cases_to_judge"]):
                item = self.repair(name.strip())
                if item is not None:
                    out.append(dict(item, No=uc_id))
            return json.dumps(out)
        return super().run_worker(step_name, worker_prompt_path, prompt_vars, response_schema, **kw)


def test_ultra_high_run_repairs_a_citation_slip_end_to_end(agent_ns, tmp_path, quiet_root_logger):
    slipped = "Forecast items demand 1"

    def judge(name):
        table = name.split()[1]
        if name == slipped:
            return run_assessment(table, signal_columns=[f"cat.sch.{table}.amt", f"cat.sch.{table}.event_ts"])
        return run_assessment(table)

    obj = build_ultra(agent_ns, tmp_path, judge)
    obj.ai_agent = RepairUltraAgent(judge, lambda name: run_assessment(name.split()[1]))
    obj.run()
    final = obj.recorded["tracking"][-1]
    repaired = [u for u in final if u["Name"] == slipped]
    assert len(repaired) == 1 and repaired[0]["elite_status"] == "ELITE"
    assert repaired[0]["elite_assessment"]["evidence_repair"] == {
        "failures": ["signal column not found in the use case's tables: cat.sch.items.amt"], "outcome": "passed"}
    repair_runs = [c for c in obj.ai_agent.calls if c[0] == REPAIR_STEP]
    assert len(repair_runs) == 1 and repair_runs[0][1] is True
    by_stage = {e["stage"]: e for e in obj.final_inspire_results_json["funnel_ledger"]}
    assert by_stage["elite_evidence_repair"] == {"stage": "elite_evidence_repair", "in": 1, "out": 1, "drops": {}}


def test_verification_marks_only_citation_failures_as_repairable(ns):
    obj = inspire(ns)
    evidence = copy.deepcopy(EVIDENCE)
    uc = make_uc("A")
    assert obj._verify_elite_evidence(uc, assessment(), evidence)["repairable"] is False
    slip = obj._verify_elite_evidence(uc, assessment(signal_columns=["c.s.orders.amout"]), evidence)
    assert slip["passed"] is False and slip["repairable"] is True
    ghost = obj._verify_elite_evidence(make_uc("G", tables="c.s.orders, c.s.ghost"),
                                       assessment(signal_columns=["c.s.orders.amout"]), evidence)
    assert ghost["repairable"] is False
    obj._find_join_path = lambda tables: {"connected": False, "path": [], "strength": "none"}
    unjoined = obj._verify_elite_evidence(uc, assessment(), evidence)
    assert unjoined["passed"] is False and unjoined["repairable"] is False


def test_judge_prompt_explains_the_repair_inputs(ns):
    text = ns["PROMPT_TEMPLATES"][JUDGE]
    assert "**verification failures**" in text and "**real columns**" in text
    assert "never repeat a failed citation" in text
    assert ns["audit_prompts_for_data_access_leak"]({JUDGE: text}) == []


# ---------------------------------------------------------------- 5. Q3 reads the shared temporal families


def _reference_survival_uc():
    return U("N07-U01", "Estimate Rate Shift Timing to Hedge Payments", "Survival Analysis", "main.shop.fx_rates",
             "Estimate the time-to-event of `usd_rate` moves over `rate_date` per `currency` with Kaplan-Meier.")


def test_q3_temporal_rule_follows_the_shared_temporal_families(ns, fresh_ns):
    kept, _ = make(ns)._phaseQ3_validate_relevance([_reference_survival_uc()], GATE_SCHEMA)
    assert "Q3_R5_REFERENCE_AS_FACT" in kept[0]["gate_flags"]
    fresh_ns["DatabricksInspire"]._TEMPORAL_FAMILIES = frozenset({"forecasting", "trend", "cohort"})
    kept, _ = make(fresh_ns)._phaseQ3_validate_relevance([_reference_survival_uc()], GATE_SCHEMA)
    assert "Q3_R5_REFERENCE_AS_FACT" not in (kept[0].get("gate_flags") or [])


def test_q3_has_no_local_temporal_family_set():
    src = ast.unparse(method_node("DatabricksInspire", "_phaseQ3_validate_relevance"))
    assert "self._TEMPORAL_FAMILIES" in src
    assert "{'forecasting', 'trend', 'cohort', 'survival'}" not in src


# ---------------------------------------------------------------- 6. relabelled use cases in Q3 and Q5


TEXT_SCHEMA = [("c", "s", "tickets", "ticket_ref", "STRING", ""), ("c", "s", "tickets", "ticket_body", "STRING", ""),
               ("c", "s", "tickets", "opened_at", "TIMESTAMP", ""),
               ("c", "s", "visits", "visit_ref", "STRING", ""), ("c", "s", "visits", "channel", "STRING", ""),
               ("c", "s", "visits", "visited_at", "TIMESTAMP", ""),
               ("c", "s", "notes", "note_text", "STRING", ""), ("c", "s", "notes", "noted_at", "TIMESTAMP", "")]
TEXT_TABLES = {"c.s.tickets": "TRANSACTIONAL", "c.s.visits": "TRANSACTIONAL", "c.s.notes": "TRANSACTIONAL"}


def text_gates(ns):
    return make(ns, schema=TEXT_SCHEMA, data_category_map=dict(TEXT_TABLES), global_table_names=set(TEXT_TABLES))


def topic_uc(no="N08-U01", tech="AI Analysis", tables="c.s.tickets"):
    return U(no, "Route Complaint Themes from Ticket Text to Owning Teams", tech, tables,
             "Run BERTopic over `ticket_body` and assign each weekly `opened_at` bucket's tickets to a complaint theme "
             "that routes to its owning team.",
             hld="BERTopic topic model over `ticket_body`; weekly theme counts by `opened_at`.")


def test_relabelled_topic_model_use_case_survives_q3_on_a_text_table(ns):
    o = text_gates(ns)
    relabelled = o._phaseG_validate_no_catchall_technique([topic_uc()])
    assert relabelled[0]["Analytics Technique"] == "Clustering"
    kept, dropped = o._phaseQ3_validate_relevance(relabelled, TEXT_SCHEMA)
    assert [u["No"] for u in kept] == ["N08-U01"] and dropped == []


def test_clustering_that_names_a_text_column_survives_q3_r2(ns):
    o = text_gates(ns)
    u = U("N08-U02", "Group Ticket Complaints into Themes for Weekly Triage", "Clustering", "c.s.tickets",
          "Embed `ticket_body` with ai_query and cluster the embeddings per `opened_at` week into complaint themes.",
          hld="Embedding clustering over `ticket_body`.")
    kept, dropped = o._phaseQ3_validate_relevance([u], TEXT_SCHEMA)
    assert [x["No"] for x in kept] == ["N08-U02"] and dropped == []


def test_two_column_text_table_topic_clustering_is_not_under_featured(ns):
    o = text_gates(ns)
    u = U("N08-U03", "Route Note Themes to Owning Teams", "Clustering", "c.s.notes",
          "Run BERTopic over `note_text` per `noted_at` week and route each theme to its owner.",
          hld="BERTopic topic model over `note_text`.")
    kept, dropped = o._phaseQ3_validate_relevance([u], TEXT_SCHEMA)
    assert [x["No"] for x in kept] == ["N08-U03"] and dropped == []


def test_numeric_clustering_on_a_table_without_measures_still_fails_q3_r2(ns):
    o = text_gates(ns)
    u = U("N08-U04", "Segment Visit Patterns to Target Channel Offers", "Clustering", "c.s.visits",
          "Segment visits with k-means on `visited_at` hour and `channel` to target offers.",
          hld="K-Means over visit features.")
    kept, dropped = o._phaseQ3_validate_relevance([u], TEXT_SCHEMA)
    assert kept == [] and reasons(dropped)["N08-U04"] == "UC_NOT_RELEVANT:R2_TECHNIQUE_DATA_MISMATCH:Clustering"


def test_topic_design_without_a_text_column_still_fails_q3_r2(ns):
    o = text_gates(ns)
    u = U("N08-U05", "Theme Visit Channels to Target Offers", "Clustering", "c.s.visits",
          "Run BERTopic over the `channel` values per `visited_at` week to target offers.",
          hld="BERTopic topic model.")
    kept, dropped = o._phaseQ3_validate_relevance([u], TEXT_SCHEMA)
    assert kept == [] and reasons(dropped)["N08-U05"] == "UC_NOT_RELEVANT:R2_TECHNIQUE_DATA_MISMATCH:Clustering"


@pytest.mark.parametrize("tech,tables,solution", [
    ("Clustering", "c.s.tickets",
     "Run BERTopic over `ticket_body` per `opened_at` week and route each theme to its owning team."),
    ("Recommendation", "main.shop.order_items, main.shop.products",
     "Mine frequent baskets with FP-Growth on `order_id` and `product_id` and publish the top bundles to merchandising."),
    ("Pareto Analysis", "main.shop.orders, main.shop.stores",
     "Order stores with percent_rank over `total_amount` per `store_id` and publish the top decile."),
])
def test_relabelled_technique_is_not_flagged_as_label_drift(ns, tech, tables, solution):
    o = make(ns)
    u = U("N09-U01", "Publish Weekly Priority List for Owners", tech, tables, solution, hld=solution)
    kept, dropped = o._phaseQ5_decision_readiness([u], [])
    assert dropped == []
    assert not [f for f in kept[0].get("gate_flags", []) if f.startswith("Q5_R18_")]


def test_real_label_drift_is_still_flagged(ns):
    o = make(ns)
    u = U("N09-U02", "Project Weekly Store Revenue", "Forecasting", "main.shop.orders, main.shop.stores",
          "Group stores with k-means on `total_amount` and `order_date` and publish the store groups.",
          hld="K-Means with silhouette-based k.")
    kept, _ = o._phaseQ5_decision_readiness([u], [])
    assert kept[0]["gate_flags"] == ["Q5_R18_TECHNIQUE_LABEL_DRIFT:forecasting"]


# ---------------------------------------------------------------- 7. elite judge context is never fabricated


def test_elite_judge_gets_the_not_provided_marker_never_a_default(ns):
    obj = inspire(ns)
    obj.ai_agent.judge = {"A": assessment()}
    obj._select_scored_use_cases([make_uc("A")], SCHEMA, {})
    v = obj.ai_agent.prompts(JUDGE)[0]["vars"]
    marker = ns["prompt_context_or_not_provided"]
    assert v["industry"] == marker("", "industry") and v["industry"] != "General"
    for key, label in (("strategic_initiative", "strategic initiative"), ("value_chain", "value chain"),
                       ("revenue_model", "revenue model")):
        assert v[key] == marker("", label), key
    assert "strategic_goals" not in v and "business_priorities" not in v, "the judge is strategy-blind"
    assert "UNKNOWN_FROM_METADATA" in v["business_context"]


def test_elite_judge_keeps_provided_context_verbatim(ns):
    obj = inspire(ns)
    obj.ai_agent.judge = {"A": assessment()}
    select(obj, [make_uc("A")])
    v = obj.ai_agent.prompts(JUDGE)[0]["vars"]
    assert v["industry"] == "General" and "strategic_goals" not in v, "provided goals never reach the judge"
    assert "Reduce Cost" not in json.dumps(v, default=str)
    assert v["value_chain"] == "Order to delivery" and v["business_context"] == "A multi-region operator"


# ---------------------------------------------------------------- docs match the elite code


def _doc(relative):
    with open(os.path.join(ROOT, relative), encoding="utf-8") as fh:
        return fh.read()


def test_docs_name_every_elite_stage_the_result_keys_and_the_runtime_keys(ns):
    source = agent_source()
    shared = set(re.findall(r'_log_funnel_stage\(\s*f"\{stage\}_([a-z_]+)"', source))
    stage_names = set(re.findall(r'_log_funnel_stage\(\s*"(elite_[a-z_]+)"', source)) | {f"elite_{s}" for s in shared}
    assert "elite_evidence_repair" in stage_names and len(stage_names) == 9
    assert shared == {"judge", "evidence_repair", "verification", "second_opinion", "overlap"}
    integration, design, readme = _doc("docs/integration-guide.md"), _doc("docs/design-guide.md"), _doc("readme.md")
    cell0 = notebook_cells()[0][1]
    for stage in sorted(stage_names | {f"best_of_best_{s}" for s in shared}):
        assert f"`{stage}`" in integration and f"`{stage}`" in design, stage
    for text in (integration, design, readme, cell0):
        assert "elite_outcome" in text and "funnel_ledger" in text and "selection_outcome" in text
    for key in (k for k in ns["TECHNICAL_CONTEXT"]["runtime"] if k.startswith("ultra_high_")):
        assert f"`{key}`" in design, key
    for text in (integration, design, readme, cell0):
        assert "min_use_cases_for_selection" not in text
