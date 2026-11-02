"""v1.2.0 ARTIFACTS lane: Excel / CSV / PDF / PPTX / Markdown writers.

F-07/F-08/F-18/F-19/D2-18/E-23: one shared ordering through `_final_rank_key` (domains by their
best member, highlights are the top members after sorting), Markdown shows Quality Score, Inspire
Score and bob_score, nothing defaults to 'Medium', 5.0 or 0; E-19 the dead SQL-results cache is
gone; the Ultra High fields surface (Excel/CSV columns, "Why this use case qualifies", domain
coverage picks labelled below the bar); F-09 packages are installed at most once per run and a
writer failure is raised and recorded instead of being reported as success.
"""
import csv
import io
import sys
import types

import pytest

from v120_artifacts_support import elite_assessment, make_inspire, make_uc


@pytest.fixture
def ranked(agent_ns, monkeypatch):
    monkeypatch.setattr(agent_ns["workspace"], "ImportFormat", types.SimpleNamespace(AUTO="AUTO"), raising=False)
    return agent_ns


@pytest.fixture
def fake_weasyprint(monkeypatch):
    captured = []

    class HTML:
        def __init__(self, string=None, **kwargs):
            captured.append(string)

        def write_pdf(self, path, font_config=None):
            with open(path, "wb") as fh:
                fh.write(b"%PDF-1.4 fake")
    monkeypatch.setitem(sys.modules, "weasyprint", types.SimpleNamespace(HTML=HTML))
    return captured


def english(ns):
    return dict(ns["TranslationService"].ENGLISH_TRANSLATIONS)


def portfolio():
    sales = [make_uc(f"N01-U0{i}", "Sales", Name=f"Sales idea {i}", **{"Inspire Score": score})
             for i, score in enumerate([5.0, 6.0, 4.0, 5.5, 6.5, 9.0], start=1)]
    ops = [make_uc("N02-U01", "Operations", Name="Ops idea 1", **{"Inspire Score": 8.0}),
           make_uc("N02-U02", "Operations", Name="Ops pick", elite_status="DOMAIN_COVERAGE_PICK",
                   coverage_pick_reason="Domain coverage pick, below bar: quality 'Medium' is below the High bar",
                   **{"Inspire Score": 9.9})]
    return {"Operations": ops, "Sales": sales}


def test_rank_domain_groups_orders_domains_by_their_best_member(ranked):
    obj = make_inspire(ranked)
    groups = obj._rank_domain_groups(portfolio())
    assert [d for d, _ in groups] == ["Sales", "Operations"]
    assert [uc["No"] for uc in groups[0][1]] == ["N01-U06", "N01-U05", "N01-U02", "N01-U04", "N01-U01", "N01-U03"]
    assert [uc["No"] for uc in groups[1][1]] == ["N02-U01", "N02-U02"]
    assert obj._priority_sort_key(make_uc("x")) == obj._final_rank_key(make_uc("x"))


def _pdf_html(ns, captured, grouped, language="English", t=None):
    obj = make_inspire(ns)
    obj.generate_catalog_pdf(language, "en", t or english(ns), {"Executive": "<p>Exec</p>"}, grouped, "Acme")
    assert captured, "PDF HTML was not rendered"
    return obj, captured[-1]


def test_pdf_toc_detail_and_highlights_follow_the_shared_order(ranked, fake_weasyprint):
    obj, html = _pdf_html(ranked, fake_weasyprint, portfolio())
    sales_start = html.index("id=\"domain-1\">Sales<")
    assert sales_start < html.index("id=\"domain-2\">Operations<")
    assert html.index("href=\"#domain-1\"") < html.index("href=\"#domain-2\"")
    sales_page = html[sales_start:html.index("<section class=\"cards\">", sales_start)]
    assert "N01-U06" in sales_page and "N01-U03" not in sales_page and "N01-U04" not in sales_page
    detail = html[html.index("<section class=\"cards\">", sales_start):html.index("id=\"domain-2\"")]
    order = [detail.index(f"id=\"uc-N01-U0{i}\"") for i in (6, 5, 2, 4, 1, 3)]
    assert order == sorted(order)
    assert "Example Results" not in html and obj.w_client.workspace.files


REMOVED_ELITE_PANEL_TEXT = ("Why this use case qualifies", "Decision Owner", "Regional supply planner", "Stock-out rate",
                            "Value Driver", "Build Path", "Red-Team Note", "Promotions not in the data", "Evidence Columns",
                            "Join Path", "Decision Cadence", "Elite assessment", "Evidence strength", "Implementability",
                            "Actionability", "Weekly reorder decision")


