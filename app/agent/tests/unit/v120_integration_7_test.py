"""v1.2.0 INTEGRATION-7: a PDF render that cannot crash the process, honest pointers to where generated content lives,
one truncation policy for every row-keyed LLM answer.

S1 WeasyPrint before 70.0 releases its Fontconfig configuration twice: `FontConfiguration.__init__` wraps the config
   in `ffi.gc(..., FcConfigDestroy)` and also calls `FcConfigDestroy` once Pango holds it, so freeing the font map
   reads and frees memory that is already gone. The agent builds one `FontConfiguration` per PDF, so the whole
   Python process could segfault. The Inspire assets pin WeasyPrint 70.0 or later and the loader refuses another copy
   already loaded (v177_offline_assets_test), and the geometry harness keeps the real module importable while it renders.
"""
import importlib
import importlib.util
import os
import subprocess
import sys
import textwrap
import types

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from v120_artifacts_support import make_inspire
from v120_docs_geometry_support import pdf_layout

HAS_WEASYPRINT = importlib.util.find_spec("weasyprint") is not None


@pytest.mark.skipif(sys.platform != "darwin" or not os.path.exists("/usr/lib/libgmalloc.dylib") or not HAS_WEASYPRINT,
                    reason="Guard Malloc is a macOS allocator and WeasyPrint must be installed")
def test_the_installed_weasyprint_frees_a_font_configuration_without_touching_freed_memory():
    script = textwrap.dedent("""
        import gc
        import weasyprint
        from weasyprint.text.fonts import FontConfiguration
        for _ in range(2):
            config = FontConfiguration()
            weasyprint.HTML(string="<p style='font-family:sans-serif'>Fontconfig lifecycle</p>").write_pdf(font_config=config)
            del config
            gc.collect()
        print("freed", weasyprint.__version__)
    """)
    env = dict(os.environ, DYLD_INSERT_LIBRARIES="/usr/lib/libgmalloc.dylib")
    completed = subprocess.run([sys.executable, "-X", "faulthandler", "-c", script], capture_output=True, text=True,
                               env=env, timeout=300)
    assert completed.returncode == 0, (completed.returncode, completed.stderr[-2000:])
    assert completed.stdout.startswith("freed ")


@pytest.mark.skipif(not HAS_WEASYPRINT, reason="WeasyPrint is not installed")
def test_the_geometry_harness_renders_while_a_fake_weasyprint_is_installed_and_restores_it(monkeypatch):
    fake = types.SimpleNamespace(HTML=None)
    monkeypatch.setitem(sys.modules, "weasyprint", fake)
    document = pdf_layout("<html><body><table><tr><td>cell</td></tr></table><p>text</p></body></html>")
    assert len(document.pages) == 1
    assert sys.modules["weasyprint"] is fake


TRANSLATE_HEADER = ["No", "Name", "Business Domain", "Subdomain", "type", "Analytics Technique", "Statement", "Solution",
                    "Business Value", "Beneficiary", "Sponsor", "Business Priority Alignment", "Strategic Goals Alignment",
                    "Tables Involved", "Quality", "Headline", "Technique Label", "Coverage Pick Reason"]


def _translation_answer(rows):
    import csv
    import io
    out = io.StringIO()
    writer = csv.writer(out, quoting=csv.QUOTE_ALL)
    writer.writerow(TRANSLATE_HEADER + ["honesty_score", "honesty_justification"])
    for row in rows:
        writer.writerow(row + ["90", "faithful"])
    return out.getvalue()


def _ja_row(no):
    return [no, "名前", "営業", "計画", "Opportunity", "Forecasting", "ステートメント", "解決策", "価値", "担当", "役員", "", "",
            "main.s.sales", "High", "見出し", "予測", "必要な領域を代表する"]


def _translation_service(agent_ns):
    ts = agent_ns["TranslationService"]
    service = ts.__new__(ts)
    service.logger = make_inspire(agent_ns).logger
    return service


def test_the_reduced_translation_columns_parse_and_keep_the_coverage_reason(agent_ns):
    from v120_artifacts_support import make_uc
    service = _translation_service(agent_ns)
    rows = service._parse_translation_csv(_translation_answer([_ja_row("N01-U01"), _ja_row("N01-U02")]),
                                          [make_uc("N01-U01"), make_uc("N01-U02")], 1, "Japanese")
    assert [r["No"] for r in rows] == ["N01-U01", "N01-U02"]
    assert rows[0]["Coverage Pick Reason"] == "必要な領域を代表する" and rows[0]["Technique Label"] == "予測"
    assert not service.logger.matching("[TRANSLATE-ROW malformed]")


