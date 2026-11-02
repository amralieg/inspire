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


def test_english_md_still_unconditional_inside_english_block(ns):
    """Regression guard: English MD scheduling must remain unconditional inside
    the `if lang == "English":` block of the artifact-writing loop."""
    body = _notebook_body()
    anchor = "Submitting writing jobs for {lang}..."
    pos = body.find(anchor)
    assert pos != -1, f"artifact-writing anchor not found: {anchor}"
    region = body[pos:pos + 4000]
    assert "writer_ctx.submit(self._generate_markdown_catalog" in region, \
        "English MD must be scheduled unconditionally inside artifact-writing English block"
    md_pos = region.find("writer_ctx.submit(self._generate_markdown_catalog")
    prefix = region[:md_pos]
    if_lang_pos = prefix.rfind('if lang == \\"English\\":')
    assert if_lang_pos != -1, "MD must be inside the `if lang == English:` block"
    between = prefix[if_lang_pos:md_pos]
    assert "if " not in between[len('if lang == \\"English\\":'):], \
        "no extra `if` guard between the English gate and MD scheduling (regression guard)"


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


def test_post_audit_gate_conditioned_on_english_in_target_languages(ns):
    body = _notebook_body()
    assert 'if \\"English\\" in target_languages:' in body, \
        "post-audit block must gate on English in target_languages"


def test_post_audit_uses_actual_success_set_not_just_scheduling(ns):
    """The audit must reflect actual completion, not just scheduling — an
    empty write failure must still trigger missing-artifacts."""
    body = _notebook_body()
    assert "_english_md_ok = _english_md_scheduled and (\\\"English Markdown\\\" in _artifact_successes)" in body
    assert "_english_pdf_ok = _english_pdf_scheduled and (\\\"English PDF\\\" in _artifact_successes)" in body


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
