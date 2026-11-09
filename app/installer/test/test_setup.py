import base64
import contextlib
import io
import json
import os
import pathlib
import shutil
import tarfile
import tempfile
import time
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

    def test_an_app_of_the_same_name_that_is_not_inspire_is_left_alone_and_an_older_inspire_app_is_still_replaced(self):
        def named(app, yaml_status=200, yaml_text=""):
            plain = app_exists()

            def script(method, path, body):
                if path == "/api/2.0/apps/inspire-ai" and method == "GET":
                    return Resp(200, dict({"name": "inspire-ai"}, **app))
                if path.startswith("/api/2.0/workspace/export?") and "Shared/other/app.yaml" in path:
                    return Resp(yaml_status, {"content": base64.b64encode(yaml_text.encode()).decode()}, "" if yaml_status == 200 else "denied")
                return plain(method, path, body)
            return script

        deployed = {"active_deployment": {"deployment_artifacts": {"source_code_path": "/Workspace/Shared/other"}}}
        for name, app, yaml, refused in (
                ("someone's dashboard App", dict(deployed, description="Sales board"), (200, "command: [python, app.py]\n"),
                 "its app.yaml names no Inspire setting"),
                ("an App whose files you cannot read", deployed, (403, ""), "its app.yaml could not be read (403 denied)"),
                ("an Inspire App of an older release", deployed, (200, "env:\n  - name: INSPIRE_WAREHOUSE_ID\n"), None),
                ("an Inspire App that names its release", dict(deployed, description="Inspire AI v1.2.9"), (403, ""), None),
                ("an App with nothing deployed", {"description": ""}, (403, ""), None)):
            api, calls = recording(named(app, *yaml))
            steps, error, _ = self.run_install(context(api))
            if refused:
                self.assertEqual(steps, [], name)
                self.assertIn("Nothing was replaced", error, name)
                self.assertIn(f"An App named inspire-ai already exists and is not an Inspire App ({refused}), so the installer leaves it alone. "
                              "Its owner can delete it; then run this installer again.", error, name)
                self.assertEqual([c for c in calls if c[0] in ("DELETE", "PATCH", "PUT") or c[1].startswith("/api/2.0/apps/inspire-ai/")
                                  or (c[0] == "POST" and c[1] != "/api/2.0/workspace/mkdirs")], [], name)
            else:
                self.assertIsNone(error, name)
                self.assertEqual(list(steps), list(INSTALL_STEPS), name)

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
        self.assertIn("4 files in", said)
        self.assertIn("(4 copied, 0 already there)", said)
        _, said = self.install()
        self.assertIn("(0 copied, 4 already there)", said)
        (self.root / "fonts" / "inter-400.ttf").write_bytes(b"damaged")
        _, said = self.install()
        self.assertIn("(1 copied, 3 already there)", said)
        self.assertEqual((self.root / "fonts" / "inter-400.ttf").read_bytes(), self.files["fonts/inter-400.ttf"])

    def test_both_cpu_builds_of_each_cli_land_whatever_machine_the_installer_runs_on(self):
        shutil.rmtree(self.assets)
        self.assets.mkdir()
        builds = {f"cli/{name}-{machine}.{kind}": f"{name} {machine}".encode() * 50
                  for name, kind in (("genie-code-cli", "tar.gz"), ("databricks-cli", "zip")) for machine in ("x86_64", "aarch64")}
        support.make_assets(self.assets, files=builds)
        support.release.write_assets_tar(self.assets, "v1.3.0", self.tar, support.release.load_starter())
        for machine in ("aarch64", "x86_64", "arm64"):
            shutil.rmtree(self.root.parent, ignore_errors=True)
            with mock.patch("platform.machine", return_value=machine):
                _, said = self.install()
            self.assertEqual({name: (self.root / name).read_bytes() for name in builds}, builds, machine)
            self.assertEqual(json.loads((self.root / "manifest.json").read_text()), json.loads((self.assets / "manifest.json").read_text()))
            self.assertIn("(5 copied, 0 already there)", said)

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
        self.assertEqual(self.deploy({})[5:], ("/Workspace/Shared/inspire-ai/assets/v1.3.0", None))

    def test_the_deploy_step_writes_the_test_tag_of_a_test_install_only(self):
        self.assertEqual(self.deploy({"TEST_TAG": "inspire-rc0"})[6], "inspire-rc0")
        self.assertEqual(self.deploy({"TEST_TAG": ""})[6], "")

    def deploy(self, extra):
        written = []
        saved, clock = setup.write_app_yaml_deploy, setup.time
        setup.write_app_yaml_deploy = lambda *a: written.append(a) or "env: wanted\n"
        setup.time = types.SimpleNamespace(sleep=lambda s: None)
        try:
            app = {"compute_status": {"state": "ACTIVE"}, "url": "https://app", "service_principal_client_id": "SPNEW",
                   "service_principal_name": "app-sp", "active_deployment": {"deployment_id": "d1", "status": {"state": "SUCCEEDED"}}}
            api = lambda method, path, body=None: Resp(200, {"deployment_id": "d1", "url": "https://app"})
            api_get = lambda path: app if path == "/api/2.0/apps/inspire-ai" else {"Resources": [{"id": "1"}]}
            ctx = {"api": api, "api_get": api_get, "SOURCE_FOLDER": "/Workspace/b", "INSPIRE_DB": "main._inspire", "WAREHOUSE_ID": "wh",
                   "NOTEBOOK_PATH": "/Shared/inspire-ai/dbx_inspire_ai_agent", "SP_NAME": "inspire-ai-sp", "APP_NAME": "inspire-ai",
                   "CATALOG": "main", "ASSETS_PATH": "/Workspace/Shared/inspire-ai/assets/v1.3.0", "RELEASE_VERSION": "v1.3.0", **extra}
            with contextlib.redirect_stdout(io.StringIO()):
                setup.step_deploy_and_find_sp(ctx)
        finally:
            setup.write_app_yaml_deploy, setup.time = saved, clock
        return written[0]


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


SCAN_PREFIX = "GRANT USE_CATALOG, USE_SCHEMA, SELECT, BROWSE ON CATALOG "


def scan_grants(*catalogs):
    return [f"{SCAN_PREFIX}`{c}` TO `SP`" for c in sorted(catalogs)]


def essentials(grants):
    return [g for g in grants if not g.startswith(SCAN_PREFIX)]


def before_scan(executed):
    return next(text for s, text in executed if s.startswith(SCAN_PREFIX))


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


AGENT_NOTEBOOK = pathlib.Path(__file__).resolve().parents[2] / "dbx_inspire_ai_agent.ipynb"
LAKEBASE = setup.agent_lakebase(AGENT_NOTEBOOK.read_text(encoding="utf-8"))
PROJECT_PATH = f"/api/2.0/postgres/projects/{LAKEBASE['project']}"
CATALOG_PATH = f"/api/2.0/postgres/catalogs/{LAKEBASE['catalog']}"
ENDPOINT_PATH = f"/api/2.0/postgres/{LAKEBASE['endpoint']}"
PROJECT_GRANT_PATH = f"/api/2.0/permissions/database-projects/{LAKEBASE['project']}"
BOUND = {"spec": {"branch": LAKEBASE["branch"], "postgres_database": LAKEBASE["database"]}}
HOSTED = {"status": {"hosts": {"host": "pg.example"}}}
REFUSED_CATALOG = (403, {}, '{"error_code":"PERMISSION_DENIED","message":"User does not have CREATE CATALOG on Metastore"}')


def lakebase_api(project=((200, {"name": "projects/x"}),), catalog=((404, {}),), endpoint=((200, HOSTED),), make_project=(200, {}),
                 make_catalog=(200, {}), project_grant=(200, {})):
    calls = []
    queues = {PROJECT_PATH: list(project), CATALOG_PATH: list(catalog), ENDPOINT_PATH: list(endpoint)}

    def answer(path):
        queue = queues[path]
        return Resp(*(queue.pop(0) if len(queue) > 1 else queue[0]))

    def api(method, path, body=None):
        calls.append((method, path, body))
        if method == "GET" and path in queues:
            return answer(path)
        if method == "POST" and path.startswith("/api/2.0/postgres/projects?"):
            return Resp(*make_project)
        if method == "POST" and path.startswith("/api/2.0/postgres/catalogs?"):
            return Resp(*make_catalog)
        if method == "PATCH" and path == PROJECT_GRANT_PATH:
            return Resp(*project_grant)
        return Resp(200, {"object_id": 1})
    return api, calls


