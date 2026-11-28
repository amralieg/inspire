"""c36_incremental (R4.1-R4.4, P1; App contract U3): every Discover candidate's state is written to <inspire_db>.__inspire_candidates as it
happens, so the App can show a provisional card as soon as a candidate is eligible, before the run ends.

Contract these tests pin (the builder implements it; the App lane reads it):
* Flag TECHNICAL_CONTEXT.runtime.discover_incremental_candidates, default False (rc.9 ships without it). Off = no statement touches the table.
* Columns: session_id BIGINT, candidate_id STRING, state STRING, merged_into STRING, provisional_rank INT, history_json STRING, event_at TIMESTAMP.
* States: proposed (after pass 1/2 parse) -> grounded (after the G/Q gates) -> measured (after scoring + value estimate) -> eligible (passes
  the selection checks) -> one terminal state: selected | merged | overlapping | lower_marginal | unmeasured | blocked.
* history_json is the candidate's full transition list held by the agent; every entry is {"state", "stage", "event_at", "name"}.
* candidate_id is deterministic for the same inputs (derived from _uc_dedup_signature) and unique per candidate within a session: two
  candidates that share a signature (the twins a signature dedup merges) get distinct ids through a deterministic tie-break, so a merged
  twin's merged_into can name its survivor.
* Written like StepLedger: through atomic_writer.spark into atomic_writer.inspire_database, literals as StepLedger._literal (UTC TIMESTAMP'...'),
  one MERGE per stage batch: MERGE INTO <db>.__inspire_candidates t USING (VALUES (...), ...) AS s(<columns>) ON t.session_id = s.session_id
  AND t.candidate_id = s.candidate_id WHEN MATCHED THEN UPDATE SET * WHEN NOT MATCHED THEN INSERT *.
* Transitions are recorded at the DatabricksInspire.run() call sites, so the stage doubles of the offline run do not hide them.

The fake spark below applies the MERGE semantics its ON clause actually states, so a missing key column shows up as clobbered rows.
"""
import datetime
import json
import logging
import os
import pathlib
import random
import re
import sys
import tempfile
import threading
import types

import pytest

UNIT = os.path.dirname(os.path.abspath(__file__))
TESTS = os.path.dirname(UNIT)
for _p in (UNIT, TESTS, os.path.join(TESTS, "scripts")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import _agentload  # noqa: E402
import v120_speed_profile as sp  # noqa: E402

FLAG = "discover_incremental_candidates"
TABLE = "__inspire_candidates"
COLUMNS = ("session_id", "candidate_id", "state", "merged_into", "provisional_rank", "history_json", "event_at")
PROGRESS = ("proposed", "grounded", "measured", "eligible")
TERMINAL = ("selected", "merged", "overlapping", "lower_marginal", "unmeasured", "blocked")
GENERATED = sp.N_TABLES * sp.UCS_PER_TABLE


class Clock:
    def __init__(self):
        self.n = 0
        self._lock = threading.Lock()

    def tick(self):
        with self._lock:
            self.n += 1
            return self.n


def _skip_ws(text, pos):
    while pos < len(text) and text[pos].isspace():
        pos += 1
    return pos


def _string(text, pos):
    assert text[pos] == "'"
    out, pos = [], pos + 1
    while pos < len(text):
        ch = text[pos]
        if ch == "\\" and pos + 1 < len(text):
            out.append(text[pos + 1])
            pos += 2
            continue
        if ch == "'":
            if text[pos + 1:pos + 2] == "'":
                out.append("'")
                pos += 2
                continue
            return "".join(out), pos + 1
        out.append(ch)
        pos += 1
    raise AssertionError("unterminated SQL string literal: " + text[:80])


def _timestamp(value):
    if value is None or isinstance(value, datetime.datetime):
        return value
    return datetime.datetime.fromisoformat(str(value).strip().replace("T", " ").rstrip("Z").split("+")[0])


def _literal(text, pos):
    pos = _skip_ws(text, pos)
    if text.startswith("'", pos):
        return _string(text, pos)
    m = re.compile(r"TIMESTAMP\s*'", re.I).match(text, pos)
    if m:
        value, end = _string(text, m.end() - 1)
        return _timestamp(value), end
    m = re.compile(r"CAST\s*\(", re.I).match(text, pos)
    if m:
        value, end = _literal(text, m.end())
        m2 = re.compile(r"\s*AS\s+[A-Za-z_][A-Za-z0-9_]*(?:\s*\([^)]*\))?\s*\)", re.I).match(text, end)
        assert m2, "unparsed CAST at: " + text[pos:pos + 80]
        return value, m2.end()
    m = re.compile(r"(?:current_timestamp|now)\s*\(\s*\)", re.I).match(text, pos)
    if m:
        return datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None), m.end()
    m = re.compile(r"(NULL|TRUE|FALSE)\b", re.I).match(text, pos)
    if m:
        return {"NULL": None, "TRUE": True, "FALSE": False}[m.group(1).upper()], m.end()
    m = re.compile(r"-?\d+(?:\.\d+)?").match(text, pos)
    if m:
        return (float(m.group(0)) if "." in m.group(0) else int(m.group(0))), m.end()
    raise AssertionError("unparsed SQL literal at: " + text[pos:pos + 80])


