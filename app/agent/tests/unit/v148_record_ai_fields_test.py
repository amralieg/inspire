import re
import sqlite3
import types

import pytest

from v120_artifacts_support import FakeSpark
from v142_scd_test import CORE, HISTORY, QUOTED, QUOTED_STAGE, STAGE, TABLE, _describe, _Frame, _Tables

CATEGORIES = {"ai_cat_driver": {"meaning": "what moved the record most", "values": ["Price", "Volume", "Mix"]}}
NEW_TEXTS = ("ai_next_action", "ai_expected_result", "ai_other_option")
NEW_COLUMNS = NEW_TEXTS + ("ai_evidence",)
FORMULA = "{margin_lost_week:money} margin lost a week x {WEEKS_LEFT_IN_SEASON} weeks left in the season"
PRICED = CORE + [("margin_lost_week", "double"), ("value_at_stake", "double")]
EXPRESSION = "margin_lost_week * WEEKS_LEFT_IN_SEASON"
MEASURED = {"basis": "measured", "currency": "USD", "amounts": {"act_now_amount": "5000", "review_amount": "1000"},
            "formula": FORMULA, "expression": EXPRESSION, "expression_required": True, "constants": {"WEEKS_LEFT_IN_SEASON": 6},
            "bounds": None, "bounds_required": False, "widget_names": []}


def _ai(ns):
    return ns["inspire_ai_config"](CATEGORIES, "databricks-fast-a", "Business: Acme")


def _lite():
    db = sqlite3.connect(":memory:")
    db.create_function("FORMAT_NUMBER", 2, lambda x, d: None if x is None else f"{x:,.{int(d)}f}")
    db.create_function("REGEXP_REPLACE", 3, lambda s, p, r: None if s is None else re.sub(p, r, s))
    return db


def _formula_texts(ns, value, schema, rows):
    sqlglot = pytest.importorskip("sqlglot")
    formula, problems = ns["inspire_value_formula"](value, schema)
    assert problems == [], problems
    sql = sqlglot.parse_one(f"SELECT {ns['inspire_value_formula_sql'](formula, value, 's')} AS t FROM stage AS s",
                            read="databricks").sql(dialect="sqlite")
    db = _lite()
    names = [name for name, _kind in schema]
    db.execute(f"CREATE TABLE stage ({', '.join(names)})")
    db.executemany(f"INSERT INTO stage VALUES ({', '.join('?' for _ in names)})", [tuple(r.get(n) for n in names) for r in rows])
    return [r[0] for r in db.execute(sql).fetchall()]


def _cites_the_facts(ns, sentence, facts):
    return any(n in facts for n in re.findall(ns["INSPIRE_AI_NUMBER"], sentence))


def test_one_ai_call_writes_the_next_action_result_other_option_and_evidence(agent_ns):
    ai = _ai(agent_ns)
    assert [name for name, _kind in agent_ns["inspire_ai_columns"](ai)] == [
        "ai_explanation", "ai_confidence_reason", "ai_next_action", "ai_expected_result", "ai_other_option", "ai_evidence",
        "ai_facts_hash", "ai_check", "ai_cat_driver"]
    prompt = ai["prompt"]
    assert prompt.index("the user's directive wins") < prompt.index('"next_action"')
    for key in ('"next_action": one plain sentence', '"expected_result": one plain sentence', '"other_option": one plain sentence',
                '"evidence": a JSON array of 2 to 4 short plain sentences'):
        assert key in prompt, key
    assert "with a number from the facts when the facts give one" in prompt
    assert "each stating one fact behind this record with a number written exactly as the facts write it" in prompt
    reply = agent_ns["inspire_ai_reply_sql"]("SELECT 1", ai)
    assert reply.count("ai_query(") == 1, "every field comes from the one call that writes ai_explanation"
    checked = agent_ns["inspire_ai_checked_sql"](TABLE, "_s", ai)
    assert ("'explanation STRING, confidence_reason STRING, next_action STRING, expected_result STRING, other_option STRING, "
            "ai_cat_driver STRING, evidence ARRAY<STRING>'") in checked
    assert "trim(b.ai_json.next_action) AS `ai_next_action`" in checked
    assert "to_json(transform(b.ai_json.evidence, e -> trim(e))) AS `ai_evidence`" in checked
    update = agent_ns["inspire_ai_update_sql"](TABLE, "_s", ai)
    for name in NEW_COLUMNS:
        assert f"`{name}` = c.`{name}`" in update, name
    assert agent_ns["INSPIRE_AI_PROMPT_VERSION"] == "4" and ai["version"] == "4", "a new reply contract explains every record again"


