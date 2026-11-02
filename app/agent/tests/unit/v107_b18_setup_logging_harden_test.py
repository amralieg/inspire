"""v1.0.7 B18 — setup_logging additional defensive layers on Databricks Serverless.

Adds two defensive layers ON TOP OF v1.0.5 B14 + v1.0.6 B17 that already live in
`setup_logging(output_dir)` in `agent/dbx_inspire_ai_agent.ipynb`:

  L1 (existing v1.0.5 B14): chmod+unlink stale log file — but wraps unlink in
     `try/except OSError: pass`, silently succeeding even when unlink actually
     failed on a Serverless ACL-locked file.

  L2 (existing v1.0.6 B17): try/except PermissionError around FileHandler(mode='w'),
     falling back to `tempfile.mkdtemp(prefix="inspire_log_")`. Catches the crash
     but the operator log line ([B17-FALLBACK]) does not name the underlying
     stale-file root cause.

  L1.5 (NEW v1.0.7 B18): after the L1 unlink attempt, verify with
       `os.path.isfile(log_file_path)` that the file is actually gone. If it
       survived (the tautology from L1's silent-swallow), fall back to
       `tempfile.mkdtemp(prefix="inspire_fallback_")` immediately with a distinct
       [B18] marker. The operator sees the STALE-FILE cause instead of the
       downstream EACCES.

  L1.7 (NEW v1.0.7 B18): belt-and-suspenders probe open — try `open(log_file_path, 'w')`
       BEFORE FileHandler runs. Narrow catch (`PermissionError` only) preserves
       IsADirectoryError propagation (v1.0.5 B14 test_C invariant). On EACCES,
       fall back the same way with the same [B18] marker.

The two new layers are additive: on a healthy run neither fires; on the tautology
case the operator sees the real cause; on a fresh non-stale EACCES case the
L2 fallback (v1.0.6 B17) still catches the crash as before.

Customer evidence: <internal-cli-profile> job 1234567890000026 attempt 1 reproducer
(Bakehouse, sid=1234567890000000025) — v1.0.5 crash was EACCES on stale-file
retry; v1.0.6 B17 fallback catches it; B18 detects it ONE layer earlier and
names the root cause in the log.
"""
import logging
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import agent_source, load_agent_namespace


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


@pytest.fixture
def _restore_root_logger():
    """setup_logging clears + rebinds the root logger; restore state after each test."""
    root = logging.getLogger()
    saved_handlers = list(root.handlers)
    saved_level = root.level
    yield
    for h in list(root.handlers):
        try:
            h.close()
        except Exception:
            pass
        root.removeHandler(h)
    for h in saved_handlers:
        root.addHandler(h)
    root.setLevel(saved_level)


def test_A_happy_path_no_stale_file_no_fallback(ns, tmp_path, _restore_root_logger, capsys):
    """§8.3 tautology probe: happy path (no stale file, writable dir) MUST NOT fire the
    B18 fallback. If it did, every healthy run would silently redirect its log to
    /tmp/inspire_fallback_* and the volume log streamer would tail the wrong file.
    """
    output_dir = str(tmp_path)
    returned = ns["setup_logging"](output_dir)
    assert returned == output_dir, (
        f"B18: happy path must return the input dir unchanged, "
        f"got {returned!r} != {output_dir!r}"
    )
    assert os.path.isfile(os.path.join(output_dir, "log.txt"))
    stdout = capsys.readouterr().out
    assert "[B18]" not in stdout, (
        "B18: happy path MUST NOT emit [B18] marker — that would mean the "
        "fallback branch fires on healthy runs (tautology)"
    )


def test_B_stale_file_unlink_succeeds_no_fallback(ns, tmp_path, _restore_root_logger, capsys):
    """v1.0.5 B14 baseline: stale file with restrictive perms, unlink can clear it.
    B18 must NOT fire — the L1 heal is enough.
    """
    output_dir = str(tmp_path)
    log_file_path = os.path.join(output_dir, "log.txt")
    with open(log_file_path, "w") as f:
        f.write("stale content\n")
    os.chmod(log_file_path, 0o400)

    returned = ns["setup_logging"](output_dir)
    assert returned == output_dir, (
        "B18: when L1 unlink succeeds, B18 fallback must NOT fire "
        "(preserves v1.0.5 B14 behavior)"
    )
    stdout = capsys.readouterr().out
    assert "[B18]" not in stdout


