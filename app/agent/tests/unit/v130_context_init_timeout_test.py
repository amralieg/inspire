"""v1.3.0 context initialization: a slow first endpoint must not end the run. The business context wait outlasts the model
cascade, a context that never arrives becomes an empty context, and a generation-instruction timeout stays an error."""
import concurrent.futures
import os
import re
import sys
import threading

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v120_genie_support import build_inspire


def _future(value=None, done=True):
    future = concurrent.futures.Future()
    if done:
        future.set_result(value)
    return future


def test_both_results_come_back_when_both_calls_finish(agent_ns):
    inst = build_inspire(agent_ns)
    context, instructions = inst._await_context_init(_future({"industries": "retail"}), _future({"table_joins": []}), timeout_s=1)
    assert context == {"industries": "retail"} and instructions == {"table_joins": []}


def test_a_business_context_that_never_arrives_becomes_an_empty_context(agent_ns):
    inst = build_inspire(agent_ns)
    stuck = _future(done=False)
    context, instructions = inst._await_context_init(stuck, _future({"table_joins": []}), timeout_s=0.3)
    assert context == {} and instructions == {"table_joins": []}, "an empty context is the documented degradation"
    assert stuck.cancelled()
    errors = [str(c) for c in inst.logger.error.call_args_list]
    assert any("[CONTEXT-INIT-TIMEOUT FIRED]" in e and "continuing with an empty LLM business context" in e for e in errors)


def test_a_generation_instruction_timeout_is_never_swallowed(agent_ns):
    inst = build_inspire(agent_ns)
    with pytest.raises(concurrent.futures.TimeoutError):
        inst._await_context_init(_future({}), _future(done=False), timeout_s=0.3)


def test_the_wait_outlasts_a_model_cascade_and_the_call_site_uses_it(agent_ns):
    cls = agent_ns["DatabricksInspire"]
    assert cls.CONTEXT_INIT_TIMEOUT_S >= 1200, "a 300 s wait cancelled the cascade before its second model (U18)"
    import json
    notebook = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "agent", "dbx_inspire_ai_agent.ipynb")
    source = "".join("".join(cell["source"]) for cell in json.load(open(notebook))["cells"] if cell["cell_type"] == "code")
    assert "self._await_context_init(_ctx_future, _instr_future)" in source
    assert not re.search(r"_safe_future_result\(_ctx_future, timeout=300\)", source)
    assert not re.search(r"_safe_future_result\(_instr_future, timeout=120\)", source)


def test_a_slow_context_call_that_finishes_inside_the_wait_is_kept(agent_ns):
    inst = build_inspire(agent_ns)
    pending = _future(done=False)
    threading.Timer(0.3, lambda: pending.set_result({"industries": "late"})).start()
    context, _ = inst._await_context_init(pending, _future({}), timeout_s=5)
    assert context == {"industries": "late"}, "the fallback model's answer is used, never cancelled"
