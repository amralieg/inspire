"""Every use case is counted in its target KPI: Inspire's own KPI when the use case has one, the one the person picked in the
wizard when they picked one, or the best KPI Inspire evaluates during the build when it has none. Its impact is in the KPI's unit,
money only when the KPI is money, and every run measures the KPI with Inspire's read-only query next to its baseline and target,
offline."""
import json
import re
import types

import pytest

from v120_artifacts_support import FakeSpark
from v120_genie_support import CUSTOMERS, ORDERS, FakeLoader, build_inspire, make_uc
from v140_implement_test import VALID, _probe_inspire
from v142_scd_test import QUOTED_SUMMARY, SUMMARY, TABLE, _describe

HOURS = {"name": "Analyst hours spent on manual review", "kpi_id": None, "direction": "decrease", "unit": "hours",
         "aggregation": "SUM", "table": ORDERS, "column": "amount", "computable": True,
         "baseline": {"value": 1200.0, "measured_on": "2026-10-01"}}
REVENUE = {"name": "Retained revenue", "kpi_id": "K1", "direction": "increase", "unit": "USD", "aggregation": "SUM",
           "table": ORDERS, "column": "amount", "computable": True, "baseline": {"value": 50000.0, "measured_on": "2026-10-01"}}
TEXT_ONLY = {"name": "Customer trust", "kpi_id": None, "direction": "increase", "unit": "", "computable": False}
MEASURED_TECHNIQUE = "Anomaly Detection"


def _merge_values(statement):
    sets = statement.split("WHEN MATCHED THEN UPDATE SET ", 1)[1].split(", updated_at = current_timestamp()", 1)[0]
    return dict(re.findall(r"`(\w+)` = ((?:'(?:\\.|[^'])*'|timestamp_micros\(\d+\)|[^,])+)", sets))


def test_strategy_alignment_and_the_build_share_one_kpi_rule(agent_ns):
    rule = agent_ns["KPI_DEFINITION_RULE"]
    assert rule.startswith("**KPIs**: 1 to 3 per use case, each with `name`, `direction`")
    assert "4. " + rule + "\n5. **Key results**" in agent_ns["PROMPT_TEMPLATES"]["STRATEGY_ALIGNMENT_PROMPT"]
    from _agentload import agent_source
    assert agent_source().count("A % unit needs a share: COUNT over COUNT") == 1, "one copy of the KPI rule, used by both prompts"
    spec = agent_ns["validate_implement_spec"](dict(VALID, use_case={"goal": "Cut the hours analysts spend on manual review"},
                                                    data=dict(VALID["data"], notes="count hours, never money")))[0]
    prompt = agent_ns["implement_kpi_prompt"](make_uc(), {ORDERS: {"amount": "DECIMAL(12,2)"}}, spec)
    assert prompt.startswith(agent_ns["USER_DIRECTIVE_SUPREMACY_PREAMBLE"])
    assert "1. " + rule in prompt and "- Goal: Cut the hours analysts spend on manual review" in prompt
    assert '"""count hours, never money"""' in prompt and "the user's words win over every rule below" in prompt
    assert f"- `{ORDERS}`: amount decimal(12,2)" in prompt and "`kpi_id` is always null" in prompt


@pytest.mark.parametrize("kpi,kind,unit", [
    ({"name": "Analyst hours", "unit": "hours"}, "hours", "hours"),
    ({"name": "Handling time", "unit": "hrs"}, "hours", "hours"),
    ({"name": "Retained revenue", "unit": "USD"}, "money", "USD"),
    ({"name": "Retained revenue", "unit": "$"}, "money", "USD"),
    ({"name": "Monthly revenue", "unit": ""}, "money", ""),
    ({"name": "Churn rate", "unit": "%"}, "percent", "points of churn rate"),
    ({"name": "Number of late shipments", "unit": "count"}, "count", "late shipments"),
    ({"name": "Number of sales", "unit": ""}, "count", "sales"),
    ({"name": "Open incidents", "unit": "incidents"}, "count", "incidents"),
    ({"name": "Time to resolve", "unit": "days"}, "number", "days"),
    ({"name": "Energy use", "unit": "kWh"}, "number", "kWh"),
], ids=["hours", "hrs_is_not_a_currency", "usd", "dollar_sign", "money_name", "percent", "count", "count_of_sales", "plural",
        "days", "kwh_is_not_a_currency"])
def test_the_impact_is_in_the_kpi_s_unit_and_money_only_for_a_money_kpi(agent_ns, kpi, kind, unit):
    impact = agent_ns["kpi_impact"](kpi)
    assert (impact["kind"], impact["unit"]) == (kind, unit)
    assert impact["kpi"] == kpi["name"]


def test_the_person_s_kpi_wins_over_inspire_s_first_pick(agent_ns):
    pick = agent_ns["implement_pick_kpi"]
    assert pick([REVENUE, HOURS], "  analyst HOURS spent on manual review ") == (HOURS, "user")
    assert pick([REVENUE, HOURS]) == (REVENUE, "inspire"), "the KPI aligned to a strategy KPI comes first"
    assert pick([TEXT_ONLY, HOURS]) == (HOURS, "inspire"), "else the first computable one, never a KPI Inspire cannot measure"
    assert pick([TEXT_ONLY]) == (TEXT_ONLY, "inspire")
    assert pick([REVENUE], "Some other KPI") == (REVENUE, "inspire"), "a pick that is not one of the KPIs is not taken"
    assert pick([]) == (None, "")


def _spec_for(ns, kpis, technique=MEASURED_TECHNIQUE):
    inst = build_inspire(ns)
    return inst, inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique, "KPIs": kpis}))


