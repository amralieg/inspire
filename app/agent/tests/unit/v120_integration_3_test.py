"""v1.2.0 INTEGRATION-3: RUNTIME cross-lane items and WS7 speed for every quality mode.

1. Tables whose metadata could not be loaded (DataLoader.metadata_unavailable_report) reach the run outcome:
   processing_honesty, one ended_warning step naming them, the honesty report, results_json
   (metadata_unavailable and llm_endpoint_health) and a "completed with warnings" banner and final status.
2. Global dedup starts on the thinker and cascades (start_from_model) instead of pinning it; a cascade may
   start at a model outside the prompt's own bucket. The "CSV contains no use case IDs" class: the honesty
   extractor no longer deletes a CSV body that follows a preamble or a fence, or JSON text that mentions a
   score; the dedup and assignment parsers read the id column by name (or headerless), and ids outside
   the reviewed set never empty the portfolio.
3. Business context: the context prompt never receives the business name as the industry, drops
   "detailed, realistic", and strategic_initiative / revenue_model come back UNKNOWN_FROM_METADATA (no user
   input carries them); generation, combined scoring, Best-of-Best and the elite judge carry one shared
   ASSUMED_CONTEXT_RULE: `[ASSUMPTION ...]` text is a hypothesis, never evidence.
4. One Priority source: the per-domain value pass, its helpers, the 9.5 normalization, the legacy
   quality-only path and their two prompts are gone; G2/Q2 tie-breaks never read a pre-scoring Priority
   and the early ids are provisional (generation-id order, no score).
5. Every mode ends with the final-rank renumber (`_finalize_portfolio_order`) before Phase L and the
   artifacts, so ids and domain order follow the final rank in Good and High too.
6. Combined scoring and Best-of-Best send each batch only its own tables plus their FK partners (shared
   with the elite judge via `_uc_batch_tables`); unqualified refs resolve by suffix, an unresolvable batch
   and a subset that would not be smaller fall back to the full schema.
7. The LLM response cache and the local log backup get the B17 Serverless fallback through one helper
   pair (`b17_writable_dir` beside `b17_writable_file`).
8. compute_result_table_name returns a backtick-quoted, valid three-level name.

Every behavioural fix has a case that fails on dev 1bdb318 and a must-exclude case.
"""
import json
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import load_agent_namespace  # noqa: E402
from v120_artifacts_support import make_inspire  # noqa: E402
from v120_run_offline_smoke_test import _build, quiet_root_logger  # noqa: E402,F401

GOOD = {"Medium", "High", "Very High", "Ultra High"}
LOST = [{"table": "cat.sch.ledger", "reason": "timeout after 3 attempts: metadata query timed out"},
        {"table": "cat.sch.payroll", "reason": "DESCRIBE permission denied: PERMISSION_DENIED"}]


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def _scored(uc_id):
    return {"use_case_id": uc_id, "quality_label": "High", "quality_score": 4.0, "priority_score": 7.0,
            "quality_summary": "Columns `id` and `amount` aggregated by store give the KPI that drives the outcome."}


def _capture_log_print(agent_ns, monkeypatch):
    printed = []
    monkeypatch.setitem(agent_ns["DatabricksInspire"].run.__globals__, "log_print",
                        lambda message, level="INFO", flush=True: printed.append((level, str(message))))
    return printed


def _with_lost_tables(obj, lost):
    obj.data_loader.metadata_unavailable_report = lambda: {"count": len(lost), "tables": [dict(e) for e in lost]}
    return obj


class _FinalizeRecorder:
    def __init__(self):
        self.calls = []

    def finalize_pipeline(self, **kw):
        self.calls.append(kw)


class _ReportingLoader:
    def __init__(self, lost):
        self.lost = lost

    def metadata_unavailable_report(self):
        return {"count": len(self.lost), "tables": [dict(e) for e in self.lost]}


# ---------------------------------------------------------------- 1. metadata_unavailable reaches the run outcome


def test_run_records_lost_tables_in_honesty_step_results_and_banner(agent_ns, tmp_path, quiet_root_logger,
                                                                    monkeypatch):
    printed = _capture_log_print(agent_ns, monkeypatch)
    obj = _with_lost_tables(_build(agent_ns, tmp_path, "Good", GOOD, _scored), LOST)
    del obj._report_processing_honesty
    obj.run()
    assert obj.processing_honesty["tables_metadata_unavailable"] == LOST
    warn_steps = [s for s in obj.atomic_writer.steps
                  if s["status"] == "ended_warning" and s.get("result_json", {}).get("tables") == LOST]
    assert len(warn_steps) == 1, "exactly one ended_warning step names the lost tables"
    assert warn_steps[0]["result_json"]["count"] == 2
    results = obj.final_inspire_results_json
    assert results["metadata_unavailable"] == {"count": 2, "tables": LOST}
    health = results["llm_endpoint_health"]
    assert set(health) == {"unusable", "temperature_unsupported", "probed", "json_format", "demoted"}
    honesty = "\n".join(m for _, m in printed)
    assert "cat.sch.ledger" in honesty and "cat.sch.payroll" in honesty
    assert "100% HONEST" not in honesty
    banners = [m for level, m in printed if level == "WARNING" and "COMPLETED WITH WARNINGS" in m]
    assert len(banners) == 1
    assert "2 tables without metadata stayed out of the analysis: cat.sch.ledger" in banners[0]
    assert not [m for _, m in printed if "generated successfully" in m]


