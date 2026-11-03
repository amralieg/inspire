import json
import os
import re
import string
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import agent_source, load_agent_namespace, method_node

V113_PLACEHOLDERS = {
    "BASE_USE_CASE_GEN_PROMPT": {"additional_context_section", "business_context", "business_priorities", "focus_areas_instruction",
                                 "foreign_key_relationships", "generation_instructions_section", "previous_use_cases_feedback",
                                 "quality_gate_block", "revenue_model", "schema_markdown", "strategic_goals", "strategic_initiative",
                                 "value_chain"},
    "BEST_OF_BEST_SCORING_PROMPT": {"business_context", "business_priorities", "generation_instructions_section", "industry",
                                    "strategic_goals", "target_max", "use_cases_to_validate"},
    "BUSINESS_CONTEXT_WORKER_PROMPT": {"industry", "name", "type_description", "type_label"},
    "COMBINED_VALUE_QUALITY_SCORE_PROMPT": {"business_context", "business_priorities", "generation_instructions_section", "industry",
                                            "revenue_model", "schema_details", "strategic_goals", "strategic_initiative",
                                            "use_cases_to_validate", "value_chain"},
    "DOMAIN_FINDER_PROMPT": {"business_context", "business_name", "generation_instructions_section", "industries", "output_language",
                             "previous_violations", "use_cases_csv"},
    "FILTER_BUSINESS_TABLES_PROMPT": {"additional_context_section", "business_context", "business_name", "exclusion_strategy",
                                      "generation_instructions_section", "industry", "strategy_rules", "tables_markdown"},
    "GENERAL_INSTRUCTION_INTERPRETER_PROMPT": {"business_name", "generation_instructions"},
    "GOAL_ALIGNMENT_FILTER_PROMPT": {"goal_description", "use_cases_table"},
    "KEYWORDS_TRANSLATE_PROMPT": {"json_payload", "target_language"},
    "REVIEW_USE_CASES_PROMPT": {"generation_instructions_section", "total_count", "use_case_markdown"},
    "SUBDOMAIN_DETECTOR_PROMPT": {"business_context", "business_name", "domain_name", "generation_instructions_section", "industries",
                                  "output_language", "previous_violations", "use_cases_csv"},
    "SUMMARY_GEN_PROMPT": {"business_name", "domain_list", "domain_use_case_highlights", "generation_instructions_section",
                           "output_language", "total_cases"},
    "USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT": {"analytics_technique", "available_tables_listing", "business_domain", "business_name",
                                                   "business_value", "code_structure_mandate", "directly_involved_schema",
                                                   "enriched_business_context", "enriched_business_priorities",
                                                   "enriched_revenue_model", "enriched_strategic_goals",
                                                   "enriched_strategic_initiative", "enriched_value_chain",
                                                   "foreign_key_relationships", "generation_instructions_section",
                                                   "high_level_design", "primary_table", "result_table", "solution", "statement",
                                                   "subdomain", "tables_involved", "technique_implementation_guidance",
                                                   "use_case_id", "use_case_name", "use_case_type"},
    "USE_CASE_QUALITY_SCORE_PROMPT": {"business_context", "generation_instructions_section", "industry", "schema_details",
                                      "use_cases_to_validate"},
    "USE_CASE_TRANSLATE_PROMPT": {"json_payload", "target_language"},
    "USE_CASE_VALUE_SCORE_PROMPT": {"business_context", "business_priorities", "generation_instructions_section", "revenue_model",
                                    "strategic_goals", "strategic_initiative", "use_case_markdown", "value_chain"},
}

ALLOWED_ADDITIONS = {"BEST_OF_BEST_SCORING_PROMPT": {"schema_details", "strategic_initiative", "value_chain", "revenue_model"},
                     "BASE_USE_CASE_GEN_PROMPT": {"industry", "kinds_checklist_section"},
                     "GENERAL_INSTRUCTION_INTERPRETER_PROMPT": {"kind_ids"},
                     "USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT": {"beneficiary", "sponsor", "decision", "decision_owner", "cadence", "kpi",
                                                                    "kpi_direction", "value_tier", "outcome_definition", "time_column",
                                                                    "entity_key_column", "join_path", "signal_columns", "build_path", "blockers",
                                                                    "execution_family", "readiness_thresholds", "model_name",
                                                                    "widget_table", "acceptance_stop_rule",
                                                                    "unreached_quantile_rule", "model_feature_rule"}}

