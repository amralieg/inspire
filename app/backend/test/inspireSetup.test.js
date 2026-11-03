const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const INSTALLER = path.resolve(__dirname, '..', '..', 'installer', 'inspire_setup.py');

const INSTALLER_LOADER = String.raw`
import ast as _ast, re as _re, types as _types
def load_installer(tree, body, ns, path):
    defs = {n.name: n for n in tree.body if isinstance(n, _ast.FunctionDef)}
    body = list(body)
    have = {n.name for n in body if isinstance(n, _ast.FunctionDef)} | set(ns)
    todo = list(body)
    while todo:
        for x in _ast.walk(todo.pop()):
            if isinstance(x, _ast.Name) and x.id in defs and x.id not in have:
                have.add(x.id)
                body.append(defs[x.id])
                todo.append(defs[x.id])
    ns.setdefault("re", _re)
    ns.setdefault("requests", _types.SimpleNamespace(exceptions=_types.SimpleNamespace(HTTPError=type("HTTPError", (Exception,), {}))))
    exec(compile(_ast.Module(body=body, type_ignores=[]), path, "exec"), ns)
`;

const PROBE = String.raw`${INSTALLER_LOADER}
import ast, sys
path = sys.argv[1]
tree = ast.parse(open(path, encoding="utf-8").read())
wanted = {"_is_own_service_principal", "_list_apps", "_app_service_principal_ids", "_deletable_service_principals"}
module = ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in wanted], type_ignores=[])
ns = {}
load_installer(tree, module.body, ns, path)
pages = {
    "/api/2.0/apps": {"apps": [{"name": "inspire-ai", "service_principal_client_id": "MEHDI"},
                               {"name": "inspire-ai-v130", "service_principal_client_id": "LIVE"}],
                      "next_page_token": "p2"},
    "/api/2.0/apps?page_token=p2": {"apps": [{"name": "other", "service_principal_client_id": "OTHER"}, {"name": "no-sp"}]},
}
in_use = ns["_app_service_principal_ids"](lambda p: pages[p])
assert in_use == {"MEHDI", "LIVE", "OTHER"}, in_use
sps = [{"displayName": "app-q7k2m9 inspire-ai-v130", "applicationId": "LIVE", "id": "1"},
       {"displayName": "app-q7k2m9 inspire-ai-v130", "applicationId": "STALE", "id": "2"},
       {"displayName": "app-q7k2m9 inspire-ai", "applicationId": "MEHDI", "id": "3"},
       {"displayName": "inspire-ai-v130-sp", "applicationId": "OLD", "id": "4"},
       {"displayName": "inspire-ai-cicd", "applicationId": "CICD", "id": "5"}]
deletable = ns["_deletable_service_principals"](sps, "inspire-ai-v130", "inspire-ai-v130-sp", in_use)
assert [sp["id"] for sp in deletable] == ["2", "4"], deletable
assert ns["_deletable_service_principals"](sps, "inspire-ai-v130", "inspire-ai-v130-sp", None) == []
print("ok")
`;

test('the installer never deletes a service principal an existing app still uses', (t) => {
  if (spawnSync('python3', ['--version']).status !== 0) {
    t.skip('python3 is not installed');
    return;
  }
  const run = spawnSync('python3', ['-c', PROBE, INSTALLER], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), 'ok');
});

