from unittest.mock import MagicMock

from v120_artifacts_support import FakeSpark
from v120_genie_support import StatusRecorder, build_inspire
from v153_signal_check_test import Agent, answer, uc

VISITS = "main.s.visits"
COLUMNS = {VISITS: {"visit_date": "string", "visit_day": "date", "visits": "int", "region": "string", "birth_text": "string"}}
SERIES_ROW = {"periods": 60, "median_gap": 1, "first_period": "2024-01-01", "last_period": "2024-02-29", "lag1": 0.7, "lag7": 0.8}


class Loader:
    def get_metadata_evidence(self, tables):
        return {t: {"columns": {n: {"name": n, "type": k} for n, k in COLUMNS[t].items()}, "foreign_keys": []}
                for t in tables if t in COLUMNS}


def _inspire(agent_ns, answers, respond):
    spark = FakeSpark(responder=respond)
    inst = build_inspire(agent_ns, loader=Loader(), agent=Agent(answers))
    inst.logger = MagicMock()
    inst.discovery_type = "Deep"
    inst.deep_evidence = agent_ns["DeepEvidence"](spark, "Deep", MagicMock())
    inst.discovery_evidence = {"profiles": {VISITS: {"rows": 1900, "sampled": False, "columns": {}}}, "join_matches": [],
                               "data_access": {}}
    inst._emit_pipeline_status = StatusRecorder()
    inst.user_business_domains = []
    return inst, spark


def _probe(filled, parsed_by_format):
    def respond(statement):
        if "AS filled" in statement:
            row = {"filled": filled}
            row.update({f"f{index}": parsed_by_format.get(index, 0) for index in range(9)})
            return [row]
        if "AS median_gap" in statement:
            return [SERIES_ROW]
        if "AS reportable_groups" in statement:
            return [{"n": 1900, "groups": 6, "reportable_groups": 6, "periods": 60}]
        raise AssertionError(statement)
    return respond


def test_a_forecast_on_a_text_date_column_is_checked_once_its_dates_parse(agent_ns):
    ucs = [uc("N01-U01", "Forecasting", tables=VISITS)]
    answers = [{"results": [answer("N01-U01", {"time": "visit_date", "measure": "visits"}, table=VISITS)]}]
    inst, spark = _inspire(agent_ns, answers, _probe(1900, {8: 1900}))
    kept, dropped = inst._check_data_signal(ucs, [])
    record = ucs[0]["data_signal"]
    assert record["status"] == "passed" and record["date_formats"] == {"time": "timestamp text"}
    assert "CAST(try_cast(`visit_date` AS TIMESTAMP) AS DATE) AS d" in spark.statements[-1]
    assert "CAST(try_cast(`visit_date` AS TIMESTAMP) AS DATE) IS NOT NULL" in spark.statements[-1]
    assert kept == ucs and dropped == []


def test_the_format_that_reads_the_most_values_is_used(agent_ns):
    ucs = [uc("N01-U01", "Forecasting", tables=VISITS)]
    answers = [{"results": [answer("N01-U01", {"time": "visit_date"}, table=VISITS)]}]
    inst, spark = _inspire(agent_ns, answers, _probe(1900, {0: 1900, 8: 1900}))
    inst._check_data_signal(ucs, [])
    assert ucs[0]["data_signal"]["date_formats"] == {"time": "yyyyMMdd"}
    assert "try_to_timestamp(`visit_date`, 'yyyyMMdd')" in spark.statements[-1]


def test_text_that_does_not_read_as_dates_stays_unchecked_and_says_how_many_read(agent_ns):
    ucs = [uc("N01-U01", "Forecasting", tables=VISITS)]
    answers = [{"results": [answer("N01-U01", {"time": "visit_date"}, table=VISITS)]}]
    inst, spark = _inspire(agent_ns, answers, _probe(1900, {8: 1200}))
    kept, _dropped = inst._check_data_signal(ucs, [])
    assert kept == ucs and ucs[0]["data_signal"]["status"] == "not_checked"
    assert ucs[0]["data_signal"]["reason"] == ("Not checked: the time column visit_date is text and only 1200 of 1900 "
                                               "values read as dates.")
    assert len(spark.statements) == 1, "the series is never read on dates that do not parse"


def test_a_text_date_on_a_trend_check_is_read_as_a_date_and_a_real_date_is_cast_as_before(agent_ns):
    ucs = [uc("N01-U01", "Trend Analysis", tables=VISITS), uc("N01-U02", "Forecasting", tables=VISITS)]
    answers = [{"results": [answer("N01-U01", {"group": "region", "time": "visit_date"}, table=VISITS),
                            answer("N01-U02", {"time": "visit_day"}, table=VISITS)]}]
    inst, spark = _inspire(agent_ns, answers, _probe(1900, {8: 1900}))
    inst._check_data_signal(ucs, [])
    assert [u["data_signal"]["status"] for u in ucs] == ["passed", "passed"]
    assert any("CAST(try_cast(`visit_date` AS TIMESTAMP) AS DATE) AS d" in s and "AS reportable_groups" in s
               for s in spark.statements)
    series = [s for s in spark.statements if "AS median_gap" in s]
    assert series and "CAST(`visit_day` AS DATE) AS d" in series[0] and "try_" not in series[0]


def test_a_text_column_that_is_not_a_date_role_is_still_refused(agent_ns):
    ucs = [uc("N01-U01", "Anomaly Detection", tables=VISITS)]
    answers = [{"results": [answer("N01-U01", {"measure": "visit_date"}, table=VISITS)]}]
    inst, spark = _inspire(agent_ns, answers, _probe(1900, {8: 1900}))
    inst._check_data_signal(ucs, [])
    assert ucs[0]["data_signal"]["reason"] == "Not checked: the measure column visit_date is string, not numeric."
    assert spark.statements == []
