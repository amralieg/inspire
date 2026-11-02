"""Once a result table has a run log, a run writes a new version of a record only when its values change, so every reader that
compares or counts runs reads them from the log: the dashboard's compared KPIs and its Trend page with its count of runs, the alert's
range of earlier runs and the Lakebase copy of the previous run. Each passes the check that refuses runs read from the versions,
and the same reader built without the log is refused, offline."""
import json
import sqlite3

import sqlglot

from v142_dash_test import _palettes
from v171_dashboard_runs_test import ALLOWED, RESULT, _page, _schema, shell_sql

LOG = f"{RESULT}_run_log"
RUNS = {"table": RESULT, "log": LOG}
LEAD = f"reads the versions of {RESULT} run by run"
COLUMNS = ["record_key", "valid_from", "valid_to", "is_current", "change_source", "changed_by", "run_id", "use_case_id", "value"]
CURRENT = f"SELECT o.record_key, o.value FROM {RESULT} AS o WHERE o.is_current"
VERSIONS = [("a", "10:00", "11:00", 0, "r1", 1.0), ("a", "12:00", None, 1, "r3", 5.0), ("b", "12:00", None, 1, "r3", 2.0),
            ("c", "12:00", None, 1, "r3", 7.0)]
STAMPS = [("r1", "10:00", "a"), ("r1", "10:00", "b"), ("r2", "11:00", "a"), ("r2", "11:00", "b"), ("r3", "12:00", "a"),
          ("r3", "12:00", "b"), ("r3", "12:00", "c")]


def _run_log(schema):
    return shell_sql.history_layout({shell_sql.RUN_LOG_PROPERTY: LOG}, [{"name": n, "type": k.upper()} for n, k in schema])


def _refused(ns, sqls):
    return [p for p in ns["implement_run_version_problems"](sqls, "x", RUNS) if LEAD in p]


def _board(ns, schema, run_log=None):
    theme = ns["implement_dashboard_theme"](_palettes(), None, "coral")
    return ns["implement_dashboard_from_page"](_page(ns), shell_sql, RESULT, {}, theme=theme, result_schema=schema, run_log=run_log)


def _sql(doc, name):
    return "".join(next(d for d in doc["datasets"] if d["name"] == name)["queryLines"])


def test_the_dashboard_of_a_table_with_a_run_log_reads_each_run_from_the_log(agent_ns):
    schema = _schema(agent_ns)
    log = _run_log(schema)
    assert log is not None and log["log"] == shell_sql.table_name(LOG)
    history = agent_ns["implement_dashboard_history"](_page(agent_ns), shell_sql, RESULT, schema, log)
    readers = list(history["compared"].values()) + [history["trend"], "run_health"]
    assert history["compared"] and history["trend"]
    doc = _board(agent_ns, schema, log)
    for name in readers:
        assert log["log"] in _sql(doc, name), f"{name} counts or compares runs, so it reads them from the log"
    checked = agent_ns["check_dashboard_definition"](json.loads(json.dumps(doc)), ALLOWED + [LOG], shell_sql.RECORDS_DATASET,
                                                     run_versions=RUNS)[1]
    assert not [e for e in checked if LEAD in e], checked
    plain = _board(agent_ns, schema)
    refused = agent_ns["check_dashboard_definition"](json.loads(json.dumps(plain)), ALLOWED + [LOG], shell_sql.RECORDS_DATASET,
                                                     run_versions=RUNS)[1]
    assert [e for e in refused if LEAD in e], "the same dashboard built without the log reads its runs from the versions"


def test_the_trend_s_count_of_runs_includes_a_run_that_changed_no_record(agent_ns):
    table, measures = shell_sql.table_name(RESULT), {"items": "COUNT(*)"}
    logged, plain = shell_sql.trend_sql(table, measures, _logged_layout()), shell_sql.trend_sql(table, measures)
    assert sorted(row[0] for row in _logged_rows(logged)) == ["r1", "r2", "r3"]
    assert sorted(row[0] for row in _logged_rows(plain)) == ["r1", "r3"], "the versions hold no row of run r2, which changed nothing"
    assert not _refused(agent_ns, [logged])
    assert _refused(agent_ns, [plain])


def test_an_alert_on_its_usual_range_reads_the_earlier_runs_from_the_log(agent_ns):
    schema = _schema(agent_ns, priority_tier="string") + [("as_of_date", "string")]
    columns, log = [n for n, _k in schema], _run_log(schema)
    outputs = {"alert_tiers": "act_now", "alert_operator": ">=", "alert_threshold": 1, "alert_threshold_basis": "baseline"}
    logged = agent_ns["implement_alert_query"](shell_sql, RESULT, outputs, columns=columns, history=log)["query"]
    assert log["log"] in logged and f"FROM {log['log']} GROUP BY `run_id`" in logged
    assert not _refused(agent_ns, [logged])
    plain = agent_ns["implement_alert_query"](shell_sql, RESULT, outputs, columns=columns)["query"]
    assert log["log"] not in plain and _refused(agent_ns, [plain]), "without the log the range reads each run from the versions"
    page = dict(_page(agent_ns), result_table=RESULT)
    kpi = next(k for k in page["kpis"] if k["dataset"] == shell_sql.RECORDS_DATASET)
    watch = {"what": kpi["id"], "filters": {}, "operator": ">", "threshold": 1000, "basis": "baseline"}
    assert log["log"] in shell_sql.watch_query(page, watch, columns, log)["query"], "the App's own alert reads the same log"


