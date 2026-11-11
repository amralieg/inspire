import datetime
import os
import sys

import psycopg
import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_pg  # noqa: E402
import shell_sql  # noqa: E402
from rc7p_per_user_lakebase_test import ENV, enforced_pg, local  # noqa: E402,F401
from v141_app_shell_test import PAGE  # noqa: E402
from v148_app_hub_test import COLUMNS, PERSON, TABLE, TYPES  # noqa: E402
from v179_my_work_test import WORK_ROWS  # noqa: E402

PG = {"STRING": "text", "INT": "integer", "DOUBLE": "double precision", "DATE": "date", "TIMESTAMP": "timestamptz",
      "BOOLEAN": "boolean", "LONG": "bigint"}
COLS = [{"name": c, "type": TYPES.get(c, "STRING")} for c in COLUMNS]


class ServicePrincipal:
    def call(self, method, path, body=None, params=None):
        return {"token": "lakebase-password", "expire_time": "2099-01-01T00:00:00Z"}


def _value(row, column):
    value = row.get(column)
    if column == "is_current" and value is not None:
        return bool(value)
    return value


@pytest.fixture
def work_copy(enforced_pg):
    host, port = enforced_pg["host"], enforced_pg["port"]
    with psycopg.connect(host=host, port=port, dbname="postgres", user="inspire", autocommit=True) as conn:
        conn.execute("CREATE SCHEMA wbase AUTHORIZATION inspire_owner")
        conn.execute("CREATE SCHEMA wapp AUTHORIZATION inspire_owner")
        conn.execute("SET ROLE inspire_owner")
        conn.execute("CREATE TABLE wbase.loss (" + ", ".join(f'"{c["name"]}" {PG[c["type"]]}' for c in COLS) + ")")
        for row in WORK_ROWS:
            conn.execute("INSERT INTO wbase.loss VALUES (" + ", ".join(["%s"] * len(COLS)) + ")",
                         [_value(row, c["name"]) for c in COLS])
        conn.execute("CREATE TABLE wbase.access (principal text, record_key text)")
        conn.execute("INSERT INTO wbase.access VALUES ('pat.lee@example.com', 'a1'), ('pat.lee@example.com', 'a2'), "
                     "('pat.lee@example.com', 'a3'), ('pat.lee@example.com', 'a4')")
        conn.execute("CREATE TABLE wbase.access2 (principal text, record_key text)")
        conn.execute("INSERT INTO wbase.access2 VALUES ('pat.lee@example.com', 'a2'), ('pat.lee@example.com', 'a3'), "
                     "('pat.lee@example.com', 'a9')")
        conn.execute("RESET ROLE")
    yield {"host": host, "port": port}
    with psycopg.connect(host=host, port=port, dbname="postgres", user="inspire", autocommit=True) as conn:
        conn.execute("DROP SCHEMA IF EXISTS wapp CASCADE")
        conn.execute("DROP SCHEMA IF EXISTS wbase CASCADE")


def _view(conn, enforces):
    conn.execute("SET ROLE inspire_owner")
    conn.execute(shell_pg.enforcing_view_sql({"pg": "wapp.loss", "base": "wbase.loss", "enforce": enforces}))
    conn.execute("RESET ROLE")
    conn.execute("GRANT USAGE ON SCHEMA wapp TO app_sp")
    conn.execute("GRANT SELECT ON wapp.loss TO app_sp")


def _work_sql(person):
    page = dict(PAGE, result_table=TABLE, records=dict(PAGE.get("records") or {}, key="record_key"))
    bounds = shell_sql.period_params({}, datetime.datetime(2026, 10, 24, 12, 0, tzinfo=datetime.timezone.utc))
    return shell_sql.my_work_query(page, {c["name"] for c in COLS}, person, bounds, 50, None)


def _activity_keys(result):
    return {row["k"] for row in result["rows"] if row.get("k")}


def _backend(enforces):
    return {"kind": "lakebase", "enforced": True, "pipeline_id": "pipe-1", "datasets": {}, "tables": {
        TABLE: {"pg": "wapp.loss", "base": "wbase.loss", "columns": COLS, "enforce": enforces}}}


def _reader(copy, backend):
    def connect(**kw):
        return local(host=copy["host"], port=copy["port"], user=kw["user"], connect_timeout=kw["connect_timeout"],
                     autocommit=kw["autocommit"])
    return shell_pg.Lakebase(backend, ENV, lambda: ServicePrincipal(), connect=connect)


def _everything(copy):
    with psycopg.connect(host=copy["host"], port=copy["port"], dbname="postgres", user="inspire") as conn:
        sql, params = _work_sql(PERSON)
        text, values, _read = shell_pg.render(sql, params, {TABLE: {"pg": "wbase.loss", "columns": COLS}})
        return _activity_from_superuser(conn, text, values)


def _activity_from_superuser(conn, text, values):
    cursor = conn.execute(text, values)
    names = [c.name for c in cursor.description]
    return {dict(zip(names, row)).get("k") for row in cursor.fetchall()} - {None}


def test_work_on_postgres_shows_the_person_only_the_activity_their_mapping_names(work_copy):
    sql, params = _work_sql(PERSON)
    everything = _everything(work_copy)
    assert len(everything) > 2, "the Work fixture has activity for this person on the base copy"
    with psycopg.connect(host=work_copy["host"], port=work_copy["port"], dbname="postgres", user="inspire", autocommit=True) as conn:
        _view(conn, [{"column": "record_key", "map": "wbase.access", "key": "record_key", "principal": "principal"}])
    reader = _reader(work_copy, _backend([{"column": "record_key", "map": "wbase.access", "key": "record_key", "principal": "principal"}]))
    got = _activity_keys(reader.run(sql, params, 200, viewer=shell_pg.viewer_principals(PERSON)))
    assert got == {"a1", "a2", "a3", "a4"}, f"Work shows only the mapped keys; got {sorted(got)}"
    assert got < everything, "the mapping takes activity away: the enforced read is a strict subset of the base read"


def test_two_mappings_are_anded_on_postgres_so_work_keeps_only_keys_both_name(work_copy):
    sql, params = _work_sql(PERSON)
    both = [{"column": "record_key", "map": "wbase.access", "key": "record_key", "principal": "principal"},
            {"column": "record_key", "map": "wbase.access2", "key": "record_key", "principal": "principal"}]
    with psycopg.connect(host=work_copy["host"], port=work_copy["port"], dbname="postgres", user="inspire", autocommit=True) as conn:
        _view(conn, both)
    reader = _reader(work_copy, _backend(both))
    got = _activity_keys(reader.run(sql, params, 200, viewer=shell_pg.viewer_principals(PERSON)))
    assert got and got <= {"a2", "a3"}, f"only keys both mappings name survive the AND; got {sorted(got)}"
    assert "a1" not in got and "a9" not in got, "a1 is named by one mapping only, a9 by the other only (must-exclude)"
