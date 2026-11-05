"""What Genie changed in each repair round is kept when the build still stops, and the failed build shows it."""
import ast

from _agentload import method_node
from v206_genie_self_repair_test import _adapted, _run, _stopped
from v140_implement_test import _FakeRunner, _flow_inspire


def _stopped_with(reason, **change):
    return dict(_adapted(**change), status="stopped", stop_reason=reason)


def test_a_build_that_stops_after_two_repair_rounds_keeps_both_rounds_changes(agent_ns):
    inst = _flow_inspire(agent_ns, [])
    runner = _FakeRunner([{"exit": 0, "final": _stopped_with("the sample query failed", what="the outcome column", why="the label is is_churned")},
                          {"exit": 0, "final": _stopped_with("the sample query failed", what="the date filter", why="the history starts in 2024")},
                          {"exit": 0, "final": _stopped("the sample query failed")}])
    outcome, _job, _f = _run(agent_ns, inst, runner)
    assert outcome["status"] == "stopped" and len(runner.prompts) == 3
    assert outcome["genie_changes"] == ["Genie changed the outcome column: the label is is_churned.",
                                        "Genie changed the date filter: the history starts in 2024."]


def test_a_build_that_stops_with_no_change_from_genie_keeps_none(agent_ns):
    inst = _flow_inspire(agent_ns, [])
    runner = _FakeRunner([{"exit": 0, "final": _stopped("the sample query failed")}] * 3)
    outcome, _job, _f = _run(agent_ns, inst, runner)
    assert outcome["status"] == "stopped" and "genie_changes" not in outcome


def test_the_same_change_reported_in_two_rounds_is_listed_once(agent_ns):
    inst = _flow_inspire(agent_ns, [])
    same = {"what": "the outcome column", "why": "the label is is_churned"}
    runner = _FakeRunner([{"exit": 0, "final": _stopped_with("the sample query failed", **same)}] * 3)
    outcome, _job, _f = _run(agent_ns, inst, runner)
    assert outcome["genie_changes"] == ["Genie changed the outcome column: the label is is_churned."]


def test_a_stopped_build_emits_what_genie_changed_before_it_raises():
    source = ast.unparse(method_node("DatabricksInspire", "_implement_one_locked"))
    emit = source.index("self._implement_emit(uc_id, IMPLEMENT_GENIE_CHANGES_PHASE")
    assert source.index("if outcome.get('genie_changes'):") < emit < source.index("raise stop(implement_stop_message(")
    assert "{'spec_version': key[2], 'genie_changes': outcome['genie_changes']}" in source
    assert "[GENIE-CHANGES FIRED]" in source
