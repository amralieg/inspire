"""TPC-H names its keys with a table prefix and a run-on key word (l_suppkey, o_custkey, ps_partkey). None of them read as a key,
so no join was inferred between the 8 tables: Pass 1 saw lineitem and orders alone, the catch-all dropped customer, nation and
region, Q3 R4 dropped 27 of 32 use cases for an unexecutable join path and R14 the rest for a network with no id column, the
elite verifier rejected every use case whose entity key was one of these columns (0 stars in 3 runs while TPC-DS, keyed _sk, got 12),
and L18 failed because only lineitem and orders were left. Each case has a must-exclude side."""
import collections
import threading

import pytest

from v120_artifacts_support import CapturingLogger
from v120_gate_contracts_test import FakeLoader, FakeStorage, make


def cols(table, *specs):
    return [("samples", "tpch", table, name, dtype, None) for name, dtype in specs]


TPCH = (cols("lineitem", ("l_orderkey", "bigint"), ("l_partkey", "bigint"), ("l_suppkey", "bigint"), ("l_linenumber", "int"),
             ("l_quantity", "decimal(18,2)"), ("l_extendedprice", "decimal(18,2)"), ("l_shipdate", "date"), ("l_shipmode", "string"))
        + cols("orders", ("o_orderkey", "bigint"), ("o_custkey", "bigint"), ("o_orderstatus", "string"), ("o_totalprice", "decimal(18,2)"),
               ("o_orderdate", "date"), ("o_clerk", "string"))
        + cols("customer", ("c_custkey", "bigint"), ("c_name", "string"), ("c_nationkey", "bigint"), ("c_acctbal", "decimal(18,2)"),
               ("c_mktsegment", "string"))
        + cols("part", ("p_partkey", "bigint"), ("p_name", "string"), ("p_brand", "string"), ("p_retailprice", "decimal(18,2)"))
        + cols("partsupp", ("ps_partkey", "bigint"), ("ps_suppkey", "bigint"), ("ps_availqty", "int"), ("ps_supplycost", "decimal(18,2)"))
        + cols("supplier", ("s_suppkey", "bigint"), ("s_name", "string"), ("s_nationkey", "bigint"), ("s_acctbal", "decimal(18,2)"))
        + cols("nation", ("n_nationkey", "bigint"), ("n_name", "string"), ("n_regionkey", "bigint"))
        + cols("region", ("r_regionkey", "bigint"), ("r_name", "string"))
        + cols("weather", ("w_obsdate", "date"), ("w_temperature", "double")))


@pytest.mark.parametrize("name", ["l_suppkey", "o_custkey", "ps_partkey", "c_nationkey", "n_regionkey", "o_orderkey", "l_linenumber",
                                  "ss_store_sk", "cust_accountkey"])
def test_a_prefixed_run_on_key_word_is_a_key(agent_ns, name):
    assert agent_ns["_is_key_like_column"](name) is True


@pytest.mark.parametrize("name", ["l_shipmode", "o_orderdate", "o_clerk", "c_mktsegment", "l_quantity", "o_totalprice", "is_invalid",
                                  "is_liquid", "home_turkey", "x_monkey", "ps_supplycost", "l_returnflag"])
def test_measures_flags_and_words_ending_in_a_key_word_stay_non_keys(agent_ns, name):
    assert agent_ns["_is_key_like_column"](name) is False


def test_the_entity_of_a_prefixed_key_and_the_row_key_of_its_own_table(agent_ns):
    assert agent_ns["_key_entity_tokens"]("o_orderkey") == ["o", "order"]
    assert agent_ns["_key_entity_tokens"]("l_suppkey") == ["l", "supp"]
    own = agent_ns["_is_own_row_key"]
    order_cols = [r[3] for r in TPCH if r[2] == "orders"]
    line_cols = [r[3] for r in TPCH if r[2] == "lineitem"]
    assert own("samples.tpch.orders", "o_orderkey", (), order_cols) is True
    assert own("samples.tpch.orders", "o_custkey", (), order_cols) is False
    assert own("samples.tpch.lineitem", "l_orderkey", (), line_cols) is False


def plain_loader(ns):
    DataLoader = ns["DataLoader"]
    loader = DataLoader.__new__(DataLoader)
    loader.logger = CapturingLogger()
    loader.foreign_key_graph = collections.defaultdict(list)
    loader._metadata_lock = threading.RLock()
    loader.primary_keys = {}
    loader._inferred_fk = {}
    loader._join_inferred_schemas = set()
    return loader


def test_every_tpch_join_is_inferred_from_the_names(agent_ns):
    found = {(k[2], r[3]): (r[6], r[7]) for k, rels in plain_loader(agent_ns).infer_foreign_keys_by_naming(TPCH).items() for r in rels}
    assert found == {
        ("lineitem", "l_orderkey"): ("orders", "o_orderkey"), ("lineitem", "l_partkey"): ("part", "p_partkey"),
        ("lineitem", "l_suppkey"): ("supplier", "s_suppkey"), ("orders", "o_custkey"): ("customer", "c_custkey"),
        ("customer", "c_nationkey"): ("nation", "n_nationkey"), ("supplier", "s_nationkey"): ("nation", "n_nationkey"),
        ("nation", "n_regionkey"): ("region", "r_regionkey"), ("partsupp", "ps_partkey"): ("part", "p_partkey"),
        ("partsupp", "ps_suppkey"): ("supplier", "s_suppkey"),
    }, "a table's own key (c_custkey, o_orderkey, s_suppkey), l_linenumber and every non-key column link to nothing"


def _tpch_inspire(ns):
    inst = make(ns, data_loader=FakeLoader(ns, [], TPCH), storage_manager=FakeStorage(TPCH))
    inst.data_category_map = {f"samples.tpch.{t}": "TRANSACTIONAL" if t in ("lineitem", "orders") else "MASTER"
                              for t in {r[2] for r in TPCH}}
    return inst


def test_join_paths_connect_the_fact_tables_to_every_dimension_and_never_to_an_unrelated_table(agent_ns):
    inst = _tpch_inspire(agent_ns)
    for tables in (["samples.tpch.lineitem", "samples.tpch.customer"], ["samples.tpch.orders", "samples.tpch.region"],
                   ["samples.tpch.lineitem", "samples.tpch.part", "samples.tpch.supplier"]):
        join = inst._find_join_path(tables)
        assert join["connected"] is True and join["strength"] == "inferred", (tables, join)
    assert inst._find_join_path(["samples.tpch.lineitem", "samples.tpch.weather"])["connected"] is False


def test_a_network_use_case_on_lineitem_sees_its_id_columns(agent_ns):
    cls = agent_ns["DatabricksInspire"]
    signals = cls._column_signals({r[3]: r[4].upper() for r in TPCH if r[2] == "lineitem"})
    assert set(signals["id_cols"]) == {"l_orderkey", "l_partkey", "l_suppkey", "l_linenumber"}
    assert "l_quantity" not in signals["id_cols"] and "l_shipmode" not in signals["id_cols"]
