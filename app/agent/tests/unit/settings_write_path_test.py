import copy
import json
import os
import sys
import tempfile

import pytest

SERVER = os.path.join(os.path.dirname(__file__), "..", "..", "agent", "app_shell", "server")
APP_SHELL = os.path.join(os.path.dirname(__file__), "..", "..", "agent", "app_shell")
sys.path.insert(0, os.path.abspath(SERVER))

import shell_core  # noqa: E402
import shell_db  # noqa: E402
import shell_sql  # noqa: E402

READ_ONLY = "ModifyTable is not supported in read-only session mode"


def _shell(tmp_path, host=""):
    with open(os.path.join(APP_SHELL, "example_page.json"), encoding="utf-8") as handle:
        page = json.load(handle)
    page["result_table"] = "main.pricing.loss_desk_out"
    settings = {
        "version": 2, "title": "Pricing desk", "subtitle": "", "style": "a", "layout": "sidebar", "auth": "user", "theme": "light",
        "palette": "default", "options": {"modify": False, "replace_edits": False, "decisions": False},
        "genie": {"space_id": "01f0aa11bb22cc33", "title": "Pricing desk"}, "built_at": "2026-10-26T10:00:00Z",
        "admin": "owner@example.com", "jobs": {},
    }
    if host:
        settings["host"] = host
    os.mkdir(os.path.join(tmp_path, shell_core.PAGES_DIR))
    settings["pages"] = [page["id"]]
    with open(os.path.join(tmp_path, shell_core.PAGES_DIR, page["id"] + ".json"), "w", encoding="utf-8") as handle:
        json.dump(page, handle)
    with open(os.path.join(tmp_path, shell_core.SETTINGS_FILE), "w", encoding="utf-8") as handle:
        json.dump(settings, handle)
    sp = object()
    user_ws = object()
    shell = shell_core.Shell(str(tmp_path), env={"DATABRICKS_HOST": "https://example.com", "DATABRICKS_WAREHOUSE_ID": "w1"},
                             sp_factory=lambda: sp, user_factory=lambda host, token: user_ws)
    return shell, sp, user_ws


@pytest.fixture
def shell_env(tmp_path):
    return _shell(str(tmp_path))


@pytest.fixture
def inside_env(tmp_path):
    return _shell(str(tmp_path), host="inspire")


def _spy(shell, failure=None):
    calls = []

    def execute(ws, sql, params, limit, delta=False, queued=False):
        calls.append(ws)
        if failure is not None:
            raise shell_db.QueryError(failure)
        return {"rows": []}

    shell.execute = execute
    return calls


def test_a_setting_write_goes_through_the_app_identity_not_the_viewer_session(shell_env):
    shell, sp, user_ws = shell_env
    page = shell.pages[0]
    setting = {"name": "kpi_target_value", "kind": "number", "source": "app", "value": "", "editable": True}
    shell.setting_change = lambda headers, data: (page, user_ws, "user:a", setting, "90", None, set(), [setting])
    shell.editor = lambda headers: "a@example.com"
    shell.settings_view = lambda headers, ident: {"settings": []}
    shell.forget = lambda: None
    calls = _spy(shell)
    shell.save_setting({}, {"page": page["id"], "name": "kpi_target_value", "value": "90", "was": "", "note": ""})
    assert calls and all(ws is sp for ws in calls), "the target must be written by the App identity"


def test_a_read_only_session_refusal_is_a_plain_403_not_a_502(shell_env):
    shell, sp, user_ws = shell_env
    page = shell.pages[0]
    setting = {"name": "kpi_target_value", "kind": "number", "source": "app", "value": "", "editable": True}
    shell.setting_change = lambda headers, data: (page, user_ws, "user:a", setting, "90", None, set(), [setting])
    shell.editor = lambda headers: "a@example.com"
    shell.forget = lambda: None
    _spy(shell, failure=READ_ONLY)
    with pytest.raises(shell_core.HttpError) as caught:
        shell.save_setting({}, {"page": page["id"], "name": "kpi_target_value", "value": "90", "was": "", "note": ""})
    assert caught.value.status == 403
    assert caught.value.message == shell_core.REFUSED_WRITE, "the sentence carries no raw Databricks error"
    assert READ_ONLY in caught.value.extra["details"], "the raw error goes under details"


def test_every_settings_write_helper_writes_as_the_app_and_keeps_the_viewer_read_only(shell_env):
    shell, sp, user_ws = shell_env
    page = shell.pages[0]
    calls = _spy(shell)
    shell.write_saved(user_ws, shell_sql.assumptions_table(page), "insert into t values (1)", [])
    assert calls == [sp]


def test_a_page_inside_inspire_refuses_the_settings_write_plainly_and_never_uses_the_viewer_session(inside_env):
    shell, sp, user_ws = inside_env
    page = shell.pages[0]
    calls = _spy(shell)
    with pytest.raises(shell_core.HttpError) as caught:
        shell.write_saved(user_ws, shell_sql.assumptions_table(page), "insert into t values (1)", [])
    assert caught.value.status == 403
    assert caught.value.message == shell_core.INSIDE_SETTINGS
    assert calls == [], "no settings write reaches Databricks from a page inside Inspire"


def test_the_target_belongs_to_measurement_not_the_impact_group():
    assert shell_core.TARGET_SETTING["group"] == "measurement"
