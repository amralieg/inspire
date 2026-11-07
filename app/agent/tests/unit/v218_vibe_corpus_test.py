import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import _inspire
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


NOT_BUILT = _verdict("missing", "the chart is not built yet")
NO_DATA = _verdict("no_data", "no column holds it")
LEDGER = {"main.fin.ledger": {"comment": "", "columns": [("acct_id", ""), ("rev", ""), ("post_dt", "")]}}
INCOME = "Add a KPI for total income"
EARNINGS = "Add a KPI for total earnings"


def _corpus_hold(agent_ns, text, draws, tables=TPCH, replies=(NOT_BUILT,)):
    return _hold(agent_ns, [_ask(text, draws)], list(replies), sources=tables, spark=_tpch(tables), real_sources=True)


def _found_by_the_matcher(agent_ns, text, draws):
    return bool(agent_ns["implement_vibes_checkable"](_ask(text, draws)))


@pytest.mark.parametrize("text,draws", FOUND)
def test_an_ask_whose_data_exists_under_another_name_is_never_held(agent_ns, text, draws):
    found = _found_by_the_matcher(agent_ns, text, draws)
    held, judged, inst = _corpus_hold(agent_ns, text, draws, replies=(NO_DATA if found else NOT_BUILT,))
    assert held == {}, held
    assert not inst.logger.matching("[IMPLEMENT-VIBES-NO-COLUMN FIRED]")
    if found:
        assert judged == [], "data the matcher finds needs no check by the model, so even a model that says no_data is never asked"


@pytest.mark.parametrize("text,draws,missing", MISSING)
def test_an_ask_for_data_no_table_holds_is_held_only_when_the_model_agrees(agent_ns, text, draws, missing):
    held, judged, inst = _corpus_hold(agent_ns, text, draws, replies=(NO_DATA,))
    reason = held[agent_ns["IMPLEMENT_NOTEBOOK"]][text]
    assert reason.startswith(agent_ns["IMPLEMENT_VIBES_NO_DATA"]) and f"holds {missing};" in reason, reason
    assert all(table in reason for table in TPCH) and "column names and descriptions" in reason
    assert judged == ["judge"]
    assert inst.logger.matching("[IMPLEMENT-VIBES-NO-COLUMN FIRED] N02-U05")
    assert inst.logger.matching("[IMPLEMENT-VIBES-HOLD FIRED] N02-U05")


@pytest.mark.parametrize("text,draws,missing", MISSING)
def test_a_missing_verdict_of_the_matcher_alone_never_holds_an_ask(agent_ns, text, draws, missing):
    held, judged, _inst = _corpus_hold(agent_ns, text, draws)
    assert held == {} and judged == ["judge"]


@pytest.mark.parametrize("text,draws", FOUND_TERSE)
def test_an_ask_whose_data_sits_in_an_abbreviated_column_with_no_description_is_never_held(agent_ns, text, draws):
    found = _found_by_the_matcher(agent_ns, text, draws)
    held, judged, inst = _corpus_hold(agent_ns, text, draws, TERSE, replies=(NO_DATA if found else NOT_BUILT,))
    assert held == {} and not inst.logger.matching("[IMPLEMENT-VIBES-NO-COLUMN FIRED]"), held
    assert judged == [] or not found


@pytest.mark.parametrize("text,draws,missing", MISSING_TERSE)
def test_an_abbreviated_schema_still_holds_data_it_truly_lacks(agent_ns, text, draws, missing):
    held, judged, _inst = _corpus_hold(agent_ns, text, draws, TERSE, replies=(NO_DATA,))
    assert f"holds {missing};" in held[agent_ns["IMPLEMENT_NOTEBOOK"]][text] and judged == ["judge"]


def test_earnings_kept_only_in_a_column_named_rev_is_unfound_by_the_matcher_alone(agent_ns):
    vocabulary = agent_ns["implement_vibes_held_terms"]({"main.fin.ledger": ["acct_id", "rev", "post_dt"]})
    assert agent_ns["implement_vibes_unfound"](_ask(EARNINGS, "kpi"), vocabulary) == ["earnings"]


