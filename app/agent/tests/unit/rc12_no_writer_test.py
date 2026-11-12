import pytest

from v120_artifacts_support import make_inspire


def test_the_implement_lock_runs_its_body_with_no_writer_and_no_lock_warning(agent_ns):
    obj = make_inspire(agent_ns, inspire_database="c.s")
    assert obj.atomic_writer is None
    ran = []
    with obj._implement_wait_lock("key-1", "IMPLEMENT", "UC1", 1, "Implement", "wait {who}", "free", "busy {who}"):
        ran.append(True)
    assert ran == [True]
    assert [m for _level, m in obj.logger.records if "UNVERIFIED" in m or "RELEASE FAILED" in m] == []


def test_implement_mode_with_no_writer_reaches_its_own_error_not_an_attribute_error(agent_ns):
    obj = make_inspire(agent_ns, inspire_database="c.s")
    assert obj.atomic_writer is None
    obj._implement_targets = lambda: []
    obj._implement_requested_row = lambda: None
    with pytest.raises(RuntimeError, match="No queued use case MVP spec"):
        obj._run_implement_mode()
