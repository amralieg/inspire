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



def test_the_rc1_starter_with_no_read_catalog_constant_is_used_unchanged(infra, tmp_path, monkeypatch):
    """REQ-113 miss 4: rc.1 moved the read-catalog setting from SCAN_CATALOGS to the DATA_CATALOGS widget in the installer module.
    The starter carries no SCAN_CATALOGS, so the infra work dir must accept it as it is instead of refusing it."""
    monkeypatch.setattr(infra, "BASE", tmp_path / "base")
    release_out = tmp_path / "release_out"
    release_out.mkdir()
    real = open(os.path.join(ROOT, "..", "..", "inspire_installer.py"), encoding="utf-8").read()
    assert "SCAN_CATALOGS" not in real
    (release_out / "inspire_installer.py").write_text(real, encoding="utf-8")
    work = infra.work_dir("v1.5.3-rc.1", release_out)
    assert (work / "release" / "inspire_installer.py").read_text(encoding="utf-8") == real


def test_a_starter_with_a_malformed_scan_catalogs_setting_is_refused(infra, tmp_path, monkeypatch):
    monkeypatch.setattr(infra, "BASE", tmp_path / "base")
    release_out = tmp_path / "release_out"
    release_out.mkdir()
    (release_out / "inspire_installer.py").write_text('SCAN_CATALOGS = ["main"]\n', encoding="utf-8")
    with pytest.raises(SystemExit, match="SCAN_CATALOGS is neither"):
        infra.work_dir("v1.5.3-rc.1", release_out)
