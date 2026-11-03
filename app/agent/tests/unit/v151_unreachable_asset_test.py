import json

import pytest

from v120_artifacts_support import CapturingLogger
from v140_implement_test import ALERT, _alert_inspire, _calls_to, _output_context, _space
from v142_merge_test import DASH, _dashboard as _board_json, _dashboard_inspire, _merge_flow, _normalized, _own_genie_route
from v144_undo_test import OK_SMOKE, _genie_flow, _page_rounds, _rounds_runner

BUILDER = "app-abc123 inspire-app"
SP_ID = "11111111-2222-3333-4444-555555555555"
FOLDER = "/W/acme_implemented/Sales"
ACL = "/workspace/1111/2222/3333/4444"
UNREADABLE_SPACE = f"Unable to get space [g1]. Caused by User {SP_ID} does not have read permission for node with aclPath {ACL}"
UNREADABLE = f"User {SP_ID} does not have read permission for node with aclPath {ACL}"
LOCKED = f"User {SP_ID} does not have edit permission for node with aclPath {ACL}"
HIDDEN = "Node with internal name tree/1234567890 does not exist."
ROUNDS = 3


def _note(label, noun, asset_id):
    return (f"{label}: Inspire builds as {BUILDER}, which cannot open the {noun} {asset_id} this use case had, so Inspire built a new "
            f"one in {FOLDER}; the {noun} {asset_id} keeps what Inspire built there before and is no longer refreshed for it")


def _locked(noun, asset_id):
    return (f"Inspire builds as {BUILDER}, which can open the {noun} {asset_id} of this use case but cannot change it, so Inspire did "
            f"not change it: give {BUILDER} Can manage on it, or delete it so Inspire builds a new one, then build again")


def _genie(agent_ns, tmp_path, routes):
    inst, calls = _genie_flow(agent_ns, tmp_path, routes, [OK_SMOKE] * ROUNDS)
    inst._implement_builder_label = lambda: BUILDER
    context = _output_context(agent_ns)
    context["assets"] = {"genie_space": "g1"}
    return inst, calls, context, _rounds_runner(agent_ns, "genie_space.json", _space(grounded=True), ROUNDS)


def test_a_genie_agent_inspire_cannot_open_is_built_new_in_the_use_case_folder_in_the_same_genie_round(agent_ns, tmp_path):
    inst, calls, context, runner = _genie(agent_ns, tmp_path, {("GET", "/api/2.0/genie/spaces/g1"): RuntimeError(UNREADABLE_SPACE)})
    fields = inst._implement_genie_space(context, runner)
    assert fields["genie_space_id"] == "s9" and len(runner.prompts) == 1, "the first round's space is saved, no round is spent on access"
    assert [c[:2] for c in calls] == [("GET", "/api/2.0/genie/spaces/g1"), ("POST", "/api/2.0/genie/spaces")]
    assert calls[1][2]["parent_path"] == FOLDER
    assert fields["_warnings"] == [_note("Genie Agent", "Genie Agent", "g1")]
    assert SP_ID not in json.dumps(fields["_warnings"]) and ACL not in json.dumps(fields["_warnings"])
    assert context["assets"]["genie_space"] == "", "no later output of this build uses the Genie Agent Inspire cannot open"
    assert inst.logger.matching(f"cannot open the Genie Agent g1, so Inspire is creating a new one in {FOLDER}")


def test_a_genie_agent_whose_new_space_failed_a_round_keeps_its_note_and_is_not_read_again(agent_ns, tmp_path):
    inst, calls, context, runner = _genie(agent_ns, tmp_path, {("GET", "/api/2.0/genie/spaces/g1"): RuntimeError(UNREADABLE_SPACE),
                                                               ("DELETE", "/api/2.0/genie/spaces/s9"): {}})
    answers = [RuntimeError("the Genie Agent could not answer 'Which customers act now?': FAILED"), OK_SMOKE]
    inst._implement_genie_smoke = lambda space_id, question, **kw: (_ for _ in ()).throw(answers.pop(0)) if isinstance(
        answers[0], Exception) else answers.pop(0)
    fields = inst._implement_genie_space(context, runner)
    assert len(runner.prompts) == 2 and fields["genie_space_id"] == "s9"
    assert [c[:2] for c in calls].count(("GET", "/api/2.0/genie/spaces/g1")) == 1
    assert fields["_warnings"] == [_note("Genie Agent", "Genie Agent", "g1")]