def test_a_productivity_use_case_is_never_priced_in_money(agent_ns):
    inst, spec = _spec_for(agent_ns, [HOURS])
    assert spec["impact"] == {"kind": "hours", "unit": "hours", "kpi": HOURS["name"]}
    rules = inst._genie_platform_rules(spec)
    assert ("`value_at_stake` is the hours each record puts at stake on this use case's target KPI, Analyst hours spent on manual "
            "review, never money: one formula") in rules
    assert "in the currency the `currency` widget names" not in rules and "`currency` is the currency of the source amounts" not in rules
    assert "the formula counts the hours the data already shows is lost or at risk now" in rules
    assert "come from the hours at stake in the first full test run" in rules
    widgets = {w["name"]: w["label"] for w in inst._genie_core_widgets(spec)}
    assert "currency" not in widgets, "a use case counted in hours has no currency to set"
    assert widgets["act_now_amount"] == "Hours at stake to act now" and widgets["review_amount"] == "Hours at stake to review"
    meaning = [line for line in inst._genie_output_column_lines(spec) if line.startswith("value_at_stake ")][0]
    assert "the hours this record puts at stake on the target KPI, never money" in meaning and "currency" not in meaning


def test_a_money_kpi_is_still_priced_in_money_word_for_word(agent_ns):
    inst, spec = _spec_for(agent_ns, [REVENUE])
    assert spec["impact"] == {"kind": "money", "unit": "USD", "kpi": "Retained revenue"}
    rules = inst._genie_platform_rules(spec)
    assert ("`value_at_stake` is the money each record puts at stake, in the currency the `currency` widget names: one formula in "
            "code over the record's own amounts") in rules
    assert "a record the formula cannot price, such as one without a sales amount" in rules
    assert "`currency` is the currency of the source amounts, and `act_now_amount` and `review_amount` come from the money at stake" in rules
    assert "currency" in {w["name"] for w in inst._genie_core_widgets(spec)}
    _inst, legacy = _spec_for(agent_ns, [])
    assert legacy["impact"]["kind"] == "money" and legacy["target_kpi"] is None, "a use case with no KPI at all stays as it was"


def test_the_helper_asks_a_currency_only_of_a_money_run(agent_ns):
    problems = agent_ns["inspire_value_problems"]
    hours = {"basis": "measured", "currency": "", "kind": "hours", "unit": "hours", "amounts": {"act_now_amount": "x", "review_amount": "5"}}
    found = problems(hours)
    assert not any("currency widget" in p for p in found)
    assert "the act_now_amount widget is 'x'; set its default to an amount of at least 0 in the unit of value_at_stake (hours)" in found[0]
    money = dict(hours, kind="money", unit="")
    assert any("the currency widget is ''" in p for p in problems(money)), "a money run without a currency is still refused"
    assert any("the currency widget is ''" in p for p in problems({"basis": "measured", "currency": "", "amounts": {}})), \
        "a value from before the impact unit is money"


def test_the_run_config_carries_the_impact_and_old_notebooks_stay_money(fresh_ns):
    fresh_ns["INSPIRE_RUN"] = {"decision_basis": "measured", "impact": {"kind": "hours", "unit": "hours", "kpi": "Analyst hours"}}
    fresh_ns["dbutils"] = types.SimpleNamespace(widgets=types.SimpleNamespace(get={"act_now_amount": "40", "review_amount": "8"}.__getitem__))
    value = fresh_ns["inspire_value_run_config"](["value_at_stake"])
    assert (value["kind"], value["unit"], value["currency"]) == ("hours", "hours", "")
    assert fresh_ns["inspire_value_unit"](value) == "hours"
    fresh_ns["INSPIRE_RUN"] = {"decision_basis": "measured"}
    fresh_ns["dbutils"] = types.SimpleNamespace(widgets=types.SimpleNamespace(get={"currency": "EUR"}.__getitem__))
    old = fresh_ns["inspire_value_run_config"](["value_at_stake"])
    assert (old["kind"], old["unit"]) == ("money", "EUR")
    fresh_ns["INSPIRE_RUN"] = {"impact": {"kind": "shares", "unit": "x"}}
    assert fresh_ns["inspire_impact"]()["kind"] == "money", "an unknown kind is money, as before"


def test_the_tier_and_nothing_to_act_texts_use_the_unit(agent_ns):
    hours = {"basis": "measured", "currency": "", "kind": "hours", "unit": "hours", "amounts": {"act_now_amount": "40", "review_amount": "8"}}
    reason = agent_ns["inspire_nothing_to_act"]({"records": 5, "top_stake": 6.5}, hours, "")
    assert reason == "No record has 8 hours or more at stake, the amount this use case reviews from; the most at stake on one record is 6.5 hours."
    money = dict(hours, kind="money", unit="USD", currency="USD")
    assert agent_ns["inspire_nothing_to_act"]({"records": 5, "top_stake": 6.5}, money, "").startswith("No record has 8 USD or more")
    stake = agent_ns["inspire_value_formula_sql"]({"parts": [("text", "hours lost")]}, hours, "s")
    assert "' hours'" in stake and "' USD'" not in stake


def test_the_summary_has_the_impact_and_kpi_columns(agent_ns):
    create = agent_ns["inspire_ai_summary_create_sql"](TABLE)
    assert "impact_kind STRING, impact_unit STRING, kpi_name STRING, kpi_source STRING" in create
    assert ("kpi_latest DOUBLE, kpi_target DOUBLE, kpi_target_text STRING, kpi_status STRING, kpi_reason STRING, kpi_measured_at TIMESTAMP, "
            "kpi_query STRING") in create
    carried = agent_ns["INSPIRE_STOP_CARRIED"]
    assert {"impact_kind", "impact_unit", "kpi_latest", "kpi_baseline"} <= set(carried) and "kpi_measured_at" not in carried


