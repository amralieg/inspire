"""v1.4.0 use-case kinds: Deep discovery records the grouping and the record level each grouping use case needs.

1. The suggestion comes only from the aggregates Deep already read: distinct counts, null shares, top value shares and
   measured join match rates, with the App's thresholds (2 to 500 groups, 30 records per group on average).
2. A fact table's integer key is a grouping column; a dimension column one join away is too; a near-unique column,
   a measure, a date key and a personal column never are.
3. A column the model names for the use case is preferred, but only when the aggregate check passes it.
4. Standard mode records nothing; the fields go to __inspire_usecases, the Excel/CSV export and the JSON catalog.
5. A build with no Grouping chosen starts from the Deep suggestion and records it as chosen by Deep discovery; it is the
   person's only once they pick it or another grouping.
6. A joined grouping column carries its join (main key, dimension table, dimension key) from Deep discovery through the
   use case's table joins into the run plan, and the run joins it itself; a column the records cannot get stops the run.
"""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v120_artifacts_support import FakeDimension, FakeSpark, make_inspire, make_uc  # noqa: E402
from _agentload import agent_source  # noqa: E402

SALES = "main.s.sales"
ITEM = "main.s.item"
STORE = "main.s.store"
ROWS = 120000
ITEM_JOIN = {"table": SALES, "column": "item_sk", "ref_table": ITEM, "ref_column": "item_sk", "source": "deep_discovery",
             "confidence": 0.98}
FIXTURE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures", "implement_grouping_cases.json")


def col(distinct, family="numeric", null_share=0.0, top_values=None):
    info = {"distinct": distinct, "type_family": family, "null_share": null_share}
    if top_values is not None:
        info["top_values"] = top_values
    return info


def even(names):
    return [{"value": name, "share": round(1 / len(names), 4)} for name in names]


def star(with_item=False, sales_extra=None):
    sales = {"sold_date_sk": col(365), "store_sk": col(12), "item_sk": col(18000), "customer_sk": col(50000),
             "ticket_number": col(119500), "quantity": col(100), "net_paid": col(90000),
             "customer_email": col(49000, "string"),
             "promo_code": col(2, "string", top_values=[{"value": "NONE", "share": 0.9999}, {"value": "SPRING", "share": 0.0001}]),
             **(sales_extra or {})}
    profiles = {SALES: {"rows": ROWS, "sampled": False, "columns": sales},
                STORE: {"rows": 12, "sampled": False, "columns": {"store_sk": col(12), "store_name": col(12, "string")}}}
    joins = [{"child_table": SALES, "child_column": "store_sk", "parent_table": STORE, "parent_column": "store_sk", "rate": 1.0}]
    if with_item:
        profiles[ITEM] = {"rows": 18000, "sampled": False, "columns": {
            "item_sk": col(18000), "category": col(10, "string", top_values=even([f"c{i}" for i in range(10)])),
            "class_name": col(100, "string"), "manager_email": col(5, "string"), "item_description": col(8, "string"),
            "rec_start_date": col(4, "temporal")}}
        joins.append({"child_table": SALES, "child_column": "item_sk", "parent_table": ITEM, "parent_column": "item_sk", "rate": 0.98})
    return profiles, joins


def suggest(agent_ns, technique="Anomaly Detection", profiles=None, joins=(), personal=None, proposed=(), table=SALES):
    personal = personal or (lambda _table, column: agent_ns["deep_column_is_pii"](column))
    return agent_ns["deep_grouping_suggestion"](technique, table, profiles, joins, personal, proposed,
                                                agent_ns["DatabricksInspire"]._TEXT_NAME_TOKENS, 1000000)


def test_a_star_fact_with_integer_keys_is_grouped_by_its_store_key(agent_ns):
    profiles, joins = star()
    found = suggest(agent_ns, profiles=profiles, joins=joins)
    assert found == {"group_by": ["store_sk"], "record_level": "ticket_number", "joins": []}


