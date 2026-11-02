import datetime
import json
import os
import sys

import psycopg
import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_core  # noqa: E402
import shell_pg  # noqa: E402
import shell_sql  # noqa: E402
from v141_app_shell_test import call  # noqa: E402
from v142_scd_test import CORE, HISTORY, NOW, QUOTED, QUOTED_LOG, TABLE, VERSION, _Tables  # noqa: E402
from v145_lakebase_test import PG_ENV, PG_SCHEMA, CredentialWorkspace, postgres  # noqa: E402,F401

UTC = datetime.timezone.utc
LOG_PROPS = {"inspire.run_log": f"{TABLE}_run_log", "inspire.run_log_tier": "priority_tier"}


def test_a_table_that_points_at_its_run_log_keeps_it_and_lists_each_run_after_the_merge(agent_ns):
    backfill = agent_ns["inspire_run_log_backfill_sql"](TABLE, "priority_tier", [n for n, _k in CORE + HISTORY])
    assert f"FROM {QUOTED} AS t WHERE t.change_source = 'run'" in backfill
    assert "MIN_BY(b.run_id, b.ran_at) OVER (PARTITION BY b.record_key) AS first_run" in backfill
    assert agent_ns["inspire_run_log_create_sql"](TABLE, CORE + HISTORY).endswith("CLUSTER BY (run_id, record_key)")
    again = _Tables(agent_ns, target=CORE + HISTORY, properties=LOG_PROPS)
    again.run()
    assert again.index(f"CREATE OR REPLACE TABLE {QUOTED_LOG} ") is None and again.index(f"ALTER TABLE {QUOTED} SET TBLPROPERTIES") is None, \
        "a table whose log is already there keeps it"
    assert again.index(f"INSERT INTO {QUOTED_LOG} SELECT n.*") > again.index(f"MERGE INTO {QUOTED} ")


def test_a_new_table_starts_an_empty_run_log_and_lists_its_first_run_once(agent_ns):
    tables = _Tables(agent_ns, target=None)
    tables.run()
    assert tables.index(f"CREATE OR REPLACE TABLE {QUOTED_LOG} ") is not None
    assert tables.index(f"INSERT INTO {QUOTED_LOG} SELECT t.use_case_id AS use_case_id") is None, \
        "a table made by this run has no earlier runs, so its rows are listed only once, by the run itself"
    assert len([s for s in tables.spark.statements if s.startswith(f"INSERT INTO {QUOTED_LOG} ")]) == 1


def test_a_run_that_retypes_the_table_keeps_it_pointing_at_its_run_log(agent_ns):
    from v142_scd_test import LEGACY
    tables = _Tables(agent_ns, target=LEGACY + HISTORY, properties=dict(LOG_PROPS, **{"inspire.replace_edits": "true"}))
    tables.run()
    retype = tables.index(f"CREATE OR REPLACE TABLE {QUOTED} TBLPROPERTIES")
    kept = tables.index(f"ALTER TABLE {QUOTED} SET TBLPROPERTIES ('inspire.run_log' = 'main.inspire.churn_out_run_log', "
                        "'inspire.run_log_tier' = 'priority_tier')")
    assert retype is not None and kept == retype + 1, "a rewritten table keeps its log instead of rebuilding it from fewer versions"
    assert tables.index(f"CREATE OR REPLACE TABLE {QUOTED_LOG} ") is None


def test_moving_the_results_to_a_new_table_copies_its_run_log_and_points_the_new_table_at_the_copy(agent_ns):
    from v140_implement_test import _inspire
    from v120_artifacts_support import FakeSpark
    old, new = "main.inspire.churn_out", "main.sales.churn_v2"

    def respond(statement):
        if statement == "SHOW TBLPROPERTIES `main`.`inspire`.`churn_out`":
            return [{"key": k, "value": v} for k, v in LOG_PROPS.items()]
        if statement.startswith("DESCRIBE TABLE `main`.`sales`.`churn_v2`") or statement.startswith(
                "DESCRIBE TABLE `main`.`sales`.`churn_v2_summary`"):
            raise RuntimeError("[TABLE_OR_VIEW_NOT_FOUND] not found")
        if statement.startswith("DESCRIBE TABLE"):
            return [{"col_name": "record_key", "data_type": "string", "comment": None}]
        return []

    inst = _inspire(agent_ns, FakeSpark(responder=respond))
    inst._implement_result_table_sharers = lambda key, table: []
    warnings = []
    inst._implement_move_result_table("N01-U01", (5150, "N01-U01", 2), old, new, warnings)
    statements = inst.spark.statements
    assert "CREATE TABLE `main`.`sales`.`churn_v2_run_log` DEEP CLONE `main`.`inspire`.`churn_out_run_log`" in statements
    assert ("ALTER TABLE `main`.`sales`.`churn_v2` SET TBLPROPERTIES ('inspire.run_log' = 'main.sales.churn_v2_run_log', "
            "'inspire.run_log_tier' = 'priority_tier')") in statements, "the copy reads its own log, never the old table's"
    assert warnings == []


