import importlib.util
import io
import re
import sys
import types

import pytest

from v120_artifacts_support import elite_assessment, make_inspire, make_uc
from v120_docs_geometry_support import (PDF_TOLERANCE, PPTX_TOLERANCE, pdf_geometry_violations, pdf_layout, pdf_segments,
                                        pptx_geometry_violations)

HAS_WEASYPRINT = importlib.util.find_spec("weasyprint") is not None
needs_weasyprint = pytest.mark.skipif(not HAS_WEASYPRINT, reason="WeasyPrint is not installed")
LANGUAGES = ("English", "Arabic", "Japanese", "Hindi")
MODES = ("Good", "Ultra High")
TIERS = ("Ultra High", "Very High", "High", "Medium", "Low")
MIXES = {
    "one_tier": {"High": 6},
    "two_tiers": {"High": 4, "Medium": 3},
    "five_tiers": {"Ultra High": 2, "Very High": 3, "High": 5, "Medium": 4, "Low": 1},
    "tiny_next_to_large": {"High": 40, "Low": 1},
}


@pytest.fixture
def docs(agent_ns, monkeypatch):
    cls = agent_ns["DatabricksInspire"]
    monkeypatch.setattr(agent_ns["workspace"], "ImportFormat", types.SimpleNamespace(AUTO="AUTO"), raising=False)
    monkeypatch.setattr(cls, "_DOC_FONT_FILES", {}, raising=False)
    return agent_ns


@pytest.fixture
def captured_html(monkeypatch):
    captured = []

    class HTML:
        def __init__(self, string=None, **kwargs):
            captured.append(string)

        def write_pdf(self, path, font_config=None):
            with open(path, "wb") as handle:
                handle.write(b"%PDF-1.4 fake")
    monkeypatch.setitem(sys.modules, "weasyprint", types.SimpleNamespace(HTML=HTML))
    return captured


def labels(ns, language):
    ts = ns["TranslationService"]
    t = dict(ts.ENGLISH_TRANSLATIONS)
    if language != "English":
        t.update(ts.TRANSLATION_FALLBACKS[language])
    return t


def catalog(mode):
    domains = ("Supply Chain and Logistics Operations Management", "Customer Experience", "Finance")
    qualities = ("Ultra High", "Very High", "High", "Medium", "Low") if mode == "Ultra High" else ("High", "Medium", "Low", "High")
    grouped = {}
    for d, domain in enumerate(domains):
        for u in range(4):
            extra = {"Quality": qualities[(d + u) % len(qualities)], "quality_mode": mode,
                     "Inspire Score": round(9.6 - u * 0.4 - d * 0.1, 2),
                     "Name": f"Predict late replenishment for high velocity assortments across regional hubs {d}{u}",
                     "Tables Involved": ", ".join(f"main.retail_operations.table_with_a_long_name_{i}" for i in range(6))}
            if mode == "Ultra High" and u == 0:
                extra.update(elite_status="ELITE", elite_score=8.9 - d * 0.2, elite_assessment=elite_assessment())
            if mode == "Ultra High" and u == 3:
                extra.update(elite_status="DOMAIN_COVERAGE_PICK",
                             coverage_pick_reason="Domain coverage pick, below bar: quality 'Medium' is below the High bar")
            grouped.setdefault(domain, []).append(make_uc(f"N{d + 1:02d}-U{u + 1:02d}", domain, **extra))
    return grouped


def mix_catalog(mix):
    ucs = []
    for tier in TIERS:
        for i in range(mix.get(tier, 0)):
            ucs.append(make_uc(f"N01-U{len(ucs) + 1:02d}", "Sales", Quality=tier, quality_mode="Good",
                               **{"Inspire Score": round(9.0 - len(ucs) * 0.05, 2)}))
    return {"Sales": ucs}


def summary(grouped):
    out = {"Executive": "<p>" + "The portfolio concentrates value in a few domains. " * 6 + "</p>"}
    out.update({domain: f"<p>{domain} turns operational data into decisions. " * 3 + "</p>" for domain in grouped})
    return out


def pdf_html(ns, captured, grouped, language):
    obj = make_inspire(ns)
    obj.generate_catalog_pdf(language, "xx", labels(ns, language), summary(grouped), grouped, "Acme")
    assert captured, "the PDF HTML was not rendered"
    return captured[-1]


