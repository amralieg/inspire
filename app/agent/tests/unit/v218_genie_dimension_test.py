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
    assert sql.startswith("SELECT `district` AS x, SUM(CASE WHEN value > 0 THEN 1 ELSE 0 END) AS y0 FROM (" + shell_sql.future_source(PAGE, "records", RECORDS_SQL) + ") AS d WHERE ")
    assert "GROUP BY `district` ORDER BY 2 DESC NULLS LAST LIMIT 30" in sql
    assert sql.split(") AS d", 1)[1].split(" GROUP BY")[0] == kpi_sql.split(") AS d", 1)[1].split(" LIMIT")[0]
    assert params == kpi_params


@pytest.mark.parametrize("by", ["run_date", "score", "nope"])
def test_kpi_split_query_refuses_a_range_or_unknown_filter_in_plain_words(by):
    with pytest.raises(ValueError, match="^This chart can be split by district or region\\.$"):
        shell_sql.kpi_split_query(PAGE, "failed", by, {}, 30)


def test_kpi_split_query_refuses_a_filter_that_does_not_narrow_the_kpi_dataset_in_plain_words():
    with pytest.raises(ValueError, match="^This chart cannot be split by any filter on this page\\.$"):
        shell_sql.kpi_split_query(PAGE, "runs", "district", {}, 30)


@pytest.mark.parametrize("asked", ["District", "district", "  REGION "])
def test_a_split_names_the_filter_by_its_label_in_any_case(asked):
    assert shell_sql.split_filter_named(PAGE, "records", asked)["id"] in ("district", "region")
    assert shell_sql.split_filter_named(PAGE, "records", asked)["label"].casefold() == asked.strip().casefold()


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
    left_out = result.pop("left_out", None)
    assert result == {"kpi": "Loss to discounts", "filter": "Region", "total": 100.0, "truncated": False,
                      "rows": [{"value": "East", "kpi_value": 75.0, "share": 0.75}, {"value": "West", "kpi_value": 25.0, "share": 0.25}]}
    assert left_out is None or left_out["text"].endswith("were left out"), "the money line, when the total has one, says what it left out"
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
    assert turn["steps"][0]["text"] == "This chart can be split by category, channel or region."
    assert turn["steps"][1]["text"] == "Could not split the KPI: the page has no KPI no such; its KPIs are Loss to discounts, Loss rate, Items on the list"
    


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


def _room(measures=(), filters=(), examples=()):
    return {"data_sources": {"tables": [{"identifier": RESULT}, {"identifier": "main.billing.bills"}]},
            "instructions": {"text_instructions": [],
                             "sql_snippets": {"measures": [copy.deepcopy(m) for m in measures],
                                              "filters": [copy.deepcopy(f) for f in filters]},
                             "example_question_sqls": [copy.deepcopy(e) for e in examples]}}


LIVE_MEASURE = {"alias": "current_bill_count", "display_name": "Current bill count",
                "sql": ["COUNT_IF(`bills_out`.`is_current` AND `bills_out`.`change_source` <> 'delete')"],
                "synonyms": ["current exceptions", "queue size"]}
LEAK_MEASURE = {"alias": "current_revenue_leakage_usd", "display_name": "Current revenue leakage",
                "sql": ["SUM(IF(`bills_out`.`is_current` AND `bills_out`.`change_source` <> 'delete', `bills_out`.`value_at_stake`, 0D))"],
                "synonyms": ["revenue leakage", "leakage at stake"]}
LIVE_EXAMPLE = {"question": ["Which districts have the most billing control breaks?"],
                "sql": [f"SELECT b.district, COUNT(*) AS breaks FROM {RESULT} o JOIN main.billing.bills b ON b.bill_id = o.entity_id ",
                        "WHERE o.is_current AND o.change_source <> 'delete' AND o.value_at_stake > 0 GROUP BY b.district"]}
GOOD_EXAMPLE = {"question": ["Which districts have the most failing bills?"],
                "sql": [f"SELECT b.district, COUNT(DISTINCT o.record_key) AS failing FROM {RESULT} o ",
                        "JOIN main.billing.bills b ON b.bill_id = o.entity_id WHERE o.is_current AND o.value > 0 GROUP BY b.district"]}


