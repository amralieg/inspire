"""A KPI filter compares with =, !=, <, <=, > or >=, its literal is typed to its column, one builder turns every filter into SQL
or text, a KPI whose name compares (negative, late, over, at least, ...) must filter with a matching comparison, a stored KPI
whose filter does not match its name is never measured as if it were right, the first measured value stays the baseline across
the upgrade only for the same KPI, and the value at stake part is named in the KPI's own unit, offline."""
import ast
import json
import os
import re

import pytest

from v120_artifacts_support import FakeSpark, make_inspire
from v130_evidence_test import Row
from v130_feedback_test import fb, obj_with
from v130_outputs_test import STALE_NOTE, STALE_ZERO, value_uc
from v130_strategy_alignment_test import context, harness
from v140_implement_test import VALID, _spec
from v142_scd_test import SUMMARY, TABLE, _describe
from v162_target_kpi_test import HOURS, _kpi, _merge_values

WEB = "main.sales.web_sales"
WEB_COLUMNS = {"ws_net_profit": "DECIMAL(7,2)", "ws_quantity": "INT", "ws_promo": "INT", "late_flag": "INT", "days_late": "INT",
               "late_fee": "DECIMAL(9,2)", "status": "STRING", "sold_on": "DATE", "paid_at": "TIMESTAMP", "is_late": "BOOLEAN",
               "tags": "ARRAY<STRING>"}
MISMATCH = "its filter does not match its name: "
STORED = {"name": "Share of negative-profit web orders", "kpi_id": None, "direction": "decrease", "unit": "%", "metric_view": None,
          "measure": None, "aggregation": "COUNT", "table": WEB, "column": None, "filter_column": "ws_net_profit", "filter_value": "0",
          "time_column": None, "window_days": None,
          "denominator": {"aggregation": "COUNT", "column": None, "filter_column": None, "filter_value": None},
          "computable": True, "query": ("SELECT CAST(COUNT(*) FILTER (WHERE `ws_net_profit` = '0') AS DOUBLE) / NULLIF(CAST(COUNT(*) AS "
                                        "DOUBLE), 0) * 100 AS v FROM `main`.`sales`.`web_sales`"),
          "baseline": {"value": 0.0285, "window_days": None, "measured_on": "2026-10-24"}}
RIGHT = dict(STORED, name="Share of web orders with negative profit", filter_op="<", filter_value=0, filter_type="decimal",
             query=None, baseline={"value": 2.98, "window_days": None, "measured_on": "2026-10-31"})
HOURS_IMPACT = {"kind": "hours", "unit": "hours", "kpi": "Analyst hours"}
MONEY_IMPACT = {"kind": "money", "unit": "USD", "kpi": "Retained revenue"}


def _resolver(ns, profiles=None, columns=None):
    obj = harness(ns)
    ctx = context(ns, obj)
    if profiles is not None:
        ctx = dict(ctx, profiles=profiles)
    tables = {"c.s.web": dict(WEB_COLUMNS, **(columns or {}))}

    def resolve(**raw):
        notes = []
        spec = obj._resolve_kpi_spec(dict({"direction": "decrease", "table": "c.s.web"}, **raw), tables, ctx, notes)
        return spec, notes
    return resolve


def test_a_kpi_filter_takes_an_operator_and_a_literal_typed_to_its_column(agent_ns):
    build, clause, text = agent_ns["DeepEvidence"].kpi_sql, agent_ns["kpi_filter_sql"], agent_ns["kpi_filter_text"]
    web = {"aggregation": "COUNT", "table": "main.s.web_sales", "column": None}
    loss = {"filter_column": "ws_net_profit", "filter_op": "<", "filter_value": 0, "filter_type": "decimal"}
    assert build(dict(web, **loss)) == "SELECT COUNT(*) AS v FROM `main`.`s`.`web_sales` WHERE `ws_net_profit` < 0"
    share = dict(web, unit="%", **loss, denominator={"aggregation": "COUNT", "column": None, "filter_column": "ws_quantity",
                                                     "filter_op": ">=", "filter_value": 1, "filter_type": "integer"})
    assert build(share) == ("SELECT CAST(COUNT(*) FILTER (WHERE `ws_net_profit` < 0) AS DOUBLE) / NULLIF(CAST(COUNT(*) FILTER "
                            "(WHERE `ws_quantity` >= 1) AS DOUBLE), 0) * 100 AS v FROM `main`.`s`.`web_sales`")
    assert text(loss) == "ws_net_profit < 0"
    assert clause({"filter_column": "amount", "filter_op": ">", "filter_value": 99.5, "filter_type": "decimal"}) == "`amount` > 99.5"
    assert clause({"filter_column": "amount", "filter_op": "<=", "filter_value": -0.25, "filter_type": "decimal"}) == "`amount` <= -0.25"
    assert clause({"filter_column": "amount", "filter_op": ">", "filter_value": 1e-7, "filter_type": "decimal"}) == "`amount` > 0.0000001"
    assert clause({"filter_column": "sold_on", "filter_op": ">=", "filter_value": "2026-01-01", "filter_type": "date"}) == \
        "`sold_on` >= DATE '2026-01-01'"
    assert clause({"filter_column": "paid_at", "filter_op": "<", "filter_value": "2026-01-01 08:30:00", "filter_type": "timestamp"}) == \
        "`paid_at` < TIMESTAMP '2026-01-01 08:30:00'"
    assert clause({"filter_column": "is_late", "filter_op": "=", "filter_value": True, "filter_type": "boolean"}) == "`is_late` = TRUE"
    assert clause({"filter_column": "status", "filter_op": "!=", "filter_value": "it's", "filter_type": "text"}) == "`status` != 'it\\'s'"
    assert clause({"filter_column": "status", "filter_value": "it's"}) == "`status` = 'it\\'s'", "a filter stored before operators reads as before"
    assert clause({"filter_column": "on_hand", "filter_value": "0"}) == "`on_hand` = '0'"
    assert clause({"filter_column": None, "filter_value": 0}) == "" and clause({"filter_column": "x", "filter_value": None}) == ""
    for bad in ({"filter_column": "status", "filter_op": "<", "filter_value": "b", "filter_type": "text"},
                {"filter_column": "is_late", "filter_op": ">", "filter_value": True, "filter_type": "boolean"},
                {"filter_column": "amount", "filter_op": "~", "filter_value": 1, "filter_type": "decimal"},
                {"filter_column": "amount", "filter_op": "<", "filter_value": "0"},
                {"filter_column": "amount", "filter_op": "<", "filter_value": "zero", "filter_type": "decimal"},
                {"filter_column": "amount", "filter_op": "<", "filter_value": True, "filter_type": "decimal"},
                {"filter_column": "amount", "filter_op": "<", "filter_value": "NaN", "filter_type": "decimal"},
                {"filter_column": "sold_on", "filter_op": ">", "filter_value": "01/02/2026", "filter_type": "date"},
                {"filter_column": "amount", "filter_op": "<", "filter_value": 0, "filter_type": "money"}):
        with pytest.raises(ValueError):
            clause(bad)
        with pytest.raises(ValueError):
            build(dict(web, **bad))