def _tuples(text, pos):
    rows = []
    while True:
        pos = _skip_ws(text, pos)
        if not text.startswith("(", pos):
            return rows, pos
        pos, row = pos + 1, []
        while True:
            value, pos = _literal(text, pos)
            row.append(value)
            pos = _skip_ws(text, pos)
            if text.startswith(",", pos):
                pos += 1
                continue
            assert text.startswith(")", pos), "malformed VALUES tuple at: " + text[pos:pos + 80]
            pos += 1
            break
        rows.append(row)
        pos = _skip_ws(text, pos)
        if text.startswith(",", pos):
            pos += 1


def _names(text):
    return [c.strip().strip("`").split(".")[-1].strip("`") for c in text.split(",") if c.strip()]


def _source_rows(query):
    """(columns, rows) of the VALUES list a MERGE or INSERT carries."""
    m = re.search(r"\bVALUES\b", query, re.I)
    assert m, "the write carries no VALUES list: " + query[:200]
    rows, end = _tuples(query, m.end())
    assert rows, "empty VALUES list: " + query[:200]
    alias = re.compile(r"\s*\)?\s*(?:AS\s+)?`?[A-Za-z_]\w*`?\s*\(([^)]*)\)", re.I).match(query, end)
    if alias and not re.match(r"\s*\)?\s*ON\b", query[end:], re.I):
        columns = _names(alias.group(1))
    else:
        head = re.search(rf"{TABLE}`?\s*\(([^)]*)\)\s*VALUES", query, re.I)
        assert head, "cannot find the column list of the write: " + query[:200]
        columns = _names(head.group(1))
    assert all(len(r) == len(columns) for r in rows), (columns, rows[:2])
    out = []
    for r in rows:
        row = dict(zip(columns, r))
        if "event_at" in row:
            row["event_at"] = _timestamp(row["event_at"])
        out.append(row)
    return columns, out


class CandidateSpark:
    """A fake spark session: records every statement with a global sequence number and keeps <db>.__inspire_candidates as a list of rows."""

    def __init__(self, clock):
        self.clock = clock
        self.label = None
        self.statements = []
        self.writes = []
        self.rows = []
        self._lock = threading.Lock()

    def sql(self, query, args=None):
        query = str(query)
        with self._lock:
            seq = self.clock.tick()
            self.statements.append({"seq": seq, "label": self.label, "sql": query})
            if TABLE in query:
                self._apply(seq, query)
        return types.SimpleNamespace(collect=lambda: [], first=lambda: None, count=lambda: 0)

    def _apply(self, seq, query):
        verb = query.lstrip().split(None, 1)[0].upper()
        if verb == "MERGE":
            columns, src = _source_rows(query)
            on = re.search(r"\bON\b(.*?)\bWHEN\b", query, re.I | re.S)
            keys = [k for k in ("session_id", "candidate_id") if on and re.search(rf"\b{k}\b", on.group(1))]
            for row in src:
                hits = [r for r in self.rows if keys and all(r.get(k) == row.get(k) for k in keys)]
                for hit in hits:
                    hit.update(row)
                if not hits:
                    self.rows.append(dict(row))
            self.writes.append({"seq": seq, "label": self.label, "verb": verb, "keys": keys, "columns": columns, "rows": src, "sql": query})
        elif verb == "INSERT":
            columns, src = _source_rows(query)
            self.rows.extend(dict(r) for r in src)
            self.writes.append({"seq": seq, "label": self.label, "verb": verb, "keys": [], "columns": columns, "rows": src, "sql": query})
        elif verb in ("DELETE", "UPDATE"):
            self.writes.append({"seq": seq, "label": self.label, "verb": verb, "keys": [], "columns": [], "rows": [], "sql": query})

    def touching(self):
        return [s["sql"] for s in self.statements if TABLE in s["sql"]]

    def session_rows(self, session_id):
        return [r for r in self.rows if r.get("session_id") == session_id]

    def run_writes(self, label, verb=None):
        return [w for w in self.writes if w["label"] == label and (verb is None or w["verb"] == verb)]


