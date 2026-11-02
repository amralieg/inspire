import contextlib
import copy
import datetime
import decimal
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
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
import shell_sql  # noqa: E402
from v141_app_shell_test import PAGE, SETTINGS, FakeWorkspace, app_dir, call  # noqa: E402
from v142_edits_test import COLUMNS, EDITOR, MODIFY, TABLE, TableWorkspace, edit_body, edit_page  # noqa: E402

UTC = datetime.timezone.utc
TREND_VIEW = "main.pricing_lb.n01_u05__trend"
RECORDS_VIEW = "main.pricing_lb.n01_u05__records"
PG_SCHEMA = "n01_u05_app"
ROW = {"name": shell_pg.ROW_COLUMN, "type": "LONG", "type_text": "BIGINT"}
TREND_COLUMNS = [{"name": n, "type": t, "type_text": t} for n, t in (
    ("as_of_date", "DATE"), ("month", "DATE"), ("category", "STRING"), ("channel", "STRING"), ("region", "STRING"), ("loss", "DOUBLE"),
    ("revenue", "DOUBLE"), ("discounts", "DOUBLE"))]
RECORD_COLUMNS = [{"name": n, "type": t, "type_text": x} for n, t, x in (
    ("record_key", "STRING", "STRING"), ("entity_id", "LONG", "BIGINT"), ("entity_label", "STRING", "STRING"),
    ("priority_tier", "STRING", "STRING"), ("rank", "INT", "INT"), ("top_reasons", "ARRAY", "ARRAY<STRING>"),
    ("recommended_action", "STRING", "STRING"), ("value", "DECIMAL", "DECIMAL(18,2)"), ("as_of_date", "DATE", "DATE"),
    ("category", "STRING", "STRING"), ("channel", "STRING", "STRING"), ("region", "STRING", "STRING"))]
ACTION_COLUMNS = [{"name": n, "type": t, "type_text": t} for n, t in (
    ("action_owner", "STRING"), ("action_status", "STRING"), ("action_due", "DATE"), ("action_note", "STRING"),
    ("dismiss_reason", "STRING"), ("action_outcome", "STRING"), ("realized_value", "DOUBLE"), ("realized_note", "STRING"),
    ("snooze_until", "DATE"), ("action_batch", "STRING"), ("action_batch_note", "STRING"), ("action_batch_values", "STRING"),
    ("joined_at", "TIMESTAMP"), ("edited_by_person", "BOOLEAN"), ("not_listed_since", "TIMESTAMP"))]
RESULT_COLUMNS = COLUMNS + ACTION_COLUMNS
PG_ENV = {"PGHOST": "instance-1.database.example.com", "PGPORT": "5432", "PGDATABASE": "databricks_postgres", "PGUSER": "app-sp",
          "LAKEBASE_ENDPOINT": "projects/inspire-apps/branches/production/endpoints/primary", "DATABRICKS_WAREHOUSE_ID": "wh1",
          "DATABRICKS_HOST": "dbc-1.example.com"}
NOW = 1_830_000_000.0


def backend(result_table=False, datasets=("trend", "records")):
    tables = {}
    if "trend" in datasets:
        tables[TREND_VIEW] = {"pg": f"{PG_SCHEMA}.n01_u05__trend", "columns": TREND_COLUMNS + [ROW]}
    if "records" in datasets:
        tables[RECORDS_VIEW] = {"pg": f"{PG_SCHEMA}.n01_u05__records", "columns": RECORD_COLUMNS + [ROW]}
    if result_table:
        tables[TABLE] = {"pg": f"{PG_SCHEMA}.loss_desk_out", "columns": RESULT_COLUMNS + [ROW]}
    views = {"trend": TREND_VIEW, "records": RECORDS_VIEW}
    return {"kind": "lakebase", "pipeline_id": "pipeline-1", "tables": tables,
            "datasets": {"n01_u05": {d: views[d] for d in datasets}}}


def held_tables():
    return {shell_pg.uc_key(k): v for k, v in backend(True)["tables"].items()}


class RenderingLakebase:
    def __init__(self, settings_backend, env, service, answers=None):
        self.tables = {shell_pg.uc_key(k): v for k, v in settings_backend["tables"].items()}
        self.answers = answers if answers is not None else FakeWorkspace()
        self.rendered, self.held, self.writes, self.plans, self.fail, self.note = [], set(), [], [], None, ""

    def run(self, sql, params, limit):
        text, _values, _read = shell_pg.render(sql, params, self.tables, self.held)
        self.rendered.append(text)
        if self.fail:
            raise self.fail
        return self.answers.run_sql("lakebase", sql, params, limit)

    def noted(self, text):
        self.note = text

    def pending(self):
        return bool(self.held)

    def status(self):
        return {"note": self.note, "catching_up": bool(self.held), "synced_at": "2026-10-28T01:00:00Z"}

    def wrote(self, keys, plan=None, fetch=None):
        self.writes.append(set(keys))
        self.plans.append(plan)
        self.held |= set(keys)


def lakebase_shell(tmp_path, settings=None, pages=None, ws=None, answers=None, strict=False):
    ws = ws if ws is not None else FakeWorkspace()
    made = []

    def factory(settings_backend, env, service):
        made.append(RenderingLakebase(settings_backend, env, service, answers))
        return made[-1]

    s = shell_core.Shell(app_dir(tmp_path, settings or dict(SETTINGS, backend=backend()), pages), env=dict(PG_ENV),
                         sp_factory=lambda: ws, user_factory=lambda host, token: ws, lakebase_factory=factory, strict=strict)
    return s, ws, made[0] if made else None


def test_render_reads_the_postgres_copy_with_psycopg_parameters():
    sql = ("SELECT d.`category`, SUM(d.loss) AS v FROM (SELECT `as_of_date`, `category`, `loss` FROM `main`.`pricing_lb`.`n01_u05__trend`) "
           "AS d WHERE CAST(d.`as_of_date` AS DATE) BETWEEN :p0 AND :p1 AND CAST(d.`category` AS STRING) IN (:p2) GROUP BY 1 "
           "ORDER BY v DESC LIMIT 5")
    params = [{"name": "p0", "value": "2026-01-01", "type": "DATE"}, {"name": "p1", "value": "2026-10-01", "type": "DATE"},
              {"name": "p2", "value": "Books", "type": "STRING"}]
    text, values, read = shell_pg.render(sql, params, held_tables())
    assert '"n01_u05_app"."n01_u05__trend"' in text and "`" not in text and "pricing_lb" not in text
    assert "%(p0)s" in text and "%(p1)s" in text and "%(p2)s" in text and ":p0" not in text
    assert values == {"p0": datetime.date(2026, 1, 1), "p1": datetime.date(2026, 10, 1), "p2": "Books"}
    assert read == {TREND_VIEW}


def test_render_types_every_parameter_the_shell_sends():
    params = [{"name": "a", "value": "7", "type": "BIGINT"}, {"name": "b", "value": "2.5", "type": "DOUBLE"},
              {"name": "c", "value": "12.50", "type": "DECIMAL(18,2)"}, {"name": "d", "value": "true", "type": "BOOLEAN"},
              {"name": "e", "value": None, "type": "STRING"}, {"name": "f", "value": "x"}]
    _text, values, _read = shell_pg.render(f"SELECT 1 FROM {TREND_VIEW}", params, held_tables())
    assert values == {"a": 7, "b": 2.5, "c": decimal.Decimal("12.50"), "d": True, "e": None, "f": "x"}


def test_render_refuses_what_lakebase_does_not_hold_or_what_changed_since_its_sync():
    with pytest.raises(shell_pg.NotServed, match="main.pricing.items has no copy in Lakebase"):
        shell_pg.render(f"SELECT * FROM {TREND_VIEW} AS t JOIN main.pricing.items AS i ON i.item_id = t.category", [], held_tables())
    with pytest.raises(shell_pg.NotServed, match="main.pricing.loss_desk_out changed after Lakebase last synced it"):
        shell_pg.render(f"SELECT * FROM {TABLE}", [], held_tables(), held={TABLE})
    with pytest.raises(shell_pg.NotServed, match="pricing.items has no copy in Lakebase"):
        shell_pg.render("SELECT * FROM pricing.items", [], held_tables())
    with pytest.raises(shell_pg.NotServed, match="not one Lakebase can read"):
        shell_pg.render("SELECT FROM WHERE (", [], held_tables())
    text, _values, read = shell_pg.render(f"WITH x AS (SELECT loss FROM {TREND_VIEW}) SELECT SUM(loss) AS v FROM x", [], held_tables())
    assert read == {TREND_VIEW} and 'FROM "x"' in text


def test_render_reads_a_copy_that_carries_the_row_key_through_its_own_columns_only():
    names = ", ".join(f'"{c["name"]}"' for c in RESULT_COLUMNS)
    text, _values, read = shell_pg.render(f"SELECT o.*, run_id FROM {TABLE} AS o WHERE o.record_key = :k",
                                          [{"name": "k", "value": "5"}], held_tables())
    assert f'FROM (SELECT {names} FROM "{PG_SCHEMA}"."loss_desk_out") AS "o"' in text and shell_pg.ROW_COLUMN not in text
    text, _values, _read = shell_pg.render(f"SELECT COUNT(*) AS n FROM {TABLE} WHERE loss_desk_out.is_current", [], held_tables())
    assert f'FROM (SELECT {names} FROM "{PG_SCHEMA}"."loss_desk_out") AS "loss_desk_out"' in text
    assert read == {TABLE}
    tables = {shell_pg.uc_key(TABLE): {"pg": f"{PG_SCHEMA}.loss_desk_out", "columns": RESULT_COLUMNS}}
    text, _values, read = shell_pg.render(f"SELECT * FROM {TABLE} AS o", [], tables)
    assert f'FROM "{PG_SCHEMA}"."loss_desk_out" AS "o"' in text and "SELECT *" in text and read == {TABLE}


def test_render_escapes_every_percent_sign_psycopg_would_read_as_a_placeholder():
    text, _values, _read = shell_pg.render(f"SELECT 'a%b' AS s, 7 % 3 AS m, `loss` AS `pct%` FROM {TREND_VIEW}", [], held_tables())
    assert "'a%%b'" in text and "7 %% 3" in text and '"pct%%"' in text
    assert text.replace("%%", "").count("%") == 0


def test_render_writes_the_spark_functions_the_shell_uses_in_postgres():
    sql = (f"SELECT COUNT_IF(loss > 1) AS c, CAST(unix_micros(TIMESTAMP '2026-10-15 06:00:00') AS STRING) AS us, "
           f"IF(SUM(loss) > 0, 'y', 'n') AS f FROM {TREND_VIEW}")
    text, _values, _read = shell_pg.render(sql, [], held_tables())
    assert "EXTRACT(EPOCH FROM" in text and "COUNT_IF" not in text.upper() and "unix_micros" not in text.lower()
    text, _values, _read = shell_pg.render(
        f"SELECT * FROM (SELECT category, loss FROM {TREND_VIEW}) QUALIFY ROW_NUMBER() OVER (PARTITION BY category ORDER BY loss) = 1",
        [], held_tables())
    assert "QUALIFY" not in text.upper() and "ROW_NUMBER() OVER" in text
    text, _values, _read = shell_pg.render(
        f"SELECT p.category FROM {TREND_VIEW} AS p LEFT ANTI JOIN {TREND_VIEW} AS c ON c.category = p.category", [], held_tables())
    assert "ANTI" not in text.upper() and "NOT EXISTS" in text.upper()


@pytest.mark.parametrize("expression,named", [
    ("hash(category)", "HASH"), ("xxhash64(category)", "XXHASH64"), ("first(category)", "FIRST"), ("current_user()", "CURRENT_USER"),
    ("rand()", "RAND"), ("ai_query('m', category)", "AI_QUERY"), ("to_json(named_struct('a', category))", "TO_JSON"),
    ("months_between(month, as_of_date)", "MONTHS_BETWEEN")])
