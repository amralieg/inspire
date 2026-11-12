"""v1.2.0 WS4 (lane EVIDENCE): metadata evidence layer, table filter and schema markdown.

The DataLoader is exercised against `SqliteSpark`, a Spark double that executes the agent's real
information_schema SQL in an in-memory sqlite database (the catalog prefix
`cat`.`information_schema`.`x` is rewritten to a sqlite table `cat__x`). Joins, IN-lists, named
parameters and ORDER BY therefore run exactly as written in the notebook. DESCRIBE TABLE, SHOW
SCHEMAS and SHOW TABLES are answered from the same catalog model. Any other statement raises, so
every DataLoader test doubles as a dynamic "metadata only, never row data" check.
"""
import base64
import json
import re
import sqlite3
import threading
import types

import time

import pytest


@pytest.fixture(autouse=True)
def fast_polling(monkeypatch):
    real_sleep = time.sleep
    monkeypatch.setattr(time, "sleep", lambda seconds: real_sleep(min(seconds, 0.005)))


class CapturingLogger:
    def __init__(self):
        self.records = []
        self._lock = threading.Lock()

    def _log(self, level, msg, *args, **kwargs):
        with self._lock:
            self.records.append((level, str(msg)))

    def debug(self, msg, *a, **k):
        self._log("DEBUG", msg)

    def info(self, msg, *a, **k):
        self._log("INFO", msg)

    def warning(self, msg, *a, **k):
        self._log("WARNING", msg)

    def error(self, msg, *a, **k):
        self._log("ERROR", msg)

    def critical(self, msg, *a, **k):
        self._log("CRITICAL", msg)

    def exception(self, msg, *a, **k):
        self._log("ERROR", msg)

    def at(self, level):
        return [m for lvl, m in self.records if lvl == level]

    def matching(self, needle, level=None):
        return [m for lvl, m in self.records if needle in m and (level is None or lvl == level)]


class FakeRow:
    def __init__(self, fields, values):
        self._fields = list(fields)
        self._values = list(values)
        for name, value in zip(self._fields, self._values):
            setattr(self, name, value)

    def __getitem__(self, key):
        if isinstance(key, int):
            return self._values[key]
        return self._values[self._fields.index(key)]


class FakeColumn:
    def __init__(self, name):
        self.name = name

    def __eq__(self, other):
        return lambda row: getattr(row, self.name) == other


class FakeDF:
    def __init__(self, fields, rows):
        self._fields = list(fields)
        self._rows = [list(r) for r in rows]

    @property
    def columns(self):
        return list(self._fields)

    def collect(self):
        return [FakeRow(self._fields, r) for r in self._rows]

    def toLocalIterator(self):
        return iter(self.collect())

    def count(self):
        return len(self._rows)

    def orderBy(self, name):
        idx = self._fields.index(name)
        return FakeDF(self._fields, sorted(self._rows, key=lambda r: r[idx]))

    def limit(self, n):
        self._limit_calls = getattr(self, "_limit_calls", 0) + 1
        if self._limit_calls > 3:
            raise RuntimeError("pagination loop re-reads the same rows without advancing")
        return FakeDF(self._fields, self._rows[:n])

    def offset(self, n):
        return FakeDF(self._fields, self._rows[n:])

    def filter(self, predicate):
        return FakeDF(self._fields, [r for r, row in zip(self._rows, self.collect()) if predicate(row)])

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return FakeColumn(name)


INFO_TABLES = {
    "schemata": ["catalog_name", "schema_name"],
    "tables": ["table_catalog", "table_schema", "table_name", "table_type", "comment", "data_source_format", "last_altered"],
    "columns": ["table_catalog", "table_schema", "table_name", "column_name", "data_type", "comment", "is_nullable",
                "ordinal_position"],
    "table_constraints": ["constraint_catalog", "constraint_schema", "constraint_name", "table_catalog", "table_schema",
                          "table_name", "constraint_type"],
    "key_column_usage": ["constraint_catalog", "constraint_schema", "constraint_name", "table_catalog", "table_schema",
                         "table_name", "column_name", "ordinal_position", "position_in_unique_constraint"],
    "referential_constraints": ["constraint_catalog", "constraint_schema", "constraint_name", "unique_constraint_catalog",
                                "unique_constraint_schema", "unique_constraint_name"],
    "table_tags": ["catalog_name", "schema_name", "table_name", "tag_name", "tag_value"],
    "column_tags": ["catalog_name", "schema_name", "table_name", "column_name", "tag_name", "tag_value"],
}

INFO_REF = re.compile(r"`([^`]+)`\.`information_schema`\.`([^`]+)`")
DESCRIBE_RE = re.compile(r"^\s*DESCRIBE\s+TABLE\s+`([^`]+)`\.`([^`]+)`\.`([^`]+)`\s*$", re.I)
SHOW_SCHEMAS_RE = re.compile(r"^\s*SHOW\s+SCHEMAS\s+IN\s+`([^`]+)`\s*$", re.I)
SHOW_TABLES_RE = re.compile(r"^\s*SHOW\s+TABLES\s+IN\s+`([^`]+)`\.`([^`]+)`\s*$", re.I)


