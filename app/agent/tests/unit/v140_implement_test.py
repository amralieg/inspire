"""Start Use Case MVP with Genie: the __inspire_implement spec contract, change classes, artifact checkers, the Genie Code runner
and the Implement Use Cases operation flow, offline."""
import ast
import base64
import copy
import io
import json
import os
import re
import subprocess
import time
import tomllib
import types

import pytest
import sys

from _agentload import agent_source, method_node, top_level_defs
from v120_artifacts_support import CapturingLogger, FakeSpark, make_inspire
from v141_app_shell_test import shell_sql as SHELL_SQL
import shell_alerts as SHELL_ALERTS

FIXTURE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures", "implement_change_classes.json")

VALID = {
    "use_case_id": "N01-U01", "use_case_name": "Predict churn",
    "data": {"tables": {"main.s.orders": "main.s.orders_v2"}, "filters": [{"table": "main.s.orders_v2", "column": "region", "op": "in",
                                                                            "values": ["EU", "UK"]}], "run_profile": "preview"},
    "config": {"widgets": {"top_k": 25}, "result_table": "main.inspire.churn_out", "warehouse_id": "wh1"},
    "schedule": {"enabled": True, "cron": "0 0 6 ? * MON", "timezone": "Asia/Dubai"},
    "outputs": {"dashboard": True, "genie_space": True, "app": True, "app_name": "churn-desk", "app_access": "sp",
                "inspire_url": "https://inspire.example.com"},
    "sharing": {"principals": [{"type": "group", "name": "planners"}, {"type": "group", "name": "Planners"}]},
}


def _spec(ns, **changes):
    spec = json.loads(json.dumps(VALID))
    spec.update(changes)
    out, errors = ns["validate_implement_spec"](spec)
    return out, errors


def test_implement_job_params_are_notebook_widgets():
    widgets = ast.unparse(top_level_defs()["create_widgets"])
    assert "inspire_implement_use_case" in widgets
    assert "inspire_implement_spec_version" in widgets
    assert "inspire_implement_run_id" not in widgets


def test_operation_enum_has_three_values_everywhere(agent_ns):
    assert agent_ns["INSPIRE_OPERATIONS"] == ("Discover Use Cases", "Generate Use Cases", "Implement Use Cases")
    assert agent_ns["INSPIRE_ATTACHING_OPERATIONS"] == ("Generate Use Cases", "Implement Use Cases")
    widgets = ast.unparse(top_level_defs()["create_widgets"])
    assert "operation_options = list(INSPIRE_OPERATIONS)" in widgets
    main = ast.unparse(top_level_defs()["main"])
    assert "_valid_operations = set(INSPIRE_OPERATIONS)" in main
    assert "INSPIRE_OPERATIONS" in ast.unparse(method_node("DatabricksInspire", "__init__"))


def test_implement_table_ddl_has_every_column_and_variant_payloads(agent_ns):
    sql = agent_ns["implement_table_create_sql"]("`c`.`s`.__inspire_implement")
    assert sql.startswith("CREATE TABLE IF NOT EXISTS `c`.`s`.__inspire_implement (")
    for name, kind in agent_ns["IMPLEMENT_COLUMNS"]:
        assert f"`{name}` {kind}" in sql
    for name in ("spec_json", "asset_status", "genie_widgets", "data_profiles", "suggested_schedule"):
        assert f"`{name}` VARIANT" in sql
    assert "CLUSTER BY (`session_id`, `use_case_id`)" in sql
    assert set(agent_ns["IMPLEMENT_STATUSES"]) == {"queued", "filling", "previewing", "building_outputs", "checking", "ready",
                                                   "ready_with_warnings", "failed", "uninstalled", "vibe_not_met"}


def test_valid_spec_normalizes(agent_ns):
    spec, errors = _spec(agent_ns)
    assert errors == []
    assert spec["config"]["widgets"] == {"top_k": "25"}
    assert spec["data"]["filters"][0]["values"] == ["EU", "UK"]
    assert spec["sharing"]["principals"] == [{"type": "group", "name": "planners"}], "the same principal is listed once"
    assert spec["outputs"]["app_name"] == "churn-desk"


def test_spec_without_outputs_defaults_to_the_dashboard_which_needs_the_inspire_address(agent_ns):
    raw = {k: v for k, v in VALID.items() if k != "outputs"}
    spec, errors = agent_ns["validate_implement_spec"](raw)
    assert errors == [agent_ns["IMPLEMENT_APP_HOSTED_ERRORS"]["inspire_url"]]
    assert spec["outputs"]["dashboard"] is True and not spec["outputs"]["genie_space"] and not spec["outputs"]["app"]


@pytest.mark.parametrize("changes,needle", [
    ({"use_case_id": ""}, "use_case_id is required"),
    ({"outputs": {"app": True, "app_name": "Churn_App"}}, "app_name"),
    ({"outputs": {"app": True, "app_name": "ab"}}, "app_name"),
    ({"config": {"widgets": {}}}, "SQL warehouse is required"),
    ({"schedule": {"enabled": True, "cron": ""}}, "needs a cron"),
    ({"schedule": {"cron": "every monday"}}, "Quartz cron"),
    ({"data": {"filters": [{"table": "main.s.t", "column": "c", "op": "like", "values": ["x"]}]}}, "operator"),
    ({"data": {"filters": [{"table": "main.s.t", "column": "c", "op": "between", "values": ["1"]}]}}, "two values"),
    ({"data": {"filters": [{"table": "t", "column": "c", "op": "=", "values": ["1"]}]}}, "catalog.schema.table"),
    ({"data": {"tables": {"main.s.orders": "orders_v2"}}}, "table swap"),
    ({"data": {"run_profile": "huge"}}, "run_profile"),
    ({"config": {"warehouse_id": "w", "widgets": {"bad name": "1"}}}, "widget name"),
    ({"sharing": {"principals": [{"type": "group", "name": "a`b"}]}}, "principal"),
    ({"sharing": {"principals": [{"type": "robot", "name": "x"}]}}, "principal"),
])
def test_invalid_specs_are_rejected(agent_ns, changes, needle):
    _spec_out, errors = _spec(agent_ns, **changes)
    assert any(needle in e for e in errors), errors


def test_spec_that_is_not_json_is_rejected(agent_ns):
    assert agent_ns["validate_implement_spec"]("{nope")[1][0].startswith("the spec is not valid JSON")
    assert agent_ns["validate_implement_spec"]([1])[1] == ["the spec must be a JSON object"]


def test_change_classes_match_the_shared_fixture(agent_ns):
    cases = json.load(open(FIXTURE))["cases"]
    assert len(cases) >= 10
    for case in cases:
        previous = agent_ns["validate_implement_spec"](case["previous"])[0] if case["previous"] else None
        current = agent_ns["validate_implement_spec"](case["current"])[0]
        assert agent_ns["classify_implement_change"](previous, current, case.get("built_settings")) == case["classes"], case["name"]


SHARED_PLAN_LISTS = ("build", "refresh", "rollback", "delete", "keep_unmanaged")
SHARED_PLAN_KEYS = ("classes", "refill") + SHARED_PLAN_LISTS + ("schedule",)


def _shared_plan(agent_ns, previous, current, entry, built=None) -> dict:
    validate = agent_ns["validate_implement_spec"]
    plan = agent_ns["implement_plan"](validate(previous)[0] if previous else None, validate(current)[0], dict(entry["assets"]),
                                      has_built_notebook=entry.get("has_built_notebook", True), built=built)
    return {key: sorted(plan[key]) if key in SHARED_PLAN_LISTS else plan[key] for key in SHARED_PLAN_KEYS}


def test_change_plans_match_the_shared_fixture(agent_ns):
    fixture = json.load(open(FIXTURE))
    cases = {case["name"]: case for case in fixture["cases"]}
    assert len(fixture["plans"]) >= 80
    for entry in fixture["plans"]:
        case = cases[entry["case"]]
        assert tuple(entry["summary"]) == SHARED_PLAN_KEYS, entry["name"]
        assert _shared_plan(agent_ns, case["previous"], case["current"], entry, case.get("built_settings")) == entry["summary"], \
            entry["name"]


def test_the_app_s_notebook_plan_cases_match_the_agent_plan_with_each_case_s_own_built_notebook(agent_ns):
    plans = json.load(open(NOTEBOOK_PARITY))["plans"]
    assert len(plans) >= 6 and {entry["has_built_notebook"] for entry in plans} == {True, False}
    for entry in plans:
        assert tuple(entry["summary"]) == SHARED_PLAN_KEYS, entry["name"]
        assert _shared_plan(agent_ns, entry["previous"], entry["current"], entry) == entry["summary"], entry["name"]


def test_plan_never_deletes_an_unticked_output_unless_asked(agent_ns):
    plan_fn, validate = agent_ns["implement_plan"], agent_ns["validate_implement_spec"]
    before = validate(VALID)[0]
    after = validate(dict(VALID, outputs={"dashboard": False, "genie_space": True, "app": True, "app_name": "churn-desk",
                                          "app_access": "sp", "inspire_url": VALID["outputs"]["inspire_url"]}))[0]
    assets = {"dashboard": "d1", "genie_space": "g1", "app": "churn-desk", "preview_run_id": 7}
    plan = plan_fn(before, after, assets, has_built_notebook=True)
    assert plan["classes"] == ["deselect"] and plan["delete"] == [] and plan["keep_unmanaged"] == ["dashboard"]
    assert plan["refill"] is False and plan["preview"] is False and plan["build"] == [] and plan["refresh"] == []
    asked = validate(dict(VALID, outputs=after["outputs"], removed_outputs={"dashboard": "delete"}))[0]
    plan = plan_fn(before, asked, assets, has_built_notebook=True)
    assert plan["delete"] == ["dashboard"] and plan["keep_unmanaged"] == []


def test_outputs_only_edit_builds_the_new_output_without_rebuilding(agent_ns):
    validate = agent_ns["validate_implement_spec"]
    before = validate(dict(VALID, outputs={"dashboard": True}))[0]
    after = validate(dict(VALID, outputs={"dashboard": True, "genie_space": True}))[0]
    plan = agent_ns["implement_plan"](before, after, {"dashboard": "d1", "preview_run_id": 9}, has_built_notebook=True)
    assert plan["classes"] == ["outputs"] and plan["build"] == ["genie_space"] and plan["refresh"] == []
    assert plan["refill"] is False and plan["preview"] is False and plan["sharing"] is True


@pytest.mark.parametrize("before,after,classes", [
    (None, {"enabled": True, "share": 0.2}, ["holdout"]),
    ({"enabled": True, "share": 0.1}, {"enabled": True, "share": 0.2}, ["holdout"]),
    ({"enabled": True, "share": 0.1}, {"enabled": False, "share": 0.1}, ["holdout"]),
    ({"enabled": True, "share": 0.1}, None, ["holdout"]),
    (None, {"enabled": False, "share": 0.25}, []),
    ({"enabled": False, "share": 0.1}, {"enabled": False, "share": 0.3}, []),
    ({"enabled": True, "share": 0.2}, {"enabled": True, "share": "0.2"}, []),
], ids=["turned_on", "share_raised", "turned_off", "dropped", "sent_but_off", "off_share_moved", "same_share_as_text"])
def test_a_holdout_only_edit_is_its_own_change_and_rebuilds_nothing(agent_ns, before, after, classes):
    validate = agent_ns["validate_implement_spec"]
    previous = validate(dict(VALID, **({"holdout": before} if before is not None else {})))[0]
    current = validate(dict(VALID, **({"holdout": after} if after is not None else {})))[0]
    assets = {"dashboard": "d1", "genie_space": "g1", "app": "churn-desk", "preview_run_id": 9}
    plan = agent_ns["implement_plan"](previous, current, assets, has_built_notebook=True)
    assert plan["classes"] == classes
    assert plan["refill"] is False and plan["preview"] is False and plan["schedule"] is False and plan["sharing"] is False
    assert (plan["build"], plan["refresh"], plan["restyle"], plan["rollback"], plan["delete"]) == ([], [], [], {}, [])


def test_data_change_rebuilds_and_refreshes_every_existing_output(agent_ns):
    validate = agent_ns["validate_implement_spec"]
    before = validate(VALID)[0]
    after = validate(dict(VALID, data=dict(VALID["data"], run_profile="full")))[0]
    plan = agent_ns["implement_plan"](before, after, {"dashboard": "d", "genie_space": "g", "app": "churn-desk"}, True)
    assert plan["refill"] and plan["preview"] and plan["refresh"] == ["genie_space", "dashboard", "app"] and plan["build"] == []


def test_first_submission_or_missing_notebook_builds_everything(agent_ns):
    spec = agent_ns["validate_implement_spec"](VALID)[0]
    plan = agent_ns["implement_plan"](None, spec)
    assert plan["classes"] == ["initial"] and plan["refill"] and plan["preview"] and plan["schedule"]
    assert plan["build"] == ["genie_space", "dashboard", "app"], "the Genie Agent is built first so the dashboard and the App link it"
    plan = agent_ns["implement_plan"](spec, spec, {"dashboard": "d"}, has_built_notebook=False)
    assert plan["refill"], "a lost notebook is rebuilt even when the spec did not change"


def test_choices_markdown_carries_every_wizard_choice(agent_ns):
    spec = agent_ns["validate_implement_spec"](VALID)[0]
    text = agent_ns["implement_choices_markdown"](spec)
    assert text.startswith("## Implementation Choices")
    assert "Read `main.s.orders_v2` wherever this instruction reads `main.s.orders`" in text
    assert "`region` in 'EU', 'UK'" in text
    assert "`main.inspire.churn_out`" in text and "Default of widget `top_k`: `25`" in text
    assert "`run_profile`" in text and "preview" in text and "full" in text
    assert "win over anything above" in text


def test_job_parameters_only_pass_known_widgets(agent_ns):
    spec = agent_ns["validate_implement_spec"](dict(VALID, config=dict(VALID["config"], widgets={"top_k": 5, "unknown": 1},
                                                                                         ai_endpoint="ep")))[0]
    params = agent_ns["implement_job_parameters"](["top_k", "result_table", "ai_endpoint", "run_profile"], spec, "preview")
    assert params == {"top_k": "5", "result_table": "main.inspire.churn_out", "ai_endpoint": "ep", "run_profile": "preview",
                      "refresh_requested_by": "schedule", agent_ns["INSPIRE_CHILD_MARKER"]: "1"}
    assert agent_ns["implement_job_parameters"]([], spec, "bogus")["run_profile"] == "preview"


def test_use_case_outcome_parses_the_three_shapes(agent_ns):
    parse = agent_ns["parse_use_case_outcome"]
    written = parse("Job run finished: wrote 812 rows for as_of_date 2026-10-01 with run_id 1b2c3d4e-0000-4000-8000-000000000000")
    assert written == {"status": "written", "rows_written": 812, "as_of_date": "2026-10-01",
                       "run_id": "1b2c3d4e-0000-4000-8000-000000000000"}
    assert parse("stopped without writing: History covers too few closed outcome windows (1)")["status"] == "stopped"
    assert parse("Job run finished: wrote 1 row for as_of_date 2026-10-01 with run_id 1b2c3d4e-0000")["rows_written"] == 1
    assert parse("Job run finished: wrote 812 " + "row(s) for as_of_date 2026-10-01 with run_id 1b2c3d4e-0000")["rows_written"] == 812, \
        "a notebook released main 4407364 built still says row(s), and its outcome is still read"
    assert parse(None)["status"] == "unknown"
    template = agent_ns["GENIE_RUN_CONTROLS_TEMPLATE"]
    source = template[template.index("def inspire_outcome_text"):template.index("def inspire_main(")]
    writer_ns = {"inspire_plural": agent_ns["inspire_plural"]}
    exec(source, writer_ns)
    assert writer_ns["inspire_outcome_text"]({"status": "written", "rows_written": 1, "as_of_date": "2026-01-01",
                                              "run_id": "abcdef12-3456"}) == "wrote 1 row for as_of_date 2026-01-01 with run_id abcdef12-3456"
    written = writer_ns["inspire_outcome_text"]({"status": "written", "rows_written": 3, "as_of_date": "2026-01-01",
                                                 "run_id": "abcdef12-3456"})
    assert parse(written) == {"status": "written", "rows_written": 3, "as_of_date": "2026-01-01", "run_id": "abcdef12-3456"}
    stopped = writer_ns["inspire_outcome_text"]({"status": "stopped", "stop_reason": "too little history"})
    assert parse(stopped) == {"status": "stopped", "stop_reason": "too little history"}


def test_genie_fill_result_must_list_every_widget_and_valid_dropdowns(agent_ns):
    check = agent_ns["validate_genie_fill_result"]
    good = {"widgets": [{"name": "result_table", "type": "text", "default": "a.b.c", "choices": []},
                        {"name": "run_profile", "type": "dropdown", "default": "full", "choices": ["preview", "full"]}],
            "schedule": {"cron": "0 0 6 * * ?"}}
    assert check(good, ["result_table"]) == []
    bad = json.loads(json.dumps(good))
    bad["widgets"][1]["default"] = "all"
    bad["schedule"]["cron"] = "weekly"
    errors = check(bad, ["result_table", "top_k"])
    assert any("outside its choices" in e for e in errors)
    assert any("top_k" in e for e in errors)
    assert any("Quartz" in e for e in errors)
    assert check(None, []) == ["Genie returned no JSON result"]
    assert check({}, ["result_table", "top_k"]) == ["Genie returned no JSON result"]
    assert any("run_profile" in e for e in check({"widgets": [good["widgets"][0]]}, ["result_table"]))


def _dashboard(tables=("main.inspire.churn_out",), decision=True, write=False, missing_dataset=False):
    datasets = [{"name": "decision_list" if decision else "rows", "queryLines": [f"SELECT * FROM {tables[0]} WHERE rank < 10"]}]
    if len(tables) > 1:
        datasets.append({"name": "inputs", "queryLines": [f"SELECT * FROM {tables[1]} JOIN main.inspire.churn_out USING (id)"]})
    if write:
        datasets.append({"name": "w", "queryLines": ["DELETE FROM main.inspire.churn_out"]})
    widget_ds = "nope" if missing_dataset else datasets[0]["name"]
    return json.dumps({"datasets": datasets, "pages": [{"name": "p", "layout": [
        {"widget": {"name": "t", "queries": [{"name": "q", "query": {"datasetName": widget_ds}}]}}]}]})


def _built_dashboard(ns, tmp_path):
    payload, modules = _app_shell(ns, tmp_path)
    page = ns["implement_app_page"](_churn_page(ns), "N01-U01", {})
    return ns["implement_dashboard_from_page"](page, modules["shell_sql"], "main.inspire.churn_out", {},
                                               theme=ns["implement_dashboard_theme"](payload["palettes"]))


def test_dashboard_checker_accepts_a_grounded_dashboard(agent_ns, tmp_path):
    built = _built_dashboard(agent_ns, tmp_path)
    dashboard, errors = agent_ns["check_dashboard_definition"](json.dumps(built), ["main.inspire.churn_out", "main.s.orders"], "records")
    parts = [f"chart_{i}_parts" for i, c in enumerate(_churn_page(agent_ns)["charts"]) if c["type"] in agent_ns["IMPLEMENT_DASHBOARD_PART_CHARTS"]]
    assert parts and errors == [] and [d["name"] for d in dashboard["datasets"]] == ["trend", "records", "run_health", *parts]


@pytest.mark.parametrize("kwargs,needle", [
    ({"decision": False}, "decision_list"),
    ({"tables": ("main.inspire.churn_out", "other.s.secret")}, "outside this use case"),
    ({"write": True}, "writes data"),
    ({"missing_dataset": True}, "does not define"),
])
def test_dashboard_checker_rejects(agent_ns, kwargs, needle):
    _d, errors = agent_ns["check_dashboard_definition"](_dashboard(**kwargs), ["main.inspire.churn_out", "main.s.orders"])
    assert any(needle in e for e in errors), errors


def test_dashboard_checker_rejects_bad_json(agent_ns):
    assert "not valid JSON" in agent_ns["check_dashboard_definition"]("{", [])[1][0]


FLAG_SHARE_SQL = ("SELECT run_id, as_of_date, COUNT(*) AS row_count, model_version, "
                  "CAST(COUNT_IF(NULLIF(TRIM(data_quality_flag), '') IS NOT NULL) AS DOUBLE) / COUNT(*) AS flagged_share "
                  "FROM main.inspire.churn_out GROUP BY run_id, as_of_date, model_version ORDER BY as_of_date DESC")


@pytest.mark.parametrize("text,flagged", [
    (FLAG_SHARE_SQL, True),
    ("SELECT COUNT(data_quality_flag) / COUNT(*) FROM main.inspire.churn_out", True),
    ("SELECT COUNT(*) FILTER (WHERE data_quality_flag IS NOT NULL) FROM main.inspire.churn_out", True),
    ("SELECT avg(CASE WHEN data_quality_flag IS NULL THEN 0 ELSE 1 END) FROM main.inspire.churn_out", True),
    ("flagged = df.agg(F.count(F.when(F.col('data_quality_flag').isNotNull(), 1)))", True),
    ("SELECT COUNT_IF(data_quality_flag <> 'ok') / COUNT(*) FROM main.inspire.churn_out", False),
    ("SELECT AVG(CASE WHEN lower(data_quality_flag) != 'OK' THEN 1 ELSE 0 END) FROM main.inspire.churn_out", False),
    ('flagged = df.agg(F.count(F.when(F.col("data_quality_flag") != "ok", 1)))', False),
    ("SELECT rank, entity_id, data_quality_flag FROM main.inspire.churn_out ORDER BY rank", False),
    ("SELECT data_quality_flag, COUNT(*) AS n FROM main.inspire.churn_out GROUP BY data_quality_flag", False),
])
def test_flag_counts_must_compare_the_flag_with_ok(agent_ns, text, flagged):
    problems = agent_ns["_implement_flag_count_problems"]([text], "a query")
    assert bool(problems) is flagged, problems
    if flagged:
        assert problems == ["a query counts data_quality_flag without comparing it to 'ok': the notebook writes 'ok' on every row "
                            "that passed its checks, so only a value other than 'ok' marks a flagged row"]


def test_every_output_checker_rejects_a_flag_count_without_ok(agent_ns, tmp_path):
    allowed = ["main.inspire.churn_out", "main.s.orders"]
    board = _built_dashboard(agent_ns, tmp_path)
    board["datasets"][-1]["queryLines"] = [FLAG_SHARE_SQL]
    assert any(e.startswith("a dashboard dataset counts data_quality_flag") for e in
               agent_ns["check_dashboard_definition"](json.dumps(board), allowed, "records")[1])
    assert any(e.startswith("an example SQL of the Genie Agent counts data_quality_flag") for e in
               agent_ns["normalize_genie_space"](_space(sql=FLAG_SHARE_SQL), allowed)[3])
    shell_sql = _app_shell(agent_ns, tmp_path)[1]["shell_sql"]
    page = _churn_page(agent_ns)
    page["datasets"].append({"name": "run_health", "sql": FLAG_SHARE_SQL})
    assert any(e.startswith("the page counts data_quality_flag") for e in
               agent_ns["implement_app_page_problems"](page, shell_sql, allowed, False))
    condition = "SELECT COUNT_IF(data_quality_flag IS NOT NULL) > 3 AS triggered FROM main.inspire.churn_out"
    assert any(e.startswith("alert_condition.sql counts data_quality_flag") for e in
               agent_ns["check_alert_condition_sql"](condition, allowed))
    fixed = FLAG_SHARE_SQL.replace("NULLIF(TRIM(data_quality_flag), '') IS NOT NULL", "data_quality_flag <> 'ok'")
    board["datasets"][-1]["queryLines"] = [fixed]
    assert agent_ns["check_dashboard_definition"](json.dumps(board), allowed, "records")[1] == []
    assert agent_ns["normalize_genie_space"](_space(sql=fixed), allowed)[3] == []
    page["datasets"][-1]["sql"] = fixed
    assert agent_ns["implement_app_page_problems"](page, shell_sql, allowed, False) == []
    assert agent_ns["check_alert_condition_sql"](condition.replace("IS NOT NULL", "<> 'ok'"), allowed) == []


def _space(tables=("main.inspire.churn_out",), questions=True, sql="SELECT COUNT(*) FROM main.inspire.churn_out", grounded=False):
    asked = ["Which customers act now?", "b"] if grounded else ["q"]
    space = {"title": "Churn desk", "description": "d", "serialized_space": {
        "config": {"sample_questions": [{"question": "Which customers act now?"}, {"id": "f" * 32, "question": ["b"]}] if questions else []},
        "data_sources": {"tables": [{"identifier": t} for t in tables]},
        "instructions": {"text_instructions": [{"content": ["x"]}],
                         "example_question_sqls": [{"question": [q], "sql": [sql]} for q in asked]}}}
    if grounded:
        space["serialized_space"]["benchmarks"] = {"questions": [
            {"question": [f"How many rows are in tier {tier}?"], "answer": [{"format": "SQL", "content": [sql]}]}
            for tier in ("Act now", "Review", "Monitor")]}
    return json.dumps(space)


def test_benchmarks_written_beside_serialized_space_are_read_as_its_benchmarks(agent_ns):
    allowed = ["main.inspire.churn_out"]
    raw = json.loads(_space(grounded=True))
    raw["benchmarks"] = raw["serialized_space"].pop("benchmarks")
    _t, _d, space, errors = agent_ns["normalize_genie_space"](json.dumps(raw), allowed)
    assert errors == [] and len(space["benchmarks"]["questions"]) == 3
    assert agent_ns["_implement_genie_benchmark_problems"](space, set(), allowed) == []
    raw["serialized_space"]["benchmarks"] = {"questions": []}
    errors = agent_ns["normalize_genie_space"](json.dumps(raw), allowed)[3]
    assert "genie_space.json has benchmarks both at its top level and in serialized_space; keep only the one in serialized_space" in errors


SPACE_COLUMNS = {"main.inspire.churn_out": [(n, t, f"the {n.replace('_', ' ')}") for n, t in (
    ("as_of_date", "date"), ("entity_id", "string"), ("entity_label", "string"), ("priority_tier", "string"), ("rank", "int"),
    ("top_reasons", "array<string>"), ("explanation", "string"), ("value", "double"), ("run_id", "string"))]}


def test_genie_space_normalization_assigns_ids_and_sorts(agent_ns):
    title, _desc, space, errors = agent_ns["normalize_genie_space"](_space(("main.s.orders", "main.inspire.churn_out")),
                                                                    ["main.inspire.churn_out", "main.s.orders"])
    assert errors == [] and title == "Churn desk" and space["version"] == 2
    ids = [q["id"] for q in space["config"]["sample_questions"]]
    assert all(len(i) == 32 for i in ids) and ids == sorted(ids)
    assert all(isinstance(q["question"], list) for q in space["config"]["sample_questions"])
    assert [t["identifier"] for t in space["data_sources"]["tables"]] == ["main.inspire.churn_out", "main.s.orders"]
    assert len(space["instructions"]["example_question_sqls"][0]["id"]) == 32


def test_genie_space_normalization_meets_every_ordering_and_shape_rule_of_the_api(agent_ns):
    same = "a" * 32
    raw = {"title": "Churn desk", "serialized_space": {
        "config": {"sample_questions": [{"id": same, "question": "Which customers act now?"}]},
        "benchmarks": {"questions": [{"id": same, "question": "Who churns?", "answer": [{"format": "SQL", "content": "SELECT 1"}]},
                                     {"question": ["Top 5?"]}]},
        "data_sources": {
            "tables": [{"identifier": "main.s.orders", "column_configs": [{"column_name": "zone"}, {"column_name": "amount"}]},
                       {"identifier": "main.inspire.churn_out", "column_configs": [{"column_name": "rank"}, {"column_name": "entity_id"},
                                                                                   {"column_name": "value"}]}],
            "metric_views": [{"identifier": "main.inspire.churn_out", "column_configs": [{"column_name": "b"}, {"column_name": "a"}]}]},
        "instructions": {
            "text_instructions": [{"id": "b" * 32, "content": ["Rank 1 is the most urgent."]}, {"content": "Act now rows come first.\n"}],
            "example_question_sqls": [{"id": "c" * 32, "question": "How many act now?",
                                       "sql": "SELECT COUNT_IF(priority_tier = 'Act now') FROM main.inspire.churn_out"}],
            "join_specs": [{"id": "c" * 32, "left": {"identifier": "main.s.orders"}, "right": {"identifier": "main.inspire.churn_out"},
                            "sql": ["`o`.`id` = `c`.`entity_id`", "--rt=FROM_RELATIONSHIP_TYPE_MANY_TO_ONE--"]}]}}}
    title, _d, space, errors = agent_ns["normalize_genie_space"](json.dumps(raw), ["main.inspire.churn_out", "main.s.orders"])
    assert errors == [] and title == "Churn desk"
    tables = space["data_sources"]["tables"]
    assert [t["identifier"] for t in tables] == ["main.inspire.churn_out", "main.s.orders"]
    assert [c["column_name"] for c in tables[0]["column_configs"]] == ["entity_id", "rank", "value"]
    assert [c["column_name"] for c in tables[1]["column_configs"]] == ["amount", "zone"]
    assert [c["column_name"] for c in space["data_sources"]["metric_views"][0]["column_configs"]] == ["a", "b"]
    questions = space["config"]["sample_questions"] + space["benchmarks"]["questions"]
    assert len({q["id"] for q in questions}) == 3 and space["config"]["sample_questions"][0]["id"] == same
    assert all(len(q["id"]) == 32 for q in questions)
    assert [q["id"] for q in space["benchmarks"]["questions"]] == sorted(q["id"] for q in space["benchmarks"]["questions"])
    (answered,) = [q for q in space["benchmarks"]["questions"] if q.get("answer")]
    assert answered["question"] == ["Who churns?"] and answered["answer"][0]["content"] == ["SELECT 1"]
    (text,) = space["instructions"]["text_instructions"]
    assert "".join(text["content"]) == "Rank 1 is the most urgent.\n\nAct now rows come first."
    example, join = space["instructions"]["example_question_sqls"][0], space["instructions"]["join_specs"][0]
    assert example["question"] == ["How many act now?"] and isinstance(example["sql"], list)
    assert "".join(example["sql"]) == "SELECT COUNT_IF(priority_tier = 'Act now') FROM main.inspire.churn_out"
    assert len({text["id"], example["id"], join["id"]}) == 3
    assert join["sql"] == ["`o`.`id` = `c`.`entity_id`\n", "--rt=FROM_RELATIONSHIP_TYPE_MANY_TO_ONE--"]
    outside = json.loads(json.dumps(raw))
    outside["serialized_space"]["data_sources"]["metric_views"] = [{"identifier": "hr.s.pay_metrics"}]
    assert "the Genie Agent uses metric view hr.s.pay_metrics, which is outside this use case" in \
        agent_ns["normalize_genie_space"](json.dumps(outside), ["main.inspire.churn_out", "main.s.orders"])[3]


@pytest.mark.parametrize("kwargs,needle", [
    ({"tables": ("main.inspire.churn_out", "hr.s.salaries")}, "outside this use case"),
    ({"questions": False}, "no sample questions"),
    ({"sql": "SELECT * FROM hr.s.salaries"}, "outside this use case"),
    ({"sql": "DROP TABLE main.inspire.churn_out"}, "writes data"),
])
def test_genie_space_normalization_rejects(agent_ns, kwargs, needle):
    errors = agent_ns["normalize_genie_space"](_space(**kwargs), ["main.inspire.churn_out", "main.s.orders"])[3]
    assert any(needle in e for e in errors), errors


def _joined_space(sql):
    space = json.loads(_space(("main.inspire.churn_out", "main.s.orders")))
    space["serialized_space"]["instructions"]["join_specs"] = [
        {"left": {"identifier": "main.s.orders", "alias": "o"}, "right": {"identifier": "main.inspire.churn_out", "alias": "c"}, "sql": sql}]
    return json.dumps(space)


@pytest.mark.parametrize("sql", [
    ["`o`.`id` = `c`.`entity_id`"],
    "`o`.`id` = `c`.`entity_id`",
    ["`o`.`id` = `c`.`entity_id`", "--rt=FROM_RELATIONSHIP_TYPE_SOME--"],
    ["--rt=FROM_RELATIONSHIP_TYPE_MANY_TO_ONE--", "`o`.`id` = `c`.`entity_id`"],
    ["--rt=FROM_RELATIONSHIP_TYPE_MANY_TO_ONE--"],
    ["`o`.`id` = `c`.`entity_id`", "AND `o`.`d` = `c`.`as_of_date`", "--rt=FROM_RELATIONSHIP_TYPE_MANY_TO_ONE--"],
    ["`o`.`id` = `c`.`entity_id`", "--rt=from_relationship_type_many_to_one--"],
])
def test_a_join_without_one_valid_relationship_tag_goes_back_to_genie(agent_ns, sql):
    errors = agent_ns["normalize_genie_space"](_joined_space(sql), ["main.inspire.churn_out", "main.s.orders"])[3]
    assert len(errors) == 1, errors
    assert errors[0].startswith("the join spec o to c has sql [")
    assert errors[0].endswith("it must be exactly two items, the join condition and then the relationship tag that matches the key's "
                              "cardinality, one of --rt=FROM_RELATIONSHIP_TYPE_MANY_TO_ONE--, --rt=FROM_RELATIONSHIP_TYPE_ONE_TO_MANY--, "
                              "--rt=FROM_RELATIONSHIP_TYPE_ONE_TO_ONE--, --rt=FROM_RELATIONSHIP_TYPE_MANY_TO_MANY--")


@pytest.mark.parametrize("kind", ["MANY_TO_ONE", "ONE_TO_MANY", "ONE_TO_ONE", "MANY_TO_MANY"])
def test_a_join_with_its_relationship_tag_passes(agent_ns, kind):
    sql = ["`o`.`id` = `c`.`entity_id`", f"--rt=FROM_RELATIONSHIP_TYPE_{kind}--"]
    _t, _d, space, errors = agent_ns["normalize_genie_space"](_joined_space(sql), ["main.inspire.churn_out", "main.s.orders"])
    assert errors == []
    assert space["instructions"]["join_specs"][0]["sql"] == ["`o`.`id` = `c`.`entity_id`\n", f"--rt=FROM_RELATIONSHIP_TYPE_{kind}--"]


def test_the_genie_space_prompt_shows_the_join_tag(agent_ns):
    fmt = agent_ns["DatabricksInspire"]._GENIE_SPACE_FORMAT
    join = json.loads(fmt)["serialized_space"]["instructions"]["join_specs"][0]
    assert join["sql"] == ["`a`.`k` = `b`.`k`", "--rt=FROM_RELATIONSHIP_TYPE_MANY_TO_ONE--"]
    assert agent_ns["_implement_join_spec_problems"](join) == []
    inst = _inspire(agent_ns, FakeSpark())
    inst._genie_decision_contract = _contract
    seen = {}
    inst._implement_genie_loop = lambda context, runner, label, prompt, deploy: seen.update(prompt=prompt) or {}
    inst._implement_genie_space(_output_context(agent_ns), None)
    assert ("- Join specs for the verified join path. Each join's sql is exactly two items: the join condition, then the relationship "
            "tag that matches the key's cardinality, one of --rt=FROM_RELATIONSHIP_TYPE_MANY_TO_ONE--, "
            "--rt=FROM_RELATIONSHIP_TYPE_ONE_TO_MANY--, --rt=FROM_RELATIONSHIP_TYPE_ONE_TO_ONE--, "
            "--rt=FROM_RELATIONSHIP_TYPE_MANY_TO_MANY--; check the cardinality with a COUNT(DISTINCT key) query before you choose it.\n"
            ) in seen["prompt"]


ACCESS_TABLE = "main.inspire.churn_out"


def _row(level, privilege, principal, mine=False):
    return {"level": level, "privilege": privilege, "principal": principal, "mine": mine, "me": "inspire-sp"}


LIVE_ACCESS = [_row("catalog", "OWNER", "amr@x"), _row("schema", "OWNER", "amr@x"), _row("table", "OWNER", "inspire-sp", True),
               _row("catalog", "USE_CATALOG", "inspire-sp", True), _row("catalog", "BROWSE", "account users", True),
               _row("schema", "USE_SCHEMA", "inspire-sp", True), _row("schema", "SELECT", "inspire-sp", True)]
GRANT_CATALOG = "GRANT USE CATALOG ON CATALOG `main` TO `{}`"
GRANT_SCHEMA = "GRANT USE SCHEMA ON SCHEMA `main`.`inspire` TO `{}`"
GRANT_SELECT = "GRANT SELECT ON TABLE `main`.`inspire`.`churn_out` TO `{}`"
NEED_CATALOG = {"privilege": "USE CATALOG", "level": "catalog", "object": "`main`"}
NEED_SCHEMA = {"privilege": "USE SCHEMA", "level": "schema", "object": "`main`.`inspire`"}
NEED_SELECT = {"privilege": "SELECT", "level": "table", "object": "`main`.`inspire`.`churn_out`"}
GAP_CATALOG = dict(NEED_CATALOG, owner="amr@x")
GAP_SCHEMA = dict(NEED_SCHEMA, owner="amr@x")


@pytest.mark.parametrize("extra,principal,grants,gaps", [
    ([], "amr@x", [NEED_SELECT], []),
    ([], "AMR@X", [NEED_SELECT], []),
    ([], "bob@x", [NEED_SELECT], [GAP_CATALOG, GAP_SCHEMA]),
    ([], "", [], [GAP_CATALOG, GAP_SCHEMA]),
    ([_row("catalog", "USE CATALOG", "account users", True)], "", [], [GAP_SCHEMA]),
    ([_row("catalog", "USE_SCHEMA", "account users", True)], "bob@x", [NEED_SELECT], [GAP_CATALOG]),
    ([_row("schema", "MANAGE", "inspire-sp", True)], "bob@x", [NEED_SCHEMA, NEED_SELECT], [GAP_CATALOG]),
    ([_row("catalog", "MANAGE", "inspire-admins", True)], "bob@x",
     [NEED_CATALOG, NEED_SCHEMA, NEED_SELECT], []),
    ([_row("catalog", "MANAGE", "someone-else")], "bob@x", [NEED_SELECT], [GAP_CATALOG, GAP_SCHEMA]),
    ([_row("catalog", "ALL_PRIVILEGES", "bob@x")], "bob@x", [], []),
    ([_row("catalog", "USE_CATALOG", "bob@x"), _row("catalog", "USE_SCHEMA", "bob@x"), _row("schema", "SELECT", "bob@x")], "bob@x", [], []),
    ([_row("catalog", "OWNER", "bob@x")], "bob@x", [NEED_SELECT], [GAP_SCHEMA]),
    ([_row("table", "SELECT", "bob@x")], "bob@x", [], [GAP_CATALOG, GAP_SCHEMA]),
])
def test_access_plan_skips_what_a_principal_has_and_grants_only_what_inspire_manages(agent_ns, extra, principal, grants, gaps):
    plan = agent_ns["implement_access_plan"](ACCESS_TABLE, LIVE_ACCESS + extra, principal)
    assert plan == {"grants": grants, "gaps": gaps, "me": "inspire-sp"}


def test_access_plan_for_a_new_table_lets_inspire_grant_select_it_will_own(agent_ns):
    rows = [r for r in LIVE_ACCESS if r["level"] != "table"]
    assert agent_ns["implement_access_plan"](ACCESS_TABLE, rows, "bob@x")["grants"] == [NEED_SELECT]
    assert agent_ns["implement_access_plan"](ACCESS_TABLE, [], "bob@x") == {
        "grants": [NEED_SELECT], "gaps": [dict(GAP_CATALOG, owner=""), dict(GAP_SCHEMA, owner="")], "me": ""}


def test_access_plan_without_access_rows_grants_blind_and_rejects_unsafe_input(agent_ns):
    plan = agent_ns["implement_access_plan"]
    assert plan(ACCESS_TABLE, None, "planners") == {
        "grants": [NEED_CATALOG, NEED_SCHEMA, NEED_SELECT], "gaps": [], "me": ""}
    assert plan(ACCESS_TABLE, None, "") == {"grants": [], "gaps": [], "me": ""}
    assert plan(ACCESS_TABLE, LIVE_ACCESS, "x`; DROP TABLE t; --") == {"grants": [], "gaps": [], "me": ""}
    assert plan("not_a_table", LIVE_ACCESS, "bob@x") == {"grants": [], "gaps": [], "me": ""}
    assert plan("`main`.`inspire`.`churn_out`", LIVE_ACCESS, "amr@x")["grants"] == [NEED_SELECT]


def test_access_sql_reads_owners_and_grants_with_the_callers_identity(agent_ns):
    assert agent_ns["implement_access_args"]("`Main`.inspire.churn_out") == {"c": "Main", "s": "inspire", "t": "churn_out"}
    sql = agent_ns["implement_access_sql"]()
    assert sql.startswith("SELECT level, privilege, principal, (lower(principal) = lower(current_user()) OR "
                          "is_account_group_member(principal)) AS mine, current_user() AS me FROM (")
    for view in ("catalogs", "schemata", "tables", "catalog_privileges", "schema_privileges", "table_privileges"):
        assert f"system.information_schema.{view} WHERE" in sql
    assert sql.endswith(") WHERE principal IS NOT NULL")
    assert agent_ns["implement_access_args"]("bad") is None
    assert agent_ns["implement_access_args"]("main..churn_out") is None


def test_access_sql_keeps_the_name_columns_bare_and_lowers_the_name_asked_for(agent_ns):
    import re
    names = "(catalog_name|schema_name|table_catalog|table_schema|table_name)"
    sql = agent_ns["implement_access_sql"]()
    assert not re.search(rf"lower\({names}\)", sql)
    assert not re.search(rf"\b{names} = :", sql)
    assert len(re.findall(rf"\b{names} = lower\(:[cst]\)", sql)) == 12


def test_grant_sql_renders_one_need_for_one_principal(agent_ns):
    grant = agent_ns["implement_grant_sql"]
    assert [grant(need, "bob@x") for need in (NEED_CATALOG, NEED_SCHEMA, NEED_SELECT)] == [
        GRANT_CATALOG.format("bob@x"), GRANT_SCHEMA.format("bob@x"), GRANT_SELECT.format("bob@x")]
    assert grant(GAP_CATALOG, "planners") == GRANT_CATALOG.format("planners")


def test_access_gap_messages_name_the_privilege_the_owner_and_the_statement(agent_ns):
    assert agent_ns["implement_access_gap_message"]("bob@x", [GAP_CATALOG]) == (
        "bob@x may not be able to read the result table: Inspire cannot grant USE CATALOG on catalog `main` (owner amr@x), because it "
        "neither owns nor holds MANAGE on it. If bob@x does not have it yet, ask the owner to run: "
        "GRANT USE CATALOG ON CATALOG `main` TO `bob@x`")
    assert agent_ns["implement_access_gap_message"]("bob@x", [GAP_CATALOG, dict(GAP_SCHEMA, owner="")]) == (
        "bob@x may not be able to read the result table: Inspire cannot grant USE CATALOG on catalog `main` (owner amr@x) and "
        "USE SCHEMA on schema `main`.`inspire`, because it neither owns nor holds MANAGE on them. If bob@x does not have them yet, "
        "ask the owner to run: GRANT USE CATALOG ON CATALOG `main` TO `bob@x`; GRANT USE SCHEMA ON SCHEMA `main`.`inspire` TO `bob@x`")
    assert agent_ns["implement_app_access_message"](ACCESS_TABLE, [GAP_CATALOG, GAP_SCHEMA], "inspire-sp") == (
        "a new App could not read main.inspire.churn_out: its service principal needs USE CATALOG on catalog `main` (owner amr@x) "
        "and USE SCHEMA on schema `main`.`inspire` (owner amr@x), which not all account users have, and Inspire can grant them only "
        "with MANAGE or ownership. Ask the owner to run: GRANT MANAGE ON CATALOG `main` TO `inspire-sp`; GRANT MANAGE ON SCHEMA "
        "`main`.`inspire` TO `inspire-sp`, or GRANT USE CATALOG ON CATALOG `main` TO `account users`; GRANT USE SCHEMA ON SCHEMA "
        "`main`.`inspire` TO `account users`, which open no data by themselves; or choose a result table in a catalog and schema "
        "Inspire manages")
    assert ("TO the identity Inspire runs as, or GRANT USE CATALOG ON CATALOG `main` TO `account users`, which opens no data by itself; "
            "or choose") in agent_ns["implement_app_access_message"](ACCESS_TABLE, [GAP_CATALOG], "")
    with_select = agent_ns["implement_app_access_message"](ACCESS_TABLE, [GAP_CATALOG, dict(NEED_SELECT, owner="data-eng")], "inspire-sp")
    assert "GRANT MANAGE ON TABLE `main`.`inspire`.`churn_out` TO `inspire-sp`; or choose" in with_select
    assert "account users`" not in with_select, "SELECT for every account user would open the data, so it is never offered"


def test_permission_acl_maps_principal_types(agent_ns):
    acl = agent_ns["implement_permission_acl"]([{"type": "user", "name": "a@x"}, {"type": "group", "name": "g"},
                                                {"type": "service_principal", "name": "sp"}, {"type": "x", "name": "y"}], "CAN_RUN")
    assert acl == [{"user_name": "a@x", "permission_level": "CAN_RUN"}, {"group_name": "g", "permission_level": "CAN_RUN"},
                   {"service_principal_name": "sp", "permission_level": "CAN_RUN"}]


def test_lock_key_is_per_session_and_use_case_and_never_the_generate_lock(agent_ns):
    key = agent_ns["implement_lock_key"]
    assert key(5150, "N01-U01") == "implement::5150::N01-U01"
    assert key(5150, "N01-U01") != key(5150, "N01-U02")
    assert key(5150, "N01-U01") != key(6160, "N01-U01"), "two sessions of one business build the same use case id apart"
    assert key(5150, "N01-U01") != "Acme"


def test_genie_events_become_live_log_lines(agent_ns):
    line = agent_ns["summarize_genie_event"]
    assert line({"type": "item.completed", "item": {"type": "command_execution", "command": "databricks  jobs submit",
                                                     "exit_code": 0}}) == "Genie ran: databricks jobs submit (exit 0)"
    assert line({"type": "item.completed", "item": {"type": "agent_message", "text": "Built\nit"}}) == "Genie: Built it"
    assert line({"type": "error", "message": "rate limited"}) == "Genie error: rate limited"
    assert line({"type": "turn.failed", "error": {"message": "boom"}}) == "Genie error: boom"
    assert line({"type": "item.started", "item": {"type": "reasoning"}}) == ""
    assert line("not a dict") == ""


def _runner(ns, tmp_path, **kw):
    runner = ns["GenieCodeRunner"]("https://workspace.example.com/", "tok-123", CapturingLogger(), root=str(tmp_path), **kw)
    runner.genie_path, runner.cli_dir = "/bin/genie", str(tmp_path / "cli")
    return runner


def test_genie_config_is_valid_toml_and_its_auth_command_prints_the_token(agent_ns, tmp_path):
    runner = _runner(agent_ns, tmp_path)
    config = tomllib.loads(runner.config_toml())
    provider = config["model_providers"]["databricks"]
    assert provider["base_url"] == "https://workspace.example.com/ai-gateway/codex/v1"
    assert provider["wire_api"] == "responses" and config["model"] == agent_ns["GENIE_CODE_MODEL"]
    assert provider["request_max_retries"] == provider["stream_max_retries"] == agent_ns["GENIE_CODE_REQUEST_RETRIES"] >= 10, \
        "a 429 on a per-minute token limit is retried long enough to outlast the minute"
    out = subprocess.run([provider["auth"]["command"], *provider["auth"]["args"]], env={"DATABRICKS_TOKEN": "tok-123"},
                         capture_output=True, text=True, check=True).stdout
    assert json.loads(out) == {"access_token": "tok-123", "token_type": "Bearer"}


def test_genie_env_carries_only_host_and_token_auth(agent_ns, tmp_path, monkeypatch):
    monkeypatch.setenv("DATABRICKS_CONFIG_PROFILE", "logfood")
    monkeypatch.setenv("DATABRICKS_CLIENT_SECRET", "s")
    env = _runner(agent_ns, tmp_path).env()
    assert env["DATABRICKS_HOST"] == "https://workspace.example.com" and env["DATABRICKS_TOKEN"] == "tok-123"
    assert "DATABRICKS_CONFIG_PROFILE" not in env and "DATABRICKS_CLIENT_SECRET" not in env
    assert env["SHELL"] == "/bin/bash" and env["GENIE_HOME"].startswith(str(tmp_path))
    assert env["PATH"].startswith(str(tmp_path / "cli") + ":")


class _FakeProc:
    def __init__(self, lines, code=0, write_last=None, last_path=None):
        self.stdout = io.StringIO("".join(json.dumps(l) + "\n" if isinstance(l, dict) else l + "\n" for l in lines))
        self.stderr = io.StringIO("warn")
        self.code = code
        self.killed = False
        if write_last is not None:
            open(last_path, "w").write(write_last)

    def wait(self):
        return self.code

    def kill(self):
        self.killed = True


def test_genie_run_streams_events_and_parses_the_final_json(agent_ns, tmp_path):
    seen, commands = [], []
    work = tmp_path / "w"

    def popen(command, **kw):
        commands.append((command, kw))
        return _FakeProc([{"type": "item.completed", "item": {"type": "command_execution", "command": "ls", "exit_code": 0}},
                          "not json", {"type": "error", "message": "transient"}], 0,
                         write_last='Here it is: {"status": "built", "summary": "ok"}', last_path=str(work / "genie_last.txt"))

    runner = _runner(agent_ns, tmp_path, on_line=seen.append, popen=popen)
    result = runner.run("build it", str(work), {"type": "object"}, label="build")
    assert result["exit"] == 0 and result["final"] == {"status": "built", "summary": "ok"} and result["events"] == 3
    assert seen == ["[build] Genie ran: ls (exit 0)", "[build] Genie error: transient"]
    assert result["errors"] == ["Genie error: transient"] and result["timed_out"] is False
    command, kw = commands[0]
    assert command[:2] == ["/bin/genie", "exec"] and "--output-schema" in command
    assert command[-1] == "build it" + agent_ns["GENIE_CLI_AUTH_NOTE"] and kw["start_new_session"] is True
    assert command[-1].endswith("jq is not installed here: read the CLI's JSON output with python instead.")
    assert "--profile" not in command and kw["env"]["DATABRICKS_TOKEN"] == "tok-123"
    assert json.load(open(work / "genie_output_schema.json")) == {"type": "object"}


def test_genie_run_without_final_json_returns_none(agent_ns, tmp_path):
    runner = _runner(agent_ns, tmp_path, popen=lambda c, **k: _FakeProc([], 1))
    result = runner.run("x", str(tmp_path / "w"), {"type": "object"})
    assert result["exit"] == 1 and result["final"] is None


def test_genie_install_unpacks_both_clis_from_the_assets_once(agent_ns, tmp_path, monkeypatch):
    from v177_assets_support import cli_entries, make_assets
    monkeypatch.setattr(agent_ns["os"], "symlink", os.symlink)
    assets = make_assets(agent_ns, tmp_path / "assets", cli_entries(agent_ns, "x86_64"), machine="x86_64")
    read = []
    original = assets.local_copy
    assets.local_copy = lambda entry: read.append(entry["file"]) or original(entry)
    root = tmp_path / "root"
    runner = agent_ns["GenieCodeRunner"]("https://h", "t", CapturingLogger(), root=str(root), assets=assets)
    paths = runner.install()
    assert os.path.exists(paths["genie"]) and os.path.exists(paths["cli"])
    assert read == ["cli/genie-code-cli-x86_64.tar.gz", "cli/databricks-cli-x86_64.zip"]
    assert "ai-gateway/codex/v1" in open(os.path.join(paths["home"], "config.toml")).read()
    assert open(root / ".databrickscfg").read() == "[DEFAULT]\nhost = https://h\n", "the CLI profile never holds the token"
    runner.install()
    assert len(read) == 2, "a second install reuses the unpacked CLIs"


def _writer(ns, spark, tmp_path, monkeypatch, **widget_values):
    monkeypatch.setattr(ns["tempfile"], "tempdir", str(tmp_path), raising=False)
    return ns["AtomicWriter"](spark, CapturingLogger(), "my-cat.inspire", 5150, widget_values=widget_values)


def test_atomic_writer_creates_and_migrates_the_implement_table(agent_ns, tmp_path, monkeypatch):
    spark = FakeSpark(responder=lambda s: [{"col_name": "session_id"}, {"col_name": "use_case_id"}]
                      if s.startswith("DESCRIBE TABLE `my-cat`.`inspire`.`__inspire_implement`") else [])
    writer = _writer(agent_ns, spark, tmp_path, monkeypatch)
    try:
        assert writer.implement_table == "`my-cat`.`inspire`.__inspire_implement"
        writer._ensure_tables()
    finally:
        writer._session_writer.stop(drain_timeout=5.0)
    assert any(s.startswith("CREATE TABLE IF NOT EXISTS `my-cat`.`inspire`.__inspire_implement") for s in spark.statements)
    added = [s for s in spark.statements if s.startswith("ALTER TABLE `my-cat`.`inspire`.`__inspire_implement` ADD COLUMN")]
    assert len(added) == len(agent_ns["IMPLEMENT_COLUMNS"]) - 2
    assert not any("`session_id`" in s for s in added)


def test_an_implement_run_attaches_to_its_existing_session(agent_ns, tmp_path, monkeypatch):
    spark = FakeSpark(responder=lambda s: [{"session_id": 5150}] if s.startswith("SELECT session_id FROM") else [])
    writer = _writer(agent_ns, spark, tmp_path, monkeypatch, operation="Implement Use Cases", business="Acme")
    try:
        writer.initialize_session()
    finally:
        writer._session_writer.stop(drain_timeout=5.0)
    assert writer.attached_to_existing_session is True
    assert not [s for s in spark.statements if s.startswith("MERGE INTO") and "__inspire_session" in s]
    assert writer.logger.matching("[SESSION-ATTACH FIRED] Implement Use Cases")


def _until(check, seconds=4.0):
    deadline = time.time() + seconds
    while time.time() < deadline:
        if check():
            return True
        time.sleep(0.02)
    return check()


def _flush_writer(ns, tmp_path, monkeypatch, interval, flush_seconds=0.0, spool="_spool_path", fail_first=False):
    writer = _writer(ns, FakeSpark(), tmp_path, monkeypatch)
    writer._flush_interval_seconds = interval
    seen, busy, most = [], [0], [0]

    def flush_pending(force=False, finalize=False):
        busy[0] += 1
        most[0] = max(most[0], busy[0])
        try:
            with open(getattr(writer, spool), encoding="utf-8") as handle:
                seen.append(sum(1 for _ in handle))
            time.sleep(flush_seconds)
            if fail_first and len(seen) == 1:
                raise RuntimeError("warehouse unavailable")
            return 0
        finally:
            busy[0] -= 1

    writer.flush_pending = flush_pending
    return writer, seen, most


def test_a_step_inside_the_flush_interval_is_written_without_another_step(agent_ns, tmp_path, monkeypatch):
    writer, seen, most = _flush_writer(agent_ns, tmp_path, monkeypatch, interval=0.6)
    try:
        writer.emit_step("Implement Use Cases", "App", "N01-U01", status="started")
        assert _until(lambda: seen == [1] and not writer._flush_running)
        writer.emit_step("Implement Use Cases", "App", "N01-U01", status="started")
        assert _until(lambda: seen == [1, 2]), f"the second step waited for a later one: {seen}"
        assert _until(lambda: not writer._flush_running) and most[0] == 1
    finally:
        writer._session_writer.stop(drain_timeout=5.0)


def test_a_step_written_during_a_flush_is_flushed_after_it_and_flushes_never_overlap(agent_ns, tmp_path, monkeypatch):
    writer, seen, most = _flush_writer(agent_ns, tmp_path, monkeypatch, interval=0.0, flush_seconds=0.4)
    try:
        writer.emit_step("Implement Use Cases", "Genie build", "N01-U01", status="started")
        assert _until(lambda: seen == [1])
        writer.emit_step("Implement Use Cases", "Genie build", "N01-U01", status="ended_success")
        writer.emit_step("Implement Use Cases", "Preview run", "N01-U01", status="started")
        assert _until(lambda: seen == [1, 3]), f"steps written during a flush were left in the spool: {seen}"
        assert _until(lambda: not writer._flush_running) and most[0] == 1
    finally:
        writer._session_writer.stop(drain_timeout=5.0)


def test_an_ai_call_log_inside_the_flush_interval_is_written_without_another_call(agent_ns, tmp_path, monkeypatch):
    writer, seen, _most = _flush_writer(agent_ns, tmp_path, monkeypatch, interval=0.6, spool="_ailogs_spool_path")
    try:
        writer.emit_ailog({"call_id": "a"})
        assert _until(lambda: seen == [1] and not writer._flush_running)
        writer.emit_ailog({"call_id": "b"})
        assert _until(lambda: seen == [1, 2]), f"the second AI call log waited for a later one: {seen}"
    finally:
        writer._session_writer.stop(drain_timeout=5.0)


def test_a_failed_background_flush_is_logged_and_the_next_step_flushes_again(agent_ns, tmp_path, monkeypatch):
    writer, seen, _most = _flush_writer(agent_ns, tmp_path, monkeypatch, interval=0.0, fail_first=True)
    try:
        writer.emit_step("Implement Use Cases", "App", "N01-U01", status="started")
        assert _until(lambda: seen == [1] and not writer._flush_running)
        assert writer.logger.matching("background flush failed, the next event retries it: warehouse unavailable")
        writer.emit_step("Implement Use Cases", "App", "N01-U01", status="ended_success")
        assert _until(lambda: seen == [1, 2] and not writer._flush_running)
    finally:
        writer._session_writer.stop(drain_timeout=5.0)


class _Row(dict):
    def asDict(self):
        return dict(self)


def _left_by(version, asset_status=None):
    return {"notebook": {"modified_at": 1700000000000, "spec_version": version, "result_history": 1}, **(asset_status or {})}


def _inspire(ns, spark, **attrs):
    attrs.setdefault("inspire_database", "main.inspire")
    inst = make_inspire(ns, spark=spark, session_id=5150, **attrs)
    inst._implement_params = {}
    inst.emitted = []
    inst._emit_pipeline_status = lambda **kw: inst.emitted.append(kw) or kw.get("step_id") or len(inst.emitted)
    return inst


def test_update_passes_values_as_parameters(agent_ns):
    calls = []
    spark = types.SimpleNamespace(sql=lambda s, args=None: calls.append((s, args)))
    inst = _inspire(agent_ns, spark)
    inst._implement_update((5150, "N01-U01", 3), status="ready", job_id=77, asset_status={"dashboard": {"state": "ready"}},
                           app_url=None)
    sql, args = calls[0]
    assert sql.startswith("UPDATE `main`.`inspire`.__inspire_implement SET `status` = :p0, `job_id` = CAST(:p1 AS BIGINT), "
                          "`asset_status` = parse_json(:p2), `app_url` = NULL, `updated_at` = current_timestamp()")
    assert sql.endswith("WHERE session_id = :sid AND use_case_id = :uc AND spec_version = :v")
    assert args == {"sid": 5150, "uc": "N01-U01", "v": 3, "p0": "ready", "p1": 77, "p2": '{"dashboard": {"state": "ready"}}'}


CONCURRENT_UPDATE = RuntimeError("[DELTA_CONCURRENT_DELETE_READ] ConcurrentDeleteReadException: This transaction attempted to read "
                                 "one or more files that were deleted by a concurrent update.")
CONCURRENT_SCHEMA = RuntimeError("[DELTA_METADATA_CHANGED] MetadataChangedException: The metadata of the Delta table has been changed "
                                 "by a concurrent update.")


def _updating(agent_ns, monkeypatch, failures):
    import time
    calls, slept = [], []

    def sql(statement, args=None):
        calls.append((statement, args))
        if failures:
            raise failures.pop(0)

    monkeypatch.setattr(time, "sleep", slept.append)
    inst = _inspire(agent_ns, types.SimpleNamespace(sql=sql))
    inst.logger = CapturingLogger()
    return inst, calls, slept


@pytest.mark.parametrize("conflict", [CONCURRENT_UPDATE, CONCURRENT_SCHEMA], ids=["row", "schema"])
def test_an_update_that_meets_a_concurrent_write_is_retried(agent_ns, monkeypatch, conflict):
    inst, calls, slept = _updating(agent_ns, monkeypatch, [conflict])
    inst._implement_update((5150, "N01-U01", 3), status="filling")
    assert len(calls) == 2 and calls[0] == calls[1] and len(slept) == 1, "the App writing the same row at the same moment is retried"
    assert any(level == "WARNING" and "Attempt 1 failed for updating N01-U01 spec 3" in message for level, message in inst.logger.records)


def test_an_update_that_fails_for_another_reason_is_not_retried(agent_ns, monkeypatch):
    broken = RuntimeError("[UNRESOLVED_COLUMN.WITH_SUGGESTION] A column with name `statu` cannot be resolved.")
    inst, calls, slept = _updating(agent_ns, monkeypatch, [broken])
    with pytest.raises(RuntimeError, match="UNRESOLVED_COLUMN"):
        inst._implement_update((5150, "N01-U01", 3), status="filling")
    assert len(calls) == 1 and slept == []
    assert any(level == "ERROR" and "Failed after 1 attempt for updating N01-U01 spec 3" in message
               for level, message in inst.logger.records), "the log says how many attempts were actually made"


def test_an_update_that_keeps_meeting_concurrent_writes_gives_up(agent_ns, monkeypatch):
    attempts = agent_ns["IMPLEMENT_UPDATE_ATTEMPTS"]
    inst, calls, slept = _updating(agent_ns, monkeypatch, [CONCURRENT_UPDATE] * attempts)
    with pytest.raises(RuntimeError, match="DELTA_CONCURRENT_DELETE_READ"):
        inst._implement_update((5150, "N01-U01", 3), status="filling")
    assert len(calls) == attempts == agent_ns["inspire_write_conflict_attempts"]() and len(slept) == attempts - 1
    assert sum(slept) <= 2 * agent_ns["INSPIRE_WRITE_CONFLICT_WINDOW_SECONDS"]
    assert any(level == "ERROR" and f"Failed after {attempts} attempts for updating N01-U01 spec 3" in message for level, message in inst.logger.records)


def test_targets_build_only_the_newest_queued_spec_per_use_case(agent_ns):
    rows = [_Row(session_id=5150, use_case_id="N01-U01", spec_version=1, spec_json="{}", asset_status=None),
            _Row(session_id=5150, use_case_id="N01-U01", spec_version=3, spec_json="{}", asset_status=None),
            _Row(session_id=5150, use_case_id="N01-U02", spec_version=1, spec_json="{}", asset_status=None)]
    calls = []

    def sql(statement, args=None):
        calls.append((statement, args))
        return types.SimpleNamespace(collect=lambda: rows if statement.startswith("SELECT") else [])

    inst = _inspire(agent_ns, types.SimpleNamespace(sql=sql))
    targets = inst._implement_targets()
    assert [(t["use_case_id"], t["spec_version"]) for t in targets] == [("N01-U01", 3), ("N01-U02", 1)]
    updates = [a for s, a in calls if s.startswith("UPDATE")]
    assert len(updates) == 1 and updates[0]["v"] == 1 and "superseded by spec version 3" in updates[0]["p1"]
    inst._implement_params = {"inspire_implement_use_case": "N01-U02", "inspire_implement_spec_version": "1"}
    inst._implement_targets()
    select, args = [c for c in calls if c[0].startswith("SELECT")][-1]
    assert "use_case_id = :uc" in select and "spec_version = :v" in select and args == {"sid": 5150, "uc": "N01-U02", "v": 1}
    inst._implement_params = {"inspire_implement_spec_version": "two"}
    with pytest.raises(ValueError, match="must be an integer"):
        inst._implement_targets()


def test_implement_mode_needs_a_database_and_a_queued_spec(agent_ns):
    inst = _inspire(agent_ns, FakeSpark(), inspire_database="")
    with pytest.raises(ValueError, match="needs the Inspire Database"):
        inst._run_implement_mode()
    inst = _inspire(agent_ns, FakeSpark())
    inst.atomic_writer = types.SimpleNamespace(_ensure_implement_table=lambda: None)
    inst._implement_targets = lambda: []
    with pytest.raises(RuntimeError, match="No queued use case MVP spec for session 5150"):
        inst._run_implement_mode()


def test_a_retry_of_a_version_that_already_ran_ends_with_its_recorded_outcome_not_a_wizard_hint(agent_ns):
    assert "status_message" in agent_ns["DatabricksInspire"]._IMPLEMENT_READ_COLUMNS
    inst = _inspire(agent_ns, FakeSpark())
    inst.atomic_writer = types.SimpleNamespace(_ensure_implement_table=lambda: None)
    inst._implement_targets = lambda: []
    inst._implement_params = {"inspire_implement_use_case": "N05-U01", "inspire_implement_spec_version": "1"}
    selects, rows = [], []
    inst._implement_select = lambda where, args: selects.append((where, args)) or list(rows)
    built = []
    inst._implement_one = lambda target: built.append(target) or "ready"

    for status in ("ready", "ready_with_warnings"):
        rows[:] = [{"session_id": 5150, "use_case_id": "N05-U01", "spec_version": 1, "status": status, "status_message": None}]
        assert inst._run_implement_mode() is None
        assert inst._implement_outcomes == {"N05-U01": status}
    assert selects[-1] == ("session_id = :sid AND use_case_id = :uc AND spec_version = :v", {"sid": 5150, "uc": "N05-U01", "v": 1})

    rows[:] = [{"session_id": 5150, "use_case_id": "N05-U01", "spec_version": 1, "status": "failed",
                "status_message": "the preview run did not write usable rows: the job could not start: boom"}]
    with pytest.raises(RuntimeError) as failed:
        inst._run_implement_mode()
    assert str(failed.value) == ("The use case MVP already ran spec version 1 of N05-U01 and it failed: the preview run did not "
                                 "write usable rows: the job could not start: boom. Submit the wizard again to build a new version.")
    rows[0]["status_message"] = None
    with pytest.raises(RuntimeError, match="and it failed: no error was recorded. Submit the wizard again"):
        inst._run_implement_mode()

    for status in ("filling", "previewing", "building_outputs"):
        rows[:] = [{"session_id": 5150, "use_case_id": "N05-U01", "spec_version": 1, "status": status, "status_message": None}]
        with pytest.raises(RuntimeError) as active:
            inst._run_implement_mode()
        assert str(active.value).startswith(f"Spec version 1 of N05-U01 is {status}: another run is building it, or the run "
                                            "that was building it stopped before it finished")

    rows[:] = []
    with pytest.raises(RuntimeError, match="No queued use case MVP spec for session 5150 and use case N05-U01"):
        inst._run_implement_mode()
    inst._implement_params = {"inspire_implement_use_case": "N05-U01"}
    calls = len(selects)
    with pytest.raises(RuntimeError, match="No queued use case MVP spec"):
        inst._run_implement_mode()
    assert len(selects) == calls and built == []


class _FakeRunner:
    def __init__(self, results):
        self.results = list(results)
        self.prompts = []

    def run(self, prompt, work_dir, schema=None, label=""):
        self.prompts.append(prompt)
        return self.results.pop(0)


def _fill(widgets=("result_table",)):
    return {"status": "built", "summary": "built it", "stop_reason": "",
            "widgets": [{"name": n, "type": "text", "default": "x", "choices": [], "label": n} for n in widgets]
            + [{"name": "run_profile", "type": "dropdown", "default": "full", "choices": ["preview", "full"], "label": "p"}],
            "profiles": {"training": {}, "full_load": {}}, "schedule": {"cron": "0 0 6 * * ?", "timezone": "UTC", "reason": "r"}}


_NB_SPEC = {"family": "F", "decision_basis": "measured", "result_table": "main.inspire.churn_out", "model_name": None,
            "ai_endpoint": "databricks-claude",
            "horizon": None, "season_length": None, "thresholds": {}, "job_tags": {}, "job_slug": "churn", "schedule_cron": None}


def _flow_inspire(ns, previews):
    inst = _inspire(ns, FakeSpark())
    inst.local_log_output_dir = "/tmp/inspire_test_implement"
    inst._sanitize_name = lambda s: str(s).replace(" ", "_")
    inst._genie_notebook_spec = lambda uc: dict(_NB_SPEC)
    inst.updates = []
    inst._implement_update = lambda key, **f: inst.updates.append(f)
    queue = list(previews)
    inst._implement_preview = lambda *a: queue.pop(0)
    inst.number_reports = []
    inst._implement_cell_problems = lambda path, training_sample=False, grouping=None, sources=(), training_read=False: inst.number_reports.pop(0) if inst.number_reports else []
    return inst


def test_a_failed_preview_goes_back_to_genie_with_the_error(agent_ns):
    inst = _flow_inspire(agent_ns, [({"status": "failed", "error": "AnalysisException: column churn_flag"}, 11, 101),
                                    ({"status": "written", "rows_written": 40}, 11, 102)])
    runner = _FakeRunner([{"exit": 0, "final": _fill()}, {"exit": 0, "final": _fill()}])
    spec = agent_ns["validate_implement_spec"](VALID)[0]
    outcome, job_id, fill = inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), {}, spec, None, "/W/nb",
                                                             ["result_table", "run_profile"], runner, True)
    assert outcome == {"status": "written", "rows_written": 40} and job_id == 11 and fill["status"] == "built"
    assert len(runner.prompts) == 2 and "AnalysisException: column churn_flag" in runner.prompts[1]
    assert "never catch a permission error" not in runner.prompts[1]
    assert "/W/nb" in runner.prompts[0] and "Never create a persistent job" in runner.prompts[0]


def test_a_build_cut_off_by_the_time_limit_is_sent_back_as_no_result_not_as_missing_widgets(agent_ns):
    inst = _flow_inspire(agent_ns, [({"status": "written", "rows_written": 40}, 11, 102)])
    runner = _FakeRunner([{"exit": -9, "timed_out": True}, {"exit": 0, "final": _fill()}])
    spec = agent_ns["validate_implement_spec"](VALID)[0]
    outcome, _job, _fill_out = inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), {}, spec, None, "/W/nb",
                                                                ["result_table", "run_profile"], runner, True)
    assert outcome == {"status": "written", "rows_written": 40} and len(runner.prompts) == 2
    assert "Genie exited with code -9 after the time limit" in runner.prompts[1]
    assert "Genie returned no JSON result" in runner.prompts[1]
    assert "widgets missing from the result" not in runner.prompts[1]


LIVE_DENIAL = ("RestException: PERMISSION_DENIED: Principal 'app-x inspire-ai-implement' does not have CREATE MODEL on Schema "
               "'main.inspire'.")
LIVE_GRANT = ("app-x inspire-ai-implement does not have CREATE MODEL on schema main.inspire, and no change to the notebook can grant "
              "it: grant CREATE MODEL on schema main.inspire to app-x inspire-ai-implement, then build again")


def test_a_preview_denied_a_privilege_on_what_the_use_case_owns_stops_with_the_grant_and_is_not_sent_back(agent_ns):
    inst = _flow_inspire(agent_ns, [({"status": "failed", "error": LIVE_DENIAL}, 11, 101)])
    runner = _FakeRunner([{"exit": 0, "final": _fill()}] * 3)
    spec = agent_ns["validate_implement_spec"](VALID)[0]
    outcome, job_id, _f = inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), {}, spec, None, "/W/nb",
                                                           ["result_table", "run_profile"], runner, True)
    assert len(runner.prompts) == 1 and job_id == 11
    assert outcome == {"status": "failed", "error": LIVE_DENIAL, "denied": LIVE_GRANT}
    assert agent_ns["implement_stop_message"](outcome, spec) == (
        f"the preview run was denied a privilege Genie cannot fix in the notebook: {LIVE_GRANT}")
    assert inst.logger.matching("[IMPLEMENT-DENIED] N01-U01: not sent back to Genie")


def test_a_preview_denied_on_an_object_the_use_case_does_not_own_goes_back_to_genie_told_never_to_catch_it(agent_ns):
    stray = LIVE_DENIAL.replace("CREATE MODEL on Schema 'main.inspire'", "CREATE TABLE on Schema 'main.scratch'")
    inst = _flow_inspire(agent_ns, [({"status": "failed", "error": stray}, 11, 101), ({"status": "written", "rows_written": 40}, 11, 102)])
    runner = _FakeRunner([{"exit": 0, "final": _fill()}] * 2)
    spec = agent_ns["validate_implement_spec"](VALID)[0]
    outcome, _job, _f = inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), {}, spec, None, "/W/nb",
                                                         ["result_table", "run_profile"], runner, True)
    assert outcome == {"status": "written", "rows_written": 40} and len(runner.prompts) == 2
    assert "CREATE TABLE on Schema 'main.scratch'" in runner.prompts[1]
    assert "write only to the result table, register only the model the widgets name, and never catch a permission error" in runner.prompts[1]
    assert "never catch the error or skip the step that needs it, such as registering the model" in runner.prompts[0]


def test_a_privilege_denial_names_the_grant_only_for_what_the_use_case_owns(agent_ns):
    owned_of, denial = agent_ns["implement_owned_objects"], agent_ns["implement_privilege_denial"]
    spec = agent_ns["validate_implement_spec"](VALID)[0]
    owned = owned_of(spec, ["main.s.orders", "samples.tpcds.item"])
    assert owned == {"main", "main.inspire", "main.inspire.churn_out", "main.inspire.churn_out_model", "main.s", "main.s.orders_v2",
                     "samples", "samples.tpcds", "samples.tpcds.item"}
    moved = agent_ns["validate_implement_spec"](dict(VALID, config=dict(VALID["config"], widgets={"model_name": "ml.models.churn"})))[0]
    assert {"ml", "ml.models", "ml.models.churn"} <= owned_of(moved, []) and "main.inspire.churn_out_model" not in owned_of(moved, [])
    assert denial(LIVE_DENIAL, owned) == LIVE_GRANT
    assert denial("PERMISSION_DENIED: User does not have USE CATALOG on Catalog 'samples'.", owned) == (
        "the run identity does not have USE CATALOG on catalog samples, and no change to the notebook can grant it: grant USE CATALOG "
        "on catalog samples to the run identity, then build again")
    assert denial("[INSUFFICIENT_PERMISSIONS] Insufficient privileges: User does not have permission SELECT on table "
                  "`main`.`s`.`orders_v2`.", owned).startswith("the run identity does not have SELECT on table main.s.orders_v2, ")
    assert denial("PERMISSION_DENIED: does not have MODIFY on Table 'MAIN.Inspire.churn_out'", owned).startswith(
        "the run identity does not have MODIFY on table MAIN.Inspire.churn_out, ")
    assert denial(LIVE_DENIAL.replace("'main.inspire'", "'main.scratch'"), owned) == ""
    assert denial("AnalysisException: [UNRESOLVED_COLUMN] churn_flag", owned) == ""
    assert denial(None, owned) == "" and denial(LIVE_DENIAL, set()) == ""


_SWALLOW = '''try:
    mlflow.register_model(uri, model_name)
except Exception as error:
    if "PERMISSION_DENIED" in str(error) or "CREATE MODEL" in str(error):
        print("registration denied, using the baseline")
        use_baseline = True
    else:
        raise
'''


def _caught(label, line):
    return (f"{label} line {line} catches a permission error and carries on; a denied privilege must fail the run, so remove that "
            "handling and let the error stop the notebook")


def test_a_cell_that_catches_a_permission_error_and_carries_on_is_flagged_and_one_that_fails_the_run_is_not(agent_ns):
    check = agent_ns["implement_denial_catch_problems"]
    assert check([("cell 4", _SWALLOW)]) == [_caught("cell 4", 3)]
    assert check([("cell 5", "try:\n    write()\nexcept PermissionDenied:\n    pass\n")]) == [_caught("cell 5", 3)]
    assert check([("cell 6", "%pip install x\ntry:\n    write()\nexcept Exception as e:\n"
                             "    use = baseline if 'PERMISSION_DENIED' in str(e) else None\n")]) == [_caught("cell 6", 4)]
    assert check([("cell 7", "try:\n    write()\nexcept (NotFound, errors.PermissionDenied):\n    log('skip')\n")]) == [_caught("cell 7", 3)]
    raised = _SWALLOW.replace('print("registration denied, using the baseline")\n        use_baseline = True',
                              'raise RuntimeError("grant CREATE MODEL to the run identity") from error')
    assert check([("cell 4", raised)]) == []
    assert check([("cell 4", "try:\n    write()\nexcept PermissionDenied as error:\n    raise RuntimeError('needs a grant') from error\n")]) == []
    assert check([("cell 4", "try:\n    x = int(v)\nexcept ValueError:\n    x = 0\n")]) == []
    assert check([("cell 4", "def broken(:\n"), ("cell 5", "")]) == []


def test_the_cell_check_flags_a_permission_catch_only_in_genie_cells(agent_ns, sdk_stub):
    notebook = {"cells": [_cell("Genie Code instruction", "# instruction"),
                          _cell(agent_ns["GENIE_NUMBER_HELPERS_TITLE"], agent_ns["GENIE_NUMBER_TEXT_SOURCE"]),
                          _cell(None, "z = fmt_num(3)\ninspire_write_summary(z, result_table, run_id, as_of_date)"),
                          _cell(None, _SWALLOW), _cell("Run controls (Inspire, do not edit)", _SWALLOW)]}
    inst = _notebook_inspire(agent_ns, _NotebookWorkspace(notebook, modified_at=5))
    assert inst._implement_cell_problems("/W/nb") == [_caught("cell 4", 3)]
    notebook["cells"][3] = _cell(None, "x = 1")
    inst = _notebook_inspire(agent_ns, _NotebookWorkspace(notebook, modified_at=5))
    assert inst._implement_cell_problems("/W/nb") == []


def test_preview_stops_after_three_genie_rounds(agent_ns):
    failed = ({"status": "failed", "error": "boom"}, 11, 1)
    inst = _flow_inspire(agent_ns, [failed, failed, failed])
    runner = _FakeRunner([{"exit": 0, "final": _fill()}] * 3)
    spec = agent_ns["validate_implement_spec"](VALID)[0]
    outcome, _job, _fill_out = inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), {}, spec, None, "/W/nb",
                                                                ["result_table", "run_profile"], runner, True)
    assert outcome["status"] == "failed" and len(runner.prompts) == agent_ns["IMPLEMENT_MAX_GENIE_ROUNDS"] == 3


def test_a_stop_goes_back_to_genie_to_repair_and_ends_without_a_preview_when_it_keeps_stopping(agent_ns):
    inst = _flow_inspire(agent_ns, [])
    stopped = dict(_fill(), status="stopped", stop_reason="History covers 1 closed outcome window")
    runner = _FakeRunner([{"exit": 0, "final": stopped}] * 3)
    outcome, _job, _f = inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), {}, agent_ns["validate_implement_spec"](VALID)[0],
                                                         None, "/W/nb", ["result_table", "run_profile"], runner, True)
    assert {k: outcome[k] for k in ("status", "stop_reason", "stopped_by")} == {
        "status": "stopped", "stop_reason": "History covers 1 closed outcome window", "stopped_by": "genie"}
    assert len(runner.prompts) == 3 and "Inspire read your last attempt's stop: History covers 1 closed outcome window" in runner.prompts[1]


def test_an_unchanged_notebook_is_only_re_previewed(agent_ns):
    inst = _flow_inspire(agent_ns, [({"status": "written", "rows_written": 5}, 3, 4)])
    outcome, _job, fill = inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 2), {}, agent_ns["validate_implement_spec"](VALID)[0],
                                                           None, "/W/nb", ["run_profile"], None, False)
    assert outcome["rows_written"] == 5 and fill == {}


def test_a_genie_round_that_changes_inspires_cells_is_told_and_the_preview_runs_the_restored_cells(agent_ns):
    inst = _flow_inspire(agent_ns, [({"status": "failed", "error": "boom"}, 11, 101), ({"status": "written", "rows_written": 40}, 11, 102)])
    order, reports = [], [["edited the 'Run controls (Inspire, do not edit)' cell"], []]
    inst._implement_restore_owned_cells = lambda path: order.append(("restore", path)) or reports.pop(0)
    queued = inst._implement_preview
    inst._implement_preview = lambda *a: order.append(("preview",)) or queued(*a)
    runner = _FakeRunner([{"exit": 0, "final": _fill()}, {"exit": 0, "final": _fill()}])
    outcome, job_id, _f = inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), {}, agent_ns["validate_implement_spec"](VALID)[0],
                                                           None, "/W/nb", ["result_table", "run_profile"], runner, True)
    assert outcome == {"status": "written", "rows_written": 40} and job_id == 11
    assert order == [("restore", "/W/nb"), ("preview",), ("restore", "/W/nb"), ("preview",)]
    assert "Those three cells are Inspire's: never edit, move, copy or delete them" in runner.prompts[0]
    assert ("between the instruction cell and the 'Number helpers' cell, which sits directly above the 'Run controls' cell"
            in runner.prompts[0])
    assert "you edited the 'Run controls (Inspire, do not edit)' cell. Those cells are Inspire's" in runner.prompts[1]
    warned = [e for e in inst.emitted if e["step_name"] == "Genie build" and e["status"] == "ended_warning"]
    assert len(warned) == 1 and "Inspire put them back as it wrote them" in warned[0]["message"]
    assert [e["status"] for e in inst.emitted if e["step_name"] == "Genie build"].count("ended_success") == 1


def test_a_genie_build_round_sent_back_stays_running_on_one_step(agent_ns):
    inst = _flow_inspire(agent_ns, [({"status": "written", "rows_written": 40}, 11, 101)])
    inst.number_reports = [["the KPI tile prints 1234567 as a raw number"], []]
    runner = _FakeRunner([{"exit": 0, "final": _fill()}, {"exit": 0, "final": _fill()}])
    spec = agent_ns["validate_implement_spec"](VALID)[0]
    outcome, _job, _fill_out = inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), {}, spec, None, "/W/nb",
                                                                ["result_table", "run_profile"], runner, True)
    assert outcome["status"] == "written" and len(runner.prompts) == 2
    build = [e for e in inst.emitted if e["step_name"] == "Genie build"]
    assert [(e["status"], e["step_id"]) for e in build] == [("started", None), ("started", 1), ("started", 1), ("ended_success", 1)]
    assert build[1]["message"] == "round 1 of up to 6 failed, sent back to Genie: the KPI tile prints 1234567 as a raw number"
    assert {k: build[1]["result_json"][k] for k in ("round", "rounds", "failure")} == {
        "round": 1, "rounds": 6, "failure": "the KPI tile prints 1234567 as a raw number"}
    assert build[2]["result_json"]["round"] == 2 and "failure" not in build[2]["result_json"]


def test_a_preview_job_that_cannot_start_fails_the_step_without_another_genie_round(agent_ns):
    error = "the job could not start: JobsAPI.run_now() got an unexpected keyword argument 'only'"
    inst = _flow_inspire(agent_ns, [({"status": "failed", "launched": False, "error": error}, 11, None)])
    runner = _FakeRunner([{"exit": 0, "final": _fill()}] * 3)
    outcome, job_id, fill = inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), {}, agent_ns["validate_implement_spec"](VALID)[0],
                                                             None, "/W/nb", ["result_table", "run_profile"], runner, True)
    assert outcome == {"status": "failed", "launched": False, "error": error} and job_id == 11 and fill["status"] == "built"
    assert len(runner.prompts) == 1, "Genie never gets a launch failure to fix: Inspire's own cells start the job"


def test_artifact_loop_feeds_deploy_errors_back_and_gives_up_after_three_rounds(agent_ns):
    inst = _flow_inspire(agent_ns, [])
    runner = _FakeRunner([{"exit": 0}, {"exit": 0}])
    attempts = []

    def deploy(work):
        attempts.append(work)
        if len(attempts) == 1:
            raise RuntimeError("dataset decision_list failed: UNRESOLVED_COLUMN rank")
        return {"dashboard_id": "d1"}

    context = {"uc_id": "N01-U01", "key": (5150, "N01-U01", 1)}
    assert inst._implement_genie_loop(context, runner, "Dashboard", "write it", deploy) == {"dashboard_id": "d1"}
    assert "UNRESOLVED_COLUMN rank" in runner.prompts[1]
    always = _FakeRunner([{"exit": 0}] * 3)
    with pytest.raises(RuntimeError, match="after 3 Genie rounds"):
        inst._implement_genie_loop(context, always, "App", "write it", lambda w: (_ for _ in ()).throw(RuntimeError("no app.yaml")))
    assert len(always.prompts) == 3


def test_genie_space_smoke_requires_a_query_answer(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    answers = [{"conversation_id": "c", "message_id": "m"}, {"status": "EXECUTING_QUERY"},
               {"status": "COMPLETED", "attachments": [{"query": {"query": "SELECT 1"}}]}]
    inst._implement_api = lambda method, path, body=None: answers.pop(0)
    assert inst._implement_genie_smoke("s1", "Which act now?", poll_s=0)["status"] == "COMPLETED"
    answers[:] = [{"conversation_id": "c", "message_id": "m"}, {"status": "COMPLETED", "attachments": [{"text": {"content": "hi"}}]}]
    with pytest.raises(RuntimeError, match="without a query"):
        inst._implement_genie_smoke("s1", "q", poll_s=0)
    answers[:] = [{"conversation_id": "c", "message_id": "m"}, {"status": "FAILED", "error": {"error": "no warehouse"}}]
    with pytest.raises(RuntimeError, match="no warehouse"):
        inst._implement_genie_smoke("s1", "q", poll_s=0)


def test_one_failure_marks_the_spec_failed_and_always_releases_the_lock(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    calls = []
    inst.atomic_writer = types.SimpleNamespace(acquire_lock=lambda k, **kw: calls.append(("acquire", k)) or True,
                                               release_lock=lambda k: calls.append(("release", k)))
    inst.updates = []
    inst._implement_update = lambda key, **f: inst.updates.append(f)
    inst._implement_one_locked = lambda target, key, inflight: (_ for _ in ()).throw(RuntimeError("use case N01-U01 is not in the table"))
    status = inst._implement_one({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 2})
    assert status == "failed" and calls == [("acquire", "implement::5150::N01-U01"), ("release", "implement::5150::N01-U01")]
    assert inst.updates[-1]["status"] == "failed" and "not in the table" in inst.updates[-1]["status_message"]


def test_invalid_spec_or_mismatched_use_case_fails_before_any_work(agent_ns):
    inst = _refusing_inspire(agent_ns)
    inst._implement_previous = lambda t: pytest.fail("an invalid spec never looks up the version it was edited from")
    with pytest.raises(agent_ns["ImplementBlocked"], match="spec is invalid: .*names use case N09-U09"):
        inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 1,
                                    "spec_json": dict(VALID, use_case_id="N09-U09")}, (5150, "N01-U01", 1))
    assert inst.updates == [{"asset_status": LIVE_STATUS, "dashboard_id": "d1", "job_id": 77}], \
        "its row keeps the state of the outputs that are still live"


def test_the_implemented_notebook_lives_outside_the_folder_discover_wipes(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst.base_output_dir = inst.session_output_dir = "/Workspace/out/acme"
    inst.notebook_output_dir = "/Workspace/out/acme/notebooks"
    inst._implement_root_dir, inst.business_name = "/Workspace/Shared/inspire-ai", "Acme"
    inst._build_notebook_workspace_paths = lambda uc: ("/Workspace/out/acme/notebooks/Sales/Retention", "x",
                                                       "N01-U01 - Predict_churn")
    target_dir, path = inst._implement_notebook_paths({"Business Domain": "Sales"}, (5150, "N01-U01", 2))
    assert target_dir == "/Workspace/Shared/inspire-ai/acme/session_5150/sales/N01-U01 - Predict_churn/mvp/v2"
    assert path == f"{target_dir}/N01-U01 - Predict_churn"
    assert not agent_ns["implement_paths_overlap"](path, inst.session_output_dir)


def test_run_short_circuits_to_implement_mode():
    src = ast.unparse(method_node("DatabricksInspire", "run"))
    assert "if getattr(self, 'operation', '') == IMPLEMENT_OPERATION:" in src and "self._run_implement_mode()" in src
    main = ast.unparse(top_level_defs()["main"])
    assert "is REQUIRED for Implement Use Cases" in main


def test_no_implement_code_names_a_customer_profile_or_caches(agent_ns):
    from _agentload import agent_source
    src = agent_source()
    start, end = src.index('IMPLEMENT_TABLE = "__inspire_implement"'), src.index("\nclass AtomicWriter:")
    block = src[start:end]
    for banned in ("logfood", ".cache()", ".persist(", "sparkContext", "--profile "):
        assert banned not in block


FLASK_YAML = "command: ['python', 'app.py']\nenv:\n  - name: DATABRICKS_WAREHOUSE_ID\n    valueFrom: sql-warehouse\n"
FLASK_PY = ("import os\nfrom flask import Flask\nfrom databricks import sql\napp = Flask(__name__)\n"
            "@app.route('/health')\ndef health():\n    return 'ok'\n"
            "app.run(host='0.0.0.0', port=int(os.environ['DATABRICKS_APP_PORT']))\n")


def test_wizard_fields_normalize(agent_ns):
    spec, errors = _spec(agent_ns, use_case={"goal": "Cut churn", "decision_owner": "Retention lead", "success_measures": ["a", "b"]},
                         based_on_version="2", confirm_notebook_overwrite=True,
                         data=dict(VALID["data"], column_roles={"entity_id": "main.s.orders_v2.customer_id"},
                                   window={"start": "2025-01-01", "end": "2026-01-01"}),
                         config=dict(VALID["config"], profiles={"training": {"window_days": "365", "sample_entities": 5000,
                                                                             "stratify_by": "region"},
                                                                "preview": {"entity_cap": 200},
                                                                "retrain": {"every_runs": 4, "drift_threshold": "0.2"}}),
                         schedule=dict(VALID["schedule"], failure_emails=["ops@example.com", "OPS@example.com"]),
                         outputs=dict(VALID["outputs"], dashboard_name="Churn desk", dashboard_filters=["top_k"],
                                      genie_questions=["Who acts now?"], app_purpose="accept or defer"))
    assert errors == []
    assert spec["based_on_version"] == 2 and spec["confirm_notebook_overwrite"] is True
    assert spec["use_case"]["success_measures"] == ["a", "b"]
    assert spec["config"]["profiles"]["training"] == {"window_days": 365, "sample_entities": 5000, "stratify_by": "region"}
    assert spec["config"]["profiles"]["retrain"] == {"every_runs": 4, "drift_threshold": 0.2}
    assert spec["schedule"]["failure_emails"] == ["ops@example.com"]
    assert spec["outputs"]["genie_questions"] == ["Who acts now?"] and spec["outputs"]["dashboard_filters"] == ["top_k"]


def test_options_of_an_unticked_output_are_dropped(agent_ns):
    spec, _ = _spec(agent_ns, outputs={"dashboard": True, "genie_questions": ["q"], "app_purpose": "x", "app_name": "churn-desk"})
    assert spec["outputs"]["genie_questions"] == [] and spec["outputs"]["app_purpose"] == "" and spec["outputs"]["app_name"] == ""


@pytest.mark.parametrize("changes,needle", [
    ({"use_case": {"success_measures": ["a", "b", "c", "d"]}}, "at most 3 success measures"),
    ({"based_on_version": "latest"}, "based_on_version"),
    ({"data": {"column_roles": {"owner": "a.b.c.d"}}}, "column role 'owner'"),
    ({"data": {"column_roles": {"event_date": "orders.order_date"}}}, "catalog.schema.table.column"),
    ({"data": {"window": {"start": "2026-02-01", "end": "2026-01-01"}}}, "starts (2026-02-01) after it ends"),
    ({"data": {"window": {"start": "01/02/2026"}}}, "YYYY-MM-DD"),
    ({"config": {"warehouse_id": "w", "profiles": {"training": {"window_days": 0}}}}, "at least 1"),
    ({"config": {"warehouse_id": "w", "profiles": {"preview": {"entity_cap": "many"}}}}, "whole number"),
    ({"config": {"warehouse_id": "w", "profiles": {"retrain": {"drift_threshold": 3}}}}, "drift_threshold"),
    ({"schedule": {"failure_emails": ["not-an-email"]}}, "not an email"),
    ({"outputs": {"genie_space": True, "genie_questions": list("abcdef")}}, "at most 5 Genie Agent sample questions"),
    ({"outputs": {"dashboard": True, "dashboard_filters": ["bad name"]}}, "dashboard filters"),
])
def test_invalid_wizard_fields_are_rejected(agent_ns, changes, needle):
    _out, errors = _spec(agent_ns, **changes)
    assert any(needle in e for e in errors), errors


def test_renaming_a_kept_output_refreshes_only_that_output(agent_ns):
    validate = agent_ns["validate_implement_spec"]
    before = validate(VALID)[0]
    after = validate(dict(VALID, outputs=dict(VALID["outputs"], genie_space_name="Churn questions")))[0]
    plan = agent_ns["implement_plan"](before, after, {"dashboard": "d", "genie_space": "g", "app": "churn-desk"}, True)
    assert plan["classes"] == ["outputs"] and plan["refresh"] == ["genie_space"] and plan["build"] == [] and not plan["refill"]


def test_choices_markdown_carries_the_new_wizard_fields(agent_ns):
    spec = agent_ns["validate_implement_spec"](dict(
        VALID, use_case={"goal": "Cut churn", "decision_owner": "Retention lead", "success_measures": ["churn down 2 points"]},
        data=dict(VALID["data"], column_roles={"event_date": "main.s.orders_v2.order_date"}, window={"start": "2025-01-01"}),
        config=dict(VALID["config"], profiles={"training": {"window_days": 365, "stratify_by": "region"},
                                               "full_load": {"window_days": 90}, "preview": {"entity_cap": 250},
                                               "retrain": {"every_runs": 4}})))[0]
    text = agent_ns["implement_choices_markdown"](spec)
    for needle in ("- Goal: Cut churn", "- Decision owner: Retention lead", "- Success measure: churn down 2 points",
                   "Use `main.s.orders_v2.order_date` as the event date column", "from 2025-01-01 to the latest date",
                   "the last 365 days, stratified by `region`", "last 90 days of data", "score at most 250 entities",
                   "Retrain the model every 4 full runs"):
        assert needle in text, needle


def _app_inspire(ns, apps, health=None):
    inst = _inspire(ns, FakeSpark())
    inst.emitted = []
    inst._implement_emit = lambda *a, **k: inst.emitted.append(a)
    calls = []

    def api(method, path, body=None):
        calls.append((method, path, body))
        if method == "GET" and path.startswith("/api/2.0/apps/"):
            name = path.rsplit("/", 1)[-1]
            if name not in apps:
                raise RuntimeError("RESOURCE_DOES_NOT_EXIST")
            return apps[name]
        return {}

    inst._implement_api = api
    inst._implement_http_get = health
    return inst, calls


def test_an_app_name_taken_by_someone_else_gets_a_hash_never_an_overwrite(agent_ns):
    inst, _calls = _app_inspire(agent_ns, {"churn-desk": {"description": "Someone's own app"}})
    context = {"uc_id": "N01-U01", "key": (5150, "N01-U01", 1), "assets": {}}
    renamed = inst._implement_app_name(context, "churn-desk")
    assert renamed.startswith("churn-desk-") and len(renamed) == len("churn-desk-") + 4
    assert agent_ns["IMPLEMENT_APP_NAME_RE"].match(renamed)
    long_name = "a" * 30
    inst2, _ = _app_inspire(agent_ns, {long_name: {"description": "x"}})
    assert len(inst2._implement_app_name(dict(context), long_name)) <= 30
    ours, _ = _app_inspire(agent_ns, {"churn-desk": {"description": "Inspire use case N01-U01 (session 5150): Predict churn"}})
    kept = {"uc_id": "N01-U01", "key": (5150, "N01-U01", 1), "assets": {}}
    assert ours._implement_app_name(kept, "churn-desk") == "churn-desk" and "app_renamed" not in kept
    free, _ = _app_inspire(agent_ns, {})
    assert free._implement_app_name(kept, "churn-desk") == "churn-desk" and "app_renamed" not in kept
    recorded = {"uc_id": "N01-U01", "key": (5150, "N01-U01", 1), "assets": {"app": "churn-desk"}}
    assert inst._implement_app_name(recorded, "churn-desk") == renamed, \
        "a recorded App name is not proof: the App under that name must still carry this use case's tag"
    assert recorded["app_renamed"] == context["app_renamed"] == (
        f"App: an App named churn-desk exists but is not this use case's App, so Inspire deployed this one as {renamed}; pick another App "
        "name in the wizard to name it yourself")
    assert not [e for e in getattr(inst, "emitted", []) if "ended_warning" in e], "the rename is a warning of the App, never a yellow step"


def _app_states(*states):
    queue = [{"app_status": {"state": s, "message": f"App is {s.lower()}"}, "active_deployment": {"deployment_id": d}} for s, d in states]
    return lambda method, path, body=None: queue.pop(0) if len(queue) > 1 else queue[0]


def test_app_health_needs_the_new_deployment_running_and_never_warns_because_the_job_cannot_sign_in(agent_ns):
    import time as _time
    answers = [(503, ""), (200, "")]
    inst, _ = _app_inspire(agent_ns, {}, health=lambda url: answers.pop(0))
    inst._implement_api = _app_states(("DEPLOYING", "dep0"), ("RUNNING", "dep0"), ("RUNNING", "dep1"))
    assert inst._implement_app_health("desk", "dep1", "https://app.x", "/health", _time.time() + 60, 0) == "passed"
    inst, _ = _app_inspire(agent_ns, {}, health=lambda url: (302, "https://x/oidc/authorize?client_id=a"))
    inst._implement_api = _app_states(("RUNNING", "dep1"))
    assert inst._implement_app_health("desk", "dep1", "https://app.x", "/health", _time.time() + 60, 0) == "running"
    assert "running" in agent_ns["IMPLEMENT_APP_HEALTH_OK"] and "passed" in agent_ns["IMPLEMENT_APP_HEALTH_OK"]
    inst._implement_api = _app_states(("RUNNING", "dep0"))
    with pytest.raises(RuntimeError, match="not RUNNING on deployment dep1 \\(active deployment dep0\\)"):
        inst._implement_app_health("desk", "dep1", "https://app.x", "/health", _time.time() - 1, 0)
    inst._implement_api = _app_states(("CRASHED", "dep1"))
    with pytest.raises(RuntimeError, match="crashed after deployment dep1: App is crashed"):
        inst._implement_app_health("desk", "dep1", "https://app.x", "/health", _time.time() + 60, 0)
    inst, _ = _app_inspire(agent_ns, {}, health=lambda url: (404, ""))
    inst._implement_api = _app_states(("RUNNING", "dep1"))
    with pytest.raises(RuntimeError, match="answered HTTP 404, not 200"):
        inst._implement_app_health("desk", "dep1", "https://app.x", "/health", _time.time() - 1, 0)
    inst, _ = _app_inspire(agent_ns, {}, health=lambda url: (302, "https://elsewhere/"))
    inst._implement_api = _app_states(("RUNNING", "dep1"))
    with pytest.raises(RuntimeError, match="HTTP 302"):
        inst._implement_app_health("desk", "dep1", "https://app.x", "/health", _time.time() - 1, 0)
    with pytest.raises(RuntimeError, match="no URL"):
        inst._implement_app_health("desk", "dep1", "", "/health", _time.time() + 60, 0)


@pytest.fixture
def sdk_stub(monkeypatch):
    """The offline SDK stub has no enums; give it the ones these methods pass."""
    ws, jobs = sys.modules["databricks.sdk.service.workspace"], sys.modules["databricks.sdk.service.jobs"]

    def kw_type(name):
        def init(self, **kw):
            self.__dict__.update(kw)
        return type(name, (), {"__init__": init, "__getattr__": lambda self, attr: None})

    for module, name, value in ((ws, "ImportFormat", types.SimpleNamespace(JUPYTER="JUPYTER", AUTO="AUTO")),
                                (ws, "ExportFormat", types.SimpleNamespace(JUPYTER="JUPYTER", AUTO="AUTO")),
                                (jobs, "PauseStatus", types.SimpleNamespace(UNPAUSED=types.SimpleNamespace(value="UNPAUSED"),
                                                                            PAUSED=types.SimpleNamespace(value="PAUSED"))),
                                (jobs, "CronSchedule", kw_type("CronSchedule")),
                                (jobs, "JobEmailNotifications", kw_type("JobEmailNotifications")),
                                (jobs, "JobSettings", kw_type("JobSettings"))):
        if not hasattr(module, name) or name == "JobSettings":
            monkeypatch.setattr(module, name, value, raising=False)


class _NotebookWorkspace:
    def __init__(self, notebook=None, modified_at=None):
        self.notebook, self.modified_at, self.imported = notebook, modified_at, []

    def get_status(self, path):
        if self.modified_at is None:
            raise RuntimeError("RESOURCE_DOES_NOT_EXIST")
        return types.SimpleNamespace(modified_at=self.modified_at)

    def export(self, path, format=None):
        import base64
        return types.SimpleNamespace(content=base64.b64encode(json.dumps(self.notebook).encode()).decode())

    def mkdirs(self, path):
        pass

    def import_(self, path, overwrite, format, content):
        import base64
        self.imported.append(json.loads(base64.b64decode(content)))


def _cell(title, text):
    return {"cell_type": "code", "metadata": {"application/vnd.databricks.v1+cell": {"title": title} if title else {}},
            "source": [text]}


def _notebook_inspire(ns, workspace):
    inst = _inspire(ns, FakeSpark())
    inst.w_client = types.SimpleNamespace(workspace=workspace, config=types.SimpleNamespace(host="https://h"))
    inst._implement_notebook_paths = lambda uc, key: ("/W/acme_implemented/Sales", "/W/acme_implemented/Sales/N01-U01")
    inst._genie_notebook_cells = lambda uc, instruction: ([_cell(None, "# header"), _cell("Genie Code instruction", instruction),
                                                          _cell(ns["GENIE_NUMBER_HELPERS_TITLE"], "def fmt_num(x):\n    return str(x)\n"),
                                                          _cell("Run controls (Inspire, do not edit)", "main()")], {})
    inst._genie_notebook_object = lambda cells, name: {"cells": cells}
    return inst


NB_PATH = "/W/acme_implemented/Sales/N01-U01"
TASK_RUN = "1234567890000031"
STOPPED_REWRITE = {"modified_at": 1000, "spec_version": 3, "rewriting": {"spec_version": 4, "run_id": "4444444444444444"}}


def _claim(agent_ns, monkeypatch, modified_at, recorded, run=None, confirm=False, built=None):
    workspace = _NotebookWorkspace(built or {"cells": []}, modified_at=modified_at)
    inst = _notebook_inspire(agent_ns, workspace)
    inst.updates = []
    inst._implement_update = lambda key, **f: inst.updates.append(json.loads(json.dumps(f)))
    asked = []
    monkeypatch.setitem(agent_ns, "job_run_ended", lambda run_id: asked.append(run_id) or run)
    monkeypatch.setitem(agent_ns, "current_job_run_id", lambda: TASK_RUN)
    spec = dict(agent_ns["validate_implement_spec"](VALID)[0], confirm_notebook_overwrite=confirm)
    status = {"dashboard": {"state": "ready", "spec_version": 3}}
    if recorded is not None:
        status["notebook"] = dict(recorded)
    return inst, workspace, asked, spec, status


@pytest.mark.parametrize("modified_at,recorded,ended,edited", [
    (None, {"modified_at": 1000}, None, False),
    (2000, None, None, False),
    (2000, {"spec_version": 3}, None, False),
    (1000, {"modified_at": 1000}, None, False),
    (2000, {"modified_at": 1000}, None, True),
    (2000, STOPPED_REWRITE, 2500, False),
    (2500, STOPPED_REWRITE, 2500, False),
    (2600, STOPPED_REWRITE, 2500, True),
    (2000, STOPPED_REWRITE, None, True),
    (2000, {"modified_at": 1000}, 2500, True),
], ids=["no_notebook", "no_record", "record_without_a_time", "unchanged", "edited", "inspire_rewrite", "rewrite_boundary",
        "edited_after_the_rewrite_stopped", "rewrite_end_unknown", "end_without_a_rewrite"])
def test_a_notebook_counts_as_edited_only_when_inspire_cannot_have_made_the_change(agent_ns, modified_at, recorded, ended, edited):
    assert agent_ns["implement_notebook_edited"](modified_at, recorded, ended) is edited


def test_a_notebook_edited_since_inspire_built_it_is_not_overwritten_without_confirmation(agent_ns, sdk_stub, monkeypatch):
    built = {"cells": [_cell(None, "# header"), _cell("Genie Code instruction", "old"), _cell(None, "genie step 1"),
                       _cell("Run controls (Inspire, do not edit)", "main()")]}
    inst, workspace, asked, spec, status = _claim(agent_ns, monkeypatch, 2000, {"modified_at": 1000, "spec_version": 3}, built=built)
    use_case = {"No": "N01-U01", "genie_instruction": "Build churn"}
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        inst._implement_claim_notebook(use_case, spec, (5150, "N01-U01", 4), status)
    assert str(raised.value) == agent_ns["implement_notebook_edited_message"](NB_PATH)
    assert "build the notebook again with Vibe/Add/Remove Features on the Build page" in str(raised.value) and "Review step" not in str(raised.value)
    assert status["notebook"] == {"modified_at": 1000, "spec_version": 3, "state": "edited", "edited_at": 2000}
    assert inst.updates == [{"asset_status": status}] and workspace.imported == [] and asked == []
    confirmed = dict(spec, confirm_notebook_overwrite=True)
    assert inst._implement_claim_notebook(use_case, confirmed, (5150, "N01-U01", 5), status) == NB_PATH
    assert status["notebook"] == {"modified_at": 1000, "spec_version": 3, "rewriting": {"spec_version": 5, "run_id": TASK_RUN}}, \
        "a confirmed overwrite forgets the edit and marks the rewrite"
    inst._implement_write_notebook(use_case, confirmed, spec, (5150, "N01-U01", 5))
    cells = workspace.imported[-1]["cells"]
    assert [c["source"][0] for c in cells][2] == "genie step 1", "Genie's cells are kept"
    assert "Build churn" in cells[1]["source"][0] and "## Implementation Choices" in cells[1]["source"][0]


def test_an_unchanged_notebook_is_claimed_without_asking(agent_ns, monkeypatch):
    inst, workspace, asked, spec, status = _claim(agent_ns, monkeypatch, 1000, {"modified_at": 1000, "spec_version": 3})
    assert inst._implement_claim_notebook({"No": "N01-U01"}, spec, (5150, "N01-U01", 4), status) == NB_PATH
    assert status["notebook"] == {"modified_at": 1000, "spec_version": 3, "rewriting": {"spec_version": 4, "run_id": TASK_RUN}}
    assert status["dashboard"] == {"state": "ready", "spec_version": 3}, "the other outputs keep their state"
    assert inst.updates == [{"asset_status": status}] and workspace.imported == [] and asked == []


def test_a_version_that_stopped_while_rewriting_does_not_make_its_own_edits_look_like_the_users(agent_ns, monkeypatch):
    inst, workspace, asked, spec, status = _claim(agent_ns, monkeypatch, 2000, STOPPED_REWRITE,
                                                  run={"state": "CANCELED", "end_time": 2500})
    assert inst._implement_claim_notebook({"No": "N01-U01"}, spec, (5150, "N01-U01", 5), status) == NB_PATH
    assert asked == ["4444444444444444"]
    assert status["notebook"] == {"modified_at": 1000, "spec_version": 3, "rewriting": {"spec_version": 5, "run_id": TASK_RUN}}
    assert inst.updates == [{"asset_status": status}] and workspace.imported == []


def test_a_notebook_edited_after_the_stopped_version_ended_still_needs_a_confirmation(agent_ns, monkeypatch):
    inst, workspace, asked, spec, status = _claim(agent_ns, monkeypatch, 2600, STOPPED_REWRITE,
                                                  run={"state": "CANCELED", "end_time": 2500})
    with pytest.raises(agent_ns["ImplementBlocked"], match="was edited after Inspire last built it"):
        inst._implement_claim_notebook({"No": "N01-U01"}, spec, (5150, "N01-U01", 5), status)
    assert status["notebook"] == dict(STOPPED_REWRITE, state="edited", edited_at=2600)
    assert inst.updates == [{"asset_status": status}] and workspace.imported == []


def test_a_stopped_rewrite_whose_run_cannot_be_read_still_asks_before_overwriting(agent_ns, monkeypatch):
    inst, workspace, asked, spec, status = _claim(agent_ns, monkeypatch, 2000, STOPPED_REWRITE, run=None)
    with pytest.raises(agent_ns["ImplementBlocked"], match="was edited after Inspire last built it"):
        inst._implement_claim_notebook({"No": "N01-U01"}, spec, (5150, "N01-U01", 5), status)
    assert asked == ["4444444444444444"] and status["notebook"]["state"] == "edited"


def test_a_refill_marks_the_notebook_before_its_first_write_and_records_it_after_the_fill(agent_ns, monkeypatch):
    monkeypatch.setitem(agent_ns, "current_job_run_id", lambda: TASK_RUN)
    inst = _probe_inspire(agent_ns, None, {"notebook": {"modified_at": 1000, "spec_version": 2}})
    events = []
    record = inst._implement_update
    inst._implement_update = lambda key, **f: events.append(("update", json.loads(json.dumps(f)))) or record(key, **f)
    inst._implement_notebook_paths = lambda uc, key: ("/W", "/W/nb")
    times = iter([1000, 1000, 3000])
    inst._implement_notebook_modified_at = lambda path: next(times)
    inst._implement_export_text = lambda path: events.append(("copy", path)) or "built notebook v2"
    inst._implement_runner = lambda uc: "runner"
    inst._implement_write_notebook = lambda uc, spec, previous, key, current="": events.append(("write",)) or "/W/nb"
    inst._implement_fill_and_preview = lambda *a: events.append(("fill",)) or ({"status": "written", "rows_written": 12}, 77, {})
    inst._implement_genie_space = lambda c, r: {"genie_space_id": "g1", "genie_space_url": "https://h/genie/rooms/g1"}
    inst._implement_app = lambda c, r: {"app_name": "churn-desk", "app_url": "https://churn-desk.example", "app_health": "running"}
    inst._implement_dashboard = lambda c, r: {"dashboard_id": "d1", "dashboard_url": "https://h/d"}
    inflight = {}
    spec = dict(VALID, config={**VALID["config"], "widgets": {"top_k": 30}})
    got = inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": spec},
                                     (5150, "N01-U01", 3), inflight)
    assert got == "ready"
    write = [i for i, e in enumerate(events) if e[0] == "write"]
    marks = [i for i, e in enumerate(events) if e[0] == "update" and "rewriting" in e[1].get("asset_status", {}).get("notebook", {})]
    assert len(write) == 1 and marks and marks[0] < write[0], "the rewrite is recorded before Inspire's first write to the notebook"
    assert events.index(("copy", "/W/nb")) < write[0], "Inspire saves a copy of the notebook before it changes it"
    assert events[marks[0]][1]["asset_status"]["notebook"]["rewriting"] == {"spec_version": 3, "run_id": TASK_RUN}
    assert inst.updates[-1]["asset_status"]["notebook"] == {"modified_at": 3000, "spec_version": 3, "result_history": 1, "state": "ready",
                                                            "title": "Notebook", "impact": {"kind": "money", "unit": "", "kpi": ""},
                                                            "reads": {"main.s.orders_v2": [], "main.s.returns": []}}, \
        "a source table whose columns Inspire cannot read records no column it reads"
    assert "notebook_path" not in inflight and "notebook_before" not in inflight and inflight["asset_status"] is not None


def _failing_inspire(agent_ns, locked, modified_at=3000):
    inst = _inspire(agent_ns, FakeSpark())
    inst.atomic_writer = types.SimpleNamespace(acquire_lock=lambda k, **kw: True, release_lock=lambda k: None)
    inst.updates = []
    inst._implement_update = lambda key, **f: inst.updates.append(json.loads(json.dumps(f)))
    inst._implement_notebook_modified_at = lambda path: modified_at if path == "/W/nb" else pytest.fail(f"read {path}")
    inst._implement_one_locked = locked
    return inst


def test_a_version_that_fails_after_rewriting_records_the_notebook_it_left(agent_ns):
    def locked(target, key, inflight):
        inflight["asset_status"] = {"dashboard": {"state": "deleted", "note": "deleted at the user's request in spec v3"},
                                    "notebook": dict(STOPPED_REWRITE, rewriting={"spec_version": 3, "run_id": TASK_RUN})}
        inflight["notebook_path"] = "/W/nb"
        raise RuntimeError("the preview run did not write usable rows: boom")

    inst = _failing_inspire(agent_ns, locked)
    assert inst._implement_one({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3}) == "failed"
    final = inst.updates[-1]
    assert final["status"] == "failed" and final["status_message"] == "the preview run did not write usable rows: boom"
    assert final["asset_status"] == {"dashboard": {"state": "deleted", "note": "deleted at the user's request in spec v3"},
                                     "notebook": {"modified_at": 3000, "spec_version": 3, "result_history": 1}}


@pytest.mark.parametrize("claimed,modified_at", [(False, 3000), (True, None)], ids=["before_the_claim", "notebook_unreadable"])
def test_a_failure_that_cannot_say_what_the_notebook_holds_leaves_its_record_alone(agent_ns, claimed, modified_at):
    def locked(target, key, inflight):
        inflight["asset_status"] = {"notebook": dict(STOPPED_REWRITE)}
        if claimed:
            inflight["notebook_path"] = "/W/nb"
        raise RuntimeError("boom")

    inst = _failing_inspire(agent_ns, locked, modified_at)
    assert inst._implement_one({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3}) == "failed"
    assert inst.updates[-1] == {"status": "failed", "status_message": "boom"}


def test_a_notebook_without_the_inspire_cells_is_rewritten_from_the_instruction(agent_ns, sdk_stub):
    workspace = _NotebookWorkspace({"cells": [_cell(None, "user rewrote everything")]}, modified_at=5)
    inst = _notebook_inspire(agent_ns, workspace)
    inst._implement_write_notebook({"No": "N01-U01", "genie_instruction": "Build"}, agent_ns["validate_implement_spec"](VALID)[0], None, (5150, "N01-U01", 1))
    assert len(workspace.imported[-1]["cells"]) == 4
    fresh = _NotebookWorkspace(None, modified_at=None)
    inst = _notebook_inspire(agent_ns, fresh)
    inst._implement_write_notebook({"No": "N01-U01", "genie_instruction": "Build"}, agent_ns["validate_implement_spec"](VALID)[0], None, (5150, "N01-U01", 1))
    assert len(fresh.imported) == 1


_INSTRUCTION, _CONTROLS = "Genie Code instruction", "Run controls (Inspire, do not edit)"


def _owned_cells():
    return (_cell(_INSTRUCTION, 'r"""\nBuild churn\n"""\n'),
            _cell(_CONTROLS, "result = launcher.launch(job_name='j', only_tasks=['inspire_task'])\n"))


def test_inspire_cells_are_put_back_when_genie_edits_moves_copies_or_deletes_them(agent_ns):
    restore = agent_ns["implement_restore_owned_cells"]
    instruction, controls = _owned_cells()
    header, step, step2 = _cell(None, "# header"), _cell(None, "genie step 1"), _cell(None, "genie step 2")
    round_tripped = [header, instruction, step,
                     _cell(_CONTROLS, "# a comment\nresult = launcher.launch(job_name='j', only_tasks=['inspire_task'])")]
    assert restore(round_tripped, instruction, controls) == (round_tripped, []), "whitespace and comments are not edits"
    cases = [
        ([header, instruction, step, _cell(_CONTROLS, "result = launcher.launch(job_name='j')")],
         [header, instruction, step, controls], [f"edited the '{_CONTROLS}' cell"]),
        ([header, instruction, step, _cell(_CONTROLS, "result = launcher.launch(")],
         [header, instruction, step, controls], [f"edited the '{_CONTROLS}' cell"]),
        ([header, instruction, controls, step], [header, instruction, step, controls], [f"moved the '{_CONTROLS}' cell"]),
        ([header, instruction, step], [header, instruction, step, controls], [f"deleted the '{_CONTROLS}' cell"]),
        ([header, instruction, step, controls, controls], [header, instruction, step, controls], [f"copied the '{_CONTROLS}' cell"]),
        ([header, instruction, step, instruction, controls], [header, instruction, step, controls], [f"copied the '{_INSTRUCTION}' cell"]),
        ([header, step, controls], [header, instruction, step, controls], [f"deleted the '{_INSTRUCTION}' cell"]),
        ([header, _cell(_INSTRUCTION, 'r"""\nBuild churn faster\n"""'), step, controls], [header, instruction, step, controls],
         [f"edited the '{_INSTRUCTION}' cell"]),
        ([header, step, controls, _cell(_INSTRUCTION, "x = 1"), step2], [header, step, instruction, step2, controls],
         [f"edited the '{_INSTRUCTION}' cell", f"moved the '{_CONTROLS}' cell"]),
        ([], [instruction, controls], [f"deleted the '{_INSTRUCTION}' cell", f"deleted the '{_CONTROLS}' cell"]),
    ]
    for given, expected, changes in cases:
        assert restore(given, instruction, controls) == (expected, changes), changes


def test_inspires_number_helpers_cell_is_put_back_directly_above_the_run_controls(agent_ns, sdk_stub):
    restore = agent_ns["implement_restore_owned_cells"]
    instruction, controls = _owned_cells()
    helpers_title = agent_ns["GENIE_NUMBER_HELPERS_TITLE"]
    helpers = _cell(helpers_title, agent_ns["GENIE_NUMBER_TEXT_SOURCE"])
    header, pip, step = _cell(None, "# header"), _cell(None, "%pip install prophet==1.1.5"), _cell(None, "genie step 1")
    built = [header, instruction, pip, step, helpers, controls]
    assert restore(built, instruction, controls, helpers) == (built, []), "the helpers run after the %pip cell, which resets Python"
    assert restore([header, instruction, step, controls], instruction, controls) == ([header, instruction, step, controls], []), \
        "a notebook checked without the helpers cell is read for the other two only"
    cases = [
        ([header, instruction, pip, step, controls], built, [f"deleted the '{helpers_title}' cell"]),
        ([header, instruction, pip, step, _cell(helpers_title, "def fmt_num(x):\n    return str(x)\n"), controls], built,
         [f"edited the '{helpers_title}' cell"]),
        ([header, instruction, helpers, pip, step, controls], built, [f"moved the '{helpers_title}' cell"]),
        ([header, helpers, instruction, pip, step, controls], built, [f"moved the '{helpers_title}' cell"]),
        ([header, instruction, pip, helpers, step, helpers, controls], built, [f"copied the '{helpers_title}' cell"]),
        ([header, instruction, pip, step, controls, helpers], built, [f"moved the '{_CONTROLS}' cell"]),
        ([header, pip, step, helpers, controls], [header, instruction, pip, step, helpers, controls], [f"deleted the '{_INSTRUCTION}' cell"]),
        ([header, step, instruction, helpers], [header, step, instruction, helpers, controls], [f"deleted the '{_CONTROLS}' cell"]),
        ([], [instruction, helpers, controls], [f"deleted the '{_INSTRUCTION}' cell", f"deleted the '{_CONTROLS}' cell",
                                                f"deleted the '{helpers_title}' cell"]),
    ]
    for given, expected, changes in cases:
        assert restore(given, instruction, controls, helpers) == (expected, changes), changes
    workspace = _NotebookWorkspace({"cells": [header, instruction, pip, step, controls]}, modified_at=10)
    inst = _notebook_inspire(agent_ns, workspace)
    inst._implement_owned_cells = {"/W/nb": (instruction, controls, helpers)}
    assert inst._implement_restore_owned_cells("/W/nb") == [f"deleted the '{helpers_title}' cell"]
    assert workspace.imported[-1]["cells"] == built


@pytest.mark.parametrize("previous,record,reusable", [
    (None, {"modified_at": 1000, "spec_version": 1}, False),
    ({}, {"modified_at": 1000, "spec_version": 1}, False),
    ({"spec_version": 3}, {"modified_at": 1000, "spec_version": 3}, True),
    ({"spec_version": 4}, {"modified_at": 1000, "spec_version": 3}, True),
    ({"spec_version": 3}, {"modified_at": 1000, "spec_version": 4}, False),
    ({"spec_version": 3}, dict(STOPPED_REWRITE, spec_version=4), False),
    ({"spec_version": 3}, {"modified_at": 1000}, False),
    ({"spec_version": 3}, None, False),
    ({"spec_version": 3}, {"spec_version": "x"}, False),
], ids=["no_ready_version", "empty_ready_version", "left_by_the_ready_version", "kept_by_the_ready_version",
        "rewritten_by_a_failed_attempt", "a_stopped_rewrite_since", "record_without_a_version", "no_record", "unreadable_version"])
def test_a_notebook_is_built_on_only_when_the_ready_version_the_plan_compares_against_left_it(agent_ns, previous, record, reusable):
    assert agent_ns["implement_reusable_notebook"](previous, record) is reusable


def test_a_notebook_left_by_a_failed_attempt_is_written_fresh_and_a_built_one_keeps_genies_cells(agent_ns, sdk_stub):
    left = {"cells": [_cell(None, "# header"), _cell(_INSTRUCTION, "old"), _cell(None, "entity_key = F.col('ws_sold_date_sk')"),
                      _cell(_CONTROLS, "main()")]}
    spec = agent_ns["validate_implement_spec"](VALID)[0]
    text = agent_ns["implement_cell_text"]
    workspace = _NotebookWorkspace(left, modified_at=5)
    _notebook_inspire(agent_ns, workspace)._implement_write_notebook({"No": "N01-U01", "genie_instruction": "Build"}, spec, None, (5150, "N01-U01", 1))
    fresh = workspace.imported[-1]["cells"]
    assert len(fresh) == 4 and not any("ws_sold_date_sk" in text(c) for c in fresh), "no ready version: the notebook starts from the instruction"
    workspace = _NotebookWorkspace(left, modified_at=5)
    _notebook_inspire(agent_ns, workspace)._implement_write_notebook({"No": "N01-U01", "genie_instruction": "Build"}, spec, dict(spec), (5150, "N01-U01", 1))
    kept = workspace.imported[-1]["cells"]
    title = agent_ns["implement_cell_title"]
    assert len(kept) == 5 and "ws_sold_date_sk" in text(kept[2]) and "Build" in text(kept[1]), "a built notebook keeps Genie's cells"
    assert title(kept[3]) == agent_ns["GENIE_NUMBER_HELPERS_TITLE"] and title(kept[-1]) == _CONTROLS, \
        "a notebook built before Inspire owned the number helpers gets them directly above the Run controls, after Genie's cells"
    workspace = _NotebookWorkspace({"cells": kept[:3] + [_cell(title(kept[3]), "old helpers")] + kept[4:]}, modified_at=5)
    _notebook_inspire(agent_ns, workspace)._implement_write_notebook({"No": "N01-U01", "genie_instruction": "Build"}, spec, dict(spec), (5150, "N01-U01", 1))
    again = workspace.imported[-1]["cells"]
    assert [title(c) for c in again] == [title(c) for c in kept] and "old helpers" not in text(again[3]) and "def fmt_num" in text(again[3]), \
        "a notebook that holds the helpers cell gets Inspire's current copy in its place, never a second one"


@pytest.mark.parametrize("written_by,rebuilt", [(2, False), (3, True)], ids=["left_by_the_ready_version", "left_by_a_failed_attempt"])
def test_a_notebook_a_failed_attempt_rewrote_is_rebuilt_from_the_instruction_even_when_only_the_outputs_change(agent_ns, sdk_stub,
                                                                                                                 written_by, rebuilt):
    inst = _probe_inspire(agent_ns, None, {"notebook": {"modified_at": 1000, "spec_version": written_by, "result_history": 1},
                                           "dashboard": {"state": "ready", "spec_version": 2}})
    calls = []
    inst._implement_notebook_modified_at = lambda path: 1000
    inst._implement_claim_notebook = lambda use_case, spec, key, asset_status, current="": "/W/nb"
    inst._implement_runner = lambda uc: "runner"
    inst._implement_write_notebook = lambda uc, spec, previous, key, current="": calls.append(("write", previous)) or "/W/nb"
    inst._implement_refresh_run_controls = lambda uc_id, key, use_case, spec_nb, path, status, warnings: calls.append(("controls", path))
    inst._implement_fill_and_preview = lambda uc_id, key, use_case, spec, previous, path, names, runner, refill: (
        calls.append(("fill", previous, refill)) or ({"status": "written", "rows_written": 12}, 77, {}))
    inst._implement_dashboard = lambda c, r: {"dashboard_id": "d1", "dashboard_url": "https://h/d"}
    inst._implement_genie_space = lambda c, r: {"genie_space_id": "g1", "genie_space_url": "https://h/genie/rooms/g1"}
    inst._implement_app = lambda c, r: {"app_name": "churn-desk", "app_url": "https://churn-desk.example", "app_health": "running"}
    got = inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 4, "spec_json": dict(VALID)},
                                     (5150, "N01-U01", 4))
    assert got == "ready", inst.updates[-1]
    assert inst.updates[0]["change_classes"] == "outputs"
    if rebuilt:
        assert calls == [("write", None), ("fill", None, True)], "cells a failed attempt left are never built on"
    else:
        assert [c[0] for c in calls] == ["controls", "fill"] and calls[0] == ("controls", "/W/nb"), \
            "a kept notebook gets the Run controls of this Inspire before it runs"
        assert calls[1][1] is not None and calls[1][2] is False, "the ready version's notebook is kept when only the outputs change"


def test_the_notebook_write_records_inspires_cells_for_the_build_round_check(agent_ns, sdk_stub):
    workspace = _NotebookWorkspace(None, modified_at=None)
    inst = _notebook_inspire(agent_ns, workspace)
    inst._implement_write_notebook({"No": "N01-U01", "genie_instruction": "Build"}, agent_ns["validate_implement_spec"](VALID)[0], None, (5150, "N01-U01", 1))
    written = workspace.imported[-1]["cells"]
    assert inst._implement_owned_cells == {"/W/acme_implemented/Sales/N01-U01": (written[1], written[3], written[2])}
    assert agent_ns["implement_cell_title"](written[3]) == _CONTROLS and "Build" in agent_ns["implement_cell_text"](written[1])
    assert agent_ns["implement_cell_title"](written[2]) == agent_ns["GENIE_NUMBER_HELPERS_TITLE"]


def test_the_build_round_check_puts_back_the_cells_genie_changed_and_reads_nothing_it_did_not_write(agent_ns, sdk_stub):
    instruction, controls = _owned_cells()
    edited = {"cells": [_cell(None, "# header"), instruction, _cell(None, "genie step 1"),
                        _cell(_CONTROLS, "result = launcher.launch(job_name='j')")]}
    workspace = _NotebookWorkspace(edited, modified_at=10)
    inst = _notebook_inspire(agent_ns, workspace)
    assert inst._implement_restore_owned_cells("/W/nb") == [] and workspace.imported == []
    inst._implement_owned_cells = {"/W/nb": (instruction, controls)}
    assert inst._implement_restore_owned_cells("/W/other") == [] and workspace.imported == []
    assert inst._implement_restore_owned_cells("/W/nb") == [f"edited the '{_CONTROLS}' cell"]
    assert len(workspace.imported) == 1 and workspace.imported[0]["cells"][-1] == controls
    assert [c["source"][0] for c in workspace.imported[0]["cells"]][2] == "genie step 1", "Genie's cells are kept"
    assert inst.logger.matching("[IMPLEMENT-CELLS] /W/nb: Genie edited", "WARNING")
    workspace.notebook = workspace.imported[0]
    assert inst._implement_restore_owned_cells("/W/nb") == [] and len(workspace.imported) == 1

    class Unreadable(_NotebookWorkspace):
        def export(self, path, format=None):
            raise RuntimeError("RESOURCE_DOES_NOT_EXIST: /W/nb")

    inst.w_client = types.SimpleNamespace(workspace=Unreadable(None, 10), config=types.SimpleNamespace(host="https://h"))
    assert inst._implement_restore_owned_cells("/W/nb") == []
    assert inst.logger.matching("[IMPLEMENT-CELLS] /W/nb could not be read", "WARNING")


def test_assets_carry_from_a_failed_version_and_stop_at_a_delete(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    rows = [
        {"spec_version": 3, "status": "failed", "dashboard_id": None, "genie_space_id": "g3", "app_name": None,
         "notebook_path": "/W/nb", "asset_status": {"dashboard": {"state": "deleted"}}, "genie_widgets": [], "data_profiles": {},
         "suggested_schedule": {}},
        {"spec_version": 2, "status": "failed", "dashboard_id": "d2", "genie_space_id": None, "app_name": "churn-desk",
         "notebook_path": None, "asset_status": {"app": {"state": "failed"}}, "genie_widgets": [{"name": "top_k", "default": "25"}],
         "data_profiles": None},
        {"spec_version": 1, "status": "ready", "dashboard_id": "d1", "genie_space_id": "g1", "app_name": None,
         "notebook_path": "/W/nb", "job_id": 77, "asset_status": {}, "genie_widgets": [{"name": "top_k", "default": "10"}],
         "data_profiles": {"training": {"rows": 900}}, "suggested_schedule": {"cron": "0 0 6 * * ?"}},
    ]
    seen = []
    inst._implement_select = lambda where, args, order="": seen.append((where, args, order)) or rows
    carried, status = inst._implement_carried({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 4})
    assert carried["genie_space_id"] == "g3" and carried["app_name"] == "churn-desk" and carried["job_id"] == 77
    assert carried["genie_widgets"] == [{"name": "top_k", "default": "25"}], "the newest build's widgets, past a version without any"
    assert carried["data_profiles"] == {"training": {"rows": 900}} and carried["suggested_schedule"] == {"cron": "0 0 6 * * ?"}
    assert "dashboard_id" not in carried, "a deleted dashboard is never resurrected from an older version"
    assert status == {"dashboard": {"state": "deleted"}, "app": {"state": "failed"}}
    assert "status" not in seen[0][0] and seen[0][2] == "spec_version DESC"
    rows[0]["asset_status"] = {"dashboard": {"state": "deleted"}, "app": {"state": "released", "note": "not this use case's App"}}
    carried, _status = inst._implement_carried({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 4})
    assert "app_name" not in carried and "app_url" not in carried, "an App Inspire released is never carried back from an older version"
    assert carried["genie_space_id"] == "g3"


def test_stopped_states_match_the_shared_fixture(agent_ns):
    assert list(agent_ns["IMPLEMENT_STOPPED_STATES"]) == json.load(open(FIXTURE))["stopped_states"]


def test_delete_clears_the_ids_on_the_deleting_version(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_api = lambda *a, **k: {}
    inst.updates = []
    inst._implement_update = lambda key, **f: inst.updates.append(f)
    inst._implement_delete_output("genie_space", "g1", (5150, "N01-U01", 3))
    assert inst.updates == [{"genie_space_id": None, "genie_space_url": None}]


def _delete_app_inspire(ns, app):
    inst = _inspire(ns, FakeSpark())
    inst.calls, inst.updates, inst.emitted = [], [], []

    def api(method, path, body=None):
        inst.calls.append((method, path))
        if method == "GET" and app is None:
            raise RuntimeError("RESOURCE_DOES_NOT_EXIST: app churn-desk")
        return app if method == "GET" else {}

    inst._implement_api = api
    inst._implement_update = lambda key, **f: inst.updates.append(f)
    inst._implement_emit = lambda *a, **k: inst.emitted.append(a)
    return inst


def test_deleting_an_app_deletes_only_this_use_cases_app(agent_ns):
    ours = _delete_app_inspire(agent_ns, {"description": "Inspire use case N01-U01 (session 5150): Predict churn"})
    assert ours._implement_delete_output("app", "churn-desk", (5150, "N01-U01", 3))["warnings"] == []
    assert ours.calls == [("GET", "/api/2.0/apps/churn-desk"), ("DELETE", "/api/2.0/apps/churn-desk")]
    assert ours.emitted[-1][2:4] == ("deleted churn-desk at the user's request", "ended_success")
    foreign = _delete_app_inspire(agent_ns, {"description": "Finance team tool"})
    refused = foreign._implement_delete_output("app", "churn-desk", (5150, "N01-U01", 3))["note"]
    assert refused == "App: churn-desk is no longer this use case's App, so Inspire did not delete it"
    assert foreign.calls == [("GET", "/api/2.0/apps/churn-desk")], "an App another team now owns under the same name is never deleted"
    assert foreign.updates == [{"app_name": None, "app_url": None}] and foreign.emitted[-1][2:4] == (refused, "ended_warning")
    gone = _delete_app_inspire(agent_ns, None)
    assert gone._implement_delete_output("app", "churn-desk", (5150, "N01-U01", 3))["warnings"] == []
    assert gone.calls == [("GET", "/api/2.0/apps/churn-desk")] and gone.updates == [{"app_name": None, "app_url": None}]


LIVE_STATUS = {"dashboard": {"state": "ready", "spec_version": 3}, "alert": {"state": "deleted", "note": "x"}}


def _refusing_inspire(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst.updates = []
    inst._implement_update = lambda key, **f: inst.updates.append(json.loads(json.dumps(f)))
    inst._implement_previous = lambda t: {"spec_version": 3, "spec_json": VALID}
    inst._implement_carried = lambda t: ({"dashboard_id": "d1", "job_id": 77},
                                         dict(LIVE_STATUS, data={"state": "failed", "missing_tables": [], "spec_version": 2}))
    inst._implement_use_case_row = lambda sid, uc: pytest.fail("a refused spec builds nothing")
    return inst


def test_an_edit_made_from_a_stale_version_is_a_conflict(agent_ns):
    inst = _refusing_inspire(agent_ns)
    with pytest.raises(agent_ns["ImplementBlocked"], match=r"edited from v2, but v3 has been built since"):
        inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 4,
                                    "spec_json": dict(VALID, based_on_version=2)}, (5150, "N01-U01", 4))
    assert inst.updates == [{"asset_status": LIVE_STATUS, "dashboard_id": "d1", "job_id": 77}], \
        "a conflicting edit builds nothing, and its row keeps the state of the outputs that are still live"


def test_schedule_sets_failure_emails_and_pause_state(agent_ns, sdk_stub):
    inst = _inspire(agent_ns, FakeSpark())
    updates = []
    inst.w_client = types.SimpleNamespace(jobs=types.SimpleNamespace(
        get=lambda job_id: types.SimpleNamespace(settings=types.SimpleNamespace(schedule=None)),
        update=lambda job_id, new_settings: updates.append(new_settings)))
    inst._implement_schedule("N01-U01", 7, {"enabled": True, "cron": "0 0 6 ? * MON", "timezone": "Asia/Dubai",
                                            "failure_emails": ["ops@example.com"]})
    settings = updates[0]
    assert settings.schedule.quartz_cron_expression == "0 0 6 ? * MON" and settings.schedule.pause_status.value == "UNPAUSED"
    assert settings.email_notifications.on_failure == ["ops@example.com"]
    inst._implement_schedule("N01-U01", 7, {"enabled": False, "cron": "0 0 6 ? * MON", "timezone": "UTC", "failure_emails": []})
    assert updates[1].schedule.pause_status.value == "PAUSED" and updates[1].email_notifications is None


def test_the_implement_table_columns_match_the_contract_the_app_shares(agent_ns):
    contract = json.load(open(FIXTURE))
    assert [list(c) for c in agent_ns["IMPLEMENT_COLUMNS"]] == contract["columns"]
    assert agent_ns["IMPLEMENT_LOCK_TTL_SECONDS"] == contract["stale_after_seconds"], \
        "the App calls a version stalled after the longest an Implement run may hold its lock"


def _python_popen(script):
    return lambda command, **kw: subprocess.Popen([sys.executable, "-c", script], **kw)


def test_genie_run_drains_stderr_so_a_noisy_genie_never_blocks(agent_ns, tmp_path):
    script = ("import json, sys\nsys.stderr.write('e' * 300000)\nsys.stderr.flush()\n"
              "print(json.dumps({'type': 'item.completed', 'item': {'type': 'agent_message', 'text': 'done'}}), flush=True)\n")
    runner = _runner(agent_ns, tmp_path, popen=_python_popen(script), timeout_s=20)
    result = runner.run("x", str(tmp_path / "w"))
    assert result["timed_out"] is False and result["exit"] == 0 and result["events"] == 1
    assert result["stderr"] == "e" * 2000


def test_genie_run_stops_a_child_that_keeps_the_output_open_after_genie_exits(fresh_ns, tmp_path):
    import time
    fresh_ns["GENIE_CODE_EXIT_GRACE_S"] = 1
    script = ("import subprocess, sys\nsubprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])\n"
              "print('{\"type\": \"turn.completed\", \"usage\": {}}', flush=True)\n")
    runner = _runner(fresh_ns, tmp_path, popen=_python_popen(script), timeout_s=120)
    started = time.time()
    result = runner.run("x", str(tmp_path / "w"))
    assert time.time() - started < 30, "an orphaned child held Genie's output open until it exited"
    assert result["exit"] == 0 and result["timed_out"] is False and result["events"] == 1
    assert runner.logger.matching("kept its output open for 1s; stopping its process group")


def test_kill_group_never_signals_the_notebook_process_group(agent_ns, monkeypatch):
    sent, killed = [], []
    monkeypatch.setattr(agent_ns["os"], "killpg", lambda pid, sig: sent.append(pid))
    agent_ns["GenieCodeRunner"]._kill_group(types.SimpleNamespace(pid=os.getpgrp(), kill=lambda: killed.append("own")))
    assert sent == [] and killed == ["own"]
    agent_ns["GenieCodeRunner"]._kill_group(types.SimpleNamespace(pid=999999, kill=lambda: killed.append("child")))
    assert sent == [999999] and killed == ["own"]
    agent_ns["GenieCodeRunner"]._kill_group(types.SimpleNamespace(kill=lambda: killed.append("no pid")))
    assert killed == ["own", "no pid"]


def test_genie_run_scrubs_the_token_and_reports_the_artifacts_that_held_it(agent_ns, tmp_path):
    seen = []
    work = tmp_path / "w"

    def popen(command, **kw):
        (work / ".databrickscfg").write_text("[DEFAULT]\ntoken = tok-123\n")
        (work / "app.py").write_text("TOKEN = 'tok-123'\nprint(1)\n")
        (work / "genie_last.txt").write_text('{"status": "built", "summary": "used tok-123"}')
        (tmp_path / ".databrickscfg").write_text("[DEFAULT]\nhost = https://x\ntoken = tok-123\n")
        (tmp_path / "home").mkdir(exist_ok=True)
        (tmp_path / "home" / "history.jsonl").write_text("ran with tok-123\n")
        (tmp_path / "cli").mkdir(exist_ok=True)
        (tmp_path / "cli" / "databricks").write_text("binary tok-123")
        return _FakeProc([{"type": "item.completed", "item": {"type": "agent_message", "text": "token tok-123"}}])

    runner = _runner(agent_ns, tmp_path, on_line=seen.append, popen=popen)
    result = runner.run("x", str(work), {"type": "object"})
    assert result["secret_files"] == ["app.py"]
    assert not (work / ".databrickscfg").exists()
    assert (work / "app.py").read_text() == "TOKEN = '<redacted>'\nprint(1)\n"
    assert result["final"] == {"status": "built", "summary": "used <redacted>"} and "tok-123" not in result["last"]
    assert (tmp_path / ".databrickscfg").read_text() == "[DEFAULT]\nhost = https://workspace.example.com\n"
    assert (tmp_path / "home" / "history.jsonl").read_text() == "ran with <redacted>\n"
    assert (tmp_path / "cli" / "databricks").read_text() == "binary tok-123", "the CLI binaries are never rewritten"
    assert seen == ["Genie: token <redacted>"]
    assert len(runner.logger.matching("[IMPLEMENT-SCRUB]")) == 5


def test_secret_and_carry_file_helpers(agent_ns, tmp_path):
    root = tmp_path / "r"
    (root / "bin").mkdir(parents=True)
    (root / "bin" / "x").write_text("tok-9")
    (root / "a.txt").write_text("has tok-9")
    (root / "b.txt").write_text("clean")
    os.symlink(root / "a.txt", root / "link.txt")
    assert agent_ns["implement_secret_files"](str(root), "tok-9", ("bin",)) == ["a.txt"]
    assert agent_ns["implement_secret_files"](str(root), "tok-9") == ["a.txt", "bin/x"]
    assert agent_ns["implement_secret_files"](str(root), "") == []
    assert agent_ns["implement_secret_files"](str(tmp_path / "missing"), "tok-9") == []
    previous, work = tmp_path / "p", tmp_path / "w"
    (previous / "app" / "__pycache__").mkdir(parents=True)
    (previous / "app" / "app.py").write_text("x")
    (previous / "app" / "__pycache__" / "m.pyc").write_text("x")
    (previous / ".hidden").write_text("x")
    (previous / "genie_last.txt").write_text("x")
    (previous / "genie_output_schema.json").write_text("{}")
    (previous / "dashboard.lvdash.json").write_text("{}")
    assert agent_ns["implement_carry_files"](str(previous), str(work)) == ["app/app.py", "dashboard.lvdash.json"]
    assert (work / "app" / "app.py").read_text() == "x" and not (work / "genie_last.txt").exists()
    assert agent_ns["implement_carry_files"]("", str(work)) == []
    assert agent_ns["implement_carry_files"](str(tmp_path / "missing"), str(work)) == []


class _FileRunner(_FakeRunner):
    def __init__(self, results, writes):
        super().__init__(results)
        self.writes, self.seen = list(writes), []

    def run(self, prompt, work_dir, schema=None, label=""):
        os.makedirs(work_dir, exist_ok=True)
        self.seen.append(sorted(os.listdir(work_dir)))
        for name, text in (self.writes.pop(0) if self.writes else {}).items():
            path = os.path.join(work_dir, name)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w") as f:
                f.write(text)
        return super().run(prompt, work_dir, schema, label)


def _loop_inspire(ns, tmp_path):
    inst = _flow_inspire(ns, [])
    inst.local_log_output_dir = str(tmp_path)
    return inst


LOOP_CONTEXT = {"uc_id": "N01-U01", "key": (5150, "N01-U01", 1)}


def test_each_genie_round_starts_clean_then_from_the_last_attempt(agent_ns, tmp_path):
    inst = _loop_inspire(agent_ns, tmp_path)
    stale = tmp_path / "implement" / "N01-U01" / "dashboard_1"
    stale.mkdir(parents=True)
    (stale / "from_an_older_run.json").write_text("{}")
    runner = _FileRunner([{"exit": 0}, {"exit": 0}],
                         [{"dashboard.lvdash.json": "{}", ".genie_state": "x", "genie_last.txt": "x"}, {}])
    attempts = []

    def deploy(work):
        attempts.append(work)
        if len(attempts) == 1:
            raise RuntimeError("dataset decision_list failed: UNRESOLVED_COLUMN rank")
        return {"dashboard_id": "d1", "_asset": {"note": "kept out of the step payload"}}

    assert inst._implement_genie_loop(LOOP_CONTEXT, runner, "Dashboard", "write it", deploy)["dashboard_id"] == "d1"
    assert runner.seen == [[], ["dashboard.lvdash.json"]], "round 1 starts clean; round 2 starts from round 1's files"
    assert "UNRESOLVED_COLUMN rank" in runner.prompts[1]
    assert "Your files from that attempt are in your working folder: fix them rather than starting over" in runner.prompts[1]
    assert inst.updates == [{"status_message": "Dashboard: Genie round 1 of up to 4"}, {"status_message": "Dashboard: Genie round 2 of up to 4"}]
    messages = [e["message"] for e in inst.emitted]
    assert messages[1] == "round 1 of up to 4 failed, sent back to Genie: dataset decision_list failed: UNRESOLVED_COLUMN rank"
    assert messages[2] == "round 2 of up to 4: Genie is writing the Dashboard from its last attempt (1 file)"
    assert "_asset" not in inst.emitted[-1]["result_json"] and inst.emitted[-1]["result_json"]["dashboard_id"] == "d1"


def test_an_output_round_sent_back_to_genie_stays_running_on_one_step(agent_ns, tmp_path):
    inst = _loop_inspire(agent_ns, tmp_path)
    runner = _FakeRunner([{"exit": 0}, {"exit": 0}])
    attempts = []

    def deploy(work):
        attempts.append(work)
        if len(attempts) == 1:
            raise RuntimeError("app.yaml: command not found")
        return {"app_name": "a"}

    assert inst._implement_genie_loop(LOOP_CONTEXT, runner, "App", "write it", deploy) == {"app_name": "a"}
    assert [(e["status"], e["step_id"]) for e in inst.emitted] == [("started", None), ("started", 1), ("started", 1), ("ended_success", 1)]
    assert {k: inst.emitted[1]["result_json"][k] for k in ("round", "rounds", "failure")} == {
        "round": 1, "rounds": 4, "failure": "app.yaml: command not found"}
    assert inst.emitted[2]["result_json"]["round"] == 2
    assert not [e for e in inst.emitted if e["status"] == "ended_warning"], "a round Genie gets back has not ended"


def test_a_round_whose_files_held_the_token_never_deploys(agent_ns, tmp_path):
    inst = _loop_inspire(agent_ns, tmp_path)
    runner = _FakeRunner([{"exit": 0, "secret_files": ["app/app.py"]}, {"exit": 0, "secret_files": []}])
    deployed = []
    fields = inst._implement_genie_loop(LOOP_CONTEXT, runner, "App", "write it", lambda work: deployed.append(work) or {"app_name": "a"})
    assert fields == {"app_name": "a"} and len(deployed) == 1
    assert "app/app.py held the access token (Inspire removed it)" in runner.prompts[1]


def test_genie_exits_are_reported_with_the_time_limit_and_the_last_round_says_no_rounds_left(agent_ns, tmp_path):
    inst = _loop_inspire(agent_ns, tmp_path)
    runner = _FakeRunner([{"exit": 3, "timed_out": True, "stderr": "x" * 600 + "killed"}] * 3)
    with pytest.raises(RuntimeError, match="still failed after 3 Genie rounds: Genie exited with code 3 after the time limit"):
        inst._implement_genie_loop(LOOP_CONTEXT, runner, "Alert", "write it", lambda work: pytest.fail("a failed Genie never deploys"))
    assert inst.emitted[-1]["status"] == "ended_error" and ", no rounds left: " in inst.emitted[-1]["message"]
    assert inst.emitted[-1]["message"].endswith("killed")


def test_a_blocked_output_is_not_sent_back_to_genie(agent_ns, tmp_path):
    inst = _loop_inspire(agent_ns, tmp_path)
    runner = _FakeRunner([{"exit": 0}, {"exit": 0}])
    blocked = agent_ns["ImplementBlocked"]
    with pytest.raises(blocked, match="QUOTA_EXCEEDED"):
        inst._implement_genie_loop(LOOP_CONTEXT, runner, "App", "write it",
                                   lambda work: (_ for _ in ()).throw(blocked("QUOTA_EXCEEDED: 50 apps")))
    assert len(runner.prompts) == 1
    assert "round 1 of up to 4 failed for a reason Genie cannot fix: QUOTA_EXCEEDED" in inst.emitted[-1]["message"]


def test_a_leaked_token_and_a_failed_preview_both_reach_genie(agent_ns):
    inst = _flow_inspire(agent_ns, [({"status": "failed", "error": "401 Unauthorized"}, 11, 101),
                                    ({"status": "written", "rows_written": 4}, 11, 102)])
    redacted = []
    inst._implement_redact_notebook_secret = lambda path, token: redacted.append((path, token)) or len(redacted) == 1
    runner = _FakeRunner([{"exit": 0, "final": _fill(), "secret_files": ["helper.py"]}, {"exit": 0, "final": _fill()}])
    runner.token = "tok-1"
    spec = agent_ns["validate_implement_spec"](VALID)[0]
    outcome, _job, _f = inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), {}, spec, None, "/W/nb",
                                                         ["result_table", "run_profile"], runner, True)
    assert outcome["status"] == "written" and redacted == [("/W/nb", "tok-1"), ("/W/nb", "tok-1")]
    second = runner.prompts[1]
    assert "the run failed: 401 Unauthorized" in second
    assert "Inspire also found: helper.py held the access token" in second and "the notebook held the access token" in second
    assert "Inspire also found" not in runner.prompts[0]


def test_the_fill_prompt_carries_the_number_rule_and_never_a_cli_profile(agent_ns):
    prompt = agent_ns["DatabricksInspire"]._IMPLEMENT_FILL_PROMPT.format(
        path="/W/nb", task="Build it.", feedback="", number_rule=agent_ns["GENIE_NUMBER_FORMAT_RULE"])
    assert "Numbers in text: Every number written into top_reasons" in prompt and "--profile" not in prompt
    assert "is written by Inspire's number helpers" in prompt and "and never define, copy or change them" in prompt
    assert "def fmt_num" not in prompt and agent_ns["GENIE_NUMBER_TEXT_SOURCE"] not in prompt


def test_a_notebook_that_holds_the_token_is_rewritten_without_it(agent_ns, sdk_stub):
    workspace = _NotebookWorkspace({"cells": [_cell(None, "TOKEN = 'tok-1'")]}, modified_at=5)
    inst = _notebook_inspire(agent_ns, workspace)
    assert inst._implement_redact_notebook_secret("/W/nb", "tok-1") is True
    assert workspace.imported[-1]["cells"][0]["source"] == ["TOKEN = '<redacted>'"]
    assert inst.logger.matching("[IMPLEMENT-SCRUB] /W/nb held the access token: redacted it")
    assert inst._implement_redact_notebook_secret("/W/nb", "") is False
    clean = _NotebookWorkspace({"cells": [_cell(None, "x = 1")]}, modified_at=5)
    inst = _notebook_inspire(agent_ns, clean)
    assert inst._implement_redact_notebook_secret("/W/nb", "tok-1") is False and clean.imported == []


RULE_FORMATTERS = '''import math


def fmt_num(x):
    if x is None or not math.isfinite(float(x)):
        return "unknown"
    x = float(x)
    if x == 0:
        return "0"
    x = round(x, 2 - math.floor(math.log10(abs(x))))
    suffix = ""
    for limit, label in ((1e9, "B"), (1e6, "M"), (1e3, "K")):
        if abs(x) >= limit:
            x, suffix = x / limit, label
            break
    if float(x).is_integer():
        return f"{int(x)}{suffix}"
    text = f"{x:.{max(0, 2 - math.floor(math.log10(abs(x))))}f}"
    return (text.rstrip("0").rstrip(".") if "." in text else text) + suffix


def fmt_count(n, noun, plural=None):
    return f"{fmt_num(n)} {noun if n == 1 else plural or noun + 's'}"


def fmt_rank(r):
    if r is None or not math.isfinite(float(r)):
        return "unknown"
    r = int(r)
    return f"{r:,}" + ("th" if r % 100 in (11, 12, 13) else {1: "st", 2: "nd", 3: "rd"}.get(r % 10, "th"))
'''


def _number_cells(ns, *cells):
    return [(f"cell {i}", c.replace("<inspire>", ns["GENIE_NUMBER_TEXT_SOURCE"]).replace("<rule>", RULE_FORMATTERS))
            for i, c in enumerate(cells, 3)]


NUMBER_USES = ("reasons = [f\"net loss {fmt_num(v)}\" for v in losses]\n"
               "print(f'{share:.1%}', f'{n:,}', f'{value:.2f}', f'{name:>10}', '%d rows' % n, '%s' % name, '{:,}'.format(n))\n"
               "label = name.rstrip()\nline = text.rstrip('\\n')\nshown = format(n, ',')\n")


def test_a_notebook_that_calls_inspires_number_helpers_passes(agent_ns):
    check = agent_ns["implement_number_text_problems"]
    assert check(_number_cells(agent_ns, "%pip install prophet==1.1.5\n", NUMBER_USES)) == []
    assert check(_number_cells(agent_ns, "reasons = keep_reasons([(fmt_count(n, 'day'), (n,)) for n in gaps])")) == [], \
        "a notebook that writes its reasons through fmt_count writes every number with Inspire's helpers"
    assert check(_number_cells(agent_ns, "def fmt_share(v):\n    return fmt_num(v * 100) + '%'\n", "x = fmt_share(0.4)")) == [], \
        "a function of the notebook's own that calls Inspire's helpers is not a copy of them"
    assert check(_number_cells(agent_ns, "def broken(:\n", NUMBER_USES)) == [], "a cell that does not parse is skipped"
    assert check(_number_cells(agent_ns, "shown = f'{n:,}'"), required=False) == [], "a check that does not require a call passes"


DEFINED = ("which Inspire's 'Number helpers (Inspire, do not edit)' cell already defines: delete those definitions and call "
           "Inspire's is_missing, fmt_num, fmt_count, fmt_rank, keep_reasons")


@pytest.mark.parametrize("cells,needle", [
    ((), "no cell calls fmt_num or fmt_count or fmt_rank"),
    (("x = keep_reasons(facts)",), "no cell calls fmt_num or fmt_count or fmt_rank"),
    (("<rule>", "x = fmt_num(1)"), "the notebook defines fmt_num in cell 3; fmt_count in cell 3; fmt_rank in cell 3, " + DEFINED),
    (("<rule>", "<rule>\nx = fmt_num(1)"), "the notebook defines fmt_num in cell 3, cell 4; fmt_count in cell 3, cell 4"),
    (("<inspire>", "x = fmt_num(1)"), "the notebook defines is_missing in cell 3; fmt_num in cell 3; fmt_count in cell 3; "
                                      "fmt_rank in cell 3; keep_reasons in cell 3, " + DEFINED),
    (("def run_use_case():\n    def fmt_num(x):\n        return str(round(x, 2))\n    return fmt_num(1)\n",),
     "the notebook defines fmt_num in cell 3, " + DEFINED),
    (("def keep_reasons(facts):\n    return [text for text, _ in facts][:3]\n", "x = fmt_num(1)"),
     "the notebook defines keep_reasons in cell 3, " + DEFINED),
    (("def is_missing(x):\n    return x is None\n", "x = fmt_num(1)"), "the notebook defines is_missing in cell 3, " + DEFINED),
    (("fmt_rank = lambda r: f'{int(r)}th'\n", "x = fmt_num(1)"), "the notebook defines fmt_rank in cell 3, " + DEFINED),
    (("x = fmt_num(1)\ny = str(v).rstrip('0').rstrip('.')",), "cell 3 line 2 strips zeros"),
    (("x = fmt_num(1)\ny = f'{v:.3g}'",), "cell 3 line 2 writes a number with Python's 'g' format"),
    (("x = fmt_num(1)\ny = f'{v:g}'",), "cell 3 line 2 writes a number with Python's 'g' format"),
    (("x = fmt_num(1)\ny = f'{v:>12,.4G}'",), "cell 3 line 2 writes a number with Python's 'g' format"),
    (("x = fmt_num(1)\ny = format(v, '.3g')",), "cell 3 line 2 writes a number with Python's 'g' format"),
    (("x = fmt_num(1)\ny = 'loss {:.3g}'.format(v)",), "cell 3 line 2 writes a number with Python's 'g'"),
    (("x = fmt_num(1)\ny = 'loss %.3g' % v",), "cell 3 line 2 writes a number with Python's 'g' format"),
    (("x = fmt_num(1)\ndef helper(v):\n    return str(v).rstrip('0')",), "cell 3 line 3 strips zeros"),
    (("x = fmt_num(1)\ndef fmt_share(v):\n    return f'{v:.3g}%'",), "cell 3 line 3 writes a number with Python's 'g'"),
])
def test_the_number_check_rejects(agent_ns, cells, needle):
    problems = agent_ns["implement_number_text_problems"](_number_cells(agent_ns, *cells))
    assert any(needle in p for p in problems), problems


def test_a_copy_of_the_number_helpers_is_reported_once_and_never_for_the_text_inside_it(agent_ns):
    check = agent_ns["implement_number_text_problems"]
    problems = check(_number_cells(agent_ns, "<rule>", "x = fmt_num(1)"))
    assert len(problems) == 1 and problems[0].startswith("the notebook defines fmt_num in cell 3;"), \
        "the rstrip inside a copied fmt_num is part of the copy, so the one problem is the copy itself"
    alone = check(_number_cells(agent_ns, "<rule>"))
    assert len(alone) == 2 and alone[0] == problems[0] and alone[1].startswith("no cell calls fmt_num or fmt_count or fmt_rank"), \
        "calls inside a copy are not calls of Inspire's helpers"


def test_number_problems_send_the_build_back_to_genie_before_any_preview(agent_ns):
    inst = _flow_inspire(agent_ns, [({"status": "written", "rows_written": 7}, 11, 101)])
    inst.number_reports = [["cell 5 line 2 strips zeros from a number's text with rstrip, which turns 120 into '12'"], []]
    runner = _FakeRunner([{"exit": 0, "final": _fill()}, {"exit": 0, "final": _fill()}])
    spec = agent_ns["validate_implement_spec"](VALID)[0]
    outcome, _job, _f = inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), {}, spec, None, "/W/nb",
                                                         ["result_table", "run_profile"], runner, True)
    assert outcome == {"status": "written", "rows_written": 7} and len(runner.prompts) == 2
    assert "Inspire checked your last attempt and found: cell 5 line 2 strips zeros" in runner.prompts[1]
    last = _flow_inspire(agent_ns, [({"status": "written", "rows_written": 7}, 11, 101)])
    last.number_reports = [["cell 5 line 2 strips zeros"]] * 3
    runner = _FakeRunner([{"exit": 0, "final": _fill()}] * 3)
    outcome, _job, _f = last._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), {}, spec, None, "/W/nb",
                                                         ["result_table", "run_profile"], runner, True)
    assert len(runner.prompts) == 3 and outcome["status"] == "written", "the last round still previews and reports the warning"
    assert outcome["build_problems"] == ["cell 5 line 2 strips zeros"]


def test_the_number_check_reads_only_genie_cells_and_skips_a_notebook_it_cannot_read(agent_ns, sdk_stub):
    notebook = {"cells": [{"cell_type": "markdown", "source": ["x = str(v).rstrip('0')"]},
                          _cell("Genie Code instruction", "y = f'{v:g}'"),
                          _cell(agent_ns["GENIE_NUMBER_HELPERS_TITLE"], RULE_FORMATTERS),
                          _cell(None, "z = fmt_num(3)\ninspire_write_summary(z, result_table, run_id, as_of_date)"),
                          _cell("Run controls (Inspire, do not edit)", "w = str(v).rstrip('0')")]}
    inst = _notebook_inspire(agent_ns, _NotebookWorkspace(notebook, modified_at=5))
    assert inst._implement_cell_problems("/W/nb") == []
    notebook["cells"][3] = _cell(None, "z = fmt_num(3)\nw = str(v).rstrip('0')")
    inst = _notebook_inspire(agent_ns, _NotebookWorkspace(notebook, modified_at=5))
    assert any("cell 4 line 2 strips zeros" in p for p in inst._implement_cell_problems("/W/nb"))
    missing = _notebook_inspire(agent_ns, _NotebookWorkspace(None, modified_at=None))
    assert missing._implement_cell_problems("/W/nb") == []
    assert missing.logger.matching("[IMPLEMENT-CELLS] /W/nb could not be read") and missing.logger.matching("is not a notebook")
    gone = _NotebookWorkspace(None, modified_at=None)
    gone.export = lambda path, format=None: (_ for _ in ()).throw(RuntimeError("RESOURCE_DOES_NOT_EXIST"))
    inst = _notebook_inspire(agent_ns, gone)
    assert inst._implement_cell_problems("/W/nb") == [] and inst.logger.matching("RESOURCE_DOES_NOT_EXIST")


def test_the_notebook_cell_carries_the_current_platform_rules(agent_ns, sdk_stub):
    workspace = _NotebookWorkspace(None, modified_at=None)
    inst = _notebook_inspire(agent_ns, workspace)
    stored = "# Churn\n\nBuild it.\n\n## Platform Rules\n- strip trailing zeros from a number's text\n"
    inst._implement_write_notebook({"No": "N01-U01", "genie_instruction": stored}, agent_ns["validate_implement_spec"](VALID)[0], None, (5150, "N01-U01", 1))
    text = workspace.imported[-1]["cells"][1]["source"][0]
    assert "strip trailing zeros" not in text and text.count("## Platform Rules") == 1
    assert "is written by Inspire's number helpers" in text and agent_ns["GENIE_NUMBER_TEXT_SOURCE"] not in text
    assert text.index("## Platform Rules") < text.index("## Implementation Choices")


def test_the_alert_trigger_writes_the_threshold_like_the_wizard(agent_ns):
    with open(FIXTURE) as handle:
        triggers = json.load(handle)["alert_triggers"]
    assert len(triggers) >= 6
    for outputs, text in triggers:
        assert agent_ns["implement_alert_trigger_text"](outputs) == text, outputs


def test_query_lines_are_joined_with_newlines_so_words_never_fuse(agent_ns, tmp_path):
    join = agent_ns["implement_join_lines"]
    assert join(["SELECT a", "FROM t", "WHERE x = 1"]) == ["SELECT a\n", "FROM t\n", "WHERE x = 1"]
    assert join(["SELECT a ", "FROM t\n", "LIMIT 5"]) == ["SELECT a ", "FROM t\n", "LIMIT 5"]
    assert join([]) == [] and join(None) == []
    board = _built_dashboard(agent_ns, tmp_path)
    board["datasets"][1]["queryLines"] = ["SELECT *", "FROM main.inspire.churn_out", "ORDER BY rank"]
    dashboard, errors = agent_ns["check_dashboard_definition"](json.dumps(board), ["main.inspire.churn_out", "main.s.orders"], "records")
    assert errors == []
    assert "".join(dashboard["datasets"][1]["queryLines"]) == "SELECT *\nFROM main.inspire.churn_out\nORDER BY rank"
    space = json.loads(_space())
    space["serialized_space"]["instructions"]["example_question_sqls"][0]["sql"] = ["SELECT COUNT(*)", "FROM main.inspire.churn_out"]
    _t, _d, normalized, errors = agent_ns["normalize_genie_space"](json.dumps(space), ["main.inspire.churn_out"])
    assert errors == [] and normalized["instructions"]["example_question_sqls"][0]["sql"] == ["SELECT COUNT(*)\n",
                                                                                               "FROM main.inspire.churn_out"]


def test_the_decision_list_must_be_on_the_first_page(agent_ns, tmp_path):
    allowed = ["main.inspire.churn_out", "main.s.orders"]
    board = _built_dashboard(agent_ns, tmp_path)
    board["pages"] = [{"name": "trend", "layout": []}] + board["pages"]
    errors = agent_ns["check_dashboard_definition"](json.dumps(board), allowed, "records")[1]
    assert any("the first page shows no widget over the records dataset" in e for e in errors), errors
    board["pages"] = [{"name": "filters", "pageType": "PAGE_TYPE_GLOBAL_FILTERS", "layout": []}] + board["pages"][1:]
    assert agent_ns["check_dashboard_definition"](json.dumps(board), allowed, "records")[1] == []


TRUTH = [{"entity_id": "c1", "entity_label": "Acme", "priority_tier": "Monitor", "rank": 1},
         {"entity_id": "c2", "entity_label": "Beta", "priority_tier": "Monitor", "rank": 2}]


def test_decision_list_check_catches_relabeled_tiers_and_missing_top_rows(agent_ns):
    problems = agent_ns["implement_decision_list_problems"]
    assert problems([dict(t) for t in TRUTH], TRUTH) == []
    relabeled = problems([dict(TRUTH[0], priority_tier="Act now"), TRUTH[1]], TRUTH)
    assert len(relabeled) == 1 and "changes priority tiers (c1 shows 'Act now' but the table holds 'Monitor')" in relabeled[0]
    missing = problems([TRUTH[1]], TRUTH)
    assert len(missing) == 1 and "leaves out top-ranked current rows (c1)" in missing[0]
    assert "returned no rows" in problems([], TRUTH)[0]
    assert "must return priority_tier and entity_label" in problems([{"rank": 1}], TRUTH)[0]
    assert problems([], []) == []
    assert problems([{"ENTITY_ID": "c1", "PRIORITY_TIER": "Monitor"}, {"ENTITY_ID": "c2", "PRIORITY_TIER": "Monitor"}], TRUTH) == []
    no_ids = [dict(t, entity_id=None) for t in TRUTH]
    assert problems([{"entity_label": "Acme", "priority_tier": "Monitor"}, {"entity_label": "Beta", "priority_tier": "Monitor"}],
                    no_ids) == []
    assert "Acme shows 'Review'" in problems([{"entity_label": "Acme", "priority_tier": "Review"},
                                              {"entity_label": "Beta", "priority_tier": "Monitor"}], no_ids)[0]


def _contract(uc):
    return [("decision", "Decision", "Call at-risk customers"), ("decision_owner", "Owner", "Retention lead"),
            ("cadence", "Cadence", "weekly"), ("kpi", "KPI", "churn rate")]


def _output_inspire(ns, tmp_path, answers=None):
    inst = _loop_inspire(ns, tmp_path)
    inst.w_client = types.SimpleNamespace(workspace=types.SimpleNamespace(mkdirs=lambda p: None),
                                          config=types.SimpleNamespace(host="https://h/"))
    inst._implement_notebook_paths = lambda uc, key: ("/W/acme_implemented/Sales", "/W/acme_implemented/Sales/N01-U01")
    inst._genie_decision_contract = _contract
    calls = []

    def api(method, path, body=None, query=None):
        calls.append((method, path, body, query))
        answer = (answers or {}).get((method, path))
        if isinstance(answer, Exception):
            raise answer
        if answer is not None:
            return answer
        return {"dashboard_id": "d9"} if (method, path) == ("POST", "/api/2.0/lakeview/dashboards") else {}

    inst._implement_api = api
    inst._implement_space_columns = lambda tables: {t.lower(): SPACE_COLUMNS.get(t.lower(), []) for t in tables}
    return inst, calls


def _output_context(ns, **outputs):
    spec = _spec(ns, outputs={**VALID["outputs"], **outputs})[0] if outputs else _spec(ns)[0]
    return {"uc_id": "N01-U01", "key": (5150, "N01-U01", 2), "use_case": {"Name": "Predict churn", "Statement": "Customers leave"},
            "spec": spec, "result_table": "main.inspire.churn_out", "allowed": ["main.inspire.churn_out", "main.s.orders"],
            "notebook_spec": {"value_type": "probability", "decision_basis": "predicted", "use_case_id": "N01-U01",
                              "action_target": "the churn list",
                              "action_by_tier": {"Act now": "Act in this cycle", "Review": "Review in this cycle",
                                                 "Monitor": "Keep monitoring"}},
            "assets": {}, "job_id": 77, "asset_status": {}, "urls": {"dashboard_url": "https://h/d"}}


def test_every_output_brief_says_what_each_column_means(agent_ns, tmp_path):
    inst, _calls = _output_inspire(agent_ns, tmp_path)
    context = _output_context(agent_ns)
    context["use_case"]["genie_instruction"] = ("## 6. Method and Acceptance\nCompare two methods.\n\n## 7. Business Output\n"
                                                "`value` is the churn probability in the next 30 days.\n\n## 8. Definition of Done\n"
                                                "Ran top to bottom.\n")
    brief = inst._implement_use_case_brief(context)
    assert "Business output table: `main.inspire.churn_out`, with these columns:\n- as_of_date DATE: the date" in brief
    assert ("- data_quality_flag STRING: 'ok', or the reason this row's own inputs are incomplete or too sparse" in brief)
    assert "- value_type STRING: always 'probability'" in brief and "- use_case_id STRING: always 'N01-U01'" in brief
    assert "- value DOUBLE: the result for this row's own entity, never a value of the group it belongs to" in brief
    assert "never 0 or the baseline in its place; section 7 says what it means and its unit\n" in brief
    assert ("Section 7, Business Output, of the notebook's instruction:\n`value` is the churn probability in the next 30 days.\n"
            "No raw JSON: people never see a list") in brief and brief.endswith("Input tables: `main.s.orders`\n")
    assert "Compare two methods" not in brief and "Ran top to bottom" not in brief
    context["use_case"]["genie_instruction"] = "## 1. Goal\nCut churn.\n"
    assert "Section 7" not in inst._implement_use_case_brief(context)
    *lines, actions = inst._genie_output_column_lines(context["notebook_spec"])
    assert [line.split(":")[0] for line in lines] == [f"{n} {t}" for n, t in agent_ns["INSPIRE_CORE_COLUMNS"]]
    assert not any("section 6" in line for line in lines)
    assert actions.startswith("Action text per priority tier: 'Act now' = \"Act in this cycle\"") and actions not in brief


REASONS_VIEW = "main.inspire.churn_out_reasons"
GRANT_REASONS = "GRANT SELECT ON TABLE `main`.`inspire`.`churn_out_reasons` TO `{}`"


def _raw_json_named(label, problems):
    named = {}
    for problem in problems:
        column, rest = problem[len(f"{label} returns "):].split(" as ", 1)
        named[column] = rest.split(", which people would read as raw JSON")[0]
    return named


def test_raw_json_problems_name_each_list_object_and_json_text_column_once(agent_ns):
    problems = agent_ns["implement_raw_json_problems"]
    struct = types.SimpleNamespace(asDict=lambda: {"k": 1})
    rows = [{"top_reasons": ["late 3 times"], "meta": {"k": 1}, "payload": '{"k": 1}', "label": "[TARGET] keep", "joined": "a · b",
             "empty": None, "count": 3, "brackets": "[not json]", "blank": "", "quoted": '"just text"'},
            {"top_reasons": ["paid late"], "listed": " [1, 2] ", "nested": struct, "pair": ("a", "b"), "label": "{also not json"}]
    found = problems("dataset decision_list", rows)
    assert _raw_json_named("dataset decision_list", found) == {
        "top_reasons": "a list", "meta": "an object", "payload": "JSON text", "listed": "JSON text", "nested": "an object", "pair": "a list"}
    assert len(found) == 6, "a column is named once however many rows hold JSON"
    assert found[0] == ("dataset decision_list returns top_reasons as a list, which people would read as raw JSON; return readable "
                        "text instead (array_join(top_reasons, ' · ') for a list, one column per field for an object), or read the "
                        "one-row-per-reason view")
    assert problems("dataset decision_list", [dict(TRUTH[0], top_reasons="late 3 times · paid late")]) == []
    assert problems("x", []) == [] and problems("x", None) == []


def test_the_reasons_view_has_one_row_per_reason_with_the_columns_the_outputs_are_told(agent_ns):
    sql = agent_ns["implement_reasons_view_sql"]("main.inspire.churn_out")
    assert agent_ns["implement_reasons_view"]("main.inspire.churn_out") == REASONS_VIEW
    assert sql.startswith("CREATE VIEW IF NOT EXISTS `main`.`inspire`.`churn_out_reasons` COMMENT 'One row per reason in top_reasons "
                          "of main.inspire.churn_out, so filters and charts read each reason on its own' AS SELECT ")
    assert sql.endswith(" FROM `main`.`inspire`.`churn_out` LATERAL VIEW POSEXPLODE(top_reasons) r AS pos, reason")
    selected = sql.split(" AS SELECT ", 1)[1].split(" FROM ", 1)[0]
    aliases = [column.split(" AS ")[-1] for column in selected.split(", ")]
    described = agent_ns["IMPLEMENT_REASONS_VIEW_COLUMNS"].replace(" (1 for a row's first reason)", "").replace(" and ", ", ").split(", ")
    assert aliases == described
    core = {name for name, _kind in agent_ns["INSPIRE_CORE_COLUMNS"]}
    assert set(aliases) - core == {"reason_position", "reason", *agent_ns["IMPLEMENT_REASONS_HISTORY_COLUMNS"]} and "top_reasons" not in aliases
    assert "pos + 1 AS reason_position" in selected, "a row's first reason is 1, not POSEXPLODE's 0"


def test_the_reasons_view_is_created_and_a_failed_create_is_a_warning_that_says_why(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    warnings = []
    assert inst._implement_reasons_view("main.inspire.churn_out", warnings) == REASONS_VIEW and warnings == []
    assert inst.spark.statements == [agent_ns["implement_reasons_view_sql"]("main.inspire.churn_out"),
                                     "DESCRIBE TABLE `main`.`inspire`.`churn_out_reasons`",
                                     agent_ns["implement_reasons_view_alter_sql"]("main.inspire.churn_out")]

    def refuse(statement):
        raise RuntimeError("PERMISSION_DENIED: User does not have CREATE TABLE on Schema 'main.inspire'")

    inst = _inspire(agent_ns, FakeSpark(responder=refuse))
    assert inst._implement_reasons_view("main.inspire.churn_out", warnings) == ""
    assert len(warnings) == 1 and warnings[0].startswith(
        "The one-row-per-reason view main.inspire.churn_out_reasons was not created, so the outputs show reasons only as joined text: ")
    assert "CREATE TABLE on Schema 'main.inspire'" in warnings[0]


def test_the_brief_names_the_reasons_view_and_says_people_never_see_raw_json(agent_ns, tmp_path):
    inst, _calls = _output_inspire(agent_ns, tmp_path)
    context = _output_context(agent_ns)
    plain = inst._implement_use_case_brief(context)
    assert "Reasons view" not in plain and "\nNo raw JSON: people never see a list, an object or JSON text." in plain
    assert plain.endswith("Input tables: `main.s.orders`\n")
    context.update(reasons_view=REASONS_VIEW, allowed=context["allowed"] + [REASONS_VIEW])
    brief = inst._implement_use_case_brief(context)
    assert (f"\nReasons view: `{REASONS_VIEW}`, one row per reason in top_reasons, with the columns as_of_date, run_id, use_case_id, "
            "entity_id, entity_label, rank, priority_tier, record_key, valid_from, valid_to, is_current, change_source, reason_position "
            "(1 for a row's first reason) and reason; read it to filter or count by reason, "
            "from its current rows WHERE is_current, since it lists every version of each record. Each reason holds its record's own "
            "numbers, so never group a chart by reason; group by a categorical column many records share, such as an ai_cat_ category "
            "or priority_tier. A record repeats once per reason here, so never SUM or AVG a per-record measure such as value_at_stake "
            "over this view or a join to it, and never count records there with COUNT(*) or COUNT of a per-record column: Inspire "
            "rejects both; add each record's value once from the records dataset, or count records with COUNT(DISTINCT record_key).\n") in brief
    assert brief.endswith("Input tables: `main.s.orders`\n"), "the view is not listed as an input table"
    context.update(run_log="main.inspire.churn_out_run_log", allowed=context["allowed"] + ["main.inspire.churn_out_run_log"])
    assert inst._implement_use_case_brief(context).endswith("Input tables: `main.s.orders`\n"), "nor is the run log"


GENIE_CHECKED = {("POST", "/api/2.0/genie/spaces"): {"space_id": "s9"},
                 ("POST", "/api/2.0/genie/spaces/s9/start-conversation"): {"conversation_id": "c1", "message_id": "m1"},
                 ("GET", "/api/2.0/genie/spaces/s9/conversations/c1/messages/m1"): {
                     "status": "COMPLETED", "attachments": [{"text": {"content": "12 customers"}},
                                                            {"query": {"query": "SELECT COUNT(*) FROM main.inspire.churn_out"}}]}}


def test_a_genie_space_whose_example_sql_returns_a_raw_list_goes_back_to_genie(agent_ns, tmp_path):
    inst, calls = _output_inspire(agent_ns, tmp_path, GENIE_CHECKED)
    space = _space(grounded=True)
    runner = _FileRunner([{"exit": 0}, {"exit": 0}], [{"genie_space.json": space}, {"genie_space.json": space}])
    inst._implement_run_query_check = lambda sql, require_rows=False, limit=20: [
        {"entity_id": "c1", "top_reasons": ["late 3 times"] if len(runner.prompts) == 1 else "late 3 times"}]
    context = dict(_output_context(agent_ns), reasons_view=REASONS_VIEW)
    context["allowed"] = context["allowed"] + [REASONS_VIEW]
    assert inst._implement_genie_space(context, runner)["genie_space_id"] == "s9"
    assert f"- Tables: the business output table first, then the reasons view `{REASONS_VIEW}`, then the input tables" in runner.prompts[0]
    assert ("the example SQL for 'Which customers act now?' returns top_reasons as a list, which people would read as raw JSON"
            in runner.prompts[1])
    assert [c[:2] for c in calls].count(("POST", "/api/2.0/genie/spaces")) == 1, "no space is saved until its SQL shows no raw JSON"
    plain = _FileRunner([{"exit": 0}], [{"genie_space.json": _space(grounded=True)}])
    inst._implement_run_query_check = lambda sql, require_rows=False, limit=20: [] if "HAVING COUNT(*) > 1" in sql else [{"n": 1}]
    inst._implement_genie_space(_output_context(agent_ns), plain)
    assert "- Tables: the business output table first, then the input tables" in plain.prompts[0]
    logged = _FileRunner([{"exit": 0}], [{"genie_space.json": _space(grounded=True)}])
    log = "main.inspire.churn_out_run_log"
    context = dict(_output_context(agent_ns), run_log=log, run_versions={"table": "main.inspire.churn_out", "log": log, "views": []})
    context["allowed"] = context["allowed"] + [log]
    inst._implement_genie_space(context, logged)
    assert (f"- Tables: the business output table first, then the run log `{log}`, which lists every record of every run, for questions "
            "that count or compare runs, then the input tables") in logged.prompts[0]


ALERT = {"alert": True, "alert_recipients": ["owner@example.com"]}


def test_alert_options_normalize_with_their_defaults(agent_ns):
    spec, errors = _spec(agent_ns, outputs={**VALID["outputs"], "alert": True, "alert_name": " Churn alert ",
                                            "alert_recipients": ["Owner@Example.com", "owner@example.com", "b@example.com"],
                                            "alert_destinations": [{"id": "1234abcd-ef", "name": "Slack #churn"}, "1234abcd-ef"]})
    assert errors == []
    out = spec["outputs"]
    assert out["alert"] is True and out["alert_name"] == "Churn alert" and out["alert_condition_text"] == ""
    assert (out["alert_tiers"], out["alert_operator"], out["alert_threshold"]) == ("act_now", ">=", 1.0)
    assert out["alert_recipients"] == ["Owner@Example.com", "b@example.com"]
    assert out["alert_destinations"] == [{"id": "1234abcd-ef", "name": "Slack #churn"}]
    off = _spec(agent_ns, outputs={**VALID["outputs"], "alert_recipients": ["owner@example.com"], "alert_name": "x"})[0]["outputs"]
    assert off["alert"] is False and off["alert_name"] == "" and off["alert_recipients"] == [] and off["alert_destinations"] == []


@pytest.mark.parametrize("changes,needle", [
    ({"alert_tiers": "everything"}, "alert_tiers"),
    ({"alert_operator": "~"}, "alert_operator"),
    ({"alert_threshold": -1}, "alert_threshold"),
    ({"alert_threshold": "many"}, "alert_threshold"),
    ({"alert_threshold": float("nan")}, "alert_threshold"),
    ({"alert_threshold": float("inf")}, "alert_threshold"),
    ({"alert_threshold": True}, "alert_threshold"),
    ({"alert_recipients": ["not-an-email"]}, "is not an email address"),
    ({"alert_destinations": [{"id": "x"}]}, "notification destination"),
    ({"alert_destinations": ["a;b c d e f g"]}, "notification destination"),
    ({"alert_recipients": []}, "at least one recipient"),
    ({"alert_recipients": [f"u{i}@example.com" for i in range(101)]}, "at most 100"),
])
def test_invalid_alert_options_are_rejected(agent_ns, changes, needle):
    errors = _spec(agent_ns, outputs={**VALID["outputs"], **ALERT, **changes})[1]
    assert any(needle in e for e in errors), errors


def test_retry_outputs_validate_and_refresh_only_what_was_asked(agent_ns):
    spec, errors = _spec(agent_ns, retry_outputs=["dashboard", "dashboard", "app"])
    assert errors == [] and spec["retry_outputs"] == ["dashboard", "app"]
    assert any("retry output 'pdf' is not one of" in e for e in _spec(agent_ns, retry_outputs=["pdf"])[1])
    assert any("the Alert cannot be retried: it is not selected" in e for e in _spec(agent_ns, retry_outputs=["alert"])[1])
    previous, current = _spec(agent_ns)[0], _spec(agent_ns, retry_outputs=["dashboard"])[0]
    assets = {"dashboard": "d1", "genie_space": "g1", "app": "churn-desk", "preview_run_id": 5}
    plan = agent_ns["implement_plan"](previous, current, assets, has_built_notebook=True)
    assert plan["classes"] == ["retry"] and plan["refresh"] == ["dashboard"] and plan["build"] == []
    assert plan["refill"] is False and plan["preview"] is False and plan["schedule"] is False and plan["sharing"] is False
    gone = agent_ns["implement_plan"](previous, current, dict(assets, dashboard=None), has_built_notebook=True)
    assert gone["build"] == ["dashboard"] and gone["refresh"] == [] and gone["preview"] is False


def test_alert_query_counts_the_chosen_tiers_in_the_latest_run(agent_ns):
    outputs = _spec(agent_ns, outputs={**VALID["outputs"], **ALERT})[0]["outputs"]
    query = agent_ns["implement_alert_query"](SHELL_SQL, "main.inspire.churn_out", outputs)
    assert (query["column"], query["operator"], query["threshold"]) == ("tier_rows", "GREATER_THAN_OR_EQUAL", 1.0)
    assert "SELECT * FROM `main`.`inspire`.`churn_out` WHERE is_current AND change_source <> 'delete'" in query["query"]
    assert "COUNT_IF(priority_tier IN ('Act now')) AS tier_rows" in query["query"]
    review = agent_ns["implement_alert_query"](SHELL_SQL, "main.inspire.churn_out", dict(outputs, alert_tiers="act_now_review",
                                                                                        alert_operator=">", alert_threshold=5))
    assert "IN ('Act now', 'Review')" in review["query"] and (review["operator"], review["threshold"]) == ("GREATER_THAN", 5.0)
    combined = agent_ns["implement_alert_query"](SHELL_SQL, "main.inspire.churn_out", outputs,
                                                 "SELECT COUNT(*) > 3 AS triggered FROM main.s.orders;  -- spikes")
    assert (combined["column"], combined["operator"], combined["threshold"]) == ("alert_value", "GREATER_THAN_OR_EQUAL", 1.0)
    assert "user_condition AS (\nSELECT COUNT(*) > 3 AS triggered FROM main.s.orders\n)" in combined["query"]
    assert "CASE WHEN t.tier_rows >= 1.0 OR COALESCE(c.triggered, FALSE) THEN 1 ELSE 0 END AS alert_value" in combined["query"]
    assert "LEFT JOIN (SELECT triggered FROM user_condition LIMIT 1) c ON TRUE" in combined["query"]


@pytest.mark.parametrize("sql,needle", [
    ("", "is empty"),
    ("-- only a comment", "is empty"),
    ("SELECT TRUE AS triggered; SELECT 2", "one SELECT statement"),
    ("DELETE FROM main.inspire.churn_out", "must be a SELECT"),
    ("SELECT TRUE AS triggered FROM main.inspire.churn_out; INSERT INTO main.inspire.churn_out VALUES (1)", "writes data"),
    ("WITH x AS (SELECT 1) SELECT * FROM x", "named triggered"),
    ("SELECT COUNT(*) > 0 AS triggered FROM hr.s.salaries", "outside this use case: hr.s.salaries"),
])
def test_alert_condition_sql_is_checked(agent_ns, sql, needle):
    errors = agent_ns["check_alert_condition_sql"](sql, ["main.inspire.churn_out", "main.s.orders"])
    assert any(needle in e for e in errors), errors


def test_a_grounded_alert_condition_passes(agent_ns):
    sql = "-- churn spike\nWITH t AS (SELECT COUNT(*) AS n FROM main.inspire.churn_out) SELECT n > 10 AS triggered FROM t;"
    assert agent_ns["check_alert_condition_sql"](sql, ["main.inspire.churn_out"]) == []


def test_alert_texts_say_why_who_and_what_to_do_first(agent_ns):
    outputs = _spec(agent_ns, outputs={**VALID["outputs"], **ALERT,
                                       "alert_destinations": [{"id": "dest-0001", "name": "Slack"}]})[0]["outputs"]
    use_case = {"Name": "Predict churn", "Statement": "Customers leave", "Solution": "Score every account weekly and call the riskiest first",
                "elite_assessment": {"decision": "Call at-risk customers", "decision_owner": "Retention lead", "kpi": "churn rate"}}
    summary, description = agent_ns["implement_alert_texts"](SHELL_ALERTS, "N01-U01", use_case, outputs, "https://h/d")
    assert summary == "N01-U01 Predict churn: Act now rows in the latest run are at least 1"
    assert description.splitlines() == [
        "What fired: Act now rows in the latest run are at least 1.", "Why this threshold: Act now rows are at least 1, the number set in the wizard.",
        "How often it checks: after each run of the job; the job has no schedule, so only when someone runs it.", "What to do first:",
        "1. Open the decision list (https://h/d) and work the Act now rows by rank, top first; each row's recommended action says what to do "
        "with it.",
        "2. Read each row's top reasons before you act on it.",
        "3. If far more rows fired than usual, open the Run health page of the dashboard first: flagged rows point to a data "
        "problem, not a business one.",
        "4. Retention lead decides: Call at-risk customers.", "5. How the use case acts on it: Score every account weekly and call the riskiest first.",
        "Where to look:", "Dashboard: https://h/d", "When it clears: you get one more email when it returns to OK.",
        "Quiet when not reliable: it never fires on a run Inspire marks not reliable yet, such as one whose model or rule missed its "
        "acceptance check or one that stopped on too little data.",
        "Why it matters: Customers leave.", "KPI it moves: churn rate."]
    assert agent_ns["implement_alert_subscribers"](outputs) == [{"user_name": "owner@example.com"}, {"destination_id": "dest-0001"}]
    assert agent_ns["implement_alert_trigger_text"](dict(outputs, alert_condition_text="refunds double")).endswith(", or refunds double")
    _s, bare = agent_ns["implement_alert_texts"](SHELL_ALERTS, "N01-U01", {"Name": "Predict churn"}, outputs)
    assert "KPI" not in bare and "decides" not in bare and "1. Open the decision list and" in bare, "nothing invented for a use case that says nothing"
    assert "look at the rows whose data_quality_flag is not 'ok' first" in bare and "Genie Agent" not in bare and "Where to look" not in bare


def _alert_inspire(ns, tmp_path, answers=None, check=None, rows=None):
    defaults = {("POST", "/api/2.0/alerts"): {"id": "al-1"}, ("POST", "/api/2.2/jobs/runs/submit"): {"run_id": 900},
                ("GET", "/api/2.2/jobs/runs/get"): {"tasks": [{"task_key": "inspire_alert_check", "run_id": 901}]},
                ("GET", "/api/2.2/jobs/runs/get-output"): {"alert_output": {"alert_state": "OK"}},
                ("GET", "/api/2.0/preview/scim/v2/Users"): {"Resources": [{"userName": "owner@example.com", "active": True}]}}
    inst, calls = _output_inspire(ns, tmp_path, {**defaults, **(answers or {})})
    inst._implement_app_shell = lambda: (None, {"shell_sql": SHELL_SQL, "shell_alerts": SHELL_ALERTS})
    queries = []
    inst._implement_run_query_check = lambda sql, require_rows=False, limit=20: queries.append(sql) or list(rows or [{"tier_rows": 0}])
    inst._implement_digest = lambda context, warehouse, subscribers: ("", "")

    class Launcher(ns["JobLauncher"]):
        def wait_for_run(self, run_id, timeout_s=0, poll_s=0, out=None):
            return dict(check or {"status": "SUCCESS"})

    inst._job_launcher_cls = Launcher
    return inst, calls, queries


def _calls_to(calls, method, path):
    return [(body, query) for m, p, body, query in calls if (m, p) == (method, path)]


def test_the_alert_is_paused_and_runs_as_a_job_task_after_the_notebook(agent_ns, tmp_path):
    inst, calls, queries = _alert_inspire(agent_ns, tmp_path)
    context = _output_context(agent_ns, **ALERT, alert_destinations=[{"id": "dest-0001", "name": "Slack"}])
    context["use_case"]["elite_assessment"] = {"decision": "Call at-risk customers", "decision_owner": "Retention lead"}
    fields = inst._implement_alert(context, None)
    assert fields["alert_id"] == "al-1" and fields["alert_url"] == "https://h/sql/alerts-v2/al-1"
    assert fields["_asset"] == {"condition_text": "", "condition_sql": "", "check_state": "OK",
                                "trigger": "Act now rows in the latest run are at least 1", "subscribers": 2, "threshold_setting": True}
    [(alert, _q)] = _calls_to(calls, "POST", "/api/2.0/alerts")
    assert alert["schedule"]["pause_status"] == "PAUSED" and alert["evaluation"]["notification"]["subscriptions"] == []
    assert alert["evaluation"]["source"]["name"] == "alert_value" and alert["evaluation"]["comparison_operator"] == "GREATER_THAN_OR_EQUAL"
    assert alert["evaluation"]["threshold"] == {"value": {"double_value": 1.0}} and alert["evaluation"]["empty_result_state"] == "OK"
    assert alert["parent_path"] == "/W/acme_implemented/Sales" and alert["warehouse_id"] == "wh1"
    assert alert["display_name"] == "N01-U01 Predict churn" and "Retention lead decides: " in alert["custom_description"]
    assert "Open the decision list (https://h/d)" in alert["custom_description"]
    [(update, _q)] = _calls_to(calls, "POST", "/api/2.2/jobs/update")
    assert update == {"job_id": 77, "new_settings": {"tasks": [{
        "task_key": "inspire_alert", "depends_on": [{"task_key": "inspire_task"}], "run_if": "ALL_SUCCESS", "timeout_seconds": 1800,
        "alert_task": {"alert_id": "al-1", "warehouse_id": "wh1",
                       "subscribers": [{"user_name": "owner@example.com"}, {"destination_id": "dest-0001"}]}}]}}
    [(submit, _q)] = _calls_to(calls, "POST", "/api/2.2/jobs/runs/submit")
    assert submit["tasks"] == [{"task_key": "inspire_alert_check",
                                "alert_task": {"alert_id": "al-1", "warehouse_id": "wh1", "subscribers": []}}]
    assert _calls_to(calls, "GET", "/api/2.2/jobs/runs/get")[0][1] == {"run_id": 900}
    assert _calls_to(calls, "GET", "/api/2.2/jobs/runs/get-output")[0][1] == {"run_id": 901}
    assert len(queries) == 1 and "COUNT_IF(priority_tier IN ('Act now'))" in queries[0]
    assert inst.updates == [{"status_message": "Alert: creating it"}]
    assert inst.emitted[-1]["status"] == "ended_success" and "_asset" not in inst.emitted[-1]["result_json"]


def test_a_triggered_check_is_a_working_alert(agent_ns, tmp_path):
    inst, _c, _q = _alert_inspire(agent_ns, tmp_path,
                                  {("GET", "/api/2.2/jobs/runs/get-output"): {"alert_output": {"alert_state": "TRIGGERED"}}})
    assert inst._implement_alert(_output_context(agent_ns, **ALERT), None)["_asset"]["check_state"] == "TRIGGERED"


@pytest.mark.parametrize("check,state,needle", [
    ({"status": "SUCCESS"}, "ERROR", "ended SUCCESS with alert state ERROR"),
    ({"status": "FAILED", "error": "warehouse stopped"}, "UNKNOWN", "ended FAILED with alert state UNKNOWN: warehouse stopped"),
    ({"status": "RUNNING"}, "OK", "did not finish within 900s"),
])
def test_a_failed_alert_check_blocks_the_alert(agent_ns, tmp_path, check, state, needle):
    inst, _c, _q = _alert_inspire(agent_ns, tmp_path,
                                  {("GET", "/api/2.2/jobs/runs/get-output"): {"alert_output": {"alert_state": state}}}, check=check)
    with pytest.raises(agent_ns["ImplementBlocked"], match=needle):
        inst._implement_alert(_output_context(agent_ns, **ALERT), None)
    assert inst.emitted[-1]["status"] == "ended_error"


def test_an_unreadable_check_output_is_logged_and_a_successful_check_still_passes(agent_ns, tmp_path):
    inst, _c, _q = _alert_inspire(agent_ns, tmp_path, {("GET", "/api/2.2/jobs/runs/get-output"): RuntimeError("no output")})
    assert inst._implement_alert(_output_context(agent_ns, **ALERT), None)["_asset"]["check_state"] == "UNKNOWN"
    assert inst.logger.matching("the alert check output of run 900 is unreadable (no output)")


@pytest.mark.parametrize("answers,needle", [
    ({("POST", "/api/2.0/alerts"): RuntimeError("PERMISSION_DENIED: alerts")}, "could not be saved: PERMISSION_DENIED"),
    ({("POST", "/api/2.2/jobs/update"): RuntimeError("Job 77 is not editable")}, "could not be saved: Job 77 is not editable"),
    ({("POST", "/api/2.2/jobs/runs/submit"): RuntimeError("alert_task is unknown")}, "could not start: alert_task is unknown"),
])
def test_alert_save_and_check_failures_are_not_sent_to_genie(agent_ns, tmp_path, answers, needle):
    inst, _c, _q = _alert_inspire(agent_ns, tmp_path, answers)
    with pytest.raises(agent_ns["ImplementBlocked"], match=needle):
        inst._implement_alert(_output_context(agent_ns, **ALERT), None)


def test_an_alert_needs_the_use_case_job_and_a_readable_result_table(agent_ns, tmp_path):
    inst, calls, _q = _alert_inspire(agent_ns, tmp_path)
    with pytest.raises(agent_ns["ImplementBlocked"], match="has no job yet"):
        inst._implement_alert(dict(_output_context(agent_ns, **ALERT), job_id=None), None)
    assert calls == []
    inst._implement_run_query_check = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("TABLE_OR_VIEW_NOT_FOUND"))
    with pytest.raises(agent_ns["ImplementBlocked"], match="the alert query failed on the business output table: TABLE_OR_VIEW"):
        inst._implement_alert(_output_context(agent_ns, **ALERT), None)
    assert calls == []


def test_a_plain_words_condition_goes_through_genie_and_is_checked(agent_ns, tmp_path):
    inst, calls, queries = _alert_inspire(agent_ns, tmp_path, rows=[{"triggered": True}])
    bad = "SELECT COUNT(*) > 0 AS triggered FROM hr.s.salaries"
    good = "SELECT COUNT(*) > 10 AS triggered FROM main.s.orders WHERE status = 'refund'"
    runner = _FileRunner([{"exit": 0}, {"exit": 0}], [{"alert_condition.sql": bad}, {"alert_condition.sql": good}])
    context = _output_context(agent_ns, **ALERT, alert_condition_text="refunds above 10 today")
    fields = inst._implement_alert(context, runner)
    assert "refunds above 10 today" in runner.prompts[0] and "BOOLEAN column named triggered" in runner.prompts[0]
    assert "outside this use case: hr.s.salaries" in runner.prompts[1]
    assert fields["_asset"]["condition_sql"] == good and fields["_asset"]["condition_text"] == "refunds above 10 today"
    [(alert, _q)] = _calls_to(calls, "POST", "/api/2.0/alerts")
    assert alert["evaluation"]["source"]["name"] == "alert_value" and f"user_condition AS (\n{good}\n)" in alert["query_text"]
    assert queries[0] == good
    other, _c, _q = _alert_inspire(agent_ns, tmp_path, rows=[{"triggered": 1}])
    with pytest.raises(RuntimeError, match="after 3 Genie rounds: alert_condition.sql must return exactly one row with a BOOLEAN"):
        other._implement_alert(context, _FileRunner([{"exit": 0}] * 3, [{"alert_condition.sql": good}] * 3))
    two, _c, _q = _alert_inspire(agent_ns, tmp_path, rows=[{"triggered": True}, {"triggered": False}])
    with pytest.raises(RuntimeError, match="it returned 2 row"):
        two._implement_alert(context, _FileRunner([{"exit": 0}] * 3, [{"alert_condition.sql": good}] * 3))


def test_an_unchanged_condition_reuses_its_sql_and_patches_the_alert(agent_ns, tmp_path):
    inst, calls, _q = _alert_inspire(agent_ns, tmp_path, {("PATCH", "/api/2.0/alerts/al-1"): {"id": "al-1", "lifecycle_state": "ACTIVE"}},
                                     rows=[{"triggered": False}])
    good = "SELECT FALSE AS triggered"
    context = dict(_output_context(agent_ns, **ALERT, alert_condition_text="refunds above 10 today", alert_threshold=3),
                   assets={"alert": "al-1"}, asset_status={"alert": {"condition_text": "refunds above 10 today", "condition_sql": good}})
    fields = inst._implement_alert(context, _FakeRunner([]))
    [(body, query)] = _calls_to(calls, "PATCH", "/api/2.0/alerts/al-1")
    assert query == {"update_mask": "display_name,query_text,warehouse_id,custom_summary,custom_description,evaluation,schedule"}
    assert "parent_path" not in body and "t.tier_rows >= (COALESCE(CASE WHEN" in body["query_text"] and "END, 3.0))" in body["query_text"]
    assert _calls_to(calls, "POST", "/api/2.0/alerts") == []
    assert fields["alert_id"] == "al-1" and fields["_asset"]["condition_sql"] == good


@pytest.mark.parametrize("answer", [{"id": "al-1", "lifecycle_state": "TRASHED"}, RuntimeError("RESOURCE_DOES_NOT_EXIST: alert al-1")])
def test_a_trashed_or_deleted_alert_is_created_again(agent_ns, tmp_path, answer):
    inst, calls, _q = _alert_inspire(agent_ns, tmp_path, {("PATCH", "/api/2.0/alerts/al-1"): answer,
                                                         ("POST", "/api/2.0/alerts"): {"id": "al-2"}})
    fields = inst._implement_alert(dict(_output_context(agent_ns, **ALERT), assets={"alert": "al-1"}), None)
    assert fields["alert_id"] == "al-2" and len(_calls_to(calls, "POST", "/api/2.0/alerts")) == 1
    assert inst.logger.matching("alert al-1 is gone or trashed; creating a new one")
    other, _c, _q = _alert_inspire(agent_ns, tmp_path, {("PATCH", "/api/2.0/alerts/al-1"): RuntimeError("PERMISSION_DENIED")})
    with pytest.raises(agent_ns["ImplementBlocked"], match="can open the alert al-1 of this use case but cannot change it"):
        other._implement_alert(dict(_output_context(agent_ns, **ALERT), assets={"alert": "al-1"}), None)


def test_deleting_an_alert_removes_its_job_task_and_tolerates_what_is_gone(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    calls = []
    answers = {("GET", "/api/2.2/jobs/get"): {"settings": {"tasks": [{"task_key": "inspire_task"}, {"task_key": "inspire_alert"}]}},
               ("DELETE", "/api/2.0/alerts/al-1"): RuntimeError("RESOURCE_DOES_NOT_EXIST")}

    def api(method, path, body=None, query=None):
        calls.append((method, path, body, query))
        answer = answers.get((method, path), {})
        if isinstance(answer, Exception):
            raise answer
        return answer

    inst._implement_api = api
    inst.updates = []
    inst._implement_update = lambda key, **f: inst.updates.append(f)
    inst._implement_delete_output("alert", "al-1", (5150, "N01-U01", 3), job_id=77)
    assert calls == [("GET", "/api/2.2/jobs/get", None, {"job_id": 77}),
                     ("POST", "/api/2.2/jobs/update", {"job_id": 77, "fields_to_remove": ["tasks/inspire_alert"]}, None),
                     ("DELETE", "/api/2.0/alerts/al-1", None, None)]
    assert inst.updates == [{"alert_id": None, "alert_url": None}]
    assert inst.logger.matching("[IMPLEMENT-DELETE] Alert al-1 was already gone")
    answers[("GET", "/api/2.2/jobs/get")] = {"settings": {"tasks": [{"task_key": "inspire_task"}]}}
    calls.clear()
    inst._implement_delete_output("alert", "al-1", (5150, "N01-U01", 3), job_id=77)
    assert [c[:2] for c in calls] == [("GET", "/api/2.2/jobs/get"), ("DELETE", "/api/2.0/alerts/al-1")]
    answers[("GET", "/api/2.2/jobs/get")] = RuntimeError("Job 77 does not exist.")
    calls.clear()
    inst._implement_delete_output("alert", "al-1", (5150, "N01-U01", 3), job_id=77)
    assert [c[:2] for c in calls] == [("GET", "/api/2.2/jobs/get"), ("DELETE", "/api/2.0/alerts/al-1")]
    answers[("DELETE", "/api/2.0/alerts/al-1")] = RuntimeError("PERMISSION_DENIED")
    with pytest.raises(RuntimeError, match="PERMISSION_DENIED"):
        inst._implement_delete_output("alert", "al-1", (5150, "N01-U01", 3))


def test_not_found_errors_are_recognised_and_others_are_not(agent_ns):
    found = agent_ns["implement_is_not_found"]
    assert found(type("NotFound", (Exception,), {})("x")) and found(type("ResourceDoesNotExist", (Exception,), {})("x"))
    assert found(RuntimeError("RESOURCE_DOES_NOT_EXIST: app")) and found(RuntimeError("App churn-desk does not exist or is deleted."))
    coded = RuntimeError("boom")
    coded.error_code = "NOT_FOUND"
    assert found(coded)
    assert not found(RuntimeError("PERMISSION_DENIED")) and not found(RuntimeError("QUOTA_EXCEEDED: 50 apps"))


def test_sharing_gives_run_on_the_alert(agent_ns):
    inst = _inspire(agent_ns, _access_spark())
    calls = []
    inst._implement_api = lambda method, path, body=None, query=None: calls.append((method, path, body)) or {}
    spec = _spec(agent_ns, outputs={**VALID["outputs"], **ALERT})[0]
    assert inst._implement_share("N01-U01", "main.inspire.churn_out", spec, {"alert": "al-1", "dashboard": "d1"}, None) == []
    acl = {"access_control_list": [{"group_name": "planners", "permission_level": "CAN_RUN"}]}
    use = {"access_control_list": [{"group_name": "planners", "permission_level": "CAN_USE"}]}
    assert _patches(calls) == [("PATCH", "/api/2.0/permissions/dashboards/d1", acl), ("PATCH", "/api/2.0/permissions/alertsv2/al-1", acl),
                               ("PATCH", "/api/2.0/permissions/sql/warehouses/wh1", use)]


def _patches(calls):
    return [c for c in calls if c[0] == "PATCH"]


def test_sharing_gives_view_on_the_job_so_its_run_links_open(agent_ns):
    inst = _inspire(agent_ns, _access_spark())
    calls = []
    inst._implement_api = lambda method, path, body=None, query=None: calls.append((method, path, body)) or {}
    spec = _spec(agent_ns)[0]
    assert inst._implement_share("N01-U01", "main.inspire.churn_out", spec, {"dashboard": "d1"}, 77) == []
    view = {"access_control_list": [{"group_name": "planners", "permission_level": "CAN_VIEW"}]}
    assert ("PATCH", "/api/2.0/permissions/jobs/77", view) in calls
    assert ("PATCH", "/api/2.0/permissions/dashboards/d1",
            {"access_control_list": [{"group_name": "planners", "permission_level": "CAN_RUN"}]}) in calls and len(_patches(calls)) == 3
    calls.clear()
    assert inst._implement_share("N01-U01", "main.inspire.churn_out", spec, {"dashboard": "d1"}, None) == []
    assert [path for _, path, _ in _patches(calls)] == ["/api/2.0/permissions/dashboards/d1", "/api/2.0/permissions/sql/warehouses/wh1"]

    def deny_job(method, path, body=None, query=None):
        if "/jobs/" in path:
            raise RuntimeError("PERMISSION_DENIED: not the job owner")
        calls.append((method, path, body))
        return {}

    calls.clear()
    inst._implement_api = deny_job
    warnings = inst._implement_share("N01-U01", "main.inspire.churn_out", spec, {"dashboard": "d1"}, 77)
    assert warnings == ["Sharing the job: PERMISSION_DENIED: not the job owner"]
    assert [path for _, path, _ in _patches(calls)] == ["/api/2.0/permissions/dashboards/d1", "/api/2.0/permissions/sql/warehouses/wh1"]
    assert inst._implement_share("N01-U01", "main.inspire.churn_out", dict(spec, sharing={"principals": []}), {"dashboard": "d1"}, 77) == []


def test_sharing_gives_use_on_this_use_cases_app_only(agent_ns):
    spec = _spec(agent_ns, outputs={**VALID["outputs"], "app": True, "app_name": "churn-desk"})[0]
    for description, shared in (("Inspire use case N01-U01 (session 5150): Predict churn", True), ("Finance team tool", False)):
        inst = _inspire(agent_ns, _access_spark())
        calls = []

        def api(method, path, body=None, query=None):
            calls.append((method, path, body))
            return {"description": description} if method == "GET" else {}

        inst._implement_api = api
        warnings = inst._implement_share("N01-U01", "main.inspire.churn_out", spec, {"app": "churn-desk"}, None)
        patched = [path for method, path, _ in calls if method == "PATCH"]
        if shared:
            assert warnings == [] and patched == ["/api/2.0/permissions/apps/churn-desk"]
            assert calls[-1][2] == {"access_control_list": [{"group_name": "planners", "permission_level": "CAN_USE"}]}
        else:
            assert warnings == ["Sharing App: churn-desk is no longer this use case's App, so Inspire did not share it"]
            assert patched == [], "an App that is no longer this use case's gets no permission change"


def _acl(*entries):
    return {"access_control_list": [dict({kind: who}, all_permissions=[{"permission_level": level, "inherited": False}])
                                    for kind, who, level in entries]}


def test_principals_below_keeps_only_those_who_lack_the_level(agent_ns):
    below = agent_ns["implement_principals_below"]
    people = [{"type": "user", "name": "Amr@X"}, {"type": "group", "name": "planners"}, {"type": "service_principal", "name": "sp-1"}]
    current = _acl(("user_name", "amr@x", "CAN_MANAGE"), ("group_name", "planners", "CAN_VIEW"), ("group_name", "admins", "CAN_MANAGE"))
    assert below(current, people, "CAN_USE") == people[1:], "a CAN_MANAGE holder is never asked to take CAN_USE, which would lower them"
    assert below(current, people, "CAN_VIEW") == [people[2]]
    assert below(_acl(("group_name", "users", "CAN_MANAGE")), people, "CAN_RUN") == [], "everyone in the workspace already holds it"
    assert below(_acl(("group_name", "users", "CAN_VIEW")), people, "CAN_RUN") == people
    assert below(_acl(("service_principal_name", "sp-1", "IS_OWNER")), people, "CAN_VIEW") == people[:2]
    assert below(_acl(("user_name", "amr@x", "SOMETHING_NEW")), people, "CAN_USE") == people
    for broken in (None, [], "x", {"access_control_list": None}, {"access_control_list": ["x", {"user_name": "amr@x"}]}):
        assert below(broken, people, "CAN_USE") == people, broken
    assert below(current, [], "CAN_USE") == [] and below(current, None, "CAN_USE") == []


def test_sharing_never_lowers_anyone_and_skips_what_they_already_hold(agent_ns):
    inst = _inspire(agent_ns, _access_spark())
    calls = []
    held = {"/api/2.0/permissions/dashboards/d1": _acl(("group_name", "users", "CAN_MANAGE")),
            "/api/2.0/permissions/sql/warehouses/wh1": _acl(("group_name", "planners", "CAN_MANAGE")),
            "/api/2.0/permissions/genie/g1": _acl(("group_name", "planners", "CAN_VIEW"))}
    inst._implement_api = lambda method, path, body=None, query=None: calls.append((method, path, body)) or held.get(path, {})
    spec = _spec(agent_ns)[0]
    assert inst._implement_share("N01-U01", "main.inspire.churn_out", spec, {"dashboard": "d1", "genie_space": "g1"}, None) == []
    assert _patches(calls) == [("PATCH", "/api/2.0/permissions/genie/g1",
                                {"access_control_list": [{"group_name": "planners", "permission_level": "CAN_RUN"}]})]
    assert [c[:2] for c in calls if c[0] == "GET"] == [("GET", path) for path in ("/api/2.0/permissions/dashboards/d1",
                                                                                   "/api/2.0/permissions/genie/g1",
                                                                                   "/api/2.0/permissions/sql/warehouses/wh1")]


def test_sharing_gives_use_on_the_warehouse_only_for_a_dashboard_or_genie_space(agent_ns):
    spec = _spec(agent_ns, outputs={**VALID["outputs"], **ALERT})[0]
    for assets, expected in (({"alert": "al-1"}, False), ({"app": "churn-desk"}, False), ({"genie_space": "g1"}, True),
                             ({"dashboard": "d1"}, True)):
        inst = _inspire(agent_ns, _access_spark())
        calls = []
        inst._implement_api = lambda method, path, body=None, query=None: (calls.append((method, path, body))
                                                                            or {"description": "Inspire use case N01-U01 (session 5150): x"})
        inst._implement_share("N01-U01", "main.inspire.churn_out", spec, assets, None)
        assert ("/api/2.0/permissions/sql/warehouses/wh1" in [p for _, p, _ in _patches(calls)]) is expected, assets
    inst = _inspire(agent_ns, _access_spark())
    calls = []
    inst._implement_api = lambda method, path, body=None, query=None: calls.append((method, path, body)) or {}
    inst._implement_share("N01-U01", "main.inspire.churn_out", dict(spec, config=dict(spec["config"], warehouse_id="")), {"dashboard": "d1"}, None)
    assert [p for _, p, _ in _patches(calls)] == ["/api/2.0/permissions/dashboards/d1"]


def test_sharing_names_the_warehouse_when_it_cannot_be_shared(agent_ns):
    inst = _inspire(agent_ns, _access_spark())
    calls = []

    def api(method, path, body=None, query=None):
        if "/sql/warehouses/" in path:
            raise RuntimeError("PERMISSION_DENIED: no CAN_MANAGE on the warehouse")
        calls.append((method, path, body))
        return {}

    inst._implement_api = api
    warnings = inst._implement_share("N01-U01", "main.inspire.churn_out", _spec(agent_ns)[0], {"dashboard": "d1"}, None)
    assert warnings == ["Sharing the SQL warehouse wh1: PERMISSION_DENIED: no CAN_MANAGE on the warehouse. The people you share with "
                        "need CAN USE on it to open the dashboard"]
    assert [p for _, p, _ in _patches(calls)] == ["/api/2.0/permissions/dashboards/d1"]
    both = inst._implement_share("N01-U01", "main.inspire.churn_out", _spec(agent_ns)[0], {"dashboard": "d1", "genie_space": "g1"}, None)
    assert both[0].endswith("need CAN USE on it to open the dashboard and the Genie Agent")


INSPIRE_OWNS = [_row("catalog", "OWNER", "inspire-sp", True), _row("table", "OWNER", "inspire-sp", True)]


SHARED_EXISTS = "SELECT lower(table_name) AS t FROM system.information_schema.tables"
SHARED_READS = "SELECT lower(table_name) AS t, grantee AS p FROM system.information_schema.table_privileges"
SHARED_PRESENT = [{"t": t} for t in ("churn_out_summary", "churn_out_reasons", "churn_out_assumptions", "churn_out_run_log")]


def _access_spark(rows=INSPIRE_OWNS, fail=None, present=()):
    def respond(statement):
        if statement.startswith("SELECT level, privilege, principal"):
            if fail:
                raise fail
            return rows
        if statement.startswith(SHARED_EXISTS):
            return present
        return None
    return FakeSpark(responder=respond)


def _not_access_reads(statements):
    return [s for s in statements if not s.startswith(("SELECT level, privilege, principal", SHARED_EXISTS, SHARED_READS))]


def test_sharing_grants_only_missing_access_and_names_what_inspire_cannot_grant(agent_ns):
    inst = _inspire(agent_ns, _access_spark(LIVE_ACCESS))
    inst._implement_api = lambda method, path, body=None, query=None: {}
    emitted = []
    inst._implement_emit = lambda *a, **k: emitted.append(a)
    spec = dict(_spec(agent_ns)[0], sharing={"principals": [{"type": "user", "name": "amr@x"}, {"type": "group", "name": "planners"},
                                                            {"type": "user", "name": ""}]})
    warnings = inst._implement_share("N01-U01", ACCESS_TABLE, spec, {}, None)
    assert _not_access_reads(inst.spark.statements) == [GRANT_SELECT.format("amr@x"), GRANT_SELECT.format("planners")]
    assert warnings == ["Sharing: " + agent_ns["implement_access_gap_message"]("planners", [GAP_CATALOG, GAP_SCHEMA])]
    assert emitted[-1][1:3] == ("Sharing", warnings[0]) and emitted[-1][3] == "ended_warning"


def test_sharing_with_an_owner_who_already_has_access_ends_without_warnings(agent_ns):
    inst = _inspire(agent_ns, _access_spark(LIVE_ACCESS))
    inst._implement_api = lambda method, path, body=None, query=None: {}
    inst._implement_emit = lambda *a, **k: None
    spec = dict(_spec(agent_ns)[0], sharing={"principals": [{"type": "user", "name": "amr@x"}]})
    assert inst._implement_share("N01-U01", ACCESS_TABLE, spec, {}, None) == []
    assert _not_access_reads(inst.spark.statements) == [GRANT_SELECT.format("amr@x")]


def test_sharing_when_access_cannot_be_read_grants_blind_and_says_so(agent_ns):
    inst = _inspire(agent_ns, _access_spark(fail=RuntimeError("PERMISSION_DENIED: system catalog")))
    inst._implement_api = lambda method, path, body=None, query=None: {}
    inst._implement_emit = lambda *a, **k: None
    spec = dict(_spec(agent_ns)[0], sharing={"principals": [{"type": "group", "name": "planners"}]})
    warnings = inst._implement_share("N01-U01", ACCESS_TABLE, spec, {}, None)
    assert warnings == ["Sharing: Inspire could not read who can access main.inspire.churn_out, so it grants without checking: "
                        "PERMISSION_DENIED: system catalog"]
    assert _not_access_reads(inst.spark.statements) == [GRANT_CATALOG.format("planners"), GRANT_SCHEMA.format("planners"),
                                                         GRANT_SELECT.format("planners")]


PIP_CONFLICT = (
    "ERROR: Cannot install -r app/requirements.txt (line 2) and pandas==2.3.3 because these package versions have conflicting "
    "dependencies.\n\nThe conflict is caused by:\n    The user requested pandas==2.3.3\n    databricks-sql-connector 4.1.4 depends on "
    "pandas<2.3.0 and >=1.2.5\n\nTo fix this you could try to:\n1. loosen the range of package versions you've specified\n\n"
    "ERROR: ResolutionImpossible: for help visit https://pip.pypa.io/en/latest/topics/dependency-resolution/\n")


OURS_APP = "Inspire use case N01-U01 (session 5150): Predict churn"


def _deploy_inspire(ns, answers, access=None):
    inst = _inspire(ns, _access_spark(INSPIRE_OWNS if access is None else access))
    imported, calls = [], []
    inst.formats, inst.genie_grants, inst.uploads = [], [], {}

    def export(path, format=None):
        if path not in inst.uploads:
            raise RuntimeError(f"RESOURCE_DOES_NOT_EXIST: Path ({path}) doesn't exist.")
        return types.SimpleNamespace(content=base64.b64encode(inst.uploads[path][0].encode("utf-8")).decode())

    inst.w_client = types.SimpleNamespace(workspace=types.SimpleNamespace(mkdirs=lambda p: None, export=export),
                                          config=types.SimpleNamespace(host="https://h"),
                                          service_principals=types.SimpleNamespace(list=lambda filter=None: []))
    inst._implement_grant = lambda kind, object_id, principals, level: inst.genie_grants.append((kind, object_id, principals, level))
    inst._implement_notebook_paths = lambda uc, key: ("/W/acme_implemented/Sales", "/W/acme_implemented/Sales/N01-U01")
    inst._implement_app_health = lambda app_name, deployment_id, url, path, deadline, poll_s: f"passed {app_name} {deployment_id} {url}{path}"
    queue = list(answers)

    def api(method, path, body=None, query=None):
        if (method, path) == ("POST", "/api/2.0/workspace/import"):
            imported.append(body["path"])
            inst.formats.append(body["format"])
            inst.uploads[body["path"]] = (base64.b64decode(body["content"]).decode("utf-8"), body["overwrite"])
            return {}
        calls.append((method, path, body))
        answer = queue.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer

    inst._implement_api = api
    inst.tagged = []
    inst._implement_tag_app = lambda context, app_name: inst.tagged.append(app_name)
    context = {"uc_id": "N01-U01", "key": (5150, "N01-U01", 1), "use_case": {"Name": "Predict churn"}, "spec": _spec(ns)[0],
               "result_table": "main.inspire.churn_out"}
    return inst, context, calls, imported


SHELL_FILES = {"app.py": "from shell_core import Shell\n", "app.yaml": "command: ['uvicorn', 'app:app']\n",
               "static/index.html": "<html></html>\n", "inspire_app.json": "{}\n",
               "pages/n01_u01.json": json.dumps({"id": "n01_u01", "result_table": "main.inspire.churn_out", "records": {"key": "entity_id"}})}
READS = ["main.inspire.churn_out", "main.s.orders"]
GRANT_ORDERS = "GRANT SELECT ON TABLE `main`.`s`.`orders` TO `{}`"


def test_app_deploy_imports_the_shell_as_files_and_grants_every_table_the_page_and_genie_read(agent_ns, sdk_stub):
    inst, context, calls, imported = _deploy_inspire(agent_ns, [
        RuntimeError("RESOURCE_DOES_NOT_EXIST: app churn-desk"),
        {"compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-1"},
        {"deployment_id": "dep1", "status": {"state": "SUCCEEDED"}}, {"url": "https://churn-desk.example/"}])
    context["spec"]["outputs"]["app_options"]["decisions"] = False
    fields = inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, "g1", poll_s=0)
    assert {k: v for k, v in fields.items() if k != "_grants"} == {
        "app_name": "churn-desk", "app_url": "https://churn-desk.example",
        "app_health": "passed churn-desk dep1 https://churn-desk.example/health", "_asset": {"backend": "delta"}}
    assert fields["_grants"]["name"] == "sp-1", "the grants the deploy ran for the App's service principal are handed back"
    assert [c[:2] for c in calls] == [("GET", "/api/2.0/apps/churn-desk"), ("POST", "/api/2.0/apps"),
                                      ("POST", "/api/2.0/apps/churn-desk/deployments"), ("GET", "/api/2.0/apps/churn-desk")]
    assert calls[1][2]["resources"] == [{"name": "sql-warehouse", "sql_warehouse": {"id": "wh1", "permission": "CAN_USE"}}]
    assert calls[1][2]["description"].startswith("Inspire use case N01-U01 (session 5150): Predict churn")
    assert calls[2][2] == {"source_code_path": "/W/acme_implemented/Sales/apps/churn-desk", "mode": "SNAPSHOT"}
    assert inst.spark.statements[0].startswith("SELECT level, privilege, principal")
    statements = _not_access_reads(inst.spark.statements)
    assert not any("CREATE TABLE" in s or "MODIFY" in s for s in statements), "the App only reads; Inspire creates no table for it"
    assert GRANT_SELECT.format("sp-1") in statements and GRANT_ORDERS.format("sp-1") in statements
    assert inst.genie_grants == [("genie", "g1", [{"type": "service_principal", "name": "sp-1"}], "CAN_RUN")]
    assert sorted(imported) == [f"/W/acme_implemented/Sales/apps/churn-desk/{name}" for name in sorted(SHELL_FILES)]
    assert set(inst.formats) == {"RAW"}, "every App file is imported as a file, never converted into a notebook"
    assert inst.uploads == {f"/W/acme_implemented/Sales/apps/churn-desk/{name}": (text, True) for name, text in SHELL_FILES.items()}
    assert inst.tagged == ["churn-desk"], "a new App is tagged as soon as it exists, before its compute is waited on"


SERVERLESS_SDK_IMPORT_FORMATS = {"AUTO", "DBC", "HTML", "JUPYTER", "R_MARKDOWN", "SOURCE"}


def test_every_import_format_the_agent_names_exists_in_the_sdk_serverless_ships():
    named = set(re.findall(r"ImportFormat\.([A-Za-z_]+)", agent_source()))
    assert named, "the agent imports workspace files, so it names at least one ImportFormat"
    assert named <= SERVERLESS_SDK_IMPORT_FORMATS, (
        f"ImportFormat.{sorted(named - SERVERLESS_SDK_IMPORT_FORMATS)} does not exist in the Databricks SDK that serverless "
        "preinstalls, so the line raises AttributeError there; use the REST API with the format as a string")


def test_an_app_without_a_genie_agent_gets_no_genie_grant_and_a_failed_grant_is_a_warning(agent_ns, sdk_stub):
    answers = [{"description": OURS_APP, "compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-2"},
               {"deployment_id": "dep1", "status": {"state": "SUCCEEDED"}}, {"url": "https://churn-desk.example/"}]
    inst, context, _calls, _imported = _deploy_inspire(agent_ns, list(answers))
    assert "_warnings" not in inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert inst.genie_grants == []
    inst, context, _calls, _imported = _deploy_inspire(agent_ns, list(answers))
    inst._implement_grant = lambda *a: (_ for _ in ()).throw(RuntimeError("PERMISSION_DENIED: not a manager"))
    fields = inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, "g1", poll_s=0)
    assert fields["_warnings"] == ["App: Ask Genie may fail because the App's service principal could not get CAN RUN on the Genie "
                                   "Agent g1: PERMISSION_DENIED: not a manager. Give it CAN RUN on the Genie Agent, or build the App again with Vibe/Add/Remove Features on the Build page"]
    assert fields["app_url"] == "https://churn-desk.example"


@pytest.mark.parametrize("answers,needle", [
    ([RuntimeError("PERMISSION_DENIED: no Apps access")], "the App churn-desk could not be read: PERMISSION_DENIED"),
    ([RuntimeError("RESOURCE_DOES_NOT_EXIST"), RuntimeError("QUOTA_EXCEEDED: 50 apps")], "could not be created: QUOTA_EXCEEDED"),
    ([{"description": OURS_APP, "compute_status": {"state": "ERROR", "message": "boom"}}, {},
      {"description": OURS_APP, "compute_status": {"state": "ERROR", "message": "boom"}}],
     "the App compute failed to start: boom"),
    ([{"description": "Finance team tool", "compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-9"}],
     "the App churn-desk exists but is not this use case's App, so Inspire neither deploys to it nor grants it access to "
     "main.inspire.churn_out; pick another App name"),
])
def test_app_read_create_and_compute_failures_are_not_sent_to_genie(agent_ns, sdk_stub, answers, needle):
    inst, context, _calls, _imported = _deploy_inspire(agent_ns, answers)
    with pytest.raises(agent_ns["ImplementBlocked"], match=needle):
        inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert _not_access_reads(inst.spark.statements) == [], "nothing is granted for an App that never started"


def test_an_app_that_is_not_this_use_cases_gets_no_code_and_no_grant(agent_ns, sdk_stub):
    inst, context, calls, imported = _deploy_inspire(agent_ns, [
        {"description": "Inspire use case N01-U02 (session 5150): Another use case", "service_principal_client_id": "sp-9"}])
    with pytest.raises(agent_ns["ImplementBlocked"], match="is not this use case's App"):
        inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert calls == [("GET", "/api/2.0/apps/churn-desk", None)] and imported == []
    assert _not_access_reads(inst.spark.statements) == []
    assert inst.tagged == [], "another use case's App never gets this use case's tags"


def test_a_new_app_that_could_not_read_its_table_is_refused_before_anything_is_created(agent_ns, sdk_stub):
    inst, context, calls, imported = _deploy_inspire(agent_ns, [RuntimeError("RESOURCE_DOES_NOT_EXIST: app churn-desk")], LIVE_ACCESS)
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert str(raised.value) == agent_ns["implement_app_access_message"](ACCESS_TABLE, [GAP_CATALOG, GAP_SCHEMA], "inspire-sp")
    assert calls == [("GET", "/api/2.0/apps/churn-desk", None)] and imported == []
    assert _not_access_reads(inst.spark.statements) == []


def test_an_existing_app_whose_service_principal_cannot_read_its_tables_is_deployed_and_names_every_grant(agent_ns, sdk_stub):
    inst, context, calls, imported = _deploy_inspire(agent_ns, [
        {"description": OURS_APP, "compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-2"},
        {"deployment_id": "dep1", "status": {"state": "SUCCEEDED"}}, {"url": "https://churn-desk.example/"}], LIVE_ACCESS)
    fields = inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert fields["app_url"] == "https://churn-desk.example", "a read Inspire cannot grant never stops the build"
    result = [GRANT_CATALOG.format("sp-2"), GRANT_SCHEMA.format("sp-2")]
    orders = [GRANT_CATALOG.format("sp-2"), "GRANT USE SCHEMA ON SCHEMA `main`.`s` TO `sp-2`"]
    assert fields["_warnings"] == [
        "App: its service principal sp-2 cannot read main.inspire.churn_out and main.s.orders, so the tiles that query them show no data "
        "and name the grants they need, and Inspire could not grant them itself: for main.inspire.churn_out, ask amr@x to "
        f"run: {'; '.join(result)}; for main.s.orders, ask amr@x to run: {'; '.join(orders)}"]
    settings = json.loads(inst.uploads["/W/acme_implemented/Sales/apps/churn-desk/inspire_app.json"][0])
    assert settings["unread"] == {ACCESS_TABLE: result, "main.s.orders": orders}, "the App's tiles name the exact grants"
    assert ("POST", "/api/2.0/apps/churn-desk/deployments") in [c[:2] for c in calls]
    assert inst.tagged == ["churn-desk"]


def test_a_read_grant_the_platform_refuses_is_a_warning_with_the_exact_grant_and_the_app_still_ships(agent_ns, sdk_stub):
    inst, context, calls, imported = _deploy_inspire(agent_ns, [
        RuntimeError("RESOURCE_DOES_NOT_EXIST: app churn-desk"),
        {"compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-1"},
        {"deployment_id": "dep1", "status": {"state": "SUCCEEDED"}}, {"url": "https://churn-desk.example/"}])
    context["spec"]["outputs"]["app_options"]["decisions"] = False

    def respond(statement):
        if statement.startswith("SELECT level, privilege, principal"):
            return INSPIRE_OWNS
        if statement == GRANT_ORDERS.format("sp-1"):
            raise RuntimeError("PERMISSION_DENIED: User does not have MANAGE on Table 'main.s.orders'")
        return None

    inst.spark = FakeSpark(responder=respond)
    fields = inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert fields["app_url"] == "https://churn-desk.example"
    [warning] = fields["_warnings"]
    assert warning.startswith("App: its service principal sp-1 cannot read main.s.orders, so the tiles that query it show no data")
    assert (f"for main.s.orders ({GRANT_ORDERS.format('sp-1')} failed: PERMISSION_DENIED: User does not have MANAGE on Table "
            f"'main.s.orders'), ask inspire-sp to run: {GRANT_ORDERS.format('sp-1')}") in warning
    assert "main.inspire.churn_out" not in warning, "a table whose grant ran is not named (must-exclude)"
    settings = json.loads(inst.uploads["/W/acme_implemented/Sales/apps/churn-desk/inspire_app.json"][0])
    assert settings == {"unread": {"main.s.orders": [GRANT_ORDERS.format("sp-1")]}}
    assert GRANT_SELECT.format("sp-1") in inst.spark.statements


def test_an_existing_app_whose_service_principal_reads_through_a_group_is_redeployed(agent_ns, sdk_stub):
    inst, context, calls, imported = _deploy_inspire(agent_ns, [
        {"description": OURS_APP, "compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-2"},
        {"deployment_id": "dep1", "status": {"state": "SUCCEEDED"}}, {"url": "https://churn-desk.example/"}],
        LIVE_ACCESS + [_row("catalog", "USE_CATALOG", "app-readers"), _row("schema", "USE_SCHEMA", "app-readers")])
    group = types.SimpleNamespace(groups=[types.SimpleNamespace(display="app-readers")])
    inst.w_client.service_principals = types.SimpleNamespace(list=lambda filter: [group] if filter == 'applicationId eq "sp-2"' else [])
    fields = inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert fields["app_url"] == "https://churn-desk.example"
    assert [c[:2] for c in calls] == [("GET", "/api/2.0/apps/churn-desk"), ("POST", "/api/2.0/apps/churn-desk/deployments"),
                                      ("GET", "/api/2.0/apps/churn-desk")]
    grants = [s for s in inst.spark.statements if s.startswith("GRANT")]
    assert grants == [GRANT_SELECT.format("sp-2"), GRANT_ORDERS.format("sp-2"), "GRANT MODIFY ON TABLE `main`.`inspire`.`churn_out` TO `sp-2`"], (
        "record decisions starts on, so the App may write its decisions to the result table")
    assert "_warnings" not in fields
    assert inst.tagged == ["churn-desk"], "a redeployed App gets its tags again, so a new spec version shows on it"


def test_an_app_may_read_the_reasons_view_only_when_it_was_created(agent_ns, sdk_stub):
    inst, context, _calls, _imported = _deploy_inspire(agent_ns, [
        RuntimeError("RESOURCE_DOES_NOT_EXIST: app churn-desk"),
        {"compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-1"},
        {"deployment_id": "dep1", "status": {"state": "SUCCEEDED"}}, {"url": "https://churn-desk.example/"}])
    context["reasons_view"] = REASONS_VIEW
    inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert _not_access_reads(inst.spark.statements)[-1] == GRANT_REASONS.format("sp-1")


def test_sharing_lets_each_principal_read_the_reasons_view_and_says_when_it_cannot(agent_ns):
    inst = _inspire(agent_ns, _access_spark(LIVE_ACCESS, present=[{"t": "churn_out_reasons"}]))
    inst._implement_api = lambda method, path, body=None, query=None: {}
    inst._implement_emit = lambda *a, **k: None
    spec = dict(_spec(agent_ns)[0], sharing={"principals": [{"type": "user", "name": "amr@x"}, {"type": "group", "name": "bad`name"}]})
    assert inst._implement_share("N01-U01", ACCESS_TABLE, spec, {}, None) == []
    assert _not_access_reads(inst.spark.statements) == [GRANT_SELECT.format("amr@x"), GRANT_REASONS.format("amr@x")]
    inst = _inspire(agent_ns, _access_spark(LIVE_ACCESS))
    inst._implement_api = lambda method, path, body=None, query=None: {}
    inst._implement_emit = lambda *a, **k: None
    assert inst._implement_share("N01-U01", ACCESS_TABLE, spec, {}, None) == []
    assert _not_access_reads(inst.spark.statements) == [GRANT_SELECT.format("amr@x")], "no view, no grant on it"

    def respond(statement):
        if statement == GRANT_REASONS.format("amr@x"):
            raise RuntimeError("PERMISSION_DENIED: not the owner of churn_out_reasons")
        if statement.startswith(SHARED_EXISTS):
            return [{"t": "churn_out_reasons"}]
        return LIVE_ACCESS if statement.startswith("SELECT level, privilege, principal") else None

    inst = _inspire(agent_ns, FakeSpark(responder=respond))
    inst._implement_api = lambda method, path, body=None, query=None: {}
    inst._implement_emit = lambda *a, **k: None
    warnings = inst._implement_share("N01-U01", ACCESS_TABLE, spec, {}, None)
    assert len(warnings) == 1 and warnings[0].startswith(f"Sharing: {GRANT_REASONS.format('amr@x')} failed: ")
    assert "not the owner of churn_out_reasons" in warnings[0]


def test_a_build_creates_the_reasons_view_and_hands_it_to_every_output_it_builds(agent_ns):
    inst = _probe_inspire(agent_ns, None, {"dashboard": {"state": "ready", "spec_version": 2}})
    inst._implement_runner = lambda uc: "runner"
    inst._implement_fill_and_preview = lambda *a: ({"status": "written", "rows_written": 12}, 77, {})
    seen, shared = [], []
    inst._implement_dashboard = lambda c, r: pytest.fail("the dashboard did not change")
    inst._implement_genie_space = lambda c, r: seen.append(c) or {"genie_space_id": "g1", "genie_space_url": "https://h/genie/rooms/g1"}
    inst._implement_app = lambda c, r: seen.append(c) or {"app_name": "churn-desk", "app_url": "https://churn-desk.example",
                                                          "app_health": "running"}
    inst._implement_share = lambda uc, table, spec, assets, job_id, asset_status=None, sources=(): shared.append(table) or []
    assert inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": dict(VALID)},
                                      (5150, "N01-U01", 3)) == "ready"
    assert [s for s in inst.spark.statements if s.startswith("CREATE VIEW")] == [
        agent_ns["implement_reasons_view_sql"]("main.inspire.churn_out")]
    assert [c["reasons_view"] for c in seen] == [REASONS_VIEW, REASONS_VIEW] and all(REASONS_VIEW in c["allowed"] for c in seen)
    assert shared == ["main.inspire.churn_out"] and REASONS_VIEW in agent_ns["implement_app_result_reads"](shared[0])


SUMMARY_TABLE = "main.inspire.churn_out_summary"
GRANT_SUMMARY = "GRANT SELECT ON TABLE `main`.`inspire`.`churn_out_summary` TO `{}`"


def test_a_build_creates_the_run_summary_table_the_app_reads_and_hands_it_to_the_app_and_to_sharing(agent_ns):
    inst = _probe_inspire(agent_ns, None, {"dashboard": {"state": "ready", "spec_version": 2}})
    inst._implement_runner = lambda uc: "runner"
    inst._implement_fill_and_preview = lambda *a: ({"status": "written", "rows_written": 12}, 77, {})
    seen, shared = [], []
    inst._implement_dashboard = lambda c, r: pytest.fail("the dashboard did not change")
    inst._implement_genie_space = lambda c, r: {"genie_space_id": "g1", "genie_space_url": "https://h/genie/rooms/g1"}
    inst._implement_app = lambda c, r: seen.append(c) or {"app_name": "churn-desk", "app_url": "https://churn-desk.example",
                                                          "app_health": "running"}
    inst._implement_share = lambda uc, table, spec, assets, job_id, asset_status=None, sources=(): shared.append(table) or []
    assert inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": dict(VALID)},
                                      (5150, "N01-U01", 3)) == "ready"
    assert agent_ns["inspire_ai_summary_create_sql"]("main.inspire.churn_out") in inst.spark.statements, \
        "a build that keeps the notebook and runs nothing still leaves the summary table the App reads"
    assert [c["summary_table"] for c in seen] == [SUMMARY_TABLE] and shared == ["main.inspire.churn_out"]
    assert SUMMARY_TABLE in agent_ns["implement_app_result_reads"](shared[0])
    assert SUMMARY_TABLE not in seen[0]["allowed"], "Genie and the dashboard are not handed the run summary"


def test_a_summary_table_that_cannot_be_created_is_a_warning_and_nothing_is_granted_on_it(agent_ns):
    inst = _inspire(agent_ns, FakeSpark(responder=lambda s: (_ for _ in ()).throw(RuntimeError("PERMISSION_DENIED: no CREATE TABLE"))
                                        if s.startswith("CREATE TABLE IF NOT EXISTS") else None))
    warnings = []
    assert inst._implement_summary_table("main.inspire.churn_out", warnings) == ""
    assert warnings == ["The run summary table main.inspire.churn_out_summary was not created, so the App shows no run summary until "
                        "the use case is built again: PERMISSION_DENIED: no CREATE TABLE"]


def test_sharing_lets_each_principal_read_the_run_summary_the_app_shows(agent_ns):
    inst = _inspire(agent_ns, _access_spark(LIVE_ACCESS, present=[{"t": "churn_out_reasons"}, {"t": "churn_out_summary"}]))
    inst._implement_api = lambda method, path, body=None, query=None: {}
    inst._implement_emit = lambda *a, **k: None
    spec = dict(_spec(agent_ns)[0], sharing={"principals": [{"type": "user", "name": "amr@x"}, {"type": "group", "name": "bad`name"}]})
    assert inst._implement_share("N01-U01", ACCESS_TABLE, spec, {}, None) == []
    assert _not_access_reads(inst.spark.statements) == [GRANT_SELECT.format("amr@x"), GRANT_SUMMARY.format("amr@x"),
                                                         GRANT_REASONS.format("amr@x")]


def test_the_apps_service_principal_may_read_the_run_summary(agent_ns, sdk_stub):
    inst, context, _calls, _imported = _deploy_inspire(agent_ns, [
        RuntimeError("RESOURCE_DOES_NOT_EXIST: app churn-desk"),
        {"compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-1"},
        {"deployment_id": "dep1", "status": {"state": "SUCCEEDED"}}, {"url": "https://churn-desk.example/"}])
    context["summary_table"] = SUMMARY_TABLE
    inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert GRANT_SUMMARY.format("sp-1") in inst.spark.statements, "the Runs tab and the money of each run read it as the App"


def test_what_genie_left_unfixed_after_its_last_round_is_a_warning_on_the_version(agent_ns):
    left = _caught("cell 4", 3)
    for problems, status in (([left], "ready_with_warnings"), ([], "ready")):
        inst = _probe_inspire(agent_ns, None, {"dashboard": {"state": "ready", "spec_version": 2}})
        inst._implement_runner = lambda uc: "runner"
        written = {"status": "written", "rows_written": 12, **({"build_problems": problems} if problems else {})}
        inst._implement_fill_and_preview = lambda *a, written=written: (written, 77, {})
        inst._implement_dashboard = lambda c, r: pytest.fail("the dashboard did not change")
        inst._implement_genie_space = lambda c, r: {"genie_space_id": "g1", "genie_space_url": "https://h/genie/rooms/g1"}
        inst._implement_app = lambda c, r: {"app_name": "churn-desk", "app_url": "https://churn-desk.example", "app_health": "running"}
        assert inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": dict(VALID)},
                                          (5150, "N01-U01", 3)) == status
        final = inst.updates[-1]
        assert (f"Notebook: Genie's last build round left these unfixed: {left}" in str(final.get("status_message") or "")) == bool(problems)


def test_a_schedule_change_builds_nothing_and_creates_no_reasons_view(agent_ns):
    inst = _probe_inspire(agent_ns, None, {"dashboard": {"state": "ready", "spec_version": 2}})
    previous = inst._implement_previous(None)["spec_json"]
    inst._implement_runner = lambda uc: pytest.fail("a schedule change needs no Genie runner")
    inst._implement_fill_and_preview = lambda *a: pytest.fail("a schedule change runs no preview")
    inst._implement_dashboard = inst._implement_genie_space = inst._implement_app = lambda c, r: pytest.fail("no output is built")
    inst._implement_share = lambda *a, **k: pytest.fail("a schedule change shares nothing")
    scheduled = []
    inst._implement_schedule = lambda *a: scheduled.append(a)
    spec = dict(previous, schedule={"enabled": True, "cron": "0 0 7 ? * MON", "timezone": "Asia/Dubai"})
    assert inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": spec},
                                      (5150, "N01-U01", 3)) == "ready"
    assert len(scheduled) == 1 and not any(s.startswith("CREATE VIEW") for s in inst.spark.statements)


USE_CASE_TAGS = {"dbx_inspire_ai_business": "acme", "dbx_inspire_ai_usecase": "predict_churn", "dbx_inspire_ai_usecase_id": "N01-U01",
                 "dbx_inspire_ai_session": "5150", "dbx_inspire_ai_session_id": "5150", "dbx_inspire_ai_launcher_source": "Inspire App",
                 "dbx_inspire_ai_run_type": "training", "inspire_version": "v1.3.0"}


def test_the_implement_tags_name_the_run_type_spec_version_and_notebook_on_top_of_the_use_case_tags(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    spec_nb = {"job_tags": dict(USE_CASE_TAGS)}
    tags = inst._implement_tags(spec_nb, (5150, "N01-U01", 3), "/W/acme/Sales/N01-U01 - Predict churn")
    assert tags == dict(USE_CASE_TAGS, dbx_inspire_ai_run_type="implement", dbx_inspire_ai_spec_version="3",
                        dbx_inspire_ai_notebook="N01-U01_-_Predict_churn", dbx_inspire_ai_launcher_source="Inspire_App")
    assert spec_nb["job_tags"] == USE_CASE_TAGS, "the notebook spec's own tags are never changed"


def test_the_preview_job_is_tagged_with_the_implement_tags(agent_ns):
    inst = _inspire(agent_ns, _key_spark({"row_count": 1, "dated_rows": 1, "own_rows": 1}))
    inst._implement_update = lambda key, **f: None
    seen = {}

    class Launcher(agent_ns["JobLauncher"]):
        def launch(self, **kwargs):
            seen["tags"] = dict(self.job_tags)
            return {"success": True, "job_id": 77, "run_id": 5, "job_url": "u"}

        def wait_for_run(self, run_id, timeout_s=0, poll_s=0, out=None):
            return {"status": "SUCCESS", "output": "wrote 1 row for as_of_date 2026-10-01 with run_id 0123abcd-0000"}

    inst._job_launcher_cls = Launcher
    spec_nb = {"job_tags": dict(USE_CASE_TAGS), "job_slug": "churn", "schedule_cron": None}
    inst._implement_preview("N01-U01", (5150, "N01-U01", 4), CHURN_UC, _spec(agent_ns)[0], spec_nb, "/W/nb", ["result_table", "run_profile"])
    assert seen["tags"] == inst._implement_tags(spec_nb, (5150, "N01-U01", 4), "/W/nb")
    assert seen["tags"]["dbx_inspire_ai_spec_version"] == "4" and seen["tags"]["dbx_inspire_ai_usecase_id"] == "N01-U01"


def _tag_inspire(ns, listed=None, error=None):
    inst = _inspire(ns, FakeSpark())
    emitted, calls = [], []
    inst._implement_emit = lambda *a, **k: emitted.append(a)

    def api(method, path, body=None, query=None):
        calls.append((method, path, body, query))
        if error is not None:
            raise error
        return {"tag_assignments": listed} if method == "GET" and listed is not None else {}

    inst._implement_api = api
    context = {"uc_id": "N01-U01", "key": (5150, "N01-U01", 3), "notebook_spec": {"job_tags": dict(USE_CASE_TAGS)}, "notebook_path": "/W/nb"}
    return inst, context, calls, emitted


def test_an_app_gets_only_the_missing_and_changed_tags_and_keeps_everyone_elses(agent_ns):
    listed = [{"tag_key": "dbx_inspire_ai_spec_version", "tag_value": "2"}, {"tag_key": "dbx_inspire_ai_business", "tag_value": "acme"},
              {"tag_key": "cost_center", "tag_value": "finance"}]
    inst, context, calls, emitted = _tag_inspire(agent_ns, listed)
    inst._implement_tag_app(context, "churn-desk")
    base = "/api/2.0/entity-tag-assignments"
    assert calls[0] == ("GET", f"{base}/apps/churn-desk/tags", None, None)
    wanted = inst._implement_tags(context["notebook_spec"], context["key"], context["notebook_path"])
    posted = {c[2]["tag_key"]: c[2]["tag_value"] for c in calls if c[0] == "POST"}
    assert posted == {k: v for k, v in wanted.items() if k not in ("dbx_inspire_ai_spec_version", "dbx_inspire_ai_business")}
    assert all(c[1] == base and c[2]["entity_type"] == "apps" and c[2]["entity_id"] == "churn-desk" for c in calls if c[0] == "POST")
    assert [c for c in calls if c[0] == "PATCH"] == [
        ("PATCH", f"{base}/apps/churn-desk/tags/dbx_inspire_ai_spec_version",
         {"entity_type": "apps", "entity_id": "churn-desk", "tag_key": "dbx_inspire_ai_spec_version", "tag_value": "3"},
         {"update_mask": "tag_value"})]
    assert not [c for c in calls if c[0] == "DELETE"] and "cost_center" not in posted, "a tag Inspire did not set is never touched"
    assert emitted == []
    fresh, context, calls, _ = _tag_inspire(agent_ns, None)
    fresh._implement_tag_app(context, "churn-desk")
    assert len([c for c in calls if c[0] == "POST"]) == len(wanted), "an App with no tags yet (an empty answer) gets every tag"


def test_an_app_that_cannot_be_tagged_deploys_with_a_warning_that_says_why(agent_ns):
    inst, context, calls, emitted = _tag_inspire(agent_ns, error=RuntimeError("PERMISSION_DENIED: cannot assign tags on apps"))
    warning = inst._implement_tag_app(context, "churn-desk")
    assert len(calls) == 1, "a permission error is not retried"
    assert warning == ("App: the App churn-desk was not tagged, so its usage cannot be traced to this use case: "
                       "PERMISSION_DENIED: cannot assign tags on apps. Build the App again with Vibe/Add/Remove Features on the Build page to tag it")
    assert emitted == [], "the App step is not turned yellow; the warning goes to the App's warnings"


def test_a_retry_only_edit_rebuilds_just_the_alert_without_genie_or_a_preview(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    previous = dict(VALID, outputs={**VALID["outputs"], **ALERT})
    inst._implement_previous = lambda t: {"spec_version": 2, "spec_json": previous}
    inst._implement_carried = lambda t: ({"notebook_path": "/W/nb", "job_id": 77, "last_preview_run_id": 5, "result_rows": 40,
                                          "dashboard_id": "d1", "dashboard_url": "https://h/d", "genie_space_id": "g1",
                                          "app_name": "churn-desk", "genie_widgets": [{"name": "top_k", "default": "25"}]},
                                         _left_by(2, {"alert": {"state": "failed", "error": "PERMISSION_DENIED"}}))
    inst.updates = []
    inst._implement_update = lambda key, **f: inst.updates.append(f)
    inst._implement_use_case_row = lambda sid, uc: {"No": "N01-U01", "Name": "Predict churn", "genie_instruction": "Build"}
    inst._row_to_uc = lambda row: dict(row)
    inst._genie_notebook_spec = lambda uc: dict(_NB_SPEC)
    inst._genie_widget_names = lambda instruction, spec: ["result_table"]
    inst._genie_involved_tables = lambda uc: ["main.s.orders"]
    inst._implement_runner = lambda uc: pytest.fail("a retry of the alert needs no Genie runner")
    inst._implement_fill_and_preview = lambda *a: pytest.fail("a retry of an output never re-runs the notebook")
    inst._implement_schedule = lambda *a: pytest.fail("a retry leaves the schedule alone")
    built, shared = [], []

    def alert(context, runner):
        built.append((context["job_id"], dict(context["urls"]), runner))
        return {"alert_id": "al-9", "alert_url": "https://h/sql/alerts-v2/al-9", "_asset": {"check_state": "OK", "subscribers": 1}}

    inst._implement_alert = alert
    inst._implement_dashboard = inst._implement_genie_space = inst._implement_app = lambda c, r: pytest.fail("only the alert is retried")
    inst._implement_share = lambda uc, table, spec, assets, job_id, asset_status=None, sources=(): shared.append((dict(assets), job_id)) or []
    status = inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3,
                                         "spec_json": dict(previous, retry_outputs=["alert"])}, (5150, "N01-U01", 3))
    assert status == "ready" and inst.updates[0]["change_classes"] == "retry"
    assert inst.updates[0]["genie_widgets"] == [{"name": "top_k", "default": "25"}], "a version that keeps the notebook keeps its widgets"
    assert built == [(77, {"dashboard_url": "https://h/d"}, None)]
    assert {"alert_id": "al-9", "alert_url": "https://h/sql/alerts-v2/al-9"} in inst.updates
    final = inst.updates[-1]
    assert final["status"] == "ready" and final["job_id"] == 77
    assert final["status_message"] == "ready: no new preview was needed; the last preview wrote 40 rows"
    assert final["asset_status"]["alert"] == {"check_state": "OK", "subscribers": 1, "state": "ready", "spec_version": 3,
                                              "title": "N01-U01 Predict churn"}
    assert shared == [({"dashboard": "d1", "genie_space": "g1", "app": "churn-desk", "alert": "al-9", "preview_run_id": 5}, 77)]
    assert not any(s.endswith("LIMIT 0") for s in inst.spark.statements), "a run with no preview does not probe the source tables"


ASSETS_ROOT = "/zqv/assets"
INSTALL_ERROR = (f"The Inspire assets file {ASSETS_ROOT}/manifest.json is missing. Install step: run the Inspire installer with the "
                 f"Inspire assets download for {{version}}; it puts every file manifest.json lists into {ASSETS_ROOT}.")


def _failed_download(agent_ns, tmp_path, monkeypatch):
    runner = agent_ns["GenieCodeRunner"]("https://h", "t", CapturingLogger(), root=str(tmp_path / "root"),
                                         assets=agent_ns["InspireAssets"](ASSETS_ROOT, local=str(tmp_path / "local"), machine="x86_64"))
    return runner.install


def test_a_genie_code_install_failure_fails_only_the_outputs_genie_builds(agent_ns, tmp_path, monkeypatch):
    inst = _inspire(agent_ns, FakeSpark())
    previous = dict(VALID, outputs={**VALID["outputs"], **ALERT})
    live = {name: {"state": "ready", "spec_version": 2} for name in ("dashboard", "genie_space", "app", "alert")}
    inst._implement_previous = lambda t: {"spec_version": 2, "spec_json": previous}
    inst._implement_carried = lambda t: ({"notebook_path": "/W/nb", "job_id": 77, "last_preview_run_id": 5, "result_rows": 40,
                                          "dashboard_id": "d1", "genie_space_id": "g1", "app_name": "churn-desk", "alert_id": "al-1"},
                                         _left_by(2, json.loads(json.dumps(dict(live, data={"state": "failed", "spec_version": 1})))))
    inst.updates = []
    inst._implement_update = lambda key, **f: inst.updates.append(json.loads(json.dumps(f)))
    inst._implement_use_case_row = lambda sid, uc: {"No": "N01-U01", "Name": "Predict churn", "genie_instruction": "Build"}
    inst._row_to_uc = lambda row: dict(row)
    inst._genie_notebook_spec = lambda uc: dict(_NB_SPEC)
    inst._genie_widget_names = lambda instruction, spec: ["result_table"]
    inst._genie_involved_tables = lambda uc: ["main.s.orders"]
    installs, download = [], _failed_download(agent_ns, tmp_path, monkeypatch)

    def broken_runner(uc):
        installs.append(uc)
        download()

    inst._implement_runner = broken_runner
    inst._implement_fill_and_preview = lambda *a: pytest.fail("a retry of an output never re-runs the notebook")
    inst._implement_schedule = lambda *a: pytest.fail("a retry leaves the schedule alone")
    inst._implement_dashboard = inst._implement_genie_space = lambda c, r: pytest.fail("nothing Genie builds runs without Genie Code")
    inst._implement_app = lambda c, r: pytest.fail("the App is not part of this retry")
    inst._implement_alert = lambda context, runner: {"alert_id": "al-1", "alert_url": "https://h/sql/alerts-v2/al-1",
                                                     "_asset": {"check_state": "OK"}}
    inst._implement_share = lambda *a, **k: []
    emitted = []
    inst._implement_emit = lambda uc, step, message, status, *a, **k: emitted.append((step, status))
    status = inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3,
                                         "spec_json": dict(previous, retry_outputs=["dashboard", "genie_space", "alert"])},
                                        (5150, "N01-U01", 3))
    reason = f"Genie Code could not be installed: {INSTALL_ERROR.format(version=agent_ns['__AGENT_VERSION__'])}"
    notebook = _left_by(2)["notebook"]
    assert status == "ready_with_warnings" and installs == ["N01-U01"], "Genie Code is tried once, and only what it builds fails"
    assert inst.updates[0]["status"] == "filling" and inst.updates[0]["asset_status"] == dict(live, notebook=notebook), \
        "the version records the live outputs' state before it builds, so a failure part-way never hides them"
    final = inst.updates[-1]
    assert final["status"] == "ready_with_warnings" and final["status_message"] == (f"Genie Agent not built: {agent_ns['implement_short_reason'](reason)}; "
                                                                      f"Dashboard not published: {agent_ns['implement_short_reason'](reason)}")
    assert final["asset_status"].pop("target_kpi")["source"] == "evaluated", "the version records the KPI it tracks"
    assert final["asset_status"].pop("built_with") == agent_ns["implement_build_stamp"](), "the version records the release it was built with"
    assert final["asset_status"] == {"dashboard": {"state": "failed", "error": reason, "spec_version": 3},
                                     "genie_space": {"state": "failed", "error": reason, "spec_version": 3},
                                     "app": {"state": "ready", "spec_version": 2},
                                     "alert": {"check_state": "OK", "state": "ready", "spec_version": 3, "title": "N01-U01 Predict churn"},
                                     "notebook": notebook,
                                     "delivery": {"delivered": ["alert", "app"], "spec_version": 3, "not_delivered": [
                                         {"output": "genie_space", "label": "Genie Agent", "reason": agent_ns["implement_short_reason"](reason)},
                                         {"output": "dashboard", "label": "Dashboard", "reason": agent_ns["implement_short_reason"](reason)}]}}
    assert ("Dashboard", "ended_warning") in emitted and ("Genie Agent", "ended_warning") in emitted and emitted[-1] == ("Done", "ended_warning")


def test_a_failed_genie_code_install_ends_its_step_with_the_reason(fresh_ns, tmp_path, monkeypatch):
    download = _failed_download(fresh_ns, tmp_path, monkeypatch)

    class _BrokenRunner:
        def __init__(self, host, token, logger, on_line=None, route=None):
            self.token = token

        def install(self):
            download()

    fresh_ns["GenieCodeRunner"] = _BrokenRunner
    inst = _inspire(fresh_ns, FakeSpark())
    inst._genie_code_route = {"route": fresh_ns["GENIE_CODE_DEFAULT_ROUTE"], "refused": [], "waiting": [], "listed": {}}
    context = types.SimpleNamespace(apiUrl=lambda: types.SimpleNamespace(get=lambda: "https://h"),
                                    apiToken=lambda: types.SimpleNamespace(get=lambda: "tok"))
    inst.dbutils = types.SimpleNamespace(notebook=types.SimpleNamespace(entry_point=types.SimpleNamespace(
        getDbutils=lambda: types.SimpleNamespace(notebook=lambda: types.SimpleNamespace(getContext=lambda: context)))))
    emitted = []
    inst._implement_emit = lambda uc, step, message, status, *a, **k: emitted.append((step, message, status, k.get("step_id"))) or "s1"
    with pytest.raises(RuntimeError, match="manifest.json is missing"):
        inst._implement_runner("N01-U01")
    assert emitted == [("Genie Code", "checking which AI model Genie Code can call and installing the Genie Code CLI and the "
                                      "Databricks CLI", "started", None),
                       ("Genie Code", f"Genie Code could not be installed: {INSTALL_ERROR.format(version=fresh_ns['__AGENT_VERSION__'])}",
                        "ended_error", "s1")], \
        "a failed install ends its step, so the Build page never shows it still running"


@pytest.mark.parametrize("health,status", [("running", "ready"), ("passed", "ready"),
                                           ("unverified: the App answered HTTP 302", "ready_with_warnings")])
def test_an_app_that_runs_behind_sign_in_is_ready_and_only_other_health_results_warn(agent_ns, health, status):
    inst = _inspire(agent_ns, FakeSpark())
    previous = dict(VALID, outputs={**VALID["outputs"], "app": True, "app_name": "churn-desk"})
    inst._implement_previous = lambda t: {"spec_version": 2, "spec_json": previous}
    inst._implement_carried = lambda t: ({"notebook_path": "/W/nb", "job_id": 77, "last_preview_run_id": 5, "result_rows": 40,
                                          "dashboard_id": "d1", "genie_space_id": "g1", "app_name": "churn-desk"},
                                         _left_by(2, {"app": {"state": "failed", "error": "x"}}))
    inst.updates = []
    inst._implement_update = lambda key, **f: inst.updates.append(f)
    inst._implement_use_case_row = lambda sid, uc: {"No": "N01-U01", "Name": "Predict churn", "genie_instruction": "Build"}
    inst._row_to_uc = lambda row: dict(row)
    inst._genie_notebook_spec = lambda uc: dict(_NB_SPEC)
    inst._genie_widget_names = lambda instruction, spec: ["result_table"]
    inst._genie_involved_tables = lambda uc: ["main.s.orders"]
    inst._implement_runner = lambda uc: "runner"
    inst._implement_fill_and_preview = lambda *a: pytest.fail("a retry of an output never re-runs the notebook")
    inst._implement_schedule = lambda *a: pytest.fail("a retry leaves the schedule alone")
    inst._implement_app = lambda context, runner: {"app_name": "churn-desk", "app_url": "https://churn-desk.example", "app_health": health}
    inst._implement_dashboard = inst._implement_genie_space = inst._implement_alert = lambda c, r: pytest.fail("only the App is retried")
    inst._implement_share = lambda uc, table, spec, assets, job_id, asset_status=None, sources=(): []
    got = inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3,
                                      "spec_json": dict(previous, retry_outputs=["app"])}, (5150, "N01-U01", 3))
    final = inst.updates[-1]
    assert got == status and final["status"] == status
    assert final["asset_status"]["app"]["health"] == health
    assert ("health check" in str(final.get("status_message") or "")) == (status == "ready_with_warnings")
    assert final["asset_status"]["app"].get("warnings", []) == ([f"health check {health}"] if status == "ready_with_warnings" else [])


@pytest.mark.parametrize("description,state,status", [
    ("Inspire use case N01-U01 (session 5150): Predict churn", "deleted", "ready"),
    ("Finance team tool", "released", "ready_with_warnings"),
])
def test_unticking_the_app_with_delete_deletes_only_this_use_cases_app(agent_ns, description, state, status):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_previous = lambda t: {"spec_version": 2, "spec_json": dict(VALID)}
    inst._implement_carried = lambda t: ({"notebook_path": "/W/nb", "job_id": 77, "last_preview_run_id": 5, "result_rows": 40,
                                          "dashboard_id": "d1", "genie_space_id": "g1", "app_name": "churn-desk"}, _left_by(2))
    inst.updates = []
    inst._implement_update = lambda key, **f: inst.updates.append(f)
    inst._implement_use_case_row = lambda sid, uc: {"No": "N01-U01", "Name": "Predict churn", "genie_instruction": "Build"}
    inst._row_to_uc = lambda row: dict(row)
    inst._genie_notebook_spec = lambda uc: dict(_NB_SPEC)
    inst._genie_widget_names = lambda instruction, spec: ["result_table"]
    inst._genie_involved_tables = lambda uc: ["main.s.orders"]
    inst._implement_fill_and_preview = lambda *a: pytest.fail("unticking an output never re-runs the notebook")
    inst._implement_dashboard = inst._implement_genie_space = inst._implement_app = inst._implement_alert = \
        lambda c, r: pytest.fail("unticking an output builds nothing")
    calls = []

    def api(method, path, body=None, query=None):
        calls.append((method, path))
        return {"description": description} if method == "GET" else {}

    inst._implement_api = api
    inst._implement_notebook_paths = lambda uc, key: ("/W/acme_implemented/Sales", "/W/acme_implemented/Sales/N01-U01")
    spec = dict(VALID, outputs={**VALID["outputs"], "app": False}, removed_outputs={"app": "delete"})
    got = inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": spec},
                                     (5150, "N01-U01", 3))
    final = inst.updates[-1]
    assert got == status and final["status"] == status and final["asset_status"]["app"]["state"] == state
    assert (("DELETE", "/api/2.0/apps/churn-desk") in calls) == (state == "deleted")
    assert (("POST", "/api/2.0/workspace/delete") in calls) == (state == "deleted"), "only a deleted App loses its source folder"
    if state == "released":
        assert "churn-desk is no longer this use case's App, so Inspire did not delete it" in final["status_message"]


def test_the_ready_message_counts_the_rows_of_a_preview_only_when_one_ran(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    previous = dict(VALID, outputs={**VALID["outputs"], "genie_space": False, "app": False})
    inst._implement_previous = lambda t: {"spec_version": 2, "spec_json": previous}
    inst._implement_carried = lambda t: ({"notebook_path": "/W/nb", "job_id": 77, "result_rows": 40, "dashboard_id": "d1"}, _left_by(2))
    inst.updates = []
    inst._implement_update = lambda key, **f: inst.updates.append(f)
    inst._implement_use_case_row = lambda sid, uc: {"No": "N01-U01", "Name": "Predict churn", "genie_instruction": "Build"}
    inst._row_to_uc = lambda row: dict(row)
    inst._genie_notebook_spec = lambda uc: dict(_NB_SPEC)
    inst._genie_widget_names = lambda instruction, spec: ["result_table"]
    inst._genie_involved_tables = lambda uc: ["main.s.orders"]
    inst._implement_runner = lambda uc: "runner"
    previews = []
    inst._implement_fill_and_preview = lambda *a: previews.append(a[-1]) or ({"status": "written", "rows_written": 12}, 77, {})
    inst._implement_schedule = lambda *a: pytest.fail("an outputs change leaves the schedule alone")
    inst._implement_dashboard = lambda c, r: pytest.fail("the dashboard did not change")
    inst._implement_genie_space = lambda c, r: {"genie_space_id": "g1", "genie_space_url": "https://h/genie/rooms/g1"}
    inst._implement_app = lambda c, r: {"app_name": "churn-desk", "app_url": "https://churn-desk.example", "app_health": "running"}
    inst._implement_share = lambda uc, table, spec, assets, job_id, asset_status=None, sources=(): []
    got = inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": dict(VALID)},
                                     (5150, "N01-U01", 3))
    assert got == "ready" and previews == [False], "new outputs with no earlier preview run one preview without a refill"
    assert inst.updates[-1]["status_message"] == "ready: preview wrote 12 rows"


NO_ACTION = "so it has nobody to act on yet"


def test_the_tier_mix_warning_fires_only_when_no_row_reached_an_action_tier(agent_ns):
    warn = agent_ns["implement_tier_mix_warning"]
    assert warn({"Monitor": 1000}, "https://h/jobs/7/runs/9") == (
        f"Decision list: no row of the latest run reached Act now or Review (1,000 Monitor), {NO_ACTION}; run: https://h/jobs/7/runs/9")
    assert warn({"Monitor": 6, "act now": 4, "no tier": 6}) == (
        f"Decision list: no row of the latest run reached Act now or Review (6 Monitor, 6 no tier, 4 act now), {NO_ACTION}")
    assert warn({"Act now": 0, "Review": None, "Monitor": 5}) == (
        f"Decision list: no row of the latest run reached Act now or Review (5 Monitor), {NO_ACTION}")
    for acted in ({"Monitor": 990, "Act now": 10}, {"Review": 3}, {"Act now": 1}, {}, None, {"Monitor": 0}):
        assert warn(acted, "https://h/r") == "", acted
        assert agent_ns["implement_reached_no_action_tier"](acted) is False, acted
    assert agent_ns["implement_reached_no_action_tier"]({"Monitor": 2, "no tier": 1}) is True


def test_the_tier_mix_warning_states_the_runs_value_range_and_flags_and_never_claims_an_explanation(agent_ns):
    warn = agent_ns["implement_tier_mix_warning"]
    flagged = {"rows": 10, "valued": 10, "distinct": 7, "span": 0.0094, "flagged": 10, "flag_kinds": 1}
    assert warn({"Monitor": 10}, "https://h/r/9", flagged) == (
        f"Decision list: no row of the latest run reached Act now or Review (10 Monitor), {NO_ACTION}; column value holds 7 distinct "
        "values spanning 0.0094; 10 of 10 rows (100%) carry a data_quality_flag other than ok, in 1 kind; run: https://h/r/9")
    clean = {"rows": 1000, "valued": 1000, "distinct": 950, "span": 0.0497, "flagged": 0, "flag_kinds": 0}
    assert warn({"Monitor": 1000}, "", clean) == (
        f"Decision list: no row of the latest run reached Act now or Review (1,000 Monitor), {NO_ACTION}; column value holds 950 "
        "distinct values spanning 0.0497; no row is flagged")
    assert warn({"Monitor": 4}, "", {"rows": 4, "valued": 4, "distinct": 1, "span": 0.0, "flagged": 4, "flag_kinds": 2}) == (
        f"Decision list: no row of the latest run reached Act now or Review (4 Monitor), {NO_ACTION}; every row has the same value in "
        "column value; 4 of 4 rows (100%) carry a data_quality_flag other than ok, in 2 kinds"), "the warning names no value the run wrote"
    assert warn({"Act now": 1}, "", flagged) == ""
    assert "says why" not in warn({"Monitor": 1}, "https://h/r", clean)
    assert agent_ns["implement_number_text"](0.4899) == "0.49" and agent_ns["implement_number_text"](2452642) == "2,452,642"
    assert agent_ns["implement_number_text"](2452642.37) == "2.45M"


def test_the_tier_mix_warning_names_the_method_behind_the_rows_and_whether_a_model_is_registered(agent_ns):
    warn = agent_ns["implement_tier_mix_warning"]
    fallback = {"methods": [("Most popular items", 7200)], "kinds": 1, "versioned_rows": 0}
    profile = {"rows": 7200, "valued": 7200, "distinct": 1, "span": 0.0, "flagged": 0, "flag_kinds": 0}
    assert warn({"Monitor": 7200}, "https://h/r/9", profile, fallback) == (
        f"Decision list: no row of the latest run reached Act now or Review (7,200 Monitor), {NO_ACTION}; every row comes from one "
        "method in column method, with no registered model; every row has the same value in column value; no row is flagged; run: "
        "https://h/r/9")
    mixed = {"methods": [("Item-item cosine similarity", 30), ("Most popular items", 10)], "kinds": 2, "versioned_rows": 30}
    assert warn({"Monitor": 40}, "", None, mixed) == (
        f"Decision list: no row of the latest run reached Act now or Review (40 Monitor), {NO_ACTION}; its rows come from 2 methods in "
        "column method, the largest on 75% of them")
    assert not any(name in warn({"Monitor": 40}, "", None, mixed) for name in ("Item-item", "Most popular")), "no method name"
    assert warn({"Monitor": 5}, "", None, {"methods": [("Logistic regression", 5)], "versioned_rows": 5}) == (
        f"Decision list: no row of the latest run reached Act now or Review (5 Monitor), {NO_ACTION}; every row comes from one method in "
        "column method")
    assert warn({"Monitor": 5}, "", None, {"methods": [("A", 3), ("B", 2)], "versioned_rows": 0}) == (
        f"Decision list: no row of the latest run reached Act now or Review (5 Monitor), {NO_ACTION}; its rows come from 2 methods in "
        "column method, the largest on 60% of them, with no registered model")
    assert warn({"Monitor": 5}, "", None, {"methods": [("no method", 5)], "kinds": 1, "versioned_rows": 0}) == (
        f"Decision list: no row of the latest run reached Act now or Review (5 Monitor), {NO_ACTION}; no row names its method in column "
        "method, with no registered model")
    for unknown in (None, {}, {"methods": [], "versioned_rows": 0}):
        assert warn({"Monitor": 5}, "", None, unknown) == (
            f"Decision list: no row of the latest run reached Act now or Review (5 Monitor), {NO_ACTION}"), unknown
    assert warn({"Act now": 1, "Monitor": 4}, "", profile, fallback) == ""


def test_the_methods_of_the_latest_run_merge_blank_names_and_keep_the_three_largest(agent_ns):
    table = "`main`.`inspire`.`n05_u01_out`"
    rows = [{"method": "A", "method_rows": 5, "versioned_rows": 0}, {"method": None, "method_rows": 4, "versioned_rows": 0},
            {"method": "  ", "method_rows": 3, "versioned_rows": 0}, {"method": " B ", "method_rows": 2, "versioned_rows": 2},
            {"method": "C", "method_rows": 1, "versioned_rows": None}]
    inst = _inspire(agent_ns, FakeSpark(responder=lambda s: rows if "GROUP BY method" in s else []))
    assert inst._implement_latest_run_methods("main.inspire.n05_u01_out") == {
        "methods": [("no method", 7), ("A", 5), ("B", 2)], "kinds": 4, "versioned_rows": 2}
    assert inst.spark.statements[-1] == (
        f"SELECT method, COUNT(*) AS method_rows, COUNT_IF(COALESCE(TRIM(CAST(model_version AS STRING)), '') <> '') AS versioned_rows "
        f"FROM {table} WHERE is_current AND change_source <> 'delete' GROUP BY method")
    assert _inspire(agent_ns, FakeSpark(responder=lambda s: []))._implement_latest_run_methods("main.inspire.n05_u01_out") is None


def test_the_tier_warning_says_which_method_wrote_the_rows_and_keeps_its_other_facts_when_it_cannot(agent_ns):
    profile_rows = [{"n": 7200, "valued": 7200, "distinct_values": 412, "span": 0.4147, "flagged": 30, "flag_kinds": 1}]
    method_rows = [{"method": "Most popular items", "method_rows": 7200, "versioned_rows": 0}]

    def respond(statement):
        if "GROUP BY priority_tier" in statement:
            return [{"priority_tier": "Monitor", "tier_rows": 7200}]
        if "flag_kinds" in statement:
            return profile_rows
        if "GROUP BY method" in statement:
            return method_rows
        return []

    facts = ("column value holds 412 distinct values spanning 0.415; 30 of 7,200 rows (under 1%) carry a data_quality_flag other than "
             "ok, in 1 kind")
    inst = _inspire(agent_ns, FakeSpark(responder=respond))
    assert inst._implement_tier_warning("N05-U01", "main.inspire.n05_u01_out", "https://h/r/9") == (
        f"Decision list: no row of the latest run reached Act now or Review (7,200 Monitor), {NO_ACTION}; every row comes from "
        f"one method in column method, with no registered model; {facts}; run: https://h/r/9"), "the warning names no value the run wrote"

    def no_method_column(statement):
        if "GROUP BY method" in statement:
            raise RuntimeError("UNRESOLVED_COLUMN method")
        return respond(statement)

    bare = _inspire(agent_ns, FakeSpark(responder=no_method_column))
    assert bare._implement_tier_warning("N05-U01", "main.inspire.n05_u01_out", "https://h/r/9") == (
        f"Decision list: no row of the latest run reached Act now or Review (7,200 Monitor), {NO_ACTION}; {facts}; run: https://h/r/9"), \
        "a table without the method columns keeps its value range and flags"
    assert any(level == "WARNING" and "could not read the methods of the latest run of main.inspire.n05_u01_out" in msg
               and "UNRESOLVED_COLUMN method" in msg for level, msg in bare.logger.records)

    def no_profile(statement):
        if "flag_kinds" in statement:
            raise RuntimeError("UNRESOLVED_COLUMN value_type")
        return respond(statement)

    methods_only = _inspire(agent_ns, FakeSpark(responder=no_profile))
    got = methods_only._implement_tier_warning("N05-U01", "main.inspire.n05_u01_out", "https://h/r/9")
    assert got == (f"Decision list: no row of the latest run reached Act now or Review (7,200 Monitor), {NO_ACTION}; every row comes "
                   "from one method in column method, with no registered model; run: https://h/r/9")
    assert "no row is flagged" not in got, "a profile that cannot be read never claims the rows are unflagged"
    acted = _inspire(agent_ns, FakeSpark(responder=lambda s: [{"priority_tier": "Act now", "tier_rows": 1}]))
    assert acted._implement_tier_warning("N05-U01", "main.inspire.n05_u01_out", "") == ""
    assert not any("GROUP BY method" in s for s in acted.spark.statements), "a run with rows to act on reads no methods"


@pytest.mark.parametrize("reason,ready", [
    ("the best candidate's out-of-time AUC was 0.58 and this use case needs 0.70", True),
    ("No record has 1,000 USD or more at stake, the amount this use case reviews from.", True),
    ("No model passed this use case's acceptance check in the last run.", True),
    ("No record passed this use case's decision test in the last run.", False),
    ("Every record has a data quality issue, most often: missing price.", False),
    ("The last run wrote no current records.", False),
    ("   ", False),
    (None, False),
])
def test_a_run_that_says_why_it_has_nothing_to_act_on_reads_ready(agent_ns, reason, ready):
    def respond(statement):
        if "GROUP BY priority_tier" in statement:
            return [{"priority_tier": "Monitor", "tier_rows": 12}]
        if statement.startswith("SELECT nothing_to_act"):
            return [{"nothing_to_act": reason}]
        return []

    inst = _inspire(agent_ns, FakeSpark(responder=respond))
    warning = inst._implement_tier_warning("N01-U01", "main.inspire.n01_u01_out", "https://h/r", "r-9")
    decided = [e for e in inst.emitted if e["step_name"] == "Decision list"]
    if ready:
        assert warning == "", "the App's Results card gives the reason, so the build has nothing to warn about"
        assert [(e["status"], e["message"]) for e in decided] == [(
            "ended_success", "no row of the latest run reached Act now or Review, and the App shows the reason the run wrote in "
            "nothing_to_act")]
        assert not any("flag_kinds" in s or "GROUP BY method" in s for s in inst.spark.statements)
    else:
        assert warning.startswith("Decision list: no row of the latest run reached Act now or Review (12 Monitor)"), \
            "a reason that names no cause still leaves the people who act on it without one"
        assert decided == []
    assert agent_ns["implement_nothing_to_act_explained"](reason) is ready


def test_inspire_only_falls_back_to_the_reasons_the_build_still_warns_about(agent_ns):
    reason = agent_ns["inspire_nothing_to_act"]
    explained = agent_ns["implement_nothing_to_act_explained"]
    assert not explained(reason({"records": 3}, None, ""))
    assert not explained(reason({"records": 0}, None, ""))
    assert not explained(reason({"records": 3, "flagged_records": 3, "top_flag": "missing price"}, None, ""))
    assert explained(reason({"records": 3}, None, "the forecast missed MASE 1.0 on 3 of 3 folds"))


def test_the_action_tiers_and_the_alert_tier_sets_come_from_the_priority_tiers(agent_ns):
    assert agent_ns["IMPLEMENT_ACTION_TIERS"] == ("Act now", "Review") == agent_ns["INSPIRE_PRIORITY_TIERS"][:2]
    assert agent_ns["IMPLEMENT_ALERT_TIER_SETS"] == {"act_now": ("Act now",), "act_now_review": ("Act now", "Review")}


def test_the_tier_counts_read_only_the_latest_run_and_name_rows_with_no_tier(agent_ns):
    rows = [{"priority_tier": "Monitor", "tier_rows": 990}, {"priority_tier": None, "tier_rows": 10}]
    inst = _inspire(agent_ns, FakeSpark(responder=lambda s: rows if "GROUP BY priority_tier" in s else []))
    assert inst._implement_tier_counts("main.inspire.n01_u01_out") == {"Monitor": 990, "no tier": 10}
    table = "`main`.`inspire`.`n01_u01_out`"
    assert inst.spark.statements[-1] == (f"SELECT priority_tier, COUNT(*) AS tier_rows FROM {table} WHERE is_current AND "
                                         f"change_source <> 'delete' GROUP BY priority_tier")


def test_a_tier_count_that_breaks_is_logged_and_never_fails_the_run(agent_ns):
    inst = _inspire(agent_ns, FakeSpark(responder=lambda s: (_ for _ in ()).throw(RuntimeError("TABLE_OR_VIEW_NOT_FOUND"))))
    assert inst._implement_tier_warning("N01-U01", "main.inspire.n01_u01_out", "https://h/r") == ""
    assert any(level == "WARNING" and msg.startswith("[IMPLEMENT-TIERS] N01-U01: could not count the priority tiers of the latest "
                                                     "run of main.inspire.n01_u01_out") and "TABLE_OR_VIEW_NOT_FOUND" in msg
               for level, msg in inst.logger.records)
    profile_rows = [{"n": 4, "valued": 3, "distinct_values": 3, "span": 0.03, "flagged": 2, "flag_kinds": 1}]

    def respond(statement):
        if "GROUP BY priority_tier" in statement:
            return [{"priority_tier": "Monitor", "tier_rows": 3}]
        if "flag_kinds" in statement:
            return profile_rows
        return []

    quiet = _inspire(agent_ns, FakeSpark(responder=respond))
    warning = quiet._implement_tier_warning("N01-U01", "main.inspire.n01_u01_out", "")
    assert warning == (f"Decision list: no row of the latest run reached Act now or Review (3 Monitor), {NO_ACTION}; column value "
                       "holds 3 distinct values spanning 0.03; 2 of 4 rows (50%) carry a data_quality_flag other than ok, in 1 kind")
    assert not [r for r in quiet.logger.records if r[0] == "WARNING" and warning in r[1]], "a decision list fact is a note, never a warning"
    table = "`main`.`inspire`.`n01_u01_out`"
    flagged = "data_quality_flag IS NOT NULL AND lower(trim(CAST(data_quality_flag AS STRING))) <> 'ok'"
    assert (f"SELECT COUNT(*) AS n, COUNT(value) AS valued, COUNT(DISTINCT value) AS distinct_values, "
            f"MAX(TRY_CAST(value AS DOUBLE)) - MIN(TRY_CAST(value AS DOUBLE)) AS span, COUNT_IF({flagged}) AS flagged, "
            f"COUNT(DISTINCT CASE WHEN {flagged} THEN data_quality_flag END) AS flag_kinds FROM {table} WHERE is_current AND "
            f"change_source <> 'delete'") in quiet.spark.statements

    def no_profile(statement):
        if "flag_kinds" in statement:
            raise RuntimeError("UNRESOLVED_COLUMN value_type")
        return respond(statement)

    bare = _inspire(agent_ns, FakeSpark(responder=no_profile))
    assert bare._implement_tier_warning("N01-U01", "main.inspire.n01_u01_out", "https://h/r") == (
        f"Decision list: no row of the latest run reached Act now or Review (3 Monitor), {NO_ACTION}; run: https://h/r"), \
        "a profile that cannot be read leaves the warning without facts, never without the warning"
    assert any(level == "WARNING" and "could not read the value range and flags" in msg for level, msg in bare.logger.records)
    acted = _inspire(agent_ns, FakeSpark(responder=lambda s: [{"priority_tier": "Act now", "tier_rows": 1}]))
    assert acted._implement_tier_warning("N01-U01", "main.inspire.n01_u01_out", "") == ""
    assert not any("flag_kinds" in s for s in acted.spark.statements), "a run with rows to act on reads no profile"


@pytest.mark.parametrize("counts,preview,note,message", [
    ({"Monitor": 12}, True, f"no row of the latest run reached Act now or Review (12 Monitor), {NO_ACTION}; run: https://h/jobs/77/runs/9",
     "ready: preview wrote 12 rows"),
    ({"Act now": 1, "Monitor": 11}, True, "", "ready: preview wrote 12 rows"),
    ({"Monitor": 40}, False, f"no row of the latest run reached Act now or Review (40 Monitor), {NO_ACTION}",
     "ready: no new preview was needed; the last preview wrote 40 rows"),
    ({"Review": 40}, False, "", "ready: no new preview was needed; the last preview wrote 40 rows"),
])
def test_a_use_case_whose_latest_run_has_nobody_to_act_on_ends_ready_with_a_note(agent_ns, counts, preview, note, message):
    status = "ready"
    inst = _inspire(agent_ns, FakeSpark())
    inst.updates, tables = [], []
    inst._implement_update = lambda key, **f: inst.updates.append(f)
    inst._implement_use_case_row = lambda sid, uc: {"No": "N01-U01", "Name": "Predict churn", "genie_instruction": "Build"}
    inst._row_to_uc = lambda row: dict(row)
    inst._genie_notebook_spec = lambda uc: dict(_NB_SPEC)
    inst._genie_widget_names = lambda instruction, spec: ["result_table"]
    inst._genie_involved_tables = lambda uc: ["main.s.orders"]
    inst._implement_runner = lambda uc: "runner"
    inst._implement_schedule = lambda *a: pytest.fail("the schedule did not change")
    inst._implement_dashboard = lambda c, r: pytest.fail("the dashboard did not change")
    inst._implement_genie_space = lambda c, r: {"genie_space_id": "g1", "genie_space_url": "https://h/genie/rooms/g1"}
    inst._implement_app = lambda c, r: {"app_name": "churn-desk", "app_url": "https://churn-desk.example", "app_health": "running"}
    inst._implement_share = lambda uc, table, spec, assets, job_id, asset_status=None, sources=(): []
    inst._implement_tier_counts = lambda table: tables.append(table) or dict(counts)
    if preview:
        previous = dict(VALID, outputs={**VALID["outputs"], "genie_space": False, "app": False})
        inst._implement_carried = lambda t: ({"notebook_path": "/W/nb", "job_id": 77, "result_rows": 40, "dashboard_id": "d1"}, _left_by(2))
        inst._implement_fill_and_preview = lambda *a: ({"status": "written", "rows_written": 12,
                                                        "job_url": "https://h/jobs/77/runs/9"}, 77, {})
        spec = dict(VALID)
    else:
        previous = dict(VALID)
        inst._implement_carried = lambda t: ({"notebook_path": "/W/nb", "job_id": 77, "last_preview_run_id": 5, "result_rows": 40,
                                              "dashboard_id": "d1", "genie_space_id": "g1", "app_name": "churn-desk"},
                                             _left_by(2, {"app": {"state": "failed", "error": "x"}}))
        inst._implement_fill_and_preview = lambda *a: pytest.fail("a retry of an output never re-runs the notebook")
        spec = dict(previous, retry_outputs=["app"])
    inst._implement_previous = lambda t: {"spec_version": 2, "spec_json": previous}
    got = inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": spec},
                                     (5150, "N01-U01", 3))
    final = inst.updates[-1]
    assert got == status and final["status"] == status and final["status_message"] == message
    assert final["asset_status"].get("decision_list") == ({"notes": [note], "spec_version": 3} if note else None)
    assert tables == ["main.inspire.churn_out"], "the check reads the use case's own business output table once"
    done = [e for e in inst.emitted if e["step_name"] == "Done"]
    assert len(done) == 1 and done[0]["status"] == "ended_success" and done[0]["message"] == "the use case is implemented"


def test_the_preview_reads_each_involved_table_under_its_swap_never_a_removed_one_once(agent_ns):
    tables = agent_ns["implement_source_tables"]
    spec = {"data": {"tables": {"main.s.orders": "`main`.`s`.`orders_v2`", "main.s.unused": "main.s.other"}, "removed_tables": ["MAIN.S.RETURNS"]}}
    assert tables(spec, ["main.s.orders", "main.s.returns", "main.s.items", "MAIN.S.ITEMS"]) == ["main.s.orders_v2", "main.s.items"]
    assert tables({}, ["main.s.items"]) == ["main.s.items"]
    assert tables(None, None) == []
    assert tables({"data": {"tables": ["bad"], "removed_tables": "main.s.items"}}, ["main.s.items"]) == ["main.s.items"]


@pytest.mark.parametrize("table,message,reason", [
    ("main.s.returns", "[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`s`.`returns` cannot be found.", "not found"),
    ("main.s.returns", "[SCHEMA_NOT_FOUND] The schema `main`.`s` cannot be found.", "not found"),
    ("main.s.returns", "[NO_SUCH_CATALOG_EXCEPTION] Catalog 'main' was not found.", "not found"),
    ("main.s.returns", "[INSUFFICIENT_PERMISSIONS] Insufficient privileges: User does not have SELECT on Table 'main.s.returns'.", "no read access"),
    ("main.s.returns", "PERMISSION_DENIED: User does not have USE SCHEMA on Schema 'main.s'", "no read access"),
    ("main.s.returns", "Statement timed out after 50 seconds", ""),
    ("main.s.returns", "Warehouse wh1 does not exist or you cannot use it: not found", ""),
    ("main.s.returns", "[TABLE_OR_VIEW_NOT_FOUND] The table or view `other`.`s`.`returns` cannot be found.", ""),
    ("main.s.returns", "[PARSE_SYNTAX_ERROR] Syntax error at or near main", ""),
    ("main.s.returns", "", ""),
    ("", "[TABLE_OR_VIEW_NOT_FOUND] cannot be found", ""),
])
def test_a_probe_error_counts_as_a_lost_table_only_when_it_says_so_and_names_that_tables_catalog(agent_ns, table, message, reason):
    assert agent_ns["implement_table_access_reason"](table, message) == reason


def test_the_lost_table_message_names_every_table_and_its_reason(agent_ns):
    assert agent_ns["implement_missing_tables_message"]([{"table": "main.s.a", "reason": "not found"},
                                                         {"table": "main.s.b", "reason": "no read access"}], "runner@example.com") == (
        "the preview cannot run because this source table is missing: main.s.a, so open Edit, Data step, and swap it for a table with "
        "the same role or remove it, and this run reads source tables as runner@example.com, which cannot read main.s.b. Ask the "
        "owner of that table to run: GRANT USE CATALOG ON CATALOG `main` TO `runner@example.com`; GRANT USE SCHEMA ON SCHEMA "
        "`main`.`s` TO `runner@example.com`; GRANT SELECT ON TABLE `main`.`s`.`b` TO `runner@example.com`")


def _probe_inspire(ns, responder, carried_status):
    inst = _inspire(ns, FakeSpark(responder=responder))
    previous = dict(VALID, outputs={**VALID["outputs"], "genie_space": False, "app": False})
    inst._implement_previous = lambda t: {"spec_version": 2, "spec_json": previous}
    inst._implement_carried = lambda t: ({"notebook_path": "/W/nb", "job_id": 77, "result_rows": 40, "dashboard_id": "d1"}, _left_by(2, carried_status))
    inst.updates = []
    inst._implement_update = lambda key, **f: inst.updates.append(f)
    inst._implement_use_case_row = lambda sid, uc: {"No": "N01-U01", "Name": "Predict churn", "genie_instruction": "Build"}
    inst._row_to_uc = lambda row: dict(row)
    inst._genie_notebook_spec = lambda uc: dict(_NB_SPEC)
    inst._genie_widget_names = lambda instruction, spec: ["result_table"]
    inst._genie_involved_tables = lambda uc: ["main.s.orders", "main.s.returns"]
    inst._implement_schedule = lambda *a: None
    inst._implement_share = lambda uc, table, spec, assets, job_id, asset_status=None, sources=(): []
    return inst


@pytest.mark.parametrize("error,reason,said", [
    ("[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`s`.`returns` cannot be found. SQLSTATE: 42P01", "not found",
     "the preview cannot run because this source table is missing: main.s.returns, so open Edit, Data step, and swap it for a table "
     "with the same role or remove it"),
    ("[INSUFFICIENT_PERMISSIONS] Insufficient privileges: User does not have SELECT on Table 'main.s.returns'.", "no read access",
     "the preview cannot run because this run reads source tables as runner@example.com, which cannot read main.s.returns. Ask the "
     "owner of that table to run: GRANT USE CATALOG ON CATALOG `main` TO `runner@example.com`; GRANT USE SCHEMA ON SCHEMA `main`.`s` "
     "TO `runner@example.com`; GRANT SELECT ON TABLE `main`.`s`.`returns` TO `runner@example.com`"),
])
def test_a_lost_source_table_stops_the_run_before_genie_or_a_preview_and_names_the_table(agent_ns, error, reason, said):
    def responder(statement):
        if statement == "SELECT * FROM `main`.`s`.`returns` LIMIT 0":
            raise RuntimeError(error)

    inst = _probe_inspire(agent_ns, responder, {"dashboard": {"state": "ready", "spec_version": 2}})
    inst._implement_runner = lambda uc: pytest.fail("no Genie work starts while a source table is lost")
    inst._implement_fill_and_preview = lambda *a: pytest.fail("no preview runs while a source table is lost")
    inst._implement_dashboard = inst._implement_genie_space = inst._implement_app = lambda c, r: pytest.fail("no output is built")
    inst._implement_builder = lambda: "runner@example.com"
    inst._implement_builder_label = lambda: "Runner"
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": dict(VALID)},
                                   (5150, "N01-U01", 3))
    assert str(raised.value) == said
    status = inst.updates[-1]["asset_status"]
    assert status["dashboard"] == {"state": "ready", "spec_version": 2}
    assert status["data"]["state"] == "failed" and status["data"]["spec_version"] == 3
    assert [(m["table"], m["reason"]) for m in status["data"]["missing_tables"]] == [("main.s.returns", reason)]
    assert error.split("]")[0] in status["data"]["missing_tables"][0]["error"]
    assert [s for s in inst.spark.statements if s.endswith("LIMIT 0")] == ["SELECT * FROM `main`.`s`.`orders_v2` LIMIT 0",
                                                                            "SELECT * FROM `main`.`s`.`returns` LIMIT 0"]


def test_an_unrelated_probe_error_lets_the_preview_go_ahead_and_the_old_lost_table_entry_is_dropped(agent_ns):
    def responder(statement):
        if statement == "SELECT * FROM `main`.`s`.`returns` LIMIT 0":
            raise RuntimeError("Py4JNetworkError: connection reset while talking to the driver")

    old = {"state": "failed", "missing_tables": [{"table": "main.s.returns", "reason": "not found", "error": "x"}], "spec_version": 2}
    inst = _probe_inspire(agent_ns, responder, {"data": old})
    inst._implement_runner = lambda uc: "runner"
    previews = []
    inst._implement_fill_and_preview = lambda *a: previews.append(a[-1]) or ({"status": "written", "rows_written": 12}, 77, {})
    inst._implement_dashboard = lambda c, r: pytest.fail("the dashboard did not change")
    inst._implement_genie_space = lambda c, r: {"genie_space_id": "g1", "genie_space_url": "https://h/genie/rooms/g1"}
    inst._implement_app = lambda c, r: {"app_name": "churn-desk", "app_url": "https://churn-desk.example", "app_health": "running"}
    got = inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": dict(VALID)},
                                     (5150, "N01-U01", 3))
    assert got == "ready" and previews == [False]
    assert "data" not in inst.updates[-1]["asset_status"]
    assert ("WARNING", "[IMPLEMENT-DATA] could not check main.s.returns, so the preview goes ahead: "
            "Py4JNetworkError: connection reset while talking to the driver") in inst.logger.records


def test_the_genie_space_records_its_sample_questions_and_the_sql_its_check_ran(agent_ns, tmp_path):
    answers = {("POST", "/api/2.0/genie/spaces"): {"space_id": "s9"},
               ("POST", "/api/2.0/genie/spaces/s9/start-conversation"): {"conversation_id": "c1", "message_id": "m1"},
               ("GET", "/api/2.0/genie/spaces/s9/conversations/c1/messages/m1"): {
                   "status": "COMPLETED", "attachments": [{"text": {"content": "12 customers"}},
                                                          {"query": {"query": "SELECT COUNT(*) FROM main.inspire.churn_out", "description": "d"}}]}}
    inst, calls = _output_inspire(agent_ns, tmp_path, answers)
    inst._implement_run_query_check = lambda sql, require_rows=False, limit=20: [] if "HAVING COUNT(*) > 1" in sql else [{"n": 1}]
    runner = _FileRunner([{"exit": 0}], [{"genie_space.json": _space(grounded=True)}])
    fields = inst._implement_genie_space(_output_context(agent_ns), runner)
    assert fields["genie_space_id"] == "s9" and fields["genie_space_url"] == "https://h/genie/rooms/s9"
    assert {k: v for k, v in fields["_asset"].items() if k != "own"} == {
        "sample_questions": ["Which customers act now?", "b"], "check_question": "Which customers act now?",
        "check_sql": "SELECT COUNT(*) FROM main.inspire.churn_out"}
    own = fields["_asset"]["own"]
    assert (own["space_id"], own["sample_questions"], own["tables"]) == ("s9", ["b", "which customers act now?"], ["main.inspire.churn_out"]), \
        "a use case's own Genie Agent records its part, so a use case that joins it later never takes that part away"
    assert calls[1][:3] == ("POST", "/api/2.0/genie/spaces/s9/start-conversation", {"content": "Which customers act now?"})


def _noted_space(notes, questions=("Which customers act now?", "b")):
    space = json.loads(_space(grounded=True))
    space["serialized_space"]["config"]["sample_questions"] = [{"question": [q]} for q in questions]
    if notes is not None:
        space["question_notes"] = notes
    return json.dumps(space)


ASKED = "Which customers act now?"
LEFT_OUT = ("the space leaves out the user's question 'Who churns next?': include it word for word as a sample question, with an "
            "example SQL that answers it")


@pytest.mark.parametrize("definition,sample,asked,notes,errors", [
    (_noted_space(None), ["a"], [], [], []),
    (_noted_space(None), [ASKED], [ASKED], [], []),
    (_noted_space(None), ["which  customers ACT now?"], [" Which customers act\nnow? "], [], []),
    (_noted_space(None), [ASKED], [ASKED, "Who churns next?", "  "], [], [LEFT_OUT]),
    (_noted_space([]), [ASKED], [ASKED], [], []),
    (_noted_space([{"question": "which customers act NOW?", "note": " Rows are stores,\n not customers. "}]), [ASKED], [ASKED],
     [{"question": ASKED, "note": "Rows are stores, not customers."}], []),
    (_noted_space([{"question": "b", "note": "rows are stores"}]), [ASKED, "b"], [ASKED], [],
     ["question_notes covers 'b', which is not one of the user's questions: rewrite that question so it asks about what the "
      "business output table holds, and leave it out of question_notes"]),
    (_noted_space([{"question": ASKED, "note": "  "}]), [ASKED], [ASKED], [],
     [f"the note for the user's question {ASKED!r} is empty: say in one sentence what its answer shows instead"]),
    (_noted_space({"question": ASKED, "note": "x"}), [ASKED], [ASKED], [],
     ['question_notes must be a list of {"question": ..., "note": ...} objects']),
    (_noted_space(["text", {"note": "x"}]), [ASKED], [ASKED], [],
     ['each question_notes entry needs a "question" and a "note"'] * 2),
    (_noted_space([{"question": ASKED, "note": "one"}, {"question": ASKED, "note": "two"}]), [ASKED], [ASKED],
     [{"question": ASKED, "note": "one"}], []),
    (_noted_space([{"question": ASKED, "note": "n" * 600}]), [ASKED], [ASKED], [{"question": ASKED, "note": "n" * 500}], []),
    ("not json", [ASKED], [ASKED, "Who churns next?"], [], [LEFT_OUT]),
    (_noted_space(None), [], None, [], []),
])
def test_the_genie_space_keeps_the_users_questions_and_notes_only_theirs(agent_ns, definition, sample, asked, notes, errors):
    assert agent_ns["implement_genie_question_problems"](definition, sample, asked) == (notes, errors)


def _question_inspire(agent_ns, tmp_path):
    answers = {("POST", "/api/2.0/genie/spaces"): {"space_id": "s9"},
               ("POST", "/api/2.0/genie/spaces/s9/start-conversation"): {"conversation_id": "c1", "message_id": "m1"},
               ("GET", "/api/2.0/genie/spaces/s9/conversations/c1/messages/m1"): {
                   "status": "COMPLETED", "attachments": [{"query": {"query": "SELECT 1 FROM main.inspire.churn_out", "description": "d"}}]}}
    inst, calls = _output_inspire(agent_ns, tmp_path, answers)
    inst._implement_run_query_check = lambda sql, require_rows=False, limit=20: [] if "HAVING COUNT(*) > 1" in sql else [{"n": 1}]
    return inst, calls


def test_a_users_question_the_results_cannot_answer_is_kept_and_reported(agent_ns, tmp_path):
    inst, calls = _question_inspire(agent_ns, tmp_path)
    note = "The rows are anchor items, so it counts anchor items in each tier."
    runner = _FileRunner([{"exit": 0}], [{"genie_space.json": _noted_space([{"question": ASKED, "note": note}])}])
    fields = inst._implement_genie_space(_output_context(agent_ns, genie_questions=[ASKED]), runner)
    assert "question_notes" in runner.prompts[0] and "still goes in word for word" in runner.prompts[0]
    assert fields["_asset"]["question_notes"] == [{"question": ASKED, "note": note}]
    assert fields["_warnings"] == [f"Genie Agent: your question {ASKED!r} asks about something the results do not hold, so the "
                                   f"space answers it with what they hold: {note}"]
    plain = _FileRunner([{"exit": 0}], [{"genie_space.json": _noted_space(None)}])
    fields = inst._implement_genie_space(_output_context(agent_ns, genie_questions=[ASKED]), plain)
    assert "question_notes" not in fields["_asset"] and fields["_warnings"] == []
    own = _FileRunner([{"exit": 0}], [{"genie_space.json": _noted_space(None)}])
    inst._implement_genie_space(_output_context(agent_ns), own)
    assert "question_notes" not in own.prompts[0] and "about what the business output table's rows are" in own.prompts[0]


def test_a_space_that_leaves_out_a_users_question_goes_back_to_genie_before_it_is_created(agent_ns, tmp_path):
    inst, calls = _question_inspire(agent_ns, tmp_path)
    runner = _FileRunner([{"exit": 0}, {"exit": 0}],
                         [{"genie_space.json": _noted_space(None, questions=("b",))}, {"genie_space.json": _noted_space(None)}])
    fields = inst._implement_genie_space(_output_context(agent_ns, genie_questions=[ASKED]), runner)
    assert fields["genie_space_id"] == "s9" and len(runner.prompts) == 2
    assert f"the space leaves out the user's question {ASKED!r}" in runner.prompts[1]
    assert [c[:2] for c in calls].count(("POST", "/api/2.0/genie/spaces")) == 1


def test_a_question_note_makes_the_run_ready_with_warnings_and_is_recorded_on_the_space(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    previous = dict(VALID, outputs={**VALID["outputs"], "genie_space": False, "app": False})
    inst._implement_previous = lambda t: {"spec_version": 2, "spec_json": previous}
    inst._implement_carried = lambda t: ({"notebook_path": "/W/nb", "job_id": 77, "result_rows": 40, "dashboard_id": "d1"}, _left_by(2))
    inst.updates = []
    inst._implement_update = lambda key, **f: inst.updates.append(f)
    inst._implement_use_case_row = lambda sid, uc: {"No": "N01-U01", "Name": "Predict churn", "genie_instruction": "Build"}
    inst._row_to_uc = lambda row: dict(row)
    inst._genie_notebook_spec = lambda uc: dict(_NB_SPEC)
    inst._genie_widget_names = lambda instruction, spec: ["result_table"]
    inst._genie_involved_tables = lambda uc: ["main.s.orders"]
    inst._implement_runner = lambda uc: "runner"
    inst._implement_fill_and_preview = lambda *a: ({"status": "written", "rows_written": 12}, 77, {})
    inst._implement_schedule = lambda *a: pytest.fail("an outputs change leaves the schedule alone")
    inst._implement_dashboard = lambda c, r: pytest.fail("the dashboard did not change")
    warning = f"Genie Agent: your question {ASKED!r} asks about something the results do not hold, so the space answers it with what they hold: n"
    inst._implement_genie_space = lambda c, r: {"genie_space_id": "g1", "genie_space_url": "https://h/genie/rooms/g1",
                                                "_asset": {"sample_questions": [ASKED], "question_notes": [{"question": ASKED, "note": "n"}]},
                                                "_warnings": [warning]}
    inst._implement_app = lambda c, r: {"app_name": "churn-desk", "app_url": "https://churn-desk.example", "app_health": "running"}
    inst._implement_share = lambda uc, table, spec, assets, job_id, asset_status=None, sources=(): []
    got = inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": dict(VALID)},
                                     (5150, "N01-U01", 3))
    assert got == "ready_with_warnings"
    assert not any(k.startswith("_") for update in inst.updates for k in update)
    assert inst.updates[-1]["status_message"] == warning
    assert inst.updates[-1]["asset_status"]["genie_space"]["question_notes"] == [{"question": ASKED, "note": "n"}]
    assert inst.updates[-1]["asset_status"]["genie_space"]["warnings"] == [warning.removeprefix("Genie Agent: ")]
    assert "warnings" not in inst.updates[-1]["asset_status"]["app"]


CHURN_UC = {"result_table": "main.inspire.churn_out"}
KEY_COUNTS_SQL = ("SELECT COUNT(*) AS row_count, COUNT(as_of_date) AS dated_rows, COUNT_IF(use_case_id = :uc) AS own_rows, "
                  "COUNT_IF(is_current AND change_source = 'run') AS current_rows FROM `main`.`inspire`.`churn_out` WHERE run_id = :rid")
DROP_UNDATED_SQL = "DELETE FROM `main`.`inspire`.`churn_out` WHERE use_case_id = :uc AND as_of_date IS NULL"
CHURN_DESCRIBE = "DESCRIBE TABLE `main`.`inspire`.`churn_out`"
CHURN_COLUMNS = [{"col_name": name, "data_type": "string"} for name in ("as_of_date", "entity_id", "run_id", "use_case_id", "record_key",
                                                                         "valid_from", "valid_to", "is_current", "change_source",
                                                                         "changed_by")]


def _with_history(responder):
    return lambda s: CHURN_COLUMNS if s == CHURN_DESCRIBE else responder(s)


def _key_spark(counts):
    return FakeSpark(responder=_with_history(lambda s: [dict(counts, current_rows=counts["row_count"])] if s == KEY_COUNTS_SQL else []))


def test_the_preview_run_skips_the_alert_task_and_keeps_full_as_the_jobs_default(agent_ns):
    inst = _inspire(agent_ns, _key_spark({"row_count": 12, "dated_rows": 12, "own_rows": 12}))
    inst.updates = []
    inst._implement_update = lambda key, **f: inst.updates.append(f)
    seen = {}

    class Launcher(agent_ns["JobLauncher"]):
        def launch(self, **kwargs):
            seen.update(kwargs, base=dict(self.widget_key_values))
            return {"success": True, "job_id": 77, "run_id": 5, "job_url": "u"}

        def wait_for_run(self, run_id, timeout_s=0, poll_s=0, out=None):
            return {"status": "SUCCESS", "output": "wrote 12 rows for as_of_date 2026-10-01 with run_id 0123abcd-0000"}

    inst._job_launcher_cls = Launcher
    outcome, job_id, run_id = inst._implement_preview("N01-U01", (5150, "N01-U01", 1), CHURN_UC, _spec(agent_ns)[0],
                                                      {"job_tags": {}, "job_slug": "churn", "schedule_cron": None}, "/W/nb",
                                                      ["result_table", "top_k", "run_profile"])
    assert seen["only_tasks"] == ["inspire_task"] and seen["run_parameters"]["run_profile"] == "preview"
    assert seen["base"]["run_profile"] == "full"
    assert outcome["status"] == "written" and outcome["rows_written"] == 12 and (job_id, run_id) == (77, 5)
    assert outcome["job_url"] == "u", "the preview's run link travels with its outcome so a warning can point at the run"
    assert KEY_COUNTS_SQL in inst.spark.statements, "a written preview is read back from the business output table"
    assert inst.spark.statements.index(DROP_UNDATED_SQL) > inst.spark.statements.index(KEY_COUNTS_SQL)

    class Refused(Launcher):
        def launch(self, **kwargs):
            return {"success": False, "job_id": 77, "run_id": None, "error": "the Jobs API started no run for job 77: {}"}

    inst._job_launcher_cls = Refused
    outcome, job_id, run_id = inst._implement_preview("N01-U01", (5150, "N01-U01", 1), CHURN_UC, _spec(agent_ns)[0],
                                                      {"job_tags": {}, "job_slug": "churn", "schedule_cron": None}, "/W/nb",
                                                      ["result_table", "top_k", "run_profile"])
    assert outcome == {"status": "failed", "launched": False, "error": "the job could not start: the Jobs API started no run for job 77: {}"}
    assert (job_id, run_id) == (77, None)


def test_a_preview_that_wrote_a_date_key_instead_of_a_date_fails_with_what_to_fix(agent_ns):
    inst = _inspire(agent_ns, _key_spark({"row_count": 10000, "dated_rows": 0, "own_rows": 10000}))
    inst.updates = []
    inst._implement_update = lambda key, **f: inst.updates.append(f)

    class Launcher(agent_ns["JobLauncher"]):
        def launch(self, **kwargs):
            return {"success": True, "job_id": 77, "run_id": 5, "job_url": "u"}

        def wait_for_run(self, run_id, timeout_s=0, poll_s=0, out=None):
            return {"status": "SUCCESS", "output": "wrote 10000 rows for as_of_date 2452642 with run_id 1e860fca-a09a-4b4a-a1ac-4d012bf10a1f"}

    inst._job_launcher_cls = Launcher
    outcome, _job, _run = inst._implement_preview("N05-U01", (5150, "N05-U01", 1), CHURN_UC, _spec(agent_ns)[0],
                                                  {"job_tags": {}, "job_slug": "basket", "schedule_cron": None}, "/W/nb",
                                                  ["result_table", "run_profile"])
    assert outcome["status"] == "failed" and "launched" not in outcome
    assert outcome["error"].startswith("the run wrote 10,000 rows that Inspire cannot accept: run_use_case() returned as_of_date "
                                       "2452642, which is not a calendar date (YYYY-MM-DD)")
    assert "join that table to read the date" in outcome["error"]
    assert ("of the 10,000 rows of run 1e860fca-a09a-4b4a-a1ac-4d012bf10a1f, 10,000 have no as_of_date, so the change history cannot "
            "say which run date such a row belongs to") in outcome["error"]
    ended = [e for e in inst.emitted if e["step_name"] == "Preview run" and e["status"] != "started"]
    assert len(ended) == 1 and ended[0]["status"] == "ended_error" and ended[0]["message"] == outcome["error"][:1500]
    assert DROP_UNDATED_SQL not in inst.spark.statements, "a run Inspire rejects removes nothing"
    assert any(level == "WARNING" and msg.startswith("[IMPLEMENT-KEYS] N05-U01: run_use_case() returned as_of_date 2452642")
               for level, msg in inst.logger.records)


def test_a_preview_with_broken_keys_goes_back_to_genie_with_what_to_fix(agent_ns):
    inst = _flow_inspire(agent_ns, [])
    del inst._implement_preview
    counts = [{"row_count": 40, "dated_rows": 0, "own_rows": 40, "current_rows": 40},
              {"row_count": 40, "dated_rows": 40, "own_rows": 40, "current_rows": 40}]
    inst.spark = FakeSpark(responder=_with_history(lambda s: [counts.pop(0)] if s == KEY_COUNTS_SQL else []))
    outputs = ["wrote 40 rows for as_of_date 2452642 with run_id 0123abcd-0001",
               "wrote 40 rows for as_of_date 2026-10-01 with run_id 0123abcd-0002"]

    class Launcher(agent_ns["JobLauncher"]):
        def launch(self, **kwargs):
            return {"success": True, "job_id": 11, "run_id": 100 + len(outputs), "job_url": "u"}

        def wait_for_run(self, run_id, timeout_s=0, poll_s=0, out=None):
            return {"status": "SUCCESS", "output": outputs.pop(0)}

    inst._job_launcher_cls = Launcher
    runner = _FakeRunner([{"exit": 0, "final": _fill()}, {"exit": 0, "final": _fill()}])
    outcome, job_id, _f = inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), CHURN_UC,
                                                           agent_ns["validate_implement_spec"](VALID)[0], None, "/W/nb",
                                                           ["result_table", "run_profile"], runner, True)
    assert outcome["status"] == "written" and outcome["as_of_date"] == "2026-10-01" and job_id == 11
    assert len(runner.prompts) == 2 and not counts and not outputs
    assert "returned as_of_date 2452642, which is not a calendar date (YYYY-MM-DD)" in runner.prompts[1]
    assert "of the 40 rows of run 0123abcd-0001, 40 have no as_of_date" in runner.prompts[1]
    reads = [i for i, s in enumerate(inst.spark.statements) if s == KEY_COUNTS_SQL]
    assert inst.spark.statements.count(DROP_UNDATED_SQL) == 1 and inst.spark.statements.index(DROP_UNDATED_SQL) > reads[1], \
        "only the accepted preview removes the rows the rejected one left without a date"


@pytest.mark.parametrize("as_of,counts,needles", [
    ("2026-10-01", {"row_count": 12, "dated_rows": 12, "own_rows": 12, "current_rows": 12}, []),
    ("2026-10-01T00:00:00", {"row_count": 12, "dated_rows": 12, "own_rows": 12, "current_rows": 12}, []),
    ("2026-10-01 00:00:00.000", {"row_count": 12, "dated_rows": 12, "own_rows": 12, "current_rows": 12}, []),
    ("None", {"row_count": 12, "dated_rows": 0, "own_rows": 12, "current_rows": 12},
     ["returned as_of_date None, which is not a calendar date", "of the 12 rows of run r-1, 12 have no as_of_date"]),
    ("", {"row_count": 12, "dated_rows": 12, "own_rows": 12, "current_rows": 12}, ["returned as_of_date (empty), which is not a calendar date"]),
    ("20261001", {"row_count": 12, "dated_rows": 12, "own_rows": 12, "current_rows": 12}, ["returned as_of_date 20261001, which is not a calendar date"]),
    ("2026-10-01", {"row_count": 0, "dated_rows": 0, "own_rows": 0, "current_rows": 0},
     ["the business output table main.inspire.churn_out holds no row with run_id r-1, although run_use_case() said it wrote "
      "12 rows"]),
    ("2026-10-01", {"row_count": 12, "dated_rows": 12, "own_rows": 9, "current_rows": 12}, ["of the 12 rows of run r-1, 3 carry a use_case_id other than N01-U01"]),
])
def test_written_key_problems_name_each_broken_key(agent_ns, as_of, counts, needles):
    problems = agent_ns["implement_written_key_problems"]({"rows_written": 12, "as_of_date": as_of, "run_id": "r-1"}, "N01-U01", counts,
                                                          "main.inspire.churn_out")
    assert len(problems) == len(needles), problems
    for needle in needles:
        assert any(needle in problem for problem in problems), (needle, problems)


DEFAULT_TABLE = "main.inspire._inspire_n01_u01_predict_churn"


def test_the_instruction_is_retargeted_to_the_table_the_wizard_chose(agent_ns):
    retarget = agent_ns["implement_retarget_instruction"]
    text = (f"| `result_table` | text | `{DEFAULT_TABLE}` | any | Business output table |\n"
            f"| `model_name` | text | `{DEFAULT_TABLE}_model` | any | Unity Catalog model name |\n"
            f"Decisions land in `main`.`inspire`.`_inspire_n01_u01_predict_churn_actions`; write to `MAIN.Inspire.{DEFAULT_TABLE.split('.')[-1]}`.\n"
            f"Leave {DEFAULT_TABLE}_history, {DEFAULT_TABLE}_model_v2, other.{DEFAULT_TABLE} and {DEFAULT_TABLE}2 alone.")
    got = retarget(text, "`main`.`inspire`.`_inspire_n01_u01_predict_churn`", "main.inspire.churn_out")
    assert got == ("| `result_table` | text | `main.inspire.churn_out` | any | Business output table |\n"
                   "| `model_name` | text | `main.inspire.churn_out_model` | any | Unity Catalog model name |\n"
                   "Decisions land in `main`.`inspire`.`churn_out_actions`; write to `main.inspire.churn_out`.\n"
                   f"Leave {DEFAULT_TABLE}_history, {DEFAULT_TABLE}_model_v2, other.{DEFAULT_TABLE} and {DEFAULT_TABLE}2 alone.")
    assert agent_ns["inspire_output_names"]("main.inspire.churn_out")["model_name"] in got, "the model name follows the table as Inspire derives it"
    assert agent_ns["inspire_table_name"]("main.inspire.churn_out", "_actions") in got, "the decisions table follows the table as Inspire derives it"
    assert retarget(text, DEFAULT_TABLE, DEFAULT_TABLE.upper()) == text, "the same table in other letters is not a change"
    assert retarget("", DEFAULT_TABLE, "main.inspire.churn_out") == ""
    with pytest.raises(ValueError, match="catalog.schema.table"):
        retarget(text, DEFAULT_TABLE, "churn_out")


def test_the_result_table_of_a_use_case_is_its_own_or_the_default_inspire_names(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    assert inst._genie_result_table({"No": "N01-U01", "Name": "Predict churn", "result_table": "a.b.c"}) == "a.b.c"
    assert inst._genie_result_table({"No": "N01-U01", "Name": "Predict churn"}) == agent_ns["compute_result_table_name"](
        "N01-U01", "Predict churn", "", inspire_database="main.inspire", session_id=5150) == \
        "`main`.`inspire`.`_inspire_n01_u01_predict_churn_s5150`"
    assert inst._genie_result_table({"No": "N01-U01", "Name": "Predict churn", "result_table": "churn_out"}) == \
        "`main`.`inspire`.`_inspire_n01_u01_predict_churn_s5150`", "a name that is not catalog.schema.table falls back to the default"
    other = _inspire(agent_ns, FakeSpark())
    other.session_id = 2222222222222222222
    assert other._genie_result_table({"No": "N01-U01", "Name": "Predict churn"}) == \
        "`main`.`inspire`.`_inspire_n01_u01_predict_churn_s2222222222222222222`", \
        "the same use case id and name in another Discover session never shares the default table"


def test_the_default_result_table_carries_the_session_and_keeps_it_when_the_name_is_cut(agent_ns):
    name = agent_ns["compute_result_table_name"]
    assert name("N01-U01", "Predict churn", "", "cat.sch") == "`cat`.`sch`.`_inspire_n01_u01_predict_churn`"
    for blank in (None, "", "abc", " "):
        assert name("N01-U01", "Predict churn", "", "cat.sch", session_id=blank) == "`cat`.`sch`.`_inspire_n01_u01_predict_churn`"
    long = name("N01-U01", "x" * 400, "", "cat.sch", session_id=2222222222222222222)
    table = long.split(".")[-1].strip("`")
    assert len(table) == 200 and table.endswith("_s2222222222222222222"), "the session survives the 200 character cap"


def test_a_build_that_writes_the_missing_instruction_uses_the_wizards_table_everywhere(agent_ns, sdk_stub):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_previous = lambda t: None
    inst._implement_carried = lambda t: ({}, {})
    inst.updates = []
    inst._implement_update = lambda key, **f: inst.updates.append(f)
    inst._implement_use_case_row = lambda sid, uc: {"No": "N01-U01", "Name": "Predict churn", "genie_instruction": "", "session_id": 5150}
    inst._row_to_uc = lambda row: dict(row)
    written = {"No": "N01-U01", "Name": "Predict churn", "result_table": DEFAULT_TABLE, "_source_session_id": 5150,
               "genie_instruction": f"| `result_table` | text | `{DEFAULT_TABLE}` | any | Business output table |\n"
                                    f"| `model_name` | text | `{DEFAULT_TABLE}_model` | any | Unity Catalog model name |"}
    inst._implement_write_instruction = lambda row, uc: dict(written)
    seen = {}

    def keep(name, value, result=None):
        seen[name] = json.loads(json.dumps(value))
        return result

    inst._genie_notebook_spec = lambda uc: keep("notebook_spec", uc, dict(_NB_SPEC))
    inst._genie_instruction_widgets = lambda text: keep("widgets_from", text, [])
    inst._genie_widget_names = lambda instruction, spec: ["result_table"]
    inst._genie_involved_tables = lambda uc: ["main.s.orders"]
    inst._implement_missing_tables = lambda tables: []
    inst._implement_runner = lambda uc: "runner"
    inst._implement_claim_notebook = lambda use_case, spec, key, asset_status, current="": "/W/nb"
    inst._implement_write_notebook = lambda use_case, spec, previous, key, current="": keep("notebook", use_case, "/W/nb")
    inst._implement_notebook_modified_at = lambda path: "2026-10-26T06:20:00Z"
    inst._implement_fill_and_preview = lambda uc_id, key, use_case, *a: keep("preview", use_case,
                                                                             ({"status": "written", "rows_written": 12}, 77, {}))
    inst._implement_tier_warning = lambda uc_id, table, url, run_id=None: keep("tiers", table, "")
    inst._implement_dashboard = lambda c, r: keep("dashboard", c["result_table"], {"dashboard_id": "d1", "dashboard_url": "https://h/d"})
    inst._implement_genie_space = lambda c, r: {"genie_space_id": "g1", "genie_space_url": "https://h/genie/rooms/g1"}
    inst._implement_app = lambda c, r: {"app_name": "churn-desk", "app_url": "https://churn-desk.example", "app_health": "running"}
    inst._implement_schedule = lambda *a: None
    inst._implement_share = lambda uc, table, spec, assets, job_id, asset_status=None, sources=(): keep("shared", table, [])
    got = inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 1, "spec_json": dict(VALID)},
                                     (5150, "N01-U01", 1))
    assert got == "ready", inst.updates[-1]
    chosen = VALID["config"]["result_table"]
    for name in ("notebook_spec", "notebook", "preview"):
        assert seen[name]["result_table"] == chosen, f"{name} reads {seen[name]['result_table']}"
    for name in ("notebook", "preview"):
        assert DEFAULT_TABLE not in seen[name]["genie_instruction"], f"{name} still names the table the instruction was written for"
        assert f"`{chosen}`" in seen[name]["genie_instruction"] and f"`{chosen}_model`" in seen[name]["genie_instruction"]
    assert DEFAULT_TABLE not in seen["widgets_from"], "the widgets read from the instruction default to the wizard's table"
    assert seen["tiers"] == seen["dashboard"] == seen["shared"] == chosen, "every output and every check reads the table the run writes"


def test_a_preview_whose_rows_cannot_be_read_back_is_not_accepted(agent_ns):
    def broken(statement):
        if statement == KEY_COUNTS_SQL:
            raise RuntimeError("[TABLE_OR_VIEW_NOT_FOUND] main.inspire.churn_out")
        return []

    inst = _inspire(agent_ns, FakeSpark(responder=_with_history(broken)))
    got = inst._implement_checked_outcome("N01-U01", CHURN_UC, {"status": "written", "rows_written": 12, "as_of_date": "2026-10-01",
                                                                "run_id": "r-1"})
    assert got["status"] == "failed"
    assert got["error"] == ("the run wrote 12 rows that Inspire cannot accept: Inspire could not read run r-1 back from "
                            "main.inspire.churn_out: [TABLE_OR_VIEW_NOT_FOUND] main.inspire.churn_out")
    assert DROP_UNDATED_SQL not in inst.spark.statements
    ok = _inspire(agent_ns, _key_spark({"row_count": 12, "dated_rows": 12, "own_rows": 12}))
    written = {"status": "written", "rows_written": 12, "as_of_date": "2026-10-01", "run_id": "r-1"}
    assert ok._implement_checked_outcome("N01-U01", CHURN_UC, dict(written)) == written
    assert not any("[IMPLEMENT-KEYS]" in msg for _level, msg in ok.logger.records), "removing nothing logs nothing"


def test_an_accepted_preview_removes_this_use_cases_rows_without_an_as_of_date(agent_ns):
    def respond(statement):
        if statement == KEY_COUNTS_SQL:
            return [{"row_count": 10000, "dated_rows": 10000, "own_rows": 10000, "current_rows": 10000}]
        if statement == DROP_UNDATED_SQL:
            return [{"num_affected_rows": 60000}]
        return []

    inst = _inspire(agent_ns, FakeSpark(responder=_with_history(respond)))
    written = {"status": "written", "rows_written": 10000, "as_of_date": "2003-01-02", "run_id": "r-7"}
    assert inst._implement_checked_outcome("N05-U01", CHURN_UC, dict(written)) == written
    assert ("WARNING", "[IMPLEMENT-KEYS] N05-U01: removed 60,000 rows without an as_of_date from main.inspire.churn_out: notebook "
            "versions that did not write the date left them, and no later run can replace them") in inst.logger.records

    def locked(statement):
        if statement == DROP_UNDATED_SQL:
            raise RuntimeError("PERMISSION_DENIED: User does not have MODIFY on Table main.inspire.churn_out")
        return respond(statement)

    denied = _inspire(agent_ns, FakeSpark(responder=_with_history(locked)))
    assert denied._implement_checked_outcome("N05-U01", CHURN_UC, dict(written)) == written, "a cleanup that fails never fails the run"
    assert any(level == "WARNING" and msg.startswith("[IMPLEMENT-KEYS] N05-U01: could not remove the rows without an as_of_date from "
                                                     "main.inspire.churn_out: ") for level, msg in denied.logger.records)


def test_the_job_launcher_reads_the_notebook_task_of_a_two_task_run(agent_ns):
    pick = agent_ns["JobLauncher"]._task_run_id
    two = types.SimpleNamespace(run_id=1, tasks=[types.SimpleNamespace(task_key="inspire_alert", run_id=3),
                                                 types.SimpleNamespace(task_key="inspire_task", run_id=2)])
    assert pick(two) == 2 and pick(two, "inspire_alert") == 3
    assert pick(types.SimpleNamespace(run_id=1, tasks=[types.SimpleNamespace(task_key="other", run_id=4)])) == 4
    assert pick(types.SimpleNamespace(run_id=1, tasks=[])) == 1


def test_a_removed_table_validates_reaches_genie_and_is_a_data_change(agent_ns):
    spec, errors = _spec(agent_ns, data={**VALID["data"], "removed_tables": ["`main`.`s`.`returns`", "main.s.returns", "main.s.web"]})
    assert errors == [] and spec["data"]["removed_tables"] == ["main.s.returns", "main.s.web"]
    text = agent_ns["implement_choices_markdown"](spec)
    assert "- Do not read `main.s.returns`: the user removed it from this use case." in text
    assert agent_ns["classify_implement_change"](_spec(agent_ns)[0], spec) == ["data"]
    assert _spec(agent_ns)[0]["data"]["removed_tables"] == []


@pytest.mark.parametrize("data,needle", [
    ({"removed_tables": ["returns"]}, "removed table 'returns' must be catalog.schema.table"),
    ({"tables": {"main.s.orders": "main.s.orders_v2"}, "removed_tables": ["main.s.orders"]}, "cannot be swapped and removed at once"),
    ({"column_roles": {"segment": "main.s.returns.region"}, "removed_tables": ["main.s.returns"]},
     "the segment column main.s.returns.region is in a table you removed"),
    ({"filters": [{"table": "main.s.returns", "column": "region", "op": "=", "values": ["EU"]}], "removed_tables": ["main.s.returns"]},
     "the filter on main.s.returns.region reads a table you removed"),
])
def test_a_removal_that_breaks_the_spec_is_rejected(agent_ns, data, needle):
    errors = _spec(agent_ns, data={"tables": {}, "filters": [], **data})[1]
    assert any(needle in e for e in errors), errors


def test_removal_problems_protect_the_primary_table_and_keep_one_table(agent_ns):
    problems = agent_ns["implement_removed_table_problems"]
    involved = ["main.s.orders", "main.s.returns", "main.s.web"]
    spec = lambda *removed: {"data": {"removed_tables": list(removed)}}
    assert problems(spec(), involved, "main.s.orders") == []
    assert problems(spec("main.s.returns"), involved, "main.s.orders") == []
    assert problems(spec("main.s.orders"), involved, "`main`.`s`.`orders`") == [
        "main.s.orders is the primary table of this use case; swap it instead of removing it"]
    assert problems(spec("main.s.other"), involved, "") == ["main.s.other is not among the tables of this use case"]
    assert "every table of this use case was removed; keep at least one" in problems(spec(*involved), involved, "")
    assert problems({}, involved, "main.s.orders") == []


def test_removing_the_primary_table_stops_the_run_before_any_build(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_previous = lambda t: None
    inst._implement_carried = lambda t: ({}, {})
    inst.updates = []
    inst._implement_update = lambda key, **f: inst.updates.append(f)
    inst._implement_emit = lambda *a, **k: None
    inst._implement_use_case_row = lambda sid, uc: {"No": "N01-U01", "Primary Table": "main.s.orders", "genie_instruction": "Build"}
    inst._row_to_uc = lambda row: dict(row)
    inst._genie_involved_tables = lambda uc: ["main.s.orders", "main.s.returns"]
    inst._implement_write_notebook = lambda *a: pytest.fail("a blocked removal never writes the notebook")
    inst._implement_runner = lambda uc: pytest.fail("a blocked removal never starts Genie")
    spec = dict(VALID, data={"tables": {}, "filters": [], "removed_tables": ["main.s.orders"]})
    with pytest.raises(agent_ns["ImplementBlocked"], match="main.s.orders is the primary table of this use case"):
        inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 1, "spec_json": spec},
                                   (5150, "N01-U01", 1))


def test_outputs_may_not_read_a_removed_table(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    previous = dict(VALID, data={"tables": {}, "filters": [], "removed_tables": ["main.s.returns"]},
                    outputs={"dashboard": True, "inspire_url": VALID["outputs"]["inspire_url"]})
    inst._implement_previous = lambda t: {"spec_version": 1, "spec_json": previous}
    inst._implement_carried = lambda t: ({"notebook_path": "/W/nb", "job_id": 77, "last_preview_run_id": 5, "dashboard_id": "d1"},
                                         _left_by(1, {"dashboard": {"state": "failed", "error": "x"}}))
    inst.updates = []
    inst._implement_update = lambda key, **f: inst.updates.append(f)
    inst._implement_emit = lambda *a, **k: None
    inst._implement_use_case_row = lambda sid, uc: {"No": "N01-U01", "Primary Table": "main.s.orders", "genie_instruction": "Build"}
    inst._row_to_uc = lambda row: dict(row)
    inst._genie_notebook_spec = lambda uc: dict(_NB_SPEC)
    inst._genie_widget_names = lambda instruction, spec: ["result_table"]
    inst._genie_involved_tables = lambda uc: ["main.s.orders", "main.s.returns"]
    inst._implement_runner = lambda uc: object()
    inst._implement_schedule = lambda *a: None
    inst._implement_share = lambda *a, **k: []
    seen = []
    inst._implement_dashboard = lambda context, runner: seen.append(list(context["allowed"])) or {"dashboard_id": "d2"}
    status = inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 2,
                                         "spec_json": dict(previous, retry_outputs=["dashboard"])}, (5150, "N01-U01", 2))
    assert status == "ready"
    assert seen == [["main.inspire.churn_out", "main.s.orders", "main.inspire.churn_out_reasons"]]


def _merged(base, patch):
    out = json.loads(json.dumps(base))
    for key, value in patch.items():
        out[key] = _merged(out[key], value) if isinstance(value, dict) and isinstance(out.get(key), dict) else value
    return out


def test_every_shared_invalid_case_is_rejected_with_the_shared_message(agent_ns):
    fixture = json.load(open(FIXTURE))
    base = next(c for c in fixture["cases"] if c["name"] == "first submission")["current"]
    assert agent_ns["validate_implement_spec"](base)[1] == []
    for case in fixture["invalid"]:
        errors = agent_ns["validate_implement_spec"](_merged(base, case["patch"]))[1]
        assert any(case["error"] in e for e in errors), (case["name"], errors)


PARITY = os.path.join(os.path.dirname(FIXTURE), "implement_spec_parity.json")
NOTEBOOK_PARITY = os.path.join(os.path.dirname(FIXTURE), "implement_notebook_parity.json")


def _spec_leaves(value, path=()):
    if isinstance(value, dict) and value:
        for key, item in value.items():
            yield from _spec_leaves(item, path + (key,))
    elif isinstance(value, list) and value:
        for index, item in enumerate(value):
            yield from _spec_leaves(item, path + (index,))
    else:
        yield path, json.dumps(value)


def _with_edits(spec, edits):
    spec = copy.deepcopy(spec)
    for path, value in edits:
        node = spec
        for key in path[:-1]:
            node = node[key]
        node[path[-1]] = copy.deepcopy(value)
    return spec


def test_the_validator_gives_the_app_s_errors_and_cleaned_spec_on_every_parity_case(agent_ns):
    with open(PARITY) as handle:
        parity = json.load(handle)
    validate = agent_ns["validate_implement_spec"]
    clean, errors = validate(parity["base"])
    assert errors == []
    base = dict(_spec_leaves(parity["clean"]))
    assert dict(_spec_leaves(clean)) == base
    assert len(parity["cases"]) >= 400
    for case in parity["cases"]:
        clean, errors = validate(_with_edits(parity["base"], case["set"]))
        removed = {tuple(path) for path in case["removed"]}
        expected = {path: value for path, value in base.items() if path not in removed}
        expected.update((tuple(path), json.dumps(value)) for path, value in case["changes"])
        assert sorted(errors) == case["errors"], case["name"]
        assert dict(_spec_leaves(clean)) == expected, case["name"]


def test_the_contract_tables_are_the_ones_the_app_holds(agent_ns):
    with open(FIXTURE) as handle:
        tables = json.load(handle)["contract_tables"]
    assert "IMPLEMENT_OUTPUT_OPTIONS" in tables and "IMPLEMENT_ALERT_BASELINE_DIRECTIONS" in tables
    for name, value in tables.items():
        mine = agent_ns[name]
        if isinstance(mine, re.Pattern):
            mine = mine.pattern
        elif name == "IMPLEMENT_ALERT_OPERATORS":
            mine = list(mine)
        assert json.loads(json.dumps(mine)) == value, name


def test_removal_problems_match_the_shared_cases(agent_ns):
    for case in json.load(open(FIXTURE))["removal"]:
        got = agent_ns["implement_removed_table_problems"]({"data": {"removed_tables": case["removed"]}}, case["involved"], case["primary"])
        assert got == case["problems"], case["name"]


def test_use_case_tables_match_the_shared_cases(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    for case in json.load(open(FIXTURE))["table_names"]:
        use_case = {"Tables Involved": case["tables_involved"], "Primary Table": case["primary_table"]}
        assert inst._genie_involved_tables(use_case) == case["names"], case


def test_cron_problems_match_the_shared_cases(agent_ns):
    crons = json.load(open(FIXTURE))["crons"]
    for cron in crons["valid"]:
        assert agent_ns["implement_cron_problem"](cron) == "", cron
    for cron, problem in crons["invalid"]:
        assert agent_ns["implement_cron_problem"](cron) == problem, cron


def test_widget_ranges_match_the_shared_cases(agent_ns):
    ranges = json.load(open(FIXTURE))["widget_ranges"]
    for text, rule, printed in ranges["allowed"]:
        got = agent_ns["genie_allowed_rule"](text)
        assert got == (None if rule is None else (rule["low"], rule["high"], rule["whole"], rule["lowOpen"], rule["highOpen"])), text
        if rule is not None:
            assert agent_ns["genie_allowed_text"](got) == printed, text
    for name, value, allowed, problem in ranges["values"]:
        assert agent_ns["genie_widget_value_problem"](name, value, allowed) == problem, (name, value, allowed)
    for case in ranges["problems"]:
        assert agent_ns["implement_widget_problems"](case["widgets"], case["values"]) == case["problems"], case["name"]


def test_shared_names_match_the_agent(agent_ns):
    from v120_genie_support import build_inspire, make_uc
    fixture = json.load(open(FIXTURE))
    thresholds = {key for values in agent_ns["GENIE_READINESS_THRESHOLDS"].values() for key in values}
    assert fixture["widget_groups"]["threshold_names"] == sorted(thresholds)
    tiers = {"currency", *agent_ns["INSPIRE_TIER_AMOUNTS"], *(f"{name}_share" for name in agent_ns["INSPIRE_TIER_SHARES"])}
    assert fixture["widget_groups"]["tier_widgets"] == sorted(tiers)
    assert set(fixture["result_key_columns"]) <= {name for name, _type in agent_ns["INSPIRE_CORE_COLUMNS"]}
    assert fixture["model_families"] == list(agent_ns["INSPIRE_MODEL_FAMILIES"])
    families = agent_ns["GENIE_FAMILY_SPECS"]
    patterns = {family: text.splitlines()[0] for text, family in fixture["execution_patterns"] if family}
    assert set(patterns) == set(families)
    assert all(line == f"Execution pattern: family {f}, {families[f]['label']}." for f, line in patterns.items())
    inst = build_inspire(agent_ns)
    for technique, family in (("Forecasting", "E"), ("Predictive Modeling", "A"), ("Anomaly Detection", "B")):
        mandate = inst._build_code_structure_mandate(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique})))
        assert mandate.splitlines()[0] == patterns[family], technique
    for case in fixture["app_owner_tags"]:
        owner = make_inspire(agent_ns, spark=FakeSpark(), session_id=int(case["session_id"]))
        assert owner._implement_app_owner_tag(case["use_case_id"]) == case["tag"]
    assert agent_ns["JobLauncher"].TASK_KEY == fixture["task_keys"]["notebook"]
    assert agent_ns["IMPLEMENT_ALERT_TASK_KEY"] == fixture["task_keys"]["alert"]
    for raw, cleaned in fixture["tag_values"]:
        assert agent_ns["JobLauncher"]._sanitize_tag(raw) == cleaned, raw
    tagger = make_inspire(agent_ns, spark=FakeSpark(), session_id=5150)
    tags = tagger._implement_tags(tagger._genie_notebook_spec(make_uc()), (5150, "N01-U01", 2), "/W/nb")
    assert set(fixture["use_case_tag_keys"]) <= set(tags), set(fixture["use_case_tag_keys"]) - set(tags)


def test_the_widgets_inspire_sets_ignore_user_values(agent_ns):
    hidden = json.load(open(FIXTURE))["widget_groups"]["inspire_widgets"]
    spec = agent_ns["validate_implement_spec"](_merged(VALID, {"config": {"widgets": {"result_table": "other.s.t", "run_profile": "full"}}}))[0]
    params = agent_ns["implement_job_parameters"](["result_table", "run_profile", "top_k"], spec, "preview")
    assert params["result_table"] == "main.inspire.churn_out" and params["run_profile"] == "preview" and params["top_k"] == "25"
    assert {"result_table", "run_profile"} <= set(hidden)


def test_genie_fill_widgets_take_core_ranges_and_flag_unreadable_ones(agent_ns):
    core = [{"name": "act_now_share", "allowed": "0 to 1"}, {"name": "horizon", "allowed": "whole number, at least 1"}]
    result = {"widgets": [{"name": "act_now_share", "type": "text", "default": "0.05", "allowed": "any"},
                          {"name": "segment", "type": "dropdown", "default": "all", "choices": ["all", "eu"], "allowed": "1 to 2"},
                          {"name": "lookback_months", "type": "text", "default": "24", "allowed": "whole number, 1 to 120.0"},
                          {"name": "window", "type": "text", "default": "30", "allowed": "a month or so"}, "not a widget"]}
    problems = agent_ns["normalize_genie_fill_widgets"](result, core)
    assert {w["name"]: w["allowed"] for w in result["widgets"] if isinstance(w, dict)} == {
        "act_now_share": "0 to 1", "segment": "", "lookback_months": "whole number, 1 to 120", "window": ""}
    assert problems == ["widget window has allowed 'a month or so', which is not one of Inspire's range forms "
                        "('0 to 1', 'at least 1', 'at most 5', 'above 0 and below 1', 'whole number, 1 to 10', or empty for any value)"]
    honest = {"widgets": [{"name": "holdout_fraction", "type": "text", "default": "0.2", "allowed": "greater than 0 and less than 1"}]}
    assert agent_ns["normalize_genie_fill_widgets"](honest, core) == [], "an exclusive range Genie states is read, not sent back to repair"
    assert honest["widgets"][0]["allowed"] == "above 0 and below 1"
    assert agent_ns["normalize_genie_fill_widgets"](None, core) == []
    bad_default = {"widgets": [{"name": "lookback_months", "type": "text", "default": "500", "choices": [], "allowed": "whole number, 1 to 120"},
                               {"name": "run_profile", "type": "dropdown", "default": "full", "choices": ["preview", "full"]}]}
    assert agent_ns["validate_genie_fill_result"](bad_default, ["lookback_months"]) == [
        "the default of widget lookback_months is '500'; allowed: whole number, 1 to 120"]


def test_the_fill_prompt_names_only_range_forms_inspire_reads(agent_ns):
    prompt = _inspire(agent_ns, FakeSpark())._IMPLEMENT_FILL_PROMPT
    forms = re.findall(r"'([^']+)'", prompt.split("the allowed range written as ")[1].split(" or empty")[0])
    assert forms == ["0 to 1", "at least 1", "at most 5", "above 0 and below 1", "whole number, 1 to 10"]
    for form in forms:
        assert agent_ns["genie_allowed_text"](agent_ns["genie_allowed_rule"](form)) == form
    problem = agent_ns["normalize_genie_fill_widgets"]({"widgets": [{"name": "x", "type": "text", "allowed": "1-5"}]}, [])[0]
    assert all(f"'{form}'" in problem for form in forms)


def _widget_run(agent_ns, widgets, built_widgets=None):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_previous = lambda t: {"spec_version": 1, "spec_json": VALID} if built_widgets else {}
    inst._implement_carried = lambda t: ({"genie_widgets": built_widgets} if built_widgets else {}, {})
    inst._implement_update = lambda key, **f: None
    inst._implement_emit = lambda *a, **k: None
    instruction = ("## Parameters\n| widget | type | default | allowed | used for |\n|---|---|---|---|---|\n"
                   "| `lookback_months` | text | `24` | whole number, 1 to 120 | Months of history |\n")
    inst._implement_use_case_row = lambda sid, uc: {"No": "N01-U01", "Primary Table": "main.s.orders", "genie_instruction": instruction}
    inst._row_to_uc = lambda row: dict(row)
    inst._genie_involved_tables = lambda uc: ["main.s.orders"]
    inst._genie_notebook_spec = lambda uc: {"family": "A", "decision_basis": "predicted", "result_table": "main.inspire.churn_out",
                                            "model_name": "main.inspire.churn", "job_slug": "predict_churn",
                                            "ai_endpoint": "databricks-claude", "horizon": None, "season_length": None,
                                            "thresholds": {"min_class_rate": 0.01, "max_class_rate": 0.5}}
    inst._implement_write_notebook = lambda *a: pytest.fail("an out-of-range widget never writes the notebook")
    inst._implement_runner = lambda uc: (_ for _ in ()).throw(RuntimeError("reached Genie"))
    spec = _merged(VALID, {"config": {"widgets": widgets}})
    return lambda: inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 2, "spec_json": spec},
                                              (5150, "N01-U01", 2))


def test_out_of_range_widget_values_stop_the_run_before_any_genie_work(agent_ns):
    blocked = agent_ns["ImplementBlocked"]
    previous = [{"name": "top_k", "type": "text", "default": "25", "allowed": "whole number, 1 to 100"},
                {"name": "act_now_share", "type": "text", "default": "0.05", "allowed": "0 to 5"},
                {"name": "lookback_months", "type": "text", "default": "24", "allowed": "whole number, 1 to 60"}]
    for widgets, previous_row, needle in (
            ({"act_now_share": "1.5"}, None, "widget values are out of range: act_now_share is '1.5'; allowed: 0 to 1"),
            ({"lookback_months": "0"}, None, "lookback_months is '0'; allowed: whole number, 1 to 120"),
            ({"min_class_rate": "0.6"}, None, "min_class_rate is 0.6, above max_class_rate 0.5"),
            ({"top_k": "500"}, previous, "top_k is '500'; allowed: whole number, 1 to 100"),
            ({"act_now_share": "1.5"}, previous, "act_now_share is '1.5'; allowed: 0 to 1"),
            ({"lookback_months": "90"}, previous, "lookback_months is '90'; allowed: whole number, 1 to 60")):
        with pytest.raises(blocked, match=re.escape(needle)):
            _widget_run(agent_ns, widgets, previous_row)()
    for widgets, previous_row in (({"act_now_share": "0.1", "lookback_months": "36", "min_class_rate": "0.02"}, None),
                                  ({"top_k": "100", "lookback_months": "60"}, previous)):
        with pytest.raises(RuntimeError, match="reached Genie"):
            _widget_run(agent_ns, widgets, previous_row)()


def test_select_reads_genie_widgets_as_a_list(agent_ns):
    rows = [_Row(session_id=5150, use_case_id="N01-U01", spec_version=1, spec_json="{}", asset_status=None,
                 genie_widgets='[{"name": "top_k", "allowed": "at least 1"}]', data_profiles='{"training": {"rows": 5}}',
                 suggested_schedule='{"cron": "0 0 6 * * ?"}'),
            _Row(session_id=5150, use_case_id="N01-U01", spec_version=2, spec_json="[]", asset_status='{"x": {}}', genie_widgets="{}",
                 data_profiles="[]", suggested_schedule="not json"),
            _Row(session_id=5150, use_case_id="N01-U01", spec_version=3, spec_json="not json", asset_status=None, genie_widgets=None)]
    statements = []
    spark = types.SimpleNamespace(sql=lambda s, args=None: statements.append(s) or types.SimpleNamespace(collect=lambda: rows))
    got = _inspire(agent_ns, spark)._implement_select("session_id = :sid", {"sid": 5150})
    assert "to_json(genie_widgets) AS genie_widgets" in statements[0]
    assert "to_json(data_profiles) AS data_profiles" in statements[0] and "to_json(suggested_schedule) AS suggested_schedule" in statements[0]
    assert [r["genie_widgets"] for r in got] == [[{"name": "top_k", "allowed": "at least 1"}], [], []]
    assert [r["spec_json"] for r in got] == [{}, {}, {}] and [r["asset_status"] for r in got] == [{}, {"x": {}}, {}]
    assert [r["data_profiles"] for r in got] == [{"training": {"rows": 5}}, {}, {}]
    assert [r["suggested_schedule"] for r in got] == [{"cron": "0 0 6 * * ?"}, {}, {}]


def test_spec_numbers_are_whole_or_decimal_without_silent_rounding(agent_ns):
    whole, decimal = agent_ns["implement_whole_number"], agent_ns["implement_decimal"]
    assert [whole(v) for v in (7, 7.0, " 7 ", "+3", "-2")] == [7, 7, 7, 3, -2]
    assert [whole(v) for v in (2.5, True, "5_000", "7.0", "1e3", "", None, [], float("inf"))] == [None] * 9
    assert [decimal(v) for v in (0.5, 1, ".5", "5.", " 1e-1 ", "+0.25")] == [0.5, 1.0, 0.5, 5.0, 0.1, 0.25]
    assert [decimal(v) for v in (True, "1_0", "nan", "inf", "1e999", "0x10", "", None, {})] == [None] * 9
    spec = _merged(VALID, {"based_on_version": 3.0, "config": {"profiles": {"training": {"window_days": 30.0},
                                                                            "retrain": {"drift_threshold": "0.2"}}}})
    out, errors = agent_ns["validate_implement_spec"](spec)
    assert errors == [] and out["based_on_version"] == 3 and out["config"]["profiles"]["training"]["window_days"] == 30
    assert out["config"]["profiles"]["retrain"]["drift_threshold"] == 0.2
    assert agent_ns["implement_alert_threshold"]({"alert_threshold": "2"}) == 2.0
    assert agent_ns["implement_alert_threshold"]({}) == 1.0
    with pytest.raises(ValueError, match="is not a number"):
        agent_ns["implement_alert_threshold"]({"alert_threshold": True})


def test_choices_mention_training_only_when_the_pattern_trains_a_model(agent_ns):
    spec = agent_ns["validate_implement_spec"](_merged(VALID, {
        "data": {"column_roles": {"label": "main.s.orders_v2.churned", "entity_id": "main.s.orders_v2.customer_id"}},
        "config": {"profiles": {"training": {"window_days": 365}, "retrain": {"every_runs": 4}, "full_load": {"window_days": 90}}}}))[0]
    with_model = agent_ns["implement_choices_markdown"](spec)
    without = agent_ns["implement_choices_markdown"](spec, trains_model=False)
    assert "- Use `main.s.orders_v2.churned` as the label column." in with_model and "churned" not in without
    assert "- Training profile: the last 365 days." in with_model
    assert "- Retrain the model every 4 full runs; otherwise reuse the last trained model." in with_model
    assert "With `preview`, train on the training profile and score at most 1,000 entities" in with_model
    assert "Preview training sample" not in with_model, "a training window the user set wins over the preview sample"
    assert "train" not in without.lower(), "a pattern without a model is never told to train one"
    for text in (with_model, without):
        assert ("- Use `main.s.orders_v2.customer_id` as the entity id column: the user chose it, so one row of the business output is "
                "one `customer_id`") in text
        assert "- Full-load profile: score with the last 90 days of data, as_of_date = latest." in text
        assert ("only with inspire_write_result(frame, result_table): each run's rows, where use_case_id = 'N01-U01', become the "
                "current version of their records, earlier versions stay as change history, and rows of other use cases stay.") in text


def test_the_notebook_choices_follow_the_use_case_s_pattern(agent_ns, sdk_stub):
    spec = agent_ns["validate_implement_spec"](_merged(VALID, {
        "data": {"column_roles": {"label": "main.s.orders_v2.churned"}}, "config": {"profiles": {"training": {"window_days": 365}}}}))[0]
    for technique, trains in (("Predictive Modeling", True), ("Forecasting", False), ("Pareto Analysis", False)):
        workspace = _NotebookWorkspace(None, modified_at=None)
        inst = _notebook_inspire(agent_ns, workspace)
        inst._implement_write_notebook({"No": "N01-U01", "genie_instruction": "Build", "Analytics Technique": technique}, spec, None, (5150, "N01-U01", 1))
        text = workspace.imported[-1]["cells"][1]["source"][0]
        assert ("as the label column" in text) is trains and ("- Training profile:" in text) is trains, technique


def test_every_instruction_states_the_shared_write_rule(agent_ns):
    from v120_genie_support import build_inspire, make_uc
    inst = build_inspire(agent_ns)
    for technique in ("Predictive Modeling", "Forecasting", "Pareto Analysis"):
        mandate = inst._build_code_structure_mandate(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique})))
        assert "never touches another use case's rows" in mandate and "written only with inspire_write_result" in mandate, technique


def _tpcds_role_evidence():
    def cols(**types):
        return {name: {"name": name, "type": kind, "comment": None} for name, kind in types.items()}
    date_fk = {"ref_table": "samples.tpcds_sf1.date_dim", "ref_column": "d_date_sk", "source": "inferred", "confidence": 0.9}
    return {
        "samples.tpcds_sf1.web_sales": {"columns": cols(ws_sold_date_sk="INT", ws_bill_customer_sk="INT", ws_quantity="INT",
                                                        ws_net_paid="DECIMAL(7,2)"),
                                        "foreign_keys": [dict(date_fk, column="ws_sold_date_sk")]},
        "samples.tpcds_sf1.customer": {"columns": cols(c_customer_sk="INT", c_first_name="STRING", c_last_review_date="INT",
                                                       c_preferred_cust_flag="STRING"), "foreign_keys": []},
        "samples.tpcds_sf1.date_dim": {"columns": cols(d_date_sk="INT", d_date="DATE"), "foreign_keys": []},
    }


def _role_problems(ns, roles, trains_model=True):
    evidence = _tpcds_role_evidence()
    tables = sorted({".".join(r.split(".")[:3]) for r in roles.values()})
    dated = ns["DatabricksInspire"]._elite_dated_joins(evidence, tables)
    return ns["implement_column_role_problems"](roles, evidence, dated, trains_model=trains_model,
                                                free_text_tokens=ns["DatabricksInspire"]._TEXT_NAME_TOKENS)


def test_column_roles_guessed_from_names_are_rejected_and_the_use_case_s_own_roles_pass(agent_ns):
    guessed = {"entity_id": "samples.tpcds_sf1.web_sales.ws_sold_date_sk", "event_date": "samples.tpcds_sf1.customer.c_last_review_date",
               "label": "samples.tpcds_sf1.customer.c_first_name", "measure": "samples.tpcds_sf1.web_sales.ws_quantity"}
    problems = _role_problems(agent_ns, guessed)
    assert len(problems) == 3, problems
    assert problems[0].startswith("samples.tpcds_sf1.web_sales.ws_sold_date_sk (INT, a date key) cannot be the entity id")
    assert problems[1].startswith("samples.tpcds_sf1.customer.c_last_review_date (INT) cannot be the event date")
    assert problems[2].startswith("samples.tpcds_sf1.customer.c_first_name (STRING) cannot be the label")
    own = {"entity_id": "samples.tpcds_sf1.customer.c_customer_sk", "event_date": "samples.tpcds_sf1.web_sales.ws_sold_date_sk",
           "measure": "samples.tpcds_sf1.web_sales.ws_net_paid", "segment": "samples.tpcds_sf1.customer.c_preferred_cust_flag"}
    assert _role_problems(agent_ns, own) == []
    assert _role_problems(agent_ns, {"event_date": "samples.tpcds_sf1.date_dim.d_date"}) == []


def test_role_rules_cover_measures_keys_missing_columns_and_patterns_without_a_model(agent_ns):
    problems = _role_problems(agent_ns, {"measure": "samples.tpcds_sf1.customer.c_customer_sk",
                                         "segment": "samples.tpcds_sf1.date_dim.d_date",
                                         "entity_id": "samples.tpcds_sf1.web_sales.ws_net_paid"})
    assert [p.split(" cannot be the ")[1].split(":")[0] for p in problems] == ["entity id", "measure", "segment"]
    assert _role_problems(agent_ns, {"measure": "samples.tpcds_sf1.web_sales.ws_gone"}) == [
        "samples.tpcds_sf1.web_sales.ws_gone is not a column of samples.tpcds_sf1.web_sales"]
    assert _role_problems(agent_ns, {"label": "samples.tpcds_sf1.customer.c_first_name"}, trains_model=False) == []
    assert _role_problems(agent_ns, {"measure": "other.s.t.amount"}) == [], "a table without metadata is not judged"


def test_misfit_roles_stop_the_run_before_genie_and_name_each_column(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_previous = lambda t: None
    inst._implement_carried = lambda t: ({}, {})
    inst.updates = []
    inst._implement_update = lambda key, **f: inst.updates.append(f)
    inst._implement_emit = lambda *a, **k: None
    inst._implement_use_case_row = lambda sid, uc: {"No": "N01-U01", "Primary Table": "samples.tpcds_sf1.web_sales",
                                                    "genie_instruction": "Build"}
    inst._row_to_uc = lambda row: dict(row)
    inst._genie_involved_tables = lambda uc: ["samples.tpcds_sf1.web_sales", "samples.tpcds_sf1.customer"]
    inst._implement_missing_tables = lambda tables: []
    evidence = _tpcds_role_evidence()
    asked = []
    inst._genie_table_evidence = lambda tables: asked.append(sorted(tables)) or {t: evidence[t] for t in tables if t in evidence}
    inst._uc_execution_family = lambda uc, label: "A"
    inst._implement_write_notebook = lambda *a: pytest.fail("misfit roles never write the notebook")
    inst._implement_runner = lambda uc: pytest.fail("misfit roles never start Genie")
    spec = dict(VALID, data={"tables": {}, "filters": [], "column_roles": {
        "entity_id": "samples.tpcds_sf1.web_sales.ws_sold_date_sk", "label": "samples.tpcds_sf1.customer.c_first_name"}})
    with pytest.raises(agent_ns["ImplementBlocked"]) as blocked:
        inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 1, "spec_json": spec},
                                   (5150, "N01-U01", 1))
    text = str(blocked.value)
    assert text.startswith("the column roles set in the wizard do not fit this use case: ")
    assert "ws_sold_date_sk (INT, a date key) cannot be the entity id" in text and "c_first_name (STRING) cannot be the label" in text
    assert text.endswith("Set them back with Reset roles to Inspire's choice in the Data step, or pick columns of the right kind")
    assert asked == [["samples.tpcds_sf1.customer", "samples.tpcds_sf1.web_sales"], ["samples.tpcds_sf1.date_dim"]]


def test_a_stop_names_the_wizard_roles_only_when_the_user_set_some(agent_ns):
    message = agent_ns["implement_stop_message"]
    stopped = {"status": "stopped", "stop_reason": "History covers 0 closed outcome windows."}
    spec = {"data": {"column_roles": {"entity_id": "c.s.t.k", "label": "c.s.t.flag"}}}
    assert message(stopped, {}) == "the preview run did not write usable rows: History covers 0 closed outcome windows."
    assert message(stopped, spec) == ("the preview run did not write usable rows: History covers 0 closed outcome windows. The run "
                                      "used the column roles set in the wizard (entity id = c.s.t.k, label = c.s.t.flag) in place of "
                                      "the use case's own; if they do not fit, set them back with Reset roles to Inspire's choice in "
                                      "the Data step")
    plain = dict(stopped, stop_reason="History covers 0 closed outcome windows")
    assert message(plain, spec).startswith("the preview run did not write usable rows: History covers 0 closed outcome windows. The run")
    sent_back = dict(stopped, sent_back=True, not_a_stop="the run stopped with \"No approved model yet\".")
    assert message(sent_back, spec).startswith("the preview run did not write usable rows: History covers 0 closed outcome windows. "
                                               "Inspire sent it back to Genie, and it still stopped: the run stopped with \"No approved "
                                               "model yet\". The run used the column roles")
    assert ".." not in message(sent_back, spec) and ".." not in message(dict(stopped, stopped_by="genie"), spec)
    assert "label = c.s.t.flag" not in message(stopped, spec, trains_model=False)
    assert message({"status": "failed", "error": "boom"}, spec) == "the preview run did not write usable rows: boom"
    by_genie = dict(stopped, stopped_by="genie")
    assert message(by_genie, {}) == "Genie stopped the build: History covers 0 closed outcome windows."
    assert message(by_genie, spec).startswith("Genie stopped the build: History covers 0 closed outcome windows. The run used")
    assert message({"status": "failed", "error": "boom", "stopped_by": "genie"}, {}) == "the preview run did not write usable rows: boom", \
        "only a stop is Genie's stop"


def test_choices_built_on_an_earlier_version_name_each_choice_withdrawn_or_changed_since(agent_ns):
    md, valid = agent_ns["implement_choices_markdown"], agent_ns["validate_implement_spec"]
    roles = lambda r: valid(dict(VALID, data={**VALID["data"], "column_roles": r}))[0]
    before = roles({"entity_id": "main.s.orders_v2.order_date", "event_date": "main.s.orders_v2.order_id"})
    after = roles({"event_date": "main.s.orders_v2.order_date"})
    text = md(after, before)
    withdrawn = [line for line in text.splitlines() if line.startswith("- Withdrawn since the earlier version:")]
    assert withdrawn == [
        "- Withdrawn since the earlier version: Use `main.s.orders_v2.order_date` as the entity id column: the user chose it, so one row "
        "of the business output is one `order_date`; when `main.s.orders_v2` holds several rows for one `order_date`, group them into "
        "that one row and build its values from all of them. Take out what the cells do for it; where the instruction above has its own "
        "choice, follow the instruction.",
        "- Withdrawn since the earlier version: Use `main.s.orders_v2.order_id` as the event date column. Take out what the cells do "
        "for it; where the instruction above has its own choice, follow the instruction.",
    ]
    assert "- Use `main.s.orders_v2.order_date` as the event date column." in text
    assert text.index("- The notebook was already built for an earlier version") < text.index(withdrawn[0])
    cleared = md(roles({}), before)
    assert sum(line.startswith("- Withdrawn since the earlier version:") for line in cleared.splitlines()) == 2
    assert "Withdrawn since" not in md(after, after), "an unchanged version withdraws nothing"
    assert "Withdrawn since" not in md(after), "a first build has nothing to withdraw"
    window = valid(dict(VALID, data={**VALID["data"], "window": {"start": "2024-01-01", "end": ""}}))[0]
    moved = md(valid(dict(VALID, data={**VALID["data"], "window": {"start": "2025-01-01", "end": ""}}))[0], window)
    assert "- Withdrawn since the earlier version: Read history from 2024-01-01 to the latest date only." in moved
    assert "- Read history from 2025-01-01 to the latest date only." in moved


def test_a_built_result_that_carries_a_stop_reason_is_a_stop_and_skips_the_second_preview(agent_ns):
    inst = _flow_inspire(agent_ns, [])
    built = dict(_fill(), summary="Notebook built and serverless preview completed successfully via the specified stop rule.",
                 stop_reason="History covers 0 closed outcome windows; at least 2 are required.")
    outcome, _job, _f = inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), {}, agent_ns["validate_implement_spec"](VALID)[0],
                                                         None, "/W/nb", ["result_table", "run_profile"],
                                                         _FakeRunner([{"exit": 0, "final": built}] * 3), True)
    assert {k: outcome[k] for k in ("status", "stop_reason", "stopped_by")} == {
        "status": "stopped", "stop_reason": "History covers 0 closed outcome windows; at least 2 are required.", "stopped_by": "genie"}
    stopped = agent_ns["genie_fill_stopped"]
    assert stopped({"status": "built", "stop_reason": " x "}) and stopped({"status": "stopped", "stop_reason": ""})
    assert not stopped({"status": "built", "stop_reason": ""}) and not stopped({"status": "failed", "stop_reason": "x"})
    assert not stopped(None)
    assert "set status to stopped and put the message the notebook printed in stop_reason" in inst._IMPLEMENT_FILL_PROMPT
    assert ("The stop rule counts only for a run of cells that do what the instruction and its Implementation Choices say: cells "
            "that read other columns or tables than those name are a defect to fix before the run counts") in inst._IMPLEMENT_FILL_PROMPT


def test_genie_messages_in_the_log_carry_genie_s_words_not_the_json(agent_ns):
    line = agent_ns["summarize_genie_event"]
    progress = json.dumps({"status": "built", "summary": "I\u2019m inspecting the notebook instructions first.", "stop_reason": "",
                           "widgets": [], "profiles": {}, "schedule": {}})
    final = json.dumps({"status": "built", "summary": "Notebook built and preview completed successfully via the stop rule.",
                        "stop_reason": "History covers 0 closed outcome windows; at least 2 are required.", "widgets": [{"name": "w"}]})
    message = lambda text: {"type": "item.completed", "item": {"type": "agent_message", "text": text}}
    assert line(message(progress)) == "Genie: I\u2019m inspecting the notebook instructions first."
    assert line(message(final)) == "Genie: Stopped: History covers 0 closed outcome windows; at least 2 are required."
    assert line(message(json.dumps({"status": "written", "files": ["a.py"], "summary": "Wrote the App"}))) == "Genie: Wrote the App"
    assert line(message('{"summary": "cut')) == 'Genie: {"summary": "cut'
    assert line(message('{"other": 1}')) == 'Genie: {"other": 1}'


def test_role_rules_match_the_shared_fixture(agent_ns):
    with open(FIXTURE) as fh:
        rules = json.load(fh)["role_rules"]
    assert list(agent_ns["_KEY_NAME_SUFFIXES"]) == rules["key_name_suffixes"]
    assert list(agent_ns["_KEY_NAME_PREFIXES"]) == rules["key_name_prefixes"]
    assert sorted(agent_ns["_GENERIC_KEY_NAMES"]) == rules["generic_key_names"]
    assert sorted(agent_ns["_CODE_NAMES"]) == rules["code_names"]
    assert list(agent_ns["_CONCAT_KEY_SUFFIXES"]) == rules["concat_key_suffixes"]
    assert list(agent_ns["DatabricksInspire"]._TEXT_NAME_TOKENS) == rules["text_name_tokens"]
    assert list(agent_ns["IMPLEMENT_PERSON_NAME_TOKENS"]) == rules["person_name_tokens"]
    for case in rules["cases"]:
        evidence = {"c.s.t": {"columns": {case["column"]: {"name": case["column"], "type": case["type"]}}}}
        dated = {("c.s.t", case["column"]): {}} if case["date_key"] else {}
        problems = agent_ns["implement_column_role_problems"]({case["role"]: f"c.s.t.{case['column']}"}, evidence, dated,
                                                              free_text_tokens=rules["text_name_tokens"])
        assert (problems == []) is case["fits"], (case, problems)


ANY_POC = re.compile(r"PoC|(?<![A-Z])POC(?![A-Z])|Poc(?![a-z])|\bpocs?\b|\bpoc[A-Z_]|_poc\b")
OLD_PAGE = re.compile(r"Implement page|Implement with Genie")


def test_the_naming_patterns_catch_the_old_words_and_pass_the_new_ones():
    for bad in ["The use case PoC/MVP failed", "The use case PoC failed", "Start Use Case PoC with Genie", "the Implement page shows each step",
                "PocProgress", "poc_spec", "implement_poc", "pocs"]:
        assert ANY_POC.search(bad) or OLD_PAGE.search(bad), bad
    for good in ["The use case MVP failed", "Start Use Case MVP with Genie", "the Build page shows each step", "epoch", "EPOCH_MS_FROM", "Apocalypse",
                 "Pocket"]:
        assert not ANY_POC.search(good) and not OLD_PAGE.search(good), good


def test_every_user_facing_agent_string_and_code_name_says_mvp_and_the_build_page():
    from _agentload import agent_source
    tree = ast.parse(agent_source())
    texts = [node.value for node in ast.walk(tree) if isinstance(node, ast.Constant) and isinstance(node.value, str) and " " in node.value]
    assert [t for t in texts if ANY_POC.search(t) or OLD_PAGE.search(t)] == []
    names = {node.id for node in ast.walk(tree) if isinstance(node, ast.Name)} | {node.attr for node in ast.walk(tree) if isinstance(node, ast.Attribute)}
    names |= {node.name for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))}
    names |= {node.arg for node in ast.walk(tree) if isinstance(node, ast.arg)}
    assert sorted(n for n in names if ANY_POC.search(n)) == []
    with open(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "agent",
                           "dbx_inspire_ai_agent.ipynb")) as fh:
        cells = json.load(fh)["cells"]
    markdown = "".join("".join(c["source"]) for c in cells if c["cell_type"] == "markdown")
    assert ANY_POC.search(markdown) is None and OLD_PAGE.search(markdown) is None
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    for doc in ("readme.md", os.path.join("docs", "integration-guide.md")):
        with open(os.path.join(root, doc)) as fh:
            assert [line for line in fh if ANY_POC.search(line)] == [], doc


def _app_shell(ns, tmp_path):
    payload = ns["implement_app_shell_payload"](ns["inspire_notebook_asset"]("app_shell"))
    return payload, ns["implement_app_shell_modules"](str(tmp_path / "_shell"), payload["files"])


CHURN_TABLES = {"main.pricing.loss_desk_out": "main.inspire.churn_out", "main.pricing.items": "main.s.orders",
                "main.pricing.loss_trend": "main.s.orders"}


def _churn_page(ns, **changes):
    page = json.loads(json.dumps(ns["implement_app_shell_payload"](ns["inspire_notebook_asset"]("app_shell"))["example"]))
    for dataset in page["datasets"]:
        for old, new in CHURN_TABLES.items():
            dataset["sql"] = dataset["sql"].replace(old, new)
    page.update(changes)
    return page


def _shell_text(data):
    import base64
    import zlib
    return base64.b64encode(zlib.compress(json.dumps(data).encode())).decode()


def test_the_notebook_carries_a_shell_that_decodes_and_imports_from_its_own_folder(agent_ns, tmp_path, monkeypatch):
    for name in agent_ns["IMPLEMENT_APP_SHELL_MODULES"]:
        monkeypatch.delitem(sys.modules, name, raising=False)
    monkeypatch.setattr(sys, "path", list(sys.path))
    payload, modules = _app_shell(agent_ns, tmp_path)
    assert sorted(modules) == ["shell_agent", "shell_alerts", "shell_core", "shell_db", "shell_facts", "shell_pg", "shell_redact", "shell_sql"]
    assert all(m.__file__.startswith(str(tmp_path / "_shell")) for m in modules.values())
    assert {"app.py", "app.yaml", "shell_core.py", "static/index.html", "static/assets/app.js"} <= set(payload["files"])
    assert modules["shell_sql"].spec_problems(payload["example"]) == []
    assert str(tmp_path / "_shell") not in sys.path and not [n for n in agent_ns["IMPLEMENT_APP_SHELL_MODULES"] if n in sys.modules], \
        "the loaded shell reads its own modules without leaving them or their folder to the process"


@pytest.mark.parametrize("text,needle", [
    ("", "carries no usable App shell"),
    ("not-base64!", "does not decode"),
    ("aGVsbG8=", "does not decode"),
    (_shell_text([1, 2]), "carries no usable App shell"),
    (_shell_text({"version": 2, "example": {}, "files": {"shell_sql.py": "", "shell_db.py": "", "shell_core.py": "",
                                                         "static/index.html": ""}}), "carries no usable App shell"),
    (_shell_text({"version": 1, "example": {}, "files": {"shell_sql.py": "", "shell_core.py": "", "static/index.html": ""}}),
     "carries no usable App shell"),
    (_shell_text({"version": 1, "files": {"shell_sql.py": "", "shell_db.py": "", "shell_core.py": "", "static/index.html": ""}}),
     "carries no usable App shell"),
])
def test_a_missing_or_stale_shell_stops_the_app_with_the_fix(agent_ns, text, needle):
    with pytest.raises(RuntimeError, match=needle):
        agent_ns["implement_app_shell_payload"](text)


def test_a_shell_that_cannot_load_stops_the_app_before_genie_is_asked(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_app_shell = lambda: (_ for _ in ()).throw(RuntimeError("this notebook carries no usable App shell"))
    asked = []
    inst._implement_genie_loop = lambda *a, **k: asked.append(a) or {}
    with pytest.raises(RuntimeError, match="no usable App shell"):
        inst._implement_app(_output_context(agent_ns), None)
    assert asked == []


def test_the_app_shell_is_loaded_once_per_run_into_the_run_folder(agent_ns, tmp_path):
    inst = _inspire(agent_ns, FakeSpark())
    inst.local_log_output_dir = str(tmp_path)
    first = inst._implement_app_shell()
    assert inst._implement_app_shell() is first
    assert sorted(os.listdir(tmp_path / "implement" / "_app_shell")) == ["kinds.json", "shell_agent.py", "shell_alerts.py", "shell_core.py", "shell_db.py", "shell_facts.py", "shell_pg.py",
                                                                           "shell_redact.py", "shell_sql.py"]


def test_the_app_shell_loads_the_files_it_just_wrote_even_when_a_module_of_that_name_is_already_loaded(agent_ns, tmp_path, monkeypatch):
    import types
    for name in ("shell_sql", "shell_db", "shell_core"):
        decoy = types.ModuleType(name)
        decoy.__file__ = str(tmp_path / "elsewhere" / f"{name}.py")
        decoy.CAPS = "stale"
        monkeypatch.setitem(sys.modules, name, decoy)
    payload = agent_ns["implement_app_shell_payload"](agent_ns["inspire_notebook_asset"]("app_shell"))
    folder = tmp_path / "run"
    modules = agent_ns["implement_app_shell_modules"](str(folder), payload["files"])
    assert {name: os.path.dirname(module.__file__) for name, module in modules.items()} == {name: str(folder) for name in modules}
    assert modules["shell_sql"].CAPS != "stale" and modules["shell_core"].shell_sql is modules["shell_sql"]
    assert sorted(os.listdir(folder)) == ["kinds.json", "shell_agent.py", "shell_alerts.py", "shell_core.py", "shell_db.py", "shell_facts.py", "shell_pg.py", "shell_redact.py",
                                          "shell_sql.py"], "no bytecode is left in the run folder"
    assert str(folder) not in sys.path and all(sys.modules[n].CAPS == "stale" for n in ("shell_sql", "shell_db", "shell_core")), \
        "the modules the process held before stay its own"


def test_page_ids_and_catalog_fields_come_from_inspire_not_genie(agent_ns):
    page = agent_ns["implement_app_page"]({"id": "x", "use_case_id": "N9", "domain": "Made up", "sponsor": "CFO", "title": "T"},
                                          "N01-U05", {"Business Domain": "Pricing", "Subdomain": " Markdown   control ", "Sponsor": ""})
    assert (page["id"], page["use_case_id"], page["domain"], page["subdomain"]) == ("n01_u05", "N01-U05", "Pricing", "Markdown control")
    assert page["title"] == "T" and page["sponsor"] == "CFO", "Genie's own text stays where Inspire has no catalog value"
    assert agent_ns["implement_app_page_id"]("9-A") == "p_9_a"
    assert agent_ns["implement_app_page"]({}, "N01-U05", {"Sponsor": "x" * 90})["sponsor"] == "x" * 80
    with pytest.raises(RuntimeError, match="page.json must hold one JSON object"):
        agent_ns["implement_app_page"]([1], "N01-U05", {})


def test_the_app_settings_start_with_decisions_on_and_every_other_option_off_and_say_why_ask_genie_is_off(agent_ns, tmp_path):
    payload, modules = _app_shell(agent_ns, tmp_path)
    core = modules["shell_core"]
    page = agent_ns["implement_app_page"](_churn_page(agent_ns), "N01-U01", {})
    settings = agent_ns["implement_app_settings"]
    off = settings(core.SETTINGS_VERSION, " N01-U01   Predict churn ", [page["id"]], None, "no agent", "2026-10-27T00:00:00Z",
                   {"app_access": "sp"})
    assert off["options"] == {"modify": False, "replace_edits": False, "decisions": True, "alerts": False}
    assert (off["title"], off["style"], off["layout"], off["palette"], off["theme"], off["auth"]) == (
        "N01-U01 Predict churn", "a", "sidebar", "default", "light", "sp")
    assert off["genie"] is None and off["genie_note"] == "no agent"
    assert core.settings_problems(off, [page]) == []
    assert core.settings_problems(dict(off, genie_note=""), [page]) == ["Ask Genie is off, so genie_note must say why"]
    on = settings(core.SETTINGS_VERSION, "N01-U01 Predict churn", [page["id"]], {"space_id": "g1", "title": "Churn"}, "unused", "t",
                  {"app_access": "sp"})
    assert on["genie"] == {"space_id": "g1", "title": "Churn"} and on["genie_note"] == ""
    assert core.settings_problems(on, [page]) == []
    files = agent_ns["implement_app_source"](payload["files"], core.SETTINGS_FILE, core.PAGES_DIR, on, [page])
    assert json.loads(files["inspire_app.json"]) == on and json.loads(files["pages/n01_u01.json"]) == page
    assert set(files) - set(payload["files"]) == {"inspire_app.json", "pages/n01_u01.json"}


def _without_requirements(files):
    return {name: text for name, text in files.items() if name != "requirements.txt"}


def _app_flow(ns, tmp_path, page=None, write=True, outputs=None, assets=None, asset_status=None, **stubs):
    inst = _inspire(ns, FakeSpark())
    inst._genie_decision_contract = _contract
    inst.local_log_output_dir = str(tmp_path)
    inst._implement_input_has_dates = lambda context: False
    inst._implement_run_query_check = lambda sql, require_rows=False, limit=20: [dict(t) for t in TRUTH]
    inst._implement_latest_run_rows = lambda table: list(TRUTH)
    inst._implement_app_name = lambda context, name: name
    inst._implement_app_host = lambda context, core, name="": ns["implement_app_host"](name or context["spec"]["outputs"]["app_name"])
    seen = {"checked": [], "deployed": [], "errors": []}
    inst._implement_app_check = lambda work, files, modules, warehouse: setattr(inst, "_implement_app_speeds", {}) or seen["checked"].append((files, warehouse)) or []
    inst._implement_deploy_app = (lambda context, name, files, reads, space_id="", lakebase=None, page_tables=():
                                  seen["deployed"].append((name, files, reads, space_id)) or {"app_name": name})
    for name, value in stubs.items():
        setattr(inst, name, value)
    work = tmp_path / "work"
    work.mkdir(parents=True)
    if write:
        (work / "page.json").write_text(page if isinstance(page, str) else json.dumps(page or _churn_page(ns)))

    def loop(context, runner, label, prompt, deploy, tools=None):
        seen.update(label=label, prompt=prompt, tools=tools)
        try:
            return deploy(str(work))
        except RuntimeError as error:
            seen["errors"].append(str(error))
            return {}

    inst._implement_genie_loop = loop
    context = _output_context(ns, **(outputs or {}))
    context.update(assets=assets or {}, asset_status=asset_status or {})
    return inst, context, seen


def test_the_app_is_built_from_genie_page_json_checked_at_its_defaults_then_deployed(agent_ns, tmp_path):
    inst, context, seen = _app_flow(agent_ns, tmp_path, assets={"genie_space": "g1"})
    fields = inst._implement_app(context, None)
    assert seen["errors"] == [] and fields == {"app_name": "churn-desk", "_asset": {"page": "n01_u01"}}, "every App deploy records the page of this use case, its own App as well as a joined one"
    name, files, reads, space_id = seen["deployed"][0]
    settings, page = json.loads(files["inspire_app.json"]), json.loads(files["pages/n01_u01.json"])
    assert (name, page["id"], page["use_case_id"], settings["pages"]) == ("churn-desk", "n01_u01", "N01-U01", ["n01_u01"])
    assert settings["genie"]["space_id"] == "g1" and space_id == "g1" and settings["title"] == "N01-U01 Predict churn"
    assert reads == ["main.s.orders", "main.inspire.churn_out"]
    assert seen["checked"] == [(_without_requirements(files), "wh1")], "the App's own query path runs once, on the files that deploy"
    assert files["requirements.txt"] == "", "an App on Delta tables deploys an empty requirements.txt, which drops any Lakebase packages"
    assert {"app.py", "shell_core.py", "static/index.html"} <= set(files)


@pytest.mark.parametrize("outputs,asset_status,note", [
    ({}, {}, "Ask Genie is off because this use case's Genie Agent is not ready: it was not built"),
    ({}, {"genie_space": {"state": "failed", "error": "the warehouse  was\nstopped"}},
     "Ask Genie is off because this use case's Genie Agent is not ready: the warehouse was stopped"),
    ({"genie_space": False}, {}, "Ask Genie is off because this use case's Genie Agent is not ready: it was not built"),
])
def test_an_app_without_a_ready_genie_agent_deploys_with_ask_genie_off_and_a_warning(agent_ns, tmp_path, outputs, asset_status, note):
    inst, context, seen = _app_flow(agent_ns, tmp_path, outputs=outputs, asset_status=asset_status)
    fields = inst._implement_app(context, None)
    assert fields == {"app_name": "churn-desk", "_warnings": [f"App: {note}"], "_asset": {"page": "n01_u01"}}, "every App deploy records the page of this use case, its own App as well as a joined one"
    _name, files, reads, space_id = seen["deployed"][0]
    settings = json.loads(files["inspire_app.json"])
    assert settings["genie"] is None and settings["genie_note"] == note and space_id == ""
    assert reads == ["main.s.orders", "main.inspire.churn_out"]


def _app_deploy_raising(ns, tmp_path, error, **stubs):
    def deploy_app(context, name, files, reads, space_id="", lakebase=None, page_tables=()):
        raise error

    inst, context, _seen = _app_flow(ns, tmp_path, assets={"genie_space": "g1"}, _implement_deploy_app=deploy_app, **stubs)
    inst._implement_genie_loop = lambda context, runner, label, prompt, deploy, tools=None: deploy(str(tmp_path / "work"))
    return inst, context


def test_genie_gets_the_apps_own_page_checker_and_is_told_to_run_it(agent_ns, tmp_path):
    inst, context, seen = _app_flow(agent_ns, tmp_path, assets={"genie_space": "g1"})
    inst._implement_input_has_dates = lambda context: True
    inst._implement_app(context, None)
    payload, _modules = _app_shell(agent_ns, tmp_path / "shell")
    assert seen["tools"] == agent_ns["implement_app_check_files"](payload["files"], True, ["trend", "bars", "pareto"],
                                                       agent_ns["implement_page_many_sides"](context["result_table"], context.get("artifacts")),
                                                       context.get("app_layout") or "", False)
    assert sorted(seen["tools"]) == [".inspire_check/check_page.py", ".inspire_check/kinds.json", ".inspire_check/shell_facts.py",
                                     ".inspire_check/shell_redact.py", ".inspire_check/shell_sql.py"]
    assert "run `python .inspire_check/check_page.py` in your working folder: it runs those same checks on page.json and must " \
           "print no problems" in seen["prompt"]
    assert "every chart must draw 2 or more groups, and at least 3 segment filters must offer 2 or more values at the default " \
           "filters" in seen["prompt"]
    assert "a percent anywhere on the page is written 0 to 100, so multiply a 0 to 1 ratio or score by 100" in seen["prompt"]
    assert "* 100" in next(k["expression"] for k in payload["example"]["kpis"] if k.get("format") == "percent"), \
        "the example Genie copies must follow the same percent scale the prompt states"


def _run_page_check(ns, tmp_path, page, event_date=False):
    payload, _modules = _app_shell(ns, tmp_path / "shell")
    work = tmp_path / "work_check"
    ns["implement_write_files"](str(work), ns["implement_app_check_files"](payload["files"], event_date))
    (work / "page.json").write_text(page if isinstance(page, str) else json.dumps(page))
    done = subprocess.run([sys.executable, str(work / ".inspire_check" / "check_page.py")], cwd=str(tmp_path),
                          capture_output=True, text=True, timeout=60)
    return done.returncode, done.stdout.strip(), payload["example"]


def test_the_page_checker_genie_runs_passes_a_good_page_from_any_folder(agent_ns, tmp_path):
    payload, _modules = _app_shell(agent_ns, tmp_path / "shell")
    assert _run_page_check(agent_ns, tmp_path, payload["example"])[:2] == (0, "no problems")


def test_the_page_checker_genie_runs_reports_what_inspire_would_reject(agent_ns, tmp_path):
    payload, _modules = _app_shell(agent_ns, tmp_path / "shell")
    page = copy.deepcopy(payload["example"])
    next(c for c in page["charts"] if c.get("series"))["series"]["top"] = 10
    code, out, _example = _run_page_check(agent_ns, tmp_path, page)
    assert code == 1 and "series top must be a whole number from 1 to 8" in out


def test_the_page_checker_knows_whether_the_inputs_carry_an_event_date(agent_ns, tmp_path):
    payload, _modules = _app_shell(agent_ns, tmp_path / "shell")
    single = copy.deepcopy(payload["example"])
    single["filters"] = [f for f in single["filters"] if f["type"] != "date_range" or "as_of_date" in f["columns"].values()][:8]
    code, out, _example = _run_page_check(agent_ns, tmp_path, single, event_date=True)
    assert code == 1 and "add a second date range on that event date" in out


def test_the_page_checker_says_when_page_json_cannot_be_read(agent_ns, tmp_path):
    code, out, _example = _run_page_check(agent_ns, tmp_path, "{not json")
    assert code == 1 and out.startswith("page.json cannot be read: ")


def test_the_tools_inspire_gives_genie_are_in_every_round_and_never_count_as_its_files(agent_ns, tmp_path):
    inst = _loop_inspire(agent_ns, tmp_path)
    tool = ".inspire_check/check_page.py"
    runner = _FileRunner([{"exit": 0}, {"exit": 0}], [{"page.json": "{}", tool: "tampered"}, {}])
    texts = []

    def deploy(work):
        texts.append(open(os.path.join(work, tool), encoding="utf-8").read())
        if len(texts) == 1:
            raise RuntimeError("chart c1 series top must be a whole number from 1 to 8")
        return {"app_name": "a"}

    assert inst._implement_genie_loop(LOOP_CONTEXT, runner, "App", "write it", deploy, tools={tool: "print('ok')\n"}) == {"app_name": "a"}
    assert runner.seen == [[".inspire_check"], [".inspire_check", "page.json"]]
    assert texts == ["tampered", "print('ok')\n"], "each round starts from Inspire's own copy of the tool, whatever Genie did to it"
    assert [e["message"] for e in inst.emitted][2] == "round 2 of up to 4: Genie is writing the App from its last attempt (1 file)"


@pytest.mark.parametrize("error,message", [
    (AttributeError("RAW"), "the page passed every check, then the App could not be deployed: AttributeError: RAW"),
    (RuntimeError("the App deployment FAILED: crashed on start"),
     "the page passed every check, then the App could not be deployed: the App deployment FAILED: crashed on start"),
    ("blocked", "QUOTA_EXCEEDED: 50 apps"),
])
def test_an_app_whose_page_passed_every_check_but_did_not_deploy_is_not_sent_back_to_genie(agent_ns, tmp_path, error, message):
    blocked = agent_ns["ImplementBlocked"]
    inst, context = _app_deploy_raising(agent_ns, tmp_path, blocked(message) if error == "blocked" else error)
    with pytest.raises(blocked) as raised:
        inst._implement_app(context, None)
    assert str(raised.value) == message


def test_a_page_the_app_cannot_run_still_goes_back_to_genie(agent_ns, tmp_path):
    inst, context = _app_deploy_raising(agent_ns, tmp_path, AssertionError("never deploys"),
                                        _implement_app_check=lambda work, files, modules, warehouse: ["KPI k1 failed: UNRESOLVED_COLUMN"])
    with pytest.raises(RuntimeError) as raised:
        inst._implement_app(context, None)
    assert type(raised.value) is RuntimeError, "Genie can fix its own page, so this failure is retried"
    assert "the App was run at its default filters and KPI k1 failed: UNRESOLVED_COLUMN" in str(raised.value)


@pytest.mark.parametrize("error,text", [
    (AttributeError("RAW"), "AttributeError: RAW"),
    (KeyError("records"), "KeyError: 'records'"),
    (IndexError("list index out of range"), "IndexError: list index out of range"),
    (TimeoutError(), "TimeoutError"),
    (RuntimeError(""), "RuntimeError"),
    (RuntimeError("the App deployment FAILED"), "the App deployment FAILED"),
    (ValueError("page.json is not valid JSON"), "page.json is not valid JSON"),
])
def test_a_clean_error_message_names_the_error_when_its_text_alone_says_nothing(agent_ns, error, text):
    assert agent_ns["get_clean_error_message"](error) == text


@pytest.mark.parametrize("error,text", [
    (RuntimeError("User needs MANAGE permission on the resource. Config: host=https://ws.example, auth_type=runtime, "
                  "retry_timeout_seconds=300"), "User needs MANAGE permission on the resource"),
    (RuntimeError("not authorized for project p1. Config: host=https://ws.example, auth_type=pat. Env: DATABRICKS_HOST"),
     "not authorized for project p1"),
    (RuntimeError("first line. Config: profile=dev\nsecond line"), "first line second line"),
    (RuntimeError("the App Config: Settings page failed"), "the App Config: Settings page failed"),
])
def test_a_clean_error_message_never_shows_the_sdk_connection_settings(agent_ns, error, text):
    assert agent_ns["get_clean_error_message"](error) == text


@pytest.mark.parametrize("status,level", [("started", "INFO"), ("ended_success", "INFO"), ("ended_warning", "WARNING"),
                                          ("ended_error", "ERROR")])
def test_every_build_step_message_reaches_the_run_log(agent_ns, status, level):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_emit("N01-U01", "App", "round 1/3 failed, sent back to Genie: AttributeError: RAW", status)
    stage = agent_ns["IMPLEMENT_STAGE"]
    assert inst.logger.records == [(level, f"[{stage}] N01-U01 · App: round 1/3 failed, sent back to Genie: AttributeError: RAW")]
    assert inst.emitted[-1]["message"] == "round 1/3 failed, sent back to Genie: AttributeError: RAW"


def test_a_failed_step_whose_error_the_build_logs_once_is_a_warning_with_its_status_kept(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_emit("N01-U01", "Alert", "the alert API refused", "ended_error", error_logged_elsewhere=True)
    stage = agent_ns["IMPLEMENT_STAGE"]
    assert inst.logger.records == [("WARNING", f"[{stage}] N01-U01 · Alert: the alert API refused")]
    assert inst.emitted[-1]["status"] == "ended_error" and inst.emitted[-1]["message"] == "the alert API refused"


def test_every_failed_step_that_raises_to_the_build_leaves_its_one_error_to_the_build():
    source = agent_source()
    raising, flagged = 0, 0
    for node in ast.walk(ast.parse(source)):
        for body in (getattr(node, field, None) for field in ("body", "orelse", "finalbody", "handlers")):
            if not isinstance(body, list):
                continue
            for stmt, following in zip(body, body[1:]):
                call = stmt.value if isinstance(stmt, ast.Expr) else None
                if not (isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute)
                        and call.func.attr == "_implement_emit" and isinstance(following, ast.Raise)):
                    continue
                if any(isinstance(arg, ast.Constant) and arg.value == "ended_error" for arg in call.args):
                    raising += 1
                    flagged += any(kw.arg == "error_logged_elsewhere" and getattr(kw.value, "value", None) is True
                                   for kw in call.keywords)
    assert raising == 15 and flagged == raising, (raising, flagged)
    failed = source[source.index("    def _implement_failed("):]
    failed = failed[:failed.index("\n    def ", 10)]
    assert failed.count("self.logger.error(") == 2 and "error_logged_elsewhere=True" in failed


def _no_kpis(ns):
    return _churn_page(ns, kpis=[])


def _two_segments(ns):
    page = _churn_page(ns)
    page["filters"] = [f for f in page["filters"] if f["id"] != "region"]
    return page


def _reads_salaries(ns):
    page = _churn_page(ns)
    page["datasets"][0]["sql"] = "SELECT * FROM hr.s.salaries"
    return page


@pytest.mark.parametrize("make,write,stubs,needle", [
    (None, False, {}, "page.json was not written"),
    (lambda ns: "{not json", True, {}, "page.json is not valid JSON"),
    (_no_kpis, True, {}, "the page has 0 kpis; it needs 3 to 6"),
    (_two_segments, True, {}, "the page has 2 segment filters; add at least 3"),
    (_reads_salaries, True, {}, "the datasets read tables outside this use case: hr.s.salaries"),
    (None, True, {"_implement_input_has_dates": lambda context: True}, "add a second date range on that event date"),
    (None, True, {"_implement_run_query_check": lambda sql, require_rows=False, limit=20: [dict(TRUTH[0], priority_tier="Act now"),
                                                                                         TRUTH[1]]},
     "the records dataset changes priority tiers"),
    (None, True, {"_implement_run_query_check": lambda sql, require_rows=False, limit=20: (_ for _ in ()).throw(
        RuntimeError("TABLE_OR_VIEW_NOT_FOUND"))}, "dataset records failed: TABLE_OR_VIEW_NOT_FOUND"),
    (None, True, {"_implement_app_check": lambda work, files, modules, warehouse: ["page n01_u01: chart:by_category failed: boom"]},
     "the App was run at its default filters and page n01_u01: chart:by_category failed: boom"),
])
def test_a_page_json_that_breaks_a_rule_goes_back_to_genie_and_nothing_deploys(agent_ns, tmp_path, make, write, stubs, needle):
    inst, context, seen = _app_flow(agent_ns, tmp_path, page=make(agent_ns) if make else None, write=write, **stubs)
    assert inst._implement_app(context, None) == {}
    assert len(seen["errors"]) == 1 and needle in seen["errors"][0], seen["errors"]
    if make in (_no_kpis, _two_segments, _reads_salaries):
        assert seen["errors"][0].startswith("page.json does not fit the App: ")
    assert seen["deployed"] == []


def test_the_app_prompt_asks_for_page_json_only_with_the_example_tables_and_user_purpose(agent_ns, tmp_path):
    inst, context, seen = _app_flow(agent_ns, tmp_path, outputs={"app_purpose": "Let the retention lead see who leaves next"})
    inst._implement_app(context, None)
    prompt = seen["prompt"]
    assert seen["label"] == "App" and prompt.startswith("Write the file page.json in your working folder")
    assert ("What the user asked the App to show or let people do (this wins over every rule below): Let the retention lead see who "
            "leaves next") in prompt
    assert '"title": "Price-loss decision desk"' in prompt, "the example spec is shown in full"
    assert "reading only these tables: `main.inspire.churn_out`, `main.s.orders`." in prompt
    assert f"(WHERE {agent_ns['implement_latest_run_filter']('main.inspire.churn_out')})" in prompt
    assert "no second date range: the input tables carry no date" in prompt and "SQL warehouse wh1" in prompt
    assert "{kpi_id} and {kpi_id:change} placeholders" in prompt and "at least 3 multi_select segment filters" in prompt
    shown = re.search(r"there is no earlier run the App writes '([^']+)' in its place", prompt)
    words = inst._implement_app_shell()[1]["shell_sql"].CHANGE_WORDS
    assert shown and shown.group(1) == words["story_none"], "the prompt names the words the App really writes"
    assert "followed by what it compares against" in prompt
    assert "First, one date_range on as_of_date (the run date)" in prompt
    assert ('A scatter\'s x is {"label", "expression"} with an aggregate expression; it has exactly one y, no series, and "group": '
            'the name of the column whose values are its points, as a plain string.') in prompt
    assert 'A heatmap\'s x is a category column, its series {"column", "top"} is the second category' in prompt
    for word in ("Streamlit", "requirements.txt", "INSERT", "py_compile", "credentials_provider"):
        assert word not in prompt, word


def test_the_app_prompt_names_the_event_date_the_user_chose(agent_ns, tmp_path):
    inst, context, seen = _app_flow(agent_ns, tmp_path, _implement_input_has_dates=lambda context: True)
    inst._implement_app(context, None)
    assert "a second date_range on the event date of the input tables (the date the business event happened)" in seen["prompt"]
    inst, context, seen = _app_flow(agent_ns, tmp_path / "role")
    context["spec"]["data"]["column_roles"] = {"event_date": "main.s.orders.order_date"}
    inst._implement_app(context, None)
    assert "a second date_range on the event date `main.s.orders.order_date` of the datasets that carry it" in seen["prompt"]


def test_input_dates_are_read_from_the_input_tables_only(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    asked = []
    evidence = {"main.s.orders": {"columns": {"qty": {"type": "INT"}, "status": {"type": "STRING"}}}}
    inst._genie_table_evidence = lambda tables: asked.append(list(tables)) or evidence
    context = dict(_output_context(agent_ns), reasons_view=REASONS_VIEW)
    context["allowed"] = context["allowed"] + [REASONS_VIEW]
    assert inst._implement_input_has_dates(context) is False
    assert asked == [["main.s.orders"]], "the result table and the reasons view carry the run date, not an event date"
    evidence["main.s.orders"]["columns"]["ordered_at"] = {"type": "TIMESTAMP"}
    assert inst._implement_input_has_dates(context) is True


def test_the_app_check_runs_every_query_as_inspire_and_returns_the_shell_problems(agent_ns, tmp_path):
    from v141_app_shell_test import FakeWorkspace
    payload, modules = _app_shell(agent_ns, tmp_path)
    core = modules["shell_core"]
    page = agent_ns["implement_app_page"](_churn_page(agent_ns), "N01-U01", {})
    settings = agent_ns["implement_app_settings"](core.SETTINGS_VERSION, "N01-U01 Predict churn", [page["id"]], None, "off", "t",
                                                  {"app_access": "sp", "app_options": {"decisions": False}})
    files = agent_ns["implement_app_source"](payload["files"], core.SETTINGS_FILE, core.PAGES_DIR, settings, [page])
    inst = _inspire(agent_ns, FakeSpark())
    auth = lambda: {"Authorization": "Bearer inspire"}
    inst.w_client = types.SimpleNamespace(config=types.SimpleNamespace(host="https://h/", authenticate=auth))
    made, fake = [], FakeWorkspace()
    db = types.SimpleNamespace(Workspace=lambda host, headers: made.append((host, headers)) or fake, QueryError=modules["shell_db"].QueryError)
    work = tmp_path / "work"
    work.mkdir()
    assert inst._implement_app_check(str(work), files, dict(modules, shell_db=db), "wh1") == []
    assert made == [("https://h", auth)] and len(fake.sql) >= len(page["kpis"]) + len(page["charts"])
    assert sorted(os.listdir(work / "_app_check")) == ["inspire_app.json", "pages"]

    class Stopped(FakeWorkspace):
        def run_sql(self, warehouse, sql, params, limit=5000):
            if "'now' AS period" in sql:
                raise modules["shell_db"].QueryError("warehouse stopped")
            return super().run_sql(warehouse, sql, params, limit)

    db = types.SimpleNamespace(Workspace=lambda host, headers: Stopped(), QueryError=modules["shell_db"].QueryError)
    problems = inst._implement_app_check(str(work), files, dict(modules, shell_db=db), "wh1")
    assert len(problems) == len(page["kpis"]) and all(p.endswith("failed: warehouse stopped") for p in problems), problems
    broken = dict(files, **{core.SETTINGS_FILE: json.dumps(dict(settings, genie_note=""))})
    assert inst._implement_app_check(str(work), broken, dict(modules, shell_db=db), "wh1") == [
        "the App files do not hold together: Ask Genie is off, so genie_note must say why"]


@pytest.mark.parametrize("result, reason", [
    ({"errors": [], "stderr": "Reading additional input from stdin...\n\x1b[2m2026-11-04T16:08:18Z\x1b[0m \x1b[31mERROR\x1b[0m "
                                "\x1b[2mcodex_core::shell_snapshot\x1b[0m: snapshot failed\n"}, "it gave no reason"),
    ({"errors": [], "stderr": "\x1b[31mERROR\x1b[0m the model endpoint returned 403 PERMISSION_DENIED\n"
                                "\x1b[2mcodex_core::shell_snapshot\x1b[0m: snapshot failed\n"}, "ERROR the model endpoint returned 403 PERMISSION_DENIED"),
    ({"errors": ["Genie error: stream disconnected before completion"], "stderr": "\x1b[31mERROR\x1b[0m other\n"},
     "stream disconnected before completion"),
    ({}, "it gave no reason"),
])
def test_a_genie_exit_says_its_reason_in_plain_text_without_terminal_codes_or_cli_noise(agent_ns, result, reason):
    said = agent_ns["genie_exit_reason"](result)
    assert said == reason
    assert "\x1b" not in said and "shell_snapshot" not in said and "Reading additional input" not in said


@pytest.mark.parametrize("outcome, ended", [
    ({"status": "unknown", "text": "", "job_url": "https://example.net/runs/1"}, "without saying what it wrote"),
    ({"status": "unknown", "text": "{}"}, "with output Inspire does not read as a result"),
])
def test_a_preview_that_ends_without_its_outcome_sentence_says_so_in_plain_words_and_tells_genie_the_sentence(agent_ns, outcome, ended):
    said = agent_ns["implement_stop_message"](outcome, {})
    assert said == (f"the preview run did not write usable rows: the notebook ran but ended {ended}, so Inspire could not check its rows; "
                    "its run step must return how many rows it wrote or why it stopped, and the notebook must not end itself before that")
    assert "{" not in said and "job_url" not in said and "status" not in said
    for word in ("run_id", "as_of_date", "wrote N rows", "stopped without writing", "'"):
        assert word not in said, word


def test_a_failed_preview_after_a_genie_build_that_did_not_finish_says_genie_did_not_finish(agent_ns):
    inst = _flow_inspire(agent_ns, [({"status": "failed", "error": "25.7% of the periods have no data"}, 11, 103)])
    crashed = {"exit": 1, "final": {}, "stderr": "", "errors": ["Genie error: Genie returned no JSON result"]}
    runner = _FakeRunner([dict(crashed), dict(crashed), dict(crashed)])
    spec = agent_ns["validate_implement_spec"](VALID)[0]
    outcome, _job, _fill = inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 2), {}, spec, {"outputs": {}}, "/W/nb",
                                                            ["result_table", "run_profile"], runner, True)
    assert outcome["status"] == "failed" and outcome["build_problems"][0] == "Genie exited with code 1: Genie returned no JSON result"
    message = agent_ns["implement_stop_message"](outcome, spec)
    assert message.startswith("Genie's last build round did not finish (Genie exited with code 1: Genie returned no JSON result")
    assert message.endswith("so the notebook may not hold the latest choices and asks, and the preview run did not write usable "
                            "rows: 25.7% of the periods have no data")


def test_a_stop_reason_or_an_error_is_still_the_reason_of_the_stop_message(agent_ns):
    stop = agent_ns["implement_stop_message"]
    assert stop({"status": "stopped", "stop_reason": "no rows match"}, {}) == "the preview run did not write usable rows: no rows match"
    assert stop({"status": "failed", "error": "boom"}, {}) == "the preview run did not write usable rows: boom"
    assert stop({}, {}) == "the preview run did not write usable rows: no reason given"


def test_a_round_that_fails_exactly_as_the_round_before_is_told_its_change_did_not_reach_the_failure(agent_ns):
    inst = _flow_inspire(agent_ns, [])
    marker = "This is the same failure, word for word, as your previous round"
    same = _FakeRunner([{"exit": 0}] * 3)
    with pytest.raises(RuntimeError, match="after 3 Genie rounds"):
        inst._implement_genie_loop(dict(LOOP_CONTEXT), same, "App", "write it",
                                   lambda w: (_ for _ in ()).throw(RuntimeError("chart fare_by_hour is a line")))
    assert marker not in same.prompts[1] and marker in same.prompts[2]
    reasons = iter(["chart fare_by_hour is a line", "chart trips_per_corridor is a bar", "chart fare_by_hour is a line"])
    changing = _FakeRunner([{"exit": 0}] * 3)
    with pytest.raises(RuntimeError, match="after 3 Genie rounds"):
        inst._implement_genie_loop(dict(LOOP_CONTEXT), changing, "App", "write it",
                                   lambda w: (_ for _ in ()).throw(RuntimeError(next(reasons))))
    assert not any(marker in p for p in changing.prompts)