def test_the_new_fields_are_carried_to_a_new_version_only_while_its_facts_are_unchanged(agent_ns):
    ai = _ai(agent_ns)
    merge = agent_ns["inspire_history_merge_sql"](TABLE, STAGE, [n for n, _k in CORE], ("entity_id",), "N01-U01", False, ai)
    same = f"p.ai_facts_hash = {agent_ns['inspire_ai_hash_sql'](ai['fingerprint'], 's')}"
    for name in NEW_COLUMNS:
        assert f"CASE WHEN {same} THEN p.`{name}` END AS `{name}`" in merge, name
        assert f"u.`{name}`, " in merge, name
    old = [c for c in agent_ns["inspire_ai_columns"](ai) if c[0] not in NEW_COLUMNS]
    spark = FakeSpark()
    added = agent_ns["inspire_ensure_ai"](spark, TABLE, [("entity_id", "string")] + [(n, k.lower()) for n, k in old], ai, out=lambda *_a: None)
    assert added == list(NEW_COLUMNS)
    assert spark.statements == [f"ALTER TABLE {QUOTED} ADD COLUMN `{name}` STRING" for name in NEW_COLUMNS], \
        "an old table gets the columns, never a rebuild"


def test_the_hedge_and_missing_reasoning_checks_cover_every_new_text_and_the_evidence(agent_ns):
    ai = _ai(agent_ns)
    checks = agent_ns["inspire_ai_checks"](ai)
    assert [label for label, _test, _detail in checks] == [
        "endpoint error", "unreadable reply", "hedged explanation", "no confidence reason", "hedged confidence reason",
        "no next action", "hedged next action", "no expected result", "hedged expected result", "no other option",
        "hedged other option", "evidence not 2 to 4 sentences", "hedged evidence", "evidence without a number from the facts",
        "explanation names another confidence level", "explanation gives the confidence as a number",
        "confidence reason names another confidence level", "confidence reason gives the confidence as a number",
        "next action names another confidence level", "next action gives the confidence as a number",
        "expected result names another confidence level", "expected result gives the confidence as a number",
        "other option names another confidence level", "other option gives the confidence as a number",
        "ai_cat_driver outside its values"]
    tests = {label: test for label, test, _detail in checks}
    for name in NEW_TEXTS:
        label = name[3:].replace("_", " ")
        assert tests[f"no {label}"] == f"coalesce(c.`{name}`, '') = ''"
        assert tests[f"hedged {label}"].startswith(f"c.`{name}` RLIKE '(?i)")
    assert "size(c.ai_evidence_list) NOT BETWEEN 2 AND 4" in tests["evidence not 2 to 4 sentences"]
    assert "exists(c.ai_evidence_list, e -> e RLIKE '(?i)" in tests["hedged evidence"]
    assert "instr(c.ai_facts, n) > 0" in tests["evidence without a number from the facts"]
    hedge = agent_ns["INSPIRE_AI_HEDGE"]
    assert re.search(hedge, "I would call the store manager today.") and not re.search(hedge, "Call the store manager today.")
    facts = "entity_label: Store 12\nmargin lost a week: 1,400 USD\nsales change: -12.5%\nweeks left: 6"
    assert _cites_the_facts(agent_ns, "Margin fell by 1,400 USD a week.", facts)
    assert _cites_the_facts(agent_ns, "Sales are down 12.5% on last year.", facts)
    assert not _cites_the_facts(agent_ns, "Margin fell by 2,000 USD a week.", facts), "a number the facts do not hold is rejected"
    assert not _cites_the_facts(agent_ns, "Margin keeps falling.", facts), "a sentence without a number is rejected"
    sqlglot = pytest.importorskip("sqlglot")
    sqlglot.parse_one(agent_ns["inspire_ai_checked_sql"](TABLE, "_s", ai), read="databricks")


