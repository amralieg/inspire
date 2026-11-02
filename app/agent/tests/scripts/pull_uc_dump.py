"""Pull all UCs from the v1.4.0 swarm __inspire_usecases table into a local CSV.

Usage:
    python3 tests/scripts/pull_uc_dump.py <session_id> <output_csv>

Uses the running warehouse and the <catalog>.<schema> catalog/schema.

Environment variables:
    DATABRICKS_CONFIG_PROFILE — CLI profile (default: DEFAULT)
    INSPIRE_DB                — <catalog>.<schema> for inspire_database
    INSPIRE_WAREHOUSE         — SQL warehouse id

Idempotent — re-running overwrites the CSV.
"""

from __future__ import annotations

import csv
import json
import os
import subprocess
import sys
import time
from pathlib import Path


WAREHOUSE_ID = os.environ.get("INSPIRE_WAREHOUSE", "")
INSPIRE_DB = os.environ.get("INSPIRE_DB", "main._inspire_v140")
PROFILE = os.environ.get("DATABRICKS_CONFIG_PROFILE", "DEFAULT")


def _run_sql(sql: str, wait_s: str = "45s", parameters: list | None = None) -> dict:
    body = {"warehouse_id": WAREHOUSE_ID, "statement": sql, "wait_timeout": wait_s}
    if parameters:
        body["parameters"] = parameters
    payload = json.dumps(body)
    result = subprocess.run(
        ["databricks", "api", "post", "/api/2.0/sql/statements", "--json", payload],
        capture_output=True, text=True, env={**os.environ, "DATABRICKS_CONFIG_PROFILE": PROFILE},
    )
    if result.returncode != 0:
        raise RuntimeError(f"SQL failed: {result.stderr}")
    return json.loads(result.stdout)


def _fetch_statement(statement_id: str) -> dict:
    result = subprocess.run(
        ["databricks", "api", "get", f"/api/2.0/sql/statements/{statement_id}"],
        capture_output=True, text=True, env={**os.environ, "DATABRICKS_CONFIG_PROFILE": PROFILE},
    )
    if result.returncode != 0:
        raise RuntimeError(f"SQL fetch failed: {result.stderr}")
    return json.loads(result.stdout)


def _wait_for_completion(statement_id: str, timeout_s: float = 300.0) -> dict:
    start = time.time()
    while time.time() - start < timeout_s:
        response = _fetch_statement(statement_id)
        state = response.get("status", {}).get("state")
        if state in ("SUCCEEDED", "FAILED", "CANCELED", "CLOSED"):
            return response
        time.sleep(3.0)
    raise TimeoutError(f"statement {statement_id} did not terminate within {timeout_s}s")


def query(sql: str, parameters: list | None = None, timeout_s: float = 300.0) -> tuple:
    """(column names, rows) of one statement; waits while the warehouse is still running it."""
    response = _run_sql(sql, parameters=parameters)
    if response.get("status", {}).get("state") in ("PENDING", "RUNNING"):
        response = _wait_for_completion(response["statement_id"], timeout_s)
    if response.get("status", {}).get("state") != "SUCCEEDED":
        raise RuntimeError(f"SQL not SUCCEEDED: {response.get('status')}")
    columns = [c["name"] for c in response["manifest"]["schema"]["columns"]]
    return columns, response.get("result", {}).get("data_array", []) or []


def _session_rows(session_id: str) -> tuple:
    return query(f"SELECT * FROM {INSPIRE_DB}.__inspire_usecases WHERE session_id = :sid",
                 parameters=[{"name": "sid", "value": str(int(session_id)), "type": "BIGINT"}])


def fetch_ucs(session_id: str) -> list:
    """Every __inspire_usecases row of one session, as dicts keyed by column name."""
    columns, rows = _session_rows(session_id)
    return [dict(zip(columns, row)) for row in rows]


def dump_ucs(session_id: str, out_csv: Path) -> int:
    """Return the number of rows written."""
    columns, rows = _session_rows(session_id)
    with out_csv.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(columns)
        writer.writerows(rows)
    return len(rows)


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__, file=sys.stderr)
        return 2
    session_id = sys.argv[1]
    out_csv = Path(sys.argv[2])
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    n = dump_ucs(session_id, out_csv)
    print(f"[pull_uc_dump] session_id={session_id} rows={n} -> {out_csv}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
