"""REQ-147 gap 2 (as-of cut-off): the stored run summary states the as-of cut-off in words, because the run reads rows strictly
before as_of_date and leaves out the rows on that day, which may be incomplete. The sentence also states how many rows on that day
are left out: they are counted in the run's scope table on its time column (the first_run spec the use case names). When the run
names no time column, the sentence says the count is unknown, never a made-up number."""
import pytest

from v120_artifacts_support import FakeSpark

FIRST_RUN = {"table": "main.inspire.churn_out_src", "time_column": "order_date"}


def test_the_cut_off_sentence_names_the_as_of_day_and_the_day_before_it_is_read(agent_ns):
    assert agent_ns["inspire_cutoff_fact"]("2024-05-17") == (
        "Reads rows dated before 2024-05-17; rows on 2024-05-17 are left out because that day may be incomplete, and Inspire did not count them.")
    assert agent_ns["inspire_cutoff_fact"]("2024-05-17T00:00:00") == agent_ns["inspire_cutoff_fact"]("2024-05-17")


@pytest.mark.parametrize("left_out,said", [
    (3333, "3,333 rows on 2024-05-17 are left out"),
    (1, "1 row on 2024-05-17 is left out"),
    (0, "0 rows on 2024-05-17 are left out"),
])
def test_the_cut_off_sentence_states_how_many_rows_on_that_day_are_left_out(agent_ns, left_out, said):
    assert agent_ns["inspire_cutoff_fact"]("2024-05-17", left_out) == (
        f"Reads rows dated before 2024-05-17; {said} because that day may be incomplete.")


def test_an_unreadable_as_of_date_states_no_cut_off(agent_ns):
    assert agent_ns["inspire_cutoff_fact"]("") == ""
    assert agent_ns["inspire_cutoff_fact"]("latest") == ""
    assert agent_ns["inspire_cutoff_fact"](None) == ""
    assert agent_ns["inspire_cutoff_fact"]("latest", 5) == ""


def test_the_left_out_count_is_the_rows_dated_on_the_as_of_day_in_the_scope_table(agent_ns, monkeypatch):
    monkeypatch.setitem(agent_ns, "INSPIRE_RUN", {"scope": dict(FIRST_RUN)})
    statements = []

    def respond(statement):
        statements.append(statement)
        return [{"n": 14}] if "COUNT(*) AS n" in statement else []
    spark = FakeSpark(responder=respond)
    assert agent_ns["inspire_cutoff_left_out"](spark, "2024-05-17", printed := []) == 14, printed
    assert len(statements) == 1
    assert "churn_out_src" in statements[0] and "order_date" in statements[0] and "'2024-05-17'" in statements[0]
    assert "<" not in statements[0] and ">" not in statements[0], "the count is rows ON the day, the day before is read"


@pytest.mark.parametrize("run", [{}, {"scope": {"table": FIRST_RUN["table"]}}, {"scope": {"time_column": "order_date"}}],
                         ids=["no_scope", "no_time_column", "no_table"])
def test_a_run_that_names_no_table_and_time_column_counts_nothing_and_reads_nothing(agent_ns, monkeypatch, run):
    monkeypatch.setitem(agent_ns, "INSPIRE_RUN", run)
    spark = FakeSpark()
    assert agent_ns["inspire_cutoff_left_out"](spark, "2024-05-17") is None
    assert spark.statements == []


def test_a_count_that_cannot_be_read_is_unknown_and_says_why(agent_ns, monkeypatch):
    monkeypatch.setitem(agent_ns, "INSPIRE_RUN", {"scope": dict(FIRST_RUN)})

    def respond(statement):
        raise RuntimeError("[UNRESOLVED_COLUMN] order_date")
    printed = []
    assert agent_ns["inspire_cutoff_left_out"](FakeSpark(responder=respond), "2024-05-17", printed.append) is None
    assert printed and "could not count the rows on 2024-05-17 that the cut-off leaves out" in printed[0]
    assert "UNRESOLVED_COLUMN" in printed[0]