def test_run_without_lost_tables_keeps_the_success_banner_and_no_warning_step(agent_ns, tmp_path,
                                                                             quiet_root_logger, monkeypatch):
    printed = _capture_log_print(agent_ns, monkeypatch)
    obj = _with_lost_tables(_build(agent_ns, tmp_path, "Good", GOOD, _scored), [])
    obj.run()
    assert obj.processing_honesty["tables_metadata_unavailable"] == []
    assert not [s for s in obj.atomic_writer.steps if "tables" in (s.get("result_json") or {})]
    assert obj.final_inspire_results_json["metadata_unavailable"] == {"count": 0, "tables": []}
    assert [m for _, m in printed if "generated successfully" in m]
    assert not [m for _, m in printed if "WITH WARNINGS" in m]


def test_run_reports_lost_tables_once_even_when_more_are_lost_later(agent_ns, tmp_path, quiet_root_logger):
    obj = _with_lost_tables(_build(agent_ns, tmp_path, "Good", GOOD, _scored), LOST[:1])
    augment = obj._augment_columns_with_related_tables

    def lose_second(cols):
        _with_lost_tables(obj, LOST)
        return augment(cols)

    obj._augment_columns_with_related_tables = lose_second
    obj.run()
    named = [s["result_json"]["tables"] for s in obj.atomic_writer.steps
             if s["status"] == "ended_warning" and "tables" in (s.get("result_json") or {})]
    assert named == [LOST[:1], LOST[1:]], "each lost table is named in exactly one warning step"
    assert obj.final_inspire_results_json["metadata_unavailable"]["count"] == 2


def test_run_without_any_loaded_table_fails_and_names_the_lost_tables(agent_ns, tmp_path, quiet_root_logger):
    obj = _with_lost_tables(_build(agent_ns, tmp_path, "Good", GOOD, _scored), LOST)
    obj.data_loader._batches = []
    with pytest.raises(RuntimeError) as err:
        obj.run()
    named = [s["result_json"]["tables"] for s in obj.atomic_writer.steps
             if s["status"] == "ended_warning" and "tables" in (s.get("result_json") or {})]
    assert named == [LOST]
    assert "cat.sch.ledger (timeout after 3 attempts" in str(err.value) and "cat.sch.payroll (DESCRIBE" in str(err.value)


def test_final_status_is_completed_with_warnings_when_tables_were_lost(ns):
    obj = make_inspire(ns, data_loader=_ReportingLoader(LOST))
    obj.atomic_writer = _FinalizeRecorder()
    obj.finalize_atomic_writer(success=True)
    call = obj.atomic_writer.calls[-1]
    assert call["status"] == "ended_warning"
    assert call["message"].startswith("Completed with warnings: 2 tables without metadata stayed out of the analysis: ")
    assert "cat.sch.ledger (timeout after 3 attempts" in call["message"]
    assert call["final_results_json"]["metadata_unavailable"]["tables"] == LOST
    assert "llm_endpoint_health" in call["final_results_json"]


def test_final_status_stays_a_success_without_lost_tables(ns):
    obj = make_inspire(ns, data_loader=_ReportingLoader([]))
    obj.atomic_writer = _FinalizeRecorder()
    obj.finalize_atomic_writer(success=True)
    call = obj.atomic_writer.calls[-1]
    assert call["status"] == "ended_success" and call["message"] == "Completed"
    assert call["final_results_json"]["metadata_unavailable"] == {"count": 0, "tables": []}


def test_run_outcome_has_no_metadata_report_without_a_loader(ns):
    obj = make_inspire(ns)
    assert obj._run_outcome_warnings() == []
    assert obj._merge_run_outcome_into_results()["metadata_unavailable"] == {"count": 0, "tables": []}


def test_results_json_carries_the_endpoint_health_snapshot(fresh_ns):
    fresh_ns["LLM_ENDPOINT_HEALTH"].mark_unusable("databricks-x", "not supported for batch inference")
    obj = make_inspire(fresh_ns)
    health = obj._merge_run_outcome_into_results()["llm_endpoint_health"]
    assert health["unusable"] == {"databricks-x": "not supported for batch inference"}


# ---------------------------------------------------------------- 2. global dedup cascades; dedup parsing survives every answer shape


from v120_runtime_reliability_test import FakeConnectSpark, RecordingLogger, make_agent  # noqa: E402

THINKER = "databricks-thinker-large"
WORKER = "databricks-worker-large"
SMALL = "databricks-worker-small"


def _roster(ns):
    ns["TECHNICAL_CONTEXT"]["models"] = [
        {"name": name.replace("databricks-", ""), "order": order, "type": mtype, "size": size, "enabled": True,
         "llm_endpoint_name": name, "llm_input_context_tokens_count": 200000, "llm_output_context_tokens_count": 64000}
        for order, (name, mtype, size) in enumerate(
            [(THINKER, "thinker", "large"), (WORKER, "worker", "large"), (SMALL, "worker", "small")], start=1)]


def test_cascade_from_a_model_outside_the_prompt_bucket_starts_there_and_falls_back_along_the_chain(fresh_ns):
    _roster(fresh_ns)
    prompt_cascade = fresh_ns["get_full_fallback_cascade"]("REVIEW_USE_CASES_PROMPT")
    assert [m["llm_endpoint_name"] for m in prompt_cascade] == [WORKER, SMALL], "the review bucket never holds the thinker"
    names = lambda ms: [m["llm_endpoint_name"] for m in ms]
    assert names(fresh_ns["cascade_from_model"](prompt_cascade, THINKER)) == [THINKER, WORKER, SMALL]
    assert names(fresh_ns["cascade_from_model"](prompt_cascade, SMALL)) == [SMALL]
    assert fresh_ns["cascade_from_model"](prompt_cascade, "databricks-unknown") == []
    fresh_ns["LLM_ENDPOINT_HEALTH"].mark_unusable(THINKER, "not supported for batch inference")
    assert fresh_ns["cascade_from_model"](prompt_cascade, THINKER) == []


