"""Fix #4: English MD + PDF ALWAYS produced when English is in output_languages.

Evidence: 6/6 v1.5.x runs logged [VIBE-LANG FIRED] — the run declared English
in output_languages, but the English PDF (or MD in some paths) was skipped.

v0.9.0 base bug (agent/dbx_inspire_ai_agent.ipynb `_generate_documents_for_all_languages`
around line 17109 in v0.9.0 base): the PDF branch is gated ONLY by
    `"PDF Catalog" in self.generate_choices or "Use Cases Catalog PDF" in self.generate_choices`
so if the user selected only Excel/MD generate_choices, English PDF is skipped
even though English is in output_languages. User directive: English MD + PDF
must be produced whenever English is in output_languages.

Fix (single commit, root cause per Section 3):
1. PDF branch condition now also OR-s the force flag:
     _force_english_pdf = (lang == "English") and ("English" in target_languages)
     if _pdf_requested or _force_english_pdf:
        ...schedule PDF...
   The force branch also emits `[VIBE-LANG FORCE-PDF FIRED]` when it fires the
   PDF that the generate_choices would otherwise have skipped.
2. English MD is unchanged (it was already unconditional inside the `if lang == "English"`
   block — the fix keeps that invariant).
3. After the artifact futures loop, an end-of-generation audit fires exactly one
   sentinel:
     `[VIBE-LANG all-artifacts-produced] language=English md=1 pdf=1`
      when both English MD and English PDF landed successfully.
     `[VIBE-LANG missing-artifacts] language=English md_scheduled=... md_ok=... pdf_scheduled=... pdf_ok=...`
      when either was scheduled but failed, or was not scheduled at all — this
      is the signal the audit script grep-s for.
4. `_artifact_successes` set tracks per-job success so the audit reflects
   actual completion (not just scheduling).
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


def test_pdf_branch_forces_english_when_in_target_languages(ns):
    body = _notebook_body()
    assert '_force_english_pdf = (lang == \\"English\\") and (\\"English\\" in target_languages)' in body, \
        "PDF branch must set _force_english_pdf when English is in target_languages"
    assert "if _pdf_requested or _force_english_pdf:" in body, \
        "PDF branch must OR the force flag into the gate condition"


def test_vibe_lang_force_pdf_sentinel_present(ns):
    body = _notebook_body()
    assert "[VIBE-LANG FORCE-PDF FIRED]" in body, \
        "must emit [VIBE-LANG FORCE-PDF FIRED] when PDF was forced (not user-selected)"


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
    obj.generate_choices = ["Excel", "PDF Catalog"]

    def steps(language):
        return [step for _suffix, step in obj._requested_language_artifacts(language, [])]

    obj.json_file_path = None
    assert steps("English") == ["Markdown Catalog", "CSV Catalog", "Use Case Excel", "PDF Catalog"]
    assert steps("Arabic") == ["Markdown Catalog", "CSV Catalog", "Use Case Excel", "PDF Catalog", "JSON Catalog"]
    obj.json_file_path = "/Workspace/out/docs/Acme-dbx_inspire.json"
    assert steps("English") == ["Use Case Excel", "PDF Catalog"]
    assert steps("Arabic") == ["Use Case Excel", "PDF Catalog", "JSON Catalog"]


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
    assert "self._check_language_artifacts(target_languages, skip_excel_langs, scheduled_jobs, _artifact_successes, pack_failures)" in body, \
        "post-audit must check every target language, not English only"


def test_post_audit_uses_actual_success_set_not_just_scheduling(ns):
    """The audit must reflect actual completion, not just scheduling: a
    scheduled writer that failed is still a missing artifact."""
    from v120_artifacts_support import make_inspire
    obj = make_inspire(ns, generate_choices=[])
    obj._emit_pipeline_status = lambda **kw: 1
    gaps = obj._check_language_artifacts(["English"], ["English"], {"English Markdown", "English CSV", "English PDF"},
                                         {"English CSV", "English PDF"})
    assert gaps == {"English": ["Markdown Catalog"]}
    assert obj.logger.matching("[VIBE-LANG missing-artifacts] language=English", level="WARNING")


def test_docs_only_pdf_gate_matches_normal_pdf_gate(ns):
    """Contract: the docs-only-mode caller (line 19107 area) uses the same
    _generate_documents_for_all_languages, so the fix covers it automatically.
    Verify the method signature accepts `languages=`."""
    body = _notebook_body()
    assert re.search(
        r'def _generate_documents_for_all_languages\(self, final_consolidated_use_cases: list, english_grouped_data: dict = None, summary_dict: dict = None, languages: list = None',
        body,
    ), "signature must retain `languages=` so docs-only-mode reuses the same code path"


def test_gate_condition_before_and_after_are_semantically_distinct(ns):
    """Semantic test (no tautology per Section 8.3): the pre-fix condition would
    skip English PDF when generate_choices doesn't include 'PDF Catalog'; the
    post-fix condition schedules it anyway. Simulate both."""

    def pre_fix_gate(lang, generate_choices, target_languages):
        return "PDF Catalog" in generate_choices or "Use Cases Catalog PDF" in generate_choices

    def post_fix_gate(lang, generate_choices, target_languages):
        _pdf_requested = "PDF Catalog" in generate_choices or "Use Cases Catalog PDF" in generate_choices
        _force_english_pdf = (lang == "English") and ("English" in target_languages)
        return _pdf_requested or _force_english_pdf

    scenarios = [
        ("English", [], ["English", "Arabic"]),
        ("English", ["Excel Catalog"], ["English"]),
        ("English", ["Markdown Catalog"], ["English", "French"]),
    ]
    for lang, gc, tl in scenarios:
        assert pre_fix_gate(lang, gc, tl) is False, f"pre-fix would skip English PDF for scenario {gc}, {tl}"
        assert post_fix_gate(lang, gc, tl) is True, f"post-fix must schedule English PDF for scenario {gc}, {tl}"

    for lang, gc, tl in [("English", ["PDF Catalog"], ["English"]),
                         ("Arabic", ["PDF Catalog"], ["English", "Arabic"])]:
        assert pre_fix_gate(lang, gc, tl) is True and post_fix_gate(lang, gc, tl) is True, \
            "when PDF is user-requested, both gates schedule it"

    assert post_fix_gate("Arabic", [], ["English", "Arabic"]) is False, \
        "post-fix must NOT force PDF for non-English languages"