def test_the_money_formula_fills_in_each_record_s_numbers_and_is_null_without_money_at_stake(agent_ns):
    rows = [{"margin_lost_week": 1400.0, "value_at_stake": 8400.0}, {"margin_lost_week": 1400.5, "value_at_stake": 8403.0},
            {"margin_lost_week": 0.0, "value_at_stake": 0.0}, {"margin_lost_week": 900.0, "value_at_stake": None}]
    texts = _formula_texts(agent_ns, MEASURED, PRICED, rows)
    assert texts == ["1,400 USD margin lost a week x 6 weeks left in the season = 8,400 USD",
                     "1,400.5 USD margin lost a week x 6 weeks left in the season = 8,403 USD",
                     "0 USD margin lost a week x 6 weeks left in the season = 0 USD", None]
    shares = dict(MEASURED, formula="{churn_risk:percent} chance to leave x {sales_12m:money} sales a year", currency="AED")
    schema = [("churn_risk", "double"), ("sales_12m", "decimal(18,2)"), ("value_at_stake", "double")]
    assert _formula_texts(agent_ns, shares, schema, [{"churn_risk": 0.125, "sales_12m": 12000.0, "value_at_stake": 1500.0}]) == [
        "12.5% chance to leave x 12,000 AED sales a year = 1,500 AED"]
    money = agent_ns["inspire_money_text"]
    amounts = [0.0, 5.0, 999.99, 1000.0, 1234.5, 1234567.891, 0.004]
    plain = dict(MEASURED, formula="{amount:money} at stake")
    shown = _formula_texts(agent_ns, plain, [("amount", "double"), ("value_at_stake", "double")],
                           [{"amount": a, "value_at_stake": a} for a in amounts])
    assert shown == [f"{money(a, 'USD')} at stake = {money(a, 'USD')}" for a in amounts], "the formula writes money like Inspire's messages"


@pytest.mark.parametrize("formula,constants,problem", [
    (None, {}, "the notebook has no VALUE_AT_STAKE_FORMULA, so the App cannot show how each record's money at stake is worked out"),
    ("   ", {}, "the notebook has no VALUE_AT_STAKE_FORMULA"),
    ("{margin_lost_week:money} x {SEASON_WEEKS}", {}, "{SEASON_WEEKS} in VALUE_AT_STAKE_FORMULA is neither a numeric column"),
    ("{margin_lost_week:money} x {SEASON_WEEKS}", {"SEASON_WEEKS": "6"}, "{SEASON_WEEKS} in VALUE_AT_STAKE_FORMULA is neither"),
    ("{margin_lost_week:money} x {SEASON_WEEKS}", {"SEASON_WEEKS": True}, "{SEASON_WEEKS} in VALUE_AT_STAKE_FORMULA is neither"),
    ("{entity_label} margin", {}, "{entity_label} in VALUE_AT_STAKE_FORMULA names a column of the rows that is not a number"),
    ("{margin_lost_week:dollars} lost", {}, "{margin_lost_week:dollars} in VALUE_AT_STAKE_FORMULA has the format 'dollars'"),
    ("{value_at_stake:money} at stake", {}, "VALUE_AT_STAKE_FORMULA names value_at_stake itself"),
    ("{margin_lost_week:money} x 6 = {value_at_stake:money}", {}, "VALUE_AT_STAKE_FORMULA names value_at_stake itself"),
    ("{margin_lost_week:money} x 6 weeks = total", {}, "VALUE_AT_STAKE_FORMULA holds '='"),
    ("{margin_lost_week:money} x {{6}} weeks", {}, "VALUE_AT_STAKE_FORMULA has a brace outside a {name} or {name:format}"),
    ("{WEEKS} weeks of margin", {"WEEKS": 6}, "VALUE_AT_STAKE_FORMULA names no column of the rows"),
    ("{margin_lost_week:money} " + "x" * 300, {}, "VALUE_AT_STAKE_FORMULA is 325 characters; at most 300 are allowed"),
])
def test_a_missing_or_broken_money_formula_is_refused_with_the_exact_reason(agent_ns, formula, constants, problem):
    found, problems = agent_ns["inspire_value_formula"](dict(MEASURED, formula=formula, constants=constants), PRICED)
    assert found is None and any(p.startswith(problem) for p in problems), problems
    ok, none = agent_ns["inspire_value_formula"](dict(MEASURED, formula=" {MARGIN_LOST_WEEK:money}   lost "), PRICED)
    assert none == [] and ok == {"parts": [("column", "margin_lost_week", "money"), ("text", " lost")], "columns": ["margin_lost_week"],
                                 "text": "{MARGIN_LOST_WEEK:money} lost", "assumptions": []}


