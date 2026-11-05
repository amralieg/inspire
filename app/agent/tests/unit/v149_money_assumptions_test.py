import ast
import json
import types

import pytest

from v120_artifacts_support import FakeSpark
from v120_genie_support import build_inspire, make_uc
from v130_genie_run_controls_test import _controls, _dbutils
from v142_scd_test import QUOTED_SUMMARY, SUMMARY, _describe
from v147_value_at_stake_test import COLUMNS, MEASURED, PREDICTED, STAGE, TABLE, _row, _sqlite

FORMULA = "{margin_lost_week:money} margin lost a week x {WEEKS_LEFT:number} weeks left at {KEEP_RATE:percent} kept"
SCHEMA = [("entity_id", "string"), ("priority_tier", "string"), ("value_at_stake", "double"), ("margin_lost_week", "double"),
          ("region", "string"), ("units", "bigint")]


def _value(expression, basis="measured", required=True, **constants):
    known = dict({"WEEKS_LEFT": 12, "KEEP_RATE": 0.5}, **constants)
    return dict(MEASURED if basis == "measured" else PREDICTED, formula=FORMULA, expression=expression, expression_required=required,
                constants=known)


def _parsed(agent_ns, expression="margin_lost_week * WEEKS_LEFT * KEEP_RATE", basis="measured", **constants):
    value = _value(expression, basis, **constants)
    formula, problems = agent_ns["inspire_value_formula"](value, SCHEMA)
    assert problems == []
    return value, formula


@pytest.mark.parametrize("text,sql", [
    ("greatest(0, margin_lost_week * WEEKS_LEFT * KEEP_RATE)", "GREATEST(0.0, ((CAST(`margin_lost_week` AS DOUBLE) * 12.0) * 0.5))"),
    ("(margin_lost_week - units) / WEEKS_LEFT * KEEP_RATE", "(((CAST(`margin_lost_week` AS DOUBLE) - CAST(`units` AS DOUBLE)) / NULLIF(12.0, 0)) * 0.5)"),
    ("-margin_lost_week + 2.5 * WEEKS_LEFT * least(KEEP_RATE, 1)", "((- CAST(`margin_lost_week` AS DOUBLE)) + ((2.5 * 12.0) * LEAST(0.5, 1.0)))"),
])
def test_the_expression_reads_numbers_names_signs_and_two_functions_into_sql(agent_ns, text, sql):
    value, formula = _parsed(agent_ns, text)
    expression, problems = agent_ns["inspire_value_expression"](value, SCHEMA, formula)
    assert problems == [] and expression["text"] == text
    assert agent_ns["inspire_value_expression_sql"](expression, value) == sql


@pytest.mark.parametrize("text,problem", [
    ("margin_lost_week ** WEEKS_LEFT * KEEP_RATE", "is not arithmetic Inspire can read: expected a number, a name or ( at *"),
    ("sum(margin_lost_week) * WEEKS_LEFT * KEEP_RATE", "is not arithmetic Inspire can read: sum( ) is not greatest( ) or least( )"),
    ("margin_lost_week * WEEKS_LEFT * KEEP_RATE; DROP TABLE x", "has '; DROP TABLE x', which is not a number, a name"),
    ("greatest(margin_lost_week) * WEEKS_LEFT * KEEP_RATE", "greatest( ) needs at least two values"),
    ("margin_lost_week * WEEKS_LEFT * KEEP_RATE + 'x'", "has \"'x'\", which is not a number"),
    ("margin_lost_week WEEKS_LEFT KEEP_RATE", "is not arithmetic Inspire can read: unexpected WEEKS_LEFT"),
    ("greatest * WEEKS_LEFT * KEEP_RATE", "greatest is a function, so it takes values in ( )"),
    ("region * WEEKS_LEFT * KEEP_RATE", "region in VALUE_AT_STAKE_EXPRESSION names a column of the rows that is not a number"),
    ("margin_lost_week * WEEKS_LEFT * KEEP_RATE * UNKNOWN", "UNKNOWN in VALUE_AT_STAKE_EXPRESSION is neither a numeric column"),
    ("margin_lost_week * WEEKS_LEFT", "must name the same assumption constants as VALUE_AT_STAKE_FORMULA, so the App shows every "
                                      "assumption that changes the money: only the formula names KEEP_RATE"),
    ("WEEKS_LEFT * KEEP_RATE * 10", "names no column of the rows, so every record would have the same money at stake"),
])
def test_an_expression_inspire_cannot_read_or_that_hides_an_assumption_is_refused(agent_ns, text, problem):
    value, formula = _parsed(agent_ns, text)
    expression, problems = agent_ns["inspire_value_expression"](value, SCHEMA, formula)
    assert expression is None and len(problems) == 1 and problem in problems[0], problems


