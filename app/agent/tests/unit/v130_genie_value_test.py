"""v1.3.0 value contract of Genie Code notebooks: an 'Act now' or 'Review' row names its own next step, tiers follow
each row's evidence, rank follows the stake, significance tests never run on a smoothed series, explanations word the
facts the code computed, keys stay integers, a drifted output schema is repaired, the length target measures the
text the model writes, a window over earlier or later dates is a range frame on the day number, a join leaves each
column name once, tuple rows are read by field, array values are never tested as a condition, inf is replaced in the
numeric columns only, each step receives the values earlier steps computed as arguments, numbers are written by one
asserted formatter with their units, a statistical result is never a data quality flag, and flagged rows rank last."""
import ast
import fractions
import functools
import json
import math
import operator
import os
import re
import sqlite3
import subprocess
import sys
import types

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _agentload import load_agent_namespace
from v120_genie_support import FakeAgent, FakeLoader, ORDERS, build_inspire, long_instruction, make_uc
from v120_metadata_evidence_test import CapturingLogger, SqliteSpark, T

GENERIC = "the decision this use case supports"
TECHNIQUES = ("Predictive Modeling", "Anomaly Detection", "Clustering", "Recommendation", "Forecasting",
              "Cohort Analysis", "Sentiment Analysis", "Optimization")
ASSESSED = {"decision": "Which accounts get a retention call each week", "decision_owner": "Retention lead", "cadence": "weekly"}


def spec_and_mandate(agent_ns, **fields):
    inst = build_inspire(agent_ns)
    spec = inst._genie_notebook_spec(make_uc(**fields))
    return inst, spec, inst._build_code_structure_mandate(spec)


def meaning(mandate, column):
    return next(line for line in mandate.splitlines() if line.startswith(f"- {column} "))


def test_an_unassessed_use_case_acts_toward_the_deliverable_its_name_names(agent_ns):
    _, spec, mandate = spec_and_mandate(agent_ns, Name="Detect Category Margin Erosion Early with Pricing Review Queue")
    assert spec["action_by_tier"]["Act now"] == "Act in this cycle"
    assert spec["action_target"] == "the Pricing Review Queue"
    assert GENERIC not in mandate
    assert "its own next step for the Pricing Review Queue" in meaning(mandate, "recommended_action")
    _, spec, _ = spec_and_mandate(agent_ns, Name="Match Labor With Traffic with Returns Support Staffing Schedule")
    assert spec["action_target"] == "the Returns Support Staffing Schedule", "the last 'with' names the deliverable"


def test_a_name_without_a_deliverable_still_gives_a_concrete_target(agent_ns):
    _, spec, mandate = spec_and_mandate(agent_ns, Name="Forecast Weekly Store Sales")
    assert spec["action_target"] == "the Forecast Weekly Store Sales results" and GENERIC not in mandate
    _, spec, mandate = spec_and_mandate(agent_ns, Name="")
    assert spec["action_target"] == "the ranked rows of the business output table" and GENERIC not in mandate


def test_an_assessed_use_case_acts_toward_its_decision_at_its_cadence(agent_ns):
    _, spec, mandate = spec_and_mandate(agent_ns, elite_assessment=ASSESSED, elite_status="ELITE")
    assert spec["action_by_tier"]["Act now"] == "Act in this weekly cycle"
    assert spec["action_target"] == "Which accounts get a retention call each week"
    action = meaning(mandate, "recommended_action")
    assert "its own next step for Which accounts get a retention call each week" in action
    assert "never generic text and never written by a model" in action
    assert "'Act now' = \"Act in this weekly cycle\"" in mandate


def test_tiers_follow_each_row_evidence_and_rank_follows_the_stake(agent_ns):
    _, _, mandate = spec_and_mandate(agent_ns)
    tier = meaning(mandate, "priority_tier")
    assert "with N the number of rows that pass the use case's decision test" in tier
    assert "'Act now' for every one of them whose rank is at most floor(`act_now_share` x N)" in tier
    assert "'Monitor' for every other row, including every row whose data_quality_flag is not 'ok'" in tier
    rank = meaning(mandate, "rank")
    assert "the rows that pass the use case's decision test first" in rank, "a Monitor row never outranks an Act now row"
    assert "each group by value_at_stake, highest first, then by value" in rank, "rank follows the money at stake"
    assert "then the other rows whose data_quality_flag is 'ok', then the flagged rows" in rank, \
        "a network notebook ranked 153 senders flagged 'too few closed recipients' above the 55 senders it could test"
    assert "a row without enough evidence never outranks a row with it" in rank
    flag = meaning(mandate, "data_quality_flag")
    assert "this row's own inputs" in flag and "go to the summary step, not to every row" in flag
    assert "a result is never a data quality flag" in flag and "keeps 'ok' and says so in its top reasons" in flag
    label = meaning(mandate, "entity_label")
    assert "from a name or description column" in label
    assert "never contact details such as an email address, phone number or street address" in label, "a label carried an email"
    assert "a period written as its name (2002Q1, 2002-03) rather than a sequence number" in label, "a label read 'cohort 400'"
    once = agent_ns["GENIE_COMPUTE_ONCE_RULE"]
    assert "once in the Parameters cell, never inside a branch" in once
    assert "never a Python loop that filters, builds or sorts a frame per entity" in once
    assert "group the rows once (groupby, or a dict of arrays keyed by entity) and look each entity up" in once, \
        "a Pareto's halo lookup filtered the basket frame once per item and ran past 33 minutes"
    assert "a seeded sample of at most 5,000 entities" in once
    assert "Aggregate each fact table to the entity and period before joining it" in once, "a raw readiness join ran past 45 minutes"
    assert "groupBy(...).applyInPandas(...)" in once and "never in a loop on the driver" in once, "300 series x 2 models x 3 origins ran serially"
    recommender = agent_ns["TECHNIQUE_IMPLEMENTATION_GUIDANCE"]["Recommendation"]
    assert "np.argpartition" in recommender and "a seeded sample of at most 5,000 holdout users" in recommender, \
        "a per-user pandas loop kept the recommender past 45 minutes in rounds 4, 7 and 8"


def test_every_pattern_tests_observed_values_and_words_computed_facts(agent_ns):
    significance, facts = agent_ns["GENIE_SIGNIFICANCE_RULE"], agent_ns["GENIE_EXPLANATION_FACTS_RULE"]
    numbers, frames = agent_ns["GENIE_NUMBER_FORMAT_RULE"], agent_ns["GENIE_FRAME_NAMES_RULE"]
    assert "never on a smoothed or fitted series such as an STL trend" in significance
    assert "never on observed values minus an STL seasonal component" in significance, "robust STL left 0.34 points of noise"
    assert "season indicators in an OLS over the full history" in significance
    assert "use HAC standard errors only with at least 30 points" in significance, "HAC on 12 points gave p = 1e-53"
    assert "compare a period or cohort with the same season of earlier cycles" in significance
    assert "Leave out the latest periods of an event that follows another by a lag" in significance, \
        "returns lag their sales, so the last weeks read as a drop"
    assert "print how many series the test flags in each direction" in significance
    assert "never choose a driver, a cause, a rank or a number from raw values" in facts and "without markdown" in facts
    assert "from the facts the code computed and formatted" in facts
    assert "is written by Inspire's number helpers" in numbers and "below 0.001 are written '< 0.001'" in numbers
    assert "Never write a raw double or scientific notation" in numbers
    assert "top_reasons, recommended_action, ai_facts, the summary facts or an ai_query prompt" in numbers
    assert "never Python's 'g' format, which turns 1060 into 1.06e+03" in numbers, "a reason read 'net loss 1.06e+03'"
    assert "rounds to 3 significant figures with a B, M or K suffix" in numbers
    period = agent_ns["GENIE_PERIOD_COMPLETE_RULE"]
    assert "from each source table's own dates before any filter" in period, "a filter made a partial quarter look complete"
    assert "from the frame every later step uses, not only from the readiness count" in period, "null keys were counted, then kept"
    assert "`*_pdf`" in frames and "`*_sdf`" in frames
    once = agent_ns["GENIE_COMPUTE_ONCE_RULE"]
    assert "recomputes a DataFrame's whole lineage on every action" in once and "collect its small result to pandas" in once
    assert ".cache()" not in once, "the fix for recomputation must not be a cache, which serverless rejects"
    for technique in TECHNIQUES:
        inst = build_inspire(agent_ns)
        rules = inst._genie_platform_rules(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique})))
        assert all(rule in rules for rule in (significance, facts, numbers, frames, once, period)), technique
        assert agent_ns["GENIE_NUMBER_TEXT_SOURCE"] not in rules, "the helpers are Inspire's own cell, never text in the rules"


def test_the_number_function_inspire_writes_is_the_rules_fmt_num(agent_ns):
    source = agent_ns["GENIE_NUMBER_TEXT_SOURCE"]
    assert source.isascii() and agent_ns["sanitize_llm_special_chars"](source) == source
    assert agent_ns["GENIE_NUMBER_TEXT_NAME"] == "fmt_num" == agent_ns["GENIE_NUMBER_FUNCTIONS"][0]
    scope = {}
    exec(source, scope)
    text = scope[agent_ns["GENIE_NUMBER_TEXT_NAME"]]
    cases = rule_cases(agent_ns["GENIE_NUMBER_FORMAT_RULE"])
    assert {value: text(value) for value in cases} == cases, "Inspire's own text writes the cases the rule asserts"
    assert {value: agent_ns["implement_number_text"](value) for value in cases} == cases
    for value in [sign * mantissa * 10.0 ** power for power in range(-6, 12) for sign in (1, -1)
                  for mantissa in (1, 1.004, 1.06, 1.2, 2.5, 4.9996, 9.995, 9.9996)]:
        assert text(value) == rule_formatter(value), value
    for value, shown in ((120, "120"), (120.4, "120"), (100000, "100K"), (1060, "1.06K"), (17400000, "17.4M"), (2.5e9, "2.5B"),
                         (999.6, "1K"), (999950, "1M"), (-1060, "-1.06K"), (0, "0"), (-0.0, "0"), (0.5, "0.5"), (12.34, "12.3"),
                         (99.95, "100"), (0.0004, "0.0004"), ("12.5", "12.5"), (None, "unknown"), (float("nan"), "unknown"),
                         (float("inf"), "unknown"), ("abc", "unknown"), (agent_ns["pd"].NA, "unknown")):
        assert text(value) == shown, (value, text(value))
    assert text(0.0004, p_value=True) == "< 0.001" and text(0.0123, p_value=True) == "0.0123" and text(-3, p_value=True) == "< 0.001"
    assert text(0, p_value=True) == "< 0.001" and text(0.0004) == "0.0004", "only a p- or q-value reads '< 0.001'"


def test_a_refresh_replaces_older_platform_rules_and_keeps_the_sections_around_them(agent_ns):
    inst = build_inspire(agent_ns)
    spec = inst._genie_notebook_spec(make_uc())
    fresh = "\n\n## Platform Rules\n" + inst._genie_platform_rules(spec) + "\n"
    stored = "# Use case\n\nDo the work.\n\n## Platform Rules\n- strip trailing zeros from a number's text\n\n## Widgets\n- w\n"
    refreshed = inst._genie_with_platform_rules(stored, spec)
    assert "strip trailing zeros" not in refreshed and refreshed.count("## Platform Rules") == 1
    assert "Do the work.\n\n## Widgets\n- w" in refreshed, "a removed section glued its neighbours together"
    assert refreshed.endswith(fresh) and inst._genie_with_platform_rules(refreshed, spec) == refreshed


def test_the_instruction_cell_carries_the_number_rule_and_no_code_of_it(agent_ns):
    inst = build_inspire(agent_ns)
    uc = make_uc()
    instruction = inst._genie_with_platform_rules("# Use case\n\nDo the work.", inst._genie_notebook_spec(uc))
    source = inst._genie_instruction_cell_source(uc, instruction)
    ast.parse(source)
    assert "is written by Inspire's number helpers" in source
    assert agent_ns["GENIE_NUMBER_TEXT_SOURCE"] not in source and "def fmt_num" not in source


def test_numbers_become_text_only_in_python_and_the_explanation_prompt_is_built_there(agent_ns):
    numbers, facts = agent_ns["GENIE_NUMBER_FORMAT_RULE"], agent_ns["GENIE_EXPLANATION_FACTS_RULE"]
    assert "never turn a number into text inside SQL" in numbers
    assert "CAST(... AS STRING), concat and format_string write the raw double" in numbers, \
        "an explanation read 'anomaly score of 0.6793932502246776' from CAST(value AS STRING) in the prompt SQL"
    assert "Build `ai_facts` on every row in pandas as one plain-text column" in facts
    assert "from ai_facts and confidence_level alone" in facts
    assert "so never call ai_query to explain rows and never write those columns" in facts
    _, _, mandate = spec_and_mandate(agent_ns)
    assert "Numbers in text: " + numbers in mandate and "AI facts: " + facts in mandate
    assert "Explanation prompt: " not in mandate and "explanation prompt" not in facts


ROUND27_TRAILING_ZERO_FORMATTER = '''
def fmt_num(value):
    if value is None or (isinstance(value, float) and not np.isfinite(value)): return "unknown"
    value = float(value); absolute = abs(value)
    suffix = ""
    for limit, label in ((1e9, "B"), (1e6, "M"), (1e3, "K")):
        if absolute >= limit: value /= limit; suffix = label; break
    if not suffix and value.is_integer() and absolute < 1000: return str(int(value))
    if absolute and absolute < 0.001: return "< 0.001"
    decimals = max(0, 2 - int(math.floor(math.log10(abs(value))))) if value else 2
    return f"{value:.{decimals}f}".rstrip("0").rstrip(".") + suffix
'''

ROUND27_SUFFIX_FIRST_FORMATTER = '''
def fmt_num(x):
    value = float(x)
    sign = "-" if value < 0 else ""
    value = abs(value)
    for scale, suffix in ((1e9, "B"), (1e6, "M"), (1e3, "K")):
        if value >= scale:
            scaled = value / scale
            decimals = max(0, 2 - int(math.floor(math.log10(scaled))))
            return f"{sign}{scaled:.{decimals}f}{suffix}"
    if value < 1000 and value.is_integer():
        return f"{sign}{int(value)}"
    if value == 0:
        return "0"
    decimals = max(0, 2 - int(math.floor(math.log10(value))))
    return f"{sign}{value:.{decimals}f}"
'''


def rule_formatter(x):
    if x is None or not math.isfinite(float(x)):
        return "unknown"
    x = float(x)
    if x == 0:
        return "0"
    x = round(x, 2 - math.floor(math.log10(abs(x))))
    suffix = ""
    for limit, label in ((1e9, "B"), (1e6, "M"), (1e3, "K")):
        if abs(x) >= limit:
            x, suffix = x / limit, label
            break
    if float(x).is_integer():
        return f"{int(x)}{suffix}"
    text = f"{x:.{max(0, 2 - math.floor(math.log10(abs(x))))}f}"
    return (text.rstrip("0").rstrip(".") if "." in text else text) + suffix


def rule_cases(numbers):
    sentence = numbers[numbers.index("`fmt_num(x)` writes"):]
    sentence = sentence[:sentence.index("; with `p_value=True`")]
    return {float(value): text for text, value in re.findall(r"'([^']+)' for (-?[0-9.]+)", sentence)}


@functools.cache
def inspire_helpers():
    agent = load_agent_namespace()
    scope = {}
    exec(agent["GENIE_NUMBER_TEXT_SOURCE"], scope)
    return types.SimpleNamespace(**{name: scope[name] for name in agent["GENIE_NUMBER_HELPERS"]})


def test_the_number_rules_cases_reject_both_formatters_genie_code_wrote(agent_ns):
    numbers = agent_ns["GENIE_NUMBER_FORMAT_RULE"]
    assert "a multiple ends in 'x' (7.48x the lane median), a share of at most 1 is multiplied by 100 and ends in '%'" in numbers, \
        "a freight reason read 'Ship cost is 23.5 of sales price' for a ship cost 23.5 times the sales price"
    cases = rule_cases(numbers)
    assert len(cases) == 9 and cases[0.0] == "0" and cases[109.96] == "110" and cases[1060.0] == "1.06K" and cases[250000000.0] == "250M"
    assert {value: rule_formatter(value) for value in cases} == cases, "the rule's cases follow the 3-significant-figure algorithm"
    assert {value: inspire_helpers().fmt_num(value) for value in cases} == cases, "Inspire's fmt_num writes the rule's cases"
    for value, text in {99.95: "100", 999999.0: "1M", 13600.5: "13.6K", 1100.0: "1.1K", 0.00123: "0.00123", 15.0: "15",
                        0.0: "0", float("nan"): "unknown", None: "unknown"}.items():
        assert rule_formatter(value) == text, value
    shim = types.SimpleNamespace(isfinite=math.isfinite)
    for source, wrong in ((ROUND27_TRAILING_ZERO_FORMATTER, {109.96: "11", 120.4: "12", 999.6: "1", 250000000.0: "25M", -120.4: "-12"}),
                          (ROUND27_SUFFIX_FIRST_FORMATTER, {999.6: "1000", 0.5: "0.500"})):
        ns = {"math": math, "np": shim}
        exec(source, ns)
        written = {value: ns["fmt_num"](value) for value in cases}
        assert {value: text for value, text in written.items() if text != cases[value]} == wrong, \
            "all 40 Genie Code notebooks of rounds 20 to 27 wrote 110 as 11 or 999.6 as 1000"


def test_a_statistical_result_is_never_written_as_a_data_quality_flag(agent_ns):
    template = agent_ns["PROMPT_TEMPLATES"]["USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT"]
    assert "never a result such as not significant" in template
    for technique in TECHNIQUES:
        inst = build_inspire(agent_ns)
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        for text in (inst._genie_threshold_text(spec), inst._genie_acceptance_stop_rule(spec),
                     inst._build_code_structure_mandate(spec), inst._genie_platform_rules(spec)):
            assert not re.search(r"data_quality_flag (to )?'not significant'", text), technique
    inst = build_inspire(agent_ns)
    spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": "Cohort Analysis"}))
    assert ("with the tier its value_at_stake gives, 'not significant' in its top reasons, a confidence_level that is not 'High' "
            "and data_quality_flag 'ok' unless its own inputs are incomplete") in inst._genie_threshold_text(spec), \
        "a Pareto flagged 14,397 of its 53,268 rows 'not significant'"


def test_frames_from_topandas_drop_the_query_metrics_and_rows_never_loop_with_iterrows(agent_ns):
    frames = agent_ns["GENIE_FRAME_NAMES_RULE"]
    assert "Clear `attrs` on every frame `toPandas()` returns (`x_pdf.attrs = {}`)" in frames
    assert "pandas copies them into every row `iterrows()` yields" in frames, \
        "a 28,000-row iterrows loop over a toPandas() frame ran 39 minutes and a 9,968-row one 23 minutes"
    assert "loop with `itertuples()`, never `iterrows()`" in frames
    for technique in TECHNIQUES:
        inst = build_inspire(agent_ns)
        rules = inst._genie_platform_rules(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique})))
        assert frames in rules, technique


def test_a_weight_from_the_data_never_collapses_the_value_and_a_loss_never_passes(agent_ns):
    weight = agent_ns["GENIE_WEIGHT_CHECK_RULE"]
    assert "Print the distribution of every weight computed from the data that shapes `value` or eligibility" in weight
    assert "never multiplies, clips or filters `value` or the candidates: rank and keep the rows by the method's own score" in weight, \
        "a unit margin negative for all 18,000 TPC-DS items, clipped to 0, made all 454,360 recommendation values 0"
    assert "a value that is the same for every row means a step collapsed it" in weight
    _, _, mandate = spec_and_mandate(agent_ns)
    assert "an expected impact that is not a loss" in meaning(mandate, "priority_tier"), "loss-making offers were 'Act now'"
    for technique in TECHNIQUES:
        inst = build_inspire(agent_ns)
        rules = inst._genie_platform_rules(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique})))
        assert weight in rules, technique


def test_recommender_batches_are_dense_before_argpartition_and_extra_columns_are_dropped(agent_ns):
    recommender = agent_ns["TECHNIQUE_IMPLEMENTATION_GUIDANCE"]["Recommendation"]
    assert "converted to a dense array with .toarray() first, because np.argpartition does not take a sparse matrix" in recommender, \
        "sparse cosine scores failed in np.argpartition and Genie Code had to repair the run"
    inst = build_inspire(agent_ns)
    rules = inst._genie_platform_rules(inst._genie_notebook_spec(make_uc()))
    assert "keeps a column the contract does not list, NULL in the new rows, and prints which columns it changed" in rules, \
        "a legacy extra column made Genie Code rewrite and rerun"
    assert "drop a column" not in rules, "a column a user added to the output table is never deleted"


def test_a_degenerate_weight_never_filters_the_candidates_and_exit_values_are_native_python(agent_ns):
    weight = agent_ns["GENIE_WEIGHT_CHECK_RULE"]
    assert "never multiplies, clips or filters `value` or the candidates" in weight, \
        "a positive-margin filter left one eligible item on TPC-DS, every value was 1.0 and the notebook wrote nothing"
    assert "the decision test, not an eligibility filter, fails the rows whose expected impact is a loss" in weight
    assert "every row Monitor when every row is a loss" in weight
    types = agent_ns["GENIE_DECIMAL_RULE"]
    assert "Convert numpy values to Python types with bool(), int() or float() before json.dumps or dbutils.notebook.exit" in types, \
        "a numpy bool in the exit payload failed the last cell and Genie Code had to rerun"
    assert "DATE values arrive as Python `datetime.date` objects, never Timestamps" in types, \
        "a date compared with a Timestamp failed a routing notebook's first run"
    assert "both in pandas columns and from `first()` or `collect()`" in types and "calling a Timestamp method such as `.date()`" in types, \
        "a newest date read with first() was a datetime.date, and .date() on it failed a network notebook's first run"
    assert "DATE columns arrive in pandas" not in types


def test_run_id_is_one_uuid_per_notebook_run_and_never_the_mlflow_run_id(agent_ns):
    _, _, mandate = spec_and_mandate(agent_ns)
    run_id = meaning(mandate, "run_id")
    assert "one id per run of the use case: a uuid4 made once by the first step of `run_use_case()` and written on every row" in run_id
    assert "never the MLflow run id, which exists only when a model is logged" in run_id, \
        "a recommender that registered no model wrote 454,490 rows with a NULL run_id"
    for technique in TECHNIQUES:
        inst = build_inspire(agent_ns)
        rules = inst._genie_platform_rules(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique})))
        assert ("  - run_id STRING: one id per run of the use case: a uuid4 made once by the first step of `run_use_case()` and "
                "written on every row, never the MLflow run id") in rules, \
            "the instruction model shortened the column list to `run_id`, so only the verbatim Platform Rules reach Genie Code"
        assert "`run_id` is one uuid4" not in rules, "the column list in the Platform Rules is the one place run_id is defined"


def test_ai_query_takes_fail_on_error_as_a_named_argument_and_nan_becomes_null_only_for_the_write(agent_ns):
    facts = agent_ns["GENIE_EXPLANATION_FACTS_RULE"]
    assert "When a step of the method itself calls ai_query, pass the named argument `failOnError => false`" in facts
    assert "never `named_struct('failOnError', false)`, which ai_query does not read as that option" in facts, \
        "the struct form returned plain text instead of the result struct and Genie Code had to rewrite the extraction"
    inst = build_inspire(agent_ns)
    rules = inst._genie_platform_rules(inst._genie_notebook_spec(make_uc()))
    assert "replace pandas NaN with None in a copy made only for the write, so the frame the summary step uses keeps its columns and types" in rules, \
        "NaN-to-None on the working frame made rank an object column and the summary cell failed"
    assert "build every business output column on the working frame, then replace pandas NaN" in rules, \
        "a notebook added its metadata columns only to the write copy and its summary preview failed"


def test_a_training_set_without_positives_is_an_empty_input_and_distinct_windows_are_split(agent_ns):
    classes = agent_ns["GENIE_TRAINING_CLASSES_RULE"]
    assert "A classifier's training rows must hold at least `min_positives` examples of each class" in classes, \
        "an uplift notebook trained on a window with no positive outcome and wrote 9,819 rows with one value"
    assert "print the class counts and stop by the STOP RULE" in classes and "min_positives" not in agent_ns["GENIE_EMPTY_INPUT_RULE"]
    inst = build_inspire(agent_ns)
    for technique, expected in (("Classification", True), ("Predictive Modeling", True), ("Forecasting", False),
                                ("Cohort Analysis", False), ("Recommendation", False), ("Anomaly Detection", False)):
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        assert ("min_positives" in spec["thresholds"]) is expected, technique
        assert (classes in inst._genie_platform_rules(spec)) is expected, \
            f"{technique}: the rule names the min_positives widget, which only a family with that threshold has"
    assert "COUNT(DISTINCT ...) over a window" in agent_ns["GENIE_SQL_NESTING_RULE"], "a Pareto's distinct window count failed its first run"


def test_spark_rejects_nested_windows_and_aggregates_so_each_runs_in_its_own_step(agent_ns):
    nesting = agent_ns["GENIE_SQL_NESTING_RULE"]
    assert "a window function inside an aggregate" in nesting and "an aggregate inside another aggregate" in nesting, \
        "an entropy feature nested a window in an aggregate and the first run failed"
    assert "in its own step" in nesting
    for technique in TECHNIQUES:
        inst = build_inspire(agent_ns)
        rules = inst._genie_platform_rules(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique})))
        assert nesting in rules, technique


def test_trend_and_cohort_guidance_avoid_the_smoothed_trend_and_seasonal_confounding(agent_ns):
    guidance = agent_ns["TECHNIQUE_IMPLEMENTATION_GUIDANCE"]
    trend, cohort = guidance["Trend Analysis"], guidance["Cohort Analysis"]
    assert "OLS of the observed values on time plus season (month or week of year) indicators over the full history" in trend
    assert "Never test an STL component or the observed values minus one" in trend and "never write a test statistic by hand" in trend, \
        "a hand-written Mann-Kendall (round 9) and an STL-deseasonalized HAC test (round 10) called flat series significant"
    assert "with HAC standard errors when there are at least 30 points" in trend
    assert "never a hand-written test statistic" in agent_ns["GENIE_SIGNIFICANCE_RULE"]
    assert "compare each cohort with the prior cohorts using" not in cohort, "a Q4 cohort met an all-season average"
    assert "the prior cohorts that started in the same season" in cohort and "prior same-season cohorts' rate" in cohort
    assert "leaving out the cohort of the data's first period" in cohort and "'no same-season baseline'" in cohort


def test_the_model_writing_the_instruction_reads_both_rules_for_every_pattern(agent_ns):
    for technique in TECHNIQUES:
        _, _, mandate = spec_and_mandate(agent_ns, **{"Analytics Technique": technique})
        assert "Significance tests: " + agent_ns["GENIE_SIGNIFICANCE_RULE"] in mandate, technique
        assert "Numbers in text: " + agent_ns["GENIE_NUMBER_FORMAT_RULE"] in mandate, technique
        assert "AI facts: " + agent_ns["GENIE_EXPLANATION_FACTS_RULE"] in mandate, technique
    template = agent_ns["PROMPT_TEMPLATES"]["USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT"]
    output = template[template.index("## 7. Business Output"):template.index("## 8. Definition of Done")]
    assert "the recommended action template per priority tier" in output and "the action text per priority tier" not in output


def _model_stop_rule(agent_ns, technique, basis):
    inst = build_inspire(agent_ns)
    spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
    assert spec["family"] in agent_ns["INSPIRE_MODEL_FAMILIES"] and spec["decision_basis"] == basis, technique
    return inst._genie_acceptance_stop_rule(spec)


def test_a_model_that_misses_acceptance_publishes_its_baseline_and_registers_nothing(agent_ns):
    baseline, monitor = agent_ns["GENIE_BASELINE_VALUE_RULE"], agent_ns["GENIE_BASELINE_MONITOR_RULE"]
    assert "When the baseline itself misses the acceptance thresholds, every row is Monitor" in monitor
    for technique, basis, ending in (("Predictive Modeling", "predicted", monitor + " " + agent_ns["GENIE_PREDICTED_ACCEPTED_RULE"]),
                                     ("Clustering", "measured", agent_ns["GENIE_MEASURED_TIER_RULE"])):
        rule = _model_stop_rule(agent_ns, technique, basis)
        assert "No approved model yet" in rule and "registers no model" in rule and "{tiers}" not in rule, technique
        assert "writes the baseline's rows" in rule and "the baseline's name as `method`" in rule and "writes nothing" not in rule
        assert baseline in rule and rule.endswith(ending), technique
        assert rule.count("misses the acceptance thresholds") == (basis == "predicted"), \
            "a measured amount stays in its tier when the baseline misses acceptance; only a prediction falls to Monitor"
    assert "the baseline's rows, each with the tier its value_at_stake gives." in _model_stop_rule(agent_ns, "Clustering", "measured")


def test_a_missed_acceptance_writes_the_varying_baseline_for_every_entity_never_a_constant_or_a_sample(agent_ns):
    rule = _model_stop_rule(agent_ns, "Predictive Modeling", "predicted")
    assert "the baseline model's own score for each entity of the scoring population as `value`" in rule
    assert "a constant such as 0 or the class rate is only the reference the baseline is compared with and is never written as `value`" in rule, \
        "306 rows all carried the class rate 0.859 when neither model passed acceptance"
    once = agent_ns["GENIE_COMPUTE_ONCE_RULE"]
    assert "the sample is for the evaluation only, and the scoring and the business output keep every entity" in once, \
        "a 5,000-row evaluation sample taken before the split left 306 of about 28,000 customers to score"


def test_each_pattern_still_writes_rows_when_acceptance_fails_except_bad_ai_text(agent_ns):
    stop = agent_ns["DatabricksInspire"]._GENIE_ACCEPTANCE_STOP
    assert "data_quality_flag" not in stop["E"], "the fallback method is a run-level note, not a row's input problem"
    assert "`seasonal_naive`" in stop["E"] and "its summary says the candidate did not beat it" in stop["E"]
    assert "keeps the tier its value_at_stake gives and says 'not significant' in its top reasons" in stop["F"]
    assert "writes the current plan's rows with method `current_plan`, every row Monitor" in stop["H"]
    assert "writes nothing" not in stop["H"]
    assert "writes nothing" in stop["G"], "AI labels above the error-rate limit would mislead"