def test_pdf_labels_coverage_picks_and_keeps_only_the_elite_score_of_elite_use_cases(ranked, fake_weasyprint):
    elite = make_uc("N01-U01", "Sales", elite_status="ELITE", elite_score=8.7, elite_assessment=elite_assessment())
    pick = portfolio()["Operations"][1]
    _, html = _pdf_html(ranked, fake_weasyprint, {"Sales": [elite], "Operations": [pick]})
    assert "Domain coverage pick, below the bar" in html and "quality &#x27;Medium&#x27; is below the High bar" in html
    card = html[html.index('id="uc-N01-U01"'):]
    card = card[:card.index("</article>")]
    assert '>8.7 / 10</div><div class="l">Elite Score<' in card
    for text in REMOVED_ELITE_PANEL_TEXT:
        assert text not in html, text
    assert 'class="elite"' not in html and "redteam" not in html and "meters" not in html


def test_pdf_never_fabricates_an_alignment(ranked, fake_weasyprint):
    uc = make_uc("N01-U01", "Sales")
    _, html = _pdf_html(ranked, fake_weasyprint, {"Sales": [uc]})
    assert "General Improvement" not in html
    assert "Business Priority Alignment</td><td>Not provided</td>" in html


def test_pdf_flags_untranslated_text_in_other_languages(ranked, fake_weasyprint):
    t = english(ranked)
    t["untranslated_notice"] = "Affiché en anglais (traduction indisponible)"
    t["statement"] = "Déclaration"
    uc = make_uc("N01-U01", "Ventes", _translation_status="partial", _untranslated_fields=["Statement"])
    _, html = _pdf_html(ranked, fake_weasyprint, {"Ventes": [uc]}, language="French", t=t)
    assert "Affiché en anglais (traduction indisponible): Déclaration" in html
    whole = make_uc("N01-U02", "Ventes", _translation_status="untranslated", _untranslated_fields=["Name", "Statement"])
    _, html = _pdf_html(ranked, fake_weasyprint, {"Ventes": [whole]}, language="French", t=t)
    assert "<em>Affiché en anglais (traduction indisponible)</em>" in html


def test_pdf_domain_page_labels_are_translated(ranked, fake_weasyprint):
    t = english(ranked)
    t.update(ranked["TranslationService"].TRANSLATION_FALLBACKS["Spanish"])
    _, html = _pdf_html(ranked, fake_weasyprint, portfolio(), language="Spanish", t=t)
    assert "Principales oportunidades" in html and "Sobre este dominio" in html and "Qué abarca" in html
    assert "Top opportunities" not in html and "About this domain" not in html and "What it covers" not in html


def test_pdf_failure_is_raised_and_recorded_not_reported_as_success(ranked, fake_weasyprint):
    obj = make_inspire(ranked)
    obj.w_client.workspace.fail = True
    with pytest.raises(RuntimeError, match="workspace import limit"):
        obj.generate_catalog_pdf("English", "en", english(ranked), {}, portfolio(), "Acme")
    assert obj.failed_steps == [{"step": "PDF Catalog", "language": "English", "error": "workspace import limit exceeded"}]


def test_concurrent_pdf_renders_are_serialized_by_the_class_lock(ranked, monkeypatch):
    import threading
    both_inside = threading.Barrier(2, timeout=2.0)
    overlapped, errors = [], []

    class HTML:
        def __init__(self, string=None, **kwargs):
            pass

        def write_pdf(self, path, font_config=None):
            try:
                both_inside.wait()
                overlapped.append(True)
            except threading.BrokenBarrierError:
                pass
            with open(path, "wb") as fh:
                fh.write(b"%PDF-1.4 fake")
    monkeypatch.setitem(sys.modules, "weasyprint", types.SimpleNamespace(HTML=HTML))

    def run():
        try:
            obj = make_inspire(ranked)
            obj.generate_catalog_pdf("English", "en", english(ranked), {"Executive": "<p>x</p>"}, portfolio(), "Acme")
        except Exception as problem:
            errors.append(problem)

    threads = [threading.Thread(target=run) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=15)
    assert not errors, errors
    assert overlapped == [], "both PDF renders ran concurrently; _PDF_RENDER_LOCK is not serializing them"


