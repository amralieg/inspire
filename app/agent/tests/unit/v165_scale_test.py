import json
import os
import sys
import types

import psycopg
import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_core  # noqa: E402
import shell_db  # noqa: E402
import shell_pg  # noqa: E402
from v141_app_shell_test import FakeWorkspace, app_dir, call  # noqa: E402
from v145_lakebase_test import TREND_VIEW, FakeConn, lakebase, password_service  # noqa: E402


class VersionedWorkspace(FakeWorkspace):
    def __init__(self):
        super().__init__()
        self.versions, self.lookups = {}, []

    def table_history(self, warehouse, name, limit=20):
        self.lookups.append(name)
        if name not in self.versions:
            raise shell_db.QueryError(f"no table {name}")
        return [{"version": self.versions[name], "operation": "MERGE"}]


def versioned_shell(tmp_path, clock):
    ws = VersionedWorkspace()
    ws.versions = {"main.pricing.loss_trend": 7, "main.pricing.loss_desk_out": 3, "main.pricing.items": 1}
    s = shell_core.Shell(app_dir(tmp_path), env={"DATABRICKS_WAREHOUSE_ID": "wh1"}, sp_factory=lambda: ws, user_factory=lambda h, t: ws,
                         clock=clock)
    return s, ws


class HistoryWorkspace(shell_db.Workspace):
    def __init__(self, rows):
        super().__init__("dbc-1.example.com", lambda: {"Authorization": "Bearer t"})
        self.rows, self.asked = rows, []

    def run_sql(self, warehouse, sql, params, limit=5000):
        self.asked.append((warehouse, sql, limit))
        return {"columns": [], "rows": self.rows, "truncated": False}


def test_the_workspace_reads_a_tables_last_changes_from_its_delta_history():
    ws = HistoryWorkspace([{"version": "42", "operation": "OPTIMIZE", "timestamp": "x"}, {"version": "41", "operation": "MERGE"}])
    assert ws.table_history("wh1", "main.s.t") == [{"version": 42, "operation": "OPTIMIZE", "timestamp": "x"},
                                                   {"version": 41, "operation": "MERGE", "timestamp": None}]
    assert ws.asked == [("wh1", "DESCRIBE HISTORY `main`.`s`.`t` LIMIT 20", 20)]


def test_facts_stay_fresh_through_a_compaction_and_go_stale_on_any_data_change(tmp_path):
    now = [1_000.0]
    s, ws = versioned_shell(tmp_path, lambda: now[0])
    history = {"main.pricing.loss_desk_out": [{"version": 9, "operation": "OPTIMIZE"}, {"version": 8, "operation": "SET TBLPROPERTIES"},
                                              {"version": 7, "operation": "MERGE"}]}
    ws.table_history = lambda warehouse, name, limit=20: history[name]
    assert s.unchanged_since(ws, "sp", "main.pricing.loss_desk_out", 7) is True
    assert s.unchanged_since(ws, "sp", "main.pricing.loss_desk_out", 6) is False, "the run's own merge came after these facts"
    assert s.unchanged_since(ws, "sp", "main.pricing.loss_desk_out", 9) is True
    assert s.unchanged_since(ws, "sp", "main.pricing.loss_desk_out", "x") is False
    history["main.pricing.loss_desk_out"] = [{"version": 30 - i, "operation": "OPTIMIZE"} for i in range(20)]
    now[0] += 60
    assert s.unchanged_since(ws, "sp", "main.pricing.loss_desk_out", 7) is False, "commits it cannot see may have changed data"


class Recorder:
    def __init__(self):
        self.jobs = []

    def submit(self, fn, *args):
        from concurrent.futures import Future
        self.jobs.append(args[1] if len(args) > 1 else None)
        done = Future()
        try:
            done.set_result(fn(*args))
        except Exception as error:
            done.set_exception(error)
        return done


