"""Column filters on the App's tables: the decision list and each extra table carry their own filters in their column headers, the
kind follows the column's format, the server validates and applies them in SQL on Delta and on Lakebase, and Genie's App guidance
puts a user's ask for a table's filters on that table, offline."""
import copy
import datetime
import json
import os
import subprocess
import sys

import psycopg
import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_core  # noqa: E402
import shell_db  # noqa: E402
import shell_pg  # noqa: E402
import shell_sql  # noqa: E402
from v141_app_shell_test import PAGE, SETTINGS, call  # noqa: E402
from v142_edits_test import MODIFY, edit_page  # noqa: E402
from v144_app_data_test import DECIDE, EDITOR, DataWorkspace, records, shell  # noqa: E402
from v145_lakebase_test import ITEMS, PG_ENV, CredentialWorkspace, app_dir, backend, item, postgres  # noqa: E402,F401

RETURNS_OUT = "main.shop.returns_out"
RECORDS_SQL = ("SELECT o.record_key, o.entity_id, o.entity_label, o.priority_tier, o.rank, o.top_reasons, o.recommended_action, o.value, "
               "o.value_at_stake, o.as_of_date, o.channel, o.return_reason, o.category, o.confidence_level, o.data_quality_flag "
               f"FROM {RETURNS_OUT} AS o WHERE o.is_current AND o.change_source <> 'delete'")
LISTED = [{"name": n, "type": t} for n, t in (
    ("record_key", "STRING"), ("entity_id", "STRING"), ("entity_label", "STRING"), ("priority_tier", "STRING"), ("rank", "INT"),
    ("value", "DOUBLE"), ("value_at_stake", "DOUBLE"), ("as_of_date", "DATE"), ("channel", "STRING"), ("return_reason", "STRING"),
    ("category", "STRING"), ("confidence_level", "STRING"), ("data_quality_flag", "STRING"))]
SHOWN = ("channel", "return_reason", "category", "priority_tier", "value_at_stake")
MONEY = {"currency": "USD", "format": "currency"}


def returns_page(**records_changes):
    seg = lambda ident, label, column, both=True: {"id": ident, "label": label, "type": "multi_select",
                                                   "columns": dict({"records": column}, **({"returns": column} if both else {}))}
    page = {
        "version": 1, "id": "n09_u03", "use_case_id": "N09-U03", "title": "Costliest return reasons", "icon": "trend", "hue": "rose",
        "question": "Which return reason, category and channel combinations lose the most, and what should owners fix first?",
        "datasets": [{"name": "returns", "sql": "SELECT as_of_date, event_date, channel, return_reason, category, loss_amount "
                                                "FROM main.shop.return_lines"},
                     {"name": "records", "sql": RECORDS_SQL}],
        "filters": [{"id": "run_date", "label": "Run date", "type": "date_range", "grain": "day", "default": "all",
                     "columns": {"records": "as_of_date", "returns": "as_of_date"}},
                    seg("channel", "Channel", "channel"), seg("return_reason", "Return reason", "return_reason"),
                    seg("category", "Category", "category"), seg("priority_tier", "Priority tier", "priority_tier", both=False)],
        "kpis": [dict(MONEY, id="total_loss", label="Return loss", dataset="returns", expression="SUM(loss_amount)", good="down"),
                 dict(MONEY, id="planned_loss", label="Loss on the plan", dataset="records", expression="SUM(value_at_stake)", good="down"),
                 {"id": "rows", "label": "Combinations", "dataset": "records", "expression": "COUNT(*)", "format": "integer"}],
        "charts": [{"id": "loss_trend", "title": "Return loss over time", "hint": "Loss by return date.", "type": "line", "dataset": "returns",
                    "x": {"column": "event_date", "kind": "time"}, "y": [dict(MONEY, label="Loss", expression="SUM(loss_amount)")]},
                   {"id": "reason_loss", "title": "Costliest reasons", "hint": "Reasons by loss.", "type": "horizontal_bar", "dataset": "returns",
                    "x": {"column": "return_reason", "kind": "category"}, "y": [dict(MONEY, label="Loss", expression="SUM(loss_amount)")]},
                   {"id": "channel_share", "title": "Loss by channel", "hint": "Share of loss.", "type": "donut", "dataset": "returns",
                    "x": {"column": "channel", "kind": "category"}, "y": [dict(MONEY, label="Loss", expression="SUM(loss_amount)")]},
                   {"id": "plan_by_reason", "title": "What puts combinations on the plan", "hint": "Loss at stake by reason.",
                    "type": "bar", "dataset": "records", "x": {"column": "return_reason", "kind": "category"},
                    "y": [dict(MONEY, label="Loss at stake", expression="SUM(value_at_stake)")], "driver": True}],
        "tables": [],
        "records": dict({
            "title": "Root-cause action plan", "hint": "Combinations ranked by loss at stake.", "key": "record_key", "label": "entity_label",
            "rank": "rank", "reasons": "top_reasons", "sublabel": "category", "tier": "priority_tier", "action": "recommended_action",
            "columns": [{"column": "channel", "format": "text", "label": "Channel"},
                        {"column": "return_reason", "format": "text", "label": "Return reason"},
                        {"column": "category", "format": "text", "label": "Category"},
                        dict(MONEY, column="value_at_stake", label="Loss at stake")],
            "detail": [{"column": "value", "format": "number", "label": "Share-shift ratio"},
                       {"column": "confidence_level", "format": "text", "label": "Confidence"},
                       {"column": "data_quality_flag", "format": "text", "label": "Data quality"}],
            "column_filters": [{"column": c} for c in SHOWN]}, **records_changes),
        "result_table": RETURNS_OUT,
    }
    return page


def with_table(page, **changes):
    table = dict({"id": "worst", "title": "Worst categories", "dataset": "returns",
                  "columns": [{"column": "category", "label": "Category", "format": "text"},
                              dict(MONEY, column="loss_amount", label="Loss"), {"column": "event_date", "label": "Last return", "format": "date"}],
                  "column_filters": [{"column": "category"}, {"column": "loss_amount"}, {"column": "event_date"}]}, **changes)
    return dict(page, tables=[table])


