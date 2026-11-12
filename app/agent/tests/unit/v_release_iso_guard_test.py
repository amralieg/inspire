import pathlib
import subprocess


def _run(returncode, writes=None, stderr=""):
    def run(cmd, **kwargs):
        if writes is not None and returncode == 0:
            pathlib.Path(writes).write_text("{}", encoding="utf-8")
        return subprocess.CompletedProcess(cmd, returncode, "", stderr)
    return run


def test_the_install_refuses_when_the_before_snapshot_exits_non_zero(release_tool, tmp_path):
    rc_install = release_tool.load("rc_install")
    target = tmp_path / "before.json"
    try:
        rc_install.before_snapshot(target, run=_run(1, stderr="has no isolation.watched_apps"))
    except SystemExit as exc:
        message = str(exc)
    else:
        raise AssertionError("the install did not refuse")
    assert "before-snapshot" in message and "nothing is installed" in message and "isolation.watched_apps" in message
    assert not target.exists()


def test_the_install_refuses_when_the_snapshot_exits_zero_but_writes_no_file(release_tool, tmp_path):
    rc_install = release_tool.load("rc_install")
    target = tmp_path / "before.json"
    try:
        rc_install.before_snapshot(target, run=_run(0))
    except SystemExit as exc:
        assert "nothing is installed" in str(exc)
    else:
        raise AssertionError("a snapshot with no file let the install run")


def test_the_install_continues_only_when_the_before_snapshot_file_exists(release_tool, tmp_path):
    rc_install = release_tool.load("rc_install")
    target = tmp_path / "before.json"
    assert rc_install.before_snapshot(target, run=_run(0, writes=target)) == target
    assert target.is_file()


def test_the_guard_runs_the_snapshot_tool_from_the_release_folder(release_tool, tmp_path):
    rc_install = release_tool.load("rc_install")
    seen = {}

    def run(cmd, **kwargs):
        seen["cmd"] = cmd
        pathlib.Path(tmp_path / "before.json").write_text("{}", encoding="utf-8")
        return subprocess.CompletedProcess(cmd, 0, "", "")

    rc_install.before_snapshot(tmp_path / "before.json", run=run)
    assert seen["cmd"][1] == str(pathlib.Path(rc_install.ISOLATION))
    assert seen["cmd"][2:] == ["snapshot", str(tmp_path / "before.json")]
    assert pathlib.Path(rc_install.ISOLATION).is_file()
