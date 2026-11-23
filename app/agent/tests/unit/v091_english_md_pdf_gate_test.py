"""Fix #4: English Markdown and CSV are ALWAYS produced when English is in output_languages.

FX-116: the PDF branch, the force-PDF flag and the English PDF gate no longer exist (documents come from the
Generate docs wizard). What stays is the invariant the fix protected: the writers are gated by the languages and the
documents-only mode only, and the post-write audit covers every target language from the actual success set.
"""
import re
import sys
import os
from pathlib import Path

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import load_agent_namespace


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def _notebook_body():
    return (Path(__file__).resolve().parents[2] / "agent" / "dbx_inspire_ai_agent.ipynb").read_text()


def test_vibe_lang_force_pdf_sentinel_is_gone(ns):
    body = _notebook_body()
    assert "[VIBE-LANG FORCE-PDF FIRED]" not in body, \
        "FX-116: the force-PDF branch is removed, so its sentinel must not be emitted"


def test_md_and_csv_are_scheduled_for_every_language_gated_only_by_docs_only(ns):
    """REQ-077 (documents on demand): Markdown and CSV are scheduled for every language of a full run. The only guard
    before them is the documents-only gate, never a language or choice gate."""
    body = _notebook_body()
    anchor = "Submitting writing jobs for {lang}..."
    pos = body.find(anchor)
    assert pos != -1, f"artifact-writing anchor not found: {anchor}"
    region = body[pos:pos + 4000]
    md_pos = region.find("writer_ctx.submit(self._generate_markdown_catalog")
    csv_pos = region.find("writer_ctx.submit(self._generate_csv_catalog")
    assert md_pos != -1 and csv_pos != -1, "Markdown and CSV must be scheduled in the artifact-writing loop"
    prefix = region[:max(md_pos, csv_pos)]
    assert prefix.count("if ") == prefix.count('if not getattr(self, \\"json_file_path\\", None):'), \
        "the only guard before Markdown and CSV is the documents-only gate, never a language or choice gate"


def test_docs_only_run_schedules_no_markdown_or_csv_and_a_full_run_schedules_both_for_every_language(ns):
    """REQ-077: the artifact checker expects exactly what the writing loop schedules. A documents-only run builds only
    the picked documents, so it must not expect Markdown or CSV (a gap would be recorded for files never written)."""
    Klass = ns["DatabricksInspire"]
    obj = Klass.__new__(Klass)

    def steps(language):
        return [step for _suffix, step in obj._requested_language_artifacts(language)]

    obj.json_file_path = None
    assert steps("English") == ["Markdown Catalog", "CSV Catalog"]
    assert steps("Arabic") == ["Markdown Catalog", "CSV Catalog", "JSON Catalog"]
    obj.json_file_path = "/Workspace/out/docs/Acme-dbx_inspire.json"
    assert steps("English") == []
    assert steps("Arabic") == ["JSON Catalog"]


def test_artifact_successes_set_declared(ns):
    body = _notebook_body()
    assert "_artifact_successes = set()" in body, \
        "successes tracking set must exist"
    assert "_artifact_successes.add(job_name)" in body, \
        "successful futures must be added to _artifact_successes"


def test_vibe_lang_all_artifacts_produced_sentinel(ns):
    body = _notebook_body()
    assert "[VIBE-LANG all-artifacts-produced]" in body, \
        "success sentinel [VIBE-LANG all-artifacts-produced] must be logged"


def test_vibe_lang_missing_artifacts_sentinel(ns):
    body = _notebook_body()
    assert "[VIBE-LANG missing-artifacts]" in body, \
        "failure sentinel [VIBE-LANG missing-artifacts] must be logged"


def test_post_audit_covers_every_target_language(ns):
    body = _notebook_body()
    assert "self._check_language_artifacts(target_languages, scheduled_jobs, _artifact_successes, pack_failures)" in body, \
        "post-audit must check every target language, not English only"


def test_post_audit_uses_actual_success_set_not_just_scheduling(ns):
    """The audit must reflect actual completion, not just scheduling: a
    scheduled writer that failed is still a missing artifact."""
    from v120_artifacts_support import make_inspire
    obj = make_inspire(ns, generate_choices=[])
    obj._emit_pipeline_status = lambda **kw: 1
    gaps = obj._check_language_artifacts(["English"], {"English Markdown", "English CSV"}, {"English CSV"})
    assert gaps == {"English": ["Markdown Catalog"]}
    assert obj.logger.matching("[VIBE-LANG missing-artifacts] language=English", level="WARNING")


def test_docs_only_mode_reuses_the_catalog_writer_path(ns):
    """Contract: the docs-only-mode caller (line 19107 area) uses the same
    _generate_language_catalogs, so the fix covers it automatically.
    Verify the method signature accepts `languages=`."""
    body = _notebook_body()
    assert re.search(
        r'def _generate_language_catalogs\(self, final_consolidated_use_cases: list, english_grouped_data: dict = None, summary_dict: dict = None, languages: list = None',
        body,
    ), "signature must retain `languages=` so docs-only-mode reuses the same code path"

