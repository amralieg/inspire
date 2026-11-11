"""Table Scope (REQ-021, REQ-022): a table the person scoped is read only through its selected columns and
its row filters, everywhere Discover reads it, and a read that skips the scope fails the run."""
import json
import re
from collections import defaultdict

import pytest

from v120_artifacts_support import FakeSpark, make_inspire
from v130_evidence_test import BUSINESS_DETAILS, _deep_responder

ORDERS = "`main`.`s`.`orders`"
SCOPE_JSON = json.dumps({"main.s.orders": {
    "columns": ["order_id", "customer_id", "order_date"],
    "rows": [{"column": "status", "op": "=", "values": ["gold"]}],
}})
SCOPED_ORDERS = "(SELECT `order_id`, `customer_id`, `order_date` FROM `main`.`s`.`orders` WHERE `status` = 'gold')"


@pytest.fixture
def scoped(agent_ns):
    agent_ns["TABLE_SCOPES"].clear()
    agent_ns["SCOPE_BYPASSES"].clear()
    agent_ns["TABLE_SCOPES"].update(agent_ns["parse_table_scopes"](SCOPE_JSON))
    yield agent_ns
    agent_ns["TABLE_SCOPES"].clear()
    agent_ns["SCOPE_BYPASSES"].clear()


def test_a_scope_names_the_columns_read_and_the_rows_kept_and_the_source_is_their_subquery(scoped):
    scopes = scoped["TABLE_SCOPES"]
    entry = scopes["main.s.orders"]
    assert entry["columns"] == ["order_id", "customer_id", "order_date"]
    assert entry["source"] == SCOPED_ORDERS
    assert scoped["scoped_source"]("main", "s", "orders") == SCOPED_ORDERS
    assert scoped["scoped_source"]("main", "s", "customers") == "`main`.`s`.`customers`", "an unscoped table is read by its plain name"


def test_an_empty_scope_text_scopes_nothing(agent_ns):
    assert agent_ns["parse_table_scopes"]("") == {} and agent_ns["parse_table_scopes"]("  ") == {}
    assert agent_ns["scoped_source"]("main", "s", "orders") == ORDERS


def test_a_scope_with_no_column_is_refused_so_a_whole_table_is_never_read_by_accident(agent_ns):
    text = json.dumps({"main.s.orders": {"columns": [], "rows": []}})
    with pytest.raises(ValueError, match="needs at least one column"):
        agent_ns["parse_table_scopes"](text)


@pytest.mark.parametrize("row, message", [
    ({"column": "status", "op": "like", "values": ["g"]}, "operator like, which is not supported"),
    ({"column": "", "op": "=", "values": ["gold"]}, "needs a column"),
    ({"column": "status", "op": "=", "values": []}, "needs 1 value(s) for ="),
    ({"column": "amount", "op": "between", "values": ["1"]}, "needs 2 value(s) for between"),
    ({"column": "status", "op": "in", "values": []}, "needs at least one value for in"),
    ({"column": "status", "op": "=", "values": [" "]}, "has an empty value"),
])
def test_a_filter_the_gate_cannot_type_is_refused(agent_ns, row, message):
    text = json.dumps({"main.s.orders": {"columns": ["order_id"], "rows": [row]}})
    with pytest.raises(ValueError, match=re.escape(message)):
        agent_ns["parse_table_scopes"](text)


def test_a_key_that_is_not_a_three_part_name_is_refused(agent_ns):
    with pytest.raises(ValueError, match="must be a catalog.schema.table name"):
        agent_ns["parse_table_scopes"](json.dumps({"orders": {"columns": ["a"], "rows": []}}))


def test_filter_values_are_escaped_so_a_value_cannot_end_the_literal(agent_ns):
    text = json.dumps({"main.s.orders": {"columns": ["order_id"], "rows": [
        {"column": "brand", "op": "=", "values": ["O'Brien\\x"]},
        {"column": "amount", "op": "between", "values": ["1", "9"]},
        {"column": "tier", "op": "in", "values": ["a", "b"]},
        {"column": "note", "op": "is null", "values": []},
    ]}})
    source = agent_ns["parse_table_scopes"](text)["main.s.orders"]["source"]
    assert source == ("(SELECT `order_id` FROM `main`.`s`.`orders` WHERE `brand` = 'O\\'Brien\\\\x' AND `amount` BETWEEN '1' AND '9' "
                      "AND `tier` IN ('a', 'b') AND `note` IS NULL)")


def test_the_gate_fails_a_read_that_skips_the_scope_and_names_the_table(scoped):
    with pytest.raises(scoped["ScopeBypassError"], match="SCOPE GATE: probe on main.s.orders reads main.s.orders without its Table Scope"):
        scoped["assert_scoped_reads"]("SELECT COUNT(*) AS n FROM `main`.`s`.`orders`", "probe on main.s.orders")
    assert scoped["SCOPE_BYPASSES"] == ["probe on main.s.orders reads main.s.orders without its Table Scope"]


