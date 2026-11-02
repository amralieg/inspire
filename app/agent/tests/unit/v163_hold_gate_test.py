import ast
import calendar
import json

import pytest

import _agentload
from v120_artifacts_support import FakeSpark
from v140_implement_test import (NB_PATH, VALID, _FakeRunner, _FileRunner, _calls_to, _churn_page, _claim, _fill, _inspire, _left_by,
                                 _output_context, _spec)
from v142_dash_test import _doc, _flow, _published, _runner as _pages
from v142_genie_test import _definition, _deploy_inspire as _space_inspire, _rich_space
from v143_vibes_test import BUILT, LIVE, _locked, _run, _verdicts
from v148_asset_vibes_test import PAGE, PARTS, WIDGET_VIBES, _built, _carrying, _llm as _part_llm, _vibed
from v149_ai_output_checks_test import _preview
from v157_genie_repoint_test import _own_files, _version_inspire
from v162_one_vibe_box_test import CARRIED as REBUILT_CARRIED, REBUILT, _rebuild
from v164_settings_decisions_test import _settings_run, _spec as _settings_spec

ASK = "Put the top 10 first"
CHART = {"title": "Churn", "charts": [{"id": "by_region", "type": "bar", "sort": "label_asc"}]}
CANDIDATE = {"artifact": CHART, "vibes": ASK, "spec_version": 3, "merged_into": "", "held": True}
UNMET = {"n": 1, "requirement": ASK, "part": "dashboard", "where": "Dashboard", "status": "not_met",
         "evidence": "the chart sorts by name", "rounds": 3, "tried": ["sort by value"], "checks": [], "published_anyway": None}


def _dashboard(inst, deployed):
    def build(context, runner):
        replay = (context.get("replay") or {}).get("dashboard")
        artifact = json.loads(json.dumps(replay[1]["artifact"] if replay else CHART))
        context.setdefault("artifacts", {})["dashboard"] = artifact
        inst._implement_publish_barrier(context, "dashboard", artifact)
        deployed.append(artifact)
        return {"dashboard_id": "d1", "dashboard_url": "https://h/d"}
    return build


def _guarded(inst):
    inst._implement_schedule = lambda *args: pytest.fail("a held version changes no schedule")
    inst._implement_share = lambda *args, **kwargs: pytest.fail("a held version shares nothing")


def _asked(previous, **outputs):
    return dict(previous, outputs={**previous["outputs"], "dashboard_vibes": ASK, **outputs})


def test_a_held_version_deploys_nothing_keeps_the_live_record_and_stores_the_checked_candidate(agent_ns):
    inst, previous = _locked(agent_ns)
    asked, deployed = [], []
    inst._implement_runner = lambda uc: asked.append(uc) or "genie"
    inst._implement_dashboard = _dashboard(inst, deployed)
    _guarded(inst)
    _verdicts(inst, [ASK], status="missing", evidence="the chart sorts by name")
    assert _run(inst, _asked(previous)) == agent_ns["IMPLEMENT_HELD_STATUS"] == "vibe_not_met"
    assert deployed == [], "the dashboard of a held version is never deployed"
    assert asked == ["N01-U01"], "the candidate was built by Genie once"
    final = inst.updates[-1]
    assert final["status"] == "vibe_not_met"
    live = final["asset_status"]["dashboard"]
    assert (live["state"], live["spec_version"]) == ("ready", 2), "the live dashboard record stays the one of v2"
    held = final["asset_status"]["held"]
    assert held["parts"] == ["dashboard"] and held["candidates"] == ["dashboard"]
    assert held["reason"].startswith("1 ask is not met, so nothing of v3 is published and v2 stays live")
    assert "Dashboard: Put the top 10 first: the chart sorts by name" in held["reason"] and final["status_message"].startswith(held["reason"])
    saved = json.loads(next(u for u in inst.updates if "asset_snapshots" in u)["asset_snapshots"])
    assert saved == {"dashboard": CANDIDATE}, "the checked candidate is stored with the version so Publish anyway needs no rebuild"
    assert not any("dashboard_url" in u and u.get("status") != "filling" for u in inst.updates)
    assert any(held["reason"][:200] in json.dumps(e, default=str, ensure_ascii=False) and "Held" in json.dumps(e, default=str)
               for e in inst.emitted), "the run log names the hold and why"


def test_a_version_whose_asks_are_all_met_publishes_each_candidate_once_as_today(agent_ns):
    inst, previous = _locked(agent_ns)
    asked, deployed = [], []
    inst._implement_runner = lambda uc: asked.append(uc) or "genie"
    inst._implement_dashboard = _dashboard(inst, deployed)
    _verdicts(inst, [ASK], status="done")
    assert _run(inst, _asked(previous)) == "ready"
    assert deployed == [CHART] and asked == ["N01-U01"], "the checked candidate is deployed once, with no second Genie round"
    final = inst.updates[-1]
    assert "held" not in final["asset_status"]
    record = final["asset_status"]["dashboard"]
    assert (record["state"], record["spec_version"], record["snapshot"]) == ("ready", 3, True)
    assert [c["status"] for c in record["vibes_checks"]] == ["done"]
    saved = json.loads([u for u in inst.updates if "asset_snapshots" in u][-1]["asset_snapshots"])
    assert saved == {"dashboard": {"artifact": CHART, "vibes": ASK, "spec_version": 3, "merged_into": ""}}


def test_a_version_with_no_asks_never_enters_the_hold(agent_ns):
    inst, previous = _locked(agent_ns)
    deployed = []
    inst._implement_runner = lambda uc: "genie"
    inst._implement_dashboard = _dashboard(inst, deployed)
    inst._implement_vibes_llm = lambda *args: pytest.fail("a version with no asks judges nothing")
    assert _run(inst, dict(previous, retry_outputs=["dashboard"])) == "ready"
    assert deployed == [CHART]
    assert agent_ns["implement_version_asks"](_spec(agent_ns)[0]) is False


def _held_row(version=3, created_by="owner@example.com", status="vibe_not_met", checklist=True, app_owners=()):
    asset_status = {"dashboard": {"state": "ready", "spec_version": 2, "vibes_checks": [
        {"ask": ASK, "status": "missing", "evidence": "the chart sorts by name"}]},
        "held": {"parts": ["dashboard"], "candidates": ["dashboard"], "notebook": "", "reason": "held", "unmet": [UNMET]}}
    if checklist:
        asset_status.update(checklist=[dict(UNMET)], checklist_summary={"met": 0, "total": 1})
    return {"spec_version": version, "status": status, "created_by": created_by, "asset_status": asset_status,
            "notebook_path": None, "job_id": None, "spec_json": {"outputs": {"app_owners": list(app_owners)}}}


def _publishing(agent_ns, row, requester="owner@example.com", rows=None, held=3):
    inst, previous = _locked(agent_ns)
    deployed, snapshots, wheres = [], [], []
    listed = [row] if rows is None else rows

    def select(where, args, order=None):
        wheres.append((where, dict(args), order))
        return [dict(r) for r in sorted(listed, key=lambda r: -r["spec_version"]) if r["spec_version"] < args["v"]]

    inst._implement_select = select
    inst.wheres = wheres
    inst._implement_snapshot = lambda key, name, version: snapshots.append((name, version)) or json.loads(json.dumps(CANDIDATE))
    inst._implement_runner = lambda uc: pytest.fail("Publish anyway asks Genie nothing")
    inst._implement_vibes_llm = lambda *args: pytest.fail("Publish anyway judges nothing again")
    inst._implement_dashboard = _dashboard(inst, deployed)
    target = {"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 4, "created_by": requester,
              "spec_json": dict(_asked(previous), publish_held=held)}
    return inst, target, deployed, snapshots


def test_publish_anyway_applies_the_held_candidate_with_zero_genie_calls_and_marks_the_checklist(agent_ns):
    inst, target, deployed, snapshots = _publishing(agent_ns, _held_row())
    assert inst._implement_one_locked(target, (5150, "N01-U01", 4)) == "ready_with_warnings"
    assert snapshots == [("dashboard", 3)] and deployed == [CHART], "the stored candidate of v3 is deployed as it was checked"
    final = inst.updates[-1]
    published = final["asset_status"]["published_held"]
    assert (published["version"], published["by"]) == (3, "owner@example.com") and published["at"].endswith("Z")
    [entry] = final["asset_status"]["checklist"]
    assert entry["status"] == "not_met" and entry["published_anyway"] == {"by": "owner@example.com", "at": published["at"]}
    assert final["asset_status"]["dashboard"]["vibes_checks"] == [{"ask": ASK, "status": "missing", "evidence": "the chart sorts by name"}]
    assert (final["asset_status"]["dashboard"]["state"], final["asset_status"]["dashboard"]["spec_version"]) == ("ready", 4)
    assert "Published anyway: owner@example.com published v3, whose asks were not all met" in final["status_message"]


@pytest.mark.parametrize("rows,held,requester,problem", [
    ([_held_row()], 3, "visitor@example.com",
     "only the owners of this MVP can publish v3 anyway: the person who asked for v3 and the App owners it names"),
    ([_held_row()], 3, " ", "Inspire could not tell who you are, so it cannot check that you own this MVP"),
    ([_held_row(status="ready_with_warnings")], 3, "owner@example.com",
     "v3 is ready with warnings, not held for vibes that were not met, so there is nothing to publish anyway"),
    ([_held_row(version=4)], 3, "owner@example.com", "there is no v3 to publish"),
    ([], 3, "owner@example.com", "there is no v3 to publish"),
    ([_held_row(version=2), _held_row(status="ready")], 2, "owner@example.com",
     "v2 is no longer the latest version (v3 is), so it cannot be published anyway"),
    ([_held_row(version=2), _held_row()], 2, "owner@example.com",
     "v2 is no longer the latest version (v3 is), so it cannot be published anyway"),
])
def test_only_an_owner_can_publish_the_latest_held_version_anyway_and_nothing_else_is_published(agent_ns, rows, held, requester, problem):
    inst, target, deployed, snapshots = _publishing(agent_ns, rows[0] if rows else _held_row(), requester, rows=rows, held=held)
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        inst._implement_one_locked(target, (5150, "N01-U01", 4))
    assert str(raised.value) == problem
    assert deployed == [] and snapshots == []
    assert inst.wheres[-1][1]["v"] == 4 and "spec_version < :v" in inst.wheres[-1][0], "only the versions before this one are read"


