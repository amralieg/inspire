import importlib.util
import os
import sys
import types

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture
def infra(tmp_path, monkeypatch):
    (tmp_path / "rc_install.py").write_text("")
    for name, value in (("INSPIRE_RC_TOOLS", tmp_path), ("INSPIRE_RC_BASE", tmp_path / "out"), ("INSPIRE_RC_ENVS", tmp_path / "envs.json")):
        monkeypatch.setenv(name, str(value))
    sdk = types.ModuleType("databricks.sdk")
    sdk.WorkspaceClient = object
    monkeypatch.setitem(sys.modules, "databricks", types.ModuleType("databricks"))
    monkeypatch.setitem(sys.modules, "databricks.sdk", sdk)
    monkeypatch.delitem(sys.modules, "rc_install", raising=False)
    monkeypatch.setattr(sys, "path", list(sys.path))
    spec = importlib.util.spec_from_file_location("inspire_infra_install", os.path.join(ROOT, "release", "infra_install.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_an_install_is_ready_only_when_the_app_skips_the_setup_wizard(infra):
    assert infra.install_verdict("SUCCESS", {"envSkipsSetupWizard": True}) == (True, "ready")
    for shown in ({"envSkipsSetupWizard": False}, {}, {"envSkipsSetupWizard": "true"}, {"envSkipsSetupWizard": 1}):
        assert infra.install_verdict("SUCCESS", shown) == (False, "installed but /api/defaults envSkipsSetupWizard is not true"), shown


def test_a_failed_installer_run_is_never_ready_even_when_the_app_answers(infra):
    for result in ("FAILED", "CANCELED", None):
        assert infra.install_verdict(result, {"envSkipsSetupWizard": True}) == (False, f"install {result}")


def test_a_not_ready_install_exits_non_zero(infra):
    source = open(os.path.join(ROOT, "release", "infra_install.py"), encoding="utf-8").read()
    assert "    ready, status = install_verdict(result, res)\n" in source
    assert "    if not ready:\n        raise SystemExit(" in source


def test_the_tool_refuses_to_run_without_its_path_settings(monkeypatch):
    monkeypatch.delenv("INSPIRE_RC_TOOLS", raising=False)
    spec = importlib.util.spec_from_file_location("inspire_infra_install_bare", os.path.join(ROOT, "release", "infra_install.py"))
    with pytest.raises(SystemExit, match="set INSPIRE_RC_TOOLS"):
        spec.loader.exec_module(importlib.util.module_from_spec(spec))
