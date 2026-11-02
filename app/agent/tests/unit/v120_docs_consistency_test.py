"""v1.2.0 DOCS-CONSISTENCY lane: one use-case view, one index, one brand, one disclaimer.

Owner finding: the PDF and the PPTX showed the same use case and the same index in different ways, dropped
business fields (sponsor, beneficiary, alignments) on some surfaces, under-weighted the Inspire AI brand and
had no disclaimer page in the deck. Root cause: every writer read the raw use-case dict with its own field list,
labels and sort, so the surfaces drifted. Covered here: `_use_case_view` drives the PDF card, the deck card, the
Markdown entry and the export column order with identical labels and order; one index header and final-rank
order in both formats; a single renderer per card and per index; brand tokens defined once; the disclaimer in
all formats and all 23 languages; technique and cadence labels; translation-gap accounting for label-rendered
fields; per-language cancellation; no backticks; local font fallback reported loudly; no deck box trims translated
text in any language, with one deck structure per language.
"""
import ast
import html as html_lib
import re
import threading
import time
import types

import pytest

from v120_artifacts_support import elite_assessment, make_inspire, make_uc
from v120_docs_design_test import (LANGUAGES, archetypes_logged, captured_html, deck, docs, labels, pdf_html, portfolio, section,
                                   slide_texts, summary)


def ultra_portfolio():
    sales = [make_uc("N01-U01", "Sales", Name="Elite pick", quality_mode="Ultra High", elite_status="ELITE", elite_score=8.7,
                     bob_score=8.4, Value=4.2, Feasibility=3.8, elite_assessment=elite_assessment(),
                     **{"Business Priority Alignment": "Increase Revenue", "Strategic Goals Alignment": "Reduce Cost",
                        "Inspire Score": 9.1}),
             make_uc("N01-U02", "Sales", Name="Second", quality_mode="Ultra High", elite_status="ELITE", elite_score=8.2,
                     elite_assessment=elite_assessment(cadence="monthly"), **{"Inspire Score": 8.0})]
    ops = [make_uc("N02-U01", "Operations", Name="Ops pick", quality_mode="Ultra High", elite_status="DOMAIN_COVERAGE_PICK",
                   coverage_pick_reason="Domain coverage pick, below bar: quality 'Medium' is below the High bar",
                   **{"Inspire Score": 6.0, "Sponsor": ""})]
    return {"Sales": sales, "Operations": ops}


def expected_views(obj, ns, grouped, language="English"):
    t = labels(ns, language)
    model = obj._document_model(language, t, summary(), grouped, "Acme")
    return model, [obj._use_case_view(uc, model, t) for uc in model["ranked"]]


def view_labels(view):
    return [label for _key, label, _value in view["metrics"] + view["narrative"] + view["facts"]]


def view_values(view):
    return [value for _key, _label, value in view["metrics"] + view["narrative"] + view["facts"]]


def in_order(text, needles):
    cursor = 0
    for needle in needles:
        found = text.find(needle, cursor)
        if found < 0:
            return needle
        cursor = found + len(needle)
    return None


def test_one_view_drives_the_pdf_card_the_deck_card_and_the_markdown_entry(docs, captured_html):
    grouped = ultra_portfolio()
    obj, page = pdf_html(docs, captured_html, grouped, summary())
    model, views = expected_views(make_inspire(docs), docs, grouped)
    _, prs = deck(docs, grouped, summary())
    slides = slide_texts(prs)
    md_obj = make_inspire(docs)
    md_obj._generate_markdown_catalog("English", "en", grouped, summary(), "Acme")
    md = next(iter(md_obj.w_client.workspace.files.values())).decode("utf-8")
    assert [v["id"] for v in views] == ["N01-U01", "N01-U02", "N02-U01"]
    for view in views:
        card = section(page, f'id="uc-{view["id"]}"', "</article>")
        assert in_order(card, [f">{html_lib.escape(label)}<" for label in view_labels(view)]) is None, view["id"]
        assert all(html_lib.escape(value) in card for value in view_values(view)), view["id"]
        card_slides = [s for s in slides if f'| {view["rank"]} | {view["id"]} · ' in s]
        assert len(card_slides) == 1, view["id"]
        deck_text = card_slides[0]
        deck_needles = []
        for key, label, value in view["metrics"]:
            deck_needles += [value, label]
        if view["coverage"]:
            deck_needles += [f"{view['coverage'][0]}. {view['coverage'][1]}: {view['coverage'][2]}"]
        if deck_text:
            deck_needles += [label.upper() for _key, label, _value in view["narrative"]]
            deck_needles += [f"{label}: {value}" for _key, label, value in view["facts"]]
            assert in_order(deck_text, deck_needles) is None, (view["id"], in_order(deck_text, deck_needles))
        entry = md[md.index(f'#### #{view["rank"]} '):]
        entry = entry[:entry.index("\n---\n")]
        assert view["id"] in entry.splitlines()[0]
        assert in_order(entry, [f"**{label}:**" for label in view_labels(view)]) is None, view["id"]
        assert all(value in entry for value in view_values(view)), view["id"]
    sponsor = dict((key, value) for key, _label, value in views[2]["facts"])
    assert sponsor["sponsor"] == "Not provided"
    for business in ("Sponsor", "Beneficiary", "Business Priority Alignment", "Strategic Goals Alignment", "Analytics Technique",
                     "Tables Involved", "Statement", "Solution", "Business Value", "Quality Score", "Inspire Score",
                     "Best-of-Best Score", "Priority", "Value", "Feasibility"):
        assert business in view_labels(views[0]), business
    assert set(views[0]) == {"uc", "id", "rank", "title", "name", "domain", "subdomain", "kind", "quality", "metrics", "narrative",
                             "facts", "value_facts", "coverage", "notice", "untranslated", "star"}
    assert all(view["star"] is None for view in views), "a use case without the Best of Best mark has no star"
    assert all(view["value_facts"] == [] for view in views), "a catalog without v1.3.0 fields has no value facts"
    assert views[0]["kind"] == "elite" and "Elite Score" in view_labels(views[0])
    panel = [obj._doc_text({}, key) for key, _source in docs["DatabricksInspire"]._USE_CASE_VIEW_ELITE] + ["Red-Team Note", "Why this use case qualifies"]
    elite_card = section(page, 'id="uc-N01-U01"', "</article>")
    elite_slides = " | ".join(slides)
    elite_entry = md[md.index("#### #1 "):]
    for label in panel:
        assert f">{label}<" not in elite_card and label.upper() not in elite_slides and f"**{label}:**" not in elite_entry, label
    assert views[2]["coverage"][0] == "Domain coverage pick, below the bar"
    assert "Domain coverage pick, below bar: quality &#x27;Medium&#x27;" in section(page, 'id="uc-N02-U01"', "</article>")


