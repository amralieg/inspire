"""REQ-147 gap 2: the run spec names every source table the as-of cut-off applies to, as cut_off_tables. A table is named only
when the use case reads it through a time column, so a table with no time column is never cut by date."""
from v120_artifacts_support import FakeSpark  # noqa: F401  (keeps the agent namespace fixture loaded the same way as its neighbours)


def _instance(agent_ns):
    return agent_ns["DatabricksInspire"].__new__(agent_ns["DatabricksInspire"])


def test_only_the_source_tables_read_through_a_time_column_are_named_in_order(agent_ns, monkeypatch):
    sources = ["main.inspire.a", "main.inspire.b", "main.inspire.c"]
    monkeypatch.setitem(agent_ns, "implement_source_tables", lambda data, involved: list(sources))
    columns = {"main.inspire.a": "order_date", "main.inspire.b": "", "main.inspire.c": "returned_on"}
    obj = _instance(agent_ns)
    obj._genie_involved_tables = lambda use_case: []
    obj._genie_time_source = lambda use_case, table: {"column": columns[table]}
    assert obj._genie_cut_off_tables({"_implement_data": {}}) == [
        {"table": "main.inspire.a", "column": "order_date"}, {"table": "main.inspire.c", "column": "returned_on"}]


def test_a_use_case_whose_tables_have_no_time_column_names_no_cut_off_table(agent_ns, monkeypatch):
    monkeypatch.setitem(agent_ns, "implement_source_tables", lambda data, involved: ["main.inspire.a"])
    obj = _instance(agent_ns)
    obj._genie_involved_tables = lambda use_case: []
    obj._genie_time_source = lambda use_case, table: {}
    assert obj._genie_cut_off_tables({"_implement_data": {}}) == []
