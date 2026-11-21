"""Offline tests for the isolation before-snapshot when a watched App's source folder has no app.yaml. No workspace is touched."""
import hashlib
import importlib
import io
import json
import os
import pathlib
import sys
import tempfile
from types import SimpleNamespace

import pytest

HERE = pathlib.Path(__file__).resolve().parents[2] / "release"
sys.path.insert(0, str(HERE))

_dir = pathlib.Path(tempfile.mkdtemp(prefix="iso_yaml_test_"))
_settings = _dir / "settings.json"
_settings.write_text(json.dumps({
    "profile": "test", "warehouse": "wh", "catalog": "cat", "protected_apps": ["p"], "scratch_app": "scratch",
    "watched_service_principals": ["sp"], "workspace_folder": "folder", "work": str(_dir / "work"),
    "isolation": {"watched_apps": ["app-a", "app-b"], "lakebase_project": "lp", "lakebase_catalog": "lc",
                  "catalogs": ["c1"], "schemas": ["c1.s1"], "folders": ["/f"], "trees": ["/t"],
                  "acl_folders": ["/a"], "own_paths": ["/own"]},
}), encoding="utf-8")


_OWN = ("databricks", "isolation", "rc_install", "rc_settings")


def _ours(name):
    return any(name == p or name.startswith(p + ".") for p in _OWN)


@pytest.fixture
def iso(monkeypatch):
    # isolation.py imports the real databricks SDK, while other modules in the same pytest worker install SDK stubs
    # under the same names. Import it per test against the real SDK, then put the worker's modules back as they were.
    monkeypatch.setenv("INSPIRE_RC_SETTINGS", str(_settings))
    saved = {k: v for k, v in sys.modules.items() if _ours(k)}
    for k in saved:
        del sys.modules[k]
    try:
        yield importlib.import_module("isolation")
    finally:
        for k in [k for k in sys.modules if _ours(k)]:
            del sys.modules[k]
        sys.modules.update(saved)

YAML = b"command: [node]\n"


class FakeWorkspace:
    def __init__(self, failure_for_a):
        self.failure = failure_for_a
        self.workspace = SimpleNamespace(download=self._download, list=lambda *a, **k: [])
        self.api_client = SimpleNamespace(do=lambda *a, **k: {"object_id": 1})
        self.apps = SimpleNamespace(get=self._get)

    def _get(self, name):
        dep = SimpleNamespace(source_code_path=f"/src/{name}", deployment_id=f"d-{name}")
        return SimpleNamespace(active_deployment=dep, service_principal_client_id="sp", compute_status=None,
                               user_api_scopes=[], description="", update_time="t")

    def _download(self, path):
        if path == "/src/app-a/app.yaml":
            raise self.failure
        return io.BytesIO(YAML)


def _run(iso, monkeypatch, tmp_path, failure):
    monkeypatch.setattr(iso, "WorkspaceClient", lambda profile=None: FakeWorkspace(failure))
    monkeypatch.setattr(iso.rc_install, "statement", lambda *a, **k: [])
    out = tmp_path / "snap.json"
    iso.snapshot(str(out))
    return json.loads(out.read_text())


def test_a_missing_app_yaml_is_recorded_as_absent_and_the_other_app_keeps_its_sha(iso, monkeypatch, tmp_path):
    NotFound = iso.NotFound
    snap = _run(iso, monkeypatch, tmp_path, NotFound("no app.yaml"))
    assert snap["apps"]["app-a"]["app_yaml_sha256"] == "absent"
    assert snap["apps"]["app-b"]["app_yaml_sha256"] == hashlib.sha256(YAML).hexdigest()


def test_any_other_error_still_raises(iso, monkeypatch, tmp_path):
    PermissionDenied = sys.modules["databricks.sdk.errors"].PermissionDenied
    with pytest.raises(PermissionDenied):
        _run(iso, monkeypatch, tmp_path, PermissionDenied("denied"))