def test_the_lakebase_copy_of_the_previous_run_reads_the_log(agent_ns):
    schema = _schema(agent_ns)
    columns, log = [n for n, _k in schema], _run_log(schema)
    page = dict(_page(agent_ns), result_table=RESULT)
    copies = agent_ns["implement_lakebase_copies"]([page], "_inspire_row", shell_sql, {RESULT: columns}, None, {RESULT: log})
    previous = [c for c in copies if c.get("previous")]
    assert previous and all(log["log"] in c["body"] for c in previous)
    assert not _refused(agent_ns, [c["body"] for c in previous])
    plain = [c for c in agent_ns["implement_lakebase_copies"]([page], "_inspire_row", shell_sql, {RESULT: columns}) if c.get("previous")]
    assert plain and _refused(agent_ns, [c["body"] for c in plain]), "without the log the previous run is read from the versions"


def _logged_layout():
    return shell_sql.history_layout({shell_sql.RUN_LOG_PROPERTY: LOG}, [{"name": c, "type": "STRING"} for c in COLUMNS])


def _logged_rows(sql):
    db = sqlite3.connect(":memory:")
    db.create_function("IF", 3, lambda c, a, b: a if c else b)
    db.execute("CREATE TABLE churn_out (record_key TEXT, valid_from TEXT, valid_to TEXT, is_current INT, change_source TEXT, changed_by TEXT, "
               "run_id TEXT, use_case_id TEXT, value REAL)")
    db.executemany("INSERT INTO churn_out VALUES (?, ?, ?, ?, 'run', 'the job', ?, 'N01-U01', ?)", VERSIONS)
    db.execute('CREATE TABLE churn_out_run_log (use_case_id TEXT, run_id TEXT, as_of_date TEXT, ran_at TEXT, record_key TEXT, "rank" INT)')
    db.executemany("INSERT INTO churn_out_run_log VALUES ('N01-U01', ?, NULL, ?, ?, NULL)", STAMPS)
    quoted = lambda name: ".".join(f'"{part}"' for part in name.split("."))
    local = sqlglot.transpile(sql, read="databricks", write="sqlite")[0]
    return db.execute(local.replace(quoted(LOG), "churn_out_run_log").replace(quoted(RESULT), "churn_out")).fetchall()


def _repeated_names(sql):
    repeated = []
    for select in sqlglot.parse_one(sql, read="databricks").find_all(sqlglot.exp.Select):
        names = [e.alias_or_name for e in select.expressions if not e.find(sqlglot.exp.Star) and e.alias_or_name]
        repeated += sorted({n for n in names if names.count(n) > 1})
    return repeated


def test_each_earlier_run_reads_the_log_as_that_run_left_the_table_and_carries_its_place_among_the_runs():
    log = _logged_layout()
    sql = shell_sql.runs_compare_sql(CURRENT, RESULT, COLUMNS, (0, 1, 2), log)
    assert sorted(_logged_rows(sql)) == sorted([
        ("a", 5.0, "latest"), ("b", 2.0, "latest"), ("c", 7.0, "latest"),
        ("a", 5.0, "previous"), ("b", 2.0, "previous"),
        ("a", 1.0, "previous_2"), ("b", 2.0, "previous_2")]), \
        "run r2 changed a and run r3 changed nothing, so the log gives r2 both records and r1 its own a, each tagged by its place, never its run id"
    measured = (f"SELECT {shell_sql.run_measure('SUM(value)', shell_sql.RUN_LATEST)}, {shell_sql.previous_run_measure('SUM(value)')}, "
                f"{shell_sql.previous_run_measure('SUM(value)', 2)} FROM ({sql}) AS q")
    assert _logged_rows(measured) == [(14.0, 7.0, 3.0)]


def test_no_query_that_reads_runs_names_two_of_its_columns_alike():
    table = shell_sql.table_name(RESULT)
    for history in (None, _logged_layout()):
        queries = {"runs": shell_sql.runs_compare_sql(CURRENT, RESULT, COLUMNS, (0, 1, 2), history),
                   "previous": shell_sql.runs_compare_sql(CURRENT, RESULT, COLUMNS, (1,), history),
                   "trend": shell_sql.trend_sql(table, {"items": "COUNT(*)"}, history),
                   "alert": shell_sql.alert_query("COUNT(*)", ">=", 1, "baseline", source=CURRENT, table=RESULT, columns=COLUMNS,
                                                  history=history)["query"]}
        for name, sql in queries.items():
            assert not _repeated_names(sql), (f"{name} with{'out' if history is None else ''} the run log names a column twice in one "
                                              f"SELECT, which Databricks refuses as an ambiguous reference: {_repeated_names(sql)}")
