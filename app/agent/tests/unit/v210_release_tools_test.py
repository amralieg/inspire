import io
import json
import os
import re
import subprocess
import sys
import tarfile
import types
import zipfile

import pytest

ENVIRONMENT = re.compile(r"/private/tmp|/tmp/inspire|/opt/homebrew|\bmy-[a-z]{3}\b|inspire[_-]kinds|\"[0-9a-f]{16}\"|"
                         r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|CATALOGS = \(\"|adb-[0-9]{6,}")


def _tool_files(release):
    return sorted(name for name in os.listdir(release) if name.endswith((".py", ".sh")))


def test_the_release_tools_are_in_the_repo(release_tool):
    held = _tool_files(release_tool.release)
    for name in ("rc_settings.py", "rc_install.py", "rc_release.py", "isolation.py", "guard_wrapper.py", "rc_stage_remote.py",
                 "kinds_rc.sh", "infra_install.py"):
        assert name in held, name


def test_no_release_tool_names_a_workspace_a_lane_folder_or_a_local_python(release_tool):
    found = {}
    for name in _tool_files(release_tool.release):
        text = open(os.path.join(release_tool.release, name), encoding="utf-8").read()
        hits = sorted({m.group(0) for m in ENVIRONMENT.finditer(text)})
        if hits:
            found[name] = hits
    assert found == {}


def test_the_environment_check_catches_the_values_the_tools_used_to_hard_code():
    for text in ('PROFILE = "my-xyz"', 'W40 = pathlib.Path("/private/tmp/lane/release/work")', 'WAREHOUSE = "0123abcd4567ef89"',
                 'PROTECTED_SP = "aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb"', 'run(["/opt/homebrew/bin/python3", "release.py"])',
                 'CATALOGS = ("team_one", "team_two")', 'HOST = "https://adb-4444444444.4.example.net"', 'APP = "inspire-kinds"'):
        assert ENVIRONMENT.search(text), text


@pytest.mark.parametrize("name", ["rc_install", "rc_release", "isolation", "infra_install"])
def test_each_tool_refuses_to_start_without_its_settings_file(release_tool, monkeypatch, name):
    monkeypatch.delenv("INSPIRE_RC_SETTINGS")
    with pytest.raises(SystemExit, match="set INSPIRE_RC_SETTINGS"):
        release_tool.load(name)


def test_a_settings_file_that_does_not_exist_is_named(release_tool, monkeypatch):
    monkeypatch.setenv("INSPIRE_RC_SETTINGS", str(release_tool.root / "nowhere.json"))
    with pytest.raises(SystemExit, match="nowhere.json, which is not a file"):
        release_tool.load("rc_install")


@pytest.mark.parametrize("key, tool", [("warehouse", "rc_install"), ("watched_service_principals", "rc_install"),
                                       ("extra_leak_pattern", "rc_release"), ("leak_scan", "rc_release"),
                                       ("infra_envs", "infra_install")])
def test_a_missing_setting_stops_the_tool_and_is_named(release_tool, key, tool):
    del release_tool.settings[key]
    with pytest.raises(SystemExit, match=f"has no {key}$"):
        release_tool.load(tool)


def test_an_empty_or_missing_nested_setting_is_named(release_tool):
    release_tool.settings["isolation"]["trees"] = []
    with pytest.raises(SystemExit, match="has no isolation.trees$"):
        release_tool.load("isolation")
    del release_tool.settings["isolation"]
    with pytest.raises(SystemExit, match="has no isolation.watched_apps$"):
        release_tool.load("isolation")


def test_the_settings_reach_every_tool(release_tool):
    install = release_tool.load("rc_install")
    assert (install.PROFILE, install.WAREHOUSE, install.CATALOG, install.SCRATCH_APP, install.WORKSPACE_FOLDER) == (
        "test-profile", "wh0", "test_cat", "scratch-app", "rc_tests")
    assert install.PROTECTED_APPS == {"kept-app", "kept-app-2"} and install.WATCHED_SPS == {"sp-watched"}
    assert str(install.W40) == release_tool.settings["work"]
    release = release_tool.load("rc_release")
    assert release.EXTRA.pattern == "secret-host" and str(release.LEAK_SCAN) == release_tool.settings["leak_scan"]
    assert release.REVIEWED == () and release.LONG_REVIEWED == {}
    isolation = release_tool.load("isolation")
    assert isolation.CATALOGS == ("kept_cat", "lb_cat") and isolation.OWN_PATHS == ("scratch-app", "/v9.9.9")


class _Calls:
    def __init__(self):
        self.made = []

    def __getattr__(self, name):
        def call(*args, **kwargs):
            self.made.append(name)
            raise RuntimeError("stop here")
        return call


def test_prep_never_touches_a_protected_or_foreign_app(release_tool):
    install = release_tool.load("rc_install")
    for app in ("kept-app", "kept-app-2", "someone-elses-app"):
        w = types.SimpleNamespace(workspace=_Calls())
        with pytest.raises(SystemExit, match="is not a scratch App name of this lane"):
            install.prep(w, "v0.0.1-rc.1", "/Users/<user>/rc_tests/x", app, release_tool.root / "work")
        assert w.workspace.made == [], app


def test_prep_goes_on_to_the_workspace_for_the_scratch_app(release_tool):
    install = release_tool.load("rc_install")
    w = types.SimpleNamespace(workspace=_Calls())
    with pytest.raises(RuntimeError, match="stop here"):
        install.prep(w, "v0.0.1-rc.1", "/Users/<user>/rc_tests/x", "scratch-app", release_tool.root / "work")
    assert w.workspace.made == ["delete", "mkdirs"]


def test_a_scratch_app_listed_as_protected_is_still_refused(release_tool):
    release_tool.settings["protected_apps"].append("scratch-app")
    install = release_tool.load("rc_install")
    with pytest.raises(SystemExit, match="is not a scratch App name of this lane"):
        install.prep(types.SimpleNamespace(workspace=_Calls()), "v0.0.1-rc.1", "/Users/me/x", "scratch-app", release_tool.root)


def test_busy_runs_count_only_the_watched_service_principals_and_the_apps_own(release_tool):
    install = release_tool.load("rc_install")
    runs = [types.SimpleNamespace(run_id=1, creator_user_name="sp-watched"), types.SimpleNamespace(run_id=2, creator_user_name="sp-app"),
            types.SimpleNamespace(run_id=3, creator_user_name="a-person"), types.SimpleNamespace(run_id=4, creator_user_name=None)]
    w = types.SimpleNamespace(apps=types.SimpleNamespace(get=lambda name: types.SimpleNamespace(service_principal_client_id="sp-app")),
                              jobs=types.SimpleNamespace(list_runs=lambda active_only: iter(runs)))
    assert install.busy_protected_runs(w, "scratch-app") == [1, 2]


def test_busy_runs_for_an_app_not_created_yet_watch_the_listed_principals_only(release_tool):
    install = release_tool.load("rc_install")

    def missing(name):
        raise RuntimeError("App scratch-app does not exist")
    runs = [types.SimpleNamespace(run_id=1, creator_user_name="sp-watched"), types.SimpleNamespace(run_id=2, creator_user_name="sp-app")]
    w = types.SimpleNamespace(apps=types.SimpleNamespace(get=missing), jobs=types.SimpleNamespace(list_runs=lambda active_only: iter(runs)))
    assert install.busy_protected_runs(w, "scratch-app") == [1]


def test_a_network_error_waits_through_the_net_wait_setting_and_other_errors_do_not(release_tool):
    marker = release_tool.root / "waited"
    release_tool.settings["net_wait"] = [sys.executable, "-c", f"open({str(marker)!r}, 'a').write('x')"]
    install = release_tool.load("rc_install")
    tries = []

    def flaky():
        tries.append(1)
        if len(tries) == 1:
            raise OSError("connection reset by peer")
        return "done"
    assert install.retried(flaky) == "done" and marker.read_text() == "x"

    def broken():
        raise ValueError("bad request")
    with pytest.raises(ValueError):
        install.retried(broken)
    assert marker.read_text() == "x"


def test_the_install_client_waits_for_the_upload_of_the_assets_tar(release_tool, monkeypatch):
    install = release_tool.load("rc_install")
    seen = {}
    monkeypatch.setattr(install, "Config", lambda **kw: seen.setdefault("config", kw))
    monkeypatch.setattr(install, "WorkspaceClient", lambda **kw: seen.setdefault("client", kw))
    install.client()
    assert install.UPLOAD_TIMEOUT_SECONDS == 1800
    assert seen["config"] == {"profile": install.PROFILE, "http_timeout_seconds": 1800}
    assert seen["client"] == {"config": seen["config"]}


def test_the_install_tools_build_their_client_with_the_long_timeout_not_the_default():
    release = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "release")
    for name in ("rc_install.py", "kinds_rc.sh"):
        with open(os.path.join(release, name), encoding="utf-8") as handle:
            text = handle.read()
        assert "WorkspaceClient(profile=" not in text, name


