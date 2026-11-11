"""rc.7 A2c (REQ-012/REQ-049 follow-up): a page with no results table keeps its reported issues in one App-level table per Inspire
database. The notebook creates it with the same columns as the per-result feedback table, grants the App's service principal
read and report access, and blocks the deploy when that grant fails. The App writes there and the Build page reads both tables."""
import ast
import copy
import os
import sys
import types

import pytest

from v161_app_column_filters_test import returns_page

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_core  # noqa: E402
import shell_sql  # noqa: E402

DATABASE = "main.inspire"
APP_TABLE = "main.inspire.__inspire_app_feedback"
OUTPUTS = {"dashboard": True, "app": True, "app_name": "returns-desk", "app_access": "sp", "app_owners": []}


def column_part(ddl):
    return ddl.split(" (", 1)[1]


def test_the_app_level_table_has_the_same_columns_as_the_per_result_feedback_table(agent_ns):
    app_ddl = agent_ns["inspire_app_feedback_create_sql"](DATABASE)
    result_ddl = agent_ns["inspire_feedback_create_sql"]("main.inspire.churn_out")
    assert app_ddl.startswith("CREATE TABLE IF NOT EXISTS ") and "`__inspire_app_feedback`" in app_ddl
    assert column_part(app_ddl) == column_part(result_ddl)
    assert agent_ns["inspire_app_feedback_table"](DATABASE) == APP_TABLE


def test_the_app_settings_name_the_database_and_the_app_level_table(agent_ns):
    page_id = returns_page()["id"]
    built = agent_ns["implement_app_settings"](2, "N09-U03 Returns", [page_id], None, "", "2026-11-11T00:00:00Z", outputs=OUTPUTS, database=DATABASE)
    assert built["inspire_database"] == DATABASE and built["feedback_table"] == APP_TABLE
    bare = agent_ns["implement_app_settings"](2, "N09-U03 Returns", [page_id], None, "", "2026-11-11T00:00:00Z", outputs=OUTPUTS)
    assert "feedback_table" not in bare and "inspire_database" not in bare


def impl_class(agent_ns):
    return next(v for v in agent_ns.values() if isinstance(v, type) and hasattr(v, "_implement_app_feedback_table"))


def stub_agent(agent_ns, warnings=(), spark_error=None):
    cls = impl_class(agent_ns)
    inst = cls.__new__(cls)
    calls = {"sql": [], "access": []}

    def sql(statement):
        calls["sql"].append(statement)
        if spark_error:
            raise spark_error

    inst.spark = types.SimpleNamespace(sql=sql)
    inst._implement_access_rows = lambda table: []

    def access(table, client_id, rows, needs, refused, ran=None):
        calls["access"].append((table, client_id, needs, refused))
        return list(warnings)

    inst._implement_app_write_access = access
    return inst, calls


def test_the_deploy_creates_the_table_and_grants_read_and_report_access_to_the_app(agent_ns):
    inst, calls = stub_agent(agent_ns)
    ran = []
    inst._implement_app_feedback_table(DATABASE, "app-sp-1", ran)
    assert calls["sql"] == [agent_ns["inspire_app_feedback_create_sql"](DATABASE)]
    [(table, client, needs, refused)] = calls["access"]
    assert (table, client) == (APP_TABLE, "app-sp-1")
    assert needs == agent_ns["IMPLEMENT_READ_NEEDS"] + (agent_ns["IMPLEMENT_MODIFY_NEED"],)
    assert refused == agent_ns["IMPLEMENT_FEEDBACK_REFUSED"]


def test_a_failed_grant_on_the_app_level_table_blocks_the_deploy(agent_ns):
    inst, _calls = stub_agent(agent_ns, warnings=["people cannot report issues in this App"])
    with pytest.raises(agent_ns["ImplementBlocked"]) as blocked:
        inst._implement_app_feedback_table(DATABASE, "app-sp-1", [])
    assert "so Inspire did not deploy the App" in str(blocked.value) and APP_TABLE in str(blocked.value)


def test_a_failed_create_of_the_app_level_table_blocks_the_deploy(agent_ns):
    inst, _calls = stub_agent(agent_ns, spark_error=RuntimeError("PERMISSION_DENIED on the schema"))
    with pytest.raises(agent_ns["ImplementBlocked"]) as blocked:
        inst._implement_app_feedback_table(DATABASE, "app-sp-1", [])
    assert "PERMISSION_DENIED" in str(blocked.value)


def test_the_deploy_calls_the_app_level_table_only_when_the_database_is_known():
    import _agentload
    tree = ast.parse(_agentload.agent_source())
    deploy = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "_implement_deploy_app")
    calls = [n for n in ast.walk(deploy) if isinstance(n, ast.Call) and getattr(n.func, "attr", "") == "_implement_app_feedback_table"]
    assert len(calls) == 1
    guards = [n for n in ast.walk(deploy) if isinstance(n, ast.If) and any(c is calls[0] for c in ast.walk(n))]
    assert any(isinstance(g.test, ast.Name) and g.test.id == "database" for g in guards)


def result_less_page():
    page = copy.deepcopy(returns_page())
    page.pop("result_table", None)
    return page


def stub_shell(page, app_table, writes):
    shell_class = shell_core.Shell
    stub = types.SimpleNamespace(settings={"feedback_table": app_table} if app_table else {})
    stub.page = lambda ident: page
    stub.editor = lambda headers: "sam.roe@example.com"
    stub.workspace = lambda headers: (object(), "sam.roe@example.com")
    stub.decision_writer = lambda ws: ws
    stub.feedback_allowed = lambda editor: None
    stub.feedback_list = lambda headers, ident: {"items": []}
    stub.execute = lambda writer, sql, params, n, delta=False: writes.append((sql, list(params)))
    stub.feedback_page = lambda ident: shell_class.feedback_page(stub, ident)
    stub.feedback_missing = lambda page_, error: AssertionError(str(error))
    stub.write_refused = lambda table, error, as_app: AssertionError(str(error))
    return stub


def test_a_result_less_page_writes_its_report_to_the_app_level_table_and_is_never_refused():
    writes = []
    stub = stub_shell(result_less_page(), APP_TABLE, writes)
    out = shell_core.Shell.feedback_report(stub, {}, {"page": result_less_page()["id"], "section": "work", "text": "Totals look wrong"})
    assert out["items"] == []
    [(sql, params)] = writes
    assert sql.startswith("INSERT INTO `main`.`inspire`.`__inspire_app_feedback` ")
    assert any(p.get("value") == "Totals look wrong" for p in params)


def test_a_page_with_a_results_table_still_writes_to_its_own_feedback_table():
    writes = []
    stub = stub_shell(returns_page(), APP_TABLE, writes)
    shell_core.Shell.feedback_report(stub, {}, {"page": returns_page()["id"], "section": "work", "text": "Totals look wrong"})
    [(sql, _params)] = writes
    assert sql.startswith("INSERT INTO `main`.`shop`.`returns_out_feedback` ")


def test_a_result_less_page_of_an_app_built_before_the_table_exists_is_still_refused_with_the_reason():
    stub = stub_shell(result_less_page(), "", [])
    with pytest.raises(shell_core.HttpError) as refused:
        shell_core.Shell.feedback_page(stub, result_less_page()["id"])
    assert refused.value.status == 409 and "nowhere to keep reported issues" in refused.value.message