@pytest.mark.parametrize("text", [INCOME, EARNINGS])
def test_a_synonym_kept_in_a_column_named_rev_is_never_held_when_the_model_finds_it(agent_ns, text):
    held, judged, inst = _corpus_hold(agent_ns, text, "kpi", LEDGER, replies=(_verdict("missing", "rev holds it"),))
    assert held == {} and judged == ["judge"]
    assert not inst.logger.matching("[IMPLEMENT-VIBES-HOLD FIRED]")


@pytest.mark.parametrize("text,named", [(INCOME, ""), (EARNINGS, "holds earnings;")])
def test_a_synonym_the_model_also_finds_missing_is_held(agent_ns, text, named):
    held, judged, _inst = _corpus_hold(agent_ns, text, "kpi", LEDGER, replies=(NO_DATA,))
    reason = held[agent_ns["IMPLEMENT_NOTEBOOK"]][text]
    assert reason.startswith(agent_ns["IMPLEMENT_VIBES_NO_DATA"]) and named in reason
    assert judged == ["judge"]
    if named:
        assert "main.fin.ledger" in reason, "a hold the matcher found names the tables it checked"


@pytest.mark.parametrize("text", [INCOME, EARNINGS])
@pytest.mark.parametrize("replies", [(RuntimeError("model endpoint 503"), RuntimeError("model endpoint 503")),
                                     ({"checks": []}, {"checks": []})])
def test_a_check_that_fails_twice_lets_genie_build_the_ask_and_logs_it(agent_ns, text, replies):
    held, judged, inst = _corpus_hold(agent_ns, text, "kpi", LEDGER, replies=replies)
    assert held == {} and judged == ["judge", "judge"], "the check is asked once more past the cache, then Genie tries"
    assert inst.logger.matching("[IMPLEMENT-VIBES-JUDGE-RETRY FIRED] N02-U05 before the build")
    assert inst.logger.matching("[IMPLEMENT-VIBES-HOLD-SKIPPED FIRED] N02-U05")
    shown = agent_ns["implement_choices_markdown"]({"data": {"notes": text}, "config": {}, "outputs": {}}, held=held)
    assert text in shown and "Never build them" not in shown, "Genie gets the ask with nothing held"


def test_the_check_before_the_build_sees_the_descriptions_and_that_names_can_differ(agent_ns):
    inst, prompts = _inspire(agent_ns, _tpch()), []

    def llm(kind, prompt, schema, skip_cache=False):
        if kind == "split":
            return {"asks": [_ask("Add a KPI for average rainfall", "kpi")]}
        prompts.append(prompt)
        return NO_DATA
    inst._implement_vibes_llm = llm
    inst._genie_involved_tables = lambda uc: list(TPCH)
    inst._implement_vibes_hold("N02-U05", {"use_case": "Review suppliers"}, {"data": {"notes": "rainfall"}, "outputs": {}}, {})
    [prompt] = prompts
    assert "How those tables and their columns are described:\n<<<\n" in prompt
    assert "samples.tpch.supplier: Vendors who sell parts to the business; Vendor name as printed on invoices" in prompt
    assert "a column rev can hold income" in prompt and "s_acctbal" in prompt


def test_the_corpus_is_big_enough_to_guard_over_refusal():
    assert len(FOUND) + len(FOUND_TERSE) >= 15 and len(MISSING) + len(MISSING_TERSE) >= 10
    assert len(FOUND) >= 15 and len(MISSING) >= 10
    assert not {t for t, _d in FOUND} & {t for t, _d, _m in MISSING}


def test_a_word_only_a_table_description_holds_is_never_held(agent_ns):
    held, _judged, _inst = _corpus_hold(agent_ns, "Add a chart of late lines by country", "chart")
    assert held == {}
    plain = {t: dict(e, comment="") for t, e in TPCH.items()}
    held, judged, _inst = _corpus_hold(agent_ns, "Add a chart of late lines by country", "chart", plain, replies=(NO_DATA,))
    assert held[agent_ns["IMPLEMENT_NOTEBOOK"]]["Add a chart of late lines by country"].startswith(agent_ns["IMPLEMENT_VIBES_NO_DATA"])
    assert judged == ["judge"]


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
