"""v1.4.0 use-case kinds: a dimension borrows the measures of the fact tables that point at it.

In a star schema the site, warehouse, customer or route table holds the signal (coordinates, capacity, a score, an
edge pair) and the fact table that references it holds the money and the quantities. `detect_supported_kinds`
assesses each table with the tables it points at and, through `_kind_join_scopes`, the measures of the tables that
point at it. Kinds that need an event time on the anchor row never borrow: a calendar or a header row is a different
moment than the fact rows it collects. Each case has a schema that must be detected and one that must not (8.3).
"""
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def inspire(ns):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = logging.getLogger("v200_kinds_incoming")
    return obj


def meta(**tables):
    return {f"c.s.{name}": {"columns": {col: {"type": dtype, "comment": ""} for col, dtype in cols.items()}}
            for name, cols in tables.items()}


def graph(*links):
    out = {}
    for child, col, parent in links:
        out.setdefault(f"c.s.{child}", []).append((col, f"c.s.{parent}", col))
    return out


def kinds(ns, metadata, fk_graph=None):
    return {k["kind"]: k for k in inspire(ns).detect_supported_kinds(metadata, fk_graph or {}, log=False)}


SITES = {"store_id": "BIGINT", "store_name": "STRING", "latitude": "DOUBLE", "longitude": "DOUBLE"}


def test_a_site_dimension_with_a_fact_pointing_at_it_supports_site_and_territory(agent_ns):
    metadata = meta(stores=SITES, sales={"sale_id": "BIGINT", "store_id": "BIGINT", "sale_amount": "DOUBLE", "units": "INT"})
    hit = kinds(agent_ns, metadata, graph(("sales", "store_id", "stores")))["site_territory"]
    assert hit["anchor"] == "c.s.stores"
    assert hit["tables"] == ["c.s.sales", "c.s.stores"]
    assert hit["columns"]["latitude"] == ["c.s.stores.latitude"]
    assert hit["columns"]["money"] == ["c.s.sales.sale_amount"]
    assert hit["columns"]["quantity"] == ["c.s.sales.units"]
    assert hit["layout"] == "location_view"
    own = kinds(agent_ns, meta(stores={**SITES, "revenue": "DOUBLE", "units": "INT"}))["site_territory"]
    assert hit["strength"] < own["strength"]


def test_a_site_dimension_with_no_measure_anywhere_is_not_a_site_and_territory_kind(agent_ns):
    metadata = meta(stores=SITES, visits={"visit_id": "BIGINT", "store_id": "BIGINT", "visitor_name": "STRING"},
                    owners={"owner_id": "BIGINT", "owner_name": "STRING"})
    found = kinds(agent_ns, {**metadata, "c.s.stores": {"columns": {**metadata["c.s.stores"]["columns"],
                                                                     "owner_id": {"type": "BIGINT", "comment": ""}}}},
                  graph(("visits", "store_id", "stores"), ("stores", "owner_id", "owners")))
    assert "site_territory" not in found
    assert "location_intelligence" in found


def test_a_fact_with_measures_and_no_geo_dimension_is_not_a_location_kind(agent_ns):
    metadata = meta(stores={"store_id": "BIGINT", "store_name": "STRING", "opened_on": "STRING"},
                    sales={"sale_id": "BIGINT", "store_id": "BIGINT", "sale_amount": "DOUBLE", "units": "INT"})
    found = kinds(agent_ns, metadata, graph(("sales", "store_id", "stores")))
    assert "site_territory" not in found and "location_intelligence" not in found


def test_an_unrelated_fact_lends_no_measure_to_a_site_dimension(agent_ns):
    metadata = meta(stores=SITES, sales={"sale_id": "BIGINT", "branch_id": "BIGINT", "sale_amount": "DOUBLE"})
    assert "site_territory" not in kinds(agent_ns, metadata, {})


def test_a_capacity_dimension_borrows_the_shipped_units_for_allocation(agent_ns):
    pos = meta(warehouses={"warehouse_id": "BIGINT", "shelf_capacity": "INT"},
               shipments={"shipment_id": "BIGINT", "warehouse_id": "BIGINT", "units": "INT"})
    hit = kinds(agent_ns, pos, graph(("shipments", "warehouse_id", "warehouses")))["allocation"]
    assert hit["anchor"] == "c.s.warehouses" and hit["columns"]["quantity"] == ["c.s.shipments.units"]
    neg = meta(warehouses={"warehouse_id": "BIGINT", "shelf_capacity": "INT"},
               shipments={"shipment_id": "BIGINT", "warehouse_id": "BIGINT", "carrier_name": "STRING"})
    assert "allocation" not in kinds(agent_ns, neg, graph(("shipments", "warehouse_id", "warehouses")))


