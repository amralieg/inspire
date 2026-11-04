"""v1.4.0 use-case kinds: Deep discovery records the grouping and the record level each grouping use case needs.

1. The suggestion comes only from the aggregates Deep already read: distinct counts, null shares, top value shares and
   measured join match rates, with the App's thresholds (2 to 500 groups, 30 records per group on average).
2. A fact table's integer key is a grouping column; a dimension column one join away is too; a near-unique column,
   a measure, a date key and a personal column never are.
3. A column the model names for the use case is preferred, but only when the aggregate check passes it.
4. Standard mode records nothing; the fields go to __inspire_usecases, the Excel/CSV export and the JSON catalog.
5. A build with no Grouping chosen starts from the Deep suggestion, and a run resolves a joined column to the records'
   own column.
"""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v120_artifacts_support import FakeSpark, make_inspire, make_uc  # noqa: E402
from _agentload import agent_source  # noqa: E402

SALES = "main.s.sales"
ITEM = "main.s.item"
STORE = "main.s.store"
ROWS = 120000
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
    assert found == {"group_by": ["store_sk"], "record_level": "ticket_number"}


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


def test_a_near_unique_column_and_too_few_records_per_group_are_not_suggested(agent_ns):
    table = "main.s.orders"
    profiles = {table: {"rows": 9000, "sampled": False, "columns": {
        "region": col(6, "string"), "invoice_code": col(8900, "string"), "batch": col(400, "string"), "branch": col(300, "string")}}}
    found = suggest(agent_ns, profiles=profiles, table=table)
    assert found == {"group_by": ["region"], "record_level": "invoice_code"}
    profiles[table]["columns"].pop("region")
    assert suggest(agent_ns, profiles=profiles, table=table)["group_by"] == ["branch"], "300 groups of 30 records pass; 400 of 22.5 do not"
    profiles[table]["columns"]["branch"] = col(301, "string")
    assert suggest(agent_ns, profiles=profiles, table=table)["group_by"] == []


def test_the_record_level_falls_back_to_the_table_and_reads_the_sample_size(agent_ns):
    table = "main.s.events"
    profiles = {table: {"rows": 5000000, "sampled": True, "columns": {"site_code": col(40, "string"), "event_ref": col(990000, "string")}}}
    assert suggest(agent_ns, profiles=profiles, table=table) == {"group_by": ["site_code"], "record_level": "event_ref"}
    profiles[table]["columns"]["event_ref"] = col(500000, "string")
    assert suggest(agent_ns, profiles=profiles, table=table)["record_level"] == "events"


def test_a_column_the_model_names_wins_only_when_the_aggregates_pass_it(agent_ns):
    profiles, joins = star(with_item=True)
    assert suggest(agent_ns, profiles=profiles, joins=joins, proposed=["store_sk"])["group_by"] == ["store_sk"]
    assert suggest(agent_ns, profiles=profiles, joins=joins, proposed=["ticket_number"])["group_by"] == ["item.category"]
    assert suggest(agent_ns, profiles=profiles, joins=joins, proposed=["customer_email"])["group_by"] == ["item.category"]


def test_only_a_grouping_technique_gets_a_suggestion(agent_ns):
    profiles, joins = star()
    assert suggest(agent_ns, technique="Text Classification", profiles=profiles, joins=joins) is None
    assert suggest(agent_ns, technique="Time Series Forecasting", profiles=profiles, joins=joins)["group_by"] == ["store_sk"]
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


def test_standard_mode_records_nothing(agent_ns):
    profiles, joins = star()
    obj, spark = _deep_inspire(agent_ns, profiles, joins, discovery_type="Standard")
    ucs = [make_uc("N01-U01", **{"Analytics Technique": "Anomaly Detection", "Primary Table": SALES})]
    assert obj._suggest_deep_grouping(ucs) == []
    assert "suggested_group_by" not in ucs[0] and "record_level" not in ucs[0] and spark.statements == []
    obj, _spark = _deep_inspire(agent_ns, {}, [], discovery_type="Deep")
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
    plan = agent_ns["implement_grouping_plan"]("Anomaly Detection", [], "", "", ["item.category"])
    assert plan["applies"] and plan["default"] == "item.category" and plan["columns"] == ["item.category"]
    assert plan["chosen_by"] == "Inspire"
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
    spec["config"]["widgets"]["group_by"] = "all"
    assert obj._implement_grouping(uc, spec, ("42", "N01-U01"), {})["default"] == "all", "the person's choice wins"
    uc.pop("suggested_group_by")
    spec["config"]["widgets"] = {}
    assert obj._implement_grouping(uc, spec, ("42", "N01-U01"), {})["default"] == "region" and asked == [SALES]


def test_the_null_share_limit_is_the_one_the_app_uses(agent_ns):
    with open(FIXTURE, encoding="utf-8") as handle:
        constants = json.load(handle)["constants"]
    assert constants["group_max_null_share"] == agent_ns["INSPIRE_GROUP_MAX_NULL_SHARE"]