def test_internal_flags_never_reach_a_card(docs, captured_html):
    cls = docs["DatabricksInspire"]
    uc = make_uc("N01-U01", "Sales", **{field: f"SECRET-{i}" for i, field in enumerate(cls._USE_CASE_VIEW_EXCLUDED)
                                       if field not in ("elite_status", "quality_mode")})
    _, page = pdf_html(docs, captured_html, {"Sales": [uc]}, summary())
    card = section(page, 'id="uc-N01-U01"', "</article>")
    assert "SECRET-" not in card
    _, prs = deck(docs, {"Sales": [uc]}, summary())
    assert "SECRET-" not in " | ".join(slide_texts(prs))
    view_fields = {source for _key, source in cls._USE_CASE_VIEW_TEXT} | {source for _key, source, _kind in cls._USE_CASE_VIEW_FACTS}
    view_fields |= {source for _key, source, _scale in cls._USE_CASE_VIEW_SCORES}
    assert not view_fields & set(cls._USE_CASE_VIEW_EXCLUDED)


def test_one_index_design_with_identical_columns_and_final_rank_order(docs, captured_html):
    grouped = ultra_portfolio()
    grouped["Sales"] += [make_uc(f"N01-U0{i}", "Sales", quality_mode="Ultra High", **{"Inspire Score": 5.0 + i * 0.1}) for i in range(3, 7)]
    obj = make_inspire(docs)
    t = labels(docs)
    model = obj._document_model("English", t, summary(), grouped, "Acme")
    expected_header = [label for _key, label, _width in obj._doc_index_header(model, t)]
    assert expected_header == ["Rank", "ID", "Use Case", "Business Domain", "Quality", "Inspire Score"]
    expected_ids = [str(uc["No"]) for uc in sorted(model["ranked"], key=obj._final_rank_key)]
    _, page = pdf_html(docs, captured_html, grouped, summary())
    full = section(page, 'id="sec-index"', "</section>")
    assert re.findall(r"<th>([^<]+)</th>", full) == expected_header
    assert re.findall(r'class="ix-id">(?:<a [^>]*>)?(N0\d-U0\d)', full) == expected_ids
    assert re.findall(r'class="ix-rank">(\d+)<', full) == [str(i) for i in range(1, len(expected_ids) + 1)]
    _, prs = deck(docs, grouped, summary())
    index = next(s for s in slide_texts(prs) if s.startswith("APPENDIX | Use case index"))
    assert " | ".join(expected_header) in index
    assert re.findall(r"\| (N0\d-U0\d) \|", index) == expected_ids
    assert "| N02-U01 | Coverage pick · Forecast Demand N02-u01 |" in index
    assert '<span class="ixflag">Coverage pick</span> <a href="#uc-N02-U01">' in full


def _callers(tree, name):
    found = set()
    for cls_node in ast.walk(tree):
        if not isinstance(cls_node, ast.ClassDef):
            continue
        for fn in cls_node.body:
            if isinstance(fn, ast.FunctionDef):
                for node in ast.walk(fn):
                    if isinstance(node, ast.Attribute) and node.attr == name:
                        found.add(fn.name)
    return found


