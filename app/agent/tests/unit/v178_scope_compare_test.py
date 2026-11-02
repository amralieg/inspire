"""Decision 7A: a comparison reads only earlier runs with the same First run scope, every number states its scope, the tile states
calmly that the previous run covered a different scope, and the Run page states what the first run covered and what Run on
everything would take, offline."""
import json
import re

import pytest

from v175_runs_one_pass_test import COLS, CURRENT, _db, _local_dim
from v173_dashboard_previous_run_test import RESULT
from v177_first_run_test import FIXTURE as FIRST_RUN
import shell_core  # noqa: E402
import shell_sql  # noqa: E402

SUMMARY = "`main`.`inspire`.`churn_out_summary`"
DATASET = f"SELECT o.record_key, o.value FROM {RESULT} AS o WHERE {CURRENT}"
ROWS = [("a", "10:00", "11:00", 0, "run", "job", "r1", 1.0, "Books"), ("b", "10:00", "12:00", 0, "run", "job", "r1", 4.0, "Books"),
        ("a", "11:00", "12:00", 0, "run", "job", "r2", 5.0, "Books"), ("a", "12:00", None, 1, "run", "job", "r3", 9.0, "Books"),
        ("b", "12:00", None, 1, "run", "job", "r3", 6.0, "Books")]


def _keyed(*keys):
    db = _db(ROWS)
    db.create_function("regexp_extract", 3, lambda text, pattern, group: (re.search(pattern, text or "") or [None, ""])[group] or "")
    db.execute("CREATE TABLE churn_out_summary (use_case_id TEXT, run_id TEXT, run_segments TEXT)")
    for run, key in zip(("r1", "r2", "r3"), keys):
        segments = json.dumps([{"scope": key.split(":")[0], "key": key}]) if key else json.dumps([])
        db.execute("INSERT INTO churn_out_summary VALUES ('N01-U01', ?, ?)", (run, segments))
    return db


def _previous(db, scopes=True):
    sql = shell_sql.runs_compare_sql(DATASET, RESULT, COLS, (1,), scopes=scopes)
    rows = db.execute(_local_dim(sql.replace(SUMMARY, "churn_out_summary"))).fetchall()
    return sorted((r[0], r[1]) for r in rows)


@pytest.mark.parametrize("keys,expected", [
    (("groups:aaaa", "groups:aaaa", "groups:aaaa"), [("a", 5.0), ("b", 4.0)]),
    (("groups:aaaa", "all", "groups:aaaa"), [("a", 1.0), ("b", 4.0)]),
    (("all", "all", "groups:aaaa"), []),
    (("", "", ""), [("a", 5.0), ("b", 4.0)]),
    (("groups:aaaa|grouping:1111", "groups:aaaa|grouping:2222", "groups:aaaa|grouping:1111"), [("a", 1.0), ("b", 4.0)]),
    (("all", "all|grouping:2222", "all|grouping:1111"), []),
], ids=["same scope", "skips a run on another scope", "no earlier run on this scope", "runs that recorded no scope",
        "skips a run grouped another way", "no earlier run grouped this way"])
def test_the_previous_run_is_the_latest_earlier_run_with_the_same_scope(keys, expected):
    assert _previous(_keyed(*keys)) == expected


def test_a_page_that_records_no_scopes_keeps_the_previous_run_whatever_its_scope():
    assert _previous(_keyed("all", "all", "groups:aaaa"), scopes=False) == [("a", 5.0), ("b", 4.0)]
    plain = shell_sql.runs_compare_sql(DATASET, RESULT, COLS, (1,))
    assert SUMMARY not in plain and "_inspire_scope" not in plain


