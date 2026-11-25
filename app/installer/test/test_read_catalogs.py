"""The installer's third setting: the data catalogs the Inspire App may read (REQ-132).

The installer lists every catalog the person can see, except system, samples, internal and Delta Sharing
catalogs, in a multi-select that defaults to all of them. On install it asks for consent in one line, runs one
read GRANT per picked catalog to the App's service principal, and prints the GRANT statements for any catalog
the person cannot grant on. A refused grant never fails the install.
"""
import contextlib
import io
import re
import types
import unittest
from unittest import mock

import support
import test_setup as ts

setup = support.load_setup()
READ = "GRANT USE CATALOG, USE SCHEMA, SELECT, BROWSE, READ METADATA ON CATALOG `{0}` TO `SP`"
DATA_KEY = "99_advanced_data_catalogs_inspire_may_read"
ALL = "All catalogs you can use (default)"
CONSENT = "Inspire's App will get read access (USE CATALOG, USE SCHEMA, SELECT, BROWSE, READ METADATA) on: {0}\n"


def cat(name, kind="MANAGED_CATALOG"):
    return types.SimpleNamespace(name=name, owner="data-owners", catalog_type=types.SimpleNamespace(value=kind))


class WidgetHarness(unittest.TestCase):
    """Runs the notebook's runtime context with fake widgets, a fake workspace and the given catalogs."""

    def setUp(self):
        self.saved = (setup.WorkspaceClient, setup._unpack_bundle, getattr(setup, "dbutils", None), getattr(setup, "displayHTML", None))
        self.shown = []
        setup.displayHTML = self.shown.append

    def tearDown(self):
        setup.WorkspaceClient, setup._unpack_bundle, setup.dbutils, setup.displayHTML = self.saved

    def run_context(self, widgets, catalogs):
        setup.dbutils = types.SimpleNamespace(widgets=widgets)
        me = types.SimpleNamespace(user_name="someone@example.com", groups=[])
        wh = types.SimpleNamespace(id="wh1", name="Shared", state=types.SimpleNamespace(value="RUNNING"), enable_serverless_compute=True)

        class Client:
            current_user = types.SimpleNamespace(me=lambda: me)
            config = types.SimpleNamespace(host="https://workspace.example.com", authenticate=lambda: {"Authorization": "Bearer x"})
            warehouses = types.SimpleNamespace(list=lambda: [wh])
            catalogs = types.SimpleNamespace(list=lambda: list(catalogs))

        setup.WorkspaceClient = Client
        setup._unpack_bundle = lambda source, root: f"{root}/bundle_1"
        env = {"manifest": {"version": "v1.3.0"}, "files": {"inspire-app.zip": "/z", "inspire-assets.tar": "/t"}, "folders": {}, "settings": {}}
        with contextlib.redirect_stdout(io.StringIO()):
            return setup.build_runtime_context(env)

    def ready_widgets(self, catalogs):
        """The first run creates the pickers and waits; the user then picks the warehouse and the Inspire catalog."""
        widgets = support.FakeWidgets()
        self.assertEqual(self.run_context(widgets, catalogs), {"ready": False})
        widgets.pick("00_sql_warehouse", "Shared (wh1)")
        widgets.pick("01_inspire_catalog", "ops")
        return widgets


