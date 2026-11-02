"""Offline loader for `agent/dbx_inspire_ai_agent.ipynb`.

The agent is a 3-cell Databricks notebook whose second cell holds the entire implementation
(~31.7k lines). `load_agent_namespace()` compiles and execs that cell in a plain pytest process
with pyspark, dbutils and the Databricks SDK stubbed by `_nbload`, and returns the resulting
globals dict. Pure functions, dataclasses and class-level logic are then callable directly.

Scope and limitations, stated up front so no test claims more coverage than it has:

* Cell 0 is markdown and cell 2 is only the `__main__` guard, so cells[1] is the whole surface.
* `create_widgets()` runs at module level. `dbutils.widgets.*` is answered by a no-op double, so
  every widget read returns `""` offline. Code whose behaviour depends on a widget VALUE cannot be
  exercised here without setting the corresponding global by hand.
* `spark` and `dbutils` are NOT defined as globals by cells[1]; the notebook inherits them from the
  Databricks runtime. Any function that references them raises `NameError` offline. Instantiate the
  owning class with an explicit double instead.
* `pandas` is imported by the notebook but never used, so it is stubbed as an empty module.
* The default namespace is CACHED per notebook revision. Tests that mutate module globals
  (`TECHNICAL_CONTEXT`, `AIAgent._total_ai_calls`, ...) must take `fresh_agent_namespace()` instead,
  or they leak into every later test in the same process.
"""
import ast
import hashlib
import os
import pathlib
import re

import _nbload
from _nbload import (AGENT_NB, ROOT, code_cells, install_stubs,  # noqa: F401
                     notebook_cells, strip_magic_lines)

IMPL_CELL_INDEX = 1
EXPECTED_CELL_COUNT = 3
REFERENCE_DIR = pathlib.Path(ROOT) / "tests" / "regression" / "reference"

_CODE_CACHE = {}
_NS_CACHE = {}


def agent_notebook_path(notebook_path=None):
    return os.path.abspath(notebook_path or AGENT_NB)


def reference_notebook(ref):
    path = REFERENCE_DIR / f"agent_{ref}.ipynb"
    if not path.is_file():
        raise FileNotFoundError(f"no reference notebook for {ref}: add the agent notebook of {ref} as {path.relative_to(ROOT)}")
    return path


def agent_source(notebook_path=None):
    """Source of `cells[1]` exactly as `load_agent_namespace` compiles it.

    Addressed by NOTEBOOK position, not by code-cell position: cells[0] is markdown, so a
    code-cell-relative index silently resolves to the `__main__` guard in cells[2] instead.
    """
    path = agent_notebook_path(notebook_path)
    cells = notebook_cells(path)
    if len(cells) <= IMPL_CELL_INDEX:
        raise AssertionError(
            "%s has %d cells; expected the implementation at cells[%d]"
            % (path, len(cells), IMPL_CELL_INDEX))
    cell_type, src = cells[IMPL_CELL_INDEX]
    if cell_type != "code":
        raise AssertionError(
            "%s cells[%d] is %r, expected a code cell" % (path, IMPL_CELL_INDEX, cell_type))
    return strip_magic_lines(src)


def agent_version(notebook_path=None):
    m = re.search(r'__AGENT_VERSION__\s*=\s*["\'](v[0-9.]+)["\']', agent_source(notebook_path))
    if not m:
        raise AssertionError("agent notebook declares no __AGENT_VERSION__")
    return m.group(1)


def _compiled(src, name):
    """One compile per distinct source per process, keyed on the bytes.

    Compiling 1.8 MB of source costs an order of magnitude more than exec'ing it, and the suite
    builds a fresh namespace per mutating test. The code object is immutable, so sharing it shares
    only the work.
    """
    key = hashlib.sha256(src.encode("utf-8")).hexdigest()
    code = _CODE_CACHE.get(key)
    if code is None:
        code = compile(src, name, "exec")
        _CODE_CACHE[key] = code
    return code


def _exec_agent(src, notebook_path):
    install_stubs()
    ns = {
        "__name__": "inspire_offline",
        "__file__": notebook_path,
        "spark": _nbload.NullSpark(),
        "dbutils": _nbload.NullDbutils(),
    }
    exec(_compiled(src, "<%s>" % os.path.basename(notebook_path)), ns)
    return ns


def load_agent_namespace(notebook_path: str = None) -> dict:
    """The agent's module globals after exec'ing cells[1] with the runtime stubbed.

    Cached per notebook revision. The returned dict is SHARED: treat it as read-only, and use
    `fresh_agent_namespace()` for anything that rebinds a name inside it.
    """
    path = agent_notebook_path(notebook_path)
    src = agent_source(path)
    key = hashlib.sha256(src.encode("utf-8")).hexdigest()
    ns = _NS_CACHE.get(key)
    if ns is None:
        ns = _exec_agent(src, path)
        _NS_CACHE[key] = ns
    return ns


def fresh_agent_namespace(notebook_path: str = None) -> dict:
    """An unshared namespace for tests that mutate agent globals."""
    path = agent_notebook_path(notebook_path)
    return _exec_agent(agent_source(path), path)


def agent_ast(notebook_path=None):
    return ast.parse(agent_source(notebook_path))


def top_level_defs(notebook_path=None):
    """Top-level `def` and `class` nodes of the implementation cell, keyed by name.

    Lets a test assert on source structure (decorators, signatures, statement order) without
    exec'ing, which is the only way to check something the runtime erases.
    """
    return {n.name: n for n in agent_ast(notebook_path).body
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))}


def method_node(class_name, method_name, notebook_path=None):
    cls = top_level_defs(notebook_path).get(class_name)
    if not isinstance(cls, ast.ClassDef):
        raise AssertionError("no top-level class %r in the agent notebook" % class_name)
    for n in cls.body:
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == method_name:
            return n
    raise AssertionError("class %s has no method %r" % (class_name, method_name))


def assign_node(class_name, attr_name, notebook_path=None):
    """The `ast.Assign` binding a class attribute, for reading a constant's SOURCE form.

    The runtime value of a table of compiled regexes loses the role names paired with them, so a
    test that asks which role strings the pipeline can assign has to read the assignment.
    """
    cls = top_level_defs(notebook_path).get(class_name)
    if not isinstance(cls, ast.ClassDef):
        raise AssertionError("no top-level class %r in the agent notebook" % class_name)
    for n in cls.body:
        if isinstance(n, ast.Assign) and any(getattr(t, "id", None) == attr_name
                                             for t in n.targets):
            return n
    raise AssertionError("class %s has no attribute assignment %r" % (class_name, attr_name))
