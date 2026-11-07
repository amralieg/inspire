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
    assert indexed == {UC_VIEW: {"indexed": ["bill_date"], "prefixed": {"district": 256, "service_type": 256}}}, \
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
            own = node.get("Actual Rows", 0) * node.get("Actual Loops", 1) if node.get("Relation Name") == IX_TABLE else 0
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