def postgres_posts(calls):
    return [(m, p, b) for m, p, b in calls if m == "POST" and p.startswith("/api/2.0/postgres/")]


class GrantPlanTest(unittest.TestCase):
    def grant(self, scan, listed=("main", "sales", "finance", "samples", "system", "inspire_lakebase"), rights=None, owners=None,
              admin="metastore-admins", fail=None, api=None, lakebase=LAKEBASE):
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

        self.reads = []

        def api_get(path):
            self.reads.append(path)
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
        if api is None:
            there = LAKEBASE["catalog"] in listed
            api, _calls = lakebase_api(catalog=((200, BOUND),) if there else ((404, {}),), make_catalog=REFUSED_CATALOG)
        ctx = {"NEW_SP_APP_ID": "SP", "WAREHOUSE_ID": "wh", "w": w, "CATALOG": "main", "SCHEMA": "_inspire", "APP_NAME": "inspire-ai",
               "api": api, "available_catalogs": [n for n in listed if n != "system"],
               "ASSETS_PATH": "/Workspace/Shared/inspire-ai/assets/v1.3.0", "SCAN_CATALOGS": scan, "api_get": api_get,
               "USER_EMAIL": "someone@example.com", "USER_GROUPS": ["admins"], "LAKEBASE": lakebase}
        with contextlib.redirect_stdout(out), mock.patch.object(setup, "LAKEBASE_POLL_S", 0):
            setup.step_grant_permissions(ctx)
        self.ctx = ctx
        grants = [s for s, _ in executed if s.startswith("GRANT ")]
        grants = essentials(grants) + sorted(g for g in grants if g.startswith(SCAN_PREFIX))
        printed = [line.strip() for line in out.getvalue().splitlines() if line.startswith("  GRANT ")]
        return grants, printed, executed, out.getvalue()

    def test_all_keeps_the_grants_on_every_catalog_the_installer_can_see(self):
        grants, printed, _, said = self.grant("all")
        self.assertEqual(grants, INSPIRE_GRANTS + [LAKEBASE_GRANT] + scan_grants("finance", "inspire_lakebase", "sales"))
        self.assertEqual(printed, essentials(grants))
        self.assertIn("SCAN_CATALOGS = all", said)

    def test_a_list_grants_only_those_catalogs_plus_the_inspire_catalog_and_lakebase(self):
        grants, printed, _, said = self.grant(["sales", "main"])
        self.assertEqual(grants, INSPIRE_GRANTS + [LAKEBASE_GRANT] + scan_grants("sales"))
        self.assertFalse([g for g in grants if "`finance`" in g or "`samples`" in g], grants)
        self.assertEqual(printed, essentials(grants))
        self.assertIn("SCAN_CATALOGS = sales, main", said)
        grants, printed, _, said = self.grant([])
        self.assertEqual(grants, INSPIRE_GRANTS + [LAKEBASE_GRANT])
        self.assertIn("SCAN_CATALOGS = none yet: the App reads only `main`", said)
        self.assertIn(setup.SCAN_NONE_SAID.format(catalog="main"), said)
        self.assertNotIn(setup.SCAN_NONE_SAID.format(catalog="main"), self.grant(["sales"])[3])
        grants, _, _, _ = self.grant(["sales"], listed=("main", "sales", "finance"))
        self.assertEqual(grants, INSPIRE_GRANTS + scan_grants("sales"))

    def test_all_grants_only_the_catalogs_the_person_can_grant_on_and_names_the_skipped_ones_before_the_first_grant(self):
        listed = ("main", "sales", "finance", "owned", "shared", "samples", "system", "inspire_lakebase")
        rights = {"main": ("MANAGE",), "sales": ("MANAGE",), "finance": ("USE_CATALOG", "SELECT"), "owned": (), "inspire_lakebase": ("USE_CATALOG",)}
        grants, printed, executed, said = self.grant("all", listed=listed, rights=rights, owners={"owned": "someone@example.com"})
        self.assertEqual(grants, INSPIRE_GRANTS + [LAKEBASE_GRANT] + scan_grants("owned", "sales"))
        self.assertEqual(printed, essentials(grants))
        self.assertFalse([g for g in grants if "`finance`" in g or "`shared`" in g], grants)
        before_first = before_scan(executed)
        self.assertIn("Skipped catalog `finance`, so the Inspire App will not read it: you are not its owner or a metastore admin and hold no "
                      "MANAGE on it. The catalog owner can run GRANT MANAGE ON CATALOG `finance` TO `someone@example.com`, or make you the owner "
                      "of `finance`. Run this installer again once you can grant on it.", before_first)
        self.assertIn("Skipped catalog `inspire_lakebase`, so the Inspire App will not read it: you are not its owner", before_first)
        self.assertIn("Skipped catalog `shared`, so the Inspire App will not read it: your rights on catalog `shared` could not be read "
                      "(PERMISSION_DENIED: cannot read shared)", before_first)
        for name in ("main", "sales", "owned", "samples", "system"):
            self.assertNotIn(f"Skipped catalog `{name}`", said, name)
        self.assertIn(f"Grants: {len(essentials(grants))} of {len(essentials(grants))} ran ✅", said)
        self.assertNotIn("Note: you can grant on no catalog", said)
        grants, _, _, said = self.grant("all", listed=listed, rights=rights, admin="admins")
        self.assertEqual(grants, INSPIRE_GRANTS + [LAKEBASE_GRANT] + scan_grants("finance", "inspire_lakebase", "owned", "sales", "shared"))
        self.assertNotIn("Skipped catalog", said)
        self.assertFalse([p for p in self.reads if "effective-permissions" in p], "a metastore admin's rights are not read per catalog")

    def test_all_skips_a_catalog_held_only_with_all_privileges_and_still_grants_on_owned_managed_and_admin_catalogs(self):
        listed = ("main", "sales", "finance", "owned")
        rights = {"main": ("MANAGE",), "sales": ("MANAGE",), "finance": ("ALL_PRIVILEGES",), "owned": ("ALL_PRIVILEGES",)}
        grants, printed, executed, said = self.grant("all", listed=listed, rights=rights, owners={"owned": "someone@example.com"})
        self.assertEqual(grants, INSPIRE_GRANTS + scan_grants("owned", "sales"))
        self.assertEqual(printed, essentials(grants))
        before_first = before_scan(executed)
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
        before_first = before_scan(executed)
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
        sql = scan_grants("sales")[0]
        grants, _, _, said = self.grant(["sales"], listed=("main", "sales"), fail={sql: RuntimeError(cause)})
        self.assertIn(sql, grants)
        shown = cause.replace(HOST + "/docs", "the workspace")
        self.assertGreater(len(shown), 160)
        self.assertIn(f"  ⚠️ {sql}: {shown}\n", said)
        self.assertIn("Catalog grants: 0 of 1 ran ⚠️", said)
        self.assertIn(f"Grants: {len(essentials(grants))} of {len(essentials(grants))} ran ✅", said)
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
        self.assertEqual(printed, essentials(grants))
        self.assertIn("Skipped catalog `sales`", said)
        self.assertIn("Skipped catalog `finance`", said)
        self.assertIn("Note: you can grant on no catalog besides `main`, so the Inspire App reads only `main` for now.", said)
        self.assertIn(f"Grants: {len(essentials(grants))} of {len(essentials(grants))} ran ✅", said)
        grants, _, _, said = self.grant(["sales"], listed=("main", "sales", "finance"), rights={"main": ("MANAGE",)})
        self.assertEqual(grants, INSPIRE_GRANTS + scan_grants("sales"))
        self.assertNotIn("Skipped catalog", said)
        self.assertNotIn("Note: you can grant on no catalog", said)

    def test_the_whole_plan_is_printed_before_the_first_grant_runs(self):
        for scan in ("all", ["sales"]):
            grants, _, executed, _ = self.grant(scan)
            before_first = next(text for s, text in executed if s.startswith("GRANT "))
            self.assertIn(f"Grant plan for SP: {len(essentials(grants))} statements on `main`.`_inspire`", before_first, scan)
            for sql in essentials(grants):
                self.assertIn(f"  {sql}\n", before_first, scan)
            catalogs = [g for g in grants if g.startswith(SCAN_PREFIX)]
            self.assertIn(f"Catalog grants for SP: {len(catalogs)} catalog", before_scan(executed), scan)


