"""v1.0.5 B15 — Launcher gate fires on interactive runs regardless of widget-persisted session_id.

Root cause: Databricks notebook widgets PERSIST their last-set value in
notebook state across kernel restarts. If a prior job-spec run set
`14_session_id`, subsequent INTERACTIVE runs inherit that value. The
prior launcher gate only fired when the widget was empty, so a
persisted-value interactive run bypassed the launcher, ran in-process,
and hit B14 (stale /tmp log file) or worse (wrong-SID artifacts
colliding with a prior run).

Fix design: launcher gate now detects interactive vs job context via
`dbutils.notebook.entry_point ... .jobId().isDefined()`. Two module-level
helpers:

  * `_detect_is_job_context()` — thin wrapper on the established
    notebook pattern (see e.g. line ~27873, 27963, 31934).
  * `_should_fire_launcher_gate(is_job_context, widget_session_id, child_marker=None)` —
    pure decision function tested here across all 4 truth combinations.

The gate skips the launcher ONLY for inner-job runs (job context AND
widget-provided SID). Every other case fires it.

Runtime paths (interactive `dbutils.notebook.entry_point`) can't be
mocked cleanly in pytest, so this suite exercises the pure decision
function and grep-verifies the notebook wires it up.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import agent_source, load_agent_namespace


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def test_A_interactive_with_persisted_sid_fires(ns):
    """B15 primary case (customer reproducer): interactive mode + persisted
    non-empty session_id from widget → launcher MUST fire (fresh SID, spawn
    inner job).

    This is the customer's crash scenario: they had `14_session_id` set from
    a prior job run, opened the notebook interactively, and the prior gate
    silently ran in-process.
    """
    fn = ns["_should_fire_launcher_gate"]
    assert fn(is_job_context=False, widget_session_id="1234567890000000023") is True, (
        "B15: interactive + persisted SID MUST fire launcher"
    )


def test_B_job_context_with_empty_sid_fires(ns):
    """Outer job with empty SID: launcher fires to spawn inner. This is the
    behaviour §9.0 documents for `databricks jobs submit` with `14_session_id`
    left empty."""
    fn = ns["_should_fire_launcher_gate"]
    assert fn(is_job_context=True, widget_session_id="") is True, (
        "B15: job-context + empty SID MUST fire launcher (outer→inner bootstrap)"
    )


def test_C_job_context_with_sid_skips(ns):
    """§8.3 exclusion probe: inner job (job context + widget-provided SID)
    MUST skip the launcher. This is the ONLY case where the gate does not
    fire — external caller has taken responsibility for SID uniqueness."""
    fn = ns["_should_fire_launcher_gate"]
    assert fn(is_job_context=True, widget_session_id="1234567890000000024") is False, (
        "B15: inner-job path (job context + widget SID) MUST skip launcher"
    )


def test_D_interactive_with_empty_sid_fires(ns):
    """Interactive with empty SID (first-time interactive run): launcher fires
    to spawn a fresh inner job. Existing behaviour before B15, preserved."""
    fn = ns["_should_fire_launcher_gate"]
    assert fn(is_job_context=False, widget_session_id="") is True, (
        "B15: interactive + empty SID MUST fire launcher (baseline)"
    )


def test_E_none_and_whitespace_widget_treated_as_empty(ns):
    """Robustness: widget_session_id=None or whitespace-only string must be
    treated as empty. `dbutils.widgets.get` occasionally returns None on
    error paths and the caller strips."""
    fn = ns["_should_fire_launcher_gate"]
    assert fn(is_job_context=True, widget_session_id=None) is True, (
        "None widget value must be treated as empty"
    )
    assert fn(is_job_context=True, widget_session_id="   ") is True, (
        "whitespace widget value must be treated as empty"
    )


def test_F_detect_helper_defensive_against_missing_dbutils(ns):
    """`_detect_is_job_context` MUST return False (not raise) when dbutils
    can't be reached — pytest offline harness stubs dbutils to raise on
    attribute access, and any live-runtime call that errors should NOT
    propagate."""
    fn = ns["_detect_is_job_context"]
    # NullDbutils in the offline harness raises AssertionError on attribute access;
    # _detect_is_job_context must swallow to False.
    got = fn()
    assert got is False, (
        f"_detect_is_job_context must return False when dbutils unavailable; got {got!r}"
    )


def test_G_source_contains_detect_helper():
    """§8.7 runner's test: notebook must define `_detect_is_job_context`
    at module level (findable for import + grep)."""
    src = agent_source()
    assert "def _detect_is_job_context()" in src, (
        "B15: module-level `_detect_is_job_context` helper missing"
    )


def test_H_source_contains_pure_decision_function():
    """§8.7 runner's test: notebook must define the pure decision function
    with an explicit two-argument signature."""
    src = agent_source()
    assert "def _should_fire_launcher_gate(is_job_context, widget_session_id, child_marker=None)" in src, (
        "B15: pure `_should_fire_launcher_gate(is_job_context, widget_session_id, child_marker=None)` missing"
    )


def test_I_gate_wires_the_helpers():
    """§8.4 anti-dead-code: the helpers are ACTUALLY called inside the launcher
    gate in `main()`, not just defined and unused."""
    src = agent_source()
    idx_main = src.find("def main():")
    assert idx_main != -1, "no def main() in agent source"
    idx_gate_end = src.find("End Job Launch Gate", idx_main)
    assert idx_gate_end != -1, "gate end marker missing"
    gate_body = src[idx_main:idx_gate_end]

    assert "_detect_is_job_context()" in gate_body, (
        "B15: `_detect_is_job_context()` MUST be called inside the launcher gate"
    )
    assert "_should_fire_launcher_gate(" in gate_body, (
        "B15: `_should_fire_launcher_gate(...)` MUST be called inside the launcher gate"
    )


def test_J_gate_no_longer_gated_only_by_empty_widget():
    """§8.3 tautology probe: the pre-B15 form `if not _raw_session_id_from_widget:`
    guarding the launcher-fire block MUST be gone — otherwise persisted-widget
    interactive runs still bypass the launcher (the customer's crash class).

    The gate is now `if _should_fire:` — grep proves it."""
    src = agent_source()
    idx_main = src.find("def main():")
    idx_gate_end = src.find("End Job Launch Gate", idx_main)
    gate_body = src[idx_main:idx_gate_end]

    assert "if _should_fire:" in gate_body, (
        "B15: gate must be `if _should_fire:` (post-B15)"
    )


def test_K_user_session_id_reads_gate_post_value_not_raw_widget():
    """Downstream defense: `user_session_id` (line ~32328) MUST read the
    post-gate value `_raw_session_id_from_widget` — otherwise, when the gate
    clears a persisted widget SID and the launcher-launch fails-back to
    in-process, downstream re-reads the persisted stale widget value and
    the whole B15 fix is bypassed."""
    src = agent_source()
    idx_main = src.find("def main():")
    idx_gate_end = src.find("End Job Launch Gate", idx_main)
    post_gate = src[idx_gate_end:]

    idx_uses = post_gate.find("user_session_id = ")
    assert idx_uses != -1, "user_session_id assignment missing after gate"
    line_end = post_gate.find("\n", idx_uses)
    line = post_gate[idx_uses:line_end]

    assert "_raw_session_id_from_widget" in line, (
        f"B15: `user_session_id` MUST read `_raw_session_id_from_widget` "
        f"(post-gate) — otherwise interactive-fallback re-inherits stale "
        f"widget value. Current line: {line!r}"
    )