def test_the_overview_of_every_use_case_runs_on_its_own_threads_so_it_never_holds_the_threads_a_page_loads_with(tmp_path):
    from v141_app_shell_test import PAGE, SETTINGS
    second = dict(PAGE, id="n02_u01", use_case_id="N02-U01", title="Second desk")
    s = shell_core.Shell(app_dir(tmp_path, dict(SETTINGS, pages=["n01_u05", "n02_u01"]), [PAGE, second]),
                         env={"DATABRICKS_WAREHOUSE_ID": "wh1"}, sp_factory=FakeWorkspace, user_factory=lambda h, t: FakeWorkspace())
    s.pool, s.hub_pool = Recorder(), Recorder()
    assert call(s, "POST", "overview", body={})[0] == 200
    assert sorted(s.hub_pool.jobs) == ["n01_u05", "n02_u01"] and s.pool.jobs == []
    assert call(s, "POST", "page", body={"page": "n01_u05"})[0] == 200
    assert s.pool.jobs and len(s.hub_pool.jobs) == 2, "a page loads on the page threads"


import datetime  # noqa: E402

import shell_sql  # noqa: E402
from v145_lakebase_test import PG_ENV, PG_SCHEMA, CredentialWorkspace, postgres  # noqa: E402,F401

PAGED = "main.scale.paged_list"
PAGED_COLUMNS = [{"name": n, "type": t, "type_text": x} for n, t, x in (
    ("id", "STRING", "STRING"), ("label", "STRING", "STRING"), ("n", "INT", "INT"), ("score", "DOUBLE", "DOUBLE"), ("d", "DATE", "DATE"),
    ("flag", "BOOLEAN", "BOOLEAN"), (shell_pg.ROW_COLUMN, "LONG", "BIGINT"))]
PAGED_PAGE = {"id": "p", "datasets": [{"name": "records", "sql": f"SELECT * FROM {PAGED}"}],
              "records": {"key": "id", "label": "label", "rank": "n", "columns": [{"column": "score", "format": "number"},
                                                                                 {"column": "d", "format": "date"},
                                                                                 {"column": "flag", "format": "text"}]}}


def paged_rows():
    rows = []
    for i in range(137):
        rows.append({"id": f"k{(i * 37) % 137:03d}", "label": None if i % 11 == 0 else f"item {i % 9}", "n": None if i % 13 == 0 else i % 7,
                     "score": None if i % 17 == 0 else float((i * 7) % 5) / 2, "d": datetime.date(2026, 1 + i % 3, 1 + i % 4),
                     "flag": i % 2 == 0})
    return rows


@pytest.fixture(scope="module")
def paged_lakebase(postgres):  # noqa: F811
    def local(**kwargs):
        return psycopg.connect(host=postgres["host"], port=postgres["port"], dbname="postgres", user="inspire",
                               connect_timeout=kwargs["connect_timeout"], autocommit=kwargs["autocommit"])

    kinds = {"STRING": "text", "INT": "integer", "DOUBLE": "double precision", "DATE": "date", "BOOLEAN": "boolean", "LONG": "bigint"}
    with local(connect_timeout=10, autocommit=True) as conn, conn.cursor() as cur:
        cur.execute(f'CREATE TABLE IF NOT EXISTS "{PG_SCHEMA}"."paged_list" (' + ", ".join(f'"{c["name"]}" {kinds[c["type"]]}' for c in PAGED_COLUMNS) + ")")
        cur.execute(f'TRUNCATE "{PG_SCHEMA}"."paged_list"')
        for i, row in enumerate(paged_rows()):
            cur.execute(f'INSERT INTO "{PG_SCHEMA}"."paged_list" VALUES (' + ", ".join(["%s"] * len(PAGED_COLUMNS)) + ")",
                        [i + 1 if c["name"] == shell_pg.ROW_COLUMN else row[c["name"]] for c in PAGED_COLUMNS])
    lb = shell_pg.Lakebase({"pipeline_id": "pipeline-1", "tables": {PAGED: {"pg": f"{PG_SCHEMA}.paged_list", "columns": PAGED_COLUMNS}},
                            "datasets": {}}, PG_ENV, lambda: CredentialWorkspace(), connect=local)
    yield lb
    lb.close()


