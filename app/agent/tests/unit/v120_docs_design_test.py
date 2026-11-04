"""v1.2.0 DOCS-DESIGN lane: the redesigned PDF catalog and PPTX presentation.

Regression root cause: f656ed4 (2026-04-16) replaced `summary_dict.get(domain)` with a bullet list of
use-case names on the PDF domain page and the PPTX domain slide, so the domain prose produced by
`_get_salesy_summary` (and saved in every JSON catalog) never reached a domain page again. The summary
lookup was also an exact match on the LLM's row label, with an English-only fallback text.

Covered here: domain pages describe the domain (prose, coverage, best scores, top opportunities); summary
keys are canonicalized to the document's domain names with must-exclude cases; every new label exists in
all 23 languages with intact placeholders and no em dashes; Arabic is RTL in both formats; the deck never
puts the same layout on two consecutive slides, never goes below 12pt, and keeps text inside the slide;
fonts are fetched once and fall back cleanly offline; the HTML carries every required section.
"""
import io
import re
import sys
import types

import pytest

from v120_artifacts_support import elite_assessment, make_inspire, make_uc

LANGUAGES = ("English", "French", "German", "Spanish", "Hindi", "Chinese (Mandarin)", "Japanese", "Arabic", "Portuguese",
             "Russian", "Swedish", "Danish", "Norwegian", "Finnish", "Italian", "Polish", "Romanian", "Ukrainian", "Dutch",
             "Korean", "Indonesian", "Malay", "Tamil")
SALES_PROSE = ("The Sales domain governs how the business converts demand into revenue across every channel. "
               "It is where pricing, promotion and assortment decisions meet the customer.")
OPS_PROSE = "Operations keeps stores supplied and staffed so that every promise made to a customer is kept."


@pytest.fixture
def docs(agent_ns, monkeypatch):
    cls = agent_ns["DatabricksInspire"]
    monkeypatch.setattr(agent_ns["workspace"], "ImportFormat", types.SimpleNamespace(AUTO="AUTO"), raising=False)
    monkeypatch.setattr(cls, "_DOC_FONT_FILES", {}, raising=False)
    return agent_ns


@pytest.fixture
def captured_html(monkeypatch):
    captured = []

    class HTML:
        def __init__(self, string=None, **kwargs):
            captured.append(string)

        def write_pdf(self, path, font_config=None):
            with open(path, "wb") as handle:
                handle.write(b"%PDF-1.4 fake")
    monkeypatch.setitem(sys.modules, "weasyprint", types.SimpleNamespace(HTML=HTML))
    return captured


def labels(ns, language="English"):
    ts = ns["TranslationService"]
    t = dict(ts.ENGLISH_TRANSLATIONS)
    if language != "English":
        t.update(ts.TRANSLATION_FALLBACKS[language])
    return t


def portfolio(mode="Good"):
    sales = [make_uc(f"N01-U0{i}", "Sales", Name=f"Sales idea {i}", Subdomain=("Pricing" if i % 2 else "Promotion"),
                     quality_mode=mode, **{"Inspire Score": score}) for i, score in enumerate([5.0, 6.0, 4.0, 5.5, 6.5, 9.0], start=1)]
    ops = [make_uc("N02-U01", "Operations", Name="Ops idea 1", quality_mode=mode, **{"Inspire Score": 8.0}),
           make_uc("N02-U02", "Operations", Name="Ops pick", quality_mode=mode, elite_status="DOMAIN_COVERAGE_PICK",
                   coverage_pick_reason="Domain coverage pick, below bar: quality 'Medium' is below the High bar",
                   **{"Inspire Score": 9.9})]
    return {"Operations": ops, "Sales": sales}


def summary():
    return {"Executive": "<p>Exec one.</p><p>Exec two.</p>", "Sales": f"<p>{SALES_PROSE}</p>", "Operations": f"<p>{OPS_PROSE}</p>"}


def pdf_html(ns, captured, grouped, summary_dict, language="English", t=None, **attrs):
    obj = make_inspire(ns, **attrs)
    obj.generate_catalog_pdf(language, "xx", t or labels(ns, language), summary_dict, grouped, "Acme")
    assert captured, "the PDF HTML was not rendered"
    return obj, captured[-1]


def deck(ns, grouped, summary_dict, language="English", t=None):
    from pptx import Presentation
    obj = make_inspire(ns)
    obj.generate_presentation_pptx(language, "xx", t or labels(ns, language), summary_dict, grouped, "Acme")
    data = next(iter(obj.w_client.workspace.files.values()))
    return obj, Presentation(io.BytesIO(data))


def slide_texts(prs):
    return [" | ".join(shape.text_frame.text for shape in slide.shapes if shape.has_text_frame) for slide in prs.slides]


def archetypes_logged(obj):
    record = obj.logger.matching("[DOCS-PPTX]")[-1][1]
    return re.search(r"layouts=(\[.*?\])", record).group(1)


def section(html, start_marker, end_marker):
    start = html.index(start_marker)
    end = html.index(end_marker, start + len(start_marker))
    return html[start:end]


