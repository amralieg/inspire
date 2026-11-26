"""RC6-B-02: a one-day KPI baseline window reads "last 1 day", never "last 1 days" (rc.6 walk, T-RES-10)."""
from v130_outputs_test import kpi, make_inspire


def _spec(days, anchor=None):
    baseline = {"value": 5646, "window_days": days, "measured_on": "2026-11-25"}
    if anchor:
        baseline["window_anchor"] = anchor
    return kpi("Daily Total Revenue", unit="USD", baseline=baseline)


def test_a_one_day_window_is_singular_in_every_place_the_window_is_worded(agent_ns):
    obj = make_inspire(agent_ns)
    one = _spec(1, "newest data")
    assert obj._kpi_baseline_window(one["baseline"]) == "last 1 day to the newest data"
    assert obj._kpi_text(one, None, {}, "English") == "Daily Total Revenue (↑ USD): baseline 5,646, last 1 day to the newest data, measured 2026-11-25"
    plain = _spec(1)
    assert obj._kpi_text(plain, None, {}, "English") == "Daily Total Revenue (↑ USD): baseline 5,646, last 1 day, measured 2026-11-25"
    assert "last 1 day to the newest data" in obj._kpi_baseline_note(one, one["baseline"])


def test_many_days_stay_plural(agent_ns):
    obj = make_inspire(agent_ns)
    assert obj._kpi_baseline_window(_spec(90)["baseline"]) == "last 90 days"