def test_the_gate_fails_an_unquoted_or_partly_quoted_bypass_too(scoped):
    for sql in ("SELECT * FROM main.s.orders", "SELECT * FROM `main`.s.orders o JOIN x ON 1=1", "SELECT * FROM MAIN.S.ORDERS"):
        with pytest.raises(scoped["ScopeBypassError"]):
            scoped["assert_scoped_reads"](sql, "a read")


def test_the_gate_passes_the_scoped_source_and_reads_of_other_tables(scoped):
    assert scoped["assert_scoped_reads"](f"SELECT COUNT(*) AS n FROM {SCOPED_ORDERS}") == f"SELECT COUNT(*) AS n FROM {SCOPED_ORDERS}"
    assert scoped["assert_scoped_reads"]("SELECT COUNT(*) FROM `main`.`s`.`customers`") == "SELECT COUNT(*) FROM `main`.`s`.`customers`"
    assert scoped["assert_scoped_reads"]("SELECT * FROM `main`.information_schema.tables") == "SELECT * FROM `main`.information_schema.tables"
    assert scoped["SCOPE_BYPASSES"] == []


def test_a_bypass_swallowed_by_a_check_still_fails_the_run_at_the_gate(scoped):
    with pytest.raises(scoped["ScopeBypassError"]):
        scoped["assert_scoped_reads"]("SELECT 1 FROM main.s.orders", "join check")
    with pytest.raises(scoped["ScopeBypassError"], match="the run stops"):
        scoped["enforce_scope_gate"]()


def test_with_no_scope_the_gate_passes_every_read(agent_ns):
    agent_ns["TABLE_SCOPES"].clear()
    agent_ns["SCOPE_BYPASSES"].clear()
    sql = "SELECT COUNT(*) AS n FROM `main`.`s`.`orders`"
    assert agent_ns["assert_scoped_reads"](sql) == sql
    agent_ns["enforce_scope_gate"]()


def _details_loader(agent_ns, columns):
    loader = object.__new__(agent_ns["DataLoader"])
    loader.logger = __import__("logging").getLogger("scope-test")
    loader._lkey = lambda c, s, t: (c.lower(), s.lower(), t.lower())
    loader._canonical_names = {}
    loader._table_columns = {("main", "s", "orders"): [{"name": n, "type": t, "comment": ""} for n, t in columns]}
    loader._columns_absent = set()
    loader.primary_keys = {}
    loader.foreign_key_graph = defaultdict(list)
    loader._inferred_fk = {}
    loader.sampled_tables = {}
    loader.column_sampler = None
    loader.size_analyzer = None
    loader._metadata_lock = __import__("threading").RLock()
    loader._catalog_capable = lambda catalog: True
    return loader


ORDER_COLUMNS = [("order_id", "bigint"), ("customer_id", "bigint"), ("order_date", "date"), ("status", "string"), ("amount", "double")]


def test_the_column_metadata_a_scoped_table_exposes_is_only_the_selected_columns(scoped):
    details = _details_loader(scoped, ORDER_COLUMNS)._get_table_details("main", "s", "orders", apply_sampling=False)
    assert [d[3] for d in details] == ["order_id", "customer_id", "order_date"], "status and amount are filter or unused columns: never profiled"


def test_the_column_metadata_of_an_unscoped_table_is_untouched(agent_ns):
    agent_ns["TABLE_SCOPES"].clear()
    details = _details_loader(agent_ns, ORDER_COLUMNS)._get_table_details("main", "s", "orders", apply_sampling=False)
    assert [d[3] for d in details] == [n for n, _t in ORDER_COLUMNS]


def test_standard_evidence_reads_a_scoped_table_only_through_its_scope(scoped):
    spark = FakeSpark(responder=_deep_responder)
    obj = make_inspire(scoped, spark=spark, discovery_type="Standard", data_loader=_loader_for_evidence())
    details = [d for d in BUSINESS_DETAILS if d[2] != "orders"] + [("main", "s", "orders", n, t, "") for n, t in ORDER_COLUMNS[:3]]
    evidence = obj._collect_discovery_evidence(details)
    orders_reads = [s for s in spark.statements if "orders" in s and "information_schema" not in s and "query.history" not in s]
    assert orders_reads, "the scoped table was read"
    for statement in orders_reads:
        assert ORDERS not in statement.replace(SCOPED_ORDERS, ""), f"a read skipped the scope: {statement}"
    assert any(SCOPED_ORDERS in s for s in spark.statements)
    assert scoped["SCOPE_BYPASSES"] == []
    assert "profiles" in evidence


def test_a_raw_read_inside_deep_evidence_is_refused_and_fails_the_run(scoped):
    spark = FakeSpark(responder=_deep_responder)
    obj = make_inspire(scoped, spark=spark, discovery_type="Deep", data_loader=_loader_for_evidence())
    with pytest.raises(scoped["ScopeBypassError"]):
        obj.deep_evidence = scoped["DeepEvidence"](spark, "Deep", None)
        obj.deep_evidence._read("probe", "main.s.orders", "SELECT COUNT(*) AS n FROM `main`.`s`.`orders`")
    assert spark.statements == [], "the refused read never reached Spark"
    with pytest.raises(scoped["ScopeBypassError"]):
        scoped["enforce_scope_gate"]()


