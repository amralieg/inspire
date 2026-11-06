"""A page measure adds each record's value once. A chart, KPI or dataset that sums or averages a measure of the business output
table over a join to a table with many rows per record (the reasons view, the run log, an exploded list, or a source table the
Genie Agent tags as many rows per record) goes back to the builder; a distinct count, a pre-aggregated subquery, a measure of the
many-row table itself and a sum over the records dataset pass, offline."""
import json
import os
import sys

import pytest

pytest.importorskip("sqlglot")

TESTS = os.path.dirname(os.path.abspath(__file__))
if TESTS not in sys.path:
    sys.path.insert(0, TESTS)

from v140_implement_test import _app_shell, _churn_page, _output_context, _output_inspire  # noqa: E402

RESULT = "main.inspire.churn_out"
REASONS = f"{RESULT}_reasons"
RUN_LOG = f"{RESULT}_run_log"
ORDERS = "main.s.orders"
EVENTS = "main.s.events"
LIVE = (f"SELECT r.reason, o.ai_cat_rule AS rule_category, o.value_at_stake, o.priority_tier, o.as_of_date "
        f"FROM {REASONS} AS r JOIN {RESULT} AS o ON o.record_key = r.record_key WHERE r.is_current AND o.is_current")
FIX = ("add each record's value once, from the records dataset, from COUNT(DISTINCT record_key) for a count of records, or from a "
       f"subquery that first aggregates {REASONS} to one row per record, and read a measure of {REASONS} from it alone")


def _page(ns, sql=LIVE, expression="SUM(value_at_stake)", kpi=None):
    page = _churn_page(ns, result_table=RESULT)
    page["datasets"].append({"name": "reasons", "sql": sql})
    page["charts"].append({"id": "reason_pareto", "title": "Where the value sits", "hint": "Largest first.", "type": "pareto",
                           "dataset": "reasons", "x": {"column": "rule_category", "kind": "category", "label": "Rule"},
                           "y": [{"label": "Value at stake", "expression": expression, "format": "currency", "currency": "USD"}],
                           "limit": 25})
    if kpi:
        page["kpis"].append({"id": "reason_value", "label": "Value behind reasons", "dataset": "reasons", "expression": kpi,
                             "format": "currency"})
    return page


def _fanned(ns, page, many=None, real=None):
    return ns["implement_page_fanout_problems"](page, RESULT, [REASONS, RUN_LOG] if many is None else many, real)


def test_the_live_reasons_join_sum_goes_back_to_the_builder(agent_ns):
    assert _fanned(agent_ns, _page(agent_ns)) == [
        f"chart reason_pareto measure 1 adds up value_at_stake of the business output table {RESULT} over dataset reasons, which "
        f"joins it to {REASONS}, many rows per record, so each record's value is counted once per row: {FIX}"]


def test_the_page_checker_sends_it_back_with_its_other_problems(agent_ns, tmp_path):
    shell_sql = _app_shell(agent_ns, tmp_path)[1]["shell_sql"]
    allowed = [RESULT, ORDERS, REASONS]
    problems = agent_ns["implement_app_page_problems"](_page(agent_ns), shell_sql, allowed, False)
    assert [p for p in problems if " adds up " in p] == _fanned(agent_ns, _page(agent_ns))
    fixed = _page(agent_ns, expression="COUNT(DISTINCT record_key)",
                  sql=LIVE.replace("o.value_at_stake,", "o.value_at_stake, o.record_key,"))
    assert [p for p in agent_ns["implement_app_page_problems"](fixed, shell_sql, allowed, False) if " adds up " in p] == []
    assert [p for p in agent_ns["implement_app_page_problems"](_page(agent_ns), shell_sql, allowed, False, many=[]) if " adds up " in p] == []


@pytest.mark.parametrize("kpi", ["SUM(value_at_stake)", "AVG(value_at_stake)", "ROUND(SUM(value_at_stake) / 1000, 1)",
                                 "SUM(CASE WHEN priority_tier = 'Act now' THEN value_at_stake END)"])
