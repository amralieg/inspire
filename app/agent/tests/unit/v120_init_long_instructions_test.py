"""v1.2.0 D1-03: DatabricksInspire.__init__ used self.logger before it existed when Generation
Instructions exceeded 2,000 characters, so every such run crashed at construction. The
truncation still happens; the warning is now logged once the logger is configured."""
import logging
import os
import shutil
import uuid

import pytest


@pytest.fixture
def restore_root_logger():
    root = logging.getLogger()
    saved = (list(root.handlers), root.level, list(root.filters))
    yield
    root.handlers[:] = saved[0]
    root.setLevel(saved[1])
    root.filters[:] = saved[2]


def _construct(ns, tmp_path, instructions):
    sid = str(uuid.uuid4().int % 10 ** 12)
    obj = ns["DatabricksInspire"](business=f"InitProbe{sid}", generation_instructions=instructions,
                                  generation_path=str(tmp_path / "out"), session_id=sid)
    return obj


def _cleanup(obj):
    try:
        obj.ai_agent.cleanup_llm_cache()
    except Exception:
        pass
    shutil.rmtree(obj.local_log_output_dir, ignore_errors=True)


def test_D103_long_generation_instructions_do_not_crash_init(fresh_ns, tmp_path, restore_root_logger):
    obj = _construct(fresh_ns, tmp_path, "y" * 2500)
    try:
        assert len(obj.user_generation_instructions) == 2000
        with open(os.path.join(obj.local_log_output_dir, "log.txt"), encoding="utf-8") as fh:
            log_text = fh.read()
        assert "Generation Instructions exceeds 2000 char limit (2500 chars)" in log_text
    finally:
        _cleanup(obj)


def test_D103_short_instructions_untouched_and_not_warned(fresh_ns, tmp_path, restore_root_logger):
    obj = _construct(fresh_ns, tmp_path, "  focus on churn  ")
    try:
        assert obj.user_generation_instructions == "focus on churn"
        with open(os.path.join(obj.local_log_output_dir, "log.txt"), encoding="utf-8") as fh:
            assert "exceeds 2000 char limit" not in fh.read()
    finally:
        _cleanup(obj)