def test_an_expression_naming_an_assumption_the_formula_hides_is_refused(agent_ns):
    value = dict(_value("margin_lost_week * WEEKS_LEFT * KEEP_RATE * EXTRA", EXTRA=2))
    formula, _problems = agent_ns["inspire_value_formula"](value, SCHEMA)
    _expression, problems = agent_ns["inspire_value_expression"](value, SCHEMA, formula)
    assert problems and "only the expression names EXTRA" in problems[0]


def test_the_expression_is_required_only_when_the_formula_names_an_assumption(agent_ns):
    value, formula = _parsed(agent_ns, None)
    expression, problems = agent_ns["inspire_value_expression"](value, SCHEMA, formula)
    assert expression is None and len(problems) == 1
    assert problems[0].startswith("the notebook has no VALUE_AT_STAKE_EXPRESSION, so the App cannot work out the money at stake again "
                                  "when someone changes WEEKS_LEFT, KEEP_RATE")
    old = dict(value, expression_required=False)
    assert agent_ns["inspire_value_expression"](old, SCHEMA, formula) == (None, []), \
        "a notebook built before the rule keeps running after its Run controls are brought up to date"
    plain = dict(MEASURED, formula="{margin_lost_week:money} margin lost", expression=None, constants={})
    formula, _ = agent_ns["inspire_value_formula"](plain, SCHEMA)
    assert formula["assumptions"] == [] and agent_ns["inspire_value_expression"](plain, SCHEMA, formula) == (None, [])


def test_the_formula_lists_each_assumption_once_with_its_value_and_format(agent_ns):
    value = dict(_value(None), formula=FORMULA + ", {WEEKS_LEFT} weeks again")
    formula, problems = agent_ns["inspire_value_formula"](value, SCHEMA)
    assert problems == [] and formula["text"] == FORMULA + ", {WEEKS_LEFT} weeks again"
    assert formula["assumptions"] == [{"name": "WEEKS_LEFT", "value": 12.0, "kind": "number"},
                                      {"name": "KEEP_RATE", "value": 0.5, "kind": "percent"}]


def test_a_run_whose_money_differs_from_its_expression_is_refused(agent_ns):
    value, formula = _parsed(agent_ns, "greatest(0, margin_lost_week * WEEKS_LEFT * KEEP_RATE)")
    expression, _ = agent_ns["inspire_value_expression"](value, SCHEMA, formula)
    columns = COLUMNS + ["margin_lost_week"]
    sql = agent_ns["inspire_run_profile_sql"](STAGE, columns, value, formula, expression)
    rows = [_row("a", "Act now", 6000.0, margin_lost_week=1000.0), _row("b", "Review", 1200.004, margin_lost_week=200.0),
            _row("c", "Monitor", 0.0, margin_lost_week=-50.0), _row("d", "Monitor", None, margin_lost_week=None),
            _row("e", "Monitor", 600000.0, margin_lost_week=100000.0)]
    assert _sqlite(sql, rows)["off_expression"] == 0, "rounding to the cent and the floor at 0 still follow the expression"
    wrong = rows + [_row("f", "Act now", 9000.0, margin_lost_week=1000.0), _row("g", "Review", 1300.0, margin_lost_week=None),
                    _row("h", "Monitor", 600100.0, margin_lost_week=100000.0)]
    found = _sqlite(sql, wrong)
    assert found["off_expression"] == 3
    problems = agent_ns["inspire_run_problems"](dict(found, row_count=8, use_cases=1, runs=1), value)
    assert any(p.startswith("3 rows have a value_at_stake that VALUE_AT_STAKE_EXPRESSION does not give from the row's own numbers")
               for p in problems)
    assert "off_expression" not in agent_ns["inspire_run_profile_sql"](STAGE, columns, value, formula), "no expression, no check"


