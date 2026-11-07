import copy
import json

import pytest

from v120_artifacts_support import FakeSpark
from v120_genie_support import build_inspire, make_uc
from v140_implement_test import ALERT, VALID, _alert_inspire, _FileRunner, _inspire, _output_context
from v147_value_at_stake_test import COLUMNS, _outcome_spark, _sqlite
from v149_money_assumptions_test import FORMULA, SCHEMA, TABLE, _latest, _value

INSTRUCTION = ("## 3. Parameters\n| widget | type | default | allowed | used for |\n|---|---|---|---|---|\n"
               "| `act_now_share` | text | `0.05` | 0 to 1 | Share of rows to act on now |\n"
               "| `review_share` | text | `0.2` | 0 to 1 | Share of rows to review next |\n")
SPEC_NB = {"family": "A", "decision_basis": "predicted", "result_table": "main.inspire.churn_out", "model_name": "main.inspire.churn",
           "job_slug": "predict_churn", "ai_endpoint": "databricks-claude", "horizon": None, "season_length": None,
           "thresholds": {"min_class_rate": 0.01, "max_class_rate": 0.5}}
BUILT = [{"name": "act_now_share", "source": "widget"}, {"name": "review_share", "source": "widget"}, {"name": "min_probability", "source": "widget"}]


class Reached(Exception):
    pass


def _spec(widgets):
    spec = copy.deepcopy(VALID)
    spec["config"] = dict(spec["config"], widgets=widgets)
    return spec


def _settings_run(agent_ns, before, after, built=BUILT, requester="lee.chan@x.co", previous=None, current=None):
    inst = _inspire(agent_ns, FakeSpark())
    seen = {"genie": 0, "notebook": 0}
    status = {"notebook": {"spec_version": 1, "result_history": agent_ns["IMPLEMENT_RESULT_HISTORY"], "state": "ready"}}
    if built is not None:
        status["settings"] = built
    inst._implement_previous = lambda t: dict({"spec_version": 1, "spec_json": _spec(before), "created_by": "lee.chan@x.co"},
                                              **(previous or {}))
    carried = {"notebook_path": "/Workspace/nb", "job_id": 7, "dashboard_id": "d1", "genie_space_id": "g1", "app_name": "churn-desk",
               "last_preview_run_id": 99}
    inst._implement_carried = lambda t, through_own=False: (dict(carried), copy.deepcopy(status))
    inst._implement_update = lambda key, **f: None
    inst._implement_emit = lambda *a, **k: None
    inst._implement_use_case_row = lambda sid, uc: {"No": "N01-U01", "Primary Table": "main.s.orders", "genie_instruction": INSTRUCTION}
    inst._row_to_uc = lambda row: dict(row)
    inst._genie_involved_tables = lambda uc: ["main.s.orders"]
    inst._genie_notebook_spec = lambda uc: dict(SPEC_NB)
    inst._implement_folder_access = lambda *a, **k: []
    inst._implement_write_notebook = lambda *a, **k: seen.__setitem__("notebook", seen["notebook"] + 1) or "/Workspace/nb"
    inst._implement_runner = lambda uc: seen.__setitem__("genie", seen["genie"] + 1) or (_ for _ in ()).throw(Reached("reached Genie"))
    inst._implement_refresh_run_controls = lambda *a, **k: None
    inst._implement_result_history = lambda *a, **k: (_ for _ in ()).throw(Reached("past the notebook"))
    run = lambda: inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 2,
                                              "spec_json": current or _spec(after), "created_by": requester}, (5150, "N01-U01", 2))
    return inst, seen, run


def _inserts(inst):
    return [s for s in inst.spark.statements if s.startswith("INSERT INTO")]


def test_a_widget_value_change_on_a_notebook_built_with_settings_saves_it_and_starts_no_genie_round(agent_ns):
    inst, seen, run = _settings_run(agent_ns, {"act_now_share": "0.05"}, {"act_now_share": "0.1"})
    with pytest.raises(Reached, match="past the notebook"):
        run()
    assert seen == {"genie": 0, "notebook": 0}
    rows = _inserts(inst)
    assert len(rows) == 1 and "'act_now_share', 0.1, 'lee.chan@x.co', current_timestamp(), 'set in the Inspire App wizard', NULL" in rows[0]


