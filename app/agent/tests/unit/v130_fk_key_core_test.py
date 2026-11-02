"""v1.3.0: foreign keys named after the referenced table's own key column, and the catch-all coverage pass that
uses them.

TPC-DS fact tables reference demographics, addresses and promotions as `ss_cdemo_sk`, `ss_hdemo_sk`,
`ss_addr_sk` and `ss_promo_sk`, while those tables are keyed `cd_demo_sk`, `hd_demo_sk`, `ca_address_sk` and
`p_promo_sk`. Name inference matched key stems only against table names, so none of these joins was found, and the
catch-all coverage pass, which tested joins by column-name overlap only, excluded customer_demographics,
household_demographics and income_band from every run: no use case of five recorded runs used them. Each case has a
must-exclude side (CLAUDE.md 8.3).
"""
import collections
import threading

import pytest

from v120_artifacts_support import CapturingLogger


def cols(table, *specs, catalog="c", schema="s"):
    return [(catalog, schema, table, name, dtype, None) for name, dtype in specs]


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


def targets(loader, details):
    return {(k[2], r[3]): (r[6], r[7]) for k, rels in loader.infer_foreign_keys_by_naming(details).items() for r in rels}


SCHEMA = (cols("store_sales", ("ss_customer_sk", "int"), ("ss_cdemo_sk", "int"), ("ss_hdemo_sk", "int"),
               ("ss_addr_sk", "int"), ("ss_promo_sk", "int"), ("ss_sold_date_sk", "int"), ("ss_quantity", "int"))
          + cols("catalog_sales", ("cs_bill_cdemo_sk", "int"), ("cs_ship_addr_sk", "int"), ("cs_promo_sk", "int"))
          + cols("web_returns", ("wr_refunded_cdemo_sk", "int"), ("wr_returning_hdemo_sk", "int"))
          + cols("customer", ("c_customer_sk", "int"), ("c_customer_id", "string"))
          + cols("customer_demographics", ("cd_demo_sk", "int"), ("cd_gender", "string"))
          + cols("household_demographics", ("hd_demo_sk", "int"), ("hd_income_band_sk", "int"))
          + cols("income_band", ("ib_income_band_sk", "int"), ("ib_lower_bound", "int"))
          + cols("customer_address", ("ca_address_sk", "int"), ("ca_state", "string"))
          + cols("promotion", ("p_promo_sk", "int"), ("p_item_sk", "int"))
          + cols("item", ("i_item_sk", "int"), ("i_brand_id", "int"))
          + cols("date_dim", ("d_date_sk", "int")))


def test_keys_named_after_the_referenced_tables_own_key_are_inferred(agent_ns):
    found = targets(plain_loader(agent_ns), SCHEMA)
    assert found[("store_sales", "ss_cdemo_sk")] == ("customer_demographics", "cd_demo_sk")
    assert found[("store_sales", "ss_hdemo_sk")] == ("household_demographics", "hd_demo_sk")
    assert found[("store_sales", "ss_addr_sk")] == ("customer_address", "ca_address_sk")
    assert found[("store_sales", "ss_promo_sk")] == ("promotion", "p_promo_sk")
    assert found[("catalog_sales", "cs_bill_cdemo_sk")] == ("customer_demographics", "cd_demo_sk")
    assert found[("catalog_sales", "cs_ship_addr_sk")] == ("customer_address", "ca_address_sk")
    assert found[("web_returns", "wr_refunded_cdemo_sk")] == ("customer_demographics", "cd_demo_sk")
    assert found[("web_returns", "wr_returning_hdemo_sk")] == ("household_demographics", "hd_demo_sk")
    assert found[("store_sales", "ss_customer_sk")] == ("customer", "c_customer_sk"), "the table-name match is unchanged"
    assert found[("household_demographics", "hd_income_band_sk")] == ("income_band", "ib_income_band_sk")
    assert found[("promotion", "p_item_sk")] == ("item", "i_item_sk")


def test_a_tables_own_key_and_non_keys_never_link(agent_ns):
    found = targets(plain_loader(agent_ns), SCHEMA)
    for source in (("customer_demographics", "cd_demo_sk"), ("household_demographics", "hd_demo_sk"),
                   ("customer_address", "ca_address_sk"), ("promotion", "p_promo_sk"), ("item", "i_brand_id"),
                   ("store_sales", "ss_quantity"), ("customer_demographics", "cd_gender")):
        assert source not in found, source