def test_a_release_candidate_tag_needs_single_digits(release_tool):
    install = release_tool.load("rc_install")
    assert install.default_app("v1.4.0-rc.7") == "scratch-app"
    for tag in ("v1.4.0-rc.10", "v1.4.10-rc.1", "v1.4.0"):
        with pytest.raises(SystemExit):
            install.default_app(tag)


def _release(folder, member_text):
    folder.mkdir(parents=True)
    (folder / "inspire_installer.py").write_text("print('installer')\n", encoding="utf-8")
    (folder / "manifest.json").write_text('{"version": "v0.0.1"}', encoding="utf-8")
    with zipfile.ZipFile(folder / "inspire-app.zip", "w") as archive:
        archive.writestr("app/server.js", member_text)
    data = b'{"files": []}'
    with tarfile.open(folder / "inspire-assets.tar", "w") as tar:
        info = tarfile.TarInfo("manifest.json")
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))
    return folder


def test_the_leak_scan_finds_the_settings_pattern_the_repo_rules_and_long_numbers(release_tool):
    release = release_tool.load("rc_release")
    hits = release.leak_scan(_release(release_tool.root / "work" / "t" / "release", "host secret-host and leaky-word and 5550123456789012"), "notes")
    joined = "\n".join(hits)
    assert len(hits) == 3 and "secret-host" in joined and "leaky-word" in joined and "unreviewed number 5550123456789012" in joined


