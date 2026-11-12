"""REQ-021 / REQ-022 (rc14 L5): every SQL text a generated Genie space carries (example question SQL, join specs,
SQL snippets, benchmark gold answers) reads a scoped table only through its scope view. A base-table read in any of
them fails the build step with a plain message, and the scope view is what the space reads instead."""
import copy

import pytest

from v120_artifacts_support import FakeSpark

TABLE = "main.s.orders"
BASE = "`main`.`s`.`orders`"
DATABASE = "main.insp"


def _scopes(agent_ns, use_case_id="N01-U03", database=DATABASE):
    data = {"tables": {}, "removed_tables": [],
            "filters": [{"table": TABLE, "column": "status", "op": "=", "values": ["gold"]}],
            "column_roles": {"entity_id": f"{TABLE}.order_id", "measure": f"{TABLE}.total_price"},
            "window": {}, "run_profile": "preview", "notes": ""}
    return agent_ns["implement_table_scopes"](data, [TABLE], database, use_case_id)


def _space(instructions=None, benchmarks=None):
    return {"data_sources": {"tables": [{"identifier": TABLE, "column_configs": [
                {"column_name": "order_id"}, {"column_name": "status"}]}]},
            "instructions": instructions or {}, "benchmarks": benchmarks or {"questions": []}}


@pytest.fixture
def clean(agent_ns):
    agent_ns["INSPIRE_TABLE_SCOPES"].clear()
    agent_ns["SCOPE_BYPASSES"].clear()
    yield agent_ns
    agent_ns["INSPIRE_TABLE_SCOPES"].clear()
    agent_ns["SCOPE_BYPASSES"].clear()


def test_an_example_sql_that_reads_the_base_table_fails_the_space_gate_when_no_scope_view_exists(clean):
    scopes = _scopes(clean, database="")
    space = _space({"example_question_sqls": [{"question": ["How many gold orders?"],
                                               "sql": [f"SELECT COUNT(*) FROM {BASE}"]}]})
    with pytest.raises(clean["ScopeBypassError"], match="the example SQL in the Genie space reads main.s.orders, the base table of its Table Scope; it must read a scope view"):
        clean["scope_genie_space"](copy.deepcopy(space), FakeSpark(), scopes)


def test_a_join_spec_and_a_sql_snippet_that_read_the_base_table_fail_the_space_gate_when_no_scope_view_exists(clean):
    scopes = _scopes(clean, database="")
    join = _space({"join_specs": [{"sql": [f"orders.status = {BASE}.status"]}]})
    with pytest.raises(clean["ScopeBypassError"], match="the join spec in the Genie space reads main.s.orders"):
        clean["scope_genie_space"](copy.deepcopy(join), FakeSpark(), scopes)
    snippet = _space({"sql_snippets": {"measures": [{"sql": [f"SUM({BASE}.total_price)"]}]}})
    with pytest.raises(clean["ScopeBypassError"], match="the SQL measures in the Genie space reads main.s.orders"):
        clean["scope_genie_space"](copy.deepcopy(snippet), FakeSpark(), scopes)


def test_a_benchmark_gold_answer_that_reads_the_base_table_fails_the_space_gate_when_no_scope_view_exists(clean):
    scopes = _scopes(clean, database="")
    space = _space(benchmarks={"questions": [{"question": ["Gold orders by status?"], "answer": [
        {"format": "SQL", "content": [f"SELECT status, COUNT(*) FROM {BASE} GROUP BY status"]}]}]})
    with pytest.raises(clean["ScopeBypassError"], match="the benchmark answer in the Genie space reads main.s.orders"):
        clean["scope_genie_space"](copy.deepcopy(space), FakeSpark(), scopes)


def test_space_sql_is_rewritten_to_the_scope_view_and_then_passes_the_gate(clean):
    scopes = _scopes(clean)
    spark = FakeSpark()
    space = _space({"example_question_sqls": [{"question": ["How many gold orders?"],
                                               "sql": [f"SELECT COUNT(*) FROM {BASE}"]}],
                    "sql_snippets": {"filters": [{"sql": [f"{BASE}.status = 'gold'"]}]}},
                   benchmarks={"questions": [{"question": ["Gold orders?"], "answer": [
                       {"format": "SQL", "content": [f"SELECT COUNT(*) FROM {BASE}"]}]}]})
    got = clean["scope_genie_space"](copy.deepcopy(space), spark, scopes)
    view = scopes[TABLE]["view_ref"]
    example = got["instructions"]["example_question_sqls"][0]["sql"]
    assert view in example[0] and BASE not in example[0], "the example reads the view, as a list of lines"
    assert view in got["instructions"]["sql_snippets"]["filters"][0]["sql"][0]
    assert view in got["benchmarks"]["questions"][0]["answer"][0]["content"][0]
    assert clean["SCOPE_BYPASSES"] == [], "a rewritten space records no bypass"


def test_a_space_without_any_reference_to_a_scoped_table_is_unchanged(clean):
    scopes = _scopes(clean)
    space = _space({"example_question_sqls": [{"question": ["Nothing scoped?"], "sql": ["SELECT 1"]}]})
    got = clean["scope_genie_space"](copy.deepcopy(space), FakeSpark(), scopes)
    assert got["instructions"]["example_question_sqls"][0]["sql"] == ["SELECT 1"]
    assert clean["SCOPE_BYPASSES"] == []