class LargeWorkspaceGrantTest(unittest.TestCase):
    def install(self, count, admin="admins", rights=None, owners=None):
        import threading
        lock, events, live, peak = threading.Lock(), [], [0], [0]
        names = ["main"] + [f"cat_{i:04d}" for i in range(count)] + ["__databricks_internal", "__replication_internal_x", "samples", "system"]
        prefix = "/api/2.1/unity-catalog/effective-permissions/catalog/"
        reads = []

        class Statements:
            def execute_statement(self, warehouse_id, statement, wait_timeout):
                with lock:
                    live[0] += 1
                    peak[0] = max(peak[0], live[0])
                    events.append(("sql", statement))
                time.sleep(0.001)
                with lock:
                    live[0] -= 1
                return globals()["statement"](SUCCEEDED)

        def api_get(path):
            with lock:
                reads.append(path)
            if path == "/api/2.1/unity-catalog/metastore_summary":
                return {"owner": admin}
            if path.startswith(prefix):
                held = (rights or {}).get(path[len(prefix):].split("?")[0], ("MANAGE",))
                return {"privilege_assignments": [{"privileges": [{"privilege": p} for p in held]}]}
            raise AssertionError(path)

        got = []

        def get(name):
            got.append(name)
            return types.SimpleNamespace(name=name, owner="x")

        w = types.SimpleNamespace(statement_execution=Statements(), catalogs=types.SimpleNamespace(
            list=lambda: [types.SimpleNamespace(name=n, owner=(owners or {}).get(n, "data-owners")) for n in names], get=get))
        base, _calls = lakebase_api(catalog=((404, {}),), make_catalog=REFUSED_CATALOG)

        def api(method, path, body=None):
            with lock:
                events.append(("api", f"{method} {path}"))
            return base(method, path, body)
        ctx = {"NEW_SP_APP_ID": "SP", "WAREHOUSE_ID": "wh", "w": w, "CATALOG": "main", "SCHEMA": "_inspire", "APP_NAME": "inspire-ai",
               "api": api, "available_catalogs": [n for n in names if n != "system"], "ASSETS_PATH": "/Workspace/Shared/inspire-ai/assets/v1.3.0",
               "SCAN_CATALOGS": "all", "api_get": api_get, "USER_EMAIL": "someone@example.com", "USER_GROUPS": ["admins"], "LAKEBASE": LAKEBASE}
        out = io.StringIO()
        started = time.monotonic()
        with contextlib.redirect_stdout(out), mock.patch.object(setup, "LAKEBASE_POLL_S", 0):
            setup.step_grant_permissions(ctx)
        return types.SimpleNamespace(events=events, peak=peak[0], said=out.getvalue(), reads=reads, got=got, secs=time.monotonic() - started)

    def test_thousands_of_catalogs_get_one_grant_each_in_a_bounded_pool_with_progress_after_the_warehouse_and_essentials(self):
        run = self.install(3600)
        sql = [text for kind, text in run.events if kind == "sql"]
        scan = [text for text in sql if text.startswith(SCAN_PREFIX)]
        self.assertEqual(len(scan), 3600)
        self.assertEqual(len(set(scan)), 3600)
        self.assertFalse([t for t in scan if "`__" in t or "`samples`" in t or "`system`" in t or "`main`" in t])
        first_sql = next(i for i, (kind, _) in enumerate(run.events) if kind == "sql")
        warehouse = run.events.index(("api", "PATCH /api/2.0/permissions/sql/warehouses/wh"))
        self.assertLess(warehouse, first_sql, "the warehouse grant comes before any statement")
        first_scan = next(i for i, (kind, text) in enumerate(run.events) if kind == "sql" and text.startswith(SCAN_PREFIX))
        last_essential = max(i for i, (kind, text) in enumerate(run.events) if kind == "sql" and text.startswith("GRANT ") and not text.startswith(SCAN_PREFIX))
        folders = max(i for i, (kind, text) in enumerate(run.events) if kind == "api" and "/permissions/directories/" in text)
        self.assertLess(last_essential, first_scan)
        self.assertLess(folders, first_scan, "the App folder and assets are shared before the catalog grants start")
        self.assertGreater(run.peak, 1, "catalog grants run side by side")
        self.assertLessEqual(run.peak, setup.SCAN_GRANT_WORKERS)
        self.assertIn("Catalog grants: 360 of 3,600\n", run.said)
        self.assertIn("Catalog grants: 3,600 of 3,600 ran ✅", run.said)
        self.assertIn("Catalogs: `cat_0000`, `cat_0001`", run.said)
        self.assertIn("and 3590 more", run.said)
        self.assertLess(len(run.said.splitlines()), 80, "the output stays short on thousands of catalogs")
        self.assertFalse([p for p in run.reads if "effective-permissions" in p], "a metastore admin's rights are not read per catalog")
        self.assertEqual(run.got, ["main"], "owners come from the catalog listing; only the Inspire catalog is read again, for new Apps")
        self.assertLess(run.secs, 30)

    def test_a_person_who_is_not_admin_has_rights_read_in_a_bounded_pool_and_many_skips_are_summed_up(self):
        rights = {f"cat_{i:04d}": () for i in range(0, 300, 2)}
        run = self.install(300, admin="metastore-admins", rights=rights, owners={"cat_0001": "someone@example.com"})
        scan = [text for kind, text in run.events if kind == "sql" and text.startswith(SCAN_PREFIX)]
        self.assertEqual(len(scan), 150)
        self.assertEqual(len([p for p in run.reads if "effective-permissions" in p and "/catalog/cat_" in p]), 299,
                         "an owned catalog needs no rights read")
        self.assertEqual(run.said.count("Skipped catalog `"), setup.SCAN_SHOWN)
        self.assertIn("Skipped 140 more catalogs you cannot grant on, so the Inspire App will not read them: `cat_0020`", run.said)
        self.assertIn("Checking your rights on 300 catalogs...", run.said)
        self.assertLess(len(run.said.splitlines()), 80)

    def test_a_handful_of_catalogs_prints_no_progress_lines(self):
        run = self.install(3)
        self.assertNotIn("Checking your rights", run.said)
        self.assertEqual(run.said.count("Catalog grants: "), 1)
        self.assertIn("Catalog grants: 3 of 3 ran ✅", run.said)


