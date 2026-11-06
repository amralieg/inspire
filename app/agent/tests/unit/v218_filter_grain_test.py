"""A page filter takes its values from, and applies to, the grain the page shows: a choice filter that names the records dataset
lists its values from the records alone, while it still narrows a detail dataset it names; a filter that names a detail dataset
(many rows per record, or rows no record holds) but not the records dataset, though the records carry that column, goes back to the
builder, as does a filter naming a dataset no part of the page reads. A filter on a column only a detail dataset has, used by detail
parts alone, stays, offline."""
import copy
import json
import os
import sys

import pytest

TESTS = os.path.dirname(os.path.abspath(__file__))
if TESTS not in sys.path:
    sys.path.insert(0, TESTS)

from v140_implement_test import _app_flow, _app_shell, _churn_page  # noqa: E402
from v141_app_shell_test import PAGE, SETTINGS, FakeWorkspace, app_dir  # noqa: E402
import shell_core  # noqa: E402

RESULT = "main.inspire.n01_u01_out"
BILLS = "main.utility.bills"
POINTS = "main.utility.service_points"
RECORDS_SQL = (f"SELECT o.record_key, o.entity_id, o.entity_label, o.priority_tier, o.`rank`, o.top_reasons, o.recommended_action, "
               f"o.value, o.value_at_stake, o.as_of_date, o.data_quality_flag, o.ai_cat_rule AS control_broken, b.bill_date, "
               f"date_trunc('MONTH', b.bill_date) AS bill_month, b.district, b.customer_segment, sp.service_type, sp.connection_status "
               f"FROM {RESULT} AS o LEFT JOIN {BILLS} AS b ON CAST(b.bill_id AS STRING) = o.entity_id LEFT JOIN {POINTS} AS sp "
               f"ON sp.service_point_id = b.service_point_id WHERE o.is_current AND o.change_source <> 'delete'")
DETAIL_SQL = (f"SELECT current_date() AS as_of_date, b.bill_date, date_trunc('MONTH', b.bill_date) AS bill_month, b.total_amount, "
              f"b.district, b.customer_segment, b.payment_channel, sp.service_type, sp.connection_status FROM {BILLS} AS b "
              f"LEFT JOIN {POINTS} AS sp ON sp.service_point_id = b.service_point_id")
SEGMENTS = ("district", "customer_segment", "service_type", "connection_status")
LIVE_FILTERS = ([{"id": "run_date", "type": "date_range", "label": "Run date", "grain": "month", "default": "12m",
                  "columns": {"bill_activity": "as_of_date", "records": "as_of_date"}},
                 {"id": "bill_date", "type": "date_range", "label": "Bill date", "grain": "month", "default": "12m",
                  "columns": {"bill_activity": "bill_date", "records": "bill_date"}}]
                + [{"id": c, "type": "multi_select", "label": c.replace("_", " ").title(),
                    "columns": {"bill_activity": c, "records": c}} for c in SEGMENTS])
RECORD_COLUMNS = ("record_key", "entity_id", "entity_label", "priority_tier", "rank", "value_at_stake", "as_of_date", "bill_date",
                  "district", "customer_segment", "service_type", "connection_status")


def _live_page(**changes):
    page = copy.deepcopy(PAGE)
    page["result_table"] = RESULT
    page["datasets"] = [{"name": "bill_activity", "sql": DETAIL_SQL}, {"name": "records", "sql": RECORDS_SQL}]
    for group in ("kpis", "charts"):
        for item in page[group]:
            item["dataset"] = "bill_activity" if item["dataset"] == "trend" else item["dataset"]
    page["records"]["columns"] = list(page["records"]["columns"]) + [{"column": "district", "label": "Billing district",
                                                                      "format": "text"}]
    page["filters"] = copy.deepcopy(LIVE_FILTERS)
    page.update(changes)
    return page


def _detail_only(page, ident):
    for f in page["filters"]:
        if f["id"] == ident:
            f["columns"] = {d: c for d, c in f["columns"].items() if d != "records"}
    return page


@pytest.fixture(scope="module")
def sql_module(agent_ns, tmp_path_factory):
    return _app_shell(agent_ns, tmp_path_factory.mktemp("filter_grain"))[1]["shell_sql"]


def _skipped(column, apart="bill_activity"):
    return (f"filter {column} reads its values from {apart}, which hold{'' if ', ' in apart else 's'} many rows per record or rows no record holds, while the "
            f"records dataset also has {column}: it offers values no record holds, is slow on many rows, and leaves the decision list "
            f"as it was; name {column} of the records dataset in this filter, so it lists its values from the records the page shows "
            "and narrows them too")


