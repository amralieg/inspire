import collections
import sqlite3
import types

import pytest

from v120_artifacts_support import CapturingLogger, FakeSpark
from v120_genie_support import build_inspire, make_uc
from v142_scd_test import QUOTED_SUMMARY, SUMMARY, _describe

TABLE = "main.inspire.churn_out"
STAGE = "main.inspire.churn_out_inspire_stage"
MEASURED = {"basis": "measured", "currency": "USD", "amounts": {"act_now_amount": "5000", "review_amount": "1000"}}
PREDICTED = {"basis": "predicted", "currency": "AED", "amounts": {}}
COLUMNS = ["as_of_date", "entity_id", "priority_tier", "value_at_stake", "data_quality_flag", "run_id", "use_case_id"]


class _Mode:
    def __init__(self):
        self.seen = collections.Counter()

    def step(self, value):
        if value is not None:
            self.seen[value] += 1

    def finalize(self):
        return min(self.seen, key=lambda v: (-self.seen[v], v)) if self.seen else None


def _sqlite(sql, rows):
    sqlglot = pytest.importorskip("sqlglot")
    tree = sqlglot.parse_one(sql, read="databricks")
    for table in tree.find_all(sqlglot.exp.Table):
        table.set("catalog", None)
        table.set("db", None)
    db = sqlite3.connect(":memory:")
    db.create_aggregate("MODE", 1, _Mode)
    names = list(rows[0]) if rows else COLUMNS + ["is_current", "change_source"]
    for name in {t.name for t in tree.find_all(sqlglot.exp.Table)}:
        db.execute(f'CREATE TABLE "{name}" ({", ".join(chr(34) + n + chr(34) for n in names)})')
        db.executemany(f'INSERT INTO "{name}" VALUES ({", ".join("?" for _ in names)})', [tuple(r[n] for n in names) for r in rows])
    cursor = db.execute(tree.sql(dialect="sqlite"))
    return dict(zip([c[0] for c in cursor.description], cursor.fetchone()))


def _row(entity, tier, stake, flag="ok", **extra):
    return dict({"as_of_date": "2026-10-01", "entity_id": entity, "priority_tier": tier, "value_at_stake": stake,
                 "data_quality_flag": flag, "run_id": "r-1", "use_case_id": "N01-U01"}, **extra)


def _widgets(ns, **values):
    ns["dbutils"] = types.SimpleNamespace(widgets=types.SimpleNamespace(get=dict(values).__getitem__))


def test_every_family_has_a_decision_basis_and_the_spec_carries_it(agent_ns):
    basis = agent_ns["GENIE_FAMILY_DECISION_BASIS"]
    assert set(basis) == set(agent_ns["GENIE_FAMILY_SPECS"]), "a family without a basis would fail every build that picks it"
    assert set(basis.values()) == set(agent_ns["INSPIRE_DECISION_BASES"]) == {"measured", "predicted"}
    inst = build_inspire(agent_ns)
    seen = {}
    for technique in ("Predictive Modeling", "Anomaly Detection", "Clustering", "Recommendation", "Forecasting", "Cohort Analysis",
                      "Pareto Analysis", "Optimization"):
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        assert spec["decision_basis"] == basis[spec["family"]], technique
        seen[spec["decision_basis"]] = technique
    assert set(seen) == {"measured", "predicted"}


