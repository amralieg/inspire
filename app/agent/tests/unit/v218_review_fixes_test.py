import json
import os
import subprocess
import sys

import psycopg
import pytest

from v120_artifacts_support import CapturingLogger, FakeSpark
from v140_implement_test import _app_shell, _churn_page, _inspire, _output_context
from v145_lakebase_test import postgres, shell_core, shell_pg, shell_sql  # noqa: F401
from v218_filter_grain_test import BILLS, POINTS, RESULT, _live_page, _skipped

IX_SCHEMA = "rf_ix"
IX_TABLE = "n01_u01__d_bill_activity_x"
IX_ROWS = 30000
UC_VIEW = "main.inspire.rt__lb_bill_activity"
LONG = "(SELECT string_agg(md5(random()::text || g::text), '') FROM generate_series(1, 100) AS g)"
STALE = "ix_0123456789abcdef"
PAGE = {"id": "n01_u01", "datasets": [{"name": "bill_activity", "sql": "SELECT 1"}],
        "filters": [{"id": "district", "type": "multi_select", "label": "District", "columns": {"bill_activity": "district"}},
                    {"id": "spot", "type": "multi_select", "label": "Spot", "columns": {"bill_activity": "spot"}},
                    {"id": "bill_date", "type": "date_range", "label": "Bill date", "columns": {"bill_activity": "bill_date"}}],
        "tables": [{"id": "bills", "dataset": "bill_activity", "columns": [
            {"column": "service_type", "format": "text"}, {"column": "notes", "format": "text"}, {"column": "amount"}]}]}


def _examined(node):
    kept = node.get("Actual Rows", 0) + node.get("Rows Removed by Filter", 0) + node.get("Rows Removed by Index Recheck", 0)
    return kept * node.get("Actual Loops", 1)


def _connect(postgres):  # noqa: F811
    return psycopg.connect(host=postgres["host"], port=postgres["port"], dbname="postgres", user="inspire", autocommit=True)


def _env(postgres):  # noqa: F811
    return {"PGHOST": postgres["host"], "PGPORT": str(postgres["port"]), "PGDATABASE": "postgres", "PGUSER": "inspire"}


def _copy(agent_ns):
    column = agent_ns["implement_lakebase_column"]
    return {"page": "n01_u01", "dataset": "bill_activity", "key": UC_VIEW, "pg": f"{IX_SCHEMA}.{IX_TABLE}",
            "columns": [column(n, t) for n, t in (("district", "string"), ("service_type", "string"), ("notes", "string"),
                                                   ("amount", "double"), ("spot", "int"), ("bill_date", "date"),
                                                   (shell_pg.ROW_COLUMN, "bigint"))]}


@pytest.fixture(scope="module")
def bills(postgres):  # noqa: F811
    with _connect(postgres) as conn, conn.cursor() as cur:
        cur.execute(f'CREATE SCHEMA "{IX_SCHEMA}"')
        cur.execute(f'CREATE TABLE "{IX_SCHEMA}"."{IX_TABLE}" (district text, service_type text, notes text, amount double precision, '
                    f'spot point, bill_date date, "{shell_pg.ROW_COLUMN}" bigint)')
        cur.execute(f'INSERT INTO "{IX_SCHEMA}"."{IX_TABLE}" SELECT \'D\' || lpad((i % 23)::text, 2, \'0\'), '
                    f"(ARRAY['Water', 'Power', 'Gas'])[1 + i % 3], CASE WHEN i = 7 THEN {LONG} ELSE 'short note ' || (i % 5) END, "
                    f"i * 1.5, point(i, i), DATE '2025-01-01' + i % 400, i FROM generate_series(1, {IX_ROWS}) AS i")
        cur.execute(f'CREATE INDEX "{STALE}" ON "{IX_SCHEMA}"."{IX_TABLE}" (district)')
        cur.execute(f'ANALYZE "{IX_SCHEMA}"."{IX_TABLE}"')
    return postgres


def _built(agent_ns, postgres):  # noqa: F811
    inst = _inspire(agent_ns, FakeSpark())
    inst.logger = CapturingLogger()
    inst._implement_api = lambda method, path, body=None, query=None: {"token": "local"}
    indexed = inst._implement_lakebase_indexes("N01-U01", _env(postgres), [_copy(agent_ns)], [PAGE], shell_sql)
    return inst, indexed


