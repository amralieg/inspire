"""Excel, CSV and Markdown are written for every language in output_languages, from the same translated
use cases the PDF uses, and a requested artifact that is not produced is recorded where the user sees it.

Before: the three writers returned early for every language but English, the only notice was a log warning
that also named a Presentation nobody asked for, and the post-write check covered English only.
"""
import ast
import csv
import io
import types

import pytest

from v120_artifacts_support import make_inspire, make_uc

ARABIC_TITLE = "توقع الطلب اليومي لتقليل نفاد المخزون"
ARABIC_NAME = "توقع الطلب على المنتجات"


@pytest.fixture
def ns(agent_ns, monkeypatch):
    monkeypatch.setattr(agent_ns["workspace"], "ImportFormat", types.SimpleNamespace(AUTO="AUTO"), raising=False)
    return agent_ns


def arabic_labels(ns):
    ts = ns["TranslationService"]
    labels = dict(ts.ENGLISH_TRANSLATIONS)
    labels.update(ts.TRANSLATION_FALLBACKS["Arabic"])
    return labels


def arabic_portfolio():
    uc = make_uc("N01-U01", "المبيعات", Name=ARABIC_NAME, usecase=ARABIC_TITLE, Subdomain="التخطيط",
                 Statement="يتنبأ النموذج بالطلب من الجدول main.s.sales (عمود units_sold) كل يوم",
                 Solution="نموذج تنبؤ يومي", **{"Business Value": "خفض نفاد المخزون بنسبة 12%"})
    uc.pop("Quality Score")
    return {"المبيعات": [uc]}


def written(obj, suffix):
    files = {path: data for path, data in obj.w_client.workspace.files.items() if path.endswith(suffix)}
    assert len(files) == 1, (suffix, sorted(obj.w_client.workspace.files))
    return next(iter(files.items()))


def bilingual(ns, **attrs):
    return make_inspire(ns, output_languages=["English", "Arabic"], **attrs)


def test_arabic_excel_is_written_right_to_left_with_arabic_headers_and_values(ns):
    import openpyxl
    obj = bilingual(ns)
    obj._generate_use_case_excel("Arabic", "ar", arabic_portfolio(), translations=arabic_labels(ns))
    path, data = written(obj, ".xlsx")
    assert path.endswith("Acme-dbx_inspire_ar.xlsx")
    sheet = openpyxl.load_workbook(io.BytesIO(data))[arabic_labels(ns)["doc_use_cases"]]
    assert sheet.sheet_view.rightToLeft is True
    header = [c.value for c in sheet[1]]
    row = dict(zip(header, [c.value for c in sheet[2]]))
    labels = arabic_labels(ns)
    for key in ("sum_id", "domain", "subdomain", "usecase", "description", "primary_table", "quality"):
        assert labels[key] in header, key
    assert "Business Domain" not in header and "Use Case" not in header
    technique = obj._doc_technique_label("Forecasting", labels, "Arabic")[0]
    assert row[labels["usecase"]] == ARABIC_TITLE and row[labels["description"]] == f"{ARABIC_NAME} باستخدام {technique}" != f"{ARABIC_NAME} باستخدام Forecasting"
    assert row[labels["domain"]] == "المبيعات"
    assert row[labels["quality_score_header"]] == labels["doc_not_scored"] != "Not scored"
    assert row[labels["quality"]] == labels["value_priority_high"] != "High"
    assert sheet.cell(row=2, column=header.index(labels["usecase"]) + 1).alignment.horizontal == "right"


def test_arabic_csv_has_a_byte_order_mark_and_arabic_headers(ns):
    obj = bilingual(ns)
    obj._generate_csv_catalog("Arabic", "ar", arabic_portfolio(), translations=arabic_labels(ns))
    path, data = written(obj, ".csv")
    assert path.endswith("Acme-dbx_inspire_ar.csv")
    assert data.startswith(b"\xef\xbb\xbf")
    rows = list(csv.reader(io.StringIO(data.decode("utf-8-sig"))))
    labels = arabic_labels(ns)
    header, body = rows[0], rows[1]
    assert header[0] == labels["sum_id"] and labels["usecase"] in header
    assert body[header.index(labels["usecase"])] == ARABIC_TITLE
    assert body[header.index(labels["quality_score_header"])] == labels["doc_not_scored"]


