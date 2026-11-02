"""v1.3.0 use-case widgets: the Genie instruction's Parameters section names every widget the notebook creates
first, with a default that is never empty. Core widgets come from the use case spec (output table, model,
AI endpoint, tier sizes, forecast horizon and every threshold) and keep the code's defaults; the model may add
up to six use-case widgets."""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v120_genie_support import FakeAgent, FakeLoader, build_inspire, long_instruction, make_uc

ROW = re.compile(r"^\| `([a-z0-9_]+)` \| (text|dropdown) \| (.+?) \| (.+) \|$", re.M)


def spec_for(agent_ns, technique):
    inst = build_inspire(agent_ns, inspire_database="cat._inspire")
    return inst, inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))


def widgets_in(text):
    return {m.group(1): re.sub(r"^`([^`]*)`$", r"\1", m.group(3)) for m in ROW.finditer(text)}


def test_core_widgets_carry_the_spec_defaults_for_each_execution_pattern(agent_ns):
    inst, spec = spec_for(agent_ns, "Predictive Modeling")
    core = {w["name"]: w["default"] for w in inst._genie_core_widgets(spec)}
    assert spec["family"] == "A"
    assert core["result_table"] == ".".join(agent_ns["inspire_table_parts"](spec["result_table"])) and core["model_name"] == spec["model_name"]
    assert core["ai_endpoint"] == spec["ai_endpoint"] and core["act_now_share"] == "0.05" and core["review_share"] == "0.2"
    assert "explanation_top_k" not in core, "Inspire picks the records it explains, so Genie gets no widget for it"
    assert all(core[key] == str(value) for key, value in spec["thresholds"].items())
    assert "horizon" not in core, "only forecasts get a horizon widget"
    inst, spec = spec_for(agent_ns, "Forecasting")
    assert spec["family"] == "E" and spec["horizon"] is None and spec["season_length"] is None, "make_uc records no cadence"
    core = {w["name"]: w["default"] for w in inst._genie_core_widgets(spec)}
    assert core["horizon"] == "" and core["season_length"] == "", "an unknown cadence leaves the default open, never 'None'"
    known = {w["name"]: w["default"] for w in inst._genie_core_widgets(dict(spec, horizon=8, season_length=52))}
    assert known["horizon"] == "8" and known["season_length"] == "52"
    assert "model_name" not in core, "a forecast registers no model"


def test_every_threshold_of_every_pattern_has_a_widget_label(agent_ns):
    labels = agent_ns["GENIE_WIDGET_LABELS"]
    keys = {key for thresholds in agent_ns["GENIE_READINESS_THRESHOLDS"].values() for key in thresholds}
    assert keys - set(labels) == set(), "a threshold without a label would fail when its widget is built"
    assert all(label and not re.search(r"\d", label) for label in labels.values()), "labels carry no numbers"


def test_the_contract_restores_core_defaults_keeps_good_use_case_widgets_and_drops_the_rest(agent_ns):
    inst, spec = spec_for(agent_ns, "Predictive Modeling")
    table = ("| widget | type | default | used for |\n|---|---|---|---|\n"
             f"| `min_auc` | text | `0.55` | Minimum AUC |\n"
             "| `lookback_months` | text | `24` | Months of history used for features |\n"
             "| `as_of_date` | text | latest closed month in `orders.order_date` | The date the scores apply to |\n"
             "| `first_cohort_month` | text | earliest month in `orders.order_date` | First cohort analysed |\n"
             "| `min_orders` | text | | Minimum orders per customer |\n")
    table += "".join(f"| `extra_{i}` | text | `{i}` | Extra {i} |\n" for i in range(6))
    instruction = (f"## 1. Goal\nGoal.\n\n## 2. Data\nData.\n\n## 3. Parameters\nCompute the as-of date first.\n\n{table}\n"
                   "## 4. Readiness Check\nChecks.\n")
    out = inst._apply_genie_instruction_contract("N01-U01", instruction, spec)
    widgets = widgets_in(out)
    assert widgets["min_auc"] == "0.6", "a core default is the code's value, never the model's"
    assert widgets["lookback_months"] == "24" and widgets["first_cohort_month"].startswith("earliest month in")
    assert widgets["as_of_date"] == "latest", "as_of_date is a core widget, so the model cannot change its default"
    assert "min_orders" not in widgets, "a widget without a default is dropped"
    extras = [name for name in widgets if name not in {w["name"] for w in inst._genie_core_widgets(spec)}]
    assert len(extras) == 6 and "extra_3" in widgets and "extra_4" not in widgets, "at most six use-case widgets"
    assert "Compute the as-of date first." in out and out.count("## 3. Parameters") == 1
    assert out.index("## 3. Parameters") < out.index("## 4. Readiness Check")
    assert inst._apply_genie_instruction_contract("N01-U01", out, spec) == out, "applying the contract twice changes nothing"


