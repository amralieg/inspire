"""R12 U7a (R12.1, R12.3, the number parts of R12.6, the currency and stock-vs-flow guards of R12.7): one value spec and one pure
calculator, inspire_value_calculate(spec). The calculator gives joint low/base/high scenarios, gross value, net value under an S/M/L
cost tier (implementation and recurring kept apart), the break-even effect and the line "1% of observed exposure = X". Cash,
capacity and non-financial values sit in separate buckets and are never added. A stock balance never becomes an annual benefit.
A missing currency gives no cash number and a flag. inspire_value_estimate takes its numbers from the calculator (no second
implementation). The shared fixtures app/shared/value_spec_fixtures.json are the contract the App's runner matches too."""
import ast
import copy
import json
import math
import os

import pytest

from _agentload import agent_ast
from v120_artifacts_support import make_uc

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES = os.path.normpath(os.path.join(HERE, "..", "..", "..", "shared", "value_spec_fixtures.json"))
DATA = json.load(open(FIXTURES, encoding="utf-8"))
CASES = DATA["cases"]
MECHANISMS = {"revenue", "cost", "working_capital", "capacity", "risk", "non_financial"}


def calculator(agent_ns):
    calc = agent_ns.get("inspire_value_calculate")
    assert callable(calc), "R12.1: the notebook defines no inspire_value_calculate(spec), the one value calculator"
    return calc


def same(expected, got, path="out"):
    if isinstance(expected, dict):
        assert isinstance(got, dict), f"{path}: expected a dict, got {got!r}"
        for key, value in expected.items():
            assert key in got, f"{path}: the calculator output has no {key!r}"
            same(value, got[key], f"{path}.{key}")
    elif isinstance(expected, list):
        assert isinstance(got, list) and sorted(map(str, got)) == sorted(map(str, expected)), f"{path}: {got!r} != {expected!r}"
    elif isinstance(expected, bool) or expected is None or isinstance(expected, str):
        assert got == expected, f"{path}: {got!r} != {expected!r}"
    else:
        assert isinstance(got, (int, float)) and not isinstance(got, bool), f"{path}: {got!r} is not a number"
        assert math.isclose(got, expected, rel_tol=DATA["compare"]["rel"], abs_tol=DATA["compare"]["abs"]), f"{path}: {got} != {expected}"


def keys_of(value):
    if isinstance(value, dict):
        for key, inner in value.items():
            yield key
            yield from keys_of(inner)
    elif isinstance(value, list):
        for inner in value:
            yield from keys_of(inner)


# --- fixture integrity (passes on base: the file itself is sound) ---

def test_the_fixtures_cover_every_mechanism_and_each_guard_case():
    ids = [case["id"] for case in CASES]
    assert 10 <= len(CASES) <= 20 and len(set(ids)) == len(ids)
    assert MECHANISMS <= {case["spec"]["mechanism"] for case in CASES}
    flags = {flag for case in CASES for flag in case["expected"]["flags"]}
    assert {"currency_missing", "stock_not_annual", "net_negative", "margin_missing", "cost_missing", "period_missing"} <= flags
    assert any(case["expected"]["bucket"] == "capacity" and case["expected"]["ok"] for case in CASES)
    assert any(not case["expected"]["ok"] for case in CASES)
    for case in CASES:
        assert case["why"] and set(case["expected"]) >= {"ok", "problems", "flags", "bucket", "scenarios", "one_percent", "break_even_effect"}


# --- the shared fixtures, Python runner ---

@pytest.mark.parametrize("case", CASES, ids=[case["id"] for case in CASES])
def test_the_calculator_matches_every_shared_fixture(agent_ns, case):
    same(case["expected"], calculator(agent_ns)(copy.deepcopy(case["spec"])), case["id"])


# --- behaviour ---

def test_the_calculator_is_pure_and_never_changes_its_spec(agent_ns):
    calc = calculator(agent_ns)
    for case in CASES:
        spec = copy.deepcopy(case["spec"])
        first = calc(spec)
        assert spec == case["spec"], case["id"]
        assert json.loads(json.dumps(first)) == json.loads(json.dumps(calc(spec))), case["id"]


def test_cash_capacity_and_non_financial_are_never_added_together(agent_ns):
    calc = calculator(agent_ns)
    for case in CASES:
        out = calc(copy.deepcopy(case["spec"]))
        assert not {key for key in keys_of(out) if "total" in str(key).lower() or "sum" == str(key).lower()}, (case["id"], out)
        if out["ok"] and out["bucket"] != "cash":
            assert all(row["gross_annual"] is None and row["net"] is None for row in out["scenarios"].values()), case["id"]
            assert out["break_even_effect"] is None, case["id"]


def test_a_stock_balance_never_becomes_an_annual_benefit_for_any_mechanism(agent_ns):
    calc = calculator(agent_ns)
    base = next(case["spec"] for case in CASES if case["id"] == "revenue_at_margin")
    for mechanism in sorted(MECHANISMS - {"working_capital"}):
        spec = copy.deepcopy(base)
        spec.update(mechanism=mechanism, flow_or_stock="stock")
        spec["measured"]["unit"] = "hours"
        out = calc(spec)
        assert out["ok"] and "stock_not_annual" in out["flags"] and out["annual_exposure"] is None, (mechanism, out)
        assert all(row[key] is None for row in out["scenarios"].values() for key in ("change", "gross_annual", "net")), mechanism