def _held(postgres):  # noqa: F811
    with _connect(postgres) as conn, conn.cursor() as cur:
        cur.execute("SELECT c.relname, pg_get_indexdef(c.oid) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_class t "
                    "ON t.oid = i.indrelid JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = %s AND t.relname = %s",
                    (IX_SCHEMA, IX_TABLE))
        return dict(cur.fetchall())


def test_a_free_text_column_or_a_refused_index_never_takes_the_other_indexes_down_and_indexed_is_what_postgres_holds(agent_ns, bills):
    inst, indexed = _built(agent_ns, bills)
    assert indexed == {UC_VIEW: {"indexed": ["bill_date"], "prefixed": {"district": 256, "service_type": 256},
                                 "prefix_ordered": ["district", "service_type"]}}, \
        "each index is built on its own, so the point column Postgres cannot index and the free-text notes leave the others standing"
    held = _held(bills)
    assert STALE not in held, "an earlier Inspire index on a whole text column is dropped, so it can never fail a sync"
    assert len(held) == 3 and all(agent_ns["IMPLEMENT_LAKEBASE_INDEX_NAME"].match(name) for name in held)
    assert {d.split(" USING btree ", 1)[1] for d in held.values()} == {"(\"left\"(district, 256))", "(\"left\"(service_type, 256))",
                                                                       "(bill_date)"}
    said = [m for level, m in inst.logger.records if "[IMPLEMENT-LAKEBASE]" in m]
    assert len(said) == 1 and inst.logger.records[-1][0] == "WARNING", said
    assert "district (its first 256 characters)" in said[0] and "bill_date" in said[0] and "(3 indexes)" in said[0]
    assert "notes of rf_ix.n01_u01__d_bill_activity_x, because it holds values of up to 3,200 bytes, so it is free text" in said[0]
    assert "spot of rf_ix.n01_u01__d_bill_activity_x, because Postgres refused it" in said[0]
    assert "keep no index" not in said[0], "the message names exactly what was and was not indexed"


def test_a_long_value_arriving_after_the_build_never_fails_the_sync_and_the_filter_still_reads_the_index(agent_ns, bills):
    _inst, indexed = _built(agent_ns, bills)
    with _connect(bills) as conn, conn.cursor() as cur:
        cur.execute(f'INSERT INTO "{IX_SCHEMA}"."{IX_TABLE}" (district, service_type, notes, "{shell_pg.ROW_COLUMN}") '
                    f"VALUES ('D99' || {LONG}, {LONG}, {LONG}, {IX_ROWS + 1}) RETURNING octet_length(district)")
        assert cur.fetchone()[0] > 2704, "the value is longer than a whole-column btree entry may be"
        cur.execute(f'ANALYZE "{IX_SCHEMA}"."{IX_TABLE}"')
    backend = agent_ns["implement_lakebase_backend"]("pipe-1", [_copy(agent_ns)], indexed)
    assert backend["datasets"] == {PAGE["id"]: {"bill_activity": UC_VIEW}}
    assert shell_pg.backend_problems(backend, "sp", [PAGE]) == []
    page = shell_pg.served_page(PAGE, backend)
    held = {shell_pg.uc_key(k): v for k, v in backend["tables"].items()}
    for ident in ("district",):
        text, values = shell_pg.render(*shell_sql.options_query(page, ident), held)[:2]
        assert 'LEFT("district", 256)' in text, text
        with _connect(bills) as conn, conn.cursor() as cur:
            cur.execute("EXPLAIN (ANALYZE, FORMAT JSON) " + text, values)
            plan = cur.fetchone()[0][0]["Plan"]
            cur.execute(text, values)
            got = [r[0] for r in cur.fetchall()]
            cur.execute(f'SELECT DISTINCT district FROM "{IX_SCHEMA}"."{IX_TABLE}" WHERE district IS NOT NULL ORDER BY district '
                        f"LIMIT {shell_sql.CAPS['options']}")
            expected = [r[0] for r in cur.fetchall()]
        assert got == expected and any(len(v) > 2704 for v in got), "the long value is listed whole, not cut to its first characters"

        def walk(node):
            own = _examined(node) if node.get("Relation Name") == IX_TABLE else 0
            return own + sum(walk(child) for child in node.get("Plans") or [])

        def kinds(node):
            ran = {node.get("Node Type")} if node.get("Actual Loops") else set()
            return ran | {k for child in node.get("Plans") or [] for k in kinds(child)}

        def tree(node, depth=0):
            own = " ".join(str(node.get(k) or "") for k in ("Node Type", "Relation Name", "Index Name", "Filter", "Index Cond",
                                                              "Actual Rows", "Actual Loops"))
            return "\n" + "  " * depth + own + "".join(tree(child, depth + 1) for child in node.get("Plans") or [])

        assert walk(plan) < 300 and "Seq Scan" not in kinds(plan), text + tree(plan)