class ThreeSettingsTest(WidgetHarness):
    def test_the_installer_has_three_settings_and_the_third_is_a_multiselect_that_defaults_to_all(self):
        widgets = support.FakeWidgets()
        self.run_context(widgets, [cat("ops"), cat("sales"), cat("main")])
        self.assertEqual(widgets.state["00_sql_warehouse"]["kind"], "combobox")
        self.assertEqual(widgets.state["01_inspire_catalog"]["kind"], "combobox")
        self.assertEqual(widgets.state[DATA_KEY]["kind"], "multiselect")
        self.assertEqual(widgets.state[DATA_KEY]["value"], ALL, "a multiselect default must be one real choice, so ALL is one")
        self.assertIn(ALL, widgets.state[DATA_KEY]["choices"])
        self.assertEqual(sorted(c for c in widgets.state[DATA_KEY]["choices"] if c != ALL), ["main", "ops", "sales"])
        self.assertIn("Data catalogs the Inspire App may read", widgets.state[DATA_KEY]["label"])

    def test_system_samples_internal_and_delta_sharing_catalogs_are_never_offered(self):
        catalogs = [cat("ops"), cat("sales"), cat("samples"), cat("system"), cat("information_schema"), cat("__databricks_internal"),
                    cat("share_from_partner", "DELTASHARING_CATALOG"), cat("odd,name")]
        widgets = support.FakeWidgets()
        self.run_context(widgets, catalogs)
        self.assertEqual(sorted(c for c in widgets.state[DATA_KEY]["choices"] if c != ALL), ["ops", "sales"])

    def test_the_first_run_creates_the_data_picker_and_waits_so_nothing_is_granted_yet(self):
        widgets = support.FakeWidgets()
        self.assertEqual(self.run_context(widgets, [cat("ops"), cat("sales")]), {"ready": False})
        self.assertIn(("create", "multiselect", DATA_KEY, ALL), widgets.calls)
        self.assertIn("Choose notebook parameter values first", self.shown[-1])

    def test_an_existing_data_picker_keeps_the_users_selection_and_is_not_created_again(self):
        catalogs = [cat("ops"), cat("sales"), cat("main")]
        widgets = self.ready_widgets(catalogs)
        widgets.pick(DATA_KEY, "sales")
        widgets.calls.clear()
        ctx = self.run_context(widgets, catalogs)
        self.assertTrue(ctx["ready"])
        self.assertEqual(ctx["DATA_CATALOGS"], ["sales"])
        self.assertEqual([c for c in widgets.calls if DATA_KEY in c], [], "the selection is not reset by creating the widget again")

    def test_the_default_all_reads_every_offered_catalog_and_the_inspire_catalog_is_one_of_them(self):
        catalogs = [cat("ops"), cat("sales"), cat("main")]
        widgets = self.ready_widgets(catalogs)
        ctx = self.run_context(widgets, catalogs)
        self.assertEqual(ctx["CATALOG"], "ops")
        self.assertEqual(ctx["DATA_CATALOGS"], ["main", "ops", "sales"])

    def test_an_empty_selection_reads_no_data_catalog(self):
        catalogs = [cat("ops"), cat("sales")]
        widgets = self.ready_widgets(catalogs)
        widgets.pick(DATA_KEY, "")
        self.assertEqual(self.run_context(widgets, catalogs)["DATA_CATALOGS"], [])

    def test_a_list_capped_for_the_widget_still_means_every_catalog_when_all_is_picked(self):
        catalogs = [cat(f"cat_{i:03d}") for i in range(12)] + [cat("ops")]
        with mock.patch.object(setup, "WIDGET_CHOICE_LIMIT", 6):
            widgets = self.ready_widgets(catalogs)
            choices = widgets.state[DATA_KEY]["choices"]
            ctx = self.run_context(widgets, catalogs)
        self.assertLessEqual(len(choices), 6)
        self.assertEqual(choices[0], ALL)
        self.assertEqual(len(ctx["DATA_CATALOGS"]), 13, "ALL means every catalog, including the ones the widget does not list")


