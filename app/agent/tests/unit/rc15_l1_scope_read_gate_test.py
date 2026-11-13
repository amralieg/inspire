"""rc15 L1 (REQ-022): every MVP read of a scoped table goes through its Table Scope, with an explicit column list.

The rc8 walk built an MVP whose SQL read a scoped table by its bare name (the current catalog and schema resolve it),
so the publish gate, which only matched catalog.schema.table, let the whole table through. These tests pin each
spelling of an unscoped read, the scope rewrite that the Genie space and dataset gates share, the rows-only scope that
must name its columns, and the gate block that keeps an unscoped MVP from publishing. The fixture is one tiny table."""
import copy
import json

import pytest

SALES = "main.s.sales"
SCOPE_JSON = json.dumps({SALES: {"columns": ["sku", "brand", "sold_on"],
                                 "rows": [{"column": "brand", "op": "=", "values": ["alpha"]}]}})
VIEW_DATABASE = "main.insp"


class _Spark:
    def __init__(self):
        self.statements = []

    def sql(self, statement):
        self.statements.append(" ".join(str(statement).split()))


@pytest.fixture
def scoped(agent_ns):
    agent_ns["INSPIRE_TABLE_SCOPES"].clear()
    agent_ns["SCOPE_BYPASSES"].clear()
    agent_ns["INSPIRE_TABLE_SCOPES"].update(agent_ns["parse_table_scopes"](SCOPE_JSON, VIEW_DATABASE))
    yield agent_ns
    agent_ns["INSPIRE_TABLE_SCOPES"].clear()
    agent_ns["SCOPE_BYPASSES"].clear()


def _refused(ns, code, sources=(SALES,)):
    return ns["implement_source_read_problems"]([("cell 2", code)], list(sources))


UNSCOPED_READS = {
    "bare table name in SQL": "df = spark.sql('SELECT sku FROM sales')\n",
    "schema.table in SQL": "df = spark.sql('SELECT sku FROM s.sales')\n",
    "3-part SELECT * in SQL": "df = spark.sql('SELECT * FROM main.s.sales')\n",
    "backticked 3-part in SQL": "df = spark.sql('SELECT sku FROM `main`.`s`.`sales`')\n",
    "bare name in spark.table": "df = spark.table('sales')\n",
    "3-part name in spark.read.table": "df = spark.read.table('main.s.sales')\n",
    "table name held in a variable": "name = pick()\ndf = spark.table(name)\n",
    "placeholder table in an f-string": "t = 'sales'\ndf = spark.sql(f'SELECT sku FROM {t}')\n",
    "placeholder catalog and schema": "c, s, t = 'main', 's', 'sales'\ndf = spark.sql(f'SELECT sku FROM {c}.{s}.{t}')\n",
    "name built by concatenation": "df = spark.sql('SELECT sku FROM ' + table_name)\n",
    "dotted name still being built": "df = spark.sql('SELECT sku FROM main.s.' + table_name)\n",
}


@pytest.mark.parametrize("label", sorted(UNSCOPED_READS))
def test_an_unscoped_read_of_a_scoped_table_is_refused_in_every_spelling(scoped, label):
    problems = _refused(scoped, UNSCOPED_READS[label])
    assert problems, f"{label} reads {SALES} without its Table Scope and the gate must refuse it"
    assert "cell 2 line" in problems[0] and "outside inspire_read_source" in problems[0]


SCOPED_READS = {
    "the helper, the only route": "df = inspire_read_source('main.s.sales')\n",
    "a view made from the helper frame": ("df = inspire_read_source('main.s.sales')\ndf.createOrReplaceTempView('sales_v')\n"
                                          "x = spark.sql('SELECT sku FROM sales_v')\n"),
    "a column named like the table": "x = spark.sql('SELECT sales FROM sales_v')\n",
    "the table named in prose": "print('the sales table has 3 rows')\nnote = 'sales of the quarter'\n",
    "another table with a longer name": "x = spark.sql('SELECT a FROM sales_archive')\n",
}


