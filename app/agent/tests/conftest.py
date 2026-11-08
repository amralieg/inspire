import importlib.util
import json
import os
import sys
import types

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _agentload  # noqa: E402

RELEASE = os.path.join(os.path.dirname(HERE), "release")
RELEASE_TOOLS = ("rc_settings", "rc_install", "rc_release", "isolation", "infra_install")
LEAK_RULES = '''import re
LEAK = re.compile(r"leaky-word")
BENIGN = {"leaky-word.example"}
LONG = re.compile(r"(?<![0-9A-Za-z.])[1-9][0-9]{14,18}(?![0-9A-Za-z])")


def synthetic(num):
    return len(set(num)) <= 4
'''


@pytest.fixture
def release_tool(tmp_path, monkeypatch):
    (tmp_path / "leak_scan.py").write_text(LEAK_RULES, encoding="utf-8")
    settings = {
        "profile": "test-profile", "warehouse": "wh0", "catalog": "test_cat", "scratch_app": "scratch-app",
        "protected_apps": ["kept-app", "kept-app-2"], "watched_service_principals": ["sp-watched"], "workspace_folder": "rc_tests",
        "work": str(tmp_path / "work"), "leak_scan": str(tmp_path / "leak_scan.py"), "extra_leak_pattern": r"secret-host",
        "repo_dir": str(tmp_path / "repo"), "branch": "feat/test", "latest_tag": "v0.0.1", "compare_to": "v0.0.0",
        "probe": str(tmp_path / "probe.json"), "assets_cache": str(tmp_path / "cache"),
        "infra_base": str(tmp_path / "out"), "infra_envs": str(tmp_path / "envs.json"),
        "isolation": {"watched_apps": ["kept-app"], "lakebase_project": "lb-project", "lakebase_catalog": "lb_cat",
                      "catalogs": ["kept_cat"], "schemas": ["kept_cat._inspire"], "folders": ["/Shared/kept"],
                      "trees": ["/Shared/kept/assets/v0.0.1"], "acl_folders": ["/Shared/kept"], "own_paths": ["/v9.9.9"]},
    }
    path = tmp_path / "settings.json"

    def write():
        path.write_text(json.dumps(settings), encoding="utf-8")

    write()
    monkeypatch.setenv("INSPIRE_RC_SETTINGS", str(path))
    for name in ("databricks", "databricks.sdk", "databricks.sdk.service", "databricks.sdk.service.jobs",
                 "databricks.sdk.service.workspace", "databricks.sdk.service.sql"):
        monkeypatch.setitem(sys.modules, name, types.ModuleType(name))
    sys.modules["databricks.sdk"].WorkspaceClient = object
    for name in ("jobs", "workspace", "sql"):
        setattr(sys.modules["databricks.sdk.service"], name, sys.modules[f"databricks.sdk.service.{name}"])

    def load(name):
        for tool in RELEASE_TOOLS:
            sys.modules.pop(tool, None)
        write()
        spec = importlib.util.spec_from_file_location(name, os.path.join(RELEASE, f"{name}.py"))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    yield types.SimpleNamespace(load=load, settings=settings, path=path, write=write, release=RELEASE, root=tmp_path)
    for tool in RELEASE_TOOLS:
        sys.modules.pop(tool, None)


@pytest.fixture(autouse=True)
def _restore_app_shell_imports():
    path = list(sys.path)
    shells = {name: module for name, module in sys.modules.items() if name.startswith("shell_")}
    yield
    for name in [name for name in sys.modules if name.startswith("shell_") and name not in shells]:
        del sys.modules[name]
    sys.modules.update(shells)
    sys.path[:] = path


@pytest.fixture(scope="session")
def agent_ns():
    """The shared, read-only agent namespace. Do not rebind names in it."""
    return _agentload.load_agent_namespace()


@pytest.fixture(autouse=True)
def _restore_shared_agent_ns(request):
    if "agent_ns" not in request.fixturenames:
        yield
        return
    ns = request.getfixturevalue("agent_ns")
    saved = dict(ns)
    yield
    for name in [name for name in ns if name not in saved]:
        del ns[name]
    ns.update(saved)


@pytest.fixture
def fresh_ns():
    """An unshared agent namespace for tests that mutate module globals."""
    return _agentload.fresh_agent_namespace()


class FakeServingEndpoint:
    """One row of a `serving_endpoints.list()` answer, shaped the way the SDK shapes it.

    The Databricks SDK is stubbed offline, so a real listing is unobtainable and every
    discovery test would otherwise be testing the seed pool. Injecting the inventory is what
    lets a test name an endpoint that does not exist yet.
    """

    def __init__(self, name, task="llm/v1/chat", ready=True, entity_kind="foundation",
                 payload=None):
        self.name = name
        self.task = task
        self.state = types.SimpleNamespace(ready="READY" if ready else "NOT_READY")
        entity = {}
        if entity_kind == "foundation":
            entity = {"foundation_model": {"name": name}}
        elif entity_kind == "external":
            entity = {"external_model": {"name": name}}
        elif entity_kind == "custom":
            entity = {"entity_name": name}
        self.config = types.SimpleNamespace(served_entities=[entity])
        self._payload = dict(payload or {})
        self._payload.setdefault("name", name)

    def as_dict(self):
        return dict(self._payload)


class FakeWorkspaceClient:
    """A workspace whose endpoint inventory the caller chose.

    `listing=None` reproduces a workspace that refuses the call (missing grant, API error),
    which is the only way discovery is allowed to fall through to the seed pool.
    """

    def __init__(self, listing, host="https://example.workspace.cloud.databricks.com"):
        self.config = types.SimpleNamespace(host=host)
        outer = self

        class _Endpoints:
            @staticmethod
            def list():
                if outer._listing is None:
                    raise PermissionError("PERMISSION_DENIED: serving_endpoints.list")
                return list(outer._listing)

        self._listing = listing
        self.serving_endpoints = _Endpoints()


def endpoints(*names, **kw):
    return [FakeServingEndpoint(n, **kw) for n in names]


def rebind_models(ns, listing, host="https://example.workspace.cloud.databricks.com", **kw):
    """Re-run discovery in `ns` against an injected inventory and return the bound roster."""
    ns["discover_and_bind_roles"](w=FakeWorkspaceClient(listing, host=host), force=True, **kw)
    return ns["TECHNICAL_CONTEXT"]["models"]