const GRANTS_PROBE = String.raw`${INSTALLER_LOADER}
import ast, sys, types
path = sys.argv[1]
tree = ast.parse(open(path, encoding="utf-8").read())
wanted = {"step_grant_permissions", "_catalog_access_for_new_apps", "_lakebase_project_access", "_app_folder_access", "_assets_folder_access",
          "_workspace_api_path", "_grant_plan", "_scan_label", "_plural", "_privilege_word", "_can_grant", "_below_catalog_sql", "_real_grants",
          "_new_apps_catalog_decision", "_run_statement", "_statement_rows", "_wait_statement", "_scan_split", "_person_privileges",
          "_grant_refusal", "agent_lakebase"}
consts = {"LAKEBASE_CONSTANTS", "LAKEBASE_DELTA", "LAKEBASE_POLLS", "LAKEBASE_POLL_S", "ASSETS_PARENT", "SCAN_ALL", "SCAN_SKIPPED", "SCAN_GRANTS", "NEW_APPS_ACCOUNT_USERS", "NEW_APPS_OFF",
          "SYSTEM_SCHEMA", "BELOW_CATALOG_VIEWS", "REAL_GRANTS_SHOWN"}
module = ast.Module(body=[n for n in tree.body if (isinstance(n, ast.FunctionDef) and n.name in wanted)
                          or (isinstance(n, ast.Assign) and [t.id for t in n.targets if isinstance(t, ast.Name)][:1] in [[c] for c in consts])],
                    type_ignores=[])
import contextlib, io, json, time, urllib.parse
class StatementState:
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    PENDING = "PENDING"
    RUNNING = "RUNNING"
def run(catalog_grants, owner="amr@x", show_fails=False, lakebase=(200, ""), lakebase_catalog=False, folder=(200, 77), folder_grant=(200, ""),
        grantable=("sales",)):
    executed, patched = [], []
    def ok(rows=None):
        manifest = types.SimpleNamespace(schema=types.SimpleNamespace(columns=[types.SimpleNamespace(name=n) for n in ("Principal", "ActionType", "ObjectType", "ObjectKey")]))
        return types.SimpleNamespace(status=types.SimpleNamespace(state=StatementState.SUCCEEDED, error=None), manifest=manifest,
                                     result=types.SimpleNamespace(data_array=rows))
    class Statements:
        def execute_statement(self, warehouse_id, statement, wait_timeout):
            executed.append(statement)
            if statement.startswith("SHOW GRANTS ON CATALOG"):
                if show_fails:
                    return types.SimpleNamespace(status=types.SimpleNamespace(state=StatementState.FAILED,
                                                 error=types.SimpleNamespace(message="PERMISSION_DENIED: not the owner")))
                return ok([[p, a, "CATALOG", "main"] for p, a in catalog_grants])
            return ok()
    class Catalogs:
        def list(self):
            return [types.SimpleNamespace(name=n) for n in ["sales", "samples"] + (["inspire_lakebase"] if lakebase_catalog else [])]
        def get(self, name):
            return types.SimpleNamespace(name=name, owner=owner)
    def api(method, url, body=None):
        patched.append((method, url, body))
        if url == f"/api/2.0/postgres/catalogs/{LAKEBASE['catalog']}":
            bound = {"spec": {"branch": LAKEBASE["branch"], "postgres_database": LAKEBASE["database"]}}
            return types.SimpleNamespace(status_code=200 if lakebase_catalog else 404, text="", json=lambda: bound if lakebase_catalog else {})
        if url == f"/api/2.0/postgres/{LAKEBASE['endpoint']}":
            return types.SimpleNamespace(status_code=200, text="", json=lambda: {"status": {"hosts": {"host": "pg.example"}}})
        if url.startswith("/api/2.0/postgres/catalogs?"):
            return types.SimpleNamespace(status_code=403, text='{"error_code":"PERMISSION_DENIED","message":"no CREATE CATALOG"}', json=lambda: {})
        if url.startswith("/api/2.0/postgres/"):
            return types.SimpleNamespace(status_code=200, text="", json=lambda: {"name": "projects/inspire-apps"})
        if "/database-projects/" in url:
            return types.SimpleNamespace(status_code=lakebase[0], text=lakebase[1])
        if "/workspace/get-status" in url:
            return types.SimpleNamespace(status_code=folder[0], text="" if folder[0] == 200 else str(folder[1]),
                                         json=lambda: {"object_id": folder[1]})
        if "/permissions/directories/" in url:
            return types.SimpleNamespace(status_code=folder_grant[0], text=folder_grant[1])
        return types.SimpleNamespace(status_code=200, text="")
    ns = {"StatementState": StatementState, "time": time, "json": json, "urllib": urllib, "_catalog_privileges": lambda ctx, catalog: (catalog in grantable, set())}
    load_installer(tree, module.body, ns, path)
    ctx = {"LAKEBASE": LAKEBASE, "NEW_SP_APP_ID": "SP", "APP_NAME": "inspire-ai", "WAREHOUSE_ID": "wh", "CATALOG": "main", "SCHEMA": "_inspire", "available_catalogs": ["main"],
           "USER_EMAIL": "amr@x",
           "w": types.SimpleNamespace(statement_execution=Statements(), catalogs=Catalogs()), "api": api,
           "ASSETS_PATH": "/Workspace/Shared/inspire-ai/assets/v1.3.0"}
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        ns["step_grant_permissions"](ctx)
    return executed, patched, out.getvalue()
reader = {"json": json, "urllib": urllib, "time": time, "StatementState": StatementState}
load_installer(tree, module.body, reader, path)
LAKEBASE = reader["agent_lakebase"](open(sys.argv[2], encoding="utf-8").read())
executed, patched, said = run([("account users", "BROWSE"), ("SP", "USE CATALOG")])
volume = sorted(s for s in executed if "VOLUME" in s)
assert volume == sorted(f"GRANT {p} VOLUME ON SCHEMA \x60main\x60.\x60_inspire\x60 TO \x60SP\x60" for p in ("CREATE", "READ", "WRITE")), volume
assert "GRANT MODIFY ON SCHEMA \x60main\x60.\x60_inspire\x60 TO \x60SP\x60" in executed, executed
assert "GRANT CREATE MODEL ON SCHEMA \x60main\x60.\x60_inspire\x60 TO \x60SP\x60" in executed, executed
assert "GRANT MANAGE ON SCHEMA \x60main\x60.\x60_inspire\x60 TO \x60SP\x60" in executed, executed
assert [s for s in executed if "\x60sales\x60" in s] == [f"GRANT {p} ON CATALOG \x60sales\x60 TO \x60SP\x60" for p in ("USE_CATALOG", "USE_SCHEMA", "SELECT", "BROWSE")], executed
assert not [s for s in executed if "samples" in s], executed
assert not [s for s in executed if "\x60account users\x60" in s], executed
assert not [s for s in executed if s.startswith("GRANT MANAGE ON CATALOG")], executed
assert not [s for s in executed if "inspire_lakebase" in s], executed
refused_sql, _, refused_said = run([], grantable=())
assert not [s for s in refused_sql if "\x60sales\x60" in s], refused_sql
assert "sales" in refused_said and "you are not its owner or a metastore admin" in refused_said, refused_said
lakebase_sql = [s for s in run([], lakebase_catalog=True, grantable=("sales", "inspire_lakebase"))[0] if "inspire_lakebase" in s]
assert lakebase_sql == [f"GRANT {p} ON CATALOG \x60inspire_lakebase\x60 TO \x60SP\x60" for p in
                        ("USE_CATALOG", "USE_SCHEMA", "SELECT", "BROWSE", "ALL PRIVILEGES")], lakebase_sql
manage = {"access_control_list": [{"service_principal_name": "SP", "permission_level": "CAN_MANAGE"}]}
assert [(m, u) for m, u, b in patched if "/postgres/" in u] == [
    ("GET", f"/api/2.0/postgres/projects/{LAKEBASE['project']}"), ("GET", f"/api/2.0/postgres/catalogs/{LAKEBASE['catalog']}"),
    ("GET", f"/api/2.0/postgres/{LAKEBASE['endpoint']}"), ("POST", f"/api/2.0/postgres/catalogs?catalog_id={LAKEBASE['catalog']}")], patched
assert "Databricks refused to create the catalog \x60inspire_lakebase\x60 on the Lakebase project inspire-apps for you" in said, said
patched = [p for p in patched if "/postgres/" not in p[1]]
assert patched == [("PATCH", "/api/2.0/permissions/sql/warehouses/wh", manage),
                   ("PATCH", "/api/2.0/permissions/database-projects/inspire-apps", manage),
                   ("GET", "/api/2.0/workspace/get-status?path=/Shared/inspire-ai", None),
                   ("PATCH", "/api/2.0/permissions/directories/77", manage),
                   ("GET", "/api/2.0/workspace/get-status?path=/Shared/inspire-ai/assets", None),
                   ("PATCH", "/api/2.0/permissions/directories/77", {"access_control_list": [
                       {"service_principal_name": "SP", "permission_level": "CAN_READ"}, {"group_name": "users", "permission_level": "CAN_READ"}]})], patched
assert not [p for p in patched if "/permissions/apps/" in p[1]], patched
assert "CAN_READ on /Shared/inspire-ai/assets for SP and the users group, so every run reads the Inspire assets: ✅" in said, said
assert "CAN_MANAGE on /Shared/inspire-ai, so Implement can save every MVP there: ✅" in said, said
missing = run([], folder=(404, '{"error_code":"RESOURCE_DOES_NOT_EXIST"}'))
assert not [p for p in missing[1] if "/permissions/directories/" in p[1]], missing[1]
assert ("⚠️ Could not find /Shared/inspire-ai ({\"error_code\":\"RESOURCE_DOES_NOT_EXIST\"}), so SP may not be able to save MVPs there. "
        "A workspace admin can give SP Can Manage on that folder") in missing[2], missing[2]
refused = run([], folder_grant=(403, '{"error_code":"PERMISSION_DENIED"}'))[2]
assert ("⚠️ SP cannot save MVPs in /Shared/inspire-ai yet ({\"error_code\":\"PERMISSION_DENIED\"}). "
        "A workspace admin can give SP Can Manage on that folder") in refused, refused
assert "save every MVP there: ✅" not in refused, refused
assert "CAN_MANAGE on warehouse, so Implement can attach it to the Apps it creates: ✅" in said, said
assert "CAN_MANAGE on Lakebase project inspire-apps, so the Apps Implement builds can read Lakebase: ✅" in said, said
denied = run([], lakebase=(403, '{"error_code":"PERMISSION_DENIED","message":"no CAN_MANAGE on the project"}'))[2]
assert ("⚠️ SP cannot use the Lakebase project inspire-apps, because Databricks refused to give it Can Manage on that project "
        "({\"error_code\":\"PERMISSION_DENIED\",\"message\":\"no CAN_MANAGE on the project\"}). A workspace admin can give SP Can Manage on that "
        "project, or run this installer again; until then the Apps that Implement builds read Delta tables") in denied, denied
assert "Lakebase: ✅" not in denied and "creates it ✅" not in denied, denied
blocked = ("⚠️ Apps that Implement creates cannot read result tables in \x60main\x60 yet: their service principals need USE CATALOG, "
           "which account users do not hold, and Inspire can grant it only with MANAGE on the catalog. A catalog owner can run "
           "GRANT MANAGE ON CATALOG \x60main\x60 TO \x60SP\x60, or GRANT USE CATALOG ON CATALOG \x60main\x60 TO \x60account users\x60")
assert blocked in said, said
assert "New Apps can use catalog \x60main\x60: account users hold USE CATALOG ✅" in run([("Account Users", "USE_CATALOG")])[2]
assert "New Apps can use catalog \x60main\x60: account users hold USE CATALOG ✅" in run([("account users", "ALL PRIVILEGES")])[2]
assert "New Apps can use catalog \x60main\x60: Inspire can grant them USE CATALOG ✅" in run([("SP", "MANAGE")])[2]
assert "New Apps can use catalog \x60main\x60: Inspire can grant them USE CATALOG ✅" in run([], owner="SP")[2]
assert blocked in run([("someone@x", "MANAGE"), ("account users", "SELECT")])[2]
failed = run([], show_fails=True)[2]
assert "⚠️ Could not check who can use catalog \x60main\x60: PERMISSION_DENIED: not the owner" in failed, failed
print("ok")
`;