def test_english_csv_keeps_its_headers_and_gains_the_byte_order_mark(ns):
    obj = make_inspire(ns)
    obj._normalize_usecase = lambda usecase, name: usecase
    obj._generate_csv_catalog("English", "en", {"Sales": [make_uc("N01-U01")]})
    _path, data = written(obj, ".csv")
    assert data.startswith(b"\xef\xbb\xbf")
    header = next(csv.reader(io.StringIO(data.decode("utf-8-sig"))))
    assert header == [h for h, _get, _numeric in obj._export_columns(False)]
    assert header[:6] == ["ID", "Rank", "Business Domain", "Subdomain", "Use Case", "Description"]


def test_arabic_markdown_is_right_to_left_with_arabic_labels(ns):
    obj = bilingual(ns)
    obj._generate_markdown_catalog("Arabic", "ar", arabic_portfolio(), {"Executive": "<p>ملخص تنفيذي للمحفظة</p>"}, "Acme",
                                   translations=arabic_labels(ns))
    path, data = written(obj, ".md")
    assert path.endswith("readme_ar.md")
    md = data.decode("utf-8")
    labels = arabic_labels(ns)
    assert md.startswith('<div dir="rtl" lang="ar">\n\n') and md.rstrip().endswith("</div>")
    assert f"## {labels['pdf_exec_summary']}\n" in md and "## Executive Summary" not in md
    assert ARABIC_TITLE in md and f"- **{labels['subdomain']}:** التخطيط" in md
    assert f"## {labels['pdf_disclaimer_title']}" in md


def test_english_markdown_is_unchanged_and_not_wrapped(ns):
    obj = make_inspire(ns)
    obj._generate_markdown_catalog("English", "en", {"Sales": [make_uc("N01-U01")]}, {"Executive": "<p>Exec</p>"}, "Acme")
    md = next(iter(obj.w_client.workspace.files.values())).decode("utf-8")
    assert md.startswith("# Acme - Databricks Inspire AI Use Cases Catalog\n") and "<div dir=" not in md
    assert "## Executive Summary\nExec\n" in md and "\n## Overview\n" in md and "*1 use case*" in md


def run_documents(ns, obj, pack=None):
    english_grouped = {"Sales": [make_uc("N01-U01")]}
    statuses = []
    obj._emit_pipeline_status = lambda **kw: statuses.append(kw) or len(statuses)
    obj._python_package_status = {"weasyprint": (True, ""), "xlsxwriter": (True, ""), "pptx": (True, "")}
    obj.translation_service = types.SimpleNamespace(get_translations=lambda lang: dict(ns["TranslationService"].ENGLISH_TRANSLATIONS))
    obj.generate_catalog_pdf = lambda *a, **k: None
    obj.generate_presentation_pptx = lambda *a, **k: None
    obj._normalize_usecase = lambda usecase, name: usecase
    obj._translate_and_prepare_language_pack = pack or (lambda lang, flat, grouped, name, batch_parallelism=1: (
        lang, "ar", arabic_labels(ns), arabic_portfolio(), {"Executive": "<p>ملخص</p>"}, name))
    obj._generate_documents_for_all_languages([make_uc("N01-U01")], english_grouped_data=english_grouped,
                                              summary_dict={"Executive": "x"}, languages=["English", "Arabic"],
                                              skip_excel_langs=["English"])
    return statuses


def test_every_requested_language_gets_markdown_csv_and_excel(ns):
    obj = bilingual(ns, generate_choices=[])
    run_documents(ns, obj)
    names = sorted(path.rsplit("/", 1)[-1] for path in obj.w_client.workspace.files)
    assert names == ["Acme-dbx_inspire_ar.csv", "Acme-dbx_inspire_ar.json", "Acme-dbx_inspire_ar.xlsx", "Acme-dbx_inspire_en.csv",
                     "readme_ar.md", "readme_en.md"]
    assert not obj.logger.matching("english-only-artifacts") and not obj.logger.matching("English only")
    assert obj.logger.matching("[VIBE-LANG all-artifacts-produced] language=Arabic", level="INFO")
    assert obj.logger.matching("[VIBE-LANG all-artifacts-produced] language=English", level="INFO")
    assert not getattr(obj, "failed_steps", None) and obj.run_exit_value() == ""