def test_the_measure_the_date_key_and_a_dominated_flag_are_never_the_grouping(agent_ns):
    profiles, joins = star()
    profiles[SALES]["columns"]["store_sk"] = col(12, null_share=0.6)
    found = suggest(agent_ns, profiles=profiles, joins=joins)
    assert found["group_by"] == ["store.store_name"], "a key more than half NULL is dropped; its store dimension stays"
    for never in ("quantity", "sold_date_sk", "promo_code", "net_paid"):
        assert never not in found["group_by"]


def test_a_dimension_column_one_join_away_is_suggested_and_nests_over_its_key(agent_ns):
    profiles, joins = star(with_item=True)
    found = suggest(agent_ns, profiles=profiles, joins=joins)
    assert found["group_by"] == ["item.category"]
    assert "item.manager_email" not in found["group_by"] and "item.item_description" not in found["group_by"]
    assert found["joins"] == [ITEM_JOIN], "the join Deep measured travels with the joined column"


def test_a_near_unique_column_and_too_few_records_per_group_are_not_suggested(agent_ns):
    table = "main.s.orders"
    profiles = {table: {"rows": 9000, "sampled": False, "columns": {
        "region": col(6, "string"), "invoice_code": col(8900, "string"), "batch": col(400, "string"), "branch": col(300, "string")}}}
    found = suggest(agent_ns, profiles=profiles, table=table)
    assert found == {"group_by": ["region"], "record_level": "invoice_code", "joins": []}
    profiles[table]["columns"].pop("region")
    assert suggest(agent_ns, profiles=profiles, table=table)["group_by"] == ["branch"], "300 groups of 30 records pass; 400 of 22.5 do not"
    profiles[table]["columns"]["branch"] = col(301, "string")
    assert suggest(agent_ns, profiles=profiles, table=table)["group_by"] == []


def test_the_record_level_falls_back_to_the_table_and_reads_the_sample_size(agent_ns):
    table = "main.s.events"
    profiles = {table: {"rows": 5000000, "sampled": True, "columns": {"site_code": col(40, "string"), "event_ref": col(990000, "string")}}}
    assert suggest(agent_ns, profiles=profiles, table=table) == {"group_by": ["site_code"], "record_level": "event_ref", "joins": []}
    profiles[table]["columns"]["event_ref"] = col(500000, "string")
    assert suggest(agent_ns, profiles=profiles, table=table)["record_level"] == "events"


def test_a_column_the_model_names_wins_only_when_the_aggregates_pass_it(agent_ns):
    profiles, joins = star(with_item=True)
    assert suggest(agent_ns, profiles=profiles, joins=joins, proposed=["store_sk"])["group_by"] == ["store_sk"]
    assert suggest(agent_ns, profiles=profiles, joins=joins, proposed=["ticket_number"])["group_by"] == ["item.category"]
    assert suggest(agent_ns, profiles=profiles, joins=joins, proposed=["customer_email"])["group_by"] == ["item.category"]


def test_only_a_grouping_technique_gets_a_suggestion(agent_ns):
    profiles, joins = star()
    assert suggest(agent_ns, technique="Sentiment Analysis", profiles=profiles, joins=joins) is None
    assert suggest(agent_ns, technique="Forecasting", profiles=profiles, joins=joins)["group_by"] == ["store_sk"]
    assert suggest(agent_ns, profiles=profiles, joins=joins, table="main.s.missing") is None


def _deep_inspire(agent_ns, profiles, joins, discovery_type="Deep", pii=()):
    spark = FakeSpark(responder=lambda statement: (_ for _ in ()).throw(AssertionError(f"no read expected: {statement}")))
    obj = make_inspire(agent_ns, spark=spark, discovery_type=discovery_type,
                       discovery_evidence={"profiles": profiles, "join_matches": joins},
                       deep_evidence=type("Deep", (), {"pii_excluded": set(pii), "sample_rows": 1000000})(),
                       data_loader=None)
    return obj, spark


