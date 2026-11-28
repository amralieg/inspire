"""a04_value_sign (R12.7 sign handling, R12.6): a value the calculator rejects is never shown as a measured number.

inspire_value_estimate drops baselines <= 0 before pricing (_inspire_kpi_plain), so these tests call the pricing step
_inspire_value_measured directly: a negative exposure must come back "not measured yet" with its reason, never a silent 0
(which reads as measured evidence of no value) and never a negative range.
"""
import re

from v201_money_value_test import estimate_of, kpi, money_uc, ns  # noqa: F401  (ns is the shared fixture)


def _base():
    return {"uplift_low": 0.02, "uplift_high": 0.05, "uplift_source": "kind default"}


def test_1_negative_exposure_is_not_measured_and_shows_no_number(ns):
    spec = kpi(ns, value=-1200.0)
    estimate = ns["_inspire_value_measured"](_base(), spec, -1200.0, spec["baseline"], "")
    assert estimate["status"] == ns["INSPIRE_VALUE_NOT_MEASURED"], estimate
    assert "value_low" not in estimate and "value_high" not in estimate, estimate
    assert estimate["text"].startswith("Value not measured yet: "), estimate["text"]
    assert "negative" in estimate["text"].lower(), estimate["text"]


def test_2_positive_baseline_is_unchanged(ns):
    estimate = estimate_of(ns, money_uc(ns, kpi(ns)), "", "predict")
    yearly = 29589.0 * 365 / 90
    assert estimate["status"] == "measured"
    assert estimate["value_low"] == round(yearly * 0.02, 2) and estimate["value_high"] == round(yearly * 0.05, 2)
    assert not re.search(r"(^|\s)-\d", estimate["short"]), estimate["short"]
