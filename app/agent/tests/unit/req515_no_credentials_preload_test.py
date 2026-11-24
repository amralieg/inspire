"""REQ-515: with the real databricks SDK imported before the notebook loads and no credentials anywhere, the three callers
that probe `w_client` read it as absent instead of raising the SDK's "cannot configure default credentials"."""
import databricks.sdk  # noqa: F401  (the real SDK, imported first, as xdist ordering can do)
import databricks.sdk.config  # noqa: F401
import pytest


@pytest.fixture
def bare(fresh_ns, monkeypatch, tmp_path):
    import os
    for name in [n for n in os.environ if n.startswith("DATABRICKS_")]:
        monkeypatch.delenv(name)
    empty = tmp_path / "databrickscfg"
    empty.write_text("")
    monkeypatch.setenv("DATABRICKS_CONFIG_FILE", str(empty))
    cls = fresh_ns["DatabricksInspire"]
    inst = cls.__new__(cls)
    inst.operation_mode = "Discover Use Cases"
    return inst


def test_the_genie_code_verdict_step_skips_when_there_are_no_credentials(bare):
    assert bare._record_genie_code_verdict() is None


def test_the_genie_agents_file_is_skipped_when_there_are_no_credentials(bare):
    assert bare._write_genie_agents_file("/Workspace/out") == ""


def test_redaction_works_when_there_are_no_credentials(bare):
    assert bare._implement_redacted("plain text") == "plain text"
