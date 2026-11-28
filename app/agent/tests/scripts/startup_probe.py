"""Cold-start probe (R1.3): submit N serverless one-task runs of a 1-cell no-op notebook and record startup times.

Usage:
    python3 tests/scripts/startup_probe.py --profile P --notebook-path /Workspace/path/probe --n 20 --out <dir>

Writes <out>/startup.jsonl (one row per run) and <out>/startup_summary.json (P50/P95/max, nearest-rank).
The environment spec matches the Inspire job (app/backend/lib/inspireJobParams.js: key Default, version 4).
"""
from __future__ import annotations

import argparse
import base64
import json
import math
import os
import sys
import time
import uuid

ENVIRONMENT_KEY = "Default"
ENVIRONMENT_VERSION = "4"
POLL_SLEEP_S = 30
PROBE_SOURCE = "# Databricks notebook source\nimport time\ndbutils.notebook.exit(str(time.time()))\n"


def nearest_rank(values, pct):
    vals = sorted(values)
    if not vals:
        return None
    return vals[max(0, math.ceil(pct / 100.0 * len(vals)) - 1)]


def summarise_startup(rows):
    ok = [r["startup_s"] for r in rows if r.get("state") == "ok" and r.get("startup_s") is not None]
    return {
        "ok": len(ok),
        "failed": sum(1 for r in rows if r.get("state") != "ok"),
        "p50_s": nearest_rank(ok, 50),
        "p95_s": nearest_rank(ok, 95),
        "max_s": max(ok) if ok else None,
    }


def _upload_probe(ws, notebook_path):
    from databricks.sdk.service.workspace import ImportFormat, Language

    ws.workspace.mkdirs(os.path.dirname(notebook_path) or "/")
    ws.workspace.upload(notebook_path, PROBE_SOURCE.encode(), format=ImportFormat.SOURCE, language=Language.PYTHON, overwrite=True)


def _submit(ws, notebook_path, run_name):
    from databricks.sdk.service import compute, jobs

    wait = ws.jobs.submit(
        run_name=run_name,
        tasks=[jobs.SubmitTask(
            task_key="probe",
            notebook_task=jobs.NotebookTask(notebook_path=notebook_path),
            environment_key=ENVIRONMENT_KEY,
        )],
        environments=[jobs.JobEnvironment(
            environment_key=ENVIRONMENT_KEY,
            spec=compute.Environment(environment_version=ENVIRONMENT_VERSION),
        )],
    )
    return wait.run_id


def run_probe(ws, notebook_path, n, out, sleep=time.sleep, clock=time.time):
    os.makedirs(out, exist_ok=True)
    _upload_probe(ws, notebook_path)
    tag = uuid.uuid4().hex[:8]
    pending = {}
    for i in range(n):
        submitted = clock()
        run_id = _submit(ws, notebook_path, f"startup_probe_{tag}_{i:02d}")
        pending[run_id] = submitted
    rows = []
    while pending:
        for run_id in list(pending):
            run = ws.jobs.get_run(run_id)
            life = str(getattr(run.state, "life_cycle_state", ""))
            if "TERMINATED" not in life and "INTERNAL_ERROR" not in life and "SKIPPED" not in life:
                continue
            submitted = pending.pop(run_id)
            row = {
                "run_id": run_id,
                "submitted_at": submitted,
                "started_at": (run.start_time or 0) / 1000.0 or None,
                "ended_at": (run.end_time or 0) / 1000.0 or None,
                "first_cell_at": None,
                "startup_s": None,
                "state": "failed",
            }
            if "SUCCESS" in str(getattr(run.state, "result_state", "")):
                try:
                    out_ = ws.jobs.get_run_output(run.tasks[0].run_id)
                    row["first_cell_at"] = float(out_.notebook_output.result)
                    row["startup_s"] = row["first_cell_at"] - submitted
                    row["state"] = "ok"
                except Exception as e:  # noqa: BLE001
                    row["error"] = str(e)[:200]
            rows.append(row)
        if pending:
            sleep(POLL_SLEEP_S)
    with open(os.path.join(out, "startup.jsonl"), "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    summary = summarise_startup(rows)
    with open(os.path.join(out, "startup_summary.json"), "w") as f:
        json.dump(summary, f, indent=2)
    return summary


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--profile", required=True)
    p.add_argument("--notebook-path", required=True)
    p.add_argument("--n", type=int, default=20)
    p.add_argument("--out", required=True)
    a = p.parse_args(argv)
    from databricks.sdk import WorkspaceClient

    summary = run_probe(WorkspaceClient(profile=a.profile), a.notebook_path, a.n, a.out)
    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    sys.exit(main())
