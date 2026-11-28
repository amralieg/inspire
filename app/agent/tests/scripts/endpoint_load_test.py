"""Endpoint load test (R1.4): find the highest safe concurrency for a serving endpoint.

Usage:
    python3 tests/scripts/endpoint_load_test.py --profile P --endpoint E --levels 4,8,16 --minutes 15 --out <dir>

Writes <out>/load.jsonl (one row per call) and <out>/load_summary.json. The chosen level is the highest level with
rate-limit errors < 2% and P95 latency < 1.5 x the single-call P50.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

MAX_RATE_LIMIT_PCT = 2.0
MAX_P95_RATIO = 1.5
PROMPT = "Reply with the single word: ok"
GATEWAY_MESSAGES_PATH = "/ai-gateway/anthropic/v1/messages"


def nearest_rank(values, pct):
    vals = sorted(values)
    if not vals:
        return None
    return vals[max(0, math.ceil(pct / 100.0 * len(vals)) - 1)]


def choose_level(stats):
    """stats: {level: {"rate_limit_pct", "p95_ratio"}}. Returns (level, reason); level 0 when none passes."""
    best, why = 0, []
    for level in sorted(stats):
        s = stats[level]
        rate_ok = s["rate_limit_pct"] < MAX_RATE_LIMIT_PCT
        p95_ok = s["p95_ratio"] < MAX_P95_RATIO
        if rate_ok and p95_ok:
            best = level
        else:
            why.append(f"level {level}: rate-limit {s['rate_limit_pct']}% (limit {MAX_RATE_LIMIT_PCT}%), "
                       f"P95 {s['p95_ratio']}x single-call P50 (limit {MAX_P95_RATIO}x)")
    if best:
        return best, f"level {best} is the highest with rate-limit < {MAX_RATE_LIMIT_PCT}% and P95 < {MAX_P95_RATIO}x"
    return 0, "no level passed: " + "; ".join(why)


def _is_rate_limited(e):
    from databricks.sdk.errors import TooManyRequests

    return isinstance(e, TooManyRequests) or "429" in str(e) or "rate limit" in str(e).lower() \
        or "REQUEST_LIMIT_EXCEEDED" in str(e)


def run_level(call, level, duration_s, max_calls=None, single_p50_ms=None, sink=None):
    """Run `level` workers calling `call()` until duration_s elapses (or max_calls total); return stats."""
    lock = threading.Lock()
    started = [0]
    rows = []
    deadline = time.time() + duration_s

    def worker():
        while time.time() < deadline:
            with lock:
                if max_calls is not None and started[0] >= max_calls:
                    return
                started[0] += 1
            t0 = time.time()
            status, limited = "ok", False
            try:
                call()
            except Exception as e:  # noqa: BLE001
                limited = _is_rate_limited(e)
                status = "rate_limited" if limited else "error"
            row = {"level": level, "latency_ms": (time.time() - t0) * 1000.0, "status": status, "rate_limited": limited}
            with lock:
                rows.append(row)
            if sink:
                sink(row)

    with ThreadPoolExecutor(max_workers=level) as ex:
        for _ in range(level):
            ex.submit(worker)
    lat = [r["latency_ms"] for r in rows if r["status"] == "ok"]
    p95 = nearest_rank(lat, 95)
    limited = sum(1 for r in rows if r["rate_limited"])
    return {
        "level": level,
        "calls": len(rows),
        "rate_limit_errors": limited,
        "rate_limit_pct": round(100.0 * limited / len(rows), 2) if rows else 0.0,
        "other_errors": sum(1 for r in rows if r["status"] == "error"),
        "p50_ms": nearest_rank(lat, 50),
        "p95_ms": p95,
        "p95_ratio": round(p95 / single_p50_ms, 2) if (p95 and single_p50_ms) else 0.0,
    }


def make_call(ws, endpoint, route="gateway"):
    """Return a zero-arg callable that issues one tiny completion over `route` (gateway or serving)."""
    if route == "serving":
        from databricks.sdk.service.serving import ChatMessage, ChatMessageRole

        def call():
            ws.serving_endpoints.query(name=endpoint, messages=[ChatMessage(role=ChatMessageRole.USER, content=PROMPT)], max_tokens=8)
    elif route == "gateway":
        def call():
            ws.api_client.do("POST", GATEWAY_MESSAGES_PATH, body={
                "model": endpoint, "max_tokens": 8, "messages": [{"role": "user", "content": PROMPT}]})
    else:
        raise ValueError(f"unknown route {route!r}")
    return call


def run_load(ws, endpoint, levels, minutes, out, single_calls=5, route="gateway"):
    os.makedirs(out, exist_ok=True)
    call = make_call(ws, endpoint, route)

    singles = []
    for _ in range(single_calls):
        t0 = time.time()
        call()
        singles.append((time.time() - t0) * 1000.0)
    p50 = nearest_rank(singles, 50)
    stats = {}
    with open(os.path.join(out, "load.jsonl"), "w") as f:
        lock = threading.Lock()

        def sink(row):
            with lock:
                f.write(json.dumps(row) + "\n")

        for level in levels:
            stats[level] = run_level(call, level, minutes * 60, single_p50_ms=p50, sink=sink)
    chosen, reason = choose_level(stats)
    summary = {"endpoint": endpoint, "route": route, "single_call_p50_ms": p50, "levels": stats, "chosen_level": chosen, "reason": reason}
    with open(os.path.join(out, "load_summary.json"), "w") as f:
        json.dump(summary, f, indent=2)
    return summary


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--profile", required=True)
    p.add_argument("--endpoint", required=True)
    p.add_argument("--levels", default="4,8,16")
    p.add_argument("--minutes", type=float, default=15)
    p.add_argument("--route", choices=("serving", "gateway"), default="gateway")
    p.add_argument("--out", required=True)
    a = p.parse_args(argv)
    from databricks.sdk import WorkspaceClient

    levels = [int(x) for x in a.levels.split(",") if x.strip()]
    print(json.dumps(run_load(WorkspaceClient(profile=a.profile), a.endpoint, levels, a.minutes, a.out, route=a.route)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
