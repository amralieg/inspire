import base64, difflib, hashlib, json, os, posixpath, re, requests, shutil, tarfile, tempfile, time, urllib.parse, zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import StatementState

APP_ZIP = "inspire-app.zip"
ASSETS_TAR = "inspire-assets.tar"
ASSETS_PARENT = "/Workspace/Shared/inspire-ai/assets"
APPS_PARENT = "/Workspace/Shared/inspire-ai/apps"
ASSETS_MANIFEST = "manifest.json"
ASSETS_FORMAT = 1
SCAN_ALL = "all"
SCAN_NONE_SAID = ("The Inspire App reads no catalog of yours yet, only `{catalog}`. To let it read your data, set SCAN_CATALOGS at the top of the "
                  'installer to the catalogs it may read, such as ["main", "sales"], and run the installer again.')
SCAN_SKIPPED = ("samples", "system", "__databricks_internal", "information_schema")
SCAN_GRANTS = ("USE_CATALOG", "USE_SCHEMA", "SELECT", "BROWSE")
SCAN_RIGHTS_WORKERS = 16
SCAN_GRANT_WORKERS = 8
SCAN_PROGRESS_FROM = 50
SCAN_PROGRESS_STEPS = 10
SCAN_SHOWN = 10
NEW_APPS_ACCOUNT_USERS = "account users"
NEW_APPS_OFF = "off"
SYSTEM_SCHEMA = "information_schema"
BELOW_CATALOG_VIEWS = (("schema", "schema_privileges", "schema_name", "schema_name"),
                       ("table", "table_privileges", "table_schema", "table_name"),
                       ("volume", "volume_privileges", "volume_schema", "volume_name"),
                       ("function", "routine_privileges", "routine_schema", "routine_name"))
REAL_GRANTS_SHOWN = 10


_WIDGET_PLACEHOLDER = "Pick from the list or type"
WIDGET_CHOICE_LIMIT = 1023
_LEGACY_PLACEHOLDER = "Please select"
_LEGACY_WAREHOUSE_CHOICE = re.compile(r"(?P<name>.*) \[[A-Z_?]+\] (?P<id>\S+)")


W_WH = "00_sql_warehouse"
W_WH_LABEL = "1) SQL warehouse for grants & app default"


W_CAT = "01_inspire_catalog"
W_CAT_LABEL = "2) Unity Catalog for Inspire tracking tables (_inspire)"


def _get_widget_value(name):
    try:
        return (dbutils.widgets.get(name) or "").strip()
    except Exception:
        return ""


def _unpicked(value):
    return not value or value in (_WIDGET_PLACEHOLDER, _LEGACY_PLACEHOLDER)


def _warehouse_choice(wh):
    return f"{wh.name or wh.id} ({wh.id})"


def resolve_warehouse(value, warehouses):
    text = (value or "").strip()
    if _unpicked(text):
        return None, f"Pick or type a SQL warehouse in {W_WH}."
    legacy = _LEGACY_WAREHOUSE_CHOICE.fullmatch(text)
    for found in ([wh for wh in warehouses if _warehouse_choice(wh) == text], [wh for wh in warehouses if wh.id == text],
                  [wh for wh in warehouses if legacy and wh.id == legacy.group("id")]):
        if found:
            return found[0], None
    named = [wh for wh in warehouses if (wh.name or "") == text]
    if len(named) == 1:
        return named[0], None
    if named:
        return None, f"{len(named)} SQL warehouses are named {text!r}. Pick one from the list in {W_WH} or type its id."
    return None, (f"No SQL warehouse you can use has the name or id {text!r}. "
                  f"Pick one from the list in {W_WH}, or type its exact name or id.")


def resolve_catalog(value, catalogs):
    text = (value or "").strip()
    if _unpicked(text):
        return None, f"Pick or type a catalog in {W_CAT}."
    if text in catalogs:
        return text, None
    folded = [name for name in catalogs if name.casefold() == text.casefold()]
    if len(folded) == 1:
        return folded[0], None
    by_folded = {name.casefold(): name for name in catalogs}
    close = difflib.get_close_matches(text.casefold(), list(by_folded), n=3, cutoff=0.75)
    hint = f" Did you mean {', '.join(repr(by_folded[c]) for c in close)}?" if close else ""
    return None, f"No catalog you can use is named {text!r}.{hint} Pick one from the list in {W_CAT}, or type its exact name."


def picker_choices(choices, picked=None, first=()):
    listed = list(dict.fromkeys(choices))
    if len(listed) < WIDGET_CHOICE_LIMIT:
        return [_WIDGET_PLACEHOLDER] + listed, 0
    known = set(listed)
    ordered = list(dict.fromkeys([c for c in [picked, *first] if c in known] + listed))
    return [_WIDGET_PLACEHOLDER] + ordered[:WIDGET_CHOICE_LIMIT - 1], len(listed) - (WIDGET_CHOICE_LIMIT - 1)


def _place_picker(name, label, choices, value, picked, first=(), things="values"):
    if picked is None and (value == _LEGACY_PLACEHOLDER or _LEGACY_WAREHOUSE_CHOICE.fullmatch(value or "")):
        try:
            dbutils.widgets.remove(name)
            return False
        except Exception:
            pass
    shown, hidden = picker_choices(choices, picked, first)
    if hidden:
        print(f"{name} lists {len(shown) - 1} of the {len(shown) - 1 + hidden} {things} you can use, the most likely first, "
              f"because a notebook list holds at most {WIDGET_CHOICE_LIMIT} entries. Type the exact name of any other one.")
    dbutils.widgets.combobox(name, picked or _WIDGET_PLACEHOLDER, shown, label)
    return True


def show_warning_banner(title, message):
    import html

    print(f"⚠️ {title}")
    print(message)

    safe_title = html.escape(title)
    safe_message = html.escape(message).replace("\n", "<br>")
    displayHTML(
        f"""
        <div style="padding:16px 20px;border-radius:12px;background:#fff4e5;border:1px solid #f5c26b;color:#7a4b00;margin:12px 0;">
          <div style="display:flex;align-items:flex-start;gap:12px;">
            <div style="font-size:28px;line-height:1;">⚠️</div>
            <div>
              <div style="font-size:18px;font-weight:700;margin-bottom:6px;">{safe_title}</div>
              <div style="font-size:14px;line-height:1.5;">{safe_message}</div>
            </div>
          </div>
        </div>
        """
    )


def ensure_parameter_widgets(warehouses, catalogs, own_catalogs=()):
    values = {W_WH: _get_widget_value(W_WH), W_CAT: _get_widget_value(W_CAT)}
    warehouse, warehouse_problem = resolve_warehouse(values[W_WH], warehouses)
    catalog, catalog_problem = resolve_catalog(values[W_CAT], catalogs)
    placed = [
        _place_picker(W_WH, W_WH_LABEL, [_warehouse_choice(wh) for wh in warehouses], values[W_WH],
                      _warehouse_choice(warehouse) if warehouse else None, things="SQL warehouses"),
        _place_picker(W_CAT, W_CAT_LABEL, catalogs, values[W_CAT], catalog, first=sorted(own_catalogs), things="catalogs"),
    ]
    print("Notebook parameters are ready above: pick a value from each list or type it.")
    return {"warehouse": warehouse, "catalog": catalog, "warehouse_problem": warehouse_problem, "catalog_problem": catalog_problem,
            "replaced": not all(placed)}


def _wh_sort_key(wh):
    st = wh.state.value if wh.state else ""
    srv = bool(getattr(wh, "enable_serverless_compute", False))
    return (0 if st == "RUNNING" and srv else 1 if st == "RUNNING" else 2, (wh.name or "").lower())


def _plural(count, one, many=None):
    return f"{count} {one if count == 1 else (many or one + 's')}"


def _yaml_quote(value):
    if value is None:
        return '""'
    s = str(value).replace("\\", "\\\\").replace('"', '\\"')
    return f'"{s}"'


def write_app_yaml_deploy(path, inspire_db, warehouse_id, notebook_path, sp_resource_name, assets_path=None, test_tag=None):
    """Emit app.yaml without PyYAML (no extra pip on the cluster)."""
    lines = [
        "command:",
        '  - "bash"',
        '  - "start.sh"',
        "",
        "env:",
        '  - name: "NODE_ENV"',
        '    value: "production"',
        '  - name: "INSPIRE_DATABASE"',
        f"    value: {_yaml_quote(inspire_db)}",
        '  - name: "INSPIRE_AUTO_SETUP"',
        '    value: "true"',
    ]
    if warehouse_id:
        lines += ["  - name: \"INSPIRE_WAREHOUSE_ID\"", f"    value: {_yaml_quote(warehouse_id)}"]
    if notebook_path:
        lines += ["  - name: \"NOTEBOOK_PATH\"", f"    value: {_yaml_quote(notebook_path)}"]
    if assets_path:
        lines += ["  - name: \"INSPIRE_ASSETS_PATH\"", f"    value: {_yaml_quote(assets_path)}"]
    if test_tag:
        lines += ["  - name: \"INSPIRE_TEST_TAG\"", f"    value: {_yaml_quote(test_tag)}"]
    lines += [
        "",
        "resources:",
        f"  - name: {_yaml_quote(sp_resource_name)}",
        '    type: "service-principal"',
    ]
    text = "\n".join(lines) + "\n"
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    return text


APP_DEPLOY_TRIES = 3


def _workspace_file_text(api, path):
    resp = api("GET", f"/api/2.0/workspace/export?path={requests.utils.quote(_workspace_api_path(path))}&format=AUTO")
    if resp.status_code != 200:
        return None, f"{resp.status_code} {resp.text[:200]}"
    return base64.b64decode((resp.json() or {}).get("content") or "").decode("utf-8", "replace"), None


INSPIRE_APP_MARKS = ("INSPIRE_", "Inspire AI")


def _other_app_problem(api, app_name, current):
    if str(current.get("description") or "").startswith(app_description("")):
        return None
    deployed = current.get("active_deployment") or {}
    source = (deployed.get("deployment_artifacts") or {}).get("source_code_path") or deployed.get("source_code_path")
    if not source:
        return None
    text, error = _workspace_file_text(api, f"{source}/app.yaml")
    if text is not None and any(mark in text for mark in INSPIRE_APP_MARKS):
        return None
    why = f"its app.yaml could not be read ({error})" if text is None else "its app.yaml names no Inspire setting"
    return (f"An App named {app_name} already exists and is not an Inspire App ({why}), so the installer leaves it alone. "
            f"Its owner can delete it; then run this installer again.")


def _put_app_yaml(api, path, text):
    resp = api("POST", "/api/2.0/workspace/import",
               {"path": _workspace_api_path(path), "format": "AUTO", "overwrite": True, "content": base64.b64encode(text.encode("utf-8")).decode("ascii")})
    if resp.status_code not in (200, 201):
        raise RuntimeError(f"Could not save {path} in the workspace ({resp.status_code} {resp.text[:200]}), so the App would start without "
                           f"its settings. Run the installer again.")


def _deployed_settings_problem(api, api_get, app_name, deploy_id, wanted):
    deployment = api_get(f"/api/2.0/apps/{app_name}/deployments/{deploy_id}")
    snapshot = (deployment.get("deployment_artifacts") or {}).get("source_code_path")
    if not snapshot:
        return None, "the deployment names no copy of its files"
    text, error = _workspace_file_text(api, f"{snapshot}/app.yaml")
    if text is None:
        return None, f"its app.yaml could not be read ({error})"
    if text.strip() != wanted.strip():
        return "the App started from an app.yaml without the warehouse and database this installer wrote", None
    return None, None


def _app_defaults_problem(ctx, app_url):
    probe = ctx.get("app_defaults")
    if not probe or not str(app_url or "").startswith("https://"):
        return None, "the App has no address yet"
    try:
        status, body = probe(app_url)
    except Exception as exc:
        return None, f"the App did not answer ({_error_words(exc)})"
    if status != 200 or not isinstance(body, dict):
        return None, f"the App answered {status}"
    if body.get("envSkipsSetupWizard") is not True:
        return "the App says it has no warehouse or database, so it would open on the workspace connection wizard", None
    return None, None


