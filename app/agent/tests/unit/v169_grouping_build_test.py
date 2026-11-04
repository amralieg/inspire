import ast
import json
import os
import sys

import pytest

from _agentload import agent_source
from v120_artifacts_support import FakeSpark
from v120_genie_support import build_inspire, make_uc
from v130_genie_run_controls_test import INSTRUCTION, _controls, _dbutils, _launcher
from v142_scd_test import ROOT

SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_sql  # noqa: E402

GROUPING = {"applies": True, "columns": ["region", "country", "channel"], "default": "region, country", "recommended": ["region", "country"],
            "time_column": "order_date", "link": "https://inspire.example.com/?review=7&uc=N01-U01", "table": "main.sales.orders",
            "chosen_by": "person"}


def _spec(inst, grouping=None, technique="Anomaly Detection"):
    uc = make_uc(**{"Analytics Technique": technique, "_implement_grouping": dict(grouping or {})})
    return uc, inst._genie_notebook_spec(uc)


def test_grouping_is_a_run_setting_with_its_columns_custom_and_all_standing_alone(agent_ns):
    inst = build_inspire(agent_ns)
    _uc, spec = _spec(inst, GROUPING)
    widgets = inst._genie_core_widgets(spec)
    [widget] = [w for w in widgets if w["name"] == "group_by"]
    assert widget["default"] == "region, country" and widget["label"].startswith("Grouping")
    model = agent_ns["inspire_settings_model"](spec, widgets)
    [setting] = [s for s in model if s["name"] == "group_by"]
    assert (setting["kind"], setting["many"], setting["group"], setting["label"], setting["source"]) == ("choice", True, "scope", "Grouping", "widget")
    assert setting["choices"] == ["region", "country", "channel", "custom"] and setting["solo"] == ["all", "custom"]
    assert "moves up a level" in setting["help"]
    [run_setting] = [s for s in agent_ns["inspire_run_settings_model"](model) if s["name"] == "group_by"]
    assert run_setting["solo"] == ["all", "custom"] and run_setting["choices"] == setting["choices"]
    _plain_uc, plain = _spec(inst, None)
    assert "group_by" not in [w["name"] for w in inst._genie_core_widgets(plain)], "no grouping setting where grouping does not apply"


@pytest.mark.parametrize("value,ok", [("region", True), ("region, country", True), ("all", True), ("custom", True),
                                      ("country, channel", True), ("region, all", False), ("custom, region", False), ("city", False),
                                      ("", False), ("all, custom", False)])
def test_the_agent_and_the_app_server_check_a_grouping_value_the_same_way(agent_ns, value, ok):
    inst = build_inspire(agent_ns)
    _uc, spec = _spec(inst, GROUPING)
    [setting] = [s for s in agent_ns["inspire_settings_model"](spec, inst._genie_core_widgets(spec)) if s["name"] == "group_by"]
    agent, server = agent_ns["inspire_setting_problem"](setting, value), shell_sql.setting_problem(setting, value)
    assert agent == server
    assert (agent == "") is ok, (value, agent)
    if value in ("region, all", "custom, region"):
        assert "alone, never with another choice" in agent
    flags = {"name": "flag_segments", "kind": "choice", "many": True, "choices": ["EU", "UK"]}
    assert agent_ns["inspire_setting_problem"](flags, "EU, all") == shell_sql.setting_problem(flags, "EU, all") == "", "flag_segments keeps its rule"


def test_the_build_instruction_carries_the_grouping_rule_only_where_grouping_applies(agent_ns):
    inst = build_inspire(agent_ns)
    _uc, spec = _spec(inst, GROUPING)
    rules = inst._genie_platform_rules(spec)
    assert "inspire_group_records(records, group_by=group_by, time_column=\"order_date\")" in rules
    assert "partitionBy(\"inspire_group\")" in rules and "`region`, `country`, `channel`" in rules and "fewer than 30 records" in rules
    _plain_uc, plain = _spec(inst, None)
    assert "inspire_group_records" not in inst._genie_platform_rules(plain)


