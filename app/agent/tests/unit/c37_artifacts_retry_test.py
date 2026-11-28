"""c37_artifacts_retry (R3.6, U4): the Implement run keeps the pending artifacts that failed and reuses the saved executive summary.

Only the discover_inline_artifacts False path (c36_artifacts) is in scope. Contract the tests pin:
* F1. DatabricksInspire._produce_pending_artifacts records, through AtomicWriter.record_pending_artifacts, the pending entries
  still not produced: an entry whose writer raised (the docs writer _generate_language_catalogs) or reported failure (a use
  case whose notebook write left notebook_status "write_failed") stays; every produced entry is removed. The run does not
  raise and logs a WARNING (self.logger) that names the failed kinds. When everything is produced the recorded list is [].
* F2. When Discover already saved the executive summary, Implement passes it to the docs writer instead of summary_dict=None,
  so SUMMARY_GEN_PROMPT is not called for English during Implement. The base saves it in two places, both planted here with
  the same text: the session row results_json (AtomicWriter.record_results, from _record_executive_summary and the
  completion write) and the English catalog JSON <docs_output_dir>/<business_name>-dbx_inspire.json
  (_save_usecases_catalog_json, read back by _load_usecases_catalog_json). Both carry executive_summary and
  domains[].summary. With no saved summary Implement still generates one.

Harness: c36_artifacts_test (itself on v120_run_offline_smoke_test) runs DatabricksInspire.run() offline; _load_pending_artifacts
is a double returning (pending, saved) as in c36 test_2.
"""
import copy
import json
import logging
import os
import sys
import types

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from c36_artifacts_test import _discover, _make, quiet_root_logger  # noqa: E402,F401

SUMMARY_PROMPT = "SUMMARY_GEN_PROMPT"
SAVED_EXECUTIVE = "Saved executive summary: the portfolio turns the existing tables into weekly decisions for every site."
FRESH_EXECUTIVE = "Freshly generated executive summary for the Implement run."
SESSION_TABLE = "inspire_db.__inspire_session"


def _key(item):
    return (item["kind"], item.get("use_case_id"))


class _WarningCapture(logging.Handler):
    def __init__(self):
        super().__init__(logging.WARNING)
        self.messages = []

    def emit(self, record):
        self.messages.append(record.getMessage())


def _deferred(ns, tmp_path, monkeypatch):
    """Pending entries and saved use cases from a real flag-False Discover run."""
    obj = _discover(ns, tmp_path / "deferred", monkeypatch, False)
    assert obj.rec.pending and obj.rec.pending[-1], "fixture sanity: flag false Discover must record pending artifacts"
    return copy.deepcopy(obj.rec.pending[-1]), copy.deepcopy(obj.recorded["tracking"][-1])


def _implement(ns, tmp_path, pending, saved):
    impl = _make(ns, tmp_path / "impl", operation=ns["IMPLEMENT_OPERATION"])
    impl.inspire_database = "inspire_db"
    impl._ensure_inspire_database_exists = lambda: None
    impl._create_tracking_table = lambda: None
    impl._load_feedback = lambda: None
    impl._implement_targets = lambda: []
    impl._implement_requested_row = lambda: None
    impl._load_pending_artifacts = lambda: (copy.deepcopy(pending), copy.deepcopy(saved))
    capture = _WarningCapture()
    impl.logger.addHandler(capture)
    impl.warnings = capture
    return impl


def _run(impl):
    try:
        impl.run()
    except Exception as err:
        pytest.fail(f"the Implement run must not raise when a pending artifact fails: {type(err).__name__}: {str(err)[:200]}")
    finally:
        impl.logger.removeHandler(impl.warnings)
    assert impl.rec.pending, "Implement must record the session's pending_artifacts"
    return impl.rec.pending[-1]


def _warned_kinds(impl, kinds):
    return any(all(kind in message for kind in kinds) for message in impl.warnings.messages)


