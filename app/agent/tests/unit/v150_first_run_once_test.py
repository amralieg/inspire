"""Only the first run is the First run: the build's runs and the first run after someone picks a First run cover its scope,
every later run, scheduled or asked for in the App, covers all the records in the Data groups, and a rebuild that leaves the MVP
Test Run as it was never sends the person back to it, offline."""
import json

from v120_artifacts_support import FakeSpark

TABLE, RESULT = "main.sales.orders", "main.inspire.churn_out"
SPEC = {"table": TABLE, "records": 48000, "technique": "Classification", "time_series": False, "time_column": "order_date",
        "group_column": "region", "key_column": "order_id", "period": "day", "default": "records"}


def _spark(runs, asked=None, fail=None):
    def respond(statement):
        if statement.startswith("SELECT unix_micros(MAX(changed_at)) AS us"):
            return [{"us": asked}]
        if statement.startswith("SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN run_trigger"):
            if fail:
                raise RuntimeError(f"[{fail}] on the run log")
            since = int(statement.rsplit("unix_micros(run_started_at) > ", 1)[1].split(" ", 1)[0])
            kept = [r for r in runs if r[0] > since]
            return [{"n": len(kept), "later": sum(1 for r in kept if r[1] != "build")}]
        return []
    return FakeSpark(responder=respond)


def _start(ns, spark, trigger, scope_spec=None):
    run = {"scope": dict(scope_spec or SPEC), "use_case_id": "N01-U01", "result_table": RESULT}
    held = {"INSPIRE_RUN": run, "INSPIRE_SCOPE_VALUES": ns["inspire_scope_start_values"](run["scope"]), "group_by": "region",
            "INSPIRE_RUN_LOG": {"trigger": trigger, "table": RESULT}}
    said = []
    chosen = ns["inspire_scope_start"](spark, run, held, said.append)
    return chosen, said


def test_run_one_covers_the_mvp_test_run_and_runs_two_and_three_cover_the_data_groups(fresh_ns):
    asked = {"asked_us": 1000}
    first, said = _start(fresh_ns, _spark([]), "build", dict(SPEC, **asked))
    assert first["scope"] == "records" and fresh_ns["INSPIRE_SCOPE_DONE"] not in said
    built = [(2000, "build")]
    second, said = _start(fresh_ns, _spark(built), "schedule", dict(SPEC, **asked))
    assert second == {"scope": "all", "table": TABLE} and fresh_ns["INSPIRE_SCOPE_DONE"] in said
    third, _said = _start(fresh_ns, _spark(built + [(3000, "schedule")]), "refresh", dict(SPEC, **asked))
    assert third == {"scope": "all", "table": TABLE}


def test_every_run_of_one_build_keeps_the_mvp_test_run(fresh_ns):
    again, said = _start(fresh_ns, _spark([(2000, "build")]), "build", dict(SPEC, asked_us=1000))
    assert again["scope"] == "records" and fresh_ns["INSPIRE_SCOPE_DONE"] not in said


def test_a_rebuild_that_keeps_the_mvp_test_run_never_resets_the_person_to_it(fresh_ns):
    runs = [(2000, "build"), (3000, "schedule")]
    rebuilt, _said = _start(fresh_ns, _spark(runs), "build", dict(SPEC))
    assert rebuilt == {"scope": "all", "table": TABLE}
    later, _said = _start(fresh_ns, _spark(runs + [(4000, "build")]), "schedule", dict(SPEC))
    assert later == {"scope": "all", "table": TABLE}


def test_asking_again_in_the_wizard_or_the_app_runs_one_mvp_test_run_then_the_data_groups(fresh_ns):
    runs = [(2000, "build"), (3000, "schedule")]
    asked_again, _said = _start(fresh_ns, _spark(runs), "build", dict(SPEC, asked_us=3500))
    assert asked_again["scope"] == "records"
    in_app, _said = _start(fresh_ns, _spark(runs, asked=3500), "refresh", dict(SPEC))
    assert in_app["scope"] == "records"
    after, _said = _start(fresh_ns, _spark(runs + [(4000, "refresh")], asked=3500), "schedule", dict(SPEC))
    assert after == {"scope": "all", "table": TABLE}


