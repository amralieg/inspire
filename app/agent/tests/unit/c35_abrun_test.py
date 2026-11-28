"""c35_abrun: Discover OLD vs NEW harness (run half). Offline: fake WorkspaceClient + fake SQL."""
import base64
import importlib.util
import json
import re
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "discover_ab_run.py"


def _load():
    spec = importlib.util.spec_from_file_location("discover_ab_run", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


SCOPES = [
    {"id": f"s{i}", "role": "standard",
     "widgets": {"01_uc_metadata": f"cat{i}.sch", "business_context": f"ctx {i}", "priorities": f"prio {i}",
                 "generation_instructions": f"gi {i}", "04_table_election": "All Tables", "quality_mode": "Balanced"},
     "answer_key": f"bench6/keys/s{i}.json", "planted": []}
    for i in range(6)
]


class FakeApi:
    def __init__(self, ws):
        self.ws = ws

    def do(self, method, path, query=None, body=None, **kw):
        self.ws.calls.append((method, path, query, body))
        if path == "/api/2.0/workspace/import":
            self.ws.imports.append((body["path"], base64.b64decode(body["content"]).decode()))
            return {}
        if path == "/api/2.1/jobs/runs/submit":
            self.ws.next_run += 1
            self.ws.submits.append(body)
            return {"run_id": self.ws.next_run}
        if path == "/api/2.1/jobs/runs/get":
            rid = int(query["run_id"])
            n = self.ws.polls.get(rid, 0) + 1
            self.ws.polls[rid] = n
            done = n >= self.ws.finish_after.get(rid, 1)
            return {"run_id": rid, "state": {"life_cycle_state": "TERMINATED" if done else "RUNNING",
                                              "result_state": "SUCCESS" if done else ""},
                    "end_time": 1700000000000 if done else 0}
        raise AssertionError(path)


class FakeUser:
    user_name = "tester@example.com"


class FakeWS:
    def __init__(self):
        self.calls, self.imports, self.submits = [], [], []
        self.next_run, self.polls, self.finish_after = 1000, {}, {}
        self.api_client = FakeApi(self)
        self.current_user = type("CU", (), {"me": staticmethod(lambda: FakeUser())})()


def _notebook(with_match):
    cells = ['"Discover Use Cases"'] + (['"Match Use Cases"'] if with_match else [])
    return json.dumps({"cells": cells})


def _manifest_file(tmp_path, scopes=SCOPES):
    p = tmp_path / "bench6" / "manifest.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"version": 1, "scopes": scopes}))
    return p


def test_submit_36_runs_distinct_sessions_identical_widgets(tmp_path):
    m = _load()
    ws, out = FakeWS(), tmp_path / "out"
    mf = _manifest_file(tmp_path)
    rc = m.main(["submit", "--profile", "p", "--out", str(out), "--old-sha", "aaaaaaaaaaaa",
                 "--new-sha", "bbbbbbbbbbbb", "--manifest", str(mf), "--reps", "3",
                 "--inspire-db", "c.s"], ws=ws, git_show=lambda sha, path: _notebook(False))
    assert rc == 0
    assert len(ws.submits) == 36
    params = [s["tasks"][0]["notebook_task"]["base_parameters"] for s in ws.submits]
    paths = [s["tasks"][0]["notebook_task"]["notebook_path"] for s in ws.submits]
    assert len({p["14_session_id"] for p in params}) == 36
    assert all(p["15_operation"] == "Discover Use Cases" for p in params)
    assert len(ws.imports) == 2 and len(set(paths)) == 2
    old = [p for p, path in zip(params, paths) if "aaaaaaaaa" in path]
    new = [p for p, path in zip(params, paths) if "bbbbbbbbb" in path]
    assert len(old) == len(new) == 18
    strip = lambda p: {k: v for k, v in p.items() if k not in ("14_session_id", "00_business_name", "11_generation_path")}
    for o, n in zip(old, new):
        assert strip(o) == strip(n)
        assert o["01_uc_metadata"].startswith("cat")
    mani = json.loads((out / "manifest.json").read_text())
    assert set(mani["agents"]) == {"OLD", "NEW"} and len(mani["runs"]) == 36
    assert {r["agent"] for r in mani["runs"]} == {"OLD", "NEW"}


def _sql_factory(tables):
    stmts = []

    def sql(statement):
        stmts.append(statement)
        for key, rows in tables.items():
            if key in statement:
                if isinstance(rows, Exception):
                    raise rows
                return rows
        return []
    sql.stmts = stmts
    return sql


def _write_run_manifest(out, session_id=111):
    out.mkdir(parents=True, exist_ok=True)
    (out / "manifest.json").write_text(json.dumps({
        "agents": {"OLD": {"sha": "a", "notebook_path": "/x/a"}, "NEW": {"sha": "b", "notebook_path": "/x/b"}},
        "runs": [{"agent": "OLD", "scope": "s0", "rep": 1, "session_id": str(session_id), "run_id": 1001,
                  "state": "TERMINATED", "submitted_at": "2026-11-28T10:00:00+00:00",
                  "ended_at": "2026-11-28T10:30:00+00:00"}]}))


def test_pull_orders_steps_shortlist_and_first_valued(tmp_path):
    m = _load()
    out = tmp_path / "out"
    _write_run_manifest(out)
    steps = [
        {"step_name": "c", "result_json": json.dumps({"event_at": "2026-11-28T10:03:00"})},
        {"step_name": "a", "result_json": json.dumps({"event_at": "2026-11-28T10:01:00"})},
        {"step_name": "b", "result_json": json.dumps({"event_at": "2026-11-28T10:02:00"})},
    ]
    ucs = []
    for i in range(25):  # emitted in reverse order; value only from the 5th emitted on
        n = 24 - i
        ucs.append({"id": f"AI{n}", "use_case": f"u{n}", "business_value": "" if n < 4 else "high",
                    "event_at": f"2026-11-28T10:{10 + n:02d}:00"})
    sql = _sql_factory({"__inspire_step_ledger": RuntimeError("no table"), "system.billing.usage": RuntimeError("no"),
                        "__inspire_step ": steps, "__inspire_usecases": ucs})
    rc = m.main(["pull", "--profile", "p", "--out", str(out), "--inspire-db", "c.s", "--warehouse", "w"],
                ws=FakeWS(), sql=sql)
    assert rc == 0
    d = out / "runs" / "OLD" / "s0" / "1"
    got = json.loads((d / "steps.json").read_text())
    assert [s["step_name"] for s in got] == ["a", "b", "c"]
    short = json.loads((d / "shortlist.json").read_text())
    assert [u["id"] for u in short] == [f"AI{n}" for n in range(20)]
    assert len(json.loads((d / "usecases.json").read_text())) == 25
    t = json.loads((d / "timing.json").read_text())
    assert t["first_valued_card_at"] == "2026-11-28T10:14:00"
    assert t["submitted_at"] == "2026-11-28T10:00:00+00:00" and t["ended_at"] == "2026-11-28T10:30:00+00:00"
    assert json.loads((d / "ledger.json").read_text()) == {"missing": True}
    assert json.loads((d / "cost.json").read_text()) == {"missing": True}


def _seed_for_match(out, tmp_path):
    out.mkdir(parents=True, exist_ok=True)
    d = out / "runs" / "OLD" / "s0" / "1"
    d.mkdir(parents=True)
    (d / "shortlist.json").write_text(json.dumps(
        [{"id": f"AI{i}", "use_case": f"name {i}", "statement": f"stmt {i}"} for i in range(4)]))
    return _manifest_file(tmp_path, SCOPES[:1])


def test_match_refuses_notebook_without_match_and_writes_rows(tmp_path):
    m = _load()
    out = tmp_path / "out"
    mf = _seed_for_match(out, tmp_path)
    args = ["match", "--profile", "p", "--out", str(out), "--inspire-db", "c.s", "--warehouse", "w",
            "--manifest", str(mf), "--build-sha", "ccccccccccc", "--feed", "old_top20"]
    ws, sql = FakeWS(), _sql_factory({})
    rc = m.main(args, ws=ws, sql=sql, git_show=lambda sha, path: _notebook(False))
    assert rc != 0 and not ws.submits and not sql.stmts
    ws, sql = FakeWS(), _sql_factory({})
    rc = m.main(args, ws=ws, sql=sql, git_show=lambda sha, path: _notebook(True))
    assert rc == 0 and len(ws.submits) == 1
    p = ws.submits[0]["tasks"][0]["notebook_task"]["base_parameters"]
    assert p["15_operation"] == "Match Use Cases" and p["19_match_phase"] == "match"
    inp = json.loads((out / "match" / "old_top20" / "s0" / "input.json").read_text())
    assert len(inp["rows"]) == 4
    assert inp["session_id"] == p["14_session_id"]
    inserts = [s for s in sql.stmts if "__inspire_match_input" in s and "INSERT" in s.upper()]
    assert len(inserts) == 1
    assert len(re.findall(r"\(\s*'%s'\s*," % inp["session_id"], inserts[0])) == 4


def test_watch_exits_zero_only_when_all_terminal_one_line_per_poll(tmp_path):
    m = _load()
    out = tmp_path / "out"
    out.mkdir()
    runs = [{"agent": "OLD", "scope": "s0", "rep": r, "session_id": str(r), "run_id": 2000 + r,
             "state": "PENDING", "submitted_at": "t", "ended_at": None} for r in (1, 2)]
    (out / "manifest.json").write_text(json.dumps({"agents": {}, "runs": runs}))
    ws = FakeWS()
    ws.finish_after = {2001: 1, 2002: 3}
    sleeps = []
    rc = m.main(["watch", "--profile", "p", "--out", str(out)], ws=ws, sleep=sleeps.append)
    assert rc == 0
    assert sleeps == [60, 60]
    assert len((out / "status.txt").read_text().strip().splitlines()) == 3
    assert all(r["state"] == "TERMINATED" for r in json.loads((out / "manifest.json").read_text())["runs"])


def test_missing_profile_exits_2(tmp_path):
    m = _load()
    with pytest.raises(SystemExit) as e:
        m.main(["watch", "--out", str(tmp_path)], ws=FakeWS())
    assert e.value.code == 2
