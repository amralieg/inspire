"""REQ-422: the checked-in demo notebooks resolve their ai_endpoint at run time, the same way the agent does (system.ai first,
databricks- fallback). They carry no baked-in model name that the enforced workspace refuses."""
import ast
import glob
import os
import re
import types

from _nbload import ROOT

DEMOS = sorted(glob.glob(os.path.join(ROOT, "demos", "**", "*.ipynb.py"), recursive=True))
LITERAL = re.compile(r"'ai_endpoint': 'databricks-")
BLOCK = re.compile(r"# >>> REQ-422 model resolver.*?# <<< REQ-422 model resolver\n", re.S)
CALL = 'resolve_model_callable(w.get("ai_endpoint") or spec.get("ai_endpoint", ""))'


def _text(path):
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def _demos_with_literal():
    return [p for p in DEMOS if LITERAL.search(_text(p))]


def _resolver(path):
    block = BLOCK.search(_text(path)).group(0)
    namespace = {}
    exec(compile(block, path, "exec"), namespace)
    return namespace["resolve_model_callable"]


class EnforcedSpark:
    """Refuses every databricks- name the way Unity Gateway enforcement does, and answers system.ai model services."""
    def __init__(self):
        self.queries = []

    def sql(self, query):
        self.queries.append(query)
        if "ai_query('databricks-" in query:
            raise RuntimeError("PERMISSION_DENIED: Querying pay-per-token foundation model endpoint 'databricks-claude-opus-4-8' "
                               "is disabled for this workspace. Please use Unity Gateway.")
        return types.SimpleNamespace(collect=lambda: [])


class NoGatewaySpark:
    """A workspace without Unity Gateway: no model service answers, the databricks- name does."""
    def sql(self, query):
        if "ai_query('system.ai." in query:
            raise RuntimeError("[TABLE_OR_VIEW_NOT_FOUND] The table or view cannot be found.")
        return types.SimpleNamespace(collect=lambda: [])


def test_every_demo_that_names_a_model_carries_the_same_resolver_block():
    demos = _demos_with_literal()
    assert len(demos) == 20, len(demos)
    blocks = {BLOCK.search(_text(p)).group(0) if BLOCK.search(_text(p)) else None for p in demos}
    assert None not in blocks, [p for p in demos if not BLOCK.search(_text(p))]
    assert len(blocks) == 1, "one resolver text in every demo"


def test_every_demo_resolves_its_ai_endpoint_through_the_resolver_at_run_time():
    for path in _demos_with_literal():
        assert CALL in _text(path), path
        ast.parse(_text(path))


def test_under_enforcement_the_demo_calls_the_system_ai_model_service(monkeypatch):
    """Fail-pre: before REQ-422 the demo called 'databricks-claude-opus-4-8' by its literal name, which enforcement refuses."""
    path = _demos_with_literal()[0]
    resolver = _resolver(path)
    spark = EnforcedSpark()
    monkeypatch.setitem(resolver.__globals__, "spark", spark)
    assert resolver("databricks-claude-opus-4-8") == "system.ai.claude-opus-4-8"
    assert any("ai_query('system.ai.claude-opus-4-8'" in q for q in spark.queries)


def test_a_workspace_without_unity_gateway_keeps_the_databricks_name(monkeypatch):
    """Must-keep: when no model service answers, the databricks- name is the one the demo calls."""
    path = _demos_with_literal()[0]
    resolver = _resolver(path)
    monkeypatch.setitem(resolver.__globals__, "spark", NoGatewaySpark())
    assert resolver("databricks-claude-opus-4-8") == "databricks-claude-opus-4-8"


def test_a_name_that_is_not_a_databricks_model_is_returned_unchanged(monkeypatch):
    """Must-keep: a workspace endpoint or an empty widget is not rewritten and no probe is sent for it."""
    path = _demos_with_literal()[0]
    resolver = _resolver(path)
    spark = EnforcedSpark()
    monkeypatch.setitem(resolver.__globals__, "spark", spark)
    assert resolver("team-chat-endpoint") == "team-chat-endpoint"
    assert resolver("") == ""
    assert spark.queries == []
