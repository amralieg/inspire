import json
import os
import re
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
sys.path.insert(0, HERE)
from v141_app_shell_test import MANIFEST, SERVER, SETTINGS, FakeResponse, FakeSession, app_dir, workspace  # noqa: E402
from v141_app_shell_test import page as app_page  # noqa: E402

if SERVER not in sys.path:
    sys.path.insert(0, SERVER)
import shell_core  # noqa: E402
import shell_db  # noqa: E402

QUERY_TAG_KEY = re.compile(r"^[^,:\-/=.]{1,128}$")
DONE = FakeResponse(payload={"statement_id": "s1", "status": {"state": "SUCCEEDED"}, "manifest": MANIFEST,
                             "result": {"data_array": []}})


def test_the_app_query_tag_is_the_job_tag_key_and_carries_the_app_name():
    assert shell_db.app_query_tags("churn-desk") == [{"key": "dbx_inspire_ai_app_name", "value": "churn-desk"}]
    assert shell_db.app_query_tags("  churn   desk ") == [{"key": "dbx_inspire_ai_app_name", "value": "churn desk"}]
    assert shell_db.app_query_tags("") == [] and shell_db.app_query_tags(None) == []


def test_a_query_tag_value_is_cut_to_the_128_character_limit_the_statements_api_enforces():
    [tag] = shell_db.app_query_tags("x" * 300)
    assert len(tag["value"]) == 128 and QUERY_TAG_KEY.match(tag["key"])


def test_a_workspace_built_for_the_app_sends_its_query_tags_on_every_statement():
    session = FakeSession([DONE])
    ws = shell_db.Workspace("dbc-1.example.com", lambda: {"Authorization": "Bearer t"}, session=session, sleep=lambda s: None,
                            clock=lambda: 0, query_tags=shell_db.app_query_tags("churn-desk"))
    ws.run_sql("wh-1", "SELECT 1", [], limit=5)
    [call] = session.calls
    assert call["url"].endswith("/api/2.0/sql/statements")
    assert call["body"]["query_tags"] == [{"key": "dbx_inspire_ai_app_name", "value": "churn-desk"}]


def test_a_workspace_without_query_tags_sends_no_query_tags_field():
    ws, session = workspace([DONE])
    ws.run_sql("wh-1", "SELECT 1", [], limit=5)
    assert "query_tags" not in session.calls[0]["body"]


def test_the_app_workspaces_take_their_query_tag_from_the_apps_runtime_name(monkeypatch):
    monkeypatch.setenv("DATABRICKS_APP_NAME", "churn-desk")
    assert shell_core.user_workspace_factory("dbc-1.example.com", "t").query_tags == [{"key": "dbx_inspire_ai_app_name", "value": "churn-desk"}]
    monkeypatch.delenv("DATABRICKS_APP_NAME")
    assert shell_core.user_workspace_factory("dbc-1.example.com", "t").query_tags == []


def test_the_report_attributes_warehouse_dbus_by_the_query_tag_the_app_sends():
    report = open(os.path.join(HERE, "..", "..", "..", "docs", "inspire_usage_report.sql"), encoding="utf-8").read()
    assert "main.centralized_system_tables.query_history" in report and "try_element_at(query_tags, 'dbx_inspire_ai_app_name')" in report
    assert "ATTRIBUTED BY QUERY DURATION" in report and "history before that stays unattributed" in report


class RecordingWorkspace(shell_db.Workspace):
    def __init__(self, sent):
        super().__init__("dbc-1.example.com", lambda: {"Authorization": "Bearer t"}, session=FakeSession([]), sleep=lambda s: None,
                         clock=lambda: 0, query_tags=shell_db.app_query_tags("churn-desk"))
        self.sent = sent

    def call(self, method, path, body=None, params=None, timeout=60):
        if method == "POST" and path == "/api/2.0/sql/statements":
            self.sent.append([tag["value"] for tag in body.get("query_tags", []) if tag["key"] == "dbx_inspire_ai_usecase_id"])
            return {"statement_id": "s", "status": {"state": "SUCCEEDED"}, "manifest": MANIFEST, "result": {"data_array": []}}
        return {}


def test_two_pages_send_two_use_case_tags_and_no_request_carries_another_pages_tag(tmp_path):
    sent = []
    ws = RecordingWorkspace(sent)
    second = app_page(id="p2", use_case_id="UC-2")
    second["kpis"][0]["expression"] = "SUM(loss) * 1"
    pages = [app_page(id="p1", use_case_id="UC-1"), second]
    s = shell_core.Shell(app_dir(tmp_path, dict(SETTINGS, pages=["p1", "p2"]), pages),
                         env={"DATABRICKS_WAREHOUSE_ID": "wh1", "DATABRICKS_HOST": "dbc-1.example.com"},
                         sp_factory=lambda: ws, user_factory=lambda host, token: ws)
    s.handle("POST", "page", {}, {}, json.dumps({"page": "p1"}).encode())
    first = len(sent)
    s.handle("POST", "page", {}, {}, json.dumps({"page": "p2"}).encode())
    assert first > 0 and len(sent) > first
    assert all(tags == ["UC-1"] for tags in sent[:first]), "every statement of page one, tile threads included, carries its use case"
    assert all(tags == ["UC-2"] for tags in sent[first:]), "page two's statements carry page two's use case, not page one's"
    assert shell_db.QUERY_USE_CASE.get() == "", "the use case does not outlive its request"



def test_a_page_read_under_a_request_set_by_hand_leaves_no_use_case_tag_for_the_next_statement(tmp_path):
    sent = []
    ws = RecordingWorkspace(sent)
    s = shell_core.Shell(app_dir(tmp_path, dict(SETTINGS, pages=["p1"]), [app_page(id="p1", use_case_id="UC-1")]),
                         env={"DATABRICKS_WAREHOUSE_ID": "wh1", "DATABRICKS_HOST": "dbc-1.example.com"},
                         sp_factory=lambda: ws, user_factory=lambda host, token: ws)
    token = shell_core.REQUEST.set({"headers": {}, "rules": {}, "money": False})
    try:
        s.page("p1")
    finally:
        shell_core.REQUEST.reset(token)
    ws.run_sql("wh1", "SELECT 1", [], limit=5)
    assert sent == [[]], "only a request answered by the App carries a page's use case tag"