def test_the_outcome_records_the_impact_unit(fresh_ns):
    fresh_ns["INSPIRE_RUN"] = {"impact": {"kind": "hours", "unit": "hours", "kpi": "Analyst hours"}}
    spark = FakeSpark(responder=lambda s: [{"act_now_records": 1, "review_records": 0, "records": 3}] if s.startswith("SELECT COUNT_IF") else
                      _describe(SUMMARY) if s.startswith("DESCRIBE") else [])
    hours = {"basis": "measured", "currency": "", "kind": "hours", "unit": "hours", "amounts": {"act_now_amount": "40", "review_amount": "8"},
             "accepted": None}
    fresh_ns["inspire_save_outcome"](spark, TABLE, "N01-U01", "r-1", ["priority_tier", "value_at_stake"], hours, "", lambda *_a: None)
    written = _merge_values([s for s in spark.statements if s.startswith("MERGE INTO")][-1])
    assert (written["impact_kind"], written["impact_unit"], written["currency"]) == ("'hours'", "'hours'", "''")
    plain = FakeSpark(responder=spark.responder)
    fresh_ns["inspire_save_outcome"](plain, TABLE, "N01-U01", "r-2", ["priority_tier"], None, "", lambda *_a: None)
    assert "impact_kind" not in _merge_values([s for s in plain.statements if s.startswith("MERGE INTO")][-1]), \
        "a notebook from before value_at_stake records no impact, as it records no money"


def _kpi(**changes):
    return dict({"name": "Analyst hours", "source": "evaluated", "direction": "decrease", "unit": "hours", "computable": True,
                 "query": "SELECT CAST(SUM(`amount`) AS DOUBLE) AS v FROM `main`.`sales`.`orders`", "reason": "",
                 "baseline": 1200.0, "baseline_on": "2026-10-01", "target": 900.0, "target_text": "Cut analyst hours to 900"}, **changes)


def test_the_kpi_step_writes_the_latest_value_next_to_the_baseline_and_target(agent_ns):
    query = _kpi()["query"]
    spark = FakeSpark(responder=lambda s: [{"v": 1100}] if s == query else _describe(SUMMARY) if s.startswith("DESCRIBE") else [])
    printed = []
    values = agent_ns["inspire_save_kpi"](spark, TABLE, "N01-U01", "r-7", run={"target_kpi": _kpi()}, out=printed.append)
    assert query in spark.statements
    written = _merge_values([s for s in spark.statements if s.startswith("MERGE INTO")][-1])
    assert written["kpi_latest"] == "1100.0" and written["kpi_baseline"] == "1200.0" and written["kpi_target"] == "900.0"
    assert (written["kpi_status"], written["kpi_name"], written["kpi_source"], written["kpi_direction"]) == (
        "'measured'", "'Analyst hours'", "'evaluated'", "'decrease'")
    assert written["kpi_reason"] == "NULL" and written["kpi_measured_at"].startswith("timestamp_micros(")
    assert values["kpi_latest"] == "1100.0" and printed == ["Target KPI: Analyst hours is 1100 hours this run"]


def test_a_kpi_that_is_not_computable_never_runs_sql(agent_ns):
    spark = FakeSpark(responder=lambda s: _describe(SUMMARY) if s.startswith("DESCRIBE") else [])
    printed = []
    agent_ns["inspire_save_kpi"](spark, TABLE, "N01-U01", "r-7", out=printed.append,
                                 run={"target_kpi": _kpi(computable=False, query="SELECT 1 AS v", reason="it names no column")})
    assert "SELECT 1 AS v" not in spark.statements and not any(s.startswith("SELECT") for s in spark.statements)
    written = _merge_values([s for s in spark.statements if s.startswith("MERGE INTO")][-1])
    assert (written["kpi_status"], written["kpi_latest"], written["kpi_reason"]) == ("'not_measured'", "NULL", "'it names no column'")
    assert printed == ["Target KPI: Analyst hours is not measured this run, because it names no column"]
    for query in ("DELETE FROM `main`.`sales`.`orders`", "SELECT 1 AS v; DROP TABLE x"):
        guarded = FakeSpark(responder=lambda s: _describe(SUMMARY) if s.startswith("DESCRIBE") else [])
        agent_ns["inspire_save_kpi"](guarded, TABLE, "N01-U01", "r-8", run={"target_kpi": _kpi(query=query)}, out=lambda *_a: None)
        assert query not in guarded.statements, "only one read-only SELECT ever runs"
    assert agent_ns["inspire_save_kpi"](FakeSpark(), TABLE, "N01-U01", "r-9", run={}) is None, "a run with no target KPI records none"


def test_a_failed_kpi_query_is_recorded_and_never_stops_the_run(agent_ns):
    query = _kpi()["query"]

    def respond(statement):
        if statement == query:
            raise RuntimeError("PERMISSION_DENIED: no SELECT on orders")
        return _describe(SUMMARY) if statement.startswith("DESCRIBE") else []

    spark = FakeSpark(responder=respond)
    agent_ns["inspire_save_kpi"](spark, TABLE, "N01-U01", "r-7", run={"target_kpi": _kpi()}, out=lambda *_a: None)
    written = _merge_values([s for s in spark.statements if s.startswith("MERGE INTO")][-1])
    assert written["kpi_status"] == "'failed'" and "PERMISSION_DENIED" in written["kpi_reason"]


