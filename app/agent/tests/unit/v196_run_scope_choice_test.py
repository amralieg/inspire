"""First run is a choice of all, groups, recent or records, never a number, even when the Genie Code notebook declares its own
run_scope widget, and the Genie Code ready line names the CPU whose CLI builds the run unpacked, offline."""
import json
import os
import types

import pytest

from v120_artifacts_support import CapturingLogger
from v177_assets_support import cli_entries, make_assets

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FIRST_RUN = json.load(open(os.path.join(ROOT, "tests", "fixtures", "implement_grouping_cases.json"), encoding="utf-8"))["first_run"]["spec"]
SPEC = {"family": "E", "decision_basis": "measured", "first_run": dict(FIRST_RUN)}
GENIE_RUN_SCOPE = {"name": "run_scope", "type": "text", "default": "all", "allowed": "", "label": "First run"}
ALLOWED = "all, groups, recent, records"


def _run_scope(model):
    found = [s for s in model if s["name"] == "run_scope"]
    assert len(found) == 1, [s["name"] for s in model]
    return found[0]


@pytest.mark.parametrize("spec", [SPEC, {"family": "E", "decision_basis": "measured"}], ids=["with a First run", "with no First run"])
def test_a_genie_run_scope_widget_is_recorded_as_the_first_run_choice_and_never_as_a_number(agent_ns, spec):
    model = agent_ns["inspire_settings_model"](spec, [dict(GENIE_RUN_SCOPE), {"name": "horizon", "type": "text", "default": "24", "allowed": "whole number, at least 1"}])
    run_scope = _run_scope(model)
    assert (run_scope["kind"], run_scope["choices"], run_scope["many"], run_scope["source"]) == ("choice", ["all", "groups", "recent", "records"], False, "widget")
    assert [s["name"] for s in model if s["name"] == "horizon"] == ["horizon"]
    if spec.get("first_run"):
        assert run_scope == agent_ns["inspire_scope_settings"](spec["first_run"])[0], "the First run definition wins over the notebook's widget"
        assert [s["name"] for s in model if s["name"].startswith(("run_scope", "scope_"))] == ["run_scope", "scope_groups", "scope_days", "scope_records"]
    recorded = _run_scope(agent_ns["inspire_run_settings_model"](model))
    assert (recorded["kind"], recorded["choices"]) == ("choice", ["all", "groups", "recent", "records"])


@pytest.mark.parametrize("value,problem", [("all", ""), ("groups", ""), ("recent", ""), ("records", ""),
                                           ("5", f"run_scope is '5'; allowed: {ALLOWED}"), ("everything", f"run_scope is 'everything'; allowed: {ALLOWED}")])
def test_the_first_run_a_built_version_records_takes_each_choice_and_refuses_a_number_or_another_word(agent_ns, value, problem):
    run_scope = _run_scope(agent_ns["inspire_settings_model"](SPEC, [dict(GENIE_RUN_SCOPE)]))
    assert agent_ns["inspire_setting_problem"](run_scope, value) == problem


def test_the_number_shape_the_live_build_recorded_is_the_one_this_fix_replaces(agent_ns):
    shadowed = agent_ns["genie_setting_bounds"]("run_scope", (None, None, False, False, False), kind="number")
    assert agent_ns["inspire_setting_problem"](shadowed, "all") == "run_scope is 'all'; allowed: a number"
    assert agent_ns["inspire_setting_problem"](shadowed, "5") == "", "a number passed and a First run choice failed before"
    fixed = _run_scope(agent_ns["inspire_settings_model"](SPEC, [dict(GENIE_RUN_SCOPE)]))
    assert agent_ns["inspire_setting_problem"](fixed, "all") == "" and agent_ns["inspire_setting_problem"](fixed, "5") != ""


def test_the_wizard_save_keeps_a_first_run_choice_the_settings_model_once_dropped(fresh_ns):
    settings = {s["name"]: s for s in fresh_ns["inspire_settings_model"](SPEC, [dict(GENIE_RUN_SCOPE)]) if s["source"] == "widget"}
    assert [name for name in ("all", "groups", "recent", "records") if fresh_ns["inspire_setting_problem"](settings["run_scope"], name)] == []


@pytest.mark.parametrize("machine,named", [("x86_64", "x86_64"), ("amd64", "x86_64"), ("aarch64", "aarch64"), ("arm64", "aarch64")])
def test_the_genie_code_ready_line_names_the_cpu_whose_cli_builds_the_run_unpacked(fresh_ns, tmp_path, monkeypatch, machine, named):
    monkeypatch.setattr(fresh_ns["os"], "symlink", os.symlink)
    assets = make_assets(fresh_ns, tmp_path / "assets", cli_entries(fresh_ns, "x86_64") + cli_entries(fresh_ns, "aarch64"), machine=machine)
    real = fresh_ns["GenieCodeRunner"]
    monkeypatch.setitem(fresh_ns, "GenieCodeRunner", lambda host, token, logger, on_line=None: real(host, token, logger, root=str(tmp_path / "r"), assets=assets))
    context = types.SimpleNamespace(apiUrl=lambda: types.SimpleNamespace(get=lambda: "https://h"), apiToken=lambda: types.SimpleNamespace(get=lambda: "t"))
    notebook = types.SimpleNamespace(getContext=lambda: context)
    emitted = []
    fake = types.SimpleNamespace(
        dbutils=types.SimpleNamespace(notebook=types.SimpleNamespace(entry_point=types.SimpleNamespace(getDbutils=lambda: types.SimpleNamespace(notebook=lambda: notebook)))),
        logger=CapturingLogger(), _implement_emit=lambda uc, step, message, status, step_id=None: emitted.append((step, message, status)) or "s1")
    runner = fresh_ns["DatabricksInspire"]._implement_runner(fake, "N01-U01")
    assert runner.install()["machine"] == named == fresh_ns["inspire_asset_machine"](machine)
    ready = [m for step, m, status in emitted if status == "ended_success"]
    assert ready == [f"Genie Code {fresh_ns['GENIE_CODE_CLI_VERSION']} ready at {tmp_path / 'r' / 'bin' / 'genie'} on the {named} CPU"]
