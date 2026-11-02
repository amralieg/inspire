"""Decision 1B on the datasets Genie writes: WITH queries, LIMIT with ORDER BY and the edge shapes are read run by run in the one pass,
so the 11 live dataset shapes that read the result table all compile, each run equals the dataset run on that run's own snapshot, the
history is still read once, and a shape that cannot be kept apart is refused with a sentence that says how to rewrite it, offline."""
import json
import os
import re
import sqlite3

import pytest

from v175_runs_one_pass_test import COLS, CURRENT, DIM, ROWS, _db, _local_dim
from v173_dashboard_previous_run_test import RESULT, ROOT
import shell_sql  # noqa: E402

LIVE = json.load(open(os.path.join(ROOT, "tests", "fixtures", "implement_runs_live_shapes.json"), encoding="utf-8"))
HISTORY = "ROW_NUMBER() OVER (ORDER BY `_inspire_ran` DESC)"
SHAPES = {
    "with_current_rows": (f"WITH cur AS (SELECT o.*, UPPER(o.category) AS shelf FROM {RESULT} AS o WHERE {CURRENT}) "
                          f"SELECT c.record_key, c.value, c.shelf, s.region FROM cur AS c LEFT JOIN {DIM} AS s ON s.record_key = c.record_key"),
    "with_dim_then_result": (f"WITH regions AS (SELECT record_key, region FROM {DIM}) SELECT o.record_key, o.value, r.region FROM {RESULT} AS o "
                             f"LEFT JOIN regions AS r ON r.record_key = o.record_key WHERE {CURRENT}"),
    "with_chain_and_group": (f"WITH cur AS (SELECT o.record_key, o.value, o.category FROM {RESULT} AS o WHERE {CURRENT}), "
                             f"totals AS (SELECT category, SUM(value) AS total, COUNT(*) AS n FROM cur GROUP BY category) "
                             f"SELECT t.category, t.total, t.n FROM totals AS t"),
    "with_two_carrying_joined": (f"WITH cur AS (SELECT o.record_key, o.value, o.category FROM {RESULT} AS o WHERE {CURRENT}), "
                                 f"peers AS (SELECT category, MAX(value) AS top FROM cur GROUP BY category) "
                                 f"SELECT c.record_key, c.value, p.top FROM cur AS c JOIN peers AS p ON p.category = c.category"),
    "with_column_list": (f"WITH cur (k, v) AS (SELECT o.record_key, o.value FROM {RESULT} AS o WHERE {CURRENT}) SELECT c.k, c.v FROM cur AS c"),
    "with_distinct_cross_join": (f"WITH runs AS (SELECT DISTINCT category FROM {RESULT} WHERE is_current AND change_source <> 'delete') "
                                 f"SELECT s.region, runs.category FROM {DIM} AS s CROSS JOIN runs"),
    "limit_with_order": f"SELECT o.record_key, o.value FROM {RESULT} AS o WHERE {CURRENT} ORDER BY o.value DESC LIMIT 2",
    "offset_with_order": f"SELECT o.record_key, o.value FROM {RESULT} AS o WHERE {CURRENT} ORDER BY o.value DESC LIMIT 1 OFFSET 1",
    "scalar_subquery_aggregate": (f"SELECT o.record_key, o.value, (SELECT COUNT(*) FROM {DIM} AS s) AS regions FROM {RESULT} AS o "
                                  f"WHERE {CURRENT}"),
    "left_join_of_a_second_carrying_cte": (f"WITH cur AS (SELECT o.record_key, o.value, o.category FROM {RESULT} AS o WHERE {CURRENT}), "
                                           f"toys AS (SELECT record_key, value FROM cur WHERE category = 'Toys') "
                                           f"SELECT c.record_key, c.value, t.value AS toy_value FROM cur AS c LEFT JOIN toys AS t "
                                           f"ON t.record_key = c.record_key"),
    "group_by_for_distinct_with_limit": (f"SELECT o.category, MAX(o.value) AS top FROM {RESULT} AS o WHERE {CURRENT} GROUP BY o.category "
                                         f"ORDER BY MAX(o.value) DESC LIMIT 1"),
    "subquery_on_another_table_only": (f"SELECT o.record_key, o.value FROM {RESULT} AS o WHERE {CURRENT} AND o.record_key IN "
                                       f"(SELECT s.record_key FROM {DIM} AS s, {DIM} AS t WHERE t.record_key = s.record_key)"),
}
EDGE_COLUMNS = ["record_key", "valid_from", "valid_to", "is_current", "change_source", "changed_by", "run_id", "window", "sort", "over"]
EDGE_ROWS = [("a", "10:00", "11:00", 0, "run", "job", "r1", 1.0, 2.0, 3.0), ("b", "10:00", None, 1, "run", "job", "r1", 4.0, 5.0, 6.0),
             ("a", "11:00", None, 1, "run", "job", "r2", 7.0, 8.0, 9.0)]