def test_a_personal_column_is_never_suggested_and_nothing_is_read(agent_ns):
    profiles, joins = star(sales_extra={"loyalty_tier": col(4, "string", top_values=even(["a", "b", "c", "d"]))})
    obj, spark = _deep_inspire(agent_ns, profiles, joins)
    ucs = [make_uc("N01-U01", **{"Analytics Technique": "Anomaly Detection", "Primary Table": SALES})]
    assert obj._suggest_deep_grouping(ucs) == ucs and ucs[0]["suggested_group_by"] == "loyalty_tier"
    obj, spark = _deep_inspire(agent_ns, profiles, joins, pii=[f"{SALES}.loyalty_tier"])
    ucs = [make_uc("N01-U01", **{"Analytics Technique": "Anomaly Detection", "Primary Table": f"`main`.`s`.`sales`",
                                 "data_signal": {"columns": {"group": "loyalty_tier"}}})]
    obj._suggest_deep_grouping(ucs)
    assert ucs[0]["suggested_group_by"] == "store_sk" and ucs[0]["record_level"] == "ticket_number"
    assert spark.statements == []
    assert any("[DEEP-GROUPING FIRED]" in msg and "1 of 1 grouping use case" in msg for _level, msg in obj.logger.records)


def test_both_modes_suggest_the_same_grouping_and_nothing_without_profiles(agent_ns):
    profiles, joins = star()
    found = {}
    for mode in ("Standard Discovery", "AI Enhanced Discovery"):
        obj, spark = _deep_inspire(agent_ns, profiles, joins, discovery_type=mode)
        ucs = [make_uc("N01-U01", **{"Analytics Technique": "Anomaly Detection", "Primary Table": SALES})]
        obj._suggest_deep_grouping(ucs)
        found[mode] = (ucs[0].get("suggested_group_by"), ucs[0].get("record_level"))
        assert spark.statements == []
    assert found["Standard Discovery"] == found["AI Enhanced Discovery"] and found["Standard Discovery"][1] is not None
    obj, _spark = _deep_inspire(agent_ns, {}, [], discovery_type="Standard Discovery")
    ucs = [make_uc("N01-U01", **{"Analytics Technique": "Anomaly Detection", "Primary Table": SALES})]
    assert obj._suggest_deep_grouping(ucs) == [] and "suggested_group_by" not in ucs[0]


def test_the_run_sets_the_suggestion_once_after_the_primary_table_and_before_the_final_gate():
    source = agent_source()
    call = "            self._suggest_deep_grouping(final_consolidated_use_cases)\n"
    assert source.count(call) == 1
    at = source.index(call)
    assert source.rindex("uc['Primary Table'] = self._extract_primary_table(tables_involved)", 0, at) < at
    assert at < source.index("_L_results = self._phaseL_final_gate(final_consolidated_use_cases", at)


def test_the_suggestion_is_written_to_the_tracking_table_by_name(agent_ns):
    di = agent_ns["DatabricksInspire"]
    names = [field.name for field in di._get_tracking_full_schema().fields]
    migrated = [name for name, _kind in di._TRACKING_MIGRATION_COLUMNS]
    uc = make_uc("N01-U01", suggested_group_by="item.category, store_sk", record_level="ticket_number")
    row = di._uc_to_row(uc, 1, lambda usecase, name: name)
    assert len(row) == len(names)
    assert row[names.index("suggested_group_by")] == "item.category, store_sk" and row[names.index("record_level")] == "ticket_number"
    assert {"suggested_group_by", "record_level"} <= set(migrated)
    blank = di._uc_to_row(make_uc("N01-U02"), 1, lambda usecase, name: name)
    assert blank[names.index("suggested_group_by")] is None and blank[names.index("record_level")] is None
    back = make_inspire(agent_ns)._row_to_uc(dict(zip(names, row)))
    assert (back["suggested_group_by"], back["record_level"]) == ("item.category, store_sk", "ticket_number")