def test_a_single_code_path_renders_cards_and_indexes(agent_ns):
    from _agentload import agent_source
    source = agent_source()
    tree = ast.parse(source)
    assert _callers(tree, "_doc_index_header") == {"_pdf_index_table", "_deck_index_table"}
    assert _callers(tree, "_doc_index_rows") == {"_catalog_pdf_html", "_pdf_domain_opener", "_deck_top_index", "_deck_domain", "_deck_index"}
    assert _callers(tree, "_pdf_index_table") == {"_catalog_pdf_html", "_pdf_domain_opener"}
    assert _callers(tree, "_deck_index_table") == {"_deck_top_index", "_deck_domain", "_deck_index"}
    assert _callers(tree, "_use_case_view") == {"_catalog_pdf_html", "_build_presentation_deck", "_generate_markdown_catalog"}
    assert _callers(tree, "_pdf_use_case_card") == {"_catalog_pdf_html"}
    assert _callers(tree, "_deck_use_case") == {"_build_presentation_deck"}
    assert source.count('<table class="index">') == 1
    cls = agent_ns["DatabricksInspire"]
    for gone in ("_deck_elite", "_deck_divider", "_deck_top_rows", "_deck_glance", "_deck_agenda", "_doc_score_text", "_doc_shorten",
                 "_EXPORT_BASE_HEADERS", "_ELITE_EXPORT_HEADERS", "_EXPORT_SCORE_FIELDS"):
        assert not hasattr(cls, gone), gone


def test_export_columns_follow_the_view_order(docs):
    obj = make_inspire(docs)
    header = [h for h, _getter, _numeric in obj._export_columns(True)]
    model, views = expected_views(obj, docs, ultra_portfolio())
    labels_in_view = [label for _key, label, _value in views[0]["metrics"] + views[0]["narrative"] + views[0]["facts"]]
    assert [header.index(label) for label in labels_in_view] == sorted(header.index(label) for label in labels_in_view)
    elite = [obj._doc_text({}, key) for key, _source in docs["DatabricksInspire"]._USE_CASE_VIEW_ELITE] + ["Red-Team Note", "Coverage Pick Reason"]
    assert [header.index(label) for label in elite] == sorted(header.index(label) for label in elite)
    row = {h: getter(ultra_portfolio()["Sales"][1], 2) for h, getter, _numeric in obj._export_columns(True)}
    assert row["Decision Cadence"] == "Monthly" and row["Rank"] == 2 and row["Sponsor"] == "COO"


def test_brand_tokens_are_defined_once_and_used_everywhere(docs, captured_html):
    from _agentload import agent_source
    cls = docs["DatabricksInspire"]
    source = agent_source()
    start = source.index("    _DOC_COLORS = {")
    block = source[source.index("    _DOC_BRAND = {", start):source.index("    _PYTHON_PACKAGE_LOCK = threading.Lock()")]
    assert not re.findall(r"""["'#][0-9A-Fa-f]{6}["';, )]""", block)
    assert not re.search(r"font-size:\s*\d", cls._PDF_CSS)
    deck_block = source[source.index("    class _Deck:"):source.index("    def _build_presentation_deck")]
    assert not re.search(r"\bsize=\d", deck_block)
    assert cls._DOC_BRAND["wordmark"] == "Databricks Inspire AI"
    assert set(cls._DOC_QUALITY_COLORS.values()) <= set(cls._DOC_COLORS)
    obj, page = pdf_html(docs, captured_html, ultra_portfolio(), summary())
    assert '<div class="runbrand"><span class="wordmark ' in page and "content: element(brand)" in page
    assert re.search(r'content: "Generated by Databricks Inspire AI v\d+\.\d+\.\d+ · \d{4}-\d{2}-\d{2}"', page)
    body = page[page.index("<body"):]
    assert body.count("Databricks <b>Inspire AI</b>") >= 4
    for name in ("teal", "coral", "gold", "sand"):
        assert f"#{cls._DOC_COLORS[name]}".lower() in page.lower()
    _, prs = deck(docs, ultra_portfolio(), summary())
    texts = slide_texts(prs)
    total = len(texts)
    for number, text in enumerate(texts, start=1):
        assert "Databricks Inspire AI" in text, number
        assert "Generated by Databricks Inspire AI v" in text, number
        if number > 1:
            assert text.endswith(f"{number} / {total}"), number
    fills = {shape.fill.fore_color.rgb for slide in prs.slides for shape in slide.shapes
             if shape.shape_type == 1 and shape.fill.type == 1}
    assert {str(color) for color in fills} <= set(cls._DOC_COLORS.values())


def test_deck_type_scale_is_the_shared_scale(docs):
    pytest.importorskip("pptx")
    cls = docs["DatabricksInspire"]
    obj = make_inspire(docs)
    model = obj._document_model("English", labels(docs), {}, ultra_portfolio(), "Acme")
    box = cls._Deck(obj, model, labels(docs))
    assert box.C is cls._DOC_COLORS
    assert box.S == {step: max(12.0, float(size)) for step, size in cls._DOC_TYPE_SCALE.items()}
    css = obj._pdf_css(model, "'Inter'", "'Fraunces'")
    assert f"font-size: {cls._DOC_TYPE_SCALE['body'] * cls._DOC_PDF_PX_PER_PT:.1f}px" in css