class LakebaseSetupTest(unittest.TestCase):
    grant = GrantPlanTest.grant

    def setup_only(self, api, sleep=None, lakebase=LAKEBASE):
        ctx = {"api": api, "USER_EMAIL": "someone@example.com", "LAKEBASE": lakebase}
        return setup._lakebase_setup(ctx, sleep=sleep or (lambda s: None))

    def test_the_installer_reads_the_lakebase_definition_the_agent_builds_with_from_the_bundled_notebook(self):
        found = setup.agent_constants(AGENT_NOTEBOOK.read_text(encoding="utf-8"), setup.LAKEBASE_CONSTANTS)
        self.assertEqual(LAKEBASE, {"project": found["IMPLEMENT_LAKEBASE_PROJECT"], "project_spec": found["IMPLEMENT_LAKEBASE_PROJECT_SPEC"],
                                    "branch": found["IMPLEMENT_LAKEBASE_BRANCH"], "endpoint": found["IMPLEMENT_LAKEBASE_ENDPOINT"],
                                    "database": found["IMPLEMENT_LAKEBASE_DATABASE"], "catalog": found["IMPLEMENT_LAKEBASE_CATALOG"]})
        self.assertEqual(LAKEBASE["branch"], f"projects/{LAKEBASE['project']}/branches/production")
        self.assertEqual(LAKEBASE["endpoint"], f"{LAKEBASE['branch']}/endpoints/primary")
        self.assertIsInstance(LAKEBASE["project_spec"].get("default_endpoint_settings"), dict)
        source = (pathlib.Path(setup.__file__).read_text(encoding="utf-8"))
        for name in (LAKEBASE["project"], LAKEBASE["catalog"], LAKEBASE["database"]):
            self.assertNotIn(f'"{name}"', source, "the installer holds no second copy of the agent's Lakebase names")

    def test_publishing_the_notebook_keeps_its_lakebase_definition_or_names_why_none_is_set_up(self):
        import base64
        for text, wanted in ((AGENT_NOTEBOOK.read_text(encoding="utf-8"), LAKEBASE), (json.dumps({"cells": [{"source": ""}, {"source": ""}]}), None)):
            api = lambda method, path, body=None: Resp(200, {"object_type": "NOTEBOOK"})
            ctx = {"w": Workspace(), "WAREHOUSE_ID": "wh", "CATALOG": "main", "SCHEMA": "_inspire", "SOURCE_FOLDER": "/b", "APP_NAME": "inspire-ai",
                   "api": api}
            with contextlib.redirect_stdout(io.StringIO()) as out, \
                    mock.patch.object(setup, "export_workspace_b64", lambda ctx, path, export_formats: base64.b64encode(text.encode()).decode()), \
                    mock.patch.object(setup.os.path, "exists", lambda path: path == "/b/dbx_inspire_ai_agent"):
                setup.step_schema_and_notebooks(ctx)
            self.assertEqual(ctx["LAKEBASE"], wanted)
            if wanted is None:
                self.assertEqual(ctx["LAKEBASE_NOTE"], "Inspire could not read the Lakebase project and catalog from the bundled agent notebook "
                                 f"(the bundled agent notebook defines no {', '.join(setup.LAKEBASE_CONSTANTS)}), so it set up no Lakebase: "
                                 "until then the Apps that Implement builds read Delta tables")
                self.assertIn(f"⚠️ {ctx['LAKEBASE_NOTE']}", out.getvalue())
            else:
                self.assertNotIn("LAKEBASE_NOTE", ctx)

    def test_the_notebook_reader_resolves_names_and_refuses_what_is_not_a_constant(self):
        def notebook(*lines):
            return json.dumps({"cells": [{"source": ""}, {"source": [line + "\n" for line in lines]}]})
        text = notebook('A = "x"', 'B = f"p/{A}/q"', 'C = {"k": [B, 1],', '     "n": (A,)}', "D = make()", 'E = f"{A!r}"')
        self.assertEqual(setup.agent_constants(text, ("B", "C")), {"B": "p/x/q", "C": {"k": ["p/x/q", 1], "n": ("x",)}})
        for name in ("D", "E"):
            with self.assertRaisesRegex(ValueError, f"{name} in the bundled agent notebook is not a constant"):
                setup.agent_constants(text, (name,))
        with self.assertRaisesRegex(ValueError, "the bundled agent notebook defines no Z, Y"):
            setup.agent_constants(text, ("Z", "A", "Y"))
        with self.assertRaisesRegex(ValueError, "the bundled agent notebook defines no MISSING"):
            setup.agent_constants(notebook('F = f"{MISSING}"'), ("F",))
        with self.assertRaisesRegex(ValueError, "IMPLEMENT_LAKEBASE_PROJECT_SPEC in the bundled agent notebook is not a Lakebase project spec"):
            setup.agent_lakebase(notebook(*[f'{n} = "v"' for n in setup.LAKEBASE_CONSTANTS]))

    def test_a_fresh_workspace_gets_the_project_and_the_catalog_bound_to_its_database_then_the_grant(self):
        api, calls = lakebase_api(project=((404, {}),), catalog=((404, {}), (200, BOUND)), endpoint=((404, {}), (200, {}), (200, HOSTED)))
        grants, _, _, said = self.grant([], listed=("main",), api=api)
        self.assertEqual(postgres_posts(calls), [
            ("POST", f"/api/2.0/postgres/projects?project_id={LAKEBASE['project']}", {"spec": LAKEBASE["project_spec"]}),
            ("POST", f"/api/2.0/postgres/catalogs?catalog_id={LAKEBASE['catalog']}",
             {"spec": {"branch": LAKEBASE["branch"], "postgres_database": LAKEBASE["database"]}})])
        self.assertEqual(grants, INSPIRE_GRANTS + [LAKEBASE_GRANT])
        self.assertIn(f"Lakebase for the Apps Implement builds: created the Lakebase project {LAKEBASE['project']} and created the catalog "
                      f"`{LAKEBASE['catalog']}` on it ✅", said)
        self.assertNotIn("LAKEBASE_NOTE", self.ctx)
        self.assertEqual(self.ctx["LAKEBASE_SUMMARY"],
                         f"Apps that Implement builds read Lakebase: project {LAKEBASE['project']}, catalog `{LAKEBASE['catalog']}` ✅")
        self.assertEqual([c[1] for c in calls if c[1] == ENDPOINT_PATH], [ENDPOINT_PATH] * 3, "the catalog waits for the endpoint")
        self.assertIn(("PATCH", PROJECT_GRANT_PATH, {"access_control_list": [{"service_principal_name": "SP", "permission_level": "CAN_MANAGE"}]}), calls)
        self.assertIn(f"CAN_MANAGE on Lakebase project {LAKEBASE['project']}, so the Apps Implement builds can read Lakebase: ✅", said)

    def test_a_reinstall_creates_nothing_and_grants_again(self):
        api, calls = lakebase_api(catalog=((200, {"status": BOUND["spec"]}),))
        grants, _, _, said = self.grant([], listed=("main",), api=api)
        self.assertEqual(postgres_posts(calls), [])
        self.assertEqual(grants, INSPIRE_GRANTS + [LAKEBASE_GRANT])
        self.assertIn(f"project {LAKEBASE['project']} and catalog `{LAKEBASE['catalog']}` are there ✅", said)
        self.assertNotIn(ENDPOINT_PATH, [c[1] for c in calls])

    def test_a_person_without_create_catalog_is_told_the_one_grant_and_the_install_completes_on_delta(self):
        api, calls = lakebase_api(make_catalog=REFUSED_CATALOG)
        grants, _, _, said = self.grant([], listed=("main",), api=api)
        self.assertEqual(grants, INSPIRE_GRANTS)
        note = self.ctx["LAKEBASE_NOTE"]
        self.assertIn(f"Databricks refused to create the catalog `{LAKEBASE['catalog']}` on the Lakebase project {LAKEBASE['project']} for you "
                      "(403 PERMISSION_DENIED: User does not have CREATE CATALOG on Metastore): "
                      "creating a catalog needs CREATE CATALOG on the metastore. A metastore admin can run GRANT CREATE CATALOG ON METASTORE "
                      "TO `someone@example.com`, then you run this installer again; until then the Apps that Implement builds read Delta tables",
                      note)
        self.assertIn(f"  ⚠️ {note}", said)
        self.assertEqual(self.ctx["LAKEBASE_SUMMARY"], f"⚠️ {note}")
        self.assertIn(f"Grants: {len(essentials(grants))} of {len(essentials(grants))} ran ✅", said)
        out = io.StringIO()
        ctx = dict(self.ctx, api_get=lambda path: {"url": APP_URL}, INSPIRE_DB="main._inspire", WAREHOUSE_NAME="wh", RELEASE_VERSION="v1.3.0")
        with contextlib.redirect_stdout(out), mock.patch.object(setup, "displayHTML", lambda html: None, create=True):
            setup.step_render_done(ctx)
        self.assertIn(f"  Lakebase:    ⚠️ {note}\n", out.getvalue())

    def test_every_other_lakebase_refusal_is_named_and_the_install_still_completes(self):
        cases = [
            (lakebase_api(project=((404, {}),), make_project=(403, {}, "PERMISSION_DENIED: no")),
             f"Databricks refused to create the Lakebase project {LAKEBASE['project']} for you (403 PERMISSION_DENIED: no)"),
            (lakebase_api(project=((403, {}, "PERMISSION_DENIED: no"),)),
             f"Databricks refused to read the Lakebase project {LAKEBASE['project']} for you (403 PERMISSION_DENIED: no)"),
            (lakebase_api(project=((200, {"delete_time": "2026-11-02T09:37:40Z"}),)),
             f"The Lakebase project {LAKEBASE['project']} was deleted and keeps its name until it is purged"),
            (lakebase_api(catalog=((403, {}, "PERMISSION_DENIED: no"),)),
             f"Databricks refused to read the catalog `{LAKEBASE['catalog']}` for you (403 PERMISSION_DENIED: no). Its owner can run "
             f"GRANT USE CATALOG ON CATALOG `{LAKEBASE['catalog']}` TO `someone@example.com`"),
            (lakebase_api(catalog=((200, {"spec": {"branch": "projects/other/branches/main", "postgres_database": "other"}}),)),
             f"The catalog `{LAKEBASE['catalog']}` holds another Lakebase database (projects/other/branches/main, other)"),
            (lakebase_api(make_catalog=(400, {}, "INVALID_PARAMETER_VALUE: catalog exists")),
             f"Databricks did not create the catalog `{LAKEBASE['catalog']}` (400 INVALID_PARAMETER_VALUE: catalog exists)"),
        ]
        for (api, _calls), needle in cases:
            ready, said = self.setup_only(api)
            self.assertFalse(ready, needle)
            self.assertIn(needle, said)
            self.assertTrue(said.endswith("until then the Apps that Implement builds read Delta tables"), said)
            grants, _, _, printed = self.grant([], listed=("main",), api=api)
            self.assertEqual(grants, INSPIRE_GRANTS, needle)
            self.assertIn(f"⚠️ {needle}", printed)
        ready, said = self.setup_only(None, lakebase=None)
        self.assertEqual((ready, said), (False, "Inspire knows no Lakebase project or catalog to set up: until then the Apps that Implement "
                                                "builds read Delta tables"))

    def test_a_full_catalog_quota_is_shown_whole_with_the_real_next_step_not_run_again(self):
        quota = ('{"error_code":"QUOTA_EXCEEDED","message":"Cannot create 1 Catalog(s) in Metastore 5a7903e7-8a04-4b13-987d-bfa7f6b5e906 '
                 '(estimated count: 1000, limit: 1000).","details":[{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"QUOTA",'
                 '"domain":"unity-catalog"}]}')
        api, _calls = lakebase_api(make_catalog=(400, {}, quota))
        ready, said = self.setup_only(api)
        self.assertFalse(ready)
        self.assertEqual(said, f"Databricks did not create the catalog `{LAKEBASE['catalog']}` (400 QUOTA_EXCEEDED: Cannot create 1 Catalog(s) in "
                               "Metastore 5a7903e7-8a04-4b13-987d-bfa7f6b5e906 (estimated count: 1000, limit: 1000).): the metastore already "
                               "holds as many catalogs as Databricks allows, so it creates no more: a metastore admin can drop the catalogs no "
                               "one uses, or ask Databricks support to raise the limit, then you run this installer again; until then the Apps "
                               "that Implement builds read Delta tables")
        self.assertNotIn("Run this installer again;", said, "running again alone cannot help while the metastore is full (must-exclude)")
        self.assertNotIn("details", said)
        long = '{"error_code":"INVALID_STATE","message":"' + "x" * 300 + ' end"}'
        api, _calls = lakebase_api(make_catalog=(400, {}, long))
        self.assertIn("x" * 300 + " end)", self.setup_only(api)[1], "a reason longer than 160 characters is no longer cut off")

    def test_an_endpoint_or_catalog_that_never_gets_ready_stops_after_the_polls_and_says_so(self):
        slept = []
        api, calls = lakebase_api(endpoint=((200, {}),))
        ready, said = self.setup_only(api, sleep=slept.append)
        self.assertFalse(ready)
        self.assertIn(f"The database endpoint of the Lakebase project {LAKEBASE['project']} was not ready after 15 minutes", said)
        self.assertEqual(len(slept), setup.LAKEBASE_POLLS - 1)
        self.assertEqual(postgres_posts(calls), [])
        slept.clear()
        api, calls = lakebase_api(catalog=((404, {}),))
        ready, said = self.setup_only(api, sleep=slept.append)
        self.assertFalse(ready)
        self.assertIn(f"The catalog `{LAKEBASE['catalog']}` was not ready after 15 minutes", said)
        self.assertEqual(len(postgres_posts(calls)), 1)

    def test_a_refused_grant_on_the_lakebase_catalog_is_named_in_the_summary(self):
        api, _calls = lakebase_api(catalog=((200, BOUND),))
        grants, _, _, said = self.grant([], listed=("main",), api=api, fail={LAKEBASE_GRANT: RuntimeError("PERMISSION_DENIED: not the owner")})
        self.assertIn(LAKEBASE_GRANT, grants)
        self.assertEqual(self.ctx["LAKEBASE_NOTE"],
                         f"SP cannot use the catalog `{LAKEBASE['catalog']}`, because {LAKEBASE_GRANT} failed (PERMISSION_DENIED: not the owner). "
                         "Its owner can run that grant, or run this installer again; until then the Apps that Implement builds read Delta tables")
        self.assertTrue(self.ctx["LAKEBASE_SUMMARY"].startswith("⚠️ SP cannot use the catalog"))

    def test_a_refused_can_manage_on_the_lakebase_project_is_named_in_the_summary_and_never_reads_as_done(self):
        api, _calls = lakebase_api(catalog=((200, BOUND),), project_grant=(403, {}, "PERMISSION_DENIED: no CAN_MANAGE"))
        grants, _, _, said = self.grant([], listed=("main",), api=api)
        note = (f"SP cannot use the Lakebase project {LAKEBASE['project']}, because Databricks refused to give it Can Manage on that project "
                "(PERMISSION_DENIED: no CAN_MANAGE). A workspace admin can give SP Can Manage on that project, or run this installer again; "
                "until then the Apps that Implement builds read Delta tables")
        self.assertIn(LAKEBASE_GRANT, grants)
        self.assertIn(f"  ⚠️ {note}", said)
        self.assertEqual(self.ctx["LAKEBASE_SUMMARY"], f"⚠️ {note}")
        self.assertNotIn("creates it ✅", said)
        api, _calls = lakebase_api(make_catalog=REFUSED_CATALOG, project_grant=(403, {}, "PERMISSION_DENIED: no CAN_MANAGE"))
        self.grant([], listed=("main",), api=api)
        self.assertIn("refused to create the catalog", self.ctx["LAKEBASE_SUMMARY"], "the first Lakebase problem stays the one the summary names")