def _sync_room(ns, room, capsys):
    space, changed = ns["implement_genie_page_kpis"](room, "N01-U01", PAGE)
    return space, changed, capsys.readouterr().out


def test_the_live_current_bill_count_loses_its_exceptions_synonym_and_keeps_its_meaning(agent_ns, capsys):
    space, changed, out = _sync_room(agent_ns, _room([LIVE_MEASURE]), capsys)
    measure = space["instructions"]["sql_snippets"]["measures"][0]
    assert changed and measure["synonyms"] == ["queue size"] and measure["sql"] == LIVE_MEASURE["sql"]
    assert "[GENIE-KPI-COLLISION FIRED] measure='current_bill_count' kpi='Bills failing controls' action=synonym 'current exceptions' removed" in out


def test_a_measure_named_like_the_kpi_that_counts_every_row_is_rewritten_to_the_kpi(agent_ns, capsys):
    wrong = {"alias": "failing_bills", "display_name": "Failing bills", "sql": ["COUNT(*)"], "synonyms": ["bills failing controls"]}
    space, changed, out = _sync_room(agent_ns, _room([wrong]), capsys)
    measure = space["instructions"]["sql_snippets"]["measures"][0]
    assert changed and measure["sql"] == ["COUNT_IF(`bills_out`.`is_current` AND `bills_out`.`change_source` <> 'delete' AND `bills_out`.`value` > 0)"]
    assert measure["synonyms"] == ["bills failing controls"]
    assert "measure='failing_bills' kpi='Bills failing controls' action=rewritten to the KPI's own records" in out
    again, changed, out = _sync_room(agent_ns, space, capsys)
    assert not changed and again == space and "COLLISION" not in out


def test_a_money_measure_named_for_the_kpi_records_keeps_its_sum_over_the_kpi_records(agent_ns, capsys):
    money = {"alias": "exceptions_at_stake", "sql": ["SUM(`bills_out`.`value_at_stake`)"], "synonyms": ["money at stake"]}
    space, changed, out = _sync_room(agent_ns, _room([money]), capsys)
    measure = space["instructions"]["sql_snippets"]["measures"][0]
    assert changed and measure["sql"] == ["SUM(IF(`bills_out`.`is_current` AND `bills_out`.`change_source` <> 'delete' AND "
                                          "`bills_out`.`value` > 0, `bills_out`.`value_at_stake`, 0D))"]
    assert measure["synonyms"] == ["money at stake"] and "measure='exceptions_at_stake' kpi='Bills failing controls'" in out


def test_a_measure_named_like_a_kpi_of_another_table_is_dropped(agent_ns, capsys):
    page = copy.deepcopy(PAGE)
    page["kpis"] = [k for k in page["kpis"] if k["id"] == "runs"]
    wrong = {"alias": "run_values", "sql": ["COUNT(*)"]}
    space, changed = agent_ns["implement_genie_page_kpis"](_room([wrong]), "N01-U01", page)
    assert changed and space["instructions"]["sql_snippets"]["measures"] == []
    assert "measure='run_values' kpi='Run values' action=dropped" in capsys.readouterr().out


def test_the_live_breaks_example_counting_another_population_is_dropped_and_the_right_one_kept(agent_ns, capsys):
    space, changed, out = _sync_room(agent_ns, _room(examples=[LIVE_EXAMPLE, GOOD_EXAMPLE]), capsys)
    assert changed and space["instructions"]["example_question_sqls"] == [GOOD_EXAMPLE]
    assert "example='Which districts have the most billing control breaks?' kpi='Bills failing controls' action=dropped" in out


def test_a_filter_named_for_the_kpi_records_but_missing_their_condition_gets_it(agent_ns, capsys):
    loose = {"alias": "flagged_bills", "sql": ["`bills_out`.`value_at_stake` > 0"], "synonyms": ["failing bills", "money at stake"]}
    right = {"alias": "failing_bills_filter", "sql": ["`bills_out`.`value` > 0"], "synonyms": ["failing bills"]}
    space, changed, out = _sync_room(agent_ns, _room(filters=[loose, right]), capsys)
    filters = space["instructions"]["sql_snippets"]["filters"]
    assert changed and filters[1] == right and filters[0]["sql"] == [
        "`bills_out`.`is_current` AND `bills_out`.`change_source` <> 'delete' AND `bills_out`.`value` > 0 AND `bills_out`.`value_at_stake` > 0"]
    assert filters[0]["synonyms"] == ["failing bills", "money at stake"]
    assert "filter='flagged_bills' kpi='Bills failing controls'" in out and "failing_bills_filter" not in out