def test_a_measured_use_case_tiers_by_money_at_stake_and_a_predicted_one_by_share(agent_ns):
    inst = build_inspire(agent_ns)
    for technique, measured in (("Cohort Analysis", True), ("Predictive Modeling", False)):
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        lines = inst._genie_output_column_lines(spec)
        tier = next(line for line in lines if line.startswith("priority_tier STRING:"))
        rank = next(line for line in lines if line.startswith("rank INT:"))
        stake = next(line for line in lines if line.startswith("value_at_stake DOUBLE:"))
        assert "never negative" in stake and "`currency` widget's currency" in stake, technique
        assert ("'Act now' for every row whose value_at_stake is at least `act_now_amount`" in tier) is measured, technique
        assert ("rank is at most floor(`act_now_share` x N)" in tier) is (not measured), technique
        assert ("a value_at_stake of at least `review_amount` first" in rank) is measured, technique
        assert "{" not in tier + rank, "every placeholder is filled"
        rules = inst._genie_platform_rules(spec)
        assert ("acts on measured amounts, so the formula prices what the data already shows" in rules) is measured, technique
        assert ("acts on a prediction, so the formula is the predicted probability" in rules) is (not measured), technique
        assert ("`act_now_amount` and `review_amount` come from the money at stake in the first full test run" in rules) is measured
        assert "{basis}" not in rules and "{amounts}" not in rules
        assert inst._find_unsupported_numeric_claims(rules) == [], technique
        stop = inst._genie_acceptance_stop_rule(spec)
        assert (agent_ns["GENIE_MEASURED_TIER_RULE"] in stop) is measured, technique
        widgets = {w["name"]: w for w in inst._genie_core_widgets(spec)}
        assert ("act_now_amount" in widgets and "review_amount" in widgets) is measured, technique
        assert ("act_now_share" in widgets) is (not measured) and widgets["currency"]["default"] == "", technique


def test_a_notebook_without_the_currency_widget_writes_as_it_did_before(fresh_ns):
    config = fresh_ns["inspire_value_run_config"]
    _widgets(fresh_ns)
    assert config(["entity_id", "priority_tier"]) is None, "a notebook built before the money at stake has no currency widget"
    fresh_ns["INSPIRE_RUN"] = {"decision_basis": "measured"}
    _widgets(fresh_ns, currency="USD", act_now_amount="5000", review_amount="1000")
    assert config(["entity_id"]) == dict(MEASURED, kind="money", unit="USD", formula=None, expression=None, expression_required=False,
                                         constants={}, bounds=None, bounds_required=False, widget_names=[])
    _widgets(fresh_ns)
    unpriced = config(["entity_id", "value_at_stake"])
    assert unpriced == {"basis": "measured", "currency": "", "kind": "money", "unit": "", "amounts": {"act_now_amount": "", "review_amount": ""},
                        "formula": None, "expression": None, "expression_required": False, "constants": {}, "bounds": None,
                        "bounds_required": False, "widget_names": []}
    assert any("the currency widget is ''" in p for p in fresh_ns["inspire_value_problems"](unpriced))
    fresh_ns["INSPIRE_RUN"] = {"decision_basis": "predicted"}
    _widgets(fresh_ns, currency="AED", act_now_amount="9")
    assert config(["entity_id"]) == dict(PREDICTED, kind="money", unit="AED", formula=None, expression=None, expression_required=False,
                                         constants={}, bounds=None, bounds_required=False, widget_names=[],
                                         shares={"act_now_share": "", "review_share": ""}, shares_required=False), \
        "a prediction reads no amount widgets"


@pytest.mark.parametrize("change,problem", [
    ({}, None),
    ({"basis": "predicted", "amounts": {}}, None),
    ({"amounts": {"act_now_amount": "1000", "review_amount": "1000"}}, None),
    ({"basis": "guess"}, "the run's decision basis is 'guess'"),
    ({"currency": "usd"}, "the currency widget is 'usd'"),
    ({"currency": "US"}, "the currency widget is 'US'"),
    ({"amounts": {"act_now_amount": "you choose", "review_amount": "1000"}}, "the act_now_amount widget is 'you choose'"),
    ({"amounts": {"act_now_amount": "5,000", "review_amount": "1000"}}, "the act_now_amount widget is '5,000'"),
    ({"amounts": {"act_now_amount": "5000", "review_amount": "-1"}}, "the review_amount widget is '-1'"),
    ({"amounts": {"act_now_amount": "1000", "review_amount": "5000"}}, "review_amount is 5000, above act_now_amount 1000"),
])
def test_a_run_with_a_bad_currency_amount_or_order_is_refused(agent_ns, change, problem):
    problems = agent_ns["inspire_value_problems"](dict(MEASURED, **change))
    if problem is None:
        assert problems == []
    else:
        assert len(problems) == 1 and problems[0].startswith(problem), problems