def test_a_language_that_cannot_be_produced_is_recorded_in_steps_session_and_exit_value(ns):
    obj = bilingual(ns, generate_choices=["PDF Catalog"])
    statuses = run_documents(ns, obj, pack=lambda lang, *a, **k: (lang, "ar", None, None, None, None))
    gap_rows = [s for s in statuses if s.get("sub_step_name") == "Arabic" and s["status"] == "ended_error"]
    assert sorted(s["step_name"] for s in gap_rows) == ["CSV Catalog", "JSON Catalog", "Markdown Catalog", "PDF Catalog", "Use Case Excel"]
    assert all("Presentation" not in s["message"] for s in statuses)
    failed = {(f["step"], f["language"]) for f in obj.final_inspire_results_json["failed_steps"]}
    assert {("Markdown Catalog", "Arabic"), ("CSV Catalog", "Arabic"), ("Use Case Excel", "Arabic"), ("PDF Catalog", "Arabic"),
            ("JSON Catalog", "Arabic"), ("Language Pack", "Arabic")} <= failed
    assert not any(language == "English" for _step, language in failed)
    exit_value = obj.run_exit_value()
    assert exit_value.startswith("Completed with warnings: ")
    for label in ("Markdown Catalog (Arabic)", "CSV Catalog (Arabic)", "Use Case Excel (Arabic)", "PDF Catalog (Arabic)",
                  "JSON Catalog (Arabic)"):
        assert label in exit_value, label
    assert "Presentation" not in exit_value
    assert obj.logger.matching("[VIBE-LANG missing-artifacts] language=Arabic", level="WARNING")


def test_a_failed_arabic_writer_is_a_recorded_gap_and_the_others_still_land(ns):
    obj = bilingual(ns, generate_choices=[])
    real_csv = obj._generate_csv_catalog

    def csv_writer(language, abbr, grouped, translations=None):
        if language == "Arabic":
            obj._record_failed_step("CSV Catalog", language, "disk full")
            raise RuntimeError("disk full")
        return real_csv(language, abbr, grouped, translations=translations)
    obj._generate_csv_catalog = csv_writer
    run_documents(ns, obj)
    assert [(f["step"], f["language"]) for f in obj.failed_steps] == [("CSV Catalog", "Arabic")]
    assert "CSV Catalog (Arabic)" in obj.run_exit_value()
    assert any(path.endswith("readme_ar.md") for path in obj.w_client.workspace.files)


def test_requested_artifacts_name_only_what_the_user_asked_for(ns):
    obj = make_inspire(ns, generate_choices=[])
    assert [step for _s, step in obj._requested_language_artifacts("Arabic", ["English"])] == [
        "Markdown Catalog", "CSV Catalog", "Use Case Excel", "JSON Catalog"]
    assert [step for _s, step in obj._requested_language_artifacts("English", ["English"])] == [
        "Markdown Catalog", "CSV Catalog", "PDF Catalog"]
    obj.generate_choices = ["PDF Catalog", "Presentation"]
    assert [step for _s, step in obj._requested_language_artifacts("Arabic", [])] == [
        "Markdown Catalog", "CSV Catalog", "Use Case Excel", "PDF Catalog", "Presentation", "JSON Catalog"]


def test_document_generation_is_gated_by_the_languages_only_never_by_pdf_or_slides_choices():
    from _agentload import agent_ast
    gates = []
    for node in ast.walk(agent_ast()):
        if not isinstance(node, ast.If):
            continue
        refs = [n for stmt in node.body for n in ast.walk(stmt)
                if isinstance(n, ast.Attribute) and n.attr == "_generate_documents_for_all_languages"]
        if refs:
            gates.append(ast.unparse(node.test))
    assert len(gates) >= 3, gates
    assert not [gate for gate in gates if "generate_choices" in gate], gates


def test_main_exits_with_the_run_outcome_outside_its_try_block():
    from _agentload import method_node, top_level_defs
    main = top_level_defs()["main"]
    tries = [i for i, node in enumerate(main.body) if isinstance(node, ast.Try)]
    exits = [i for i, node in enumerate(main.body)
             if isinstance(node, ast.If) and "dbutils.notebook.exit(run_outcome)" in ast.unparse(node)]
    assert tries and exits and exits[-1] > tries[-1]
    assert "inspirer.run_exit_value()" in ast.unparse(main)
    finalize = ast.unparse(method_node("DatabricksInspire", "finalize_atomic_writer"))
    assert "self.run_exit_value()" in finalize and "_run_outcome_warnings" not in finalize
