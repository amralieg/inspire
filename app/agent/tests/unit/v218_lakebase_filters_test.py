import json

import psycopg
import pytest

from v145_lakebase_test import (PG_ENV, PG_SCHEMA, CredentialWorkspace, call, lakebase_shell, postgres,  # noqa: F401
                                shell_core, shell_db, shell_pg, shell_sql)

BIG = "main.billing.bills_big"
BIG_ROWS = 120_000
BIG_COLUMNS = [{"name": n, "type": t, "type_text": x} for n, t, x in (
    ("district", "STRING", "STRING"), ("segment", "STRING", "STRING"), ("active", "BOOLEAN", "BOOLEAN"), ("n", "INT", "INT"),
    ("billed", "TIMESTAMP", "TIMESTAMP"), ("d", "DATE", "DATE"), ("day_text", "STRING", "STRING"), ("tags", "ARRAY", "ARRAY<STRING>"),
    (shell_pg.ROW_COLUMN, "LONG", "BIGINT"))]
INDEXED = ["district", "segment", "active", "n", "billed", "d", "day_text", "tags"]
FILTERS = [{"id": c, "type": "multi_select", "label": c, "columns": {"big": c}} for c in ("district", "segment", "active", "n")] + [
    {"id": "billed", "type": "date_range", "label": "Billed", "columns": {"big": "billed"}},
    {"id": "d", "type": "date_range", "label": "Day", "columns": {"big": "d"}},
    {"id": "day_text", "type": "date_range", "label": "Day text", "columns": {"big": "day_text"}}]
PAGE = {"id": "n01_u01", "datasets": [{"name": "big", "sql": "SELECT 1"}], "filters": FILTERS}


@pytest.fixture(scope="module")
def big(postgres):  # noqa: F811
    with psycopg.connect(host=postgres["host"], port=postgres["port"], dbname="postgres", user="inspire", autocommit=True) as conn, \
            conn.cursor() as cur:
        cur.execute(f'CREATE TABLE "{PG_SCHEMA}"."bills_big" (district text, segment text, active boolean, n integer, '
                    f'billed timestamptz, d date, day_text text, tags jsonb, "{shell_pg.ROW_COLUMN}" bigint)')
        cur.execute(
            f'INSERT INTO "{PG_SCHEMA}"."bills_big" SELECT CASE WHEN i % 997 = 0 THEN NULL ELSE \'D\' || lpad((i % 23)::text, 2, \'0\') END, '
            f"(ARRAY['Homes', 'Shops', 'Farms', 'Plants', 'Offices'])[1 + i % 5], i % 3 = 0, i % 40, "
            f"TIMESTAMPTZ '2024-01-01 22:30:00+00' + (i % 700) * INTERVAL '1 day', DATE '2024-01-01' + i % 900, "
            f"CASE WHEN i % 2 = 0 THEN '2024-1-' || (1 + i % 9) ELSE '2024-01-' || lpad((10 + i % 9)::text, 2, '0') END, "
            f"'[\"x\"]'::jsonb, i FROM generate_series(1, {BIG_ROWS}) AS i")
        for column in INDEXED[:-1]:
            cur.execute(f'CREATE INDEX ON "{PG_SCHEMA}"."bills_big" ("{column}")')
        cur.execute(f'ANALYZE "{PG_SCHEMA}"."bills_big"')
    conn = psycopg.connect(host=postgres["host"], port=postgres["port"], dbname="postgres", user="inspire", autocommit=True)
    yield conn
    conn.close()


def tables(indexed=INDEXED):
    entry = dict({"pg": f"{PG_SCHEMA}.bills_big", "columns": BIG_COLUMNS}, **({"indexed": list(indexed)} if indexed is not None else {}))
    return {BIG: entry}


def served(indexed=INDEXED):
    backend = {"kind": "lakebase", "pipeline_id": "p", "tables": tables(indexed), "datasets": {PAGE["id"]: {"big": BIG}}}
    return shell_pg.served_page(PAGE, backend), {shell_pg.uc_key(k): v for k, v in backend["tables"].items()}