def deck(ns, grouped, language):
    from pptx import Presentation
    obj = make_inspire(ns)
    obj.generate_presentation_pptx(language, "xx", labels(ns, language), summary(grouped), grouped, "Acme")
    data = next(iter(obj.w_client.workspace.files.values()))
    return obj, Presentation(io.BytesIO(data))


def portfolio_slide(obj, prs):
    record = obj.logger.matching("[DOCS-PPTX]")[-1][1]
    archetypes = [a.strip("' ") for a in re.search(r"layouts=(\[.*?\])", record).group(1).strip("[]").split(",")]
    return prs.slides[archetypes.index("portfolio")]


def bar_segments(slide):
    emu = 914400.0
    shapes = [s for s in slide.shapes if abs(s.top / emu - 2.5) < 0.01 and abs(s.height / emu - 0.3) < 0.01]
    return sorted(((s.left / emu, s.width / emu) for s in shapes))


def counts_in_order(mix):
    return [mix[tier] for tier in TIERS if mix.get(tier)]


@pytest.mark.parametrize("counts", [[10], [5, 5], [1, 1, 1, 1, 1], [1, 999], [1, 1, 400], [3, 0, 7], [0, 0], [None, -2, 4],
                                    [1] * 70, [2, 3, 5, 7, 11, 13, 17, 19]])
def test_doc_shares_always_sum_to_exactly_100_and_keep_tiny_tiers_visible(docs, counts):
    cls = docs["DatabricksInspire"]
    shares = cls._doc_shares(counts)
    clean = [max(0, int(n or 0)) for n in counts]
    assert len(shares) == len(counts)
    assert all(share >= 0 for share in shares)
    assert all(share == 0 for share, n in zip(shares, clean) if n == 0)
    if not sum(clean):
        assert shares == [0.0] * len(counts)
        return
    assert round(sum(shares), 6) == 100.0, shares
    assert all(round(share * 100) == share * 100 for share in shares)
    live = [n for n in clean if n]
    if cls._DOC_MIN_SHARE * len(live) <= 100.0:
        assert all(share >= cls._DOC_MIN_SHARE for share, n in zip(shares, clean) if n), shares
    for (a, n_a), (b, n_b) in zip(zip(shares, clean), zip(shares[1:], clean[1:])):
        if n_a > n_b:
            assert a >= b
        if n_a < n_b:
            assert a <= b


def test_doc_shares_keeps_a_1_in_1000_tier_at_the_minimum_and_shrinks_only_the_large_one(docs):
    cls = docs["DatabricksInspire"]
    assert cls._doc_shares([1, 999]) == [cls._DOC_MIN_SHARE, 100.0 - cls._DOC_MIN_SHARE]
    assert cls._doc_shares([1, 1]) == [50.0, 50.0]
    assert cls._doc_shares([7]) == [100.0]


@needs_weasyprint
@pytest.mark.parametrize("mode", MODES)
@pytest.mark.parametrize("language", LANGUAGES)
def test_every_pdf_box_stays_inside_its_card_and_the_page(docs, captured_html, mode, language):
    document = pdf_layout(pdf_html(docs, captured_html, catalog(mode), language))
    assert len(document.pages) >= 8
    assert pdf_geometry_violations(document) == []


@pytest.mark.parametrize("mode", MODES)
@pytest.mark.parametrize("language", LANGUAGES)
def test_every_deck_shape_stays_inside_the_slide_and_its_panel(docs, mode, language):
    _obj, prs = deck(docs, catalog(mode), language)
    assert len(prs.slides) >= 12
    assert pptx_geometry_violations(prs) == []


@needs_weasyprint
@pytest.mark.parametrize("language", ("English", "Arabic"))
@pytest.mark.parametrize("mix", sorted(MIXES))
def test_pdf_quality_bar_fills_its_card_exactly_for_every_mix_and_mirrors_in_rtl(docs, captured_html, mix, language):
    document = pdf_layout(pdf_html(docs, captured_html, mix_catalog(MIXES[mix]), language))
    assert pdf_geometry_violations(document) == []
    bars = pdf_segments(document)
    assert len(bars) == 1
    (sx, _sy, sw, _sh), segments = bars[0]
    counts = counts_in_order(MIXES[mix])
    assert len(segments) == len(counts)
    shares = docs["DatabricksInspire"]._doc_shares(counts)
    edges = sorted(segments)
    assert abs(edges[0][0] - sx) <= PDF_TOLERANCE and abs(edges[-1][0] + edges[-1][2] - (sx + sw)) <= PDF_TOLERANCE
    for (x, _y, w, _h), (nx, _ny, _nw, _nh) in zip(edges, edges[1:]):
        assert abs(x + w - nx) <= PDF_TOLERANCE
    for (_x, _y, w, _h), share in zip(segments, shares):
        assert abs(w - sw * share / 100.0) <= 1.0, (w, sw, share)
    first = segments[0]
    if language == "Arabic":
        assert abs(first[0] + first[2] - (sx + sw)) <= PDF_TOLERANCE
    else:
        assert abs(first[0] - sx) <= PDF_TOLERANCE