def test_the_widget_check_refuses_a_review_amount_above_the_act_now_amount(agent_ns):
    check = agent_ns["genie_widget_set_problems"]
    assert any("review_amount is 5000, above act_now_amount 1000" in p for p in check({"act_now_amount": "1000", "review_amount": "5000"}))
    for good in ({"act_now_amount": "5000", "review_amount": "1000"}, {"act_now_amount": "1000", "review_amount": "1000"},
                 {"act_now_amount": "", "review_amount": "1000"}, {}):
        assert not any("review_amount" in p for p in check(good)), good


def test_a_measured_tier_that_does_not_follow_the_money_at_stake_is_refused(agent_ns):
    sql = agent_ns["inspire_run_profile_sql"](STAGE, COLUMNS, MEASURED)
    rows = [_row("a", "Act now", 5000.0), _row("b", "Review", 4999.99), _row("c", "Review", 1000.0), _row("d", "Monitor", 999.0),
            _row("e", "Monitor", None), _row("f", "Monitor", 9000.0, flag="missing price"), _row("g", "Monitor", 0.0)]
    assert _sqlite(sql, rows)["off_tier"] == 0, "every row follows its value_at_stake, the flag and the two amounts"
    wrong = rows + [_row("h", "Act now", 4000.0), _row("i", "Act now", 9000.0, flag="stale"), _row("j", "Review", None),
                    _row("k", None, 7000.0), _row("l", "Monitor", 1500.0)]
    found = _sqlite(sql, wrong)
    assert found["off_tier"] == 5 and found["negative_stake"] == 0
    problems = agent_ns["inspire_run_problems"](dict(found, row_count=12, use_cases=1, runs=1), MEASURED)
    assert ("5 rows have a priority_tier that does not follow their value_at_stake: this use case acts on measured amounts, so a "
            "row whose data_quality_flag is 'ok' is 'Act now' at 5,000 USD or more, 'Review' at 1,000 USD or more, and every other "
            "row is 'Monitor'") in problems
    assert _sqlite(sql, rows + [_row("m", "Monitor", -3.0)])["negative_stake"] == 1
    assert any("1 row has a value_at_stake below 0" in p
               for p in agent_ns["inspire_run_problems"]({"negative_stake": 1, "use_cases": 1, "runs": 1, "row_count": 8}, MEASURED))


def test_a_predicted_tier_is_never_checked_against_amounts_and_an_old_notebook_is_never_priced(agent_ns):
    predicted = agent_ns["inspire_run_profile_sql"](STAGE, COLUMNS, PREDICTED)
    assert "negative_stake" in predicted and "off_tier" not in predicted
    assert _sqlite(predicted, [_row("a", "Act now", 10.0), _row("b", "Monitor", 900000.0)])["negative_stake"] == 0
    old = agent_ns["inspire_run_profile_sql"](STAGE, COLUMNS)
    assert "negative_stake" not in old and "off_tier" not in old, "a run without the value contract keeps its old checks"
    no_flag = agent_ns["inspire_run_profile_sql"](STAGE, [c for c in COLUMNS if c != "data_quality_flag"], MEASURED)
    assert "CASE WHEN TRUE AND `value_at_stake` >= 5000.0 THEN 'Act now'" in no_flag