def test_a_reportable_group_is_the_unit_the_findings_compare_never_one_scored_entity(agent_ns):
    inst = build_inspire(agent_ns)
    text = inst._genie_threshold_text(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": "Pareto Analysis"})))
    group = next(line for line in text.splitlines() if line.startswith("- a group is"))
    assert "the unit the findings compare and report" in group
    assert "the entities a Pareto, a network or a ranking scores are rows inside those groups, never groups themselves" in group, \
        "a Pareto counted (store, item) pairs as groups and a network counted single senders, and both stopped at readiness"
    other = inst._genie_threshold_text(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": "Anomaly Detection"})))
    assert "- a group is" not in other


def test_a_runtime_assumption_is_measured_on_the_rows_its_statement_is_about(agent_ns):
    inst = build_inspire(agent_ns)
    spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": "Anomaly Detection"}))
    spec["runtime_assumptions"] = [{"kind": "KEY_HAS_REPEATED_ROWS", "table": "c.s.ship_mode", "column": "c.s.ship_mode.sm_carrier",
                                    "statement": "Each lane has multiple order lines so a peer median baseline can be formed"}]
    line = next(l for l in inst._genie_threshold_text(spec).splitlines() if l.startswith("- readiness assumption"))
    assert "measure it on the rows its statement is about" in line
    assert "never in a dimension table where each key appears once" in line, \
        "an assumption about order lines per lane was counted on the 20-row ship_mode table and stopped a freight audit"


def test_stale_data_flags_every_row_instead_of_stopping_and_other_checks_still_stop(agent_ns):
    inst = build_inspire(agent_ns)
    text = inst._genie_threshold_text(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": "Forecasting"})))
    stale = next(line for line in text.splitlines() if "`staleness_cadences`" in line)
    assert "the notebook keeps running as of the newest data" in stale and "'data ends <newest date>'" in stale
    assert "a check that never stops the run" in stale and "raise the max_staleness_cadences widget" in stale
    assert "measured from the newest data to the run's as_of_date and never to today" in stale
    assert "as_of_date = latest, which is the newest data, always passes it and flags no row" in stale, \
        "a 2016 dataset run as of its newest day flagged every row 'data ends' because staleness was measured to today"
    assert "older than today" not in stale and "older than the run's as_of_date" in stale
    cycles = next(line for line in text.splitlines() if "`seasonal_cycles`" in line)
    assert "keep running" not in cycles, "a forecast without enough history still stops"


def test_the_agents_file_defers_to_the_instruction_acceptance_rule(agent_ns):
    agents = agent_ns["GENIE_AGENTS_FILE_TEMPLATE"]
    assert "or no candidate passes the acceptance rule, that is a valid outcome" not in agents
    assert "When no candidate passes the acceptance rule, do what the instruction's acceptance rule says" in agents
    assert "unless the instruction says the check only flags rows" in agents


class _Endpoint:
    def __init__(self, name):
        self.name = name


class _Listing:
    def __init__(self, names):
        self.serving_endpoints = self
        self._names = names

    def list(self):
        return iter(_Endpoint(n) for n in self._names)


WORKSPACE = ["databricks-claude-opus-5-5", "databricks-claude-opus-4-8", "databricks-claude-sonnet-4-5", "databricks-claude-sonnet-4-6",
             "databricks-claude-haiku-4-5", "databricks-gpt-oss-120b", "databricks-gpt-oss-20b", "my-team-sonnet-proxy"]
FAST = ["databricks-claude-sonnet-4-6", "databricks-claude-sonnet-4-5", "databricks-claude-haiku-4-5", "databricks-gpt-oss-120b",
        "databricks-gpt-oss-20b"]


def test_explanations_cover_only_the_acting_rows(agent_ns):
    _, _, mandate = spec_and_mandate(agent_ns)
    facts, level = meaning(mandate, agent_ns["INSPIRE_AI_FACTS"]), meaning(mandate, agent_ns["INSPIRE_CONFIDENCE"])
    assert "on every row" in facts and "never written by a model" in facts
    assert "'High', 'Medium' or 'Low' on every row, set by one rule in code" in level and "never written by a model" in level
    columns = [name for name, _kind in agent_ns["INSPIRE_CORE_COLUMNS"]]
    assert "explanation" not in columns and not any(line.startswith("- explanation ") for line in mandate.splitlines()), \
        "Genie wrote 200 explanations itself; Inspire now explains the flagged rows from ai_facts"
    assert "explanation_top_k" not in agent_ns["GENIE_WIDGET_LABELS"]
    assert "'Act now' and 'Review' rows" in agent_ns["GENIE_EXPLANATION_FACTS_RULE"]


def test_fast_chat_endpoints_are_the_worker_families_newest_first(agent_ns):
    from unittest.mock import MagicMock, patch
    with patch("databricks.sdk.WorkspaceClient", lambda: _Listing(WORKSPACE)):
        names = agent_ns["_list_fast_chat_endpoints"](MagicMock())
    assert names == FAST, "no Opus, no endpoint outside Databricks, Sonnet before Haiku before GPT OSS"
    with patch("databricks.sdk.WorkspaceClient", side_effect=RuntimeError("no auth")):
        assert agent_ns["_list_fast_chat_endpoints"](MagicMock()) == []


def test_startup_records_the_fast_chat_endpoints_next_to_an_all_opus_roster(fresh_ns):
    from unittest.mock import MagicMock, patch
    with patch("databricks.sdk.WorkspaceClient", lambda: _Listing(WORKSPACE[:2] + FAST)):
        fresh_ns["_apply_auto_detected_endpoints"](MagicMock(), spark_session=None)
    assert fresh_ns["TECHNICAL_CONTEXT"]["fast_chat_endpoints"] == FAST


def test_the_explanation_endpoint_is_a_fast_chat_model_when_the_roster_has_no_worker(fresh_ns):
    ctx = fresh_ns["TECHNICAL_CONTEXT"]
    ctx["models"] = [{"name": f"o{i}", "order": i, "type": "thinker", "size": "large", "enabled": True,
                      "llm_endpoint_name": f"databricks-opus-{i}"} for i in (1, 2)]
    ctx["fast_chat_endpoints"] = ["databricks-fast-a", "databricks-fast-b"]
    default = fresh_ns["DatabricksInspire"]._genie_ai_endpoint_default
    assert default() == "databricks-fast-a", "200 explanations never go to the slowest reasoning model"
    fresh_ns["LLM_ENDPOINT_HEALTH"].mark_unusable("databricks-fast-a", "probe failed")
    assert default() == "databricks-fast-b", "an endpoint that failed its probe is skipped"
    ctx["fast_chat_endpoints"] = []
    assert default() == "databricks-opus-1", "with no fast model the roster's first model still serves"


def test_keys_ranks_and_counts_stay_integers(agent_ns):
    rule = agent_ns["GENIE_DECIMAL_RULE"]
    assert "cast pandas numeric columns to float" not in rule, "a float key reads 2.0 in an explanation"
    assert "Keep keys, ids, ranks and counts as integers" in rule and "cast pandas columns that hold `Decimal` values" in rule
    assert "before `toPandas()`, `first()` or `collect()`" in rule, "a Decimal from first() broke a summary print"


def test_explanations_keep_the_result_text_and_missing_values_stay_null(agent_ns):
    facts = agent_ns["GENIE_EXPLANATION_FACTS_RULE"]
    assert "returns a struct: store its `result` text in SQL (NULL when `errorMessage` is set)" in facts
    assert "never the struct or its string form" in facts, "48 explanations were stored as {'result': ...} text"
    assert "Call it without responseFormat, which some endpoints reject" in facts
    inst = build_inspire(agent_ns)
    rules = inst._genie_platform_rules(inst._genie_notebook_spec(make_uc()))
    assert "replace pandas NaN with None in a copy made only for the write" in rules, "762 rows carried the text 'nan'"
    assert "a cast turns NaN into the text 'nan'" in rules


def test_the_notebook_installs_nothing_because_environment_4_already_ships_its_libraries(agent_ns):
    _, _, mandate = spec_and_mandate(agent_ns, **{"Analytics Technique": "Classification"})
    assert "Environment: serverless environment version 4, which already ships scikit-learn==1.6.1; the notebook installs nothing." \
        in mandate and "%pip" not in mandate, "a sealed workspace has no package index, so a pip line stops the notebook"


def test_a_drifted_output_schema_is_repaired_not_kept(agent_ns):
    inst = build_inspire(agent_ns)
    rules = inst._genie_platform_rules(inst._genie_notebook_spec(make_uc()))
    assert "cast every business output column to its type in `result_table`" not in rules, "that kept a wrong type forever"
    assert "a struct explanation becomes its result text" in rules and "inspire_write_result converts that column's existing" in rules
    assert "a string top_reasons becomes a one-element array" in rules, "Spark cannot cast a string to an array directly"
    assert "adds a column the table lacks (NULL for older rows)" in rules, "an older table without a contract column failed the append"
    assert "you never rewrite the table" in rules, "Inspire's writer owns every write to the business output table"
    for name, sql_type in agent_ns["INSPIRE_CORE_COLUMNS"]:
        assert f"{name} {sql_type}" in rules


def test_the_length_target_measures_the_draft_and_the_repair_names_its_reason(fresh_ns):
    fresh_ns["GENIE_INSTRUCTION_MAX_CHARS"] = 400
    long_text = long_instruction(f"Use `{ORDERS}.amount`. " + "Detail. " * 80)
    short_text = long_instruction(f"Use `{ORDERS}.amount`.")
    assert len(short_text) < 400 < len(long_text)
    agent = FakeAgent([long_text, short_text])
    inst = build_inspire(fresh_ns, loader=FakeLoader(), quality="Ultra High", agent=agent)
    uc = inst._generate_genie_instruction_for_use_case(make_uc(), [], "")
    repair = [str(c) for c in inst.logger.warning.call_args_list if "[GENIE-REPAIR]" in str(c)]
    assert len(repair) == 1 and "draft over the 400-character target" in repair[0] and ": []" not in repair[0]
    assert len(uc["genie_instruction"]) > 400, "Inspire's Platform Rules come on top of the draft"
    assert not any("[GENIE-SIZE]" in str(c) for c in inst.logger.warning.call_args_list), "the repaired draft meets the target"
    fits = FakeAgent([short_text])
    inst2 = build_inspire(fresh_ns, loader=FakeLoader(), quality="Ultra High", agent=fits)
    inst2._generate_genie_instruction_for_use_case(make_uc(), [], "")
    assert len(fits.calls) == 1, "a draft under the target is never sent back because Inspire's additions are long"


def test_round_20_repairs_become_rules_for_tuples_flags_and_empty_slices(agent_ns):
    frames = agent_ns["GENIE_FRAME_NAMES_RULE"]
    assert "`itertuples()` renames a column whose name starts with an underscore or is not a valid identifier to its position" in frames, \
        "a freight notebook read row._excess_cost from itertuples() and failed"
    types = agent_ns["GENIE_DECIMAL_RULE"]
    assert "Spark never converts between BOOLEAN and numbers: cast a 0/1 flag to BOOLEAN before OR, AND" in types, \
        "coalesce(flag, 0) OR coalesce(flag, 0) failed a coupon notebook's first run"
    assert "and a BOOLEAN to INT before SUM or arithmetic" in types
    empty = agent_ns["GENIE_EMPTY_INPUT_RULE"]
    assert "When a step or a model wrapper splits its input by a key or a model type, skip each empty slice" in empty, \
        "a model wrapper called scikit-learn on an empty model-type slice"
    assert "Read and assign pandas columns as `x_pdf['name']`, never `x_pdf.name`" in frames, \
        "x_pdf.tail returned the DataFrame method instead of the tail column and a Pareto failed"
    assert "such as rank, count, tail or size, returns the method instead" in frames
    periods = agent_ns["GENIE_PERIOD_COMPLETE_RULE"]
    assert "Compute period starts and ends with pandas periods" in periods and "never by adding months to a date by hand" in periods, \
        "a quarter end computed as month + 3 raised 'month must be in 1..12' for Q4"
    assert "such as a key into a date table, a yyyymmdd number or epoch seconds, becomes a calendar date" in periods, \
        "a basket notebook resolved latest to the date key 2452642 and wrote NULL as_of_date on 50,000 rows"
    assert "join the date table on the key and read its date column" in periods
    assert "`as_of_date` is always a calendar date, never a key or a number" in periods
    nesting = agent_ns["GENIE_SQL_NESTING_RULE"]
    assert "wrap every comparison in parentheses before combining it with `&` or `|`" in nesting, \
        "a Pareto combined two Spark comparisons with & and failed its readiness filter (round 21)"
    once = agent_ns["GENIE_COMPUTE_ONCE_RULE"]
    assert ("Sample per group with `x_pdf.sample(frac=1, random_state=seed).groupby(key).head(n)`, which keeps the group key "
            "column") in once, "a per-group capped sample dropped sm_type and the freight notebook failed with KeyError (round 21)"
    assert "never inside `groupby(...).apply(...)`" in once
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES:
        rules = inst._genie_platform_rules(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique})))
        assert frames in rules and types in rules and empty in rules and periods in rules, technique
        assert nesting in rules and once in rules, technique


def test_round_22_per_unit_tests_take_their_minimum_from_the_test_and_never_stop_the_run(agent_ns):
    unit = agent_ns["GENIE_PER_UNIT_SAMPLE_RULE"]
    assert "its per-unit minimum sample comes from the test, never a round number" in unit, \
        "a halo test set min_item_tickets to 30, no tail item reached it, and the run stopped with 53,999 Pareto items unwritten"
    assert ("and no readiness threshold, such as `min_group_rows` for the groups a comparison reports, sets that unit's "
            "minimum") in unit, "Inspire's readiness thresholds stay fixed: the STOP RULE never lets Genie Code lower one"
    group_rule = build_inspire(agent_ns)._genie_threshold_text(
        build_inspire(agent_ns)._genie_notebook_spec(make_uc(**{"Analytics Technique": "Pareto Analysis"})))
    assert "groups with fewer than 30 rows are left out of the group findings and counted in the summary" in group_rule, \
        "groups a comparison reports keep their own readiness minimum and are still left out below it"
    assert ("the smallest sample at which either of its two extreme outcomes (such as every trial a success, or none) reaches, in "
            "the same library test, the significance level (`fdr_alpha`, else 0.05) divided by the number of units with at least "
            "that sample") in unit and "and at least 5" in unit, \
        "a binomial test per gift sender ran on 1 or 2 recipients, so every q-value was 1.0"
    assert "Readiness prints how many units reach it and their median sample size" in unit
    assert "Units below it are not tested and stay out of the multiple-test correction" in unit
    assert "their rows stay, flagged 'too few <observations>' and Monitor" in unit
    assert "a test left with no unit to test is not an empty input and never stops the run" in unit
    assert "(sum + m * baseline) / (n + m) with m the per-unit minimum" in unit, \
        "senders whose 1 of 1 recipients converted ranked 1 to 4, above every sender with enough recipients to test"
    assert unit.isascii()
    empty = agent_ns["GENIE_EMPTY_INPUT_RULE"]
    assert ("never call it on an empty input: when it has none, print how many rows each filter and each feature removed and "
            "stop by the STOP RULE") in empty, "an empty input still stops the run; only a test left with no unit to test does not"
    significance = agent_ns["GENIE_SIGNIFICANCE_RULE"]
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES:
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        rules = inst._genie_platform_rules(spec)
        assert unit in rules and rules.index(significance) < rules.index(unit), technique
        assert "Per-unit statistics: " + unit in inst._build_code_structure_mandate(spec), \
            f"{technique}: the model writing the instruction picks the per-unit minimum, so it reads the rule too"


def test_round_23_ratios_survive_zero_shares_keep_losing_groups_and_small_groups_never_stop_the_run(agent_ns):
    types = agent_ns["GENIE_DECIMAL_RULE"]
    assert "Serverless runs Spark SQL in ANSI mode" in types and "`F.try_divide(a, b)`" in types, \
        "a shipping-cost ratio over a zero column raised DIVIDE_BY_ZERO and Genie Code had to rerun"
    assert "cast text with `try_cast`" in types and "replace inf with NaN" in types
    weight = agent_ns["GENIE_WEIGHT_CHECK_RULE"]
    assert ("A share, a cumulative share or a concentration (a Pareto curve, a Gini, a top-k share) needs values of one "
            "sign") in weight, "698 of 700 store and class groups lost money, so a profit Pareto tested no group and wrote NULL tests"
    assert "analyze a group with a negative total on its losses" in weight
    assert "no group is left out, and no test is left with no group, because of the sign of its measure" in weight
    empty = agent_ns["GENIE_EMPTY_INPUT_RULE"]
    assert "`pd.DataFrame(rows, columns=[...])`" in empty, \
        "a test that had no group to test built a frame without its columns and failed with KeyError"
    frames = agent_ns["GENIE_FRAME_NAMES_RULE"]
    assert "repeats index labels: call `reset_index(drop=True)` right after it" in frames, \
        "a landmark expansion duplicated pandas indices and a survival notebook's holdout labels and predictions misaligned (round 22)"
    assert "line up labels, predictions and features by key columns or position, never by index labels" in frames
    assert "a filter on a derived column runs after the step that adds it" in frames, \
        "a holdout filter read a column added later (round 22) and a readiness CTE dropped the date key a later join read (round 23)"
    assert weight.isascii() and types.isascii() and empty.isascii() and frames.isascii()
    guidance = agent_ns["TECHNIQUE_IMPLEMENTATION_GUIDANCE"]
    families = agent_ns["TECHNIQUE_EXECUTION_FAMILY"]
    assert sum(1 for technique in guidance if families[technique] == "F") == 9
    for technique, text in guidance.items():
        shortfall = text.split("\n")[-1]
        assert "below the minimum rows or fewer than two periods stop the run" not in shortfall, \
            f"{technique}: one small group must never stop a run that has enough groups to compare"
        if families[technique] == "F":
            assert "below the minimum rows are left out of the findings and counted" in shortfall, technique
            assert "`min_reportable_groups`" in shortfall and "`min_periods`" in shortfall, technique
    assert "every contributor of a reported group keeps its place in that group's share" in guidance["Pareto Analysis"]
    assert ("while every node is still scored and a node's own influence test needs only its per-unit minimum"
            in guidance["Network Analysis"])
    assert "every node of a reported group is scored" not in guidance["Network Analysis"], \
        "round 28: a network tested a sender only inside a cohort of 30 testable senders, so 0 of 46,353 senders were tested"
    assert "contributors below the minimum rows" not in guidance["Pareto Analysis"], \
        "the items a Pareto scores are rows inside its groups, never groups themselves"
    assert "fewer than two seasonal cycles or many missing periods stop the run at the readiness gate" in guidance["Forecasting"]
    assert "an as_of_date past the newest data flags every row and never stops it" in guidance["Forecasting"], \
        "data freshness is a check that never stops the run, so the guidance never says it does"
    assert all("stale data or" not in text for text in guidance.values())
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        rules = inst._genie_platform_rules(spec)
        assert types in rules and weight in rules and empty in rules and frames in rules, technique
        assert "Weights and signed measures: " + weight in inst._build_code_structure_mandate(spec), \
            f"{technique}: the model writing the instruction designs the shares and the eligibility, so it reads the rule too"


def test_round_24_closed_windows_keyword_model_logging_own_run_controls_cell_and_kept_columns(agent_ns):
    closed = agent_ns["GENIE_CLOSED_WINDOW_RULE"]
    assert "is closed only when its last day plus that horizon is before as_of_date" in closed, \
        "a lapse holdout took the newest quarter with any closed spell, held only reorders and stopped the run (round 24)"
    assert "never by which units already have an outcome" in closed
    assert "never label it as a negative" in closed
    assert "out of every comparison instead of counting it as zero" in closed
    guidance = agent_ns["TECHNIQUE_IMPLEMENTATION_GUIDANCE"]
    assert "on the offsets that are closed for every cohort compared" in guidance["Cohort Analysis"]
    assert "counting only the entrants whose conversion window is closed" in guidance["Funnel Analysis"]
    inst = build_inspire(agent_ns)
    with_rule, without_rule = set(), set()
    for technique, text in guidance.items():
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        in_rules = closed in inst._genie_platform_rules(spec)
        in_mandate = "Outcome windows: " + closed in inst._build_code_structure_mandate(spec)
        assert in_rules == in_mandate == (spec["family"] in ("A", "F")), technique
        (with_rule if in_rules else without_rule).add(spec["family"])
        if re.search(r"\bclosed\b", text):
            assert in_rules, f"{technique}: its guidance says closed, so its notebook gets the definition"
    assert with_rule == {"A", "F"} and without_rule == {"B", "C", "D", "E", "G", "H"}, (with_rule, without_rule)
    mlflow = agent_ns["GENIE_MLFLOW_RULE"]
    calls = re.findall(r"`mlflow\.\w+\.log_model\(([^`]*)\)`", mlflow)
    assert len(calls) == 2 and "sk_model=model" in calls[0] and "python_model=wrapper" in calls[1], calls
    for call in calls:
        assert all(re.match(r"^\w+=", arg.strip()) for arg in call.split(",")), \
            f"every log_model argument is a keyword: {call}"
    assert "the first positional parameter of `mlflow.pyfunc.log_model` is `artifact_path`" in mlflow, \
        "a pyfunc wrapper passed by position collided with artifact_path and the model never registered (round 24)"
    assert "log_model(model," not in mlflow and "log_model(wrapper," not in mlflow
    boundary = agent_ns["GENIE_CELL_BOUNDARY_RULE"]
    assert "`# COMMAND ----------`" in boundary and "Run controls (Inspire, do not edit)" in boundary, \
        "a notebook written as a source file lost the separator above Run controls and fused it with the code (round 24)"
    assert "after each import, check that the notebook's last cell is the Run controls cell" in boundary
    assert boundary in agent_ns["GENIE_RUN_CONTROLS_RULE"] and boundary in agent_ns["GENIE_AGENTS_FILE_TEMPLATE"]
    frames = agent_ns["GENIE_FRAME_NAMES_RULE"]
    assert "keeps every column a later step reads" in frames and "a flag, a reason or the output" in frames, \
        "a feature step dropped the demographic key the output's quality flag read, and the run failed with KeyError (round 24)"
    assert "feeds a later filter, join or grouping keeps the columns that step reads" not in frames
    assert closed.isascii() and mlflow.isascii() and boundary.isascii() and frames.isascii()
    spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": "Survival Analysis"}))
    rules = inst._genie_platform_rules(spec)
    assert closed in rules and mlflow in rules and boundary in rules and frames in rules


def test_round_25_date_windows_are_range_frames_on_the_day_number_and_joins_leave_each_name_once(agent_ns):
    frame = agent_ns["GENIE_DATE_FRAME_RULE"]
    assert "is a range frame on the date as a day number" in frame, \
        "an uplift notebook built its prior-order features with a rows frame, so a second order on a day read the first as " \
        "its history and the leakage guard stopped the first run (rounds 19, 20 and 25)"
    assert "`.rangeBetween(Window.unboundedPreceding, -1)` for the earlier dates" in frame
    assert "`.rangeBetween(1, horizon_days)`" in frame
    assert "RANGE BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING` in SQL" in frame
    assert "A rows frame also counts the other rows of the same date" in frame
    assert "unless the frame runs over one row per key and date" in frame
    assert "rowsBetween" not in frame and "ROWS BETWEEN" not in frame
    window = next(code for code in re.findall(r"`([^`]+)`", frame) if code.startswith("Window.partitionBy("))
    ast.parse(window)
    ast.parse("w" + ".rangeBetween(Window.unboundedPreceding, -1)")
    assert "F.datediff(F.col(date), F.lit('1970-01-01').cast('date'))" in window, "rangeBetween needs one numeric order"
    join = agent_ns["GENIE_JOIN_RULE"]
    assert "only when every key has that name on both sides" in join, \
        "a join on [recipient, d_date] after d_date became first_gift_date failed with UNRESOLVED_USING_COLUMN_FOR_JOIN (round 25)"
    assert "and drop the other side's key" in join
    assert "so each name exists once after it" in join, "joins that kept a shared column raised AMBIGUOUS_REFERENCE (rounds 7 and 8)"
    assert "rename the columns of a frame joined to itself or to a frame built from it, such as its aggregate" in join
    assert "qualify every column read after a join with its table alias" in join
    for code in re.findall(r"`([^`]+)`", join):
        ast.parse(code)
    assert frame.isascii() and join.isascii() and "\u2014" not in frame + join and "\u2013" not in frame + join
    nesting = agent_ns["GENIE_SQL_NESTING_RULE"]
    inst = build_inspire(agent_ns)
    families = set()
    for technique in agent_ns["TECHNIQUE_IMPLEMENTATION_GUIDANCE"]:
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        rules = inst._genie_platform_rules(spec)
        assert rules.count(frame) == 1 and rules.count(join) == 1, technique
        assert rules.index(nesting) < rules.index(join) < rules.index(frame), technique
        mandate = inst._build_code_structure_mandate(spec)
        assert mandate.count("Date windows: " + frame) == 1, technique
        out = inst._apply_genie_instruction_contract("U1", "## 1. Goal\nGoal.\n\n## 4. Readiness Check\nChecks.\n", spec)
        again = inst._apply_genie_instruction_contract("U1", out, spec)
        assert again.count(frame) == 1 and again.count(join) == 1, technique
        families.add(spec["family"])
    assert families == set("ABCDEFGH"), families


PANDAS_PROBE = r'''
import json, sys
import numpy as np
import pandas as pd

code = json.loads(sys.stdin.read())
x_pdf = pd.DataFrame({"name": ["a", "b", "c"], "share": [0.5, np.inf, -np.inf],
                      "paid": [np.array([1.0, 2.0]), None, np.array([3.0])]})
rows = list(x_pdf.itertuples(index=False))


def outcome(run):
    try:
        run()
        return "ok"
    except (TypeError, ValueError) as error:
        return type(error).__name__


scope = {"np": np, "x_pdf": x_pdf.copy()}
exec(code["num"] + "\n" + code["replace"], scope)
print(json.dumps({
    "whole_frame": outcome(lambda: x_pdf.replace([np.inf, -np.inf], np.nan)),
    "numeric_columns": scope["num"].tolist(),
    "replaced": scope["x_pdf"]["share"].isna().tolist(),
    "arrays_kept": [None if v is None else v.tolist() for v in scope["x_pdf"]["paid"]],
    "read": [eval(code["read"], {"np": np, "x": row.paid}).tolist() for row in rows],
    "condition": outcome(lambda: [eval(code["condition"], {"x": row.paid}) for row in rows]),
    "field": [eval(code["field"], {"row": row}) for row in rows],
    "bracket": outcome(lambda: eval(code["bracket"], {"row": rows[0]})),
}))
'''


def test_round_26_tuple_rows_array_values_and_inf_replacement_follow_how_pandas_reads_them(agent_ns):
    frames, types = agent_ns["GENIE_FRAME_NAMES_RULE"], agent_ns["GENIE_DECIMAL_RULE"]
    assert "its rows are named tuples: read a field as `row.name`, never `row['name']`, which raises TypeError" in frames, \
        "a freight notebook read itertuples() rows as row['col'] and its first run stopped on TypeError (round 26)"
    assert "`toPandas()` turns each value of an ARRAY or MAP column into a numpy array or a dict, and NULL into None" in frames, \
        "a Pareto notebook read its per-item ticket arrays with `row.other_paid_values or []` and failed (round 26)"
    assert "never test it as a condition such as `if x` or `x or []`, which fails on an array of two or more elements" in frames
    assert "Read and assign pandas columns as `x_pdf['name']`, never `x_pdf.name`" in frames
    assert "before a fit, a score or the write, in the numeric columns only" in types, \
        "the same notebook replaced inf over the whole frame, which compared its ticket arrays and failed again (round 26)"
    assert "a replace over the whole frame also compares each array value of an ARRAY column and fails" in types
    snippets = re.findall(r"`([^`]+)`", frames) + re.findall(r"`([^`]+)`", types)
    code = {"num": next(s for s in snippets if s.startswith("num = ")), "replace": next(s for s in snippets if s.startswith("x_pdf[num] = ")),
            "read": next(s for s in snippets if s.startswith("np.asarray(")), "condition": "x or []",
            "field": "row.name", "bracket": "row['name']"}
    assert all(f"`{snippet}`" in frames + types for snippet in code.values())
    for snippet in code.values():
        ast.parse(snippet)
    done = subprocess.run([sys.executable, "-c", PANDAS_PROBE], input=json.dumps(code), capture_output=True, text=True, timeout=300)
    assert done.returncode == 0, done.stderr[-3000:]
    probe = json.loads(done.stdout)
    assert probe["whole_frame"] == "ValueError" and probe["condition"] == "ValueError" and probe["bracket"] == "TypeError", probe
    assert probe["numeric_columns"] == ["share"] and probe["replaced"] == [False, True, True], probe
    assert probe["arrays_kept"] == [[1.0, 2.0], None, [3.0]], probe
    assert probe["read"] == [[1.0, 2.0], [], [3.0]] and probe["field"] == ["a", "b", "c"], probe
    assert frames.isascii() and types.isascii() and "\u2014" not in frames + types and "\u2013" not in frames + types


def test_round_26_each_step_receives_as_arguments_the_values_earlier_steps_computed(agent_ns):
    rule, agents = agent_ns["GENIE_RUN_CONTROLS_RULE"], agent_ns["GENIE_AGENTS_FILE_TEMPLATE"]
    assert ("which runs the steps in order and passes each step, as arguments, every value it reads that an earlier step "
            "computed") in rule, \
        "a Pareto notebook's text step read the per-unit minimum m that another step computed and failed with NameError (round 26)"
    assert "since a name local to `run_use_case()` or to another step does not exist inside a step" in rule
    assert "define run_use_case(), which runs the steps in order, passes each step as arguments the values earlier steps computed" in agents
    reads_local = "def text_step(rows):\n    return [r * m for r in rows]\n\n\ndef run_use_case():\n    m = 5\n    return text_step([1, 2])\n"
    passes = "def text_step(rows, m):\n    return [r * m for r in rows]\n\n\ndef run_use_case():\n    m = 5\n    return text_step([1, 2], m)\n"
    scope = {}
    exec(reads_local, scope)
    try:
        scope["run_use_case"]()
        raised = None
    except NameError as error:
        raised = str(error)
    assert raised == "name 'm' is not defined", raised
    exec(passes, scope)
    assert scope["run_use_case"]() == [5, 10]
    inst = build_inspire(agent_ns)
    families = set()
    for technique in agent_ns["TECHNIQUE_IMPLEMENTATION_GUIDANCE"]:
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        assert inst._genie_platform_rules(spec).count(rule) == 1, technique
        families.add(spec["family"])
    assert families == set("ABCDEFGH"), families
    assert rule.isascii() and agents.isascii()


ROUND_28_PROBE = r'''
import json, sys
import numpy as np
import pandas as pd

code = json.loads(sys.stdin.read())
x_pdf = pd.DataFrame({"key": ["big"] * 6 + ["small"] * 2, "v": range(8)})
seed, key, n = 7, "key", 3


def outcome(run):
    try:
        run()
        return "ok"
    except (TypeError, ValueError) as error:
        return type(error).__name__


sampled = eval(code["sample"], {"x_pdf": x_pdf, "seed": seed, "key": key, "n": n})
scope = {"pd": pd, "w": pd.DataFrame({"value": [1.5, np.nan], "rank": np.array([1, 2], dtype="int64"),
                                      "top_reasons": [["a"], ["b", "c"]], "flag": ["ok", None]})}
exec(code["replace"], scope)
after = scope["w"].copy()
after["value"] = [None if v is None else float(v) for v in after["value"]]
print(json.dumps({
    "sample_sizes": {k: int(v) for k, v in sampled.groupby("key").size().items()},
    "sample_columns": list(sampled.columns),
    "old_sample": outcome(lambda: x_pdf.groupby(key).sample(n=n, random_state=seed)),
    "records": [{k: [type(v).__name__, v] for k, v in r.items()} for r in scope["w"].to_dict("records")],
    "list_assignment": [str(after["value"].dtype), bool(after["value"].isna().any())],
}))
'''


def test_round_28_samples_writes_and_leakage_checks_name_methods_that_work_on_every_row(agent_ns):
    once, frame = agent_ns["GENIE_COMPUTE_ONCE_RULE"], agent_ns["GENIE_DATE_FRAME_RULE"]
    inst = build_inspire(agent_ns)
    rules = inst._genie_platform_rules(inst._genie_notebook_spec(make_uc()))
    assert "never with `groupby(key).sample(n=...)`, which raises when a group holds fewer than n rows" in once, \
        "round 28: the freight notebook followed the rule's groupby(key).sample(n=...), failed on a small group and had to rerun"
    assert "`groupby(key).sample(n=..., random_state=...)` or `.head(n)`" not in once
    assert ("Make `w = w.astype(object).where(pd.notna(w), None)` the last change to that copy before "
            "`spark.createDataFrame(w.to_dict('records'), schema)`") in rules
    assert "a column assigned after it, such as from a list, turns None back into NaN" in rules, \
        "round 28: a Pareto rebuilt `value` from a list after the replacement and wrote 18 NaN values (round 27: 39 rows)"
    assert "The leakage check tests the dates each step read, never a second computation of its values" in frame, \
        "round 28: an uplift leakage check compared a NULL from its strict join with the feature step's 0 and had to rerun"
    snippets = re.findall(r"`([^`]+)`", once) + re.findall(r"`([^`]+)`", rules)
    code = {"sample": next(s for s in snippets if s.startswith("x_pdf.sample(")),
            "replace": next(s for s in snippets if s.startswith("w = w.astype(object)"))}
    for snippet in code.values():
        ast.parse(snippet)
    done = subprocess.run([sys.executable, "-c", ROUND_28_PROBE], input=json.dumps(code), capture_output=True, text=True, timeout=300)
    assert done.returncode == 0, done.stderr[-3000:]
    probe = json.loads(done.stdout)
    assert probe["old_sample"] == "ValueError", probe
    assert probe["sample_sizes"] == {"big": 3, "small": 2} and probe["sample_columns"] == ["key", "v"], probe
    assert probe["records"] == [{"value": ["float", 1.5], "rank": ["int", 1], "top_reasons": ["list", ["a"]], "flag": ["str", "ok"]},
                                {"value": ["NoneType", None], "rank": ["int", 2], "top_reasons": ["list", ["b", "c"]],
                                 "flag": ["NoneType", None]}], probe
    assert probe["list_assignment"] == ["float64", True], probe
    assert once.isascii() and frame.isascii() and "\u2014" not in once + frame and "\u2013" not in once + frame


