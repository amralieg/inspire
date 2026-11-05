"""v1.2.0 DOCS final3: one title field in every language, count-free narratives, em-dash-free documents,
registry-canonical technique labels and a deck that covers the final set.

Owner findings on the live5 review: the English and the Arabic/Japanese documents titled the same use case with
different fields (normalized headline vs translated Name); the narratives stated use-case counts that contradicted the
tiles; em dashes reached the documents; technique names outside the registry stayed in English; and the Ultra High
deck dropped the coverage picks. Every test below fails on the pre-fix code and passes after it.
"""
import csv
import html as html_lib
import io
import re
import types

import pytest

from v120_artifacts_support import elite_assessment, make_inspire, make_uc
from v120_docs_design_test import captured_html, deck, docs, labels, pdf_html, section, slide_texts, summary

AR_HEADLINE = "توقع الطلب على المخبوزات"
AR_NAME = "توقع الطلب اليومي على المخبوزات لكل فرع لتقليل الهدر"
AR_TECHNIQUE = "الترتيب القائم على الدرجات"


def translated_arabic(ns, uc, **row_extra):
    ts = ns["TranslationService"]
    service = ts.__new__(ts)
    row = {"Name": AR_NAME, "Headline": AR_HEADLINE, "Business Domain": "المبيعات", "Subdomain": "التخطيط",
           "type": "Opportunity", "Statement": "بيان طويل مترجم بالكامل إلى العربية", "Solution": "حل مترجم",
           "Business Value": "قيمة مترجمة", "Beneficiary": "المخطط", "Sponsor": "المدير", "Technique Label": ""}
    row.update(row_extra)
    return service._merge_translation(uc, row, "Arabic")


def card_slides(prs):
    return [text for text in slide_texts(prs) if re.search(r"\| \d+ \| N\d\d-U\d\d · ", text)]


def test_translation_payload_carries_the_headline_and_the_merge_makes_it_the_title(docs):
    ts = docs["TranslationService"]
    uc = make_uc("N01-U01", usecase="forecast daily bakery demand with prophet", Name="Forecast daily demand per store")
    payload = ts._translation_payload(uc)
    assert payload["Headline"] == "Forecast Daily Bakery Demand"
    assert "Headline" in ts._translatable_fields_present(uc)
    merged = translated_arabic(docs, uc)
    assert merged["usecase"] == AR_HEADLINE and merged["Name"] == AR_NAME
    assert "Headline" not in merged["_untranslated_fields"]
    obj = make_inspire(docs)
    assert obj._doc_use_case_title(merged, "Arabic") == AR_HEADLINE
    assert obj._doc_use_case_title(uc, "English") == "Forecast Daily Bakery Demand"
    missing = translated_arabic(docs, uc, Headline="")
    assert "Headline" in missing["_untranslated_fields"]
    assert obj._doc_use_case_title(missing, "Arabic") == "Forecast Daily Bakery Demand"


def test_the_same_title_field_names_the_use_case_on_every_surface_in_every_language(docs, captured_html):
    english = make_uc("N01-U01", "Sales", usecase="Forecast Bakery Demand", Name="Forecast daily demand per store to cut waste")
    arabic = translated_arabic(docs, english)
    _, page_en = pdf_html(docs, captured_html, {"Sales": [english]}, summary())
    _, page_ar = pdf_html(docs, captured_html, {"المبيعات": [arabic]}, summary(), language="Arabic")
    card_en = section(page_en, 'id="uc-N01-U01"', "</article>")
    card_ar = section(page_ar, 'id="uc-N01-U01"', "</article>")
    assert ">Forecast Bakery Demand</h3>" in card_en and "Forecast daily demand per store to cut waste" in card_en
    assert f">{html_lib.escape(AR_HEADLINE)}</h3>" in card_ar
    assert f">{html_lib.escape(AR_NAME)} باستخدام " in card_ar, "the Arabic card joins the name and technique with the Arabic word"
    assert page_ar.count(html_lib.escape(AR_HEADLINE)) >= 3
    _, prs = deck(docs, {"المبيعات": [arabic]}, summary(), language="Arabic")
    texts = [text.replace("\u2066", "").replace("\u2069", "") for text in slide_texts(prs)]
    card = next(text for text in texts if "N01-U01 · " in text and AR_NAME in text)
    assert AR_HEADLINE in card
    assert sum(AR_HEADLINE in text for text in texts) >= 3
    obj = make_inspire(docs)
    obj._generate_csv_catalog("English", "en", {"Sales": [english]})
    rows = list(csv.reader(io.StringIO(next(iter(obj.w_client.workspace.files.values())).decode("utf-8"))))
    assert dict(zip(rows[0], rows[1]))["Use Case"] == "Forecast Bakery Demand"


