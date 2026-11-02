"""v1.0.5 B14 — setup_logging defensively removes a stale log.txt before opening FileHandler(mode='w').

Prior v1.0.4 customer crash on <internal-cli-profile> (TPCDH, job 123456789000021, run
123456789000022):

  Main execution failed: [Errno 13] Permission denied: '/tmp/tpcdh_1234567890000000023/log.txt'

Root cause: `setup_logging` (agent/dbx_inspire_ai_agent.ipynb:4795) opens
`logging.FileHandler(log_file_path, mode='w')` immediately after
`os.makedirs`. When a warm-reused Serverless container has a stale file
at that path from a prior partial init with the SAME user-supplied
session_id (customer widget `14_session_id='1234567890000000023'`),
Python's `open(path, 'w')` raises EACCES on the O_TRUNC.

Our 6-env v1.0.3/v1.0.4 verify swarm did NOT reproduce because each
swarm run used a fresh auto-generated session_id — no path collision
was structurally possible. The customer iterated with a fixed sid.

v1.0.5 root-cause fix (agent/dbx_inspire_ai_agent.ipynb:4798-4810):
between `os.makedirs` and `FileHandler(mode='w')`, defensively
`chmod 0o644` + `os.unlink` any pre-existing regular file at the
target log path, plus `chmod 0o755` the parent dir. Uses
`os.path.isfile` (not `os.path.exists`) so a directory at the log
path is NOT silently unlinked — FileHandler surfaces IsADirectoryError.

Tests exercise `setup_logging` on real filesystem paths under
pytest's `tmp_path`, then restore the root-logger state (setup_logging
is destructive to the global root logger).
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
    """setup_logging clears + rebinds the root logger; restore after each test."""
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


def test_A_stale_file_with_restrictive_perms_is_healed(ns, tmp_path, _restore_root_logger):
    """B14 primary reproducer: a stale log.txt with 0o400 perms MUST NOT block setup_logging.

    Simulates the customer scenario: warm-reused Serverless container, prior partial
    init left `/tmp/{customer}_{sid}/log.txt` with restrictive perms. Without the
    fix, `FileHandler(mode='w')` raises EACCES here. With the fix, setup_logging
    unlinks the stale file and creates a fresh writable one.
    """
    output_dir = str(tmp_path)
    log_file_path = os.path.join(output_dir, "log.txt")

    with open(log_file_path, "w") as f:
        f.write("stale content from prior partial init\n")
    os.chmod(log_file_path, 0o400)

    try:
        ns["setup_logging"](output_dir)
    except PermissionError as e:
        pytest.fail(
            f"v1.0.5 B14: setup_logging must heal stale restrictive-perm log file, "
            f"but raised PermissionError: {e!r}"
        )

    assert os.path.isfile(log_file_path), "log.txt must exist after setup_logging"
    st = os.stat(log_file_path)
    assert (st.st_mode & 0o200) != 0, (
        f"log.txt must be writable after setup_logging, got mode={oct(st.st_mode)}"
    )
    with open(log_file_path, "a") as f:
        f.write("post-init writable check\n")


def test_B_no_stale_file_happy_path(ns, tmp_path, _restore_root_logger):
    """§8.3 tautology probe: with NO stale file, setup_logging must still succeed.

    Guards against a regression where the defensive branch breaks the common case.
    """
    output_dir = str(tmp_path)
    log_file_path = os.path.join(output_dir, "log.txt")

    assert not os.path.exists(log_file_path), "precondition: no stale file"

    ns["setup_logging"](output_dir)

    assert os.path.isfile(log_file_path), "log.txt must be created on happy path"
    st = os.stat(log_file_path)
    assert (st.st_mode & 0o200) != 0, (
        f"log.txt must be writable, got mode={oct(st.st_mode)}"
    )


def test_C_directory_at_log_path_raises_clear_error(ns, tmp_path, _restore_root_logger):
    """§9 negative: if a directory sits where log.txt should be a file, setup_logging
    MUST raise a clear error rather than silently unlinking or swallowing it.

    The fix guards this with `os.path.isfile` (not `os.path.exists`) — a directory
    at the log path fails `isfile`, we skip the unlink branch, and FileHandler
    raises IsADirectoryError (subclass of OSError) unchanged.
    """
    output_dir = str(tmp_path)
    log_dir_path = os.path.join(output_dir, "log.txt")
    os.makedirs(log_dir_path)

    with pytest.raises((IsADirectoryError, OSError, PermissionError)):
        ns["setup_logging"](output_dir)


def test_D_stale_file_with_zero_perms_is_healed(ns, tmp_path, _restore_root_logger):
    """Harder probe: 0o000 (no perms at all) — chmod-then-unlink must still succeed.

    Covers the pathological case where a prior process left the file with fully
    restrictive perms. On Linux the file owner can always chmod their own file,
    so the fix's chmod-first pattern works.
    """
    output_dir = str(tmp_path)
    log_file_path = os.path.join(output_dir, "log.txt")

    with open(log_file_path, "w") as f:
        f.write("stale zero-perm content\n")
    os.chmod(log_file_path, 0o000)

    try:
        ns["setup_logging"](output_dir)
    except PermissionError as e:
        pytest.fail(
            f"v1.0.5 B14: setup_logging must heal 0o000-perm stale log file, "
            f"raised: {e!r}"
        )

    assert os.path.isfile(log_file_path)


def test_E_source_contains_B14_grep_marker():
    """§8.7 runner's test: the deployed notebook must contain the `B14:` marker in setup_logging."""
    src = agent_source()
    idx_fn = src.find("def setup_logging(output_dir):")
    assert idx_fn != -1, "setup_logging function missing from agent source"
    idx_end = src.find("def ", idx_fn + 1)
    body = src[idx_fn:idx_end]

    assert "B14:" in body, (
        f"v1.0.5 B14 fix marker `B14:` must appear inside setup_logging body"
    )