def test_round_28_a_unit_is_tested_on_its_own_minimum_and_readiness_counts_what_the_test_step_tests(agent_ns):
    unit = agent_ns["GENIE_PER_UNIT_SAMPLE_RULE"]
    assert ("That minimum is a unit's only gate: a unit is never also left out for the size of a group it belongs to, such as a "
            "cohort or a segment") in unit, \
        "round 28: a network tested a sender only inside a cohort of 30 testable senders, so 0 of 46,353 senders were tested"
    assert ("readiness counts each group and unit with the same rows, filters and minimum as the step that tests it, so a "
            "readiness pass always leaves that step something to test") in unit, \
        "round 28: readiness counted senders with one closed edge while the test needed m closed edges, so it passed with nothing to test"
    inst = build_inspire(agent_ns)
    for technique in ("Network Analysis", "Pareto Analysis", "Cohort Analysis", "Trend Analysis"):
        text = inst._genie_threshold_text(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique})))
        assert ("groups with fewer than 30 rows are left out of the group findings and counted in the summary, while each entity "
                "inside them is still scored and, when the entity has its own test, tested on its own per-unit minimum") in text, technique
        assert "are left out of the findings and counted in the summary; every finding" not in text, technique
    other = inst._genie_threshold_text(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": "Classification"})))
    assert "left out of the group findings" not in other, "the group rule belongs to the comparison family only"
    assert unit.isascii()


def test_round_28_flags_are_never_null_and_reasons_are_distinct_facts_the_row_has(agent_ns):
    _, _, mandate = spec_and_mandate(agent_ns, **{"Analytics Technique": "Pareto Analysis"})
    flag, reasons = meaning(mandate, "data_quality_flag"), meaning(mandate, "top_reasons")
    assert ("never NULL: set it on the final frame, after its last merge and before the rank step, so a row a merge left without "
            "a flag gets the reason its inputs are missing") in flag, \
        "round 28: 18 Pareto items a left merge left without a halo test were written with a NULL flag and NaN value"
    assert "up to 3 plain reasons for the row's value, each a distinct fact about this row with its number" in reasons
    assert ("never a repeated reason or one that restates a count another reason gives, filler text written to reach 3, or a "
            "reason about a value the row lacks") in reasons, \
        "round 28: a lapse notebook padded 11,066 of 27,261 rows with 'limited comparable history' twice and wrote 5 reasons a row"
    assert "which its data_quality_flag names instead" in reasons
    assert flag.isascii() and reasons.isascii()


ROUND_29_PROBE = r"""
import json
import pandas as pd
out = {}
rows = pd.DataFrame({"entity": ["a", "b", "c", "d"], "decision_pass": [False] * 4,
                     "data_quality_flag": ["missing covariate: x", "ok", "too few orders", "ok"], "value": [0.9, 0.5, 0.8, 0.4]})
by_text = rows.sort_values(["decision_pass", "data_quality_flag", "value"], ascending=[False, True, False])
out["text_sort_first"] = by_text["data_quality_flag"].iloc[0]
by_keys = rows.assign(ok=rows["data_quality_flag"].eq("ok")).sort_values(
    ["decision_pass", "ok", "value", "entity"], ascending=[False, False, False, True], kind="mergesort")
out["key_sort"] = by_keys["data_quality_flag"].tolist()
lookup = pd.Series([1.0, 2.0, 3.0], index=["k1", "k1", "k2"])
try:
    pd.Series(["k1", "k2"]).map(lookup)
    out["map_on_repeated_key"] = "ok"
except Exception as e:
    out["map_on_repeated_key"] = type(e).__name__
left = pd.DataFrame({"key": ["k1", "k2"], "v": [1, 2]})
right = pd.DataFrame({"key": ["k1", "k1", "k2"], "w": [1.0, 2.0, 3.0]})
out["merge_rows"] = [len(left), len(left.merge(right, on="key", how="left")),
                     len(left.merge(right.groupby("key", as_index=False)["w"].sum(), on="key", how="left"))]
orders = pd.DataFrame({"entity": ["a", "a", "a"], "date": pd.to_datetime(["2003-01-01", "2003-01-01", "2003-01-05"]),
                       "amount": [1.0, 2.0, 4.0]})
daily = orders.groupby(["entity", "date"], as_index=False)["amount"].sum()
daily["prior_amount"] = daily.groupby("entity")["amount"].cumsum() - daily["amount"]
daily["latest_read"] = daily.groupby("entity")["date"].shift(1)
features = orders.merge(daily[["entity", "date", "prior_amount", "latest_read"]], on=["entity", "date"])
out["date_guard_stops"] = int((features["latest_read"] >= features["date"]).sum())
pairs = orders.merge(orders.rename(columns={"date": "other_date", "amount": "other_amount"}), on="entity")
strict = pairs[pairs["other_date"] < pairs["date"]].groupby(["entity", "date"], as_index=False)["other_amount"].sum()
compared = features.merge(strict, on=["entity", "date"], how="left")
out["recompute_stops"] = int((compared["prior_amount"] != compared["other_amount"]).sum())
out["same_day_leak_stops"] = int((orders.groupby("entity")["date"].shift(1) >= orders["date"]).sum())
print(json.dumps(out))
"""


def test_round_29_leakage_checks_read_dates_and_joins_lookups_and_unit_tests_keep_every_row_where_spark_holds_it(agent_ns):
    frame, closed = agent_ns["GENIE_DATE_FRAME_RULE"], agent_ns["GENIE_CLOSED_WINDOW_RULE"]
    join, once = agent_ns["GENIE_JOIN_RULE"], agent_ns["GENIE_COMPUTE_ONCE_RULE"]
    assert "The leakage check tests the dates each step read, never a second computation of its values" in frame, \
        "round 29: a freight guard compared an approximate median with an exact one and a lapse guard counted same-day orders twice"
    assert "A leakage check that recomputes the features another way" not in frame
    assert ("the check stops on any row whose latest feature date is on or after its anchor date or whose earliest outcome date is "
            "on or before it") in frame
    assert "never by parsing or converting the key" in frame and "the date table is listed under TABLES" in frame, \
        "round 29: a Pareto read the date key 2452642 as YYYYMMDD, failed, and converted it by hand"
    assert ("at most one anchor per entity and date, never only each entity's latest anchor") in closed, \
        "round 29: an uplift trained on each customer's latest anchor and found no positive before the holdout"
    assert "reads them from a side with one row per key" in join and "the step asserts that the frame kept its row count" in join, \
        "round 29: a freight lookup on repeated order numbers raised InvalidIndexError, then a join grew 38,079 rows to 362,652"
    assert "fit, score or test more than 50 independent series or units with groupBy(...).applyInPandas(...)" in once
    assert "never in a loop on the driver over event rows moved there with `toPandas()`" in once, \
        "round 29: a Pareto moved 2,677,771 item-ticket rows to pandas and tested 107,132 units in a driver loop for 16 minutes"
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        rules = inst._genie_platform_rules(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique})))
        assert frame in rules and join in rules and once in rules, technique
    done = subprocess.run([sys.executable, "-c", ROUND_29_PROBE], capture_output=True, text=True, timeout=300)
    assert done.returncode == 0, done.stderr[-3000:]
    probe = json.loads(done.stdout)
    assert probe["map_on_repeated_key"] == "InvalidIndexError", probe
    assert probe["merge_rows"] == [2, 3, 2], probe
    assert probe["recompute_stops"] == 2 and probe["date_guard_stops"] == 0, probe
    assert probe["same_day_leak_stops"] == 1, probe
    assert all(text.isascii() for text in (frame, closed, join, once))


def test_round_29_a_table_that_holds_its_time_as_a_key_lists_its_date_table(agent_ns):
    sales, dated_sales, dates, items = "main.shop.sales", "main.shop.dated_sales", "main.shop.date_dim", "main.shop.item"
    tables = {sales: [("sold_date_sk", "BIGINT", "sale date key"), ("item_sk", "BIGINT", ""), ("amount", "DOUBLE", "")],
              dated_sales: [("sold_date_sk", "BIGINT", ""), ("sold_on", "DATE", "sale day"), ("amount", "DOUBLE", "")],
              dates: [("d_date_sk", "BIGINT", "date key"), ("d_date", "DATE", "calendar day"), ("d_year", "INT", "")],
              items: [("i_item_sk", "BIGINT", ""), ("i_class", "STRING", "item class")]}
    relations = {sales: [("sold_date_sk", dates, "d_date_sk", "inferred"), ("item_sk", items, "i_item_sk", "inferred")],
                 dated_sales: [("sold_date_sk", dates, "d_date_sk", "inferred")]}
    inst = build_inspire(agent_ns, loader=FakeLoader(tables=tables, relations=relations))
    fields = inst._compute_per_uc_genie_fields(make_uc(**{"Tables Involved": sales, "Primary Table": sales}), [], None)
    schema = fields["directly_involved_schema"]
    assert "| d_date | DATE |" in schema and dates in fields["verified_tables"], \
        "round 29: the Pareto's TABLES held only integer date keys, so Genie parsed 2452642 as a date"
    assert f"{sales}.sold_date_sk → {dates}.d_date_sk (inferred)" in fields["foreign_key_relationships"]
    assert "i_class" not in schema and items not in fields["verified_tables"], "a reference table without a date column is not added"
    logged = " ".join(str(call) for call in inst.logger.info.call_args_list)
    assert "[GENIE-DATE-TABLES FIRED]" in logged and dates in logged
    own = inst._compute_per_uc_genie_fields(make_uc(**{"Tables Involved": dated_sales, "Primary Table": dated_sales}), [], None)
    assert "| d_date |" not in own["directly_involved_schema"] and dates not in own["verified_tables"], \
        "a table with its own date column needs no date table"
    listed = inst._compute_per_uc_genie_fields(make_uc(**{"Tables Involved": f"{sales}, {dates}", "Primary Table": sales}), [], None)
    assert listed["verified_tables"].count(dates) == 1
    bare = build_inspire(agent_ns, loader=None)
    assert bare._compute_per_uc_genie_fields(make_uc(**{"Tables Involved": sales, "Primary Table": sales}), [], None)[
        "directly_involved_schema"] == "No schema available"
    assert inst._evidence_linked_tables({sales: {"foreign_keys": [{"ref_table": dates}, {"ref_table": ""}, {"ref_table": sales}]}}) == [dates]


def test_round_29_value_rank_baseline_reasons_and_step_times_describe_each_rows_own_result(agent_ns):
    _, _, mandate = spec_and_mandate(agent_ns, **{"Analytics Technique": "Pareto Analysis"})
    assert "the result for this row's own entity, never a value of the group it belongs to" in meaning(mandate, "value"), \
        "round 29: a Pareto gave every item of a store and class the group's concentration effect, so 594 groups ranked nothing"
    rank, baseline = agent_ns["GENIE_RANK_ORDER_RULE"], agent_ns["GENIE_BASELINE_VALUE_RULE"]
    assert "`data_quality_flag == 'ok'` as a boolean" in rank and "Never sort on the flag text" in rank, \
        "round 29: a lapse notebook sorted on the flag text, so 7,242 rows flagged 'missing covariate' ranked from 1"
    assert "also when the candidate scores another quantity, such as an uplift the baseline does not estimate" in baseline, \
        "round 29: an uplift fallback wrote uplift 0.0 for all 12,608 customers instead of the baseline's scores"
    assert baseline in _model_stop_rule(agent_ns, "Predictive Modeling", "predicted")
    inst = build_inspire(agent_ns)
    families = agent_ns["INSPIRE_MODEL_FAMILIES"]
    seen = set()
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis", "Classification"):
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        rules = inst._genie_platform_rules(spec)
        assert rank in rules, technique
        assert (baseline in rules) is (spec["family"] in families), technique
        seen.add(spec["family"] in families)
    assert seen == {True, False}
    fmt = agent_ns["GENIE_NUMBER_FORMAT_RULE"]
    assert "A fact whose number is missing, which fmt_num writes as 'unknown', is left out of top_reasons" in fmt, \
        "round 29: every Pareto row said 'unknownx class ticket'"
    assert "prints each step's name and elapsed seconds as the step returns" in agent_ns["GENIE_RUN_CONTROLS_RULE"], \
        "round 29: a 16-minute step showed in the returned log only as the run's total"
    assert "prints each step's elapsed seconds" in agent_ns["GENIE_AGENTS_FILE_TEMPLATE"]
    assert all(text.isascii() and "\u2014" not in text for text in (rank, baseline, fmt))


def shop_model():
    return {"main": {
        "shop": {"store_sales": T([("ss_sold_date_sk", "BIGINT", None), ("ss_item_sk", "BIGINT", None),
                                   ("ss_customer_sk", "BIGINT", None), ("ss_net_paid", "DECIMAL(7,2)", None)]),
                 "date_dim": T([("d_date_sk", "BIGINT", None), ("d_date", "DATE", "calendar day"), ("d_year", "INT", None)]),
                 "item": T([("i_item_sk", "BIGINT", None), ("i_category", "STRING", None)]),
                 "customer": T([("c_customer_sk", "BIGINT", None), ("c_birth_year", "INT", None)])},
        "other": {"events": T([("e_item_sk", "BIGINT", None), ("e_ts", "TIMESTAMP", None)])}}}


def scope_loader(agent_ns, monkeypatch, spark, catalogs="", schemas="", tables=""):
    monkeypatch.setattr(agent_ns["SparkSession"].builder, "getOrCreate", staticmethod(lambda: spark))
    logger = CapturingLogger()
    loader = agent_ns["DataLoader"](catalogs=catalogs, schemas=schemas, tables=tables, logger=logger,
                                    enable_two_pass=False, enable_column_sampling=False)
    return loader, logger


def joined(loader, table):
    return sorted((rel[3], rel[6], source) for rel, source, _ in loader.get_table_relations("main", "shop", table))


def schema_listings(spark, schema):
    return [q for q, args in spark.queries
            if "`information_schema`.`tables`" in q and "table_name IN" not in q and args.get("schema") == schema]


def test_round_30_a_generate_run_infers_the_joins_discover_infers_over_the_schema_of_its_scope(agent_ns, monkeypatch):
    spark = SqliteSpark(shop_model())
    loader, logger = scope_loader(agent_ns, monkeypatch, spark, schemas="main.shop")
    assert joined(loader, "store_sales") == []
    assert loader.infer_scope_joins(["main.shop.store_sales"]) >= 3
    assert joined(loader, "store_sales") == [("ss_customer_sk", "customer", "inferred"), ("ss_item_sk", "item", "inferred"),
                                             ("ss_sold_date_sk", "date_dim", "inferred")], \
        "round 30: Route 1 gave all 5 regenerated instructions 'None' for joins, because only Discover inferred them"
    assert logger.matching("[SCOPE-JOINS FIRED] main.shop")
    fks = loader.get_metadata_evidence(["main.shop.store_sales"])["main.shop.store_sales"]["foreign_keys"]
    assert any(fk["column"] == "ss_sold_date_sk" and fk["ref_table"] == "main.shop.date_dim" and fk["ref_column"] == "d_date_sk"
               and fk["source"] == "inferred" for fk in fks)
    queries = len(spark.queries)
    assert loader.infer_scope_joins(["main.shop.item", "main.shop.store_sales"]) == 0 and len(spark.queries) == queries, \
        "a schema is inferred once per run"


def test_round_30_join_inference_stays_inside_the_runs_scope_and_keeps_the_joins_of_a_scan(agent_ns, monkeypatch):
    spark = SqliteSpark(shop_model())
    named, _ = scope_loader(agent_ns, monkeypatch, spark, tables="main.shop.store_sales, main.shop.item")
    named.infer_scope_joins(["main.shop.store_sales"])
    assert joined(named, "store_sales") == [("ss_item_sk", "item", "inferred")], \
        "a run scoped to named tables never joins a table outside them"
    assert schema_listings(spark, "shop") == []
    outside, logger = scope_loader(agent_ns, monkeypatch, spark, schemas="main.shop")
    assert outside.infer_scope_joins(["main.other.events"]) == 0
    assert schema_listings(spark, "other") == [] and joined(outside, "store_sales") == []
    assert logger.matching("[SCOPE-JOINS] main.other: no join inferred from column names over 1 table")
    scanned, _ = scope_loader(agent_ns, monkeypatch, spark, schemas="main.shop")
    scanned.merge_inferred_foreign_keys([("main", "shop", "store_sales", "ss_item_sk", "BIGINT", None),
                                         ("main", "shop", "item", "i_item_sk", "BIGINT", None)])
    queries = len(spark.queries)
    assert scanned.infer_scope_joins(["main.shop.store_sales"]) == 0 and len(spark.queries) == queries, \
        "a schema the Discover scan inferred keeps the scan's joins"
    assert joined(scanned, "store_sales") == [("ss_item_sk", "item", "inferred")]
    whole, _ = scope_loader(agent_ns, monkeypatch, spark, catalogs="main")
    whole.infer_scope_joins(["main.shop.store_sales"])
    assert ("ss_sold_date_sk", "date_dim", "inferred") in joined(whole, "store_sales")
    assert len(schema_listings(spark, "shop")) == 1


def test_round_30_a_regenerated_instruction_lists_the_inferred_joins_and_the_date_table(agent_ns, monkeypatch):
    spark = SqliteSpark(shop_model())
    loader, _ = scope_loader(agent_ns, monkeypatch, spark, schemas="main.shop")
    inst = build_inspire(agent_ns, loader=loader)
    sales = "main.shop.store_sales"
    fields = inst._compute_per_uc_genie_fields(make_uc(**{"Tables Involved": f"{sales}, main.shop.item", "Primary Table": sales}),
                                               [], None)
    assert "main.shop.date_dim" in fields["verified_tables"] and "| d_date | DATE |" in fields["directly_involved_schema"], \
        "round 30: Route 1 regenerated 5 notebooks without their date table, because no join was inferred"
    assert f"{sales}.ss_sold_date_sk → main.shop.date_dim.d_date_sk (inferred)" in fields["foreign_key_relationships"]
    assert "main.shop.customer" not in fields["verified_tables"], "a joined table without a date column is not added"
    logged = " ".join(str(call) for call in inst.logger.info.call_args_list)
    assert "[GENIE-DATE-TABLES FIRED]" in logged


def test_round_30_training_windows_close_before_the_holdout_starts(agent_ns):
    closed, frame = agent_ns["GENIE_CLOSED_WINDOW_RULE"], agent_ns["GENIE_DATE_FRAME_RULE"]
    assert ("The holdout is the most recent closed window, and training takes the anchors of every earlier window whose last "
            "day plus the horizon is before the holdout's first day, so no training label reads an outcome from the holdout's "
            "days") in closed, "round 30: an uplift trained on closed quarters whose outcome horizon ran into the holdout quarter"
    assert "Training takes the anchors of every closed window" not in closed
    assert ("training or reference window whose last day, plus the outcome horizon when its rows carry an outcome, is not before "
            "the first day of the holdout or scored window") in frame
    assert "window that does not end before the holdout or scored window starts" not in frame
    _, _, scoring = spec_and_mandate(agent_ns, **{"Analytics Technique": "Classification"})
    assert ("Run pattern: every run trains on closed outcome windows whose horizon ends before the most recent closed window, "
            "compares the candidates with the baseline on that most recent closed window") in scoring
    assert "Outcome windows: " + closed in scoring
    _, _, anomaly = spec_and_mandate(agent_ns, **{"Analytics Technique": "Anomaly Detection"})
    assert closed not in anomaly, "a detector fitted on a reference window has no outcome horizon"
    inst = build_inspire(agent_ns)
    for technique, outcome_windows in (("Classification", True), ("Survival Analysis", True), ("Cohort Analysis", True),
                                       ("Anomaly Detection", False), ("Forecasting", False)):
        rules = inst._genie_platform_rules(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique})))
        assert (closed in rules) is outcome_windows, technique
        assert frame in rules, technique
    assert closed.isascii() and frame.isascii()


def binomial_two_sided_p(k, n, rate):
    probs = [math.comb(n, i) * rate ** i * (1 - rate) ** (n - i) for i in range(n + 1)]
    return min(1.0, sum(p for p in probs if p <= probs[k] * (1 + 1e-7)))


def test_round_30_a_units_minimum_comes_from_either_extreme_and_an_untested_unit_states_no_test_result(agent_ns):
    unit = agent_ns["GENIE_PER_UNIT_SAMPLE_RULE"]
    assert "the smallest sample at which either of its two extreme outcomes (such as every trial a success, or none)" in unit, \
        "round 30: a network notebook first took the sample at which both extremes reach significance"
    assert "whose most extreme outcome" not in unit
    either = next(n for n in range(1, 500) if any(binomial_two_sided_p(k, n, 0.08) < 0.05 for k in (0, n)))
    both = next(n for n in range(1, 500) if all(binomial_two_sided_p(k, n, 0.08) < 0.05 for k in (0, n)))
    assert (max(either, 5), both) == (5, 42), "at a baseline rate of 8%, requiring both extremes raises the minimum from 5 to 42"
    assert ("with top reasons that give the unit's own count and the minimum ('12 tickets, the test needs 21'), never a test "
            "result such as 'not significant', which only a tested unit has") in unit, \
        "round 30: all 38,280 Pareto items with too few tickets said 'not significant' in their reasons"
    _, _, mandate = spec_and_mandate(agent_ns, **{"Analytics Technique": "Pareto Analysis"})
    assert "a unit below the test's minimum states its count and the minimum, never a test result" in meaning(mandate, "top_reasons")
    assert "Per-unit statistics: " + unit in mandate
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        rules = inst._genie_platform_rules(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique})))
        assert unit in rules, technique
    assert unit.isascii()


def test_round_30_a_ratio_above_one_is_a_multiple_and_a_count_agrees_with_its_noun(agent_ns):
    numbers = agent_ns["GENIE_NUMBER_FORMAT_RULE"]
    assert ("a part-to-whole ratio above 1 is written as a multiple (a ship cost 23.5x the sales price), never as a percent such "
            "as '2.35K%'") in numbers, "round 30: 47 freight reasons read 'Ship cost is 2.35K% of the line's sales price'"
    assert "a share of at most 1 is multiplied by 100 and ends in '%' (23.5% of sales)" in numbers
    assert "and a share is multiplied by 100 and ends in '%' (23.5% of sales)." not in numbers
    assert "A count's noun agrees with it: '1 prior order', '2 prior orders'" in numbers, \
        "round 30: 4,172 uplift rows and 9,302 lapse rows read '1 prior catalog orders'"
    assert len(rule_cases(numbers)) == 9, "the formatter cases still parse"
    _, _, mandate = spec_and_mandate(agent_ns, **{"Analytics Technique": "Anomaly Detection"})
    assert "Numbers in text: " + numbers in mandate
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        rules = inst._genie_platform_rules(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique})))
        assert numbers in rules, technique
    assert numbers.isascii()


def test_round_30_only_a_tested_finding_is_called_not_significant(agent_ns):
    stop = agent_ns["DatabricksInspire"]._GENIE_ACCEPTANCE_STOP["F"]
    assert ("every tested finding is written with its effect size and q-value, and a tested finding that is not significant "
            "keeps the tier its value_at_stake gives and says 'not significant' in its top reasons; an entity below its per-unit "
            "minimum was not tested, so its top reasons give its count and the minimum instead") in stop, \
        "round 30: the group-comparison stop text called every finding 'not significant', and 38,280 untested Pareto items said it"
    assert "every finding is written with its effect size" not in stop
    inst = build_inspire(agent_ns)
    for technique in ("Pareto Analysis", "Cohort Analysis", "Network Analysis"):
        threshold = inst._genie_threshold_text(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique})))
        assert ("every tested finding reports its effect size and its Benjamini-Hochberg q-value, and a tested finding with a q-value "
                "above") in threshold, technique
        assert ("while an entity below its per-unit minimum has no q-value and its top reasons give its count and the minimum"
                in threshold), technique
        assert "every finding reports its effect size" not in threshold, technique
    assert stop.isascii()


def test_round_30_a_reason_is_one_fact_and_a_score_is_given_as_its_rank(agent_ns):
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        _, _, mandate = spec_and_mandate(agent_ns, **{"Analytics Technique": technique})
        reasons = meaning(mandate, "top_reasons")
        assert "each a distinct fact about this row with its number, one fact per reason, never several joined in one" in reasons, \
            f"{technique}: round 30 network rows packed 5 facts into 2 reasons ('1 recipients, PageRank 0.00000646, component of 10 customers')"
        assert ("a score whose scale a reader cannot judge, such as a PageRank or an anomaly score, is given as its rank by that "
                "score alone among every row that has the score, flagged rows among them, whose count is the total the reason "
                "states ('12th of 4,000 senders by influence')") in reasons and "never bare" in reasons, \
            f"{technique}: all 51,644 round 30 network rows gave a bare PageRank such as 0.00000646"
        assert ("never a repeated reason or one that restates a count another reason gives, filler text written to reach 3, or "
                "a reason about a value the row lacks") in reasons
        assert reasons.isascii()


def corrected_minimum(sizes, rate, alpha=0.05):
    for m in range(5, max(sizes) + 2):
        tested = sum(1 for n in sizes if n >= m)
        extreme = min(binomial_two_sided_p(0, m, rate), binomial_two_sided_p(m, m, rate))
        if tested == 0 or extreme <= alpha / tested:
            return m, tested


def test_round_31_a_units_minimum_lets_it_pass_the_correction_on_its_own(agent_ns):
    unit = agent_ns["GENIE_PER_UNIT_SAMPLE_RULE"]
    assert ("reaches, in the same library test, the significance level (`fdr_alpha`, else 0.05) divided by the number of units "
            "with at least that sample, which is the level at which one unit passes the multiple-test correction on its own") in unit, \
        "round 31: 49,803 store items were tested from 6 tickets, and none could pass the correction"
    assert "reaches the significance level (`fdr_alpha`, else 0.05) in the same library test" not in unit
    assert ("every q-value was 1, since one item needed 21 tickets to pass a correction over 49,803 tests on its "
            "own") in unit
    assert binomial_two_sided_p(21, 21, 0.5) <= 0.05 / 49803 < binomial_two_sided_p(20, 20, 0.5)
    sizes = [10] * 40000 + [25] * 9968
    uncorrected = next(m for m in range(5, 30) if binomial_two_sided_p(m, m, 0.5) < 0.05)
    assert uncorrected == 6
    best_at_ten = binomial_two_sided_p(10, 10, 0.5)
    assert best_at_ten > 0.05 / len(sizes), "a perfect 10 of 10 cannot pass the correction over 49,968 tests"
    assert corrected_minimum(sizes, 0.5) == (19, 9968), "only units that could pass on their own are tested"
    assert corrected_minimum([3, 4, 5, 6], 0.5) == (6, 1)
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        rules = inst._genie_platform_rules(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique})))
        assert unit in rules, technique
    assert unit.isascii()


def test_round_31_a_test_run_never_lets_an_earlier_runs_retry_replace_its_rows(agent_ns):
    controls = agent_ns["GENIE_RUN_CONTROLS_RULE"]
    assert ("cancels every run whose task runs this notebook's path, with or without `/Workspace` before it, which covers every "
            "earlier test run") in controls and ("submit each test run with retries off (the task's `max_retries` 0 and "
                                                 "`disable_auto_optimization` true, since serverless otherwise retries a failed "
                                                 "task on its own)") in controls, \
        "round 31: serverless retried a failed lapse test run after the final run, and the retry's 27,314 rows replaced the final run's"
    assert controls.index("cancels every run whose task runs this notebook's path") < controls.index("with retries off")
    assert "cancel every earlier test run of this notebook that has not finished" not in controls
    assert ("After the last run, check that the current rows of this use case that runs wrote (`change_source = 'run' AND "
            "is_current AND change_source <> 'delete'`) carry the run_id its outcome returned") in controls
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        rules = inst._genie_platform_rules(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique})))
        assert controls in rules, technique
    assert controls.isascii()


def rank_breaks(rows):
    ranks = [r["rank"] for r in rows]
    if sorted(ranks) != list(range(1, len(rows) + 1)):
        return "ranks have a gap or a repeat"
    ordered = sorted(rows, key=lambda r: r["rank"])
    for earlier, later in zip(ordered, ordered[1:]):
        if later["passes"] and not earlier["passes"]:
            return f"rank {later['rank']} passes after a row that does not"
        if later["flag"] == "ok" and earlier["flag"] != "ok":
            return f"rank {later['rank']} is ok after a flagged row"
    return None


def test_round_31_the_rank_is_checked_before_the_write(agent_ns):
    rank = agent_ns["GENIE_RANK_ORDER_RULE"]
    assert ("Before the write, check the rank and stop the run on the first row that breaks it: ranks run from 1 to the row count "
            "without a gap or a repeat, every row that passes the decision test ranks before every row that does not, and every "
            "'ok' row before every flagged row") in rank, \
        "round 31: the lapse notebook sorted on the flag text, so its 7,220 flagged rows ranked from 1 and an unflagged row 27,314th"
    rows = [{"flag": f, "passes": False, "impact": i} for f, i in
            (("ok", 0.9), ("missing preferred flag", 0.8), ("no prior order history", 0.7), ("ok", 0.6))]
    by_text = sorted(rows, key=lambda r: (not r["passes"], r["flag"], -r["impact"]))
    by_flag = sorted(rows, key=lambda r: (not r["passes"], r["flag"] != "ok", -r["impact"]))
    assert rank_breaks([dict(r, rank=i) for i, r in enumerate(by_text, 1)]) == "rank 3 is ok after a flagged row"
    assert rank_breaks([dict(r, rank=i) for i, r in enumerate(by_flag, 1)]) is None
    assert rank_breaks([dict(r, rank=i) for i, r in zip((1, 2, 2, 4), by_flag)]) == "ranks have a gap or a repeat"
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        rules = inst._genie_platform_rules(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique})))
        assert rank in rules, technique
    assert rank.isascii()


def test_round_31_counts_and_ranks_are_written_by_inspires_helpers(agent_ns):
    numbers = agent_ns["GENIE_NUMBER_FORMAT_RULE"]
    assert ("so a count and its noun, a number of days, weeks or months among them, are written by `fmt_count(n, noun, "
            "plural=None)`: fmt_num(n), a space and the noun when n is exactly 1, otherwise its plural (the noun plus 's' unless "
            "`plural` is given), never by a template that puts a count before a fixed noun, such as f'{n} tickets', which writes "
            "'1 tickets'") in numbers, \
        "round 31: 20,891 of 51,644 network rows read '1 new recipients', from a template with a fixed plural"
    assert ("A rank is written by `fmt_rank(r)`: the whole number with thousands separators and its ordinal suffix") in numbers, \
        "round 31: network reasons ranked a sender as '1.01Kth of 51.6K senders by influence'"
    assert "never through fmt_num, which writes '1.01Kth', with the total it ranks among written as `f'{total:,}'`" in numbers
    helpers, na = inspire_helpers(), agent_ns["pd"].NA
    assert [helpers.fmt_rank(v) for v in (1, 2, 3, 11, 12, 13, 21, 112, 21302, 1010)] == \
        ["1st", "2nd", "3rd", "11th", "12th", "13th", "21st", "112th", "21,302nd", "1,010th"], "never '1.01Kth'"
    assert [helpers.fmt_count(n, noun) for n, noun in ((1, "prior order"), (2, "prior order"), (0, "day"), (1060, "ticket"),
                                                         (None, "day"), (na, "day"))] == \
        ["1 prior order", "2 prior orders", "0 days", "1.06K tickets", "unknown days", "unknown days"]
    assert helpers.fmt_count(1, "new recipient") == "1 new recipient" and helpers.fmt_count(2, "child", "children") == "2 children"
    assert len(rule_cases(numbers)) == 9, "the fmt_num cases still parse"
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        rules = inst._genie_platform_rules(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique})))
        assert numbers in rules, technique
    assert numbers.isascii()