@pytest.mark.parametrize("before,after,built", [
    ({"act_now_share": "0.05"}, {"act_now_share": "0.1"}, None),
    ({"act_now_share": "0.05"}, {"act_now_share": "0.05", "top_k": "10"}, BUILT),
    ({"act_now_share": "0.1"}, {}, BUILT),
])
def test_an_older_notebook_an_added_widget_or_a_removed_value_rebuilds_with_genie(agent_ns, before, after, built):
    inst, seen, run = _settings_run(agent_ns, before, after, built)
    with pytest.raises(Reached, match="reached Genie"):
        run()
    assert seen["genie"] == 1 and _inserts(inst) == []


def test_a_settings_change_out_of_bounds_is_refused_before_anything_runs(agent_ns):
    inst, seen, run = _settings_run(agent_ns, {"act_now_share": "0.05"}, {"act_now_share": "1.5"})
    with pytest.raises(agent_ns["ImplementBlocked"], match="widget values are out of range: act_now_share is '1.5'; allowed: 0 to 1"):
        run()
    assert seen == {"genie": 0, "notebook": 0} and _inserts(inst) == []


def test_the_change_class_contract_holds_the_settings_rows_for_the_app(agent_ns):
    import os
    fixture = json.load(open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures",
                                          "implement_change_classes.json")))
    named = {c["name"]: c for c in fixture["cases"]}
    assert named["a widget value change on a notebook built with settings"]["classes"] == ["settings"]
    assert named["the same widget value change on an older notebook"]["classes"] == ["config"]
    plans = {p["case"]: p["summary"] for p in fixture["plans"]}
    assert plans["a widget value change on a notebook built with settings"]["refill"] is False
    assert plans["the same widget value change on an older notebook"]["refill"] is True
    assert agent_ns["implement_built_settings"]({"settings": BUILT + [{"name": "WEEKS", "source": "assumption"}]}) == [
        "act_now_share", "review_share", "min_probability"]


def _formula(agent_ns, **bounds):
    value = dict(_value("margin_lost_week * WEEKS_LEFT * KEEP_RATE"), **bounds)
    formula, problems = agent_ns["inspire_value_formula"](value, SCHEMA)
    assert problems == []
    return value, formula


def test_a_constant_without_a_declared_range_refuses_the_build(agent_ns):
    value, formula = _formula(agent_ns, bounds=None, bounds_required=True)
    problems = agent_ns["inspire_value_bounds"](value, formula)
    assert problems == ["the notebook has no VALUE_AT_STAKE_BOUNDS, so the App cannot keep WEEKS_LEFT, KEEP_RATE inside a sensible range "
                        "when an owner changes it; define VALUE_AT_STAKE_BOUNDS at top level next to VALUE_AT_STAKE_FORMULA: for every "
                        "assumption constant the formula names, its [lowest, highest] sensible value, such as {'WEEKS_LEFT_IN_SEASON': [1, 52]}"]
    value, formula = _formula(agent_ns, bounds={"WEEKS_LEFT": [1, 52]}, bounds_required=True)
    assert agent_ns["inspire_value_bounds"](value, formula)[0].startswith("VALUE_AT_STAKE_BOUNDS gives no range for KEEP_RATE")
    old, formula = _formula(agent_ns, bounds=None, bounds_required=False)
    assert agent_ns["inspire_value_bounds"](old, formula) == [], "a notebook built before ranges keeps running"
    inst = build_inspire(agent_ns)
    uc = make_uc(**{"Analytics Technique": "Cohort Analysis"})
    spec = inst._genie_notebook_spec(uc)
    rules = inst._genie_with_platform_rules("## 1. Goal\nGoal.\n", spec)
    assert "Define `VALUE_AT_STAKE_BOUNDS` next to them" in rules and "{'WEEKS_LEFT_IN_SEASON': [1, 52]}" in rules
    import ast
    run = ast.literal_eval(inst._genie_run_controls_source(uc, spec, rules).split("INSPIRE_RUN = ", 1)[1].split("\n\n\n", 1)[0])
    assert run["value_bounds"] is True


