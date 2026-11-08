"""v2.2.1 a Genie round stopped at the time limit keeps its work and is not spent like a failed round.

1. The build round's working-folder files are carried into the next round, which is told the time limit stopped it, what it
   had done (files written, notebook imported, its last steps), and to resume rather than start over.
2. A round cut off with work done adds one round, once per build; a round cut off with nothing done is a failed round as before.
3. The output rounds (dashboard, app, alert) follow the same rule, and every build prompt names the time limit up front.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v140_implement_test import (LOOP_CONTEXT, VALID, _FakeProc, _FakeRunner, _FileRunner, _fill, _flow_inspire,  # noqa: E402
                                 _loop_inspire, _runner)

SAID = ["Genie edited build_notebook.py", "Genie ran: databricks workspace import /W/nb (exit 1)"]
CUT = {"exit": -9, "timed_out": True, "said": SAID}
NAMES = ["result_table", "run_profile"]


def _flow(ns, tmp_path, previews):
    inst = _flow_inspire(ns, previews)
    inst.local_log_output_dir = str(tmp_path)
    return inst


def _fill_rounds(ns, inst, runner):
    spec = ns["validate_implement_spec"](VALID)[0]
    return inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), {}, spec, None, "/W/nb", NAMES, runner, True)


def test_a_build_round_cut_off_with_files_resumes_from_them_and_is_not_counted(agent_ns, tmp_path):
    inst = _flow(agent_ns, tmp_path, [({"status": "written", "rows_written": 40}, 11, 102)])
    runner = _FileRunner([dict(CUT), {"exit": 0, "final": _fill()}], [{"build_notebook.py": "# readiness step", "genie_last.txt": "x"}, {}])
    outcome, _job, _fill_out = _fill_rounds(agent_ns, inst, runner)
    assert outcome == {"status": "written", "rows_written": 40} and len(runner.prompts) == 2
    assert runner.seen == [[], ["build_notebook.py"]], "the next round starts from the cut-off round's files"
    second = runner.prompts[1]
    assert "your last round reached the 45-minute time limit and Inspire stopped it before it replied, after it wrote 1 file in " \
           "its working folder (build_notebook.py)" in second
    assert "its last steps were: Genie edited build_notebook.py | Genie ran: databricks workspace import /W/nb (exit 1)" in second
    assert "That round is not counted as a failed round" in second and "Resume from that work rather than starting over" in second
    assert "Genie exited with code -9" not in second and "Genie returned no JSON result" in second
    messages = [e["message"] for e in inst.emitted]
    assert any(m.startswith("round 1/4 reached the time limit, resumed from its work: your last round") for m in messages)
    assert {"status": "filling", "status_message": "Genie build round 2/4"} in inst.updates
    assert any("[GENIE-TIMEOUT-RESUME FIRED] N01-U01" in msg for _level, msg in inst.logger.records)


def test_a_build_round_that_imported_the_notebook_before_the_limit_says_so(agent_ns, tmp_path):
    inst = _flow(agent_ns, tmp_path, [({"status": "written", "rows_written": 40}, 11, 102)])
    stamps = iter([100, 250, 250, 250])
    inst._implement_notebook_modified_at = lambda path: next(stamps)
    runner = _FakeRunner([{"exit": -9, "timed_out": True}, {"exit": 0, "final": _fill()}])
    _fill_rounds(agent_ns, inst, runner)
    assert "after it imported the notebook into the workspace. That round is not counted as a failed round" in runner.prompts[1]


def test_a_build_round_cut_off_with_nothing_done_is_a_failed_round(agent_ns, tmp_path):
    inst = _flow(agent_ns, tmp_path, [({"status": "written", "rows_written": 40}, 11, 102)])
    runner = _FileRunner([{"exit": -9, "timed_out": True}] * 3, [{}, {}, {}])
    _fill_rounds(agent_ns, inst, runner)
    assert len(runner.prompts) == 3, "no extra round when the cut-off round did nothing"
    assert runner.seen == [[], [], []]
    assert "Genie exited with code -9 after the time limit" in runner.prompts[1] and "time limit and Inspire stopped it" not in runner.prompts[1]
    assert not any("[GENIE-TIMEOUT-RESUME FIRED]" in msg for _level, msg in inst.logger.records)


def test_the_extra_round_for_the_time_limit_is_given_once_per_build(agent_ns, tmp_path):
    inst = _flow(agent_ns, tmp_path, [({"status": "written", "rows_written": 40}, 11, 102)])
    runner = _FileRunner([dict(CUT)] * 4, [{"step.py": str(n)} for n in range(4)])
    _fill_rounds(agent_ns, inst, runner)
    assert len(runner.prompts) == 4, "three rounds plus one for the time limit, never more"
    assert "That round is not counted as a failed round" in runner.prompts[1]
    assert "That round is not counted" not in runner.prompts[2] and "Resume from that work" in runner.prompts[2]
    assert runner.seen[3] == ["step.py"], "work is still carried after the extra round is spent"


def test_an_output_round_cut_off_with_work_resumes_and_gets_one_more_round(agent_ns, tmp_path):
    inst = _loop_inspire(agent_ns, tmp_path)
    runner = _FileRunner([dict(CUT), {"exit": 0}], [{"dashboard.lvdash.json": "{\"pages\": []}"}, {}])
    deployed = []
    fields = inst._implement_genie_loop(LOOP_CONTEXT, runner, "Dashboard", "write it", lambda work: deployed.append(work) or {"dashboard_id": "d1"})
    assert fields == {"dashboard_id": "d1"} and len(deployed) == 1, "a cut-off round never deploys"
    assert runner.seen[1] == ["dashboard.lvdash.json"]
    assert "Inspire checked your last attempt: your last round reached the 45-minute time limit" in runner.prompts[1]
    assert "wrote 1 file in its working folder (dashboard.lvdash.json)" in runner.prompts[1]
    assert inst.updates[:2] == [{"status_message": "Dashboard: Genie round 1/3"}, {"status_message": "Dashboard: Genie round 2/4"}]


def test_an_output_round_cut_off_with_only_the_files_inspire_wrote_is_a_failed_round(agent_ns, tmp_path):
    inst = _loop_inspire(agent_ns, tmp_path)
    runner = _FakeRunner([{"exit": -9, "timed_out": True}, {"exit": 0}])
    tools = {"tools/check.py": "print(1)"}
    inst._implement_genie_loop(LOOP_CONTEXT, runner, "App", "write it", lambda work: {"app_name": "a"}, tools=tools)
    assert "Genie exited with code -9 after the time limit" in runner.prompts[1] and "time limit and Inspire stopped" not in runner.prompts[1]
    assert inst.updates[1] == {"status_message": "App: Genie round 2/3"}


def test_the_round_edits_are_what_changed_during_the_round(agent_ns, tmp_path):
    state, edits = agent_ns["implement_work_state"], agent_ns["implement_round_edits"]
    (tmp_path / "kept.py").write_text("a")
    (tmp_path / "genie_last.txt").write_text("x")
    (tmp_path / ".hidden").write_text("x")
    before = state(str(tmp_path))
    assert sorted(before) == ["kept.py"]
    (tmp_path / "new.py").write_text("b")
    (tmp_path / "kept.py").write_text("changed")
    assert edits(str(tmp_path), before) == ["kept.py", "new.py"]
    assert edits(str(tmp_path), state(str(tmp_path))) == []
    assert state(str(tmp_path / "missing")) == {} and edits("", {}) == []


def test_the_cut_off_note_names_what_was_done_and_caps_the_list(agent_ns):
    note = agent_ns["implement_cut_off_note"]
    many = [f"f{n}.py" for n in range(12)]
    text = note({"said": ["  ", "a" * 300] + [f"step {n}" for n in range(7)]}, many, True, 45, False)
    assert text.startswith("your last round reached the 45-minute time limit and Inspire stopped it before it replied, after it "
                           "imported the notebook into the workspace and wrote 12 files in its working folder (f0.py, ")
    assert "f9.py, and more)" in text and "f10.py" not in text
    assert "its last steps were: step 2 | step 3 | step 4 | step 5 | step 6" in text and "a" * 201 not in text
    assert "not counted" not in text


def test_every_build_prompt_names_the_time_limit_and_the_runner_keeps_genie_s_last_steps(agent_ns, tmp_path):
    prompt = agent_ns["DatabricksInspire"]._IMPLEMENT_FILL_PROMPT
    assert "Each round has 45 minutes, after which Inspire stops it: import the notebook into the workspace each time a step runs" in prompt
    events = [{"type": "item.completed", "item": {"type": "command_execution", "command": f"step{n}", "exit_code": 0}} for n in range(7)]
    result = _runner(agent_ns, tmp_path, popen=lambda c, **k: _FakeProc(events, 0)).run("x", str(tmp_path / "w"))
    assert result["said"] == [f"Genie ran: step{n} (exit 0)" for n in range(2, 7)]
