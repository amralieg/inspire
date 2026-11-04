"""v1.4.0 rc.4: a negated comparison reads as its opposite, and every kind the data supports reaches the catalog.

1. A KPI name that negates a comparison word (non-positive, not late, no more than, never exceeds) means the
   opposite side, so "non-positive fare" with fare <= 0 is measured and with fare > 0 is refused; the KPI arrow
   and the key-result target read a negated increase or decrease the same way.
2. A kind whose signature needs a dimension also fits a single fact table whose rows group by a region code,
   at a lower strength than a declared foreign key, and the checklist names that column; a table with neither
   still does not offer the kind.
3. After the family floor, each detected kind without a kept use case takes one floor seat under the same bar,
   share and score-gap limits, never with a use case the data minimum refused, never for a kind the data does
   not support or the instructions exclude.
"""
import logging
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _agentload  # noqa: E402
from v120_artifacts_support import make_inspire  # noqa: E402

MISMATCH = "its filter does not match its name: "


def _kpi(name, op, value, column="fare_amount"):
    return {"name": name, "computable": True, "aggregation": "COUNT", "table": "c.s.trips", "column": None,
            "filter_column": column, "filter_op": op, "filter_value": value, "filter_type": "decimal"}


@pytest.mark.parametrize("name,op,value", [
    ("Share of non-positive fare trips", "<=", 0),
    ("Share of non-positive fare trips", "<", 0),
    ("Share of nonpositive fare trips", "<=", 0),
    ("Share of non-negative fare trips", ">=", 0),
    ("Trips whose fare is not positive", "<=", 0),
    ("Orders not late", "<=", 0),
    ("Trips with no more than 5 stops", "<=", 5),
    ("Invoices never exceeding the limit", "<", 100),
    ("Share of positive fare trips", ">", 0),
])
def test_a_negated_comparison_with_its_matching_filter_is_measured(agent_ns, name, op, value):
    assert agent_ns["kpi_comparison_problem"](_kpi(name, op, value)) == ""


@pytest.mark.parametrize("name,op,value,said", [
    ("Share of non-positive fare trips", ">", 0, "non positive"),
    ("Share of non-positive fare trips", "<=", 5, "non positive"),
    ("Share of non-negative fare trips", "<", 0, "non negative"),
    ("Share of non-negative fare trips", ">", -1, "non negative"),
    ("Share of positive fare trips", "<=", 0, "positive"),
    ("Share of negative profit orders", "<=", 0, "negative"),
    ("Orders not late", ">", 0, "not late"),
    ("Invoices never exceeding the limit", ">", 100, "never exceeding"),
])
def test_a_filter_on_the_wrong_side_of_a_negated_comparison_is_refused(agent_ns, name, op, value, said):
    problem = agent_ns["kpi_comparison_problem"](_kpi(name, op, value))
    assert problem.startswith(MISMATCH) and said in problem


def test_the_refusal_names_the_inclusive_bound_of_a_negated_sign(agent_ns):
    problem = agent_ns["kpi_comparison_problem"](_kpi("Share of non-positive fare trips", "<=", 5))
    assert problem.endswith("non positive needs fare_amount <= 0")
    assert agent_ns["kpi_comparison_problem"](_kpi("Share of positive fare trips", ">", -2)).endswith("positive needs fare_amount > 0")


@pytest.mark.parametrize("direction,arrow", [("increase", "↑"), ("decrease", "↓"), ("do not increase", "↓"),
                                             ("non-decreasing", "↑"), ("never reduce", "↑"), ("maintain", "maintain")])
def test_the_kpi_arrow_reads_a_negated_direction_as_its_opposite(agent_ns, direction, arrow):
    assert agent_ns["DatabricksInspire"]._kpi_direction_arrow(direction) == arrow


def test_a_key_result_that_negates_a_cut_raises_the_target(agent_ns):
    target = agent_ns["implement_kpi_target"]
    kpi = {"name": "on-time rate", "direction": ""}
    assert target(kpi, [{"statement": "Do not cut the on-time rate; lift it by 10%"}], 80.0)[0] == 88.0
    assert target(kpi, [{"statement": "Cut the on-time rate gap by 10%"}], 80.0)[0] == 72.0


