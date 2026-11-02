"""v1.2.0 ELITE lane: deterministic metadata verification of an elite assessment.

`_verify_elite_evidence(uc, assessment, evidence)` checks the judge's citations against the
metadata evidence `DataLoader.get_metadata_evidence` returns (full column lists, types, comments,
primary and foreign keys) and the shared `_find_join_path`. It never reads row data. Each rejection
class has a must-exclude case, and complete evidence has a must-include case.
"""
import copy
import logging
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import load_agent_namespace  # noqa: E402


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def col(name, dtype, comment=""):
    return {"name": name, "type": dtype, "comment": comment, "nullable": True, "tags": {}}


EVIDENCE = {
    "c.s.orders": {
        "comment": "One row per order", "table_type": "MANAGED", "tags": {}, "last_altered": None,
        "columns": {c["name"].lower(): c for c in (
            col("order_id", "BIGINT", "Order key"), col("customer_id", "BIGINT"), col("amount", "DECIMAL(10,2)", "Order value"),
            col("status", "STRING"), col("ordered_at", "TIMESTAMP", "Order time"), col("shipped_at", "TIMESTAMP"),
            col("order_day_text", "STRING"), col("is_returned", "BOOLEAN"), col("channel", "STRING"))},
        "primary_key": ["order_id"],
        "foreign_keys": [{"column": "customer_id", "ref_table": "c.s.customers", "ref_column": "customer_id",
                          "source": "declared", "confidence": 1.0}],
    },
    "c.s.customers": {
        "comment": "", "table_type": "MANAGED", "tags": {"pii": "true"}, "last_altered": None,
        "columns": {c["name"].lower(): c for c in (
            col("customer_id", "BIGINT", "Customer key"), col("segment", "STRING"), col("signup_date", "DATE"))},
        "primary_key": ["customer_id"], "foreign_keys": [],
    },
    "c.s.regions": {
        "comment": "", "table_type": "MANAGED", "tags": {}, "last_altered": None,
        "columns": {c["name"].lower(): c for c in (col("region_name", "STRING"), col("manager_email", "STRING"))},
        "primary_key": [], "foreign_keys": [],
    },
}


def inspire(ns, connected=True):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = logging.getLogger("v120_elite_verify")
    obj.join_calls = []

    def join(tables):
        obj.join_calls.append(list(tables))
        return {"connected": connected, "path": ["c.s.orders.customer_id -> c.s.customers.customer_id"] if connected else [],
                "strength": "declared" if connected else "none"}

    obj._find_join_path = join
    return obj


def uc(tech="Forecasting", tables="c.s.orders, c.s.customers"):
    return {"No": "U1", "Name": "Forecast weekly customer orders", "Analytics Technique": tech, "Tables Involved": tables}


def good(**over):
    a = {"signal_columns": ["c.s.orders.amount", "c.s.orders.ordered_at"],
         "time_column": "c.s.orders.ordered_at", "entity_key_column": "c.s.customers.customer_id",
         "outcome_definition": None,
         "join_path": ["c.s.orders.customer_id = c.s.customers.customer_id"],
         "value_driver": "Falling `c.s.orders.amount` per `c.s.customers.customer_id` triggers the weekly call"}
    a.update(over)
    return a


def verify(obj, use_case, a, evidence=None):
    return obj._verify_elite_evidence(use_case, a, copy.deepcopy(EVIDENCE if evidence is None else evidence))


# ---------------------------------------------------------------- must include


def test_complete_evidence_passes(ns):
    obj = inspire(ns)
    v = verify(obj, uc(), good())
    assert v["passed"] is True and v["failures"] == []
    assert v["join_strength"] == "declared" and obj.join_calls == [["c.s.orders", "c.s.customers"]]
    assert v["cited_columns"] == 4 and v["documented_columns"] == 3 and v["comment_coverage"] == 0.75
    assert v["documented_tables"] == 1 and v["tables"] == 2


def test_partial_and_backticked_names_resolve_against_the_use_case_tables(ns):
    a = good(signal_columns=["`orders`.`amount`", "ordered_at"], time_column="s.orders.ordered_at",
             entity_key_column="CUSTOMERS.CUSTOMER_ID", value_driver="`amount` per `customers` moves the KPI",
             outcome_definition={"column": None, "derived_from": ["orders.status"], "rule": "status is late"})
    v = verify(inspire(ns), uc(), a)
    assert v["passed"] is True
    assert v["canonical_columns"] == {
        "signal_columns": ["c.s.orders.amount", "c.s.orders.ordered_at"], "time_column": "c.s.orders.ordered_at",
        "entity_key_column": "c.s.customers.customer_id", "runtime_assumptions": [], "time_via_join": None,
        "outcome_definition": {"column": None, "derived_from": ["c.s.orders.status"], "rule": "status is late"}}


