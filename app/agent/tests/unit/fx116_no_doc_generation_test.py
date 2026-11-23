"""FX-116 (REQ-503): the documents move to the App (the Generate docs wizard), so the agent stops making them.

The run no longer writes the PDF catalog, the presentation or the Excel workbook, loads no document library
(weasyprint, python-pptx, xlsxwriter) and has no `09_generation_options` widget. What other outputs need stays:
the translations (TranslationService), the Markdown, CSV and JSON catalogs, their file names, the shared package
loader and the `12_documents_languages` widget that picks the catalog languages.
"""
import re

import pytest

from _agentload import agent_source

REMOVED_METHODS = (
    "generate_catalog_pdf",
    "generate_presentation_pptx",
    "_generate_use_case_excel",
    "_build_presentation_deck",
    "_doc_presentation",
    "_catalog_pdf_html",
    "_save_excel",
    "_install_excel_dependencies",
    "_generate_documents_for_all_languages",
    "_pdf_wordmark",
    "_pdf_index_table",
    "_pdf_use_case_card",
    "_pdf_requested",
    "_documents_requested",
    "_excel_requested",
    "_Deck",
)
KEPT_METHODS = (
    "_generate_markdown_catalog",
    "_generate_csv_catalog",
    "_generate_json_catalog",
    "_catalog_file_name",
    "_require_asset_package",
)


@pytest.fixture(scope="module")
def source():
    return agent_source()


@pytest.mark.parametrize("name", REMOVED_METHODS)
def test_the_document_writers_are_gone(agent_ns, name):
    assert not hasattr(agent_ns["DatabricksInspire"], name), f"DatabricksInspire.{name} still makes documents in the run"


def test_no_document_writer_is_defined_anywhere_in_the_agent(source):
    found = [n for n in REMOVED_METHODS if re.search(rf"^\s*(?:def|class)\s+{re.escape(n)}\b", source, re.M)]
    assert found == [], f"still defined: {found}"


def test_no_document_library_is_loaded(source):
    imports = re.findall(r"^\s*(?:import|from)\s+(weasyprint|xlsxwriter|pptx)\b", source, re.M)
    loads = re.findall(r"_require_asset_package\(\s*['\"](weasyprint|xlsxwriter|pptx)['\"]", source)
    assert imports == [] and loads == [], f"imports {sorted(set(imports))}, loads {sorted(set(loads))}"


def test_the_generation_options_widget_and_its_defaults_are_gone(source):
    left = source.count("09_generation_options")
    assert left == 0, f"the 09_generation_options widget is still created or read ({left} places)"
    assert re.search(r"^\s*DEFAULT_GENERATION_OPTIONS\s*=", source, re.M) is None, "DEFAULT_GENERATION_OPTIONS is still defined"


def test_the_other_outputs_and_their_translations_stay(agent_ns, source):
    cls = agent_ns["DatabricksInspire"]
    missing = [n for n in KEPT_METHODS if not hasattr(cls, n)]
    assert missing == [], f"removed by mistake: {missing}"
    assert "TranslationService" in agent_ns, "the Markdown, CSV and JSON catalogs and the translated use cases need TranslationService"
    assert hasattr(agent_ns["TranslationService"], "ENGLISH_TRANSLATIONS")
    assert re.search(r"dbutils\.widgets\.multiselect\(\s*['\"]12_documents_languages['\"]", source), "the catalog languages widget stays"
    assert "_require_asset_package(\"sqlglot\"" in source, "the shared package loader keeps its other callers"
