"""REQ-175 (Amr, 2026-11-13, option 10B): a use case name is a plain verb-led phrase of 2 to 6 words in Title Case. It carries no
technique, no "using" and no value tail. The technique and the outcome go in the subtitle. A Data Filter label goes into the name
only when it is 1 or 2 words; a longer label goes to the subtitle. A name the person typed (user_use_case_name) is never rewritten."""
import pytest

from v120_gate_recalibration_test import make


def _issues(agent_ns, name, technique=""):
    return make(agent_ns)._use_case_name_issues({"Name": name, "Analytics Technique": technique})


@pytest.mark.parametrize("name", [
    "Predict Customer Churn in Each Region",
    "Predict Customer Churn",
    "Detect Fraud Patterns",
    "Forecast Inventory Demand",
    "Classify Customer Segments",
    "Predict Equipment Failure",
])
def test_a_plain_verb_led_name_of_two_to_six_words_passes(agent_ns, name):
    assert _issues(agent_ns, name) == []


def test_predict_and_detect_are_allowed_as_the_first_word(agent_ns):
    assert not {i.split(":")[0] for i in _issues(agent_ns, "Predict Equipment Failure")} & {"method_verb", "verb"}
    assert not {i.split(":")[0] for i in _issues(agent_ns, "Detect Fraud Patterns")} & {"method_verb", "verb"}


def test_a_seven_word_name_is_refused_on_word_count(agent_ns):
    assert "words:7" in _issues(agent_ns, "Predict Customer Churn in Each Region Monthly")


def test_a_one_word_name_is_refused_on_word_count(agent_ns):
    assert "words:1" in _issues(agent_ns, "Churn")


def test_using_is_refused_in_the_name(agent_ns):
    assert "using" in _issues(agent_ns, "Set Store Orders Using Forecasting")


def test_a_technique_word_in_the_name_is_refused(agent_ns):
    assert any(i.startswith("technique:") for i in _issues(agent_ns, "Set Store Orders Using Forecasting", "Forecasting"))


def test_a_value_tail_is_refused(agent_ns):
    assert "value_lever" in _issues(agent_ns, "Grow Revenue to Protect Margin")


def test_a_lower_case_word_in_the_name_is_refused_because_the_name_must_be_title_case(agent_ns):
    assert any(i.startswith("case:") for i in _issues(agent_ns, "Predict customer Churn"))


def test_the_old_five_word_minimum_no_longer_refuses_a_short_name(agent_ns):
    assert "words:3" not in _issues(agent_ns, "Predict Customer Churn")


def test_the_label_goes_into_the_name_when_it_is_one_or_two_words(agent_ns):
    insert = agent_ns["insert_label_into_name"]
    assert insert("Predict Customer Churn", "Contoso") == "Predict Contoso Customer Churn"
    assert insert("Churn", "Tokyo") == "Tokyo Churn"


def test_a_label_of_three_words_never_goes_into_the_name(agent_ns):
    assert agent_ns["insert_label_into_name"]("Predict Customer Churn", "Contoso Export Group") == "Predict Customer Churn"


def test_a_label_that_would_push_the_name_past_six_words_goes_to_the_subtitle(agent_ns):
    name = "Predict Customer Churn in Each Region"
    assert agent_ns["insert_label_into_name"](name, "Contoso") == name


def test_the_name_is_the_name_alone_with_no_using_tail(agent_ns):
    obj = make(agent_ns)
    uc = {"Name": "Predict Customer Churn", "Analytics Technique": "Predictive Modeling"}
    assert obj._inspire_name_with_technique(uc) == "Predict Customer Churn"


def test_the_subtitle_carries_the_outcome_the_technique_and_the_scope_when_the_name_lacks_it(agent_ns):
    obj = make(agent_ns)
    uc = {"Name": "Predict Customer Churn", "Analytics Technique": "Predictive Modeling",
          "Statement": "Churn costs the business money each month. More detail follows.", "scope_label": "Contoso Export Group"}
    subtitle = obj._inspire_subtitle(uc)
    assert subtitle.startswith("Churn costs the business money each month.")
    assert "Technique: Predictive Modeling." in subtitle
    assert "Scope: Contoso Export Group." in subtitle


def test_the_subtitle_omits_the_scope_when_the_name_already_carries_it(agent_ns):
    obj = make(agent_ns)
    uc = {"Name": "Predict Contoso Customer Churn", "Analytics Technique": "Predictive Modeling",
          "Statement": "Churn costs the business money.", "scope_label": "Contoso"}
    assert "Scope:" not in obj._inspire_subtitle(uc)


def test_a_person_typed_name_is_never_rewritten_by_the_label_step(agent_ns):
    ensure = agent_ns["ensure_data_filter_labels"]
    scopes = {"main.s.orders": {"rows": ["status = 'open'"], "columns": ["order_id"], "source": "main.s.orders"}}
    uc = {"Name": "Predict Customer Churn", "user_use_case_name": "My own words for churn", "Primary Table": "main.s.orders"}
    stats = ensure([uc], lambda _uc: [], "Contoso", scopes, reask=None)
    assert uc["Name"] == "Predict Customer Churn" and uc["user_use_case_name"] == "My own words for churn"
    assert stats["kept_user_named"] == 1


def test_a_name_over_six_words_is_shortened_when_the_re_ask_gives_nothing_usable(agent_ns):
    ensure_lengths = agent_ns["ensure_name_lengths"]
    uc = {"Name": "Predict Customer Churn in Each Region Every Single Month", "Primary Table": "main.s.orders"}
    stats = ensure_lengths([uc], reask=lambda misses: [None] * len(misses))
    assert len(uc["Name"].split()) <= 6
    assert stats["shortened"] == 1


def test_a_person_typed_name_is_never_shortened(agent_ns):
    ensure_lengths = agent_ns["ensure_name_lengths"]
    typed = "A very long name the person typed themselves for this use case today"
    uc = {"Name": "Predict Customer Churn", "user_use_case_name": typed}
    ensure_lengths([uc], reask=lambda misses: [None] * len(misses))
    assert uc["user_use_case_name"] == typed


def _source(agent_ns):
    import json
    import os
    here = os.path.dirname(os.path.abspath(__file__))
    notebook = os.path.join(os.path.dirname(os.path.dirname(here)), "agent", "dbx_inspire_ai_agent.ipynb")
    with open(notebook, encoding="utf-8") as handle:
        return "".join(json.load(handle)["cells"][1]["source"])


def test_the_tracking_table_carries_a_subtitle_column_next_to_the_name(agent_ns):
    source = _source(agent_ns)
    assert '("subtitle", "subtitle", "text")' in source
    assert 'row_uc["subtitle"] = self._inspire_subtitle(row_uc)' in source


def test_the_document_description_column_is_the_subtitle(agent_ns):
    assert "self._inspire_subtitle(uc, t, language)" in _source(agent_ns)


def test_the_pdf_card_deck_and_markdown_show_the_subtitle_under_the_title(agent_ns):
    """REQ-175: the view feeds the PDF card, the deck slide and the markdown; each one shows the subtitle, not the name."""
    source = _source(agent_ns)
    assert '(f\'<div class="sub"{bidi(view["subtitle"])}>{text(view["subtitle"])}</div>\' if view["subtitle"] else "")' in source
    assert 'deck.text(slide, 1.6, 1.36, 11.13, 0.28, view["subtitle"], size=S["body"], color=C["muted"])' in source
    assert 'md_content.append(f"\\n*{iso(view[\'subtitle\'])}*\\n")' in source
    assert 'view["name"]' not in source, "no view reads the name as a sub-line any more"