def test_the_index_plan_keeps_short_categories_and_bounded_columns_and_skips_free_text_and_unbounded_types(agent_ns):
    column = agent_ns["implement_lakebase_column"]
    copy = {"key": "k", "pg": "s.t", "columns": [column(n, t) for n, t in (("rank", "int"), ("label", "string"), ("record_key", "string"),
                                                                             ("blob", "binary"), ("tags", "array<string>"),
                                                                             ("notes", "string"))]}
    wanted = [(copy, ("record_key",)), (copy, ("rank", "record_key")), (copy, ("label", "record_key")), (copy, ("blob",)),
              (copy, ("tags",)), (copy, ("notes", "record_key"))]
    planned, skipped = agent_ns["implement_lakebase_index_plan"](wanted, {"k": {"label": 40, "record_key": 3000, "notes": 257}})
    assert [kept for _c, kept in planned] == [[("rank", "plain")], [("label", "prefix")]], \
        "a key longer than a short category is indexed nowhere, and a composite index stops before it"
    whys = {name: why for _c, name, why in skipped}
    assert set(whys) == {"record_key", "blob", "tags", "notes"}
    assert whys["record_key"].startswith("it holds values of up to 3,000 bytes, so it is free text")
    assert whys["notes"].startswith("it holds values of up to 257 bytes, so it is free text")
    assert whys["blob"].startswith("its type BINARY has no bounded size") and whys["tags"].startswith("its type ARRAY")
    planned, skipped = agent_ns["implement_lakebase_index_plan"](wanted, {"k": {"label": 40, "record_key": 36, "notes": 256}})
    assert [kept for _c, kept in planned] == [[("record_key", "prefix")], [("rank", "plain"), ("record_key", "prefix")],
                                             [("label", "prefix"), ("record_key", "prefix")], [("notes", "prefix"), ("record_key", "prefix")]]
    assert {name for _c, name, _w in skipped} == {"blob", "tags"}
    planned, skipped = agent_ns["implement_lakebase_index_plan"](wanted, {"k": None})
    assert [kept for _c, kept in planned] == [[("rank", "plain")]]
    assert all(why == "Inspire could not read how long its values are" for _c, n, why in skipped if n in ("record_key", "label", "notes"))


def test_a_build_that_cannot_reach_lakebase_or_indexes_nothing_says_so_and_claims_none(agent_ns, bills):
    inst = _inspire(agent_ns, FakeSpark())
    inst.logger = CapturingLogger()
    inst._implement_lakebase_connection = lambda env: (_ for _ in ()).throw(RuntimeError("connection refused"))
    assert inst._implement_lakebase_indexes("N01-U01", {}, [_copy(agent_ns)], [PAGE], shell_sql) == {}
    assert any(level == "WARNING" and "keep no index, because Inspire could not reach their database" in m
               for level, m in inst.logger.records)
    only_text = dict(PAGE, filters=[], tables=[{"id": "bills", "dataset": "bill_activity", "columns": [{"column": "notes", "format": "text"}]}])
    inst = _inspire(agent_ns, FakeSpark())
    inst.logger = CapturingLogger()
    inst._implement_api = lambda method, path, body=None, query=None: {"token": "local"}
    assert inst._implement_lakebase_indexes("N01-U01", _env(bills), [_copy(agent_ns)], [only_text], shell_sql) == {}
    said = [m for level, m in inst.logger.records if level == "WARNING" and "[IMPLEMENT-LAKEBASE]" in m]
    assert len(said) == 1 and "keep no index" in said[0] and "Not indexed: notes of rf_ix.n01_u01__d_bill_activity_x, because it " \
                                                              "holds values of up to 3,200 bytes" in said[0], said


def test_a_backend_naming_a_prefixed_column_it_lacks_or_a_bad_length_is_refused():
    columns = [{"name": "district", "type": "STRING"}, {"name": shell_pg.ROW_COLUMN, "type": "LONG"}]
    good = {"kind": "lakebase", "pipeline_id": "p", "datasets": {}, "tables": {UC_VIEW: {"pg": "s.t", "columns": columns,
                                                                                         "prefixed": {"district": 256}}}}
    assert shell_pg.backend_problems(good, "sp", []) == []
    for prefixed in ({"nope": 256}, {"district": 0}, {"district": "256"}, {"district": True}, ["district"]):
        bad = json.loads(json.dumps(good))
        bad["tables"][UC_VIEW]["prefixed"] = prefixed
        assert any("must name as prefixed only its own columns" in p for p in shell_pg.backend_problems(bad, "sp", [])), prefixed


