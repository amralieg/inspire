"""v1.2.0 MODES lane: fabricated context defaults class sweep (scope item 7).

The generator and the batch scorers (combined scoring and Best-of-Best) used to present invented context to
the LLM when a field was empty: "Maximize operational efficiency" goals, "Digital transformation"
priorities, a "Data-driven transformation program" initiative, "Standard business operations",
"Product and service sales" and an industry of "General". Every one of these sites now sends one
explicit not-provided marker, so a prompt never presents invented goals or industry as the user's.
"""
import ast
import json
import logging
import os
import re
import sys
import threading

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import method_node  # noqa: E402
from v120_artifacts_support import unprotected_reads  # noqa: E402

INVENTED = ("Maximize operational efficiency", "Improve customer satisfaction", "Reduce operational costs",
            "Drive revenue growth", "Ensure compliance and risk management", "Digital transformation",
            "Cost optimization", "Data-driven transformation program", "Standard business operations",
            "Product and service sales")
FIELDS = {"strategic_initiative": "strategic initiative", "value_chain": "value chain",
          "revenue_model": "revenue model", "industry": "industry"}
STRATEGY_KEYS = ("strategic_goals", "business_priorities")
SWEPT = ("_process_batch_with_retry", "_score_combined_value_and_quality", "_score_best_of_best")
GEN_HEADER = ('"No","Name","usecase","type","Analytics Technique","Statement","Solution","Business Value",'
              '"Beneficiary","Sponsor","Tables Involved","High Level Design"')


def marker(field):
    return f"UNKNOWN_FROM_METADATA ({field}): not provided for this run; do not assume or invent one"


class FakeStorage:
    def __init__(self):
        self.saved = {}

    def load_scored_use_cases(self, tag="combined_scored"):
        return None

    def save_scored_use_cases(self, data, tag="combined_scored"):
        self.saved[tag] = data

    def load_schema_markdown(self, tag="schema_markdown"):
        return None

    def save_schema_markdown(self, markdown, tag="schema_markdown"):
        self.saved[tag] = markdown


class FakeAgent:
    def __init__(self, responder):
        self.responder = responder
        self.calls = []
        self._lock = threading.Lock()
        self.prompt_templates = {}

    def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema=None, skip_cache=False, **kw):
        with self._lock:
            self.calls.append({"step": step_name, "prompt": worker_prompt_path, "vars": dict(prompt_vars),
                               "skip_cache": skip_cache})
        return self.responder(worker_prompt_path, prompt_vars, skip_cache)


def make_obj(ns, responder=None, **attrs):
    DI = ns["DatabricksInspire"]
    obj = DI.__new__(DI)
    obj.logger = logging.getLogger("v120_modes_context")
    obj._implement_protections = unprotected_reads(ns)
    obj.storage_manager = FakeStorage()
    obj.ai_agent = FakeAgent(responder or (lambda *a: ""))
    obj.atomic_writer = None
    obj.parsed_generation_instructions = {}
    obj.user_generation_instructions = ""
    obj.merged_business_context = {}
    obj.business_name = "Acme"
    obj.llm_timeout_seconds = 30
    obj.use_cases_quality = "Good"
    obj.quality_filter_acceptable = {"Medium", "High", "Very High", "Ultra High"}
    obj.user_business_domains = []
    obj.user_strategic_goals = []
    obj.funnel_ledger = []
    obj.registry_lock = threading.Lock()
    obj.max_parallelism = 4
    obj._emit_pipeline_status = lambda **kw: None
    obj.__dict__.update(attrs)
    return obj


def gen_row(no, tables="c.s.orders"):
    return (f'"{no}","Forecast orders {no}","Forecast orders","AI","Forecasting","Orders drop","Model",'
            f'"Value","Ops","COO","{tables}","Aggregate"')


