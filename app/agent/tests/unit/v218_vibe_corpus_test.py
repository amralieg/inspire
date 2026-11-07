import pytest

from v120_artifacts_support import FakeSpark
from v218_vibe_judge_test import _hold, _verdict

TPCH = {
    "samples.tpch.lineitem": {
        "comment": "One row per shipped order line",
        "columns": [("l_orderkey", ""), ("l_partkey", ""), ("l_suppkey", ""), ("l_linenumber", ""), ("l_quantity", ""),
                    ("l_extendedprice", ""), ("l_discount", ""), ("l_tax", ""), ("l_returnflag", "Whether the item came back"),
                    ("l_linestatus", ""), ("l_shipdate", ""), ("l_commitdate", ""), ("l_receiptdate", ""), ("l_shipinstruct", ""),
                    ("l_shipmode", "Carrier transport mode: AIR, RAIL, TRUCK, SHIP")]},
    "samples.tpch.supplier": {
        "comment": "Vendors who sell parts to the business",
        "columns": [("s_suppkey", ""), ("s_name", "Vendor name as printed on invoices"), ("s_address", ""), ("s_nationkey", ""),
                    ("s_phone", ""), ("s_acctbal", "Account balance in USD")]},
    "samples.tpch.nation": {
        "comment": "Countries the suppliers are based in",
        "columns": [("n_nationkey", ""), ("n_name", ""), ("n_regionkey", "")]}}

FOUND = [
    ("Add a bar chart of late lines by vendor", "chart"),
    ("Add a chart of late lines by country", "chart"),
    ("Add a KPI for the average account balance", "kpi"),
    ("Add a chart of revenue by nation", "chart"),
    ("Show total extended price per supplier", "data"),
    ("Add a chart of the discount by ship mode", "chart"),
    ("Add a table of returns by carrier", "table"),
    ("Add a KPI for the share of late lines", "kpi"),
    ("Add a chart of shipments per month", "chart"),
    ("Add a chart of the late-line rate by peer group", "chart"),
    ("Add a table of the average delay per supplier", "table"),
    ("Add a KPI for growth in quantity", "kpi"),
    ("Add a chart of the ratio of discount to tax", "chart"),
    ("Add a chart of late lines by transport mode", "chart"),
    ("Add a chart of order lines by line status", "chart"),
    ("Add a KPI tile of the count of suppliers", "kpi"),
    ("Add a chart of late lines by delivery size", "chart"),
    ("Add a chart of sales by region", "chart"),
    ("Add a table of late lines by vendor phone", "table"),
    ("Add a KPI for the average lateness in days", "kpi"),
]
MISSING = [
    ("Add a chart of humidity", "chart", "humidity"),
    ("Add a KPI for average rainfall", "kpi", "rainfall"),
    ("Show total carbon emissions per supplier", "data", "carbon emissions"),
    ("Add a bar chart of late lines by weather", "chart", "weather"),
    ("Add a KPI tile of each supplier's ESG score", "kpi", "esg score"),
    ("Add a chart of late lines by temperature", "chart", "temperature"),
    ("Add a table of customer satisfaction by supplier", "table", "customer satisfaction"),
    ("Add a chart of fuel usage by ship mode", "chart", "fuel usage"),
    ("Add a KPI for average employee headcount", "kpi", "employee headcount"),
    ("Add a chart of late lines by storm warnings", "chart", "storm warnings"),
    ("Add a chart of social media mentions per supplier", "chart", "social media mentions"),
    ("Add a KPI for average wind speed", "kpi", "wind speed"),
]


TERSE = {"samples.tpch.supplier": {"comment": "", "columns": [(c, "") for c in ("s_suppkey", "s_name", "s_nationkey", "s_acctbal")]},
         "main.sales.ord_line": {"comment": "", "columns": [(c, "") for c in ("ord_id", "cust_id", "ord_qty", "net_amt", "ship_dt",
                                                                               "prod_cd")]}}
FOUND_TERSE = [
    ("Add a KPI for the average account balance", "kpi"),
    ("Add a chart of the net amount by customer", "chart"),
    ("Add a KPI for total order quantity", "kpi"),
    ("Add a table of net amount by product", "table"),
    ("Add a chart of orders by ship date", "chart"),
]
MISSING_TERSE = [
    ("Add a chart of net amount by weather", "chart", "weather"),
    ("Add a KPI for average rainfall", "kpi", "rainfall"),
]


def _rows(entry):
    rows = [{"col_name": name, "data_type": "string", "comment": comment} for name, comment in entry["columns"]]
    return rows + [{"col_name": "", "data_type": "", "comment": ""},
                   {"col_name": "# Detailed Table Information", "data_type": "", "comment": ""},
                   {"col_name": "Name", "data_type": "x", "comment": ""},
                   {"col_name": "Comment", "data_type": entry["comment"], "comment": ""}]


def _tpch(tables=TPCH):
    def respond(statement):
        if not statement.startswith("DESCRIBE TABLE"):
            return []
        for table, entry in tables.items():
            if all(f"`{part}`" in statement for part in table.split(".")):
                return _rows(entry) if "EXTENDED" in statement else _rows(entry)[:len(entry["columns"])]
        raise RuntimeError("[TABLE_OR_VIEW_NOT_FOUND] The table cannot be found")
    return FakeSpark(responder=respond)


