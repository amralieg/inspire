import datetime
import json
import os
import sys
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v120_artifacts_support import FakeSpark
from v120_genie_support import StatusRecorder, build_inspire

SALES = "main.s.store_sales"
TRIPS = "main.s.trips"
COLUMNS = {
    SALES: {"ticket_number": "bigint", "item_sk": "bigint", "sales_price": "decimal(7,2)", "quantity": "int",
            "net_profit": "decimal(7,2)", "churned": "string", "is_return": "boolean", "note": "string",
            "customer_email": "string", "birth_year": "int", "birth_date": "date"},
    TRIPS: {"pickup_datetime": "timestamp", "fare_amount": "double", "pickup_zip": "int"},
}


class Agent:
    def __init__(self, answers):
        self.answers = list(answers)
        self.calls = []

    def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema=None, timeout_override=None,
                   skip_cache=False, **_kw):
        self.calls.append({"prompt": worker_prompt_path, "vars": dict(prompt_vars), "skip_cache": skip_cache})
        answer = self.answers.pop(0) if self.answers else {"results": []}
        if isinstance(answer, Exception):
            raise answer
        return json.dumps(answer)


class Loader:
    def get_metadata_evidence(self, tables):
        return {t: {"columns": {name: {"name": name, "type": kind} for name, kind in COLUMNS[t].items()}, "foreign_keys": []}
                for t in tables if t in COLUMNS}


def uc(uc_id, technique, tables=SALES, domain="Sales", score=4.0):
    return {"No": uc_id, "Name": f"Use case {uc_id}", "Analytics Technique": technique, "Tables Involved": tables,
            "Business Domain": domain, "Inspire Score": score, "scoring_status": "scored"}


def answer(uc_id, roles, table=SALES, **extra):
    return {"No": uc_id, "table": table, "roles": roles, "user_requested": False, "note": "", **extra}


def deep_inspire(agent_ns, answers, responder, rows=1000, **attrs):
    spark = FakeSpark(responder=responder)
    agent = Agent(answers)
    inst = build_inspire(agent_ns, loader=Loader(), agent=agent)
    inst.logger = MagicMock()
    inst.discovery_type = "Deep"
    inst.deep_evidence = agent_ns["DeepEvidence"](spark, "Deep", MagicMock())
    inst.discovery_evidence = {"profiles": {SALES: {"rows": rows, "sampled": False, "columns": {}},
                                            TRIPS: {"rows": rows, "sampled": False, "columns": {}}},
                               "join_matches": [], "data_access": {}}
    inst._emit_pipeline_status = StatusRecorder()
    inst.user_business_domains = []
    for key, value in attrs.items():
        setattr(inst, key, value)
    return inst, agent, spark


def responder_for(rows_by_kind):
    def respond(statement):
        if "AS pooled" in statement:
            return [rows_by_kind["lever"]]
        if "AS pair_lift" in statement:
            return [rows_by_kind["basket"]]
        if "AS median_gap" in statement:
            return [rows_by_kind["series"]]
        if "AS outcome_values" in statement:
            return [rows_by_kind["outcome"]]
        if statement.startswith("SELECT COUNT(*) AS n FROM"):
            return [{"n": rows_by_kind.get("rows", 1000)}]
        raise AssertionError(f"unexpected statement: {statement}")
    return respond


FLAT_PRICE = {"n": 1000, "lever_values": 40, "pooled": -0.0006, "within": 0.001}
STRONG_PAIRS = {"baskets": 2000, "interactions": 9000, "items": 300, "multi_item_baskets": 1800, "supported_pairs": 40,
                "pair_lift": 1.9}