def test_every_core_widget_default_passes_its_own_range_in_every_pattern(agent_ns):
    inst, spec = spec_for(agent_ns, "Forecasting")
    spec = dict(spec, horizon=8, season_length=52)
    plain = {"result_table", "model_name", "ai_endpoint", "as_of_date", "currency", "flag_segments"}
    for family, thresholds in agent_ns["GENIE_READINESS_THRESHOLDS"].items():
        basis = agent_ns["GENIE_FAMILY_DECISION_BASIS"][family]
        widgets = inst._genie_core_widgets(dict(spec, family=family, decision_basis=basis, thresholds=dict(thresholds)))
        tiers = {w["name"] for w in widgets} & {"act_now_amount", "review_amount", "act_now_share", "review_share"}
        assert tiers == ({"act_now_amount", "review_amount"} if basis == "measured" else {"act_now_share", "review_share"}), family
        left_open = {w["name"] for w in widgets if w["default"] == ""}
        assert left_open == ({"currency", "act_now_amount", "review_amount"} if basis == "measured" else {"currency"}), \
            f"{family}: only the currency and the measured amounts are set by Genie Code from the source data"
        assert [w["allowed"] for w in widgets if w["name"] in left_open - {"currency"}] == (["at least 0"] * 2 if basis == "measured"
                                                                                            else []), family
        numeric = [w for w in widgets if w["name"] not in plain | left_open]
        assert [w["name"] for w in numeric if not w["allowed"]] == [], family
        assert [p for w in numeric for p in [agent_ns["genie_widget_value_problem"](w["name"], w["default"], w["allowed"])] if p] == [], family
        assert agent_ns["genie_widget_set_problems"]({w["name"]: w["default"] for w in widgets}) == [], family
    for name, rule in agent_ns["GENIE_WIDGET_ALLOWED"].items():
        floats = tuple(None if v is None else float(v) for v in rule[:2]) + (rule[2], False, False)
        assert agent_ns["genie_allowed_rule"](agent_ns["genie_allowed_text"](rule)) == floats, name