def test_the_outcome_counts_the_current_records_and_prices_only_the_flagged_ones(agent_ns):
    sql = agent_ns["inspire_outcome_sql"](TABLE, "N01-U01", COLUMNS, MEASURED)
    current = {"is_current": 1, "change_source": "run"}
    rows = [_row("a", "Act now", 6000.0, **current), _row("b", "Review", 1200.0, **current), _row("c", "Monitor", 800.0, **current),
            _row("d", "Monitor", 9000.0, flag="missing price", **current), _row("e", "Monitor", 50.0, flag="missing price", **current),
            _row("f", "Act now", 99999.0, is_current=0, change_source="run"), _row("g", "Act now", 99999.0, is_current=1,
                                                                                 change_source="delete"),
            _row("h", "Act now", 99999.0, use_case_id="N01-U02", **current)]
    found = _sqlite(sql, rows)
    assert (found["act_now_records"], found["review_records"], found["records"]) == (1, 1, 5), \
        "a closed version, a deleted record and another use case's rows are never counted"
    assert (found["top_stake"], found["flagged_records"], found["top_flag"]) == (9000.0, 2, "missing price")
    assert "value_at_stake" not in found, "the run total is read through the App's money rule, not summed here (v296 checks its value)"
    plain = agent_ns["inspire_outcome_sql"](TABLE, "N01-U01", COLUMNS, None)
    assert "value_at_stake" not in plain and "top_stake" not in plain


@pytest.mark.parametrize("found,value,given,reason", [
    ({"act_now_records": 1, "records": 4}, MEASURED, "No model yet.", None),
    ({"review_records": 2, "records": 4}, None, "", None),
    ({"records": 4}, MEASURED, "  No closed outcome window yet.  ", "No closed outcome window yet."),
    ({"records": 0}, MEASURED, "", "The last run wrote no current records."),
    ({"records": 3, "flagged_records": 3, "top_flag": "missing price"}, MEASURED, "",
     "Every record has a data quality issue, most often: missing price."),
    ({"records": 3, "flagged_records": 3, "top_flag": None}, None, "", "Every record has a data quality issue."),
    ({"records": 3, "flagged_records": 1, "top_stake": 812.5}, MEASURED, "",
     "No record has 1,000 USD or more at stake, the amount this use case reviews from; the most at stake on one record is 812.5 USD."),
    ({"records": 3}, MEASURED, "", "No record has 1,000 USD or more at stake, the amount this use case reviews from."),
    ({"records": 3}, PREDICTED, "", "No record passed this use case's decision test in the last run."),
    ({"records": 3}, None, "", "No record passed this use case's decision test in the last run."),
])
def test_a_run_with_nothing_to_act_on_says_why(agent_ns, found, value, given, reason):
    assert agent_ns["inspire_nothing_to_act"](found, value, given) == reason


@pytest.mark.parametrize("found,value,reason", [
    ({"records": 10, "flagged_records": 10, "top_flag": "test flags every series", "top_stake": 35445767.78}, MEASURED,
     "Every record has a data quality issue, most often: test flags every series."),
    ({"records": 9, "held_records": 2, "top_stake": 9000.0}, MEASURED,
     "Every record the last run flagged is held back to measure the impact of this use case (2 of them), so none is on the to fix list."),
    ({"records": 10, "flagged_records": 4, "top_flag": "missing price", "top_stake": 800.0}, MEASURED,
     "No category reaches the 1M USD review threshold; a larger measured profit exposure or elasticity would change that."),
    ({"records": 0}, MEASURED,
     "No category reaches the 1M USD review threshold; a larger measured profit exposure or elasticity would change that."),
])
def test_a_reason_the_run_gives_never_hides_what_the_records_show(agent_ns, found, value, reason):
    run_said = "No category reaches the 1M USD review threshold; a larger measured profit exposure or elasticity would change that."
    assert agent_ns["inspire_nothing_to_act"](found, value, run_said) == reason


ROW_READ = (f"SELECT act_now_records, review_records, records, nothing_to_act FROM {QUOTED_SUMMARY} "
            "WHERE use_case_id = 'N01-U02' AND run_id = 'r-3'")