def page_of(lb, data):
    columns = {c["name"]: c["type"] for c in PAGED_COLUMNS if c["name"] != shell_pg.ROW_COLUMN}
    context = dict(shell_sql.list_context(PAGED_PAGE, columns, None, False), types=columns, money=[])
    request = shell_sql.list_request(PAGED_PAGE, dict({"page": "p"}, **data), context)
    plan = shell_sql.list_queries(PAGED_PAGE, {}, request, context)
    rows = lb.run(*plan["rows"], request["limit"])["rows"]
    total = int(lb.run(*plan["total"], 1)["rows"][0]["total"])
    return rows, total, shell_core.list_cursors(request, context, rows, total), plan["rows"][0]


@pytest.mark.parametrize("key,direction", [("n", "asc"), ("n", "desc"), ("label", "asc"), ("label", "desc"), ("score", "desc"),
                                           ("score", "asc"), ("d", "asc"), ("flag", "desc"), ("id", "asc"), ("id", "desc")])
def test_keyset_pages_match_offset_pages_forward_and_back_on_a_real_postgres_with_ties_and_nulls(paged_lakebase, key, direction):
    sort, size, offset_pages = {"key": key, "dir": direction}, 10, []
    total = None
    for offset in range(0, 137, size):
        rows, total, _cursors, sql = page_of(paged_lakebase, {"sort": sort, "offset": offset, "limit": size})
        offset_pages.append([r["id"] for r in rows])
    assert total == 137 and sorted(i for p in offset_pages for i in p) == sorted(r["id"] for r in paged_rows())
    rows, _total, cursors, _sql = page_of(paged_lakebase, {"sort": sort, "offset": 0, "limit": size})
    walked, offset = [[r["id"] for r in rows]], 0
    while cursors["next"]:
        offset += size
        rows, seen_total, cursors, sql = page_of(paged_lakebase, {"sort": sort, "offset": offset, "limit": size, "cursor": cursors["next"]})
        assert "OFFSET" not in sql and seen_total == 137, "a page after the first seeks from the last row and still counts every record"
        walked.append([r["id"] for r in rows])
    assert walked == offset_pages, "every keyset page is the offset page"
    back = []
    while cursors["prev"]:
        offset -= size
        rows, _seen, cursors, sql = page_of(paged_lakebase, {"sort": sort, "offset": offset, "limit": size, "cursor": cursors["prev"]})
        assert "OFFSET" not in sql or "OFFSET 0)" in sql, "only the first page reads from the top"
        back.append([r["id"] for r in rows])
    assert back == offset_pages[-2::-1], "paging back gives the same pages in reverse"


def test_a_cursor_on_a_sort_it_cannot_seek_falls_back_to_the_offset_and_a_bad_cursor_is_refused():
    columns = {"id": "STRING", "label": "STRING", "n": "INT", "score": "DECIMAL", "d": "DATE", "flag": "BOOLEAN"}
    context = dict(shell_sql.list_context(PAGED_PAGE, columns, None, False), types=columns, money=[])
    data = {"sort": {"key": "score", "dir": "asc"}, "offset": 20, "limit": 10, "cursor": {"dir": "next", "value": 1.5, "key": "k004"}}
    sql, _params = shell_sql.list_queries(PAGED_PAGE, {}, shell_sql.list_request(PAGED_PAGE, data, context), context)["rows"]
    assert "LIMIT 10 OFFSET 20" in sql, "a DECIMAL sort keeps the offset, since its values do not round trip exactly"
    for bad in ({"dir": "up", "value": 1, "key": "k"}, {"dir": "next", "value": [1], "key": "k"}, {"dir": "next", "value": 1}):
        with pytest.raises(ValueError, match="cursor takes the dir"):
            shell_sql.list_request(PAGED_PAGE, dict(data, cursor=bad), context)