def test_the_owners_are_the_held_version_s_creator_and_its_app_owners_without_case_or_spaces(agent_ns):
    owners, refusal = agent_ns["implement_owners"], agent_ns["implement_publish_refusal"]
    row = _held_row(created_by=" Owner@Example.com", app_owners=["Lead@Example.com ", "owner@example.com", ""])
    assert owners(row) == ["owner@example.com", "lead@example.com"]
    assert refusal([row], 3, "LEAD@example.com") == "" and refusal([row], 3, "owner@example.com") == ""
    assert refusal([row], 3, "visitor@example.com").startswith("only the owners of this MVP can publish v3 anyway")
    assert owners({"created_by": None, "spec_json": "not a spec"}) == []


PURPLE = "Make the risk column purple"
NOT_PURPLE = "no cell makes the risk column purple"
SPANISH = "Answer in Spanish"
ENGLISH = "every reason is in English"
IMPOSSIBLE = {"routes": [{"ask": 1, "asset": "colors", "words": PURPLE}]}
COLORS = "it names colors, which Inspire did not build for this use case"
AI_ROWS = [{"record_key": "c1", "priority_tier": "Act now", "ai_explanation": "El cliente gasto menos.",
            "ai_next_action": "Llamar al gerente."}]


def _genie_tries(agent_ns, verdicts, route, responder=None, status=None):
    calls = []
    inst = _rebuild(agent_ns, calls)
    del inst._implement_fill_and_preview
    inst.local_log_output_dir = "/tmp/inspire_test_implement"
    inst._sanitize_name = lambda s: str(s).replace(" ", "_")
    if responder:
        inst.spark = FakeSpark(responder=responder)
    if status is not None:
        inst._implement_carried = lambda target: (dict(REBUILT_CARRIED), _left_by(2, json.loads(json.dumps(status))))
    previews = [_preview(f"r-{n}") for n in range(1, 5)]
    inst._implement_preview = lambda *args: previews.pop(0)
    inst._implement_cell_problems = lambda path, training_sample=False, grouping=None, sources=(): []
    inst._implement_import_notebook = lambda path, text: None
    runner = _FakeRunner([{"exit": 0, "final": _fill()} for _ in range(3)])
    inst._implement_runner = lambda uc: runner
    judged = []

    def llm(kind, prompt, schema):
        if kind == "route":
            return json.loads(json.dumps(route))
        if kind == "split":
            text = prompt.split('"""\n', 1)[1].split('\n"""', 1)[0]
            return {"asks": [{"ask": line, "check": None} for line in text.splitlines() if line.strip()]}
        judged.append(prompt)
        verdict, evidence = verdicts[min(len(judged), len(verdicts)) - 1]
        shown = next(line[2:] for line in prompt.split("<<<\n", 1)[1].split("\n>>>", 1)[0].splitlines() if line.startswith("- "))
        return {"checks": [{"n": 1, "status": verdict, "evidence": shown if verdict == "done" else evidence, "where": ""}]}

    inst._implement_vibes_llm = llm
    return inst, calls, runner, judged


def test_an_ask_the_router_gives_a_part_this_mvp_cannot_build_gets_three_genie_rounds_and_holds_only_after_them(agent_ns):
    inst, calls, runner, judged = _genie_tries(agent_ns, [("missing", NOT_PURPLE)], IMPOSSIBLE)
    assert _run(inst, dict(VALID, vibes=PURPLE, vibe_previous="remove")) == "vibe_not_met"
    assert len(runner.prompts) == 3 and len(judged) == 3, "the ask holds only after Genie had all of its rounds"
    assert all(f"'{PURPLE}': {NOT_PURPLE}" in prompt for prompt in runner.prompts[1:]), "each later round tells Genie what it missed"
    final = inst.updates[-1]["asset_status"]
    [entry] = final["checklist"]
    assert (entry["requirement"], entry["part"], entry["status"], entry["rounds"]) == (PURPLE, "notebook", "not_met", 3)
    assert entry["tried"] == [f"round {n}: {NOT_PURPLE}" for n in (1, 2, 3)]
    assert final["held"]["unmet"] == [entry] and final["checklist_summary"] == {"met": 0, "total": 1}
    assert f"Notebook: {PURPLE}: Genie could not do it in 3 build rounds: {NOT_PURPLE}" in final["held"]["reason"]
    assert final["vibe"]["routes"] == {"notebook": PURPLE}
    assert final["vibe"]["fallback"] == [{"ask": PURPLE, "reason": COLORS, "asset": "notebook"}]
    assert [call for call in calls if call[0] == "write"][0][1] == PURPLE


def test_an_ask_the_router_gives_a_part_this_mvp_cannot_build_is_met_when_genie_meets_it_in_round_2(agent_ns):
    inst, calls, runner, judged = _genie_tries(agent_ns, [("missing", NOT_PURPLE), ("done", "")], IMPOSSIBLE)
    assert _run(inst, dict(VALID, vibes=PURPLE, vibe_previous="remove")) in ("ready", "ready_with_warnings"), inst.updates[-1]
    assert len(runner.prompts) == 2 and len(judged) == 2
    final = inst.updates[-1]["asset_status"]
    [entry] = final["checklist"]
    assert (entry["requirement"], entry["status"], entry["rounds"]) == (PURPLE, "met", 2) and "held" not in final
    assert final["checklist_summary"] == {"met": 1, "total": 1}


def test_a_person_s_edit_to_the_notebook_still_stops_an_ask_sent_there_with_no_genie_round_and_no_hold(agent_ns):
    inst, calls, runner, judged = _genie_tries(agent_ns, [("done", "")], IMPOSSIBLE)
    edited = agent_ns["implement_notebook_edited_message"]("/W/nb")

    def claim(use_case, spec, key, asset_status, current=""):
        raise agent_ns["ImplementBlocked"](edited)

    inst._implement_claim_notebook = claim
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        _run(inst, dict(VALID, vibes=PURPLE, vibe_previous="remove"))
    assert str(raised.value) == edited and runner.prompts == [] and judged == []
    assert all(update.get("status") != "vibe_not_met" for update in inst.updates), "the person's own edit is never turned into a hold"


def _ai_rows(statement):
    return [dict(row) for row in AI_ROWS] if "ai_explanation IS NOT NULL" in statement else []


def _ai_tries(agent_ns, verdicts):
    status = dict(json.loads(json.dumps(REBUILT)), ai_reasoning={"state": "ready", "spec_version": 2},
                  notebook={"state": "ready", "spec_version": 2, "modified_at": 1000,
                            "result_history": agent_ns["IMPLEMENT_RESULT_HISTORY"]})
    return _genie_tries(agent_ns, verdicts, {"routes": [{"ask": 1, "asset": "ai_reasoning", "words": SPANISH}]}, _ai_rows, status)


def test_an_ai_reasoning_ask_the_built_notebook_misses_goes_to_genie_and_is_met_in_its_first_round(agent_ns):
    inst, calls, runner, judged = _ai_tries(agent_ns, [("missing", ENGLISH), ("done", "")])
    assert _run(inst, dict(VALID, vibes=SPANISH, vibe_previous="remove")) in ("ready", "ready_with_warnings"), inst.updates[-1]
    assert len(runner.prompts) == 1 and len(judged) == 2, "the run of the built notebook missed the ask, so Genie got a round"
    assert agent_ns["IMPLEMENT_BUILT_NOTEBOOK_VIBES_LEAD"] in runner.prompts[0]
    assert f"for the AI reasoning, '{SPANISH}': {ENGLISH}" in runner.prompts[0]
    assert len([call for call in calls if call[0] == "write"]) == 1
    final = inst.updates[-1]["asset_status"]
    [entry] = final["checklist"]
    assert (entry["part"], entry["status"], entry["rounds"]) == ("ai_reasoning", "met", 1)
    plans = [event["message"] for event in inst.emitted if event["step_name"] == "Plan"]
    assert plans[-1].startswith("the run of the built notebook missed the user's asks with no Genie round (1. for the AI reasoning")
    assert "so Genie rebuilds the notebook with up to 3 rounds to meet them" in plans[-1]


def test_an_ai_reasoning_ask_genie_cannot_meet_holds_only_after_three_genie_rounds(agent_ns):
    inst, calls, runner, judged = _ai_tries(agent_ns, [("missing", ENGLISH)])
    assert _run(inst, dict(VALID, vibes=SPANISH, vibe_previous="remove")) == "vibe_not_met"
    assert len(runner.prompts) == 3 and len(judged) == 4, "one check of the built notebook, then one per Genie round"
    final = inst.updates[-1]["asset_status"]
    [entry] = final["checklist"]
    assert (entry["part"], entry["status"], entry["rounds"]) == ("ai_reasoning", "not_met", 3)
    assert entry["tried"] == [f"round {n}: {ENGLISH}" for n in (1, 2, 3)], "the check of the built notebook was no Genie round"