def test_a_kpi_that_sums_or_averages_a_record_measure_over_the_reasons_join_goes_back(agent_ns, kpi):
    page = _page(agent_ns, expression="COUNT(*)", kpi=kpi)
    assert [p.split(" adds up ")[0] for p in _fanned(agent_ns, page)] == ["KPI reason_value"]


@pytest.mark.parametrize("sql,expression", [
    (LIVE.replace("o.value_at_stake,", "o.value_at_stake, o.record_key AS record_key,"), "COUNT(DISTINCT record_key)"),
    (LIVE, "COUNT(*)"),
    (f"SELECT r.rule_category, SUM(o.value_at_stake) AS value_at_stake FROM {RESULT} AS o JOIN (SELECT record_key, "
     f"MAX(reason) AS rule_category FROM {REASONS} WHERE is_current GROUP BY record_key) AS r ON o.record_key = r.record_key "
     "WHERE o.is_current GROUP BY r.rule_category", "SUM(value_at_stake)"),
    (f"SELECT o.ai_cat_rule AS rule_category, o.record_key, o.value_at_stake FROM {RESULT} AS o WHERE o.is_current AND EXISTS "
     f"(SELECT 1 FROM {REASONS} AS r WHERE r.record_key = o.record_key)", "SUM(value_at_stake)"),
    (f"SELECT r.reason AS rule_category, r.reason_position, o.priority_tier FROM {REASONS} AS r JOIN {RESULT} AS o "
     "ON o.record_key = r.record_key", "SUM(reason_position)"),
    (f"SELECT DISTINCT o.record_key, o.ai_cat_rule AS rule_category, o.value_at_stake FROM {RESULT} AS o JOIN {REASONS} AS r "
     "ON o.record_key = r.record_key WHERE r.reason LIKE '%late%'", "SUM(value_at_stake)"),
    (f"SELECT o.record_key, o.ai_cat_rule AS rule_category, o.value_at_stake, COUNT(*) AS reasons FROM {RESULT} AS o JOIN "
     f"{REASONS} AS r ON o.record_key = r.record_key GROUP BY o.record_key, o.ai_cat_rule, o.value_at_stake", "SUM(value_at_stake)"),
    (f"SELECT o.ai_cat_rule AS rule_category, o.value_at_stake FROM {RESULT} AS o LEFT SEMI JOIN {REASONS} AS r "
     "ON o.record_key = r.record_key", "SUM(value_at_stake)"),
    (f"SELECT ai_cat_rule AS rule_category, value_at_stake FROM {RESULT} WHERE is_current", "SUM(value_at_stake)"),
])
def test_sums_that_add_each_record_once_pass(agent_ns, sql, expression):
    assert _fanned(agent_ns, _page(agent_ns, sql=sql, expression=expression)) == []


def test_a_sum_over_the_records_dataset_passes(agent_ns):
    page = _page(agent_ns, expression="COUNT(*)")
    assert [c["y"][0]["expression"] for c in page["charts"] if c["dataset"] == "records"] == ["SUM(value)"]
    assert _fanned(agent_ns, page) == []
    assert agent_ns["implement_page_fanning"](page, [REASONS, RUN_LOG]) == {"reasons": LIVE}


@pytest.mark.parametrize("sql", [
    f"SELECT * FROM (SELECT o.ai_cat_rule AS rule_category, o.value_at_stake FROM {RESULT} o JOIN {REASONS} r "
    "ON o.record_key = r.record_key) AS d",
    f"WITH j AS (SELECT o.ai_cat_rule AS rule_category, o.value_at_stake AS value_at_stake FROM {RESULT} o JOIN {REASONS} r "
    "ON o.record_key = r.record_key) SELECT rule_category, value_at_stake FROM j",
    f"SELECT o.ai_cat_rule AS rule_category, o.value_at_stake FROM {REASONS} r INNER JOIN `main`.`inspire`.`churn_out` o "
    "ON o.record_key = r.record_key",
    f"SELECT o.ai_cat_rule AS rule_category, o.value_at_stake, r.reason FROM {RESULT} o JOIN {REASONS} r "
    "ON o.record_key = r.record_key GROUP BY o.ai_cat_rule, o.value_at_stake, r.reason",
    f"SELECT o.ai_cat_rule AS rule_category, o.value_at_stake * 1.0 AS value_at_stake FROM {RESULT} o, {REASONS} r "
    "WHERE o.record_key = r.record_key",
])
def test_a_record_measure_carried_through_a_reasons_join_goes_back(agent_ns, sql):
    problems = _fanned(agent_ns, _page(agent_ns, sql=sql))
    assert len(problems) == 1 and problems[0].startswith("chart reason_pareto measure 1 adds up value_at_stake "), problems