CONTEXT = {"table": None, "join": None, "actions": False, "changes": False, "tier": None, "tie": "record_key", "ai": [], "categories": [],
           "unjoined": "the page names no result table"}


def plan(page, columns=None, context=None, values=None):
    context = dict(CONTEXT, **(context or {}))
    request = shell_sql.list_request(page, dict({"column_filters": columns} if columns is not None else {}), context)
    return shell_sql.list_queries(page, values or {}, request, context)


EVERY = ("rank", "entity_label", "category", "priority_tier", "channel", "return_reason", "value_at_stake")


def test_the_returns_page_with_a_filter_on_every_column_of_its_action_plan_passes_the_shell():
    page = returns_page()
    assert shell_sql.spec_problems(page) == []
    assert shell_sql.list_column_filters(page) == [
        {"column": "rank", "type": "number_range", "label": "Rank", "implied": True},
        {"column": "entity_label", "type": "multi_select", "label": "Item", "implied": True},
        {"column": "category", "type": "multi_select", "label": "Category"},
        {"column": "priority_tier", "type": "multi_select", "label": "Tier"},
        {"column": "channel", "type": "multi_select", "label": "Channel"},
        {"column": "return_reason", "type": "multi_select", "label": "Return reason"},
        {"column": "value_at_stake", "type": "number_range", "label": "Loss at stake"}]
    shown = shell_sql.list_shown(page["records"])
    assert list(shown) == ["rank", "entity_label", "category", "priority_tier", "channel", "return_reason", "value_at_stake"]
    assert shown["rank"] == ("Rank", "integer") and shown["entity_label"] == ("Item", "text")
    assert shell_sql.page_column_filters(with_table(page))["tables"]["worst"] == [
        {"column": "category", "type": "multi_select", "label": "Category"},
        {"column": "loss_amount", "type": "number_range", "label": "Loss"},
        {"column": "event_date", "type": "date_range", "label": "Last return"}]


@pytest.mark.parametrize("entries, needle", [
    ([{"column": "confidence_level"}], "has a column filter on confidence_level, which it does not show; filter one of the columns it "
                                       "shows: rank, entity_label, category, priority_tier, channel, return_reason, value_at_stake"),
    ([{"column": "nope"}], "has a column filter on nope, which it does not show"),
    ([{"column": "channel"}, {"column": "channel"}], "column filter channel appears twice"),
    ([{"column": "channel", "type": "number_range"}], "column channel shows as text, so its filter is a multi_select, not a number_range"),
    ([{"column": "value_at_stake", "type": "multi_select"}], "column value_at_stake shows as currency, so its filter is a number_range, "
                                                             "not a multi_select"),
    ([{"column": "channel", "type": "slider"}], "column filter channel type must be one of multi_select, number_range, date_range"),
    ([{"name": "channel"}], "needs a column name"),
    (["channel"], "needs a column name"),
    ("channel", "column_filters must be false, which turns every column filter off, or a list of the columns whose filter it sets"),
    (True, "column_filters must be false"),
    ([{"column": "channel", "off": "yes"}], "column filter channel off must be true or false"),
    ([{"column": "nope", "off": True}], "has a column filter on nope, which it does not show"),
])
def test_a_column_filter_on_a_column_the_list_does_not_show_or_of_the_wrong_kind_is_refused(entries, needle):
    problems = shell_sql.spec_problems(returns_page(column_filters=entries))
    assert any(p.startswith("the records list ") and needle in p for p in problems), problems


def test_a_table_column_filter_names_one_of_its_columns_with_the_kind_its_format_gives():
    assert shell_sql.spec_problems(with_table(returns_page())) == []
    bad = with_table(returns_page(), column_filters=[{"column": "channel"}, {"column": "event_date", "type": "number_range"}])
    problems = shell_sql.spec_problems(bad)
    assert "table worst has a column filter on channel, which it does not show; filter one of the columns it shows: category, loss_amount, " \
           "event_date" in problems
    assert "table worst column event_date shows as date, so its filter is a date_range, not a number_range" in problems
    assert shell_sql.spec_problems(with_table(returns_page(), column_filters=[{"column": "event_date", "type": "date_range"}])) == []


def test_a_page_without_column_filters_gets_a_filter_on_every_column_it_shows_and_queries_as_before():
    plain = copy.deepcopy(returns_page())
    del plain["records"]["column_filters"]
    assert shell_sql.spec_problems(plain) == []
    assert [(f["column"], f["type"], f.get("implied")) for f in shell_sql.list_column_filters(plain)] == [
        ("rank", "number_range", True), ("entity_label", "multi_select", True), ("category", "multi_select", True),
        ("priority_tier", "multi_select", True), ("channel", "multi_select", True), ("return_reason", "multi_select", True),
        ("value_at_stake", "number_range", True)]
    tabled = with_table(plain)
    del tabled["tables"][0]["column_filters"]
    assert [f["column"] for f in shell_sql.page_column_filters(tabled)["tables"]["worst"]] == ["category", "loss_amount", "event_date"]
    values = {"run_date": {"from": "2026-01-01", "to": "2026-10-15"}, "channel": ["Web"]}
    assert plan(plain, values=values) == plan(returns_page(), values=values) == plan(returns_page(), {}, values=values)
    assert "WHERE CAST(`as_of_date` AS DATE) BETWEEN :p0 AND :p1 AND CAST(`channel` AS STRING) IN (:p2)" in plan(plain, values=values)["rows"][0]
    assert shell_sql.table_query(with_table(plain), "worst", values) == shell_sql.table_query(with_table(plain), "worst", values, {})