def test_C_unlink_silently_swallowed_triggers_B18_verify_fallback(ns, tmp_path, _restore_root_logger, monkeypatch, capsys):
    """B18 primary reproducer for the customer's <internal-cli-profile> attempt 1 scenario:
    unlink SILENTLY fails (raises OSError, swallowed by v1.0.5 B14 tautology)
    — verify branch MUST detect that the file is still present and fall back
    to a fresh tempfile.mkdtemp dir with a distinct [B18] log line.

    Simulates Serverless ACL: the file is present, chmod+unlink appear to run
    without exception BUT the file survives (because Linux ACLs can permit
    the unlink call to raise silently, which POSIX-only heuristics don't handle).
    """
    output_dir = str(tmp_path / "acl_locked")
    os.makedirs(output_dir, exist_ok=True)
    log_file_path = os.path.join(output_dir, "log.txt")
    with open(log_file_path, "w") as f:
        f.write("acl-locked stale content\n")

    real_unlink = os.unlink

    def _unlink_noop_that_fails_silently(path, *args, **kwargs):
        # Simulate a Serverless-ACL unlink: raises OSError, caught by B14, file survives.
        if path == log_file_path:
            raise OSError(13, "Permission denied (simulated ACL)", path)
        return real_unlink(path, *args, **kwargs)

    monkeypatch.setattr(os, "unlink", _unlink_noop_that_fails_silently)

    returned = ns["setup_logging"](output_dir)

    assert returned != output_dir, (
        f"B18: when unlink silently fails and stale file survives, setup_logging "
        f"MUST return a DIFFERENT dir (mkdtemp fallback). "
        f"Got returned={returned!r} == input={output_dir!r} (fallback did not fire)"
    )
    assert "inspire_fallback_" in returned, (
        f"B18: fallback dir must use prefix 'inspire_fallback_' for greppability; "
        f"got {returned!r}"
    )
    assert os.path.isfile(os.path.join(returned, "log.txt")), (
        f"B18: fallback log.txt must exist at returned dir {returned!r}"
    )
    stdout = capsys.readouterr().out
    assert "[B18]" in stdout, (
        "B18: verify-and-fallback branch must print a [B18] observability line "
        "naming the stale-file root cause"
    )
    assert "could not be removed" in stdout, (
        "B18: [B18] line must name the stale-file cause explicitly (not just EACCES downstream)"
    )


def test_D_probe_permission_error_triggers_B18_probe_fallback(ns, tmp_path, _restore_root_logger, monkeypatch, capsys):
    """B18 secondary layer: even when no stale file exists, if the probe open('w')
    raises PermissionError (e.g. Serverless UI /tmp restriction on a fresh path),
    B18 must fall back to tempfile.mkdtemp BEFORE the existing v1.0.6 B17
    try/except-around-FileHandler runs.

    Simulate by monkeypatching builtin open to raise PermissionError ONCE (for the
    probe on the primary log path), then succeed for the fallback path.
    """
    output_dir = str(tmp_path / "restricted_fresh")
    os.makedirs(output_dir, exist_ok=True)
    primary_log_path = os.path.join(output_dir, "log.txt")

    import builtins
    real_open = builtins.open
    call_state = {"probe_denied_once": False}

    def _open_side_effect(path, *args, **kwargs):
        if path == primary_log_path and not call_state["probe_denied_once"]:
            call_state["probe_denied_once"] = True
            raise PermissionError(13, "Permission denied (simulated Serverless probe)", path)
        return real_open(path, *args, **kwargs)

    monkeypatch.setattr(builtins, "open", _open_side_effect)

    returned = ns["setup_logging"](output_dir)

    assert returned != output_dir, (
        f"B18: probe PermissionError MUST trigger fallback (different dir returned); "
        f"got {returned!r} == {output_dir!r}"
    )
    assert "inspire_fallback_" in returned, (
        f"B18: probe-fallback dir must use prefix 'inspire_fallback_'; got {returned!r}"
    )
    assert os.path.isfile(os.path.join(returned, "log.txt"))
    stdout = capsys.readouterr().out
    assert "[B18]" in stdout, (
        "B18: probe-fallback branch must print a [B18] observability line"
    )
    assert "Cannot write log" in stdout, (
        "B18: probe-fallback [B18] line must name the write-permission root cause"
    )