@pytest.mark.parametrize("label", sorted(SCOPED_READS))
def test_a_read_through_the_helper_or_outside_a_read_position_is_allowed(scoped, label):
    assert _refused(scoped, SCOPED_READS[label]) == [], f"{label} does not read {SALES} unscoped"


def test_a_scoped_table_is_refused_even_when_the_build_did_not_list_it(scoped):
    code = "df = spark.sql('SELECT sku FROM main.s.sales')\n"
    assert _refused(scoped, code, sources=()), "a Launch-scoped table is a source of every build, listed or not"


def test_the_gate_block_refuses_to_publish_an_unscoped_mvp(scoped):
    problems = _refused(scoped, UNSCOPED_READS["bare table name in SQL"])
    block = scoped["implement_source_read_block"](problems)
    assert "the MVP is not published" in block, block
    assert "reads" in block and "without inspire_read_source" in block, block
    assert scoped["implement_source_read_block"](_refused(scoped, SCOPED_READS["the helper, the only route"])) == ""


def test_a_bare_or_schema_read_is_rewritten_to_the_scope_view_keeping_its_keyword(scoped):
    scope = scoped["INSPIRE_TABLE_SCOPES"][SALES]
    scoped["create_scope_views"](_Spark(), scoped["INSPIRE_TABLE_SCOPES"])
    view = scope["view_ref"]
    assert scope["ready"] and view
    rewritten = scoped["scope_rewrite_reads"](scope, "SELECT sku FROM sales JOIN s.sales AS b ON b.sku = sku, main.s.sales")
    assert rewritten == f"SELECT sku FROM {view} JOIN {view} AS b ON b.sku = sku, {view}", rewritten


def test_a_genie_space_that_reads_a_scoped_table_by_its_bare_name_fails_the_space_gate(scoped):
    space = {"data_sources": {"tables": []}, "instructions": {"example_question_sqls": [
        {"question": ["How many?"], "sql": ["SELECT COUNT(*) FROM sales"]}]}, "benchmarks": {"questions": []}}
    problems = scoped["scope_space_sql"](space, scoped["INSPIRE_TABLE_SCOPES"])
    assert problems and f"reads {SALES}, the base table of its Table Scope" in problems[0], problems
    assert scoped["SCOPE_BYPASSES"], "the bypass is recorded"


def test_a_target_kpi_query_that_reads_a_scoped_table_by_its_bare_name_is_refused(scoped):
    with pytest.raises(scoped["ScopeBypassError"], match="reads main.s.sales without its Table Scope"):
        scoped["assert_scoped_reads"]("SELECT COUNT(*) FROM sales", "the target KPI", scoped["INSPIRE_TABLE_SCOPES"])
    assert scoped["assert_scoped_reads"]("SELECT COUNT(*) FROM main.insp.other", "the target KPI", scoped["INSPIRE_TABLE_SCOPES"])


def test_a_rows_only_scope_names_the_columns_the_table_has_and_never_takes_every_column(agent_ns):
    columns = {"main.s.sales": ["sku", "brand", "sold_on"]}
    data = {"tables": {}, "removed_tables": [], "filters": [{"table": SALES, "column": "brand", "op": "=", "values": ["alpha"]}],
            "column_roles": {}, "window": {}, "run_profile": "preview", "notes": ""}
    text = agent_ns["implement_scope_text"](copy.deepcopy(data), [SALES], lambda table: columns[table])
    assert text[SALES]["columns"] == ["sku", "brand", "sold_on"], text
    scopes = agent_ns["implement_table_scopes"](copy.deepcopy(data), [SALES], VIEW_DATABASE, "7", lambda table: columns[table])
    assert scopes[SALES]["columns"] == columns[SALES]
    assert "SELECT *" not in scopes[SALES]["source"], scopes[SALES]["source"]


