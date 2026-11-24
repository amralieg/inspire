"""REQ-077 (rc.7), rewritten for FX-116 (REQ-503): the run builds no PDF, PPTX or Excel whatever the person picked, and keeps its
Markdown, CSV and JSON catalogs. Documents come from the App's Generate docs wizard."""
import types

import pytest

from v120_artifacts_support import make_inspire, make_uc


@pytest.fixture
def ranked(agent_ns, monkeypatch):
    monkeypatch.setattr(agent_ns["workspace"], "ImportFormat", types.SimpleNamespace(AUTO="AUTO"), raising=False)
    return agent_ns


def run_catalog_dispatch(ranked, generate_choices):
    uc = make_uc("N01-U01", "Sales", Name="Sales idea 1", **{"Inspire Score": 7.0})
    obj = make_inspire(ranked, generate_choices=generate_choices)
    called, requested, statuses = [], [], []
    obj._require_asset_package = lambda module, purpose: requested.append(purpose)
    obj.translation_service = types.SimpleNamespace(
        get_translations=lambda lang: dict(ranked["TranslationService"].ENGLISH_TRANSLATIONS))
    obj._generate_markdown_catalog = lambda *a, **k: called.append("Markdown")
    obj._generate_csv_catalog = lambda *a, **k: called.append("CSV")
    obj._emit_pipeline_status = lambda **kw: statuses.append(kw) or len(statuses)
    obj._get_salesy_summary = lambda grouped, name, lang, t: ({"Executive": "x"}, name)
    obj._generate_language_catalogs([uc], english_grouped_data={"Sales": [uc]},
                                    summary_dict={"Executive": "x"}, languages=["English"])
    return called, requested, statuses


@pytest.mark.parametrize("choices", [["use cases"], ["use cases", "PDF Catalog"], ["use cases", "PDF Catalog", "Presentation", "Excel"]])
def test_no_choice_makes_a_pdf_pptx_or_excel_and_the_catalogs_are_kept(ranked, choices):
    called, requested, statuses = run_catalog_dispatch(ranked, choices)
    assert called == ["Markdown", "CSV"] or sorted(called) == ["CSV", "Markdown"], called
    assert requested == [], "no document library is loaded in the run"
    assert not [s for s in statuses if s.get("step_name") in ("PDF Catalog", "Presentation", "Use Case Excel")]


def test_the_document_writers_are_not_methods_of_the_run(ranked):
    for name in ("generate_catalog_pdf", "generate_presentation_pptx", "_generate_use_case_excel", "_generate_documents_for_all_languages"):
        assert not hasattr(ranked["DatabricksInspire"], name), name