def test_the_run_log_marks_a_record_new_or_moved_against_the_run_before(agent_ns):
    sql = agent_ns["inspire_run_log_insert_sql"](TABLE, "N01-U01", "r-2", NOW, "priority_tier", [n for n, _k in CORE + HISTORY])
    assert "CASE WHEN c.runs = 0 THEN NULL WHEN s.record_key IS NULL THEN 'new' WHEN w.record_key IS NOT NULL AND NOT (n.tier <=> w.tier) " \
           "THEN 'moved' END AS change" in sql
    assert f"FROM {QUOTED_LOG} WHERE CAST(run_id AS STRING) <> 'r-2' GROUP BY record_key" in sql, "only earlier runs make a record not new"
    assert "SELECT DISTINCT p.record_key, p.tier" in sql, "a record listed twice by an earlier run never doubles this run's rows"


def test_a_run_whose_merge_fails_puts_the_table_and_its_log_back_at_their_versions_before_the_run(fresh_ns):
    tables = _Tables(fresh_ns, target=CORE + HISTORY, properties=LOG_PROPS, fail="INSERT INTO `main`.`inspire`.`churn_out_run_log` SELECT n.*")
    versions = iter([VERSION, VERSION, VERSION + 1, VERSION + 1])
    respond = tables.respond

    def moved(statement):
        if statement.startswith("DESCRIBE HISTORY"):
            return [{"version": next(versions)}]
        if statement == f"DESCRIBE TABLE {QUOTED_LOG}":
            return [{"col_name": "run_id", "data_type": "string", "comment": None}]
        return respond(statement)

    tables.spark.responder = moved
    with pytest.raises(RuntimeError, match="PERMISSION_DENIED"):
        tables.run()
    restores = [s for s in tables.spark.statements if s.startswith("RESTORE TABLE")]
    assert restores == [f"RESTORE TABLE {QUOTED} TO VERSION AS OF {VERSION}", f"RESTORE TABLE {QUOTED_LOG} TO VERSION AS OF {VERSION}"]
    assert "DEEP CLONE" not in " ".join(tables.spark.statements)


def test_a_run_that_fails_before_any_change_restores_nothing(fresh_ns):
    tables = _Tables(fresh_ns, target=CORE + HISTORY, properties=LOG_PROPS, fail="MERGE INTO `main`.`inspire`.`churn_out` AS t")
    with pytest.raises(RuntimeError, match="PERMISSION_DENIED"):
        tables.run()
    assert not [s for s in tables.spark.statements if s.startswith("RESTORE TABLE")], "a table at its version before the run is left alone"


def test_the_history_layout_comes_from_the_table_properties_and_needs_the_change_history():
    fields = [{"name": n, "type": t} for n, t in (("record_key", "STRING"), ("run_id", "LONG"), ("valid_from", "TIMESTAMP"),
                                                  ("change_source", "STRING"), ("rank", "INT"))]
    layout = shell_sql.history_layout(dict(LOG_PROPS), fields)
    assert layout == {"log": "`main`.`inspire`.`churn_out_run_log`", "tier": "priority_tier", "columns": [f["name"] for f in fields],
                      "run_type": "BIGINT"}
    assert shell_sql.history_layout({}, fields) is None, "a table written one version per run has no log"
    assert shell_sql.history_layout({"inspire.run_log": "not a table"}, fields) is None
    assert shell_sql.history_layout(dict(LOG_PROPS), []) is None
    assert shell_sql.history_layout(dict(LOG_PROPS), fields[:2])["columns"] == ["record_key", "run_id"], \
        "every result table keeps its change history, so the layout never looks for those columns"
    assert shell_sql.history_layout(dict(LOG_PROPS), None) is None