def _history(row):
    raw = row.get("history_json")
    assert isinstance(raw, str) and raw, row
    hist = json.loads(raw)
    assert isinstance(hist, list) and hist, row
    return hist


def _latest_name(row):
    named = [e.get("name") for e in _history(row) if e.get("name")]
    return named[-1] if named else None


def _twin_generator(obj):
    """Each table batch also yields a reworded twin of its first use case: a different name with the same _uc_dedup_signature."""
    generate = obj._process_batch_with_retry

    def with_twin(column_details, batch_id, **kw):
        out = generate(column_details, batch_id, **kw)
        if out:
            twin = dict(out[0])
            words = twin["Name"].split()
            twin["No"] = twin["No"][:-1] + "9"
            twin["Name"] = " ".join([words[-1].capitalize()] + words[1:-1] + [words[0].lower()])
            out.append(twin)
        return out

    obj._process_batch_with_retry = with_twin


def _run(ns, store, session_id, flag=True, twins=False, label=None):
    ns["TECHNICAL_CONTEXT"]["runtime"][FLAG] = flag
    random.seed(0)
    store.label = label or f"run-{session_id}"
    merges = []
    steps = []
    with tempfile.TemporaryDirectory(prefix="c36_incremental_") as tmp:
        obj, _ai = sp.build(ns, pathlib.Path(tmp), "Good")
        writer = obj.atomic_writer
        writer.spark = store
        writer.inspire_database = "cat.db"
        obj.session_id = session_id
        emit = writer.emit_step

        def stamped(**kw):
            steps.append({"seq": store.clock.tick(), "at": datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None), **kw})
            return emit(**kw)

        writer.emit_step = stamped
        if twins:
            _twin_generator(obj)
            signature_dedup = obj._dedup_by_signature

            def recorded(*args, **kwargs):
                result = signature_dedup(*args, **kwargs)
                names = {str(u.get("No")): u.get("Name") for u in (args[0] if args else kwargs.get("use_cases") or [])}
                merges.extend((names.get(str(e.get("kept"))), names.get(str(e.get("dropped")))) for e in (result[1] or []))
                return result

            obj._dedup_by_signature = recorded
        logging.disable(logging.CRITICAL)
        try:
            obj.run()
        finally:
            logging.disable(logging.NOTSET)
        final = (obj.recorded["tracking"] or [[]])[-1]
    return types.SimpleNamespace(obj=obj, final=final, steps=steps, merges=merges, label=store.label, session_id=session_id)


def _require_rows(store, session_id):
    rows = store.session_rows(session_id)
    assert rows, (f"flag on: no MERGE wrote a row of session {session_id} to {TABLE} "
                  f"({len(store.touching())} statements touched the table)")
    return rows


@pytest.fixture()
def ns():
    return _agentload.fresh_agent_namespace()


@pytest.fixture(scope="module")
def on_run():
    ns = _agentload.fresh_agent_namespace()
    store = CandidateSpark(Clock())
    run = _run(ns, store, 4242, flag=True)
    return run, store


def test_0_flag_defaults_off(ns):
    assert ns["TECHNICAL_CONTEXT"]["runtime"].get(FLAG, "<missing>") is False


