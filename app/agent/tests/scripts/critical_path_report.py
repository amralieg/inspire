"""Measured critical path of one Discover session: joins the step ledger (<inspire_db>.__inspire_step_ledger) to
system.billing.usage x system.billing.list_prices (on usage_metadata.job_run_id) and system.query.history (on
query_source.job_info.job_run_id, falling back to the step time window). Writes report.json and report.md.

    python3 tests/scripts/critical_path_report.py --profile P --inspire-db cat.schema --session-id N --out DIR
        [--warehouse-id W] [--fixture rows.json] [--budget-min M] [--submitted-at T]

--fixture replaces all warehouse reads with {"ledger": [...], "steps": [names], "billing": [{job_run_id,
usage_quantity, unit_price}], "queries": [{job_run_id, started_at, duration_ms}], "history_has_run_id": bool}.
Times are epoch seconds or ISO strings.
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone


def to_epoch(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).timestamp()


DOMAIN_STAGES = ("Domain Mapping", "Business Domain Clustering")


def milestones(ledger, budget_s, submitted_at=None):
    """Seconds from submission (else first ledger start) to the domain list, first valued card (Scoring) and the end."""
    rows = [(r.get("stage"), to_epoch(r.get("started_at")), to_epoch(r.get("ended_at")), r.get("status")) for r in ledger]
    starts = [s for _, s, _, _ in rows if s is not None]
    ends = [(st, e) for st, _, e, _ in rows if e is not None]
    t0 = to_epoch(submitted_at) if submitted_at is not None else (min(starts) if starts else None)

    def first(pred):
        v = [e for st, e in ends if pred(st)]
        return min(v) - t0 if v and t0 is not None else None
    final = max(e for _, e in ends) - t0 if ends and t0 is not None else None
    over = final is not None and budget_s is not None and final > budget_s
    flagged = any(str(r.get("status")).lower() == "partial" for r in ledger)
    reason = ("run exceeded the time budget" if over else "a ledger step ended partial") if over or flagged else None
    return {"domain_list_s": first(lambda st: st in DOMAIN_STAGES), "first_valued_card_s": first(lambda st: st == "Scoring"),
            "final_s": final, "budget_s": budget_s, "partial": bool(over or flagged), "partial_reason": reason}


def critical_path(steps):
    """Longest chain of non-overlapping steps by summed duration (parallel steps count once)."""
    order = sorted(steps, key=lambda s: (s["start"], s["end"]))
    best, prev = {}, {}
    for i, s in enumerate(order):
        best[i], prev[i] = s["end"] - s["start"], None
        for j in range(i):
            if order[j]["end"] <= s["start"] and best[j] + s["end"] - s["start"] > best[i]:
                best[i], prev[i] = best[j] + s["end"] - s["start"], j
    if not order:
        return []
    i = max(best, key=lambda k: best[k])
    path = []
    while i is not None:
        path.append(order[i]["step"])
        i = prev[i]
    return path[::-1]


def build_report(ledger, step_names, billing, queries, history_has_run_id=True, budget_s=None, submitted_at=None):
    rows = []
    for r in ledger:
        s, e = to_epoch(r["started_at"]), to_epoch(r["ended_at"])
        rows.append({"step": r["step"], "run": r.get("job_run_id"), "start": s, "end": e, "r": r})
    rows = [x for x in rows if x["start"] is not None and x["end"] is not None]
    wall = (max(x["end"] for x in rows) - min(x["start"] for x in rows)) if rows else 0
    path = critical_path(rows)
    runs = sorted({x["run"] for x in rows if x["run"]})
    cost_by_run = {}
    for b in billing:
        run = b["job_run_id"]
        cost_by_run[run] = round(cost_by_run.get(run, 0.0) + float(b["usage_quantity"]) * float(b["unit_price"]), 6)
    total_cost = sum(cost_by_run.values())
    steps_out = []
    for x in rows:
        r = x["r"]
        if history_has_run_id:
            qs = [q for q in queries if q.get("job_run_id") == x["run"] and x["start"] <= to_epoch(q["started_at"]) <= x["end"]]
        else:
            qs = [q for q in queries if x["start"] <= to_epoch(q["started_at"]) <= x["end"]]
        dur = x["end"] - x["start"]
        run_dur = sum(y["end"] - y["start"] for y in rows if y["run"] == x["run"]) or 1
        share = (cost_by_run.get(x["run"], 0.0) * dur / run_dur / total_cost) if total_cost else 0.0
        steps_out.append({
            "step": x["step"], "run": x["run"], "start": x["start"], "end": x["end"], "duration_s": dur,
            "on_critical_path": x["step"] in path, "llm_calls": r.get("llm_calls"),
            "tokens_in": r.get("tokens_in"), "tokens_out": r.get("tokens_out"),
            "tokens_estimated": str(r.get("tokens_estimated")).lower() == "true", "retries": r.get("retries"),
            "rate_limit_errors": r.get("rate_limit_errors"), "sql_ms": sum(int(q.get("duration_ms") or 0) for q in qs) if queries else r.get("sql_ms"),
            "sql_ms_ledger": r.get("sql_ms"), "cost_share": round(share, 4)})
    ledger_steps = {x["step"] for x in rows}
    rep = {"wall_s": wall, "critical_path": path, "off_path": [s["step"] for s in steps_out if not s["on_critical_path"]],
            "steps": steps_out, "cost_by_run": cost_by_run, "total_cost": total_cost,
            "sql_source": "query_history.job_run_id" if history_has_run_id else "step time window (query_source.job_info.job_run_id absent)",
            "gaps": {"steps_missing_from_ledger": [n for n in step_names if n not in ledger_steps],
                     "runs_without_billing": [r for r in runs if r not in cost_by_run]}}
    if budget_s is not None:
        rep["milestones"] = milestones(ledger, budget_s, submitted_at)
    return rep


def render_md(rep):
    L = [f"# Critical path report", "", f"Wall time {rep['wall_s']:g} s; critical path: {' -> '.join(rep['critical_path']) or 'none'}; "
         f"total cost {rep['total_cost']:g}; SQL time source: {rep['sql_source']}", "",
         "| Step | Duration s | Path | LLM calls | Tokens in/out | Retries | 429s | SQL ms | Cost share |", "|---|---|---|---|---|---|---|---|---|"]
    for s in rep["steps"]:
        tok = f"{s['tokens_in']}/{s['tokens_out']}" + (" estimated" if s["tokens_estimated"] else "")
        L.append(f"| {s['step']} | {s['duration_s']:g} | {'on' if s['on_critical_path'] else 'off'} | {s['llm_calls']} | {tok} | "
                 f"{s['retries']} | {s['rate_limit_errors']} | {s['sql_ms']} | {s['cost_share']:.1%} |")
    m = rep.get("milestones")
    if m:
        f = lambda v: "not reached" if v is None else f"{v:g}"
        L += ["", "## Milestones", "", "| Milestone | Seconds |", "|---|---|", f"| Domain list | {f(m['domain_list_s'])} |",
              f"| First valued card | {f(m['first_valued_card_s'])} |", f"| Final | {f(m['final_s'])} |", f"| Budget | {f(m['budget_s'])} |",
              "", f"Result: {'PARTIAL (' + m['partial_reason'] + ')' if m['partial'] else 'complete within budget'}"]
    g = rep["gaps"]
    L += ["", "## Gaps", f"- Steps in the step table with no ledger row: {', '.join(g['steps_missing_from_ledger']) or 'none'}",
          f"- Runs with no billing match: {', '.join(g['runs_without_billing']) or 'none'}", ""]
    return "\n".join(L)


def _sql(ws, warehouse, stmt):
    r = ws.statement_execution.execute_statement(statement=stmt, warehouse_id=warehouse, wait_timeout="50s")
    cols = [c.name for c in r.manifest.schema.columns]
    return [dict(zip(cols, row)) for row in (r.result.data_array or [])] if r.result else []


def fetch_live(a):
    from databricks.sdk import WorkspaceClient
    ws = WorkspaceClient(profile=a.profile)
    wh = a.warehouse_id or next(w.id for w in ws.warehouses.list())
    sid = int(a.session_id)
    ledger = _sql(ws, wh, f"SELECT * FROM {a.inspire_db}.__inspire_step_ledger WHERE session_id = {sid}")
    steps = [r["step_name"] for r in _sql(ws, wh, f"SELECT DISTINCT step_name FROM {a.inspire_db}.__inspire_step "
                                                  f"WHERE session_id = {sid} AND status IN ('Started','Complete')")]
    runs = ",".join(f"'{r}'" for r in sorted({r["job_run_id"] for r in ledger if r.get("job_run_id")})) or "''"
    billing = _sql(ws, wh, "SELECT u.usage_metadata.job_run_id AS job_run_id, u.usage_quantity AS usage_quantity, "
                           "p.pricing.default AS unit_price FROM system.billing.usage u JOIN system.billing.list_prices p "
                           "ON u.sku_name = p.sku_name AND u.usage_start_time >= p.price_start_time "
                           "AND (p.price_end_time IS NULL OR u.usage_start_time < p.price_end_time) "
                           f"WHERE u.usage_metadata.job_run_id IN ({runs})")
    try:
        queries = _sql(ws, wh, "SELECT query_source.job_info.job_run_id AS job_run_id, start_time AS started_at, "
                               f"total_duration_ms AS duration_ms FROM system.query.history WHERE query_source.job_info.job_run_id IN ({runs})")
        has = True
    except Exception:
        lo = min((str(r["started_at"]) for r in ledger), default="1970-01-01")
        hi = max((str(r["ended_at"]) for r in ledger), default="2100-01-01")
        queries = _sql(ws, wh, "SELECT start_time AS started_at, total_duration_ms AS duration_ms FROM system.query.history "
                               f"WHERE start_time BETWEEN '{lo}' AND '{hi}'")
        has = False
    return ledger, steps, billing, queries, has


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--profile", required=True)
    ap.add_argument("--inspire-db", required=True)
    ap.add_argument("--session-id", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--warehouse-id")
    ap.add_argument("--fixture")
    ap.add_argument("--budget-min", type=float)
    ap.add_argument("--submitted-at")
    a = ap.parse_args(argv)
    if a.fixture:
        fx = json.load(open(a.fixture))
        data = (fx["ledger"], fx.get("steps", []), fx.get("billing", []), fx.get("queries", []), fx.get("history_has_run_id", True))
    else:
        data = fetch_live(a)
    rep = build_report(*data, budget_s=a.budget_min * 60 if a.budget_min is not None else None, submitted_at=a.submitted_at)
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "report.json"), "w") as f:
        json.dump(rep, f, indent=2)
    with open(os.path.join(a.out, "report.md"), "w") as f:
        f.write(render_md(rep))
    return 0


if __name__ == "__main__":
    sys.exit(main())