def test_the_resolver_types_each_filter_to_its_column_and_refuses_what_its_column_cannot_take(agent_ns):
    resolve = _resolver(agent_ns)
    loss, notes = resolve(name="Web orders with negative profit", aggregation="COUNT", filter_column="ws_net_profit", filter_op="<",
                          filter_value="0")
    assert loss["computable"] and not notes and loss["query"] == "SELECT COUNT(*) AS v FROM `c`.`s`.`web` WHERE `ws_net_profit` < 0"
    assert (loss["filter_op"], loss["filter_value"], loss["filter_type"]) == ("<", 0, "decimal") and type(loss["filter_value"]) is int
    single, _ = resolve(name="Single item web orders", aggregation="COUNT", filter_column="ws_quantity", filter_value="1")
    assert single["query"].endswith("WHERE `ws_quantity` = 1") and single["filter_type"] == "integer", "a number stays a number"
    since, _ = resolve(name="Web orders since the launch", aggregation="COUNT", filter_column="sold_on", filter_op=">=",
                       filter_value="2026-01-01")
    assert since["query"].endswith("WHERE `sold_on` >= DATE '2026-01-01'")
    late, notes = resolve(name="Web orders shipped late", aggregation="COUNT", filter_column="is_late", filter_value="true")
    assert late["computable"] and not notes and late["query"].endswith("WHERE `is_late` = TRUE")
    kept, _ = resolve(name="Web orders not returned", aggregation="COUNT", filter_column="status", filter_op="<>", filter_value="returned")
    assert kept["query"].endswith("WHERE `status` != 'returned'") and kept["filter_op"] == "!="
    share, notes = resolve(name="Share of negative-profit web orders", unit="%", aggregation="COUNT", filter_column="ws_net_profit",
                           filter_op="<", filter_value=0, denominator={"aggregation": "COUNT", "filter_column": "ws_quantity",
                                                                       "filter_op": ">", "filter_value": 0})
    assert share["computable"] and not notes and share["query"] == (
        "SELECT CAST(COUNT(*) FILTER (WHERE `ws_net_profit` < 0) AS DOUBLE) / NULLIF(CAST(COUNT(*) FILTER (WHERE `ws_quantity` > 0) "
        "AS DOUBLE), 0) * 100 AS v FROM `c`.`s`.`web`")
    assert share["denominator"]["filter_op"] == ">" and share["denominator"]["filter_type"] == "integer"
    for raw, said in ((dict(filter_column="status", filter_op="<", filter_value="b"), "only number and date columns take"),
                      (dict(filter_column="ws_net_profit", filter_op="~", filter_value=0), "is not one of"),
                      (dict(filter_column="ws_net_profit", filter_op="<", filter_value="zero"), "is not a number"),
                      (dict(filter_column="sold_on", filter_op=">", filter_value="last week"), "is not a date"),
                      (dict(filter_column="tags", filter_value="vip"), "cannot filter on")):
        refused, notes = resolve(name="Web orders", aggregation="COUNT", **raw)
        assert not refused["computable"] and refused["query"] is None and any(said in note for note in notes), (raw, notes)


