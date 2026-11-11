"""REQ-077 (rc.7): a run builds only the documents the person picked. PDF, PPTX and Excel are
written in the run when picked, and are otherwise created on demand from Review."""
import types

import pytest

from v120_artifacts_support import make_inspire, make_uc


@pytest.fixture
def ranked(agent_ns, monkeypatch):
    monkeypatch.setattr(agent_ns["workspace"], "ImportFormat", types.SimpleNamespace(AUTO="AUTO"), raising=False)
    return agent_ns


def run_document_dispatch(ranked, generate_choices, skip_excel_langs=("English",)):
    uc = make_uc("N01-U01", "Sales", Name="Sales idea 1", **{"Inspire Score": 7.0})
    obj = make_inspire(ranked, generate_choices=generate_choices)
    called, requested, statuses = [], [], []
    obj._require_asset_package = lambda module, purpose: requested.append(purpose)
    obj.translation_service = types.SimpleNamespace(
        get_translations=lambda lang: dict(ranked["TranslationService"].ENGLISH_TRANSLATIONS))
    obj._generate_markdown_catalog = lambda *a, **k: called.append("Markdown")
    obj._generate_csv_catalog = lambda *a, **k: called.append("CSV")
    obj._generate_use_case_excel = lambda *a, **k: called.append("Excel")
    obj.generate_catalog_pdf = lambda *a: called.append("PDF")
    obj.generate_presentation_pptx = lambda *a: called.append("PPTX")
    obj._emit_pipeline_status = lambda **kw: statuses.append(kw) or len(statuses)
    obj._get_salesy_summary = lambda grouped, name, lang, t: ({"Executive": "x"}, name)
    obj._generate_documents_for_all_languages([uc], english_grouped_data={"Sales": [uc]},
                                              summary_dict={"Executive": "x"},
                                              languages=["English"], skip_excel_langs=list(skip_excel_langs))
    return called, requested, statuses


def test_no_documents_runs_no_pdf_pptx_or_excel_and_keeps_its_catalogs(ranked):
    called, requested, statuses = run_document_dispatch(ranked, ["use cases"], skip_excel_langs=[])
    assert "PDF" not in called and "PPTX" not in called and "Excel" not in called
    assert "PDF Catalog" not in requested and "Presentation" not in requested and "Use Case Excel" not in requested
    assert not [s for s in statuses if s.get("step_name") in ("PDF Catalog", "Presentation", "Use Case Excel")]
    assert "Markdown" in called and "CSV" in called


def test_a_picked_pdf_alone_does_not_build_the_excel_workbook(ranked):
    called, _, _ = run_document_dispatch(ranked, ["use cases", "PDF Catalog"], skip_excel_langs=[])
    assert "PDF" in called and "Excel" not in called


def test_picked_formats_are_still_built_in_the_run(ranked):
    called, requested, _ = run_document_dispatch(ranked, ["use cases", "PDF Catalog", "Presentation", "Excel"],
                                                 skip_excel_langs=[])
    assert "PDF" in called and "PPTX" in called and "Excel" in called
    assert "PDF Catalog" in requested and "Presentation" in requested and "Use Case Excel" in requested
