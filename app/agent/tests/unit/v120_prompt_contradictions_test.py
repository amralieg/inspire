import json
import os
import re
import string
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import load_agent_namespace

FALLBACK_TECHNIQUE = "AI Analysis"


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def _fields(template):
    return {f.split(".")[0].split("[")[0] for _, f, _, _ in string.Formatter().parse(template) if f}


def _render(template, extra=None):
    values = {name: "<%s>" % name for name in _fields(template)}
    values.update(extra or {})
    return template.format(**values)


def _prompt(ns, key):
    return _render(ns["PROMPT_TEMPLATES"][key])


def _base(ns):
    return _render(ns["PROMPT_TEMPLATES"]["BASE_USE_CASE_GEN_PROMPT"], {"quality_gate_block": ns["QUALITY_GATE_HIGH"]})


def _between(text, start, end):
    i = text.index(start)
    return text[i:text.index(end, i + len(start))]


def _allowed_techniques(ns):
    section = _between(_base(ns), "**`Analytics Technique`**", "**`Statement`**")
    return re.findall(r"^\s*\* `([^`]+)` - ", section, re.MULTILINE)


def _json_blocks(text):
    return re.findall(r"```json\s*\n(.*?)\n```", text, re.DOTALL)


def test_b01_generation_breadth_does_not_contradict_a_strict_post_filter(ns):
    base = _base(ns)
    for phrase in ("MAXIMIZE DISCOVERY", "your job is to DISCOVER, not to filter", "PROVEN MASSIVE ROI",
                   "Better a tight 50-UC portfolio", "Cover 30–100+ decisions"):
        assert phrase not in base, phrase
    assert "BREADTH WITH HARD GATES" in base
    assert "never emit one that fails them" in base
    assert "never add filler to reach a count" in base
    assert "never emit one that fails them" in ns["QUALITY_GATE_HIGH"]


def test_b02_one_number_rule_for_business_value(ns):
    base = _base(ns)
    for phrase in ("a numeric % or $ value", "Refrain from mentioning any specific values",
                   "unless a specific column from `Tables Involved` could compute the value",
                   "(a) trace to a named column in `Tables Involved` that could compute it"):
        assert phrase not in base, phrase
    assert "Never write a concrete percentage, currency amount, multiplier or time saving in any UC field." in base
    assert base.count("[ESTIMATE: depends on <column_name from supplied schema>]") >= 2
    assert "$2M" not in _prompt(ns, "COMBINED_VALUE_QUALITY_SCORE_PROMPT")
    assert "30 days before cancellation" not in _prompt(ns, "COMBINED_VALUE_QUALITY_SCORE_PROMPT")


def test_b02_business_value_example_names_the_role_first(ns):
    section = _between(_base(ns), "**`Business Value`**", "**`Beneficiary`**")
    good = section[section.index("**GOOD**"):section.index("**BAD**")]
    assert good.split('"')[1].startswith("The `<role>`")
    assert "%" not in good


def test_b03_ai_analysis_is_not_an_allowed_generation_label(ns):
    allowed = _allowed_techniques(ns)
    assert FALLBACK_TECHNIQUE not in allowed
    for line in _base(ns).splitlines():
        if FALLBACK_TECHNIQUE in line:
            assert "REJECTED" in line or "NEVER" in line, line


def test_c24_generation_vocabulary_equals_the_technique_registry(ns):
    allowed = _allowed_techniques(ns)
    registry = set(ns["TECHNIQUE_IMPLEMENTATION_GUIDANCE"])
    assert len(allowed) == len(set(allowed))
    assert set(allowed) == registry - {FALLBACK_TECHNIQUE}
    assert FALLBACK_TECHNIQUE in registry
    assert set(ns["TRAIN_INFER_TECHNIQUES"]) <= set(allowed)


def test_c24_family_mapping_covers_every_allowed_technique_exactly_once(ns):
    mapping = _between(_base(ns), "**CANONICAL TECHNIQUE → FAMILY MAPPING**", "A. **MACHINE LEARNING")
    names = re.findall(r"`([^`]+)`", mapping)
    names = [n for n in names if n != "Analytics Technique"]
    assert sorted(names) == sorted(_allowed_techniques(ns))


def test_c24_d9_mismatch_list_uses_registry_labels(ns):
    block = ns["QUALITY_GATE_SCORING_BLOCK"]
    listed = block[block.index("the Analytics Technique is any of [") + len("the Analytics Technique is any of ["):]
    listed = [x.strip() for x in listed[:listed.index("]")].split(",")]
    assert set(listed) <= set(_allowed_techniques(ns))


