import hashlib
import importlib.util
import io
import json
import pathlib
import sys
import types
import urllib.error
import urllib.parse
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


def build_release(tmp, name="release", version=VERSION, part_bytes=4096, module=FAKE_MODULE, assets=None, extra=None):
    tmp = pathlib.Path(tmp)
    app_zip = tmp / f"{name}-app.zip"
    make_app_zip(app_zip, version, module, extra)
    assets_dir = tmp / f"{name}-assets"
    assets_dir.mkdir()
    make_assets(assets_dir, version, assets)
    out = tmp / name
    release.build(str(app_zip), str(assets_dir), str(out), part_bytes)
    return out


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


class FakeReleases:
    REPO = "amralieg/inspire"
    MISSING = (404, {"message": "Not Found"})

    def __init__(self):
        self.releases, self.assets, self.data = [], {}, {}
        self.calls, self.downloads = [], []
        self.latest, self.ids, self.damage_uploads = None, iter(range(101, 1000000)), False

    def release(self, tag, files=None, prerelease=True, draft=False, latest=False, digests=None):
        rid = next(self.ids)
        self.releases.append({"id": rid, "tag_name": tag, "prerelease": prerelease, "draft": draft,
                              "upload_url": f"https://uploads.github.com/repos/{self.REPO}/releases/{rid}/assets{{?name,label}}"})
        self.assets[rid] = []
        if latest:
            self.latest = rid
        for name, data in (files or {}).items():
            self.add(rid, name, data, (digests or {}).get(name))
        return rid

    def add(self, rid, name, data, digest=None):
        tag = next(item["tag_name"] for item in self.releases if item["id"] == rid)
        asset = {"id": next(self.ids), "name": name, "size": len(data), "state": "uploaded",
                 "digest": f"sha256:{digest or sha(data)}",
                 "browser_download_url": f"https://github.com/{self.REPO}/releases/download/{tag}/{name}"}
        self.assets[rid].append(asset)
        self.data[asset["id"]] = data
        return asset

    def names(self, rid):
        return sorted(asset["name"] for asset in self.assets[rid])

    def bytes_of(self, rid):
        return {asset["name"]: self.data[asset["id"]] for asset in self.assets[rid]}

    def writes(self):
        return [call for call in self.calls if call[0] != "GET"]

    def call(self, method, url, body=None, content_type="application/json", size=None):
        parts = urllib.parse.urlsplit(url if url.startswith("https://") else f"https://api.github.com{url}")
        query = urllib.parse.parse_qs(parts.query)
        self.calls.append((method, parts.path, query.get("name", [None])[0]))
        prefix = f"/repos/{self.REPO}/releases"
        if not parts.path.startswith(prefix):
            return self.MISSING
        bits = parts.path[len(prefix):].strip("/").split("/")
        page, per_page = int(query.get("page", ["1"])[0]), int(query.get("per_page", ["30"])[0])

        def paged(items):
            return 200, [dict(item) for item in items[(page - 1) * per_page:page * per_page]]

        if method == "GET" and bits == [""]:
            return paged(self.releases)
        if method == "GET" and bits == ["latest"]:
            found = [dict(item) for item in self.releases if item["id"] == self.latest]
            return (200, found[0]) if found else self.MISSING
        if method == "GET" and len(bits) == 2 and bits[0] == "tags":
            found = [dict(item) for item in self.releases if item["tag_name"] == urllib.parse.unquote(bits[1])]
            return (200, found[0]) if found else self.MISSING
        if method == "DELETE" and len(bits) == 2 and bits[0] == "assets":
            for items in self.assets.values():
                for asset in items:
                    if str(asset["id"]) == bits[1]:
                        items.remove(asset)
                        return 204, None
            return self.MISSING
        if len(bits) == 2 and bits[1] == "assets" and bits[0].isdigit() and int(bits[0]) in self.assets:
            rid = int(bits[0])
            if method == "GET" and parts.hostname == "api.github.com":
                return paged(self.assets[rid])
            if method == "POST" and parts.hostname == "uploads.github.com":
                name = query["name"][0]
                if name in self.names(rid):
                    return 422, {"message": "Validation Failed", "errors": [{"code": "already_exists"}]}
                data = body.read()
                if len(data) != size or content_type != "application/octet-stream":
                    return 400, {"message": "Bad Request"}
                return 201, dict(self.add(rid, name, data + b"!" if self.damage_uploads else data))
        return self.MISSING

    def __call__(self, url, repo, timeout):
        self.downloads.append(url)
        for items in self.assets.values():
            for asset in items:
                if asset["browser_download_url"] == url:
                    return FakeResponse(self.data[asset["id"]], url)
        raise urllib.error.HTTPError(url, 404, "Not Found", {}, io.BytesIO(b"Not Found"))
