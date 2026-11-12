import argparse
import base64
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request

from databricks.sdk import WorkspaceClient
from databricks.sdk.config import Config
from databricks.sdk.service import jobs, workspace

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import rc_settings

S = rc_settings.load()
HERE = rc_settings.HERE
PROFILE = rc_settings.need(S, "profile")
REPO = "amralieg/inspire"
W40 = rc_settings.path(S, "work")
WAREHOUSE = rc_settings.need(S, "warehouse")
CATALOG = rc_settings.need(S, "catalog")
PROTECTED_APPS = set(rc_settings.need(S, "protected_apps"))
SCRATCH_APP = rc_settings.need(S, "scratch_app")
WATCHED_SPS = set(rc_settings.need(S, "watched_service_principals"))
WORKSPACE_FOLDER = rc_settings.need(S, "workspace_folder")
UPLOAD_TIMEOUT_SECONDS = 1800


def say(text):
    print(f"[{time.strftime('%H:%M:%S', time.gmtime())}Z] {text}", flush=True)


def retried(fn, *a, **k):
    for attempt in range(1, 7):
        try:
            return fn(*a, **k)
        except Exception as exc:
            text = str(exc)
            if attempt == 6 or not re.search(r"timed? ?out|connection|resolve|temporar|reset|unreachable|502|503|504|TLS", text, re.I):
                raise
            say(f"network error ({text[:160]}); waiting for the network, attempt {attempt}")
            rc_settings.wait_for_network(S)


def client():
    return WorkspaceClient(config=Config(profile=PROFILE, http_timeout_seconds=UPLOAD_TIMEOUT_SECONDS))


def default_app(tag):
    found = re.fullmatch(r"v[0-9]\.[0-9]\.[0-9]-rc\.([0-9])", tag)
    if not found:
        raise SystemExit(f"{tag} is not a release candidate tag; pass --app")
    return SCRATCH_APP


def release_base(tag):
    return f"https://github.com/{REPO}/releases/download/{tag}"


WHOLE_SET = ("manifest.json", "inspire-app.zip", "inspire-assets.tar")


def stage_remote(w, tag, folder, mode, files):
    data = (HERE / "rc_stage_remote.py").read_bytes()
    retried(w.workspace.import_, f"{folder}/rc_stage", content=base64.b64encode(data).decode(), format=workspace.ImportFormat.SOURCE,
            language=workspace.Language.PYTHON, overwrite=True)
    run = retried(w.jobs.submit, run_name=f"inspire {tag} stage the release files ({mode})", tasks=[jobs.SubmitTask(
        task_key="stage", notebook_task=jobs.NotebookTask(notebook_path=f"{folder}/rc_stage", source=jobs.Source.WORKSPACE,
                                                          base_parameters={"tag": tag, "folder": folder, "mode": mode, "files": ",".join(files)}),
        environment_key="default", max_retries=0, disable_auto_optimization=True)],
        environments=[jobs.JobEnvironment(environment_key="default", spec=jobs.compute.Environment(client="2"))]).response.run_id
    say(f"staging job submitted: run {run} ({mode})")
    done = wait(w, run)
    output = retried(w.jobs.get_run_output, done.tasks[-1].run_id)
    result = done.state.result_state.value if done.state.result_state else None
    say(f"staging job ended: {result}; {(output.notebook_output.result if output.notebook_output else '') or output.error}")
    if result != "SUCCESS":
        raise SystemExit("the staging job did not succeed")
    retried(w.workspace.delete, f"{folder}/rc_stage")
    return json.loads(output.notebook_output.result)


