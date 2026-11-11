"""rc.7 fix-cloud: one per-cloud job tag table, shared with the backend (127 keys; 255 AWS and Azure, 63 GCP).
The cloud is what the platform reports through the SDK config (Config.cloud), never the workspace host text.
An unknown cloud, or a config that fails, takes the strictest limit, 63."""
import types

import pytest


def _workspace(cloud):
    return lambda: types.SimpleNamespace(config=types.SimpleNamespace(cloud=cloud))


def _platform_cloud(value):
    return None if value is None else types.SimpleNamespace(value=value)


@pytest.fixture
def workspace_cloud(agent_ns, monkeypatch):
    launcher = agent_ns["JobLauncher"]

    def use(value):
        monkeypatch.setitem(agent_ns, "WorkspaceClient", _workspace(_platform_cloud(value)))
        monkeypatch.setattr(launcher, "TAG_CLOUD", None)
        return launcher

    return use


@pytest.mark.parametrize("platform,cloud,value_max", [
    ("AWS", "aws", 255),
    ("AZURE", "azure", 255),
    ("GCP", "gcp", 63),
    (None, "", 63),
])
def test_the_job_tag_value_limit_follows_the_platform_cloud_and_is_63_when_unknown(workspace_cloud, platform, cloud, value_max):
    launcher = workspace_cloud(platform)
    assert launcher.tag_cloud() == cloud
    assert launcher.tag_value_max() == value_max
    assert len(launcher.tag_value("v" * 400, "job")) == value_max


def test_the_job_tag_key_limit_is_127_on_every_cloud(workspace_cloud):
    for platform in ("AWS", "AZURE", "GCP", None):
        launcher = workspace_cloud(platform)
        assert len(launcher.tag_key("k" * 300, "job")) == 127


def test_a_gcp_limit_never_leaks_into_an_aws_workspace(workspace_cloud):
    assert workspace_cloud("GCP").tag_value_max() == 63
    assert len(workspace_cloud("GCP").tag_value("v" * 400, "job")) == 63
    assert workspace_cloud("AWS").tag_value_max() == 255, "a new workspace is read again, never cached from an earlier one"


def test_a_config_that_fails_takes_the_strictest_limit(agent_ns, monkeypatch):
    launcher = agent_ns["JobLauncher"]

    def unreachable():
        raise RuntimeError("no credentials")

    monkeypatch.setitem(agent_ns, "WorkspaceClient", unreachable)
    monkeypatch.setattr(launcher, "TAG_CLOUD", None)
    assert launcher.tag_value_max() == 63