EDGE = (f"SELECT o.record_key, o.window, o.sort, o.over, SUM(o.over) OVER (ORDER BY o.sort) AS running FROM {RESULT} AS o "
        f"WHERE {CURRENT} AND o.window > 0")


def _runs(db, sql):
    cursor = db.execute(_local_dim(sql))
    names = [c[0] for c in cursor.description]
    at = names.index("_inspire_run")
    keep = [i for i, name in enumerate(names) if name not in ("_inspire_run", "_inspire_row")]
    got = {}
    for row in cursor.fetchall():
        got.setdefault(row[at], []).append(tuple("" if row[i] is None else row[i] for i in keep))
    return {run: sorted(rows) for run, rows in got.items()}


def _plain(db, sql):
    return sorted(tuple("" if v is None else v for v in row) for row in db.execute(_local_dim(sql)).fetchall())


def _snapshot(rows):
    return [row[:3] + (1,) + row[4:] for row in rows if row[1] <= "10:00" and (row[2] is None or row[2] > "10:00")]


def test_every_live_dataset_shape_that_reads_the_result_table_compiles_and_reads_the_history_once():
    assert len(LIVE) == 11 and sum(len(s["kpis"]) for s in LIVE) == 16
    refused = {f"{s['page']}.{s['dataset']}": shell_sql.runs_problem(s["sql"], s["table"]) for s in LIVE}
    assert {k: v for k, v in refused.items() if v} == {}
    for shape in LIVE:
        sql = shell_sql.runs_compare_sql(shape["sql"], shape["table"], list(shell_sql.HISTORY_COLUMNS) + ["run_id"], range(31))
        assert sql.count(HISTORY) == 1 and len(sql) < 20000, shape["dataset"]
        for joined in sorted(set(re.findall(r"samples\.[\w.]+", shape["sql"]))):
            assert sql.count(joined) == shape["sql"].count(joined), (shape["page"], joined)
        assert not re.search(r"\d{12,}", json.dumps(shape)) and "inspire_demo" in shape["table"]


@pytest.mark.parametrize("shape", list(SHAPES))
def test_each_run_reads_a_with_or_limit_dataset_as_that_run_left_the_table(shape):
    sql = SHAPES[shape]
    got = _runs(_db(ROWS), shell_sql.runs_compare_sql(sql, RESULT, COLS))
    want = {shell_sql.RUN_LATEST: _plain(_db(ROWS), sql), shell_sql.RUN_PREVIOUS: _plain(_db(_snapshot(ROWS)), sql)}
    assert got == {run: rows for run, rows in want.items() if rows}, shape


def test_columns_named_window_sort_and_over_are_columns_not_clauses():
    def db(rows):
        out = sqlite3.connect(":memory:")
        out.execute(f"CREATE TABLE churn_out ({', '.join(EDGE_COLUMNS)})")
        out.executemany(f"INSERT INTO churn_out VALUES ({', '.join('?' for _ in EDGE_COLUMNS)})", rows)
        return out
    sql = shell_sql.runs_compare_sql(EDGE, RESULT, EDGE_COLUMNS)
    assert "OVER (PARTITION BY o.`_inspire_run` ORDER BY o.sort)" in sql and "GROUP BY" not in sql.split("\n)\n", 1)[1]
    got = _runs(db(EDGE_ROWS), sql)
    assert got == {shell_sql.RUN_LATEST: _plain(db(EDGE_ROWS), EDGE), shell_sql.RUN_PREVIOUS: _plain(db(_snapshot(EDGE_ROWS)), EDGE)}