def test_the_parameters_table_carries_each_widget_s_allowed_range(agent_ns):
    inst, spec = spec_for(agent_ns, "Predictive Modeling")
    table = ("| widget | type | default | allowed | used for |\n|---|---|---|---|---|\n"
             "| `min_auc` | text | `0.6` | any | Minimum AUC |\n"
             "| `lookback_months` | text | `24` | whole number, 1 to 120 | Months of history used for features |\n"
             "| `top_share` | text | `0.3` | 0 to 1.0 | Share of rows shown |\n"
             "| `max_rows` | text | `5000` | whole number, 1 to 100 | Rows kept |\n"
             "| `window_days` | text | `30` | a few weeks | Days in the window |\n"
             "| `segment` | dropdown | `all` | 1 to 5 | Segment shown |\n")
    out = inst._apply_genie_instruction_contract(
        "N01-U01", f"## 1. Goal\nGoal.\n\n## 3. Parameters\n{table}\n## 4. Readiness Check\nChecks.\n", spec)
    allowed = {w["name"]: w["allowed"] for w in inst._genie_instruction_widgets(out)}
    assert allowed["min_auc"] == "0.5 to 1", "a core widget keeps the code's range, never the model's"
    assert allowed["lookback_months"] == "whole number, 1 to 120" and allowed["top_share"] == "0 to 1"
    assert allowed["max_rows"] == "", "a range that the widget's own default breaks is dropped"
    assert allowed["window_days"] == "" and allowed["segment"] == "", "an unreadable range and a dropdown take any value"
    assert "| `window_days` | text | `30` | any | Days in the window |" in out
    assert "| `lookback_months` | text | `24` | whole number, 1 to 120 | Months of history used for features |" in out
    assert inst._apply_genie_instruction_contract("N01-U01", out, spec) == out
    names = [w["name"] for w in inst._genie_instruction_widgets(out)]
    assert inst._genie_widget_names(out, spec) == names and {"result_table", "lookback_months", "segment"} <= set(names)
    assert "max_rows" in names and len(names) == len(set(names))
    old = inst._genie_instruction_widgets("## Parameters\n| widget | type | default | used for |\n|---|---|---|---|\n"
                                          "| `top_k` | text | `25` | Rows shown |\n")
    assert old == [{"name": "top_k", "type": "text", "default": "25", "allowed": "", "label": "Rows shown"}]


def test_a_default_the_code_leaves_open_is_chosen_in_the_instruction_or_falls_back(agent_ns):
    inst, spec = spec_for(agent_ns, "Forecasting")
    prompt_table = inst._genie_widget_table(inst._genie_core_widgets(spec))
    assert "| `horizon` | text | you choose | whole number, at least 1 | Forecast horizon (periods) |" in prompt_table
    assert "you choose" in agent_ns["PROMPT_TEMPLATES"]["USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT"]
    table = ("| widget | type | default | allowed | used for |\n|---|---|---|---|---|\n"
             "| `horizon` | text | `12` | whole number, at least 1 | Forecast horizon (periods) |\n"
             "| `season_length` | text | you choose | whole number, at least 1 | Season length (periods) |\n")
    instruction = f"## 1. Goal\nGoal.\n\n## 3. Parameters\n{table}\n## 4. Readiness Check\nChecks.\n"
    out = inst._apply_genie_instruction_contract("N01-U07", instruction, spec)
    assert widgets_in(out)["horizon"] == "12", "a valid value written for an open default is kept"
    assert widgets_in(out)["season_length"] == "1", "no usable choice falls back to one period, never 'None'"
    assert "None" not in widgets_in(out).values()
    assert [name for name, value in widgets_in(out).items() if value == "you choose"] == ["currency"], \
        "a default with a fallback is never left open; the currency stays for Genie Code to read from the source amounts"
    assert inst._apply_genie_instruction_contract("N01-U07", out, spec) == out
    for bad in ("0", "2.5", "None", "you choose", "-"):
        again = inst._apply_genie_instruction_contract("N01-U07", instruction.replace("`12`", f"`{bad}`" if bad[0].isdigit() else bad), spec)
        assert widgets_in(again)["horizon"] == "1", bad
    known = inst._apply_genie_instruction_contract("N01-U07", instruction, dict(spec, horizon=8, season_length=52))
    assert widgets_in(known)["horizon"] == "8" and widgets_in(known)["season_length"] == "52", "a code default always wins"


def test_the_prompt_asks_for_the_columns_the_widget_table_renders(agent_ns):
    header = agent_ns["DatabricksInspire"]._genie_widget_table([]).splitlines()[0]
    columns = " | ".join(part.strip() for part in header.strip("|").split("|"))
    assert columns == "widget | type | default | allowed | used for"
    prompt = agent_ns["PROMPT_TEMPLATES"]["USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT"]
    assert f"one table with the columns `{columns}`" in prompt
    assert "one table with the columns `widget | type | default | used for`" not in prompt