def test_the_write_measures_the_kpi_after_the_rows_on_the_first_write_and_every_merge(fresh_ns):
    from v142_scd_test import CORE, HISTORY, STAGE, _Tables
    order = []
    fresh_ns["inspire_save_kpi"] = lambda spark, table, uc, run_id, run=None, out=print: order.append(("kpi", uc, run_id))
    fresh_ns["inspire_save_run_log"] = lambda spark, table, uc, run_id, out=print: order.append(("log", uc, run_id))
    for target in (None, CORE + HISTORY):
        order.clear()
        tables = _Tables(fresh_ns, target=target)
        fresh_ns["inspire_merge_run"](tables.spark, TABLE, STAGE, out=lambda *_a: None)
        assert order == [("log", "N01-U01", "r-2"), ("kpi", "N01-U01", "r-2")], target


def test_the_target_is_a_plain_number_or_a_percent_change_and_otherwise_text(agent_ns):
    target = agent_ns["implement_kpi_target"]
    kpi = {"name": "Churn rate", "kpi_id": "K2", "direction": "decrease"}
    assert target(kpi, [{"statement": "Reduce churn rate from 12% to 9% within 6 months", "kpi_id": "K2"}]) == (
        9.0, "Reduce churn rate from 12% to 9% within 6 months")
    assert target(kpi, [{"statement": "Cut churn rate by 10% this year", "kpi_id": None}], 12.0) == (10.8, "Cut churn rate by 10% this year")
    assert target(kpi, [{"statement": "Cut churn rate by 10% this year"}]) == (None, "Cut churn rate by 10% this year"), \
        "a percent change needs a baseline"
    assert target(kpi, [{"statement": "Reduce churn rate from [BASELINE] to [TARGET] within [WINDOW]", "kpi_id": None}]) == (
        None, "Reduce churn rate from [BASELINE] to [TARGET] within [WINDOW]")
    assert target(dict(kpi, direction="increase", name="Repeat rate", kpi_id=None),
                  [{"statement": "Raise repeat rate by 5% by Q4"}], 20.0) == (21.0, "Raise repeat rate by 5% by Q4")
    assert target(kpi, [{"statement": "Grow revenue to 2,000,000"}]) == (None, ""), "a key result about another KPI is not its target"


def test_a_tracked_kpi_follows_the_user_s_table_swap_and_removal(agent_ns):
    tracked = agent_ns["implement_tracked_kpi"]
    swapped = tracked(HOURS, "inspire", "inspire", [], {"tables": {ORDERS: "main.sales.orders_v2"}})
    assert swapped["computable"] and "`main`.`sales`.`orders_v2`" in swapped["query"] and swapped["baseline"] == 1200.0
    removed = tracked(HOURS, "inspire", "inspire", [], {"removed_tables": [ORDERS]})
    assert not removed["computable"] and removed["query"] is None
    assert removed["reason"] == f"it reads {ORDERS}, which you removed from this use case"
    text = tracked(TEXT_ONLY, "inspire", "inspire")
    assert (text["computable"], text["query"], text["impact_kind"]) == (False, None, "number")
    assert text["reason"] == agent_ns["IMPLEMENT_KPI_NOT_COMPUTABLE"]


def _evaluating(ns, reply):
    inst = build_inspire(ns, loader=FakeLoader())
    inst._genie_metadata_loader = lambda: inst.data_loader
    asked = []
    inst._implement_llm_object = lambda name, display, prompt, schema: asked.append((name, prompt)) or reply
    return inst, asked


def test_an_evaluated_kpi_that_fails_validation_is_refused_and_a_valid_one_is_tracked(agent_ns):
    reply = {"kpis": [{"name": "Review hours", "direction": "decrease", "unit": "hours", "aggregation": "SUM",
                       "table": "main.sales.timesheets", "column": "hours"},
                      {"name": "Orders reviewed", "direction": "decrease", "unit": "orders", "aggregation": "COUNT",
                       "table": ORDERS, "column": "order_id", "kpi_id": "K9"}]}
    inst, asked = _evaluating(agent_ns, reply)
    uc = make_uc(KPIs=[])
    spec = agent_ns["validate_implement_spec"](VALID)[0]
    record, warnings = inst._implement_target_kpi(uc, spec, {})
    refused, kept = record["evaluated"]
    assert not refused["computable"] and refused["query"] is None and "is not one of the use case's tables" in refused["reason"]
    assert kept["computable"] and kept["query"] == "SELECT COUNT(`order_id`) AS v FROM `main`.`sales`.`orders`" and kept["kpi_id"] is None
    assert (record["name"], record["source"], record["picked_by"], record["impact_kind"]) == ("Orders reviewed", "evaluated", "inspire", "count")
    assert record["options"] == ["Review hours", "Orders reviewed"] and warnings == []
    assert asked[0][0] == "implement_target_kpi" and asked[0][1].startswith(agent_ns["USER_DIRECTIVE_SUPREMACY_PREAMBLE"])
    again, _ = inst._implement_target_kpi(uc, spec, {"target_kpi": record})
    assert len(asked) == 1 and again["name"] == "Orders reviewed", "a later version reuses the evaluated KPIs"


def test_inspire_s_own_kpi_is_used_without_asking_and_a_failed_evaluation_keeps_the_assessed_kpi_as_text(agent_ns):
    inst, asked = _evaluating(agent_ns, {"kpis": []})
    spec = agent_ns["validate_implement_spec"](dict(VALID, kpi={"target": "Analyst hours spent on manual review"}))[0]
    record, warnings = inst._implement_target_kpi(make_uc(KPIs=[REVENUE, HOURS]), spec, {})
    assert asked == [] and (record["name"], record["source"], record["picked_by"]) == (HOURS["name"], "inspire", "user")
    missing, warned = inst._implement_target_kpi(make_uc(KPIs=[REVENUE]), dict(spec, kpi={"target": "Gone KPI"}), {})
    assert missing["name"] == "Retained revenue" and warned == [
        "Target KPI: 'Gone KPI' is not one of this use case's KPIs (Retained revenue), so Inspire tracks 'Retained revenue'"]

    def broken(*_a):
        raise RuntimeError("endpoint unavailable")

    inst._implement_llm_object = broken
    text, failed = inst._implement_target_kpi(make_uc(KPIs=[], elite_assessment={"kpi": "Late shipments", "kpi_direction": "decrease"}),
                                              agent_ns["validate_implement_spec"](VALID)[0], {})
    assert (text["name"], text["computable"], text["query"]) == ("Late shipments", False, None)
    assert failed == [] and text["reason"] == ("Inspire could not evaluate a KPI for this use case (endpoint unavailable), so it tracks "
                                               "the KPI the assessment names as text"), "the App shows why the KPI is not measured"
    inst.data_loader = None
    inst._implement_llm_object = lambda *_a: pytest.fail("no table columns, so no KPI to ask the model for")
    blind, _w = inst._implement_target_kpi(make_uc(KPIs=[]), agent_ns["validate_implement_spec"](VALID)[0], {})
    assert "could not read the columns of this use case's tables" in blind["reason"]