@pytest.mark.parametrize("family,measures,fragment", [
    ("H", {"row_count": 1000, "lever_values": 40, "lever_effect": 0.0006}, "does not move with"),
    ("H", {"row_count": 1000, "lever_values": 1, "lever_effect": 0.4}, "nothing to choose between"),
    ("D", {"row_count": 9000, "interactions": 9000, "users": 2000, "items": 300, "multi_item_baskets": 0,
           "supported_pairs": 0}, "holds two different items"),
    ("D", {"row_count": 9000, "interactions": 9000, "users": 2000, "items": 300, "multi_item_baskets": 900,
           "supported_pairs": 0}, "appear together in 20 or more"),
    ("D", {"row_count": 9000, "interactions": 9000, "users": 2000, "items": 300, "multi_item_baskets": 900,
           "supported_pairs": 12, "pair_lift": 1.01}, "more often than chance"),
    ("D", {"row_count": 500, "interactions": 500, "users": 200, "items": 150, "multi_item_baskets": 90,
           "supported_pairs": 3, "pair_lift": 2.0}, "There are too few past interactions (500); at least 1000"),
    ("E", {"row_count": 60, "periods": 60, "cadence": "daily", "seasonal_cycles": 8.57, "missing_period_rate": 0.0,
           "autocorrelation": 0.05}, "do not follow their own past"),
    ("E", {"row_count": 10, "periods": 10, "cadence": "daily", "seasonal_cycles": 1.43, "missing_period_rate": 0.0,
           "autocorrelation": 0.9}, "1.4 seasonal cycles"),
    ("E", {"row_count": 30, "periods": 30, "cadence": "daily", "seasonal_cycles": 4.3, "missing_period_rate": 0.5,
           "autocorrelation": 0.9}, "50% of the periods have no data"),
    ("A", {"row_count": 5000, "positives": 900, "class_rate": 0.18, "separation": 0.02, "signal": "net_profit"},
     "No signal column separates the outcome"),
    ("A", {"row_count": 5000, "positives": 50, "class_rate": 0.01, "separation": 0.9, "signal": "net_profit"},
     "too few past examples of the outcome (50)"),
    ("A", {"row_count": 5000, "positives": 4950, "class_rate": 0.99, "separation": 0.9, "signal": "net_profit"},
     "nothing left to predict"),
    ("A", {"row_count": 5000, "correlation": 0.01, "signal": "net_profit"}, "No signal column moves with the outcome"),
    ("B", {"row_count": 5000, "reference_rows": 5000, "key_signal_null_rate": 0.0, "measure_values": 1},
     "no value can stand out"),
    ("B", {"row_count": 200, "reference_rows": 200, "key_signal_null_rate": 0.0, "measure_values": 90},
     "too few rows (200); at least 1000"),
    ("C", {"row_count": 900, "entities": 900, "numeric_features": 1}, "Too few usable numeric features exist (1)"),
    ("C", {"row_count": 900, "entities": 5, "numeric_features": 4}, "There are 5 entities"),
    ("F", {"row_count": 900, "reportable_groups": 1}, "Too few groups hold at least the minimum rows per group (1)"),
    ("G", {"row_count": 900, "text_non_null_rate": 0.1, "median_text_length": 80}, "Only 10% of the records carry text"),
    ("G", {"row_count": 900, "text_non_null_rate": 0.9, "median_text_length": 5}, "The median text length is 5; at least"),
])
def test_each_family_drops_data_that_cannot_hold_its_signal(agent_ns, family, measures, fragment):
    names = {"lever": "sales_price", "outcome": "quantity", "basket": "ticket_number", "measure": "net_profit"}
    passed, text = agent_ns["deep_signal_verdict"](family, measures, names)
    assert passed is False and fragment in text, text


