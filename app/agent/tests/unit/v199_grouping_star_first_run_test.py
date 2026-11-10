"""A star-schema fact table holds only key and number columns, so its key columns are grouping candidates and a first run on
1,000 records takes whole groups; chosen groups AND their parts and OR the groups, the old comma list reads the same way, and
above 1,000 records the default is always about 1,000 records, never a recent period or everything; a custom first run runs exactly
its saved SELECT of keys, offline. The groups cases are shared with runScope.js."""
import hashlib
import json
import os

import pytest

from v120_artifacts_support import FakeDimension, FakeSpark

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FIRST_RUN = json.load(open(os.path.join(ROOT, "tests", "fixtures", "implement_grouping_cases.json"), encoding="utf-8"))["first_run"]
GROUPS, SPEC = FIRST_RUN["groups"], FIRST_RUN["spec"]
SALES = "main.retail.store_sales"
STAR = [("ss_sold_date_sk", "int"), ("ss_item_sk", "int"), ("ss_customer_sk", "int"), ("ss_store_sk", "int"), ("ss_ticket_number", "bigint"),
        ("ss_quantity", "int"), ("ss_net_paid", "decimal(7,2)"), ("ss_sales_price", "decimal(7,2)"), ("ss_promo_sk", "bigint"),
        ("ss_customer_phone_sk", "int"), ("ss_hash", "int"), ("ss_created_at_sk", "int")]


class Frame:
    def __init__(self, columns, steps=()):
        self.columns, self.steps = list(columns), list(steps)
        self.dtypes = [(column, "string") for column in self.columns]

    def count(self):
        return 718931

    def where(self, condition):
        return Frame(self.columns, self.steps + [("where", condition)])

    def orderBy(self, column):
        return Frame(self.columns, self.steps + [("orderBy", column)])

    def limit(self, n):
        return Frame(self.columns, self.steps + [("limit", n)])

    def selectExpr(self, *exprs):
        return Frame(self.columns, self.steps + [("selectExpr", list(exprs))])

    def distinct(self):
        return Frame(self.columns, self.steps + [("distinct",)])

    def join(self, other, on, how):
        return Frame(self.columns, self.steps + [("join", other.steps, list(on), how)])


class Session(FakeSpark):
    def __init__(self, columns, responder=None, returned=None):
        super().__init__(responder=responder)
        self.columns, self.returned = columns, returned

    def table(self, name):
        return Frame(self.columns)

    def sql(self, statement, *args, **kwargs):
        if self.returned is None:
            return super().sql(statement, *args, **kwargs)
        self.statements.append(" ".join(str(statement).split()))
        if isinstance(self.returned, Exception):
            raise self.returned
        if str(statement).startswith("DESCRIBE TABLE"):
            return FakeRows([{"col_name": c, "data_type": "string"} for c in self.columns])
        return Frame(self.returned)


def _columns(pairs):
    return [{"column_name": n, "data_type": t} for n, t in pairs]


def _scope(spec=None, **values):
    return {"INSPIRE_RUN": {"scope": dict(SPEC, **(spec or {}))}, "INSPIRE_SCOPE_VALUES": values}


def test_a_star_fact_offers_its_low_cardinality_keys_and_never_a_measure_a_date_key_or_the_entity_key(agent_ns):
    roles = {"entity_id": f"{SALES}.ss_customer_sk", "measure": f"{SALES}.ss_net_paid"}
    picked = agent_ns["implement_grouping_candidates"](_columns(STAR), roles, SALES, ("text",), time_column="ss_sold_date_sk")
    assert "ss_store_sk" in picked and "ss_item_sk" in picked and "ss_promo_sk" in picked
    for left_out in ("ss_net_paid", "ss_sales_price", "ss_quantity", "ss_sold_date_sk", "ss_customer_sk", "ss_ticket_number", "ss_customer_phone_sk"):
        assert left_out not in picked, f"{left_out} is never a grouping candidate (must-exclude)"


