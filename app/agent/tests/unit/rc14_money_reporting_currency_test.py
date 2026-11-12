"""REQ-116: a measured money value with no currency in the instructions, the KPI unit or the column name takes the
reporting currency (the `currency` widget), and says so. Instructions, the KPI unit and the column still win, and a
widget that is not an ISO code is never guessed into a currency."""
import re

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


def test_a_currency_named_in_the_instructions_is_converted_into_the_reporting_currency(ns, monkeypatch):
    _widget(ns, monkeypatch, "AED")
    estimate = _estimate(ns, make_uc("N01-U01", KPIs=[_kpi(ns)], use_case_kind="forecast"), "the value is in USD")
    assert estimate["currency"] == "AED"
    assert estimate["currency_source"] == "converted from USD"
    assert re.search(r"\(converted at saved average rate, from USD at \d", estimate["short"]), estimate["short"]


def test_a_kpi_unit_currency_is_converted_into_the_reporting_currency(ns, monkeypatch):
    _widget(ns, monkeypatch, "AED")
    estimate = _estimate(ns, make_uc("N01-U01", KPIs=[_kpi(ns, unit="EUR")], use_case_kind="forecast"))
    assert estimate["currency"] == "AED"
    assert estimate["currency_source"] == "converted from EUR"


def test_a_column_currency_is_converted_into_the_reporting_currency(ns, monkeypatch):
    _widget(ns, monkeypatch, "AED")
    estimate = _estimate(ns, make_uc("N01-U01", KPIs=[_kpi(ns, column="amount_gbp")], use_case_kind="forecast"))
    assert estimate["currency"] == "AED"
    assert estimate["currency_source"] == "converted from GBP"


def test_no_reporting_currency_and_no_other_currency_stays_unknown(ns, monkeypatch):
    _widget(ns, monkeypatch, "")
    estimate = _estimate(ns, make_uc("N01-U01", KPIs=[_kpi(ns)], use_case_kind="forecast"))
    assert estimate["currency"] is None and estimate["short"].endswith("(currency not known)")


def _widget_map(ns, monkeypatch, **widgets):
    monkeypatch.setitem(ns, "INSPIRE_SETTINGS_APPLIED", widgets)


def test_a_card_whose_currency_was_assumed_says_so_in_its_label(ns, monkeypatch):
    _widget_map(ns, monkeypatch, currency="AED")
    estimate = _estimate(ns, make_uc("N01-U01", KPIs=[_kpi(ns)], use_case_kind="forecast"))
    assert estimate["short"] == "AED 2.4K-6K a year (currency assumed: AED (reporting currency))"


def test_a_kpi_in_another_currency_is_converted_to_the_reporting_currency_at_the_app_rate(ns, monkeypatch):
    _widget_map(ns, monkeypatch, currency="AED", currency_rates='{"source": "live", "rates": {"EUR": 4.28}}')
    estimate = _estimate(ns, make_uc("N01-U01", KPIs=[_kpi(ns, unit="EUR")], use_case_kind="forecast"))
    assert estimate["currency"] == "AED"
    assert estimate["currency_source"] == "converted from EUR"
    assert estimate["short"] == "AED 10.3K-25.7K a year (converted at today's rate, from EUR at 4.28)"
    assert "measured: 29,589 EUR" in estimate["text"], "the measured baseline stays in the currency it was measured in"


def test_a_currency_with_no_rate_is_not_converted_and_the_label_says_why(ns, monkeypatch):
    _widget_map(ns, monkeypatch, currency="AED", currency_rates='{"source": "live", "rates": {"USD": 3.67}}')
    estimate = _estimate(ns, make_uc("N01-U01", KPIs=[_kpi(ns, unit="EUR")], use_case_kind="forecast"))
    assert estimate["currency"] == "EUR"
    assert estimate["short"] == "EUR 2.4K-6K a year (not converted to AED: no rate for EUR)"


def test_unreadable_rates_are_ignored_not_guessed(ns, monkeypatch):
    _widget_map(ns, monkeypatch, currency="AED", currency_rates="not json")
    estimate = _estimate(ns, make_uc("N01-U01", KPIs=[_kpi(ns, unit="EUR")], use_case_kind="forecast"))
    assert estimate["short"] == "EUR 2.4K-6K a year (not converted to AED: no rate for EUR)"


def test_the_same_currency_as_the_reporting_currency_is_never_converted(ns, monkeypatch):
    _widget_map(ns, monkeypatch, currency="AED", currency_rates='{"source": "live", "rates": {"AED": 9.9}}')
    estimate = _estimate(ns, make_uc("N01-U01", KPIs=[_kpi(ns, unit="AED")], use_case_kind="forecast"))
    assert estimate["short"] == "AED 2.4K-6K a year"
    assert estimate["currency_source"] == "KPI unit"


def test_rates_the_app_fetched_from_the_saved_averages_are_labelled_as_saved(ns, monkeypatch):
    _widget_map(ns, monkeypatch, currency="AED", currency_rates='{"source": "saved", "rates": {"EUR": 4.28}}')
    estimate = _estimate(ns, make_uc("N01-U01", KPIs=[_kpi(ns, unit="EUR")], use_case_kind="forecast"))
    assert estimate["short"] == "AED 10.3K-25.7K a year (converted at saved average rate, from EUR at 4.28)"


def test_no_rates_widget_reads_the_saved_averages_bundled_with_the_notebook(ns, monkeypatch):
    _widget_map(ns, monkeypatch, currency="AED", currency_rates="")
    table = '{"per_usd": {"AED": 3.6725, "EUR": 0.8, "USD": 1.0}, "pegged": {"per_usd": {}}}'
    real = ns["inspire_notebook_asset"]
    monkeypatch.setitem(ns, "inspire_notebook_asset", lambda name: table if name == "fx_averages" else real(name))
    estimate = _estimate(ns, make_uc("N01-U01", KPIs=[_kpi(ns, unit="EUR")], use_case_kind="forecast"))
    assert estimate["currency"] == "AED"
    assert "(converted at saved average rate, from EUR at 4.5906)" in estimate["short"], estimate["short"]


def test_no_rates_and_no_bundled_averages_is_not_converted_and_does_not_crash(ns, monkeypatch):
    _widget_map(ns, monkeypatch, currency="AED", currency_rates="")
    real = ns["inspire_notebook_asset"]

    def no_bundled_averages(name):
        if name == "fx_averages":
            raise OSError("no assets")
        return real(name)

    monkeypatch.setitem(ns, "inspire_notebook_asset", no_bundled_averages)
    estimate = _estimate(ns, make_uc("N01-U01", KPIs=[_kpi(ns, unit="EUR")], use_case_kind="forecast"))
    assert estimate["currency"] == "EUR"
    assert estimate["short"] == "EUR 2.4K-6K a year (not converted to AED: no rate for EUR)"