MISSING_NUMBER_WORD = re.compile(r"\b(unknown|nan|None|inf|NaT)\b|<NA>")


def test_round_31_no_written_text_holds_a_missing_number(agent_ns):
    numbers, missing = agent_ns["GENIE_NUMBER_FORMAT_RULE"], agent_ns["GENIE_MISSING_VALUE_TEXTS"]
    assert ("Before the write, check that no top_reasons, recommended_action or ai_facts text holds the whole word 'unknown' or "
            "'inf', or " + missing + ", and stop the run on the first row that does") in numbers, \
        "round 31: 6,496 lapse rows flagged 'no prior order history' still gave the reason 'unknown prior orders'"
    assert MISSING_NUMBER_WORD.search("unknown prior orders")
    assert not MISSING_NUMBER_WORD.search("finance and infant care spend"), "a whole word, never a part of one"


def test_round_31_a_share_names_its_side_in_its_own_reason_and_the_leakage_check_skips_left_out_windows(agent_ns):
    weight = agent_ns["GENIE_WEIGHT_CHECK_RULE"]
    assert ("say which in that share's own reason ('56.9% of its class's losses', '12.3% of its class's profit'), never as a fact "
            "joined to it") in weight, \
        "round 31: Pareto reasons read '56.9% cumulative profit share in its class, head, ranked on losses'"
    assert "say which in each row's reason" not in weight
    frame = agent_ns["GENIE_DATE_FRAME_RULE"]
    assert ("A window the closed-window choice left out of training is not a training window, so the check never tests "
            "it") in frame, "round 31: the coupon-lift notebook's leakage check stopped on months that training had left out"
    decimals = agent_ns["GENIE_DECIMAL_RULE"]
    assert ("and a date parameter such as as_of_date is one too: convert each side with pd.to_datetime, or pd.Timestamp for a "
            "single date, before comparing it with a Timestamp, a datetime64 column or another date") in decimals, \
        "round 31: 'Invalid comparison between dtype=datetime64[ns] and date' stopped the Pareto notebook's decide()"
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        rules = inst._genie_platform_rules(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique})))
        assert weight in rules and frame in rules and decimals in rules, technique
    assert weight.isascii() and frame.isascii() and decimals.isascii()


def test_round_31_only_a_unit_below_the_minimum_gives_the_count_and_minimum_reason(agent_ns):
    _, _, mandate = spec_and_mandate(agent_ns, **{"Analytics Technique": "Anomaly Detection"})
    reasons = meaning(mandate, "top_reasons")
    assert ("a row the test skipped for another reason, such as a missing input its data_quality_flag names, never states them, so "
            "no row reads '294 peer lines, the median needs 5'") in reasons, \
        "round 31: a shipping order flagged 'missing gmt offset' gave the reason '294 peer lines, the median needs 5'"
    assert "a unit the test did not run on states its count" not in reasons
    unit = agent_ns["GENIE_PER_UNIT_SAMPLE_RULE"]
    assert ("and only a unit below the minimum gives that reason, never a row the test skipped for a missing input, whose "
            "data_quality_flag names its reason instead") in unit
    assert reasons.isascii() and unit.isascii()


ROUND_32_PROBE = r"""
import json
import numpy as np
import pandas as pd
out = {}
lines = pd.DataFrame({"score": [0.6925, 0.7033, 0.6884, 0.6933, 0.7747], "excess": [8770, 8590, 7350, 6190, 5020]})
lines["rank"] = (lines["score"] * lines["excess"]).rank(method="min", ascending=False).astype(int)
lines["score_rank"] = lines["score"].rank(method="min", ascending=False).astype(int)
top = lines.sort_values("rank").iloc[0]
out["top_rank_and_score_rank"] = [int(top["rank"]), int(top["score_rank"])]
best = lines["score"].idxmax()
out["best_score_rank_and_rank"] = [int(lines.loc[best, "score_rank"]), int(lines.loc[best, "rank"])]
out["rank_mismatches"] = int((lines["rank"] != lines["score_rank"]).sum())
counts = pd.Series([3.0, None])
try:
    counts.astype(int)
    out["astype_int_on_missing"] = "ok"
except Exception as e:
    out["astype_int_on_missing"] = type(e).__name__
nullable = pd.to_numeric(counts, errors="coerce").astype("Int64")
out["nullable"] = [str(nullable.dtype), int(nullable.iloc[0]), bool(nullable.isna().iloc[1])]
prior = pd.Series([2.0, None])
try:
    np.where(prior.notna(), prior.map(lambda x: round(x)), "")
    out["np_where_guard"] = "ok"
except Exception as e:
    out["np_where_guard"] = str(e)
def count_text(x):
    if pd.isna(x):
        return "unknown"
    return str(round(x))
out["returns_first"] = prior.map(count_text).tolist()
print(json.dumps(out))
"""


def round_32_probe():
    done = subprocess.run([sys.executable, "-c", ROUND_32_PROBE], capture_output=True, text=True, timeout=300)
    assert done.returncode == 0, done.stderr[-3000:]
    return json.loads(done.stdout)


def test_round_32_a_score_is_ranked_by_itself_never_by_the_rows_rank(agent_ns):
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        _, _, mandate = spec_and_mandate(agent_ns, **{"Analytics Technique": technique})
        reasons = meaning(mandate, "top_reasons")
        assert ("from `rank(method='min')` on the score with 1 for the strongest, never the row's own rank, which also sorts on "
                "the decision test, the flag and the expected impact") in reasons, \
            f"{technique}: round 32 freight rows said 'anomaly score ranks 1st of 2,789 scored lines' from the rank column"
        assert "is given as the row's rank among the scored rows" not in reasons
    probe = round_32_probe()
    assert probe["top_rank_and_score_rank"] == [1, 4], \
        f"among round 32's top 5 freight rows the first of the queue holds the 4th score, not the 1st: {probe}"
    assert probe["best_score_rank_and_rank"] == [1, 5], probe
    assert probe["rank_mismatches"] == 4, probe


def drop_constant_reasons(rows):
    if len(rows) < 2:
        return rows, set()
    everywhere = set(rows[0]).intersection(*rows[1:])
    return [[r for r in row if r not in everywhere] for row in rows], everywhere


def test_round_32_a_reason_the_same_on_every_row_is_dropped_and_printed_once(agent_ns):
    numbers = agent_ns["GENIE_NUMBER_FORMAT_RULE"]
    assert ("A reason with the same text on every row of a run that writes more than one row, such as a rate that is 0% for "
            "every item, says nothing about the row: drop it from every row before the write and print it once in the "
            "log") in numbers, "round 32: every one of the Pareto's 53,999 rows gave the reason 'solo rate 0%'"
    _, _, mandate = spec_and_mandate(agent_ns, **{"Analytics Technique": "Pareto Analysis"})
    assert "and never a reason with the same text on every row, such as a rate that is 0% for every item" in meaning(mandate, "top_reasons")
    rows = [["0.872% of its class's losses", "solo rate 0%"], ["3.36% of its class's losses", "solo rate 0%"],
            ["1.25% of its class's losses", "solo rate 0%", "16 tickets, the test needs 17"]]
    kept, dropped = drop_constant_reasons(rows)
    assert dropped == {"solo rate 0%"} and all("solo rate 0%" not in row for row in kept)
    assert kept[2] == ["1.25% of its class's losses", "16 tickets, the test needs 17"], "a reason on some rows stays"
    assert drop_constant_reasons([["solo rate 0%"]]) == ([["solo rate 0%"]], set()), "a run of one row keeps its reasons"


ZERO_SHARE = re.compile(r"(^|[^0-9.,])0% of [a-z' ]*(losses|loss|profit)\b")


def test_round_32_a_row_of_the_other_sign_states_its_own_amount_never_a_zero_share(agent_ns):
    weight = agent_ns["GENIE_WEIGHT_CHECK_RULE"]
    assert ("and a row of the other sign, which counts as zero, states its own amount against its group's total ('a profit of "
            "1.2K, against its class's loss of 45.6K'), never a 0% share") in weight, \
        "round 32: 3,454 of the Pareto's 53,999 rows read '0% of its class's losses', the zero its loss share counted them as"
    assert ZERO_SHARE.search("0% of its class's losses")
    for text in ("0.872% of its class's losses", "10% of its class's losses", "a profit of 1.2K, against its class's loss of 45.6K",
                 "0% of 5 closed recipients bought on their own within 90 days, against 11.4% for all senders"):
        assert not ZERO_SHARE.search(text), text
    inst = build_inspire(agent_ns)
    rules = inst._genie_platform_rules(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": "Pareto Analysis"})))
    assert weight in rules and weight.isascii()


PACKED_FACTS = re.compile(r"[0-9][^,;]*[,;] (?!against )(?![a-z ]*needs [0-9])[^,;]*[0-9]")


def test_round_32_a_comparison_names_its_reference_and_a_test_result_is_its_own_reason(agent_ns):
    _, _, mandate = spec_and_mandate(agent_ns, **{"Analytics Technique": "Pareto Analysis"})
    reasons = meaning(mandate, "top_reasons")
    assert ("a fact may carry the reference it is compared with after ', against' ('134 days since the last catalog order, against "
            "a typical 162 for its group'), and a test's result is its own reason ('not significant (q-value 0.674)'), never "
            "joined to the value it tested") in reasons, \
        "round 32: 1,255 Pareto rows read '23.5% of its tickets above the class median other-line net paid, q 1; not significant'"
    numbers = agent_ns["GENIE_NUMBER_FORMAT_RULE"]
    assert ("Before the write, also check that no top_reasons entry holds a second number after ', ' or '; ', apart from the "
            "reference after ', against' and a count with its minimum ('16 tickets, the test needs 17'), and stop the run on the "
            "first row that does") in numbers
    for packed in ("23.5% of its tickets above the class median other-line net paid, q 1; not significant",
                   "0 days since the last catalog order, typical reorder gap for this buy-potential group 155 days",
                   "1 recipients, PageRank 0.00000646, component of 10 customers"):
        assert PACKED_FACTS.search(packed), packed
    for one in ("134 days since the last catalog order, against a typical 162 for its group", "16 tickets, the test needs 17",
                "1,096th of 51,644 senders by influence (PageRank)", "excess ship cost of 8.77K over the lane peer median",
                "not significant (q-value 0.674)", "60% of 5 closed recipients bought on their own, against 11.4% for all senders"):
        assert not PACKED_FACTS.search(one), one


def test_round_32_a_count_that_can_be_missing_is_a_nullable_integer(agent_ns):
    decimals = agent_ns["GENIE_DECIMAL_RULE"]
    assert ("hold one that can be missing, such as a count from a left join or from a NULL median, as pandas' nullable integer, "
            "`pd.to_numeric(x, errors='coerce').astype('Int64')`, never with `astype(int)`, which raises IntCastingNaNError on "
            "a missing value") in decimals, "round 32: the Pareto's halo test cast the counts of its NULL class medians with astype(int)"
    assert ("call int() or round() only in a function that returns first on a missing value, as fmt_count does, never behind "
            "np.where, which computes both of its branches on every row") in decimals, \
        "round 31: the coupon-lift notebook guarded round() on its prior-order counts with np.where, which still ran it on the missing ones"
    assert "or as strings when one can be null" not in decimals and "call int() only on a value `pd.notna` passes" not in decimals
    probe = round_32_probe()
    assert probe["astype_int_on_missing"] == "IntCastingNaNError", probe
    assert probe["nullable"] == ["Int64", 3, True], probe
    assert probe["np_where_guard"] == "cannot convert float NaN to integer", probe
    assert probe["returns_first"] == ["2", "unknown"], probe
    numbers = agent_ns["GENIE_NUMBER_FORMAT_RULE"]
    assert "; a missing count gives 'unknown' and the plural, like fmt_num, never an error" in numbers
    counts = agent_ns["pd"].Series([2, None]).astype("Int64")
    assert [inspire_helpers().fmt_count(n, "day") for n in counts] == ["2 days", "unknown days"], \
        "Inspire's fmt_count returns first on a missing value of a nullable column"
    assert decimals.isascii() and numbers.isascii()


def test_round_32_reasons_are_kept_by_inspires_helper(agent_ns):
    numbers = agent_ns["GENIE_NUMBER_FORMAT_RULE"]
    assert ("every row's top_reasons is built by `keep_reasons(facts)`, which takes (text, numbers) pairs in order and returns "
            "the texts none of whose numbers is_missing finds missing, without a repeat and at most 3") in numbers, \
        ("round 29 Pareto reasons read 'unknownx class ticket', round 31 gave 6,496 of 27,314 lapse rows a reason about a missing "
         "value, and in round 32 the pre-write check stopped a Pareto run on a zero-total group's share")
    na, keep = agent_ns["pd"].NA, inspire_helpers().keep_reasons
    facts = [("a", (1,)), ("b", (None,)), ("c", (float("nan"),)), ("a", (1,)), ("g", (na,)), ("d", (2, 3)), ("e", (0,)), ("f", (4,))]
    assert keep(facts) == ["a", "d", "e"], "a missing, NaN or pandas NA number drops its fact, a repeat is kept once, 3 at most"
    assert keep([("x", (float("inf"),)), ("y", (0,))]) == ["y"], "inf is missing and 0 is present"
    assert keep([("carrier UPS", ("UPS",))]) == ["carrier UPS"], "a text is never missing"
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        rules = inst._genie_platform_rules(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique})))
        assert numbers in rules, technique


ROUND_33_PROBE = r"""
import json
import sys
import numpy as np
import pandas as pd
expression = sys.argv[1]
index = json.loads(sys.argv[2])
def ranked(order, index):
    return pd.Series(np.arange(1, len(order) + 1), index=order.index).reindex(index)
def by_boolean(passes, data_quality_flag, impact, key):
    frame = pd.DataFrame({"p": passes.astype(bool), "ok": data_quality_flag.eq("ok"), "i": impact, "k": key})
    return ranked(frame.sort_values(["p", "ok", "i", "k"], ascending=[False, False, False, True], na_position="last"), passes.index)
def by_six_figures(passes, data_quality_flag, impact, key):
    frame = pd.DataFrame({"p": passes.astype(bool), "ok": data_quality_flag.eq("ok"),
                          "i": impact.map(lambda x: float(f"{x:.6g}"), na_action="ignore"), "k": key})
    return ranked(frame.sort_values(["p", "ok", "i", "k"], ascending=[False, False, False, True], na_position="last"), passes.index)
def boolean_ascending(passes, data_quality_flag, impact, key):
    frame = pd.DataFrame({"p": passes, "f": data_quality_flag, "i": impact, "k": key})
    return ranked(frame.sort_values(["p", "f", "i", "k"], ascending=[False, True, False, True],
                                    key=lambda s: s.eq("ok") if s.name == "f" else s), passes.index)
def text_descending(passes, data_quality_flag, impact, key):
    frame = pd.DataFrame({"p": passes, "f": data_quality_flag, "i": impact, "k": key})
    return ranked(frame.sort_values(["p", "f", "i", "k"], ascending=[False, False, False, True]), passes.index)
def text_ascending(passes, data_quality_flag, impact, key):
    frame = pd.DataFrame({"p": passes, "f": data_quality_flag, "i": impact, "k": key})
    return ranked(frame.sort_values(["p", "f", "i", "k"], ascending=[False, True, False, True]), passes.index)
def positional(passes, data_quality_flag, impact, key):
    frame = pd.DataFrame({"pos": np.arange(len(passes)), "p": passes.astype(bool), "ok": data_quality_flag.eq("ok"), "i": impact, "k": key})
    order = frame.sort_values(["p", "ok", "i", "k"], ascending=[False, False, False, True], na_position="last")
    return pd.Series(np.arange(1, len(frame) + 1), index=order["pos"]).sort_index()
out = {}
for name, fn in (("by_boolean", by_boolean), ("by_six_figures", by_six_figures), ("boolean_ascending", boolean_ascending),
                 ("text_descending", text_descending),
                 ("text_ascending", text_ascending), ("positional", positional)):
    result = eval(expression, {"rank_rows": fn, "pd": pd, "i": index})
    out[name] = {str(k): int(v) for k, v in result.items()} if isinstance(result, dict) else [int(r) for r in result]
scores = pd.Series([0.70, None, 0.66])
out["bottom"] = scores.rank(method="min", ascending=False, na_option="bottom").tolist()
out["keep"] = [None if pd.isna(r) else r for r in scores.rank(method="min", ascending=False).tolist()]
out["scored"] = int(scores.notna().sum())
print(json.dumps(out))
"""


def round_33_probe(expression, index=None):
    done = subprocess.run([sys.executable, "-c", ROUND_33_PROBE, expression, json.dumps(index)], capture_output=True, text=True,
                          timeout=300)
    assert done.returncode == 0, done.stderr[-3000:]
    return json.loads(done.stdout)


def test_round_33_ranks_come_from_one_asserted_function(agent_ns):
    rank = agent_ns["GENIE_RANK_ORDER_RULE"]
    assert "Build `rank` with one function you define yourself, `rank_rows(passes, data_quality_flag, impact, key)`" in rank
    assert ("each group by `impact` (the expected impact or value) descending, compared at 6 significant figures, "
            "`impact.map(lambda x: float(f'{x:.6g}'), na_action='ignore')`, so a difference of float rounding never "
            "orders rows, with a missing impact last, then by `key` "
            "(the row key: entity_id, followed by segment_or_item when the method writes several rows for an entity, so tied "
            "rows of one entity keep one order on every run) ascending") in rank
    stated = re.search(r"asserts, before any step ranks rows, that with `i = (\[[0-9, ]+\])`, `(rank_rows\(.+?\)\.to_dict\(\))` is "
                       r"(\{[0-9:, ]+\})", rank)
    assert stated, "the rule states the asserted call, its index and its result"
    index, expected = ast.literal_eval(stated.group(1)), ast.literal_eval(stated.group(3))
    probe = round_33_probe(stated.group(2), index)
    ranks = {name: {int(k): v for k, v in found.items()} for name, found in probe.items() if isinstance(found, dict)}
    assert index == [5, 3, 9, 0, 7, 1] and expected == {5: 3, 3: 1, 9: 5, 0: 6, 7: 2, 1: 4}, stated.groups()
    assert ranks["by_boolean"] == expected and [expected[k] for k in index] == [3, 1, 5, 6, 2, 4], probe
    assert ranks["boolean_ascending"] != expected, \
        "round 33: the coupon-uplift notebook sorted its 'ok' boolean ascending, so its 129 flagged rows ranked 1 to 129"
    assert ranks["text_descending"] != expected, \
        "round 33: the gift-sender notebook sorted the flag text descending, so 51,589 senders below the test minimum ranked before the 55 it tested"
    assert ranks["text_ascending"] != expected, "rounds 29 and 31: lapse notebooks sorted the flag text ascending"
    assert ranks["positional"] != expected and sorted(ranks["positional"].values()) == [1, 2, 3, 4, 5, 6], \
        ("round 34: the lapse and Pareto notebooks returned their ranks on positions 0 to n-1, so `frame['rank'] = rank_rows(...)` "
         "on a frame with any other index lines the ranks up by label")
    assert ("takes four pandas Series on one index and returns the ranks 1 to n as a Series on that index, so `frame['rank'] = "
            "rank_rows(...)` lines up on any index, such as one a filter or a concat left") in rank
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        rules = inst._genie_platform_rules(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique})))
        assert rank in rules, technique
    assert rank.isascii()


def test_round_33_a_row_without_a_score_states_no_score_rank(agent_ns):
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        _, _, mandate = spec_and_mandate(agent_ns, **{"Analytics Technique": technique})
        reasons = meaning(mandate, "top_reasons")
        assert ("a row without a score has no such rank: keep the default `na_option='keep'`, never 'bottom' or 'top', which "
                "give every unscored row a rank past the last scored one ('2,790th of 2,789'), so keep_reasons leaves the fact "
                "out, and the step asserts that no score rank exceeds the total its reason states") in reasons, \
            f"{technique}: all 138 unscored lines of the round 33 freight notebook read '2,790th of 2,789 scored lines by anomaly score'"
    probe = round_33_probe("[]")
    assert probe["bottom"] == [1.0, 3.0, 2.0] and probe["scored"] == 2, probe
    assert probe["keep"] == [1.0, None, 2.0], probe
    assert max(probe["bottom"]) > probe["scored"] >= max(r for r in probe["keep"] if r is not None)


def test_round_33_a_closed_window_with_no_event_is_a_negative(agent_ns):
    closed = agent_ns["GENIE_CLOSED_WINDOW_RULE"]
    assert ("A closed window with no event is a negative, 0: over a frame that holds no rows, `F.sum`, `F.max`, `F.min` and "
            "`F.avg` return NULL while `F.count` returns 0, so an outcome is `F.coalesce(F.sum(x).over(w), F.lit(0)) > 0` or "
            "`F.count(x).over(w) > 0`, and a NULL outcome marks only a censored unit") in closed, \
        "round 33: the coupon-uplift instruction labeled reorders with F.sum(...).over(w) > 0, which is NULL over a closed window with no order"
    inst = build_inspire(agent_ns)
    seen = set()
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis", "Classification"):
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        outcome = spec["family"] in agent_ns["GENIE_OUTCOME_WINDOW_FAMILIES"]
        assert (closed in inst._genie_platform_rules(spec)) is outcome, technique
        assert (("Outcome windows: " + closed) in inst._build_code_structure_mandate(spec)) is outcome, technique
        seen.add(outcome)
    assert seen == {True, False} and closed.isascii()


def test_round_33_the_leakage_check_tests_the_rows_that_read_a_fit_statistic(agent_ns):
    frame = agent_ns["GENIE_DATE_FRAME_RULE"]
    assert ("A statistic the fit computes over its own window, such as a peer median, a MAD or an alert threshold, is tested "
            "on the holdout and scored rows that read it, never on the fit rows it was computed from") in frame, \
        "round 33: the freight notebook's first leakage guard tested its fit lines against the peer medians computed from them"
    assert "a window's first and last day are the first and last dates its rows hold, never a bound the window excludes" in frame, \
        "round 33: the same guard compared a bound its window excludes, and it passed on the same data once it compared the dates the rows hold"
    inst = build_inspire(agent_ns)
    spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": "Anomaly Detection"}))
    assert frame in inst._genie_platform_rules(spec) and ("Date windows: " + frame) in inst._build_code_structure_mandate(spec)
    assert frame.isascii()


def topk_agreement(first, second, max_alerts):
    k = min(max_alerts, len(first), len(second))
    return len(set(first[:k]) & set(second[:k])) / k if k else None


def test_round_33_alert_agreement_is_a_share_of_the_top_k(agent_ns):
    template = agent_ns["DatabricksInspire"]._GENIE_ACCEPTANCE_TEXT["B"]
    assert ("the share of the first fit's top k alerts that are also among the second fit's top k, with k the smallest of "
            "{max_alerts_per_run} and the two fits' alert counts, so the agreement lies between 0 and 1") in template, \
        "round 33: the freight notebook's first stability check counted every alert the two fits shared over k and found an agreement above 1"
    first, second = list(range(30)), list(range(5, 35))
    assert len(set(first) & set(second)) / min(20, len(first), len(second)) == 1.25, "every shared alert over k exceeds 1"
    assert topk_agreement(first, second, 20) == 0.75 and topk_agreement([], second, 20) is None
    inst = build_inspire(agent_ns)
    spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": "Anomaly Detection"}))
    assert spec["family"] == "B"
    text = inst._genie_threshold_text(spec)
    assert "so the agreement lies between 0 and 1" in text and "{" not in text and template.isascii()


def assert_in_every_notebook(agent_ns, rule, mandate_label=None):
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        assert rule in inst._genie_platform_rules(spec), technique
        if mandate_label:
            assert mandate_label + rule in inst._build_code_structure_mandate(spec), technique
    assert rule.isascii()


def test_round_34_the_holdout_and_the_scored_rows_are_never_checked_against_each_other(agent_ns):
    frame = agent_ns["GENIE_DATE_FRAME_RULE"]
    assert ("The holdout and the scored rows are never checked against each other: a scored row has no outcome, so its "
            "features may read the days of the holdout's outcome horizon, which are the present it is scored on, and the "
            "scoring population is never cut to pass a leakage check") in frame, \
        ("round 34: the coupon-uplift instruction checked the holdout's last date plus the horizon against the first scoring "
         "date, the first run stopped on 'Leakage check failed: holdout horizon reaches scoring.', and Genie Code cut the "
         "scored customers from 12,608 to 721 to pass it")
    assert ("training or reference window whose last day, plus the outcome horizon when its rows carry an outcome, is not "
            "before the first day of the holdout or scored window") in frame
    horizon, as_of, holdout_last = 30, 420, 380
    assert holdout_last + horizon < as_of, "the holdout window is closed"
    scored = list(range(as_of - horizon, as_of))
    kept = [anchor for anchor in scored if anchor > holdout_last + horizon]
    assert len(scored) == 30 and len(kept) == 9, \
        "checking the holdout against the scored rows drops the 21 open anchors that fall inside the holdout's horizon"
    assert_in_every_notebook(agent_ns, frame, "Date windows: ")


class SparkColumn:
    def __init__(self, name):
        self.name = name

    def __and__(self, other):
        return SparkColumn(f"({self.name} AND {other.name})")

    def __or__(self, other):
        return SparkColumn(f"({self.name} OR {other.name})")

    def __bool__(self):
        raise ValueError("[CANNOT_CONVERT_COLUMN_INTO_BOOL] Cannot convert column into bool")


ROUND_34_PROBE = r"""
import json
import numpy as np
class SparkColumn:
    def __bool__(self):
        raise ValueError("[CANNOT_CONVERT_COLUMN_INTO_BOOL] Cannot convert column into bool")
try:
    np.logical_and.reduce([SparkColumn(), SparkColumn(), SparkColumn()])
    print(json.dumps("no error"))
except ValueError as error:
    print(json.dumps(str(error)))
"""


def test_round_34_a_list_of_spark_conditions_is_combined_with_reduce(agent_ns):
    nesting = agent_ns["GENIE_SQL_NESTING_RULE"]
    assert ("Combine a list of conditions with `functools.reduce(operator.and_, conditions)` or `operator.or_`, never with "
            "Python's `and`, `or`, `all()` or `any()` or NumPy's `logical_and`, which call `bool()` on a Column and raise "
            "CANNOT_CONVERT_COLUMN_INTO_BOOL") in nesting, \
        ("round 34: the lapse notebook filtered on np.logical_and.reduce([F.col(c).isNotNull() for c in covars]), and its "
         "first run raised CANNOT_CONVERT_COLUMN_INTO_BOOL")
    conditions = [SparkColumn("a"), SparkColumn("b"), SparkColumn("c")]
    assert functools.reduce(operator.and_, conditions).name == "((a AND b) AND c)"
    assert functools.reduce(operator.or_, conditions).name == "((a OR b) OR c)"
    for combine in (all, any, lambda found: found[0] and found[1], lambda found: found[0] or found[1]):
        with pytest.raises(ValueError, match="CANNOT_CONVERT_COLUMN_INTO_BOOL"):
            combine(conditions)
    done = subprocess.run([sys.executable, "-c", ROUND_34_PROBE], capture_output=True, text=True, timeout=300)
    assert done.returncode == 0 and "CANNOT_CONVERT_COLUMN_INTO_BOOL" in json.loads(done.stdout), done.stderr[-2000:]
    assert_in_every_notebook(agent_ns, nesting)


def test_round_34_a_key_that_can_be_null_joins_null_safe(agent_ns):
    join = agent_ns["GENIE_JOIN_RULE"]
    assert ("A key that can be NULL, such as a class or a segment whose rows stay flagged as missing, joins on a null-safe "
            "condition, `a_sdf['key'].eqNullSafe(b_sdf['key'])` (<=> in SQL), and drops the other side's key, because a "
            "grouping keeps NULL as one group while an equality condition and a join on key names never match it, so the rows "
            "with a NULL key would lose every column the join adds") in join, \
        ("round 34: the Pareto notebook kept its items without a class, joined their class figures on the class with ==, and "
         "its first run failed its own assert (entity_pdf['profit_rank']<=entity_pdf['group_items']).all()")
    db = sqlite3.connect(":memory:")
    db.executescript("CREATE TABLE items (item TEXT, class TEXT); "
                     "INSERT INTO items VALUES ('a', 'x'), ('b', NULL), ('c', NULL); "
                     "CREATE TABLE classes AS SELECT class, COUNT(*) AS group_items FROM items GROUP BY class;")
    assert sorted(db.execute("SELECT class, group_items FROM classes").fetchall(), key=repr) == [("x", 1), (None, 2)], \
        "the grouping keeps the NULL class as one group"
    plain = db.execute("SELECT i.item, c.group_items FROM items i LEFT JOIN classes c ON i.class = c.class "
                       "ORDER BY i.item").fetchall()
    safe = db.execute("SELECT i.item, c.group_items FROM items i LEFT JOIN classes c ON i.class IS c.class "
                      "ORDER BY i.item").fetchall()
    assert plain == [("a", 1), ("b", None), ("c", None)], "an equality join never matches the NULL group"
    assert safe == [("a", 1), ("b", 2), ("c", 2)], "SQLite's IS is the null-safe equality that Spark writes as <=>"
    for code in re.findall(r"`([^`]+)`", join):
        ast.parse(code)
    assert_in_every_notebook(agent_ns, join)


def test_round_34_the_count_a_minimum_is_compared_with_is_the_sample_its_test_computes_on(agent_ns):
    unit = agent_ns["GENIE_PER_UNIT_SAMPLE_RULE"]
    assert ("Whether the minimum comes from the test or from a readiness threshold such as `min_group_rows`, the count "
            "compared with it, in readiness, in the test and in a reason, is the sample the test computes on, after the test "
            "drops what it drops (such as the ties of a sign test, or the recipients whose outcome window has not closed), "
            "never another count of the unit or group (such as its tickets or its senders)") in unit, \
        ("round 34: 141 of the Pareto notebook's 53,999 rows read '17 tickets, the test needs 17', because its sign test "
         "dropped the tickets tied with the class median while readiness and the reason counted every ticket")
    assert ("and a test that compares two samples, such as a group against its prior period, checks each of them, so no unit "
            "or group that passes meets its test with fewer observations, or none") in unit, \
        ("round 34: the gift-sender notebook let a quarter into its prior-year comparison by its senders, and the first run "
         "raised ZeroDivisionError on a quarter with 0 closed recipients")
    median = 7
    other_lines = [5, 7, 9, 3, 7, 11, 2, 8, 6, 12, 4, 7, 13, 1, 10, 9, 8]
    tested = [value for value in other_lines if value != median]
    assert len(other_lines) == 17 and len(tested) == 14, "a sign test drops the ties, so 17 tickets give it 14 observations"
    quarter = {"senders": 40, "closed_recipients": 0, "converted": 0}
    assert quarter["senders"] >= 30 and quarter["closed_recipients"] < 30
    with pytest.raises(ZeroDivisionError):
        quarter["converted"] / quarter["closed_recipients"]
    assert ("with top reasons that give the unit's own count and the minimum ('12 tickets, the test needs 21')") in unit
    assert_in_every_notebook(agent_ns, unit, "Per-unit statistics: ")


def window_text(days_left):
    fmt_count = inspire_helpers().fmt_count
    if days_left < 0:
        return f"the window opened {fmt_count(-days_left, 'day')} ago"
    return f"the window opens in {fmt_count(days_left, 'day')}"


def test_round_34_a_count_is_never_negative(agent_ns):
    numbers = agent_ns["GENIE_NUMBER_FORMAT_RULE"]
    assert ("A count is never negative, so fmt_count raises a ValueError on one: a difference that can fall on either side of "
            "zero, such as the days left before a window opens, takes its words from its sign and passes fmt_count its absolute "
            "value ('the window opens in 13 days', 'the window opened 13 days ago')") in numbers, \
        ("round 34: 1,418 of the lapse notebook's 27,298 rows read 'lapse window opens in -N days', such as 'opens in -13 days' "
         "for a customer 100 days after an order against a mean gap of 87 days")
    assert "; a missing count gives 'unknown' and the plural, like fmt_num, never an error" in numbers
    fmt_count = inspire_helpers().fmt_count
    for negative in (-1, -0.5):
        with pytest.raises(ValueError, match="negative count"):
            fmt_count(negative, "day")
    assert fmt_count(None, "day") == "unknown days" and fmt_count(1, "day") == "1 day"
    assert window_text(87 - 100) == "the window opened 13 days ago" and window_text(13) == "the window opens in 13 days"
    assert window_text(-1) == "the window opened 1 day ago" and window_text(0) == "the window opens in 0 days"
    assert_in_every_notebook(agent_ns, numbers, "Numbers in text: ")