PROBLEM = "page n01_u01: filter district reads its values from bill_activity, which holds many rows per record"
SINGLE = "page n01_u01: 2 segment filters offer 2 or more values; region (North) offer one, so they slice nothing"
CAUSED = "page n01_u01: the Impact page failed: TABLE_OR_VIEW_NOT_FOUND"


def _redeploy(agent_ns, tmp_path, new, held, lakebase_problems=(), work_name="app_restyle"):
    payload, modules = _app_shell(agent_ns, tmp_path)
    core = modules["shell_core"]
    inst = _inspire(agent_ns, FakeSpark())
    inst.logger = CapturingLogger()
    inst.local_log_output_dir = str(tmp_path)
    checks, deployed = [], []

    def check(work, files, modules, warehouse):
        look = json.loads(files[core.SETTINGS_FILE]).get("accent")
        checks.append((look, warehouse))
        inst._implement_app_speeds = {"look": look}
        return list(new if look == "new" else held)

    inst._implement_app_check = check
    inst._implement_app_warehouse = lambda context: "wh-new"
    inst._implement_app_lakebase = lambda *a, **k: {"kind": "delta", "files": {}, "page_problems": list(lakebase_problems)}
    inst._implement_deploy_app = lambda *a, **k: deployed.append(a) or {"app_name": "churn-desk"}
    inst._implement_lakebase_after = lambda context, fields, lakebase: None
    page = agent_ns["implement_app_page"](_churn_page(agent_ns), "N01-U01", {}, "main.inspire.churn_out")
    base = {"version": core.SETTINGS_VERSION, "pages": [page["id"]]}
    host = {"name": "churn-desk", "settings": dict(base, accent="old"), "pages": [page],
            "app": {"resources": [{"name": "sql-warehouse", "sql_warehouse": {"id": "wh-old", "permission": "CAN_USE"}}]}}
    out = inst._implement_app_redeploy(_output_context(agent_ns), host, dict(base, accent="new"), [page], payload, modules, work_name, "")
    return inst, out, checks, deployed


@pytest.mark.parametrize("work_name", ["app_restyle", "app_repoint"])
def test_a_redeploy_keeps_a_saved_page_whose_problems_it_already_had_and_says_so(agent_ns, tmp_path, work_name):
    later = SINGLE.replace("2 segment", "1 segment")
    inst, (fields, problems, _lakebase), checks, deployed = _redeploy(agent_ns, tmp_path, [PROBLEM, later], [PROBLEM, SINGLE],
                                                                      work_name=work_name)
    assert problems == [] and len(deployed) == 1, "the redeploy changed nothing these problems come from, so no Genie rebuild"
    assert [c[0] for c in checks] == ["new", "old"] and checks[1][1] == "wh-old", "the saved pages are checked as they are deployed"
    assert inst._implement_app_speeds == {"look": "new"}, "the speed of the redeployed App is the one reported"
    warned = [w for w in fields["_warnings"] if w.startswith("App: this redeploy kept 2 problems its pages already had; a rebuild of")]
    assert len(warned) == 1 and PROBLEM in warned[0] and later in warned[0], fields["_warnings"]
    assert any("[REDEPLOY-KEPT-PROBLEMS FIRED]" in m for _level, m in inst.logger.records)


def test_a_redeploy_that_causes_a_new_problem_still_sends_the_pages_back(agent_ns, tmp_path):
    _inst, (fields, problems, _lakebase), checks, deployed = _redeploy(agent_ns, tmp_path, [PROBLEM, CAUSED], [PROBLEM])
    assert (fields, problems) == (None, [CAUSED]) and deployed == [] and len(checks) == 2


def test_a_redeploy_with_no_problem_checks_once_and_a_lakebase_page_problem_is_judged_the_same_way(agent_ns, tmp_path):
    _inst, (fields, problems, _lakebase), checks, deployed = _redeploy(agent_ns, tmp_path, [], [PROBLEM])
    assert problems == [] and len(deployed) == 1 and len(checks) == 1 and "_warnings" not in fields
    _inst, (fields, problems, _lakebase), checks, deployed = _redeploy(agent_ns, tmp_path / "kept", [], [PROBLEM], [PROBLEM])
    assert problems == [] and len(deployed) == 1 and len(checks) == 2
    _inst, (fields, problems, _lakebase), _checks, deployed = _redeploy(agent_ns, tmp_path / "new", [], [], [CAUSED])
    assert (fields, problems) == (None, [CAUSED]) and deployed == []


