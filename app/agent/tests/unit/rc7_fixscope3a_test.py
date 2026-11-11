"""rc7 fix-scope3a (REQ-022): the Implement wizard's table scope reaches every surface that reads the table.

The dashboard, the Genie space and the App pages each read the per-use-case scope view, a base-table read
without the scope fails their gate, two use cases on one table get two views, a wizard scope is found before
a Discover scope on another table, an earlier bypass does not stop a later use case, and the scoped SQL is
valid Spark SQL (every subquery in FROM or JOIN carries an alias)."""
import copy
import json
import types

import pytest
import sqlglot
from sqlglot import exp

from v120_artifacts_support import FakeSpark
from v120_genie_support import build_inspire, make_uc

TABLE = "main.s.orders"
OTHER = "main.s.customers"
BASE = "`main`.`s`.`orders`"
DATABASE = "main.insp"


def _data(filters=None, roles=None):
    return {"tables": {}, "removed_tables": [], "filters": list(filters or []),
            "column_roles": dict(roles or {}), "window": {}, "run_profile": "preview", "notes": ""}


def _gold(table=TABLE):
    return _data(filters=[{"table": table, "column": "status", "op": "=", "values": ["gold"]}],
                 roles={"entity_id": f"{table}.order_id", "measure": f"{table}.total_price"})


def _scopes(agent_ns, use_case_id="N01-U03", table=TABLE):
    return agent_ns["implement_table_scopes"](_gold(table), [table], DATABASE, use_case_id)


def _space(identifier):
    return {"data_sources": {"tables": [{"identifier": identifier, "column_configs": [
        {"column_name": "order_id"}, {"column_name": "status"}, {"column_name": "customer_name"}]}]}}


def _dataset(sql, name="d"):
    return {"name": name, "sql": sql}


def _unready_subqueries(sql):
    tree = sqlglot.parse_one(sql, read="databricks")
    return [node.sql() for node in tree.find_all(exp.Subquery)
            if isinstance(node.parent, (exp.From, exp.Join)) and not node.alias]


@pytest.fixture
def clean(agent_ns):
    agent_ns["INSPIRE_TABLE_SCOPES"].clear()
    agent_ns["SCOPE_BYPASSES"].clear()
    yield agent_ns
    agent_ns["INSPIRE_TABLE_SCOPES"].clear()
    agent_ns["SCOPE_BYPASSES"].clear()


def test_the_dashboard_gate_refuses_a_base_table_read_when_the_wizard_scope_has_no_view_and_rewrites_it_once_the_view_exists(clean):
    scopes = _scopes(clean)
    base = [_dataset(f"SELECT COUNT(*) AS n FROM {BASE}")]
    problems = clean["scope_dataset_sql"](base, "the dashboard", scopes)
    assert problems and "reads main.s.orders" in problems[0], "must fail: the base table read passed the dashboard gate"
    assert clean["SCOPE_BYPASSES"], "the bypass is recorded for the run gate"
    scope = scopes[TABLE]
    clean["create_scope_views"](FakeSpark(), scopes)
    assert scope["ready"] is True
    rewritten = [_dataset(f"SELECT COUNT(*) AS n FROM {BASE}")]
    assert clean["scope_dataset_sql"](rewritten, "the dashboard", scopes) == []
    assert scope["view_ref"] in rewritten[0]["sql"] and BASE not in rewritten[0]["sql"]


def test_the_dashboard_check_takes_the_wizard_scope_so_its_view_is_an_allowed_read(clean):
    scopes = _scopes(clean)
    clean["create_scope_views"](FakeSpark(), scopes)
    assert clean["scope_views_refs"](scopes) == [scopes[TABLE]["view"]]
    assert clean["scope_views_refs"]() == [], "a wizard scope is not a Discover scope"


def test_the_genie_gate_points_the_space_at_the_view_and_refuses_a_space_that_names_the_base_table(clean):
    scopes = _scopes(clean)
    spark = FakeSpark()
    space = clean["scope_genie_space"](copy.deepcopy(_space(TABLE)), spark, scopes)
    table = space["data_sources"]["tables"][0]
    assert table["identifier"] == scopes[TABLE]["view"], "must read the view, not the base table"
    assert [c["column_name"] for c in table["column_configs"]] == ["order_id"], "only the scope columns stay in the space"
    assert any(f"CREATE OR REPLACE VIEW" in s and scopes[TABLE]["view"].split(".")[-1] in s for s in spark.statements)
    with pytest.raises(clean["ScopeBypassError"], match="the Genie space names main.s.orders"):
        clean["assert_scope_sources"]([TABLE], "the Genie space", scopes)


def test_the_app_gate_refuses_a_page_that_reads_the_base_table_and_passes_the_page_that_reads_the_view(clean):
    scopes = _scopes(clean)
    page = {"id": "orders", "datasets": [_dataset(f"SELECT * FROM {BASE}")]}
    with pytest.raises(clean["ScopeBypassError"], match="the App page orders dataset d reads main.s.orders"):
        clean["scope_app_pages"]([], page, scopes)
    clean["SCOPE_BYPASSES"].clear()
    clean["create_scope_views"](FakeSpark(), scopes)
    page = {"id": "orders", "datasets": [_dataset(f"SELECT * FROM {BASE}")]}
    assert clean["scope_app_pages"]([], page, scopes) == [], "the rewritten page passes the gate"
    assert scopes[TABLE]["view_ref"] in page["datasets"][0]["sql"]


