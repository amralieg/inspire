"""T1 and T2 runs showed "Inspire has completed best of best with caution" and "Completed with caution: deduplicate domain
guest experience warning 1793559897304 1" while the step was still running: every warning row, a retry, timeout or cascade
inside an LLM call or a worker its parent task cancelled, was told as the end of the whole step. Those rows now say the step
is retrying one part or that a slow part was stopped, and only a step that ends with a warning reads as completed with caution."""
import threading
import types

from _agentload import agent_source
from v120_artifacts_support import make_inspire


def _recording(agent_ns):
    obj = make_inspire(agent_ns)
    recorded = []
    obj.atomic_writer = types.SimpleNamespace(emit_step=lambda **kw: recorded.append(kw) or len(recorded))
    obj._prompt_progress_lock = threading.Lock()
    obj._prompt_entities_seen, obj._prompt_progress_emitted = {}, {}
    return obj, recorded


def test_a_worker_its_parent_cancelled_reads_as_stopped(agent_ns):
    obj, recorded = _recording(agent_ns)
    obj._emit_prompt_status("ULTRA_HIGH_ELITE_JUDGE_PROMPT", "BestOfBestJudge_R0B5", "ended_warning",
                            message="ULTRA_HIGH_ELITE_JUDGE_PROMPT cancelled by its parent task",
                            result_json={"step_name": "BestOfBestJudge_R0B5", "cancelled": True})
    [row] = recorded
    assert row["status"] == "ended_warning" and row["step_name"] == "Best of Best"
    assert row["message"] == "Inspire stopped a slow part of best of best and carried on without it"
    assert row["sub_step_name"].startswith("Stopped: ") and "caution" not in row["sub_step_name"].lower()


def test_a_retry_inside_a_call_reads_as_retrying_without_the_internal_step_id(agent_ns):
    obj, recorded = _recording(agent_ns)
    obj._emit_prompt_status("REVIEW_USE_CASES_PROMPT", "Deduplicate_Domain_Guest Experience__warning_1793559897304_1",
                            "ended_warning", message="REVIEW_USE_CASES_PROMPT timeout on claude-opus-5-5 after 300s",
                            result_json={"runtime_event": True, "model": "claude-opus-5-5"})
    [row] = recorded
    assert "with caution" not in row["message"] and row["message"].startswith("Inspire is still working on ")
    assert row["message"].endswith(" and is retrying one part")
    assert row["sub_step_name"] == "Retrying: deduplicate domain guest experience", row["sub_step_name"]


def test_a_step_that_ends_with_a_warning_still_reads_as_completed_with_caution(agent_ns):
    obj, recorded = _recording(agent_ns)
    obj._emit_prompt_status("ULTRA_HIGH_ELITE_JUDGE_PROMPT", "BestOfBestJudge_R0B1", "ended_warning",
                            message="ULTRA_HIGH_ELITE_JUDGE_PROMPT returned empty response", result_json={"step_name": "x"})
    assert recorded[0]["message"] == "Inspire has completed best of best with caution"


def test_the_llm_client_marks_its_warning_rows_and_cancelled_workers(agent_ns):
    cls = agent_ns["AIAgent"]
    agent = cls.__new__(cls)
    rows = []
    agent.status_emitter = lambda **kw: rows.append(kw)
    agent._status_lock, agent._warning_seq, agent._status_step_ids = threading.Lock(), 0, {}
    agent._emit_runtime_warning("REVIEW_USE_CASES_PROMPT", "Deduplicate_Domain_Sales", "timeout", payload={"model": "m"})
    [row] = rows
    assert row["status"] == "ended_warning" and row["result_json"]["runtime_event"] is True and row["result_json"]["model"] == "m"
    assert '"error": redact_error(e, max_chars=300), "cancelled": cancelled}' in agent_source()