def test_c24_rule12_points_algorithms_to_registry_labels(ns):
    base = _base(ns)
    rule12 = _between(base, "12. **NO VAGUE / UMBRELLA TECHNIQUE NAMES**", "4. If a use case requires data not in the schema")
    assert "MUST be exactly one value from the allowed list" in rule12
    assert "Isolation Forest → `Anomaly Detection`" in rule12
    for vocabulary_drift in ("Text Analytics", "Topic Modeling", "NLP Classification", "Summarization",
                             "Seasonality Decomposition", "Top-N Ranking"):
        assert vocabulary_drift not in base, vocabulary_drift


def test_b09_no_external_enrichment_quota_or_simulated_data(ns):
    base = _base(ns)
    for phrase in ("≥50% of use cases", "simulated economic", "simulated market", "with Economic Context",
                   "with Market Benchmarks"):
        assert phrase not in base, phrase
    assert "EXTERNAL DATA (NEVER SIMULATED)" in base


def test_b10_structural_signals_do_not_force_trivial_reporting_use_cases(ns):
    base = _base(ns)
    assert "single-pane-of-glass dashboard UC" not in base
    assert "Do NOT skip these because they appear basic" not in base
    assert "a trend / period-over-period UC on that measure" not in base
    assert "a plain trend chart, top-N list or dashboard is reporting, not a use case" in base
    assert "add the missing UC before finishing the batch" not in base


def test_b11_business_context_never_invents_scale_or_revenue(ns):
    prompt = _prompt(ns, "BUSINESS_CONTEXT_WORKER_PROMPT")
    for phrase in ("$4.5B", "350+ locations", "approximate revenue", "market position, scale, revenue"):
        assert phrase not in prompt, phrase
    assert "MUST NOT contain invented scale or financial figures" in prompt


def test_b22_business_context_example_is_the_honesty_wrapped_shape(ns):
    prompt = _prompt(ns, "BUSINESS_CONTEXT_WORKER_PROMPT")
    example = json.loads(_json_blocks(prompt[prompt.index("### OUTPUT FORMAT"):])[0])
    assert set(example) == {"honesty_score", "honesty_justification", "data"}
    assert set(example["data"]) == {"business_context", "strategic_goals", "business_priorities",
                                    "strategic_initiative", "value_chain", "revenue_model"}


def test_b15_b26_dead_score_floor_and_optional_honesty_columns_removed(ns):
    base = _base(ns)
    for phrase in ("SCORE FLOOR", "self-score below 7.5", "Scoring compression", "optional honesty columns",
                   "You may append honesty columns", "(no more, no less)"):
        assert phrase not in base, phrase
    assert "(14 columns per row)" in base
    assert '"High Level Design","honesty_score","honesty_justification"' in base


def test_b16_no_technique_quotas_force_weak_fits(ns):
    base = _base(ns)
    for phrase in ("≥25% of UCs use ML", "≥5% of UCs MUST", "this minimum ALWAYS applies", "12+ distinct",
                   "(25-35% of use cases)", "(20-30% of use cases)", "fewer than 12 distinct", "ALL 22 TECHNIQUES"):
        assert phrase not in base, phrase
    assert "never add a use case only to raise the number of distinct techniques" in base


def test_b17_one_set_of_balance_thresholds(ns):
    base = _base(ns)
    rules = ns["QUALITY_GATE_RULES"]
    assert "No single business domain above 25% of the use cases" in rules
    assert "No single Analytics Technique above 30% of the use cases" in rules
    for phrase in ("No single technique >20% of portfolio", "may dominate >20%", "dominate more than ~25%"):
        assert phrase not in base, phrase
    assert "~25%" not in ns["QUALITY_GATE_HIGH"]
    assert "~30%" not in ns["QUALITY_GATE_HIGH"]


def test_b20_domain_finder_example_uses_no_banned_name(ns):
    prompt = _prompt(ns, "DOMAIN_FINDER_PROMPT")
    banned_line = prompt[prompt.index("BANNED generic names:"):].splitlines()[0]
    banned = set(re.findall(r'"([A-Za-z]+)"', banned_line))
    example = _between(prompt, "Example:\nuse_case_id,domain\n", "\n\n")
    used = {row.split(",")[1].strip() for row in example.strip().splitlines()[2:]}
    assert used and not (used & banned), used & banned


