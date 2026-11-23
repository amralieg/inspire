import json
import pathlib
import sys

import pytest

TAG = "v9.9.9"
RC = "v9.9.9-rc.1"
SHA = "a" * 40
SOURCES = {"tag": TAG, "app_sha": SHA, "agent_sha": SHA, "version": "9.9.9"}

# The text of a real final release's notes (the v1.6.0 notes), the shape the validator must accept.
V160_NOTES = '''
# Inspire v1.6.0

This release puts a business value on every use case: a step-by-step Calculate value wizard, value boxes on cards, runs and the Review header, and an estimated-value disclaimer wherever a value shows. Inspire's App identity now holds every permission it needs up front, so a Build no longer stops on read access, and model calls go through the Unity AI Gateway.

## Changes

- Calculate value opens a step-by-step wizard: data, value drivers, one page per driver, then Save.
- Each driver shows a live formula line and input help; the dialog adds a formula diagram, a parts chart and a confidence meter.
- Market and customer factors have their own revenue-only step.
- The Save step shows every number and the terms, and saving needs the accept tick.
- A value reads "Provisional estimate" when Inspire computed it and "Reviewed calculation" once you accept it.
- Calculate many use cases at once from the defaults; the run keeps going in the background with a progress bar.
- Each card shows its score and value boxes, with How we got this number; the Review header and each run show the run's value.
- Every value uses the use case's own rule and baseline, with no double counting, and the run total is AI-checked.
- An estimated-value disclaimer sits under every overall value and as a footer on every page that shows a value.
- Score refine offers Apply, Undo and Keep, and reorders the cards at once.
- Build next opens the value wizard, and an MVP build reads the saved value.
- A built App counts the value each person saved, with streak and milestone badges.
- The Build wizard asks how to build the App: Standard (What, Look, Build) or Advanced.
- The Review page has Use cases, Business and Assets tabs, with the Domains tree beside Use cases.
- Every wait shows a spinner, plus a still-working line after 8 seconds.
- A Build is never disabled by the App's read access; tables you own are granted with your own permission.
- Permission Required no longer opens on load: an inline note shows the exact grant to pass on, in plain words.
- The App's model calls use the Unity AI Gateway system.ai models; the installer checks the App's model access and lists the admin steps when it is missing.
- Start lists only the catalogs the App can read; the All pick skips a catalog whose rights cannot be read instead of stopping the install.
- The uninstall dialog names the use cases that share the App.
- The DBUs-per-use-case line is removed.

## Known issues

- After Accept and save, the Build next row can still say "Provisional estimate" until the page is reloaded.
- The Change run list can miss the per-run value box and the value across all runs.
- With four drivers, the Save step scrolls on a 1280x800 screen; some risk-avoided driver pages also scroll at 1280x800 and 1440x900.
- Driver pages show the formula as tiles, without a chart.
- A metastore admin must grant the App EXECUTE on the system.ai models it uses; the installer shows the statements.

## Install

Download `inspire_installer.py` from this release, import it into a workspace folder, and run it. The install restarts the App, so start it when no Inspire job is running.
'''
VALID = V160_NOTES.replace("# Inspire v1.6.0", "# Inspire v9.9.9", 1)


def _notes(tmp_path, text):
    path = tmp_path / "notes.md"
    path.write_text(text, encoding="utf-8")
    return path


def _argv(monkeypatch, tag, *extra, dry=False):
    monkeypatch.setattr(sys, "argv", ["rc_release.py", tag, "app", "agent", "--skip-build", *(["--dry-run"] if dry else []), *map(str, extra)])


def _guard(release, monkeypatch):
    """Every external call is recorded; the run must stop before the first one when the notes are wrong."""
    calls = []

    def run(cmd, *a, **k):
        calls.append(cmd)
        raise AssertionError(f"run reached: {cmd}")
    monkeypatch.setattr(release, "run", run)
    monkeypatch.setattr(release, "build", lambda *a, **k: calls.append("build"))
    monkeypatch.setattr(release, "leak_scan", lambda *a, **k: calls.append("leak_scan") or [])
    return calls


def _work(release, tag, version="9.9.9"):
    work = release.W22 / tag
    (work / "release").mkdir(parents=True)
    (work / "sources.json").write_text(json.dumps({**SOURCES, "tag": tag, "version": version}), encoding="utf-8")
    return work


@pytest.mark.parametrize("dry", [False, True])
def test_a_final_tag_without_a_notes_file_stops_before_any_call(release_tool, monkeypatch, dry):
    release = release_tool.load("rc_release")
    calls = _guard(release, monkeypatch)
    _work(release, TAG + ("-dry" if dry else ""))
    _argv(monkeypatch, TAG, dry=dry)
    with pytest.raises(SystemExit, match="notes-file"):
        release.main()
    assert calls == []


@pytest.mark.parametrize("missing", ["## Known issues", "## Install", "## Changes", "# Inspire v9.9.9"])
def test_b_notes_lacking_a_part_name_that_part(release_tool, monkeypatch, tmp_path, missing):
    release = release_tool.load("rc_release")
    calls = _guard(release, monkeypatch)
    _work(release, TAG)
    text = VALID.replace(missing, "## Other" if missing.startswith("##") else "# Something else")
    _argv(monkeypatch, TAG, "--notes-file", _notes(tmp_path, text))
    with pytest.raises(SystemExit, match=missing.replace("## ", "").replace("# ", "")):
        release.main()
    assert calls == []


