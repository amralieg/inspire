"""a04_incr_failed (R4.1-R4.4, U3 follow-up; T-INCR-01): a failed Discover run leaves no candidate row in a non-terminal state.

With discover_incremental_candidates on, when an exception leaves DatabricksInspire.run() after candidate rows were written, the run
flushes its pending rows and MERGEs every non-terminal candidate of its session (proposed/grounded/measured/eligible) to the terminal
state "run_failed" (in InspireCandidateLedger.TERMINAL), with a history_json entry, then lets the original exception propagate
unchanged. The flush never raises. Flag off: no statement touches the table.

Design note (test writer): the brief says "mid-Pass-2", but candidate rows are first written after both generation passes, when the use
cases are loaded for dedup (InspireCandidateLedger.propose). A failure inside Pass 2 therefore has no row to close. The tests raise
after rows exist instead: in the selection step (rows are "measured") and right after the "eligible" MERGE (rows are "eligible").

Harness: c36_incremental_test (offline run of v120_speed_profile.build, CandidateSpark applies MERGE by its ON keys).
"""
import json
import logging
import pathlib
import random
import tempfile
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import c36_incremental_test as c36  # noqa: E402

PROGRESS = set(c36.PROGRESS)
SESSION = 6161


class Boom(RuntimeError):
    pass


class FlakySpark(c36.CandidateSpark):
    """CandidateSpark whose candidate-table MERGEs raise while `fail` is set (the table write is down)."""

    def __init__(self, clock):
        super().__init__(clock)
        self.fail = False

    def sql(self, query, args=None):
        if self.fail and c36.TABLE in str(query) and str(query).lstrip().upper().startswith("MERGE"):
            with self._lock:
                self.statements.append({"seq": self.clock.tick(), "label": self.label, "sql": str(query), "failed": True})
            raise RuntimeError("candidate table unavailable")
        return super().sql(query, args)


def _failing_run(ns, store, where, flag=True, error=None, table_down_from=None):
    """One offline Discover run that raises `error` at `where` ("selection": in _select_scored_use_cases; "after_eligible": in
    _regroup_themes_after_drops). table_down_from: "eligible" makes the candidate MERGEs fail from the eligible write on."""
    ns["TECHNICAL_CONTEXT"]["runtime"][c36.FLAG] = flag
    random.seed(0)
    store.label = f"run-{SESSION}"
    error = error or Boom("planted failure after candidates were written")
    with tempfile.TemporaryDirectory(prefix="a04_incr_failed_") as tmp:
        obj, _ai = c36.sp.build(ns, pathlib.Path(tmp), "Good")
        obj.atomic_writer.spark = store
        obj.atomic_writer.inspire_database = "cat.db"
        obj.session_id = SESSION
        if where == "selection":
            def select(*a, **kw):
                store.at_failure = _states_when_failing(store)
                raise error
            obj._select_scored_use_cases = select
        else:
            real_select = obj._select_scored_use_cases

            def select(*a, **kw):
                out = real_select(*a, **kw)
                if table_down_from == "eligible":
                    store.fail = True
                return out

            obj._select_scored_use_cases = select

            def regroup(*a, **kw):
                store.at_failure = _states_when_failing(store)
                if table_down_from == "eligible":
                    store.fail = False  # the table comes back before the failure: the failure flush can write the buffered rows
                raise error
            obj._regroup_themes_after_drops = regroup
        logging.disable(logging.CRITICAL)
        try:
            with pytest.raises(BaseException) as raised:
                obj.run()
        finally:
            logging.disable(logging.NOTSET)
            store.fail = False
    return obj, raised.value, error


def _assert_all_run_failed_or_terminal(store, before_states):
    rows = c36._require_rows(store, SESSION)
    open_rows = [(r["candidate_id"], r["state"]) for r in rows if r["state"] in PROGRESS]
    assert not open_rows, f"{len(open_rows)} of {len(rows)} rows left non-terminal after the run failed: {open_rows[:5]}"
    for row in rows:
        hist = c36._history(row)
        assert hist[-1]["state"] == row["state"], (row["state"], hist[-1])
    closed = [r for r in rows if before_states.get(r["candidate_id"]) in PROGRESS]
    assert closed, "fixture: some candidates were non-terminal when the run failed"
    for row in closed:
        assert row["state"] == "run_failed", (row["candidate_id"], row["state"])
        last = c36._history(row)[-1]
        assert last["state"] == "run_failed" and str(last.get("stage") or "").strip() and str(last.get("name") or "").strip(), last
    return rows