def test_E_isadirectoryerror_still_propagates(ns, tmp_path, _restore_root_logger):
    """§8.3 anti-tautology + v1.0.5 B14 test_C invariant preservation:
    a directory sitting where log.txt should be a file is a PROGRAMMER BUG.
    IsADirectoryError is a subclass of OSError but NOT of PermissionError.
    B18's probe catch (`except PermissionError`) MUST let it propagate.
    """
    output_dir = str(tmp_path)
    log_dir_path = os.path.join(output_dir, "log.txt")
    os.makedirs(log_dir_path)

    with pytest.raises((IsADirectoryError, OSError, PermissionError)) as excinfo:
        ns["setup_logging"](output_dir)
    # Confirm it is NOT a PermissionError (B18 must not swallow the programmer bug)
    assert not isinstance(excinfo.value, PermissionError), (
        "B18: IsADirectoryError MUST propagate (programmer bug), NOT be silently "
        "diverted to mkdtemp fallback"
    )


def test_F_verify_and_probe_paths_differ_from_input(ns, tmp_path, _restore_root_logger, monkeypatch):
    """§8.3 stronger anti-tautology: when B18 fires, the RETURNED dir must be
    OBSERVABLY DIFFERENT from the input dir. This catches a regression where the
    branch fires but forgets to rebind output_dir before returning it.
    """
    output_dir = str(tmp_path / "will_fallback")
    os.makedirs(output_dir, exist_ok=True)
    log_file_path = os.path.join(output_dir, "log.txt")
    with open(log_file_path, "w") as f:
        f.write("stale\n")

    real_unlink = os.unlink

    def _unlink_fails(path, *args, **kwargs):
        if path == log_file_path:
            raise OSError(13, "denied", path)
        return real_unlink(path, *args, **kwargs)

    monkeypatch.setattr(os, "unlink", _unlink_fails)

    returned = ns["setup_logging"](output_dir)

    assert returned != output_dir, (
        f"B18 §8.3: fallback path MUST be different from input path — "
        f"the two branches (fallback fired vs. fallback did not fire) MUST be "
        f"observably distinct. Got returned={returned!r} == input={output_dir!r}"
    )
    # Also the returned dir must actually be writable — the whole point of the fallback.
    with open(os.path.join(returned, "log.txt"), "a") as f:
        f.write("post-init writable\n")


def test_G_source_contains_B18_marker():
    """§8.7 runner's test: `[B18]` marker MUST appear inside setup_logging body."""
    src = agent_source()
    idx_fn = src.find("def setup_logging(output_dir):")
    assert idx_fn != -1
    idx_end = src.find("def ", idx_fn + 1)
    body = src[idx_fn:idx_end]
    assert "[B18]" in body, (
        "v1.0.7 B18 fix marker `[B18]` MUST appear inside setup_logging body "
        "(grep-verifiable for runner's-test at deploy time)"
    )
    assert "inspire_fallback_" in body, (
        "B18: mkdtemp prefix `inspire_fallback_` MUST appear inside setup_logging "
        "body — distinguishes B18 fallback dirs from v1.0.6 B17's `inspire_log_` prefix"
    )


def test_H_source_verify_branch_uses_isfile(ns):
    """§8.4 anti-dead-code + §8.3 anti-tautology: the B18 verify branch MUST call
    `os.path.isfile(log_file_path)` AFTER `os.unlink(log_file_path)` inside the
    stale-file block. Without this, the unlink-swallow tautology from v1.0.5 B14
    goes undetected.
    """
    src = agent_source()
    idx_fn = src.find("def setup_logging(output_dir):")
    idx_end = src.find("def ", idx_fn + 1)
    body = src[idx_fn:idx_end]
    # Confirm the flow: try unlink, then isfile check, then fallback
    idx_unlink = body.find("os.unlink(log_file_path)")
    assert idx_unlink != -1, "os.unlink call missing"
    # A second isfile check should exist AFTER the unlink (the B18 verify probe)
    idx_isfile_after = body.find("os.path.isfile(log_file_path)", idx_unlink)
    assert idx_isfile_after != -1, (
        "B18: setup_logging MUST call `os.path.isfile(log_file_path)` AFTER "
        "`os.unlink(log_file_path)` to verify the unlink actually succeeded — "
        "otherwise the v1.0.5 B14 tautology (unlink swallowed silently) goes undetected"
    )