@pytest.mark.parametrize("language", ["English", "Arabic", "Japanese"])
def test_disclaimer_page_in_pdf_deck_and_markdown(docs, captured_html, language):
    t = labels(docs, language)
    obj = make_inspire(docs)
    model = obj._document_model(language, t, summary(), ultra_portfolio(), "Acme")
    title, paragraphs = obj._doc_disclaimer(model, t)
    assert len(paragraphs) == 4 and all(p.strip() for p in paragraphs)
    _, page = pdf_html(docs, captured_html, ultra_portfolio(), summary(), language=language)
    block = page[page.index('id="sec-disclaimer"'):]
    assert html_lib.escape(title) in page[page.index('id="sec-disclaimer"') - 400:page.index('id="sec-disclaimer"') + 400]
    assert all(html_lib.escape(p) in block for p in paragraphs)
    _, prs = deck(docs, ultra_portfolio(), summary(), language=language)
    texts = [s.replace("\u2066", "").replace("\u2069", "") for s in slide_texts(prs)]
    page_text = next(s for s in texts if title in s and paragraphs[1] in s)
    assert all(p in page_text for p in paragraphs) and texts.index(page_text) == len(texts) - 2


def test_disclaimer_states_metadata_only_ai_generated_and_no_guarantee_in_23_languages(docs):
    ts, cls = docs["TranslationService"], docs["DatabricksInspire"]
    english = [ts.ENGLISH_TRANSLATIONS[key] for key in cls._DOC_DISCLAIMER_KEYS]
    text = " ".join(english)
    for phrase in ("metadata only", "never reads row data", "generated by AI", "Validate", "No figure in this document is guaranteed"):
        assert phrase in text, phrase
    for language in LANGUAGES[1:]:
        table = ts.TRANSLATION_FALLBACKS[language]
        for key in cls._DOC_DISCLAIMER_KEYS + ("pdf_disclaimer_title",):
            assert str(table.get(key) or "").strip(), (language, key)
        assert table["doc_disclaimer_ai"] != ts.ENGLISH_TRANSLATIONS["doc_disclaimer_ai"], language
        assert table["doc_disclaimer_figures"] != ts.ENGLISH_TRANSLATIONS["doc_disclaimer_figures"], language


def test_new_view_labels_exist_in_all_23_languages(docs):
    ts, cls = docs["TranslationService"], docs["DatabricksInspire"]
    keys = {key for key, _source in cls._USE_CASE_VIEW_TEXT} | {key for key, _source, _kind in cls._USE_CASE_VIEW_FACTS}
    keys |= {key for key, _source, _scale in cls._USE_CASE_VIEW_SCORES} | {key for key, _source in cls._USE_CASE_VIEW_ELITE}
    keys |= {label for _key, label, _width in cls._DOC_INDEX_COLUMNS if label} | set(cls._DOC_CADENCE_KEYS.values())
    keys |= {"doc_not_provided", "doc_not_scored", "doc_generated_by", "doc_coverage_pick", "elite_red_team_note", "elite_reason"}
    assert ts.ENGLISH_TRANSLATIONS["doc_bob_score"] == "Best-of-Best Score" and ts.ENGLISH_TRANSLATIONS["doc_elite_score"] == "Elite Score"
    for language in LANGUAGES[1:]:
        absent = sorted(k for k in keys if not str(ts.TRANSLATION_FALLBACKS[language].get(k) or "").strip())
        assert not absent, (language, absent)


def test_fallback_labels_exist_and_format_the_mode_in_all_23_languages(docs):
    ts, obj = docs["TranslationService"], make_inspire(docs)
    mode_keys = ("elite_fallback_pick", "elite_fallback_near_miss", "doc_fallback_notice")
    for key in mode_keys:
        assert "{mode}" in ts.ENGLISH_TRANSLATIONS[key], key
    assert str(ts.ENGLISH_TRANSLATIONS["doc_fallback_pick"] or "").strip()
    for language in LANGUAGES:
        t = labels(docs, language)
        for key in mode_keys:
            rendered = obj._doc_text(t, key, language, mode="High")
            assert rendered.strip() and "{mode}" not in rendered and "High" in rendered, (language, key)
        assert obj._doc_text(t, "doc_fallback_pick", language).strip()
        if language != "English":
            for key in mode_keys + ("doc_fallback_pick",):
                assert str(ts.TRANSLATION_FALLBACKS[language].get(key) or "").strip(), (language, key)