const BUNDLE_PROBE = String.raw`${INSTALLER_LOADER}
import ast, os, sys, tempfile, types, zipfile
path = sys.argv[1]
tree = ast.parse(open(path, encoding="utf-8").read())
wanted = {"_folder_has_app_yaml", "_normalize_bundle_root", "_unpack_bundle", "_workspace_api_path", "_remove_old_bundles", "_plural"}
module = ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in wanted], type_ignores=[])
import shutil, time
ns = {"os": os, "shutil": shutil, "time": time, "zipfile": zipfile, "print": lambda *a, **k: None}
load_installer(tree, module.body, ns, path)
work = tempfile.mkdtemp()
bundle = os.path.join(work, "bundle.zip")
with zipfile.ZipFile(bundle, "w") as zf:
    zf.writestr("app/app.yaml", "command: [node]\n")
    zf.writestr("app/backend/server.js", "x")
root = os.path.join(work, "InspireAI")
first = ns["_unpack_bundle"](bundle, root, stage=os.path.join(work, "stage"))
second = ns["_unpack_bundle"](bundle, root, stage=os.path.join(work, "stage"))
assert first != second and os.path.basename(first).startswith("bundle_"), (first, second)
assert os.path.exists(os.path.join(first, "app.yaml")) and os.path.exists(os.path.join(second, "backend", "server.js"))
empty = os.path.join(work, "empty.zip")
with zipfile.ZipFile(empty, "w") as zf:
    zf.writestr("readme.txt", "no app")
try:
    ns["_unpack_bundle"](empty, root, stage=os.path.join(work, "stage"))
except FileNotFoundError as exc:
    assert "No app.yaml" in str(exc), exc
else:
    raise AssertionError("a zip without app.yaml must stop the install")
deleted = []
def delete(p, recursive=False):
    if p.endswith("broken"):
        raise RuntimeError("permission denied")
    deleted.append(p)
entries = [types.SimpleNamespace(path=p) for p in ("/Users/me/InspireAI/bundle_1", "/Users/me/InspireAI/bundle_2",
                                                   "/Users/me/InspireAI/app.yaml", "/Users/me/InspireAI/broken")]
w = types.SimpleNamespace(workspace=types.SimpleNamespace(list=lambda p: entries if p == "/Users/me/InspireAI" else [], delete=delete))
removed = ns["_remove_old_bundles"](w, "/Workspace/Users/me/InspireAI", "/Workspace/Users/me/InspireAI/bundle_2", {})
assert removed == deleted == ["/Users/me/InspireAI/bundle_1", "/Users/me/InspireAI/app.yaml"], removed
def unlistable(p):
    raise RuntimeError("not found")
quiet = types.SimpleNamespace(workspace=types.SimpleNamespace(list=unlistable, delete=delete))
assert ns["_remove_old_bundles"](quiet, "/Workspace/Users/me/InspireAI", "/x/bundle_2", {}) == []
print("ok")
`;

const IN_USE_BUNDLE_PROBE = String.raw`${INSTALLER_LOADER}
import ast, os, sys, types
path = sys.argv[1]
tree = ast.parse(open(path, encoding="utf-8").read())
wanted = {"_workspace_api_path", "_list_apps", "_app_source_paths", "_remove_old_bundles", "_plural"}
module = ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in wanted], type_ignores=[])
ns = {"os": os, "print": lambda *a, **k: None}
load_installer(tree, module.body, ns, path)
pages = {
    "/api/2.0/apps": {"apps": [{"name": "inspire-ai-v130", "default_source_code_path": "/Workspace/Users/me/InspireAI/bundle_old",
                                "active_deployment": {"source_code_path": "/Workspace/Users/me/InspireAI/bundle_old/"}},
                               {"name": "stopped", "default_source_code_path": "/Workspace/Users/me/InspireAI/bundle_stopped"}],
                      "next_page_token": "p2"},
    "/api/2.0/apps?page_token=p2": {"apps": [
        {"name": "nested", "pending_deployment": {"source_code_path": "/Workspace/Users/me/InspireAI/bundle_nested/app"}},
        {"name": "elsewhere", "active_deployment": {"source_code_path": "/Workspace/Users/other/InspireAI-main"}},
        {"name": "suffixed", "active_deployment": {"source_code_path": "/Workspace/Users/me/InspireAI/bundle_stale_1"}},
        {"name": "never-deployed", "active_deployment": None}]},
}
in_use = ns["_app_source_paths"](lambda p: pages[p])
assert in_use == {"/Users/me/InspireAI/bundle_old": "inspire-ai-v130", "/Users/me/InspireAI/bundle_stopped": "stopped",
                  "/Users/me/InspireAI/bundle_nested/app": "nested", "/Users/other/InspireAI-main": "elsewhere",
                  "/Users/me/InspireAI/bundle_stale_1": "suffixed"}, in_use
deleted, listed = [], []
names = ("bundle_new", "bundle_old", "bundle_stopped", "bundle_nested", "bundle_old_2", "bundle_stale", "bundle_stale_1")
def listing(root):
    listed.append(root)
    return [types.SimpleNamespace(path=f"{root}/{name}") for name in names]
w = types.SimpleNamespace(workspace=types.SimpleNamespace(list=listing, delete=lambda p, recursive=False: deleted.append(p)))
removed = ns["_remove_old_bundles"](w, "/Workspace/Users/me/InspireAI", "/Workspace/Users/me/InspireAI/bundle_new", in_use)
assert listed == ["/Users/me/InspireAI"], listed
assert removed == deleted == ["/Users/me/InspireAI/bundle_old_2", "/Users/me/InspireAI/bundle_stale"], removed
listed.clear()
assert ns["_remove_old_bundles"](w, "/Workspace/Users/me/InspireAI", "/Workspace/Users/me/InspireAI/bundle_new", None) == []
assert listed == [] and deleted == ["/Users/me/InspireAI/bundle_old_2", "/Users/me/InspireAI/bundle_stale"], (listed, deleted)
print("ok")
`;

