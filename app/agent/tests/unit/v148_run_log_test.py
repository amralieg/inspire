import ast
import datetime
import inspect
import json
import os
import re
import sqlite3
import sys

import pytest

from _agentload import agent_source
from v120_artifacts_support import FakeSpark
from v120_genie_support import build_inspire, make_uc
from v130_genie_run_controls_test import _controls, _dbutils, _launcher
from v142_scd_test import QUOTED_SUMMARY, ROOT, SUMMARY, TABLE, _describe

SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_core  # noqa: E402

RUN_LOG = [("run_started_at", "timestamp"), ("run_ended_at", "timestamp"), ("run_trigger", "string"), ("run_segments", "string"),
           ("run_tables", "string"), ("run_stages", "string"), ("run_grouping", "string")]
ORDERS, STORES = "main.sales.orders", "main.sales.stores_v"
SEGMENTS = [{"table": ORDERS, "column": "region", "op": "in", "values": ["EU", "UK"]},
            {"table": ORDERS, "column": "amount", "op": ">=", "values": ["100"]},
            {"table": STORES, "column": "channel", "op": "=", "values": ["online"]}]
CHANGED = datetime.datetime(2026, 10, 27, 6, 30, 5)


def _spark(fail=None, history=True):
    def respond(statement):
        if fail and statement.startswith(fail):
            raise RuntimeError(f"PERMISSION_DENIED: {fail}")
        if statement.startswith("SELECT COUNT(*) AS n FROM `main`.`sales`.`orders`"):
            return [{"n": 1240}]
        if statement.startswith("SELECT COUNT(*) AS n FROM `main`.`sales`.`stores_v`"):
            return [{"n": 12}]
        if statement == "DESCRIBE HISTORY `main`.`sales`.`orders` LIMIT 1":
            return [{"version": 9, "timestamp": CHANGED}]
        if statement == "DESCRIBE HISTORY `main`.`sales`.`stores_v` LIMIT 1":
            raise RuntimeError("[DELTA_ONLY_OPERATION] DESCRIBE HISTORY is only supported for Delta tables")
        if statement.startswith("SELECT last_altered AS timestamp FROM `main`.information_schema.tables"):
            return [{"timestamp": "2026-10-01T00:00:00Z"}]
        if statement == f"DESCRIBE TABLE {QUOTED_SUMMARY}":
            return _describe(SUMMARY)
        return []
    return FakeSpark(responder=respond)


def _merge_values(statement):
    sets = statement.split("WHEN MATCHED THEN UPDATE SET ", 1)[1].split(", updated_at = current_timestamp()", 1)[0]
    return dict(re.findall(r"`(\w+)` = ((?:'(?:\\.|[^'])*'|[^,])+)", sets))


def _unquote(literal):
    return ast.literal_eval(literal)


def test_the_summary_table_has_the_run_log_columns_and_is_never_altered(agent_ns):
    assert agent_ns["INSPIRE_RUN_LOG_COLUMNS"] == tuple((n, k.upper()) for n, k in RUN_LOG)
    create = agent_ns["inspire_ai_summary_create_sql"](TABLE)
    assert ("nothing_to_act STRING, run_started_at TIMESTAMP, run_ended_at TIMESTAMP, run_trigger STRING, run_segments STRING, "
            "run_tables STRING, run_stages STRING, run_grouping STRING, ai_checks STRING, value_formula STRING, value_expression STRING, value_assumptions STRING, accepted BOOLEAN, "
            "preview_sample_entities BIGINT, passing_records BIGINT, act_now_share DOUBLE, review_share DOUBLE, "
            "impact_kind STRING, impact_unit STRING, kpi_name STRING, kpi_source STRING, kpi_direction STRING, kpi_unit STRING, kpi_baseline DOUBLE, kpi_baseline_on STRING, kpi_latest DOUBLE, kpi_target DOUBLE, kpi_target_text STRING, kpi_status STRING, kpi_reason STRING, kpi_measured_at TIMESTAMP, kpi_query STRING, act_now_capacity BIGINT, over_capacity_records BIGINT, not_reliable STRING, run_facts STRING, "
            "updated_at TIMESTAMP)") in create and create.startswith("CREATE TABLE IF NOT EXISTS")
    old = [c for c in SUMMARY if c not in RUN_LOG]
    spark = FakeSpark(responder=lambda s: _describe(old) if s == f"DESCRIBE TABLE {QUOTED_SUMMARY}" else [])
    agent_ns["inspire_ensure_summary"](spark, TABLE)
    assert spark.statements == [create], "a summary is created with every column and never read or altered"


