"""A samples.wanderbricks Discover run dropped 51 valid use cases as hallucinated: the check for SQL text leaked into Tables
Involved matched keywords inside table names (booking_updates holds UPDATE), and the repair of shifted CSV rows used the same
substring test. Both now find a SQL keyword only as a whole word outside a dotted or quoted name."""
from v120_artifacts_support import CapturingLogger

TABLES = ["samples.wanderbricks.booking_updates", "samples.wanderbricks.bookings", "samples.wanderbricks.users",
          "shop.sales.order_items", "shop.sales.selected_offers", "shop.sales.deleted_carts", "shop.sales.fromage_orders",
          "shop.sales.group_bys", "shop.sales.unions"]


def _inst(agent_ns):
    inst = object.__new__(agent_ns["DatabricksInspire"])
    inst.logger = CapturingLogger()
    inst.global_table_names = set(TABLES)
    inst.data_category_map = {}
    return inst


def _schema():
    return [(*name.split("."), None, None, None) for name in TABLES]


def _row(no, tables):
    return {"No": no, "Name": f"Use case {no}", "Tables Involved": tables}


def test_table_names_holding_a_keyword_are_not_sql(agent_ns):
    from_ns = agent_ns["DatabricksInspire"]._has_sql_fragment
    for value in [", ".join(TABLES), "samples.wanderbricks.booking_updates", "`shop`.`sales`.`update`", "shop.sales.from",
                  "catalog.updates_2024.select_log", "", None]:
        assert not from_ns(value), value
    for value in ["SELECT * FROM shop.sales.order_items", "shop.sales.order_items JOIN shop.sales.unions",
                  "count(*) where status = 1", "x group  by y", "ORDER BY created_at", "union all", "update t set a = 1",
                  "delete from t", "insert into t", "limit 10", "having count(*) > 1", "with cte as (select 1)"]:
        assert from_ns(value), value


def test_valid_use_cases_on_keyword_named_tables_are_kept(agent_ns):
    inst = _inst(agent_ns)
    rows = [_row("N01-U01", "samples.wanderbricks.booking_updates, samples.wanderbricks.bookings"),
            _row("N01-U02", "shop.sales.selected_offers, shop.sales.deleted_carts"),
            _row("N01-U03", "shop.sales.fromage_orders, shop.sales.group_bys, shop.sales.unions, shop.sales.order_items"),
            _row("N01-U04", "SELECT booking_id FROM samples.wanderbricks.bookings"),
            _row("N01-U05", "samples.wanderbricks.made_up_table")]
    is_valid, dropped, kept = inst._validate_use_case_tables(rows, _schema(), "[Batch P1_1]")
    assert [r["No"] for r in kept] == ["N01-U01", "N01-U02", "N01-U03"]
    assert [r["No"] for r in dropped] == ["N01-U04", "N01-U05"] and not is_valid
    assert dropped[0]["hallucination_reason"].startswith("SQL fragment in Tables Involved")
    assert dropped[1]["hallucination_reason"] == "Tables not found in schema: samples.wanderbricks.made_up_table"


def test_the_repair_leaves_keyword_named_tables_alone_and_still_repairs_shifted_rows(agent_ns):
    inst = _inst(agent_ns)
    value = "samples.wanderbricks.booking_updates, samples.wanderbricks.users"
    shifted_row = {"High Level Design": "join samples.wanderbricks.booking_updates to samples.wanderbricks.users",
                   "Tables Involved": value}
    assert inst._repair_tables_involved(value, shifted_row, "[Batch P1_1]") == value
    items = "shop.sales.order_items"
    row = {"Statement": "compare shop.sales.order_items with shop.sales.unions", "Tables Involved": items}
    assert inst._repair_tables_involved(items, row, "[Batch P1_1]") == items
    leaked = "SELECT user_id FROM samples.wanderbricks.users u JOIN samples.wanderbricks.booking_updates b"
    shifted_row["Tables Involved"] = leaked
    assert inst._repair_tables_involved(leaked, shifted_row, "[Batch P1_1]") == \
        "samples.wanderbricks.booking_updates, samples.wanderbricks.users"
    order_by = "shop.sales.order_items ORDER BY created_at"
    assert inst._repair_tables_involved(order_by, {"Tables Involved": order_by}, "[Batch P1_1]") == "shop.sales.order_items"
