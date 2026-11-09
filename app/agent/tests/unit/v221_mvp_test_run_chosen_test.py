"""v2.2.1 the First run a person picks in the Start MVP wizard is what every build run covers.

1. The wizard's run_scope, scope_groups, scope_days and scope_records reach the notebook's Run controls as its own start
   values, so the preview run and the grouping proof run cover the chosen scope, not the first records of the main table.
2. A group of a joined column (customers.autopay_enrolled) is run on as a group, never replaced by the first records.
3. Values the wizard cannot have meant are ignored, and a build with no wizard choice keeps Inspire's default.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _agentload import agent_source  # noqa: E402
from v120_artifacts_support import FakeSpark, make_inspire  # noqa: E402

BILLS, CUSTOMERS = "main.billing.bills", "main.billing.customers"
JOINED = [[{"column": "customers.autopay_enrolled", "value": "false",
            "join": {"table": CUSTOMERS, "key": "customer_id", "ref_column": "customer_id"}}]]
SPEC = {"table": BILLS, "records": 450000, "technique": "Classification", "time_series": False, "time_column": "bill_date",
        "group_column": "bill_id", "key_column": "bill_id", "period": "day", "default": "records"}


def _held(ns, spec, group_by="all"):
    return {"INSPIRE_RUN": {"scope": spec}, "INSPIRE_SCOPE_VALUES": ns["inspire_scope_start_values"](spec), "group_by": group_by}


def test_the_wizard_widgets_become_the_chosen_scope_and_values_it_cannot_mean_are_dropped(agent_ns):
    chosen = agent_ns["implement_scope_chosen"]
    widgets = {"run_scope": "Groups", "scope_groups": json.dumps(JOINED), "group_by": "all"}
    assert chosen(widgets) == {"run_scope": "groups", "scope_groups": json.dumps(JOINED)}
    assert chosen({"run_scope": "recent", "scope_days": "14"}) == {"run_scope": "recent", "scope_days": 14}
    assert chosen({"run_scope": "records", "scope_records": 500}) == {"run_scope": "records", "scope_records": 500}
    assert chosen({"run_scope": "custom", "scope_groups": "  ", "scope_days": "0", "scope_records": "-3"}) == {}
    assert chosen({"run_scope": "5", "scope_days": "ten", "scope_records": True}) == {}
    assert chosen(None) == {} and chosen({}) == {}


def test_a_chosen_joined_group_is_what_the_mvp_test_run_covers_not_the_first_records(agent_ns):
    spec = dict(SPEC, chosen={"run_scope": "groups", "scope_groups": json.dumps(JOINED)})
    held = _held(agent_ns, spec)
    assert held["INSPIRE_SCOPE_VALUES"] == {"run_scope": "groups", "scope_groups": json.dumps(JOINED), "scope_days": 30,
                                            "scope_records": 1000}
    said = []
    picked = agent_ns["inspire_scope_choice"](scope=held, out=said.append)
    assert picked["scope"] == "groups" and picked["groups"] == JOINED and picked["values"] == ["customers.autopay_enrolled = false"]
    assert "records" not in picked and "cut" not in picked and said == []
    assert "first" not in agent_ns["inspire_scope_text"](picked)


def test_a_chosen_recent_period_runs_on_its_days_and_never_on_the_first_records(agent_ns):
    spec = dict(SPEC, chosen={"run_scope": "recent", "scope_groups": json.dumps(JOINED), "scope_days": 14})
    picked = agent_ns["inspire_scope_choice"](scope=_held(agent_ns, spec), out=lambda *_a: None)
    assert picked["scope"] == "recent" and picked["days"] == 14 and picked["column"] == "bill_date"
    assert "records" not in picked and "cut" not in picked


def test_a_chosen_all_is_kept_although_inspire_would_start_on_records(agent_ns):
    assert agent_ns["inspire_scope_default"](dict(SPEC, chosen={"run_scope": "all"})) == "all"
    picked = agent_ns["inspire_scope_choice"](scope=_held(agent_ns, dict(SPEC, chosen={"run_scope": "all"})), out=lambda *_a: None)
    assert picked == {"scope": "all", "table": BILLS}


def test_a_build_with_no_wizard_choice_keeps_inspire_s_default(agent_ns):
    held = _held(agent_ns, dict(SPEC))
    assert held["INSPIRE_SCOPE_VALUES"] == {"run_scope": "records", "scope_groups": "", "scope_days": 30, "scope_records": 1000}
    picked = agent_ns["inspire_scope_choice"](scope=held, out=lambda *_a: None)
    assert picked["scope"] == "records" and picked["records"] == 1000
    junk = _held(agent_ns, dict(SPEC, chosen={"run_scope": "everything"}))
    assert junk["INSPIRE_SCOPE_VALUES"]["run_scope"] == "records", "a value that is no scope never replaces the default"


def test_the_run_page_settings_say_the_wizard_chose_them(agent_ns):
    spec = dict(SPEC, chosen={"run_scope": "groups", "scope_groups": json.dumps(JOINED), "scope_records": 500})
    run_scope, groups, days, records = agent_ns["inspire_scope_settings"](spec)
    assert run_scope["default"] == "groups" and run_scope["reason"] == "chosen in the Start MVP wizard"
    assert groups["default"] == json.dumps(JOINED) and groups["reason"] == "chosen in the Start MVP wizard"
    assert records["default"] == "500" and records["reason"] == "chosen in the Start MVP wizard"
    assert days["default"] == "30" and days["reason"] == "Inspire's default for a First run on a recent period"
    plain = agent_ns["inspire_scope_settings"](dict(SPEC))
    assert plain[0]["reason"].startswith("Inspire's default") and plain[1]["default"] == ""


def test_the_build_carries_the_wizard_choice_into_the_run_controls(agent_ns):
    inst = make_inspire(agent_ns, spark=FakeSpark(responder=lambda s: [{"col_name": "Statistics", "data_type": "1 bytes, 450000 rows"}]
                                                   if s.startswith("DESCRIBE TABLE") else []))
    inst._implement_columns_of = lambda tables, cache: {t: [{"column_name": "bill_date", "data_type": "date"}] for t in tables}
    use_case = {"Primary Table": BILLS, "elite_assessment": {"entity_key_column": "bills.bill_id"},
                "_implement_scope_chosen": {"run_scope": "groups", "scope_groups": json.dumps(JOINED)}}
    first = inst._genie_first_run(use_case, "B", "Classification", "daily")
    assert first["chosen"] == {"run_scope": "groups", "scope_groups": json.dumps(JOINED)} and first["default"] == "records"
    assert "chosen" not in inst._genie_first_run({"Primary Table": BILLS}, "B", "Classification", "daily")
    source = agent_source()
    flow = source.index('use_case["_implement_scope_chosen"] = implement_scope_chosen(spec["config"].get("widgets"))')
    assert flow < source.index("spec_nb = self._genie_notebook_spec(use_case)", flow)
    template = agent_ns["GENIE_RUN_CONTROLS_TEMPLATE"]
    assert 'INSPIRE_SCOPE_VALUES = inspire_scope_start_values(INSPIRE_RUN.get("scope"))' in template
    assert agent_ns["inspire_scope_start_values"](first)["run_scope"] == "groups"


def test_a_saved_choice_never_brings_in_the_setting_of_another_choice(agent_ns):
    chosen, stale = agent_ns["implement_scope_chosen"], agent_ns["implement_scope_stale"]
    widgets = {"run_scope": "recent", "scope_groups": json.dumps(JOINED), "scope_days": "14", "scope_records": 500}
    assert stale(widgets) == ["scope_groups", "scope_records"]
    assert chosen(widgets) == {"run_scope": "recent", "scope_days": 14}
    assert chosen({"run_scope": "groups", "scope_groups": json.dumps(JOINED), "scope_days": "14"}) == {"run_scope": "groups", "scope_groups": json.dumps(JOINED)}
    assert chosen({"scope_groups": json.dumps(JOINED), "scope_records": 500}) == {}, "with no choice, no choice setting is baked in"
    for ok in ({"run_scope": "groups", "scope_groups": json.dumps(JOINED)}, {"run_scope": "recent", "scope_days": "14"},
               {"run_scope": "records", "scope_records": 500}, {"run_scope": "all"}, {"run_scope": "custom", "scope_days": "3"}, {}, None):
        assert stale(ok) == [], ok
    spec = dict(SPEC, chosen=chosen(widgets))
    picked = agent_ns["inspire_scope_choice"](scope=_held(agent_ns, spec), out=lambda *_a: None)
    assert picked["scope"] == "recent" and picked["days"] == 14 and "groups" not in picked


def test_genie_is_never_told_the_setting_of_a_choice_the_spec_did_not_pick(agent_ns):
    spec = {"use_case_id": "N01-U01", "config": {"widgets": {"run_scope": "recent", "scope_days": "14", "scope_groups": json.dumps(JOINED),
                                                            "act_now_share": "0.1"}}}
    text = "\n".join(agent_ns["_implement_choice_lines"](spec))
    assert "Default of widget `run_scope`: `recent`" in text and "Default of widget `scope_days`: `14`" in text
    assert "Default of widget `act_now_share`: `0.1`" in text
    assert "scope_groups" not in text and "autopay_enrolled" not in text
    source = agent_source()
    flow = source.index('stale_scope = implement_scope_stale(spec["config"].get("widgets"))')
    assert "[MVP-TEST-RUN-STALE FIRED]" in source[flow:flow + 600]
