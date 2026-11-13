"""Ask runs on the App's own agent when the page has no Genie Agent space; the Genie space is only one tool."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_agent  # noqa: E402
import shell_core  # noqa: E402
from shell_core import HttpError  # noqa: E402

NOT_READY = "The Genie Agent is not ready: it was not built"


class NoSpaceShell:
    settings = {}

    def genie_space(self, page):
        raise HttpError(409, NOT_READY)

    def option(self, key):
        return False

    def workspace(self, headers):
        return object(), "u1"


class Stub:
    settings = {}
    pages = []


def agent_with(complete):
    agent = shell_agent.Agent(NoSpaceShell(), executor=object(), sleep=lambda s: None, clock=lambda: 0.0)
    agent.complete = complete
    return agent


def test_the_agent_tool_list_leaves_out_ask_genie_when_the_page_has_no_space():
    names = agent_with(None).tools_for({"id": "p1", "records": [], "kpis": []})
    assert "ask_genie" not in names
    assert "change_view" in names


def test_the_agent_probe_reports_a_model_when_one_answers():
    def answers(ws, who, turn, body, timeout=0):
        turn.model = "databricks-claude"
    assert agent_with(answers).ready_model({}) == "databricks-claude"


def test_the_agent_probe_reports_no_model_when_none_answers():
    def fails(ws, who, turn, body, timeout=0):
        raise HttpError(409, shell_agent.NO_MODEL, code="no_model")
    assert agent_with(fails).ready_model({}) == ""


def test_ask_is_on_without_a_space_when_the_agent_answers():
    page = {"id": "p1", "genie": None, "genie_note": NOT_READY}
    info = shell_core.Shell.genie_info(Stub(), page, "", True)
    assert info["enabled"] is False and info["agent"] is True
    assert info["note"] == NOT_READY


def test_ask_is_off_with_both_reasons_when_there_is_no_agent_and_no_space():
    page = {"id": "p1", "genie": None, "genie_note": NOT_READY}
    info = shell_core.Shell.genie_info(Stub(), page, "", False)
    assert info["enabled"] is False and info["agent"] is False
    assert info["note"].startswith(shell_agent.NO_MODEL) and info["note"].endswith(NOT_READY)


def test_ask_is_genie_mode_when_the_page_has_a_space_and_no_agent():
    page = {"id": "p1", "genie": {"space_id": "sp-1", "title": "T"}}
    info = shell_core.Shell.genie_info(Stub(), page, "h", False)
    assert info["enabled"] is True and info["agent"] is False and info["note"] == ""


class NoCredentialsShell(NoSpaceShell):
    def workspace(self, headers):
        raise ValueError("default auth: cannot configure default credentials")


def test_the_agent_probe_says_no_agent_when_no_workspace_can_be_built_so_the_app_still_loads():
    agent = shell_agent.Agent(NoCredentialsShell(), executor=object(), sleep=lambda s: None, clock=lambda: 0.0)
    assert agent.ready_model({}) == ""
    assert agent.ready == {}


def test_app_info_reads_the_cached_model_and_never_calls_one():
    def must_not_run(ws, who, turn, body, timeout=0):
        raise AssertionError("app info called a model")
    agent = agent_with(must_not_run)
    assert agent.known_model({}) == ""