APP_URL = "https://inspire-ai-1234.aws.databricksapps.com"


WANTED_YAML = 'env:\n  - name: "INSPIRE_DATABASE"\n    value: "main._inspire"\n  - name: "INSPIRE_WAREHOUSE_ID"\n    value: "wh"\n'
ZIP_YAML = 'env:\n  - name: "NODE_ENV"\n    value: "production"\n'


class DeployedSettingsTest(unittest.TestCase):
    def deploy(self, snapshots, defaults=None, polls_to_succeed=1, imported=(200, ""), artifacts=True):
        calls, deployed, polls = [], [], {"n": 0}
        defaults = list(defaults) if defaults is not None else None

        def api(method, path, body=None):
            calls.append((method, path, body))
            if method == "POST" and path == "/api/2.0/apps":
                return Resp(409, {}, "App already exists")
            if path == "/api/2.0/workspace/import":
                return Resp(imported[0], {}, imported[1])
            if method == "POST" and path == "/api/2.0/apps/inspire-ai/deployments":
                deployed.append(f"d{len(deployed) + 1}")
                polls["n"] = 0
                return Resp(200, {"deployment_id": deployed[-1]})
            if path.startswith("/api/2.0/workspace/export"):
                which = len(deployed) - 1
                text = snapshots[min(which, len(snapshots) - 1)]
                if text is None:
                    return Resp(403, {}, "PERMISSION_DENIED")
                return Resp(200, {"content": setup.base64.b64encode(text.encode()).decode()})
            return Resp(200, {})

        def api_get(path):
            if path == "/api/2.0/apps/inspire-ai":
                polls["n"] += 1
                done = deployed and polls["n"] >= polls_to_succeed
                state = {"deployment_id": deployed[-1] if deployed else "", "status": {"state": "SUCCEEDED" if done else "IN_PROGRESS"}}
                return {"url": APP_URL, "compute_status": {"state": "ACTIVE"}, "description": "Inspire AI v1.4.0",
                        "user_api_scopes": list(setup.INSPIRE_APP_OWN_SCOPES), "service_principal_client_id": "SPNEW",
                        "service_principal_name": "app-sp", **({"active_deployment": state} if done else {"pending_deployment": state})}
            if path.startswith("/api/2.0/apps/inspire-ai/deployments/"):
                deployment_id = path.rsplit("/", 1)[1]
                return {"deployment_artifacts": {"source_code_path": f"/Workspace/Users/sp/src/{deployment_id}"}} if artifacts else {}
            return {"Resources": [{"id": "1"}]}

        def app_defaults(url):
            self.assertEqual(url, APP_URL)
            return defaults.pop(0) if len(defaults) > 1 else defaults[0]

        saved, clock = setup.write_app_yaml_deploy, setup.time
        setup.write_app_yaml_deploy = lambda *a: WANTED_YAML
        setup.time = types.SimpleNamespace(sleep=lambda s: None)
        ctx = {"api": api, "api_get": api_get, "SOURCE_FOLDER": "/Workspace/Shared/inspire-ai/apps/inspire-ai/b", "INSPIRE_DB": "main._inspire",
               "WAREHOUSE_ID": "wh", "NOTEBOOK_PATH": "/Shared/inspire-ai/dbx_inspire_ai_agent", "SP_NAME": "inspire-ai-sp",
               "APP_NAME": "inspire-ai", "CATALOG": "main", "RELEASE_VERSION": "v1.4.0"}
        if defaults is not None:
            ctx["app_defaults"] = app_defaults
        out, error = io.StringIO(), None
        try:
            with contextlib.redirect_stdout(out):
                setup.step_deploy_and_find_sp(ctx)
        except RuntimeError as exc:
            error = str(exc)
        finally:
            setup.write_app_yaml_deploy, setup.time = saved, clock
        return calls, deployed, out.getvalue(), error

    def test_compute_that_never_gets_active_is_named_with_the_state_it_stayed_in(self):
        for stays, started in (("STOPPED", True), ("ERROR", False), ("STARTING", False)):
            asked = []

            def api(method, path, body=None):
                asked.append((method, path))
                return Resp(409, {}, "App already exists") if path == "/api/2.0/apps" else Resp(200, {})

            def api_get(path):
                return {"compute_status": {"state": stays}, "description": setup.app_description("v1.4.0"),
                        "user_api_scopes": list(setup.INSPIRE_APP_OWN_SCOPES)} if path == "/api/2.0/apps/inspire-ai" else {"Resources": []}

            saved, clock = setup.write_app_yaml_deploy, setup.time
            setup.write_app_yaml_deploy = lambda *a: WANTED_YAML
            setup.time = types.SimpleNamespace(sleep=lambda s: None)
            ctx = {"api": api, "api_get": api_get, "SOURCE_FOLDER": "/Workspace/Shared/inspire-ai/apps/inspire-ai/b", "INSPIRE_DB": "main._inspire",
                   "WAREHOUSE_ID": "wh", "NOTEBOOK_PATH": "/n", "SP_NAME": "inspire-ai-sp", "APP_NAME": "inspire-ai", "CATALOG": "main",
                   "RELEASE_VERSION": "v1.4.0"}
            try:
                with self.assertRaises(RuntimeError) as caught, contextlib.redirect_stdout(io.StringIO()):
                    setup.step_deploy_and_find_sp(ctx)
            finally:
                setup.write_app_yaml_deploy, setup.time = saved, clock
            message = str(caught.exception)
            self.assertIn(f"did not reach ACTIVE after 5 minutes (still {stays}", message, stays)
            self.assertEqual("after the installer asked it to start" in message, started, stays)
            self.assertEqual(("POST", "/api/2.0/apps/inspire-ai/start") in asked, started, stays)
            if stays != "STARTING":
                self.assertNotIn("STARTING", message, stays)

    def test_a_deployment_that_copied_the_old_app_yaml_is_deployed_again_with_the_settings(self):
        calls, deployed, said, error = self.deploy([ZIP_YAML, WANTED_YAML], defaults=[(200, {"envSkipsSetupWizard": True})])
        self.assertIsNone(error)
        self.assertEqual(deployed, ["d1", "d2"])
        self.assertIn("Deploy 1 of 3: the App started from an app.yaml without the warehouse and database this installer wrote. Deploying again.", said)
        self.assertIn("App settings: ✅ the App reports its warehouse and database, so it opens past the setup wizard", said)
        imports = [body for method, path, body in calls if path == "/api/2.0/workspace/import"]
        self.assertEqual(len(imports), 2, "app.yaml is saved through the workspace before every deploy")

    def test_the_app_yaml_is_saved_through_the_workspace_before_the_deploy_copies_it(self):
        calls, _, _, error = self.deploy([WANTED_YAML], defaults=[(200, {"envSkipsSetupWizard": True})])
        self.assertIsNone(error)
        order = [path for method, path, body in calls if path in ("/api/2.0/workspace/import", "/api/2.0/apps/inspire-ai/deployments")]
        self.assertEqual(order, ["/api/2.0/workspace/import", "/api/2.0/apps/inspire-ai/deployments"])
        body = [b for m, p, b in calls if p == "/api/2.0/workspace/import"][0]
        self.assertEqual(body["path"], "/Shared/inspire-ai/apps/inspire-ai/b/app.yaml")
        self.assertTrue(body["overwrite"])
        self.assertEqual(setup.base64.b64decode(body["content"]).decode(), WANTED_YAML)
        exported = [p for m, p, b in calls if p.startswith("/api/2.0/workspace/export")]
        self.assertEqual(exported, ["/api/2.0/workspace/export?path=/Users/sp/src/d1/app.yaml&format=AUTO"])

    def test_an_app_that_never_gets_its_settings_fails_plainly_and_never_says_deployed(self):
        _, deployed, said, error = self.deploy([ZIP_YAML], defaults=[(200, {"envSkipsSetupWizard": True})])
        self.assertEqual(deployed, ["d1", "d2", "d3"])
        self.assertIn("Deployed 3 times, and each time the App started from an app.yaml without the warehouse and database", error)
        self.assertNotIn("Deployed ✅", said)

    def test_an_app_that_says_the_wizard_is_not_skipped_is_deployed_again(self):
        _, deployed, said, error = self.deploy([WANTED_YAML], defaults=[(200, {"envSkipsSetupWizard": False}),
                                                                       (200, {"envSkipsSetupWizard": True})])
        self.assertIsNone(error)
        self.assertEqual(deployed, ["d1", "d2"])
        self.assertIn("Deploy 1 of 3: the App says it has no warehouse or database, so it would open on the workspace connection wizard.", said)
        self.assertIn("Deployed ✅", said)

    def test_an_app_that_keeps_showing_the_wizard_fails_the_install(self):
        _, deployed, said, error = self.deploy([WANTED_YAML], defaults=[(200, {"envSkipsSetupWizard": False})])
        self.assertEqual(len(deployed), 3)
        self.assertIn("each time the App says it has no warehouse or database", error)
        self.assertNotIn("Deployed ✅", said)
        for not_true in ({}, {"envSkipsSetupWizard": "true"}, {"envSkipsSetupWizard": None}):
            self.assertIn("each time the App says", self.deploy([WANTED_YAML], defaults=[(200, not_true)])[3])

    def test_an_app_that_cannot_be_asked_rests_on_the_deployed_app_yaml(self):
        for answer in ((302, None), (401, {"error": "unauthorized"}), (502, None)):
            _, deployed, said, error = self.deploy([WANTED_YAML], defaults=[answer])
            self.assertIsNone(error)
            self.assertEqual(deployed, ["d1"])
            self.assertIn("App settings: ✅ the deployed app.yaml holds the warehouse and database", said)
        _, _, said, error = self.deploy([WANTED_YAML])
        self.assertIsNone(error)
        self.assertIn("App settings: ✅ the deployed app.yaml holds the warehouse and database", said)

    def test_settings_that_cannot_be_checked_either_way_are_said_plainly(self):
        _, deployed, said, error = self.deploy([None], defaults=[(302, None)])
        self.assertIsNone(error)
        self.assertEqual(deployed, ["d1"])
        self.assertIn("⚠️ Could not confirm the App's settings: its app.yaml could not be read (403 PERMISSION_DENIED), and the App "
                      "answered 302. Open the App: if it asks for a workspace connection, run the installer again.", said)
        self.assertIn("the deployment names no copy of its files", self.deploy([WANTED_YAML], defaults=[(302, None)], artifacts=False)[2])

    def test_an_unreadable_snapshot_still_fails_when_the_app_shows_the_wizard(self):
        _, deployed, _, error = self.deploy([None], defaults=[(200, {"envSkipsSetupWizard": False})])
        self.assertEqual(len(deployed), 3)
        self.assertIn("the App says it has no warehouse or database", error)

    def test_a_deployment_that_never_finishes_fails_instead_of_saying_deployed(self):
        _, deployed, said, error = self.deploy([WANTED_YAML], defaults=[(200, {"envSkipsSetupWizard": True})], polls_to_succeed=99)
        self.assertEqual(deployed, ["d1"])
        self.assertIn("The App inspire-ai was still deploying after 5 minutes", error)
        self.assertNotIn("Deployed ✅", said)

    def test_a_refused_app_yaml_save_stops_before_any_deploy(self):
        _, deployed, _, error = self.deploy([WANTED_YAML], defaults=[(200, {"envSkipsSetupWizard": True})], imported=(403, "PERMISSION_DENIED"))
        self.assertEqual(deployed, [])
        self.assertIn("Could not save /Workspace/Shared/inspire-ai/apps/inspire-ai/b/app.yaml in the workspace (403 PERMISSION_DENIED)", error)