def export_workspace_b64(ctx, source_path, export_formats=("JUPYTER",)):
    """Export workspace notebook/file as base64 and fall back to local disk when needed."""
    api = ctx["api"]
    path = str(source_path or "").strip()
    if not path:
        return None

    export_paths = []
    stripped = path.replace("/Workspace", "", 1) if path.startswith("/Workspace") else path
    for export_path in (stripped, path):
        if export_path and export_path not in export_paths:
            export_paths.append(export_path)

    for export_path in export_paths:
        for fmt in export_formats:
            try:
                resp = api(
                    "GET",
                    f"/api/2.0/workspace/export?path={requests.utils.quote(export_path)}&format={fmt}",
                )
                if resp.status_code == 200:
                    content = (resp.json() or {}).get("content") or ""
                    if content:
                        print(f"  Exported {export_path} ({fmt}): {len(content)} bytes base64")
                        return content
            except Exception as exc:
                print(f"  export note {export_path} ({fmt}): {_error_words(exc)}")

    try:
        with open(path, "rb") as handle:
            raw = handle.read()
        b64 = base64.b64encode(raw).decode("utf-8")
        print(f"  Read from disk {path}: {len(b64)} bytes base64")
        return b64
    except OSError as exc:
        print(f"  ⚠️ Cannot read {path}: {_error_words(exc)}")
        return None


def _folder_has_app_yaml(folder):
    return bool(folder) and os.path.isdir(folder) and os.path.exists(os.path.join(folder, "app.yaml"))


def _normalize_bundle_root(extracted_dir):
    """Return the directory that directly contains app.yaml (handles app/ subfolder in zip)."""
    if _folder_has_app_yaml(extracted_dir):
        return extracted_dir
    nested = os.path.join(extracted_dir, "app")
    if _folder_has_app_yaml(nested):
        return nested
    return extracted_dir


def _unpack_bundle(source_zip, bundle_root, stage="/tmp/inspire_ws_zip_stage"):
    if os.path.exists(stage):
        shutil.rmtree(stage)
    os.makedirs(stage, exist_ok=True)
    with zipfile.ZipFile(source_zip, "r") as zf:
        zf.extractall(stage)
    entries = os.listdir(stage)
    root_dir = os.path.join(stage, entries[0]) if len(entries) == 1 and os.path.isdir(os.path.join(stage, entries[0])) else stage
    root_dir = _normalize_bundle_root(root_dir)
    if not _folder_has_app_yaml(root_dir):
        raise FileNotFoundError(f"No app.yaml after unzip under {root_dir}. Bundle must contain the Inspire app (app.yaml at root or under app/).")
    stamp = time.strftime("%Y%m%d_%H%M%S", time.gmtime())
    dest = os.path.join(bundle_root, f"bundle_{stamp}")
    suffix = 1
    while os.path.exists(dest):
        dest = os.path.join(bundle_root, f"bundle_{stamp}_{suffix}")
        suffix += 1
    shutil.copytree(root_dir, dest)
    return dest


def _workspace_api_path(path):
    path = str(path or "").rstrip("/")
    return path[len("/Workspace"):] if path.startswith("/Workspace/") else path


def _app_url(data):
    url = str((data or {}).get("url") or "") if isinstance(data, dict) else ""
    return url if url.startswith("https://") else ""


def _noted_app_url(known, data):
    url = _app_url(data)
    if url and url != known:
        print(f"App URL: {url}")
    return url or known


def _remove_old_bundles(w, bundle_root, keep, in_use):
    if in_use is None:
        return []
    keep_name = os.path.basename(keep.rstrip("/"))
    try:
        entries = list(w.workspace.list(_workspace_api_path(bundle_root)))
    except Exception as exc:
        print(f"  (older bundles not removed: {_error_words(exc)})")
        return []
    removed = []
    for entry in entries:
        path = _workspace_api_path(getattr(entry, "path", ""))
        if not path or os.path.basename(path) == keep_name:
            continue
        users = sorted({name for source, name in in_use.items() if source == path or source.startswith(path + "/")})
        if users:
            print(f"  Keeping {path}: app {', '.join(users)} still runs from it")
            continue
        try:
            w.workspace.delete(path, recursive=True)
            removed.append(path)
        except Exception as exc:
            print(f"  (could not remove {path}: {_error_words(exc)})")
    if removed:
        print(f"  Removed {_plural(len(removed), 'older bundle item')} under {bundle_root}")
    return removed


USER_SCOPE_CONSTANTS = ("IMPLEMENT_APP_EDIT_SCOPES", "IMPLEMENT_APP_READ_SCOPES")
LAKEBASE_CONSTANTS = ("IMPLEMENT_LAKEBASE_PROJECT", "IMPLEMENT_LAKEBASE_PROJECT_SPEC", "IMPLEMENT_LAKEBASE_BRANCH", "IMPLEMENT_LAKEBASE_ENDPOINT",
                      "IMPLEMENT_LAKEBASE_DATABASE", "IMPLEMENT_LAKEBASE_CATALOG")
GENIE_CODE_CONSTANTS = ("UNITY_GATEWAY_CODEX_PATH", "UNITY_GATEWAY_ANTHROPIC_PATH", "UNITY_GATEWAY_MLFLOW_PATH", "GENIE_CODE_MODEL",
                        "GENIE_CODE_MODEL_CHECK", "GENIE_CODE_ADMIN_FIX", "GENIE_CODE_UNFIT_MODEL_PATTERN")
GENIE_CODE_CHECK_TIMEOUT_S = 10
GENIE_CODE_CODEX_PROBES = 3
INSPIRE_APP_OWN_SCOPES = ("apps", "catalog.catalogs:read", "catalog.schemas:read", "catalog.tables:read", "files", "model-serving", "sql",
                          "workspace.workspace")
USER_SCOPES_REFUSED = ("Inspire was installed without user authorization, so it lists no catalogs, schemas or tables, starts no run "
                       "and the Run tab cannot show pages Inside Inspire, because it reads them only with each person's own sign-in: {why}. "
                       "A workspace admin allows the scopes {scopes} for Apps, then runs this installer again.")
APP_DESCRIPTION_NOT_UPDATED = ("The App still describes itself as {before!r} instead of {description!r}, because Databricks refused to change "
                               "its description: {why}. Run this installer again, or change it under Compute > Apps > {app} > Edit.")


def app_description(version):
    return f"Inspire AI {version}"


def agent_constants(notebook_text, names, statement_lines=20):
    import ast
    import json as _json
    cells = _json.loads(notebook_text).get("cells") or []
    source = cells[1].get("source") if len(cells) > 1 else ""
    lines = source if isinstance(source, list) else str(source or "").splitlines(keepends=True)
    starts = {}
    for index, line in enumerate(lines):
        head = line.split(" = ", 1)[0]
        if " = " in line and head.isidentifier() and head.isupper():
            starts.setdefault(head, index)
    missing = [name for name in names if name not in starts]
    if missing:
        raise ValueError(f"the bundled agent notebook defines no {', '.join(missing)}")
    found = {}

    def evaluate(node, name):
        if isinstance(node, ast.Name):
            return value(node.id)
        if isinstance(node, ast.JoinedStr):
            parts = []
            for part in node.values:
                if isinstance(part, ast.FormattedValue):
                    if part.conversion != -1 or part.format_spec is not None:
                        raise ValueError(f"{name} in the bundled agent notebook is not a constant")
                    parts.append(str(evaluate(part.value, name)))
                else:
                    parts.append(part.value)
            return "".join(parts)
        if isinstance(node, ast.Dict) and None not in node.keys:
            return {evaluate(k, name): evaluate(v, name) for k, v in zip(node.keys, node.values)}
        if isinstance(node, ast.Tuple):
            return tuple(evaluate(e, name) for e in node.elts)
        if isinstance(node, ast.List):
            return [evaluate(e, name) for e in node.elts]
        try:
            return ast.literal_eval(node)
        except (ValueError, TypeError, SyntaxError):
            raise ValueError(f"{name} in the bundled agent notebook is not a constant") from None

    def value(name):
        if name in found:
            return found[name]
        if name not in starts:
            raise ValueError(f"the bundled agent notebook defines no {name}")
        start = starts[name]
        for end in range(start + 1, min(len(lines), start + statement_lines) + 1):
            try:
                node = ast.parse("".join(lines[start:end])).body[0].value
                break
            except SyntaxError:
                continue
        else:
            raise ValueError(f"{name} in the bundled agent notebook is not a constant")
        found[name] = evaluate(node, name)
        return found[name]

    return {name: value(name) for name in names}


def app_user_scopes(notebook_text):
    found = agent_constants(notebook_text, USER_SCOPE_CONSTANTS)
    for name, value in found.items():
        if not isinstance(value, tuple) or not all(isinstance(v, str) and v for v in value):
            raise ValueError(f"{name} in the bundled agent notebook is not a tuple of scope names")
    return list(dict.fromkeys(scope for name in USER_SCOPE_CONSTANTS for scope in found[name]))


def agent_lakebase(notebook_text):
    found = agent_constants(notebook_text, LAKEBASE_CONSTANTS)
    for name, value in found.items():
        wanted = dict if name == "IMPLEMENT_LAKEBASE_PROJECT_SPEC" else str
        if not isinstance(value, wanted) or not value:
            raise ValueError(f"{name} in the bundled agent notebook is not a Lakebase {'project spec' if wanted is dict else 'name'}")
    return {key: found[f"IMPLEMENT_LAKEBASE_{key.upper()}"] for key in ("project", "project_spec", "branch", "endpoint", "database", "catalog")}


def _gateway_listed(resp):
    try:
        data = resp.json() if resp.status_code == 200 else {}
    except ValueError:
        data = {}
    rows = list(data.get("models") or []) + list(data.get("data") or [])
    return [str(r.get("slug") or r.get("id") or "").strip() for r in rows if isinstance(r, dict) and (r.get("slug") or r.get("id"))]


def genie_code_install_check(api, notebook_text, person):
    try:
        k = agent_constants(notebook_text, GENIE_CODE_CONSTANTS)
    except Exception as exc:
        return f"⚠️ not checked: the bundled agent notebook does not say how Genie Code reaches a model ({_error_words(exc)})"
    timeout = GENIE_CODE_CHECK_TIMEOUT_S
    try:
        first = k["GENIE_CODE_MODEL"]
        codex = [m for m in _gateway_listed(api("GET", f"{k['UNITY_GATEWAY_CODEX_PATH']}/models", timeout=timeout))
                 if not m.lower().endswith(first.lower()) and not re.search(k["GENIE_CODE_UNFIT_MODEL_PATTERN"], m, re.IGNORECASE)]
        claude = sorted((m for m in _gateway_listed(api("GET", f"{k['UNITY_GATEWAY_ANTHROPIC_PATH']}/models", timeout=timeout))
                         if re.search(r"claude-(?:sonnet|opus)", m, re.IGNORECASE)), reverse=True)
        tried = [("Codex route", k["UNITY_GATEWAY_CODEX_PATH"], m) for m in ([first] + codex)[:GENIE_CODE_CODEX_PROBES]] + [
            ("Anthropic route", k["UNITY_GATEWAY_MLFLOW_PATH"], m) for m in claude[:1]]
        refused = []
        for route, base, model in tried:
            resp = api("POST", f"{base}/responses", dict(k["GENIE_CODE_MODEL_CHECK"], model=model), timeout=timeout)
            if resp.status_code == 200:
                return f"✅ Inspire can build MVPs: Genie Code reaches {model} through the {route} (checked as {person})"
            if resp.status_code == 429 or resp.status_code >= 500:
                return f"⚠️ not checked: Unity Gateway was busy ({resp.status_code}); the first MVP build checks again before Genie starts"
            refused.append(f"{model} through the {route}: {resp.status_code} {str(resp.text or '')[:120]}")
    except Exception as exc:
        return f"⚠️ not checked: Unity Gateway did not answer ({_error_words(exc)}); the first MVP build checks again before Genie starts"
    return (f"⚠️ Genie Code reaches no model for {person} (tried {'; '.join(refused)}). I will build it myself still works: Inspire writes the "
            f"notebook and you run it. To let Inspire build MVPs, {k['GENIE_CODE_ADMIN_FIX']}")


def inspire_app_scopes(notebook_text):
    return list(dict.fromkeys(app_user_scopes(notebook_text) + list(INSPIRE_APP_OWN_SCOPES)))