def prep(w, tag, folder, app_name, work, online=False, whole=False, unzip=False, tag_links=False, remote_stage="", remote_files=()):
    release = work / "downloaded"
    if not (release / "manifest.json").is_file():
        release = work / "release"
    say(f"installing the files in {release}")
    base = release_base(tag)
    if app_name in PROTECTED_APPS or app_name != SCRATCH_APP:
        raise SystemExit(f"{app_name} is not a scratch App name of this lane")
    try:
        retried(w.workspace.delete, folder, recursive=True)
        say(f"removed the old {folder}")
    except Exception:
        pass
    retried(w.workspace.mkdirs, folder)
    text = (release / "inspire_installer.py").read_text(encoding="utf-8")
    if text.count("INTERNET_BLOCKED = False") != 1:
        raise SystemExit("INTERNET_BLOCKED = False is not in the release installer exactly once")
    installer = text if online else text.replace("INTERNET_BLOCKED = False", "INTERNET_BLOCKED = True")
    for name, data in (("inspire_installer", installer.encode("utf-8")), ("guard", (HERE / "guard_wrapper.py").read_bytes())):
        retried(w.workspace.import_, f"{folder}/{name}", content=base64.b64encode(data).decode(), format=workspace.ImportFormat.SOURCE,
                language=workspace.Language.PYTHON, overwrite=True)
    settings = {"app_name": app_name, "warehouse_id": WAREHOUSE, "catalog": CATALOG}
    if '"test_tag"' in text:
        settings["test_tag"] = app_name
    else:
        say("this release installer has no test_tag setting, so the jobs of this install are not tagged as tests")
    if not online or tag_links:
        settings["release"] = base
    retried(w.workspace.upload, f"{folder}/inspire_installer_test.json", json.dumps(settings).encode(), format=workspace.ImportFormat.RAW,
            overwrite=True)
    names = []
    if unzip:
        names = ["manifest.json", "inspire-assets.tar"]
    elif whole or not online:
        names = [name for name in WHOLE_SET if not (remote_stage and name in remote_files)]
    for name in names:
        def put(name=name):
            with open(release / name, "rb") as handle:
                w.workspace.upload(f"{folder}/{name}", handle, format=workspace.ImportFormat.RAW, overwrite=True)
        retried(put)
    staged = stage_remote(w, tag, folder, remote_stage, remote_files) if remote_stage else None
    if unzip:
        import requests
        reply = requests.post(f"{w.config.host}/api/2.0/workspace/import", headers=w.config.authenticate(), timeout=600,
                              files={"content": ("inspire-app.zip", (release / "inspire-app.zip").read_bytes())},
                              data={"path": f"{folder}/inspire-app.zip", "format": "AUTO", "overwrite": "true"})
        if reply.status_code != 200:
            raise SystemExit(f"importing inspire-app.zip the way the workspace UI does failed: HTTP {reply.status_code} {reply.text[:300]}")
        say(f"inspire-app.zip imported with format AUTO, as the workspace UI does")
    listed = sorted((o.path.rsplit("/", 1)[1], str(o.object_type).split(".")[-1], o.size) for o in w.workspace.list(folder))
    say(f"{folder}: {len(listed)} objects ({', '.join(n for n, _, _ in listed)}), largest {max((s or 0) for _, _, s in listed)} bytes")
    if staged:
        (W40 / f"{tag}-{remote_stage}_staged.json").write_text(json.dumps(staged, indent=1), encoding="utf-8")
    return listed


ISOLATION = HERE / "isolation.py"


def before_snapshot(path, run=subprocess.run):
    done = run([sys.executable, str(ISOLATION), "snapshot", str(path)], capture_output=True, text=True)
    if done.returncode != 0 or not pathlib.Path(path).is_file():
        detail = (done.stderr or done.stdout or "").strip()[-400:]
        raise SystemExit(f"the before-snapshot {path} failed (exit {done.returncode}), so nothing is installed: {detail}")
    say(f"before-snapshot written: {path}")
    return pathlib.Path(path)


def busy_protected_runs(w, app_name):
    watched = set(WATCHED_SPS)
    try:
        target = retried(w.apps.get, app_name).service_principal_client_id
        if target:
            watched.add(target)
    except Exception as exc:
        if "does not exist" not in str(exc) and "NOT_FOUND" not in str(exc) and "not found" not in str(exc).lower():
            raise
    busy = []
    for run in retried(lambda: list(w.jobs.list_runs(active_only=True))):
        if run.creator_user_name in watched:
            busy.append(run.run_id)
    say(f"watched service principals: {len(watched)}; active runs by them: {len(busy)}")
    return busy


def submit(w, tag, folder, online=False):
    run = retried(w.jobs.submit, run_name=f"inspire {tag} installer proof", tasks=[jobs.SubmitTask(
        task_key="installer", notebook_task=jobs.NotebookTask(notebook_path=f"{folder}/guard", source=jobs.Source.WORKSPACE,
                                                             base_parameters={"guard_mode": "online" if online else "offline"}),
        environment_key="default", max_retries=0, disable_auto_optimization=True)],
        environments=[jobs.JobEnvironment(environment_key="default", spec=jobs.compute.Environment(client="2"))])
    return run.response.run_id


def wait(w, run_id):
    while True:
        run = retried(w.jobs.get_run, run_id)
        state = run.state
        if state.life_cycle_state and state.life_cycle_state.value in ("TERMINATED", "SKIPPED", "INTERNAL_ERROR"):
            return run
        time.sleep(20)