def test_a_personal_column_is_never_a_candidate_by_name_or_by_tag(agent_ns):
    columns = _columns([("ss_store_sk", "int"), ("ss_customer_phone_sk", "int"), ("region", "string"), ("segment_code", "string")])
    columns[3]["tags"] = {"class": "pii"}
    picked = agent_ns["implement_grouping_candidates"](columns, {}, SALES)
    assert picked == ["region", "ss_store_sk"], "a phone column and a column tagged pii are never profiled (must-exclude)"


def test_the_primary_key_is_never_a_candidate(agent_ns):
    picked = agent_ns["implement_grouping_candidates"](_columns([("ss_store_sk", "int"), ("ss_item_sk", "int")]), {}, SALES, primary=["ss_item_sk"])
    assert picked == ["ss_store_sk"]


def test_text_and_key_candidates_take_turns_and_the_use_case_words_rank_them(agent_ns):
    columns = _columns([("channel", "string"), ("region", "string"), ("ss_item_sk", "int"), ("ss_store_sk", "int")])
    assert agent_ns["implement_grouping_candidates"](columns, {}, SALES) == ["channel", "ss_item_sk", "region", "ss_store_sk"]
    ranked = agent_ns["implement_grouping_candidates"](columns, {}, SALES, text="Forecast weekly sales for each store")
    assert ranked[0] == "ss_store_sk", ranked


@pytest.mark.parametrize("case", GROUPS["parse"], ids=[c["value"][:40] or "empty" for c in GROUPS["parse"]])
def test_scope_groups_parse_as_runscope_js_parses_them(agent_ns, case):
    assert agent_ns["inspire_scope_groups_of"](case["value"], case["finest"]) == case["groups"]


@pytest.mark.parametrize("case", GROUPS["format"], ids=[c["value"][:40] or "empty" for c in GROUPS["format"]])
def test_scope_groups_the_app_writes_read_back_as_the_same_groups(agent_ns, case):
    assert agent_ns["inspire_scope_groups_of"](case["value"], case["groups"][0][0]["column"] if case["groups"] else "") == case["groups"]


@pytest.mark.parametrize("case", GROUPS["text"], ids=[c["text"] for c in GROUPS["text"]])
def test_a_group_is_named_in_plain_words(agent_ns, case):
    assert agent_ns["inspire_scope_group_text"](case["group"]) == case["text"]


@pytest.mark.parametrize("case", GROUPS["whole_groups"], ids=[str(i) for i in range(len(GROUPS["whole_groups"]))])
def test_whole_groups_add_up_to_about_the_records_as_runscope_js_picks_them(agent_ns, case):
    assert agent_ns["inspire_whole_groups"](case["sizes"], case["target"]) == case["picked"]


def test_a_legacy_comma_list_reads_the_same_values_and_the_same_scope_key_as_before(agent_ns):
    chosen = agent_ns["inspire_scope_choice"](scope=_scope(run_scope="groups", scope_groups="EMEA, APAC, all"))
    assert chosen == {"scope": "groups", "table": "main.sales.orders", "column": "region", "values": ["EMEA", "APAC"]}
    defined = {"scope": "groups", "table": "main.sales.orders", "column": "region", "days": None, "values": ["EMEA", "APAC"], "records": None}
    before = "groups:" + hashlib.sha256(json.dumps(defined, sort_keys=True).encode("utf-8")).hexdigest()[:16]
    assert agent_ns["inspire_scope_key"](chosen) == before, "a run of an old comma list compares with the runs before it"