def test_a_column_filter_turned_off_or_every_filter_turned_off_is_respected():
    page = returns_page(column_filters=[{"column": "channel", "off": True}, {"column": "value_at_stake"}])
    assert shell_sql.spec_problems(page) == []
    assert [f["column"] for f in shell_sql.list_column_filters(page)] == [c for c in EVERY if c != "channel"]
    problems = shell_sql.column_values_problems(shell_sql.list_column_filters(page), {"channel": ["Web"]}, "the decision list")
    assert problems and "the decision list has no column filter 'channel'" in problems[0]
    none = returns_page(column_filters=False)
    assert shell_sql.spec_problems(none) == [] and shell_sql.list_column_filters(none) == []
    assert shell_sql.list_column_filters(none, {"channel": "STRING"}, actions=True) == []
    assert shell_sql.page_column_filters(with_table(none, column_filters=False)) == {"list": [], "tables": {}}


def test_an_implied_filter_takes_its_kind_from_the_column_type_and_a_column_it_cannot_filter_gets_none():
    page = returns_page(column_filters=None)
    types = {"rank": "STRING", "entity_label": "ARRAY<STRING>", "category": "DECIMAL(10,2)", "priority_tier": "BOOLEAN",
             "channel": "TIMESTAMP_NTZ", "return_reason": "MAP<STRING, STRING>"}
    assert [(f["column"], f["type"]) for f in shell_sql.list_column_filters(page, types)] == [
        ("rank", "multi_select"), ("category", "number_range"), ("priority_tier", "multi_select"), ("channel", "date_range"),
        ("value_at_stake", "number_range")]
    stated = returns_page(column_filters=[{"column": "rank"}])
    assert next(f for f in shell_sql.list_column_filters(stated, types) if f["column"] == "rank") == \
        {"column": "rank", "type": "number_range", "label": "Rank"}, "a filter the spec names keeps the kind its format gives"
    assert shell_sql.field_filter("LONG") == "number_range" and shell_sql.field_filter("binary") == "" and shell_sql.field_filter(None) == ""


def test_a_filter_on_a_column_the_spec_never_named_narrows_the_list_and_a_table_in_sql():
    page = returns_page(column_filters=None)
    sql, params = plan(page, {"return_reason": ["Damaged"], "rank": {"max": 5}})["rows"]
    assert "AS d WHERE CAST(`rank` AS DOUBLE) <= :p0 AND CAST(`return_reason` AS STRING) IN (:p1))" in sql
    assert [p["value"] for p in params] == ["5.0", "Damaged"]
    tabled = with_table(page)
    del tabled["tables"][0]["column_filters"]
    sql, params = shell_sql.table_query(tabled, "worst", {}, {"loss_amount": {"min": 10}}, {"loss_amount": "DOUBLE"})
    assert "WHERE CAST(`loss_amount` AS DOUBLE) >= :p0" in sql and [p["value"] for p in params] == ["10.0"]


@pytest.mark.parametrize("columns", [{"channel` = 1 OR 1=1 --": ["x"]}, {"confidence_level": ["High"]},
                                     {"rank); DROP TABLE t; --": {"min": 1}}, {"action_status": ["Done"]}])
def test_a_column_filter_on_an_unknown_or_injected_column_is_refused(columns):
    problems = shell_sql.list_values_problems(returns_page(column_filters=None), columns, {"types": {}, "actions": False})
    assert problems and "the decision list has no column filter" in problems[0], problems


def test_a_column_filter_value_reaches_the_sql_only_as_a_parameter():
    sql, params = plan(returns_page(column_filters=None), {"entity_label": ["x' OR '1'='1"]})["rows"]
    assert "OR '1'='1" not in sql and "CAST(`entity_label` AS STRING) IN (:p0)" in sql
    assert [p["value"] for p in params] == ["x' OR '1'='1"]


def test_the_owner_and_status_filters_narrow_the_joined_actions_of_a_decision_list():
    context = {"table": "`main`.`shop`.`returns_out`", "join": "record_key", "actions": True, "changes": False}
    page = returns_page()
    assert shell_sql.list_values_problems(page, {"action_status": ["Done"], "action_owner": ["Ana"]}, context) == []
    sql, params = plan(page, {"action_status": ["New", "Done"], "action_owner": ["Ana"]}, context=context)["rows"]
    assert "_inspire_status" not in sql.split(", c AS (")[0], "the dataset query never reads the joined actions"
    assert "WHERE CAST(c.`_inspire_owner` AS STRING) IN (:p0) AND CAST(COALESCE(c.`_inspire_status`, 'New') AS STRING) IN (:p1, :p2)" in sql
    assert [p["value"] for p in params][:3] == ["Ana", "New", "Done"]


@pytest.mark.parametrize("sort, needle", [
    ({"key": "loss_amount; DROP TABLE t", "dir": "asc"}, "table worst cannot sort by 'loss_amount; DROP TABLE t'; sort by one of its columns: "
                                                         "category, loss_amount, event_date"),
    ({"key": "channel"}, "table worst cannot sort by 'channel'"),
    ({"key": "loss_amount", "dir": "asc; DROP TABLE t"}, "table worst sort dir must be asc or desc"),
    ("loss_amount", "table worst cannot sort by 'loss_amount'"),
])
def test_a_table_sort_on_an_unknown_column_or_an_injected_direction_is_refused(sort, needle):
    page = with_table(returns_page())
    assert any(needle in p for p in shell_sql.table_sorts_problems(page, {"worst": sort}))
    with pytest.raises(ValueError):
        shell_sql.table_query(page, "worst", {}, None, None, sort)


def test_a_table_sorts_on_the_server_by_the_column_the_person_asks_for():
    page = with_table(returns_page())
    assert shell_sql.table_sorts_problems(page, {"worst": {"key": "event_date", "dir": "desc"}}) == []
    assert shell_sql.table_sorts_problems(page, {"nope": {"key": "event_date"}}) == ["the page has no table 'nope'"]
    assert shell_sql.table_sorts_problems(page, ["worst"]) == ["table_sorts must be an object of table id to its sort, as "
                                                               "{\"key\": column, \"dir\": \"asc\" or \"desc\"}"]
    sql, _params = shell_sql.table_query(page, "worst", {}, None, None, {"key": "event_date", "dir": "desc"})
    assert sql.endswith("ORDER BY `event_date` DESC NULLS LAST LIMIT 5001")
    sql, _params = shell_sql.table_query(page, "worst", {}, None, None, {"key": "category"})
    assert "ORDER BY `category` ASC NULLS LAST" in sql


