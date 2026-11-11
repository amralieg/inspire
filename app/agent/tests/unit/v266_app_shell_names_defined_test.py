"""Every app shell module the agent execs or writes to an App is self-contained: each name it reads is bound in that module
before the read happens at import time, and every name a function body reads is bound somewhere in the module.

The shell modules are imported in the Databricks runtime, which runs Python before 3.14. There an annotation, default,
decorator or base class is evaluated when the `def` or `class` statement runs, so `def f(t: Turn)` above `class Turn`
raises NameError on import. Python 3.14 defers annotations, so a local run of the suite passes while the notebook fails.
The check therefore treats a forward reference in an eager position as an error on every version."""
import ast
import builtins
import symtable

import pytest

BUILTINS = set(dir(builtins)) | {"__file__", "__name__", "__doc__", "__spec__", "__loader__", "__package__", "__builtins__",
                                  "__path__", "__class__", "__annotations__"}
FUNC = (ast.FunctionDef, ast.AsyncFunctionDef)
COMPREHENSION = (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)


def _loads(node, local=frozenset()):
    if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
        if node.id not in local:
            yield node
        return
    if isinstance(node, COMPREHENSION):
        local = local | {t.id for g in node.generators for t in ast.walk(g.target) if isinstance(t, ast.Name)}
    if isinstance(node, ast.Lambda):
        for default in node.args.defaults + [k for k in node.args.kw_defaults if k is not None]:
            yield from _loads(default, local)
        return
    for child in ast.iter_child_nodes(node):
        yield from _loads(child, local)


def _bound_by(node):
    for n in ast.walk(node):
        if isinstance(n, ast.Name) and isinstance(n.ctx, (ast.Store, ast.Del)):
            yield n.id
        elif isinstance(n, (ast.Import, ast.ImportFrom)):
            for alias in n.names:
                yield alias.asname or alias.name.split(".")[0]
        elif isinstance(n, FUNC + (ast.ClassDef,)):
            yield n.name
        elif isinstance(n, ast.ExceptHandler) and n.name:
            yield n.name


def _parameters(args):
    return [a for a in args.posonlyargs + args.args + args.kwonlyargs + [args.vararg, args.kwarg] if a is not None]


def _eager_forward_reads(source):
    problems = []

    def check(nodes, scope):
        for node in nodes:
            for name in _loads(node):
                if name.id not in scope and name.id not in BUILTINS:
                    problems.append(f"line {name.lineno}: {name.id} is read before the module binds it")

    def run(body, scope):
        for stmt in body:
            if isinstance(stmt, FUNC):
                eager = stmt.decorator_list + stmt.args.defaults + [k for k in stmt.args.kw_defaults if k is not None]
                eager += [a.annotation for a in _parameters(stmt.args) if a.annotation is not None]
                check(eager + ([stmt.returns] if stmt.returns is not None else []), scope)
                scope.add(stmt.name)
            elif isinstance(stmt, ast.ClassDef):
                check(stmt.decorator_list + stmt.bases + [k.value for k in stmt.keywords], scope)
                run(stmt.body, set(scope))
                scope.add(stmt.name)
            elif isinstance(stmt, (ast.If, ast.While)):
                check([stmt.test], scope)
                run(stmt.body, scope)
                run(stmt.orelse, scope)
            elif isinstance(stmt, (ast.For, ast.AsyncFor)):
                check([stmt.iter], scope)
                scope.update(_bound_by(stmt.target))
                run(stmt.body, scope)
                run(stmt.orelse, scope)
            elif isinstance(stmt, (ast.With, ast.AsyncWith)):
                check([item.context_expr for item in stmt.items], scope)
                for item in stmt.items:
                    if item.optional_vars is not None:
                        scope.update(_bound_by(item.optional_vars))
                run(stmt.body, scope)
            elif isinstance(stmt, (ast.Try, ast.TryStar)):
                run(stmt.body, scope)
                for handler in stmt.handlers:
                    if handler.type is not None:
                        check([handler.type], scope)
                    if handler.name:
                        scope.add(handler.name)
                    run(handler.body, scope)
                run(stmt.orelse, scope)
                run(stmt.finalbody, scope)
            else:
                check([stmt], scope)
                scope.update(_bound_by(stmt))

    run(ast.parse(source).body, set())
    return problems


