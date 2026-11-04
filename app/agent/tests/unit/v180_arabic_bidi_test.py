"""Right-to-left documents isolate every left-to-right run (table names, ids, numbers, code) with Unicode isolates,
so values keep their order and bracket pairs stay whole.

Before: a value was marked dir="ltr" as a whole when about 60% of its strong letters were Latin, so the Arabic inside it
and its brackets flipped, and below that share nothing was isolated at all.
"""
import re
import sys
import types

import pytest

from v120_artifacts_support import make_inspire, make_uc

LRI, PDI = "\u2066", "\u2069"


@pytest.fixture
def cls(agent_ns):
    return agent_ns["DatabricksInspire"]


def isolates(text):
    return re.findall(LRI + "(.*?)" + PDI, text)


def balanced(run):
    stack = []
    for ch in run:
        if ch in "([{":
            stack.append(ch)
        elif ch in ")]}":
            if not stack or stack.pop() != {")": "(", "]": "[", "}": "{"}[ch]:
                return False
    return not stack


@pytest.mark.parametrize("text,expected", [
    ("تحليل (customer_id) للعملاء", "تحليل (" + LRI + "customer_id" + PDI + ") للعملاء"),
    ("الجداول main.s.sales، main.s.stores", "الجداول " + LRI + "main.s.sales" + PDI + "، " + LRI + "main.s.stores" + PDI),
    ("قيمة sum(units_sold) > 0 يوميا", "قيمة " + LRI + "sum(units_sold) > 0" + PDI + " يوميا"),
    ("نسبة 12.5% من الطلبات", "نسبة " + LRI + "12.5%" + PDI + " من الطلبات"),
    ("N01-U03 (المبيعات)", LRI + "N01-U03" + PDI + " (المبيعات)"),
    ("Forecast units_sold by store (المبيعات)", LRI + "Forecast units_sold by store" + PDI + " (المبيعات)"),
    ("[N01-U03] توقع", "[" + LRI + "N01-U03" + PDI + "] توقع"),
])
def test_left_to_right_runs_are_isolated_and_brackets_stay_paired(cls, text, expected):
    out = cls._doc_isolate_ltr(text)
    assert out == expected
    assert all(balanced(run) for run in isolates(out))
    assert out.replace(LRI, "").replace(PDI, "") == text
    assert cls._doc_isolate_ltr(out) == out


def test_text_without_right_to_left_letters_is_left_alone(cls):
    for text in ("Forecast demand (units_sold)", "main.s.sales, main.s.stores", "12.5%", ""):
        assert cls._doc_isolate_ltr(text) == text


def test_mixed_text_is_never_marked_left_to_right_as_a_whole(cls):
    assert cls._doc_is_ltr_text("Forecast units_sold by store (المبيعات)") is False
    assert cls._doc_is_ltr_text("main.s.sales, main.s.stores") is True
    assert cls._doc_is_ltr_text("main.s.sales، main.s.stores") is False


@pytest.fixture
def captured(agent_ns, monkeypatch):
    monkeypatch.setattr(agent_ns["workspace"], "ImportFormat", types.SimpleNamespace(AUTO="AUTO"), raising=False)
    pages = []

    class HTML:
        def __init__(self, string=None, **kwargs):
            pages.append(string)

        def write_pdf(self, path, font_config=None):
            with open(path, "wb") as fh:
                fh.write(b"%PDF-1.4 fake")
    monkeypatch.setitem(sys.modules, "weasyprint", types.SimpleNamespace(HTML=HTML))
    return pages


def test_arabic_pdf_isolates_table_names_numbers_and_ids(agent_ns, captured):
    ts = agent_ns["TranslationService"]
    t = dict(ts.ENGLISH_TRANSLATIONS)
    t.update(ts.TRANSLATION_FALLBACKS["Arabic"])
    uc = make_uc("N01-U01", "المبيعات", Name="Forecast units_sold by store (المبيعات)", usecase="توقع الطلب (units_sold) يوميا",
                 Statement="يتنبأ النموذج بالطلب من الجدول main.s.sales (عمود units_sold) بنسبة 12.5% كل يوم")
    obj = make_inspire(agent_ns, output_languages=["English", "Arabic"])
    obj.generate_catalog_pdf("Arabic", "ar", t, {"Executive": "<p>ملخص يذكر الجدول main.s.sales</p>"}, {"المبيعات": [uc]}, "Acme")
    page = captured[-1]
    card = page[page.index('id="uc-N01-U01"'):]
    card = card[:card.index("</article>")]
    assert "الجدول " + LRI + "main.s.sales" + PDI + " (عمود " + LRI + "units_sold" + PDI + ")" in card
    assert LRI + "12.5%" + PDI in card
    assert "توقع الطلب (" + LRI + "units_sold" + PDI + ") يوميا" in card
    assert '<div class="sub">' + LRI + "Forecast units_sold by store" + PDI + " (المبيعات) باستخدام " in card
    assert "ملخص يذكر الجدول " + LRI + "main.s.sales" + PDI in page
    assert all(balanced(run) for run in isolates(page))
