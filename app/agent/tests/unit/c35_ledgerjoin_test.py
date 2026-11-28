"""R1.2: critical_path_report joins the step ledger (Contract 1) to billing and query history, offline from fixture rows."""
import json
import os
import subprocess
import sys

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts", "critical_path_report.py")
T0 = 1_700_000_000


def row(step, start, end, run="run1", **kw):
    r = {"session_id": 7, "job_run_id": run, "stage": "s", "step": step, "started_at": T0 + start, "ended_at": T0 + end,
         "duration_ms": (end - start) * 1000, "status": "ok", "models": "m", "llm_calls": 1, "tokens_in": 10,
         "tokens_out": 5, "tokens_estimated": False, "retries": 0, "rate_limit_errors": 0, "candidates_in": 0,
         "candidates_out": 0, "sql_statements": 0, "sql_ms": 0, "flags_json": "{}"}
    r.update(kw)
    return r


def run_script(tmp_path, fixture, *extra):
    fx = tmp_path / "fx.json"
    fx.write_text(json.dumps(fixture))
    out = tmp_path / "out"
    p = subprocess.run([sys.executable, SCRIPT, "--profile", "P", "--inspire-db", "c.s", "--session-id", "7",
                        "--fixture", str(fx), "--out", str(out), *extra], capture_output=True, text=True)
    return p, out


def report(out):
    return json.loads((out / "report.json").read_text()), (out / "report.md").read_text()


def base(**kw):
    fx = {"ledger": [row("A", 0, 10), row("B", 2, 8), row("C", 10, 20)], "steps": ["A", "B", "C"], "billing": [], "queries": []}
    fx.update(kw)
    return fx


def test_critical_path_parallel_step_off_path(tmp_path):
    p, out = run_script(tmp_path, base())
    assert p.returncode == 0, p.stderr
    rep, _ = report(out)
    assert rep["critical_path"] == ["A", "C"]
    assert rep["wall_s"] == 20
    assert rep["off_path"] == ["B"]


def test_billing_join_cost_and_gap(tmp_path):
    fx = base(ledger=[row("A", 0, 10, run="r1"), row("C", 10, 20, run="r2"), row("D", 20, 25, run="r3")],
              steps=["A", "C", "D"],
              billing=[{"job_run_id": "r1", "usage_quantity": 2.0, "unit_price": 0.5},
                       {"job_run_id": "r1", "usage_quantity": 1.0, "unit_price": 1.0},
                       {"job_run_id": "r2", "usage_quantity": 4.0, "unit_price": 0.25}])
    p, out = run_script(tmp_path, fx)
    rep, _ = report(out)
    assert rep["cost_by_run"] == {"r1": 2.0, "r2": 1.0}
    assert rep["gaps"]["runs_without_billing"] == ["r3"]


def test_step_missing_from_ledger_is_a_gap(tmp_path):
    p, out = run_script(tmp_path, base(steps=["A", "B", "C", "Ghost"]))
    rep, _ = report(out)
    assert rep["gaps"]["steps_missing_from_ledger"] == ["Ghost"]


def test_estimated_tokens_marked(tmp_path):
    fx = base(ledger=[row("A", 0, 10, tokens_estimated=True), row("B", 2, 8), row("C", 10, 20)])
    p, out = run_script(tmp_path, fx)
    _, md = report(out)
    line = [l for l in md.splitlines() if "| A |" in l][0]
    assert "estimated" in line
    assert "estimated" not in [l for l in md.splitlines() if "| B |" in l][0]


def test_missing_profile_exits_2(tmp_path):
    p = subprocess.run([sys.executable, SCRIPT, "--inspire-db", "c.s", "--session-id", "7", "--out", str(tmp_path)],
                       capture_output=True, text=True)
    assert p.returncode == 2
    assert "--profile" in p.stderr