@pytest.mark.parametrize("execution,asked,trigger", [
    ("child", "schedule", "schedule"), ("child", "", "schedule"), ("child", " schedule ", "schedule"), ("child", "build", "build"),
    ("child", "ana@example.com", "refresh"), ("child", "the notebook", "refresh"), ("here", "schedule", "build"),
    ("here", "ana@example.com", "build"),
])
def test_the_trigger_comes_from_who_asked_for_the_run(agent_ns, execution, asked, trigger):
    assert agent_ns["inspire_run_trigger"](execution, asked) == trigger
    assert agent_ns["IMPLEMENT_REFRESH_PARAMETER"] == agent_ns["INSPIRE_REQUESTED_BY"] == "refresh_requested_by"
    assert (agent_ns["IMPLEMENT_REFRESH_DEFAULT"], agent_ns["IMPLEMENT_BUILD_REQUEST"]) == ("schedule", "build")


def test_the_run_log_records_its_start_trigger_slices_and_tables(fresh_ns):
    fresh_ns["INSPIRE_RUN"] = {"source_tables": [ORDERS, STORES], "segments": SEGMENTS}
    fresh_ns["dbutils"] = _dbutils(refresh_requested_by="ana@example.com")
    fresh_ns["_inspire_time"] = type("T", (), {"time": staticmethod(lambda: 1761633000.25), "sleep": staticmethod(lambda s: None)})
    log = fresh_ns["inspire_run_log_start"]("child")
    assert log == {"started_us": int(1761633000.25 * 1000000), "trigger": "refresh", "written": [], "stages": [], "table": None}
    assert fresh_ns["INSPIRE_RUN_LOG"] is log
    spark, printed = _spark(), []
    values = fresh_ns["inspire_save_run_log"](spark, TABLE, "N01-U01", "r-2", printed.append)
    counts = [s for s in spark.statements if s.startswith("SELECT COUNT(*)")]
    assert counts == ["SELECT COUNT(*) AS n FROM `main`.`sales`.`orders` WHERE CAST(`region` AS STRING) IN ('EU', 'UK') AND `amount` >= 100",
                      "SELECT COUNT(*) AS n FROM `main`.`sales`.`stores_v` WHERE CAST(`channel` AS STRING) IN ('online')"]
    merge = [s for s in spark.statements if s.startswith(f"MERGE INTO {QUOTED_SUMMARY}")][-1]
    assert merge.startswith(f"MERGE INTO {QUOTED_SUMMARY} AS s USING (SELECT 'N01-U01' AS use_case_id, 'r-2' AS run_id)")
    written = _merge_values(merge)
    assert written["run_started_at"] == "timestamp_micros(1761633000250000)" and written["run_trigger"] == "'refresh'"
    assert json.loads(_unquote(written["run_segments"])) == [{"column": "region", "values": ["EU", "UK"]},
                                                             {"column": "amount", "values": ["100"], "op": ">="},
                                                             {"column": "channel", "values": ["online"]}]
    unscoped = {"scoped": False, "read_by_helper": False}
    assert json.loads(_unquote(written["run_tables"])) == [
        dict(unscoped, table=ORDERS, rows=1240, rows_total=1240, updated_at="2026-10-27T06:30:05Z"),
        dict(unscoped, table=STORES, rows=12, rows_total=12, updated_at="2026-10-01T00:00:00Z")]
    assert values == {k: written[k] for k in ("run_started_at", "run_trigger", "run_segments", "run_tables", "run_grouping")}
    assert written["run_grouping"] == "NULL", "a run that grouped nothing records no grouping"
    assert printed == ["Run log: run r-2 was started by a refresh and read 2 tables for region in EU, UK; amount >= 100; "
                       "channel in online"]
    assert log["written"] == [(TABLE, "N01-U01", "r-2")]
    fresh_ns["_inspire_time"] = type("T", (), {"time": staticmethod(lambda: 1761633090.0), "sleep": staticmethod(lambda s: None)})
    ended = FakeSpark()
    assert fresh_ns["inspire_run_log_end"](log, spark_session=ended, out=printed.append) == "timestamp_micros(1761633090000000)"
    [end] = ended.statements
    assert _merge_values(end) == {"run_ended_at": "timestamp_micros(1761633090000000)"} and "'r-2' AS run_id" in end
    assert "INSPIRE_RUN_LOG" not in fresh_ns, "a later run in the same session never reuses this run's start"