def test_measures_that_do_not_collide_or_equal_the_kpi_are_kept_as_they_are(agent_ns, capsys):
    other = {"alias": "open_queue", "sql": ["COUNT(*)"], "synonyms": ["queue size", "open items"]}
    narrower = {"alias": "act_now_failing_bills", "sql": ["COUNT_IF(`bills_out`.`value` > 0 AND `bills_out`.`priority_tier` = 'Act now')"],
                "synonyms": ["act now failing bills"]}
    same = {"alias": "bills_failing_controls", "sql": ["SUM(CASE WHEN `bills_out`.`value` > 0 THEN 1 ELSE 0 END)"],
            "synonyms": ["current exceptions"]}
    room = _room([other, LEAK_MEASURE, narrower, same], examples=[GOOD_EXAMPLE])
    space, changed, out = _sync_room(agent_ns, room, capsys)
    assert changed and "COLLISION" not in out
    assert space["instructions"]["sql_snippets"] == room["instructions"]["sql_snippets"]
    assert space["instructions"]["example_question_sqls"] == [GOOD_EXAMPLE]


def test_kpi_shapes_read_the_same_count_in_every_spelling(agent_ns):
    shape = agent_ns["implement_genie_measure_shape"]
    want = shape("SUM(CASE WHEN value > 0 THEN 1 ELSE 0 END)")
    for sql in ("COUNT_IF(o.value > 0)", "SUM(IF(`o`.`value` > 0, 1, 0))", "COUNT(DISTINCT IF(value > 0, record_key, NULL))",
                "COUNT_IF(is_current AND change_source <> 'delete' AND value > 0)"):
        assert shape(sql) == want, sql
    assert shape("COUNT(*)") != want and shape("COUNT_IF(value_at_stake > 0)") != want
    assert shape("SUM(IF(is_current, value_at_stake, 0D))") == shape("SUM(value_at_stake)")


def test_the_sync_loads_sqlglot_only_when_a_space_item_names_a_kpi(agent_ns):
    claims = agent_ns["implement_genie_kpi_claims"]
    assert claims(_room([LEAK_MEASURE | {"alias": "x", "display_name": "", "synonyms": ["queue size"]}]), PAGE) == []
    assert [c["item"]["alias"] for c in claims(_room([LIVE_MEASURE]), PAGE)] == ["current_bill_count"]
    assert claims(_room([LIVE_MEASURE]), {"kpis": []}) == []


def test_a_ratio_kpi_drops_only_a_measure_named_exactly_for_it(agent_ns, capsys):
    page = copy.deepcopy(PAGE)
    page["kpis"] = [{"id": "rate", "label": "Failure rate", "dataset": "records", "expression": "AVG(CASE WHEN value > 0 THEN 1 ELSE 0 END)"}]
    count = {"alias": "failure_count", "sql": ["COUNT(*)"], "synonyms": ["failures"]}
    same = {"alias": "failure_rate", "sql": ["AVG(CASE WHEN `bills_out`.`value` > 0 THEN 1 ELSE 0 END)"]}
    other = {"alias": "failure_rate_all", "display_name": "Failure rate", "sql": ["AVG(`bills_out`.`value_at_stake`)"]}
    gate = {"alias": "failed_filter", "sql": ["`bills_out`.`value` > 0"], "synonyms": ["failure rate rows"]}
    space, changed = agent_ns["implement_genie_page_kpis"](_room([count, same, other], filters=[gate]), "N01-U01", page)
    out = capsys.readouterr().out
    assert space["instructions"]["sql_snippets"]["measures"] == [count, same]
    assert space["instructions"]["sql_snippets"]["filters"] == [gate]
    assert out.count("COLLISION FIRED") == 1 and "measure='failure_rate_all' kpi='Failure rate' action=dropped" in out


