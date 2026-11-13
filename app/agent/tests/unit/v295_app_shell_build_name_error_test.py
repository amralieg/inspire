"""The App shell modules build on the serverless Python, which runs before 3.14. There an annotation is evaluated when its `def`
statement runs, so `def answer_rows(turn: Turn)` above `class Turn` raised "name 'Turn' is not defined" and every MVP App build
failed. rc.10a quoted the annotation. These tests build the shipped shell modules and import them under Python 3.13, the last
interpreter before deferred annotations, so the production NameError is reproduced here. A build with the quotes dropped must fail
with that same NameError, which proves the import check catches the defect."""
import os
import re
import shutil
import subprocess

import pytest

import v266_app_shell_names_defined_test as names

MUTATED_ANNOTATION = ('def answer_rows(turn: "Turn") -> int:', 'def answer_rows(turn: Turn) -> int:')


def _pre_314_python():
    for candidate in (os.environ.get("INSPIRE_PRE_314_PYTHON"), shutil.which("python3.13"), "/opt/homebrew/bin/python3.13"):
        if candidate and os.path.exists(candidate):
            return candidate
    return None


PRE_314 = _pre_314_python()
needs_pre_314 = pytest.mark.skipif(PRE_314 is None, reason="no Python 3.13 interpreter to reproduce the pre-3.14 annotation semantics")


def _payload(agent_ns):
    return agent_ns["implement_app_shell_payload"](agent_ns["inspire_notebook_asset"]("app_shell"))


def _write(folder, files):
    os.makedirs(folder, exist_ok=True)
    for name in files:
        with open(os.path.join(folder, name), "w", encoding="utf-8") as handle:
            handle.write(files[name])


def _import_pre_314(folder, modules):
    script = f"import sys; sys.path.insert(0, sys.argv[1]); import {', '.join(modules)}"
    return subprocess.run([PRE_314, "-I", "-c", script, folder], capture_output=True, text=True, timeout=120)


def test_the_shipped_shell_modules_build_with_no_name_error(agent_ns, tmp_path):
    payload = _payload(agent_ns)
    modules = agent_ns["implement_app_shell_modules"](str(tmp_path / "_shell"), payload["files"])
    assert set(modules) == set(agent_ns["IMPLEMENT_APP_SHELL_MODULES"])


@needs_pre_314
def test_the_shipped_shell_modules_import_on_a_python_before_3_14(agent_ns, tmp_path):
    payload = _payload(agent_ns)
    names = [f"{name}.py" for name in agent_ns["IMPLEMENT_APP_SHELL_MODULES"]]
    folder = str(tmp_path / "_shell_pre314")
    _write(folder, {name: payload["files"][name] for name in names})
    result = _import_pre_314(folder, agent_ns["IMPLEMENT_APP_SHELL_MODULES"])
    assert result.returncode == 0, result.stderr


@needs_pre_314
def test_dropping_the_quotes_from_the_turn_annotation_reproduces_the_build_failure(agent_ns, tmp_path):
    payload = _payload(agent_ns)
    names = [f"{name}.py" for name in agent_ns["IMPLEMENT_APP_SHELL_MODULES"]]
    files = {name: payload["files"][name] for name in names}
    before, after = MUTATED_ANNOTATION
    assert before in files["shell_agent.py"], "the shipped shell_agent.py must quote the annotation"
    files["shell_agent.py"] = files["shell_agent.py"].replace(before, after)
    folder = str(tmp_path / "_shell_unquoted")
    _write(folder, files)
    result = _import_pre_314(folder, agent_ns["IMPLEMENT_APP_SHELL_MODULES"])
    assert result.returncode != 0
    assert "NameError: name 'Turn' is not defined" in result.stderr


def _unbound_outside_notebook(text, known):
    """A name the source reads that neither the source nor the notebook's own globals bind: exec'd sources run in those globals."""
    found = []
    for problem in names.undefined_names(text):
        name = re.search(r"(?:reads |: )([A-Za-z_]\w*)", problem).group(1)
        if name not in known:
            found.append(problem)
    return found


def test_every_generated_or_exec_d_source_binds_what_it_reads(agent_ns):
    """The sweep behind the Turn fix: the modules the notebook writes or execs, not only the shipped shell, must bind each name they read."""
    payload = _payload(agent_ns)
    known = set(agent_ns)
    sources = {
        "REDACT_SOURCE": agent_ns["REDACT_SOURCE"],
        "GENIE_NUMBER_TEXT_SOURCE": agent_ns["GENIE_NUMBER_TEXT_SOURCE"],
        "IMPLEMENT_RESULT_HISTORY_SOURCE": agent_ns["IMPLEMENT_RESULT_HISTORY_SOURCE"],
        "JobLauncher._JOB_LAUNCHER_CLASS_SOURCE": agent_ns["DatabricksInspire"]._JOB_LAUNCHER_CLASS_SOURCE,
    }
    for event_date, kinds in ((False, ()), (True, ("app",))):
        files = agent_ns["implement_app_check_files"](payload["files"], event_date, kinds=kinds, layout="grid")
        for name, text in files.items():
            if name.endswith(".py"):
                sources[f"check {event_date} {name}"] = text
    assert {label: _unbound_outside_notebook(text, known) for label, text in sources.items()
            if _unbound_outside_notebook(text, known)} == {}