def test_identical_title_and_name_show_no_subtitle(docs):
    obj = make_inspire(docs)
    uc = make_uc("N01-U01", usecase="Forecast Bakery Demand", Name="Forecast Bakery Demand")
    model = obj._document_model("English", labels(docs), summary(), {"Sales": [uc]}, "Acme")
    assert obj._use_case_view(model["ranked"][0], model, labels(docs))["name"] == ""


def test_summary_highlights_use_the_catalog_name_and_no_counts(docs):
    seen = []

    def run_worker(step_name, worker_prompt_path, prompt_vars, response_schema, **kw):
        seen.append(prompt_vars)
        return '"Type","Summary","TransliteratedBusinessName"\n"Executive","x","Acme"\n'
    obj = make_inspire(docs, ai_agent=types.SimpleNamespace(run_worker=run_worker))
    obj._get_generation_instruction_for_prompt = lambda name: ""
    english = make_uc("N01-U01", "Sales", usecase="Forecast Bakery Demand", Name="Forecast daily demand per store")
    obj._get_salesy_summary({"Sales": [english, make_uc("N01-U02", "Sales")]}, "Acme", "English", labels(docs))
    obj._get_salesy_summary({"المبيعات": [translated_arabic(docs, english)]}, "Acme", "Arabic", labels(docs, "Arabic"))
    en, ar = seen[0]["domain_use_case_highlights"], seen[1]["domain_use_case_highlights"]
    assert "- Forecast daily demand per store:" in en and "Forecast Bakery Demand" not in en
    assert f"- {AR_NAME}:" in ar and f"- {AR_HEADLINE}:" not in ar
    assert "use cases)" not in en and "(2" not in en
    assert "total_cases" not in seen[0]
    template = docs["PROMPT_TEMPLATES"]["SUMMARY_GEN_PROMPT"]
    rendered = template.format(**seen[0])
    assert "Never state how many use cases the portfolio, the catalog or any domain has" in rendered
    assert "Reference a use case ONLY by its displayed title" in rendered
    example = rendered[rendered.index("### EXAMPLE CSV OUTPUT"):rendered.index("### FINAL INSTRUCTION")]
    assert not re.search(r"\b\d+\s+(identified\s+)?use cases", example) and "{total_cases}" not in template
    assert not re.search(r"identified \d+ use cases|\b\d+ use cases across", rendered)
    assert "\u2014" not in rendered and "\u2014" not in template


def test_docs_only_mode_regenerates_the_english_narratives_and_keeps_the_stored_ones_on_fallback(docs):
    obj = make_inspire(docs)
    obj.translation_service = types.SimpleNamespace(get_translations=lambda language: {})
    stored = {"Executive": "<p>Spanning thirteen use cases</p>", "Sales": "<p>Its four use cases</p>"}
    obj._get_salesy_summary = lambda grouped, name, language, t: ({"Executive": "<p>E</p>", "Sales": "<p>S</p>"}, name)
    assert obj._refresh_english_summary({"Sales": [make_uc("N01-U01")]}, stored) == {"Executive": "<p>E</p>", "Sales": "<p>S</p>"}
    assert obj.logger.matching("[DOCS-SUMMARY refreshed]")
    obj._get_salesy_summary = lambda grouped, name, language, t: ({"Executive": "<p>fallback</p>"}, name)
    assert obj._refresh_english_summary({"Sales": [make_uc("N01-U01")]}, stored) is stored
    assert obj.logger.matching("[DOCS-SUMMARY stored]")
    from _agentload import agent_source
    src = agent_source()
    load = src.index("= self._load_usecases_catalog_json(self.json_file_path)")
    assert src.index("self._refresh_english_summary(english_grouped_data, summary_dict)", load) < src.index(
        "self._generate_documents_for_all_languages(", load)


