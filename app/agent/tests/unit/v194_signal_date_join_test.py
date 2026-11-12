import datetime
import json
import os
import sys
from unittest.mock import MagicMock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v120_artifacts_support import FakeSpark
from v120_genie_support import StatusRecorder, build_inspire

SALES = "main.s.web_sales"
DATES = "main.s.date_dim"
COLUMNS = {
    SALES: {"ws_sold_date_sk": "int", "ws_item_sk": "int", "ws_quantity": "int", "ws_net_paid": "decimal(7,2)"},
    DATES: {"d_date_sk": "int", "d_date": "date", "d_year": "int"},
}
DATE_FK = {"column": "ws_sold_date_sk", "ref_table": DATES, "ref_column": "d_date_sk", "source": "inferred", "confidence": 0.9}
SERIES = {"periods": 60, "median_gap": 1, "first_period": datetime.date(2016, 1, 1),
          "last_period": datetime.date(2016, 2, 29), "lag1": 0.7, "lag7": 0.8}
GROUPS = {"n": 5000, "groups": 12, "reportable_groups": 8, "periods": 60}


class Agent:
    def __init__(self, answers):
        self.answers = list(answers)
        self.calls = []

    def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema=None, timeout_override=None,
                   skip_cache=False, **_kw):
        self.calls.append({"prompt": worker_prompt_path, "vars": dict(prompt_vars)})
        return json.dumps(self.answers.pop(0) if self.answers else {"results": []})


class Loader:
    def __init__(self, foreign_keys, columns=None):
        self.foreign_keys = foreign_keys
        self.columns = columns or COLUMNS

    def get_metadata_evidence(self, tables):
        return {t: {"columns": {name: {"name": name, "type": kind} for name, kind in self.columns[t].items()},
                    "foreign_keys": list(self.foreign_keys) if t == SALES else []}
                for t in tables if t in self.columns}


def uc(uc_id, technique):
    return {"No": uc_id, "Name": f"Use case {uc_id}", "Analytics Technique": technique, "Tables Involved": SALES,
            "Business Domain": "Sales", "Inspire Score": 4.0, "scoring_status": "scored"}


def answer(uc_id, roles):
    return {"No": uc_id, "table": SALES, "roles": roles, "note": ""}


def responder(keys=(73049, 73049)):
    def respond(statement):
        if "COUNT(DISTINCT `d_date_sk`)" in statement:
            return [{"n": keys[0], "k": keys[1]}]
        if "AS median_gap" in statement:
            return [SERIES]
        if "AS reportable_groups" in statement:
            return [GROUPS]
        raise AssertionError(f"unexpected statement: {statement}")
    return respond


def deep_inspire(agent_ns, answers, foreign_keys=(DATE_FK,), keys=(73049, 73049), columns=None):
    spark = FakeSpark(responder=responder(keys))
    agent = Agent(answers)
    inst = build_inspire(agent_ns, loader=Loader(foreign_keys, columns), agent=agent)
    inst.logger = MagicMock()
    inst.discovery_type = "Deep"
    inst.deep_evidence = agent_ns["DeepEvidence"](spark, "Deep", MagicMock())
    inst.discovery_evidence = {"profiles": {SALES: {"rows": 1000, "sampled": False, "columns": {}}},
                               "join_matches": [], "data_access": {}}
    inst._emit_pipeline_status = StatusRecorder()
    inst.user_business_domains = []
    return inst, agent, spark


SERIES_ROLES = {"time": "ws_sold_date_sk", "measure": "ws_quantity"}


def test_a_date_that_sits_in_the_date_table_is_read_through_its_key_and_the_use_case_is_checked(agent_ns):
    ucs = [uc("N01-U01", "Forecasting")]
    inst, agent, spark = deep_inspire(agent_ns, [{"results": [answer("N01-U01", SERIES_ROLES)]}])
    kept, dropped = inst._check_data_signal(ucs, [])
    record = ucs[0]["data_signal"]
    assert record["status"] == "passed", record
    assert kept == ucs and dropped == []
    assert record["columns"]["time"] == "ws_sold_date_sk -> main.s.date_dim.d_date"
    unique, series = spark.statements
    assert unique == "SELECT COUNT(`d_date_sk`) AS n, COUNT(DISTINCT `d_date_sk`) AS k FROM `main`.`s`.`date_dim`"
    assert ("FROM (SELECT f.*, j0.`d_date` AS `inspire_time_date` FROM (SELECT * FROM `main`.`s`.`web_sales`) AS f LEFT JOIN "
            "`main`.`s`.`date_dim` AS j0 ON f.`ws_sold_date_sk` = j0.`d_date_sk`) AS joined") in series
    assert "CAST(`inspire_time_date` AS DATE) AS d" in series and "`inspire_time_date` IS NOT NULL" in series
    assert "date keys: ws_sold_date_sk of main.s.web_sales reads main.s.date_dim.d_date" in agent.calls[0]["vars"]["use_cases_listing"]


def test_a_date_table_whose_key_repeats_is_never_joined_and_the_use_case_stays_unchecked_with_the_reason(agent_ns):
    ucs = [uc("N01-U01", "Forecasting")]
    inst, _agent, spark = deep_inspire(agent_ns, [{"results": [answer("N01-U01", SERIES_ROLES)]}], keys=(73049, 70000))
    kept, _dropped = inst._check_data_signal(ucs, [])
    record = ucs[0]["data_signal"]
    assert record["status"] == "not_checked" and kept == ucs
    assert record["reason"] == ("Not checked: the date table main.s.date_dim holds 73,049 d_date_sk values for 70,000 "
                                "distinct keys, so joining ws_sold_date_sk to it would repeat rows.")
    assert len(spark.statements) == 1 and "JOIN" not in spark.statements[0]