def rendered(sql, params, held_tables, held=(), overlays=None):
    return shell_pg.render(sql, params, held_tables, held, overlays)[:2]


def scanned(conn, text, values):
    with conn.cursor() as cur:
        cur.execute("EXPLAIN (ANALYZE, FORMAT JSON) " + text, values)
        plan = cur.fetchone()[0][0]["Plan"]

    def walk(node):
        own = node.get("Actual Rows", 0) * node.get("Actual Loops", 1) if node.get("Relation Name") == "bills_big" else 0
        return own + sum(walk(child) for child in node.get("Plans") or [])

    return walk(plan)


def rows(conn, text, values):
    with conn.cursor() as cur:
        cur.execute(text, values)
        return cur.fetchall()


def options(page, ident):
    return shell_sql.options_query(page, ident)


@pytest.mark.parametrize("ident", ["district", "segment", "active", "n"])
def test_a_filters_values_on_a_large_copy_are_read_by_probing_its_index_not_by_reading_every_row(big, ident):
    page, held_tables = served()
    text, values = rendered(*options(page, ident), held_tables)
    assert scanned(big, text, values) < 200, "each probe reads one index entry, so a filter lists its values in a few reads"
    plain_page, plain_tables = served(indexed=None)
    plain_text, plain_values = rendered(*options(plain_page, ident), plain_tables)
    assert "_inspire_s" not in plain_text and scanned(big, plain_text, plain_values) >= BIG_ROWS - BIG_ROWS // 997 - 1
    assert rows(big, text, values) == rows(big, plain_text, plain_values), "the probe lists the same values in the same order"


def test_the_four_filters_of_the_live_billing_page_list_their_values_within_the_read_limit(big):
    page, held_tables = served()
    expected = {"district": 23, "segment": 5, "active": 2, "n": 40}
    for ident, count in expected.items():
        text, values = rendered(*options(page, ident), held_tables)
        with big.transaction(), big.cursor() as cur:
            cur.execute(f"SET LOCAL statement_timeout = {shell_pg.READ_TIMEOUT_MS}")
            cur.execute(text, values)
            assert len(cur.fetchall()) == count, ident


def test_a_search_inside_a_filter_still_reads_the_index_and_finds_only_matching_values(big):
    page, held_tables = served()
    text, values = rendered(*shell_sql.options_query(page, "district", "d1"), held_tables)
    assert [r[0] for r in rows(big, text, values)] == [f"D{n}" for n in range(10, 20)]
    assert scanned(big, text, values) < 200


def test_the_probe_keeps_null_as_a_value_of_a_distinct_read_without_reading_every_row(big):
    held_tables = served()[1]
    text, values = rendered(f"SELECT DISTINCT district AS v FROM {BIG}", [], held_tables)
    got = rows(big, text, values)
    assert (None,) in got and len(got) == 24
    assert sorted(got, key=str) == sorted(rows(big, f'SELECT DISTINCT district FROM "{PG_SCHEMA}"."bills_big"', {}), key=str)
    assert scanned(big, text, values) < 200


def test_a_column_with_more_values_than_the_probe_steps_falls_back_to_reading_every_value(big, monkeypatch):
    monkeypatch.setattr(shell_pg, "DISTINCT_STEPS", 5)
    page, held_tables = served()
    text, values = rendered(*options(page, "n"), held_tables)
    assert [r[0] for r in rows(big, text, values)] == sorted(str(n) for n in range(40))
    monkeypatch.setattr(shell_pg, "DISTINCT_STEPS", 50)
    text, values = rendered(*options(page, "n"), held_tables)
    assert len(rows(big, text, values)) == 40 and scanned(big, text, values) < 200


def rewritten(sql, held_tables, held=(), overlays=None) -> bool:
    import sqlglot
    tree = shell_pg._index_distinct(sqlglot.parse_one(sql, read="databricks"), held_tables, held, overlays)
    return "_inspire_s" in tree.sql()


@pytest.mark.parametrize("case", ["probed", "not indexed", "not listed", "held", "overlay", "json", "two columns", "filtered", "grouped",
                                  "distinct on"])