def _context(history=None, facts=None, tier="priority_tier"):
    return {"table": QUOTED, "join": "record_key", "actions": True, "changes": True, "tier": tier, "tie": "record_key", "ai": [],
            "categories": [], "money": [], "history": history, "facts": facts, "unjoined": ""}


LAYOUT = {"log": QUOTED_LOG, "tier": "priority_tier", "columns": ["record_key", "run_id"], "run_type": "STRING"}


def test_the_list_reads_what_changed_from_the_latest_run_of_the_log_and_the_old_layout_keeps_its_sql():
    page = {"id": "p", "datasets": [{"name": "records", "sql": f"SELECT * FROM {TABLE} WHERE is_current"}], "result_table": TABLE,
            "records": {"key": "record_key", "rank": "rank", "label": "entity_label", "tier": "priority_tier"}}
    request = {"sort": "rank", "dir": "asc", "offset": 0, "limit": 25, "search": "", "mine": False, "changed": True, "ai": {},
               "columns": {}, "cursor": None}
    old = shell_sql.list_queries(page, {}, request, _context())["rows"][0]
    assert f"FROM {QUOTED} AS t JOIN n ON t.`run_id` = n.`_inspire_latest` WHERE t.`change_source` = 'run'" in old and QUOTED_LOG not in old
    facts = {"latest": "r7", "previous": "r6"}
    new = shell_sql.list_queries(page, {}, request, _context(LAYOUT, facts))["rows"][0]
    assert "n AS (SELECT CAST('r7' AS STRING) AS `_inspire_latest`, CAST('r6' AS STRING) AS `_inspire_previous`)" in new
    assert f"FROM {QUOTED_LOG} AS t JOIN n ON t.`run_id` = n.`_inspire_latest`" in new and "o0 AS" not in new and "p0 AS" not in new
    assert "l.`_inspire_ch` IN ('new', 'moved')" in new, "the changed filter reads the change the run stored"
    other = shell_sql.list_queries(page, {}, request, _context(LAYOUT, facts, tier="risk_band"))["rows"][0]
    assert "UNION ALL SELECT" in other and "LEFT ANTI JOIN" in other, \
        "a page whose tier is not the log's rebuilds each run's rows from the log and the versions"
    assert shell_sql.runs_query(page, [{"name": n} for n in ("run_id", "as_of_date", "priority_tier")], LAYOUT)[0].startswith(
        "SELECT CAST(`run_id` AS STRING) AS run_id, CAST(`tier` AS STRING) AS tier, MAX(CAST(`as_of_date` AS DATE)) AS as_of_date, "
        f"MIN(`ran_at`) AS ran_at, COUNT(*) AS n FROM {QUOTED_LOG} GROUP BY 1, 2")


RESULT = "main.inspire.loss_out"
LOG = "main.inspire.loss_out_run_log"
COLUMNS = [("record_key", "STRING", "text"), ("use_case_id", "STRING", "text"), ("run_id", "STRING", "text"), ("as_of_date", "DATE", "date"),
           ("rank", "INT", "integer"), ("priority_tier", "STRING", "text"), ("value_at_stake", "DOUBLE", "double precision"),
           ("action_status", "STRING", "text"), ("action_outcome", "STRING", "text"), ("dismiss_reason", "STRING", "text"),
           ("valid_from", "TIMESTAMP", "timestamptz"), ("valid_to", "TIMESTAMP", "timestamptz"),
           ("is_current", "BOOLEAN", "boolean"), ("change_source", "STRING", "text"), ("changed_by", "STRING", "text"),
           ("realized_value", "DOUBLE", "double precision"), ("realized_note", "STRING", "text"),
           ("edited_by_person", "BOOLEAN", "boolean"), ("not_listed_since", "TIMESTAMP", "timestamptz")]
LOG_COLUMNS = [("use_case_id", "STRING", "text"), ("run_id", "STRING", "text"), ("as_of_date", "DATE", "date"),
               ("ran_at", "TIMESTAMP", "timestamptz"), ("record_key", "STRING", "text"), ("rank", "INT", "integer"),
               ("tier", "STRING", "text"), ("held_back", "BOOLEAN", "boolean"), ("run_tier", "STRING", "text"),
               ("first_run", "STRING", "text"), ("change", "STRING", "text"), ("moved_to", "STRING", "text")]


