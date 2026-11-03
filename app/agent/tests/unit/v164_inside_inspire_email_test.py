"""The weekly impact email never keeps a stale link to the page: a new Inspire address, a move into or out of Inspire, or a new App
address rewrites only the email's link line in place, with no alert rebuild, offline."""
import json
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_alerts  # noqa: E402
import shell_sql  # noqa: E402
from v120_artifacts_support import FakeSpark  # noqa: E402
from v140_implement_test import ALERT, _inspire, _output_context  # noqa: E402
from v143_vibes_test import _run  # noqa: E402
from v164_inside_inspire_deploy_test import ID, OWN, _hosted_locked  # noqa: E402

URL_A, URL_B = "https://inspire.example.com", "https://inspire-2.example.com"
DIGEST = "dg-7"
RUN_TAB = "Open this use case's page in Inspire's Run tab"
SHELL = {"shell_sql": shell_sql, "shell_alerts": shell_alerts}


def _email(ns, app_url="", hosted=ID, url=""):
    return ns["implement_digest_body"](SHELL, "N01-U01", {"Name": "Predict churn"}, "SELECT 1", "wh1", [{"user_name": "owner@example.com"}],
                                       {}, app_url, hosted, url)["custom_description"]


def _relinking(ns, tmp_path, monkeypatch, before, after, text, carried_app=None, live_app=None):
    inst, previous = _hosted_locked(ns, tmp_path, monkeypatch)
    inst.dashboards = []
    inst._implement_dashboard = lambda context, runner: inst.dashboards.append(context["spec"]["outputs"]["inspire_url"]) or {
        "dashboard_id": "d1", "dashboard_url": "https://h/d"}
    old = dict(previous, outputs={**previous["outputs"], **before})
    inst._implement_previous = lambda target: {"spec_version": 2, "spec_json": old}
    carried, live = inst._implement_carried(None)
    carried.update(carried_app or {})
    live["alert"] = dict(live["alert"], digest_id=DIGEST)
    if live_app is not None:
        live["app"] = live_app
    inst._implement_carried = lambda target, through_own=False: (dict(carried), json.loads(json.dumps(live)))
    alert, patched = {"id": DIGEST, "custom_description": text, "lifecycle_state": "ACTIVE"}, []

    def api(method, path, body=None, query=None):
        inst.calls.append((method, path, body))
        if (method, path) == ("GET", f"/api/2.0/alerts/{DIGEST}"):
            return dict(alert)
        if (method, path) == ("PATCH", f"/api/2.0/alerts/{DIGEST}"):
            patched.append((body, query))
            alert.update(body)
        return {}

    inst._implement_api = api
    status = _run(inst, dict(old, outputs={**old["outputs"], **after}))
    return inst, status, patched, alert


def _asset_tags_only(call):
    method, path, body = call
    return (method, path) == ("GET", "/api/2.2/jobs/get") or (
        (method, path) == ("POST", "/api/2.2/jobs/update") and set((body or {}).get("new_settings") or {}) <= {"tags"}
        and set((body or {}).get("fields_to_remove") or []) <= {"tags"})


def _rebuilt(inst):
    return [c[:2] for c in inst.calls if c[:2] == ("POST", "/api/2.0/alerts") or ("/jobs/" in c[1] and not _asset_tags_only(c))]


def test_a_new_inspire_address_refreshes_the_app_and_rewrites_only_the_link_line_of_the_email(agent_ns, tmp_path, monkeypatch):
    inst, status, patched, alert = _relinking(agent_ns, tmp_path, monkeypatch, {"inspire_url": URL_A}, {"inspire_url": URL_B},
                                              _email(agent_ns, url=URL_A))
    assert status in ("ready", "ready_with_warnings")
    assert patched == [({"custom_description": _email(agent_ns, url=URL_B)}, {"update_mask": "custom_description"})]
    lines = alert["custom_description"].split("\n")
    assert f"{RUN_TAB}: {URL_B}/?run={ID}" in lines and not any(URL_A in line for line in lines), "the next email links to the new address"
    assert _rebuilt(inst) == [], "the alert is not rebuilt and its job is not touched"
    plan = json.loads(next(u for u in inst.updates if u.get("status") == "filling")["status_message"].split("plan: ", 1)[1])
    assert plan["relink"] == ["alert"] and plan["build"] == [] and plan["refill"] is False
    assert plan["refresh"] == ["dashboard", "app"], "the page and the dashboard link to the Review page of the new address"
    assert inst.dashboards == [URL_B]


