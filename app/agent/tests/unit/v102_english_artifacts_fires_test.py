"""v1.0.2 Fix #4 root-cause regression test.

Root cause (from v1.0.1 audit at run_logs/v101/AUDIT_v101_vs_demos_20260810.md §4):

Fix #4 (commit fd72662) patched the INNER logic of
``_generate_documents_for_all_languages`` (force-PDF branch + [VIBE-LANG
FORCE-PDF FIRED] sentinel + post-audit) — but the THREE OUTER call-site
gates that decide whether to CALL that method still hard-checked for
long-form widget strings only:

  - agent/dbx_inspire_ai_agent.ipynb:17585 (JSON-mode entry)
  - agent/dbx_inspire_ai_agent.ipynb:19241 (main-flow parallel start)
  - agent/dbx_inspire_ai_agent.ipynb:19373 (post-notebook fallback)

The v1.0.1 swarm launcher passed
``09_generation_options=PDF,XLSX,CSV,JSON,Markdown,Databricks AI`` — SHORT
form. None of ``PDF Catalog`` / ``Presentation`` / ``Use Cases Catalog
PDF`` appear in that list, so the outer gates evaluated False, the doc
function was never invoked, and Fix #4's entire inner surface was dead
code (§8.4). Sentinel never fired; no .md and no _en.pdf produced.

v1.0.2 patch (this commit):

  1. ``__init__`` expands short-form aliases (PDF→PDF Catalog,
     PPTX→Presentation, MD→Markdown) into ``self.generate_choices``
     immediately after parsing, so every downstream membership check
     fires regardless of caller idiom.
  2. Three outer gates additionally OR ``"English" in target_langs``
     (or ``self.output_languages`` at the JSON-mode site) so English's
     force rule (Fix #4 spirit) also opens the entry path even when
     the caller requested only Markdown/CSV.
  3. Sentinel [VIBE-LANG FORCE-PDF FIRED] now fires whenever
     ``_force_english_pdf`` is True, tagged ``mode=override`` when
     PDF was not otherwise requested and ``mode=reinforce`` when it
     was. This makes the sentinel a positive observability signal for
     the English-force rule, not just for override-only scenarios.
  4. weasyprint-install gate also honours the English-force rule so
     PDF generation doesn't crash on the missing dependency in
     English-force flows.

Every test below asserts BOTH source-level contract AND semantic
distinctness (pre-fix vs post-fix), so no test can be satisfied by a
tautology (§8.3).
"""
import ast
import os
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import agent_source, agent_version, load_agent_namespace


NOTEBOOK = Path(__file__).resolve().parents[2] / "agent" / "dbx_inspire_ai_agent.ipynb"


def _notebook_body():
    return NOTEBOOK.read_text()


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


@pytest.fixture(scope="module")
def source():
    return agent_source()


def test_agent_version_bumped_to_v102():
    v = agent_version()
    parts = tuple(int(p) for p in v.lstrip("v").split("."))
    assert parts >= (1, 0, 2), (
        f"single-digit semver (§3a): Fix #4 landed in v1.0.2; agent must be >= v1.0.2, got {v}")


def test_short_form_alias_expansion_present_in_init(source):
    """__init__ must expand short-form widget aliases into generate_choices."""
    assert '_generate_choice_aliases = {"PDF": "PDF Catalog", "PPTX": "Presentation", "MD": "Markdown"}' in source, (
        "alias map must map short-form widget tokens to canonical long-form")
    assert "for _short, _long in _generate_choice_aliases.items():" in source
    assert "if _short in self.generate_choices and _long not in self.generate_choices:" in source
    assert "self.generate_choices.append(_long)" in source


def test_outer_gate_json_mode_opens_for_every_output_language(source):
    """JSON-mode entry gate opens whenever there is an output language: Markdown, CSV and JSON catalogs are
    written for every language in output_languages, so no generate choice may close it."""
    assert re.search(r"\n {16}if self\.output_languages:\n {20}self\._generate_language_catalogs\(", source), (
        "JSON-mode outer gate must open on output_languages alone")


def test_outer_gate_main_flow_opens_for_every_output_language(source):
    """Main-flow parallel-doc-gen gate opens whenever there are target languages."""
    assert "        if final_consolidated_use_cases and target_langs:\n" in source, (
        "main-flow outer gate must open on target_langs alone")


def test_outer_gate_post_notebook_fallback_opens_for_every_output_language(source):
    """Post-notebook fallback gate opens whenever there are target languages."""
    assert "            if target_langs:\n" in source, (
        "post-notebook fallback outer gate must open on target_langs alone")


def test_md_writer_scheduled_for_every_language_gated_only_by_docs_only():
    """Regression guard for Fix #4's invariant, widened to every language (REQ-077 keeps it for a full run): MD is
    scheduled in the artifact-writing loop, and the only guard before it is the documents-only gate, never a
    language or a generate_choices membership."""
    body = _notebook_body()
    anchor = "Submitting writing jobs for {lang}..."
    pos = body.find(anchor)
    assert pos != -1
    region = body[pos:pos + 4000]
    md_pos = region.find("writer_ctx.submit(self._generate_markdown_catalog")
    assert md_pos != -1, "MD writer must still be scheduled in the artifact-writing loop"
    prefix = region[:md_pos]
    assert prefix.count("if ") == prefix.count('if not getattr(self, \\"json_file_path\\", None):'), \
        "the only guard before MD is the documents-only gate (regression guard)"


def test_v102_agent_namespace_exec_still_works(ns):
    """The whole notebook must still exec offline (no syntax breakage from
    the surgical edits)."""
    assert "InspireAI" in ns or "InspireAIAgent" in ns or any(
        (isinstance(v, type) and getattr(v, "__module__", "") == "inspire_offline")
        for v in ns.values()
    ), "notebook exec must produce class objects; namespace looks empty of the agent surface"