@pytest.mark.parametrize("text, expected", [
    ("Revenue \u2014 growth", "Revenue, growth"),
    ("Revenue\u2014growth", "Revenue, growth"),
    ("\u2014 lead item", "lead item"),
    ("trailing \u2014", "trailing"),
    ("Revenue: \u2014 growth", "Revenue: growth"),
    ("a \u2014\u2014 b \u2015 c", "a, b, c"),
    ("line one \u2014\nline two", "line one\nline two"),
    ("売上の予測\u2014在庫の最適化", "売上の予測、在庫の最適化"),
    ("销售预测\u2014库存优化", "销售预测，库存优化"),
    ("توقع الإيرادات \u2014 النمو", "توقع الإيرادات، النمو"),
    ("plain - hyphen and \u2013 en dash", "plain - hyphen and \u2013 en dash"),
    (None, ""),
])
def test_no_em_dash_rewrites_dashes_with_the_script_appropriate_comma(docs, text, expected):
    assert docs["inspire_no_em_dash"](text) == expected


def test_no_em_dash_reaches_any_document_format_including_ai_narratives(docs, captured_html):
    import openpyxl
    dash = " \u2014 "
    domain = f"Sales{dash}Retail"
    uc = make_uc("N01-U01", domain, usecase=f"Forecast{dash}Demand", Name=f"Forecast demand{dash}per store",
                 Statement=f"Waste is high{dash}stores over-bake.", Solution=f"Train a model{dash}daily.",
                 **{"Business Value": f"Less waste{dash}more margin", "Beneficiary": f"Planner{dash}stores",
                    "Sponsor": f"COO{dash}Operations", "Subdomain": f"Planning{dash}Daily",
                    "quality_mode": "Ultra High", "elite_status": "ELITE", "elite_score": 9.0,
                    "elite_assessment": elite_assessment(decision=f"Set bake quantities{dash}per store",
                                                         red_team=f"Promotions{dash}not in data")})
    narratives = {"Executive": f"<p>Acme{dash}bakes daily.</p>", domain: f"<p>Sales{dash}matter.</p>"}
    grouped = {domain: [uc]}
    _, page = pdf_html(docs, captured_html, grouped, narratives)
    body = page[page.index("<body"):]
    assert "\u2014" not in html_lib.unescape(re.sub(r"<[^>]+>", " ", body))
    _, prs = deck(docs, grouped, narratives)
    assert not [text for text in slide_texts(prs) if "\u2014" in text]
    obj = make_inspire(docs)
    obj._generate_markdown_catalog("English", "en", grouped, narratives, "Acme")
    assert "\u2014" not in next(iter(obj.w_client.workspace.files.values())).decode("utf-8")
    obj = make_inspire(docs)
    obj._generate_csv_catalog("English", "en", grouped)
    assert "\u2014" not in next(iter(obj.w_client.workspace.files.values())).decode("utf-8")
    obj = make_inspire(docs)
    obj._generate_use_case_excel("English", "en", grouped)
    workbook = openpyxl.load_workbook(io.BytesIO(next(iter(obj.w_client.workspace.files.values()))))
    cells = [str(c.value) for sheet in workbook.worksheets for row in sheet.iter_rows() for c in row if c.value is not None]
    assert cells and not [c for c in cells if "\u2014" in c]
    assert "Less waste, more margin" in cells


def test_japanese_document_rewrites_em_dashes_with_the_ideographic_comma(docs, captured_html):
    uc = make_uc("N01-U01", "営業", usecase="需要予測", Name="店舗別の需要予測\u2014廃棄の削減", Statement="廃棄が多い\u2014過剰生産")
    _, page = pdf_html(docs, captured_html, {"営業": [uc]}, summary(), language="Japanese")
    assert "店舗別の需要予測、廃棄の削減" in page and "廃棄が多い、過剰生産" in page and "\u2014" not in page[page.index("<body"):]


@pytest.mark.parametrize("raw, canonical", [
    ("Forecasting", "Forecasting"), ("forecasting", "Forecasting"), ("  Anomaly   detection ", "Anomaly Detection"),
    ("anomaly-detection", "Anomaly Detection"), ("Cohort Analyses", "Cohort Analysis"), ("Trend analysis", "Trend Analysis"),
    ("Entity Extraction", "Extraction"), ("NLP Classification", "Classification"), ("Market Basket Analysis", "Recommendation"),
    ("Topic Modeling", "Clustering"), ("Topic Modelling", "Clustering"), ("Recommendations", "Recommendation"),
    ("Segmentation", "Segmentation"), ("Optimisation", "Optimization"),
    ("Score-Based Ranking", None), ("Summarization", None), ("Quantum Basket Mining", None), ("", None),
])
def test_technique_strings_canonicalize_to_registry_entries(docs, raw, canonical):
    cls = docs["DatabricksInspire"]
    assert cls._canonical_technique(raw) == canonical
    if canonical:
        assert canonical in cls._TECHNIQUE_VALUE_KEYS