@pytest.mark.parametrize("details,source", [
    (cols("facts", ("f_cdemo_sk", "int")) + cols("customer_demographics", ("cd_demo_sk", "int"))
     + cols("channel_demographics", ("cx_demo_sk", "int")), ("facts", "f_cdemo_sk")),
    (cols("facts", ("f_ad_sk", "int")) + cols("customer_address", ("ca_address_sk", "int")), ("facts", "f_ad_sk")),
    (cols("facts", ("f_promo_id", "int")) + cols("promotion", ("p_promo_sk", "int")), ("facts", "f_promo_id")),
    (cols("facts", ("f_promo_sk", "string")) + cols("promotion", ("p_promo_sk", "int")), ("facts", "f_promo_sk")),
    (cols("facts", ("f_addr_sk", "int")) + cols("customer_address", ("ca_address_sk", "int"))
     + cols("vendor_address", ("va_address_sk", "int")), ("facts", "f_addr_sk")),
])
def test_ambiguous_short_mismatched_or_mistyped_keys_never_link(agent_ns, details, source):
    assert source not in targets(plain_loader(agent_ns), details)


def test_join_path_tables_are_read_from_both_edge_forms(agent_ns):
    tables = agent_ns["DatabricksInspire"]._join_path_tables(
        ["c.s.household_demographics.hd_income_band_sk -> c.s.income_band.ib_income_band_sk",
         "c.s.store_sales.ss_hdemo_sk -> c.s.household_demographics.hd_demo_sk", "c.s.a.k = c.s.b.k"])
    assert tables == ["c.s.household_demographics", "c.s.income_band", "c.s.store_sales", "c.s.a", "c.s.b"]
    assert agent_ns["DatabricksInspire"]._join_path_tables(None) == []


def _catchall(ns, paths):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = CapturingLogger()
    obj.max_parallelism = 4
    obj.merged_business_context = {}
    columns = (cols("store_sales", ("ss_cdemo_sk", "int"), ("ss_hdemo_sk", "int"), ("ss_quantity", "int"))
               + cols("customer_demographics", ("cd_demo_sk", "int"), ("cd_gender", "string"))
               + cols("household_demographics", ("hd_demo_sk", "int"), ("hd_income_band_sk", "int"))
               + cols("income_band", ("ib_income_band_sk", "int"), ("ib_lower_bound", "int")))
    obj.business_scores = {f"c.s.{t}": 1.0 for t in ("store_sales", "customer_demographics", "household_demographics", "income_band")}
    obj.data_category_map = {"c.s.store_sales": "TRANSACTIONAL", "c.s.customer_demographics": "MASTER",
                             "c.s.household_demographics": "MASTER", "c.s.income_band": "REFERENCE"}
    obj._find_join_path = lambda tables: ({"connected": True, "path": paths[tuple(tables)], "strength": "inferred"}
                                          if tuple(tables) in paths else {"connected": False, "path": [], "strength": "none"})
    sent = []
    obj._process_batch_with_retry = lambda batch_columns, batch_id, **kw: sent.append(
        (sorted({f"{c[0]}.{c[1]}.{c[2]}" for c in batch_columns}), kw.get("previous_use_cases_feedback", ""))) or []
    used = [{"Tables Involved": "c.s.store_sales, c.s.household_demographics"}]
    return obj, obj._retry_missing_table_coverage(used, columns, include_business_catchall=True), sent


PATHS = {
    ("c.s.customer_demographics", "c.s.store_sales"): ["c.s.store_sales.ss_cdemo_sk -> c.s.customer_demographics.cd_demo_sk"],
    ("c.s.income_band", "c.s.store_sales"): ["c.s.household_demographics.hd_income_band_sk -> c.s.income_band.ib_income_band_sk",
                                             "c.s.store_sales.ss_hdemo_sk -> c.s.household_demographics.hd_demo_sk"],
}


def test_the_catch_all_keeps_reference_tables_a_foreign_key_path_joins_and_sends_their_bridge(agent_ns):
    obj, _new, sent = _catchall(agent_ns, PATHS)
    logs = " ".join(m for _level, m in obj.logger.records)
    assert "retained 2 MASTER/REFERENCE tables" in logs and "excluded" not in logs
    [(tables, instruction)] = sent
    assert tables == ["c.s.customer_demographics", "c.s.household_demographics", "c.s.income_band", "c.s.store_sales"]
    assert "MASTER/REFERENCE (static entity/lookup data): c.s.customer_demographics, c.s.income_band" in instruction
    assert "join partners available in the schema below are: c.s.store_sales" in instruction
    assert "join through them where the foreign keys below require it: c.s.household_demographics" in instruction


def test_the_catch_all_still_excludes_a_reference_table_nothing_joins(agent_ns):
    obj, new, sent = _catchall(agent_ns, {})
    logs = " ".join(m for _level, m in obj.logger.records)
    assert "excluded 2 MASTER/REFERENCE tables with no foreign key path and no column-name overlap" in logs
    assert sent == [] and new == []
