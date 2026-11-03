import ast
import json
import os

import pytest

from v120_artifacts_support import FakeSpark
from v120_genie_support import build_inspire, make_uc
from v130_genie_run_controls_test import _controls, _dbutils

TABLE = "main.inspire.churn_out"
FIXTURE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures", "implement_change_classes.json")
TECHNIQUES = {"A": "Classification", "B": "Anomaly Detection", "C": "Segmentation", "D": "Recommendation", "E": "Forecasting",
              "F": "Cohort Analysis", "G": "Sentiment Analysis", "H": "Optimization"}
FLAGGING = {"A": ["act_now_share", "review_share", "min_probability"],
            "B": ["act_now_amount", "review_amount", "max_alerts_per_run", "alert_quantile"],
            "C": ["act_now_amount", "review_amount", "flag_segments"],
            "D": ["act_now_share", "review_share", "min_score", "items_per_entity"],
            "E": ["act_now_share", "review_share", "min_deviation"], "F": ["act_now_amount", "review_amount"],
            "G": ["act_now_amount", "review_amount"], "H": ["act_now_share", "review_share"]}
ASSUMPTIONS = [{"name": "WEEKS_LEFT", "value": 12, "kind": "number"}, {"name": "KEEP_RATE", "value": 0.5, "kind": "percent"},
               {"name": "UNIT_COST", "value": 4.0, "kind": "money"}]


def _spec(agent_ns, family):
    inst = build_inspire(agent_ns)
    return inst, inst._genie_notebook_spec(make_uc(**{"Analytics Technique": TECHNIQUES[family]}))


def _model(agent_ns, family, **kwargs):
    inst, spec = _spec(agent_ns, family)
    return inst._genie_settings_model(spec, inst._genie_core_widgets(spec), **kwargs)


@pytest.mark.parametrize("family", sorted(TECHNIQUES))
def test_each_family_flags_records_with_its_own_settings(agent_ns, family):
    model = _model(agent_ns, family)
    flagging = [s["name"] for s in model if s["group"] == "flagging"]
    assert sorted(flagging) == sorted(FLAGGING[family]), family
    names = {s["name"] for s in model}
    assert not names & set(agent_ns["INSPIRE_NOT_SETTINGS"]), "the output table, model, endpoint, as-of date and currency are not settings"
    assert [s["group"] for s in model] == sorted((s["group"] for s in model), key=agent_ns["INSPIRE_SETTING_GROUPS"].index)
    for setting in model:
        assert setting["kind"] in agent_ns["INSPIRE_SETTING_KINDS"] and setting["source"] == "widget" and setting["applies"] == "run"
        assert setting["help"] and setting["reason"] and setting["label"], setting["name"]
    by_name = {s["name"]: s for s in model}
    if "act_now_share" in by_name:
        assert by_name["act_now_share"]["kind"] == "percent" and by_name["act_now_share"]["unit"] == "%"
        assert by_name["act_now_share"]["default"] == "0.05" and "top 5%" in by_name["act_now_share"]["reason"]
    if "act_now_amount" in by_name:
        assert by_name["act_now_amount"]["kind"] == "money" and by_name["act_now_amount"]["low"] == 0
    if family == "C":
        assert by_name["flag_segments"]["kind"] == "choice" and by_name["flag_segments"]["many"] and by_name["flag_segments"]["default"] == "all"
    if family == "D":
        assert by_name["items_per_entity"]["kind"] == "integer" and by_name["items_per_entity"]["high"] == 100
    if family == "E":
        assert by_name["horizon"]["group"] == "scope" and by_name["horizon"]["kind"] == "integer"


def test_impact_settings_follow_the_target_kpi_unit_and_the_assumptions(agent_ns):
    money = _model(agent_ns, "F", assumptions=ASSUMPTIONS, impact={"kind": "money", "unit": "EUR"})
    impact = [s for s in money if s["group"] == "impact"]
    assert [(s["name"], s["kind"], s["unit"], s["low"], s["high"]) for s in impact] == [
        ("WEEKS_LEFT", "number", "", None, None), ("KEEP_RATE", "percent", "%", 0.0, 1.0), ("UNIT_COST", "money", "EUR", 0.0, None)]
    assert all(s["source"] == "assumption" and s["applies"] == "app_and_run" for s in impact)
    cut = {s["name"]: s for s in money}["act_now_amount"]
    assert (cut["kind"], cut["unit"]) == ("money", "EUR")
    hours = {s["name"]: s for s in _model(agent_ns, "F", impact={"kind": "hours", "unit": "hours saved", "label": "hours saved"})}
    assert (hours["act_now_amount"]["kind"], hours["act_now_amount"]["unit"]) == ("number", "hours saved")
    assert "hours saved" in hours["act_now_amount"]["help"], "a productivity use case flags by its own KPI, not money"
    default = {s["name"]: s for s in _model(agent_ns, "F")}
    assert default["act_now_amount"]["kind"] == "money", "without an impact kind the cutoff is money, as before"