def test_a_run_over_all_data_logs_empty_slices_and_a_run_without_main_logs_no_start(fresh_ns):
    fresh_ns["INSPIRE_RUN"] = {"source_tables": [ORDERS], "segments": []}
    spark, printed = _spark(), []
    fresh_ns["inspire_save_run_log"](spark, TABLE, "N01-U01", "r-3", printed.append)
    written = _merge_values(spark.statements[-1])
    assert written["run_segments"] == "'[]'" and written["run_started_at"] == "NULL" and written["run_trigger"] == "'build'"
    assert "SELECT COUNT(*) AS n FROM `main`.`sales`.`orders`" in spark.statements
    assert printed == ["Run log: run r-3 was started by the build and read 1 table with all their data"]
    assert "INSPIRE_RUN_LOG" not in fresh_ns, "a write outside inspire_main() leaves no run log behind"


def test_a_failed_count_history_or_summary_write_never_stops_the_run(fresh_ns):
    fresh_ns["INSPIRE_RUN"] = {"source_tables": [ORDERS], "segments": SEGMENTS}
    spark, printed = _spark(fail="SELECT COUNT(*)"), []
    fresh_ns["inspire_save_run_log"](spark, TABLE, "N01-U01", "r-2", printed.append)
    assert json.loads(_unquote(_merge_values(spark.statements[-1])["run_tables"])) == [
        {"table": ORDERS, "rows": None, "rows_total": None, "scoped": False, "read_by_helper": False, "updated_at": "2026-10-27T06:30:05Z"}]
    assert printed[0] == "Run log: Inspire could not count the rows of main.sales.orders this run covered: PERMISSION_DENIED: SELECT COUNT(*)"
    broken, printed = _spark(fail="MERGE INTO"), []
    assert fresh_ns["inspire_save_run_log"](broken, TABLE, "N01-U01", "r-2", printed.append) is None
    assert printed == ["Run log: run r-2 wrote its rows, but Inspire could not record when it ran and what it read in "
                       "main.inspire.churn_out_summary: PERMISSION_DENIED: MERGE INTO"]
    log = {"started_us": 1, "trigger": "schedule", "written": [(TABLE, "N01-U01", "r-2")]}
    ended, printed = _spark(fail="MERGE INTO"), []
    fresh_ns["inspire_run_log_end"](log, spark_session=ended, out=printed.append)
    assert printed == ["Run log: Inspire could not record when run r-2 ended in main.inspire.churn_out_summary: PERMISSION_DENIED: MERGE INTO"]
    assert fresh_ns["inspire_run_log_end"]({"written": []}, spark_session=ended) is None