class _DedupOnly:
    @staticmethod
    def build(ns, agent, logger):
        cls = ns["DatabricksInspire"]
        obj = cls.__new__(cls)
        obj.logger = logger
        obj.ai_agent = agent
        obj.parsed_generation_instructions = {}
        obj.max_parallelism = 4
        obj.atomic_writer = None
        return obj


DEDUP_UCS = [{"No": "N01-U01", "Name": "Forecast weekly store demand", "Analytics Technique": "Forecasting",
              "Tables Involved": "c.s.orders", "Statement": "s1", "Business Domain": "Sales"},
             {"No": "N02-U01", "Name": "Detect late deliveries", "Analytics Technique": "Anomaly Detection",
              "Tables Involved": "c.s.shipments", "Statement": "s2", "Business Domain": "Ops"}]


def _keep_all(op):
    rows = re.findall(r"^\| (N\d+-U\d+) \|", op["args"]["prompt_text"], re.M)
    return "use_case_id,honesty_score,honesty_justification\n" + "\n".join(f"{r},90,keep" for r in rows)


def test_global_dedup_cascades_past_a_timed_out_thinker_instead_of_falling_back(fresh_ns):
    _roster(fresh_ns)

    def responder(op):
        if op["endpoint"] == THINKER:
            raise RuntimeError("Request timed out: deadline exceeded while waiting for the model")
        return _keep_all(op)

    spark, log = FakeConnectSpark(responder), RecordingLogger()
    obj = _DedupOnly.build(fresh_ns, make_agent(fresh_ns, spark, log, retries=1), log)
    kept = obj._deduplicate_use_cases([dict(u) for u in DEDUP_UCS])
    assert [u["No"] for u in kept] == ["N01-U01", "N02-U01"]
    assert [op["endpoint"] for op in spark.ops] == [THINKER, WORKER], "one thinker attempt, then the next model"
    assert not log.matching("Falling back to per-domain"), "a slow thinker must cascade, not fail global dedup"


def test_global_dedup_still_starts_on_the_thinker(fresh_ns):
    _roster(fresh_ns)
    spark, log = FakeConnectSpark(_keep_all), RecordingLogger()
    obj = _DedupOnly.build(fresh_ns, make_agent(fresh_ns, spark, log), log)
    obj._deduplicate_use_cases([dict(u) for u in DEDUP_UCS])
    assert [op["endpoint"] for op in spark.ops] == [THINKER]


HONESTY_RESPONSES = {
    "preamble": "Here are the use cases to keep after removing duplicates:\n"
                "use_case_id,honesty_score,honesty_justification\nU1,90,keep\nU3,90,keep\n",
    "fenced": "```csv\nuse_case_id,honesty_score,honesty_justification\nU1,90,keep\nU3,90,keep\n```",
    "short_prose_with_comma": "Done, 1 duplicate removed.\nuse_case_id,honesty_score,honesty_justification\n"
                              "U1,90,keep\nU3,90,keep\n",
    "line_zero_header": "use_case_id,honesty_score,honesty_justification\nU1,90,keep\nU3,90,keep\n",
}


@pytest.mark.parametrize("shape", sorted(HONESTY_RESPONSES))
def test_honesty_extraction_never_deletes_the_csv_body(ns, shape):
    score, _just, cleaned = ns["extract_honesty_score"](HONESTY_RESPONSES[shape])
    assert score == 90
    assert "honesty" not in cleaned.lower()
    obj = _DedupOnly.build(ns, None, RecordingLogger())
    kept = obj._parse_dedup_response(cleaned, [{"No": "U1"}, {"No": "U2"}, {"No": "U3"}], "t")
    assert [u["No"] for u in kept] == ["U1", "U3"]


def test_honesty_extraction_keeps_json_text_that_mentions_a_score(ns):
    wrapped = json.dumps({"honesty_score": 80, "honesty_justification": "ok",
                          "data": [{"use_case_id": "U1", "quality_summary": "D3 score: 4 because `qty` is daily"}]})
    score, _j, cleaned = ns["extract_honesty_score"](wrapped)
    assert score == 80 and json.loads(cleaned)[0]["quality_summary"].startswith("D3 score: 4")
    bare = json.dumps([{"use_case_id": "U1", "quality_summary": "Score: 4 of 5, honesty score of the data is high"}])
    _s, _j, cleaned = ns["extract_honesty_score"](bare)
    assert json.loads(cleaned)[0]["use_case_id"] == "U1"


def test_honesty_extraction_keeps_csv_rows_that_mention_a_score(ns):
    response = "No,Justification\nU1,\"quality score: fine\"\nU2,\"credit score: 700 band\"\n"
    _s, _j, cleaned = ns["extract_honesty_score"](response)
    assert "U2" in cleaned and "credit score: 700 band" in cleaned


def test_honesty_extraction_still_strips_a_free_text_trailer(ns):
    response = "use_case_id\nU1\nU3\n\n### Honesty Self-Assessment\nhonesty_score: 85\nhonesty_justification: fine"
    _s, _j, cleaned = ns["extract_honesty_score"](response)
    assert cleaned.strip().splitlines() == ["use_case_id", "U1", "U3"]
    _s, _j, cleaned = ns["extract_honesty_score"]("use_case_id\nU1\nU3\nScore: 85/100")
    assert cleaned.strip().splitlines() == ["use_case_id", "U1", "U3"]


