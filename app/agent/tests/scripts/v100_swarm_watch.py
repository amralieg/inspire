#!/usr/bin/env python3
"""v1.0.0 swarm watcher.

Reads run_logs/v100_swarm/manifest.json, polls Databricks for each run every
POLL_SEC (default 600 = 10 min per section 9.3), appends a timestamped compact
status line per run to /tmp/v100_swarm_state.txt, and exits 0 when all runs
are terminal + SUCCESS, or 2 if any non-SUCCESS terminal state is reached.

Per section 9.3, ALSO tails each session's volume log every cycle for
ERROR|Traceback|PermissionError|ConcurrentAppendException|Zero batches
signals and surfaces the last matching line inline.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
MANIFEST = REPO / "run_logs" / "v100_swarm" / "manifest.json"
STATE_LOG = Path("/tmp/v100_swarm_state.txt")
PROFILE = os.environ.get("DATABRICKS_CONFIG_PROFILE", "DEFAULT")
POLL_SEC = int(os.environ.get("POLL_SEC", "600"))
_INSPIRE_CATALOG = os.environ.get("INSPIRE_TEST_CATALOG", "main._inspire_v100_e2e")
_VOL_CAT, _VOL_SCH = _INSPIRE_CATALOG.split(".", 1) if "." in _INSPIRE_CATALOG else (_INSPIRE_CATALOG, "_inspire")
VOLUME_LOG_ROOT = f"dbfs:/Volumes/{_VOL_CAT}/{_VOL_SCH}/vol_root/logs"

ERROR_SIGNALS = (
    "ERROR",
    "Traceback",
    "PermissionError",
    "ConcurrentAppendException",
    "Zero batches",
    "ended_error",
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _log(line: str) -> None:
    with STATE_LOG.open("a") as f:
        f.write(line.rstrip("\n") + "\n")


def _get_state(run_id: int) -> tuple[str, str, float]:
    r = subprocess.run(
        ["databricks", "jobs", "get-run", str(run_id), "--profile", PROFILE],
        capture_output=True,
        text=True,
        timeout=90,
    )
    if r.returncode != 0:
        return ("CLI_ERROR", r.stderr.strip()[:80], 0.0)
    try:
        d = json.loads(r.stdout)
    except json.JSONDecodeError:
        return ("PARSE_ERROR", r.stdout[:80], 0.0)
    s = d.get("state", {})
    lcs = s.get("life_cycle_state", "?")
    rs = s.get("result_state", "")
    dur_ms = d.get("run_duration") or d.get("execution_duration") or 0
    return (lcs, rs, round(dur_ms / 60000, 1))


def _tail_error(session_id: str, biz_name: str) -> str:
    biz_sanitized = biz_name  # already sanitized to alnum/_-.
    log_path = f"{VOLUME_LOG_ROOT}/{biz_sanitized}/session_{session_id}/log.log"
    r = subprocess.run(
        ["databricks", "fs", "cat", log_path, "--profile", PROFILE],
        capture_output=True,
        text=True,
        timeout=90,
    )
    if r.returncode != 0:
        return ""
    last_match = ""
    for ln in r.stdout.splitlines():
        for sig in ERROR_SIGNALS:
            if sig in ln:
                last_match = ln[:220]
                break
    return last_match


def main() -> int:
    manifest = json.loads(MANIFEST.read_text())
    runs = manifest["runs"]
    STATE_LOG.write_text(
        f"watcher_pid={os.getpid()} started_at={_now()}\n"
        f"manifest={MANIFEST}\nprofile={PROFILE}\n"
        f"poll_sec={POLL_SEC}\nn_runs={len(runs)}\n"
    )
    for r in runs:
        _log(
            f"  seed: {r['version']} {r['corpus']} "
            f"run_id={r['run_id']} sid={r['session_id']}"
        )

    cycle = 0
    while True:
        cycle += 1
        _log("---")
        _log(f"cycle={cycle} time={_now()}")
        remaining = 0
        nonsuccess = 0
        for r in runs:
            rid = int(r["run_id"])
            lcs, rs, dur = _get_state(rid)
            _log(
                f"  {r['version']:4s} {r['corpus']:14s} {rid:<18d} "
                f"{lcs:12s} {rs:10s} {dur:>6.1f} min"
            )
            err_line = _tail_error(r["session_id"], r["business_name"])
            if err_line:
                _log(f"    error: {err_line}")
            terminal = lcs in ("TERMINATED", "SKIPPED", "INTERNAL_ERROR")
            if terminal:
                if rs != "SUCCESS":
                    nonsuccess += 1
            else:
                remaining += 1
        _log(f"remaining={remaining} nonsuccess={nonsuccess}")
        if remaining == 0:
            _log(f"watcher_done_at={_now()}")
            return 2 if nonsuccess > 0 else 0
        time.sleep(POLL_SEC)


if __name__ == "__main__":
    sys.exit(main())