def test_a_docs_writer_raises_keeps_docs_and_translation(agent_ns, tmp_path, monkeypatch, quiet_root_logger):
    pending, saved = _deferred(agent_ns, tmp_path, monkeypatch)
    want = sorted(_key(i) for i in pending if i["kind"] in ("docs", "translation"))
    assert want == [("docs", None), ("translation", None)], f"fixture sanity: {pending}"
    impl = _implement(agent_ns, tmp_path, pending, saved)

    def docs_raise(*a, **kw):
        impl.rec.call("_generate_language_catalogs")
        raise RuntimeError("docs writer failed")

    impl._generate_language_catalogs = docs_raise
    recorded = _run(impl)
    assert any(c["name"] == "_generate_language_catalogs" for c in impl.rec.calls), "the docs writer must have been tried"
    assert sorted(_key(i) for i in recorded) == want, \
        f"the docs writer raised: exactly the docs and translation entries must stay pending, got {recorded}"
    assert _warned_kinds(impl, ("docs", "translation")), \
        f"a WARNING must name the failed kinds docs and translation: {impl.warnings.messages[-5:]}"


def test_b_one_notebook_write_fails_keeps_only_that_notebook(agent_ns, tmp_path, monkeypatch, quiet_root_logger):
    pending, saved = _deferred(agent_ns, tmp_path, monkeypatch)
    notebook_ids = sorted(i["use_case_id"] for i in pending if i["kind"] == "notebook")
    genie_ids = {i["use_case_id"] for i in pending if i["kind"] == "genie_instructions"}
    failing = next(uc_id for uc_id in notebook_ids if uc_id not in genie_ids)
    impl = _implement(agent_ns, tmp_path, pending, saved)
    skeleton, genie = impl._assemble_skeleton_notebook, impl._assemble_genie_code_notebook

    def fail_for(writer):
        def write(uc, *a):
            if str(uc.get("No")) == failing:
                raise RuntimeError("workspace import failed")
            return writer(uc, *a)
        return write

    impl._assemble_skeleton_notebook = fail_for(skeleton)
    impl._assemble_genie_code_notebook = fail_for(genie)
    recorded = _run(impl)
    written = {nb[0] for nb in impl.rec.notebooks}
    assert set(notebook_ids) - {failing} <= written, "fixture sanity: the other notebooks must be written"
    assert [_key(i) for i in recorded] == [("notebook", failing)], \
        f"only the notebook of {failing} failed, so only that entry stays pending, got {recorded}"
    assert _warned_kinds(impl, ("notebook",)), f"a WARNING must name the failed kind notebook: {impl.warnings.messages[-5:]}"


def test_c_everything_succeeds_records_empty_list(agent_ns, tmp_path, monkeypatch, quiet_root_logger):
    pending, saved = _deferred(agent_ns, tmp_path, monkeypatch)
    impl = _implement(agent_ns, tmp_path, pending, saved)
    recorded = _run(impl)
    assert recorded == [], f"everything was produced: pending_artifacts must be [], got {recorded}"


class _AnyRow(dict):
    """A collected row that answers any column name or index with the stored results JSON text."""

    def __init__(self, text):
        super().__init__()
        self.text = text

    def __getitem__(self, key):
        return self.text

    def __missing__(self, key):
        return self.text

    def get(self, key, default=None):
        return self.text

    def asDict(self, recursive=False):
        return _AnyRow(self.text)


class _SessionSpark:
    """Serves the session row's results_json to any query that reads it; every other query returns no rows."""

    def __init__(self, results):
        self.results = results
        self.sql_text = []

    def sql(self, text, *a, **kw):
        flat = " ".join(str(text).split())
        self.sql_text.append(flat)
        rows = [_AnyRow(json.dumps(self.results))] if self.results is not None and "results_json" in flat else []
        return types.SimpleNamespace(collect=lambda: list(rows), first=lambda: rows[0] if rows else None)


