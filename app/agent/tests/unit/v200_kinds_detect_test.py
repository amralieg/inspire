"""v1.4.0 use-case kinds: the kind detector and the one column-role labeling call.

`detect_supported_kinds` reads each kind's signature from the registry and checks it on every table together with
the tables its foreign keys point at. Each kind has a tiny schema that must be detected and a near miss that must
not (CLAUDE.md 8.3). The labeling call is one bounded call whose failure keeps the rule-based roles.
"""
import json
import logging
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class Agent:
    def __init__(self, answer=None, error=None):
        self.calls = []
        self.answer = answer
        self.error = error

    def _call_ai_query(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return json.dumps(self.answer) if isinstance(self.answer, dict) else self.answer


def inspire(ns, agent=None):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = logging.getLogger("v200_kinds_detect")
    obj.ai_agent = agent or Agent({"columns": []})
    return obj


def meta(**tables):
    return {f"c.s.{name}": {"columns": {col: {"type": dtype, "comment": ""} for col, dtype in cols.items()}}
            for name, cols in tables.items()}


def graph(*links):
    out = {}
    for child, col, parent in links:
        out.setdefault(f"c.s.{child}", []).append((col, f"c.s.{parent}", "id"))
    return out


def kinds(ns, metadata, fk_graph=None, **kw):
    return {k["kind"]: k for k in inspire(ns).detect_supported_kinds(metadata, fk_graph or {}, log=False, **kw)}


FIXTURES = {
    "forecast": (meta(sales={"sale_date": "DATE", "units": "INT", "store_id": "BIGINT"}),
                 meta(sales={"store_id": "BIGINT", "units": "INT", "store_name": "STRING"}), {}),
    "risk_propensity": (meta(loans={"loan_id": "BIGINT", "customer_id": "BIGINT", "is_default": "BOOLEAN", "opened_date": "DATE"},
                             customers={"customer_id": "BIGINT", "segment": "STRING"}),
                        meta(loans={"loan_id": "BIGINT", "customer_id": "BIGINT", "opened_date": "DATE", "principal_amount": "DOUBLE"},
                             customers={"customer_id": "BIGINT", "segment": "STRING"}),
                        {"pos": [("loans", "customer_id", "customers")], "neg": [("loans", "customer_id", "customers")]}),
    "inventory_replenishment": (meta(inventory={"snapshot_date": "DATE", "on_hand_qty": "INT", "shelf_capacity": "INT"}),
                                meta(inventory={"snapshot_date": "DATE", "on_hand_qty": "INT", "warehouse_id": "BIGINT"}), {}),
    "allocation": (meta(budgets={"region_id": "BIGINT", "seat_capacity": "INT", "spend_amount": "DOUBLE"}),
                   meta(budgets={"region_id": "BIGINT", "spend_amount": "DOUBLE", "spend_date": "DATE"}), {}),
    "driver_scenarios": (meta(pnl={"period_date": "DATE", "revenue": "DOUBLE", "unit_price": "DOUBLE"}),
                         meta(pnl={"period_date": "DATE", "unit_price": "DOUBLE", "region_id": "BIGINT"}), {}),
    "variance_to_plan": (meta(plan={"month_date": "DATE", "budget_amount": "DOUBLE", "actual_amount": "DOUBLE"}),
                         meta(plan={"budget_amount": "DOUBLE", "actual_amount": "DOUBLE", "cost_center_id": "BIGINT"}), {}),
    "anomaly": (meta(meter={"reading_ts": "TIMESTAMP", "kwh_quantity": "DOUBLE", "meter_id": "BIGINT"}),
                meta(meter={"meter_id": "BIGINT", "kwh_quantity": "DOUBLE", "meter_type": "STRING"}), {}),
    "sla_aging": (meta(tickets={"ticket_id": "BIGINT", "opened_at": "TIMESTAMP", "resolved_at": "TIMESTAMP", "status": "STRING"}),
                  meta(tickets={"ticket_id": "BIGINT", "opened_at": "TIMESTAMP", "status": "STRING", "priority": "STRING"}), {}),
    "segmentation": (meta(orders={"order_id": "BIGINT", "customer_id": "BIGINT", "net_amount": "DOUBLE"},
                          customers={"customer_id": "BIGINT", "name": "STRING"}),
                     meta(orders={"order_id": "BIGINT", "customer_id": "BIGINT", "net_amount": "DOUBLE"},
                          customers={"customer_id": "BIGINT", "name": "STRING"}),
                     {"pos": [("orders", "customer_id", "customers")], "neg": []}),
    "process_mining": (meta(events={"case_id": "BIGINT", "activity": "STRING", "event_ts": "TIMESTAMP"}),
                       meta(events={"user_id": "BIGINT", "activity": "STRING", "event_ts": "TIMESTAMP"}), {}),
    "location_intelligence": (meta(stores={"store_id": "BIGINT", "latitude": "DOUBLE", "longitude": "DOUBLE"}),
                              meta(stores={"store_id": "BIGINT", "store_name": "STRING", "opened_date": "DATE"}), {}),
    "fraud_rings": (meta(transfers={"from_account_id": "BIGINT", "to_account_id": "BIGINT", "amount": "DOUBLE"}),
                    meta(transfers={"account_id": "BIGINT", "branch_id": "BIGINT", "amount": "DOUBLE"}), {}),
    "process_control": (meta(readings={"reading_ts": "TIMESTAMP", "upper_limit": "DOUBLE", "defect_count": "INT"}),
                        meta(readings={"reading_ts": "TIMESTAMP", "defect_count": "INT", "line_id": "BIGINT"}), {}),
    "controls_testing": (meta(payments={"approved_by": "STRING", "payment_amount": "DOUBLE", "paid_date": "DATE"}),
                         meta(payments={"payee_id": "BIGINT", "payment_amount": "DOUBLE", "paid_date": "DATE"}), {}),
    "promotion_lift": (meta(sales={"promo_id": "BIGINT", "sale_date": "DATE", "units": "INT"}),
                       meta(sales={"store_id": "BIGINT", "sale_date": "DATE", "units": "INT"}), {}),
}


@pytest.mark.parametrize("kind", sorted(FIXTURES))
def test_each_kind_is_detected_on_its_schema_and_not_on_the_near_miss(agent_ns, kind):
    pos, neg, links = FIXTURES[kind]
    found = kinds(agent_ns, pos, graph(*links.get("pos", [])))
    assert kind in found, sorted(found)
    hit = found[kind]
    assert hit["tables"] and hit["columns"] and 0.5 <= hit["strength"] <= 1.0
    assert hit["signal"] in ("strong", "medium", "weak")
    assert kind not in kinds(agent_ns, neg, graph(*links.get("neg", []))), kind


def test_every_detected_kind_carries_the_registry_fields_and_its_evidence(agent_ns):
    pos = FIXTURES["sla_aging"][0]
    hit = kinds(agent_ns, pos)["sla_aging"]
    registry = {k["id"]: k for k in agent_ns["_inspire_kinds"]()["kinds"]}["sla_aging"]
    assert hit["num"] == registry["num"] and hit["label"] == registry["label"] and hit["layout"] == registry["layout"]
    assert hit["columns"]["event_time"] == ["c.s.tickets.opened_at", "c.s.tickets.resolved_at"]
    assert hit["columns"]["status_activity"] == ["c.s.tickets.status"]
    assert hit["columns"]["case_id"] == ["c.s.tickets.ticket_id"]
    assert hit["tables"] == ["c.s.tickets"]


def test_a_date_dimension_does_not_count_as_two_lifecycle_timestamps(agent_ns):
    metadata = meta(tickets={"ticket_id": "BIGINT", "opened_date_sk": "INT", "status": "STRING"},
                    date_dim={"d_date_sk": "INT", "d_date": "DATE", "d_year": "INT"})
    found = kinds(agent_ns, metadata, graph(("tickets", "opened_date_sk", "date_dim")))
    assert "sla_aging" not in found
    assert "process_mining" in found


def test_a_date_key_and_a_time_key_of_one_moment_are_one_timestamp(agent_ns):
    one = meta(sales={"ss_sold_date_sk": "INT", "ss_sold_time_sk": "INT", "ss_ticket_number": "BIGINT", "order_status": "STRING"})
    assert "sla_aging" not in kinds(agent_ns, one)
    tense = meta(returns={"sr_returned_date_sk": "INT", "sr_return_time_sk": "INT", "sr_ticket_number": "BIGINT",
                          "return_status": "STRING"})
    assert "sla_aging" not in kinds(agent_ns, tense)
    two = meta(sales={"ss_sold_date_sk": "INT", "ss_ship_date_sk": "INT", "ss_ticket_number": "BIGINT", "order_status": "STRING"})
    assert "sla_aging" in kinds(agent_ns, two)


def test_event_row_roles_never_come_from_a_dimension(agent_ns):
    metadata = meta(sales={"ticket_number": "BIGINT", "sold_at": "TIMESTAMP", "customer_id": "BIGINT"},
                    customer={"customer_id": "BIGINT", "is_preferred": "BOOLEAN"})
    found = kinds(agent_ns, metadata, graph(("sales", "customer_id", "customer")))
    assert "process_mining" not in found
    local = meta(sales={"ticket_number": "BIGINT", "sold_at": "TIMESTAMP", "sale_status": "STRING"})
    assert "process_mining" in kinds(agent_ns, local)


def test_evidence_reaches_through_a_foreign_key_but_the_anchor_must_hold_a_signal(agent_ns):
    metadata = meta(sales={"sold_date_sk": "INT", "item_id": "BIGINT", "units": "INT"},
                    item={"item_id": "BIGINT", "list_price": "DOUBLE"})
    found = kinds(agent_ns, metadata, graph(("sales", "item_id", "item")))
    assert found["pricing"]["tables"] == ["c.s.item", "c.s.sales"]
    assert found["pricing"]["anchor"] == "c.s.sales"
    assert found["pricing"]["strength"] < kinds(agent_ns, meta(sales={"sold_date_sk": "INT", "units": "INT",
                                                                      "list_price": "DOUBLE"}))["pricing"]["strength"]
    lonely = kinds(agent_ns, meta(bridge={"a_id": "BIGINT", "b_id": "BIGINT"}, b={"b_id": "BIGINT", "units": "INT"}),
                   graph(("bridge", "b_id", "b")))
    assert all(k["anchor"] != "c.s.bridge" for k in lonely.values())


def test_detection_logs_the_kind_detect_tag(agent_ns, caplog):
    obj = inspire(agent_ns)
    with caplog.at_level(logging.INFO, logger="v200_kinds_detect"):
        found = obj.detect_supported_kinds(FIXTURES["forecast"][0], {})
    line = next(r.getMessage() for r in caplog.records if "[KIND-DETECT FIRED]" in r.getMessage())
    assert line.startswith(f"[KIND-DETECT FIRED] {len(found)} kinds: ") and "forecast(" in line
    with caplog.at_level(logging.INFO, logger="v200_kinds_detect"):
        assert obj.detect_supported_kinds({}, {}) == []
    assert any(r.getMessage() == "[KIND-DETECT FIRED] 0 kinds: none" for r in caplog.records)


def test_one_labeling_call_fills_only_the_ambiguous_columns(agent_ns):
    agent = Agent({"columns": [{"column": "c.s.plants.floor_area", "role": "capacity_limit"},
                               {"column": "c.s.plants.units", "role": "money"},
                               {"column": "c.s.ghost.col", "role": "money"},
                               {"column": "c.s.plants.weight", "role": "teleport"}]})
    obj = inspire(agent_ns, agent)
    metadata = meta(plants={"floor_area": "INT", "weight": "DOUBLE", "units": "INT", "plant_id": "BIGINT"})
    labels = obj._label_ambiguous_column_roles(metadata, {})
    assert len(agent.calls) == 1
    call = agent.calls[0]
    assert call["prompt_name"] == "label_column_roles" and call["response_schema"]["name"] == "column_roles"
    assert "c.s.plants.floor_area | INT" in call["prompt"] and "c.s.plants.units" not in call["prompt"]
    assert "plant_id" not in call["prompt"]
    assert labels == {"c.s.plants": {"floor_area": "capacity_limit"}}
    roles = obj._table_role_signals("c.s.plants", metadata["c.s.plants"], {}, labels)["roles"]
    assert roles["capacity_limit"] == ["floor_area"] and roles["quantity"] == ["units"] and roles["money"] == []


def test_a_failed_labeling_call_keeps_the_rule_based_roles(agent_ns, caplog):
    obj = inspire(agent_ns, Agent(error=RuntimeError("endpoint down")))
    metadata = meta(plants={"floor_area": "INT", "units": "INT", "made_date": "DATE"})
    with caplog.at_level(logging.WARNING, logger="v200_kinds_detect"):
        assert obj._label_ambiguous_column_roles(metadata, {}) == {}
    assert any("the rule-based roles stand" in r.getMessage() for r in caplog.records)
    bad_json = inspire(agent_ns, Agent("not json"))
    assert bad_json._label_ambiguous_column_roles(metadata, {}) == {}
    assert "forecast" in {k["kind"] for k in obj.detect_supported_kinds(metadata, {}, {}, log=False)}


def test_no_ambiguous_column_means_no_call_and_the_list_is_capped(agent_ns):
    agent = Agent({"columns": []})
    obj = inspire(agent_ns, agent)
    assert obj._label_ambiguous_column_roles(meta(t={"units": "INT", "sale_date": "DATE"}), {}) == {}
    assert agent.calls == []
    wide = meta(t={f"m{i}": "DOUBLE" for i in range(obj._ROLE_LABEL_MAX_COLUMNS + 40)})
    obj._label_ambiguous_column_roles(wide, {})
    assert len(agent.calls) == 1
    assert agent.calls[0]["prompt"].count("c.s.t.m") == obj._ROLE_LABEL_MAX_COLUMNS


def test_the_run_step_reads_columns_and_foreign_keys_from_the_loader(agent_ns):
    agent = Agent({"columns": []})
    obj = inspire(agent_ns, agent)
    rel = ("C", "S", "orders", "customer_id", "C", "S", "customers", "customer_id")
    obj.data_loader = type("Loader", (), {"foreign_key_graph": {("C", "S", "orders"): [rel, rel]}})()
    details = [("C", "S", "orders", "order_id", "BIGINT", ""), ("C", "S", "orders", "customer_id", "BIGINT", ""),
               ("C", "S", "orders", "net_amount", "DOUBLE", "order value"), ("C", "S", "customers", "customer_id", "BIGINT", "")]
    found = obj._detect_kinds_for_generation(details)
    assert obj.detected_kinds is found
    assert obj._kind_fk_graph == {"c.s.orders": [("customer_id", "c.s.customers", "customer_id")]}
    assert obj._kind_metadata["c.s.orders"]["columns"]["net_amount"]["comment"] == "order value"
    assert "segmentation" in {k["kind"] for k in found}


def test_the_generation_run_calls_the_detector_after_the_evidence_step(agent_ns):
    from _agentload import agent_source
    text = agent_source()
    evidence = text.index("self._collect_discovery_evidence(business_details)")
    detect = text.index("self._detect_kinds_for_generation(business_details)")
    assert 0 < detect - evidence < 800