def test_the_excel_and_csv_export_carry_the_suggestion_only_when_deep_recorded_one(agent_ns):
    obj = make_inspire(agent_ns)
    plain = make_uc("N01-U01")
    headers, rows, _numeric = obj._catalog_export_table({"Sales": [plain]})
    assert "Suggested Grouping" not in headers and "Record Level" not in headers
    grouped = make_uc("N01-U02", suggested_group_by="item.category", record_level="ticket_number")
    headers, rows, _numeric = obj._catalog_export_table({"Sales": [grouped, make_uc("N01-U03")]})
    at = headers.index("Suggested Grouping")
    assert headers[at - 1] == "Primary Table" and headers[at + 1] == "Record Level"
    assert [row[at] for row in rows] == ["item.category", ""] and [row[at + 1] for row in rows] == ["ticket_number", ""]
    ts = agent_ns["TranslationService"]
    arabic = dict(ts.ENGLISH_TRANSLATIONS, **ts.TRANSLATION_FALLBACKS["Arabic"])
    translated = [h for h, _get, _numeric in obj._export_columns(False, False, arabic, "Arabic", show_grouping=True)]
    assert ts.TRANSLATION_FALLBACKS["Arabic"]["doc_suggested_group_by"] in translated and "Suggested Grouping" not in translated


def test_the_json_catalog_keeps_the_suggestion_on_the_use_case(agent_ns):
    obj = make_inspire(agent_ns)
    uc = make_uc("N01-U01", suggested_group_by="store_sk", record_level="ticket_number")
    payload = obj._catalog_json_payload({"Sales": [uc]}, {}, "", "Acme Use Cases Catalog")
    kept = payload["domains"][0]["use_cases"][0]
    assert (kept["suggested_group_by"], kept["record_level"]) == ("store_sk", "ticket_number")


def test_a_run_resolves_a_joined_grouping_column_to_the_records_own_column(agent_ns):
    of = agent_ns["inspire_group_column_of"]
    assert of("item.category", {"category": "Category"}) == "Category"
    assert of("store_sk", {"store_sk": "store_sk"}) == "store_sk"
    assert of("item.category", {"class_name": "class_name"}) is None and of("category", {"item.category": "x"}) is None
    problems = agent_ns["implement_grouping_proof_problems"]
    record = {"mode": "columns", "group_by": ["Category"], "groups": 10}
    assert problems(record, "item.category", 7) == []
    assert problems(record, "item.class_name", 7) != []
    assert problems({"mode": "columns", "group_by": ["Category", "store_sk"], "groups": 10}, "item.category", 7) != []


def test_a_first_run_on_groups_reads_the_finest_column_of_the_main_table_never_a_joined_one(agent_ns):
    column = agent_ns["inspire_scope_column"]
    assert column({}, {"group_by": "item.category, store_sk"}) == "store_sk"
    assert column({"group_column": "region"}, {"group_by": "item.category"}) == "region"
    assert column({}, {"group_by": "region, store_sk"}) == "store_sk"
    assert column({"group_column": "region"}, {"group_by": "all"}) == "region"


def test_the_build_instruction_says_how_to_bring_a_joined_grouping_column_in(agent_ns):
    rule = agent_ns["genie_grouping_rule"]
    joined = rule({"columns": ["item.category", "store_sk"]})
    assert "one join away" in joined and "under its own name" in joined
    assert "one join away" not in rule({"columns": ["store_sk"]})