@pytest.mark.parametrize("family,measures,fragment", [
    ("H", {"row_count": 1000, "lever_values": 40, "lever_effect": 0.31}, "quantity moves with sales_price"),
    ("D", {"row_count": 9000, "interactions": 9000, "users": 2000, "items": 300, "multi_item_baskets": 900,
           "supported_pairs": 12, "pair_lift": 1.8}, "1.80 times as often as chance"),
    ("E", {"row_count": 60, "periods": 60, "cadence": "daily", "seasonal_cycles": 8.57, "missing_period_rate": 0.0,
           "autocorrelation": 0.62, "staleness_cadences": 99}, "daily totals follow their own past"),
    ("A", {"row_count": 5000, "positives": 900, "class_rate": 0.18, "separation": 0.4, "signal": "net_profit"},
     "net_profit differs by 0.40 standard deviations"),
    ("F", {"row_count": 900, "reportable_groups": 4, "periods": 30}, "4 groups hold enough rows"),
])
def test_data_with_the_signal_passes_and_says_what_it_found(agent_ns, family, measures, fragment):
    names = {"lever": "sales_price", "outcome": "quantity"}
    passed, text = agent_ns["deep_signal_verdict"](family, measures, names)
    assert passed is True and fragment in text, text


def test_the_measures_are_read_from_the_aggregates(agent_ns):
    measures = agent_ns["deep_signal_measures"]
    lever = measures("lever", FLAT_PRICE, {"roles": {"lever": "sales_price", "outcome": "quantity"}})
    assert lever == {"row_count": 1000, "lever_values": 40, "lever_effect": 0.001}
    series = measures("series", {"periods": 60, "median_gap": 1, "first_period": datetime.date(2016, 1, 1),
                                 "last_period": datetime.date(2016, 2, 29), "lag1": 0.7, "lag7": 0.8},
                      {"roles": {"time": "pickup_datetime"}})
    assert series["cadence"] == "daily" and series["seasonal_cycles"] == 8.57
    assert series["missing_period_rate"] == 0.0 and series["autocorrelation"] == 0.8
    monthly = measures("series", {"periods": 18, "median_gap": 30, "first_period": "2024-01-01", "last_period": "2025-06-01",
                                  "lag1": 0.1, "lag12": 0.5}, {"roles": {"time": "month"}})
    assert monthly["cadence"] == "monthly" and monthly["seasonal_cycles"] == 1.5 and monthly["autocorrelation"] == 0.5
    outcome = measures("outcome", {"n": 1000, "outcome_values": 2, "positives": 100, "sd0": 2.0, "p0": 5.0, "q0": 4.0,
                                   "sd1": 0.0, "p1": 1.0, "q1": 9.0},
                       {"roles": {"outcome": "churned", "signals": ["net_profit", "quantity"]}, "outcome_kind": "value"}, 0.1)
    assert outcome["separation"] == 0.5 and outcome["signal"] == "net_profit", "a constant signal never wins"
    assert outcome["positives"] == 1000 and outcome["row_count"] == 10000 and outcome["class_rate"] == 0.1


def test_the_queries_quote_every_column_and_sample_only_large_tables(agent_ns):
    sql = agent_ns["DeepEvidence"].signal_sql
    roles = {"basket": "ticket`number", "item": "item_sk"}
    full, _ = sql("basket", "`main`.`s`.`store_sales`", {"roles": roles})
    assert "`ticket``number` AS b" in full and "xxhash64" not in full
    sampled, _ = sql("basket", "`main`.`s`.`store_sales`", {"roles": roles}, 5000)
    assert "pmod(xxhash64(`ticket``number`), 1000000) < 5000" in sampled, "baskets are sampled whole, by their key"
    text_outcome, args = sql("outcome", "`t`", {"roles": {"outcome": "churned", "signals": ["net_profit"]},
                                               "outcome_kind": "value", "outcome_value": "yes"})
    assert args == {"positive": "yes"} and ":positive" in text_outcome and "corr(" not in text_outcome
    assert "yes" not in text_outcome, "the positive value is a parameter, never spliced into the SQL"


def test_standard_mode_never_reads_data_and_keeps_every_use_case(agent_ns):
    spark = FakeSpark(responder=lambda s: (_ for _ in ()).throw(AssertionError(s)))
    agent = Agent([])
    inst = build_inspire(agent_ns, loader=Loader(), agent=agent, spark=spark, discovery_type="Standard", deep_evidence=None)
    ucs = [uc("N01-U01", "Optimization")]
    kept, dropped = inst._check_data_signal(ucs, [])
    assert kept == ucs and dropped == [] and spark.statements == [] and agent.calls == []
    assert "data_signal" not in ucs[0]