def test_the_alert_threshold_is_an_alerts_setting_changed_on_the_build_page(agent_ns):
    model = _model(agent_ns, "A", alert={"alert": True, "alert_threshold": 3, "alert_tiers": "act_now", "alert_operator": ">="})
    alert = [s for s in model if s["group"] == "alerts"]
    assert len(alert) == 1 and alert[0]["source"] == "alert" and alert[0]["applies"] == "alert" and alert[0]["default"] == "3"
    assert not [s for s in _model(agent_ns, "A", alert={"alert": False}) if s["group"] == "alerts"]


@pytest.mark.parametrize("setting,value,problem", [
    ({"name": "act_now_share", "kind": "percent", "low": 0, "high": 1, "allowed": "0 to 1"}, "1.5", "act_now_share is '1.5'; allowed: 0 to 1"),
    ({"name": "act_now_share", "kind": "percent", "low": 0, "high": 1, "allowed": "0 to 1"}, "-0.01", "act_now_share is '-0.01'; allowed: 0 to 1"),
    ({"name": "items_per_entity", "kind": "integer", "low": 1, "high": 100, "whole": True, "allowed": "whole number, 1 to 100"}, "2.5",
     "items_per_entity is '2.5'; allowed: whole number, 1 to 100"),
    ({"name": "flag_segments", "kind": "choice", "choices": ["Loyal", "At risk"], "many": True}, "Loyal, Lost",
     "flag_segments is 'Loyal, Lost'; allowed: Loyal, At risk, all"),
    ({"name": "UNIT_COST", "kind": "money", "low": 0.0, "high": None, "allowed": "at least 0"}, "-1", "UNIT_COST is '-1'; allowed: at least 0"),
])
def test_an_out_of_bounds_value_is_refused(agent_ns, setting, value, problem):
    assert agent_ns["inspire_setting_problem"](setting, value) == problem
    inside = {"percent": "0.5", "integer": "10", "choice": "Loyal, At risk", "money": "0"}[setting["kind"]]
    assert agent_ns["inspire_setting_problem"](setting, inside) == ""


def test_the_shared_setting_value_cases_match_the_agent(agent_ns):
    for case in json.load(open(FIXTURE))["setting_values"]:
        assert agent_ns["inspire_setting_problem"](case["setting"], case["value"]) == case["problem"], case


def _saved(rows):
    def respond(statement):
        if statement.startswith("SELECT name, value, changed_by, changed_at, text_value FROM"):
            return rows
        return []
    return FakeSpark(responder=respond)


SHARE = {"name": "act_now_share", "kind": "percent", "low": 0.0, "high": 1.0, "whole": False, "low_open": False, "high_open": False,
         "allowed": "0 to 1", "choices": [], "many": False}
SEGMENTS = {"name": "flag_segments", "kind": "choice", "choices": [], "many": True}
DAYS = {"name": "lookback_days", "kind": "days", "low": 1.0, "high": 365.0, "whole": True, "allowed": "whole number, 1 to 365"}


def test_a_saved_value_wins_over_the_build_default_at_run_start(fresh_ns):
    rows = [{"name": "act_now_share", "value": 0.1, "changed_by": "pat.lee", "changed_at": "2026-10-28T09:00:00"},
            {"name": "flag_segments", "value": None, "text_value": "Loyal", "changed_by": "sam.ortiz", "changed_at": "2026-10-29T09:00:00"},
            {"name": "lookback_days", "value": 90.0, "changed_by": "pat.lee", "changed_at": "2026-10-29T09:00:00"}]
    fresh_ns.update(act_now_share=0.05, flag_segments="all", lookback_days=30)
    printed = []
    run = {"settings": [SHARE, SEGMENTS, DAYS], "settings_read": True}
    applied = fresh_ns["inspire_apply_assumptions"](_saved(rows), TABLE, "N01-U01", fresh_ns, printed.append, run=run)
    assert applied == {"act_now_share": 0.1, "flag_segments": "Loyal", "lookback_days": 90}
    assert fresh_ns["act_now_share"] == 0.1 and fresh_ns["flag_segments"] == "Loyal" and fresh_ns["lookback_days"] == 90
    assert isinstance(fresh_ns["lookback_days"], int)
    assert fresh_ns["inspire_widget"]("act_now_share", "") == "0.1", "Inspire's own reads see the same value the steps read"
    assert printed[0] == ("Settings: act_now_share is 0.1 for this run, as pat.lee set it in the App on 2026-10-28T09:00:00 "
                          "(the notebook's value is 0.05)")
    assert len(printed) == 3


