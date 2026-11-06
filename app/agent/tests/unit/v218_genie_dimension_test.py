"""A page KPI split by one of the page's filters gives the numbers the page shows. The Genie space tells Genie to split each KPI
by the page's filter columns from the KPI's own query, never by re-joining another table, and to take a KPI's query for its
records named in other words; the in-app agent splits a KPI with split_kpi, which reads the page's own dataset at the person's
filters, instead of asking Genie. Offline."""
import copy
import json
import os
import re
import sqlite3
import sys

import pytest

TESTS = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(os.path.dirname(os.path.dirname(TESTS)), "agent", "app_shell", "server")
for folder in (SERVER, TESTS):
    if folder not in sys.path:
        sys.path.insert(0, folder)

import shell_agent  # noqa: E402
import shell_sql  # noqa: E402
from v211_genie_agent_test import AgentWorkspace, FakeLLM, agent_shell, ask, said, tool_call, topic_of  # noqa: E402

RESULT = "main.billing.bills_out"
RECORDS_SQL = ("SELECT o.record_key, o.value, o.value_at_stake, o.priority_tier, o.as_of_date, b.district, b.region "
               f"FROM {RESULT} AS o JOIN main.billing.bills AS b ON b.bill_id = o.entity_id "
               "WHERE o.is_current AND o.change_source <> 'delete'")
PAGE = {"id": "n01_u01", "result_table": RESULT,
        "datasets": [{"name": "records", "sql": RECORDS_SQL},
                     {"name": "trend", "sql": f"SELECT as_of_date, value FROM {RESULT}_run_log"}],
        "filters": [{"id": "run_date", "type": "date_range", "label": "Run date", "columns": {"records": "as_of_date", "trend": "as_of_date"}},
                    {"id": "score", "type": "number_range", "label": "Score", "columns": {"records": "value"}},
                    {"id": "district", "type": "multi_select", "label": "District", "columns": {"records": "district"}},
                    {"id": "region", "type": "multi_select", "label": "Region", "columns": {"records": "region"}}],
        "kpis": [{"id": "failed", "label": "Bills failing controls", "dataset": "records",
                  "expression": "SUM(CASE WHEN value > 0 THEN 1 ELSE 0 END)"},
                 {"id": "leak", "label": "Revenue leakage", "dataset": "records", "expression": "SUM(value_at_stake)"},
                 {"id": "runs", "label": "Run values", "dataset": "trend", "expression": "SUM(value)"}]}
GENIE_RC3_SQL = (f"SELECT COALESCE(NULLIF(`segment_or_item`, ''), 'Unknown district') AS `district`, COUNT(*) AS `billing_exceptions`, "
                 f"SUM(`value_at_stake`) AS `total_value_at_stake` FROM {RESULT} WHERE `is_current` = 1 AND `change_source` <> 'delete' "
                 "GROUP BY 1 ORDER BY 2 DESC, 3 DESC LIMIT 1")


def _block(ns, page=PAGE):
    return ns["implement_genie_kpi_block"]("N01-U01", page)


def _kpi_line(block, label):
    start = block.index(f"- When asked for {label}, use exactly:")
    end = block.find("\n- When asked", start + 1)
    return block[start:end if end > 0 else len(block)]


def test_each_kpi_is_split_by_the_page_filter_columns_of_its_own_query(agent_ns):
    line = _kpi_line(_block(agent_ns), "Bills failing controls")
    assert "Split it by `district`, `region` the way the page does, from this same query: SELECT d.`district`, " \
           "SUM(CASE WHEN value > 0 THEN 1 ELSE 0 END) AS value FROM (the query above) AS d GROUP BY d.`district`." in line
    assert "never by joining another table to it or to the result table, so the parts add up to the Bills failing controls the page shows" in line
    assert "A part's share is its value over this query's total." in line