def test_b21_interpreter_category_count_matches_categories(ns):
    prompt = _prompt(ns, "GENERAL_INSTRUCTION_INTERPRETER_PROMPT")
    assert "into 4 structured categories" not in prompt
    assert "into the 8 structured categories" in prompt
    assert len(re.findall(r"^\*\*\d\. ", prompt, re.MULTILINE)) == 8


def test_b23_translate_column_counts_are_consistent(ns):
    prompt = _prompt(ns, "USE_CASE_TRANSLATE_PROMPT")
    header = prompt.split("**CSV HEADER (MUST BE EXACTLY THIS)**:\n", 1)[1].split("\n", 1)[0]
    columns = [c.strip('"') for c in header.split(",")]
    n = len(columns)
    assert n == 22 and columns[:7] == ["No", "Name", "Business Domain", "Subdomain", "type", "Analytics Technique", "Statement"] and columns[-3:] == ["Non-Financial Benefits", "KPI Names", "Proposed Key Results"]
    for phrase in (f"Header row with the {n} column names", f"({n + 2} columns", f"with {n + 2} fields", f"exactly {n + 2} fields",
                   f"exactly {n + 2} comma-separated", f"exact {n}-column header", f"has {n + 3} fields", f"{n + 4} with both"):
        assert phrase in prompt, phrase
    for stale in (11, 13, 15, 16, 17, 20):
        for phrase in (f"exactly {stale} fields", f"with {stale} fields", f"Header row with {stale} column names",
                       f"exactly {stale} comma-separated", f"ALL {stale} fields", f"ALL {stale} designated", f"All {stale} translatable"):
            assert phrase not in prompt, phrase
    translatable = n - 4
    assert f"translate these {translatable} fields" in prompt and f"ALL {translatable} designated fields" in prompt
    assert '"No","Name","Business Domain","Subdomain","type","Analytics Technique","Statement",...' in prompt
    assert '"Name","Headline"' not in prompt


def test_b25_quality_summary_example_has_no_invented_percentage(ns):
    for key in ("COMBINED_VALUE_QUALITY_SCORE_PROMPT", "BEST_OF_BEST_SCORING_PROMPT"):
        assert "15% logistics cost reduction" not in _prompt(ns, key), key
    assert "Never state an invented percentage or currency figure" in ns["QUALITY_GATE_SCORING_BLOCK"]


def test_b27_keywords_exception_count_is_consistent(ns):
    prompt = _prompt(ns, "KEYWORDS_TRANSLATE_PROMPT")
    assert "3 exceptions" not in prompt
    assert '1. "N/A"' in prompt


def test_summary_header_includes_honesty_columns_everywhere(ns):
    prompt = _prompt(ns, "SUMMARY_GEN_PROMPT")
    headers = re.findall(r'(?:start with the header|starting with the header|START with):?\s*`?("Type","Summary"[^`\n]*)', prompt)
    assert headers
    for header in headers:
        assert header.rstrip("`.").endswith('"honesty_score","honesty_justification"'), header


def test_b19_no_prompt_lists_a_business_priority_taxonomy_of_its_own(ns):
    for key, body in ns["PROMPT_TEMPLATES"].items():
        assert "Standard business priorities:" not in body, key


def test_c15_genie_prompt_never_demands_dollar_figures(ns):
    prompt = _prompt(ns, "USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT")
    for phrase in ("numbered cost categories and dollar figures", "Every sentence must contain specific dollar figures",
                   "unless those values are computable", "not computable from a named supplied column"):
        assert phrase not in prompt, phrase
    assert "never an invented dollar or percentage figure" in prompt


def test_c17_goal_filter_uses_explicit_overlap_not_topic_expansion(ns):
    prompt = _prompt(ns, "GOAL_ALIGNMENT_FILTER_PROMPT")
    for phrase in ("ALWAYS YES", "regardless of how the goal is worded", "ARE ALWAYS operational/growth decisions"):
        assert phrase not in prompt, phrase
    assert "EXPLICIT-OVERLAP TEST" in prompt
    assert "Never mark YES because of the topic alone." in prompt
    assert "Return a CSV with exactly 2 columns: ID,Aligned" in prompt


def test_generation_prompt_never_promises_deep_learning_the_implementer_bans(ns):
    base = _base(ns)
    assert "3 days of GPU training" not in base
    assert "Heavy ML: deep models" not in base
    assert "No deep learning (no TensorFlow, PyTorch, or Keras)." in _prompt(ns, "USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT")