def test_deep_drops_the_use_case_whose_data_shows_no_signal_and_keeps_the_rest(agent_ns):
    ucs = [uc("N01-U01", "Optimization"), uc("N01-U02", "Recommendation"), uc("N01-U03", "Classification")]
    answers = [{"results": [answer("N01-U01", {"lever": "sales_price", "outcome": "quantity"}),
                            answer("N01-U02", {"basket": "ticket_number", "item": "item_sk"}),
                            {"No": "N01-U03", "table": "", "roles": {}, "note": "churn is derived from several tables"}]}]
    inst, agent, spark = deep_inspire(agent_ns, answers, responder_for({"lever": FLAT_PRICE, "basket": STRONG_PAIRS}))
    kept, dropped = inst._check_data_signal(ucs, [])
    assert [u["No"] for u in kept] == ["N01-U02", "N01-U03"] and [u["No"] for u in dropped] == ["N01-U01"]
    assert agent.calls[0]["prompt"] == "SIGNAL_CHECK_PROMPT" and agent.calls[0]["skip_cache"] is False
    assert "check: lever" in agent.calls[0]["vars"]["use_cases_listing"]
    assert dropped[0]["selection_drop_reason"].startswith("the data shows no signal: quantity does not move with sales_price")
    assert ucs[1]["data_signal"]["status"] == "passed" and ucs[1]["Data Evidence"]["signal"]["status"] == "passed"
    assert ucs[2]["data_signal"]["status"] == "not_checked"
    assert "churn is derived from several tables" in ucs[2]["data_signal"]["reason"]
    assert len(spark.statements) == 2, "one aggregate read per checked use case; the profile row count is reused"
    assert inst.funnel_ledger[-1] == {"stage": "data_signal", "in": 3, "out": 2, "drops": {"SIGNAL_LEVER": 1}}
    [event] = inst._emit_pipeline_status.find("Data Signal Check")
    assert event["message"].startswith("Checked 2 of 3 use cases against the data: 1 passed, 1 dropped")
    inst.final_inspire_results_json = {}
    assert inst._publish_funnel_ledger() and inst.final_inspire_results_json["signal_check"]["dropped"] == 1


def test_a_user_domain_left_empty_and_a_requested_use_case_stay_and_say_the_data_shows_no_signal(agent_ns):
    ucs = [uc("N01-U01", "Optimization", domain="Pricing"), uc("N01-U02", "Optimization", domain="Sales"),
           uc("N01-U03", "Optimization", domain="Sales")]
    lever = {"lever": "sales_price", "outcome": "quantity"}
    answers = [{"results": [answer("N01-U01", lever), answer("N01-U02", lever, user_requested=True), answer("N01-U03", lever)]}]
    inst, _agent, _spark = deep_inspire(agent_ns, answers, responder_for({"lever": FLAT_PRICE}), user_business_domains=["Pricing"])
    kept, dropped = inst._check_data_signal(ucs, [])
    assert [u["No"] for u in kept] == ["N01-U01", "N01-U02"] and [u["No"] for u in dropped] == ["N01-U03"]
    assert ucs[0]["data_signal"]["status"] == "no_signal"
    assert ucs[0]["data_signal"]["reason"].startswith("The data shows no signal: quantity does not move with sales_price")
    assert "business domain Pricing" in ucs[0]["data_signal"]["reason"]
    assert "the instructions ask for it" in ucs[1]["data_signal"]["reason"]