class _Agent:
    def _call_ai_query(self, **kwargs):
        return '{"columns": []}'


def _detector(ns):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = logging.getLogger("v207")
    obj.ai_agent = _Agent()
    obj.parsed_generation_instructions = {}
    return obj


def _meta(**columns):
    return {"c.s.trips": {"columns": {col: {"type": dtype, "comment": ""} for col, dtype in columns.items()}}}


TRIPS = _meta(pickup_ts="TIMESTAMP", dropoff_ts="TIMESTAMP", fare_amount="DOUBLE", pickup_zip="INT", dropoff_zip="INT")
READINGS = _meta(reading_ts="TIMESTAMP", kwh_quantity="DOUBLE", meter_id="BIGINT")


def test_a_fact_table_grouped_by_a_region_code_offers_segmentation_and_names_the_column(agent_ns):
    obj = _detector(agent_ns)
    found = {k["kind"]: k for k in obj.detect_supported_kinds(TRIPS, {}, log=False)}
    assert "segmentation" in found and "peer_benchmarking" in found
    seg = found["segmentation"]
    assert seg["columns"]["region_code"] == ["c.s.trips.pickup_zip"]
    assert seg["strength"] < 0.8 and seg["strength"] >= 0.5
    obj.detected_kinds = list(found.values())
    obj._kind_metadata = None
    lines = obj._kinds_checklist_lines(None)
    assert "`segmentation`" in lines and "region_code pickup_zip" in lines


def test_a_fact_table_with_no_region_code_and_no_dimension_does_not_offer_segmentation(agent_ns):
    found = {k["kind"] for k in _detector(agent_ns).detect_supported_kinds(READINGS, {}, log=False)}
    assert "segmentation" not in found and "peer_benchmarking" not in found
    assert "forecast" in found


def test_a_declared_dimension_still_outranks_a_region_code(agent_ns):
    metadata = dict(_meta(order_ts="TIMESTAMP", net_amount="DOUBLE", customer_id="BIGINT", ship_zip="INT"),
                    **{"c.s.customers": {"columns": {"customer_id": {"type": "BIGINT", "comment": ""},
                                                     "name": {"type": "STRING", "comment": ""}}}})
    graph = {"c.s.trips": [("customer_id", "c.s.customers", "customer_id")]}
    seg = {k["kind"]: k for k in _detector(agent_ns).detect_supported_kinds(metadata, graph, log=False)}["segmentation"]
    assert seg["strength"] >= 0.8 and "region_code" not in seg["columns"]


REGISTRY = {
    "version": 1,
    "families": [{"id": "predict", "label": "Predict"}, {"id": "run_processes", "label": "Run processes"},
                 {"id": "detect_protect", "label": "Detect and protect"}],
    "layouts": [{"id": "decision_queue", "min_items": {"decision_list": 20}}, {"id": "dashboard", "min_items": {"charts": 2}}],
    "technique_kind": {"Classification": "risk_propensity", "Process Mining": "process_mining"},
    "kinds": [
        {"id": "risk_propensity", "num": 6, "family": "predict", "label": "Risk and propensity", "informational": False,
         "layout": "decision_queue", "techniques": ["Classification"]},
        {"id": "anomaly", "num": 23, "family": "detect_protect", "label": "Anomaly", "informational": False,
         "techniques": ["Anomaly Detection"]},
        {"id": "process_mining", "num": 34, "family": "run_processes", "label": "Process mining", "informational": False,
         "techniques": ["Process Mining"]},
        {"id": "sla_aging", "num": 35, "family": "run_processes", "label": "SLA and aging", "informational": False,
         "techniques": ["Survival Analysis"]},
    ],
}
TECHNIQUE_OF = {"risk_propensity": "Classification", "anomaly": "Anomaly Detection", "process_mining": "Process Mining",
                "sla_aging": "Survival Analysis"}
