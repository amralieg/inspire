"""R12 U7c (R12.5, the rest of R12.6): where value assumptions come from, and how confidence and cost show on a card.

R12.5: each sourced assumption comes from, in this order, a measured local outcome, a value the owner provides, a cited and versioned
library entry keyed by lever x pattern (never by industry), or a labelled exploratory value. The LLM picks a library entry by id,
never the number. Owner values and library entries stay labelled assumptions and pass a unit and a bound check.
The library ships as app/shared/value_assumption_library.json, read by the notebook (as a pinned asset) and by the App.

R12.6: separate confidence for baseline, effect and cost, used as a gate and never as a multiplier; gross value plus net value
under an editable S/M/L cost tier labelled exploratory, implementation and recurring cost kept apart; a negative net is shown.

REQ-573. Contract: the a04_value_library brief. The builder edits neither this file nor its fixtures."""
import copy
import json
import math
import os
import re

from v120_artifacts_support import make_uc

HERE = os.path.dirname(os.path.abspath(__file__))
SHARED = os.path.normpath(os.path.join(HERE, "..", "..", "..", "shared"))
LIBRARY_FILE = os.path.join(SHARED, "value_assumption_library.json")
SPEC_CASES = {case["id"]: case for case in json.load(open(os.path.join(SHARED, "value_spec_fixtures.json"), encoding="utf-8"))["cases"]}
MECHANISMS = {"revenue", "cost", "working_capital", "capacity", "risk", "non_financial"}
PARAMETERS = {"effect", "adoption", "realization", "margin", "carrying_cost_rate"}
ENTRY_KEYS = {"id", "version", "lever", "pattern", "parameter", "unit", "low", "base", "high", "bounds", "citation"}
CITATION_KEYS = {"title", "publisher", "year", "url"}
TRIO = ("low", "base", "high")
# Words that would mean a library entry is keyed by industry. Checked only against the key fields (id, lever, pattern, parameter)
# and the key names of the file; a citation title may name the study it comes from.
INDUSTRY_KEYS = {"industry", "sector", "vertical", "segment", "naics", "sic", "customer"}
INDUSTRY_WORDS = {"retail", "bank", "banking", "telecom", "telco", "airline", "aviation", "insurance", "insurer", "healthcare",
                  "hospital", "pharma", "manufacturing", "energy", "utility", "utilities", "oil", "gas", "mining", "hospitality",
                  "hotel", "grocery", "ecommerce", "logistics", "automotive", "government", "public_sector", "education", "media"}

# A small library for the behaviour tests (the shipped file is checked separately). Patterns are Inspire's analytics families.
LIBRARY = {
    "version": 3,
    "about": "test library",
    "entries": [
        {"id": "LIB-REV-PREDICT-EFFECT", "version": 2, "lever": "revenue", "pattern": "predict", "parameter": "effect", "unit": "share",
         "low": 0.03, "base": 0.04, "high": 0.06, "bounds": {"min": 0.0, "max": 0.2},
         "citation": {"title": "Study A", "publisher": "Publisher A", "year": 2024, "url": "https://example.org/a"}},
        {"id": "LIB-REV-PREDICT-ADOPTION", "version": 1, "lever": "revenue", "pattern": "predict", "parameter": "adoption", "unit": "share",
         "low": 0.4, "base": 0.6, "high": 0.8, "bounds": {"min": 0.1, "max": 1.0},
         "citation": {"title": "Study B", "publisher": "Publisher B", "year": 2023, "url": "https://example.org/b"}},
        {"id": "LIB-COST-DETECT-EFFECT", "version": 1, "lever": "cost", "pattern": "detect_protect", "parameter": "effect", "unit": "share",
         "low": 0.06, "base": 0.1, "high": 0.14, "bounds": {"min": 0.0, "max": 0.3},
         "citation": {"title": "Study C", "publisher": "Publisher C", "year": 2025, "url": "https://example.org/c"}},
    ],
    "cost_tiers": {"currency": "USD", "source": "exploratory",
                   "tiers": {"S": {"implementation": 25000, "recurring_per_year": 5000},
                             "M": {"implementation": 80000, "recurring_per_year": 20000},
                             "L": {"implementation": 250000, "recurring_per_year": 60000}}},
}
LIB_BY_ID = {entry["id"]: entry for entry in LIBRARY["entries"]}


