"""The Use cases siblings: one shared filter in shell_sql gives the deploy-time list and the runtime read, and the App falls back to the deploy list."""
import os
import sys

import pytest

SERVER = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_core  # noqa: E402
import shell_sql  # noqa: E402

ROWS = [
    {"use_case_id": "N05-U02", "app_name": "second-desk", "app_url": "https://second.example.com/"},
    {"use_case_id": "N04-U05", "app_name": "this-desk", "app_url": "https://this.example.com/"},
    {"use_case_id": "N06-U01", "app_name": "third-desk", "app_url": "http://insecure.example.com/"},
    {"use_case_id": "N07-U03", "app_name": "", "app_url": "https://seventh.example.com/"},
    {"use_case_id": "N05-U02", "app_name": "second-desk", "app_url": "https://second.example.com/"},
    "not a row",
]


def test_the_siblings_are_the_other_published_apps_and_never_this_use_case():
    assert shell_sql.sibling_items(ROWS, ["N04-U05"]) == [
        {"use_case_id": "N05-U02", "name": "second-desk", "url": "https://second.example.com/"},
        {"use_case_id": "N07-U03", "name": "N07-U03", "url": "https://seventh.example.com/"},
    ]
    assert shell_sql.sibling_items(None, ["N04-U05"]) == []


def test_the_siblings_query_reads_the_ready_apps_of_the_implement_table():
    sql = shell_sql.siblings_query("main.inspire.__inspire_implement")
    assert "FROM `main`.`inspire`.`__inspire_implement`" in sql and "`status` = 'ready'" in sql and "`app_url` IS NOT NULL" in sql
    with pytest.raises(ValueError):
        shell_sql.siblings_query("inspire.__inspire_implement")


class _Shell:
    def __init__(self, settings, rows=None, fail=False):
        self.settings = settings
        self.pages = [{"use_case_id": "N04-U05"}]
        self.rows, self.fail = rows, fail

    def session(self, headers):
        return "ws", "who"

    def run(self, ws, who, sql, params, limit, ttl=0, queued=False):
        if self.fail:
            raise RuntimeError("no read")
        return {"rows": self.rows}


def test_the_runtime_read_wins_when_the_table_is_readable_and_the_deploy_list_is_the_fallback():
    deploy = [{"use_case_id": "N05-U02", "name": "old", "url": "https://old.example.com/"}]
    settings = {"siblings": deploy, "siblings_table": "main.inspire.__inspire_implement"}
    live = _Shell(settings, rows=ROWS)
    assert [s["use_case_id"] for s in shell_core.Shell.siblings(live, {})] == ["N05-U02", "N07-U03"]
    assert shell_core.Shell.siblings(_Shell(settings, fail=True), {}) == deploy
    assert shell_core.Shell.siblings(_Shell({"siblings": deploy}), {}) == deploy