class SqliteSpark:
    """Spark double over a catalog model.

    model = {catalog: {schema: {table: {"columns": [(name, type, comment), ...], "comment": str,
             "type": str, "format": str, "last_altered": str, "pk": [cols], "fks": [{"name", "cols",
             "ref": (cat, sch, tbl), "ref_cols"}], "tags": {}, "column_tags": {col: {}},
             "partitioned_by": [cols], "info_columns": bool}}}}
    """

    def __init__(self, model, no_info_schema=(), describe_denied=(), fail_once=()):
        self.model = model
        self.no_info_schema = set(no_info_schema)
        self.describe_denied = set(describe_denied)
        self.fail_once = list(fail_once)
        self.queries = []
        self._lock = threading.Lock()
        self.conn = sqlite3.connect(":memory:", check_same_thread=False)
        for catalog in model:
            for name, cols in INFO_TABLES.items():
                self.conn.execute(f'CREATE TABLE "{catalog}__{name}" ({", ".join(cols)})')
        for catalog, schemas in model.items():
            for schema, tables in schemas.items():
                self._insert(catalog, "schemata", (catalog, schema))
                for table, spec in tables.items():
                    self._insert(catalog, "tables", (catalog, schema, table, spec.get("type", "MANAGED"),
                                                     spec.get("comment"), spec.get("format", "DELTA"),
                                                     spec.get("last_altered")))
                    if spec.get("info_columns", True):
                        for pos, (col, dtype, comment) in enumerate(spec["columns"], 1):
                            nullable = "NO" if col in spec.get("pk", []) else "YES"
                            self._insert(catalog, "columns", (catalog, schema, table, col, dtype, comment, nullable, pos))
                    if spec.get("pk"):
                        self._insert(catalog, "table_constraints",
                                     (catalog, schema, f"pk_{table}", catalog, schema, table, "PRIMARY KEY"))
                        for pos, col in enumerate(spec["pk"], 1):
                            self._insert(catalog, "key_column_usage",
                                         (catalog, schema, f"pk_{table}", catalog, schema, table, col, pos, None))
                    for tag, value in spec.get("tags", {}).items():
                        self._insert(catalog, "table_tags", (catalog, schema, table, tag, value))
                    for col, tags in spec.get("column_tags", {}).items():
                        for tag, value in tags.items():
                            self._insert(catalog, "column_tags", (catalog, schema, table, col, tag, value))
        for catalog, schemas in model.items():
            for schema, tables in schemas.items():
                for table, spec in tables.items():
                    for fk in spec.get("fks", []):
                        ref_cat, ref_sch, ref_tbl = fk["ref"]
                        ref_pk = model[ref_cat][ref_sch][ref_tbl]["pk"]
                        self._insert(catalog, "table_constraints",
                                     (catalog, schema, fk["name"], catalog, schema, table, "FOREIGN KEY"))
                        self._insert(catalog, "referential_constraints",
                                     (catalog, schema, fk["name"], ref_cat, ref_sch, f"pk_{ref_tbl}"))
                        for pos, (col, ref_col) in enumerate(zip(fk["cols"], fk["ref_cols"]), 1):
                            self._insert(catalog, "key_column_usage",
                                         (catalog, schema, fk["name"], catalog, schema, table, col, pos,
                                          ref_pk.index(ref_col) + 1))
        self.conn.commit()

    def _insert(self, catalog, name, values):
        marks = ", ".join("?" for _ in values)
        self.conn.execute(f'INSERT INTO "{catalog}__{name}" VALUES ({marks})', values)

    def sql(self, query, args=None, **kwargs):
        if args is None:
            args = kwargs.get("args")
        with self._lock:
            self.queries.append((query, dict(args or {})))
            for idx, (pattern, message) in enumerate(self.fail_once):
                if re.search(pattern, query, re.I | re.S):
                    self.fail_once.pop(idx)
                    raise RuntimeError(message)
        m = DESCRIBE_RE.match(query)
        if m:
            return self._describe(*m.groups())
        m = SHOW_SCHEMAS_RE.match(query)
        if m:
            schemas = sorted(self.model.get(m.group(1), {}))
            return FakeDF(["databaseName"], [[s] for s in schemas])
        m = SHOW_TABLES_RE.match(query)
        if m:
            tables = sorted(self.model.get(m.group(1), {}).get(m.group(2), {}))
            return FakeDF(["database", "tableName", "isTemporary"], [[m.group(2), t, False] for t in tables])
        refs = INFO_REF.findall(query)
        if not refs:
            raise AssertionError(f"SqliteSpark: statement is not metadata-only: {query[:200]}")
        for catalog, _ in refs:
            if catalog in self.no_info_schema or catalog not in self.model:
                raise RuntimeError(f"[TABLE_OR_VIEW_NOT_FOUND] `{catalog}`.`information_schema` is not available")
        translated = INFO_REF.sub(lambda mm: f'"{mm.group(1)}__{mm.group(2)}"', query)
        with self._lock:
            cur = self.conn.execute(translated, dict(args or {}))
            fields = [d[0] for d in cur.description]
            rows = cur.fetchall()
        return FakeDF(fields, rows)

    def _describe(self, catalog, schema, table):
        fqn = f"{catalog}.{schema}.{table}"
        if fqn in self.describe_denied:
            raise RuntimeError(f"PERMISSION_DENIED: User does not have USE/SELECT on {fqn}")
        try:
            spec = self.model[catalog][schema][table]
        except KeyError:
            raise RuntimeError(f"[TABLE_OR_VIEW_NOT_FOUND] {fqn}")
        rows = [[c, t, cm] for c, t, cm in spec["columns"]]
        if spec.get("partitioned_by"):
            rows.append(["# Partition Information", "", ""])
            rows.append(["# col_name", "data_type", "comment"])
            for col in spec["partitioned_by"]:
                dtype = next(t for c, t, _ in spec["columns"] if c == col)
                rows.append([col, dtype, None])
        return FakeDF(["col_name", "data_type", "comment"], rows)

    def info_queries(self, needle=""):
        return [q for q, _ in self.queries if "information_schema" in q and needle in q]


def T(columns, **extra):
    spec = {"columns": columns}
    spec.update(extra)
    return spec


def sales_model():
    return {
        "main": {
            "sales": {
                "customers": T([("customer_id", "BIGINT", "Customer surrogate key"), ("customer_name", "STRING", None),
                                ("region_id", "BIGINT", None), ("signup_date", "DATE", None)],
                               comment="One row per customer account", pk=["customer_id"],
                               tags={"domain": "sales"}, column_tags={"customer_name": {"pii": "direct"}}),
                "orders": T([("order_id", "BIGINT", None), ("customer_id", "BIGINT", None),
                             ("order_ts", "TIMESTAMP", None), ("amount", "DECIMAL", "Order total")],
                            comment="One row per order", pk=["order_id"],
                            fks=[{"name": "fk_orders_customer", "cols": ["customer_id"],
                                  "ref": ("main", "sales", "customers"), "ref_cols": ["customer_id"]}]),
                "order_lines": T([("order_id", "BIGINT", None), ("line_no", "INT", None), ("sku", "STRING", None),
                                  ("qty", "INT", None)], pk=["order_id", "line_no"]),
                "shipment_lines": T([("shipment_id", "BIGINT", None), ("ship_line_no", "INT", None),
                                     ("ship_order_id", "BIGINT", None), ("shipped_ts", "TIMESTAMP", None)],
                                    pk=["shipment_id"],
                                    fks=[{"name": "fk_ship_order_line", "cols": ["ship_line_no", "ship_order_id"],
                                          "ref": ("main", "sales", "order_lines"), "ref_cols": ["line_no", "order_id"]}]),
            },
            "ref": {
                "regions": T([("region_id", "BIGINT", None), ("region_name", "STRING", None)], pk=["region_id"]),
            },
        },
        "hr": {
            "people": {
                "staff": T([("staff_id", "BIGINT", None), ("customer_id", "BIGINT", None)], pk=["staff_id"],
                           fks=[{"name": "fk_staff_customer", "cols": ["customer_id"],
                                 "ref": ("main", "sales", "customers"), "ref_cols": ["customer_id"]}]),
            },
        },
    }


@pytest.fixture
def make_loader(agent_ns, monkeypatch):
    def _make(spark, catalogs="", schemas="", tables="", sampling=True):
        monkeypatch.setattr(agent_ns["SparkSession"].builder, "getOrCreate", staticmethod(lambda: spark))
        logger = CapturingLogger()
        loader = agent_ns["DataLoader"](catalogs=catalogs, schemas=schemas, tables=tables, logger=logger,
                                        enable_two_pass=True, enable_column_sampling=sampling, max_parallelism=4)
        return loader, logger
    return _make


def drain_tables(loader):
    out = []
    while True:
        batch = loader.getNextTables(25)
        if batch is None:
            return out
        out.extend(batch)


# --------------------------------------------------------------------------- loader / evidence


def test_c02_composite_fk_pairs_columns_by_position(make_loader):
    spark = SqliteSpark(sales_model())
    loader, _ = make_loader(spark, schemas="main.sales")
    drain_tables(loader)
    rels = loader.foreign_key_graph[("main", "sales", "shipment_lines")]
    pairs = sorted((r[3], r[6], r[7]) for r in rels)
    assert pairs == [("ship_line_no", "order_lines", "line_no"), ("ship_order_id", "order_lines", "order_id")], pairs


def test_c02_ordinal_pairing_fallback_when_position_column_is_unavailable(make_loader):
    model = sales_model()
    model["main"]["sales"]["shipment_lines"]["fks"] = [{"name": "fk_ship_order_line", "cols": ["ship_order_id", "ship_line_no"],
                                                        "ref": ("main", "sales", "order_lines"), "ref_cols": ["order_id", "line_no"]}]
    spark = SqliteSpark(model, fail_once=[(r"position_in_unique_constraint", "[UNRESOLVED_COLUMN] position_in_unique_constraint")])
    loader, _ = make_loader(spark, schemas="main.sales")
    rels = loader.get_foreign_key_relations({("main", "sales", "shipment_lines")})
    assert sorted((r[3], r[7]) for r in rels) == [("ship_line_no", "line_no"), ("ship_order_id", "order_id")]


def test_c02_single_column_fk_still_resolves(make_loader):
    loader, _ = make_loader(SqliteSpark(sales_model()), schemas="main.sales")
    rels = loader.get_foreign_key_relations({("main", "sales", "orders")})
    assert rels == [("main", "sales", "orders", "customer_id", "main", "sales", "customers", "customer_id")]


