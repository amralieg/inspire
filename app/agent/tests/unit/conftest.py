"""SEC-02 (REQ-518): the MVP App viewer gate (Shell.viewer_gate) now runs on every route, inside Inspire too, and an App with no `sources`
fails closed. These unit tests probe the handlers under the gate with settings and headers that name no sources or no token, so the gate
is off for them. The gate itself is tested by tests/test_sec01_at9_viewer_access.py and tests/test_sec02_*.py (outside this folder), which
build their own Shell and keep the real gate."""
import sys

import pytest


@pytest.fixture(autouse=True)
def viewer_gate_is_tested_elsewhere(monkeypatch):
    shell_core = sys.modules.get("shell_core")
    if shell_core is not None and hasattr(shell_core, "Shell"):
        monkeypatch.setattr(shell_core.Shell, "viewer_gate", lambda self, headers: None)
    yield
