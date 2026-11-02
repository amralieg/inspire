"""Every top-level name and class member of the agent is bound once, and no name a source string the agent execs into its globals
defines is bound again in the agent cell, so after a merge one lane's name can never silently replace another lane's."""
import ast

from _agentload import agent_source
from v120_metadata_only_guard_test import runtime_sources


def _bound(body):
    out = {}
    for node in body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            if not any(isinstance(d, ast.Attribute) and d.attr in ("setter", "deleter") for d in node.decorator_list):
                out.setdefault(node.name, []).append(node.lineno)
        elif isinstance(node, (ast.Assign, ast.AnnAssign)) and node.value is not None:
            reads = {n.id for n in ast.walk(node.value) if isinstance(n, ast.Name)}
            for target in node.targets if isinstance(node, ast.Assign) else [node.target]:
                for name in target.elts if isinstance(target, ast.Tuple) else [target]:
                    if isinstance(name, ast.Name) and name.id not in reads:
                        out.setdefault(name.id, []).append(node.lineno)
    return out


def bound_twice(source):
    tree = ast.parse(source)
    module = _bound(tree.body)
    found = [f"{name} at lines {lines}" for name, lines in module.items() if len(lines) > 1]
    for node in tree.body:
        if isinstance(node, ast.ClassDef):
            found += [f"{node.name}.{name} at lines {lines}" for name, lines in _bound(node.body).items() if len(lines) > 1]
    runtime, _unreadable = runtime_sources(source)
    for label, (text, space) in sorted(runtime.items()):
        if space != "globals()":
            continue
        inner = _bound(ast.parse(text).body)
        found += [f"{name} twice in {label}" for name, lines in inner.items() if len(lines) > 1]
        found += [f"{name}, which {label} defines, is bound again at lines {module[name]}" for name in inner if name in module]
    return found


def test_the_agent_binds_every_name_once_and_never_rebinds_one_its_execd_sources_define():
    assert bound_twice(agent_source()) == []


def test_the_check_catches_each_kind_of_second_binding_and_allows_a_setter_and_a_self_extension():
    execd = 'SOURCE = """\nKINDS = ("money", "count")\n"""\nexec(compile(SOURCE, "<s>", "exec"), globals())\n'
    assert bound_twice(execd + 'KINDS = {"money": "money"}\n') == ["KINDS, which SOURCE defines, is bound again at lines [5]"]
    assert bound_twice(execd + "OTHER = 1\n") == []
    assert bound_twice("A = 1\nA = 2\n") == ["A at lines [1, 2]"]
    assert bound_twice("def f():\n    pass\n\n\ndef f():\n    pass\n") == ["f at lines [1, 5]"]
    assert bound_twice("class C:\n    def m(self):\n        pass\n\n    def m(self):\n        pass\n") == ["C.m at lines [2, 5]"]
    assert bound_twice("class C:\n    @property\n    def p(self):\n        return 1\n\n    @p.setter\n    def p(self, v):\n        pass\n") == []
    assert bound_twice("A = (1,)\nA = A + (2,)\n") == []
    assert bound_twice('S = """\nX = 1\nX = 2\n"""\nexec(S, globals())\n') == ["X twice in S"]
