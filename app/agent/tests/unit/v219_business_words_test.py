import re

import pytest

SYMBOLS = re.compile(r"(>=|<=|!=|(?<![-\w])[<>=](?![-\w])|\bmean [+-] )")
WORDS = {">=": "at least", ">": "more than", "=": "equal to", "!=": "not equal to", "<": "less than", "<=": "at most"}


@pytest.mark.parametrize("operator", list(WORDS))
def test_an_alert_rule_says_its_comparison_in_words_for_every_operator(agent_ns, operator):
    outputs = {"alert_operator": operator, "alert_threshold": 4}
    trigger = agent_ns["implement_alert_trigger_text"](outputs)
    assert trigger == f"Act now rows in the latest run are {WORDS[operator]} 4"
    reason = agent_ns["implement_alert_threshold_reason"](outputs)
    assert reason == f"Act now rows are {WORDS[operator]} 4, the number set in the wizard."
    assert not SYMBOLS.search(trigger) and not SYMBOLS.search(reason)


@pytest.mark.parametrize("operator", [">=", ">", "<=", "<"])
def test_a_baseline_alert_says_plus_or_minus_and_its_fallback_rule_in_words(agent_ns, operator):
    outputs = {"alert_operator": operator, "alert_threshold": 2, "alert_threshold_basis": "baseline"}
    trigger = agent_ns["implement_alert_trigger_text"](outputs)
    reason = agent_ns["implement_alert_threshold_reason"](outputs)
    sign = "plus" if operator in (">=", ">") else "minus"
    assert f"the mean {sign} 2 standard deviations" in trigger
    assert f"({WORDS[operator]} 2 until 5 earlier runs exist)" in trigger
    assert f"(Act now rows are {WORDS[operator]} 2)" in reason
    assert not SYMBOLS.search(trigger) and not SYMBOLS.search(reason)


def test_the_symbol_check_catches_the_old_wording(agent_ns):
    for old in ("Act now rows in the latest run >= 1", "rise above the mean + 2 standard deviations", "(< 3 until 5 earlier runs exist)",
                "Act now rows <= 1"):
        assert SYMBOLS.search(old), old
    assert not SYMBOLS.search("at 06:00 every Monday, UTC")
    assert set(agent_ns["IMPLEMENT_ALERT_OPERATOR_WORDS"]) == set(agent_ns["IMPLEMENT_ALERT_OPERATORS"])


def test_how_often_an_alert_checks_says_the_schedule_in_words(agent_ns):
    cadence = agent_ns["implement_alert_cadence_text"]
    assert cadence({"cron": "0 0 6 ? * MON", "timezone": "Asia/Dubai", "enabled": True}) == (
        "after each scheduled run of the job (at 06:00 every Monday, Asia/Dubai), once its notebook task has written the results")
    assert cadence({"cron": "0 30 7 * * ?", "enabled": False}) == (
        "after each run of the job; its schedule (at 07:30 every day, UTC) is paused, so only when someone runs the job")
    assert "0 0 6" not in cadence({"cron": "0 0 6 ? * MON", "enabled": True})
    assert cadence({"cron": "0 0/15 * * * ?", "enabled": True}).startswith("after each scheduled run of the job (on the schedule 0 0/15 * * * ?, UTC)")
