"""Pull v1.0.0 use-case dumps from __inspire_usecases into local JSON.

Reads run_logs/v100_swarm/manifest.json to discover the 4 session_ids,
queries `<catalog>.<schema>.__inspire_usecases` for each,
and writes `run_logs/v100_swarm/<corpus>_v100.json` per corpus.

Environment variables:
    DATABRICKS_CONFIG_PROFILE — CLI profile (default: DEFAULT)
    INSPIRE_DB                — <catalog>.<schema> for inspire_database
    INSPIRE_WAREHOUSE         — SQL warehouse id (auto-resolved if unset)
"""

from __future__ import annotations

import csv
import io
import json
import os
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
MANIFEST = REPO / "run_logs" / "v100_swarm" / "manifest.json"

WAREHOUSE_ID = os.environ.get("INSPIRE_WAREHOUSE", "")
INSPIRE_DB = os.environ.get("INSPIRE_DB", "main._inspire_v100_e2e")
PROFILE = os.environ.get("DATABRICKS_CONFIG_PROFILE", "DEFAULT")


def _api(method: str, path: str, body: dict | None = None) -> dict:
    args = ["databricks", "api", method, path]
    if body is not None:
        args.extend(["--json", json.dumps(body)])
    r = subprocess.run(
        args,
        capture_output=True,
        text=True,
        env={**os.environ, "DATABRICKS_CONFIG_PROFILE": PROFILE},
    )
    if r.returncode != 0:
        raise RuntimeError(f"{method} {path} failed: {r.stderr}")
    return json.loads(r.stdout) if r.stdout.strip() else {}


def _list_warehouses() -> list[dict]:
    return _api("get", "/api/2.0/sql/warehouses").get("warehouses", [])


def _resolve_warehouse() -> str:
    if WAREHOUSE_ID:
        return WAREHOUSE_ID
    warehouses = _list_warehouses()
    running = [w for w in warehouses if w.get("state") == "RUNNING"]
    for pool in (running, warehouses):
        for w in pool:
            wid = w.get("id")
            if wid:
                return wid
    raise RuntimeError("No SQL warehouse available; set INSPIRE_WAREHOUSE.")


def _run_sql(warehouse_id: str, sql: str) -> dict:
    payload = {"warehouse_id": warehouse_id, "statement": sql, "wait_timeout": "45s"}
    resp = _api("post", "/api/2.0/sql/statements", payload)
    while resp.get("status", {}).get("state") in ("PENDING", "RUNNING"):
        time.sleep(3.0)
        resp = _api("get", f"/api/2.0/sql/statements/{resp['statement_id']}")
    if resp.get("status", {}).get("state") != "SUCCEEDED":
        raise RuntimeError(f"SQL failed: {resp.get('status')}")
    return resp


def _rows_to_dicts(resp: dict) -> list[dict]:
    cols = [c["name"] for c in resp["manifest"]["schema"]["columns"]]
    rows = resp.get("result", {}).get("data_array", []) or []
    return [dict(zip(cols, row)) for row in rows]


def dump_corpus(warehouse_id: str, corpus: str, session_id: str, out_path: Path) -> int:
    sql = (
        f"SELECT id, business_domain, subdomain, use_case, statement, solution, "
        f"business_value, sponsor, beneficiary, primary_table, tables_involved, "
        f"analytics_technique, priority_score, bob_score, idea_theme, has_genie_code "
        f"FROM {INSPIRE_DB}.__inspire_usecases "
        f"WHERE session_id = {session_id}"
    )
    resp = _run_sql(warehouse_id, sql)
    rows = _rows_to_dicts(resp)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        json.dump({"corpus": corpus, "session_id": session_id, "use_cases": rows}, f, indent=2)
    return len(rows)


def main() -> int:
    if not MANIFEST.exists():
        print(f"manifest missing: {MANIFEST}", file=sys.stderr)
        return 2
    manifest = json.loads(MANIFEST.read_text())
    warehouse_id = _resolve_warehouse()
    out_root = REPO / "run_logs" / "v100_swarm"
    for run in manifest["runs"]:
        corpus = run["corpus"]
        sid = run["session_id"]
        out_path = out_root / f"{corpus}_v100.json"
        n = dump_corpus(warehouse_id, corpus, sid, out_path)
        print(f"[pull] {corpus} sid={sid} rows={n} -> {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