def test_the_run_controls_carry_the_grouping_columns_time_column_and_run_page_link(agent_ns):
    inst = build_inspire(agent_ns)
    uc, spec = _spec(inst, GROUPING)
    source = inst._genie_run_controls_source(uc, spec, INSTRUCTION)
    run = ast.literal_eval(source.split("INSPIRE_RUN = ", 1)[1].split("\n\n\n", 1)[0])
    assert run["grouping"] == {"columns": ["region", "country", "channel"], "time_column": "order_date", "link": GROUPING["link"]}
    plain_uc, plain = _spec(inst, None)
    plain_run = ast.literal_eval(inst._genie_run_controls_source(plain_uc, plain, INSTRUCTION).split("INSPIRE_RUN = ", 1)[1].split("\n\n\n", 1)[0])
    assert "grouping" not in plain_run


GOOD = '''
def score(records, group_by):
    records = inspire_group_records(records, group_by=group_by)
    window = Window.partitionBy("inspire_group")
    return records.withColumn("z", F.col("amount") - F.avg("amount").over(window))
'''


@pytest.mark.parametrize("code,found", [
    (GOOD, []),
    (GOOD.replace('Window.partitionBy("inspire_group")', 'Window.partitionBy(INSPIRE_GROUP_COLUMN)'), []),
    ("def score(df, group_by):\n    df = inspire_group_records(df, group_by=group_by)\n    return df.groupby(['inspire_group', 'day']).mean()\n", []),
    ("def score(df, group_by):\n    return df.groupBy('region').mean()\n", ["no cell calls inspire_group_records"]),
    (GOOD.replace("group_by=group_by", 'group_by="region, country"'), ["calls inspire_group_records without the group_by variable"]),
    (GOOD.replace("records, group_by=group_by", "records"), ["calls inspire_group_records without the group_by variable"]),
    (GOOD.replace('Window.partitionBy("inspire_group")', 'Window.partitionBy("region")'), ["is partitioned by inspire_group"]),
    (GOOD + "\ndef inspire_group_records(frame, group_by=None):\n    return frame\n", ["defines inspire_group_records"]),
])
def test_the_build_check_refuses_code_that_ignores_the_grouping(agent_ns, code, found):
    problems = agent_ns["implement_grouping_problems"]([("cell 3", code)], GROUPING)
    assert len(problems) == len(found) and all(text in problem for text, problem in zip(found, problems)), problems
    assert agent_ns["implement_grouping_problems"]([("cell 3", "x = 1\n")], {"applies": False}) == []


def test_the_cell_check_runs_the_grouping_check_with_the_spec_grouping(agent_ns):
    inst = build_inspire(agent_ns)
    inst._implement_genie_cells = lambda path, purpose: [("cell 3", "def run_use_case():\n    return 1\n")]
    assert any("no cell calls inspire_group_records" in p for p in inst._implement_cell_problems("/n", grouping=GROUPING))
    assert not any("inspire_group_records" in p for p in inst._implement_cell_problems("/n"))
    assert agent_source().count("grouping=spec_nb.get(\"grouping\"))") == 1, "the Genie build loop passes the spec grouping"
    assert agent_source().count("proof = self._implement_grouping_proof(") == 1, "the build loop runs the grouping proof"
    assert agent_source().count('use_case["_implement_grouping"] = self._implement_grouping(use_case, spec, key, tables)') == 1