const DEPLOY_PROBE = String.raw`${INSTALLER_LOADER}
import ast, os, sys, types
path = sys.argv[1]
tree = ast.parse(open(path, encoding="utf-8").read())
wanted = {"step_deploy_and_find_sp", "_workspace_api_path", "_list_apps", "_app_source_paths", "_remove_old_bundles",
          "_is_own_service_principal", "_create_app", "_apply_user_scopes", "_scope_refused", "_merged_scopes", "_plural", "_app_url", "_noted_app_url"}
consts = {"INSPIRE_APP_OWN_SCOPES", "USER_SCOPES_REFUSED"}
module = ast.Module(body=[n for n in tree.body if (isinstance(n, ast.FunctionDef) and n.name in wanted)
                          or (isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in consts for t in n.targets))],
                    type_ignores=[])
ns = {"os": os, "print": lambda *a, **k: None, "time": types.SimpleNamespace(sleep=lambda s: None),
      "write_app_yaml_deploy": lambda *a: None}
load_installer(tree, module.body, ns, path)
source = "/Workspace/Users/me/InspireAI/bundle_new"
app = {"compute_status": {"state": "ACTIVE"}, "url": "https://app", "service_principal_client_id": "SPNEW",
       "service_principal_name": "app-sp",
       "active_deployment": {"deployment_id": "d1", "status": {"state": "SUCCEEDED"}, "source_code_path": source}}
def run(list_apps):
    deleted = []
    def api(method, url, body=None):
        payload = {"url": "https://app"} if url == "/api/2.0/apps" else {"deployment_id": "d1"}
        return types.SimpleNamespace(status_code=200, json=lambda: payload, text="")
    def api_get(url):
        if url == "/api/2.0/apps":
            return list_apps()
        if url == "/api/2.0/apps/inspire-ai-implement":
            return app
        if url.startswith("/api/2.0/preview/scim/v2/ServicePrincipals?filter=applicationId"):
            return {"Resources": [{"id": "1"}]}
        return {"Resources": []}
    entries = [types.SimpleNamespace(path=f"/Users/me/InspireAI/{name}") for name in ("bundle_new", "bundle_old", "bundle_stale")]
    w = types.SimpleNamespace(workspace=types.SimpleNamespace(list=lambda p: entries,
                                                              delete=lambda p, recursive=False: deleted.append(p)))
    ctx = {"api": api, "api_get": api_get, "SOURCE_FOLDER": source, "INSPIRE_DB": "main._inspire", "WAREHOUSE_ID": "wh",
           "NOTEBOOK_PATH": "/Shared/inspire-ai-implement/dbx_inspire_ai_agent", "SP_NAME": "inspire-ai-implement-sp",
           "APP_NAME": "inspire-ai-implement", "CATALOG": "main", "BUNDLE_ROOT": "/Workspace/Users/me/InspireAI", "w": w,
           "RELEASE_VERSION": "v1.3.0"}
    ns["step_deploy_and_find_sp"](ctx)
    assert ctx["NEW_SP_APP_ID"] == "SPNEW" and ctx["app_url"] == "https://app", ctx
    return deleted
apps = {"apps": [{"name": "inspire-ai-v130", "active_deployment": {"source_code_path": "/Workspace/Users/me/InspireAI/bundle_old"}},
                 {"name": "inspire-ai-implement", "active_deployment": {"source_code_path": source}}]}
assert run(lambda: apps) == ["/Users/me/InspireAI/bundle_stale"]
def forbidden():
    raise RuntimeError("apps list forbidden")
assert run(forbidden) == []
print("ok")
`;

const CLEANUP_PROBE = String.raw`${INSTALLER_LOADER}
import ast, sys, types
path = sys.argv[1]
tree = ast.parse(open(path, encoding="utf-8").read())
wanted = {"step_cleanup", "_is_own_service_principal", "_list_apps", "_app_service_principal_ids", "_deletable_service_principals",
          "_implemented_use_case_job", "_app_kept_reason"}
module = ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in wanted], type_ignores=[])
printed = []
ns = {"print": lambda *a, **k: printed.append(" ".join(str(x) for x in a)), "time": types.SimpleNamespace(sleep=lambda s: None)}
load_installer(tree, module.body, ns, path)
class Resp:
    def __init__(self, code, payload=None):
        self.status_code, self.payload, self.text = code, payload or {}, ""
    def json(self):
        return self.payload
    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")
def job(job_id, creator, **tags):
    return {"job_id": job_id, "creator_user_name": creator, "settings": {"name": f"job {job_id}", "tags": tags}}
USE_CASE = {"dbx_inspire_ai_run_type": "implement", "dbx_inspire_ai_usecase": "basket"}
LAUNCHER = {"dbx_inspire_ai_run_type": "implement", "dbx_inspire_ai_usecases": "0"}
APP = "/api/2.0/apps/inspire-ai-implement"
def run(pages=None, app_status=200, sp="SPAPP", jobs_error=None):
    calls, state = [], {"app": app_status}
    def api(method, url, body=None):
        calls.append((method, url))
        if url == APP and method == "DELETE":
            if state["app"] == 404:
                return Resp(404)
            state["app"] = 404
            return Resp(200)
        if url == APP:
            return Resp(state["app"], {"name": "inspire-ai-implement", "service_principal_client_id": sp, "compute_status": {"state": "ACTIVE"}})
        return Resp(200)
    def api_get(url):
        calls.append(("GET", url))
        if url.startswith("/api/2.1/jobs/list"):
            if jobs_error:
                raise RuntimeError(jobs_error)
            token = url.split("page_token=")[1] if "page_token=" in url else ""
            return (pages or {}).get(token, {"jobs": []})
        if url.startswith("/api/2.0/apps"):
            return {"apps": [{"name": "inspire-ai-implement", "service_principal_client_id": sp}] if state["app"] == 200 else []}
        if url.startswith("/api/2.0/preview/scim/v2/ServicePrincipals"):
            return {"Resources": [{"id": "77", "displayName": "inspire-ai-implement-sp", "applicationId": sp}]}
        return {}
    printed.clear()
    ns["step_cleanup"]({"api": api, "api_get": api_get, "APP_NAME": "inspire-ai-implement", "SP_NAME": "inspire-ai-implement-sp"})
    return calls, list(printed)
deleted_app = lambda calls: ("DELETE", APP) in calls
listed_jobs = lambda calls: [u for m, u in calls if u.startswith("/api/2.1/jobs/list")]
on_page_two = {"": {"jobs": [job(1, "someone", **USE_CASE), job(2, "SPAPP", **LAUNCHER)], "next_page_token": "p2"},
               "p2": {"jobs": [job(3, "SPAPP", **USE_CASE)]}}
calls, out = run(on_page_two)
assert not deleted_app(calls), calls
assert not any(m == "DELETE" and "ServicePrincipals" in u for m, u in calls), calls
assert any("Keeping app 'inspire-ai-implement' and its service principal" in line and "job 3" in line for line in out), out
assert len(listed_jobs(calls)) == 2, calls
calls, out = run({"": {"jobs": [job(1, "someone", **USE_CASE), job(2, "SPAPP", **LAUNCHER),
                               job(4, "SPAPP", dbx_inspire_ai_run_type="discovery", dbx_inspire_ai_usecase="basket")]}})
assert deleted_app(calls), calls
assert not any("Keeping app" in line for line in out), out
calls, out = run({"": {"jobs": [job(3, "SPAPP", **USE_CASE)], "next_page_token": "p2"}, "p2": {"jobs": []}})
assert not deleted_app(calls) and len(listed_jobs(calls)) == 1, calls
calls, out = run(jobs_error="jobs list forbidden")
assert not deleted_app(calls), calls
assert any("could not be checked" in line and "jobs list forbidden" in line for line in out), out
calls, out = run(app_status=500)
assert not deleted_app(calls) and not listed_jobs(calls), calls
calls, out = run(on_page_two, app_status=404)
assert deleted_app(calls) and not listed_jobs(calls), calls
assert any("No existing app" in line for line in out), out
calls, out = run(on_page_two, sp=None)
assert deleted_app(calls) and not listed_jobs(calls), calls
print("ok")
`;