def test_a_new_build_still_fails_on_every_problem_the_checks_find(agent_ns, tmp_path):
    payload, modules = _app_shell(agent_ns, tmp_path)
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_app_check = lambda work, files, modules, warehouse: [PROBLEM]
    inst._implement_app_warehouse = lambda context: "wh1"
    page = agent_ns["implement_app_page"](_churn_page(agent_ns), "N01-U01", {}, "main.inspire.churn_out")
    with pytest.raises(Exception) as raised:
        inst._implement_page_check(_output_context(agent_ns), "App", str(tmp_path / "w"), {}, modules, page)
    assert PROBLEM in str(raised.value)


def _fanned_page(result=RESULT):
    page = json.loads(json.dumps(_live_page()).replace(RESULT, result))
    reasons = f"{result}_reasons"
    page["datasets"].append({"name": "reasons", "sql": f"SELECT r.reason, b.district FROM {reasons} AS r JOIN {result} AS o ON "
                                                       f"o.record_key = r.record_key JOIN {BILLS} AS b ON CAST(b.bill_id AS STRING) = "
                                                       "o.entity_id"})
    page["charts"].append({"id": "by_reason", "title": "Reasons", "hint": "Most first.", "type": "bar", "dataset": "reasons",
                           "x": {"column": "reason", "kind": "category", "label": "Reason"},
                           "y": [{"label": "Reasons", "expression": "COUNT(DISTINCT reason)", "format": "number"}]})
    page["filters"][2]["columns"] = {"reasons": "district", "bill_activity": "district"}
    return page, reasons


def test_genies_page_check_finds_the_fan_out_filter_problem_the_notebook_rejects(agent_ns, tmp_path):
    payload, modules = _app_shell(agent_ns, tmp_path / "shell")
    page, reasons = _fanned_page()
    many = agent_ns["implement_page_many_sides"](RESULT)
    rejected = agent_ns["implement_app_page_problems"](page, modules["shell_sql"], [RESULT, BILLS, POINTS, reasons], False, many=many)
    wanted = _skipped("district", "reasons, bill_activity")
    assert wanted in rejected
    work = tmp_path / "work_check"
    agent_ns["implement_write_files"](str(work), agent_ns["implement_app_check_files"](payload["files"], False, [], many))
    (work / "page.json").write_text(json.dumps(page))
    done = subprocess.run([sys.executable, str(work / ".inspire_check" / "check_page.py")], cwd=str(tmp_path), capture_output=True,
                          text=True, timeout=60)
    assert done.returncode == 1 and wanted in done.stdout.splitlines(), done.stdout
    shown = [p for p in done.stdout.splitlines() if "reads its values from" in p]
    assert shown == [p for p in rejected if "reads its values from" in p], "Genie's check and the notebook name the same filters"


def test_genies_page_check_reads_the_many_side_tables_of_the_use_case(agent_ns, tmp_path):
    from v140_implement_test import _app_flow
    inst, context, seen = _app_flow(agent_ns, tmp_path, assets={"genie_space": "g1"})
    inst._implement_input_has_dates = lambda context: True
    inst._implement_app(context, None)
    work = tmp_path / "genie_work"
    agent_ns["implement_write_files"](str(work), seen["tools"])
    (work / "page.json").write_text(json.dumps(_fanned_page(context["result_table"])[0]))
    done = subprocess.run([sys.executable, str(work / ".inspire_check" / "check_page.py")], cwd=str(work), capture_output=True,
                          text=True, timeout=60)
    assert _skipped("district", "reasons, bill_activity") in done.stdout.splitlines(), done.stdout


def test_the_app_check_has_one_way_to_read_its_problems():
    assert not hasattr(shell_core.Shell, "check_split")
    assert hasattr(shell_core.Shell, "check") and hasattr(shell_core.Shell, "checked")


def test_the_notebook_and_the_check_script_share_one_fan_out_rule(agent_ns):
    page, _reasons = _fanned_page()
    many = agent_ns["implement_page_many_sides"](RESULT)
    facts = agent_ns["inspire_shell_facts"]
    assert agent_ns["implement_page_fanning"](page, many) == facts.fanning_datasets(page, [agent_ns["implement_table_leaf"](m)
                                                                                           for m in many])
    assert set(agent_ns["implement_page_fanning"](page, many)) == {"reasons"}
    exploded = {"datasets": [{"name": "x", "sql": "SELECT explode(tags) AS t FROM main.s.t"}, {"name": "y", "sql": "SELECT 1"}]}
    assert set(facts.fanning_datasets(exploded, [])) == {"x"}


