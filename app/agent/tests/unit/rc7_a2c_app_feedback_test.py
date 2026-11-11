"""rc.7 A2c: a page with no results table keeps its reported issues in a reports table per App: <db>.__inspire_app_feedback_<app>.
The notebook creates it with the per-result feedback columns. An App with its own service principal gets read and report access on
its own table only, and the deploy blocks when that grant fails. An App placed inside Inspire has no service principal, so its
reports go through Inspire's own writer on its own table. Apps built before this get the table at their next update, and until
then the form says where to send the report."""
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
APP_TABLE = "main.inspire.__inspire_app_feedback_churn_desk"
INSIDE_TABLE = "main.inspire.__inspire_app_feedback_n01_u01"
OUTPUTS = {"dashboard": True, "app": True, "app_name": "churn-desk", "app_access": "sp", "app_owners": []}


def column_part(ddl):
    return ddl.split(" (", 1)[1]


def test_the_table_name_is_per_app_and_follows_the_one_naming_rule(agent_ns):
    table = agent_ns["inspire_app_feedback_table"]
    assert table(DATABASE, "churn-desk") == APP_TABLE
    assert table(DATABASE, "Churn--Desk 2") == "main.inspire.__inspire_app_feedback_churn_desk_2"
    assert table(DATABASE, "churn-desk", "N01-U01", True) == INSIDE_TABLE
    assert table(DATABASE, "", "N01-U01") == INSIDE_TABLE


def test_the_app_level_table_has_the_same_columns_as_the_per_result_feedback_table(agent_ns):
    app_ddl = agent_ns["inspire_app_feedback_create_sql"](APP_TABLE)
    result_ddl = agent_ns["inspire_feedback_create_sql"]("main.inspire.churn_out")
    assert app_ddl.startswith("CREATE TABLE IF NOT EXISTS ") and "`__inspire_app_feedback_churn_desk`" in app_ddl
    assert column_part(app_ddl) == column_part(result_ddl)


def test_the_app_settings_name_the_database_and_the_apps_own_table(agent_ns):
    page_id = returns_page()["id"]
    built = agent_ns["implement_app_settings"](2, "N09-U03 Returns", [page_id], None, "", "2026-11-11T00:00:00Z", outputs=OUTPUTS,
                                               database=DATABASE, feedback_table=APP_TABLE)
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


def test_the_app_with_its_own_service_principal_gets_read_and_report_access_on_its_own_table_only(agent_ns):
    inst, calls = stub_agent(agent_ns)
    ran = []
    inst._implement_app_feedback_table(APP_TABLE, "app-sp-1", ran)
    assert calls["sql"] == [agent_ns["inspire_app_feedback_create_sql"](APP_TABLE)]
    [(table, client, needs, refused)] = calls["access"]
    assert (table, client) == (APP_TABLE, "app-sp-1")
    assert needs == agent_ns["IMPLEMENT_READ_NEEDS"] + (agent_ns["IMPLEMENT_MODIFY_NEED"],)
    assert refused == agent_ns["IMPLEMENT_FEEDBACK_REFUSED"]
    assert all(t == APP_TABLE for t, *_rest in calls["access"]), "no other App's table is granted"


def test_a_failed_grant_on_the_apps_own_table_blocks_the_deploy(agent_ns):
    inst, _calls = stub_agent(agent_ns, warnings=["people cannot report issues in this App"])
    with pytest.raises(agent_ns["ImplementBlocked"]) as blocked:
        inst._implement_app_feedback_table(APP_TABLE, "app-sp-1", [])
    assert "so Inspire did not deploy the App" in str(blocked.value) and APP_TABLE in str(blocked.value)


def test_a_failed_grant_on_an_existing_app_is_a_warning_and_the_deploy_still_ships(agent_ns):
    inst, _calls = stub_agent(agent_ns, warnings=["people cannot report issues in this App"])
    warnings = inst._implement_app_feedback_table(APP_TABLE, "app-sp-1", [], block=False)
    assert warnings == ["people cannot report issues in this App"]