def test_render_refuses_every_spark_function_it_cannot_run_and_names_it(expression, named):
    with pytest.raises(shell_pg.NotServed, match=rf"the query uses {named}\b.*which Lakebase cannot run"):
        shell_pg.render(f"SELECT {expression} AS x FROM {TREND_VIEW}", [], held_tables())


@pytest.mark.parametrize("expression,reason", [
    ("unix_timestamp(category, 'yyyy')", "reads a time with the format"), ("trunc(month, 'FORTNIGHT')", "truncates dates to fortnight"),
    ("regexp_extract(category, 'a', 0)", "whole match"), ("timestampdiff(MILLISECOND, month, as_of_date)", "counts millisecond"),
    ("dateadd(MILLISECOND, 1, month)", "adds millisecond"), ("from_json(category)", "without naming its type"),
    ("from_json(category, 'STRING')", "reads JSON as STRING")])
def test_render_refuses_forms_of_served_functions_that_postgres_cannot_match(expression, reason):
    with pytest.raises(shell_pg.NotServed, match=reason):
        shell_pg.render(f"SELECT {expression} AS x FROM {TREND_VIEW}", [], held_tables())


def test_render_keeps_date_formats_intact_while_escaping_percent_signs_for_psycopg():
    text, _values, _read = shell_pg.render(
        f"SELECT date_format(month, 'yyyy-MM') AS m, unix_timestamp(as_of_date) AS u, 'a%b' AS s FROM {TREND_VIEW} WHERE category LIKE '%o%'",
        [], held_tables())
    assert "'YYYY-MM'" in text and "%Y" not in text and "%%Y" not in text and "%(" not in text
    assert "'a%%b'" in text and "LIKE '%%o%%'" in text


def test_render_shows_saved_rows_on_top_of_the_copy_and_keeps_every_other_row():
    overlays = {TABLE: {"column": "record_key", "keys": ["42", "5"], "rows": [{"record_key": "42", "value": 7.5, "top_reasons": ["a"]}]}}
    text, values, read = shell_pg.render(f"SELECT o.record_key FROM {TABLE} AS o JOIN {TREND_VIEW} AS t ON t.category = o.record_key",
                                         [{"name": "p0", "value": "x"}], held_tables(), overlays=overlays)
    assert read == {TABLE, TREND_VIEW}
    assert ('FROM "n01_u05_app"."loss_desk_out" AS "_c" WHERE NOT EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS_TEXT(CAST(%(_lb_keys_0)s AS JSONB))'
            in text)
    assert 'UNION ALL SELECT' in text and 'JSONB_TO_RECORDSET(CAST(%(_lb_rows_0)s AS JSONB)) AS "_o"(' in text and ') AS "o"' in text
    assert '"value" DECIMAL(18, 2)' in text and '"top_reasons" JSONB' in text and '"valid_from" TIMESTAMPTZ' in text
    assert shell_pg.ROW_COLUMN not in text and 'FROM "n01_u05_app"."n01_u05__trend") AS "t"' in text
    assert json.loads(values["_lb_keys_0"]) == ["42", "5"] and json.loads(values["_lb_rows_0"])[0]["top_reasons"] == ["a"]
    assert values["p0"] == "x"
    with pytest.raises(shell_pg.NotServed, match="cannot be shown on top of Lakebase"):
        shell_pg.render(f"SELECT 1 FROM {TABLE}", [], held_tables(),
                        overlays={TABLE: {"column": "record_key", "keys": ["1"], "rows": [{"value": float("nan")}]}})


def test_render_names_a_copy_it_reads_whole_after_its_table_so_qualified_columns_still_resolve():
    tables = {shell_pg.uc_key(TABLE): {"pg": f"{PG_SCHEMA}.loss_desk_out_1a2b3c4d", "columns": RESULT_COLUMNS}}
    text, _values, _read = shell_pg.render(f"SELECT loss_desk_out.record_key FROM {TABLE}", [], tables)
    assert f'FROM "{PG_SCHEMA}"."loss_desk_out_1a2b3c4d" AS "loss_desk_out"' in text


def test_backend_problems_accept_a_whole_backend_and_name_every_broken_part():
    pages = [edit_page()]
    assert shell_pg.backend_problems(backend(True), "sp", pages) == []
    assert shell_pg.backend_problems({"kind": "delta"}, "user", pages) == []
    assert shell_pg.backend_problems({"kind": "postgres"}, "sp", pages) == [
        "the App backend must be an object whose kind is one of lakebase, delta"]
    assert shell_pg.backend_problems(None, "sp", pages)
    assert any("only an App that reads through its service principal" in p for p in shell_pg.backend_problems(backend(True), "user", pages))
    broken = copy.deepcopy(backend(True))
    broken["pipeline_id"] = "x y"
    broken["tables"]["main.bad"] = {"pg": "s.t", "columns": [{"name": "a", "type": "STRING"}]}
    broken["tables"][TREND_VIEW]["pg"] = "n01-u05.trend"
    broken["tables"][RECORDS_VIEW]["columns"] = [{"name": "", "type": "STRING"}]
    broken["datasets"]["other_page"] = {"trend": TREND_VIEW}
    broken["datasets"]["n01_u05"]["missing"] = TREND_VIEW
    broken["datasets"]["n01_u05"]["trend"] = "main.pricing_lb.not_synced"
    problems = shell_pg.backend_problems(broken, "sp", pages)
    assert problems == [
        "the Lakebase backend needs pipeline_id, the id of the pipeline that syncs its tables",
        f"the Lakebase copy of {TREND_VIEW} must be a Postgres schema.table of letters, digits and underscores",
        f"the Lakebase copy of {RECORDS_VIEW} must list its columns with their Unity Catalog types",
        "the Lakebase backend holds 'main.bad' is not a catalog.schema.table name",
        "page n01_u05 dataset trend reads main.pricing_lb.not_synced, which the Lakebase backend does not hold",
        "the Lakebase backend names dataset missing of page n01_u05, which the page does not have",
        "the Lakebase backend names datasets of page other_page, which the App does not have"]
    assert shell_pg.backend_problems(dict(backend(), tables={}, datasets=None), "sp", pages) == [
        "the Lakebase backend needs tables: each Unity Catalog table or view it holds, with its Postgres table and columns",
        "the Lakebase backend needs datasets: for each page, the view behind each of its datasets"]


def test_settings_refuse_a_lakebase_app_that_reads_as_each_viewer(tmp_path):
    good = dict(SETTINGS, backend=backend())
    assert shell_core.settings_problems(good, [PAGE]) == []
    assert any("only an App that reads through its service principal" in p
               for p in shell_core.settings_problems(dict(good, auth="user"), [PAGE]))
    with pytest.raises(ValueError, match="do not hold together"):
        shell_core.load_app(app_dir(tmp_path, dict(good, backend={"kind": "lakebase"})))


def test_served_page_reads_each_dataset_from_its_synced_view_without_the_row_column():
    served = shell_pg.served_page(edit_page(), backend(True))
    by_name = {d["name"]: d["sql"] for d in served["datasets"]}
    assert by_name["trend"] == ("SELECT `as_of_date`, `month`, `category`, `channel`, `region`, `loss`, `revenue`, `discounts` "
                                "FROM `main`.`pricing_lb`.`n01_u05__trend`")
    assert by_name["records"].endswith("FROM `main`.`pricing_lb`.`n01_u05__records`") and shell_pg.ROW_COLUMN not in by_name["records"]
    assert served["result_table"] == TABLE and served["kpis"] == PAGE["kpis"]
    assert shell_pg.served_page(PAGE, dict(backend(), datasets={})) is PAGE
    assert shell_pg.page_tables(edit_page(), backend(True)) == {TREND_VIEW, RECORDS_VIEW, TABLE}


def test_the_shell_reads_every_page_query_from_lakebase_and_never_the_warehouse(tmp_path):
    s, ws, lb = lakebase_shell(tmp_path)
    status, info = call(s, "GET", "app")
    assert status == 200 and info["backend"] == {"kind": "lakebase", "note": "", "catching_up": False,
                                                 "synced_at": "2026-10-28T01:00:00Z"}
    status, filters = call(s, "GET", "filters", {"page": "n01_u05"})
    assert status == 200 and not any(f.get("error") for f in filters["filters"])
    status, data = call(s, "POST", "page", body={"page": "n01_u05", "filters": {"category": ["Books"]}})
    assert status == 200 and data["errors"] == {} and data["served"] == ["lakebase"]
    status, options = call(s, "GET", "filters/options", {"page": "n01_u05", "filter": "category", "q": "mu"})
    assert status == 200 and options["options"] == ["Books", "Music"]
    assert ws.sql == [], "no query went to the warehouse"
    assert lb.rendered and all("`" not in text for text in lb.rendered)
    assert all("pricing_lb" not in text and "loss_trend" not in text for text in lb.rendered)


def test_a_lakebase_error_reads_delta_and_says_so_and_strict_mode_fails_instead(tmp_path):
    s, ws, lb = lakebase_shell(tmp_path)
    lb.fail = shell_db.QueryError('relation "n01_u05_app.n01_u05__trend" does not exist')
    status, data = call(s, "POST", "page", body={"page": "n01_u05"})
    assert status == 200 and data["errors"] == {} and data["served"] == ["delta"] and ws.sql
    assert call(s, "GET", "app")[1]["backend"]["note"] == (
        'Lakebase could not run a query, so the App read Delta tables instead: relation "n01_u05_app.n01_u05__trend" does not exist')
    (tmp_path / "strict").mkdir()
    s, ws, lb = lakebase_shell(tmp_path / "strict", strict=True)
    lb.fail = shell_db.QueryError("permission denied for schema n01_u05_app")
    status, data = call(s, "POST", "page", body={"page": "n01_u05"})
    assert status == 200 and ws.sql == [] and data["served"] == []
    assert set(data["errors"].values()) == {"Lakebase could not run it: permission denied for schema n01_u05_app"}


def test_a_dataset_lakebase_does_not_hold_reads_delta_without_a_warning(tmp_path):
    s, ws, lb = lakebase_shell(tmp_path, settings=dict(SETTINGS, backend=backend(datasets=("trend",))))
    status, data = call(s, "POST", "page", body={"page": "n01_u05"})
    assert status == 200 and data["errors"] == {} and data["served"] == ["delta", "lakebase"]
    assert any("main.pricing.loss_desk_out" in sql for sql, _p, _l in ws.sql)
    assert call(s, "GET", "app")[1]["backend"]["note"] == ""
    (tmp_path / "strict").mkdir()
    s, ws, lb = lakebase_shell(tmp_path / "strict", settings=dict(SETTINGS, backend=backend(datasets=("trend",))), strict=True)
    status, data = call(s, "POST", "page", body={"page": "n01_u05"})
    assert ws.sql == [] and data["errors"]["kpi:items"].startswith("Lakebase cannot serve it: main.pricing.loss_desk_out has no copy")


def test_an_app_without_its_postgres_resource_reads_delta_and_says_why(tmp_path):
    ws = FakeWorkspace()
    s = shell_core.Shell(app_dir(tmp_path, dict(SETTINGS, backend=backend())), env={"DATABRICKS_WAREHOUSE_ID": "wh1"},
                         sp_factory=lambda: ws, user_factory=lambda host, token: ws)
    assert s.lakebase is None and s.by_id["n01_u05"]["datasets"] == PAGE["datasets"]
    backend_info = call(s, "GET", "app")[1]["backend"]
    assert backend_info["kind"] == "delta" and backend_info["note"] == (
        "This App reads Delta tables because it could not reach Lakebase: the App has no Lakebase database to read: PGHOST, "
        "PGDATABASE, PGUSER, LAKEBASE_ENDPOINT is not set, so add its postgres resource")
    status, data = call(s, "POST", "page", body={"page": "n01_u05"})
    assert status == 200 and data["served"] == ["delta"] and ws.sql
    (tmp_path / "strict").mkdir()
    with pytest.raises(shell_pg.LakebaseError, match="PGHOST, PGDATABASE, PGUSER, LAKEBASE_ENDPOINT is not set"):
        shell_core.Shell(app_dir(tmp_path / "strict", dict(SETTINGS, backend=backend())), env={"DATABRICKS_WAREHOUSE_ID": "wh1"},
                         sp_factory=lambda: ws, user_factory=lambda h, t: ws, strict=True)


