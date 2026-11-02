from _agentload import agent_source
from v120_artifacts_support import FakeSpark
from v140_implement_test import ALERT, VALID, _alert_inspire, _calls_to, _inspire, _output_context, _spec
from v141_app_shell_test import call
from v149_app_alerts_test import ME, WATCH, alerts_shell, save
from v164_vibe_checklist_test import SEVEN, _alert_shown, _ask, _judge

import shell_alerts

QUIET = "Do not email me when it recovers"
CLEARS_OFF = {"kind": "clears", "value": "off"}
SENDS = "When it clears: you get one more email when it returns to OK."
SILENT = "When it clears: it sends no email, and you hear from it again only the next time it fires."


def test_a_person_turns_off_the_email_an_app_alert_sends_when_it_clears_and_an_edit_keeps_it(tmp_path):
    s, ws = alerts_shell(tmp_path)
    assert save(s)[0] == 200
    assert save(s, name="Quiet one", notify_on_ok=False)[0] == 200
    loud, quiet = ws.posted()
    assert loud["evaluation"]["notification"]["notify_on_ok"] is True and SENDS in loud["custom_description"]
    assert quiet["evaluation"]["notification"]["notify_on_ok"] is False and SILENT in quiet["custom_description"]
    assert shell_alerts.read_meta(quiet["query_text"])["notify_on_ok"] is False
    rows = {a["name"]: a for a in call(s, "GET", "alerts", {"page": "n01_u05"}, headers=ME)[1]["alerts"]}
    assert (rows["Category A grows"]["notify_on_ok"], rows["Quiet one"]["notify_on_ok"]) == (True, False)
    quiet_id = rows["Quiet one"]["id"]
    status, out = save(s, id=quiet_id, name="Quiet one", watch=dict(WATCH, threshold=3))
    assert status == 200 and ws.alerts[quiet_id]["evaluation"]["notification"]["notify_on_ok"] is False, \
        "an edit that does not say otherwise keeps what the person chose"
    assert save(s, id=quiet_id, name="Quiet one", notify_on_ok=True)[0] == 200
    assert ws.alerts[quiet_id]["evaluation"]["notification"]["notify_on_ok"] is True and SENDS in ws.alerts[quiet_id]["custom_description"]
    status, out = save(s, name="Bad", notify_on_ok="no")
    assert status == 400 and out["error"].startswith("notify_on_ok takes true or false")


def test_the_build_time_alert_and_an_app_alert_get_their_notification_block_from_the_same_builder(agent_ns, tmp_path, monkeypatch):
    built = []
    real = shell_alerts.alert_body
    monkeypatch.setattr(shell_alerts, "alert_body", lambda *a, **k: built.append(k.get("notify_on_ok", a[12] if len(a) > 12 else None)) or real(*a, **k))
    inst, calls, _q = _alert_inspire(agent_ns, tmp_path)
    inst._implement_alert(_output_context(agent_ns, **ALERT), None)
    [(alert, _q2)] = _calls_to(calls, "POST", "/api/2.0/alerts")
    assert alert["evaluation"]["notification"] == {"notify_on_ok": True, "retrigger_seconds": 60, "subscriptions": []}
    assert SENDS in alert["custom_description"]
    s, ws = alerts_shell(tmp_path / "app")
    assert save(s)[0] == 200
    assert built == [True, True], "both alerts were built by shell_alerts.alert_body"
    assert set(alert["evaluation"]["notification"]) - {"retrigger_seconds"} == set(ws.posted()[0]["evaluation"]["notification"])
    assert "paused=True, notify_on_ok=notify_on_ok," in agent_source(), "the notebook names the flag it hands the builder"


