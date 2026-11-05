import types

import pytest

from v120_artifacts_support import make_inspire, make_uc

FRAGMENT = "and cut waste from over-baking (producing more baked goods than sell)."
WIDGET = f"Grow sales per franchise location, {FRAGMENT}"
DROPPED = "Correct Weekly Sales Slippage to Protect Revenue"


@pytest.fixture
def docs(agent_ns, monkeypatch):
    cls = agent_ns["DatabricksInspire"]
    monkeypatch.setattr(agent_ns["workspace"], "ImportFormat", types.SimpleNamespace(AUTO="AUTO"), raising=False)
    monkeypatch.setattr(cls, "_DOC_FONT_FILES", {}, raising=False)
    return agent_ns


def labels(ns):
    return dict(ns["TranslationService"].ENGLISH_TRANSLATIONS)


def test_a_priority_the_user_wrote_with_a_comma_stays_one_whole_phrase(agent_ns):
    split = agent_ns["inspire_priority_list"]
    assert split(WIDGET) == [WIDGET]
    assert FRAGMENT not in split(WIDGET)


def test_separate_priorities_still_split_and_lists_keep_each_entry(agent_ns):
    split = agent_ns["inspire_priority_list"]
    assert split("Increase Revenue,Reduce Cost") == ["Increase Revenue", "Reduce Cost"]
    assert split("Increase Revenue, Reduce Cost (fuel, labour), Increase Revenue") == ["Increase Revenue", "Reduce Cost (fuel, labour)"]
    assert split(f'["{WIDGET}", "Reduce Cost"]') == [WIDGET, "Reduce Cost"]
    assert split([WIDGET, " ", "Reduce Cost"]) == [WIDGET, "Reduce Cost"]
    assert split("- Grow margin\n- Cut churn") == ["Grow margin", "Cut churn"]
    assert split("") == [] and split(None) == []


def test_the_widget_value_reaches_the_agent_as_whole_priorities(agent_ns):
    from _agentload import agent_source
    src = agent_source()
    assert "inspire_priority_list(business_priorities_raw)" in src
    assert "business_priorities_raw.split(',')" not in src


def test_alignment_tags_come_from_whole_priorities(agent_ns):
    from v130_strategy_alignment_test import harness
    obj = harness(agent_ns, tree={"source": "builtin", "priorities": []})
    obj.merged_business_context = {"business_context": "A bakery", "business_priorities": WIDGET}
    priorities = obj._alignment_context(obj.strategy_tree)["priorities"]
    assert [p if isinstance(p, str) else p.get("name") for p in priorities] == [WIDGET]


def _summary(docs, reply, cases, language="English"):
    seen = []

    def run_worker(step_name, worker_prompt_path, prompt_vars, response_schema, **kw):
        seen.append(prompt_vars)
        return reply
    obj = make_inspire(docs, ai_agent=types.SimpleNamespace(run_worker=run_worker))
    obj._get_generation_instruction_for_prompt = lambda name: ""
    summary, _ = obj._get_salesy_summary({"Sales": cases}, "Acme", language, labels(docs))
    return obj, summary, seen


def _row(text):
    return f'"Type","Summary","TransliteratedBusinessName"\n"Executive","{text}","Acme"\n'


def test_the_summary_names_only_use_cases_in_the_final_catalog(docs):
    shown = make_uc("N01-U01", "Sales", Name="Forecast daily demand per product", usecase="Forecast Product Demand to Cut Waste")
    reply = _row(f"<p>Acme sells fresh goods daily. Forecast Product Demand to Cut Waste sets the bake plan. "
                 f"{DROPPED} recovers lost sales.</p><p>The portfolio spans one domain.</p>")
    obj, summary, seen = _summary(docs, reply, [shown])
    text = summary["Executive"]
    assert DROPPED not in text
    assert "Forecast daily demand per product sets the bake plan." in text
    assert "Forecast Product Demand to Cut Waste" not in text
    assert "Acme sells fresh goods daily." in text and "<p>The portfolio spans one domain.</p>" in text
    assert "Forecast daily demand per product" in seen[0]["domain_use_case_highlights"]
    assert obj.logger.matching("[SUMMARY-NAMES FIRED]", level="WARNING")


def test_a_summary_that_names_catalog_use_cases_is_kept_verbatim(docs):
    shown = make_uc("N01-U01", "Sales", Name="Correct weekly sales slippage to protect revenue")
    text = f"<p>{DROPPED} keeps weekly targets on track. From Data to Decisions is the theme.</p>"
    obj, summary, _ = _summary(docs, _row(text), [shown])
    assert summary["Executive"] == text
    assert not obj.logger.matching("[SUMMARY-NAMES FIRED]", level="WARNING")


def test_a_paragraph_left_empty_is_removed_and_markup_outside_paragraphs_is_untouched(docs):
    shown = make_uc("N01-U01", "Sales", Name="Forecast daily demand per product")
    text = f"<p>{DROPPED} recovers lost sales.</p><ul><li>{DROPPED}</li></ul><p>Acme bakes daily.</p>"
    _, summary, _ = _summary(docs, _row(text), [shown])
    assert summary["Executive"] == f"<ul><li>{DROPPED}</li></ul><p>Acme bakes daily.</p>"


def test_other_languages_get_catalog_names_without_english_sentence_checks(docs):
    shown = make_uc("N01-U01", "Ventes", Name="Prévoir la demande", usecase="Prevoir La Demande to Cut Waste")
    text = "<p>Prevoir La Demande to Cut Waste réduit le gaspillage. Autre Cas to Protect Revenue aussi.</p>"
    _, summary, _ = _summary(docs, _row(text), [shown], language="French")
    assert summary["Executive"] == "<p>Prévoir la demande réduit le gaspillage. Autre Cas to Protect Revenue aussi.</p>"