def test_the_tile_the_counter_and_the_alert_compare_by_scope_on_a_page_that_records_scopes():
    page = {"id": "p", "result_table": RESULT, "datasets": [{"name": "rows", "sql": DATASET}], "filters": [],
            "kpis": [{"id": "k", "label": "K", "dataset": "rows", "expression": "SUM(value)", "compare": True}]}
    scoped = dict(page, run_scopes=True)
    assert SUMMARY not in shell_sql.previous_rows(page, "rows", COLS) and SUMMARY in shell_sql.previous_rows(scoped, "rows", COLS)
    watch = {"what": "k", "filters": {}, "operator": ">", "threshold": 1, "basis": "baseline"}
    alert = shell_sql.watch_query(scoped, watch, COLS)["query"]
    assert alert.count(SUMMARY) == 2, "once for the earlier runs on the same scope, once for the latest run's scope line"
    assert alert.count("ROW_NUMBER() OVER (ORDER BY `_inspire_ran` DESC)") == 1 and len(alert) < 20000
    assert SUMMARY not in shell_sql.watch_query(page, watch, COLS)["query"]


def test_the_dashboard_counter_compares_by_scope_when_the_page_holds_the_first_run(agent_ns):
    page = {"id": "p", "result_table": RESULT, "datasets": [{"name": "rows", "sql": DATASET}], "filters": [],
            "kpis": [{"id": "k", "label": "K", "dataset": "rows", "expression": "SUM(value)", "compare": True}]}
    schema = [(c, "string") for c in COLS]
    plain = agent_ns["implement_dashboard_history"](page, shell_sql, RESULT, schema)
    scoped = agent_ns["implement_dashboard_history"](dict(page, settings=[{"name": "run_scope", "source": "widget"}]), shell_sql, RESULT, schema)
    assert "rows_runs" in plain["datasets"] and [n for n, sql in plain["datasets"].items() if SUMMARY in sql] == []
    assert [n for n, sql in scoped["datasets"].items() if SUMMARY in sql] == ["rows_runs"]
    assert shell_sql.page_scopes({"settings": [{"name": "run_scope"}]}) and shell_sql.page_scopes({"run_scopes": True})
    assert not shell_sql.page_scopes({"settings": [{"name": "flag_segments"}]}) and not shell_sql.page_scopes(None)


CHOSEN = {
    "groups": {"scope": "groups", "table": "main.sales.orders", "column": "region", "values": ["EMEA", "AMER", "APAC"]},
    "recent": {"scope": "recent", "table": "main.sales.orders", "column": "order_date", "since": "2026-10-02", "days": 30},
    "records": {"scope": "records", "table": "main.sales.orders", "records": 1000},
}


@pytest.mark.parametrize("mode,text", [
    ("groups", "First run: the 3 groups EMEA, AMER, APAC of region"),
    ("recent", "First run: the records of order_date since 2026-10-02"),
    ("records", "First run: the first 1000 records of main.sales.orders"),
])
def test_every_number_states_the_scope_the_run_recorded_in_the_run_s_own_words(agent_ns, mode, text):
    record = agent_ns["inspire_scope_record"](CHOSEN[mode])
    assert record["text"] == agent_ns["inspire_scope_text"](CHOSEN[mode])
    assert shell_sql.scope_text(record) == text
    assert shell_sql.scope_text(json.loads(json.dumps(record))) == text, "the text survives the run log's JSON"


def test_all_records_and_a_scope_that_recorded_no_words_never_pass_for_one_another(agent_ns):
    assert shell_sql.scope_text(None) == shell_sql.scope_text({"scope": "all", "key": "all"}) == "All records"
    assert shell_sql.scope_text(agent_ns["inspire_scope_record"]({"scope": "all"})) == "All records"
    assert shell_sql.scope_text({"scope": "groups", "key": "groups:x"}) == "First run: part of the records"
    assert shell_sql.scope_text({"scope": "groups", "key": "groups:x", "text": "  the 1 group\nEMEA of  region "}) == (
        "First run: the 1 group EMEA of region")