@pytest.mark.parametrize("technique,candidates,chosen,recommended,applies,default,columns", [
    ("Anomaly Detection", ["region", "country"], "", ["region", "country"], True, "region, country", ["region", "country"]),
    ("Anomaly Detection", ["region"], "", [], True, "all", ["region"]),
    ("Text Classification", ["region"], "", [], False, "", []),
    ("Anomaly Detection", [], "", [], False, "", []),
    ("Text Classification", ["region"], "region", [], True, "region", ["region"]),
    ("Anomaly Detection", ["region"], "store_type", [], True, "store_type", ["region", "store_type"]),
    ("Anomaly Detection", ["region"], "custom", [], True, "custom", ["region"]),
    ("Anomaly Detection", ["region"], "all", ["region"], True, "all", ["region"]),
])
def test_the_build_plan_follows_the_person_first_then_the_technique_and_the_recommendation(agent_ns, technique, candidates, chosen,
                                                                                           recommended, applies, default, columns):
    plan = agent_ns["implement_grouping_plan"](technique, candidates, chosen, "day", recommended)
    assert (plan["applies"], plan["default"], plan["columns"]) == (applies, default, columns)
    assert plan["time_column"] == ("day" if applies else "")
    assert plan["chosen_by"] == ("person" if chosen else "Inspire" if recommended else "default")
    mixed = agent_ns["implement_grouping_plan"](technique, candidates, "region, all", "", [])
    assert mixed["problem"] == "group_by is 'region, all'; all and custom each stand alone"


def test_the_candidate_columns_are_the_main_table_category_and_key_columns_taken_in_turn_and_the_segment_role_first(agent_ns):
    columns = [{"column_name": n, "data_type": t} for n, t in (("order_id", "string"), ("customer_id", "bigint"), ("region", "string"),
                                                               ("country", "varchar(40)"), ("amount", "double"), ("order_date", "date"),
                                                               ("review_text", "string"), ("store_key", "string"), ("is_online", "boolean"),
                                                               ("channel", "string"), ("label", "string"))]
    roles = {"entity_id": "main.sales.orders.order_id", "segment": "main.sales.orders.channel", "label": "main.sales.orders.label",
             "event_date": "main.sales.orders.order_date", "measure": "main.other.t.region"}
    picked = agent_ns["implement_grouping_candidates"](columns, roles, "`main`.`sales`.`orders`", ("text", "review"))
    assert picked == ["channel", "region", "customer_id", "country", "store_key", "is_online"]


TABLE_STATS = [{"col_name": "region", "data_type": "string", "comment": None},
               {"col_name": "Statistics", "data_type": "88231 bytes, 9000 rows", "comment": ""}]


def _column_stats(distinct):
    return [{"info_name": "col_name", "info_value": "x"}, {"info_name": "distinct_count", "info_value": distinct}]


def _stats_spark(distinct, table_rows=TABLE_STATS):
    def answer(statement):
        if statement == "DESCRIBE TABLE EXTENDED `main`.`sales`.`orders`":
            return table_rows
        column = statement.rsplit("`", 2)[-2]
        return _column_stats(distinct.get(column, "NULL"))
    return FakeSpark(responder=answer)


def test_the_recommendation_reads_only_the_table_and_column_statistics_never_a_row(agent_ns):
    spark = _stats_spark({"region": "5", "country": "40", "a": "3", "b": "3", "c": "3", "d": "3", "e": "3", "f": "3"})
    inst = build_inspire(agent_ns, spark=spark)
    assert inst._implement_grouping_recommendation("N01-U01", "main.sales.orders", ["region", "country"]) == ["region"]
    assert spark.statements == ["DESCRIBE TABLE EXTENDED `main`.`sales`.`orders`",
                                "DESCRIBE TABLE EXTENDED `main`.`sales`.`orders` `region`",
                                "DESCRIBE TABLE EXTENDED `main`.`sales`.`orders` `country`"]
    many = _stats_spark({})
    build_inspire(agent_ns, spark=many)._implement_grouping_recommendation("N01-U01", "main.sales.orders", list("abcdefgh"))
    assert len(many.statements) == 1 + agent_ns["IMPLEMENT_GROUP_PROFILED"] and not any("`g`" in s for s in many.statements)
    assert all(s.startswith("DESCRIBE TABLE EXTENDED ") for s in spark.statements + many.statements)