def test_date_and_number_range_filters_are_never_split_columns(agent_ns):
    line = _kpi_line(_block(agent_ns), "Revenue leakage")
    split = line[line.index("Split it by"):]
    assert "`as_of_date`" not in split and "`value`," not in split.split(" the way")[0]
    assert "Split it by `district`, `region` the way" in split


def test_a_kpi_no_category_filter_narrows_gets_no_split_line(agent_ns):
    line = _kpi_line(_block(agent_ns), "Run values")
    assert "Split it by" not in line and "The page narrows it with its filters on Run date (as_of_date)." in line


def test_the_block_says_its_queries_outrank_the_space_and_take_other_words(agent_ns):
    block = _block(agent_ns)
    assert "These queries outrank any SQL expression, filter or example of this space that counts or sums the same records another way" in block
    assert "such as exceptions, breaks or failures for a count of failing records, takes that KPI's query" in block
    assert "\n\n" not in block


def test_the_kpi_block_keeps_its_exact_queries_and_record_count_line(agent_ns):
    block = _block(agent_ns)
    assert f"- When asked for Bills failing controls, use exactly: SELECT SUM(CASE WHEN value > 0 THEN 1 ELSE 0 END) AS value FROM (\n{RECORDS_SQL}\n) AS d" in block
    assert "The page narrows it with its filters on Run date (as_of_date), Score (value), District (district), Region (region)." in block
    assert f"COUNT(DISTINCT record_key) of the current rows of `{RESULT}`, never COUNT(*) over a join" in block


def test_a_rebuilt_space_with_the_split_block_is_left_as_it_is(agent_ns):
    sync = agent_ns["implement_genie_page_kpis"]
    space, changed = sync({"instructions": {}}, "N01-U01", PAGE)
    assert changed
    again, changed = sync(space, "N01-U01", PAGE)
    assert not changed and again == space
    moved = copy.deepcopy(PAGE)
    moved["filters"] = [f for f in moved["filters"] if f["id"] != "region"]
    replaced, changed = sync(space, "N01-U01", moved)
    text = "".join(replaced["instructions"]["text_instructions"][0]["content"])
    assert changed and text.count("KPIs of the page of use case N01-U01") == 1 and "Split it by `district` the way" in text


def _billing_db():
    db = sqlite3.connect(":memory:")
    db.execute("CREATE TABLE bills (bill_id TEXT, district TEXT, region TEXT)")
    db.execute("CREATE TABLE bills_out (record_key TEXT, entity_id TEXT, value REAL, value_at_stake REAL, priority_tier TEXT, "
               "as_of_date TEXT, segment_or_item TEXT, is_current INTEGER, change_source TEXT)")
    rows = [("Saltmarsh", 0.0, 0.0)] * 5 + [("Ashford", 0.0, 0.0)] * 4 + [("Granary Junction", 2.0, 836.27), ("Orchard Plains", 2.0, 775.69),
                                                                         ("Millbrook", 2.0, 125.29), ("Highmoor", 2.0, 42.35), ("Red Sands", 2.0, 40.64)]
    for i, (district, value, stake) in enumerate(rows):
        db.execute("INSERT INTO bills VALUES (?, ?, 'North')", (str(i), district))
        db.execute("INSERT INTO bills_out VALUES (?, ?, ?, ?, 'Review', '2026-11-05', ?, 1, 'run')", (str(i), str(i), value, stake, district))
    return db


def _local(sql):
    return sql.replace(f"{RESULT}_", "bills_out_").replace(RESULT, "bills_out").replace("main.billing.bills", "bills")