def test_two_use_cases_on_one_table_get_two_view_names_and_neither_replaces_the_other(clean):
    first = _scopes(clean, "N01-U03")[TABLE]
    second = _scopes(clean, "N02-U05")[TABLE]
    assert first["view"] != second["view"]
    assert first["view"].startswith("main.insp.") and "n01_u03" in first["view"]
    assert "n02_u05" in second["view"] and first["view"].endswith("__implement_scope")
    spark = FakeSpark()
    clean["create_scope_views"](spark, _scopes(clean, "N01-U03"))
    clean["create_scope_views"](spark, _scopes(clean, "N02-U05"))
    created = [s.split(" AS ")[0] for s in spark.statements]
    assert len(set(created)) == 2, created


def test_a_global_discover_scope_does_not_rename_the_wizard_view(clean):
    clean["INSPIRE_TABLE_SCOPES"].update(clean["parse_table_scopes"](json.dumps({OTHER: {"columns": ["id"]}}), DATABASE))
    scopes = _scopes(clean)
    assert scopes[TABLE]["view"].endswith("__implement_scope")
    assert clean["scopes_in_force"](scopes)[TABLE] is scopes[TABLE], "the wizard scope wins for its own table"


def test_a_wizard_scope_on_table_b_is_found_on_the_run_even_when_a_discover_scope_exists_on_table_a(clean):
    clean["INSPIRE_TABLE_SCOPES"].update(clean["parse_table_scopes"](json.dumps({OTHER: {"columns": ["id"]}})))
    wizard = _scopes(clean, table=TABLE)[TABLE]
    clean["INSPIRE_RUN"] = {"table_scopes": {TABLE.lower(): clean["scope_record"](wizard)}, "scoped_tables": [TABLE.lower()]}
    found = clean["inspire_table_scope"](TABLE)
    assert found is not None and found["columns"] == ["order_id", "total_price"], "refused a scope that the run carries"
    assert clean["inspire_table_scope"](OTHER)["columns"] == ["id"], "a Discover scope still applies to its own table"


def test_an_earlier_bypass_does_not_stop_a_later_use_case_but_a_new_one_does(clean):
    clean["SCOPE_BYPASSES"].append("an earlier use case read a base table")
    mark = len(clean["SCOPE_BYPASSES"])
    clean["enforce_scope_gate"](mark)
    clean["SCOPE_BYPASSES"].append("this use case reads a base table")
    with pytest.raises(clean["ScopeBypassError"], match="this use case reads a base table"):
        clean["enforce_scope_gate"](mark)


def test_a_use_case_run_is_built_past_an_earlier_bypass(clean):
    inst = build_inspire(clean)
    uc = make_uc()
    clean["SCOPE_BYPASSES"].append("an earlier use case read a base table")
    spec = inst._genie_notebook_spec(uc)
    data = _gold(inst._genie_involved_tables(uc)[0])
    source = inst._genie_run_controls_source(dict(uc, _implement_data=data), spec, str(uc.get("genie_instruction") or ""))
    assert "INSPIRE_RUN = " in source


def test_a_kpi_outside_the_discover_scope_is_refused_by_the_kpi_builder_the_discover_path_uses(clean):
    clean["INSPIRE_TABLE_SCOPES"].update(clean["parse_table_scopes"](json.dumps({TABLE: {"columns": ["order_id"]}}), DATABASE))
    spec = {"table": TABLE, "aggregation": "SUM", "column": "total_price"}
    with pytest.raises(ValueError, match="outside the Table Scope"):
        clean["DeepEvidence"].kpi_sql(spec)


def test_the_scoped_kpi_and_read_sources_are_valid_spark_sql_with_an_aliased_subquery(clean):
    scopes = _scopes(clean)
    kpi = {"table": TABLE, "aggregation": "SUM", "column": "total_price"}
    sql = clean["DeepEvidence"].kpi_sql(kpi, scopes)
    assert _unready_subqueries(sql) == [], sql
    assert _unready_subqueries(f"SELECT COUNT(*) AS n FROM {clean['scoped_source']('main', 's', 'orders')}") == []
    join = (f"SELECT f.*, j0.`order_id` AS `x` FROM (SELECT * FROM {clean['scoped_read_source'](TABLE, scopes)}) AS f "
            f"LEFT JOIN {clean['scoped_source']('main', 's', 'orders', alias='j0')} ON f.`order_id` = j0.`order_id`")
    assert _unready_subqueries(join) == [], join
    sample = clean["DeepEvidence"]._source(types.SimpleNamespace(sample_rows=10), clean["scoped_read_source"](TABLE, scopes), 10**9)[0]
    assert _unready_subqueries(f"SELECT COUNT(*) AS n FROM {sample}") == [], sample
    sqlglot.parse_one(sql, read="databricks")


def test_the_pre_alias_form_is_the_one_the_parse_check_rejects(clean):
    unaliased = "SELECT COUNT(*) AS n FROM (SELECT `order_id` FROM `main`.`s`.`orders` WHERE `status` = 'gold')"
    assert len(_unready_subqueries(unaliased)) == 1


def test_the_dashboard_definition_check_refuses_a_base_table_dataset_and_accepts_the_view_it_is_rewritten_to(clean):
    scopes = _scopes(clean)
    dashboard = {"datasets": [_dataset(f"SELECT COUNT(*) AS n FROM {BASE}", name="decision")], "pages": []}
    _, errors = clean["check_dashboard_definition"](json.dumps(dashboard), [], "", None, scopes)
    assert any("the dashboard dataset decision reads main.s.orders" in e for e in errors), errors
    clean["SCOPE_BYPASSES"].clear()
    clean["create_scope_views"](FakeSpark(), scopes)
    dashboard = {"datasets": [_dataset(f"SELECT COUNT(*) AS n FROM {BASE}", name="decision")], "pages": []}
    _, errors = clean["check_dashboard_definition"](json.dumps(dashboard), [], "", None, scopes)
    assert not any("reads main.s.orders" in e for e in errors), errors
