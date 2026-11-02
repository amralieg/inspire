"""Decision 1B in one pass: the App tile, the dashboard counter and the alert read every run they need from one tagged read of the
result table, so a dimension table the KPI's dataset joins is read once whatever the number of runs, a self-join meets only its own
run, a grouped or windowed dataset is grouped and windowed per run, and a dataset shape the one pass cannot keep apart is refused,
offline."""
import re
import sqlite3

import pytest

from v173_dashboard_previous_run_test import RESULT, _local
import shell_sql  # noqa: E402

DIM = "main.s.orders"
COLS = ["record_key", "valid_from", "valid_to", "is_current", "change_source", "changed_by", "run_id", "value", "category"]
CURRENT = "o.is_current AND o.change_source <> 'delete'"
JOINED = f"SELECT o.record_key, o.value, o.category, s.region FROM {RESULT} AS o LEFT JOIN {DIM} AS s ON s.record_key = o.record_key WHERE {CURRENT}"
ROWS = [("a", "10:00", "11:00", 0, "run", "job", "r1", 1.0, "Books"), ("b", "10:00", None, 1, "run", "job", "r1", 4.0, "Books"),
        ("c", "10:00", None, 1, "run", "job", "r1", 2.0, "Toys"), ("a", "11:00", None, 1, "run", "job", "r2", 5.0, "Books"),
        ("d", "11:00", None, 1, "run", "job", "r2", 7.0, "Toys")]
SHAPES = {
    "self_join": (f"SELECT o.record_key, o.value, p.value AS peer FROM {RESULT} AS o JOIN {RESULT} AS p ON p.category = o.category "
                  f"AND p.record_key <> o.record_key WHERE {CURRENT} AND p.is_current AND p.change_source <> 'delete'"),
    "grouped_and_windowed": (f"SELECT o.category, SUM(o.value) AS total, RANK() OVER (ORDER BY SUM(o.value) DESC) AS place FROM {RESULT} AS o "
                             f"WHERE {CURRENT} GROUP BY o.category"),
    "aggregated_without_group": f"SELECT COUNT(*) AS n, SUM(o.value) AS total FROM {RESULT} AS o WHERE {CURRENT}",
    "partitioned_window": (f"SELECT o.record_key, ROW_NUMBER() OVER (PARTITION BY o.category ORDER BY o.value DESC) AS place FROM {RESULT} AS o "
                           f"WHERE {CURRENT}"),
    "wrapped_subquery": f"SELECT * EXCEPT (category), UPPER(category) AS category FROM (SELECT o.* FROM {RESULT} o WHERE {CURRENT}) AS d",
    "unaliased": f"SELECT record_key, value FROM {RESULT} WHERE is_current AND change_source <> 'delete'",
}


def _db(rows):
    db = sqlite3.connect(":memory:")
    db.execute(f"CREATE TABLE churn_out ({', '.join(COLS)})")
    db.executemany(f"INSERT INTO churn_out VALUES ({', '.join('?' for _ in COLS)})", rows)
    db.execute("CREATE TABLE orders (record_key TEXT, region TEXT)")
    db.executemany("INSERT INTO orders VALUES (?, ?)", [("a", "East"), ("b", "West"), ("d", "East")])
    return db


def _local_dim(sql):
    return _local(sql).replace(DIM, "orders").replace(" EXCEPT (category), UPPER(category) AS category", "")


def _rows(db, sql):
    return sorted(tuple("" if v is None else v for v in row) for row in db.execute(_local_dim(sql)).fetchall())


def _oracle(sql):
    previous = [row[:3] + (1,) + row[4:] for row in ROWS if row[1] <= "10:00" and (row[2] is None or row[2] > "10:00")]
    return {shell_sql.RUN_LATEST: _rows(_db(ROWS), sql), shell_sql.RUN_PREVIOUS: _rows(_db(previous), sql)}


@pytest.mark.parametrize("earlier", [1, 7, 30])
def test_a_joined_table_is_read_once_whatever_the_number_of_runs(earlier):
    sql = shell_sql.runs_compare_sql(JOINED, RESULT, COLS, range(earlier + 1))
    assert sql.count(DIM) == 1, f"{earlier} earlier runs read {DIM} {sql.count(DIM)} times"
    assert sql.count("ROW_NUMBER() OVER (ORDER BY `_inspire_ran` DESC)") == 1, "every run end comes from one read of the history"
    assert sql.count(f"`_inspire_nth` IN ({', '.join(str(b + 1) for b in range(1, earlier + 1))})") == 1
    page = {"result_table": RESULT, "datasets": [{"name": "joined", "sql": JOINED}], "filters": [],
            "kpis": [{"id": "k", "label": "K", "dataset": "joined", "expression": "SUM(value)"}]}
    alert = shell_sql.watch_query(page, {"what": "k", "filters": {}, "operator": ">", "threshold": 1, "basis": "baseline"}, COLS)["query"]
    assert alert.count(DIM) == 1 and len(alert) < 20000, (alert.count(DIM), len(alert))


