import pytest

from v146_ai_reasoning_test import _ai
from v142_scd_test import TABLE
from v164_settings_decisions_test import SHARED, _ranked, _sqlite

STRUCTURED = ("headline", "what", "why", "do")


def _cuts(ns, passed, act, review):
    value = {"passed": passed, "shares": {"act_now_share": str(act), "review_share": str(review)}}
    return ns["inspire_share_cuts"](value)


@pytest.mark.parametrize("passed,expected", [(100, (20, 100)), (40, (8, 40)), (10, (3, 10)), (5, (3, 5)), (3, (3, 3)), (1, (1, 1)),
                                             (15, (3, 15)), (21, (5, 21))])
def test_a_full_flagged_share_acts_on_at_most_the_larger_of_three_and_a_fifth(agent_ns, passed, expected):
    assert _cuts(agent_ns, passed, 1.0, 0.0) == expected
    assert _cuts(agent_ns, passed, 0.5, 0.5) == (min(expected[0], passed // 2), passed), \
        "the cap only lowers the Act now share; every row stays flagged"


@pytest.mark.parametrize("passed,act,review,expected", [(100, 0.1, 0.2, (10, 30)), (10, 0.2, 0.3, (2, 5)), (100, 0.05, 0.9, (5, 95)),
                                                        (0, 0.5, 0.5, (0, 0))])
def test_a_lower_flagged_share_keeps_the_share_rule(agent_ns, passed, act, review, expected):
    assert _cuts(agent_ns, passed, act, review) == expected


def test_the_run_check_follows_the_capped_act_now_rule(agent_ns):
    value = dict(SHARED, passed=20, shares={"act_now_share": "0.6", "review_share": "0.4"})
    assert agent_ns["inspire_share_cuts"](value) == (4, 20)
    columns = list(_ranked(20, (4, 20))[0])
    good = _ranked(20, (4, 20))
    profile = _sqlite(agent_ns["inspire_run_profile_sql"]("c.s.stage", columns, value), good)
    assert int(profile["off_share_tier"]) == 0
    old = _ranked(20, (12, 20))
    profile = _sqlite(agent_ns["inspire_run_profile_sql"]("c.s.stage", columns, value), old)
    assert int(profile["off_share_tier"]) == 8, "a 100% flagged run that acts on 12 of 20 is refused"


def test_the_explanation_gains_a_headline_what_why_and_do(agent_ns):
    ai = _ai(agent_ns)
    names = [n for n, _k in agent_ns["inspire_ai_columns"](ai)]
    for key in STRUCTURED:
        assert f"ai_{key}" in names and f"ai_{key}" in agent_ns["INSPIRE_AI_NAMES"]
    assert "explanation" in [k for k, _c in agent_ns["INSPIRE_AI_TEXTS"]], "the long paragraph stays"
    prompt = ai["prompt"]
    assert '"headline": at most 12 words' in prompt
    for key in ("what", "why", "do"):
        assert f'"{key}": one plain sentence' in prompt, key
    assert "no number from the facts more than once across headline, what, why and do" in prompt
    update = agent_ns["inspire_ai_update_sql"](TABLE, "_s", ai)
    flag = agent_ns["inspire_ai_flag_sql"](TABLE, "_s", ai)
    for key in STRUCTURED:
        assert f"`ai_{key}` = c.`ai_{key}`" in update and f"`ai_{key}` = NULL" in flag, key
    checked = agent_ns["inspire_ai_checked_sql"](TABLE, "_s", ai)
    for key in STRUCTURED:
        assert f"{key} STRING" in checked and f"trim(b.ai_json.{key}) AS `ai_{key}`" in checked, key


def test_the_structured_text_is_checked_for_length_sentences_and_repeated_numbers(agent_ns):
    checks = {label: (test, detail) for label, test, detail in agent_ns["inspire_ai_checks"](_ai(agent_ns))}
    for key in STRUCTURED:
        assert f"no {key}" in checks and f"hedged {key}" in checks, key
    test, _detail = checks["headline over 12 words"]
    assert "ai_headline" in test and "12" in test
    for key in ("what", "why", "do"):
        test, _detail = checks[f"{key} is not one sentence"]
        assert f"ai_{key}" in test
    test, detail = checks["number repeated across headline, what, why and do"]
    for key in STRUCTURED:
        assert f"ai_{key}" in test, key
    sqlglot = pytest.importorskip("sqlglot")
    sqlglot.parse_one(agent_ns["inspire_ai_checked_sql"](TABLE, "_s", _ai(agent_ns)), read="databricks")
