"""rc.2 (REQ-165): the quality-bar count reads one way in the agent's messages, the Monitor headline and the documents.

The wording is "M of N use cases meet the <mode> quality bar", built by one helper (_quality_bar_count_text), the twin of
qualityBarCountText in the Inspire App's frontend.
"""
import re

import pytest

from v120_artifacts_support import make_inspire
from v201_below_bar_kept_test import _inspire
from v201_below_bar_kept_test import _uc as _below_uc


def _uc(no, meets):
    return {"No": no, "Name": f"Use case {no}", "Quality": "High", "Primary Table": "",
            "meets_quality_bar": "Y" if meets else "N",
            "elite_status": "" if meets else "FALLBACK_BELOW_BAR",
            "fallback_reason": "" if meets else "its main table has no rows yet; Relevance check"}


def _record(agent_ns, mode, meets, below):
    obj = make_inspire(agent_ns, use_cases_quality=mode, discovery_evidence={"profiles": {}})
    obj._emit_pipeline_status = lambda **kw: None
    obj._record_quality_bar_outcome(mode, [_uc(f"M{i}", True) for i in range(meets)] + [_uc(f"B{i}", False) for i in range(below)])
    return obj


def test_helper_builds_the_one_wording(agent_ns):
    count_text = agent_ns["DatabricksInspire"]._quality_bar_count_text
    assert count_text(6, 3, "High") == "3 of 6 use cases meet the High quality bar"
    assert count_text(6, 0, "Good") == "0 of 6 use cases meet the Good quality bar"
    assert count_text(6, 3) == "3 of 6 use cases meet the quality bar"
    assert count_text(1, 1, "Good") == "1 of 1 use case meets the Good quality bar"
    assert count_text(1, 0, "Good") == "0 of 1 use case meets the Good quality bar"


@pytest.mark.parametrize("meets, below, opening", [
    (3, 3, "3 of 6 use cases meet the High quality bar"),
    (0, 6, "0 of 6 use cases meet the High quality bar. Here is what we found"),
])
def test_outcome_message_uses_the_count_wording(agent_ns, meets, below, opening):
    obj = _record(agent_ns, "High", meets, below)
    assert obj.quality_bar_outcome["message"].startswith(opening), obj.quality_bar_outcome["message"]


def test_single_use_case_reads_in_the_singular(agent_ns):
    obj = _record(agent_ns, "High", 0, 1)
    assert obj.quality_bar_outcome["message"].startswith("0 of 1 use case meets the High quality bar.")


def test_monitor_headline_uses_the_count_wording(agent_ns):
    obj = _record(agent_ns, "High", 0, 6)
    assert obj._quality_bar_warning() == "0 of 6 use cases meet the High quality bar"


def test_document_notices_use_the_count_wording(agent_ns):
    english = agent_ns["TranslationService"].ENGLISH_TRANSLATIONS
    assert english["doc_bar_partial_notice"].format(meets=3, total=6, mode="High").startswith(
        "3 of 6 use cases meet the High quality bar. They come first")
    assert english["doc_fallback_notice"].format(total=6, mode="High").startswith(
        "0 of 6 use cases meet the High quality bar. Here is what we found")


COUNT_KEYS = ("doc_fallback_notice", "doc_fallback_notice_one", "doc_bar_partial_notice")


def _placeholders(text):
    return sorted(re.findall(r"\{[a-z_]+\}", text))


def test_every_curated_language_carries_the_count_templates_with_the_english_placeholders(agent_ns):
    ts = agent_ns["TranslationService"]
    languages = sorted(ts.TRANSLATION_FALLBACKS)
    assert len(languages) == 22
    for language in languages:
        table = ts.TRANSLATION_FALLBACKS[language]
        for key in COUNT_KEYS:
            assert table[key].strip(), (language, key)
            assert _placeholders(table[key]) == _placeholders(ts.ENGLISH_TRANSLATIONS[key]), (language, key)


def test_one_use_case_reads_in_the_singular_in_english_and_every_curated_language(agent_ns):
    obj = _inspire(agent_ns)
    ts = agent_ns["TranslationService"]
    one = [_below_uc("M0", "Medium", elite_status="FALLBACK_BELOW_BAR", quality_mode="High")]
    assert obj._quality_bar_notice(one, {}, "English").startswith("0 of 1 use case meets the")
    for language in sorted(ts.TRANSLATION_FALLBACKS):
        notice = obj._quality_bar_notice(one, {}, language)
        prefix = ts.TRANSLATION_FALLBACKS[language]["doc_fallback_notice_one"].split("{mode}")[0]
        assert notice.startswith(prefix), (language, notice)
        assert "{" not in notice, (language, notice)


def test_several_use_cases_below_the_bar_read_in_the_plural(agent_ns):
    obj = _inspire(agent_ns)
    two = [_below_uc("M0", "Medium", elite_status="FALLBACK_BELOW_BAR", quality_mode="High"),
           _below_uc("M1", "Medium", elite_status="FALLBACK_BELOW_BAR", quality_mode="High")]
    assert obj._quality_bar_notice(two, {}, "English").startswith("0 of 2 use cases meet the High quality bar.")
    assert "{" not in obj._quality_bar_notice(two, {}, "German")