def test_the_tile_says_calmly_that_the_previous_run_covered_a_different_scope():
    rows = lambda *keys: [{"run_segments": json.dumps([{"scope": k.split(":")[0], "key": k, "column": "region", "values": ["EMEA"],
                                                         "text": "the 1 group EMEA of region"}])} for k in keys]
    assert shell_sql.scope_view(rows("all", "groups:aaaa")) == {"text": "All records", "note": "The previous run covered a different scope."}
    assert shell_sql.scope_view(rows("groups:aaaa", "groups:aaaa"))["note"] == ""
    assert shell_sql.scope_view(rows("groups:aaaa")) == {"text": "First run: the 1 group EMEA of region", "note": ""}
    assert shell_sql.scope_view([]) == {"text": "", "note": ""}
    note = shell_sql.scope_note({"key": "all"}, {"key": "groups:x"})
    assert not re.search(r"warn|careful|caution|!|not comparable", note, re.I), "a fact, never a warning"


def test_the_run_page_states_what_the_first_run_covered_and_what_everything_would_take():
    scope = {"scope": "groups", "table": "main.sales.orders", "column": "region", "values": ["EMEA", "AMER", "APAC"], "key": "groups:x",
             "text": "the 3 groups EMEA, AMER, APAC of region"}
    tables = [{"table": "main.sales.orders", "rows": 900, "rows_total": 48000}, {"table": "main.sales.stores", "rows": 12, "rows_total": 12}]
    facts = shell_sql.scope_facts(scope, tables, 240)
    assert facts == {"covered": "The first run covered 900 of 48,000 records (3 groups) in 4 minutes.",
                     "everything": "Run on everything covers all 48,000 records, about 213 minutes at this run's pace."}
    assert shell_sql.scope_facts({"scope": "all", "key": "all"}, tables, 240) == {"covered": "", "everything": ""}
    assert shell_sql.scope_facts(scope, [], 240) == {"covered": "", "everything": ""}, "no count, no invented numbers"
    assert shell_sql.scope_facts(scope, tables, None)["covered"] == "The first run covered 900 of 48,000 records (3 groups)."
    one = shell_sql.scope_facts(dict(scope, scope="records"), [{"table": "main.sales.orders", "rows": 1, "rows_total": 1}], None)
    assert one == {"covered": "The first run covered 1 of 1 record.", "everything": "Run on everything covers all 1 record."}
    view = shell_core.run_view({"run_id": "r3"}, {"run_segments": json.dumps([{"column": "channel", "values": ["web"]}, scope]),
                                                  "run_tables": json.dumps(tables), "run_started_at": None}, {"filters": []})
    assert view["scope"] == scope and view["scope_text"] == "First run: the 3 groups EMEA, AMER, APAC of region"
    assert view["segments"] == [{"column": "channel", "label": "Channel", "values": ["web"], "more": 0}], "the scope is not a segment"
    assert view["tables"][0] == {"table": "main.sales.orders", "rows": 900, "rows_total": 48000, "scoped": False, "updated_at": None}


def test_the_latest_run_counter_and_the_weekly_email_state_the_scope_only_where_the_use_case_holds_the_first_run():
    plain = shell_sql.run_status_query("main.inspire.churn_out_summary", "N01-U01")
    scoped = shell_sql.run_status_query("main.inspire.churn_out_summary", "N01-U01", True)
    assert plain == shell_sql.run_status_query("main.inspire.churn_out_summary", "N01-U01", False)
    assert "run_segments" not in plain and "from_json" not in plain and shell_sql.SCOPE_SENTENCE not in plain
    assert "CAST(`run_segments` AS STRING) AS `segments`" in scoped and scoped.count("from_json(l.`segments`") == 2
    assert "'ARRAY<STRUCT<scope: STRING, text: STRING>>'" in scoped and "s.`scope` <> 'all'" in scoped
    assert "' The latest run covered only '" in scoped and "'part of the records'" in scoped
    fields = [{"name": c, "type": "STRING"} for c in ("record_key", "entity_label", "is_current", "change_source", "valid_from")]
    week = lambda scopes, status="main.inspire.churn_out_summary": shell_sql.digest_query(
        "main.inspire.churn_out", fields, use_case="N01-U01", status_table=status, scopes=scopes)
    assert "from_json(l.`segments`" not in week(False) and week(True).count("from_json(l.`segments`") == 2
    assert "from_json(l.`segments`" not in week(True, ""), "no summary table, no latest run line"