def test_the_leak_scan_passes_a_clean_release_and_honours_the_reviewed_lists(release_tool):
    release = release_tool.load("rc_release")
    assert release.leak_scan(_release(release_tool.root / "work" / "a" / "release", "nothing to see; leaky-word.example"), "notes") == []
    release_tool.settings["reviewed_leak_lines"] = ["secret-host.example"]
    release_tool.settings["reviewed_long_numbers"] = {"5550123456789012": "a reviewed test id"}
    release = release_tool.load("rc_release")
    assert release.leak_scan(_release(release_tool.root / "work" / "b" / "release", "secret-host.example 5550123456789012"), "notes") == []


def _blob(data):
    import base64
    return "module.exports = \"" + base64.b64encode(data).decode("ascii") + "\";\n"


def test_the_leak_scan_reads_the_text_inside_a_compressed_embedded_blob(release_tool):
    import random
    import zlib
    release = release_tool.load("rc_release")
    text = (random.Random(0).randbytes(8000).hex() + " leaky-word ").encode("utf-8")
    hits = release.leak_scan(_release(release_tool.root / "work" / "z" / "release", _blob(zlib.compress(text, 9))), "notes")
    assert len(hits) == 1 and "leaky-word" in hits[0] and "(decoded)" in hits[0]


def test_the_leak_scan_skips_letters_that_happen_to_appear_inside_binary_blob_bytes(release_tool):
    release = release_tool.load("rc_release")
    data = b"\x00\x01leaky-word\x00" + bytes(range(256)) * 40
    assert release.leak_scan(_release(release_tool.root / "work" / "y" / "release", _blob(data)), "notes") == []


def test_the_leak_scan_reads_a_compressed_json_payload_as_its_strings_not_its_escapes(release_tool):
    import base64
    import random
    import zlib
    release_tool.settings["extra_leak_pattern"] = r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"
    release = release_tool.load("rc_release")
    noise = random.Random(1).randbytes(8000).hex()
    image = base64.b64encode(b"\x89PNG\x00\x00leaky-word" + bytes(range(256)) * 40).decode("ascii")
    payload = {"files": {"server.py": "app = App()\n\n" + "@app.get(\"/\")\ndef index():\n    return 1\n", "noise.txt": noise},
               "binary": {"static/logo.png": image}}
    clean = zlib.compress(json.dumps(payload).encode("utf-8"), 9)
    assert release.leak_scan(_release(release_tool.root / "work" / "j" / "release", _blob(clean)), "notes") == []
    payload["files"]["notes.txt"] = "write to someone@example.com"
    leaky = zlib.compress(json.dumps(payload).encode("utf-8"), 9)
    hits = release.leak_scan(_release(release_tool.root / "work" / "k" / "release", _blob(leaky)), "notes")
    assert len(hits) == 1 and "someone@example.com" in hits[0]