@pytest.mark.parametrize("bounds,problem", [
    ({"WEEKS_LEFT": [1, 10], "KEEP_RATE": [0, 1]}, "WEEKS_LEFT is 12, outside its own range 1 to 10 in VALUE_AT_STAKE_BOUNDS"),
    ({"WEEKS_LEFT": [20, 5], "KEEP_RATE": [0, 1]}, "WEEKS_LEFT is 12, outside its own range 20 to 5 in VALUE_AT_STAKE_BOUNDS"),
    ({"WEEKS_LEFT": [1, 52], "KEEP_RATE": [0, 2]}, "KEEP_RATE is a share (:percent), so its range must sit inside 0 to 1, not 0 to 2"),
    ({"WEEKS_LEFT": [1, 52], "KEEP_RATE": "0 to 1"}, "VALUE_AT_STAKE_BOUNDS['KEEP_RATE'] is '0 to 1'; it must be [lowest, highest], two numbers"),
    ({"WEEKS_LEFT": [1, 52], "KEEP_RATE": [0, 1], "GHOST": [0, 1]}, "VALUE_AT_STAKE_BOUNDS names GHOST, which is not an assumption constant"),
])
def test_a_declared_range_that_leaves_out_its_own_value_or_breaks_its_kind_refuses_the_build(agent_ns, bounds, problem):
    value, formula = _formula(agent_ns, bounds=bounds, bounds_required=True)
    problems = agent_ns["inspire_value_bounds"](value, formula)
    assert len(problems) == 1 and problems[0].startswith(problem), problems


def test_a_sane_range_is_kept_with_each_constant_for_the_app(agent_ns):
    value, formula = _formula(agent_ns, bounds={"WEEKS_LEFT": [1, 52], "KEEP_RATE": [0.2, 0.9]}, bounds_required=True)
    assert agent_ns["inspire_value_bounds"](value, formula) == []
    assert [(a["name"], a.get("low"), a.get("high")) for a in formula["assumptions"]] == [("WEEKS_LEFT", 1.0, 52.0), ("KEEP_RATE", 0.2, 0.9)]
    money = dict(value, constants={"COST": 3.0}, formula="{margin_lost_week:money} x {COST:money}", bounds={"COST": [-1, 5]})
    formula, _problems = agent_ns["inspire_value_formula"](money, SCHEMA)
    assert agent_ns["inspire_value_bounds"](money, formula) == ["COST is money (:money), so its range cannot go below 0, not -1 to 5"]
    model = {s["name"]: s for s in agent_ns["inspire_settings_model"]({"family": "F", "decision_basis": "measured"}, [],
                                                                     [{"name": "WEEKS_LEFT", "kind": "number", "value": 12, "low": 1, "high": 52}])}
    assert (model["WEEKS_LEFT"]["low"], model["WEEKS_LEFT"]["high"], model["WEEKS_LEFT"]["allowed"]) == (1.0, 52.0, "1 to 52")


def test_a_saved_value_outside_the_declared_range_is_refused_at_run_start(fresh_ns):
    rows = [{"name": "WEEKS_LEFT", "value": 60.0, "changed_by": "pat.lee", "changed_at": "2026-10-28T09:00:00"},
            {"name": "KEEP_RATE", "value": 0.8, "changed_by": "pat.lee", "changed_at": "2026-10-28T09:00:00"}]
    fresh_ns.update(WEEKS_LEFT=12, KEEP_RATE=0.5, VALUE_AT_STAKE_FORMULA=FORMULA, VALUE_AT_STAKE_BOUNDS={"WEEKS_LEFT": [1, 52], "KEEP_RATE": [0.2, 0.9]})
    printed = []
    applied = fresh_ns["inspire_apply_assumptions"](_latest(rows), TABLE, "N01-U01", fresh_ns, printed.append, run={})
    assert applied == {"KEEP_RATE": 0.8} and fresh_ns["WEEKS_LEFT"] == 12
    assert printed[0] == ("Money at stake: the App holds a value for WEEKS_LEFT outside what the run accepts (WEEKS_LEFT is '60'; "
                          "allowed: 1 to 52), so this run keeps 12")


