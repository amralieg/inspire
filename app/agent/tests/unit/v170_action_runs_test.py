import json
import os
import re
import sys

import pytest

from _agentload import agent_source
from v140_implement_test import VALID
from v143_vibes_test import _locked as _plain_locked
from v170_action_cases import FIXTURE, action_once_cases, render
from v170_action_once_test import ASKS, held_unchecked_run

SERVER = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "agent", "app_shell", "server")
SECOND_WORDING = re.compile(r"(?<!not )(?<!Genie )(?<!Genie Code )\b[Rr]ebuild (?:it|the App|the use case|the notebook|its money|those use cases|"
                            r"that use case)\b(?! with them)(?!' if plan)|build (?:it|the notebook) again so |; try again\b|so Genie fixes it|"
                            r"retry the \{|\b[Bb]uild (?:use cases? \{[^}]*\}|this use case|that use case|those use cases|the App|the notebook|"
                            r"it) again\b(?! with Vibe/Add/Remove Features)")
CASES = ("held_reason_two_unchecked_asks", "held_reason_one_ask", "checklist_row_could_not_check", "problems_with_edit_mvp_action",
         "run_controls_warning", "stop_message", "joined_status_line")


def _second_wordings(text):
    return [m.group(0) for m in SECOND_WORDING.finditer(text)]


def _server_text():
    return "".join(open(os.path.join(SERVER, name), encoding="utf-8").read() for name in sorted(os.listdir(SERVER)) if name.endswith(".py"))


def test_every_build_again_try_again_and_submit_again_sentence_goes_through_its_one_source():
    assert _second_wordings(agent_source()) == []
    assert _second_wordings(_server_text()) == []


@pytest.mark.parametrize("planted", ["; rebuild the App to fix them", "; rebuild it from Inspire", "the edits: rebuild it with Vibe/Add/Remove Features",
                                     "{error}; try again", "; build the notebook again so the App's settings apply",
                                     "; retry the {label} to build it again",
                                     "part: build use case {', '.join(unknown)} again, which records its part, then build this use case again",
                                     ". Build this use case again to turn Ask Genie on."])
def test_the_wording_scan_catches_a_sentence_that_words_the_action_itself(planted):
    assert _second_wordings(f'raise ImplementBlocked(f"the App failed{planted}")'), planted


def test_the_wording_scan_keeps_facts_that_name_a_rebuild():
    assert _second_wordings("so this version did not rebuild it; have Genie rebuild the notebook; list it in retry_outputs to rebuild it "
                            "with them; Inspire rebuilds only this page") == []
    assert _second_wordings('Build the notebook so this does not happen again. f"build {what} again with Vibe/Add/Remove Features on the Build page"') == []


def test_the_app_shell_and_the_notebook_word_the_rebuild_alike(agent_ns):
    if SERVER not in sys.path:
        sys.path.insert(0, SERVER)
    import shell_sql
    for what in ("it", "the App", "this use case"):
        for first in (False, True):
            assert shell_sql.rebuild_action(what, first) == agent_ns["inspire_rebuild_action"](what, first).replace(
                "the Build page", "Inspire's Build page")
    assert shell_sql.rebuild_action("this use case", True) in __import__("shell_core").JOINED_GENIE_NOTE


def _rebuild(n, agent_ns, what):
    return [f"{what} {i}: {agent_ns['implement_unfixed_text'](f'the {what.lower()} problem {i}', 0)}" for i in range(n)]


def _ready(agent_ns, n):
    from v143_vibes_test import _run
    from v148_asset_vibes_test import PARTS, _carrying, _llm, _locked, _vibed
    columns = [{"col_name": "entity_id", "data_type": "string"}]
    inst, previous = _locked(agent_ns, None, lambda s: columns if s == "DESCRIBE TABLE `main`.`inspire`.`churn_out`" else [])
    _carrying(inst, dict(PARTS, ai_reasoning={"state": "ready", "spec_version": 2, "title": "AI reasoning"}))
    inst._implement_refresh_run_controls = lambda *a: None
    inst._implement_keep_edits_setting = lambda *a, **k: None
    inst._implement_missing_tables = lambda tables: []
    inst._implement_role_problems = lambda spec, uc: []
    inst._implement_fill_and_preview = lambda *a: ({"status": "written", "rows_written": 40, "run_id": "r-9", "ai_problems": ["the summary is empty"],
                                                    "ai_fixable": True, "gate_problems": ["no row reached Act now"], "gate_rounds": 0}, 77, {})
    inst._implement_result_history = lambda *a: None
    unfixed = agent_ns["implement_unfixed_text"]
    inst._implement_fallback_warning = lambda *a: f"Notebook: {unfixed('the fallback reads the wrong column', 0)}" if n == 3 else ""
    inst._implement_tier_warning = lambda *a: ""
    _llm(inst)
    assert _run(inst, _vibed(previous, ["ai_reasoning"])) == "ready_with_warnings"
    facts = ["the summary is empty", "no row reached Act now"] + (["the fallback reads the wrong column"] if n == 3 else [])
    return inst, facts


