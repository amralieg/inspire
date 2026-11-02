"""v1.2.0 DOCS-404 lane: a transient HTTP 500 on the startup workspace mkdirs skipped the
notebook and docs folders, and the docs artifact writers imported into a parent that was never
created, so a SUCCESS run (accuweather_high_fb2, run 123456789000028) wrote zero documents with
six HTTP 404 RESOURCE_DOES_NOT_EXIST failures. These tests reproduce that exact sequence with
fakes, prove the startup mkdirs and every docs writer now recreate their parent with a bounded
retry, prove a normal write stays within a bounded number of calls, and lock the loud-failure
reporting so a run with missing documents can never look clean.
"""
import base64
import types

import pytest

from v120_artifacts_support import make_inspire, make_uc


class FakeWorkspaceFS:
    """A workspace that models parent-folder existence the way the real import API does: an
    import whose parent folder was never created raises RESOURCE_DOES_NOT_EXIST, exactly the
    404 the live run hit. `fail_mkdirs_on` fails a given path's mkdirs a chosen number of times
    to reproduce the transient HTTP 500 that skipped the later directories."""

    def __init__(self, existing_dirs=(), fail_mkdirs_on=None, fail_mkdirs_times=0):
        self.dirs = set()
        self.files = {}
        self.mkdirs_calls = []
        self.import_calls = []
        self._fail_mkdirs_on = dict(fail_mkdirs_on or {})
        self._fail_mkdirs_times = fail_mkdirs_times
        self._mkdirs_fail_used = 0
        for directory in existing_dirs:
            self._add_dir(directory)

    def _add_dir(self, path):
        current = ""
        for part in str(path).strip("/").split("/"):
            current = current + "/" + part
            self.dirs.add(current)

    def mkdirs(self, path):
        self.mkdirs_calls.append(path)
        if self._fail_mkdirs_on.get(path, 0) > 0:
            self._fail_mkdirs_on[path] -= 1
            raise RuntimeError("INTERNAL_ERROR: Error handling request")
        if self._mkdirs_fail_used < self._fail_mkdirs_times:
            self._mkdirs_fail_used += 1
            raise RuntimeError("INTERNAL_ERROR: Error handling request")
        self._add_dir(path)

    def import_(self, path, content, format=None, overwrite=True):
        self.import_calls.append(path)
        parent = path.rsplit("/", 1)[0]
        if parent not in self.dirs:
            raise RuntimeError(
                "RESOURCE_DOES_NOT_EXIST: The parent folder (%s) does not exist." % parent)
        self.files[path] = base64.b64decode(content)

    def get_status(self, path):
        if path in self.files or path in self.dirs:
            return types.SimpleNamespace(path=path, object_id=1)
        raise RuntimeError("RESOURCE_DOES_NOT_EXIST")


@pytest.fixture
def docs_ns(agent_ns, monkeypatch):
    monkeypatch.setattr(agent_ns["workspace"], "ImportFormat",
                        types.SimpleNamespace(AUTO="AUTO"), raising=False)
    monkeypatch.setattr("time.sleep", lambda *a, **k: None)
    return agent_ns


def _with_fs(ns, fs, **attrs):
    obj = make_inspire(ns, **attrs)
    obj.w_client = types.SimpleNamespace(workspace=fs, config=types.SimpleNamespace(host=""))
    return obj


OUT = "/Workspace/out"
DOCS = OUT + "/docs"
NOTEBOOKS = OUT + "/notebooks"
SESSION = OUT
BASE = OUT


def test_import_helper_creates_missing_parent_then_writes(docs_ns):
    fs = FakeWorkspaceFS(existing_dirs=[NOTEBOOKS])
    obj = _with_fs(docs_ns, fs)
    target = DOCS + "/Acme-dbx_inspire.json"
    obj._import_workspace_file(target, base64.b64encode(b"{}").decode(), docs_ns["workspace"].ImportFormat.AUTO)
    assert target in fs.files
    assert DOCS in fs.dirs


def test_import_helper_stays_bounded_when_parent_exists(docs_ns):
    fs = FakeWorkspaceFS(existing_dirs=[DOCS])
    obj = _with_fs(docs_ns, fs)
    target = DOCS + "/Acme.csv"
    obj._import_workspace_file(target, base64.b64encode(b"a,b").decode(), docs_ns["workspace"].ImportFormat.AUTO)
    assert fs.import_calls == [target]
    assert fs.mkdirs_calls == [DOCS]


def test_mkdirs_retry_recovers_from_transient_500(docs_ns):
    fs = FakeWorkspaceFS(fail_mkdirs_on={DOCS: 2})
    obj = _with_fs(docs_ns, fs)
    obj._workspace_mkdirs_with_retry(DOCS, base_delay=0)
    assert DOCS in fs.dirs
    assert len(fs.mkdirs_calls) == 3