def _summary_spark(row, asked, fail=False):
    def respond(statement):
        if statement == ROW_READ:
            if fail:
                raise RuntimeError("PERMISSION_DENIED: SELECT on churn_out_summary")
            return [row] if row else []
        if statement.startswith("SELECT ai_query("):
            asked.append(statement)
            return [{"r": {"result": "Ten categories are on Monitor.", "errorMessage": None}}]
        if statement.startswith("SELECT SUM(value_at_stake) AS value FROM"):
            return [{"value": found.get("value_at_stake")}]
        if statement == f"DESCRIBE TABLE {QUOTED_SUMMARY}":
            return _describe(SUMMARY)
        return []
    return FakeSpark(responder=respond)


@pytest.mark.parametrize("row,fact", [
    ({"act_now_records": 0, "review_records": 0, "records": 10,
      "nothing_to_act": "Every record has a data quality issue, most often: test flags every series."},
     "Decision list of this run: 0 Act now and 0 Review of 10 current records; nothing is on the to fix list, because: Every record "
     "has a data quality issue, most often: test flags every series."),
    ({"act_now_records": 3, "review_records": 1, "records": 10, "nothing_to_act": None},
     "Decision list of this run: 3 Act now and 1 Review of 10 current records"),
])
def test_the_ai_run_summary_is_told_inspire_s_final_decision_list_before_the_run_s_own_facts(agent_ns, monkeypatch, row, fact):
    monkeypatch.setitem(agent_ns, "INSPIRE_RUN", {"use_case_id": "N01-U02", "ai_context": "Business: Acme"})
    asked, printed = [], []
    spark = _summary_spark(row, asked)
    facts = "candidate beats baseline: 10 categories"
    assert agent_ns["inspire_write_summary"](facts, TABLE, "r-3", "2026-10-29", spark, "ep", None, printed.append) == "Ten categories are on Monitor."
    assert spark.statements[0] == ROW_READ and len(asked) == 1
    prompt = asked[0]
    assert fact in prompt and prompt.index(fact) < prompt.index(facts), "Inspire's count comes before the facts the notebook gave"
    assert "The Decision list of this run fact is Inspire\\'s final count: the records that need action now are its Act now ones" in prompt
    assert ("nothing is on the to fix list, because" in prompt) == bool(row["nothing_to_act"])


@pytest.mark.parametrize("row,fail,printed_note", [
    (None, False, None),
    ({"records": None}, False, None),
    ({"records": 4}, True, "AI summary: Inspire could not read how many records of run r-3 need action, so the summary is written without "
                           "that count: PERMISSION_DENIED: SELECT on churn_out_summary"),
])
def test_a_run_without_a_decision_list_still_gets_its_ai_summary(agent_ns, monkeypatch, row, fail, printed_note):
    monkeypatch.setitem(agent_ns, "INSPIRE_RUN", {"use_case_id": "N01-U02", "ai_context": "Business: Acme"})
    asked, printed = [], []
    spark = _summary_spark(row, asked, fail)
    assert agent_ns["inspire_write_summary"]("rows written: 4 rows", TABLE, "r-3", "2026-10-29", spark, "ep", None, printed.append)
    assert "Decision list of this run:" not in asked[0]
    assert (printed[0] == printed_note) if printed_note else not [p for p in printed if "could not read" in p]
    assert any(s.startswith(f"MERGE INTO {QUOTED_SUMMARY}") for s in spark.statements), "the summary is written either way"


def _outcome_spark(found, summary=SUMMARY, fail=None):
    def respond(statement):
        if fail and statement.startswith(fail):
            raise RuntimeError(f"PERMISSION_DENIED: {fail}")
        if statement.startswith("SELECT COUNT_IF(t.`priority_tier` = 'Act now') AS act_now_records"):
            return [found]
        if statement.startswith("SELECT SUM(value_at_stake) AS value FROM"):
            return [{"value": found.get("value_at_stake")}]
        if statement == f"DESCRIBE TABLE {QUOTED_SUMMARY}":
            return _describe(summary)
        return []
    return FakeSpark(responder=respond)