def _summary_spark(found):
    def respond(statement):
        if statement.startswith("SELECT COUNT_IF(t.`priority_tier` = 'Act now') AS act_now_records"):
            return [found]
        if statement == f"DESCRIBE TABLE {QUOTED_SUMMARY}":
            return _describe(SUMMARY)
        return []
    return FakeSpark(responder=respond)


def test_the_run_saves_its_formula_expression_assumptions_and_acceptance_for_the_app(agent_ns):
    value, formula = _parsed(agent_ns, "greatest(0, margin_lost_week * WEEKS_LEFT * KEEP_RATE)", basis="predicted")
    expression, _ = agent_ns["inspire_value_expression"](value, SCHEMA, formula)
    value["accepted"] = True
    spark, printed = _summary_spark({"act_now_records": 2, "review_records": 1, "records": 5, "value_at_stake": 9.5}), []
    agent_ns["inspire_save_outcome"](spark, TABLE, "N01-U01", "r-1", COLUMNS, value, "", printed.append, formula, expression)
    merge = spark.statements[-1]
    assumptions = json.dumps(formula["assumptions"], ensure_ascii=False)
    assert (f"`value_formula` = '{FORMULA}', `value_expression` = 'greatest(0, margin_lost_week * WEEKS_LEFT * KEEP_RATE)', "
            f"`value_assumptions` = '{assumptions}', `accepted` = TRUE") in merge
    value["accepted"] = False
    agent_ns["inspire_save_outcome"](spark, TABLE, "N01-U01", "r-2", COLUMNS, value, "", printed.append, formula, None)
    assert "`value_expression` = NULL" in spark.statements[-1] and "`accepted` = FALSE" in spark.statements[-1]


def test_a_prediction_the_run_calls_unaccepted_has_no_actionable_record(agent_ns):
    unaccepted = dict(PREDICTED, accepted=False)
    sql = agent_ns["inspire_run_profile_sql"](STAGE, COLUMNS, unaccepted)
    rows = [_row("a", "Monitor", 10.0), _row("b", "Monitor", 20.0)]
    assert _sqlite(sql, rows)["unaccepted_flagged"] == 0
    found = _sqlite(sql, rows + [_row("c", "Act now", 30.0), _row("d", "Review", 5.0)])
    assert found["unaccepted_flagged"] == 2
    problems = agent_ns["inspire_run_problems"](dict(found, row_count=4, use_cases=1, runs=1), unaccepted)
    assert ("2 rows are 'Act now' or 'Review', but the run passed accepted=False: this use case acts on a prediction, so no record "
            "is actionable until a model passes acceptance; write every row 'Monitor' and pass nothing_to_act with the metrics that "
            "missed") in problems
    for value in (dict(PREDICTED, accepted=True), dict(PREDICTED, accepted=None), dict(MEASURED, accepted=False)):
        assert "unaccepted_flagged" not in agent_ns["inspire_run_profile_sql"](STAGE, COLUMNS, value), value
    reason = agent_ns["inspire_nothing_to_act"]
    assert reason({"records": 4}, unaccepted, "") == "No model passed this use case's acceptance check in the last run."
    assert reason({"records": 4}, unaccepted, "AUC 0.55 is below the 0.60 this use case needs.") == \
        "AUC 0.55 is below the 0.60 this use case needs.", "the run's own reason with its metrics wins"
    assert reason({"records": 0}, unaccepted, "") == "The last run wrote no current records."
    assert reason({"records": 4}, dict(PREDICTED, accepted=True), "") == "No record passed this use case's decision test in the last run."
    with pytest.raises(ValueError, match="inspire_write_result takes accepted=True or accepted=False, not 'yes'"):
        agent_ns["inspire_write_result"](None, TABLE, accepted="yes")


