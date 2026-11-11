import json
import os

import pytest

from v141_app_shell_test import SETTINGS, call
from v144_app_ops_test import JOB, LEE, JobsWorkspace, ops_settings, ops_shell, signed
from v148_app_hub_test import ROWS, hub_page, hub_shell
from v147_value_at_stake_test import _sqlite
from v149_app_money_test import OWNER, SAM, MoneyWorkspace, _summary
from v120_artifacts_support import FakeSpark
import shell_core
import shell_sql

FIXTURE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures", "implement_change_classes.json")
BASE = {"low": None, "high": None, "whole": False, "low_open": False, "high_open": False, "choices": [], "many": False, "unit": "",
        "reason": "Inspire's default", "help": "What it does.", "applies": "run", "source": "widget"}
DECLARED = [
    dict(BASE, name="act_now_amount", label="Money at stake to act now", group="flagging", kind="money", unit="USD", low=0,
         allowed="at least 0", default="800"),
    dict(BASE, name="review_amount", label="Money at stake to review", group="flagging", kind="money", unit="USD", low=0,
         allowed="at least 0", default="200"),
    dict(BASE, name="lookback_days", label="Days of history", group="scope", kind="days", unit="days", low=1, high=365, whole=True,
         allowed="whole number, 1 to 365", default="90"),
    dict(BASE, name="mode", label="Mode", group="scope", kind="choice", choices=["fast", "full"], allowed="", default="full"),
    dict(BASE, name="alert_threshold", label="Alert threshold", group="alerts", kind="number", low=0, allowed="at least 0", default="0",
         applies="alert", source="alert"),
]


class SettingsWorkspace(MoneyWorkspace):
    def __init__(self, summary=None, edits=()):
        super().__init__(summary=summary, assumptions=False)
        self.db.execute('CREATE TABLE "loss_desk_out_assumptions" (use_case_id, name, value, changed_by, changed_at, note, text_value)')
        self.db.executemany('INSERT INTO "loss_desk_out_assumptions" VALUES (?, ?, ?, ?, ?, ?, ?)', list(edits))


def _shell(tmp_path, ws=None, settings=None, declared=DECLARED):
    page = hub_page(records={"title": "Things to fix", "key": "entity_id", "label": "entity_label", "rank": "rank", "tier": "priority_tier",
                             "columns": [{"column": "value_at_stake", "label": "Could save", "format": "currency", "currency": "USD"}]})
    if declared is not None:
        page["settings"] = json.loads(json.dumps(declared))
    return hub_shell(tmp_path, settings=settings or dict(SETTINGS, options={"modify": False, "replace_edits": False, "decisions": True},
                                                        use_case_owners={"n01_u05": [OWNER]}),
                     pages=[page], ws=ws or SettingsWorkspace())


def _save(s, who, **body):
    return call(s, "POST", "settings/save", headers={"x-forwarded-email": who} if who else {}, body=dict(body, page="n01_u05"))


def test_the_owner_sees_every_setting_grouped_with_its_value_bounds_and_where_it_applies(tmp_path):
    s, _ws, _made = _shell(tmp_path)
    status, out = call(s, "GET", "settings", query={"page": "n01_u05"}, headers={"x-forwarded-email": OWNER})
    assert status == 200 and out["editable"] is True and out["why"] == "" and out["history"] == []
    assert [(x["name"], x["group"]) for x in out["settings"]] == [
        ("PRICE", "impact"), ("KEEP", "impact"), ("minutes_per_record", "impact"), ("act_now_amount", "flagging"), ("review_amount", "flagging"),
        ("lookback_days", "scope"), ("mode", "scope"), ("alert_threshold", "alerts"), ("kpi_target_value", "measurement")]
    by_name = {x["name"]: x for x in out["settings"]}
    assert (by_name["PRICE"]["kind"], by_name["PRICE"]["unit"], by_name["PRICE"]["low"], by_name["PRICE"]["value"]) == ("money", "USD", 0.0, "20")
    assert (by_name["KEEP"]["kind"], by_name["KEEP"]["high"], by_name["KEEP"]["applies"]) == ("percent", 1.0, "app_and_run")
    assert by_name["act_now_amount"]["value"] == "800" and by_name["act_now_amount"]["editable"] is True
    assert by_name["alert_threshold"]["editable"] is False, "the alert threshold is changed on the Build page, which rebuilds the alert"


