"""Data groups and First run are two settings with their own rules: the kinds registry alone says which techniques group their records,
in the agent, the notebooks it builds and the App, the first run is never everything by default, the whole data as one group takes the
first records, and what a v1.4.0 build saved still reads, offline."""
import json
import os

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
KINDS = json.load(open(os.path.join(ROOT, "agent", "app_shell", "kinds.json"), encoding="utf-8"))
GROUPING = json.load(open(os.path.join(ROOT, "tests", "fixtures", "implement_grouping_cases.json"), encoding="utf-8"))
LEGACY = json.load(open(os.path.join(ROOT, "tests", "fixtures", "run_scope_legacy_cases.json"), encoding="utf-8"))
SPEC = GROUPING["first_run"]["spec"]
RECORDS = ("groups", "alone", "together")


def test_every_registry_technique_is_classified_once_and_the_classification_is_the_kinds_registry(agent_ns):
    table = KINDS["technique_records"]
    named = set(KINDS["technique_kind"]) | {t for kind in KINDS["kinds"] for t in kind.get("techniques") or []}
    assert named <= set(table), f"techniques with no Data groups rule: {sorted(named - set(table))}"
    assert set(agent_ns["TECHNIQUE_EXECUTION_FAMILY"]) <= set(table), "every technique the agent runs is classified"
    assert set(table.values()) <= set(RECORDS) and all(v in table.values() for v in RECORDS)
    assert len({k.lower() for k in table}) == len(table), "a label is classified once"
    for technique, kind in table.items():
        assert agent_ns["inspire_technique_records"](technique) == kind
        assert agent_ns["inspire_grouping_applies"](technique) is (kind == "groups"), technique
        assert agent_ns["inspire_standalone"](technique) is (kind == "alone"), technique


@pytest.mark.parametrize("label", ["  anomaly   DETECTION ", "Anomaly Detection"])
def test_the_lookup_is_exact_up_to_case_and_spaces(agent_ns, label):
    assert agent_ns["inspire_grouping_applies"](label) is True


@pytest.mark.parametrize("label", ["Anomaly", "Time Series Forecasting", "Churn Prediction", "Text Classification", "anomaly detection of sales",
                                   "", None, 7])
def test_a_label_the_registry_does_not_hold_neither_groups_nor_stands_alone(agent_ns, label):
    assert agent_ns["inspire_technique_records"](label) == ""
    assert agent_ns["inspire_grouping_applies"](label) is False, f"{label!r} never groups by a word inside it (must-exclude)"
    assert agent_ns["inspire_standalone"](label) is False


def test_the_shared_applies_cases_hold_both_answers_and_the_agent_follows_them(agent_ns):
    cases = GROUPING["applies"]
    assert any(c["applies"] for c in cases) and any(not c["applies"] for c in cases)
    for case in cases:
        assert agent_ns["inspire_grouping_applies"](case["technique"]) is case["applies"], case["technique"]


def test_the_old_word_lists_are_gone_and_the_labels_say_data_groups(agent_ns):
    for gone in ("INSPIRE_GROUP_TECHNIQUES", "INSPIRE_STANDALONE_TECHNIQUES", "inspire_default_scope"):
        assert gone not in agent_ns, gone
    assert agent_ns["INSPIRE_GROUP_LABEL"] == "Data groups"
    assert agent_ns["GENIE_WIDGET_LABELS"]["group_by"] == "Data groups (columns coarse to fine, or all)"
    assert "custom" not in agent_ns["GENIE_WIDGET_LABELS"]["group_by"]
    assert agent_ns["INSPIRE_CUSTOM_SQL_REFUSED"] == ("Inspire does not run SQL typed into Data groups or MVP Test Run; choose columns for "
                                                      "Data groups and one of the MVP Test Run choices instead")


def test_the_built_notebook_carries_the_registry_table_so_it_never_needs_the_agent(agent_ns):
    template_source = agent_ns["IMPLEMENT_RESULT_HISTORY_SOURCE"]
    assert "INSPIRE_TECHNIQUE_RECORDS = None" in template_source
    ns = {}
    exec(compile(template_source, "<result_history>", "exec"), ns)
    ns["INSPIRE_TECHNIQUE_RECORDS"] = dict(KINDS["technique_records"])
    assert ns["inspire_grouping_applies"]("Forecasting") is True and ns["inspire_standalone"]("Extraction") is True
    assert "_inspire_kinds" not in ns, "the built notebook reads the table it carries, never the agent's asset loader"
    assert "_inspire_kinds" not in template_source, "the inlined source names no agent-only helper"


