import contextlib
import io
import json
import os
import pathlib
import shutil
import tarfile
import tempfile
import types
import unittest
from unittest import mock

import support

setup = support.load_setup()
SUCCEEDED = setup.StatementState.SUCCEEDED
FAILED = setup.StatementState.FAILED
HOST = "https://adb-xxxx.xx.azuredatabricks.net"


class Resp:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code, self.payload, self.text = status_code, payload or {}, text

    def json(self):
        return self.payload


def http_error(code, payload=None):
    err = setup.requests.exceptions.HTTPError(f"{code} Client Error: Forbidden for url: {HOST}/api/2.1/unity-catalog/effective-permissions/catalog/x")
    err.response = Resp(code, payload)
    return err


def statement_ok():
    return types.SimpleNamespace(state=SUCCEEDED, error=None)


def statement(state, message=None):
    return types.SimpleNamespace(status=types.SimpleNamespace(state=state, error=types.SimpleNamespace(message=message) if message else None),
                                 statement_id="s1")


class Workspace:
    def __init__(self, warehouse=SUCCEEDED, owner="someone-else", schema=True):
        self.statements = []
        outer = self

        class Statements:
            def execute_statement(self, warehouse_id, statement, wait_timeout):
                outer.statements.append(statement)
                return globals()["statement"](warehouse, None if warehouse == SUCCEEDED else "PERMISSION_DENIED: no CAN USE")

            def get_statement(self, statement_id):
                return globals()["statement"](warehouse)

        class Schemas:
            def get(self, name):
                if not schema:
                    raise RuntimeError("SCHEMA_DOES_NOT_EXIST")
                return types.SimpleNamespace(name=name)

        self.statement_execution = Statements()
        self.catalogs = types.SimpleNamespace(get=lambda name: types.SimpleNamespace(name=name, owner=owner))
        self.schemas = Schemas()


def context(api, w=None, held=("USE_CATALOG", "MANAGE"), groups=("admins",), catalogs=None, **extra):
    held_on = {"main": held, **(catalogs or {})}
    prefix = "/api/2.1/unity-catalog/effective-permissions/catalog/"

    def api_get(path):
        if path.startswith(prefix) and path[len(prefix):].split("?")[0] in held_on:
            privileges = held_on[path[len(prefix):].split("?")[0]]
            if isinstance(privileges, Exception):
                raise privileges
            return {"privilege_assignments": [{"principal": "someone@example.com", "privileges": [{"privilege": p} for p in privileges]}]}
        if path == "/api/2.1/unity-catalog/metastore_summary":
            return {"owner": "metastore-admins"}
        raise AssertionError(path)
    ctx = {"ready": True, "api": api, "api_get": api_get, "w": w or Workspace(), "APP_NAME": "inspire-ai", "SP_NAME": "inspire-ai-sp",
           "CATALOG": "main", "SCHEMA": "_inspire", "WAREHOUSE_ID": "wh", "WAREHOUSE_NAME": "Shared", "USER_EMAIL": "someone@example.com",
           "USER_GROUPS": list(groups), "INSPIRE_DB": "main._inspire", "RELEASE_VERSION": "v1.3.0",
           "available_catalogs": sorted(held_on), "SCAN_CATALOGS": "all", "BUNDLE_ROOT": "/Workspace/Shared/inspire-ai/apps/inspire-ai"}
    ctx.update(extra)
    return ctx


def recording(script):
    calls = []

    def api(method, path, body=None):
        calls.append((method, path, body))
        return script(method, path, body)
    return api, calls


def app_exists(manage=True, apps_listed=True, mkdirs=200):
    def script(method, path, body):
        if path == "/api/2.0/apps/inspire-ai" and method == "GET":
            return Resp(200, {"name": "inspire-ai"})
        if path == "/api/2.0/permissions/apps/inspire-ai":
            return Resp(200 if manage else 403, {}, "" if manage else '{"error_code":"PERMISSION_DENIED"}')
        if path.startswith("/api/2.0/apps?"):
            return Resp(200 if apps_listed else 403)
        if path == "/api/2.0/workspace/mkdirs":
            return Resp(mkdirs, {}, "" if mkdirs == 200 else '{"error_code":"PERMISSION_DENIED"}')
        return Resp(200)
    return script


INSTALL_STEPS = ("step_bundle", "step_assets", "step_cleanup", "step_schema_and_notebooks", "step_deploy_and_find_sp",
                 "step_grant_permissions", "step_render_done")