def test_pdf_domain_page_describes_the_domain_not_a_bullet_list(docs, captured_html):
    _, html = pdf_html(docs, captured_html, portfolio(), summary())
    assert SALES_PROSE in html and OPS_PROSE in html, "the domain prose from _get_salesy_summary never reached the domain pages"
    sales = section(html, 'id="domain-1">Sales<', '<section class="cards">')
    assert SALES_PROSE in sales
    assert "About this domain" in sales and "What it covers" in sales and "Top opportunities" in sales
    assert "Pricing <b>3</b>" in sales and "Promotion <b>3</b>" in sales
    assert ">6</div><div class=\"l\">Use cases<" in sales and ">9.0 / 10</div><div class=\"l\">Best Inspire Score<" in sales
    tops = section(sales, '<table class="index">', "</table>")
    assert re.findall(r'class="ix-id">(?:<a [^>]*>)?(N01-U0\d)', tops) == ["N01-U06", "N01-U05", "N01-U02"]
    assert "<ul>" not in sales
    ops = section(html, 'id="domain-2">Operations<', '<section class="cards">')
    assert OPS_PROSE in ops


def test_pptx_domain_slide_carries_the_domain_narrative(docs):
    obj, prs = deck(docs, portfolio(), summary())
    texts = slide_texts(prs)
    assert any(SALES_PROSE.split(". ")[0] in t for t in texts), "no slide carries the Sales domain narrative"
    sales = next(t for t in texts if "Sales" in t and "About this domain" in t)
    assert SALES_PROSE.split(". ")[0] in sales
    assert "| N01-U06 | Forecast Demand N01-u06 | Sales |" in sales and "| High | 9.0 / 10" in sales
    assert re.findall(r"\| (N01-U0\d) \|", sales) == ["N01-U06", "N01-U05", "N01-U02"]
    operations = next(t for t in texts if t.count("Operations") and OPS_PROSE[:40] in t)
    assert operations


def test_domain_page_without_a_summary_uses_a_translated_data_overview(docs, captured_html):
    _, html = pdf_html(docs, captured_html, portfolio(), {"Executive": "<p>x</p>"}, language="Arabic")
    opener = section(html, 'id="domain-1">', '<section class="cards">')
    assert "يجمع هذا المجال حالات استخدام عبر \u2066Promotion\u2069، \u2066Pricing\u2069، وعددها \u20666\u2069." in opener
    assert "Summary generation failed" not in html and "{count}" not in html and "{subdomains}" not in html


@pytest.mark.parametrize("placeholder", [
    "<p>Summary generation failed. This domain's key responsibilities and opportunities have been identified for AI transformation.</p>",
    "Domain: Sales with 6 use cases",
])
def test_legacy_placeholder_summaries_never_reach_a_domain_page(docs, captured_html, placeholder):
    _, html = pdf_html(docs, captured_html, portfolio(), {"Executive": "<p>x</p>", "Sales": placeholder})
    opener = section(html, 'id="domain-1">Sales<', '<section class="cards">')
    assert "This domain brings together use cases across Promotion, Pricing, 6 in total." in opener
    assert "Summary generation failed" not in opener and "Domain: Sales with" not in opener


def test_canonical_summary_matches_llm_labels_and_rejects_ambiguity(docs):
    obj = make_inspire(docs)
    domains = ["Customers", "Customer Support", "Risk (Risque)", "Finance & Billing", "Revenue"]
    raw = {"executive summary": "E", "customers": "c", "**Finance & Billing**": "f", "Risk": "r",
           "Customer": "ambiguous", "Revenu": "rev", "Unrelated Area": "u"}
    canonical, unmatched = obj._canonical_summary(raw, domains)
    assert canonical == {"Executive": "E", "Customers": "c", "Finance & Billing": "f", "Risk (Risque)": "r", "Revenue": "rev"}
    assert sorted(unmatched) == ["Customer", "Unrelated Area"]


def test_salesy_summary_returns_domain_keys_verbatim_and_recovers_the_executive_row(docs):
    seen = []

    def run_worker(step_name, worker_prompt_path, prompt_vars, response_schema, **kw):
        seen.append(prompt_vars)
        return ("\"Type\",\"Summary\",\"TransliteratedBusinessName\"\n"
                "\"Résumé exécutif\",\"<p>Acme''s plan.</p>\",\"Acmé\"\n"
                "\"ventes\",\"<p>Les ventes d''Acme.</p>\",\"\"\n")
    obj = make_inspire(docs, ai_agent=types.SimpleNamespace(run_worker=run_worker))
    obj._get_generation_instruction_for_prompt = lambda name: ""
    grouped = {"Ventes": [make_uc("N01-U01", "Ventes")], "Opérations": [make_uc("N02-U01", "Opérations")]}
    t = labels(docs, "French")
    result, name = obj._get_salesy_summary(grouped, "Acme", "French", t)
    assert result["Executive"] == "<p>Acme''s plan.</p>" and name == "Acmé"
    assert result["Ventes"] == "<p>Les ventes d''Acme.</p>" and "ventes" not in result
    assert obj.logger.matching("[DOCS-SUMMARY executive-recovered]", level="WARNING")
    assert obj.logger.matching("[DOCS-SUMMARY] French: 1/2 domain summaries matched; missing ['Opérations']")


def test_salesy_summary_failure_has_no_english_domain_text(docs):
    def run_worker(*a, **k):
        raise RuntimeError("model unavailable")
    obj = make_inspire(docs, ai_agent=types.SimpleNamespace(run_worker=run_worker))
    obj._get_generation_instruction_for_prompt = lambda name: ""
    result, _ = obj._get_salesy_summary({"Ventes": [make_uc("N01-U01", "Ventes")]}, "Acme", "French", labels(docs, "French"))
    assert set(result) == {"Executive"}
    assert "Summary generation failed" not in str(result)


