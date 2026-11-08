"""A count of records reads one row per record. COUNT(*) or COUNT of a result column over a join to a table with many rows per
record counts each record once per matched row, so the Genie and page checks send it back; COUNT(DISTINCT record_key), a count
per record, a count after a subquery that collapses the many side, and a first-reason join stay. The Genie space and the
in-app agent carry the page's record counts, so a Genie count agrees with the page KPI."""
import copy
import json
import os
import sys

import pytest

TESTS = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(os.path.dirname(os.path.dirname(TESTS)), "agent", "app_shell", "server")
for folder in (SERVER, TESTS):
    if folder not in sys.path:
        sys.path.insert(0, folder)

import shell_agent  # noqa: E402
from v211_genie_agent_test import AgentWorkspace, FakeLLM, agent_shell, ask, said, tool_call, topic_of  # noqa: E402

RESULT = "main.ops.bill_out"
REASONS = f"{RESULT}_reasons"
SOURCE = "main.src.bills"
COLUMNS = {RESULT: ["record_key", "valid_from", "entity_id", "priority_tier", "value", "value_at_stake", "is_current",
                    "change_source", "segment_or_item"],
           REASONS: ["record_key", "valid_from", "entity_id", "reason_position", "reason", "is_current"],
           SOURCE: ["bill_id", "district"]}
REAL = {t.lower(): {c: (c, "string", "") for c in cols} for t, cols in COLUMNS.items()}
CURRENT = "o.is_current AND o.change_source <> 'delete'"
JOIN = f"FROM {RESULT} o JOIN {REASONS} r ON r.record_key = o.record_key AND r.valid_from = o.valid_from"

FLAGGED = {
    "count star over the reasons join": f"SELECT COUNT(*) AS failed_bills, SUM(r.reason_position) AS n {JOIN} WHERE {CURRENT}",
    "count one over the reasons join": f"SELECT COUNT(1) AS bills {JOIN} WHERE {CURRENT} AND o.value > 0",
    "count of a result column": f"SELECT COUNT(o.record_key) AS bills {JOIN} WHERE {CURRENT}",
    "count_if of a result column": f"SELECT COUNT_IF(o.value > 0) AS failed_bills {JOIN} WHERE {CURRENT}",
    "count of a case over a result column": f"SELECT COUNT(CASE WHEN o.value > 0 THEN 1 END) AS failed {JOIN} WHERE {CURRENT}",
    "count_if over a reasons-grain subquery": (f"SELECT COUNT_IF(d.value > 0) AS failed FROM (SELECT r.reason, o.value {JOIN} "
                                               f"WHERE {CURRENT}) AS d"),
    "count star by a result column": f"SELECT o.priority_tier, COUNT(*) AS bills {JOIN} WHERE {CURRENT} GROUP BY o.priority_tier",
    "count star over a fanned subquery": (f"SELECT COUNT(*) AS bills FROM (SELECT o.record_key, o.value {JOIN} "
                                          f"WHERE {CURRENT}) AS d WHERE d.value > 0"),
    "count star over a fanned cte": (f"WITH j AS (SELECT o.* {JOIN} WHERE {CURRENT}) "
                                     "SELECT COUNT(*) AS bills FROM j WHERE j.value > 0"),
    "count star over an exploded array": (f"SELECT COUNT(*) AS bills FROM {RESULT} o LATERAL VIEW explode(o.top_reasons) t AS reason "
                                          f"WHERE {CURRENT}"),
}
KEPT = {
    "count distinct of the record key": f"SELECT COUNT(DISTINCT o.record_key) AS bills {JOIN} WHERE {CURRENT}",
    "count of the result alone": f"SELECT COUNT(*) AS bills, COUNT_IF(value > 0) AS failed FROM {RESULT} WHERE is_current",
    "count of the reasons rows": f"SELECT COUNT(r.reason) AS reasons {JOIN} WHERE {CURRENT}",
    "count of bills per reason": f"SELECT r.reason, COUNT(*) AS bills {JOIN} WHERE {CURRENT} GROUP BY r.reason",
    "count of bills per positional reason": f"SELECT r.reason, COUNT_IF(o.value > 0) AS failed {JOIN} WHERE {CURRENT} GROUP BY 1",
    "count over a reasons-grain subquery": (f"SELECT COUNT(*) AS reasons FROM (SELECT r.reason, o.value {JOIN} WHERE {CURRENT}) AS d"),
    "count per record": f"SELECT o.record_key, COUNT(*) AS reasons {JOIN} WHERE {CURRENT} GROUP BY o.record_key",
    "count per entity": f"SELECT o.entity_id, COUNT(o.value) AS reasons {JOIN} WHERE {CURRENT} GROUP BY o.entity_id",
    "first reason only": (f"SELECT r.reason, COUNT(*) AS bills {JOIN} AND r.reason_position = 1 AND r.is_current WHERE {CURRENT} "
                          "GROUP BY r.reason"),
    "count after the many side collapses": (f"SELECT COUNT(*) AS bills, COUNT_IF(o.value > 0) AS failed FROM {RESULT} o JOIN "
                                            f"(SELECT record_key, COUNT(*) AS reasons FROM {REASONS} GROUP BY record_key) AS c "
                                            f"ON c.record_key = o.record_key WHERE {CURRENT}"),
    "count after a distinct subquery": (f"SELECT COUNT(*) AS bills FROM (SELECT DISTINCT o.record_key {JOIN} WHERE {CURRENT}) AS d"),
    "count over a one-row-per-bill source": (f"SELECT COUNT(*) AS bills FROM {RESULT} o LEFT JOIN {SOURCE} b "
                                             f"ON CAST(b.bill_id AS STRING) = o.entity_id WHERE {CURRENT}"),
    "the live district example": (f"SELECT COALESCE(NULLIF(segment_or_item, ''), 'Unknown district') AS district, COUNT_IF(value > 0) "
                                  f"AS exception_bills, ROUND(SUM(value_at_stake), 2) AS usd FROM {RESULT} WHERE is_current AND "
                                  "change_source <> 'delete' GROUP BY 1 HAVING COUNT_IF(value > 0) > 0 ORDER BY usd DESC"),
}