def test_the_setting_turns_the_build_time_email_when_it_clears_off(agent_ns, tmp_path):
    inst, calls, _q = _alert_inspire(agent_ns, tmp_path)
    context = _output_context(agent_ns, **ALERT, alert_notify_on_ok=False)
    inst._implement_alert(context, None)
    [(alert, _q2)] = _calls_to(calls, "POST", "/api/2.0/alerts")
    assert alert["evaluation"]["notification"]["notify_on_ok"] is False and SILENT in alert["custom_description"]
    assert context["artifacts"]["alert"]["clears"] is False
    spec, errors = _spec(agent_ns, outputs={**VALID["outputs"], **ALERT, "alert_notify_on_ok": "nope"})
    assert any(e.startswith("outputs.alert_notify_on_ok must be true or false") for e in errors), errors
    assert _spec(agent_ns, outputs={**VALID["outputs"], **ALERT, "alert_notify_on_ok": False})[0]["outputs"]["alert_notify_on_ok"] is False
    assert "alert_notify_on_ok" not in _spec(agent_ns, outputs={**VALID["outputs"], **ALERT})[0]["outputs"], "absent means on, and is not stored"
    changes = agent_ns["_implement_option_changes"]
    on = dict(VALID["outputs"], **ALERT)
    assert changes(on, dict(on, alert_notify_on_ok=False)) == ["alert"], "turning it off rebuilds the alert"
    assert changes(dict(on, alert_notify_on_ok=False), on) == ["alert"], "turning it back on rebuilds the alert"
    assert changes(on, dict(on, alert_notify_on_ok=True)) == [], "sending the default is no change"


def test_a_vibe_that_says_do_not_email_when_it_recovers_wins_over_the_setting_and_the_checklist_checks_it(agent_ns, tmp_path):
    assert agent_ns["implement_vibes_check"](CLEARS_OFF) == CLEARS_OFF, "the split may name the ask as a clears check"
    assert '{"kind": "clears", "value": "on or off"} for whether an alert sends one more email when it returns to OK' in \
        agent_ns["implement_vibes_split_prompt"]("alert", QUIET)
    notify = agent_ns["implement_alert_notify_on_ok"]
    assert notify({"alert_notify_on_ok": True}, [_ask(QUIET, CLEARS_OFF)]) is False, "the vibe wins over the setting"
    assert notify({"alert_notify_on_ok": False}, [_ask("Email me again when it clears", {"kind": "clears", "value": "on"})]) is True
    assert notify({}, [_ask("Send it to ops", {"kind": "recipient", "value": "ops@example.com"})]) is True
    assert notify({"alert_notify_on_ok": False}, []) is False
    inst, calls, _q = _alert_inspire(agent_ns, tmp_path)
    inst._implement_alert_asks = lambda context, vibes: [_ask(QUIET, CLEARS_OFF)]
    context = _output_context(agent_ns, **ALERT)
    inst._implement_alert(context, None)
    [(alert, _q2)] = _calls_to(calls, "POST", "/api/2.0/alerts")
    assert alert["evaluation"]["notification"]["notify_on_ok"] is False and SILENT in alert["custom_description"]
    checker = _inspire(agent_ns, FakeSpark())
    _judge(checker, {QUIET: [_ask(QUIET, CLEARS_OFF)]}, [])
    met = checker._implement_vibes_checks({}, "alert", QUIET, _alert_shown_clears(agent_ns, False))[0]
    assert (met["status"], met["evidence"]) == ("done", "Sends no email when it returns to OK")
    missed = checker._implement_vibes_checks({}, "alert", QUIET, _alert_shown_clears(agent_ns, True))[0]
    assert missed["status"] == "missing" and missed["evidence"] == "the built Alert sends one more email when it returns to OK, not what was asked"
    assert "Inspire itself sets whether the" in agent_source() and "an ask about that needs nothing in your query" in agent_source(), \
        "Genie is told the ask is Inspire's, so it never reports it not done"


def _alert_shown_clears(agent_ns, clears):
    shown = _alert_shown(agent_ns, SEVEN)
    shown["clears"] = clears
    return shown
