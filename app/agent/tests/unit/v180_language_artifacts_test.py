"""Markdown, CSV and JSON are written for every language in output_languages, from the same translated
use cases, and a requested artifact that is not produced is recorded where the user sees it.

Before: the writers returned early for every language but English, the only notice was a log warning,
and the post-write check covered English only.
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
    assert body[header.index(labels["usecase"])] == ARABIC_NAME
    assert body[header.index(labels["quality_score_header"])] == labels["doc_not_scored"]


def test_english_csv_keeps_its_headers_and_gains_the_byte_order_mark(ns):
    obj = make_inspire(ns)
    obj._normalize_usecase = lambda usecase, name: usecase
    obj._generate_csv_catalog("English", "en", {"Sales": [make_uc("N01-U01")]})
    _path, data = written(obj, ".csv")
    assert data.startswith(b"\xef\xbb\xbf")
    header = next(csv.reader(io.StringIO(data.decode("utf-8-sig"))))
    assert header == [h for h, _get, _numeric in obj._export_columns(False)]
    assert header[:6] == ["ID", "Rank", "Business Domain", "Subdomain", "Use Case", "Subtitle"]


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
    assert ARABIC_NAME in md and f"- **{labels['subdomain']}:** التخطيط" in md
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
    obj.translation_service = types.SimpleNamespace(get_translations=lambda lang: dict(ns["TranslationService"].ENGLISH_TRANSLATIONS))
    obj._normalize_usecase = lambda usecase, name: usecase
    obj._translate_and_prepare_language_pack = pack or (lambda lang, flat, grouped, name, batch_parallelism=1: (
        lang, "ar", arabic_labels(ns), arabic_portfolio(), {"Executive": "<p>ملخص</p>"}, name))
    obj._generate_language_catalogs([make_uc("N01-U01")], english_grouped_data=english_grouped,
                                              summary_dict={"Executive": "x"}, languages=["English", "Arabic"])
    return statuses


def test_every_requested_language_gets_markdown_and_csv(ns):
    obj = bilingual(ns)
    run_documents(ns, obj)
    names = sorted(path.rsplit("/", 1)[-1] for path in obj.w_client.workspace.files)
    assert names == ["Acme-dbx_inspire_ar.csv", "Acme-dbx_inspire_ar.json", "Acme-dbx_inspire_en.csv",
                     "readme_ar.md", "readme_en.md"]
    assert not obj.logger.matching("english-only-artifacts") and not obj.logger.matching("English only")
    assert obj.logger.matching("[VIBE-LANG all-artifacts-produced] language=Arabic", level="INFO")
    assert obj.logger.matching("[VIBE-LANG all-artifacts-produced] language=English", level="INFO")
    assert not getattr(obj, "failed_steps", None) and obj.run_exit_value() == ""


def test_a_language_that_cannot_be_produced_is_recorded_in_steps_session_and_exit_value(ns):
    obj = bilingual(ns)
    statuses = run_documents(ns, obj, pack=lambda lang, *a, **k: (lang, "ar", None, None, None, None))
    gap_rows = [s for s in statuses if s.get("sub_step_name") == "Arabic" and s["status"] == "ended_error"]
    assert sorted(s["step_name"] for s in gap_rows) == ["CSV Catalog", "JSON Catalog", "Markdown Catalog"]
    failed = {(f["step"], f["language"]) for f in obj.final_inspire_results_json["failed_steps"]}
    assert {("Markdown Catalog", "Arabic"), ("CSV Catalog", "Arabic"), ("JSON Catalog", "Arabic"), ("Language Pack", "Arabic")} <= failed
    assert not any(language == "English" for _step, language in failed)
    exit_value = obj.run_exit_value()
    assert exit_value.startswith("Completed with warnings: ")
    for label in ("Markdown Catalog (Arabic)", "CSV Catalog (Arabic)", "JSON Catalog (Arabic)"):
        assert label in exit_value, label
    assert obj.logger.matching("[VIBE-LANG missing-artifacts] language=Arabic", level="WARNING")


def test_a_failed_arabic_writer_is_a_recorded_gap_and_the_others_still_land(ns):
    obj = bilingual(ns)
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


def test_a_language_pack_without_use_cases_is_a_recorded_gap_never_a_silent_skip(ns):
    obj = bilingual(ns)
    run_documents(ns, obj, pack=lambda lang, flat, grouped, name, batch_parallelism=1: (
        lang, "ar", arabic_labels(ns), {"المبيعات": []}, {"Executive": "<p>ملخص</p>"}, name))
    names = sorted(path.rsplit("/", 1)[-1] for path in obj.w_client.workspace.files)
    assert names == ["Acme-dbx_inspire_en.csv", "readme_en.md"]
    failed = {(f["step"], f["language"]) for f in obj.failed_steps}
    assert failed == {("Markdown Catalog", "Arabic"), ("CSV Catalog", "Arabic"), ("JSON Catalog", "Arabic")}
    assert not obj.logger.matching("[VIBE-LANG all-artifacts-produced] language=Arabic")
    assert obj.logger.matching("[VIBE-LANG missing-artifacts] language=Arabic", level="WARNING")
    assert obj.logger.matching("[ARTIFACT STEP FAILED] step=CSV Catalog language=Arabic", level="WARNING")
    exit_value = obj.run_exit_value()
    for label in ("Markdown Catalog (Arabic)", "CSV Catalog (Arabic)", "JSON Catalog (Arabic)"):
        assert label in exit_value, label
    assert "has no use cases to write" in str(obj.failed_steps)
    assert obj.logger.matching("[VIBE-LANG all-artifacts-produced] language=English", level="INFO")


@pytest.mark.parametrize("step,write", [
    ("CSV Catalog", lambda obj, labels: obj._generate_csv_catalog("Arabic", "ar", {"المبيعات": []}, translations=labels)),
    ("Markdown Catalog", lambda obj, labels: obj._generate_markdown_catalog("Arabic", "ar", {}, {}, "Acme", translations=labels)),
    ("JSON Catalog", lambda obj, labels: obj._generate_json_catalog("Arabic", "ar", {}, {}, "Acme", translations=labels)),
])
def test_every_writer_refuses_an_empty_portfolio_instead_of_returning_as_if_written(ns, step, write):
    obj = bilingual(ns)
    with pytest.raises(ValueError, match=f"the {step} for Arabic has no use cases to write"):
        write(obj, arabic_labels(ns))
    assert not obj.w_client.workspace.files
    if step != "JSON Catalog":
        assert [(f["step"], f["language"]) for f in obj.failed_steps] == [(step, "Arabic")]


def test_no_artifact_writer_skips_silently_on_empty_input():
    import re
    from _agentload import agent_source
    assert not re.search(r"(No use cases provided to|No data to write to)[^\n]*Skipping", agent_source())


def test_requested_artifacts_name_only_what_is_written(ns):
    obj = make_inspire(ns)
    assert [step for _s, step in obj._requested_language_artifacts("Arabic")] == [
        "Markdown Catalog", "CSV Catalog", "JSON Catalog"]
    assert [step for _s, step in obj._requested_language_artifacts("English")] == ["Markdown Catalog", "CSV Catalog"]


def test_document_generation_is_gated_by_the_languages_only():
    from _agentload import agent_ast
    gates = []
    for node in ast.walk(agent_ast()):
        if not isinstance(node, ast.If):
            continue
        refs = [n for stmt in node.body for n in ast.walk(stmt)
                if isinstance(n, ast.Attribute) and n.attr == "_generate_language_catalogs"]
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