def test_the_split_genie_is_told_to_run_gives_the_page_numbers_where_the_rc3_answer_did_not(agent_ns):
    db = _billing_db()
    rc3 = db.execute(_local(GENIE_RC3_SQL)).fetchall()
    assert rc3 == [("Saltmarsh", 5, 0.0)], "the rc.3 Genie SQL counted every scored bill of a district as an exception"
    line = _kpi_line(_block(agent_ns), "Bills failing controls")
    template = re.search(r"from this same query: (SELECT d\.`district`, .*? GROUP BY d\.`district`)\.", line).group(1)
    split = dict(db.execute(_local(template.replace("(the query above)", f"({RECORDS_SQL})"))).fetchall())
    page_kpi = db.execute(_local(f"SELECT SUM(CASE WHEN value > 0 THEN 1 ELSE 0 END) FROM ({RECORDS_SQL}) AS d")).fetchone()[0]
    assert split["Saltmarsh"] == 0 and split["Granary Junction"] == 1 and sum(split.values()) == page_kpi == 5
    leak = _kpi_line(_block(agent_ns), "Revenue leakage")
    template = re.search(r"from this same query: (SELECT d\.`district`, .*? GROUP BY d\.`district`)\.", leak).group(1)
    stakes = dict(db.execute(_local(template.replace("(the query above)", f"({RECORDS_SQL})"))).fetchall())
    assert round(stakes["Granary Junction"] / sum(stakes.values()), 4) == 0.4594


def test_kpi_split_query_reads_the_kpi_dataset_grouped_by_the_filter_column_with_the_kpi_filters():
    values = {"region": ["North"], "run_date": {"from": "2026-01-01", "to": "2026-12-31"}}
    sql, params = shell_sql.kpi_split_query(PAGE, "failed", "district", values, 30)
    kpi_sql, kpi_params = shell_sql.kpi_query(PAGE, "failed", values)
    assert sql.startswith("SELECT `district` AS x, SUM(CASE WHEN value > 0 THEN 1 ELSE 0 END) AS y0 FROM (" + RECORDS_SQL + ") AS d WHERE ")
    assert "GROUP BY `district` ORDER BY 2 DESC NULLS LAST LIMIT 30" in sql
    assert sql.split(") AS d", 1)[1].split(" GROUP BY")[0] == kpi_sql.split(") AS d", 1)[1].split(" LIMIT")[0]
    assert params == kpi_params


@pytest.mark.parametrize("by", ["run_date", "score", "nope"])
def test_kpi_split_query_refuses_a_range_or_unknown_filter(by):
    with pytest.raises(ValueError, match="KPI failed splits by district, region only, not " + by):
        shell_sql.kpi_split_query(PAGE, "failed", by, {}, 30)


def test_kpi_split_query_refuses_a_filter_that_does_not_narrow_the_kpi_dataset():
    with pytest.raises(ValueError, match="KPI runs splits by no filter only, not district"):
        shell_sql.kpi_split_query(PAGE, "runs", "district", {}, 30)


def _split_ws(llm, rows, total):
    ws = AgentWorkspace(llm=llm)
    reads = ws.run_sql

    def run_sql(warehouse, sql, params, limit=5000):
        if " AS x, " in sql and "GROUP BY `region`" in sql:
            ws.sql.append((sql, params, limit))
            return {"columns": [], "rows": rows, "truncated": False}
        if "'now' AS period" in sql and "SUM(loss) AS value" in sql:
            ws.sql.append((sql, params, limit))
            return {"columns": [], "rows": [{"period": "now", "value": total}], "truncated": False}
        return reads(warehouse, sql, params, limit)

    ws.run_sql = run_sql
    return ws


