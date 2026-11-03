"""v1.2.0 GENIE-REDESIGN: one technique registry (TECHNIQUE_EXECUTION_FAMILY) maps every guidance key to exactly one
execution family, unknown techniques fall back to family F with a [TECHNIQUE_UNKNOWN] log, TRAIN_INFER_TECHNIQUES is
derived from families A-D, and the guidance is three decision lines per technique instead of MINIMUM BAR clauses
(review GX-6, GX-7, GX-15, GX-19, GX-25, D2, D9, D12)."""
import os
import re
import sys
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _agentload import agent_source

FAMILIES = {
    "A": {"Classification", "Predictive Modeling", "Survival Analysis"},
    "B": {"Anomaly Detection"},
    "C": {"Clustering", "Segmentation"},
    "D": {"Recommendation"},
    "E": {"Forecasting", "Lifetime Value"},
    "F": {"Trend Analysis", "Correlation Analysis", "Pareto Analysis", "Cohort Analysis", "Funnel Analysis", "Regression Analysis",
          "Geospatial Analysis", "Network Analysis", "AI Analysis", "Decomposition", "Peer Benchmarking"},
    "G": {"Sentiment Analysis", "Document Processing", "Extraction"},
    "H": {"Optimization", "Simulation", "Threshold Optimization"},
    "I": {"Causal Impact", "Uplift Modeling", "Marketing Mix Modeling"},
    "J": {"Process Mining", "Sequence Analysis", "Queueing"},
    "K": {"Controls Testing", "Statistical Process Control", "Entity Matching"},
    "L": {"Data Agent"},
}


def test_registry_keys_equal_the_guidance_keys(agent_ns):
    assert set(agent_ns["TECHNIQUE_EXECUTION_FAMILY"]) == set(agent_ns["TECHNIQUE_IMPLEMENTATION_GUIDANCE"])
    assert len(agent_ns["TECHNIQUE_EXECUTION_FAMILY"]) == 36


def test_every_technique_maps_to_the_reviewed_family(agent_ns):
    registry = agent_ns["TECHNIQUE_EXECUTION_FAMILY"]
    by_family = {}
    for technique, family in registry.items():
        by_family.setdefault(family, set()).add(technique)
    assert by_family == FAMILIES


def test_import_time_check_rejects_a_registry_that_drifts_from_the_guidance(fresh_ns):
    fresh_ns["TECHNIQUE_EXECUTION_FAMILY"]["Quantum Divination"] = "F"
    with pytest.raises(ValueError, match="same techniques.*Quantum Divination"):
        fresh_ns["_validate_technique_registry"]()
    del fresh_ns["TECHNIQUE_EXECUTION_FAMILY"]["Quantum Divination"]
    fresh_ns["TECHNIQUE_EXECUTION_FAMILY"]["Forecasting"] = "Z"
    with pytest.raises(ValueError, match="undefined execution family"):
        fresh_ns["_validate_technique_registry"]()


def test_the_registry_check_runs_at_import():
    assert re.search(r"(?m)^_validate_technique_registry\(\)$", agent_source())


def test_forecasting_and_regression_analysis_are_single_run(agent_ns):
    family = agent_ns["_execution_family"]
    assert family("Forecasting") == "E" and family("Regression Analysis") == "F"
    assert "Forecasting" not in agent_ns["TRAIN_INFER_TECHNIQUES"]
    assert "Regression Analysis" not in agent_ns["TRAIN_INFER_TECHNIQUES"]
    assert family("Forecasting") not in agent_ns["INSPIRE_MODEL_FAMILIES"]


def test_train_infer_techniques_are_derived_from_families_a_to_d(agent_ns):
    expected = FAMILIES["A"] | FAMILIES["B"] | FAMILIES["C"] | FAMILIES["D"]
    assert set(agent_ns["TRAIN_INFER_TECHNIQUES"]) == expected
    assert tuple(agent_ns["INSPIRE_MODEL_FAMILIES"]) == ("A", "B", "C", "D")


def test_unknown_technique_runs_as_family_f_with_a_technique_unknown_log(agent_ns):
    logger = MagicMock()
    assert agent_ns["_execution_family"]("Change-Point Detection", logger, "Genie notebook N01-U07") == "F"
    message = logger.warning.call_args[0][0]
    assert "[TECHNIQUE_UNKNOWN]" in message and "Change-Point Detection" in message and "family F" in message
    assert agent_ns["_execution_family"]("  classification ", MagicMock()) == "A"
    quiet = MagicMock()
    agent_ns["_execution_family"]("Survival Analysis", quiet)
    quiet.warning.assert_not_called()