def at(day, hour=6):
    return datetime.datetime(2026, 9, day, hour, tzinfo=UTC)


def version(key, run, day, rank, tier, stake, source="run", status=None, valid_to=None, current=False, hour=6, editor=None, outcome=None):
    return {"record_key": key, "use_case_id": "U1", "run_id": run, "as_of_date": datetime.date(2026, 9, day), "rank": rank,
            "priority_tier": tier, "value_at_stake": stake, "action_status": status, "action_outcome": outcome, "dismiss_reason": None,
            "valid_from": at(day, hour), "valid_to": valid_to,
            "is_current": current, "change_source": source, "changed_by": editor or f"run {run}", "realized_value": None,
            "realized_note": None, "edited_by_person": source == "action", "not_listed_since": None}


OLD_ROWS = [
    version("a", "r1", 1, 3, "Review", 100.0, valid_to=at(8)),
    version("a", "r2", 8, 2, "Review", 100.0, valid_to=at(8, 9)),
    version("a", "r2", 8, 2, "Review", 100.0, source="action", status="Done", valid_to=at(15), hour=9, editor="pat"),
    version("a", "r3", 15, 5, "Monitor", 0.0, status="Done", valid_to=at(22), outcome="Resolved"),
    version("a", "r4", 22, 6, "Monitor", 0.0, status="Done", valid_to=at(29), outcome="Resolved"),
    version("a", "r5", 29, 4, "Monitor", 0.0, status="Done", current=True, outcome="Resolved"),
    version("b", "r1", 1, 1, "Act now", 500.0, valid_to=at(8)),
    version("b", "r2", 8, 1, "Act now", 500.0, valid_to=at(15)),
    version("b", "r3", 15, 2, "Act now", 500.0, valid_to=at(22)),
    version("b", "r5", 29, 2, "Act now", 500.0, current=True),
]
NEW_ROWS = [OLD_ROWS[1], OLD_ROWS[2], OLD_ROWS[5], OLD_ROWS[8], OLD_ROWS[9]]
LOG_ROWS = [{"use_case_id": "U1", "run_id": r["run_id"], "as_of_date": r["as_of_date"], "ran_at": r["valid_from"], "record_key": r["record_key"],
             "rank": r["rank"], "tier": r["priority_tier"], "held_back": None, "run_tier": None, "first_run": "r1", "change": None,
             "moved_to": None} for r in OLD_ROWS if r["change_source"] == "run"]


def _table(cur, name, columns, rows):
    cur.execute(f'DROP TABLE IF EXISTS "{PG_SCHEMA}"."{name}"')
    cur.execute(f'CREATE TABLE "{PG_SCHEMA}"."{name}" (' + ", ".join(f'"{n}" {pg}' for n, _t, pg in columns) + ', "_inspire_row" bigint)')
    for i, row in enumerate(rows):
        cur.execute(f'INSERT INTO "{PG_SCHEMA}"."{name}" VALUES (' + ", ".join(["%s"] * (len(columns) + 1)) + ")",
                    [row[n] for n, _t, _pg in columns] + [i + 1])


@pytest.fixture(scope="module")
def layouts(postgres):  # noqa: F811
    def local(**kwargs):
        return psycopg.connect(host=postgres["host"], port=postgres["port"], dbname="postgres", user="inspire",
                               connect_timeout=kwargs["connect_timeout"], autocommit=kwargs["autocommit"])

    with local(connect_timeout=10, autocommit=True) as conn, conn.cursor() as cur:
        _table(cur, "loss_old", COLUMNS, OLD_ROWS)
        _table(cur, "loss_new", COLUMNS, NEW_ROWS)
        _table(cur, "loss_new_run_log", LOG_COLUMNS, LOG_ROWS)
    typed = lambda columns: [{"name": n, "type": t, "type_text": t} for n, t, _pg in columns] + [
        {"name": shell_pg.ROW_COLUMN, "type": "LONG", "type_text": "BIGINT"}]
    made = []

    def lakebase(table):
        tables = {RESULT: {"pg": f"{PG_SCHEMA}.{table}", "columns": typed(COLUMNS)},
                  LOG: {"pg": f"{PG_SCHEMA}.loss_new_run_log", "columns": typed(LOG_COLUMNS)}}
        lb = shell_pg.Lakebase({"pipeline_id": "pipeline-1", "tables": tables, "datasets": {}}, PG_ENV, lambda: CredentialWorkspace(),
                               connect=local)
        made.append(lb)
        return lb

    yield lakebase
    for lb in made:
        lb.close()