def test_the_shared_assumption_bounds_match_the_agent(agent_ns):
    import os
    fixture = json.load(open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures",
                                          "implement_change_classes.json")))
    for case in fixture["assumption_settings"]:
        assert agent_ns["inspire_assumption_setting"](case["name"], case["kind"], case["low"], case["high"]) == case["setting"], case
    ranged = [c for c in fixture["setting_values"] if c["setting"]["name"] in ("WEEKS_LEFT", "KEEP_RATE", "UNIT_COST")]
    assert len(ranged) >= 11 and any(c["problem"] for c in ranged) and any(not c["problem"] for c in ranged)


SHARED = {"basis": "predicted", "currency": "USD", "amounts": {}, "accepted": True,
          "shares": {"act_now_share": "0.2", "review_share": "0.3"}}


def _ranked(n, cuts, flags=None):
    rows = []
    for i in range(n):
        flag = (flags or {}).get(i, "ok")
        tier = "Act now" if flag == "ok" and i + 1 <= cuts[0] else "Review" if flag == "ok" and i + 1 <= cuts[1] else "Monitor"
        rows.append({"as_of_date": "2026-10-20", "entity_id": f"e{i}", "entity_label": f"E{i}", "priority_tier": tier, "rank": i + 1,
                     "value_at_stake": 5.0, "data_quality_flag": flag, "run_id": "r1", "use_case_id": "N01-U01"})
    return rows


def test_the_run_refuses_share_tiers_that_do_not_follow_the_rank_rule(agent_ns):
    value = dict(SHARED, passed=10)
    assert agent_ns["inspire_share_cuts"](value) == (2, 5)
    rows = _ranked(20, (2, 5))
    profile = _sqlite(agent_ns["inspire_run_profile_sql"]("c.s.stage", list(rows[0]), value), rows)
    assert (int(profile["off_share_tier"]), int(profile["ok_rows"])) == (0, 20)
    rows[3]["priority_tier"] = "Act now"
    rows[12]["priority_tier"] = "Review"
    profile = _sqlite(agent_ns["inspire_run_profile_sql"]("c.s.stage", list(rows[0]), value), rows)
    problems = agent_ns["inspire_run_problems"](profile, value)
    assert ("2 rows have a priority_tier that does not follow the share rule: with 10 rows that pass the decision test, ranked 1 to 10 "
            "first, a row whose data_quality_flag is 'ok' is 'Act now' at rank 2 or better, 'Review' at rank 5 or better, and every other "
            "row is 'Monitor'") in problems
    flagged = _ranked(4, (0, 2), flags={0: "stale", 1: "stale", 2: "stale"})
    profile = _sqlite(agent_ns["inspire_run_profile_sql"]("c.s.stage", list(flagged[0]), dict(SHARED, passed=4)), flagged)
    assert any("only 1 row has a data_quality_flag of 'ok'" in p for p in agent_ns["inspire_run_problems"](profile, dict(SHARED, passed=4)))
    unaccepted = _sqlite(agent_ns["inspire_run_profile_sql"]("c.s.stage", list(rows[0]), dict(value, accepted=False)), rows)
    assert "off_share_tier" not in unaccepted, "a run that missed acceptance writes every row Monitor, which Inspire checks instead"


def test_a_new_prediction_must_say_how_many_rows_pass_and_an_older_one_runs_as_before(agent_ns):
    problems = agent_ns["inspire_value_problems"]
    assert "pass passed=<the number of rows that pass the decision test> to inspire_write_result" in " ".join(
        problems(dict(SHARED, passed=None, shares_required=True)))
    assert not [p for p in problems(dict(SHARED, passed=None, shares_required=False)) if "passed=" in p]
    assert not [p for p in problems(dict(SHARED, passed=None, shares_required=True, accepted=False)) if "passed=" in p]
    for wrong in (True, -1, 2.5, "10"):
        with pytest.raises(ValueError, match="inspire_write_result takes passed=<a whole number of 0 or more>"):
            agent_ns["inspire_write_result"](None, "main.inspire.churn_out", passed=wrong)