def test_c02_cross_catalog_fk_target_is_resolved(make_loader):
    loader, _ = make_loader(SqliteSpark(sales_model()), schemas="hr.people")
    rels = loader.get_foreign_key_relations({("hr", "people", "staff")})
    assert rels == [("hr", "people", "staff", "customer_id", "main", "sales", "customers", "customer_id")]


def test_c10_table_comments_reach_loader_and_evidence(make_loader):
    loader, _ = make_loader(SqliteSpark(sales_model()), schemas="main.sales")
    drain_tables(loader)
    assert loader.get_table_comment("main", "sales", "orders") == "One row per order"
    ev = loader.get_metadata_evidence(["main.sales.customers"])
    assert ev["main.sales.customers"]["comment"] == "One row per customer account"


def test_c07_metadata_queries_are_batched_per_schema_not_per_table(make_loader):
    model = sales_model()
    for i in range(40):
        model["main"]["sales"][f"wide_{i:02d}"] = T([("id", "BIGINT", None), ("v", "DOUBLE", None)])
    spark = SqliteSpark(model)
    loader, _ = make_loader(spark, schemas="main.sales")
    rows = drain_tables(loader)
    assert len({(r[0], r[1], r[2]) for r in rows}) == 44
    column_queries = [q for q in spark.info_queries("`columns`") if "column_name" in q]
    fk_queries = spark.info_queries("FOREIGN KEY")
    assert len(column_queries) <= 2, f"expected batched column loads, got {len(column_queries)} queries"
    assert len(fk_queries) <= 2, f"expected batched FK loads, got {len(fk_queries)} queries"


def test_c07_single_pass_mode_also_batches_metadata(agent_ns, monkeypatch):
    model = sales_model()
    for i in range(20):
        model["main"]["sales"][f"extra_{i:02d}"] = T([("id", "BIGINT", None)])
    spark = SqliteSpark(model)
    monkeypatch.setattr(agent_ns["SparkSession"].builder, "getOrCreate", staticmethod(lambda: spark))
    loader = agent_ns["DataLoader"](catalogs="", schemas="main.sales", tables="", logger=CapturingLogger(),
                                    enable_two_pass=False, enable_column_sampling=True, max_parallelism=4)
    rows = drain_tables(loader)
    assert len({r[2] for r in rows}) == 24
    column_queries = [q for q in spark.info_queries("`columns`") if "column_name" in q]
    assert len(column_queries) == 1, f"25-table single-pass batch must load columns in one query, got {len(column_queries)}"


def test_c11_failed_fk_load_is_not_cached_and_is_retried(make_loader):
    spark = SqliteSpark(sales_model(), fail_once=[(r"FOREIGN KEY", "metastore blip"), (r"FOREIGN KEY", "metastore blip")])
    loader, logger = make_loader(spark, schemas="main.sales")
    first = loader.get_foreign_key_relations({("main", "sales", "orders")})
    assert first == []
    assert logger.matching("not cached", level="WARNING")
    second = loader.get_foreign_key_relations({("main", "sales", "orders")})
    assert second == [("main", "sales", "orders", "customer_id", "main", "sales", "customers", "customer_id")]


def test_c11_successful_empty_fk_result_is_cached(make_loader):
    spark = SqliteSpark(sales_model())
    loader, _ = make_loader(spark, schemas="main.ref")
    loader.get_foreign_key_relations({("main", "ref", "regions")})
    before = len(spark.info_queries("FOREIGN KEY"))
    loader.get_foreign_key_relations({("main", "ref", "regions")})
    assert len(spark.info_queries("FOREIGN KEY")) == before


def test_c21_get_foreign_key_relations_lazy_loads_unseen_tables(make_loader):
    loader, _ = make_loader(SqliteSpark(sales_model()), schemas="main.sales")
    assert not loader.foreign_key_graph
    rels = loader.get_foreign_key_relations({("main", "sales", "orders")})
    assert rels and rels[0][6] == "customers"


def test_c01_catalog_without_information_schema_expands_via_show(make_loader):
    spark = SqliteSpark(sales_model(), no_info_schema={"main"})
    loader, _ = make_loader(spark, catalogs="main")
    assert ("main", "sales") in loader.database_queue
    assert ("main", "ref") in loader.database_queue
    rows = drain_tables(loader)
    assert {r[2] for r in rows} >= {"orders", "customers", "regions"}


def test_c03_paginated_table_listing_terminates_and_pages(make_loader):
    model = sales_model()
    for i in range(1001):
        model["main"]["sales"][f"t{i:04d}"] = T([("id", "BIGINT", None)])
    spark = SqliteSpark(model)
    loader, _ = make_loader(spark, schemas="main.sales")
    first = loader._fetch_tables_for_schema("main", "sales", limit=1500, offset=0)
    assert len(first) == 1005
    assert not [q for q, _ in spark.queries if q.strip().upper().startswith("SHOW TABLES")], \
        "information_schema listing must not fall back to SHOW TABLES"
    page = loader._fetch_tables_for_schema("main", "sales", limit=10, offset=10)
    assert len(page) == 10 and page == first[10:20]


def test_c08_describe_failure_is_logged_with_fqn(make_loader):
    model = sales_model()
    model["main"]["sales"]["secret"] = T([("x", "STRING", None)], info_columns=False)
    spark = SqliteSpark(model, describe_denied={"main.sales.secret"})
    loader, logger = make_loader(spark, schemas="main.sales")
    assert loader._get_table_details("main", "sales", "secret") == []
    warnings = logger.matching("main.sales.secret", level="WARNING")
    assert any("permission denied" in w for w in warnings), warnings


def test_c08_describe_fallback_ignores_partition_section(make_loader):
    model = sales_model()
    model["main"]["sales"]["events"] = T([("event_id", "BIGINT", None), ("day", "DATE", None)],
                                         info_columns=False, partitioned_by=["day"])
    loader, _ = make_loader(SqliteSpark(model), schemas="main.sales")
    cols = [r[3] for r in loader._get_table_details("main", "sales", "events")]
    assert cols == ["event_id", "day"]


def test_a6_table_names_with_quotes_do_not_break_sizing(make_loader, agent_ns):
    model = sales_model()
    model["main"]["sales"]["o'brien"] = T([("id", "BIGINT", None), ("v", "INT", None)])
    spark = SqliteSpark(model)
    loader, logger = make_loader(spark, schemas="main.sales")
    infos = loader.size_analyzer.analyze_table_sizes_batch([("main", "sales", "o'brien"), ("main", "sales", "orders")],
                                                           {"main": True}, max_parallelism=1)
    sizes = {i.table: (i.num_columns, i.size_category) for i in infos}
    assert sizes["o'brien"] == (2, "small")
    assert sizes["orders"] == (4, "small")


def test_a5_failed_sizing_reports_unknown_not_fabricated_medium(make_loader):
    model = sales_model()
    model["main"]["sales"]["ghost"] = T([("x", "STRING", None)], info_columns=False)
    spark = SqliteSpark(model, describe_denied={"main.sales.ghost"},
                        fail_once=[(r"COUNT\(\*\) as num_columns", "boom")])
    loader, logger = make_loader(spark, schemas="main.sales")
    infos = loader.size_analyzer.analyze_table_sizes_batch([("main", "sales", "orders"), ("main", "sales", "ghost")],
                                                           {"main": True}, max_parallelism=1)
    sizes = {i.table: (i.num_columns, i.size_category) for i in infos}
    assert sizes["orders"] == (4, "small"), "sizing must fall back to DESCRIBE, not invent 50 columns"
    assert sizes["ghost"] == (0, "unknown")
    assert all(i.num_columns != 50 for i in infos)
    assert logger.matching("main.sales.ghost", level="WARNING")