DEDUP_PARSE = {
    "id_header": ("ID,honesty_score,honesty_justification\nU1,90,keep\nU3,90,keep\n", ["U1", "U3"]),
    "spaced_header": ("\ufeff\"Use Case ID\",\"Honesty Score\"\n\"U1\",90\n\"U3\",90\n", ["U1", "U3"]),
    "headerless": ("U1\nU3\n", ["U1", "U3"]),
    "decorated_ids": ("use_case_id\n`U1`\n 'u3' \n", ["U1", "U3"]),
    "mention_in_justification": ("use_case_id,honesty_justification\nU1,\"_FLAG_DUPLICATE_SUSPECT: like U2\"\n",
                                 ["U1"]),
}


@pytest.mark.parametrize("shape", sorted(DEDUP_PARSE))
def test_dedup_parser_reads_the_id_column_of_every_answer_shape(ns, shape):
    response, expected = DEDUP_PARSE[shape]
    obj = _DedupOnly.build(ns, None, RecordingLogger())
    kept = obj._parse_dedup_response(response, [{"No": "U1"}, {"No": "U2"}, {"No": "U3"}], "t")
    assert [u["No"] for u in kept] == expected


def test_dedup_parser_never_drops_everything_for_unknown_ids(ns):
    obj = _DedupOnly.build(ns, None, RecordingLogger())
    with pytest.raises(ValueError):
        obj._parse_dedup_response("use_case_id\nX9\nX10\n", [{"No": "U1"}, {"No": "U2"}], "t")
    kept = obj._parse_dedup_response("use_case_id\nU1\nX9\n", [{"No": "U1"}, {"No": "U2"}], "t")
    assert [u["No"] for u in kept] == ["U1"]
    assert obj.logger.matching("X9")


@pytest.mark.parametrize("response", [
    "use_case_id,domain\nN01-U01,Sales\nN01-U02,Ops\n",
    "ID,Domain\nN01-U01,Sales\nN01-U02,Ops\n",
    "\ufeff\"Use Case ID\",\"domain\",\"honesty_score\"\n`N01-U01`,Sales,90\nN01-U02,Ops,90\n",
])
def test_assignment_parser_reads_the_id_and_value_columns_by_name(ns, response):
    obj = _DedupOnly.build(ns, None, RecordingLogger())
    assert obj._parse_assignment_csv(response, "domain", "t", [{"No": "N01-U01"}, {"No": "N01-U02"}]) == {"N01-U01": "Sales", "N01-U02": "Ops"}


def test_assignment_parser_without_the_value_column_assigns_nothing(ns):
    obj = _DedupOnly.build(ns, None, RecordingLogger())
    assert obj._parse_assignment_csv("use_case_id,subdomain\nN01-U01,Retail\n", "domain", "t", [{"No": "N01-U01"}]) == {}
    assert obj.logger.matching("no use case id or 'domain' column")


# ---------------------------------------------------------------- 3. business context is not invented from the business name


class _ContextAgent:
    def __init__(self, answer):
        self.answer = answer
        self.calls = []

    def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema=None, skip_cache=False, **kw):
        self.calls.append(dict(prompt_vars))
        return self.answer


def _context_answer(**data):
    return json.dumps({"honesty_score": 90, "honesty_justification": "x", "data": data})


def _context_inspire(ns, answer):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = RecordingLogger()
    obj.business_name = "Contoso Retail Group"
    obj.ai_agent = _ContextAgent(answer)
    return obj


def test_business_context_prompt_is_not_given_the_business_name_as_the_industry(ns):
    obj = _context_inspire(ns, _context_answer(business_context="Sells groceries"))
    obj._get_business_context_from_llm()
    sent = obj.ai_agent.calls[0]
    assert sent["name"] == "Contoso Retail Group"
    assert sent["industry"] != "Contoso Retail Group" and sent["industry"] == ns["CONTEXT_NOT_PROVIDED_MARKER"]


def test_revenue_model_and_strategic_initiative_are_unknown_unless_supplied(ns):
    obj = _context_inspire(ns, _context_answer(
        business_context="A regional grocery chain", strategic_initiative="Rolling out self-checkout in 40 stores",
        revenue_model="Retail margin plus a paid loyalty tier", value_chain="Source, stock, sell",
        strategic_goals="Reduce Cost (automation)", business_priorities="Cut shrink"))
    ctx = obj._get_business_context_from_llm()
    unknown = ns["CONTEXT_NOT_PROVIDED_MARKER"]
    assert ctx["strategic_initiative"] == unknown and ctx["revenue_model"] == unknown
    assert ctx["business_context"].startswith("[ASSUMPTION inferred from the business name")
    assert ctx["value_chain"].startswith("[ASSUMPTION inferred from the business name")
    assert ctx["business_priorities"] == [
        "[ASSUMPTION inferred from the business name 'Contoso Retail Group' only, not evidenced by the metadata] Cut shrink"]
    missing = _context_inspire(ns, _context_answer(business_context="A regional grocery chain"))
    ctx = missing._get_business_context_from_llm()
    assert ctx["strategic_initiative"] == unknown and ctx["revenue_model"] == unknown


def test_merged_industry_is_never_the_bare_business_name(ns):
    obj = _context_inspire(ns, _context_answer(business_context="A regional grocery chain\nwith 12 stores"))
    obj.logger = RecordingLogger()
    merged = obj._merge_business_contexts(obj._get_business_context_from_llm(), "")
    assert merged["industry"] != "Contoso Retail Group"
    assert merged["industry"].startswith("[ASSUMPTION inferred from the business name")