@pytest.mark.parametrize("shape", list(SHAPES))
def test_each_run_reads_the_dataset_as_that_run_left_the_table_for_every_shape_the_one_pass_keeps(shape):
    sql = SHAPES[shape]
    got = {}
    for row in _db(ROWS).execute(_local_dim(shell_sql.runs_compare_sql(sql, RESULT, COLS))).fetchall():
        got.setdefault(row[-1], []).append(tuple("" if v is None else v for v in row[:-1]))
    want = _oracle(sql)
    assert {run: sorted(rows) for run, rows in got.items()} == {run: rows for run, rows in want.items() if rows}, shape


def test_a_self_join_meets_only_its_own_run():
    sql = shell_sql.runs_compare_sql(SHAPES["self_join"], RESULT, COLS)
    assert re.search(r"ON \( p\.category = o\.category AND p\.record_key <> o\.record_key \) AND p\.`_inspire_run` = o\.`_inspire_run`", sql), sql
    assert sql.count(f"FROM {shell_sql.RUNS_CTE} AS o") == 1 and sql.count(f"JOIN {shell_sql.RUNS_CTE} AS p") == 1
    assert _oracle(SHAPES["self_join"])[shell_sql.RUN_LATEST] == [("a", 5.0, 4.0), ("b", 4.0, 5.0), ("c", 2.0, 7.0), ("d", 7.0, 2.0)]


REFUSED = [
    (f"SELECT o.value FROM {RESULT} AS o WHERE {CURRENT} LIMIT 10", "it uses LIMIT or OFFSET without ORDER BY"),
    (f"SELECT o.value FROM {DIM} AS o WHERE o.record_key IN (SELECT record_key FROM {RESULT})", "it reads the result table in a subquery outside"),
    (f"SELECT * FROM {RESULT} AS o JOIN {RESULT} AS p ON p.record_key = o.record_key", "it selects * from the result table read twice"),
    (f"SELECT o.value FROM {RESULT} AS o UNION ALL SELECT s.amount FROM {DIM} AS s", "only some parts of its UNION read the result table"),
    (f"SELECT o.value, SUM(o.value) OVER w FROM {RESULT} AS o", "it uses OVER with a window name but no WINDOW clause defines it"),
    (f"SELECT o.category, SUM(o.value) FROM {RESULT} AS o GROUP BY ROLLUP (o.category)", "it uses ROLLUP"),
    (f"SELECT s.amount FROM {DIM} AS s", "it does not read the result table"),
    (f"SELECT s.amount, o.value FROM {DIM} AS s LEFT JOIN {RESULT} AS o ON o.record_key = s.record_key", "it outer-joins the result table"),
    (f"SELECT s.amount, o.value FROM {RESULT} AS o RIGHT JOIN {DIM} AS s ON o.record_key = s.record_key", "it outer-joins the result table"),
    (f"SELECT s.amount, o.value FROM {RESULT} AS o FULL OUTER JOIN {DIM} AS s ON o.record_key = s.record_key", "it outer-joins the result table"),
]


@pytest.mark.parametrize("sql,said", REFUSED, ids=[r[1].split(",")[0][:40] for r in REFUSED])
def test_a_dataset_the_one_pass_cannot_keep_apart_by_run_is_refused_everywhere(sql, said):
    with pytest.raises(ValueError, match=re.escape(said)):
        shell_sql.runs_compare_sql(sql, RESULT, COLS)
    if "does not read" in said:
        return
    page = {"version": shell_sql.SPEC_VERSION, "result_table": RESULT, "datasets": [{"name": "d", "sql": sql}], "filters": [],
            "kpis": [{"id": "k", "label": "K", "dataset": "d", "expression": "SUM(value)", "compare": True}]}
    assert any(p.startswith(f"KPI k compares with the previous run, but its dataset d cannot be read run by run: {said}")
               for p in shell_sql.spec_problems(page)), shell_sql.spec_problems(page)
    assert shell_sql.baseline_problem(page, dict(page["kpis"][0]), COLS).startswith("K reads dataset d, which cannot be read run by run: ")


def test_one_builder_serves_the_tile_the_counter_and_the_alert_and_the_copy_path_is_gone():
    for gone in ("previous_run_end", "at_previous_run_sql", "dataset_at_previous_run", "_FROM_ALIAS"):
        assert not hasattr(shell_sql, gone), gone
    page = {"result_table": RESULT, "datasets": [{"name": "joined", "sql": JOINED}], "filters": [],
            "kpis": [{"id": "k", "label": "K", "dataset": "joined", "expression": "SUM(value)", "compare": True}]}
    assert shell_sql.previous_rows(page, "joined", COLS) == shell_sql.runs_compare_sql(JOINED, RESULT, COLS, (1,))
    alert = shell_sql.watch_query(page, {"what": "k", "filters": {}, "operator": ">", "threshold": 1, "basis": "baseline"}, COLS)["query"]
    assert shell_sql.runs_compare_sql(JOINED, RESULT, COLS, range(31)) in alert