def test_a_pure_fallback_set_carries_the_below_bar_label_notice_and_index_flag(docs, captured_html):
    tier = make_uc("N01-U01", "Sales", Name="Closest A", quality_mode="High", Quality="Medium",
                   elite_status="FALLBACK_BELOW_BAR", fallback_kind="tier", fallback_bar="High",
                   fallback_reason="quality 'Medium' is below the High bar", **{"Inspire Score": 6.2})
    tier2 = make_uc("N01-U02", "Sales", Name="Closest B", quality_mode="High", Quality="Medium",
                    elite_status="FALLBACK_BELOW_BAR", fallback_kind="tier", fallback_bar="High",
                    fallback_reason="quality 'Medium' is below the High bar", **{"Inspire Score": 5.9})
    grouped = {"Sales": [tier, tier2]}
    obj = make_inspire(docs)
    model, views = expected_views(obj, docs, grouped)
    for view in views:
        assert view["kind"] == "coverage" and view["coverage"][0] == "Below the High bar"
        assert view["coverage"][2] == "quality 'Medium' is below the High bar"
    rows = obj._doc_index_rows(model["ranked"], model, labels(docs, "English"))
    assert [row["flag"] for row in rows] == ["Below bar", "Below bar"]
    notice = obj._doc_text({}, "doc_fallback_notice", "English", mode="High")
    assert notice == model["executive"][0] and "No use case met the High bar" in notice
    _, page = pdf_html(docs, captured_html, grouped, summary())
    assert "Below the High bar" in page and "No use case met the High bar" in page


def test_an_ultra_high_near_miss_fallback_reads_near_miss_below_the_ultra_high_bar(docs):
    near = make_uc("N01-U01", "Sales", Name="Near miss", quality_mode="Ultra High", elite_status="FALLBACK_BELOW_BAR",
                   fallback_kind="near_miss", fallback_bar="Ultra High", fallback_reason="failed check: red_team",
                   elite_score=6.7, **{"Inspire Score": 6.7})
    obj = make_inspire(docs)
    model, views = expected_views(obj, docs, {"Sales": [near]})
    assert views[0]["coverage"][0] == "Near miss, below the Ultra High bar"
    assert views[0]["coverage"][2] == "failed check: red_team"
    assert obj._doc_text({}, "doc_fallback_notice", "English", mode="Ultra High") == model["executive"][0]


def test_missing_values_render_translated_not_provided_and_not_scored(docs, captured_html):
    uc = make_uc("N01-U01", "Sales", Sponsor="", Beneficiary="N/A", **{"Inspire Score": None})
    for language in ("Arabic", "Japanese"):
        t = labels(docs, language)
        _, page = pdf_html(docs, captured_html, {"Sales": [uc]}, summary(), language=language)
        card = section(page, 'id="uc-N01-U01"', "</article>")
        assert card.count(html_lib.escape(t["doc_not_provided"])) >= 2 and html_lib.escape(t["doc_not_scored"]) in card
        assert "Not provided" not in card and "Not scored" not in card and "N/A" not in card


def test_label_rendered_type_and_alignment_are_not_translation_gaps(agent_ns):
    ts = agent_ns["TranslationService"]
    service = ts.__new__(ts)
    original = make_uc("N01-U01", type="Opportunity", Statement="A long statement that clearly needs a translation.",
                       **{"Business Priority Alignment": "Increase Revenue, Reduce Cost", "Strategic Goals Alignment": "Reduce Cost"})
    row = {"Name": "名前", "Headline": "見出し", "Business Domain": "営業", "Subdomain": "計画", "type": "Opportunity",
           "Statement": "A long statement that clearly needs a translation.", "Solution": "解決", "Business Value": "価値",
           "Beneficiary": "担当", "Sponsor": "役員", "Business Priority Alignment": "Increase Revenue, Reduce Cost",
           "Strategic Goals Alignment": "Reduce Cost"}
    merged = service._merge_translation(original, row, "Japanese")
    assert merged["_untranslated_fields"] == ["Statement"]
    odd = dict(original, **{"Business Priority Alignment": "Grow Something Entirely Custom Here"})
    merged = service._merge_translation(odd, dict(row, **{"Business Priority Alignment": "Grow Something Entirely Custom Here"}), "Japanese")
    assert "Business Priority Alignment" in merged["_untranslated_fields"]


def test_registry_techniques_have_unique_labels_and_unknown_ones_are_flagged_and_recorded(docs, captured_html):
    ts, cls = docs["TranslationService"], docs["DatabricksInspire"]
    obj = make_inspire(docs)
    for language in LANGUAGES[1:]:
        t = labels(docs, language)
        shown = [obj._doc_technique_label(name, t, language)[0] for name in cls._TECHNIQUE_VALUE_KEYS]
        assert len(set(shown)) == len(shown), (language, [s for s in shown if shown.count(s) > 1])
        assert not any(obj._doc_technique_label(name, t, language)[1] for name in cls._TECHNIQUE_VALUE_KEYS), language
    t = labels(docs, "Arabic")
    assert obj._doc_technique_label("Prescriptive Analytics", t, "Arabic")[0] != obj._doc_technique_label("Descriptive Analytics", t, "Arabic")[0]
    assert obj._doc_technique_label("Quantum Basket Mining", t, "Arabic") == ("Quantum Basket Mining", True)
    assert obj._doc_technique_label("Quantum Basket Mining", labels(docs), "English") == ("Quantum Basket Mining", False)
    assert obj._doc_cadence_label("weekly") == "Weekly" and obj._doc_cadence_label("Bi-Weekly") == "Every two weeks"
    assert obj._doc_cadence_label("every full moon") == "every full moon"
    uc = make_uc("N01-U01", "Sales", **{"Analytics Technique": "Quantum Basket Mining"})
    obj, page = pdf_html(docs, captured_html, {"Sales": [uc]}, summary(), language="Arabic")
    card = section(page, 'id="uc-N01-U01"', "</article>")
    assert t["untranslated_notice"] in card and "Quantum Basket Mining" in card
    assert obj.translation_gaps["Arabic"]["labels_in_english"]
    assert "Quantum Basket Mining" in str(obj.translation_gaps["Arabic"]["labels_in_english"])
    assert obj.logger.matching("[DOCS-LABELS untranslated]")
    assert any("labels shown in English" in w for w in obj._run_outcome_warnings())
    assert obj.final_inspire_results_json["translation_gaps"]["Arabic"]["labels_in_english"]
    clean, _ = pdf_html(docs, captured_html, {"Sales": [make_uc("N01-U01", "Sales")]}, summary(), language="Arabic")
    assert not getattr(clean, "translation_gaps", None)