def test_a_blank_inspire_address_is_refused_before_the_email_is_read(agent_ns, tmp_path, monkeypatch):
    inst, previous = _hosted_locked(agent_ns, tmp_path, monkeypatch)
    old = dict(previous, outputs={**previous["outputs"], "inspire_url": URL_A})
    inst._implement_previous = lambda target: {"spec_version": 2, "spec_json": old}
    with pytest.raises(agent_ns["ImplementBlocked"]) as refused:
        _run(inst, dict(old, outputs={**old["outputs"], "inspire_url": ""}))
    assert agent_ns["IMPLEMENT_APP_HOSTED_ERRORS"]["inspire_url"] in str(refused.value)
    assert inst.calls == [], "nothing is read or written for a spec Inspire refuses"


def test_an_unchanged_address_never_reads_or_writes_the_email(agent_ns, tmp_path, monkeypatch):
    inst, status, patched, _alert = _relinking(agent_ns, tmp_path, monkeypatch, {"inspire_url": URL_A},
                                               {"inspire_url": URL_A, "app_owners": ["owner@example.com"]}, _email(agent_ns, url=URL_A))
    assert patched == [] and not any(path == f"/api/2.0/alerts/{DIGEST}" for _m, path, _b in inst.calls)
    assert inst.dashboards == [], "the same address leaves the dashboard as it is"
    assert status in ("ready", "ready_with_warnings")


def test_a_move_into_inspire_replaces_the_app_link_of_the_email_once_the_page_is_built(agent_ns, tmp_path, monkeypatch):
    own = {**OWN, "app_placement": "use_case", "app_name": "churn-desk", "inspire_url": URL_A}
    app_url = "https://churn-desk-5150.example.com"
    inst, status, patched, alert = _relinking(
        agent_ns, tmp_path, monkeypatch, own, {"app_placement": "inspire", "app_name": "", "inspire_url": URL_A},
        _email(agent_ns, app_url=app_url, hosted=""), carried_app={"app_name": "churn-desk", "app_url": app_url},
        live_app={"state": "ready", "spec_version": 2, "backend": "delta"})
    assert status in ("ready", "ready_with_warnings")
    plan = json.loads(next(u for u in inst.updates if u.get("status") == "filling")["status_message"].split("plan: ", 1)[1])
    assert plan["build"] == ["app"] and plan["relink"] == [], "the address did not change; the move alone rewrites the link"
    assert inst.dashboards == [], "a move of the App leaves the dashboard as it is"
    lines = alert["custom_description"].split("\n")
    assert f"{RUN_TAB}: {URL_A}/?run={ID}" in lines and not any("churn-desk-5150" in line for line in lines)
    assert len(patched) == 1, "the link line is rewritten once, after the page is built"