def _counted(ns, sql):
    out = ns["implement_fanout_sums"](sql, RESULT, [REASONS], REAL)
    assert len(out) == 3, "the shared parser returns what it summed, the many-side tables, and what it counted"
    return out[2], out[1]


@pytest.mark.parametrize("name", sorted(FLAGGED))
def test_a_record_count_over_a_many_row_join_is_flagged(agent_ns, name):
    counted, spread = _counted(agent_ns, FLAGGED[name])
    assert counted, f"{name} counts each record once per matched row"
    assert spread


@pytest.mark.parametrize("name", sorted(KEPT))
def test_a_count_at_the_record_grain_is_not_flagged(agent_ns, name):
    counted, _spread = _counted(agent_ns, KEPT[name])
    assert counted == [], f"{name} counts each record once"


def test_the_sum_check_still_reports_sums_and_not_counts(agent_ns):
    summed, _spread, counted = agent_ns["implement_fanout_sums"](f"SELECT SUM(o.value_at_stake) AS usd {JOIN}", RESULT, [REASONS], REAL)
    assert summed == ["value_at_stake"] and counted == []
    summed, _spread, counted = agent_ns["implement_fanout_sums"](f"SELECT SUM(DISTINCT o.value_at_stake) AS usd {JOIN}", RESULT,
                                                                 [REASONS], REAL)
    assert summed == ["value_at_stake"] and counted == [], "a distinct sum still drops equal values, so it still goes back"
    assert agent_ns["implement_fanout_sums"]("SELECT (", RESULT, [REASONS], REAL) == ([], [], [])


def _genie_space(sql, benchmark=False):
    pair = [("How many failed bills are in the latest run?", sql)]
    return {"instructions": {"example_question_sqls": [] if benchmark else [{"question": [q], "sql": [s]} for q, s in pair]},
            "benchmarks": {"questions": [{"question": [q], "answer": [{"format": "SQL", "content": [s]}]} for q, s in pair]
                           if benchmark else []}}


@pytest.mark.parametrize("benchmark", [False, True])
def test_the_genie_check_sends_a_fanned_count_back_with_the_distinct_count(agent_ns, benchmark):
    problems = agent_ns["implement_genie_fanout_problems"](_genie_space(FLAGGED["count star over the reasons join"], benchmark),
                                                           RESULT, [REASONS], REAL)
    counts = [p for p in problems if " counts COUNT(*) " in p]
    assert len(counts) == 1 and "COUNT(DISTINCT record_key)" in counts[0] and REASONS in counts[0]
    assert ("benchmark SQL" if benchmark else "example SQL") in counts[0]
    assert any(" adds up reason_position " in p for p in problems) is False


@pytest.mark.parametrize("name", sorted(KEPT))
def test_the_genie_check_keeps_counts_at_the_record_grain(agent_ns, name):
    assert agent_ns["implement_genie_fanout_problems"](_genie_space(KEPT[name]), RESULT, [REASONS], REAL) == []


