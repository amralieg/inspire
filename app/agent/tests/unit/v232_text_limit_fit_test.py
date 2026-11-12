"""v2.3.2 A generated text over its length limit never blocks a publish.

A use case whose name carried a long label (the Data Filters label) made the App's page question run past 240 characters, and the
publish stopped after three Genie rounds with "page.json does not fit the App". Genie rounds still run and give better text. After
the last round, Inspire shortens each over-limit text deterministically, keeps the page's labels and quoted values, logs the cut,
and publishes. Texts under their limit are never touched.
"""
import copy
import json
import os
import re
import sys

import pytest

TESTS = os.path.dirname(os.path.abspath(__file__))
if TESTS not in sys.path:
    sys.path.insert(0, TESTS)
SERVER = os.path.join(os.path.dirname(os.path.dirname(TESTS)), "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_sql  # noqa: E402
from v140_implement_test import TRUTH, _app_shell, _output_context, _output_inspire  # noqa: E402
from v230_app_publish_honesty_test import _Log, _page, _run_model  # noqa: E402

LONG_QUESTION = ("Which loss desk records should the team act on first, and why did the churn list change since last week " * 4)[:300]
FORECAST = os.path.join(os.path.dirname(SERVER), "examples", "forecast_cockpit.json")
NOTEBOOK = os.path.join(os.path.dirname(os.path.dirname(TESTS)), "agent", "dbx_inspire_ai_agent.ipynb")


def _forecast():
    with open(FORECAST, encoding="utf-8") as handle:
        return json.load(handle)


def _fill_text_keys(node, text):
    """Replace every string under a key the validators check for length with text, in place."""
    if isinstance(node, dict):
        for key, value in node.items():
            if key in shell_sql.TEXT_FIT_KEYS and isinstance(value, str):
                node[key] = text
            elif key in shell_sql.TEXT_FIT_LISTS and isinstance(value, list):
                node[key] = [text for _ in value]
            else:
                _fill_text_keys(value, text)
    elif isinstance(node, list):
        for item in node:
            _fill_text_keys(item, text)


def _length_problems(page):
    return [p for p in shell_sql.spec_problems(page) if re.search(r"is longer than \d+ characters?$", p)]


def test_a_300_character_question_is_shortened_to_240_ending_with_a_question_mark_not_refused():
    page = _forecast()
    page["question"] = LONG_QUESTION
    assert any("question is longer than 240 characters" in p for p in shell_sql.spec_problems(page)), "the page was refused before"
    cuts = shell_sql.fit_text_limits(page)
    assert cuts == [("question", 300, len(page["question"]))]
    assert len(page["question"]) <= 240 and page["question"].endswith("?")
    assert _length_problems(page) == []


def test_every_text_the_validators_check_for_length_is_shortened_and_none_is_refused():
    page = _forecast()
    _fill_text_keys(page, "word " * 120)
    assert _length_problems(page), "every checked text starts over its limit"
    cuts = shell_sql.fit_text_limits(page)
    assert cuts, "the fit cut the over-limit texts"
    assert _length_problems(page) == []
    assert {field.split(".")[-1].split("[")[0] for field, _was, _now in cuts} >= {"title", "question", "label", "hint"}


@pytest.mark.parametrize("key", sorted(shell_sql.TEXT_LIMITS))
def test_each_text_limit_field_is_shortened_to_its_own_limit(key):
    limit = shell_sql.TEXT_LIMITS[key]
    fitted = shell_sql.fit_text("alpha beta gamma " * 40, limit, question=(key == "question"))
    assert 0 < len(fitted) <= limit
    assert fitted.endswith("?") == (key == "question") and not fitted.endswith(" ")


def test_a_label_of_the_page_inside_a_long_text_is_kept_with_the_words_before_it():
    text = "Size Tokyo Tidbits Revenue Range Under Pricing Review and the weekly tidbit forecast output for the team Data Filters"
    fitted = shell_sql.fit_text(text, 80, labels=("Data Filters",))
    assert fitted.endswith("Data Filters") and len(fitted) <= 80
    assert fitted.startswith("Size Tokyo Tidbits")


def test_a_label_already_inside_the_limit_is_left_where_it_is():
    text = "Size Data Filters Tokyo Tidbits Revenue Range Under Pricing and the weekly tidbit forecast output for the team review"
    fitted = shell_sql.fit_text(text, 80, labels=("Data Filters",))
    assert fitted.startswith("Size Data Filters Tokyo") and len(fitted) <= 80


def test_a_text_under_its_limit_is_untouched_and_logs_nothing():
    page = _forecast()
    page["question"] = "Which tiers act now?"
    page["title"] = "T" * 80
    before = json.dumps(page, sort_keys=True)
    assert shell_sql.fit_text_limits(page) == []
    assert json.dumps(page, sort_keys=True) == before


def test_a_cut_never_lands_inside_a_quoted_value_or_splits_a_number():
    quoted = "Show the " + "Alpha " * 8 + '"Tokyo Tidbits Premium Gold Tier Region" 1234567 revenue for the quarter'
    fitted = shell_sql.fit_text(quoted, 80)
    assert '"' not in fitted and len(fitted) <= 80
    numbered = "Alpha " * 12 + "1234567 end of the list"
    assert shell_sql.fit_text(numbered, 80).split()[-1] in ("Alpha", "1234567")


def test_the_last_genie_round_publishes_a_page_with_a_300_character_question_and_logs_the_cut(agent_ns, tmp_path):
    inst, build = _app_page_build(agent_ns, tmp_path, dict(question=LONG_QUESTION))
    page, _notes = build(3)
    assert len(page["question"]) <= 240 and page["question"].endswith("?")
    assert inst.logger.matching("[TEXT-LIMIT FIRED] question shortened from 300 to "), inst.logger.lines


def test_a_round_that_is_not_the_last_still_sends_the_long_question_back_to_genie(agent_ns, tmp_path):
    inst, build = _app_page_build(agent_ns, tmp_path, dict(question=LONG_QUESTION))
    with pytest.raises(RuntimeError, match=r"page.json does not fit the App: .*question is longer than 240 characters"):
        build(1)
    assert not inst.logger.matching("[TEXT-LIMIT FIRED]"), "Genie gets the first chance to write a shorter question"


def test_the_app_prompt_states_the_question_and_every_other_text_limit_so_genie_aims_for_them():
    with open(NOTEBOOK, encoding="utf-8") as handle:
        text = handle.read()
    assert "question (at most {shell_sql.TEXT_LIMITS['question']} characters, ending with a question mark)" in text
    assert "the other texts have these limits in characters:" in text


def _app_page_build(ns, tmp_path, change):
    inst, _calls = _output_inspire(ns, tmp_path)
    inst.logger = _Log()
    inst._implement_run_query_check = lambda sql, require_rows=False, limit=20: [dict(t) for t in TRUTH]
    inst._implement_latest_run_rows = lambda table: list(TRUTH)
    shell_sql_module = _app_shell(ns, tmp_path)[1]["shell_sql"]
    context = dict(_output_context(ns), asset_status={"settings": _run_model(ns)})
    work = tmp_path / "work"
    work.mkdir()
    (work / ns["IMPLEMENT_APP_PAGE_FILE"]).write_text(json.dumps(dict(copy.deepcopy(_page(ns)), **change)))

    def build(round_no):
        context["genie_round"] = {"name": "app", "round": round_no, "rounds": 3}
        return inst._implement_page_file(context, "app", str(work), shell_sql_module, False)

    return inst, build


LONG_EXPRESSION = "SUM(forecast) + " + " + ".join(f"SUM(plan_{index})" for index in range(60))


def test_a_kpi_over_the_expression_limit_is_dropped_with_a_logged_note_and_the_rest_stay():
    page = _forecast()
    assert len(page["kpis"]) >= 3
    page["kpis"][0]["expression"] = LONG_EXPRESSION
    assert any("expression is longer than 600 characters" in p for p in shell_sql.spec_problems(page))
    notes = shell_sql.drop_long_expressions(page)
    assert len(notes) == 1
    assert re.fullmatch(rf"\[EXPRESSION-LIMIT FIRED\] dropped kpi .+: {len(LONG_EXPRESSION)} characters", notes[0]), notes[0]
    assert all(len(k["expression"]) <= 600 for k in page["kpis"])
    assert not any("expression is longer than 600" in p for p in shell_sql.spec_problems(page))


def test_dropping_a_long_kpi_relaxes_only_the_minimum_kpi_count_by_the_drops():
    page = _forecast()
    floor = shell_sql.CAPS["kpis"][0]
    page["kpis"] = page["kpis"][:floor]
    page["kpis"][0]["expression"] = LONG_EXPRESSION
    assert any("expression is longer than 600" in p for p in shell_sql.spec_problems(page))
    shell_sql.drop_long_expressions(page)
    assert [p for p in shell_sql.spec_problems(page) if "the page has" in p and "kpis" in p] == []


def test_a_chart_over_the_expression_limit_is_dropped_and_its_tables_stay_when_nothing_else_is_left():
    page = _forecast()
    page["kpis"] = []
    page["charts"] = [dict(page["charts"][0], y=[dict(page["charts"][0]["y"][0], expression=LONG_EXPRESSION)])]
    tables = copy.deepcopy(page.get("tables"))
    notes = shell_sql.drop_long_expressions(page)
    assert page["charts"] == [] and page["kpis"] == []
    assert any(note.startswith("[EXPRESSION-LIMIT FIRED] dropped chart ") for note in notes)
    assert any(note == "[EXPRESSION-LIMIT FIRED] no KPI or chart is left, so the page shows its tables" for note in notes)
    assert page.get("tables") == tables


def test_a_single_long_token_with_no_safe_word_cut_is_hard_cut_outside_its_quote():
    token = "x" * 100
    assert shell_sql.fit_text(token, 80) == "x" * 80
    quoted = '"' + "y" * 100 + '"'
    fitted = shell_sql.fit_text(quoted, 80)
    assert len(fitted) <= 80 and '"' not in fitted and fitted == "y" * 80


def test_a_quoted_value_longer_than_the_limit_falls_back_to_a_safe_form_with_a_label_when_there_is_one():
    text = '"' + "z" * 120 + '" Data Filters'
    assert shell_sql.fit_text(text, 80, labels=("Data Filters",)) == "Data Filters"


def test_the_last_round_drops_an_over_limit_kpi_and_publishes_with_the_rest(agent_ns, tmp_path):
    page = _page(agent_ns)
    page["kpis"][0]["expression"] = LONG_EXPRESSION
    inst, build = _app_page_build(agent_ns, tmp_path, dict(kpis=page["kpis"]))
    published, notes = build(3)
    assert len(published["kpis"]) == len(page["kpis"]) - 1
    assert all(len(k["expression"]) <= 600 for k in published["kpis"])
    assert inst.logger.matching("[EXPRESSION-LIMIT FIRED] dropped kpi "), inst.logger.lines
    assert any("[EXPRESSION-LIMIT FIRED] dropped kpi " in str(n) for n in notes)


def test_a_round_that_is_not_the_last_still_sends_the_long_kpi_back_to_genie(agent_ns, tmp_path):
    page = _page(agent_ns)
    page["kpis"][0]["expression"] = LONG_EXPRESSION
    inst, build = _app_page_build(agent_ns, tmp_path, dict(kpis=page["kpis"]))
    with pytest.raises(RuntimeError, match="expression is longer than 600 characters"):
        build(1)
    assert not inst.logger.matching("[EXPRESSION-LIMIT FIRED]")