def test_a_slow_language_is_cancelled_alone_and_the_others_still_render(agent_ns, monkeypatch):
    ns = agent_ns
    original = ns["_safe_future_result"]
    monkeypatch.setitem(ns, "_safe_future_result", lambda future, timeout=None: original(future, timeout=min(timeout or 1.0, 1.0)))
    observed = {}

    def pack(self, lang, flat, grouped, name, batch_parallelism=1):
        if lang == "Klingon":
            deadline = time.time() + 20
            while time.time() < deadline:
                if any(event.is_set() for event in ns["_current_thread_cancel_events"]()):
                    observed["klingon_cancelled"] = True
                    return (lang, "tlh", None, None, None, name)
                time.sleep(0.02)
            return (lang, "tlh", None, None, None, name)
        return (lang, lang[:2].lower(), {"x": "y"}, grouped, {"Executive": lang}, name)
    cls = ns["DatabricksInspire"]
    monkeypatch.setattr(cls, "_translate_and_prepare_language_pack", pack)
    obj = make_inspire(ns, generate_choices=["PDF Catalog"])
    obj._python_package_status = {"weasyprint": (True, "")}
    obj.translation_service = types.SimpleNamespace(get_translations=lambda lang: {})
    written = []
    lock = threading.Lock()

    def record(lang, *_args):
        with lock:
            written.append(lang)
    obj.generate_catalog_pdf = record
    obj._generate_markdown_catalog = lambda *a, **k: None
    obj._generate_csv_catalog = lambda *a, **k: None
    obj._generate_use_case_excel = lambda *a, **k: None
    obj._emit_pipeline_status = lambda **kw: 1
    uc = make_uc("N01-U01")
    started = time.time()
    obj._generate_documents_for_all_languages([uc], english_grouped_data={"Sales": [uc]}, summary_dict={"Executive": "x"},
                                              languages=["English", "Klingon", "French"], skip_excel_langs=["English"])
    assert time.time() - started < 15
    assert sorted(written) == ["English", "French"]
    assert observed.get("klingon_cancelled") is True
    assert [f["language"] for f in obj.failed_steps if f["step"] == "Language Pack"] == ["Klingon"]
    assert obj.logger.matching("only Klingon is cancelled", level="ERROR")


@pytest.mark.parametrize("languages,share", [(["English", "French", "Arabic"], 4), (["English", "Arabic"], 8)])
def test_each_translated_language_gets_an_equal_share_of_the_translation_workers(agent_ns, monkeypatch, languages, share):
    ns = agent_ns
    monkeypatch.setitem(ns, "calculate_adaptive_parallelism", lambda step, max_parallelism, **kw: (8, "fixed for the test"))
    shares = {}
    lock = threading.Lock()

    def pack(self, lang, flat, grouped, name, batch_parallelism=1):
        with lock:
            shares[lang] = batch_parallelism
        return (lang, lang[:2].lower(), {"x": "y"}, grouped, {"Executive": lang}, name)
    monkeypatch.setattr(ns["DatabricksInspire"], "_translate_and_prepare_language_pack", pack)
    obj = make_inspire(ns, generate_choices=["PDF Catalog"])
    obj._python_package_status = {"weasyprint": (True, "")}
    obj.translation_service = types.SimpleNamespace(get_translations=lambda lang: {})
    obj.generate_catalog_pdf = lambda *a: None
    obj._generate_markdown_catalog = lambda *a, **k: None
    obj._generate_csv_catalog = lambda *a, **k: None
    obj._generate_use_case_excel = lambda *a, **k: None
    obj._emit_pipeline_status = lambda **kw: 1
    uc = make_uc("N01-U01")
    obj._generate_documents_for_all_languages([uc], english_grouped_data={"Sales": [uc]}, summary_dict={"Executive": "x"},
                                              languages=languages, skip_excel_langs=["English"])
    assert shares == {lang: share for lang in languages if lang != "English"}