def test_the_dashboard_and_the_weekly_email_pass_the_first_run_to_the_latest_run_line(agent_ns, tmp_path):
    from _agentload import agent_source
    from v142_dash_test import _page, _shell
    shell = _shell(agent_ns, tmp_path)
    built = lambda page: "".join(next(d for d in agent_ns["implement_dashboard_from_page"](
        page, shell, "main.inspire.churn_out", {}, status_table="main.inspire.churn_out_summary")["datasets"]
        if d["name"] == "run_status")["queryLines"])
    page = _page(agent_ns)
    assert built(page) == shell.run_status_query("main.inspire.churn_out_summary", page["use_case_id"])
    assert built(dict(page, run_scopes=True)) == shell.run_status_query("main.inspire.churn_out_summary", page["use_case_id"], True)
    assert 'scopes=bool((context.get("spec") or {}).get("first_run"))' in agent_source()


@pytest.mark.parametrize("segments,page_scopes,expected", [
    ([{"column": "channel", "values": ["web"]}, {"scope": "groups", "key": "groups:x", "text": "the 2 groups EMEA, AMER of region"}], True,
     "First run: the 2 groups EMEA, AMER of region"),
    ([{"scope": "all", "key": "all", "text": "all the records"}], True, ""),
    ([], True, ""),
    ("{not json", True, ""),
    ([{"scope": "groups", "key": "groups:x", "text": "the 2 groups EMEA, AMER of region"}], False, None),
], ids=["a scoped run", "a run on everything", "a run that recorded no scope", "an unreadable log", "a page without the First run"])
def test_the_run_summary_the_overview_and_impact_read_states_the_latest_run_s_scope(tmp_path, segments, page_scopes, expected):
    from v141_app_shell_test import SETTINGS, call
    from v142_edits_test import edit_page
    from v144_app_data_test import shell
    from v147_app_ai_test import RUN, AiWorkspace
    logged = segments if isinstance(segments, str) else json.dumps(segments)
    page = edit_page(run_scopes=True) if page_scopes else edit_page()
    s, _ws, _made = shell(tmp_path, settings=SETTINGS, pages=[page], ws=AiWorkspace(summary=dict(RUN, run_segments=logged)))
    status, out = call(s, "GET", "summary", query={"page": "n01_u05"})
    assert status == 200
    assert out["run"].get("scope_text") == expected
    if expected is None:
        assert "scope_text" not in out["run"], "a page without the First run reads its summary as before"


def test_an_empty_groups_setting_saves_and_any_other_empty_choice_does_not():
    groups = {"name": "scope_groups", "kind": "choice", "choices": [], "many": True, "optional": True}
    assert shell_sql.setting_problem(groups, "") == ""
    assert shell_sql.setting_problem(dict(groups, optional=False), "") == "scope_groups is ''; allowed: any text"


LOG_COLUMNS = ("use_case_id", "run_id", "as_of_date", "ran_at", "record_key", "rank", "tier", "held_back", "run_tier", "first_run", "change",
               "moved_to")
VERSION_COLUMNS = ("use_case_id", "run_id", "as_of_date", "valid_from", "record_key", "rank", "priority_tier", "is_current", "change_source")
COMPARE = FIRST_RUN["compare"]
KEYS = COMPARE["keys"]
LOGGED = COMPARE["logged"]


class _MinBy:
    def __init__(self):
        self.seen = []

    def step(self, value, by):
        self.seen.append((by, value))

    def inverse(self, value, by):
        self.seen.remove((by, value))

    def value(self):
        kept = [pair for pair in self.seen if pair[0] is not None]
        return min(kept)[1] if kept else None

    finalize = value