def test_a_notebook_with_no_technique_table_fails_loudly_and_the_agent_loads_its_table_lazily(agent_ns):
    ns = {}
    exec(compile(agent_ns["IMPLEMENT_RESULT_HISTORY_SOURCE"], "<result_history>", "exec"), ns)
    with pytest.raises(RuntimeError, match="technique table is not loaded"):
        ns["inspire_grouping_applies"]("Forecasting")
    ns["INSPIRE_TECHNIQUE_RECORDS_LOADER"] = lambda: {"Forecasting": "groups"}
    assert ns["inspire_grouping_applies"]("Forecasting") is True and ns["inspire_grouping_applies"]("Extraction") is False
    assert agent_ns["INSPIRE_TECHNIQUE_RECORDS"] is None, "the agent reads the registry only when a technique is asked"
    assert agent_ns["INSPIRE_TECHNIQUE_RECORDS_LOADER"]() == KINDS["technique_records"]


@pytest.mark.parametrize("records", [None, 0, 1, 400, 999, 1000, 1001, 718931])
def test_the_first_run_is_never_everything_by_default(agent_ns, records):
    spec = dict({k: v for k, v in SPEC.items() if k != "default"}, records=records)
    assert agent_ns["inspire_scope_default"](spec) == "records"
    assert agent_ns["inspire_scope_settings"](spec)[0]["default"] == "records"
    assert agent_ns["inspire_scope_default"](dict(spec, default="all")) == "records", "a v1.4.0 suggestion of all is not the default (must-exclude)"
    assert agent_ns["inspire_scope_default"](dict(spec, default="recent")) == "recent", "a build's other suggestion is kept"
    assert agent_ns["inspire_scope_default"]({}) == "all", "with no main table there is nothing to take a first run of"


def test_a_small_table_says_a_first_run_of_about_1000_records_covers_all_of_it(agent_ns):
    reason = agent_ns["inspire_scope_settings"](dict(SPEC, records=400))[0]["reason"]
    assert reason == "Inspire's default: the main table holds 400 records, so an MVP Test Run of about 1,000 records covers all of it"
    assert "covers all of them" not in reason


def _scope(widgets, spec=None, run_scope=None, **values):
    held = {"INSPIRE_RUN": {"scope": dict(SPEC, **(spec or {}))},
            "INSPIRE_SCOPE_VALUES": dict({"scope_groups": "", "scope_days": 30, "scope_records": 1000}, **values,
                                         **({"run_scope": run_scope} if run_scope is not None else {}))}
    held.update(widgets)
    return held


def test_the_whole_data_as_one_group_takes_the_first_records_and_says_so(agent_ns):
    chosen = agent_ns["inspire_scope_choice"](scope=_scope({"group_by": "all"}, run_scope="records", scope_records="500"))
    assert chosen == {"scope": "records", "table": "main.sales.orders", "records": 500, "key": "order_id", "one_group": True}
    assert agent_ns["inspire_scope_text"](chosen) == "the first 500 records of main.sales.orders, the whole data being one group"
    grouped = agent_ns["inspire_scope_choice"](scope=_scope({"group_by": "region"}, run_scope="records"))
    assert grouped.get("whole_groups") is True and "one_group" not in grouped, "a chosen grouping still takes whole groups (must-exclude)"
    unset = agent_ns["inspire_scope_choice"](scope=_scope({}, run_scope="records"))
    assert unset.get("whole_groups") is True and "one_group" not in unset, "no Data groups widget keeps the build's group column"
    alone = agent_ns["inspire_scope_choice"](scope=_scope({"group_by": "all"}, spec={"technique": "Extraction"}, run_scope="records"))
    assert "one_group" not in alone and "whole_groups" not in alone, "a standalone technique takes the first records as it always did"


@pytest.mark.parametrize("case", LEGACY["v1_4_0"], ids=[c["name"] for c in LEGACY["v1_4_0"]])
def test_what_a_v140_build_saved_still_runs_in_the_notebook(agent_ns, case):
    widgets = dict(case["widgets"])
    values = {k: widgets.pop(k) for k in ("run_scope", "scope_groups", "scope_records") if k in widgets}
    held = _scope({"group_by": widgets["group_by"]}, spec=case["spec"], **values)
    said = []
    chosen = agent_ns["inspire_scope_choice"](scope=held, out=said.append)
    want = case["agent"]
    assert chosen["scope"] == want["scope"]
    for key in ("column", "values", "records", "whole_groups", "one_group"):
        if key in want:
            assert chosen.get(key) == want[key], (key, chosen)
    if not want.get("one_group"):
        assert "one_group" not in chosen
    if want.get("said"):
        assert any(want["said"] in line for line in said), said
    else:
        assert said == []


def test_the_v140_cases_cover_every_way_a_saved_spec_changed(agent_ns):
    names = " ".join(c["name"] for c in LEGACY["v1_4_0"])
    for word in ("suggested all", "saved in v1.4.0 is kept", "grouping SQL", "First run SQL", "comma list", "no group picked", "one group"):
        assert word in names, word
    assert any(c["app"]["problems"] for c in LEGACY["v1_4_0"]) and any(not c["app"]["problems"] for c in LEGACY["v1_4_0"])