def _unbound_in_bodies(source):
    top = symtable.symtable(source, "<app_shell>", "exec")
    module = {s.get_name() for s in top.get_symbols() if s.is_assigned() or s.is_imported()}
    module |= {child.get_name() for child in top.get_children()}
    problems = []

    def walk(table, path):
        for child in table.get_children():
            here = path + [child.get_name()]
            if child.get_type() == "function":
                for sym in child.get_symbols():
                    name = sym.get_name()
                    if sym.is_referenced() and sym.is_global() and name not in module and name not in BUILTINS:
                        problems.append(f"{'.'.join(here)} reads {name}, which no module-level statement binds")
            walk(child, here)

    walk(top, [])
    return problems


def undefined_names(source):
    return _eager_forward_reads(source) + _unbound_in_bodies(source)


def test_every_shipped_app_shell_module_defines_every_name_it_reads(agent_ns):
    payload = agent_ns["implement_app_shell_payload"](agent_ns["inspire_notebook_asset"]("app_shell"))
    shipped = {name: text for name, text in payload["files"].items() if name.endswith(".py")}
    assert set(agent_ns["IMPLEMENT_APP_SHELL_MODULES"]) <= {name[:-3] for name in shipped}
    assert {name: undefined_names(text) for name, text in shipped.items() if undefined_names(text)} == {}


def test_the_embedded_app_shell_matches_the_server_files_it_is_built_from(agent_ns):
    import os
    server = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "agent", "app_shell", "server")
    payload = agent_ns["implement_app_shell_payload"](agent_ns["inspire_notebook_asset"]("app_shell"))
    for name in agent_ns["IMPLEMENT_APP_SHELL_MODULES"]:
        with open(os.path.join(server, f"{name}.py"), encoding="utf-8") as handle:
            assert payload["files"][f"{name}.py"] == handle.read(), name


def test_a_forward_reference_in_an_annotation_is_found_because_python_before_3_14_evaluates_it_at_the_def():
    source = "def answer_rows(turn: Turn) -> int:\n    return 0\n\n\nclass Turn:\n    pass\n"
    assert undefined_names(source) == ["line 1: Turn is read before the module binds it"]


@pytest.mark.parametrize("source", [
    "def answer_rows(turn: \"Turn\") -> int:\n    return 0\n\n\nclass Turn:\n    pass\n",
    "def run(turn):\n    return Turn(turn)\n\n\nclass Turn:\n    pass\n",
    "class Turn:\n    pass\n\n\ndef answer_rows(turn: Turn) -> int:\n    return 0\n",
    "from dataclasses import dataclass\n\n\n@dataclass\nclass Row:\n    name: str = 'x'\n",
    "class A:\n    LIMIT = 3\n\n    def take(self, n=LIMIT):\n        return n\n",
    "values = [v * 2 for v in range(3)]\nclass Box(list):\n    pass\n",
    "def f():\n    return g(lambda x: x + 1)\n\n\ndef g(h):\n    return h(1)\n",
    "try:\n    import json\nexcept ImportError:\n    json = None\nKIND = json is None\n",
])
def test_a_name_bound_before_its_eager_use_or_read_only_inside_a_body_passes(source):
    assert undefined_names(source) == []


@pytest.mark.parametrize("source,found", [
    ("def f():\n    return missing\n", "f reads missing, which no module-level statement binds"),
    ("class C:\n    def m(self):\n        return gone + 1\n", "C.m reads gone, which no module-level statement binds"),
    ("def f(x=Later):\n    return x\n\n\nLater = 1\n", "line 1: Later is read before the module binds it"),
    ("class C(Base):\n    pass\n\n\nclass Base:\n    pass\n", "line 1: Base is read before the module binds it"),
    ("@decorate\ndef f():\n    pass\n\n\ndef decorate(fn):\n    return fn\n", "line 1: decorate is read before the module binds it"),
    ("def f() -> Result:\n    return 1\n\n\nclass Result:\n    pass\n", "line 1: Result is read before the module binds it"),
    ("def f(x: Missing):\n    return x\n", "line 1: Missing is read before the module binds it"),
])
def test_the_check_reports_each_kind_of_name_the_module_never_binds_before_it_is_read(source, found):
    assert any(found in problem for problem in undefined_names(source)), undefined_names(source)