def _carried_alert(agent_ns, alert_verdicts, rounds=0):
    inst, previous = _locked(agent_ns, {"alert_vibes": WEEKDAYS})
    _carrying_status(inst, alert={"vibes_checks": [{"ask": WEEKDAYS, "status": "done", "evidence": "fires on weekdays only"}],
                                  "snapshot": True, "spec_version": 2})
    inst._implement_snapshot = lambda key, name, version: {"artifact": dict(ALERT), "vibes": WEEKDAYS, "spec_version": 2, "merged_into": ""}
    seen, deployed, judged = [], [], []

    def alert(context, runner):
        seen.append(((context.get("rebuild") or {}).get("alert"), list(context["spec"]["retry_outputs"])))
        if rounds:
            context.setdefault("genie_rounds", {})["alert"] = rounds
        context.setdefault("artifacts", {})["alert"] = dict(ALERT)
        inst._implement_publish_barrier(context, "alert", dict(ALERT))
        return {"alert_id": "al-1", "alert_url": "https://h/al"}

    def llm(kind, prompt, schema):
        if kind == "split":
            text = prompt.split('"""\n', 1)[1].split('\n"""', 1)[0]
            return {"asks": [{"ask": " ".join(text.split()), "check": None}]}
        judged.append(prompt)
        shown = next(line[2:] for line in prompt.split("<<<\n", 1)[1].split("\n>>>", 1)[0].splitlines() if line.startswith("- "))
        alerts = sum(": Alert (" in p for p in judged)
        verdict = alert_verdicts[min(alerts, len(alert_verdicts)) - 1] if ": Alert (" in prompt else "done"
        return {"checks": [{"n": 1, "status": verdict, "evidence": shown if verdict == "done" else "it fires every day", "where": ""}]}

    inst._implement_alert, inst._implement_vibes_llm = alert, llm
    inst._implement_runner = lambda uc: "genie"
    inst._implement_dashboard = _dashboard(inst, deployed)
    return inst, previous, seen, judged


def test_an_ask_the_live_alert_met_that_its_saved_copy_now_misses_goes_to_genie_on_the_alert(agent_ns):
    inst, previous, seen, judged = _carried_alert(agent_ns, ["missing", "done"])
    assert _run(inst, _asked(previous)) == "ready", inst.updates[-1]
    rebuild, retried = seen[0]
    assert retried == ["alert"] and rebuild["again"] == {"alert": [WEEKDAYS]}, "the alert is rebuilt with the missed ask, not held"
    final = inst.updates[-1]["asset_status"]
    [entry] = [e for e in final["checklist"] if e["requirement"] == WEEKDAYS]
    assert entry["status"] == "met" and "held" not in final
    plans = [e["message"] for e in inst.emitted if e["step_name"] == "Plan"]
    assert plans[-1].startswith("the live Alert no longer show the user's asks they met before (1. for the Alert, 'Only check on "
                                "weekdays': it fires every day), so Genie rebuilds them with up to 3 rounds")


def test_an_ask_the_live_alert_met_holds_only_after_genie_s_rounds_on_the_alert_and_says_how_many(agent_ns):
    inst, previous, seen, judged = _carried_alert(agent_ns, ["missing"], rounds=3)
    assert _run(inst, _asked(previous)) == "vibe_not_met"
    assert len(seen) == 1 and seen[0][1] == ["alert"]
    final = inst.updates[-1]["asset_status"]
    [entry] = [e for e in final["held"]["unmet"] if e["requirement"] == WEEKDAYS]
    assert (entry["part"], entry["status"], entry["rounds"]) == ("alert", "not_met", 3)
    assert f"Alert: {WEEKDAYS}: Genie could not do it in 3 build rounds: it fires every day" in final["held"]["reason"]


def test_an_escalated_rebuild_refreshes_and_checks_the_outputs_that_read_its_results(agent_ns):
    inst, calls, runner, judged = _ai_tries(agent_ns, [("missing", ENGLISH), ("done", "")])
    gone = "the dashboard reads churn_score, which the rebuilt results no longer have"

    def dashboard(context, runner):
        calls.append(("dashboard", dict(context["spec"]["outputs"]), context["assets"].get("dashboard")))
        raise agent_ns["ImplementBlocked"](gone)

    inst._implement_dashboard = dashboard
    assert _run(inst, dict(VALID, vibes=SPANISH, vibe_previous="remove")) == "ready_with_warnings", inst.updates[-1]
    assert len(runner.prompts) == 1
    assert [call[0] for call in calls if call[0] in ("genie_space", "dashboard", "app")] == ["genie_space", "dashboard", "app"], \
        "every output that reads the rebuilt results is refreshed in the same version"
    final = inst.updates[-1]
    assert final["asset_status"]["dashboard"]["state"] == "failed" and gone in final["status_message"]
    plans = [event["message"] for event in inst.emitted if event["step_name"] == "Plan"]
    assert plans[-1].endswith("and Inspire refreshes and checks the Genie Agent, Dashboard, App that read its results")



def test_a_settings_change_the_owner_check_refuses_is_refused_before_routing_with_zero_genie_rounds(agent_ns):
    inst, seen, _run_it = _settings_run(agent_ns, {"act_now_share": "0.05"}, {"act_now_share": "0.1"})
    vibed = _settings_spec({"act_now_share": "0.1"})
    vibed.update(vibes="Put the riskiest customers first", vibe_previous="keep")
    updates, asked = [], []
    inst._implement_update = lambda key, **fields: updates.append(json.loads(json.dumps(fields, default=str)))
    inst._implement_vibes_llm = lambda kind, *args, **kwargs: asked.append(kind) or pytest.fail("the refusal comes before any model call")
    with pytest.raises(agent_ns["ImplementBlocked"]):
        inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 2, "spec_json": vibed,
                                    "created_by": "sam.ortiz@x.co"}, (5150, "N01-U01", 2))
    assert asked == [] and seen == {"genie": 0, "notebook": 0}, "no routing, no Genie round, no notebook rebuild before the refusal"
    checklist = [u for u in updates if "checklist" in (u.get("asset_status") or {})][-1]["asset_status"]["checklist"]
    assert checklist and {(e["status"], e.get("kind"), e["rounds"]) for e in checklist} == {("refused", "settings_refused", 0)}
    assert agent_ns["implement_unmet_asks"]({"checklist": checklist}) == [], "a refused setting is never a held ask"

def _writers(tree):
    found = {"not_met": set(), "held": set(), "not_decided": set(), "refused": set()}

    def visit(node, owner):
        for child in ast.iter_child_nodes(node):
            name = child.name if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)) else owner
            if isinstance(child, ast.Dict):
                for key, value in zip(child.keys, child.values):
                    values = [value.body, value.orelse] if isinstance(value, ast.IfExp) else [value]
                    if isinstance(key, ast.Constant) and key.value == "status" and any(
                            isinstance(v, ast.Constant) and v.value == "not_met" for v in values):
                        found["not_met"].add(owner)
                    if isinstance(key, ast.Constant) and key.value == "status" and any(
                            isinstance(v, ast.Constant) and v.value == "refused" for v in values):
                        found["refused"].add(owner)
                    if isinstance(key, ast.Constant) and key.value == "status" and any(
                            isinstance(v, ast.Name) and v.id == "IMPLEMENT_NOT_DECIDED" for v in values):
                        found["not_decided"].add(owner)
            if isinstance(child, ast.Call) and any(k.arg == "status" and isinstance(k.value, ast.Name)
                                                   and k.value.id == "IMPLEMENT_HELD_STATUS" for k in child.keywords):
                found["held"].add(owner)
            visit(child, name)

    visit(tree, "")
    return found


def test_only_the_checklist_writes_a_not_met_ask_and_only_the_hold_writes_a_held_version(agent_ns):
    tree = ast.parse(_agentload.agent_source())
    assert _writers(tree) == {"not_met": {"_implement_vibe_checklist", "_implement_untargeted_entry"}, "held": {"_implement_hold"},
                              "not_decided": {"implement_not_decided_entries"}, "refused": {"implement_settings_refused_entries"}}
    refusers = {owner for owner, call in _calls(tree) if call in ("implement_settings_refusal", "implement_settings_refused_entries")}
    assert refusers == {"_implement_settings_owner_check"}, "only the settings owner check refuses a setting"
    assert {owner for owner, call in _calls(tree) if call == "_implement_settings_owner_check"} == {"_implement_one_locked"}
    assert {owner for owner, call in _calls(tree) if call == "implement_not_decided_entries"} == {"_implement_route_vibe"}, \
        "an ask is not_decided only where the router could not place it, before any plan or Genie round"
    guards = {owner for owner, call in _calls(tree) if call == "_implement_keep_untargeted"}
    assert guards == {"_implement_genie_space.deploy", "_implement_page_spec.written"}, \
        "the unrequested-change guard runs only in the deploy step Genie's rounds call, so it holds only after them"
    callers = {owner for owner, call in _calls(tree) if call == "_implement_hold"}
    assert callers == {"_implement_one_locked"}
    assert "implement_not_routed_entries" not in agent_ns and "not_routed" not in json.dumps(agent_ns["IMPLEMENT_VIBE_ROUTE_SCHEMA"])
    stray = _writers(ast.parse("def stray():\n    return {'status': 'not_met', 'rounds': 0}\n"))
    assert stray["not_met"] == {"stray"}, "the sweep finds a not-met entry written anywhere"
    assert _writers(ast.parse("def stray():\n    return {'status': 'refused'}\n"))["refused"] == {"stray"}


def _calls(tree):
    found = []

    def visit(node, owner):
        for child in ast.iter_child_nodes(node):
            name = f"{owner}.{child.name}".lstrip(".") if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)) else owner
            if isinstance(child, ast.Call) and isinstance(child.func, (ast.Attribute, ast.Name)):
                found.append((owner, child.func.attr if isinstance(child.func, ast.Attribute) else child.func.id))
            visit(child, name)

    visit(tree, "")
    return found