def test_a_kpi_whose_name_compares_must_filter_with_a_matching_comparison(agent_ns):
    resolve = _resolver(agent_ns)
    ratio = dict(unit="%", aggregation="COUNT", filter_column="ws_net_profit", denominator={"aggregation": "COUNT"})
    for op in (None, "="):
        refused, notes = resolve(name="Share of negative-profit web orders", filter_value="0", filter_op=op, **ratio)
        assert not refused["computable"] and refused["query"] is None and refused["baseline"] is None, op
        note = next(n for n in notes if MISMATCH in n)
        assert "the name says negative" in note and "ws_net_profit = 0" in note and "ws_net_profit < 0" in note, note
    kept, notes = resolve(name="Share of negative-profit web orders", filter_op="<", filter_value=0, **ratio)
    assert kept["computable"] and kept["name"] == "Share of negative-profit web orders" and not notes
    for op, value in (("<", 100), (">", 0), ("<=", 0), (">=", -5)):
        refused, notes = resolve(name="Share of negative-profit web orders", filter_op=op, filter_value=value, **ratio)
        assert not refused["computable"] and any(MISMATCH in n for n in notes), (op, value, notes)
    assert resolve(name="Web orders with positive profit", aggregation="COUNT", filter_column="ws_net_profit", filter_op=">",
                   filter_value=0)[0]["computable"]
    assert not resolve(name="Web orders with positive profit", aggregation="COUNT", filter_column="ws_net_profit", filter_op=">=",
                       filter_value=0)[0]["computable"], "zero is not positive"
    over = dict(name="Web orders over 10 units", aggregation="COUNT", filter_column="ws_quantity")
    refused, notes = resolve(filter_value=10, **over)
    assert not refused["computable"] and any("ws_quantity equals one value" in n for n in notes), notes
    assert resolve(filter_op=">", filter_value=10, **over)[0]["computable"]
    refused, notes = resolve(filter_op="<", filter_value=10, **over)
    assert not refused["computable"] and any("keeps the rows below 10" in n for n in notes), notes
    refused, notes = resolve(name="Late web orders", aggregation="COUNT")
    assert not refused["computable"] and any("no filter compares a value" in n for n in notes), notes
    assert not resolve(name="Late web orders", aggregation="COUNT", filter_column="days_late", filter_value=0)[0]["computable"]
    for raw in (dict(filter_column="days_late", filter_op=">", filter_value=0), dict(filter_column="late_flag", filter_value=1),
                dict(filter_column="is_late", filter_value=True)):
        assert resolve(name="Late web orders", aggregation="COUNT", **raw)[0]["computable"], raw
    assert resolve(name="Average days late", aggregation="AVG", column="days_late")[0]["computable"], "its column is the comparison"
    assert resolve(name="Late fees below 50", aggregation="SUM", column="late_fee", filter_column="late_fee", filter_op="<",
                   filter_value=50)[0]["computable"]
    assert resolve(name="Web profit over the last 90 days", aggregation="SUM", column="ws_net_profit")[0]["computable"]
    assert resolve(name="Negative reviews", aggregation="COUNT", filter_column="status", filter_value="negative")[0]["computable"]
    plan = dict(name="Web orders above plan", aggregation="COUNT", filter_column="ws_promo", filter_value=1)
    assert not resolve(**plan)[0]["computable"]
    two = _resolver(agent_ns, profiles={"c.s.web": {"columns": {"ws_promo": {"distinct": 2}}}})
    assert two(**plan)[0]["computable"], "a column with two values is a flag, so one of them is a category"


def test_the_comparison_check_reads_the_definition_and_skips_what_it_cannot_judge(agent_ns):
    problem, honest = agent_ns["kpi_comparison_problem"], agent_ns["DatabricksInspire"]._kpi_name_is_honest
    unprofitable = {"name": "Unprofitable web orders", "aggregation": "COUNT", "column": None, "filter_column": "ws_net_profit",
                    "filter_op": "=", "filter_value": 0, "filter_type": "decimal"}
    assert problem(unprofitable) == "" and honest(unprofitable)
    assert problem(unprofitable, "Orders whose net profit is below zero").startswith(MISMATCH)
    assert problem({"name": "Negative margin", "metric_view": "c.s.mv", "measure": "margin"}) == ""
    assert problem({"name": "Over-the-counter sales", "aggregation": "SUM", "column": "amount"}) == ""
    assert problem({"name": "Revenue over time", "aggregation": "SUM", "column": "amount"}) == ""
    assert problem({"name": "Revenue per customer over 12 months", "aggregation": "SUM", "column": "amount"}) == ""
    assert problem({"name": "Tickets resolved under 2 hours", "aggregation": "COUNT", "column": None}).startswith(MISMATCH)
    assert problem({"name": "Orders past due", "aggregation": "SUM", "column": "past_due_amount"}) == ""
    assert problem(STORED).startswith(MISMATCH + "the name says negative, a comparison, but the filter ws_net_profit = '0'")
    assert not honest(STORED) and honest(RIGHT)


@pytest.mark.parametrize("name", [
    "Web orders of 3 units over 30 days", "Web orders of 3 units over 4 weeks", "Web orders of 3 units over 6 months",
    "Web orders of 3 units within 30 days", "Web orders of 3 units within 4 weeks", "Web orders of 3 units within 6 months",
    "Web orders of 3 units in the last 30 days", "Web orders of 3 units in the last 4 weeks", "Web orders of 3 units in the last 6 months",
    "Web orders of 3 units over a 30-day window", "Web orders of 3 units over the last 12 months", "Web orders of 3 units over 90 business days",
    "Late-night web orders of 3 units", "Over-the-counter web orders of 3 units", "Year-over-year web orders of 3 units",
    "Web orders of 3 units, month-over-month",
])
def test_a_time_window_or_an_idiom_compound_is_not_a_comparison(agent_ns, name):
    spec = {"name": name, "aggregation": "COUNT", "column": None, "filter_column": "ws_quantity", "filter_op": "=", "filter_value": 3,
            "filter_type": "integer"}
    assert agent_ns["kpi_comparison_problem"](spec) == ""
    assert _resolver(agent_ns)(name=name, aggregation="COUNT", filter_column="ws_quantity", filter_value=3)[0]["computable"]