def test_a_non_owner_gets_no_settings_menu_and_cannot_save_or_preview(tmp_path):
    s, ws, _made = _shell(tmp_path)
    out = call(s, "GET", "settings", query={"page": "n01_u05"}, headers={"x-forwarded-email": SAM})[1]
    assert out == {"settings": [], "history": [], "editable": False, "why": "Only the owners of this use case can change its settings",
                   "can_run": False}
    assert len(ws.queries("FROM `main`.`pricing`.`loss_desk_out_assumptions`")) <= 1, "a viewer's page load reads the saved money rule once, nothing for the menu"
    assert _save(s, SAM, name="act_now_amount", value="1000", was="800") == (403, {"error": "Only the owners of this use case can change its settings"})
    status, body = call(s, "POST", "settings/preview", headers={"x-forwarded-email": SAM},
                        body={"page": "n01_u05", "name": "act_now_amount", "value": "1000"})
    assert status == 403 and not ws.queries("INSERT INTO")
    assert _save(s, None, name="act_now_amount", value="1000", was="800")[0] == 403


@pytest.mark.parametrize("body,status,error", [
    ({"name": "lookback_days", "value": "400", "was": "90"}, 400, "lookback_days is '400'; allowed: whole number, 1 to 365"),
    ({"name": "lookback_days", "value": "30.5", "was": "90"}, 400, "lookback_days is '30.5'; allowed: whole number, 1 to 365"),
    ({"name": "act_now_amount", "value": "-5", "was": "800"}, 400, "act_now_amount is '-5'; allowed: at least 0"),
    ({"name": "review_amount", "value": "900", "was": "200"}, 400,
     "review_amount is 900, above act_now_amount 800; a record needs at least as much at stake to act on now as to review"),
    ({"name": "mode", "value": "slow", "was": "full"}, 400, "mode is 'slow'; allowed: fast, full"),
    ({"name": "alert_threshold", "value": "3", "was": "0"}, 409,
     "Alert threshold is changed on the Build page of the Inspire App until the alert is built again to read the App's settings"),
    ({"name": "GONE", "value": "3", "was": "0"}, 400, "this use case has no setting 'GONE'"),
    ({"name": "act_now_amount", "value": "1000", "was": "700"}, 409, "act_now_amount changed to 800 since you opened it; check it and save again"),
    ({"name": "act_now_amount", "value": "800", "was": "800"}, 400, "act_now_amount is already 800"),
    ({"name": "act_now_amount", "value": True, "was": "800"}, 400, "send value as text or a number"),
    ({"name": "PRICE", "value": -1, "was": 20}, 400, "PRICE is '-1'; allowed: at least 0"),
])
def test_a_setting_out_of_its_bounds_or_against_another_is_refused_and_nothing_is_written(tmp_path, body, status, error):
    s, ws, _made = _shell(tmp_path)
    got_status, got = _save(s, OWNER, **body)
    assert got_status == status and got["error"].startswith(error), got
    assert not ws.queries("INSERT INTO")


def test_a_saved_setting_is_the_value_the_app_shows_with_who_changed_it(tmp_path):
    s, ws, _made = _shell(tmp_path)
    status, out = _save(s, OWNER, name="act_now_amount", value="1000", was="800", note=" busier quarter ")
    assert status == 200, out
    (sql, params), = ws.queries("INSERT INTO `main`.`pricing`.`loss_desk_out_assumptions`")
    assert "`text_value`" not in sql and [p["value"] for p in params] == ["N01-U05", "act_now_amount", "1000.0", OWNER, "busier quarter"]
    by_name = {x["name"]: x for x in out["settings"]}
    assert by_name["act_now_amount"]["value"] == "1000"
    assert [(h["name"], h["value"], h["changed_by"], h["note"]) for h in out["history"]] == [("act_now_amount", 1000.0, OWNER, "busier quarter")]
    status, out = _save(s, OWNER, name="mode", value="fast", was="full")
    assert status == 200 and {x["name"]: x for x in out["settings"]}["mode"]["value"] == "fast"
    sql, params = ws.queries("INSERT INTO")[-1]
    assert "`text_value`" in sql and params[-1]["value"] == "fast"
    status, out = _save(s, OWNER, name="PRICE", value=24, was=20)
    assert status == 200 and {x["name"]: x for x in out["settings"]}["PRICE"]["value"] == "24", "an assumption saves through the money panel's path"


def _current(rows):
    return [r for r in rows if r["is_current"] and r["change_source"] != "delete"]


