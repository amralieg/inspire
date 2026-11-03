import concurrent.futures
import re
import sqlite3

import pytest
import sqlglot

from v141_app_shell_test import call
from v148_app_hub_test import hub_shell
from v166_run_facts_test import FactsWarehouse, _facts_shell, _ready_facts, shell_core, shell_facts, shell_sql
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