def test_the_run_writes_the_formula_itself_refuses_a_priced_row_it_cannot_show_and_adds_the_column_to_old_tables(agent_ns):
    staged = PRICED + [("value_at_stake_formula", "string")]
    tables = _Tables(agent_ns, stage=staged, target=None)
    printed = []
    assert agent_ns["inspire_merge_run"](tables.spark, TABLE, STAGE, out=printed.append, value=MEASURED) == 3
    [create] = [s for s in tables.spark.statements if s.startswith(f"CREATE TABLE {QUOTED} ")]
    assert ("CASE WHEN s.`value_at_stake` IS NULL THEN NULL ELSE concat(concat(regexp_replace(format_number(CAST("
            "s.`margin_lost_week` AS DOUBLE), 2), '\\\\.?0+$', ''), ' USD'), ' margin lost a week x ', ") in create
    assert create.count("AS `value_at_stake_formula`") == 1 and "s.`value_at_stake_formula`" not in create
    assert ("Money at stake: left out value_at_stake_formula from the run's rows: Inspire writes it from VALUE_AT_STAKE_FORMULA and "
            "each row's numbers") in printed
    profile = [s for s in tables.spark.statements if s.startswith("SELECT COUNT(*) AS row_count")][0]
    assert "COUNT_IF(`value_at_stake` IS NOT NULL AND (`margin_lost_week` IS NULL)) AS unshown_stake" in profile
    unshown = _Tables(agent_ns, stage=PRICED, target=None, profile={"unshown_stake": 2})
    with pytest.raises(ValueError, match=r"2 rows have a value_at_stake but NULL in a column the VALUE_AT_STAKE_FORMULA names"):
        agent_ns["inspire_merge_run"](unshown.spark, TABLE, STAGE, out=lambda *_a: None, value=MEASURED)
    bare = _Tables(agent_ns, stage=PRICED, target=None)
    with pytest.raises(ValueError, match="the notebook has no VALUE_AT_STAKE_FORMULA"):
        agent_ns["inspire_merge_run"](bare.spark, TABLE, STAGE, out=lambda *_a: None, value=dict(MEASURED, formula=None))
    assert not any(s.startswith("CREATE TABLE") for s in bare.spark.statements), "a run whose money cannot be shown writes nothing"
    old = _Tables(agent_ns, stage=PRICED, target=PRICED + HISTORY)
    agent_ns["inspire_merge_run"](old.spark, TABLE, STAGE, out=printed.append, value=MEASURED)
    assert f"ALTER TABLE {QUOTED} ADD COLUMN `value_at_stake_formula` STRING" in old.spark.statements
    assert not any(s.startswith(f"CREATE OR REPLACE TABLE {QUOTED}") for s in old.spark.statements)
    [merge] = [s for s in old.spark.statements if s.startswith(f"MERGE INTO {QUOTED} ") and "WHEN NOT MATCHED THEN INSERT" in s]
    assert merge.count("AS `value_at_stake_formula`") == 1 and "`value_at_stake_formula`, `action_owner`" in merge, \
        "the run's formula is written once, into the rows the merge compares and inserts"
    plain = _Tables(agent_ns, stage=CORE + [("value_at_stake_formula", "string")], target=None)
    agent_ns["inspire_merge_run"](plain.spark, TABLE, STAGE, out=lambda *_a: None)
    assert "s.`value_at_stake_formula`" in [s for s in plain.spark.statements if s.startswith("CREATE TABLE")][0], \
        "without the money contract the column is the notebook's own"