def _rows(lb, sql, params):
    return [{k: v for k, v in r.items() if k != shell_pg.ROW_COLUMN} for r in lb.run(sql, params, 500)["rows"]]


def test_a_records_history_rebuilt_from_the_run_log_is_the_history_one_version_per_run_wrote_on_a_real_postgres(layouts):
    page = {"result_table": RESULT, "records": {"key": "record_key"}}
    history = {"log": shell_sql.table_name(LOG), "tier": "priority_tier", "columns": [n for n, _t, _pg in COLUMNS], "run_type": "STRING"}
    for key in ("a", "b"):
        old = _rows(layouts("loss_old"), *shell_sql.history_query(page, key, True))
        new = _rows(layouts("loss_new"), *shell_sql.history_query(page, key, True, history))
        assert old == new and len(old) == {"a": 6, "b": 4}[key], key
    old_runs = _rows(layouts("loss_old"), *shell_sql.runs_query(dict(page, records={"tier": "priority_tier"}),
                                                                 [{"name": n} for n, _t, _pg in COLUMNS]))
    new_runs = _rows(layouts("loss_new"), *shell_sql.runs_query(dict(page, records={"tier": "priority_tier"}),
                                                                 [{"name": n} for n, _t, _pg in COLUMNS], history))
    assert sorted(old_runs, key=json.dumps) == sorted(new_runs, key=json.dumps) and len(old_runs) == 9
    names = {n for n, _t, _pg in COLUMNS}
    old_close = shell_sql.closing_ctes(shell_sql.table_name(RESULT), names)
    new_close = shell_sql.closing_ctes(shell_sql.table_name(RESULT), names, history=history)
    chain = ("hx", "hw", "hu", "ho")
    for name in chain:
        sql_old = f"WITH {', '.join(f'{n} AS ({old_close[n]})' for n in chain)} SELECT * FROM {name}"
        sql_new = f"WITH {', '.join(f'{n} AS ({new_close[n]})' for n in chain)} SELECT * FROM {name}"
        old, new = _rows(layouts("loss_old"), sql_old, []), _rows(layouts("loss_new"), sql_new, [])
        assert sorted(old, key=lambda r: json.dumps(r, default=str)) == sorted(new, key=lambda r: json.dumps(r, default=str)), name
    closed = _rows(layouts("loss_new"), f"WITH {', '.join(f'{n} AS ({new_close[n]})' for n in chain)} SELECT * FROM ho", [])
    assert "2026-09-15T06:00:00.000Z" in [r["_inspire_seen"] for r in closed], \
        "the fix is resolved from the first run after it, whose values the later runs kept without a new version"