def output_text(w, run):
    task = run.tasks[-1].run_id
    html = retried(w.jobs.export_run, task, views_to_export=jobs.ViewsToExport.CODE).views[0].content
    model = re.search(r"__DATABRICKS_NOTEBOOK_MODEL = '([^']+)'", html)
    lines = []
    notebook = json.loads(urllib.parse.unquote(base64.b64decode(model.group(1)).decode("utf-8"))) if model else {}
    for command in notebook.get("commands", []):
        data = (command.get("results") or {}).get("data")
        for item in data if isinstance(data, list) else ([{"type": "text", "data": data}] if data else []):
            lines.append(f"[{item.get('type')}] {item.get('data')}")
        if command.get("error"):
            lines.append(f"[error] {command.get('error')}")
    return re.sub(r"\x1b\[[0-9;]*m", "", "\n".join(lines))


def token():
    out = subprocess.run(["databricks", "auth", "token", "-p", PROFILE, "--output", "json"], capture_output=True, text=True, check=True).stdout
    return json.loads(out)["access_token"]


def http(url, bearer):
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {bearer}"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.status, response.read().decode("utf-8", "replace")


def statement(w, sql):
    from databricks.sdk.service.sql import StatementState
    stmt = retried(w.statement_execution.execute_statement, warehouse_id=WAREHOUSE, statement=sql, wait_timeout="50s")
    while stmt.status.state in (StatementState.PENDING, StatementState.RUNNING):
        time.sleep(3)
        stmt = retried(w.statement_execution.get_statement, stmt.statement_id)
    if stmt.status.state != StatementState.SUCCEEDED:
        return None
    cols = [c.name.lower() for c in stmt.manifest.schema.columns]
    return [dict(zip(cols, row)) for row in ((stmt.result.data_array if stmt.result else None) or [])]


def run_pages(app, bearer, database, warehouse):
    query = urllib.parse.urlencode({"inspire_database": database, "warehouse_id": warehouse})
    try:
        status, body = http(f"{app.url}/api/run/pages?{query}", bearer)
    except urllib.error.HTTPError as exc:
        status, body = exc.code, exc.read().decode("utf-8", "replace")
    try:
        pages = json.loads(body).get("pages")
    except (ValueError, AttributeError):
        pages = None
    return {"status": status, "first_300": body[:300], "pages": len(pages) if isinstance(pages, list) else None,
            "use_cases": sorted({str(p.get("use_case_id") or p.get("useCaseId") or "") for p in pages if isinstance(p, dict)} - {""})
            if isinstance(pages, list) else [], "mentions_N02_U01": "N02-U01" in body}