def test_the_write_reads_the_formula_and_its_named_assumptions_from_the_notebook(fresh_ns):
    fresh_ns["INSPIRE_RUN"] = {"decision_basis": "measured", "value_expression": True}
    values = {"currency": "USD", "act_now_amount": "5000", "review_amount": "1000"}
    fresh_ns["dbutils"] = types.SimpleNamespace(widgets=types.SimpleNamespace(get=values.__getitem__))
    fresh_ns["VALUE_AT_STAKE_FORMULA"] = FORMULA
    fresh_ns["VALUE_AT_STAKE_EXPRESSION"] = EXPRESSION
    fresh_ns["WEEKS_LEFT_IN_SEASON"] = 6
    assert fresh_ns["inspire_value_run_config"](["value_at_stake"]) == dict(MEASURED, kind="money", unit="USD")
    seen = []
    fresh_ns["inspire_merge_run"] = lambda spark, table, stage, out=print, ai=None, ai_cap=None, value=None, nothing_to_act=None, accepted=None: \
        seen.append(value) or 3
    frame = _Frame([("entity_id", "string"), ("margin_lost_week", "double"), ("value_at_stake", "double")])
    assert fresh_ns["inspire_write_result"](frame, TABLE, spark_session=FakeSpark(), out=lambda *_a: None) == 3
    assert seen == [dict(MEASURED, kind="money", unit="USD", accepted=None, passed=None, preview_sample_entities=None)]
    assert fresh_ns["inspire_write_result"](frame, TABLE, spark_session=FakeSpark(), out=lambda *_a: None, accepted=False) == 3
    assert seen[-1] == dict(MEASURED, kind="money", unit="USD", accepted=False, passed=None, preview_sample_entities=None), \
        "the run's acceptance reaches the write with the money settings"
    del fresh_ns["VALUE_AT_STAKE_FORMULA"]
    assert fresh_ns["inspire_value_run_config"](["value_at_stake"])["formula"] is None


def test_genie_is_told_to_define_the_formula_and_the_app_columns_stay_free_text(agent_ns):
    rule = agent_ns["genie_value_at_stake_rule"]("predicted")
    assert "Define `VALUE_AT_STAKE_FORMULA` at top level, after the Parameters cell" in rule
    assert ("'{margin_lost_week:money} margin lost a week x {WEEKS_LEFT_IN_SEASON} weeks left in the season'" in rule
            and agent_ns["INSPIRE_VALUE_FORMULA_EXAMPLE"] in rule)
    assert "writes the text as `value_at_stake_formula`, which the App shows next to every amount, so never write that column" in rule
    assert "never set them either, nor `value_at_stake_formula`" in agent_ns["GENIE_RESULT_HISTORY_RULE"]
    for name in NEW_COLUMNS + ("value_at_stake_formula",):
        assert agent_ns["implement_genie_column_flags"](name, "string") == (False, False), name
    assert "ai_next_action, ai_expected_result, ai_other_option, ai_evidence, ai_facts_hash" in agent_ns["GENIE_EXPLANATION_FACTS_RULE"]