def test_a_saved_value_outside_the_bounds_or_unread_by_an_old_notebook_is_not_applied(fresh_ns):
    rows = [{"name": "act_now_share", "value": 1.5, "changed_by": "pat.lee", "changed_at": "2026-10-28T09:00:00"},
            {"name": "lookback_days", "value": 45.0, "changed_by": "pat.lee", "changed_at": "2026-10-29T09:00:00"}]
    fresh_ns.update(act_now_share=0.05)
    fresh_ns.pop("lookback_days", None)
    printed = []
    applied = fresh_ns["inspire_apply_assumptions"](_saved(rows), TABLE, "N01-U01", fresh_ns, printed.append,
                                                    run={"settings": [SHARE, DAYS], "settings_read": True})
    assert applied == {} and fresh_ns["act_now_share"] == 0.05 and "lookback_days" not in fresh_ns
    assert "lookback_days" not in (fresh_ns.get("INSPIRE_SETTINGS_APPLIED") or {}), "a value the steps cannot read never reaches Inspire's checks"
    assert printed == [
        "Settings: the App holds a value for act_now_share outside what the run accepts (act_now_share is '1.5'; allowed: 0 to 1), "
        "so this run keeps the notebook's value",
        "Settings: the App holds 45 for lookback_days, but this notebook does not read the lookback_days widget into a variable of "
        "that name, so this run keeps the widget's value; build the notebook again with Vibe/Add/Remove Features on the Build page so the App's settings apply"]


def test_a_notebook_built_before_settings_keeps_its_widget_values(fresh_ns):
    rows = [{"name": "act_now_share", "value": 0.1, "changed_by": "pat.lee", "changed_at": "2026-10-28T09:00:00"}]
    fresh_ns.update(act_now_share=0.05)
    printed = []
    applied = fresh_ns["inspire_apply_assumptions"](_saved(rows), TABLE, "N01-U01", fresh_ns, printed.append,
                                                    run={"settings": [SHARE], "settings_read": False})
    assert applied == {} and fresh_ns["act_now_share"] == 0.05
    assert "act_now_share" not in (fresh_ns.get("INSPIRE_SETTINGS_APPLIED") or {}), "Inspire's own checks keep the widget's value too"
    assert printed == ["Settings: the App holds a value for act_now_share, but this notebook was built before the App's settings, so "
                       "this run keeps the widget's value; build the notebook again with Vibe/Add/Remove Features on the Build page so the App's settings apply"]


def test_an_assumption_saved_outside_its_kind_is_not_applied(fresh_ns):
    rows = [{"name": "KEEP_RATE", "value": 1.4, "changed_by": "pat.lee", "changed_at": "2026-10-28T09:00:00"},
            {"name": "WEEKS_LEFT", "value": -3.0, "changed_by": "pat.lee", "changed_at": "2026-10-28T09:00:00"}]
    fresh_ns.update(KEEP_RATE=0.5, WEEKS_LEFT=12, VALUE_AT_STAKE_FORMULA="{m:money} x {WEEKS_LEFT:number} x {KEEP_RATE:percent}")
    printed = []
    applied = fresh_ns["inspire_apply_assumptions"](_saved(rows), TABLE, "N01-U01", fresh_ns, printed.append, run={})
    assert applied == {"WEEKS_LEFT": -3} and fresh_ns["KEEP_RATE"] == 0.5
    assert printed[0] == ("Money at stake: the App holds a value for KEEP_RATE outside what the run accepts (KEEP_RATE is '1.4'; "
                          "allowed: 0 to 1), so this run keeps 0.5")