def _pptx_texts(ns, grouped, language="English", t=None):
    from pptx import Presentation
    obj = make_inspire(ns)
    obj.generate_presentation_pptx(language, "en", t or english(ns), {"Executive": "Exec."}, grouped, "Acme")
    data = next(iter(obj.w_client.workspace.files.values()))
    deck = Presentation(io.BytesIO(data))
    return [" | ".join(shape.text_frame.text for shape in slide.shapes if shape.has_text_frame) for slide in deck.slides]


def test_pptx_follows_the_shared_order_and_shows_one_card_per_elite_use_case(ranked):
    import re
    grouped = portfolio()
    grouped["Sales"][0].update(elite_status="ELITE", elite_score=9.5, elite_assessment=elite_assessment())
    slides = _pptx_texts(ranked, grouped)
    deep = [i for i, s in enumerate(slides) if "| 1 | N01-U01 · SALES · " in s]
    assert len(deep) == 1 and "9.5 / 10 | Elite Score" in slides[deep[0]]
    for text in REMOVED_ELITE_PANEL_TEXT:
        assert not any(text in slide for slide in slides), text
    index = next(s for s in slides if s.startswith("APPENDIX | Use case index"))
    assert re.findall(r"\| (N0\d-U0\d) \|", index) == ["N01-U01", "N01-U06", "N02-U01", "N01-U05", "N01-U02", "N01-U04", "N01-U03", "N02-U02"]
    assert "| N02-U02 | Coverage pick · Forecast Demand N02-u02 | Operations |  | High | 9.9 / 10" in index
    sales = next(s for s in slides if "| DOMAIN 01 | Sales |" in s)
    assert re.findall(r"\| (N01-U0\d) \|", sales) == ["N01-U01", "N01-U06", "N01-U05"]


def test_pptx_failure_is_raised_and_recorded(ranked):
    obj = make_inspire(ranked)
    obj.w_client.workspace.fail = True
    with pytest.raises(RuntimeError):
        obj.generate_presentation_pptx("English", "en", english(ranked), {}, portfolio(), "Acme")
    assert obj.failed_steps[0]["step"] == "Presentation"


def _markdown(ns, grouped):
    obj = make_inspire(ns)
    obj._generate_markdown_catalog("English", "en", grouped, {"Executive": "<p>Exec <b>summary</b></p>", "Sales": "<p>Sales summary</p>"}, "Acme")
    return next(iter(obj.w_client.workspace.files.values())).decode("utf-8")


def test_markdown_shows_real_scores_and_never_mislabels_priority(ranked):
    uc = make_uc("N01-U01", "Sales", Priority=9.5, bob_score=8.3, **{"Quality Score": 4.5, "Inspire Score": 8.1})
    md = _markdown(ranked, {"Sales": [uc]})
    assert "- **Quality:** High\n" in md
    assert "- **Quality Score:** 4.5 / 5\n" in md and "- **Inspire Score:** 8.1 / 10\n" in md and "- **Best-of-Best Score:** 8.3 / 10\n" in md
    assert "- **Priority:** 9.5 / 10\n" in md and "bob_score" not in md
    assert "(Score:" not in md
    assert "## Executive Summary\nExec summary\n" in md and "Sales summary" in md


def test_markdown_unscored_shows_not_scored_never_medium(ranked):
    uc = make_uc("N01-U01", "Sales")
    for key in ("Quality", "Quality Score", "Inspire Score"):
        uc.pop(key)
    md = _markdown(ranked, {"Sales": [uc]})
    assert "- **Quality:** Not scored\n" in md and "Medium" not in md
    assert "- **Quality Score:** Not scored\n" in md and "- **Best-of-Best Score:** Not scored\n" in md
    assert "- **Inspire Score:** Not scored\n" in md and "- **Business Priority Alignment:** Not provided\n" in md


def test_markdown_order_elite_score_and_coverage_label_without_the_elite_panel(ranked):
    grouped = portfolio()
    grouped["Sales"][2].update(elite_status="ELITE", elite_score=9.9, elite_assessment=elite_assessment())
    md = _markdown(ranked, grouped)
    import re
    headings = re.findall(r"^#### #(\d+) (N0\d-U0\d)", md, re.M)
    assert [h[1] for h in headings] == ["N01-U03", "N01-U06", "N01-U05", "N01-U02", "N01-U04", "N01-U01", "N02-U01", "N02-U02"]
    assert [h[0] for h in headings] == ["1", "2", "4", "5", "6", "7", "3", "8"]
    assert "> **Domain coverage pick, below the bar**. Reason: Domain coverage pick, below bar" in md
    assert "- **Elite Score:** 9.9 / 10\n" in md
    for text in REMOVED_ELITE_PANEL_TEXT:
        assert text not in md, text
    standard = ranked["TranslationService"].ENGLISH_TRANSLATIONS["doc_data_access_standard"]
    assert md.rstrip().endswith("*") and "## Disclaimer" in md and standard in md and "read no customer data" in standard


