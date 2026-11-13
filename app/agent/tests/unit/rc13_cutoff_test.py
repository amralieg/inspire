"""REQ-147 gap 2 (as-of cut-off, coordinator decision 13:24 GMT). A cut-off applies only to a table the run reads through a time
column (INSPIRE_RUN cut_off_tables). No such table: no sentence at all. One table: one total of its rows dated on the as-of day.
Two or more tables: each table's count. A count that cannot be read is stated as unavailable, never as a number."""
import pytest

from v120_artifacts_support import FakeSpark

DAY = "2024-05-17"
ONE = {"table": "main.inspire.churn_out_src", "column": "order_date"}
OTHER = {"table": "main.inspire.returns_src", "column": "returned_on"}


def _tables(monkeypatch, agent_ns, tables):
    monkeypatch.setitem(agent_ns, "INSPIRE_RUN", {"cut_off_tables": tables})


def _counting(counts):
    def respond(statement):
        for table, n in counts.items():
            if table.split(".")[-1] in statement and "COUNT(*) AS n" in statement:
                return [{"n": n}]
        return []
    return respond


def test_no_time_column_means_no_cut_off_sentence_at_all(agent_ns, monkeypatch):
    _tables(monkeypatch, agent_ns, [])
    assert agent_ns["inspire_cutoff_fact"](DAY) == ""
    assert agent_ns["inspire_cutoff_fact"](DAY, []) == ""
    spark = FakeSpark()
    assert agent_ns["inspire_cutoff_counts"](spark, DAY) == [] and spark.statements == [], "no table is read by date, so nothing is counted"
    assert "Reads rows dated before" not in agent_ns["inspire_deterministic_summary"](DAY, [])


@pytest.mark.parametrize("left_out,said", [
    (3333, "3,333 rows on 2024-05-17 are left out"),
    (1, "1 row on 2024-05-17 is left out"),
    (0, "0 rows on 2024-05-17 are left out"),
])
def test_one_table_states_one_total_of_the_rows_dated_on_the_as_of_day(agent_ns, monkeypatch, left_out, said):
    _tables(monkeypatch, agent_ns, [ONE])
    spark = FakeSpark(responder=_counting({ONE["table"]: left_out}))
    counts = agent_ns["inspire_cutoff_counts"](spark, DAY)
    assert counts == [(ONE["table"], left_out)]
    assert len(spark.statements) == 1
    assert "churn_out_src" in spark.statements[0] and "order_date" in spark.statements[0] and "2024-05-17" in spark.statements[0]
    assert agent_ns["inspire_cutoff_fact"](DAY, counts) == f"Reads rows dated before {DAY}; {said} because that day may be incomplete."


def test_one_table_whose_count_cannot_be_read_keeps_the_cut_off_without_a_number(agent_ns, monkeypatch):
    _tables(monkeypatch, agent_ns, [ONE])

    def respond(statement):
        raise RuntimeError("[UNRESOLVED_COLUMN] order_date")
    printed = []
    counts = agent_ns["inspire_cutoff_counts"](FakeSpark(responder=respond), DAY, printed.append)
    assert counts == [(ONE["table"], None)]
    assert agent_ns["inspire_cutoff_fact"](DAY, counts) == (
        f"Reads rows dated before {DAY}; rows on {DAY} are left out because that day may be incomplete.")
    assert printed and ONE["table"] in printed[0] and "UNRESOLVED_COLUMN" in printed[0]


def test_two_tables_state_each_tables_count(agent_ns, monkeypatch):
    _tables(monkeypatch, agent_ns, [ONE, OTHER])
    spark = FakeSpark(responder=_counting({ONE["table"]: 14, OTHER["table"]: 0}))
    counts = agent_ns["inspire_cutoff_counts"](spark, DAY)
    assert counts == [(ONE["table"], 14), (OTHER["table"], 0)]
    assert len(spark.statements) == 2 and "returned_on" in spark.statements[1]
    assert agent_ns["inspire_cutoff_fact"](DAY, counts) == (
        "Reads rows dated before 2024-05-17; rows on 2024-05-17 are left out of main.inspire.churn_out_src (14 rows) and "
        "main.inspire.returns_src (0 rows) because that day may be incomplete.")


def test_two_tables_with_one_unreadable_count_say_so_for_that_table_only(agent_ns, monkeypatch):
    _tables(monkeypatch, agent_ns, [ONE, OTHER])

    def respond(statement):
        if "returns_src" in statement:
            raise RuntimeError("PERMISSION_DENIED")
        return [{"n": 14}]
    counts = agent_ns["inspire_cutoff_counts"](FakeSpark(responder=respond), DAY, [].append)
    assert counts == [(ONE["table"], 14), (OTHER["table"], None)]
    assert agent_ns["inspire_cutoff_fact"](DAY, counts).endswith(
        "left out of main.inspire.churn_out_src (14 rows) and main.inspire.returns_src (count unavailable) because that day may be incomplete.")


def test_an_unreadable_as_of_date_states_no_cut_off(agent_ns, monkeypatch):
    _tables(monkeypatch, agent_ns, [ONE])
    assert agent_ns["inspire_cutoff_fact"]("", [(ONE["table"], 5)]) == ""
    assert agent_ns["inspire_cutoff_fact"]("latest", [(ONE["table"], 5)]) == ""
    assert agent_ns["inspire_cutoff_counts"](FakeSpark(), "latest") == []