@pytest.mark.parametrize("argv, message", [
    (["v1.4.0-rc.10", "app", "agent"], "is not vN.N.N-rc.N with single digits"),
    (["v1.4.0-rc.7", "app", "agent", "--compare-to", "v0.10.0"], "is not vN.N.N-rc.N with single digits"),
    (["v1.4.0-rc.7", "app", "agent", "--target", "abc123"], "is not a full commit SHA"),
    (["v1.4.0-rc.7", "app", "agent"], "only --skip-build runs without it"),
])
def test_rc_release_refuses_bad_arguments_before_doing_anything(release_tool, monkeypatch, argv, message):
    release = release_tool.load("rc_release")
    monkeypatch.setattr(sys, "argv", ["rc_release.py", *argv])
    with pytest.raises(SystemExit, match=message):
        release.main()


_ARGV = ["rc_release.py", "v1.4.0-rc.7", "app", "agent", "--assets", "assets", "--dry-run"]


def _stop_at_build(release, monkeypatch):
    built = []

    def build(args, work):
        built.append(work)
        raise RuntimeError("build reached")
    monkeypatch.setattr(release, "build", build)
    monkeypatch.setattr(sys, "argv", _ARGV)
    return built


def test_rc_release_stops_before_the_build_when_the_leak_scan_file_is_gone(release_tool, monkeypatch):
    release_tool.settings["leak_scan"] = str(release_tool.root / "gone" / "leak_scan.py")
    release = release_tool.load("rc_release")
    built = _stop_at_build(release, monkeypatch)
    with pytest.raises(SystemExit, match=r"names helper files that are not there: leak_scan .*gone/leak_scan\.py"):
        release.main()
    assert built == []


@pytest.mark.parametrize("command, named", [
    (["{python}", "{root}/gone/net_wait.py"], r"net_wait file .*gone/net_wait\.py"),
    (["no-such-python-here", "{root}/net_wait.py"], r"net_wait program no-such-python-here"),
    ("{root}/gone/net_wait.sh", r"net_wait program .*gone/net_wait\.sh"),
])
def test_rc_release_stops_before_the_build_when_the_net_wait_command_is_gone(release_tool, monkeypatch, command, named):
    (release_tool.root / "net_wait.py").write_text("print('up')\n", encoding="utf-8")
    fill = lambda part: part.format(python=sys.executable, root=release_tool.root)
    release_tool.settings["net_wait"] = fill(command) if isinstance(command, str) else [fill(p) for p in command]
    release = release_tool.load("rc_release")
    built = _stop_at_build(release, monkeypatch)
    with pytest.raises(SystemExit, match=named):
        release.main()
    assert built == []


def test_rc_release_names_every_missing_helper_at_once(release_tool, monkeypatch):
    release_tool.settings["leak_scan"] = str(release_tool.root / "gone" / "leak_scan.py")
    release_tool.settings["net_wait"] = [sys.executable, str(release_tool.root / "gone" / "net_wait.py")]
    release = release_tool.load("rc_release")
    _stop_at_build(release, monkeypatch)
    with pytest.raises(SystemExit) as stop:
        release.main()
    assert "leak_scan" in str(stop.value) and "net_wait file" in str(stop.value)


@pytest.mark.parametrize("net_wait", [None, ["{python}", "{root}/net_wait.py"], ["{python}", "-c", "print(1)"]])
def test_rc_release_goes_on_to_the_build_when_the_helpers_are_there(release_tool, monkeypatch, net_wait):
    (release_tool.root / "net_wait.py").write_text("print('up')\n", encoding="utf-8")
    if net_wait:
        release_tool.settings["net_wait"] = [p.format(python=sys.executable, root=release_tool.root) for p in net_wait]
    release = release_tool.load("rc_release")
    built = _stop_at_build(release, monkeypatch)
    with pytest.raises(RuntimeError, match="build reached"):
        release.main()
    assert len(built) == 1


