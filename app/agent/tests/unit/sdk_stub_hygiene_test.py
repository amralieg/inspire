"""No test module may leave a databricks.* entry in sys.modules for the modules that run after it.

The defect class: an SDK stub (or a real-SDK import) installed under a `databricks*` name outlives the test
that needed it, so a later module imports the wrong thing (a stub without `errors`, a class without `__init__`,
a plain module where a package is expected). The shared fixture `_restore_sdk_modules` in tests/conftest.py is
the only place allowed to write those names directly; everything else goes through `monkeypatch.setitem`.
"""
import ast
import os
import sys
import types

import pytest

import _nbload

TESTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHARED = {"conftest.py", "_nbload.py"}
WRITERS = {"setdefault", "update", "pop", "__setitem__", "__delitem__", "clear"}


def _is_sdk_name(node):
    return isinstance(node, ast.Constant) and isinstance(node.value, str) and node.value.split(".")[0] == "databricks"


def _is_sys_modules(node):
    return isinstance(node, ast.Attribute) and node.attr == "modules" and isinstance(node.value, ast.Name) and node.value.id == "sys"


def _direct_writes(path):
    tree = ast.parse(open(path, encoding="utf-8").read(), path)
    found = []
    for node in ast.walk(tree):
        targets = node.targets if isinstance(node, (ast.Assign, ast.Delete)) else [getattr(node, "target", None)] if isinstance(node, ast.AugAssign) else []
        for t in targets:
            if isinstance(t, ast.Subscript) and _is_sys_modules(t.value) and _is_sdk_name(t.slice):
                found.append(node.lineno)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in WRITERS \
                and _is_sys_modules(node.func.value) and node.args and _is_sdk_name(node.args[0]):
            found.append(node.lineno)
    return found


def _test_files():
    for folder in (TESTS, os.path.join(TESTS, "unit")):
        for name in sorted(os.listdir(folder)):
            if name.endswith(".py") and name not in SHARED and name != os.path.basename(__file__):
                yield os.path.join(folder, name)


def test_no_test_file_writes_a_databricks_module_into_sys_modules_directly():
    offenders = {os.path.relpath(p, TESTS): lines for p in _test_files() if (lines := _direct_writes(p))}
    assert not offenders, "direct sys.modules writes of databricks.* (use monkeypatch.setitem): %r" % offenders


def test_the_shared_restoring_fixture_is_autouse_in_conftest():
    tree = ast.parse(open(os.path.join(TESTS, "conftest.py"), encoding="utf-8").read())
    fixtures = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "_restore_sdk_modules"]
    assert fixtures and "autouse" in ast.dump(fixtures[0].decorator_list[0]), "tests/conftest.py needs an autouse _restore_sdk_modules fixture"


def test_modules_installed_during_a_block_are_gone_after_it_and_the_loader_stubs_stay():
    sentinel = types.ModuleType("databricks.sdk.zz_sentinel")
    existing = sys.modules.get("databricks.sdk")
    with _nbload.sdk_modules_restored():
        sys.modules["databricks.sdk.zz_sentinel"] = sentinel
        sys.modules["databricks.sdk"] = types.ModuleType("databricks.sdk")
        stub = _nbload.ensure_loader_module("databricks.zz_loader_stub")
    assert "databricks.sdk.zz_sentinel" not in sys.modules
    assert sys.modules.get("databricks.sdk") is existing
    assert sys.modules.get("databricks.zz_loader_stub") is stub
    sys.modules.pop("databricks.zz_loader_stub")
    _nbload.LOADER_STUBS.pop("databricks.zz_loader_stub", None)


def test_a_stale_loader_entry_is_not_kept_once_another_module_replaced_it():
    with _nbload.sdk_modules_restored():
        first = _nbload.ensure_loader_module("databricks.zz_replaced")
    assert sys.modules.get("databricks.zz_replaced") is first
    with _nbload.sdk_modules_restored():
        sys.modules["databricks.zz_replaced"] = types.ModuleType("databricks.zz_replaced")
    assert sys.modules.get("databricks.zz_replaced") is first
    sys.modules.pop("databricks.zz_replaced")
    _nbload.LOADER_STUBS.pop("databricks.zz_replaced", None)


@pytest.mark.parametrize("name", ["rc_install", "rc_release", "isolation", "infra_install"])
def test_every_release_tool_imports_under_the_release_tool_fixture_whatever_ran_before(release_tool, name):
    _nbload.install_stubs()
    assert release_tool.load(name) is not None