class PreflightTest(unittest.TestCase):
    def run_install(self, ctx):
        steps = []
        for name in INSTALL_STEPS:
            setattr(setup, name, lambda c, n=name: steps.append(n))
        setup.build_runtime_context = lambda env: ctx
        shown = []
        out = io.StringIO()
        try:
            with contextlib.redirect_stdout(out):
                setup.run({"dbutils": None, "displayHTML": shown.append, "manifest": {"version": "v1.3.0"}})
            error = None
        except RuntimeError as exc:
            error = str(exc)
        return steps, error, shown

    def setUp(self):
        self.saved = {name: getattr(setup, name) for name in INSTALL_STEPS + ("build_runtime_context",)}

    def tearDown(self):
        for name, value in self.saved.items():
            setattr(setup, name, value)

    def test_a_failed_preflight_leaves_the_old_app_and_its_service_principal_untouched(self):
        for name, ctx_args, words in (
                ("no manage", dict(api=app_exists(manage=False)), "You cannot manage the App inspire-ai"),
                ("warehouse", dict(api=app_exists(), w=Workspace(warehouse=FAILED)), "The SQL warehouse Shared does not run a query"),
                ("catalog", dict(api=app_exists(), held=("USE_CATALOG",)), "You cannot grant on catalog `main`"),
                ("schema", dict(api=app_exists(), held=("USE_CATALOG", "MANAGE"), w=Workspace(schema=False)),
                 "You cannot create the schema `main`.`_inspire`"),
                ("folder", dict(api=app_exists(mkdirs=403)), "You cannot write the workspace folder /Shared/inspire-ai/apps/inspire-ai "),
                ("scan list", dict(api=app_exists(), SCAN_CATALOGS=["nope"]), "SCAN_CATALOGS names `nope`, which is not a catalog you can see"),
                ("scan grant", dict(api=app_exists(), catalogs={"finance": ("USE_CATALOG",)}, SCAN_CATALOGS=["finance"]),
                 "SCAN_CATALOGS names `finance`, and you cannot grant on it")):
            api, calls = recording(ctx_args.pop("api"))
            steps, error, shown = self.run_install(context(api, **ctx_args))
            self.assertEqual(steps, [], name)
            self.assertIn("Nothing was replaced: the installed Inspire App and its service principal are untouched", error, name)
            self.assertIn(words, error, name)
            self.assertEqual([c for c in calls if c[0] in ("DELETE", "PATCH", "PUT") or c[1].startswith("/api/2.0/apps/inspire-ai/")
                              or (c[0] == "POST" and c[1] != "/api/2.0/workspace/mkdirs")], [], name)
            self.assertIn("Setup incomplete", shown[-1], name)

    def test_every_problem_is_named_at_once(self):
        api, _ = recording(app_exists(manage=False, mkdirs=403))
        _, error, _ = self.run_install(context(api, w=Workspace(warehouse=FAILED, schema=False), held=(), SCAN_CATALOGS=["nope"]))
        self.assertEqual(error.count("\n  • "), 8)

    def test_a_passed_preflight_runs_every_step_in_order_and_unpacks_the_app_only_after_it(self):
        api, calls = recording(app_exists())
        steps, error, _ = self.run_install(context(api))
        self.assertIsNone(error)
        self.assertEqual(steps, list(INSTALL_STEPS))
        self.assertIn(("POST", "/api/2.0/workspace/mkdirs", {"path": "/Shared/inspire-ai/apps/inspire-ai"}), calls)

    def test_scan_catalogs_must_be_the_word_all_or_a_list_of_names(self):
        for value in ("sales", "ALL", "", None, 7, [""], ["  "], ["a`b"], [7], {"sales": 1}):
            api, _ = recording(app_exists())
            steps, error, _ = self.run_install(context(api, SCAN_CATALOGS=value))
            self.assertEqual(steps, [], value)
            self.assertIn("SCAN_CATALOGS", error, value)

    def test_a_listed_catalog_you_cannot_grant_on_is_refused_before_any_change_and_all_skips_it_instead(self):
        catalogs = {"sales": ("MANAGE",), "finance": ("USE_CATALOG", "SELECT")}
        api, calls = recording(app_exists())
        steps, error, _ = self.run_install(context(api, catalogs=catalogs, SCAN_CATALOGS=["sales", "finance"]))
        self.assertEqual(steps, [])
        self.assertIn("Nothing was replaced", error)
        self.assertIn("SCAN_CATALOGS names `finance`, and you cannot grant on it", error)
        self.assertNotIn("`sales`, and you cannot grant", error)
        self.assertEqual([c for c in calls if c[0] in ("DELETE", "PATCH", "PUT") or (c[0] == "POST" and c[1] != "/api/2.0/workspace/mkdirs")], [])
        api, _ = recording(app_exists())
        ctx = context(api, catalogs=catalogs)
        steps, error, _ = self.run_install(ctx)
        self.assertIsNone(error)
        self.assertEqual(steps, list(INSTALL_STEPS))
        self.assertEqual(ctx["SCAN_CATALOGS"], "all")

    def test_all_privileges_alone_cannot_grant_so_the_inspire_catalog_and_a_listed_catalog_are_refused_before_any_change(self):
        ask = ("you are not its owner or a metastore admin and hold no MANAGE on it (ALL PRIVILEGES does not include MANAGE). The catalog "
               "owner can run GRANT MANAGE ON CATALOG `{0}` TO `someone@example.com`, or make you the owner of `{0}`")
        for name, ctx_args, words in (
                ("inspire catalog", dict(held=("ALL_PRIVILEGES",)),
                 "You cannot grant on catalog `main`, and the Inspire App needs USE CATALOG on it: " + ask.format("main") + "."),
                ("listed catalog", dict(catalogs={"finance": ("ALL_PRIVILEGES",)}, SCAN_CATALOGS=["finance"]),
                 "SCAN_CATALOGS names `finance`, and you cannot grant on it, so the Inspire App could not read it: " + ask.format("finance")
                 + ", or take `finance` out of SCAN_CATALOGS.")):
            api, calls = recording(app_exists())
            steps, error, _ = self.run_install(context(api, **ctx_args))
            self.assertEqual(steps, [], name)
            self.assertIn("Nothing was replaced", error, name)
            self.assertIn(words, error, name)
            self.assertEqual([c for c in calls if c[0] in ("DELETE", "PATCH", "PUT") or (c[0] == "POST" and c[1] != "/api/2.0/workspace/mkdirs")],
                             [], name)
        for name, ctx_args in (("owner", dict(held=("ALL_PRIVILEGES",), w=Workspace(owner="someone@example.com"))),
                               ("metastore admin", dict(held=("ALL_PRIVILEGES",), groups=("metastore-admins",))),
                               ("manage", dict(held=("MANAGE",), catalogs={"finance": ("MANAGE",)}, SCAN_CATALOGS=["finance"])),
                               ("schema from all privileges", dict(held=("MANAGE", "ALL_PRIVILEGES"), w=Workspace(schema=False)))):
            api, _ = recording(app_exists())
            steps, error, _ = self.run_install(context(api, **ctx_args))
            self.assertIsNone(error, name)
            self.assertEqual(steps, list(INSTALL_STEPS), name)

    def test_a_rights_lookup_http_error_refuses_in_plain_words_with_its_status_and_no_workspace_url(self):
        for name, ctx_args, words in (
                ("inspire catalog", dict(held=http_error(403)),
                 "Inspire cannot check catalog `main`: you cannot see who can grant on catalog `main` (HTTP 403). A catalog owner can run "
                 "GRANT MANAGE ON CATALOG `main` TO `someone@example.com`."),
                ("listed catalog", dict(catalogs={"finance": http_error(403)}, SCAN_CATALOGS=["finance"]),
                 "Inspire cannot check catalog `finance` in SCAN_CATALOGS: you cannot see who can grant on catalog `finance` (HTTP 403). "
                 "A catalog owner can run GRANT MANAGE ON CATALOG `finance` TO `someone@example.com`."),
                ("server error", dict(catalogs={"finance": http_error(500)}, SCAN_CATALOGS=["finance"]),
                 "Inspire cannot check catalog `finance` in SCAN_CATALOGS: your rights on catalog `finance` could not be read (HTTP 500).")):
            api, calls = recording(app_exists())
            steps, error, shown = self.run_install(context(api, **ctx_args))
            self.assertEqual(steps, [], name)
            self.assertIn(words, error, name)
            for text in (error, shown[-1]):
                self.assertNotIn("https://", text, name)
                self.assertNotIn("adb-", text, name)
            self.assertEqual([c for c in calls if c[0] in ("DELETE", "PATCH", "PUT") or (c[0] == "POST" and c[1] != "/api/2.0/workspace/mkdirs")],
                             [], name)

    def test_a_scan_list_is_checked_and_kept_without_repeats(self):
        api, _ = recording(app_exists())
        ctx = context(api, catalogs={"sales": ("MANAGE",), "finance": ("MANAGE", "SELECT")}, SCAN_CATALOGS=[" sales", "finance", "sales", "main"])
        steps, error, _ = self.run_install(ctx)
        self.assertIsNone(error)
        self.assertEqual(steps, list(INSTALL_STEPS))
        self.assertEqual(ctx["SCAN_CATALOGS"], ["sales", "finance", "main"])
        api, _ = recording(app_exists())
        ctx = context(api, SCAN_CATALOGS=[])
        self.assertIsNone(self.run_install(ctx)[1])
        self.assertEqual(ctx["SCAN_CATALOGS"], [])

    def test_a_new_app_needs_the_apps_api_and_an_owner_or_metastore_admin_can_grant(self):
        def no_app(method, path, body):
            if path == "/api/2.0/apps/inspire-ai":
                return Resp(404)
            return app_exists(apps_listed=False)(method, path, body)
        api, _ = recording(no_app)
        _, error, _ = self.run_install(context(api))
        self.assertIn("You cannot create Databricks Apps here", error)
        for ctx_args in (dict(held=(), w=Workspace(owner="someone@example.com")), dict(held=(), groups=("metastore-admins",)),
                         dict(held=("MANAGE",))):
            api, _ = recording(app_exists())
            steps, error, _ = self.run_install(context(api, **ctx_args))
            self.assertIsNone(error, ctx_args)

    def test_a_warehouse_that_is_starting_is_waited_for(self):
        states = [setup.StatementState.PENDING, setup.StatementState.RUNNING, SUCCEEDED]
        w = types.SimpleNamespace(statement_execution=types.SimpleNamespace(get_statement=lambda sid: statement(states.pop(0))))
        waited = []
        done = setup._wait_statement(w, statement(setup.StatementState.PENDING), sleep=waited.append)
        self.assertEqual((done.status.state, len(waited)), (SUCCEEDED, 3))


class AssetsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp(prefix="inspire_assets_test_"))
        self.assets = self.tmp / "assets"
        self.assets.mkdir()
        self.files = support.make_assets(self.assets)
        self.tar = self.tmp / "inspire-assets.tar"
        support.release.write_assets_tar(self.assets, "v1.3.0", self.tar, support.release.load_starter())
        self.root = self.tmp / "Workspace" / "Shared" / "inspire-ai" / "assets" / "v1.3.0"

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def install(self, tar=None, version="v1.3.0"):
        ctx = {"ASSETS_TAR": str(tar or self.tar), "ASSETS_ROOT": str(self.root), "RELEASE_VERSION": version}
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            setup.step_assets(ctx)
        return ctx, out.getvalue()

    def test_the_assets_land_in_the_version_folder_checked_and_a_second_run_copies_nothing(self):
        ctx, said = self.install()
        self.assertEqual(ctx["ASSETS_PATH"], str(self.root))
        for name, data in self.files.items():
            self.assertEqual((self.root / name).read_bytes(), data)
        self.assertEqual(json.loads((self.root / "manifest.json").read_text()), json.loads((self.assets / "manifest.json").read_text()))
        self.assertIn("3 files in", said)
        self.assertIn("(3 copied, 0 already there)", said)
        _, said = self.install()
        self.assertIn("(0 copied, 3 already there)", said)
        (self.root / "fonts" / "inter-400.ttf").write_bytes(b"damaged")
        _, said = self.install()
        self.assertIn("(1 copied, 2 already there)", said)
        self.assertEqual((self.root / "fonts" / "inter-400.ttf").read_bytes(), self.files["fonts/inter-400.ttf"])

    def _cli_tar(self, machines, cli_machine="aarch64"):
        shutil.rmtree(self.assets)
        self.assets.mkdir()
        builds = {f"cli/{name}-{machine}.{kind}": f"{name} {machine}".encode() * 50
                  for name, kind in (("genie-code-cli", "tar.gz"), ("databricks-cli", "zip")) for machine in machines}
        support.make_assets(self.assets, files=builds, cli_machine=cli_machine)
        support.release.write_assets_tar(self.assets, "v1.3.0", self.tar, support.release.load_starter())
        return builds

    def test_only_the_aarch64_build_of_each_cli_lands_whatever_machine_the_installer_runs_on(self):
        builds = self._cli_tar(("aarch64",))
        for machine in ("aarch64", "x86_64", "arm64"):
            shutil.rmtree(self.root.parent, ignore_errors=True)
            with mock.patch("platform.machine", return_value=machine):
                _, said = self.install()
            self.assertEqual(sorted(p.relative_to(self.root).as_posix() for p in self.root.rglob("*") if p.is_file()),
                             ["cli/databricks-cli-aarch64.zip", "cli/genie-code-cli-aarch64.tar.gz", "manifest.json"], machine)
            self.assertEqual({name: (self.root / name).read_bytes() for name in builds}, builds, machine)
            self.assertIn("(2 copied, 0 already there)", said)

    def test_a_tar_listing_an_x86_64_cli_is_refused_and_copies_nothing(self):
        self._cli_tar(("x86_64", "aarch64"))
        with self.assertRaises(RuntimeError) as caught:
            self.install()
        self.assertIn("lists cli/genie-code-cli-x86_64.tar.gz for x86_64, and the release installs its command line tools only for "
                      "aarch64", str(caught.exception))
        self.assertFalse(self.root.exists())

    def test_a_tar_whose_manifest_names_no_cli_cpu_is_refused(self):
        for value in (None, "", 7):
            self._cli_tar(("aarch64",), cli_machine=value)
            with self.assertRaises(RuntimeError) as caught:
                self.install()
            self.assertIn("names no CPU for its command line tools", str(caught.exception))
            self.assertFalse(self.root.exists())

    def test_a_tar_whose_file_does_not_match_its_manifest_copies_nothing(self):
        bad = self.tmp / "bad.tar"
        with tarfile.open(self.tar) as source, tarfile.open(bad, "w") as target:
            for member in source.getmembers():
                data = source.extractfile(member).read()
                if member.name == "licenses/inter.txt":
                    data = data.upper()
                info = tarfile.TarInfo(member.name)
                info.size = len(data)
                target.addfile(info, io.BytesIO(data))
        with self.assertRaises(RuntimeError) as caught:
            self.install(bad)
        self.assertIn("licenses/inter.txt in inspire-assets.tar does not match its size and sha256", str(caught.exception))
        self.assertFalse(self.root.exists())

    def test_assets_of_another_version_are_refused_as_two_releases(self):
        with self.assertRaises(RuntimeError) as caught:
            self.install(version="v1.3.1")
        self.assertIn("is for Inspire v1.3.0, not v1.3.1, so the files come from two releases", str(caught.exception))
        self.assertFalse(self.root.exists())

    def test_an_entry_that_climbs_out_of_the_folder_is_refused(self):
        manifest = json.loads((self.assets / "manifest.json").read_text())
        manifest["files"][0]["file"] = "../../etc/x"
        (self.assets / "manifest.json").write_text(json.dumps(manifest))
        tar = self.tmp / "climb.tar"
        with tarfile.open(tar, "w") as target:
            data = (self.assets / "manifest.json").read_bytes()
            info = tarfile.TarInfo("manifest.json")
            info.size = len(data)
            target.addfile(info, io.BytesIO(data))
        with self.assertRaises(RuntimeError) as caught:
            self.install(tar)
        self.assertIn("lists an entry this installer refuses", str(caught.exception))


class AppYamlTest(unittest.TestCase):
    def test_the_app_gets_the_assets_path_the_way_it_gets_the_notebook_path(self):
        folder = pathlib.Path(tempfile.mkdtemp())
        try:
            path = folder / "app.yaml"
            setup.write_app_yaml_deploy(str(path), "main._inspire", "wh", "/Shared/inspire-ai/dbx_inspire_ai_agent", "inspire-ai-sp",
                                        "/Workspace/Shared/inspire-ai/assets/v1.3.0")
            text = path.read_text()
            self.assertIn('  - name: "NOTEBOOK_PATH"\n    value: "/Shared/inspire-ai/dbx_inspire_ai_agent"\n'
                          '  - name: "INSPIRE_ASSETS_PATH"\n    value: "/Workspace/Shared/inspire-ai/assets/v1.3.0"\n', text)
            setup.write_app_yaml_deploy(str(path), "main._inspire", "wh", "/Shared/x", "sp")
            self.assertNotIn("INSPIRE_ASSETS_PATH", path.read_text())
        finally:
            shutil.rmtree(folder)

    def test_only_a_test_install_writes_the_test_tag_into_the_app_environment(self):
        folder = pathlib.Path(tempfile.mkdtemp())
        try:
            path = folder / "app.yaml"
            setup.write_app_yaml_deploy(str(path), "main._inspire", "wh", "/Shared/x", "sp", "/Workspace/a", "inspire-rc0")
            self.assertIn('  - name: "INSPIRE_TEST_TAG"\n    value: "inspire-rc0"\n', path.read_text())
            for production in (None, ""):
                setup.write_app_yaml_deploy(str(path), "main._inspire", "wh", "/Shared/x", "sp", "/Workspace/a", production)
                self.assertNotIn("INSPIRE_TEST_TAG", path.read_text())
        finally:
            shutil.rmtree(folder)

    def test_the_deploy_step_writes_the_installed_assets_path(self):
        written = []
        saved, clock = setup.write_app_yaml_deploy, setup.time
        setup.write_app_yaml_deploy = lambda *a: written.append(a)
        setup.time = types.SimpleNamespace(sleep=lambda s: None)
        try:
            app = {"compute_status": {"state": "ACTIVE"}, "url": "https://app", "service_principal_client_id": "SPNEW",
                   "service_principal_name": "app-sp", "active_deployment": {"deployment_id": "d1", "status": {"state": "SUCCEEDED"}}}
            api = lambda method, path, body=None: Resp(200, {"deployment_id": "d1", "url": "https://app"})
            api_get = lambda path: app if path == "/api/2.0/apps/inspire-ai" else {"Resources": [{"id": "1"}]}
            ctx = {"api": api, "api_get": api_get, "SOURCE_FOLDER": "/Workspace/b", "INSPIRE_DB": "main._inspire", "WAREHOUSE_ID": "wh",
                   "NOTEBOOK_PATH": "/Shared/inspire-ai/dbx_inspire_ai_agent", "SP_NAME": "inspire-ai-sp", "APP_NAME": "inspire-ai",
                   "CATALOG": "main", "ASSETS_PATH": "/Workspace/Shared/inspire-ai/assets/v1.3.0", "RELEASE_VERSION": "v1.3.0"}
            with contextlib.redirect_stdout(io.StringIO()):
                setup.step_deploy_and_find_sp(ctx)
        finally:
            setup.write_app_yaml_deploy, setup.time = saved, clock
        self.assertEqual(written[0][5:], ("/Workspace/Shared/inspire-ai/assets/v1.3.0", None))