def test_rc_install_stops_at_the_start_when_the_net_wait_script_is_gone(release_tool, monkeypatch):
    release_tool.settings["net_wait"] = [sys.executable, str(release_tool.root / "gone" / "net_wait.py")]
    install = release_tool.load("rc_install")
    monkeypatch.setattr(sys, "argv", ["rc_install.py", "v1.4.0-rc.7", "verify"])
    with pytest.raises(SystemExit, match=r"net_wait file .*gone/net_wait\.py"):
        install.main()
    release_tool.settings["net_wait"] = [sys.executable, "-c", "print(1)"]
    install = release_tool.load("rc_install")
    with pytest.raises(SystemExit, match="holds no built release"):
        install.main()


def _snapshot(grants, paths):
    return {"apps": {}, "lakebase": {}, "folders": {"/Shared/kept": [[p, "FILE", 1, 0, 0] for p in paths]}, "trees": {},
            "acl": {}, "grants": {"catalog:kept_cat": grants}, "own_sp": ["sp-scratch", "scratch-app SP"]}


def _diff(release_tool, tmp_path, before, after, capsys):
    isolation = release_tool.load("isolation")
    (tmp_path / "b.json").write_text(json.dumps(before))
    (tmp_path / "a.json").write_text(json.dumps(after))
    code = isolation.diff(str(tmp_path / "b.json"), str(tmp_path / "a.json"))
    return code, capsys.readouterr().out


def test_isolation_flags_a_removed_grant_on_a_watched_catalog(release_tool, tmp_path, capsys):
    code, out = _diff(release_tool, tmp_path, _snapshot([["a-team", "USE CATALOG", "CATALOG", "kept_cat"]], []), _snapshot([], []), capsys)
    assert code == 1 and "CHANGED grants.catalog:kept_cat: removed" in out


def test_isolation_allows_a_grant_to_the_scratch_apps_own_principal_only(release_tool, tmp_path, capsys):
    code, out = _diff(release_tool, tmp_path, _snapshot([], []), _snapshot([["sp-scratch", "USE CATALOG", "CATALOG", "kept_cat"]], []), capsys)
    assert code == 0 and "ALLOWED grants.catalog:kept_cat: added" in out
    code, out = _diff(release_tool, tmp_path, _snapshot([], []), _snapshot([["a-stranger", "USE CATALOG", "CATALOG", "kept_cat"]], []), capsys)
    assert code == 1 and "CHANGED grants.catalog:kept_cat: added" in out


def test_isolation_counts_new_paths_under_the_own_paths_setting_as_allowed(release_tool, tmp_path, capsys):
    code, out = _diff(release_tool, tmp_path, _snapshot([], ["/Shared/kept/x"]),
                      _snapshot([], ["/Shared/kept/x", "/Shared/kept/assets/v9.9.9/a", "/Shared/kept/scratch-app/b", "/Shared/kept/other"]), capsys)
    assert code == 0
    assert "ALLOWED folders./Shared/kept: added /Shared/kept/assets/v9.9.9/a" in out
    assert "ALLOWED folders./Shared/kept: added /Shared/kept/scratch-app/b" in out
    assert "NOT MINE folders./Shared/kept: added /Shared/kept/other" in out
    code, out = _diff(release_tool, tmp_path, _snapshot([], ["/Shared/kept/x"]), _snapshot([], []), capsys)
    assert code == 1 and "removed /Shared/kept/x" in out


def _kinds_rc(release_tool, *args):
    env = {**os.environ, "INSPIRE_RC_SETTINGS": str(release_tool.path), "INSPIRE_RC_PYTHON": sys.executable}
    release_tool.write()
    return subprocess.run(["bash", os.path.join(release_tool.release, "kinds_rc.sh"), *args], capture_output=True, text=True, env=env, timeout=60)


def test_kinds_rc_parses(release_tool):
    assert subprocess.run(["bash", "-n", os.path.join(release_tool.release, "kinds_rc.sh")]).returncode == 0


@pytest.mark.parametrize("args, message", [
    ([], "usage:"),
    (["abc", "v1.4.0-rc.10"], "is not vN.N.N-rc.N with single digits"),
    (["abc", "v1.4.0"], "is not vN.N.N-rc.N with single digits"),
    (["abc", "v1.4.0-rc.7", "--publish"], "unknown flag --publish"),
])
def test_kinds_rc_refuses_bad_arguments_before_any_git_or_network_step(release_tool, args, message):
    done = _kinds_rc(release_tool, *args)
    assert done.returncode == 1 and message in done.stderr and "==== 1." not in done.stdout