def test_the_spec_keeps_the_person_s_kpi_and_a_new_pick_rebuilds_the_notebook(agent_ns):
    validate = agent_ns["validate_implement_spec"]
    spec, errors = validate(dict(VALID, kpi={"target": "  Retained revenue ", "tracked": "x", "source": "inspire"}))
    assert errors == [] and spec["kpi"] == {"target": "Retained revenue"}
    assert "kpi" not in validate(VALID)[0]
    assert validate(dict(VALID, kpi={"target": 3}))[1] == ["kpi.target must be text, not 3"]
    before, after = validate(dict(VALID, kpi={"target": "Retained revenue"}))[0], validate(dict(VALID, kpi={"target": "Analyst hours"}))[0]
    assert "config" in agent_ns["classify_implement_change"](before, after)
    assert agent_ns["classify_implement_change"](before, validate(dict(VALID, kpi={"target": "retained REVENUE"}))[0]) == []


def test_the_run_controls_carry_the_impact_and_the_tracked_kpi(agent_ns):
    import ast
    inst = build_inspire(agent_ns)
    uc = make_uc(**{"Analytics Technique": MEASURED_TECHNIQUE, "KPIs": [HOURS],
                    "Expected Key Results": [{"statement": "Cut analyst hours spent on manual review to 900", "kpi_id": None}]})
    spec = inst._genie_notebook_spec(uc)
    source = inst._genie_run_controls_source(uc, spec, "")
    run = ast.literal_eval(source.split("INSPIRE_RUN = ", 1)[1].split("\n\n\n", 1)[0])
    assert run["impact"] == {"kind": "hours", "unit": "hours", "kpi": HOURS["name"]}
    assert run["target_kpi"] == {"name": HOURS["name"], "source": "inspire", "direction": "decrease", "unit": "hours", "computable": True,
                                 "query": "SELECT CAST(SUM(`amount`) AS DOUBLE) AS v FROM `main`.`sales`.`orders`", "reason": "",
                                 "baseline": 1200.0, "baseline_on": "2026-10-01", "baseline_reason": "", "prior_rows": False,
                                 "target": 900.0, "target_text": "Cut analyst hours spent on manual review to 900"}
    plain = ast.literal_eval(inst._genie_run_controls_source(make_uc(), inst._genie_notebook_spec(make_uc()), "")
                             .split("INSPIRE_RUN = ", 1)[1].split("\n\n\n", 1)[0])
    assert plain["impact"]["kind"] == "money" and "target_kpi" not in plain


def _built(ns, kpis, carried_status=None, refill=True):
    inst = _probe_inspire(ns, lambda s: None, carried_status or {"dashboard": {"state": "ready", "spec_version": 2}})
    inst._genie_notebook_spec = type(inst)._genie_notebook_spec.__get__(inst)
    inst._implement_runner = lambda uc: "runner"
    inst._implement_use_case_row = lambda sid, uc: {"No": "N01-U01", "Name": "Predict churn", "genie_instruction": "Build",
                                                    "Analytics Technique": MEASURED_TECHNIQUE, "KPIs": kpis}
    seen = []

    def fill(uc_id, key, use_case, *rest):
        seen.append(inst._genie_notebook_spec(use_case))
        return {"status": "written", "rows_written": 12, "run_id": "r-9"}, 77, {}

    inst._implement_fill_and_preview = fill
    inst._implement_dashboard = lambda c, r: {"dashboard_id": "d1", "dashboard_url": "https://h/d1"}
    inst._implement_genie_space = lambda c, r: {"genie_space_id": "g1", "genie_space_url": "https://h/genie/rooms/g1"}
    inst._implement_app = lambda c, r: {"app_name": "churn-desk", "app_url": "https://churn-desk.example", "app_health": "running"}
    inst._implement_write_notebook = lambda *a, **k: "/W/nb"
    inst._implement_claim_notebook = lambda *a, **k: "/W/nb"
    inst._implement_notebook_before = lambda path: None
    inst._implement_notebook_modified_at = lambda path: 5
    inst._implement_refresh_run_controls = lambda uc_id, key, use_case, spec_nb, *rest: seen.append(spec_nb)
    spec = json.loads(json.dumps(VALID))
    if refill:
        spec["data"] = dict(spec["data"], window={"start": "2024-01-01", "end": ""})
    status = inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": spec},
                                        (5150, "N01-U01", 3))
    return inst, status, seen


