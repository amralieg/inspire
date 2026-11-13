"""REQ-147 (round 4): a deterministic sentence must not depend on the AI summary. When the AI endpoint is empty or
gives no reply, the run's summary row still stores the data-age and cut-off sentences, so the App always shows the
cut-off. The AI text is not stored in that case."""
import pytest

from v120_artifacts_support import FakeSpark
from v147_value_at_stake_test import QUOTED_SUMMARY, ROW_READ, SUMMARY, TABLE, _describe, _summary_spark

CUTOFF = "Reads rows dated before 2026-10-29; rows on 2026-10-29 are left out because that day may be incomplete."
CUTOFF_COUNTED = "Reads rows dated before 2026-10-29; 3,333 rows on 2026-10-29 are left out because that day may be incomplete."
TIMED = [{"table": "main.inspire.churn_out_src", "column": "order_date"}]


def test_an_empty_ai_endpoint_still_stores_the_cut_off_sentence(agent_ns, monkeypatch):
    monkeypatch.setitem(agent_ns, "INSPIRE_RUN", {"use_case_id": "N01-U02", "ai_context": "Business: Acme", "cut_off_tables": TIMED})
    asked, printed = [], []
    spark = _summary_spark(None, asked)
    result = agent_ns["inspire_write_summary"]("rows written: 4 rows", TABLE, "r-3", "2026-10-29", spark, "", None, printed.append)
    assert CUTOFF in result, result
    merges = [s for s in spark.statements if s.startswith(f"MERGE INTO {QUOTED_SUMMARY}")]
    assert merges and CUTOFF in merges[0], merges
    assert asked == [], "no AI call is made when the endpoint is empty"


def test_an_empty_ai_reply_still_stores_the_cut_off_sentence(agent_ns, monkeypatch):
    monkeypatch.setitem(agent_ns, "INSPIRE_RUN", {"use_case_id": "N01-U02", "ai_context": "Business: Acme", "cut_off_tables": TIMED})
    asked, printed = [], []
    def respond(statement):
        if statement == ROW_READ:
            return []
        if statement.startswith("SELECT ai_query("):
            asked.append(statement)
            return [{"r": {"result": "", "errorMessage": None}}]
        if statement == f"DESCRIBE TABLE {QUOTED_SUMMARY}":
            return _describe(SUMMARY)
        return []
    spark = FakeSpark(responder=respond)
    agent_ns["inspire_write_summary"]("rows written: 4 rows", TABLE, "r-3", "2026-10-29", spark, "ep", None, printed.append)
    merges = [s for s in spark.statements if s.startswith(f"MERGE INTO {QUOTED_SUMMARY}")]
    assert merges and CUTOFF in merges[-1], merges


def test_the_stored_summary_states_how_many_rows_on_the_as_of_day_are_left_out(agent_ns, monkeypatch):
    monkeypatch.setitem(agent_ns, "INSPIRE_RUN", {"use_case_id": "N01-U02", "ai_context": "Business: Acme", "cut_off_tables": TIMED})
    spark = FakeSpark(responder=lambda statement: [{"n": 3333}] if "COUNT(*) AS n" in statement else [])
    agent_ns["inspire_write_summary"]("rows written: 4 rows", TABLE, "r-3", "2026-10-29", spark, "", None, [].append)
    merges = [s for s in spark.statements if s.startswith(f"MERGE INTO {QUOTED_SUMMARY}")]
    assert merges and CUTOFF_COUNTED in merges[0], merges


def test_a_run_with_no_time_column_stores_no_cut_off_sentence(agent_ns, monkeypatch):
    monkeypatch.setitem(agent_ns, "INSPIRE_RUN", {"use_case_id": "N01-U02", "ai_context": "Business: Acme", "cut_off_tables": []})
    spark = FakeSpark(responder=lambda statement: pytest.fail("no date cut-off, so nothing is counted") if "COUNT(*)" in statement else [])
    result = agent_ns["inspire_write_summary"]("rows written: 4 rows", TABLE, "r-3", "2026-10-29", spark, "", None, [].append)
    assert "Reads rows dated before" not in result
    merges = [s for s in spark.statements if s.startswith(f"MERGE INTO {QUOTED_SUMMARY}")]
    assert merges and "Reads rows dated before" not in merges[0]