def test_the_agent_splits_a_kpi_from_the_page_data_at_the_persons_filters_not_from_genie(tmp_path):
    llm = FakeLLM([tool_call("split_kpi", {"kpi": "Loss to discounts", "filter": "region"}),
                   said("East carries 75% of the loss.")], related=topic_of)
    ws = _split_ws(llm, [{"x": "East", "y0": 75.0}, {"x": "West", "y0": 25.0}], 100.0)
    s, ws, _made = agent_shell(tmp_path, ws=ws)
    turn = ask(s, "Which region loses the most, and what share of the loss is it?", view={"filters": {"channel": ["Web"]}})
    assert turn["state"] == "done" and ws.genie == []
    assert [step["text"] for step in turn["steps"]] == ["Split Loss to discounts by Region"]
    result = json.loads([m for m in llm.main_calls()[-1]["messages"] if m["role"] == "tool"][0]["content"].split("<data>\n", 1)[1]
                        .rsplit("\n</data>", 1)[0])
    assert result == {"kpi": "Loss to discounts", "filter": "Region", "total": 100.0, "truncated": False,
                      "rows": [{"value": "East", "kpi_value": 75.0, "share": 0.75}, {"value": "West", "kpi_value": 25.0, "share": 0.25}]}
    split_sql = [(sql, params) for sql, params, _limit in ws.sql if "GROUP BY `region`" in sql]
    assert split_sql and "FROM (SELECT as_of_date, month, category, channel, region, loss" in split_sql[0][0]
    assert "Web" in json.dumps(split_sql[0][1]), "the split is read at the person's filters, as the page reads its KPI"


def test_a_ratio_kpi_is_split_without_shares(tmp_path):
    llm = FakeLLM([tool_call("split_kpi", {"kpi": "loss_rate", "filter": "region"}), said("East has the higher rate.")], related=topic_of)
    ws = _split_ws(llm, [{"x": "East", "y0": 12.0}], 9.0)
    s, ws, _made = agent_shell(tmp_path, ws=ws)
    ask(s, "Which region has the highest loss rate?")
    result = json.loads([m for m in llm.main_calls()[-1]["messages"] if m["role"] == "tool"][0]["content"].split("<data>\n", 1)[1]
                        .rsplit("\n</data>", 1)[0])
    assert result["rows"] == [{"value": "East", "kpi_value": 12.0}]


def test_a_split_by_a_date_filter_or_an_unknown_kpi_says_why(tmp_path):
    llm = FakeLLM([tool_call("split_kpi", {"kpi": "total_loss", "filter": "run_date"}),
                   tool_call("split_kpi", {"kpi": "no such", "filter": "region"}, "t2"), said("Cannot.")], related=topic_of)
    s, _ws, _made = agent_shell(tmp_path, ws=AgentWorkspace(llm=llm))
    turn = ask(s, "Split the loss by run date")
    assert turn["steps"][0]["text"] == "Could not split the KPI: KPI total_loss splits by category, channel, region only, not run_date"
    assert turn["steps"][1]["text"].startswith("Could not split the KPI: the page has no KPI no such; its KPIs are total_loss, loss_rate, items")


def test_the_agent_is_told_to_split_with_split_kpi_and_to_name_the_kpi_for_genie(tmp_path):
    assert "call split_kpi: it reads the page's own data at the person's filters" in shell_agent.SYSTEM
    assert "never ask Genie for that split" in shell_agent.SYSTEM
    assert "such as exceptions for failing records, is about that KPI; when you ask Genie about it, name the KPI by its label" in shell_agent.SYSTEM
    llm = FakeLLM([said("Here.")], related=topic_of)
    s, _ws, _made = agent_shell(tmp_path, ws=AgentWorkspace(llm=llm))
    ask(s, "Which region loses the most?")
    assert [t["function"]["name"] for t in llm.main_calls()[0]["tools"]][:3] == ["ask_genie", "change_view", "split_kpi"]


def test_a_page_whose_kpis_no_category_filter_narrows_offers_no_split(tmp_path):
    agent = shell_agent.Agent.__new__(shell_agent.Agent)
    agent.genie_on = lambda page: True
    page = copy.deepcopy(PAGE)
    page["filters"] = [f for f in page["filters"] if f["type"] in shell_sql.RANGE_EDGES]
    page.pop("records", None)
    assert agent.tools_for(page) == ["ask_genie", "change_view"]
    assert agent.tools_for(PAGE) == ["ask_genie", "change_view", "split_kpi"]