def test_a_column_outside_the_table_is_never_read_and_the_use_case_is_kept_unchecked(agent_ns):
    ucs = [uc("N01-U01", "Optimization"), uc("N01-U02", "Optimization"), uc("N01-U03", "Optimization")]
    answers = [{"results": [answer("N01-U01", {"lever": "list_price", "outcome": "quantity"}),
                            answer("N01-U02", {"lever": "note", "outcome": "quantity"}),
                            answer("N01-U03", {"lever": "sales_price", "outcome": "quantity"}, table="main.s.other")]}]
    inst, _agent, spark = deep_inspire(agent_ns, answers, responder_for({}))
    kept, dropped = inst._check_data_signal(ucs, [])
    assert len(kept) == 3 and dropped == [] and spark.statements == []
    reasons = [u["data_signal"]["reason"] for u in ucs]
    assert reasons == ["Not checked: the lever column list_price is not in main.s.store_sales.",
                       "Not checked: the lever column note is string, not numeric.",
                       "Not checked: main.s.other is not one of its tables."]


def test_a_personal_column_is_read_only_where_its_values_are_counted(agent_ns):
    ucs = [uc("N01-U01", "Classification"), uc("N01-U02", "Sentiment Analysis"), uc("N01-U03", "Classification"),
           uc("N01-U04", "Trend Analysis"), uc("N01-U05", "Forecasting")]
    answers = [{"results": [answer("N01-U01", {"outcome": "is_return", "signals": ["birth_year"]}),
                            answer("N01-U02", {"text": "customer_email"}),
                            answer("N01-U03", {"outcome": "is_return", "signals": ["birth_year", "quantity"]}),
                            answer("N01-U04", {"group": "customer_email"}),
                            answer("N01-U05", {"time": "birth_date", "measure": "quantity"})]}]

    def respond(statement):
        if "AS outcome_values" in statement:
            return [{"n": 1000, "outcome_values": 2, "positives": 200, "sd0": 2.0, "p0": 5.0, "q0": 4.0, "c0": 0.3}]
        if "AS reportable_groups" in statement:
            return [{"n": 1000, "groups": 400, "reportable_groups": 9}]
        raise AssertionError(statement)

    inst, _agent, spark = deep_inspire(agent_ns, answers, respond)
    kept, dropped = inst._check_data_signal(ucs, [])
    assert dropped == [] and len(kept) == 5 and len(spark.statements) == 2
    assert not any("birth_" in s for s in spark.statements), "a personal value column is never read"
    assert "`customer_email` AS g" in spark.statements[1], "a personal group is only counted"
    assert [u["data_signal"]["status"] for u in ucs] == ["not_checked", "not_checked", "passed", "passed", "not_checked"]
    assert ucs[0]["data_signal"]["reason"] == ("Not checked: every signal column named for it is personal (birth_year), "
                                               "and Deep reads only counts of a personal column.")
    assert ucs[1]["data_signal"]["reason"] == ("Not checked: the text column customer_email is personal, and Deep reads "
                                               "only counts of a personal column.")
    assert ucs[4]["data_signal"]["reason"] == ("Not checked: the time column birth_date is personal, and Deep reads "
                                               "only counts of a personal column.")


def test_a_key_or_a_code_is_never_read_as_a_number_and_is_still_counted_as_a_group(agent_ns):
    ucs = [uc("N01-U01", "Classification", tables=TRIPS), uc("N01-U02", "Classification"), uc("N01-U03", "Optimization"),
           uc("N01-U04", "Anomaly Detection"), uc("N01-U05", "Trend Analysis", tables=TRIPS)]
    answers = [{"results": [answer("N01-U01", {"outcome": "fare_amount", "signals": ["pickup_zip"]}, table=TRIPS),
                            answer("N01-U02", {"outcome": "is_return", "signals": ["item_sk", "quantity"]}),
                            answer("N01-U03", {"lever": "item_sk", "outcome": "quantity"}),
                            answer("N01-U04", {"measure": "ticket_number"}),
                            answer("N01-U05", {"group": "pickup_zip"}, table=TRIPS)]}]

    def respond(statement):
        if "AS outcome_values" in statement:
            return [{"n": 1000, "outcome_values": 2, "positives": 200, "sd0": 2.0, "p0": 5.0, "q0": 4.0, "c0": 0.3}]
        if "AS reportable_groups" in statement:
            return [{"n": 1000, "groups": 260, "reportable_groups": 9}]
        raise AssertionError(statement)

    inst, _agent, spark = deep_inspire(agent_ns, answers, respond)
    kept, dropped = inst._check_data_signal(ucs, [])
    assert dropped == [] and len(kept) == 5 and len(spark.statements) == 2
    assert "`quantity`" in spark.statements[0] and "`item_sk`" not in spark.statements[0]
    assert "`pickup_zip` AS g" in spark.statements[1], "a code is still counted as a group"
    assert [u["data_signal"]["status"] for u in ucs] == ["not_checked", "passed", "not_checked", "not_checked", "passed"]
    assert ucs[0]["data_signal"]["reason"] == ("Not checked: every signal column named for it is a key or a code "
                                               "(pickup_zip), whose numbers name things rather than measure them.")
    assert ucs[2]["data_signal"]["reason"] == ("Not checked: the lever column item_sk is a key or a code, whose numbers "
                                               "name things rather than measure them.")
    assert ucs[3]["data_signal"]["reason"] == ("Not checked: the measure column ticket_number is a key or a code, whose "
                                               "numbers name things rather than measure them.")
    prompt = agent_ns["PROMPT_TEMPLATES"]["SIGNAL_CHECK_PROMPT"]
    assert "A key or a code column" in prompt and "ZIP or postal code" in prompt