def _states_when_failing(store):
    return {r["candidate_id"]: r["state"] for r in store.session_rows(SESSION)}


@pytest.fixture()
def ns():
    return c36._agentload.fresh_agent_namespace()


def test_1_run_failed_is_a_terminal_state(ns):
    assert "run_failed" in ns["InspireCandidateLedger"].TERMINAL


def test_2_failure_in_selection_closes_every_measured_row_and_reraises(ns):
    store = c36.CandidateSpark(c36.Clock())
    obj, raised, planted = _failing_run(ns, store, "selection")
    assert raised is planted, f"the original exception must propagate unchanged, got {raised!r}"
    seen = store.at_failure
    measured = {cid for cid, st in seen.items() if st == "measured"}
    assert measured, f"fixture: candidates reached 'measured' before the planted failure: {sorted(set(seen.values()))}"
    rows = _assert_all_run_failed_or_terminal(store, seen)
    assert {r["candidate_id"] for r in rows if r["state"] == "run_failed"} == measured


def test_3_failure_after_eligible_closes_eligible_rows(ns):
    store = c36.CandidateSpark(c36.Clock())
    obj, raised, planted = _failing_run(ns, store, "after_eligible")
    assert raised is planted
    rows = store.session_rows(SESSION)
    assert any(e["state"] == "eligible" for r in rows for e in c36._history(r)), "fixture: rows reached 'eligible'"
    open_rows = [r["state"] for r in rows if r["state"] in PROGRESS]
    assert not open_rows, f"{len(open_rows)} rows left non-terminal: {sorted(set(open_rows))}"
    failed = [r for r in rows if r["state"] == "run_failed"]
    assert failed and all([e["state"] for e in c36._history(r)][-2:] == ["eligible", "run_failed"] for r in failed)


def test_4_pending_rows_are_flushed_on_failure(ns):
    """The eligible MERGE fails (rows stay buffered); the table comes back; the failure flush writes them closed."""
    store = FlakySpark(c36.Clock())
    obj, raised, planted = _failing_run(ns, store, "after_eligible", table_down_from="eligible")
    assert raised is planted
    rows = store.session_rows(SESSION)
    open_rows = [r["state"] for r in rows if r["state"] in PROGRESS]
    assert not open_rows, f"{len(open_rows)} rows left non-terminal after a buffered write: {sorted(set(open_rows))}"
    assert any(r["state"] == "run_failed" for r in rows)


def test_5_flush_never_raises_and_the_original_error_survives(ns):
    """The table is down for good: the failure flush fails too, and the caller still sees the planted exception, not the write error."""
    store = FlakySpark(c36.Clock())
    original = store.sql
    calls = {"down": False}

    def sql(query, args=None):
        if calls["down"]:
            store.fail = True
        return original(query, args)

    store.sql = sql
    error = Boom("planted failure with the table down")

    def fail_after_measured(*a, **kw):
        calls["down"] = True
        raise error

    ns["TECHNICAL_CONTEXT"]["runtime"][c36.FLAG] = True
    random.seed(0)
    with tempfile.TemporaryDirectory(prefix="a04_incr_failed_") as tmp:
        obj, _ai = c36.sp.build(ns, pathlib.Path(tmp), "Good")
        obj.atomic_writer.spark = store
        obj.atomic_writer.inspire_database = "cat.db"
        obj.session_id = SESSION
        obj._select_scored_use_cases = fail_after_measured
        logging.disable(logging.CRITICAL)
        try:
            with pytest.raises(Boom) as raised:
                obj.run()
        finally:
            logging.disable(logging.NOTSET)
    assert raised.value is error
    attempted = [s for s in store.statements if s.get("failed")]
    assert attempted, "the failure path must try to close the open rows even when the table is down"


def test_6_guard_flag_off_failed_run_touches_nothing(ns):
    store = c36.CandidateSpark(c36.Clock())
    obj, raised, planted = _failing_run(ns, store, "selection", flag=False)
    assert raised is planted
    assert store.touching() == []


def test_7_guard_successful_run_has_no_run_failed_row(ns):
    store = c36.CandidateSpark(c36.Clock())
    c36._run(ns, store, SESSION, flag=True)
    rows = c36._require_rows(store, SESSION)
    assert not [r for r in rows if r["state"] == "run_failed" or any(e["state"] == "run_failed" for e in c36._history(r))]
    assert all(r["state"] in c36.TERMINAL for r in rows)
