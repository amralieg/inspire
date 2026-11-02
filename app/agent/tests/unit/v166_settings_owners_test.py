import copy

import pytest

from v141_app_shell_test import shell_core as SHELL_CORE
from v164_settings_decisions_test import BUILT, Reached, _inserts, _settings_run, _spec

OWNER, APP_OWNER, OTHER = "lee.chan@x.co", "pat.kim@x.co", "sam.ortiz@x.co"
SHARE = ({"act_now_share": "0.05"}, {"act_now_share": "0.1"})
CARRIED = {"notebook_path": "/Workspace/nb", "job_id": 7, "dashboard_id": "d1", "genie_space_id": "g1", "app_name": "churn-desk",
           "last_preview_run_id": 99}
LEAD = "Only the owners of this use case can change its settings: the person who asked for v1 and the App owners it names"
REFUSED = f"{LEAD}, and {OTHER}, who asked for v2, is not one of them, so Inspire applied nothing of v2 and v1 stays live"
UNNAMED = (f"{LEAD}, and this run does not name who asked for it, so Inspire cannot check that they are one of them; it applied nothing "
           "of v2 and v1 stays live. Submit the change again from the Inspire App, which records who asks")
NOTE = "Raised for the Q4 retention push"
NAMES = [entry["name"] for entry in BUILT]


def _owned(widgets, owners):
    spec = _spec(widgets)
    if owners is not None:
        spec["outputs"] = dict(spec["outputs"], app_owners=list(owners))
    return spec


def _owned_run(agent_ns, requester, created_by=OWNER, owners=None):
    before, after = _owned(SHARE[0], owners), _owned(SHARE[1], owners)
    validate = agent_ns["validate_implement_spec"]
    assert agent_ns["classify_implement_change"](validate(before)[0], validate(after)[0], NAMES) == ["settings"]
    return _settings_run(agent_ns, *SHARE, requester=requester, previous={"spec_json": before, "created_by": created_by}, current=after)


def _recorded(inst):
    record = {"updates": [], "steps": []}
    inst._implement_update = lambda key, **fields: record["updates"].append(copy.deepcopy(fields))
    inst._implement_emit = lambda *args, **kwargs: record["steps"].append(args)
    return record


def _changed(after, **sections):
    spec = _spec(after)
    for name, value in sections.items():
        spec[name] = dict(spec.get(name) or {}, **value)
    return spec


@pytest.mark.parametrize("requester,owners", [
    (OWNER, None),
    ("  Lee.Chan@X.co ", None),
    (APP_OWNER, ["Pat.Kim@x.co"]),
])
def test_an_owner_applies_a_settings_change(agent_ns, requester, owners):
    inst, seen, run = _owned_run(agent_ns, requester, owners=owners)
    record = _recorded(inst)
    with pytest.raises(Reached, match="past the notebook"):
        run()
    assert seen == {"genie": 0, "notebook": 0}
    rows = _inserts(inst)
    assert len(rows) == 1 and "'act_now_share', 0.1, " in rows[0]
    assert not [s for s in record["steps"] if s[1] == agent_ns["IMPLEMENT_CHECKLIST_STEP"]]


@pytest.mark.parametrize("created_by,owners", [
    (OWNER, None),
    (OWNER, [APP_OWNER]),
    (None, None),
])
def test_a_person_who_is_not_an_owner_is_refused_and_nothing_is_applied(agent_ns, created_by, owners):
    inst, seen, run = _owned_run(agent_ns, OTHER, created_by=created_by, owners=owners)
    record = _recorded(inst)
    with pytest.raises(agent_ns["ImplementStopped"]) as refused:
        run()
    assert str(refused.value) == REFUSED
    assert seen == {"genie": 0, "notebook": 0}
    assert not [s for s in inst.spark.statements if s.startswith(("INSERT", "CREATE", "ALTER", "MERGE", "UPDATE", "DELETE"))]
    assert not [u for u in record["updates"] if "status" in u], "the row never starts building"
    entry = {"n": 1, "kind": "settings_refused", "requirement": "Set act_now_share to 0.1", "part": "", "where": "Settings",
             "status": "refused", "evidence": REFUSED, "rounds": 0, "tried": [], "checks": [], "published_anyway": None}
    kept = record["updates"][-1]
    summary = {"met": 0, "total": 1, "refused": 1}
    assert kept["asset_status"]["checklist"] == [entry] and kept["asset_status"]["checklist_summary"] == summary
    assert kept["asset_status"]["notebook"]["state"] == "ready" and kept["asset_status"]["settings"] == BUILT
    assert {k: kept[k] for k in CARRIED} == CARRIED, "the live version's assets stay on record"
    assert record["steps"] == [("N01-U01", agent_ns["IMPLEMENT_CHECKLIST_STEP"], f"0 of 1 settings change applied: {REFUSED}", "ended_error",
                                dict({"spec_version": 2, "checklist": [entry]}, **summary))]
    assert agent_ns["implement_unmet_asks"](kept["asset_status"]) == [], "a refused setting is never an unmet vibe ask"
    assert agent_ns["implement_mark_published_anyway"](kept["asset_status"], OTHER, "2026-10-31T12:00:00Z") == 0
    assert kept["asset_status"]["checklist"][0]["published_anyway"] is None