def test_highlights_follow_the_final_rank_so_the_prose_names_the_shown_top_cases(docs):
    seen = []

    def run_worker(step_name, worker_prompt_path, prompt_vars, response_schema, **kw):
        seen.append(prompt_vars)
        return '"Type","Summary","TransliteratedBusinessName"\n"Executive","x","Acme"\n'
    obj = make_inspire(docs, ai_agent=types.SimpleNamespace(run_worker=run_worker))
    obj._get_generation_instruction_for_prompt = lambda name: ""
    elite = make_uc("N01-U02", "Sales", Name="Elite pick", elite_status="ELITE", elite_score=9.6, **{"Inspire Score": 5.0})
    plain = make_uc("N01-U01", "Sales", Name="Plain high", **{"Inspire Score": 9.0})
    obj._get_salesy_summary({"Sales": [plain, elite]}, "Acme", "English", labels(docs))
    highlights = seen[0]["domain_use_case_highlights"]
    assert highlights.index(obj._doc_use_case_title(elite, "English")) < highlights.index(obj._doc_use_case_title(plain, "English"))


def test_markdown_catalog_uses_the_canonical_domain_summary(docs):
    obj = make_inspire(docs)
    grouped = {"Sales": [make_uc("N01-U01", "Sales")]}
    obj._generate_markdown_catalog("English", "en", grouped, {"Executive": "<p>E</p>", "sales": f"<p>{SALES_PROSE}</p>"}, "Acme")
    md = next(iter(obj.w_client.workspace.files.values())).decode("utf-8")
    assert SALES_PROSE in md


def test_json_catalog_saves_the_domain_prose_under_the_domain_name(docs):
    import json as _json
    obj = make_inspire(docs)
    obj.column_id_map, obj.id_column_map, obj.table_id_map, obj.id_table_map = {}, {}, {}, {}
    obj.catalogs_str, obj.schemas_str, obj.generation_path = "main", "", "/Workspace/out"
    obj._save_usecases_catalog_json([make_uc("N01-U01", "Sales")], {}, summary_dict={"Executive": "x", "SALES ": f"<p>{SALES_PROSE}</p>"})
    payload = _json.loads(next(iter(obj.w_client.workspace.files.values())))
    assert payload["domains"][0]["domain_name"] == "Sales"
    assert payload["domains"][0]["summary"] == f"<p>{SALES_PROSE}</p>"


def writer_label_keys(ns):
    from _agentload import agent_source
    source = agent_source()
    start = source.index("    _DOC_COLORS = {")
    end = source.index("    _PYTHON_PACKAGE_LOCK = threading.Lock()")
    block = source[start:end]
    keys = set(re.findall(r'\bT\(\s*"([a-z_0-9]+)"', block)) | set(re.findall(r"_doc_text\(t, \"([a-z_0-9]+)\"", block))
    keys |= set(re.findall(r'"((?:doc|value_mode)_[a-z_0-9]+)"', block))
    for name in ("_USE_CASE_VIEW_ELITE",):
        keys |= {key for key, _ in getattr(ns["DatabricksInspire"], name)}
    return sorted(keys)


def test_every_document_label_exists_in_all_23_languages_with_its_placeholders(docs):
    ts = docs["TranslationService"]
    keys = writer_label_keys(docs)
    assert len(keys) >= 90, keys
    placeholder = re.compile(r"\{([a-z_]+)\}")
    missing = [k for k in keys if k not in ts.ENGLISH_TRANSLATIONS]
    assert not missing, missing
    assert set(ts.TRANSLATION_FALLBACKS) | {"English"} == set(LANGUAGES)
    for language in LANGUAGES[1:]:
        fallbacks = ts.TRANSLATION_FALLBACKS[language]
        absent = [k for k in keys if not str(fallbacks.get(k) or "").strip()]
        assert not absent, (language, absent)
        for key in keys:
            assert set(placeholder.findall(fallbacks[key])) == set(placeholder.findall(ts.ENGLISH_TRANSLATIONS[key])), (language, key)
    for language in ("Arabic", "Japanese", "Korean", "Hindi", "Tamil", "Chinese (Mandarin)", "Russian", "Ukrainian"):
        same = [k for k in keys if k.startswith("doc_") and ts.TRANSLATION_FALLBACKS[language][k] == ts.ENGLISH_TRANSLATIONS[k]]
        assert not same, (language, same)


def test_no_em_or_en_dash_in_any_document_label(docs):
    ts = docs["TranslationService"]
    keys = [k for k in writer_label_keys(docs) if k.startswith(("doc_", "value_mode_"))]
    for language in LANGUAGES:
        table = ts.ENGLISH_TRANSLATIONS if language == "English" else ts.TRANSLATION_FALLBACKS[language]
        offenders = [k for k in keys if "\u2014" in table[k] or "\u2013" in table[k]]
        assert not offenders, (language, offenders)


def test_doc_text_rejects_a_translation_that_dropped_a_placeholder(docs):
    obj = make_inspire(docs)
    t = labels(docs, "German")
    t["doc_domain_fallback"] = "Dieser Bereich vereint Anwendungsfälle."
    text = obj._doc_text(t, "doc_domain_fallback", "German", count=4, subdomains="Preise")
    assert text.startswith("Dieser Bereich vereint Anwendungsfälle aus Preise, insgesamt 4.")
    t["doc_domain_fallback"] = "{count} only"
    assert obj._doc_text(t, "doc_domain_fallback", "Klingon", count=4, subdomains="x").startswith("This domain brings together use cases across x, 4 in total.")
    assert obj._doc_text({}, "doc_domain_fallback", "Klingon", count=2, subdomains="A, B").startswith("This domain brings together use cases across A, B, 2 in total.")


