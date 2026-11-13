"""REQ-171: a Data Filter the person picked on a categorical column shows in the use case catalog. The Excel workbook and the CSV carry one
column per filtered column (header = the column name), each use case's cell holds its picked values, and the PDF and markdown use case
card carry a 'Data Filters' fact. Filters are read from the run's Table Scope only; no filter adds no column."""
import io
import json
import os

import openpyxl
import pytest

from v120_artifacts_support import make_inspire
from v130_outputs_test import docs, value_uc  # noqa: F401

SALES, STORES = "main.s.sales", "main.s.stores"
FIXTURE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures", "data_filter_cases.json")


def scope(table, columns, rows):
    return {table: {"columns": columns, "rows": rows}}


@pytest.fixture
def scoped(docs):
    docs["INSPIRE_TABLE_SCOPES"].clear()
    yield docs
    docs["INSPIRE_TABLE_SCOPES"].clear()


def set_scope(ns, data):
    ns["INSPIRE_TABLE_SCOPES"].clear()
    ns["INSPIRE_TABLE_SCOPES"].update(ns["parse_table_scopes"](json.dumps(data)))


def use_case(no, tables, **extra):
    return value_uc(no, "Sales", **{"Tables Involved": ", ".join(tables), "Primary Table": tables[0], **extra})


def excel_sheet(ns, grouped):
    obj = make_inspire(ns)
    obj.delivery_order = [uc["No"] for ucs in grouped.values() for uc in ucs]
    obj._generate_use_case_excel("English", "en", grouped)
    xlsx = next(p for p in obj.w_client.workspace.files if str(p).endswith(".xlsx"))
    return openpyxl.load_workbook(io.BytesIO(obj.w_client.workspace.files[xlsx])).worksheets[0]


def rows_by_id(sheet):
    headers = [cell.value for cell in next(sheet.iter_rows())]
    out = {}
    for row in sheet.iter_rows(min_row=2, values_only=True):
        out[row[headers.index("ID")]] = dict(zip(headers, row))
    return headers, out


def test_a_picked_categorical_filter_is_a_column_of_the_excel_with_its_value_on_each_filtered_use_case(scoped):
    set_scope(scoped, scope(SALES, ["sku", "product"], [{"column": "product", "op": "=", "values": ["Tokyo Tidbits"]}]))
    headers, by_id = rows_by_id(excel_sheet(scoped, {"Sales": [use_case("N01-U01", [SALES]), use_case("N01-U02", [STORES])]}))
    assert "product" in headers, headers
    assert by_id["N01-U01"]["product"] == "Tokyo Tidbits", "the filtered use case shows its picked value"
    assert by_id["N01-U02"]["product"] in (None, ""), "a use case over tables with no filter shows nothing in that column"


def test_a_catalog_with_no_filter_has_no_filter_column(scoped):
    headers, _ = rows_by_id(excel_sheet(scoped, {"Sales": [use_case("N01-U01", [SALES])]}))
    assert "product" not in headers and not any("filter" in str(h).lower() for h in headers), headers


def test_several_filtered_columns_each_get_a_column_and_several_values_are_comma_joined(scoped):
    set_scope(scoped, scope(SALES, ["sku", "product", "region"], [
        {"column": "product", "op": "in", "values": ["Tokyo Tidbits", "Golden Gate Ginger"]},
        {"column": "region", "op": "=", "values": ["north"]}]))
    headers, by_id = rows_by_id(excel_sheet(scoped, {"Sales": [use_case("N01-U01", [SALES])]}))
    assert headers.index("region") > headers.index("product"), headers
    assert by_id["N01-U01"]["product"] == "Tokyo Tidbits, Golden Gate Ginger"
    assert by_id["N01-U01"]["region"] == "north"


