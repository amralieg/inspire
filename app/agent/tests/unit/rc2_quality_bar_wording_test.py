"""rc.2 (REQ-165): the quality-bar count reads one way in the agent's messages, the Monitor headline and the documents.

The wording is "M of N use cases meet the <mode> quality bar", built by one helper (_quality_bar_count_text), the twin of
qualityBarCountText in the Inspire App's frontend.
"""
import pytest

from v120_artifacts_support import make_inspire


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