def test_the_currency_is_never_taken_from_the_reporting_currency_widget(agent_ns, monkeypatch):
    monkeypatch.setitem(agent_ns, "INSPIRE_SETTINGS_APPLIED", {"currency": "USD"})
    spec = next(case["spec"] for case in CASES if case["id"] == "missing_currency_no_cash")
    out = calculator(agent_ns)(copy.deepcopy(spec))
    assert "currency_missing" in out["flags"] and out["unit"] is None and out["one_percent"] is None, out
    assert all(row["gross_annual"] is None and row["net"] is None for row in out["scenarios"].values()), out


def test_the_one_percent_line_states_its_meaning(agent_ns):
    calc = calculator(agent_ns)
    for case in CASES:
        out = calc(copy.deepcopy(case["spec"]))
        if out.get("one_percent"):
            assert isinstance(out["one_percent"].get("meaning"), str) and len(out["one_percent"]["meaning"].split()) >= 4, case["id"]


def test_net_falls_one_for_one_with_cost_and_is_never_clamped_at_zero(agent_ns):
    calc = calculator(agent_ns)
    spec = copy.deepcopy(next(case["spec"] for case in CASES if case["id"] == "negative_net_shown"))
    before = calc(spec)["scenarios"]["base"]["net"]["S"]
    spec["cost"]["tiers"]["S"]["implementation"] += 1000
    spec["cost"]["tiers"]["S"]["recurring_per_year"] += 100
    after = calc(spec)["scenarios"]["base"]["net"]["S"]
    assert before < 0 and math.isclose(before - after, 1000 + 100 * spec["horizon_years"], abs_tol=0.01), (before, after)


def test_the_spec_schema_names_the_six_mechanisms_and_the_source_labels(agent_ns):
    schema = agent_ns.get("INSPIRE_VALUE_SPEC_SCHEMA")
    assert isinstance(schema, dict), "R12.1: the notebook defines no INSPIRE_VALUE_SPEC_SCHEMA, the one value spec"
    text = json.dumps(schema)
    for word in sorted(MECHANISMS) + ["measured", "owner", "library", "exploratory", "flow", "stock", "horizon_years", "currency"]:
        assert f'"{word}"' in text, word


# --- the merge: inspire_value_estimate goes through the calculator ---

def _kpi(ns, direction="increase", value=29589.0, window=90):
    return {"name": "Weekly sales value", "unit": "AED", "direction": direction, "aggregation": "SUM", "table": "c.s.orders",
            "column": "amount", "computable": True, "query": "SELECT 1", "window_days": window,
            "baseline": {"value": value, "window_days": window, "measured_on": "2026-11-01", "window_anchor": ns["KPI_WINDOW_ANCHOR"]}}


def _estimate(ns, spec, family="predict"):
    uc = make_uc("N01-U01", KPIs=[spec], use_case_kind="forecast")
    return ns["inspire_value_estimate"](uc, "", family, ns["inspire_use_case_kind"](uc))


def test_the_value_estimate_takes_its_numbers_from_the_one_calculator(agent_ns, monkeypatch):
    real = calculator(agent_ns)
    seen = []

    def spy(spec):
        seen.append(copy.deepcopy(spec))
        out = real(spec)
        out["scenarios"]["low"]["change"], out["scenarios"]["high"]["change"] = 111.0, 222.0
        return out

    monkeypatch.setitem(agent_ns, "inspire_value_calculate", spy)
    estimate = _estimate(agent_ns, _kpi(agent_ns))
    assert len(seen) == 1, "inspire_value_estimate must call inspire_value_calculate once per measured estimate"
    spec = seen[0]
    assert spec["mechanism"] == "revenue" and spec["flow_or_stock"] == "flow" and spec["currency"] == "AED", spec
    assert spec["measured"]["exposure"] == 29589.0 and spec["measured"]["period_days"] == 90, spec
    effect = spec["sourced"]["effect"]
    assert (effect["low"], effect["high"]) == (0.02, 0.05) and effect["source"] == "exploratory", effect
    assert (estimate["value_low"], estimate["value_high"]) == (111.0, 222.0), "the estimate must show the calculator's numbers"
    seen.clear()
    _estimate(agent_ns, _kpi(agent_ns, direction="reduce"), "detect_protect")
    assert seen and seen[0]["mechanism"] == "cost", seen


def test_the_annualisation_lives_only_in_the_calculator():
    tree = agent_ast()
    holders = sorted({node.name for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)
                      and node.name.lstrip("_").startswith("inspire_value")
                      and any(isinstance(inner, ast.Constant) and inner.value == 365 for inner in ast.walk(node))})
    defined = [node.name for node in ast.walk(tree) if isinstance(node, ast.FunctionDef) and node.name == "inspire_value_calculate"]
    assert defined == ["inspire_value_calculate"], "exactly one inspire_value_calculate"
    assert holders == ["inspire_value_calculate"], f"365-day annualisation outside the one calculator: {holders}"