@pytest.mark.parametrize("segment,kept", [
    ({"column": "region", "op": "=", "values": ["EU"]}, ["a", "c"]),
    ({"column": "region", "op": "in", "values": ["EU", "UK"]}, ["a", "b", "c"]),
    ({"column": "region", "op": "!=", "values": ["EU"]}, ["b", "d"]),
    ({"column": "region", "op": "not in", "values": ["EU", "UK"]}, ["d"]),
    ({"column": "amount", "op": ">=", "values": ["100"]}, ["b", "c"]),
    ({"column": "amount", "op": "<", "values": ["100"]}, ["a", "d"]),
    ({"column": "amount", "op": "between", "values": ["50", "150"]}, ["a", "b"]),
    ({"column": "store", "op": "in", "values": ["7"]}, ["c"]),
    ({"column": "day", "op": ">", "values": ["2026-10-02"]}, ["c", "d"]),
])
def test_each_slice_counts_exactly_the_rows_it_names(agent_ns, segment, kept):
    sqlglot = pytest.importorskip("sqlglot")
    sql = agent_ns["inspire_table_rows_sql"](ORDERS, [dict(segment, table=ORDERS), dict(segment, table=STORES, values=["zz"])])
    db = sqlite3.connect(":memory:")
    db.execute("CREATE TABLE orders (id TEXT, region TEXT, amount INTEGER, store INTEGER, day TEXT)")
    db.executemany("INSERT INTO orders VALUES (?, ?, ?, ?, ?)", [("a", "EU", 60, 3, "2026-10-01"), ("b", "UK", 150, 4, "2026-10-02"),
                                                                ("c", "EU", 900, 7, "2026-10-03"), ("d", "US", 10, 8, "2026-10-04")])
    tree = sqlglot.parse_one(sql.replace("COUNT(*) AS n", "id"), read="databricks")
    for table in tree.find_all(sqlglot.exp.Table):
        table.set("catalog", None)
        table.set("db", None)
    assert sorted(r[0] for r in db.execute(tree.sql(dialect="sqlite")).fetchall()) == kept


def test_main_records_the_start_and_the_end_around_the_use_case_even_when_it_fails(agent_ns):
    ns, _call = _controls(agent_ns)
    marker = agent_ns["INSPIRE_CHILD_MARKER"]
    assert ns["INSPIRE_RUN"]["source_tables"] and ns["INSPIRE_RUN"]["segments"] == []
    spark = FakeSpark()
    ns["spark"] = spark
    seen = []

    def run_use_case():
        seen.append(dict(ns["INSPIRE_RUN_LOG"]))
        ns["INSPIRE_RUN_LOG"]["written"].append((TABLE, "N01-U01", "r-7"))
        return {"status": "written", "rows_written": 3, "as_of_date": "2026-10-01", "run_id": "r-7"}

    ns["run_use_case"] = run_use_case
    dbu = _dbutils(**{marker: "1", "refresh_requested_by": "schedule"})
    ns["dbutils"] = dbu
    dbu.notebook.exit = dbu.notebook.exits.append
    launcher, _calls = _launcher(ns)
    ns["inspire_main"](dbu=dbu, launcher_cls=launcher, out=lambda *_a: None)
    assert seen[0]["trigger"] == "schedule" and seen[0]["started_us"] > 0
    [end] = [s for s in spark.statements if "`run_ended_at`" in s]
    assert end.startswith(f"MERGE INTO {QUOTED_SUMMARY} AS s USING (SELECT 'N01-U01' AS use_case_id, 'r-7' AS run_id)")
    assert "INSPIRE_RUN_LOG" not in ns
    assert ("refresh_requested_by", "schedule", None, "Run asked for by (set by the job)") in dbu.widgets.created

    def failing():
        ns["INSPIRE_RUN_LOG"]["written"].append((TABLE, "N01-U01", "r-8"))
        raise RuntimeError("the summary step failed")

    ns["run_use_case"] = failing
    with pytest.raises(RuntimeError, match="the summary step failed"):
        ns["inspire_main"](dbu=dbu, launcher_cls=launcher, out=lambda *_a: None)
    assert any("`run_ended_at`" in s and "'r-8' AS run_id" in s for s in spark.statements), "a failed run still records its end"
    here = _dbutils(execution="Here")
    here.notebook.exit = here.notebook.exits.append
    ns["dbutils"] = here
    ns["run_use_case"] = lambda: seen.append(dict(ns["INSPIRE_RUN_LOG"])) or {"status": "stopped", "stop_reason": "x"}
    ns["inspire_main"](dbu=here, launcher_cls=launcher, out=lambda *_a: None)
    assert seen[-1]["trigger"] == "build", "a run here is a build or test run"