class VersionTextTest(unittest.TestCase):
    def test_the_done_page_and_the_app_name_the_installed_release_and_no_fixed_version(self):
        shown = []
        saved = getattr(setup, "displayHTML", None)
        setup.displayHTML = shown.append
        ctx = {"api_get": lambda path: {"url": "https://app"}, "APP_NAME": "inspire-ai", "INSPIRE_DB": "main._inspire",
               "WAREHOUSE_NAME": "wh", "NEW_SP_APP_ID": "sp", "ASSETS_PATH": "/Workspace/Shared/inspire-ai/assets/v1.3.0",
               "RELEASE_VERSION": "v1.3.0"}
        printed = io.StringIO()
        try:
            with contextlib.redirect_stdout(printed):
                setup.step_render_done(ctx)
        finally:
            setup.displayHTML = saved
        self.assertIn("Inspire AI v1.3.0 is ready", printed.getvalue())
        self.assertIn("Inspire AI v1.3.0: Databricks App ready", shown[-1])
        for body in (printed.getvalue(), shown[-1]):
            self.assertIn("A new App's address can take a few minutes to start working. If the page does not open, wait a few minutes", body)
        source = pathlib.Path(setup.__file__).read_text()
        self.assertEqual([line.strip() for line in source.splitlines() if "Inspire AI v" in line], [])


class AssetsAccessTest(unittest.TestCase):
    def test_the_service_principal_and_the_users_group_can_read_the_assets(self):
        api, calls = recording(lambda m, p, b: Resp(200, {"object_id": 42}))
        said = setup._assets_folder_access(api, "/Workspace/Shared/inspire-ai/assets/v1.3.0", "SP")
        self.assertEqual(calls, [("GET", "/api/2.0/workspace/get-status?path=/Shared/inspire-ai/assets", None),
                                 ("PATCH", "/api/2.0/permissions/directories/42", {"access_control_list": [
                                     {"service_principal_name": "SP", "permission_level": "CAN_READ"},
                                     {"group_name": "users", "permission_level": "CAN_READ"}]})])
        self.assertEqual(said, "CAN_READ on /Shared/inspire-ai/assets for SP and the users group, so every run reads the Inspire assets: ✅")
        api, calls = recording(lambda m, p, b: Resp(403, {}, '{"error_code":"PERMISSION_DENIED"}') if m == "PATCH" else Resp(200, {"object_id": 42}))
        self.assertTrue(setup._assets_folder_access(api, "/x", "SP").startswith("⚠️ Runs may not read the Inspire assets"))
        api, calls = recording(lambda m, p, b: Resp(404, {}, "missing"))
        self.assertTrue(setup._assets_folder_access(api, "/x", "SP").startswith("⚠️ Could not find /Shared/inspire-ai/assets"))
        self.assertEqual(len(calls), 1)
        api, calls = recording(lambda m, p, b: Resp(200))
        self.assertTrue(setup._assets_folder_access(api, None, "SP").startswith("⚠️ No Inspire assets were installed"))
        self.assertEqual(calls, [])


INSPIRE_GRANTS = [f"GRANT {p} ON CATALOG `main` TO `SP`" for p in ("USE_CATALOG", "BROWSE", "CREATE SCHEMA")] + [
    f"GRANT {p} ON SCHEMA `main`.`_inspire` TO `SP`" for p in ("USE_SCHEMA", "CREATE_TABLE", "SELECT", "MODIFY", "CREATE MODEL",
                                                               "CREATE VOLUME", "READ VOLUME", "WRITE VOLUME", "MANAGE")]
LAKEBASE_GRANT = "GRANT ALL PRIVILEGES ON CATALOG `inspire_lakebase` TO `SP`"


def scan_grants(*catalogs):
    return [f"GRANT {p} ON CATALOG `{c}` TO `SP`" for c in catalogs for p in ("USE_CATALOG", "USE_SCHEMA", "SELECT", "BROWSE")]


CASES = json.loads((pathlib.Path(__file__).resolve().parents[2] / "backend" / "test" / "fixtures" / "catalog_access_cases.json").read_text())


class CatalogAccessTest(unittest.TestCase):
    def setUp(self):
        self.saved = setup._catalog_privileges

    def tearDown(self):
        setup._catalog_privileges = self.saved

    def access(self, case, below_fails=False, grant_fails=False):
        executed = []
        columns = lambda names: types.SimpleNamespace(schema=types.SimpleNamespace(columns=[types.SimpleNamespace(name=n) for n in names]))

        class Statements:
            def execute_statement(self, warehouse_id, statement, wait_timeout):
                executed.append(statement)
                if statement.startswith("SHOW GRANTS"):
                    rows = [["account users", p, "CATALOG", "main"] for p in case["account_users"]] + [["SP", "MANAGE", "CATALOG", "main"]] * case["inspire_manages"]
                    return types.SimpleNamespace(status=statement_ok(), manifest=columns(("Principal", "ActionType", "ObjectType", "ObjectKey")),
                                                 result=types.SimpleNamespace(data_array=rows))
                if "information_schema" in statement:
                    if below_fails:
                        return globals()["statement"](FAILED, "TABLE_OR_VIEW_NOT_FOUND")
                    rows = [[g["level"], g["schema_name"], g["object_name"], g["privilege"]] for g in case["below"]]
                    return types.SimpleNamespace(status=statement_ok(), manifest=columns(("level", "schema_name", "object_name", "privilege")),
                                                 result=types.SimpleNamespace(data_array=rows))
                return globals()["statement"](FAILED if grant_fails else SUCCEEDED, "PERMISSION_DENIED" if grant_fails else None)

        owner = "someone@example.com" if "OWNER" in case["person"] else "data-owners"
        held = {p for p in case["person"] if p != "OWNER"}
        setup._catalog_privileges = lambda ctx, catalog: (owner == ctx["USER_EMAIL"], held)
        w = types.SimpleNamespace(statement_execution=Statements(), catalogs=types.SimpleNamespace(get=lambda name: types.SimpleNamespace(owner="x")))
        ctx = {"w": w, "WAREHOUSE_ID": "wh", "CATALOG": "main", "USER_EMAIL": "someone@example.com", "NEW_APPS_CATALOG_ACCESS": case["setting"]}
        return setup._catalog_access_for_new_apps(ctx, "SP"), executed

    def test_every_shared_case_decides_the_same_in_the_installer(self):
        for case in CASES["new_apps"]:
            decision = setup._new_apps_catalog_decision(case["setting"], CASES["catalog"], case["account_users"], case["person"], case["below"],
                                                        case["inspire_manages"])
            self.assertEqual(decision, (case["decision"], case["real"]), case["name"])

    def test_the_below_catalog_query_is_the_shared_one_and_reads_the_catalog_information_schema(self):
        self.assertEqual(setup._below_catalog_sql(CASES["catalog"]), CASES["below_sql"])
        for view in ("schema_privileges", "table_privileges", "volume_privileges", "routine_privileges"):
            self.assertIn(f"`main`.information_schema.{view}", CASES["below_sql"])

    def test_the_installer_grants_use_catalog_to_account_users_only_when_the_shared_case_says_grant(self):
        for case in CASES["new_apps"]:
            said, executed = self.access(case)
            granted = CASES["grant_sql"] in executed
            self.assertEqual(granted, case["decision"] == "grant", case["name"])
            queried = case["decision"] == "grant" or (case["decision"] == "below" and not any(" on catalog " in r for r in case["real"]))
            self.assertEqual(any("information_schema" in s for s in executed), queried, case["name"])
            if case["decision"] == "grant":
                self.assertIn("the installer granted USE CATALOG on it to account users ✅. This opens no data by itself", said, case["name"])
            elif case["decision"] in ("held", "inspire"):
                self.assertTrue(said.startswith("New Apps can use catalog `main`") and said.endswith("✅"), (case["name"], said))
            else:
                self.assertIn("A catalog owner can run GRANT MANAGE ON CATALOG `main` TO `SP`, or GRANT USE CATALOG ON CATALOG `main` TO `account users`",
                              said, case["name"])
            for grant in case["real"]:
                self.assertIn(grant, said, case["name"])
        below = next(c for c in CASES["new_apps"] if c["name"] == "a real table grant")
        self.assertIn("account users already hold SELECT on table main.sales.orders, which USE CATALOG would open to every account user",
                      self.access(below)[0])
        off = next(c for c in CASES["new_apps"] if c["decision"] == "off")
        self.assertIn("NEW_APPS_CATALOG_ACCESS is off", self.access(off)[0])

    def test_an_unreadable_listing_or_a_refused_grant_grants_nothing_and_names_the_owner_statements(self):
        case = CASES["new_apps"][0]
        said, executed = self.access(case, below_fails=True)
        self.assertNotIn(CASES["grant_sql"], executed)
        self.assertIn("could not be read (TABLE_OR_VIEW_NOT_FOUND), so the installer granted nothing to account users", said)
        said, executed = self.access(case, grant_fails=True)
        self.assertIn(CASES["grant_sql"], executed)
        self.assertIn(f"{CASES['grant_sql']} failed (PERMISSION_DENIED). A catalog owner can run", said)
        self.assertNotIn("✅", said)

    def test_many_real_grants_are_named_up_to_ten_and_counted(self):
        case = dict(CASES["new_apps"][4], below=[{"level": "table", "schema_name": "s", "object_name": f"t{i}", "privilege": "SELECT"} for i in range(13)])
        said, _ = self.access(case)
        self.assertIn("SELECT on table main.s.t9, 3 more, which USE CATALOG", said)
        self.assertNotIn("main.s.t10", said)

    def test_the_setting_is_account_users_or_off(self):
        self.assertEqual([setup._new_apps_setting(v) for v in ("account users", " Account Users ", "off", "OFF")],
                         ["account users", "account users", "off", "off"])
        for bad in ("all", "", None, ["off"], "users"):
            with self.assertRaises(ValueError):
                setup._new_apps_setting(bad)