def test_a_use_case_over_tables_filtered_differently_names_each_tables_values(scoped):
    set_scope(scoped, {**scope(SALES, ["sku", "product"], [{"column": "product", "op": "=", "values": ["Tokyo Tidbits"]}]),
                       **scope(STORES, ["store", "product"], [{"column": "product", "op": "=", "values": ["Golden Gate Ginger"]}])})
    _, by_id = rows_by_id(excel_sheet(scoped, {"Sales": [use_case("N01-U01", [SALES, STORES])]}))
    assert by_id["N01-U01"]["product"] == "sales: Tokyo Tidbits; stores: Golden Gate Ginger"


def test_a_long_value_list_shows_its_first_ten_values_and_a_count_for_the_rest(scoped):
    values = [f"Brand {n:02d}" for n in range(1, 13)]
    set_scope(scoped, scope(SALES, ["sku", "product"], [{"column": "product", "op": "in", "values": values}]))
    _, by_id = rows_by_id(excel_sheet(scoped, {"Sales": [use_case("N01-U01", [SALES])]}))
    assert by_id["N01-U01"]["product"] == ", ".join(values[:10]) + " and 2 more"


def test_an_exception_filter_is_written_as_all_except_its_values(scoped):
    set_scope(scoped, scope(SALES, ["sku", "product"], [{"column": "product", "op": "not in", "values": ["Other Co"]}]))
    _, by_id = rows_by_id(excel_sheet(scoped, {"Sales": [use_case("N01-U01", [SALES])]}))
    assert by_id["N01-U01"]["product"] == "all except Other Co"


def test_a_range_filter_is_not_a_categorical_pick_and_adds_no_column(scoped):
    set_scope(scoped, scope(SALES, ["sku", "sold_on"], [{"column": "sold_on", "op": ">=", "values": ["2026-01-01"]}]))
    headers, _ = rows_by_id(excel_sheet(scoped, {"Sales": [use_case("N01-U01", [SALES])]}))
    assert "sold_on" not in headers


def test_a_translated_export_keeps_the_filter_header_as_the_column_name(scoped):
    set_scope(scoped, scope(SALES, ["sku", "product"], [{"column": "product", "op": "=", "values": ["Tokyo Tidbits"]}]))
    obj = make_inspire(scoped)
    headers, rows, _numeric = obj._catalog_export_table({"Sales": [use_case("N01-U01", [SALES])]}, {}, "French")
    assert "product" in headers, headers
    assert rows[0][headers.index("product")] == "Tokyo Tidbits"


def test_the_csv_writer_carries_the_same_filter_columns_as_the_excel(scoped):
    set_scope(scoped, scope(SALES, ["sku", "product"], [{"column": "product", "op": "=", "values": ["Tokyo Tidbits"]}]))
    obj = make_inspire(scoped)
    grouped = {"Sales": [use_case("N01-U01", [SALES])]}
    headers, _rows, _numeric = obj._catalog_export_table(grouped, {}, "English")
    obj.delivery_order = ["N01-U01"]
    obj._generate_csv_catalog("English", "en", grouped)
    csv_path = next(p for p in obj.w_client.workspace.files if str(p).endswith(".csv"))
    assert obj.w_client.workspace.files[csv_path].decode("utf-8").splitlines()[0].split(",")[headers.index("product")].strip('"') == "product"
    assert "product" in headers


def test_the_cases_the_app_reads_match_the_shared_fixture_the_writers_are_checked_against(agent_ns):
    fixture = json.load(open(FIXTURE, encoding="utf-8"))
    agent_ns["INSPIRE_TABLE_SCOPES"].clear()
    agent_ns["INSPIRE_TABLE_SCOPES"].update(agent_ns["parse_table_scopes"](json.dumps(fixture["scopes"])))
    try:
        for case in fixture["cases"]:
            uc = {"Primary Table": case["uc"]["primary_table"], "Tables Involved": case["uc"]["tables_involved"]}
            filters = agent_ns["use_case_data_filters"](uc)
            got = [{"column": n, "text": agent_ns["data_filter_cell"](filters, n)} for n in agent_ns["data_filter_names"](filters)]
            assert got == case["columns"], case["name"]
            assert agent_ns["data_filter_line"](filters) == case["line"], case["name"]
    finally:
        agent_ns["INSPIRE_TABLE_SCOPES"].clear()