def test_a_build_with_no_grouping_chosen_starts_from_the_deep_suggestion(agent_ns):
    plan = agent_ns["implement_grouping_plan"]("Anomaly Detection", [], "", "", ["item.category"], "deep")
    assert plan["applies"] and plan["default"] == "item.category" and plan["columns"] == ["item.category"]
    assert plan["chosen_by"] == "deep"
    assert agent_ns["implement_grouping_plan"]("Anomaly Detection", [], "", "", ["region"])["chosen_by"] == "Inspire"
    person = agent_ns["implement_grouping_plan"]("Anomaly Detection", ["region"], "region", "", [])
    assert person["default"] == "region" and person["chosen_by"] == "person"
    obj = make_inspire(agent_ns)
    obj._implement_columns_of = lambda tables, cache: {tables[0]: [{"column_name": "region", "data_type": "string"}]}
    asked = []
    obj._implement_grouping_recommendation = lambda uc_id, table, candidates: asked.append(table) or ["region"]
    uc = make_uc("N01-U01", **{"Analytics Technique": "Anomaly Detection", "suggested_group_by": "item.category"})
    spec = {"config": {"widgets": {}}, "data": {}, "outputs": {}}
    deep = obj._implement_grouping(uc, spec, ("42", "N01-U01"), {})
    assert deep["default"] == "item.category" and asked == []
    assert deep["chosen_by"] == "deep", "a Grouping nobody picked is recorded as Deep discovery's, never the person's"
    assert any("Grouping item.category (deep)" in msg for _level, msg in obj.logger.records)
    spec["config"]["widgets"]["group_by"] = "item.category"
    confirmed = obj._implement_grouping(uc, spec, ("42", "N01-U01"), {})
    assert (confirmed["default"], confirmed["chosen_by"]) == ("item.category", "person"), "confirming the suggestion makes it the person's"
    spec["config"]["widgets"]["group_by"] = "all"
    changed = obj._implement_grouping(uc, spec, ("42", "N01-U01"), {})
    assert (changed["default"], changed["chosen_by"]) == ("all", "person"), "the person's choice wins"
    uc.pop("suggested_group_by")
    spec["config"]["widgets"] = {}
    described = obj._implement_grouping(uc, spec, ("42", "N01-U01"), {})
    assert (described["default"], described["chosen_by"]) == ("region", "Inspire") and asked == [SALES]


def test_the_null_share_limit_is_the_one_the_app_uses(agent_ns):
    with open(FIXTURE, encoding="utf-8") as handle:
        constants = json.load(handle)["constants"]
    assert constants["group_max_null_share"] == agent_ns["INSPIRE_GROUP_MAX_NULL_SHARE"]


def test_deep_discovery_saves_the_join_of_its_joined_grouping_in_the_use_case_table_joins(agent_ns):
    profiles, joins = star(with_item=True)
    obj, spark = _deep_inspire(agent_ns, profiles, joins)
    ucs = [make_uc("N01-U01", **{"Analytics Technique": "Anomaly Detection", "Primary Table": SALES})]
    obj._suggest_deep_grouping(ucs)
    assert ucs[0]["suggested_group_by"] == "item.category" and ucs[0]["table_joins"] == [ITEM_JOIN]
    declared = {"table": SALES, "column": "store_sk", "ref_table": STORE, "ref_column": "store_sk", "source": "declared", "confidence": 1.0}
    same = dict(ITEM_JOIN, source="declared", confidence=1.0)
    ucs = [make_uc("N01-U01", **{"Analytics Technique": "Anomaly Detection", "Primary Table": SALES, "table_joins": json.dumps([declared])}),
           make_uc("N01-U02", **{"Analytics Technique": "Anomaly Detection", "Primary Table": SALES, "table_joins": [same]})]
    obj._suggest_deep_grouping(ucs)
    assert ucs[0]["table_joins"] == [declared, ITEM_JOIN], "the saved joins stay and the measured one is added"
    assert ucs[1]["table_joins"] == [same], "a join already saved is never added twice"
    profiles, joins = star()
    obj, spark = _deep_inspire(agent_ns, profiles, joins)
    ucs = [make_uc("N01-U01", **{"Analytics Technique": "Anomaly Detection", "Primary Table": SALES})]
    obj._suggest_deep_grouping(ucs)
    assert ucs[0]["suggested_group_by"] == "store_sk" and "table_joins" not in ucs[0], "a grouping of the main table's own column adds no join"
    assert spark.statements == []