def test_the_build_records_the_target_kpi_on_the_version_and_in_the_spec(agent_ns):
    inst, status, seen = _built(agent_ns, [HOURS])
    assert status == "ready", inst.updates[-1]
    last = inst.updates[-1]
    assert last["asset_status"]["target_kpi"]["name"] == HOURS["name"] and last["asset_status"]["target_kpi"]["source"] == "inspire"
    assert last["asset_status"]["notebook"]["impact"] == {"kind": "hours", "unit": "hours", "kpi": HOURS["name"]}
    assert last["spec_json"]["kpi"] == {"target": "", "tracked": HOURS["name"], "source": "inspire", "picked_by": "inspire",
                                        "computable": True, "impact_kind": "hours", "impact_unit": "hours"}
    assert seen[0]["impact"]["kind"] == "hours", "the rebuilt notebook is told to count hours"


def test_a_notebook_built_before_the_impact_unit_stays_money_until_it_is_rebuilt(agent_ns):
    inst, status, seen = _built(agent_ns, [HOURS], refill=False)
    assert status == "ready", inst.updates[-1]
    assert len(seen) == 2 and all(s["impact"] == {"kind": "money", "unit": "", "kpi": ""} for s in seen), \
        "a notebook whose cells price money keeps money, in its Run controls too, until a rebuild teaches it the KPI's unit"
    assert inst.updates[-1]["asset_status"]["target_kpi"]["name"] == HOURS["name"], "its KPI is still tracked"
    kept = {"dashboard": {"state": "ready", "spec_version": 2},
            "notebook": {"modified_at": 1700000000000, "spec_version": 2, "result_history": 1,
                         "impact": {"kind": "hours", "unit": "hours", "kpi": HOURS["name"]}}}
    inst, _status, seen = _built(agent_ns, [HOURS], carried_status=kept, refill=False)
    assert seen[0]["impact"]["kind"] == "hours", "a notebook rebuilt for hours keeps counting hours"


def test_the_shell_reads_the_unit_from_the_summary_and_an_old_summary_is_money_only_with_an_iso_code():
    from v149_impact_test import shell_sql
    unit, label, of = shell_sql.impact_unit, shell_sql.stake_label, shell_sql.impact_of
    assert unit({"impact_kind": "hours", "impact_unit": " hours ", "currency": ""}) == "hours"
    assert unit({"impact_kind": "money", "impact_unit": "", "currency": "EUR"}) == "EUR"
    assert unit({"currency": "USD"}) == "USD" and of({"currency": "USD"})["kind"] == "money", "a summary from before the impact unit is money"
    assert of({"currency": "dollars"}) == {"kind": "number", "unit": "dollars"}, "a unit that is no ISO 4217 code is not money"
    assert unit({"impact_kind": "shares", "impact_unit": "x", "currency": "AED"}) == "AED"
    assert [label(of({"impact_kind": "hours", "impact_unit": "hours"})), label(of({"currency": "USD"})), label(of({})),
            label(of({"impact_kind": "count", "impact_unit": "late shipments"}))] == [
        "Hours at stake", "Money at stake", "Money at stake", "Late shipments at stake"]


def test_the_weekly_digest_counts_a_productivity_use_case_in_hours():
    from v149_impact_test import COLUMNS, TABLE as DESK, TYPES, Workspace, shell_sql
    fields = shell_sql.change_fields([{"name": c, "type": TYPES.get(c, "STRING")} for c in COLUMNS])
    week = shell_sql.digest_query(DESK, fields, label="entity_label", use_case="N01-U05", impact={"kind": "hours", "unit": "hours"}, since="CAST('2026-10-06' AS DATE)")
    rows = Workspace().run_sql("wh1", week, [])["rows"]
    assert [(r["figure"], r["amount"]) for r in rows][:4] == [
        ("Hours at stake now (estimated)", "1,550 hours"), ("Acted on this week", "1,250 hours"), ("Reported by people this week", "0 hours"),
        ("Measured by later runs this week", "1,800 hours")]
    assert rows[0]["how"].startswith("Hours at stake on the ") and rows[3]["how"].startswith("Hours at stake when fixed")
    assert not any("Money" in str(r["how"]) or "USD" in str(r["amount"]) for r in rows), "a productivity use case is never priced in money"


def test_the_weekly_email_text_names_the_unit(agent_ns, tmp_path):
    from v140_implement_test import ALERT, _output_context
    from v149_impact_test import _digest_inspire
    inst, calls, _queries = _digest_inspire(agent_ns, tmp_path, {("POST", "/api/2.0/alerts"): {"id": "al-1"}},
                                            summary={"impact_kind": "hours", "impact_unit": "hours", "currency": ""})
    context = _output_context(agent_ns, **ALERT, alert_destinations=[{"id": "dest-0001", "name": "Slack"}])
    inst._implement_alert(context, None)
    digest = [b for m, p, b, _q in calls if (m, p) == ("POST", "/api/2.0/alerts")][-1]
    assert "Estimated: the hours at stake on the records still open" in digest["custom_description"]
    assert "Reported: the hours people entered when they marked a record fixed." in digest["custom_description"]
    assert "'Hours at stake now (estimated)'" in digest["query_text"] and "money at stake" not in digest["custom_description"]
    inst, calls, _queries = _digest_inspire(agent_ns, tmp_path, {("POST", "/api/2.0/alerts"): {"id": "al-1"}})
    inst._implement_alert(_output_context(agent_ns, **ALERT, alert_destinations=[{"id": "dest-0001", "name": "Slack"}]), None)
    money = [b for m, p, b, _q in calls if (m, p) == ("POST", "/api/2.0/alerts")][-1]
    assert "Estimated: the money at stake on the records still open" in money["custom_description"]
    assert "Reported: the money people entered when they marked a record fixed." in money["custom_description"]


