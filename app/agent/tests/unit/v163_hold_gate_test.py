import ast
import calendar
import json

import pytest

import _agentload
from v120_artifacts_support import FakeSpark
from v140_implement_test import (NB_PATH, SHELL_SQL, VALID, _FakeRunner, _FileRunner, _calls_to, _churn_page, _claim, _fill, _inspire, _left_by,
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


def test_a_version_with_an_unmet_ask_publishes_its_met_part_and_lists_the_unmet_ask(agent_ns):
    inst, previous = _locked(agent_ns)
    asked, deployed = [], []
    inst._implement_runner = lambda uc: asked.append(uc) or "genie"
    inst._implement_dashboard = _dashboard(inst, deployed)
    _verdicts(inst, [ASK], status="missing", evidence="the chart sorts by name")
    assert _run(inst, _asked(previous)) == "ready_with_warnings"
    assert deployed == [CHART], "the met part is published"
    assert asked == ["N01-U01"], "the candidate was built by Genie once"
    final = inst.updates[-1]
    assert "held" not in final["asset_status"] and final["status"] != "vibe_not_met"
    record = final["asset_status"]["dashboard"]
    assert (record["state"], record["spec_version"]) == ("ready", 3), "the dashboard now holds v3"
    assert final["status_message"].startswith(
        "v3 is published with 1 unmet ask (not met or could not be checked), the rest of the vibe is in place: "
        "Dashboard: Put the top 10 first: the chart sorts by name")
    saved = json.loads([u for u in inst.updates if "asset_snapshots" in u][-1]["asset_snapshots"])
    assert saved == {"dashboard": {"artifact": CHART, "vibes": ASK, "spec_version": 3, "merged_into": ""}}


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
    inst._implement_cell_problems = lambda path, training_sample=False, grouping=None, sources=(), training_read=False: []
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
    assert _run(inst, dict(VALID, vibes=PURPLE, vibe_previous="remove")) == "ready_with_warnings"
    assert len(runner.prompts) == 3 and len(judged) == 3, "the ask is sent to Genie for all of its rounds before it is listed as unmet"
    assert all(f"'{PURPLE}': {NOT_PURPLE}" in prompt for prompt in runner.prompts[1:]), "each later round tells Genie what it missed"
    final = inst.updates[-1]
    [entry] = final["asset_status"]["checklist"]
    assert (entry["requirement"], entry["part"], entry["status"], entry["rounds"]) == (PURPLE, "notebook", "not_met", 3)
    assert entry["tried"] == [f"round {n}: {NOT_PURPLE}" for n in (1, 2, 3)]
    assert final["asset_status"]["checklist_summary"] == {"met": 0, "total": 1}
    assert "held" not in final["asset_status"], "nothing is held: the unmet ask is listed beside what was published"
    assert f"Notebook: {PURPLE}: Genie could not do it in 3 build rounds: {NOT_PURPLE}" in final["status_message"]
    assert "is published with 1 unmet ask (not met or could not be checked)" in final["status_message"]
    final = final["asset_status"]
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
    assert _run(inst, dict(VALID, vibes=SPANISH, vibe_previous="remove")) == "ready_with_warnings"
    assert len(runner.prompts) == 3 and len(judged) == 4, "one check of the built notebook, then one per Genie round"
    final = inst.updates[-1]
    [entry] = final["asset_status"]["checklist"]
    assert (entry["part"], entry["status"], entry["rounds"]) == ("ai_reasoning", "not_met", 3)
    assert entry["tried"] == [f"round {n}: {ENGLISH}" for n in (1, 2, 3)], "the check of the built notebook was no Genie round"
    assert "is published with 1 unmet ask (not met or could not be checked)" in final["status_message"] and ENGLISH in final["status_message"]


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
    assert _run(inst, _asked(previous)) == "ready_with_warnings"
    assert [retry for _rebuild, retry in seen] == [["alert"], ["alert"]], "the candidate is built once, then published once"
    final = inst.updates[-1]
    [entry] = [e for e in final["asset_status"]["checklist"] if e["requirement"] == WEEKDAYS and e["status"] == "not_met"]
    assert (entry["part"], entry["status"], entry["rounds"]) == ("alert", "not_met", 3)
    assert f"Alert: {WEEKDAYS}: Genie could not do it in 3 build rounds: it fires every day" in final["status_message"]


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
    assert _writers(tree) == {"not_met": {"_implement_vibe_checklist", "_implement_untargeted_entry"}, "held": set(),
                              "not_decided": {"implement_not_decided_entries"}, "refused": {"implement_settings_refused_entries"}}
    refusers = {owner for owner, call in _calls(tree) if call in ("implement_settings_refusal", "implement_settings_refused_entries")}
    assert refusers == {"_implement_settings_owner_check"}, "only the settings owner check refuses a setting"
    assert {owner for owner, call in _calls(tree) if call == "_implement_settings_owner_check"} == {"_implement_one_locked"}
    assert {owner for owner, call in _calls(tree) if call == "implement_not_decided_entries"} == {"_implement_route_vibe"}, \
        "an ask is not_decided only where the router could not place it, before any plan or Genie round"
    guards = {owner for owner, call in _calls(tree) if call == "_implement_keep_untargeted"}
    assert guards == {"_implement_genie_space.deploy", "_implement_page_spec.written"}, \
        "the unrequested-change guard runs only in the deploy step Genie's rounds call, so it holds only after them"
    assert not {owner for owner, call in _calls(tree) if call == "_implement_hold"}, "no build is held: an unmet ask never stops a publish"
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


def test_the_next_version_diffs_against_the_latest_published_one_and_a_published_version_with_warnings_counts_as_built(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    rows = [{"spec_version": 3, "status": "ready_with_warnings", "notebook_path": "/W/v3/nb", "dashboard_id": "d-published",
             "asset_status": {"dashboard": {"state": "ready", "spec_version": 3}}},
            {"spec_version": 2, "status": "ready", "notebook_path": "/W/v2/nb", "dashboard_id": "d1",
             "asset_status": {"dashboard": {"state": "ready", "spec_version": 2}}}]
    seen = []
    inst._implement_select = lambda where, args, order=None: seen.append(where) or [dict(r) for r in rows]
    carried, status = inst._implement_carried({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 4})
    assert (carried["notebook_path"], carried["dashboard_id"], status["dashboard"]["spec_version"]) == ("/W/v3/nb", "d-published", 3)
    own, own_status = inst._implement_carried({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3}, through_own=True)
    assert own["dashboard_id"] == "d-published", "the version's own run still reads its own row"
    inst._implement_previous({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 4})
    assert "status IN ('ready', 'ready_with_warnings', :gone)" in seen[-1], "the next version diffs against the latest published one"


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


def test_an_output_whose_stored_ask_Genie_missed_is_history_and_never_carried_into_a_rebuild(agent_ns):
    inst, previous = _locked(agent_ns, {"alert_vibes": WEEKDAYS})
    _carrying_status(inst, alert={"vibes_checks": [{"ask": WEEKDAYS, "status": "missing", "evidence": "it fires every day"}]})
    seen = []
    inst._implement_alert = _alert(inst, seen)
    _verdicts(inst, [WEEKDAYS], status="done")
    assert _run(inst, previous) == "ready_with_warnings"
    assert seen == [], "a missed ask is history on the build that missed it, so nothing is rebuilt for it"
    assert "is published with 1 unmet ask" in inst.updates[-1]["status_message"]
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
    unchecked = agent_ns["IMPLEMENT_VIBES_UNCHECKED"] + ": the judge did not answer"
    status = {"dashboard": {"vibes_checks": [{"ask": ASK, "status": "done", "evidence": already}]},
              "dashboard:by_region": {"vibes_checks": [{"ask": "Show the region", "status": "missing", "evidence": unchecked},
                                                       {"ask": "Show the colour", "status": "missing", "evidence": "the chart is blue"}]}}
    spec["outputs"]["dashboard:by_region_vibes"] = "Show the region. Show the colour"
    assert agent_ns["implement_live_unmet"](status, spec) == {"dashboard:by_region": ["Show the region"]}, \
        "only an ask Inspire could not check is retried; an ask Genie missed is listed once as history and never carried into a rebuild"
    assert agent_ns["implement_live_unmet"](status, {"outputs": {}}) == {}, "an ask the spec no longer holds is never retried"



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
    inst._implement_manage_locked = lambda uc_id, key, spec, assets, touched: {}
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
    assert _run(inst, change(_asked(previous))) == "ready_with_warnings"
    return inst, calls, previews


def test_a_rollback_whose_saved_ask_is_unmet_publishes_the_rolled_back_part_and_lists_the_ask(agent_ns):
    inst, previous = _locked(agent_ns, {"dashboard_vibes": ASK})
    deployed, read = [], []
    inst._implement_snapshot = lambda key, name, version: read.append((name, version)) or {
        "artifact": CHART, "vibes": ASK, "spec_version": 1, "merged_into": ""}
    inst._implement_runner = lambda uc: pytest.fail("a rollback asks Genie nothing")
    inst._implement_dashboard = _dashboard(inst, deployed)
    _verdicts(inst, [ASK], status="missing", evidence="the chart sorts by name")
    assert _run(inst, dict(previous, rollback_outputs={"dashboard": 1})) == "ready_with_warnings"
    assert ("dashboard", 1) in read and deployed == [CHART], "the rolled-back dashboard is published"
    final = inst.updates[-1]
    assert [e["status"] for e in final["asset_status"]["checklist"]] == ["not_met"]
    assert "is published with 1 unmet ask (not met or could not be checked)" in final["status_message"]
    saved = json.loads(next(u for u in inst.updates if "asset_snapshots" in u)["asset_snapshots"])
    assert saved["dashboard"]["artifact"] == CHART and saved["dashboard"]["spec_version"] == 3, "the rolled-back part is saved as v3"
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


def test_an_ask_the_judge_could_not_check_publishes_and_says_to_try_again(agent_ns):
    inst, previous = _locked(agent_ns)
    deployed = []
    inst._implement_runner = lambda uc: "genie"
    inst._implement_dashboard = _dashboard(inst, deployed)

    def busy(kind, prompt, schema):
        raise RuntimeError("[REQUEST_LIMIT_EXCEEDED] the endpoint is busy")

    inst._implement_vibes_llm = busy
    assert _run(inst, _asked(previous)) == "ready_with_warnings"
    assert deployed == [CHART], "a check that could not run still publishes the parts that Inspire built"
    final = inst.updates[-1]
    [entry] = final["asset_status"]["checklist"]
    assert (entry["status"], entry["unchecked"]) == ("not_met", True)
    assert entry["evidence"] == ("Inspire could not check this ask: [REQUEST_LIMIT_EXCEEDED] the endpoint is busy. Nothing shows the ask "
                                 "was missed: press Try again to check it again")
    fact = entry["evidence"].removesuffix(": press Try again to check it again")
    assert f"Dashboard: {ASK}: {fact}" in final["status_message"] and final["status_message"].count("Try again") == 1, \
        "the published sentence quotes the entry's fact and names the action once"
    assert "is published with 1 unmet ask (not met or could not be checked)" in final["status_message"]
def test_a_mix_of_missed_and_unchecked_asks_names_both(agent_ns):
    text = agent_ns["implement_unmet_published_text"]
    missed = {"requirement": ASK, "part": "dashboard", "evidence": "x", "status": "not_met", "rounds": 0}
    unchecked = dict(missed, requirement="Show the region", unchecked=True)
    both = text([missed, unchecked], 3)
    assert both.startswith("v3 is published with 2 unmet asks (not met or could not be checked), the rest of the vibe is in place: ")
    assert f"Dashboard: {ASK}: x" in both and "Dashboard: Show the region: x" in both
    assert text([missed], 3).startswith("v3 is published with 1 unmet ask (not met or could not be checked)")

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
    inst._implement_app_shell = lambda: (None, {"shell_sql": SHELL_SQL})
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
    assert status == "ready_with_warnings" and bar["status"] == "not_met" and "already_there" not in bar, \
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
                                 "again with Vibe/Add/Remove Features on the Build page to overwrite it, or keep it and change only the outputs or the schedule")
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


def test_a_re_point_that_drops_the_asked_ask_genie_panel_publishes_and_lists_the_unmet_ask(agent_ns, tmp_path, monkeypatch):
    ask = "Keep the Sales questions panel"
    inst, status = _repoint_run(agent_ns, tmp_path, monkeypatch, ask, {"kind": "text", "value": "N01-U07 Sales questions"})
    final = inst.updates[-1]["asset_status"]
    assert status == "ready_with_warnings", "an unmet ask never holds the build; the re-point publishes what was met"
    assert "held" not in final, "nothing is held"
    [entry] = [e for e in final["checklist"] if e["requirement"] == ask]
    assert entry["status"] == "not_met" and entry["part"] == "app"
    assert f"App: {ask}: the built App never shows the words 'N01-U07 Sales questions'" in inst.updates[-1]["status_message"]
    assert "is published with 1 unmet ask" in inst.updates[-1]["status_message"]



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


def test_a_structural_app_failure_stops_the_build_and_is_never_listed_as_an_unmet_ask(agent_ns, tmp_path):
    from v140_implement_test import _app_flow
    broken = {"_implement_app_check": lambda work, files, modules, warehouse: ["page n01_u01: chart:by_category failed: boom"]}
    inst, context, seen = _app_flow(agent_ns, tmp_path, page=None, write=True, **broken)
    assert inst._implement_app(context, None) == {}
    assert len(seen["errors"]) == 1 and "chart:by_category failed: boom" in seen["errors"][0], seen["errors"]
    assert seen["deployed"] == [], "a page that fails Inspire's structural checks is never published"
    assert not any("published with" in str(v) for v in seen.get("messages", [])), \
        "a structural failure is an error, never a listed unmet ask"