@pytest.mark.parametrize("requester", [None, "", "   "])
def test_a_run_that_names_no_requester_is_refused(agent_ns, requester):
    inst, seen, run = _owned_run(agent_ns, requester)
    record = _recorded(inst)
    with pytest.raises(agent_ns["ImplementStopped"]) as refused:
        run()
    assert str(refused.value) == UNNAMED
    assert seen == {"genie": 0, "notebook": 0} and _inserts(inst) == []
    assert record["updates"][-1]["asset_status"]["checklist"][0]["evidence"] == UNNAMED


def test_a_settings_change_mixed_with_another_change_is_refused_for_a_non_owner(agent_ns):
    mixed = _changed(SHARE[1], schedule={"cron": "0 0 7 ? * MON"})
    assert agent_ns["classify_implement_change"](agent_ns["validate_implement_spec"](_spec(SHARE[0]))[0],
                                                 agent_ns["validate_implement_spec"](mixed)[0], NAMES) == ["schedule", "settings"]
    inst, seen, run = _settings_run(agent_ns, *SHARE, requester=OTHER, current=mixed)
    _recorded(inst)
    with pytest.raises(agent_ns["ImplementStopped"], match="is not one of them"):
        run()
    assert seen == {"genie": 0, "notebook": 0} and _inserts(inst) == []
    owner, _seen, run = _settings_run(agent_ns, *SHARE, requester=OWNER, current=mixed)
    _recorded(owner)
    with pytest.raises(Reached):
        run()
    assert len(_inserts(owner)) == 1


def _vibed_run(agent_ns, requester):
    vibed = _spec(SHARE[1])
    vibed.update(vibes="Put the riskiest customers first", vibe_previous="keep")
    validate = agent_ns["validate_implement_spec"]
    assert agent_ns["classify_implement_change"](validate(_spec(SHARE[0]))[0], validate(vibed)[0], NAMES) == ["settings", "vibe"]
    inst, seen, run = _settings_run(agent_ns, *SHARE, requester=requester, current=vibed)
    record = _recorded(inst)
    asked = []
    inst._implement_vibes_llm = lambda kind, *args, **kwargs: asked.append(kind) or (_ for _ in ()).throw(Reached("asked the model"))
    return run, seen, record, asked


def test_a_non_owner_s_settings_and_vibe_change_is_refused_before_any_model_call(agent_ns):
    run, seen, record, asked = _vibed_run(agent_ns, OTHER)
    with pytest.raises(agent_ns["ImplementStopped"]) as refused:
        run()
    assert str(refused.value) == REFUSED
    assert asked == [] and seen == {"genie": 0, "notebook": 0}, "no vibe routing and no Genie round before the refusal"
    assert [s[1] for s in record["steps"]] == [agent_ns["IMPLEMENT_CHECKLIST_STEP"]], "no Vibe step starts"


def test_an_owner_s_settings_and_vibe_change_still_routes_the_vibe(agent_ns, monkeypatch):
    monkeypatch.setitem(agent_ns, "IMPLEMENT_ROUTER_BACKOFF_S", 0)
    run, _seen, record, asked = _vibed_run(agent_ns, OWNER)
    with pytest.raises(agent_ns["ImplementBlocked"], match="Inspire did not decide which part each ask of your vibe changes"):
        run()
    assert asked == ["route"] * agent_ns["IMPLEMENT_ROUTER_ATTEMPTS"]
    assert [s[1] for s in record["steps"]][:1] == ["Vibe"]


@pytest.mark.parametrize("before,after,current,expected", [
    (SHARE[0], SHARE[0], _changed(SHARE[0], schedule={"cron": "0 0 7 ? * MON"}), "past the notebook"),
    ({"act_now_share": "0.05"}, {"act_now_share": "0.05", "top_k": "10"}, None, "reached Genie"),
])
def test_a_change_that_is_not_a_settings_change_runs_for_anyone(agent_ns, before, after, current, expected):
    inst, _seen, run = _settings_run(agent_ns, before, after, requester=OTHER, current=current)
    record = _recorded(inst)
    with pytest.raises(Reached, match=expected):
        run()
    assert not [s for s in record["steps"] if s[1] == agent_ns["IMPLEMENT_CHECKLIST_STEP"]]


