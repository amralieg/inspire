"""REQ-116: a measured money value with no currency in the instructions, the KPI unit or the column name takes the
reporting currency (the `currency` widget), and says so. Instructions, the KPI unit and the column still win, and a
widget that is not an ISO code is never guessed into a currency."""
import pytest

from v120_artifacts_support import make_uc


@pytest.fixture
def ns(agent_ns):
    return agent_ns


def _kpi(ns, unit="", column="amount", value=29589.0, window=90):
    baseline = {"value": value, "window_days": window, "measured_on": "2026-11-01", "window_anchor": ns["KPI_WINDOW_ANCHOR"]}
    return {"name": "Weekly sales value", "unit": unit, "direction": "increase", "aggregation": "SUM", "table": "c.s.orders",
            "column": column, "computable": True, "query": "SELECT 1", "window_days": window, "baseline": baseline}


def _estimate(ns, uc, user_text=""):
    return ns["inspire_value_estimate"](uc, user_text, "predict", ns["inspire_use_case_kind"](uc))


def _widget(ns, monkeypatch, currency):
    monkeypatch.setitem(ns, "INSPIRE_SETTINGS_APPLIED", {"currency": currency})


def test_no_currency_anywhere_takes_the_reporting_currency_and_says_so(ns, monkeypatch):
    _widget(ns, monkeypatch, "AED")
    estimate = _estimate(ns, make_uc("N01-U01", KPIs=[_kpi(ns)], use_case_kind="forecast"))
    assert estimate["status"] == "measured"
    assert estimate["currency"] == "AED"
    assert estimate["currency_source"] == "reporting currency"
    assert estimate["short"].startswith("AED ") and "currency not known" not in estimate["short"]


def test_a_reporting_currency_that_is_not_an_iso_code_is_never_guessed(ns, monkeypatch):
    _widget(ns, monkeypatch, "not a code")
    estimate = _estimate(ns, make_uc("N01-U01", KPIs=[_kpi(ns)], use_case_kind="forecast"))
    assert estimate["currency"] is None
    assert estimate["currency_source"] is None
    assert estimate["short"].endswith("(currency not known)")


def test_instructions_beat_the_reporting_currency(ns, monkeypatch):
    _widget(ns, monkeypatch, "AED")
    estimate = _estimate(ns, make_uc("N01-U01", KPIs=[_kpi(ns)], use_case_kind="forecast"), "the value is in USD")
    assert estimate["currency"] == "USD"
    assert estimate["currency_source"] == "instructions"


def test_the_kpi_unit_beats_the_reporting_currency(ns, monkeypatch):
    _widget(ns, monkeypatch, "AED")
    estimate = _estimate(ns, make_uc("N01-U01", KPIs=[_kpi(ns, unit="EUR")], use_case_kind="forecast"))
    assert estimate["currency"] == "EUR"
    assert estimate["currency_source"] == "KPI unit"


def test_a_column_named_with_a_currency_beats_the_reporting_currency(ns, monkeypatch):
    _widget(ns, monkeypatch, "AED")
    estimate = _estimate(ns, make_uc("N01-U01", KPIs=[_kpi(ns, column="amount_gbp")], use_case_kind="forecast"))
    assert estimate["currency"] == "GBP"
    assert estimate["currency_source"] == "column name"


def test_no_reporting_currency_and_no_other_currency_stays_unknown(ns, monkeypatch):
    _widget(ns, monkeypatch, "")
    estimate = _estimate(ns, make_uc("N01-U01", KPIs=[_kpi(ns)], use_case_kind="forecast"))
    assert estimate["currency"] is None and estimate["short"].endswith("(currency not known)")
