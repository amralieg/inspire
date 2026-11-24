"""T1-auth: constructing DatabricksInspire must not sign in.

The SDK Config (and the WorkspaceClient built from it) is created on first use of `workspace` / `w_client`,
once, with the same 300 s retry timeout as before. With no credentials and the real databricks-sdk importable,
construction used to raise "default auth" before a test could exercise anything.
"""
import sys
import types
from unittest import mock

import pytest

from _agentload import fresh_agent_namespace


class _Boom(RuntimeError):
    pass


@pytest.fixture
def probe(monkeypatch):
    calls = {"config": 0, "client": 0}

    class FakeConfig:
        def __init__(self, *a, **kw):
            calls["config"] += 1
            self.retry_timeout_seconds = None

    class FakeClient:
        def __init__(self, config=None, **kw):
            calls["client"] += 1
            self.config = config

    module = types.ModuleType("databricks.sdk.config")
    module.Config = FakeConfig
    monkeypatch.setitem(sys.modules, "databricks.sdk.config", module)
    ns = fresh_agent_namespace()
    monkeypatch.setitem(ns, "WorkspaceClient", FakeClient)
    monkeypatch.setitem(ns, "spark", object())
    monkeypatch.setitem(ns, "dbutils", mock.MagicMock())
    return ns, calls


def test_construction_builds_the_client_at_most_once_and_only_when_first_used(probe):
    ns, calls = probe
    inspire = ns["DatabricksInspire"](generation_path="/Workspace/Users/x/out")
    # __init__ itself touches the client in guarded steps (live log folder, endpoint detection): one build, shared.
    assert calls["config"] == calls["client"] <= 1
    built = calls["config"]
    first = inspire.w_client
    assert inspire.workspace is first and inspire.w_client is first
    assert calls == {"config": 1, "client": 1}
    assert first.config.retry_timeout_seconds == 300
    assert built in (0, 1)


def test_assigned_client_is_used_without_signing_in(probe):
    ns, calls = probe
    inspire = ns["DatabricksInspire"](generation_path="/Workspace/Users/x/out")
    before = dict(calls)
    sentinel = object()
    inspire.w_client = sentinel
    assert inspire.w_client is sentinel
    assert calls == before


def test_real_failure_surfaces_on_first_use_not_construction(monkeypatch):
    class BoomConfig:
        def __init__(self, *a, **kw):
            raise _Boom("default auth: cannot configure default credentials")

    module = types.ModuleType("databricks.sdk.config")
    module.Config = BoomConfig
    monkeypatch.setitem(sys.modules, "databricks.sdk.config", module)
    ns = fresh_agent_namespace()
    monkeypatch.setitem(ns, "spark", object())
    monkeypatch.setitem(ns, "dbutils", mock.MagicMock())
    inspire = ns["DatabricksInspire"](generation_path="/Workspace/Users/x/out")  # must not raise
    with pytest.raises(_Boom, match="default auth"):
        inspire.workspace