@pytest.mark.parametrize("name,column,value,said", [
    ("Share of negative profit web orders", "ws_net_profit", 0, "negative"),
    ("Share of negative-profit web orders", "ws_net_profit", 0, "negative"),
    ("Web orders over 100 units", "ws_quantity", 100, "over"),
    ("Web orders over 100 units in the last 30 days", "ws_quantity", 100, "over"),
    ("Late web orders within 30 days", "days_late", 0, "late"),
    ("Late-payment web orders", "days_late", 0, "late"),
    ("Past-due web orders", "days_late", 0, "past due"),
    ("Web orders over 24 hours late", "days_late", 1, "over, late"),
])
def test_a_compared_amount_still_needs_a_comparing_filter_next_to_a_window_or_a_compound(agent_ns, name, column, value, said):
    kind = "decimal" if column == "ws_net_profit" else "integer"
    spec = {"name": name, "aggregation": "COUNT", "column": None, "filter_column": column, "filter_op": "=", "filter_value": value,
            "filter_type": kind}
    problem = agent_ns["kpi_comparison_problem"](spec)
    assert problem.startswith(f"{MISMATCH}the name says {said}, a comparison") and f"{column} equals one value" in problem, problem
    refused, notes = _resolver(agent_ns)(name=name, aggregation="COUNT", filter_column=column, filter_value=value)
    assert not refused["computable"] and refused["query"] is None and any(MISMATCH in n for n in notes), notes


AGES = {"days_unpaid": "INT", "days_in_transit": "INT", "days_inactive": "INT"}


@pytest.mark.parametrize("name,column,value", [
    ("Invoices unpaid over 30 days", "days_unpaid", 30), ("Invoices unpaid for over 30 days", "days_unpaid", 30),
    ("Shipments in transit over 3 days", "days_in_transit", 3), ("Accounts inactive over 90 days", "days_inactive", 90),
    ("Orders past-due over 10 days", "days_late", 10), ("Orders on hold over 2 weeks", "days_unpaid", 14),
])
def test_over_n_days_after_a_state_word_is_a_comparison_so_equality_is_refused_and_greater_is_kept(agent_ns, name, column, value):
    problem, honest = agent_ns["kpi_comparison_problem"], agent_ns["DatabricksInspire"]._kpi_name_is_honest
    equal = {"name": name, "aggregation": "COUNT", "column": None, "filter_column": column, "filter_op": "=", "filter_value": value,
             "filter_type": "integer"}
    assert problem(equal).startswith(MISMATCH) and f"{column} equals one value" in problem(equal) and not honest(equal), problem(equal)
    assert problem(dict(equal, filter_op=">")) == "" and honest(dict(equal, filter_op=">"))
    assert "keeps the rows below" in problem(dict(equal, filter_op="<"))
    resolve = _resolver(agent_ns, columns=AGES)
    refused, notes = resolve(name=name, aggregation="COUNT", filter_column=column, filter_value=value)
    assert not refused["computable"] and refused["query"] is None and any(MISMATCH in n for n in notes), notes
    kept, notes = resolve(name=name, aggregation="COUNT", filter_column=column, filter_op=">", filter_value=value)
    assert kept["computable"] and not notes and kept["query"].endswith(f"WHERE `{column}` > {value}"), notes


@pytest.mark.parametrize("name", [
    "Revenue over the last 30 days", "Orders over the past 3 months", "Revenue within 30 days", "Revenue in the last 4 weeks",
    "Revenue in the last 6 weeks", "Tickets open over the last 30 days", "Invoices unpaid in the last 30 days", "Revenue over 30 days",
])
def test_a_window_stays_a_window_even_next_to_a_state_word(agent_ns, name):
    spec = {"name": name, "aggregation": "COUNT", "column": None, "filter_column": "ws_quantity", "filter_op": "=", "filter_value": 3,
            "filter_type": "integer"}
    assert agent_ns["kpi_comparison_problem"](spec) == ""
    assert _resolver(agent_ns)(name=name, aggregation="COUNT", filter_column="ws_quantity", filter_value=3)[0]["computable"]


@pytest.mark.parametrize("name,column,value", [
    ("Share of negative-profit web orders", "ws_net_profit", 0), ("Share of negative profit web orders", "ws_net_profit", 0),
    ("Web orders over 10 units", "ws_quantity", 10), ("Web orders over 100 units", "ws_quantity", 100),
    ("Web orders over 100 units in the last 30 days", "ws_quantity", 100), ("Late web orders within 30 days", "days_late", 0),
    ("Late-payment web orders", "days_late", 0), ("Past-due web orders", "days_late", 0), ("Late web orders", "days_late", 0),
    ("Web orders over 24 hours late", "days_late", 1), ("Web orders above plan", "ws_promo", 1),
])
def test_the_round_three_and_four_comparisons_stay_refused_with_an_equality_filter(agent_ns, name, column, value):
    refused, notes = _resolver(agent_ns)(name=name, aggregation="COUNT", filter_column=column, filter_value=value)
    assert not refused["computable"] and any(MISMATCH in n for n in notes), (name, notes)