def test_a_missing_parameters_section_is_added_before_the_readiness_check(agent_ns):
    inst, spec = spec_for(agent_ns, "Cohort Analysis")
    out = inst._apply_genie_instruction_contract("N01-U11", "## 1. Goal\nGoal.\n\n## 2. Data\nData.\n\n## 3. Readiness Check\nChecks.\n", spec)
    assert out.index("## Parameters") < out.index("## 3. Readiness Check")
    widgets = widgets_in(out)
    assert set(spec["thresholds"]) <= set(widgets) and widgets["result_table"] == ".".join(agent_ns["inspire_table_parts"](spec["result_table"]))
    assert all(value for value in widgets.values()), "every widget has a default"


def test_the_prompt_asks_for_eight_sections_with_parameters_and_the_threshold_lines_name_their_widgets(agent_ns):
    template = agent_ns["PROMPT_TEMPLATES"]["USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT"]
    assert "{widget_table}" in template and "EXACTLY these 8 sections" in template
    for heading in ("## 3. Parameters", "## 4. Readiness Check", "## 5. Build Steps", "## 8. Definition of Done"):
        assert heading in template
    assert "Step 1 creates every widget of section 3" in template
    inst, spec = spec_for(agent_ns, "Anomaly Detection")
    text = inst._genie_threshold_text(spec)
    assert "(widget `min_join_coverage`)" in text and "(widget `min_reference_rows`)" in text
    assert "read from the widget of the same name" in text


def test_a_generated_instruction_always_carries_the_parameters_table(agent_ns):
    agent = FakeAgent([long_instruction("Use `main.sales.orders.amount` from `main.sales.orders`.")])
    inst = build_inspire(agent_ns, loader=FakeLoader(), quality="Good", agent=agent)
    uc = inst._generate_genie_instruction_for_use_case(make_uc(), [], "", schema_index=None)
    assert "| widget | type | default | allowed | used for |" in agent.calls[0]["vars"]["widget_table"]
    assert "| `act_now_share` | text | `0.05` | 0 to 1 | " in agent.calls[0]["vars"]["widget_table"]
    widgets = widgets_in(uc["genie_instruction"])
    assert "result_table" in widgets and "ai_endpoint" in widgets and "explanation_top_k" not in widgets
    assert "## Parameters" in uc["genie_instruction"]


def test_a_cohort_analysis_stops_only_when_too_few_groups_are_large_enough(agent_ns):
    inst, spec = spec_for(agent_ns, "Cohort Analysis")
    text = inst._genie_threshold_text(spec)
    assert "readiness `reportable_groups`" in text and "(widget `min_reportable_groups`)" in text
    assert "smallest" not in text, "one small group never stops the whole analysis"
    assert "groups with fewer than 30 rows are left out of the group findings" in text
    assert spec["thresholds"]["min_reportable_groups"] == 2 and spec["thresholds"]["min_group_rows"] == 30


def test_every_instruction_carries_the_platform_rules_and_model_patterns_carry_the_mlflow_call(agent_ns):
    serverless, mlflow = agent_ns["GENIE_SERVERLESS_RULE"], agent_ns["GENIE_MLFLOW_RULE"]
    for technique, registers in (("Predictive Modeling", True), ("Anomaly Detection", True), ("Forecasting", False),
                                 ("Cohort Analysis", False), ("Optimization", False)):
        inst, spec = spec_for(agent_ns, technique)
        out = inst._apply_genie_instruction_contract("U1", "## 1. Goal\nGoal.\n\n## 4. Readiness Check\nChecks.\n", spec)
        rules = out[out.index("## Platform Rules"):]
        assert serverless in rules and agent_ns["GENIE_DECIMAL_RULE"] in rules
        assert (mlflow in rules) is registers, technique
        assert inst._apply_genie_instruction_contract("U1", out, spec).count("## Platform Rules") == 1
    assert 'artifact_path=\\"model\\"' not in mlflow and 'artifact_path="model"' in mlflow and "never `name=`" in mlflow
    assert "take the new version from the returned model info's `registered_model_version`" in mlflow
    assert "Unity Catalog rejects a `run_id` filter in `search_model_versions`" in mlflow, "a run-id lookup failed in round 11"
    assert serverless in agent_ns["PROMPT_TEMPLATES"]["USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT"]
    assert serverless in agent_ns["GENIE_AGENTS_FILE_TEMPLATE"], "one serverless rule, written once"