const START_PROBE = String.raw`${INSTALLER_LOADER}
import ast, os, sys, types
path = sys.argv[1]
tree = ast.parse(open(path, encoding="utf-8").read())
wanted = {"step_deploy_and_find_sp", "_workspace_api_path", "_list_apps", "_app_source_paths", "_remove_old_bundles",
          "_is_own_service_principal", "_create_app", "_apply_user_scopes", "_scope_refused", "_merged_scopes", "_plural", "_app_url", "_noted_app_url"}
consts = {"INSPIRE_APP_OWN_SCOPES", "USER_SCOPES_REFUSED"}
module = ast.Module(body=[n for n in tree.body if (isinstance(n, ast.FunctionDef) and n.name in wanted)
                          or (isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in consts for t in n.targets))],
                    type_ignores=[])
ns = {"os": os, "print": lambda *a, **k: None, "time": types.SimpleNamespace(sleep=lambda s: None),
      "write_app_yaml_deploy": lambda *a: None}
load_installer(tree, module.body, ns, path)
source = "/Workspace/Users/me/InspireAI/bundle_new"
def run(first_state):
    app = {"compute_status": {"state": first_state}, "url": "https://app", "service_principal_client_id": "SPKEPT",
           "service_principal_name": "app-sp",
           "active_deployment": {"deployment_id": "d1", "status": {"state": "SUCCEEDED"}, "source_code_path": source}}
    started = []
    def api(method, url, body=None):
        if url == "/api/2.0/apps/inspire-ai-implement/start":
            started.append(method)
            app["compute_status"] = {"state": "ACTIVE"}
        if url == "/api/2.0/apps":
            return types.SimpleNamespace(status_code=409, json=lambda: {}, text="App with name inspire-ai-implement already exists")
        return types.SimpleNamespace(status_code=200, json=lambda: {"deployment_id": "d1"}, text="")
    def api_get(url):
        if url == "/api/2.0/apps":
            return {"apps": [{"name": "inspire-ai-implement", "active_deployment": {"source_code_path": source}}]}
        if url == "/api/2.0/apps/inspire-ai-implement":
            return app
        if url == "/api/2.0/apps/inspire-ai-implement/update":
            return {"status": {"state": "SUCCEEDED"}}
        if url.startswith("/api/2.0/preview/scim/v2/ServicePrincipals?filter=applicationId"):
            return {"Resources": [{"id": "1"}]}
        return {"Resources": []}
    w = types.SimpleNamespace(workspace=types.SimpleNamespace(list=lambda p: [], delete=lambda p, recursive=False: None))
    ctx = {"api": api, "api_get": api_get, "SOURCE_FOLDER": source, "INSPIRE_DB": "main._inspire", "WAREHOUSE_ID": "wh",
           "NOTEBOOK_PATH": "/Shared/inspire-ai-implement/dbx_inspire_ai_agent", "SP_NAME": "inspire-ai-implement-sp",
           "APP_NAME": "inspire-ai-implement", "CATALOG": "main", "BUNDLE_ROOT": "/Workspace/Users/me/InspireAI", "w": w,
           "RELEASE_VERSION": "v1.3.0"}
    ns["step_deploy_and_find_sp"](ctx)
    assert ctx["NEW_SP_APP_ID"] == "SPKEPT", ctx
    return started
assert run("STOPPED") == ["POST"]
assert run("ACTIVE") == []
print("ok")
`;

const MAIN_PROBE = String.raw`${INSTALLER_LOADER}
import ast, sys, types
path = sys.argv[1]
tree = ast.parse(open(path, encoding="utf-8").read())
entry = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "run"]
assert len(entry) == 1, "one run entry point"
shown, ran = [], []
class HTTPError(Exception):
    pass
def failing_context(env):
    raise RuntimeError("Deploy FAILED: app did not start")
steps = {name: (lambda ctx, n=name: ran.append(n)) for name in ("step_preflight", "step_bundle", "step_assets", "step_cleanup", "step_schema_and_notebooks",
                                                                  "step_deploy_and_find_sp", "step_grant_permissions", "step_render_done")}
ns = dict(steps, build_runtime_context=failing_context, show_warning_banner=lambda title, detail: shown.append((title, detail)),
          requests=types.SimpleNamespace(exceptions=types.SimpleNamespace(HTTPError=HTTPError)))
load_installer(tree, entry, ns, path)
try:
    ns["run"]({"dbutils": None, "displayHTML": None})
except RuntimeError as exc:
    assert "Deploy FAILED" in str(exc)
else:
    raise AssertionError("a failed install must fail the job, not end as a success")
assert shown == [("Setup incomplete", "Deploy FAILED: app did not start")], shown
assert ran == [], ran
ns["build_runtime_context"] = lambda env: {"ready": False}
assert ns["run"]({"dbutils": None, "displayHTML": None}) is None and ran == [], ran
print("ok")
`;