def test_a_distinct_read_the_probe_cannot_answer_the_same_way_is_left_as_it_was(case):
    sql = f"SELECT DISTINCT CAST(district AS STRING) AS v FROM {BIG}"
    held_tables, held, overlays = served()[1], (), None
    if case == "not indexed":
        held_tables = served(indexed=None)[1]
    elif case == "not listed":
        held_tables = served(indexed=["segment"])[1]
    elif case == "held":
        held = {shell_pg.uc_key(BIG)}
    elif case == "overlay":
        overlays = {shell_pg.uc_key(BIG): {"keys": ["1"], "rows": []}}
    elif case == "json":
        sql = f"SELECT DISTINCT tags AS v FROM {BIG}"
    elif case == "two columns":
        sql = f"SELECT DISTINCT district, segment FROM {BIG}"
    elif case == "filtered":
        sql = f"SELECT DISTINCT district AS v FROM {BIG} WHERE segment = 'Homes'"
    elif case == "grouped":
        sql = f"SELECT district AS v FROM {BIG} GROUP BY district"
    elif case == "distinct on":
        sql = f"SELECT DISTINCT district AS v FROM {BIG} ORDER BY v LIMIT 3"
    assert rewritten(sql, held_tables, held, overlays) is (case == "probed"), case


def test_a_distinct_read_of_a_column_the_subquery_renames_or_computes_is_left_as_it_was():
    held_tables = served()[1]
    assert rewritten(f"SELECT DISTINCT CAST(district AS STRING) AS v FROM (SELECT district, n FROM {BIG}) AS d", held_tables)
    for inner in (f"SELECT segment AS district FROM {BIG}", f"SELECT UPPER(district) AS district FROM {BIG}",
                  f"SELECT district FROM {BIG} WHERE n > 3", f"SELECT n FROM {BIG}"):
        assert not rewritten(f"SELECT DISTINCT CAST(district AS STRING) AS v FROM ({inner}) AS d", held_tables), inner


@pytest.mark.parametrize("ident", ["billed", "d"])
def test_a_date_bound_on_a_large_copy_reads_the_ends_of_its_index(big, ident):
    page, held_tables = served()
    for sql, params in (shell_sql.bounds_query(page, ident), shell_sql.bounds_together_query(page, [ident])):
        text, values = rendered(sql, params, held_tables)
        assert scanned(big, text, values) < 10, text
        column = '"billed"' if ident == "billed" else '"d"'
        expected = rows(big, f'SELECT MIN(CAST({column} AS DATE)), MAX(CAST({column} AS DATE)) FROM "{PG_SCHEMA}"."bills_big"', {})
        assert rows(big, text, values) == expected


def test_a_date_bound_of_a_text_column_still_casts_each_value_because_text_sorts_differently(big):
    page, held_tables = served()
    text, values = rendered(*shell_sql.bounds_query(page, "day_text"), held_tables)
    assert rows(big, text, values) == rows(
        big, f'SELECT MIN(CAST("day_text" AS DATE)), MAX(CAST("day_text" AS DATE)) FROM "{PG_SCHEMA}"."bills_big"', {})
    assert rows(big, f'SELECT MIN("day_text"), MAX("day_text") FROM "{PG_SCHEMA}"."bills_big"', {}) != rows(big, text, values)


def test_a_windowed_date_minimum_is_left_as_it_was():
    held_tables = served()[1]
    text, _values = rendered(f"SELECT MIN(CAST(billed AS DATE)) OVER (PARTITION BY district) AS m FROM {BIG}", [], held_tables)
    assert "MIN(CAST(" in text.upper().replace('"', ""), text


def test_one_filters_bounds_and_the_page_opens_bounds_are_the_same_query():
    page, _held = served()
    single, _p = shell_sql.bounds_query(page, "billed")
    together, _q = shell_sql.bounds_together_query(page, ["billed"])
    assert single == f"SELECT low_0 AS low, high_0 AS high FROM ({together}) AS t"


