import hashlib
import json
import pathlib
import sys

from databricks.sdk import WorkspaceClient

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import rc_install
import rc_settings

PROFILE = rc_install.PROFILE
WAREHOUSE = rc_install.WAREHOUSE
OWN_APP = rc_install.SCRATCH_APP
WATCHED_APPS = tuple(rc_settings.need(rc_install.S, "isolation.watched_apps"))
LAKEBASE_PROJECT = rc_settings.need(rc_install.S, "isolation.lakebase_project")
LAKEBASE_CATALOG = rc_settings.need(rc_install.S, "isolation.lakebase_catalog")
CATALOGS = (*rc_settings.need(rc_install.S, "isolation.catalogs"), LAKEBASE_CATALOG)
SCHEMAS = tuple(rc_settings.need(rc_install.S, "isolation.schemas"))
FOLDERS = tuple(rc_settings.need(rc_install.S, "isolation.folders"))
TREES = tuple(rc_settings.need(rc_install.S, "isolation.trees"))
ACL_FOLDERS = tuple(rc_settings.need(rc_install.S, "isolation.acl_folders"))
OWN_PATHS = (OWN_APP, rc_install.WORKSPACE_FOLDER, *rc_settings.need(rc_install.S, "isolation.own_paths"))


def listing(w, path, recursive=False):
    try:
        return sorted((o.path, str(o.object_type).split(".")[-1], o.size, o.modified_at, o.object_id)
                      for o in w.workspace.list(path, recursive=recursive))
    except Exception as exc:
        return f"ERR {str(exc)[:120]}"


def api(w, path):
    try:
        return w.api_client.do("GET", path)
    except Exception as exc:
        return f"ERR {str(exc)[:160]}"


def acl(w, kind, object_id):
    data = api(w, f"/api/2.0/permissions/{kind}/{object_id}")
    if isinstance(data, str):
        return data
    rows = []
    for e in data.get("access_control_list") or []:
        who = e.get("service_principal_name") or e.get("user_name") or e.get("group_name")
        for p in e.get("all_permissions") or []:
            rows.append([who, p.get("permission_level"), bool(p.get("inherited"))])
    return sorted(rows)


def snapshot(path):
    w = WorkspaceClient(profile=PROFILE)
    out = {"apps": {}, "folders": {}, "trees": {}, "acl": {}, "grants": {}, "lakebase": {}}
    for name in WATCHED_APPS:
        a = w.apps.get(name)
        d = a.active_deployment
        yaml_sha = None
        if d and d.source_code_path:
            with w.workspace.download(f"{d.source_code_path}/app.yaml") as h:
                yaml_sha = hashlib.sha256(h.read()).hexdigest()
        out["apps"][name] = {"sp": a.service_principal_client_id, "deployment": d.deployment_id if d else None,
                             "source": d.source_code_path if d else None, "app_yaml_sha256": yaml_sha,
                             "compute": str(a.compute_status.state) if a.compute_status else None,
                             "scopes": sorted(a.user_api_scopes or []), "description": a.description,
                             "update_time": a.update_time}
        nb = api(w, f"/api/2.0/permissions/apps/{name}")
        out["acl"][f"app:{name}"] = nb if isinstance(nb, str) else sorted(
            [e.get("service_principal_name") or e.get("user_name") or e.get("group_name"), p.get("permission_level")]
            for e in nb.get("access_control_list") or [] for p in e.get("all_permissions") or [])
    for f in FOLDERS:
        out["folders"][f] = listing(w, f)
    for t in TREES:
        out["trees"][t] = listing(w, t, recursive=True)
    for f in ACL_FOLDERS:
        st = api(w, f"/api/2.0/workspace/get-status?path={f}")
        out["acl"][f"dir:{f}"] = acl(w, "directories", st["object_id"]) if isinstance(st, dict) else st
    out["acl"]["warehouse"] = acl(w, "sql/warehouses", WAREHOUSE)
    out["acl"]["lakebase_project"] = acl(w, "database-projects", LAKEBASE_PROJECT)
    for c in CATALOGS:
        out["grants"][f"catalog:{c}"] = sorted([r.get("principal"), r.get("actiontype"), r.get("objecttype"), r.get("objectkey")]
                                               for r in (rc_install.statement(w, f"SHOW GRANTS ON CATALOG `{c}`") or []) if isinstance(r, dict))
    for s in SCHEMAS:
        cat, sch = s.split(".")
        out["grants"][f"schema:{s}"] = sorted([r.get("principal"), r.get("actiontype"), r.get("objecttype"), r.get("objectkey")]
                                              for r in (rc_install.statement(w, f"SHOW GRANTS ON SCHEMA `{cat}`.`{sch}`") or []) if isinstance(r, dict))
    proj = api(w, f"/api/2.0/postgres/projects/{LAKEBASE_PROJECT}")
    out["lakebase"]["project"] = proj if isinstance(proj, str) else {k: proj.get(k) for k in ("name", "uid", "spec", "update_time", "delete_time")}
    cat = api(w, f"/api/2.0/postgres/catalogs/{LAKEBASE_CATALOG}")
    out["lakebase"]["catalog"] = cat if isinstance(cat, str) else {k: cat.get(k) for k in ("name", "spec", "uid", "update_time")}
    try:
        own = w.apps.get(OWN_APP)
        out["own_sp"] = [own.service_principal_client_id, own.service_principal_name]
    except Exception:
        out["own_sp"] = []
    json.dump(out, open(path, "w"), indent=1, default=str)
    print(f"isolation snapshot {path}: {len(out['apps'])} watched Apps, {sum(len(v) for v in out['trees'].values() if isinstance(v, list))} asset files, "
          f"own SP {out['own_sp'] or 'none yet'}")