def test_a_table_reads_one_row_past_the_cap_so_a_cut_table_is_marked_truncated_and_a_spec_limit_is_kept():
    page = with_table(returns_page())
    assert shell_sql.table_query(page, "worst", {})[0].endswith(f"LIMIT {shell_sql.CAPS['table_rows'] + 1}")
    page["tables"][0]["limit"] = 10
    assert shell_sql.table_query(page, "worst", {})[0].endswith("LIMIT 10")
    cap = shell_sql.CAPS["table_rows"]
    found = {"manifest": {"schema": {"columns": [{"name": "n", "type_name": "INT"}]}}}
    workspace = shell_db.Workspace("https://h", dict, session=object())
    cut = workspace._collect({**found, "result": {"data_array": [[str(i)] for i in range(cap + 1)]}}, cap)
    whole = workspace._collect({**found, "result": {"data_array": [[str(i)] for i in range(cap)]}}, cap)
    assert (len(cut["rows"]), cut["truncated"], len(whole["rows"]), whole["truncated"]) == (cap, True, cap, False)


def test_the_act_now_tier_filter_narrows_the_rows_the_total_and_the_ai_counts_in_the_same_dataset_query():
    page = returns_page()
    queries = plan(page, {"priority_tier": ["Act now"]}, values={"channel": ["Web"]})
    narrowed = "WHERE CAST(`channel` AS STRING) IN (:p0) AND CAST(`priority_tier` AS STRING) IN (:p1)"
    for name in ("rows", "total"):
        sql, params = queries[name]
        assert sql.startswith(f"WITH d AS (SELECT * FROM ({RECORDS_SQL}) AS d {narrowed})"), sql
        assert [p["value"] for p in params] == ["Web", "Act now"]
    context = dict(CONTEXT, table="`main`.`shop`.`returns_out`", join="record_key", ai=["ai_cat_reason"], categories=["ai_cat_reason"])
    sql, params = shell_sql.ai_counts_query(page, {"channel": ["Web"]}, context, {"priority_tier": ["Act now"]})
    assert sql.startswith(f"WITH d AS (SELECT * FROM ({RECORDS_SQL}) AS d {narrowed})") and [p["value"] for p in params] == ["Web", "Act now"]
    assert shell_sql.ai_counts_query(page, {}, context) == shell_sql.ai_counts_query(page, {}, context, {})


@pytest.mark.parametrize("value, condition, sent", [
    ({"min": 100, "max": 5000}, "CAST(`value_at_stake` AS DOUBLE) BETWEEN :p0 AND :p1", ["100.0", "5000.0"]),
    ({"min": 250.5}, "CAST(`value_at_stake` AS DOUBLE) >= :p0", ["250.5"]),
    ({"min": None, "max": 0}, "CAST(`value_at_stake` AS DOUBLE) <= :p0", ["0.0"]),
    ({"min": None, "max": None}, None, []),
])
def test_a_range_on_the_loss_at_stake_is_one_or_two_number_parameters(value, condition, sent):
    sql, params = plan(returns_page(), {"value_at_stake": value})["rows"]
    assert (f"AS d WHERE {condition})" in sql) if condition else "AS d WHERE" not in sql
    assert [p["value"] for p in params] == sent and {p["type"] for p in params} <= {"DOUBLE"}


def test_the_loss_at_stake_range_filters_the_money_the_list_shows_when_the_app_works_it_out_again():
    context = {"table": "`main`.`shop`.`returns_out`", "join": "record_key", "money": ["CAST(`value_at_stake` AS DOUBLE) * 2 AS `_inspire_money`",
                                                                                      "CAST(NULL AS STRING) AS `_inspire_fx`"]}
    queries = plan(returns_page(), {"value_at_stake": {"min": 1000}, "channel": ["Web"]}, context=context)
    rows, total = queries["rows"][0], queries["total"][0]
    shown = "COALESCE(c.`_inspire_money`, CAST(d.`value_at_stake` AS DOUBLE))"
    assert "_inspire_money" not in rows.split(", c AS (")[0], "the dataset query never reads the joined money"
    assert "AS d WHERE CAST(`channel` AS STRING) IN (:p0))" in rows
    assert f"LEFT JOIN c ON c.`_inspire_key` = d.`record_key` WHERE CAST({shown} AS DOUBLE) >= :p1)" in rows
    assert ", c AS (" in total and f"WHERE CAST({shown} AS DOUBLE) >= :p1)" in total
    context = dict(CONTEXT, **context, ai=["ai_cat_reason"], categories=["ai_cat_reason"])
    current = lambda sql: sql.split(", c AS (")[1].split(") SELECT '")[0]
    sql, _params = shell_sql.ai_counts_query(returns_page(), {}, context, {"value_at_stake": {"min": 1000}})
    assert "AS `_inspire_money`" in current(sql) and f"WHERE CAST({shown} AS DOUBLE) >= :p0 GROUP BY" in sql
    plain, _params = shell_sql.ai_counts_query(returns_page(), {}, context, {"channel": ["Web"]})
    assert "_inspire_money" not in plain and "AS d WHERE CAST(`channel` AS STRING) IN (:p0))" in plain