def test_and_groups_are_applied_at_run_time_with_a_joined_part_read_through_its_dimension(fresh_ns):
    value = GROUPS["parse"][7]["value"]
    chosen = fresh_ns["inspire_scope_choice"](scope=_scope({"table": SALES}, run_scope="groups", scope_groups=value))
    assert chosen["values"] == ["state = CA and item.i_category = Electronics", "state = NY and item.i_category = Home"] and chosen["column"] == ""

    def respond(statement):
        if "FROM `main`.`retail`.`item`" in statement:
            return [{"k": "11"}, {"k": "12"}] if "'Electronics'" in statement else [{"k": "21"}]
        return []
    spark = FakeSpark(responder=respond)
    resolved = fresh_ns["inspire_scope_resolve"](spark, chosen)
    assert spark.statements[0] == ("SELECT `_inspire_group_join_key` AS k FROM (SELECT `_inspire_group_join_key`, MAX(`_inspire_group_join_value`) "
                                   "AS `i_category` FROM (SELECT CAST(`i_item_sk` AS STRING) AS `_inspire_group_join_key`, `i_category` AS "
                                   "`_inspire_group_join_value` FROM `main`.`retail`.`item` WHERE `i_item_sk` IS NOT NULL) AS d GROUP BY "
                                   "`_inspire_group_join_key`) AS g WHERE CAST(`i_category` AS STRING) = 'Electronics' ORDER BY k LIMIT 10001")
    fresh_ns["INSPIRE_SCOPE"], fresh_ns["INSPIRE_RUN_LOG"] = resolved, {}
    frame = fresh_ns["inspire_read_source"](SALES, spark=Session(["State", "ss_item_sk", "ss_net_paid"]))
    assert frame.steps == [("where", "((CAST(`State` AS STRING) = 'CA' AND CAST(`ss_item_sk` AS STRING) IN ('11', '12')) OR "
                                     "(CAST(`State` AS STRING) = 'NY' AND CAST(`ss_item_sk` AS STRING) IN ('21')))")]
    assert fresh_ns["inspire_read_source"](SALES, spark=Session(["ss_item_sk"])).steps == [], \
        "a table that lacks a part's column is read whole and the join narrows it"
    assert fresh_ns["inspire_read_source"]("main.retail.item", spark=Session(["State", "ss_item_sk", "i_category"])).steps == [], \
        "the dimension is read whole even when it holds the parts' columns"
    text = fresh_ns["inspire_scope_text"](resolved)
    assert text == "the 2 groups state = CA and item.i_category = Electronics; state = NY and item.i_category = Home"
    record = fresh_ns["inspire_scope_record"](resolved)
    assert record["groups"][0][1] == {"column": "item.i_category", "value": "Electronics",
                                      "join": {"table": "main.retail.item", "key": "ss_item_sk", "ref_column": "i_item_sk"}}
    assert "keys" not in json.dumps(record["groups"]) and record["key"] != fresh_ns["inspire_scope_key"](dict(resolved, groups=resolved["groups"][:1]))


def test_a_joined_part_with_no_key_is_refused_with_what_to_choose(agent_ns):
    chosen = agent_ns["inspire_scope_choice"](scope=_scope(run_scope="groups", scope_groups=GROUPS["parse"][7]["value"]))
    with pytest.raises(ValueError) as caught:
        agent_ns["inspire_scope_resolve"](FakeSpark(responder=lambda s: []), chosen)
    assert "no i_item_sk there has item.i_category Electronics" in str(caught.value) and "; choose" in str(caught.value)


ITEM_JOIN = {"table": "main.retail.item", "key": "ss_item_sk", "ref_column": "i_item_sk"}


class _DimensionSession:
    def __init__(self, frame):
        self.frame, self.tables, self.steps = frame, [], []

    def table(self, name):
        self.tables.append(name)
        return FakeDimension(self.frame, self.steps)


def _sqlite_spark(rows):
    import sqlite3
    db = sqlite3.connect(":memory:")
    db.execute("CREATE TABLE item (i_item_sk TEXT, i_category TEXT)")
    db.executemany("INSERT INTO item VALUES (?, ?)", rows)

    def respond(statement):
        ran = db.execute(statement.replace("`main`.`retail`.`item`", "item").replace(" AS STRING)", " AS TEXT)"))
        return [dict(zip([d[0] for d in ran.description], r)) for r in ran.fetchall()]
    return FakeSpark(responder=respond)


