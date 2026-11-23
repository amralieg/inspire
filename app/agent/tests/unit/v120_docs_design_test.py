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
    monkeypatch.setattr(agent_ns["workspace"], "ImportFormat", types.SimpleNamespace(AUTO="AUTO"), raising=False)
    return agent_ns


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


def markdown_catalog(ns, grouped, summary_dict, language="English", **attrs):
    obj = make_inspire(ns, **attrs)
    obj._generate_markdown_catalog(language, "xx", grouped, summary_dict, "Acme")
    return obj, next(iter(obj.w_client.workspace.files.values())).decode("utf-8")


def section(html, start_marker, end_marker):
    start = html.index(start_marker)
    end = html.index(end_marker, start + len(start_marker))
    return html[start:end]


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
    assert highlights.index(obj._summary_use_case_name(elite, "English")) < highlights.index(obj._summary_use_case_name(plain, "English"))


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
    """FX-116: the PDF and deck writers are gone, so the document labels are the doc_ and value_mode_ keys the remaining
    Markdown and CSV catalogs read from the translation table."""
    english = ns["TranslationService"].ENGLISH_TRANSLATIONS
    return sorted(k for k in english if k.startswith(("doc_", "value_mode_")))


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
        same = [k for k in keys if k.startswith("doc_") and re.search(r"[A-Za-z]", placeholder.sub("", ts.ENGLISH_TRANSLATIONS[k]))
                and ts.TRANSLATION_FALLBACKS[language][k] == ts.ENGLISH_TRANSLATIONS[k]]
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


COUNTED_LABELS = {"doc_domain_fallback": ("count",), "doc_data_access_read": ("tables",), "doc_index_lead": ("count",),
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
    assert obj._doc_text({}, "doc_data_access_read", "English", tables=1).startswith(
        "Inspire read aggregates from the tables in scope, 1 in total (row counts")
    assert obj._doc_text({}, "doc_index_lead", "English", count=1) == "All use cases in final rank order, 1 in total."
    assert obj._doc_text({}, "doc_deck_scope", "Russian", count=22, total=95) == (
        "В этой презентации подробно описаны сценарии использования с наивысшим рейтингом (22 из 95). В PDF-каталоге описаны все.")
    assert obj._doc_text({}, "doc_deck_scope_all", "English", total=1) == "This presentation details every use case, 1 in total, one card each."