def test_the_default_filters_come_from_the_date_bounds_alone_and_match_what_the_filter_bar_starts_with(tmp_path):
    ws = FakeWorkspace()
    s = shell_core.Shell(app_dir(tmp_path), env={"DATABRICKS_WAREHOUSE_ID": "wh1"}, sp_factory=lambda: ws, user_factory=lambda h, t: ws)
    status, out = call(s, "GET", "defaults", {"page": "n01_u05"})
    assert status == 200 and out["errors"] == {}
    assert [sql for sql, _p, _l in ws.sql] and all("MIN(v) AS low" in sql for sql, _p, _l in ws.sql), "only the date bounds run"
    status, meta = call(s, "GET", "filters", {"page": "n01_u05"})
    assert status == 200
    for f in meta["filters"]:
        if f["type"] == "date_range":
            chosen = next(p for p in f["presets"] if p["id"] == f["default"])
            assert out["range"][f["id"]] == {"preset": chosen["id"], "from": chosen["from"], "to": chosen["to"]}
    assert sum(1 for sql, _p, _l in ws.sql if "MIN(v) AS low" in sql) == len(out["range"]), "the filter bar reuses the bounds the defaults read"


def test_the_same_query_asked_twice_at_once_runs_once(tmp_path):
    import threading
    gate, started = threading.Event(), threading.Event()

    class SlowWorkspace(FakeWorkspace):
        def run_sql(self, warehouse, sql, params, limit=5000):
            started.set()
            gate.wait(5)
            return super().run_sql(warehouse, sql, params, limit)

    ws = SlowWorkspace()
    s = shell_core.Shell(app_dir(tmp_path), env={"DATABRICKS_WAREHOUSE_ID": "wh1"}, sp_factory=lambda: ws, user_factory=lambda h, t: ws)
    out = []
    first = threading.Thread(target=lambda: out.append(s.run(ws, "sp", "SELECT 1 AS x", [], 1)))
    first.start()
    started.wait(5)
    second = threading.Thread(target=lambda: out.append(s.run(ws, "sp", "SELECT 1 AS x", [], 1)))
    second.start()
    gate.set()
    first.join(5)
    second.join(5)
    assert len(out) == 2 and out[0] is out[1] and len(ws.sql) == 1


def test_a_write_through_the_app_forgets_the_table_versions_it_read_so_stored_counts_are_checked_again(tmp_path):
    from v142_edits_test import EDITOR, MODIFY, TableWorkspace, edit_body, edit_page
    ws = TableWorkspace()
    s = shell_core.Shell(app_dir(tmp_path, MODIFY, [edit_page()]), env={"DATABRICKS_WAREHOUSE_ID": "wh1"}, sp_factory=lambda: ws,
                         user_factory=lambda h, t: ws)
    s.stamps[("changes", "sp", "main.pricing.loss_desk_out")] = (s.clock() + 60, [{"version": 7, "operation": "MERGE"}])
    s.cache.put("kept", 1, 60)
    status, out = call(s, "POST", "records/edit", headers=EDITOR, body=edit_body())
    assert status == 200, out
    assert ("changes", "sp", "main.pricing.loss_desk_out") not in s.stamps and s.cache.get("kept") is None, \
        "the App's own write makes it read the table's last change again"


