"""REQ-147 (Amr decision 2A): a run that finds no exception writes zero rows, and that is a valid result. The written-key
check refused it ("holds no row with run_id ..., although run_use_case() said it wrote 0 rows"), and its repair hint
asked for the run_id on every row, which a zero-row run cannot have. A zero-row run passes the check; a run that says it
wrote rows and left none under its run_id still fails, with a hint that names the rows."""

ZERO = {"row_count": 0, "dated_rows": 0, "own_rows": 0, "current_rows": 0}
TABLE = "inspire_kinds_rc7._inspire_walk_v153_e2e_n01_u01.n01_u01_results"


def test_a_zero_row_run_passes_the_written_key_check(agent_ns):
    problems = agent_ns["implement_written_key_problems"]({"rows_written": 0, "as_of_date": "2024-05-17", "run_id": "r-0"},
                                                          "N01-U01", ZERO, TABLE)
    assert problems == [], problems


def test_a_run_that_says_it_wrote_rows_and_left_none_still_fails_with_a_row_hint(agent_ns):
    problems = agent_ns["implement_written_key_problems"]({"rows_written": 12, "as_of_date": "2024-05-17", "run_id": "r-1"},
                                                          "N01-U01", ZERO, TABLE)
    assert len(problems) == 1 and "said it wrote 12 rows" in problems[0], problems
    assert "write each of those rows with the run_id the outcome returns" in problems[0], problems[0]
    assert "on every row" not in problems[0]