def test_business_context_prompt_drops_detailed_realistic_and_asks_for_unknown(ns):
    template = ns["PROMPT_TEMPLATES"]["BUSINESS_CONTEXT_WORKER_PROMPT"]
    assert "detailed, realistic" not in template
    for field in ("Strategic Initiative", "Revenue Model"):
        line = next(l for l in template.splitlines() if l.lstrip().startswith(("4.", "6.")) and field in l)
        assert "UNKNOWN_FROM_METADATA" in line, field


ASSUMPTION_PROMPTS = ("BASE_USE_CASE_GEN_PROMPT", "COMBINED_VALUE_QUALITY_SCORE_PROMPT",
                      "BEST_OF_BEST_SCORING_PROMPT", "ULTRA_HIGH_ELITE_JUDGE_PROMPT",
                      "USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT")


@pytest.mark.parametrize("prompt", ASSUMPTION_PROMPTS)
def test_downstream_prompts_treat_assumption_text_as_a_hypothesis(ns, prompt):
    template = ns["PROMPT_TEMPLATES"][prompt]
    rule = ns["ASSUMED_CONTEXT_RULE"]
    assert rule in template
    assert "[ASSUMPTION" in rule and "hypothesis" in rule and "never evidence" in rule
    anchor = "{revenue_model}" if "{revenue_model}" in template else "{enriched_revenue_model}"
    assert template.index(rule) > template.index(anchor), "the rule follows the context block it qualifies"


def test_the_assumption_rule_is_only_in_prompts_that_receive_the_inferred_context(ns):
    rule = ns["ASSUMED_CONTEXT_RULE"]
    carriers = sorted(name for name, body in ns["PROMPT_TEMPLATES"].items() if isinstance(body, str) and rule in body)
    assert carriers == sorted(ASSUMPTION_PROMPTS)


# ---------------------------------------------------------------- 4. one Priority source: combined scoring


REMOVED_SCORING = ("_score_per_domain_parallel", "_normalize_priority_scores", "_score_use_cases_batched",
                   "_score_use_cases", "_score_use_case_data_quality", "_parse_quality_score_response",
                   "_calculate_domain_impact_score")


@pytest.mark.parametrize("name", REMOVED_SCORING)
def test_the_per_domain_value_pass_and_its_helpers_are_gone(ns, name):
    assert not hasattr(ns["DatabricksInspire"], name)


def test_the_legacy_scoring_prompts_and_toggles_are_gone(ns):
    for prompt in ("USE_CASE_VALUE_SCORE_PROMPT", "USE_CASE_QUALITY_SCORE_PROMPT"):
        assert prompt not in ns["PROMPT_TEMPLATES"]
    runtime = ns["TECHNICAL_CONTEXT"]["runtime"]
    for key in ("use_combined_scoring", "value_scoring_retry_batch_size", "value_scoring_max_retry_rounds"):
        assert key not in runtime, key


def test_every_prompt_registry_names_a_real_prompt(ns):
    from _agentload import agent_source
    dynamic = set(re.findall(r'prompt_key = "([A-Z_]+_PROMPT)"', agent_source()))
    assert dynamic == {"DOMAINS_MERGER_PROMPT", "SUBDOMAINS_MERGER_PROMPT", "DOMAIN_SPLITTER_PROMPT"}
    templates = set(ns["PROMPT_TEMPLATES"]) | dynamic
    registries = {
        "prompts_models": {pm["prompt_name"] for pm in ns["TECHNICAL_CONTEXT"]["prompts_models"]},
        "MULTI_ENTITY_PROGRESS_PROMPTS": set(ns["MULTI_ENTITY_PROGRESS_PROMPTS"]),
        "PROMPT_STORY_TITLES": set(ns["PROMPT_STORY_TITLES"]),
        "PROMPT_STORY_STARTED_MESSAGES": set(ns["PROMPT_STORY_STARTED_MESSAGES"]),
        "COMPACT_OUTPUT_PROMPTS": set(ns["COMPACT_OUTPUT_PROMPTS"]),
        "GENERATION_DIRECTIVE_CATEGORIES_BY_PROMPT": set(ns["GENERATION_DIRECTIVE_CATEGORIES_BY_PROMPT"]),
    }
    inline = set(ns["INLINE_PROMPT_NAMES"])
    source = agent_source()
    for prompt in inline:
        assert source.count(f'"{prompt}"') >= 3, f"{prompt} is registered but no call site uses it"
    assert not inline & set(ns["PROMPT_TEMPLATES"])
    for name, keys in registries.items():
        allowed = templates | inline if name == "prompts_models" else templates
        assert keys <= allowed, (name, sorted(keys - allowed))
    interpreter = ns["PROMPT_TEMPLATES"]["GENERAL_INSTRUCTION_INTERPRETER_PROMPT"]
    listed = set(re.findall(r'"([A-Z_]+_PROMPT)": "', interpreter)) | set(re.findall(r"\| `([A-Z_]+_PROMPT)` \|", interpreter))
    assert listed and listed <= templates, sorted(listed - templates)


def test_run_never_calls_a_value_pass_and_priority_is_the_absolute_combined_score(agent_ns, tmp_path,
                                                                                 quiet_root_logger):
    obj = _build(agent_ns, tmp_path, "Good", GOOD, _scored)
    obj._score_per_domain_parallel = lambda *a, **kw: (_ for _ in ()).throw(AssertionError("value pass ran"))
    obj.run()
    final = obj.recorded["tracking"][-1]
    assert final and all(u["Priority"] == 7.0 and u["Priority Score"] == 7.0 for u in final)
    stages = [e["stage"] for e in obj.final_inspire_results_json["funnel_ledger"]]
    assert "value_scoring" not in stages
    assert stages.index("domain_clustering") < stages.index("llm_dedup") < stages.index("combined_scoring")


