"""The App and Inspire show a run's reason for having nothing to act on after 'Nothing to act on yet, because', so it is the cause alone."""
import pytest

from v147_value_at_stake_test import MEASURED, PREDICTED

SHOWN = "Nothing to act on yet, because "
UNACCEPTED = dict(PREDICTED, accepted=False)


def _shown(reason):
    return SHOWN + reason[0].lower() + reason[1:]


def test_genie_is_told_the_reason_follows_nothing_to_act_on_yet_because_and_names_only_what_this_run_found(agent_ns):
    rule = agent_ns["GENIE_RESULT_HISTORY_RULE"]
    assert ("also pass `nothing_to_act`: one plain sentence for the people who act on the results, which the App shows after "
            "'Nothing to act on yet, because', so it gives only the cause, never a sentence that says again that nothing is "
            "actionable: the check or threshold this run missed, with the measured numbers behind it, and what would change it") in rule
    assert "Name each cause this run found, joined by 'and', never a list of possible causes joined by 'or'" in rule
    assert "one plain sentence for the people who act on the results that says why" not in rule


@pytest.mark.parametrize("found,value", [
    ({"records": 4}, UNACCEPTED),
    ({"records": 0}, UNACCEPTED),
    ({"records": 3, "flagged_records": 3, "top_flag": "missing price"}, MEASURED),
    ({"records": 9, "held_records": 2}, None),
    ({"records": 3, "flagged_records": 1, "top_stake": 812.5}, MEASURED),
    ({"records": 3}, dict(PREDICTED, accepted=True)),
    ({"records": 3}, None),
])
def test_every_reason_inspire_gives_reads_as_the_cause_after_nothing_to_act_on_yet_because(agent_ns, found, value):
    reason = agent_ns["inspire_nothing_to_act"](found, value, "")
    shown = _shown(reason)
    assert "actionable" not in reason and " because " not in reason, shown
    assert shown.count("because") == 1 and shown.count("Nothing to act on") == 1, shown


def test_a_prediction_no_model_passed_says_so_once(agent_ns):
    reason = agent_ns["inspire_nothing_to_act"]({"records": 4}, UNACCEPTED, "")
    assert reason == "No model passed this use case's acceptance check in the last run."
    assert _shown(reason) == "Nothing to act on yet, because no model passed this use case's acceptance check in the last run."