def diff(before_path, after_path):
    before, after = json.load(open(before_path)), json.load(open(after_path))
    own = {x for x in after.get("own_sp") or [] if x}
    own |= {OWN_APP, f"{OWN_APP}-sp"}
    problems, allowed, others = [], [], []

    def errored(key, b, a):
        if isinstance(b, str) or isinstance(a, str):
            if b != a:
                problems.append(f"{key}: {b if isinstance(b, str) else 'ok'} -> {a if isinstance(a, str) else 'ok'}")
            return True
        return False

    def principal_rows(key, b, a):
        if errored(key, b, a):
            return
        bs, as_ = {json.dumps(r) for r in b}, {json.dumps(r) for r in a}
        for r in sorted(bs - as_):
            problems.append(f"{key}: removed {r}")
        for r in sorted(as_ - bs):
            (allowed if json.loads(r)[0] in own else problems).append(f"{key}: added {r}")

    def path_rows(key, b, a):
        if errored(key, b, a):
            return
        bp, ap = {r[0]: r for r in b}, {r[0]: r for r in a}
        for p in sorted(bp):
            if p not in ap:
                problems.append(f"{key}: removed {p}")
            elif bp[p] != ap[p]:
                problems.append(f"{key}: changed {bp[p]} -> {ap[p]}")
        for p in sorted(set(ap) - set(bp)):
            (allowed if any(own_path in p for own_path in OWN_PATHS) else others).append(f"{key}: added {p}")

    def timeless(v):
        return {x: y for x, y in v.items() if x != "update_time"} if isinstance(v, dict) else v

    acl_b = {json.dumps(r) for r in before["acl"].get("lakebase_project") or [] if not isinstance(r, str)}
    acl_a = {json.dumps(r) for r in after["acl"].get("lakebase_project") or [] if not isinstance(r, str)}
    own_grant_only = acl_b < acl_a and all(json.loads(r)[0] in own for r in acl_a - acl_b)
    for section in ("apps", "lakebase"):
        for k in sorted(set(before[section]) | set(after[section])):
            b, a = before[section].get(k), after[section].get(k)
            if section == "lakebase" and k == "project" and b != a and timeless(b) == timeless(a) and own_grant_only:
                allowed.append(f"lakebase.project: update_time {b.get('update_time')} -> {a.get('update_time')} from the grant to {OWN_APP}'s service principal only")
                continue
            if b != a:
                problems.append(f"{section}.{k}: {json.dumps(before[section].get(k))[:300]} -> {json.dumps(after[section].get(k))[:300]}")
    for section, check in (("folders", path_rows), ("trees", path_rows), ("acl", principal_rows), ("grants", principal_rows)):
        for k in sorted(set(before[section]) | set(after[section])):
            check(f"{section}.{k}", before[section].get(k, []), after[section].get(k, []))
    for line in allowed:
        print(f"ALLOWED {line}")
    for line in others:
        print(f"NOT MINE {line}")
    for line in problems:
        print(f"CHANGED {line}")
    print(f"isolation diff: {len(problems)} change(s) to what {', '.join(WATCHED_APPS)} use, {len(allowed)} addition(s) for {OWN_APP} only, "
          f"{len(others)} addition(s) by others")
    return 1 if problems else 0


if __name__ == "__main__":
    if sys.argv[1] == "snapshot":
        snapshot(sys.argv[2])
    else:
        sys.exit(diff(sys.argv[2], sys.argv[3]))