for (const [name, probe] of [
  ['a reinstall unpacks into a new bundle folder and removes the older ones through the API', BUNDLE_PROBE],
  ['a reinstall never removes a bundle folder an app still runs from, and removes none when the apps cannot be listed', IN_USE_BUNDLE_PROBE],
  ['the deploy step removes only the older bundles that no app runs from', DEPLOY_PROBE],
  ['an incomplete install shows its banner and fails the job', MAIN_PROBE],
  ['a reinstall keeps the app and its service principal while they run implemented use cases, and cleans up otherwise', CLEANUP_PROBE],
  ['a kept app whose compute is stopped is started before the new bundle is deployed', START_PROBE],
]) {
  test(name, (t) => {
    if (spawnSync('python3', ['--version']).status !== 0) {
      t.skip('python3 is not installed');
      return;
    }
    const run = spawnSync('python3', ['-c', probe, INSTALLER], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.equal(run.stdout.trim().split('\n').pop(), 'ok');
  });
}

const REMOVED_PROBE = String.raw`${INSTALLER_LOADER}
import ast, os, sys, types
path = sys.argv[1]
tree = ast.parse(open(path, encoding="utf-8").read())
wanted = {"_workspace_api_path", "_remove_old_bundles", "_plural"}
module = ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in wanted], type_ignores=[])
said = []
ns = {"os": os, "print": lambda *a, **k: said.append(" ".join(str(x) for x in a))}
load_installer(tree, module.body, ns, path)
def removing(names):
    said.clear()
    entries = [types.SimpleNamespace(path=f"/Users/me/InspireAI/{name}") for name in names]
    w = types.SimpleNamespace(workspace=types.SimpleNamespace(list=lambda p: entries, delete=lambda p, recursive=False: None))
    ns["_remove_old_bundles"](w, "/Workspace/Users/me/InspireAI", "/Workspace/Users/me/InspireAI/bundle_new", {})
    return list(said)
assert removing(["bundle_new", "bundle_1"]) == ["  Removed 1 older bundle item under /Workspace/Users/me/InspireAI"], said
assert removing(["bundle_new", "bundle_1", "bundle_2"]) == ["  Removed 2 older bundle items under /Workspace/Users/me/InspireAI"], said
assert removing(["bundle_new"]) == [], said
assert [ns["_plural"](n, "item") for n in (0, 1, 2)] == ["0 items", "1 item", "2 items"]
assert ns["_plural"](1, "batch", "batches") == "1 batch" and ns["_plural"](2, "batch", "batches") == "2 batches"
print("ok")
`;

test('a reinstall counts the older bundle items it removed with the noun that agrees with the count', (t) => {
  if (spawnSync('python3', ['--version']).status !== 0) {
    t.skip('python3 is not installed');
    return;
  }
  const run = spawnSync('python3', ['-c', REMOVED_PROBE, INSTALLER], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stdout.trim().split('\n').pop(), 'ok');
});

test('the installer gives the app service principal volumes, CREATE MODEL and MANAGE on the Inspire schema, CAN MANAGE on the warehouse and the Lakebase project, and names what new Apps need on the catalog', (t) => {
  if (spawnSync('python3', ['--version']).status !== 0) {
    t.skip('python3 is not installed');
    return;
  }
  const run = spawnSync('python3', ['-c', GRANTS_PROBE, INSTALLER, path.resolve(__dirname, '..', '..', 'dbx_inspire_ai_agent.ipynb')], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stdout.trim().split('\n').pop(), 'ok');
});

test('the installer grants the same Lakebase project and catalog the agent builds Apps in', () => {
  const fs = require('node:fs');
  const constant = (text, name) => (new RegExp(`^${name} = "([^"]+)"$`, 'm').exec(text) || [])[1];
  const notebook = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'dbx_inspire_ai_agent.ipynb'), 'utf8'));
  const agent = notebook.cells.map((cell) => [].concat(cell.source).join('')).join('\n');
  const installer = fs.readFileSync(INSTALLER, 'utf8');
  const read = /^LAKEBASE_CONSTANTS = \(([^)]*)\)$/m.exec(installer);
  assert.ok(read, 'the installer lists the agent constants it reads');
  const names = read[1].split(',').map((n) => n.trim().replace(/^"|"$/g, '')).filter(Boolean);
  for (const name of ['IMPLEMENT_LAKEBASE_PROJECT', 'IMPLEMENT_LAKEBASE_CATALOG', 'IMPLEMENT_LAKEBASE_BRANCH', 'IMPLEMENT_LAKEBASE_DATABASE']) {
    assert.ok(names.includes(name), `the installer reads ${name} from the bundled agent notebook`);
  }
  for (const name of ['IMPLEMENT_LAKEBASE_PROJECT', 'IMPLEMENT_LAKEBASE_CATALOG', 'IMPLEMENT_LAKEBASE_DATABASE']) {
    const value = constant(agent, name);
    assert.ok(value, `the agent defines ${name}`);
    assert.ok(!installer.includes(`"${value}"`), `the installer holds no second copy of ${name}`);
  }
  assert.match(installer, /ctx\["LAKEBASE"\] = agent_lakebase\(/);
});

const SCOPES_PROBE = String.raw`${INSTALLER_LOADER}
import ast, json, sys
path, notebook = sys.argv[1], sys.argv[2]
tree = ast.parse(open(path, encoding="utf-8").read())
wanted = {"app_user_scopes", "_merged_scopes", "_scope_refused", "_create_app", "_apply_user_scopes", "_update_app"}
consts = {"USER_SCOPE_CONSTANTS", "USER_SCOPES_REFUSED"}
body = [n for n in tree.body if (isinstance(n, ast.FunctionDef) and n.name in wanted)
        or (isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in consts for t in n.targets))]
ns = {}
load_installer(tree, body, ns, path)
class Resp:
    def __init__(self, status, text="{}", data=None):
        self.status_code, self.text, self._data = status, text, data or {}
    def json(self):
        return self._data
def api_of(script):
    calls = []
    def api(method, url, body=None):
        calls.append([method, url, body])
        return script(method, url, body, len(calls))
    return api, calls
scopes = ns["app_user_scopes"](open(notebook, encoding="utf-8").read())
out = {"scopes": scopes}
api, calls = api_of(lambda m, u, b, n: Resp(200, "{}", {"url": "https://inspire-ai.example.com"}))
resp, note = ns["_create_app"](api, "inspire-ai", "Inspire", scopes)
out["create"] = {"calls": calls, "note": note}
refused = lambda m, u, b, n: Resp(400, '{"message": "user_api_scopes sql are not allowed in this workspace"}') if b.get("user_api_scopes") else Resp(200)
api, calls = api_of(refused)
resp, note = ns["_create_app"](api, "inspire-ai", "Inspire", scopes)
out["refused"] = {"calls": calls, "note": note, "status": resp.status_code}
api, calls = api_of(lambda m, u, b, n: Resp(409, "app already exists"))
resp, note = ns["_create_app"](api, "inspire-ai", "Inspire", scopes)
out["exists"] = {"calls": len(calls), "note": note}
gets = []
def api_get_of(states):
    def api_get(url):
        gets.append(url)
        return {"status": {"state": states.pop(0)}}
    return api_get
api, calls = api_of(lambda m, u, b, n: Resp(200))
note = ns["_apply_user_scopes"](api, api_get_of(["IN_PROGRESS", "SUCCEEDED"]), "inspire-ai", scopes, {"user_api_scopes": ["files"]}, sleep=lambda s: None)
out["update"] = {"calls": calls, "note": note}
api, calls = api_of(lambda m, u, b, n: Resp(200))
note = ns["_apply_user_scopes"](api, api_get_of([]), "inspire-ai", scopes, {"user_api_scopes": scopes + ["files"]}, sleep=lambda s: None)
out["already"] = {"calls": calls, "note": note}
api, calls = api_of(lambda m, u, b, n: Resp(403, '{"message": "scopes are restricted by your workspace admin"}'))
note = ns["_apply_user_scopes"](api, api_get_of([]), "inspire-ai", scopes, {}, sleep=lambda s: None)
out["update_refused"] = note
api, calls = api_of(lambda m, u, b, n: Resp(200))
note = ns["_apply_user_scopes"](api, api_get_of(["FAILED"]), "inspire-ai", scopes, {"user_api_scopes": []}, sleep=lambda s: None)
out["update_failed"] = note
for broken in ('{"cells": [{"source": ""}, {"source": "IMPLEMENT_APP_READ_SCOPES = (\\"sql\\",)\\n"}]}', '{"cells": []}'):
    try:
        ns["app_user_scopes"](broken)
        out.setdefault("broken", []).append("no error")
    except ValueError as exc:
        out.setdefault("broken", []).append(str(exc))
print(json.dumps(out))
`;

