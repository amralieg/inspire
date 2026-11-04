import concurrent.futures
import re
import sqlite3
import threading
import time

import pytest
import sqlglot

from v141_app_shell_test import call
from v148_app_hub_test import hub_shell
from v145_lakebase_test import postgres  # noqa: F401
from v166_run_facts_test import FactsWarehouse, _facts_shell, _ready_facts, engine, shell_core, shell_facts, shell_sql  # noqa: F401
from v168_run_log_readers_test import COLUMNS, CURRENT, LOG, RESULT, STAMPS, VERSIONS, _logged_layout

HOUR_US = 3600 * 1_000_000
WRAP = re.compile(r"\ASELECT \* FROM \(\n(.*)\n\) WHERE rand\(\) >= 0\Z", re.S)


def _at(hour):
    return hour * HOUR_US


def _ran_rows(sql):
    db = sqlite3.connect(":memory:")
    db.create_function("IF", 3, lambda c, a, b: a if c else b)
    db.create_function("TIMESTAMP_MICROS", 1, lambda us: f"{int(us) // HOUR_US:02d}:00")
    db.execute("CREATE TABLE churn_out (record_key TEXT, valid_from TEXT, valid_to TEXT, is_current INT, change_source TEXT, changed_by TEXT, "
               "run_id TEXT, use_case_id TEXT, value REAL)")
    db.executemany("INSERT INTO churn_out VALUES (?, ?, ?, ?, 'run', 'the job', ?, 'N01-U01', ?)", VERSIONS)
    db.execute('CREATE TABLE churn_out_run_log (use_case_id TEXT, run_id TEXT, as_of_date TEXT, ran_at TEXT, record_key TEXT, "rank" INT)')
    db.executemany("INSERT INTO churn_out_run_log VALUES ('N01-U01', ?, NULL, ?, ?, NULL)", STAMPS)
    quoted = lambda name: ".".join(f'"{part}"' for part in name.split("."))
    local = sqlglot.transpile(sql, read="databricks", write="sqlite")[0]
    return sorted(db.execute(local.replace(quoted(LOG), "churn_out_run_log").replace(quoted(RESULT), "churn_out")).fetchall())


def _run_facts(**extra):
    runs = [{"run_id": "r3", "tier": "Act now", "ran_us": _at(12), "n": 3}, {"run_id": "r2", "tier": "Act now", "ran_us": _at(11), "n": 2},
            {"run_id": "r2", "tier": "Watch", "ran_us": _at(11) + 5, "n": 1}, {"run_id": "r1", "tier": "Act now", "ran_us": _at(10), "n": 2}]
    return _ready_facts(runs=runs, latest="r3", previous="r2") | extra


@pytest.mark.parametrize("backs", [(0, 1, 2), (1,), (2,), (0, 2), (1, 2, 3)])
def test_the_earlier_runs_read_through_the_run_facts_give_the_same_rows_as_the_runs_ranked_from_the_whole_log(backs):
    log = _logged_layout()
    ranked = shell_sql.runs_compare_sql(CURRENT, RESULT, COLUMNS, backs, log)
    known = shell_sql.runs_compare_sql(CURRENT, RESULT, COLUMNS, backs, log, facts=_run_facts())
    assert "GROUP BY `run_id`" in ranked, "without the run facts the runs are ranked from every row of the log"
    assert "GROUP BY" not in known and "`run_id` IN (" in known, "the run facts name the runs, so the log is read only for those runs"
    assert _ran_rows(known) == _ran_rows(ranked)


def test_each_earlier_run_read_through_the_run_facts_reads_the_log_only_from_the_oldest_run_it_needs():
    known = shell_sql.runs_compare_sql(CURRENT, RESULT, COLUMNS, (1,), _logged_layout(), facts=_run_facts())
    assert "l.`run_id` IN (CAST('r3' AS STRING), CAST('r2' AS STRING))" in known and "'r1'" not in known
    assert f"v.`valid_from` >= timestamp_micros({_at(11)})" in known


@pytest.mark.parametrize("facts, scopes, why", [
    (_run_facts(latest="r9"), None, "the facts name another latest run than their own runs"),
    (_run_facts(previous="r1"), None, "the facts name another previous run than their own runs"),
    (_run_facts(runs=[{"run_id": "r3", "ran_us": None}]), None, "a run without its start time"),
    (_run_facts(v=0), None, "facts in an older shape"),
    (_run_facts(), "main.ops.churn_out_summary", "a page scoped to part of a shared table"),
    (None, None, "no facts")])
def test_the_earlier_runs_are_ranked_from_the_log_when_the_run_facts_cannot_name_them(facts, scopes, why):
    assert shell_sql.facts_run_order(facts, [1, 2], scopes) is None, why
    plain = shell_sql.runs_compare_sql(CURRENT, RESULT, COLUMNS, (0, 1), _logged_layout())
    assert shell_sql.runs_compare_sql(CURRENT, RESULT, COLUMNS, (0, 1), _logged_layout(), facts=facts if not scopes else None) == plain


