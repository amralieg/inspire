"""v1.2.0 GATES lane: the two cross-lane contracts and every gate that consumes them.

`_uc_dedup_signature(uc) -> tuple` is the single duplicate definition shared by G2 name
uniqueness, Q2 canonical dedup and Phase L L9 (E-11, E-15). `_find_join_path(tables) -> dict`
is the BFS join-path check Q3 R4 uses instead of direct FK edges only (E-12); the elite lane
calls it too, so it must be safe without a data loader.

The fake loader runs the REAL `DataLoader._infer_foreign_keys` and records each edge it adds in
`_inferred_fk`, so "declared" vs "inferred" is the provenance the REAL
`DataLoader.get_table_relations` reports at run time.
"""
import ast
import logging
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import load_agent_namespace, method_node  # noqa: E402


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


SCHEMA = [
    ("main", "shop", "orders", "order_id", "BIGINT", ""),
    ("main", "shop", "orders", "customer_id", "BIGINT", ""),
    ("main", "shop", "orders", "store_id", "BIGINT", ""),
    ("main", "shop", "orders", "order_date", "DATE", ""),
    ("main", "shop", "orders", "order_status", "STRING", ""),
    ("main", "shop", "orders", "total_amount", "DECIMAL(12,2)", ""),
    ("main", "shop", "order_items", "order_id", "BIGINT", ""),
    ("main", "shop", "order_items", "parent_order", "BIGINT", ""),
    ("main", "shop", "order_items", "product_id", "BIGINT", ""),
    ("main", "shop", "order_items", "quantity", "INT", ""),
    ("main", "shop", "order_items", "unit_price", "DOUBLE", ""),
    ("main", "shop", "customers", "customer_id", "BIGINT", ""),
    ("main", "shop", "customers", "signup_date", "DATE", ""),
    ("main", "shop", "products", "product_id", "BIGINT", ""),
    ("main", "shop", "products", "category", "STRING", ""),
    ("main", "shop", "stores", "store_id", "BIGINT", ""),
    ("main", "shop", "stores", "region", "STRING", ""),
    ("main", "shop", "web_events", "session_id", "STRING", ""),
    ("main", "shop", "web_events", "event_type", "STRING", ""),
    ("main", "shop", "web_sessions", "session_id", "STRING", ""),
    ("main", "shop", "web_sessions", "device", "STRING", ""),
    ("main", "shop", "weather", "obs_date", "DATE", ""),
    ("main", "shop", "weather", "temperature", "DOUBLE", ""),
    ("main", "shop", "ledger_a", "id", "BIGINT", ""),
    ("main", "shop", "ledger_b", "id", "BIGINT", ""),
]

DECLARED = [
    ("main", "shop", "order_items", "parent_order", "main", "shop", "orders", "order_id"),
    ("main", "shop", "order_items", "product_id", "main", "shop", "products", "product_id"),
]


class FakeStorage:
    def __init__(self, rows):
        self.rows = list(rows)
        self.loads = 0

    def load_schema_details(self, name="all_columns_for_sql"):
        self.loads += 1
        return [tuple(r) for r in self.rows]


class FakeLoader:
    """Declared FKs first, then the production naming inference added on top with its
    provenance recorded in `_inferred_fk`, the record `DataLoader.get_table_relations` reads."""

    def __init__(self, ns, declared, schema):
        self.logger = logging.getLogger("v120_fake_loader")
        self._data_loader_cls = ns["DataLoader"]
        self.primary_keys = {}
        self.foreign_key_graph = {}
        self._inferred_fk = {}
        for rel in declared:
            self.foreign_key_graph.setdefault(tuple(rel[:3]), []).append(tuple(rel))
        for key, scored in self._infer_foreign_keys(list(schema)).items():
            existing = self.foreign_key_graph.setdefault(key, [])
            for rel, confidence in scored:
                if rel not in existing:
                    existing.append(rel)
                    self._inferred_fk[rel] = confidence
        self.all_table_tuples = sorted({tuple(r[:3]) for r in schema})
        self.calls = []

    def __getattr__(self, name):
        cls_attrs = vars(self.__dict__["_data_loader_cls"])
        if name not in cls_attrs:
            raise AttributeError(name)
        attr = cls_attrs[name]
        return attr.__get__(self, type(self)) if hasattr(attr, "__get__") else attr

    def get_foreign_key_relations(self, table_tuples):
        self.calls.append(set(table_tuples))
        out = []
        for t in table_tuples:
            out.extend(self.foreign_key_graph.get(t, []))
        return out