def test_unknown_size_gets_conservative_batch_weight(agent_ns):
    TableSizeInfo = agent_ns["TableSizeInfo"]
    assert TableSizeInfo("c", "s", "t", num_columns=0, size_category="unknown").memory_weight == 1250
    assert TableSizeInfo("c", "s", "t", num_columns=42, size_category="small").memory_weight == 42
    assert TableSizeInfo("c", "s", "t", num_columns=42).memory_weight == 42


def test_get_metadata_evidence_contract(make_loader):
    spark = SqliteSpark(sales_model())
    loader, _ = make_loader(spark, schemas="main.sales")
    ev = loader.get_metadata_evidence(["main.sales.orders", "`main`.`sales`.`customers`", "main.sales.nope", "bad"])
    assert set(ev) == {"main.sales.orders", "main.sales.customers"}
    orders = ev["main.sales.orders"]
    assert set(orders) == {"comment", "table_type", "data_source_format", "last_altered", "tags", "columns",
                           "primary_key", "foreign_keys"}
    assert orders["table_type"] == "MANAGED" and orders["data_source_format"] == "DELTA"
    assert list(orders["columns"]) == ["order_id", "customer_id", "order_ts", "amount"]
    assert orders["columns"]["amount"] == {"name": "amount", "type": "DECIMAL", "comment": "Order total",
                                           "nullable": True, "tags": {}}
    assert orders["columns"]["order_id"]["nullable"] is False
    assert orders["primary_key"] == ["order_id"]
    assert orders["foreign_keys"] == [{"column": "customer_id", "ref_table": "main.sales.customers",
                                       "ref_column": "customer_id", "source": "declared", "confidence": 1.0}]
    customers = ev["main.sales.customers"]
    assert customers["tags"] == {"domain": "sales"}
    assert customers["columns"]["customer_name"]["tags"] == {"pii": "direct"}


def test_get_metadata_evidence_returns_full_columns_for_sampled_tables(make_loader):
    model = sales_model()
    model["main"]["sales"]["wide"] = T([(f"attr_{i:03d}", "STRING", None) for i in range(400)])
    loader, _ = make_loader(SqliteSpark(model), schemas="main.sales")
    sampled = loader._get_table_details("main", "sales", "wide")
    assert len(sampled) < 400
    ev = loader.get_metadata_evidence(["main.sales.wide"])
    assert len(ev["main.sales.wide"]["columns"]) == 400


def test_get_metadata_evidence_is_cached_and_batched(make_loader):
    spark = SqliteSpark(sales_model())
    loader, _ = make_loader(spark, schemas="main.sales")
    loader.get_metadata_evidence(["main.sales.orders", "main.sales.customers", "main.sales.order_lines"])
    n = len(spark.queries)
    assert len([q for q in spark.info_queries("`columns`") if "column_name" in q]) == 1
    loader.get_metadata_evidence(["main.sales.orders", "main.sales.customers"])
    assert len(spark.queries) == n


def test_get_metadata_evidence_logs_missing_tables(make_loader):
    loader, logger = make_loader(SqliteSpark(sales_model()), schemas="main.sales")
    assert loader.get_metadata_evidence(["main.sales.nope"]) == {}
    assert logger.matching("main.sales.nope", level="WARNING")


def test_get_metadata_evidence_tags_fail_soft(make_loader):
    spark = SqliteSpark(sales_model(), fail_once=[(r"`table_tags`", "tags not enabled")])
    loader, logger = make_loader(spark, schemas="main.sales")
    ev = loader.get_metadata_evidence(["main.sales.customers"])
    assert ev["main.sales.customers"]["tags"] == {}
    assert ev["main.sales.customers"]["columns"]["customer_id"]["name"] == "customer_id"
    assert logger.matching("Tag metadata unavailable", level="WARNING")


def test_get_metadata_evidence_marks_inferred_fks(make_loader):
    loader, _ = make_loader(SqliteSpark(sales_model()), schemas="main.sales")
    rows = drain_tables(loader)
    region_cols = loader._get_table_details("main", "ref", "regions")
    loader.merge_inferred_foreign_keys(rows + region_cols)
    fks = loader.get_metadata_evidence(["main.sales.customers"])["main.sales.customers"]["foreign_keys"]
    assert fks == [{"column": "region_id", "ref_table": "main.ref.regions", "ref_column": "region_id",
                    "source": "inferred", "confidence": 0.95}]


# --------------------------------------------------------------------------- FK inference


def cols(table, *specs, catalog="c", schema="s"):
    return [(catalog, schema, table, name, dtype, None) for name, dtype in specs]


def plain_loader(agent_ns):
    DataLoader = agent_ns["DataLoader"]
    loader = DataLoader.__new__(DataLoader)
    loader.logger = CapturingLogger()
    loader.foreign_key_graph = __import__("collections").defaultdict(list)
    loader._metadata_lock = threading.RLock()
    loader.primary_keys = {}
    loader._inferred_fk = {}
    loader._join_inferred_schemas = set()
    return loader


def inferred_targets(loader, details):
    return {(k[2], r[3]): (r[6], r[7]) for k, rels in loader.infer_foreign_keys_by_naming(details).items() for r in rels}


def test_c04_no_first_id_column_fallback_as_primary_key(agent_ns):
    loader = plain_loader(agent_ns)
    details = cols("orders", ("order_id", "bigint"), ("customer_id", "bigint")) + \
        cols("customers", ("region_id", "bigint"), ("customer_name", "string"))
    assert ("orders", "customer_id") not in inferred_targets(loader, details)


def test_c04_kimball_prefixed_key_links_to_matching_surrogate_not_business_id(agent_ns):
    loader = plain_loader(agent_ns)
    details = cols("web_sales", ("ws_customer_sk", "int"), ("ws_item_sk", "int")) + \
        cols("customer", ("c_customer_id", "string"), ("c_customer_sk", "int")) + \
        cols("item", ("i_item_id", "string"), ("i_item_sk", "int"))
    targets = inferred_targets(loader, details)
    assert targets[("web_sales", "ws_customer_sk")] == ("customer", "c_customer_sk")
    assert targets[("web_sales", "ws_item_sk")] == ("item", "i_item_sk")


def test_c04_type_mismatch_blocks_link(agent_ns):
    loader = plain_loader(agent_ns)
    details = cols("orders", ("customer_id", "string")) + cols("customers", ("id", "bigint"))
    assert ("orders", "customer_id") not in inferred_targets(loader, details)


def test_inference_keeps_common_true_positives(agent_ns):
    loader = plain_loader(agent_ns)
    details = cols("orders", ("order_id", "bigint"), ("customer_id", "bigint")) + \
        cols("customers", ("id", "bigint"), ("name", "string")) + \
        cols("Order_Details", ("ProductID", "int")) + cols("Products", ("ProductID", "int"))
    targets = inferred_targets(loader, details)
    assert targets[("orders", "customer_id")] == ("customers", "id")
    assert targets[("Order_Details", "ProductID")] == ("Products", "ProductID")


def test_c06_singular_plural_collisions_resolve_to_same_schema_or_skip(agent_ns):
    loader = plain_loader(agent_ns)
    details = cols("order_lines", ("order_id", "bigint"), schema="sales") + \
        cols("orders", ("order_id", "bigint"), schema="sales") + \
        cols("order", ("order_id", "bigint"), schema="archive")
    assert inferred_targets(loader, details)[("order_lines", "order_id")] == ("orders", "order_id")
    loader2 = plain_loader(agent_ns)
    ambiguous = cols("facts", ("order_id", "bigint"), schema="mart") + \
        cols("orders", ("order_id", "bigint"), schema="sales") + \
        cols("order", ("order_id", "bigint"), schema="archive")
    assert ("facts", "order_id") not in inferred_targets(loader2, ambiguous)


def test_c06_status_table_is_not_truncated_by_naive_singularisation(agent_ns):
    loader = plain_loader(agent_ns)
    details = cols("tickets", ("statu_id", "bigint")) + cols("status", ("statu_id", "bigint"))
    assert ("tickets", "statu_id") not in inferred_targets(loader, details)