def test_a_space_without_instructions_or_a_page_without_kpis_is_untouched(agent_ns, capsys):
    collide = agent_ns["implement_genie_kpi_collisions"]
    room = _room([LIVE_MEASURE])
    assert collide({"instructions": "x"}, PAGE) is False and collide(room, {"kpis": []}) is False
    assert collide(room, None) is False and room == _room([LIVE_MEASURE]) and "COLLISION" not in capsys.readouterr().out


def test_the_build_sync_loads_sqlglot_and_writes_the_fixed_room_only_when_an_item_names_a_kpi(agent_ns, capsys):
    from v218_kpi_genie_parity_test import _sync_inst
    for room, loads in ((_room([LIVE_MEASURE]), 1), (_room([{"alias": "open_queue", "sql": ["COUNT(*)"], "synonyms": ["leak"]}]), 0)):
        inst, context, patched = _sync_inst(agent_ns, room, page=PAGE)
        asked = []
        inst._require_asset_package = lambda module, purpose: asked.append(module)
        assert inst._implement_genie_kpi_sync(context, ["app"]) == [] and asked == ["sqlglot"] * loads
        measures = patched[0][2]["instructions"]["sql_snippets"]["measures"]
        assert measures[0]["synonyms"] == (["queue size"] if loads else ["leak"])
    assert capsys.readouterr().out.count("[GENIE-KPI-COLLISION FIRED]") == 1


def _page_in(kpis, filters, title):
    page = copy.deepcopy(PAGE)
    page["kpis"], page["records"] = kpis, {"title": title}
    page["filters"] = [{"id": f"f{index}", "type": "multi_select", "label": label, "columns": {"records": column}}
                       for index, (label, column) in enumerate(filters)]
    return page


AR_PAGE = _page_in([{"id": "failed", "label": "الفواتير المخالفة للضوابط", "dataset": "records",
                     "expression": "SUM(CASE WHEN value > 0 THEN 1 ELSE 0 END)"},
                    {"id": "leak", "label": "قيمة التسرب", "dataset": "records", "expression": "SUM(value_at_stake)"}],
                   [("المنطقة", "district")], "الفواتير ذات الأولوية")
FR_PAGE = _page_in([{"id": "failed", "label": "Factures en échec de contrôle", "dataset": "records",
                     "expression": "SUM(CASE WHEN value > 0 THEN 1 ELSE 0 END)"}],
                   [("Région", "region")], "Factures à traiter")


def _sync_page(ns, room, page, capsys):
    space, changed = ns["implement_genie_page_kpis"](room, "N01-U01", page)
    return space, changed, capsys.readouterr().out


def test_label_words_fold_case_accents_tatweel_harakat_and_the_arabic_article(agent_ns):
    words = agent_ns["_implement_genie_name_words"]
    assert words("Contrôles  ÉCHOUÉS") == {"controle", "echoue"}
    assert words("الفـواتيرُ") == {"فواتير"} and words("بالضوابط") == {"ضوابط"} and words("للضوابط") == {"ضوابط"}
    assert words("المُخالِفة") == words("مخالفه") == {"مخالفه"} and words("current_bill_count") == {"current", "bill", "count"}


def test_the_page_record_noun_and_filter_labels_do_not_name_a_kpi(agent_ns):
    known = agent_ns["implement_genie_kpi_page_words"](AR_PAGE)
    assert known[id(AR_PAGE["kpis"][0])]["key"] == {"مخالفه", "ضوابط"}
    assert known[id(AR_PAGE["kpis"][1])]["key"] == {"قيمه", "تسرب"}
    fr = agent_ns["implement_genie_kpi_page_words"](FR_PAGE)
    assert fr[id(FR_PAGE["kpis"][0])] == {"label": {"facture", "echec", "controle"}, "key": {"echec", "controle"}}


def test_an_arabic_synonym_naming_the_arabic_kpi_on_a_measure_of_every_row_is_removed(agent_ns, capsys):
    measure = LIVE_MEASURE | {"synonyms": ["الفواتير المُخالِفة للضوابط الحالية", "حجم قائمة الانتظار"]}
    space, changed, out = _sync_page(agent_ns, _room([measure]), AR_PAGE, capsys)
    kept = space["instructions"]["sql_snippets"]["measures"][0]
    assert changed and kept["synonyms"] == ["حجم قائمة الانتظار"] and kept["sql"] == LIVE_MEASURE["sql"]
    assert "[GENIE-KPI-COLLISION FIRED] measure='current_bill_count' kpi='الفواتير المخالفة للضوابط' action=synonym" in out