def gen_harness(ns, responses, **attrs):
    state = {"i": 0}

    def responder(prompt_name, prompt_vars, skip_cache):
        r = responses[min(state["i"], len(responses) - 1)]
        state["i"] += 1
        return r

    obj = make_obj(ns, responder, table_id_map={}, id_table_map={}, column_id_map={}, id_column_map={},
                   next_table_id=1, next_column_id=1, data_loader=None,
                   data_category_map={"c.s.orders": "TRANSACTIONAL"}, global_table_names={"c.s.orders"},
                   _known_hallucinated_tables=set(),
                   processing_honesty={"total_batch_splits": 0, "batch_split_history": []}, **attrs)
    obj._format_schema_for_prompt = lambda cols: "| table | col |\n" + "\n".join(f"| {c[2]} | {c[3]} |" for c in cols)
    obj._estimate_schema_markdown_size = lambda cols: 100
    obj._business_column_details_global = [("c", "s", "orders", "id", "bigint", "")]
    return obj


def make_uc(no, **extra):
    uc = {"No": no, "Name": f"Forecast demand {no}", "type": "AI", "Analytics Technique": "Forecasting",
          "Statement": "s", "Solution": "Model it", "Business Value": "Value", "Tables Involved": "c.s.orders",
          "High Level Design": "Aggregate", "Business Domain": "Sales", "Quality": "Pending", "Priority": 0.0}
    uc.update(extra)
    return uc


def ids_in(markdown):
    return re.findall(r"### Use Case: (\S+) - ", markdown or "")


def assert_markers(prompt_vars, fields):
    for key in fields:
        assert prompt_vars[key] == marker(FIELDS[key]), (key, prompt_vars[key])
    for key in STRATEGY_KEYS:
        assert key not in prompt_vars, key
    rendered = json.dumps(prompt_vars)
    for invented in INVENTED:
        assert invented not in rendered, invented
    if "industry" in prompt_vars:
        assert prompt_vars["industry"] != "General"


# ---------------------------------------------------------------- helper


def test_marker_helper_contract(agent_ns):
    helper = agent_ns["prompt_context_or_not_provided"]
    assert agent_ns["CONTEXT_NOT_PROVIDED_MARKER"] == "UNKNOWN_FROM_METADATA"
    for empty in (None, "", "   ", "\n"):
        assert helper(empty, "strategic goals") == marker("strategic goals")
    assert helper("  Grow basket size ", "strategic goals") == "Grow basket size"
    assert helper(marker("industry"), "industry") == marker("industry")


# ---------------------------------------------------------------- generation


def test_generation_without_user_context_sends_markers_not_invented_goals(agent_ns):
    obj = gen_harness(agent_ns, [GEN_HEADER + "\n" + gen_row("N1-1")])
    obj._process_batch_with_retry([("c", "s", "orders", "id", "bigint", "")], 1)
    pv = obj.ai_agent.calls[0]["vars"]
    assert_markers(pv, ("strategic_initiative", "value_chain", "revenue_model", "industry"))
    assert "UNKNOWN_FROM_METADATA" in pv["business_context"]
    assert pv["business_context"] == obj._get_business_context_fallback()


def test_generation_with_user_context_passes_it_through_unchanged(agent_ns):
    obj = gen_harness(agent_ns, [GEN_HEADER + "\n" + gen_row("N1-1")])
    obj._process_batch_with_retry([("c", "s", "orders", "id", "bigint", "")], 1,
                                  business_context="Bakery chain",
                                  strategic_initiative="SI", value_chain="VC", revenue_model="RM",
                                  industry="Food retail")
    pv = obj.ai_agent.calls[0]["vars"]
    assert not set(STRATEGY_KEYS) & set(pv)
    assert pv["business_context"] == "Bakery chain" and pv["industry"] == "Food retail"
    assert (pv["strategic_initiative"], pv["value_chain"], pv["revenue_model"]) == ("SI", "VC", "RM")


def test_generation_markers_survive_the_split_recursion(agent_ns):
    obj = gen_harness(agent_ns, [GEN_HEADER + "\n" + gen_row("N1-1")])
    obj._process_batch_with_retry([("c", "s", "orders", "id", "bigint", "")], 1, industry=marker("industry"),
                                  value_chain=marker("value chain"))
    pv = obj.ai_agent.calls[0]["vars"]
    assert pv["industry"] == marker("industry") and pv["value_chain"] == marker("value chain")