@pytest.mark.parametrize("column", ["zip", "ZipCode", "postcode", "pickup_zip", "store_postcode", "ca_zipcode"])
def test_a_zip_or_postcode_is_a_code_and_never_the_row_key_of_its_table(agent_ns, column):
    assert agent_ns["_is_key_like_column"](column)
    assert not agent_ns["_is_own_row_key"]("main.s.customer_address", column, (), ["address_id", "city", column])


def test_a_bare_zip_never_joins_two_tables_and_a_named_one_still_can(agent_ns):
    is_join = agent_ns["DatabricksInspire"]._is_join_identifier
    assert [is_join(c) for c in ("zip", "postcode", "zipcode", "code")] == [False, False, False, False]
    assert [is_join(c) for c in ("pickup_zip", "customer_id", "city")] == [True, True, False]


def test_a_check_that_cannot_run_keeps_every_use_case_unchecked_and_never_stops_discover(agent_ns):
    agent = Agent([])
    inst = build_inspire(agent_ns, loader=Loader(), agent=agent, discovery_type="Deep", deep_evidence=None)
    inst.logger = MagicMock()
    inst._emit_pipeline_status = StatusRecorder()
    assert not hasattr(inst, "spark")
    ucs = [uc("N01-U01", "Optimization"), uc("N01-U02", "Recommendation")]
    kept, dropped = inst._check_data_signal(ucs, [])
    assert kept == ucs and dropped == [] and agent.calls == []
    assert all("data_signal" not in u for u in ucs)
    [event] = inst._emit_pipeline_status.find("Data Signal Check")
    assert event["status"] == "ended_warning"
    assert event["message"].startswith("The data signal check could not run, so all 2 use cases stay unchecked: ")


def test_a_failure_after_some_use_cases_were_checked_leaves_none_of_them_marked(agent_ns):
    ucs = [uc("N01-U01", "Optimization"), uc("N01-U02", "Optimization")]
    lever = {"lever": "sales_price", "outcome": "quantity"}
    answers = [{"results": [answer("N01-U01", lever), answer("N01-U02", lever)]}]
    inst, _agent, _spark = deep_inspire(agent_ns, answers, responder_for({"lever": FLAT_PRICE}))
    inst._log_funnel_stage = MagicMock(side_effect=RuntimeError("ledger is gone"))
    kept, dropped = inst._check_data_signal(ucs, [])
    assert kept == ucs and dropped == []
    assert all("data_signal" not in u and "selection_drop_reason" not in u for u in ucs)
    assert all("signal" not in (u.get("Data Evidence") or {}) for u in ucs)
    [event] = inst._emit_pipeline_status.find("Data Signal Check")
    assert event["status"] == "ended_warning" and event["message"].endswith("ledger is gone")