def _sig_twin(no, priority, design):
    return {"No": no, "Name": "Forecast weekly store demand", "Analytics Technique": "Forecasting",
            "Tables Involved": "c.s.orders", "Statement": "s", "Solution": design, "High Level Design": "",
            "Priority": priority, "Business Domain": "Sales"}


def test_g2_duplicate_tie_break_never_reads_a_pre_scoring_priority(ns):
    obj = make_inspire(ns)
    loud = _sig_twin("A", 9.5, "Forecast `qty`")
    grounded = _sig_twin("B", 0.0, "Forecast `qty` from `order_ts` per `store_id`")
    kept = obj._phaseG_validate_name_uniqueness([loud, grounded])
    assert [u["No"] for u in kept] == ["B"], "the better-grounded twin wins; no pre-scoring priority exists"


def test_g2_duplicate_tie_break_uses_the_inspire_score_once_scored(ns):
    obj = make_inspire(ns)
    strong = dict(_sig_twin("A", 0.0, "Forecast `qty`"), **{"Inspire Score": 8.0})
    weak = dict(_sig_twin("B", 0.0, "Forecast `qty` from `order_ts` per `store_id`"), **{"Inspire Score": 6.0})
    kept = obj._phaseG_validate_name_uniqueness([weak, strong])
    assert [u["No"] for u in kept] == ["A"]


def test_provisional_ids_follow_the_generation_ids_without_any_score(ns):
    obj = make_inspire(ns)

    def generated():
        return [{"No": "AI-P1_2-U1", "Business Domain": "Sales", "Priority": 9.5},
                {"No": "AI-P1_1-U2", "Business Domain": "Ops", "Priority": 9.9},
                {"No": "AI-P1_1-U1", "Business Domain": "Ops", "Priority": 0.0}]

    out = obj._assign_provisional_ids(generated())
    assert [(u["No"], u["Business Domain"], u["Priority"]) for u in out] == [
        ("N01-U01", "Ops", 0.0), ("N01-U02", "Ops", 9.9), ("N02-U01", "Sales", 9.5)]
    shuffled = obj._assign_provisional_ids(list(reversed(generated())))
    assert [(u["No"], u["Priority"]) for u in shuffled] == [(u["No"], u["Priority"]) for u in out], \
        "parallel batch completion order never changes the provisional ids"


def test_number_by_domain_keeps_the_given_order_within_each_domain(ns):
    obj = make_inspire(ns)
    ucs = [{"No": "x", "Business Domain": "Ops"}, {"No": "y", "Business Domain": ""}, {"No": "z", "Business Domain": "Ops"}]
    assert [(u["No"], u["Business Domain"]) for u in obj._number_by_domain(ucs)] == [
        ("N01-U01", "Ops"), ("N01-U02", "Ops"), ("N02-U01", "")]


# ---------------------------------------------------------------- 5. final rank renumber in every mode


@pytest.mark.parametrize("mode, acceptable", [("Good", GOOD), ("High", {"High", "Very High", "Ultra High"})])
def test_good_and_high_final_list_is_renumbered_in_final_rank_order(agent_ns, tmp_path, quiet_root_logger,
                                                                    mode, acceptable):
    priorities = {"N01-U01": 5.0, "N01-U02": 9.0, "N02-U01": 6.0, "N02-U02": 8.0}

    def scorer(uc_id):
        return dict(_scored(uc_id), priority_score=priorities[uc_id])

    obj = _build(agent_ns, tmp_path, mode, acceptable, scorer)
    obj.run()
    final = obj.recorded["tracking"][-1]
    assert [u["No"] for u in final] == ["N01-U01", "N01-U02", "N02-U01", "N02-U02"]
    scores = [u["Inspire Score"] for u in final]
    assert scores[0] == max(scores), "N01-U01 is the best-ranked use case"
    assert [u["Priority"] for u in final] == [9.0, 5.0, 8.0, 6.0]
    domain_of = {u["No"][:3]: u["Business Domain"] for u in final}
    assert domain_of["N01"] != domain_of["N02"]
    for uc in final:
        assert uc["No"].lower().replace("-", "_") in uc["result_table"], "result_table is named after the final id"


# ---------------------------------------------------------------- 6. per-batch schema subsets for combined scoring and BoB


from v120_funnel_integrity_test import combined_rec, ids_in  # noqa: E402
from v120_funnel_integrity_test import make_inspire as funnel_inspire  # noqa: E402
from v120_funnel_integrity_test import make_uc  # noqa: E402

SUBSET_TABLES = ("orders", "customers", "items", "stores", "audit_log", "payroll")
SUBSET_SCHEMA = [("c", "s", t, col, "bigint", f"{col} of one {t} row") for t in SUBSET_TABLES
                 for col in ("id", "amount", "region", "created_at")]


class _SubsetLoader:
    def __init__(self):
        self.foreign_key_graph = {("c", "s", "orders"): [("c", "s", "orders", "customer_id", "c", "s", "customers", "id")]}

    def get_table_comment(self, catalog, schema, table):
        return f"One row per {table}"

    def get_primary_key(self, catalog, schema, table):
        return ["id"]

    def get_table_relations(self, catalog, schema, table):
        return []

    def get_sampling_info(self, catalog, schema, table):
        return None


def _tables_in(markdown):
    return {t for t in SUBSET_TABLES if f"`{t}`" in markdown or f".{t}" in markdown}


