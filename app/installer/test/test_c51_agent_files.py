"""c51 (REQ-586): the installer publishes the split agent (two thin notebooks plus inspire_lib.py) instead of one notebook.

Fail-first acceptance tests T-NB2-04 (installer) and T-NB2-05 (release); T-NB2-06 (App publish) is backend/test/c51AgentPublish.test.js. The real split files are not on the base, so every
test builds small stand-ins in a temp folder: inspire_discover.ipynb and inspire_generate.ipynb each bind
INSPIRE_LIB_SHA256 = "<sha256 of inspire_lib.py>" in a code cell, and inspire_lib.py carries the agent constants
(__AGENT_VERSION__, INSPIRE_NOTEBOOK_ASSETS with the result_history pin, IMPLEMENT_LAKEBASE_*). The builder never edits this file.
"""
import base64
import contextlib
import hashlib
import importlib.util
import io
import json
import pathlib
import re
import tempfile
import unittest
import zipfile

import support

setup = support.load_setup()
release = support.release

APP_FOLDER = "/Shared/inspire-ai"
NOTEBOOKS = ("inspire_discover", "inspire_generate")
LIB = "inspire_lib.py"
LEGACY = "dbx_inspire_ai_agent"
EMBED = pathlib.Path(support.INSTALLER_DIR).parent / "agent" / "agent" / "app_shell" / "embed.py"
HISTORY = ("notebook/result_history.txt", b"def inspire_widget(name):\n    return name\n" * 20)
SHELL = support.NOTEBOOK_ASSET
LAKEBASE = {"project": "inspire-c51", "project_spec": {"default_endpoint_settings": {"autoscaling_limit_max_cu": 1}},
            "branch": "projects/inspire-c51/branches/production", "endpoint": "projects/inspire-c51/branches/production/endpoints/primary",
            "database": "databricks_postgres", "catalog": "inspire_c51_lakebase"}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def asset_pins():
    return {"app_shell": {"file": SHELL[0], "repo": "agent/app_shell/app_shell.b64", "sha256": sha(SHELL[1]), "size": len(SHELL[1])},
            "result_history": {"file": HISTORY[0], "repo": "agent/app_shell/result_history.txt", "sha256": sha(HISTORY[1]),
                               "size": len(HISTORY[1])}}


def lib_source(version=support.VERSION):
    return "".join([
        "# inspire_lib: stand-in for the c51 tests\n",
        f'__AGENT_VERSION__ = "{version}"\n',
        f"INSPIRE_NOTEBOOK_ASSETS = {json.dumps(asset_pins(), sort_keys=True)}\n",
        f'IMPLEMENT_LAKEBASE_PROJECT = "{LAKEBASE["project"]}"\n',
        f"IMPLEMENT_LAKEBASE_PROJECT_SPEC = {json.dumps(LAKEBASE['project_spec'])}\n",
        'IMPLEMENT_LAKEBASE_BRANCH = f"projects/{IMPLEMENT_LAKEBASE_PROJECT}/branches/production"\n',
        'IMPLEMENT_LAKEBASE_ENDPOINT = f"{IMPLEMENT_LAKEBASE_BRANCH}/endpoints/primary"\n',
        f'IMPLEMENT_LAKEBASE_DATABASE = "{LAKEBASE["database"]}"\n',
        f'IMPLEMENT_LAKEBASE_CATALOG = "{LAKEBASE["catalog"]}"\n',
        "def run(operation):\n    return operation\n",
    ]).encode("utf-8")


def thin_notebook(pin, operation):
    cells = [{"cell_type": "markdown", "metadata": {}, "source": [f"# {operation}"]},
             {"cell_type": "code", "metadata": {}, "outputs": [], "execution_count": None,
              "source": [f'INSPIRE_LIB_SHA256 = "{pin}"\n', "import os\n", "LIB = os.path.join(os.getcwd(), 'inspire_lib.py')\n"]},
             {"cell_type": "code", "metadata": {}, "outputs": [], "execution_count": None,
              "source": ["if __name__ == '__main__':\n", f"    print({operation!r})\n"]}]
    return json.dumps({"cells": cells, "metadata": {}, "nbformat": 4, "nbformat_minor": 5}).encode("utf-8")


def agent_files(lib=None, pins=None):
    lib = lib_source() if lib is None else lib
    pins = pins or (sha(lib), sha(lib))
    return {"inspire_discover.ipynb": thin_notebook(pins[0], "Discover Use Cases"),
            "inspire_generate.ipynb": thin_notebook(pins[1], "Implement Use Cases"), LIB: lib}


def notebook_pin(data):
    code = "".join("".join(c.get("source") or []) for c in json.loads(data)["cells"] if c.get("cell_type") == "code")
    return re.findall(r'^INSPIRE_LIB_SHA256 = "([0-9a-f]{64})"$', code, re.M)