SORTED = "n01_u02__d_bills_y"
SORTED_VIEW = "main.inspire.rt__lb_bills"
E256, E257, A256, A257 = "E" * 256, "E" * 257, "A" * 256, "A" * 257
PAGE2 = {"id": "n01_u02", "datasets": [{"name": "bills", "sql": "SELECT 1"}],
         "filters": [{"id": "district", "type": "multi_select", "label": "District", "columns": {"bills": "district"}}],
         "tables": [{"id": "bills", "dataset": "bills", "limit": 20, "sort": {"column": "service_type", "desc": False},
                     "columns": [{"column": "district", "format": "text"}, {"column": "service_type", "format": "text"},
                                 {"column": "label", "format": "text"}, {"column": "amount"}]}]}


def _sorted_copy(agent_ns):
    column = agent_ns["implement_lakebase_column"]
    return {"page": "n01_u02", "dataset": "bills", "key": SORTED_VIEW, "pg": f"{IX_SCHEMA}.{SORTED}",
            "columns": [column(n, t) for n, t in (("district", "string"), ("service_type", "string"), ("label", "string"),
                                                   ("amount", "double"), (shell_pg.ROW_COLUMN, "bigint"))]}


@pytest.fixture(scope="module")
def sorted_bills(bills, agent_ns):
    with _connect(bills) as conn, conn.cursor() as cur:
        cur.execute(f'CREATE TABLE "{IX_SCHEMA}"."{SORTED}" (district text, service_type text, label text COLLATE "und-x-icu", '
                    f'amount double precision, "{shell_pg.ROW_COLUMN}" bigint)')
        cur.execute(f'INSERT INTO "{IX_SCHEMA}"."{SORTED}" SELECT \'D\' || lpad((i % 2000)::text, 4, \'0\'), '
                    f"'S' || lpad((i % 3000)::text, 4, '0'), 'L' || (i % 50), i * 0.5, i FROM generate_series(1, {IX_ROWS}) AS i")
        cur.execute(f'INSERT INTO "{IX_SCHEMA}"."{SORTED}" SELECT %s, %s, \'L0\', 1.0, {IX_ROWS} + g FROM generate_series(1, 5) AS g',
                    (E256, A256))
    inst, indexed = _built_on(agent_ns, bills, _sorted_copy(agent_ns), PAGE2)
    with _connect(bills) as conn, conn.cursor() as cur:
        cur.execute(f'INSERT INTO "{IX_SCHEMA}"."{SORTED}" SELECT %s, %s, \'L1\', 2.0, {IX_ROWS} + 10 + g FROM generate_series(1, 5) AS g',
                    (E257, A257))
        cur.execute(f'INSERT INTO "{IX_SCHEMA}"."{SORTED}" SELECT NULL, NULL, NULL, 3.0, {IX_ROWS} + 20 + g FROM generate_series(1, 5) AS g')
        cur.execute(f'ANALYZE "{IX_SCHEMA}"."{SORTED}"')
    return inst, indexed


def _built_on(agent_ns, postgres, copy, page):  # noqa: F811
    inst = _inspire(agent_ns, FakeSpark())
    inst.logger = CapturingLogger()
    inst._implement_api = lambda method, path, body=None, query=None: {"token": "local"}
    return inst, inst._implement_lakebase_indexes("N01-U02", _env(postgres), [copy], [page], shell_sql)


def _served2(agent_ns, indexed):
    backend = agent_ns["implement_lakebase_backend"]("pipe-2", [_sorted_copy(agent_ns)], indexed)
    assert shell_pg.backend_problems(backend, "sp", [PAGE2]) == []
    return shell_pg.served_page(PAGE2, backend), {shell_pg.uc_key(k): v for k, v in backend["tables"].items()}


def _plan(postgres, text, values):  # noqa: F811
    with _connect(postgres) as conn, conn.cursor() as cur:
        cur.execute("EXPLAIN (ANALYZE, FORMAT JSON) " + text, values)
        plan = cur.fetchone()[0][0]["Plan"]
        cur.execute(text, values)
        return plan, cur.fetchall()


def _read(node):
    own = _examined(node) if node.get("Relation Name") == SORTED else 0
    return own + sum(_read(child) for child in node.get("Plans") or [])