def test_a_date_table_with_no_keys_is_never_joined(agent_ns):
    ucs = [uc("N01-U01", "Forecasting")]
    inst, _agent, spark = deep_inspire(agent_ns, [{"results": [answer("N01-U01", SERIES_ROLES)]}], keys=(0, 0))
    inst._check_data_signal(ucs, [])
    assert ucs[0]["data_signal"]["reason"] == ("Not checked: the date table main.s.date_dim holds no d_date_sk values to join "
                                               "ws_sold_date_sk to.")
    assert len(spark.statements) == 1


def test_without_foreign_key_metadata_a_date_key_is_still_refused_as_before_and_nothing_is_read(agent_ns):
    ucs = [uc("N01-U01", "Forecasting")]
    inst, agent, spark = deep_inspire(agent_ns, [{"results": [answer("N01-U01", SERIES_ROLES)]}], foreign_keys=())
    inst._check_data_signal(ucs, [])
    assert ucs[0]["data_signal"]["status"] == "not_checked"
    assert ucs[0]["data_signal"]["reason"] == "Not checked: the time column ws_sold_date_sk is numeric, not temporal."
    assert spark.statements == []
    listing = agent.calls[0]["vars"]["use_cases_listing"]
    assert "date keys" not in listing and listing.endswith(f"tables: {SALES}")


def test_a_foreign_key_to_a_table_without_one_date_column_is_not_a_date_key(agent_ns):
    columns = {SALES: COLUMNS[SALES], DATES: {"d_date_sk": "int", "d_year": "int"}}
    ucs = [uc("N01-U01", "Forecasting")]
    inst, agent, spark = deep_inspire(agent_ns, [{"results": [answer("N01-U01", SERIES_ROLES)]}], columns=columns)
    inst._check_data_signal(ucs, [])
    assert ucs[0]["data_signal"]["reason"] == "Not checked: the time column ws_sold_date_sk is numeric, not temporal."
    assert spark.statements == [] and "date keys" not in agent.calls[0]["vars"]["use_cases_listing"]


def test_a_date_key_used_for_the_periods_of_a_group_comparison_is_joined_too(agent_ns):
    ucs = [uc("N01-U01", "Trend Analysis")]
    roles = {"group": "ws_item_sk", "time": "ws_sold_date_sk"}
    inst, _agent, spark = deep_inspire(agent_ns, [{"results": [answer("N01-U01", roles)]}])
    inst._check_data_signal(ucs, [])
    assert ucs[0]["data_signal"]["status"] == "passed", ucs[0]["data_signal"]
    assert "LEFT JOIN `main`.`s`.`date_dim` AS j0 ON f.`ws_sold_date_sk` = j0.`d_date_sk`" in spark.statements[1]
    assert "CAST(`inspire_time_date` AS DATE) AS d" in spark.statements[1]


def test_a_fact_table_that_already_has_the_join_column_name_is_not_joined(agent_ns):
    columns = {SALES: {**COLUMNS[SALES], "inspire_time_date": "date"}, DATES: COLUMNS[DATES]}
    ucs = [uc("N01-U01", "Forecasting")]
    inst, _agent, spark = deep_inspire(agent_ns, [{"results": [answer("N01-U01", SERIES_ROLES)]}], columns=columns)
    inst._check_data_signal(ucs, [])
    assert ucs[0]["data_signal"]["reason"] == ("Not checked: main.s.web_sales already has a column named inspire_time_date, "
                                               "which Inspire needs for the date it joins.")
    assert spark.statements == []


def test_a_query_without_a_date_join_is_unchanged(agent_ns):
    spec = {"roles": {"time": "d_date", "measure": "ws_quantity"}}
    sql, _args = agent_ns["DeepEvidence"].signal_sql("series", "`main`.`s`.`t`", spec)
    assert "JOIN" not in sql and "FROM `main`.`s`.`t` WHERE `d_date` IS NOT NULL" in sql


def test_the_prompt_lets_a_listed_date_key_be_the_time_and_no_longer_skips_a_date_in_a_date_table(agent_ns):
    template = agent_ns["PROMPT_TEMPLATES"]["SIGNAL_CHECK_PROMPT"]
    assert "or a date that sits only in a date dimension" not in template
    assert 'lists the table\'s key to it under "date keys": name that key as "time"' in template
    assert 'or a "time" when the line lists it under "date keys"' in template


def test_the_date_key_join_reuses_the_elite_date_key_map(agent_ns):
    evidence = Loader((DATE_FK,)).get_metadata_evidence([SALES, DATES])
    dated = agent_ns["DatabricksInspire"]._elite_dated_joins(evidence, [SALES])
    assert dated == {(SALES, "ws_sold_date_sk"): {"table": DATES, "column": f"{DATES}.d_date",
                                                  "join": f"{SALES}.ws_sold_date_sk = {DATES}.d_date_sk",
                                                  "ref_column": "d_date_sk"}}


def test_the_date_table_key_is_counted_once_for_every_use_case_that_joins_it(agent_ns):
    ucs = [uc("N01-U01", "Forecasting"), uc("N01-U02", "Forecasting")]
    answers = [{"results": [answer("N01-U01", SERIES_ROLES), answer("N01-U02", SERIES_ROLES)]}]
    inst, _agent, spark = deep_inspire(agent_ns, answers)
    inst._check_data_signal(ucs, [])
    assert [u["data_signal"]["status"] for u in ucs] == ["passed", "passed"]
    assert sum("COUNT(DISTINCT `d_date_sk`)" in s for s in spark.statements) == 1 and len(spark.statements) == 3