def test_a_genie_agent_inspire_can_open_but_not_change_stops_with_the_grant_to_make_and_no_more_genie_rounds(agent_ns, tmp_path):
    before = _normalized(agent_ns, ("main.inspire.churn_out",), "Which customers left?", "Old instructions.")
    inst, calls, context, runner = _genie(agent_ns, tmp_path, {
        ("GET", "/api/2.0/genie/spaces/g1"): {"title": "Old", "description": "old", "warehouse_id": "whOld",
                                              "serialized_space": json.dumps(before)},
        ("PATCH", "/api/2.0/genie/spaces/g1"): RuntimeError(LOCKED)})
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        inst._implement_genie_space(context, runner)
    assert str(raised.value) == _locked("Genie Agent", "g1")
    assert len(runner.prompts) == 1 and not any(c[:2] == ("POST", "/api/2.0/genie/spaces") for c in calls)


def _dashboard(agent_ns, tmp_path, routes):
    inst, calls = _dashboard_inspire(agent_ns, tmp_path, routes)
    inst.logger = CapturingLogger()
    inst._implement_builder_label = lambda: BUILDER
    context = _output_context(agent_ns)
    context["assets"] = {"dashboard": "d1"}
    return inst, calls, context, _page_rounds(agent_ns, rounds=ROUNDS)


@pytest.mark.parametrize("answer, unreadable", [
    (RuntimeError(HIDDEN), False),
    (dict(DASH, dashboard_id="d1", lifecycle_state="TRASHED"), False),
    (RuntimeError(UNREADABLE), True),
])
def test_a_dashboard_that_is_gone_trashed_or_closed_to_inspire_is_built_new_in_the_same_genie_round(agent_ns, tmp_path, answer, unreadable):
    inst, calls, context, runner = _dashboard(agent_ns, tmp_path, {
        ("GET", "/api/2.0/lakeview/dashboards/d1"): answer, ("POST", "/api/2.0/lakeview/dashboards"): {"dashboard_id": "d9"},
        ("POST", "/api/2.0/lakeview/dashboards/d9/published"): {}})
    fields = inst._implement_dashboard(context, runner)
    assert fields["dashboard_id"] == "d9" and len(runner.prompts) == 1
    assert not any(c[0] == "PATCH" for c in calls), "a dashboard Inspire cannot use is never patched"
    [created] = [c[2] for c in calls if c[:2] == ("POST", "/api/2.0/lakeview/dashboards")]
    assert created["parent_path"] == FOLDER
    assert fields.get("_warnings", []) == ([_note("Dashboard", "dashboard", "d1")] if unreadable else [])
    assert context["assets"]["dashboard"] == ""
    assert bool(inst.logger.matching("the dashboard d1 is gone; creating a new one")) is not unreadable


def test_a_dashboard_inspire_can_open_but_not_change_stops_with_the_grant_to_make_and_no_more_genie_rounds(agent_ns, tmp_path):
    inst, calls, context, runner = _dashboard(agent_ns, tmp_path, {("GET", "/api/2.0/lakeview/dashboards/d1"): DASH,
                                                                  ("PATCH", "/api/2.0/lakeview/dashboards/d1"): RuntimeError(LOCKED)})
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        inst._implement_dashboard(context, runner)
    assert str(raised.value) == _locked("dashboard", "d1")
    assert len(runner.prompts) == 1 and not any(c[:2] == ("POST", "/api/2.0/lakeview/dashboards") for c in calls)


def test_an_alert_inspire_cannot_open_is_made_again_and_the_job_runs_the_new_one(agent_ns, tmp_path):
    inst, calls, _q = _alert_inspire(agent_ns, tmp_path, {("GET", "/api/2.0/alerts/al-1"): RuntimeError(UNREADABLE),
                                                         ("POST", "/api/2.0/alerts"): {"id": "al-2"}})
    inst._implement_builder_label = lambda: BUILDER
    context = dict(_output_context(agent_ns, **ALERT), assets={"alert": "al-1"})
    fields = inst._implement_alert(context, None)
    assert fields["alert_id"] == "al-2" and _calls_to(calls, "PATCH", "/api/2.0/alerts/al-1") == []
    assert fields["_warnings"] == [_note("Alert", "alert", "al-1")]
    [(update, _query)] = _calls_to(calls, "POST", "/api/2.2/jobs/update")
    assert update["new_settings"]["tasks"][0]["alert_task"]["alert_id"] == "al-2", "the job alerts through the new alert only"
    [(created, _query)] = _calls_to(calls, "POST", "/api/2.0/alerts")
    assert created["schedule"]["pause_status"] == "PAUSED", "the old alert is never joined by a second one that sends on its own"


