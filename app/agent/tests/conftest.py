import os
import sys
import types

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _agentload  # noqa: E402


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