def test_grouping_and_the_first_run_read_a_joined_column_through_the_one_join_and_select_the_same_records(fresh_ns):
    pd = pytest.importorskip("pandas")
    rows = [("1", "Electronics"), ("2", "Home"), ("2", "Electronics"), ("3", "Electronics"), ("4", "Books"), (None, "Electronics")]
    join = fresh_ns["inspire_group_join"]("item.i_category", ITEM_JOIN)
    key, value = fresh_ns["INSPIRE_GROUP_JOIN_KEY"], fresh_ns["INSPIRE_GROUP_JOIN_VALUE"]
    assert join["where"] in join["sql"] and all(picked in join["sql"] for picked in join["select"])
    assert f"MAX(`{value}`) AS `i_category`" in join["sql"] and f"GROUP BY `{key}`" in join["sql"]

    records = pd.DataFrame({"ss_item_sk": [1, 2, 3, 4, 5] * 12, "ss_net_paid": [1.0] * 60})
    session = _DimensionSession(pd.DataFrame(rows, columns=["i_item_sk", "i_category"]))
    fresh_ns["INSPIRE_RUN"], fresh_ns["INSPIRE_RUN_LOG"] = {"grouping": {"joins": {"item.i_category": ITEM_JOIN}}}, {}
    joined = fresh_ns["inspire_group_joined"](records, ["item.i_category"], out=lambda *_a: None, spark_session=session)
    assert session.steps == [("where", join["where"]), ("selectExpr", join["select"]), ("groupBy", key), ("agg", {value: "max"}),
                             ("toDF", [key, "i_category"])], "grouping reads the dimension through the one join"
    grouped = {str(k) for k in joined.loc[joined["i_category"] == "Electronics", "ss_item_sk"]}

    fresh_ns["INSPIRE_RUN_LOG"] = {}
    group = [{"column": "item.i_category", "value": "Electronics", "join": dict(ITEM_JOIN)}]
    spark = _sqlite_spark(rows)
    resolved = fresh_ns["inspire_scope_resolve"](spark, {"scope": "groups", "table": SALES, "column": "", "groups": [group]})
    assert spark.statements == [fresh_ns["inspire_scope_part_keys_sql"](join, "Electronics")] and join["sql"] in spark.statements[0]
    scoped = set(resolved["groups"][0][0]["keys"])
    assert scoped == grouped == {"1", "3"}, "the first run takes exactly the records grouping puts in the group"
    assert "2" not in scoped and "None" not in scoped, "a key the dimension files under another value and a missing key are left out (must-exclude)"
    assert fresh_ns["INSPIRE_RUN_LOG"] == {}, "resolving the first run reads no source, so the run log is unchanged"


@pytest.mark.parametrize("join", [None, {}, dict(ITEM_JOIN, ref_column=""), dict(ITEM_JOIN, key="  "), dict(ITEM_JOIN, table=None)],
                         ids=["none", "empty", "no_ref", "blank_key", "no_table"])
def test_a_joined_column_that_cannot_be_reached_stops_grouping_and_the_first_run_and_reads_nothing(fresh_ns, join):
    pd = pytest.importorskip("pandas")
    assert fresh_ns["inspire_group_join"]("item.i_category", join) is None
    session = _DimensionSession(pd.DataFrame({"i_item_sk": ["1"], "i_category": ["Electronics"]}))
    fresh_ns["INSPIRE_RUN"] = {"grouping": {"joins": {"item.i_category": join} if join is not None else {}}}
    with pytest.raises(fresh_ns["InspireRunStop"], match=r"the Grouping names item\.i_category, a column of another table, but this run's plan "
                                                          r"carries no join to that table, so the records have no item\.i_category to group by"):
        fresh_ns["inspire_group_joined"](pd.DataFrame({"ss_item_sk": [1]}), ["item.i_category"], out=lambda *_a: None, spark_session=session)
    assert session.tables == []
    spark = FakeSpark()
    if not join:
        group = [{"column": "state", "value": "CA"}, {"column": "item.i_category", "value": "Electronics"}]
        with pytest.raises(ValueError, match=r"First run group state = CA and item\.i_category = Electronics names item\.i_category, a column of "
                                             r"another table, but carries no join to that table, so the records have no item\.i_category to choose; "
                                             r"choose the groups again on the Run page"):
            fresh_ns["inspire_scope_resolve"](spark, {"scope": "groups", "table": SALES, "column": "", "groups": [group]})
        assert spark.statements == [], "a joined column with no join never falls back to reading the main table"
        return
    group = [{"column": "state", "value": "CA"}, {"column": "item.i_category", "value": "Electronics", "join": join}]
    with pytest.raises(ValueError, match=r"First run group state = CA and item\.i_category = Electronics names item\.i_category through a join "
                                         r"that is named only in part; choose the groups again on the Run page"):
        fresh_ns["inspire_scope_resolve"](spark, {"scope": "groups", "table": SALES, "column": "", "groups": [group]})
    assert spark.statements == []


