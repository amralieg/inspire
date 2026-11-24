"""Right-to-left documents isolate every left-to-right run (table names, ids, numbers, code) with Unicode isolates,
so values keep their order and bracket pairs stay whole.

Before: a value was marked dir="ltr" as a whole when about 60% of its strong letters were Latin, so the Arabic inside it
and its brackets flipped, and below that share nothing was isolated at all.
"""
import re

import pytest

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