def test_b_empty_notes_and_a_changes_section_without_a_bullet_are_refused(release_tool, monkeypatch, tmp_path):
    release = release_tool.load("rc_release")
    calls = _guard(release, monkeypatch)
    _work(release, TAG)
    for text in ("", "   \n", "# Inspire v9.9.9\n\nSummary.\n\n## Changes\n\nnothing\n\n## Known issues\n\n- x\n\n## Install\n\nrun it\n"):
        _argv(monkeypatch, TAG, "--notes-file", _notes(tmp_path, text))
        with pytest.raises(SystemExit, match="rc_release"):
            release.main()
    _argv(monkeypatch, TAG, "--notes-file", tmp_path / "gone.md")
    with pytest.raises(SystemExit, match="gone.md"):
        release.main()
    assert calls == []


def test_c_the_leak_scan_reads_the_notes_file_text(release_tool, monkeypatch, tmp_path):
    release = release_tool.load("rc_release")
    _guard(release, monkeypatch)
    seen = []
    monkeypatch.setattr(release, "leak_scan", lambda release_dir, notes: seen.append(notes) or ["stop here"])
    _work(release, TAG)
    _argv(monkeypatch, TAG, "--notes-file", _notes(tmp_path, VALID))
    with pytest.raises(SystemExit, match="leak hit"):
        release.main()
    assert seen == [VALID]


def _publish_stub(release, monkeypatch, work, existing):
    for name in release.PUBLISHED:
        (work / "release" / name).write_text(name, encoding="utf-8")
    local = {n: f"sha256:{release.sha256_file(work / 'release' / n)}" for n in release.PUBLISHED}
    monkeypatch.setattr(release, "remote_digests", lambda tag, env: dict(local))
    calls = []

    def run(cmd, cwd=None, env=None, network=False, capture=True):
        calls.append(list(cmd))
        if cmd[:3] == ["gh", "api", "user"]:
            return "amralieg\n"
        if cmd[:3] == ["gh", "auth", "token"]:
            return "token\n"
        if cmd[:3] == ["gh", "release", "list"]:
            return json.dumps(existing)
        if cmd[:3] == ["gh", "release", "view"]:
            return json.dumps({"url": "https://example.test/r", "isPrerelease": True})
        return ""
    monkeypatch.setattr(release, "run", run)
    return calls


def test_c_gh_release_create_carries_the_notes_file(release_tool, monkeypatch, tmp_path):
    release = release_tool.load("rc_release")
    work = _work(release, TAG)
    calls = _publish_stub(release, monkeypatch, work, [])
    # after create the list holds the new pre-release
    state = {"n": 0}
    inner = release.run

    def run(cmd, *a, **k):
        if cmd[:3] == ["gh", "release", "list"]:
            state["n"] += 1
            return json.dumps([] if state["n"] == 1 else [{"tagName": TAG, "isPrerelease": True, "isLatest": False}])
        return inner(cmd, *a, **k)
    monkeypatch.setattr(release, "run", run)
    notes = _notes(tmp_path, VALID)
    _argv(monkeypatch, TAG, "--notes-file", notes)
    monkeypatch.setattr(release, "leak_scan", lambda *a, **k: [])
    monkeypatch.setattr(release, "check", lambda *a, **k: "")
    release.main()
    create = [c for c in calls if c[:3] == ["gh", "release", "create"]]
    assert len(create) == 1 and create[0][create[0].index("--notes-file") + 1] == str(notes)
    assert "--notes" not in create[0]


def test_d_an_existing_prerelease_gets_its_notes_edited(release_tool, monkeypatch, tmp_path):
    release = release_tool.load("rc_release")
    work = _work(release, TAG)
    existing = [{"tagName": TAG, "isPrerelease": True, "isLatest": False}]
    calls = _publish_stub(release, monkeypatch, work, existing)
    notes = _notes(tmp_path, VALID)
    _argv(monkeypatch, TAG, "--notes-file", notes)
    monkeypatch.setattr(release, "leak_scan", lambda *a, **k: [])
    monkeypatch.setattr(release, "check", lambda *a, **k: "")
    release.main()
    edit = [c for c in calls if c[:3] == ["gh", "release", "edit"]]
    assert len(edit) == 1 and edit[0][3] == TAG and edit[0][edit[0].index("--notes-file") + 1] == str(notes)
    assert not [c for c in calls if c[:3] == ["gh", "release", "create"]]


def test_e_an_rc_tag_without_a_notes_file_keeps_the_generated_note(release_tool, monkeypatch, tmp_path):
    release = release_tool.load("rc_release")
    work = _work(release, RC)
    sources = json.loads((work / "sources.json").read_text(encoding="utf-8"))
    calls = _publish_stub(release, monkeypatch, work, [])
    state = {"n": 0}
    inner = release.run

    def run(cmd, *a, **k):
        if cmd[:3] == ["gh", "release", "list"]:
            state["n"] += 1
            return json.dumps([] if state["n"] == 1 else [{"tagName": RC, "isPrerelease": True, "isLatest": False}])
        return inner(cmd, *a, **k)
    monkeypatch.setattr(release, "run", run)
    seen = []
    monkeypatch.setattr(release, "leak_scan", lambda d, notes: seen.append(notes) or [])
    monkeypatch.setattr(release, "check", lambda *a, **k: "")
    _argv(monkeypatch, RC)
    release.main()
    create = [c for c in calls if c[:3] == ["gh", "release", "create"]][0]
    assert create[create.index("--notes") + 1] == release.notes_of(sources) == seen[0]
    assert "--notes-file" not in create


def test_f_the_validator_accepts_the_v160_notes_and_names_every_gap(release_tool):
    release = release_tool.load("rc_release")
    assert release.final_notes_problems(V160_NOTES, "v1.6.0") == []
    assert release.final_notes_problems(V160_NOTES, "v1.7.0") != []
    assert release.final_notes_problems("", TAG)
    joined = " ".join(release.final_notes_problems("# Inspire v9.9.9\n", TAG))
    assert "Changes" in joined and "Known issues" in joined and "Install" in joined
