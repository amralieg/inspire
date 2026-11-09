import pytest

ALLOWED = ["main.sales.orders", "main.sales.customers"]


@pytest.mark.parametrize("sql, outside", [
    ("SELECT * FROM main.sales.orders, other.hr.salaries", "other.hr.salaries"),
    ("SELECT * FROM main.sales.orders o, other.hr.salaries s WHERE o.id = s.id", "other.hr.salaries"),
    ("SELECT * FROM/**/other.hr.salaries", "other.hr.salaries"),
    ("SELECT * FROM`other`.`hr`.`salaries`", "other.hr.salaries"),
    ("SELECT * FROM `1cat`.`hr`.`salaries`", "1cat.hr.salaries"),
    ("SELECT * FROM `my cat`.hr.salaries", "my cat.hr.salaries"),
    ("SELECT * FROM hr.salaries", "hr.salaries"),
    ("SELECT * FROM salaries", "salaries"),
    ("SELECT * FROM delta.`/mnt/raw/salaries`", "delta./mnt/raw/salaries"),
    ("SELECT * FROM main.sales.orders WHERE id IN (SELECT id FROM other.hr.salaries)", "other.hr.salaries"),
    ("SELECT * FROM main.sales.orders UNION ALL SELECT * FROM other.hr.salaries", "other.hr.salaries"),
    ("WITH x AS (SELECT * FROM other.hr.salaries) SELECT * FROM x", "other.hr.salaries"),
    ("SELECT * FROM main.sales.orders; SELECT * FROM other.hr.salaries", "other.hr.salaries"),
    ("SELECT * FROM main.sales.orders LEFT JOIN other.hr.salaries USING (id)", "other.hr.salaries"),
])
def test_reads_outside_the_use_case_are_refused(agent_ns, sql, outside):
    unknown = agent_ns["_implement_unknown_tables"]([sql], ALLOWED)
    assert outside.lower() in [u.lower() for u in unknown]


@pytest.mark.parametrize("sql", [
    "SELECT * FROM main.sales.orders",
    "SELECT * FROM `main`.`sales`.`orders` o JOIN main.sales.customers c ON o.cid = c.id",
    "SELECT * FROM main.sales.orders, main.sales.customers",
    "SELECT * FROM sales.orders",
    "SELECT * FROM orders",
    "WITH recent AS (SELECT * FROM main.sales.orders) SELECT * FROM recent",
    "WITH a AS (SELECT 1 AS n), b AS (SELECT * FROM a) SELECT * FROM b JOIN main.sales.customers ON true",
    "SELECT * FROM MAIN.SALES.ORDERS",
    "SELECT * FROM system.billing.usage",
    "SELECT * FROM (VALUES (1), (2)) AS t(n)",
])
def test_reads_inside_the_use_case_are_allowed(agent_ns, sql):
    assert agent_ns["_implement_unknown_tables"]([sql], ALLOWED) == []


def test_unparseable_sql_still_gets_the_pattern_check(agent_ns):
    sql = "SELECT * FROM other.hr.salaries WHERE {{ broken"
    assert agent_ns["_implement_unknown_tables"]([sql], ALLOWED) == ["other.hr.salaries"]


def test_each_outside_table_is_named_once(agent_ns):
    sql = "SELECT * FROM other.hr.salaries JOIN OTHER.HR.SALARIES ON true, other.hr.salaries"
    assert agent_ns["_implement_unknown_tables"]([sql, sql], ALLOWED) == ["other.hr.salaries"]