def test_the_genie_rules_ask_for_the_expression_and_for_acceptance_before_any_actionable_prediction(agent_ns):
    inst = build_inspire(agent_ns)
    for technique, measured in (("Cohort Analysis", True), ("Predictive Modeling", False), ("Forecasting", False),
                                ("Optimization", False), ("Recommendation", False)):
        spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
        rules = inst._genie_platform_rules(spec)
        assert "Define `VALUE_AT_STAKE_EXPRESSION` next to it whenever the formula names an assumption constant" in rules, technique
        assert "Inspire sets each changed constant before `run_use_case()` runs" in rules, technique
        stop = inst._genie_acceptance_stop_rule(spec)
        assert (agent_ns["GENIE_PREDICTED_ACCEPTED_RULE"] in stop) is (not measured), technique
        assert (agent_ns["GENIE_MEASURED_TIER_RULE"] in stop) is measured, technique


def _latest(rows, fail=None):
    def respond(statement):
        if fail and statement.startswith(fail):
            raise RuntimeError(f"PERMISSION_DENIED: {fail}")
        if statement.startswith("SELECT name, value, changed_by, changed_at, text_value FROM"):
            return rows
        return []
    return FakeSpark(responder=respond)


EDITS = [{"name": "KEEP_RATE", "value": 0.4, "changed_by": "pat.lee", "changed_at": "2026-10-24T09:00:00"},
         {"name": "WEEKS_LEFT", "value": 10.0, "changed_by": "sam.ortiz", "changed_at": "2026-10-25T09:00:00"},
         {"name": "GONE_RATE", "value": 2.0, "changed_by": "pat.lee", "changed_at": "2026-10-25T09:00:00"},
         {"name": "run_use_case", "value": 1.0, "changed_by": "pat.lee", "changed_at": "2026-10-25T09:00:00"},
         {"name": "SAME", "value": 3.0, "changed_by": "pat.lee", "changed_at": "2026-10-25T09:00:00"}]


def test_a_run_uses_the_assumptions_people_changed_in_the_app(agent_ns):
    scope, printed = {"WEEKS_LEFT": 12, "KEEP_RATE": 0.5, "SAME": 3, "run_use_case": print, "VALUE_AT_STAKE_FORMULA": FORMULA}, []
    spark = _latest(EDITS)
    applied = agent_ns["inspire_apply_assumptions"](spark, TABLE, "N01-U01", scope, printed.append)
    assert applied == {"KEEP_RATE": 0.4, "WEEKS_LEFT": 10} and isinstance(scope["WEEKS_LEFT"], int)
    assert scope["run_use_case"] is print and scope["SAME"] == 3
    assert spark.statements[0] == ("CREATE TABLE IF NOT EXISTS `main`.`inspire`.`churn_out_assumptions` (use_case_id STRING, name STRING, "
                                   "value DOUBLE, changed_by STRING, changed_at TIMESTAMP, note STRING, text_value STRING)")
    assert spark.statements[1] == "DESCRIBE TABLE `main`.`inspire`.`churn_out_assumptions`"
    assert "WHERE use_case_id = 'N01-U01') WHERE nth = 1" in spark.statements[2]
    assert printed == [
        "Money at stake: KEEP_RATE is 0.4 for this run, as pat.lee set it in the App on 2026-10-24T09:00:00 (the notebook's value is 0.5)",
        "Money at stake: WEEKS_LEFT is 10 for this run, as sam.ortiz set it in the App on 2026-10-25T09:00:00 (the notebook's value is 12)",
        "Money at stake: the App holds a value for GONE_RATE, which this notebook does not define as a number, so this run leaves it out",
        "Money at stake: the App holds a value for run_use_case, which this notebook does not define as a number, so this run leaves it out"]
    broken, printed = _latest(EDITS, fail="SELECT name"), []
    assert agent_ns["inspire_apply_assumptions"](broken, TABLE, "N01-U01", dict(scope), printed.append) == {}
    assert printed == ["Money at stake: Inspire could not read the assumptions people changed in the App from "
                       "main.inspire.churn_out_assumptions, so this run uses the notebook's own values: PERMISSION_DENIED: SELECT name"]
    assert agent_ns["inspire_apply_assumptions"](None, TABLE, "N01-U01", dict(scope), printed.append) == {}
    for formula in (None, "{margin_lost_week:money} margin lost", "{margin_lost_week:money} x {run_use_case}"):
        untouched = _latest(EDITS)
        assert agent_ns["inspire_apply_assumptions"](untouched, TABLE, "N01-U01", dict(scope, VALUE_AT_STAKE_FORMULA=formula), print) == {}
        assert untouched.statements == [], f"a formula without an assumption constant reads and creates nothing: {formula}"


