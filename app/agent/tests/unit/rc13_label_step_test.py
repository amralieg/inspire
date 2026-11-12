"""rc13 label step (REQ-119): the Data Filter Label step reaches the App's step list with its FIRED line in the message.

The emitter hands the FIRED line to _emit_pipeline_status. The story layer rewrites the stage and step names for the App
("Inspire is working on data filter label") and by default keeps a detail only on a warning or error status, so the line
must be kept explicitly on a successful completion.
"""
import json
import os

import pytest

LINE = '[DATA-FILTER-LABEL FIRED] 12 of 12 names carried the label "Tokyo Tidbits"; re-asked 0, deterministic rewrite 0, kept 0 user-named'


class _Writer:
    def __init__(self):
        self.calls = []

    def emit_step(self, **kwargs):
        self.calls.append(kwargs)
        return len(self.calls)


@pytest.fixture
def run(agent_ns):
    instance = object.__new__(agent_ns["DatabricksInspire"])
    instance.atomic_writer = _Writer()
    return instance


def test_the_fired_line_is_kept_in_the_step_message_on_a_successful_completion(run):
    run._emit_pipeline_status(stage_name="Final Gate", step_name="Data Filter Label", sub_step_name="Complete",
                              status="ended_success", message=LINE, keep_detail=True)
    row = run.atomic_writer.calls[-1]
    assert row["status"] == "ended_success"
    assert LINE in row["message"], "the FIRED line reaches the message the steps route returns"


def test_a_successful_completion_without_keep_detail_keeps_the_old_story_message(run):
    run._emit_pipeline_status(stage_name="Final Gate", step_name="Phase L Production Checks", sub_step_name="Complete",
                              status="ended_success", message="Phase L: 19/19 passed")
    assert "19/19" not in run.atomic_writer.calls[-1]["message"], "other steps keep their story text unchanged"


def test_the_row_the_app_shows_carries_the_story_name_of_the_label_step(run):
    run._emit_pipeline_status(stage_name="Final Gate", step_name="Data Filter Label", sub_step_name="Complete",
                              status="ended_success", message=LINE, keep_detail=True)
    row = run.atomic_writer.calls[-1]
    assert row["stage_name"] == "Final Gate"
    assert row["step_name"] == "Inspire is working on data filter label", "the App shows this name, not Data Filter Label"


def test_the_run_emits_the_fired_line_as_the_label_step_with_the_detail_kept(agent_ns):
    here = os.path.dirname(os.path.abspath(__file__))
    notebook = os.path.join(os.path.dirname(os.path.dirname(here)), "agent", "dbx_inspire_ai_agent.ipynb")
    with open(notebook, encoding="utf-8") as handle:
        source = "".join(json.load(handle)["cells"][1]["source"])
    complete = source.index('sub_step_name="Complete",\n                                                   status="ended_warning" if label_stats["fallback"] else "ended_success", message=_label_line')
    assert "keep_detail=True" in source[complete:complete + 400], "the completion keeps the FIRED line in its message"
    assert "log_print(_label_line)" in source, "and it is also written to the log"