class GrantPlanTest(unittest.TestCase):
    def grant(self, scan, listed=("main", "sales", "finance", "samples", "system", "inspire_lakebase"), rights=None, owners=None,
              admin="metastore-admins", fail=None):
        out = io.StringIO()
        executed = []
        held_on = {n: ("MANAGE",) for n in listed} if rights is None else rights
        prefix = "/api/2.1/unity-catalog/effective-permissions/catalog/"

        class Statements:
            def execute_statement(self, warehouse_id, statement, wait_timeout):
                executed.append((statement, out.getvalue()))
                for needle, err in (fail or {}).items():
                    if needle in statement:
                        raise err
                return globals()["statement"](SUCCEEDED)

        def api_get(path):
            if path == "/api/2.1/unity-catalog/metastore_summary":
                return {"owner": admin}
            name = path[len(prefix):].split("?")[0]
            if path.startswith(prefix) and name in held_on:
                if isinstance(held_on[name], Exception):
                    raise held_on[name]
                return {"privilege_assignments": [{"principal": "someone@example.com", "privileges": [{"privilege": p} for p in held_on[name]]}]}
            raise RuntimeError(f"PERMISSION_DENIED: cannot read {name}")

        w = types.SimpleNamespace(statement_execution=Statements(),
                                  catalogs=types.SimpleNamespace(list=lambda: [types.SimpleNamespace(name=n) for n in listed],
                                                                 get=lambda name: types.SimpleNamespace(name=name, owner=(owners or {}).get(name, "x"))))
        ctx = {"NEW_SP_APP_ID": "SP", "WAREHOUSE_ID": "wh", "w": w, "CATALOG": "main", "SCHEMA": "_inspire", "APP_NAME": "inspire-ai",
               "api": lambda method, path, body=None: Resp(200, {"object_id": 1}), "available_catalogs": [n for n in listed if n != "system"],
               "ASSETS_PATH": "/Workspace/Shared/inspire-ai/assets/v1.3.0", "SCAN_CATALOGS": scan, "api_get": api_get,
               "USER_EMAIL": "someone@example.com", "USER_GROUPS": ["admins"]}
        with contextlib.redirect_stdout(out):
            setup.step_grant_permissions(ctx)
        grants = [s for s, _ in executed if s.startswith("GRANT ")]
        printed = [line.strip() for line in out.getvalue().splitlines() if line.startswith("  GRANT ")]
        return grants, printed, executed, out.getvalue()

    def test_all_keeps_the_grants_on_every_catalog_the_installer_can_see(self):
        grants, printed, _, said = self.grant("all")
        self.assertEqual(grants, INSPIRE_GRANTS + scan_grants("finance", "inspire_lakebase", "sales") + [LAKEBASE_GRANT])
        self.assertEqual(printed, grants)
        self.assertIn("SCAN_CATALOGS = all", said)

    def test_a_list_grants_only_those_catalogs_plus_the_inspire_catalog_and_lakebase(self):
        grants, printed, _, said = self.grant(["sales", "main"])
        self.assertEqual(grants, INSPIRE_GRANTS + scan_grants("sales") + [LAKEBASE_GRANT])
        self.assertFalse([g for g in grants if "`finance`" in g or "`samples`" in g], grants)
        self.assertEqual(printed, grants)
        self.assertIn("SCAN_CATALOGS = sales, main", said)
        grants, printed, _, said = self.grant([])
        self.assertEqual(grants, INSPIRE_GRANTS + [LAKEBASE_GRANT])
        self.assertIn("no other catalog", said)
        grants, _, _, _ = self.grant(["sales"], listed=("main", "sales", "finance"))
        self.assertEqual(grants, INSPIRE_GRANTS + scan_grants("sales"))

    def test_all_grants_only_the_catalogs_the_person_can_grant_on_and_names_the_skipped_ones_before_the_first_grant(self):
        listed = ("main", "sales", "finance", "owned", "shared", "samples", "system", "inspire_lakebase")
        rights = {"main": ("MANAGE",), "sales": ("MANAGE",), "finance": ("USE_CATALOG", "SELECT"), "owned": (), "inspire_lakebase": ("USE_CATALOG",)}
        grants, printed, executed, said = self.grant("all", listed=listed, rights=rights, owners={"owned": "someone@example.com"})
        self.assertEqual(grants, INSPIRE_GRANTS + scan_grants("owned", "sales") + [LAKEBASE_GRANT])
        self.assertEqual(printed, grants)
        self.assertFalse([g for g in grants if "`finance`" in g or "`shared`" in g], grants)
        before_first = next(text for s, text in executed if s.startswith("GRANT "))
        self.assertIn("Skipped catalog `finance`, so the Inspire App will not read it: you are not its owner or a metastore admin and hold no "
                      "MANAGE on it. The catalog owner can run GRANT MANAGE ON CATALOG `finance` TO `someone@example.com`, or make you the owner "
                      "of `finance`. Run this installer again once you can grant on it.", before_first)
        self.assertIn("Skipped catalog `inspire_lakebase`, so the Inspire App will not read it: you are not its owner", before_first)
        self.assertIn("Skipped catalog `shared`, so the Inspire App will not read it: your rights on catalog `shared` could not be read "
                      "(PERMISSION_DENIED: cannot read shared)", before_first)
        for name in ("main", "sales", "owned", "samples", "system"):
            self.assertNotIn(f"Skipped catalog `{name}`", said, name)
        self.assertIn(f"Grants: {len(grants)} of {len(grants)} ran ✅", said)
        self.assertNotIn("Note: you can grant on no catalog", said)
        grants, _, _, said = self.grant("all", listed=listed, rights=rights, admin="admins")
        self.assertEqual(grants, INSPIRE_GRANTS + scan_grants("finance", "inspire_lakebase", "owned", "sales") + [LAKEBASE_GRANT])
        self.assertIn("Skipped catalog `shared`, so the Inspire App will not read it: your rights on catalog `shared` could not be read", said)

    def test_all_skips_a_catalog_held_only_with_all_privileges_and_still_grants_on_owned_managed_and_admin_catalogs(self):
        listed = ("main", "sales", "finance", "owned")
        rights = {"main": ("MANAGE",), "sales": ("MANAGE",), "finance": ("ALL_PRIVILEGES",), "owned": ("ALL_PRIVILEGES",)}
        grants, printed, executed, said = self.grant("all", listed=listed, rights=rights, owners={"owned": "someone@example.com"})
        self.assertEqual(grants, INSPIRE_GRANTS + scan_grants("owned", "sales"))
        self.assertEqual(printed, grants)
        before_first = next(text for s, text in executed if s.startswith("GRANT "))
        self.assertIn("Skipped catalog `finance`, so the Inspire App will not read it: you are not its owner or a metastore admin and hold no "
                      "MANAGE on it (ALL PRIVILEGES does not include MANAGE). The catalog owner can run GRANT MANAGE ON CATALOG `finance` TO "
                      "`someone@example.com`, or make you the owner of `finance`.", before_first)
        self.assertNotIn("Skipped catalog `owned`", said)
        self.assertNotIn("Skipped catalog `sales`", said)
        grants, _, _, said = self.grant("all", listed=listed, rights=rights, admin="admins")
        self.assertEqual(grants, INSPIRE_GRANTS + scan_grants("finance", "owned", "sales"))
        self.assertNotIn("Skipped catalog", said)

    def test_a_rights_lookup_http_error_skips_the_catalog_in_plain_words_with_its_status_and_no_workspace_url(self):
        listed = ("main", "sales", "locked", "broken")
        rights = {"main": ("MANAGE",), "sales": ("MANAGE",), "broken": http_error(500),
                  "locked": http_error(403, {"error_code": "PERMISSION_DENIED", "message": f"denied, see {HOST}/docs"})}
        grants, _, executed, said = self.grant("all", listed=listed, rights=rights)
        self.assertEqual(grants, INSPIRE_GRANTS + scan_grants("sales"))
        before_first = next(text for s, text in executed if s.startswith("GRANT "))
        self.assertIn("Skipped catalog `locked`, so the Inspire App will not read it: you cannot see who can grant on catalog `locked` (HTTP 403). "
                      "A catalog owner can run GRANT MANAGE ON CATALOG `locked` TO `someone@example.com`. Run this installer again", before_first)
        self.assertIn("Skipped catalog `broken`, so the Inspire App will not read it: your rights on catalog `broken` could not be read (HTTP 500).",
                      before_first)
        lines = [line for line in said.splitlines() if "Skipped catalog" in line or "GRANT " in line or "⚠️" in line]
        self.assertEqual(len([line for line in lines if "Skipped catalog" in line]), 2)
        for line in lines:
            self.assertNotIn("https://", line)
            self.assertNotIn("adb-", line)
        self.assertNotIn("https://", said)
        self.assertNotIn("adb-", said)

    def test_a_failed_grant_prints_its_whole_cause_without_the_workspace_url(self):
        cause = ("PERMISSION_DENIED: User does not have MANAGE on Catalog 'sales'. The catalog owner must grant MANAGE before this principal "
                 "can receive USE CATALOG, USE SCHEMA, SELECT or BROWSE on it, see " + HOST + "/docs for the privilege model")
        sql = "GRANT SELECT ON CATALOG `sales` TO `SP`"
        grants, _, _, said = self.grant(["sales"], listed=("main", "sales"), fail={sql: RuntimeError(cause)})
        self.assertIn(sql, grants)
        shown = cause.replace(HOST + "/docs", "the workspace")
        self.assertGreater(len(shown), 160)
        self.assertIn(f"  ⚠️ {sql}: {shown}\n", said)
        self.assertIn(f"Grants: {len(grants) - 1} of {len(grants)} ran ⚠️", said)
        self.assertNotIn("https://", said)
        self.assertNotIn("adb-", said)

    def test_error_words_keep_the_status_and_drop_every_url_and_workspace_host(self):
        self.assertEqual(setup._error_words(http_error(403, {"message": f"denied by {HOST}/api"})), "HTTP 403: denied by the workspace")
        self.assertEqual(setup._error_words(http_error(404, {"error_code": "NOT_FOUND"})), "HTTP 404: NOT_FOUND")
        self.assertEqual(setup._error_words(http_error(502)), "HTTP 502")
        self.assertEqual(setup._error_words(RuntimeError(f"failed for url: {HOST}/api/2.0/apps")), "failed for url: the workspace")
        self.assertEqual(setup._error_words(RuntimeError("adb-xxxx.xx is down")), "the workspace is down")
        self.assertEqual(setup._error_words(RuntimeError("x" * 300)), "x" * 160)
        self.assertEqual(setup._error_words(RuntimeError("x" * 300), None), "x" * 300)
        self.assertEqual(setup._error_words(ValueError("PERMISSION_DENIED: no MANAGE")), "PERMISSION_DENIED: no MANAGE")

    def test_all_with_no_grantable_catalog_besides_the_inspire_catalog_installs_with_a_clear_note(self):
        grants, printed, _, said = self.grant("all", listed=("main", "sales", "finance"), rights={"main": ("MANAGE",), "sales": ("USE_CATALOG",),
                                                                                                    "finance": ()})
        self.assertEqual(grants, INSPIRE_GRANTS)
        self.assertEqual(printed, grants)
        self.assertIn("Skipped catalog `sales`", said)
        self.assertIn("Skipped catalog `finance`", said)
        self.assertIn("Note: you can grant on no catalog besides `main`, so the Inspire App reads only `main` for now.", said)
        self.assertIn(f"Grants: {len(grants)} of {len(grants)} ran ✅", said)
        grants, _, _, said = self.grant(["sales"], listed=("main", "sales", "finance"), rights={"main": ("MANAGE",)})
        self.assertEqual(grants, INSPIRE_GRANTS + scan_grants("sales"))
        self.assertNotIn("Skipped catalog", said)
        self.assertNotIn("Note: you can grant on no catalog", said)

    def test_the_whole_plan_is_printed_before_the_first_grant_runs(self):
        for scan in ("all", ["sales"]):
            grants, _, executed, _ = self.grant(scan)
            before_first = next(text for s, text in executed if s.startswith("GRANT "))
            self.assertIn(f"Grant plan for SP: {len(grants)} statements", before_first, scan)
            for sql in grants:
                self.assertIn(f"  {sql}\n", before_first, scan)