def test_the_preview_count_matches_what_the_next_run_writes(tmp_path, agent_ns):
    s, _ws, _made = _shell(tmp_path)
    status, out = call(s, "POST", "settings/preview", headers={"x-forwarded-email": OWNER},
                       body={"page": "n01_u05", "name": "act_now_amount", "value": "1000"})
    assert status == 200 and out["exact"] is True
    assert out["moves"] == [{"from": "Act now", "to": "Review", "n": 2}]
    assert out["text"] == "If the next run used this value, 2 records from Act now to Review would move."
    rows = _current(ROWS)
    value = {"basis": "measured", "currency": "USD", "amounts": {"act_now_amount": "1000", "review_amount": "200"}}
    columns = list(rows[0])
    profile = lambda frame: _sqlite(agent_ns["inspire_run_profile_sql"]("c.s.stage", columns, value), frame)
    assert profile(rows)["off_tier"] == sum(m["n"] for m in out["moves"]), "the run refuses exactly the rows the preview moves"
    rule = lambda stake: "Act now" if stake >= 1000 else "Review" if stake >= 200 else "Monitor"
    assert profile([dict(r, priority_tier=rule(r["value_at_stake"])) for r in rows])["off_tier"] == 0
    lower = call(s, "POST", "settings/preview", headers={"x-forwarded-email": OWNER},
                 body={"page": "n01_u05", "name": "act_now_amount", "value": "250"})[1]
    assert lower["moves"] == [{"from": "Review", "to": "Act now", "n": 1}]
    priced = call(s, "POST", "settings/preview", headers={"x-forwarded-email": OWNER}, body={"page": "n01_u05", "name": "PRICE", "value": 40})[1]
    assert priced["moves"] == [{"from": "Monitor", "to": "Review", "n": 1}], "a dearer assumption doubles every record's money at once"
    refused = call(s, "POST", "settings/preview", headers={"x-forwarded-email": OWNER},
                   body={"page": "n01_u05", "name": "act_now_amount", "value": "-1"})
    assert refused[0] == 400


def test_a_prediction_is_previewed_by_the_next_run(tmp_path):
    s, _ws, _made = _shell(tmp_path, SettingsWorkspace(summary=_summary(decision_basis="predicted")))
    out = call(s, "POST", "settings/preview", headers={"x-forwarded-email": OWNER},
               body={"page": "n01_u05", "name": "lookback_days", "value": "30"})[1]
    assert out == {"exact": False, "moves": [], "text": shell_core.PREVIEW_AT_RUN}


def test_run_now_starts_the_job_for_an_owner_refuses_anyone_else_and_waits_for_the_active_run(tmp_path):
    s, sp, _now = ops_shell(tmp_path, JobsWorkspace())
    assert call(s, "POST", "settings/run", headers=signed(LEE), body={"page": "n01_u05"}) == (
        403, {"error": "Only the owners of this use case can run it now"})
    assert sp.jobs_calls("run-now") == []
    owner = ops_settings()["admin"]
    status, out = call(s, "POST", "settings/run", headers=signed(owner), body={"page": "n01_u05"})
    assert status == 200 and out == {"run_id": "9000", "state": "queued"}
    assert sp.jobs_calls("run-now") == [("run-now", JOB, {"refresh_requested_by": owner})]
    status, out = call(s, "POST", "settings/run", headers=signed(owner), body={"page": "n01_u05"})
    assert status == 409 and "already waiting to run" in out["error"] and len(sp.started) == 1


def test_a_page_without_settings_or_money_shows_no_settings_and_its_spec_is_unchanged(tmp_path):
    quiet = dict(SETTINGS, options={"modify": False, "replace_edits": False, "decisions": False}, use_case_owners={"n01_u05": [OWNER]})
    s, ws, _made = _shell(tmp_path / "quiet", SettingsWorkspace(summary=False), declared=None, settings=quiet)
    out = call(s, "GET", "settings", query={"page": "n01_u05"}, headers={"x-forwarded-email": OWNER})[1]
    assert [x["name"] for x in out["settings"]] == ["kpi_target_value"], "a page with KPIs has the KPI target to set"
    assert out["editable"] is True and out["why"] == "" and out["job"] is False
    status, refused = _save(s, OWNER, name="minutes_per_record", value="6", was="")
    assert status == 400 and not ws.queries("INSERT INTO"), refused
    s, _ws, _made = _shell(tmp_path / "acting", SettingsWorkspace(summary=False), declared=None)
    out = call(s, "GET", "settings", query={"page": "n01_u05"}, headers={"x-forwarded-email": OWNER})[1]
    assert [x["name"] for x in out["settings"]] == ["minutes_per_record", "kpi_target_value"] and out["editable"] is True, \
        "a page that keeps actions has My work"
    plain = hub_page()
    assert shell_sql.page_settings_problems(plain.get("settings")) == []
    assert "settings" not in plain
    bad = [{"name": "x y", "group": "impact"}, dict(DECLARED[0], group="money"), dict(DECLARED[0], name="b", low="ten", choices=[1])]
    assert shell_sql.page_settings_problems(bad) == [
        "page setting 1 needs a name of its own, of letters, digits and _", "setting act_now_amount: group must be one of impact, flagging, scope, alerts",
        "setting b: low must be a number or null", "setting b: choices must be a list of text"]