@pytest.mark.parametrize("language", ("English", "Arabic"))
@pytest.mark.parametrize("mix", sorted(MIXES))
def test_deck_quality_bar_fills_its_panel_exactly_for_every_mix_and_mirrors_in_rtl(docs, mix, language):
    obj, prs = deck(docs, mix_catalog(MIXES[mix]), language)
    assert pptx_geometry_violations(prs) == []
    slide = portfolio_slide(obj, prs)
    segments = bar_segments(slide)
    counts = counts_in_order(MIXES[mix])
    assert len(segments) == len(counts)
    width = prs.slide_width / 914400.0
    start = 8.1 if language == "English" else width - 8.1 - 4.38
    assert abs(segments[0][0] - start) <= PPTX_TOLERANCE
    assert abs(segments[-1][0] + segments[-1][1] - (start + 4.38)) <= PPTX_TOLERANCE
    for (x, w), (nx, _nw) in zip(segments, segments[1:]):
        assert abs(x + w - nx) <= PPTX_TOLERANCE
    shares = obj._doc_shares(counts)
    widths = [w for _x, w in segments]
    expected = [4.38 * share / 100.0 for share in shares]
    if language == "Arabic":
        expected = expected[::-1]
    assert all(abs(a - b) <= PPTX_TOLERANCE for a, b in zip(widths, expected)), (widths, expected)


@needs_weasyprint
def test_pdf_gate_flags_a_child_wider_than_its_card_and_a_card_wider_than_the_page():
    page = ('<html><head><style>@page { size: A4; margin: 20mm; } body { margin: 0; }</style></head><body>'
            '<div class="card" style="width: 200px"><div style="width: 400px">wide</div></div>'
            '<div class="card" style="width: 130%">too wide</div>'
            '<div class="card" style="width: 200px"><div style="width: 150px">fits</div></div></body></html>')
    violations = pdf_geometry_violations(pdf_layout(page))
    assert any("div" in v and "outside div.card" in v for v in violations), violations
    assert any("panel div.card" in v and "outside the page content area" in v for v in violations), violations
    assert len(violations) == 2, violations


@needs_weasyprint
def test_pdf_gate_catches_the_inherited_border_spacing_overflow_when_the_reset_is_removed(docs, captured_html):
    html = pdf_html(docs, captured_html, mix_catalog(MIXES["five_tiers"]), "English")
    assert "* { border-spacing: 0; }" in html
    assert pdf_geometry_violations(pdf_layout(html)) == []
    broken = pdf_geometry_violations(pdf_layout(html.replace("* { border-spacing: 0; }", "")))
    assert any("div.stack" in v for v in broken), broken


def test_pptx_gate_flags_a_shape_off_the_slide_and_a_shape_crossing_its_panel():
    from pptx import Presentation
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.util import Inches
    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
    slide = prs.slides.add_slide(prs.slide_layouts[6])

    def box(x, y, w, h, name, kind=MSO_SHAPE.RECTANGLE):
        shape = slide.shapes.add_shape(kind, Inches(x), Inches(y), Inches(w), Inches(h))
        shape.fill.solid()
        shape.name = name
        return shape
    box(1.0, 1.0, 4.0, 3.0, "panel")
    box(1.5, 1.5, 2.0, 1.0, "inside")
    box(3.5, 2.0, 2.0, 1.0, "crossing")
    box(12.0, 6.0, 2.0, 0.5, "off_slide", MSO_SHAPE.OVAL)
    violations = pptx_geometry_violations(prs)
    assert any("crossing" in v and "outside its panel panel" in v for v in violations), violations
    assert any("off_slide" in v and "outside the slide" in v for v in violations), violations
    assert not any("inside" in v.split(" (")[0] for v in violations), violations
    assert len(violations) == 2, violations
