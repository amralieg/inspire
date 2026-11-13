"""REQ-021 / REQ-022: the Implement wizard's row filters and column roles become the table scope the generated
notebook reads through, so an MVP build reads only the chosen rows and columns of a table it was scoped to."""
import ast
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v120_genie_support import build_inspire, make_uc


class _Frame:
    def __init__(self, log, columns):
        self.log = log
        self.columns = columns

    def where(self, predicate):
        self.log.append(("where", predicate))
        return self

    def select(self, *columns):
        self.log.append(("select", columns))
        return self


class _Session:
    def __init__(self):
        self.log = []

    def table(self, name):
        self.log.append(("table", name))
        return _Frame(self.log, [])


def _data(filters=(), roles=None):
    return {"tables": {}, "removed_tables": [], "filters": list(filters), "column_roles": dict(roles or {}),
            "window": {}, "run_profile": "preview", "notes": ""}


def _run(inst, uc, data):
    spec = inst._genie_notebook_spec(uc)
    source = inst._genie_run_controls_source(dict(uc, _implement_data=data), spec, str(uc.get("genie_instruction") or ""))
    return ast.literal_eval(source.split("INSPIRE_RUN = ", 1)[1].split("\n\n\n", 1)[0])


def _wizard_scope(inst, uc):
    table = inst._genie_involved_tables(uc)[0]
    data = _data(filters=[{"table": table, "column": "brand", "op": "in", "values": ["Golden Crumbs"]}],
                 roles={"entity_id": f"{table}.transaction_id", "measure": f"{table}.total_price"})
    return table, data


def test_the_wizard_rows_and_columns_reach_the_generated_run(agent_ns):
    inst = build_inspire(agent_ns)
    uc = make_uc()
    table, data = _wizard_scope(inst, uc)
    run = _run(inst, uc, data)
    scope = run["table_scopes"][table.lower()]
    assert scope["columns"] == ["transaction_id", "total_price"]
    assert scope["rows"] == [{"column": "brand", "op": "in", "values": ["Golden Crumbs"]}]
    assert run["scoped_tables"] == [table.lower()]


def test_the_scoped_read_applies_the_row_filter_and_the_column_list_and_never_reads_the_whole_table(agent_ns):
    inst = build_inspire(agent_ns)
    uc = make_uc()
    table, data = _wizard_scope(inst, uc)
    agent_ns["INSPIRE_RUN"] = _run(inst, uc, data)
    session = _Session()
    agent_ns["inspire_read_source"](table, session)
    assert session.log == [
        ("table", agent_ns["inspire_table_name"](table.lower())),
        ("where", "`brand` IN ('Golden Crumbs')"),
        ("select", ("`transaction_id`", "`total_price`")),
    ]


def test_a_scoped_table_whose_scope_was_dropped_is_refused_not_read_whole(agent_ns):
    inst = build_inspire(agent_ns)
    uc = make_uc()
    table, data = _wizard_scope(inst, uc)
    run = _run(inst, uc, data)
    agent_ns["INSPIRE_RUN"] = dict(run, table_scopes={})
    with pytest.raises(ValueError, match="does not carry its scope"):
        agent_ns["inspire_read_source"](table, _Session())


def test_a_table_with_row_filters_and_no_picked_columns_keeps_every_column_but_only_the_chosen_rows(agent_ns):
    inst = build_inspire(agent_ns)
    inst._implement_scope_columns = lambda table: ["order_id", "brand", "total_price"]
    uc = make_uc()
    table = inst._genie_involved_tables(uc)[0]
    run = _run(inst, uc, _data(filters=[{"table": table, "column": "brand", "op": "not in", "values": ["Other Co"]}]))
    scope = run["table_scopes"][table.lower()]
    assert scope["columns"] == ["order_id", "brand", "total_price"] and scope["rows"][0]["op"] == "not in"
    agent_ns["INSPIRE_RUN"] = run
    session = _Session()
    agent_ns["inspire_read_source"](table, session)
    assert session.log == [("table", agent_ns["inspire_table_name"](table.lower())), ("where", "`brand` NOT IN ('Other Co')"),
                           ("select", ("`order_id`", "`brand`", "`total_price`"))], "every column is named, never read by default"


def test_a_table_the_person_did_not_touch_is_read_as_before(agent_ns):
    inst = build_inspire(agent_ns)
    uc = make_uc()
    assert _run(inst, uc, _data())["table_scopes"] == {}


def test_leave_out_and_keep_only_are_both_typed_into_sql(agent_ns):
    assert agent_ns["scope_where_sql"]([{"column": "brand", "op": "not in", "values": ["A", "B"]}]) == "`brand` NOT IN ('A', 'B')"
    assert agent_ns["scope_where_sql"]([{"column": "brand", "op": "in", "values": ["Golden Crumbs"]}]) == "`brand` IN ('Golden Crumbs')"


def _kpi_spec(table, column="total_price"):
    return {"table": table, "aggregation": "SUM", "column": column}


def test_the_target_kpi_reads_only_the_wizard_scope_and_the_gate_refuses_a_base_table_read(agent_ns):
    inst = build_inspire(agent_ns)
    uc = make_uc()
    table, data = _wizard_scope(inst, uc)
    scopes = agent_ns["implement_table_scopes"](data, [table])
    sql = agent_ns["DeepEvidence"].kpi_sql(_kpi_spec(table), scopes)
    assert sql.startswith("SELECT CAST(SUM(`total_price`) AS DOUBLE) AS v FROM (SELECT `transaction_id`, `total_price` FROM ")
    assert agent_ns["assert_scoped_reads"](sql, "the target KPI", scopes) == sql
    base = agent_ns["build_fqn"](*table.split("."))
    with pytest.raises(agent_ns["ScopeBypassError"], match="the target KPI reads"):
        agent_ns["assert_scoped_reads"](f"SELECT CAST(SUM(`total_price`) AS DOUBLE) AS v FROM {base}", "the target KPI", scopes)


def test_a_kpi_column_outside_the_wizard_scope_is_refused_not_read_whole(agent_ns):
    inst = build_inspire(agent_ns)
    uc = make_uc()
    table, data = _wizard_scope(inst, uc)
    scopes = agent_ns["implement_table_scopes"](data, [table])
    with pytest.raises(ValueError, match="outside the Table Scope"):
        agent_ns["DeepEvidence"].kpi_sql(_kpi_spec(table, column="store_name"), scopes)


def test_a_kpi_on_an_unscoped_table_is_built_on_the_table_as_before(agent_ns):
    inst = build_inspire(agent_ns)
    uc = make_uc()
    table = inst._genie_involved_tables(uc)[0]
    sql = agent_ns["DeepEvidence"].kpi_sql(_kpi_spec(table), {})
    assert sql == f"SELECT CAST(SUM(`total_price`) AS DOUBLE) AS v FROM {agent_ns['inspire_quote_qualified_name'](table)}"