def test_a_run_started_from_the_notebook_says_who_started_it(agent_ns):
    ns, _call = _controls(agent_ns)
    launcher, calls = _launcher(ns)
    ns["spark"] = FakeSpark(responder=lambda s: [{"user": "ana@example.com"}] if s == "SELECT current_user() AS user" else [])
    dbu = _dbutils(result_table="main.inspire.n01_u01_churn_out")
    dbu.notebook.exit = dbu.notebook.exits.append
    ns["inspire_run_controls"](ns["INSPIRE_RUN"], dbu=dbu, launcher_cls=launcher, out=lambda *_a: None)
    assert calls["launch"]["run_parameters"]["refresh_requested_by"] == "ana@example.com"
    assert calls["launch"]["base"]["refresh_requested_by"] == "schedule", "the job's own runs stay the schedule's"
    ns["spark"] = FakeSpark(responder=lambda s: (_ for _ in ()).throw(RuntimeError("no current_user")))
    ns["inspire_run_controls"](ns["INSPIRE_RUN"], dbu=dbu, launcher_cls=launcher, out=lambda *_a: None)
    assert calls["launch"]["run_parameters"]["refresh_requested_by"] == "the notebook"


def test_the_run_controls_carry_the_tables_the_run_reads_and_its_slices(agent_ns):
    inst = build_inspire(agent_ns)
    uc = make_uc()
    spec = inst._genie_notebook_spec(uc)
    involved = inst._genie_involved_tables(uc)
    data = {"tables": {involved[0]: "main.sales.orders_v2"}, "removed_tables": involved[1:2],
            "filters": [{"table": "main.sales.orders_v2", "column": "region", "op": "in", "values": ["EU"]}]}
    source = inst._genie_run_controls_source(dict(uc, _implement_data=data), spec, str(uc.get("genie_instruction") or ""))
    run = ast.literal_eval(source.split("INSPIRE_RUN = ", 1)[1].split("\n\n\n", 1)[0])
    assert run["source_tables"] == ["main.sales.orders_v2"] + involved[2:]
    assert run["segments"] == data["filters"]
    plain = ast.literal_eval(inst._genie_run_controls_source(uc, spec, "").split("INSPIRE_RUN = ", 1)[1].split("\n\n\n", 1)[0])
    assert plain["source_tables"] == involved and plain["segments"] == []
    assert agent_source().count('use_case["_implement_data"] = spec.get("data") or {}') == 1, "the implement flow hands the data on"


def _created_columns(agent_ns):
    create = agent_ns["inspire_ai_summary_create_sql"](TABLE)
    return [part.split()[0] for part in create[create.index("(") + 1:create.rindex(")")].split(", ")]


def _summary_reads(*functions):
    rows, names = ("s", "summary"), set()
    for function in functions:
        for node in ast.walk(ast.parse(inspect.getsource(function))):
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "get"
                    and isinstance(node.func.value, ast.Name) and node.func.value.id in rows and isinstance(node.args[0], ast.Constant)):
                names.add(node.args[0].value)
            elif isinstance(node, ast.Subscript) and isinstance(node.value, ast.Name) and node.value.id in rows and isinstance(node.slice, ast.Constant):
                names.add(node.slice.value)
            elif (isinstance(node, ast.Compare) and isinstance(node.left, ast.Constant) and isinstance(node.ops[0], ast.In)
                    and isinstance(node.comparators[0], ast.Name) and node.comparators[0].id in rows):
                names.add(node.left.value)
    return names


def _reads_probe(s, j):
    return s.get("run_x"), s["run_y"], "run_z" in s, j.get("run_w")