def test_a_delta_app_reports_delta_and_never_builds_lakebase(tmp_path):
    def never(*_args):
        raise AssertionError("a Delta App must not reach Lakebase")

    ws = FakeWorkspace()
    s = shell_core.Shell(app_dir(tmp_path), env=dict(PG_ENV), sp_factory=lambda: ws, user_factory=lambda h, t: ws, lakebase_factory=never)
    assert call(s, "GET", "app")[1]["backend"] == {"kind": "delta", "note": "", "catching_up": False, "synced_at": None}
    assert call(s, "POST", "page", body={"page": "n01_u05"})[1]["served"] == ["delta"]


def test_a_write_goes_to_delta_and_holds_only_the_copies_that_read_its_result_table_until_a_sync_lands(tmp_path):
    answers, ws = TableWorkspace(), TableWorkspace()
    s, ws, lb = lakebase_shell(tmp_path, settings=dict(MODIFY, backend=backend(True)), pages=[edit_page()], ws=ws, answers=answers)
    assert s.derived == {"n01_u05": {RECORDS_VIEW}}, "the trend dataset reads main.pricing.loss_trend, not the result table"
    assert call(s, "POST", "page", headers=EDITOR, body={"page": "n01_u05"})[1]["served"] == ["lakebase"]
    ws.sql.clear()
    status, out = call(s, "POST", "records/edit", headers=EDITOR, body=edit_body())
    assert status == 200, out
    assert len(ws.merges()) == 1 and any("_inspire_version" in sql for sql, _p, _l in ws.sql if not sql.startswith("MERGE"))
    assert lb.writes == [{RECORDS_VIEW, TABLE}]
    assert lb.plans == [{"result": TABLE, "keys": ["42"], "copies": {RECORDS_VIEW: "record_key"}}]
    assert call(s, "GET", "app")[1]["backend"]["catching_up"] is True
    ws.sql.clear()
    status, data = call(s, "POST", "page", headers=EDITOR, body={"page": "n01_u05"})
    assert status == 200 and data["served"] == ["delta", "lakebase"] and ws.sql, "tiles on the saved records read Delta, the trend Lakebase"
    assert all("loss_trend" not in sql for sql, _p, _l in ws.sql)
    assert data["catching_up"] is True
    lb.held.clear()
    s.cache.clear()
    status, data = call(s, "POST", "page", headers=EDITOR, body={"page": "n01_u05"})
    assert data["served"] == ["lakebase"] and data["catching_up"] is False


def test_a_dataset_whose_sql_cannot_be_read_counts_as_reading_the_result_table():
    page = edit_page(datasets=[{"name": "trend", "sql": "SELECT FROM WHERE ("}, {"name": "records", "sql": "SELECT 1 AS n"}])
    assert shell_pg.derived_copies(page, backend(True)) == {TREND_VIEW}
    assert shell_pg.derived_copies(dict(page, result_table=None), backend(True)) == set()
    assert shell_pg.page_tables(page, backend(True), {TREND_VIEW}) == {TREND_VIEW, TABLE}


def test_the_build_check_runs_the_things_to_fix_and_both_histories_on_lakebase_and_names_each_query_lakebase_cannot_serve(tmp_path):
    s, _ws, _lb = lakebase_shell(tmp_path, settings=dict(MODIFY, backend=backend(False)), pages=[edit_page()], ws=TableWorkspace(),
                                 answers=TableWorkspace(), strict=True)
    missing = "Lakebase cannot serve it: main.pricing.loss_desk_out has no copy in Lakebase"
    problems = s.check({})
    for label in ("the things to fix", "the run history"):
        assert any(p.startswith(f"page n01_u05: {label} failed: ") and missing in p for p in problems), (label, problems)
    assert not [p for p in problems if "the trend" in p], problems
    asked, listed = [], []
    s.records = lambda headers, data, probe=None: {"rows": [{"entity_id": 42}], "errors": {}}
    s.record_history = lambda headers, query: asked.append(query) or (_ for _ in ()).throw(shell_db.QueryError("Lakebase could not run it"))
    s.overview = lambda headers, data: listed.append(data) or {"pages": {}, "errors": {}}
    s.runs = lambda headers, ident: {"errors": {"summary": "the summary table is on Delta"}}
    values = {"category": ["Books"]}
    assert s.check_lakebase_reads({}, s.page("n01_u05"), values, "page n01_u05") == [
        "page n01_u05: a record's history failed: Lakebase could not run it"]
    assert asked == [{"page": "n01_u05", "key": "42"}]
    assert listed == [{"page": "n01_u05", "filters": values}], "the things to fix read with the page filters, as the tab reads them"
    s.record_history = lambda headers, query: (_ for _ in ()).throw(shell_core.HttpError(404, "no current record has this key"))
    assert s.check_lakebase_reads({}, s.page("n01_u05"), {}, "page n01_u05") == []
    s.overview = lambda headers, data: (_ for _ in ()).throw(shell_db.QueryError("Lakebase could not run it: relation does not exist"))
    assert s.check_lakebase_reads({}, s.page("n01_u05"), {}, "page n01_u05") == [
        "page n01_u05: the things to fix failed: Lakebase could not run it: relation does not exist"]
    listed.clear()
    s.overview = lambda headers, data: listed.append(data) or {"pages": {}, "errors": {}}
    assert s.check_lakebase_reads({}, dict(s.page("n01_u05"), records=None), {}, "page n01_u05") == []
    assert listed == [], "a page without a decision list has no things to fix to read"
    (tmp_path / "copied").mkdir()
    s, _ws, _lb = lakebase_shell(tmp_path / "copied", settings=dict(MODIFY, backend=backend(True)), pages=[edit_page()], ws=TableWorkspace(),
                                 answers=TableWorkspace(), strict=True)
    assert not [p for p in s.check({}) if "history failed" in p or "things to fix failed" in p]
    (tmp_path / "delta").mkdir()
    delta = shell_core.Shell(app_dir(tmp_path / "delta", MODIFY, [edit_page()]), env=dict(PG_ENV), sp_factory=TableWorkspace,
                             user_factory=lambda h, t: TableWorkspace())
    assert delta.check_lakebase_reads({}, delta.page("n01_u05"), {}, "page n01_u05") == []


def test_a_write_that_saved_nothing_holds_nothing(tmp_path):
    ws = TableWorkspace(written=0)
    s, ws, lb = lakebase_shell(tmp_path, settings=dict(MODIFY, backend=backend(True)), pages=[edit_page()], ws=ws, answers=TableWorkspace())
    status, _out = call(s, "POST", "records/edit", headers=EDITOR, body=edit_body())
    assert status == 409 and lb.writes == []


class Clock:
    def __init__(self, now=NOW):
        self.now = now

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


class Service:
    def __init__(self, script):
        self.script = {key: list(value) for key, value in script.items()}
        self.calls = []

    def call(self, method, path, body=None):
        self.calls.append((method, path, body))
        if len(self.calls) > 1000:
            raise AssertionError(f"the sync looped: {self.calls[-3:]}")
        steps = self.script.get((method, path))
        if not steps:
            raise AssertionError(f"unexpected call {method} {path}")
        answer = steps.pop(0) if len(steps) > 1 else steps[0]
        answer = answer() if callable(answer) else answer
        if isinstance(answer, Exception):
            raise answer
        return answer


CREDENTIALS = ("POST", "/api/2.0/postgres/credentials")
PIPELINE = "/api/2.0/pipelines/pipeline-1"


