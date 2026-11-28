"""R12.5: an owner range that fails its bound check is flagged on the card and is never reused as the exploratory range."""
from v201_money_value_test import kpi, ns  # noqa: F401


def _owner(low, high):
    return {"uplift_low": low, "uplift_high": high, "uplift_source": "instructions"}


def test_1_out_of_bounds_owner_range_is_not_used_under_another_label(ns):
    spec = kpi(ns, value=1000.0)
    estimate = ns["_inspire_value_measured"](_owner(1.5, 2.0), spec, 1000.0, spec["baseline"], "")
    assert estimate["status"] == "measured", estimate
    assert estimate["value_high"] < 1000.0, estimate  # the 150-200% owner range is not priced as "exploratory"
    assert "effect_owner_out_of_bounds" in (estimate.get("assumption_flags") or []), estimate
    assert "instructions" in estimate["text"] and "not used" in estimate["text"], estimate["text"]


def test_2_in_bounds_owner_range_is_used_and_unflagged(ns):
    spec = kpi(ns, value=1000.0)
    estimate = ns["_inspire_value_measured"](_owner(0.1, 0.2), spec, 1000.0, spec["baseline"], "")
    assert estimate["status"] == "measured", estimate
    assert not estimate.get("assumption_flags"), estimate
    assert "not used" not in estimate["text"], estimate["text"]