def genie_fmt_rank(r):
    n = int(r)
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n:,}{suffix}"


def test_round_35_a_missing_rank_reads_unknown_because_every_text_is_built_before_keep_reasons_reads_it(agent_ns):
    numbers = agent_ns["GENIE_NUMBER_FORMAT_RULE"]
    assert ("with the total it ranks among written as `f'{total:,}'`, and a missing rank gives 'unknown', like fmt_num, never "
            "an error") in numbers, \
        ("round 35: the freight notebook passed keep_reasons facts whose f-strings called fmt_rank, and its first run raised "
         "'ValueError: cannot convert float NaN to integer' in fmt_rank on a line without a rank")
    assert ("while a rank that is not a whole number of at least 1 raises a ValueError, so ties are ranked with `method='min'` "
            "or `method='first'`, never as the average of their ranks") in numbers
    assert ("Each text is built before keep_reasons reads its numbers, so every function a fact's text calls, such as fmt_num, "
            "fmt_count and fmt_rank, returns a text for a missing number and never raises on one") in numbers
    rank, helpers = float("nan"), inspire_helpers()
    with pytest.raises(ValueError, match="cannot convert float NaN to integer"):
        helpers.keep_reasons([(f"rank {genie_fmt_rank(rank)} of 2,939", (rank,))])
    assert helpers.fmt_rank(None) == helpers.fmt_rank(rank) == helpers.fmt_rank(agent_ns["pd"].NA) == "unknown"
    facts = [(f"rank {helpers.fmt_rank(r)} of 2,939", (r,)) for r in (3, rank, 2939)]
    assert helpers.keep_reasons(facts) == ["rank 3rd of 2,939", "rank 2,939th of 2,939"]
    for tied in (2.5, 0, -3):
        with pytest.raises(ValueError, match="method='min' or method='first'"):
            helpers.fmt_rank(tied)
    assert helpers.fmt_rank(agent_ns["pd"].Series([5.0, 3.0, 3.0]).rank(method="min")[1]) == "1st"
    assert_in_every_notebook(agent_ns, numbers, "Numbers in text: ")


NEGATIVE_NUMBER = re.compile(r"(?<![A-Za-z0-9.])-[0-9]")


def freight_text(excess):
    if excess < 0:
        return f"freight {-excess:,} below the lane peer median"
    return f"excess freight of {excess:,} over the lane peer median"


def test_round_35_a_signed_amount_takes_its_words_from_its_sign_and_no_text_holds_a_negative_number(agent_ns):
    numbers = agent_ns["GENIE_NUMBER_FORMAT_RULE"]
    assert ("An amount that can fall on either side of its reference, such as a cost's excess over its peer median, takes its "
            "words from its sign the same way and writes fmt_num of its absolute value") in numbers, \
        ("round 35: 1,427 of the freight notebook's 2,939 rows gave a reason such as 'excess freight of -766 over the lane "
         "peer median' for a line whose freight was below its peer median")
    assert ("check that no top_reasons or recommended_action text holds a minus sign before a digit that follows no letter, "
            "digit or point") in numbers
    examples = re.findall(r"'((?:excess )?freight [^']*median)'", numbers)
    assert len(examples) == 3
    assert [text for text in examples if NEGATIVE_NUMBER.search(text)] == ["excess freight of -216 over the lane peer median"]
    for text in ("excess freight of -766 over the lane peer median", "a change of -0.5", "a gap of (-216)", "-3 days"):
        assert NEGATIVE_NUMBER.search(text), text
    for text in ("lane TN-KY", "as of 2003-01-08", "a q-value of 0.03", "use case N03-U06", "a 12-pack", "2002Q1-2002Q2"):
        assert not NEGATIVE_NUMBER.search(text), text
    assert freight_text(-766) == "freight 766 below the lane peer median"
    assert freight_text(9600) == "excess freight of 9,600 over the lane peer median"
    assert not NEGATIVE_NUMBER.search(freight_text(-766))
    assert_in_every_notebook(agent_ns, numbers, "Numbers in text: ")


def empty_part(text, separator="|"):
    return separator in text and any(not part.strip() for part in text.split(separator))


def order_line_label(order, item, carrier):
    return " ".join([f"Order {order} line item {item}"] + ([f"({carrier})"] if carrier else []))


def test_round_35_a_label_or_segment_leaves_out_a_part_that_is_missing(agent_ns):
    _, _, mandate = spec_and_mandate(agent_ns, **{"Analytics Technique": "Anomaly Detection"})
    assert ("and a part that is missing on a row, such as the carrier of an order line without a ship mode, is left out of "
            "that row's label, never written as None") in meaning(mandate, "entity_label"), \
        ("round 35: the freight instruction built entity_label as f\"Order {cs_order_number} line item {cs_item_sk} "
         "({sm_carrier})\", and 9 of its 2,939 rows read 'Order 159907 line item 16609 (None)'")
    assert ("a part that is missing on a row left out together with its separator, never kept as an empty part such as "
            "' |  | '") in meaning(mandate, "segment_or_item"), \
        ("round 35: 11 of the freight notebook's 2,939 segments kept empty parts, such as ' |  | MN', and 173 of the Pareto "
         "notebook's 53,273 read like 'able / ' for an item without a class")
    numbers, missing = agent_ns["GENIE_NUMBER_FORMAT_RULE"], agent_ns["GENIE_MISSING_VALUE_TEXTS"]
    assert ("Check entity_id, entity_label and segment_or_item for " + missing + ", never for a value the data itself names, "
            "such as an 'Unknown' category, and for an empty part, such as two separators with "
            "nothing between them (' |  | ') or a separator at either end") in numbers
    label_words = re.compile(r"\b(None|nan|NaT)\b|<NA>")
    assert label_words.search("Order 159907 line item 16609 (None)") and label_words.search("Store 12 (nan)")
    for text in ("credit rating Unknown", "Unknown | 4-yr Degree", "Nancy's Bakery", "Infant care"):
        assert not label_words.search(text), text
    assert MISSING_NUMBER_WORD.search("Order 159907 line item 16609 (None)")
    assert order_line_label(159907, 16609, None) == "Order 159907 line item 16609"
    assert order_line_label(159753, 14292, "AIRBORNE") == "Order 159753 line item 14292 (AIRBORNE)"
    for text in (" |  | ", " |  | MN", "OVERNIGHT | AIRBORNE | ", "| TN"):
        assert empty_part(text), text
    for text in ("OVERNIGHT | AIRBORNE | TN-KY", "TN-KY", "", "Order 159753 line item 14292 (AIRBORNE)"):
        assert not empty_part(text), text
    assert empty_part("able / ", "/") and not empty_part("able / Books", "/") and not empty_part("2002Q1", "/")
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        mandate = inst._build_code_structure_mandate(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique})))
        assert "never written as None" in meaning(mandate, "entity_label"), technique
        assert "never kept as an empty part" in meaning(mandate, "segment_or_item"), technique
    assert_in_every_notebook(agent_ns, numbers, "Numbers in text: ")


def when_condition(code):
    call = next(node for node in ast.walk(ast.parse(code))
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "when")
    condition = call.args[0]
    return "text" if isinstance(condition, ast.Constant) and isinstance(condition.value, str) else "column"


def test_round_35_the_condition_of_when_is_a_column(agent_ns):
    nesting = agent_ns["GENIE_SQL_NESTING_RULE"]
    assert ("The condition of `F.when` is a Column, `F.when(F.col('closed'), value)`, never a column name such as "
            "`F.when('closed', value)`, which raises NOT_COLUMN; a condition written as SQL text goes through "
            "`F.expr('days > 0')`") in nesting, \
        ("round 35: the gift-sender notebook wrote F.when('closed', F.col('converted_raw').cast('int')), and its first run "
         "raised '[NOT_COLUMN] Argument `condition` should be a Column, got str.'")
    failed = "joined_sdf.withColumn('converted', F.when('closed', F.col('converted_raw').cast('int')))"
    repaired = "joined_sdf.withColumn('converted', F.when(F.col('closed'), F.col('converted_raw').cast('int')))"
    assert when_condition(failed) == "text" and when_condition(repaired) == "column"
    snippets = [code for code in re.findall(r"`([^`]+)`", nesting) if code.startswith("F.when(")]
    assert [when_condition(code) for code in snippets] == ["column", "text"]
    assert when_condition("F.when(F.expr('days > 0'), value)") == "column"
    for code in re.findall(r"`([^`]+)`", nesting):
        if code.startswith("F."):
            ast.parse(code)
    assert_in_every_notebook(agent_ns, nesting)


def test_round_35_a_join_reads_a_match_flag_the_other_side_adds_never_the_dropped_key(agent_ns):
    join = agent_ns["GENIE_JOIN_RULE"]
    assert ("A step that needs to know which rows found a match, such as a join's coverage or a missing-input flag, reads a "
            "flag the other side adds before the join, `b_sdf.withColumn('b_matched', F.lit(True))`, which is NULL on the "
            "rows without a match, never the other side's key, which is gone once it is dropped and is NULL on a row that a "
            "null-safe join matched on a NULL key") in join, \
        ("round 35: the coupon-uplift notebook joined customer_demographics on an explicit condition and dropped cd_demo_sk, "
         "its readiness counts then read cd_demo_sk, and its first run raised UNRESOLVED_COLUMN")
    db = sqlite3.connect(":memory:")
    db.executescript("CREATE TABLE lines (line TEXT, mode TEXT); "
                     "INSERT INTO lines VALUES ('a', 'air'), ('b', NULL), ('c', 'sea'); "
                     "CREATE TABLE modes (mode TEXT, carrier TEXT); "
                     "INSERT INTO modes VALUES ('air', 'AIRBORNE'), (NULL, 'UNASSIGNED');")
    rows = db.execute("SELECT l.line, m.mode IS NOT NULL, m.matched IS NOT NULL, m.carrier FROM lines l "
                      "LEFT JOIN (SELECT mode, carrier, 1 AS matched FROM modes) m ON l.mode IS m.mode "
                      "ORDER BY l.line").fetchall()
    assert rows == [("a", 1, 1, "AIRBORNE"), ("b", 0, 1, "UNASSIGNED"), ("c", 0, 0, None)], \
        "after a null-safe join the key calls the matched NULL-key line unmatched, while the flag tells it from the line with no match"
    for code in re.findall(r"`([^`]+)`", join):
        ast.parse(code)
    assert_in_every_notebook(agent_ns, join)


def test_round_35_a_baseline_that_estimates_the_use_case_quantity_writes_that_estimate(agent_ns):
    baseline = agent_ns["GENIE_BASELINE_VALUE_RULE"]
    assert ("a baseline that does estimate the candidate's quantity writes that estimate as `value`, such as a baseline given "
            "the treatment as a feature, whose prediction with the treatment set to 1 minus its prediction with the treatment "
            "set to 0 is its uplift, so the rank, the reasons and the decision test read the quantity the use case decides "
            "on") in baseline, \
        ("round 35: the coupon-uplift instruction wrote the baseline's reorder probability as value while its decision test "
         "read the baseline's prediction with the coupon set to 1 minus set to 0, so its 12,591 baseline rows ranked "
         "customers on a reorder probability of 0.42 to 0.55 in a use case that ranks them on lift")
    assert "also when the candidate scores another quantity, such as an uplift the baseline does not estimate" in baseline
    assert baseline in _model_stop_rule(agent_ns, "Predictive Modeling", "predicted")

    def predict(customer, coupon):
        return customer["base"] + coupon * customer["lift"]

    customers = [{"id": "sure thing", "base": 0.9, "lift": 0.0}, {"id": "persuadable", "base": 0.3, "lift": 0.2}]
    uplift = {c["id"]: predict(c, 1) - predict(c, 0) for c in customers}
    by_probability = [c["id"] for c in sorted(customers, key=lambda c: -predict(c, 1))]
    by_uplift = sorted(uplift, key=lambda name: -uplift[name])
    passing = [name for name in by_uplift if uplift[name] >= 0.05]
    assert by_probability[0] == "sure thing" and passing == ["persuadable"], \
        "ranked on the reorder probability, the row the uplift test rejects comes first"
    assert by_uplift[0] == passing[0]
    inst = build_inspire(agent_ns)
    families = agent_ns["INSPIRE_MODEL_FAMILIES"]
    for technique in TECHNIQUES + ("Classification",):
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        assert (baseline in inst._genie_platform_rules(spec)) is (spec["family"] in families), technique
    assert baseline.isascii()


ROUND_35_PROBE = r"""
import json
import pandas as pd
frame = pd.DataFrame({"tail": [True, False], "is_tail": [True, False]})
out = {"method": callable(frame.tail), "column": frame["tail"].tolist(), "renamed": frame.is_tail.tolist()}
try:
    frame.tail.astype(bool)
    out["error"] = "no error"
except AttributeError as error:
    out["error"] = str(error)
names = json.loads(__import__("sys").argv[1])
out["frame_attributes"] = {name: hasattr(pd.DataFrame, name) for name in names}
print(json.dumps(out))
"""


def test_round_35_a_column_a_step_adds_is_never_named_after_a_frame_method(agent_ns):
    naming = agent_ns["GENIE_COLUMN_NAMING_RULE"]
    assert ("Name every column a step adds after what it holds, never after a pandas or Spark DataFrame method or property "
            "such as `tail`, `head`, `count`, `size`, `mean`, `sum`, `values` or `index`: read as an attribute (`x_pdf.tail`), "
            "such a name returns the method instead of the column, so write `is_tail`, not `tail`. The business output columns "
            "keep their names") in naming, \
        ("round 35: the Pareto instruction defined 'tail = cum_profit_share > tail_cum_share', the notebook read out.tail, "
         "and its first run raised \"AttributeError: 'function' object has no attribute 'astype'\"")
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        mandate = inst._build_code_structure_mandate(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique})))
        assert "Column names: " + naming in mandate, technique
    assert naming.isascii()
    names = [code for code in re.findall(r"`([^`]+)`", naming) if code.isidentifier()]
    assert names == ["tail", "head", "count", "size", "mean", "sum", "values", "index", "is_tail", "tail"]
    done = subprocess.run([sys.executable, "-c", ROUND_35_PROBE, json.dumps(sorted(set(names)))], capture_output=True,
                          text=True, timeout=300)
    assert done.returncode == 0, done.stderr[-3000:]
    out = json.loads(done.stdout)
    assert out["method"] is True and out["column"] == [True, False] and out["renamed"] == [True, False]
    assert "has no attribute 'astype'" in out["error"]
    assert {name for name, found in out["frame_attributes"].items() if not found} == {"is_tail"}
    assert "Read and assign pandas columns as `x_pdf['name']`, never `x_pdf.name`" in agent_ns["GENIE_FRAME_NAMES_RULE"]


ROUND_36_ACTION = ("Review before the next cycle: check the BOXBUNDLES charge on Order 159973 item 6792 via BOXBUNDLES NEXT DAY, "
                   "lane TN-WV, excess freight of 7.35K")
ROUND_36_SECOND_NUMBER = re.compile(r"(?:, |; )(?!against|the test needs).*\d")


def test_round_36_the_second_number_check_reads_each_reason_never_the_action(agent_ns):
    numbers = agent_ns["GENIE_NUMBER_FORMAT_RULE"]
    assert ("Before the write, also check that no top_reasons entry holds a second number after ', ' or '; ', apart from the "
            "reference after ', against' and a count with its minimum ('16 tickets, the test needs 17'), and stop the run on the "
            "first row that does; this check never reads recommended_action, whose next step names the record and its amount "
            "together") in numbers, \
        ("round 36: the freight notebook ran its second-number check over recommended_action too, and its first run stopped "
         "on its own action '" + ROUND_36_ACTION + "'")
    assert "no reason holds a second number" not in numbers
    reasons = ["excess freight of 7.35K over the lane peer median", "7.48x the lane median, against 1x for its peers",
               "16 tickets, the test needs 17"]
    assert [text for text in reasons + [ROUND_36_ACTION] if ROUND_36_SECOND_NUMBER.search(text)] == [ROUND_36_ACTION], \
        "the check the freight notebook wrote stops on its own action and on none of its reasons"
    assert ROUND_36_SECOND_NUMBER.search("1 recipients, PageRank 0.00000646, component of 10 customers")
    assert_in_every_notebook(agent_ns, numbers, "Numbers in text: ")


def carrier_summary_facts(lines, name_missing):
    facts = []
    for carrier in sorted({c for c, _, _ in lines}, key=lambda c: (c is None, c or "")):
        rows = [(passes, excess) for c, passes, excess in lines if c == carrier]
        alerts = [excess for passes, excess in rows if passes]
        name = carrier if carrier is not None else name_missing
        helpers = inspire_helpers()
        facts.append(f"{name}: {helpers.fmt_count(len(alerts), 'alert')} with excess freight of "
                     f"{helpers.fmt_num(sum(alerts))}, {helpers.fmt_num(sum(x for _, x in rows))} over all of its "
                     f"{helpers.fmt_count(len(rows), 'line')}")
    return facts


def summary_prompt_check(prompt):
    if MISSING_NUMBER_WORD.search(prompt):
        raise ValueError(f"the summary prompt holds a missing value: {prompt}")
    return prompt


def test_round_36_the_summary_prompt_holds_formatted_facts_over_the_rows_each_fact_names(agent_ns):
    facts_rule = agent_ns["GENIE_EXPLANATION_FACTS_RULE"]
    assert ("Build the summary step's facts the same way, from facts the code computed and formatted with fmt_num, "
            "fmt_count and fmt_rank, never a raw number, dict or list: each number in a fact covers the rows that fact names, "
            "so a group's count of passing rows goes with the amount over those rows, and a total over all of the group's rows "
            "says so") in facts_rule, \
        ("round 36: the freight summary paired each carrier's alert count with its excess freight over all of its lines, and "
         "the Transportation Manager read 'The queue holds 19 alerts across 13 of the 20 named carriers, with total excess "
         "freight of 1,136K'; the Pareto summary read 'The Assortment Planner scored 60897 store-items'")
    assert "a group whose key is missing is named for what it is, such as 'no carrier', never by a missing value's text;" \
        in facts_rule, "round 36: the freight notebook's first summary named a missing carrier 'nan'"
    assert ("the step raises an error when the facts hold the whole word 'unknown' or 'inf', or "
            + agent_ns["GENIE_MISSING_VALUE_TEXTS"] + ", and otherwise passes them to "
            "`inspire_write_summary(facts, result_table, run_id, as_of_date)`") in facts_rule
    lines = [("UPS", True, 300.0), ("UPS", False, 500.0), ("UPS", False, -100.0), (None, True, 40.0)]
    packed = [f"{carrier}: {sum(p for c, p, _ in lines if c == carrier)} alerts, total excess freight "
              f"{inspire_helpers().fmt_num(sum(x for c, _, x in lines if c == carrier))}" for carrier in ("UPS", None)]
    assert packed[0] == "UPS: 1 alerts, total excess freight 700", \
        "the round 36 fact puts the excess of all 3 lines next to the count of the 1 alert, whose own excess is 300"
    assert carrier_summary_facts(lines, "no carrier") == [
        "UPS: 1 alert with excess freight of 300, 700 over all of its 3 lines",
        "no carrier: 1 alert with excess freight of 40, 40 over all of its 1 line"]
    with pytest.raises(ValueError, match="missing value"):
        summary_prompt_check("; ".join(packed))
    with pytest.raises(ValueError, match="missing value"):
        summary_prompt_check("; ".join(carrier_summary_facts(lines, f"{float('nan')}")))
    assert summary_prompt_check("; ".join(carrier_summary_facts(lines, "no carrier")))
    assert_in_every_notebook(agent_ns, facts_rule, "AI facts: ")


def test_round_36_a_condition_is_counted_with_count_if_which_gives_0_where_a_sum_gives_null(agent_ns):
    nesting = agent_ns["GENIE_SQL_NESTING_RULE"]
    assert ("Count the rows that meet a condition with `F.count_if(condition)`, which gives 0 when none do, never "
            "`F.sum(condition.cast('int'))` or `F.sum(F.when(condition, 1))`, which give NULL when the condition is NULL on every "
            "row of a group, and wrap any other sum whose answer over no value is 0 in `F.coalesce(..., F.lit(0))`") in nesting, \
        ("round 36: the Pareto notebook counted its halo tickets with F.sum(((F.col('ticket_lines')>1) & "
         "(F.col('other_net_paid')>F.col('class_median_ticket'))).cast('int')), which is NULL for a store-item on which every "
         "comparison is NULL, and its first run raised \"TypeError: int() argument must be a string, a bytes-like object or a "
         "real number, not 'NoneType'\"")
    db = sqlite3.connect(":memory:")
    db.executescript("CREATE TABLE t (g TEXT, x REAL); INSERT INTO t VALUES ('a', NULL), ('a', NULL), ('b', 3), ('b', NULL);")
    rows = db.execute("SELECT g, SUM(CAST(x > 1 AS INTEGER)), SUM(CASE WHEN x > 1 THEN 1 END), "
                      "COUNT(CASE WHEN x > 1 THEN 1 END) FROM t GROUP BY g ORDER BY g").fetchall()
    assert rows == [("a", None, None, 0), ("b", 1, 1, 1)], \
        "a sum of a condition that is NULL on every row of its group is NULL, while counting the rows where it holds gives 0"
    codes = [code for code in re.findall(r"`([^`]+)`", nesting) if code.startswith("F.")]
    assert {"F.count_if(condition)", "F.sum(condition.cast('int'))", "F.coalesce(..., F.lit(0))"} <= set(codes)
    for code in codes:
        ast.parse(code)
    assert_in_every_notebook(agent_ns, nesting)


ROUND_36_SPARSE_PROBE = r"""
import json
import warnings
import numpy as np
import scipy.sparse as sparse
rng = np.random.default_rng(0)
n, edges = 2000, 3000
adjacency = sparse.csr_matrix((np.ones(edges), (rng.integers(0, n, edges), rng.integers(0, n, edges))), shape=(n, n))
out_degree = np.asarray(adjacency.sum(axis=1)).ravel()
inverse_out_degree = np.divide(1.0, out_degree, out=np.zeros_like(out_degree), where=out_degree > 0)
transition = sparse.diags(inverse_out_degree) @ adjacency
assigned = adjacency.astype(float)
with warnings.catch_warnings(record=True) as caught:
    warnings.simplefilter("always")
    for i in range(200):
        assigned[i] = assigned[i].toarray() * inverse_out_degree[i]
rank = np.full(n, 1.0 / n)
dangling = out_degree == 0
for _ in range(50):
    rank = 0.85 * (transition.T @ rank + rank[dangling].sum() / n) + 0.15 / n
print(json.dumps({"product_sparse": bool(sparse.issparse(transition)), "product_nnz": int(transition.nnz),
                  "adjacency_nnz": int(adjacency.nnz), "assigned_nnz": int(assigned.nnz),
                  "warnings": sorted({type(w.message).__name__ for w in caught}),
                  "row_sums": sorted({round(float(s), 9) for s in np.asarray(transition.sum(axis=1)).ravel()}),
                  "rank_sum": round(float(rank.sum()), 9)}))
"""


def test_round_36_a_sparse_matrix_is_scaled_by_a_diagonal_product_never_by_assigning_rows(agent_ns):
    sparse_rule = agent_ns["GENIE_SPARSE_MATRIX_RULE"]
    assert ("scale its rows or columns by multiplying it with `scipy.sparse.diags(...)`, such as a PageRank transition matrix "
            "`scipy.sparse.diags(inverse_out_degree) @ adjacency` with 0 for a node without out-links, never by assigning to its "
            "rows, columns or elements, where a row assigned from a dense array stores each of its elements, zeros "
            "included") in sparse_rule, \
        ("round 36: the gift-sender notebook was killed out of memory (exit code 137) after 'Graph rows received: 72759', and "
         "Genie Code replaced the sparse row assignment of its PageRank transition matrix with a diagonal product")
    guidance = agent_ns["TECHNIQUE_IMPLEMENTATION_GUIDANCE"]
    network = guidance["Network Analysis"]
    assert ("build the graph from the relationship columns as one scipy.sparse adjacency matrix, then compute degree, connected "
            "components (scipy.sparse.csgraph) and a power-iteration PageRank on that matrix with a dense numpy rank "
            "vector") in network
    assert "PageRank with numpy;" not in network
    techniques = agent_ns["GENIE_SPARSE_MATRIX_TECHNIQUES"]
    assert {name for name, text in guidance.items() if re.search(r"scipy\.sparse|scipy sparse|scipy\.optimize", text)} == \
        set(techniques), "every technique whose method builds scipy matrices gets the sparse-matrix rule"
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis", "Classification"):
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        assert spec["technique"] == technique
        assert (sparse_rule in inst._genie_platform_rules(spec)) is (technique in techniques), technique
    for code in re.findall(r"`([^`]+)`", sparse_rule):
        if code.startswith("scipy."):
            ast.parse(code)
    done = subprocess.run([sys.executable, "-c", ROUND_36_SPARSE_PROBE], capture_output=True, text=True, timeout=300)
    assert done.returncode == 0, done.stderr[-3000:]
    out = json.loads(done.stdout)
    assert out["product_sparse"] is True and out["product_nnz"] == out["adjacency_nnz"]
    assert out["assigned_nnz"] >= 200 * 2000 and out["warnings"] == ["SparseEfficiencyWarning"], out
    assert out["row_sums"] == [0.0, 1.0] and out["rank_sum"] == 1.0, out
    assert sparse_rule.isascii()


def test_round_36_every_row_is_one_entity_of_the_decision_population_at_the_entity_key_grain(agent_ns):
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        mandate = inst._build_code_structure_mandate(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique})))
        entity = meaning(mandate, "entity_id")
        assert ("the entity key, from the use case's entity key column: every row is one entity at that key's grain, or one "
                "entity with one of its items or periods when the method writes several for each entity, that item or period "
                "then leading segment_or_item so that entity_id with segment_or_item tells the rows apart, never a row of "
                "another grain, such as a segment's finding next to customer rows, which the summary step reports instead") \
            in entity, \
            ("round 36: the gift-sender instruction defined 'entity_id: sender rows: `c_customer_id`; segment rows: the "
             "segment name', and 3 segment rows ranked 1st, 2nd and 4th of the 51,647 rows of its target list of senders")
        assert ("every entity of the population the decision acts on keeps its row, and one the method cannot score, such as a "
                "customer with a single order for a model of the gaps between orders, keeps it with its reason in "
                "data_quality_flag and the Monitor tier, never left out by defining the population as the entities the method "
                "can score") in entity, \
            ("round 36: the catalog-lapse instruction defined its population as 'anchors with at least `min_prior_orders` "
             "earlier order dates (repeat buyers)', and its 20,818 rows left out every customer with a single order, which "
             "round 35 wrote as 6,490 rows flagged 'single catalog order, no inter-order gap'")
        assert "{" not in entity and "}" not in entity, technique
    rows = [{"entity_id": "catalog and web", "passes": False, "flag": "ok", "impact": 24.1},
            {"entity_id": "AAAAAAAAMLLEAAAA", "passes": False, "flag": "ok", "impact": 0.02},
            {"entity_id": "catalog", "passes": False, "flag": "ok", "impact": 16.5}] + \
           [{"entity_id": f"AAAAAAAA{i:08d}", "passes": False, "flag": "too few closed new recipients", "impact": None}
            for i in range(4)]
    def order(row):
        return not row["passes"], row["flag"] != "ok", -(row["impact"] if row["impact"] is not None else -math.inf)

    senders = {r["entity_id"] for r in rows if r["entity_id"].startswith("AAAAAAAA")}
    mixed = [r["entity_id"] for r in sorted(rows, key=order)]
    assert mixed[:3] == ["catalog and web", "catalog", "AAAAAAAAMLLEAAAA"], \
        "a segment row with its pooled sample outranks every sender of the target list"
    assert [e for e in mixed if e in senders][0] == "AAAAAAAAMLLEAAAA" and len([e for e in mixed if e in senders]) == 5


ROUND_36_KEY_PROBE = r"""
import json
import pandas as pd
lines = pd.DataFrame({"ss_store_sk": pd.array([1, None, 2], dtype="Int64"), "ss_item_sk": pd.array([7, 7, None], dtype="Int64"),
                      "sold": pd.to_datetime(["2002-12-30", None, "2002-12-31"])})
def key(frame):
    return [f"{store}-{item}" for store, item in zip(frame["ss_store_sk"], frame["ss_item_sk"])]
entity_only = lines[lines["ss_item_sk"].notna()]
row_key = lines.dropna(subset=["ss_store_sk", "ss_item_sk"])
print(json.dumps({"entity_only": key(entity_only), "row_key": key(row_key), "missing_date": f"last sale on {lines['sold'][1]}"}))
"""


def test_round_36_a_row_key_with_a_missing_part_names_no_entity(agent_ns):
    missing = agent_ns["GENIE_MISSING_VALUE_TEXTS"]
    assert missing.startswith("the whole word 'None', 'nan' or 'NaT' or the text '<NA>', which Python and pandas write for "
                              "a missing value")
    period = agent_ns["GENIE_PERIOD_COMPLETE_RULE"]
    assert ("Drop the rows missing the time value or any column of the row key, the entity key and each column a row is scored "
            "per, such as the store of a store-item row, from the frame every later step uses, not only from the readiness "
            "count") in period, \
        ("round 36: the Pareto instruction said 'A row is one (`ss_store_sk`, `ss_item_sk`)' and 'Drop the rows without an "
         "entity key or time value'; its notebook dropped the lines without an item and kept those without a store, and 6,898 "
         "of its 60,897 rows carried an entity_id such as '<NA>-1'")
    assert "Drop the rows without an entity key or time value" not in period
    numbers = agent_ns["GENIE_NUMBER_FORMAT_RULE"]
    assert "Check entity_id, entity_label and segment_or_item for " + missing in numbers
    assert "recommended_action or ai_facts text holds the whole word 'unknown' or 'inf', or " + missing in numbers
    assert "the facts hold the whole word 'unknown' or 'inf', or " + missing in agent_ns["GENIE_EXPLANATION_FACTS_RULE"]
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        assert period in inst._genie_platform_rules(spec), technique
        entity = meaning(inst._build_code_structure_mandate(spec), "entity_id")
        assert ("a row whose key misses a part, such as a sale without a store for a store-item key, names no entity and gets "
                "no row, so the key never holds '<NA>', 'None' or 'nan'") in entity, technique
    quoted = re.findall(r"'([^']+)'", missing)
    assert quoted[:4] == ["None", "nan", "NaT", "<NA>"] and quoted[4:] == ["Nan", "Nat", "Unknown"]
    detector = re.compile(r"\b(None|nan|NaT)\b|<NA>")
    done = subprocess.run([sys.executable, "-c", ROUND_36_KEY_PROBE], capture_output=True, text=True, timeout=120)
    assert done.returncode == 0, done.stderr[-2000:]
    out = json.loads(done.stdout)
    assert out["entity_only"] == ["1-7", "<NA>-7"], "dropping on the entity key alone keeps a sale without a store"
    assert out["row_key"] == ["1-7"] and out["missing_date"] == "last sale on NaT"
    for text in (out["entity_only"][1], out["missing_date"], "Order 159907 line item 16609 (None)", "Store 12 (nan)"):
        assert detector.search(text) and MISSING_NUMBER_WORD.search(text), text
    for text in out["row_key"] + ["Nancy Collins", "Natalie Brown", "not significant against the null hypothesis",
                                  "credit rating Unknown", "Banana | Books"]:
        assert not detector.search(text), text


def first_repeated_row_key(rows):
    seen = {}
    for row in rows:
        key = (row["entity_id"], row["segment_or_item"])
        if key in seen:
            return seen[key], row
        seen[key] = row
    return None