def test_mkdirs_retry_is_bounded_and_reraises_when_persistent(docs_ns):
    fs = FakeWorkspaceFS(fail_mkdirs_on={DOCS: 99})
    obj = _with_fs(docs_ns, fs)
    with pytest.raises(RuntimeError, match="Error handling request"):
        obj._workspace_mkdirs_with_retry(DOCS, attempts=4, base_delay=0)
    assert len(fs.mkdirs_calls) == 4


def test_ensure_output_directories_recovers_from_transient_on_session(docs_ns):
    fs = FakeWorkspaceFS(fail_mkdirs_on={SESSION: 1})
    obj = _with_fs(docs_ns, fs, base_output_dir=BASE, session_output_dir=SESSION,
                   notebook_output_dir=NOTEBOOKS, docs_output_dir=DOCS)
    obj._ensure_output_directories()
    assert DOCS in fs.dirs and NOTEBOOKS in fs.dirs


def test_ensure_output_directories_still_makes_docs_when_one_dir_fails_persistently(docs_ns):
    fs = FakeWorkspaceFS(fail_mkdirs_on={SESSION: 99})
    obj = _with_fs(docs_ns, fs, base_output_dir=BASE, session_output_dir=SESSION,
                   notebook_output_dir=NOTEBOOKS, docs_output_dir=DOCS)
    obj._ensure_output_directories()
    assert DOCS in fs.dirs and NOTEBOOKS in fs.dirs
    assert obj.logger.matching("could not be pre-created", level="WARNING")


def test_csv_writer_recovers_the_missing_docs_folder(docs_ns):
    fs = FakeWorkspaceFS(existing_dirs=[NOTEBOOKS])
    obj = _with_fs(docs_ns, fs)
    obj._normalize_usecase = lambda usecase, name: usecase
    obj._generate_csv_catalog("English", "en", {"Sales": [make_uc("N01-U01")]})
    assert any(path.startswith(DOCS) and path.endswith(".csv") for path in fs.files)


def test_markdown_writer_recovers_the_missing_docs_folder(docs_ns):
    fs = FakeWorkspaceFS(existing_dirs=[NOTEBOOKS])
    obj = _with_fs(docs_ns, fs)
    obj._generate_markdown_catalog("English", "en", {"Sales": [make_uc("N01-U01")]}, {"Executive": "<p>x</p>"}, "Acme")
    assert any(path.startswith(DOCS) and path.endswith(".md") for path in fs.files)


def test_every_docs_writer_routes_through_the_parent_ensuring_helper(agent_ns):
    import ast
    from _agentload import method_node

    def direct_imports(method):
        node = method_node("DatabricksInspire", method)
        return [n for n in ast.walk(node)
                if isinstance(n, ast.Call)
                and isinstance(n.func, ast.Attribute) and n.func.attr == "import_"]

    def routes(method):
        node = method_node("DatabricksInspire", method)
        return any(isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                   and n.func.attr == "_import_workspace_file" for n in ast.walk(node))

    for method in ("generate_catalog_pdf", "generate_presentation_pptx", "_save_excel",
                   "_generate_markdown_catalog", "_generate_csv_catalog",
                   "_save_usecases_catalog_json", "_upload_log_file", "_write_genie_agents_file"):
        assert not direct_imports(method), method
        assert routes(method), method


def test_startup_no_longer_imports_four_bare_mkdirs(agent_ns):
    import ast
    from _agentload import method_node
    init = method_node("DatabricksInspire", "__init__")
    bare = [n for n in ast.walk(init)
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "mkdirs"]
    assert bare == []
    calls_ensure = any(isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                       and n.func.attr == "_ensure_output_directories" for n in ast.walk(init))
    assert calls_ensure


class _FakeAtomicWriter:
    def __init__(self):
        self.finalized = []

    def emit_step(self, **kwargs):
        return 1

    def flush_pending(self, **kwargs):
        return None

    def finalize_pipeline(self, message, final_results_json, pipeline_start_step_id, status):
        self.finalized.append({"message": message, "status": status})


def test_failed_docs_surface_loudly_in_outcome_and_finalize(docs_ns):
    obj = make_inspire(docs_ns)
    obj._metadata_unavailable_report = lambda: {"tables": []}
    obj._record_failed_step("PDF Catalog", "English", RuntimeError("parent folder docs does not exist"))
    warnings = obj._run_outcome_warnings()
    assert any("1 artifact step failed" in w for w in warnings)
    assert obj._report_run_completion("ok", "COMPLETED WITH WARNINGS") is False
    writer = _FakeAtomicWriter()
    obj.atomic_writer = writer
    obj.finalize_atomic_writer(success=True)
    assert writer.finalized and writer.finalized[-1]["status"] == "ended_warning"
