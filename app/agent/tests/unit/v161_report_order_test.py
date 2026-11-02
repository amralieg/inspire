import concurrent.futures
import logging
import re


def _split(batch):
    return {"batch": batch, "original_tables": 4, "split_into": 2, "sub_batch_1_tables": 2,
            "sub_batch_2_tables": 2, "reason": "Input too long for LLM", "split_type": "Reactive"}


def _drop(table):
    return {"table": table, "original_columns": 900, "kept_columns": 500, "dropped_columns": 400,
            "drop_percentage": 44.4, "is_business": True}


def test_processing_honesty_report_lists_splits_and_drops_in_order(fresh_ns):
    printed = []
    fresh_ns["log_print"] = lambda message="", level="INFO", **kw: printed.append(str(message))
    cls = fresh_ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = logging.getLogger("v161_report_order")
    obj.data_loader = None
    obj.processing_honesty = {
        "total_tables_discovered": 9, "total_tables_processed": 9, "total_batches_created": 4, "total_batch_splits": 4,
        "batch_split_history": [_split("RETRY_1"), _split("P1_10"), _split(7), _split("P1_2")],
        "tables_with_columns_dropped": [_drop("cat.sch.zeta"), _drop("cat.sch.alpha"), _drop("cat.sch.mid")],
    }
    obj._report_processing_honesty()
    batches = [m.group(1) for line in printed for m in [re.search(r"Batch '([^']+)'", line)] if m]
    tables = [m.group(1) for line in printed for m in [re.search(r"\| (cat\.sch\.\w+)$", line)] if m]
    assert batches == ["7", "P1_2", "P1_10", "RETRY_1"]
    assert tables == ["cat.sch.alpha", "cat.sch.mid", "cat.sch.zeta"]


def test_catalog_capabilities_are_kept_and_logged_in_sorted_order(fresh_ns, caplog):
    def reverse_by_catalog(futures, timeout=None, label="", log=None):
        concurrent.futures.wait(list(futures))
        yield from sorted(futures, key=lambda f: futures[f], reverse=True)

    fresh_ns["safe_as_completed"] = reverse_by_catalog
    loader_cls = fresh_ns["DataLoader"]
    loader_cls._check_catalog_capability = lambda self, catalog: catalog != "mid"
    loader_cls._fetch_schemas_for_catalog = lambda self, catalog: []
    with caplog.at_level(logging.INFO, logger="v161_report_order"):
        dl = loader_cls("zeta,alpha,mid", "", "", logging.getLogger("v161_report_order"), enable_two_pass=False,
                        enable_column_sampling=False)
    assert list(dl.catalog_capabilities) == ["alpha", "mid", "zeta"]
    assert "Capabilities found: {'alpha': True, 'mid': False, 'zeta': True}" in caplog.text
