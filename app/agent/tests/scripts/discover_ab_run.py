"""R16.7 harness, run half: Discover OLD vs NEW x scopes x reps, then Match feeds.

Subcommands (all need --profile and --out):
  submit  --old-sha --new-sha --manifest --reps --inspire-db   submit Discover runs for both builds
  watch                                                         poll until every run is terminal
  pull    --inspire-db --warehouse                              dump steps/use cases/timing/cost/ledger (+ match reports)
  match   --build-sha --feed --manifest --inspire-db --warehouse  submit "Match Use Cases" for a feed

Results layout is Contract 3 (see briefs/c35_plan.md). No grading here. Reuses the swarm helpers
(session id minting, base widgets, row decoding) from v101_swarm_launch / v101_pull_ucs.
"""
from __future__ import annotations

import argparse
import base64
import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from v101_pull_ucs import _rows_to_dicts  # noqa: E402
from v101_swarm_launch import BASE_WIDGETS, _mint_session_id  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
NOTEBOOK_REPO_PATH = "app/agent/agent/dbx_inspire_ai_agent.ipynb"
TERMINAL = ("TERMINATED", "SKIPPED", "INTERNAL_ERROR")
POLL_SEC = 60
# manifest scope widget aliases -> notebook widget names (keys starting with a digit pass through)
ALIASES = {
    "business_context": "06_business_domains",
    "priorities": "07_business_priorities",
    "generation_instructions": "08_generation_instructions",
    "quality_mode": "05_use_cases_quality",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _q(v) -> str:
    return "'" + str(v).replace("\\", "\\\\").replace("'", "''") + "'"


def _git_show(sha: str, path: str) -> str:
    return subprocess.run(["git", "-C", str(REPO), "show", f"{sha}:{path}"], capture_output=True,
                          text=True, check=True).stdout


def _make_ws(profile: str):
    from databricks.sdk import WorkspaceClient
    return WorkspaceClient(profile=profile)


def _make_sql(ws, warehouse: str):
    def sql(statement: str) -> list[dict]:
        resp = ws.api_client.do("POST", "/api/2.0/sql/statements", body={
            "warehouse_id": warehouse, "statement": statement, "wait_timeout": "45s"})
        while resp.get("status", {}).get("state") in ("PENDING", "RUNNING"):
            time.sleep(3.0)
            resp = ws.api_client.do("GET", f"/api/2.0/sql/statements/{resp['statement_id']}")
        if resp.get("status", {}).get("state") != "SUCCEEDED":
            raise RuntimeError(f"SQL failed: {resp.get('status')}")
        return _rows_to_dicts(resp) if resp.get("manifest") else []
    return sql


def _scope_widgets(scope: dict) -> dict:
    return {(k if k[:1].isdigit() else ALIASES.get(k, k)): v for k, v in scope["widgets"].items()}


def _load_scopes(manifest: Path) -> list[dict]:
    return json.loads(Path(manifest).read_text())["scopes"]


def _import_notebook(ws, sha: str, directory: str, git_show) -> str:
    """Export the notebook at `sha`, import it under a path named by the short SHA, return the path."""
    content = git_show(sha, NOTEBOOK_REPO_PATH)
    path = f"{directory}/dbx_inspire_ai_agent_{sha[:9]}"
    ws.api_client.do("POST", "/api/2.0/workspace/import", body={
        "path": path, "format": "JUPYTER", "language": "PYTHON", "overwrite": True,
        "content": base64.b64encode(content.encode()).decode()})
    return path


def _submit_run(ws, run_name: str, notebook_path: str, params: dict) -> int:
    spec = {"run_name": run_name,
            "tasks": [{"task_key": "main", "notebook_task": {"notebook_path": notebook_path, "base_parameters": params},
                       "environment_key": "default"}],
            "environments": [{"environment_key": "default", "spec": {"client": "2"}}]}
    return int(ws.api_client.do("POST", "/api/2.1/jobs/runs/submit", body=spec)["run_id"])


def _workspace_dir(ws, args) -> str:
    return args.workspace_dir or f"/Users/{ws.current_user.me().user_name}/c35_ab"


def cmd_submit(ws, args, git_show) -> int:
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    scopes = _load_scopes(args.manifest)
    directory = _workspace_dir(ws, args)
    agents, runs = {}, []
    for agent, sha in (("OLD", args.old_sha), ("NEW", args.new_sha)):
        agents[agent] = {"sha": sha, "notebook_path": _import_notebook(ws, sha, directory, git_show)}
    for agent in ("OLD", "NEW"):
        for scope in scopes:
            for rep in range(1, args.reps + 1):
                sid = _mint_session_id()
                params = {**BASE_WIDGETS, **_scope_widgets(scope),
                          "02_inspire_database": args.inspire_db,
                          # per-run name and path so OLD/NEW never share a business-name lock or output folder
                          "00_business_name": f"ab_{agent.lower()}_{scope['id']}_{rep}",
                          "11_generation_path": f"{directory}/out/{agent}/{scope['id']}/{rep}",
                          "15_operation": "Discover Use Cases", "14_session_id": sid}
                rid = _submit_run(ws, f"c35_ab_{agent}_{scope['id']}_{rep}_{sid[:8]}",
                                  agents[agent]["notebook_path"], params)
                runs.append({"agent": agent, "scope": scope["id"], "rep": rep, "session_id": sid, "run_id": rid,
                             "state": "PENDING", "submitted_at": _now(), "ended_at": None})
                print(f"[submit] {agent} {scope['id']} rep={rep} run_id={rid} sid={sid}", flush=True)
    (out / "manifest.json").write_text(json.dumps({"agents": agents, "runs": runs}, indent=2))
    return 0


def cmd_watch(ws, args, sleep) -> int:
    out = Path(args.out)
    mpath = out / "manifest.json"
    while True:
        mani = json.loads(mpath.read_text())
        pending = 0
        for r in mani["runs"]:
            if r.get("state") not in TERMINAL:
                d = ws.api_client.do("GET", "/api/2.1/jobs/runs/get", query={"run_id": r["run_id"]})
                st = d.get("state", {})
                r["state"] = st.get("life_cycle_state", "?")
                r["result_state"] = st.get("result_state", "")
                if r["state"] in TERMINAL:
                    r["ended_at"] = _now()
            if r["state"] not in TERMINAL:
                pending += 1
        mpath.write_text(json.dumps(mani, indent=2))
        total = len(mani["runs"])
        line = " ".join(f"{r['agent']}/{r['scope']}/{r['rep']}={r['state']}" for r in mani["runs"])
        with (out / "status.txt").open("a") as f:
            f.write(f"{_now()} terminal={total - pending}/{total} {line}\n")
        if pending == 0:
            return 0
        sleep(POLL_SEC)


def _parse(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except ValueError:
            return {}
    return v if isinstance(v, dict) else {}


def _step_event_at(row: dict) -> str:
    return str(_parse(row.get("result_json")).get("event_at") or row.get("last_updated") or "")


def _has_value(row: dict) -> bool:
    return any(str(row.get(k) or "").strip() for k in ("business_value", "value_estimate"))


def _write(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, default=str))


def _pull_run(sql, db: str, run: dict, d: Path) -> None:
    sid = int(run["session_id"])
    steps = sorted(sql(
        f"SELECT session_id, step_id, last_updated, stage_name, step_name, sub_step_name, status, message, "
        f"CAST(result_json AS STRING) AS result_json FROM {db}.__inspire_step WHERE session_id = {sid}"),
        key=_step_event_at)
    for s in steps:
        s["event_at"] = _step_event_at(s)
    ucs = sql(f"SELECT * FROM {db}.__inspire_usecases WHERE session_id = {sid}")
    ucs = sorted(ucs, key=lambda u: str(u.get("event_at") or "")) if any(u.get("event_at") for u in ucs) else ucs
    valued = next((u.get("event_at") for u in ucs if _has_value(u)), None)
    _write(d / "steps.json", steps)
    _write(d / "usecases.json", ucs)
    _write(d / "shortlist.json", ucs[:20])
    _write(d / "timing.json", {"submitted_at": run.get("submitted_at"), "first_valued_card_at": valued,
                               "ended_at": run.get("ended_at")})
    try:
        ledger = sql(f"SELECT * FROM {db}.__inspire_step_ledger WHERE session_id = {sid} ORDER BY event_at")
    except Exception:
        ledger = None
    _write(d / "ledger.json", {"missing": True} if ledger is None else ledger)
    try:
        usage = sql("SELECT SUM(usage_quantity) AS dbus FROM system.billing.usage "
                    f"WHERE usage_metadata.job_run_id = '{run['run_id']}'")
        cost = {"dbus": (usage[0].get("dbus") if usage else None)}
        if ledger:
            for k in ("tokens_in", "tokens_out", "llm_calls"):
                cost[k] = sum(int(x.get(k) or 0) for x in ledger)
        if ledger is None and not usage:
            cost = {"missing": True}
    except Exception:
        cost = {"missing": True}
        if ledger:
            cost = {k: sum(int(x.get(k) or 0) for x in ledger) for k in ("tokens_in", "tokens_out", "llm_calls")}
    _write(d / "cost.json", cost)


def cmd_pull(args, sql) -> int:
    out = Path(args.out)
    mani = json.loads((out / "manifest.json").read_text())
    for run in mani["runs"]:
        _pull_run(sql, args.inspire_db, run, out / "runs" / run["agent"] / run["scope"] / str(run["rep"]))
        print(f"[pull] {run['agent']} {run['scope']} rep={run['rep']}", flush=True)
    for inp in sorted((out / "match").glob("*/*/input.json")) if (out / "match").exists() else []:
        sid = json.loads(inp.read_text())["session_id"]
        rows = sql(f"SELECT * FROM {args.inspire_db}.__inspire_match WHERE session_id = {_q(sid)} ORDER BY input_no")
        for r in rows:
            r["report"] = _parse(r.get("report_json"))
        _write(inp.parent / "report.json", rows)
        print(f"[pull] match {inp.parent.parent.name}/{inp.parent.name} rows={len(rows)}", flush=True)
    return 0


def _feed_rows(args, out: Path, scope: dict, manifest: Path) -> list[dict]:
    if args.feed == "answer_key":
        key = None
        for base in (manifest.parent.parent, manifest.parent):
            cand = base / scope["answer_key"]
            if cand.exists():
                key = cand
                break
        if key is None:
            raise FileNotFoundError(f"answer key for {scope['id']}: {scope['answer_key']}")
        items = json.loads(key.read_text())["items"]
        return [{"name": i["name"], "description": i["statement"]} for i in items]
    agent = "OLD" if args.feed == "old_top20" else "NEW"
    short = json.loads((out / "runs" / agent / scope["id"] / "1" / "shortlist.json").read_text())
    return [{"name": u.get("use_case") or u.get("name"), "description": u.get("statement") or ""} for u in short]


def cmd_match(ws, args, sql, git_show) -> int:
    if "Match Use Cases" not in git_show(args.build_sha, NOTEBOOK_REPO_PATH):
        print(f"refusing {args.build_sha}: notebook has no 'Match Use Cases' (use a build that contains Match)",
              file=sys.stderr)
        return 3
    out, manifest = Path(args.out), Path(args.manifest)
    path = _import_notebook(ws, args.build_sha, _workspace_dir(ws, args), git_show)
    for scope in _load_scopes(manifest):
        rows = _feed_rows(args, out, scope, manifest)
        sid = _mint_session_id()
        values = ",\n".join(f"({_q(sid)}, {i}, {_q(r['name'])}, {_q(r['description'])}, current_timestamp())"
                            for i, r in enumerate(rows, 1))
        sql(f"INSERT INTO {args.inspire_db}.__inspire_match_input (session_id, input_no, name, description, event_at) "
            f"VALUES\n{values}")
        params = {**BASE_WIDGETS, **_scope_widgets(scope), "02_inspire_database": args.inspire_db,
                  "00_business_name": f"ab_match_{args.feed}_{scope['id']}",
                  "11_generation_path": f"{_workspace_dir(ws, args)}/out/match/{args.feed}/{scope['id']}",
                  "15_operation": "Match Use Cases", "19_match_phase": "match", "14_session_id": sid}
        rid = _submit_run(ws, f"c35_ab_match_{args.feed}_{scope['id']}_{sid[:8]}", path, params)
        _write(out / "match" / args.feed / scope["id"] / "input.json",
               {"session_id": sid, "run_id": rid, "build_sha": args.build_sha, "rows": rows})
        print(f"[match] {args.feed} {scope['id']} run_id={rid} sid={sid} inputs={len(rows)}", flush=True)
    return 0


def main(argv=None, ws=None, sql=None, git_show=_git_show, sleep=time.sleep) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p):
        p.add_argument("--profile", required=True)
        p.add_argument("--out", required=True)
        p.add_argument("--inspire-db", default=None, help="<catalog>.<schema>")
        p.add_argument("--warehouse", default=None)
        p.add_argument("--workspace-dir", default=None)
    s = sub.add_parser("submit"); common(s)
    s.add_argument("--old-sha", required=True); s.add_argument("--new-sha", required=True)
    s.add_argument("--manifest", required=True); s.add_argument("--reps", type=int, default=3)
    common(sub.add_parser("watch"))
    common(sub.add_parser("pull"))
    m = sub.add_parser("match"); common(m)
    m.add_argument("--build-sha", required=True); m.add_argument("--manifest", required=True)
    m.add_argument("--feed", required=True, choices=["old_top20", "new_top20", "answer_key"])
    args = ap.parse_args(argv)
    if args.cmd in ("submit", "match", "pull") and not args.inspire_db:
        ap.error("--inspire-db is required")
    ws = ws or _make_ws(args.profile)
    if args.cmd in ("pull", "match") and sql is None:
        if not args.warehouse:
            ap.error("--warehouse is required")
        sql = _make_sql(ws, args.warehouse)
    if args.cmd == "submit":
        return cmd_submit(ws, args, git_show)
    if args.cmd == "watch":
        return cmd_watch(ws, args, sleep)
    if args.cmd == "pull":
        return cmd_pull(args, sql)
    return cmd_match(ws, args, sql, git_show)


if __name__ == "__main__":
    sys.exit(main())
