"""v1.4.0 use-case kinds: column roles.

`_column_signals` assigns each column one of the 19 roles from its name, type, comment and foreign keys, and lists
the columns the rules leave ambiguous for the one batched labeling call. Every role has a must-keep and a
must-exclude case (CLAUDE.md 8.3).
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def roles_of(ns, cols, comments=None, fks=None, llm_roles=None):
    return ns["DatabricksInspire"]._column_signals(cols, comments, fks, llm_roles)["roles"]


def role_of(ns, name, dtype, siblings=None, comment=None):
    cols = dict(siblings or {})
    cols[name] = dtype
    found = [r for r, members in roles_of(ns, cols, {name: comment} if comment else None).items()
             if name in members and r != "edge_pair"]
    return found[0] if found else ""


CASES = [
    ("money", ("net_paid", "DECIMAL(7,2)"), ("customer_sk", "INT")),
    ("money", ("ss_ext_sales_price", "DECIMAL(7,2)"), ("ss_sales_price", "DECIMAL(7,2)")),
    ("money", ("revenue", "DOUBLE"), ("revenue_date", "DATE")),
    ("quantity", ("ss_quantity", "INT"), ("customer_id", "BIGINT")),
    ("quantity", ("units_sold", "INT"), ("unit_price", "DOUBLE")),
    ("price", ("unit_price", "DOUBLE"), ("total_price", "DOUBLE")),
    ("price", ("l_discount", "DECIMAL(12,2)"), ("discount_amount", "DECIMAL(12,2)")),
    ("cost", ("ps_supplycost", "DECIMAL(12,2)"), ("ps_partkey", "BIGINT")),
    ("cost", ("freight", "DOUBLE"), ("freight_date", "DATE")),
    ("budget_target", ("budget_amount", "DOUBLE"), ("target", "INT")),
    ("budget_target", ("sales_target", "DOUBLE"), ("sales", "DOUBLE")),
    ("capacity_limit", ("bed_capacity", "INT"), ("bed_id", "INT")),
    ("rate_probability", ("churn_probability", "DOUBLE"), ("rate_code", "STRING")),
    ("rate_probability", ("tax_rate", "DOUBLE"), ("tax", "DOUBLE")),
    ("event_time", ("order_date", "DATE"), ("is_late", "BOOLEAN")),
    ("event_time", ("ss_sold_date_sk", "INT"), ("response_time_minutes", "INT")),
    ("event_time", ("o_orderdate", ""), ("o_totalprice", "")),
    ("event_time", ("created_at", "TIMESTAMP"), ("created_by", "STRING")),
    ("status_activity", ("is_late", "BOOLEAN"), ("late_date", "DATE")),
    ("status_activity", ("order_status", "STRING"), ("order_id", "BIGINT")),
    ("status_activity", ("l_returnflag", "STRING"), ("flag_id", "BIGINT")),
    ("case_id", ("ss_ticket_number", "BIGINT"), ("ss_customer_sk", "INT")),
    ("case_id", ("claim_id", "BIGINT"), ("member_id", "BIGINT")),
    ("latitude", ("ship_lat", "DOUBLE"), ("ship_flat_rate", "DOUBLE")),
    ("latitude", ("latitude", "DOUBLE"), ("lat_id", "INT")),
    ("longitude", ("pickup_longitude", "DOUBLE"), ("long_description", "STRING")),
    ("region_code", ("ca_zip", "STRING"), ("ca_address_sk", "INT")),
    ("region_code", ("PULocationID", "BIGINT"), ("trip_distance", "DOUBLE")),
    ("treatment", ("ss_promo_sk", "INT"), ("ss_item_sk", "INT")),
    ("treatment", ("experiment_variant", "STRING"), ("visitor_id", "BIGINT")),
    ("spec_limit", ("upper_limit", "DOUBLE"), ("measured_value_id", "INT")),
    ("spec_limit", ("ucl", "DOUBLE"), ("reading_count", "INT")),
    ("approver_creator", ("approved_by", "STRING"), ("approved_at", "TIMESTAMP")),
    ("approver_creator", ("requester_id", "BIGINT"), ("request_id", "BIGINT")),
    ("score_limit", ("credit_score", "INT"), ("credit_card_count", "INT")),
    ("score_limit", ("cd_credit_rating", "STRING"), ("cd_dep_count", "INT")),
    ("score_limit", ("credit_limit", "DOUBLE"), ("seat_limit_id", "INT")),
    ("free_text", ("review_text", "STRING"), ("review_id", "BIGINT")),
    ("free_text", ("agent_notes", "STRING"), ("note_count", "INT")),
]


@pytest.mark.parametrize("role,keep,exclude", CASES, ids=[f"{c[0]}:{c[1][0]}" for c in CASES])
def test_each_role_keeps_its_column_and_excludes_the_lookalike(agent_ns, role, keep, exclude):
    cols = {keep[0]: keep[1], exclude[0]: exclude[1]}
    roles = roles_of(agent_ns, cols)
    assert keep[0] in roles[role], (role, roles)
    assert exclude[0] not in roles[role], (role, roles)


def test_all_nineteen_roles_are_always_present(agent_ns):
    roles = roles_of(agent_ns, {"a": "INT"})
    assert len(roles) == 19
    assert set(roles) == set(agent_ns["DatabricksInspire"]._ROLE_IDS)


def test_unit_price_is_price_and_never_a_money_total(agent_ns):
    roles = roles_of(agent_ns, {"unit_price": "DOUBLE", "line_total": "DOUBLE"})
    assert roles["price"] == ["unit_price"]
    assert roles["money"] == ["line_total"]


def test_customer_id_is_never_a_quantity_or_money(agent_ns):
    roles = roles_of(agent_ns, {"customer_id": "BIGINT", "order_count": "INT"})
    assert roles["quantity"] == ["order_count"]
    assert "customer_id" not in roles["money"] + roles["quantity"]


def test_is_late_is_status_and_never_event_time(agent_ns):
    roles = roles_of(agent_ns, {"is_late": "BOOLEAN", "delivered_at": "TIMESTAMP"})
    assert roles["status_activity"] == ["is_late"]
    assert roles["event_time"] == ["delivered_at"]


def test_state_is_a_region_beside_an_address_and_a_status_otherwise(agent_ns):
    geo = roles_of(agent_ns, {"ca_state": "STRING", "ca_city": "STRING"})
    assert "ca_state" in geo["region_code"] and "ca_state" not in geo["status_activity"]
    signals = agent_ns["DatabricksInspire"]._column_signals({"order_state": "STRING", "order_id": "BIGINT"})
    assert "order_state" in signals["roles"]["status_activity"]
    assert "order_state" in signals["role_ambiguous"]


def test_two_foreign_keys_to_the_same_table_form_an_edge_pair(agent_ns):
    cols = {"from_account_sk": "INT", "to_account_sk": "INT", "branch_sk": "INT", "amount": "DOUBLE"}
    fks = {"from_account_sk": "c.s.account", "to_account_sk": "c.s.account", "branch_sk": "c.s.branch"}
    edges = roles_of(agent_ns, cols, fks=fks)["edge_pair"]
    assert sorted(edges) == ["from_account_sk", "to_account_sk"]
    single = roles_of(agent_ns, {"account_sk": "INT", "branch_sk": "INT"},
                      fks={"account_sk": "c.s.account", "branch_sk": "c.s.branch"})["edge_pair"]
    assert single == []


def test_foreign_keys_to_one_table_without_a_naming_pair_still_form_an_edge_pair(agent_ns):
    fks = {"cs_bill_customer_sk": "c.s.customer", "cs_ship_customer_sk": "c.s.customer",
           "cs_sold_date_sk": "c.s.date_dim", "cs_ship_date_sk": "c.s.date_dim"}
    cols = {k: "INT" for k in fks}
    edges = roles_of(agent_ns, cols, fks=fks)["edge_pair"]
    assert sorted(edges) == ["cs_bill_customer_sk", "cs_ship_customer_sk"]


def test_named_origin_destination_columns_form_an_edge_pair_but_timestamps_do_not(agent_ns):
    cols = {"PULocationID": "BIGINT", "DOLocationID": "BIGINT", "pickup_datetime": "TIMESTAMP",
            "dropoff_datetime": "TIMESTAMP", "fare_amount": "DOUBLE"}
    edges = roles_of(agent_ns, cols)["edge_pair"]
    assert sorted(edges) == ["DOLocationID", "PULocationID"]


def test_a_numeric_column_with_no_role_is_ambiguous_and_a_key_is_not(agent_ns):
    signals = agent_ns["DatabricksInspire"]._column_signals({"w_warehouse_sq_ft": "INT", "item_sk": "INT", "price": "DOUBLE"})
    assert signals["role_ambiguous"] == ["w_warehouse_sq_ft"]


def test_the_labeling_answer_fills_only_ambiguous_columns(agent_ns):
    cols = {"w_warehouse_sq_ft": "INT", "unit_price": "DOUBLE"}
    llm = {"w_warehouse_sq_ft": "capacity_limit", "unit_price": "money"}
    signals = agent_ns["DatabricksInspire"]._column_signals(cols, None, None, llm)
    assert signals["roles"]["capacity_limit"] == ["w_warehouse_sq_ft"]
    assert signals["roles"]["price"] == ["unit_price"]
    assert signals["roles"]["money"] == []
    assert signals["role_ambiguous"] == []
    bad = agent_ns["DatabricksInspire"]._column_signals(cols, None, None, {"w_warehouse_sq_ft": "edge_pair"})
    assert bad["role_ambiguous"] == ["w_warehouse_sq_ft"]
    none = agent_ns["DatabricksInspire"]._column_signals(cols, None, None, {"w_warehouse_sq_ft": "none"})
    assert none["role_ambiguous"] == [] and "w_warehouse_sq_ft" not in sum(none["roles"].values(), [])


def test_a_comment_names_the_role_a_bare_name_leaves_open(agent_ns):
    assert role_of(agent_ns, "c_x17", "DECIMAL(12,2)", comment="Customer account balance") == "money"
    assert role_of(agent_ns, "c_x17", "DECIMAL(12,2)") == ""
    assert role_of(agent_ns, "c_acctbal", "DECIMAL(12,2)") == "money"
    assert role_of(agent_ns, "x_note", "STRING") == "free_text"
    assert role_of(agent_ns, "fld_17", "STRING", comment="Free text from the call center agent") == "free_text"
    assert role_of(agent_ns, "fld_17", "STRING", comment="Text code of the product class") == ""


def test_existing_signal_keys_are_unchanged(agent_ns):
    signals = agent_ns["DatabricksInspire"]._column_signals({"order_date": "DATE", "amount": "DOUBLE", "order_id": "BIGINT"})
    for key in ("typed", "has_date", "has_numeric", "numeric_cols", "id_cols", "text_cols", "geo_cols", "stage_cols"):
        assert key in signals
    assert signals["has_date"] is True and signals["numeric_cols"] == ["amount", "order_id"]


def test_the_labeling_call_is_a_registered_inline_prompt(agent_ns):
    registered = {p["prompt_name"]: p for p in agent_ns["TECHNICAL_CONTEXT"]["prompts_models"]}
    assert registered["label_column_roles"]["model_type"] == "worker"
    assert registered["label_column_roles"]["temperature"] == 0.0
    assert "label_column_roles" in agent_ns["INLINE_PROMPT_NAMES"]
    assert "label_column_roles" not in agent_ns["PROMPT_TEMPLATES"]