def make(ns, **attrs):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = logging.getLogger("v120_contracts")
    obj.processing_honesty = {}
    obj.data_loader = None
    obj.data_category_map = {}
    obj.global_table_names = set()
    obj.user_business_domains = []
    obj.storage_manager = FakeStorage(SCHEMA)
    for k, v in attrs.items():
        setattr(obj, k, v)
    return obj


def graph_inspire(ns, **attrs):
    return make(ns, data_loader=FakeLoader(ns, DECLARED, SCHEMA), **attrs)


def uc(no, name, tech, tables, statement="", solution="", **extra):
    d = {"No": no, "Name": name, "Analytics Technique": tech, "Tables Involved": tables,
         "Statement": statement or ("Statement for " + name + " with enough words to be complete."),
         "Solution": solution or ("Solution for " + name + " using `order_date` and `quantity`."),
         "Business Value": "Value statement.", "Priority": 0.0}
    d.update(extra)
    return d


class TestDedupSignatureContract:
    def test_contract_exists_with_exact_signature(self, ns):
        node = method_node("DatabricksInspire", "_uc_dedup_signature")
        assert [a.arg for a in node.args.args] == ["self", "uc"]
        assert isinstance(node.returns, ast.Name) and node.returns.id == "tuple"

    def test_synonym_verb_swapped_words_and_technique_variant_collide(self, ns):
        o = make(ns)
        a = uc("N01-U01", "Forecast Weekly Store Demand to Reduce Stockouts", "Forecasting",
               "main.shop.orders, main.shop.order_items, main.shop.stores")
        b = uc("N01-U02", "Predict Store Weekly Demand", "Time-Series Forecasting",
               "`main`.`shop`.`stores`,MAIN.SHOP.order_items , main.shop.orders")
        assert o._uc_dedup_signature(a) == o._uc_dedup_signature(b)

    def test_plural_and_detection_family_variants_collide(self, ns):
        o = make(ns)
        a = uc("N02-U01", "Detect Fraudulent Refunds", "Anomaly Detection", "main.shop.orders")
        b = uc("N02-U02", "Identify Fraudulent Refund", "Isolation Forest", "main.shop.orders")
        assert o._uc_dedup_signature(a) == o._uc_dedup_signature(b)

    def test_nominalized_verb_collides_with_imperative(self, ns):
        o = make(ns)
        a = uc("N03-U01", "Customer Churn Prediction", "Classification", "main.shop.customers")
        b = uc("N03-U02", "Predict Customer Churn", "XGBoost Classification", "main.shop.customers")
        assert o._uc_dedup_signature(a) == o._uc_dedup_signature(b)

    def test_distinct_decisions_on_same_tables_do_not_collide(self, ns):
        o = make(ns)
        boiler = "The business currently lacks a data driven way to decide where to act on customers."
        a = uc("N04-U01", "Predict Customer Churn Risk to Prioritize Outreach", "Classification",
               "main.shop.customers, main.shop.orders", statement=boiler)
        b = uc("N04-U02", "Estimate Customer Lifetime Value to Guide Acquisition", "Regression Analysis",
               "main.shop.customers, main.shop.orders", statement=boiler)
        assert o._uc_dedup_signature(a) != o._uc_dedup_signature(b)

    def test_same_verb_family_different_object_does_not_collide(self, ns):
        o = make(ns)
        a = uc("N04-U03", "Predict Customer Churn", "Classification", "main.shop.customers")
        b = uc("N04-U04", "Predict Customer Upgrade", "Classification", "main.shop.customers")
        assert o._uc_dedup_signature(a) != o._uc_dedup_signature(b)

    def test_same_name_different_tables_do_not_collide(self, ns):
        o = make(ns)
        a = uc("N05-U01", "Simulate Discount Policy", "Simulation", "main.shop.orders")
        b = uc("N05-U02", "Simulate Discount Policy", "Simulation", "main.shop.web_events")
        assert o._uc_dedup_signature(a) != o._uc_dedup_signature(b)

    def test_same_question_different_technique_family_does_not_collide(self, ns):
        o = make(ns)
        a = uc("N06-U01", "Predict Customer Churn", "Classification", "main.shop.customers")
        b = uc("N06-U02", "Predict Customer Churn", "Anomaly Detection", "main.shop.customers")
        assert o._uc_dedup_signature(a) != o._uc_dedup_signature(b)

    def test_same_question_in_the_same_execution_family_collides(self, ns):
        o = make(ns)
        a = uc("N06-U01", "Predict Customer Churn", "Classification", "main.shop.customers")
        b = uc("N06-U02", "Predict Customer Churn", "Survival Analysis", "main.shop.customers")
        assert o._uc_dedup_signature(a) == o._uc_dedup_signature(b)

    def test_signature_is_hashable_and_tolerates_missing_or_non_string_fields(self, ns):
        o = make(ns)
        sig = o._uc_dedup_signature({"No": "X", "Name": None, "Analytics Technique": 7,
                                     "Tables Involved": None, "Statement": None})
        hash(sig)
        assert isinstance(sig, tuple) and len(sig) == 4