def fn(agent_ns, name, req):
    found = agent_ns.get(name)
    assert callable(found), f"{req}: the notebook defines no {name}"
    return found


def resolve(agent_ns, picks, mechanism="revenue", pattern="predict", library=None):
    out = fn(agent_ns, "inspire_value_assumptions", "R12.5")(copy.deepcopy(picks), mechanism, pattern,
                                                             copy.deepcopy(LIBRARY if library is None else library))
    assert isinstance(out, dict) and isinstance(out.get("sourced"), dict) and isinstance(out.get("flags"), list), out
    return out


def trio(item):
    return tuple(item[key] for key in TRIO)


def calc(agent_ns, spec):
    return fn(agent_ns, "inspire_value_calculate", "R12.1")(copy.deepcopy(spec))


def numbers(out):
    return json.dumps({key: out[key] for key in ("annual_exposure", "balance", "one_percent", "scenarios", "break_even_effect")},
                      sort_keys=True)


def shipped_library():
    assert os.path.isfile(LIBRARY_FILE), "R12.5: app/shared/value_assumption_library.json (the cited, versioned library) does not exist"
    return json.load(open(LIBRARY_FILE, encoding="utf-8"))


def all_keys(value):
    if isinstance(value, dict):
        for key, inner in value.items():
            yield key
            yield from all_keys(inner)
    elif isinstance(value, list):
        for inner in value:
            yield from all_keys(inner)


# --- the shipped library file (static) ---

def test_every_shipped_library_entry_is_cited_versioned_and_bounded(agent_ns):
    library = shipped_library()
    assert isinstance(library.get("version"), int) and library["version"] >= 1, "the library file carries an integer version"
    entries = library.get("entries")
    assert isinstance(entries, list) and len(entries) >= 6, "at least 6 entries"
    patterns = set(agent_ns["INSPIRE_VALUE_UPLIFT"])
    ids = [entry.get("id") for entry in entries]
    assert len(set(ids)) == len(ids) and all(isinstance(ident, str) and ident for ident in ids), ids
    for entry in entries:
        assert set(entry) == ENTRY_KEYS, (entry.get("id"), sorted(set(entry) ^ ENTRY_KEYS))
        assert isinstance(entry["version"], int) and entry["version"] >= 1, entry["id"]
        assert entry["lever"] in MECHANISMS and entry["pattern"] in patterns and entry["parameter"] in PARAMETERS, entry["id"]
        assert entry["unit"] == "share", entry["id"]
        bounds = entry["bounds"]
        assert set(bounds) == {"min", "max"}, entry["id"]
        assert 0 <= bounds["min"] <= entry["low"] <= entry["base"] <= entry["high"] <= bounds["max"] <= 1, entry["id"]
        citation = entry["citation"]
        assert set(citation) == CITATION_KEYS and all(str(citation[key]).strip() for key in CITATION_KEYS), entry["id"]
        assert str(citation["url"]).startswith("https://") and 1990 <= int(citation["year"]) <= 2026, entry["id"]
    assert len({entry["lever"] for entry in entries}) >= 3 and len({entry["pattern"] for entry in entries}) >= 4, \
        "the library spans at least 3 levers and 4 patterns"


def test_no_library_entry_is_keyed_by_industry():
    library = shipped_library()
    keys = {str(key).lower() for key in all_keys(library)}
    assert not keys & INDUSTRY_KEYS, f"industry-shaped keys in the library: {sorted(keys & INDUSTRY_KEYS)}"
    for entry in library["entries"]:
        words = set(re.split(r"[^a-z]+", " ".join(str(entry[key]).lower() for key in ("id", "lever", "pattern", "parameter"))))
        assert not words & INDUSTRY_WORDS, (entry["id"], sorted(words & INDUSTRY_WORDS))