def test_the_settings_table_gains_the_text_column_through_the_alter_pattern(fresh_ns):
    def respond(statement):
        if statement.startswith("DESCRIBE TABLE"):
            return [{"col_name": n, "data_type": t} for n, t in (("use_case_id", "string"), ("name", "string"), ("value", "double"),
                                                                 ("changed_by", "string"), ("changed_at", "timestamp"), ("note", "string"))]
        return []
    spark = FakeSpark(responder=respond)
    fresh_ns["inspire_ensure_assumptions"](spark, TABLE)
    assert spark.statements[-1] == "ALTER TABLE `main`.`inspire`.`churn_out_assumptions` ADD COLUMNS (text_value STRING)"
    current = FakeSpark(responder=lambda s: respond(s) + ([{"col_name": "text_value", "data_type": "string"}]
                                                          if s.startswith("DESCRIBE") else []))
    fresh_ns["inspire_ensure_assumptions"](current, TABLE)
    assert not [s for s in current.statements if s.startswith("ALTER")]


def _main(agent_ns, steps, trigger_widgets, run_extra):
    ns, _call = _controls(agent_ns)
    ns["INSPIRE_RUN"].update(run_extra)
    ns.update(min_probability=0.0, spark=_saved([]), __name__="notebook")
    exec(compile(steps, "steps", "exec"), ns)
    dbu = _dbutils(**trigger_widgets)
    printed = []
    dbu.notebook.exit = lambda text: printed.append(("exit", text))
    return ns, dbu, printed


PROBABILITY = {"name": "min_probability", "kind": "percent", "low": 0.0, "high": 1.0, "allowed": "0 to 1"}
UNREAD = "def run_use_case():\n    return {'status': 'written', 'rows_written': 1}\n"
READ = "def score(p):\n    return p >= min_probability\n\ndef run_use_case():\n    score(0.7)\n    return {'status': 'written', 'rows_written': 1}\n"


def test_a_declared_setting_no_step_reads_is_refused_at_build(agent_ns):
    ns, dbu, printed = _main(agent_ns, UNREAD, {"execution": "Here"}, {"settings": [PROBABILITY], "settings_read": True})
    with pytest.raises(RuntimeError, match="no step of this notebook reads min_probability"):
        ns["inspire_main"](dbu=dbu, out=printed.append)
    ns, dbu, printed = _main(agent_ns, READ, {"execution": "Here"}, {"settings": [PROBABILITY], "settings_read": True})
    ns["inspire_main"](dbu=dbu, out=printed.append)
    assert "Use case outcome: wrote 1 row" in " ".join(p for p in printed if isinstance(p, str))


def test_a_scheduled_run_warns_about_an_unread_setting_and_an_older_notebook_is_not_checked(agent_ns):
    marker = agent_ns["INSPIRE_CHILD_MARKER"]
    ns, dbu, printed = _main(agent_ns, UNREAD, {marker: "1", "refresh_requested_by": "schedule"},
                             {"settings": [PROBABILITY], "settings_read": True})
    ns["inspire_main"](dbu=dbu, out=printed.append)
    log = next(text for kind, text in (p for p in printed if isinstance(p, tuple)))
    assert "no step of this notebook reads min_probability" in log and "This run goes on with the notebook's values." in log
    ns, dbu, printed = _main(agent_ns, UNREAD, {"execution": "Here"}, {"settings": [PROBABILITY], "settings_read": False})
    ns["inspire_main"](dbu=dbu, out=printed.append)
    assert not any("no step of this notebook reads" in str(p) for p in printed)


def test_an_assumption_constant_no_step_reads_is_refused_at_build(agent_ns):
    steps = "def run_use_case():\n    return {'status': 'written', 'rows_written': 1}\n"
    ns, dbu, printed = _main(agent_ns, steps, {"execution": "Here"}, {"settings": [], "settings_read": True})
    ns.update(WEEKS_LEFT=12, VALUE_AT_STAKE_FORMULA="{m:money} lost a week x {WEEKS_LEFT:number} weeks")
    with pytest.raises(RuntimeError, match="no step of this notebook reads WEEKS_LEFT"):
        ns["inspire_main"](dbu=dbu, out=printed.append)