def test_a_stored_kpi_whose_filter_does_not_match_its_name_is_never_measured_as_if_right(agent_ns):
    shown = agent_ns["kpi_baseline_shown"]
    assert shown(STORED["baseline"], STORED) is None and shown(STORED["baseline"]) == STORED["baseline"]
    assert shown(RIGHT["baseline"], RIGHT) == RIGHT["baseline"]
    record = agent_ns["implement_tracked_kpi"](STORED, "inspire", "inspire")
    assert (record["computable"], record["query"], record["baseline"]) == (False, None, None)
    assert record["reason"] == agent_ns["kpi_comparison_problem"](STORED) and record["reason"].startswith(MISMATCH)
    right = agent_ns["implement_tracked_kpi"](RIGHT, "inspire", "inspire")
    assert right["computable"] and right["query"].endswith("FILTER (WHERE `ws_net_profit` < 0) AS DOUBLE) / NULLIF(CAST(COUNT(*) AS "
                                                           "DOUBLE), 0) * 100 AS v FROM `main`.`sales`.`web_sales`")
    assert right["baseline"] == 2.98
    spark = FakeSpark(responder=lambda s: _describe(SUMMARY) if s.startswith("DESCRIBE") else [])
    printed = []
    agent_ns["inspire_save_kpi"](spark, TABLE, "N01-U03", "r-1", run={"target_kpi": agent_ns["implement_run_kpi"](record)},
                                 out=printed.append)
    assert not any("web_sales" in s for s in spark.statements), "the mismatched query never runs"
    written = _merge_values([s for s in spark.statements if s.startswith("MERGE INTO")][-1])
    assert written["kpi_status"] == "'not_measured'" and "does not match its name" in written["kpi_reason"]
    assert printed[0].startswith(f"Target KPI: {STORED['name']} is not measured this run, because {MISMATCH}")
    obj = make_inspire(agent_ns)
    said = f"{STORED['name']} (\u2193 %): not measured, because its filter does not match its name"
    assert obj._kpi_text(STORED, None, {}, "English") == said
    assert "0.0285" not in obj._kpi_text(STORED, None, {}, "French") and obj._kpi_text(STORED, None, {}, "French") != said
    note = obj._kpi_baseline_note(STORED, STORED["baseline"])
    uc = value_uc(**{"KPIs": [STORED, RIGHT], "Financial Benefits": [f"Margin back from {note}"]})
    benefits = obj._use_case_items(uc, "Financial Benefits", "lines", {}, "English")[0]
    assert benefits == [agent_ns["inspire_placeholder_words"](f"Margin back from {agent_ns['DatabricksInspire']._BASELINE_MISMATCH}")]
    assert benefits == ["Margin back from the current value (not measured, because the KPI's filter does not match its name)"]
    source = obj._genie_kpi_source(uc)
    assert "`ws_net_profit` = '0'" not in source and "`ws_net_profit` < 0" in source and f"  - {said}\n" in source


def test_value_tracking_never_measures_a_stored_kpi_whose_filter_does_not_match_its_name(agent_ns):
    measured = FakeSpark(responder=lambda statement: [Row(v=0.03)])
    deep = agent_ns["DeepEvidence"](measured, "Deep", make_inspire(agent_ns).logger)
    stored = [dict(STORED, table="c.s.web"), dict(RIGHT, table="c.s.web")]
    obj, _spark = obj_with(agent_ns, rows=[fb("loss|c.s.web", "implemented", title="Loss")],
                           tracking_rows=[Row(use_case_key="loss|c.s.web", kpis=json.dumps(stored), session_id=1)], deep=deep)
    obj._gate_schema_index([("c", "s", "web", "ws_net_profit", "decimal(7,2)", "")])
    obj._load_feedback()
    wrong, right = obj._track_implemented_value()
    assert (wrong["status"], wrong["current"], wrong["baseline"], wrong["query"]) == ("not_measured", None, None, None)
    assert wrong["reason"].startswith(MISMATCH) and right["status"] == "measured"
    assert measured.statements == [f"SELECT ({right['query']}) AS v, (SELECT COUNT(*) AS v FROM `c`.`s`.`web`) AS n"]
    assert "`ws_net_profit` < 0" in right["query"]


def test_one_builder_turns_every_kpi_filter_into_sql_or_text(agent_ns):
    from _agentload import agent_source
    tree, owners = ast.parse(agent_source()), {}
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for inner in ast.walk(node):
                owners.setdefault(id(inner), node.name)
    built = sorted({owners.get(id(node), "<module>") for node in ast.walk(tree) if isinstance(node, ast.JoinedStr)
                    for value in node.values if isinstance(value, ast.FormattedValue)
                    and any(word in ast.unparse(value.value) for word in ("filter_value", "filter_column", "filter_op"))})
    assert built == ["_kpi_filter"], built
    source = agent_source()
    assert source.count("FILTER (WHERE {condition})") == 1 and "kpi_filter_sql(spec)" in source
    shell = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "agent", "app_shell")
    for root, _dirs, files in os.walk(shell):
        if "node_modules" in root:
            continue
        for name in files:
            if name.endswith((".py", ".js", ".jsx", ".mjs")):
                with open(os.path.join(root, name), encoding="utf-8") as handle:
                    assert not re.search(r"\bfilter_(?:value|column|op|type)\b", handle.read()), name