def test_the_summary_records_how_many_rows_passed_and_the_shares_the_run_used(agent_ns):
    spark = _outcome_spark({"act_now_records": 2, "review_records": 3, "records": 20})
    value = dict(SHARED, passed=10, currency="AED")
    agent_ns["inspire_save_outcome"](spark, "main.inspire.churn_out", "N01-U01", "r-1", COLUMNS, value, "", lambda line: None)
    merge = next(s for s in spark.statements if s.startswith("MERGE INTO") and "passing_records" in s)
    assert "`passing_records` = 10, `act_now_share` = 0.2, `review_share` = 0.3" in merge, merge


def test_the_alert_reads_the_saved_threshold_and_falls_back_to_the_built_one(agent_ns):
    import shell_sql
    outputs = {"alert_tiers": "act_now", "alert_operator": ">=", "alert_threshold": 3}
    query = agent_ns["implement_alert_query"](shell_sql, "main.inspire.churn_out", outputs, threshold_from="N01-U01")
    assert "`main`.`inspire`.`churn_out_assumptions`" in query["query"] and "'alert_threshold'" in query["query"]
    assert "COALESCE(CASE WHEN" in query["query"] and "END, 3.0)" in query["query"] and (query["column"], query["threshold"]) == ("alert_value", 1.0)
    plain = agent_ns["implement_alert_query"](shell_sql, "main.inspire.churn_out", outputs)
    assert "assumptions" not in plain["query"] and plain["threshold"] == 3.0
    baseline = agent_ns["implement_alert_query"](shell_sql, "main.inspire.churn_out", dict(outputs, alert_threshold_basis="baseline"),
                                                 threshold_from="N01-U01", columns=list(shell_sql.HISTORY_COLUMNS) + ["run_id", "priority_tier"])
    assert "ELSE (COALESCE(CASE WHEN" in baseline["query"], "the baseline's fallback before enough runs is the saved threshold too"


ALERT_ENTRY = {"name": "alert_threshold", "label": "Alert threshold", "group": "alerts", "kind": "number", "low": 0, "high": None,
               "allowed": "at least 0", "default": "1", "reason": "set when the use case was built", "applies": "alert", "source": "alert",
               "unit": "", "help": "The alert emails when the number of act now records is >= this."}


def _deployed_alert_entry(agent_ns, tmp_path, live, intended=True):
    from v140_implement_test import ALERT, _FileRunner
    from v142_dash_test import _churn_page, _flow, _runner
    status = {"settings": [dict(ALERT_ENTRY)]}
    if live is not None:
        status["alert"] = dict(live)
    inst, context, seen = _flow(agent_ns, tmp_path, outputs=dict(ALERT, alert_threshold=3), asset_status=status)
    context["alert_setting"] = intended
    inst._implement_dashboard(context, _runner(_churn_page(agent_ns)))
    inst._implement_app(context, _FileRunner([], []))
    page = json.loads(seen["deployed"][-1][1]["pages/n01_u01.json"])
    return next(s for s in page.get("settings") or [] if s["name"] == "alert_threshold")


def test_a_failed_alert_step_never_makes_the_app_offer_a_threshold_the_live_alert_ignores(agent_ns, tmp_path):
    entry = _deployed_alert_entry(agent_ns, tmp_path, {"state": "failed", "error": "the alert could not be saved", "spec_version": 3})
    assert entry["reads_setting"] is False and entry["default"] == "3.0", "the build meant to rebuild the alert, but the old one stays live"


@pytest.mark.parametrize("live", [
    {"state": "ready", "spec_version": 2},
    {"state": "unmanaged", "threshold_setting": True},
    {"state": "deleted"},
    None,
])
def test_only_a_live_alert_that_reads_the_settings_makes_the_threshold_editable(agent_ns, tmp_path, live):
    assert _deployed_alert_entry(agent_ns, tmp_path, live)["reads_setting"] is False


def test_a_live_alert_built_to_read_the_settings_makes_the_threshold_editable(agent_ns, tmp_path):
    entry = _deployed_alert_entry(agent_ns, tmp_path, {"state": "ready", "threshold_setting": True}, intended=False)
    assert entry["reads_setting"] is True