def test_c19_prefix_strip_requires_key_name_equality(agent_ns):
    loader = plain_loader(agent_ns)
    details = cols("visits", ("ab_customer_ref", "bigint")) + cols("customer", ("customer_id", "bigint"))
    assert ("visits", "ab_customer_ref") not in inferred_targets(loader, details)


def test_c20_concatenated_code_without_matching_key_is_not_linked(agent_ns):
    loader = plain_loader(agent_ns)
    details = cols("tickets", ("statuscode", "string"), ("zipcode", "string")) + \
        cols("status", ("id", "bigint"), ("label", "string"))
    targets = inferred_targets(loader, details)
    assert ("tickets", "statuscode") not in targets
    assert ("tickets", "zipcode") not in targets


def test_own_identifier_never_links_to_a_same_named_table_elsewhere(agent_ns):
    loader = plain_loader(agent_ns)
    details = cols("orders", ("order_id", "bigint"), schema="sales") + \
        cols("order", ("order_id", "bigint"), schema="archive")
    assert ("orders", "order_id") not in inferred_targets(loader, details)


def test_c05_inferred_fks_not_merged_into_tables_with_declared_fks(agent_ns):
    loader = plain_loader(agent_ns)
    declared = ("c", "s", "orders", "customer_id", "c", "s", "customers", "id")
    loader.foreign_key_graph[("c", "s", "orders")] = [declared]
    details = cols("orders", ("customer_id", "bigint"), ("region_id", "bigint")) + \
        cols("customers", ("id", "bigint")) + cols("regions", ("region_id", "bigint")) + \
        cols("invoices", ("region_id", "bigint"))
    added = loader.merge_inferred_foreign_keys(details)
    assert loader.foreign_key_graph[("c", "s", "orders")] == [declared]
    assert loader.foreign_key_graph[("c", "s", "invoices")] == [("c", "s", "invoices", "region_id", "c", "s", "regions", "region_id")]
    assert added == 1


def test_c05_second_merge_pass_still_extends_inferred_only_tables(agent_ns):
    loader = plain_loader(agent_ns)
    loader.merge_inferred_foreign_keys(cols("invoices", ("region_id", "bigint")) + cols("regions", ("region_id", "bigint")))
    added = loader.merge_inferred_foreign_keys(
        cols("invoices", ("region_id", "bigint"), ("store_id", "bigint")) + cols("regions", ("region_id", "bigint")) +
        cols("stores", ("store_id", "bigint")))
    assert added == 1
    assert len(loader.foreign_key_graph[("c", "s", "invoices")]) == 2


# --------------------------------------------------------------------------- column sampler (A3 / C-09 / A22)


def wide_columns(n_string=300):
    columns = [("c", "s", "w", f"attr_{i:03d}", "string", None) for i in range(n_string)]
    columns += [("c", "s", "w", f"thing_{i:02d}_id", "bigint", None) for i in range(80)]
    columns += [("c", "s", "w", "event_ts", "timestamp", None), ("c", "s", "w", "net_amount", "decimal(12,2)", None),
                ("c", "s", "w", "owner_note", "string", "Owner-written meaning"), ("c", "s", "w", "parent_ref", "string", None)]
    return columns


def test_a3_sampler_never_drops_evidence_columns(agent_ns):
    sampler = agent_ns["ColumnSampler"](CapturingLogger())
    info = agent_ns["TableSizeInfo"]("c", "s", "w", num_columns=384)
    sampled, was_sampled = sampler.sample_columns(wide_columns(), info, protected_columns={"PARENT_REF"})
    names = [c[3] for c in sampled]
    assert was_sampled and len(sampled) <= 200
    for must in ("event_ts", "net_amount", "owner_note", "parent_ref"):
        assert must in names, must


def test_a3_sampler_caps_key_like_columns(agent_ns):
    sampler = agent_ns["ColumnSampler"](CapturingLogger())
    info = agent_ns["TableSizeInfo"]("c", "s", "w", num_columns=384)
    sampled, _ = sampler.sample_columns(wide_columns(), info)
    key_like = [c for c in sampled if c[3].endswith("_id")]
    assert len(key_like) == agent_ns["ColumnSampler"].KEY_COLUMN_CAP


def test_a3_sampler_keeps_original_column_order(agent_ns):
    sampler = agent_ns["ColumnSampler"](CapturingLogger())
    info = agent_ns["TableSizeInfo"]("c", "s", "w", num_columns=384)
    source = wide_columns()
    sampled, _ = sampler.sample_columns(source, info)
    positions = [source.index(c) for c in sampled]
    assert positions == sorted(positions)


def test_a22_sampler_log_reports_true_counts(agent_ns):
    logger = CapturingLogger()
    sampler = agent_ns["ColumnSampler"](logger)
    info = agent_ns["TableSizeInfo"]("c", "s", "w", num_columns=384)
    sampled, _ = sampler.sample_columns(wide_columns(), info)
    msg = logger.matching("Sampled wide table")[-1]
    assert f"-> {len(sampled)} cols" in msg
    assert "3 evidence cols kept" in msg and "50/81 key-like" in msg and "147/300 other" in msg, \
        "parent_ref is identifier-like under the shared key-name rule"


def test_loader_protects_declared_keys_when_sampling(make_loader):
    model = sales_model()
    columns = [(f"attr_{i:03d}", "STRING", None) for i in range(300)] + [("zz_parent_code", "STRING", None)]
    model["main"]["sales"]["wide"] = T(columns + [("wide_key", "STRING", None)], pk=["wide_key"],
                                       fks=[{"name": "fk_w", "cols": ["zz_parent_code"],
                                             "ref": ("main", "ref", "regions"), "ref_cols": ["region_id"]}])
    loader, _ = make_loader(SqliteSpark(model), schemas="main.sales")
    loader.get_foreign_key_relations({("main", "sales", "wide")})
    names = [r[3] for r in loader._get_table_details("main", "sales", "wide")]
    assert "wide_key" in names and "zz_parent_code" in names
    assert loader.get_sampling_info("main", "sales", "wide") == (len(names), 302)


# --------------------------------------------------------------------------- DatabricksInspire doubles


class FakeStorage:
    def __init__(self):
        self.saved = {}

    def load_schema_markdown(self, tag="schema_markdown"):
        return self.saved.get(tag)

    def save_schema_markdown(self, markdown, tag="schema_markdown"):
        self.saved[tag] = markdown


TABLE_LINE = re.compile(r"^- `([^`]+)`\.`([^`]+)`\.`([^`]+)`", re.M)


def classifier(labels, omit=(), rename=None, reason="ok"):
    """LLM double: classifies every requested table by `labels[fqn]` = (classification, category)."""
    omit = set(omit)

    def respond(prompt_vars, call_no):
        rows = ['"Table Name","Classification","Data Category","Business Score","Reason","honesty_score","honesty_justification"']
        for cat, sch, tbl in TABLE_LINE.findall(prompt_vars["tables_markdown"]):
            fqn = f"{cat}.{sch}.{tbl}"
            if fqn in omit:
                continue
            cls, category = labels.get(fqn, ("BUSINESS", "MASTER"))
            name = (rename or {}).get(fqn, fqn)
            score = "0" if cls == "TECHNICAL" else "80"
            rows.append(f'"{name}","{cls}","{category}","{score}","{reason}","90","ok"')
        return "\n".join(rows)
    return respond


class FakeAgent:
    def __init__(self, ns, responder):
        AIAgent = ns["AIAgent"]
        self.prompt_templates = ns["PROMPT_TEMPLATES"]
        self.logger = CapturingLogger()
        self._UNESCAPED_BRACE_RE = AIAgent._UNESCAPED_BRACE_RE
        self._sanitize_template_braces = types.MethodType(AIAgent._sanitize_template_braces, self)
        self._load_and_format_prompt = types.MethodType(AIAgent._load_and_format_prompt, self)
        self.responder = responder
        self.calls = []
        self._lock = threading.Lock()

    def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema=None, skip_cache=False, **kw):
        prompt = self._load_and_format_prompt(worker_prompt_path, prompt_vars)
        with self._lock:
            self.calls.append({"step": step_name, "prompt": prompt, "vars": dict(prompt_vars), "skip_cache": skip_cache})
            n = len(self.calls)
        return self.responder(prompt_vars, n)


