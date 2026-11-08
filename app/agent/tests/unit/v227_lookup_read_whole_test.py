"""An MVP Test Run narrows only the use case's main table: a lookup table read for labels comes back whole, so a lookup row outside
the scope still labels a scoped record, in the notebook's own join and in the Grouping's join, offline over SQLite."""
import re
import sqlite3

import pandas as pd
import pytest

ORDERS, STORES = "main.sales.orders", "main.sales.stores"
ROWS = {
    ORDERS: pd.DataFrame([{"order_id": 1, "store_id": 10, "region": "EMEA", "updated_at": "2026-10-20", "amount": 40.0},
                          {"order_id": 2, "store_id": 20, "region": "EMEA", "updated_at": "2026-10-25", "amount": 75.0},
                          {"order_id": 3, "store_id": 10, "region": "APAC", "updated_at": "2026-01-05", "amount": 12.0}]),
    STORES: pd.DataFrame([{"store_id": 10, "city": "Dubai", "region": "APAC", "updated_at": "2024-03-01"},
                          {"store_id": 20, "city": "Paris", "region": "EMEA", "updated_at": "2026-10-21"}]),
}
SCOPES = {
    "recent": {"scope": "recent", "table": ORDERS, "column": "updated_at", "since": "2026-10-01"},
    "groups": {"scope": "groups", "table": ORDERS, "column": "region", "values": ["EMEA"]},
    "whole_groups": {"scope": "records", "table": ORDERS, "records": 2, "key": "order_id", "column": "region", "whole_groups": True,
                     "values": ["EMEA"]},
}
SCOPED = [1, 2]


def _sqlite(condition):
    condition = re.sub(r"CAST\((`[^`]+`) AS DATE\) >= DATE ('[^']+')", r"date(\1) >= date(\2)", condition)
    return condition.replace(" AS STRING)", " AS TEXT)")


class SqlFrame:
    def __init__(self, db, sql, columns):
        self.db, self.sql, self.columns = db, sql, list(columns)
        self.dtypes = [(column, "string") for column in self.columns]

    def where(self, condition):
        return SqlFrame(self.db, f"SELECT * FROM ({self.sql}) WHERE {_sqlite(condition)}", self.columns)

    def selectExpr(self, *exprs):
        names = [re.split(r"\s+AS\s+", e)[-1].strip("`") for e in exprs]
        return SqlFrame(self.db, f"SELECT {', '.join(_sqlite(e) for e in exprs)} FROM ({self.sql})", names)

    def groupBy(self, key):
        frame = self

        class Grouped:
            def agg(self, spec):
                (value, how), = spec.items()
                return SqlFrame(frame.db, f"SELECT `{key}`, {how.upper()}(`{value}`) AS `_agg` FROM ({frame.sql}) GROUP BY `{key}`",
                                [key, "_agg"])
        return Grouped()

    def toDF(self, *names):
        picked = ", ".join(f"`{old}` AS `{new}`" for old, new in zip(self.columns, names))
        return SqlFrame(self.db, f"SELECT {picked} FROM ({self.sql})", names)

    def toPandas(self):
        return pd.read_sql_query(self.sql, self.db)


class Session:
    def __init__(self):
        self.db = sqlite3.connect(":memory:")
        for table, rows in ROWS.items():
            rows.to_sql(table.replace(".", "_"), self.db, index=False)

    def table(self, name):
        table = name.replace("`", "")
        return SqlFrame(self.db, f"SELECT * FROM {table.replace('.', '_')}", ROWS[table].columns)


def _labels(records, stores):
    joined = records.toPandas().merge(stores.toPandas()[["store_id", "city"]], how="left", on="store_id")
    return dict(zip(joined["order_id"], joined["city"]))


@pytest.mark.parametrize("mode", sorted(SCOPES))
def test_a_lookup_row_outside_the_scope_still_labels_a_scoped_record(fresh_ns, mode):
    fresh_ns["INSPIRE_SCOPE"], fresh_ns["INSPIRE_RUN_LOG"] = dict(SCOPES[mode]), {}
    spark = Session()
    records = fresh_ns["inspire_read_source"](ORDERS, spark=spark)
    stores = fresh_ns["inspire_read_source"](STORES, spark=spark)
    labels = _labels(records, stores)
    assert sorted(labels) == SCOPED, "the main table is still narrowed to the scope (must-exclude order 3)"
    assert labels == {1: "Dubai", 2: "Paris"}, "store 10 sits outside the scope yet labels order 1"
    assert fresh_ns["INSPIRE_RUN_LOG"]["reads"][STORES] == {"where": "", "limit": None}
    assert fresh_ns["INSPIRE_RUN_LOG"]["reads"][ORDERS]["where"]


@pytest.mark.parametrize("mode", sorted(SCOPES))
def test_the_grouping_join_reads_its_lookup_table_whole_so_no_scoped_record_loses_its_group(fresh_ns, mode):
    fresh_ns["INSPIRE_SCOPE"], fresh_ns["INSPIRE_RUN_LOG"] = dict(SCOPES[mode]), {}
    fresh_ns["INSPIRE_RUN"] = {"grouping": {"joins": {"stores.city": {"table": STORES, "key": "store_id", "ref_column": "store_id"}}}}
    spark = Session()
    records = fresh_ns["inspire_read_source"](ORDERS, spark=spark).toPandas()
    grouped = fresh_ns["inspire_group_joined"](records, ["stores.city"], lambda m: None, spark)
    assert dict(zip(grouped["order_id"], grouped["city"])) == {1: "Dubai", 2: "Paris"}


def test_with_no_scope_every_table_is_read_whole(fresh_ns):
    fresh_ns["INSPIRE_RUN_LOG"] = {}
    spark = Session()
    labels = _labels(fresh_ns["inspire_read_source"](ORDERS, spark=spark), fresh_ns["inspire_read_source"](STORES, spark=spark))
    assert labels == {1: "Dubai", 2: "Paris", 3: "Dubai"}


def test_the_read_rule_tells_genie_only_the_main_table_is_narrowed(agent_ns):
    rule = agent_ns["GENIE_SOURCE_READ_RULE"]
    assert "the use case's main table" in rule and "lookup table" in rule and "whole" in rule