@pytest.mark.parametrize("distinct,table_rows,expected", [
    ({"region": "5", "country": "40"}, TABLE_STATS, ["region"]),
    ({"region": "NULL", "country": "40"}, TABLE_STATS, ["country"]),
    ({"region": "1", "country": "600"}, TABLE_STATS, []),
    ({"region": "400"}, TABLE_STATS, []),
    ({"region": "5", "country": "40"}, TABLE_STATS[:1], []),
    ({}, TABLE_STATS, []),
])
def test_a_column_is_recommended_only_when_its_statistics_show_usable_groups(agent_ns, distinct, table_rows, expected):
    inst = build_inspire(agent_ns, spark=_stats_spark(distinct, table_rows))
    assert inst._implement_grouping_recommendation("N01-U01", "main.sales.orders", ["region", "country"]) == expected


def test_the_stats_profile_reads_the_row_count_and_the_distinct_count(agent_ns):
    profile = agent_ns["implement_grouping_stats_profile"]
    assert profile("region", TABLE_STATS, _column_stats("5")) == {"column": "region", "groups": 5, "records": 9000}
    assert profile("region", TABLE_STATS, _column_stats("NULL")) is None
    assert profile("region", TABLE_STATS[:1], _column_stats("5")) is None
    assert profile("region", [], []) is None


def test_a_statistics_read_that_fails_leaves_no_recommendation(agent_ns):
    broken = build_inspire(agent_ns, spark=FakeSpark(responder=lambda s: (_ for _ in ()).throw(RuntimeError("PERMISSION_DENIED"))))
    assert broken._implement_grouping_recommendation("N01-U01", "main.sales.orders", ["region"]) == []


def test_the_proof_tables_take_their_names_from_the_result_table(agent_ns):
    name = agent_ns["implement_grouping_proof_table"]
    assert [name("main.inspire.n01_out", part) for part in agent_ns["IMPLEMENT_GROUP_PROOF_PARTS"]] == [
        f"main.inspire.n01_out_inspire_group_proof{suffix}" for suffix in ("", "_summary", "_run_log", "_assumptions", "_inspire_stage")]
    with pytest.raises(ValueError):
        name("main.inspire.n01_out", "other")


def _wspec(group_by):
    return {"config": {"widgets": {"group_by": group_by, "min_rows": "100"}}}


def test_a_grouping_change_inside_the_built_columns_is_a_settings_change_and_another_column_rebuilds(agent_ns):
    built = ["group_by", "min_rows"]
    choices = ["region", "country", "custom"]
    classify = agent_ns["classify_implement_change"]
    assert classify(_wspec("region"), _wspec("region, country"), built, None, choices) == ["settings"]
    assert classify(_wspec("region"), _wspec("all"), built, None, choices) == ["settings"]
    assert classify(_wspec("region"), _wspec("custom"), built, None, choices) == ["settings"]
    assert classify(_wspec("region"), _wspec("region, city"), built, None, choices) == ["config"], "a column the notebook does not read rebuilds"
    assert classify(_wspec("region"), _wspec("City"), built, None, ["city"]) == ["settings"], "column names match in any case"
    assert agent_ns["implement_grouping_unread"]("region, city, store", choices) == ["city", "store"]
    assert agent_ns["implement_grouping_unread"]("city", None) == [], "no built grouping setting, the existing widget rule decides"
    status = {"settings": [{"name": "group_by", "source": "widget", "choices": choices}, {"name": "min_rows", "source": "widget"}]}
    assert agent_ns["implement_built_grouping"](status) == choices and agent_ns["implement_built_grouping"]({"settings": []}) is None
    assert "does not read" in agent_ns["IMPLEMENT_GROUP_REBUILD"].format(columns="city")