class Resp:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code, self.payload, self.text = status_code, payload or {}, text

    def json(self):
        return self.payload


class Workspace:
    pass


def run_step(files):
    """Run step_schema_and_notebooks on a source folder holding `files`; returns (imports, calls, ctx, error, printed)."""
    calls = []

    def api(method, path, body=None, **kw):
        calls.append((method, path, body))
        if "/workspace/export" in path:
            return Resp(404, {"error_code": "RESOURCE_DOES_NOT_EXIST"})
        if "/workspace/get-status" in path:
            return Resp(200, {"object_type": "NOTEBOOK"})
        return Resp(200, {})

    with tempfile.TemporaryDirectory() as tmp:
        for name, data in files.items():
            (pathlib.Path(tmp) / name).write_bytes(data)
        ctx = {"w": Workspace(), "WAREHOUSE_ID": None, "CATALOG": "main", "SCHEMA": "_inspire", "SOURCE_FOLDER": tmp,
               "APP_NAME": "inspire-ai", "APP_FOLDER": APP_FOLDER, "ASSETS_PARENT": "/Workspace/Shared/inspire-ai/assets",
               "SCHEMA_MODE": False, "USER_EMAIL": "someone@example.com", "api": api}
        error = None
        with contextlib.redirect_stdout(io.StringIO()) as out:
            try:
                setup.step_schema_and_notebooks(ctx)
            except Exception as exc:  # the refusals below assert on it
                error = exc
    imports = {body["path"]: body for method, path, body in calls if path == "/api/2.0/workspace/import" and isinstance(body, dict)}
    return imports, calls, ctx, error, out.getvalue()


def make_zip(path, files):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("app.yaml", b"command: []\n")
        archive.writestr("installer/inspire_setup.py", support.FAKE_MODULE.encode("utf-8"))
        for name, data in files.items():
            archive.writestr(name, data)


class InstallerPublishesTheSplitAgent(unittest.TestCase):
    """T-NB2-04: the installer uploads the three agent files into one workspace folder, each checked against its pin."""

    def test_the_two_notebooks_and_the_lib_land_in_the_app_folder_with_the_bytes_that_were_pinned(self):
        files = agent_files()
        imports, calls, ctx, error, printed = run_step(files)
        self.assertIsNone(error, f"the install step failed on the split agent: {error!r}\n{printed[-800:]}")
        agent = {p: b for p, b in imports.items() if not p.endswith("dbx_generate_demo_data")}
        self.assertEqual(sorted(agent), sorted([f"{APP_FOLDER}/{n}" for n in NOTEBOOKS] + [f"{APP_FOLDER}/{LIB}"]),
                         "exactly the two notebooks and the lib are published, all in the App folder")
        for name in NOTEBOOKS:
            body = agent[f"{APP_FOLDER}/{name}"]
            self.assertEqual(body.get("format"), "JUPYTER", name)
            self.assertEqual(sha(base64.b64decode(body["content"])), sha(files[f"{name}.ipynb"]), f"{name} is uploaded byte for byte")
        lib = agent[f"{APP_FOLDER}/{LIB}"]
        self.assertIn(lib.get("format"), ("AUTO", "RAW"), "the lib is imported as a workspace file, not as a notebook")
        self.assertEqual(sha(base64.b64decode(lib["content"])), sha(files[LIB]), "the lib is uploaded byte for byte")
        for name in NOTEBOOKS:
            self.assertEqual(notebook_pin(files[f"{name}.ipynb"]), [sha(base64.b64decode(lib["content"]))],
                             f"{name}'s INSPIRE_LIB_SHA256 is the sha256 of the uploaded lib")
        self.assertEqual(ctx.get("NOTEBOOK_PATH"), f"{APP_FOLDER}/inspire_discover",
                         "NOTEBOOK_PATH names a notebook in the folder the App launches both notebooks from")

    def test_no_upload_or_launch_path_names_the_single_notebook(self):
        imports, calls, ctx, error, printed = run_step(agent_files())
        self.assertIsNone(error, f"{error!r}\n{printed[-800:]}")
        self.assertEqual([p for m, p, b in calls if LEGACY in p or LEGACY in json.dumps(b or {})], [],
                         "no workspace call names dbx_inspire_ai_agent")
        self.assertNotIn(LEGACY, str(ctx.get("NOTEBOOK_PATH")) + str(ctx.get("NOTEBOOK_DEST")))
        for source in (pathlib.Path(setup.__file__), pathlib.Path(release.__file__), pathlib.Path(support.INSTALLER_DIR).parents[1] / "inspire_installer.py"):
            code = [line for line in source.read_text(encoding="utf-8").splitlines() if not line.lstrip().startswith("#")]
            self.assertEqual([line.strip()[:120] for line in code if LEGACY in line], [], f"{source.name} still names {LEGACY}")

    def test_a_lib_that_does_not_match_the_notebooks_pin_is_refused_before_any_agent_upload(self):
        lib = lib_source()
        files = agent_files(lib=lib, pins=(sha(lib), sha(lib)))
        files[LIB] = lib + b"# tampered\n"
        imports, calls, ctx, error, printed = run_step(files)
        self.assertIsNotNone(error, "the installer published a lib whose sha256 is not the one the notebooks pin")
        self.assertRegex(str(error), r"(?i)sha-?256|INSPIRE_LIB_SHA256", "the refusal says the lib does not match its pin")
        self.assertEqual([p for p in imports if p.rsplit("/", 1)[-1] in NOTEBOOKS + (LIB,)], [], "nothing of the agent was uploaded")

    def test_notebooks_that_pin_two_different_libs_are_refused(self):
        lib = lib_source()
        imports, calls, ctx, error, printed = run_step(agent_files(lib=lib, pins=(sha(lib), "0" * 64)))
        self.assertIsNotNone(error, "the installer published notebooks that pin different libs")
        self.assertRegex(str(error), r"INSPIRE_LIB_SHA256", "the refusal names the pin, not a missing file")
        self.assertEqual([p for p in imports if p.rsplit("/", 1)[-1] in NOTEBOOKS + (LIB,)], [])

    def test_the_installer_reads_the_agent_constants_from_the_split_files(self):
        imports, calls, ctx, error, printed = run_step(agent_files())
        self.assertIsNone(error, f"{error!r}\n{printed[-800:]}")
        self.assertEqual(ctx.get("LAKEBASE"), LAKEBASE, "the Lakebase definition is read from the agent source the lib carries")