class AppUrlTest(unittest.TestCase):
    def deploy(self, exists=False, described="Inspire AI v1.3.0", update=(200, "SUCCEEDED"), calls=None):
        scopes = list(setup.INSPIRE_APP_OWN_SCOPES)
        states = [{"url": "Unavailable", "compute_status": {"state": "STARTING"}, "user_api_scopes": scopes, "description": described},
                  {"url": "Unavailable", "compute_status": {"state": "ACTIVE"}, "user_api_scopes": scopes},
                  {"url": APP_URL, "compute_status": {"state": "ACTIVE"}, "user_api_scopes": scopes, "service_principal_client_id": "SPNEW",
                   "service_principal_name": "app-sp", "active_deployment": {"deployment_id": "d1", "status": {"state": "SUCCEEDED"}}}]
        calls = [] if calls is None else calls

        def api(method, path, body=None):
            calls.append((method, path, body))
            if method == "POST" and path == "/api/2.0/apps":
                return Resp(409, {}, "App already exists") if exists else Resp(200, {"name": "inspire-ai", "url": "Unavailable"})
            if path == "/api/2.0/apps/inspire-ai/update":
                return Resp(update[0], {}, "PERMISSION_DENIED: not a manager of the App" if update[0] >= 400 else "")
            return Resp(200, {"deployment_id": "d1"})

        def api_get(path):
            if path == "/api/2.0/apps/inspire-ai":
                return states.pop(0) if len(states) > 1 else states[0]
            if path == "/api/2.0/apps/inspire-ai/update":
                return {"status": {"state": update[1], "message": "the App is being deleted"}}
            return {"Resources": [{"id": "1"}]}

        saved, clock = setup.write_app_yaml_deploy, setup.time
        setup.write_app_yaml_deploy = lambda *a: "env: wanted\n"
        setup.time = types.SimpleNamespace(sleep=lambda s: None)
        ctx = {"api": api, "api_get": api_get, "SOURCE_FOLDER": "/Workspace/b", "INSPIRE_DB": "main._inspire", "WAREHOUSE_ID": "wh",
               "NOTEBOOK_PATH": "/Shared/inspire-ai/dbx_inspire_ai_agent", "SP_NAME": "inspire-ai-sp", "APP_NAME": "inspire-ai",
               "CATALOG": "main", "RELEASE_VERSION": "v1.3.1"}
        out = io.StringIO()
        try:
            with contextlib.redirect_stdout(out):
                setup.step_deploy_and_find_sp(ctx)
        finally:
            setup.write_app_yaml_deploy, setup.time = saved, clock
        return ctx, out.getvalue()

    def test_a_new_app_is_described_with_the_release_it_installs(self):
        calls = []
        self.deploy(exists=False, calls=calls)
        created = [body for method, path, body in calls if (method, path) == ("POST", "/api/2.0/apps")]
        self.assertEqual(created[0]["description"], "Inspire AI v1.3.1")
        self.assertFalse([c for c in calls if c[1].endswith("/update")], "a new App needs no update")

    def test_an_app_installed_by_an_older_release_takes_the_new_description(self):
        calls = []
        _, said = self.deploy(exists=True, calls=calls)
        updates = [body for method, path, body in calls if (method, path) == ("POST", "/api/2.0/apps/inspire-ai/update")]
        self.assertEqual(updates, [{"update_mask": "description", "app": {"description": "Inspire AI v1.3.1", "name": "inspire-ai"}}])
        self.assertIn("App description: ✅ Inspire AI v1.3.1", said)

    def test_an_app_already_on_this_release_is_not_updated(self):
        calls = []
        _, said = self.deploy(exists=True, described="Inspire AI v1.3.1", calls=calls)
        self.assertFalse([c for c in calls if c[1].endswith("/update")])
        self.assertIn("App description: ✅ Inspire AI v1.3.1", said)

    def test_a_refused_description_change_is_said_with_the_reason(self):
        for update, why in (((403, ""), "403 PERMISSION_DENIED: not a manager of the App"), ((200, "FAILED"), "the App is being deleted")):
            _, said = self.deploy(exists=True, update=update)
            self.assertIn(f"⚠️ The App still describes itself as 'Inspire AI v1.3.0' instead of 'Inspire AI v1.3.1', because Databricks "
                          f"refused to change its description: {why}.", said)
            self.assertNotIn("App description: ✅", said)

    def test_the_description_names_the_release_version_only(self):
        self.assertEqual(setup.app_description("v1.3.1"), "Inspire AI v1.3.1")

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

    def context(self, env, widgets=None, warehouses=None, catalogs=("main", "sales"), owners=None):
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
            catalogs = types.SimpleNamespace(list=lambda: [types.SimpleNamespace(name=name, owner=(owners or {}).get(name, "data-owners"))
                                                           for name in catalogs])
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
        self.assertIn("No catalog you can use is named &#x27;sale&#x27;. Did you mean &#x27;sales&#x27;? Pick one from the list in "
                      "01_inspire_catalog, or type its exact name.", self.banner())
        self.assertNotIn("SQL warehouse you can use", self.banner())
        widgets.pick("01_inspire_catalog", "nothing_like_it")
        self.assertEqual(self.run_with(widgets), {"ready": False})
        self.assertIn("No catalog you can use is named &#x27;nothing_like_it&#x27;. Pick one from the list", self.banner())

    @staticmethod
    def many(count):
        return tuple(f"cat_{index:04d}" for index in range(count))

    def test_a_catalog_list_never_holds_more_choices_than_a_notebook_widget_allows(self):
        for count, shown, hidden_words in ((1, ["cat_0000"], False), (1022, list(self.many(1022)), False),
                                           (1023, list(self.many(1022)), True), (1024, list(self.many(1022)), True),
                                           (1025, list(self.many(1022)), True), (3588, list(self.many(1022)), True)):
            widgets = support.FakeWidgets()
            printed = io.StringIO()
            with contextlib.redirect_stdout(printed):
                ctx = self.run_with(widgets, catalogs=self.many(count))
            self.assertEqual(ctx, {"ready": False}, count)
            choices = widgets.state["01_inspire_catalog"]["choices"]
            self.assertLessEqual(len(choices), 1023, count)
            self.assertEqual(choices, ["Pick from the list or type"] + shown, count)
        widgets = support.FakeWidgets()
        setup.dbutils = types.SimpleNamespace(widgets=widgets)
        with contextlib.redirect_stdout(printed := io.StringIO()):
            setup.ensure_parameter_widgets([self.warehouse()], list(self.many(3588)))
        self.assertIn("01_inspire_catalog lists 1022 of the 3588 catalogs you can use, the most likely first, because a notebook list "
                      "holds at most 1023 entries. Type the exact name of any other one.", printed.getvalue())
        with contextlib.redirect_stdout(printed := io.StringIO()):
            setup.ensure_parameter_widgets([self.warehouse()], list(self.many(1022)))
        self.assertNotIn("lists 1022 of", printed.getvalue())

    def test_a_catalog_listing_that_fails_part_way_stops_with_its_reason_and_never_claims_the_typed_catalog_is_missing(self):
        def listing():
            yield types.SimpleNamespace(name="main", owner="data-owners")
            raise RuntimeError("PERMISSION_DENIED: page 2 of the catalogs could not be read")

        widgets = support.FakeWidgets({"00_sql_warehouse": {"kind": "combobox", "value": "Shared (wh1)"},
                                       "01_inspire_catalog": {"kind": "combobox", "value": "main"}})
        setup.dbutils = types.SimpleNamespace(widgets=widgets)
        saved = setup.WorkspaceClient
        try:
            self.context(dict(self.ENV), widgets)
            client = setup.WorkspaceClient
            client.catalogs = types.SimpleNamespace(list=listing)
            setup.WorkspaceClient = lambda: client
            with self.assertRaises(RuntimeError) as caught, contextlib.redirect_stdout(io.StringIO()):
                setup.build_runtime_context(dict(self.ENV))
        finally:
            setup.WorkspaceClient = saved
        message = str(caught.exception)
        self.assertIn("could not list the catalogs you can use (PERMISSION_DENIED: page 2 of the catalogs could not be read), after 1 of them", message)
        self.assertIn("changed nothing", message)
        self.assertNotIn("No catalog you can use is named", message + self.banner())
        self.assertNotIn("workspace", message.replace("this workspace", ""))

    def test_no_catalog_and_no_warehouse_you_can_use_stop_with_who_can_fix_it(self):
        with self.assertRaises(RuntimeError) as caught:
            self.run_with(support.FakeWidgets(), catalogs=())
        self.assertIn("You cannot use any catalog in this workspace", str(caught.exception))
        self.assertIn("give someone@example.com USE CATALOG and CREATE SCHEMA on a catalog", str(caught.exception))
        saved = setup.WorkspaceClient
        try:
            self.context(dict(self.ENV), support.FakeWidgets())
            client = setup.WorkspaceClient
            client.warehouses = types.SimpleNamespace(list=lambda: [])
            setup.WorkspaceClient = lambda: client
            with self.assertRaises(RuntimeError) as caught, contextlib.redirect_stdout(io.StringIO()):
                setup.build_runtime_context(dict(self.ENV))
        finally:
            setup.WorkspaceClient = saved
        self.assertIn("You cannot use any SQL warehouse in this workspace", str(caught.exception))
        self.assertIn("give someone@example.com Can Use on a SQL warehouse, or create one", str(caught.exception))
        self.assertNotIn("No SQL warehouses found", str(caught.exception))

    def test_a_capped_catalog_list_puts_your_own_catalogs_and_your_pick_first(self):
        names = self.many(3588)
        owners = {"cat_3000": "someone@example.com", "cat_2000": "SOMEONE@example.com"}
        widgets = support.FakeWidgets()
        self.run_with(widgets, catalogs=names, owners=owners)
        choices = widgets.state["01_inspire_catalog"]["choices"]
        self.assertEqual(choices[:4], ["Pick from the list or type", "cat_2000", "cat_3000", "cat_0000"])
        self.assertEqual(len(choices), 1023)
        self.assertEqual(len(set(choices)), 1023)
        shown, hidden = setup.picker_choices(names, picked="cat_3587", first=["cat_2000"])
        self.assertEqual((shown[:3], len(shown), hidden), (["Pick from the list or type", "cat_3587", "cat_2000"], 1023, 2566))
        self.assertEqual(setup.picker_choices(["a", "b"], picked="zz", first=["yy"]), (["Pick from the list or type", "a", "b"], 0))

    def test_a_catalog_typed_by_hand_outside_the_capped_list_installs_and_a_typo_is_named(self):
        names = self.many(3588)
        widgets = support.FakeWidgets()
        self.run_with(widgets, catalogs=names)
        self.assertNotIn("cat_3587", widgets.state["01_inspire_catalog"]["choices"])
        widgets.pick("00_sql_warehouse", "Shared (wh1)")
        widgets.pick("01_inspire_catalog", "CAT_3587")
        ctx = self.run_with(widgets, catalogs=names)
        self.assertEqual((ctx.get("CATALOG"), ctx.get("INSPIRE_DB")), ("cat_3587", "cat_3587._inspire"))
        widgets.pick("01_inspire_catalog", "cat_35877")
        self.assertEqual(self.run_with(widgets, catalogs=names), {"ready": False})
        self.assertIn("No catalog you can use is named &#x27;cat_35877&#x27;. Did you mean &#x27;cat_3587&#x27;", self.banner())

    def test_a_warehouse_list_over_the_widget_limit_is_capped_and_a_typed_hidden_warehouse_is_used(self):
        listed = [self.warehouse(f"wh{index:04d}", f"Warehouse {index:04d}", "STOPPED") for index in range(1500)]
        listed.append(self.warehouse("live", "Live", "RUNNING"))
        widgets = support.FakeWidgets()
        self.run_with(widgets, warehouses=listed)
        choices = widgets.state["00_sql_warehouse"]["choices"]
        self.assertEqual((len(choices), choices[1]), (1023, "Live (live)"))
        self.assertNotIn("Warehouse 1499 (wh1499)", choices)
        widgets.pick("00_sql_warehouse", "wh1499")
        widgets.pick("01_inspire_catalog", "main")
        ctx = self.run_with(widgets, warehouses=listed)
        self.assertEqual(ctx.get("WAREHOUSE_ID"), "wh1499")

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