@pytest.mark.parametrize("columns, needle", [
    ({"confidence_level": ["High"]}, "the decision list has no column filter 'confidence_level'; its column filters: rank, entity_label, "
                                     "category, priority_tier, channel, return_reason, value_at_stake"),
    ({"value_at_stake": {"min": 5000, "max": 100}}, "the decision list column filter value_at_stake runs from 5000 to 100; its min must not "
                                                    "be above its max"),
    ({"value_at_stake": {"min": "100"}}, "the decision list column filter value_at_stake: '100' is not a number"),
    ({"value_at_stake": {"min": True}}, "is not a number"),
    ({"value_at_stake": {"min": float("nan")}}, "is not a number"),
    ({"value_at_stake": {"min": 1e16}}, "is not a number"),
    ({"value_at_stake": {"low": 1}}, "takes min and max numbers, not low"),
    ({"value_at_stake": [1, 2]}, "takes min and max numbers"),
    ({"priority_tier": "Act now"}, "the decision list column filter priority_tier takes a list of at most 200 values"),
    ({"priority_tier": [1]}, "values must be text of at most 300 characters"),
    (["priority_tier"], "the decision list column filters must be an object of column to value"),
])
def test_column_filter_values_are_checked_like_page_filter_values_and_a_bad_one_is_refused(columns, needle):
    problems = shell_sql.column_values_problems(shell_sql.list_column_filters(returns_page()), columns, "the decision list")
    assert any(needle in p for p in problems), problems


def test_a_date_range_column_filter_takes_either_end_and_refuses_an_end_before_its_start():
    filters = shell_sql.table_column_filters(with_table(returns_page())["tables"][0])
    check = lambda value: shell_sql.column_values_problems(filters, {"event_date": value}, "table worst")
    assert check({"from": "2026-01-01"}) == check({"to": "2026-03-31"}) == check({"from": "2026-01-01", "to": "2026-03-31"}) == []
    assert check({"from": "2026-04-01", "to": "2026-03-31"}) == ["table worst column filter event_date runs from 2026-04-01 to 2026-03-31; its "
                                                                 "from must not be above its to"]
    assert check({"from": "2026-13-01"}) == ["table worst column filter event_date: '2026-13-01' is not a YYYY-MM-DD date"]
    sql, params = shell_sql.table_query(with_table(returns_page()), "worst", {"channel": ["Web"]},
                                        {"event_date": {"from": "2026-01-01"}, "category": ["Books", "Toys"], "loss_amount": {"max": 50}})
    assert ("WHERE CAST(`channel` AS STRING) IN (:p0) AND CAST(`category` AS STRING) IN (:p1, :p2) AND CAST(`loss_amount` AS DOUBLE) <= :p3 "
            "AND CAST(`event_date` AS DATE) >= :p4") in sql
    assert [(p["value"], p["type"]) for p in params] == [("Web", "STRING"), ("Books", "STRING"), ("Toys", "STRING"), ("50.0", "DOUBLE"),
                                                         ("2026-01-01", "DATE")]


def test_the_page_filter_values_keep_their_old_messages_through_the_one_value_check():
    assert shell_sql.filter_values_problems(PAGE, {"run_date": "2026"}) == ["filter run_date takes from and to dates"]
    assert shell_sql.filter_values_problems(PAGE, {"run_date": {"from": "2026-01-01"}}) == ["filter run_date: None is not a YYYY-MM-DD date"]
    assert shell_sql.filter_values_problems(PAGE, {"run_date": {"from": "2026-06-01", "to": "2026-01-01"}}) == [], \
        "a page date range may come either way round, as before"


class ColumnWorkspace(DataWorkspace):
    def __init__(self, **kwargs):
        super().__init__(listed=kwargs.pop("listed", LISTED), options=kwargs.pop("options", ["Act now", "Monitor", "Review"]), **kwargs)

    def answer(self, sql, params):
        if " OFFSET " in sql or "AS total FROM (SELECT 1 FROM f LIMIT" in sql:
            tiers = [p["value"] for p in params if p["value"] in ("Act now", "Review", "Monitor")]
            rows = [r for r in self.all_rows if not tiers or r["priority_tier"] in tiers]
            return {"columns": [], "rows": rows if " OFFSET " in sql else [{"total": len(rows)}], "truncated": False}
        return super().answer(sql, params)

    all_rows = [{"record_key": f"k{i}", "entity_label": f"Combination {i}", "priority_tier": ("Act now", "Review", "Monitor")[i % 3], "rank": i}
                for i in range(1, 10)]


def column_shell(tmp_path, settings=None, pages=None, ws=None, **kwargs):
    pages = pages or [returns_page()]
    return shell(tmp_path, settings=dict(settings or SETTINGS, pages=[p["id"] for p in pages]), pages=pages, ws=ws or ColumnWorkspace(**kwargs))


def test_the_decision_list_shows_only_the_act_now_records_and_its_count_follows_on_delta(tmp_path):
    s, ws, _made = column_shell(tmp_path)
    status, out = records(s, page="n09_u03", column_filters={"priority_tier": ["Act now"]})
    assert status == 200, out
    assert {r["priority_tier"] for r in out["rows"]} == {"Act now"} and out["total"] == 3
    status, everything = records(s, page="n09_u03")
    assert status == 200 and everything["total"] == 9
    (rows_sql, _p), = [q for q in ws.queries(" OFFSET ") if "priority_tier` AS STRING) IN" in q[0]]
    assert "CAST(`priority_tier` AS STRING) IN (:p0)" in rows_sql.split(" c AS (")[0]


def test_a_filter_on_a_column_the_list_does_not_show_is_refused_before_any_query(tmp_path):
    s, ws, _made = column_shell(tmp_path)
    status, out = records(s, page="n09_u03", column_filters={"confidence_level": ["High"]})
    assert status == 400 and "the decision list has no column filter 'confidence_level'" in out["error"]
    status, out = records(s, page="n09_u03", column_filters={"value_at_stake": {"min": 9, "max": 1}})
    assert status == 400 and "its min must not be above its max" in out["error"]
    assert ws.sql == [], "a refused column filter reads nothing"