APP_URL = "https://inspire-ai-1234.aws.databricksapps.com"


class AppUrlTest(unittest.TestCase):
    def deploy(self, exists=False):
        scopes = list(setup.INSPIRE_APP_OWN_SCOPES)
        states = [{"url": "Unavailable", "compute_status": {"state": "STARTING"}, "user_api_scopes": scopes},
                  {"url": "Unavailable", "compute_status": {"state": "ACTIVE"}, "user_api_scopes": scopes},
                  {"url": APP_URL, "compute_status": {"state": "ACTIVE"}, "user_api_scopes": scopes, "service_principal_client_id": "SPNEW",
                   "service_principal_name": "app-sp", "active_deployment": {"deployment_id": "d1", "status": {"state": "SUCCEEDED"}}}]

        def api(method, path, body=None):
            if method == "POST" and path == "/api/2.0/apps":
                return Resp(409, {}, "App already exists") if exists else Resp(200, {"name": "inspire-ai", "url": "Unavailable"})
            return Resp(200, {"deployment_id": "d1"})

        def api_get(path):
            if path == "/api/2.0/apps/inspire-ai":
                return states.pop(0) if len(states) > 1 else states[0]
            return {"Resources": [{"id": "1"}]}

        saved, clock = setup.write_app_yaml_deploy, setup.time
        setup.write_app_yaml_deploy = lambda *a: None
        setup.time = types.SimpleNamespace(sleep=lambda s: None)
        ctx = {"api": api, "api_get": api_get, "SOURCE_FOLDER": "/Workspace/b", "INSPIRE_DB": "main._inspire", "WAREHOUSE_ID": "wh",
               "NOTEBOOK_PATH": "/Shared/inspire-ai/dbx_inspire_ai_agent", "SP_NAME": "inspire-ai-sp", "APP_NAME": "inspire-ai",
               "CATALOG": "main", "RELEASE_VERSION": "v1.3.0"}
        out = io.StringIO()
        try:
            with contextlib.redirect_stdout(out):
                setup.step_deploy_and_find_sp(ctx)
        finally:
            setup.write_app_yaml_deploy, setup.time = saved, clock
        return ctx, out.getvalue()

    def test_the_url_is_printed_once_the_app_reports_it_and_never_as_unavailable(self):
        for exists in (False, True):
            ctx, said = self.deploy(exists)
            self.assertNotIn("Unavailable", said, exists)
            self.assertEqual(said.count(f"App URL: {APP_URL}"), 1, said)
            self.assertEqual(ctx["app_url"], APP_URL)

    def test_the_done_page_never_shows_a_url_the_app_has_not_reported(self):
        shown = []
        saved = getattr(setup, "displayHTML", None)
        setup.displayHTML = shown.append
        base = {"APP_NAME": "inspire-ai", "INSPIRE_DB": "main._inspire", "WAREHOUSE_NAME": "wh", "NEW_SP_APP_ID": "sp",
                "ASSETS_PATH": "/x", "RELEASE_VERSION": "v1.3.0"}
        try:
            for extra, url in (({"app_url": APP_URL}, APP_URL), ({}, "")):
                printed = io.StringIO()
                with contextlib.redirect_stdout(printed):
                    setup.step_render_done(dict(base, api_get=lambda path: {"url": "Unavailable"}, **extra))
                self.assertNotIn("Unavailable", printed.getvalue() + shown[-1])
                if url:
                    self.assertIn(f"URL:         {url}", printed.getvalue())
                    self.assertIn(f'href="{url}"', shown[-1])
                else:
                    self.assertIn("Databricks has not reported the App URL yet", printed.getvalue())
                    self.assertNotIn("href=", shown[-1])
        finally:
            setup.displayHTML = saved


