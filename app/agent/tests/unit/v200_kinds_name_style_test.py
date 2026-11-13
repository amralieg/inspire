"""v1.4.0 kinds lane K3, WP12: the `Name` line says what the owner does, in sentence case, with no deliverable tail, no
technique and no value lever. The `usecase` headline rules stay as they were."""
import hashlib
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v120_artifacts_support import make_inspire, make_uc  # noqa: E402
from v120_gate_recalibration_test import SCHEMA, U, make  # noqa: E402

WIREFRAME_NAMES = (
    "Predict Customer Attrition",
    "Forecast Store Order Demand",
    "Catch Freight Invoice Errors",
    "Set Weekly Store Orders",
    "Test Price Changes",
    "Rebalance Stock Across Warehouses",
    "Staff Store Checkouts",
    "Pick Next Product Offers",
    "Explain Margin Gap",
    "Cut Order-to-Ship Delays",
    "Break Up Return Abuse Rings",
    "Ask Sales Data Anything",
)
OLD_STYLE_NAMES = (
    "Forecast Daily Product Demand with Production Planning Recommendations",
    "Detect Duplicate Claim Submissions with Billing Integrity Review Queue",
)


def _issues(agent_ns, name, technique=""):
    return make(agent_ns)._use_case_name_issues({"Name": name, "Analytics Technique": technique})


@pytest.mark.parametrize("name", WIREFRAME_NAMES)
def test_every_wireframe_name_passes_the_name_check(agent_ns, name):
    assert _issues(agent_ns, name) == []


@pytest.mark.parametrize("name", OLD_STYLE_NAMES)
def test_every_old_style_name_fails_on_its_tail_and_its_length(agent_ns, name):
    codes = {issue.split(":")[0] for issue in _issues(agent_ns, name)}
    assert {"deliverable_tail", "words"} <= codes


@pytest.mark.parametrize("name, code", [
    ("Monitor the overdue invoices most likely to slip", "verb:monitor"),
    ("Churn", "words:1"),
    ("Call the repeat buyers most likely to lapse this month across every store and channel we run", "words:17"),
    ("Call the lapsing repeat buyers to grow revenue this month", "value_lever"),
    ("Set store orders from the Forecasting output every week", "technique:Forecasting"),
    ("Catch freight invoices with Billing Integrity Review Queue items", "deliverable_tail"),
    ("Catch freight Invoices", "case:freight"),
    ("", "missing"),
])
def test_each_name_rule_rejects_its_own_breach(agent_ns, name, code):
    assert code in _issues(agent_ns, name)


def test_the_use_cases_own_technique_counts_even_when_it_is_not_a_registry_label(agent_ns):
    assert "technique:Erlang Staffing" in _issues(agent_ns, "Staff each store with the Erlang staffing model weekly", "Erlang Staffing")


def test_acronyms_and_a_single_proper_noun_keep_title_case(agent_ns):
    assert _issues(agent_ns, "Predict EMEA Account Churn") == []
    assert _issues(agent_ns, "Ask Genie About Store Stock") == []


def _q5(agent_ns, *ucs, instructions=None):
    obj = make(agent_ns)
    if instructions is not None:
        obj.parsed_generation_instructions = instructions
    kept, dropped = obj._phaseQ5_decision_readiness(list(ucs), SCHEMA)
    return obj, {uc["No"]: uc for uc in kept}, dropped


def _uc(no, name):
    return U(no, name, "Predictive Modeling", "main.shop.orders",
             "Train a scikit-learn HistGradientBoostingClassifier on `order_date` and `total_amount` per `customer_id`.")


def test_q5_r20_flags_an_old_style_name_and_never_drops_it(agent_ns, caplog):
    caplog.set_level("INFO")
    _obj, kept, dropped = _q5(agent_ns, _uc("N01-U01", OLD_STYLE_NAMES[0]), _uc("N01-U02", WIREFRAME_NAMES[0]))
    assert dropped == [] and set(kept) == {"N01-U01", "N01-U02"}
    flags = [f for f in kept["N01-U01"].get("gate_flags") or [] if f.startswith("Q5_R25_NAME_STYLE:")]
    assert len(flags) == 1 and "deliverable_tail" in flags[0] and "words:8" in flags[0]
    assert not any(f.startswith("Q5_R20") for f in kept["N01-U02"].get("gate_flags") or [])
    assert any("[NAME-CHECK FIRED] Q5 R25 flagged 1 of 2 names" in r.getMessage() for r in caplog.records)


def test_q5_r20_skips_itself_when_the_user_set_a_naming_rule(agent_ns, caplog):
    caplog.set_level("INFO")
    _obj, kept, _dropped = _q5(agent_ns, _uc("N01-U01", OLD_STYLE_NAMES[0]),
                               instructions={"naming_rules": "Names in Title Case ending with the deliverable"})
    assert not any(f.startswith("Q5_R20") for f in kept["N01-U01"].get("gate_flags") or [])
    assert any("[NAME-CHECK FIRED] Q5 R25 skipped" in r.getMessage() for r in caplog.records)