def test_a_measured_run_records_its_outcome_and_its_reason_for_the_app(agent_ns, monkeypatch):
    monkeypatch.setitem(agent_ns, "inspire_widget", lambda name, default="": {"02_inspire_database": "main.inspire", "14_session_id": "42"}.get(name, default))
    spark, printed = _outcome_spark({"act_now_records": 0, "review_records": 0, "records": 4, "flagged_records": 0,
                                     "value_at_stake": None, "top_stake": 812.5}), []
    reason = agent_ns["inspire_save_outcome"](spark, TABLE, "N01-U01", "r-1", COLUMNS, MEASURED, "", printed.append)
    assert reason.startswith("No record has 1,000 USD or more at stake")
    assert spark.statements[0].startswith(f"SELECT COUNT_IF(t.`priority_tier` = 'Act now') AS act_now_records")
    assert spark.statements[1].startswith("SELECT SUM(value_at_stake) AS value FROM"), "the run total is read through the App's money rule"
    assert spark.statements[2].startswith(f"CREATE TABLE IF NOT EXISTS {QUOTED_SUMMARY} (use_case_id STRING, run_id STRING")
    assert ("act_now_records BIGINT, review_records BIGINT, records BIGINT, value_at_stake DOUBLE, currency STRING, decision_basis "
            "STRING, act_now_amount DOUBLE, review_amount DOUBLE, nothing_to_act STRING, run_started_at TIMESTAMP, run_ended_at "
            "TIMESTAMP, run_trigger STRING, run_segments STRING, run_tables STRING, run_stages STRING, run_grouping STRING, ai_checks STRING, "
            "value_formula STRING, value_expression "
            "STRING, value_assumptions STRING, accepted BOOLEAN, preview_sample_entities BIGINT, passing_records BIGINT, act_now_share DOUBLE, "
            "review_share DOUBLE, impact_kind STRING, impact_unit STRING, kpi_name STRING, kpi_source STRING, kpi_direction STRING, kpi_unit STRING, kpi_baseline DOUBLE, kpi_baseline_on STRING, kpi_latest DOUBLE, kpi_target DOUBLE, kpi_target_text STRING, kpi_status STRING, kpi_reason STRING, kpi_measured_at TIMESTAMP, kpi_query STRING, act_now_capacity BIGINT, over_capacity_records BIGINT, not_reliable STRING, "
            "run_facts STRING, updated_at TIMESTAMP)") in spark.statements[2]
    assert len(spark.statements) == 6, "the count, the run total, the summary create, its describe, the merge and the ledger; no column is altered"
    merge = next(s for s in spark.statements if s.startswith(f"MERGE INTO {QUOTED_SUMMARY}"))
    assert spark.statements[-1].startswith("INSERT INTO `main`.`inspire`.`__inspire_value_ledger`") and "'r-1'" in spark.statements[-1]
    assert merge.startswith(f"MERGE INTO {QUOTED_SUMMARY} AS s USING (SELECT 'N01-U01' AS use_case_id, 'r-1' AS run_id)")
    assert ("`act_now_records` = 0, `review_records` = 0, `records` = 4, `nothing_to_act` = 'No record has 1,000 USD or more at "
            "stake, the amount this use case reviews from; the most at stake on one record is 812.5 USD.', `value_at_stake` = NULL, "
            "`currency` = 'USD', `decision_basis` = 'measured', `act_now_amount` = 5000.0, `review_amount` = 1000.0, `value_formula` = NULL, "
            "`value_expression` = NULL, `value_assumptions` = NULL, `accepted` = NULL") in merge
    assert printed == ["Business output: 0 Act now and 0 Review of 4 current records, so the App shows nothing to act on yet, with "
                       f"Inspire's reason, since the run gave no nothing_to_act: {reason}"]