def _merged_scopes(existing, wanted):
    return list(dict.fromkeys([*(existing or []), *(wanted or [])]))


def _scope_refused(status_code, text):
    words = str(text or "").lower()
    return status_code in (400, 403) and ("scope" in words or "user authorization" in words or "user_api_scopes" in words)


def _create_app(api, app_name, description, scopes):
    body = {"name": app_name, "description": description}
    resp = api("POST", "/api/2.0/apps", dict(body, user_api_scopes=scopes) if scopes else body)
    if scopes and _scope_refused(resp.status_code, resp.text):
        note = USER_SCOPES_REFUSED.format(why=resp.text[:300], scopes=", ".join(scopes))
        return api("POST", "/api/2.0/apps", body), note
    return resp, ""


def _update_app(api, api_get, app_name, fields, sleep=None, polls=24):
    sleep = sleep or time.sleep
    resp = api("POST", f"/api/2.0/apps/{app_name}/update", {"update_mask": ",".join(fields), "app": dict(fields, name=app_name)})
    if resp.status_code >= 400:
        return f"{resp.status_code} {resp.text[:300]}"
    for _ in range(polls):
        state = (api_get(f"/api/2.0/apps/{app_name}/update").get("status") or {})
        if state.get("state") == "SUCCEEDED":
            return ""
        if state.get("state") in ("FAILED", "NOT_UPDATED"):
            return state.get("message") or state.get("state")
        sleep(5)
    return "the update did not finish in 2 minutes"


def _apply_user_scopes(api, api_get, app_name, scopes, current, sleep=None, polls=24):
    if not scopes or set(scopes) <= set(current.get("user_api_scopes") or []):
        return ""
    why = _update_app(api, api_get, app_name, {"user_api_scopes": _merged_scopes(current.get("user_api_scopes"), scopes)}, sleep, polls)
    return USER_SCOPES_REFUSED.format(why=why, scopes=", ".join(scopes)) if why else ""


def _apply_description(api, api_get, app_name, description, current, sleep=None, polls=24):
    before = current.get("description") or ""
    if before == description:
        return ""
    why = _update_app(api, api_get, app_name, {"description": description}, sleep, polls)
    return APP_DESCRIPTION_NOT_UPDATED.format(before=before, description=description, why=why, app=app_name) if why else ""


def _is_own_service_principal(display_name, app_name, sp_name):
    name = (display_name or "").strip()
    return name in (app_name, sp_name, app_name.replace("-", "_")) or name.endswith(f" {app_name}")


def _list_apps(api_get):
    apps, token = [], ""
    while True:
        page = api_get("/api/2.0/apps" + (f"?page_token={token}" if token else ""))
        apps.extend(page.get("apps", []))
        token = page.get("next_page_token") or ""
        if not token:
            return apps


def _error_words(exc, limit=160):
    response = getattr(exc, "response", None)
    if isinstance(exc, requests.exceptions.HTTPError) and response is not None:
        try:
            body = response.json()
        except Exception:
            body = None
        detail = str(body.get("message") or body.get("error_code") or "") if isinstance(body, dict) else ""
        text = f"HTTP {response.status_code}" + (f": {detail}" if detail else "")
    else:
        text = str(exc)
    text = re.sub(r"https?://\S+|\b(?:adb|dbc)-[\w.-]+|\b[\w.-]+\.(?:azure)?databricks\.(?:net|com)\b", "the workspace", text)
    return text if limit is None else text[:limit]


def _rights_unread(exc, name, person):
    if getattr(getattr(exc, "response", None), "status_code", None) == 403:
        return (f"you cannot see who can grant on catalog `{name}` (HTTP 403). A catalog owner can run "
                f"GRANT MANAGE ON CATALOG `{name}` TO `{person}`")
    return f"your rights on catalog `{name}` could not be read ({_error_words(exc)})"


def _app_service_principal_ids(api_get):
    return {app["service_principal_client_id"] for app in _list_apps(api_get) if app.get("service_principal_client_id")}


def _app_source_paths(api_get):
    in_use = {}
    for app in _list_apps(api_get):
        sources = [app.get("default_source_code_path")]
        sources += [(app.get(key) or {}).get("source_code_path") for key in ("active_deployment", "pending_deployment")]
        for source in sources:
            source = _workspace_api_path(source)
            if source:
                in_use.setdefault(source, str(app.get("name") or ""))
    return in_use


def _deletable_service_principals(service_principals, app_name, sp_name, in_use):
    if in_use is None:
        return []
    return [sp for sp in service_principals
            if _is_own_service_principal(sp.get("displayName", ""), app_name, sp_name)
            and sp.get("applicationId") not in in_use]


def build_runtime_context(env):
    w = WorkspaceClient()
    current_user = w.current_user.me()
    user_email = current_user.user_name
    workspace_host = w.config.host

    settings = env.get("settings") or {}
    warehouse_override = settings.get("warehouse_id")
    catalog_override = settings.get("catalog")
    app_name_override = settings.get("app_name")

    all_warehouses = [wh for wh in w.warehouses.list() if getattr(wh, "id", None)]
    all_warehouses.sort(key=_wh_sort_key)

    if not all_warehouses:
        raise RuntimeError(f"You cannot use any SQL warehouse in this workspace, and the installer needs one. A workspace admin can give "
                           f"{user_email} Can Use on a SQL warehouse, or create one; then run this installer again.")

    available_catalogs, own_catalogs = [], set()
    try:
        for cat in w.catalogs.list():
            if cat.name not in ("system", "information_schema", "__databricks_internal"):
                available_catalogs.append(cat.name)
                if str(getattr(cat, "owner", "") or "").lower() == str(user_email or "").lower():
                    own_catalogs.add(cat.name)
    except Exception as exc:
        raise RuntimeError(f"The installer could not list the catalogs you can use ({_error_words(exc)}), after {len(available_catalogs)} of "
                           "them, so it changed nothing. Run this installer again; if it fails the same way, check that you can use "
                           "Unity Catalog in this workspace.") from None
    if not available_catalogs:
        raise RuntimeError(f"You cannot use any catalog in this workspace, and Inspire keeps its tables in one. A metastore admin can give "
                           f"{user_email} USE CATALOG and CREATE SCHEMA on a catalog; then run this installer again.")
    available_catalogs = sorted(set(available_catalogs))

    pickers = ensure_parameter_widgets(all_warehouses, available_catalogs, own_catalogs)
    picked_wh, picked_cat = pickers["warehouse"], pickers["catalog"]
    missing_messages = []

    if warehouse_override:
        picked_wh = next((wh for wh in all_warehouses if wh.id == warehouse_override), None)
        if picked_wh is None:
            raise ValueError(f"warehouse_id {warehouse_override!r} in the test setting is not a SQL warehouse you can use "
                             f"(showing first 5 ids): {[wh.id for wh in all_warehouses[:5]]}")
    elif picked_wh is None:
        missing_messages.append(pickers["warehouse_problem"])

    if catalog_override:
        picked_cat = resolve_catalog(catalog_override, available_catalogs)[0]
        if picked_cat is None:
            raise ValueError(f"catalog {catalog_override!r} in the test setting is not one of the {len(available_catalogs)} catalogs "
                             f"you can use (showing first 5): {available_catalogs[:5]}")
    elif picked_cat is None:
        missing_messages.append(pickers["catalog_problem"])

    if missing_messages:
        steps = ("The pickers at the top of the notebook are now lists you can also type into. Run this installer again to show them, "
                 "then pick or type both values." if pickers["replaced"] else
                 "Pick a value from each list at the top of the notebook, or type it, then run this installer again.")
        show_warning_banner("Choose notebook parameter values first", steps + "\n\n" + "\n".join(missing_messages))
        return {"ready": False}

    warehouse_id = picked_wh.id
    warehouse_name = picked_wh.name or warehouse_id
    catalog = picked_cat

    schema = "_inspire"
    inspire_db = f"{catalog}.{schema}"
    app_name = app_name_override or "inspire-ai"
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,28}[a-z0-9]", app_name):
        raise ValueError(f"App name {app_name!r} must be 2-30 lowercase letters, digits or hyphens")
    sp_name = f"{app_name}-sp"

    print(f"Selected warehouse: {warehouse_name} ({warehouse_id})")
    print(f"Selected catalog:   {catalog}  →  {inspire_db}")

    release_version = str(env["manifest"]["version"])
    source_zip = (env.get("files") or {}).get(APP_ZIP, "")
    if not source_zip:
        raise FileNotFoundError(f"The Inspire {release_version} release holds no {APP_ZIP}. Download the release again.")
    assets_tar = (env.get("files") or {}).get(ASSETS_TAR, "")
    if not assets_tar:
        raise FileNotFoundError(f"The Inspire {release_version} release holds no {ASSETS_TAR}. Download the release again.")

    api_base = workspace_host.rstrip("/")
    try:
        auth_header = w.config.authenticate()
        api_headers = auth_header if isinstance(auth_header, dict) else {"Authorization": f"Bearer {auth_header}"}
    except Exception:
        api_headers = {
            "Authorization": f"Bearer {dbutils.notebook.entry_point.getDbutils().notebook().getContext().apiToken().get()}"
        }

    def api(method, path, body=None, timeout=None):
        fn = {
            "GET": requests.get,
            "POST": requests.post,
            "PUT": requests.put,
            "PATCH": requests.patch,
            "DELETE": requests.delete,
        }[method]
        kwargs = {"headers": api_headers}
        if body is not None:
            kwargs["json"] = body
        if timeout is not None:
            kwargs["timeout"] = timeout
        return fn(f"{api_base}{path}", **kwargs)

    def api_get(path):
        response = api("GET", path)
        response.raise_for_status()
        return response.json()

    def app_defaults(app_url):
        response = requests.get(f"{app_url.rstrip('/')}/api/defaults", headers=api_headers, timeout=30, allow_redirects=False)
        try:
            return response.status_code, response.json()
        except ValueError:
            return response.status_code, None

    ctx = {
        "ready": True,
        "w": w,
        "USER_EMAIL": user_email,
        "WORKSPACE_HOST": workspace_host,
        "WAREHOUSE_ID": warehouse_id,
        "WAREHOUSE_NAME": warehouse_name,
        "CATALOG": catalog,
        "SCHEMA": schema,
        "INSPIRE_DB": inspire_db,
        "APP_NAME": app_name,
        "SP_NAME": sp_name,
        "USER_GROUPS": [str(getattr(g, "display", "") or "") for g in (getattr(current_user, "groups", None) or [])],
        "RELEASE_VERSION": release_version,
        "SOURCE_ZIP": source_zip,
        "BUNDLE_ROOT": f"{APPS_PARENT}/{app_name}",
        "SCAN_CATALOGS": env.get("scan_catalogs", SCAN_ALL),
        "NEW_APPS_CATALOG_ACCESS": _new_apps_setting(env.get("new_apps_catalog_access", NEW_APPS_ACCOUNT_USERS)),
        "ASSETS_TAR": assets_tar,
        "TEST_TAG": str(settings.get("test_tag") or "").strip(),
        "ASSETS_ROOT": f"{ASSETS_PARENT}/{release_version}",
        "available_catalogs": available_catalogs,
        "api": api,
        "api_get": api_get,
        "app_defaults": app_defaults,
    }
    return ctx


def step_bundle(ctx):
    print(f"Unpacking Inspire {ctx['RELEASE_VERSION']} into a new folder under {ctx['BUNDLE_ROOT']} ...")
    ctx["SOURCE_FOLDER"] = _unpack_bundle(ctx["SOURCE_ZIP"], ctx["BUNDLE_ROOT"])
    print(f"  Source from zip: {ctx['SOURCE_FOLDER']}")