def test_the_change_marks_on_a_page_are_the_same_whether_the_log_is_read_by_the_page_keys_or_by_the_joined_page_on_a_real_postgres(
        postgres):  # noqa: F811
    def local(**kwargs):
        return psycopg.connect(host=postgres["host"], port=postgres["port"], dbname="postgres", user="inspire",
                               connect_timeout=kwargs["connect_timeout"], autocommit=kwargs["autocommit"])

    shown = [version("a", "r5", 29, 1, "Act now", 900.0, current=True), version("d", "r5", 29, 2, "Act now", 800.0, source="delete", current=True),
             version("b", "r5", 29, 3, "Act now", 700.0, current=True), version("e", "r5", 29, 4, "Review", 600.0, current=True)]
    logged = [dict(LOG_ROWS[0], run_id="r5", record_key=k, change=change, moved_to=moved, tier=tier)
              for k, change, moved, tier in (("a", "new", None, "Act now"), ("d", "new", None, "Act now"), ("b", "moved", "Act now", "Act now"),
                                             ("e", "new", None, "Review"))]
    with local(connect_timeout=10, autocommit=True) as conn, conn.cursor() as cur:
        _table(cur, "loss_keyed", COLUMNS, shown)
        _table(cur, "loss_keyed_run_log", LOG_COLUMNS, logged)
    typed = lambda columns: [{"name": n, "type": t, "type_text": t} for n, t, _pg in columns] + [
        {"name": shell_pg.ROW_COLUMN, "type": "LONG", "type_text": "BIGINT"}]
    tables = {RESULT: {"pg": f"{PG_SCHEMA}.loss_keyed", "columns": typed(COLUMNS)},
              LOG: {"pg": f"{PG_SCHEMA}.loss_keyed_run_log", "columns": typed(LOG_COLUMNS)}}
    page = {"id": "p", "result_table": RESULT, "datasets": [{"name": "records", "sql": f"SELECT * FROM {RESULT} WHERE is_current"}],
            "records": {"key": "record_key", "rank": "rank", "label": "record_key", "tier": "priority_tier"}}
    history = {"log": shell_sql.table_name(LOG), "tier": "priority_tier", "columns": [n for n, _t, _pg in COLUMNS], "run_type": "STRING"}
    context = {"table": shell_sql.table_name(RESULT), "join": "record_key", "actions": False, "changes": True, "tier": "priority_tier",
               "tie": "record_key", "ai": [], "categories": [], "money": [], "history": history, "facts": {"latest": "r5", "previous": "r4"},
               "unjoined": ""}
    request = {"sort": "rank", "dir": "asc", "offset": 0, "limit": 3, "search": "", "mine": False, "changed": False, "ai": {},
               "columns": {}, "cursor": None}
    sql, params = shell_sql.list_queries(page, {}, request, context)["rows"]
    joined = sql.replace("t.`record_key` IN (SELECT `record_key` FROM s)", "t.`record_key` IN (SELECT `_inspire_key` FROM k)")
    assert joined != sql and sql.count(" FROM k") == 1
    lb = shell_pg.Lakebase({"pipeline_id": "pipeline-1", "tables": tables, "datasets": {}}, PG_ENV, lambda: CredentialWorkspace(),
                           connect=local)
    try:
        by_keys, by_join = _rows(lb, sql, params), _rows(lb, joined, params)
    finally:
        lb.close()
    assert by_keys == by_join
    assert [(r["record_key"], r["_inspire_key"], r["_inspire_change"], r["_inspire_moved_to"]) for r in by_keys] == [
        ("a", "a", "new", None), ("d", None, None, None), ("b", "b", "moved", "Act now")], \
        "a deleted record the list still shows takes no change mark, and a record off the page never reaches it"


def test_each_earlier_run_read_for_a_comparison_is_the_same_rows_on_the_run_log_layout_on_a_real_postgres(layouts):
    history = {"log": shell_sql.table_name(LOG), "tier": "priority_tier", "columns": [n for n, _t, _pg in COLUMNS], "run_type": "STRING"}
    names, listed = [n for n, _t, _pg in COLUMNS], shell_sql.records_sql(RESULT)
    run = shell_sql.RUN_COLUMN.strip("`")
    picked = lambda rows: sorted((r[run], r["record_key"], r["run_id"], r["rank"], r["priority_tier"]) for r in rows)
    old = picked(_rows(layouts("loss_old"), shell_sql.runs_compare_sql(listed, RESULT, names, range(5)), []))
    new = picked(_rows(layouts("loss_new"), shell_sql.runs_compare_sql(listed, RESULT, names, range(5), history), []))
    assert old == new, "a run the log lists without a new version is read from the log, as the one version per run layout wrote it"
    assert [r for r in new if r[0] == shell_sql.RUN_PREVIOUS] == [(shell_sql.RUN_PREVIOUS, "a", "r4", 6, "Monitor")], \
        "the previous run is the one before the latest, and a record it did not list is not read into it"
    assert {r[0] for r in new} == {shell_sql.RUN_LATEST, shell_sql.RUN_PREVIOUS, f"{shell_sql.RUN_PREVIOUS}_2",
                                   f"{shell_sql.RUN_PREVIOUS}_3", f"{shell_sql.RUN_PREVIOUS}_4"}