def test_a_query_lakebase_cancels_at_its_read_limit_says_so_and_another_error_does_not(big, postgres, monkeypatch):  # noqa: F811
    def local(**kwargs):
        return psycopg.connect(host=postgres["host"], port=postgres["port"], dbname="postgres", user="inspire",
                               connect_timeout=kwargs["connect_timeout"], autocommit=kwargs["autocommit"])

    lb = shell_pg.Lakebase({"pipeline_id": "pipeline-1", "tables": tables(None), "datasets": {}}, PG_ENV, lambda: CredentialWorkspace(),
                           connect=local)
    monkeypatch.setattr(shell_pg, "READ_TIMEOUT_MS", 1)
    try:
        with pytest.raises(shell_pg.LakebaseSlow) as slow:
            lb.run(f"SELECT COUNT(*) AS c FROM {BIG} CROSS JOIN {BIG} AS b", [], 5)
        assert str(slow.value).startswith(f"{shell_pg.SLOW_LEAD} 0.001 s (") and "statement timeout" in str(slow.value)
        monkeypatch.setattr(shell_pg, "READ_TIMEOUT_MS", 2500)
        with pytest.raises(shell_db.QueryError) as failed:
            lb.run(f"SELECT CAST(segment AS INT) AS c FROM {BIG}", [], 5)
        assert not isinstance(failed.value, shell_pg.LakebaseSlow) and shell_pg.SLOW_LEAD not in str(failed.value)
    finally:
        lb.close()


def slow_shell(tmp_path, strict, slow_reads=None):
    s, ws, lb = lakebase_shell(tmp_path, strict=strict)
    answer, slowed = lb.run, {}

    def run(sql, params, limit, queued=False, viewer=""):
        if sql.startswith("SELECT v FROM"):
            slowed[sql] = slowed.get(sql, 0) + 1
            if slow_reads is None or slowed[sql] <= slow_reads:
                lb.rendered.append(sql)
                raise shell_pg.LakebaseSlow(f"{shell_pg.SLOW_LEAD} 2.5 s (canceling statement due to statement timeout)")
        return answer(sql, params, limit, queued, viewer)

    lb.slowed = slowed

    lb.run = run
    return s, ws, lb


def test_a_filter_lakebase_lists_too_slowly_is_reported_as_slow_and_never_fails_the_build_check(tmp_path):
    s, _ws, lb = slow_shell(tmp_path, strict=True)
    found = s.checked({})
    slow = [t for k, t in found if k == shell_core.CHECK_SLOW]
    failed = [t for k, t in found if k == shell_core.CHECK_FAILED]
    assert lb.rendered and slow and all("reads Delta tables for its values, because Lakebase did not answer" in t for t in slow), found
    assert not [t for t in failed if "filter" in t and shell_pg.SLOW_LEAD in t], failed
    assert set(s.check({})) == {t for _k, t in found}


def test_the_build_check_reads_a_slow_query_once_more_so_a_cold_first_read_never_counts_as_slow(tmp_path):
    s, _ws, lb = slow_shell(tmp_path, strict=True, slow_reads=1)
    found = s.checked({})
    assert lb.slowed and all(n >= 2 for n in lb.slowed.values()), lb.slowed
    assert not [t for k, t in found if k == shell_core.CHECK_SLOW or shell_pg.SLOW_LEAD in t], found
    (tmp_path / "twice").mkdir()
    s, _ws, lb = slow_shell(tmp_path / "twice", strict=True)
    assert [t for k, t in s.checked({}) if k == shell_core.CHECK_SLOW] and all(n == 2 for n in lb.slowed.values()), \
        "a query slow on its second read too is slow, and it is read exactly twice"


def test_a_filter_that_fails_on_lakebase_for_another_reason_still_fails_the_check():
    kind, text = shell_core.filter_problem("page n01_u05: filter category", "Lakebase could not run it: permission denied")
    assert (kind, text) == (shell_core.CHECK_FAILED, "page n01_u05: filter category failed: Lakebase could not run it: permission denied")
    kind, text = shell_core.filter_problem("page n01_u05: filter category", f"{shell_pg.SLOW_LEAD} 2.5 s (timeout)")
    assert kind == shell_core.CHECK_SLOW and text == (f"page n01_u05: filter category reads Delta tables for its values, because "
                                                      f"{shell_pg.SLOW_LEAD} 2.5 s (timeout)")