def test_every_registry_family_label_has_a_translation_key(docs):
    cls = docs["DatabricksInspire"]
    assert all(label in cls._TECHNIQUE_VALUE_KEYS for _key, label, _aliases, _methods in cls._TECHNIQUE_FAMILIES)


def test_registry_aliases_render_translated_in_arabic_and_japanese(docs):
    obj = make_inspire(docs)
    for language in ("Arabic", "Japanese"):
        t = labels(docs, language)
        for raw in ("Entity Extraction", "NLP Classification", "Market Basket Analysis", "Topic Modeling", "anomaly detection"):
            label, flagged = obj._doc_technique_label(raw, t, language)
            assert not flagged and label != raw and not re.search("[A-Za-z]", label), (language, raw, label)
    assert obj._doc_technique_label("Entity Extraction", labels(docs), "English") == ("Extraction", False)


def test_non_registry_techniques_go_through_the_translation_payload(docs, captured_html):
    ts = docs["TranslationService"]
    ranking = make_uc("N01-U01", "Sales", **{"Analytics Technique": "Score-Based Ranking"})
    assert ts._translation_payload(ranking)["Technique Label"] == "Score-Based Ranking"
    assert "Technique Label" in ts._translatable_fields_present(ranking)
    assert ts._translation_payload(make_uc("N01-U02", "Sales"))["Technique Label"] == ""
    assert "Technique Label" not in ts._translatable_fields_present(make_uc("N01-U02", "Sales"))
    merged = translated_arabic(docs, ranking, **{"Technique Label": AR_TECHNIQUE})
    assert merged["Analytics Technique Label"] == AR_TECHNIQUE and "Technique Label" not in merged["_untranslated_fields"]
    obj, page = pdf_html(docs, captured_html, {"المبيعات": [merged]}, summary(), language="Arabic")
    card = section(page, 'id="uc-N01-U01"', "</article>")
    assert AR_TECHNIQUE in card and "Score-Based Ranking" not in card
    assert "analytics_technique" not in (getattr(obj, "translation_gaps", None) or {}).get("Arabic", {}).get("labels_in_english", {})
    assert not obj.logger.matching("[DOCS-LABELS untranslated]")
    untranslated = translated_arabic(docs, ranking, **{"Technique Label": ""})
    assert "Technique Label" in untranslated["_untranslated_fields"]
    assert obj._doc_technique_label("Score-Based Ranking", labels(docs, "Arabic"), "Arabic", untranslated) == ("Score-Based Ranking", True)


def test_translation_parser_keeps_the_headline_and_technique_label_columns(docs):
    ts = docs["TranslationService"]
    service = ts.__new__(ts)
    service.logger = make_inspire(docs).logger
    header = '"No","Name","Business Domain","Subdomain","type","Analytics Technique","Statement","Solution","Business Value","Beneficiary","Sponsor","Business Priority Alignment","Strategic Goals Alignment","Tables Involved","Quality","Headline","Technique Label","honesty_score","honesty_justification"'
    row = '"N01-U01","اسم","المبيعات","التخطيط","Opportunity","Score-Based Ranking","بيان","حل","قيمة","مخطط","مدير","","","main.s.sales","High","عنوان","ترتيب","9","ok"'
    rows = service._parse_translation_csv(header + "\n" + row + "\n", [make_uc("N01-U01")], 1, "Arabic")
    assert rows[0]["Headline"] == "عنوان" and rows[0]["Technique Label"] == "ترتيب"


