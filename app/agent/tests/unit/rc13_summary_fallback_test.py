"""REQ-147 (round 4): a deterministic sentence must not depend on the AI summary. When the AI endpoint is empty or
gives no reply, the run's summary row still stores the data-age and cut-off sentences, so the App always shows the
cut-off. The AI text is not stored in that case."""
from v120_artifacts_support import FakeSpark
from v147_value_at_stake_test import QUOTED_SUMMARY, ROW_READ, SUMMARY, TABLE, _describe, _summary_spark

CUTOFF = "Reads rows dated before 2026-10-29; rows on 2026-10-29 are left out because that day may be incomplete."


def test_an_empty_ai_endpoint_still_stores_the_cut_off_sentence(agent_ns, monkeypatch):
    monkeypatch.setitem(agent_ns, "INSPIRE_RUN", {"use_case_id": "N01-U02", "ai_context": "Business: Acme"})
    asked, printed = [], []
    spark = _summary_spark(None, asked)
    result = agent_ns["inspire_write_summary"]("rows written: 4 rows", TABLE, "r-3", "2026-10-29", spark, "", None, printed.append)
    assert CUTOFF in result, result
    merges = [s for s in spark.statements if s.startswith(f"MERGE INTO {QUOTED_SUMMARY}")]
    assert merges and CUTOFF in merges[0], merges
    assert asked == [], "no AI call is made when the endpoint is empty"


def test_an_empty_ai_reply_still_stores_the_cut_off_sentence(agent_ns, monkeypatch):
    monkeypatch.setitem(agent_ns, "INSPIRE_RUN", {"use_case_id": "N01-U02", "ai_context": "Business: Acme"})
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
