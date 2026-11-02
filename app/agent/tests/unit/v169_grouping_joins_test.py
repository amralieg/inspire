import json
import threading

from v120_artifacts_support import FakeSpark, make_inspire, make_uc
from v120_artifacts_tracking_test import _describe

ORDERS, CUSTOMERS, STORES, OTHER = "main.sales.orders", "main.sales.customers", "main.sales.stores", "main.ref.calendar"


class _Loader:
    def __init__(self):
        self.asked = []

    def get_table_relations(self, catalog, schema, table):
        self.asked.append((catalog, schema, table))
        if table == "orders":
            return [((catalog, schema, table, "customer_id", "", "", "customers", "customer_id"), "declared", 1.0),
                    ((catalog, schema, table, "store_id", "main", "sales", "stores", "store_id"), "inferred", 0.8333),
                    ((catalog, schema, table, "day", "main", "ref", "calendar", "day"), "declared", 1.0)]
        if table == "customers":
            return [((catalog, schema, table, "customer_id", "", "", "customers", "customer_id"), "declared", 1.0)]
        return []


def _obj(ns, loader, spark=None):
    obj = make_inspire(ns, spark=spark or FakeSpark(), inspire_database="main.inspire", session_id=99, data_loader=loader,
                       _tracking_table_name="main.inspire.__inspire_usecases", _tracking_table_created=True)
    obj._tracking_lock = threading.Lock()
    obj._build_code_structure_mandate = lambda spec: "mandate"
    return obj


def _uc(**extra):
    return make_uc("N01-U01", **{"Tables Involved": f"`main`.`sales`.`orders`, {CUSTOMERS}, {STORES}", "Primary Table": ORDERS, **extra})


def test_discover_keeps_the_declared_and_inferred_joins_between_the_use_case_tables_with_their_confidence(agent_ns):
    loader = _Loader()
    joins = _obj(agent_ns, loader)._use_case_table_joins(_uc())
    assert joins == [
        {"table": ORDERS, "column": "customer_id", "ref_table": CUSTOMERS, "ref_column": "customer_id", "source": "declared", "confidence": 1.0},
        {"table": ORDERS, "column": "store_id", "ref_table": STORES, "ref_column": "store_id", "source": "inferred", "confidence": 0.833}]
    assert ("main", "sales", "orders") in loader.asked and all(len(t) == 3 for t in loader.asked)
    assert not any(j["ref_table"] == OTHER for j in joins), "a join to a table the use case does not read is left out"
    assert not any(j["table"] == j["ref_table"] for j in joins), "a table joined to itself is left out"
    assert _obj(agent_ns, None)._use_case_table_joins(_uc()) == [], "with no metadata loader nothing is invented"


def test_each_tracking_row_carries_its_joins_as_json_and_reads_them_back(agent_ns):
    cls = agent_ns["DatabricksInspire"]
    obj = _obj(agent_ns, _Loader())
    source = obj._tracking_row_source(_uc())
    names = [f.name for f in cls._get_tracking_full_schema().fields]
    row = dict(zip(names, cls._uc_to_row(source, 99, lambda usecase, name: name)))
    saved = json.loads(row["table_joins"])
    assert [j["ref_table"] for j in saved] == [CUSTOMERS, STORES]
    back = obj._row_to_uc(dict(row))
    assert back["table_joins"] == saved
    kept = obj._tracking_row_source(dict(_uc(), table_joins=[{"table": "a.b.c"}]))
    assert kept["table_joins"] == [{"table": "a.b.c"}], "joins a session already saved are kept"
    none = dict(zip(names, cls._uc_to_row(_obj(agent_ns, None)._tracking_row_source(_uc()), 99, lambda u, n: n)))
    assert none["table_joins"] is None


def test_a_released_usecases_table_gets_the_joins_column_added_with_null_for_old_rows(agent_ns):
    cls = agent_ns["DatabricksInspire"]
    released = ["session_id", "id"] + [c for c, _t in cls._TRACKING_MIGRATION_COLUMNS if c != "table_joins"]
    spark = FakeSpark(responder=_describe(released))
    obj = _obj(agent_ns, None, spark)
    assert obj._migrate_tracking_table_schema() == ["table_joins"]
    assert [s for s in spark.statements if s.startswith("ALTER TABLE")] == [
        "ALTER TABLE `main`.`inspire`.`__inspire_usecases` ADD COLUMN table_joins STRING"]
    again = FakeSpark(responder=_describe(released + ["table_joins"]))
    assert _obj(agent_ns, None, again)._migrate_tracking_table_schema() == []
    assert not [s for s in again.statements if s.startswith("ALTER TABLE")], "a migrated table is never altered again"
    created = FakeSpark(responder=_describe(released + ["table_joins"]))
    obj = _obj(agent_ns, None, created)
    obj._tracking_table_created = False
    obj._create_tracking_table()
    assert "table_joins STRING" in next(s for s in created.statements if s.startswith("CREATE TABLE"))