def test_the_summary_counts_the_whole_action_record_whatever_the_column_filters(tmp_path):
    s, ws, _made = column_shell(tmp_path, settings=DECIDE, impact={"open_n": 4, "done_n": 2, "resolved_n": 1}, left=3)
    status, narrowed = records(s, page="n09_u03", column_filters={"priority_tier": ["Act now"]})
    status_all, everything = records(s, page="n09_u03")
    assert status == status_all == 200
    assert narrowed["summary"] == everything["summary"]
    assert not any("priority_tier" in sql for sql, _p in ws.queries("AS open_n") + ws.queries("AS left_n"))


def test_the_filter_list_names_each_column_filter_with_its_choices_and_the_check_runs_them(tmp_path):
    s, ws, _made = column_shell(tmp_path, pages=[with_table(returns_page())])
    status, out = call(s, "GET", "filters", query={"page": "n09_u03"}, headers=EDITOR)
    assert status == 200
    assert [f["id"] for f in out["filters"]] == ["run_date", "channel", "return_reason", "category", "priority_tier"]
    listed = {f["column"]: f for f in out["columns"]["list"]}
    assert list(listed) == list(EVERY)
    assert listed["priority_tier"] == {"column": "priority_tier", "type": "multi_select", "label": "Tier", "options": ["Act now", "Monitor", "Review"],
                                       "searchable": False}
    assert listed["value_at_stake"] == {"column": "value_at_stake", "type": "number_range", "label": "Loss at stake"}
    assert listed["rank"] == {"column": "rank", "type": "number_range", "label": "Rank", "implied": True}
    assert listed["entity_label"] == {"column": "entity_label", "type": "multi_select", "label": "Item", "implied": True, "options": [],
                                      "searchable": True, "lazy": True}
    assert [f["column"] for f in out["columns"]["tables"]["worst"]] == ["category", "loss_amount", "event_date"]
    asked = [sql for sql, _p, _l in ws.sql if sql.startswith("SELECT v FROM")]
    assert any("`priority_tier`" in sql and RECORDS_SQL in sql and "return_lines" not in sql for sql in asked), \
        "a column filter offers the values of its own table's dataset, not every dataset a page filter reaches"
    assert not any("`entity_label`" in sql for sql in asked), "a filter the spec never named loads its choices only when it opens"


def test_a_decision_list_that_keeps_actions_offers_owner_and_status_filters(tmp_path):
    s, _ws, _made = column_shell(tmp_path, settings=DECIDE)
    status, out = call(s, "GET", "filters", query={"page": "n09_u03"}, headers=EDITOR)
    assert status == 200
    listed = {f["column"]: f for f in out["columns"]["list"]}
    assert list(listed)[-2:] == ["action_owner", "action_status"]
    assert listed["action_status"]["options"] == list(shell_sql.ACTION_STATUSES) and listed["action_owner"]["options"] == []
    status, out = call(s, "GET", "filters/options", query={"page": "n09_u03", "column": "action_owner", "q": "a"}, headers=EDITOR)
    assert status == 404, "owners come with the list, never from a query over the dataset"


def test_the_list_filters_and_options_on_a_column_the_spec_never_named(tmp_path):
    page = returns_page(column_filters=None)
    s, ws, _made = column_shell(tmp_path, pages=[page], options=["Damaged"])
    status, found = call(s, "GET", "filters/options", query={"page": "n09_u03", "column": "return_reason", "q": "dam"}, headers=EDITOR)
    assert status == 200 and found["options"] == ["Damaged"]
    status, out = records(s, page="n09_u03", column_filters={"rank": {"max": 3}})
    assert status == 200, out
    (rows_sql, _p), = [q for q in ws.queries(" OFFSET ") if "CAST(`rank` AS DOUBLE) <=" in q[0]]
    status, out = call(s, "GET", "filters/options", query={"page": "n09_u03", "column": "rank", "q": "1"}, headers=EDITOR)
    assert status == 404, "a number column has no choices"


def test_filter_options_search_a_column_filter_and_refuse_one_the_table_does_not_have(tmp_path):
    s, ws, _made = column_shell(tmp_path, pages=[with_table(returns_page())], options=["Books"])
    status, out = call(s, "GET", "filters/options", query={"page": "n09_u03", "column": "category", "q": "bo"}, headers=EDITOR)
    assert status == 200 and out["options"] == ["Books"] and out["column"] == "category" and out["table"] is None
    sql, params, limit = ws.sql[-1]
    assert RECORDS_SQL in sql and "v ILIKE :p0" in sql and params[0]["value"] == "%bo%" and limit == 50
    status, out = call(s, "GET", "filters/options", query={"page": "n09_u03", "table": "worst", "column": "category", "q": "bo"}, headers=EDITOR)
    assert status == 200 and "return_lines" in ws.sql[-1][0] and out["table"] == "worst"
    for query in ({"column": "value_at_stake"}, {"column": "confidence_level"}, {"table": "nope", "column": "category"},
                  {"table": "worst", "column": "channel"}):
        status, out = call(s, "GET", "filters/options", query=dict({"page": "n09_u03"}, **query), headers=EDITOR)
        assert status == 404, (query, out)