def test_verified_assessment_is_canonicalized_and_a_failed_one_is_left_as_cited(ns):
    obj = inspire(ns)
    a = good(signal_columns=["orders.amount", "orders.ordered_at"], entity_key_column="customers.customer_id")
    v = obj._verify_and_canonicalize_elite(uc(), a, copy.deepcopy(EVIDENCE))
    assert v["passed"] is True and a["verification"] is v
    assert a["signal_columns"] == ["c.s.orders.amount", "c.s.orders.ordered_at"]
    assert a["entity_key_column"] == "c.s.customers.customer_id"
    bad = good(signal_columns=["orders.amount", "orders.nope"])
    obj._verify_and_canonicalize_elite(uc(), bad, copy.deepcopy(EVIDENCE))
    assert bad["verification"]["passed"] is False and bad["signal_columns"] == ["orders.amount", "orders.nope"]


def test_single_table_use_case_needs_no_join_path(ns):
    obj = inspire(ns, connected=False)
    a = good(entity_key_column="c.s.orders.order_id", join_path=[],
             value_driver="Rising `c.s.orders.amount` per `c.s.orders.order_id` drives the KPI")
    v = verify(obj, uc(tables="c.s.orders"), a)
    assert v["passed"] is True and obj.join_calls == []


def test_supervised_outcome_derived_from_existing_columns_passes(ns):
    a = good(outcome_definition={"column": None, "derived_from": ["c.s.orders.status"], "rule": "status is cancelled"})
    assert verify(inspire(ns), uc(tech="Classification"), a)["passed"] is True


def test_supervised_outcome_column_that_exists_passes(ns):
    a = good(outcome_definition={"column": "c.s.orders.is_returned", "derived_from": [], "rule": ""})
    assert verify(inspire(ns), uc(tech="Predictive Modeling"), a)["passed"] is True


def test_duration_between_two_dates_is_a_numeric_measure(ns):
    a = good(signal_columns=["c.s.orders.ordered_at", "c.s.orders.shipped_at"],
             value_driver="The gap between `c.s.orders.ordered_at` and `c.s.orders.shipped_at` per `c.s.customers.customer_id`")
    assert verify(inspire(ns), uc(), a)["passed"] is True


def test_boolean_flag_is_a_numeric_measure(ns):
    a = good(signal_columns=["c.s.orders.is_returned", "c.s.orders.ordered_at"],
             value_driver="The share of `c.s.orders.is_returned` per `c.s.customers.customer_id` falls")
    assert verify(inspire(ns), uc(), a)["passed"] is True


def test_rate_of_a_condition_through_an_outcome_definition_is_a_measure(ns):
    a = good(signal_columns=["c.s.orders.status", "c.s.orders.ordered_at"],
             outcome_definition={"column": None, "derived_from": ["c.s.orders.status"], "rule": "status is late"},
             value_driver="The rate of late `c.s.orders.status` per `c.s.customers.customer_id` falls")
    assert verify(inspire(ns), uc(tech="Trend Analysis"), a)["passed"] is True


# ---------------------------------------------------------------- must exclude


def failures_of(ns, use_case, a, evidence=None, connected=True):
    v = verify(inspire(ns, connected=connected), use_case, a, evidence)
    assert v["passed"] is False
    return " | ".join(v["failures"])


def test_missing_column_rejects(ns):
    text = failures_of(ns, uc(), good(signal_columns=["c.s.orders.amount", "c.s.orders.discount_pct"]))
    assert "signal column not found in the use case's tables: c.s.orders.discount_pct" in text


def test_column_of_a_table_outside_the_use_case_rejects(ns):
    text = failures_of(ns, uc(), good(signal_columns=["c.s.orders.amount", "c.s.regions.region_name"]))
    assert "c.s.regions.region_name" in text


def test_cited_table_missing_from_the_metadata_rejects(ns):
    text = failures_of(ns, uc(tables="c.s.orders, c.s.customers, c.s.ghost"), good())
    assert "table not found in the metadata: c.s.ghost" in text


