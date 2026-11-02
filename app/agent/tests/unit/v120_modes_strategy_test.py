"""v1.2.0 MODES lane: one coherent technical exclusion strategy (H-16 / H-20).

main() always passed "Aggressive" and __init__ rewrote "none" to "Aggressive", so the filter's
Medium / Low / None rule texts, its unknown-to-Medium fallback and its keep-technical-tables branch
could never run. They are removed: every layer resolves the strategy through
resolve_technical_exclusion_strategy(), which returns "Aggressive" and raises on anything else.
"""
import ast
import logging
import os
import shutil
import sys
import uuid

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import method_node  # noqa: E402
from v120_metadata_evidence_test import (FILTER_DETAILS, classifier, fast_polling,  # noqa: E402,F401
                                         make_inspire, unpack)

FILTER_FUNCTIONS = ("_filter_business_tables", "_filter_business_tables_with_batching", "_process_filter_batch_recursive")


@pytest.fixture
def restore_root_logger():
    root = logging.getLogger()
    saved = (list(root.handlers), root.level, list(root.filters))
    yield
    root.handlers[:] = saved[0]
    root.setLevel(saved[1])
    root.filters[:] = saved[2]


def test_resolver_contract(agent_ns):
    resolve = agent_ns["resolve_technical_exclusion_strategy"]
    assert agent_ns["TECHNICAL_EXCLUSION_STRATEGY"] == "Aggressive"
    for value in (None, "", "  ", "Aggressive", "aggressive", " AGGRESSIVE "):
        assert resolve(value) == "Aggressive", value
    for bad in ("None", "none", "Medium", "Low", "Bogus"):
        with pytest.raises(ValueError) as exc:
            resolve(bad)
        assert repr(bad) in str(exc.value) and "'Aggressive'" in str(exc.value)


def test_filter_always_sends_the_aggressive_rules(agent_ns):
    obj = make_inspire(agent_ns, responder=classifier({}))
    obj._filter_business_tables(FILTER_DETAILS)
    call = obj.ai_agent.calls[0]
    assert call["vars"]["exclusion_strategy"] == "Aggressive"
    assert call["vars"]["strategy_rules"].startswith("**AGGRESSIVE FILTERING**")
    assert "**STRATEGY: Aggressive**" in call["prompt"]
    for retired in ("MEDIUM FILTERING", "LOW FILTERING", "NO TECHNICAL EXCLUSION"):
        assert retired not in call["prompt"], retired


@pytest.mark.parametrize("bad", ["None", "Medium", "Low", "Bogus"])
def test_unsupported_strategy_is_rejected_before_any_llm_call(agent_ns, bad):
    obj = make_inspire(agent_ns, responder=classifier({}))
    with pytest.raises(ValueError):
        obj._filter_business_tables(FILTER_DETAILS, exclusion_strategy=bad)
    assert obj.ai_agent.calls == []


def test_technical_verdict_is_never_kept_as_business(agent_ns):
    labels = {"main.ops.job_logs": ("TECHNICAL", "TECHNICAL")}
    obj = make_inspire(agent_ns, responder=classifier(labels))
    out = unpack(obj._filter_business_tables(FILTER_DETAILS, exclusion_strategy="Aggressive"))
    assert "main.ops.job_logs" in out["technical"]
    assert "main.ops.job_logs" not in out["business"] and "main.ops.job_logs" not in out["master"]
    assert {"main.sales.orders", "main.sales.customers"} <= out["business"]


@pytest.mark.parametrize("name", FILTER_FUNCTIONS)
def test_unreachable_strategy_branches_are_gone(name):
    src = ast.unparse(method_node("DatabricksInspire", name))
    for token in ("include_technical", "MEDIUM FILTERING", "LOW FILTERING", "NO TECHNICAL EXCLUSION",
                  "Unknown technical exclusion strategy", "strategy_rules["):
        assert token not in src, (name, token)


def test_init_resolves_the_strategy(fresh_ns, tmp_path, restore_root_logger):
    sid = str(uuid.uuid4().int % 10 ** 12)
    obj = fresh_ns["DatabricksInspire"](business=f"StrategyProbe{sid}", generation_path=str(tmp_path / "out"),
                                        session_id=sid)
    try:
        assert obj.technical_exclusion_strategy == "Aggressive"
        assert obj.atomic_writer._widget_to_columns_map()["technical_exclusion_strategy"] == "Aggressive"
    finally:
        try:
            obj.ai_agent.cleanup_llm_cache()
        except Exception:
            pass
        shutil.rmtree(obj.local_log_output_dir, ignore_errors=True)


@pytest.mark.parametrize("bad", ["None", "Medium"])
def test_init_rejects_an_unsupported_strategy(fresh_ns, tmp_path, restore_root_logger, bad):
    with pytest.raises(ValueError):
        fresh_ns["DatabricksInspire"](business="StrategyProbe", generation_path=str(tmp_path / "out"),
                                      session_id="1", technical_exclusion_strategy=bad)


def test_main_and_init_use_the_one_constant():
    from _agentload import top_level_defs
    main_src = ast.unparse(top_level_defs()["main"])
    assert "'Aggressive'" not in main_src and "TECHNICAL_EXCLUSION_STRATEGY" in main_src
    init_src = ast.unparse(method_node("DatabricksInspire", "__init__"))
    assert "resolve_technical_exclusion_strategy(" in init_src and "'none'" not in init_src
