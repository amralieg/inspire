import os

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture
def infra(release_tool):
    return release_tool.load("infra_install")


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


def test_the_tool_refuses_to_run_without_its_settings_file(release_tool, monkeypatch):
    monkeypatch.delenv("INSPIRE_RC_SETTINGS")
    with pytest.raises(SystemExit, match="set INSPIRE_RC_SETTINGS"):
        release_tool.load("infra_install")


def test_the_install_output_folders_come_from_the_settings(release_tool, infra):
    assert str(infra.BASE) == release_tool.settings["infra_base"]
    assert str(infra.ENVS) == release_tool.settings["infra_envs"]
    assert infra.R.PROFILE == "test-profile" and infra.R.SCRATCH_APP == "scratch-app"