def _ultra_with_coverage():
    sales = [make_uc(f"N01-U0{i}", "Sales", quality_mode="Ultra High", elite_status="ELITE", elite_score=9.0 - i / 10,
                     elite_assessment=elite_assessment(), **{"Inspire Score": 9.0 - i / 10}) for i in range(1, 4)]
    ops = [make_uc("N02-U01", "Operations", quality_mode="Ultra High", elite_status="DOMAIN_COVERAGE_PICK",
                   coverage_pick_reason="Below bar: quality 'Medium' is below the High bar", **{"Inspire Score": 6.0})]
    hr = [make_uc("N03-U01", "People", quality_mode="Ultra High", elite_status="DOMAIN_COVERAGE_PICK",
                  coverage_pick_reason="Below bar: feasibility 2 / 5", **{"Inspire Score": 5.0})]
    return {"Sales": sales, "Operations": ops, "People": hr}


def test_small_final_set_gives_every_use_case_a_deck_card_including_coverage_picks(docs):
    grouped = _ultra_with_coverage()
    t = labels(docs)
    obj, prs = deck(docs, grouped, summary())
    cards = card_slides(prs)
    for no in ("N01-U01", "N01-U02", "N01-U03", "N02-U01", "N03-U01"):
        assert any(f"{no} · " in text for text in cards), no
    coverage = next(text for text in cards if "N02-U01 · " in text)
    assert f'{t["elite_coverage_pick"]}. {t["elite_reason"]}: Below bar: quality' in coverage
    texts = slide_texts(prs)
    assert any(t["doc_deck_scope_all"].format(total=5) in text for text in texts)
    assert not any(t["doc_deck_scope"].split("{")[0] in text for text in texts)


def test_large_final_set_shows_the_top_n_cards_and_states_the_truncation_and_the_full_index(docs):
    grouped = {"Sales": [make_uc(f"N01-U{i:02d}", "Sales", **{"Inspire Score": 9.0 - i / 10}) for i in range(1, 21)],
               "Operations": [make_uc(f"N02-U{i:02d}", "Operations", **{"Inspire Score": 8.95 - i / 10}) for i in range(1, 11)]}
    t = labels(docs)
    obj, prs = deck(docs, grouped, summary())
    limit = docs["DatabricksInspire"]._DOC_TOP_LIMIT["default"]
    assert len(card_slides(prs)) == limit
    texts = slide_texts(prs)
    assert any(t["doc_deck_scope"].format(count=limit, total=30) in text for text in texts)
    index = " ".join(text for text in texts if "N01-U20" in text or "N02-U10" in text)
    assert "N01-U20" in index and "N02-U10" in index


def test_large_ultra_set_keeps_coverage_picks_in_the_deck(docs):
    cls = docs["DatabricksInspire"]
    grouped = {"Sales": [make_uc(f"N01-U{i:02d}", "Sales", quality_mode="Ultra High", elite_status="ELITE", elite_score=9.5 - i / 10,
                                 elite_assessment=elite_assessment(), **{"Inspire Score": 9.5 - i / 10}) for i in range(1, 17)],
               "Operations": [make_uc("N02-U01", "Operations", quality_mode="Ultra High", elite_status="DOMAIN_COVERAGE_PICK",
                                      coverage_pick_reason="Below bar", **{"Inspire Score": 4.0})]}
    obj = make_inspire(docs)
    model = obj._document_model("English", labels(docs), summary(), grouped, "Acme")
    assert model["total"] > cls._DOC_TOP_LIMIT["deck_all"]
    assert [uc["No"] for uc in model["deck"]][-1] == "N02-U01"
    assert len(model["deck"]) == cls._DOC_TOP_LIMIT["elite"] + 1


TRANSLATE_HEADER = ["No", "Name", "Business Domain", "Subdomain", "type", "Analytics Technique",
                    "Statement", "Solution", "Business Value", "Beneficiary", "Sponsor", "Business Priority Alignment",
                    "Strategic Goals Alignment", "Tables Involved", "Quality", "Headline", "Technique Label"]


def _translation_csv(rows, honesty=True):
    out = io.StringIO()
    writer = csv.writer(out, quoting=csv.QUOTE_ALL)
    writer.writerow(TRANSLATE_HEADER + ["honesty_score", "honesty_justification"])
    for row in rows:
        writer.writerow(row + (["90", "faithful"] if honesty else []))
    return out.getvalue()


def _ja_row(no, drop=None, extra=False):
    values = [no, "名前", "営業", "計画", "Opportunity", "Forecasting", "ステートメント", "解決策", "価値", "担当", "役員",
              "", "", "main.s.sales", "High", "見出し", ""]
    if drop is not None:
        del values[TRANSLATE_HEADER.index(drop)]
    return values + (["余分な値"] if extra else [])