def test_a_failed_alert_step_keeps_the_state_of_the_alert_that_stays_live(agent_ns):
    kept = agent_ns["implement_kept_asset"]
    before = {"state": "ready", "threshold_setting": True, "digest_id": "dg-1", "trigger": "Act now rows are at least 3"}
    failed = dict(kept(before), state="failed", error="the alert could not be saved", spec_version=4)
    assert failed == {"digest_id": "dg-1", "threshold_setting": True, "state": "failed", "error": "the alert could not be saved",
                      "spec_version": 4}
    assert agent_ns["implement_alert_reads_setting"]({"alert": failed}) is True, "the earlier alert still reads the App's settings"
    older = dict(kept({"state": "ready", "trigger": "Act now rows are at least 3"}), state="failed")
    assert agent_ns["implement_alert_reads_setting"]({"alert": older}) is False


def test_the_settings_model_follows_the_live_alert_after_the_outputs(agent_ns):
    settle = agent_ns["implement_settle_alert_setting"]
    status = {"settings": [dict(ALERT_ENTRY, reads_setting=False), {"name": "top_k", "source": "widget"}],
              "alert": {"state": "ready", "threshold_setting": True}}
    settle(status)
    assert [s.get("reads_setting") for s in status["settings"]] == [True, None]
    status["alert"] = {"state": "failed", "error": "boom"}
    settle(status)
    assert status["settings"][0]["reads_setting"] is False
    source = __import__("_agentload").agent_source()
    assert source.count("\n        implement_settle_alert_setting(asset_status)\n") == 1, "the flow settles the model once, after the outputs"
    assert "alert_setting = implement_alert_reads_setting(spec, plan" not in source and 'context.get("alert_setting")' not in source


def test_the_page_lists_the_widget_and_alert_settings_and_drops_an_alert_turned_off(agent_ns):
    status = {"settings": [{"name": "alert_threshold", "source": "alert", "default": "1"}, {"name": "top_k", "source": "widget"},
                           {"name": "WEEKS", "source": "assumption"}], "alert": {"state": "ready", "threshold_setting": True}}
    page = agent_ns["implement_page_settings"]
    assert [s["name"] for s in page(status)] == ["alert_threshold", "top_k"]
    assert page(status, {"alert": True, "alert_threshold": 4})[0] == {"name": "alert_threshold", "source": "alert", "default": "4.0",
                                                                      "reads_setting": True}
    assert [s["name"] for s in page(status, {"alert": False})] == ["top_k"]


def test_the_app_service_principal_gets_and_on_uninstall_loses_the_settings_table_grant(agent_ns):
    from v150_app_owners_access_test import Catalog
    spark = Catalog(schema=[("entity_id", "string"), ("priority_tier", "string")])
    inst = _inspire(agent_ns, spark)
    ran = []
    warnings = inst._implement_app_write_grants("main.inspire.churn_out", "sp-7", {}, [], ran, settings=True)
    granted = [s for s in spark.statements if s.startswith("GRANT") and " ON TABLE " in s]
    assert warnings == [] and granted == ["GRANT SELECT ON TABLE `main`.`inspire`.`churn_out_assumptions` TO `sp-7`",
                                          "GRANT MODIFY ON TABLE `main`.`inspire`.`churn_out_assumptions` TO `sp-7`"]
    assert {g["privilege"] for g in ran if g.get("level") == "table"} == {"SELECT", "MODIFY"}
    spark.statements.clear()
    record = {"name": "sp-7", "sql": ran, "genie": []}
    _warnings, _said, left = inst._implement_revoke_app_sp("churn-desk", record, {"pages": [], "service_principal": "sp-7"})
    revoked = [s for s in spark.statements if s.startswith("REVOKE")]
    assert len(revoked) == len([g for g in ran if g.get("level") == "table"]) and all("churn_out_assumptions" in s for s in revoked)
    assert not (left or {}).get("sql"), "Uninstall leaves no grant behind"


