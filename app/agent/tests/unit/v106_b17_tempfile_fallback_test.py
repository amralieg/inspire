"""v1.0.6 B17 — setup_logging falls back to tempfile.mkdtemp() when primary /tmp write is denied.

Customer reproducer on v1.0.5 (Bakehouse, session_id='1234567890000000025',
FRESH session — B14's stale-file heal was a no-op):

    Main execution failed: [Errno 13] Permission denied: '/tmp/bakehouse_1234567890000000025/log.txt'

Root cause: Databricks Serverless UI standard-access-mode restricts file
creation directly under /tmp/ even when os.makedirs succeeds. B14's chmod +
unlink assumed the crash was stale-file collision; the customer's session
was fresh, so B14 was a no-op and FileHandler(mode='w') still crashed.

v1.0.6 B17 fix: wrap FileHandler creation in try/except PermissionError.
On EACCES, fall back to tempfile.mkdtemp() which uses mkstemp+O_EXCL
underneath to request proper perms via the kernel — this works on
Serverless UI restricted /tmp. Return the actual path used so the caller
can propagate it to self.local_log_output_dir (the volume log streamer
at ~line 17486 reads from that field).

Narrower catch (PermissionError, not OSError): non-perm failures like
IsADirectoryError (programmer bug — a dir sits where the file should be)
must still surface loudly. This preserves the pre-existing v1.0.5
test_C invariant.
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


def test_A_primary_path_succeeds_returns_same_dir(ns, tmp_path, _restore_root_logger):
    """Happy path: primary /tmp path works → setup_logging returns the input dir unchanged.

    Guards §8.3 against a regression where the fallback branch fires even on
    healthy paths (the returned dir would then differ from the input dir,
    silently redirecting the volume log streamer).
    """
    output_dir = str(tmp_path)
    returned = ns["setup_logging"](output_dir)
    assert returned == output_dir, (
        f"B17: primary path must return the input dir unchanged, "
        f"got returned={returned!r} input={output_dir!r}"
    )
    assert os.path.isfile(os.path.join(output_dir, "log.txt")), (
        "log.txt must exist at the primary path"
    )


def test_B_permission_error_triggers_mkdtemp_fallback(ns, tmp_path, _restore_root_logger, monkeypatch, capsys):
    """B17 primary reproducer: primary FileHandler open raises PermissionError
    → fallback dir via mkdtemp; setup_logging RETURNS the fallback dir.

    Simulates Databricks Serverless UI standard-access-mode: makedirs succeeds
    but the subsequent open('w') raises EACCES. We monkeypatch logging.FileHandler
    to raise on the first call (primary attempt) and succeed on the second
    (fallback attempt on mkdtemp path).
    """
    output_dir = str(tmp_path / "restricted_tmp")
    os.makedirs(output_dir, exist_ok=True)

    real_filehandler = logging.FileHandler
    call_state = {"count": 0}

    def _fh_side_effect(path, *args, **kwargs):
        call_state["count"] += 1
        if call_state["count"] == 1:
            raise PermissionError(13, "Permission denied (simulated)", path)
        return real_filehandler(path, *args, **kwargs)

    monkeypatch.setattr(logging, "FileHandler", _fh_side_effect)

    returned = ns["setup_logging"](output_dir)

    assert call_state["count"] >= 2, (
        f"B17: expected FileHandler to be called at least twice "
        f"(primary + fallback); called {call_state['count']} times"
    )
    assert returned != output_dir, (
        f"B17: on fallback, returned dir MUST differ from input dir "
        f"(volume log streamer reads it); got {returned!r} == {output_dir!r}"
    )
    assert os.path.isfile(os.path.join(returned, "log.txt")), (
        f"B17: fallback log.txt must exist at returned dir {returned!r}"
    )
    assert "inspire_log_" in returned, (
        f"B17: fallback path must be created by tempfile.mkdtemp("
        f"prefix='inspire_log_'), got {returned!r}"
    )
    stdout = capsys.readouterr().out
    assert "[B17-FALLBACK]" in stdout, (
        "B17: fallback branch must print a [B17-FALLBACK] observability line"
    )


def test_C_both_paths_fail_returns_console_only(ns, tmp_path, _restore_root_logger, monkeypatch, capsys):
    """§9 ultimate fallback: primary AND mkdtemp fail → setup_logging still
    completes (no exception), console-only logging. The returned dir may
    still be the input dir; callers store it and the volume streamer sees
    the missing log file and silently skips (existing behaviour tolerates
    missing files).
    """
    output_dir = str(tmp_path / "doubly_restricted")
    os.makedirs(output_dir, exist_ok=True)

    # Save the real class BEFORE patching — needed for isinstance() at assertion time.
    real_filehandler_cls = logging.FileHandler

    def _fh_always_denied(path, *args, **kwargs):
        raise PermissionError(13, "Permission denied (simulated)", path)

    def _mkdtemp_denied(*args, **kwargs):
        raise PermissionError(13, "mkdtemp denied (simulated)")

    monkeypatch.setattr(logging, "FileHandler", _fh_always_denied)
    import tempfile
    monkeypatch.setattr(tempfile, "mkdtemp", _mkdtemp_denied)

    returned = ns["setup_logging"](output_dir)
    assert returned is not None, "setup_logging must not return None on full failure"
    stdout = capsys.readouterr().out
    assert "[B17-FALLBACK-CONSOLE-ONLY]" in stdout, (
        "B17: ultimate-fallback branch must print a [B17-FALLBACK-CONSOLE-ONLY] line"
    )
    root = logging.getLogger()
    file_handlers = [h for h in root.handlers if isinstance(h, real_filehandler_cls)]
    assert len(file_handlers) == 0, (
        f"B17: on ultimate fallback, no FileHandler must be attached; "
        f"found {len(file_handlers)}"
    )


def test_D_non_permission_error_still_propagates(ns, tmp_path, _restore_root_logger, monkeypatch):
    """§8.3 anti-tautology: catch is PermissionError-only, NOT bare OSError.

    A directory sitting where log.txt should be a file raises IsADirectoryError
    (a subclass of OSError but NOT of PermissionError). This is a programmer bug
    that must surface loudly; B17 must NOT silently fallback in that case.

    Preserves the pre-existing v1.0.5 B14 test_C invariant.
    """
    output_dir = str(tmp_path)
    log_dir_path = os.path.join(output_dir, "log.txt")
    os.makedirs(log_dir_path)  # a directory where log.txt should be a file

    with pytest.raises((IsADirectoryError, OSError)) as excinfo:
        ns["setup_logging"](output_dir)
    assert not isinstance(excinfo.value, PermissionError), (
        "B17 must NOT catch IsADirectoryError — it is a programmer bug that "
        "must surface loudly"
    )


def test_E_source_contains_B17_marker():
    """§8.7 runner's test: `B17` marker must appear inside setup_logging."""
    src = agent_source()
    idx_fn = src.find("def setup_logging(output_dir):")
    assert idx_fn != -1
    idx_end = src.find("def ", idx_fn + 1)
    body = src[idx_fn:idx_end]
    assert "B17" in body, (
        "v1.0.6 B17 fix marker `B17` must appear inside setup_logging body"
    )