def test_the_kpi_grammar_offers_the_operator_to_both_prompts_and_the_evaluated_schema(agent_ns):
    rule = agent_ns["KPI_DEFINITION_RULE"]
    assert "`filter_op`" in rule and "=, !=, <, <=, > or >=" in rule and "never = on an amount" in rule
    item = agent_ns["IMPLEMENT_KPI_SCHEMA"]["properties"]["kpis"]["items"]["properties"]
    operators = ["=", "!=", "<", "<=", ">", ">=", None]
    assert item["filter_op"]["enum"] == operators
    assert item["denominator"]["properties"]["filter_op"]["enum"] == operators
    assert '"filter_op": null' in agent_ns["PROMPT_TEMPLATES"]["STRATEGY_ALIGNMENT_PROMPT"]
    from v120_genie_support import make_uc
    assert '"filter_op": null' in agent_ns["implement_kpi_prompt"](make_uc(), {WEB: dict(WEB_COLUMNS)}, {})


def test_old_summary_rows_keep_the_first_value_only_for_the_same_kpi(agent_ns):
    same = agent_ns["implement_kpi_prior_rows"]
    query = _kpi()["query"]
    now = {"name": "Analyst hours", "unit": "hours", "computable": True, "query": query, "prior_rows": False}
    old = {"name": "Analyst  hours", "unit": "hours", "computable": True, "query": query + "  "}
    assert same(old, now), "a round written before kpi_query existed measured this same KPI"
    for changed in (dict(old, query=query + " WHERE `region` = 'EU'"), dict(old, unit="USD"), dict(old, name="Analyst minutes"),
                    dict(old, computable=False), dict(old, prior_rows=False), None, {}):
        assert not same(changed, now), changed
    assert same(dict(old, prior_rows=True), now), "a newer record that kept the old rows passes them on"
    assert not same(old, dict(now, computable=False))

    def lookups(prior_rows):
        seen = []

        def respond(statement):
            if statement == query:
                return [{"v": 1100}]
            if statement.startswith("DESCRIBE"):
                return _describe(SUMMARY)
            if "kpi_status = 'measured'" in statement:
                seen.append(statement)
                return [{"v": 1500.0, "d": "2026-09-01"}] if "kpi_query IS NULL" in statement else []
            return []
        spark = FakeSpark(responder=respond)
        agent_ns["inspire_save_kpi"](spark, TABLE, "N01-U01", "r-9", out=lambda *_a: None,
                                     run={"target_kpi": _kpi(baseline=None, baseline_on=None, prior_rows=prior_rows)})
        return seen, _merge_values([s for s in spark.statements if s.startswith("MERGE INTO")][-1])
    seen, written = lookups(True)
    assert (written["kpi_baseline"], written["kpi_baseline_on"]) == ("1500.0", "'2026-09-01'")
    assert "kpi_query IS NULL AND kpi_unit <=> 'hours'" in seen[0]
    seen, written = lookups(False)
    assert "kpi_query IS NULL" not in seen[0] and written["kpi_baseline"] == "1100.0", "another KPI starts a new baseline"


def test_the_build_records_whether_the_old_rows_belong_to_its_kpi(agent_ns):
    from v120_genie_support import make_uc
    from v162_target_kpi_test import _evaluating
    inst, _asked = _evaluating(agent_ns, {"kpis": []})
    uc, spec = make_uc(KPIs=[dict(HOURS)]), agent_ns["validate_implement_spec"](VALID)[0]
    first, _ = inst._implement_target_kpi(uc, spec, {})
    assert first["prior_rows"] is False
    old = {key: value for key, value in first.items() if key != "prior_rows"}
    again, _ = inst._implement_target_kpi(uc, spec, {"target_kpi": old})
    assert again["prior_rows"] is True and agent_ns["implement_run_kpi"](again)["prior_rows"] is True
    moved, _ = inst._implement_target_kpi(uc, spec, {"target_kpi": dict(old, query=old["query"].replace("orders", "orders_v1"))})
    assert moved["prior_rows"] is False


