import copy
import types

import psycopg
import pytest

from v141_app_shell_test import PAGE
from v145_lakebase_test import PG_SCHEMA, FakeConn, lakebase, password_service, postgres  # noqa: F401

import shell_pg  # noqa: E402
import shell_sql  # noqa: E402

WHOLE = "write one aggregate expression over the dataset's columns"


@pytest.mark.parametrize("expression", ["value_at_stake", "42", "value_at_stake * 2", "CASE WHEN value > 0 THEN 1 END",
                                        "SUM(value_at_stake) OVER (PARTITION BY category)", "SUM(value) + value", "ROUND(value, 2)"])
def test_a_kpi_that_is_not_one_aggregate_is_refused_with_the_shared_wording(expression):
    problems = shell_sql.expression_problems("KPI k1", expression)
    assert len(problems) == 1 and problems[0].startswith("KPI k1 expression ") and problems[0].endswith(WHOLE), problems
    page = copy.deepcopy(PAGE)
    page["kpis"][0]["expression"] = expression
    assert any(p.endswith(WHOLE) and page["kpis"][0]["id"] in p for p in shell_sql.spec_problems(page)), "a page with it fails its check"


@pytest.mark.parametrize("expression", [
    "SUM(value_at_stake)", "COUNT(*)", "COUNT_IF(priority_tier = 'Act now')", "SUM(a) / NULLIF(SUM(b), 0)", "ROUND(AVG(x), 2)",
    "CAST(SUM(x) AS DOUBLE)", "MAX(as_of_date) - MIN(as_of_date)", "DATEDIFF(current_date, MAX(as_of_date))", "COUNT(DISTINCT `entity id`)",
    "percentile_approx(value, 0.5)", "SUM(CASE WHEN tier = 'x' THEN value ELSE 0 END)", "try_divide(SUM(a), COUNT(*))",
    "AVG(CASE WHEN status IN ('Done', 'Resolved') THEN 1.0 ELSE 0 END)", "size(collect_set(category))"])
def test_one_aggregate_kpi_passes(expression):
    assert shell_sql.expression_problems("KPI k1", expression) == []


def test_a_kpi_query_reads_at_most_its_two_periods():
    assert shell_sql.CAPS["kpi_rows"] == 2
    values = {"run_date": {"from": "2026-01-01", "to": "2026-06-30"}}
    for given in ({}, values):
        sql, _params = shell_sql.kpi_query(PAGE, "total_loss", given)
        assert sql.endswith(" LIMIT 2"), sql


class Streamed:
    def __init__(self, total):
        self.total, self.sent = total, 0

    def take(self, count):
        count = max(0, min(count, self.total - self.sent))
        self.sent += count
        return [("r",)] * count


class ServerConn(FakeConn):
    def __init__(self, total):
        super().__init__(rows=(), shape=(("category", 25),))
        self.stream, self.named, self.opened = Streamed(total), [], 0

    def transaction(self):
        conn = self

        class Block:
            def __enter__(self):
                conn.opened += 1
                return self

            def __exit__(self, *_exc):
                return False

        return Block()

    def cursor(self, name=None):
        self.named.append(name)
        cursor = super().cursor()
        stream = self.stream
        execute = cursor.execute

        def run(text, values=None):
            execute(text, values)
            if name is None and not text.startswith("SET "):
                stream.sent = stream.total

        cursor.execute = run
        cursor.fetchmany = (lambda size: stream.take(size)) if name else (lambda size: [("r",)] * min(size, stream.total))
        return cursor


def test_a_lakebase_read_of_ten_million_rows_brings_only_the_rows_it_returns_into_the_app():
    conn = ServerConn(10_000_000)
    lb, _made, _clock = lakebase(password_service("t1"), conns=[conn])
    names, _types, rows = lb.query("SELECT category FROM big", {}, 25)
    assert names == ["category"] and len(rows) == 26
    assert conn.stream.sent == 26, "a cursor that holds the result on the server sends only the rows the App asks for"
    assert conn.named[-1] and conn.opened == 1


def test_a_kpi_on_lakebase_returns_the_same_value_with_its_limit_and_a_server_side_cursor(postgres):  # noqa: F811
    def local(**kwargs):
        return psycopg.connect(host=postgres["host"], port=postgres["port"], dbname="postgres", user="inspire",
                               connect_timeout=kwargs["connect_timeout"], autocommit=kwargs["autocommit"])

    lb, _made, _clock = lakebase(password_service("t1"), connect=local)
    table = f'"{PG_SCHEMA}"."kpi_rows"'
    with local(connect_timeout=10, autocommit=True) as conn, conn.cursor() as cur:
        cur.execute(f"DROP TABLE IF EXISTS {table}")
        cur.execute(f"CREATE TABLE {table} AS SELECT g AS n, (g % 7)::double precision AS v FROM generate_series(1, 200000) AS g")
        cur.execute(f"SELECT SUM(v) FROM {table}")
        expected = cur.fetchone()[0]
    before = f"SELECT 'now' AS period, SUM(v) AS value FROM (SELECT * FROM {table}) AS d"
    for text in (before, before + f" LIMIT {shell_sql.CAPS['kpi_rows']}"):
        _names, _types, rows = lb.query(text, {}, 5000)
        assert rows == [("now", expected)], text
    _names, _types, rows = lb.query(f"SELECT n FROM {table} ORDER BY n", {}, 25)
    assert [r[0] for r in rows] == list(range(1, 27))
    lb.close()
