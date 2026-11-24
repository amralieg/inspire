"""SEC-01 W8 (open question 8): Discover finds the policied tables from the row_filters / column_masks metadata and passes them
to DeepEvidence, which then reads no rows of them."""
import re
import types

from v120_artifacts_support import FakeSpark, make_inspire


def _row(catalog, schema, table):
    return types.SimpleNamespace(table_catalog=catalog, table_schema=schema, table_name=table)


def test_collect_policied_tables_reads_row_filters_and_column_masks_metadata_only(agent_ns):
    def respond(statement):
        if "`row_filters`" in statement:
            return [_row("main", "s", "Orders")]
        if "`column_masks`" in statement:
            return [_row("main", "s", "customers"), _row("main", "s", "Orders")]
        return []

    spark = FakeSpark(responder=respond)
    found = agent_ns["collect_policied_tables"](spark, {("main", "s")}, make_inspire(agent_ns).logger)
    assert found == ["main.s.customers", "main.s.orders"]
    assert all("information_schema" in s for s in spark.statements)


def test_collect_policied_tables_survives_an_unreadable_view(agent_ns):
    def respond(statement):
        if "`row_filters`" in statement:
            raise RuntimeError("denied")
        return [_row("main", "s", "customers")]

    found = agent_ns["collect_policied_tables"](FakeSpark(responder=respond), {("main", "s")}, make_inspire(agent_ns).logger)
    assert found == ["main.s.customers"]


def test_the_discover_notebook_hands_the_policied_tables_to_deep_evidence():
    import json
    import os
    path = os.path.join(os.path.dirname(__file__), "..", "..", "agent", "dbx_inspire_ai_agent.ipynb")
    code = "".join("".join(c["source"]) for c in json.load(open(path))["cells"] if c["cell_type"] == "code")
    assert 'evidence["policied"] = collect_policied_tables(' in code
    assert 'policied=evidence.get("policied")' in code
    assert '.get("policied"))' in code.split("def _run_data_signal_check")[1].split("DeepEvidence(")[1][:400]
