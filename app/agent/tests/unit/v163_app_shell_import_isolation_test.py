import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_core  # noqa: E402


def test_a_build_loads_its_own_copy_of_the_app_shell(agent_ns, tmp_path):
    payload = agent_ns["implement_app_shell_payload"](agent_ns["inspire_notebook_asset"]("app_shell"))
    held = sys.modules.get("shell_db")
    modules = agent_ns["implement_app_shell_modules"](str(tmp_path / "_shell"), payload["files"])
    assert modules["shell_db"].__file__.startswith(str(tmp_path / "_shell"))
    assert modules["shell_db"].QueryError is not shell_core.QueryError
    assert sys.modules.get("shell_db") is held and str(tmp_path / "_shell") not in sys.path, \
        "the build's copy never leaks into the modules and path the rest of the process imports from"


def test_the_next_test_imports_the_same_app_shell_the_server_code_uses(tmp_path_factory):
    from shell_db import QueryError
    assert QueryError is shell_core.QueryError
    assert sys.modules["shell_core"] is shell_core
    assert not [entry for entry in sys.path if entry.startswith(str(tmp_path_factory.getbasetemp()))]