def test_kinds_rc_refuses_a_protected_scratch_app(release_tool):
    release_tool.settings["scratch_app"] = "kept-app-2"
    done = _kinds_rc(release_tool, "abc", "v1.4.0-rc.7")
    assert done.returncode == 1 and "kept-app-2 is protected" in done.stderr and "==== 1." not in done.stdout


def test_kinds_rc_stops_when_a_setting_is_missing(release_tool):
    del release_tool.settings["latest_tag"]
    done = _kinds_rc(release_tool, "abc", "v1.4.0-rc.7")
    assert done.returncode != 0 and "has no latest_tag" in done.stderr


def test_kinds_rc_checks_latest_against_the_latest_tag_setting(release_tool):
    text = open(os.path.join(release_tool.release, "kinds_rc.sh"), encoding="utf-8").read()
    assert 'LATEST=$(setting latest_tag)' in text
    assert '[ "${loc##*/}" = "$LATEST" ] && [ "$LATEST" != "$TAG" ] || fail' in text


def test_kinds_rc_takes_the_draft_id_from_the_create_reply_not_from_a_later_listing(release_tool):
    text = open(os.path.join(release_tool.release, "kinds_rc.sh"), encoding="utf-8").read()
    assert 'ID=$(gh api -X POST "repos/$REPO/releases"' in text and "-F draft=true -F prerelease=true -f make_latest=false --jq .id)" in text
    assert "gh release create \"$TAG\" --repo \"$REPO\" --draft" not in text
    assert text.count("ID=$(draft_id)") == 1


def _verify_stage(release_tool, monkeypatch, run_result, defaults):
    install = release_tool.load("rc_install")
    work = install.W40 / "v0.0.1-rc.1"
    (work / "release").mkdir(parents=True)
    (work / "release" / "manifest.json").write_text("{}", encoding="utf-8")
    (install.W40 / "v0.0.1-rc.1_install.json").write_text(json.dumps({"run_id": 7, "folder": "/Users/<user>/rc_tests/x"}),
                                                           encoding="utf-8")
    me = types.SimpleNamespace(user_name="me")
    monkeypatch.setattr(install, "WorkspaceClient", lambda config: types.SimpleNamespace(
        current_user=types.SimpleNamespace(me=lambda: me), jobs=types.SimpleNamespace(get_run=None)), raising=False)
    monkeypatch.setattr(install.rc_settings, "require_tools", lambda *a, **k: None)
    state = types.SimpleNamespace(result_state=types.SimpleNamespace(value=run_result) if run_result else None)
    monkeypatch.setattr(install, "retried", lambda call, run_id: types.SimpleNamespace(state=state, start_time=0, end_time=37000))
    monkeypatch.setattr(install, "output_text", lambda w, run: "installer output")
    monkeypatch.setattr(install, "verify", lambda *a: {"envSkipsSetupWizard": defaults})
    monkeypatch.setattr(sys, "argv", ["rc_install.py", "v0.0.1-rc.1", "verify", "--app", "scratch-app"])
    return install


@pytest.mark.parametrize("run_result, defaults, named", [
    ("FAILED", True, "the installer job 7 ended FAILED"),
    (None, True, "the installer job 7 ended None"),
    ("SUCCESS", False, "envSkipsSetupWizard False"),
    ("SUCCESS", None, "envSkipsSetupWizard None"),
])
def test_an_install_that_failed_exits_non_zero_and_names_why(release_tool, monkeypatch, run_result, defaults, named):
    install = _verify_stage(release_tool, monkeypatch, run_result, defaults)
    with pytest.raises(SystemExit) as stop:
        install.main()
    assert named in str(stop.value.code)
    assert json.loads((install.W40 / "v0.0.1-rc.1_verify.json").read_text(encoding="utf-8"))["result"] == run_result


def test_an_install_that_worked_and_skips_the_wizard_exits_zero(release_tool, monkeypatch):
    install = _verify_stage(release_tool, monkeypatch, "SUCCESS", True)
    install.main()
    assert install.install_failures({"result": "SUCCESS", "envSkipsSetupWizard": True}) == []
