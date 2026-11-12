"""REQ-076/077 (decision 4b): the English catalog JSON write is retried once. A write that lands records its path on the
session. A write that fails twice records the reason on the session and leaves the path empty, so documents say so."""
import pytest

from v120_artifacts_session_test import _atomic_writer
from v120_artifacts_support import FakeSpark, make_inspire
from v130_outputs_test import docs  # noqa: F401

JSON_PATH = "/Workspace/out/docs/Acme-dbx_inspire.json"


class SessionSql:
    def __init__(self):
        self.statements = []

    def __call__(self, sql, tag, wait=False, timeout=None):
        self.statements.append(sql)
        return True


def writer_with_session_sql(ns, tmp_path, monkeypatch):
    writer = _atomic_writer(ns, FakeSpark(), tmp_path, monkeypatch)
    recorder = SessionSql()
    monkeypatch.setattr(writer, "_execute_session_write", recorder)
    return writer, recorder


def test_a_landed_catalog_json_records_its_path_and_clears_any_old_reason(docs, tmp_path, monkeypatch):
    writer, sql = writer_with_session_sql(docs, tmp_path, monkeypatch)
    try:
        assert writer.record_catalog_json_path(JSON_PATH) is True
        assert len(sql.statements) == 1
        assert "SET catalog_json_path = '/Workspace/out/docs/Acme-dbx_inspire.json', catalog_json_reason = NULL" in sql.statements[0]
    finally:
        writer._session_writer.stop(drain_timeout=5.0)


def test_a_catalog_json_write_that_fails_once_is_retried_and_then_records_its_path(docs, tmp_path, monkeypatch):
    obj = make_inspire(docs)
    writer, sql = writer_with_session_sql(docs, tmp_path, monkeypatch)
    obj.atomic_writer = writer
    attempts = []

    def flaky_import(path, content, format=None, overwrite=True):
        attempts.append(path)
        if len(attempts) == 1:
            raise RuntimeError("transient 503")
        obj.w_client.workspace.files[path] = b"{}"

    monkeypatch.setattr(obj.w_client.workspace, "import_", flaky_import)
    try:
        obj._import_catalog_json(JSON_PATH, "e30=")
        assert attempts == [JSON_PATH, JSON_PATH], "one retry after the first failure"
        assert len(sql.statements) == 1 and JSON_PATH in sql.statements[0]
    finally:
        writer._session_writer.stop(drain_timeout=5.0)


def test_a_catalog_json_write_that_fails_twice_raises_and_the_reason_is_recorded_with_no_path(docs, tmp_path, monkeypatch):
    obj = make_inspire(docs)
    writer, sql = writer_with_session_sql(docs, tmp_path, monkeypatch)
    obj.atomic_writer = writer
    attempts = []

    def failing_import(path, content, format=None, overwrite=True):
        attempts.append(path)
        raise RuntimeError("workspace refused the write")

    monkeypatch.setattr(obj.w_client.workspace, "import_", failing_import)
    try:
        with pytest.raises(RuntimeError, match="workspace refused"):
            obj._import_catalog_json(JSON_PATH, "e30=")
        assert len(attempts) == 2, "exactly one retry, then the failure surfaces"
        assert sql.statements == [], "no path is recorded for a catalog that did not land"
        assert writer.record_catalog_json_failure("workspace refused the write") is True
        assert len(sql.statements) == 1
        assert "catalog_json_path = NULL, catalog_json_reason = 'workspace refused the write'" in sql.statements[0]
    finally:
        writer._session_writer.stop(drain_timeout=5.0)
