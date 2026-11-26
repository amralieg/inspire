"""REQ-542 / REQ-540: the App's page payload carries the agent's focus_spec, so the One-by-One wizard can render it."""
import importlib
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "agent", "app_shell", "server"))
shell_core = importlib.import_module("shell_core")

SPEC = {"version": 1, "technique_kind": "driver_breakdown", "steps": [{"id": "s1", "kind": "decide"}], "queue": {"order": {"column": "rank"}}}


def page(**extra):
    return dict({"id": "p1", "use_case_id": "U1", "title": "T", "question": "Q"}, **extra)


def test_public_page_passes_the_focus_spec_through():
    out = shell_core.public_page(page(focus_spec=SPEC, focus_spec_source="designed", focus_spec_reason=""))
    assert out["focus_spec"] == SPEC


def test_public_page_has_no_focus_spec_when_the_agent_wrote_none():
    assert shell_core.public_page(page())["focus_spec"] is None
    assert shell_core.public_page(page(focus_spec="not a dict"))["focus_spec"] is None


def test_public_page_keeps_the_agent_bookkeeping_private():
    out = shell_core.public_page(page(focus_spec=SPEC, focus_spec_source="default", focus_spec_reason="judge scored 3"))
    assert "focus_spec_source" not in out and "focus_spec_reason" not in out