def test_the_run_controls_carry_the_settings_and_only_a_new_build_is_checked(agent_ns):
    inst = build_inspire(agent_ns)
    uc = make_uc(**{"Analytics Technique": "Classification"})
    spec = inst._genie_notebook_spec(uc)
    run_of = lambda text: ast.literal_eval(inst._genie_run_controls_source(uc, spec, text).split("INSPIRE_RUN = ", 1)[1].split("\n\n\n", 1)[0])
    built = inst._apply_genie_instruction_contract("N01-U01", "## 1. Goal\nGoal.\n\n## 4. Readiness Check\nChecks.\n", spec)
    run = run_of(built)
    assert run["settings_read"] is True and agent_ns["INSPIRE_SETTINGS_READ_RULE"] in built
    names = [s["name"] for s in run["settings"]]
    assert {"act_now_share", "review_share", "min_probability", "min_auc"} <= set(names) and "result_table" not in names
    assert {s["name"]: s for s in run["settings"]}["min_probability"] == {
        "name": "min_probability", "kind": "percent", "low": 0, "high": 1, "whole": False, "low_open": False, "high_open": False,
        "allowed": "0 to 1", "choices": [], "many": False}
    assert run_of("## 1. Goal\nAn instruction written before settings.\n")["settings_read"] is False
    again = inst._apply_genie_instruction_contract("N01-U01", built, spec)
    assert again == built, "the contract keeps one Parameters lead"
    old_lead = inst._GENIE_PARAMETERS_LEAD_BEFORE
    older = built.replace(inst._GENIE_PARAMETERS_LEAD, old_lead)
    assert inst._apply_genie_instruction_contract("N01-U01", older, spec).count("in one cell titled Parameters") == 1


def test_a_segmentation_run_flags_only_the_segments_its_setting_names(fresh_ns):
    value = {"basis": "measured", "currency": "USD", "amounts": {"act_now_amount": "100", "review_amount": "10"}, "segments": "Loyal, At risk"}
    columns = ["entity_id", "priority_tier", "value_at_stake", "data_quality_flag", "segment_or_item"]
    sql = fresh_ns["inspire_run_profile_sql"]("c.s.stage", columns, value)
    assert "`data_quality_flag` = 'ok' AND `segment_or_item` IN ('Loyal', 'At risk')" in sql
    assert " IN ('Loyal'" not in fresh_ns["inspire_run_profile_sql"]("c.s.stage", columns, dict(value, segments="all"))
    problem = fresh_ns["inspire_run_problems"]({"off_tier": 3, "use_cases": 1, "runs": 1}, value)
    assert "in a segment flag_segments names (Loyal, At risk)" in problem[0]


def test_the_instruction_asks_for_same_name_variables_and_each_family_s_flagging_rules(agent_ns):
    inst, spec = _spec(agent_ns, "D")
    lines = inst._genie_output_column_lines(spec)
    assert any("`min_score`" in line and "`items_per_entity`" in line for line in lines)
    _inst, spec_c = _spec(agent_ns, "C")
    assert any("`flag_segments`" in line for line in inst._genie_output_column_lines(spec_c))
    _inst, spec_f = _spec(agent_ns, "F")
    assert not any(line.startswith("Flagging settings") for line in inst._genie_output_column_lines(spec_f))
    assert "with the `flag_segments` widget when the notebook has it" in agent_ns["GENIE_MEASURED_TIER_RULE"]


def _builder(agent_ns, summary=None, saved=None, exists=True):
    statements = []

    def respond(statement):
        statements.append(statement)
        if statement.startswith("DESCRIBE TABLE") and statement.endswith("_assumptions`"):
            return [{"col_name": "name", "data_type": "string"}, {"col_name": "text_value", "data_type": "string"}] if exists else []
        if statement.startswith("SELECT * FROM") and "churn_out_summary" in statement:
            return [summary] if summary else []
        if statement.startswith("SELECT name, value, changed_by, changed_at, text_value FROM"):
            return saved or []
        return []
    inst = build_inspire(agent_ns)
    inst.spark = FakeSpark(responder=respond)
    spec_nb = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": "Classification"}))
    return inst, spec_nb, inst._genie_core_widgets(spec_nb)


def _inserts(inst):
    return [s for s in inst.spark.statements if s.startswith("INSERT INTO")]