def test_a_rows_only_scope_whose_columns_cannot_be_read_is_refused_not_widened(agent_ns):
    data = {"tables": {}, "removed_tables": [], "filters": [{"table": SALES, "column": "brand", "op": "=", "values": ["alpha"]}],
            "column_roles": {}, "window": {}, "run_profile": "preview", "notes": ""}
    with pytest.raises(ValueError, match="names no columns, and Inspire could not read the columns of its table"):
        agent_ns["implement_scope_text"](copy.deepcopy(data), [SALES], lambda table: [])


def test_a_copy_swapped_in_for_a_scoped_table_keeps_the_launch_scope_and_the_wizard_filters(scoped):
    copy_name = "main.s.sales_copy"
    data = {"tables": {SALES: copy_name}, "removed_tables": [], "column_roles": {},
            "filters": [{"table": SALES, "column": "sold_on", "op": ">=", "values": ["2026-01-01"]}],
            "window": {}, "run_profile": "preview", "notes": ""}
    text = scoped["implement_scope_text"](copy.deepcopy(data), [copy_name], lambda table: ["sku", "brand", "sold_on"])
    assert text[copy_name]["columns"] == ["sku", "brand", "sold_on"], text
    assert text[copy_name]["rows"] == [{"column": "brand", "op": "=", "values": ["alpha"]},
                                       {"column": "sold_on", "op": ">=", "values": ["2026-01-01"]}], text
    assert SALES not in text, "the replaced table is not read, so it gets no entry"


def test_the_first_run_suggestions_read_a_scoped_table_through_its_scope_at_run_time(scoped):
    scope = scoped["INSPIRE_TABLE_SCOPES"][SALES]
    scoped["INSPIRE_RUN"] = {"table_scopes": {SALES: scoped["scope_record"](scope)}, "scoped_tables": [SALES]}
    groups = scoped["inspire_scope_groups_sql"](SALES, "brand")
    assert scope["source"] in groups, groups
    assert scoped["inspire_table_name"](SALES) not in groups.replace(scope["source"], ""), "the whole table is not read"
    recent = scoped["inspire_scope_recent_sql"](SALES, {"column": "sold_on", "period": "day", "days": 7, "via": None})
    assert scope["source"] in recent and scoped["inspire_table_name"](SALES) not in recent.replace(scope["source"], ""), recent


def test_a_table_outside_any_run_scope_is_suggested_from_the_table_itself(scoped):
    scoped["INSPIRE_RUN"] = {"table_scopes": {}, "scoped_tables": []}
    assert scoped["inspire_table_name"]("main.s.customers") in scoped["inspire_scope_groups_sql"]("main.s.customers", "region")


def test_a_rows_only_scope_outside_the_build_names_its_columns_through_the_run_session(agent_ns):
    agent_ns["spark"] = object()
    agent_ns["implement_uc_columns"] = lambda session, table, logger=None: [{"column_name": c, "data_type": "STRING"}
                                                                             for c in ["sku", "brand", "sold_on"]]
    data = {"tables": {}, "removed_tables": [], "filters": [{"table": SALES, "column": "brand", "op": "=", "values": ["alpha"]}],
            "column_roles": {}, "window": {}, "run_profile": "preview", "notes": ""}
    scopes = agent_ns["implement_use_case_scopes"]({"No": "7", "_implement_data": copy.deepcopy(data)}, [SALES], VIEW_DATABASE)
    assert scopes[SALES]["columns"] == ["sku", "brand", "sold_on"], scopes[SALES]


def test_a_rows_only_scope_outside_the_build_with_no_run_session_is_refused_not_widened(agent_ns):
    data = {"tables": {}, "removed_tables": [], "filters": [{"table": SALES, "column": "brand", "op": "=", "values": ["alpha"]}],
            "column_roles": {}, "window": {}, "run_profile": "preview", "notes": ""}
    with pytest.raises(ValueError, match="names no columns"):
        agent_ns["implement_use_case_scopes"]({"No": "7", "_implement_data": copy.deepcopy(data)}, [SALES], VIEW_DATABASE)