def test_wrong_time_column_type_rejects(ns):
    text = failures_of(ns, uc(), good(time_column="c.s.orders.order_day_text",
                                      signal_columns=["c.s.orders.amount", "c.s.orders.order_day_text"]))
    assert "time column c.s.orders.order_day_text is STRING, not DATE or TIMESTAMP" in text


@pytest.mark.parametrize("tech", ["Forecasting", "Trend Analysis", "Cohort Analysis", "Survival Analysis"])
def test_temporal_technique_without_a_time_column_rejects(ns, tech):
    text = failures_of(ns, uc(tech=tech), good(time_column=None))
    assert "needs a DATE or TIMESTAMP time column" in text


def test_no_join_path_rejects(ns):
    text = failures_of(ns, uc(), good(), connected=False)
    assert "no join path connects the cited tables: c.s.orders, c.s.customers" in text


@pytest.mark.parametrize("tech", ["Classification", "Predictive Modeling", "Survival Analysis"])
def test_supervised_without_an_outcome_rejects(ns, tech):
    text = failures_of(ns, uc(tech=tech), good(outcome_definition=None))
    assert "needs an outcome column that exists or an outcome derived from existing columns" in text


def test_supervised_outcome_from_a_missing_column_rejects(ns):
    a = good(outcome_definition={"column": None, "derived_from": ["c.s.orders.churned"], "rule": "churned is true"})
    text = failures_of(ns, uc(tech="Classification"), a)
    assert "outcome source column not found" in text and "needs an outcome column" in text


def test_supervised_outcome_without_a_rule_rejects(ns):
    a = good(outcome_definition={"column": None, "derived_from": ["c.s.orders.status"], "rule": ""})
    assert "needs an outcome column" in failures_of(ns, uc(tech="Classification"), a)


def test_entity_key_that_is_not_a_key_rejects(ns):
    text = failures_of(ns, uc(), good(entity_key_column="c.s.customers.segment"))
    assert "entity key column c.s.customers.segment is not a primary, foreign or key-like column" in text


def test_missing_entity_key_rejects(ns):
    assert "no entity key column is cited" in failures_of(ns, uc(), good(entity_key_column=None))


def test_kpi_without_a_numeric_measure_rejects(ns):
    a = good(signal_columns=["c.s.orders.channel", "c.s.orders.ordered_at"],
             value_driver="A better `c.s.orders.channel` mix per `c.s.customers.customer_id`")
    assert "the KPI has no numeric measure" in failures_of(ns, uc(), a)


def test_a_numeric_key_is_not_a_measure(ns):
    a = good(signal_columns=["c.s.orders.order_id", "c.s.orders.ordered_at"],
             value_driver="More `c.s.orders.order_id` per `c.s.customers.customer_id`")
    assert "the KPI has no numeric measure" in failures_of(ns, uc(), a)


def test_value_driver_citing_an_unknown_column_rejects(ns):
    text = failures_of(ns, uc(), good(value_driver="`c.s.orders.amount` and `margin_pct` move the KPI"))
    assert "value driver cites an unknown column: margin_pct" in text


def test_value_driver_citing_no_column_rejects(ns):
    assert "value driver cites no existing column" in failures_of(ns, uc(), good(value_driver="Revenue goes up"))


def test_no_signal_column_rejects(ns):
    assert "no signal column is cited" in failures_of(ns, uc(), good(signal_columns=[]))


def test_join_path_citing_a_missing_column_rejects(ns):
    text = failures_of(ns, uc(), good(join_path=["c.s.orders.cust_ref = c.s.customers.customer_id"]))
    assert "join column not found in the use case's tables: c.s.orders.cust_ref" in text


def test_ambiguous_bare_column_rejects(ns):
    text = failures_of(ns, uc(), good(entity_key_column="customer_id"))
    assert "entity_key_column column is ambiguous" in text


def test_volume_source_has_no_metadata_and_rejects(ns):
    text = failures_of(ns, uc(tables="/Volumes/c/s/docs, c.s.orders"),
                       good(entity_key_column="c.s.orders.order_id", join_path=[],
                            value_driver="`c.s.orders.amount` per `c.s.orders.order_id`"))
    assert "volume source has no table metadata: /Volumes/c/s/docs" in text


def test_no_evidence_at_all_rejects_everything(ns):
    text = failures_of(ns, uc(), good(), evidence={})
    assert "table not found in the metadata: c.s.orders" in text


