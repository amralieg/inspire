"""v1.4.0 kinds lane K3, WP2 2e: the four gate relaxations apply to their kinds only. Each has a must-keep case and a
must-reject case, the kind is read from `Use Case Kind` first and from the technique when that field is empty."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v120_gate_recalibration_test import CATEGORY, SCHEMA, U, make  # noqa: E402

OPT_TABLES = "main.shop.order_items, main.shop.products"


def _q3(agent_ns, *ucs):
    kept, dropped = make(agent_ns)._phaseQ3_validate_relevance(list(ucs), SCHEMA)
    return {uc["No"]: uc for uc in kept}, {uc["No"]: reason for uc, reason in dropped}


def _opt(no, solution, tech="Optimization", **extra):
    return U(no, "Reorder Quantity Plan", tech, OPT_TABLES, solution,
             hld="Linear program over `quantity` and `unit_price` per `product_id` with scipy milp.", **extra)


def test_the_kind_is_read_from_the_use_case_kind_field_first_then_from_the_technique(agent_ns):
    kind = agent_ns["inspire_use_case_kind"]
    assert not hasattr(agent_ns["DatabricksInspire"], "_gate_use_case_kind"), "the gates read the one shared kind helper"
    assert kind({"Use Case Kind": "pricing", "Analytics Technique": "Regression Analysis"})["id"] == "pricing"
    assert kind({"Use Case Kind": "", "Analytics Technique": "Regression Analysis"})["id"] == "driver_breakdown"
    assert kind({"Use Case Kind": "no_such_kind", "Analytics Technique": "Entity Matching"})["id"] == "entity_matching"
    assert kind({"Analytics Technique": "Quantum Divination"}) is None


def test_r9_keeps_an_optimization_whose_assumed_input_is_a_named_setting(agent_ns):
    kept, dropped = _q3(agent_ns, _opt(
        "N09-U01", "Choose the reorder `quantity` per `product_id` that maximizes margin from `unit_price` and an assumed cost "
                   "per unit, the setting `unit_cost` the buyer edits in the App."))
    assert dropped == {} and kept["N09-U01"]["gate_flags"] == ["Q3_R9_ASSUMPTION_SETTING:unit_cost"]


def test_r9_still_drops_an_optimization_whose_assumed_input_is_not_a_setting(agent_ns):
    kept, dropped = _q3(agent_ns, _opt(
        "N09-U02", "Choose the reorder `quantity` per `product_id` that maximizes margin from `unit_price` and an assumed cost "
                   "per unit."))
    assert kept == {} and dropped["N09-U02"] == "Q3_R9_SIMULATED_INPUT:assumed_cost"


def test_r9_drops_when_only_one_of_two_assumed_inputs_is_a_setting(agent_ns):
    kept, dropped = _q3(agent_ns, _opt(
        "N09-U03", "Choose the reorder `quantity` per `product_id` from `unit_price` and an assumed cost per unit, the setting "
                   "`unit_cost`. Cap it by an assumed capacity per store."))
    assert kept == {} and dropped["N09-U03"] == "Q3_R9_SIMULATED_INPUT:assumed_cost"


def test_r9_never_relaxes_for_a_kind_outside_optimization_threshold_and_scenario(agent_ns):
    kept, dropped = _q3(agent_ns, U(
        "N09-U04", "Unprofitable Order Watch", "Classification", "main.shop.orders, main.shop.order_items",
        "Combine `quantity` and `unit_price` with an assumed cost per unit, the setting `unit_cost`, to label unprofitable "
        "`order_id` rows."))
    assert kept == {} and dropped["N09-U04"] == "Q3_R9_SIMULATED_INPUT:assumed_cost"


def test_r9_reads_the_kind_field_for_a_scenario_kind(agent_ns):
    uc = _opt("N09-U05", "Estimate demand response to `unit_price` per `product_id` and size margin under an assumed price, "
                         "the setting `test_price`.", tech="Regression Analysis", **{"Use Case Kind": "driver_scenarios"})
    kept, dropped = _q3(agent_ns, uc)
    assert dropped == {} and kept["N09-U05"]["gate_flags"] == ["Q3_R9_ASSUMPTION_SETTING:test_price"]
    uc = _opt("N09-U06", uc["Solution"], tech="Regression Analysis")
    kept, dropped = _q3(agent_ns, uc)
    assert kept == {} and dropped["N09-U06"] == "Q3_R9_SIMULATED_INPUT:assumed_price"


def _tables_inst(agent_ns):
    inst = make(agent_ns)
    inst.global_table_names = {k for k, v in CATEGORY.items() if v != "TECHNICAL"}
    return inst


def test_reference_only_tables_are_kept_for_entity_matching_and_rejected_otherwise(agent_ns):
    inst = _tables_inst(agent_ns)
    rows = [{"No": "N10-U01", "Name": "Currency Code Merge", "Analytics Technique": "Entity Matching",
             "Tables Involved": "main.shop.fx_rates"},
            {"No": "N10-U02", "Name": "Currency Rate Outlook", "Analytics Technique": "Forecasting",
             "Tables Involved": "main.shop.fx_rates"},
            {"No": "N10-U03", "Name": "Currency Code Merge", "Analytics Technique": "Forecasting", "Use Case Kind": "entity_matching",
             "Tables Involved": "main.shop.fx_rates"},
            {"No": "N10-U04", "Name": "Currency Code Merge", "Analytics Technique": "Entity Matching", "Use Case Kind": "forecast",
             "Tables Involved": "main.shop.fx_rates"}]
    _valid, dropped, kept = inst._validate_use_case_tables(rows, SCHEMA, "[Batch K3]")
    assert [r["No"] for r in kept] == ["N10-U01", "N10-U03"]
    assert [(r["No"], r["hallucination_reason"]) for r in dropped] == [("N10-U02", "Reference-only use case"),
                                                                       ("N10-U04", "Reference-only use case")]


def _explainer(no, solution, kind="variance_to_plan", tech="Decomposition", beneficiary="Regional Sales Director"):
    return U(no, "Measure Store Sales Against Plan", tech, "main.shop.orders, main.shop.stores", solution,
             Beneficiary=beneficiary, **({"Use Case Kind": kind} if kind else {}))


def test_r15_keeps_a_variance_explainer_that_names_owner_tolerance_and_action(agent_ns):
    uc = _explainer("N11-U01", "Bridge `total_amount` per `store_id` from plan to actual into price, volume and mix; every store "
                               "more than the 5% tolerance off plan goes to the regional director's action list with its "
                               "largest driver.")
    kept, dropped = make(agent_ns)._phaseQ5_decision_readiness([uc], SCHEMA)
    assert dropped == [] and not kept[0].get("decision_verb_flag")


def test_r15_still_flags_an_explainer_without_a_tolerance_or_an_action(agent_ns):
    no_tolerance = _explainer("N11-U02", "Bridge `total_amount` per `store_id` from plan to actual into price, volume and mix "
                                         "and send each store to the regional director's action list.")
    no_action = _explainer("N11-U03", "Bridge `total_amount` per `store_id` from plan to actual into price, volume and mix "
                                      "beyond a 5% tolerance.")
    no_owner = _explainer("N11-U04", no_tolerance["Solution"] + " Stores beyond the 5% tolerance come first.", beneficiary="")
    no_owner["Sponsor"] = ""
    kept, dropped = make(agent_ns)._phaseQ5_decision_readiness([no_tolerance, no_action, no_owner], SCHEMA)
    assert [uc.get("decision_verb_flag") for uc in (no_tolerance, no_action, no_owner)] == [True, True, True]
    assert [uc["No"] for uc in kept] == ["N11-U02", "N11-U03"] and [(uc["No"], r) for uc, r in dropped] == [("N11-U04", "Q5_T4_NO_OWNER")]


def test_r15_relaxes_only_the_two_explainer_kinds(agent_ns):
    solution = ("Bridge `total_amount` per `store_id` from plan to actual; every store beyond the 5% tolerance goes to the "
                "regional director's action list.")
    other_kind = _explainer("N11-U05", solution, kind="leading_indicators", tech="Trend Analysis")
    from_technique = _explainer("N11-U06", solution, kind=None, tech="Decomposition")
    kept, _dropped = make(agent_ns)._phaseQ5_decision_readiness([other_kind, from_technique], SCHEMA)
    assert kept[0].get("decision_verb_flag") is True and not kept[1].get("decision_verb_flag")


def test_d14_names_genie_and_model_serving_for_a_data_agent(agent_ns):
    rules = agent_ns["QUALITY_GATE_RULES"]
    assert "for a data agent, a Genie room and Model Serving" in rules.split("**D14 - ENGINEERING TEST**", 1)[1].split("**D15", 1)[0]
    bob = agent_ns["PROMPT_TEMPLATES"]["BEST_OF_BEST_SCORING_PROMPT"]
    assert "D14 Engineering Test: (production engineer) deployable on existing Databricks capabilities (for a data agent: a Genie " \
           "room and Model Serving)?" in bob


def test_the_generation_prompt_states_each_relaxation_for_its_kind_only(agent_ns):
    prompt = agent_ns["PROMPT_TEMPLATES"]["BASE_USE_CASE_GEN_PROMPT"]
    assert "Exception: `Entity Matching` (kind `entity_matching`) may center on master and reference tables" in prompt
    assert "(kinds `variance_to_plan` and `driver_breakdown`)" in prompt
    assert "names the owner who acts, the tolerance that triggers action, and the action" in prompt
    assert "only as a named setting the owner edits in the App" in prompt
    registry = {kind["id"] for kind in agent_ns["_inspire_kinds"]()["kinds"]}
    cls = agent_ns["DatabricksInspire"]
    assert set(cls._KIND_REFERENCE_CENTERED) | set(cls._KIND_EXPLAINERS) <= registry
    families = {family["id"] for family in agent_ns["_inspire_kinds"]()["families"]}
    assert set(cls._KIND_SETTING_ASSUMPTION_FAMILIES) <= families
