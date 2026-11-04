"""v1.3.1-rc.4 English + Arabic run: the Arabic Best of Best columns had loose headers and 3 reasons kept English codes.

The UI labels came from an LLM that translates a flat key/value list with no context, and its answer beat the
reviewed per-language labels: "Best of Best" became "أفضل الأفضل" and "Best of Best Reason" became "أفضل سبب".
The reasons listed raw check codes (`score:business_value, judge_verdict, second_opinion_reject`), so the
translated reason stayed mostly ASCII and was flagged as untranslated. These tests pin: a language with
reviewed labels uses them for every header, each check code is shown after its readable name, and a
translated reason that keeps the codes in parentheses counts as translated.
"""
import re
import types

import pytest

from _agentload import agent_source
from v120_artifacts_support import CapturingLogger, make_inspire, make_uc

BOB_KEYS = ("doc_best_of_best", "doc_best_of_best_reason", "doc_bob_score")
LOOSE = {"doc_best_of_best": "أفضل الأفضل", "doc_best_of_best_reason": "أفضل سبب", "doc_bob_score": "أفضل نقاط"}


def _languages(ns):
    return sorted(ns["TranslationService"].TRANSLATION_FALLBACKS)


def _loose_llm(ns):
    calls = []

    def run_worker(step_name, worker_prompt_path, prompt_vars, response_schema=None, skip_cache=False, **kw):
        import json
        calls.append(step_name)
        return json.dumps(dict(json.loads(prompt_vars["json_payload"]), **LOOSE), ensure_ascii=False)
    return types.SimpleNamespace(run_worker=run_worker), calls


def test_every_curated_language_covers_every_label(agent_ns):
    ts = agent_ns["TranslationService"]
    assert len(_languages(agent_ns)) == 22
    for language in _languages(agent_ns):
        assert ts._curated_ui_translations(language) is not None, language
    assert ts._curated_ui_translations("Thai") is None


@pytest.mark.parametrize("language", ["Arabic", "Spanish", "French", "German", "Portuguese", "Italian", "Chinese (Mandarin)",
                                      "Japanese", "Korean", "Hindi", "Russian", "Swedish", "Danish", "Norwegian", "Finnish",
                                      "Polish", "Romanian", "Ukrainian", "Dutch", "Indonesian", "Malay", "Tamil"])
def test_the_best_of_best_headers_use_the_reviewed_label_whatever_the_llm_answers(agent_ns, language):
    ts = agent_ns["TranslationService"]
    curated = ts.TRANSLATION_FALLBACKS[language]
    agent, calls = _loose_llm(agent_ns)
    labels = ts(agent, CapturingLogger()).get_translations(language)
    assert calls == []
    for key in BOB_KEYS:
        assert labels[key] == curated[key] != ts.ENGLISH_TRANSLATIONS[key], (language, key)
        assert "Best-of-Best" not in curated[key] and "Best of Best" not in curated[key], (language, key)
    obj = make_inspire(agent_ns, output_languages=["English", language])
    headers = [header for header, _get, _numeric in obj._export_columns(False, False, labels, language)]
    assert curated["doc_best_of_best"] in headers and curated["doc_best_of_best_reason"] in headers
    assert not set(LOOSE.values()) & set(headers)


def test_arabic_best_of_best_labels_share_one_term(agent_ns):
    arabic = agent_ns["TranslationService"].TRANSLATION_FALLBACKS["Arabic"]
    assert arabic["doc_best_of_best"] == "الأفضل بين الأفضل"
    assert arabic["doc_best_of_best_reason"] == "سبب الأفضل بين الأفضل"
    assert arabic["doc_bob_score"] == "درجة الأفضل بين الأفضل"


def test_reviewed_labels_win_over_the_llm_answer_for_every_key_they_cover(agent_ns):
    ts = agent_ns["TranslationService"]
    svc = ts(types.SimpleNamespace(run_worker=None), CapturingLogger())
    merged = svc._apply_translation_fallbacks(dict(ts.ENGLISH_TRANSLATIONS, **LOOSE), "Arabic")
    assert {key: merged[key] for key in BOB_KEYS} == {key: ts.TRANSLATION_FALLBACKS["Arabic"][key] for key in BOB_KEYS}
    assert svc._apply_translation_fallbacks(dict(LOOSE), "Thai") == LOOSE


def test_a_language_without_reviewed_labels_still_asks_the_llm(agent_ns):
    agent, calls = _loose_llm(agent_ns)
    svc = agent_ns["TranslationService"](agent, CapturingLogger())
    svc._validate_translations = lambda translations, language: True
    labels = svc.get_translations("Thai")
    assert len(calls) == 1 and labels["doc_best_of_best"] == LOOSE["doc_best_of_best"]


def _failed_gate_codes():
    source = agent_source()
    codes = set(re.findall(r'failed\.append\("([^"]+)"\)', source))
    codes |= set(re.findall(r'\+ \["(second_opinion_[a-z_]+)"\]', source))
    codes |= set(re.findall(r'_record_gate_exception\("([^"]+)"', source))
    codes |= set(re.findall(r'\("(G2_[a-z_]+)", lambda', source))
    return codes