def test_a_first_run_on_records_of_a_grouping_technique_takes_whole_groups_and_never_cuts_one(fresh_ns):
    chosen = fresh_ns["inspire_scope_choice"](scope=_scope(run_scope="records", scope_records="1000"))
    assert chosen == {"scope": "records", "table": "main.sales.orders", "records": 1000, "key": "order_id", "column": "region", "whole_groups": True,
                      "technique": "Anomaly Detection"}
    sizes = [{"g": "EMEA", "n": 600}, {"g": "APAC", "n": 500}, {"g": "LATAM", "n": 300}]
    spark = FakeSpark(responder=lambda s: sizes if s.startswith("SELECT CAST(`region`") else [])
    resolved = fresh_ns["inspire_scope_resolve"](spark, chosen)
    assert spark.statements == ["SELECT CAST(`region` AS STRING) AS g, COUNT(*) AS n FROM `main`.`sales`.`orders` WHERE `region` IS NOT NULL "
                                "GROUP BY CAST(`region` AS STRING) HAVING COUNT(*) >= 30 ORDER BY n DESC, g LIMIT 500"]
    assert resolved["values"] == ["EMEA", "APAC", "LATAM"], "at least three whole groups when three fit, even past about 1,000"
    fresh_ns["INSPIRE_SCOPE"], fresh_ns["INSPIRE_RUN_LOG"] = resolved, {}
    frame = fresh_ns["inspire_read_source"]("main.sales.orders", spark=Session(["order_id", "region"]))
    assert frame.steps == [("where", "CAST(`region` AS STRING) IN ('EMEA', 'APAC', 'LATAM')")], "whole groups are filtered, never cut to N rows"
    assert fresh_ns["inspire_scope_text"](resolved) == ("1,400 records of main.sales.orders, in 3 whole groups, so the First run sees more than "
                                                        "one group and no group is cut: region = EMEA, 600 records; region = APAC, 500 records; "
                                                        "region = LATAM, 300 records")
    assert fresh_ns["inspire_scope_record"](resolved)["whole_groups"] is True


def test_when_every_group_holds_more_than_1000_records_the_smallest_whole_group_runs_and_its_real_count_is_named(fresh_ns):
    chosen = fresh_ns["inspire_scope_choice"](scope=_scope(run_scope="records", scope_records="1000"))
    sizes = [{"g": "EMEA", "n": 480000}, {"g": "APAC", "n": 470000}]
    resolved = fresh_ns["inspire_scope_resolve"](FakeSpark(responder=lambda s: sizes if s.startswith("SELECT CAST(`region`") else []), chosen)
    assert resolved["values"] == ["APAC"], "never a cut group, so the smallest whole group"
    text = fresh_ns["inspire_scope_text"](resolved)
    assert text == "470,000 records of main.sales.orders, all of region = APAC, the smallest group, since every group holds more than 1,000 records", text
    assert "about 1000" not in text, "a group far above 1,000 records is never called about 1,000 records (must-exclude)"


def test_a_standalone_technique_still_runs_on_the_first_records(agent_ns):
    chosen = agent_ns["inspire_scope_choice"](scope=_scope({"technique": "Sentiment Analysis"}, run_scope="records", scope_records="500"))
    assert chosen == {"scope": "records", "table": "main.sales.orders", "records": 500, "key": "order_id"}


