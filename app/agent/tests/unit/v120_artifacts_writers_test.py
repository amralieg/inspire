"""v1.2.0 ARTIFACTS lane: CSV / Markdown writers.

F-07/F-08/F-18/F-19/D2-18/E-23: one shared ordering through `_final_rank_key` (domains by their
best member, highlights are the top members after sorting), Markdown shows Quality Score, Inspire
Score and bob_score, nothing defaults to 'Medium', 5.0 or 0; E-19 the dead SQL-results cache is
gone; the Ultra High fields surface (Excel/CSV columns, "Why this use case qualifies", domain
coverage picks labelled below the bar); F-09 packages are installed at most once per run and a
writer failure is raised and recorded instead of being reported as success.
"""
import csv
import io
import types

import pytest

from v120_artifacts_support import elite_assessment, make_inspire, make_uc


@pytest.fixture
def ranked(agent_ns, monkeypatch):
    monkeypatch.setattr(agent_ns["workspace"], "ImportFormat", types.SimpleNamespace(AUTO="AUTO"), raising=False)
    return agent_ns


def english(ns):
    return dict(ns["TranslationService"].ENGLISH_TRANSLATIONS)


def portfolio():
    sales = [make_uc(f"N01-U0{i}", "Sales", Name=f"Sales idea {i}", **{"Inspire Score": score})
             for i, score in enumerate([5.0, 6.0, 4.0, 5.5, 6.5, 9.0], start=1)]
    ops = [make_uc("N02-U01", "Operations", Name="Ops idea 1", **{"Inspire Score": 8.0}),
           make_uc("N02-U02", "Operations", Name="Ops pick", elite_status="DOMAIN_COVERAGE_PICK",
                   coverage_pick_reason="Domain coverage pick, below bar: quality 'Medium' is below the High bar",
                   **{"Inspire Score": 9.9})]
    return {"Operations": ops, "Sales": sales}


def test_rank_domain_groups_orders_domains_by_their_best_member(ranked):
    obj = make_inspire(ranked)
    groups = obj._rank_domain_groups(portfolio())
    assert [d for d, _ in groups] == ["Sales", "Operations"]
    assert [uc["No"] for uc in groups[0][1]] == ["N01-U06", "N01-U05", "N01-U02", "N01-U04", "N01-U01", "N01-U03"]
    assert [uc["No"] for uc in groups[1][1]] == ["N02-U01", "N02-U02"]
    assert obj._priority_sort_key(make_uc("x")) == obj._final_rank_key(make_uc("x"))


REMOVED_ELITE_PANEL_TEXT = ("Why this use case qualifies", "Decision Owner", "Regional supply planner", "Stock-out rate",
                            "Value Driver", "Build Path", "Red-Team Note", "Promotions not in the data", "Evidence Columns",
                            "Join Path", "Decision Cadence", "Elite assessment", "Evidence strength", "Implementability",
                            "Actionability", "Weekly reorder decision")


def _markdown(ns, grouped):
    obj = make_inspire(ns)
    obj._generate_markdown_catalog("English", "en", grouped, {"Executive": "<p>Exec <b>summary</b></p>", "Sales": "<p>Sales summary</p>"}, "Acme")
    return next(iter(obj.w_client.workspace.files.values())).decode("utf-8")


def test_markdown_shows_real_scores_and_never_mislabels_priority(ranked):
    uc = make_uc("N01-U01", "Sales", Priority=9.5, bob_score=8.3, **{"Quality Score": 4.5, "Inspire Score": 8.1})
    md = _markdown(ranked, {"Sales": [uc]})
    assert "- **Quality:** High\n" in md
    assert "- **Quality Score:** 4.5 / 5\n" in md and "- **Inspire Score:** 8.1 / 10\n" in md and "- **Best-of-Best Score:** 8.3 / 10\n" in md
    assert "- **Priority:** 9.5 / 10\n" in md and "bob_score" not in md
    assert "(Score:" not in md
    assert "## Executive Summary\nExec summary\n" in md and "Sales summary" in md


def test_markdown_unscored_shows_not_scored_never_medium(ranked):
    uc = make_uc("N01-U01", "Sales")
    for key in ("Quality", "Quality Score", "Inspire Score"):
        uc.pop(key)
    md = _markdown(ranked, {"Sales": [uc]})
    assert "- **Quality:** Not scored\n" in md and "Medium" not in md
    assert "- **Quality Score:** Not scored\n" in md and "- **Best-of-Best Score:** Not scored\n" in md
    assert "- **Inspire Score:** Not scored\n" in md and "- **Business Priority Alignment:** Not provided\n" in md