def test_every_check_code_the_pipeline_can_report_has_a_readable_name(agent_ns):
    names = agent_ns["INSPIRE_GATE_NAMES"]
    codes = _failed_gate_codes()
    assert {"verification", "red_team", "value_tier", "judge_verdict", "second_opinion_reject",
            "second_opinion_average_below_bar", "second_opinion_unavailable", "second_opinion_unjudged", "Q1", "Q5",
            "SPONSOR_CANONICAL", "G2_column_grounding"} <= codes
    codes |= {f"score:{d}" for d in agent_ns["ULTRA_HIGH_DIMENSIONS"]}
    codes |= set(agent_ns["ULTRA_HIGH_FATAL_FLAW_CATEGORIES"]) | {agent_ns["ULTRA_HIGH_RESIDUAL_RISK"]}
    codes |= {f"D{i}" for i in range(1, 20)}
    assert sorted(codes - set(names)) == []


def test_the_quality_gate_names_match_the_scoring_prompt(agent_ns):
    source = agent_source()
    section = source[source.index("## The 19 gates (D1-D19)"):]
    listed = dict(re.findall(r"^- (D\d+) ([^:\n]+?)(?::|\s+\()", section[:section.index("- D19 ") + 200], re.M))
    assert {code: listed.get(code) for code in agent_ns["INSPIRE_QUALITY_GATE_NAMES"]} == agent_ns["INSPIRE_QUALITY_GATE_NAMES"]


def test_a_check_code_is_shown_after_its_name_and_an_unknown_code_is_kept(agent_ns):
    label = agent_ns["inspire_gate_label"]
    assert label("score:business_value") == "business value score (score:business_value)"
    assert label("judge_verdict") == "judge verdict (judge_verdict)"
    assert label("D7") == "Design-Schema Match (D7)"
    assert label("NO_DECISION_CHANGED") == "no decision changed (NO_DECISION_CHANGED)"
    assert label("something_new") == "something_new"
    assert label(None) == "" and label("  ") == ""


def test_the_live_reason_names_every_check_it_failed(agent_ns):
    reason = agent_ns["DatabricksInspire"]._elite_drop_reason({
        "failed_gates": ["score:business_value", "score:implementability", "score:actionability", "judge_verdict",
                         "second_opinion_reject"],
        "evidence_repair": {"outcome": "passed"}}, prefix="did not pass: ")
    assert reason == ("did not pass: business value score (score:business_value), implementability score "
                      "(score:implementability), actionability score (score:actionability), judge verdict (judge_verdict), "
                      "second opinion (second_opinion_reject); evidence repair passed")


def test_a_hard_veto_and_an_unverified_gate_name_the_gate(agent_ns):
    source = agent_source()
    assert source.count("f\"hard veto on gate {inspire_gate_label(uc.get('bob_hard_veto_gate'))}\"") == 3
    assert "', '.join(inspire_gate_label(g) for g in uc['gate_unverified'])" in source
    assert "main = inspire_gate_label(failed[0]) if failed else" in source


ARABIC_REASON = ("لم ينجح: درجة قيمة الأعمال (score:business_value)، درجة قابلية التنفيذ (score:implementability)، "
                 "درجة قابلية التطبيق (score:actionability)، حكم المحكّم (judge_verdict)، الرأي الثاني "
                 "(second_opinion_reject)؛ نجح إصلاح الأدلة")


def test_an_arabic_reason_that_keeps_the_codes_in_parentheses_is_translated(agent_ns):
    ts = agent_ns["TranslationService"]
    english = agent_ns["DatabricksInspire"]._elite_drop_reason({
        "failed_gates": ["score:business_value", "score:implementability", "score:actionability", "judge_verdict",
                         "second_opinion_reject"], "evidence_repair": {"outcome": "passed"}}, prefix="did not pass: ")
    assert not ts._looks_untranslated(english, ARABIC_REASON, "Arabic")
    assert ts._looks_untranslated(english, english, "Arabic")
    assert ts._looks_untranslated(english, "لم ينجح: business value score, implementability score, actionability score, "
                                           "judge verdict, second opinion; evidence repair passed", "Arabic")
    assert "score" not in " ".join(ts._english_words("درجة (score:business_value) و (judge_verdict)"))


def test_the_translation_prompt_keeps_check_codes_as_written(agent_ns):
    prompt = agent_ns["PROMPT_TEMPLATES"]["USE_CASE_TRANSLATE_PROMPT"]
    assert "A check code in parentheses right after a check name" in prompt
    assert "translate the check name before it" in prompt


def test_an_arabic_export_shows_the_translated_reason_under_the_reviewed_header(agent_ns):
    ts = agent_ns["TranslationService"]
    labels = ts._curated_ui_translations("Arabic")
    row_uc = make_uc("N09-U23", "المبيعات", Name="توقع الطلب", Subdomain="التخطيط", best_of_best="N",
                     best_of_best_reason=ARABIC_REASON)
    obj = make_inspire(agent_ns, output_languages=["English", "Arabic"])
    obj._normalize_usecase = lambda usecase, name: usecase
    headers, rows, _numeric = obj._catalog_export_table({"المبيعات": [row_uc]}, labels, "Arabic")
    row = dict(zip(headers, rows[0]))
    assert row[labels["doc_best_of_best_reason"]] == ARABIC_REASON
    assert "أفضل سبب" not in headers and "أفضل الأفضل" not in headers