def test_the_checklist_is_the_one_source_of_unmet_asks(agent_ns):
    unmet = agent_ns["implement_unmet_asks"]
    missed = {"dashboard": {"vibes_checks": [{"ask": ASK, "status": "missing", "evidence": "x"}]}}
    status = dict(missed, checklist=[dict(UNMET, status="met"), dict(UNMET, n=2, requirement="Show the region")])
    assert [e["requirement"] for e in unmet(status)] == ["Show the region"], \
        "a met checklist entry never holds, even when an older per-output check said missing"
    assert unmet(missed) == [], "without this run's checklist nothing holds: the per-output checks are never a second source"
    assert unmet({"checklist": "not a list"}) == [] and unmet(None) == []


def _history(rows):
    def responder(statement):
        if statement.startswith("DESCRIBE HISTORY"):
            return [dict(row) for row in rows]
    return responder


def _restorer(agent_ns, rows, imported=None):
    inst = _inspire(agent_ns, FakeSpark(responder=_history(rows)))
    pointed = []
    inst._implement_job_notebook = lambda name, path: pointed.append((name, path)) or True
    inst._implement_import_notebook = lambda path, text: (imported if imported is not None else []).append((path, text))
    return inst, pointed


def test_a_hold_points_the_job_back_at_the_live_notebook_and_restores_the_result_table(agent_ns):
    rows = [{"version": 12, "job": {"jobId": "77"}}, {"version": 11, "job": {"jobId": "77"}}, {"version": 10, "job": {"jobId": "77"}}]
    imported = []
    inst, pointed = _restorer(agent_ns, rows, imported)
    context = {"notebook_path": "/W/v3/nb", "use_case": {"_implement_job_name": "inspire_n01_u01"}}
    live = {"notebook_path": "/W/v2/nb", "tables": {"main.s.result": 10}, "notebook_text": "live text"}
    notes = inst._implement_restore_live("N01-U01", context, live, 77)
    assert pointed == [("inspire_n01_u01", "/W/v2/nb")] and imported == [("/W/v2/nb", "live text")]
    assert "RESTORE TABLE `main`.`s`.`result` TO VERSION AS OF 10" in inst.spark.statements
    assert notes == ["the job runs the live notebook /W/v2/nb again", "the live notebook /W/v2/nb is back as it was",
                     "main.s.result is back at its version 10, from before this build"]


@pytest.mark.parametrize("newer", [{"version": 11, "job": {"jobId": "999"}}, {"version": 11, "job": None}])
def test_a_change_from_outside_the_use_case_s_jobs_keeps_the_table_as_it_is(agent_ns, newer):
    inst, _ = _restorer(agent_ns, [{"version": 12, "job": {"jobId": "77"}}, newer, {"version": 10, "job": {"jobId": "77"}}])
    live = {"notebook_path": "/W/v2/nb", "tables": {"main.s.result": 10}, "notebook_text": None}
    notes = inst._implement_restore_live("N01-U01", {"notebook_path": "/W/v2/nb", "use_case": {}}, live, 77)
    assert not any(s.startswith("RESTORE") for s in inst.spark.statements), "an App edit or another job's rows are never rolled away"
    assert notes == ["main.s.result keeps the rows this build wrote, because 1 of its 2 changes since the build started came from "
                     "outside this use case's jobs, such as an edit in the App"]


def test_a_first_build_that_holds_has_nothing_live_to_put_back(agent_ns):
    inst, pointed = _restorer(agent_ns, [])
    notes = inst._implement_restore_live("N01-U01", {"notebook_path": "/W/v1/nb", "use_case": {}},
                                         {"notebook_path": "", "tables": {"main.s.result": None}, "notebook_text": None}, 77)
    assert pointed == [] and notes == ["nothing was live yet, so the held notebook is the job's notebook until it is published"]
    assert inst.spark.statements == []
    assert agent_ns["implement_held_reason"]([UNMET], 1, None).startswith(
        "1 ask is not met, so nothing of v1 is published and nothing is live yet")