def test_round_37_rows_of_one_entity_are_told_apart_by_segment_or_item(agent_ns):
    inst = build_inspire(agent_ns)
    check = ("Before the write, check that no two rows share both entity_id and segment_or_item and stop the run on the first "
             "pair that does, printing both rows: a repeat is a row of another grain, or an item or period left out of "
             "segment_or_item, such as order lines written under their order with only the item's label telling them apart")
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        assert check in inst._genie_platform_rules(spec), \
            ("round 37: the freight-dispute instruction set entity_id to `cs_order_number` and segment_or_item to "
             "'<sm_carrier> | <lane> | <sm_type>', so its 2,939 order-line rows held 2,380 distinct pairs of entity_id and "
             "segment_or_item, the line item only in the label")
        mandate = inst._build_code_structure_mandate(spec)
        segment, entity = meaning(mandate, "segment_or_item"), meaning(mandate, "entity_id")
        assert ("the item or period that tells apart the rows of an entity the method writes several rows for, such as the line "
                "item of an order line, before any group the row belongs to, otherwise the segment, item or group the row "
                "belongs to ('' when none)") in segment, technique
        assert "that item or period then leading segment_or_item so that entity_id with segment_or_item tells the rows apart" \
            in entity, technique
        assert "{" not in segment + entity and "}" not in segment + entity, technique
    lines = [("159679", "16119", "UPS | TN-NC | EXPRESS"), ("159679", "16120", "UPS | TN-NC | EXPRESS"),
             ("159680", "1201", "FEDEX | CA-NV | REGULAR")]
    under_order = [{"entity_id": order, "segment_or_item": lane, "entity_label": f"Order {order}, item {item}"}
                   for order, item, lane in lines]
    repeat = first_repeated_row_key(under_order)
    assert repeat and [r["entity_label"] for r in repeat] == ["Order 159679, item 16119", "Order 159679, item 16120"], \
        "two lines of one order on one lane share entity_id and segment_or_item when the item is only in the label"
    item_first = [{"entity_id": order, "segment_or_item": f"{item} | {lane}"} for order, item, lane in lines]
    assert first_repeated_row_key(item_first) is None
    store_items = [{"entity_id": "10147", "segment_or_item": "able | Books"}, {"entity_id": "10147", "segment_or_item": "ought | Books"}]
    senders = [{"entity_id": f"AAAAAAAA{i:08d}", "segment_or_item": "web"} for i in range(3)]
    assert first_repeated_row_key(store_items) is None and first_repeated_row_key(senders) is None
    rank = agent_ns["GENIE_RANK_ORDER_RULE"]
    assert ("then by `key` (the row key: entity_id, followed by segment_or_item when the method writes several rows for an "
            "entity, so tied rows of one entity keep one order on every run) ascending") in rank
    assert "(the entity key) ascending" not in rank
    tied = [dict(r, impact=0.0) for r in reversed(store_items)]
    by_entity = [r["segment_or_item"] for r in sorted(tied, key=lambda r: (-r["impact"], r["entity_id"]))]
    by_row_key = [r["segment_or_item"] for r in sorted(tied, key=lambda r: (-r["impact"], r["entity_id"], r["segment_or_item"]))]
    assert by_entity == ["ought | Books", "able | Books"], "on the entity key alone, tied rows keep whatever order they came in"
    assert by_row_key == ["able | Books", "ought | Books"]


ROUND_37_NA_PROBE = r"""
import json
import math
import pandas as pd
def naive(x):
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return "unknown"
    return str(round(float(x)))
def ruled(x):
    if x is None or pd.isna(x) or (isinstance(x, float) and math.isinf(x)):
        return "unknown"
    return str(round(float(x)))
column = pd.Series(pd.array([3, None], dtype="Int64"))
try:
    naive(column[1])
    naive_error = None
except TypeError as error:
    naive_error = str(error)
print(json.dumps({"held": column[1] is pd.NA, "naive_error": naive_error,
                  "ruled": [ruled(v) for v in (None, float("nan"), pd.NA, pd.NaT, float("inf"), 0, 2.6, column[0])]}))
"""


def test_round_37_every_formatter_treats_pandas_na_as_missing(agent_ns):
    numbers = agent_ns["GENIE_NUMBER_FORMAT_RULE"]
    assert "`is_missing(x)` finds None, NaN, pandas' NA and NaT and inf missing" in numbers, \
        ("round 37: the freight notebook's first run stopped with \"TypeError: float() argument must be a string or a real "
         "number, not 'NAType'\" in its formatter, which tested only None and NaN, and fmt_num in each of the round's other 4 "
         "notebooks raised the same TypeError when called on pd.NA")
    assert "`fmt_num(x)` writes 'unknown' for a missing value or a text that is not a number" in numbers
    helpers, pd = inspire_helpers(), agent_ns["pd"]
    for value in (None, float("nan"), pd.NA, pd.NaT, float("inf"), pd.array([3, None], dtype="Int64")[1]):
        assert helpers.is_missing(value) and helpers.fmt_num(value) == "unknown" and helpers.fmt_rank(value) == "unknown", value
        assert helpers.fmt_count(value, "day") == "unknown days" and helpers.keep_reasons([("x", (value,))]) == [], value
    assert len(rule_cases(numbers)) == 9, "the fmt_num cases still parse"
    done = subprocess.run([sys.executable, "-c", ROUND_37_NA_PROBE], capture_output=True, text=True, timeout=120)
    assert done.returncode == 0, done.stderr[-2000:]
    out = json.loads(done.stdout)
    assert out["held"] is True, "a nullable integer column holds pandas' NA for a missing value"
    assert out["naive_error"] == "float() argument must be a string or a real number, not 'NAType'"
    assert out["ruled"] == ["unknown"] * 5 + ["0", "3", "3"]
    assert_in_every_notebook(agent_ns, numbers, "Numbers in text: ")


ROUND_37_FEATURE_PROBE = r"""
import json
import pandas as pd
train_pdf = pd.DataFrame({"recency": [1.0, 5, 3, 9, 2, 8], "orders": [3.0, 1, 2, 1, 4, 1], "treatment": [1, 0, 1, 0, 1, 0]})
prior = pd.concat([train_pdf, train_pdf[["orders"]]], axis=1)
out = {"repeated": list(prior[["recency", "orders"]].columns)}
scoring_pdf = train_pdf.drop(columns=["treatment"])
try:
    scoring_pdf[["recency", "orders", "treatment"]]
    out["select_before_set"] = None
except KeyError as error:
    out["select_before_set"] = "not in index" in str(error)
out["set_then_select"] = list(scoring_pdf.assign(treatment=0)[["recency", "orders", "treatment"]].columns)
try:
    from sklearn.linear_model import LogisticRegression
except ImportError:
    out["order"] = "no sklearn"
else:
    feature_cols = ["recency", "orders", "treatment"]
    model = LogisticRegression().fit(train_pdf[feature_cols], [1, 0, 1, 0, 1, 0])
    try:
        model.predict_proba(train_pdf[["orders", "recency", "treatment"]])
        out["order"] = None
    except ValueError as error:
        out["order"] = "Feature names must be in the same order as they were in fit" in str(error)
    out["same_list"] = len(model.predict_proba(scoring_pdf.assign(treatment=0)[feature_cols]))
print(json.dumps(out))
"""


def test_round_37_every_model_reads_its_features_in_the_fits_order(agent_ns):
    rule = agent_ns["GENIE_FEATURE_COLUMNS_RULE"]
    assert ("Fit, evaluate and score every model on one list of feature column names, `feature_cols`, that holds no name "
            "twice, selecting `x_pdf[feature_cols]` each time, so every frame a model reads has the fit's columns in the fit's "
            "order") in rule, \
        ("round 37: the coupon-uplift notebook's evaluation stopped twice on 'The feature names should match those that were "
         "passed during fit. Feature names must be in the same order as they were in fit.', the second time from a current "
         "and a prior copy of each demographic column under one name")
    assert ("Score another arm, such as the untreated arm of an uplift model or of its baseline, on a copy of the scoring "
            "frame with that arm's columns set before the selection, `scoring_pdf.assign(**{treatment_col: 0})[feature_cols]`") in rule, \
        "round 37: the coupon-uplift scoring stopped because its counterfactual frame selected `treatment` before adding it"
    assert "makes `x_pdf[feature_cols]` return both copies and stops the fit or the prediction" in rule
    assert rule.isascii()
    inst = build_inspire(agent_ns)
    models = agent_ns["INSPIRE_MODEL_FAMILIES"]
    seen = {True: 0, False: 0}
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        is_model = spec["family"] in models
        seen[is_model] += 1
        rules = inst._genie_platform_rules(spec)
        assert (rule in rules) is is_model, technique
        assert rules.count(rule) == (1 if is_model else 0), technique
    assert seen[True] and seen[False], "both kinds of notebook are checked"
    done = subprocess.run([sys.executable, "-c", ROUND_37_FEATURE_PROBE], capture_output=True, text=True, timeout=300)
    assert done.returncode == 0, done.stderr[-2000:]
    out = json.loads(done.stdout)
    assert out["repeated"] == ["recency", "orders", "orders"], "a repeated name returns both copies"
    assert out["select_before_set"] is True and out["set_then_select"] == ["recency", "orders", "treatment"]
    if out["order"] == "no sklearn":
        pytest.skip("scikit-learn is not installed")
    assert out["order"] is True and out["same_list"] == 6


def test_round_37_a_count_of_days_agrees_with_its_noun(agent_ns):
    numbers = agent_ns["GENIE_NUMBER_FORMAT_RULE"]
    assert ("A count's noun agrees with it: '1 prior order', '2 prior orders', '1 day since the last order', so a count and "
            "its noun, a number of days, weeks or months among them, are written by `fmt_count(n, noun, plural=None)`") \
        in numbers, \
        ("round 37: the coupon-uplift instruction gave the reason 'N days since the last catalog order, against a typical M "
         "for its segment', and 51 of its 27,298 rows read '1 days since the last catalog order'")
    assert ("a reason the instruction words with a count before a plural noun, such as 'N days since the last order', is "
            "built as fmt_count(n, 'day') + ' since the last order'") in numbers
    one_plural = re.compile(r"(?<![\d.,])1 (days|weeks|months|orders)\b")
    template = [f"{n} days since the last catalog order" for n in (1, 2)]
    ruled = [inspire_helpers().fmt_count(n, "day") + " since the last catalog order" for n in (1, 2)]
    assert one_plural.search(template[0]) and not one_plural.search(template[1])
    assert ruled == ["1 day since the last catalog order", "2 days since the last catalog order"]
    assert not any(one_plural.search(text) for text in ruled)
    assert_in_every_notebook(agent_ns, numbers, "Numbers in text: ")


def test_round_38_the_column_meanings_reach_genie_code_verbatim_and_win_over_section_7(agent_ns):
    columns = agent_ns["INSPIRE_CORE_COLUMNS"]
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        inst = build_inspire(agent_ns)
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        rules, mandate = inst._genie_platform_rules(spec), inst._build_code_structure_mandate(spec)
        *lines, actions = inst._genie_output_column_lines(spec)
        assert [line.split(" ", 1)[0] for line in lines] == [name for name, _ in columns], technique
        for line in lines:
            assert rules.count(f"\n  - {line}\n") == 1 and f"\n- {line}\n" in mandate, (technique, line[:60])
        assert f"\n  - {actions}\n" in rules and f"\n{actions}" in mandate, technique
        assert "section 7 says how this use case fills each column, and where it says otherwise, these meanings win" in rules, \
            ("round 38: the writer gave a delisting notebook's value as 'effect size of the item's group concentration change', "
             "and Genie Code, which read the column meanings only through that paraphrase, wrote 898 distinct values on "
             "107,681 item rows")
        top_reasons = next(line for line in lines if line.startswith("top_reasons "))
        assert "is given as its rank by that score alone among every row that has the score" in top_reasons, \
            ("round 38: the freight instruction gave the anomaly score as 'its rank among scored rows', and 354 of the "
             "357 score ranks its notebook wrote disagreed with the row's rank by that score")
        assert not re.search(r"\{(act_now|review|top_k|action_target|use_case_id|value_type)\}", rules), technique
        assert rules.index("these meanings win") < rules.index("cast every business output column to these types"), technique


def test_round_38_a_repeated_key_keeps_every_row_and_a_baseline_that_misses_acceptance_never_acts(agent_ns):
    inst = build_inspire(agent_ns)
    rules = inst._genie_platform_rules(inst._genie_notebook_spec(make_uc()))
    assert ("such as order lines written under their order with only the item's label telling them apart, which is resolved by "
            "putting that item or period first in segment_or_item, never by aggregating the rows to the entity key or leaving "
            "rows of the population out") in rules, \
        ("round 38: with the row-key check and no rule for resolving a repeat, the freight notebook wrote one row for each of "
         "374 orders where round 37 wrote 2,939 order lines")
    monitor = agent_ns["GENIE_BASELINE_MONITOR_RULE"]
    assert ("When the baseline itself misses the acceptance thresholds, every row is Monitor whatever its decision test gives, "
            "such as an uplift above 0 from a baseline whose AUC is at chance") in monitor, \
        ("round 38: the coupon-uplift baseline missed min_auc 0.6 with an AUC of 0.487, and its rows, whose uplift agreed to 5 "
         "decimals, still went 495 to Act now and 1,979 to Review: the Monitor rule reached only the writer, which left it out")
    baseline, models = agent_ns["GENIE_BASELINE_VALUE_RULE"], agent_ns["INSPIRE_MODEL_FAMILIES"]
    seen = set()
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        is_model, predicted = spec["family"] in models, spec["decision_basis"] == "predicted"
        seen.add((is_model, predicted))
        rules = inst._genie_platform_rules(spec)
        assert rules.count(baseline) == (1 if is_model else 0), technique
        assert rules.count(monitor) == (1 if is_model and predicted else 0), \
            ("the Monitor rule for a baseline that misses acceptance reaches Genie Code for a prediction, and a measured "
             "amount keeps the tier its value_at_stake gives") + f": {technique}"
        stop = inst._genie_acceptance_stop_rule(spec)
        assert stop.count("misses the acceptance thresholds") == (1 if is_model and predicted else 0), technique
        if is_model:
            assert stop.endswith(monitor + " " + agent_ns["GENIE_PREDICTED_ACCEPTED_RULE"] if predicted
                                 else agent_ns["GENIE_MEASURED_TIER_RULE"]), technique
    assert {(True, True), (True, False), (False, True), (False, False)} <= seen, "every kind of notebook is checked"


ROUND_38_RANK_TOTAL_PROBE = """
import json
import pandas as pd
frame = pd.DataFrame({"score": [0.9, 0.5, None, 0.7, 0.2],
                      "data_quality_flag": ["ok", "lane peer too sparse", "ok", "ok", "lane peer too sparse"]})
rank = frame["score"].rank(method="min", ascending=False, na_option="keep")
print(json.dumps({"max_rank": int(rank.max()), "rows_with_score": int(frame["score"].notna().sum()),
                  "ok_rows_with_score": int((frame["score"].notna() & (frame["data_quality_flag"] == "ok")).sum())}))
"""


def test_round_38_flags_name_no_defining_property_and_reasons_state_their_true_total_once(agent_ns):
    _, _, mandate = spec_and_mandate(agent_ns, **{"Analytics Technique": "Network Analysis"})
    flag, reasons = meaning(mandate, "data_quality_flag"), meaning(mandate, "top_reasons")
    assert ("never a property every row of the population has by its definition, such as the outcome window still open on "
            "every row a model scores, which the summary step states once") in flag, \
        ("round 38: the lapse notebook flagged 20,090 of its 27,298 rows 'censored, open window', the condition that puts a "
         "customer in its scoring population, so no row was 'ok' and every row was Monitor")
    assert "among every row that has the score, flagged rows among them, whose count is the total the reason states" in reasons, \
        "round 38: 17 of the freight notebook's 374 rows read like 'anomaly score ranks 374th among 357 scored rows'"
    assert "the step asserts that no score rank exceeds the total its reason states" in reasons
    assert "never a repeated reason or one that restates a count another reason gives" in reasons, \
        "round 38: 51,643 of the gift-sender notebook's 51,644 rows restated their recipient count, such as '1 recipient, the test needs 5' and then '1 recipient'"
    assert flag.isascii() and reasons.isascii()
    done = subprocess.run([sys.executable, "-c", ROUND_38_RANK_TOTAL_PROBE], capture_output=True, text=True, timeout=300)
    assert done.returncode == 0, done.stderr[-2000:]
    out = json.loads(done.stdout)
    assert out == {"max_rank": 4, "rows_with_score": 4, "ok_rows_with_score": 2}, out
    assert out["max_rank"] > out["ok_rows_with_score"], "a total of the 'ok' rows alone is below the ranks flagged rows get"


def test_round_38_a_pareto_value_is_the_contributors_own_and_the_pip_cell_sits_below_the_instruction(agent_ns):
    pareto = agent_ns["TECHNIQUE_IMPLEMENTATION_GUIDANCE"]["Pareto Analysis"]
    assert "every reported concentration change carries" not in pareto
    assert ("every tested finding is a contributor's own, such as its change in share against the prior period, and carries "
            "an effect size and a Benjamini-Hochberg corrected significance; that finding is the contributor's value and "
            "decision test, and a group's concentration, its Gini or its change is reported in the summary, never as the value "
            "or the test of its contributors' rows") in pareto, \
        ("round 38: the delisting notebook tested each store and class group's concentration change, its test flagged every "
         "group, and all 107,681 item rows were Monitor")
    assert pareto.isascii()
    _, _, mandate = spec_and_mandate(agent_ns, **{"Analytics Technique": "Classification"})
    assert "the notebook installs nothing" in mandate and "%pip" not in mandate + agent_ns["GENIE_RUN_CONTROLS_RULE"], \
        "round 38 put a %pip cell above Inspire's card; the notebook now has no install cell to misplace"


def test_round_39_missing_value_texts_match_case_sensitively_in_every_check(agent_ns):
    missing = agent_ns["GENIE_MISSING_VALUE_TEXTS"]
    clause = ("each word of the check matched case-sensitively, never with `re.IGNORECASE`, `(?i)`, `case=False` or a lowered "
              "text, so neither a name such as 'Nan' or 'Nat' nor a category such as 'Unknown' matches")
    assert clause in missing, \
        ("round 39: the gift-sender notebook's check before the write matched 'nan' whatever its case and stopped the run on "
         "a sender's name; 3 of its 51,644 senders, such as 'Nan Gil', have the first name Nan")
    numbers, facts = agent_ns["GENIE_NUMBER_FORMAT_RULE"], agent_ns["GENIE_EXPLANATION_FACTS_RULE"]
    assert numbers.count(missing) == 2 and facts.count(missing) == 1
    assert "holds the whole word 'unknown' or 'inf', or " + missing in numbers, \
        ("round 39: the coupon-uplift and delisting notebooks checked 'unknown' in one case-insensitive pattern with 'nan'; "
         "TPC-DS gives 480,200 demographic rows the credit rating 'Unknown' and 274,400 the education 'Unknown'")
    assert "the facts hold the whole word 'unknown' or 'inf', or " + missing in facts
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        rules = inst._genie_platform_rules(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique})))
        assert rules.count(clause) == 3, technique
    pattern = re.compile(r"(?:^|\W)(?:unknown|inf|None|nan|NaT)(?:$|\W)|<NA>")
    assert pattern.search("nan") and pattern.search("<NA> / 7") and pattern.search("store None") and pattern.search("unknown days")
    for text in ("Nan Gil", "Nat King", "credit rating Unknown", "education Unknown"):
        assert not pattern.search(text), text
        assert re.compile(pattern.pattern, re.I).search(text), f"the case-insensitive check stops on {text!r}"
    assert missing.isascii()


def test_round_39_a_row_the_method_computes_no_result_for_has_a_null_value(agent_ns):
    clause = ("and NULL on a row the method computes no result for, such as an entity with no unit left to test, whose shrunken "
              "estimate is only its baseline, or one whose outcome window is still open, never 0 or the baseline in its place")
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        _, spec, mandate = spec_and_mandate(agent_ns, **{"Analytics Technique": technique})
        assert clause in meaning(mandate, "value"), technique
        assert clause in inst._genie_platform_rules(spec), \
            (f"{technique}: round 39: the gift-sender notebook wrote a value of 0.0, the shrunken rate of a sender with no "
             "recipient left to test less the baseline, for 27,108 of its 51,644 senders: 21,817 whose recipients were all "
             "already buyers and 5,291 with every recipient's conversion window still open")
    assert "with a missing impact last" in agent_ns["GENIE_RANK_ORDER_RULE"]


ROUND_39_FRAME_PROBE = r"""
import json
import pandas as pd
frame = pd.DataFrame({"buy": ["high", None, "low"], "x": [1.0, 2.0, 3.0]})
out = {}
in_place = frame.copy()
in_place["buy"] = in_place["buy"].astype("category")
try:
    in_place["buy"].fillna("no buy potential")
    out["in_place"] = "filled"
except TypeError as error:
    out["in_place"] = str(error)
feature_cols, categorical_cols = ["buy", "x", "treatment"], ["buy"]
scoring_pdf = frame.copy()
try:
    scoring_pdf[feature_cols]
    out["selected_first"] = "selected"
except KeyError as error:
    out["selected_first"] = "KeyError " + str(error)
arm = scoring_pdf.assign(**{"treatment": 0})[feature_cols].astype({c: "category" for c in categorical_cols})
out["arm_columns"] = arm.columns.tolist()
out["arm_dtype"] = str(arm["buy"].dtype)
out["label"] = scoring_pdf["buy"].fillna("no buy potential").tolist()
print(json.dumps(out))
"""


def test_round_39_a_model_frame_alone_holds_categories_and_an_arm_is_set_before_its_selection(agent_ns):
    rule = agent_ns["GENIE_FEATURE_COLUMNS_RULE"]
    assert ("`scoring_pdf.assign(**{treatment_col: 0})[feature_cols]`, since the scoring frame has no treatment column of its "
            "own") in rule, \
        "round 39: the coupon-uplift baseline's scoring stopped on KeyError \"['treatment'] not in index\", the class of round 37"
    assert ("Cast a column to pandas' category dtype, as `categorical_features='from_dtype'` needs, only in the frame a model "
            "reads, `frame[feature_cols].astype({c: 'category' for c in categorical_cols})`, never in the frame later steps "
            "fill, label or write") in rule, \
        ("round 39: the lapse notebook cast its buy-potential column to category dtype on the frame its labels read, and two "
         "runs stopped on 'Cannot setitem on a Categorical with a new category', for 'no buy potential' and then for an empty text")
    done = subprocess.run([sys.executable, "-c", ROUND_39_FRAME_PROBE], capture_output=True, text=True, timeout=300)
    assert done.returncode == 0, done.stderr[-2000:]
    out = json.loads(done.stdout)
    assert out["in_place"].startswith("Cannot setitem on a Categorical with a new category"), out
    assert out["selected_first"].startswith("KeyError") and "treatment" in out["selected_first"], out
    assert out["arm_columns"] == ["buy", "x", "treatment"] and out["arm_dtype"] == "category", out
    assert out["label"] == ["high", "no buy potential", "low"], out
    inst = build_inspire(agent_ns)
    assert rule in inst._genie_platform_rules(inst._genie_notebook_spec(make_uc())) and rule.isascii()


def test_round_39_frames_stack_by_name_over_one_column_list(agent_ns):
    rule = agent_ns["GENIE_JOIN_RULE"]
    assert ("Stack frames with `unionByName` over one column list selected from each, "
            "`a_sdf.select(cols).unionByName(b_sdf.select(cols))`: `unionByName` stops on frames whose columns differ, such "
            "as fit rows and scoring rows, which have no outcome, and `union` pairs columns by position") in rule, \
        ("round 39: the lapse notebook's leakage guard ran train_sdf.unionByName(holdout_sdf).unionByName(score_sdf) and "
         "stopped on NUM_COLUMNS_MISMATCH, 32 columns against 33")
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        assert rule in inst._genie_platform_rules(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))), technique
    assert rule.isascii()


def test_round_39_float_rounding_never_orders_rows(agent_ns):
    rank = agent_ns["GENIE_RANK_ORDER_RULE"]
    stated = re.search(r"and that `(rank_rows\(pd\.Series\(\[False, False, False\]\).+?\)\.tolist\(\))` is (\[[0-9, ]+\])", rank)
    assert stated, "the rule states the near-tie call and its result"
    expected = ast.literal_eval(stated.group(2))
    probe = round_33_probe(stated.group(1))
    assert expected == [3, 2, 1] and probe["by_six_figures"] == expected, probe
    assert probe["by_boolean"] != expected, \
        ("round 39: the coupon-uplift notebook's first rows agreed to 12 significant digits (0.01046220327498365 against "
         "0.010462203274964887), so float rounding chose which customer ranked 1st")
    inst = build_inspire(agent_ns)
    assert rank in inst._genie_platform_rules(inst._genie_notebook_spec(make_uc())) and rank.isascii()


def test_round_39_the_step_that_writes_share_reasons_asserts_none_is_a_zero_share(agent_ns):
    weight = agent_ns["GENIE_WEIGHT_CHECK_RULE"]
    assert ("because of the sign of its measure, and the step that writes these share reasons asserts that none of them is a "
            "0% share on each share's number") in weight, \
        ("round 39: 2 of the delisting notebook's 53,296 rows, such as store 10's fragrances item 15369, still read '0% of its "
         "class's losses', since nothing checked the rule against a 0% share")
    assert "Before the write, check that no reason gives a 0% share" not in weight, \
        "a check over every reason stops on a rate such as '0% of 5 closed recipients bought on their own'"
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        assert weight in inst._genie_platform_rules(spec), technique
        assert "Weights and signed measures: " + weight in inst._build_code_structure_mandate(spec), technique


ROUND_40_GROUP_PROBE = r"""
import json
import pandas as pd
out = {}
for dtype in ("object", "string", "category"):
    frame = pd.DataFrame({"segment": pd.Series(["high", None, "low", "high"], dtype=dtype), "x": [1, 2, 3, 4]})
    try:
        frame["segment"].fillna("missing")
        out[dtype + "_fillna"] = "filled"
    except TypeError as error:
        out[dtype + "_fillna"] = str(error)
    frame["segment_group"] = frame["segment"].astype(object).where(frame["segment"].notna(), "missing")
    out[dtype + "_groups"] = {str(key): group["x"].tolist() for key, group in list(frame.groupby("segment_group"))}
    out[dtype + "_original"] = [None if pd.isna(value) else str(value) for value in frame["segment"]]
print(json.dumps(out))
"""


def test_round_40_a_missing_group_key_is_labeled_before_the_rows_are_grouped(agent_ns):
    rule = agent_ns["GENIE_FRAME_NAMES_RULE"]
    assert agent_ns["GENIE_NOTEBOOK_ENV_VERSION"] == "4", \
        "serverless environment 4 runs pandas 2.2.3 (probe run 123456789000029); recheck this sentence before changing it"
    assert ("Serverless environment 4 runs pandas 2.2.3, where `len()`, `list()`, `sorted()` or `.groups` of a groupby on one "
            "key with `dropna=False` raises 'Categorical categories cannot be null' when a key is missing, and `get_group` "
            "cannot select the missing group") in rule, \
        ("round 40: the lapse notebook built its Kaplan-Meier strata from list(x.groupby('buy_potential', dropna=False)), "
         "and 2 test runs stopped on 'Categorical categories cannot be null', which pandas 2.2.3 raises when a key is missing; "
         "the freight notebook's first run stopped on the same error from fit.groupby('sm_type', dropna=False).groups")
    assert ("label them in a new column, `x_pdf['segment_group'] = x_pdf['segment'].astype(object).where("
            "x_pdf['segment'].notna(), 'missing')`, group on that column and build labels from the original one") in rule
    done = subprocess.run([sys.executable, "-c", ROUND_40_GROUP_PROBE], capture_output=True, text=True, timeout=300)
    assert done.returncode == 0, done.stderr[-2000:]
    out = json.loads(done.stdout)
    assert out["category_fillna"].startswith("Cannot setitem on a Categorical with a new category"), \
        "fillna('missing') fails on a category key, so the rule labels a copy cast to object"
    for dtype in ("object", "string", "category"):
        assert out[dtype + "_groups"] == {"high": [1, 4], "low": [3], "missing": [2]}, (dtype, out)
        assert out[dtype + "_original"] == ["high", None, "low", "high"], (dtype, out)
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        assert rule in inst._genie_platform_rules(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))), technique
    assert rule.isascii()


ROUND_40_BOOL_KEY_PROBE = r"""
import json
import numpy as np
import pandas as pd
out = {}
for name, key in (("python_false", False), ("python_true", True), ("numpy_false", np.False_), ("numpy_true", np.True_)):
    frame = pd.DataFrame({"flag": ["ok", "ok", "too few"]})
    try:
        frame.loc[key, "flag"] = "every series"
        out[name] = {"index": [str(label) for label in frame.index], "flag": frame["flag"].tolist()}
    except KeyError as error:
        out[name] = "KeyError " + str(error)
frame = pd.DataFrame({"flag": ["ok", "ok", "too few"]})
every_series_flagged = bool(np.array([0.01, 0.02]).max() < 0.05)
if every_series_flagged:
    frame["flag"] = "every series"
out["if_then_assign"] = frame["flag"].tolist()
print(json.dumps(out))
"""


def test_round_40_a_fact_about_the_whole_run_is_tested_with_if_never_used_as_a_row_key(agent_ns):
    frame_rule = agent_ns["GENIE_FRAME_NAMES_RULE"]
    significance = agent_ns["GENIE_SIGNIFICANCE_RULE"]
    assert ("A fact about the whole run, such as a test flagging every series, is one bool: test it with `if` before assigning "
            "rows, never use it as the row key of `.loc` or join it to a row mask with `and` or `or`, which return the bool "
            "itself") in frame_rule, \
        ("round 40: the gift-sender notebook wrote f.loc[all_sig, 'data_quality_flag'] = 'test flags every series' for the "
         "significance rule's fact about the whole run, and its first test run stopped on KeyError 'cannot use a single bool "
         "to index into setitem'")
    assert ("when it flags every tested series, one fact about the whole run that an `if` tests, set each row's "
            "data_quality_flag to 'test flags every series'") in significance
    done = subprocess.run([sys.executable, "-c", ROUND_40_BOOL_KEY_PROBE], capture_output=True, text=True, timeout=300)
    assert done.returncode == 0, done.stderr[-2000:]
    out = json.loads(done.stdout)
    assert "cannot use a single bool to index into setitem" in out["python_false"] and out["python_true"] == out["python_false"], out
    assert out["numpy_false"] == {"index": ["0", "1", "2", "False"], "flag": ["every series", "ok", "too few", "every series"]}, \
        "a numpy bool is taken as the row label 0, and the frame gains a row labeled False"
    assert out["numpy_true"] == {"index": ["0", "1", "2", "True"], "flag": ["ok", "every series", "too few", "every series"]}, out
    assert out["if_then_assign"] == ["every series"] * 3, out
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        rules = inst._genie_platform_rules(spec)
        assert frame_rule in rules and significance in rules, technique
        assert "Significance tests: " + significance in inst._build_code_structure_mandate(spec), technique
    assert frame_rule.isascii() and significance.isascii()


def restated_counts(reasons):
    pairs = [set(re.findall(r"(?<![\d.,])(\d[\d,]*)\s+([a-z]+(?: [a-z]+)?)", reason)) for reason in reasons]
    return sorted({pair for i, own in enumerate(pairs) for pair in own if any(pair in other for other in pairs[i + 1:])})