def test_a_page_asks_for_each_tables_last_change_once_in_parallel_before_its_queries_need_it(tmp_path):
    import threading
    gate, asked = threading.Event(), []

    class SlowHistory(FakeWorkspace):
        def table_history(self, warehouse, name, limit=20):
            asked.append(name)
            gate.wait(5)
            return [{"version": 3, "operation": "MERGE"}]

    ws = SlowHistory()
    s = shell_core.Shell(app_dir(tmp_path), env={"DATABRICKS_WAREHOUSE_ID": "wh1"}, sp_factory=lambda: ws, user_factory=lambda h, t: ws)
    page = s.page("n01_u05")
    s.warm_versions(ws, "sp", page)
    waiting = [threading.Thread(target=lambda: s.table_changes(ws, "sp", "main.pricing.loss_trend")) for _ in range(3)]
    for thread in waiting:
        thread.start()
    gate.set()
    for thread in waiting:
        thread.join(5)
    s.stamp_pool.shutdown(wait=True)
    assert sorted(asked) == sorted(set(asked)), "each table is asked once however many queries need it at the same moment"
    assert set(s.page_reads(page)) <= set(asked) and "main.pricing.loss_trend" in asked
    kept = s.page_reads(dict(page, id="with_result", result_table="main.pricing.loss_desk_out"))
    assert {"main.pricing.loss_desk_out_run_log", "main.pricing.loss_desk_out_summary", "main.pricing.loss_desk_out_assumptions"} <= set(kept)


def test_the_cache_drops_the_least_recently_used_entry_and_never_the_newest():
    now = [0.0]
    cache = shell_core.Cache(entries=4, clock=lambda: now[0])
    for key in ("a", "b", "c"):
        cache.put(key, key, ttl=600)
    cache.put("d", "d", ttl=60)
    assert cache.get("a") == "a"
    cache.put("e", "e", ttl=60)
    assert cache.get("d") == "d" and cache.get("e") == "e", "the newest results stay"
    assert cache.get("b") is None and cache.get("a") == "a", "the least recently read entry goes first"


def test_a_cached_page_stays_until_a_table_it_reads_changes(tmp_path):
    now = [1_000.0]
    s, ws = versioned_shell(tmp_path, lambda: now[0])
    body = {"page": "n01_u05", "filters": {"run_date": {"from": "2026-01-01", "to": "2026-10-01"}}}
    assert call(s, "POST", "page", body=body)[0] == 200
    first = len(ws.sql)
    now[0] += shell_core.CACHE_TTL_S + 30
    assert call(s, "POST", "page", body=body)[0] == 200
    assert len(ws.sql) == first, "no table changed, so the App answers from its cache after the minute"
    ws.versions["main.pricing.loss_trend"] = 8
    now[0] += 30
    assert call(s, "POST", "page", body=body)[0] == 200
    again = [sql for sql, _p, _l in ws.sql[first:]]
    assert again and all("loss_trend" in sql for sql in again), "only the queries that read the changed table run again"


def test_a_lakebase_statement_timeout_runs_once_and_falls_back_as_a_query_error_keeping_the_pool():
    slow = FakeConn(errors=[psycopg.errors.QueryCanceled("canceling statement due to statement timeout")])
    idle = FakeConn()
    lb, made, _clock = lakebase(password_service("t1"), [slow])
    lb.pool.put(idle)
    lb.pool.put(slow)
    with pytest.raises(shell_db.QueryError, match="canceling statement due to statement timeout") as raised:
        lb.run(f"SELECT `category` FROM {TREND_VIEW}", [], 5)
    assert not isinstance(raised.value, shell_pg.LakebaseError), "a timeout is a query error the App falls back on at once"
    ran = [text for text, _values in slow.executed if not text.startswith("SET ")]
    assert len(ran) == 1, "the timed-out query is never run a second time"
    assert made == [] and not slow.closed and not idle.closed, "a timeout leaves every connection in the pool open"
    assert lb.pool.qsize() == 2


def test_a_real_lost_connection_still_retries_once_on_a_fresh_connection():
    lost, fresh = FakeConn(errors=[psycopg.OperationalError("server closed the connection unexpectedly")]), FakeConn()
    lb, made, _clock = lakebase(password_service("t1"), [lost, fresh])
    assert lb.run(f"SELECT `category` FROM {TREND_VIEW}", [], 5)["rows"] == [{"category": "Books"}]
    assert lost.closed and len(made) == 2