def _bob_rec(uc_id):
    return {"No": uc_id, "bob_scores": {f"D{g}": 7 for g in range(1, 20)}, "idea_theme": "Demand",
            "bob_justification_short": "ok"}


def _subset_obj(ns, responder):
    obj = funnel_inspire(ns, responder, data_loader=_SubsetLoader())
    return obj


SUBSET_UCS = (("U1", "c.s.orders"), ("U2", "c.s.items, c.s.stores"), ("U3", "c.s.audit_log"))


@pytest.mark.parametrize("scorer", ["combined", "bob"])
def test_each_scoring_batch_sees_only_its_tables_and_their_fk_partners(ns, monkeypatch, scorer):
    monkeypatch.setitem(ns["TECHNICAL_CONTEXT"]["runtime"], "quality_scoring_batch_size", 5)
    monkeypatch.setitem(ns["TECHNICAL_CONTEXT"]["runtime"], "bob_scoring_batch_size", 5)
    if scorer == "combined":
        obj = _subset_obj(ns, lambda n, pv, s: json.dumps([combined_rec(i) for i in ids_in(pv["use_cases_to_validate"])]))
        call = lambda ucs: obj._score_combined_value_and_quality(ucs, SUBSET_SCHEMA)
    else:
        obj = _subset_obj(ns, lambda n, pv, s: json.dumps([_bob_rec(i) for i in ids_in(pv["use_cases_to_validate"])]))
        call = lambda ucs: obj._score_best_of_best(ucs, SUBSET_SCHEMA)
    for uc_id, tables in SUBSET_UCS:
        call([make_uc(uc_id, **{"Tables Involved": tables})])
    scoring = [c for c in obj.ai_agent.calls if c["prompt"] in ("COMBINED_VALUE_QUALITY_SCORE_PROMPT", "BEST_OF_BEST_SCORING_PROMPT")]
    seen = [_tables_in(c["vars"]["schema_details"]) for c in scoring]
    assert seen == [{"orders", "customers"}, {"items", "stores"}, {"audit_log"}]
    assert all("payroll" not in c["vars"]["schema_details"] for c in scoring)


@pytest.mark.parametrize("tables", ["orders", "s.orders", "c.s.no_such_table", ""])
def test_a_batch_whose_tables_are_not_fully_qualified_still_sees_a_schema(ns, tables):
    obj = _subset_obj(ns, lambda n, pv, s: json.dumps([combined_rec(i) for i in ids_in(pv["use_cases_to_validate"])]))
    obj._score_combined_value_and_quality([make_uc("U1", **{"Tables Involved": tables})], SUBSET_SCHEMA)
    schema = obj.ai_agent.calls[0]["vars"]["schema_details"]
    if tables in ("orders", "s.orders"):
        assert _tables_in(schema) == {"orders", "customers"}
    else:
        assert _tables_in(schema) == set(SUBSET_TABLES), "an unresolvable batch falls back to the full schema"


def test_a_batch_subset_is_never_larger_than_the_full_schema(ns):
    obj = _subset_obj(ns, lambda n, pv, s: json.dumps([combined_rec(i) for i in ids_in(pv["use_cases_to_validate"])]))
    full = obj._build_schema_markdown_for_validation(SUBSET_SCHEMA)
    everything = ", ".join(f"c.s.{t}" for t in SUBSET_TABLES)
    batch_md = obj._batch_schema_markdown(SUBSET_SCHEMA, [make_uc("U1", **{"Tables Involved": everything})], full)
    assert len(batch_md) <= len(full)
    single = obj._batch_schema_markdown(SUBSET_SCHEMA, [make_uc("U1", **{"Tables Involved": "c.s.payroll"})], full)
    assert len(single) < len(full) and _tables_in(single) == {"payroll"}


def test_the_elite_judge_and_the_scorers_share_one_batch_table_helper(ns):
    from _agentload import agent_source
    src = agent_source()
    assert "def _batch_tables(" not in src
    assert src.count("self._uc_batch_tables(") >= 3


def test_per_batch_schema_cuts_the_scoring_prompt_on_a_wide_fixture(ns):
    wide = [("c", "s", f"t{i:02d}", f"metric_{c:02d}", "decimal(12,2)", f"Business measure {c} of t{i:02d}, daily")
            for i in range(60) for c in range(25)]
    obj = funnel_inspire(ns, lambda *a: "", data_loader=_SubsetLoader())
    full = obj._build_schema_markdown_for_validation(wide)
    batch = [make_uc(f"U{i}", **{"Tables Involved": f"c.s.t{i % 6:02d}"}) for i in range(30)]
    subset = obj._batch_schema_markdown(wide, batch, full)
    assert len(subset) < 0.2 * len(full), (len(subset), len(full))


# ---------------------------------------------------------------- 7. one Serverless-safe fallback for agent-owned temp dirs


def test_writable_dir_keeps_a_writable_primary(ns, tmp_path):
    primary = tmp_path / "inspire_1" / "llm_cache"
    assert ns["b17_writable_dir"](str(primary), "inspire_llm_cache_") == str(primary)
    assert primary.is_dir()


def test_writable_dir_falls_back_when_the_primary_cannot_be_created(ns, tmp_path):
    blocker = tmp_path / "not_a_dir"
    blocker.write_text("x")
    log = RecordingLogger()
    got = ns["b17_writable_dir"](str(blocker / "llm_cache"), "inspire_llm_cache_", log)
    assert got != str(blocker / "llm_cache") and os.path.isdir(got)
    (open(os.path.join(got, "probe.txt"), "w")).close()
    assert log.matching("[B17-FALLBACK]")


