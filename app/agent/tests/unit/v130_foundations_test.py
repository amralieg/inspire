"""v1.3.0 shared data foundations: deterministic grouping of the final use cases' shared tables over
known joins, ranked by use cases unlocked and summed Inspire Score, with a delivery order and no dates."""
import json
import re
import types

from v120_artifacts_support import make_inspire


def uc(no, tables, score):
    return {"No": no, "Name": no, "Tables Involved": tables, "Inspire Score": score}


def harness(agent_ns, fk=None, history=None):
    obj = make_inspire(agent_ns)
    graph = {}
    for child, child_col, parent, parent_col in fk or []:
        graph.setdefault(tuple(child.split(".")), []).append(tuple(child.split(".")) + (child_col,)
                                                             + tuple(parent.split(".")) + (parent_col,))
    obj.data_loader = types.SimpleNamespace(foreign_key_graph=graph,
                                            metadata_unavailable_report=lambda: {"count": 0, "tables": []})
    obj.discovery_evidence = {"history_joins": history or []}
    return obj


def test_shared_tables_joined_by_two_use_cases_form_one_foundation(agent_ns):
    obj = harness(agent_ns, fk=[("c.s.orders", "customer_id", "c.s.customers", "customer_id")])
    ucs = [uc("N01-U01", "c.s.orders, c.s.customers", 8.0), uc("N01-U02", "c.s.orders, c.s.customers", 7.0),
           uc("N02-U01", "c.s.orders", 9.0), uc("N02-U02", "c.s.stock, c.s.sites", 6.0),
           uc("N02-U03", "c.s.stock", 5.0), uc("N03-U01", "c.s.payroll", 9.9)]
    foundations = obj._build_data_foundations(ucs)
    assert [f["tables"] for f in foundations] == [["c.s.customers", "c.s.orders"], ["c.s.stock"]]
    first = foundations[0]
    assert first["id"] == "F1" and first["name"] == "customers + orders" and first["use_case_count"] == 3
    assert first["joins"] == [{"left": "c.s.orders.customer_id", "right": "c.s.customers.customer_id", "source": "foreign key"}]
    assert first["use_cases"] == ["N02-U01", "N01-U01", "N01-U02"], "members are ordered by Inspire Score"
    assert foundations[1]["use_cases"] == ["N02-U02", "N02-U03"]
    assert ucs[5]["Foundations"] == [], "a table one use case reads is not a shared foundation"
    assert ucs[0]["Foundations"] == ["F1"] and ucs[3]["Foundations"] == ["F2"]
    assert obj.delivery_order == ["N02-U01", "N01-U01", "N01-U02", "N02-U02", "N02-U03", "N03-U01"]


def test_a_join_used_by_only_one_use_case_does_not_merge_foundations(agent_ns):
    obj = harness(agent_ns, fk=[("c.s.orders", "customer_id", "c.s.customers", "customer_id")])
    ucs = [uc("U1", "c.s.orders, c.s.customers", 8.0), uc("U2", "c.s.orders", 7.0), uc("U3", "c.s.customers", 6.0)]
    foundations = obj._build_data_foundations(ucs)
    assert sorted(f["tables"] for f in foundations) == [["c.s.customers"], ["c.s.orders"]]
    assert all(f["joins"] == [] for f in foundations)


def test_observed_query_joins_also_group_tables(agent_ns):
    history = [{"left": "c.s.orders.store_id", "right": "c.s.stores.store_id", "count": 4}]
    obj = harness(agent_ns, history=history)
    ucs = [uc("U1", "c.s.orders, c.s.stores", 8.0), uc("U2", "c.s.orders, c.s.stores", 7.0)]
    foundations = obj._build_data_foundations(ucs)
    assert len(foundations) == 1 and foundations[0]["joins"][0]["source"] == "observed in queries"


def test_ranking_breaks_equal_counts_by_summed_value_and_has_no_dates(agent_ns):
    obj = harness(agent_ns)
    ucs = [uc("U1", "c.s.a", 5.0), uc("U2", "c.s.a", 5.0), uc("U3", "c.s.b", 9.0), uc("U4", "c.s.b", 9.0)]
    foundations = obj._build_data_foundations(ucs)
    assert [f["tables"] for f in foundations] == [["c.s.b"], ["c.s.a"]]
    text = json.dumps(foundations).lower()
    for word in ("week", "month", "day", "quarter", "duration", "deadline"):
        assert word not in text, word
    assert re.search(r"\d{4}-\d{2}-\d{2}", text) is None
    results = obj._merge_run_outcome_into_results()
    assert results["foundations"][0]["id"] == "F1" and results["delivery_order"][0] in ("U3", "U4")


def test_a_star_schema_gives_one_foundation_per_fact_and_shared_dimensions_never_chain_facts(agent_ns):
    fk = [("c.s.sales", "item_id", "c.s.items", "item_id"), ("c.s.sales", "date_id", "c.s.dates", "date_id"),
          ("c.s.returns", "item_id", "c.s.items", "item_id"), ("c.s.returns", "date_id", "c.s.dates", "date_id"),
          ("c.s.stock", "item_id", "c.s.items", "item_id")]
    obj = harness(agent_ns, fk=fk)
    ucs = [uc("S1", "c.s.sales, c.s.items, c.s.dates", 9.0), uc("S2", "c.s.sales, c.s.items, c.s.dates", 8.0),
           uc("S3", "c.s.sales, c.s.dates", 7.0), uc("R1", "c.s.returns, c.s.items", 6.0),
           uc("R2", "c.s.returns, c.s.items", 6.5), uc("K1", "c.s.stock, c.s.items", 5.0),
           uc("K2", "c.s.stock, c.s.items", 5.5), uc("D1", "c.s.items", 9.9)]
    foundations = obj._build_data_foundations(ucs)
    assert [f["tables"] for f in foundations] == [["c.s.dates", "c.s.items", "c.s.sales"], ["c.s.items", "c.s.returns"],
                                                  ["c.s.items", "c.s.stock"]]
    assert [f["use_cases"] for f in foundations] == [["S1", "S2", "S3"], ["R2", "R1"], ["K2", "K1"]]
    assert all(sum(t in f["tables"] for t in ("c.s.sales", "c.s.returns", "c.s.stock")) == 1 for f in foundations)
    assert {j["left"] for j in foundations[1]["joins"]} == {"c.s.returns.item_id"}
    assert ucs[7]["Foundations"] == [], "a use case on a shared dimension alone is unlocked by no fact foundation"
    assert obj.delivery_order[:3] == ["S1", "S2", "S3"] and obj.delivery_order[-1] == "D1"


def test_no_shared_table_yields_no_foundation(agent_ns):
    obj = harness(agent_ns)
    ucs = [uc("U1", "c.s.a", 5.0), uc("U2", "c.s.b", 5.0)]
    assert obj._build_data_foundations(ucs) == []
    assert all(u["Foundations"] == [] for u in ucs) and obj.delivery_order == ["U1", "U2"]