def test_above_1000_records_the_default_is_about_1000_records_and_never_a_recent_period_or_everything(agent_ns):
    for case in FIRST_RUN["default"]:
        if case["records"] is not None and case["records"] > 1000:
            got = agent_ns["inspire_scope_default"]({"table": SALES, "records": case["records"]})
            assert got == "records" and got not in ("all", "recent", "groups", ""), f"{case['name']} (must-exclude)"
    assert "inspire_default_scope" not in agent_ns, "one rule picks the first run default"
    for known in (0, 1, 999, 1000, 1001, 10 ** 9):
        assert agent_ns["inspire_scope_default"]({"table": SALES, "records": known}) == "records", f"{known} records never default to everything"
    for unknown in (None, "1000", True, float("nan")):
        assert agent_ns["inspire_scope_default"]({"table": SALES, "records": unknown}) == "records"
    assert agent_ns["inspire_scope_default"]({"table": SALES, "records": 400, "default": "all"}) == "records", (
        "a build that suggested all for a small table now runs first on records (must-exclude)")
    assert agent_ns["inspire_scope_default"]({"records": 400}) == "all", "with no main table there is nothing to take a first run of"
    assert agent_ns["inspire_scope_default"]({"table": SALES, "records": None, "default": "groups"}) == "groups", "a default the build recorded is kept"
    unknown = agent_ns["inspire_scope_settings"](dict({k: v for k, v in SPEC.items() if k != "default"}, records=None))[0]
    assert unknown["default"] == "records" and unknown["reason"] == ("Inspire could not read from its metadata how many records the main "
                                                                      "table holds, so the First run covers about 1,000 records in whole "
                                                                      "groups of region, so no group is cut"), unknown["reason"]
    small = agent_ns["inspire_scope_settings"](dict({k: v for k, v in SPEC.items() if k != "default"}, records=400))[0]
    assert (small["default"], small["reason"]) == ("records", "Inspire's default: the main table holds 400 records, so a First run of about "
                                                             "1,000 records covers all of it")
    held = _scope({"default": "records", "records": 718931})
    assert agent_ns["inspire_scope_choice"](scope=dict(held, INSPIRE_SCOPE_VALUES={"run_scope": "all"}))["scope"] == "all", \
        "everything still runs when someone chooses it"
    reason = agent_ns["inspire_scope_settings"](dict(SPEC, default="records", records=718931))[0]["reason"]
    assert reason.endswith("so the First run covers about 1,000 records in whole groups of region, so no group is cut"), reason


def test_with_no_column_to_group_by_the_first_run_takes_the_first_records_with_a_plain_note(fresh_ns):
    chosen = fresh_ns["inspire_scope_choice"](scope=_scope({"group_column": "", "records": 718931}, run_scope="records"))
    assert chosen == {"scope": "records", "table": "main.sales.orders", "records": 1000, "key": "order_id", "cut": "Anomaly Detection"}
    fresh_ns["INSPIRE_SCOPE"], fresh_ns["INSPIRE_RUN_LOG"] = chosen, {}
    fresh_ns["_inspire_spread_expr"] = lambda spread: spread
    frame = fresh_ns["inspire_read_source"]("main.sales.orders", spark=Session(["order_id", "region"]))
    assert frame.steps == [("orderBy", "xxhash64(CAST(`order_id` AS STRING), CAST(`region` AS STRING))"), ("limit", 1000)]
    assert fresh_ns["inspire_scope_text"](chosen) == ("1,000 records of main.sales.orders spread across the whole table, picked by a stable hash of "
                                                      "each record; Anomaly Detection reads records together and main.sales.orders has no column "
                                                      "to take whole groups of, so a group may be cut in this First run")
    reason = fresh_ns["inspire_scope_settings"](dict(SPEC, group_column="", default="records", records=718931))[0]["reason"]
    assert reason.endswith("1,000 records spread across the whole table, picked by a stable hash of each record; Anomaly Detection reads "
                           "records together and no column groups them, so a group may be cut")


def test_with_no_group_of_30_records_the_whole_groups_fall_back_to_the_first_records_with_a_note(fresh_ns):
    chosen = fresh_ns["inspire_scope_choice"](scope=_scope(run_scope="records"))
    resolved = fresh_ns["inspire_scope_resolve"](FakeSpark(responder=lambda s: []), chosen)
    assert resolved == {"scope": "records", "table": "main.sales.orders", "records": 1000, "key": "order_id", "cut": "Anomaly Detection",
                        "cut_column": "region"}
    assert "has no group of region with 30 records or more, so a group may be cut" in fresh_ns["inspire_scope_text"](resolved)