def test_the_shipped_cost_tiers_are_exploratory_with_implementation_and_recurring_apart():
    tiers = shipped_library().get("cost_tiers")
    assert isinstance(tiers, dict), "R12.6: the library carries default S/M/L cost tiers"
    assert re.fullmatch(r"[A-Z]{3}", str(tiers.get("currency"))) and tiers.get("source") == "exploratory", tiers
    held = tiers["tiers"]
    assert set(held) == {"S", "M", "L"}
    for part in ("implementation", "recurring_per_year"):
        assert all(set(held[tier]) == {"implementation", "recurring_per_year"} for tier in held)
        assert 0 < held["S"][part] < held["M"][part] < held["L"][part], part


def test_the_notebook_reads_the_same_library_file_the_app_reads(agent_ns):
    loaded = fn(agent_ns, "inspire_value_library", "R12.5")()
    assert loaded == shipped_library(), "the notebook's library (asset value_library) must be app/shared/value_assumption_library.json"
    assert agent_ns["INSPIRE_NOTEBOOK_ASSETS"].get("value_library", {}).get("repo") == "../shared/value_assumption_library.json"


# --- R12.5: the source order and the checks ---

def test_measured_beats_owner_beats_library_beats_exploratory(agent_ns):
    pick = {"measured": {"low": 0.01, "base": 0.015, "high": 0.02},
            "owner": {"low": 0.05, "base": 0.07, "high": 0.09, "unit": "share"},
            "library_id": "LIB-REV-PREDICT-EFFECT",
            "exploratory": {"low": 0.02, "base": 0.035, "high": 0.05}}
    order = [("measured", (0.01, 0.015, 0.02)), ("owner", (0.05, 0.07, 0.09)), ("library", (0.03, 0.04, 0.06)),
             ("exploratory", (0.02, 0.035, 0.05))]
    for source, expected in order:
        got = resolve(agent_ns, {"effect": pick})["sourced"]["effect"]
        assert got["source"] == source and trio(got) == expected, (source, got)
        pick.pop({"measured": "measured", "owner": "owner", "library": "library_id", "exploratory": "exploratory"}[source])
    assert "effect" not in resolve(agent_ns, {"effect": pick})["sourced"], "no source at all leaves the effect out (the calculator flags it)"


def test_the_llm_picks_a_library_entry_by_id_never_the_number(agent_ns):
    pick = {"library_id": "LIB-REV-PREDICT-EFFECT", "low": 0.5, "base": 0.6, "high": 0.7}
    got = resolve(agent_ns, {"effect": pick})["sourced"]["effect"]
    assert trio(got) == (0.03, 0.04, 0.06), "numbers next to a library id are ignored; the entry's numbers are used"
    assert got["library_id"] == "LIB-REV-PREDICT-EFFECT" and got["library_version"] == 2, got
    assert got["citation"] == LIB_BY_ID["LIB-REV-PREDICT-EFFECT"]["citation"], got


def test_an_unknown_library_id_is_flagged_and_never_used(agent_ns):
    out = resolve(agent_ns, {"effect": {"library_id": "LIB-DOES-NOT-EXIST", "exploratory": {"low": 0.02, "base": 0.03, "high": 0.04}}})
    assert "effect_library_unknown" in out["flags"], out
    got = out["sourced"]["effect"]
    assert got["source"] == "exploratory" and trio(got) == (0.02, 0.03, 0.04) and "library_id" not in got, got


def test_a_library_entry_for_another_lever_pattern_or_parameter_is_flagged_and_never_used(agent_ns):
    for picked in ("LIB-COST-DETECT-EFFECT", "LIB-REV-PREDICT-ADOPTION"):
        out = resolve(agent_ns, {"effect": {"library_id": picked}})
        assert "effect_library_mismatch" in out["flags"] and "effect" not in out["sourced"], (picked, out)
    out = resolve(agent_ns, {"effect": {"library_id": "LIB-REV-PREDICT-EFFECT"}}, pattern="detect_protect")
    assert "effect_library_mismatch" in out["flags"] and "effect" not in out["sourced"], out


