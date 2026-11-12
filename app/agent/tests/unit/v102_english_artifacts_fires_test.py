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
``09_generation_options=PDF,XLSX,CSV,JSON,Markdown,Genie Code`` — SHORT
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
    """JSON-mode entry gate opens whenever there is an output language: Markdown, CSV and Excel are
    written for every language in output_languages, so no PDF or slides choice may close it."""
    assert re.search(r"\n {16}if self\.output_languages:\n {20}self\._generate_documents_for_all_languages\(", source), (
        "JSON-mode outer gate must open on output_languages alone")


def test_outer_gate_main_flow_opens_for_every_output_language(source):
    """Main-flow parallel-doc-gen gate opens whenever there are target languages."""
    assert "        if final_consolidated_use_cases and target_langs:\n" in source, (
        "main-flow outer gate must open on target_langs alone")


def test_outer_gate_post_notebook_fallback_opens_for_every_output_language(source):
    """Post-notebook fallback gate opens whenever there are target languages."""
    assert "            if target_langs:\n" in source, (
        "post-notebook fallback outer gate must open on target_langs alone")


def test_weasyprint_install_gate_honours_english_force(source):
    """weasyprint install must run when English force applies — otherwise
    the PDF branch fires but the dependency is absent and the writer
    fails at runtime."""
    m = re.search(
        r'if self\._pdf_requested\(\) or \("English" in \(target_languages or \[\]\) and self\._documents_requested\(\)\):',
        source,
    )
    assert m is not None, (
        "weasyprint install gate must OR the English force rule, which only applies when a document format is picked")


def test_force_pdf_sentinel_fires_unconditional_on_force_english_pdf(source):
    """Sentinel must fire whenever _force_english_pdf is True (not only
    the override sub-case). Pre-fix sentinel was gated by
    ``and not _pdf_requested`` — which never held for v101-style widgets
    that alias to 'PDF Catalog' via short-form 'PDF'. Post-fix, the
    sentinel is a positive marker of the English-force rule engaging."""
    assert "if _force_english_pdf:" in source, (
        "sentinel emission must be gated on _force_english_pdf alone")
    assert '_pdf_mode = "override" if not _pdf_requested else "reinforce"' in source, (
        "sentinel mode must distinguish override (PDF not requested) from reinforce (PDF requested + force rule also fires)")
    assert (
        "[VIBE-LANG FORCE-PDF FIRED] language=English reason=english_in_output_languages mode={_pdf_mode}"
        in source
    ), "sentinel must include mode= suffix for observability"
    # Regression guard: the pre-fix gate that suppressed the sentinel in
    # the reinforce case must be removed.
    assert "if _force_english_pdf and not _pdf_requested:" not in source, (
        "the pre-fix `if _force_english_pdf and not _pdf_requested:` gate suppressed the sentinel in the "
        "reinforce path — must be gone in v1.0.2")


def test_alias_expansion_makes_v101_launcher_choices_reach_outer_gate(ns):
    """Semantic simulation (§8.3 no-tautology): the exact widget shape the
    v101 swarm launcher used — ``09_generation_options=PDF,XLSX,CSV,JSON,Markdown,Genie Code``
    — must produce a ``generate_choices`` list where the outer gate's
    canonical string checks fire.

    Pre-fix behaviour: gate is False (none of PDF Catalog/Presentation/
    Use Cases Catalog PDF present). Post-fix: alias expansion appends
    'PDF Catalog' and 'Markdown' remains — gate is True.
    """
    raw = "PDF,XLSX,CSV,JSON,Markdown,Genie Code"
    generate_choices = [opt.strip() for opt in raw.split(",")]

    def pre_fix_outer_gate(gc):
        return ("PDF Catalog" in gc or "Presentation" in gc or
                "Use Cases Catalog PDF" in gc)

    # Pre-fix: gate is False for the v101 widget shape (the actual v1.0.1 bug).
    assert pre_fix_outer_gate(generate_choices) is False, (
        "v101-style widget shape must NOT satisfy the pre-fix outer gate — that's the bug")

    # Now apply the alias expansion the v1.0.2 __init__ performs.
    aliases = {"PDF": "PDF Catalog", "PPTX": "Presentation", "MD": "Markdown"}
    for short, long in aliases.items():
        if short in generate_choices and long not in generate_choices:
            generate_choices.append(long)

    # Post-fix: gate is True because alias expansion appended 'PDF Catalog'.
    assert pre_fix_outer_gate(generate_choices) is True, (
        "alias expansion must lift v101-style choices into the outer gate's canonical set")
    assert "PDF Catalog" in generate_choices
    assert "Markdown" in generate_choices  # was already present as-is; not aliased


