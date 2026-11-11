import copy
import json
import os
import shutil
import subprocess
import sys
import tempfile

import psycopg
import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_core  # noqa: E402
import shell_db  # noqa: E402
import shell_pg  # noqa: E402
from v141_app_shell_test import PAGE, SETTINGS, app_dir  # noqa: E402
from v145_lakebase_test import PG_BIN  # noqa: E402

PORT = 5439
ORDERS = "main.sales.orders"
OTHER = "main.sales.returns"
ENV = {"PGHOST": "instance-1.database.example.com", "PGPORT": "5432", "PGDATABASE": "databricks_postgres", "PGUSER": "app_sp",
       "LAKEBASE_ENDPOINT": "projects/inspire-apps/branches/production/endpoints/primary", "DATABRICKS_WAREHOUSE_ID": "wh1",
       "DATABRICKS_HOST": "dbc-1.example.com"}
COLUMNS = [{"name": "order_id", "type": "LONG", "type_text": "BIGINT"}, {"name": "region", "type": "STRING", "type_text": "STRING"},
           {"name": "amount", "type": "LONG", "type_text": "BIGINT"}]
ENFORCE = {"column": "region", "map": "base.orders_access", "key": "region", "principal": "principal"}
ORDER_ROWS = [(1, "North", 10), (2, "South", 20), (3, "East", 30), (4, "North", 40), (5, "West", 50)]
SQL = "SELECT `order_id` FROM `main`.`sales`.`orders` ORDER BY `order_id`"


def orders_entry(view="app.orders"):
    return {"pg": view, "base": "base.orders", "columns": COLUMNS, "enforce": [ENFORCE]}


def backend(extra_tables=None):
    tables = {ORDERS: orders_entry()}
    tables.update(extra_tables or {})
    return {"kind": "lakebase", "enforced": True, "pipeline_id": "pipeline-1", "tables": tables, "datasets": {}}


def viewer(email, groups=()):
    return shell_pg.viewer_principals(email, groups)


@pytest.fixture(scope="module")
def enforced_pg():
    if PG_BIN is None:
        pytest.skip("PostgreSQL is not installed here, so the enforced Lakebase reads cannot run on a real Postgres")
    root = tempfile.mkdtemp(prefix="ilbp", dir="/tmp")
    data, pg_ctl = os.path.join(root, "d"), os.path.join(PG_BIN, "pg_ctl")
    subprocess.run([os.path.join(PG_BIN, "initdb"), "-D", data, "-U", "inspire", "--auth=trust", "-E", "UTF8", "--no-locale"],
                   check=True, capture_output=True, text=True)
    subprocess.run([pg_ctl, "-D", data, "-l", os.path.join(root, "log"), "-w", "-o", f"-h '' -k {root} -p {PORT}", "start"],
                   check=True, capture_output=True, text=True)
    try:
        with psycopg.connect(host=root, port=PORT, dbname="postgres", user="inspire", autocommit=True) as conn, conn.cursor() as cur:
            cur.execute("CREATE ROLE inspire_owner NOLOGIN")
            cur.execute("CREATE ROLE app_sp LOGIN")
            cur.execute("CREATE SCHEMA base AUTHORIZATION inspire_owner")
            cur.execute("CREATE SCHEMA app AUTHORIZATION inspire_owner")
            cur.execute("SET ROLE inspire_owner")
            cur.execute("CREATE TABLE base.orders (order_id bigint, region text, amount bigint)")
            cur.executemany("INSERT INTO base.orders VALUES (%s, %s, %s)", ORDER_ROWS)
            cur.execute("CREATE TABLE base.orders_access (principal text, region text)")
            cur.executemany("INSERT INTO base.orders_access VALUES (%s, %s)",
                            [("alice@example.com", "North"), ("bob@example.com", "South"), ("region-east", "East"), ("REGION-WEST", "West")])
            cur.execute(shell_pg.enforcing_view_sql(orders_entry()))
            cur.execute("RESET ROLE")
            cur.execute("GRANT USAGE ON SCHEMA app TO app_sp")
            cur.execute("GRANT SELECT ON app.orders TO app_sp")
        yield {"host": root, "port": PORT}
    finally:
        subprocess.run([pg_ctl, "-D", data, "-m", "immediate", "-w", "stop"], capture_output=True, text=True)
        shutil.rmtree(root, ignore_errors=True)


def local(**kwargs):
    return psycopg.connect(host=kwargs["host"], port=kwargs["port"], dbname="postgres", user=kwargs["user"],
                           connect_timeout=kwargs["connect_timeout"], autocommit=kwargs["autocommit"])


def lakebase_on(pg, entry_backend=None):
    def connect(**kwargs):
        return local(host=pg["host"], port=pg["port"], user=kwargs["user"], connect_timeout=kwargs["connect_timeout"],
                     autocommit=kwargs["autocommit"])
    service = ServicePrincipal()
    return shell_pg.Lakebase(entry_backend or backend(), ENV, lambda: service, connect=connect)