@pytest.mark.parametrize("drop, extra", [("Headline", False), ("Subdomain", False), ("Quality", False), (None, True)])
def test_a_short_or_long_translation_row_is_treated_as_missing_not_shifted(docs, drop, extra):
    ts = docs["TranslationService"]
    service = ts.__new__(ts)
    service.logger = make_inspire(docs).logger
    batch = [make_uc("N01-U01"), make_uc("N01-U02")]
    response = _translation_csv([_ja_row("N01-U01"), _ja_row("N01-U02", drop=drop, extra=extra)])
    try:
        rows = service._parse_translation_csv(response, batch, 1, "Japanese")
    except ValueError as error:
        assert "TRUNCATED" in str(error)
        rows = []
    assert rows == []
    assert service.logger.matching("[TRANSLATE-ROW malformed]")


@pytest.mark.parametrize("tail", [[], ["90"], ["90", "faithful"], ["95/100", "ok"], ["", ""]])
def test_rows_with_complete_or_trailing_only_honesty_columns_are_accepted(docs, tail):
    ts = docs["TranslationService"]
    service = ts.__new__(ts)
    service.logger = make_inspire(docs).logger
    out = io.StringIO()
    writer = csv.writer(out, quoting=csv.QUOTE_ALL)
    writer.writerow(TRANSLATE_HEADER + ["honesty_score", "honesty_justification"])
    writer.writerow(_ja_row("N01-U01") + tail)
    writer.writerow(_ja_row("N01-U02") + tail)
    rows = service._parse_translation_csv(out.getvalue(), [make_uc("N01-U01"), make_uc("N01-U02")], 1, "Japanese")
    assert [r["Headline"] for r in rows] == ["見出し", "見出し"] and rows[0]["Subdomain"] == "計画" and rows[0]["type"] == "Opportunity"
    assert not service.logger.matching("[TRANSLATE-ROW malformed]")


def _service(docs):
    ts = docs["TranslationService"]
    service = ts.__new__(ts)
    service.logger = make_inspire(docs).logger
    return service


def test_a_full_length_row_written_in_another_column_order_is_treated_as_missing(docs):
    service = _service(docs)
    reordered = ["N01-U02", "名前", "見出し", "営業", "計画", "Opportunity", "Forecasting", "", "ステートメント", "解決策", "価値", "担当",
                 "役員", "", "", "main.s.sales", "High"]
    response = _translation_csv([_ja_row("N01-U01"), reordered])
    try:
        rows = service._parse_translation_csv(response, [make_uc("N01-U01"), make_uc("N01-U02")], 1, "Japanese")
    except ValueError:
        rows = []
    assert rows == []
    assert service.logger.matching("[TRANSLATE-ROW malformed]")
    assert any("Analytics Technique value" in m or "Tables Involved value" in m for _, m in service.logger.matching("[TRANSLATE-ROW malformed]"))


def test_an_untranslated_technique_label_equal_to_the_technique_is_not_a_misalignment(docs):
    service = _service(docs)
    row = _ja_row("N01-U01")
    row[TRANSLATE_HEADER.index("Technique Label")] = "Forecasting"
    rows = service._parse_translation_csv(_translation_csv([row]), [make_uc("N01-U01")], 1, "Japanese")
    assert rows[0]["Technique Label"] == "Forecasting" and rows[0]["Headline"] == "見出し"
    assert not service.logger.matching("[TRANSLATE-ROW malformed]")


def test_a_row_without_the_two_trailing_columns_but_with_honesty_values_is_treated_as_missing(docs):
    service = _service(docs)
    response = _translation_csv([_ja_row("N01-U01"), _ja_row("N01-U02")[:-2]])
    try:
        rows = service._parse_translation_csv(response, [make_uc("N01-U01"), make_uc("N01-U02")], 1, "Japanese")
    except ValueError:
        rows = []
    assert rows == [] and service.logger.matching("[TRANSLATE-ROW malformed]")


