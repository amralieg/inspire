import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_core  # noqa: E402
import shell_db  # noqa: E402


def test_a_delta_app_without_sqlglot_answers_its_pages_and_keeps_the_timed_cache(tmp_path, monkeypatch):
    import shell_pg
    from v141_app_shell_test import call
    from v142_edits_test import MODIFY, TableWorkspace, edit_page
    from v141_app_shell_test import app_dir
    monkeypatch.setitem(sys.modules, "sqlglot", None)
    assert shell_pg.dataset_reads("SELECT * FROM main.s.t") is None, "a Delta App ships no sqlglot, so it cannot tell what a query reads"
    ws = TableWorkspace()
    s = shell_core.Shell(app_dir(tmp_path, MODIFY, [edit_page()]), env={"DATABRICKS_WAREHOUSE_ID": "wh1"}, sp_factory=lambda: ws,
                         user_factory=lambda h, t: ws)
    status, out = call(s, "POST", "records", body={"page": "n01_u05", "filters": {}})
    assert status == 200, out
    assert s.stamp(ws, "sp", "SELECT * FROM main.s.t", True) is None


def test_loading_the_embedded_app_shell_leaves_the_processes_own_shell_modules_and_path_as_they_were(agent_ns, tmp_path):
    names = agent_ns["IMPLEMENT_APP_SHELL_MODULES"]
    before, path = {n: sys.modules.get(n) for n in names}, list(sys.path)
    payload = agent_ns["implement_app_shell_payload"](agent_ns["_INSPIRE_APP_SHELL"])
    loaded = agent_ns["implement_app_shell_modules"](str(tmp_path / "shell"), payload["files"])
    assert {n: sys.modules.get(n) for n in names} == before, \
        "a later import of shell_db must not get the embedded copy, whose QueryError the process's own shell_core never catches"
    assert sys.path == path
    assert loaded["shell_db"] is not shell_db and loaded["shell_core"] is not shell_core
    assert loaded["shell_core"].QueryError is loaded["shell_db"].QueryError and loaded["shell_core"].shell_sql is loaded["shell_sql"], \
        "the embedded modules still read each other"
    again = agent_ns["implement_app_shell_modules"](str(tmp_path / "again"), payload["files"])
    assert again["shell_core"] is not loaded["shell_core"] and {n: sys.modules.get(n) for n in names} == before
