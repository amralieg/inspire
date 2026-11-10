import os
import subprocess

import pytest

from v120_artifacts_support import make_inspire


def _runner(ns, tmp_path, popen=None):
    runner = ns["GenieCodeRunner"]("https://workspace.example.com/", "tok-123", None, root=str(tmp_path), popen=popen)
    runner.genie_path, runner.cli_dir = "/bin/genie", str(tmp_path / "cli")
    return runner


def test_pip_and_uv_installs_are_blocked_in_the_genie_shell_and_install_nothing(agent_ns, tmp_path):
    env = _runner(agent_ns, tmp_path).env()
    assert env["PATH"].startswith(os.path.join(str(tmp_path), "no-install") + os.pathsep) or env["PATH"].startswith(
        os.path.join(str(tmp_path), "no-install") + ":")
    assert env["PIP_NO_INDEX"] == "1" and env["UV_NO_INDEX"] == "1"
    for command in (["pip", "install", "sqlglot"], ["pip3", "install", "sqlglot"], ["uv", "pip", "install", "sqlglot"]):
        done = subprocess.run(command, env=env, capture_output=True, text=True)
        assert done.returncode == 1, command
        assert "Installs are blocked in this run" in done.stderr and "Nothing was installed" in done.stderr


def test_the_genie_prompt_says_packages_are_preinstalled_and_installs_are_forbidden(agent_ns, tmp_path):
    captured = []

    def popen(command, **kw):
        captured.append(command)
        raise RuntimeError("captured the command")

    runner = _runner(agent_ns, tmp_path, popen=popen)
    with pytest.raises(RuntimeError, match="captured the command"):
        runner._run_once("build it", str(tmp_path / "w"), None, "build")
    assert "already installed" in captured[0][-1] and "Installs are forbidden" in captured[0][-1]


def test_a_sqlglot_pin_that_cannot_load_ends_the_build_once_with_a_plain_blocked_reason(agent_ns):
    inst = make_inspire(agent_ns)
    recorded = []

    def refuse(module, purpose):
        raise RuntimeError(f"{purpose} cannot be generated: sqlglot is already loaded in this Python process from /x/y/sqlglot")

    inst._require_asset_package = refuse
    inst._implement_failed = lambda uc_id, key, message, extra, fields: recorded.append(message) or "failed"
    inst._implement_attempts = lambda *a: (_ for _ in ()).throw(AssertionError("the build must not retry an unloadable pin"))
    assert inst._implement_one({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 2}) == "failed"
    assert len(recorded) == 1 and "cannot be generated" in recorded[0] and "/x/y" not in recorded[0]