def test_the_refusal_stops_the_run_at_once_and_marks_it_failed(agent_ns):
    inst, _seen, _run = _settings_run(agent_ns, *SHARE, requester=OTHER)
    record = _recorded(inst)
    asked = []
    inst._implement_vibes_llm = lambda *args, **kwargs: asked.append(args) or {"repair": "retry", "why": "try again"}
    target = {"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 2, "spec_json": _spec(SHARE[1]), "created_by": OTHER}
    assert inst._implement_attempts(target, "N01-U01", (5150, "N01-U01", 2)) == "failed"
    assert asked == [], "no repair is asked for: a second attempt cannot change who asked"
    assert record["updates"][-1] == {"status": "failed", "status_message": REFUSED}
    assert [s[1] for s in record["steps"]] == [agent_ns["IMPLEMENT_CHECKLIST_STEP"], "Implement"]
    assert record["steps"][-1][2:4] == (REFUSED, "ended_error")


def test_the_refusal_names_the_use_case_with_or_without_an_app_and_lists_every_setting_asked(agent_ns):
    refusal = agent_ns["implement_settings_refusal"]
    live = {"spec_version": 3, "created_by": "Lee.Chan@x.co", "spec_json": {"outputs": {"app": False, "app_owners": [APP_OWNER]}}}
    told = ("Only the owners of this use case can change its settings: the person who asked for v3 and the App owners it names, and "
            f"{OTHER}, who asked for v4, is not one of them, so Inspire applied nothing of v4 and v3 stays live")
    assert refusal(live, OTHER, 4) == told
    assert refusal(dict(live, spec_json={"outputs": {"app": True, "app_owners": [APP_OWNER]}}), OTHER, 4) == told
    assert refusal(live, " lee.chan@X.CO", 4) == "" and refusal(live, APP_OWNER.upper(), 4) == ""
    assert refusal(dict(live, spec_json="not a spec"), "lee.chan@x.co", 4) == ""
    validate = agent_ns["validate_implement_spec"]
    before = validate(_changed({"act_now_share": "0.05"}, config={"assumptions": {"WEEKS_LEFT": 12, "KEEP_RATE": 0.4}}))[0]
    after = validate(_changed({"act_now_share": "0.1", "review_share": "0.3"}, config={"assumptions": {"WEEKS_LEFT": 10, "UNIT_COST": "2.50"}}))[0]
    assert agent_ns["implement_settings_asked"](before, after) == [
        "Set act_now_share to 0.1", "Set review_share to 0.3", "Set UNIT_COST to 2.5", "Set WEEKS_LEFT to 10",
        "Clear the value of KEEP_RATE"]


def test_the_person_s_note_is_saved_with_the_setting_and_the_fixed_note_only_when_none_is_given(agent_ns):
    for note, saved in ((NOTE, NOTE), (f"  {NOTE} \n", NOTE), ("   ", agent_ns["IMPLEMENT_SETTINGS_NOTE"]),
                        (None, agent_ns["IMPLEMENT_SETTINGS_NOTE"])):
        current = _spec(SHARE[1])
        current["config"]["settings_note"] = note
        inst, _seen, run = _settings_run(agent_ns, *SHARE, current=current)
        _recorded(inst)
        with pytest.raises(Reached, match="past the notebook"):
            run()
        rows = _inserts(inst)
        assert len(rows) == 1 and f"'act_now_share', 0.1, 'lee.chan@x.co', current_timestamp(), '{saved}', NULL" in rows[0], (note, rows)


def test_a_note_alone_is_no_change_and_a_note_with_a_value_is_a_settings_change(agent_ns):
    validate, classify, plan = (agent_ns["validate_implement_spec"], agent_ns["classify_implement_change"], agent_ns["implement_plan"])
    before = validate(_spec(SHARE[0]))[0]
    alone = validate(_changed(SHARE[0], config={"settings_note": NOTE}))[0]
    assert alone["config"]["settings_note"] == NOTE and classify(before, alone, NAMES) == []
    got = plan(before, alone, {"dashboard": "d1", "genie_space": "g1", "app": "churn-desk", "preview_run_id": 7}, True, NAMES)
    assert got["refill"] is False and got["build"] == [] and got["refresh"] == []
    valued = validate(_changed(SHARE[1], config={"settings_note": NOTE}))[0]
    assert classify(before, valued, NAMES) == ["settings"]


def test_the_note_limit_is_the_app_s_own(agent_ns):
    assert agent_ns["IMPLEMENT_SETTINGS_NOTE_CHARS"] == SHELL_CORE.NOTE_CHARS
    validate = agent_ns["validate_implement_spec"]
    assert validate(_changed(SHARE[1], config={"settings_note": "n" * SHELL_CORE.NOTE_CHARS}))[1] == []
    assert validate(_changed(SHARE[1], config={"settings_note": "n" * (SHELL_CORE.NOTE_CHARS + 1)}))[1] == [
        f"config.settings_note must be at most {SHELL_CORE.NOTE_CHARS} characters, not {SHELL_CORE.NOTE_CHARS + 1}"]
    assert validate(_changed(SHARE[1], config={"settings_note": 7}))[1] == ["config.settings_note must be text, not 7"]