def test_the_shell_hands_the_unit_and_the_kpi_to_the_app():
    from v149_impact_test import shell_core, shell_sql
    for name in ("impact_kind", "impact_unit", "kpi_name", "kpi_baseline", "kpi_latest", "kpi_target", "kpi_target_text", "kpi_status",
                 "kpi_reason"):
        assert name in shell_core.RUN_SUMMARY_FIELDS, name
    view = shell_core.run_view(shell_core.blank_run("u1"), {"value_at_stake": 40.0, "impact_kind": "hours", "impact_unit": "hours",
                                                             "currency": ""}, {})
    assert (view["could_save"], view["currency"], view["unit"]) == (40.0, "", "hours")
    assert shell_sql.money_model({"impact_kind": "hours", "impact_unit": "hours", "currency": ""}, [])["unit"] == "hours"
    assert shell_sql.money_model({"currency": "USD"}, [])["unit"] == "USD"


@pytest.mark.parametrize("kpi,kind,unit,source", [
    ({"name": "Handling time", "unit": "hrs", "impact_kind": "money"}, "money", "", "definition"),
    ({"name": "Handling time", "unit": "USD", "impact_kind": " Money "}, "money", "USD", "definition"),
    ({"name": "Review backlog", "unit": "count"}, "count", "review backlog", "definition"),
    ({"name": "Analyst hours", "unit": "hours"}, "hours", "hours", "definition"),
    ({"name": "Churn rate", "unit": "percent"}, "percent", "points of churn rate", "definition"),
    ({"name": "Open incidents", "unit": "incidents", "impact_kind": "count"}, "count", "incidents", "definition"),
    ({"name": "Energy use", "unit": "kWh", "impact_kind": "number"}, "number", "kWh", "definition"),
    ({"name": "Handling time", "unit": "hrs"}, "hours", "hours", "classifier"),
    ({"name": "Handling time", "unit": "hrs", "impact_kind": "shares"}, "hours", "hours", "classifier"),
], ids=["own_field_wins_over_the_unit", "own_field_any_case", "unit_count", "unit_hours", "unit_percent", "own_count", "own_number",
        "no_kind_falls_back", "invalid_kind_falls_back"])
def test_the_impact_kind_comes_from_the_kpi_s_definition_and_the_classifier_only_when_it_gives_none(agent_ns, kpi, kind, unit, source):
    impact = agent_ns["kpi_impact"](kpi)
    assert (impact["kind"], impact["unit"], impact["from"], impact["kpi"]) == (kind, unit, source, kpi["name"])


def test_the_impact_reason_says_where_the_kind_came_from(agent_ns):
    impact = agent_ns["kpi_impact"]
    assert impact({"name": "Handling time", "unit": "hrs", "impact_kind": "money"})["reason"] == "its definition gives its impact kind, money"
    assert impact({"name": "Analyst hours", "unit": "hours"})["reason"] == "its definition gives its impact kind, hours, as its unit"
    fallback = "its definition gives no impact kind, so Inspire read hours from its unit hrs and its name"
    assert impact({"name": "Handling time", "unit": "hrs"})["reason"] == fallback
    assert impact({"name": "Handling time", "unit": "hrs", "impact_kind": "shares"})["reason"] == (
        "its definition gives no impact kind Inspire can use (shares is not money, count, hours, percent or number), so Inspire read "
        "hours from its unit hrs and its name")
    assert impact({"name": "Monthly revenue"})["reason"] == "its definition gives no impact kind, so Inspire read money from its name"
    record = agent_ns["implement_tracked_kpi"](dict(HOURS, unit="hrs"), "inspire", "inspire")
    assert (record["impact_kind"], record["impact_from"], record["impact_reason"]) == ("hours", "classifier", fallback)


def test_the_evaluated_kpi_names_its_impact_kind_and_its_definition_wins_over_the_classifier(agent_ns):
    items = agent_ns["IMPLEMENT_KPI_SCHEMA"]["properties"]["kpis"]["items"]
    assert items["properties"]["impact_kind"] == {"type": "string", "enum": list(agent_ns["INSPIRE_IMPACT_KINDS"])}
    assert "impact_kind" in items["required"]
    spec = agent_ns["validate_implement_spec"](VALID)[0]
    prompt = agent_ns["implement_kpi_prompt"](make_uc(), {ORDERS: {"order_id": "BIGINT"}}, spec)
    assert '"impact_kind": "hours"' in prompt and "`impact_kind`: money, count, hours, percent or number" in prompt
    effort = {"name": "Manual review effort", "direction": "decrease", "unit": "orders", "impact_kind": "hours", "aggregation": "COUNT",
              "table": ORDERS, "column": "order_id"}
    assert agent_ns["kpi_impact"]({k: v for k, v in effort.items() if k != "impact_kind"})["kind"] == "count", \
        "the classifier alone reads a count from its plural unit"
    inst, _asked = _evaluating(agent_ns, {"kpis": [effort]})
    record, _warnings = inst._implement_target_kpi(make_uc(KPIs=[]), spec, {})
    assert (record["impact_kind"], record["impact_unit"], record["impact_from"]) == ("hours", "hours", "definition")
    assert record["evaluated"][0]["impact_kind"] == "hours"
    nb = inst._genie_notebook_spec(dict(make_uc(**{"Analytics Technique": MEASURED_TECHNIQUE, "KPIs": []}), _implement_target_kpi=record))
    assert nb["impact"] == {"kind": "hours", "unit": "hours", "kpi": "Manual review effort"}, "the notebook counts what the record says"
    inst, _asked = _evaluating(agent_ns, {"kpis": [dict(effort, impact_kind="shares")]})
    refused, _warnings = inst._implement_target_kpi(make_uc(KPIs=[]), spec, {})
    assert (refused["impact_kind"], refused["impact_from"]) == ("count", "classifier") and "shares is not money" in refused["impact_reason"]


SWAP_REASON = (f"its baseline was measured on {ORDERS}, but it is measured now on main.sales.orders_v2, which you chose in its place, "
               "so the baseline and the latest value come from different tables")