def test_generation_size_estimate_counts_the_markers(agent_ns):
    sizes = []
    obj = gen_harness(agent_ns, [GEN_HEADER + "\n" + gen_row("N1-1")])
    real = obj._generation_prompt_base_size

    def spy(context_texts=()):
        sizes.append(tuple(context_texts))
        return real(context_texts)

    obj._generation_prompt_base_size = spy
    obj._process_batch_with_retry([("c", "s", "orders", "id", "bigint", "")], 1)
    assert sizes and marker("industry") in sizes[0] and marker("strategic goals") not in sizes[0]


# ---------------------------------------------------------------- batch scorers


def _combined(ids):
    return json.dumps([{"use_case_id": i, "quality_label": "High", "quality_score": 4.0, "priority_score": 7.0,
                        "quality_summary": "Columns `a` and `b` aggregated monthly give a KPI that drives the outcome."}
                       for i in ids])


def _bob(ids):
    return json.dumps([{"No": i, "bob_scores": {f"D{g}": 7 for g in range(1, 20)}, "idea_theme": "Demand",
                        "bob_justification_short": "ok"} for i in ids])


def test_combined_scoring_without_context_sends_markers(agent_ns):
    obj = make_obj(agent_ns, lambda n, pv, s: _combined(ids_in(pv["use_cases_to_validate"])))
    obj._score_combined_value_and_quality([make_uc("U1")], [("c", "s", "orders", "id", "bigint", "")])
    assert_markers(obj.ai_agent.calls[0]["vars"], tuple(FIELDS))


def test_best_of_best_without_context_sends_markers(agent_ns):
    obj = make_obj(agent_ns, lambda n, pv, s: _bob(ids_in(pv["use_cases_to_validate"])))
    obj._score_best_of_best([make_uc("U1")], [("c", "s", "orders", "id", "bigint", "")])
    assert_markers(obj.ai_agent.calls[0]["vars"], tuple(FIELDS))


def test_batch_scorers_pass_real_context_through(agent_ns):
    ctx = dict(business_context="Ctx", industry="Ind", strategic_goals=["G1", "G2"], business_priorities=["P1"],
               strategic_initiative="SI", value_chain="VC", revenue_model="RM")
    combined = make_obj(agent_ns, lambda n, pv, s: _combined(ids_in(pv["use_cases_to_validate"])))
    combined._score_combined_value_and_quality([make_uc("U1")], [], **combined._grading_context(ctx))
    bob = make_obj(agent_ns, lambda n, pv, s: _bob(ids_in(pv["use_cases_to_validate"])))
    bob._score_best_of_best([make_uc("U1")], [], **bob._grading_context(ctx))
    for obj in (combined, bob):
        pv = obj.ai_agent.calls[0]["vars"]
        assert pv["industry"] == "Ind" and not set(STRATEGY_KEYS) & set(pv)
        assert "G1" not in json.dumps(pv) and "P1" not in json.dumps(pv)
        assert (pv["strategic_initiative"], pv["value_chain"], pv["revenue_model"]) == ("SI", "VC", "RM")
    with pytest.raises(TypeError):
        combined._score_combined_value_and_quality([make_uc("U2")], [], **ctx)


# ---------------------------------------------------------------- static class sweep


@pytest.mark.parametrize("name", SWEPT)
def test_no_fabricated_context_literal_left_in_swept_functions(name):
    node = method_node("DatabricksInspire", name)
    literals = [n.value for n in ast.walk(node) if isinstance(n, ast.Constant) and isinstance(n.value, str)]
    for literal in literals:
        for invented in INVENTED:
            assert invented not in literal, (name, invented)
        assert literal not in ("General", "- None"), (name, literal)
    for boolop in (n for n in ast.walk(node) if isinstance(n, ast.BoolOp) and isinstance(n.op, ast.Or)):
        last = boolop.values[-1]
        if isinstance(last, ast.Constant) and isinstance(last.value, str) and last.value:
            names = {getattr(v, "id", None) for v in boolop.values}
            assert not names & (set(FIELDS) | {"business_context"}), (name, ast.unparse(boolop))
