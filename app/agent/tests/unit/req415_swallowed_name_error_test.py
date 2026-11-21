"""REQ-415 and REQ-419 defect class: a broad `except Exception` that logs "non-fatally" or "unavailable" hides a programming error
(NameError for a helper the notebook never defines, AttributeError on None). The notebook cell is checked for names it reads but
neither binds nor receives from the loaded namespace, and the run-start probe call is run for real."""
import ast
import builtins
import logging

import _agentload

RUNTIME_PROVIDED = {"spark", "dbutils", "display", "sc", "sqlContext", "get_ipython"}


def _bound_names(tree):
    bound = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
            bound.add(node.id)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            bound.add(node.name)
        elif isinstance(node, ast.arg):
            bound.add(node.arg)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            bound.update((a.asname or a.name).split(".")[0] for a in node.names)
        elif isinstance(node, ast.ExceptHandler) and node.name:
            bound.add(node.name)
        elif isinstance(node, (ast.Global, ast.Nonlocal)):
            bound.update(node.names)
    return bound


def test_every_name_the_notebook_reads_is_defined_somewhere(agent_ns):
    source = _agentload.agent_source()
    tree = ast.parse(source)
    known = _bound_names(tree) | set(agent_ns) | set(dir(builtins)) | RUNTIME_PROVIDED
    missing = sorted({f"{n.id}:{n.lineno}" for n in ast.walk(tree)
                      if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load) and n.id not in known})
    assert not missing, f"names read but never defined (a NameError a broad except would swallow): {missing}"


def test_the_workspace_api_client_the_startup_probe_passes_resolves_in_the_notebook(agent_ns):
    helper = agent_ns.get("_workspace_api_client")
    assert callable(helper), "run() calls _workspace_api_client() but the notebook scope does not define it"
    helper()  # returns None or a client; must not raise


def test_the_startup_probe_call_does_not_log_a_non_fatal_failure(agent_ns):
    source = _agentload.agent_source()
    tree = ast.parse(source)
    handlers = [h for h in ast.walk(tree) if isinstance(h, ast.ExceptHandler) and "AI function probe failed non-fatally" in ast.get_source_segment(source, h)]
    assert handlers, "the startup probe handler moved; update this test"
    tries = [t for t in ast.walk(tree) if isinstance(t, ast.Try) and handlers[0] in t.handlers]
    body_names = {n.id for t in tries for n in ast.walk(ast.Module(body=t.body, type_ignores=[])) if isinstance(n, ast.Name)}
    assert body_names <= (set(agent_ns) | set(dir(builtins)) | {"self"}), sorted(body_names - set(agent_ns))