def step_cleanup(ctx):
    api = ctx["api"]
    api_get = ctx["api_get"]
    app_name = ctx["APP_NAME"]
    sp_name = ctx["SP_NAME"]

    print("Cleaning up...")
    try:
        in_use = _app_service_principal_ids(api_get)
    except Exception as exc:
        print(f"  ⚠️ Could not list apps ({_error_words(exc)}); no service principal is deleted")
        in_use = None
    seen = set()
    for search in dict.fromkeys([app_name, sp_name, app_name.replace("-", "_")]):
        try:
            sps = api_get(f"/api/2.0/preview/scim/v2/ServicePrincipals?filter=displayName co \"{search}\"")
            resources = [sp for sp in sps.get("Resources", []) if sp.get("id") not in seen]
            seen.update(sp.get("id") for sp in resources)
            for sp in resources:
                if _is_own_service_principal(sp.get("displayName", ""), app_name, sp_name) and \
                        in_use is not None and sp.get("applicationId") in in_use:
                    print(f"  Keeping SP: {sp.get('displayName')} (AppID: {sp.get('applicationId')}): an app still uses it")
            for sp in _deletable_service_principals(resources, app_name, sp_name, in_use):
                sp_id = sp.get("id")
                print(f"  Deleting SP: {sp.get('displayName')} (ID: {sp_id}, AppID: {sp.get('applicationId')})")
                api("DELETE", f"/api/2.0/preview/scim/v2/ServicePrincipals/{sp_id}")
        except Exception:
            pass

    print("  Clean ✅")


def step_schema_and_notebooks(ctx):
    w = ctx["w"]
    warehouse_id = ctx["WAREHOUSE_ID"]
    catalog = ctx["CATALOG"]
    schema = ctx["SCHEMA"]
    source_folder = ctx["SOURCE_FOLDER"]
    app_name = ctx["APP_NAME"]
    api = ctx["api"]

    if warehouse_id:
        stmt = w.statement_execution.execute_statement(
            warehouse_id=warehouse_id,
            statement=f"CREATE SCHEMA IF NOT EXISTS `{catalog}`.`{schema}`",
            wait_timeout="30s",
        )
        print(f"Schema: {'✅' if stmt.status and stmt.status.state == StatementState.SUCCEEDED else '⚠️ ' + str(stmt.status)}")

    notebook_dest = f"/Shared/{app_name}/dbx_inspire_ai_agent"
    notebook_path = None

    notebook_source = None
    for candidate in [f"{source_folder}/dbx_inspire_ai_agent", f"{source_folder}/dbx_inspire_ai_agent.ipynb"]:
        if os.path.exists(candidate):
            notebook_source = candidate
            break

    if not notebook_source:
        print(f"⚠️ Notebook not found in: {os.listdir(source_folder)[:20]}")
        raise FileNotFoundError("dbx_inspire_ai_agent not found in source folder")

    print(f"Notebook source: {notebook_source}")

    b64 = export_workspace_b64(ctx, notebook_source, export_formats=("JUPYTER",))
    if not b64:
        raise FileNotFoundError(f"Could not export or read notebook: {notebook_source}")
    try:
        ctx["APP_USER_SCOPES"] = inspire_app_scopes(base64.b64decode(b64).decode("utf-8"))
        print(f"App user scopes: {', '.join(ctx['APP_USER_SCOPES'])}")
    except Exception as exc:
        ctx["APP_USER_SCOPES"] = list(INSPIRE_APP_OWN_SCOPES)
        ctx["USER_SCOPES_NOTE"] = (f"Inspire could not read the App user scopes from the bundled agent notebook ({_error_words(exc)}), so it asks only for "
                                   "its own scopes: the Run tab cannot show pages Inside Inspire, and an App it builds may refuse a settings "
                                   "change sent from Inspire")
        print(f"  ⚠️ {ctx['USER_SCOPES_NOTE']}")
    ctx["GENIE_CODE_SUMMARY"] = genie_code_install_check(api, base64.b64decode(b64).decode("utf-8"), ctx.get("USER_EMAIL") or "you")
    print(f"Genie Code: {ctx['GENIE_CODE_SUMMARY']}")
    try:
        ctx["LAKEBASE"] = agent_lakebase(base64.b64decode(b64).decode("utf-8"))
    except Exception as exc:
        ctx["LAKEBASE"] = None
        ctx["LAKEBASE_NOTE"] = (f"Inspire could not read the Lakebase project and catalog from the bundled agent notebook ({_error_words(exc, None)}), "
                                f"so it set up no Lakebase: {LAKEBASE_DELTA}")
        print(f"  ⚠️ {ctx['LAKEBASE_NOTE']}")

    try:
        api("POST", "/api/2.0/workspace/mkdirs", {"path": f"/Shared/{app_name}"})
    except Exception:
        pass
    try:
        api("POST", "/api/2.0/workspace/delete", {"path": notebook_dest})
    except Exception:
        pass

    resp = api(
        "POST",
        "/api/2.0/workspace/import",
        {"path": notebook_dest, "format": "JUPYTER", "content": b64, "language": "PYTHON", "overwrite": True},
    )
    if resp.status_code in (200, 201):
        notebook_path = notebook_dest
        print(f"Published to: ✅ {notebook_path}")
    else:
        print(f"Publish failed: ⚠️ {resp.status_code} {resp.text[:300]}")

    try:
        verify = api("GET", f"/api/2.0/workspace/get-status?path={requests.utils.quote(notebook_dest)}")
        if verify.status_code == 200:
            print(f"Verified: ✅ {verify.json().get('object_type')} at {notebook_dest}")
    except Exception:
        pass

    if not notebook_path:
        raise RuntimeError("❌ Notebook publish failed.")

    ctx["NOTEBOOK_DEST"] = notebook_dest
    ctx["NOTEBOOK_PATH"] = notebook_path
    print(f"NOTEBOOK_PATH = {notebook_path}")

    generate_demo_dest = f"/Shared/{app_name}/dbx_generate_demo_data"
    generate_source = None
    for candidate in [f"{source_folder}/dbx_generate_demo_data.py", f"{source_folder}/dbx_generate_demo_data"]:
        if os.path.exists(candidate):
            generate_source = candidate
            break

    if generate_source:
        print(f"Demo generator source: {generate_source}")
        gen_b64 = export_workspace_b64(ctx, generate_source, export_formats=("SOURCE", "JUPYTER"))
        if gen_b64:
            try:
                api("POST", "/api/2.0/workspace/mkdirs", {"path": f"/Shared/{app_name}"})
            except Exception:
                pass
            gen_resp = api(
                "POST",
                "/api/2.0/workspace/import",
                {"path": generate_demo_dest, "format": "SOURCE", "content": gen_b64, "language": "PYTHON", "overwrite": True},
            )
            if gen_resp.status_code in (200, 201):
                print(f"Published demo generator: ✅ {generate_demo_dest}")
            else:
                print(f"Demo generator publish: ⚠️ {gen_resp.status_code} {gen_resp.text[:200]}")
        else:
            print(f"⚠️ Could not read demo generator from {generate_source}")
    else:
        print("⚠️ dbx_generate_demo_data not found in source, so the demo pipeline notebook is not published")

    ctx["GENERATE_DEMO_DEST"] = generate_demo_dest


def _deploy_once(api, api_get, app_name, source_folder, app_url):
    resp = api("POST", f"/api/2.0/apps/{app_name}/deployments", {"source_code_path": source_folder})
    if resp.status_code not in (200, 201):
        raise RuntimeError(f"Deploy failed: {resp.text[:300]}")
    deploy_id = resp.json().get("deployment_id", "")
    said = ""
    for _ in range(30):
        data = api_get(f"/api/2.0/apps/{app_name}")
        pending, active = data.get("pending_deployment", {}), data.get("active_deployment", {})
        deployment = (
            pending if pending.get("deployment_id") == deploy_id
            else active if active.get("deployment_id") == deploy_id
            else pending or active
        )
        state = deployment.get("status", {}).get("state", "?")
        if state != said:
            print(f"  Deploy: {state}")
            said = state
        app_url = _noted_app_url(app_url, data)
        if state == "SUCCEEDED":
            return deploy_id, app_url
        if state in ("FAILED", "CANCELLED"):
            raise RuntimeError(f"Deploy {state}: {deployment.get('status', {}).get('message', '')}")
        time.sleep(10)
    raise RuntimeError(f"The App {app_name} was still deploying after 5 minutes. Check Compute → Apps → {app_name}, then run the installer again.")


def step_create_app_and_find_sp(ctx):
    api = ctx["api"]
    api_get = ctx["api_get"]
    source_folder = ctx["SOURCE_FOLDER"]
    inspire_db = ctx["INSPIRE_DB"]
    warehouse_id = ctx["WAREHOUSE_ID"]
    notebook_path = ctx["NOTEBOOK_PATH"]
    sp_name = ctx["SP_NAME"]
    app_name = ctx["APP_NAME"]
    catalog = ctx["CATALOG"]

    sp_before = set()
    try:
        data = api_get("/api/2.0/preview/scim/v2/ServicePrincipals?count=500")
        for sp in data.get("Resources", []):
            sp_before.add(sp.get("applicationId", ""))
    except Exception:
        pass
    print(f"SPs before deploy: {len(sp_before)}")

    app_yaml_path = f"{source_folder}/app.yaml"
    wanted_yaml = write_app_yaml_deploy(app_yaml_path, inspire_db, warehouse_id, notebook_path, sp_name, ctx.get("ASSETS_PATH"),
                                        ctx.get("TEST_TAG"))
    print("app.yaml: ✅")

    app_url = ""
    scopes = _merged_scopes(ctx.get("APP_USER_SCOPES"), INSPIRE_APP_OWN_SCOPES)
    description = app_description(ctx["RELEASE_VERSION"])
    resp, note = _create_app(api, app_name, description, scopes)
    if resp.status_code in (200, 201):
        print(f"App created: {app_name}")
        app_url = _noted_app_url(app_url, resp.json())
    elif "already exists" in resp.text.lower():
        print(f"App exists: {app_name}")
        current = api_get(f"/api/2.0/apps/{app_name}")
        app_url = _noted_app_url(app_url, current)
        described = _apply_description(api, api_get, app_name, description, current)
        print(f"  ⚠️ {described}" if described else f"App description: ✅ {description}")
        note = _apply_user_scopes(api, api_get, app_name, scopes, current)
    else:
        raise RuntimeError(f"Create failed: {resp.text[:300]}")
    if note:
        ctx["USER_SCOPES_NOTE"] = note
        print(f"  ⚠️ {note}")
    elif scopes:
        print(f"App user scopes: ✅ {', '.join(scopes)}")

    compute_ready = False
    start_requested = False
    said = ""
    for _ in range(30):
        info = api_get(f"/api/2.0/apps/{app_name}")
        app_url = _noted_app_url(app_url, info)
        state = info.get("compute_status", {}).get("state", "?")
        if state == "ACTIVE":
            print("Compute: ACTIVE ✅")
            compute_ready = True
            break
        if state == "STOPPED" and not start_requested:
            print("  Compute: STOPPED, starting it")
            api("POST", f"/api/2.0/apps/{app_name}/start")
            start_requested = True
            continue
        if state != said:
            print(f"  Compute: {state}")
            said = state
        time.sleep(10)

    if not compute_ready:
        raise RuntimeError(
            f"App compute did not reach ACTIVE after 5 minutes (still {state}{', after the installer asked it to start' if start_requested else ''}). "
            f"Start it manually: Compute → Apps → {app_name} → Start, then re-run."
        )

    print("\nFinding new service principal...")
    time.sleep(5)

    new_sp_app_id = None
    try:
        app_info = api_get(f"/api/2.0/apps/{app_name}")
        new_sp_app_id = app_info.get("service_principal_client_id") or None
        if new_sp_app_id:
            print(f"  App SP: {app_info.get('service_principal_name')} | applicationId={new_sp_app_id}")
    except Exception as exc:
        print(f"  ⚠️ Could not read the app's service principal: {_error_words(exc)}")
    if new_sp_app_id:
        found = api_get(f"/api/2.0/preview/scim/v2/ServicePrincipals?filter=applicationId eq \"{new_sp_app_id}\"")
        if not found.get("Resources"):
            raise RuntimeError(
                f"The service principal of app '{app_name}' ({new_sp_app_id}) no longer exists. "
                f"Delete the app in Compute → Apps → {app_name}, wait until it is gone, then run this installer again."
            )

    if not new_sp_app_id:
        try:
            data = api_get("/api/2.0/preview/scim/v2/ServicePrincipals?count=500")
            for sp in data.get("Resources", []):
                app_id = sp.get("applicationId", "")
                if app_id and app_id not in sp_before:
                    new_sp_app_id = app_id
                    print(f"  NEW SP: {sp.get('displayName')} | applicationId={app_id} | id={sp.get('id')}")
        except Exception as exc:
            print(f"  ⚠️ Could not list SPs: {_error_words(exc)}")

    if not new_sp_app_id:
        print("  ⚠️ Could not find new SP by diff. Trying name search...")
        try:
            sps = api_get(f"/api/2.0/preview/scim/v2/ServicePrincipals?filter=displayName co \"{app_name}\"")
            for sp in sps.get("Resources", []):
                app_id = sp.get("applicationId", "")
                if app_id and _is_own_service_principal(sp.get("displayName", ""), app_name, sp_name):
                    new_sp_app_id = app_id
                    print(f"  Found: {sp.get('displayName')} | applicationId={app_id}")
                    break
        except Exception:
            pass

    if not new_sp_app_id:
        print("\n⚠️  COULD NOT FIND SP. You need to grant manually:")
        print("    Run: fetch('/api/health').then(r=>r.json()).then(d=>console.log(d.envVars.SP_CLIENT_ID_resolved))")
        print(f"    Then: GRANT USE_CATALOG ON CATALOG `{catalog}` TO `<applicationId>`")
    else:
        print(f"\n✅ Runtime SP applicationId: {new_sp_app_id}")

    ctx["app_url"] = app_url
    ctx["NEW_SP_APP_ID"] = new_sp_app_id
    ctx["APP_YAML_PATH"] = app_yaml_path
    ctx["WANTED_YAML"] = wanted_yaml