REMOVED_PROMPTS = {"USE_CASE_QUALITY_SCORE_PROMPT", "USE_CASE_VALUE_SCORE_PROMPT"}

STRATEGY_BLIND = {"strategic_goals", "business_priorities"}
REMOVED_PLACEHOLDERS = {"SUMMARY_GEN_PROMPT": {"total_cases"}, "BASE_USE_CASE_GEN_PROMPT": STRATEGY_BLIND,
                        "COMBINED_VALUE_QUALITY_SCORE_PROMPT": STRATEGY_BLIND, "BEST_OF_BEST_SCORING_PROMPT": STRATEGY_BLIND}

NEW_PROMPTS = {"ULTRA_HIGH_ELITE_JUDGE_PROMPT": {"allowed_value_tiers", "business_context",
                                                 "generation_instructions_section", "industry", "min_dimension_score",
                                                 "near_miss_band", "revenue_model", "schema_details",
                                                 "strategic_initiative", "use_cases_to_judge", "value_chain"},
               "STRATEGY_ALIGNMENT_PROMPT": {"business_name", "business_context", "generation_instructions_section",
                                             "strategy_source", "strategy_levels", "strategy_entries",
                                             "business_priorities", "sponsor_roster", "metric_views", "use_cases_json"},
               "THEME_ASSIGNMENT_PROMPT": {"use_cases_listing", "existing_themes_section", "method_families",
                                           "generation_instructions_section", "theme_budget"},
               "SIGNAL_CHECK_PROMPT": {"schema_details", "use_cases_listing", "generation_instructions_section"}}


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def _fields(template):
    return {f.split(".")[0].split("[")[0] for _, f, _, _ in string.Formatter().parse(template) if f}


def method_source(class_name, method_name):
    node = method_node(class_name, method_name)
    lines = agent_source().split("\n")
    return "\n".join(lines[node.lineno - 1:node.end_lineno])


def _render(template):
    return template.format(**{name: "<%s>" % name for name in _fields(template)})


def test_smoke_render_all_prompts_reports_ok_for_every_prompt(ns):
    report = ns["smoke_render_all_prompts"]()
    assert set(report) == set(ns["PROMPT_TEMPLATES"])
    failures = {k: v["error"] for k, v in report.items() if not v["ok"]}
    assert failures == {}


def test_smoke_render_reports_real_placeholders_not_escaped_braces(ns):
    report = ns["smoke_render_all_prompts"]()
    genie = report["USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT"]["placeholders"]
    assert "_user" not in genie and "EXPERIMENT_NAME" not in genie
    for key, entry in report.items():
        assert set(entry["placeholders"]) == _fields(ns["PROMPT_TEMPLATES"][key]), key


def test_smoke_render_flags_a_broken_template(ns):
    report = ns["smoke_render_all_prompts"](templates={"BROKEN": "close } without open", "OK": "fine {x}"})
    assert report["BROKEN"]["ok"] is False
    assert report["OK"]["ok"] is True and report["OK"]["placeholders"] == ["x"]


def test_placeholder_sets_unchanged_except_the_bob_and_generation_industry_additions(ns):
    pt = ns["PROMPT_TEMPLATES"]
    assert set(pt) == (set(V113_PLACEHOLDERS) - REMOVED_PROMPTS) | set(NEW_PROMPTS)
    for key, before in V113_PLACEHOLDERS.items():
        if key in REMOVED_PROMPTS:
            continue
        after = _fields(pt[key])
        assert after - before == ALLOWED_ADDITIONS.get(key, set()), key
        assert before - after == REMOVED_PLACEHOLDERS.get(key, set()), key
    for key, expected in NEW_PROMPTS.items():
        assert _fields(pt[key]) == expected, key


def test_bob_call_site_supplies_every_bob_placeholder(ns):
    src = method_source("DatabricksInspire", "_score_best_of_best")
    start = src.index("prompt_vars = {")
    supplied = set(re.findall(r'"([a-z_]+)":', src[start:src.index("}", start)]))
    added = ALLOWED_ADDITIONS["BEST_OF_BEST_SCORING_PROMPT"]
    if not supplied & added:
        pytest.skip("CORE lane has not wired schema_details/strategic_initiative/value_chain/revenue_model into the BoB prompt_vars yet")
    missing = _fields(ns["PROMPT_TEMPLATES"]["BEST_OF_BEST_SCORING_PROMPT"]) - supplied
    assert missing == set(), missing