def test_a_malformed_row_is_retried_and_the_retry_translates_the_batch(docs):
    ts = docs["TranslationService"]
    responses = [_translation_csv([_ja_row("N01-U01", drop="Headline")]), _translation_csv([_ja_row("N01-U01")])]
    calls = []

    def run_worker(step_name, worker_prompt_path, prompt_vars, response_schema=None, skip_cache=False, **kw):
        calls.append(skip_cache)
        return responses[len(calls) - 1]
    service = ts(types.SimpleNamespace(run_worker=run_worker), make_inspire(docs).logger)
    out = service._translate_batch([make_uc("N01-U01")], "Japanese", 0)
    assert calls == [False, True]
    assert out[0]["usecase"] == "見出し" and out[0]["Subdomain"] == "計画" and out[0]["type"] == "Opportunity"


def test_markdown_domain_count_is_grammatical(docs):
    obj = make_inspire(docs)
    obj._generate_markdown_catalog("English", "en", {"Sales": [make_uc("N01-U01")], "Operations": [make_uc("N02-U01", "Operations"),
                                                     make_uc("N02-U02", "Operations")]}, summary(), "Acme")
    md = next(iter(obj.w_client.workspace.files.values())).decode("utf-8")
    assert "*1 use case*" in md and "*2 use cases*" in md and "*1 use cases*" not in md


@pytest.mark.parametrize("narrative, kept", [
    ("<p>Merchandising is key. Two use cases make this tangible. Discount leakage gets caught.</p>",
     ["Merchandising is key. Discount leakage gets caught."]),
    ("<p>Spanning thirteen use cases, Acme grows.</p><p>Its 4 use cases matter. Pricing improves.</p>", ["Pricing improves."]),
    ("<p>小売は重要です。3つのユースケースが価値を示します。需要予測が役立ちます。</p>", ["小売は重要です。需要予測が役立ちます。"]),
    ("<p>هذا المجال مهم. ثلاث حالات استخدام تبرز القيمة. التنبؤ مفيد.</p>", ["هذا المجال مهم. التنبؤ مفيد."]),
    ("<p>Forecast Bakery Demand cuts waste by 10% across stores.</p>", ["Forecast Bakery Demand cuts waste by 10% across stores."]),
])
def test_narrative_sentences_that_count_use_cases_are_dropped(docs, narrative, kept):
    obj = make_inspire(docs)
    assert obj._doc_narrative(narrative, "Sales") == kept
    assert bool(obj.logger.matching("[DOCS-NARRATIVE count-dropped]")) == (kept != [obj._doc_paragraphs(narrative)[0]])


def test_count_sentences_reach_no_document_surface(docs, captured_html):
    counted = {"Executive": "<p>Acme bakes daily. Spanning thirteen use cases, the catalog is broad.</p>",
               "Sales": "<p>Sales matters. Two use cases make this tangible.</p>"}
    grouped = {"Sales": [make_uc("N01-U01"), make_uc("N01-U02"), make_uc("N01-U03")]}
    _, page = pdf_html(docs, captured_html, grouped, counted)
    assert "thirteen use cases" not in page and "Two use cases" not in page and "Sales matters." in page
    _, prs = deck(docs, grouped, counted)
    assert not [text for text in slide_texts(prs) if "Two use cases" in text or "thirteen use cases" in text]
    obj = make_inspire(docs)
    obj._generate_markdown_catalog("English", "en", grouped, counted, "Acme")
    md = next(iter(obj.w_client.workspace.files.values())).decode("utf-8")
    assert "Two use cases" not in md and "thirteen use cases" not in md and "Acme bakes daily." in md


def test_summary_prompt_forbids_counting_the_examples_too(docs):
    template = docs["PROMPT_TEMPLATES"]["SUMMARY_GEN_PROMPT"]
    assert 'never write "Two use cases make this tangible"' in template and "\u2014" not in template


@pytest.mark.parametrize("value, expected", [("見出し：クロスチャネル支出を増やす", "クロスチャネル支出を増やす"),
                                             ("Headline: Grow Basket Value", "Grow Basket Value"),
                                             ("العنوان: زيادة الإيرادات", "زيادة الإيرادات"),
                                             ("需要予測で廃棄を削減", "需要予測で廃棄を削減")])
def test_a_label_prefix_on_the_translated_headline_is_removed(docs, value, expected):
    merged = translated_arabic(docs, make_uc("N01-U01", usecase="Grow Basket Value"), Headline=value)
    assert merged["usecase"] == expected
    assert 'never a label such as "Headline:"' in docs["PROMPT_TEMPLATES"]["USE_CASE_TRANSLATE_PROMPT"]
