"""REQ-120 (rc14 L5): every Genie round of an Implement build logs its own minutes, and the round that finishes the
step carries them in its ended_success payload, so a slow build shows which round was slow."""
from unittest.mock import MagicMock

import pytest

from v140_implement_test import _FakeRunner, _flow_inspire


def test_each_genie_round_logs_its_minutes_and_the_finished_round_carries_them(agent_ns):
    inst = _flow_inspire(agent_ns, [])
    inst.logger = MagicMock()
    inst._implement_emit = MagicMock(return_value=None)
    runner = _FakeRunner([{"exit": 0}, {"exit": 0}])
    attempts = []

    def deploy(work):
        attempts.append(work)
        if len(attempts) == 1:
            raise RuntimeError("dataset decision_list failed: UNRESOLVED_COLUMN rank")
        return {"dashboard_id": "d1"}

    context = {"uc_id": "N01-U01", "key": (5150, "N01-U01", 1)}
    assert inst._implement_genie_loop(context, runner, "Dashboard", "write it", deploy) == {"dashboard_id": "d1"}

    round_lines = [c.args[0] for c in inst.logger.info.call_args_list if "[GENIE-ROUND]" in str(c.args[0])]
    assert len(round_lines) == 2, round_lines
    assert "N01-U01 Dashboard round 1 of up to" in round_lines[0] and " min, timed_out=False, exit=0" in round_lines[0]
    assert "round 2 of up to" in round_lines[1]

    finished = [c for c in inst._implement_emit.call_args_list if len(c.args) >= 5 and c.args[3] == "ended_success"]
    assert len(finished) == 1
    payload = finished[0].args[4]
    assert payload["round"] == 2 and isinstance(payload["round_minutes"], float) and payload["round_minutes"] >= 0