def test_F_source_contains_tempfile_mkdtemp():
    """§8.7 runner's test: setup_logging must call tempfile.mkdtemp on fallback."""
    src = agent_source()
    idx_fn = src.find("def setup_logging(output_dir):")
    idx_end = src.find("def ", idx_fn + 1)
    body = src[idx_fn:idx_end]
    assert "mkdtemp(" in body, (
        "B17: setup_logging must call tempfile.mkdtemp() on primary failure"
    )
    assert "inspire_log_" in body, (
        "B17: mkdtemp prefix must be 'inspire_log_' for grepability"
    )


def test_G_source_returns_output_dir():
    """§8.4 dead-code-check: setup_logging must `return output_dir` — otherwise
    the caller can't capture the fallback dir and downstream code (volume
    streamer) tails the WRONG file, silently losing the live log."""
    src = agent_source()
    idx_fn = src.find("def setup_logging(output_dir):")
    idx_end = src.find("def ", idx_fn + 1)
    body = src[idx_fn:idx_end]
    assert "return output_dir" in body, (
        "B17: setup_logging must `return output_dir` so the caller can "
        "propagate a mkdtemp fallback dir to self.local_log_output_dir"
    )


def test_H_caller_captures_returned_path():
    """§8.4 anti-dead-code: the caller (AtomicWriter/DatabricksInspire __init__)
    must assign the return value to self.local_log_output_dir. Without this,
    the volume log streamer reads from the ORIGINAL /tmp path (which failed
    to write) and silently sees no log file.
    """
    src = agent_source()
    assert "self.local_log_output_dir = setup_logging(self.local_log_output_dir)" in src, (
        "B17: caller must assign setup_logging(...) return to "
        "self.local_log_output_dir — otherwise fallback path is lost"
    )


def test_I_catch_is_narrower_than_OSError():
    """§8.3 anti-tautology probe: the primary catch MUST be PermissionError,
    NOT bare OSError. Catching OSError would swallow IsADirectoryError,
    NotADirectoryError, ENOSPC, etc. — masking bugs that should crash loudly.
    """
    src = agent_source()
    idx_fn = src.find("def setup_logging(output_dir):")
    idx_end = src.find("def ", idx_fn + 1)
    body = src[idx_fn:idx_end]
    idx_primary_try = body.find("file_handler = logging.FileHandler(log_file_path, mode='w')")
    assert idx_primary_try != -1, "primary FileHandler open missing"
    # scan the ~200 chars following the primary open for the except clause
    following = body[idx_primary_try:idx_primary_try + 400]
    assert "except PermissionError" in following, (
        "B17: primary FileHandler must be wrapped in `except PermissionError` "
        "(not bare OSError) so non-perm errors surface loudly"
    )
    assert "except (PermissionError, OSError)" not in following, (
        "B17: primary catch MUST NOT include OSError — that would swallow "
        "IsADirectoryError etc."
    )


def test_J_console_only_branch_still_returns_path(ns, tmp_path, _restore_root_logger, monkeypatch):
    """When ultimate-fallback fires (both paths fail), setup_logging must still
    return a string path (typically the input dir). Downstream code stores it
    unconditionally; a `None` return would blow up
    `os.path.join(self.local_log_output_dir, ...)` in the streamer.
    """
    output_dir = str(tmp_path / "unwritable")
    os.makedirs(output_dir, exist_ok=True)

    def _fh_denied(path, *args, **kwargs):
        raise PermissionError(13, "denied", path)

    def _mkdtemp_denied(*args, **kwargs):
        raise PermissionError(13, "mkdtemp denied")

    monkeypatch.setattr(logging, "FileHandler", _fh_denied)
    import tempfile
    monkeypatch.setattr(tempfile, "mkdtemp", _mkdtemp_denied)

    returned = ns["setup_logging"](output_dir)
    assert isinstance(returned, str) and returned, (
        f"B17: setup_logging must always return a non-empty string path, "
        f"got {returned!r}"
    )