def test_quality_mode_comes_from_the_use_cases_not_the_widget(docs):
    obj = make_inspire(docs, use_cases_quality="Good")
    assert obj._doc_quality_mode([make_uc("a", quality_mode="High"), make_uc("b", quality_mode="Strict Quality")]) == "High"
    assert obj._doc_quality_mode([make_uc("a", elite_status="ELITE")]) == "Ultra High"
    assert obj._doc_quality_mode([make_uc("a"), make_uc("b")]) == ""


def test_pdf_html_has_every_section_and_one_card_per_use_case(docs, captured_html):
    obj, html = pdf_html(docs, captured_html, portfolio(), summary())
    body = html[html.index("<body"):]
    order = [body.index(marker) for marker in ('class="cover"', 'id="sec-contents"', 'id="sec-executive"', 'id="sec-guide"',
                                               'id="sec-portfolio"', 'id="domain-1">Sales<', 'id="domain-2">Operations<',
                                               'id="sec-index"', 'id="sec-methodology"', 'id="sec-roadmap"',
                                               'id="sec-disclaimer"', 'class="closing"')]
    assert order == sorted(order)
    assert body.index('id="sec-methodology"') < body.index(">Glossary<", body.index('id="sec-methodology"')) < body.index('id="sec-roadmap"')
    assert html.count('<article class="uc') == 8 and html.count('class="opener"') == 2
    assert "Quality mode: Good" in html and "This catalog" in html
    assert html.count('class="ribbon"') == 1 and "Domain coverage pick, below the bar" in html
    assert 'class="elite"' not in html
    assert "\u2014" not in html and "\u2013" not in html
    assert '<html lang="en" dir="ltr"' in html


def test_pdf_elite_card_keeps_the_elite_score_and_notebook_link_without_the_panel(docs, captured_html, monkeypatch):
    elite = make_uc("N01-U01", "Sales", elite_status="ELITE", elite_score=8.7, quality_mode="Ultra High",
                    elite_assessment=elite_assessment())
    other = make_uc("N01-U02", "Sales", quality_mode="Ultra High")
    cls = docs["DatabricksInspire"]
    monkeypatch.setattr(cls, "_get_use_case_notebook_url", lambda self, uc: "https://h/editor/notebooks/7" if uc["No"] == "N01-U01" else "")
    _, html = pdf_html(docs, captured_html, {"Sales": [elite, other]}, summary())
    card = section(html, 'id="uc-N01-U01"', "</article>")
    for text in ('>8.7 / 10</div><div class="l">Elite Score<', 'href="https://h/editor/notebooks/7"', "Open the Genie notebook"):
        assert text in card, text
    for text in ("Why this use case qualifies", "Decision Owner", "Regional supply planner", "Stock-out rate", "Red-Team Note",
                 "Evidence strength", "Join Path", 'class="elite"', 'class="uc long"'):
        assert text not in html, text
    assert card.index('class="btn"') > card.index('<div class="main">') and card.rstrip().endswith("</div></div>")
    assert "Used in Ultra High mode" in html


def test_arabic_pdf_is_rtl_with_isolated_dates_and_page_numbers(docs, captured_html):
    grouped = portfolio()
    grouped["Sales"][0].update({"Strategic Goals Alignment": "Reduce Cost (waste)", "Beneficiary": "مدير المتجر"})
    summary_dict = dict(summary(), Executive="<p>Exec one.</p><p>ملخص تنفيذي للأعمال.</p><p>Databricks Genie Code يحلل بيانات المبيعات اليومية.</p>")
    _, html = pdf_html(docs, captured_html, grouped, summary_dict, language="Arabic")
    assert '<html lang="ar" dir="rtl" class="rtl nocaps"' in html
    assert f'<p class="first" dir="ltr">{SALES_PROSE}</p>' in html and '<p class="" dir="ltr">Exec one.</p>' in html
    assert '<p class="first">\u2066' + '7\u2069 من \u2066' + '8\u2069 حالة استخدام' in html
    assert '<p class="">ملخص تنفيذي للأعمال.</p>' in html and '<p class="">\u2066Databricks Genie Code\u2069 يحلل بيانات المبيعات اليومية.</p>' in html
    card = section(html, 'id="uc-N01-U01"', "</article>")
    assert '<td><span dir="ltr">Reduce Cost (waste)</span></td>' in card and "<td>مدير المتجر</td>" in card
    assert '<span dir="ltr">Sales</span></h2>' in html
    assert not re.search(r'<span dir="ltr">[\d.,]+</span>', html)
    assert re.search(r'<span dir="ltr">\d{4}-\d{2}-\d{2}</span>', html)
    assert '"\\200E " counter(page) " / " counter(pages) "\\200E "' in html
    assert "@bottom-left { content: \"\\200E \"" in html
    assert "linear-gradient(270deg" in html and "transform: scaleX(-1)" in html
    _, html_en = pdf_html(docs, captured_html, portfolio(), summary())
    assert "200E" not in html_en and "linear-gradient(270deg" not in html_en