def test_the_next_version_diffs_against_the_live_one_and_never_carries_a_held_row(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    rows = [{"spec_version": 3, "status": "vibe_not_met", "notebook_path": "/W/v3/nb", "dashboard_id": "d-held",
             "asset_status": {"dashboard": {"state": "ready", "spec_version": 3}}},
            {"spec_version": 2, "status": "ready", "notebook_path": "/W/v2/nb", "dashboard_id": "d1",
             "asset_status": {"dashboard": {"state": "ready", "spec_version": 2}}}]
    seen = []
    inst._implement_select = lambda where, args, order=None: seen.append(where) or [dict(r) for r in rows]
    carried, status = inst._implement_carried({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 4})
    assert (carried["notebook_path"], carried["dashboard_id"], status["dashboard"]["spec_version"]) == ("/W/v2/nb", "d1", 2)
    own, own_status = inst._implement_carried({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3}, through_own=True)
    assert own["dashboard_id"] == "d-held", "the held version's own run still reads its own row"
    inst._implement_previous({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 4})
    assert "status IN ('ready', 'ready_with_warnings', :gone)" in seen[-1], "a held spec is never the version the next one diffs against"


@pytest.mark.parametrize("value,error,kept", [
    (3, [], 3), ("2", [], 2), (None, [], None), ("", [], None),
    (0, ["publish_held 0 must be a version number, 1 or more"], None),
    (True, ["publish_held true must be a version number, 1 or more"], None),
    (1.5, ["publish_held 1.5 must be a version number, 1 or more"], None),
])
def test_publish_held_is_a_whole_version_number(agent_ns, value, error, kept):
    spec, errors = _spec(agent_ns, publish_held=value)
    assert errors == error
    if not error:
        assert spec.get("publish_held") == kept


WEEKDAYS = "Only check on weekdays"
ALERT = {"condition_text": "", "condition_sql": "SELECT 1", "name": "Churn alert", "trigger": "fires on weekdays only",
         "schedule": "every weekday at 06:00", "destinations": ["owner@example.com"]}


def _carrying_status(inst, **records):
    status = _left_by(2, json.loads(json.dumps(LIVE)))
    for name, record in records.items():
        status[name] = dict(status.get(name) or {}, **record) if isinstance(record, dict) and name in status else record
    inst._implement_carried = lambda target: (dict(BUILT), json.loads(json.dumps(status)))


def _alert(inst, seen):
    def build(context, runner):
        seen.append(((context.get("rebuild") or {}).get("alert"), list(context["spec"]["retry_outputs"])))
        context.setdefault("artifacts", {})["alert"] = dict(ALERT)
        inst._implement_publish_barrier(context, "alert", dict(ALERT))
        return {"alert_id": "al-1", "alert_url": "https://h/al"}
    return build


def test_an_output_whose_stored_ask_is_unmet_goes_back_to_genie_as_a_retry_even_when_nothing_else_changed(agent_ns):
    inst, previous = _locked(agent_ns, {"alert_vibes": WEEKDAYS})
    _carrying_status(inst, alert={"vibes_checks": [{"ask": WEEKDAYS, "status": "missing", "evidence": "it fires every day"}]})
    seen = []
    inst._implement_alert = _alert(inst, seen)
    _verdicts(inst, [WEEKDAYS], status="done")
    assert _run(inst, previous) == "ready"
    rebuild, retried = seen[0]
    assert retried == ["alert"] and rebuild["again"] == {"alert": [WEEKDAYS]}, \
        "the stored unmet ask turns off the alert's reuse of its old condition and reaches Genie as an ask to try again"
    assert len(seen) == 2, "the checked candidate is published once after every ask is met"
    stored = [u for u in inst.updates if "spec_json" in u]
    assert all(u["spec_json"].get("retry_outputs", []) == [] for u in stored), "the stored spec keeps what the person sent"


def test_an_older_version_s_checklist_never_holds_a_new_version(agent_ns):
    inst, previous = _locked(agent_ns)
    stale = [dict(UNMET, published_anyway={"by": "owner@example.com", "at": "2026-01-01T00:00:00Z"})]
    _carrying_status(inst, checklist=stale, checklist_summary={"met": 0, "total": 1}, published_held={"version": 2},
                     held={"parts": ["dashboard"]})
    deployed = []
    inst._implement_runner = lambda uc: "genie"
    inst._implement_dashboard = _dashboard(inst, deployed)
    _verdicts(inst, [ASK], status="done")
    assert _run(inst, _asked(previous)) == "ready", "only this version's own checks decide whether it holds"
    final = inst.updates[-1]["asset_status"]
    assert deployed == [CHART] and not {"published_held", "held"} & set(final)
    assert [(e["status"], e["published_anyway"]) for e in final["checklist"]] == [("met", None)], \
        "the checklist is written on every run that holds asks, so the final status holds this run's own, never the stale one"
    assert final["checklist_summary"] == {"met": 1, "total": 1}


def test_an_ask_already_met_before_never_holds_and_only_an_unmet_live_ask_is_retried(agent_ns):
    already = agent_ns["IMPLEMENT_VIBES_ALREADY"] + "Runs at 07:00 every day (Asia/Dubai)"
    entry = dict(UNMET, status="met", evidence=already, already_there=True)
    assert agent_ns["implement_unmet_asks"]({"checklist": [entry]}) == [], \
        "an ask the built version meets is met, even when the version before met it too, so it never holds"
    spec = {"outputs": {"dashboard": True, "dashboard_vibes": ASK, "dashboard:by_region_vibes": "Show the region"}}
    status = {"dashboard": {"vibes_checks": [{"ask": ASK, "status": "done", "evidence": already}]},
              "dashboard:by_region": {"vibes_checks": [{"ask": "Show the region", "status": "missing", "evidence": "x"}]}}
    assert agent_ns["implement_live_unmet"](status, spec) == {"dashboard:by_region": ["Show the region"]}, \
        "the live version's unmet asks, by part, are what a held rebuild sends back to Genie, never an ask already met"
    assert agent_ns["implement_live_unmet"](status, {"outputs": {}}) == {}, "an ask the spec no longer holds is never retried"



def test_publish_anyway_cannot_run_with_uninstall_all(agent_ns):
    spec, errors = _spec(agent_ns, publish_held=2, uninstall=True)
    assert errors == ["Publish anyway puts a held version live, so it cannot run with Uninstall All in the same version"]
    assert "publish_held" not in spec


ROUTED = "Keep the region filter"
PAGE_ID = "app:page:n01_u01"


def _routing_llm(inst, verdict="missing"):
    def llm(kind, prompt, schema):
        if kind == "route":
            return {"routes": [{"ask": 1, "asset": PAGE_ID, "words": ROUTED}]}
        if kind == "split":
            return {"asks": [{"ask": ROUTED, "check": None}]}
        return {"checks": [{"n": 1, "status": verdict, "evidence": "the page has no region filter"}]}

    inst._implement_vibes_llm = llm


def _app(inst, deployed):
    def build(context, runner):
        replay = (context.get("replay") or {}).get("app")
        artifact = json.loads(json.dumps(replay[1]["artifact"] if replay else PAGE))
        context.setdefault("artifacts", {})["app"] = artifact
        inst._implement_publish_barrier(context, "app", artifact)
        deployed.append(artifact)
        return {"app_name": "churn-desk", "app_url": "https://a"}
    return build


def test_a_held_version_stores_a_spec_that_validates_clean_for_try_again_and_publish_anyway(agent_ns):
    inst, previous = _locked(agent_ns)
    status = _left_by(2, json.loads(json.dumps(LIVE)))
    status.update(json.loads(json.dumps(PARTS)))
    inst._implement_carried = lambda target: (dict(BUILT), json.loads(json.dumps(status)))
    deployed = []
    inst._implement_runner = lambda uc: "genie"
    inst._implement_app = _app(inst, deployed)
    _routing_llm(inst)
    sent = dict(previous, vibes=ROUTED, vibe_previous="remove")
    assert _run(inst, sent) == "vibe_not_met" and deployed == []
    stored = next(u["spec_json"] for u in inst.updates if u.get("status") == "vibe_not_met")
    assert stored == dict(sent, outputs=dict(sent["outputs"], **{f"{PAGE_ID}_vibes": ROUTED}), retry_outputs=[PAGE_ID]), \
        "the held spec is the sent spec, its routed asks and the parts they rebuild"
    validate, problems = agent_ns["validate_implement_spec"], agent_ns["implement_part_problems"]
    clean, errors = validate(json.loads(json.dumps(stored)))
    assert errors == [] and problems(status, validate(previous)[0], clean) == []
    published, errors = validate(dict(json.loads(json.dumps(stored)), publish_held=3, based_on_version=3))
    assert errors == [] and published["publish_held"] == 3
    bare, _ = validate(dict(json.loads(json.dumps(stored)), retry_outputs=[]))
    assert problems(status, validate(previous)[0], bare) == [
        "the vibes for the App page n01_u01 changed, so list app:page:n01_u01 in retry_outputs to rebuild it with them"], \
        "without its retry_outputs the same spec is refused, which is what the held spec avoids"


def test_a_published_version_keeps_the_spec_it_was_sent_with_its_routed_asks_only(agent_ns):
    inst, previous = _locked(agent_ns)
    status = _left_by(2, json.loads(json.dumps(LIVE)))
    status.update(json.loads(json.dumps(PARTS)))
    inst._implement_carried = lambda target: (dict(BUILT), json.loads(json.dumps(status)))
    inst._implement_runner = lambda uc: "genie"
    inst._implement_app = _app(inst, [])
    _routing_llm(inst, verdict="done")
    inst._implement_vibes_llm = (lambda base: lambda kind, prompt, schema: (
        {"checks": [{"n": 1, "status": "done", "evidence": "Region", "where": "filters"}]} if kind not in ("route", "split")
        else base(kind, prompt, schema)))(inst._implement_vibes_llm)
    sent = dict(previous, vibes=ROUTED, vibe_previous="remove")
    assert _run(inst, sent) in ("ready", "ready_with_warnings")
    stored = inst.updates[-1]["spec_json"]
    assert "retry_outputs" not in stored or stored["retry_outputs"] == sent.get("retry_outputs"), \
        "a published version never asks the next one to rebuild a part again"


def test_a_hold_puts_the_job_s_tasks_widget_values_and_tags_back(agent_ns):
    inst, _ = _restorer(agent_ns, [])
    live_task = {"task_key": "main", "notebook_task": {"notebook_path": "/W/v2/nb", "base_parameters": {"top_k": "25"}}}
    saved = {"tags": {"inspire_version": "v2"}, "tasks": [live_task], "max_concurrent_runs": 1}
    calls = []

    def api(method, path, body=None, query=None):
        calls.append((method, path, body, query))
        return {"settings": {"tags": {"inspire_version": "v3"}, "schedule": {"pause_status": "PAUSED"}, "max_concurrent_runs": 1,
                             "tasks": [dict(live_task, notebook_task={"notebook_path": "/W/v3/nb", "base_parameters": {"top_k": "40"}})]}}

    inst._implement_api = api
    inst._implement_job_notebook = lambda name, path: pytest.fail("the saved settings put the notebook back with the rest")
    wrote = {"tags": {"inspire_version": "v3"}, "tasks": ["main"], "settings": ["max_concurrent_runs", "queue"], "schedule": True}
    notes = inst._implement_restore_live("N01-U01", {"notebook_path": "/W/v3/nb", "use_case": {"_implement_job_writes": wrote}},
                                         {"notebook_path": "/W/v2/nb", "tables": {}, "notebook_text": None, "job": saved}, 77)
    assert notes == ["the job's notebook, widget values and tags are back as they were before this build"]
    [(method, path, body, _q)] = [c for c in calls if c[0] == "POST"]
    assert (method, path) == ("POST", "/api/2.2/jobs/update")
    assert body == {"job_id": 77, "new_settings": {"tasks": [live_task], "max_concurrent_runs": 1, "tags": {"inspire_version": "v2"}},
                    "fields_to_remove": ["schedule"]}, "a schedule the build added is removed and each tag gets its live value back"


def _candidate(inst, name):
    def build(context, runner):
        context.setdefault("artifacts", {})[name] = {"title": name}
        inst._implement_publish_barrier(context, name, {"title": name})
        return {}
    return build


def _job_hold(agent_ns, change):
    inst, previous = _locked(agent_ns)
    for name in ("genie_space", "app", "alert"):
        setattr(inst, f"_implement_{name}", _candidate(inst, name))
    calls = []

    def api(method, path, body=None, query=None):
        calls.append((method, path, body))
        return {"settings": {"tags": {"inspire_version": "v2"}, "tasks": [{"task_key": "main"}]}}

    inst._implement_api = api
    inst._implement_runner = lambda uc: "genie"
    inst._implement_dashboard = _dashboard(inst, [])
    previews = []

    def preview(uc_id, key, use_case, spec, previous_spec, path, names, runner, refill):
        previews.append(refill)
        use_case["_implement_job_writes"] = {"tags": {"inspire_version": "v3"}, "tasks": ["main"], "settings": [], "schedule": False}
        return {"status": "written", "rows_written": 12}, 77, {}

    inst._implement_fill_and_preview = preview
    inst._implement_refresh_run_controls = lambda uc_id, key, use_case, spec_nb, path, status, warnings: None
    inst._implement_write_notebook = lambda use_case, spec, previous_spec, key, current="": "/W/v3/nb"
    _verdicts(inst, [ASK], status="missing", evidence="the chart sorts by name")
    assert _run(inst, change(_asked(previous))) == "vibe_not_met"
    return inst, calls, previews


def test_a_held_build_that_never_launched_the_job_leaves_the_job_alone(agent_ns):
    inst, calls, previews = _job_hold(agent_ns, lambda spec: spec)
    assert previews == [] and [c[:2] for c in calls] == [("GET", "/api/2.2/jobs/get")], \
        "a dashboard-only change never launches the job, so the hold reads it once and changes nothing on it"
    assert "this build changed none of the job's settings, so the job is as it was" in inst.updates[-1]["status_message"]


def test_a_held_build_that_ran_the_preview_restores_what_the_launch_wrote(agent_ns):
    def widened(spec):
        return dict(spec, config=dict(spec["config"], widgets=dict(spec["config"]["widgets"], top_k=30)))

    inst, calls, previews = _job_hold(agent_ns, widened)
    assert previews == [True], "a widget change rebuilds the notebook and launches its preview, which writes the job"
    assert [c[:2] for c in calls] == [("GET", "/api/2.2/jobs/get"), ("GET", "/api/2.2/jobs/get"), ("POST", "/api/2.2/jobs/update")]
    assert calls[-1][2]["new_settings"] == {"tasks": [{"task_key": "main"}], "tags": {"inspire_version": "v2"}}
    assert "the job's notebook, widget values and tags are back as they were before this build" in inst.updates[-1]["status_message"]


def test_a_job_whose_settings_could_not_be_read_is_still_pointed_back_at_the_live_notebook(agent_ns):
    inst, pointed = _restorer(agent_ns, [])
    notes = inst._implement_restore_live("N01-U01", {"notebook_path": "/W/v3/nb", "use_case": {"_implement_job_name": "job"}},
                                         {"notebook_path": "/W/v2/nb", "tables": {}, "notebook_text": None, "job": None}, 77)
    assert pointed == [("job", "/W/v2/nb")] and notes == ["the job runs the live notebook /W/v2/nb again"]


def test_a_rollback_whose_saved_ask_is_unmet_holds_with_no_genie_round(agent_ns):
    inst, previous = _locked(agent_ns, {"dashboard_vibes": ASK})
    deployed, read = [], []
    inst._implement_snapshot = lambda key, name, version: read.append((name, version)) or {
        "artifact": CHART, "vibes": ASK, "spec_version": 1, "merged_into": ""}
    inst._implement_runner = lambda uc: pytest.fail("a rollback asks Genie nothing")
    inst._implement_dashboard = _dashboard(inst, deployed)
    _verdicts(inst, [ASK], status="missing", evidence="the chart sorts by name")
    assert _run(inst, dict(previous, rollback_outputs={"dashboard": 1})) == "vibe_not_met"
    assert ("dashboard", 1) in read and deployed == [], "the rolled-back dashboard is checked but never deployed"
    final = inst.updates[-1]
    assert final["asset_status"]["held"]["candidates"] == ["dashboard"]
    saved = json.loads(next(u for u in inst.updates if "asset_snapshots" in u)["asset_snapshots"])
    assert saved["dashboard"]["artifact"] == CHART and saved["dashboard"]["held"] is True


def test_publish_anyway_previews_the_held_notebook_again_with_no_genie_round(agent_ns):
    row = _held_row()
    row.update(notebook_path="/W/v3/nb", job_id=77)
    row["asset_status"]["held"]["notebook"] = "/W/v3/nb"
    row["asset_status"]["notebook"] = {"modified_at": 1700000000000, "spec_version": 3, "result_history": 1}
    inst, target, deployed, _ = _publishing(agent_ns, row)
    previews = []
    inst._implement_fill_and_preview = lambda uc_id, key, use_case, spec, previous, path, names, runner, refill: (
        previews.append((path, runner, refill)) or ({"status": "written", "rows_written": 12}, 77, {}))
    assert inst._implement_one_locked(target, (5150, "N01-U01", 4)) == "ready_with_warnings"
    assert previews == [("/W/v3/nb", None, False)], "the held notebook is previewed as it is, with no Genie runner"
    assert deployed == [CHART]
    assert {u["notebook_path"] for u in inst.updates if "notebook_path" in u} == {"/W/v3/nb"}, "the row points at the held notebook"


def test_the_real_genie_agent_builder_stops_at_the_barrier_and_publishes_the_candidate_later(agent_ns, tmp_path):
    inst, calls, _ran = _space_inspire(agent_ns, tmp_path)
    context = dict(_output_context(agent_ns), hold_mode=True)
    runner = _FileRunner([{"exit": 0}], [{"genie_space.json": _definition(_rich_space())}])
    with pytest.raises(agent_ns["ImplementCandidate"]) as held:
        inst._implement_genie_space(context, runner)
    assert held.value.name == "genie_space" and held.value.artifact["title"] == "Churn desk"
    assert not [c for c in calls if c[0] in ("POST", "PATCH", "PUT")], "a held Genie Agent writes nothing to the workspace"
    candidate = {"artifact": held.value.artifact, "vibes": "", "spec_version": 3, "merged_into": "", "held": True}
    context.update(replay={"genie_space": (3, candidate)}, publishing={"genie_space"})
    fields = inst._implement_genie_space(context, _NoGenie())
    assert fields["genie_space_id"] and len(_calls_to(calls, "POST", "/api/2.0/genie/spaces")) == 1


def test_the_real_dashboard_builder_stops_at_the_barrier_before_it_writes(agent_ns, tmp_path):
    inst, context, seen = _flow(agent_ns, tmp_path)
    context["hold_mode"] = True
    with pytest.raises(agent_ns["ImplementCandidate"]) as held:
        inst._implement_dashboard(context, _pages(_churn_page(agent_ns)))
    assert held.value.name == "dashboard" and held.value.artifact == context["page_spec"]
    assert _published(seen) == [] and seen["deployed"] == [], "a held dashboard creates and publishes nothing"
    assert seen["queries"], "Inspire's own checks ran before the barrier"


def test_the_real_app_builder_stops_at_the_barrier_before_it_deploys(agent_ns, tmp_path):
    inst, context, seen = _flow(agent_ns, tmp_path, outputs={"dashboard": False})
    context["hold_mode"] = True
    with pytest.raises(agent_ns["ImplementCandidate"]) as held:
        inst._implement_app(context, _pages(_churn_page(agent_ns)))
    assert held.value.name == "app" and held.value.artifact["title"]
    assert seen["deployed"] == [] and seen["checked"], "the App's checks ran and nothing was deployed"


def test_an_ask_the_judge_could_not_check_holds_and_says_to_try_again(agent_ns):
    inst, previous = _locked(agent_ns)
    inst._implement_runner = lambda uc: "genie"
    inst._implement_dashboard = _dashboard(inst, [])

    def busy(kind, prompt, schema):
        raise RuntimeError("[REQUEST_LIMIT_EXCEEDED] the endpoint is busy")

    inst._implement_vibes_llm = busy
    assert _run(inst, _asked(previous)) == "vibe_not_met"
    final = inst.updates[-1]["asset_status"]
    [entry] = final["checklist"]
    assert (entry["status"], entry["unchecked"]) == ("not_met", True)
    assert entry["evidence"] == ("Inspire could not check this ask: [REQUEST_LIMIT_EXCEEDED] the endpoint is busy. Nothing shows the ask "
                                 "was missed: press Try again to check it again")
    assert final["held"]["unmet"] == [entry], "the held list and the checklist entry are one record"
    fact = entry["evidence"].removesuffix(": press Try again to check it again")
    assert f"Dashboard: {ASK}: {fact}." in final["held"]["reason"] and final["held"]["reason"].count("Try again") == 1, \
        "the held reason quotes the entry's fact and names the action once"
    assert final["held"]["reason"].startswith("1 ask could not be checked, so nothing of v3 is published")
    assert final["held"]["reason"].endswith("Press Try again to check it again, or press Publish anyway")


def test_a_mix_of_missed_and_unchecked_asks_names_both(agent_ns):
    reason = agent_ns["implement_held_reason"]
    missed = {"requirement": ASK, "part": "dashboard", "evidence": "x", "status": "not_met"}
    unchecked = dict(missed, requirement="Show the region", unchecked=True)
    both = reason([missed, unchecked], 3, 2)
    assert both.startswith("2 asks are not met or could not be checked, so nothing of v3 is published")
    assert both.endswith("Rephrase the asks or press Try again, or press Publish anyway")
    assert reason([missed], 3, 2).startswith("1 ask is not met, so nothing of v3 is published")



def test_the_hold_reads_the_checklist_this_run_wrote_and_never_one_written_after_it(agent_ns):
    inst, previous = _locked(agent_ns)
    order = []
    inst._implement_runner = lambda uc: "genie"
    inst._implement_dashboard = _dashboard(inst, [])
    _verdicts(inst, [ASK], status="missing", evidence="the chart sorts by name")
    write, hold = inst._implement_vibe_checklist, inst._implement_hold
    inst._implement_vibe_checklist = lambda context: order.append("checklist") or write(context)

    def held(uc_id, key, context, live, unmet, *args):
        order.append("hold")
        assert unmet == [e for e in context["asset_status"]["checklist"] if e["status"] == "not_met"] and unmet, \
            "the hold decides on the entries the checklist holds at that moment"
        return hold(uc_id, key, context, live, unmet, *args)

    inst._implement_hold = held
    assert _run(inst, _asked(previous)) == "vibe_not_met"
    assert order == ["checklist", "hold"], "the checklist is written before the hold decision reads it"
    late = _locked(agent_ns)[0]
    late._implement_runner = lambda uc: "genie"
    late._implement_dashboard = _dashboard(late, [])
    _verdicts(late, [ASK], status="missing", evidence="the chart sorts by name")
    late._implement_vibe_checklist = lambda context: []
    assert _run(late, _asked(previous)) == "ready_with_warnings", \
        "with no checklist written before the decision, nothing holds: the hold has no second source to fall back on"



def test_a_hold_removes_the_tags_and_tasks_the_build_added_because_the_jobs_api_merges_them(agent_ns):
    inst, _ = _restorer(agent_ns, [])
    live_task = {"task_key": "main", "notebook_task": {"notebook_path": "/W/v2/nb"}}
    calls = []

    def api(method, path, body=None, query=None):
        calls.append((method, path, body))
        return {"settings": {"tags": {"inspire_version": "v3", "held": "yes"}, "tasks": [live_task, {"task_key": "extra_check"}]}}

    inst._implement_api = api
    wrote = {"tags": {"inspire_version": "v3", "held": "yes"}, "tasks": ["main", "extra_check"], "settings": [], "schedule": False}
    assert inst._implement_restore_job(77, {"tags": {"inspire_version": "v2"}, "tasks": [live_task]}, wrote) == \
        "the job's notebook, widget values and tags are back as they were before this build"
    [body] = [c[2] for c in calls if c[0] == "POST"]
    assert body["new_settings"] == {"tasks": [live_task], "tags": {"inspire_version": "v2"}}
    assert body["fields_to_remove"] == ["tags", "tasks/extra_check"], \
        "the Jobs API merges tags and tasks by key, so a key the build added is removed in the same call that sets the live ones"
    calls.clear()
    assert inst._implement_restore_job(77, {"tasks": [live_task]}, wrote).startswith("the job's notebook")
    [body] = [c[2] for c in calls if c[0] == "POST"]
    assert "tags" not in body["new_settings"] and body["fields_to_remove"] == ["tags", "tasks/extra_check"], \
        "a job that had no tags is left with none"


class _NoGenie:
    def __getattr__(self, name):
        raise AssertionError(f"Publish anyway asks Genie nothing, yet the builder reached for {name}")


def _held_candidate(agent_ns, builder, context):
    context["hold_mode"] = True
    with pytest.raises(agent_ns["ImplementCandidate"]) as held:
        builder(context, _pages(_churn_page(agent_ns)))
    return held.value.name, {"artifact": json.loads(json.dumps(held.value.artifact)), "vibes": "", "spec_version": 3, "merged_into": "",
                             "held": True}


def _publishing_context(context, name, candidate):
    context.update(replay={name: (3, candidate)}, publishing={name})
    return context


def test_the_real_dashboard_builder_publishes_the_held_candidate_with_one_write_and_no_genie(agent_ns, tmp_path):
    held_inst, held_context, held_seen = _flow(agent_ns, tmp_path / "held")
    name, candidate = _held_candidate(agent_ns, held_inst._implement_dashboard, held_context)
    assert _published(held_seen) == [], "the held round wrote nothing"
    inst, context, seen = _flow(agent_ns, tmp_path / "publish")
    fields = inst._implement_dashboard(_publishing_context(context, name, candidate), _NoGenie())
    assert fields["dashboard_id"] == "d9"
    assert [c[:2] for c in _published(seen)] == [("POST", "/api/2.0/lakeview/dashboards"),
                                                 ("POST", "/api/2.0/lakeview/dashboards/d9/published")], \
        "Publish anyway creates the dashboard once and publishes it once"
    assert context["artifacts"]["dashboard"] == candidate["artifact"], "the stored candidate is what went live"
    assert _doc(seen)["pages"], "the dashboard written is the one built from the candidate's page spec"


def test_the_real_app_builder_publishes_the_held_candidate_with_one_deploy_and_no_genie(agent_ns, tmp_path):
    held_inst, held_context, held_seen = _flow(agent_ns, tmp_path / "held", outputs={"dashboard": False})
    name, candidate = _held_candidate(agent_ns, held_inst._implement_app, held_context)
    assert held_seen["deployed"] == [], "the held round deployed nothing"
    inst, context, seen = _flow(agent_ns, tmp_path / "publish", outputs={"dashboard": False})
    fields = inst._implement_app(_publishing_context(context, name, candidate), _NoGenie())
    assert fields["app_name"] and len(seen["deployed"]) == 1, "Publish anyway deploys the App once"
    page = json.loads(seen["deployed"][0][1]["pages/n01_u01.json"])
    assert page["title"] == candidate["artifact"]["title"] and context["artifacts"]["app"] == candidate["artifact"], \
        "the stored candidate is the page that went live"


ALREADY = "already there in the version before, so nothing needed to change for it: "
HBAR = dict(PAGE, charts=[dict(PAGE["charts"][0], type="horizontal_bar")])


def _chart_run(agent_ns, built, before):
    inst, previous = _locked(agent_ns)
    _carrying(inst)
    inst._implement_runner = lambda uc: "genie"
    inst._implement_app = _built("app", built)
    inst._implement_previous_artifact = lambda context, name, record: json.loads(json.dumps(before))
    inst._implement_vibe_chart_types = lambda name: ("bar", "horizontal_bar", "line")
    _part_llm(inst)
    status = _run(inst, _vibed(previous, ["app:page:n01_u01"], **{"app:page:n01_u01_vibes": WIDGET_VIBES}))
    final = inst.updates[-1]["asset_status"]
    return status, final, {e["requirement"]: e for e in final["checklist"]}


def test_a_chart_ask_the_version_before_already_met_is_met_with_the_note_and_the_version_publishes(agent_ns):
    status, final, entries = _chart_run(agent_ns, HBAR, HBAR)
    assert status in ("ready", "ready_with_warnings") and "held" not in final, (
        "the chart kind check proves the built chart is a horizontal bar, so the ask is met and never holds the version",
        (final.get("held") or {}).get("reason"))
    bar = entries["Make it a horizontal bar chart"]
    assert bar["status"] == "met" and bar["already_there"] is True and bar["evidence"].startswith(ALREADY)
    assert "already_there" not in entries["Keep the biggest regions first"], "a keep ask is met on what was there, so it needs no note"


def test_the_same_chart_ask_failing_on_the_built_chart_still_holds_whatever_the_version_before_had(agent_ns):
    status, final, entries = _chart_run(agent_ns, PAGE, HBAR)
    bar = entries["Make it a horizontal bar chart"]
    assert status == "vibe_not_met" and bar["status"] == "not_met" and "already_there" not in bar, \
        "the built chart is a plain bar, so the ask is not met even though the chart before was a horizontal bar"


def test_a_chart_ask_met_only_by_new_work_carries_no_already_there_note(agent_ns):
    status, final, entries = _chart_run(agent_ns, HBAR, PAGE)
    bar = entries["Make it a horizontal bar chart"]
    assert status in ("ready", "ready_with_warnings") and bar["status"] == "met" and "already_there" not in bar
    assert not bar["evidence"].startswith(ALREADY)


BUILT_AT = calendar.timegm((2026, 10, 30, 22, 0, 0)) * 1000
EDIT_1 = calendar.timegm((2026, 10, 31, 4, 0, 0)) * 1000
EDIT_2 = calendar.timegm((2026, 10, 31, 5, 30, 0)) * 1000
RESTORED_AT = calendar.timegm((2026, 10, 31, 6, 0, 0)) * 1000


def test_consent_given_for_one_edit_never_covers_a_later_edit(agent_ns, monkeypatch):
    inst, workspace, asked, spec, status = _claim(agent_ns, monkeypatch, EDIT_1, {"modified_at": BUILT_AT, "spec_version": 3})
    with pytest.raises(agent_ns["ImplementBlocked"]):
        inst._implement_claim_notebook({"No": "N01-U01"}, spec, (5150, "N01-U01", 4), status)
    assert status["notebook"]["edited_at"] == EDIT_1
    workspace.modified_at = EDIT_2
    agreed = dict(spec, confirm_notebook_overwrite=True)
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        inst._implement_claim_notebook({"No": "N01-U01"}, agreed, (5150, "N01-U01", 5), status)
    assert str(raised.value) == (f"the notebook {NB_PATH} was edited again at 2026-10-31 05:30 UTC, after the edit of 2026-10-31 04:00 UTC "
                                 "you agreed to overwrite, so this version did not rebuild it: look at the new edit, then build the notebook "
                                 "again with Edit MVP on the Build page to overwrite it, or keep it and change only the outputs or the schedule")
    assert status["notebook"]["state"] == "edited" and status["notebook"]["edited_at"] == EDIT_2 and workspace.imported == []
    assert inst._implement_claim_notebook({"No": "N01-U01"}, agreed, (5150, "N01-U01", 6), status) == NB_PATH, \
        "consent given while the second edit is the one on record covers that edit"


def test_consent_with_no_edit_on_record_blocks_once_and_then_names_the_edit(agent_ns, monkeypatch):
    inst, workspace, asked, spec, status = _claim(agent_ns, monkeypatch, EDIT_1, {"modified_at": BUILT_AT, "spec_version": 3},
                                                  confirm=True)
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        inst._implement_claim_notebook({"No": "N01-U01"}, spec, (5150, "N01-U01", 4), status)
    assert str(raised.value) == agent_ns["implement_notebook_edited_message"](NB_PATH), \
        "a consent sent before Inspire showed any edit is not consent to an edit the person never saw"
    assert status["notebook"]["edited_at"] == EDIT_1
    assert inst._implement_claim_notebook({"No": "N01-U01"}, spec, (5150, "N01-U01", 5), status) == NB_PATH


def _notebook_rows(agent_ns, monkeypatch):
    rows = {2: {"spec_version": 2, "status": "ready", "asset_status": {"notebook": {"modified_at": BUILT_AT, "spec_version": 2}}},
            3: {"spec_version": 3, "status": "vibe_not_met", "asset_status": {"notebook": {"modified_at": 999, "spec_version": 3}}}}
    inst, _pointed = _restorer(agent_ns, [])
    times = {"/W/v2/nb": BUILT_AT}
    inst._implement_import_notebook = lambda path, text: times.__setitem__(path, RESTORED_AT)
    inst._implement_notebook_modified_at = lambda path: times.get(path)
    inst._implement_select = lambda where, args, order=None: [json.loads(json.dumps(r)) for v, r in sorted(rows.items(), reverse=True)
                                                              if v < args["v"]]
    inst._implement_update = lambda key, **fields: rows.setdefault(key[2], {"spec_version": key[2]}).update(json.loads(json.dumps(fields)))
    inst._implement_notebook_paths = lambda uc, key: (f"/W/v{key[2]}", f"/W/v{key[2]}/nb")
    monkeypatch.setitem(agent_ns, "current_job_run_id", lambda: "1")
    return inst, rows, times


def test_a_hold_that_puts_the_live_notebook_back_records_inspire_s_write_so_try_again_is_not_blocked(agent_ns, monkeypatch):
    inst, rows, times = _notebook_rows(agent_ns, monkeypatch)
    live = {"notebook_path": "/W/v2/nb", "tables": {}, "notebook_text": "live text", "notebook_edited": False}
    inst._implement_restore_live("N01-U01", {"notebook_path": "/W/v2/nb", "use_case": {}, "key": (5150, "N01-U01", 3)}, live, None)
    assert rows[2]["asset_status"]["notebook"]["modified_at"] == RESTORED_AT, "the live row records Inspire's own restore"
    assert rows[3]["asset_status"]["notebook"]["modified_at"] == 999, "the held row is left as it was"
    _carried, status = inst._implement_carried({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 4})
    spec = agent_ns["validate_implement_spec"](VALID)[0]
    assert inst._implement_claim_notebook({"No": "N01-U01"}, spec, (5150, "N01-U01", 4), status, current="/W/v2/nb") == "/W/v4/nb", \
        "Try again after a hold is not blocked as edited, with no consent"


def test_a_person_s_edit_from_before_the_held_build_stays_visible_after_the_restore(agent_ns, monkeypatch):
    inst, rows, times = _notebook_rows(agent_ns, monkeypatch)
    live = {"notebook_path": "/W/v2/nb", "tables": {}, "notebook_text": "live text with the edit", "notebook_edited": True}
    inst._implement_restore_live("N01-U01", {"notebook_path": "/W/v2/nb", "use_case": {}, "key": (5150, "N01-U01", 3)}, live, None)
    assert rows[2]["asset_status"]["notebook"]["modified_at"] == BUILT_AT, "Inspire never records over an edit it did not make"
    _carried, status = inst._implement_carried({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 4})
    with pytest.raises(agent_ns["ImplementBlocked"]):
        inst._implement_claim_notebook({"No": "N01-U01"}, agent_ns["validate_implement_spec"](VALID)[0], (5150, "N01-U01", 4), status,
                                       current="/W/v2/nb")


def test_a_held_run_reads_whether_the_live_notebook_was_edited_before_it_touches_it(agent_ns):
    inst, previous = _locked(agent_ns)
    recorded = []
    inst._implement_runner = lambda uc: "genie"
    inst._implement_dashboard = _dashboard(inst, [])
    _verdicts(inst, [ASK], status="missing", evidence="the chart sorts by name")
    inst._implement_notebook_edit_state = lambda path, record: (BUILT_AT, False)
    inst._implement_notebook_before = lambda path: "live text"
    inst._implement_import_notebook = lambda path, text: None
    inst._implement_record_notebook_write = lambda key, modified_at: recorded.append(key) or True
    assert _run(inst, _asked(previous)) == "vibe_not_met"
    assert recorded == [(5150, "N01-U01", 3)], "a clean live notebook put back by the hold records Inspire's write"
    edited = _locked(agent_ns)[0]
    edited._implement_runner = lambda uc: "genie"
    edited._implement_dashboard = _dashboard(edited, [])
    _verdicts(edited, [ASK], status="missing", evidence="the chart sorts by name")
    edited._implement_notebook_edit_state = lambda path, record: (EDIT_1, True)
    edited._implement_notebook_before = lambda path: "live text"
    edited._implement_import_notebook = lambda path, text: None
    edited._implement_record_notebook_write = lambda key, modified_at: pytest.fail("a live notebook a person edited is never recorded")
    assert _run(edited, _asked(previous)) == "vibe_not_met"


def test_a_hold_removes_only_what_the_build_wrote_and_keeps_what_someone_else_added_meanwhile(agent_ns):
    inst, _ = _restorer(agent_ns, [])
    live_task = {"task_key": "main", "notebook_task": {"notebook_path": "/W/v2/nb"}}
    foreign_task = {"task_key": "owner_check", "notebook_task": {"notebook_path": "/W/owner"}}
    calls = []

    def api(method, path, body=None, query=None):
        calls.append((method, path, body))
        return {"settings": {"tags": {"probe": "live", "inspire_version": "v3", "held": "yes", "owner_note": "keep"},
                              "tasks": [dict(live_task, notebook_task={"notebook_path": "/W/v3/nb"}), foreign_task],
                              "schedule": {"pause_status": "PAUSED"}, "max_concurrent_runs": 1, "queue": {"enabled": True}}}

    inst._implement_api = api
    saved = {"tags": {"probe": "live", "inspire_version": "v2"}, "tasks": [live_task], "max_concurrent_runs": 4}
    assert inst._implement_restore_job(77, saved, {"tags": {"inspire_version": "v3", "held": "yes"}, "tasks": ["main"], "settings": ["max_concurrent_runs", "queue"], "schedule": True}).startswith("the job's notebook")
    [body] = [c[2] for c in calls if c[0] == "POST"]
    assert body["new_settings"]["tags"] == {"probe": "live", "inspire_version": "v2", "owner_note": "keep"}, \
        "the build's own added tag goes, its overwritten tag gets the live value back, and a tag someone added meanwhile stays"
    assert body["new_settings"]["tasks"] == [live_task] and "tasks/owner_check" not in body["fields_to_remove"], \
        "only the task the build wrote is put back, and a task someone else added is never removed"
    assert body["new_settings"]["max_concurrent_runs"] == 4
    assert body["fields_to_remove"] == ["queue", "schedule", "tags"], \
        "the queue and the schedule the build added go, and tags is replaced whole to drop the build's own key"
    calls.clear()
    assert inst._implement_restore_job(77, saved, None) == "this build changed none of the job's settings, so the job is as it was"
    assert calls == [], "a build that wrote nothing to the job leaves it alone"


def test_the_preview_records_exactly_the_tags_and_task_it_writes_to_the_job(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_update = lambda key, **f: None

    class Launcher(agent_ns["JobLauncher"]):
        def launch(self, **kwargs):
            return {"success": False, "error": "stopped after recording"}

    inst._job_launcher_cls = Launcher
    use_case = {"result_table": "main.inspire.churn_out"}
    spec_nb = {"job_tags": {"dbx inspire usecase": "churn desk"}, "job_slug": "churn", "schedule_cron": "0 0 6 * * ?"}
    inst._implement_preview("N01-U01", (5150, "N01-U01", 3), use_case, _spec(agent_ns)[0], spec_nb, "/W/nb", ["result_table", "run_profile"])
    wrote = use_case["_implement_job_writes"]
    assert wrote["tasks"] == [Launcher.TASK_KEY] and wrote["settings"] == ["max_concurrent_runs", "queue"] and wrote["schedule"] is True
    assert wrote["tags"] == Launcher("/W/nb", {}, inst._implement_tags(spec_nb, (5150, "N01-U01", 3), "/W/nb")).job_tags, \
        "the record holds the tags exactly as the launcher sends them, after it cleans their names"


SALES = {"space_id": "gH", "title": "N01-U07 Sales questions"}


def _repoint_run(agent_ns, tmp_path, monkeypatch, ask, check, created_by=None):
    inst, target = _version_inspire(agent_ns, tmp_path, monkeypatch, _own_files(agent_ns, tmp_path, SALES, page_genie=SALES),
                                    lambda uc: "runner")
    if created_by:
        live = inst._implement_previous(None)
        inst._implement_previous = lambda t: dict(live, created_by=created_by[0])
        target = dict(target, created_by=created_by[1])
    previous = inst._implement_previous(None)["spec_json"]
    previous["outputs"]["app_vibes"] = ask
    target = dict(target, spec_json=dict(target["spec_json"], outputs=dict(target["spec_json"]["outputs"], app_vibes=ask)))

    def genie(context, runner):
        context.setdefault("artifacts", {})["genie_space"] = {"title": "N01-U01 Predict churn"}
        inst._implement_publish_barrier(context, "genie_space", {"title": "N01-U01 Predict churn"})
        return {"genie_space_id": "g1", "genie_space_url": "https://h/genie/rooms/g1"}

    inst._implement_genie_space = genie
    inst._implement_vibes_llm = lambda kind, prompt, schema: (
        {"asks": [{"ask": ask, "check": check, "keep": True, "where": ""}]} if kind == "split"
        else pytest.fail("the Ask Genie panel is checked from what the page shows, with no judge"))
    status = inst._implement_one_locked(target, (5150, "N01-U01", 3))
    return inst, status


def test_a_re_point_that_drops_the_asked_ask_genie_panel_holds_and_leaves_the_app_as_it_was(agent_ns, tmp_path, monkeypatch):
    ask = "Keep the Sales questions panel"
    inst, status = _repoint_run(agent_ns, tmp_path, monkeypatch, ask, {"kind": "text", "value": "N01-U07 Sales questions"})
    final = inst.updates[-1]["asset_status"]
    assert status == "vibe_not_met", "the re-point would swap the asked panel for this use case's Genie Agent, so the version holds"
    assert inst.deployed == [], "the App is never redeployed, so its previous deployment stays live as it was"
    assert final["held"]["repoint"] == ["app"] and "app" in final["held"]["candidates"] and "genie_space" in final["held"]["candidates"]
    [entry] = [e for e in final["checklist"] if e["requirement"] == ask]
    assert entry["status"] == "not_met" and entry["part"] == "app"
    assert f"App: {ask}: the built App never shows the words 'N01-U07 Sales questions'" in final["held"]["reason"]


def test_a_re_point_that_keeps_the_asked_ask_genie_panel_publishes_and_re_points_the_app_once(agent_ns, tmp_path, monkeypatch):
    ask = "Show an Ask Genie panel"
    inst, status = _repoint_run(agent_ns, tmp_path, monkeypatch, ask, {"kind": "text", "value": "Ask Genie"})
    assert status in ("ready", "ready_with_warnings"), inst.updates[-1].get("status_message")
    [(name, deployed, _reads, space_id)] = inst.deployed
    assert (name, space_id, json.loads(deployed["pages/n01_u01.json"])["genie"]) == ("churn-desk", "g1", {
        "space_id": "g1", "title": "N01-U01 Predict churn"}), "the App is re-pointed after the Genie Agent is published, never at a pending one"
    final = inst.updates[-1]["asset_status"]
    [entry] = [e for e in final["checklist"] if e["requirement"] == ask]
    assert entry["status"] == "met" and "held" not in final


def test_the_page_view_shows_the_ask_genie_panel_and_a_held_re_point_is_re_pointed_again_by_publish_anyway(agent_ns):
    seen = agent_ns["implement_page_seen"]
    on = seen({"id": "n01_u01", "title": "Churn desk", "genie": {"space_id": "g1", "title": "Churn questions"}, "genie_note": ""})
    assert on["genie"]["lines"] == ["Ask Genie: Churn questions"] and on["genie"]["name"] == "Ask Genie panel"
    off = seen({"id": "n01_u01", "title": "Churn desk", "genie": None, "genie_note": "Ask Genie is off because it was not built"})
    assert off["genie"]["lines"] == ["Ask Genie is off because it was not built"]
    assert "genie" not in seen({"id": "n01_u01", "title": "Churn desk"}), "a page with no Ask Genie setting shows no panel"
    plan = agent_ns["implement_publish_plan"]({"classes": []}, {"spec_version": 3, "notebook_path": None, "asset_status": {
        "held": {"candidates": ["app", "genie_space"], "repoint": ["app"], "notebook": ""}}})
    assert plan["rollback"] == {"genie_space": 3} and plan["repoint"] == ["app"], \
        "the held Genie Agent is published as it was checked, and the App is pointed at it afresh, never at the pending one"