def test_the_running_app_reads_delta_for_a_filter_lakebase_lists_too_slowly(tmp_path):
    s, ws, lb = slow_shell(tmp_path, strict=False)
    status, out = call(s, "GET", "filters/options", {"page": "n01_u05", "filter": "category"})
    assert status == 200 and out["options"] and lb.rendered and any(sql.startswith("SELECT v FROM") for sql, _p, _l in ws.sql)
    assert set(lb.slowed.values()) == {1}, "a viewer never waits for a second slow read"
    assert "Lakebase could not run a query, so the App read Delta tables instead: Lakebase did not answer" in lb.note


def test_a_backend_naming_an_indexed_column_its_copy_lacks_is_refused():
    good = {"kind": "lakebase", "pipeline_id": "p", "tables": tables(), "datasets": {"n01_u01": {"big": BIG}}}
    assert not [p for p in shell_pg.backend_problems(good, "sp", [PAGE]) if "indexed" in p]
    for indexed in (["nope"], "district", [3]):
        bad = json.loads(json.dumps(good))
        bad["tables"][BIG]["indexed"] = indexed
        assert any("must name as indexed only its own columns" in p for p in shell_pg.backend_problems(bad, "sp", [PAGE])), indexed


def _copies(agent_ns):
    column = agent_ns["implement_lakebase_column"]
    return [
        {"page": "n01_u01", "dataset": "records", "key": "rt__lb_records", "pg": "s.n01_u01__d_records_a",
         "columns": [column(n, t) for n, t in (("record_key", "string"), ("rank", "int"), ("entity_label", "string"),
                                                ("district", "string"), ("score", "double"), ("hidden", "string"))]},
        {"page": "n01_u01", "dataset": "bill_activity", "key": "rt__lb_bill_activity", "pg": "s.n01_u01__d_bill_activity_b",
         "columns": [column(n, t) for n, t in (("district", "string"), ("service_type", "string"), ("connection_status", "string"),
                                                ("amount", "double"), ("bill_date", "date"))]},
        {"page": "n01_u01", "dataset": "bill_activity", "key": "rt__lbp_bill_activity", "pg": "s.n01_u01__p_bill_activity_c", "previous": True,
         "columns": [column(n, t) for n, t in (("district", "string"), ("service_type", "string"))]}]


def _billing_page():
    return {"id": "n01_u01", "records": {"key": "record_key", "rank": "rank", "label": "entity_label",
                                         "columns": [{"column": "district", "format": "text"}, {"column": "score"}, {"column": "hidden"}],
                                         "column_filters": [{"column": "hidden", "off": True}]},
            "filters": [{"id": "district", "type": "multi_select", "columns": {"records": "district", "bill_activity": "district"}},
                        {"id": "bill_date", "type": "date_range", "columns": {"bill_activity": "bill_date"}}],
            "tables": [{"id": "bills", "dataset": "bill_activity", "columns": [
                {"column": "service_type", "format": "text"}, {"column": "connection_status", "format": "text"}, {"column": "amount"}]}]}