def step_deploy_source(ctx):
    api = ctx["api"]
    api_get = ctx["api_get"]
    source_folder = ctx["SOURCE_FOLDER"]
    app_name = ctx["APP_NAME"]
    app_yaml_path = ctx["APP_YAML_PATH"]
    wanted_yaml = ctx["WANTED_YAML"]
    app_url = ctx.get("app_url", "")

    unread = unasked = None
    for attempt in range(1, APP_DEPLOY_TRIES + 1):
        _put_app_yaml(api, app_yaml_path, wanted_yaml)
        deploy_id, app_url = _deploy_once(api, api_get, app_name, source_folder, app_url)
        problem, unread = _deployed_settings_problem(api, api_get, app_name, deploy_id, wanted_yaml)
        if not problem:
            problem, unasked = _app_defaults_problem(ctx, app_url)
        if not problem:
            break
        if attempt == APP_DEPLOY_TRIES:
            raise RuntimeError(f"Deployed {APP_DEPLOY_TRIES} times, and each time {problem}. Run the installer again; if it fails the same "
                               f"way, check that you can manage the App {app_name}.")
        print(f"  ⚠️ Deploy {attempt} of {APP_DEPLOY_TRIES}: {problem}. Deploying again.")
        time.sleep(10)

    print("Deployed ✅")
    if not unasked:
        print("App settings: ✅ the App reports its warehouse and database, so it opens past the setup wizard")
    elif not unread:
        print("App settings: ✅ the deployed app.yaml holds the warehouse and database")
    else:
        print(f"  ⚠️ Could not confirm the App's settings: {unread}, and {unasked}. Open the App: if it asks for a workspace "
              f"connection, run the installer again.")
    if ctx.get("BUNDLE_ROOT"):
        try:
            in_use = _app_source_paths(api_get)
        except Exception as exc:
            print(f"  ⚠️ Could not list apps ({_error_words(exc)}); no older bundle is removed")
            in_use = None
        _remove_old_bundles(ctx["w"], ctx["BUNDLE_ROOT"], source_folder, in_use)
    ctx["app_url"] = app_url


def _new_apps_setting(value):
    word = value.strip().lower() if isinstance(value, str) else ""
    if word not in (NEW_APPS_ACCOUNT_USERS, NEW_APPS_OFF):
        raise ValueError(f'NEW_APPS_CATALOG_ACCESS must be "{NEW_APPS_ACCOUNT_USERS}" or "{NEW_APPS_OFF}", not {str(value)[:80]!r}.')
    return word


def _privilege_word(value):
    return str(value or "").strip().upper().replace("_", " ")


def _can_grant(person):
    return bool({_privilege_word(p) for p in person or []} & {"OWNER", "MANAGE"})


def _below_catalog_sql(catalog):
    return " UNION ALL ".join(
        f"SELECT '{level}' AS level, {schema} AS schema_name, {name} AS object_name, privilege_type AS privilege "
        f"FROM `{catalog}`.information_schema.{view} WHERE lower(grantee) = '{NEW_APPS_ACCOUNT_USERS}'"
        for level, view, schema, name in BELOW_CATALOG_VIEWS)


def _real_grants(catalog, account_users, below):
    real = [f"{_privilege_word(p)} on catalog {catalog}" for p in account_users or []
            if _privilege_word(p) not in ("BROWSE", "USE CATALOG")]
    for row in below or []:
        schema, privilege, level = str(row.get("schema_name") or ""), _privilege_word(row.get("privilege")), str(row.get("level") or "")
        if schema.lower() == SYSTEM_SCHEMA or privilege == "BROWSE":
            continue
        where = f"{catalog}.{schema}" if level == "schema" else f"{catalog}.{schema}.{row.get('object_name')}"
        real.append(f"{privilege} on {level} {where}")
    return list(dict.fromkeys(real))


def _new_apps_catalog_decision(setting, catalog, account_users, person, below, inspire_manages):
    if {_privilege_word(p) for p in account_users or []} & {"USE CATALOG", "ALL PRIVILEGES"}:
        return "held", []
    if inspire_manages:
        return "inspire", []
    if setting == NEW_APPS_OFF:
        return "off", []
    if not _can_grant(person):
        return "owner", []
    real = _real_grants(catalog, account_users, below)
    return ("below", real) if real else ("grant", [])


def _run_statement(w, warehouse_id, sql):
    stmt = _wait_statement(w, w.statement_execution.execute_statement(warehouse_id=warehouse_id, statement=sql, wait_timeout="15s"))
    if not (stmt.status and stmt.status.state == StatementState.SUCCEEDED):
        raise RuntimeError(stmt.status.error.message if stmt.status and stmt.status.error else str(stmt.status))
    return stmt


def _statement_rows(w, warehouse_id, sql):
    stmt = _run_statement(w, warehouse_id, sql)
    names = [str(c.name).lower() for c in stmt.manifest.schema.columns]
    return [dict(zip(names, row)) for row in ((stmt.result.data_array if stmt.result else None) or [])]


def _catalog_access_for_new_apps(ctx, sp):
    w, warehouse_id, catalog = ctx["w"], ctx["WAREHOUSE_ID"], ctx["CATALOG"]
    setting = ctx.get("NEW_APPS_CATALOG_ACCESS", NEW_APPS_ACCOUNT_USERS)
    need = f"⚠️ Apps that Implement creates cannot read result tables in `{catalog}` yet: their service principals need USE CATALOG"
    owners = (f"A catalog owner can run GRANT MANAGE ON CATALOG `{catalog}` TO `{sp}`, "
              f"or GRANT USE CATALOG ON CATALOG `{catalog}` TO `{NEW_APPS_ACCOUNT_USERS}`")
    try:
        owner = str(getattr(w.catalogs.get(catalog), "owner", "") or "")
        rows = _statement_rows(w, warehouse_id, f"SHOW GRANTS ON CATALOG `{catalog}`")
    except Exception as exc:
        return f"⚠️ Could not check who can use catalog `{catalog}`: {_error_words(exc, 120)}"
    grants = [(str(r.get("principal") or "").strip().lower(), _privilege_word(r.get("actiontype"))) for r in rows]
    account_users = [p for who, p in grants if who == NEW_APPS_ACCOUNT_USERS]
    inspire = owner.lower() == sp.lower() or (sp.lower(), "MANAGE") in grants
    try:
        person = _person_privileges(*_catalog_privileges(ctx, catalog))
    except Exception:
        person = []
    decision, real = _new_apps_catalog_decision(setting, catalog, account_users, person, [], inspire)
    if decision == "grant":
        try:
            below = _statement_rows(w, warehouse_id, _below_catalog_sql(catalog))
        except Exception as exc:
            return (f"{need}, and what account users hold below catalog `{catalog}` could not be read ({_error_words(exc, 120)}), "
                    f"so the installer granted nothing to account users. {owners}")
        decision, real = _new_apps_catalog_decision(setting, catalog, account_users, person, below, inspire)
    if decision == "held":
        return f"New Apps can use catalog `{catalog}`: account users hold USE CATALOG ✅"
    if decision == "inspire":
        return f"New Apps can use catalog `{catalog}`: Inspire can grant them USE CATALOG ✅"
    if decision == "off":
        return f"{need}, which account users do not hold, and NEW_APPS_CATALOG_ACCESS is off, so the installer grants it to nobody. {owners}"
    if decision == "below":
        shown = real[:REAL_GRANTS_SHOWN] + ([f"{len(real) - REAL_GRANTS_SHOWN} more"] if len(real) > REAL_GRANTS_SHOWN else [])
        return (f"{need}, which account users do not hold, and the installer did not grant it: account users already hold "
                f"{', '.join(shown)}, which USE CATALOG would open to every account user. {owners}")
    if decision == "grant":
        sql = f"GRANT USE CATALOG ON CATALOG `{catalog}` TO `{NEW_APPS_ACCOUNT_USERS}`"
        try:
            _run_statement(w, warehouse_id, sql)
        except Exception as exc:
            return f"{need}, and {sql} failed ({_error_words(exc, 120)}). {owners}"
        return (f"New Apps can use catalog `{catalog}`: the installer granted USE CATALOG on it to account users ✅. "
                f"This opens no data by itself: account users hold no schema, table, volume or function in `{catalog}`")
    return (
        f"{need}, which account users do not hold, and Inspire can grant it only with MANAGE on the catalog. {owners}"
    )


LAKEBASE_DELTA = "until then the Apps that Implement builds read Delta tables"
LAKEBASE_POLLS = 90
LAKEBASE_POLL_S = 10


LAKEBASE_QUOTA_STEP = ("the metastore already holds as many catalogs as Databricks allows, so it creates no more: a metastore admin "
                       "can drop the catalogs no one uses, or ask Databricks support to raise the limit, then you run this installer again")


def _lakebase_said(resp):
    body = None
    for read in (resp.json, lambda: json.loads(resp.text or "")):
        try:
            body = read()
        except Exception:
            body = None
        if isinstance(body, dict) and (body.get("message") or body.get("error_code")):
            break
    if isinstance(body, dict) and (body.get("message") or body.get("error_code")):
        code, message = str(body.get("error_code") or ""), " ".join(str(body.get("message") or "").split())
        return f"{resp.status_code} {code}: {message[:400]}" if code and message else f"{resp.status_code} {code or message[:400]}"
    return f"{resp.status_code} {' '.join(str(resp.text or '').split())[:400]}"


def _lakebase_quota(resp):
    return resp.status_code in (400, 429) and "QUOTA_EXCEEDED" in str(resp.text or "")


def _lakebase_wait(api, path, ready, sleep, polls=LAKEBASE_POLLS):
    for poll in range(polls):
        got = api("GET", path)
        if got.status_code == 200 and ready(got.json() or {}):
            return True, got
        if got.status_code not in (200, 404):
            return False, got
        if poll + 1 < polls:
            sleep(LAKEBASE_POLL_S)
    return False, got


def _lakebase_endpoint_host(endpoint):
    return str(((endpoint.get("status") or {}).get("hosts") or {}).get("host") or "")


