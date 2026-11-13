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


def test_a_metadata_read_that_raises_for_one_of_two_tables_keeps_the_other_cut_off_and_warns_once(agent_ns, monkeypatch):
    from v120_artifacts_support import CapturingLogger
    sources = ["main.inspire.a", "main.inspire.b"]
    monkeypatch.setitem(agent_ns, "implement_source_tables", lambda data, involved: list(sources))

    def time_source(use_case, table):
        if table == "main.inspire.b":
            raise RuntimeError("[INSUFFICIENT_PERMISSIONS] User does not have SELECT on Table 'main.inspire.b'")
        return {"column": "order_date"}
    obj = _instance(agent_ns)
    obj._genie_involved_tables = lambda use_case: []
    obj._genie_time_source = time_source
    obj.logger = CapturingLogger()
    out = obj._genie_cut_off_tables({"No": "N01-U01", "_implement_data": {}})
    assert out == [{"table": "main.inspire.a", "column": "order_date"}], "the table that could not be read claims no cut-off"
    warned = [message for kind, message in obj.logger.records if kind == "WARNING" and "[IMPLEMENT-CUT-OFF]" in message]
    assert len(warned) == 1 and "main.inspire.b" in warned[0] and "N01-U01" in warned[0], warned


def test_a_metadata_read_that_raises_for_every_table_still_returns_a_spec_list_and_never_raises(agent_ns, monkeypatch):
    from v120_artifacts_support import CapturingLogger
    monkeypatch.setitem(agent_ns, "implement_source_tables", lambda data, involved: ["main.inspire.a"])
    obj = _instance(agent_ns)
    obj._genie_involved_tables = lambda use_case: []

    def time_source(use_case, table):
        raise TimeoutError("metadata read timed out")
    obj._genie_time_source = time_source
    obj.logger = CapturingLogger()
    assert obj._genie_cut_off_tables({"No": "N01-U01", "_implement_data": {}}) == []
    assert len([m for k, m in obj.logger.records if "[IMPLEMENT-CUT-OFF]" in m]) == 1


def _full_spec_case(agent_ns, monkeypatch):
    from v120_artifacts_support import CapturingLogger
    from v120_genie_support import build_inspire, make_uc
    sources = ["main.inspire.a", "main.inspire.b"]
    monkeypatch.setitem(agent_ns, "implement_source_tables", lambda data, involved: list(sources))

    def time_source(use_case, table):
        if table == "main.inspire.b":
            raise RuntimeError("PERMISSION_DENIED: User does not have SELECT on Table 'main.inspire.b'")
        return {"column": "order_date"}
    inst = build_inspire(agent_ns)
    inst._genie_time_source = time_source
    inst._implement_builder = lambda: "builder@example.com"
    inst.logger = CapturingLogger()
    uc = make_uc(**{"Analytics Technique": "Classification", "genie_instruction": "x", "genie_instruction_status": "success"})
    refused = []
    uc["_implement_refused"] = refused
    return inst, uc, refused


def test_a_full_spec_with_one_unreadable_table_is_produced_warns_once_and_records_one_permission_entry(agent_ns, monkeypatch):
    inst, uc, refused = _full_spec_case(agent_ns, monkeypatch)
    spec = inst._genie_notebook_spec(uc)
    assert spec and "schedule_cron" in spec, "the spec is produced although one table cannot be read"
    source = inst._genie_run_controls_source(uc, spec, "x")
    assert "cut_off_tables" in source
    warned = [m for k, m in inst.logger.records if k == "WARNING" and "[IMPLEMENT-CUT-OFF]" in m]
    assert len(warned) == 1 and "main.inspire.b" in warned[0] and f"{uc['No']}:" in warned[0], warned
    assert len(refused) == 1, refused
    entry = refused[0]
    assert entry["principal"] == "builder@example.com" and entry["instructions"] == []
    assert entry["statements"] == [
        "GRANT USE CATALOG ON CATALOG main TO `builder@example.com`",
        "GRANT USE SCHEMA ON SCHEMA main.inspire TO `builder@example.com`",
        "GRANT SELECT ON TABLE main.inspire.b TO `builder@example.com`",
    ]


def test_the_same_unreadable_table_adds_one_permission_entry_however_often_the_cut_off_is_read(agent_ns, monkeypatch):
    inst, uc, refused = _full_spec_case(agent_ns, monkeypatch)
    inst._genie_cut_off_tables(uc)
    inst._genie_cut_off_tables(uc)
    assert len(refused) == 1


def test_a_refusal_with_no_builder_adds_no_entry_and_still_warns(agent_ns, monkeypatch):
    inst, uc, refused = _full_spec_case(agent_ns, monkeypatch)
    inst._implement_builder = lambda: ""
    assert inst._genie_cut_off_tables(uc) == [{"table": "main.inspire.a", "column": "order_date"}]
    assert refused == []
