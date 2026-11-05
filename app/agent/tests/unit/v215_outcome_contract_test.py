"""A preview run that ends without the outcome Inspire reads is caught before the run by a static check of Genie's cells, and
at run time inspire_main() turns an exception, a None or an off-format return into an explicit 'stopped without writing'
error. Genie is told what the notebook does wrong, a failure that repeats word for word is flagged as a repeat, and the
outer attempts stop instead of rebuilding a third time with the same failure."""
import pytest

from v140_implement_test import VALID, _cell, _fill, _FakeRunner, _flow_inspire, _notebook_inspire, _NotebookWorkspace, sdk_stub  # noqa: F401
from v154_self_heal_test import TARGET, _inspire, _repairs

GOOD = '''
def step_one():
    return 3


def run_use_case(scope="preview"):
    rows = step_one()
    if rows == 0:
        return {"status": "stopped", "stop_reason": "STOP RULE: no rows"}
    try:
        outcome = {"status": "written", "rows_written": rows, "as_of_date": "2026-01-01", "run_id": "r1"}
    except ValueError as error:
        raise RuntimeError("write failed") from error
    return outcome
'''


def _problems(ns, source, need_entry=False):
    return ns["implement_outcome_contract_problems"]([("cell 3", source)], need_entry=need_entry)


def test_a_run_use_case_that_returns_an_outcome_on_every_path_passes(agent_ns):
    assert _problems(agent_ns, GOOD, need_entry=True) == []


@pytest.mark.parametrize("source,said", [
    (GOOD + "\ndbutils.notebook.exit('done')\n", "calls dbutils.notebook.exit, which ends the run before inspire_main() returns"),
    (GOOD.replace("    return outcome", "    sys.exit(0)"), "calls sys.exit"),
    (GOOD.replace('def run_use_case(scope="preview")', "def run_use_case(scope)"), "needs 1 argument, but inspire_main() calls it with none"),
    (GOOD.replace("    return outcome", "    return"), "line 14 returns nothing"),
    (GOOD.replace("    return outcome", "    return None"), "line 14 returns nothing"),
    (GOOD.replace("    return outcome", "    return 'wrote rows'"), "returns 'wrote rows', not the outcome dict"),
    (GOOD.replace("    return outcome", "    return f'wrote {rows}'"), "not the outcome dict"),
    (GOOD.replace("    return outcome", "    return {'rows_written': rows}"), "returns a dict with no 'status'"),
    (GOOD.replace("    return outcome", "    print(outcome)"), "can reach its end without a return"),
    (GOOD.replace('        return {"status": "stopped", "stop_reason": "STOP RULE: no rows"}', "        print('empty')")
     .replace("    return outcome", "    if rows:\n        return outcome"), "can reach its end without a return"),
], ids=["notebook_exit", "sys_exit", "required_arg", "bare_return", "return_none", "return_text", "return_fstring",
        "dict_without_status", "falls_through", "if_without_else"])
def test_each_way_a_notebook_loses_its_outcome_is_named(agent_ns, source, said):
    found = _problems(agent_ns, source)
    assert any(said in problem for problem in found), found
    assert all(agent_ns["IMPLEMENT_OUTCOME_SHAPE"] in p for p in found if p.startswith("run_use_case() in") and "argument" not in p)


def test_a_nested_helper_return_and_a_loop_that_never_breaks_are_not_flagged(agent_ns):
    source = '''
def run_use_case():
    def pick(rows):
        return None
    while True:
        rows = pick([])
        return {"status": "written", "rows_written": 1, "as_of_date": "d", "run_id": "r"}
'''
    assert _problems(agent_ns, source, need_entry=True) == []
    assert _problems(agent_ns, source.replace("        return {", "        if rows:\n            break\n        return {")) == [
        "run_use_case() in cell 3 can reach its end without a return, so that path gives no outcome: end every path with a "
        f"return of {agent_ns['IMPLEMENT_OUTCOME_SHAPE']}"]


def test_a_missing_run_use_case_is_named_only_once_the_run_proved_it_is_needed(agent_ns):
    assert _problems(agent_ns, "x = 1\n") == [], "before a run, a notebook Genie has not built yet is not a contract failure"
    [missing] = _problems(agent_ns, "x = 1\n", need_entry=True)
    assert missing.startswith("no cell defines run_use_case() at its top level")
    assert _problems(agent_ns, "def run_use_case(:\n", need_entry=True) == [], "a cell that does not parse is left to the parse check"


def test_the_cell_check_runs_the_contract_first_and_skips_inspire_own_cells(agent_ns, sdk_stub):
    notebook = {"cells": [_cell("Genie Code instruction", "# instruction"),
                          _cell(None, GOOD.replace("    return outcome", "    return None")),
                          _cell("Run controls (Inspire, do not edit)", "dbutils.notebook.exit('x')\ninspire_main()")]}
    inst = _notebook_inspire(agent_ns, _NotebookWorkspace(notebook, modified_at=5))
    problems = inst._implement_cell_problems("/W/nb")
    assert problems[0].startswith("run_use_case() in cell 2 line 14 returns nothing")
    assert not any("notebook.exit" in p for p in problems), "Inspire's Run controls cell is not Genie's"


def test_the_shape_genie_is_told_is_the_one_the_run_controls_check(agent_ns):
    template = agent_ns["GENIE_RUN_CONTROLS_TEMPLATE"]
    ns = {}
    exec(template[template.index("INSPIRE_OUTCOME_SHAPE = "):template.index("def inspire_outcome_problem")], ns)
    assert ns["INSPIRE_OUTCOME_SHAPE"] == agent_ns["IMPLEMENT_OUTCOME_SHAPE"]