def test_round_40_a_count_below_the_minimum_is_stated_once_so_a_rate_never_repeats_it(agent_ns):
    sentence = ("that count reason is the only one of its row that states the count, so the row's rate reads 'repeat rate 100%, "
                "against a baseline of 35%', never 'repeat rate 100% over 3 customers'")
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        _, _, mandate = spec_and_mandate(agent_ns, **{"Analytics Technique": technique})
        reasons = meaning(mandate, "top_reasons")
        assert sentence in reasons, \
            ("round 40: 24,025 of the gift-sender notebook's 51,682 rows read '3 closed recipients, the test needs 5' and then "
             "'conversion rate 100% over 3 closed recipients, against a baseline of 35.1%', a restated count the rule already forbade")
        assert reasons.index("a unit below the test's minimum states its count and the minimum") < reasons.index(sentence), technique
        assert reasons.isascii()
    count_reason = "3 customers, the test needs 5"
    assert restated_counts([count_reason, "repeat rate 100% over 3 customers"]) == [("3", "customers")]
    assert restated_counts([count_reason, "repeat rate 100%, against a baseline of 35%"]) == []
    assert restated_counts(["3 closed recipients, the test needs 5",
                            "conversion rate 100% over 3 closed recipients, against a baseline of 35.1%",
                            "19,980th of 51,682 senders by influence"]) == [("3", "closed recipients")]
    assert restated_counts(["12 tickets, the test needs 21", "12th of 4,000 senders by influence"]) == []


def test_round_41_a_zero_share_is_asserted_on_the_share_never_on_the_reason_text(agent_ns):
    weight = agent_ns["GENIE_WEIGHT_CHECK_RULE"]
    assert ("asserts that none of them is a 0% share on each share's number before fmt_num formats it, which is 0 only for a "
            "share of 0, never on the reason's text, where a test for '0%' also matches '10%' and '100%'") in weight, \
        ("round 41: the delisting notebook asserted the rule with `\"0% of its class\" in reason`, and its first 2 test runs "
         "stopped on 'Zero share reason at rank 14', whose reason read 10%")
    shares = {"10% of its class's losses": 0.1, "100% of its class's profit": 1.0, "0% of its class's losses": 0.0}
    assert [text for text in shares if "0% of its class" in text] == list(shares), "a test on the text also stops on 10% and 100%"
    assert [text for text, share in shares.items() if share == 0] == ["0% of its class's losses"]
    number_rule = agent_ns["GENIE_NUMBER_FORMAT_RULE"]
    assert "'0' for 0, and otherwise rounds to 3 significant figures" in number_rule
    fmt_num = inspire_helpers().fmt_num
    assert [share for share in (0.0, 1e-12, 0.0004, 0.0049, 0.04, 0.996) if fmt_num(share * 100) == "0"] == [0.0], \
        "Inspire's fmt_num writes '0' only for a share of 0, so the check on the share's number is the check on its text"
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        assert weight in inst._genie_platform_rules(spec), technique
        assert "Weights and signed measures: " + weight in inst._build_code_structure_mandate(spec), technique
    assert weight.isascii()


ROUND_41_JSON_PROBE = r"""
import datetime
import json
import numpy as np
import pandas as pd
out = {}
accepted = np.float64(0.7) >= 0.6 and np.float64(0.5) >= 0.4
out["type"] = type(accepted).__module__
try:
    json.dumps({"accepted": accepted})
    out["plain"] = "serialized"
except TypeError as error:
    out["plain"] = str(error)
default = lambda v: v.tolist() if hasattr(v, 'tolist') else str(v)
out["hooked"] = json.loads(json.dumps({"accepted": accepted, "auc": np.float64(0.61), "rows": np.int64(3), "ids": np.array([1, 2]),
                                       "rates": pd.Series([1.5]), "as_of": pd.Timestamp("2003-01-08"),
                                       "date": datetime.date(2003, 1, 8)}, default=default))
print(json.dumps(out))
"""


def test_round_41_numpy_values_reach_json_through_a_default_that_converts_them(agent_ns):
    rule = agent_ns["GENIE_DECIMAL_RULE"]
    assert ("and pass every json.dumps `default=lambda v: v.tolist() if hasattr(v, 'tolist') else str(v)`, since a comparison of "
            "numpy numbers, such as an AUC against its threshold, and an `and` of such comparisons are numpy booleans too") in rule, \
        ("round 41: the coupon-uplift notebook set metrics['accepted'] to an `and` of AUC and PR AUC comparisons, a numpy bool, and "
         "its first test run stopped on json.dumps with 'Object of type bool is not JSON serializable'")
    done = subprocess.run([sys.executable, "-c", ROUND_41_JSON_PROBE], capture_output=True, text=True, timeout=300)
    assert done.returncode == 0, done.stderr[-2000:]
    out = json.loads(done.stdout)
    assert out["type"] == "numpy" and "is not JSON serializable" in out["plain"], out
    assert out["hooked"] == {"accepted": True, "auc": 0.61, "rows": 3, "ids": [1, 2], "rates": [1.5], "as_of": "2003-01-08 00:00:00",
                             "date": "2003-01-08"}, out
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        assert rule in inst._genie_platform_rules(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))), technique
    assert rule.isascii()


def kaplan_meier(times, events):
    curve, survival = [], fractions.Fraction(1)
    for day in sorted(set(times)):
        at_risk = sum(1 for t in times if t >= day)
        ended = sum(1 for t, e in zip(times, events) if t == day and e)
        survival *= 1 - fractions.Fraction(ended, at_risk)
        curve.append((day, survival))
    return curve


def test_round_41_a_survival_quantile_the_curve_never_reaches_is_longer_than_the_follow_up(agent_ns):
    unreached = agent_ns["GENIE_UNREACHED_QUANTILE_RULE"]
    assert ("that stays above a quantile's level to the end of its follow-up has not reached that quantile, which is then longer "
            "than the follow-up, never missing or NULL, whatever a build step says: a reason states it as more than the follow-up "
            "('more than 365 days'), and a date built from it, such as the day a lapse window opens, uses the follow-up's end") \
        in unreached, \
        ("round 41: the lapse-timing notebook's instruction said km_open_days is 'NULL when never reached', and km_open_days and "
         "km_median_days were None in every segment, so no customer got a lapse-window date from the curve")
    assert agent_ns["GENIE_CLOSED_WINDOW_RULE"].endswith(" " + unreached)
    writer = agent_ns["PROMPT_TEMPLATES"]["USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT"]
    assert "for example the exact outcome rule.{unreached_quantile_rule}\n- Use only plain ASCII" in writer
    for technique, reads in (("Survival Analysis", True), ("Cohort Analysis", True), ("Clustering", False), ("Forecasting", False)):
        agent = FakeAgent([long_instruction(f"Use `{ORDERS}.amount`.")])
        build_inspire(agent_ns, loader=FakeLoader(), agent=agent)._generate_genie_instruction_for_use_case(
            make_uc(**{"Analytics Technique": technique}), [], "")
        rendered = writer.format(**agent.calls[0]["vars"])
        assert (("for example the exact outcome rule.\n- " + unreached + "\n- Use only plain ASCII") in rendered) is reads, \
            f"{technique}: the instruction writer reads the same sentence as the platform rule, so its steps never say NULL"
        assert (unreached in rendered) is reads, technique
        if not reads:
            assert "for example the exact outcome rule.\n- Use only plain ASCII" in rendered, \
                f"{technique}: a use case without a survival curve gets no empty rule line"
    rare = kaplan_meier([30, 60, 90, 120, 200] + [365] * 45, [1] * 5 + [0] * 45)
    assert min(s for _, s in rare) == fractions.Fraction(9, 10)
    assert next((day for day, s in rare if s <= fractions.Fraction(1, 2)), None) is None, \
        "a first day at or below the level is None when the event is rare"
    follow_up_end = max(day for day, _ in rare)
    assert next((day for day, s in rare if s <= fractions.Fraction(1, 2)), follow_up_end) == 365
    common = kaplan_meier([10, 20, 30, 40, 50, 60], [1, 1, 1, 1, 1, 0])
    assert next(day for day, s in common if s <= fractions.Fraction(1, 2)) == 30, "a curve that reaches the level keeps its own day"
    inst = build_inspire(agent_ns)
    families = agent_ns["GENIE_OUTCOME_WINDOW_FAMILIES"]
    seen = set()
    for technique in TECHNIQUES + ("Survival Analysis", "Pareto Analysis", "Network Analysis"):
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        seen.add(spec["family"] in families)
        assert (unreached in inst._genie_platform_rules(spec)) is (spec["family"] in families), technique
    assert seen == {True, False}
    assert unreached.isascii()


def test_round_41_rows_of_an_earlier_test_run_stay_as_closed_history_and_never_read_as_the_latest(agent_ns):
    controls = agent_ns["GENIE_RUN_CONTROLS_RULE"]
    assert ("Each run closes the versions of the records whose values it changes and gives the others its run_id, so the rows of an "
            "earlier test run stay in the table only as closed change history and in `<table>_run_log`, which no output reads as current "
            "rows: never delete them.") in controls, \
        ("round 41: the delisting notebook's third test run resolved as_of_date 2003-04-01 and wrote 53,989 rows, and its last "
         "run wrote 53,999 rows for 2003-01-01, so the table's newest rows were the test run's")
    assert "DELETE FROM` the output table" not in controls and "report each as_of_date later" not in controls
    table = sqlite3.connect(":memory:")
    table.execute("CREATE TABLE out (as_of_date TEXT, run_id TEXT, entity_id INTEGER, is_current INTEGER, change_source TEXT)")

    def write(as_of_date, run_id, rows):
        table.execute("UPDATE out SET is_current = 0 WHERE is_current = 1 AND change_source = 'run'")
        table.executemany("INSERT INTO out VALUES (?, ?, ?, 1, 'run')", [(as_of_date, run_id, k) for k in range(rows)])

    write("2003-01-02", "before-this-session", 7)
    write("2003-04-01", "test-run-3", 5)
    write("2003-01-01", "last-run", 9)
    newest = "SELECT run_id, COUNT(*) FROM out WHERE as_of_date = (SELECT MAX(as_of_date) FROM out) GROUP BY run_id"
    assert table.execute(newest).fetchall() == [("test-run-3", 5)], "the newest as_of_date still names the test run"
    current = f"SELECT run_id, COUNT(*) FROM out WHERE {agent_ns['implement_latest_run_filter']('main.s.out')} GROUP BY run_id"
    assert table.execute(current).fetchall() == [("last-run", 9)], \
        "the current rows are the last run's, whatever date an earlier test run resolved"
    assert table.execute("SELECT COUNT(*) FROM out").fetchone() == (21,), "every earlier run stays as history"
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        assert controls in inst._genie_platform_rules(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))), technique


def test_round_41_a_count_against_the_minimum_reaches_only_the_rows_below_it(agent_ns):
    _, _, mandate = spec_and_mandate(agent_ns, **{"Analytics Technique": "Anomaly Detection"})
    reasons = meaning(mandate, "top_reasons")
    assert ("the step adds that fact only to the rows below the minimum, never to the facts of every row, since keep_reasons drops "
            "only a fact whose number is missing and so moves a fact listed for every row into the reasons of a row that lacks an "
            "earlier fact, as when lines missing a sales price read '1.13K peer lines, the median needs 5', puts it first among a "
            "below-minimum row's facts, and asserts before the write that no row whose count reaches the minimum gives it") \
        in reasons, \
        ("round 41: 25 of the shipping-charge notebook's 2,939 lines, 23 flagged 'sales price missing or zero' and 2 'quantity "
         "missing or zero', gave a count at or above the minimum, such as '1.13K peer lines, the median needs 5'")
    assert reasons.index("never states them, so no row reads '294 peer lines") < reasons.index("the step adds that fact only")
    minimum = 5

    def facts(row, conditional):
        listed = [(f"excess {row['excess']} over the lane median", (row["excess"],)),
                  (f"shipping cost {row['cost']}", (row["cost"],)),
                  (f"{row['share']} of its carrier's charges", (row["share"],))]
        count = (f"{row['peers']} peer lines, the median needs {minimum}", (row["peers"],))
        if not conditional:
            return listed + [count]
        return ([count] + listed) if row["peers"] < minimum else listed

    missing_price = {"excess": None, "cost": 12.5, "share": "4%", "peers": 1130}
    below = {"excess": 3.1, "cost": 9.0, "share": "2%", "peers": 3}
    assert "1130 peer lines, the median needs 5" in inspire_helpers().keep_reasons(facts(missing_price, conditional=False)), \
        "a count listed for every row reaches a row missing an earlier fact"
    assert "3 peer lines, the median needs 5" not in inspire_helpers().keep_reasons(facts(below, conditional=False)), \
        "listed last, the count of a below-minimum row falls past the 3 kept reasons"
    assert all("peer lines" not in text for text in inspire_helpers().keep_reasons(facts(missing_price, conditional=True)))
    assert inspire_helpers().keep_reasons(facts(below, conditional=True))[0] == "3 peer lines, the median needs 5"
    assert reasons.isascii()


def states_own_value(value, reason):
    if ", against " in reason:
        return False
    for number, unit in re.findall(r"(?<![0-9.,])([0-9][0-9,]*(?:\.[0-9]+)?)(%?)", reason):
        stated = float(number.replace(",", "")) / (100 if unit else 1)
        if abs(stated - value) <= 0.006 * abs(value):
            return True
    return False


def test_round_41_a_rows_own_value_is_never_a_reason_by_itself(agent_ns):
    _, _, mandate = spec_and_mandate(agent_ns, **{"Analytics Technique": "Predictive Modeling"})
    reasons = meaning(mandate, "top_reasons")
    rule = ("the row's own value is never a reason by itself ('lapse risk 50.3%' on a row whose value is that risk), since the "
            "value column holds it, and a reason states it only with the reference it is compared against, as in that rate")
    assert rule in reasons, \
        "round 41: the lapse-timing notebook's rows gave their own lapse risk, such as 'lapse risk 50.3%', as a reason"
    assert "'repeat rate 100%, against a baseline of 35%'" in reasons and \
        reasons.index("'repeat rate 100%, against a baseline of 35%'") < reasons.index(rule), \
        "the rate the rule points to is the reason form it allows"
    assert "own value is never one of its reasons" not in reasons, \
        "a ban on every reason that states the value contradicts the rate reason the same contract asks for"
    assert states_own_value(0.503, "lapse risk 50.3%") and states_own_value(0.4997, "lapse risk 50%"), \
        "the lapse rows' reason restates the value and must be caught"
    assert not states_own_value(1.0, "repeat rate 100%, against a baseline of 35%"), \
        "a value stated with the reference it is compared against carries the reference, so it stays"
    assert not states_own_value(0.503, "discount reliance 42.5%"), "a different number is another fact"
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        assert "the row's own value is never a reason by itself" in meaning(inst._build_code_structure_mandate(spec), "top_reasons"), \
            technique


ROUND_41_MERGE_PROBE = r"""
import json
import numpy as np
import pandas as pd
lines = pd.DataFrame({"line": [1, 2, 3], "lane": ["A", np.nan, np.nan]})
medians = pd.DataFrame({"lane": ["A", np.nan], "lane_median": [40.0, 15.0]})
merged = lines.merge(medians, on="lane", how="left")
known = lines.merge(medians.dropna(subset=["lane"]), on="lane", how="left")
print(json.dumps({"merged": merged["lane_median"].tolist(), "known": [None if pd.isna(v) else v for v in known["lane_median"]]}))
"""


def test_round_41_a_reference_for_a_missing_group_key_names_the_rows_it_covers(agent_ns):
    _, _, mandate = spec_and_mandate(agent_ns, **{"Analytics Technique": "Anomaly Detection"})
    reasons = meaning(mandate, "top_reasons")
    assert ("a reference names the rows it covers: pandas `merge` matches a missing key to every other missing key, so a row whose "
            "group key is missing is compared with a group it belongs to, such as its carrier's median for a line with no known "
            "lane, or reads 'against a median of 15 for lines with no known lane', never 'against a lane peer median of 15'") \
        in reasons, \
        ("round 41: the shipping-charge notebook's first run gave lines flagged 'lane unknown' reasons such as 'ship cost per unit "
         "100, against a lane peer median of 15', the median of every line with no known lane")
    done = subprocess.run([sys.executable, "-c", ROUND_41_MERGE_PROBE], capture_output=True, text=True, timeout=300)
    assert done.returncode == 0, done.stderr[-2000:]
    out = json.loads(done.stdout)
    assert out["merged"] == [40.0, 15.0, 15.0], "pandas gives every line with a missing lane the missing lanes' median"
    assert out["known"] == [40.0, None, None], "without the missing key's group, those lines get no lane median"
    assert reasons.isascii()


ROUND_42_IMPUTED_PROBE = r"""
import json
import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
rng = np.random.default_rng(7)
n = 400
fit = pd.DataFrame({"prior_order_count": rng.integers(1, 6, n), "avg_order_value": rng.normal(80, 20, n),
                    "days_since_prev_order": rng.integers(5, 200, n), "days_since_last_order": rng.integers(0, 400, n)})
y = (fit["days_since_last_order"] + rng.normal(0, 60, n) > 200).astype(int)
single = pd.DataFrame({"prior_order_count": [0] * 5, "avg_order_value": [np.nan] * 5, "days_since_prev_order": [np.nan] * 5,
                       "days_since_last_order": [10, 90, 180, 270, 360]})
def scores(cols):
    model = Pipeline([("impute", SimpleImputer(strategy="median")), ("scale", StandardScaler()),
                      ("model", LogisticRegression(class_weight="balanced", max_iter=1000))])
    model.fit(fit[cols], y)
    return sorted({round(float(p), 6) for p in model.predict_proba(single[cols])[:, 1]})
gaps = ["prior_order_count", "avg_order_value", "days_since_prev_order"]
print(json.dumps({"gaps_only": scores(gaps), "with_recency": scores(gaps + ["days_since_last_order"])}))
"""


def test_round_42_every_model_reads_a_feature_every_scored_row_has(agent_ns):
    rule = agent_ns["GENIE_FEATURE_COLUMNS_RULE"]
    assert ("Every model, the baseline among them, reads at least one feature that every row it scores has, such as the days since "
            "the entity's last event, and gets one when a build step lists none: an imputer fills a missing feature with one value, "
            "so rows that lack every feature a model reads, such as single-order customers scored only on the gaps between their "
            "orders, all get one score, which is no result of their own.") in rule, \
        ("round 42: the lapse instruction's baseline read prior_order_count, avg_order_value and days_since_prev_order, which a "
         "customer with one order lacks, and the median imputer gave all 31,998 single-order customers the risk 0.503")
    done = subprocess.run([sys.executable, "-c", ROUND_42_IMPUTED_PROBE], capture_output=True, text=True, timeout=300)
    assert done.returncode == 0, done.stderr[-2000:]
    out = json.loads(done.stdout)
    assert len(out["gaps_only"]) == 1, "single-order customers scored only on imputed gap features all get one score"
    assert len(out["with_recency"]) == 5, "a feature every row has gives each of them its own score"
    inst = build_inspire(agent_ns)
    families, seen = agent_ns["INSPIRE_MODEL_FAMILIES"], set()
    for technique in TECHNIQUES + ("Survival Analysis", "Pareto Analysis", "Network Analysis"):
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        seen.add(spec["family"] in families)
        assert (rule in inst._genie_platform_rules(spec)) is (spec["family"] in families), technique
    assert seen == {True, False}
    assert rule.isascii()


ROUND_42_NULLABLE_PROBE = r"""
import json
import numpy as np
import pandas as pd
n = pd.to_numeric(pd.Series([3, None, 9]), errors="coerce").astype("Int64")
m = pd.to_numeric(pd.Series([5, 5, None]), errors="coerce").astype("Int64")
out = {"compared": [None if v is pd.NA else bool(v) for v in (n < m)]}
try:
    np.where(n < m, "too few", "ok")
    out["raw"] = "ran"
except TypeError as error:
    out["raw"] = str(error)
out["filled"] = np.where((n < m).fillna(False), "too few", "ok").tolist()
print(json.dumps(out))
"""


def test_round_42_a_comparison_of_a_nullable_column_is_filled_before_it_picks_rows(agent_ns):
    rule = agent_ns["GENIE_DECIMAL_RULE"]
    assert ("never with `astype(int)`, which raises IntCastingNaNError on a missing value; a comparison of such a column is <NA> "
            "where a value is missing, which np.where, `if` and a `.loc` mask reject ('boolean value of NA is ambiguous'), so fill "
            "it with the answer a missing value gets, `(n < m).fillna(False)`, before it picks rows; call int() or round() only") \
        in rule, \
        ("round 42: the delisting notebook held its tested and minimum ticket counts as Int64, as the rule says, and its first test "
         "run stopped on np.where(out['n'] < out['m'], ...) with 'boolean value of NA is ambiguous'")
    done = subprocess.run([sys.executable, "-c", ROUND_42_NULLABLE_PROBE], capture_output=True, text=True, timeout=300)
    assert done.returncode == 0, done.stderr[-2000:]
    out = json.loads(done.stdout)
    assert out["compared"] == [True, None, None], "a comparison with a missing side is <NA>"
    assert out["raw"] == "boolean value of NA is ambiguous", out
    assert out["filled"] == ["too few", "ok", "ok"], "filled, the missing rows get the answer a missing value gets"
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        assert rule in inst._genie_platform_rules(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))), technique
    assert rule.isascii()


ROUND_42_MISSING_PROBE = r"""
import json
import math
import numbers
import numpy as np
import pandas as pd
def first_build(x):
    try:
        return x is None or bool(pd.isna(x)) or not math.isfinite(float(x))
    except (TypeError, ValueError):
        return True
def rule(x):
    return x is None or bool(pd.isna(x)) or (isinstance(x, numbers.Real) and math.isinf(x))
values = [None, float("nan"), pd.NA, pd.NaT, float("inf"), np.float64("-inf"), "UPS", "lane CA", 0, np.int64(3), np.float64(2.5)]
print(json.dumps({"first_build": [first_build(v) for v in values], "rule": [bool(rule(v)) for v in values]}))
"""


def test_round_42_a_text_value_is_never_missing(agent_ns):
    numbers_rule = agent_ns["GENIE_NUMBER_FORMAT_RULE"]
    assert ("`is_missing(x)` finds None, NaN, pandas' NA and NaT and inf missing and never a text, so a label or name, such as a "
            "carrier's name, is never missing") in numbers_rule, \
        ("round 42: the shipping-charge notebook's missing-value helper returned missing when float() raised, so every lane and "
         "carrier name was missing, the first run's top rows lost their references, and Genie rebuilt and reran it")
    done = subprocess.run([sys.executable, "-c", ROUND_42_MISSING_PROBE], capture_output=True, text=True, timeout=300)
    assert done.returncode == 0, done.stderr[-2000:]
    out = json.loads(done.stdout)
    missing = [True] * 6
    assert out["first_build"] == missing + [True, True, False, False, False], "the first build marks every text missing"
    assert out["rule"] == missing + [False, False, False, False, False], "the rule's test finds each missing value and no text"
    import numpy as np
    pd = agent_ns["pd"]
    values = [None, float("nan"), pd.NA, pd.NaT, float("inf"), np.float64("-inf"), "UPS", "lane CA", 0, np.int64(3), np.float64(2.5)]
    assert [inspire_helpers().is_missing(v) for v in values] == out["rule"], "Inspire's is_missing is the rule's test"
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        assert numbers_rule in inst._genie_platform_rules(spec), technique
    assert numbers_rule.isascii()


def test_round_42_a_missing_summary_fact_is_left_out_or_says_why(agent_ns):
    facts = agent_ns["GENIE_EXPLANATION_FACTS_RULE"]
    assert ("never by a missing value's text; a fact whose value is missing, such as a correlation over a column that does not "
            "vary, is left out of the facts or names why it is missing ('no correlation, since every sender has one recipient'), "
            "never fmt_num's 'unknown'; the step raises an error when the facts hold the whole word 'unknown'") in facts, \
        ("round 42: the gift-sender notebook formatted a correlation that was missing with fmt_num, its summary prompt held "
         "'unknown', the rule's check stopped the first run, and Genie rebuilt the summary and reran it")
    guard = re.compile(r"\b(unknown|inf|None|nan|NaT)\b|<NA>")
    stated = {"senders": "51.6K senders", "baseline conversion": "35.1%", "influence correlation": None}
    formatted = "; ".join(f"{name} {value if value is not None else 'unknown'}" for name, value in stated.items())
    left_out = "; ".join(f"{name} {value}" for name, value in stated.items() if value is not None)
    why = left_out + "; no correlation, since every sender has one recipient"
    assert guard.search(formatted), "a missing fact formatted with fmt_num stops the run at the check"
    assert not guard.search(left_out) and not guard.search(why), "a fact left out or named for why it is missing passes the check"
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        assert facts in inst._genie_platform_rules(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))), technique
    assert facts.isascii()


def test_round_42_a_date_from_an_unreached_quantile_is_stated_as_the_earliest(agent_ns):
    unreached = agent_ns["GENIE_UNREACHED_QUANTILE_RULE"]
    assert ("so a group whose event is rare still gets its date, and a reason that states that date, or the days to or since it, "
            "says it is the earliest ('the lapse window opens in 192 days at the earliest', 'the earliest the lapse window opened "
            "is 36 days ago').") in unreached, \
        ("round 42: every buy-potential group's curve stayed above one half to 365 days, and 79,850 lapse rows gave the window as "
         "a fact, such as 'the lapse window opened 36 days ago' for a customer 401 days after the last order")
    times = list(range(30, 330, 30)) + [400 + 4 * i for i in range(20)] + [600] * 20
    events = [1] * len(times[:-20]) + [0] * 20
    observed = kaplan_meier([min(t, 365) for t in times], [e if t <= 365 else 0 for t, e in zip(times, events)])
    assert next((day for day, s in observed if s <= fractions.Fraction(1, 2)), None) is None, "to 365 days the median is unreached"
    later = next(day for day, s in kaplan_meier(times, events) if s <= fractions.Fraction(1, 2))
    assert later == 456 and later > 401, \
        "a longer follow-up puts the median at 456 days, so a window at 365 days is only the earliest and had not opened at day 401"
    writer = agent_ns["PROMPT_TEMPLATES"]["USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT"]
    for technique, reads in (("Survival Analysis", True), ("Clustering", False)):
        agent = FakeAgent([long_instruction(f"Use `{ORDERS}.amount`.")])
        build_inspire(agent_ns, loader=FakeLoader(), agent=agent)._generate_genie_instruction_for_use_case(
            make_uc(**{"Analytics Technique": technique}), [], "")
        assert ("the lapse window opens in 192 days at the earliest" in writer.format(**agent.calls[0]["vars"])) is reads, technique
    assert unreached.isascii()


ROUND_43_STUBBED_BUILD = """
class StopRun(Exception): pass
def check_readiness(rows):
    if rows < 1:
        raise StopRun("no rows")
def fit_km(*args): raise RuntimeError("Readiness passed; Kaplan-Meier/model implementation requires continuation")
def score(*args): raise RuntimeError("Readiness passed; scoring implementation requires continuation")
def write_output(*args): pass
def run_use_case():
    check_readiness(5)
    curve = fit_km(5)
    return write_output(score(curve))
"""

ROUND_43_COMPLETE_BUILD = """
class StopRun(Exception): pass
def check_readiness(rows):
    if rows < 1:
        raise StopRun("no rows")
def fit_km(rows):
    return [1.0 - i / (rows + 1) for i in range(rows)]
def score(curve):
    return [round(s, 3) for s in curve]
def write_output(rows):
    return {"status": "written", "rows_written": len(rows), "as_of_date": "2003-01-08", "run_id": "r1"}
def run_use_case():
    check_readiness(5)
    curve = fit_km(5)
    return write_output(score(curve))
"""


def _stubbed_steps(code):
    stubs = []
    for node in ast.parse(code).body:
        if isinstance(node, ast.FunctionDef) and len(node.body) == 1 and (
                isinstance(node.body[0], (ast.Raise, ast.Pass))
                or (isinstance(node.body[0], ast.Return) and isinstance(node.body[0].value, (ast.Constant, type(None))))):
            stubs.append(node.name)
    return stubs


def test_round_43_every_step_is_written_in_full_and_a_failed_run_is_fixed_and_run_again(agent_ns):
    complete = agent_ns["GENIE_COMPLETE_BUILD_RULE"]
    assert ("Write every step the instruction lists in full before the first run, the business output write and the summary "
            "step among them, also when the run will stop by the STOP RULE") in complete
    assert "never write a stub, a step whose body only raises, passes or returns a placeholder" in complete, \
        ("round 43: the lapse notebook's first edit did not apply, Genie Code wrote fit_km, score, write_output and four more "
         "steps as functions that raise 'requires continuation', and its run failed after readiness")
    assert ("When an edit does not apply, read the notebook again and apply the same complete build, never a shorter one."
            in complete)
    assert ("A failed run is a defect to fix, never the result to report: fix the code and run again until a run returns its "
            "outcome, written or stopped by the STOP RULE.") in complete, \
        "round 43: Genie Code reported the failed run as its result after 4.5 minutes, with no output row written"
    assert complete in agent_ns["GENIE_RUN_CONTROLS_RULE"] and complete in agent_ns["GENIE_AGENTS_FILE_TEMPLATE"]
    assert ("- Run the notebook on serverless compute and fix your own code until it runs from top to bottom. " + complete + "\n"
            in agent_ns["GENIE_AGENTS_FILE_TEMPLATE"])
    assert _stubbed_steps(ROUND_43_STUBBED_BUILD) == ["fit_km", "score", "write_output"]
    assert _stubbed_steps(ROUND_43_COMPLETE_BUILD) == [], "a readiness check that raises only on a failed check is no stub"
    stubbed, built = {}, {}
    exec(ROUND_43_STUBBED_BUILD, stubbed)
    exec(ROUND_43_COMPLETE_BUILD, built)
    with pytest.raises(RuntimeError, match="requires continuation"):
        stubbed["run_use_case"]()
    assert built["run_use_case"]() == {"status": "written", "rows_written": 5, "as_of_date": "2003-01-08", "run_id": "r1"}
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES + ("Survival Analysis", "Pareto Analysis", "Network Analysis"):
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        assert inst._genie_platform_rules(spec).count(complete) == 1, technique
    assert complete.isascii() and "\u2014" not in complete and "\u2013" not in complete


ROUND_43_RATIO_PROBE = r"""
import json
import numpy as np
import pandas as pd
frame = pd.DataFrame({"above_n": [3.0, 0.0], "untied_n": [5.0, 0.0]})
def attempt(rows):
    try:
        return [a / b for a, b in rows]
    except ZeroDivisionError as error:
        return type(error).__name__
with np.errstate(divide="ignore", invalid="ignore"):
    series = (frame["above_n"] / frame["untied_n"]).tolist()
print(json.dumps({
    "itertuples": attempt([(r.above_n, r.untied_n) for r in frame.itertuples()]),
    "records": attempt([(r["above_n"], r["untied_n"]) for r in frame.to_dict("records")]),
    "series_is_nan": [bool(np.isnan(v)) for v in series],
    "guarded": [a / b if b > 0 else None for a, b in ((r.above_n, r.untied_n) for r in frame.itertuples())],
}))
"""


def test_round_43_a_ratio_of_python_numbers_is_computed_only_on_a_positive_denominator(agent_ns):
    rule = agent_ns["GENIE_DECIMAL_RULE"]
    assert ("A ratio of two Python numbers, such as a share computed for one row from the values `itertuples()` or "
            "`to_dict('records')` yields, raises ZeroDivisionError on a zero denominator instead: compute it only when the "
            "denominator is above 0, `a / b if b > 0 else None`, and leave a reason that states it out of a row whose "
            "denominator is 0.") in rule, \
        ("round 43: the delisting notebook's first run computed each item's share of tickets above the reference from "
         "its row's untied-ticket count and stopped on 'float division by zero' at an item with no untied ticket")
    done = subprocess.run([sys.executable, "-c", ROUND_43_RATIO_PROBE], capture_output=True, text=True, timeout=300)
    assert done.returncode == 0, done.stderr[-2000:]
    out = json.loads(done.stdout)
    assert out["itertuples"] == "ZeroDivisionError" and out["records"] == "ZeroDivisionError", out
    assert out["series_is_nan"] == [False, True], "a pandas column divided by zero gives NaN or inf, never an error"
    assert out["guarded"] == [0.6, None], out
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        assert rule in inst._genie_platform_rules(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))), technique
    assert rule.isascii()


def _per_unit_minimum(sizes, alpha=0.05):
    n = 5
    while True:
        units = sum(1 for size in sizes if size >= n)
        if units == 0:
            return None
        if min(1.0, 2 * 0.5 ** n) <= alpha / units:
            return n
        n += 1