def _csv_rows(ns, grouped):
    obj = make_inspire(ns)
    obj._normalize_usecase = lambda usecase, name: usecase
    obj._generate_csv_catalog("English", "en", grouped)
    text = next(iter(obj.w_client.workspace.files.values())).decode("utf-8-sig")
    return list(csv.reader(io.StringIO(text)))


def test_csv_ranks_globally_and_marks_missing_scores_not_scored(ranked):
    rows = _csv_rows(ranked, portfolio())
    header, body = rows[0], rows[1:]
    assert [r[0] for r in body] == ["N01-U06", "N02-U01", "N01-U05", "N01-U02", "N01-U04", "N01-U01", "N01-U03", "N02-U02"]
    roi = header.index("ROI")
    assert all(r[roi] == "Not scored" for r in body)
    assert body[0][header.index("Inspire Score")] == "9.0"
    assert header[-13:] == ["Elite Status", "Verdict", "Decision", "Decision Owner", "Decision Cadence", "KPI", "Value Driver",
                            "Evidence Columns", "Join Path", "Build Path", "Red-Team Note", "Coverage Pick Reason", "Below Bar Reason"]
    assert header[:14] == ["ID", "Rank", "Business Domain", "Subdomain", "Use Case", "Description", "Quality", "Inspire Score",
                           "Elite Score", "Quality Score", "Best-of-Best Score", "Priority", "Value", "Feasibility"]
    assert [r[1] for r in body] == ["1", "2", "3", "4", "5", "6", "7", "8"]
    pick = body[-1]
    assert pick[header.index("Elite Status")] == "DOMAIN_COVERAGE_PICK"
    assert pick[header.index("Elite Score")] == "Not scored"
    assert pick[header.index("Coverage Pick Reason")].startswith("Domain coverage pick, below bar")
    assert body[0][header.index("Business Priority Alignment")] == "N/A"


def test_csv_without_elite_fields_keeps_the_base_columns(ranked):
    header = _csv_rows(ranked, {"Sales": [make_uc("N01-U01")]})[0]
    obj = make_inspire(ranked)
    assert header == [h for h, _getter, _numeric in obj._export_columns(False)]
    assert "Elite Score" not in header and "Elite Status" not in header and "Sponsor" in header and "Beneficiary" in header


def test_excel_carries_elite_columns_and_real_scores(ranked):
    import openpyxl
    grouped = {"Sales": [make_uc("N01-U01", elite_status="ELITE", elite_score=8.6, elite_assessment=elite_assessment())]}
    obj = make_inspire(ranked)
    obj._generate_use_case_excel("English", "en", grouped)
    workbook = openpyxl.load_workbook(io.BytesIO(next(iter(obj.w_client.workspace.files.values()))))
    sheet = workbook["Use Cases"]
    header = [c.value for c in sheet[1]]
    row = dict(zip(header, [c.value for c in sheet[2]]))
    assert row["Elite Status"] == "ELITE" and row["Elite Score"] == pytest.approx(8.6)
    assert row["Decision Owner"] == "Regional supply planner" and row["KPI"] == "Stock-out rate (↓)"
    assert row["Evidence Columns"] == "main.s.sales.units_sold, main.s.sales.sale_date"
    assert row["Inspire Score"] == pytest.approx(7.65) and row["ROI"] == "Not scored"


def test_excel_upload_failure_is_raised_and_recorded(ranked):
    obj = make_inspire(ranked)
    obj.w_client.workspace.fail = True
    with pytest.raises(RuntimeError):
        obj._generate_use_case_excel("English", "en", {"Sales": [make_uc("N01-U01")]})
    assert obj.failed_steps[0]["step"] == "Use Case Excel"


def test_markdown_and_csv_failures_are_raised_and_recorded(ranked):
    obj = make_inspire(ranked)
    obj.w_client.workspace.fail = True
    with pytest.raises(RuntimeError):
        obj._generate_markdown_catalog("English", "en", {"Sales": [make_uc("N01-U01")]}, {}, "Acme")
    with pytest.raises(RuntimeError):
        obj._generate_csv_catalog("English", "en", {"Sales": [make_uc("N01-U01")]})
    assert [f["step"] for f in obj.failed_steps] == ["Markdown Catalog", "CSV Catalog"]


