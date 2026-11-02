"""A fact that follows from a user's choice is an info note, a platform hiccup Inspire can retry is retried, and only a problem the user
must act on stays a warning, offline."""
import json
import time
import types

import pytest

from v120_artifacts_support import CapturingLogger, FakeSpark
from v140_implement_test import _inspire
from v143_vibes_test import _locked, _run

BUSY = RuntimeError("503 Service Unavailable: TEMPORARILY_UNAVAILABLE, try again")
DENIED = RuntimeError("PERMISSION_DENIED: you cannot do that")


@pytest.fixture
def slept(monkeypatch):
    waits = []
    monkeypatch.setattr(time, "sleep", waits.append)
    return waits


def _api(agent_ns, answers):
    inst = _inspire(agent_ns, FakeSpark())
    inst.logger = CapturingLogger()
    calls = []

    def do(method, path, query=None, body=None):
        calls.append((method, path))
        answer = answers.pop(0) if answers else {}
        if isinstance(answer, Exception):
            raise answer
        return answer

    inst.w_client = types.SimpleNamespace(api_client=types.SimpleNamespace(do=do))
    return inst, calls


def test_a_platform_error_is_transient_only_when_trying_again_can_help(agent_ns):
    transient = agent_ns["implement_transient"]
    for error in (BUSY, RuntimeError("429 Too Many Requests"), RuntimeError("Read timed out"),
                  RuntimeError("ConcurrentModificationException: a concurrent update"), RuntimeError("502 Bad Gateway")):
        assert transient(error), error
    for error in (DENIED, RuntimeError("RESOURCE_DOES_NOT_EXIST: app x does not exist"), RuntimeError("INVALID_PARAMETER_VALUE: bad"),
                  agent_ns["ImplementBlocked"]("the App timed out, so build again"), RuntimeError("boom")):
        assert not transient(error), error


def test_the_retry_handler_raises_an_error_its_predicate_rejects_at_once_without_a_log(agent_ns, slept):
    handler, logger, calls = agent_ns["RetryHandler"], CapturingLogger(), []

    def fail():
        calls.append(1)
        raise DENIED

    with pytest.raises(RuntimeError, match="PERMISSION_DENIED"):
        handler.execute_with_retry(fail, max_attempts=3, logger=logger, retry_if=lambda e: False)
    assert calls == [1] and slept == [] and logger.records == []
    answers = [BUSY, BUSY, "done"]

    def flaky():
        answer = answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer

    assert handler.execute_with_retry(flaky, max_attempts=3, logger=logger, retry_if=lambda e: True, base_delay=2.0) == "done"
    assert len(slept) == 2


def test_a_read_or_an_idempotent_call_is_retried_on_a_transient_error_and_a_create_never_is(agent_ns, slept):
    inst, calls = _api(agent_ns, [BUSY, {"name": "desk"}])
    assert inst._implement_api("GET", "/api/2.0/apps/desk") == {"name": "desk"}
    assert calls == [("GET", "/api/2.0/apps/desk")] * 2 and len(slept) == 1
    inst, calls = _api(agent_ns, [BUSY, {}])
    inst._implement_api("POST", "/api/2.0/workspace/delete", {"path": "/W/x", "recursive": True})
    assert len(calls) == 2, "deleting a path twice deletes it once"
    for path in ("/api/2.0/apps", "/api/2.0/lakeview/dashboards", "/api/2.2/jobs/runs/submit", "/api/2.0/entity-tag-assignments"):
        inst, calls = _api(agent_ns, [BUSY, {}])
        with pytest.raises(RuntimeError, match="TEMPORARILY_UNAVAILABLE"):
            inst._implement_api("POST", path, {})
        assert len(calls) == 1, f"a create at {path} is never sent twice"
    inst, calls = _api(agent_ns, [DENIED, {}])
    with pytest.raises(RuntimeError, match="PERMISSION_DENIED"):
        inst._implement_api("PATCH", "/api/2.0/permissions/genie/g1", {})
    assert len(calls) == 1, "a permission error is the user's to fix, so it is not retried"
    inst, calls = _api(agent_ns, [BUSY, BUSY, BUSY])
    with pytest.raises(RuntimeError, match="TEMPORARILY_UNAVAILABLE"):
        inst._implement_api("GET", "/api/2.0/apps/desk")
    assert len(calls) == agent_ns["IMPLEMENT_API_ATTEMPTS"]