def _run_log_db(logged=("g1", "e1")):
    import sqlite3
    db = sqlite3.connect(":memory:")
    db.create_window_function("MIN_BY", 2, _MinBy)
    db.execute(f"CREATE TABLE churn_out ({', '.join(VERSION_COLUMNS)})")
    db.execute(f"CREATE TABLE churn_out_run_log ({', '.join(LOG_COLUMNS)})")
    first = {}
    for case in COMPARE["runs"]:
        run, at = case["run"], case["ran_at"]
        for record, tier in sorted(case["tiers"].items()):
            first.setdefault(record, run)
            db.execute("INSERT INTO churn_out VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                       ("N01-U01", run, "2026-10-01", at, record, 1, tier, int(run == "g2"), "run"))
            if run in logged:
                db.execute(f"INSERT INTO churn_out_run_log VALUES ({', '.join('?' for _ in LOG_COLUMNS)})",
                           ("N01-U01", run, "2026-10-01", at, record, 1, tier, None, None, first[record], None, None))
    return db


def _on_sqlite(sql):
    from v142_scd_test import QUOTED, QUOTED_LOG
    return (sql.replace(QUOTED_LOG, "churn_out_run_log").replace(QUOTED, "churn_out").replace(" AS STRING)", " AS TEXT)")
            .replace(" <=> ", " IS ").replace("n.* EXCEPT (first_seen)", ", ".join(f"n.{c}" for c in LOG_COLUMNS[:10])))


def _insert(agent_ns, keys=None, key=""):
    from v142_scd_test import TABLE
    return agent_ns["inspire_run_log_insert_sql"](TABLE, "N01-U01", "g2", "'12:00'", "priority_tier", list(VERSION_COLUMNS), keys, key)


@pytest.mark.parametrize("case", LOGGED, ids=[c["name"] for c in LOGGED])
def test_the_run_log_marks_a_record_new_or_moved_only_against_the_earlier_run_on_the_same_scope(agent_ns, case):
    db = _run_log_db()
    db.execute(_on_sqlite(_insert(agent_ns, case["keys"], case["key"])))
    marked = db.execute("SELECT record_key, first_run, change, moved_to FROM churn_out_run_log WHERE run_id = 'g2'").fetchall()
    assert sorted(marked) == [tuple(m) for m in case["marks"]]


def test_a_use_case_whose_runs_recorded_no_scope_writes_the_run_log_with_the_same_sql_as_before(agent_ns):
    assert _insert(agent_ns, {"g1": "", "e1": ""}, "") == _insert(agent_ns)
    assert "AS q ON" not in _insert(agent_ns) and "AS q ON" in _insert(agent_ns, KEYS, "groups:aaaa")


def test_the_run_log_rebuilt_from_the_versions_marks_each_run_against_the_run_before_on_its_scope(agent_ns):
    from v142_scd_test import TABLE

    def rebuilt(keys):
        db = _run_log_db(logged=())
        db.execute(_on_sqlite(agent_ns["inspire_run_log_backfill_sql"](TABLE, "priority_tier", list(VERSION_COLUMNS), keys)))
        return sorted(db.execute("SELECT run_id, record_key, first_run, change, moved_to FROM churn_out_run_log").fetchall())

    old = [tuple(r) for r in COMPARE["rebuilt"]["unscoped"]]
    assert rebuilt(None) == old
    assert rebuilt({"g1": "", "e1": "", "g2": ""}) == old
    assert rebuilt(dict(KEYS, g2="groups:aaaa")) == [tuple(r) for r in COMPARE["rebuilt"]["scoped"]]
    plain = agent_ns["inspire_run_log_backfill_sql"](TABLE, "priority_tier", list(VERSION_COLUMNS))
    assert plain == agent_ns["inspire_run_log_backfill_sql"](TABLE, "priority_tier", list(VERSION_COLUMNS), {"g1": ""})


@pytest.mark.parametrize("case", LOGGED, ids=[c["name"] for c in LOGGED])
def test_the_run_facts_keep_the_earlier_run_on_the_same_scope_as_the_previous_run(agent_ns, case):
    from v120_artifacts_support import FakeSpark
    from v142_scd_test import TABLE
    db = _run_log_db(logged=("g1", "e1", "g2"))
    spark = FakeSpark(lambda sql: [{"version": 3}] if sql.startswith("DESCRIBE HISTORY") else None)
    agent_ns["inspire_run_facts"](spark, TABLE, "N01-U01", "g2", "priority_tier", 0, lambda line: None, case["keys"], case["key"])
    orders = [s for s in spark.statements if s.endswith("GROUP BY run_id ORDER BY MIN(ran_at) DESC LIMIT 2")]
    unscoped = "SELECT run_id FROM churn_out_run_log GROUP BY run_id ORDER BY MIN(ran_at) DESC LIMIT 2"
    keys = None if case["keys"] is None else dict(case["keys"], g2=case["key"])
    assert len(orders) == (0 if agent_ns["inspire_same_scope_sql"]("run_id", keys, case["key"]) == "" else 1)
    assert [r[0] for r in db.execute(_on_sqlite(orders[0]) if orders else unscoped).fetchall()] == case["previous"]


def test_a_scoped_run_reads_the_earlier_runs_scopes_once_and_marks_and_counts_against_its_own_scope(fresh_ns):
    from v142_scd_test import CORE, HISTORY, QUOTED_LOG, _Tables
    from v165_change_versions_test import LOG_PROPS
    chosen = {"scope": "groups", "table": "main.sales.orders", "column": "region", "values": ["EMEA"]}
    key = fresh_ns["inspire_scope_key"](chosen)
    fresh_ns["INSPIRE_RUN"], fresh_ns["INSPIRE_RUN_LOG"] = {"scope": chosen}, {"scope": chosen}
    tables = _Tables(fresh_ns, target=CORE + HISTORY, properties=LOG_PROPS)
    respond, reads = tables.respond, "SELECT CAST(run_id AS STRING) AS run_id, MAX(regexp_extract(run_segments, "
    tables.spark.responder = lambda s: [{"run_id": "r-1", "scope_key": key}, {"run_id": "r-0", "scope_key": "all"}] if s.startswith(
        reads) else respond(s)
    tables.run()
    statements = tables.spark.statements
    insert = next(s for s in statements if s.startswith(f"INSERT INTO {QUOTED_LOG} SELECT n.*"))
    order = next(s for s in statements if s.endswith("GROUP BY run_id ORDER BY MIN(ran_at) DESC LIMIT 2"))
    assert len([s for s in statements if s.startswith(reads)]) == 1
    assert insert.count("AND CAST(run_id AS STRING) IN ('r-1')") == 3, "the run before, its tiers and the records it listed"
    assert "'r-1'" in order and "'r-0'" not in insert + order


def test_a_run_whose_earlier_scopes_cannot_be_read_says_so_and_marks_nothing(fresh_ns):
    from v142_scd_test import CORE, HISTORY, QUOTED_LOG, _Tables
    from v165_change_versions_test import LOG_PROPS
    chosen = {"scope": "groups", "table": "main.sales.orders", "column": "region", "values": ["EMEA"]}
    fresh_ns["INSPIRE_RUN"], fresh_ns["INSPIRE_RUN_LOG"] = {"scope": chosen}, {"scope": chosen}
    tables = _Tables(fresh_ns, target=CORE + HISTORY, properties=LOG_PROPS,
                     fail="SELECT CAST(run_id AS STRING) AS run_id, MAX(regexp_extract(run_segments, ")
    _rows, printed = tables.run()
    insert = next(s for s in tables.spark.statements if s.startswith(f"INSERT INTO {QUOTED_LOG} SELECT n.*"))
    assert "AND FALSE" in insert and any(p.startswith("Run log: Inspire could not read which earlier runs") for p in printed)
    fresh_ns["INSPIRE_RUN"], fresh_ns["INSPIRE_RUN_LOG"] = {}, {}
    plain = _Tables(fresh_ns, target=CORE + HISTORY, properties=LOG_PROPS,
                    fail="SELECT CAST(run_id AS STRING) AS run_id, MAX(regexp_extract(run_segments, ")
    _rows, printed = plain.run()
    assert "AND FALSE" not in next(s for s in plain.spark.statements if s.startswith(f"INSERT INTO {QUOTED_LOG} SELECT n.*"))
    assert not any("could not read which earlier runs" in p for p in printed), "a run without a scope keeps the old marks quietly"


def _latest_and_previous(db, scopes):
    from v173_dashboard_previous_run_test import QUOTED
    ctes = shell_sql._runs_ctes(QUOTED, None, None, SUMMARY if scopes else None)
    sql = f"WITH r AS ({ctes['r']}), n AS ({ctes['n']}) SELECT `_inspire_latest`, `_inspire_previous` FROM n"
    return db.execute(_local_dim(sql.replace(SUMMARY, "churn_out_summary"))).fetchone()


@pytest.mark.parametrize("keys,scopes,expected", [
    (("groups:aaaa", "all", "groups:aaaa"), True, ("r3", "r1")), (("groups:aaaa", "all", "groups:aaaa"), False, ("r3", "r2")),
    (("", "", ""), True, ("r3", "r2")), (("all", "all", "groups:aaaa"), True, ("r3", None)),
], ids=["same scope", "a page without the First run", "runs that recorded no scope", "no earlier run on this scope"])
def test_the_app_counts_new_and_changed_records_against_the_earlier_run_on_the_same_scope(keys, scopes, expected):
    assert _latest_and_previous(_keyed(*keys), scopes) == expected


def test_the_record_list_compares_by_scope_on_every_path_the_app_counts_itself():
    from v165_change_versions_test import LAYOUT, _context
    page = {"id": "p", "datasets": [{"name": "records", "sql": f"SELECT * FROM {RESULT} WHERE is_current"}], "result_table": RESULT,
            "records": {"key": "record_key", "rank": "rank", "label": "entity_label", "tier": "priority_tier"}}
    request = {"sort": "rank", "dir": "asc", "offset": 0, "limit": 25, "search": "", "mine": False, "changed": True, "ai": {},
               "columns": {}, "cursor": None}
    rows = lambda context: shell_sql.list_queries(page, {}, request, context)["rows"][0]
    facts = {"latest": "r7", "previous": "r6"}
    compared = "t.`run_id` IN (SELECT `_inspire_run` FROM r)"
    old, old_scoped = rows(_context()), rows(dict(_context(), scopes=SUMMARY))
    assert SUMMARY not in old and compared not in old
    assert SUMMARY in old_scoped and "`_inspire_latest_scope`" in old_scoped and compared in old_scoped
    stored = "CAST('r7' AS STRING) AS `_inspire_latest`"
    assert stored in rows(dict(_context(LAYOUT, facts), scopes=SUMMARY)), "the run's stored marks and counts are already by scope"
    rebuilt = rows(dict(_context(LAYOUT, facts, tier="risk_band"), scopes=SUMMARY))
    assert stored not in rebuilt and SUMMARY in rebuilt, "a page that rebuilds the marks itself compares by scope, not by the stored runs"
    assert stored in rows(_context(LAYOUT, facts, tier="risk_band"))
    left = lambda context: shell_sql.list_summary_queries(dict(context, actions=False))["left"][0]
    assert SUMMARY in left(dict(_context(), scopes=SUMMARY)) and SUMMARY not in left(_context())


def test_the_record_list_reads_the_scopes_only_for_a_page_that_records_them():
    page = {"id": "p", "datasets": [{"name": "records", "sql": f"SELECT * FROM {RESULT} WHERE is_current"}], "result_table": RESULT,
            "records": {"key": "record_key", "rank": "rank", "label": "entity_label", "tier": "priority_tier"}}
    fields = [{"name": n, "type": "STRING"} for n in ("record_key", "rank", "entity_label", "priority_tier", "run_id", "valid_from",
                                                       "is_current", "change_source")]
    columns = [f["name"] for f in fields]
    assert shell_sql.list_context(page, columns, fields, True)["scopes"] is None
    assert shell_sql.list_context(dict(page, run_scopes=True), columns, fields, True)["scopes"] == SUMMARY
    assert shell_sql.list_context(dict(page, run_scopes=True), columns, None, True)["scopes"] is None


def test_an_app_alert_on_a_page_that_records_scopes_states_the_latest_run_s_scope_in_its_email():
    import shell_alerts
    page = {"id": "p", "result_table": RESULT, "datasets": [{"name": "rows", "sql": DATASET}], "filters": [],
            "kpis": [{"id": "k", "label": "K", "dataset": "rows", "expression": "SUM(value)", "compare": True}]}
    for basis in ("fixed", "baseline"):
        watch = {"what": "k", "filters": {}, "operator": ">", "threshold": 1, "basis": basis}
        plain, scoped = shell_sql.watch_query(page, watch, COLS), shell_sql.watch_query(dict(page, run_scopes=True), watch, COLS)
        assert "scoped" not in plain and shell_sql.SCOPE_COLUMN not in plain["query"], basis
        assert scoped["scoped"] is True and scoped["query"].count(f" AS {shell_sql.SCOPE_COLUMN}") == 1, basis
        assert "'The latest run covered only '" in scoped["query"] and "s.`scope` <> 'all'" in scoped["query"], basis
    assert shell_sql.SCOPE_TEMPLATE == "{{#QUERY_RESULT_ROWS}}{{run_scope}}{{/QUERY_RESULT_ROWS}}"
    lines = shell_alerts.runbook("the count rose", "it is above 1", "daily", scoped=True).splitlines()
    assert lines[0].startswith("What fired: ") and lines[1] == shell_sql.SCOPE_TEMPLATE
    assert shell_sql.SCOPE_TEMPLATE not in shell_alerts.runbook("the count rose", "it is above 1", "daily")
    meta = {"name": "Grows", "watch": {"what": "k", "filters": {}, "operator": ">", "threshold": 1, "basis": "fixed"}, "by": "pat",
            "schedule": "daily"}
    assert shell_sql.SCOPE_TEMPLATE in shell_alerts.watch_texts(page, meta, "", True)[1]
    assert shell_sql.SCOPE_TEMPLATE not in shell_alerts.watch_texts(page, meta, "")[1]


def test_the_build_time_alert_on_a_use_case_with_the_first_run_compares_and_states_by_scope(agent_ns):
    import shell_alerts
    from _agentload import agent_source
    from v142_scd_test import TABLE
    from v169_alert_runbook_test import _outputs_of
    outputs = {"alert_tiers": "act_now_review", "alert_operator": "<", "alert_threshold": 4, "alert_threshold_basis": "baseline"}
    history = shell_sql.HISTORY_COLUMNS + ("category", "run_id", "as_of_date")
    plain = agent_ns["implement_alert_query"](shell_sql, TABLE, outputs, "", "N01-U01", columns=history)
    scoped = agent_ns["implement_alert_query"](shell_sql, TABLE, outputs, "", "N01-U01", columns=history, scopes=True)
    assert "scoped" not in plain and "`_inspire_latest_scope`" not in plain["query"] and shell_sql.SCOPE_COLUMN not in plain["query"]
    assert scoped["scoped"] is True and "`_inspire_latest_scope`" in scoped["query"] and f" AS {shell_sql.SCOPE_COLUMN}" in scoped["query"]
    assert "WHERE `use_case_id` = 'N01-U01' ORDER BY `updated_at` DESC NULLS LAST LIMIT 1" in scoped["query"]
    texts = lambda **more: agent_ns["implement_alert_texts"](shell_alerts, "N01-U01", {"Name": "Predict churn"}, _outputs_of(agent_ns),
                                                             **more)[1]
    assert shell_sql.SCOPE_TEMPLATE in texts(scoped=True) and shell_sql.SCOPE_TEMPLATE not in texts()
    source = agent_source()
    assert source.count('scopes=bool((context.get("spec") or {}).get("first_run")))') == 2
    assert 'scoped=bool(query.get("scoped")))' in source