def test_no_backticks_reach_any_document(docs, captured_html):
    uc = make_uc("N01-U01", "Sales", Name="Use `orders` daily", Statement="Join `sales`.`store_id` to stores.",
                 quality_mode="Ultra High", elite_status="ELITE", elite_score=8.5, elite_assessment=elite_assessment(),
                 **{"Tables Involved": "`main`.`s`.`sales`"})
    grouped = {"Sales": [uc]}
    summary_dict = {"Executive": "<p>The `orders` table drives this.</p>", "Sales": "<p>`Sales` text.</p>"}
    _, page = pdf_html(docs, captured_html, grouped, summary_dict)
    body = re.sub(r"<[^>]+>", " ", page[page.index("<body"):])
    assert "`" not in body
    _, prs = deck(docs, grouped, summary_dict)
    assert "`" not in " | ".join(slide_texts(prs))
    obj = make_inspire(docs)
    obj._generate_markdown_catalog("English", "en", grouped, summary_dict, "Acme")
    md = next(iter(obj.w_client.workspace.files.values())).decode("utf-8")
    entry = md[md.index("#### #1 "):md.index("## Disclaimer")]
    assert "`" not in entry and "Join sales.store_id to stores." in entry


def test_offline_pdf_uses_local_noto_or_dejavu_and_reports_it_loudly(docs, captured_html, monkeypatch):
    cls = docs["DatabricksInspire"]
    installed = {"noto sans cjk jp": "/fonts/NotoSansCJK-Regular.ttc", "dejavu sans": "/fonts/DejaVuSans.ttf",
                 "dejavu serif": "/fonts/DejaVuSerif.ttf"}
    monkeypatch.setattr(cls, "_DOC_INSTALLED_FONTS", [installed])
    obj = make_inspire(docs)
    faces, body, display, missing, fallbacks = obj._doc_font_css("Japanese", ["kana", "han"])
    by_script = {entry["script"]: entry["fallback"] for entry in fallbacks}
    assert by_script == {"latin": "DejaVu Sans", "kana": "Noto Sans CJK JP"}
    german = {entry["script"]: entry["fallback"] for entry in obj._doc_font_css("German", [])[4]}
    assert german == {"latin": "DejaVu Sans", "display": "DejaVu Serif"}
    assert "url('file:///fonts/DejaVuSans.ttf'), local('DejaVu Sans')" in faces and "local('Noto Sans CJK JP')" in faces
    assert "url('file:///fonts/NotoSansCJK-Regular.ttc')" not in faces
    assert body.endswith("'Noto Sans', 'DejaVu Sans', sans-serif")
    statuses = []
    obj, page = pdf_html(docs, captured_html, {"Sales": [make_uc("N01-U01")]}, summary(), language="Japanese")
    obj2 = make_inspire(docs)
    obj2._emit_pipeline_status = lambda **kw: statuses.append(kw) or 1
    obj2.generate_catalog_pdf("Japanese", "ja", labels(docs, "Japanese"), summary(), {"Sales": [make_uc("N01-U01")]}, "Acme")
    warning = [s for s in statuses if s.get("status") == "ended_warning" and s.get("step_name") == "PDF Catalog"]
    assert warning and warning[0]["stage_name"] == "Document Generation" and warning[0]["sub_step_name"] == "Japanese fonts"
    assert obj2.final_inspire_results_json["document_font_fallbacks"]["Japanese"]
    assert any(w.startswith("PDF fonts replaced by installed fonts: Japanese") for w in obj2._run_outcome_warnings())
    assert obj2.logger.matching("[DOCS-FONTS fallback] Japanese PDF", level="WARNING")
    monkeypatch.setattr(cls, "_DOC_INSTALLED_FONTS", [{}])
    _, _, _, _, bare = obj._doc_font_css("Japanese", ["kana"])
    assert all(entry["fallback"] is None for entry in bare)


def test_online_fonts_record_no_fallback(docs, captured_html, monkeypatch, tmp_path):
    cls = docs["DatabricksInspire"]
    font = tmp_path / "f.ttf"
    font.write_bytes(b"\0" * 4096)
    monkeypatch.setattr(cls, "_doc_font_files", lambda self, family, weights: {w: str(font) for w in weights})
    statuses = []
    obj = make_inspire(docs)
    obj._emit_pipeline_status = lambda **kw: statuses.append(kw) or 1
    obj.generate_catalog_pdf("Japanese", "ja", labels(docs, "Japanese"), summary(), {"Sales": [make_uc("N01-U01")]}, "Acme")
    assert not [s for s in statuses if s.get("status") == "ended_warning"]
    assert "document_font_fallbacks" not in obj.final_inspire_results_json