def test_a_limit_keeps_each_run_s_own_top_rows():
    sql = shell_sql.runs_compare_sql(SHAPES["limit_with_order"], RESULT, COLS)
    assert "ROW_NUMBER() OVER (PARTITION BY o.`_inspire_run` ORDER BY o.value DESC) AS `_inspire_row`" in sql
    assert sql.endswith("AS `_inspire_top` WHERE `_inspire_row` > 0 AND `_inspire_row` <= 2") and " LIMIT " not in sql
    got = _runs(_db(ROWS), sql)
    assert got[shell_sql.RUN_LATEST] == [("a", 5.0), ("d", 7.0)] and got[shell_sql.RUN_PREVIOUS] == [("b", 4.0), ("c", 2.0)]


REFUSED = [
    (f"WITH RECURSIVE r AS (SELECT 1 AS n UNION ALL SELECT n + 1 FROM r) SELECT o.value FROM {RESULT} AS o",
     "it uses WITH RECURSIVE, which cannot be read run by run; write the recursion out as joins"),
    (f"SELECT o.value FROM {RESULT} AS o WHERE {CURRENT} LIMIT 2", "it uses LIMIT or OFFSET without ORDER BY"),
    (f"SELECT o.value AS v FROM {RESULT} AS o WHERE {CURRENT} ORDER BY 1 LIMIT 2", "names a position or a SELECT alias"),
    (f"SELECT -o.value AS value FROM {RESULT} AS o WHERE {CURRENT} ORDER BY value LIMIT 2", "names a position or a SELECT alias"),
    (f"SELECT o.value FROM {RESULT} AS o UNION ALL SELECT p.value FROM {RESULT} AS p ORDER BY 1 LIMIT 2", "it uses LIMIT or OFFSET on a UNION"),
    (f"SELECT o.record_key, (SELECT COUNT(*) FROM {RESULT} AS r WHERE r.category = o.category AND r.is_current) AS peers FROM {RESULT} AS o",
     "it reads the result table in a subquery outside its FROM, such as in its SELECT list or WHERE; join that query in its FROM instead"),
    (f"WITH cur AS (SELECT * FROM {RESULT} WHERE is_current) SELECT s.region FROM {DIM} AS s WHERE s.record_key IN (SELECT record_key FROM cur)",
     "it reads the result table in a subquery outside its FROM"),
    (f"WITH cur AS (SELECT * FROM {RESULT} WHERE is_current) SELECT c.value FROM cur AS c WHERE c.record_key IN (SELECT record_key FROM cur)",
     "it reads the result table in a subquery outside its FROM"),
    (f"SELECT o.value, SUM(o.value) OVER w FROM {RESULT} AS o", "it uses OVER with a window name but no WINDOW clause defines it"),
]
REFUSED_ON_BF04051_AS_WRONG_NUMBERS = [
    (f"SELECT DISTINCT o.category FROM {RESULT} AS o WHERE {CURRENT} ORDER BY o.category LIMIT 1",
     "it uses SELECT DISTINCT with LIMIT, so each run's top rows would be picked before its duplicates are removed; write the DISTINCT "
     "as GROUP BY"),
    (f"SELECT o.record_key FROM {RESULT} AS o WHERE {CURRENT} AND o.category IN (SELECT r.category FROM {DIM} AS s, {RESULT} AS r "
     f"WHERE r.record_key = s.record_key)", "it reads the result table in a subquery outside its FROM"),
    (f"WITH cur AS (SELECT * FROM {RESULT} WHERE is_current) SELECT c.value FROM cur AS c WHERE c.record_key IN "
     f"(SELECT x.record_key FROM {DIM} AS d, cur AS x WHERE d.record_key = x.record_key)", "it reads the result table in a subquery outside"),
    (f"WITH cur AS (SELECT * FROM {RESULT} WHERE is_current) SELECT c.value, s.region FROM cur AS c JOIN {DIM} AS s ON s.record_key = "
     f"c.record_key AND s.record_key IN (SELECT y.record_key FROM {DIM} AS z, cur AS y WHERE z.record_key = y.record_key)",
     "it reads the result table in a subquery outside"),
    (f"SELECT s.region FROM {DIM} AS s SEMI JOIN {RESULT} AS o ON o.record_key = s.record_key",
     "it filters another table with a SEMI or ANTI JOIN on the result table"),
    (f"SELECT s.region FROM {DIM} AS s LEFT ANTI JOIN {RESULT} AS o ON o.record_key = s.record_key",
     "it filters another table with a SEMI or ANTI JOIN on the result table"),
]
REFUSED += REFUSED_ON_BF04051_AS_WRONG_NUMBERS