@pytest.mark.parametrize("record,asked,ok", [
    ({"mode": "all", "group_by": "all", "groups": 1}, "all", True),
    ({"mode": "all", "group_by": "all", "groups": 3}, "all", False),
    ({"mode": "columns", "group_by": ["Region", "Country"], "groups": 12}, "region, country", True),
    ({"mode": "columns", "group_by": ["region"], "groups": 4}, "region, country", False),
    ({"mode": "all", "group_by": "all", "groups": 1}, "region", False),
    ({"mode": "custom", "group_by": "custom", "groups": 5}, "custom", True),
    (None, "region", False),
])
def test_the_build_proof_compares_the_recorded_groups_with_the_setting(agent_ns, record, asked, ok):
    problems = agent_ns["implement_grouping_proof_problems"](record, asked, "r-1")
    assert (problems == []) is ok, problems
    if record is None:
        assert "no step called inspire_group_records" in problems[0]


def _proof_inst(agent_ns, records):
    calls = {"updates": [], "dropped": [], "previews": []}
    spark = FakeSpark(responder=lambda s: [{"run_grouping": json.dumps(records[s.split("run_id = '")[1].split("'")[0]])}]
                      if s.startswith("SELECT run_grouping") else [])
    record_sql = spark.sql

    def sql(statement, *args, **kwargs):
        if str(statement).startswith("UPDATE "):
            calls["updates"].append(dict(kwargs.get("args") or {}))
        return record_sql(statement, *args, **kwargs)

    spark.sql = sql
    inst = build_inspire(agent_ns, spark=spark)

    def preview(uc_id, key, use_case, spec, spec_nb, path, names, overrides=None):
        calls["previews"].append((use_case["result_table"], dict(overrides or {})))
        inst._implement_update(key, job_id=11, last_preview_run_id=9002)
        return {"status": "written", "run_id": "r-proof"}, 11, 9002

    inst._implement_preview = preview
    return inst, calls, spark


def test_the_build_proof_runs_the_notebook_again_with_all_into_a_scratch_table_and_cleans_up(agent_ns):
    records = {"r-main": {"mode": "columns", "group_by": ["region", "country"], "groups": 9},
               "r-proof": {"mode": "all", "group_by": "all", "groups": 1}}
    inst, calls, spark = _proof_inst(agent_ns, records)
    spec_nb = {"grouping": GROUPING, "model_name": "main.inspire.n01_model"}
    use_case = {"result_table": "main.inspire.n01_out"}
    gate = inst._implement_grouping_proof("N01-U01", (7, "N01-U01", 2), use_case, _wspec("region, country"), spec_nb, "/n", ["group_by"],
                                          {"status": "written", "run_id": "r-main"}, 9001)
    assert gate is None
    [(table, overrides)] = calls["previews"]
    assert table == "main.inspire.n01_out_inspire_group_proof" and overrides == {
        "result_table": "main.inspire.n01_out_inspire_group_proof", "group_by": "all", "model_name": "main.inspire.n01_model_inspire_group_proof"}
    restore = [s for s in spark.statements if s.startswith("UPDATE ")][-1]
    assert "SET `last_preview_run_id` = CAST(:p0 AS BIGINT)," in restore
    assert calls["updates"][-1] == {"sid": 7, "uc": "N01-U01", "v": 2, "p0": 9001}, "the App keeps showing the real preview run"
    dropped = [s for s in spark.statements if s.startswith("DROP TABLE IF EXISTS")]
    assert dropped == [f"DROP TABLE IF EXISTS `main`.`inspire`.`n01_out_inspire_group_proof{suffix}`"
                       for suffix in ("", "_summary", "_run_log", "_assumptions", "_inspire_stage")]
    inst.w_client.registered_models.delete.assert_called_once_with(full_name="main.inspire.n01_model_inspire_group_proof")