def test_harness_applies_a_contract_merge_by_its_on_keys(ns):
    """Must-keep: the fake spark reads StepLedger-style literals and applies MERGE by the keys its ON clause names."""
    lit = ns["StepLedger"]._literal
    kinds = ("BIGINT", "STRING", "STRING", "STRING", "INT", "STRING", "TIMESTAMP")

    def merge(rows, on="t.session_id = s.session_id AND t.candidate_id = s.candidate_id"):
        values = ", ".join("(" + ", ".join(lit(v, k) for v, k in zip(r, kinds)) + ")" for r in rows)
        return (f"MERGE INTO `cat`.`db`.{TABLE} AS t USING (VALUES {values}) AS s({', '.join(COLUMNS)}) ON {on} "
                "WHEN MATCHED THEN UPDATE SET * WHEN NOT MATCHED THEN INSERT *")

    hist = json.dumps([{"state": "proposed", "stage": "pass 1", "event_at": "2026-01-01 00:00:00", "name": "It's a \\ name"}])
    store = CandidateSpark(Clock())
    store.sql(merge([(1, "c1", "proposed", None, None, hist, "2026-01-01 00:00:00.000001"),
                     (2, "c1", "proposed", None, None, hist, "2026-01-01 00:00:00.000001")]))
    store.sql(merge([(1, "c1", "eligible", None, 3, hist, "2026-01-01 00:00:01")]))
    assert len(store.rows) == 2 and store.session_rows(1)[0]["state"] == "eligible" and store.session_rows(2)[0]["state"] == "proposed"
    assert store.session_rows(1)[0]["provisional_rank"] == 3 and _latest_name(store.session_rows(1)[0]) == "It's a \\ name"
    store.sql(merge([(1, "c1", "selected", None, 3, hist, "2026-01-01 00:00:02")], on="t.candidate_id = s.candidate_id"))
    assert {r["state"] for r in store.rows} == {"selected"}, "a MERGE keyed on candidate_id only clobbers the other session"


def test_1_states_written_in_order_with_stage_history(on_run):
    run, store = on_run
    rows = _require_rows(store, run.session_id)
    for write in store.run_writes(run.label):
        assert set(COLUMNS) <= set(write["columns"]), write["columns"]
    ids = [r["candidate_id"] for r in rows]
    assert all(isinstance(i, str) and i for i in ids) and len(set(ids)) == len(ids)
    assert len(rows) == GENERATED, f"every generated candidate gets one row: {len(rows)} of {GENERATED}"
    order = {s: i for i, s in enumerate(PROGRESS)}
    for row in rows:
        hist = _history(row)
        states = [e.get("state") for e in hist]
        assert states[0] == "proposed", states
        assert states[-1] in TERMINAL and row["state"] == states[-1], (row["state"], states)
        assert all(s in TERMINAL for s in states[-1:]) and not any(s in TERMINAL for s in states[:-1]), states
        progress = [order[s] for s in states[:-1]]
        assert progress == sorted(set(progress)), f"states out of order or repeated: {states}"
        assert all(s in order for s in states[:-1]), states
        for entry in hist:
            assert isinstance(entry.get("stage"), str) and entry["stage"].strip(), entry
            assert isinstance(entry.get("name"), str) and entry["name"].strip(), entry
        times = [_timestamp(e.get("event_at")) for e in hist]
        assert all(times) and times == sorted(times), times
        assert isinstance(row["event_at"], datetime.datetime), row["event_at"]
    selected = [r for r in rows if r["state"] == "selected"]
    for row in selected:
        assert [e["state"] for e in _history(row)] == list(PROGRESS) + ["selected"], _history(row)
    assert len(selected) == len(run.final) and run.final
    assert {_latest_name(r) for r in selected} == {u["Name"] for u in run.final}
    assert any(r["state"] != "selected" for r in rows)
    eligible_writes = [w for w in store.run_writes(run.label, "MERGE") if any(r.get("state") == "eligible" for r in w["rows"])]
    assert eligible_writes, "no write showed a candidate as eligible"
    ranks = [r.get("provisional_rank") for r in eligible_writes[0]["rows"] if r.get("state") == "eligible"]
    assert all(isinstance(k, int) and not isinstance(k, bool) and k >= 1 for k in ranks), ranks
    assert len(set(ranks)) == len(ranks), ranks