def test_arabic_deck_is_right_to_left_mirrored_and_tagged(docs):
    from pptx.oxml.ns import qn
    _, prs = deck(docs, portfolio(), summary(), language="Arabic")
    paragraphs = [p for slide in prs.slides for shape in slide.shapes if shape.has_text_frame for p in shape.text_frame.paragraphs if p.runs]
    assert paragraphs and all(p._p.pPr is not None and p._p.pPr.get("rtl") in ("0", "1") for p in paragraphs)
    english_prose = [p for p in paragraphs if p.text.startswith(SALES_PROSE[:40])]
    arabic_labels = [p for p in paragraphs if p.text == "نبذة عن هذا المجال"]
    assert english_prose and all(p._p.pPr.get("rtl") == "0" for p in english_prose)
    assert arabic_labels and all(p._p.pPr.get("rtl") == "1" for p in arabic_labels)
    short_english = [p for p in paragraphs if p.text == "Exec one."]
    assert short_english and all(p._p.pPr.get("rtl") == "0" for p in short_english)
    joined = [p for p in paragraphs if p.text.startswith("\u2066Sales idea 6\u2069 باستخدام ")]
    assert joined and all(p._p.pPr.get("rtl") == "1" for p in joined), "an English name joined by the Arabic word reads right to left, the name isolated"
    covers = labels(docs, "Arabic")["doc_what_it_covers"]
    heading = [p for p in paragraphs if p.text == covers]
    assert heading and all(p._p.pPr.get("rtl") == "1" for p in heading)
    chips = [p for p in paragraphs if p.text in ("Promotion 3", "Pricing 3")]
    assert len(chips) >= 2 and all(p._p.pPr.get("rtl") == "0" for p in chips)
    runs = [r for p in paragraphs for r in p.runs]
    assert all(r._r.rPr.get("lang") == "ar-SA" for r in runs)
    assert all(r._r.rPr.find(qn("a:cs")) is not None and r._r.rPr.find(qn("a:cs")).get("typeface") == "Arial" for r in runs)
    from pptx.util import Inches
    kicker = next(s for s in prs.slides[0].shapes if s.has_text_frame and "\u200e" in s.text_frame.text)
    assert abs(kicker.left - Inches(13.333 - 0.75 - 8.6)) < Inches(0.02)
    assert re.search("\u200e\\d{4}-\\d{2}-\\d{2}\u200e", kicker.text_frame.text)
    _, english = deck(docs, portfolio(), summary())
    english_kicker = next(s for s in english.slides[0].shapes if s.has_text_frame and "AI USE CASE CATALOG" in s.text_frame.text)
    assert abs(english_kicker.left - Inches(0.75)) < Inches(0.02) and "\u200e" not in english_kicker.text_frame.text


def test_japanese_deck_uses_east_asian_fonts_and_a_valid_run_property_order(docs):
    from pptx.oxml.ns import qn
    _, prs = deck(docs, portfolio(), summary(), language="Japanese")
    order = [qn(tag) for tag in ("a:ln", "a:noFill", "a:solidFill", "a:gradFill", "a:effectLst", "a:highlight", "a:latin", "a:ea", "a:cs",
                                 "a:sym", "a:hlinkClick", "a:hlinkMouseOver", "a:rtl", "a:extLst")]
    for slide in prs.slides:
        for shape in slide.shapes:
            if not shape.has_text_frame:
                continue
            for paragraph in shape.text_frame.paragraphs:
                for run in paragraph.runs:
                    props = run._r.rPr
                    assert props.get("lang") == "ja-JP"
                    assert props.find(qn("a:ea")).get("typeface") == "Yu Gothic"
                    positions = [order.index(child.tag) for child in props]
                    assert positions == sorted(positions), [child.tag for child in props]
    assert prs.slide_width > prs.slide_height


@pytest.mark.parametrize("domains,per_domain,mode", [(1, 1, "Good"), (2, 5, "Good"), (11, 4, "Good"), (25, 2, "High"), (4, 3, "Ultra High")])
def test_no_two_consecutive_slides_share_a_layout(docs, domains, per_domain, mode):
    grouped = {}
    for d in range(domains):
        for u in range(per_domain):
            extra = {}
            if mode == "Ultra High" and u < 2:
                extra = dict(elite_status="ELITE", elite_score=8.5, elite_assessment=elite_assessment())
            uc = make_uc(f"N{d + 1:02d}-U{u + 1:02d}", f"Domain {d + 1}", quality_mode=mode, **extra, **{"Inspire Score": 9.0 - u * 0.1 - d * 0.01})
            grouped.setdefault(f"Domain {d + 1}", []).append(uc)
    obj, prs = deck(docs, grouped, {"Executive": "<p>" + "A long executive paragraph. " * 60 + "</p>" * 1})
    archetypes = [a.strip("' ") for a in archetypes_logged(obj).strip("[]").split(",")]
    assert len(archetypes) == len(prs.slides)
    series = set(docs["DatabricksInspire"]._DOC_PPTX_SERIES)
    assert series == {"domain", "uc_card", "index"}
    assert all(a != b or a in series for a, b in zip(archetypes, archetypes[1:])), archetypes
    assert archetypes[:6] == ["cover", "contents", "summary", "guide", "portfolio", "top_index"] or \
        archetypes[:7] == ["cover", "contents", "summary", "summary_more", "guide", "portfolio", "top_index"], archetypes
    assert archetypes[-5:] == ["methodology", "glossary", "roadmap", "disclaimer", "closing"]
    assert archetypes.count("domain") == domains and archetypes.count("index") >= 1
    assert not obj.logger.matching("[DOCS-PPTX layout-repeat]")
    assert "uc_card_elite" not in archetypes
    if mode == "Ultra High":
        assert archetypes.count("uc_card") == domains * per_domain