def test_on_lakebase_the_decision_list_reads_only_the_current_rows_copy_and_the_latest_run_of_the_log():
    current, changes, records = f"{TABLE}__lb", f"{TABLE}__lb_changes", f"{TABLE}__lb_records"
    column = lambda n, t="STRING": {"name": n, "type": t, "type_text": t}
    tables = {current: {"pg": "app.t", "columns": [column("record_key"), column("valid_from", "TIMESTAMP"), column("is_current", "BOOLEAN"),
                                                   column("change_source"), column("action_owner"), column("action_status")]},
              changes: {"pg": "app.c", "columns": [column("record_key"), column("change"), column("moved_to")]},
              records: {"pg": "app.r", "columns": [column("record_key"), column("rank", "INT"), column("entity_label")]}}
    backend = {"kind": "lakebase", "tables": tables, "datasets": {"p": {"records": records}}, "current": {TABLE: current},
               "changes": {TABLE: changes}}
    page = {"id": "p", "result_table": TABLE, "datasets": [{"name": "records", "sql": f"SELECT * FROM {TABLE} WHERE is_current"}],
            "records": {"key": "record_key", "rank": "rank", "label": "entity_label", "tier": "priority_tier"}}
    served = shell_pg.served_page(page, backend)
    context = dict(_context(LAYOUT, {"latest": "r7", "previous": "r6"}), current=shell_sql.table_name(current),
                   latest_log=shell_sql.table_name(changes))
    for changed in (False, True):
        request = {"sort": "rank", "dir": "asc", "offset": 0, "limit": 25, "search": "", "mine": False, "changed": changed, "ai": {},
                   "columns": {}, "cursor": None}
        plan = shell_sql.list_queries(served, {}, request, context)
        for name in ("rows", "total"):
            text, _values, read = shell_pg.render(plan[name][0], plan[name][1], {shell_pg.uc_key(k): v for k, v in tables.items()})
            assert QUOTED not in plan[name][0] and QUOTED_LOG not in plan[name][0], (name, changed)
            assert read <= {shell_pg.uc_key(k) for k in tables}, (name, changed, read)
    owners = shell_sql.list_summary_queries(dict(context, actions=True))["owners"][0]
    assert f"FROM {shell_sql.table_name(current)} WHERE" in owners
    plan = shell_pg.overlay_plan([served], backend, {"p": {shell_pg.uc_key(records)}}, TABLE, ["k1"])
    assert plan["result"] == shell_pg.uc_key(current) and plan["copies"] == {shell_pg.uc_key(records): "record_key"}, \
        "a saved change shows on top of the current rows copy and the decision list copy until Lakebase syncs it"
    assert shell_pg.dataset_sources([served], backend)[shell_pg.uc_key(current)] == (
        f"SELECT * FROM {QUOTED} WHERE `is_current` AND `change_source` <> 'delete'")
    assert shell_pg.uc_key(current) in shell_pg.page_tables(served, backend), "a write holds the current rows copy until the sync lands"


def test_a_strict_lakebase_check_reads_the_history_lakebase_does_not_copy_from_delta_but_still_refuses_a_missing_copy(tmp_path):
    from v141_app_shell_test import FakeWorkspace, SETTINGS, app_dir
    from v142_edits_test import edit_page
    result = "main.pricing.loss_desk_out"
    backend = {"kind": "lakebase", "pipeline_id": "p", "datasets": {},
               "tables": {f"{result}__lb": {"pg": "a.t", "columns": [{"name": "record_key", "type": "STRING", "type_text": "STRING"}]}},
               "current": {result: f"{result}__lb"}, "changes": {}}

    class Refusing:
        tables = {f"{result}__lb": {}}

        def __init__(self, table):
            self.table = table

        def run(self, sql, params, limit):
            raise shell_pg.NotHeld(self.table) if self.table else shell_pg.NotServed("the query uses FOO, which Lakebase cannot run")

        def status(self):
            return {"note": "", "catching_up": False, "synced_at": None}

        def pending(self):
            return False

    for table, refused in ((result, False), (f"{result}_run_log", False), ("main.pricing.other", True), ("", True)):
        ws, root = FakeWorkspace(), tmp_path / (table or "x").replace(".", "_")
        root.mkdir()
        s = shell_core.Shell(app_dir(root, dict(SETTINGS, backend=backend), [edit_page()]),
                             env={"DATABRICKS_WAREHOUSE_ID": "wh1"}, sp_factory=lambda: ws, user_factory=lambda h, t: ws,
                             lakebase_factory=lambda b, env, service, t=table: Refusing(t), strict=True)
        if refused:
            with pytest.raises(shell_core.QueryError, match="Lakebase cannot serve it"):
                s.execute(ws, "SELECT 1", [], 1)
        else:
            assert s.execute(ws, "SELECT 1", [], 1)["served"] == "delta", table