def test_the_value_at_stake_part_is_named_in_the_kpi_s_unit_and_money_only_for_a_money_kpi(agent_ns):
    words, label = agent_ns["inspire_stake_words"], agent_ns["implement_asset_label"]
    assert [words(None), words(MONEY_IMPACT), words(HOURS_IMPACT), words({"kind": "count", "unit": "late shipments"}),
            words({"kind": "percent", "unit": ""})] == ["amount at stake", "money at stake", "hours at stake",
                                                       "late shipments at stake", "percent at stake"]
    assert [label("value_formula", HOURS_IMPACT), label("value_formula", MONEY_IMPACT), label("value_formula"),
            label("ai_reasoning", HOURS_IMPACT)] == ["hours at stake formula", "money at stake formula", "amount at stake formula",
                                                     "AI reasoning"]
    assert agent_ns["implement_part"]("value_formula", HOURS_IMPACT) == ("notebook", "hours at stake formula")
    long = {**VALID["outputs"], "value_formula_vibes": "v" * 2001}
    validate = agent_ns["validate_implement_spec"]
    for impact, named in ((HOURS_IMPACT, "hours"), (MONEY_IMPACT, "money"), (None, "amount")):
        assert validate(dict(VALID, outputs=long), impact=impact)[1] == [
            f"the {named} at stake formula vibes are 2001 characters; at most 2000 are allowed"], impact
    spec = _spec(agent_ns, outputs={**VALID["outputs"], "value_formula_vibes": "a" * 1990})[0]
    errors = agent_ns["implement_apply_vibe_routes"](spec, {"value_formula": "b" * 20}, HOURS_IMPACT)[2]
    assert errors and errors[0].startswith("the hours at stake formula would hold") and "money" not in errors[0]
    status = {"notebook": {"state": "ready", "impact": HOURS_IMPACT}, "value_formula": {"state": "ready"}}
    targets = agent_ns["implement_vibe_targets"](status, VALID["outputs"])
    assert targets["value_formula"] == "hours at stake formula (How the hours at stake on each row is counted)"
    prompt = agent_ns["implement_vibe_route_prompt"]("Count hours", targets)
    assert "when the ai_reasoning or value_formula id is listed" in prompt and "money" not in prompt
    assert agent_ns["implement_vibe_sent_lines"]({"value_formula": "Count hours"}, [], False, HOURS_IMPACT)[0].startswith(
        "sent to Hours at stake formula: Count hours")
    formula = _spec(agent_ns, outputs={**VALID["outputs"], "value_formula_vibes": "Count only open cases"},
                    retry_outputs=["value_formula"], retry_asks={"value_formula": ["Count only open cases"]})[0]
    text = agent_ns["implement_choices_markdown"](formula, asks={"value_formula": ["Count only open cases"]}, impact=HOURS_IMPACT)
    assert "- The customer's asks for the hours at stake formula, word for word" in text and "money at stake" not in text
    assert "- Inspire split the asks for the hours at stake formula into these" in text
    assert "- Try again on only these asks for the hours at stake formula" in text
    warned = agent_ns["implement_vibes_warnings"]("value_formula", [{"ask": "Count hours", "status": "missing", "evidence": "none"}],
                                                  impact=HOURS_IMPACT)
    assert warned and warned[0].startswith("Hours at stake formula vibe not done: Count hours")
    assert agent_ns["implement_vibes_missed_text"]({"value_formula": [{"ask": "Count hours", "evidence": "none"}]}, HOURS_IMPACT) == \
        "1. for the hours at stake formula, 'Count hours': none"
    assert "The part: hours at stake formula (this hours at stake formula)." in agent_ns["implement_vibes_split_prompt"](
        "value_formula", "Count hours", (), HOURS_IMPACT)


def test_the_notebook_parts_carry_the_kpi_s_unit_into_their_titles_and_failures(agent_ns):
    from v140_implement_test import _inspire
    columns = [{"col_name": n, "data_type": "string"} for n in ("entity_id", "ai_explanation", "value_at_stake_formula")]
    inst = _inspire(agent_ns, FakeSpark(responder=lambda s: columns if s.startswith("DESCRIBE") else []))
    status = {}
    inst._implement_record_notebook_parts({"result_table": "main.inspire.out", "asset_status": status, "key": (1, "N01-U01", 3),
                                           "use_case": {"_implement_impact": HOURS_IMPACT}})
    assert (status["value_formula"]["title"], status["value_formula"]["what"]) == (
        "Hours at stake formula", "How the hours at stake on each row is counted")
    assert status["ai_reasoning"]["title"] == "AI reasoning"
    inst._implement_vibes_rows = lambda uc_id, table, asset: []
    spec = _spec(agent_ns, outputs={**VALID["outputs"], "value_formula_vibes": "Count only open cases"})[0]
    items = inst._implement_notebook_vibe_items("N01-U01", spec, "main.inspire.out", "/W/nb", {}, impact=HOURS_IMPACT)
    assert [item["failure"] for item in items] == ["the latest run wrote no hours at stake formula on any record"]
    assert items[0]["impact"] == HOURS_IMPACT


def test_the_agent_fixtures_carry_the_app_s_target_kpi_parity_cases():
    root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures")
    with open(os.path.join(root, "implement_change_classes.json"), encoding="utf-8") as handle:
        classes = json.load(handle)
    with open(os.path.join(root, "implement_spec_parity.json"), encoding="utf-8") as handle:
        parity = json.load(handle)
    cases = [c["name"] for c in classes["cases"] if c["name"].startswith("target KPI")]
    plans = [p["name"] for p in classes["plans"] if p["name"].startswith("target KPI")]
    specs = [c["name"] for c in parity["cases"] if c["name"].startswith("kpi")]
    assert (len(cases), len(plans), len(specs)) == (6, 3, 15)
    assert "kpi with the fields the agent records" in specs and "target KPI case folded is no change" in cases


OLD_NOTE = "0.03 (Share of negative-profit web orders, measured 2026-10-24)"
NOW_NOTE = "0.03 (Share of negative-profit web orders, all data, measured 2026-10-24)"
RIGHT_NOTE = "2.98 (Share of web orders with negative profit, all data, measured 2026-10-31)"
STALE_KR = {"id": None, "statement": f"Reduce Share of negative-profit web orders from {OLD_NOTE} to [TARGET] within [WINDOW]",
            "source": "proposed"}


@pytest.mark.parametrize("note", [OLD_NOTE, NOW_NOTE, "0.03  ( Share of  negative-profit web orders , all data,  measured 2026-10-24 )"])
def test_the_baseline_a_refused_kpi_measured_is_cleared_in_the_old_and_the_new_wording(agent_ns, note):
    scrub, mismatch = agent_ns["kpi_without_stale_baselines"], agent_ns["KPI_BASELINE_MISMATCH"]
    assert scrub(f"Margin back from {note}, twice: {note}.", [STORED, RIGHT]) == f"Margin back from {mismatch}, twice: {mismatch}."