def test_every_run_is_at_least_12pt_and_text_stays_on_the_slide(docs):
    grouped = portfolio()
    grouped["Sales"][0]["Statement"] = "Donaudampfschifffahrtsgesellschaftskapitänsmützenabzeichen " * 12
    grouped["Sales"][5]["Business Value"] = "価値" * 400
    _, prs = deck(docs, grouped, {"Executive": "<p>" + "Sentence that keeps going. " * 120 + "</p>"})
    width, height = prs.slide_width, prs.slide_height
    for index, slide in enumerate(prs.slides, start=1):
        for shape in slide.shapes:
            if not shape.has_text_frame or not shape.text_frame.text.strip():
                continue
            assert shape.left >= 0 and shape.top >= 0, (index, shape.text_frame.text[:40])
            assert shape.left + shape.width <= width + 10 and shape.top + shape.height <= height + 10, (index, shape.text_frame.text[:40])
            for paragraph in shape.text_frame.paragraphs:
                for run in paragraph.runs:
                    assert run.font.size is not None and run.font.size.pt >= 12, (index, run.text[:40])


def test_text_fitting_shrinks_then_trims_and_never_overflows(docs):
    pytest.importorskip("pptx")
    cls = docs["DatabricksInspire"]
    obj = make_inspire(docs)
    model = obj._document_model("English", labels(docs), {}, portfolio(), "Acme")
    box = cls._Deck(obj, model, labels(docs))
    short = ["One short sentence."]
    assert box.fit(short, 6.0, 1.0, 20, 12) == (20, short)
    long_text = ["Every metric moves when the planner acts on the forecast. " * 30]
    size, kept = box.fit(long_text, 6.0, 1.5, 20, 12)
    assert size == 12 and kept[0] != long_text[0] and box.height(kept, 6.0, 12) <= 1.5
    german = ["Donaudampfschifffahrtsgesellschaftskapitänsmützenabzeichen" * 3]
    assert box.line_count(german[0], 2.0, 12) > 3
    cjk = ["データブリックスのジーニーコードで構築します。" * 20]
    size, kept = box.fit(cjk, 4.0, 1.0, 14, 12)
    assert box.height(kept, 4.0, size) <= 1.0 + 1e-6 and kept[0].endswith(("。", "…"))
    assert box.trim("First sentence. Second sentence.") == "First sentence."


def test_fonts_come_from_the_assets_once_and_fall_back_to_local_when_the_assets_lack_them(docs, monkeypatch, tmp_path):
    from v177_assets_support import make_assets
    cls = docs["DatabricksInspire"]
    font = b"\x00\x01\x00\x00" + b"\0" * 4096
    fonts = [{"kind": "font", "name": family, "version": "v1", "weight": weight, "data": font}
             for family, weights in (("Inter", (400, 600, 700)), ("Noto Sans Arabic", (400, 700))) for weight in weights]
    root = tmp_path / "assets"
    obj = make_inspire(docs)
    obj._assets = make_assets(docs, root, fonts)
    read = []
    original = obj._assets.path
    obj._assets.path = lambda entry: read.append(entry["file"]) or original(entry)
    faces, body, display, missing, fallbacks = obj._doc_font_css("Arabic", ["arabic"])
    assert missing == [] and fallbacks == [] and body.startswith("'Inter', 'Noto Sans Arabic'") and "Fraunces" not in display
    assert re.search(rf"src: url\('file://{re.escape(str(root))}/fonts/noto-sans-arabic-400\.ttf'\) format\('truetype'\), "
                     r"local\('Noto Sans Arabic'\)", faces)
    looked = len(read)
    obj._doc_font_css("Arabic", ["arabic"])
    assert looked == 5 and len(read) == looked, "each font file is checked once per process"
    monkeypatch.setattr(cls, "_DOC_FONT_FILES", {})
    monkeypatch.setattr(cls, "_doc_installed_fonts", lambda self: {}, raising=False)
    faces, body, display, missing, fallbacks = obj._doc_font_css("Japanese", obj._doc_scripts("Japanese", ["テスト"]))
    assert "src: local('Noto Sans JP')" in faces and "Noto Sans JP" in missing
    warned = obj.logger.matching("[DOCS-FONTS] Noto Sans JP:", level="WARNING")
    assert warned and "manifest.json lists no Noto Sans JP 400" in warned[0][1] and "Install step:" in warned[0][1]
    assert obj._doc_scripts("English", ["مرحبا", "plain"]) == ["arabic"]
    assert obj._doc_font_keys("Japanese", ["kana", "han"]) == ["latin", "kana"]
    assert obj._doc_font_keys("Chinese (Mandarin)", ["han"]) == ["latin", "han"]


def test_real_weasyprint_renders_arabic_and_japanese_catalogs(docs, tmp_path):
    pytest.importorskip("weasyprint")
    import shutil
    import subprocess
    for language in ("Arabic", "Japanese"):
        obj = make_inspire(docs)
        obj.generate_catalog_pdf(language, "xx", labels(docs, language), summary(), portfolio(), "Acme")
        data = next(iter(obj.w_client.workspace.files.values()))
        assert data.startswith(b"%PDF"), language
        assert obj.logger.matching(f"[DOCS-PDF] {language}: 8 use cases, 2 domain pages")
        if shutil.which("pdfinfo"):
            path = tmp_path / f"{language}.pdf"
            path.write_bytes(data)
            pages = int(re.search(r"Pages:\s+(\d+)", subprocess.run(["pdfinfo", str(path)], capture_output=True, text=True).stdout).group(1))
            assert pages >= 8, (language, pages)