def test_2_merged_candidate_names_its_survivor(ns):
    store = CandidateSpark(Clock())
    run = _run(ns, store, 303, twins=True)
    assert run.merges and all(k and d for k, d in run.merges), "fixture: the signature dedup must merge reworded twins"
    rows = _require_rows(store, 303)
    by_name = {}
    for row in rows:
        by_name.setdefault(_latest_name(row), []).append(row)
    ids = {r["candidate_id"] for r in rows}
    for kept, dropped in run.merges:
        assert len(by_name.get(kept, [])) == 1 and len(by_name.get(dropped, [])) == 1, (kept, dropped)
        survivor, loser = by_name[kept][0], by_name[dropped][0]
        assert survivor["candidate_id"] != loser["candidate_id"], "twins sharing a signature need distinct candidate ids"
        assert loser["state"] == "merged", (dropped, loser["state"])
        assert loser["merged_into"] == survivor["candidate_id"], (dropped, loser["merged_into"], survivor["candidate_id"])
        assert _history(loser)[-1]["state"] == "merged"
    for row in rows:
        if row["state"] == "merged":
            assert row["merged_into"] in ids and row["merged_into"] != row["candidate_id"], row
        else:
            assert not row.get("merged_into"), row


def test_3_rerun_same_stage_keeps_one_row_per_candidate(ns):
    store = CandidateSpark(Clock())
    first = _run(ns, store, 404, label="first")
    before = {r["candidate_id"] for r in _require_rows(store, 404)}
    _run(ns, store, 404, label="retry")
    rows = store.session_rows(404)
    keys = [(r["session_id"], r["candidate_id"]) for r in rows]
    assert len(keys) == len(set(keys)) == len(before), (len(keys), len(set(keys)), len(before))
    assert {r["candidate_id"] for r in rows} == before, "candidate ids must be stable across a retry"
    assert [w for w in store.writes if w["verb"] == "INSERT"] == [], "rows are written with MERGE, never INSERT"
    for label in (first.label, "retry"):
        merges = store.run_writes(label, "MERGE")
        assert merges and all(w["keys"] == ["session_id", "candidate_id"] for w in merges), [w["keys"] for w in merges]
        stages = {e["stage"] for r in rows for e in _history(r)}
        assert len(merges) <= len(stages) + 1, f"{len(merges)} MERGEs for {len(stages)} stages: batch per stage, not per row"
        assert max(len(w["rows"]) for w in merges) > 1


def test_4_two_sessions_over_the_same_scope_never_touch_each_other(ns):
    store = CandidateSpark(Clock())
    _run(ns, store, 501, label="a")
    a_rows = [dict(r) for r in _require_rows(store, 501)]
    _run(ns, store, 502, label="b")
    b_rows = _require_rows(store, 502)
    assert sorted(store.session_rows(501), key=lambda r: r["candidate_id"]) == sorted(a_rows, key=lambda r: r["candidate_id"])
    assert {r["candidate_id"] for r in a_rows} & {r["candidate_id"] for r in b_rows}, "fixture: same scope gives shared candidate ids"
    for label, own in (("a", 501), ("b", 502)):
        for write in store.run_writes(label):
            assert all(r.get("session_id") == own for r in write["rows"]), write["sql"][:200]
            if write["verb"] == "MERGE":
                assert "session_id" in write["keys"], write["sql"][:300]
            else:
                assert re.search(rf"session_id`?\s*=\s*{own}\b", write["sql"]), write["sql"][:300]


def test_5_first_eligible_row_lands_before_the_run_completes(on_run):
    run, store = on_run
    _require_rows(store, run.session_id)
    merges = store.run_writes(run.label, "MERGE")
    eligible = [w for w in merges if any(r.get("state") == "eligible" for r in w["rows"])]
    selected = [w for w in merges if any(r.get("state") == "selected" for r in w["rows"])]
    assert eligible and selected, (len(eligible), len(selected))
    assert eligible[0]["seq"] < selected[0]["seq"], "a provisional (eligible) card must be written before the final selection"
    ended = [s for s in run.steps if str(s.get("status", "")).startswith("ended_")]
    assert ended
    final_step = ended[-1]
    assert eligible[0]["seq"] < final_step["seq"], (eligible[0]["seq"], final_step["seq"], final_step.get("step_name"))
    first = min(r["event_at"] for r in eligible[0]["rows"] if r.get("state") == "eligible")
    assert first <= final_step["at"], (first, final_step["at"])


def test_6_flag_off_writes_nothing_and_output_is_unchanged(ns, on_run):
    on, _on_store = on_run
    store = CandidateSpark(Clock())
    off = _run(ns, store, 4242, flag=False)
    assert store.touching() == []
    assert off.final and [u["No"] for u in off.final] == [u["No"] for u in on.final]
    assert off.final == on.final
