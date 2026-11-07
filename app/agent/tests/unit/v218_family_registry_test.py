import pytest


def _outputs(ns):
    return {tuple(sorted(tokens)): families for tokens, _s, _n, families in ns["DatabricksInspire"]._Q5_EXISTING_OUTPUTS}


def test_event_log_families_come_from_the_registry(agent_ns):
    assert agent_ns["DatabricksInspire"]._EVENT_LOG_FAMILIES == frozenset({"process_mining", "sequence"})
    assert agent_ns["DatabricksInspire"]._GATE_FAMILY_SETS["event_log"] is agent_ns["DatabricksInspire"]._EVENT_LOG_FAMILIES


def test_existing_output_families_keep_their_members(agent_ns):
    outputs = _outputs(agent_ns)
    assert outputs[("band", "bound")] == {"anomaly", "forecasting", "spc"}
    assert outputs[("anomalous", "anomaly", "outlier")] == {"anomaly", "spc"}
    assert outputs[("nearest", "similar", "similarity")] == {"recommendation", "association", "entity_matching", "clustering", "text_topic"}
    assert outputs[("recommendation", "recommended")] == {"recommendation", "association"}
    assert outputs[("cluster",)] == {"clustering", "text_topic"}
    assert outputs[("forecast", "forecasted")] == {"forecasting"}


def test_text_classification_counts_as_a_prediction_output(agent_ns):
    pred = _outputs(agent_ns)[tuple(sorted({"pred", "prediction", "predicted", "prob", "probability", "propensity", "likelihood"}))]
    assert pred == {"forecasting", "classification", "text_classification", "predictive", "regression", "survival",
                    "uplift", "lifetime_value"}


def test_a_label_no_family_carries_fails(agent_ns):
    keys = agent_ns["_technique_family_keys"]
    families = agent_ns["DatabricksInspire"]._TECHNIQUE_FAMILIES
    assert keys(families, ("Process Mining",)) == frozenset({"process_mining"})
    with pytest.raises(ValueError, match="Quantum Divination"):
        keys(families, ("Process Mining", "Quantum Divination"))


def test_an_event_log_technique_outside_the_registry_fails_the_import_check(fresh_ns):
    fresh_ns["EVENT_LOG_TECHNIQUES"] = fresh_ns["EVENT_LOG_TECHNIQUES"] | {"Quantum Divination"}
    with pytest.raises(ValueError, match="Quantum Divination"):
        fresh_ns["_gate_family_sets"](fresh_ns["DatabricksInspire"]._TECHNIQUE_FAMILIES, ("text_topic",))