def _loader_for_evidence():
    import types
    graph = {("main", "s", "orders"): [("main", "s", "orders", "customer_id", "main", "s", "customers", "customer_id")]}
    return types.SimpleNamespace(foreign_key_graph=graph, _column_tags={}, _lkey=lambda c, s, t: (c.lower(), s.lower(), t.lower()),
                                 metadata_unavailable_report=lambda: {"count": 0, "tables": []})


def test_the_scope_reaches_every_prompt_as_a_directive_that_each_statement_must_honour(scoped):
    obj = make_inspire(scoped, spark=FakeSpark(responder=_deep_responder), discovery_type="Standard", data_loader=_loader_for_evidence())
    block = obj._get_generation_instruction_for_prompt("USE_CASE_GENERATION_PROMPT")
    assert "- TABLE SCOPE of `main.s.orders`: Inspire reads only the columns `order_id`, `customer_id`, `order_date`, and only the rows where " in block
    assert "`status` = gold" in block, block
    assert "MUST say in its statement that it covers only that scope" in block


def test_the_scope_is_saved_on_the_session_row_so_a_generate_run_keeps_it(scoped):
    writer = object.__new__(scoped["AtomicWriter"])
    writer.widget_values = {"table_scope": SCOPE_JSON}
    assert writer._widget_to_columns_map()["table_scope"] == SCOPE_JSON
    writer.widget_values = {}
    assert writer._widget_to_columns_map()["table_scope"] == ""
    import _agentload
    text = _agentload.agent_source(_agentload.agent_notebook_path())
    assert "generation_instructions_section STRING,\n            table_scope STRING\n        ) USING DELTA" in text, "the session table is created with the column"
    assert '            ("table_scope", "STRING"),' in text, "a session table made before this version gets the column"


class _ScopeFrame:
    def __init__(self, columns, calls):
        self.columns, self.calls = columns, calls

    def where(self, condition):
        self.calls.append(("where", condition))
        return self

    def select(self, *columns):
        self.calls.append(("select", columns))
        return self


class _ScopeSession:
    def __init__(self, calls):
        self.calls = calls

    def table(self, name):
        self.calls.append(("table", name))
        return _ScopeFrame(["order_id", "customer_id", "order_date", "status", "amount"], self.calls)


def test_the_mvp_source_read_applies_the_scope_before_anything_else_and_selects_only_the_columns(scoped):
    calls = []
    read = scoped["inspire_read_source"]
    read("main.s.orders", _ScopeSession(calls))
    assert calls == [("table", "`main`.`s`.`orders`"), ("where", "`status` = 'gold'"),
                     ("select", ("`order_id`", "`customer_id`", "`order_date`"))], calls


def test_the_mvp_training_read_is_scoped_too(scoped):
    calls = []
    scoped["inspire_read_source"]("main.s.orders", _ScopeSession(calls), scoped["INSPIRE_READ_PURPOSES"][1])
    assert ("where", "`status` = 'gold'") in calls and ("select", ("`order_id`", "`customer_id`", "`order_date`")) in calls, calls


def test_a_table_without_a_scope_is_read_whole_by_the_mvp_helper(agent_ns):
    agent_ns["TABLE_SCOPES"].clear()
    calls = []
    agent_ns["inspire_read_source"]("main.s.customers", _ScopeSession(calls))
    assert calls == [("table", "`main`.`s`.`customers`")], calls


def test_the_run_log_and_the_run_tables_report_a_columns_only_scope_as_scoped(scoped):
    scoped["TABLE_SCOPES"].clear()
    scoped["TABLE_SCOPES"].update(scoped["parse_table_scopes"](json.dumps({"main.s.orders": {"columns": ["order_id"], "rows": []}})))
    log = {}
    ns_log = scoped.get("INSPIRE_RUN_LOG")
    scoped["INSPIRE_RUN_LOG"] = log
    try:
        scoped["inspire_read_source"]("main.s.orders", _ScopeSession([]))
    finally:
        scoped["INSPIRE_RUN_LOG"] = ns_log
    assert log["reads"]["main.s.orders"] == {"where": "", "limit": None, "columns": ["order_id"]}


def test_a_generated_mvp_cell_that_reads_a_scoped_table_without_the_helper_is_refused(scoped):
    refused = scoped["implement_source_read_problems"]([("cell 1", "df = spark.table('main.s.orders')\n")], ["main.s.orders"])
    assert refused, "a direct read of a scoped table skips the Table Scope and must be refused"
    assert scoped["implement_source_read_problems"]([("cell 1", "df = inspire_read_source('main.s.orders')\n")], ["main.s.orders"]) == []