def test_an_owner_value_outside_its_bounds_is_flagged_and_not_used(agent_ns):
    out = resolve(agent_ns, {"effect": {"owner": {"low": 0.25, "base": 0.3, "high": 0.4, "unit": "share"},
                                        "library_id": "LIB-REV-PREDICT-EFFECT"}})
    assert "effect_owner_out_of_bounds" in out["flags"], "the library entry for revenue x predict x effect bounds it at 0.2"
    assert out["sourced"]["effect"]["source"] == "library", out
    out = resolve(agent_ns, {"realization": {"owner": {"low": 0.8, "base": 1.1, "high": 1.3, "unit": "share"}}})
    assert "realization_owner_out_of_bounds" in out["flags"] and "realization" not in out["sourced"], "with no entry the bound is [0, 1]"
    inside = resolve(agent_ns, {"effect": {"owner": {"low": 0.1, "base": 0.15, "high": 0.2, "unit": "share"}}})
    assert inside["sourced"]["effect"]["source"] == "owner" and not inside["flags"], inside


def test_an_owner_value_in_another_unit_or_no_unit_is_flagged_and_not_used(agent_ns):
    for owner in ({"low": 2, "base": 3, "high": 5, "unit": "percent"}, {"low": 0.02, "base": 0.03, "high": 0.05}):
        out = resolve(agent_ns, {"effect": {"owner": owner, "exploratory": {"low": 0.01, "base": 0.02, "high": 0.03}}})
        assert "effect_owner_unit_mismatch" in out["flags"] and out["sourced"]["effect"]["source"] == "exploratory", (owner, out)


def test_owner_library_and_exploratory_values_stay_labelled_assumptions(agent_ns):
    out = resolve(agent_ns, {"effect": {"library_id": "LIB-REV-PREDICT-EFFECT"},
                             "adoption": {"owner": {"low": 0.5, "base": 0.6, "high": 0.7, "unit": "share"}},
                             "realization": {"exploratory": {"low": 0.7, "base": 0.8, "high": 0.9}},
                             "margin": {"measured": {"low": 0.3, "base": 0.3, "high": 0.3}}})["sourced"]
    assert [out[name]["assumption"] for name in ("effect", "adoption", "realization")] == [True, True, True], out
    assert out["margin"]["assumption"] is False and out["margin"]["source"] == "measured", out
    assert out["adoption"]["unit"] == "share" and out["effect"]["unit"] == "share", out


def test_resolved_assumptions_feed_the_one_calculator_unchanged(agent_ns):
    spec = copy.deepcopy(SPEC_CASES["revenue_at_margin"]["spec"])
    resolved = resolve(agent_ns, {"effect": {"library_id": "LIB-REV-PREDICT-EFFECT"},
                                  "adoption": {"library_id": "LIB-REV-PREDICT-ADOPTION"},
                                  "realization": {"exploratory": {"low": 0.8, "base": 0.9, "high": 1.0}},
                                  "margin": {"owner": {"low": 0.3, "base": 0.3, "high": 0.3, "unit": "share"}}})
    spec["sourced"] = resolved["sourced"]
    out = calc(agent_ns, spec)
    assert out["ok"], out["problems"]
    assert math.isclose(out["scenarios"]["base"]["change"], 12000000 * 0.04 * 0.6 * 0.9, rel_tol=1e-9), out["scenarios"]["base"]


def test_the_resolver_never_changes_its_inputs(agent_ns):
    picks = {"effect": {"owner": {"low": 0.25, "base": 0.3, "high": 0.4, "unit": "share"}, "library_id": "LIB-REV-PREDICT-EFFECT"}}
    library, held = copy.deepcopy(LIBRARY), copy.deepcopy(picks)
    first = fn(agent_ns, "inspire_value_assumptions", "R12.5")(picks, "revenue", "predict", library)
    assert picks == held and library == LIBRARY, "the resolver mutated its picks or the library"
    assert json.dumps(first, sort_keys=True) == json.dumps(resolve(agent_ns, held), sort_keys=True)