class ServicePrincipal:
    def __init__(self):
        self.sql = []

    def call(self, method, path, body=None, params=None):
        return {"token": "lakebase-password", "expire_time": "2099-01-01T00:00:00Z"}

    def run_sql(self, warehouse, statement, parameters=None, limit=5000):
        self.sql.append(statement)
        raise AssertionError("the App's service principal must never read Delta rows of an enforced App")


class Viewer:
    """A signed-in person: their token resolves to their own email and groups through SCIM Me."""

    def __init__(self, token, email, groups=()):
        self.token, self.email, self.groups = token, email, list(groups)
        self.sql = []

    def call(self, method, path, body=None, params=None):
        if path == shell_core.SCIM_ME_PATH:
            return {"userName": self.email, "groups": [{"display": g} for g in self.groups]}
        raise AssertionError(path)

    def run_sql(self, warehouse, statement, parameters=None, limit=5000):
        self.sql.append(statement)
        return {"columns": [{"name": "order_id", "type": "LONG"}], "rows": [{"order_id": 99}], "truncated": False}


VIEWERS = {"tok-alice": ("alice@example.com", ()), "tok-bob": ("bob@example.com", ()), "tok-carol": ("carol@example.com", ("region-east",)),
           "tok-dana": ("dana@example.com", ("region-west",))}


def shell_for(tmp_path, pg, settings_backend=None, strict=False):
    service = ServicePrincipal()
    users = {}

    def user_factory(host, token):
        if token not in users:
            email, groups = VIEWERS[token]
            users[token] = Viewer(token, email, groups)
        return users[token]

    settings = dict(SETTINGS, auth="user", backend=settings_backend or backend())
    s = shell_core.Shell(app_dir(tmp_path, settings, [PAGE]), env=dict(ENV), sp_factory=lambda: service, user_factory=user_factory,
                         lakebase_factory=lambda b, env, svc: shell_pg.Lakebase(b, env, svc, connect=lambda **kw: local(
                             host=pg["host"], port=pg["port"], user=kw["user"], connect_timeout=kw["connect_timeout"],
                             autocommit=kw["autocommit"])), strict=strict)
    return s, service, users


def user_ws(s, token):
    ws, _who = s.workspace({"x-forwarded-access-token": token})
    return ws


def order_ids(rows):
    return sorted(r["order_id"] for r in rows)


def test_viewer_principals_are_the_lowercase_email_and_groups_and_nothing_else():
    assert shell_pg.viewer_principals("alice@example.com", ["Region-East", "analysts"]) == "alice@example.com,analysts,region-east"
    for bad in (("x' OR '1'='1", ()), ("a@example.com", ("grp, other",)), ("", ()), ("a@example.com", ("two words",))):
        with pytest.raises(ValueError):
            shell_pg.viewer_principals(*bad)


def test_the_view_filters_on_the_viewer_setting_and_is_security_barrier():
    sql = shell_pg.enforcing_view_sql(orders_entry())
    assert "WITH (security_barrier = true)" in sql
    assert "current_setting('inspire.viewer', true)" in sql
    assert '"base"."orders"' in sql and '"base"."orders_access"' in sql


def test_each_viewer_sees_only_the_rows_their_mapping_names_on_postgres(enforced_pg):
    lb = lakebase_on(enforced_pg)
    rows = lambda who: order_ids(lb.run(SQL, [], 100, viewer=who)["rows"])  # noqa: E731
    assert rows(viewer("alice@example.com")) == [1, 4]
    assert rows(viewer("bob@example.com")) == [2]
    assert rows(viewer("carol@example.com", ["region-east"])) == [3], "a group row lets its members see the rows it maps"
    assert rows(viewer("carol@example.com")) == [], "a viewer with no mapping sees no rows, and no error"
    assert rows(viewer("dana@example.com", ["region-west"])) == [5], "a mapping row written in capitals still matches the lowercase group"


def test_a_read_with_no_viewer_is_refused_before_it_reaches_postgres(enforced_pg):
    lb = lakebase_on(enforced_pg)
    with pytest.raises(shell_pg.LakebaseError, match="could not tell who is signed in"):
        lb.run(SQL, [], 100, viewer="")


def test_the_app_role_cannot_select_a_synced_base_table_on_postgres(enforced_pg):
    with psycopg.connect(host=enforced_pg["host"], port=PORT, dbname="postgres", user="app_sp", autocommit=True) as conn:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("SELECT * FROM base.orders")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("SELECT * FROM base.orders_access")
        assert conn.execute("SELECT count(*) FROM app.orders").fetchone()[0] == 0, "no setting means no rows"


def test_the_app_refuses_to_connect_when_its_role_can_read_a_base_table(enforced_pg):
    with psycopg.connect(host=enforced_pg["host"], port=PORT, dbname="postgres", user="inspire", autocommit=True) as conn:
        conn.execute("GRANT USAGE ON SCHEMA base TO app_sp")
        conn.execute("GRANT SELECT ON base.orders TO app_sp")
    try:
        lb = lakebase_on(enforced_pg)
        with pytest.raises(shell_pg.LakebaseError, match="can read a synced base table"):
            lb.run(SQL, [], 100, viewer=viewer("alice@example.com"))
    finally:
        with psycopg.connect(host=enforced_pg["host"], port=PORT, dbname="postgres", user="inspire", autocommit=True) as conn:
            conn.execute("REVOKE SELECT ON base.orders FROM app_sp")
            conn.execute("REVOKE USAGE ON SCHEMA base FROM app_sp")