def test_two_groups_or_together_and_a_record_outside_both_is_left_out(fresh_ns):
    import sqlite3
    chosen = fresh_ns["inspire_scope_choice"](scope=_scope(run_scope="groups", scope_groups=(
        '[[{"column":"region","value":"EMEA"},{"column":"channel","value":"web"}],[{"column":"region","value":"APAC"}]]')))
    where = fresh_ns["inspire_scope_where"](fresh_ns["inspire_scope_resolve"](FakeSpark(), chosen), ["region", "channel", "order_id"])
    assert where == "((CAST(`region` AS STRING) = 'EMEA' AND CAST(`channel` AS STRING) = 'web') OR (CAST(`region` AS STRING) = 'APAC'))"
    db = sqlite3.connect(":memory:")
    db.execute("CREATE TABLE orders (order_id INTEGER, region TEXT, channel TEXT)")
    db.executemany("INSERT INTO orders VALUES (?, ?, ?)", [(1, "EMEA", "web"), (2, "EMEA", "store"), (3, "APAC", "store"), (4, "LATAM", "web"),
                                                          (5, "APAC", "web")])
    kept = [r[0] for r in db.execute("SELECT order_id FROM orders WHERE " + where.replace("`", '"').replace(" AS STRING)", " AS TEXT)")
                                     + " ORDER BY order_id")]
    assert kept == [1, 3, 5], "EMEA in store (2) fails the AND and LATAM (4) is in no group (must-exclude)"


@pytest.mark.parametrize("asked", ["custom", "Custom"])
def test_a_saved_custom_first_run_runs_the_plain_default_with_a_note_and_no_sql(fresh_ns, asked):
    said = []
    plain = fresh_ns["inspire_scope_choice"](scope=_scope(run_scope=asked), out=said.append)
    default = fresh_ns["inspire_scope_choice"](scope=_scope(), out=lambda *_a: None)
    assert plain == default, "a saved custom first run runs what the default first run runs"
    assert [line for line in said if "First run" in line and "build the MVP again" in line], said
    assert fresh_ns["inspire_scope_choice"](scope=_scope(run_scope="all")) == {"scope": "all", "table": "main.sales.orders"}, "a first run choice still runs"
    for name in ("inspire_scope_custom", "inspire_grouping_sql_check", "inspire_group_custom", "inspire_group_sql_saved", "implement_grouping_sql_check"):
        assert name not in fresh_ns, f"{name} is gone, so no typed SQL can run"


def test_the_grouping_stop_still_reads_as_before(agent_ns):
    assert str(agent_ns["inspire_group_stop"]("x", {})) == ("Grouping: x, so this run stopped before it scored any record; change the grouping "
                                                          "on the Run page of this use case in the Inspire App")


def test_a_grouping_that_names_a_joined_column_stops_the_run_and_never_groups_globally(fresh_ns):
    pd = pytest.importorskip("pandas")
    records = pd.DataFrame({"ss_item_sk": [1, 2, 3] * 20, "ss_store_sk": [1, 2] * 30, "ss_net_paid": [1.5] * 60})
    fresh_ns.pop("INSPIRE_RUN_GROUPING", None)
    with pytest.raises(fresh_ns["InspireRunStop"], match=r"names item\.i_category, a column of another table, but this run's plan carries no join to that table, so the records have no item\.i_category to group by, so this run stopped before it scored any record"):
        fresh_ns["inspire_group_records"](records, group_by="ss_store_sk, item.i_category", out=lambda *_a: None)
    assert "INSPIRE_RUN_GROUPING" not in fresh_ns
    grouped = fresh_ns["inspire_group_records"](records, group_by="ss_store_sk", out=lambda *_a: None)
    assert fresh_ns["INSPIRE_RUN_GROUPING"]["group_by"] == ["ss_store_sk"] and len(grouped) == 60


class FakeRows:
    def __init__(self, rows):
        self.rows = rows

    def collect(self):
        return list(self.rows)