@pytest.mark.parametrize("sql,said", REFUSED, ids=[f"r{i}" for i in range(len(REFUSED))])
def test_a_shape_the_one_pass_cannot_keep_apart_is_refused_with_how_to_rewrite_it(sql, said):
    problem = shell_sql.runs_problem(sql, RESULT)
    assert problem.startswith(said) or said in problem, problem
    assert ";" in problem and problem.split(";", 1)[1].strip(), "every refusal says how to rewrite the dataset"


def test_distinct_with_limit_is_refused_since_each_run_s_row_numbers_come_before_its_duplicates_go():
    sql = f"SELECT DISTINCT o.category FROM {RESULT} AS o WHERE {CURRENT} ORDER BY o.category LIMIT 2"
    plain = _plain(_db(ROWS), sql)
    assert plain == [("Books",), ("Toys",)]
    with pytest.raises(ValueError, match="SELECT DISTINCT with LIMIT"):
        shell_sql.runs_compare_sql(sql, RESULT, COLS)


@pytest.mark.parametrize("join", ["LEFT SEMI JOIN", "LEFT ANTI JOIN", "LEFT JOIN", "SEMI JOIN", "ANTI JOIN"])
def test_a_second_read_of_the_result_table_after_the_first_matches_its_run_in_any_left_join(join):
    sql = (f"SELECT o.record_key, o.value FROM {RESULT} AS o {join} {RESULT} AS p ON p.category = o.category AND p.value > o.value "
           f"WHERE {CURRENT}")
    compiled = shell_sql.runs_compare_sql(sql, RESULT, COLS)
    assert f"{join} {shell_sql.RUNS_CTE} AS p ON ( p.category = o.category AND p.value > o.value ) AND p.`_inspire_run` = o.`_inspire_run`" \
        in compiled, compiled
    assert compiled.count(f"FROM {shell_sql.RUNS_CTE} AS o") == 1


@pytest.mark.parametrize("shape", ["with_chain_and_group", "with_distinct_cross_join", "limit_with_order"])
def test_the_baseline_alert_reads_its_measured_row_once_so_the_dataset_runs_once_for_30_earlier_runs(shape):
    page = {"result_table": RESULT, "datasets": [{"name": "d", "sql": SHAPES[shape]}], "filters": [],
            "kpis": [{"id": "k", "label": "K", "dataset": "d", "expression": "COUNT(*)"}]}
    alert = shell_sql.watch_query(page, {"what": "k", "filters": {}, "operator": ">", "threshold": 1, "basis": "baseline"}, COLS)["query"]
    name = shell_sql.ALERT_WATCHED
    assert f"\n{name} AS (SELECT " in alert and len(re.findall(rf"\bFROM {name}\b", alert)) == 1, alert
    assert len(re.findall(r"\bFROM runs\b", alert.split(f"\n{name} AS (SELECT ", 1)[1])) == 1, alert
    assert alert.count("FROM history") == 1 and re.search(r"FROM baseline t$", alert), alert
    assert alert.count(HISTORY) == 1 and len(alert) < 20000


def test_a_named_window_clause_is_partitioned_by_run():
    sql = f"SELECT o.record_key, SUM(o.value) OVER w AS running FROM {RESULT} AS o WHERE {CURRENT} WINDOW w AS (ORDER BY o.value)"
    compiled = shell_sql.runs_compare_sql(sql, RESULT, COLS)
    assert "WINDOW w AS (PARTITION BY o.`_inspire_run` ORDER BY o.value)" in compiled