def test_F_source_contains_unlink_call():
    """§8.7 runner's test: setup_logging must call os.unlink on the log path."""
    src = agent_source()
    idx_fn = src.find("def setup_logging(output_dir):")
    idx_end = src.find("def ", idx_fn + 1)
    body = src[idx_fn:idx_end]

    assert "os.unlink(log_file_path)" in body, (
        "v1.0.5 B14: setup_logging must os.unlink(log_file_path) before FileHandler open"
    )


def test_G_source_contains_isfile_guard():
    """§8.7 runner's test: unlink must be gated by os.path.isfile (not os.path.exists),
    so a directory at the log path is NOT silently unlinked."""
    src = agent_source()
    idx_fn = src.find("def setup_logging(output_dir):")
    idx_end = src.find("def ", idx_fn + 1)
    body = src[idx_fn:idx_end]

    assert "os.path.isfile(log_file_path)" in body, (
        "v1.0.5 B14: unlink must be gated by os.path.isfile(log_file_path) "
        "so a directory at the log path surfaces IsADirectoryError from FileHandler"
    )


def test_H_source_still_creates_output_dir():
    """Regression guard: pre-existing `os.makedirs` must remain — the fix is
    additive, not replacing existing behaviour."""
    src = agent_source()
    idx_fn = src.find("def setup_logging(output_dir):")
    idx_end = src.find("def ", idx_fn + 1)
    body = src[idx_fn:idx_end]

    assert "os.makedirs(output_dir, exist_ok=True)" in body, (
        "pre-existing makedirs must remain in setup_logging"
    )


def test_I_source_still_opens_filehandler_write_mode():
    """Regression guard: FileHandler mode='w' must remain (fresh log per run).
    The fix makes the truncation reliable; it does NOT change the file open mode."""
    src = agent_source()
    idx_fn = src.find("def setup_logging(output_dir):")
    idx_end = src.find("def ", idx_fn + 1)
    body = src[idx_fn:idx_end]

    assert "logging.FileHandler(log_file_path, mode='w')" in body, (
        "FileHandler(mode='w') must remain — fresh log per run"
    )


def test_J_agent_version_is_v105_or_greater():
    """v1.0.5 must have bumped __AGENT_VERSION__ per §3a single-digit semver."""
    import re
    src = agent_source()
    m = re.search(r'__AGENT_VERSION__\s*=\s*["\'](v(\d+)\.(\d+)\.(\d+))["\']', src)
    assert m is not None, "no __AGENT_VERSION__ found in agent source"
    parts = tuple(int(m.group(i)) for i in (2, 3, 4))
    assert parts >= (1, 0, 5), f"version must be >= v1.0.5, got {m.group(1)}"


def test_K_all_segments_are_single_digit():
    """§3a hard rule: every semver segment must be a single digit 0-9."""
    import re
    src = agent_source()
    m = re.search(r'__AGENT_VERSION__\s*=\s*["\'](v(\d+)\.(\d+)\.(\d+))["\']', src)
    assert m is not None
    for i in (2, 3, 4):
        seg = int(m.group(i))
        assert 0 <= seg <= 9, (
            f"§3a violation: version segment {seg} is not a single digit (in {m.group(1)})"
        )