def test_the_live_page_shape_is_a_valid_page(sql_module):
    page = _live_page()
    assert sql_module.spec_problems(page) == []
    assert sql_module.filter_grain_problems(page, RECORD_COLUMNS) == []


@pytest.mark.parametrize("ident", SEGMENTS)
def test_a_choice_filter_on_the_live_shape_lists_its_values_from_the_records_alone(sql_module, ident):
    sql, params = sql_module.options_query(_live_page(), ident)
    assert BILLS in sql and "total_amount" not in sql and "payment_channel" not in sql, sql
    assert sql.count("SELECT DISTINCT") == 1 and f"CAST(`{ident}` AS STRING) AS v FROM ({RECORDS_SQL}) AS d" in sql
    assert params == []
    assert sql_module.filter_value_datasets(_live_page()["filters"][2]) == ["records"]


def test_the_filter_still_narrows_the_detail_dataset_it_names(sql_module):
    page = _live_page()
    trend = next(c for c in page["charts"] if c["dataset"] == "bill_activity")
    sql, params = sql_module.chart_query(page, trend["id"], {"district": ["D07"]})
    assert "CAST(`district` AS STRING) IN" in sql and DETAIL_SQL in sql and [p["value"] for p in params if p["value"] == "D07"] == ["D07"]


def test_a_date_range_keeps_its_bounds_across_every_dataset_it_names(sql_module):
    sql, _params = sql_module.bounds_query(_live_page(), "bill_date")
    assert DETAIL_SQL in sql and RECORDS_SQL in sql
    assert sql_module.filter_value_datasets(_live_page()["filters"][1]) == ["bill_activity", "records"]


@pytest.mark.parametrize("ident", SEGMENTS)
def test_a_filter_that_skips_the_records_the_records_carry_goes_back(sql_module, ident):
    page = _detail_only(_live_page(), ident)
    assert sql_module.spec_problems(page) == []
    assert sql_module.filter_grain_problems(page, RECORD_COLUMNS) == [_skipped(ident)]


def test_the_shown_records_columns_reach_the_check_offline(sql_module):
    page = _detail_only(_live_page(), "district")
    assert _skipped("district") in sql_module.quality_problems(page)
    assert [p for p in sql_module.quality_problems(_detail_only(_live_page(), "service_type")) if "reads its values from" in p] == [], \
        "offline the check knows only the columns the decision list shows; the live check reads them all"


def test_a_filter_on_a_column_only_the_detail_dataset_has_stays(sql_module):
    page = _live_page()
    page["filters"].append({"id": "payment_channel", "type": "multi_select", "label": "Payment channel",
                            "columns": {"bill_activity": "payment_channel"}})
    assert sql_module.spec_problems(page) == []
    assert sql_module.filter_grain_problems(page, RECORD_COLUMNS) == []
    sql, _params = sql_module.options_query(page, "payment_channel")
    assert f"FROM ({DETAIL_SQL}) AS d" in sql and RECORDS_SQL not in sql
    assert sql_module.filter_value_datasets(page["filters"][-1]) == ["bill_activity"]


def test_a_page_with_no_decision_list_keeps_its_detail_filters(sql_module):
    page = _detail_only(_live_page(), "district")
    page.pop("records")
    page["datasets"] = [d for d in page["datasets"] if d["name"] != "records"]
    page["kpis"] = [k for k in page["kpis"] if k["dataset"] != "records"]
    page["charts"] = [c for c in page["charts"] if c["dataset"] != "records"]
    for f in page["filters"]:
        f["columns"].pop("records", None)
    assert sql_module.filter_grain_problems(page, RECORD_COLUMNS) == []


def test_a_filter_naming_a_dataset_no_part_reads_goes_back(sql_module):
    page = _live_page()
    page["datasets"].append({"name": "spare", "sql": f"SELECT district FROM {BILLS}"})
    page["filters"][2]["columns"]["spare"] = "district"
    assert sql_module.filter_grain_problems(page, RECORD_COLUMNS) == [
        "filter district names dataset spare, which no KPI, chart, table or the decision list reads, so it reads values from rows "
        "the page does not show; name only the datasets of the parts it filters"]
    page["tables"] = [{"id": "spare_rows", "title": "Spare", "hint": "Rows.", "dataset": "spare",
                       "columns": [{"column": "district", "label": "District", "format": "text"}]}]
    assert sql_module.filter_grain_problems(page, RECORD_COLUMNS) == [], "a table reads it"


def test_a_scenario_model_dataset_counts_as_read(sql_module):
    page = _live_page()
    page["datasets"].append({"name": "levers", "sql": f"SELECT district FROM {BILLS}"})
    page["filters"][2]["columns"]["levers"] = "district"
    page["scenario"] = {"model": "levers"}
    assert sql_module.filter_grain_problems(page, RECORD_COLUMNS) == []