def test_a_wizard_assumption_outside_its_declared_range_is_refused_before_anything_runs(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_value_summary = lambda table, uc: {"assumptions": [{"name": "WEEKS_LEFT", "kind": "number", "value": 12, "low": 1, "high": 52}]}
    spec = dict(VALID, config=dict(VALID["config"], assumptions={"WEEKS_LEFT": 60}))
    with pytest.raises(agent_ns["ImplementBlocked"], match="assumption values are out of range: WEEKS_LEFT is '60'; allowed: 1 to 52"):
        inst._implement_save_chosen_settings("N01-U01", "main.inspire.churn_out", spec, SPEC_NB, [], "lee.chan@x.co")
    assert not [s for s in inst.spark.statements if s.startswith(("INSERT", "CREATE"))]


def test_the_alert_email_says_owners_change_its_threshold_in_the_app(agent_ns):
    texts = agent_ns["implement_alert_texts"]
    outputs = {"alert_tiers": "act_now", "alert_operator": ">=", "alert_threshold": 3}
    shell_alerts = __import__("shell_alerts")
    _summary, built = texts(shell_alerts, "N01-U01", {"Name": "Predict churn"}, outputs, from_settings=True)
    _summary, older = texts(shell_alerts, "N01-U01", {"Name": "Predict churn"}, outputs)
    line = next(l for l in built.splitlines() if l.startswith("Why this threshold: "))
    assert line.endswith("the value they saved last, and the alert_threshold column of each check shows the value it used.")
    assert "Settings without a rebuild" not in older


def test_a_widget_the_formula_names_as_a_constant_is_refused_and_a_widget_written_as_a_column_is_not(agent_ns):
    formula = "{value:percent} churn probability x {total_paid:money} spend x {horizon_days:number} horizon days x {MARGIN:percent} margin"
    schema = SCHEMA + [("value", "double"), ("total_paid", "double")]
    value = dict(_value("value * total_paid * horizon_days * MARGIN"), formula=formula, constants={"horizon_days": 90, "MARGIN": 0.35},
                 bounds={"MARGIN": [0, 1]}, bounds_required=True, widget_names=["horizon_days", "act_now_share"])
    parsed, problems = agent_ns["inspire_value_formula"](value, schema)
    assert problems == []
    assert agent_ns["inspire_value_bounds"](value, parsed) == [
        "horizon_days is a widget, so it is a setting of the run and never an assumption constant of VALUE_AT_STAKE_FORMULA; write its "
        "value as a numeric column of every row and name that column in the formula"]
    written, _problems = agent_ns["inspire_value_formula"](value, schema + [("horizon_days", "int")])
    assert agent_ns["inspire_value_bounds"](value, written) == [], "a widget written as a column of every row is a column"
    assert [a["name"] for a in written["assumptions"]] == ["MARGIN"]
    older = dict(value, bounds=None, bounds_required=False)
    assert agent_ns["inspire_value_bounds"](older, parsed) == [], "a notebook built before ranges keeps running"
    rules = agent_ns["GENIE_VALUE_AT_STAKE_RULE"]
    assert "A widget is never one of these constants" in rules and "write that value as a numeric column of every row" in rules


def test_the_alert_step_makes_the_settings_table_before_any_query_it_runs_and_never_without_a_job(agent_ns, tmp_path):
    inst, _calls, _queries = _alert_inspire(agent_ns, tmp_path)
    made = []
    inst._implement_run_query_check = lambda sql, require_rows=False, limit=20: made.append(
        [s for s in inst.spark.statements if s.startswith("CREATE TABLE IF NOT EXISTS") and "churn" in s and "_assumptions" in s]
    ) or [{"triggered": True}]
    good = "SELECT COUNT(*) > 10 AS triggered FROM main.s.orders WHERE status = 'refund'"
    runner = _FileRunner([{"exit": 0}], [{"alert_condition.sql": good}])
    inst._implement_alert(_output_context(agent_ns, **ALERT, alert_condition_text="refunds above 10 today"), runner)
    assert len(made) == 2 and all(len(seen) == 1 for seen in made), made
    blocked, _c, _q = _alert_inspire(agent_ns, tmp_path)
    with pytest.raises(agent_ns["ImplementBlocked"], match="has no job yet"):
        blocked._implement_alert(dict(_output_context(agent_ns, **ALERT), job_id=None), None)
    assert not [s for s in blocked.spark.statements if "_assumptions" in s]