def test_a_baseline_taken_on_a_table_the_person_swapped_is_flagged_and_the_kpi_step_says_why(agent_ns):
    tracked = agent_ns["implement_tracked_kpi"]
    swapped = tracked(HOURS, "inspire", "inspire", [], {"tables": {ORDERS: "main.sales.orders_v2"}})
    assert swapped["computable"] and swapped["baseline"] == 1200.0 and swapped["baseline_reason"] == SWAP_REASON
    assert tracked(HOURS, "inspire", "inspire", [], {"tables": {ORDERS.upper(): ORDERS}})["baseline_reason"] == "", "a swap to itself is none"
    assert tracked(HOURS, "inspire", "inspire")["baseline_reason"] == ""
    assert tracked(dict(HOURS, baseline=None), "inspire", "inspire", [], {"tables": {ORDERS: "main.sales.orders_v2"}})[
        "baseline_reason"] == "", "with no baseline there is nothing to flag"
    assert agent_ns["implement_run_kpi"](swapped)["baseline_reason"] == SWAP_REASON
    query = _kpi()["query"]
    spark = FakeSpark(responder=lambda s: [{"v": 1100}] if s == query else _describe(SUMMARY) if s.startswith("DESCRIBE") else [])
    printed = []
    agent_ns["inspire_save_kpi"](spark, TABLE, "N01-U01", "r-7", run={"target_kpi": _kpi(baseline_reason=SWAP_REASON)}, out=printed.append)
    written = _merge_values([s for s in spark.statements if s.startswith("MERGE INTO")][-1])
    assert written["kpi_status"] == "'measured'" and written["kpi_reason"] == agent_ns["inspire_sql_literal"](SWAP_REASON)
    assert printed == [f"Target KPI: Analyst hours is 1100 hours this run; {SWAP_REASON}"]
    text = FakeSpark(responder=lambda s: _describe(SUMMARY) if s.startswith("DESCRIBE") else [])
    agent_ns["inspire_save_kpi"](text, TABLE, "N01-U01", "r-8", out=lambda *_a: None,
                                 run={"target_kpi": _kpi(computable=False, reason="it names no column", baseline_reason=SWAP_REASON)})
    written = _merge_values([s for s in text.statements if s.startswith("MERGE INTO")][-1])
    assert written["kpi_reason"] == agent_ns["inspire_sql_literal"](f"it names no column; {SWAP_REASON}")


def test_a_kpi_with_no_baseline_takes_its_first_measured_value_on_the_same_query(agent_ns):
    import datetime
    query, firsts = _kpi()["query"], []

    def spark_with(rows):
        def respond(statement):
            if statement == query:
                return [{"v": 1100}]
            if statement.startswith("DESCRIBE"):
                return _describe(SUMMARY)
            if "kpi_status = 'measured'" in statement:
                firsts.append(statement)
                return rows
            return []
        return FakeSpark(responder=respond)

    def written(spark, **changes):
        agent_ns["inspire_save_kpi"](spark, TABLE, "N01-U01", "r-7", run={"target_kpi": _kpi(**changes)}, out=lambda *_a: None)
        return _merge_values([s for s in spark.statements if s.startswith("MERGE INTO")][-1])

    today = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    first = written(spark_with([]), baseline=None, baseline_on=None)
    assert (first["kpi_baseline"], first["kpi_baseline_on"], first["kpi_latest"]) == ("1100.0", f"'{today}'", "1100.0")
    assert first["kpi_query"] == agent_ns["inspire_sql_literal"](query)
    lookup = firsts[0]
    assert "use_case_id = 'N01-U01'" in lookup and "kpi_name = 'Analyst hours'" in lookup
    assert f"kpi_query = {agent_ns['inspire_sql_literal'](query)}" in lookup and "ORDER BY kpi_measured_at ASC" in lookup
    later = written(spark_with([{"v": 1300.0, "d": datetime.date(2026, 10, 2)}]), baseline=None, baseline_on=None)
    assert (later["kpi_baseline"], later["kpi_baseline_on"]) == ("1300.0", "'2026-10-02'"), "the first value on this query stays the baseline"
    looked = len(firsts)
    kept = written(spark_with([{"v": 1300.0, "d": "2026-10-02"}]))
    assert (kept["kpi_baseline"], kept["kpi_baseline_on"]) == ("1200.0", "'2026-10-01'") and len(firsts) == looked, \
        "a KPI with its own baseline never looks one up"
    unmeasured = written(spark_with([{"v": 1300.0, "d": "2026-10-02"}]), baseline=None, baseline_on=None, computable=False, reason="no column")
    assert unmeasured["kpi_baseline"] == "NULL" and len(firsts) == looked, "a KPI not measured this run takes no baseline"


def test_the_kpi_line_shows_its_number_without_float_noise_and_a_percent_with_no_space(agent_ns):
    shown = agent_ns["inspire_number_text"]
    assert [shown(v) for v in (-183138709.47, 0.02851455842076639, 1e-7, 1e16, 155.0, -0.0, 2.5, 1100)] == [
        "-183138709.47", "0.0285145584", "0.0000001", "10000000000000000", "155", "0", "2.5", "1100"]
    query = _kpi()["query"]

    def line(value, unit):
        spark = FakeSpark(responder=lambda s: [{"v": value}] if s == query else _describe(SUMMARY) if s.startswith("DESCRIBE") else [])
        printed = []
        agent_ns["inspire_save_kpi"](spark, TABLE, "N01-U01", "r-7", run={"target_kpi": _kpi(unit=unit)}, out=printed.append)
        return printed

    assert line(-183138709.47, "USD") == ["Target KPI: Analyst hours is -183138709.47 USD this run"]
    assert line(12.5, "%") == ["Target KPI: Analyst hours is 12.5% this run"]