class ReleasePinsTheSplitAgent(unittest.TestCase):
    """T-NB2-05: the release zip carries the three agent files, its manifest pins each, and the lib pin is checked."""

    def zip_with(self, files):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        path = pathlib.Path(tmp.name) / "inspire-app.zip"
        make_zip(path, files)
        return zipfile.ZipFile(path)

    def test_version_and_asset_pins_are_read_from_the_split_agent_and_result_history_is_pinned(self):
        with self.zip_with(agent_files()) as archive:
            self.assertEqual(release.agent_version(archive), support.VERSION)
            pinned = release.notebook_assets(archive)
        self.assertEqual(pinned, asset_pins(), "INSPIRE_NOTEBOOK_ASSETS (app_shell and result_history) is read from the split agent")
        listed = [{"kind": "notebook", "name": p["file"], "file": p["file"], "sha256": p["sha256"], "size": p["size"]} for p in pinned.values()]
        release.check_notebook_assets(pinned, listed)
        with self.assertRaisesRegex(release.ReleaseFailure, "result_history"):
            release.check_notebook_assets(pinned, [e for e in listed if e["file"] != HISTORY[0]])

    def test_the_release_refuses_a_lib_whose_sha256_is_not_the_notebooks_pin(self):
        lib = lib_source()
        with self.zip_with(agent_files(lib=lib)) as archive:
            self.assertEqual(release.agent_lib_pin(archive), sha(lib))
        files = agent_files(lib=lib)
        files[LIB] = lib + b"# changed after pinning\n"
        with self.zip_with(files) as archive:
            with self.assertRaisesRegex(release.ReleaseFailure, "INSPIRE_LIB_SHA256"):
                release.agent_lib_pin(archive)

    def test_the_release_refuses_a_zip_that_still_ships_the_single_notebook_or_misses_a_split_file(self):
        files = agent_files()
        with self.zip_with(dict(files, **{f"{LEGACY}.ipynb": support.agent_notebook()})) as archive:
            with self.assertRaisesRegex(release.ReleaseFailure, LEGACY):
                release.agent_lib_pin(archive)
        for gone in files:
            with self.zip_with({k: v for k, v in files.items() if k != gone}) as archive:
                with self.assertRaisesRegex(release.ReleaseFailure, re.escape(gone)):
                    release.agent_lib_pin(archive)

    def test_the_release_manifest_pins_every_agent_file_by_sha256(self):
        files = agent_files()
        with self.zip_with(files) as archive:
            items = {i["path"]: i for i in release.zip_contents(archive, release.load_starter())}
        for name, data in files.items():
            self.assertEqual((items[name]["sha256"], items[name]["size"]), (sha(data), len(data)), name)
        self.assertIsNone(items[LIB]["notebook"], "the lib is checked as a plain file, byte for byte")

    def test_embed_pins_result_history_with_the_other_notebook_assets(self):
        spec = importlib.util.spec_from_file_location("embed_for_c51", EMBED)
        embed = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(embed)
        self.assertEqual(embed.ASSETS.get("result_history", ("",))[0], HISTORY[0], "result_history ships as a pinned notebook asset")


if __name__ == "__main__":
    unittest.main()