class ReadResolutionTest(unittest.TestCase):
    def test_the_choices_are_the_offered_catalogs_without_system_samples_internal_sharing_or_comma_names(self):
        choices = setup.data_catalog_choices([("sales", "MANAGED_CATALOG"), ("ops", "MANAGED_CATALOG"), ("samples", "MANAGED_CATALOG"),
                                              ("system", "SYSTEM_CATALOG"), ("__x", "MANAGED_CATALOG"), ("share", "DELTASHARING_CATALOG"),
                                              ("a,b", "MANAGED_CATALOG"), ("sales", "MANAGED_CATALOG")])
        self.assertEqual(choices, ["ops", "sales"])

    def test_all_a_list_and_nothing_resolve_to_the_catalogs_named(self):
        choices = ["main", "sales"]
        self.assertEqual(setup.resolve_data_catalogs(ALL, choices), (["main", "sales"], None))
        self.assertEqual(setup.resolve_data_catalogs(f"{ALL},sales", choices), (["main", "sales"], None))
        self.assertEqual(setup.resolve_data_catalogs("sales,main,sales", choices), (["sales", "main"], None))
        self.assertEqual(setup.resolve_data_catalogs("", choices), ([], None))

    def test_samples_system_or_an_unknown_name_is_refused_and_named_not_granted(self):
        for value in ("samples", "system", "sales,nope"):
            names, problem = setup.resolve_data_catalogs(value, ["main", "sales"])
            self.assertIsNone(names, value)
            self.assertIn(value.split(",")[-1], problem)


class ConsentAndGrantTest(unittest.TestCase):
    """The grant step, through the same stubbed workspace the install tests use."""

    def grant_read(self, data, listed=("ops", "main", "sales", "finance", "samples", "system"), catalog="ops", **kwargs):
        return ts.GrantPlanTest.grant(self, data, listed=listed, catalog=catalog, **kwargs)

    def test_each_picked_catalog_gets_one_read_grant_to_the_app_and_the_inspire_catalog_is_not_granted_twice(self):
        grants, _, _, _ = self.grant_read(["main", "ops", "sales"], listed=("ops", "main", "sales"))
        read = [g for g in grants if g.startswith("GRANT USE CATALOG, USE SCHEMA, SELECT, BROWSE, READ METADATA ON CATALOG ")]
        self.assertEqual(read, [READ.format("main"), READ.format("sales")])

    def test_the_consent_line_names_the_catalogs_and_the_read_privileges_in_one_line(self):
        _, _, _, said = self.grant_read(["sales", "main"])
        self.assertIn(CONSENT.format("sales, main"), said)

    def test_no_data_catalog_picked_says_so_in_the_consent_line_and_grants_none(self):
        grants, _, _, said = self.grant_read([])
        self.assertFalse([g for g in grants if g.startswith("GRANT USE CATALOG, USE SCHEMA")], grants)
        self.assertIn("Inspire's App gets read access on no catalog besides `ops`", said)

    def grant_stopped(self, data, **kwargs):
        """FX-47: a refused catalog grant raises before the deploy; returns the message and everything printed before the stop."""
        printed = []
        with mock.patch("builtins.print", lambda *args, **kw: printed.append(" ".join(str(a) for a in args))):
            with self.assertRaises(RuntimeError) as raised:
                ConsentAndGrantTest.grant_read(self, data, **kwargs)
        return str(raised.exception), "\n".join(printed)

    def test_a_refused_grant_is_printed_as_a_plain_statement_line_and_the_install_stops_before_the_deploy_with_the_exact_grant(self):
        message, said = self.grant_stopped(["sales", "finance"], fail={"CATALOG `finance`": RuntimeError("PERMISSION_DENIED: not the owner")})
        lines = said.splitlines()
        self.assertIn("Permission Required: ask your admin to grant this permission:", lines)
        self.assertIn(READ.format("finance"), lines, "the statement starts at the line start so it copies as is")
        self.assertIn("Catalog grants: 1 of 2 ran ⚠️", said)
        self.assertIn("Grants:", said, "the core plan ran before the stop")
        self.assertIn(READ.format("finance"), message, "the stop message carries the exact GRANT")
        self.assertIn("before it deploys", message)

    def test_a_refused_grant_stops_the_install_before_the_deploy(self):
        message, _said = self.grant_stopped(["finance"], listed=("ops", "finance"), fail={"CATALOG `finance`": RuntimeError("PERMISSION_DENIED: not the owner")})
        self.assertEqual(self.ctx["READ_REFUSED"], [READ.format("finance")])
        self.assertIn(READ.format("finance"), message)
        self.assertIn("before it deploys", message)

    def test_every_statement_uses_the_documented_privilege_spelling_with_spaces(self):
        """The Databricks GRANT reference writes USE CATALOG, USE SCHEMA, CREATE TABLE with spaces; underscore names are not documented."""
        _, _, executed, _ = self.grant_read(["sales"], listed=("ops", "sales", "main"))
        grants = [sql for sql, _ in executed if sql.startswith("GRANT ")]
        self.assertTrue(grants)
        self.assertFalse([g for g in grants if re.search(r"USE_CATALOG|USE_SCHEMA|CREATE_TABLE|CREATE_SCHEMA", g)], grants)

    def test_system_and_samples_get_no_read_grant_even_when_the_plan_lists_them(self):
        grants, _, _, _ = self.grant_read(["sales"], listed=("ops", "sales", "samples", "system"))
        self.assertFalse([g for g in grants if "`samples`" in g or "`system`" in g], grants)