def test_writable_dir_falls_back_when_the_primary_refuses_file_creation(ns, tmp_path):
    locked = tmp_path / "locked"
    locked.mkdir()
    locked.chmod(0o500)
    try:
        if os.access(str(locked), os.W_OK):
            pytest.skip("running with privileges that ignore directory permissions")
        got = ns["b17_writable_dir"](str(locked), "inspire_llm_cache_")
        assert got != str(locked) and os.access(got, os.W_OK)
    finally:
        locked.chmod(0o700)


def test_llm_cache_survives_an_unusable_session_temp_dir(fresh_ns, tmp_path, monkeypatch):
    blocker = tmp_path / "inspire_4242"
    blocker.write_text("a file where the session temp dir should be")
    monkeypatch.setattr(fresh_ns["tempfile"], "gettempdir", lambda: str(tmp_path))
    spark, log = FakeConnectSpark(lambda op: "x"), RecordingLogger()
    agent = make_agent(fresh_ns, spark, log)
    agent.enable_llm_cache(4242)
    assert agent._llm_cache_dir and not agent._llm_cache_dir.startswith(str(blocker))
    agent._llm_cache_put("prompt", "endpoint", "cached answer")
    assert agent._llm_cache_get("prompt", "endpoint") == "cached answer"
    assert log.matching("[B17-FALLBACK]")


def test_llm_cache_uses_the_session_temp_dir_when_it_is_writable(fresh_ns, tmp_path, monkeypatch):
    monkeypatch.setattr(fresh_ns["tempfile"], "gettempdir", lambda: str(tmp_path))
    agent = make_agent(fresh_ns, FakeConnectSpark(lambda op: "x"), RecordingLogger())
    agent.enable_llm_cache(4242)
    assert agent._llm_cache_dir == os.path.join(str(tmp_path), "inspire_4242", "llm_cache")


def test_local_log_backup_falls_back_instead_of_being_skipped(ns, tmp_path, monkeypatch):
    import logging
    import uuid
    name = f"inspire_backup_test_{uuid.uuid4().hex}"
    blocker = os.path.join("/tmp", name)
    with open(blocker, "w") as fh:
        fh.write("a file where the backup directory should be")
    log_path = tmp_path / "log.txt"
    log_path.write_text("run log line\n")
    handler = logging.FileHandler(str(log_path))
    logging.root.handlers.insert(0, handler)
    try:
        obj = make_inspire(ns, base_output_dir="/Workspace/out", sanitized_customer_name=name)
        obj._upload_log_file()
        saved = [m for _, m in obj.logger.records if "Log file backup saved to:" in m]
        assert saved and not saved[0].endswith(os.path.join(blocker, "log.txt")), obj.logger.records
        backup = saved[0].split("Log file backup saved to: ", 1)[1]
        assert open(backup).read() == "run log line\n"
        assert obj.logger.matching("[B17-FALLBACK]")
    finally:
        logging.root.removeHandler(handler)
        handler.close()
        os.unlink(blocker)


# ---------------------------------------------------------------- 8. result table names are quoted, valid three-level names


@pytest.mark.parametrize("args, expected", [
    (("N01-U02", "Forecast Weekly Demand", "", "cat.sch"), "`cat`.`sch`.`_inspire_n01_u02_forecast_weekly_demand`"),
    (("N01-U02", "Forecast Weekly Demand", "", "`my-cat`.`my sch`"),
     "`my-cat`.`my sch`.`_inspire_n01_u02_forecast_weekly_demand`"),
    (("N01-U02", "Forecast Weekly Demand", "", "my-cat.my-schema"),
     "`my-cat`.`my-schema`.`_inspire_n01_u02_forecast_weekly_demand`"),
    (("N01-U02", "Forecast Weekly Demand", ""), "`main`.`_inspire`.`_inspire_n01_u02_forecast_weekly_demand`"),
    (("N01/U02 ", None, "", "cat.sch"), "`cat`.`sch`.`_inspire_n01_u02`"),
    (("N01-U02", "Prévision « ventes » 2026", "", "cat.sch"), "`cat`.`sch`.`_inspire_n01_u02_pr_vision_ventes_2026`"),
])
def test_result_table_names_are_quoted_three_level_names(ns, args, expected):
    assert ns["compute_result_table_name"](*args) == expected


def test_result_table_name_is_valid_for_long_and_odd_names(ns):
    name = ns["compute_result_table_name"]("N12-U345", "x" * 400 + " `drop table`; --", "", "cat.sch")
    parts = re.findall(r"`([^`]*)`", name)
    assert name == ".".join(f"`{p}`" for p in parts) and len(parts) == 3
    assert parts[:2] == ["cat", "sch"] and re.fullmatch(r"_inspire_[a-z0-9_]+", parts[2]) and len(parts[2]) <= 200
    assert ns["parse_three_level_name"](name) == tuple(parts)


def test_the_genie_validator_accepts_the_quoted_result_table(ns):
    obj = make_inspire(ns)
    result_table = ns["compute_result_table_name"]("N01-U01", "Forecast demand", "", "cat.inspire")
    uc = {"No": "N01-U01", "Tables Involved": "cat.sch.orders", "Primary Table": "cat.sch.orders",
          "result_table": result_table}
    for written in (result_table, result_table.replace("`", "")):
        ok, hallucinated = obj._validate_genie_instruction_references(
            uc, f"Read cat.sch.orders and MERGE INTO {written}.", schema_index=None)
        assert ok and hallucinated == [], written
    ok, hallucinated = obj._validate_genie_instruction_references(
        uc, "Read cat.sch.orders and write to cat.inspire.somewhere_else.", schema_index=None)
    assert not ok and hallucinated == ["cat.inspire.somewhere_else"]
