"""A run of a notebook whose App holds a First run that is a number or another word reads it with the rule the App's runScope.js uses,
from one shared cases fixture, and logs one plain line when the earlier build did not record which MVP Test Run it meant, offline."""
import json
import os

import pytest

from v120_artifacts_support import FakeSpark

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LEGACY = json.load(open(os.path.join(ROOT, "tests", "fixtures", "run_scope_legacy_cases.json"), encoding="utf-8"))
SPEC = json.load(open(os.path.join(ROOT, "tests", "fixtures", "implement_grouping_cases.json"), encoding="utf-8"))["first_run"]["spec"]
UNRECORDED = "MVP Test Run: the earlier build of this notebook did not record which MVP Test Run it meant"


def _declared(declared):
    return LEGACY["declaration"] if declared == "recorded" else declared and dict(LEGACY["declaration"], **declared)


def _run(ns, spec=None, settings=None):
    spec = dict(SPEC) if spec is None else spec
    return {"scope": spec, "settings": ns["inspire_run_settings_model"](ns["inspire_scope_settings"](SPEC)) if settings is None else settings,
            "settings_read": True}


def _values(run_scope):
    return {"run_scope": run_scope, "scope_groups": "", "scope_days": 30, "scope_records": 1000}


@pytest.mark.parametrize("case", LEGACY["read"], ids=[f"{json.dumps(c['value'])}-{json.dumps(c['declared'])}" for c in LEGACY["read"]])
def test_a_recorded_first_run_maps_as_the_app_maps_it(agent_ns, case):
    recorded = dict(LEGACY["kept"], run_scope=case["value"])
    assert agent_ns["inspire_recorded_run_scope"](recorded, _declared(case["declared"])) == (dict(LEGACY["kept"], **case["mapped"]),
                                                                                             case["unrecorded"])


def test_the_shared_cases_hold_a_mapping_a_refusal_and_a_kept_value(agent_ns):
    unrecorded = [c for c in LEGACY["read"] if c["unrecorded"]]
    assert unrecorded and any(c["mapped"].get("scope_records") for c in LEGACY["read"]) and any(c["mapped"].get("scope_days") for c in LEGACY["read"])
    kept = {"run_scope": "recent", "scope_days": "7"}
    assert agent_ns["inspire_recorded_run_scope"](kept, LEGACY["declaration"])[0] is kept, "a valid choice is read as it is"
    for values in (None, "x", [], {}):
        assert agent_ns["inspire_recorded_run_scope"](values, LEGACY["declaration"]) == ({}, False)


@pytest.mark.parametrize("case", LEGACY["unrecorded_default"], ids=[str(c["table_default"]) for c in LEGACY["unrecorded_default"]])
def test_a_first_run_that_cannot_be_known_runs_on_the_table_default_or_everything_and_says_so_once(agent_ns, case):
    given = case["table_default"]
    spec = dict(SPEC, default=given) if given is not None else dict(SPEC, records=None, default=None)
    logs = []
    read = agent_ns["inspire_run_scope_values"](_run(agent_ns, spec), _values("5"), out=logs.append)
    assert read["run_scope"] == case["run_scope"]
    assert len(logs) == 1 and logs[0].startswith(UNRECORDED), logs
    assert "the App holds 5" in logs[0] and f"so this run uses {case['run_scope']}" in logs[0], logs[0]
    if given is None:
        assert "could not read how many records main.sales.orders holds" in logs[0], logs[0]
    elif given == case["run_scope"]:
        assert "the MVP Test Run Inspire suggests for main.sales.orders" in logs[0], logs[0]


@pytest.mark.parametrize("run_scope", ["all", "groups", "recent", "records", "", None])
def test_a_recorded_choice_or_no_value_never_logs_the_unrecorded_line(agent_ns, run_scope):
    logs = []
    read = agent_ns["inspire_run_scope_values"](_run(agent_ns), _values(run_scope), out=logs.append)
    assert logs == [] and read["run_scope"] == run_scope


def _scheduled(ns, run, row):
    values = _values(run["scope"]["default"])
    scope = {"INSPIRE_RUN": run, "INSPIRE_SCOPE_VALUES": values}
    rows = [dict(row, name="run_scope", changed_by="ana@example.com", changed_at=None)]
    logs = []

    def respond(statement):
        return rows if "ROW_NUMBER() OVER (PARTITION BY name" in statement else []
    ns["inspire_apply_assumptions"](FakeSpark(responder=respond), "main.inspire.churn_out", "N01-U01", scope=scope, out=logs.append)
    chosen = ns["inspire_scope_choice"](run, scope, out=logs.append)
    return chosen, logs


@pytest.mark.parametrize("row", [{"value": 5, "text_value": None}, {"value": 500.0, "text_value": None}, {"value": None, "text_value": "5"},
                                 {"value": None, "text_value": "everything"}], ids=["number", "float", "text number", "word"])
def test_a_scheduled_run_whose_app_holds_a_number_runs_on_the_table_default_with_one_plain_line(fresh_ns, row):
    chosen, logs = _scheduled(fresh_ns, _run(fresh_ns), row)
    assert chosen["scope"] == "groups" and chosen["column"] == "region"
    assert [m for m in logs if m.startswith(UNRECORDED)] and len([m for m in logs if m.startswith(UNRECORDED)]) == 1, logs
    assert not [m for m in logs if "outside what the run accepts" in m or "run_scope is ''" in m], logs


def test_a_run_whose_notebook_declares_first_run_as_a_number_reads_it_through_the_old_wording_and_never_fails(fresh_ns):
    legacy = dict(LEGACY["declaration"], help="How many days back the first run covers.")
    chosen, logs = _scheduled(fresh_ns, _run(fresh_ns, settings=[legacy]), {"value": 14, "text_value": None})
    assert (chosen["scope"], chosen["days"], chosen["column"]) == ("recent", 14, "order_date")
    assert not [m for m in logs if m.startswith(UNRECORDED)], logs
    chosen, logs = _scheduled(fresh_ns, _run(fresh_ns, settings=[LEGACY["declaration"]]), {"value": 5, "text_value": None})
    assert chosen["scope"] == "groups" and len([m for m in logs if m.startswith(UNRECORDED)]) == 1, logs


def test_a_scheduled_run_whose_app_holds_a_choice_still_runs_on_it(fresh_ns):
    chosen, logs = _scheduled(fresh_ns, _run(fresh_ns), {"value": None, "text_value": "all"})
    assert chosen["scope"] == "all" and not [m for m in logs if m.startswith(UNRECORDED)], logs
    assert any(m.startswith("Settings: run_scope is all for this run") for m in logs), logs
