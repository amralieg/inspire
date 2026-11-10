"""A scheduled refresh with a First run choice that covers every record must not sort the whole table before every step, and a use case
that runs past its budget stops with a plain reason instead of holding the job until the job timeout."""
import threading

import pytest

from v130_genie_run_controls_test import _controls


class SortTrap:
    def __init__(self, rows):
        self.rows = rows
        self.columns = ["id", "value"]
        self.dtypes = [("id", "bigint"), ("value", "string")]
        self.sorted_calls = 0

    def count(self):
        return self.rows

    def orderBy(self, *_args):
        self.sorted_calls += 1
        return self

    def limit(self, _n):
        self.sorted_calls += 1
        return self


class FakeSession:
    def __init__(self, rows):
        self.rows = rows
        self.frames = []

    def table(self, _name):
        frame = SortTrap(self.rows)
        self.frames.append(frame)
        return frame


def _records_scope(records):
    return {"scope": "records", "table": "main.sales.orders", "records": records, "key": "id", "technique": "x"}


@pytest.mark.parametrize("records", [30, 500])
def test_a_first_run_covering_every_record_reads_the_table_without_a_global_sort(fresh_ns, records):
    fresh_ns["INSPIRE_SCOPE"], fresh_ns["INSPIRE_RUN_LOG"] = _records_scope(records), {}
    spark = FakeSession(rows=30)
    fresh_ns["inspire_read_source"]("main.sales.orders", spark=spark)
    assert spark.frames[0].sorted_calls == 0, "a limit at or above the row count sorts 30 rows for nothing and re-sorts every step"
    assert fresh_ns["INSPIRE_RUN_LOG"]["reads"]["main.sales.orders"]["limit"] is None


def test_a_first_run_smaller_than_the_table_still_samples_it(fresh_ns):
    fresh_ns["INSPIRE_SCOPE"], fresh_ns["INSPIRE_RUN_LOG"] = _records_scope(10), {}
    spark = FakeSession(rows=30)
    fresh_ns["inspire_read_source"]("main.sales.orders", spark=spark)
    assert spark.frames[0].sorted_calls == 2, "a real sample of 10 of 30 records must keep its ORDER BY hash and LIMIT"


class HangingSession:
    def __init__(self):
        self.interrupted = False
        self.stop = threading.Event()

    def interruptAll(self):
        self.interrupted = True
        self.stop.set()


def _hung_step(session):
    if not session.stop.wait(10):
        raise AssertionError("the watchdog never interrupted the session")
    raise RuntimeError("cancelled by interrupt")


@pytest.fixture
def runtime(agent_ns):
    ns, _call = _controls(agent_ns)
    return ns


def test_a_use_case_past_its_budget_stops_with_a_plain_reason_and_interrupts_the_session(runtime):
    session = HangingSession()
    with pytest.raises(BaseException) as caught:
        runtime["inspire_run_use_case"](lambda: _hung_step(session), session, seconds=0.2)
    assert type(caught.value).__name__ == "InspireRunStop"
    assert str(caught.value).startswith("stopped without writing: the run went over 0 minutes without finishing")
    assert "choose a smaller First run on the Run page" in str(caught.value)
    assert session.interrupted is True


def test_a_use_case_that_finishes_returns_its_outcome(runtime):
    outcome = {"status": "written", "rows_written": 1, "as_of_date": "2026-11-09", "run_id": "r"}
    assert runtime["inspire_run_use_case"](lambda: outcome, HangingSession(), seconds=5) == outcome


def test_a_use_case_error_reaches_the_caller_unchanged(runtime):
    def boom():
        raise ValueError("bad widget")
    with pytest.raises(ValueError, match="bad widget"):
        runtime["inspire_run_use_case"](boom, HangingSession(), seconds=5)