def test_r15_no_longer_marks_review_as_an_observational_verb(agent_ns):
    _obj, kept, _dropped = _q5(agent_ns, _uc("N01-U01", "Review each supplier in the riskiest spend tier"),
                               _uc("N01-U02", "Monitor each supplier in the riskiest spend tier"))
    assert not kept["N01-U01"].get("decision_verb_flag") and kept["N01-U02"].get("decision_verb_flag") is True


def test_the_genie_target_reads_a_sentence_case_name_as_the_decision(agent_ns):
    target = agent_ns["DatabricksInspire"]._genie_action_target
    assert target({"Name": "Call the repeat buyers most likely to lapse this month"}) == \
        "the decision to call the repeat buyers most likely to lapse this month"
    assert target({"Name": "Detect Pricing Leakage with Pricing Review Queue"}) == "the Pricing Review Queue"
    assert target({"Name": "Forecast Weekly Store Sales"}) == "the Forecast Weekly Store Sales results"
    assert target({"Name": ""}) == "the ranked rows of the business output table"


def test_the_name_carries_no_technique_tail_in_any_language(agent_ns):
    """REQ-175: the technique moved to the subtitle, so the name is the name alone, never "using <technique>"."""
    obj = make(agent_ns)
    label = obj._inspire_name_with_technique
    uc = {"Name": "Predict Customer Churn", "Analytics Technique": "Predictive Modeling"}
    assert label(uc) == "Predict Customer Churn"
    assert label({"Name": "Ask Sales Data Anything", "Analytics Technique": "Data Agent"}) == "Ask Sales Data Anything"
    assert label({"Name": "", "Analytics Technique": "Forecasting"}) == ""
    assert label(uc, {}, "Arabic") == "Predict Customer Churn"


def test_the_shared_use_case_view_shows_the_name_alone_under_the_headline(agent_ns):
    obj = make_inspire(agent_ns)
    t = dict(agent_ns["TranslationService"].ENGLISH_TRANSLATIONS)
    name = "Call the repeat buyers most likely to lapse this month"
    uc = make_uc("N01-U01", Name=name, usecase=name, **{"Analytics Technique": "Predictive Modeling"})
    model = obj._document_model("English", t, {}, {"Sales": [uc]}, "Acme")
    view = obj._use_case_view(model["ranked"][0], model, t)
    assert view["title"].lower() == name.lower(), "the name is the title (Title Case in the document); the technique is in the subtitle"
    assert "Technique: Predictive Modeling." in view["subtitle"]


def test_the_generation_prompt_carries_the_name_rules_and_the_user_wins_line(agent_ns):
    base = agent_ns["PROMPT_TEMPLATES"]["BASE_USE_CASE_GEN_PROMPT"]
    rules = agent_ns["USE_CASE_NAME_RULES"]
    assert rules in base
    assert "the user directive wins without exception" in rules
    assert "A short, clear name that emphasizes BUSINESS VALUE" not in base
    for name in WIREFRAME_NAMES + OLD_STYLE_NAMES:
        for prompt_name, prompt in agent_ns["PROMPT_TEMPLATES"].items():
            assert name not in prompt, (prompt_name, name)


def test_the_example_rows_in_the_prompt_follow_the_name_rules(agent_ns):
    base = agent_ns["PROMPT_TEMPLATES"]["BASE_USE_CASE_GEN_PROMPT"]
    for name in ("Forecast [METRIC] Capacity Need", "Predict [ENTITY] Churn Risk", "Classify [ENTITY] Risk Tiers"):
        assert name in base
        assert _issues(agent_ns, name) == []


def test_a_naming_rule_in_generation_instructions_reaches_the_generation_prompt(agent_ns):
    assert "naming_rules" in agent_ns["GENERATION_DIRECTIVE_CATEGORIES_BY_PROMPT"]["BASE_USE_CASE_GEN_PROMPT"]
    interpreter = agent_ns["PROMPT_TEMPLATES"]["GENERAL_INSTRUCTION_INTERPRETER_PROMPT"]
    assert "Naming Rules" in interpreter and interpreter.count('"naming_rules": ""') == 2


def test_the_headline_rules_are_unchanged(agent_ns):
    base = agent_ns["PROMPT_TEMPLATES"]["BASE_USE_CASE_GEN_PROMPT"]
    block = base[base.index("  - **`usecase`**:"):base.index("  - **`type`**")]
    assert hashlib.sha256(block.encode()).hexdigest() == "f86bd3f62481579d5c59127b27a97cab71cec4a66d7f692807db8f5cb4ca4511"
    assert make(agent_ns)._normalize_usecase("increase basket size to grow revenue", "") == "Increase Basket Size to Grow Revenue"