def test_the_app_runs_route_reads_the_run_log_columns_the_notebook_creates_under_the_same_names(agent_ns):
    created = _created_columns(agent_ns)
    run_log = [name for name, _kind in agent_ns["INSPIRE_RUN_LOG_COLUMNS"]]
    assert run_log == ["run_started_at", "run_ended_at", "run_trigger", "run_segments", "run_tables", "run_stages", "run_grouping"]
    added = [name for name, _kind in agent_ns["INSPIRE_SUMMARY_ADDED_COLUMNS"]]
    start = created.index(run_log[0])
    assert created[start:start + len(run_log)] == run_log and created[-len(added) - 1:-1] == added and created[-1] == "updated_at"
    read = _summary_reads(shell_core.run_view, shell_core.run_state, shell_core.run_trigger, shell_core.run_grouping)
    assert sorted(n for n in read if n.startswith("run_")) == sorted(run_log), "the runs route reads every run log column, and no other"
    assert read <= set(created), f"the runs route reads {sorted(read - set(created))}, which the summary table does not have"
    assert set(shell_core.RUN_SUMMARY_FIELDS) <= set(created)
    assert _summary_reads(_reads_probe) == {"run_x", "run_y", "run_z"}, "the reader check finds get, index and in"


def test_a_summary_row_shaped_like_the_notebook_table_fills_every_run_field_and_each_name_counts(agent_ns):
    row = dict.fromkeys(_created_columns(agent_ns))
    row.update(use_case_id="N01-U01", run_id="r-2", run_started_at="2026-10-27T06:00:00Z", run_ended_at="2026-10-27T06:01:30Z",
               run_trigger="refresh", run_segments=json.dumps([{"column": "region", "values": ["EU"]}]),
               run_tables=json.dumps([{"table": ORDERS, "rows": 1240, "updated_at": "2026-10-27T05:00:00Z"}]),
               run_stages=json.dumps({"stages": [{"stage": "Checking the settings", "index": 1, "at": 1000000, "rows_total": None},
                                                 {"stage": "Writing the results", "index": 3, "at": 31000000, "rows_total": 1240}],
                                      "ended": 91000000}),
               run_grouping=json.dumps({"mode": "columns", "group_by": ["region", "country"], "time_column": "", "minimum": 30,
                                        "groups": 12, "levels": [{"level": "country", "groups": 10, "records": 900},
                                                                  {"level": "region", "groups": 2, "records": 80}],
                                        "hash": "ab" * 32}))
    page = {"filters": [{"type": "multi_select", "label": "Region", "columns": {"records": "region"}}]}
    view = shell_core.run_view(shell_core.blank_run("r-2"), row, page)
    assert (view["started"], view["ended"], view["duration_s"], view["status"], view["trigger"]) == (
        "2026-10-27T06:00:00Z", "2026-10-27T06:01:30Z", 90, "done", "refresh")
    assert view["segments"] == [{"column": "region", "label": "Region", "values": ["EU"], "more": 0}]
    assert view["tables"] == [{"table": ORDERS, "rows": 1240, "rows_total": None, "scoped": False, "updated_at": "2026-10-27T05:00:00Z"}]
    assert view["stages"] == [{"stage": "Checking the settings", "spent_s": 30, "rows_total": None},
                              {"stage": "Writing the results", "spent_s": 60, "rows_total": 1240}]
    assert view["grouping"] == {"mode": "columns", "group_by": ["region", "country"], "groups": 12,
                                "levels": [{"level": "country", "groups": 10}, {"level": "region", "groups": 2}],
                                "hash": "ab" * 32, "other_groups": None}
    assert shell_core.run_grouping(json.dumps({"mode": "custom", "group_by": [], "groups": 12, "sql_tables": [ORDERS]})) is None, \
        "a run grouped by typed SQL shows no grouping, because Inspire no longer runs SQL typed into Grouping"
    assert shell_core.run_grouping(json.dumps({"group_by": "custom", "groups": 12})) is None
    assert shell_core.run_grouping(json.dumps({"group_by": "all", "groups": 1}))["mode"] == "all"
    for name, _kind in agent_ns["INSPIRE_RUN_LOG_COLUMNS"]:
        renamed = {("old_" + key if key == name else key): value for key, value in row.items()}
        assert shell_core.run_view(shell_core.blank_run("r-2"), renamed, page) != view, f"the runs route reads {name} by that name"
