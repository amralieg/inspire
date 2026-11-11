"""rc.7 A2c: a page with no results table keeps its reported issues in a reports table per App, <db>.__inspire_app_feedback_<app>.
The name comes from the implement row's app name (the use case id when unnamed). An App with its own service principal gets read and
report access on its own table only. An App placed inside Inspire writes through Inspire's own service identity, which the build
grants on the table. An existing App whose grant fails keeps working with a warning, and the App's files carry no reports table, so
its form says where to send the report."""
import ast
import copy
import json
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

DATABASE = "main.inspire"
APP_TABLE = "main.inspire.__inspire_app_feedback_churn_desk"
INSIDE_TABLE = "main.inspire.__inspire_app_feedback_n01_u01"
OUTPUTS = {"dashboard": True, "app": True, "app_name": "churn-desk", "app_access": "sp", "app_owners": []}


def column_part(ddl):
    return ddl.split(" (", 1)[1]


def test_the_table_name_comes_from_the_app_name_and_falls_back_to_the_use_case(agent_ns):
    table = agent_ns["inspire_app_feedback_table"]
    assert table(DATABASE, "churn-desk") == APP_TABLE
    assert table(DATABASE, "Churn--Desk 2") == "main.inspire.__inspire_app_feedback_churn_desk_2"
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


def test_a_grant_that_fails_takes_the_reports_table_out_of_the_app_files(agent_ns):
    settings = {"version": 2, "title": "N09-U03", "feedback_table": APP_TABLE, "inspire_database": DATABASE}
    files = {agent_ns["IMPLEMENT_APP_SETTINGS_FILE"]: json.dumps(settings)}
    kept = agent_ns["implement_app_mark_feedback"](files, True)
    assert json.loads(kept[agent_ns["IMPLEMENT_APP_SETTINGS_FILE"]])["feedback_table"] == APP_TABLE
    dropped = json.loads(agent_ns["implement_app_mark_feedback"](files, False)[agent_ns["IMPLEMENT_APP_SETTINGS_FILE"]])
    assert "feedback_table" not in dropped and dropped["inspire_database"] == DATABASE


def impl_class(agent_ns):
    return next(v for v in agent_ns.values() if isinstance(v, type) and hasattr(v, "_implement_app_feedback_table"))


def stub_agent(agent_ns, warnings=(), spark_error=None, principal="insp-sp", api=None):
    cls = impl_class(agent_ns)
    inst = cls.__new__(cls)
    calls = {"sql": [], "access": [], "api": []}

    def sql(statement):
        calls["sql"].append(statement)
        if spark_error:
            raise spark_error

    inst.spark = types.SimpleNamespace(sql=sql)
    inst._implement_access_rows = lambda table: []

    def access(table, client_id, rows, needs, refused, ran=None):
        calls["access"].append((table, client_id, needs, refused))
        return list(warnings)

    def request(method, path, body=None, query=None):
        calls["api"].append((method, path, query))
        return api if api is not None else {"Resources": [{"applicationId": principal}]} if principal else {"Resources": []}

    inst._implement_app_write_access = access
    inst._implement_api = request
    inst.logger = types.SimpleNamespace(warning=lambda *a, **k: None)
    return inst, calls


def test_the_app_with_its_own_service_principal_gets_read_and_report_access_on_its_own_table_only(agent_ns):
    inst, calls = stub_agent(agent_ns)
    inst._implement_app_feedback_table(APP_TABLE, "app-sp-1", [])
    assert calls["sql"] == [agent_ns["inspire_app_feedback_create_sql"](APP_TABLE)]
    [(table, client, needs, refused)] = calls["access"]
    assert (table, client) == (APP_TABLE, "app-sp-1")
    assert needs == agent_ns["IMPLEMENT_READ_NEEDS"] + (agent_ns["IMPLEMENT_MODIFY_NEED"],)
    assert refused == agent_ns["IMPLEMENT_FEEDBACK_REFUSED"]
    assert all(t == APP_TABLE for t, *_rest in calls["access"]), "no other App's table is granted"


def test_a_failed_grant_on_a_new_apps_table_blocks_the_deploy_and_on_an_existing_app_only_warns(agent_ns):
    inst, _calls = stub_agent(agent_ns, warnings=["people cannot report issues in this App"])
    with pytest.raises(agent_ns["ImplementBlocked"]) as blocked:
        inst._implement_app_feedback_table(APP_TABLE, "app-sp-1", [], True)
    assert "so Inspire did not deploy the App" in str(blocked.value) and APP_TABLE in str(blocked.value)
    assert inst._implement_app_feedback_table(APP_TABLE, "app-sp-1", [], False) == ["people cannot report issues in this App"]