class GenieCodeInstallCheckTest(unittest.TestCase):
    TEXT = AGENT_NOTEBOOK.read_text(encoding="utf-8")
    K = setup.agent_constants(TEXT, setup.GENIE_CODE_CONSTANTS)

    def gateway(self, codex=(200, ""), claude_models=(), claude=(200, ""), raises=None, codex_models=(), codex_by_model=None):
        calls = []

        def api(method, path, body=None, timeout=None):
            calls.append((method, path, (body or {}).get("model"), timeout))
            if raises:
                raise raises
            if path == f"{self.K['UNITY_GATEWAY_ANTHROPIC_PATH']}/models":
                return Resp(200, {"data": [{"id": m} for m in claude_models]})
            if path == f"{self.K['UNITY_GATEWAY_CODEX_PATH']}/models":
                return Resp(200, {"models": [{"slug": m} for m in codex_models]})
            if path == f"{self.K['UNITY_GATEWAY_CODEX_PATH']}/responses":
                got = (codex_by_model or {}).get((body or {}).get("model"), codex)
                return Resp(got[0], text=got[1])
            if path == f"{self.K['UNITY_GATEWAY_MLFLOW_PATH']}/responses":
                return Resp(claude[0], text=claude[1])
            return Resp(404)
        return api, calls

    def check(self, api):
        return setup.genie_code_install_check(api, self.TEXT, "someone@example.com")

    def test_the_codex_route_answers_and_the_installer_says_mvps_can_be_built(self):
        api, calls = self.gateway()
        said = self.check(api)
        self.assertTrue(said.startswith("✅"), said)
        self.assertIn(self.K["GENIE_CODE_MODEL"], said)
        self.assertIn("someone@example.com", said)
        self.assertTrue(all(c[3] == setup.GENIE_CODE_CHECK_TIMEOUT_S for c in calls))
        probe = [c for c in calls if c[0] == "POST"]
        self.assertEqual(probe, [("POST", f"{self.K['UNITY_GATEWAY_CODEX_PATH']}/responses", self.K["GENIE_CODE_MODEL"], 10)])

    def test_codex_refused_falls_back_to_the_listed_claude_model_on_the_anthropic_route(self):
        api, calls = self.gateway(codex=(404, "model not found"), claude_models=("gpt-x", "claude-sonnet-4-6", "claude-haiku-3"))
        said = self.check(api)
        self.assertTrue(said.startswith("✅"), said)
        self.assertIn("claude-sonnet-4-6 through the Anthropic route", said)
        self.assertNotIn("claude-haiku-3", [c[2] for c in calls])

    def test_no_route_names_both_refusals_notebook_only_and_the_admin_fix_without_a_ticket(self):
        api, _ = self.gateway(codex=(403, "denied"), claude_models=("claude-opus-4-7",), claude=(404, "not found"))
        said = self.check(api)
        self.assertTrue(said.startswith("⚠️"), said)
        self.assertIn("403 denied", said)
        self.assertIn("claude-opus-4-7 through the Anthropic route: 404", said)
        self.assertIn("I will build it myself", said)
        self.assertIn(self.K["GENIE_CODE_ADMIN_FIX"], said)
        self.assertNotRegex(said.lower(), r"contact|ticket|support")

    def test_codex_refusing_its_first_model_tries_the_models_the_codex_route_lists(self):
        first = self.K["GENIE_CODE_MODEL"]
        api, calls = self.gateway(codex_models=(first, "gpt-oss-120b", "gpt-9-codex"),
                                  codex_by_model={first: (404, "model not found"), "gpt-9-codex": (200, "")})
        said = self.check(api)
        self.assertTrue(said.startswith("✅"), said)
        self.assertIn("gpt-9-codex through the Codex route", said)
        probed = [c[2] for c in calls if c[0] == "POST"]
        self.assertEqual(probed, [first, "gpt-9-codex"])

    def test_a_busy_or_silent_gateway_is_not_a_verdict(self):
        api, _ = self.gateway(codex=(503, "busy"))
        self.assertIn("not checked", self.check(api))
        api, _ = self.gateway(raises=setup.requests.exceptions.ConnectTimeout("slow"))
        self.assertIn("not checked", self.check(api))

    def test_a_notebook_without_the_constants_is_reported_not_raised(self):
        api, calls = self.gateway()
        said = setup.genie_code_install_check(api, json.dumps({"cells": []}), "someone@example.com")
        self.assertIn("not checked", said)
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