def test_a_dataset_that_sums_over_the_reasons_join_itself_goes_back(agent_ns):
    sql = (f"SELECT o.ai_cat_rule AS rule_category, SUM(o.value_at_stake) AS value_at_stake FROM {RESULT} o JOIN {REASONS} r "
           "ON o.record_key = r.record_key GROUP BY 1")
    assert [p.split(" adds up ")[0] for p in _fanned(agent_ns, _page(agent_ns, sql=sql))] == ["dataset reasons"]


@pytest.mark.parametrize("sql,fans", [
    (LIVE + " AND r.reason_position = 1", False),
    (LIVE.replace("WHERE r.is_current", "WHERE r.is_current = TRUE") + " AND 1 = reason_position", False),
    (LIVE.replace("ON o.record_key = r.record_key", "ON o.record_key = r.record_key AND r.reason_position = 1"), False),
    (LIVE.replace("WHERE r.is_current AND", "WHERE") + " AND r.reason_position = 1", True),
    (LIVE + " AND r.reason_position <= 2", True),
    (LIVE + " OR r.reason_position = 1", True),
])
def test_a_join_pinned_to_each_current_record_first_reason_adds_each_record_once(agent_ns, sql, fans):
    assert bool(_fanned(agent_ns, _page(agent_ns, sql=sql))) is fans


def test_the_run_log_and_an_exploded_list_fan_out_too(agent_ns):
    logged = (f"SELECT o.ai_cat_rule AS rule_category, o.value_at_stake FROM {RESULT} o JOIN {RUN_LOG} l "
              "ON l.record_key = o.record_key")
    assert [p.split(", many rows")[0].split("joins it to ")[1] for p in _fanned(agent_ns, _page(agent_ns, sql=logged))] == [RUN_LOG]
    for sql in (f"SELECT o.ai_cat_rule AS rule_category, o.value_at_stake, r.reason FROM {RESULT} o "
                "LATERAL VIEW POSEXPLODE(o.top_reasons) r AS pos, reason",
                f"SELECT ai_cat_rule AS rule_category, value_at_stake, explode(top_reasons) AS reason FROM {RESULT} o"):
        problems = _fanned(agent_ns, _page(agent_ns, sql=sql))
        assert len(problems) == 1 and "top_reasons" in problems[0].split("joins it to ")[1], problems
    collapsed = (f"SELECT o.record_key, o.ai_cat_rule AS rule_category, o.value_at_stake FROM {RESULT} o "
                 "LATERAL VIEW EXPLODE(o.top_reasons) r AS reason GROUP BY o.record_key, o.ai_cat_rule, o.value_at_stake")
    assert _fanned(agent_ns, _page(agent_ns, sql=collapsed)) == []


def test_unqualified_columns_and_a_star_resolve_with_the_table_columns(agent_ns):
    real = {RESULT: {"record_key", "ai_cat_rule", "value_at_stake"}, REASONS: {"record_key", "reason", "reason_position"}}
    plain = f"SELECT ai_cat_rule AS rule_category, value_at_stake, reason FROM {RESULT} o JOIN {REASONS} r USING (record_key)"
    assert _fanned(agent_ns, _page(agent_ns, sql=plain)) == [], "without the columns an unqualified name is not guessed"
    assert len(_fanned(agent_ns, _page(agent_ns, sql=plain), real=real)) == 1
    star = f"SELECT o.*, r.reason FROM {RESULT} o JOIN {REASONS} r ON o.record_key = r.record_key"
    assert len(_fanned(agent_ns, _page(agent_ns, sql=star), real=real)) == 1
    own = f"SELECT reason AS rule_category, reason_position FROM {RESULT} o JOIN {REASONS} r USING (record_key)"
    assert _fanned(agent_ns, _page(agent_ns, sql=own, expression="SUM(reason_position)"), real=real) == []