def _lakebase_setup(ctx, sleep=None):
    sleep = sleep or time.sleep
    lakebase, api, me = ctx.get("LAKEBASE"), ctx["api"], ctx["USER_EMAIL"]
    if not lakebase:
        return False, ctx.get("LAKEBASE_NOTE") or f"Inspire knows no Lakebase project or catalog to set up: {LAKEBASE_DELTA}"
    project, catalog = lakebase["project"], lakebase["catalog"]
    minutes = LAKEBASE_POLLS * LAKEBASE_POLL_S // 60
    made_project = made_catalog = False
    got = api("GET", f"/api/2.0/postgres/projects/{project}")
    if got.status_code == 404:
        made = api("POST", f"/api/2.0/postgres/projects?project_id={urllib.parse.quote(project)}", {"spec": lakebase["project_spec"]})
        if made.status_code not in (200, 201):
            return False, (f"Databricks refused to create the Lakebase project {project} for you ({_lakebase_said(made)}). A workspace admin "
                           f"can run this installer again, which creates it; {LAKEBASE_DELTA}")
        made_project = True
    elif got.status_code != 200:
        return False, (f"Databricks refused to read the Lakebase project {project} for you ({_lakebase_said(got)}). Its owner can give you "
                       f"Can Manage on it, then run this installer again; {LAKEBASE_DELTA}")
    elif (got.json() or {}).get("delete_time"):
        return False, (f"The Lakebase project {project} was deleted and keeps its name until it is purged. Restore it in Lakebase, then run "
                       f"this installer again; {LAKEBASE_DELTA}")
    held = api("GET", f"/api/2.0/postgres/catalogs/{catalog}")
    if held.status_code == 404:
        ready, endpoint = _lakebase_wait(api, f"/api/2.0/postgres/{lakebase['endpoint']}", _lakebase_endpoint_host, sleep)
        if not ready:
            return False, (f"The database endpoint of the Lakebase project {project} was not ready after {minutes} minutes "
                           f"({_lakebase_said(endpoint)}). Run this installer again; {LAKEBASE_DELTA}")
        made = api("POST", f"/api/2.0/postgres/catalogs?catalog_id={urllib.parse.quote(catalog)}",
                   {"spec": {"branch": lakebase["branch"], "postgres_database": lakebase["database"]}})
        if made.status_code == 403 or "PERMISSION_DENIED" in made.text:
            return False, (f"Databricks refused to create the catalog `{catalog}` on the Lakebase project {project} for you "
                           f"({_lakebase_said(made)}): creating a catalog needs CREATE CATALOG on the metastore. A metastore admin can run "
                           f"GRANT CREATE CATALOG ON METASTORE TO `{me}`, then you run this installer again; {LAKEBASE_DELTA}")
        if _lakebase_quota(made):
            return False, (f"Databricks did not create the catalog `{catalog}` ({_lakebase_said(made)}): {LAKEBASE_QUOTA_STEP}; "
                           f"{LAKEBASE_DELTA}")
        if made.status_code not in (200, 201):
            return False, f"Databricks did not create the catalog `{catalog}` ({_lakebase_said(made)}). Run this installer again; {LAKEBASE_DELTA}"
        ready, held = _lakebase_wait(api, f"/api/2.0/postgres/catalogs/{catalog}", lambda found: True, sleep)
        if not ready:
            return False, (f"The catalog `{catalog}` was not ready after {minutes} minutes ({_lakebase_said(held)}). Run this installer "
                           f"again; {LAKEBASE_DELTA}")
        made_catalog = True
    elif held.status_code != 200:
        return False, (f"Databricks refused to read the catalog `{catalog}` for you ({_lakebase_said(held)}). Its owner can run "
                       f"GRANT USE CATALOG ON CATALOG `{catalog}` TO `{me}`, then you run this installer again; {LAKEBASE_DELTA}")
    found = held.json() or {}
    bound = dict(found.get("spec") or {}, **{k: v for k, v in (found.get("status") or {}).items() if v})
    if bound.get("branch") != lakebase["branch"] or bound.get("postgres_database") != lakebase["database"]:
        return False, (f"The catalog `{catalog}` holds another Lakebase database ({bound.get('branch')}, {bound.get('postgres_database')}), "
                       f"not {lakebase['database']} of the project {project}. Its owner can drop it, then run this installer again; "
                       f"{LAKEBASE_DELTA}")
    did = [what for what, done in ((f"created the Lakebase project {project}", made_project),
                                   (f"created the catalog `{catalog}` on it", made_catalog)) if done]
    return True, (f"Lakebase for the Apps Implement builds: {' and '.join(did) if did else f'project {project} and catalog `{catalog}` are there'} ✅")


def _lakebase_project_access(api, sp, project):
    resp = api(
        "PATCH",
        f"/api/2.0/permissions/database-projects/{project}",
        {"access_control_list": [{"service_principal_name": sp, "permission_level": "CAN_MANAGE"}]},
    )
    if resp.status_code == 200:
        return True, f"CAN_MANAGE on Lakebase project {project}, so the Apps Implement builds can read Lakebase: ✅"
    return False, (
        f"{sp} cannot use the Lakebase project {project}, because Databricks refused to give it Can Manage on that project "
        f"({resp.text[:160]}). A workspace admin can give {sp} Can Manage on that project, or run this installer again; {LAKEBASE_DELTA}"
    )


def _app_folder_access(api, app_name, sp):
    folder = f"/Shared/{app_name}"
    found = api("GET", f"/api/2.0/workspace/get-status?path={folder}")
    object_id = found.json().get("object_id") if found.status_code == 200 else None
    if not object_id:
        return (f"⚠️ Could not find {folder} ({found.text[:160]}), so {sp} may not be able to save MVPs there. "
                f"A workspace admin can give {sp} Can Manage on that folder")
    resp = api(
        "PATCH",
        f"/api/2.0/permissions/directories/{object_id}",
        {"access_control_list": [{"service_principal_name": sp, "permission_level": "CAN_MANAGE"}]},
    )
    if resp.status_code == 200:
        return f"CAN_MANAGE on {folder}, so Implement can save every MVP there: ✅"
    return (f"⚠️ {sp} cannot save MVPs in {folder} yet ({resp.text[:160]}). "
            f"A workspace admin can give {sp} Can Manage on that folder")


SHARED_OUTPUT_GENERATION_PATH = "./../demos/"  # the App's default Generation Path, resolved from the notebook folder


def _shared_output_folder(notebook_path):
    return posixpath.normpath(posixpath.join(posixpath.dirname(notebook_path), SHARED_OUTPUT_GENERATION_PATH))


def _shared_output_access(api, notebook_path, sp):
    folder = _shared_output_folder(notebook_path)
    made = api("POST", "/api/2.0/workspace/mkdirs", {"path": folder})
    if made.status_code != 200:
        return False, (f"{folder} could not be created ({made.text[:160]}), so a run has no folder the App can always write. "
                       f"A workspace admin can create it and give {sp} Can Manage on it")
    found = api("GET", f"/api/2.0/workspace/get-status?path={folder}")
    object_id = found.json().get("object_id") if found.status_code == 200 else None
    if not object_id:
        return False, (f"Could not find {folder} ({found.text[:160]}), so a run has no folder the App can always write. "
                       f"A workspace admin can give {sp} Can Manage on it")
    resp = api(
        "PATCH",
        f"/api/2.0/permissions/directories/{object_id}",
        {"access_control_list": [{"service_principal_name": sp, "permission_level": "CAN_MANAGE"}]},
    )
    if resp.status_code == 200:
        return True, f"CAN_MANAGE on {folder} for {sp}, the folder a run falls back to when a person's own folder cannot take the App: ✅"
    return False, (f"{sp} cannot write {folder} ({resp.text[:160]}), so a run has no folder the App can always write. "
                   f"A workspace admin can give {sp} Can Manage on it")


def _scan_label(scan, catalog):
    if scan == SCAN_ALL:
        return "all: every catalog you can see and grant on"
    return ", ".join(scan) if scan else f"none yet: the App reads only `{catalog}`"


def _scan_split(ctx, catalog, scan, visible):
    if scan != SCAN_ALL:
        return list(scan), []
    names = sorted(n for n in set(visible) - set(SCAN_SKIPPED) - {catalog} if not n.startswith("__"))
    _metastore_admin(ctx)

    def verdict(cat):
        try:
            full, held = _catalog_privileges(ctx, cat)
            return cat, "" if _can_grant(_person_privileges(full, held)) else _grant_refusal(cat, ctx["USER_EMAIL"], held)
        except Exception as exc:
            return cat, _rights_unread(exc, cat, ctx["USER_EMAIL"])

    if len(names) >= SCAN_PROGRESS_FROM:
        print(f"  Checking your rights on {_plural(len(names), 'catalog')}...")
    with ThreadPoolExecutor(max_workers=SCAN_RIGHTS_WORKERS) as pool:
        checked = list(pool.map(verdict, names))
    return [cat for cat, why in checked if not why], [(cat, why) for cat, why in checked if why]


def _shown(names, limit=SCAN_SHOWN):
    names = list(names)
    head = ", ".join(f"`{n}`" for n in names[:limit])
    return head + (f" and {len(names) - limit} more" if len(names) > limit else "")


def _grant_error(w, warehouse_id, sql):
    try:
        _run_statement(w, warehouse_id, sql)
        return ""
    except Exception as exc:
        return _error_words(exc, None)


def _scan_grant(sp, cat):
    return f"GRANT {', '.join(SCAN_GRANTS)} ON CATALOG `{cat}` TO `{sp}`"