def test_the_build_plan_carries_the_join_of_each_joined_grouping_column(agent_ns):
    joins_of = agent_ns["implement_grouping_joins"]
    item = {"table": ITEM, "key": "item_sk", "ref_column": "item_sk"}
    assert joins_of(["item.category", "store_sk"], [ITEM_JOIN], [SALES]) == {"item.category": item}
    assert joins_of(["item.category"], [dict(ITEM_JOIN, table="main.s.returns")], [SALES]) == {}, "a join of another table never counts"
    assert joins_of(["item.category"], [dict(ITEM_JOIN, ref_column="")], [SALES]) == {}
    assert joins_of(["store.store_name"], [ITEM_JOIN], [SALES]) == {}
    assert joins_of(["item.category"], [dict(ITEM_JOIN, table="`main`.`s`.`sales`")], ["main.s.sales_v2", SALES]) == {"item.category": item}
    obj = make_inspire(agent_ns)
    obj._implement_columns_of = lambda tables, cache: {tables[0]: [{"column_name": "region", "data_type": "string"}]}
    uc = make_uc("N01-U01", **{"Analytics Technique": "Anomaly Detection", "suggested_group_by": "item.category",
                               "table_joins": json.dumps([ITEM_JOIN])})
    plan = obj._implement_grouping(uc, {"config": {"widgets": {}}, "data": {}, "outputs": {}}, ("42", "N01-U01"), {})
    assert plan["joins"] == {"item.category": item}
    assert any("joins {'item.category'" in msg for _level, msg in obj.logger.records)
    uc["table_joins"] = []
    assert obj._implement_grouping(uc, {"config": {"widgets": {}}, "data": {}, "outputs": {}}, ("42", "N01-U01"), {})["joins"] == {}


def test_the_run_plan_and_the_build_instruction_carry_the_join(agent_ns):
    import ast
    from v120_genie_support import build_inspire, make_uc as genie_uc
    from v130_genie_run_controls_test import INSTRUCTION
    item = {"table": ITEM, "key": "item_sk", "ref_column": "item_sk"}
    grouping = {"applies": True, "columns": ["item.category", "store_sk"], "default": "item.category", "recommended": ["item.category"],
                "time_column": "", "link": "https://inspire.example.com/?review=7&uc=N01-U01", "table": SALES, "chosen_by": "deep",
                "joins": {"item.category": item}}
    inst = build_inspire(agent_ns)
    uc = genie_uc(**{"Analytics Technique": "Anomaly Detection", "_implement_grouping": dict(grouping)})
    spec = inst._genie_notebook_spec(uc)
    run = ast.literal_eval(inst._genie_run_controls_source(uc, spec, INSTRUCTION).split("INSPIRE_RUN = ", 1)[1].split("\n\n\n", 1)[0])
    assert run["grouping"]["joins"] == {"item.category": item}
    rule = agent_ns["genie_grouping_rule"](grouping)
    assert "keep the main table's key column item_sk in the records" in rule and "joins main.s.item on item_sk = item_sk itself to build the groups" in rule
    assert "the key the use case's table joins name" not in rule
    plain = dict(grouping, joins={})
    uc = genie_uc(**{"Analytics Technique": "Anomaly Detection", "_implement_grouping": plain})
    run = ast.literal_eval(inst._genie_run_controls_source(uc, inst._genie_notebook_spec(uc), INSTRUCTION)
                           .split("INSPIRE_RUN = ", 1)[1].split("\n\n\n", 1)[0])
    assert "joins" not in run["grouping"]
    assert "the key the use case's table joins name" in agent_ns["genie_grouping_rule"](plain)


class _Session:
    def __init__(self, frame, fail=None):
        self.frame, self.fail, self.tables = frame, fail, []

    def table(self, name):
        self.tables.append(name)
        if self.fail:
            raise self.fail
        return FakeDimension(self.frame)


def _joined_run(ns, joins):
    ns["INSPIRE_RUN"] = {"use_case_id": "N01-U01", "grouping": {"link": "https://inspire.example.com/?review=7&uc=N01-U01", "joins": joins}}


