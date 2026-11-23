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
import threading
import time
import types

import pytest

from v120_artifacts_support import elite_assessment, make_inspire, make_uc
from v120_docs_design_test import LANGUAGES, docs, labels, markdown_catalog, summary


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


def test_one_view_drives_the_markdown_entry(docs):
    grouped = ultra_portfolio()
    model, views = expected_views(make_inspire(docs), docs, grouped)
    _, md = markdown_catalog(docs, grouped, summary())
    assert [v["id"] for v in views] == ["N01-U01", "N01-U02", "N02-U01"]
    for view in views:
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
    assert set(views[0]) == {"uc", "id", "rank", "title", "subtitle", "domain", "subdomain", "kind", "quality", "metrics", "narrative",
                             "facts", "value_facts", "coverage", "notice", "untranslated", "star", "meets_bar"}
    assert all(view["star"] is None for view in views), "a use case without the Best of Best mark has no star"
    assert all(view["value_facts"] == [] for view in views), "a catalog without v1.3.0 fields has no value facts"
    assert views[0]["kind"] == "elite" and "Elite Score" in view_labels(views[0])
    obj = make_inspire(docs)
    panel = [obj._doc_text({}, key) for key, _source in docs["DatabricksInspire"]._USE_CASE_VIEW_ELITE] + ["Red-Team Note", "Why this use case qualifies"]
    elite_entry = md[md.index("#### #1 "):]
    for label in panel:
        assert f"**{label}:**" not in elite_entry, label
    assert views[2]["coverage"][0] == "Domain coverage pick, below the bar"
    assert "Domain coverage pick, below bar: quality 'Medium'" in md[md.index("#### #3 "):]


def test_internal_flags_never_reach_a_card(docs):
    cls = docs["DatabricksInspire"]
    uc = make_uc("N01-U01", "Sales", **{field: f"SECRET-{i}" for i, field in enumerate(cls._USE_CASE_VIEW_EXCLUDED)
                                       if field not in ("elite_status", "quality_mode")})
    _, md = markdown_catalog(docs, {"Sales": [uc]}, summary())
    assert "SECRET-" not in md
    view_fields = {source for _key, source in cls._USE_CASE_VIEW_TEXT} | {source for _key, source, _kind in cls._USE_CASE_VIEW_FACTS}
    view_fields |= {source for _key, source, _scale in cls._USE_CASE_VIEW_SCORES}
    assert not view_fields & set(cls._USE_CASE_VIEW_EXCLUDED)


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


@pytest.mark.parametrize("language", ["English", "Arabic", "Japanese"])
def test_disclaimer_section_in_the_markdown_catalog(docs, language):
    t = labels(docs, language)
    obj = make_inspire(docs)
    model = obj._document_model(language, t, summary(), ultra_portfolio(), "Acme")
    title, paragraphs = obj._doc_disclaimer(model, t)
    assert len(paragraphs) == 4 and all(p.strip() for p in paragraphs)
    _, md = markdown_catalog(docs, ultra_portfolio(), summary(), language=language)
    block = md[md.index(f"## {title}"):]
    assert all(p in block for p in paragraphs)


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
    keys |= set(cls._DOC_CADENCE_KEYS.values())
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


def test_a_pure_fallback_set_carries_the_below_bar_label_and_notice(docs):
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
    notice = obj._quality_bar_notice([tier, tier2], {}, "English")
    assert notice == model["executive"][0] and notice.startswith("0 of 2 use cases meet the High quality bar.")
    _, md = markdown_catalog(docs, grouped, summary())
    assert "Below the High bar" in md


def test_an_ultra_high_near_miss_fallback_reads_near_miss_below_the_ultra_high_bar(docs):
    near = make_uc("N01-U01", "Sales", Name="Near miss", quality_mode="Ultra High", elite_status="FALLBACK_BELOW_BAR",
                   fallback_kind="near_miss", fallback_bar="Ultra High", fallback_reason="failed check: red_team",
                   elite_score=6.7, **{"Inspire Score": 6.7})
    obj = make_inspire(docs)
    model, views = expected_views(obj, docs, {"Sales": [near]})
    assert views[0]["coverage"][0] == "Near miss, below the Ultra High bar"
    assert views[0]["coverage"][2] == "failed check: red_team"
    assert obj._quality_bar_notice([near], {}, "English") == model["executive"][0]
    assert model["executive"][0].startswith("0 of 1 use") and "Ultra High quality bar" in model["executive"][0]