def test_generation_csv_header_contract_is_unchanged(ns):
    base = _render(ns["PROMPT_TEMPLATES"]["BASE_USE_CASE_GEN_PROMPT"])
    header = '"No","Name","usecase","type","Analytics Technique","Statement","Solution","Business Value","Beneficiary","Sponsor","Tables Involved","High Level Design"'
    assert header in base


def _first_json_object(text):
    start = text.index("{")
    depth = 0
    for i in range(start, len(text)):
        depth += {"{": 1, "}": -1}.get(text[i], 0)
        if depth == 0:
            return json.loads(text[start:i + 1])
    raise AssertionError("unbalanced JSON example")


@pytest.mark.parametrize("key, required", [
    ("COMBINED_VALUE_QUALITY_SCORE_PROMPT", {"use_case_id", "roi", "time_to_value", "reusability", "priority_score",
                                            "quality_score", "quality_label", "quality_summary", "justification",
                                            "d11_domain_balance"}),
    ("BEST_OF_BEST_SCORING_PROMPT", {"No", "bob_scores", "bob_justification_short"}),
])
def test_json_output_examples_parse_with_the_keys_the_parsers_read(ns, key, required):
    rendered = _render(ns["PROMPT_TEMPLATES"][key])
    example = rendered[rendered.index("```json"):]
    obj = _first_json_object(example[example.index("[") + 1:])
    assert required <= set(obj), required - set(obj)
    if key == "BEST_OF_BEST_SCORING_PROMPT":
        assert sorted(obj["bob_scores"], key=lambda g: int(g[1:])) == ["D%d" % i for i in range(1, 20)]
        assert all(isinstance(v, int) and 0 <= v <= 10 for v in obj["bob_scores"].values())


@pytest.mark.parametrize("key, marker", [
    ("USE_CASE_TRANSLATE_PROMPT", '"No","Name","Business Domain","Subdomain","type","Analytics Technique","Statement","Solution","Business Value","Beneficiary","Sponsor","Business Priority Alignment","Strategic Goals Alignment","Tables Involved","Quality","Headline","Technique Label"'),
    ("SUMMARY_GEN_PROMPT", '"Type","Summary","TransliteratedBusinessName"'),
    ("GOAL_ALIGNMENT_FILTER_PROMPT", "ID,Aligned"),
    ("REVIEW_USE_CASES_PROMPT", "use_case_id,honesty_score,honesty_justification"),
    ("DOMAIN_FINDER_PROMPT", "use_case_id,domain,honesty_score,honesty_justification"),
    ("SUBDOMAIN_DETECTOR_PROMPT", "use_case_id,subdomain,honesty_score,honesty_justification"),
    ("BUSINESS_CONTEXT_WORKER_PROMPT", '"honesty_score"'),
])
def test_csv_and_json_output_markers_retained(ns, key, marker):
    assert marker in _render(ns["PROMPT_TEMPLATES"][key])


def test_rules_and_scoring_block_contain_no_format_braces(ns):
    for name in ("QUALITY_GATE_RULES", "QUALITY_GATE_SCORING_BLOCK", "QUALITY_GATE_HIGH", "USER_DIRECTIVE_SUPREMACY_PREAMBLE"):
        assert "{" not in ns[name] and "}" not in ns[name], name


def test_no_prompt_pressures_the_model_to_read_row_data(ns):
    bodies = dict(ns["PROMPT_TEMPLATES"])
    bodies["USER_DIRECTIVE_SUPREMACY_PREAMBLE"] = ns["USER_DIRECTIVE_SUPREMACY_PREAMBLE"]
    bodies["QUALITY_GATE_SCORING_BLOCK"] = ns["QUALITY_GATE_SCORING_BLOCK"]
    assert ns["audit_prompts_for_data_access_leak"](bodies) == []
    probe = ns["audit_prompts_for_data_access_leak"]({"PROBE": "First query the table and fetch sample rows."})
    assert probe and probe[0]["prompt"] == "PROBE"


def test_preamble_is_industry_agnostic(ns):
    pre = ns["USER_DIRECTIVE_SUPREMACY_PREAMBLE"].lower()
    for word in ("retail", "bank", "airline", "hospital", "patient", "insurance", "telecom", "bakery", "loan", "sku"):
        assert not re.search(r"\b%s\b" % word, pre), word