def make_inspire(ns, loader=None, responder=None, **attrs):
    DI = ns["DatabricksInspire"]
    obj = DI.__new__(DI)
    obj.logger = CapturingLogger()
    obj.data_loader = loader
    obj.business_name = "Acme"
    obj.max_parallelism = 4
    obj.llm_timeout_seconds = 30
    obj.max_retry_attempts = 1
    obj.parsed_generation_instructions = {}
    obj.user_generation_instructions = ""
    obj.additional_context = ""
    obj.storage_manager = FakeStorage()
    obj.ai_agent = FakeAgent(ns, responder or classifier({}))
    obj.__dict__.update(attrs)
    return obj


def details_for(*fqns_and_cols):
    out = []
    for fqn, columns in fqns_and_cols:
        c, s, t = fqn.split(".")
        out.extend((c, s, t, name, dtype, None) for name, dtype in columns)
    return out


FILTER_DETAILS = details_for(
    ("main.sales.orders", [("order_id", "bigint"), ("order_ts", "timestamp"), ("amount", "decimal")]),
    ("main.sales.customers", [("customer_id", "bigint"), ("name", "string")]),
    ("main.ops.job_logs", [("run_id", "bigint"), ("stderr", "string")]),
    ("main.ops.tmp_scratch", [("x", "string")]),
)


def unpack(result):
    keys = ("business_details", "technical_details", "business", "technical", "scores", "category",
            "master", "transactional", "reference")
    assert len(result) == 9
    return dict(zip(keys, result))


# --------------------------------------------------------------------------- table filter


def test_h1_empty_input_returns_nine_tuple(agent_ns):
    obj = make_inspire(agent_ns)
    assert obj._filter_business_tables([]) == ([], [], set(), set(), {}, {}, set(), set(), set())


def test_h2_filter_prompt_shows_table_comment_and_column_names_types(agent_ns, make_loader):
    loader, _ = make_loader(SqliteSpark(sales_model()), schemas="main.sales")
    rows = drain_tables(loader)
    obj = make_inspire(agent_ns, loader=loader, responder=classifier({}))
    obj._filter_business_tables(rows)
    prompt = obj.ai_agent.calls[0]["vars"]["tables_markdown"]
    orders_line = next(line for line in prompt.splitlines() if "`orders`" in line)
    assert "comment: One row per order" in orders_line
    assert "order_ts timestamp" in orders_line and "amount decimal" in orders_line
    assert "columns (4)" in orders_line


def test_h4_omitted_table_is_retried_then_kept_unverified_never_dropped(agent_ns):
    labels = {"main.ops.job_logs": ("TECHNICAL", "TECHNICAL")}
    obj = make_inspire(agent_ns, responder=classifier(labels, omit={"main.sales.customers"}))
    out = unpack(obj._filter_business_tables(FILTER_DETAILS))
    assert "main.sales.customers" in out["business"]
    assert "main.sales.customers" not in out["technical"]
    assert out["category"]["main.sales.customers"] == "MASTER"
    assert obj.table_classification_status["main.sales.customers"] == "unverified"
    assert obj.table_classification_status["main.sales.orders"] == "verified"
    assert obj.logger.matching("classification_status=unverified", level="WARNING")
    assert len(obj.ai_agent.calls) == 5, "first pass + 2 retries x 2 parse attempts for the omitted table"
    assert [c["skip_cache"] for c in obj.ai_agent.calls] == [False, False, True, False, True]
    assert "main.ops.job_logs" in out["technical"], "must-exclude: a TECHNICAL verdict is honoured"


def test_h4_omitted_table_classified_on_retry_is_verified(agent_ns):
    state = {"n": 0}
    base = classifier({"main.ops.job_logs": ("TECHNICAL", "TECHNICAL")})
    first = classifier({"main.ops.job_logs": ("TECHNICAL", "TECHNICAL")}, omit={"main.sales.orders"})

    def responder(prompt_vars, call_no):
        state["n"] += 1
        return first(prompt_vars, call_no) if state["n"] == 1 else base(prompt_vars, call_no)

    obj = make_inspire(agent_ns, responder=responder)
    unpack(obj._filter_business_tables(FILTER_DETAILS))
    assert obj.table_classification_status["main.sales.orders"] == "verified"
    retry_call = obj.ai_agent.calls[1]
    assert "`orders`" in retry_call["vars"]["tables_markdown"]
    assert "`customers`" not in retry_call["vars"]["tables_markdown"]


def test_h3_parse_failure_keeps_tables_unverified_with_warning(agent_ns):
    obj = make_inspire(agent_ns, responder=lambda pv, n: "I could not do that")
    out = unpack(obj._filter_business_tables(FILTER_DETAILS))
    assert out["business"] == {"main.sales.orders", "main.sales.customers", "main.ops.job_logs", "main.ops.tmp_scratch"}
    assert set(obj.table_classification_status.values()) == {"unverified"}
    assert obj.logger.matching("classification_status=unverified", level="WARNING")


def test_h3_whole_filter_exception_keeps_tables_unverified_not_technical(agent_ns):
    obj = make_inspire(agent_ns)

    def broken(*a, **k):
        raise RuntimeError("template store unavailable")
    obj.ai_agent._load_and_format_prompt = broken
    out = unpack(obj._filter_business_tables(FILTER_DETAILS))
    assert not out["technical"]
    assert len(out["business"]) == 4
    assert set(obj.table_classification_status.values()) == {"unverified"}


def test_h3_unverified_tables_emit_next_action(agent_ns):
    before = len(agent_ns["NEXT_ACTIONS"].snapshot())
    obj = make_inspire(agent_ns, responder=lambda pv, n: "")
    obj._filter_business_tables(FILTER_DETAILS)
    new = agent_ns["NEXT_ACTIONS"].snapshot()[before:]
    assert any(a["rule_id"] == "TABLE_FILTER_PARSE_FAILED" for a in new)


def test_h4_classifier_names_are_mapped_back_to_requested_tables(agent_ns):
    rename = {"main.sales.orders": "SALES.ORDERS", "main.sales.customers": 'main."sales"."customers"',
              "main.ops.job_logs": "job_logs"}
    obj = make_inspire(agent_ns, responder=classifier({"main.ops.job_logs": ("TECHNICAL", "TECHNICAL")}, rename=rename))
    out = unpack(obj._filter_business_tables(FILTER_DETAILS))
    assert {"main.sales.orders", "main.sales.customers"} <= out["business"]
    assert "main.ops.job_logs" in out["technical"]
    assert set(obj.table_classification_status.values()) == {"verified"}
    assert len(obj.ai_agent.calls) == 1


def test_filter_survives_brackets_in_reason_text(agent_ns):
    obj = make_inspire(agent_ns, responder=classifier({}, reason="joins on [order_id] {key}"))
    obj._filter_business_tables(FILTER_DETAILS)
    assert set(obj.table_classification_status.values()) == {"verified"}
    assert len(obj.ai_agent.calls) == 1