def test_a_table_filter_narrows_only_its_own_table_and_a_bad_one_is_refused(tmp_path):
    s, ws, _made = column_shell(tmp_path, pages=[with_table(returns_page())])
    body = {"page": "n09_u03", "filters": {"channel": ["Web"]}, "table_filters": {"worst": {"category": ["Books"]}}}
    status, out = call(s, "POST", "page", body=body, headers=EDITOR)
    assert status == 200 and out["errors"] == {}
    tables = [sql for sql, _p, _l in ws.sql if sql.startswith("SELECT `category`, `loss_amount`, `event_date`")]
    assert len(tables) == 1 and "CAST(`category` AS STRING) IN (:p1)" in tables[0]
    assert not any("CAST(`category` AS STRING) IN" in sql for sql, _p, _l in ws.sql if "'now' AS period" in sql or "GROUP BY" in sql)
    sorted_body = dict(body, table_sorts={"worst": {"key": "loss_amount", "dir": "desc"}})
    status, out = call(s, "POST", "page", body=sorted_body, headers=EDITOR)
    assert status == 200 and any("ORDER BY `loss_amount` DESC NULLS LAST" in sql for sql, _p, _l in ws.sql)
    for sorts in ({"worst": {"key": "channel"}}, {"worst": {"key": "loss_amount`; DROP TABLE t; --"}}, {"nope": {"key": "x"}}):
        status, out = call(s, "POST", "page", body=dict(body, table_sorts=sorts), headers=EDITOR)
        assert status == 400, out
    for tables, needle in (({"nope": {}}, "the page has no table 'nope'"), ({"worst": {"channel": ["Web"]}}, "table worst has no column filter"),
                           ({"worst": {"loss_amount": {"min": 3, "max": 1}}}, "its min must not be above its max"),
                           ("worst", "table_filters must be an object")):
        status, out = call(s, "POST", "page", body=dict(body, table_filters=tables), headers=EDITOR)
        assert status == 400 and needle in out["error"], out


def test_the_check_sends_back_a_range_on_a_column_that_holds_text(tmp_path):
    listed = [dict(c, type="STRING") if c["name"] == "value_at_stake" else c for c in LISTED]
    s, _ws, _made = column_shell(tmp_path, listed=listed)
    problems = s.check(EDITOR)
    assert ("page n09_u03: the decision list column filter value_at_stake is a number_range, but value_at_stake holds STRING values; set the "
            "column's format to text so its filter fits its values") in problems
    (tmp_path / "fits").mkdir()
    s, _ws, _made = column_shell(tmp_path / "fits")
    assert not any("column filter" in p for p in s.check(EDITOR))


def test_the_check_names_a_column_filter_whose_choices_fail(tmp_path):
    from shell_db import QueryError

    class Failing(ColumnWorkspace):
        def answer(self, sql, params):
            if sql.startswith("SELECT v FROM") and "`priority_tier`" in sql and "return_lines" not in sql:
                raise QueryError("PERMISSION_DENIED")
            return super().answer(sql, params)

    s, _ws, _made = column_shell(tmp_path, ws=Failing())
    assert "page n09_u03: the decision list column filter priority_tier failed: PERMISSION_DENIED" in s.check(EDITOR)


def test_the_http_adapter_passes_column_and_table_filters_through(tmp_path, monkeypatch):
    pytest.importorskip("fastapi")
    from v141_app_shell_http_test import client
    c = client(tmp_path, monkeypatch)
    r = c.post("/api/records", json={"page": "n01_u05", "column_filters": {"region": ["North"]}})
    assert r.status_code == 400 and "the decision list has no column filter 'region'; its column filters: " in r.json()["error"]
    r = c.post("/api/page", json={"page": "n01_u05", "table_filters": {"worst": {}}})
    assert r.status_code == 400 and r.json()["error"] == "the page has no table 'worst'"


def test_every_column_filter_kind_renders_for_lakebase_on_the_list_the_money_and_an_extra_table():
    held = {shell_pg.uc_key(name): {"pg": f"app.{name.split('.')[-1]}", "columns": [{"name": c["name"], "type": c["type"], "type_text": c["type"]}
                                                                                   for c in columns]}
            for name, columns in (("main.shop.returns_out", LISTED + [{"name": "is_current", "type": "BOOLEAN"},
                                                                      {"name": "change_source", "type": "STRING"},
                                                                      {"name": "valid_from", "type": "TIMESTAMP"}]),
                                  ("main.shop.return_lines", [{"name": n, "type": t} for n, t in (
                                      ("as_of_date", "DATE"), ("event_date", "DATE"), ("channel", "STRING"), ("return_reason", "STRING"),
                                      ("category", "STRING"), ("loss_amount", "DOUBLE"))]))}
    page = with_table(returns_page())
    picked = {"priority_tier": ["Act now"], "value_at_stake": {"min": 100, "max": 5000}, "category": ["Books"]}
    money = {"table": "`main`.`shop`.`returns_out`", "join": "record_key", "money": ["CAST(`value_at_stake` AS DOUBLE) AS `_inspire_money`",
                                                                                     "CAST(NULL AS STRING) AS `_inspire_fx`"]}
    rendered = []
    for sql, params in (plan(page, picked)["rows"], plan(page, picked, context=money)["total"],
                        shell_sql.table_query(page, "worst", {}, {"event_date": {"from": "2026-01-01"}, "loss_amount": {"max": 50},
                                                                  "category": ["Toys"]})):
        text, values, _read = shell_pg.render(sql, params, held)
        rendered.append(text)
        assert all(isinstance(v, (str, float, datetime.date)) for v in values.values())
    assert 'CAST("priority_tier" AS TEXT) IN' in rendered[0] and 'CAST("value_at_stake" AS DOUBLE PRECISION) BETWEEN' in rendered[0]
    assert 'COALESCE("c"."_inspire_money", CAST("d"."value_at_stake" AS DOUBLE PRECISION))' in rendered[1]
    assert 'CAST("event_date" AS DATE) >=' in rendered[2] and 'CAST("loss_amount" AS DOUBLE PRECISION) <=' in rendered[2]


def lakebase_page():
    page = edit_page()
    page["records"] = dict(page["records"], column_filters=[{"column": "priority_tier"}, {"column": "value"}, {"column": "category"}])
    return page


def real_column_shell(postgres, tmp_path):
    def local(**kwargs):
        return psycopg.connect(host=postgres["host"], port=postgres["port"], dbname="postgres", user="inspire",
                               connect_timeout=kwargs["connect_timeout"], autocommit=kwargs["autocommit"])

    ws = CredentialWorkspace()
    settings = dict(MODIFY, options=dict(MODIFY["options"], decisions=True), backend=backend(True))
    return shell_core.Shell(app_dir(tmp_path, settings, [lakebase_page()]), env=dict(PG_ENV), sp_factory=lambda: ws, user_factory=lambda h, t: ws,
                            clock=lambda: datetime.datetime(2026, 10, 16, tzinfo=datetime.timezone.utc).timestamp(),
                            lakebase_factory=lambda b, env, service: shell_pg.Lakebase(b, env, service, connect=local), strict=True)