def _filtered_portfolio():
    from v120_docs_design_test import portfolio
    grouped = portfolio()
    grouped["Sales"][0].update({"Tables Involved": SALES, "Primary Table": SALES})
    grouped["Sales"][1].update({"Tables Involved": STORES, "Primary Table": STORES})
    return grouped


def test_the_pdf_card_and_the_markdown_share_a_data_filters_fact_placed_after_the_tables(scoped):
    from v120_docs_design_test import labels, summary
    set_scope(scoped, scope(SALES, ["sku", "product"], [{"column": "product", "op": "=", "values": ["Tokyo Tidbits"]}]))
    obj = make_inspire(scoped)
    grouped = _filtered_portfolio()
    model = obj._document_model("English", labels(scoped), summary(), grouped, "Acme")
    filtered = obj._use_case_view(grouped["Sales"][0], model, labels(scoped))["facts"]
    keys = [fact[0] for fact in filtered]
    assert ("data_filters", "Data Filters", "product: Tokyo Tidbits") in filtered, filtered
    assert keys.index("data_filters") == keys.index("aspect_tables") + 1, keys
    plain = obj._use_case_view(grouped["Sales"][1], model, labels(scoped))["facts"]
    assert all(fact[0] != "data_filters" for fact in plain), "a use case with no filter has no Data Filters fact"


def test_the_markdown_catalog_writes_the_data_filters_of_each_use_case(scoped):
    from v120_docs_design_test import summary
    set_scope(scoped, scope(SALES, ["sku", "product"], [{"column": "product", "op": "=", "values": ["Tokyo Tidbits"]}]))
    obj = make_inspire(scoped)
    grouped = _filtered_portfolio()
    obj.delivery_order = [uc["No"] for ucs in grouped.values() for uc in ucs]
    obj._generate_markdown_catalog("English", "en", grouped, summary(), "Acme")
    md = next(p for p in obj.w_client.workspace.files if str(p).endswith(".md"))
    text = obj.w_client.workspace.files[md].decode("utf-8")
    assert "Data Filters" in text and "product: Tokyo Tidbits" in text, text[:400]


def test_a_french_export_writes_the_connector_words_in_french(scoped):
    set_scope(scoped, scope(SALES, ["sku", "product"], [
        {"column": "product", "op": "in", "values": [f"Brand {n:02d}" for n in range(1, 13)]},
        {"column": "sku", "op": "!=", "values": ["Other Co"]}]))
    obj = make_inspire(scoped)
    headers, rows, _numeric = obj._catalog_export_table({"Sales": [use_case("N01-U01", [SALES])]}, {}, "French")
    cell = dict(zip(headers, rows[0]))
    assert cell["product"] == ", ".join(f"Brand {n:02d}" for n in range(1, 11)) + " et 2 de plus", cell["product"]
    assert cell["sku"] == "tout sauf Other Co", cell["sku"]


def test_every_language_connector_and_label_keeps_the_placeholders_of_its_english_source(docs):
    import re
    fallbacks = docs["TranslationService"].TRANSLATION_FALLBACKS
    english = docs["TranslationService"].ENGLISH_TRANSLATIONS
    for key in ("doc_data_filters", "doc_filter_all_except", "doc_filter_and_more"):
        placeholders = set(re.findall(r"\{([a-z_]+)\}", english[key]))
        for language, labels in fallbacks.items():
            text = labels[key]
            assert set(re.findall(r"\{([a-z_]+)\}", text)) == placeholders, (language, key, text)
            assert "{" not in re.sub(r"\{[a-z_]+\}", "", text) and "}" not in re.sub(r"\{[a-z_]+\}", "", text), (language, key, text)
            assert text.strip(), (language, key)