def test_no_run_log_yet_keeps_the_mvp_test_run_and_an_unreadable_one_says_why(fresh_ns):
    missing, said = _start(fresh_ns, _spark([], fail="TABLE_OR_VIEW_NOT_FOUND"), "schedule")
    assert missing["scope"] == "records" and not any("could not read the earlier runs" in s for s in said)
    broken, said = _start(fresh_ns, _spark([], fail="PERMISSION_DENIED"), "schedule")
    assert broken["scope"] == "records" and any("could not read the earlier runs of main.inspire.churn_out" in s for s in said)
    assert fresh_ns["inspire_scope_done"](None, {"scope": SPEC}, "schedule", RESULT) is False


def test_the_build_stamps_an_ask_only_when_the_mvp_test_run_changed(agent_ns):
    asked = agent_ns["implement_scope_asked"]
    before = {"config": {"widgets": {"run_scope": "records", "scope_records": 500}}}
    assert asked(None, before) is True
    assert asked(before, json.loads(json.dumps(before))) is False
    assert asked(before, {"config": {"widgets": {"run_scope": "records", "scope_records": 800}}}) is True
    assert asked(before, {"config": {"widgets": {"run_scope": "records", "scope_records": 500, "top_k": 9}}}) is False


def test_the_run_page_says_only_the_first_run_covers_the_mvp_test_run(agent_ns):
    help_text = agent_ns["inspire_scope_settings"](dict(SPEC))[0]["help"]
    assert "Only the first run after you choose it covers this" in help_text and "Schedules keep" not in help_text


def test_team_capacity_is_an_app_setting_with_no_cap_by_default_and_the_next_run_uses_it(fresh_ns):
    model = fresh_ns["inspire_settings_model"]({"family": "A", "decision_basis": "predicted"}, [])
    capacity = next(s for s in model if s["name"] == "act_now_capacity")
    assert capacity["default"] == "" and capacity["optional"] and capacity["source"] == "widget" and capacity["label"] == "Team capacity"
    assert capacity["reason"] == "Inspire's default, no cap"
    kept = fresh_ns["inspire_settings_model"]({"family": "A", "decision_basis": "predicted", "act_now_capacity": 40}, [])
    assert next(s for s in kept if s["name"] == "act_now_capacity")["default"] == "40"
    run = {"settings": fresh_ns["inspire_run_settings_model"](model), "act_now_capacity": None, "settings_read": False}
    for saved, expected in ((25.0, 25), (None, None)):
        scope = {"INSPIRE_RUN": run}

        def respond(statement, saved=saved):
            if "ROW_NUMBER() OVER (PARTITION BY name" in statement:
                return [{"name": "act_now_capacity", "value": saved, "text_value": None, "changed_by": "ana@example.com", "changed_at": None}]
            return []
        said = []
        fresh_ns["inspire_apply_assumptions"](FakeSpark(responder=respond), RESULT, "N01-U01", scope=scope, out=said.append)
        assert fresh_ns["inspire_act_now_capacity"](scope=scope) == expected
        assert any(("25 records each run" if expected else "no cap") in s for s in said), said
    assert fresh_ns["inspire_act_now_capacity"](scope={"INSPIRE_RUN": dict(run, act_now_capacity=30)}) == 30, \
        "with nothing saved in the App the run keeps the built value"
    wrong = {"INSPIRE_RUN": run}
    fresh_ns["inspire_apply_assumptions"](FakeSpark(responder=lambda s: [{"name": "act_now_capacity", "value": 0.5, "text_value": None,
                                                                          "changed_by": "x", "changed_at": None}]
                                                    if "ROW_NUMBER() OVER" in s else []), RESULT, "N01-U01", scope=wrong, out=lambda m: None)
    assert "INSPIRE_ACT_NOW_CAPACITY" not in wrong