def test_h5_user_table_ignores_are_enforced_and_reach_the_prompt(agent_ns):
    parsed = {"table_ignores": [{"pattern": "tmp_*", "type": "prefix"}, {"pattern": "ops.job_logs", "type": "exact"}]}
    obj = make_inspire(agent_ns, responder=classifier({}), parsed_generation_instructions=parsed,
                       user_generation_instructions="Ignore scratch tables and the job logs.")
    out = unpack(obj._filter_business_tables(FILTER_DETAILS))
    assert {"main.ops.tmp_scratch", "main.ops.job_logs"} <= out["technical"]
    assert {"main.sales.orders", "main.sales.customers"} <= out["business"], "must-include: other tables still classified"
    assert obj.table_classification_status["main.ops.tmp_scratch"] == "user_ignored"
    call = obj.ai_agent.calls[0]
    assert "tmp_scratch" not in call["vars"]["tables_markdown"]
    assert call["vars"]["generation_instructions_section"] == obj._get_generation_instruction_for_prompt(
        "FILTER_BUSINESS_TABLES_PROMPT")
    assert "IGNORE TABLES matching `tmp_*` (prefix)" in call["prompt"]
    assert call["prompt"].count("Ignore scratch tables and the job logs.") == 1
    assert "Ignore scratch tables" not in call["vars"]["additional_context_section"]
    assert call["prompt"].count("Goals are not exclusions") == 1


def test_h5_prefix_rule_does_not_match_schema_names(agent_ns):
    details = details_for(("main.tmp_area.orders", [("order_id", "bigint")]))
    parsed = {"table_ignores": [{"pattern": "tmp_", "type": "prefix"}]}
    obj = make_inspire(agent_ns, responder=classifier({}), parsed_generation_instructions=parsed)
    out = unpack(obj._filter_business_tables(details))
    assert "main.tmp_area.orders" in out["business"]


def test_h8_filter_batches_are_sized_from_real_lines_without_100_floor(agent_ns, monkeypatch):
    details = details_for(*[(f"main.s.t{i:03d}", [("id", "bigint"), ("val", "string")]) for i in range(30)])
    probe = make_inspire(agent_ns, responder=classifier({}))
    probe._filter_business_tables(details)
    first_call = probe.ai_agent.calls[0]
    base = len(first_call["prompt"]) - len(first_call["vars"]["tables_markdown"])
    line = len(first_call["vars"]["tables_markdown"].splitlines()[0]) + 1
    limit = int((base + 3 * line + 2) / 0.8) + 1
    monkeypatch.setitem(agent_ns, "get_max_context_chars", lambda language="English", prompt_name=None: limit)
    obj = make_inspire(agent_ns, responder=classifier({}))
    obj._filter_business_tables(details)
    assert len(obj.ai_agent.calls) >= 8
    assert not obj.logger.matching("Batch too large")
    for call in obj.ai_agent.calls:
        assert len(call["prompt"]) <= limit
    assert set(obj.table_classification_status.values()) == {"verified"}


def test_h11_retry_reference_tables_count_as_business_like_first_pass(agent_ns):
    labels = {"main.sales.customers": ("BUSINESS", "REFERENCE")}
    state = {"n": 0}
    first = classifier(labels, omit={"main.sales.customers"})
    rest = classifier(labels)

    def responder(prompt_vars, call_no):
        state["n"] += 1
        return first(prompt_vars, call_no) if state["n"] == 1 else rest(prompt_vars, call_no)

    obj = make_inspire(agent_ns, responder=responder)
    out = unpack(obj._filter_business_tables(FILTER_DETAILS))
    assert "main.sales.customers" in out["reference"]
    assert "main.sales.customers" in out["business"]


def test_filter_prompt_body_requires_exact_table_names(agent_ns):
    body = agent_ns["PROMPT_TEMPLATES"]["FILTER_BUSINESS_TABLES_PROMPT"]
    assert "exactly as listed" in body
    assert "PRIMARY evidence" in body


# --------------------------------------------------------------------------- schema markdown (H-7 / H-9)


def test_h7_schema_markdown_carries_comment_category_pk_and_fk_edges(agent_ns, make_loader):
    loader, _ = make_loader(SqliteSpark(sales_model()), schemas="main.sales")
    rows = drain_tables(loader)
    loader.merge_inferred_foreign_keys(rows + loader._get_table_details("main", "ref", "regions"))
    obj = make_inspire(agent_ns, loader=loader, data_category_map={"main.sales.orders": "TRANSACTIONAL"},
                       table_classification_status={"main.sales.customers": "unverified"})
    obj.data_category_map["main.sales.customers"] = "MASTER"
    md = obj._format_schema_for_prompt([r for r in rows if r[2] in ("orders", "customers")])
    orders = md.split("### `main`.`sales`.`orders`")[1].split("###")[0]
    assert "Table comment: One row per order" in orders
    assert "Data category: TRANSACTIONAL" in orders
    assert "Primary key: order_id" in orders
    assert "Foreign keys: customer_id -> main.sales.customers.customer_id" in orders
    customers = md.split("### `main`.`sales`.`customers`")[1]
    assert "region_id -> main.ref.regions.region_id (inferred)" in customers
    assert "unverified default" in customers
    assert "| amount | DECIMAL | Order total |" in md


def test_c09_sampled_table_is_flagged_in_schema_markdown(agent_ns, make_loader):
    model = sales_model()
    model["main"]["sales"]["wide"] = T([(f"attr_{i:03d}", "STRING", None) for i in range(400)])
    loader, _ = make_loader(SqliteSpark(model), schemas="main.sales")
    sampled = loader._get_table_details("main", "sales", "wide")
    obj = make_inspire(agent_ns, loader=loader)
    assert f"Columns shown: {len(sampled)} of 400" in obj._format_schema_for_prompt(sampled)
    full = loader._get_table_details("main", "sales", "wide", apply_sampling=False)
    assert "Columns shown:" not in obj._format_schema_for_prompt(full)


def test_h7_estimate_equals_rendered_length(agent_ns, make_loader):
    loader, _ = make_loader(SqliteSpark(sales_model()), schemas="main.sales")
    rows = drain_tables(loader)
    obj = make_inspire(agent_ns, loader=loader, data_category_map={"main.sales.orders": "TRANSACTIONAL"})
    assert obj._estimate_schema_markdown_size(rows) == len(obj._format_schema_for_prompt(rows))


def test_h7_schema_markdown_sanitises_pipes_and_newlines_in_comments(agent_ns):
    obj = make_inspire(agent_ns)
    md = obj._format_schema_for_prompt([("c", "s", "t", "a", "string", "x | y\nz")])
    assert "| a | string | x / y z |" in md


def test_validation_markdown_backward_compatible_and_cached(agent_ns):
    obj = make_inspire(agent_ns)
    rows = details_for(("c.s.t", [("a", "string")]))
    md = obj._build_schema_markdown_for_validation(rows)
    assert md.startswith("## Available Tables and Columns")
    assert obj.storage_manager.saved["schema_markdown"] == md
    assert obj._build_schema_markdown_for_validation([]) == md


def test_validation_markdown_tables_subset_includes_fk_partners(agent_ns, make_loader):
    loader, _ = make_loader(SqliteSpark(sales_model()), schemas="main.sales")
    rows = drain_tables(loader)
    obj = make_inspire(agent_ns, loader=loader)
    md = obj._build_schema_markdown_for_validation(rows, tables=["main.sales.orders"])
    assert "`orders`" in md and "`customers`" in md
    assert "`order_lines`" not in md and "`shipment_lines`" not in md
    assert "schema_markdown" not in obj.storage_manager.saved
    md2 = obj._build_schema_markdown_for_validation(rows, tables=["MAIN.SALES.CUSTOMERS"])
    assert "`orders`" in md2 and "`customers`" in md2


def test_validation_markdown_cap_keeps_evidence_columns(agent_ns):
    columns = [(f"attr_{i:02d}", "string") for i in range(34)] + [("event_ts", "timestamp"), ("net_amount", "double")]
    obj = make_inspire(agent_ns)
    md = obj._build_schema_markdown_for_validation(details_for(("c.s.wide", columns)))
    assert "| event_ts |" in md and "| net_amount |" in md
    assert "(6 more columns not shown)" in md