DETECTED = [{"id": "process_mining", "strength": 0.9}, {"id": "sla_aging", "strength": 0.8}]


@pytest.fixture(scope="module")
def ns():
    namespace = _agentload.fresh_agent_namespace()
    namespace["_inspire_kinds"] = lambda: REGISTRY
    return namespace


@pytest.fixture
def rt(ns, monkeypatch):
    runtime = ns["TECHNICAL_CONTEXT"]["runtime"]
    for key in list(runtime):
        monkeypatch.setitem(runtime, key, runtime[key])
    runtime["technique_max_share"] = 1.0
    return runtime


def _inst(ns, detected=DETECTED, parsed=None):
    inst = make_inspire(ns, parsed_generation_instructions=parsed or {}, user_business_domains=[], detected_kinds=detected)
    inst._kind_floor_reasons = {}
    return inst


def _uc(no, bob, kind="risk_propensity", theme="T1", **extra):
    uc = {"No": no, "Name": f"Use case {no}", "bob_score": bob, "idea_theme": theme, "Use Case Kind": kind,
          "Analytics Technique": TECHNIQUE_OF[kind], "Value": 4.0, "Business Domain": "Sales"}
    uc.update(extra)
    return uc


def _pool(*extra):
    pool = [_uc(f"A{i:02d}", round(9.9 - 0.05 * i, 3)) for i in range(20)]
    pool += [_uc("P0", 9.0, kind="process_mining")] + list(extra)
    return pool + [_uc(f"L{i:02d}", 1.0, theme="T2") for i in range(30)]


def _trim(inst, pool):
    return {uc["No"]: uc for uc in inst._stratified_trim_by_theme(pool, target_max=14, theme_max_share=1.0)}


def test_a_detected_kind_in_a_covered_family_takes_a_kind_floor_seat(ns, rt):
    inst = _inst(ns)
    out = _trim(inst, _pool(_uc("S0", 8.99, kind="sla_aging")))
    assert "P0" in out and "S0" in out and len(out) == 14
    assert out["S0"]["selection_basis"] == "kind_floor"
    assert any("[KIND-FLOOR FIRED]" in msg and "S0" in msg for _lvl, msg in inst.logger.records)


def test_a_use_case_the_data_minimum_refused_never_takes_a_floor_seat(ns, rt):
    refused = _uc("S0", 8.99, kind="sla_aging", data_signal={"status": "no_signal", "reason": "too few cases"})
    out = _trim(_inst(ns), _pool(refused, _uc("S1", 8.985, kind="sla_aging")))
    assert "S0" not in out and out["S1"]["selection_basis"] == "kind_floor"
    out = _trim(_inst(ns), _pool(dict(refused, data_signal={"status": "failed"})))
    assert "S0" not in out


def test_a_kind_the_data_does_not_support_or_the_user_excludes_gets_no_seat(ns, rt):
    out = _trim(_inst(ns), _pool(_uc("N0", 8.99, kind="anomaly")))
    assert "N0" not in out
    parsed = {"use_case_kinds": {"asked": [], "excluded": ["sla_aging"]}}
    out = _trim(_inst(ns, parsed=parsed), _pool(_uc("S0", 8.99, kind="sla_aging")))
    assert "S0" not in out and "P0" in out


def test_a_kind_floor_seat_keeps_the_bar_the_gap_and_the_switch(ns, rt):
    inst = _inst(ns)
    out = _trim(inst, _pool(_uc("S0", 8.99, kind="sla_aging", gate_flags=["Q3_R14"])))
    assert "S0" not in out and "below the near-par bar: flagged" in inst._kind_floor_reasons["sla_aging"]
    inst = _inst(ns)
    out = _trim(inst, _pool(_uc("S0", 1.5, kind="sla_aging")))
    assert "S0" not in out
    rt["kind_floor_seats_per_kind"] = 0
    out = _trim(_inst(ns), _pool(_uc("S0", 8.99, kind="sla_aging")))
    assert "S0" not in out and "P0" in out