def test_dead_sql_results_cache_is_removed(agent_ns):
    cls = agent_ns["DatabricksInspire"]
    assert not hasattr(cls, "_get_cached_sql_result") and not hasattr(cls, "_ensure_sql_results_cache_dir")
    assert "example_results" not in agent_ns["TranslationService"].ENGLISH_TRANSLATIONS
    from _agentload import agent_source
    assert "inspire_sql_cache_" not in agent_source()


def test_pdf_and_pptx_share_one_value_translator(agent_ns):
    from _agentload import method_node
    import ast
    for writer in ("generate_catalog_pdf", "generate_presentation_pptx"):
        inner = {n.name for n in ast.walk(method_node("DatabricksInspire", writer)) if isinstance(n, ast.FunctionDef)}
        assert not inner & {"translate_pdf_value", "translate_strategic_value", "translate_analytics_technique",
                            "translate_pptx_value", "translate_strategic_pptx_value", "translate_analytics_pptx_value",
                            "get_use_case_sort_key", "_install_dependencies", "_install_pptx_dependencies"}, writer
    obj = make_inspire(agent_ns)
    t = english(agent_ns)
    t["value_reduce_cost"] = "Réduire les coûts"
    t["value_priority_high"] = "Élevé"
    assert obj._translate_alignment_value("Reduce Cost, Unknown", t) == "Réduire les coûts, Unknown"
    assert obj._translate_display_value("High", t) == "Élevé" and obj._translate_display_value("N/A", t) == "N/A"
    assert obj._translate_technique_value("Forecasting", english(agent_ns), "Arabic") == "التنبؤ"


class _Completed:
    def __init__(self, returncode, stderr=""):
        self.returncode = returncode
        self.stderr = stderr
        self.stdout = ""


def test_english_documents_reuse_the_run_summary_instead_of_asking_again(ranked):
    uc = make_uc("N01-U01")
    obj = make_inspire(ranked, generate_choices=[])
    obj._python_package_status = {"weasyprint": (True, "")}
    calls, received = [], []
    obj._get_salesy_summary = lambda grouped, name, lang, t: calls.append(lang) or ({"Executive": "a second summary"}, name)
    obj.translation_service = types.SimpleNamespace(get_translations=lambda lang: english(ranked))
    obj._generate_markdown_catalog = lambda lang, abbr, grouped, summary, name, translations=None: received.append((summary, name))
    obj._generate_csv_catalog = lambda lang, abbr, grouped, translations=None: None
    obj.generate_catalog_pdf = lambda *a: received.append(a[3])
    obj._emit_pipeline_status = lambda **kw: 1
    summary = {"Executive": "the summary run() already produced"}
    obj._generate_documents_for_all_languages([uc], english_grouped_data={"Sales": [uc]}, summary_dict=summary,
                                              languages=["English"], skip_excel_langs=["English"])
    assert calls == []
    assert (summary, "Acme") in received and summary in received


def test_missing_pdf_dependency_is_a_failed_step_and_a_missing_artifact(ranked, monkeypatch):
    obj = make_inspire(ranked, generate_choices=["PDF Catalog"])
    obj._python_package_status = {"weasyprint": (False, "'pip install weasyprint' failed with exit code 1")}
    statuses = []
    obj._emit_pipeline_status = lambda **kw: statuses.append(kw) or len(statuses)
    obj.translation_service = types.SimpleNamespace(get_translations=lambda lang: english(ranked))
    obj._get_salesy_summary = lambda grouped, name, lang, t: ({"Executive": "x"}, name)
    obj._generate_documents_for_all_languages([make_uc("N01-U01")], english_grouped_data={"Sales": [make_uc("N01-U01")]},
                                              summary_dict={"Executive": "x"}, languages=["English"], skip_excel_langs=["English"])
    pdf_end = [s for s in statuses if s.get("step_name") == "PDF Catalog" and s["status"].startswith("ended_")]
    assert pdf_end and pdf_end[0]["status"] == "ended_error"
    assert {"step": "PDF Catalog", "language": "English"}.items() <= obj.failed_steps[0].items()
    assert obj.logger.matching("[VIBE-LANG missing-artifacts]", level="WARNING")
    assert not obj.logger.matching("[VIBE-LANG all-artifacts-produced]")
