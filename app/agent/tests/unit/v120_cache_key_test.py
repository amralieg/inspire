import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _agentload import agent_source


def _inst(agent_ns):
    DI = agent_ns["DatabricksInspire"]
    return DI.__new__(DI)


def _ucs():
    return [{"No": "U1", "Name": "a", "Tables Involved": "main.s.t1"},
            {"No": "U2", "Name": "b", "Tables Involved": "main.s.t2"}]


def _ctx():
    return {"industry": "retail", "business_context": "ctx", "strategic_goals": "g"}


def _schema_30():
    return [("main", "s", "t1", f"c{i:02d}", "string", "") for i in range(30)]


def _schema_full():
    return _schema_30() + [("main", "s", "t1", f"c{i:02d}", "string", "") for i in range(30, 60)]


def test_combined_scored_outer_tag_keys_on_the_schema_payload(agent_ns):
    inst = _inst(agent_ns)
    ucs, ctx = _ucs(), _ctx()
    tag_30 = inst._scored_cache_tag("combined_scored_", ucs, ctx, _schema_30())
    tag_full = inst._scored_cache_tag("combined_scored_", ucs, ctx, _schema_full())
    assert tag_30 != tag_full
    assert tag_30 == inst._scored_cache_tag("combined_scored_", ucs, ctx, _schema_30())
    assert tag_30.startswith("combined_scored_")


def test_combined_batch_partial_tag_keys_on_the_schema_payload(agent_ns):
    inst = _inst(agent_ns)
    ucs = _ucs()
    base_vars = {"business_context": "ctx", "generation_instructions_section": "x"}
    tag_30 = inst._scored_cache_tag("combined_batch_partial_", ucs, base_vars, _schema_30())
    tag_full = inst._scored_cache_tag("combined_batch_partial_", ucs, base_vars, _schema_full())
    assert tag_30 != tag_full
    assert tag_30.startswith("combined_batch_partial_")


def test_prefix_cache_entries_cannot_be_reused_after_the_fix(agent_ns):
    inst = _inst(agent_ns)
    fp = agent_ns["DatabricksInspire"]._use_case_set_fingerprint
    ucs, ctx = _ucs(), _ctx()
    old_outer = "combined_scored_" + fp(ucs, ctx)
    new_outer = inst._scored_cache_tag("combined_scored_", ucs, ctx, _schema_full())
    assert old_outer != new_outer
    full_markdown = "## Available Tables and Columns\n\n(30 column overview)"
    old_inner = "combined_batch_partial_" + fp(ucs, dict(ctx, schema_details=full_markdown))
    new_inner = inst._scored_cache_tag("combined_batch_partial_", ucs, ctx, _schema_full())
    assert old_inner != new_inner


def test_old_key_was_schema_blind_new_key_is_not(agent_ns):
    fp = agent_ns["DatabricksInspire"]._use_case_set_fingerprint
    inst = _inst(agent_ns)
    ucs, ctx = _ucs(), _ctx()
    assert fp(ucs, ctx) == fp(ucs, ctx)
    thirty = inst._scored_cache_tag("combined_scored_", ucs, ctx, _schema_30())
    full = inst._scored_cache_tag("combined_scored_", ucs, ctx, _schema_full())
    assert thirty != full


def test_schema_fingerprint_payload_is_order_independent_and_captures_content(agent_ns):
    inst = _inst(agent_ns)
    a = [("main", "s", "t1", "c1", "string", "note"), ("main", "s", "t1", "c2", "double", "")]
    b = list(reversed(a))
    assert inst._schema_fingerprint_payload(a) == inst._schema_fingerprint_payload(b)
    typed = [("main", "s", "t1", "c1", "bigint", "note"), ("main", "s", "t1", "c2", "double", "")]
    assert inst._schema_fingerprint_payload(a) != inst._schema_fingerprint_payload(typed)
    commented = [("main", "s", "t1", "c1", "string", "other"), ("main", "s", "t1", "c2", "double", "")]
    assert inst._schema_fingerprint_payload(a) != inst._schema_fingerprint_payload(commented)
    assert inst._schema_fingerprint_payload([]) == []
    assert inst._schema_fingerprint_payload(None) == []


def test_per_call_llm_cache_keys_on_full_prompt_model_and_params(agent_ns):
    AIAgent = agent_ns["AIAgent"]
    inst = AIAgent.__new__(AIAgent)
    k = inst._llm_cache_key
    base = k("PROMPT", "modelA", "p1")
    assert base == k("PROMPT", "modelA", "p1")
    assert base != k("PROMPT two", "modelA", "p1")
    assert base != k("PROMPT", "modelB", "p1")
    assert base != k("PROMPT", "modelA", "p2")


def test_scoring_caches_no_longer_key_on_the_30_column_overview():
    src = agent_source()
    assert '_scored_cache_tag("combined_scored_", final_consolidated_use_cases, scoring_context, _schema_for_quality)' in src
    assert '_scored_cache_tag("combined_batch_partial_", use_cases, base_vars, full_schema_details)' in src
    assert 'combined_scored_" + self._use_case_set_fingerprint(final_consolidated_use_cases, scoring_context)' not in src
    assert "schema_details=full_markdown" not in src
    assert "def _schema_fingerprint_payload(" in src