def test_a_tag_that_fails_once_on_a_busy_platform_is_tagged_on_the_next_try_with_no_warning(agent_ns, slept):
    inst, calls = _api(agent_ns, [{"tag_assignments": []}, BUSY, {"tag_assignments": [{"tag_key": "x", "tag_value": "y"}]}] + [{}] * 20)
    context = {"uc_id": "N01-U01", "key": (5150, "N01-U01", 3), "notebook_spec": {"job_tags": {"dbx_inspire_ai_business": "acme"}},
               "notebook_path": "/W/nb"}
    assert inst._implement_tag_app(context, "churn-desk") == ""
    posts = [c for c in calls if c[0] == "POST"]
    assert len(posts) >= 2 and len(slept) == 1, "the whole tagging is tried again, and only missing tags are posted"


def test_the_builder_identity_falls_back_to_the_workspace_when_spark_cannot_say(agent_ns):
    def broken(statement, args=None):
        raise RuntimeError("current_user() is not available")

    inst = _inspire(agent_ns, types.SimpleNamespace(sql=broken))
    inst.logger = CapturingLogger()
    inst.w_client = types.SimpleNamespace(current_user=types.SimpleNamespace(me=lambda: types.SimpleNamespace(user_name="ana@example.com")))
    assert inst._implement_builder() == "ana@example.com"
    lost = _inspire(agent_ns, types.SimpleNamespace(sql=broken))
    lost.logger = CapturingLogger()
    lost.w_client = types.SimpleNamespace(current_user=types.SimpleNamespace(me=lambda: (_ for _ in ()).throw(DENIED)))
    assert lost._implement_builder() == ""
    assert "implement_app_admin_warnings" not in agent_ns, "Refresh now belongs to each use case's owners, never to the builder alone"


def test_a_dashboard_page_genie_writes_with_an_html_block_goes_back_to_genie(agent_ns):
    problems = agent_ns["implement_dashboard_html_problems"]
    page = {"blocks": [{"id": "rain", "kind": "html", "content": "<b>Rain</b>"}, {"id": "note", "kind": "text", "content": "Note"}]}
    assert problems(page) == ["block rain is html, which a dashboard text widget cannot draw: write it as a text block in Markdown "
                              "(headings, bold, italics, lists, links and tables) or as an image block"]
    assert problems({"blocks": [{"id": "note", "kind": "text", "content": "Note"}]}) == []


def _version(agent_ns, fields):
    inst, previous = _locked(agent_ns)
    inst._implement_runner = lambda uc: "genie"

    def dashboard(context, runner):
        return dict(fields, dashboard_id="d1", dashboard_url="https://h/d")

    inst._implement_dashboard = dashboard
    status = _run(inst, dict(previous, retry_outputs=["dashboard"]))
    done = [e for e in inst.emitted if e.get("step_name") == "Done"]
    return status, inst.updates[-1], done[-1]


def test_a_part_that_ends_with_only_an_info_note_leaves_the_use_case_ready_and_the_step_green(agent_ns):
    status, final, done = _version(agent_ns, {"_notes": ["Dashboard: this use case is now part of the dashboard d1"]})
    assert status == "ready" and final["status"] == "ready"
    assert final["asset_status"]["dashboard"]["notes"] == ["this use case is now part of the dashboard d1"]
    assert "warnings" not in final["asset_status"]["dashboard"] and "part of the dashboard" not in final["status_message"]
    assert done["status"] == "ended_success"


def test_a_real_warning_still_makes_the_use_case_ready_with_warnings_and_the_step_yellow(agent_ns):
    warning = "Dashboard: the dashboard could not be shared: PERMISSION_DENIED"
    status, final, done = _version(agent_ns, {"_warnings": [warning], "_notes": ["Dashboard: a fact"]})
    assert status == "ready_with_warnings" and final["status"] == "ready_with_warnings"
    assert final["asset_status"]["dashboard"]["warnings"] == ["the dashboard could not be shared: PERMISSION_DENIED"]
    assert final["asset_status"]["dashboard"]["notes"] == ["a fact"] and warning in final["status_message"]
    assert done["status"] == "ended_warning"


def test_an_older_app_version_kept_beside_the_new_one_on_lakebase_is_a_note_not_a_warning(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    asset_status = {"app": {"state": "ready", "spec_version": 3}}
    before = {"app": {"id": "desk-v2", "url": "https://h/a", "title": "Desk", "version": 2, "backend": "lakebase"}}
    warnings = inst._implement_keep_side((5150, "N01-U01", 3), ["app"], before, {"app": "desk-v3"}, asset_status)
    assert warnings == []
    assert asset_status["app"]["notes"] == ["the App of v2 keeps its Lakebase copy as it is now; only the App of v3 is refreshed after "
                                            "each run"]
    assert json.loads(json.dumps(asset_status))["kept"]["assets"][0]["id"] == "desk-v2"
