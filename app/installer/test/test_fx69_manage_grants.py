"""REQ-478, REQ-469: the installer gives Inspire's service principal MANAGE on the data it reads, wherever the installer person can.

Inspire can then share that data with every App it builds, so no Build waits on a permission. MANAGE goes on the catalog when the
person owns or manages it, else on each schema the person owns or manages, else on each table. One block lists only what an admin
still grants, every statement in full.
"""
import contextlib
import io
import types
import unittest
import urllib.parse

import support
import test_setup as ts

setup = support.load_setup()
PREFIX = "/api/2.1/unity-catalog/effective-permissions/catalog/"
ADMIN = "An admin still grants these, so Inspire can share all of this data with the Apps it builds:"


def admin_grant(catalog):
    return f"GRANT MANAGE ON CATALOG `{catalog}` TO `SP`"


def manage(securable, name):
    return ("PATCH", f"/api/2.1/unity-catalog/permissions/{securable}/{urllib.parse.quote(name)}", {"changes": [{"principal": "SP", "add": ["MANAGE"]}]})


class ManageGrantTest(unittest.TestCase):
    def run_step(self, catalogs, rights=None, objects=None, refused=(), unreadable=()):
        """rights: catalog -> what the person holds on it; objects: catalog -> rows (level, schema_name, table_name) the person owns or manages."""
        calls, sql = [], []

        class Statements:
            def execute_statement(self, warehouse_id, statement, wait_timeout):
                sql.append(statement)
                catalog = statement.split("`")[1]
                if catalog in unreadable:
                    raise RuntimeError("PERMISSION_DENIED: cannot read information_schema")
                rows = [list(r) for r in (objects or {}).get(catalog, [])]
                return types.SimpleNamespace(status=ts.statement_ok(), result=types.SimpleNamespace(data_array=rows),
                                             manifest=types.SimpleNamespace(schema=types.SimpleNamespace(
                                                 columns=[types.SimpleNamespace(name=n) for n in ("level", "schema_name", "table_name")])))

        def api(method, path, body=None):
            calls.append((method, path, body))
            return ts.Resp(403 if any(path.endswith(r) for r in refused) else 200, {})

        def api_get(path):
            name = path[len(PREFIX):].split("?")[0]
            return {"privilege_assignments": [{"principal": "someone@example.com", "privileges": [{"privilege": p} for p in (rights or {}).get(name, ())]}]}

        ctx = {"w": types.SimpleNamespace(statement_execution=Statements(), catalogs=types.SimpleNamespace(get=lambda name: types.SimpleNamespace(owner="x"))),
               "WAREHOUSE_ID": "wh", "CATALOG": "main", "DATA_CATALOGS": list(catalogs), "READ_GRANTED": list(catalogs), "api": api,
               "api_get": api_get, "USER_EMAIL": "someone@example.com", "USER_GROUPS": ["admins"], "CATALOG_OWNERS": {}}
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            setup._grant_data_manage(ctx, "SP")
        return [c for c in calls if c[0] == "PATCH"], sql, out.getvalue()

    def admin_block(self, said):
        lines = said.splitlines()
        if ADMIN not in lines:
            return []
        return [line.strip() for line in lines[lines.index(ADMIN) + 1:] if line.strip().startswith("GRANT ")]

    def test_a_catalog_the_person_manages_gets_manage_on_the_catalog_and_no_admin_line(self):
        patches, sql, said = self.run_step(["sales"], rights={"sales": ("MANAGE",)})
        self.assertEqual(patches, [manage("catalog", "sales")])
        self.assertEqual(sql, [], "a catalog-level grant needs no object read")
        self.assertEqual(self.admin_block(said), [])

    def test_a_catalog_the_person_does_not_manage_gets_manage_on_each_owned_schema_and_each_owned_table_outside_them(self):
        rows = [("schema", "s1", ""), ("table", "s1", "inside"), ("table", "s2", "t1"), ("table", "s2", "t1")]
        patches, sql, said = self.run_step(["fin"], rights={"fin": ("USE_CATALOG",)}, objects={"fin": rows})
        self.assertEqual(patches, [manage("schema", "fin.s1"), manage("table", "fin.s2.t1")])
        self.assertEqual(len(sql), 1)
        for part in ("information_schema.schemata", "schema_owner", "information_schema.schema_privileges", "information_schema.tables",
                     "table_owner", "information_schema.table_privileges", "'MANAGE'", "current_user()", "is_account_group_member"):
            self.assertIn(part, sql[0])
        self.assertEqual(self.admin_block(said), [admin_grant("fin")])

    def test_the_admin_block_lists_every_catalog_in_full_with_no_and_n_more(self):
        names = [f"cat_{i:02d}" for i in range(14)]
        _, _, said = self.run_step(names, rights={n: ("USE_CATALOG",) for n in names})
        self.assertEqual(self.admin_block(said), [admin_grant(n) for n in names])
        self.assertNotIn(" more", said)

    def test_a_refused_or_unreadable_grant_names_its_catalog_for_the_admin_and_never_stops_the_install(self):
        patches, _, said = self.run_step(["sales", "ops"], rights={"sales": ("MANAGE",), "ops": ("USE_CATALOG",)}, refused=("catalog/sales",),
                                         unreadable=("ops",))
        self.assertEqual(patches, [manage("catalog", "sales")])
        self.assertEqual(self.admin_block(said), [admin_grant("sales"), admin_grant("ops")])

    def test_the_install_grants_manage_on_every_picked_data_catalog_the_person_manages(self):
        api, calls = ts.lakebase_api(catalog=((200, ts.BOUND),), make_catalog=ts.REFUSED_CATALOG)
        ts.GrantPlanTest.grant(self, ["sales", "finance"], api=api)
        patches = [c for c in calls if c[0] == "PATCH" and "/unity-catalog/permissions/" in c[1]]
        for catalog in ("sales", "finance"):
            self.assertIn(manage("catalog", catalog), patches)


if __name__ == "__main__":
    unittest.main()