def _ran(node):
    return ({node.get("Node Type")} if node.get("Actual Loops") else set()) | {k for c in node.get("Plans") or [] for k in _ran(c)}


def test_the_build_records_which_prefixed_columns_sort_by_code_point_and_says_which_sorts_read_every_row(agent_ns, sorted_bills):
    inst, indexed = sorted_bills
    assert indexed == {SORTED_VIEW: {"prefixed": {"district": 256, "service_type": 256, "label": 256},
                                     "prefix_ordered": ["district", "service_type"]}}, \
        "the label column sorts by language rules, so an index on its first characters cannot serve its sort"
    said = [m for _level, m in inst.logger.records if "[IMPLEMENT-LAKEBASE]" in m]
    assert len(said) == 1 and inst.logger.records[-1][0] == "WARNING"
    assert f"A sort on label of {IX_SCHEMA}.{SORTED} reads every row, because the database orders that text by language rules" in said[0]


@pytest.mark.parametrize("picked", [["D0003", E256], [E257], [E256], ["D0003", "nope"]])
def test_a_choice_filter_on_a_prefixed_column_reads_the_index_and_returns_what_the_unindexed_query_returns(agent_ns, bills,
                                                                                                          sorted_bills, picked):
    _inst, indexed = sorted_bills
    page, held = _served2(agent_ns, indexed)
    sql, params = shell_sql.table_query(page, "bills", {"district": picked})
    text, values = shell_pg.render(sql, params, held)[:2]
    assert 'LEFT(CAST("district" AS TEXT), 256) IN (LEFT(%(p0)s, 256)' in text, text
    plan, rows = _plan(bills, text, values)
    assert _read(plan) < 100 and "Seq Scan" not in _ran(plan), text
    bare = {k: {n: v for n, v in e.items() if n not in ("prefixed", "prefix_ordered")} for k, e in held.items()}
    plain, plain_values = shell_pg.render(sql, params, bare)[:2]
    assert "LEFT(" not in plain
    plain_plan, expected = _plan(bills, plain, plain_values)
    assert _read(plain_plan) > IX_ROWS, "the same query without the prefix filter reads the whole copy"
    assert sorted(rows, key=repr) == sorted(expected, key=repr)
    assert {r[0] for r in rows} == set(picked) & {r[0] for r in expected} and None not in {r[0] for r in rows}
    if picked == [E256]:
        assert len(rows) == 5, "a value of 257 bytes that shares the first 256 is not returned"


def test_a_sort_on_a_code_point_prefixed_column_reads_the_index_in_the_same_order_including_nulls_and_long_values(agent_ns, bills,
                                                                                                                 sorted_bills):
    _inst, indexed = sorted_bills
    page, held = _served2(agent_ns, indexed)
    sql, params = shell_sql.table_query(page, "bills", {})
    text, values = shell_pg.render(sql, params, held)[:2]
    assert 'ORDER BY LEFT("service_type", 256) ASC, "service_type" ASC LIMIT 20' in text, text
    plan, rows = _plan(bills, text, values)
    assert _read(plan) < 300 and "Seq Scan" not in _ran(plan), text
    assert [r[1] for r in rows] == [A256] * 5 + [A257] * 5 + ["S0000"] * 10, "the 256-byte value sorts before the 257-byte one"
    bare = {k: {n: v for n, v in e.items() if n not in ("prefixed", "prefix_ordered")} for k, e in held.items()}
    plain, plain_values = shell_pg.render(sql, params, bare)[:2]
    for asked in ({"key": "service_type", "dir": "asc"}, {"key": "service_type", "dir": "desc"}, {"key": "district", "dir": "desc"}):
        sql, params = shell_sql.table_query(page, "bills", {}, asked=asked)
        whole = lambda s: s.rsplit(" LIMIT ", 1)[0]
        text = whole(shell_pg.render(sql, params, held)[0])
        plain = whole(shell_pg.render(sql, params, bare)[0])
        assert text != plain
        column = 1 if asked["key"] == "service_type" else 0
        got, expected = ([r[column] for r in _plan(bills, t, values)[1]] for t in (text, plain))
        assert got == expected and got.count(None) == 5 and (got[-1] is None), asked


def test_a_sort_on_a_language_ordered_column_is_left_as_it_was(agent_ns, sorted_bills):
    _inst, indexed = sorted_bills
    page, held = _served2(agent_ns, indexed)
    sql, params = shell_sql.table_query(page, "bills", {"label": ["L1"]}, asked={"key": "label", "dir": "asc"})
    text = shell_pg.render(sql, params, held)[0]
    assert 'ORDER BY "label" ASC LIMIT 20' in text and 'LEFT("label"' not in text, text