def test_notebook_link_uses_the_recorded_path_so_translated_use_cases_still_link(docs):
    obj = make_inspire(docs)
    statuses = {"/Users/me/out/notebooks/sales/n01-u01-x": 41, "/Users/me/out/notebooks/ops/n02-u01-y.ipynb": 42}
    calls = []

    def get_status(path):
        calls.append(path)
        return types.SimpleNamespace(path=path, object_id=statuses.get(path))
    obj.w_client.workspace.get_status = get_status
    obj.w_client.config.host = "https://h.example"
    translated = make_uc("N01-U01", "المبيعات", Name="اسم مترجم", notebook_path="/Workspace/Users/me/out/notebooks/sales/n01-u01-x")
    assert obj._get_use_case_notebook_url(translated) == "https://h.example/editor/notebooks/41"
    assert calls == ["/Workspace/Users/me/out/notebooks/sales/n01-u01-x", "/Workspace/Users/me/out/notebooks/sales/n01-u01-x.ipynb",
                     "/Users/me/out/notebooks/sales/n01-u01-x"]
    calls.clear()
    assert obj._get_use_case_notebook_url(translated) == "https://h.example/editor/notebooks/41" and calls == []
    assert obj._get_use_case_notebook_url(make_uc("N02-U01", "Ops", notebook_path="/Users/me/out/notebooks/ops/n02-u01-y")).endswith("/42")
    calls.clear()
    assert obj._get_use_case_notebook_url(make_uc("N03-U01", "Ops", Name="Nothing")) == ""
    assert calls == ["/Workspace/out/notebooks/ops/planning/N03-U01 - nothing", "/Workspace/out/notebooks/ops/planning/N03-U01 - nothing.ipynb"]


def test_every_registered_analytics_technique_has_a_label_in_all_languages(docs):
    ts, cls = docs["TranslationService"], docs["DatabricksInspire"]
    registry = list(docs["TECHNIQUE_IMPLEMENTATION_GUIDANCE"])
    missing = [name for name in registry if name not in cls._TECHNIQUE_VALUE_KEYS]
    assert not missing, missing
    for name, key in cls._TECHNIQUE_VALUE_KEYS.items():
        assert ts.ENGLISH_TRANSLATIONS.get(key) == name, name
        for language in LANGUAGES[1:]:
            assert str(ts.TRANSLATION_FALLBACKS[language].get(key) or "").strip(), (language, key)
    obj = make_inspire(docs)
    assert obj._translate_technique_value("Geospatial Analysis", labels(docs, "Japanese"), "Japanese") == "地理空間分析"
    assert obj._translate_technique_value("Pareto Analysis", labels(docs, "Arabic"), "Arabic") == "تحليل باريتو"


def test_untranslated_notice_lists_only_fields_that_really_show_in_english(docs):
    obj = make_inspire(docs)
    t = labels(docs, "Japanese")
    label_only = make_uc("N01-U01", type="Opportunity", _translation_status="partial", _untranslated_fields=["type"],
                         **{"Business Priority Alignment": "Increase Revenue, Reduce Cost"})
    label_only["_untranslated_fields"].append("Business Priority Alignment")
    assert obj._untranslated_notice(label_only, t, "Japanese") == ""
    free_text = make_uc("N01-U02", type="Opportunity", _translation_status="partial", _untranslated_fields=["type", "Statement"])
    assert obj._untranslated_notice(free_text, t, "Japanese") == f'{t["untranslated_notice"]}: {t["statement"]}'
    odd_type = make_uc("N01-U03", type="Opportunity and Risk", _translation_status="partial", _untranslated_fields=["type"])
    assert obj._untranslated_notice(odd_type, t, "Japanese").endswith(": タイプ")
    assert obj._untranslated_notice(free_text, labels(docs), "English") == ""


def test_legacy_json_catalog_doubled_apostrophes_are_cleaned_once_at_the_loader(docs, captured_html):
    obj = make_inspire(docs)
    payload = {"title": "Bakehouse''s catalog", "executive_summary": "<p>Bakehouse''s network grows.</p>",
               "domains": [{"domain_name": "Sales", "summary": "<p>Sales covers Bakehouse''s pricing.</p>",
                            "use_cases": [{"No": "N01-U01", "Name": "Grow each store''s basket",
                                           "Statement": "A product''s daily sales drop unnoticed.", "count": 3,
                                           "elite_assessment": {"decision": "Set each store''s weekly order"},
                                           "Tables Involved": ["main.s.o''brien"]}]}]}
    assert obj._clean_legacy_catalog_text(payload) == 5
    uc = payload["domains"][0]["use_cases"][0]
    assert payload["executive_summary"] == "<p>Bakehouse's network grows.</p>"
    assert payload["domains"][0]["summary"] == "<p>Sales covers Bakehouse's pricing.</p>" and uc["Name"] == "Grow each store's basket"
    assert uc["Statement"] == "A product's daily sales drop unnoticed." and uc["elite_assessment"]["decision"] == "Set each store's weekly order"
    assert uc["Tables Involved"] == ["main.s.o''brien"] and uc["count"] == 3 and payload["title"] == "Bakehouse''s catalog"
    assert obj.logger.matching("[DOCS-LEGACY-QUOTES] the JSON catalog carries 5", level="WARNING")
    assert obj._clean_legacy_catalog_text({"executive_summary": "plain", "domains": [None, {"use_cases": [None]}]}) == 0
    from _agentload import method_node
    import ast
    loader = method_node("DatabricksInspire", "_load_usecases_catalog_json")
    assert any(isinstance(n, ast.Attribute) and n.attr == "_clean_legacy_catalog_text" for n in ast.walk(loader))
    grouped = {"Sales": [make_uc("N01-U01", "Sales", Statement=uc["Statement"])]}
    _, html = pdf_html(docs, captured_html, grouped, {"Executive": payload["executive_summary"]})
    assert "&#x27;&#x27;" not in html and "A product&#x27;s daily sales drop unnoticed." in html