class TestSignatureSharedByGates:
    def test_q2_no_longer_merges_distinct_decisions_with_boilerplate_statement(self, ns):
        o = make(ns)
        boiler = "The business currently lacks a data driven way to decide where to act on customers."
        ucs = [uc("N04-U01", "Predict Customer Churn Risk to Prioritize Outreach", "Classification",
                  "main.shop.customers, main.shop.orders", statement=boiler),
               uc("N04-U02", "Estimate Customer Lifetime Value to Guide Acquisition", "Regression Analysis",
                  "main.shop.customers, main.shop.orders", statement=boiler)]
        kept, merged = o._phaseQ2_canonical_dedup(ucs)
        assert [u["No"] for u in kept] == ["N04-U01", "N04-U02"]
        assert merged == []

    def test_q2_merges_true_duplicates_and_keeps_the_better_evidenced_twin(self, ns):
        o = make(ns)
        rich = uc("N01-U09", "Predict Store Weekly Demand", "Time-Series Forecasting",
                  "main.shop.orders, main.shop.stores",
                  solution="Aggregate `quantity` by `store_id` and week of `order_date`; fit Prophet per store.")
        thin = uc("N01-U01", "Forecast Weekly Store Demand to Reduce Stockouts", "Forecasting",
                  "main.shop.stores, main.shop.orders", solution="Forecast demand.")
        kept, merged = o._phaseQ2_canonical_dedup([thin, rich])
        assert [u["No"] for u in kept] == ["N01-U09"]
        assert len(merged) == 1 and merged[0]["dropped"] == "N01-U01" and merged[0]["kept"] == "N01-U09"

    def test_q2_keeps_survivor_order_stable(self, ns):
        o = make(ns)
        ucs = [uc("N09-U01", "Rank Stores by Revenue", "Ranking", "main.shop.stores"),
               uc("N09-U02", "Detect Fraudulent Refunds", "Anomaly Detection", "main.shop.orders"),
               uc("N09-U03", "Identify Fraudulent Refund", "Isolation Forest", "main.shop.orders"),
               uc("N09-U04", "Segment Customers by Value", "Clustering", "main.shop.customers")]
        kept, merged = o._phaseQ2_canonical_dedup(ucs)
        assert [u["No"] for u in kept] == ["N09-U01", "N09-U02", "N09-U04"]
        assert [m["dropped"] for m in merged] == ["N09-U03"]

    def test_g2_name_uniqueness_keeps_same_name_on_different_tables(self, ns):
        o = make(ns)
        ucs = [uc("N05-U01", "Simulate Discount Policy", "Simulation", "main.shop.orders"),
               uc("N05-U02", "Simulate Discount Policy", "Simulation", "main.shop.web_events")]
        kept = o._phaseG_validate_name_uniqueness(ucs)
        assert [u["No"] for u in kept] == ["N05-U01", "N05-U02"]

    def test_g2_name_uniqueness_drops_true_duplicate(self, ns):
        o = make(ns)
        ucs = [uc("N01-U01", "Forecast Weekly Store Demand", "Forecasting", "main.shop.orders"),
               uc("N01-U02", "Predict Store Weekly Demand", "Forecasting", "main.shop.orders")]
        kept = o._phaseG_validate_name_uniqueness(ucs)
        assert len(kept) == 1

    def test_g2_q2_and_l9_all_use_the_shared_signature(self, ns):
        for m in ("_phaseG_validate_name_uniqueness", "_phaseQ2_canonical_dedup", "_phaseL_final_gate"):
            src = ast.unparse(method_node("DatabricksInspire", m))
            assert "_uc_dedup_signature" in src or "_dedup_by_signature" in src, m
        shared = ast.unparse(method_node("DatabricksInspire", "_dedup_by_signature"))
        assert "_uc_dedup_signature" in shared


