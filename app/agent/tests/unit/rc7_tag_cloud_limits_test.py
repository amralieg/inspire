"""rc.7 fix-py decision 3: one per-cloud job tag table, shared with the backend (127 keys; 255 AWS and Azure, 63 GCP).
The cloud comes from the workspace host, and an unknown cloud takes the strictest limit, 63."""
import pytest


@pytest.mark.parametrize("host,cloud,value_max", [
    ("dbc-1.cloud.databricks.com", "aws", 255),
    ("adb-1.12.azuredatabricks.net", "azure", 255),
    ("1234567890.gcp.databricks.com", "gcp", 63),
    ("dbc-1.cloud.example", "", 63),
    ("", "", 63),
])
def test_the_job_tag_value_limit_follows_the_workspace_cloud_and_is_63_when_unknown(agent_ns, monkeypatch, host, cloud, value_max):
    monkeypatch.setenv("DATABRICKS_HOST", host)
    launcher = agent_ns["JobLauncher"]
    assert launcher.tag_cloud() == cloud
    assert launcher.tag_value_max() == value_max
    assert len(launcher.tag_value("v" * 400, "job")) == value_max


def test_the_job_tag_key_limit_is_127_on_every_cloud(agent_ns, monkeypatch):
    launcher = agent_ns["JobLauncher"]
    for host in ("dbc-1.cloud.databricks.com", "adb-1.12.azuredatabricks.net", "1234567890.gcp.databricks.com", ""):
        monkeypatch.setenv("DATABRICKS_HOST", host)
        assert len(launcher.tag_key("k" * 300, "job")) == 127


def test_a_gcp_limit_never_leaks_into_an_aws_workspace(agent_ns, monkeypatch):
    launcher = agent_ns["JobLauncher"]
    monkeypatch.setenv("DATABRICKS_HOST", "1234567890.gcp.databricks.com")
    assert launcher.tag_value_max() == 63
    monkeypatch.setenv("DATABRICKS_HOST", "dbc-1.cloud.databricks.com")
    assert launcher.tag_value_max() == 255, "the cloud is read on every call, never cached from an earlier workspace"