def _page(expression, dataset_sql):
    return {"id": "n01_u01", "datasets": [{"name": "records", "sql": f"SELECT o.record_key, o.value FROM {RESULT} o WHERE o.is_current"},
                                          {"name": "causes", "sql": dataset_sql}],
            "kpis": [{"id": "failed", "label": "Bills failing controls", "dataset": "causes", "expression": expression}],
            "charts": [{"id": "c1", "dataset": "causes", "y": [{"expression": expression}]}]}


FANNED_DATASET = f"SELECT o.record_key, o.value {JOIN} WHERE {CURRENT}"
REASONS_DATASET = f"SELECT r.reason, o.record_key, o.value {JOIN} WHERE {CURRENT}"


@pytest.mark.parametrize("expression", ["COUNT(*)", "COUNT(record_key)", "COUNT_IF(value > 0)", "SUM(CASE WHEN value > 0 THEN 1 END)"])
def test_the_page_check_sends_a_fanned_kpi_count_back(agent_ns, expression):
    problems = agent_ns["implement_page_fanout_problems"](_page(expression, FANNED_DATASET), RESULT, [REASONS], REAL)
    assert any(p.startswith("KPI failed ") for p in problems) and any(p.startswith("chart c1 measure 1 ") for p in problems)
    if not expression.startswith("SUM"):
        assert all(" counts " in p and "COUNT(DISTINCT record_key)" in p for p in problems)


@pytest.mark.parametrize("expression", ["COUNT(DISTINCT record_key)", "COUNT(DISTINCT CASE WHEN value > 0 THEN record_key END)"])
def test_the_page_check_keeps_a_distinct_record_count(agent_ns, expression):
    assert agent_ns["implement_page_fanout_problems"](_page(expression, FANNED_DATASET), RESULT, [REASONS], REAL) == []


def test_a_count_of_a_record_column_over_a_reasons_grain_dataset_goes_back_and_a_row_count_stays(agent_ns):
    flagged = agent_ns["implement_page_fanout_problems"](_page("COUNT_IF(value > 0)", REASONS_DATASET), RESULT, [REASONS], REAL)
    assert [p.split(" counts ")[0] for p in flagged] == ["KPI failed", "chart c1 measure 1"]
    assert agent_ns["implement_page_fanout_problems"](_page("COUNT(*)", REASONS_DATASET), RESULT, [REASONS], REAL) == []
    assert agent_ns["implement_page_fanout_problems"](_page("COUNT(DISTINCT record_key)", REASONS_DATASET), RESULT, [REASONS], REAL) == []


def test_the_page_check_keeps_a_count_over_a_first_reason_dataset(agent_ns):
    first = f"{JOIN} AND r.reason_position = 1 AND r.is_current WHERE {CURRENT}"
    page = _page("COUNT(*)", f"SELECT o.record_key, o.value, r.reason {first}")
    assert agent_ns["implement_page_fanout_problems"](page, RESULT, [REASONS], REAL) == []


def test_a_fanned_dataset_with_its_own_count_is_reported_once(agent_ns):
    page = _page("COUNT(*)", f"SELECT o.priority_tier, COUNT(*) AS bills {JOIN} WHERE {CURRENT} GROUP BY o.priority_tier")
    problems = agent_ns["implement_page_fanout_problems"](page, RESULT, [REASONS], REAL)
    assert [p.split(" counts ")[0] for p in problems] == ["dataset causes"]


def test_the_grain_instruction_says_how_to_count_entities(agent_ns):
    fact = agent_ns["implement_genie_grain_fact"](RESULT, [REASONS])
    assert f"never SUM or AVG a measure of `{RESULT}` over that join" in fact
    assert f"never COUNT(*) or COUNT a column of `{RESULT}` over that join" in fact and "COUNT(DISTINCT `record_key`)" in fact


KPI_PAGE = {"id": "n01_u01", "result_table": RESULT,
            "datasets": [{"name": "records", "sql": f"SELECT record_key, value, value_at_stake FROM {RESULT} WHERE is_current"}],
            "kpis": [{"id": "failed", "label": "Bills failing controls", "dataset": "records", "expression": "COUNT_IF(value > 0)"},
                     {"id": "leak", "label": "Revenue leakage", "dataset": "records", "expression": "SUM(value_at_stake)"}]}


def _kpi_text(ns, page):
    space, _changed = ns["implement_genie_page_kpis"]({"instructions": {}}, "N01-U01", page)
    return "".join(space["instructions"]["text_instructions"][0]["content"])


