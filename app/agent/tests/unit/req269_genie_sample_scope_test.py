"""REQ-269: a Genie answer over a sampled first-run scope says it covers the first-run sample and its record count; a count that read
the scope's own source table is a full-table answer and is never labelled sample-based."""
import os
import sys

TESTS = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(os.path.dirname(os.path.dirname(TESTS)), "agent", "app_shell", "server")
for path in (SERVER, TESTS):
    if path not in sys.path:
        sys.path.insert(0, path)

import shell_agent  # noqa: E402

SOURCE = "cat_a._inspire.trips"
SCOPE = {"scope": "records", "table": SOURCE, "records": 1000, "key": "trip_id"}


def finish(sql, text="There were 4 trips (sample-based)."):
    return shell_agent.finish_text(text, "How many trips?", genie=[{"sql": sql, "rows": [], "scope": SCOPE}])


def test_a_count_over_a_result_table_of_a_sampled_scope_names_the_first_run_sample_and_its_records():
    out = finish("SELECT COUNT(*) FROM cat_a._inspire.trips_scored WHERE trip_date BETWEEN '2016-02-01' AND '2016-02-07'")
    assert out.endswith("Counted over the first-run sample of 1,000 records."), out
    assert "whole" not in out


def test_a_join_that_reads_a_result_table_is_still_the_sample():
    out = finish("SELECT COUNT(*) FROM cat_a._inspire.trips t JOIN cat_a._inspire.trips_scored s ON t.trip_id = s.trip_id")
    assert out.endswith("Counted over the first-run sample of 1,000 records."), out


def test_a_count_over_the_scopes_own_source_table_is_whole_table_and_never_sample_based():
    out = finish("SELECT COUNT(*) FROM `cat_a`.`_inspire`.`TRIPS` WHERE trip_date BETWEEN '2016-02-01' AND '2016-02-07'")
    assert "sample" not in out.casefold(), out
    assert out.endswith("Counted over the whole trips table."), out
    assert "(sample-based)" not in out