def test_a_shown_baseline_and_every_other_note_stay_as_written(agent_ns):
    scrub = agent_ns["kpi_without_stale_baselines"]
    kept = (RIGHT_NOTE, "0.03 (Share of negative-profit web orders, all data, measured 2026-10-31)",
            "0.03 (Share of negative-profit web orders shipped, all data, measured 2026-10-24)", "", "No baseline here")
    for text in kept:
        assert scrub(text, [STORED, RIGHT]) == text
    assert scrub(None, [STORED]) == "" and scrub(OLD_NOTE, None) == OLD_NOTE and scrub(OLD_NOTE, [None, "x", {}]) == OLD_NOTE
    assert scrub(OLD_NOTE, [dict(STORED, baseline={"value": 0.0285, "window_days": None})]) == OLD_NOTE
    assert scrub(OLD_NOTE, [dict(STORED, filter_op="<", filter_value=0, filter_type="decimal")]) == OLD_NOTE


def test_a_stale_zero_baseline_in_the_old_wording_reads_as_measured_by_the_kpi_query(agent_ns):
    scrub, pending = agent_ns["kpi_without_stale_baselines"], agent_ns["KPI_BASELINE_PENDING"]
    trips = dict(RIGHT, name="Weekly trips served", baseline=dict(STALE_ZERO))
    assert scrub(f"Trips up from {STALE_NOTE}", [trips]) == f"Trips up from {pending}"
    assert scrub("Trips up from 0 (Weekly trips served, measured 2026-10-29)", [trips]) == f"Trips up from {pending}"
    assert agent_ns["DatabricksInspire"]._BASELINE_PENDING == pending
    assert agent_ns["DatabricksInspire"]._BASELINE_MISMATCH == agent_ns["KPI_BASELINE_MISMATCH"]


def test_the_target_kpi_text_never_quotes_the_baseline_of_a_refused_kpi(agent_ns):
    mismatch = agent_ns["DatabricksInspire"]._BASELINE_MISMATCH
    record = agent_ns["implement_tracked_kpi"](STORED, "inspire", "inspire", [STALE_KR])
    assert record["target_text"] == "", "a key result whose target the sponsor has not set is no target"
    assert record["target"] is None and record["computable"] is False
    worded = agent_ns["implement_tracked_kpi"](STORED, "inspire", "inspire", [dict(STALE_KR, statement=STALE_KR["statement"].replace(
        "to [TARGET] within [WINDOW]", "steadily"))])
    assert worded["target_text"] == agent_ns["inspire_placeholder_words"](f"Reduce Share of negative-profit web orders from {mismatch} steadily")
    spark = FakeSpark(responder=lambda s: _describe(SUMMARY) if s.startswith("DESCRIBE") else [])
    agent_ns["inspire_save_kpi"](spark, TABLE, "N01-U03", "r-1", run={"target_kpi": agent_ns["implement_run_kpi"](worded)},
                                 out=[].append)
    written = _merge_values([s for s in spark.statements if s.startswith("MERGE INTO")][-1])
    assert "0.03" not in written["kpi_target_text"] and "does not match its name" in written["kpi_target_text"]
    assert "[BASELINE" not in written["kpi_target_text"]
    kept = {"id": None, "statement": f"Reduce Share of web orders with negative profit from {RIGHT_NOTE} to 1.5", "source": "proposed"}
    right = agent_ns["implement_tracked_kpi"](RIGHT, "inspire", "inspire", [kept])
    assert (right["target_text"], right["target"]) == (kept["statement"], 1.5)


def test_the_app_page_promise_never_quotes_the_baseline_of_a_refused_kpi(agent_ns):
    mismatch = agent_ns["inspire_placeholder_words"](agent_ns["DatabricksInspire"]._BASELINE_MISMATCH)
    benefits = [f"Margin back from {OLD_NOTE}", f"Loss down from {RIGHT_NOTE}"]
    for raw in (benefits, json.dumps(benefits)):
        promised = agent_ns["implement_promised"]({"Business Value": "Fewer losing orders", "KPIs": [STORED, RIGHT],
                                                   "Financial Benefits": raw})
        assert promised["benefits"] == [f"Margin back from {mismatch}", f"Loss down from {RIGHT_NOTE}"]
    assert agent_ns["implement_promised"]({"Financial Benefits": [f"Margin back from {OLD_NOTE}"]})["benefits"] == [
        f"Margin back from {OLD_NOTE}"], "with no KPIs there is no baseline to judge, so the text stays"


def test_the_catalog_and_the_genie_instruction_clear_an_old_wording_baseline_of_a_refused_kpi(agent_ns):
    obj, mismatch = make_inspire(agent_ns), agent_ns["inspire_placeholder_words"](agent_ns["DatabricksInspire"]._BASELINE_MISMATCH)
    uc = value_uc(**{"KPIs": [STORED, RIGHT], "Financial Benefits": [f"Margin back from {OLD_NOTE}"],
                     "Expected Key Results": [STALE_KR]})
    assert obj._use_case_items(uc, "Financial Benefits", "lines", {}, "English")[0] == [f"Margin back from {mismatch}"]
    assert obj._use_case_items(uc, "Expected Key Results", "key_results", {}, "English")[0] == [
        f"Reduce Share of negative-profit web orders from {mismatch} to a target the sponsor sets within a time frame the sponsor sets"]
    source = obj._genie_kpi_source(uc)
    assert OLD_NOTE not in source and "0.03" not in source and mismatch in source