class RuntimeContextTest(unittest.TestCase):
    def setUp(self):
        self.saved = (setup.WorkspaceClient, setup._unpack_bundle, getattr(setup, "dbutils", None), getattr(setup, "displayHTML", None))
        self.shown = []
        setup.displayHTML = self.shown.append

    def tearDown(self):
        setup.WorkspaceClient, setup._unpack_bundle, setup.dbutils, setup.displayHTML = self.saved

    @staticmethod
    def warehouse(wid="wh1", name="Shared", state="RUNNING"):
        return types.SimpleNamespace(id=wid, name=name, state=types.SimpleNamespace(value=state), enable_serverless_compute=True)

    def context(self, env, widgets=None, warehouses=None, catalogs=("main", "sales")):
        if widgets is None:
            widgets = support.FakeWidgets({"00_sql_warehouse": {"kind": "combobox", "value": "Shared (wh1)"},
                                           "01_inspire_catalog": {"kind": "combobox", "value": "main"}})
        setup.dbutils = types.SimpleNamespace(widgets=widgets)
        me = types.SimpleNamespace(user_name="someone@example.com", groups=[types.SimpleNamespace(display="admins")])
        listed = warehouses or [self.warehouse()]

        class Client:
            current_user = types.SimpleNamespace(me=lambda: me)
            config = types.SimpleNamespace(host="https://workspace.example.com", authenticate=lambda: {"Authorization": "Bearer x"})
            warehouses = types.SimpleNamespace(list=lambda: listed)
            catalogs = types.SimpleNamespace(list=lambda: [types.SimpleNamespace(name=name) for name in catalogs])
        setup.WorkspaceClient = Client
        unpacked = []
        setup._unpack_bundle = lambda source, root: unpacked.append((source, root)) or f"{root}/bundle_1"
        with contextlib.redirect_stdout(io.StringIO()):
            return setup.build_runtime_context(env), unpacked

    ENV = {"manifest": {"version": "v1.3.0"}, "files": {"inspire-app.zip": "/z", "inspire-assets.tar": "/t"}, "folders": {}, "settings": {}}

    def run_with(self, widgets, **kwargs):
        widgets.new_cell()
        widgets.calls.clear()
        ctx, _ = self.context(dict(self.ENV), widgets, **kwargs)
        for index, call in enumerate(widgets.calls):
            if call[0] == "remove":
                later = [c for c in widgets.calls[index + 1:] if c[0] == "create" and c[2] == call[1]]
                self.assertEqual(later, [], f"{call[1]} is removed and created again in the same cell")
        return ctx

    def banner(self):
        return self.shown[-1] if self.shown else ""

    def test_a_first_run_shows_both_pickers_as_lists_you_can_type_into_and_waits(self):
        widgets = support.FakeWidgets()
        ctx = self.run_with(widgets, warehouses=[self.warehouse(), self.warehouse("wh2", "Analytics", "STOPPED")])
        self.assertEqual(ctx, {"ready": False})
        self.assertEqual(widgets.state["00_sql_warehouse"]["kind"], "combobox")
        self.assertEqual(widgets.state["01_inspire_catalog"]["kind"], "combobox")
        self.assertEqual(widgets.state["00_sql_warehouse"]["choices"], ["Pick from the list or type", "Shared (wh1)", "Analytics (wh2)"])
        self.assertEqual(widgets.state["01_inspire_catalog"]["choices"], ["Pick from the list or type", "main", "sales"])
        self.assertIn("Choose notebook parameter values first", self.banner())
        self.assertIn("Pick or type a SQL warehouse in 00_sql_warehouse.", self.banner())
        self.assertIn("Pick or type a catalog in 01_inspire_catalog.", self.banner())

    def test_a_value_picked_from_each_list_installs_with_that_warehouse_and_catalog(self):
        widgets = support.FakeWidgets()
        self.run_with(widgets, warehouses=[self.warehouse(), self.warehouse("wh2", "Analytics", "STOPPED")])
        widgets.pick("00_sql_warehouse", "Analytics (wh2)")
        widgets.pick("01_inspire_catalog", "sales")
        ctx = self.run_with(widgets, warehouses=[self.warehouse(), self.warehouse("wh2", "Analytics", "STOPPED")])
        self.assertEqual((ctx["WAREHOUSE_ID"], ctx["WAREHOUSE_NAME"], ctx["CATALOG"], ctx["INSPIRE_DB"]),
                         ("wh2", "Analytics", "sales", "sales._inspire"))

    def test_a_typed_exact_warehouse_name_or_id_and_a_typed_catalog_name_in_any_case_are_used(self):
        listed = [self.warehouse(), self.warehouse("wh2", "Analytics", "STOPPED")]
        for typed_wh, typed_cat, expected in (("Analytics", "sales", ("wh2", "sales")), ("wh2", "SALES", ("wh2", "sales")),
                                              ("  wh1 ", "Main", ("wh1", "main")), ("Shared [RUNNING] wh1", "main", ("wh1", "main"))):
            widgets = support.FakeWidgets()
            self.run_with(widgets, warehouses=listed)
            widgets.pick("00_sql_warehouse", typed_wh)
            widgets.pick("01_inspire_catalog", typed_cat)
            ctx = self.run_with(widgets, warehouses=listed)
            self.assertEqual((ctx.get("WAREHOUSE_ID"), ctx.get("CATALOG")), expected, (typed_wh, typed_cat))

    def test_a_saved_warehouse_still_matches_after_the_warehouse_stops_or_starts(self):
        widgets = support.FakeWidgets()
        self.run_with(widgets, warehouses=[self.warehouse(state="RUNNING")])
        widgets.pick("00_sql_warehouse", "Shared (wh1)")
        widgets.pick("01_inspire_catalog", "main")
        for state in ("RUNNING", "STOPPED", "STARTING"):
            ctx = self.run_with(widgets, warehouses=[self.warehouse(state=state)])
            self.assertEqual(ctx.get("WAREHOUSE_ID"), "wh1", state)
            self.assertEqual(widgets.state["00_sql_warehouse"]["value"], "Shared (wh1)")
        legacy = support.FakeWidgets({"00_sql_warehouse": {"kind": "dropdown", "value": "Shared [RUNNING] wh1",
                                                          "choices": ["Please select", "Shared [RUNNING] wh1"]},
                                      "01_inspire_catalog": {"kind": "dropdown", "value": "main", "choices": ["Please select", "main"]}})
        ctx = self.run_with(legacy, warehouses=[self.warehouse(state="STOPPED")])
        self.assertEqual((ctx.get("WAREHOUSE_ID"), ctx.get("CATALOG")), ("wh1", "main"))
        self.assertNotIn(("remove", "00_sql_warehouse"), legacy.calls)

    def test_a_typed_unknown_catalog_is_refused_in_the_banner_and_nothing_proceeds(self):
        widgets = support.FakeWidgets()
        self.run_with(widgets)
        widgets.pick("00_sql_warehouse", "Shared (wh1)")
        widgets.pick("01_inspire_catalog", "sale")
        self.assertEqual(self.run_with(widgets), {"ready": False})
        self.assertIn("No catalog you can use is named &#x27;sale&#x27;. Pick one from the list in 01_inspire_catalog, or type its exact name.",
                      self.banner())
        self.assertNotIn("SQL warehouse you can use", self.banner())

    def test_a_typed_unknown_or_shared_warehouse_name_is_refused_in_the_banner_and_nothing_proceeds(self):
        listed = [self.warehouse(), self.warehouse("wh2", "Shared", "STOPPED")]
        for typed, words in (("Sharedd", "No SQL warehouse you can use has the name or id &#x27;Sharedd&#x27;."),
                             ("wh9", "No SQL warehouse you can use has the name or id &#x27;wh9&#x27;."),
                             ("Old [RUNNING] wh9", "No SQL warehouse you can use has the name or id &#x27;Old [RUNNING] wh9&#x27;."),
                             ("Shared", "2 SQL warehouses are named &#x27;Shared&#x27;. Pick one from the list in 00_sql_warehouse or type its id.")):
            widgets = support.FakeWidgets()
            self.run_with(widgets, warehouses=listed)
            widgets.pick("00_sql_warehouse", typed)
            widgets.pick("01_inspire_catalog", "main")
            self.assertEqual(self.run_with(widgets, warehouses=listed), {"ready": False}, typed)
            self.assertIn(words, self.banner())

    def test_a_legacy_dropdown_with_no_usable_value_becomes_a_list_you_can_type_into_on_the_next_run(self):
        widgets = support.FakeWidgets({"00_sql_warehouse": {"kind": "dropdown", "value": "Please select", "choices": ["Please select"]},
                                       "01_inspire_catalog": {"kind": "dropdown", "value": "main", "choices": ["Please select", "main"]}})
        self.assertEqual(self.run_with(widgets), {"ready": False})
        self.assertNotIn("00_sql_warehouse", widgets.state)
        self.assertIn("now lists you can also type into. Run this installer again to show them", self.banner())
        self.run_with(widgets)
        self.assertEqual(widgets.state["00_sql_warehouse"]["kind"], "combobox")
        widgets.pick("00_sql_warehouse", "Shared")
        self.assertEqual(self.run_with(widgets).get("WAREHOUSE_ID"), "wh1")

    def test_a_widget_that_cannot_be_removed_is_still_offered_as_a_list_you_can_type_into(self):
        class Stuck(support.FakeWidgets):
            def remove(self, name):
                self.calls.append(("remove", name))
                raise ValueError("cannot remove")
        widgets = Stuck({"00_sql_warehouse": {"kind": "combobox", "value": "Gone [STOPPED] wh9", "choices": []}})
        self.assertEqual(self.context(dict(self.ENV), widgets)[0], {"ready": False})
        self.assertEqual([c for c in widgets.calls if "00_sql_warehouse" in c],
                         [("remove", "00_sql_warehouse"), ("create", "combobox", "00_sql_warehouse", "Pick from the list or type")])
        self.assertIn("No SQL warehouse you can use has the name or id &#x27;Gone [STOPPED] wh9&#x27;.", self.banner())
        self.assertIn("Pick a value from each list at the top of the notebook, or type it", self.banner())

    def test_the_test_setting_picks_the_warehouse_and_catalog_without_any_widget_value(self):
        ctx, _ = self.context(dict(self.ENV, settings={"warehouse_id": "wh1", "catalog": "SALES"}), support.FakeWidgets())
        self.assertEqual((ctx["WAREHOUSE_ID"], ctx["CATALOG"]), ("wh1", "sales"))

    def test_the_bundle_and_the_assets_come_from_the_checked_release_and_nothing_is_written_yet(self):
        files = {"inspire-app.zip": "/tmp/r/inspire-app.zip", "inspire-assets.tar": "/tmp/r/inspire-assets.tar"}
        ctx, unpacked = self.context({"manifest": {"version": "v1.3.0"}, "files": files, "folders": {}, "settings": {}})
        self.assertEqual(unpacked, [])
        self.assertEqual((ctx["SOURCE_ZIP"], ctx["BUNDLE_ROOT"], ctx["ASSETS_TAR"], ctx["ASSETS_ROOT"], ctx["APP_NAME"], ctx["USER_GROUPS"]),
                         ("/tmp/r/inspire-app.zip", "/Workspace/Shared/inspire-ai/apps/inspire-ai", "/tmp/r/inspire-assets.tar",
                          "/Workspace/Shared/inspire-ai/assets/v1.3.0", "inspire-ai", ["admins"]))
        self.assertNotIn("/Users/", ctx["BUNDLE_ROOT"])

    def test_scan_catalogs_comes_from_the_installer_and_is_all_when_an_installer_sends_none(self):
        base = {"manifest": {"version": "v1.3.0"}, "files": {"inspire-app.zip": "/z", "inspire-assets.tar": "/t"}, "settings": {}}
        self.assertEqual(self.context(base)[0]["SCAN_CATALOGS"], "all")
        self.assertEqual(self.context(dict(base, scan_catalogs=["sales"]))[0]["SCAN_CATALOGS"], ["sales"])
        self.assertEqual(self.context(dict(base, scan_catalogs="all"))[0]["SCAN_CATALOGS"], "all")

    def test_new_apps_catalog_access_comes_from_the_installer_and_is_account_users_when_an_installer_sends_none(self):
        base = {"manifest": {"version": "v1.3.0"}, "files": {"inspire-app.zip": "/z", "inspire-assets.tar": "/t"}, "settings": {}}
        self.assertEqual(self.context(base)[0]["NEW_APPS_CATALOG_ACCESS"], "account users")
        self.assertEqual(self.context(dict(base, new_apps_catalog_access="off"))[0]["NEW_APPS_CATALOG_ACCESS"], "off")
        with self.assertRaises(ValueError):
            self.context(dict(base, new_apps_catalog_access="everyone"))

    def test_the_bundle_step_unpacks_the_app_into_the_shared_app_folder(self):
        unpacked = []
        setup._unpack_bundle = lambda source, root: unpacked.append((source, root)) or f"{root}/bundle_1"
        ctx = {"SOURCE_ZIP": "/tmp/r/inspire-app.zip", "BUNDLE_ROOT": "/Workspace/Shared/inspire-ai/apps/inspire-ai", "RELEASE_VERSION": "v1.3.0"}
        with contextlib.redirect_stdout(io.StringIO()):
            setup.step_bundle(ctx)
        self.assertEqual(unpacked, [("/tmp/r/inspire-app.zip", "/Workspace/Shared/inspire-ai/apps/inspire-ai")])
        self.assertEqual(ctx["SOURCE_FOLDER"], "/Workspace/Shared/inspire-ai/apps/inspire-ai/bundle_1")

    def test_the_test_setting_names_the_app(self):
        ctx, _ = self.context({"manifest": {"version": "v1.3.0"}, "files": {"inspire-app.zip": "/z", "inspire-assets.tar": "/t"},
                               "settings": {"app_name": "inspire-inst-test"}})
        self.assertEqual((ctx["APP_NAME"], ctx["SP_NAME"]), ("inspire-inst-test", "inspire-inst-test-sp"))

    def test_only_a_test_tag_in_the_settings_makes_a_test_install(self):
        base = {"manifest": {"version": "v1.3.0"}, "files": {"inspire-app.zip": "/z", "inspire-assets.tar": "/t"}}
        self.assertEqual(self.context(dict(base, settings={"test_tag": " inspire-rc0 "}))[0]["TEST_TAG"], "inspire-rc0")
        for settings in ({}, {"app_name": "inspire-inst-test", "release": "x"}, {"test_tag": "  "}):
            self.assertEqual(self.context(dict(base, settings=settings))[0]["TEST_TAG"], "", settings)

    def test_the_settings_file_picks_the_warehouse_and_catalog_for_a_job_run(self):
        ctx, _ = self.context({"manifest": {"version": "v1.3.0"}, "files": {"inspire-app.zip": "/z", "inspire-assets.tar": "/t"},
                               "folders": {}, "settings": {"warehouse_id": "wh1", "catalog": "main"}})
        self.assertEqual((ctx["WAREHOUSE_ID"], ctx["CATALOG"]), ("wh1", "main"))
        for settings in ({"warehouse_id": "nope"}, {"catalog": "nope"}):
            with self.assertRaises(ValueError):
                self.context({"manifest": {"version": "v1.3.0"}, "files": {"inspire-app.zip": "/z", "inspire-assets.tar": "/t"},
                              "folders": {}, "settings": settings})

    def test_a_release_without_the_app_or_the_assets_stops_before_anything_changes(self):
        for files in ({"inspire-assets.tar": "/t"}, {"inspire-app.zip": "/z"}):
            with self.assertRaises(FileNotFoundError):
                self.context({"manifest": {"version": "v1.3.0"}, "files": files, "folders": {}, "settings": {}})


if __name__ == "__main__":
    unittest.main()