def test_on_lakebase_the_act_now_filter_and_the_loss_range_shrink_the_rows_and_the_total_to_the_matching_records(postgres, tmp_path):
    s = real_column_shell(postgres, tmp_path)
    assert s.lakebase is not None

    def listed(**columns):
        status, out = call(s, "POST", "records", body=dict({"page": "n01_u05", "filters": {}}, **({"column_filters": columns} if columns else {})))
        assert status == 200 and out["errors"] == {} and out["served"] == ["lakebase"], out
        return [r["entity_id"] for r in out["rows"]], out["total"], out["summary"]

    everything = listed()
    assert everything[:2] == (list(ITEMS), len(ITEMS))
    act_now = [n for n in ITEMS if item(n)["priority_tier"] == "Act now"]
    assert listed(priority_tier=["Act now"])[:2] == (act_now, len(act_now)) and 0 < len(act_now) < len(ITEMS)
    middle = [n for n in ITEMS if 110 <= float(item(n)["value"]) <= 135]
    assert listed(value={"min": 110, "max": 135})[:2] == (middle, len(middle)) and 0 < len(middle) < len(ITEMS)
    both = [n for n in act_now if float(item(n)["value"]) <= 130]
    assert listed(priority_tier=["Act now"], value={"max": 130})[:2] == (both, len(both))
    music = [n for n in ITEMS if item(n)["category"] == "Music"]
    narrowed = listed(category=["Music"])
    assert narrowed[:2] == (music, len(music)) and narrowed[2] == everything[2]
    status, meta = call(s, "GET", "filters", query={"page": "n01_u05"})
    offered = {f["column"]: f.get("options") for f in meta["columns"]["list"]}
    assert status == 200 and {k: offered[k] for k in ("priority_tier", "value", "category")} == {
        "priority_tier": ["Act now", "Monitor", "Review"], "value": None, "category": ["Books", "Games", "Music"]}
    assert offered["action_status"] == list(shell_sql.ACTION_STATUSES)
    fresh = listed(action_status=["New"])[1]
    assert 0 < fresh < len(ITEMS) and listed(action_status=[*shell_sql.ACTION_STATUSES, "Open"])[1] == len(ITEMS), \
        "every record without an action reads as New, so the statuses it holds together cover every record"
    status, found = call(s, "GET", "filters/options", query={"page": "n01_u05", "column": "category", "q": "us"})
    assert status == 200 and found["options"] == ["Music"]
    assert s.check({}) == []


def _app_prompt(ns, tmp_path, **outputs):
    from v140_implement_test import _app_flow
    inst, context, seen = _app_flow(ns, tmp_path, outputs=outputs or None)
    inst._implement_app(context, None)
    return seen["prompt"]


def test_the_app_guidance_tells_genie_a_table_carries_its_own_column_filters_and_a_table_ask_goes_on_that_table(agent_ns, tmp_path):
    prompt = _app_prompt(agent_ns, tmp_path, dashboard=False)
    rule = next(line for line in prompt.splitlines() if line.startswith("- Every column a table shows carries a filter in its column header"))
    assert "the user can sort and move each column" in rule and "takes its filter from the type of its values" in rule
    assert '{"column": "<column>", "off": true} turns that column\'s filter off, and "column_filters": false turns every filter' in rule
    assert "do either only when the user asks for it" in rule
    assert f'take "{shell_sql.COLUMN_FILTERS}": [{{"column": "<a column the table shows>"}}, ...]' in rule
    assert "type is optional; when you set it, it is the one the format gives: " + ", ".join(shell_sql.COLUMN_FILTER_TYPES[:2]) + " or " \
           + shell_sql.COLUMN_FILTER_TYPES[2] + "." in rule
    for fmt, kind in (("text column", "choice list"), ("number, integer, currency or percent column", "from and to range"),
                      ("date or month column", "date range")):
        assert fmt in rule and kind in rule
    assert {fmt for fmt in shell_sql.FORMAT_FILTERS} == {"text", "number", "integer", "currency", "percent", "date", "month"}
    assert ("When the user asks for a filter on a table, or to pick values in a table's column, show that column in the table and put it "
            "in that table's column_filters, never in the page filters") in rule
    assert "A filter on all of a table's columns is one entry for each column the table shows." in rule
    assert "never its detail" in rule and "dashboard" not in rule
    both = _app_prompt(agent_ns, tmp_path / "dash", dashboard=True)
    assert "the table shows; the dashboard draws each table without its column filters.\n" in both


@pytest.mark.parametrize("carried", [False, True])
def test_the_page_check_genie_runs_with_this_shell_refuses_a_filter_on_a_column_the_list_does_not_show(agent_ns, tmp_path, carried):
    if carried:
        files = agent_ns["implement_app_shell_payload"](agent_ns["inspire_notebook_asset"]("app_shell"))["files"]
    else:
        files = {}
        for name in ("shell_sql.py", "shell_facts.py"):
            with open(os.path.join(SERVER, name), encoding="utf-8") as handle:
                files[name] = handle.read()
    work = tmp_path / "work"
    agent_ns["implement_write_files"](str(work), agent_ns["implement_app_check_files"](files, False, []))
    for name, page, code in (("bad", returns_page(column_filters=[{"column": "confidence_level"}]), 1), ("good", returns_page(), 0)):
        (work / "page.json").write_text(json.dumps(page))
        done = subprocess.run([sys.executable, str(work / ".inspire_check" / "check_page.py")], cwd=str(tmp_path), capture_output=True, text=True,
                              timeout=60)
        assert done.returncode == code, (name, done.stdout, done.stderr)
        assert ("has a column filter on confidence_level, which it does not show" in done.stdout) is (name == "bad")
