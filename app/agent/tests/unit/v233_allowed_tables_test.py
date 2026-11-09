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
    "SELECT * FROM system.information_schema.tables",
    "SELECT table_name FROM information_schema.columns",
    "SELECT * FROM range(10)",
    "SELECT * FROM main.sales.orders, LATERAL explode(items) AS e(x)",
    "SELECT * FROM explode(array(1, 2))",
    "SELECT concat('Total: ', amount), date_format(ts, 'HH:mm'), regexp_replace(note, '/', '') FROM main.sales.orders",
    "SELECT IDENTIFIER('amount') FROM main.sales.orders",
    "SELECT ai_query('endpoint', note) FROM main.sales.orders",
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


@pytest.mark.parametrize("sql", [
    "SELECT * FROM system.billing.usage",
    "SELECT * FROM system.billing.list_prices",
    "SELECT * FROM system.access.audit",
    "SELECT * FROM system.access.table_lineage",
    "SELECT * FROM system.query.history",
    "SELECT * FROM system.compute.clusters",
    "SELECT * FROM system.lakeflow.jobs",
    "SELECT * FROM system.serving.endpoint_usage",
    "SELECT * FROM system.storage.predictive_optimization_operations_history",
    "SELECT * FROM `system`.`access`.`audit`",
    "SELECT * FROM main.sales.orders o JOIN system.access.audit a ON o.id = a.event_id",
])
def test_system_tables_outside_the_metadata_namespace_are_refused(agent_ns, sql):
    assert agent_ns["_implement_unknown_tables"]([sql], ALLOWED), sql


@pytest.mark.parametrize("sql, outside", [
    ("SELECT * FROM read_files('/Volumes/main/raw/landing/x.csv', format => 'csv')", "read_files(...)"),
    ("SELECT * FROM READ_FILES('s3://bucket/x.json')", "read_files(...)"),
    ("SELECT * FROM cloud_files('gs://bucket/landing/x', 'json')", "cloud_files(...)"),
    ("SELECT * FROM read_kafka(bootstrapServers => 'h:9092', subscribe => 't')", "read_kafka(...)"),
    ("SELECT * FROM remote_query('pg', database => 'd', query => 'select * from payroll')", "remote_query(...)"),
    ("SELECT * FROM my_catalog_function('/mnt/raw/x')", "my_catalog_function(...)"),
    ("SELECT * FROM range('/mnt/raw/x')", "range(...)"),
    ("SELECT * FROM IDENTIFIER('other.hr.salaries')", "other.hr.salaries"),
    ("SELECT * FROM csv.`/mnt/raw/salaries.csv`", "csv./mnt/raw/salaries.csv"),
    ("SELECT * FROM json.`s3://bucket/x`", "json.s3://bucket/x"),
    ("SELECT * FROM parquet.`dbfs:/x`", "parquet.dbfs:/x"),
    ("SELECT http_request(conn => 'c', method => 'GET', path => '/x') AS r FROM main.sales.orders", "http_request(...)"),
    ("SELECT secret('scope', 'key') AS k FROM main.sales.orders", "secret(...)"),
    ("SELECT try_secret('scope', 'key') AS k", "try_secret(...)"),
    ("SELECT * FROM main.sales.orders WHERE {{ broken read_files('/x')", "read_files(...)"),
])
def test_table_functions_and_path_reads_outside_the_use_case_are_refused(agent_ns, sql, outside):
    unknown = agent_ns["_implement_unknown_tables"]([sql], ALLOWED)
    assert outside.lower() in [u.lower() for u in unknown], unknown


@pytest.mark.parametrize("sql", [
    "SELECT * FROM read_lakehouse_magic(42)",
    "SELECT * FROM main.sales.orders o JOIN read_lakehouse_magic(o.id) r ON true",
    "SELECT * FROM main.sales.orders, LATERAL read_lakehouse_magic(id)",
    "SELECT * FROM main.sales.orders LATERAL VIEW read_lakehouse_magic(id) r AS x",
    "SELECT * FROM read_csv('x')",
    "SELECT * FROM read_parquet('x')",
    "SELECT * FROM main.sales.orders, LATERAL read_csv('x')",
    "SELECT * FROM (SELECT * FROM read_parquet('x'))",
])
def test_every_table_function_outside_the_generator_list_is_refused(agent_ns, sql):
    assert any(u.endswith("(...)") for u in agent_ns["_implement_unknown_tables"]([sql], ALLOWED)), sql


@pytest.mark.parametrize("sql", [
    "SELECT * FROM main.sales.orders LATERAL VIEW explode(items) e AS x",
    "SELECT * FROM main.sales.orders LATERAL VIEW OUTER posexplode(items) e AS p, x",
    "SELECT * FROM posexplode(array(1, 2))",
    "SELECT * FROM inline(array(struct(1, 2)))",
    "SELECT * FROM stack(2, 1, 2)",
    "SELECT * FROM json_tuple('{\"a\": 1}', 'a')",
    "SELECT * FROM sequence(1, 3)",
    "SELECT * FROM unnest(array(1, 2))",
])
def test_generator_table_functions_still_pass(agent_ns, sql):
    assert agent_ns["_implement_unknown_tables"]([sql], ALLOWED) == []
