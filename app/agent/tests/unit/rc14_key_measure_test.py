"""REQ-118 (rc14 L5): a KPI whose filter value matches no rows is not measured as zero. The nearest value that has
rows (same column, same intent) replaces it; the KPI is marked unmeasurable with a reason when no value is close."""
from unittest.mock import MagicMock

from v120_genie_support import build_inspire

TABLE = "main.s.orders"


class _Deep:
    """Stubs the SQL of DeepEvidence: `_read` returns the value rows; `measure_kpi` answers by the filter value."""

    def __init__(self, ns, rows, measured):
        self.rows, self.measured, self.ns, self.reads = rows, measured, ns, []

    def _read(self, kind, table, sql, args=None, budget="evidence", scopes=None):
        self.reads.append((kind, table, sql))
        return [{"v": v, "n": n} for v, n in self.rows]

    def measure_kpi(self, spec, scopes=None):
        if spec.get("filter_value") in self.measured:
            return self.measured[spec["filter_value"]]
        raise self.ns["DeepEvidenceNoRows"]("the KPI table holds no rows")


def _spec(value="first-time buyers"):
    return {"name": "open first-time buyers", "table": TABLE, "aggregation": "COUNT", "column": "order_id",
            "filter_column": "customer_segment", "filter_op": "=", "filter_value": value, "filter_type": "string",
            "computable": True, "query": "open first-time buyers"}


def test_a_zero_row_filter_value_is_swapped_for_the_nearest_value_that_has_rows(agent_ns):
    inst = build_inspire(agent_ns)
    deep = _Deep(agent_ns, [("new customers", 12), ("first time buyers", 7), ("gift cards", 0)], {"first time buyers": 7.0})
    spec = _spec()
    value = inst._key_measure_swap(spec, deep)
    assert value == 7.0
    assert spec["filter_value"] == "first time buyers" and spec["computable"] is True
    assert deep.reads[0][1] == TABLE and "GROUP BY `customer_segment`" in deep.reads[0][2], "the distinct values are read from the KPI table"


def test_a_kpi_with_no_close_measurable_value_is_marked_unmeasurable_with_a_reason(agent_ns):
    inst = build_inspire(agent_ns)
    deep = _Deep(agent_ns, [("gift cards", 0), ("xyz", 4)], {})
    spec = _spec()
    assert inst._key_measure_swap(spec, deep) is None
    assert spec["computable"] is False
    assert "matches no rows and no value close to it has rows" in spec["unmeasurable_reason"]


def test_the_pure_variant_needs_a_value_filter_and_a_close_value(agent_ns):
    variant = agent_ns["measurable_filter_variant"]
    assert variant({"name": "total"}, [("a", 3)]) is None, "a KPI without a filter has no variant to swap"
    assert variant(_spec(), [("xyz", 5)]) is None, "a value that is not close to the asked one is not a variant"
    assert variant(_spec(), [("first time buyers", 7), ("first time buyers", 0)]) == {"filter_value": "first time buyers"}