def _ask(text, draws):
    return {"ask": text, "check": None, "keep": False, "where": "", "draws": draws}


def _corpus_hold(agent_ns, text, draws, tables=TPCH):
    return _hold(agent_ns, [_ask(text, draws)], [_verdict("missing", "the chart is not built yet")], sources=tables,
                 spark=_tpch(tables), real_sources=True)


@pytest.mark.parametrize("text,draws", FOUND)
def test_an_ask_whose_data_exists_under_another_name_is_never_held(agent_ns, text, draws):
    held, _judged, inst = _corpus_hold(agent_ns, text, draws)
    assert held == {}, held
    assert not inst.logger.matching("[IMPLEMENT-VIBES-NO-COLUMN FIRED]")


@pytest.mark.parametrize("text,draws,missing", MISSING)
def test_an_ask_for_data_no_table_holds_is_held_before_genie_with_no_judge_call(agent_ns, text, draws, missing):
    held, judged, inst = _corpus_hold(agent_ns, text, draws)
    reason = held[agent_ns["IMPLEMENT_NOTEBOOK"]][text]
    assert reason.startswith(agent_ns["IMPLEMENT_VIBES_NO_DATA"]) and f"holds {missing};" in reason, reason
    assert all(table in reason for table in TPCH) and "column names and descriptions" in reason
    assert judged == []
    assert inst.logger.matching("[IMPLEMENT-VIBES-NO-COLUMN FIRED] N02-U05")


@pytest.mark.parametrize("text,draws", FOUND_TERSE)
def test_an_ask_whose_data_sits_in_an_abbreviated_column_with_no_description_is_never_held(agent_ns, text, draws):
    held, _judged, inst = _corpus_hold(agent_ns, text, draws, TERSE)
    assert held == {} and not inst.logger.matching("[IMPLEMENT-VIBES-NO-COLUMN FIRED]"), held


@pytest.mark.parametrize("text,draws,missing", MISSING_TERSE)
def test_an_abbreviated_schema_still_holds_data_it_truly_lacks(agent_ns, text, draws, missing):
    held, judged, _inst = _corpus_hold(agent_ns, text, draws, TERSE)
    assert f"holds {missing};" in held[agent_ns["IMPLEMENT_NOTEBOOK"]][text] and judged == []


def test_the_corpus_is_big_enough_to_guard_over_refusal():
    assert len(FOUND) + len(FOUND_TERSE) >= 15 and len(MISSING) + len(MISSING_TERSE) >= 10
    assert len(FOUND) >= 15 and len(MISSING) >= 10
    assert not {t for t, _d in FOUND} & {t for t, _d, _m in MISSING}


def test_a_word_only_a_table_description_holds_is_never_held(agent_ns):
    held, _judged, _inst = _corpus_hold(agent_ns, "Add a chart of late lines by country", "chart")
    assert held == {}
    plain = {t: dict(e, comment="") for t, e in TPCH.items()}
    held, judged, _inst = _corpus_hold(agent_ns, "Add a chart of late lines by country", "chart", plain)
    assert held[agent_ns["IMPLEMENT_NOTEBOOK"]]["Add a chart of late lines by country"].startswith(agent_ns["IMPLEMENT_VIBES_NO_DATA"])
    assert judged == []


def test_table_descriptions_are_read_with_the_columns_and_the_plain_schema_is_unchanged(agent_ns):
    spark = _tpch()
    described = agent_ns["inspire_table_described"](spark, "samples.tpch.nation", extended=True)
    assert described == {"columns": [("n_nationkey", "string", ""), ("n_name", "string", ""), ("n_regionkey", "string", "")],
                         "comment": "Countries the suppliers are based in"}
    assert agent_ns["inspire_table_schema"](spark, "samples.tpch.nation") == [
        ("n_nationkey", "string"), ("n_name", "string"), ("n_regionkey", "string")]
    assert [s for s in spark.statements if "nation" in s][-1].startswith("DESCRIBE TABLE `samples`")


@pytest.mark.parametrize("phrase,derived", [("the share of late lines", True), ("average rainfall", False), ("total revenue", True),
                                            ("growth in quantity", True), ("wind speed", False), ("the ratio of discount to tax", True)])
def test_a_measure_built_from_existing_columns_is_exempt_and_a_new_quantity_is_not(agent_ns, phrase, derived):
    vocabulary = agent_ns["implement_vibes_held_terms"]({t: [c for c, _n in e["columns"]] for t, e in TPCH.items()},
                                                        {"use_case": "Review suppliers that deliver late"})
    missing = agent_ns["implement_vibes_unfound"](_ask(f"Add a KPI for {phrase}", "kpi"), vocabulary)
    assert (missing == []) is derived, missing


def test_measures_and_groupings_are_both_read_from_one_ask(agent_ns):
    ask = _ask("Add a chart of average rainfall by weather", "chart")
    assert agent_ns["implement_vibes_measures"](ask) == ["average rainfall"]
    assert agent_ns["implement_vibes_groupings"](ask) == ["weather"]
    assert agent_ns["implement_vibes_measures"](_ask("Add a KPI tile of each supplier's ESG score", "kpi")) == ["esg score"]