# --- R12.6: confidence is a gate, cost tiers, negative net ---

def _all_sources(spec, source):
    spec = copy.deepcopy(spec)
    for item in spec["sourced"].values():
        item["source"] = source
    spec["cost"]["source"] = source
    return spec


def test_baseline_effect_and_cost_confidence_are_reported_separately(agent_ns):
    base = SPEC_CASES["revenue_at_margin"]["spec"]
    out = calc(agent_ns, _all_sources(base, "measured"))
    assert out["confidence"] == {"baseline": "high", "effect": "high", "cost": "high"}, out.get("confidence")
    assert out["gate"]["level"] == "high" and out["gate"]["headline"] is True, out.get("gate")
    owner = calc(agent_ns, _all_sources(base, "owner"))
    assert owner["confidence"] == {"baseline": "high", "effect": "medium", "cost": "medium"}, owner["confidence"]
    mixed = calc(agent_ns, base)  # effect and realization exploratory, cost exploratory
    assert mixed["confidence"] == {"baseline": "high", "effect": "low", "cost": "low"}, mixed["confidence"]
    assert mixed["gate"] == {"level": "low", "headline": False, "weakest": ["cost", "effect"]}, mixed["gate"]
    full = _all_sources(base, "measured")
    del full["sourced"]["adoption"]
    assert calc(agent_ns, full)["confidence"]["effect"] == "low", "an adoption assumed at 100% is a low-confidence effect"
    weak = _all_sources(base, "measured")
    weak["measured"]["confidence"] = "low"
    assert calc(agent_ns, weak)["gate"] == {"level": "low", "headline": False, "weakest": ["baseline"]}
    nocost = _all_sources(base, "measured")
    del nocost["cost"]
    out = calc(agent_ns, nocost)
    assert out["confidence"]["cost"] is None and out["gate"]["headline"] is False and "cost" in out["gate"]["weakest"], out["gate"]


def test_confidence_is_a_gate_never_a_multiplier(agent_ns):
    base = SPEC_CASES["revenue_at_margin"]["spec"]
    variants = [base] + [_all_sources(base, source) for source in ("measured", "owner", "library", "exploratory")]
    weak = _all_sources(base, "measured")
    weak["measured"]["confidence"] = "low"
    outs = [calc(agent_ns, spec) for spec in variants + [weak]]
    assert len({out["gate"]["level"] for out in outs}) == 3, "the variants span high, medium and low confidence"
    assert len({numbers(out) for out in outs}) == 1, "a confidence level changed a number: confidence may gate, never scale"
    assert outs[0]["scenarios"]["base"]["gross_annual"] == SPEC_CASES["revenue_at_margin"]["expected"]["scenarios"]["base"]["gross_annual"]


def test_the_cost_tier_is_labelled_and_keeps_implementation_and_recurring_apart(agent_ns):
    spec = copy.deepcopy(SPEC_CASES["revenue_at_margin"]["spec"])
    out = calc(agent_ns, spec)
    assert out["cost"] == {"source": "exploratory", "label": "exploratory", "editable": True, "tiers": spec["cost"]["tiers"]}, out.get("cost")
    spec["cost"]["source"] = "owner"
    assert calc(agent_ns, spec)["cost"]["label"] == "assumption"
    horizon = spec["horizon_years"]
    before = calc(agent_ns, spec)["scenarios"]["base"]["net"]["M"]
    spec["cost"]["tiers"]["M"]["implementation"] += 1000
    after_implementation = calc(agent_ns, spec)["scenarios"]["base"]["net"]["M"]
    spec["cost"]["tiers"]["M"]["recurring_per_year"] += 1000
    after_recurring = calc(agent_ns, spec)["scenarios"]["base"]["net"]["M"]
    assert math.isclose(before - after_implementation, 1000, abs_tol=0.01), "implementation is paid once"
    assert math.isclose(after_implementation - after_recurring, 1000 * horizon, abs_tol=0.01), "recurring is paid every year"
    del spec["cost"]
    assert calc(agent_ns, spec)["cost"] is None