class TestFindJoinPathContract:
    def test_contract_exists_with_exact_signature(self, ns):
        node = method_node("DatabricksInspire", "_find_join_path")
        assert [a.arg for a in node.args.args] == ["self", "tables"]
        assert isinstance(node.returns, ast.Name) and node.returns.id == "dict"

    def test_non_conventional_declared_edge_is_declared(self, ns):
        o = graph_inspire(ns)
        r = o._find_join_path(["main.shop.order_items", "main.shop.orders"])
        assert r == {"connected": True, "strength": "declared",
                     "path": ["main.shop.order_items.parent_order -> main.shop.orders.order_id"]}

    def test_declared_path_preferred_over_parallel_inferred_edge(self, ns):
        o = graph_inspire(ns)
        r = o._find_join_path(["`main`.`shop`.`ORDERS`", "main.shop.order_items"])
        assert r["strength"] == "declared"
        assert r["path"] == ["main.shop.order_items.parent_order -> main.shop.orders.order_id"]

    def test_declared_fk_reproducible_by_naming_is_reported_as_declared(self, ns):
        o = graph_inspire(ns)
        r = o._find_join_path(["main.shop.order_items", "main.shop.products"])
        assert r["connected"] is True and r["strength"] == "declared"
        assert r["path"] == ["main.shop.order_items.product_id -> main.shop.products.product_id"]

    def test_loader_recorded_inferred_fk_is_reported_as_inferred(self, ns):
        o = graph_inspire(ns)
        r = o._find_join_path(["main.shop.orders", "main.shop.customers"])
        assert r == {"connected": True, "strength": "inferred",
                     "path": ["main.shop.orders.customer_id -> main.shop.customers.customer_id"]}

    def test_relation_without_recorded_provenance_is_never_claimed_declared(self, ns):
        loader = FakeLoader(ns, DECLARED, SCHEMA)
        loader.get_table_relations = lambda *a: []
        o = make(ns, data_loader=loader)
        r = o._find_join_path(["main.shop.order_items", "main.shop.orders"])
        assert r["connected"] is True and r["strength"] == "inferred"

    def test_bfs_through_intermediate_table_not_cited(self, ns):
        o = graph_inspire(ns)
        r = o._find_join_path(["main.shop.order_items", "main.shop.stores"])
        assert r["connected"] is True
        assert r["strength"] == "inferred"
        assert len(r["path"]) == 2
        assert any("main.shop.orders.store_id -> main.shop.stores.store_id" == e for e in r["path"])

    def test_three_table_path_must_reach_every_table(self, ns):
        o = graph_inspire(ns)
        r = o._find_join_path(["main.shop.customers", "main.shop.stores", "main.shop.products"])
        assert r["connected"] is True
        r2 = o._find_join_path(["main.shop.customers", "main.shop.stores", "main.shop.weather"])
        assert r2 == {"connected": False, "path": [], "strength": "none"}

    def test_shared_identifier_column_is_a_weak_edge(self, ns):
        o = graph_inspire(ns)
        r = o._find_join_path(["main.shop.web_events", "main.shop.web_sessions"])
        assert r["connected"] is True and r["strength"] == "shared_column"
        assert r["path"] == ["main.shop.web_events.session_id = main.shop.web_sessions.session_id"]

    def test_generic_id_column_is_not_a_join_edge(self, ns):
        o = graph_inspire(ns)
        r = o._find_join_path(["main.shop.ledger_a", "main.shop.ledger_b"])
        assert r == {"connected": False, "path": [], "strength": "none"}

    def test_unrelated_tables_are_not_connected(self, ns):
        o = graph_inspire(ns)
        r = o._find_join_path(["main.shop.weather", "main.shop.order_items"])
        assert r == {"connected": False, "path": [], "strength": "none"}

    def test_safe_without_data_loader_and_without_schema(self, ns):
        o = make(ns, data_loader=None, storage_manager=None)
        r = o._find_join_path(["main.shop.orders", "main.shop.customers"])
        assert r == {"connected": False, "path": [], "strength": "none"}

    def test_without_data_loader_shared_columns_still_count(self, ns):
        o = make(ns, data_loader=None)
        r = o._find_join_path(["main.shop.web_events", "main.shop.web_sessions"])
        assert r["connected"] is True and r["strength"] == "shared_column"

    def test_single_table_needs_no_join(self, ns):
        o = make(ns, data_loader=None)
        assert o._find_join_path(["main.shop.orders"]) == {"connected": True, "path": [], "strength": "none"}
        assert o._find_join_path([]) == {"connected": True, "path": [], "strength": "none"}

    def test_uses_get_foreign_key_relations_over_the_schema_universe(self, ns):
        o = graph_inspire(ns)
        o._find_join_path(["main.shop.order_items", "main.shop.stores"])
        assert o.data_loader.calls, "BFS must read relations via data_loader.get_foreign_key_relations"
        assert ("main", "shop", "orders") in o.data_loader.calls[-1]

    def test_loader_failure_degrades_to_no_fk_edges(self, ns):
        o = graph_inspire(ns)

        def boom(_tuples):
            raise RuntimeError("metastore unavailable")
        o.data_loader.get_foreign_key_relations = boom
        r = o._find_join_path(["main.shop.web_events", "main.shop.web_sessions"])
        assert r["connected"] is True and r["strength"] == "shared_column"
        via_orders = o._find_join_path(["main.shop.order_items", "main.shop.stores"])
        assert via_orders["strength"] == "shared_column" and len(via_orders["path"]) == 2
        assert o._find_join_path(["main.shop.weather", "main.shop.order_items"])["connected"] is False

    def test_hop_limit_prevents_arbitrarily_long_chains(self, ns):
        chain = []
        rels = []
        for i in range(7):
            chain.append(("c", "s", f"t{i}", f"k{i}_ref_col", "BIGINT", ""))
        for i in range(6):
            rels.append(("c", "s", f"t{i}", f"k{i}_ref_col", "c", "s", f"t{i+1}", f"k{i+1}_ref_col"))
        o = make(ns, storage_manager=FakeStorage(chain), data_loader=FakeLoader(ns, rels, chain))
        assert o._find_join_path(["c.s.t0", "c.s.t4"])["connected"] is True
        assert o._find_join_path(["c.s.t0", "c.s.t5"])["connected"] is False