def test_markdown_order_elite_score_and_coverage_label_without_the_elite_panel(ranked):
    grouped = portfolio()
    grouped["Sales"][2].update(elite_status="ELITE", elite_score=9.9, elite_assessment=elite_assessment())
    md = _markdown(ranked, grouped)
    import re
    headings = re.findall(r"^#### #(\d+) (N0\d-U0\d)", md, re.M)
    assert [h[1] for h in headings] == ["N01-U03", "N01-U06", "N01-U05", "N01-U02", "N01-U04", "N01-U01", "N02-U01", "N02-U02"]
    assert [h[0] for h in headings] == ["1", "2", "4", "5", "6", "7", "3", "8"]
    assert "> **Domain coverage pick, below the bar**. Reason: Domain coverage pick, below bar" in md
    assert "- **Elite Score:** 9.9 / 10\n" in md
    for text in REMOVED_ELITE_PANEL_TEXT:
        assert text not in md, text
    standard = ranked["TranslationService"].ENGLISH_TRANSLATIONS["doc_data_access_none"]
    assert md.rstrip().endswith("*") and "## Disclaimer" in md and standard in md and "read no customer data" in standard


def _csv_rows(ns, grouped):
    obj = make_inspire(ns)
    obj._normalize_usecase = lambda usecase, name: usecase
    obj._generate_csv_catalog("English", "en", grouped)
    text = next(iter(obj.w_client.workspace.files.values())).decode("utf-8-sig")
    return list(csv.reader(io.StringIO(text)))


def test_csv_ranks_globally_and_marks_missing_scores_not_scored(ranked):
    rows = _csv_rows(ranked, portfolio())
    header, body = rows[0], rows[1:]
    assert [r[0] for r in body] == ["N01-U06", "N02-U01", "N01-U05", "N01-U02", "N01-U04", "N01-U01", "N01-U03", "N02-U02"]
    roi = header.index("ROI")
    assert all(r[roi] == "Not scored" for r in body)
    assert body[0][header.index("Inspire Score")] == "9.0"
    assert header[-13:] == ["Elite Status", "Verdict", "Decision", "Decision Owner", "Decision Cadence", "KPI", "Value Driver",
                            "Evidence Columns", "Join Path", "Build Path", "Red-Team Note", "Coverage Pick Reason", "Below Bar Reason"]
    assert header[:15] == ["ID", "Rank", "Business Domain", "Subdomain", "Use Case", "Subtitle", "Quality",
                           "Meets your quality bar", "Inspire Score", "Elite Score", "Quality Score", "Best-of-Best Score",
                           "Priority", "Value", "Feasibility"]
    assert [r[1] for r in body] == ["1", "2", "3", "4", "5", "6", "7", "8"]
    pick = body[-1]
    assert pick[header.index("Elite Status")] == "DOMAIN_COVERAGE_PICK"
    assert pick[header.index("Elite Score")] == "Not scored"
    assert pick[header.index("Coverage Pick Reason")].startswith("Domain coverage pick, below bar")
    assert pick[header.index("Meets your quality bar")] == "N" and body[0][header.index("Meets your quality bar")] == "Y"
    assert body[0][header.index("Business Priority Alignment")] == "N/A"


def test_csv_without_elite_fields_keeps_the_base_columns(ranked):
    header = _csv_rows(ranked, {"Sales": [make_uc("N01-U01")]})[0]
    obj = make_inspire(ranked)
    assert header == [h for h, _getter, _numeric in obj._export_columns(False)]
    assert "Elite Score" not in header and "Elite Status" not in header and "Sponsor" in header and "Beneficiary" in header


def test_markdown_and_csv_failures_are_raised_and_recorded(ranked):
    obj = make_inspire(ranked)
    obj.w_client.workspace.fail = True
    with pytest.raises(RuntimeError):
        obj._generate_markdown_catalog("English", "en", {"Sales": [make_uc("N01-U01")]}, {}, "Acme")
    with pytest.raises(RuntimeError):
        obj._generate_csv_catalog("English", "en", {"Sales": [make_uc("N01-U01")]})
    assert [f["step"] for f in obj.failed_steps] == ["Markdown Catalog", "CSV Catalog"]


def test_dead_sql_results_cache_is_removed(agent_ns):
    cls = agent_ns["DatabricksInspire"]
    assert not hasattr(cls, "_get_cached_sql_result") and not hasattr(cls, "_ensure_sql_results_cache_dir")
    assert "example_results" not in agent_ns["TranslationService"].ENGLISH_TRANSLATIONS
    from _agentload import agent_source
    assert "inspire_sql_cache_" not in agent_source()