def test_a_scored_customer_borrows_order_amounts_for_threshold_tuning(agent_ns):
    pos = meta(customers={"customer_id": "BIGINT", "credit_score": "INT"},
               orders={"order_id": "BIGINT", "customer_id": "BIGINT", "net_amount": "DOUBLE"})
    hit = kinds(agent_ns, pos, graph(("orders", "customer_id", "customers")))["threshold_tuning"]
    assert hit["anchor"] == "c.s.customers" and hit["columns"]["money"] == ["c.s.orders.net_amount"]
    neg = meta(customers={"customer_id": "BIGINT", "credit_score": "INT"},
               orders={"order_id": "BIGINT", "customer_id": "BIGINT", "channel_name": "STRING"})
    assert "threshold_tuning" not in kinds(agent_ns, neg, graph(("orders", "customer_id", "customers")))


def test_a_route_network_borrows_the_shipped_units_of_its_shipments(agent_ns):
    routes = {"route_id": "BIGINT", "origin_site_id": "BIGINT", "destination_site_id": "BIGINT"}
    pos = meta(routes=routes, shipments={"shipment_id": "BIGINT", "route_id": "BIGINT", "units": "INT"})
    hit = kinds(agent_ns, pos, graph(("shipments", "route_id", "routes")))["network_dependency"]
    assert hit["anchor"] == "c.s.routes" and hit["columns"]["quantity"] == ["c.s.shipments.units"]
    neg = meta(routes=routes, shipments={"shipment_id": "BIGINT", "route_id": "BIGINT", "carrier_name": "STRING"})
    assert "network_dependency" not in kinds(agent_ns, neg, graph(("shipments", "route_id", "routes")))


def test_a_calendar_never_borrows_fact_measures_for_a_kind_that_needs_its_event_times(agent_ns):
    metadata = meta(date_dim={"date_id": "BIGINT", "calendar_date": "DATE", "fiscal_year": "INT", "is_holiday": "BOOLEAN"},
                    sales={"sale_id": "BIGINT", "date_id": "BIGINT", "sale_amount": "DOUBLE"})
    found = kinds(agent_ns, metadata, graph(("sales", "date_id", "date_dim")))
    assert "working_capital" not in found
    assert all(k["anchor"] != "c.s.date_dim" or not ({"money", "quantity"} & set(k["columns"])) for k in found.values())
    assert found["forecast"]["anchor"] == "c.s.sales"


def test_event_row_roles_of_a_referencing_fact_are_never_borrowed(agent_ns):
    metadata = meta(customers={"customer_id": "BIGINT", "segment": "STRING"},
                    tickets={"ticket_id": "BIGINT", "customer_id": "BIGINT", "opened_at": "TIMESTAMP",
                             "resolved_at": "TIMESTAMP", "status": "STRING"})
    found = kinds(agent_ns, metadata, graph(("tickets", "customer_id", "customers")))
    assert found["sla_aging"]["anchor"] == "c.s.tickets"
    assert all("c.s.customers" != k["anchor"] for k in found.values())


def test_the_scope_helper_splits_pointed_at_and_pointing_in_tables(agent_ns):
    cls = agent_ns["DatabricksInspire"]
    own = {"c.s.stores": {"latitude": ["c.s.stores.latitude"]},
           "c.s.sales": {"money": ["c.s.sales.amount"], "event_time": ["c.s.sales.sold_at"]},
           "c.s.region": {"region_code": ["c.s.region.code"]}}
    fk = {"c.s.sales": [("store_id", "c.s.stores", "store_id")], "c.s.stores": [("region_id", "c.s.region", "region_id"),
                                                                                  ("store_id", "c.s.stores", "store_id")],
          "c.s.ghost": [("store_id", "c.s.stores", "store_id")]}
    scopes = cls._kind_join_scopes(own, fk)
    refs, merged, widened = scopes["c.s.stores"]
    assert refs == ["c.s.region"]
    assert merged == {"latitude": ["c.s.stores.latitude"], "region_code": ["c.s.region.code"]}
    assert widened == {**merged, "money": ["c.s.sales.amount"]}
    assert "event_time" not in widened
    assert scopes["c.s.sales"][0] == ["c.s.stores"] and scopes["c.s.sales"][1] == scopes["c.s.sales"][2]


def test_the_run_step_detects_a_site_kind_from_loader_foreign_keys_into_the_site_table(agent_ns):
    obj = inspire(agent_ns)
    rel = ("C", "S", "Sales", "storeID", "C", "S", "Stores", "storeID")
    obj.data_loader = type("Loader", (), {"foreign_key_graph": {("C", "S", "Sales"): [rel]}})()
    obj.ai_agent = type("Agent", (), {"_call_ai_query": lambda self, **kw: '{"columns": []}'})()
    details = [("C", "S", "Stores", "storeID", "BIGINT", ""), ("C", "S", "Stores", "latitude", "DOUBLE", ""),
               ("C", "S", "Stores", "longitude", "DOUBLE", ""), ("C", "S", "Sales", "storeID", "BIGINT", ""),
               ("C", "S", "Sales", "quantity", "INT", ""), ("C", "S", "Sales", "totalPrice", "DOUBLE", "")]
    found = {k["kind"]: k for k in obj._detect_kinds_for_generation(details)}
    assert found["site_territory"]["anchor"] == "c.s.stores"
    assert "c.s.sales" in found["site_territory"]["tables"]