def _run_scan_grants(w, warehouse_id, grants):
    failed, done = {}, 0
    step = max(1, -(-len(grants) // SCAN_PROGRESS_STEPS))
    with ThreadPoolExecutor(max_workers=SCAN_GRANT_WORKERS) as pool:
        running = {pool.submit(_grant_error, w, warehouse_id, sql): sql for sql in grants}
        for future in as_completed(running):
            done += 1
            error = future.result()
            if error:
                failed[running[future]] = error
            if len(grants) >= SCAN_PROGRESS_FROM and (done % step == 0 or done == len(grants)):
                print(f"  Catalog grants: {done:,} of {len(grants):,}")
    return {sql: failed[sql] for sql in grants if sql in failed}


def _grant_scan_catalogs(ctx, sp, visible):
    w, warehouse_id, catalog = ctx["w"], ctx["WAREHOUSE_ID"], ctx["CATALOG"]
    scan = ctx.get("SCAN_CATALOGS", SCAN_ALL)
    scanned, skipped = _scan_split(ctx, catalog, scan, visible)
    targets = [cat for cat in scanned if cat != catalog]
    grants = [_scan_grant(sp, cat) for cat in targets]
    print(f"Catalog grants for {sp}: {_plural(len(grants), 'catalog')} (SCAN_CATALOGS = {_scan_label(scan, catalog)}), "
          f"each GRANT {', '.join(SCAN_GRANTS)}")
    if targets:
        print(f"  Catalogs: {_shown(targets)}")
    for name, reason in skipped[:SCAN_SHOWN]:
        print(f"  Skipped catalog `{name}`, so the Inspire App will not read it: {reason}. Run this installer again once you can grant on it.")
    if len(skipped) > SCAN_SHOWN:
        rest = [name for name, _ in skipped[SCAN_SHOWN:]]
        print(f"  Skipped {_plural(len(rest), 'more catalog')} you cannot grant on, so the Inspire App will not read them: {_shown(rest)}. "
              "Run this installer again once you can grant on them.")
    if not scan:
        print(f"  {SCAN_NONE_SAID.format(catalog=catalog)}")
    if scan == SCAN_ALL and not targets:
        print(f"  Note: you can grant on no catalog besides `{catalog}`, so the Inspire App reads only `{catalog}` for now. "
              "Run this installer again once you can grant on the catalogs to scan.")
    failed = _run_scan_grants(w, warehouse_id, grants)
    for sql, error in list(failed.items())[:SCAN_SHOWN]:
        print(f"  ⚠️ {sql}: {error}")
    if len(failed) > SCAN_SHOWN:
        print(f"  ⚠️ {_plural(len(failed) - SCAN_SHOWN, 'more catalog grant')} failed the same way or another")
    if grants:
        print(f"  Catalog grants: {len(grants) - len(failed):,} of {len(grants):,} ran {'✅' if not failed else '⚠️'}")
    return failed


VALUE_LEDGER_TABLE = "__inspire_value_ledger"
VALUE_LEDGER_COLUMNS = (("session_id", "STRING"), ("result_table", "STRING"), ("use_case_id", "STRING"), ("run_id", "STRING"),
                        ("record_key", "STRING"), ("kind", "STRING"), ("currency", "STRING"), ("unit", "STRING"), ("at_stake", "DOUBLE"),
                        ("saved", "DOUBLE"), ("recorded_at", "TIMESTAMP"), ("recorded_by", "STRING"))


def _value_ledger(catalog, schema):
    return f"`{catalog}`.`{schema}`.`{VALUE_LEDGER_TABLE}`"


def _value_ledger_grants(sp, catalog, schema):
    table = _value_ledger(catalog, schema)
    return [f"GRANT {privilege} ON TABLE {table} TO `{sp}`" for privilege in ("SELECT", "MODIFY")]


def _ensure_value_ledger(w, warehouse_id, catalog, schema):
    table = _value_ledger(catalog, schema)
    columns = ", ".join(f"`{name}` {kind}" for name, kind in VALUE_LEDGER_COLUMNS)
    sql = f"CREATE TABLE IF NOT EXISTS {table} ({columns})"
    error = _grant_error(w, warehouse_id, sql)
    if error:
        raise RuntimeError(f"The installer could not create the value ledger {table}: {error[:160]}. "
                           "Run this installer again once the schema is writable for you.")


def _lakebase_grant(sp, lakebase_catalog):
    return f"GRANT ALL PRIVILEGES ON CATALOG `{lakebase_catalog}` TO `{sp}`"


def _grant_plan(sp, catalog, schema, visible, lakebase_catalog=""):
    plan = [f"GRANT {p} ON CATALOG `{catalog}` TO `{sp}`" for p in ("USE_CATALOG", "BROWSE", "CREATE SCHEMA")]
    plan += [f"GRANT {p} ON SCHEMA `{catalog}`.`{schema}` TO `{sp}`"
             for p in ("USE_SCHEMA", "CREATE_TABLE", "SELECT", "MODIFY", "CREATE MODEL", "CREATE VOLUME", "READ VOLUME", "WRITE VOLUME", "MANAGE")]
    if lakebase_catalog and lakebase_catalog in visible and lakebase_catalog != catalog:
        plan.append(_lakebase_grant(sp, lakebase_catalog))
    return plan + _value_ledger_grants(sp, catalog, schema)


READ_PRIVILEGES = ("USE_CATALOG", "BROWSE", "USE_SCHEMA", "SELECT", "READ_VOLUME")


def _blocking_read_grants(failed, scan_failed):
    """The failed grants a new App needs to read its data (REQ-039): every GRANT that carries a read privilege, plus every failed catalog scan grant."""
    blocking = {}
    for sql, error in failed.items():
        privileges = sql[len("GRANT "):sql.index(" ON ")].replace(" ", "_").split(", ")
        if any(privilege in READ_PRIVILEGES for privilege in privileges):
            blocking[sql] = error
    blocking.update(scan_failed)
    return blocking


def step_grant_permissions(ctx):
    new_sp_app_id = ctx.get("NEW_SP_APP_ID")
    warehouse_id = ctx["WAREHOUSE_ID"]
    w = ctx["w"]
    catalog = ctx["CATALOG"]
    schema = ctx["SCHEMA"]
    api = ctx["api"]

    if new_sp_app_id and warehouse_id:
        sp = new_sp_app_id
        resp = api(
            "PATCH",
            f"/api/2.0/permissions/sql/warehouses/{warehouse_id}",
            {"access_control_list": [{"service_principal_name": sp, "permission_level": "CAN_MANAGE"}]},
        )
        print(
            "  CAN_MANAGE on warehouse, so Implement can attach it to the Apps it creates: "
            f"{'✅' if resp.status_code == 200 else '⚠️ ' + resp.text[:100]}"
        )
        visible, owners = set(ctx["available_catalogs"]), {}
        try:
            for cat in w.catalogs.list():
                visible.add(cat.name)
                if getattr(cat, "owner", None):
                    owners[cat.name] = cat.owner
        except Exception:
            pass
        ctx["CATALOG_OWNERS"] = owners
        lakebase = ctx.get("LAKEBASE") or {}
        lakebase_ready, lakebase_said = _lakebase_setup(ctx)
        print(f"  {'' if lakebase_ready else '⚠️ '}{lakebase_said}")
        if lakebase_ready:
            visible.add(lakebase["catalog"])
        else:
            ctx["LAKEBASE_NOTE"] = lakebase_said
        _ensure_value_ledger(w, warehouse_id, catalog, schema)
        grants = _grant_plan(sp, catalog, schema, visible, lakebase.get("catalog", ""))
        lakebase_sql = _lakebase_grant(sp, lakebase["catalog"]) if lakebase else ""
        print(f"Grant plan for {sp}: {_plural(len(grants), 'statement')} on `{catalog}`.`{schema}`"
              f"{' and the Lakebase catalog' if lakebase_sql in grants else ''}")
        for sql in grants:
            print(f"  {sql}")

        failed = {}
        for sql in grants:
            error = _grant_error(w, warehouse_id, sql)
            if error:
                failed[sql] = error
                print(f"  ⚠️ {sql}: {error}")
        print(f"  Grants: {len(grants) - len(failed)} of {len(grants)} ran {'✅' if not failed else '⚠️'}")
        ledger_failed = [failed[sql] for sql in _value_ledger_grants(sp, catalog, schema) if sql in failed]
        if ledger_failed:
            raise RuntimeError(f"The installer could not let {sp} read and change the value ledger {_value_ledger(catalog, schema)}: "
                               f"{ledger_failed[0][:160]}. A catalog owner can run the GRANT, then run this installer again.")
        if lakebase_ready and lakebase_sql in failed:
            ctx["LAKEBASE_NOTE"] = (f"{sp} cannot use the catalog `{lakebase['catalog']}`, because {lakebase_sql} failed "
                                    f"({str(failed[lakebase_sql])[:160]}). Its owner can run that grant, or run this installer again; {LAKEBASE_DELTA}")
            print(f"  ⚠️ {ctx['LAKEBASE_NOTE']}")

        print(f"  {_catalog_access_for_new_apps(ctx, sp)}")
        if lakebase:
            granted, granted_said = _lakebase_project_access(api, sp, lakebase["project"])
            print(f"  {'' if granted else '⚠️ '}{granted_said}")
            if not granted and not ctx.get("LAKEBASE_NOTE"):
                ctx["LAKEBASE_NOTE"] = granted_said
        ctx["LAKEBASE_SUMMARY"] = (f"⚠️ {ctx['LAKEBASE_NOTE']}" if ctx.get("LAKEBASE_NOTE") else
                                   f"Apps that Implement builds read Lakebase: project {lakebase['project']}, catalog `{lakebase['catalog']}` ✅")
        print(f"  {_app_folder_access(api, ctx['APP_NAME'], sp)}")
        print(f"  {_assets_folder_access(api, ctx.get('ASSETS_PATH'), sp)}")
        shared_ok, shared_said = _shared_output_access(api, ctx["NOTEBOOK_PATH"], sp)
        print(f"  {'' if shared_ok else '⚠️ '}{shared_said}")
        scan_failed = _grant_scan_catalogs(ctx, sp, visible)
        blocking = _blocking_read_grants(failed, scan_failed)
        if blocking:
            shown = "; ".join(f"{sql}: {str(error)[:160]}" for sql, error in list(blocking.items())[:3])
            more = f" and {len(blocking) - 3} more" if len(blocking) > 3 else ""
            raise RuntimeError(f"{sp} could not be given read access to {_plural(len(blocking), 'grant')}: {shown}{more}. "
                               "Inspire stopped before it deploys the new App version, so the App keeps its last working version. "
                               "A catalog owner can run the grant, then run this installer again.")
        if not shared_ok:
            raise RuntimeError(f"{shared_said}. Inspire stopped before it deploys the new App version, so the App keeps its last working version. "
                               "Then run this installer again.")
    elif not new_sp_app_id:
        print("⚠️ Skipped: SP not found. Grant manually after checking /api/health.")
    elif not warehouse_id:
        print("⚠️ Skipped: no warehouse.")


def step_render_done(ctx):
    api_get = ctx["api_get"]
    app_name = ctx["APP_NAME"]
    inspire_db = ctx["INSPIRE_DB"]
    warehouse_name = ctx["WAREHOUSE_NAME"]
    new_sp_app_id = ctx.get("NEW_SP_APP_ID")
    version = ctx["RELEASE_VERSION"]

    app_url = _app_url(api_get(f"/api/2.0/apps/{app_name}")) or ctx.get("app_url", "")
    ctx["app_url"] = app_url
    not_reported = f"Databricks has not reported the App URL yet: open it from Compute → Apps → {app_name}"
    new_address = ("A new App's address can take a few minutes to start working. If the page does not open, "
                   "wait a few minutes and try again.")

    print("=" * 60)
    print(f"  {app_description(version)} is ready")
    print("=" * 60)
    print(f"  Databricks App: {app_name}  (Compute → Apps → {app_name})")
    print("  Open this URL to use Inspire AI (Apps runtime, not this notebook):")
    print(f"  URL:         {app_url or not_reported}")
    print(f"  {new_address}")
    link = (
        f'<a href="{app_url}" target="_blank" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#ff6b35,#f7931e);'
        'color:white;text-decoration:none;border-radius:8px;font-size:18px;font-weight:600;box-shadow:0 4px 15px rgba(255,107,53,0.3)">'
        f'Open Inspire AI (Databricks App)</a>\n        <p style="color:#666;margin-top:14px;font-size:12px">{app_url}</p>'
        if app_url else f'<p style="color:#f7931e;font-size:14px">{not_reported}</p>'
    )
    print(f"  Database:    {inspire_db}")
    print(f"  Warehouse:   {warehouse_name}")
    print(f"  SP:          {new_sp_app_id or 'NOT FOUND'}")
    print(f"  Assets:      {ctx.get('ASSETS_PATH') or 'NOT INSTALLED'}")
    if ctx.get("USER_SCOPES_NOTE"):
        print(f"  Sign-in:     {ctx['USER_SCOPES_NOTE']}")
    if ctx.get("LAKEBASE_SUMMARY"):
        print(f"  Lakebase:    {ctx['LAKEBASE_SUMMARY']}")
    if ctx.get("GENIE_CODE_SUMMARY"):
        print(f"  Genie Code:  {ctx['GENIE_CODE_SUMMARY']}")
    print("=" * 60)

    displayHTML(
        f"""
        <div style="padding:24px;background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:12px;text-align:center;margin:20px 0">
        <h2 style="color:#e0e0e0;margin-bottom:8px">{app_description(version)}: Databricks App ready</h2>
        <p style="color:#aaa;font-size:13px;margin-bottom:8px">Installer finished. Run the product from the <strong>Databricks App</strong> below (hosted Apps compute + <code>start.sh</code>).</p>
        <p style="color:#888;font-size:12px;margin-bottom:20px">Do not rely on this notebook for day-to-day use: open the App.</p>
        {link}
        <p style="color:#aaa;font-size:12px;margin-top:14px">{new_address}</p>
        </div>"""
    )


def _assets_folder_access(api, assets_path, sp):
    folder = _workspace_api_path(ASSETS_PARENT)
    if not assets_path:
        return f"⚠️ No Inspire assets were installed in {folder}, so runs cannot read them. Run this installer again"
    found = api("GET", f"/api/2.0/workspace/get-status?path={folder}")
    object_id = found.json().get("object_id") if found.status_code == 200 else None
    if not object_id:
        return (f"⚠️ Could not find {folder} ({found.text[:160]}), so runs may not read the Inspire assets. "
                f"A workspace admin can give {sp} and the users group Can Read on that folder")
    resp = api(
        "PATCH",
        f"/api/2.0/permissions/directories/{object_id}",
        {"access_control_list": [{"service_principal_name": sp, "permission_level": "CAN_READ"},
                                 {"group_name": "users", "permission_level": "CAN_READ"}]},
    )
    if resp.status_code == 200:
        return f"CAN_READ on {folder} for {sp} and the users group, so every run reads the Inspire assets: ✅"
    return (f"⚠️ Runs may not read the Inspire assets in {folder} yet ({resp.text[:160]}). "
            f"A workspace admin can give {sp} and the users group Can Read on that folder")


def _sha256_file(path):
    digest, size = hashlib.sha256(), 0
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
            size += len(block)
    return digest.hexdigest(), size


def _safe_relative(name):
    name = str(name or "")
    return bool(name) and not name.startswith("/") and "\\" not in name and all(p not in ("", ".", "..") for p in name.split("/"))


def _assets_listing(tar, version):
    try:
        manifest_member = tar.getmember(ASSETS_MANIFEST)
        data = json.loads(tar.extractfile(manifest_member).read().decode("utf-8"))
    except (KeyError, AttributeError, ValueError) as exc:
        raise RuntimeError(f"{ASSETS_TAR} holds no readable {ASSETS_MANIFEST} ({_error_words(exc)}). Download the release again.") from None
    if not isinstance(data, dict) or data.get("format") != ASSETS_FORMAT or not isinstance(data.get("files"), list):
        raise RuntimeError(f"{ASSETS_TAR} holds an {ASSETS_MANIFEST} this installer does not read. Download the release again.")
    if data.get("inspire_version") != version:
        raise RuntimeError(f"{ASSETS_TAR} is for Inspire {str(data.get('inspire_version'))[:40]}, not {version}, so the files "
                           "come from two releases. Download every file of one release again.")
    for entry in data["files"]:
        file = str((entry or {}).get("file") or "") if isinstance(entry, dict) else ""
        if not _safe_relative(file) or file == ASSETS_MANIFEST or not isinstance(entry.get("size"), int) \
                or not re.fullmatch(r"[0-9a-f]{64}", str(entry.get("sha256") or "")):
            raise RuntimeError(f"{ASSETS_TAR} lists an entry this installer refuses: {file[:120]!r}. Download the release again.")
    return manifest_member, data["files"]


def step_assets(ctx):
    tar_path, root, version = ctx["ASSETS_TAR"], ctx["ASSETS_ROOT"], ctx["RELEASE_VERSION"]
    print(f"Inspire assets: checking every file in {ASSETS_TAR} ...")
    stage = tempfile.mkdtemp(prefix="inspire_assets_")
    try:
        with tarfile.open(tar_path, "r:") as tar:
            manifest_member, files = _assets_listing(tar, version)
            for entry in files:
                try:
                    member = tar.getmember(entry["file"])
                except KeyError:
                    raise RuntimeError(f"{ASSETS_TAR} misses {entry['file']}, which its {ASSETS_MANIFEST} lists. "
                                       "Download the release again.") from None
                if not member.isfile():
                    raise RuntimeError(f"{entry['file']} in {ASSETS_TAR} is not a plain file. Download the release again.")
                local = os.path.join(stage, entry["file"])
                os.makedirs(os.path.dirname(local), exist_ok=True)
                with tar.extractfile(member) as source, open(local, "wb") as target:
                    shutil.copyfileobj(source, target, 1 << 20)
                if _sha256_file(local) != (entry["sha256"], entry["size"]):
                    raise RuntimeError(f"{entry['file']} in {ASSETS_TAR} does not match its size and sha256 in "
                                       f"{ASSETS_MANIFEST}. Download the release again.")
            manifest_bytes = tar.extractfile(manifest_member).read()
        copied = kept = 0
        for entry in files:
            dest = f"{root}/{entry['file']}"
            if os.path.isfile(dest) and _sha256_file(dest) == (entry["sha256"], entry["size"]):
                kept += 1
                continue
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            shutil.copyfile(os.path.join(stage, entry["file"]), dest)
            if _sha256_file(dest) != (entry["sha256"], entry["size"]):
                raise RuntimeError(f"{dest} does not read back with its sha256 after the copy. Run this installer again.")
            copied += 1
        os.makedirs(root, exist_ok=True)
        with open(f"{root}/{ASSETS_MANIFEST}", "wb") as handle:
            handle.write(manifest_bytes)
    finally:
        shutil.rmtree(stage, ignore_errors=True)
    ctx["ASSETS_PATH"] = root
    print(f"Inspire assets: ✅ {_plural(len(files), 'file')} in {root} ({copied} copied, {kept} already there)")


def _wait_statement(w, stmt, limit_s=120, sleep=time.sleep):
    waited = 0
    while stmt.status and stmt.status.state in (StatementState.PENDING, StatementState.RUNNING) and waited < limit_s:
        sleep(5)
        waited += 5
        stmt = w.statement_execution.get_statement(stmt.statement_id)
    return stmt


def _metastore_admin(ctx):
    if "METASTORE_ADMIN" not in ctx:
        try:
            ctx["METASTORE_ADMIN"] = str(ctx["api_get"]("/api/2.1/unity-catalog/metastore_summary").get("owner") or "").lower()
        except Exception:
            ctx["METASTORE_ADMIN"] = ""
    return ctx["METASTORE_ADMIN"]


def _catalog_privileges(ctx, catalog):
    w, api_get = ctx["w"], ctx["api_get"]
    mine = {ctx["USER_EMAIL"].lower(), *[str(g).lower() for g in ctx.get("USER_GROUPS") or [] if g]}
    owners = ctx.get("CATALOG_OWNERS") or {}
    owner = str((owners[catalog] if catalog in owners else getattr(w.catalogs.get(catalog), "owner", "")) or "").lower()
    admin = _metastore_admin(ctx)
    if owner in mine or (admin and admin in mine):
        return True, set()
    principal = urllib.parse.quote(ctx["USER_EMAIL"])
    data = api_get(f"/api/2.1/unity-catalog/effective-permissions/catalog/{urllib.parse.quote(catalog)}?principal={principal}")
    held = {str(p.get("privilege") or "").upper() for a in data.get("privilege_assignments") or [] for p in a.get("privileges") or []}
    return False, held


def _catalog_rights(ctx):
    w, catalog, schema = ctx["w"], ctx["CATALOG"], ctx["SCHEMA"]
    full, held = _catalog_privileges(ctx, catalog)
    try:
        w.schemas.get(f"{catalog}.{schema}")
        schema_exists = True
    except Exception:
        schema_exists = False
    return {"grant": _can_grant(_person_privileges(full, held)), "held": held,
            "schema": schema_exists or full or bool({"CREATE_SCHEMA", "ALL_PRIVILEGES"} & held)}


def _person_privileges(full, held):
    return (["OWNER"] if full else []) + sorted(held)


def _grant_refusal(name, person, held):
    why = " (ALL PRIVILEGES does not include MANAGE)" if "ALL_PRIVILEGES" in held else ""
    return (f"you are not its owner or a metastore admin and hold no MANAGE on it{why}. The catalog owner can run "
            f"GRANT MANAGE ON CATALOG `{name}` TO `{person}`, or make you the owner of `{name}`")


def _scan_catalogs(value, visible):
    if value == SCAN_ALL:
        return SCAN_ALL
    if not isinstance(value, (list, tuple)) or not all(isinstance(name, str) for name in value):
        raise ValueError(f'SCAN_CATALOGS must be the word "all" or a list of catalog names, such as ["main", "sales"], not {str(value)[:80]!r}.')
    names = []
    for raw in value:
        name = raw.strip()
        if not name or "`" in name:
            raise ValueError(f"SCAN_CATALOGS holds {raw[:80]!r}, which is not a catalog name.")
        if name not in names:
            names.append(name)
    unseen = [name for name in names if name not in visible]
    if unseen:
        raise ValueError(f"SCAN_CATALOGS names {', '.join(f'`{n}`' for n in unseen)}, which is not a catalog you can see. "
                         "Fix the name, or take it out of SCAN_CATALOGS.")
    return names


def step_preflight(ctx):
    api, w = ctx["api"], ctx["w"]
    app_name, catalog, schema = ctx["APP_NAME"], ctx["CATALOG"], ctx["SCHEMA"]
    print("Checking your rights before anything is replaced...")
    problems = []
    found = api("GET", f"/api/2.0/apps/{app_name}")
    if found.status_code == 200:
        perm = api("GET", f"/api/2.0/permissions/apps/{app_name}")
        if perm.status_code != 200:
            problems.append(f"You cannot manage the App {app_name} ({perm.status_code} {perm.text[:160]}). "
                            "Its owner can give you Can Manage on it.")
        else:
            other = _other_app_problem(api, app_name, found.json() or {})
            if other:
                problems.append(other)
    elif found.status_code == 404:
        listed = api("GET", "/api/2.0/apps?page_size=1")
        if listed.status_code != 200:
            problems.append(f"You cannot create Databricks Apps here ({listed.status_code} {listed.text[:160]}). "
                            "A workspace admin can let you use Apps.")
    else:
        problems.append(f"The App {app_name} could not be read ({found.status_code} {found.text[:160]}).")
    try:
        stmt = _wait_statement(w, w.statement_execution.execute_statement(
            warehouse_id=ctx["WAREHOUSE_ID"], statement="SELECT 1", wait_timeout="30s"))
        if not (stmt.status and stmt.status.state == StatementState.SUCCEEDED):
            detail = stmt.status.error.message if stmt.status and stmt.status.error else str(stmt.status)
            problems.append(f"The SQL warehouse {ctx['WAREHOUSE_NAME']} does not run a query for you ({str(detail)[:160]}). "
                            "You need Can Use on it.")
    except Exception as exc:
        problems.append(f"The SQL warehouse {ctx['WAREHOUSE_NAME']} does not run a query for you ({_error_words(exc)}). "
                        "You need Can Use on it.")
    try:
        rights = _catalog_rights(ctx)
        if not rights["grant"]:
            problems.append(f"You cannot grant on catalog `{catalog}`, and the Inspire App needs USE CATALOG on it: "
                            f"{_grant_refusal(catalog, ctx['USER_EMAIL'], rights['held'])}.")
        if not rights["schema"]:
            problems.append(f"You cannot create the schema `{catalog}`.`{schema}`. A catalog owner can run "
                            f"GRANT CREATE SCHEMA ON CATALOG `{catalog}` TO `{ctx['USER_EMAIL']}`.")
    except Exception as exc:
        problems.append(f"Inspire cannot check catalog `{catalog}`: {_rights_unread(exc, catalog, ctx['USER_EMAIL'])}.")
    scan = None
    try:
        scan = _scan_catalogs(ctx.get("SCAN_CATALOGS", SCAN_ALL), set(ctx["available_catalogs"]))
        ctx["SCAN_CATALOGS"] = scan
    except ValueError as exc:
        problems.append(str(exc))
    for name in scan if isinstance(scan, list) else []:
        if name == catalog:
            continue
        try:
            full, held = _catalog_privileges(ctx, name)
            if not _can_grant(_person_privileges(full, held)):
                problems.append(f"SCAN_CATALOGS names `{name}`, and you cannot grant on it, so the Inspire App could not read it: "
                                f"{_grant_refusal(name, ctx['USER_EMAIL'], held)}, or take `{name}` out of SCAN_CATALOGS.")
        except Exception as exc:
            problems.append(f"Inspire cannot check catalog `{name}` in SCAN_CATALOGS: {_rights_unread(exc, name, ctx['USER_EMAIL'])}.")
    for folder in (f"/Shared/{app_name}", _workspace_api_path(ctx["BUNDLE_ROOT"]), _workspace_api_path(ASSETS_PARENT)):
        made = api("POST", "/api/2.0/workspace/mkdirs", {"path": folder})
        if made.status_code != 200:
            problems.append(f"You cannot write the workspace folder {folder} ({made.status_code} {made.text[:160]}). "
                            "A workspace admin can give you Can Manage on it.")
    if problems:
        raise RuntimeError("Nothing was replaced: the installed Inspire App and its service principal are untouched. "
                           "Fix these, then run this installer again:\n" + "\n".join(f"  • {p}" for p in problems))
    print(f"  Rights: ✅ App {app_name}, warehouse {ctx['WAREHOUSE_NAME']}, catalog `{catalog}` and the workspace folders")
    print(f"  The App may read catalogs: SCAN_CATALOGS = {_scan_label(scan, catalog)}")


def run(env):
    global dbutils, displayHTML
    dbutils = env["dbutils"]
    displayHTML = env["displayHTML"]
    try:
        ctx = build_runtime_context(env)
        if not ctx.get("ready"):
            return None
        for step in (step_preflight, step_bundle, step_assets, step_cleanup, step_schema_and_notebooks, step_create_app_and_find_sp,
                     step_grant_permissions, step_deploy_source, step_render_done):
            step(ctx)
        return ctx
    except (FileNotFoundError, RuntimeError, requests.exceptions.HTTPError) as exc:
        show_warning_banner("Setup incomplete", _error_words(exc, None))
        raise