def test_the_build_indexes_each_column_a_choice_column_filter_lists_and_records_every_indexed_column_in_the_backend(agent_ns):
    from v145_lakebase_test import shell_sql as sql
    copies, page = _copies(agent_ns), _billing_page()
    columns_of = agent_ns["implement_lakebase_index_columns"](copies, [page], sql)
    columns = [(c["key"], cols) for c, cols in columns_of]
    assert ("rt__lb_bill_activity", ("service_type",)) in columns and ("rt__lb_bill_activity", ("connection_status",)) in columns, \
        "the table's choice column filters list their values from the copy, so each is indexed"
    assert ("rt__lb_bill_activity", ("amount",)) not in columns, "a number range reads its bounds, not a list of values"
    assert ("rt__lb_records", ("hidden",)) not in columns and ("rt__lb_records", ("hidden", "record_key")) in columns, \
        "a column filter turned off lists nothing, and the list still sorts by that column"
    assert ("rt__lbp_bill_activity", ("service_type",)) not in columns and ("rt__lbp_bill_activity", ("district",)) in columns, \
        "the previous run's copy is read only through the page filters"
    assert len(columns) == len(set(columns))
    planned, skipped = agent_ns["implement_lakebase_index_plan"](
        columns_of, {c["key"]: {n["name"]: 20 for n in c["columns"]} for c in copies})
    assert skipped == [] and [(c["key"], [n for n, _f in kept]) for c, kept in planned] == [(k, list(cols)) for k, cols in columns]
    held = {(c["pg"].split(".")[0], agent_ns["implement_lakebase_index_name"](c, kept)) for c, kept in planned}
    indexed = agent_ns["implement_lakebase_indexed"](planned, held)
    assert indexed == {"rt__lb_records": {"indexed": ["rank", "score"],
                                          "prefixed": {"record_key": 256, "entity_label": 256, "district": 256, "hidden": 256}},
                       "rt__lb_bill_activity": {"indexed": ["bill_date"],
                                                "prefixed": {"district": 256, "service_type": 256, "connection_status": 256}},
                       "rt__lbp_bill_activity": {"prefixed": {"district": 256}}}
    texts = [agent_ns["implement_lakebase_index_sql"](c, kept).as_string(None) for c, kept in planned]
    assert len(texts) == len(columns) and any('"n01_u01__d_bill_activity_b" ((left("connection_status", 256)))' in t for t in texts)
    assert any('"n01_u01__d_bill_activity_b" ("bill_date")' in t for t in texts), "a date has a bounded size, so it is indexed whole"
    backend = agent_ns["implement_lakebase_backend"]("pipe-1", copies, indexed)
    assert backend["tables"]["rt__lb_bill_activity"]["prefixed"] == indexed["rt__lb_bill_activity"]["prefixed"]
    assert "indexed" not in agent_ns["implement_lakebase_backend"]("pipe-1", copies)["tables"]["rt__lb_bill_activity"], \
        "a copy whose indexes were not built claims none, so the App never probes an index that is not there"
    some = set(list(held)[:1])
    assert agent_ns["implement_lakebase_indexed"](planned, some) != indexed, "only an index Postgres holds is claimed"


def test_a_build_whose_indexes_could_not_be_made_claims_none(agent_ns):
    from v120_artifacts_support import CapturingLogger, FakeSpark
    from v140_implement_test import _inspire
    from v145_lakebase_test import shell_sql as sql
    inst = _inspire(agent_ns, FakeSpark())
    inst.logger = CapturingLogger()
    inst._implement_lakebase_connection = lambda env: (_ for _ in ()).throw(RuntimeError("permission denied for schema s"))
    assert inst._implement_lakebase_indexes("N01-U01", {}, _copies(agent_ns), [_billing_page()], sql) == {}
    assert inst.logger.matching("could not reach their database", "WARNING")


def test_a_lakebase_app_whose_filter_lists_too_slowly_stays_on_lakebase_and_the_build_names_the_filter(agent_ns, tmp_path):
    from v146_lakebase_build_test import _app_lakebase
    slow = "page n01_u01: filter district reads Delta tables for its values, because Lakebase did not answer within its read limit of 2.5 s"
    inst, out, _seen, _reader, _pg = _app_lakebase(agent_ns, tmp_path, slows=[[slow]])
    assert out["kind"] == "lakebase" and f"App: {slow}" in out["warnings"]
    assert any(level == "WARNING" and "[LAKEBASE-SLOW-FILTER FIRED]" in m and slow in m for level, m in inst.logger.records), \
        "the build log names it"
    _inst, quiet, _seen, _reader, _pg = _app_lakebase(agent_ns, tmp_path / "quiet")
    assert quiet["kind"] == "lakebase" and not [w for w in quiet["warnings"] if "reads Delta tables for its values" in w]