def test_a_detail_dataset_that_reads_the_records_through_many_rows_goes_back_with_the_many_side(agent_ns, sql_module):
    page = _live_page()
    reasons = f"{RESULT}_reasons"
    page["datasets"].append({"name": "reasons", "sql": f"SELECT r.reason, b.district FROM {reasons} AS r JOIN {RESULT} AS o ON "
                                                       f"o.record_key = r.record_key JOIN {BILLS} AS b ON CAST(b.bill_id AS STRING) = "
                                                       "o.entity_id"})
    page["charts"].append({"id": "by_reason", "title": "Reasons", "hint": "Most first.", "type": "bar", "dataset": "reasons",
                           "x": {"column": "reason", "kind": "category", "label": "Reason"},
                           "y": [{"label": "Reasons", "expression": "COUNT(DISTINCT reason)", "format": "number"}]})
    page["filters"][2]["columns"] = {"reasons": "district", "bill_activity": "district"}
    assert sql_module.filter_grain_problems(page, RECORD_COLUMNS) == [_skipped("district")]
    assert sql_module.filter_grain_problems(page, RECORD_COLUMNS, ["reasons"]) == [_skipped("district", "reasons, bill_activity")]
    many = agent_ns["implement_page_many_sides"](RESULT)
    problems = agent_ns["implement_app_page_problems"](page, sql_module, [RESULT, BILLS, POINTS, reasons], False, many=many)
    assert _skipped("district", "reasons, bill_activity") in problems


def test_the_page_build_sends_the_skipping_filter_back_and_keeps_the_shared_one(agent_ns, tmp_path):
    shared = _churn_page(agent_ns)
    inst, context, seen = _app_flow(agent_ns, tmp_path / "shared", page=shared)
    inst._implement_app(context, None)
    assert not [e for e in seen["errors"] if "reads its values from" in e]
    skipping = _churn_page(agent_ns)
    skipping["records"]["columns"] = list(skipping["records"]["columns"]) + [{"column": "region", "label": "Region",
                                                                              "format": "text"}]
    _detail_only(skipping, "region")
    inst, context, seen = _app_flow(agent_ns, tmp_path / "skipping", page=skipping)
    inst._implement_app(context, None)
    assert any(_skipped("region", "trend") in e for e in seen["errors"]), seen["errors"]


def test_the_build_brief_says_filter_values_come_from_the_records(agent_ns, tmp_path):
    inst, context, seen = _app_flow(agent_ns, tmp_path)
    inst._implement_app(context, None)
    assert ("A filter lists its values from the records dataset whenever it names it, so name the column of the records dataset in "
            "every filter on a column it has, even when a detail dataset with many rows per record or rows no record holds also "
            "carries that column; a filter on a column only a detail dataset has names only the datasets of the parts it filters, "
            "and no filter names a dataset no KPI, chart, table or the decision list reads.") in seen["prompt"]


class ColumnsWorkspace(FakeWorkspace):
    def run_sql(self, warehouse, sql, params, limit=5000):
        if sql.endswith("LIMIT 0") and RESULT in sql and "total_amount" not in sql:
            self.sql.append((sql, params, limit))
            return {"columns": [{"name": c, "type": "STRING"} for c in RECORD_COLUMNS], "rows": [], "truncated": False}
        return super().run_sql(warehouse, sql, params, limit)


def _live_check(tmp_path, page):
    ws = ColumnsWorkspace()
    tmp_path.mkdir(parents=True)
    settings = dict(SETTINGS, pages=[page["id"]])
    s = shell_core.Shell(app_dir(tmp_path, settings, [page]), env={"DATABRICKS_WAREHOUSE_ID": "wh1"}, sp_factory=lambda: ws,
                         user_factory=lambda h, t: ws)
    return s.checked({}), ws


def test_the_live_check_reads_every_records_column_and_tags_the_skipping_filter_a_design_problem(tmp_path):
    found, ws = _live_check(tmp_path / "skip", _detail_only(_live_page(), "service_type"))
    assert (shell_core.CHECK_DESIGN, f"page {PAGE['id']}: {_skipped('service_type')}") in found
    assert not [t for k, t in found if k == shell_core.CHECK_FAILED and "reads its values from" in t]
    found, ws = _live_check(tmp_path / "live", _live_page())
    assert not [t for _k, t in found if "reads its values from" in t or "no KPI, chart, table" in t]
    options = [sql for sql, _p, _l in ws.sql if sql.startswith("SELECT v FROM")]
    assert len(options) == len(SEGMENTS) and not [sql for sql in options if "total_amount" in sql], \
        "the choice filters list their values from the records, never from the detail dataset"