def verify(w, tag, out, app_name, key, work):
    app = retried(w.apps.get, app_name)
    sp = app.service_principal_client_id
    deployment = app.active_deployment
    result = {"app": app_name, "url": app.url, "compute": str(app.compute_status.state) if app.compute_status else None,
              "app_state": str(app.app_status.state) if app.app_status else None, "description": app.description,
              "service_principal": sp, "source": deployment.source_code_path if deployment else None,
              "deployment_id": deployment.deployment_id if deployment else None,
              "deployment_created": deployment.create_time if deployment else None}
    bearer = token()
    status, body = retried(http, f"{app.url}/api/defaults", bearer)
    result["defaults_status"] = status
    defaults = json.loads(body)
    result["envSkipsSetupWizard"] = defaults.get("envSkipsSetupWizard")
    result["agentVersion_defaults"] = defaults.get("agentVersion")
    status, health = retried(http, f"{app.url}/api/health", bearer)
    result["agentVersion_health"] = json.loads(health).get("agentVersion") if status == 200 else f"HTTP {status}"
    status, page = retried(http, f"{app.url}/", bearer)
    result["landing_status"] = status
    result["landing_has_root"] = '<div id="root"' in page
    result["landing_title"] = (re.search(r"<title>([^<]*)</title>", page) or [None, None])[1]
    result["run_pages"] = run_pages(app, bearer, defaults.get("inspireDatabase") or f"{CATALOG}._inspire",
                                    defaults.get("warehouseId") or WAREHOUSE)
    if deployment:
        built_server = (work / "src" / "app" / "backend" / "build" / "server.js").read_bytes()
        with w.workspace.download(f"{deployment.source_code_path}/backend/build/server.js") as handle:
            served_server = handle.read()
        result["deployed_server_equals_build"] = served_server == built_server
        result["deployed_server_sha256"] = hashlib.sha256(served_server).hexdigest()
        result["deployed_server_has_runId_param"] = b"app.param(\"runId\"" in served_server or b"app.param('runId'" in served_server
    built = work / "src" / "app" / "frontend" / "dist" / "index.html"
    served_assets = sorted(re.findall(r"/assets/(index-[A-Za-z0-9_-]+\.(?:js|css))", page))
    built_assets = sorted(re.findall(r"/assets/(index-[A-Za-z0-9_-]+\.(?:js|css))", built.read_text(encoding="utf-8"))) if built.exists() else []
    result["landing_assets_served"] = served_assets
    result["landing_assets_match_build"] = bool(served_assets) and served_assets == built_assets
    catalogs = [c.name for c in w.catalogs.list() if c.name not in ("system", "information_schema", "__databricks_internal", "samples")]
    held = {}
    for cat in catalogs:
        rows = statement(w, f"SHOW GRANTS `{sp}` ON CATALOG `{cat}`") or []
        held[cat] = sorted({str(r.get("actiontype")) for r in rows})
    result["sp_catalog_grants"] = {k: v for k, v in held.items() if v}
    result["catalogs_seen"] = len(catalogs)
    version = json.loads((work / "release" / "manifest.json").read_text(encoding="utf-8"))["version"]
    assets_root = f"/Workspace/Shared/inspire-ai/assets/{version}"
    with tarfile.open(work / "release" / "inspire-assets.tar") as tar:
        wanted = json.loads(tar.extractfile("manifest.json").read().decode("utf-8"))["files"]
    landed = {o.path.split(f"{assets_root}/", 1)[-1]: o.size for o in retried(lambda: list(w.workspace.list(assets_root, recursive=True)))
              if str(o.object_type).split(".")[-1] == "FILE"}
    result["assets_root"] = assets_root
    result["assets_landed"] = f"{sum(landed.get(e['file']) == e['size'] for e in wanted)} of {len(wanted)} files with the manifest size"
    result["assets_missing_or_wrong"] = [e["file"] for e in wanted if landed.get(e["file"]) != e["size"]][:10]
    result["assets_manifest_present"] = "manifest.json" in landed
    result["installer_version_lines"] = [l[:240] for l in out.splitlines() if version in l][:10]
    schema_rows = statement(w, f"SHOW GRANTS `{sp}` ON SCHEMA `{CATALOG}`.`_inspire`") or []
    result["sp_inspire_schema_grants"] = sorted({str(r.get("actiontype")) for r in schema_rows})
    log_path = W40 / f"{key}_app_logs.txt"
    try:
        subprocess.run(["databricks", "apps", "logs", app_name, "-p", PROFILE, "--tail-lines", "0", "--output-file", str(log_path)],
                       capture_output=True, text=True, timeout=90)
    except subprocess.TimeoutExpired:
        pass
    text = log_path.read_text(encoding="utf-8", errors="replace") if log_path.exists() else ""
    lines = text.splitlines()
    result["app_log_lines"] = len(lines)
    result["app_log_first"] = lines[:1]
    result["app_log_sources"] = sorted({m.group(1) for m in (re.match(r"\S+ \[(\w+)\]", l) for l in lines) if m})
    result["app_log_start"] = [l[:240] for l in lines if re.search(r"Inspire AI starting from|listening|cannot start", l, re.I)][:6]
    result["app_log_npm"] = [l[:240] for l in lines if re.search(r"\bnpm\b|\bnpx\b|\byarn\b|\bpip\b|node_modules|package\.json|registry|Installing", l, re.I)][:12]
    result["app_log_network_errors"] = [l[:240] for l in lines if re.search(r"ENOTFOUND|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|getaddrinfo|fetch failed", l)][:12]
    result["app_log_system"] = [l[:240] for l in lines if "[SYSTEM]" in l][:20]
    result["installer_lines"] = {key: [l[:300] for l in out.splitlines() if re.search(pattern, l)][:6] for key, pattern in (
        ("guard", r"SOCKET GUARD"), ("acquire", r"GitHub was not tried|every file checked"), ("plan", r"Grant plan for|Grants: "),
        ("url", r"App URL:|App created:|URL:  "), ("bundle", r"Unpacking Inspire|Source from zip"), ("assets", r"Inspire assets: "),
        ("pip_npm", r"\bpip install|%pip|\bnpm\b"), ("warnings", r"⚠️"), ("errors", r"\[error\]|Traceback|Nothing was replaced"))}
    return result