@pytest.mark.parametrize("row,ordered", [
    (("default", "d", None, "C", "c"), True), (("default", "d", None, "C.UTF-8", "c"), True), (("default", "d", None, "POSIX", None), True),
    (("default", "d", None, "C", "b"), True), (("default", "d", None, "en_US.UTF-8", "c"), False), (("default", "d", None, "C", "i"), False),
    (("C", "c", "C", "en_US.UTF-8", "c"), True), (("ucs_basic", "b", None, "en_US.UTF-8", "c"), True),
    (("pg_c_utf8", "b", None, "en_US.UTF-8", "c"), True), (("und-x-icu", "i", None, "C", "c"), False),
    (("en_US", "c", "en_US.UTF-8", "C", "c"), False), ((None, None, None, "C", None), True)])
def test_only_a_collation_that_orders_by_code_point_lets_a_prefix_index_serve_a_sort(agent_ns, row, ordered):
    assert agent_ns["implement_lakebase_byte_ordered"](*row) is ordered


def test_the_prefix_rewrite_never_changes_what_a_query_means():
    tables = {"main.s.t": {"pg": "s.t", "columns": [{"name": "d", "type": "STRING"}, {"name": "n", "type": "INT"}],
                           "prefixed": {"d": 256}, "prefix_ordered": ["d"]}}
    render = lambda sql: shell_pg.render(sql, [], tables)[0]
    assert "LEFT" not in render("SELECT DISTINCT d FROM main.s.t ORDER BY d"), "SELECT DISTINCT may only sort on what it shows"
    assert "LEFT" not in render("SELECT n AS d FROM main.s.t ORDER BY d"), "the sort names a shown alias, not the column"
    assert render("SELECT d FROM main.s.t ORDER BY d").endswith('ORDER BY LEFT("d", 256) NULLS FIRST, "d" NULLS FIRST'), \
        "each sort term keeps where its nulls go"
    assert render("SELECT d FROM main.s.t ORDER BY d DESC NULLS LAST").endswith('ORDER BY LEFT("d", 256) DESC NULLS LAST, "d" DESC NULLS LAST')
    assert "LEFT" not in render("SELECT d FROM main.s.t UNION SELECT d FROM main.s.t ORDER BY d")
    assert "LEFT" not in render("SELECT d FROM main.s.t WHERE n = 3 ORDER BY n"), "a number is neither cut nor sorted on its text"
    assert "LEFT" not in render("SELECT COUNT(*) OVER (ORDER BY d) FROM main.s.t"), "a window keeps its own order"
    assert "LEFT" not in render("SELECT d FROM main.s.t WHERE d IN (SELECT d FROM main.s.t)")
    assert "LEFT" not in render("SELECT d FROM main.s.t AS a JOIN main.s.t AS b ON a.d = 'x'"), "only a WHERE filter is rewritten"
    negated = render("SELECT d FROM main.s.t WHERE NOT d IN ('a', 'b')")
    assert "NOT (\"d\" IN ('a', 'b') AND LEFT(\"d\", 256) IN (LEFT('a', 256), LEFT('b', 256)))" in negated, negated
    unordered = dict(tables["main.s.t"], prefix_ordered=[])
    assert "LEFT" not in shell_pg.render("SELECT d FROM main.s.t ORDER BY d", [], {"main.s.t": unordered})[0]


def test_the_prefix_rewrite_is_exact_on_postgres_for_nulls_and_lists_that_hold_null(bills):
    values = [None, "", "x", E256, E257, A256 + "b", A257]
    picks = ["x", E256, A257, None]
    with _connect(bills) as conn, conn.cursor() as cur:
        for v in values:
            plain = [None if p is None else p for p in picks]
            cur.execute("SELECT %s IN (%s, %s, %s, %s), (%s IN (%s, %s, %s, %s) AND left(%s, 256) IN (left(%s, 256), left(%s, 256), "
                        "left(%s, 256), left(%s, 256))), NOT %s IN (%s, %s, %s, %s), NOT (%s IN (%s, %s, %s, %s) AND left(%s, 256) IN "
                        "(left(%s, 256), left(%s, 256), left(%s, 256), left(%s, 256)))",
                        [v, *plain, v, *plain, v, *plain, v, *plain, v, *plain, v, *plain])
            a, b, c, d = cur.fetchone()
            assert (a, c) == (b, d), (v, a, b, c, d)