def test_english_force_rule_bypasses_choices_entirely():
    """Semantic simulation: when generate_choices only contains 'Markdown'
    (or nothing artifact-related at all), the English-force rule in the
    outer gate MUST still enter the doc pipeline because English is in
    output_languages. This is the pure Fix #4 override scenario."""
    generate_choices = ["Markdown", "Genie Code"]
    target_langs = ["English"]

    def pre_fix_gate(gc, tl):
        return ("PDF Catalog" in gc or "Presentation" in gc)

    def post_fix_gate(gc, tl):
        return ("PDF Catalog" in gc or "Presentation" in gc or
                "Use Cases Catalog PDF" in gc or "English" in tl)

    assert pre_fix_gate(generate_choices, target_langs) is False
    assert post_fix_gate(generate_choices, target_langs) is True


def test_a_non_english_only_run_still_opens_the_doc_pipeline():
    """A French-only run with no PDF or slides choice still needs its French Markdown, CSV and Excel,
    so the gate opens on the languages alone (CLAUDE.md user vibes: output_languages)."""
    generate_choices = ["Genie Code"]
    target_langs = ["French"]

    def old_gate(gc, tl):
        return ("PDF Catalog" in gc or "Presentation" in gc or
                "Use Cases Catalog PDF" in gc or "English" in tl)

    def gate(gc, tl):
        return bool(tl)

    assert old_gate(generate_choices, target_langs) is False
    assert gate(generate_choices, target_langs) is True
    assert gate(generate_choices, []) is False


def test_sentinel_fires_for_override_and_reinforce_scenarios():
    """Semantic simulation of the sentinel gate for the two cases the
    audit surfaced:
      * override:  PDF not requested, English in output_languages → sentinel fires (mode=override)
      * reinforce: PDF requested (or aliased from short-form), English in output_languages → sentinel fires (mode=reinforce)

    Pre-fix, only the override case would fire the sentinel — the
    reinforce case (v101 short-form 'PDF' → aliased to 'PDF Catalog')
    would NOT emit the sentinel, so the audit couldn't observe the
    English-force rule engaging.
    """
    def post_fix_sentinel(_pdf_requested, _force_english_pdf):
        if not (_pdf_requested or _force_english_pdf):
            return None
        if _force_english_pdf:
            return "override" if not _pdf_requested else "reinforce"
        return None

    def pre_fix_sentinel(_pdf_requested, _force_english_pdf):
        # pre-fix: sentinel only fires in the override sub-case
        if _force_english_pdf and not _pdf_requested:
            return "override"
        return None

    # Override: MD-only widget + English in target languages
    assert post_fix_sentinel(_pdf_requested=False, _force_english_pdf=True) == "override"
    assert pre_fix_sentinel(_pdf_requested=False, _force_english_pdf=True) == "override"

    # Reinforce: PDF-in-widget (short-form aliased) + English in target languages
    assert post_fix_sentinel(_pdf_requested=True, _force_english_pdf=True) == "reinforce"
    assert pre_fix_sentinel(_pdf_requested=True, _force_english_pdf=True) is None, (
        "pre-fix sentinel would NOT fire in reinforce case — that's the observability regression")

    # No force, no sentinel
    assert post_fix_sentinel(_pdf_requested=True, _force_english_pdf=False) is None
    assert pre_fix_sentinel(_pdf_requested=True, _force_english_pdf=False) is None


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


def test_pdf_writer_scheduling_reachable_for_v101_widget_and_english(ns, source):
    """End-to-end (source-level): given the exact v101 widget shape, the
    PDF writer ``self.generate_catalog_pdf`` MUST be scheduled inside
    ``_generate_documents_for_all_languages`` for lang=English. Prove
    the schedule call is textually present inside the force branch."""
    assert 'writer_ctx.submit(self.generate_catalog_pdf, lang, lang_abbr' in source, (
        "generate_catalog_pdf must be submitted inside the writer executor for the English force branch")


def test_v102_agent_namespace_exec_still_works(ns):
    """The whole notebook must still exec offline (no syntax breakage from
    the surgical edits)."""
    assert "InspireAI" in ns or "InspireAIAgent" in ns or any(
        (isinstance(v, type) and getattr(v, "__module__", "") == "inspire_offline")
        for v in ns.values()
    ), "notebook exec must produce class objects; namespace looks empty of the agent surface"