def test_h9_oversized_single_table_is_split_by_columns(agent_ns):
    columns = [(f"col_{i:03d}", "string") for i in range(120)]
    obj = make_inspire(agent_ns)
    rows = details_for(("c.s.big", columns))
    full = obj._estimate_schema_markdown_size(rows)
    base, limit = 1000, 1000 + full // 3
    batches = obj._split_columns_to_fit_context(rows, base, limit)
    assert len(batches) >= 3
    assert sum(len(b) for b in batches) == 120
    for batch in batches:
        assert base + obj._estimate_schema_markdown_size(batch) <= limit
    assert [c for b in batches for c in b] == rows


def test_h9_small_tables_still_packed_together(agent_ns):
    obj = make_inspire(agent_ns)
    rows = details_for(("c.s.a", [("x", "int")]), ("c.s.b", [("y", "int")]))
    assert obj._split_columns_to_fit_context(rows, 10, 100000) == [rows]


def test_h15_related_table_load_failure_is_a_warning(agent_ns):
    class BrokenLoader:
        enable_column_sampling = True
        foreign_key_graph = {("c", "s", "a"): [("c", "s", "a", "b_id", "c", "s", "b", "id")]}

        def _get_table_details(self, *a, **k):
            raise RuntimeError("metastore down")

    obj = make_inspire(agent_ns, loader=BrokenLoader())
    out = obj._augment_columns_with_foreign_keys([("c", "s", "a", "b_id", "bigint", None)])
    assert len(out) == 1
    assert obj.logger.matching("c.s.b", level="WARNING")


def test_reverse_fk_graph_refreshes_when_relations_are_appended(agent_ns):
    class Loader:
        foreign_key_graph = {("c", "s", "a"): [("c", "s", "a", "x", "c", "s", "b", "x")]}
    obj = make_inspire(agent_ns, loader=Loader())
    assert len(obj._get_reverse_foreign_key_graph()[("c", "s", "b")]) == 1
    Loader.foreign_key_graph[("c", "s", "a")].append(("c", "s", "a", "y", "c", "s", "b", "y"))
    assert len(obj._get_reverse_foreign_key_graph()[("c", "s", "b")]) == 2


# --------------------------------------------------------------------------- catalog JSON (H-6 / H-12 / H-13)


class FakeWorkspaceApi:
    def __init__(self, fail=False):
        self.files = {}
        self.dirs = set()
        self.fail = fail

    def mkdirs(self, path):
        self.dirs.add(path)

    def import_(self, path, content, format=None, overwrite=False):
        if self.fail:
            raise RuntimeError("RESOURCE_EXHAUSTED: workspace import limit")
        self.files[path] = base64.b64decode(content).decode("utf-8")

    def export(self, path, format=None):
        return types.SimpleNamespace(content=base64.b64encode(self.files[path].encode("utf-8")).decode())


@pytest.fixture
def catalog_obj(agent_ns, monkeypatch):
    monkeypatch.setattr(agent_ns["workspace"], "ImportFormat", types.SimpleNamespace(AUTO="AUTO"), raising=False)
    monkeypatch.setattr(agent_ns["workspace"], "ExportFormat", types.SimpleNamespace(AUTO="AUTO"), raising=False)
    columns = {"main.s.orders.id": "1", "main.s.items.id": "2", "main.s.orders.customer_id": "3",
               "main.s.orders.amount": "4"}

    def _make(fail=False):
        obj = make_inspire(agent_ns)
        obj.column_id_map = dict(columns)
        obj.id_column_map = {cid: {"fqn": fqn, "description": "d"} for fqn, cid in columns.items()}
        obj.table_id_map = {"main.s.orders": "10", "main.s.items": "11"}
        obj.id_table_map = {v: k for k, v in obj.table_id_map.items()}
        obj.catalogs_str, obj.schemas_str, obj.generation_path = "main", "", "/Workspace/out"
        obj.docs_output_dir = "/Workspace/out/docs"
        obj.w_client = types.SimpleNamespace(workspace=FakeWorkspaceApi(fail=fail))
        return obj
    return _make


def catalog_uc(**fields):
    uc = {"No": "N01-U01", "Name": "Demo", "Business Domain": "Sales", "Priority": "High"}
    uc.update(fields)
    return uc


def saved_uc(obj):
    payload = json.loads(next(iter(obj.w_client.workspace.files.values())))
    return payload["domains"][0]["use_cases"][0]


def test_h6_ambiguous_and_substring_column_names_are_not_mapped(catalog_obj):
    obj = catalog_obj()
    uc = catalog_uc(**{"Columns Involved": "id, cust, amount, orders.customer_id, main.s.items.id"})
    obj._save_usecases_catalog_json([uc], {}, summary_dict={"Executive": "x"})
    assert saved_uc(obj)["Columns Involved"] == "id, cust, 4, 3, 2"


def test_h6_involved_columns_field_uses_same_resolution(catalog_obj):
    obj = catalog_obj()
    obj._save_usecases_catalog_json([catalog_uc(**{"Involved Columns": "amount, id"})], {}, summary_dict={"Executive": "x"})
    assert saved_uc(obj)["Involved Columns"] == "4, id"


def test_h12_load_restores_every_id_encoded_field(catalog_obj):
    obj = catalog_obj()
    uc = catalog_uc(**{"Columns Involved": "amount", "Involved Columns": "orders.customer_id"})
    obj._save_usecases_catalog_json([uc], {}, summary_dict={"Executive": "x"})
    path = next(iter(obj.w_client.workspace.files))
    stored = json.loads(obj.w_client.workspace.files[path])
    stored["domains"][0]["use_cases"][0]["directly_involved_tables"] = "10, 11"
    stored["domains"][0]["use_cases"][0]["directly_involved_schema"] = "1, 4"
    obj.w_client.workspace.files[path] = json.dumps(stored)
    loaded, _, _ = obj._load_usecases_catalog_json(path)
    restored = loaded[0]
    assert restored["Columns Involved"] == "main.s.orders.amount"
    assert restored["Involved Columns"] == "main.s.orders.customer_id"
    assert restored["directly_involved_tables"] == "main.s.orders, main.s.items"
    assert restored["directly_involved_schema"] == "main.s.orders.id, main.s.orders.amount"


def test_h13_save_failure_is_recorded_as_a_failed_step_not_success(catalog_obj, agent_ns):
    obj = catalog_obj(fail=True)
    emitted = []

    reasons = []

    class Writer:
        def emit_step(self, **kwargs):
            emitted.append(kwargs)
            return 1

        def record_catalog_json_failure(self, reason):
            reasons.append(reason)
            return True
    obj.atomic_writer = Writer()
    before = len(agent_ns["NEXT_ACTIONS"].snapshot())
    summary = obj._save_usecases_catalog_json([catalog_uc()], {}, summary_dict={"Executive": "x"})
    assert summary == {"Executive": "x"}
    assert obj.logger.matching("Failed to save JSON Catalog", level="ERROR")
    assert [a["rule_id"] for a in agent_ns["NEXT_ACTIONS"].snapshot()[before:]] == ["JSON_CATALOG_SAVE_FAILED"]
    assert len(emitted) == 1 and emitted[0]["status"] == "ended_error"
    assert "workspace import limit" in emitted[0]["result_json"]["error"]
    assert len(reasons) == 1 and "workspace import limit" in reasons[0]


@pytest.mark.parametrize("schema", ["sales", "Sales", "SALES"])
def test_metric_views_are_found_whatever_case_the_schema_name_was_written_in(agent_ns, schema):
    model = sales_model()
    model["main"]["sales"]["mv_revenue"] = T([("revenue", "DECIMAL", None)], type="METRIC_VIEW", comment="Revenue")
    spark = SqliteSpark(model)
    views = agent_ns["collect_metric_views"](spark, {("main", schema)}, CapturingLogger())
    assert [(v["fqn"], v["comment"]) for v in views] == [("main.sales.mv_revenue", "Revenue")]
    assert all(args.get("schema") == "sales" for q, args in spark.queries if "information_schema" in q)