class TestQ3R4UsesJoinPath:
    def test_r4_keeps_ucs_joined_through_an_intermediate_table(self, ns):
        o = graph_inspire(ns)
        u = uc("N07-U01", "Optimize Store Assortment by Item Velocity", "Optimization",
               "main.shop.order_items, main.shop.stores",
               solution="Rank `product_id` by `quantity` velocity per `store_id` and `region`; solve assortment optimization.")
        kept, dropped = o._phaseQ3_validate_relevance([u], SCHEMA)
        assert [d[1] for d in dropped] == []
        assert kept and kept[0]["No"] == "N07-U01"

    def test_r4_drops_multi_table_uc_with_no_join_path(self, ns):
        o = graph_inspire(ns)
        u = uc("N07-U02", "Forecast Weather Driven Item Demand", "Forecasting",
               "main.shop.weather, main.shop.order_items",
               solution="Join `obs_date` and `temperature` with `quantity` and `unit_price` to forecast demand.")
        kept, dropped = o._phaseQ3_validate_relevance([u], SCHEMA)
        assert kept == []
        assert dropped[0][1].startswith("Q3_R4_JOIN_PATH_UNEXECUTABLE")

    def test_r4_calls_find_join_path_and_no_longer_builds_its_own_adjacency(self, ns):
        src = ast.unparse(method_node("DatabricksInspire", "_phaseQ3_validate_relevance"))
        assert "_find_join_path" in src
        assert "fk_adj" not in src