def test_the_genie_kpi_block_carries_the_record_count_definition(agent_ns):
    text = _kpi_text(agent_ns, KPI_PAGE)
    assert "When asked for Bills failing controls, use exactly: SELECT COUNT_IF(value > 0) AS value FROM (" in text
    assert f"COUNT(DISTINCT record_key) of the current rows of `{RESULT}`, never COUNT(*) over a join" in text
    assert "such as the failed, flagged or queued ones, takes that KPI's query, never this count" in text
    assert text.index("Revenue leakage") < text.index("When asked how many records there are")
    assert "\n\n" not in text, "the KPI block stays one block, so a rebuild finds and replaces it whole"
    again, changed = agent_ns["implement_genie_page_kpis"]({"instructions": {"text_instructions": [
        {"id": "a" * 32, "content": text.splitlines(keepends=True)}]}}, "N01-U01", KPI_PAGE)
    assert not changed


def test_a_page_without_a_result_table_gets_no_record_count_line(agent_ns):
    page = dict(copy.deepcopy(KPI_PAGE), result_table=None)
    assert "When asked how many records there are" not in _kpi_text(agent_ns, page)


def test_the_agent_context_carries_the_page_kpis_at_the_persons_filters(tmp_path):
    llm = FakeLLM([said("The page shows 120 items on the list.")], related=topic_of)
    s, ws, _made = agent_shell(tmp_path, ws=AgentWorkspace(llm=llm))
    turn = ask(s, "How many failed items are on the list?", view={"filters": {"region": ["East"]}})
    assert turn["state"] == "done" and turn["steps"] == [] and ws.genie == []
    context = json.loads(llm.main_calls()[0]["messages"][1]["content"].split("<data>\n", 1)[1].rsplit("\n</data>", 1)[0])
    numbers = {k["id"]: k for k in context["key_numbers"]}
    assert {k: v for k, v in numbers["items"].items() if k != "scope"} == {"id": "items", "label": "Items on the list", "format": "integer",
                                                                          "value": 120.0}
    assert "East" in numbers["items"]["scope"], "each KPI states the rows it counts"
    assert {"total_loss", "loss_rate"} <= set(numbers)
    kpi_sql = [(sql, params) for sql, params, _limit in ws.sql if "'now' AS period" in sql and "COUNT(*) AS value" in sql]
    assert kpi_sql and "East" in json.dumps(kpi_sql[-1][1]), "the KPI is read at the person's filters, as the page shows it"


def test_a_bad_view_filter_reads_the_kpis_at_the_page_defaults(tmp_path):
    llm = FakeLLM([said("Here.")], related=topic_of)
    s, ws, _made = agent_shell(tmp_path, ws=AgentWorkspace(llm=llm))
    ask(s, "How many items?", view={"filters": {"no_such_filter": ["x"]}})
    context = llm.main_calls()[0]["messages"][1]["content"]
    assert '"key_numbers":[' in context and '"value":120.0' in context


def test_a_kpi_that_fails_to_read_says_why_and_the_turn_still_answers(tmp_path):
    llm = FakeLLM([said("Here.")], related=topic_of)
    ws = AgentWorkspace(llm=llm)
    reads = ws.run_sql

    def failing(warehouse, sql, params, limit=5000):
        if "'now' AS period" in sql:
            raise shell_agent.QueryError("warehouse stopped")
        return reads(warehouse, sql, params, limit)

    ws.run_sql = failing
    s, _ws, _made = agent_shell(tmp_path, ws=ws)
    turn = ask(s, "How many items?")
    assert turn["state"] == "done"
    numbers = json.loads(llm.main_calls()[0]["messages"][1]["content"].split("<data>\n", 1)[1].rsplit("\n</data>", 1)[0])["key_numbers"]
    assert numbers and all("value" not in k and "warehouse stopped" in k["error"] for k in numbers)


def test_the_agent_is_told_to_keep_the_persons_qualifiers_when_it_asks_genie(tmp_path):
    assert "keep every word of the person's question that narrows it, such as failed" in shell_agent.SYSTEM
    assert "key_numbers are the page's KPIs at the person's filters" in shell_agent.SYSTEM
    assert "Keep every word of the person's question that narrows it." in shell_agent.TOOLS["ask_genie"]["description"]
    llm = FakeLLM([tool_call("ask_genie", {"question": "How many failed items are on the list?"}), said("5 failed.")], related=topic_of)
    s, ws, _made = agent_shell(tmp_path, ws=AgentWorkspace(llm=llm))
    ask(s, "How many failed items are on the list?")
    assert "key_numbers are the page's KPIs" in llm.main_calls()[0]["messages"][0]["content"]
    assert ws.genie[0][1] == "How many failed items are on the list?"
