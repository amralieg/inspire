"""c35_loadtests (R1.3, R1.4): cold-start probe and endpoint load test scripts, tested offline with fake clients."""
import json
import os
import sys
import threading
import types

import pytest

SCRIPTS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts")
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)

import endpoint_load_test as elt  # noqa: E402
import startup_probe as sp  # noqa: E402


def test_choose_level_picks_highest_passing_level():
    stats = {
        4: {"rate_limit_pct": 0.0, "p95_ratio": 1.2},
        8: {"rate_limit_pct": 1.9, "p95_ratio": 1.4},
        16: {"rate_limit_pct": 3.0, "p95_ratio": 1.3},
    }
    level, _reason = elt.choose_level(stats)
    assert level == 8


def test_choose_level_all_failing_returns_zero_with_reason():
    stats = {
        4: {"rate_limit_pct": 5.0, "p95_ratio": 1.2},
        8: {"rate_limit_pct": 0.0, "p95_ratio": 2.0},
    }
    level, reason = elt.choose_level(stats)
    assert level == 0
    assert "rate" in reason and "P95" in reason


def test_summarise_startup_nearest_rank_and_failed_counted_separately():
    rows = [{"run_id": i, "state": "ok", "startup_s": float(i)} for i in range(1, 21)]
    rows += [{"run_id": 99, "state": "failed", "startup_s": None}, {"run_id": 98, "state": "failed", "startup_s": None}]
    s = sp.summarise_startup(rows)
    assert (s["p50_s"], s["p95_s"], s["max_s"]) == (10.0, 19.0, 20.0)
    assert s["ok"] == 20 and s["failed"] == 2


class _Run:
    def __init__(self, run_id):
        self.run_id = run_id


class _FakeWs:
    def __init__(self):
        self.submits = []
        self.uploads = []
        ws = self
        self.workspace = types.SimpleNamespace(upload=lambda path, content, **kw: ws.uploads.append(path), mkdirs=lambda p: None)

        def submit(**kw):
            ws.submits.append(kw)
            return _Run(1000 + len(ws.submits))

        def get_run(run_id):
            task = types.SimpleNamespace(run_id=run_id + 5000)
            state = types.SimpleNamespace(life_cycle_state="TERMINATED", result_state="SUCCESS")
            return types.SimpleNamespace(run_id=run_id, state=state, tasks=[task], start_time=run_id * 10 + 3000, end_time=run_id * 10 + 9000)

        def get_run_output(run_id):
            return types.SimpleNamespace(notebook_output=types.SimpleNamespace(result=str(5.0)))

        self.jobs = types.SimpleNamespace(submit=submit, get_run=get_run, get_run_output=get_run_output)


def test_startup_probe_submits_n_fresh_named_runs_and_writes_n_lines(tmp_path):
    ws = _FakeWs()
    sp.run_probe(ws, "/Shared/probe_nb", 5, str(tmp_path), sleep=lambda s: None)
    assert len(ws.submits) == 5
    names = [s["run_name"] for s in ws.submits]
    assert len(set(names)) == 5
    lines = (tmp_path / "startup.jsonl").read_text().strip().splitlines()
    assert len(lines) == 5
    assert (tmp_path / "startup_summary.json").exists()


def test_load_level_reports_every_tenth_call_rate_limited():
    from databricks.sdk.errors import TooManyRequests

    lock = threading.Lock()
    count = [0]

    def call():
        with lock:
            count[0] += 1
            n = count[0]
        if n % 10 == 0:
            raise TooManyRequests("slow down")
        return "ok"

    stats = elt.run_level(call, level=4, duration_s=60, max_calls=100, single_p50_ms=1.0)
    assert stats["calls"] == 100
    assert stats["rate_limit_errors"] == 10
    assert stats["rate_limit_pct"] == 10.0


@pytest.mark.parametrize("mod", [sp, elt])
def test_no_profile_default_exits_2(mod, capsys):
    argv = ["--notebook-path", "/x", "--out", "/tmp/x"] if mod is sp else ["--endpoint", "e", "--out", "/tmp/x"]
    with pytest.raises(SystemExit) as e:
        mod.main(argv)
    assert e.value.code == 2
    assert "--profile" in capsys.readouterr().err