def test_an_unread_outcome_tells_genie_what_the_notebook_does_wrong_and_how_the_run_ended(agent_ns, sdk_stub):
    notebook = {"cells": [_cell(None, "def run_use_case():\n    print('wrote')\n")]}
    inst = _notebook_inspire(agent_ns, _NotebookWorkspace(notebook, modified_at=5))
    told = inst._implement_unread_feedback("/W/nb", {"status": "unknown", "text": "Genie Code has not built this notebook yet. Nothing ran."})
    assert told.startswith(agent_ns["implement_unread_outcome"]({"status": "unknown", "text": "x"}))
    assert "Inspire read the notebook and found: run_use_case() in cell 1 can reach its end without a return" in told
    assert told.endswith("the run ended with: Genie Code has not built this notebook yet. Nothing ran.")
    empty = _notebook_inspire(agent_ns, _NotebookWorkspace({"cells": [_cell(None, "x = 1\n")]}, modified_at=5))
    assert "no cell defines run_use_case()" in empty._implement_unread_feedback("/W/nb", {"status": "unknown"})


def test_the_same_failure_twice_after_a_notebook_rebuild_stops_instead_of_a_third_attempt(agent_ns, monkeypatch):
    failed = agent_ns["ImplementNotebookFailed"]
    same = "the preview run did not write usable rows: KeyError: 'segment'"
    inst = _inspire(agent_ns, monkeypatch, [failed(same), failed(same), "ready"],
                    picks=[{"repair": "rebuild_with_error", "why": "Genie fixes the KeyError"}])
    assert inst._implement_one(TARGET) == "failed"
    assert len(inst.locked_targets) == 2 and len(inst.prompts) == 1, "the repeat is caught before the model is asked again"
    final = inst.updates[-1]
    assert final["status_message"] == f"Inspire tried 2 times and could not build it: {same} ({agent_ns['IMPLEMENT_REPEAT_STOP']})"
    [ended] = [e for e in inst.emitted if e.get("status") == "ended_error"]
    rounds = ended["result_json"]["repair_rounds"]
    assert [(r["attempt"], r["repair"]) for r in rounds] == [(1, "rebuild_with_error"), (2, "stop")]
    assert rounds[0]["why"] == "Genie fixes the KeyError" and ended["result_json"]["terminal"] is True


def test_a_different_failure_after_a_rebuild_and_a_repeated_retry_still_get_their_attempts(agent_ns, monkeypatch):
    failed = agent_ns["ImplementNotebookFailed"]
    inst = _inspire(agent_ns, monkeypatch, [failed("KeyError: 'segment'"), failed("KeyError: 'region'"), "ready"],
                    picks=[{"repair": "rebuild_with_error", "why": "a"}, {"repair": "rebuild_with_error", "why": "b"}])
    assert inst._implement_one(TARGET) == "ready"
    busy = RuntimeError("Jobs API returned 503 Service Unavailable")
    inst = _inspire(agent_ns, monkeypatch, [busy, busy, busy])
    assert inst._implement_one(TARGET) == "failed" and len(inst.locked_targets) == 3, "a retry is not a notebook rebuild"
    [ended] = [e for e in inst.emitted if e.get("status") == "ended_error"]
    assert ended["result_json"]["terminal"] is True and len(_repairs(inst)) == 2
    assert agent_ns["implement_repeated_rebuild"]([{"kind": "retry", "error": "x"}], "x") is False
    assert agent_ns["implement_repeated_rebuild"]([{"kind": "smaller_query", "error": "x"}], "x") is True
    assert agent_ns["implement_repeated_rebuild"](None, "x") is False


def test_an_unread_outcome_goes_back_with_its_diagnosis_and_a_word_for_word_repeat_is_flagged(agent_ns):
    unread = ({"status": "unknown", "text": ""}, 11, 101)
    inst = _flow_inspire(agent_ns, [unread, unread, ({"status": "written", "rows_written": 40}, 11, 103)])
    inst._implement_genie_cells = lambda path, purpose: [("cell 2", "def run_use_case():\n    print('wrote')\n")]
    runner = _FakeRunner([{"exit": 0, "final": _fill()}] * 3)
    spec = agent_ns["validate_implement_spec"](VALID)[0]
    outcome, _job, _f = inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), {}, spec, None, "/W/nb",
                                                         ["result_table", "run_profile"], runner, True)
    assert outcome["status"] == "written" and len(runner.prompts) == 3
    diagnosis = "run_use_case() in cell 2 can reach its end without a return"
    assert diagnosis in runner.prompts[1] and "{'status': 'unknown'" not in runner.prompts[1]
    assert agent_ns["GENIE_SAME_FAILURE_NOTE"].strip() not in runner.prompts[1], "the first failure is not a repeat"
    assert diagnosis in runner.prompts[2] and agent_ns["GENIE_SAME_FAILURE_NOTE"].strip() in runner.prompts[2]
    assert inst.logger.matching("[GENIE-REPEAT FIRED] N01-U01")


def test_a_different_failure_each_round_is_never_called_a_repeat(agent_ns):
    inst = _flow_inspire(agent_ns, [({"status": "failed", "error": "KeyError: 'a'"}, 11, 101),
                                    ({"status": "failed", "error": "KeyError: 'b'"}, 11, 102),
                                    ({"status": "written", "rows_written": 40}, 11, 103)])
    runner = _FakeRunner([{"exit": 0, "final": _fill()}] * 3)
    spec = agent_ns["validate_implement_spec"](VALID)[0]
    inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), {}, spec, None, "/W/nb", ["result_table", "run_profile"], runner, True)
    assert not any(agent_ns["GENIE_SAME_FAILURE_NOTE"].strip() in p for p in runner.prompts)
    assert not inst.logger.matching("[GENIE-REPEAT FIRED]")