def test_a_forged_identity_header_is_ignored_and_the_token_decides(tmp_path, enforced_pg):
    s, _sp, _users = shell_for(tmp_path, enforced_pg)
    ws, _who = s.workspace({"x-forwarded-access-token": "tok-bob", "x-forwarded-email": "alice@example.com"})
    assert s.viewer_of(ws) == "bob@example.com", "the header names alice, but the token is bob's and the token decides"


def test_two_people_reading_one_enforced_app_each_get_only_their_rows(tmp_path, enforced_pg):
    s, _sp, _users = shell_for(tmp_path, enforced_pg)
    alice = s.execute(user_ws(s, "tok-alice"), SQL, [], 100)
    bob = s.execute(user_ws(s, "tok-bob"), SQL, [], 100)
    assert alice["served"] == "lakebase" and order_ids(alice["rows"]) == [1, 4]
    assert order_ids(bob["rows"]) == [2]


def test_a_service_principal_read_of_an_enforced_app_is_refused_and_reads_no_delta(tmp_path, enforced_pg):
    s, sp, _users = shell_for(tmp_path, enforced_pg)
    with pytest.raises(shell_db.HttpError) as caught:
        s.execute(sp, SQL, [], 100)
    assert caught.value.status == 401 and caught.value.message == shell_core.UNKNOWN_VIEWER
    assert sp.sql == [], "the service principal read no Delta rows that every viewer could see"


def test_a_table_the_database_does_not_enforce_reads_delta_as_the_viewer(tmp_path, enforced_pg):
    s, _sp, users = shell_for(tmp_path, enforced_pg)
    other = f"SELECT `order_id` FROM `main`.`sales`.`returns`"
    result = s.execute(user_ws(s, "tok-alice"), other, [], 100)
    assert result["served"] == "delta", "a table with no enforced copy falls back to Delta for that table only"
    assert users["tok-alice"].sql and "returns" in users["tok-alice"].sql[-1], "the Delta read ran as the viewer, under their token"


def test_an_unknown_identity_fails_closed_when_scim_cannot_name_the_viewer(tmp_path, enforced_pg):
    s, _sp, _users = shell_for(tmp_path, enforced_pg)
    ws = user_ws(s, "tok-alice")

    def scim_down(method, path, body=None, params=None):
        raise shell_db.QueryError("scim down")

    ws.call = scim_down
    with pytest.raises(shell_db.HttpError) as caught:
        s.viewer_of(ws)
    assert caught.value.status == 401


def test_backend_problems_refuse_a_per_user_lakebase_app_unless_every_table_is_enforced():
    pages = [PAGE]
    assert shell_pg.backend_problems(backend(), "user", pages) == []
    unenforced = copy.deepcopy(backend())
    unenforced["enforced"] = False
    assert any("reads Lakebase only when the database enforces" in p for p in shell_pg.backend_problems(unenforced, "user", pages))
    assert any("only an App where each viewer signs in" in p for p in shell_pg.backend_problems(backend(), "sp", pages))
    bare = copy.deepcopy(backend())
    bare["tables"][ORDERS] = {"pg": "app.orders", "base": "base.orders", "columns": COLUMNS}
    assert any("is not enforced" in p for p in shell_pg.backend_problems(bare, "user", pages))
    filtered_missing = copy.deepcopy(backend())
    filtered_missing["tables"][ORDERS]["enforce"] = [dict(ENFORCE, column="country")]
    assert any("filters on country" in p for p in shell_pg.backend_problems(filtered_missing, "user", pages))
    bad_map = copy.deepcopy(backend())
    bad_map["tables"][ORDERS]["enforce"] = [dict(ENFORCE, map="base.orders-access")]
    assert any("needs a mapping table that is a Postgres schema.table" in p for p in shell_pg.backend_problems(bad_map, "user", pages))


def test_settings_accept_a_per_user_lakebase_app_that_enforces_its_tables():
    settings = dict(SETTINGS, auth="user", backend=backend())
    assert shell_core.settings_problems(settings, [PAGE]) == []


def test_a_service_principal_builder_resolves_its_viewer_from_its_application_id(tmp_path, enforced_pg):
    service_principal = Viewer("unused", "unused")
    service_principal.call = lambda method, path, body=None, params=None: {"applicationId": "11111111-2222-3333-4444-555555555555",
                                                                          "displayName": "builder"}
    s, _sp, users = shell_for(tmp_path, enforced_pg)
    ws = service_principal
    ws.token_digest = "builder-check"
    assert s.viewer_of(ws) == "11111111-2222-3333-4444-555555555555"