def test_the_data_section_says_how_nulls_are_handled(agent_ns):
    template = agent_ns["PROMPT_TEMPLATES"]["USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT"]
    data = template[template.index("## 2. Data"):template.index("## 3. Parameters")]
    assert "how nulls in each signal, rating or outcome column are handled" in data
    assert "never filled with an invented value" in data


def test_a_recommender_fits_on_all_interactions_and_filters_only_when_ranking(agent_ns):
    pattern = agent_ns["GENIE_FAMILY_SPECS"]["D"]["pattern"]
    assert "fits the recommender on all past interactions" in pattern
    assert "apply only when ranking, never before fitting" in pattern


def test_a_recommender_is_never_steered_to_spark_ml_als(agent_ns):
    guidance = agent_ns["TECHNIQUE_IMPLEMENTATION_GUIDANCE"]["Recommendation"]
    assert "Never use Spark ML ALS" in guidance and "UC_COMMAND_NOT_SUPPORTED" in guidance
    assert "limited to 100 MB" not in guidance, "a size limit reads as ALS being usable"
    assert "never build a dense items-by-items or users-by-items matrix" in guidance, "an all-pairs product of every item is too slow"
    assert "score users in batches" in guidance
    guidance_by_technique = agent_ns["TECHNIQUE_IMPLEMENTATION_GUIDANCE"]
    assert "ai_forecast() runs only through a SQL warehouse" in guidance_by_technique["Forecasting"]
    assert "JAR-based graph libraries cannot load" in guidance_by_technique["Network Analysis"]


def test_every_pattern_gets_an_as_of_date_widget_and_forecasts_end_their_grid_at_it(agent_ns):
    for technique in ("Predictive Modeling", "Forecasting", "Cohort Analysis", "Optimization"):
        inst, spec = spec_for(agent_ns, technique)
        assert {w["name"]: w["default"] for w in inst._genie_core_widgets(spec)}["as_of_date"] == "latest"
    template = agent_ns["PROMPT_TEMPLATES"]["USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT"]
    assert "`as_of_date` = `latest` means the last period that is complete in every table" in template
    assert "never past the data" in agent_ns["GENIE_FAMILY_SPECS"]["E"]["pattern"]
    inst, spec = spec_for(agent_ns, "Forecasting")
    assert "raise the max_staleness_cadences widget" in inst._genie_threshold_text(spec)
    assert "never from a scan of the source rows inside it" in agent_ns["GENIE_FAMILY_SPECS"]["H"]["pattern"]


def test_readiness_counts_source_rows_before_features_and_explains_a_failure(agent_ns):
    template = agent_ns["PROMPT_TEMPLATES"]["USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT"]
    readiness = template[template.index("## 4. Readiness Check"):template.index("## 5. Build Steps")]
    assert "before any feature engineering" in readiness
    assert "a missing feature never removes a row from a readiness count" in readiness
    assert "prints how many rows each filter removed" in readiness


