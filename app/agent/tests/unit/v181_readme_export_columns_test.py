"""The readme said the Excel and CSV exports carry Idea Theme and the three BoB tier scores, and listed columns (Name, Domain,
Technique, Value Score, BoB Score) the exports never had; T2 found the drift against a real wanderbricks export. The readme now
lists the export columns in their order and this test ties that list to _export_columns."""
import pathlib
import re

from v120_artifacts_support import make_inspire

README = pathlib.Path(__file__).resolve().parents[2] / "readme.md"


def _excel_section():
    text = README.read_text(encoding="utf-8")
    start = text.index("- Columns, in order (the `Use Cases` sheet; the CSV export has the same columns):")
    return text, text[start:text.index("- The idea theme and the three BoB tier scores are not exported", start)]


def test_the_readme_lists_every_export_column_in_order(agent_ns):
    header = [h for h, _getter, _numeric in make_inspire(agent_ns)._export_columns(False, True, show_grouping=True)]
    _text, section = _excel_section()
    pos = 0
    for name in header:
        found = re.search(r"(?<![\w-])" + re.escape(name) + r"(?![\w-])", section[pos:])
        assert found, f"{name} is exported but missing (or out of order) in the readme"
        pos += found.end()
    assert "Idea Theme" not in header and not any(h.startswith("BoB Tier") for h in header)
    assert "Best-of-Best Score" in header and "Best of Best Reason" in header


def test_the_readme_never_claims_the_theme_or_tier_scores_are_exported():
    text, section = _excel_section()
    assert "Idea Theme" not in section and "BoB Tier" not in section and "BoB Score" not in section
    assert "written to `__inspire_usecases` AND to the Excel/CSV export" not in text
    assert "The Excel, CSV and JSON exports carry `bob_score` as the `Best-of-Best Score` column" in text