def test_a_french_synonym_and_name_for_the_french_kpi_are_fixed_without_accents_or_plurals_mattering(agent_ns, capsys):
    synonym = LIVE_MEASURE | {"synonyms": ["factures en echec", "file d'attente"]}
    named = {"alias": "nombre_factures_échecs_contrôles", "sql": ["COUNT(*)"]}
    space, changed, out = _sync_page(agent_ns, _room([synonym, named]), FR_PAGE, capsys)
    measures = space["instructions"]["sql_snippets"]["measures"]
    assert changed and measures[0]["synonyms"] == ["file d'attente"]
    assert measures[1]["sql"] == ["COUNT_IF(`bills_out`.`is_current` AND `bills_out`.`change_source` <> 'delete' AND `bills_out`.`value` > 0)"]
    assert out.count("kpi='Factures en échec de contrôle'") == 2 and "action=rewritten to the KPI's own records" in out


def test_arabic_synonyms_that_name_only_the_record_noun_or_another_thing_are_kept(agent_ns, capsys):
    measure = LIVE_MEASURE | {"synonyms": ["الفواتير الحالية", "حجم قائمة الانتظار", "الفواتير حسب المنطقة"]}
    room = _room([measure, LEAK_MEASURE | {"synonyms": ["قيمة التسرب"]}])
    space, changed, out = _sync_page(agent_ns, room, AR_PAGE, capsys)
    assert "COLLISION" not in out and space["instructions"]["sql_snippets"] == room["instructions"]["sql_snippets"]


def test_one_shared_word_never_drops_a_measure_by_its_name(agent_ns, capsys):
    stake = {"alias": "value_at_stake_total", "sql": ["SUM(`bills_out`.`value_at_stake`)"]}
    cost = {"alias": "control_cost", "sql": ["SUM(`bills_out`.`value_at_stake`)"]}
    room = _room([stake, cost])
    space, changed, out = _sync_room(agent_ns, room, capsys)
    assert "COLLISION" not in out and space["instructions"]["sql_snippets"]["measures"] == room["instructions"]["sql_snippets"]["measures"]


def test_a_split_asked_in_other_case_succeeds_and_an_unsplittable_ask_gets_one_plain_sentence(tmp_path):
    llm = FakeLLM([tool_call("split_kpi", {"kpi": "Loss to discounts", "filter": "REGION"}),
                   tool_call("split_kpi", {"kpi": "Loss to discounts", "filter": "run_date"}, "t2"), said("Done.")], related=topic_of)
    ws = _split_ws(llm, [{"x": "East", "y0": 75.0}, {"x": "West", "y0": 25.0}], 100.0)
    s, ws, _made = agent_shell(tmp_path, ws=ws)
    turn = ask(s, "Split the loss by REGION, and by run date")
    assert [step["text"] for step in turn["steps"]] == ["Split Loss to discounts by Region", "This chart can be split by category, channel or region."]


class _DatedWorkspace(AgentWorkspace):
    def run_sql(self, warehouse, sql, params, limit=5000):
        if "high_0 AS high" in sql:
            self.sql.append((sql, params, limit))
            return {"columns": [], "rows": [{"low": "2024-01-05", "high": "2026-10-26"}], "truncated": False}
        return super().run_sql(warehouse, sql, params, limit)


def test_the_context_gives_the_latest_data_date_apart_from_the_run_date_and_says_when_it_is_old(tmp_path):
    import datetime as dt
    llm = FakeLLM([said("Data through Oct 26: the source has no newer rows.")], related=topic_of)
    s, _ws, _made = agent_shell(tmp_path, ws=_DatedWorkspace(llm=llm))
    s.now = lambda: dt.datetime(2026, 11, 10, tzinfo=dt.timezone.utc)
    turn = ask(s, "How current is this data?", view={"filters": {}}, visible=[])
    assert turn["state"] == "done"
    context = llm.main_calls()[0]["messages"][1]["content"]
    assert '"data_through":{"date":"2026-10-26","today":"2026-11-10","days_old":15,"stale":true,"ahead":false}' in context
    assert '"date":"2026-10-26"' in context and context.count('"data_through"') == 1
    assert "not the run date" in shell_agent.SYSTEM