def test_missing_values_render_translated_not_provided_and_not_scored(docs):
    uc = make_uc("N01-U01", "Sales", Sponsor="", Beneficiary="N/A", **{"Inspire Score": None})
    for language in ("Arabic", "Japanese"):
        t = labels(docs, language)
        _, md = markdown_catalog(docs, {"Sales": [uc]}, summary(), language=language)
        card = md[md.index("#### #1 "):]
        assert card.count(t["doc_not_provided"]) >= 2 and t["doc_not_scored"] in card
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


def test_registry_techniques_have_unique_labels_and_unknown_ones_are_flagged_and_recorded(docs):
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
    obj, md = markdown_catalog(docs, {"Sales": [uc]}, summary(), language="Arabic")
    card = md[md.index("#### #1 "):]
    assert t["untranslated_notice"] in card and "Quantum Basket Mining" in card
    assert obj.translation_gaps["Arabic"]["labels_in_english"]
    assert "Quantum Basket Mining" in str(obj.translation_gaps["Arabic"]["labels_in_english"])
    assert obj.logger.matching("[DOCS-LABELS untranslated]")
    assert any("labels shown in English" in w for w in obj._run_outcome_warnings())
    assert obj.final_inspire_results_json["translation_gaps"]["Arabic"]["labels_in_english"]
    clean, _ = markdown_catalog(docs, {"Sales": [make_uc("N01-U01", "Sales")]}, summary(), language="Arabic")
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
    obj = make_inspire(ns)
    obj.translation_service = types.SimpleNamespace(get_translations=lambda lang: {})
    written = []
    lock = threading.Lock()

    def record(lang, *_args, **_kw):
        with lock:
            written.append(lang)
    obj.json_file_path = ""
    obj._generate_markdown_catalog = record
    obj._generate_csv_catalog = lambda *a, **k: None
    obj._generate_json_catalog = lambda *a, **k: None
    obj._emit_pipeline_status = lambda **kw: 1
    uc = make_uc("N01-U01")
    started = time.time()
    obj._generate_language_catalogs([uc], english_grouped_data={"Sales": [uc]}, summary_dict={"Executive": "x"},
                                    languages=["English", "Klingon", "French"])
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
    obj = make_inspire(ns)
    obj.translation_service = types.SimpleNamespace(get_translations=lambda lang: {})
    obj._generate_markdown_catalog = lambda *a, **k: None
    obj._generate_csv_catalog = lambda *a, **k: None
    obj._emit_pipeline_status = lambda **kw: 1
    uc = make_uc("N01-U01")
    obj._generate_language_catalogs([uc], english_grouped_data={"Sales": [uc]}, summary_dict={"Executive": "x"},
                                    languages=languages)
    assert shares == {lang: share for lang in languages if lang != "English"}


def test_no_backticks_reach_the_markdown_catalog(docs):
    uc = make_uc("N01-U01", "Sales", Name="Use `orders` daily", Statement="Join `sales`.`store_id` to stores.",
                 quality_mode="Ultra High", elite_status="ELITE", elite_score=8.5, elite_assessment=elite_assessment(),
                 **{"Tables Involved": "`main`.`s`.`sales`"})
    grouped = {"Sales": [uc]}
    summary_dict = {"Executive": "<p>The `orders` table drives this.</p>", "Sales": "<p>`Sales` text.</p>"}
    obj = make_inspire(docs)
    obj._generate_markdown_catalog("English", "en", grouped, summary_dict, "Acme")
    md = next(iter(obj.w_client.workspace.files.values())).decode("utf-8")
    entry = md[md.index("#### #1 "):md.index("## Disclaimer")]
    assert "`" not in entry and "Join sales.store_id to stores." in entry
