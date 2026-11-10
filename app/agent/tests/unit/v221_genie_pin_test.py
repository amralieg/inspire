import importlib.metadata
import os
import re
import sys
import types

import pytest

from v177_assets_support import make_assets, wheel


def _installed(monkeypatch, version: str):
    def installed(name):
        if name == "sqlglot":
            return version
        raise importlib.metadata.PackageNotFoundError(name)
    monkeypatch.setattr(importlib.metadata, "version", installed)


def test_sqlglot_already_loaded_at_the_pinned_version_does_not_block_the_genie_check(fresh_ns, tmp_path, monkeypatch):
    version = fresh_ns["INSPIRE_ASSET_WHEELS"]["sqlglot"]
    _installed(monkeypatch, version)
    assets = make_assets(fresh_ns, tmp_path / "assets",
                         [{"kind": "python", "name": "sqlglot", "version": version, "data": wheel({"sqlglot/__init__.py": "X = 1\n"})}])
    monkeypatch.setitem(sys.modules, "sqlglot", types.SimpleNamespace(__file__="/usr/lib/python3/sqlglot/__init__.py"))
    site = assets.python("sqlglot")
    assert os.path.exists(os.path.join(site, "sqlglot", "__init__.py")), "the pinned copy is still unpacked and put on the path"
    assert sys.modules["sqlglot"].__file__ == "/usr/lib/python3/sqlglot/__init__.py", "the module already loaded is kept"


def test_sqlglot_already_loaded_at_another_version_is_still_refused(fresh_ns, tmp_path, monkeypatch):
    version = fresh_ns["INSPIRE_ASSET_WHEELS"]["sqlglot"]
    _installed(monkeypatch, "29.0.0")
    assets = make_assets(fresh_ns, tmp_path / "assets",
                         [{"kind": "python", "name": "sqlglot", "version": version, "data": wheel({"sqlglot/__init__.py": "X = 1\n"})}])
    monkeypatch.setitem(sys.modules, "sqlglot", types.SimpleNamespace(__file__="/usr/lib/python3/sqlglot/__init__.py"))
    with pytest.raises(fresh_ns["InspireAssetError"], match=r"sqlglot is already loaded in this Python process"):
        assets.python("sqlglot")


def test_a_business_reason_has_no_paths_or_ids(fresh_ns):
    text = ("sqlglot is already loaded in this Python process from /usr/lib/python3/sqlglot/__init__.py, so Inspire cannot "
            "load sqlglot 30.11.0 for session 123456789012 and asset 3f2a9c1e-1111-4222-8333-944455556666.")
    said = fresh_ns["implement_short_reason"](text)
    assert not re.search(r"/\w", said) and "123456789012" not in said and "3f2a9c1e" not in said
    assert "an id" in said and "a system file" in said
