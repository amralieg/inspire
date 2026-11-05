import argparse, fcntl, json, os, pathlib, re, sys, time, urllib.error, urllib.parse


def _path_setting(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"set {name}: INSPIRE_RC_TOOLS is the folder that holds rc_install.py, INSPIRE_RC_BASE the folder for "
                         f"install outputs, INSPIRE_RC_ENVS the shared workspace state file")
    return pathlib.Path(value)


sys.path.insert(0, str(_path_setting("INSPIRE_RC_TOOLS")))
import rc_install as R
from databricks.sdk import WorkspaceClient

BASE = _path_setting("INSPIRE_RC_BASE")
ENVS = _path_setting("INSPIRE_RC_ENVS")


def update_env(profile, **fields):
    lock = open(str(ENVS) + ".lock", "a")
    fcntl.flock(lock, fcntl.LOCK_EX)
    try:
        data = json.loads(ENVS.read_text()) if ENVS.exists() else {"owner": "infra lane", "workspaces": {}}
        entry = data["workspaces"].setdefault(profile, {})
        for key, value in fields.items():
            if key == "created":
                have = entry.setdefault("created", [])
                for item in value:
                    if item not in have:
                        have.append(item)
            else:
                entry[key] = value
        data["updated"] = time.strftime("%H:%M:%S")
        tmp = ENVS.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=1))
        tmp.replace(ENVS)
    finally:
        fcntl.flock(lock, fcntl.LOCK_UN)


def work_dir(tag, release_out):
    work = BASE / "work" / (tag + "-" + release_out.name)
    rel = work / "release"
    rel.mkdir(parents=True, exist_ok=True)
    for name in ("manifest.json", "inspire-app.zip", "inspire-assets.tar"):
        link = rel / name
        if not link.exists():
            link.symlink_to(release_out / name)
    text = (release_out / "inspire_installer.py").read_text(encoding="utf-8")
    if text.count('SCAN_CATALOGS = "all"') == 1:
        text = text.replace('SCAN_CATALOGS = "all"', "SCAN_CATALOGS = []")
    elif text.count("SCAN_CATALOGS = []") != 1:
        raise SystemExit('SCAN_CATALOGS is neither "all" nor [] exactly once in the release installer')
    (rel / "inspire_installer.py").write_text(text, encoding="utf-8")
    return work


def verify(w, app_name, catalog):
    app = R.retried(w.apps.get, app_name)
    res = {"app": app_name, "url": app.url, "sp": app.service_principal_client_id,
           "compute": str(app.compute_status.state) if app.compute_status else None,
           "app_state": str(app.app_status.state) if app.app_status else None,
           "source": app.active_deployment.source_code_path if app.active_deployment else None}
    bearer = R.token()
    for _ in range(20):
        try:
            status, body = R.http(f"{app.url}/api/defaults", bearer)
            d = json.loads(body)
            res.update(defaults_status=status, envSkipsSetupWizard=d.get("envSkipsSetupWizard"), agentVersion=d.get("agentVersion"),
                       inspireDatabase=d.get("inspireDatabase"), warehouseId=d.get("warehouseId"))
            break
        except Exception as exc:
            res["defaults_error"] = str(exc)[:200]
            time.sleep(30)
    try:
        status, page = R.http(f"{app.url}/", bearer)
        res["landing_status"], res["landing_has_root"] = status, '<div id="root"' in page
    except Exception as exc:
        res["landing_error"] = str(exc)[:200]
    rows = R.statement(w, f"SHOW GRANTS `{res['sp']}` ON CATALOG `{catalog}`") or []
    res["sp_catalog_grants"] = sorted({str(r.get("actiontype")) for r in rows})
    rows = R.statement(w, f"SHOW GRANTS `{res['sp']}` ON SCHEMA `{catalog}`.`_inspire`") or []
    res["sp_schema_grants"] = sorted({str(r.get("actiontype")) for r in rows})
    return res