@pytest.mark.parametrize("n", [2, 3])
def test_the_ready_status_message_and_the_done_event_name_the_rebuild_once(agent_ns, n):
    inst, facts = _ready(agent_ns, n)
    message = inst.updates[-1]["status_message"]
    done = [e["message"] for e in inst.emitted if e["step_name"] == "Done"][-1]
    for text in (message, done):
        assert text.count("Vibe/Add/Remove Features") == 1, text
        assert all(fact in text for fact in facts), text


@pytest.mark.parametrize("n", [2, 3])
def test_the_sharing_event_names_the_rebuild_once(agent_ns, n):
    inst, _previous = _plain_locked(agent_ns)
    spec = json.loads(json.dumps(agent_ns["validate_implement_spec"](VALID)[0]))
    spec["sharing"] = {"principals": [{"name": f"people-{i}"} for i in range(n)]}
    spec["config"] = {}
    inst._implement_access_rows = lambda table, warnings: []
    unfixed = agent_ns["implement_unfixed_text"]
    inst._implement_share_reads = lambda table, names: [f"Sharing: {unfixed(f'{names[0]} cannot read the reasons view', 0)}"]
    inst._implement_grant = lambda *a, **k: []
    warnings = type(inst)._implement_share(inst, "N01-U01", "main.inspire.churn_out", spec, {}, None)
    shared = [e["message"] for e in inst.emitted if e["step_name"] == "Sharing"][-1]
    assert len([w for w in warnings if "Vibe/Add/Remove Features" in w]) == n
    assert shared.count("Vibe/Add/Remove Features") == 1, shared
    assert all(f"people-{i} cannot read the reasons view" in shared for i in range(n)), shared


@pytest.mark.parametrize("n", [2, 3])
def test_the_uninstall_status_message_and_its_done_event_name_the_rebuild_once(agent_ns, n):
    inst, _previous = _plain_locked(agent_ns)
    warnings = _rebuild(n, agent_ns, "Dashboard")
    inst._implement_use_case_row = lambda session, uc: {"id": uc}
    inst._row_to_uc = lambda row: {"id": row["id"]}
    inst._implement_output_dirs = lambda *a: {}
    inst._implement_delete_outputs = lambda *a: list(warnings)
    inst._implement_remove_kept = lambda *a: []
    inst._implement_remove_use_case_dir = lambda *a: []
    inst._implement_warehouse_note = lambda key: ""
    assert inst._implement_uninstall((5150, "N01-U01", 4), {}, {}) == agent_ns["IMPLEMENT_UNINSTALLED"]
    message = inst.updates[-1]["status_message"]
    done = [e["message"] for e in inst.emitted if e["step_name"] == "Done"][-1]
    for text in (message, done):
        assert text.count("Vibe/Add/Remove Features") == 1, text
        assert all(f"the dashboard problem {i}" in text for i in range(n)), text


def test_the_app_read_cases_match_the_fixture_byte_for_byte(agent_ns):
    with open(FIXTURE, encoding="utf-8") as handle:
        written = handle.read()
    assert render(agent_ns) == written
    cases = json.loads(written)
    assert tuple(sorted(cases)) == tuple(sorted(CASES))
    assert not re.search(r"\d{12,}", written)
    assert all(str(value).count("Vibe/Add/Remove Features") <= 1 and str(value).count("Try again") <= 1 for value in cases.values())


def test_each_case_is_a_real_render_and_changes_when_the_source_does(agent_ns):
    cases = action_once_cases(agent_ns)
    assert cases["checklist_row_could_not_check"]["evidence"] == cases["checklist_row_could_not_check"]["fact"] + ": press Try again to check it again"
    assert cases["joined_status_line"].endswith("; build the notebook and the App again with Vibe/Add/Remove Features on the Build page")
    assert cases["stop_message"].count("Build the notebook again with Vibe/Add/Remove Features on the Build page") == 1


def test_the_held_reason_is_the_rows_facts_joined_plus_the_one_action(agent_ns):
    final = held_unchecked_run(agent_ns, ASKS[:2])
    entries = final["asset_status"]["checklist"]
    assert all(e["evidence"] == e["fact"] + ": press Try again to check it again" for e in entries)
    listed = "; ".join(f"Dashboard: {e['requirement']}: {e['fact']}" for e in entries)
    assert final["asset_status"]["held"]["reason"] == (f"2 asks could not be checked, so nothing of v3 is published and v2 stays live: {listed}. "
                                                       "Press Try again to check them again, or press Publish anyway")


def test_every_checklist_writer_gives_the_fact_beside_the_evidence(agent_ns):
    reason = "the vibe router failed 3 times, the last with: timed out"
    decided = agent_ns["implement_not_decided_entries"](ASKS[:2], reason, 3)
    assert all(e["fact"] + ": " + agent_ns["IMPLEMENT_SEND_VIBE_AGAIN"] == e["evidence"] for e in decided)
    plain = agent_ns["implement_checklist_texts"]("the chart sorts by name")
    assert plain == {"evidence": "the chart sorts by name", "fact": "the chart sorts by name"}