def test_wizard_values_become_the_first_saved_values_only_when_they_change_the_value_in_use(agent_ns):
    summary = {"value_assumptions": json.dumps(ASSUMPTIONS), "currency": "USD"}
    saved = [{"name": "act_now_share", "value": 0.1, "changed_by": "pat.lee", "changed_at": "2026-10-28T09:00:00"}]
    inst, spec_nb, known = _builder(agent_ns, summary, saved)
    spec = {"config": {"widgets": {"act_now_share": "0.2", "top_k": "5"}, "assumptions": {"WEEKS_LEFT": 10, "KEEP_RATE": 0.5}}}
    assert inst._implement_save_chosen_settings("N01-U01", TABLE, spec, spec_nb, known, "lee.chan@x.co") == 2
    rows = _inserts(inst)
    assert rows[0].startswith("INSERT INTO `main`.`inspire`.`churn_out_assumptions` (use_case_id, name, value, changed_by, changed_at, note, "
                              "text_value) VALUES ('N01-U01', 'act_now_share', 0.2, 'lee.chan@x.co', current_timestamp(), "
                              "'set in the Inspire App wizard', NULL)")
    assert "'WEEKS_LEFT', 10.0" in rows[1] and not [r for r in rows if "KEEP_RATE" in r], "an unchanged assumption writes nothing"
    fresh, spec_nb, known = _builder(agent_ns, summary, [])
    first = {"config": {"widgets": {"act_now_share": "0.2"}, "assumptions": {}}}
    assert fresh._implement_save_chosen_settings("N01-U01", TABLE, first, spec_nb, known, "lee") == 0, \
        "with nothing saved, the job's widget value is the build default the run uses"


def test_wizard_assumption_values_outside_the_model_are_refused_before_the_build(agent_ns):
    blocked = agent_ns["ImplementBlocked"]
    inst, spec_nb, known = _builder(agent_ns, {"value_assumptions": json.dumps(ASSUMPTIONS)})
    with pytest.raises(blocked, match="KEEP_RATE is '1.5'; allowed: 0 to 1"):
        inst._implement_save_chosen_settings("N01-U01", TABLE, {"config": {"assumptions": {"KEEP_RATE": 1.5}}}, spec_nb, known, "lee")
    with pytest.raises(blocked, match="the notebook has no assumption GONE"):
        inst._implement_save_chosen_settings("N01-U01", TABLE, {"config": {"assumptions": {"GONE": 1}}}, spec_nb, known, "lee")
    assert _inserts(inst) == []


def test_an_assumption_change_saves_settings_without_rebuilding_the_notebook(agent_ns):
    validate, plan = agent_ns["validate_implement_spec"], agent_ns["implement_plan"]
    base = json.load(open(os.path.join(os.path.dirname(FIXTURE), "implement_spec_parity.json")))["base"]
    before = validate(base)[0]
    after = validate(dict(base, config=dict(base["config"], assumptions={"WEEKS_LEFT": 10})))[0]
    assert agent_ns["classify_implement_change"](before, after) == ["settings"]
    got = plan(before, after, {"dashboard": "d1", "genie_space": "g1", "app": "my-app", "alert": "a1", "preview_run_id": 7}, True)
    assert got["refill"] is False and got["preview"] is False and got["build"] == []
    widened = validate(dict(base, config=dict(base["config"], widgets={"top_k": "11"})))[0]
    assert "config" in agent_ns["classify_implement_change"](before, widened), "a widget value still rebuilds as before"


def test_a_notebook_built_before_settings_offers_only_its_assumptions(agent_ns):
    summary = {"value_assumptions": json.dumps(ASSUMPTIONS), "currency": "USD"}
    inst, spec_nb, _known = _builder(agent_ns, summary)
    old = inst._implement_settings(TABLE, "N01-U01", {"outputs": {}}, spec_nb, {"genie_instruction": "## 1. Goal\nOld.\n"})
    assert {s["source"] for s in old} == {"assumption"}, "the App offers no widget an older notebook would ignore"
    built = inst._apply_genie_instruction_contract("N01-U01", "## 1. Goal\nGoal.\n\n## 4. Readiness Check\nChecks.\n", spec_nb)
    new = inst._implement_settings(TABLE, "N01-U01", {"outputs": {}}, spec_nb, {"genie_instruction": built})
    assert {"act_now_share", "min_probability"} <= {s["name"] for s in new if s["source"] == "widget"}


def test_the_app_page_carries_its_settings_and_a_page_without_them_is_unchanged(agent_ns):
    page = {"version": 1, "title": "T"}
    model = _model(agent_ns, "A", assumptions=ASSUMPTIONS)
    status = {"settings": model}
    built = agent_ns["implement_app_page"](page, "N01-U01", {}, TABLE, agent_ns["implement_page_settings"](status))
    assert [s["source"] for s in built["settings"]] and {s["source"] for s in built["settings"]} == {"widget"}
    plain = agent_ns["implement_app_page"](dict(page, settings=[{"name": "x"}]), "N01-U01", {}, TABLE)
    assert "settings" not in plain, "a page Genie wrote never carries settings of its own"