def _summary_implement(ns, tmp_path, monkeypatch, saved_summary):
    _pending, saved = _deferred(ns, tmp_path, monkeypatch)
    impl = _implement(ns, tmp_path, [{"kind": "docs", "use_case_id": None}], saved)
    impl.output_languages = ["English"]
    domains = sorted({str(uc.get("Business Domain")) for uc in saved})
    domain_summaries = {d: f"Saved summary of the {d} domain: what its use cases change each week." for d in domains}
    catalog = None
    if saved_summary:
        catalog = {"title": f"{impl.business_name} Use Cases Catalog", "business_name": impl.business_name,
                   "language": "English", "executive_summary": SAVED_EXECUTIVE,
                   "domains": [{"domain_name": d, "summary": domain_summaries[d],
                                "use_cases": [{"id": str(uc.get("No")), "title": uc.get("Name")} for uc in saved
                                              if str(uc.get("Business Domain")) == d]} for d in domains],
                   "column_registry": {}, "table_registry": {}}
    impl.spark = _SessionSpark(catalog)
    impl.atomic_writer.enabled = True
    impl.atomic_writer.session_table = SESSION_TABLE
    impl.atomic_writer.session_id = impl.session_id
    impl.atomic_writer.ailogs_table = "inspire_db._ailogs"
    impl.atomic_writer.emit_ailog = lambda row: None
    impl.docs_output_dir = str(tmp_path / "docs")
    impl.w_client = None
    catalog_path = os.path.join(impl.docs_output_dir, f"{impl.business_name}-dbx_inspire.json")

    def read_text(path, w_client=None):
        if catalog is not None and os.path.normpath(str(path)) == os.path.normpath(catalog_path):
            return json.dumps(catalog)
        raise FileNotFoundError(path)

    monkeypatch.setitem(ns, "read_user_text_file", read_text)

    impl.__dict__.pop("_generate_language_catalogs", None)
    impl.__dict__.pop("_get_salesy_summary", None)
    asked = []
    base_worker = impl.ai_agent.run_worker

    def run_worker(step_name, worker_prompt_path, prompt_vars, response_schema=None, **kw):
        if worker_prompt_path == SUMMARY_PROMPT:
            asked.append(prompt_vars.get("output_language"))
            rows = [f'"Executive","{FRESH_EXECUTIVE}"'] + [f'"{d}","Fresh summary of {d}."' for d in domains]
            return '"Type","Summary"\n' + "\n".join(rows)
        return base_worker(step_name, worker_prompt_path, prompt_vars, response_schema, **kw)

    impl.ai_agent.run_worker = run_worker
    received = []
    impl._generate_markdown_catalog = lambda lang, abbr, grouped, summary_dict, name, translations=None: received.append(
        (lang, copy.deepcopy(summary_dict)))
    impl._generate_csv_catalog = lambda *a, **kw: None
    impl._generate_json_catalog = lambda *a, **kw: None
    return impl, asked, received, domain_summaries


def test_d_implement_reuses_the_saved_executive_summary(agent_ns, tmp_path, monkeypatch, quiet_root_logger):
    impl, asked, received, domain_summaries = _summary_implement(agent_ns, tmp_path, monkeypatch, saved_summary=True)
    _run(impl)
    english = [s for lang, s in received if lang == "English"]
    assert english, "fixture sanity: the English docs writer must run during Implement"
    assert asked.count("English") == 0, \
        f"Discover saved the executive summary: Implement must not call {SUMMARY_PROMPT} for English again ({asked})"
    summary = english[-1] or {}
    assert summary.get("Executive") == SAVED_EXECUTIVE, \
        f"the docs writer must receive the saved executive summary, got {str(summary.get('Executive'))[:120]!r}"
    for domain, text in domain_summaries.items():
        assert summary.get(domain) == text, f"the docs writer must receive the saved summary of domain {domain}"


def test_e_no_saved_summary_still_generates_one(agent_ns, tmp_path, monkeypatch, quiet_root_logger):
    impl, asked, received, _domains = _summary_implement(agent_ns, tmp_path, monkeypatch, saved_summary=False)
    _run(impl)
    english = [s for lang, s in received if lang == "English"]
    assert english, "fixture sanity: the English docs writer must run during Implement"
    assert asked.count("English") == 1, f"no saved summary: Implement must generate the English summary once ({asked})"
    assert FRESH_EXECUTIVE in str((english[-1] or {}).get("Executive") or ""), \
        "the docs writer must receive the generated executive summary"