const INSPIRE_SCOPES_PROBE = String.raw`${INSTALLER_LOADER}
import ast, json, os, sys, types
path, notebook = sys.argv[1], sys.argv[2]
tree = ast.parse(open(path, encoding="utf-8").read())
wanted = {"step_deploy_and_find_sp", "_workspace_api_path", "_list_apps", "_app_source_paths", "_remove_old_bundles",
          "_is_own_service_principal", "_create_app", "_apply_user_scopes", "_scope_refused", "_merged_scopes", "app_user_scopes", "_plural", "_app_url", "_noted_app_url",
          "_update_app", "_apply_description", "app_description"}
consts = {"INSPIRE_APP_OWN_SCOPES", "USER_SCOPES_REFUSED", "USER_SCOPE_CONSTANTS", "APP_DESCRIPTION_NOT_UPDATED"}
body = [n for n in tree.body if (isinstance(n, ast.FunctionDef) and n.name in wanted)
        or (isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in consts for t in n.targets))]
ns = {"os": os, "print": lambda *a, **k: None, "time": types.SimpleNamespace(sleep=lambda s: None), "write_app_yaml_deploy": lambda *a: None}
load_installer(tree, body, ns, path)
class Resp:
    def __init__(self, status, text="", data=None):
        self.status_code, self.text, self._data = status, text, data or {}
    def json(self):
        return self._data
app = {"compute_status": {"state": "ACTIVE"}, "url": "https://app", "service_principal_client_id": "SPNEW", "service_principal_name": "app-sp",
       "active_deployment": {"deployment_id": "d1", "status": {"state": "SUCCEEDED"}, "source_code_path": "/Workspace/b"}}
def deploy(create, held=None, notebook_scopes=None, described=""):
    calls = []
    def api(method, url, body=None):
        calls.append([method, url, body])
        if url == "/api/2.0/apps":
            return create(body)
        return Resp(200, "", {"deployment_id": "d1"})
    def api_get(url):
        if url == "/api/2.0/apps/inspire-ai":
            return dict(app, user_api_scopes=held or [], description=described)
        if url == "/api/2.0/apps/inspire-ai/update":
            return {"status": {"state": "SUCCEEDED"}}
        if url.startswith("/api/2.0/preview/scim/v2/ServicePrincipals?filter=applicationId"):
            return {"Resources": [{"id": "1"}]}
        return {"Resources": [], "apps": []}
    ctx = {"api": api, "api_get": api_get, "SOURCE_FOLDER": "/Workspace/b", "INSPIRE_DB": "main._inspire", "WAREHOUSE_ID": "wh",
           "NOTEBOOK_PATH": "/Shared/inspire-ai/dbx_inspire_ai_agent", "SP_NAME": "inspire-ai-sp", "APP_NAME": "inspire-ai", "CATALOG": "main",
           "APP_USER_SCOPES": notebook_scopes or [], "w": types.SimpleNamespace(), "RELEASE_VERSION": "v1.3.0"}
    ns["step_deploy_and_find_sp"](ctx)
    return {"apps": [c for c in calls if c[1] in ("/api/2.0/apps", "/api/2.0/apps/inspire-ai/update")], "note": ctx.get("USER_SCOPES_NOTE", "")}
built = ns["app_user_scopes"](open(notebook, encoding="utf-8").read())
out = {"inspire": list(ns["INSPIRE_APP_OWN_SCOPES"]), "built": built}
out["create"] = deploy(lambda body: Resp(200, "{}", {"url": "https://app"}), notebook_scopes=built)
refuse = lambda body: Resp(400, '{"message": "user_api_scopes files are not allowed in this workspace"}') if body.get("user_api_scopes") else Resp(200, "{}", {"url": "https://app"})
out["refused"] = deploy(refuse, notebook_scopes=built)
out["existing"] = deploy(lambda body: Resp(409, "App with name inspire-ai already exists"), held=["genie"], notebook_scopes=built, described="Inspire AI v1.2.9")
out["current"] = deploy(lambda body: Resp(409, "App with name inspire-ai already exists"), held=["genie"], notebook_scopes=built, described="Inspire AI v1.3.0")
out["unread"] = deploy(lambda body: Resp(200, "{}", {"url": "https://app"}))
print(json.dumps(out))
`;

const OWN_SCOPES_PROBE = String.raw`${INSTALLER_LOADER}
import ast, json, sys
path, notebook = sys.argv[1], sys.argv[2]
tree = ast.parse(open(path, encoding="utf-8").read())
consts = {"USER_SCOPE_CONSTANTS", "INSPIRE_APP_OWN_SCOPES"}
body = [n for n in tree.body if (isinstance(n, ast.FunctionDef) and n.name in {"app_user_scopes", "inspire_app_scopes"})
        or (isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in consts for t in n.targets))]
ns = {}
load_installer(tree, body, ns, path)
text = open(notebook, encoding="utf-8").read()
print(json.dumps({"union": ns["app_user_scopes"](text), "inspire": ns["inspire_app_scopes"](text), "own": list(ns["INSPIRE_APP_OWN_SCOPES"])}))
`;