def test_a_failed_create_blocks_the_deploy_for_an_app_with_a_service_principal_and_for_one_inside_inspire(agent_ns):
    inst, _calls = stub_agent(agent_ns, spark_error=RuntimeError("PERMISSION_DENIED on the schema"))
    with pytest.raises(agent_ns["ImplementBlocked"]) as blocked:
        inst._implement_app_feedback_table(APP_TABLE, "app-sp-1", [])
    assert "PERMISSION_DENIED" in str(blocked.value)
    with pytest.raises(agent_ns["ImplementBlocked"]):
        inst._implement_app_feedback_create(INSIDE_TABLE)


def test_an_app_inside_inspire_gets_its_table_created_with_the_builders_identity_and_no_grant(agent_ns):
    inst, calls = stub_agent(agent_ns)
    inst._implement_app_feedback_create(INSIDE_TABLE)
    assert calls["sql"] == [agent_ns["inspire_app_feedback_create_sql"](INSIDE_TABLE)]
    assert calls["access"] == [], "no service principal, so no grant is made to any App"


def test_the_deploy_creates_the_table_for_every_app_and_grants_only_when_it_has_a_service_principal():
    import _agentload
    tree = ast.parse(_agentload.agent_source())
    deploy = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "_implement_deploy_app")
    grants = [n for n in ast.walk(deploy) if isinstance(n, ast.Call) and getattr(n.func, "attr", "") == "_implement_app_feedback_table"]
    creates = [n for n in ast.walk(deploy) if isinstance(n, ast.Call) and getattr(n.func, "attr", "") == "_implement_app_feedback_create"]
    assert len(grants) == 1 and len(creates) == 1
    conditions = [n.test for n in ast.walk(deploy) if isinstance(n, ast.IfExp) or isinstance(n, ast.If)]
    assert any(isinstance(t, ast.BoolOp) and any(isinstance(v, ast.Name) and v.id == "feedback" for v in t.values) for t in conditions)


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


def test_a_result_less_page_writes_its_report_to_its_own_app_table_and_is_never_refused():
    writes = []
    stub = stub_shell(result_less_page(), APP_TABLE, writes)
    out = shell_core.Shell.feedback_report(stub, {}, {"page": result_less_page()["id"], "section": "work", "text": "Totals look wrong"})
    assert out["items"] == []
    [(sql, params)] = writes
    assert sql.startswith("INSERT INTO `main`.`inspire`.`__inspire_app_feedback_churn_desk` ")
    assert any(p.get("value") == "Totals look wrong" for p in params)


def test_a_page_with_a_results_table_still_writes_to_its_own_feedback_table():
    writes = []
    stub = stub_shell(returns_page(), APP_TABLE, writes)
    shell_core.Shell.feedback_report(stub, {}, {"page": returns_page()["id"], "section": "work", "text": "Totals look wrong"})
    [(sql, _params)] = writes
    assert sql.startswith("INSERT INTO `main`.`shop`.`returns_out_feedback` ")


def test_an_app_built_before_this_says_where_to_send_the_report_instead_of_a_bare_refusal():
    stub = stub_shell(result_less_page(), "", [])
    with pytest.raises(shell_core.HttpError) as refused:
        shell_core.Shell.feedback_page(stub, result_less_page()["id"])
    assert refused.value.status == 409
    assert "Build page" in refused.value.message and "owner" in refused.value.message
    assert "nowhere" not in refused.value.message


@pytest.mark.parametrize("route,page_has_table,built,problem", [
    ("feedback", False, "", ""),
    ("settings/save", False, "", "this page names a result table Inspire did not build for it"),
    ("feedback", True, "main.shop.returns_out", ""),
    ("feedback", True, "main.other.table", "this page names a result table Inspire did not build for it"),
])
def test_inside_inspire_the_feedback_step_needs_no_results_table_and_the_other_steps_still_do(route, page_has_table, built, problem):
    page = returns_page() if page_has_table else result_less_page()
    assert shell_core.decision_table_problem(page, route, built).startswith(problem) if problem else shell_core.decision_table_problem(page, route, built) == ""


def test_feedback_is_an_inside_decision_step_so_Inspire_writes_it_with_its_own_writer():
    assert "feedback" in shell_core.CLI_ROUTES