def test_documents_render_text_verbatim_with_no_boundary_quote_rewrite(docs, captured_html):
    uc = make_uc("N01-U01", "Sales", Statement="Say ''hello'' twice.")
    _, html = pdf_html(docs, captured_html, {"Sales": [uc]}, {"Executive": "<p>Keep ''this''.</p>"})
    assert "Say &#x27;&#x27;hello&#x27;&#x27; twice." in html and "Keep &#x27;&#x27;this&#x27;&#x27;." in html
    from _agentload import agent_source
    assert "def _doc_clean(" not in agent_source()


def test_notebook_button_sits_in_the_card_foot_only_when_a_notebook_exists(docs, captured_html, monkeypatch):
    cls = docs["DatabricksInspire"]
    monkeypatch.setattr(cls, "_get_use_case_notebook_url", lambda self, uc: "https://h/editor/notebooks/9" if uc["No"] != "N01-U02" else "")
    grouped = {"Sales": [make_uc("N01-U01", "Sales", **{"Inspire Score": 9.0}),
                         make_uc("N01-U02", "Sales", **{"Inspire Score": 8.0}),
                         make_uc("N01-U03", "Sales", **{"Inspire Score": 7.0, "Tables Involved": ""})]}
    _, html = pdf_html(docs, captured_html, grouped, summary())
    linked = section(html, 'id="uc-N01-U01"', "</article>")
    assert '<div class="foot"><a class="btn" href="https://h/editor/notebooks/9">Open the Genie notebook' in linked
    assert '<td class="k">Tables Involved</td><td>main.s.sales</td>' in linked
    unlinked = section(html, 'id="uc-N01-U02"', "</article>")
    assert 'class="foot"' not in unlinked and 'class="btn"' not in unlinked
    bare = section(html, 'id="uc-N01-U03"', "</article>")
    assert '<td class="k">Tables Involved</td><td>Not provided</td>' in bare and 'class="btn"' in bare


@pytest.mark.parametrize("count, rows", [(13, [7, 6]), (49, [10, 10, 10, 10, 9]), (12, [12])])
def test_deck_index_pages_share_the_rows_evenly(docs, count, rows):
    grouped = {"Sales": [make_uc(f"N01-U{i:02d}", "Sales", **{"Inspire Score": 9.0 - i * 0.1}) for i in range(1, count + 1)]}
    _, prs = deck(docs, grouped, summary())
    index_slides = [text for text in slide_texts(prs) if text.startswith("APPENDIX | Use case index")]
    assert [len(set(re.findall(r"N01-U\d\d", text))) for text in index_slides] == rows


COUNTED_LABELS = {"doc_domain_fallback": ("count",), "doc_data_access_deep": ("tables",), "doc_index_lead": ("count",),
                  "doc_deck_scope": ("count", "total"), "doc_deck_scope_all": ("total",)}
NUMBER_DEPENDENT_WORDS = {
    "English": ("use case", "table"), "Arabic": ("حالات", "حالة", "جداول", "جدول"), "Spanish": ("casos", "tablas", "mejores"),
    "French": ("cas", "tables", "meilleurs"), "German": ("Anwendungsf", "Tabellen", "besten"),
    "Portuguese": ("casos", "tabelas", "melhores"), "Italian": ("casi", "tabelle"), "Hindi": ("उपयोग", "टेबल"),
    "Russian": ("сценари", "бизнес-кейс", "таблиц", "лучших"), "Swedish": ("tabell", "främsta"),
    "Danish": ("use case", "anvendelsescases", "tabeller", "bedste"), "Norwegian": ("brukscaser", "brukstilfeller", "tabeller", "beste"),
    "Finnish": ("käyttötapau", "taulu", "parasta"), "Polish": ("przypadk", "tabel", "najlepszych"), "Romanian": ("cazuri", "tabele"),
    "Ukrainian": ("сценарі", "бізнес-кейс", "таблиц", "найкращих"), "Dutch": ("use case", "gebruikscases", "tabellen", "beste"),
    "Tamil": ("பயன்பாட்டு", "அட்டவணை"),
}


def test_a_counted_label_never_puts_its_number_before_a_word_whose_form_depends_on_it(docs):
    for language, words in NUMBER_DEPENDENT_WORDS.items():
        table = labels(docs, language)
        for key, names in COUNTED_LABELS.items():
            for name in names:
                after = table[key].split("{" + name + "}", 1)[1].lstrip().lower()
                assert not after.startswith(tuple(w.lower() for w in words)), \
                    f"{language} {key}: '{table[key]}' reads '1 use cases' or '22 сценариев' for some counts"
    obj = make_inspire(docs)
    one = obj._doc_text({}, "doc_domain_fallback", "English", count=1, subdomains="Pricing")
    assert one.startswith("This domain brings together use cases across Pricing, 1 in total.") and "1 use cases" not in one
    assert obj._doc_text({}, "doc_data_access_deep", "English", tables=1).startswith(
        "Deep discovery: Inspire read aggregates from the tables in scope, 1 in total (row counts")
    assert obj._doc_text({}, "doc_index_lead", "English", count=1) == "All use cases in final rank order, 1 in total."
    assert obj._doc_text({}, "doc_deck_scope", "Russian", count=22, total=95) == (
        "В этой презентации подробно описаны сценарии использования с наивысшим рейтингом (22 из 95). В PDF-каталоге описаны все.")
    assert obj._doc_text({}, "doc_deck_scope_all", "English", total=1) == "This presentation details every use case, 1 in total, one card each."