class UnmanagedCatalogGrantsTest(unittest.TestCase):
    """FX-47 (REQ-456, REQ-458): the install never goes on with a data catalog the App cannot read."""

    REFUSED = RuntimeError("PERMISSION_DENIED: not the owner")

    def test_a_named_catalog_with_a_refused_grant_stops_the_install_before_deploy_and_prints_the_grant(self):
        with self.assertRaises(RuntimeError) as raised:
            ConsentAndGrantTest.grant_read(self, ["sales", "finance"], listed=("ops", "sales", "finance"), fail={"CATALOG `finance`": self.REFUSED})
        message = str(raised.exception)
        self.assertIn(READ.format("finance"), message, "the exact statement a catalog owner runs")
        self.assertNotIn(READ.format("sales"), message, "only the refused catalog is named")
        self.assertIn("catalog owner", message)
        self.assertIn("before it deploys", message)

    def test_all_catalogs_grants_the_ones_the_person_manages_and_leaves_the_rest_out_of_the_app_env(self):
        refuse = {"CATALOG `a`": self.REFUSED, "CATALOG `b`": self.REFUSED}
        rights = {"ops": ("MANAGE",), "sales": ("MANAGE",), "finance": ("MANAGE",), "a": ("USE_CATALOG", "SELECT"), "b": ("USE_CATALOG",)}
        grants, _, executed, said = ConsentAndGrantTest.grant_read(
            self, ["a", "b", "finance", "ops", "sales"], listed=("ops", "sales", "finance", "a", "b"), rights=rights, fail=refuse, data_all=True)
        read = [g for g in grants if g.startswith("GRANT USE CATALOG, USE SCHEMA, SELECT, BROWSE, READ METADATA ON CATALOG ")]
        self.assertEqual(read, [READ.format("finance"), READ.format("sales")], "the managed catalogs are granted")
        self.assertEqual(self.ctx["DATA_CATALOGS"], ["finance", "ops", "sales"], "the App is offered only what it can read")
        self.assertFalse([sql for sql, _ in executed if "`a`" in sql or "`b`" in sql], "nothing is attempted on a catalog the person cannot grant on")
        env = setup.installer_data_catalog_env(self.ctx["DATA_CATALOGS"], self.ctx.get("DATA_ALL_PICKED", False))
        self.assertEqual(env, {"INSPIRE_DATA_CATALOGS": '["finance", "ops", "sales"]'}, "the All pick no longer means every catalog")
        for name in ("a", "b"):
            self.assertEqual(said.count(READ.format(name)), 1, f"{name} is listed once with the GRANT a catalog owner runs")
        self.assertIn("Catalog grants: 2 of 2 ran ✅", said)
        self.assertNotIn("⚠️ GRANT", said)
        self.assertNotIn("Permission Required", said)
        self.assertFalse([line for line in said.splitlines() if "of" in line and "ran ⚠️" in line], said)