def test_main_sets_the_changed_assumptions_before_the_use_case_runs(agent_ns):
    ns, _call = _controls(agent_ns)
    seen, printed = {}, []
    ns.update(WEEKS_LEFT=12, KEEP_RATE=0.5, VALUE_AT_STAKE_FORMULA=FORMULA, spark=_latest(EDITS[:2]))
    ns["run_use_case"] = lambda: seen.update(weeks=ns["WEEKS_LEFT"], keep=ns["KEEP_RATE"]) or {"status": "written", "rows_written": 3, "as_of_date": "2026-01-01", "run_id": "r-1"}
    dbu = _dbutils(execution="Here")
    dbu.notebook.exit = lambda text: printed.append(("exit", text))
    ns["inspire_main"](dbu=dbu, out=printed.append)
    assert seen == {"weeks": 10, "keep": 0.4}
    exit_text = next(text for kind, text in (p for p in printed if isinstance(p, tuple)))
    assert "Money at stake: WEEKS_LEFT is 10 for this run" in exit_text, "the change is in the run's printed log"
    assert ns["spark"].statements[0].startswith("CREATE TABLE IF NOT EXISTS `main`.`inspire`.`n01_u01")


def test_only_a_notebook_built_with_the_expression_rule_must_define_the_expression(agent_ns, fresh_ns):
    inst = build_inspire(agent_ns)
    uc = make_uc(**{"Analytics Technique": "Cohort Analysis"})
    spec = inst._genie_notebook_spec(uc)
    run_of = lambda text: ast.literal_eval(inst._genie_run_controls_source(uc, spec, text).split("INSPIRE_RUN = ", 1)[1].split("\n\n\n", 1)[0])
    old = "## 1. Goal\nAn instruction written before the expression rule.\n"
    assert run_of(inst._genie_with_platform_rules(old, spec))["value_expression"] is True, "a notebook built now carries the rule"
    assert run_of(old)["value_expression"] is False, "Run controls brought up to date in an older notebook do not ask for the expression"
    fresh_ns["dbutils"] = types.SimpleNamespace(widgets=types.SimpleNamespace(get={"currency": "USD", "act_now_amount": "5000",
                                                                                       "review_amount": "1000"}.__getitem__))
    for flag in (True, False):
        fresh_ns["INSPIRE_RUN"] = {"decision_basis": "measured", "value_expression": flag}
        assert fresh_ns["inspire_value_run_config"](["value_at_stake"])["expression_required"] is flag
    fresh_ns["INSPIRE_RUN"] = {"decision_basis": "measured"}
    assert fresh_ns["inspire_value_run_config"](["value_at_stake"])["expression_required"] is False