# ---------------------------------------------------------------- real join-path BFS


class _Storage:
    def __init__(self, rows):
        self.rows = rows

    def load_schema_details(self, name="all_columns_for_sql"):
        return list(self.rows)


class _Loader:
    def __init__(self, relations):
        self.foreign_key_graph = {}
        for rel in relations:
            self.foreign_key_graph.setdefault(tuple(rel[:3]), []).append(tuple(rel))
        self.all_table_tuples = []

    def get_foreign_key_relations(self, tables):
        return [rel for t in tables for rel in self.foreign_key_graph.get(tuple(t), [])]

    def get_table_relations(self, catalog, schema, table):
        return [(rel, "declared", 1.0) for rel in self.foreign_key_graph.get((catalog, schema, table), [])]


def _real_join_inspire(ns, relations):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = logging.getLogger("v120_elite_verify_bfs")
    rows = [("c", "s", t, c["name"], c["type"], c["comment"]) for t, e in
            (("orders", EVIDENCE["c.s.orders"]), ("customers", EVIDENCE["c.s.customers"]),
             ("regions", EVIDENCE["c.s.regions"])) for c in e["columns"].values()]
    obj.storage_manager = _Storage(rows)
    obj.data_loader = _Loader(relations)
    obj.processing_honesty = {}
    return obj


def test_declared_foreign_key_connects_through_the_shared_join_path_bfs(ns):
    obj = _real_join_inspire(ns, [("c", "s", "orders", "customer_id", "c", "s", "customers", "customer_id")])
    v = obj._verify_elite_evidence(uc(), good(), copy.deepcopy(EVIDENCE))
    assert v["passed"] is True and v["join_strength"] == "declared"
    assert v["join_path"] == ["c.s.orders.customer_id -> c.s.customers.customer_id"]


def test_unrelated_tables_fail_the_shared_join_path_bfs(ns):
    obj = _real_join_inspire(ns, [])
    a = good(signal_columns=["c.s.orders.amount", "c.s.orders.ordered_at"], entity_key_column="c.s.orders.order_id",
             join_path=[], value_driver="`c.s.orders.amount` per `c.s.orders.order_id`")
    v = obj._verify_elite_evidence(uc(tables="c.s.orders, c.s.regions"), a, copy.deepcopy(EVIDENCE))
    assert v["passed"] is False and any("no join path" in f for f in v["failures"])


# ---------------------------------------------------------------- evidence summary for the judge


def test_evidence_summary_states_comments_keys_dates_and_measures(ns):
    obj = inspire(ns)
    text = obj._elite_evidence_summary(uc(tables="c.s.orders, c.s.customers, c.s.ghost, /Volumes/c/s/v"),
                                       copy.deepcopy(EVIDENCE))
    orders = [line for line in text.split("\n") if line.startswith("- `c.s.orders`")][0]
    assert "comment: One row per order" in orders and "9 columns, 3 with comments" in orders
    assert "primary key: `order_id`" in orders
    assert "`customer_id` -> `c.s.customers.customer_id` (declared)" in orders
    assert "date/timestamp columns: `ordered_at`, `shipped_at`" in orders
    assert "numeric or boolean non-key columns: `amount`, `is_returned`" in orders
    customers = [line for line in text.split("\n") if line.startswith("- `c.s.customers`")][0]
    assert "no table comment" in customers and "tags: pii=true" in customers
    assert "date/timestamp columns: `signup_date`" in customers
    assert "- `c.s.ghost`: NOT FOUND in the metadata" in text
    assert "volume path, no table metadata" in text


def test_judge_markdown_carries_bob_gate_scores_and_evidence(ns):
    obj = inspire(ns)
    item = dict(uc(), Statement="s", Solution="x", **{"Business Value": "v", "High Level Design": "h",
                                                      "Beneficiary": "Ops lead", "Sponsor": "COO",
                                                      "bob_scores": {f"D{i}": 7 for i in range(19, 0, -1)},
                                                      "bob_score": 7.0})
    text = obj._build_elite_judge_markdown([item], copy.deepcopy(EVIDENCE))
    assert "### Use Case: U1 - Forecast weekly customer orders" in text
    assert "D1=7, D2=7" in text and "D19=7; bob_score 7.0" in text
    assert "**Stated beneficiary / sponsor:** Ops lead / COO" in text
    assert "- `c.s.orders` (MANAGED)" in text
