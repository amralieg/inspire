import importlib
import os
import re
import sys
import types

import pytest

from v177_assets_support import make_assets, wheel


@pytest.fixture(autouse=True)
def _restore_sqlglot_and_path():
    saved_path = list(sys.path)
    saved = {n: m for n, m in sys.modules.items() if n == "sqlglot" or n.startswith("sqlglot.")}
    yield
    for n in [n for n in sys.modules if n == "sqlglot" or n.startswith("sqlglot.")]:
        del sys.modules[n]
    sys.modules.update(saved)
    sys.path[:] = saved_path


def _pinned_assets(fresh_ns, tmp_path):
    version = fresh_ns["INSPIRE_ASSET_WHEELS"]["sqlglot"]
    return version, make_assets(fresh_ns, tmp_path / "assets",
                                [{"kind": "python", "name": "sqlglot", "version": version,
                                  "data": wheel({"sqlglot/__init__.py": "X = 1\n", "sqlglot/errors.py": "\n"})}])


def _preload_other_sqlglot(monkeypatch):
    preloaded = types.SimpleNamespace(__file__="/local_disk0/env/site-packages/sqlglot/__init__.py", __version__="29.0.0")
    monkeypatch.setitem(sys.modules, "sqlglot", preloaded)
    monkeypatch.setitem(sys.modules, "sqlglot.expressions", types.SimpleNamespace(__file__="/local_disk0/env/sqlglot/expressions.py"))


def test_a_different_sqlglot_preloaded_in_the_process_is_replaced_by_the_pinned_copy(fresh_ns, tmp_path, monkeypatch):
    version, assets = _pinned_assets(fresh_ns, tmp_path)
    _preload_other_sqlglot(monkeypatch)
    site = assets.python("sqlglot")
    loaded = importlib.import_module("sqlglot")
    assert loaded.X == 1, "the pinned copy is the one the SQL checks use"
    assert os.path.realpath(loaded.__file__).startswith(os.path.realpath(site) + os.sep)
    assert "sqlglot.expressions" not in sys.modules, "submodules of the preloaded copy are dropped with it"


def test_a_business_reason_has_no_paths_or_ids(fresh_ns):
    text = ("sqlglot is already loaded in this Python process from /usr/lib/python3/sqlglot/__init__.py, so Inspire cannot "
            "load sqlglot 30.11.0 for session 123456789012 and asset 3f2a9c1e-1111-4222-8333-944455556666.")
    said = fresh_ns["implement_short_reason"](text)
    assert not re.search(r"/\w", said) and "123456789012" not in said and "3f2a9c1e" not in said
    assert "an id" in said and "a system file" in said