def test_latest_is_complete_in_every_source_table_and_no_step_runs_on_an_empty_input(agent_ns):
    template = agent_ns["PROMPT_TEMPLATES"]["USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT"]
    params = template[template.index("## 3. Parameters"):template.index("## 4. Readiness Check")]
    assert "complete in every table the features and the outcome read" in params
    assert "use the earliest of them" in params and "prints each table's newest date" in params
    assert "the last complete period in the data" not in params, "one table's newest date can leave a feature empty"
    readiness = template[template.index("## 4. Readiness Check"):template.index("## 5. Build Steps")]
    assert "counts the rows each fit, holdout and scoring step receives" in readiness
    assert "every source table" in agent_ns["GENIE_WIDGET_LABELS"]["as_of_date"]
    rule = agent_ns["GENIE_EMPTY_INPUT_RULE"]
    assert "never call it on an empty input" in rule and "how many rows each filter and each feature removed" in rule
    for technique in ("Predictive Modeling", "Anomaly Detection", "Clustering", "Recommendation", "Forecasting",
                      "Cohort Analysis", "Sentiment Analysis", "Optimization"):
        inst, spec = spec_for(agent_ns, technique)
        assert rule in inst._genie_platform_rules(spec), technique


def test_widgets_carry_labels_and_a_stopped_run_keeps_every_cell(agent_ns):
    lead = agent_ns["DatabricksInspire"]._GENIE_PARAMETERS_LEAD
    assert "the used-for text as each widget's label" in lead
    template = agent_ns["PROMPT_TEMPLATES"]["USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT"]
    steps = template[template.index("## 5. Build Steps"):template.index("## 6. Method and Acceptance")]
    assert "with the used-for text as the label" in steps
    assert "every step, fully written" in steps and "a stop skips that work but never removes or stubs it" in steps
    done = template[template.index("## 8. Definition of Done"):]
    assert "every step fully written and none stubbed" in done, "a skipped step is still real code"


def test_the_platform_rules_pin_the_output_schema_from_the_core_columns(agent_ns):
    inst, spec = spec_for(agent_ns, "Optimization")
    rules = inst._genie_platform_rules(spec)
    assert "cast every business output column to these types" in rules
    assert "inspire_write_result converts that column's existing values" in rules and "you never rewrite the table" in rules, \
        "an existing table with another type is converted, never followed"
    for name, sql_type in agent_ns["INSPIRE_CORE_COLUMNS"]:
        assert f"{name} {sql_type}" in rules


def test_acceptance_is_exactly_the_code_rule_and_the_baseline_is_reported(agent_ns):
    template = agent_ns["PROMPT_TEMPLATES"]["USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT"]
    method = template[template.index("## 6. Method and Acceptance"):template.index("## 7. Business Output")]
    assert "The acceptance rule is exactly the one under READINESS AND ACCEPTANCE THRESHOLDS: never add a criterion to it." in method
    assert "the comparison decides acceptance only where that rule says so" in method


def test_the_acceptance_stop_rule_fits_each_execution_pattern(agent_ns):
    template = agent_ns["PROMPT_TEMPLATES"]["USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT"]
    assert "{acceptance_stop_rule}" in template and template.count("No approved model yet") == 0
    expected = {"Predictive Modeling": "No approved model yet", "Anomaly Detection": "No approved model yet",
                "Forecasting": "publishes the seasonal naive forecast instead", "Cohort Analysis": "Acceptance never stops this run",
                "Optimization": "No better plan found"}
    for technique, phrase in expected.items():
        inst, spec = spec_for(agent_ns, technique)
        assert phrase in inst._genie_acceptance_stop_rule(spec), technique
    inst, spec = spec_for(agent_ns, "Cohort Analysis")
    threshold = inst._genie_threshold_text(spec)
    assert ("is still written, with the tier its value_at_stake gives, 'not significant' in its top reasons, a confidence_level "
            "that is not 'High' and data_quality_flag 'ok'") in threshold
    assert "with data_quality_flag 'not significant'" not in threshold, "a result is never a data quality flag"
    assert "No approved model yet" not in inst._genie_acceptance_stop_rule(spec), "a pattern without a model never says no model"