def test_the_run_s_own_reason_wins_and_is_dropped_when_records_need_action(agent_ns, monkeypatch):
    monkeypatch.setitem(agent_ns, "inspire_widget", lambda name, default="": {"02_inspire_database": "main.inspire", "14_session_id": "42"}.get(name, default))
    spark, printed = _outcome_spark({"act_now_records": 0, "review_records": 0, "records": 4}), []
    given = "No model beat the baseline yet; 3 more closed months are needed."
    assert agent_ns["inspire_save_outcome"](spark, TABLE, "N01-U01", "r-1", COLUMNS, PREDICTED, given, printed.append) == given
    assert printed[-1].endswith(f"with the run's own reason: {given}")
    acting, printed = _outcome_spark({"act_now_records": 2, "review_records": 1, "records": 4, "value_at_stake": 12.5}), []
    assert agent_ns["inspire_save_outcome"](acting, TABLE, "N01-U01", "r-1", COLUMNS, PREDICTED, given, printed.append) is None
    merged = next(s for s in acting.statements if s.startswith(f"MERGE INTO {QUOTED_SUMMARY}"))
    assert "`nothing_to_act` = NULL" in merged and "`value_at_stake` = 12.5" in merged
    assert printed == ["Business output: 2 Act now and 1 Review of 4 current records (the nothing_to_act reason the run gave was "
                       "left out, since records need action)"]


def test_a_run_without_the_value_contract_records_no_money_fields_and_a_failure_never_stops_the_run(agent_ns):
    spark = _outcome_spark({"records": 4})
    agent_ns["inspire_save_outcome"](spark, TABLE, "N01-U01", "r-1", COLUMNS, None, "", lambda *_a: None)
    assert not any(s.startswith("ALTER") for s in spark.statements)
    assert "`currency`" not in spark.statements[-1], "a run without the value contract records no money fields"
    broken, printed = _outcome_spark({"records": 4}, fail="MERGE INTO"), []
    assert agent_ns["inspire_save_outcome"](broken, TABLE, "N01-U01", "r-1", COLUMNS, MEASURED, "", printed.append) is None
    assert printed == ["Business output: run r-1 wrote its rows, but Inspire could not record how many of them need action in "
                       "main.inspire.churn_out_summary: PERMISSION_DENIED: MERGE INTO"]
    untiered = _outcome_spark({"records": 4})
    assert agent_ns["inspire_save_outcome"](untiered, TABLE, "N01-U01", "r-1", ["entity_id"], None, "", print) is None
    assert untiered.statements == [], "a table without priority_tier has no outcome to count"


def test_the_build_warning_carries_the_reason_the_run_recorded(agent_ns):
    warn = agent_ns["implement_tier_mix_warning"]
    reason = "No record has 1,000 USD or more at stake, the amount this use case reviews from."
    assert warn({"Monitor": 4}, "", None, None, reason) == (
        "Decision list: no row of the latest run reached Act now or Review (4 Monitor), so it has nobody to act on yet; the run gave "
        "a reason of its own in nothing_to_act, which the App shows")
    assert warn({"Monitor": 4}, "", None, None, "  ") == warn({"Monitor": 4}), "no reason adds nothing"
    assert warn({"Act now": 1}, "", None, None, reason) == ""
    rows = [{"nothing_to_act": reason}]
    inst = build_inspire(agent_ns)
    inst.spark = FakeSpark(responder=lambda s: rows if s.startswith("SELECT nothing_to_act") else [])
    assert inst._implement_run_reason("N01-U01", TABLE, "r-9") == reason
    assert inst.spark.statements == [f"SELECT nothing_to_act, not_reliable FROM {QUOTED_SUMMARY} WHERE use_case_id = 'N01-U01' AND "
                                     "run_id = 'r-9'"]
    inst.spark = FakeSpark()
    assert inst._implement_run_reason("N01-U01", TABLE, None) == "" and inst.spark.statements == []
    inst.logger = CapturingLogger()
    inst.spark = FakeSpark(responder=lambda s: (_ for _ in ()).throw(RuntimeError("[TABLE_OR_VIEW_NOT_FOUND] summary")))
    assert inst._implement_run_reason("N01-U01", TABLE, "r-9") == ""
    assert any(level == "WARNING" and "could not read the latest run's reason" in m for level, m in inst.logger.records)