def install_verdict(result, res):
    if result != "SUCCESS":
        return False, f"install {result}"
    if res.get("envSkipsSetupWizard") is not True:
        return False, "installed but /api/defaults envSkipsSetupWizard is not true"
    return True, "ready"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("profile")
    ap.add_argument("short")
    ap.add_argument("catalog")
    ap.add_argument("warehouse")
    ap.add_argument("tag")
    ap.add_argument("--release-out", required=True)
    ap.add_argument("--label", default="")
    ap.add_argument("--offline-remote", default="", help="offline install; comma list of files a workspace job fetches from the tag")
    args = ap.parse_args()
    app_name = f"inspire-v140r-{args.short}"
    release_out = pathlib.Path(args.release_out)
    R.PROFILE, R.WAREHOUSE, R.CATALOG, R.SCRATCH_APP = args.profile, args.warehouse, args.catalog, app_name
    R.W40 = BASE / "work"
    w = WorkspaceClient(profile=args.profile)
    me = w.current_user.me().user_name
    envs = json.loads(ENVS.read_text()) if ENVS.exists() else {"workspaces": {}}
    mine = {c.get("name") for c in envs["workspaces"].get(args.profile, {}).get("created", []) if c.get("kind") == "app"}
    try:
        existing = w.apps.get(app_name)
        if app_name not in mine or existing.creator != me:
            raise SystemExit(f"App {app_name} exists and is not one this lane created; not touching it")
        sp = existing.service_principal_client_id
        busy = [r.run_id for r in w.jobs.list_runs(active_only=True) if r.creator_user_name == sp]
        if busy:
            raise SystemExit(f"{len(busy)} active run(s) by {app_name}'s service principal; not upgrading now")
    except SystemExit:
        raise
    except Exception as exc:
        if "not found" not in str(exc).lower() and "does not exist" not in str(exc).lower():
            raise
    work = work_dir(args.tag, release_out)
    key = f"{args.tag}{('-' + args.label) if args.label else ''}-{args.short}"
    folder = f"/Users/{me}/inspire_v140r/{key}"
    update_env(args.profile, host=w.config.host, app_name=app_name, catalog_schema=f"{args.catalog}._inspire",
               warehouse_id=args.warehouse, status=f"installing {args.tag}", ready=False,
               created=[{"kind": "app", "name": app_name}, {"kind": "workspace_folder", "path": folder},
                        {"kind": "workspace_folder", "path": f"/Workspace/Shared/{app_name}"},
                        {"kind": "workspace_folder", "path": f"/Workspace/Shared/inspire-ai/apps/{app_name}"},
                        {"kind": "service_principal", "name": f"{app_name} (App SP)"}])
    if args.offline_remote:
        remote = tuple(n for n in args.offline_remote.split(",") if n)
        R.prep(w, args.tag, folder, app_name, work, online=False, remote_stage="whole", remote_files=remote)
        run_id = R.submit(w, args.tag, folder, online=False)
    else:
        R.prep(w, args.tag, folder, app_name, work, online=True, tag_links=True)
        run_id = R.submit(w, args.tag, folder, online=True)
    R.say(f"{args.profile}: installer job submitted: run {run_id}")
    update_env(args.profile, installer_run_id=run_id)
    run = R.wait(w, run_id)
    result = run.state.result_state.value if run.state.result_state else None
    R.say(f"{args.profile}: installer job ended {run.state.life_cycle_state.value} {result}")
    out = ""
    for _ in range(5):
        out = R.output_text(w, run)
        if out.strip():
            break
        time.sleep(15)
    (BASE / f"{key}_installer_out.txt").write_text(out, encoding="utf-8")
    res = {"run_id": run_id, "result": result}
    try:
        res.update(verify(w, app_name, args.catalog))
    except Exception as exc:
        res["verify_error"] = str(exc)[:300]
    res["installer_warnings"] = [l[:240] for l in out.splitlines() if "⚠️" in l][:15]
    res["installer_errors"] = [l[:300] for l in out.splitlines() if re.search(r"\[error\]|Traceback|Nothing was replaced", l)][:6]
    res["sha_lines"] = [l[:200] for l in out.splitlines() if "sha256 checked" in l]
    (BASE / f"{key}_verify.json").write_text(json.dumps(res, indent=1))
    ready, status = install_verdict(result, res)
    update_env(args.profile, app_url=res.get("url"), rc_installed=(args.tag + (" + " + args.label if args.label else "")) if result == "SUCCESS" else None, ready=ready,
               status=status, sp=res.get("sp"),
               blocker=None if ready else (res.get("installer_errors") or res.get("verify_error") or res.get("defaults_error") or "see verify json"),
               verify_file=str(BASE / f"{key}_verify.json"))
    res["ready"] = ready
    print(json.dumps(res, indent=1))
    if not ready:
        raise SystemExit(f"{args.profile}: NOT READY: installer {result}, envSkipsSetupWizard={res.get('envSkipsSetupWizard')!r}")


if __name__ == "__main__":
    main()
