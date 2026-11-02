import hashlib
import importlib.util
import io
import json
import pathlib
import sys
import types
import urllib.error
import zipfile

HERE = pathlib.Path(__file__).resolve().parent
INSTALLER_DIR = HERE.parent
sys.path.insert(0, str(INSTALLER_DIR))

import release

VERSION = "v1.3.0"
FORK_BASE = "https://github.com/amralieg/inspire/releases/download/v1.3.0-test"
FAKE_MODULE = (
    "def run(env):\n"
    "    env['displayHTML']('<p>installed</p>')\n"
    "    return {'ran': sorted(env['files']), 'source': env['source'],\n"
    "            'version': env['manifest']['version'], 'settings': env['settings']}\n"
)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def agent_notebook(version=VERSION):
    cells = [{"cell_type": "markdown", "metadata": {}, "source": ["# Agent"]},
             {"cell_type": "code", "metadata": {}, "source": [f'__AGENT_VERSION__ = "{version}"\n', "print(1)"],
              "outputs": [], "execution_count": None}]
    return json.dumps({"cells": cells, "metadata": {}, "nbformat": 4, "nbformat_minor": 5}).encode("utf-8")


def make_app_zip(path, version=VERSION, module=FAKE_MODULE, extra=None):
    files = {
        "app.yaml": b"command:\n  - \"bash\"\n",
        "backend/server.js": b"console.log('inspire')\n",
        "dbx_inspire_ai_agent.ipynb": agent_notebook(version),
        "dbx_generate_demo_data.py": b"# Databricks notebook source\nprint('demo')\n",
        "installer/inspire_setup.py": module.encode("utf-8"),
    }
    files.update(extra or {})
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    return files


def make_assets(folder, version=VERSION, files=None):
    folder = pathlib.Path(folder)
    files = files or {"fonts/inter-400.ttf": b"font" * 600, "cli/databricks-cli-x86_64.zip": bytes(range(256)) * 40,
                      "licenses/inter.txt": b"SIL Open Font License\n"}
    entries = []
    for name, data in files.items():
        (folder / name).parent.mkdir(parents=True, exist_ok=True)
        (folder / name).write_bytes(data)
        entries.append({"kind": name.split("/")[0].rstrip("s"), "name": name, "file": name, "size": len(data), "sha256": sha(data)})
    (folder / "manifest.json").write_text(json.dumps({"format": 1, "inspire_version": version, "files": entries}), encoding="utf-8")
    return files


def build_release(tmp, name="release", version=VERSION, module=FAKE_MODULE, assets=None, extra=None):
    tmp = pathlib.Path(tmp)
    app_zip = tmp / f"{name}-app.zip"
    make_app_zip(app_zip, version, module, extra)
    assets_dir = tmp / f"{name}-assets"
    assets_dir.mkdir()
    make_assets(assets_dir, version, assets)
    out = tmp / name
    release.build(str(app_zip), str(assets_dir), str(out))
    return out


def v130_manifest(manifest, part_bytes=4096):
    old = json.loads(json.dumps(manifest))
    for entry in old["files"]:
        stem = entry["name"].split(".", 1)[0]
        count = max(1, -(-entry["size"] // part_bytes))
        sizes = [part_bytes] * (count - 1) + [entry["size"] - part_bytes * (count - 1)]
        entry["parts"] = [{"name": f"{stem}.part{i:02d}", "size": size, "sha256": "0" * 64} for i, size in enumerate(sizes, 1)]
    return old


class FakeWidgets:
    def __init__(self, existing=None):
        self.state = {name: dict(widget) for name, widget in (existing or {}).items()}
        self.removed_this_cell = set()
        self.calls = []

    def new_cell(self):
        self.removed_this_cell.clear()

    def _create(self, kind, name, default, choices, label):
        self.calls.append(("create", kind, name, default))
        if kind == "dropdown" and default not in choices:
            raise ValueError(f"Default value {default!r} is not one of the choices of {name}")
        if name in self.removed_this_cell or name in self.state:
            return None
        self.state[name] = {"kind": kind, "value": default, "choices": list(choices), "label": label}
        return None

    def dropdown(self, name, default, choices, label=None):
        return self._create("dropdown", name, default, choices, label)

    def combobox(self, name, default, choices, label=None):
        return self._create("combobox", name, default, choices, label)

    def get(self, name):
        if name not in self.state:
            raise ValueError(f"InputWidgetNotDefined: {name}")
        return self.state[name]["value"]

    def remove(self, name):
        self.calls.append(("remove", name))
        if name not in self.state:
            raise ValueError(f"InputWidgetNotDefined: {name}")
        del self.state[name]
        self.removed_this_cell.add(name)

    def pick(self, name, value):
        if self.state[name]["kind"] == "dropdown" and value not in self.state[name]["choices"]:
            raise ValueError(f"{value!r} is not a choice of the dropdown {name}")
        self.state[name]["value"] = value


def load_starter(stage):
    ns = release.load_starter()
    ns["STAGE"] = str(stage)
    shown = []
    ns["displayHTML"] = shown.append
    ns["shown"] = shown
    return ns


def load_setup():
    try:
        import databricks.sdk
        import databricks.sdk.service.sql
    except ImportError:
        databricks = types.ModuleType("databricks")
        sdk = types.ModuleType("databricks.sdk")
        service = types.ModuleType("databricks.sdk.service")
        sql = types.ModuleType("databricks.sdk.service.sql")
        sdk.WorkspaceClient = object
        sql.StatementState = types.SimpleNamespace(SUCCEEDED="SUCCEEDED", FAILED="FAILED", PENDING="PENDING", RUNNING="RUNNING")
        sys.modules.update({"databricks": databricks, "databricks.sdk": sdk, "databricks.sdk.service": service,
                            "databricks.sdk.service.sql": sql})
    try:
        import requests
    except ImportError:
        requests = types.ModuleType("requests")
        requests.exceptions = types.SimpleNamespace(HTTPError=type("HTTPError", (Exception,), {}))
        requests.utils = types.SimpleNamespace(quote=lambda s: s)
        sys.modules["requests"] = requests
    spec = importlib.util.spec_from_file_location("inspire_setup_under_test", INSTALLER_DIR / "inspire_setup.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeResponse(io.BytesIO):
    def __init__(self, data, url):
        super().__init__(data)
        self.url = url

    def geturl(self):
        return self.url


class FakeGitHub:
    def __init__(self, base, folder=None, files=None, fail=None):
        self.base = base.rstrip("/")
        self.files = dict(files or {})
        if folder:
            self.files.update({path.name: path.read_bytes() for path in pathlib.Path(folder).iterdir()})
        self.fail = fail
        self.requested = []

    def __call__(self, url, repo, timeout):
        self.requested.append(url.rsplit("/", 1)[-1])
        if self.fail:
            raise self.fail
        name = url[len(self.base) + 1:] if url.startswith(self.base + "/") else None
        if name not in self.files:
            raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)
        return FakeResponse(self.files[name], url)