def test_default_cost_tiers_are_exploratory_editable_and_never_assume_a_currency(agent_ns):
    default = fn(agent_ns, "inspire_value_default_cost", "R12.6")
    same = default(copy.deepcopy(LIBRARY), "USD")
    assert same == {"source": "exploratory", "editable": True, "currency": "USD", "tiers": LIBRARY["cost_tiers"]["tiers"]}, same
    other = default(copy.deepcopy(LIBRARY), "EUR", per_usd=0.9)
    assert other["currency"] == "EUR" and other["source"] == "exploratory", other
    for tier, held in LIBRARY["cost_tiers"]["tiers"].items():
        for part in ("implementation", "recurring_per_year"):
            assert math.isclose(other["tiers"][tier][part], held[part] * 0.9, rel_tol=1e-9), (tier, part, other)
    assert default(copy.deepcopy(LIBRARY), "EUR") is None, "no rate: no cost tier, never a USD number shown as EUR"
    assert default(copy.deepcopy(LIBRARY), None) is None and default(copy.deepcopy(LIBRARY), "usd") is None


# --- the card (inspire_value_estimate) ---

def _kpi(ns, unit="USD", direction="reduce", value=1000.0, window=90):
    return {"name": "Monthly loss value", "unit": unit, "direction": direction, "aggregation": "SUM", "table": "c.s.events",
            "column": "amount", "computable": True, "query": "SELECT 1", "window_days": window,
            "baseline": {"value": value, "window_days": window, "measured_on": "2026-11-01", "window_anchor": ns["KPI_WINDOW_ANCHOR"]}}


def _card(ns, monkeypatch, user_text="", family="detect_protect", **extra):
    monkeypatch.setitem(ns, "inspire_value_library", lambda: copy.deepcopy(LIBRARY))
    uc = make_uc("N01-U01", KPIs=[_kpi(ns)], use_case_kind="forecast", **extra)
    return ns["inspire_value_estimate"](uc, user_text, family, ns["inspire_use_case_kind"](uc))


def test_the_card_shows_a_negative_net_value_under_exploratory_cost_tiers(agent_ns, monkeypatch):
    card = _card(agent_ns, monkeypatch)
    assert card["status"] == "measured", card
    assert isinstance(card.get("net"), dict) and set(card["net"]) == {"S", "M", "L"}, "R12.6: the card carries the base net per tier"
    assert all(card["net"][tier] < 0 for tier in card["net"]), card["net"]
    assert card.get("net_negative") is True, card
    assert card["cost"]["label"] == "exploratory" and card["cost"]["editable"] is True, card.get("cost")
    assert re.search(r"\bnet\b.*?(?:[-−]\s?(?:[A-Z]{3}\s?)?\d|[A-Z]{3}\s?[-−]\s?\d)", card["text"], re.I), card["text"]


def test_the_card_takes_a_library_entry_by_id_and_an_owner_range_still_wins(agent_ns, monkeypatch):
    real = fn(agent_ns, "inspire_value_calculate", "R12.1")
    seen = []
    monkeypatch.setitem(agent_ns, "inspire_value_calculate", lambda spec: seen.append(copy.deepcopy(spec)) or real(spec))
    _card(agent_ns, monkeypatch, value_library_ids={"effect": "LIB-COST-DETECT-EFFECT"})
    effect = seen[-1]["sourced"]["effect"]
    assert effect["source"] == "library" and effect["library_id"] == "LIB-COST-DETECT-EFFECT" and trio(effect) == (0.06, 0.1, 0.14), effect
    assert seen[-1]["cost"]["source"] == "exploratory", seen[-1].get("cost")
    _card(agent_ns, monkeypatch, "We expect a reduction of 10-20%", value_library_ids={"effect": "LIB-COST-DETECT-EFFECT"})
    effect = seen[-1]["sourced"]["effect"]
    assert effect["source"] == "owner" and (effect["low"], effect["high"]) == (0.1, 0.2), effect
