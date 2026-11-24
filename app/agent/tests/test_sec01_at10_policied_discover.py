"""SEC-01 AT10, Discover half (W8, D5): a source with a row filter or column mask (sourceAccess.js `policied`) is used from
metadata only. Discover's DeepEvidence, the only code that reads customer data, stores no sample rows and no value statistics for
it: no statement reads the table, profile_table returns no column statistics, and value_counts returns no values.

Seam: DeepEvidence(..., policied=<iterable of catalog.schema.table>), the same way it takes metric_views today; the notebook fills it
from the policied tables of the launch (or its own row_filters / column_masks read)."""
import inspect
import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
UNIT = os.path.join(HERE, "unit")
if UNIT not in sys.path:
    sys.path.insert(0, UNIT)

from v120_artifacts_support import FakeSpark, make_inspire  # noqa: E402

POLICIED = "main.s.orders"
PLAIN = "main.s.lines"
COLUMNS = [("amount", "double"), ("region", "string"), ("ordered_at", "timestamp")]


class Row(dict):
    """A warehouse row that answers every aggregate the profile asks for (counts, distinct counts, bounds, value counts)."""

    def __getitem__(self, key):
        return dict.get(self, key, 4 if str(key).startswith("dc") else 1000)

    def __getattr__(self, key):
        return self[key]

    def asDict(self):
        return dict(self)


def respond(statement):
    if "GROUP BY" in statement:
        return [Row(v="EMEA", n=600, c=600), Row(v="APAC", n=400, c=400)]
    return [Row(lo0="2024-01-01", hi0="2026-01-01", lo2="2024-01-01", hi2="2026-01-01")]


def deep_with_policied(ns, spark):
    cls = ns["DeepEvidence"]
    if "policied" not in inspect.signature(cls.__init__).parameters:
        pytest.fail("AT10: Not implemented: DeepEvidence takes no policied= tables, so Discover cannot keep a row-filtered or masked "
                    "source to metadata only (W8)")
    return cls(spark, "Deep", make_inspire(ns).logger, policied=[POLICIED])


def reads_of(spark, table):
    quoted = "`" + "`.`".join(table.split(".")) + "`"
    return [s for s in spark.statements if quoted in s or table in s]


def test_AT10_discover_reads_no_rows_and_stores_no_value_statistics_of_a_policied_source(agent_ns):
    spark = FakeSpark(responder=respond)
    deep = deep_with_policied(agent_ns, spark)
    profile = deep.profile_table("`main`.`s`.`orders`", POLICIED, COLUMNS)
    values = deep.value_counts(POLICIED, "region")
    assert reads_of(spark, POLICIED) == [], f"AT10: Discover read the policied source: {reads_of(spark, POLICIED)}"
    assert not (profile or {}).get("columns"), f"AT10: value statistics were kept for the policied source: {profile}"
    assert not values, f"AT10: sample values were kept for the policied source: {values}"


def test_AT10_control_a_source_without_a_policy_is_still_profiled(agent_ns):
    spark = FakeSpark(responder=respond)
    deep = deep_with_policied(agent_ns, spark)
    deep.profile_table("`main`.`s`.`lines`", PLAIN, COLUMNS)
    assert reads_of(spark, PLAIN), "a source with no row filter or mask is profiled as before"