def test_runs_cut_at_the_cap_rank_from_the_log_only_when_the_run_asked_for_is_past_the_cut():
    rows = [{"run_id": f"r{i}", "ran_us": _at(20) - i, "n": 1} for i in range(shell_facts.RUN_ROWS)]
    facts = _run_facts(runs=rows, latest="r0", previous="r1")
    assert shell_sql.facts_run_order(facts, [2])["order"][:3] == ["r0", "r1", "r2"]
    short = _run_facts(runs=rows[:2] * (shell_facts.RUN_ROWS // 2), latest="r0", previous="r1")
    assert shell_sql.facts_run_order(short, [1]) is not None
    assert shell_sql.facts_run_order(short, [2]) is None, "the facts list was cut, so a third run may exist beyond it"


def test_a_run_with_no_earlier_run_reads_no_earlier_rows():
    facts = _run_facts(runs=[{"run_id": "r3", "ran_us": _at(12), "n": 3}], previous=None)
    sql = shell_sql.runs_compare_sql(CURRENT, RESULT, COLUMNS, (0, 1), _logged_layout(), facts=facts)
    assert "WHERE FALSE" in sql and "_run_log" not in sql
    assert _ran_rows(sql) == [("a", 5.0, "latest"), ("b", 2.0, "latest"), ("c", 7.0, "latest")]


class OverviewWarehouse(FactsWarehouse):
    def __init__(self, facts, above):
        super().__init__(facts)
        self.above = above

    def run_sql(self, warehouse, sql, params, limit=5000):
        if "'item' AS `kind`" in sql:
            self.sql.append((sql, params, limit))
            n = self.above if "`value_at_stake` >=" in sql else shell_sql.CAPS["overview_rows"] + 40
            shown = min(n, shell_sql.CAPS["overview_rows"])
            return {"columns": [], "truncated": False,
                    "rows": [{"kind": "item", "k": f"k{i}", "label": f"Item {i}", "n": n, "money": 1e6 - i, "tier": "Act now",
                              "status": "New"} for i in range(shown)]}
        return super().run_sql(warehouse, sql, params, limit)


def _overview_shell(tmp_path, facts, above):
    from v148_app_hub_test import SETTINGS, hub_page
    ws = OverviewWarehouse(facts, above)
    settings = dict(SETTINGS, options=dict(SETTINGS.get("options") or {}, decisions=True))
    s, ws, _made = hub_shell(tmp_path, settings=settings, pages=[hub_page()], ws=ws)
    return s, ws


FLOORS = {"open": [[1000, 7000.0], [100000, 900.0]], "all": [[1000, 950.0], [100000, 10.0]]}


def test_the_overview_reads_only_the_open_records_above_the_runs_floor_and_says_its_count_is_a_lower_bound(tmp_path):
    s, ws = _overview_shell(tmp_path, _ready_facts(floors=FLOORS), shell_sql.CAPS["overview_rows"] + 7)
    status, out = call(s, "POST", "overview", body={"page": "n01_u05"})
    assert status == 200, out
    items = [sql for sql, _p, _l in ws.sql if "'item' AS `kind`" in sql]
    assert len(items) == 1 and "`value_at_stake` >= 900.0" in items[0], "the run's open floor bounds the read to the records at its top"
    assert "FROM d JOIN c ON " in items[0] and "FROM d LEFT JOIN c ON " not in items[0], \
        "only the current rows above the floor join the overview, so the warehouse skips every file below it"
    shown = out["pages"]["n01_u05"]
    assert shown["total"] == shell_sql.CAPS["overview_rows"] + 7 and shown["total_more"] is True and shown["truncated"] is True
    assert len(shown["items"]) == shell_sql.CAPS["overview_rows"]


def test_the_overview_reads_every_record_when_the_floor_leaves_it_short_and_then_counts_them_all(tmp_path):
    s, ws = _overview_shell(tmp_path, _ready_facts(floors=FLOORS), 12)
    status, out = call(s, "POST", "overview", body={"page": "n01_u05"})
    assert status == 200, out
    items = [sql for sql, _p, _l in ws.sql if "'item' AS `kind`" in sql]
    assert len(items) == 2 and "`value_at_stake` >=" in items[0] and "`value_at_stake` >=" not in items[1]
    shown = out["pages"]["n01_u05"]
    assert shown["total"] == shell_sql.CAPS["overview_rows"] + 40 and not shown.get("total_more") and shown["truncated"] is True


@pytest.mark.parametrize("facts", [_ready_facts(), None])
def test_the_overview_without_a_run_floor_reads_every_record_once(tmp_path, facts):
    s, ws = _overview_shell(tmp_path, facts or {"v": 0}, 12)
    status, out = call(s, "POST", "overview", body={"page": "n01_u05"})
    assert status == 200, out
    items = [sql for sql, _p, _l in ws.sql if "'item' AS `kind`" in sql]
    assert len(items) == 1 and "`value_at_stake` >=" not in items[0] and not out["pages"]["n01_u05"].get("total_more")


def test_a_filtered_overview_takes_the_deepest_floor_so_the_filter_still_finds_its_top_records_above_it(tmp_path):
    floors = {"open": [[2000, 5000.0], [100000, 900.0]], "all": [[1000, 950.0]]}
    s, ws = _overview_shell(tmp_path, _ready_facts(floors=floors), 600)
    status, out = call(s, "POST", "overview", body={"page": "n01_u05"})
    items = [sql for sql, _p, _l in ws.sql if "'item' AS `kind`" in sql]
    assert status == 200 and len(items) == 1 and "`value_at_stake` >= 5000.0" in items[0], out
    ws.sql.clear()
    s.forget()
    status, out = call(s, "POST", "overview", body={"page": "n01_u05", "filters": {"category": ["A"]}})
    assert status == 200, out
    items = [sql for sql, _p, _l in ws.sql if "'item' AS `kind`" in sql]
    assert len(items) == 1 and "`value_at_stake` >= 900.0" in items[0] and "5000.0" not in items[0], items


@pytest.mark.parametrize("sql, wrapped", [("SELECT 1", True), ("  with q AS (SELECT 1) SELECT * FROM q", True), ("DESCRIBE TABLE x", False),
                                          ("SHOW TBLPROPERTIES x", False), ("SELECTED", False)])
def test_only_reads_are_wrapped_so_the_warehouse_cannot_answer_them_from_its_result_cache(sql, wrapped):
    out = shell_sql.uncached_sql(sql)
    assert bool(WRAP.match(out)) is wrapped and (WRAP.match(out).group(1) == sql if wrapped else out == sql)


class UncachedSeen:
    def __init__(self, inner):
        self.inner, self.wrapped, self.plain = inner, [], []

    def run_sql(self, warehouse, sql, params, limit=5000):
        found = WRAP.match(sql)
        (self.wrapped if found else self.plain).append(sql)
        return self.inner.run_sql(warehouse, found.group(1) if found else sql, params, limit)

    def __getattr__(self, name):
        return getattr(self.inner, name)


def test_the_speed_check_reads_with_no_cache_takes_the_middle_of_its_rounds_and_leaves_the_app_reading_as_usual(tmp_path):
    from v148_app_hub_test import SqliteWorkspace
    seen = UncachedSeen(SqliteWorkspace())
    s, _ws, _made = hub_shell(tmp_path, ws=seen)
    ticks = iter([0.0, 9.0, 9.0, 9.5, 20.0, 21.0, 21.0, 25.0, 30.0, 33.0, 33.0, 34.0])
    s.timer = lambda: next(ticks)
    out = s.speed({})
    assert out["n01_u05"] == {"first": 3.0, "filter": 1.0, "filter_on": "Category",
                              "runs": {"first": [9.0, 1.0, 3.0], "filter": [0.5, 4.0, 1.0]}}, out
    assert len(out["n01_u05"]["runs"]["first"]) == shell_core.SPEED_RUNS
    assert seen.wrapped and not seen.plain, "every read of the check goes past the warehouse result cache"
    assert s.uncached is False
    before = len(seen.wrapped)
    status, _out = call(s, "POST", "records", body={"page": "n01_u05"})
    assert status == 200 and len(seen.wrapped) == before and seen.plain, "the App itself still reads through the result cache"


def test_the_speed_check_leaves_the_app_reading_as_usual_when_a_read_fails(tmp_path):
    from v148_app_hub_test import SqliteWorkspace
    s, _ws, _made = hub_shell(tmp_path, ws=SqliteWorkspace())
    s.records = lambda headers, data: (_ for _ in ()).throw(shell_core.QueryError("TEMPORARILY_UNAVAILABLE"))
    with pytest.raises(shell_core.QueryError):
        s.speed({})
    assert s.uncached is False


def test_the_list_reads_run_on_their_own_workers_so_other_screens_never_queue_ahead_of_the_first_records(tmp_path):
    from v148_app_hub_test import SqliteWorkspace
    s, _ws, _made = hub_shell(tmp_path, ws=SqliteWorkspace())
    used = {"list": 0, "shared": 0}

    class Counted(concurrent.futures.ThreadPoolExecutor):
        def __init__(self, name):
            super().__init__(max_workers=2)
            self.name = name

        def submit(self, fn, *args, **kwargs):
            used[self.name] += 1
            return super().submit(fn, *args, **kwargs)

    s.list_pool, s.pool = Counted("list"), Counted("shared")
    status, out = call(s, "POST", "records", body={"page": "n01_u05"})
    assert status == 200 and out["rows"], out
    assert used["list"] >= 2 and used["shared"] == 0, used
    s.close()
    with pytest.raises(RuntimeError):
        s.list_pool.submit(lambda: None)


class StateOverlap(FactsWarehouse):
    def __init__(self, facts, ahead=None, failing=False):
        super().__init__(facts)
        self.asked, self.overlapped, self.ahead, self.failing = threading.Event(), False, ahead, failing

    def run_sql(self, warehouse, sql, params, limit=5000):
        if f"AS `{shell_sql.AHEAD_STAMP}`" in sql:
            self.asked.set()
            if self.failing:
                self.sql.append((sql, params, limit))
                raise shell_core.QueryError("[UNRESOLVED_COLUMN] A column `run_facts` cannot be resolved.")
            found = super().run_sql(warehouse, sql, params, limit)
            if self.ahead is not None:
                found = dict(found, rows=[dict(found["rows"][0], **{shell_sql.AHEAD_STAMP: self.ahead})])
            return found
        if sql.startswith("SELECT * FROM `main`.`pricing`.`loss_desk_out_summary`"):
            self.overlapped = self.asked.wait(timeout=2)
        return super().run_sql(warehouse, sql, params, limit)


def _changed_reads(ws):
    return [(f"AS `{shell_sql.AHEAD_STAMP}`" in sql, params) for sql, params, _l in ws.sql if sql.startswith("SELECT COUNT(*) AS `n`, unix_micros(")]


def _state_shell(tmp_path, ws):
    from v148_app_hub_test import SETTINGS, hub_page
    settings = dict(SETTINGS, options=dict(SETTINGS.get("options") or {}, decisions=True))
    s, ws, _made = hub_shell(tmp_path, settings=settings, pages=[hub_page()], ws=ws)
    return s, ws, s.page("n01_u05")


def test_a_summary_without_run_facts_is_counted_early_once_and_again_when_a_run_writes_them(tmp_path):
    s, ws, page = _state_shell(tmp_path, StateOverlap(None))
    assert s.read_state(ws, page)["facts"] is None and [early for early, _p in _changed_reads(ws)] == [True]
    ws.sql.clear()
    assert s.read_state(ws, page)["facts"] is None and _changed_reads(ws) == [], \
        "the App already knows this summary has no run facts, so it sends no count it cannot use"
    ws.facts = _ready_facts()
    assert s.read_state(ws, page)["facts"] and [early for early, _p in _changed_reads(ws)] == [False]
    ws.sql.clear()
    assert s.read_state(ws, page)["stamp"] and [early for early, _p in _changed_reads(ws)] == [True], \
        "once a run writes its facts, the count goes back to being read alongside the summary"
    s.close()


def test_the_page_state_counts_the_changes_since_the_run_while_it_reads_the_run_summary(tmp_path):
    s, ws, page = _state_shell(tmp_path, StateOverlap(_ready_facts()))
    ws.changed_n, ws.keys = 2, ["k1", "k2"]
    state = s.read_state(ws, page)
    assert ws.overlapped, "the count of changes since the run is asked before the run summary comes back"
    assert _changed_reads(ws) == [(True, shell_sql.summary_query(page)[1])], "one count, read alongside the summary, and nothing after it"
    assert (state["changed"], state["keys"], state["stamp"][2]) == (2, ["k1", "k2"], "2")
    s.close()


@pytest.mark.parametrize("ahead, failing, why", [
    (12345, False, "the summary changed between the two reads, so the count was taken from another run's start"),
    (None, True, "an older summary table has no run facts column, so the early count fails")])
def test_the_page_state_counts_the_changes_again_from_the_run_summary_when_the_early_count_cannot_be_used(tmp_path, ahead, failing, why):
    s, ws, page = _state_shell(tmp_path, StateOverlap(_ready_facts(), ahead=ahead, failing=failing))
    ws.changed_n = 1
    state = s.read_state(ws, page)
    assert _changed_reads(ws) == [(True, shell_sql.summary_query(page)[1]), (False, [])], why
    serial = [sql for sql, _p, _l in ws.sql if sql.startswith("SELECT COUNT(*) AS `n`, unix_micros(") and shell_sql.AHEAD_STAMP not in sql]
    assert serial == [shell_sql.changed_query(page, _ready_facts())[0]]
    assert state["changed"] == 1 and state["facts"] and not state["error"]
    s.close()


def test_the_early_count_takes_the_run_start_from_the_same_summary_row_the_page_reads():
    from v148_app_hub_test import hub_page
    page = hub_page()
    summary, params = shell_sql.summary_query(page)
    sql, ahead_params = shell_sql.changed_ahead_query(page)
    assert ahead_params == params and sql.count(f"FROM ({summary}) AS z") == 3
    assert sql.startswith(shell_sql.changed_query(page, _ready_facts())[0].split(" FROM ")[0])
    assert sqlglot.parse_one(sql, read="databricks") is not None


class CloseOverlap(FactsWarehouse):
    def __init__(self, facts):
        super().__init__(facts)
        self.closing, self.overlapped = threading.Event(), None

    def run_sql(self, warehouse, sql, params, limit=5000):
        if "z.`_inspire_closed_as` AS `_inspire_status`" in sql:
            self.closing.set()
        elif "AS total" in sql:
            self.overlapped = self.closing.wait(timeout=2)
        return super().run_sql(warehouse, sql, params, limit)


def test_the_closes_of_the_first_records_are_read_while_the_list_is_still_counted(tmp_path):
    s, ws, _page = _state_shell(tmp_path, CloseOverlap(_ready_facts()))
    ws.status, ws.closes = {"k1": "Done"}, {"k1": {"_inspire_closed_by": "pat@example.com"}}
    status, out = call(s, "POST", "records", body={"page": "n01_u05", "sort": {"key": "rank", "dir": "asc"}, "limit": 25})
    assert status == 200 and not out["errors"], out
    assert ws.overlapped is True, "the closes are asked as soon as the rows are in, not after the count"
    assert {r["_inspire_key"]: r.get("_inspire_closed_by") for r in out["rows"]}["k1"] == "pat@example.com"
    s.close()


def test_the_latest_changes_join_the_page_of_rows_without_reading_the_list_a_second_time(tmp_path):
    s, ws, _page = _state_shell(tmp_path, FactsWarehouse(_ready_facts()))
    status, _out = call(s, "POST", "records", body={"page": "n01_u05", "sort": {"key": "rank", "dir": "asc"}, "limit": 25})
    assert status == 200
    (rows, _p), = [(sql, p) for sql, p, _l in ws.sql if "`loss_desk_out_run_changes` AS t" in sql and "LIMIT 25" in sql]
    latest = rows.split(" l AS (", 1)[1].split(") SELECT ", 1)[0]
    assert "IN (SELECT" not in latest and "FROM s" not in latest, latest
    assert rows.count(" FROM s") == 1 and "LEFT JOIN l AS l ON l.`_inspire_lk` = k.`_inspire_key`" in rows
    s.close()


PINNED = {"closes": shell_facts.closes_facts("main.pricing.loss_desk_out" + shell_facts.CLOSES_SUFFIX)}


def _closes_reads(ws):
    return [(sql, p) for sql, p, _l in ws.sql if "z.`_inspire_closed_as` AS `_inspire_status`" in sql]


def _listed(ws):
    return [sql for sql, _p, _l in ws.sql if "`_inspire_cz_status`" in sql]


def test_the_closes_of_records_unchanged_since_the_run_come_with_the_rows_in_one_statement(tmp_path):
    s, ws, _page = _state_shell(tmp_path, FactsWarehouse(_ready_facts(**PINNED)))
    ws.keys, ws.status, ws.closes = [], {"k1": "Done", "k4": "Done"}, {"k1": {"_inspire_closed_by": "pat@example.com"},
                                                                      "k4": {"_inspire_closed_by": "sam@example.com"}}
    status, out = call(s, "POST", "records", body={"page": "n01_u05", "sort": {"key": "rank", "dir": "asc"}, "limit": 25})
    assert status == 200 and not out["errors"], out
    assert _closes_reads(ws) == [], "no statement of its own reads the closes"
    (rows,) = _listed(ws)
    assert " cz AS (" in rows and "LEFT JOIN cz ON cz.`_inspire_cz_key` = " in rows and " hx AS (" not in rows
    assert f"FROM {shell_facts.table_name(PINNED['closes']['table'])} AS z" in rows
    assert sqlglot.parse_one(rows, read="databricks") is not None
    closed = {r["_inspire_key"]: r.get("_inspire_closed_by") for r in out["rows"]}
    assert closed["k1"] == "pat@example.com" and closed["k4"] == "sam@example.com" and closed["k2"] is None
    assert not any(name.startswith("_inspire_cz_") for r in out["rows"] for name in r), "the joined columns never reach the page"
    s.close()


def test_a_record_changed_since_the_run_reads_its_close_from_the_changes_and_the_rest_come_with_the_rows(tmp_path):
    s, ws, _page = _state_shell(tmp_path, FactsWarehouse(_ready_facts(**PINNED)))
    ws.keys, ws.status = ["k1"], {"k1": "Done", "k4": "Done"}
    ws.closes = {"k1": {"_inspire_closed_by": "old@example.com"}, "k4": {"_inspire_closed_by": "sam@example.com"}}
    ws.changed_closes = {"k1": {"_inspire_closed_by": "pat@example.com"}}
    status, out = call(s, "POST", "records", body={"page": "n01_u05", "sort": {"key": "rank", "dir": "asc"}, "limit": 25})
    assert status == 200 and not out["errors"], out
    (read, params), = _closes_reads(ws)
    assert " q AS (" in read and "k1" in [p["value"] for p in params] and "k4" not in [p["value"] for p in params]
    closed = {r["_inspire_key"]: r.get("_inspire_closed_by") for r in out["rows"]}
    assert closed["k1"] == "pat@example.com" and closed["k4"] == "sam@example.com"
    s.close()


@pytest.mark.parametrize("keys, window, pinned, why", [(None, False, True, "too many changes to name"),
                                                     ([], True, True, "a time window lists no actions"),
                                                     ([], False, False, "the run kept no closes, so the rows have none to join")])
def test_the_closes_stay_a_statement_of_their_own_when_the_rows_cannot_carry_them(tmp_path, keys, window, pinned, why):
    s, ws, _page = _state_shell(tmp_path, FactsWarehouse(_ready_facts(**(PINNED if pinned else {}))))
    ws.keys, ws.status, ws.closes = keys, {"k1": "Done"}, {"k1": {"_inspire_closed_by": "pat@example.com"}}
    body = {"page": "n01_u05", "sort": {"key": "rank", "dir": "asc"}, "limit": 25}
    if window:
        body["window"] = "week"
    status, out = call(s, "POST", "records", body=body)
    assert status == 200, out
    assert _listed(ws) == [], why
    if not window:
        assert len(_closes_reads(ws)) == 1
        assert {r["_inspire_key"]: r.get("_inspire_closed_by") for r in out["rows"]}["k1"] == "pat@example.com"
    s.close()


class DeltaOnlyLakebase:
    def run(self, sql, params, limit, queued=False):
        raise shell_core.shell_pg.NotHeld("main.ops.loss_desk_out")

    def noted(self, text):
        pass

    def pending(self):
        return False

    def close(self):
        pass


def test_a_lakebase_app_keeps_the_closes_out_of_the_rows_so_the_rows_stay_on_its_copies(tmp_path):
    s, ws, _page = _state_shell(tmp_path, FactsWarehouse(_ready_facts(**PINNED)))
    s.lakebase = DeltaOnlyLakebase()
    ws.keys, ws.status, ws.closes = [], {"k1": "Done"}, {"k1": {"_inspire_closed_by": "pat@example.com"}}
    status, out = call(s, "POST", "records", body={"page": "n01_u05", "sort": {"key": "rank", "dir": "asc"}, "limit": 25})
    assert status == 200, out
    (read, _params), = _closes_reads(ws)
    assert _listed(ws) == [] and " hx AS (" not in read and "_closes` AS z WHERE" in read, "the closes are read from the ones the run kept"
    s.lakebase = None
    s.close()


def test_the_closes_joined_to_the_rows_are_the_closes_the_key_read_gives():
    facts = _ready_facts(**PINNED)
    joined = shell_sql.inline_closes_ctes({"facts": facts, "table": "main.ops.loss_desk_out"})["cz"]
    alone, params = shell_sql.closed_query({"id": "n01_u05"}, "main.ops.loss_desk_out", ["k1"], {"record_key"}, None, facts, [])
    assert [p["value"] for p in params] == ["k1"] and alone.endswith(" WHERE z.`_inspire_k` IN (:p0)")
    assert alone.removesuffix(" WHERE z.`_inspire_k` IN (:p0)") == joined.replace("`_inspire_cz_key`", "`record_key`").replace(
        "`_inspire_cz_status`", "`_inspire_status`").replace("`_inspire_cz_", "`_inspire_")
    unpinned, _p = shell_sql.closed_query({"id": "n01_u05"}, "main.ops.loss_desk_out", ["k1"], {"record_key"}, None, _ready_facts(), [])
    assert " hx AS (" in unpinned and shell_facts.table_name(facts["closes"]["table"]) not in unpinned, "a run that kept no closes has them read from the records people acted on"


PRICED = {"value_formula": "{rank:number} x {PRICE:money}", "value_expression": "rank * PRICE",
          "value_assumptions": '[{"name": "PRICE", "value": 20.0, "kind": "money"}]',
          "edits": [{"name": "PRICE", "value": "30.0", "changed_by": "owner01", "changed_at": "2026-10-01T00:00:00Z", "note": ""}]}


COUNT_SQL = "SELECT COUNT(*) AS `n`, unix_micros("
ASSUMPTIONS_SQL = "_assumptions` WHERE `use_case_id` = "


class AssumptionOverlap(FactsWarehouse):
    def __init__(self, facts, money):
        super().__init__(facts, money=money)
        self.assuming, self.overlapped = threading.Event(), None

    def run_sql(self, warehouse, sql, params, limit=5000):
        if ASSUMPTIONS_SQL in sql:
            self.assuming.set()
        elif sql.startswith(COUNT_SQL) and self.overlapped is None:
            self.overlapped = self.assuming.wait(timeout=2)
        return super().run_sql(warehouse, sql, params, limit)


def _assumption_reads(ws):
    return [sql for sql, _p, _l in ws.sql if ASSUMPTIONS_SQL in sql]


def _summary_reads(ws):
    return [sql for sql, _p, _l in ws.sql if "_summary` WHERE " in sql and not sql.startswith(COUNT_SQL)]


def test_the_assumptions_of_a_cold_page_are_read_once_its_run_summary_is_read_without_waiting_for_the_count_of_changes(tmp_path):
    s, ws, _page = _state_shell(tmp_path, AssumptionOverlap(_ready_facts(), PRICED))
    body = {"page": "n01_u05", "sort": {"key": "value_at_stake", "dir": "desc"}, "limit": 25}
    status, out = call(s, "POST", "records", body=body)
    assert status == 200 and not out["errors"] and out["money"]["changed"] is True, out
    assert ws.overlapped is True, "the assumptions do not wait for the count of changes since the run"
    for _again in range(2):
        assert call(s, "POST", "records", body=body)[0] == 200
    assert len(_assumption_reads(ws)) == 1 and len(_summary_reads(ws)) == 1, ws.sql
    assert s.heads == {} and s.lookups == {}
    s.close()


@pytest.mark.parametrize("method, path, query, body", [("POST", "overview", None, {"page": "n01_u05"}),
                                                       ("GET", "impact", {"page": "n01_u05"}, None)])
def test_every_view_that_prices_a_cold_page_reads_its_assumptions_without_waiting_for_the_count_of_changes(tmp_path, method, path, query, body):
    s, ws, _page = _state_shell(tmp_path, AssumptionOverlap(_ready_facts(), PRICED))
    status, out = call(s, method, path, query=query, body=body)
    assert status == 200, out
    assert ws.overlapped is True, "the assumptions do not wait for the count of changes since the run"
    assert len(_assumption_reads(ws)) == 1 and len(_summary_reads(ws)) == 1, ws.sql
    s.close()


@pytest.mark.parametrize("method, path, query, body", [("POST", "records", None, {"page": "n01_u05", "limit": 25}),
                                                       ("POST", "overview", None, {"page": "n01_u05"}),
                                                       ("GET", "impact", {"page": "n01_u05"}, None)])
def test_a_page_whose_run_names_no_assumption_never_reads_them_until_a_run_names_one(tmp_path, method, path, query, body):
    s, ws, _page = _state_shell(tmp_path, FactsWarehouse(_ready_facts()))
    assert call(s, method, path, query=query, body=body)[0] == 200
    assert _assumption_reads(ws) == [], "an unpriced run costs no assumptions read"
    ws.money = dict(PRICED)
    s.forget()
    assert call(s, method, path, query=query, body=body)[0] == 200
    assert len(_assumption_reads(ws)) == 1
    s.close()


def test_opening_a_page_reads_its_assumptions_from_the_first_records_after_its_run_summary(tmp_path):
    s, ws, page = _state_shell(tmp_path, AssumptionOverlap(_ready_facts(), PRICED))
    headers = {"x-forwarded-email": "pat@example.com"}
    s.defaults(headers, page["id"])
    status, out = call(s, "POST", "records", headers=headers, body={"page": "n01_u05", "sort": {"key": "value_at_stake", "dir": "desc"},
                                                                    "limit": 25})
    assert status == 200 and not out["errors"] and out["money"]["changed"] is True, out
    assert ws.overlapped is True and len(_assumption_reads(ws)) == 1 and len(_summary_reads(ws)) == 1, ws.sql
    s.close()


def test_the_money_of_a_page_whose_state_is_held_reads_the_held_summary(tmp_path):
    s, ws, page = _state_shell(tmp_path, FactsWarehouse(_ready_facts(), money=PRICED))
    who = ("pat", "token")
    row = dict({k: v for k, v in PRICED.items() if k != "edits"}, run_id="r5", updated_at="x")
    s.cache.put(("state", who, page["id"]), {"row": row, "facts": None, "stamp": None, "error": ""}, 60)
    summary, edits = s.money_inputs(ws, who, page)
    assert summary is row and [e["value"] for e in edits] == ["30.0"] and _summary_reads(ws) == []
    s.cache.put(("state", who, page["id"]), {"row": None, "facts": None, "stamp": None, "error": "the summary is gone"}, 60)
    with pytest.raises(shell_core.QueryError, match="the summary is gone"):
        s.money_inputs(ws, who, page)
    s.close()


def test_an_early_assumptions_read_is_shared_forgotten_by_a_write_and_never_used_once_cancelled(tmp_path):
    s, ws, page = _state_shell(tmp_path, FactsWarehouse(_ready_facts(), money=PRICED))
    who = ("pat", "token")
    first = s.early_assumptions(ws, who, page, 5)
    assert s.early_assumptions(ws, who, page, 5) is first, "requests opening the same page share one early read"
    s.forget()
    assert s.early == {}, "a write forgets the assumptions read before it"
    cancelled = concurrent.futures.Future()
    cancelled.cancel()
    s.cache.put(("state", who, page["id"]), {"row": dict(PRICED, run_id="r5", updated_at="x"), "facts": None, "stamp": None, "error": ""}, 60)
    edits = s.assumption_rows(ws, who, page, early=(cancelled, 0.0))
    assert [e["value"] for e in edits] == ["30.0"] and len(_assumption_reads(ws)) == 2
    s.close()


def test_an_early_assumptions_read_that_failed_or_was_cancelled_is_read_again_and_a_warm_request_joins_a_live_one(tmp_path):
    s, ws, page = _state_shell(tmp_path, FactsWarehouse(_ready_facts(), money=PRICED))
    who = ("pat", "token")
    assert s.early_assumptions(ws, who, page, 5, start=False) is None, "a warm request starts no early read"
    live = s.early_assumptions(ws, who, page, 5)
    assert s.early_assumptions(ws, who, page, 5, start=False) is live, "a warm request joins the early read a cold one started"
    failed = concurrent.futures.Future()
    failed.set_exception(shell_core.QueryError("the warehouse timed out"))
    s.early[("assume", who, page["id"])] = (failed, s.clock())
    assert s.early_assumptions(ws, who, page, 5, start=False) is None and ("assume", who, page["id"]) not in s.early
    again = s.early_assumptions(ws, who, page, 5)
    assert again is not live and again[0].result()["rows"], "a failed early read is read again, never reused"
    s.close()


@pytest.mark.parametrize("caller", ["page_state", "page_head", "run"])
def test_a_read_that_lands_between_a_cache_miss_and_the_lock_is_used_not_read_again(tmp_path, caller):
    s, ws, page = _state_shell(tmp_path, FactsWarehouse(_ready_facts(), money=PRICED))
    who = ("pat", "token")
    sql, params = shell_sql.assumptions_query(page, 5)
    reads = {"page_state": lambda: s.page_state(ws, who, page), "page_head": lambda: s.page_head(ws, who, page),
             "run": lambda: s.run(ws, who, sql, params, 5, delta=True)}
    watched = (lambda k: k == ("state", who, page["id"])) if caller != "run" else (lambda k: k[:2] == (who, sql))
    plain, raced = s.cache.get, []

    def get(key):
        found = plain(key)
        if watched(key) and not raced:
            raced.append(1)
            racer = threading.Thread(target=reads[caller])
            racer.start()
            racer.join(5)
        return found

    s.cache.get = get
    reads[caller]()
    counted = _summary_reads(ws) if caller != "run" else _assumption_reads(ws)
    assert raced and len(counted) == 1, ws.sql
    s.close()


def test_an_early_assumptions_read_older_than_a_page_state_is_dropped(tmp_path):
    now = [1_000.0]
    s, ws, page = _state_shell(tmp_path, FactsWarehouse(_ready_facts(), money=PRICED))
    s.clock = lambda: now[0]
    first = s.early_assumptions(ws, ("pat", "token"), page, 5)
    now[0] += shell_core.STAMP_TTL_S
    assert s.early_assumptions(ws, ("sam", "token"), page, 5) is not first and set(s.early) == {("assume", ("sam", "token"), page["id"])}
    s.close()


class SummaryFails(FactsWarehouse):
    def __init__(self, facts, error):
        super().__init__(facts, money=PRICED)
        self.error = error

    def run_sql(self, warehouse, sql, params, limit=5000):
        if "_summary` WHERE " in sql and not sql.startswith(COUNT_SQL):
            self.sql.append((sql, params, limit))
            raise self.error
        return super().run_sql(warehouse, sql, params, limit)


@pytest.mark.parametrize("error, raised", [(shell_core.QueryError("[INSUFFICIENT_PERMISSIONS] no SELECT on the summary"), shell_core.QueryError),
                                           (RuntimeError("the warehouse went away"), RuntimeError)])
def test_a_run_summary_that_cannot_be_read_fails_the_money_and_leaves_nothing_waiting(tmp_path, error, raised):
    s, ws, page = _state_shell(tmp_path, SummaryFails(_ready_facts(), error))
    with pytest.raises(raised):
        s.money_inputs(ws, ("pat", "token"), page)
    assert s.heads == {} and s.lookups == {} and _assumption_reads(ws) == []
    s.close()


class SlowSummary(FactsWarehouse):
    def __init__(self, facts):
        super().__init__(facts, money=PRICED)
        self.release = threading.Event()

    def run_sql(self, warehouse, sql, params, limit=5000):
        if "_summary` WHERE " in sql and not sql.startswith(COUNT_SQL):
            self.release.wait(timeout=5)
        return super().run_sql(warehouse, sql, params, limit)


def test_many_requests_waiting_on_one_cold_page_read_its_summary_once_and_all_finish(tmp_path):
    s, ws, page = _state_shell(tmp_path, SlowSummary(_ready_facts()))
    who = ("pat", "token")
    with concurrent.futures.ThreadPoolExecutor(2 * shell_core.STAMP_WORKERS) as callers:
        money = [callers.submit(s.money_inputs, ws, who, page) for _ in range(shell_core.STAMP_WORKERS)]
        states = [callers.submit(s.page_state, ws, who, page) for _ in range(shell_core.STAMP_WORKERS)]
        for _ in range(shell_core.STAMP_WORKERS):
            s.warm_state(ws, who, page)
        time.sleep(0.2)
        ws.release.set()
        found = {f.result(timeout=10)[0]["run_id"] for f in money}
        held = [f.result(timeout=10) for f in states]
    assert found == {"r5"} and all(h["facts"] for h in held) and len(_summary_reads(ws)) == 1, _summary_reads(ws)
    assert len(_assumption_reads(ws)) == 1 and s.heads == {} and s.lookups == {}
    s.close()


def test_each_run_keeps_the_latest_close_of_its_closed_records_beside_their_closing_and_says_so_in_its_facts(agent_ns):
    from v120_artifacts_support import FakeSpark
    from v142_scd_test import TABLE
    spark = FakeSpark(lambda sql: [{"version": 3}] if sql.startswith("DESCRIBE HISTORY") else None)
    facts = agent_ns["inspire_run_facts"](spark, TABLE, "N01-U01", "g2", "priority_tier", 0, lambda line: None)
    assert facts is not None and shell_facts.pinned_closes(facts)
    assert facts["closes"] == shell_facts.closes_facts(TABLE + shell_facts.CLOSES_SUFFIX)
    (made,) = [s for s in spark.statements if s.startswith(f"CREATE OR REPLACE TABLE {shell_facts.table_name(facts['closes']['table'])} ")]
    assert " CLUSTER BY (`_inspire_k`) AS WITH hx AS (" in made and made.endswith("FROM hk AS z WHERE z.`_inspire_kth` = 1")
    (closed,) = [s for s in spark.statements if s.startswith(f"CREATE OR REPLACE TABLE {shell_facts.table_name(facts['closed'])} AS ")]
    assert closed.endswith(" SELECT * FROM hm"), "the closing the Apps built before read keeps its columns"
    assert TABLE + shell_facts.CLOSES_SUFFIX in agent_ns["implement_companion_tables"](TABLE)
    fewer = dict(facts["closes"], fields=facts["closes"]["fields"][:-1])
    assert not shell_facts.pinned_closes(dict(facts, closes=fewer)), "a run that kept fewer closes is read as keeping none"


DATED_PAGE = {"datasets": [{"name": "a", "sql": "SELECT * FROM main.ops.facts_out"},
                           {"name": "b", "sql": "SELECT valid_to, action_due FROM main.ops.facts_out"}],
              "filters": [{"id": "ran", "type": "date_range", "columns": {"a": "as_of_date"}},
                          {"id": "lived", "type": "date_range", "columns": {"a": "valid_from", "b": "valid_to"}},
                          {"id": "due", "type": "date_range", "columns": {"b": "action_due"}},
                          {"id": "again", "type": "date_range", "columns": {"b": "valid_to", "a": "as_of_date"}}]}


def test_the_date_bounds_read_together_equal_each_filter_read_alone_on_a_real_postgres(engine):
    idents = [f["id"] for f in DATED_PAGE["filters"]]
    sql, params = shell_sql.bounds_together_query(DATED_PAGE, idents)
    assert sql.count("FROM (SELECT * FROM main.ops.facts_out) AS d") == 1 and sql.count("FROM (SELECT valid_to, action_due") == 1, \
        "each dataset is scanned once for every date filter that reads it"
    assert sql.count("MIN(CAST(") == 4, "a column two filters read is read once"
    (together,) = engine["rows"](sql, params)
    for i, ident in enumerate(idents):
        (alone,) = engine["rows"](*shell_sql.bounds_query(DATED_PAGE, ident))
        assert (together[f"low_{i}"], together[f"high_{i}"]) == (alone["low"], alone["high"]), ident
    assert together["low_2"] is None and together["high_1"] is not None, "a column with no dates gives none, and one empty side never hides the other"


def _dated_hub(tmp_path, ws=None):
    from v148_app_hub_test import hub_page
    page = hub_page()
    page["filters"].append({"id": "due", "type": "date_range", "label": "Due", "grain": "month", "default": "all",
                            "columns": {"records": "action_due"}})
    s, ws, _made = hub_shell(tmp_path, pages=[page], ws=ws)
    return s, ws, page


def _bounds_reads(ws):
    return [sql for sql, _p, _l in ws.sql if "AS low_0" in sql or "MIN(v) AS low" in sql]


def test_the_page_open_reads_every_date_range_in_one_statement_that_the_defaults_and_the_filters_share(tmp_path):
    s, ws, page = _dated_hub(tmp_path)
    headers = {"x-forwarded-access-token": "token", "x-forwarded-email": "pat@example.com"}
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        opened = pool.submit(call, s, "GET", "defaults", {"page": page["id"]}, headers)
        listed = pool.submit(call, s, "GET", "filters", {"page": page["id"]}, headers)
        d_status, defaults = opened.result()
        assert call(s, "POST", "records", body={"page": page["id"]}, headers=headers)[0] == 200
        f_status, filters = listed.result()
    assert d_status == f_status == 200 and not defaults["errors"], defaults
    assert _bounds_reads(ws) == [shell_sql.bounds_together_query(page, ["run_date", "due"])[0]], _bounds_reads(ws)
    alone, _errors = s._parallel(s.bounds_jobs(ws, None, page, apart=True))
    for f in filters["filters"]:
        if f["type"] == "date_range":
            row = alone[("filter", f["id"])]["rows"][0]
            assert (f["low"], f["high"]) == (row["low"], row["high"]) and not f.get("error"), f
    assert set(defaults["range"]) == {"run_date", "due"}
    s.close()


def test_a_page_s_filter_reads_wait_for_a_read_slot_and_its_records_reads_never_do(tmp_path):
    s, ws, page = _dated_hub(tmp_path)
    headers = {"x-forwarded-access-token": "token", "x-forwarded-email": "pat@example.com"}
    real, seen = s.execute, []
    s.execute = lambda w, sql, params, limit, delta=False, queued=False: seen.append((sql, queued)) or real(w, sql, params, limit, delta, queued)
    assert call(s, "POST", "records", body={"page": page["id"]}, headers=headers)[0] == 200
    listed = len(seen)
    assert listed and not any(queued for _sql, queued in seen), "the first records never queue"
    status, out = call(s, "GET", "filters", {"page": page["id"]}, headers)
    assert status == 200 and not [f for f in out["filters"] if f.get("error")], out
    reads = [(sql, queued) for sql, queued in seen[listed:] if sql in _bounds_reads(ws) or "SELECT DISTINCT" in sql]
    assert reads and all(queued for _sql, queued in reads), reads
    assert all(sql in _bounds_reads(ws) or "SELECT DISTINCT" in sql for sql, queued in seen if queued), "only filter reads queue"
    status, _found = call(s, "GET", "filters/options", {"page": page["id"], "filter": "category", "q": "A"}, headers)
    assert status == 200 and seen[-1][1] is True, (status, seen[-1])
    s.close()


def test_when_the_dates_cannot_be_read_together_each_filter_reads_its_own_and_one_broken_column_fails_only_its_filter(tmp_path):
    from v148_app_hub_test import SqliteWorkspace
    broken = shell_core.QueryError("[UNRESOLVED_COLUMN] A column `action_due` cannot be resolved.")
    s, ws, page = _dated_hub(tmp_path, SqliteWorkspace(fail={"CAST(`action_due` AS DATE)": broken}))
    headers = {"x-forwarded-access-token": "token", "x-forwarded-email": "pat@example.com"}
    status, out = call(s, "GET", "filters", {"page": page["id"]}, headers)
    assert status == 200, out
    found = {f["id"]: f for f in out["filters"]}
    assert found["run_date"]["low"] and found["run_date"]["high"] and not found["run_date"].get("error")
    assert "action_due" in found["due"]["error"]
    assert len(_bounds_reads(ws)) == 3, "the joint read, then one read for each date filter"
    status, opened = call(s, "GET", "defaults", {"page": page["id"]}, headers)
    assert status == 200 and "run_date" in opened["range"] and "filter:due" in opened["errors"], opened
    s.close()


def test_a_page_with_one_date_range_keeps_its_own_bounds_read(tmp_path):
    from v148_app_hub_test import hub_page
    s, ws, _made = hub_shell(tmp_path)
    page = hub_page()
    status, _out = call(s, "GET", "defaults", {"page": page["id"]}, {"x-forwarded-access-token": "token"})
    assert status == 200 and _bounds_reads(ws) == [shell_sql.bounds_query(page, "run_date")[0]]
    s.close()


OPENER = {"x-forwarded-access-token": "token", "x-forwarded-email": "pat@example.com"}


def _choice_reads(ws):
    return [i for i, (sql, _p, _l) in enumerate(ws.sql) if "SELECT DISTINCT CAST(" in sql]


def _opening_hub(tmp_path):
    from v148_app_hub_test import SqliteWorkspace, hub_page
    s, ws, _made = hub_shell(tmp_path, pages=[hub_page()], ws=SqliteWorkspace())
    return s, ws


def _filters_took(s):
    started = time.monotonic()
    status, out = call(s, "GET", "filters", {"page": "n01_u05"}, OPENER)
    assert status == 200 and next(f for f in out["filters"] if f["id"] == "category")["options"], out
    return time.monotonic() - started


def test_an_opening_page_reads_its_filter_choices_only_after_its_first_records(tmp_path):
    s, ws = _opening_hub(tmp_path)
    served, inner = [], s.list_records

    def listing(*args, **kwargs):
        out = inner(*args, **kwargs)
        served.append(len(ws.sql))
        return out

    s.list_records = listing
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        assert pool.submit(call, s, "GET", "defaults", {"page": "n01_u05"}, OPENER).result()[0] == 200
        listed = pool.submit(call, s, "GET", "filters", {"page": "n01_u05"}, OPENER)
        time.sleep(0.3)
        assert _choice_reads(ws) == [] and not listed.done(), "the choices wait for the first records"
        assert call(s, "POST", "records", body={"page": "n01_u05"}, headers=OPENER)[0] == 200
        status, out = listed.result(timeout=shell_core.LIST_YIELD_S)
    assert status == 200 and next(f for f in out["filters"] if f["id"] == "category")["options"], out
    assert served and _choice_reads(ws) and min(_choice_reads(ws)) >= served[0], (served, _choice_reads(ws))
    assert s.opening == {}
    s.close()


def test_the_filter_choices_never_wait_when_no_page_open_is_under_way(tmp_path, monkeypatch):
    monkeypatch.setattr(shell_core, "LIST_YIELD_S", 30.0)
    s, _ws = _opening_hub(tmp_path)
    assert _filters_took(s) < 5, "the filters alone read their choices at once"
    s.close()


def test_the_filter_choices_stop_waiting_at_the_deadline_when_the_records_never_come(tmp_path, monkeypatch):
    monkeypatch.setattr(shell_core, "LIST_YIELD_S", 0.5)
    s, _ws = _opening_hub(tmp_path)
    assert call(s, "GET", "defaults", {"page": "n01_u05"}, OPENER)[0] == 200
    assert 0.3 <= _filters_took(s) < 5
    assert s.opening == {}
    s.close()


@pytest.mark.parametrize("breaks", ["defaults", "records"])
def test_a_page_open_that_fails_never_holds_back_its_filter_choices(tmp_path, monkeypatch, breaks):
    monkeypatch.setattr(shell_core, "LIST_YIELD_S", 30.0)
    s, _ws = _opening_hub(tmp_path)
    if breaks == "defaults":
        s.bounds = lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("the warehouse went away"))
        with pytest.raises(RuntimeError):
            call(s, "GET", "defaults", {"page": "n01_u05"}, OPENER)
    else:
        assert call(s, "GET", "defaults", {"page": "n01_u05"}, OPENER)[0] == 200
        s.list_records = lambda *args, **kwargs: (_ for _ in ()).throw(shell_core.HttpError(502, "the list failed"))
        assert call(s, "POST", "records", body={"page": "n01_u05"}, headers=OPENER)[0] == 502
    assert s.opening == {}
    assert _filters_took(s) < 5
    s.close()


def test_run_facts_whose_closes_name_another_table_are_read_as_keeping_none():
    from v166_run_facts_test import HUB_TABLE as base
    row = lambda facts: {"run_id": "r5", shell_sql.RUN_FACTS_COLUMN: __import__("json").dumps(facts)}
    mine = _ready_facts(closes=shell_facts.closes_facts(base + shell_facts.CLOSES_SUFFIX))
    assert shell_sql.pinned_closes(shell_sql.state_facts(row(mine), base))
    for table in ("main.other.secret", base + "_closed", base.upper() + shell_facts.CLOSES_SUFFIX + "x", ""):
        held = shell_sql.state_facts(row(dict(mine, closes=shell_facts.closes_facts(table))), base)
        assert held and "closes" not in held and not shell_sql.pinned_closes(held), table