def iso(epoch):
    return datetime.datetime.fromtimestamp(epoch, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def api_time(epoch):
    return datetime.datetime.fromtimestamp(epoch, UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


class FakeCursor:
    def __init__(self, conn):
        self.conn, self.description = conn, None

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def execute(self, text, values=None):
        self.conn.executed.append((text, values))
        if text.startswith("SET "):
            return
        if self.conn.errors:
            raise self.conn.errors.pop(0)
        self.description = [types.SimpleNamespace(name=n, type_code=oid) for n, oid in self.conn.shape]

    def fetchmany(self, size):
        return list(self.conn.rows[:size])


class FakeConn:
    OIDS = {25: "text", 20: "int8", 1700: "numeric", 1082: "date"}

    def __init__(self, errors=(), rows=(("Books",),), shape=(("category", 25),)):
        self.errors, self.rows, self.shape = list(errors), list(rows), list(shape)
        self.executed, self.closed = [], False
        self.adapters = types.SimpleNamespace(types=types.SimpleNamespace(
            get=lambda oid: types.SimpleNamespace(name=self.OIDS[oid]) if oid in self.OIDS else None))

    def cursor(self, name=None):
        return FakeCursor(self)

    def transaction(self):
        return contextlib.nullcontext()

    def close(self):
        self.closed = True


def lakebase(service, conns=None, clock=None, env=None, connect=None):
    made = []

    def fake_connect(**kwargs):
        made.append(kwargs)
        return conns.pop(0)

    clock = clock or Clock()
    lb = shell_pg.Lakebase(backend(True), env or PG_ENV, lambda: service, clock=clock, sleep=clock.sleep,
                           connect=connect or fake_connect)
    return lb, made, clock


def password_service(*tokens):
    return Service({CREDENTIALS: [{"token": t, "expire_time": iso(NOW + 3600 * (i + 1))} for i, t in enumerate(tokens)]})


def test_lakebase_needs_its_postgres_resource():
    with pytest.raises(shell_pg.LakebaseError, match=r"PGHOST, LAKEBASE_ENDPOINT is not set, so add its postgres resource"):
        shell_pg.Lakebase(backend(), {"PGDATABASE": "d", "PGUSER": "u", "PGHOST": " "}, lambda: None)


def test_the_password_is_fetched_once_and_renewed_five_minutes_before_it_expires():
    service = password_service("t1", "t2")
    lb, _made, clock = lakebase(service)
    assert lb.credential() == "t1" and lb.credential() == "t1"
    assert service.calls == [("POST", "/api/2.0/postgres/credentials", {"endpoint": PG_ENV["LAKEBASE_ENDPOINT"]})]
    clock.now += 3600 - shell_pg.TOKEN_SLACK_S - 1
    assert lb.credential() == "t1"
    clock.now += 2
    assert lb.credential() == "t2" and len(service.calls) == 2
    lb, _made, clock = lakebase(Service({CREDENTIALS: [{"token": "t3"}]}))
    assert lb.credential() == "t3" and lb.expires == clock.now + shell_pg.TOKEN_LIFE_S
    with pytest.raises(shell_pg.LakebaseError, match="Lakebase gave the App no password"):
        lakebase(Service({CREDENTIALS: [{}]}))[0].credential()
    with pytest.raises(shell_pg.LakebaseError, match="could not get a Lakebase password: PERMISSION_DENIED"):
        lakebase(Service({CREDENTIALS: [shell_db.QueryError("PERMISSION_DENIED")]}))[0].credential()


def test_a_connection_is_read_only_with_a_statement_timeout_and_is_reused():
    conn = FakeConn(rows=[("Books",), ("Music",), ("Toys",)])
    lb, made, _clock = lakebase(password_service("t1"), [conn])
    out = lb.run(f"SELECT `category` FROM {TREND_VIEW}", [], 2)
    assert out == {"columns": [{"name": "category", "type": "STRING", "type_text": "STRING"}],
                   "rows": [{"category": "Books"}, {"category": "Music"}], "truncated": True}
    assert lb.run(f"SELECT `category` FROM {TREND_VIEW}", [], 5)["truncated"] is False
    assert made == [{"host": PG_ENV["PGHOST"], "port": 5432, "dbname": "databricks_postgres", "user": "app-sp", "password": "t1",
                     "sslmode": "require", "connect_timeout": shell_pg.CONNECT_TIMEOUT_S, "autocommit": True}]
    assert [t for t, _v in conn.executed[:3]] == ["SET statement_timeout = 30000", "SET default_transaction_read_only = on",
                                                  "SET TIME ZONE 'UTC'"]
    assert sum(1 for t, _v in conn.executed if t.startswith("SET ") and not t.startswith("SET LOCAL ")) == 3, \
        "the pooled connection is reused, not reopened"
    assert [t for t, _v in conn.executed if t.startswith("SET LOCAL ")] == [f"SET LOCAL statement_timeout = {shell_pg.READ_TIMEOUT_MS}"] * 2, \
        "each read of the App waits at most the short interactive timeout"


def test_column_types_come_from_unity_catalog_and_unknown_columns_from_postgres():
    conn = FakeConn(rows=[(decimal.Decimal("12.50"), 3, datetime.date(2026, 10, 1), "x")],
                    shape=[("value", 1700), ("n", 20), ("month", 1082), ("other", 999)])
    lb, _made, _clock = lakebase(password_service("t1"), [conn])
    out = lb.run(f"SELECT o.value, COUNT(*) AS n, t.month, 'x' AS other FROM {TABLE} AS o, {TREND_VIEW} AS t", [], 5)
    assert out["columns"] == [{"name": "value", "type": "DECIMAL", "type_text": "DECIMAL(18,2)"},
                              {"name": "n", "type": "LONG", "type_text": "LONG"}, {"name": "month", "type": "DATE", "type_text": "DATE"},
                              {"name": "other", "type": "STRING", "type_text": "STRING"}]
    assert out["rows"] == [{"value": 12.5, "n": 3, "month": "2026-10-01", "other": "x"}]


def test_cells_match_what_the_warehouse_returns():
    zoned = datetime.datetime(2026, 10, 15, 10, 0, 0, 123456, tzinfo=datetime.timezone(datetime.timedelta(hours=4)))
    assert shell_pg.cell(zoned) == "2026-10-15T06:00:00.123Z"
    assert shell_pg.cell(datetime.datetime(2026, 10, 15, 6, 0, 0)) == "2026-10-15T06:00:00.000"
    assert shell_pg.cell(decimal.Decimal("1.25")) == 1.25 and shell_pg.cell(datetime.date(2026, 1, 2)) == "2026-01-02"
    assert shell_pg.cell(["a"]) == ["a"] and shell_pg.cell({"k": 1}) == {"k": 1} and shell_pg.cell(None) is None


def test_a_lost_connection_is_retried_once_and_a_sql_error_keeps_the_connection():
    lost, fresh = FakeConn(errors=[psycopg.OperationalError("server closed the connection unexpectedly")]), FakeConn()
    lb, made, _clock = lakebase(password_service("t1"), [lost, fresh])
    assert lb.run(f"SELECT `category` FROM {TREND_VIEW}", [], 5)["rows"] == [{"category": "Books"}]
    assert lost.closed and len(made) == 2
    gone = [FakeConn(errors=[psycopg.OperationalError("gone")]), FakeConn(errors=[psycopg.InterfaceError("gone again")])]
    lb, made, _clock = lakebase(password_service("t1"), gone)
    with pytest.raises(shell_pg.LakebaseError, match="Lakebase did not answer: gone again"):
        lb.run(f"SELECT `category` FROM {TREND_VIEW}", [], 5)
    bad = FakeConn(errors=[psycopg.errors.UndefinedColumn('column "category" does not exist near "Books"')])
    lb, made, _clock = lakebase(password_service("t1"), [bad])
    with pytest.raises(shell_db.QueryError, match='column "category" does not exist near "a data value"') as raised:
        lb.run(f"SELECT `category` FROM {TREND_VIEW}", [], 5)
    assert not isinstance(raised.value, shell_pg.LakebaseError)
    assert not bad.closed and lb.pool.qsize() == 1, "a SQL error leaves the connection usable"


def test_a_lakebase_that_dropped_its_sessions_is_read_on_a_fresh_connection_and_every_pooled_one_is_closed():
    stale = [FakeConn(errors=[psycopg.errors.AdminShutdown("terminating connection due to administrator command")]) for _ in range(3)]
    fresh = FakeConn()
    lb, made, _clock = lakebase(password_service("t1"), [fresh])
    for conn in stale:
        lb.pool.put(conn)
    assert lb.run(f"SELECT `category` FROM {TREND_VIEW}", [], 5)["rows"] == [{"category": "Books"}]
    assert all(conn.closed for conn in stale), "a scaled down Lakebase ended every pooled session, so none is tried again"
    assert len(made) == 1 and lb.pool.qsize() == 1 and lb.pool.get_nowait() is fresh


def test_a_connection_that_cannot_open_is_a_lakebase_error():
    def refuse(**_kwargs):
        raise psycopg.OperationalError("connection refused")

    lb, _made, _clock = lakebase(password_service("t1"), connect=refuse)
    with pytest.raises(shell_pg.LakebaseError, match="could not connect to Lakebase: connection refused"):
        lb.run(f"SELECT `category` FROM {TREND_VIEW}", [], 5)


def test_the_pool_keeps_at_most_its_size_and_drops_closed_connections():
    lb, _made, _clock = lakebase(password_service("t1"), [])
    extra = [FakeConn() for _ in range(shell_pg.POOL_SIZE + 2)]
    for conn in extra:
        lb._give(conn)
    assert lb.pool.qsize() == shell_pg.POOL_SIZE and [c.closed for c in extra[-2:]] == [True, True]
    closed = FakeConn()
    closed.closed = True
    lb._give(closed)
    assert lb.pool.qsize() == shell_pg.POOL_SIZE


def sync_service(posts, updates, pipeline=None):
    script = {("POST", f"{PIPELINE}/updates"): posts, CREDENTIALS: [{"token": "t1"}]}
    for update_id, states in updates.items():
        script[("GET", f"{PIPELINE}/updates/{update_id}")] = [{"update": s} for s in states]
    if pipeline is not None:
        script[("GET", PIPELINE)] = pipeline
    return Service(script)


def test_held_tables_clear_only_after_a_sync_created_after_their_write():
    service = sync_service([{"update_id": "u1"}, {"update_id": "u2"}, {"update_id": "u3"}], {
        "u1": [{"state": "RUNNING"}, {"state": "COMPLETED", "creation_time": (NOW + shell_pg.CLOCK_SKEW_S - 1) * 1000}],
        "u2": [{"state": "COMPLETED", "creation_time": (NOW + 10) * 1000}],
        "u3": [{"state": "COMPLETED", "creation_time": (NOW + 40) * 1000}]})
    lb, _made, clock = lakebase(service, [])
    lb.held = {shell_pg.uc_key(TABLE): NOW, shell_pg.uc_key(TREND_VIEW): NOW + 20}
    lb.syncer = threading.current_thread()
    lb._sync()
    assert lb.held == {} and lb.syncer is None and lb.synced_at == NOW + 40
    assert [c[1] for c in service.calls if c[0] == "POST"] == [f"{PIPELINE}/updates"] * 3
    assert clock.now == NOW + shell_pg.SYNC_POLL_S


def test_a_running_update_is_joined_when_the_pipeline_refuses_a_second_one():
    service = sync_service([shell_db.QueryError("An active update already exists")], {
        "u0": [{"state": "COMPLETED", "creation_time": (NOW + shell_pg.CLOCK_SKEW_S + 1) * 1000}]},
        pipeline=[{"latest_updates": [{"update_id": "u0", "state": "RUNNING"}, {"update_id": "old", "state": "COMPLETED"}]}])
    lb, _made, _clock = lakebase(service, [])
    lb.held, lb.syncer = {shell_pg.uc_key(TABLE): NOW}, threading.current_thread()
    lb._sync()
    assert lb.held == {} and ("GET", f"{PIPELINE}/updates/u0", None) in service.calls


def test_a_refused_failed_or_stuck_sync_is_noted_and_retried_while_reads_stay_on_delta():
    service = sync_service([shell_db.QueryError("PERMISSION_DENIED: CAN_RUN"), {"update_id": "u1"}, {"update_id": "u2"},
                            {"update_id": "u3"}], {
        "u1": [{"state": "FAILED", "creation_time": (NOW + 1) * 1000}],
        "u2": [{"state": "RUNNING"}],
        "u3": [{"state": "COMPLETED", "creation_time": (NOW + 5000) * 1000}]},
        pipeline=[{"latest_updates": []}])
    notes = []
    lb, _made, clock = lakebase(service, [])
    original = lb.noted
    lb.noted = lambda text: notes.append(text) or original(text)
    lb.held, lb.syncer = {shell_pg.uc_key(TABLE): NOW}, threading.current_thread()
    lb._sync()
    assert notes == [
        "Lakebase could not sync the latest changes, so the App reads them from Delta tables: PERMISSION_DENIED: CAN_RUN",
        "the Lakebase sync ended failed, so the App reads the latest changes from Delta tables",
        "Lakebase could not sync the latest changes, so the App reads them from Delta tables: the Lakebase sync ran longer than 30 "
        "minutes"]
    assert lb.held == {} and clock.now > NOW + shell_pg.SYNC_DEADLINE_S


def test_writes_start_one_sync_thread_at_a_time_and_ignore_tables_lakebase_does_not_hold():
    gate = threading.Event()

    def post():
        assert gate.wait(10)
        return {"update_id": "u1"}

    service = sync_service([post], {"u1": [{"state": "COMPLETED", "creation_time": (NOW + 10) * 1000}]},
                           pipeline=[{"latest_updates": []}])
    lb, _made, _clock = lakebase(service, [])
    lb.wrote(["main.other.table"])
    assert lb.syncer is None and lb.held == {}
    lb.wrote([TABLE])
    first = lb.syncer
    lb.wrote([TREND_VIEW.upper()])
    assert lb.syncer is first and set(lb.held) == {shell_pg.uc_key(TABLE), TREND_VIEW}
    assert lb.status()["catching_up"] is True
    gate.set()
    first.join(10)
    assert not first.is_alive() and lb.held == {} and lb.syncer is None and lb.status()["catching_up"] is False
    assert sum(1 for c in service.calls if c[0] == "POST" and c[1].endswith("/updates")) == 1


PLAN = {"result": TABLE, "keys": ["42"], "copies": {RECORDS_VIEW: "record_key"}}
SAVED = [{"record_key": "42", "valid_from": "2026-10-20T09:00:00.000Z", "is_current": True, "recommended_action": "Hold", "_inspire_row": 9},
         {"record_key": "42", "valid_from": "2026-10-15T06:00:00.000Z", "is_current": False, "recommended_action": "Cut"}]
SAVED_VIEW = [{"record_key": "42", "entity_id": 42, "recommended_action": "Hold", "top_reasons": ["deep discount"]}]


def overlay_lakebase(conns=()):
    lb, _made, clock = lakebase(Service({CREDENTIALS: [{"token": "t1"}], ("GET", PIPELINE): [{"latest_updates": []}]}), list(conns))
    lb.syncer = lb.overlayer = threading.current_thread()
    return lb, clock


def write(lb, keys, plan, fetch):
    lb.overlayer = threading.current_thread()
    lb.wrote(keys, plan, fetch)


def fetcher(answers, calls):
    def fetch(table, columns, column, values):
        calls.append((table, column, list(values)))
        if isinstance(answers[table], Exception):
            raise answers[table]
        return [dict(r) for r in answers[table] if str(r.get(column)) in set(values)]
    return fetch


def test_saved_rows_are_read_from_delta_until_they_are_read_back_then_lakebase_serves_them_on_top():
    conn = FakeConn(rows=[("Hold",)], shape=[("recommended_action", 25)])
    lb, clock = overlay_lakebase([conn])
    calls = []
    write(lb, [TABLE, RECORDS_VIEW], PLAN, fetcher({TABLE: SAVED, RECORDS_VIEW: SAVED_VIEW}, calls))
    assert lb.held == {TABLE: NOW, RECORDS_VIEW: NOW} and lb.pending() is True and lb.queued.qsize() == 1
    lb._overlay_loop()
    assert calls == [(TABLE, "record_key", ["42"]), (RECORDS_VIEW, "record_key", ["42"])]
    assert lb.held == {} and lb.pending() is False and lb.status()["catching_up"] is False and lb.overlayer is None
    saved = lb.overlays[TABLE]["rows"]["42"]
    assert saved[0] == NOW and [r["recommended_action"] for r in saved[1]] == ["Hold", "Cut"]
    assert all(set(r) == {c["name"] for c in RESULT_COLUMNS} for r in saved[1]), "only the copy's columns, never the row number"
    assert lb.overlays[RECORDS_VIEW] == {"column": "record_key", "rows": {"42": (NOW, [dict({c["name"]: None for c in RECORD_COLUMNS},
                                                                                         **SAVED_VIEW[0])])}}
    assert lb.run(f"SELECT o.recommended_action FROM {TABLE} AS o WHERE o.is_current", [], 5)["rows"] == [{"recommended_action": "Hold"}]
    text, values = conn.executed[-1]
    assert "JSONB_TO_RECORDSET" in text and json.loads(values["_lb_keys_0"]) == ["42"]
    assert [r["valid_from"] for r in json.loads(values["_lb_rows_0"])] == ["2026-10-20T09:00:00.000Z", "2026-10-15T06:00:00.000Z"]


def test_a_later_write_keeps_its_tables_on_delta_until_its_own_rows_are_read_back():
    lb, clock = overlay_lakebase()
    calls = []
    fetch = fetcher({TABLE: SAVED, RECORDS_VIEW: SAVED_VIEW}, calls)
    write(lb, [TABLE, RECORDS_VIEW], PLAN, fetch)
    clock.now += 1
    write(lb, [TABLE, RECORDS_VIEW], dict(PLAN, keys=["5"]), fetch)
    first, second = lb.queued.get_nowait(), lb.queued.get_nowait()
    lb.overlay(*first)
    assert lb.held == {TABLE: NOW + 1, RECORDS_VIEW: NOW + 1} and set(lb.overlays[TABLE]["rows"]) == {"42"}
    lb.overlay(*second)
    assert lb.held == {} and set(lb.overlays[TABLE]["rows"]) == {"42", "5"} and lb.overlays[TABLE]["rows"]["5"] == (NOW + 1, [])
    assert calls[-1] == (TABLE, "record_key", ["5"]), "a record whose rows are gone shows nothing on top: its old copy is hidden"


def test_rows_that_cannot_be_read_back_keep_their_tables_on_delta_until_a_sync_lands_and_say_why():
    lb, clock = overlay_lakebase()
    write(lb, [TABLE, RECORDS_VIEW], PLAN, fetcher({TABLE: shell_db.QueryError("the warehouse is stopped"), RECORDS_VIEW: []}, []))
    lb._overlay_loop()
    assert lb.held == {TABLE: NOW, RECORDS_VIEW: NOW} and lb.stuck == {TABLE: NOW, RECORDS_VIEW: NOW} and lb.overlays == {}
    assert lb.status()["note"] == ("the App reads your latest changes from Delta tables until Lakebase syncs them, because it could not "
                                   "read them back: the warehouse is stopped")
    lb.landed(NOW + 30)
    assert lb.held == {} and lb.stuck == {} and lb.synced_at == NOW + 30


def test_more_saved_rows_than_an_overlay_holds_keep_that_table_on_delta(monkeypatch):
    monkeypatch.setattr(shell_pg, "OVERLAY_ROWS", 1)
    lb, clock = overlay_lakebase()
    write(lb, [TABLE, RECORDS_VIEW], PLAN, fetcher({TABLE: SAVED, RECORDS_VIEW: SAVED_VIEW}, []))
    lb._overlay_loop()
    assert lb.held == {TABLE: NOW} and lb.stuck == {TABLE: NOW} and set(lb.overlays) == {RECORDS_VIEW}


def test_a_sync_that_lands_drops_what_it_copied_and_a_read_back_older_than_it_is_ignored():
    lb, clock = overlay_lakebase()
    fetch = fetcher({TABLE: SAVED, RECORDS_VIEW: SAVED_VIEW}, [])
    write(lb, [TABLE, RECORDS_VIEW], PLAN, fetch)
    lb._overlay_loop()
    clock.now = NOW + 100
    write(lb, [TABLE, RECORDS_VIEW], dict(PLAN, keys=["5"]), fetch)
    lb.landed(NOW + 50)
    assert lb.overlays == {} and lb.held == {TABLE: NOW + 100, RECORDS_VIEW: NOW + 100}
    lb._overlay_loop()
    assert lb.held == {} and set(lb.overlays[TABLE]["rows"]) == {"5"}
    clock.now = NOW + 200
    write(lb, [TABLE], dict(PLAN, keys=["8"]), fetch)
    lb.landed(NOW + 300)
    lb._overlay_loop()
    assert lb.overlays == {} and lb.held == {}, "rows read back after a newer sync landed would hide what that sync copied"


def test_saved_rows_shown_on_top_keep_the_sync_running_until_one_lands_after_them():
    service = sync_service([{"update_id": "u1"}], {"u1": [{"state": "COMPLETED", "creation_time": (NOW + 10) * 1000}]})
    lb, _made, _clock = lakebase(service, [])
    lb.overlays = {TABLE: {"column": "record_key", "rows": {"42": (NOW, SAVED)}}}
    lb.syncer = threading.current_thread()
    lb._sync()
    assert lb.overlays == {} and lb.syncer is None and [c[1] for c in service.calls if c[0] == "POST"] == [f"{PIPELINE}/updates"]


def test_a_write_hands_lakebase_the_rows_to_read_back_and_the_shell_reads_them_from_delta(tmp_path):
    class Answers(FakeWorkspace):
        def run_sql(self, warehouse, sql, params, limit=5000):
            self.sql.append((sql, params, limit))
            return {"columns": [], "rows": [{"record_key": "42"}] * (limit + 1 if "many" in params[0]["value"] else 1),
                    "truncated": "many" in params[0]["value"]}

    s, ws, _lb = lakebase_shell(tmp_path, settings=dict(MODIFY, backend=backend(True)), pages=[edit_page()], ws=Answers())
    assert s.overlay_rows(TABLE, RESULT_COLUMNS + [ROW], "record_key", ["42", "5"]) == [{"record_key": "42"}]
    sql, params, limit = ws.sql[-1]
    assert sql == (f"SELECT {', '.join(shell_pg.quoted(c['name']) for c in RESULT_COLUMNS)} FROM `main`.`pricing`.`loss_desk_out` "
                   f"WHERE CAST(`record_key` AS STRING) IN (SELECT explode(from_json(:keys, 'ARRAY<STRING>')))")
    assert params == [{"name": "keys", "value": '["42", "5"]', "type": "STRING"}] and limit == shell_pg.OVERLAY_ROWS
    s.overlay_rows(RECORDS_VIEW, RECORD_COLUMNS + [ROW], "record_key", ["42"])
    records_sql = next(d["sql"] for d in PAGE["datasets"] if d["name"] == "records")
    assert ws.sql[-1][0] == (f"SELECT {', '.join(shell_pg.quoted(c['name']) for c in RECORD_COLUMNS)} FROM ({records_sql}) AS d "
                             f"WHERE CAST(`record_key` AS STRING) IN (SELECT explode(from_json(:keys, 'ARRAY<STRING>')))"), \
        "a dataset copy is read back through the SQL the Delta fallback runs, which the App may already read"
    with pytest.raises(shell_db.QueryError, match=f"more than {shell_pg.OVERLAY_ROWS} rows of {TABLE} changed"):
        s.overlay_rows(TABLE, RESULT_COLUMNS, "record_key", ["many"])
    pages = [edit_page(), edit_page(id="other", records=dict(PAGE["records"], key="entity_id"))]
    other = {"kind": "lakebase", "tables": dict(backend(True)["tables"], **{"main.pricing_lb.other__records": {
        "pg": "s.o", "columns": [c for c in RECORD_COLUMNS if c["name"] != "record_key"]}}),
        "datasets": {"n01_u05": {"records": RECORDS_VIEW}, "other": {"records": "main.pricing_lb.other__records"}}}
    derived = {"n01_u05": {RECORDS_VIEW}, "other": {"main.pricing_lb.other__records"}}
    assert shell_pg.overlay_plan(pages, other, derived, TABLE, ["42", 7]) == {
        "result": TABLE, "keys": ["42", "7"], "copies": {RECORDS_VIEW: "record_key", "main.pricing_lb.other__records": "entity_id"}}
    assert shell_pg.overlay_plan(pages, other, {"n01_u05": set()}, TABLE, ["42"])["copies"] == {}
    assert shell_pg.overlay_plan(pages, dict(other, tables={}), derived, TABLE, ["42"]) == {}


LIVE_PIPELINE = {"latest_updates": [{"update_id": "u2", "state": "COMPLETED", "creation_time": "2026-10-28T09:10:57.898Z"},
                                    {"update_id": "u1", "state": "COMPLETED", "creation_time": "2026-10-28T09:10:15.267Z"}]}
LIVE_UPDATE = {"state": "COMPLETED", "creation_time": 1793178657898, "start_time": "2026-10-28T09:10:57.898Z",
               "end_time": "2026-10-28T09:12:02.758Z"}


def test_the_sync_time_reads_both_forms_the_pipelines_api_returns():
    lb, _made, _clock = lakebase(sync_service([{"update_id": "u2"}], {"u2": [LIVE_UPDATE]}, pipeline=[LIVE_PIPELINE]), [])
    assert lb.synced() == "2026-10-28T09:10:57Z"
    assert lb._wait("u2") == ("COMPLETED", pytest.approx(1793178657.898))


@pytest.mark.parametrize("value,expected", [
    ("2026-10-28T09:10:57.898Z", 1793178657.898), ("2026-10-28T13:10:57.898+04:00", 1793178657.898),
    ("2026-10-28T09:10:57", 1793178657.0), (1793178657898, 1793178657.898), ("1793178657898", 1793178657.898),
    (1793178657, 1793178657.0), (1793178657.898, 1793178657.898), ("1793178657", 1793178657.0),
    (None, -1.0), ("", -1.0), ("soon", -1.0), (0, -1.0), (True, -1.0)])
def test_a_pipeline_or_credential_time_is_read_as_epoch_seconds_whatever_its_form(value, expected):
    assert shell_pg.epoch_of(value, -1.0) == pytest.approx(expected)


def test_the_shell_reads_every_time_through_the_one_parser_the_lakebase_sync_uses():
    assert shell_core.stamp_of is shell_db.stamp_of and shell_pg.stamp_of is shell_db.stamp_of
    assert shell_db.stamp_of("2026-10-28T13:10:57.898+04:00") == datetime.datetime(2026, 10, 28, 9, 10, 57, 898000, tzinfo=UTC)
    assert shell_db.stamp_of("2026-10-28 09:10:57") == datetime.datetime(2026, 10, 28, 9, 10, 57, tzinfo=UTC)
    assert shell_db.stamp_of("not a time") is None and shell_db.stamp_of(None) is None


def test_status_reports_the_latest_completed_sync_and_forgets_old_notes():
    service = sync_service([{"update_id": "u1"}], {}, pipeline=[
        {"latest_updates": [{"state": "RUNNING", "creation_time": api_time(NOW - 10)},
                            {"state": "COMPLETED", "creation_time": api_time(NOW - 600)},
                            {"state": "COMPLETED", "creation_time": api_time(NOW - 7200)}]},
        shell_db.QueryError("PERMISSION_DENIED")])
    lb, _made, clock = lakebase(service, [])
    assert lb.status() == {"note": "", "catching_up": False, "synced_at": iso(NOW - 600)}
    lb.status()
    assert sum(1 for c in service.calls if c[1] == PIPELINE) == 1, "the sync time is read at most once a minute"
    lb.noted("Lakebase could not run a query")
    clock.now += shell_pg.SYNCED_TTL_S + 1
    assert lb.status() == {"note": "Lakebase could not run a query", "catching_up": False, "synced_at": iso(NOW - 600)}
    clock.now += shell_pg.NOTE_TTL_S
    assert lb.status()["note"] == ""
    lb, _made, _clock = lakebase(sync_service([{}], {}, pipeline=[shell_db.QueryError("PERMISSION_DENIED")]), [])
    assert lb.status()["synced_at"] is None


PG_BIN = next((d for d in (os.environ.get("INSPIRE_PG_BIN"), "/opt/homebrew/opt/postgresql@17/bin", "/usr/lib/postgresql/17/bin",
                           os.path.dirname(shutil.which("initdb") or "")) if d and os.path.isfile(os.path.join(d, "initdb"))), None)
CATEGORIES, CHANNELS, REGIONS = ("Books", "Music", "Games"), ("Web", "Store"), ("North", "South")
MONTHS = [datetime.date(2025 + (10 + i) // 12, (10 + i) % 12 + 1, 1) for i in range(12)]
ITEMS = (5, 8, 13, 21, 34, 42)
RUN_AT = datetime.datetime(2026, 10, 15, 6, 0, tzinfo=UTC)
OLD_RUN_AT = datetime.datetime(2026, 9, 15, 6, 0, tzinfo=UTC)
PG_TYPES = {"DATE": "date", "STRING": "text", "DOUBLE": "double precision", "LONG": "bigint", "INT": "integer", "ARRAY": "jsonb",
            "MAP": "jsonb", "DECIMAL": "numeric(18,2)", "BOOLEAN": "boolean", "TIMESTAMP": "timestamptz"}


def trend_rows():
    rows = []
    for i, month in enumerate(MONTHS):
        for c, category in enumerate(CATEGORIES):
            for h, channel in enumerate(CHANNELS):
                for r, region in enumerate(REGIONS):
                    loss = 10.0 + i + 5 * c + 2 * h + r
                    rows.append({"as_of_date": month, "month": month, "category": category, "channel": channel, "region": region,
                                 "loss": loss, "revenue": 200.0 + 3 * i + 20 * c, "discounts": loss * 1.5})
    return rows


def item(n):
    return {"entity_id": n, "entity_label": f"Item {n} (50% off)" if n == 5 else f"Item {n}",
            "priority_tier": ("Act now", "Review", "Monitor")[n % 3], "rank": ITEMS.index(n) + 1,
            "top_reasons": json.dumps(["deep discount", f"reason {n}"]), "recommended_action": "Cut the discount",
            "value": decimal.Decimal(100 + n) + decimal.Decimal("0.25"), "category": CATEGORIES[n % 3], "channel": CHANNELS[n % 2],
            "region": REGIONS[(n // 2) % 2]}


def result_rows():
    rows = []
    for n in ITEMS:
        base = {k: v for k, v in item(n).items() if k not in ("category", "channel", "region")}
        current = dict(base, flagged=False, due=None, seen_at=None, notes=None, as_of_date=datetime.date(2026, 10, 15), run_id=77,
                       use_case_id="N01-U05", record_key=str(n), valid_from=RUN_AT, valid_to=None, is_current=True,
                       change_source="run", changed_by="run 77", action_owner=None, action_status="Open" if n == 8 else None,
                       action_due=None, action_note=None, dismiss_reason=None, action_outcome=None, snooze_until=None, action_batch=None,
                       action_batch_note=None, action_batch_values=None, joined_at=OLD_RUN_AT)
        rows.append(current)
        if n in (5, 42):
            rows.append(dict(current, as_of_date=datetime.date(2026, 9, 15), run_id=76, valid_from=OLD_RUN_AT, valid_to=RUN_AT,
                             is_current=False, changed_by="run 76", action_status=None, value=decimal.Decimal(90 + n)))
    return rows


def records_rows():
    return [dict(item(n), record_key=str(n), as_of_date=datetime.date(2026, 10, 15)) for n in ITEMS]


PREVIOUS_ITEMS = (5, 42)
PREVIOUS_RECORDS = "main.pricing_lb.n01_u05__p_records"


def previous_records_rows():
    return [dict(item(n), record_key=str(n), as_of_date=datetime.date(2026, 9, 15), value=decimal.Decimal(90 + n)) for n in PREVIOUS_ITEMS]


KINDS = "main.catalog_lb.kinds"
KIND_COLUMNS = [{"name": n, "type": t, "type_text": x} for n, t, x in (
    ("k", "STRING", "STRING"), ("n", "LONG", "BIGINT"), ("v", "DOUBLE", "DOUBLE"), ("amount", "DECIMAL", "DECIMAL(18,2)"),
    ("d", "DATE", "DATE"), ("ts", "TIMESTAMP", "TIMESTAMP"), ("flag", "BOOLEAN", "BOOLEAN"), ("tags", "ARRAY", "ARRAY<STRING>"),
    ("scores", "ARRAY", "ARRAY<BIGINT>"), ("attrs", "MAP", "MAP<STRING, STRING>"), ("doc", "STRING", "STRING"),
    ("pattern", "STRING", "STRING"))] + [ROW]
KIND_ROWS = [
    {"k": "a", "n": 3, "v": 2.5, "amount": decimal.Decimal("10.25"), "d": datetime.date(2026, 1, 31), "_inspire_row": 1,
     "ts": datetime.datetime(2026, 1, 31, 10, 20, 30, tzinfo=UTC), "flag": True, "tags": ["x", "y"], "scores": [5, 7],
     "attrs": {"c": "red"}, "doc": '{"p": {"q": [4, 5]}}', "pattern": "ab12cd"},
    {"k": "b", "n": 8, "v": -1.5, "amount": decimal.Decimal("20.50"), "d": datetime.date(2026, 2, 28), "_inspire_row": 2,
     "ts": datetime.datetime(2026, 3, 1, tzinfo=UTC), "flag": False, "tags": [], "scores": [1], "attrs": {}, "doc": '{"p": {"q": [6]}}',
     "pattern": "xyz"},
    {"k": "c", "_inspire_row": 3}]
A_TS = datetime.datetime(2026, 1, 31, 10, 20, 30, tzinfo=UTC).timestamp()
SPARK_ANSWERS = [
    ("ROUND(v)", 3.0), ("ROUND(amount, 1)", 10.3), ("ROUND(-v, 0)", -3.0), ("CAST(v + 0.2 AS INT)", 2), ("CAST(-v - 0.2 AS BIGINT)", -2),
    ("CAST(amount AS INT)", 10), ("TRY_CAST(v * 1.1 AS SMALLINT)", 2),
    ("CAST(n AS INT)", 3), ("CAST('42' AS INT)", 42), ("CAST(flag AS INT)", 1), ("IF(n > 2, 'big', 'small')", "big"),
    ("NVL(NULL, n)", 3), ("NVL2(v, 1, 0)", 1), ("NULLIF(n, 3)", None), ("GREATEST(n, 5)", 5), ("LEAST(n, 5)", 3),
    ("try_divide(n, 0)", None), ("n / 2", 1.5), ("n DIV 2", 1), ("n % 2", 1), ("v % 2", 0.5), ("amount % 3", 1.25),
    ("pmod(-7, 3)", 2), ("pmod(v, 2)", 0.5), ("LOG(2, v * 3.2)", 3.0), ("LOG(EXP(2))", 2.0), ("ABS(-v)", 2.5), ("CEIL(v)", 3),
    ("FLOOR(v)", 2), ("SIGN(-v)", -1.0), ("SQRT(16)", 4.0), ("POWER(2, 3)", 8.0), ("LN(1)", 0.0), ("EXP(0)", 1.0), ("LOG(2, 8)", 3.0),
    ("LOWER('AbC')", "abc"), ("UPPER(k)", "A"), ("TRIM('  a ')", "a"), ("LENGTH(pattern)", 6), ("SUBSTRING(pattern, 2, 3)", "b12"),
    ("CONCAT(k, '-', pattern)", "a-ab12cd"), ("CONCAT_WS('/', k, 'z')", "a/z"), ("REPLACE(pattern, '12', '-')", "ab-cd"),
    ("LPAD(CAST(n AS STRING), 3, '0')", "003"), ("regexp_extract(pattern, '([0-9]+)', 1)", "12"),
    ("regexp_extract(pattern, 'q([0-9]+)', 1)", ""), ("pattern RLIKE '^ab[0-9]'", True), ("pattern LIKE 'ab%'", True),
    ("pattern ILIKE 'AB%'", True), ("isnull(v)", False), ("isnotnull(v)", True), ("date_add(d, 1)", "2026-02-01"),
    ("date_sub(d, 31)", "2025-12-31"), ("add_months(d, 1)", "2026-02-28"), ("datediff(DATE '2026-03-01', d)", 29),
    ("last_day(DATE '2026-02-10')", "2026-02-28"), ("trunc(d, 'MM')", "2026-01-01"), ("date_trunc('MONTH', ts)", "2026-01-01T00:00:00.000Z"),
    ("date_trunc('YEAR', d)", "2026-01-01T00:00:00.000Z"), ("year(d)", 2026), ("month(d)", 1), ("day(d)", 31), ("dayofmonth(d)", 31),
    ("dayofweek(d)", 7), ("weekofyear(d)", 5), ("quarter(d)", 1), ("dayofyear(d)", 31), ("hour(ts)", 10), ("minute(ts)", 20),
    ("second(ts)", 30), ("timestampdiff(HOUR, ts, TIMESTAMP '2026-02-01 10:20:30')", 24), ("timestampdiff(DAY, d, DATE '2026-03-02')", 30),
    ("timestampdiff(MONTH, DATE '2026-01-15', DATE '2026-04-20')", 3), ("dateadd(MONTH, 1, ts)", "2026-02-28T10:20:30.000Z"),
    ("unix_timestamp(ts)", int(A_TS)), ("from_unixtime(0)", "1970-01-01 00:00:00"), ("unix_micros(ts)", int(A_TS) * 1_000_000),
    ("date_format(d, 'yyyy-MM')", "2026-01"), ("date_format(d, 'MMM yyyy')", "Jan 2026"), ("date_format(d, 'dd/MM/yyyy')", "31/01/2026"),
    ("date_format(ts, 'yyyy-MM-dd HH:mm')", "2026-01-31 10:20"), ("to_date('2026-03-05')", "2026-03-05"),
    ("to_date('2026/03/05', 'yyyy/MM/dd')", "2026-03-05"), ("make_date(2026, 3, 5)", "2026-03-05"), ("CURRENT_DATE() >= DATE '2026-01-01'", True),
    ("size(tags)", 2), ("size(from_json('[1,2,3]', 'ARRAY<INT>'))", 3), ("array_contains(tags, 'y')", True),
    ("array_contains(tags, 'z')", False), ("array_contains(scores, 7)", True), ("tags[0]", "x"), ("element_at(tags, 2)", "y"),
    ("attrs['c']", "red"), ("array_join(tags, '|')", "x|y"), ("get_json_object(doc, '$.p.q[1]')", "5"), ("tags", ["x", "y"]),
    (f"(SELECT COUNT(*) FROM {KINDS} WHERE k IN (SELECT explode(from_json('[\"a\",\"b\"]', 'ARRAY<STRING>'))))", 2),
]
SPARK_TOTALS = [
    ("COUNT_IF(n > 100)", 0), ("COUNT_IF(n > 2)", 2), ("COUNT(DISTINCT k)", 3), ("approx_count_distinct(k)", 3), ("SUM(n)", 11),
    ("AVG(v)", 0.5), ("MIN(d)", "2026-01-31"), ("MAX(amount)", 20.5), ("median(n)", 5.5), ("percentile(n, 0.5)", 5.5),
    ("percentile_approx(n, 0.5)", 3), ("max_by(k, n)", "b"), ("min_by(k, n)", "a"), ("collect_set(n)", [3, 8]), ("bool_or(flag)", True),
    ("bool_and(flag)", False), ("stddev(n)", 3.5355339), ("variance(n)", 12.5), ("corr(n, v)", -1.0), ("SIZE(collect_list(k))", 3),
    ("array_join(collect_list(k), ',')", "a,b,c"), ("SUM(size(tags))", 1), ("MIN(size(tags))", -1),
]
SPARK_QUERIES = [
    (f"SELECT explode(tags) AS t FROM {KINDS} WHERE k = 'a'", [{"t": "x"}, {"t": "y"}]),
    (f"SELECT SUM(s) AS t FROM (SELECT explode(scores) AS s FROM {KINDS})", [{"t": 13}]),
    ("SELECT inline(from_json('[{\"k\":\"a\",\"v\":1},{\"k\":\"b\",\"v\":2}]', 'ARRAY<STRUCT<k: STRING, v: BIGINT>>'))",
     [{"k": "a", "v": 1}, {"k": "b", "v": 2}]),
    (f"SELECT k, ROW_NUMBER() OVER (ORDER BY n DESC) AS r FROM {KINDS} ORDER BY r", [{"k": "b", "r": 1}, {"k": "a", "r": 2}, {"k": "c", "r": 3}]),
    (f"SELECT k FROM {KINDS} ORDER BY n", [{"k": "c"}, {"k": "a"}, {"k": "b"}]),
    (f"SELECT k FROM {KINDS} WHERE CAST(n AS STRING) IN (SELECT explode(from_json(:keys, 'ARRAY<STRING>'))) ORDER BY k",
     [{"k": "a"}, {"k": "b"}]),
]


def create(cur, name, columns, rows):
    cols = [c for c in columns]
    cur.execute(f'CREATE TABLE "{PG_SCHEMA}"."{name}" (' + ", ".join(f'"{c["name"]}" {PG_TYPES[c["type"]]}' for c in cols) + ")")
    for i, row in enumerate(rows):
        values = [i + 1 if c["name"] == shell_pg.ROW_COLUMN else row.get(c["name"]) for c in cols]
        cur.execute(f'INSERT INTO "{PG_SCHEMA}"."{name}" VALUES (' + ", ".join(["%s"] * len(cols)) + ")", values)


@pytest.fixture(scope="module")
def postgres():
    if PG_BIN is None:
        pytest.skip("PostgreSQL is not installed here, so the Lakebase queries cannot run on a real Postgres")
    root = tempfile.mkdtemp(prefix="ilb", dir="/tmp")
    data, pg_ctl = os.path.join(root, "d"), os.path.join(PG_BIN, "pg_ctl")
    subprocess.run([os.path.join(PG_BIN, "initdb"), "-D", data, "-U", "inspire", "--auth=trust", "-E", "UTF8", "--no-locale"],
                   check=True, capture_output=True, text=True)
    subprocess.run([pg_ctl, "-D", data, "-l", os.path.join(root, "log"), "-w", "-o", f"-h '' -k {root} -p 5432 -c TimeZone=Asia/Dubai", "start"],
                   check=True, capture_output=True, text=True)
    try:
        with psycopg.connect(host=root, port=5432, dbname="postgres", user="inspire", autocommit=True) as conn, conn.cursor() as cur:
            cur.execute(f'CREATE SCHEMA "{PG_SCHEMA}"')
            create(cur, "n01_u05__trend", TREND_COLUMNS + [ROW], trend_rows())
            create(cur, "n01_u05__records", RECORD_COLUMNS + [ROW], records_rows())
            create(cur, "n01_u05__p_records", RECORD_COLUMNS + [ROW], previous_records_rows())
            create(cur, "loss_desk_out", RESULT_COLUMNS + [ROW], result_rows())
            cur.execute(f'CREATE TABLE "{PG_SCHEMA}"."kinds" (' + ", ".join(f'"{c["name"]}" {PG_TYPES[c["type"]]}' for c in KIND_COLUMNS) + ")")
            for row in KIND_ROWS:
                cur.execute(f'INSERT INTO "{PG_SCHEMA}"."kinds" VALUES (' + ", ".join(["%s"] * len(KIND_COLUMNS)) + ")",
                            [json.dumps(row.get(c["name"])) if PG_TYPES[c["type"]] == "jsonb" and row.get(c["name"]) is not None
                             else row.get(c["name"]) for c in KIND_COLUMNS])
        yield {"host": root, "port": 5432}
    finally:
        subprocess.run([pg_ctl, "-D", data, "-m", "immediate", "-w", "stop"], capture_output=True, text=True)
        shutil.rmtree(root, ignore_errors=True)


class CredentialWorkspace(FakeWorkspace):
    def call(self, method, path, body=None):
        if (method, path) == CREDENTIALS:
            return {"token": "local", "expire_time": iso(NOW + 3600)}
        if (method, path) == ("GET", PIPELINE):
            return {"latest_updates": [{"state": "COMPLETED", "creation_time": api_time(RUN_AT.timestamp())}]}
        raise AssertionError(f"unexpected call {method} {path}")

    def run_sql(self, warehouse, sql, params, limit=5000):
        if sql.split(" WHERE ")[0].endswith("FROM `main`.`pricing`.`loss_desk_out_summary`") or sql.startswith(
                "SELECT b.`action_batch` AS `batch_id`"):
            self.sql.append((sql, params, limit))
            return {"columns": [], "rows": [], "truncated": False}
        raise AssertionError(f"the warehouse was asked: {sql}")


def real_shell(postgres, tmp_path):
    def local(**kwargs):
        return psycopg.connect(host=postgres["host"], port=postgres["port"], dbname="postgres", user="inspire",
                               connect_timeout=kwargs["connect_timeout"], autocommit=kwargs["autocommit"])

    ws = CredentialWorkspace()
    held = backend(True)
    held["tables"][PREVIOUS_RECORDS] = {"pg": f"{PG_SCHEMA}.n01_u05__p_records", "columns": RECORD_COLUMNS + [ROW]}
    held["previous"] = {"n01_u05": {"records": PREVIOUS_RECORDS}}
    settings = dict(MODIFY, options=dict(MODIFY["options"], decisions=True), backend=held)
    s = shell_core.Shell(app_dir(tmp_path, settings, [edit_page()]), env=dict(PG_ENV), sp_factory=lambda: ws,
                         user_factory=lambda h, t: ws, clock=lambda: RUN_AT.timestamp() + 86400,
                         lakebase_factory=lambda b, env, service: shell_pg.Lakebase(b, env, service, connect=local), strict=True)
    return s, ws


def test_every_check_query_of_a_page_runs_on_a_real_postgres_with_no_problem(postgres, tmp_path):
    s, _ws = real_shell(postgres, tmp_path)
    assert s.lakebase is not None
    histories, original = [], s.record_history
    s.record_history = lambda headers, query: histories.append(query) or original(headers, query)
    assert s.check({}) == []
    assert histories == [{"page": "n01_u05", "key": "5"}], "the build check reads a record's history on Lakebase"


def test_the_app_info_of_a_lakebase_app_says_when_its_tables_were_last_copied(postgres, tmp_path):
    s, _ws = real_shell(postgres, tmp_path)
    status, info = call(s, "GET", "app")
    assert status == 200, info
    assert info["backend"] == {"note": "", "catching_up": False, "synced_at": iso(RUN_AT.timestamp()), "kind": "lakebase"}


def test_kpis_charts_and_the_decision_list_on_postgres_match_the_data(postgres, tmp_path):
    s, _ws = real_shell(postgres, tmp_path)
    chosen = {"run_date": {"from": "2026-05-01", "to": "2026-10-31"}, "category": ["Books", "Music"]}
    status, data = call(s, "POST", "page", body={"page": "n01_u05", "filters": chosen})
    assert status == 200 and data["errors"] == {} and data["served"] == ["lakebase"]

    def total(low, high, measure="loss"):
        return sum(r[measure] for r in trend_rows() if r["category"] in chosen["category"]
                   and datetime.date.fromisoformat(low) <= r["as_of_date"] <= datetime.date.fromisoformat(high))

    assert data["kpis"]["total_loss"] == {"now": total("2026-05-01", "2026-10-31"), "before": None}
    assert data["kpis"]["loss_rate"]["now"] == pytest.approx(total("2026-05-01", "2026-10-31") /
                                                             total("2026-05-01", "2026-10-31", "revenue") * 100)
    assert data["kpis"]["items"] == {"now": 4, "before": 1}, "the previous run's copy answers on Lakebase with the same filters"
    assert sum(1 for n in ITEMS if item(n)["category"] in chosen["category"]) == 4
    assert [n for n in PREVIOUS_ITEMS if item(n)["category"] in chosen["category"]] == [42], "item 5 is in Games, outside the filter"
    by_category = {r["x"]: r["y0"] for r in data["charts"]["by_category"]["rows"]}
    listed = {c: sum(float(item(n)["value"]) for n in ITEMS if item(n)["category"] == c) for c in chosen["category"]}
    assert by_category == pytest.approx(listed), "the Drivers chart ranks the listed items' loss by category"
    assert [r["x"] for r in data["charts"]["loss_trend"]["rows"]] == [m.isoformat() for m in MONTHS[6:]]
    status, records = call(s, "POST", "records", body={"page": "n01_u05", "filters": {}})
    assert status == 200 and records["errors"] == {} and records["served"] == ["lakebase"]
    assert records["total"] == len(ITEMS) and [r["entity_id"] for r in records["rows"]] == list(ITEMS)
    first = records["rows"][0]
    assert first["entity_label"] == "Item 5 (50% off)" and first["top_reasons"] == ["deep discount", "reason 5"]
    assert first["value"] == 105.25 and first["as_of_date"] == "2026-10-15"
    status, found = call(s, "POST", "records", body={"page": "n01_u05", "filters": {}, "search": "50%"})
    assert status == 200 and [r["entity_id"] for r in found["rows"]] == [5], "a % in the search is a literal %"
    status, options = call(s, "GET", "filters/options", {"page": "n01_u05", "filter": "category", "q": "us"})
    assert status == 200 and options["options"] == ["Music"]


def test_history_things_to_fix_and_runs_on_postgres_read_the_result_table_like_the_warehouse(postgres, tmp_path):
    s, _ws = real_shell(postgres, tmp_path)
    status, history = call(s, "GET", "records/history", {"page": "n01_u05", "record_key": "42"})
    assert status == 200, history
    assert [v["valid_from_us"] for v in history["versions"]] == [str(int(OLD_RUN_AT.timestamp()) * 1_000_000),
                                                                 str(int(RUN_AT.timestamp()) * 1_000_000)]
    assert [v["run_id"] for v in history["versions"]] == [76, 77] and history["current"]["valid_from"] == "2026-10-15T06:00:00.000Z"
    assert all(shell_pg.ROW_COLUMN not in v for v in history["versions"] + [history["current"]])
    columns = [c["name"] for c in s.lakebase.run(f"SELECT * FROM {TABLE} LIMIT 0", [], 1)["columns"]]
    assert columns == [c["name"] for c in RESULT_COLUMNS]
    status, things = call(s, "POST", "overview", body={"page": "n01_u05", "filters": {}})
    assert status == 200 and things["errors"] == {} and things["pages"]["n01_u05"]["served"] == shell_pg.LAKEBASE, things
    status, runs = call(s, "GET", "runs", {"page": "n01_u05"})
    assert status == 200 and [r["run_id"] for r in runs["runs"]][:2] == ["77", "76"] and runs["errors"] == {}
    assert {q.split(" FROM ")[0] for q, _p, _l in _ws.sql} == {"SELECT CAST(`run_id` AS STRING) AS `run_id`, `updated_at`", "SELECT *"} and all(
        "_summary" in q for q, _p, _l in _ws.sql), "Lakebase serves the result table; only the run's summary row is read on Delta"


def test_spark_sql_the_shell_writes_gives_the_same_answer_on_postgres(postgres, tmp_path):
    s, _ws = real_shell(postgres, tmp_path)
    out = s.lakebase.run(
        f"SELECT 'a%b' AS s, 7 % 3 AS m, COUNT_IF(loss > 30) AS c, IF(SUM(loss) > 0, 'y', 'n') AS f, "
        f"CAST(unix_micros(MAX(TIMESTAMP '2026-10-15 06:00:00')) AS STRING) AS us FROM {TREND_VIEW}", [], 5)
    assert out["rows"] == [{"s": "a%b", "m": 1, "c": sum(1 for r in trend_rows() if r["loss"] > 30), "f": "y",
                            "us": str(int(RUN_AT.timestamp()) * 1_000_000)}]


def test_lakebase_reads_cannot_write(postgres, tmp_path):
    s, _ws = real_shell(postgres, tmp_path)
    counted = f'SELECT COUNT(*) FROM "{PG_SCHEMA}"."kinds"'
    before = s.lakebase.query(counted, {}, 1)[2]
    for statement in (f'CREATE TABLE "{PG_SCHEMA}".nope (a int)',
                      f'WITH x AS (DELETE FROM "{PG_SCHEMA}"."kinds" RETURNING 1) SELECT * FROM x'):
        with pytest.raises(shell_db.QueryError):
            s.lakebase.query(statement, {}, 1)
    assert s.lakebase.query("SELECT COUNT(*) FROM pg_tables WHERE tablename = 'nope'", {}, 1)[2] == [(0,)]
    assert s.lakebase.query(counted, {}, 1)[2] == before and before != [(0,)], \
        "a read runs in a read-only transaction through a cursor that only a query can open"


def test_a_record_question_on_lakebase_reads_the_record_from_postgres_and_never_the_warehouse(postgres, tmp_path):
    s, ws = real_shell(postgres, tmp_path)
    status, out = call(s, "POST", "genie/ask", body={"question": "Are there others like this?", "page": "n01_u05", "record_key": "42"})
    assert status == 200, out
    assert 'The record "Item 42", as the App read it just now:\n' in out["question"]
    assert "- Keys: entity_id = 42, record_key = 42, run_id = 77, use_case_id = N01-U05, as_of_date = 2026-10-15\n" in out["question"]
    assert "- Tier (priority_tier): Act now\nQuestion: Are there others like this?\n" in out["question"]
    assert ws.genie == [(SETTINGS["genie"]["space_id"], out["question"], "")]
    status, out = call(s, "POST", "genie/ask", body={"question": "Why?", "page": "n01_u05", "record_key": "999"})
    assert (status, out["error"]) == (404, "The App did not ask Genie about this record: the App cannot read it, or it is no longer on the list")
    assert len(ws.genie) == 1


@pytest.fixture()
def kinds_lakebase(postgres):
    def local(**kwargs):
        return psycopg.connect(host=postgres["host"], port=postgres["port"], dbname="postgres", user="inspire",
                               connect_timeout=kwargs["connect_timeout"], autocommit=kwargs["autocommit"])

    tables = {KINDS: {"pg": f"{PG_SCHEMA}.kinds", "columns": KIND_COLUMNS}}
    lb = shell_pg.Lakebase({"pipeline_id": "pipeline-1", "tables": tables, "datasets": {}}, PG_ENV, lambda: CredentialWorkspace(),
                           connect=local)
    yield lb
    lb.close()


def answer(lb, sql):
    return lb.run(sql, [{"name": "keys", "value": '["3", "8"]', "type": "STRING"}], 50)["rows"]


def same(got, expected):
    if isinstance(expected, float):
        return got == pytest.approx(expected, rel=1e-6)
    if isinstance(expected, list) and isinstance(got, list):
        return sorted(got, key=str) == sorted(expected, key=str)
    if isinstance(expected, bool) or expected is None:
        return got is expected
    return got == expected and (type(got) is int if isinstance(expected, int) else True)


@pytest.mark.parametrize("expression,expected", SPARK_ANSWERS, ids=[e for e, _x in SPARK_ANSWERS])
def test_every_spark_function_lakebase_serves_gives_sparks_answer_on_a_real_postgres(kinds_lakebase, expression, expected):
    rows = answer(kinds_lakebase, f"SELECT {expression} AS x FROM {KINDS} WHERE k = 'a'")
    assert len(rows) == 1 and same(rows[0]["x"], expected), rows


@pytest.mark.parametrize("expression,expected", SPARK_TOTALS, ids=[e for e, _x in SPARK_TOTALS])
def test_every_spark_aggregate_lakebase_serves_gives_sparks_answer_on_a_real_postgres(kinds_lakebase, expression, expected):
    rows = answer(kinds_lakebase, f"SELECT {expression} AS x FROM {KINDS}")
    assert len(rows) == 1 and same(rows[0]["x"], expected), rows


@pytest.mark.parametrize("sql,expected", SPARK_QUERIES, ids=[str(i) for i in range(len(SPARK_QUERIES))])
def test_explode_inline_and_null_ordering_give_sparks_rows_on_a_real_postgres(kinds_lakebase, sql, expected):
    assert answer(kinds_lakebase, sql) == expected


def test_every_function_name_the_renderer_writes_exists_in_postgres(kinds_lakebase, postgres):
    import sqlglot
    from sqlglot import exp
    with psycopg.connect(host=postgres["host"], port=postgres["port"], dbname="postgres", user="inspire") as conn, conn.cursor() as cur:
        cur.execute("SELECT DISTINCT lower(proname) FROM pg_proc")
        known = {r[0] for r in cur.fetchall()}
    written = set()
    for expression, _expected in SPARK_ANSWERS + SPARK_TOTALS:
        text, _values, _read = shell_pg.render(f"SELECT {expression} AS x FROM {KINDS}", [], kinds_lakebase.tables)
        tree = sqlglot.parse_one(text.replace("%%", "%"), read="postgres")
        written |= {n.name.lower() for n in tree.find_all(exp.Anonymous)}
    assert written and written <= known, sorted(written - known)


class OverlayWorkspace(CredentialWorkspace):
    def __init__(self, saved):
        super().__init__()
        self.saved = saved

    def run_sql(self, warehouse, sql, params, limit=5000):
        if sql.startswith("MERGE"):
            self.sql.append((sql, params, limit))
            return {"columns": [], "rows": [{"num_inserted_rows": 1}], "truncated": False}
        for marker, (column, rows) in self.saved.items():
            if f" FROM {marker} WHERE CAST({shell_pg.quoted(column)} AS STRING) IN " in sql:
                self.sql.append((sql, params, limit))
                keys = set(json.loads(params[0]["value"]))
                return {"columns": [], "rows": [r for r in rows if str(r[column]) in keys], "truncated": False}
        return super().run_sql(warehouse, sql, params, limit)


def warehouse_cells(row):
    return {k: json.loads(v) if k == "top_reasons" else shell_pg.cell(v) for k, v in row.items() if k != shell_pg.ROW_COLUMN}


def test_a_saved_change_shows_on_top_of_lakebase_while_the_list_reads_postgres_and_nothing_else_hits_the_warehouse(postgres, tmp_path):
    edited_at = datetime.datetime(2026, 10, 20, 9, 0, tzinfo=UTC)
    old = [dict(r) for r in result_rows() if r["record_key"] == "42"]
    for r in old:
        if r["is_current"]:
            r.update(is_current=False, valid_to=edited_at)
    current = dict(next(r for r in result_rows() if r["record_key"] == "42" and r["is_current"]), recommended_action="Hold the price",
                   valid_from=edited_at, change_source="edit", changed_by="pat.lee", action_status="In progress")
    view = dict(next(r for r in records_rows() if r["record_key"] == "42"), recommended_action="Hold the price")
    records_sql = next(d["sql"] for d in PAGE["datasets"] if d["name"] == "records")
    ws = OverlayWorkspace({shell_pg.uc_name(TABLE): ("record_key", [warehouse_cells(r) for r in old + [current]]),
                           f"({records_sql}) AS d": ("record_key", [warehouse_cells(view)])})
    s, _ = real_shell(postgres, tmp_path)
    s.sp_factory, s._sp = (lambda: ws), None
    s.lakebase.service = lambda: ws
    s.lakebase.syncer = s.lakebase.overlayer = threading.current_thread()
    page = s.page("n01_u05")
    fields = s.table_fields(ws, "sp", page)
    s.write_versions(ws, page, fields, "edit", [("42", "1")], "pat.lee", {"recommended_action": "Hold the price"})
    assert set(s.lakebase.held) == {TABLE, RECORDS_VIEW} and s.lakebase.queued.qsize() == 1
    s.lakebase._overlay_loop()
    assert s.lakebase.held == {} and set(s.lakebase.overlays) == {TABLE, RECORDS_VIEW}
    ws.sql.clear()
    status, records = call(s, "POST", "records", body={"page": "n01_u05", "filters": {}})
    assert status == 200 and records["errors"] == {} and records["served"] == ["lakebase"]
    assert records["total"] == len(ITEMS) and [r["entity_id"] for r in records["rows"]] == list(ITEMS)
    edited = next(r for r in records["rows"] if r["entity_id"] == 42)
    assert edited["recommended_action"] == "Hold the price" and edited["top_reasons"] == ["deep discount", "reason 42"]
    assert all(r["recommended_action"] == "Cut the discount" for r in records["rows"] if r["entity_id"] != 42)
    status, history = call(s, "GET", "records/history", {"page": "n01_u05", "record_key": "42"})
    assert status == 200, history
    assert [v["change_source"] for v in history["versions"]] == ["run", "run", "edit"]
    assert history["current"]["recommended_action"] == "Hold the price" and history["current"]["valid_from"] == "2026-10-20T09:00:00.000Z"
    assert all(q.startswith("SELECT * FROM `main`.`pricing`.`loss_desk_out_summary`") for q, _p, _l in ws.sql), \
        "with the change on top, the list and its history read Lakebase, and Delta only for the run's summary row"


READ_ROUTES_SKIPPED = {("POST", "records/act"), ("POST", "refresh")}


def read_routes():
    import inspect
    import re
    found = re.findall(r'route == \("(GET|POST)", "([^"]+)"\)', inspect.getsource(shell_core.Shell.handle))
    return sorted(set(found) - READ_ROUTES_SKIPPED)


def test_every_read_route_of_the_app_runs_its_queries_on_a_real_postgres_without_falling_back(postgres, tmp_path):
    s, ws = real_shell(postgres, tmp_path)
    routes = read_routes()
    assert {("GET", "app"), ("POST", "page"), ("POST", "records"), ("POST", "overview"), ("GET", "runs"),
            ("GET", "records/history"), ("GET", "summary")} <= set(routes)
    assert ("POST", "trend") not in routes
    body = {"page": "n01_u05", "filters": {}, "question": "Why?", "record_key": "42", "title": "Loss", "kind": "chart", "context": {}}
    query = {"page": "n01_u05", "record_key": "42", "filter": "category", "q": "o", "offset": "0", "space_id": "sp1",
             "conversation_id": "c1", "message_id": "m1"}
    answered = {}
    for method, path in routes:
        status, out = call(s, method, path, query if method == "GET" else None, body=body if method == "POST" else None)
        answered[path] = status
        assert status < 500, (method, path, out)
        errors = out.get("errors") if isinstance(out, dict) else None
        flat = json.dumps(errors if isinstance(errors, dict) else {})
        assert "Lakebase" not in flat and "lakebase" not in flat, (method, path, errors)
    assert all(answered[p] == 200 for p in ("app", "page", "records", "overview", "runs", "records/history", "summary")), answered
    batches = [q for q, _p, _l in ws.sql if q.startswith("SELECT b.`action_batch` AS `batch_id`")]
    assert len(batches) == 1, "the acts people made are versions Lakebase does not copy, so GET records/batches reads Delta"
    assert all(q.split(" WHERE ")[0].endswith("`loss_desk_out_summary`") for q, _p, _l in ws.sql if q not in batches), [
        q for q, _p, _l in ws.sql]


def test_the_local_test_requirements_pin_the_exact_lakebase_packages_the_app_installs():
    with open(os.path.join(ROOT, "requirements.txt"), encoding="utf-8") as handle:
        listed = {line.strip() for line in handle if line.strip() and not line.lstrip().startswith("#")}
    from _agentload import load_agent_namespace
    pins = load_agent_namespace()["INSPIRE_ASSET_WHEELS"]
    shipped = {f"sqlglot=={pins['sqlglot']}", f"psycopg[binary]=={pins['psycopg']}"}
    assert shipped <= listed and pins["psycopg-binary"] == pins["psycopg"], \
        "the tests must run the sqlglot and psycopg the App gets from the Inspire assets, or they pass on code it never ships"
    import sqlglot
    assert sqlglot.__version__ == pins["sqlglot"] and psycopg.__version__ == pins["psycopg"]