def test_the_build_proof_drops_its_scratch_tables_even_when_the_preview_run_id_cannot_be_put_back(agent_ns):
    records = {"r-main": {"mode": "columns", "group_by": ["region", "country"], "groups": 9},
               "r-proof": {"mode": "all", "group_by": "all", "groups": 1}}
    inst, calls, spark = _proof_inst(agent_ns, records)
    real_update = inst._implement_update

    def update(key, **fields):
        if fields == {"last_preview_run_id": 9001}:
            raise RuntimeError("the tracking table is locked")
        return real_update(key, **fields)

    inst._implement_update = update
    with pytest.raises(RuntimeError, match="locked"):
        inst._implement_grouping_proof("N01-U01", (7, "N01-U01", 2), {"result_table": "main.inspire.n01_out"}, _wspec("region, country"),
                                       {"grouping": GROUPING}, "/n", ["group_by"], {"status": "written", "run_id": "r-main"}, 9001)
    dropped = [s for s in spark.statements if s.startswith("DROP TABLE IF EXISTS")]
    assert len(dropped) == 5 and all("n01_out_inspire_group_proof" in s for s in dropped)


def test_the_build_proof_sends_back_a_notebook_that_ignores_the_setting(agent_ns):
    records = {"r-main": {"mode": "columns", "group_by": ["region", "country"], "groups": 9},
               "r-proof": {"mode": "columns", "group_by": ["region", "country"], "groups": 9}}
    inst, calls, _spark = _proof_inst(agent_ns, records)
    gate = inst._implement_grouping_proof("N01-U01", (7, "N01-U01", 2), {"result_table": "main.inspire.n01_out"}, _wspec("region, country"),
                                          {"grouping": GROUPING}, "/n", ["group_by"], {"status": "written", "run_id": "r-main"}, 9001)
    assert gate["kind"] == "notebook" and gate["fixable"]
    assert calls["updates"][-1] == {"sid": 7, "uc": "N01-U01", "v": 2, "p0": 9001}
    assert "run r-proof ran with the Grouping all, but its records were grouped by region, country into 9 groups" in gate["feedback"]
    records["r-main"] = None
    inst, calls, _spark = _proof_inst(agent_ns, records)
    gate = inst._implement_grouping_proof("N01-U01", (7, "N01-U01", 2), {"result_table": "main.inspire.n01_out"}, _wspec("region, country"),
                                          {"grouping": GROUPING}, "/n", ["group_by"], {"status": "written", "run_id": "r-main"}, 9001)
    assert "no step called inspire_group_records" in gate["feedback"] and calls["previews"] == [], "no second run when the first ignored it"
    assert calls["updates"] == [], "no second run, so the preview run id is left alone"


def test_a_grouping_stop_ends_the_run_as_stopped_before_scoring_and_records_why(agent_ns):
    ns, _call = _controls(agent_ns)
    marker = agent_ns["INSPIRE_CHILD_MARKER"]
    ns["spark"] = FakeSpark()

    def run_use_case():
        raise ns["inspire_group_stop"]("the saved grouping SQL failed when it ran over main.geo.countries (TABLE_OR_VIEW_NOT_FOUND)",
                                       {"grouping": {"link": GROUPING["link"]}})

    ns["run_use_case"] = run_use_case
    dbu = _dbutils(**{marker: "1", "refresh_requested_by": "schedule"})
    ns["dbutils"] = dbu
    dbu.notebook.exit = dbu.notebook.exits.append
    launcher, _calls = _launcher(ns)
    printed = []
    gate = ns["inspire_main"](dbu=dbu, launcher_cls=launcher, out=printed.append)
    assert gate["outcome"].startswith("stopped without writing: Grouping: the saved grouping SQL failed when it ran over main.geo.countries")
    assert gate["outcome"].endswith(f"so this run stopped before it scored any record; change the grouping on the Run page: {GROUPING['link']}")
    assert any("not_reliable" in s and "Grouping: the saved grouping SQL failed" in s for s in ns["spark"].statements)