@pytest.mark.parametrize("technique", sorted({t for ts in FAMILIES.values() for t in ts}))
def test_guidance_is_method_plus_three_decision_lines(agent_ns, technique):
    text = agent_ns["TECHNIQUE_IMPLEMENTATION_GUIDANCE"][technique]
    lines = text.split("\n")
    assert [ln.split(":")[0] for ln in lines] == ["Method", "Baseline", "Accept", "If data is insufficient"]
    assert "MINIMUM BAR" not in text and "is a FAILURE" not in text and "MANDATE" not in text


def test_guidance_fixes_the_reviewed_method_errors(agent_ns):
    g = agent_ns["TECHNIQUE_IMPLEMENTATION_GUIDANCE"]
    for key in ("Clustering", "Segmentation"):
        assert "DBSCAN" not in g[key] and "ierarchical" not in g[key]
        assert "K-Means" in g[key] and "assign new entities" in g[key]
    assert "seasonal naive" in g["Forecasting"] and "SQL warehouse" in g["Forecasting"] and "never register per-series" in g["Forecasting"]
    assert "seed" in g["Simulation"] and "default_rng" in g["Simulation"]
    assert "milp" in g["Optimization"]
    assert all("GraphFrames" not in text for text in g.values())
    assert "JAR" in g["Network Analysis"]
    for key in ("Sentiment Analysis", "Document Processing", "Extraction"):
        assert "core method" in g[key] and "failOnError => false" in g[key]
    for key in ("Classification", "Predictive Modeling", "Survival Analysis"):
        assert "time-aware split" in g[key]
    assert "Never use Spark ML ALS" in g["Recommendation"] and "truncated SVD" in g["Recommendation"]


def test_thresholds_cover_every_family_and_every_rule(agent_ns):
    thresholds = agent_ns["GENIE_READINESS_THRESHOLDS"]
    rules = agent_ns["INSPIRE_READINESS_RULES"]
    assert set(thresholds) == set(FAMILIES)
    for family, table in thresholds.items():
        for _name, _key, op, th_key, _msg in rules["common"] + rules[family]:
            if op != "is_true":
                assert (th_key == "min_entities_per_k*k" and "min_entities_per_k" in table) or th_key in table, (family, th_key)
    assert thresholds["A"]["min_auc"] == 0.60 and thresholds["A"]["min_pr_auc_lift"] == 1.5 and thresholds["A"]["min_auc_gain"] == 0.02
    assert thresholds["A"]["min_positives"] == 200 and thresholds["A"]["min_class_rate"] == 0.005 and thresholds["A"]["max_class_rate"] == 0.95
    assert thresholds["A"]["min_join_coverage"] == 0.80 and thresholds["A"]["min_outcome_windows"] == 2
    assert not any({"retrain_days", "max_psi"} & set(table) for table in thresholds.values())
    assert thresholds["B"]["min_reference_rows"] == 1000 and thresholds["B"]["max_key_signal_null_rate"] == 0.20 and thresholds["B"]["min_topk_stability"] == 0.6
    assert thresholds["C"]["min_silhouette"] == 0.15 and thresholds["C"]["min_segment_share"] == 0.03 and thresholds["C"]["min_bootstrap_ari"] == 0.6
    assert thresholds["C"]["min_entities_per_k"] == 10 and thresholds["C"]["min_numeric_features"] == 3
    assert thresholds["D"]["min_precision_lift"] == 1.1 and thresholds["D"]["min_interactions"] == 1000
    assert thresholds["E"]["max_mase"] == 1.0 and thresholds["E"]["min_seasonal_cycles"] == 2 and thresholds["E"]["min_backtest_folds"] == 3
    assert thresholds["F"]["min_group_rows"] == 30 and thresholds["G"]["max_ai_error_rate"] == 0.02 and thresholds["G"]["min_text_non_null_rate"] == 0.50
    assert thresholds["H"]["min_simulation_draws"] == 1000


def test_notebook_environment_and_package_pins_come_from_one_constant(agent_ns):
    assert agent_ns["GENIE_NOTEBOOK_ENV_VERSION"] == "4"
    pins = agent_ns["GENIE_ENV_PACKAGE_VERSIONS"]
    assert pins == {"scikit-learn": "1.6.1", "statsmodels": "0.14.4", "scipy": "1.15.1"}
    assert agent_ns["GENIE_FAMILY_PACKAGES"]["A"] and agent_ns["GENIE_FAMILY_PACKAGES"]["E"]
    for name in ("xgboost", "lightgbm", "prophet"):
        assert all(name not in packages for packages in agent_ns["GENIE_FAMILY_PACKAGES"].values())
    src = agent_source()
    assert src.count('"environment_version": "4"') == 0