test('the Inspire App asks for the notebook scopes plus apps, so a manager own token can read who manages it, and the installer grants the App nothing on itself', (t) => {
  if (spawnSync('python3', ['--version']).status !== 0) {
    t.skip('python3 is not installed');
    return;
  }
  const fs = require('node:fs');
  const NOTEBOOK = path.resolve(__dirname, '..', '..', 'dbx_inspire_ai_agent.ipynb');
  const run = spawnSync('python3', ['-c', OWN_SCOPES_PROBE, INSTALLER, NOTEBOOK], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(run.stdout.trim().split('\n').pop());
  const { appUserScopes } = require('../lib/routePolicy');
  assert.deepEqual(out.own, appUserScopes(), 'the installer asks for exactly the scopes the route table derives');
  assert.ok(out.own.includes('apps'));
  assert.deepEqual(out.inspire, [...new Set([...out.union, ...out.own])]);
  assert.equal(out.inspire.filter((s) => s === 'apps').length, 1);
  const installer = fs.readFileSync(INSTALLER, 'utf8');
  assert.match(installer, /ctx\["APP_USER_SCOPES"\] = inspire_app_scopes\(/);
  const touchesAppPermissions = /permissions\/apps\//;
  const readsAppPermissions = /api\(\s*"GET"\s*,\s*f?"[^"]*permissions\/apps\/[^"]*"\s*\)/g;
  const changesAppPermissions = (source) => touchesAppPermissions.test(source.replace(readsAppPermissions, ''));
  assert.equal(changesAppPermissions(installer), false, 'the installer never changes the permissions of an App');
  assert.match('api("PATCH", f"/api/2.0/permissions/apps/{app_name}", grant)', touchesAppPermissions, 'the check catches a self-grant');
  assert.equal(changesAppPermissions('api("PATCH", f"/api/2.0/permissions/apps/{app_name}", grant)'), true, 'a PATCH on the App permissions is caught');
  assert.equal(changesAppPermissions('api("PUT", f"/api/2.0/permissions/apps/{app_name}", acl)'), true, 'a PUT on the App permissions is caught');
  assert.equal(changesAppPermissions('api(\n    "PATCH",\n    f"/api/2.0/permissions/apps/{app_name}",\n    grant)'), true, 'a PATCH split over lines is caught');
  assert.equal(changesAppPermissions('path = f"/api/2.0/permissions/apps/{app_name}"\napi("PUT", path, acl)'), true, 'a write through a path variable is caught');
  assert.equal(changesAppPermissions('perm = api("GET", f"/api/2.0/permissions/apps/{app_name}")'), false, 'the manager preflight read is allowed');
});

test('the installer gives the Inspire App the union of the App scopes the bundled agent notebook defines, on create and over an existing App', (t) => {
  if (spawnSync('python3', ['--version']).status !== 0) {
    t.skip('python3 is not installed');
    return;
  }
  const fs = require('node:fs');
  const { pythonTuple } = require('../lib/appShell');
  const NOTEBOOK = path.resolve(__dirname, '..', '..', 'dbx_inspire_ai_agent.ipynb');
  const cell = JSON.parse(fs.readFileSync(NOTEBOOK, 'utf8')).cells[1].source;
  const source = Array.isArray(cell) ? cell.join('') : String(cell);
  const union = [...new Set([...pythonTuple(source, 'IMPLEMENT_APP_EDIT_SCOPES'), ...pythonTuple(source, 'IMPLEMENT_APP_READ_SCOPES')])];
  const run = spawnSync('python3', ['-c', SCOPES_PROBE, INSTALLER, NOTEBOOK], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(run.stdout.trim().split('\n').pop());
  assert.deepEqual(out.scopes, union, 'the union read from the notebook, not a copy');
  assert.ok(union.includes('sql') && union.includes('genie') && union.includes('sql:restricted-query'));
  assert.deepEqual(out.create.calls, [['POST', '/api/2.0/apps', { name: 'inspire-ai', description: 'Inspire', user_api_scopes: union }]]);
  assert.equal(out.create.note, '');
  assert.deepEqual(out.refused.calls.map(([m, u, b]) => [m, u, Object.hasOwn(b, 'user_api_scopes')]), [['POST', '/api/2.0/apps', true], ['POST', '/api/2.0/apps', false]],
    'a workspace that refuses user scopes still gets a working Inspire App');
  assert.equal(out.refused.status, 200);
  assert.match(out.refused.note, /^Inspire was installed without user authorization, so .* and the Run tab cannot show pages Inside Inspire, because .*: .*not allowed/);
  assert.deepEqual([out.exists.calls, out.exists.note], [1, ''], 'an existing App is not created twice');
  assert.deepEqual(out.update.calls, [['POST', '/api/2.0/apps/inspire-ai/update',
    { update_mask: 'user_api_scopes', app: { name: 'inspire-ai', user_api_scopes: ['files', ...union] } }]], 'a masked update that keeps the scopes an admin added');
  assert.equal(out.update.note, '');
  assert.deepEqual([out.already.calls, out.already.note], [[], ''], 'an App that has the scopes is left alone');
  assert.match(out.update_refused, /^Inspire was installed without user authorization.*403 .*restricted/);
  assert.match(out.update_failed, /without user authorization.*FAILED/);
  assert.deepEqual(out.broken, ['the bundled agent notebook defines no IMPLEMENT_APP_EDIT_SCOPES', 'the bundled agent notebook defines no IMPLEMENT_APP_EDIT_SCOPES, IMPLEMENT_APP_READ_SCOPES']);
});

test('the installer gives the Inspire App the user scopes its own routes read with the person\u2019s sign-in, with the bundled App scopes, on create and over an existing App, and says why when a workspace refuses them', (t) => {
  if (spawnSync('python3', ['--version']).status !== 0) {
    t.skip('python3 is not installed');
    return;
  }
  const NOTEBOOK = path.resolve(__dirname, '..', '..', 'dbx_inspire_ai_agent.ipynb');
  const run = spawnSync('python3', ['-c', INSPIRE_SCOPES_PROBE, INSTALLER, NOTEBOOK], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(run.stdout.trim().split('\n').pop());
  const inspire = require('../lib/routePolicy').appUserScopes();
  assert.deepEqual(out.inspire, inspire, 'the scopes the route table derives from the person routes and the manager check');
  const all = [...new Set([...out.built, ...inspire])];
  assert.ok(out.built.length > 0 && out.built.every((scope) => all.includes(scope)));
  assert.deepEqual(out.create.apps, [['POST', '/api/2.0/apps', { name: 'inspire-ai', description: 'Inspire AI v1.3.0', user_api_scopes: all }]]);
  assert.equal(out.create.note, '');
  assert.deepEqual(out.refused.apps.map(([m, u, b]) => [m, u, Object.hasOwn(b, 'user_api_scopes')]), [['POST', '/api/2.0/apps', true], ['POST', '/api/2.0/apps', false]]);
  assert.match(out.refused.note, /^Inspire was installed without user authorization, so it lists no catalogs, schemas or tables, starts no run and the Run tab cannot show pages Inside Inspire, because it reads them only with each person's own sign-in: .*not allowed/);
  assert.ok(out.refused.note.endsWith(`A workspace admin allows the scopes ${all.join(', ')} for Apps, then runs this installer again.`), out.refused.note);
  const scoped = ['POST', '/api/2.0/apps/inspire-ai/update',
    { update_mask: 'user_api_scopes', app: { name: 'inspire-ai', user_api_scopes: ['genie', ...all.filter((s) => s !== 'genie')] } }];
  assert.deepEqual(out.existing.apps.slice(1), [['POST', '/api/2.0/apps/inspire-ai/update',
    { update_mask: 'description', app: { name: 'inspire-ai', description: 'Inspire AI v1.3.0' } }], scoped],
    'an App from an older release takes this release in its description, and the scopes an admin added stay');
  assert.deepEqual(out.current.apps.slice(1), [scoped], 'an App that already names this release keeps its description untouched');
  assert.equal(out.existing.note, '');
  assert.deepEqual(out.unread.apps, [['POST', '/api/2.0/apps', { name: 'inspire-ai', description: 'Inspire AI v1.3.0', user_api_scopes: inspire }]],
    'a deploy step that runs without the notebook scopes still asks for the scopes the route table needs');
});
