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


def test_a_default_reporting_currency_is_named_as_the_default_on_the_card(ns, monkeypatch):
    _widget_map(ns, monkeypatch, currency="USD", currency_default="true")
    estimate = _estimate(ns, make_uc("N01-U01", KPIs=[_kpi(ns)], use_case_kind="forecast"))
    assert estimate["short"] == "USD 2.4K-6K a year (reporting currency USD (default))", estimate["short"]


def test_a_reporting_currency_the_person_chose_is_still_labelled_assumed(ns, monkeypatch):
    _widget_map(ns, monkeypatch, currency="AED", currency_default="false")
    estimate = _estimate(ns, make_uc("N01-U01", KPIs=[_kpi(ns)], use_case_kind="forecast"))
    assert estimate["short"] == "AED 2.4K-6K a year (currency assumed: AED (reporting currency))"


def test_a_rate_table_feed_keeps_its_table_label_and_its_rates(ns, monkeypatch):
    """REQ-103: a rule that converts from its rate table reaches the notebook as source table. The label must survive
    the feed, or the run would say the person typed the rate."""
    monkeypatch.setitem(ns, "INSPIRE_SETTINGS_APPLIED", {"currency": "AED", "currency_rates": '{"source":"table","rates":{"EUR":4.28}}'})
    rates, source, _column = ns["_inspire_reporting_rate_feed"]()
    assert source == "table"
    assert rates == {"EUR": 4.28}
    assert ns["_INSPIRE_RATE_PHRASES"]["table"] == "converted at the rate in your rate table"


def test_a_column_rate_feed_names_its_column_and_has_no_per_currency_rates(ns, monkeypatch):
    """REQ-103: a column-rate rule reaches the notebook as source column with the rate column named. Each row was converted
    with its own rate, so the feed carries no per-currency rates and the label names the column."""
    monkeypatch.setitem(ns, "INSPIRE_SETTINGS_APPLIED", {"currency": "AED", "currency_rates": '{"source":"column","column":"fx_rate","currency_column":"ccy","rates":{}}'})
    rates, source, column = ns["_inspire_reporting_rate_feed"]()
    assert (rates, source, column) == ({}, "column", "fx_rate")
    assert ns["_inspire_rate_phrase"]("column", "fx_rate") == "converted with the rate in fx_rate"


def test_the_money_brief_tells_the_dataset_to_convert_each_row_with_its_own_rate(ns):
    """REQ-103: the dataset SQL is written from this brief, so a column-rate rule must say per row, with its rate column and
    its currency column named. Without this line the SQL would apply one rate to all rows."""
    brief = ns["implement_money_brief"]({"currency": "convert", "base": "AED", "rate_column": "fx_rate", "currency_column": "ccy"})
    assert "fx_rate" in brief and "ccy" in brief
    assert "each row is converted with its own rate" in brief


def test_a_measured_value_from_a_column_rate_says_it_was_converted_with_that_column(ns, monkeypatch):
    """REQ-103: a value measured under a column-rate rule names the rate column it was converted with, on the card."""
    monkeypatch.setitem(ns, "INSPIRE_SETTINGS_APPLIED", {"currency": "AED", "currency_rates": '{"source":"column","column":"fx_rate","currency_column":"ccy","rates":{}}'})
    estimate = _estimate(ns, make_uc("N01-U01", KPIs=[_kpi(ns)], use_case_kind="forecast"))
    assert estimate["status"] == "measured"
    assert "converted with the rate in fx_rate" in estimate["short"], estimate["short"]