def test_a_source_table_the_genie_agent_tags_as_many_rows_per_record_fans_out(agent_ns):
    space = {"instructions": {"join_specs": [{"left": {"identifier": RESULT}, "right": {"identifier": EVENTS},
                                              "sql": ["`o`.`entity_id` = `i`.`customer_id`", "--rt=FROM_RELATIONSHIP_TYPE_ONE_TO_MANY--"]}]}}
    many = agent_ns["implement_page_many_sides"](RESULT, {"genie_space": {"serialized_space": space}})
    assert many == [REASONS, RUN_LOG, EVENTS]
    assert agent_ns["implement_page_many_sides"](RESULT, {}) == [REASONS, RUN_LOG]
    assert agent_ns["implement_page_many_sides"](RESULT, {"genie_space": {"serialized_space": "{}"}}) == [REASONS, RUN_LOG]
    sql = (f"SELECT i.status AS rule_category, o.value_at_stake FROM {RESULT} o JOIN {EVENTS} i ON o.entity_id = i.customer_id")
    assert len(_fanned(agent_ns, _page(agent_ns, sql=sql), many=many)) == 1
    assert _fanned(agent_ns, _page(agent_ns, sql=sql)) == [], "an untagged source table is not assumed to fan out"


def test_the_genie_check_now_follows_a_measure_through_a_subquery(agent_ns):
    sql = (f"SELECT cause, SUM(expected_count) FROM (SELECT i.cause, o.expected_count FROM {RESULT} o JOIN {EVENTS} i "
           "ON o.entity_id = i.entity_key) AS d GROUP BY cause")
    space = {"instructions": {"example_question_sqls": [{"question": ["Why?"], "sql": [sql]}]}}
    assert agent_ns["implement_genie_fanout_problems"](space, RESULT, [EVENTS], {}) == [
        f"the example SQL for 'Why?' adds up expected_count of the business output table {RESULT} over a join to {EVENTS}, which "
        f"holds many rows per entity, so each entity's value is counted once per matched row: aggregate {EVENTS} to one row per "
        "entity in a subquery first, then join that and add each entity's value once"]


def test_the_page_build_loads_the_parser_reads_the_columns_and_sends_the_sum_back(agent_ns, tmp_path):
    inst, _calls = _output_inspire(agent_ns, tmp_path)
    loaded, read = [], []
    inst._require_asset_package = lambda module, purpose: loaded.append((module, purpose))
    inst._implement_space_columns = lambda tables: read.append(list(tables)) or {
        t.lower(): [("record_key", "string", ""), ("value_at_stake", "double", "")] for t in tables}
    shell_sql = _app_shell(agent_ns, tmp_path)[1]["shell_sql"]
    context = dict(_output_context(agent_ns), allowed=[RESULT, ORDERS, REASONS], asset_status={})
    work = tmp_path / "work"
    work.mkdir()
    (work / agent_ns["IMPLEMENT_APP_PAGE_FILE"]).write_text(json.dumps(_page(agent_ns)))
    with pytest.raises(RuntimeError) as raised:
        inst._implement_page_file(context, "app", str(work), shell_sql, False)
    assert _fanned(agent_ns, _page(agent_ns))[0] in str(raised.value)
    assert loaded == [("sqlglot", "The page's check of sums over many-row joins")] and read == [[RESULT], [REASONS]]
    assert inst._implement_page_columns(RESULT, [REASONS], {}) == {}


def test_the_build_brief_says_a_record_measure_is_never_summed_over_the_reasons_view(agent_ns, tmp_path):
    inst, _calls = _output_inspire(agent_ns, tmp_path)
    context = dict(_output_context(agent_ns), reasons_view=REASONS)
    assert ("A record repeats once per reason here, so never SUM or AVG a per-record measure such as value_at_stake over this view "
            "or a join to it, and never count records there with COUNT(*) or COUNT of a per-record column: Inspire rejects both; "
            "add each record's value once from the records dataset, or count records with "
            "COUNT(DISTINCT record_key).") in inst._implement_use_case_brief(context)