def test_round_43_the_per_unit_minimum_is_computed_once_from_the_tested_sample(agent_ns):
    rule = agent_ns["GENIE_PER_UNIT_SAMPLE_RULE"]
    assert ("Readiness prints how many units reach it and their median sample size. Compute it once, with one function, from "
            "the sample the test computes on, before readiness checks it, and pass that value to readiness, the test, the "
            "shrinkage and each reason, so readiness never prints another minimum than the one the test uses.") in rule, \
        ("round 43: the gift-sender notebook's readiness computed the per-sender minimum before the outcomes and printed 7, "
         "its test computed it from the recipients whose window had closed and used 6, and Genie rebuilt readiness and reran it")
    senders = [size for size in range(4, 16) for _ in range(40)]
    closed = [size - 3 for size in senders]
    from_senders, from_test = _per_unit_minimum(senders), _per_unit_minimum(closed)
    assert (from_senders, from_test) == (13, 12), "the minimum differs with the sample it is computed on"
    assert sum(size >= from_test for size in closed) == 40 and sum(size >= from_senders for size in closed) == 0, \
        "a minimum from another count than the tested sample leaves readiness and the test disagreeing on which units qualify"
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES + ("Pareto Analysis", "Network Analysis"):
        assert rule in inst._genie_platform_rules(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))), technique
    assert rule.isascii()


def test_round_44_a_window_function_is_a_column_before_a_filter_reads_it(agent_ns):
    nesting = agent_ns["GENIE_SQL_NESTING_RULE"]
    assert ("COUNT(DISTINCT ...) over a window and a window function in a filter, a join condition or a HAVING clause "
            "(WINDOW_FUNCTION_NOT_ALLOWED_IN_CLAUSE): compute the window or the inner aggregate in its own step, as a column "
            "added with `withColumn`, then aggregate or filter on that column.") in nesting, \
        ("round 44: the coupon notebook filtered on a rank window inside its filter, and its first run stopped on "
         "'[WINDOW_FUNCTION_NOT_ALLOWED_IN_CLAUSE] It is not allowed to use window functions inside WHERE clause'")
    db = sqlite3.connect(":memory:")
    db.executescript("CREATE TABLE t (k TEXT, d INTEGER); INSERT INTO t VALUES ('a', 1), ('a', 3), ('b', 2), ('b', 5), ('b', 4);")
    with pytest.raises(sqlite3.OperationalError, match="misuse of window function"):
        db.execute("SELECT k, d FROM t WHERE ROW_NUMBER() OVER (PARTITION BY k ORDER BY d DESC) = 1").fetchall()
    latest = db.execute("SELECT k, d FROM (SELECT k, d, ROW_NUMBER() OVER (PARTITION BY k ORDER BY d DESC) AS latest_rank FROM t) "
                        "WHERE latest_rank = 1 ORDER BY k").fetchall()
    assert latest == [("a", 3), ("b", 5)], "the window computed as a column first, the filter keeps each key's latest row"
    assert_in_every_notebook(agent_ns, nesting)


ROUND_44_MONTH_LABEL_PROBE = r"""
import json
import pandas as pd
horizon, holdout_first = 90, pd.Timestamp('2002-12-01')
months = [pd.Timestamp('2002-08-01'), pd.Timestamp('2002-09-01')]
by_label = [str(m.date()) for m in months if m + pd.Timedelta(days=horizon) < holdout_first]
by_last_day = [str(m.date()) for m in months if m + pd.offsets.MonthEnd(0) + pd.Timedelta(days=horizon) < holdout_first]
anchor = pd.Timestamp('2002-09-25')
outcome_end = anchor + pd.Timedelta(days=horizon)
print(json.dumps({"by_label": by_label, "by_last_day": by_last_day,
                  "last_day": str((months[1] + pd.offsets.MonthEnd(0)).date()),
                  "label_month_reads_holdout": bool(outcome_end >= holdout_first)}))
"""


def test_round_44_a_window_labeled_by_its_first_day_is_tested_on_its_last_day(agent_ns):
    closed = agent_ns["GENIE_CLOSED_WINDOW_RULE"]
    assert ("A window labeled by its first day, such as a month from `F.trunc(date, 'month')`, ends the day before the next "
            "window starts: test that last day, `F.last_day(date)` for a month or `pd.Timestamp(m) + pd.offsets.MonthEnd(0)` in "
            "pandas, never the label, which counts the window closed up to a month too early, so its outcomes reach into the "
            "holdout's days.") in closed, \
        ("round 44: the coupon notebook chose its training months by the month's first day plus the 90-day horizon, its leakage "
         "check stopped the run, and Genie Code found that 'training eligibility used month-start instead of month-end'")
    assert "is closed only when its last day plus that horizon is before as_of_date. A window labeled by its first day" in closed
    done = subprocess.run([sys.executable, "-c", ROUND_44_MONTH_LABEL_PROBE], capture_output=True, text=True, timeout=300)
    assert done.returncode == 0, done.stderr[-2000:]
    out = json.loads(done.stdout)
    assert out["by_label"] == ["2002-08-01", "2002-09-01"], "tested on its label, September reads as closed before December"
    assert out["by_last_day"] == ["2002-08-01"], "tested on its last day, September's horizon reaches the holdout"
    assert out["last_day"] == "2002-09-30" and out["label_month_reads_holdout"], \
        "a September anchor's 90-day outcome window reaches into the December holdout"
    for code in ("pd.Timestamp(m) + pd.offsets.MonthEnd(0)", "F.last_day(date)", "F.trunc(date, 'month')"):
        assert f"`{code}`" in closed
        ast.parse(code)
    inst, families, seen = build_inspire(agent_ns), agent_ns["GENIE_OUTCOME_WINDOW_FAMILIES"], set()
    for technique in TECHNIQUES + ("Survival Analysis", "Pareto Analysis", "Network Analysis"):
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        seen.add(spec["family"] in families)
        assert (closed in inst._genie_platform_rules(spec)) is (spec["family"] in families), technique
    assert seen == {True, False}
    assert closed.isascii()


def test_round_44_spark_connect_analyzes_a_frame_at_its_first_action(agent_ns):
    nesting = agent_ns["GENIE_SQL_NESTING_RULE"]
    assert ("On serverless, Spark Connect analyzes a DataFrame only at its first action, so a column that does not resolve, such "
            "as a column of another frame, fails at a later count, collect or write, whose error names the line that wrote it "
            "after 'was called from', and a later `drop()` or `withColumn` of that column never removes the expression from the "
            "plan: delete the code a fix supersedes.") in nesting, \
        ("round 44: the gift-sender notebook kept a first is_pre_holiday column that read holiday_date, a column its frame "
         "lacks, dropped it and built the flag again, and its first run stopped 4 lines later at a count with "
         "'[UNRESOLVED_COLUMN.WITH_SUGGESTION] ... `holiday_date` cannot be resolved ... \"col\" was called from , line 77'")
    nesting_at = nesting.find("On serverless, Spark Connect")
    assert 0 < nesting_at < nesting.find("In PySpark, wrap every comparison")
    assert "Spark Connect" not in agent_ns["GENIE_SERVERLESS_RULE"], "the writer prompt reads the serverless rule; this one stays in the Platform Rules"
    assert_in_every_notebook(agent_ns, nesting)


ROUND_45_CLAIMED_REGISTER = """
def register(accepted, models):
    if not accepted:
        print("No approved model yet")
        return "", "robust z-score (median, MAD)"
    print("Candidate accepted; model registration is tracked in MLflow and alias champion is reserved for the approved version.")
    return "", "Isolation Forest per sm_type"
"""

ROUND_45_REGISTERED = """
def register(accepted, models):
    if not accepted:
        print("No approved model yet")
        return "", "robust z-score (median, MAD)"
    info = mlflow.pyfunc.log_model(python_model=models, artifact_path="model", registered_model_name=model_name)
    version = str(info.registered_model_version)
    mlflow.MlflowClient().set_registered_model_alias(model_name, "champion", version)
    return version, "Isolation Forest per sm_type"
"""

ROUND_45_WRITE = """
def write_output(rows, version, accepted):
    if accepted:
        assert version, "the accepted model has no registered version"
    return [dict(row, model_version=version) for row in rows]
def run_use_case(accepted=True):
    version, method = register(accepted, "forests")
    return method, write_output([{"entity_id": "1"}, {"entity_id": "2"}], version, accepted)
"""


class _FakeMlflow:
    def __init__(self):
        self.aliases, self.pyfunc = [], self

    def log_model(self, **kwargs):
        return type("Info", (), {"registered_model_version": 36})()

    def MlflowClient(self):
        return self

    def set_registered_model_alias(self, name, alias, version):
        self.aliases.append((name, alias, version))


def test_round_45_a_step_never_prints_its_work_as_done_in_place_of_doing_it(agent_ns):
    complete = agent_ns["GENIE_COMPLETE_BUILD_RULE"]
    assert ("never write a stub, a step whose body only raises, passes or returns a placeholder, or a branch of a step that "
            "prints its work as done in place of doing it, such as a registration step whose accepted branch prints a message "
            "and returns an empty version: every branch does the work the instruction gives it, and a step prints only what it "
            "did.") in complete, \
        ("round 45: the freight notebook's register step printed 'Candidate accepted; model registration is tracked in MLflow "
         "and alias champion is reserved for the approved version.' in 0.0 seconds, registered nothing and wrote 2,939 rows "
         "with an empty model_version; Genie Code found it only by reading the log, and ran the notebook a second time")
    assert complete.index("prints only what it did.") < complete.index("When an edit does not apply")
    stub = {"print": lambda *a, **k: None}
    exec(ROUND_45_CLAIMED_REGISTER + ROUND_45_WRITE, stub)
    with pytest.raises(AssertionError, match="no registered version"):
        stub["run_use_case"]()
    assert stub["run_use_case"](accepted=False)[1][0]["model_version"] == "", "the baseline's rows register nothing"
    fake = _FakeMlflow()
    built = {"print": lambda *a, **k: None, "mlflow": fake, "model_name": "cat.sch.freight_audit"}
    exec(ROUND_45_REGISTERED + ROUND_45_WRITE, built)
    method, rows = built["run_use_case"]()
    assert method == "Isolation Forest per sm_type" and {r["model_version"] for r in rows} == {"36"}
    assert fake.aliases == [("cat.sch.freight_audit", "champion", "36")]
    assert complete in agent_ns["GENIE_RUN_CONTROLS_RULE"] and complete in agent_ns["GENIE_AGENTS_FILE_TEMPLATE"]
    assert_in_every_notebook(agent_ns, complete)


def test_round_45_an_accepted_model_writes_the_version_its_registration_returned(agent_ns):
    mlflow = agent_ns["GENIE_MLFLOW_RULE"]
    assert ("Write that version as `model_version` on every row the accepted model scores, and assert before the write that "
            "it is not empty, so a registration that never ran stops the test run instead of writing the accepted model's "
            "rows with '' as their version.") in mlflow, \
        "round 45: the freight notebook wrote its accepted Isolation Forest's 2,939 rows with model_version '' and nothing registered"
    assert mlflow.index("set_registered_model_alias") < mlflow.index("Write that version as `model_version`")
    inst, families, seen = build_inspire(agent_ns), agent_ns["INSPIRE_MODEL_FAMILIES"], set()
    for technique in TECHNIQUES + ("Survival Analysis", "Pareto Analysis", "Network Analysis"):
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        seen.add(spec["family"] in families)
        rules = inst._genie_platform_rules(spec)
        assert (mlflow in rules) is (spec["family"] in families), technique
        assert "model_version STRING: the registered model version ('' when nothing is registered)" in rules, technique
    assert seen == {True, False}
    assert mlflow.isascii()


ROUND_45_COARSE_PROBE = r"""
import json
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import FunctionTransformer, OneHotEncoder, StandardScaler
rng = np.random.default_rng(11)
n = 20000
frame = pd.DataFrame({"prior_order_count": rng.integers(1, 9, n),
                      "c_preferred_cust_flag": rng.choice(["Y", "N", None], n),
                      "hd_buy_potential": rng.choice(["0-500", "501-1000", "1001-5000", "5001-10000", ">10000", "Unknown", None], n),
                      "days_since_last_order": rng.integers(0, 700, n)})
y = (frame["days_since_last_order"] + rng.normal(0, 120, n) > 365).astype(int)
cat = ["c_preferred_cust_flag", "hd_buy_potential"]
def distinct(num, log):
    steps = [("impute", SimpleImputer(strategy="constant", fill_value=0))] + ([("log", FunctionTransformer(np.log1p))] if log else [("scale", StandardScaler())])
    prep = ColumnTransformer([("num", Pipeline(steps), num),
                              ("cat", Pipeline([("impute", SimpleImputer(strategy="constant", fill_value="__missing__")),
                                                ("onehot", OneHotEncoder(handle_unknown="ignore"))]), cat)])
    model = Pipeline([("prep", prep), ("model", LogisticRegression(class_weight="balanced", max_iter=1000))]).fit(frame[num + cat], y)
    return int(pd.Series(model.predict_proba(frame[num + cat])[:, 1]).round(12).nunique())
print(json.dumps({"n": n, "counts_and_categories": distinct(["prior_order_count"], True),
                  "with_days": distinct(["prior_order_count", "days_since_last_order"], False)}))
"""


def test_round_45_every_model_reads_a_feature_that_takes_many_values(agent_ns):
    rule = agent_ns["GENIE_FEATURE_COLUMNS_RULE"]
    assert ("which is no result of their own. That feature takes many values across the rows, such as a number of days or an "
            "amount, and is added when every feature a build step lists is a category or a small count, such as one-hot "
            "segments and a log of the prior order count: such a model gives each combination of their values one score, so "
            "hundreds of rows share each score and its rank.") in rule, \
        ("round 45: the lapse notebook's baseline read a log of prior_order_count and one-hot c_preferred_cust_flag and "
         "hd_buy_potential, the candidate failed acceptance, and the baseline gave 27,298 customers 123 distinct risk scores, "
         "222 customers per score")
    done = subprocess.run([sys.executable, "-c", ROUND_45_COARSE_PROBE], capture_output=True, text=True, timeout=300)
    assert done.returncode == 0, done.stderr[-2000:]
    out = json.loads(done.stdout)
    assert out["counts_and_categories"] <= 8 * 3 * 7 and out["counts_and_categories"] * 50 < out["n"], \
        "a model of a small count and two categories gives one score to each combination of their values"
    assert out["with_days"] * 50 >= out["n"], "a feature that takes many values gives the rows their own scores"
    inst, families, seen = build_inspire(agent_ns), agent_ns["INSPIRE_MODEL_FAMILIES"], set()
    for technique in TECHNIQUES + ("Survival Analysis", "Pareto Analysis", "Network Analysis"):
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        seen.add(spec["family"] in families)
        assert (rule in inst._genie_platform_rules(spec)) is (spec["family"] in families), technique
    assert seen == {True, False}
    assert rule.isascii()


def test_round_46_a_pyfunc_wrapper_subclasses_python_model(agent_ns):
    mlflow = agent_ns["GENIE_MLFLOW_RULE"]
    assert ("A pyfunc wrapper subclasses `mlflow.pyfunc.PythonModel`, `class Wrapper(mlflow.pyfunc.PythonModel)` with `import "
            "mlflow` among the notebook's imports, and defines `predict(self, context, model_input)`: MLflow 2 rejects an "
            "instance of a plain class with a predict method ('`python_model` must be a PythonModel instance').") in mlflow, \
        ("round 46: the freight notebook imported mlflow only inside register(), defined `class CarrierModel:` with a predict "
         "method and no base class, and its third run stopped at log_model with \"MlflowException: `python_model` must be a "
         "PythonModel instance, callable object, or path to a script\"")
    assert (mlflow.index("set_registered_model_alias") < mlflow.index("A pyfunc wrapper subclasses")
            < mlflow.index("Write that version as `model_version`"))
    python_model = type("PythonModel", (), {})

    def validate(model):
        if not (isinstance(model, python_model) or callable(model)):
            raise ValueError("`python_model` must be a PythonModel instance, callable object, or path to a script")

    plain = type("CarrierModel", (), {"predict": lambda self, context, model_input: model_input})
    wrapper = type("Wrapper", (python_model,), {"predict": lambda self, context, model_input: model_input})
    with pytest.raises(ValueError, match="must be a PythonModel instance"):
        validate(plain())
    validate(wrapper())
    tree = ast.parse("class Wrapper(mlflow.pyfunc.PythonModel):\n    def predict(self, context, model_input):\n        return model_input\n")
    assert ast.unparse(tree.body[0].bases[0]) == "mlflow.pyfunc.PythonModel"
    assert [a.arg for a in tree.body[0].body[0].args.args] == ["self", "context", "model_input"]
    inst, families, seen = build_inspire(agent_ns), agent_ns["INSPIRE_MODEL_FAMILIES"], set()
    for technique in TECHNIQUES + ("Survival Analysis", "Pareto Analysis", "Network Analysis"):
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        seen.add(spec["family"] in families)
        assert (mlflow in inst._genie_platform_rules(spec)) is (spec["family"] in families), technique
    assert seen == {True, False}
    assert mlflow.isascii()


ROUND_47_BINNED_PROBE = r"""
import json
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import OneHotEncoder, StandardScaler
rng = np.random.default_rng(47)
n = 27298
days = rng.integers(0, 700, n).astype(float)
count = rng.integers(1, 9, n).astype(float)
y = (days + rng.normal(0, 120, n) > 365).astype(int)
def quantile_bins(values, k=5):
    return np.digitize(values, np.unique(np.quantile(values, np.linspace(0, 1, k + 1))[1:-1]))
binned = OneHotEncoder(handle_unknown="ignore").fit_transform(np.column_stack([quantile_bins(days), quantile_bins(count)])).toarray()
both = np.hstack([StandardScaler().fit_transform(np.column_stack([days, np.log1p(count)])), binned])
coarse = LogisticRegression(max_iter=1000).fit(binned, y).predict_proba(binned)[:, 1]
fine = LogisticRegression(max_iter=1000).fit(both, y).predict_proba(both)[:, 1]
near = days >= np.quantile(days, 0.8)
def distinct(scores):
    return int(pd.Series(scores).round(12).nunique())
print(json.dumps({"n": n, "near": int(near.sum()), "binned": distinct(coarse), "binned_near": distinct(coarse[near]),
                  "numbers_and_bins": distinct(fine), "numbers_and_bins_near": distinct(fine[near])}))
"""


def test_round_47_a_binned_feature_still_enters_the_model_as_its_number(agent_ns):
    rule = agent_ns["GENIE_MODEL_FEATURE_RULE"]
    assert ("each score and its rank. The model reads that feature as its number, scaled or logged, also when a build step "
            "bins it to name each row's driver, which its coefficient times the row's scaled value gives: quantile bins of "
            "it are categories too, so a model that reads only bins, categories and small counts gives every row of one "
            "combination of bins one score.") in rule, \
        ("round 47: the lapse notebook's instruction binned days_since_prior_order and prior_order_count into n_bins training "
         "quantiles, one-hot encoded, for the baseline and the candidate, and the model gave 27,298 customers 3 distinct scores")
    assert rule.startswith("Every model, the baseline among them, reads at least one feature that every row it scores has, ")
    assert agent_ns["GENIE_FEATURE_COLUMNS_RULE"].endswith("'Cannot setitem on a Categorical with a new category'. " + rule)
    done = subprocess.run([sys.executable, "-c", ROUND_47_BINNED_PROBE], capture_output=True, text=True, timeout=300)
    assert done.returncode == 0, done.stderr[-2000:]
    out = json.loads(done.stdout)
    assert out["binned"] <= 5 * 5 and out["binned_near"] <= 5, \
        "a model of quantile bins gives every row of one combination of bins one score"
    assert out["numbers_and_bins"] * 50 >= out["n"] and out["numbers_and_bins_near"] * 50 >= out["near"], \
        "the same bins next to the number give the rows their own scores"
    writer = agent_ns["PROMPT_TEMPLATES"]["USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT"]
    assert "- No deep learning (no TensorFlow, PyTorch, or Keras).{model_feature_rule}\n- The role of `ai_query`" in writer
    families, seen = agent_ns["INSPIRE_MODEL_FAMILIES"], set()
    inst = build_inspire(agent_ns)
    for technique in TECHNIQUES + ("Survival Analysis", "Pareto Analysis", "Network Analysis"):
        family = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))["family"]
        seen.add(family in families)
        agent = FakeAgent([long_instruction(f"Use `{ORDERS}.amount`.")])
        build_inspire(agent_ns, loader=FakeLoader(), agent=agent)._generate_genie_instruction_for_use_case(
            make_uc(**{"Analytics Technique": technique}), [], "")
        rendered = writer.format(**agent.calls[0]["vars"])
        reads = family in families
        assert (("Keras).\n- " + rule + "\n- The role of `ai_query`") in rendered) is reads, \
            f"{technique}: the instruction writer reads the platform rule's sentence, so its build steps never bin the only many-valued feature"
        if not reads:
            assert "- No deep learning (no TensorFlow, PyTorch, or Keras).\n- The role of `ai_query`" in rendered, technique
    assert seen == {True, False}
    assert rule.isascii()


def test_round_47_library_calls_match_the_pinned_versions(agent_ns):
    template = agent_ns["GENIE_PINNED_API_RULE"]
    assert ("Serverless environment 4 ships {pins}, the versions its release notes list, and the notebook installs nothing: "
            "call each library as that version defines it, never with an argument, a function or "
            "a default that a later release added, such as `KBinsDiscretizer(quantile_method=...)`, which scikit-learn added "
            "in 1.7, so an earlier release stops it with \"__init__() got an unexpected keyword argument "
            "'quantile_method'\".") == template, \
        ("round 47: the lapse notebook pinned scikit-learn==1.6.1 and called KBinsDiscretizer(..., quantile_method=...), and its "
         "test run stopped with \"TypeError: KBinsDiscretizer.__init__() got an unexpected keyword argument 'quantile_method'\"")
    assert re.findall(r"\{[^}]*\}", template) == ["{pins}"]

    class KBinsDiscretizer:
        def __init__(self, n_bins=5, *, encode="onehot", strategy="quantile", dtype=None, subsample=200000, random_state=None):
            self.n_bins = n_bins

    with pytest.raises(TypeError, match="unexpected keyword argument 'quantile_method'"):
        KBinsDiscretizer(n_bins=5, encode="onehot-dense", strategy="quantile", quantile_method="averaged_inverted_cdf")
    assert KBinsDiscretizer(n_bins=5, encode="onehot-dense", strategy="quantile").n_bins == 5
    versions, packages = agent_ns["GENIE_ENV_PACKAGE_VERSIONS"], agent_ns["GENIE_FAMILY_PACKAGES"]
    inst, seen = build_inspire(agent_ns), set()
    for technique in TECHNIQUES + ("Survival Analysis", "Pareto Analysis", "Network Analysis"):
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        pins = [f"{name}=={versions[name]}" for name in packages[spec["family"]]]
        seen.add(bool(pins))
        rules, mandate = inst._genie_platform_rules(spec), inst._build_code_structure_mandate(spec)
        if pins:
            assert template.format(pins=", ".join(pins)) in rules, technique
            assert f"which already ships {', '.join(pins)}; the notebook installs nothing." in mandate, \
                f"{technique}: the rule names the same versions as the Environment line"
        else:
            assert "ships {pins}" not in rules and "already ships every library this use case needs; the notebook installs nothing." \
                in mandate, technique
            assert template.split("{pins}")[0] not in rules, technique
    assert seen == {True, False}
    assert template.isascii()


def unnamed_struct_fields(code):
    return [ast.unparse(arg) for node in ast.walk(ast.parse(code))
            if isinstance(node, ast.Call) and ast.unparse(node.func) == "F.struct"
            for arg in node.args
            if not (isinstance(arg, ast.Call) and isinstance(arg.func, ast.Attribute) and arg.func.attr == "alias")]


def test_round_47_every_field_of_a_struct_in_an_array_is_named(agent_ns):
    rule = agent_ns["GENIE_SQL_NESTING_RULE"]
    assert ("Name every field of a struct that goes into an array, a `when` or a union with another struct, "
            "`F.struct(F.lit('after as_of_date').alias('check'), condition.alias('failed'))`: Spark names an unnamed field after "
            "its expression, so structs built from different expressions are different types, and `F.array` of them stops with "
            "DATATYPE_MISMATCH.DATA_DIFF_TYPES.") in rule, \
        ("round 47: the freight notebook built F.array of F.struct(F.lit('after as_of_date'), (cond).cast(...)) and "
         "F.struct(F.lit('bill equals ship'), (cond).cast(...)), and its test run stopped with [DATATYPE_MISMATCH.DATA_DIFF_TYPES]; "
         "on the SQL warehouse array(named_struct('after as_of_date', true), named_struct('bill equals ship', false)) fails "
         "the same way and array(named_struct('check', 'after as_of_date', 'failed', true), named_struct('check', "
         "'bill equals ship', 'failed', false)) succeeds")
    failed = ("F.array(F.struct(F.lit('after as_of_date'), (F.col('d_date') >= F.lit(as_of)).cast('int')), "
              "F.struct(F.lit('bill equals ship'), (F.col('sender_sk') == F.col('recipient_sk')).cast('int')))")
    assert len(unnamed_struct_fields(failed)) == 4
    example = re.search(r"`(F\.struct\(.*?\))`:", rule).group(1)
    assert unnamed_struct_fields(example) == []
    assert unnamed_struct_fields("F.array(" + example + ", " + example.replace("after as_of_date", "bill equals ship") + ")") == []
    assert_in_every_notebook(agent_ns, rule)
    assert rule.isascii()


def test_round_48_a_frame_joined_to_a_frame_built_from_it_renames_its_key_first(agent_ns):
    join = agent_ns["GENIE_JOIN_RULE"]
    sentence = ("rename the columns of a frame joined to itself or to a frame built from it, such as its aggregate or a cross join "
                "of its distinct keys, first: `anchors_sdf['customer_sk'] == orders_sdf['customer_sk']`, where `anchors_sdf` was "
                "built from `orders_sdf`, stops with AMBIGUOUS_COLUMN_REFERENCE.")
    assert sentence in join, \
        ("round 48: the lapse notebook joined entities.crossJoin(snapshots), entities = orders.select('customer_sk').distinct(), "
         "back to orders on anchors['customer_sk'] == orders['customer_sk'] and two test runs stopped with "
         "[AMBIGUOUS_COLUMN_REFERENCE]; serverless probe run 1234567890000030 gave the same error for that join and "
         "ran it once the key was renamed first, once both sides were aliased and on a frame not built from orders")
    for code in re.findall(r"`([^`]+)`", sentence):
        ast.parse(code)
    assert_in_every_notebook(agent_ns, join)


def test_round_48_inf_is_replaced_after_the_last_step_that_derives_a_feature(agent_ns):
    import numpy as np
    import pandas as pd

    types = agent_ns["GENIE_DECIMAL_RULE"]
    assert ("in pandas, dividing by zero or the log of 0 gives inf, so replace inf with NaN after the last step that derives a "
            "feature and before a fit, a score or the write, in the numeric columns only") in types, \
        ("round 48: the freight notebook replaced inf when it loaded its rows, then derived "
         "log_lane_peer_ratio = np.log(lane_peer_ratio), and its fit stopped with 'Input X contains infinity'")
    ratio = pd.DataFrame({"cost": [2.0, 0.0, 3.0], "peer": [1.0, 2.0, 0.0]})
    num = ratio.select_dtypes("number").columns
    early = ratio.copy()
    early[num] = early[num].replace([np.inf, -np.inf], np.nan)
    with np.errstate(divide="ignore"):
        early["log_ratio"] = np.log(early["cost"] / early["peer"])
    assert np.isinf(early["log_ratio"]).sum() == 2, "a replace before the derived feature leaves its inf"
    late = early.copy()
    num = late.select_dtypes("number").columns
    late[num] = late[num].replace([np.inf, -np.inf], np.nan)
    assert not np.isinf(late.select_dtypes("number").to_numpy()).any()
    assert_in_every_notebook(agent_ns, types)


def _basket_precision(baskets, scorer, removed, top_k=3):
    hits = 0
    for basket in baskets:
        seeds, truth = basket[:-1], basket[-1]
        dropped = set(removed(seeds, basket))
        ranked = [item for item in scorer(seeds, truth) if item not in dropped][:top_k]
        hits += int(truth in ranked)
    return hits, hits / (len(baskets) * top_k)


def test_round_49_the_candidate_and_the_baseline_are_scored_alike_and_an_oracle_checks_the_evaluation(agent_ns):
    parity = agent_ns["GENIE_EVALUATION_PARITY_RULE"]
    assert ("a ranking leaves out only the items the case gives the model, such as the basket's other items, never the "
            "held-out item") in parity, \
        ("round 49: the cross-sell notebook removed every item of the basket, the held-out one too, from the candidate's "
         "list and only the other items from the popularity baseline's, so the candidate scored a precision@10 of 0.0 on "
         "5,000 holdout orders against 0.00012 and every run wrote 8,000 Monitor rows with 'No approved model yet'")
    assert ("Score every candidate and the baseline with one evaluation function that takes the model's scorer as an "
            "argument, on the same holdout cases with the same inputs and the same exclusions") in parity
    assert ("`run_use_case()` asserts that an oracle scorer, one that returns each case's held-out answer, gets the best "
            "score the metric allows on that function, a hit on every case, a perfect AUC or a zero MASE") in parity
    assert "Print each model's hits or errors beside its rate, and the number of cases." in parity
    for code in re.findall(r"`([^`]+)`", parity):
        ast.parse(code)
    assert parity.isascii()
    recommender = agent_ns["TECHNIQUE_IMPLEMENTATION_GUIDANCE"]["Recommendation"]
    assert ("exclude items the entity already has, which in a holdout case are the items the case gives the model, never "
            "the held-out item it must find") in recommender

    baskets = [[1, 2, 3], [2, 4, 5], [1, 3, 6], [4, 5, 7]]
    oracle = lambda seeds, truth: [truth]
    popular = lambda seeds, truth: [1, 2, 3, 4, 5, 6, 7]
    whole_basket = lambda seeds, basket: basket
    seeds_only = lambda seeds, basket: seeds
    assert _basket_precision(baskets, oracle, whole_basket) == (0, 0.0), \
        "removing the whole basket hides the held-out item even from an oracle, so the oracle assertion stops that run"
    assert _basket_precision(baskets, oracle, seeds_only)[0] == len(baskets), "removing only the seeds lets the oracle hit every case"
    assert _basket_precision(baskets, popular, whole_basket)[0] == 0
    assert _basket_precision(baskets, popular, seeds_only)[0] == 2, "the same scorer finds held-out items once only the seeds are removed"

    inst = build_inspire(agent_ns)
    families = agent_ns["GENIE_HOLDOUT_FAMILIES"]
    assert set(families) == {"A", "D", "E"} and set(families) <= set(agent_ns["GENIE_FAMILY_SPECS"])
    seen = {True: set(), False: set()}
    for technique in TECHNIQUES + ("Classification", "Pareto Analysis", "Network Analysis"):
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        held_out = spec["family"] in families
        seen[held_out].add(spec["family"])
        assert inst._genie_platform_rules(spec).count(parity) == (1 if held_out else 0), technique
    assert seen[True] == set(families), "every family that compares models on held-out answers gets the rule"
    assert {"B", "C"} <= seen[False], "anomaly and segment notebooks, which have no held-out answer, do not"


def test_round_49_no_platform_rule_reads_as_an_unsupported_numeric_claim(agent_ns):
    inspire = agent_ns["DatabricksInspire"]
    assert inspire._find_unsupported_numeric_claims("a hit on every case, an AUC of 1 or a MASE of 0") != [], \
        ("round 49: the first wording of the evaluation rule said 'an AUC of 1', which the claim check reads as a promised "
         "metric, so every scoring, recommendation and forecast instruction failed validation after its repair attempt")
    inst = build_inspire(agent_ns)
    families = set()
    for technique in TECHNIQUES + ("Classification", "Pareto Analysis", "Network Analysis"):
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        families.add(spec["family"])
        assert inspire._find_unsupported_numeric_claims(inst._genie_platform_rules(spec)) == [], technique
    assert families == set(agent_ns["GENIE_FAMILY_SPECS"]), "every family's rules are checked"