def test_the_app_checks_settings_exactly_as_the_run_does(agent_ns):
    fixture = json.load(open(FIXTURE))
    for case in fixture["setting_values"]:
        assert shell_sql.setting_problem(case["setting"], case["value"]) == case["problem"], case
    tables = fixture["contract_tables"]
    assert list(shell_sql.SETTING_GROUPS) == tables["INSPIRE_SETTING_GROUPS"]
    assert list(shell_sql.SETTING_KINDS) == tables["INSPIRE_SETTING_KINDS"]
    assert shell_sql.SETTING_ALL == tables["INSPIRE_SETTING_ALL"]
    assert {k: list(v) for k, v in shell_sql.ASSUMPTION_BOUNDS.items()} == tables["INSPIRE_ASSUMPTION_BOUNDS"]
    assert set(shell_sql.SETTING_SOURCES) == set(tables["INSPIRE_SETTING_SOURCES"]) - {"assumption"}
    for values in ({"act_now_share": "0.6", "review_share": "0.5"}, {"act_now_amount": "10", "review_amount": "20"},
                   {"min_rows": "9", "max_rows": "3"}, {"act_now_share": "0.2", "review_share": "0.3"}):
        assert shell_sql.setting_set_problems(values) == agent_ns["genie_widget_set_problems"](values), values


CAPACITY = dict(BASE, name="act_now_capacity", label="Team capacity", group="flagging", kind="integer", unit="records", low=1, whole=True,
                optional=True, allowed="a whole number, at least 1, or empty for no cap", default="40", reason="chosen when the use case was built")


def test_a_team_capacity_cleared_for_no_cap_reloads_as_no_cap_the_way_the_next_run_reads_it(tmp_path, fresh_ns):
    s, ws, _made = _shell(tmp_path, declared=DECLARED + [CAPACITY])
    status, out = _save(s, OWNER, name="act_now_capacity", value="", was="40", note="no cap this quarter")
    assert status == 200, out
    (sql, params), = ws.queries("INSERT INTO `main`.`pricing`.`loss_desk_out_assumptions`")
    assert "CAST(NULL AS DOUBLE)" in sql
    for view in (out, call(s, "GET", "settings", query={"page": "n01_u05"}, headers={"x-forwarded-email": OWNER})[1]):
        capacity = {x["name"]: x for x in view["settings"]}["act_now_capacity"]
        assert (capacity["value"], capacity["saved"]) == ("", True), capacity
    assert _save(s, OWNER, name="act_now_capacity", value="", was="")[1] == {"error": "act_now_capacity is already empty"}
    assert _save(s, OWNER, name="act_now_capacity", value="25", was="40")[0] == 409, "the shown value is no cap, not the built 40"
    model = fresh_ns["inspire_settings_model"]({"family": "A", "decision_basis": "predicted", "act_now_capacity": 40}, [])
    scope = {"INSPIRE_RUN": {"settings": fresh_ns["inspire_run_settings_model"](model), "act_now_capacity": 40, "settings_read": True}}
    saved = [{"name": r[1], "value": r[2], "text_value": r[6], "changed_by": r[3], "changed_at": r[4]}
             for r in ws.db.execute('SELECT * FROM "loss_desk_out_assumptions"').fetchall()]
    assert [r["value"] for r in saved] == [None]

    def respond(statement):
        return saved if "ROW_NUMBER() OVER (PARTITION BY name" in statement else []

    fresh_ns["inspire_apply_assumptions"](FakeSpark(responder=respond), "main.pricing.loss_desk_out", "N01-U05", scope=scope, out=lambda m: None)
    assert fresh_ns["inspire_act_now_capacity"](scope=scope) is None, "the run reads the same saved row as no cap"
    status, out = _save(s, OWNER, name="act_now_capacity", value="25", was="")
    assert status == 200 and {x["name"]: x for x in out["settings"]}["act_now_capacity"]["value"] == "25"


def test_a_page_setting_that_repeats_an_earlier_name_is_named_as_a_repeat():
    first = dict(DECLARED[0])
    assert shell_sql.page_settings_problems([first, dict(first, label="Maximum Act now records")]) == [
        f"page setting 2 repeats the name {first['name']} of an earlier setting; each setting needs a name of its own"]