def test_scores_stay_left_to_right_inside_arabic_text(docs, captured_html):
    cls = docs["DatabricksInspire"]
    assert cls._doc_is_ltr_text("8.3 / 10") and cls._doc_is_ltr_text("4.0 / 5") and cls._doc_is_ltr_text("12:30")
    assert not cls._doc_is_ltr_text("7") and not cls._doc_is_ltr_text("مرحبا 8 / 10") and not cls._doc_is_ltr_text("")
    uc = make_uc("N01-U01", "Sales", **{"Inspire Score": 8.3})
    _, page = pdf_html(docs, captured_html, {"Sales": [uc]}, summary(), language="Arabic")
    card = section(page, 'id="uc-N01-U01"', "</article>")
    assert '<span dir="ltr">8.3 / 10</span>' in card
    _, prs = deck(docs, {"Sales": [uc]}, summary(), language="Arabic")
    scores = [p for slide in prs.slides for shape in slide.shapes if shape.has_text_frame
              for p in shape.text_frame.paragraphs if p.text.strip("\u200e") == "8.3 / 10"]
    assert scores and all(p._p.pPr.get("rtl") == "0" for p in scores)


def test_fit_keeps_text_that_exactly_fills_its_box(docs):
    pytest.importorskip("pptx")
    cls = docs["DatabricksInspire"]
    obj = make_inspire(docs)
    model = obj._document_model("Hindi", labels(docs, "Hindi"), {}, ultra_portfolio(), "Acme")
    box = cls._Deck(obj, model, labels(docs, "Hindi"))
    text = ["डेटाब्रिक्स जीनी कोड से हर स्टोर की साप्ताहिक मांग का पूर्वानुमान बनाता है और योजनाकार को समय पर सूचना देता है।"]
    exact = box.height(text, 3.0, 12) * (1 - 1e-9)
    assert box.fit(text, 3.0, exact, 12, 12) == (12, text)
    size, kept = box.fit(text, 3.0, exact * 0.5, 12, 12)
    assert kept != text


def test_deck_never_trims_translated_text_in_any_language(docs, monkeypatch):
    pytest.importorskip("pptx")
    cls = docs["DatabricksInspire"]
    original = cls._Deck.fit
    trims = []

    def fit(self, lines, w, h, size, floor, *args, **kwargs):
        result = original(self, lines, w, h, size, floor, *args, **kwargs)
        if result[1] != list(lines):
            trims.append((self.language, self.records[-1]["archetype"] if self.records else "", str(lines[0])[:60]))
        return result
    monkeypatch.setattr(cls._Deck, "fit", fit)
    for language in LANGUAGES:
        deck(docs, ultra_portfolio(), summary(), language=language)
        deck(docs, portfolio(), summary(), language=language)
    assert sorted(set(trims)) == []


def test_nonspacing_marks_take_no_width_in_any_script(docs):
    em = docs["DatabricksInspire"]._Deck.char_em
    for mark in ("\u0301", "\u064e", "\u0e31", "\u094d", "\u0bcd", "\u0c4d", "\u05b8", "\u200d"):
        assert em(mark) == 0.0, hex(ord(mark))
    assert 0.0 < em("\u0bbe") < em("\u0b95")
    assert em("\u0915") > 0.5 and em("\u0b95") > 0.5


def test_deck_structure_is_identical_across_languages_with_glossary_on_its_own_slide(docs):
    pytest.importorskip("pptx")
    shapes = {}
    for language in ("English", "German", "Japanese", "Arabic"):
        obj, prs = deck(docs, portfolio(), summary(), language=language)
        archetypes = [a.strip("' ") for a in archetypes_logged(obj).strip("[]").split(",")]
        assert archetypes.count("methodology") == 1 and archetypes.count("glossary") == 1
        assert archetypes[archetypes.index("methodology") + 1] == "glossary"
        shapes[language] = archetypes
        glossary = slide_texts(prs)[archetypes.index("glossary")]
        model = obj._document_model(language, labels(docs, language), summary(), portfolio(), "Acme")
        assert all(term in glossary for term, _body in model["glossary"])
    assert len({tuple(a) for a in shapes.values()}) == 1, shapes


def test_guide_continues_on_a_second_slide_only_when_the_language_overflows(docs):
    pytest.importorskip("pptx")
    for language, continued in (("English", False), ("Tamil", True)):
        obj, prs = deck(docs, portfolio(), summary(), language=language)
        archetypes = [a.strip("' ") for a in archetypes_logged(obj).strip("[]").split(",")]
        assert ("guide_more" in archetypes) is continued, (language, archetypes)
        texts = slide_texts(prs)
        modes = labels(docs, language)["doc_modes_title"]
        where = archetypes.index("guide_more") if continued else archetypes.index("guide")
        assert modes in texts[where]
        if continued:
            assert archetypes[archetypes.index("guide") + 1] == "guide_more" and modes not in texts[archetypes.index("guide")]


@pytest.mark.parametrize("grouped", [ultra_portfolio(), {"Sales": [make_uc("N01-U01", "Sales")], "Ops": [make_uc("N02-U01", "Ops")]}])
def test_every_internal_pdf_link_resolves_to_an_anchor(docs, captured_html, grouped):
    _, page = pdf_html(docs, captured_html, grouped, summary())
    targets = set(re.findall(r'href="#([^"]+)"', page))
    anchors = set(re.findall(r'\sid="([^"]+)"', page))
    assert "sec-domains" in targets and targets <= anchors, sorted(targets - anchors)