def main():
    global CATALOG
    parser = argparse.ArgumentParser()
    parser.add_argument("tag")
    parser.add_argument("stage", choices=("all", "verify"))
    parser.add_argument("--app", default="", help="the scratch App to install onto; defaults to the scratch_app setting")
    parser.add_argument("--label", default="", help="names a second install of the same tag: its folder and evidence files")
    parser.add_argument("--work", default="", help="the build folder under the work setting whose files are installed and checked; defaults to the tag")
    parser.add_argument("--online", action="store_true", help="upload only the installer and let it download the latest release from GitHub")
    parser.add_argument("--whole", action="store_true", help="upload the installer with manifest.json, inspire-app.zip and inspire-assets.tar as whole files (the default offline upload; with --online it also uploads them)")
    parser.add_argument("--unzip", action="store_true", help="upload manifest.json and the whole inspire-assets.tar, and import inspire-app.zip so the workspace unzips it")
    parser.add_argument("--remote-stage", choices=("whole", "ui"), default="",
                        help="offline: a workspace job downloads the release files and imports them next to the installer, whole (format RAW) or the way the workspace UI import does (it unpacks inspire-app.zip), so no large file goes over this computer's link")
    parser.add_argument("--remote-files", default="manifest.json,inspire-app.zip,inspire-assets.tar",
                        help="with --remote-stage, the release files the workspace job downloads from the tag; this computer uploads the others whole")
    parser.add_argument("--tag-links", action="store_true", help="with --online, download from this tag's links instead of the latest release")
    parser.add_argument("--catalog", default=CATALOG, help="the catalog the installer puts the Inspire Database in (<catalog>._inspire)")
    args = parser.parse_args()
    rc_settings.require_tools(S, commands=("net_wait",))
    CATALOG = args.catalog
    if args.remote_stage and (args.online or args.whole or args.unzip):
        raise SystemExit("--remote-stage is an offline install of its own")
    if args.tag_links and not args.online:
        raise SystemExit("--tag-links needs --online")
    work = W40 / (args.work or args.tag)
    if not (work / "release" / "manifest.json").is_file():
        raise SystemExit(f"{work} holds no built release")
    app_name = args.app or default_app(args.tag)
    if app_name in PROTECTED_APPS or app_name != SCRATCH_APP:
        raise SystemExit(f"{app_name} is not a scratch App name of this lane")
    key = f"{args.tag}-{args.label}" if args.label else args.tag
    w = client()
    me = w.current_user.me().user_name
    folder = f"/Users/{me}/{WORKSPACE_FOLDER}/{key}"
    state_path = W40 / f"{key}_install.json"
    if args.stage == "all":
        if state_path.exists():
            raise SystemExit(f"{state_path} exists: this install already ran; pick a new --label")
        before_snapshot(W40 / f"{key}_iso_before.json")
        busy = busy_protected_runs(w, app_name)
        if busy:
            raise SystemExit(f"{len(busy)} run(s) of a watched App service principal are active; not installing")
        prep(w, args.tag, folder, app_name, work, online=args.online, whole=args.whole, unzip=args.unzip, tag_links=args.tag_links,
             remote_stage=args.remote_stage, remote_files=tuple(n for n in args.remote_files.split(",") if n))
        run_id = submit(w, args.tag, folder, online=args.online)
        state_path.write_text(json.dumps({"run_id": run_id, "folder": folder}), encoding="utf-8")
        say(f"installer job submitted: run {run_id}")
        run = wait(w, run_id)
        say(f"installer job ended: {run.state.life_cycle_state.value} {run.state.result_state.value if run.state.result_state else None} "
            f"in {(run.end_time - run.start_time) // 1000} s")
    run_id = json.loads(state_path.read_text(encoding="utf-8"))["run_id"]
    run = retried(w.jobs.get_run, run_id)
    out = ""
    for _ in range(5):
        out = output_text(w, run)
        if out.strip():
            break
        say("the run export came back empty; exporting again")
        time.sleep(15)
    (W40 / f"{key}_installer_out.txt").write_text(out, encoding="utf-8")
    result = {"run_id": run_id, "result": run.state.result_state.value if run.state.result_state else None,
              "seconds": (run.end_time - run.start_time) // 1000 if run.end_time else None,
              **verify(w, args.tag, out, app_name, key, work)}
    (W40 / f"{key}_verify.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    print(json.dumps(result, indent=1))
    failed = install_failures(result)
    if failed:
        raise SystemExit(f"the install of {args.tag} on {app_name} failed: {'; '.join(failed)}")


def install_failures(result):
    failed = []
    if result.get("result") != "SUCCESS":
        failed.append(f"the installer job {result.get('run_id')} ended {result.get('result')}")
    if result.get("envSkipsSetupWizard") is not True:
        failed.append(f"/api/defaults gives envSkipsSetupWizard {result.get('envSkipsSetupWizard')!r}, so the App opens on the setup wizard")
    return failed


if __name__ == "__main__":
    main()