def test_an_app_of_its_own_gets_its_new_address_in_the_email_in_place_of_the_run_tab_line(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    context = _output_context(agent_ns, **ALERT, **OWN)
    context.update(asset_status={"alert": {"digest_id": DIGEST}}, urls={"app_url": "https://churn-desk-5150.example.com/"})
    seen = []

    def api(method, path, body=None, query=None):
        seen.append((method, path, body, query))
        return {"custom_description": _email(agent_ns, url=URL_A)}

    inst._implement_api = api
    assert inst._implement_digest_relink(context) == []
    body, query = seen[-1][2:]
    assert (seen[-1][0], query) == ("PATCH", {"update_mask": "custom_description"})
    assert body == {"custom_description": _email(agent_ns, app_url="https://churn-desk-5150.example.com", hosted="")}


def test_only_inspire_s_link_line_changes_and_an_email_inspire_did_not_write_is_left_alone(agent_ns):
    relinked = agent_ns["implement_digest_relinked"]
    text = _email(agent_ns, app_url="https://old.example.com", hosted="")
    lines = relinked(text, f"{RUN_TAB}: {URL_A}/?run={ID}").split("\n")
    assert lines[:-2] == text.split("\n")[:-2], "every other line stays as it was"
    assert lines[-2:] == [f"{RUN_TAB}: {URL_A}/?run={ID}", "{{QUERY_RESULT_TABLE}}"]
    assert relinked(text, "") == "\n".join(line for line in text.split("\n") if not line.startswith("Open the Impact page")), \
        "with no page to link to, the line goes"
    unlinked = "\n".join(line for line in text.split("\n") if not line.startswith("Open the Impact page"))
    hosted = f"{RUN_TAB}: {URL_A}/?run={ID}"
    assert relinked(unlinked, hosted).split("\n")[-2] == hosted, "a missing line is added before the result table"
    assert relinked("Someone's own text", hosted) == "Someone's own text"


def test_the_relink_step_skips_an_email_it_cannot_read_and_says_so_when_it_cannot_write(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    context = _output_context(agent_ns, **ALERT, **OWN, app_placement="inspire", inspire_url=URL_A)
    context["asset_status"] = {"alert": {"digest_id": DIGEST}}
    for answer in ({"custom_description": "Someone's own text"}, {"lifecycle_state": "TRASHED", "custom_description": _email(agent_ns)},
                   RuntimeError("RESOURCE_DOES_NOT_EXIST: alert dg-7")):
        calls = []

        def api(method, path, body=None, query=None, answer=answer):
            calls.append((method, path))
            if isinstance(answer, Exception):
                raise answer
            return dict(answer)

        inst._implement_api = api
        assert inst._implement_digest_relink(context) == [] and calls == [("GET", f"/api/2.0/alerts/{DIGEST}")], answer

    def refusing(method, path, body=None, query=None):
        if method == "PATCH":
            raise RuntimeError("PERMISSION_DENIED: no CAN MANAGE on alert dg-7")
        return {"custom_description": _email(agent_ns, url="")}

    inst._implement_api = refusing
    warned = inst._implement_digest_relink(context)
    assert len(warned) == 1 and warned[0].startswith("Alert: the weekly impact email keeps the link it had, because Inspire could not "
                                                     "update its text:")


def test_the_weekly_email_links_with_a_query_a_sign_in_keeps_and_never_with_a_fragment_a_sign_in_can_drop(agent_ns):
    line = agent_ns["implement_digest_page_line"]
    assert line("", ID, URL_A) == f"{RUN_TAB}: {URL_A}/?run={ID}"
    assert line("", "a b/c?d#e", URL_A) == f"{RUN_TAB}: {URL_A}/?run=a%20b%2Fc%3Fd%23e", "the page id is URL-encoded"
    assert line("https://desk.example.com/", "", "") == "Open the Impact page of the App: https://desk.example.com/?open=impact"
    assert line("", ID, "") == "" and line("", "", "") == "", "with no Inspire address there is no Run tab to link to"
    for text in (_email(agent_ns, url=URL_A), _email(agent_ns, app_url="https://desk.example.com", hosted="")):
        links = [part for part in text.split() if part.startswith("https://")]
        assert len(links) == 1 and "#" not in links[0], links


def _alert_steps(inst):
    return [(e["step_name"], e["status"], e["message"]) for e in inst.emitted if e.get("step_name") == "Alert"]


def test_a_relink_shows_as_an_alert_step_with_the_plan_text_the_app_mirrors(agent_ns, tmp_path, monkeypatch):
    plan_text = agent_ns["IMPLEMENT_DIGEST_RELINK_PLAN"]
    assert plan_text == "point the weekly impact email at the new Inspire address"
    inst, _status, patched, _alert = _relinking(agent_ns, tmp_path, monkeypatch, {"inspire_url": URL_A}, {"inspire_url": URL_B},
                                                _email(agent_ns, url=URL_A))
    assert len(patched) == 1
    steps = _alert_steps(inst)
    assert steps[0] == ("Alert", "started", plan_text)
    assert steps[-1] == ("Alert", "ended_success", f"the weekly impact email now reads {RUN_TAB}: {URL_B}/?run={ID}")
    plan_line = next(e["message"] for e in inst.emitted if e.get("step_name") == "Plan")
    assert f"; {plan_text}" in plan_line


def test_a_relink_that_cannot_write_the_email_ends_its_alert_step_with_the_warning(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    context = _output_context(agent_ns, **ALERT, **OWN)
    context.update(asset_status={"alert": {"digest_id": DIGEST}}, urls={"app_url": "https://churn-desk-5150.example.com/"})

    def api(method, path, body=None, query=None):
        if method == "PATCH":
            raise RuntimeError("PERMISSION_DENIED: no CAN MANAGE on the alert")
        return {"custom_description": _email(agent_ns, url=URL_A)}

    inst._implement_api = api
    warnings = inst._implement_digest_relink(context)
    assert len(warnings) == 1 and warnings[0].startswith("Alert: the weekly impact email keeps the link it had, because Inspire could not update "
                                                         "its text: ") and "Can manage" in warnings[0]
    assert _alert_steps(inst) == [("Alert", "started", agent_ns["IMPLEMENT_DIGEST_RELINK_PLAN"]), ("Alert", "ended_warning", warnings[0])]


def test_a_relink_with_nothing_to_change_still_closes_its_alert_step(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    context = _output_context(agent_ns, **ALERT, **OWN)
    app_url = "https://churn-desk-5150.example.com"
    context.update(asset_status={"alert": {"digest_id": DIGEST}}, urls={"app_url": app_url})
    inst._implement_api = lambda method, path, body=None, query=None: {"custom_description": _email(agent_ns, app_url=app_url, hosted="")}
    assert inst._implement_digest_relink(context) == []
    assert _alert_steps(inst)[-1] == ("Alert", "ended_success", "the weekly impact email already has the right link")
