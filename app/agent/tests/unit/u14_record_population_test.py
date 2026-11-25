"""REQ-400: the record explanation compares the record with the whole list, from one deterministic read of the App's own table.
Every number comes from the aggregate or from the run's own columns, never from the model. The fixture is shaped like a
flagged record: an exception score the list ranks by, a q value, and the chips the run wrote into the reasons column."""
import copy

from v141_app_shell_test import PAGE, shell  # noqa: F401  (loads the shell module path)
import shell_core
import shell_sql

SCORE = "exception_score"
PAGE_RANKED = dict(copy.deepcopy(PAGE), result_table="cat.sch.tbl")
PAGE_RANKED["records"] = dict(PAGE_RANKED.get("records") or {}, rank=SCORE, tier="priority_tier", reasons="top_reasons",
                              columns=[{"column": SCORE, "label": "Exception score", "format": "number"}])
REASONS = ["daily takings 0", "against a baseline mean of 87 · EWMA 0", "against a lower limit of 32.6 · transactions 0",
           "against a baseline mean of 2.5"]
# 212 records, the flagged one is the top: 0 records above it, 211 below it.
STATS = {"n": 212, "mean": 1.0, "sd": 0.9, "above": 0, "below": 211, "flagged": 212}
RECORD = {"record_key": "R1", SCORE: 4.79, "priority_tier": "Monitor", "top_reasons": "; ".join(REASONS), "q_value": 0.004}
SENTENCE = (
    "Compared to the rest: its Exception score is 4.79, 4.21 sigma above the average of 1 (spread 0.9, z-score +4.21). "
    "It ranks 1 of 212, higher than 99.5% of records. It has q value 0.004. "
    "Against: daily takings 0; against a baseline mean of 87 · EWMA 0; against a lower limit of 32.6 · transactions 0; "
    "against a baseline mean of 2.5. 212 of 212 records are flagged."
)


def test_the_sentence_states_score_sigma_rank_q_value_and_the_run_reasons_from_the_read():
    out = shell_core.population_summary(4.79, STATS, label="Exception score", against=REASONS, quality="q value 0.004")
    assert (out["count"], out["text"]) == (212, SENTENCE) and out["compared"]["rank"] == 1


def test_a_record_below_the_average_reads_below_and_its_rank_counts_the_records_above_it():
    stats = {"n": 5, "mean": 100, "sd": 50, "above": 4, "below": 0, "flagged": 5}
    text = shell_core.population_summary(50, stats, label="Exception score")["text"]
    assert "its Exception score is 50, 1.00 sigma below the average of 100 (spread 50, z-score -1.00)" in text
    assert "It ranks 5 of 5, higher than 0% of records." in text


def test_a_list_with_no_spread_says_so_and_shows_no_sigma():
    text = shell_core.population_summary(7, {"n": 4, "mean": 7, "sd": 0, "above": 0, "below": 0, "flagged": 4}, label="Exception score")["text"]
    assert "with no spread across the list, so no sigma is shown" in text


def test_a_record_with_no_score_is_named_plainly_and_an_empty_list_says_nothing():
    assert shell_core.population_summary(None, STATS, label="Exception score")["text"] == (
        "Compared to the rest: this record has no Exception score, so it cannot be placed against the 212 records on this list.")
    assert shell_core.population_summary(10, {"n": 0}) == {"count": 0, "text": ""}


def test_a_q_value_is_only_named_when_the_run_wrote_one():
    assert shell_core.q_value_text({"q_value": 0.004}) == "q value 0.004"
    assert shell_core.q_value_text({"p_value": None, "pvalue": 0.2}) == "pvalue 0.2"
    assert shell_core.q_value_text({SCORE: 4.79}) == ""


def test_the_reasons_read_as_the_chips_do_and_skip_empty_text():
    assert shell_core.reasons_text("daily takings 0; against a lower limit of 32.6") == ["daily takings 0", "against a lower limit of 32.6"]
    assert shell_core.reasons_text(None) == [] and shell_core.reasons_text("") == []


def test_the_population_query_is_one_portable_aggregate_over_the_current_rows():
    sql, params = shell_sql.population_query("cat.sch.tbl", SCORE, "priority_tier", 4.79)
    assert "COUNT_IF" not in sql, "COUNT_IF is not portable to every backend this App runs on"
    assert "STDDEV_SAMP(d.s)" in sql and "SUM(CASE WHEN d.s > :p0 THEN 1 ELSE 0 END)" in sql
    assert "is_current AND change_source <> 'delete'" in sql
    assert params == [{"name": "p0", "value": 4.79, "type": "DOUBLE"}]


class _Rows:
    """Stands in for the App's execute(): the first call reads the record, the second reads the aggregate."""
    def __init__(self, record, stats):
        self.calls, self.record, self.stats = [], record, stats

    def __call__(self, ws, sql, params, limit, delta=False, **_):
        self.calls.append(sql)
        return {"rows": [self.record] if len(self.calls) == 1 else [self.stats]}


def _shell(record):
    fake = _Rows(record, STATS)
    s = shell_core.Shell.__new__(shell_core.Shell)
    s.execute = fake
    return s, fake


def test_population_of_ranks_by_the_page_ranking_column_with_its_reasons_and_q_value():
    s, fake = _shell(RECORD)
    out = shell_core.Shell.population_of(s, object(), PAGE_RANKED, "R1")
    assert (out["count"], out["text"]) == (212, SENTENCE) and out["compared"]["rank"] == 1
    assert "record_key" in fake.calls[0] and "STDDEV_SAMP" in fake.calls[1]


def test_population_of_shows_a_line_for_a_page_that_ranks_by_a_column_the_record_has_no_score_in():
    s, _ = _shell(dict(RECORD, **{SCORE: None}))
    out = shell_core.Shell.population_of(s, object(), PAGE_RANKED, "R1")
    assert out["text"].startswith("Compared to the rest: this record has no Exception score")


def test_population_of_says_nothing_when_the_page_has_no_ranking_column_in_the_table():
    s, fake = _shell({"record_key": "R1", "priority_tier": "Monitor"})
    assert shell_core.Shell.population_of(s, object(), PAGE_RANKED, "R1") == {"count": 0, "text": ""}
    assert len(fake.calls) == 1


def test_the_model_prompt_for_a_record_carries_the_same_population_line():
    text = shell_core.explain_question("Pricing desk", PAGE, "record", "Item number 1", {"tier": "Act now", "population": SENTENCE})
    assert SENTENCE in text