def test_a_run_joins_the_dimension_for_a_joined_grouping_column_itself(fresh_ns):
    pd = pytest.importorskip("pandas")
    records = pd.DataFrame({"item_sk": list(range(80)), "net_paid": [float(i) for i in range(80)]}, index=range(100, 180))
    item = pd.DataFrame({"item_sk": [str(i) for i in range(80)] + ["0"], "category": [f"c{i % 2}" for i in range(80)] + ["c0"]})
    _joined_run(fresh_ns, {"item.category": {"table": ITEM, "key": "item_sk", "ref_column": "item_sk"}})
    session, printed = _Session(item), []
    fresh_ns["INSPIRE_RUN_LOG"] = {}
    out = fresh_ns["inspire_group_records"](records, group_by="item.category", out=printed.append, spark_session=session)
    assert len(session.tables) == 1 and list(out.index) == list(range(100, 180))
    assert "main.s.item" in fresh_ns["INSPIRE_RUN_LOG"]["reads"], "the dimension is read through the one source-read helper, so the run log names it"
    assert sorted(set(out["inspire_group"])) == ["c0", "c1"] and fresh_ns["INSPIRE_RUN_GROUPING"]["group_by"] == ["category"]
    assert any("[GROUP-JOIN FIRED] Grouping item.category: joined main.s.item on item_sk = item_sk" in line for line in printed)
    session = _Session(item)
    kept = fresh_ns["inspire_group_records"](records.assign(category=["c0"] * 40 + ["c1"] * 40), group_by="item.category",
                                             out=lambda *_a: None, spark_session=session)
    assert session.tables == [] and sorted(set(kept["inspire_group"])) == ["c0", "c1"], "records that hold the column are never joined"


def test_a_run_whose_grouping_column_the_records_cannot_get_stops_never_falls_back_to_global(fresh_ns):
    pd = pytest.importorskip("pandas")
    records = pd.DataFrame({"item_sk": list(range(80)), "net_paid": [float(i) for i in range(80)]})
    item = pd.DataFrame({"item_sk": [str(i) for i in range(80)], "category": [f"c{i % 2}" for i in range(80)]})
    join = {"table": ITEM, "key": "item_sk", "ref_column": "item_sk"}
    _joined_run(fresh_ns, {"item.category": join})
    with pytest.raises(ValueError, match="have no column item_sk; keep item_sk in the records"):
        fresh_ns["inspire_group_records"](records.drop(columns=["item_sk"]), group_by="item.category", out=lambda *_a: None,
                                          spark_session=_Session(item))
    _joined_run(fresh_ns, {})
    with pytest.raises(fresh_ns["InspireRunStop"], match="carries no join to that table.*change the grouping on the Run page: https://"):
        fresh_ns["inspire_group_records"](records, group_by="item.category", out=lambda *_a: None, spark_session=_Session(item))
    _joined_run(fresh_ns, {"item.category": join})
    with pytest.raises(fresh_ns["InspireRunStop"], match="could not join main.s.item on item_sk = item_sk to read it .*TABLE_OR_VIEW_NOT_FOUND"):
        fresh_ns["inspire_group_records"](records, group_by="item.category", out=lambda *_a: None,
                                          spark_session=_Session(item, RuntimeError("[TABLE_OR_VIEW_NOT_FOUND] main.s.item")))
    unmatched = item.assign(item_sk=[str(i + 1000) for i in range(80)])
    with pytest.raises(fresh_ns["InspireRunStop"], match="no item_sk of the records matches item_sk in main.s.item, so every record would fall "
                                                         "in the one Global group"):
        fresh_ns["inspire_group_records"](records, group_by="item.category", out=lambda *_a: None, spark_session=_Session(unmatched))
    assert "INSPIRE_RUN_GROUPING" not in fresh_ns or fresh_ns["INSPIRE_RUN_GROUPING"].get("group_by") != "all"
