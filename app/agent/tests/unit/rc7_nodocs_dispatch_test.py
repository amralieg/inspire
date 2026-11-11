"""REQ-077 (rc.7): a run with no document formats builds no PDF and no PPTX, and a run that
picks a format still builds it. Documents are created on demand from Review instead."""
import types

import pytest

from v120_artifacts_support import make_inspire, make_uc


@pytest.fixture
def ranked(agent_ns, monkeypatch):
    monkeypatch.setattr(agent_ns["workspace"], "ImportFormat", types.SimpleNamespace(AUTO="AUTO"), raising=False)
    return agent_ns


def run_document_dispatch(ranked, generate_choices):
    uc = make_uc("N01-U01", "Sales", Name="Sales idea 1", **{"Inspire Score": 7.0})
    obj = make_inspire(ranked, generate_choices=generate_choices)
    called, requested, statuses = [], [], []
    obj._require_asset_package = lambda module, purpose: requested.append(purpose)
    obj.translation_service = types.SimpleNamespace(
        get_translations=lambda lang: dict(ranked["TranslationService"].ENGLISH_TRANSLATIONS))
    obj._generate_markdown_catalog = lambda *a, **k: called.append("Markdown")
    obj._generate_csv_catalog = lambda *a, **k: called.append("CSV")
    obj.generate_catalog_pdf = lambda *a: called.append("PDF")
    obj.generate_presentation_pptx = lambda *a: called.append("PPTX")
    obj._emit_pipeline_status = lambda **kw: statuses.append(kw) or len(statuses)
    obj._get_salesy_summary = lambda grouped, name, lang, t: ({"Executive": "x"}, name)
    obj._generate_documents_for_all_languages([uc], english_grouped_data={"Sales": [uc]},
                                              summary_dict={"Executive": "x"},
                                              languages=["English"], skip_excel_langs=["English"])
    return called, requested, statuses


def test_no_documents_runs_no_pdf_or_pptx_generator_and_keeps_its_catalogs(ranked):
    called, requested, statuses = run_document_dispatch(ranked, ["use cases"])
    assert "PDF" not in called and "PPTX" not in called
    assert "PDF Catalog" not in requested and "Presentation" not in requested
    assert not [s for s in statuses if s.get("step_name") in ("PDF Catalog", "Presentation")]
    assert "Markdown" in called and "CSV" in called


def test_picked_formats_are_still_built_in_the_run(ranked):
    called, requested, _ = run_document_dispatch(ranked, ["use cases", "PDF Catalog", "Presentation"])
    assert "PDF" in called and "PPTX" in called
    assert "PDF Catalog" in requested and "Presentation" in requested