class JourneyTest(unittest.TestCase):
    """The journey: a fresh Inspire catalog `ops`, the data in `sales`, install, then Discover reads sales with no prompt.

    The SQL and API layers are stubbed. The App's read probe is modelled on UC inheritance: the App reads a table when it
    holds USE CATALOG, USE SCHEMA and SELECT on the table's catalog. The real probe is app/backend/lib/sourceAccess.js
    (sourceAccess runs a table probe as the App; only a failing probe raises the grant prompt).
    """

    def install(self, fail=None):
        _, _, executed, said = ConsentAndGrantTest.grant_read(self, ["sales"], listed=("ops", "sales", "samples", "system"), fail=fail)
        held = {}
        for sql, _ in executed:
            if any(needle in sql for needle in (fail or {})):
                continue  # a refused statement grants nothing
            if sql.startswith("GRANT ") and " ON CATALOG `" in sql:
                privileges, target = sql[len("GRANT "):].split(" ON CATALOG `", 1)
                held.setdefault(target.split("`")[0], set()).update(p.strip().replace(" ", "_") for p in privileges.split(","))
        return held, said

    @staticmethod
    def app_reads(held, table_catalog):
        return {"USE_CATALOG", "USE_SCHEMA", "SELECT"} <= held.get(table_catalog, set())

    def test_discover_reads_a_table_in_the_other_catalog_with_no_permission_prompt(self):
        held, said = self.install()
        self.assertTrue(self.app_reads(held, "sales"), "the App reads sales.orders, so the Discover pre-check finds nothing missing")
        self.assertIn(CONSENT.format("sales"), said)

    def test_a_refused_read_grant_stops_the_install_before_the_deploy_and_prints_the_one_statement_for_the_admin(self):
        message, said = ConsentAndGrantTest.grant_stopped(self, ["sales"], listed=("ops", "sales", "samples", "system"),
                                                          fail={"CATALOG `sales`": RuntimeError("PERMISSION_DENIED: not the owner")})
        self.assertIn("\n" + READ.format("sales") + "\n", "\n" + said + "\n")
        self.assertIn(READ.format("sales"), message, "the stop message carries the exact GRANT")
        self.assertIn("before it deploys", message)