def test_a_failed_create_blocks_a_new_app_and_only_warns_an_existing_one(agent_ns):
    inst, _calls = stub_agent(agent_ns, spark_error=RuntimeError("PERMISSION_DENIED on the schema"))
    with pytest.raises(agent_ns["ImplementBlocked"]) as blocked:
        inst._implement_app_feedback_create(APP_TABLE, True)
    assert "PERMISSION_DENIED" in str(blocked.value)
    [warning] = inst._implement_app_feedback_create(APP_TABLE, False)
    assert "PERMISSION_DENIED" in warning


def test_an_app_inside_inspire_gets_its_table_and_Inspires_own_identity_is_granted_on_it(agent_ns):
    inst, calls = stub_agent(agent_ns, principal="insp-sp")
    assert inst._implement_app_feedback_inside(INSIDE_TABLE, []) == []
    assert calls["sql"] == [agent_ns["inspire_app_feedback_create_sql"](INSIDE_TABLE)]
    [(table, principal, needs, refused)] = calls["access"]
    assert (table, principal) == (INSIDE_TABLE, "insp-sp")
    assert needs == agent_ns["IMPLEMENT_READ_NEEDS"] + (agent_ns["IMPLEMENT_MODIFY_NEED"],)
    [(method, path, query)] = calls["api"]
    assert (method, path) == ("GET", "/api/2.0/preview/scim/v2/ServicePrincipals")
    assert query["filter"] == 'displayName co "inspire-ai"'


def test_an_inside_app_whose_inspire_identity_cannot_be_found_gets_a_warning_not_a_grant(agent_ns):
    inst, calls = stub_agent(agent_ns, principal="")
    warnings = inst._implement_app_feedback_inside(INSIDE_TABLE, [])
    assert calls["access"] == [] and warnings and "Inspire's service principal could not be found" in warnings[0]


def test_inspires_identity_is_the_first_service_principal_with_an_application_id(agent_ns):
    inst, _calls = stub_agent(agent_ns, api={"Resources": [{"displayName": "other"}, {"applicationId": "insp-sp"}]})
    assert inst._implement_inspire_principal() == "insp-sp"
    inst, _calls = stub_agent(agent_ns, api={"Resources": []})
    assert inst._implement_inspire_principal() == ""


def test_the_deploy_gives_an_inside_app_its_table_before_the_host_page_is_built():
    import _agentload
    tree = ast.parse(_agentload.agent_source())
    deploy = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "_implement_deploy_app")
    assigned = [n.lineno for n in ast.walk(deploy) if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "feedback" for t in n.targets)]
    hosted_return = [n.lineno for n in ast.walk(deploy) if isinstance(n, ast.Call) and getattr(n.func, "attr", "") == "_implement_app_host_page"]
    inside = [n for n in ast.walk(deploy) if isinstance(n, ast.Call) and getattr(n.func, "attr", "") == "_implement_app_feedback_inside"]
    assert assigned and hosted_return and min(assigned) < min(hosted_return)
    assert len(inside) == 2, "an inside App and an App with no service principal both get Inspire's grant"


def result_less_page():
    page = copy.deepcopy(returns_page())
    page.pop("result_table", None)
    return page


def test_the_app_payload_says_where_a_report_goes_or_that_the_App_cannot_keep_one():
    assert shell_core.reports_view(returns_page(), "") == {"ready": True, "note": "", "where": shell_core.REPORTS_WHERE}
    assert shell_core.reports_view(result_less_page(), APP_TABLE)["ready"] is True
    old = shell_core.reports_view(result_less_page(), "")
    assert old["ready"] is False and old["note"] == shell_core.NO_FEEDBACK and "owner" in old["note"]
    assert "Build page" in old["note"]


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


@pytest.mark.parametrize("route,page_has_table,built,problem", [
    ("feedback", False, "", ""),
    ("settings/save", False, "", "this page names a result table Inspire did not build for it"),
    ("feedback", True, "main.shop.returns_out", ""),
    ("feedback", True, "main.other.table", "this page names a result table Inspire did not build for it"),
])
def test_inside_inspire_the_feedback_step_needs_no_results_table_and_the_other_steps_still_do(route, page_has_table, built, problem):
    page = returns_page() if page_has_table else result_less_page()
    got = shell_core.decision_table_problem(page, route, built)
    assert got.startswith(problem) if problem else got == ""


def test_feedback_is_an_inside_decision_step_so_Inspire_writes_it_with_its_own_identity():
    assert "feedback" in shell_core.CLI_ROUTES
