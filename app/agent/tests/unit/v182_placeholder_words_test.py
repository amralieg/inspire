import json
import os
import re

from v120_artifacts_support import make_inspire, make_uc
from v120_docs_consistency_test import expected_views
from v120_docs_design_test import LANGUAGES, captured_html, deck, docs, labels, pdf_html, slide_texts, summary  # noqa: F401

FIXTURE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures", "placeholder_words_cases.json")
with open(FIXTURE, encoding="utf-8") as handle:
    CASES = json.load(handle)
LEFTOVER = re.compile(CASES["leftover_tag"], re.I)
KEY_RESULT = "Raise weekly orders from [BASELINE] to [TARGET] within [WINDOW]"
TAGGED = {
    "Statement": "Planners miss demand swings, [ASSUMPTION: weekly review cadence]",
    "Solution": "Forecast weekly orders and flag gaps of [ESTIMATE: depends on orders.amount]",
    "Business Value": "Cuts stockouts from [BASELINE:K1] once [MISSING_DATA: supplier lead times] is loaded",
    "Expected Key Results": [{"id": None, "statement": KEY_RESULT, "source": "proposed"}],
    "Measures of Success": ["Stockouts down from [BASELINE] to [TARGET]"],
    "Financial Benefits": ["Margin driven by `price` from [BASELINE:K1], [ASSUMPTION: uplift to be agreed with the sponsor]"],
    "Non-Financial Benefits": ["Fewer late orders within [WINDOW]"],
    "Sponsor": "[ASSUMPTION inferred from the business name 'Acme' only, not evidenced by the metadata] COO",
}


def test_the_agent_words_every_placeholder_like_the_shared_cases(agent_ns):
    words = agent_ns["inspire_placeholder_words"]
    for case in CASES["cases"]:
        assert words(case["text"]) == case["words"], case["text"]
        assert not LEFTOVER.search(words(case["text"])), case["text"]
    unset = agent_ns["_PLACEHOLDER_UNSET_TARGET_RE"]
    assert [bool(unset.search(c["text"])) for c in CASES["unset_target"]] == [c["unset"] for c in CASES["unset_target"]]
    assert [words(v) for v in (0, 0.0, False, None, "")] == ["0", "0.0", "False", "", ""], "a zero score or a false flag is a value, only nothing is empty"


def test_a_key_result_whose_target_the_sponsor_has_not_set_is_no_target_and_never_a_raw_tag(agent_ns):
    kpi = {"name": "Weekly orders", "kpi_id": None, "direction": "increase", "unit": "", "computable": False}
    assert agent_ns["implement_kpi_target"](kpi, [{"statement": KEY_RESULT}]) == (None, "")
    record = agent_ns["implement_tracked_kpi"](kpi, "inspire", "inspire", [{"statement": KEY_RESULT}])
    assert (record["target"], record["target_text"]) == (None, "")
    worded = agent_ns["implement_tracked_kpi"](kpi, "inspire", "inspire",
                                               [{"statement": "Grow weekly orders from [BASELINE: measured by the KPI query] steadily"}])
    assert worded["target_text"] == "Grow weekly orders from the current value (measured by the KPI query) steadily"
    assert agent_ns["implement_kpi_target"](kpi, [{"statement": "Raise weekly orders to 4,500 within [WINDOW]"}])[0] == 4500.0


def test_the_app_promise_reads_in_plain_words(agent_ns):
    promised = agent_ns["implement_promised"](make_uc("N01-U01", **TAGGED))
    assert promised["value"] == "Cuts stockouts from the current value once (missing data: supplier lead times) is loaded"
    assert promised["benefits"] == ["Margin driven by price from the current value, (assumption: uplift to be agreed with the sponsor)"]


def test_no_document_notebook_or_export_shows_a_raw_placeholder_tag(docs):
    obj = make_inspire(docs)
    uc = make_uc("N01-U01", **TAGGED)
    rendered = []
    for source, kind in (("Expected Key Results", "key_results"), ("Measures of Success", "lines"), ("Financial Benefits", "lines"),
                         ("Non-Financial Benefits", "lines")):
        rendered += obj._use_case_items(uc, source, kind, {}, "English")[0]
    _model, views = expected_views(obj, docs, {"Sales": [uc]})
    view = views[0]
    rendered += [str(value) for _key, _label, value in view["narrative"] + view["facts"]]
    rendered += [str(value) for _key, _label, value in view["value_facts"]]
    rendered += [str(getter(uc, 1)) for _header, getter, _numeric in obj._export_columns(False, True)]
    rendered += obj._build_use_case_details_markdown_source(uc) + [obj._genie_kpi_source(uc)]
    leaks = [text for text in rendered if LEFTOVER.search(text)]
    assert not leaks, leaks
    assert "Stockouts down from the current value to a target the sponsor sets" in rendered
    assert any("(assumption: inferred from the business name 'Acme' only, not evidenced by the metadata) COO" in t for t in rendered)


def test_the_pdf_the_deck_the_markdown_and_the_csv_catalog_never_show_a_raw_placeholder_tag(docs, captured_html):
    grouped = {"Sales": [make_uc("N01-U01", **TAGGED)]}
    _obj, page = pdf_html(docs, captured_html, grouped, summary())
    _deck_obj, prs = deck(docs, grouped, summary())
    md_obj = make_inspire(docs)
    md_obj._generate_markdown_catalog("English", "en", grouped, summary(), "Acme")
    csv_obj = make_inspire(docs)
    csv_obj._generate_csv_catalog("English", "en", grouped)
    written = {"pdf": page, "deck": " | ".join(slide_texts(prs))}
    written.update((f"md:{name}", body.decode("utf-8")) for name, body in md_obj.w_client.workspace.files.items())
    written.update((f"csv:{name}", body.decode("utf-8-sig")) for name, body in csv_obj.w_client.workspace.files.items())
    assert any(name.startswith("md:") for name in written) and any(name.startswith("csv:") for name in written), list(written)
    for name, text in written.items():
        assert not LEFTOVER.search(text), (name, LEFTOVER.search(text).group(0))
        assert "a target the sponsor sets" in text, name


def test_documents_in_other_languages_word_the_placeholders_in_that_language(docs):
    ts, obj = docs["TranslationService"], make_inspire(docs)
    keys = docs["INSPIRE_PLACEHOLDER_WORDS"]
    for language in LANGUAGES[1:]:
        table = ts.TRANSLATION_FALLBACKS[language]
        for key, english in keys.items():
            assert ts.ENGLISH_TRANSLATIONS[key] == english
            assert str(table.get(key) or "").strip() and table[key] != english, (language, key)
            assert ("{detail}" in table[key]) == ("{detail}" in english), (language, key)
    items = obj._use_case_items(make_uc("N01-U01", **TAGGED), "Measures of Success", "lines", labels(docs, "Arabic"), "Arabic")[0]
    assert items == ["Stockouts down from القيمة الحالية to هدف يحدده الراعي"]