@pytest.mark.parametrize("shift", ["coverage_written_before_tables", "technique_label_written_first"])
def test_a_shifted_row_on_the_reduced_translation_columns_is_treated_as_missing(agent_ns, shift):
    from v120_artifacts_support import make_uc
    service = _translation_service(agent_ns)
    shifted = _ja_row("N01-U02")
    if shift == "coverage_written_before_tables":
        shifted = shifted[:13] + [shifted[-1]] + shifted[13:-1]
    else:
        shifted = shifted[:5] + [shifted[16]] + shifted[5:16] + shifted[17:]
    assert len(shifted) == len(TRANSLATE_HEADER)
    try:
        rows = service._parse_translation_csv(_translation_answer([_ja_row("N01-U01"), shifted]),
                                              [make_uc("N01-U01"), make_uc("N01-U02")], 1, "Japanese")
    except ValueError:
        rows = []
    assert "N01-U02" not in [r["No"] for r in rows]
    messages = [m for _, m in service.logger.matching("[TRANSLATE-ROW malformed]")]
    assert any("Analytics Technique value" in m or "Tables Involved value" in m or "Quality value" in m for m in messages), messages


def _generated_texts(agent_ns):
    import glob
    import json
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    notebook = json.load(open(os.path.join(root, "agent", "dbx_inspire_ai_agent.ipynb"), encoding="utf-8"))
    texts = {"cells[0]": "".join(notebook["cells"][0]["source"]), "cells[1]": "".join(notebook["cells"][1]["source"]),
             "AGENTS.md": agent_ns["GENIE_AGENTS_FILE_TEMPLATE"]}
    for path in [os.path.join(root, "readme.md")] + sorted(glob.glob(os.path.join(root, "docs", "*.md"))):
        if os.path.exists(path):
            texts[os.path.relpath(path, root)] = open(path, encoding="utf-8").read()
    return texts


RETIRED_DOCUMENT_SECTIONS = ("Why this use case qualifies", "Elite assessment", "Evidence strength", "Implementability",
                             "Actionability", "How the cited tables connect through their keys.",
                             "The strongest reason the use case could fail, stated up front.",
                             "The columns that carry the signal, the outcome, the time and the entity key.")


def test_no_generated_text_points_to_a_removed_document_section(agent_ns):
    import re
    pointer = re.compile(r"(?i)\b(on|in|from|see) the use[- ]case card\b")
    for name, text in _generated_texts(agent_ns).items():
        assert not pointer.search(text), (name, pointer.search(text).group(0))
        for label in RETIRED_DOCUMENT_SECTIONS:
            assert label not in text, (name, label)


def test_no_retired_elite_translation_column_survives_outside_the_tests(agent_ns):
    from v120_artifacts_translation_test import RETIRED_ELITE_COLUMNS
    for name, text in _generated_texts(agent_ns).items():
        for column in RETIRED_ELITE_COLUMNS:
            assert column not in text, (name, column)


def test_agents_md_points_genie_at_the_instruction_cell_and_protects_inspires_four_cells(agent_ns):
    template = agent_ns["GENIE_AGENTS_FILE_TEMPLATE"]
    assert "one Genie Code instruction in its second cell" in template
    assert "then Inspire's Number helpers cell and the Run controls cell as its last two cells" in template
    assert "Never edit or delete Inspire's four cells" in template and "first three cells" not in template
    assert "never defining your own" in template
    assert 'SPEC["' not in template, "the retired notebook harness and its SPEC dict are gone"
    assert "use-case card" in template.lower() and "Run controls" in template


def test_every_translation_anchor_is_a_column_of_the_reduced_set_and_the_anchors_are_what_reject_the_shift(agent_ns, monkeypatch):
    from v120_artifacts_support import make_uc
    ts = agent_ns["TranslationService"]
    prompt = agent_ns["PROMPT_TEMPLATES"]["USE_CASE_TRANSLATE_PROMPT"]
    for anchor in ts._ALIGNMENT_ANCHORS:
        assert anchor in TRANSLATE_HEADER and f'"{anchor}"' in prompt, anchor
    shifted = _ja_row("N01-U02")
    shifted = shifted[:13] + [shifted[-1]] + shifted[13:-1]
    monkeypatch.setattr(ts, "_ALIGNMENT_ANCHORS", ())
    service = _translation_service(agent_ns)
    rows = service._parse_translation_csv(_translation_answer([_ja_row("N01-U01"), shifted]),
                                          [make_uc("N01-U01"), make_uc("N01-U02")], 1, "Japanese")
    assert "N01-U02" in [r["No"] for r in rows]