class DroppedCatalogRevokeTest(unittest.TestCase):
    """REQ-420: a re-run with fewer catalogs revokes only what an earlier Inspire install granted on the dropped ones."""

    def run_grants(self, picked, previous, catalog="ops", refuse=()):
        ran = []

        def run_statement(_w, _wh, sql):
            ran.append(sql)
            if any(needle in sql for needle in refuse):
                raise RuntimeError("PERMISSION_DENIED: only the owner can revoke")

        ctx = {"w": object(), "WAREHOUSE_ID": "wh", "CATALOG": catalog, "DATA_CATALOGS": picked, "PREVIOUS_GRANTED_CATALOGS": previous}
        with mock.patch.object(setup, "_run_statement", run_statement), contextlib.redirect_stdout(io.StringIO()) as out:
            setup._grant_data_catalogs(ctx, "SP")
        return ctx, ran, out.getvalue()

    def test_a_rerun_with_a_and_b_after_a_b_and_c_revokes_only_the_inspire_read_grants_on_c(self):
        ctx, ran, _out = self.run_grants(["a", "b"], ["a", "b", "c"])
        revokes = [sql for sql in ran if sql.startswith("REVOKE")]
        self.assertEqual(revokes, ["REVOKE USE CATALOG, USE SCHEMA, SELECT, BROWSE, READ METADATA ON CATALOG `c` FROM `SP`"])
        self.assertEqual([sql for sql in ran if sql.startswith("GRANT")], [READ.format("a"), READ.format("b")], "the picked catalogs are granted again (must-keep)")
        self.assertEqual(ctx["READ_REVOKED"], ["c"])

    def test_a_grant_inspire_did_not_make_is_never_named_and_a_catalog_never_recorded_is_untouched(self):
        _ctx, ran, _out = self.run_grants(["a"], ["a", "c"])
        revoke = next(sql for sql in ran if sql.startswith("REVOKE"))
        for other in ("MODIFY", "CREATE", "MANAGE", "ALL PRIVILEGES", "OWNERSHIP"):
            self.assertNotIn(other, revoke, "only the five read privileges Inspire grants are revoked")
        self.assertNotIn("`d`", " ".join(ran), "a catalog the record does not name is untouched (must-exclude)")
        _ctx, none, _out = self.run_grants(["a"], [])
        self.assertEqual([sql for sql in none if sql.startswith("REVOKE")], [], "no record, nothing revoked")

    def test_the_inspire_catalog_is_never_revoked_and_a_refused_revoke_is_printed_not_fatal(self):
        _ctx, ran, _out = self.run_grants(["a"], ["a", "ops"])
        self.assertEqual([sql for sql in ran if sql.startswith("REVOKE")], [], "the catalog Inspire itself lives in keeps its grants")
        ctx, _ran, out = self.run_grants(["a"], ["a", "c"], refuse=("REVOKE",))
        self.assertEqual(ctx["READ_REVOKED"], [])
        self.assertIn("Permission Required", out)
        self.assertIn("REVOKE USE CATALOG, USE SCHEMA, SELECT, BROWSE, READ METADATA ON CATALOG `c` FROM `SP`", out)

    def test_the_record_is_the_granted_list_in_app_yaml_and_falls_back_to_the_older_pick_list(self):
        import os as _os
        import tempfile as _t
        env = {**setup.installer_data_catalog_env(["a", "b"]), **setup.granted_catalog_env(["a", "b", "c", "ops"], "ops")}
        with _t.TemporaryDirectory() as folder:
            path = _os.path.join(folder, "app.yaml")
            text = setup.write_app_yaml_deploy(path, "ops._inspire", "wh", "/n", "sp", None, None, env)
            old = setup.write_app_yaml_deploy(path, "ops._inspire", "wh", "/n", "sp", None, None, setup.installer_data_catalog_env(["a", "b"]))
        self.assertEqual(setup.catalogs_recorded_in_app_yaml(text), ["a", "b", "c"], "the All pick writes no pick list, the granted list still records it")
        self.assertEqual(setup.catalogs_recorded_in_app_yaml(old), ["a", "b"])
        self.assertEqual(setup.catalogs_recorded_in_app_yaml("not yaml"), [])
        self.assertEqual(setup.catalogs_recorded_in_app_yaml(None), [])

    def test_the_earlier_install_record_is_read_from_the_deployed_app_yaml(self):
        import base64 as _b
        import json as _j
        import os as _os
        import tempfile as _t
        with _t.TemporaryDirectory() as folder:
            text = setup.write_app_yaml_deploy(_os.path.join(folder, "app.yaml"), "ops._inspire", "wh", "/n", "sp", None, None,
                                               setup.granted_catalog_env(["a", "c"], "ops"))
        asked = []

        def api(method, path, body=None):
            asked.append(path)
            return types.SimpleNamespace(status_code=200, text="", json=lambda: {"content": _b.b64encode(text.encode()).decode()})

        current = {"active_deployment": {"deployment_artifacts": {"source_code_path": "/Workspace/Shared/inspire/src"}}}
        self.assertEqual(setup._previous_granted_catalogs(api, current), ["a", "c"])
        self.assertIn("/Shared/inspire/src/app.yaml", " ".join(asked).replace("%2F", "/"))
        self.assertEqual(setup._previous_granted_catalogs(api, {}), [], "an App with no deployment has no record")