def test_cancelling_the_run_during_the_check_still_cancels_it(agent_ns):
    ucs = [uc("N01-U01", "Optimization")]
    answers = [{"results": [answer("N01-U01", {"lever": "sales_price", "outcome": "quantity"})]}]
    inst, _agent, _spark = deep_inspire(agent_ns, answers, responder_for({"lever": FLAT_PRICE}))
    inst._log_funnel_stage = MagicMock(side_effect=agent_ns["SparkWorkCancelled"]("signal_lever", "t1"))
    with pytest.raises(agent_ns["SparkWorkCancelled"]):
        inst._check_data_signal(ucs, [])


def test_use_cases_the_first_answer_left_out_are_asked_again_without_the_cache(agent_ns):
    ucs = [uc("N01-U01", "Optimization"), uc("N01-U02", "Optimization")]
    lever = {"lever": "sales_price", "outcome": "quantity"}
    answers = [{"results": [answer("N01-U01", lever)]}, {"results": [answer("N01-U02", lever)]}]
    inst, agent, _spark = deep_inspire(agent_ns, answers, responder_for({"lever": dict(FLAT_PRICE, pooled=0.4)}))
    kept, _dropped = inst._check_data_signal(ucs, [])
    assert [c["skip_cache"] for c in agent.calls] == [False, True]
    assert "N01-U01" not in agent.calls[1]["vars"]["use_cases_listing"]
    assert [u["data_signal"]["status"] for u in kept] == ["passed", "passed"]


def test_a_spent_budget_keeps_the_use_case_unchecked_and_says_why(agent_ns):
    ucs = [uc("N01-U01", "Optimization")]
    answers = [{"results": [answer("N01-U01", {"lever": "sales_price", "outcome": "quantity"})]}]
    inst, _agent, spark = deep_inspire(agent_ns, answers, responder_for({"lever": FLAT_PRICE}))
    inst.deep_evidence.signal_spent_seconds = inst.deep_evidence.signal_budget_seconds
    kept, dropped = inst._check_data_signal(ucs, [])
    assert kept == ucs and dropped == [] and spark.statements == []
    assert kept[0]["data_signal"]["reason"] == "Not checked: the Deep signal check budget of 600s is spent."
    assert inst.deep_evidence.spent_seconds == 0.0, "the signal check never spends the evidence budget"


def test_a_large_table_is_sampled_by_hash_and_counts_are_scaled_back(agent_ns):
    ucs = [uc("N01-U01", "Recommendation")]
    answers = [{"results": [answer("N01-U01", {"basket": "ticket_number", "item": "item_sk"})]}]
    inst, _agent, spark = deep_inspire(agent_ns, answers, responder_for({"basket": STRONG_PAIRS}), rows=10_000_000)
    inst._check_data_signal(ucs, [])
    assert "pmod(xxhash64(`ticket_number`), 1000000) < 100000" in spark.statements[0]
    measures = ucs[0]["data_signal"]["measures"]
    assert measures["interactions"] == 90000 and measures["users"] == 20000 and measures["sampled"] is True


def test_the_prompt_is_registered_and_tells_the_model_the_user_wins(agent_ns):
    name = "SIGNAL_CHECK_PROMPT"
    template = agent_ns["PROMPT_TEMPLATES"][name]
    assert "the user directive wins without exception" in template and "never write SQL" in template
    assert name in agent_ns["LLM_JSON_FORMAT_PROMPTS"] and name in agent_ns["PROMPT_STORY_TITLES"]
    assert name in agent_ns["PROMPT_STORY_STARTED_MESSAGES"] and name in agent_ns["GENERATION_DIRECTIVE_CATEGORIES_BY_PROMPT"]
    configs = [m for m in agent_ns["TECHNICAL_CONTEXT"]["prompts_models"] if m.get("prompt_name") == name]
    assert len(configs) == 1 and configs[0]["temperature"] == 0.0
    assert agent_ns["TECHNICAL_CONTEXT"]["runtime"]["deep_signal_budget_seconds"] == 600
