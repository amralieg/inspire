"""rc13 metric views (REQ-128): a metric view is not a table. Discover's schema listing leaves it out with one log line,
a table named explicitly in 01_uc_metadata that is a metric view is left out of the scan with a run warning, and
neither crashes the run."""
import logging
import threading
from types import SimpleNamespace

import pytest


def _row(name, kind):
    return SimpleNamespace(table_name=name, table_type=kind)


class _Spark:
    def __init__(self, rows):
        self.rows = rows
        self.queries = []

    def sql(self, query, args=None):
        self.queries.append((query, args))
        rows = self.rows

        class _Frame:
            def collect(self_inner):
                return list(rows)
        return _Frame()


@pytest.fixture
def loader(agent_ns):
    """A DataLoader without its Spark constructor: the attributes the listing and the explicit-name drop read."""
    instance = object.__new__(agent_ns["DataLoader"])
    instance.logger = logging.getLogger("rc13_metric_view")
    instance._metadata_lock = threading.RLock()
    instance.metadata_unavailable = {}
    instance._metadata_errors = {}
    instance._canonical_names = {}
    instance.catalog_capabilities = {"main": True}
    return instance


def test_the_row_splitter_leaves_metric_views_out_and_keeps_every_other_table(agent_ns):
    rows = [_row("orders", "MANAGED"), _row("customer_value_metrics", "METRIC_VIEW"), _row("spend", "METRIC VIEW"),
            _row("v_sales", "VIEW"), _row("untyped", None)]
    kept, views = agent_ns["split_metric_view_rows"](rows)
    assert [r.table_name for r in kept] == ["orders", "v_sales", "untyped"]
    assert [r.table_name for r in views] == ["customer_value_metrics", "spend"]


def test_the_skip_line_names_the_count_and_the_metric_views(agent_ns):
    line = agent_ns["metric_view_skip_line"](["main.s.a", "main.s.b"])
    assert line == "[METRIC-VIEW SKIPPED] 2 metric views left out: main.s.a, main.s.b"


def test_a_schema_listing_skips_a_metric_view_and_logs_one_line(loader, agent_ns, caplog):
    loader.spark = _Spark([_row("orders", "MANAGED"), _row("customer_value_metrics", "METRIC_VIEW")])
    with caplog.at_level(logging.INFO, logger="rc13_metric_view"):
        tables = loader._fetch_tables_for_schema("main", "s")
    assert tables == ["`main`.`s`.`orders`"], "the metric view is not a table the scan reads"
    assert "[METRIC-VIEW SKIPPED] 1 metric views left out: main.s.customer_value_metrics" in caplog.text
    assert "table_type" in loader.spark.queries[0][0], "the listing reads the table type it splits on"


def test_an_explicitly_named_metric_view_is_left_out_with_a_run_warning_and_the_other_table_is_scanned(loader, caplog):
    loader.spark = _Spark([_row("customer_value_metrics", "METRIC_VIEW")])
    loader.individual_tables = [("main", "s", "customer_value_metrics"), ("main", "s", "orders")]
    with caplog.at_level(logging.INFO, logger="rc13_metric_view"):
        loader._drop_explicit_metric_views()
    assert loader.individual_tables == [("main", "s", "orders")]
    assert "[METADATA_TABLE_UNAVAILABLE FIRED]" in caplog.text, "the explicit metric view is a run warning, not a crash"
    assert "main.s.customer_value_metrics" in caplog.text


def test_an_explicit_table_that_is_not_a_metric_view_is_scanned_as_before(loader):
    loader.spark = _Spark([_row("orders", "MANAGED")])
    loader.individual_tables = [("main", "s", "orders")]
    loader._drop_explicit_metric_views()
    assert loader.individual_tables == [("main", "s", "orders")]
    assert loader.metadata_unavailable == {}


def test_a_failed_type_check_keeps_the_explicit_table_and_does_not_crash(loader):
    class _Broken:
        def sql(self, query, args=None):
            raise RuntimeError("information_schema unavailable")
    loader.spark = _Broken()
    loader.individual_tables = [("main", "s", "orders")]
    loader._drop_explicit_metric_views()
    assert loader.individual_tables == [("main", "s", "orders")]