def _joined(noun, asset_id):
    return (f"Inspire builds as {BUILDER}, which can open the {noun} {asset_id} this use case is added to but cannot change it, so "
            f"Inspire did not change it: give {BUILDER} Can manage on it, or add this use case to another one, then build again")


def test_a_dashboard_this_use_case_is_added_to_that_inspire_cannot_change_stops_with_the_grant_to_make(agent_ns, tmp_path):
    inst, calls = _dashboard_inspire(agent_ns, tmp_path, {("GET", "/api/2.0/lakeview/dashboards/dA"): DASH,
                                                         ("PATCH", "/api/2.0/lakeview/dashboards/dA"): RuntimeError(LOCKED)})
    inst._implement_builder_label = lambda: BUILDER
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        inst._implement_merge_dashboard(_output_context(agent_ns), "dA", json.loads(_board_json()))
    assert str(raised.value) == _joined("dashboard", "dA")
    assert len([c for c in calls if c[0] == "PATCH"]) == 1, "a refused change is not retried like a stale etag"


def test_a_hub_s_genie_agent_inspire_cannot_change_never_stops_a_page_joining_it(agent_ns, tmp_path, monkeypatch):
    routes = {("GET", "/api/2.0/genie/spaces/gA"): RuntimeError(LOCKED), ("PATCH", "/api/2.0/genie/spaces/gA"): RuntimeError(LOCKED),
              **_own_genie_route("gB")}
    inst, context, seen, calls = _merge_flow(agent_ns, tmp_path, monkeypatch, assets={"genie_space": "gB"}, routes=routes)
    inst._implement_builder_label = lambda: BUILDER
    inst._implement_app(context, None)
    assert len(seen["deployed"]) == 1 and seen["deployed"][0][3] == "gB"
    assert [c[:2] for c in calls if "/genie/" in c[1]] == [("GET", "/api/2.0/genie/spaces/gB")], \
        "a page answers from its own Genie Agent, so the hub's is never opened"


def test_the_grant_message_says_whether_the_output_is_this_use_case_s_own_or_one_it_joins(agent_ns):
    assert agent_ns["implement_locked_asset_message"](BUILDER, "Genie Agent", "g1", False) == _locked("Genie Agent", "g1")
    assert agent_ns["implement_locked_asset_message"](BUILDER, "Genie Agent", "gA", True) == _joined("Genie Agent", "gA")


@pytest.mark.parametrize("text, denied", [
    (UNREADABLE_SPACE, True),
    (LOCKED, True),
    ("PERMISSION_DENIED: no CAN EDIT", True),
    ("User does not have permission to view this space", True),
    ("Principal 'app-x inspire' does not have CREATE TABLE and USE SCHEMA on Schema 'inspire_lakebase.s'", False),
    ("the Lakebase backend names datasets of page other_page, which the App does not have", False),
    (HIDDEN, False),
    ("INTERNAL_ERROR: publish failed", False),
])
def test_the_platform_s_permission_sentences_are_recognised_and_others_are_not(agent_ns, text, denied):
    assert agent_ns["implement_is_permission_denied"](RuntimeError(text)) is denied
    assert not agent_ns["implement_is_not_found"](RuntimeError(UNREADABLE_SPACE))


@pytest.mark.parametrize("identity", ["", "   ", None])
def test_a_grant_message_whose_build_identity_has_no_name_still_names_who_needs_the_grant(agent_ns, identity):
    texts = [agent_ns["implement_locked_asset_message"](identity, "alert", "al-1"),
             agent_ns["implement_unreachable_asset_note"](identity, "dashboard", "d1", FOLDER),
             agent_ns["implement_folder_denied_message"](identity, FOLDER)]
    assert texts == [
        "The identity Inspire builds as can open the alert al-1 of this use case but cannot change it, so Inspire did not change it: "
        "give that identity Can manage on it, or delete it so Inspire builds a new one, then build again",
        f"The identity Inspire builds as cannot open the dashboard d1 this use case had, so Inspire built a new one in {FOLDER}; the "
        "dashboard d1 keeps what Inspire built there before and is no longer refreshed for it",
        f"The identity Genie builds as cannot open {FOLDER}, the folder of the Inspire App that holds every MVP: ask a workspace admin "
        "to give that identity Can manage on that folder, or run the Inspire workspace installer again, which gives it that access, then "
        "build again"]
    assert agent_ns["implement_builds_as"](f"  {BUILDER} ") == (f"Inspire builds as {BUILDER}, which", BUILDER)
