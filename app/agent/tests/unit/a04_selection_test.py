"""a04_selection (REQ-573 R14.1, R14.2, R14.3; T-SELECTION-01): a deterministic greedy pick by conservative marginal net value.

R14.1: pick by conservative marginal net value (min over S/M/L of the low-scenario net, `Value Estimate.net_low`), recompute
overlap after each pick (fingerprints (entity, outcome, period) from the card's measured_from and per_unit), stop at 20 or when
the next pick's marginal value is under 2% of the first greedy pick's. R14.2: fewer than 10 is allowed; owner must-haves
(`user_named`, `owner_must_have`) come first, labelled, whatever their value; use cases with no comparable money figure go to a
strategic section with no money. R14.3: every left-out candidate has one reason from merged, overlapping, lacking_evidence,
lower_marginal_value; the long list, the overlaps and the gaps stay in results_json and the JSON catalog.

Pure tests call inspire_value_selection / inspire_selection_fingerprints. Run tests drive the real run() through the offline
smoke harness (v120_run_offline_smoke_test._build) with money cards stamped after the real _apply_value_estimates.
"""
import copy
import json
import logging
import os
import random
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v120_run_offline_smoke_test import _build  # noqa: E402

REASONS = {"merged", "overlapping", "lacking_evidence", "lower_marginal_value"}
ACCEPT_ALL = {"Low", "Medium", "High", "Very High", "Ultra High"}


def _fn(ns, name):
    fn = ns.get(name)
    assert callable(fn), f"R14: the notebook defines no {name}() (the greedy value selection is not built yet)"
    return fn


def card(value, fp=None, per_unit=None, currency="EUR", baseline="high", period="year"):
    table, column = fp or ("cat.sch.t_default", "amount")
    measured_from = {"table": table, "column": column, "window_days": 90, "measured_on": "2026-11-01", "baseline": 1.0}
    if per_unit:
        measured_from["per_unit"] = {"kpi": "Unit value", "table": per_unit[0], "column": per_unit[1], "value": 1.0,
                                     "measured_on": "2026-11-01"}
    value = float(value)
    return {"status": "measured", "value_low": value * 3, "value_high": value * 6,
            "net": {"S": value * 2 + 20, "M": value * 2 + 10, "L": value * 2},
            "net_low": {"S": value + 20.0, "M": value + 10.0, "L": value},
            "currency": currency, "period": period, "short": "range", "text": "range text",
            "confidence": {"baseline": baseline, "effect": "low", "cost": "medium"},
            "gate": {"level": "low", "headline": False, "weakest": ["effect"]}, "measured_from": measured_from}


NOT_MEASURED = {"status": "not measured yet", "measure": "Order count", "text": "Value not measured yet: measure order count."}


def uc(no, value=None, fp=None, estimate=None, **extra):
    out = {"No": no, "Name": f"Plan {no}", "Tables Involved": f"cat.sch.t_{no.lower()}", "Inspire Score": 7.0}
    if estimate is not None:
        out["Value Estimate"] = copy.deepcopy(estimate)
    elif value is not None:
        out["Value Estimate"] = card(value, fp or (f"cat.sch.t_{no.lower()}", "amount"), **extra.pop("card", {}))
    else:
        out["Value Estimate"] = copy.deepcopy(NOT_MEASURED)
    out.update(extra)
    return out


def select(ns, use_cases, **kw):
    return _fn(ns, "inspire_value_selection")(use_cases, **kw)


def nos(rows):
    return [row["No"] for row in rows]


def by_no(result):
    return {row["No"]: row for row in result["long_list"]}


# ---------------------------------------------------------------- pure selection


def test_1_constants_are_declared(agent_ns):
    assert agent_ns.get("INSPIRE_SELECTION_CAP") == 20
    assert agent_ns.get("INSPIRE_SELECTION_STOP_SHARE") == 0.02
    assert agent_ns.get("INSPIRE_SELECTION_REASONS") == ("merged", "overlapping", "lacking_evidence", "lower_marginal_value")
    assert agent_ns.get("INSPIRE_SELECTION_SECTIONS") == ("must_have", "selected", "strategic", "left_out")


def test_2_fingerprints_are_entity_outcome_period_from_the_card(agent_ns):
    fps = _fn(agent_ns, "inspire_selection_fingerprints")
    one = uc("A", estimate=card(10, ("`Cat`.`Sch`.`Orders`", "Amount")))
    assert fps(one) == [("cat.sch.orders", "amount", "year")]
    two = uc("B", estimate=card(10, ("cat.sch.orders", "qty"), per_unit=("cat.sch.prices", "unit_price"), period="data period"))
    assert fps(two) == [("cat.sch.orders", "qty", "data period"), ("cat.sch.prices", "unit_price", "data period")]
    assert fps(uc("C")) == [], "a use case with no measured value has no money fingerprint"


def test_3_greedy_order_is_by_conservative_value_not_input_order(agent_ns):
    cases = [uc("LOW", 100), uc("HIGH", 900), uc("MID", 400)]
    result = select(agent_ns, copy.deepcopy(cases))
    assert nos(result["selected"]) == ["HIGH", "MID", "LOW"]
    rows = by_no(result)
    assert rows["HIGH"]["conservative"] == 900.0, "conservative = min over S/M/L of net_low (the L tier here)"
    assert rows["HIGH"]["marginal"] == 900.0 and rows["HIGH"]["currency"] == "EUR"
    assert [rows[n]["rank"] for n in ("HIGH", "MID", "LOW")] == [1, 2, 3]
    # must-keep: a high base net with a low conservative value ranks by the conservative value
    lopsided = uc("LOPSIDED", estimate=dict(card(50), net={"S": 99999.0, "M": 99999.0, "L": 99999.0}))
    result = select(agent_ns, [lopsided, uc("STEADY", 300)])
    assert nos(result["selected"]) == ["STEADY", "LOPSIDED"], "the base-scenario net never drives the order"


def test_4_overlap_is_recomputed_after_each_pick(agent_ns):
    a, b, c = ("cat.sch.f1", "amount"), ("cat.sch.f2", "amount"), ("cat.sch.f3", "amount")
    cases = [uc("X", 100, a), uc("Y", 90, a, card={"per_unit": b}), uc("Z", 60, c), uc("W", 80, a)]
    result = select(agent_ns, cases)
    assert nos(result["selected"]) == ["X", "Z", "Y"], ("a static ranking gives X, Y(90), W(80), Z; after X claims (f1), "
                                                     "Y keeps half its value (45) and W none")
    rows = by_no(result)
    assert rows["Y"]["marginal"] == pytest.approx(45.0) and rows["Y"]["conservative"] == 90.0
    assert rows["W"]["section"] == "left_out" and rows["W"]["reason"] == "merged" and rows["W"]["merged_into"] == "X"
    assert rows["W"]["marginal"] == 0.0
    pairs = {(o["use_case"], o["with"]) for o in result["overlaps"]}
    assert ("W", "X") in pairs and ("Y", "X") in pairs, result["overlaps"]
    assert ("Z", "X") not in pairs, "Z shares no fingerprint with X"


def test_5_stop_at_twenty(agent_ns):
    cases = [uc(f"C{i:02d}", 1000 - i) for i in range(25)]
    result = select(agent_ns, cases)
    assert len(result["selected"]) == 20 and nos(result["selected"]) == [f"C{i:02d}" for i in range(20)]
    rows = by_no(result)
    assert all(rows[f"C{i:02d}"]["reason"] == "lower_marginal_value" for i in range(20, 25))
    assert result["stop"]["reason"] == "cap" and result["stop"]["cap"] == 20
    assert len(select(agent_ns, cases[:20])["selected"]) == 20, "must-keep: exactly 20 is not cut"


def test_6_stop_when_marginal_value_is_under_two_percent_of_the_first_pick(agent_ns):
    a = ("cat.sch.f1", "amount")
    cases = [uc("FIRST", 1000, a), uc("KEEP25", 25), uc("EDGE20", 20), uc("DROP19", 19),
             uc("HALVED", 30, ("cat.sch.f9", "amount"), card={"per_unit": a})]
    result = select(agent_ns, cases)
    assert nos(result["selected"]) == ["FIRST", "KEEP25", "EDGE20"], "20 is exactly 2% of 1000 and is not under it"
    rows = by_no(result)
    assert rows["DROP19"]["reason"] == "lower_marginal_value"
    assert rows["HALVED"]["reason"] == "overlapping" and rows["HALVED"]["marginal"] == pytest.approx(15.0)
    assert rows["HALVED"]["overlaps_with"] == ["FIRST"]
    assert result["stop"]["reason"] == "marginal_floor" and result["stop"]["floor"] == pytest.approx(20.0)
    negative = select(agent_ns, [uc("POS", 500), uc("NEG", -40)])
    assert nos(negative["selected"]) == ["POS"] and by_no(negative)["NEG"]["reason"] == "lower_marginal_value", \
        "a negative conservative net never qualifies"


def test_7_must_haves_come_first_and_labelled_even_when_low_value(agent_ns):
    a = ("cat.sch.f1", "amount")
    cases = [uc("BIG", 1000), uc("NAMED", 5, a, user_named="Plan NAMED"), uc("DUP", 800, a), uc("SECOND", 500),
             uc("FLAGGED", owner_must_have=True)]
    result = select(agent_ns, cases)
    order = nos(result["selected"])
    assert order[:2] == ["NAMED", "FLAGGED"] or order[:2] == ["FLAGGED", "NAMED"], order
    assert order[2:] == ["BIG", "SECOND"], "the 2% floor is set by the first greedy pick (BIG), never by a must-have"
    rows = by_no(result)
    assert rows["NAMED"]["section"] == "must_have" and rows["FLAGGED"]["section"] == "must_have"
    assert rows["NAMED"]["label"] and rows["FLAGGED"]["label"], "each must-have carries a visible label"
    assert rows["BIG"]["section"] == "selected" and not rows["BIG"].get("label")
    assert rows["DUP"]["reason"] == "merged" and rows["DUP"]["merged_into"] == "NAMED", \
        "a must-have claims its fingerprints first"
    assert result["stop"]["floor"] == pytest.approx(20.0)
    many = [uc(f"M{i:02d}", 1, user_named=f"Plan M{i:02d}") for i in range(22)] + [uc("OTHER", 10000)]
    crowded = select(agent_ns, many)
    assert len(crowded["selected"]) == 22 and by_no(crowded)["OTHER"]["reason"] == "lower_marginal_value", \
        "must-haves count toward the 20 and are never cut"


def test_8_no_money_use_cases_go_to_a_strategic_section_without_money(agent_ns):
    cases = [uc("MONEY", 700), uc("UNMEASURED"), uc("NOCCY", 300, card={"currency": None}),
             uc("OTHERCCY", 400, card={"currency": "GBP"}), uc("MONEY2", 650)]
    result = select(agent_ns, cases)
    assert nos(result["selected"]) == ["MONEY", "MONEY2"]
    assert sorted(nos(result["strategic"])) == ["NOCCY", "OTHERCCY", "UNMEASURED"]
    assert result["currency"] == "EUR", "the money section is ranked in the currency most money candidates hold"
    for row in result["strategic"]:
        assert row["section"] == "strategic" and row.get("conservative") is None and row.get("marginal") is None
        assert not row.get("currency") and row.get("rank") is None, row
        text = json.dumps(row)
        assert "EUR" not in text and "GBP" not in text and not re.search(r"\b(300|400|900|1200)(\.0)?\b", text), text


def test_9_fewer_than_ten_is_allowed(agent_ns):
    a = ("cat.sch.f1", "amount")
    result = select(agent_ns, [uc("ONLY", 900, a), uc("TWIN1", 500, a), uc("TWIN2", 400, a)])
    assert nos(result["selected"]) == ["ONLY"], "never padded back to 10 with merged or low-value use cases"
    assert sorted(nos(result["left_out"])) == ["TWIN1", "TWIN2"]
    assert result["stop"]["reason"] in ("exhausted", "marginal_floor")


def test_10_every_left_out_candidate_has_one_reason_and_the_long_list_is_complete(agent_ns):
    a = ("cat.sch.f1", "amount")
    cases = ([uc("TOP", 1000, a), uc("MERGE", 900, a), uc("WEAK", 800, card={"baseline": "low"}), uc("TINY", 3),
              uc("PART", 40, ("cat.sch.f8", "amount"), card={"per_unit": a}), uc("STRAT")]
             + [uc(f"F{i:02d}", 500 - i) for i in range(20)])
    result = select(agent_ns, cases)
    rows = by_no(result)
    assert sorted(rows) == sorted(c["No"] for c in cases), "the long list holds every candidate exactly once"
    assert len(result["long_list"]) == len(cases)
    sections = [nos(result[key]) for key in ("selected", "strategic", "left_out")]
    assert sorted(sum(sections, [])) == sorted(rows), "every candidate is in exactly one section"
    for row in result["left_out"]:
        assert row["reason"] in REASONS, row
    for row in result["selected"] + result["strategic"]:
        assert row.get("reason") is None, row
    assert rows["MERGE"]["reason"] == "merged"
    assert rows["WEAK"]["reason"] == "lacking_evidence", "a money figure on a low-confidence baseline is never ranked"
    assert rows["TINY"]["reason"] == "lower_marginal_value"
    assert rows["PART"]["reason"] == "overlapping"
    assert rows["F19"]["reason"] == "lower_marginal_value", "cut by the cap of 20"
    gaps = result["gaps"]
    assert "WEAK" in [g["No"] for g in gaps] and all(g.get("reason") for g in gaps), gaps


def test_11_deterministic_under_input_order(agent_ns):
    a, b = ("cat.sch.f1", "amount"), ("cat.sch.f2", "amount")
    cases = [uc("P1", 300, a), uc("P2", 300, b), uc("P3", 300, a), uc("P4", 120, b, card={"per_unit": a}),
             uc("P5"), uc("P6", 300), uc("P7", 50, user_named="Plan P7")]
    first = json.dumps(select(agent_ns, copy.deepcopy(cases)), sort_keys=True, default=str)
    rng = random.Random(7)
    for _ in range(6):
        shuffled = copy.deepcopy(cases)
        rng.shuffle(shuffled)
        assert json.dumps(select(agent_ns, shuffled), sort_keys=True, default=str) == first
    result = json.loads(first)
    assert nos(result["selected"])[0] == "P7"
    assert nos(result["selected"])[1:] == ["P1", "P2", "P6"], "equal values break ties by a stable key, never by input order"


def test_12_inputs_are_not_mutated(agent_ns):
    a = ("cat.sch.f1", "amount")
    cases = [uc("A", 300, a), uc("B", 200, a), uc("C"), uc("D", 100, user_named="Plan D")]
    before = copy.deepcopy(cases)
    result = select(agent_ns, cases)
    assert cases == before
    json.dumps(result)  # JSON-safe: rides in results_json and the catalog as is


def test_13_the_real_value_card_carries_the_low_scenario_net(agent_ns):
    baseline = {"value": 29589.0, "window_days": 90, "measured_on": "2026-11-01", "window_anchor": agent_ns["KPI_WINDOW_ANCHOR"]}
    spec = {"name": "Weekly spend", "unit": "EUR", "direction": "decrease", "aggregation": "SUM", "table": "c.s.orders",
            "column": "amount", "computable": True, "query": "SELECT 1", "window_days": 90, "baseline": baseline}
    case = {"No": "N01-U01", "Name": "Plan N01", "Tables Involved": "c.s.orders", "KPIs": [spec], "use_case_kind": "forecast"}
    estimate = agent_ns["inspire_value_estimate"](case, "", "predict", agent_ns["inspire_use_case_kind"](case))
    assert estimate["status"] == "measured" and estimate["net"], estimate.get("text")
    net_low = estimate.get("net_low")
    assert isinstance(net_low, dict) and set(net_low) == {"S", "M", "L"}, \
        "R14.1: the measured card has no net_low (low-scenario net per S/M/L tier), so no conservative value exists"
    assert all(net_low[t] <= estimate["net"][t] for t in "SML")
    picked = select(agent_ns, [dict(case, **{"Value Estimate": estimate})])
    assert picked["long_list"][0]["conservative"] == pytest.approx(min(net_low.values()))


# ---------------------------------------------------------------- through run()


@pytest.fixture
def quiet_root_logger():
    root = logging.getLogger()
    saved = (list(root.handlers), root.level)
    yield
    root.handlers[:] = saved[0]
    root.setLevel(saved[1])


def _scorer(uc_id):
    return {"use_case_id": uc_id, "quality_label": "High", "quality_score": 4.0, "priority_score": 7.0,
            "quality_summary": "Columns `id` and `amount` aggregated by store give the KPI that drives the outcome."}


def _run(agent_ns, tmp_path):
    """Offline run: 2 orders and 2 items use cases reach the final set. After the real value estimates, the first orders use case
    gets 1000, the second orders use case 400 on the same fingerprint (merged), the first items use case 300, the second none."""
    obj = _build(agent_ns, tmp_path, "Good", ACCEPT_ALL, _scorer)
    real = obj._apply_value_estimates
    stamped = {}

    def estimates(use_cases):
        real(use_cases)
        for table, values in (("orders", (1000, 400)), ("items", (300, None))):
            group = sorted((u for u in use_cases if table in str(u.get("Tables Involved"))), key=lambda u: u["Name"])
            for u, value in zip(group, values):
                if value is not None:
                    u["Value Estimate"] = card(value, (f"cat.sch.{table}", "amount"))
                    u["value_estimate_text"] = u["Value Estimate"]["text"]
                stamped[u["Name"]] = value
    obj._apply_value_estimates = estimates
    obj.run()
    return obj, stamped


def test_14_run_publishes_the_selection_and_ships_only_the_kept_use_cases(agent_ns, tmp_path, quiet_root_logger):
    obj, stamped = _run(agent_ns, tmp_path)
    assert sorted(stamped) == ["Forecast items demand 1", "Forecast items demand 2", "Forecast orders demand 1",
                               "Forecast orders demand 2"], f"harness: the value estimates saw {sorted(stamped)}"
    results = obj._merge_run_outcome_into_results()
    selection = results.get("value_selection")
    assert isinstance(selection, dict), f"R14: run() publishes no results['value_selection']; keys are {sorted(results)}"
    names = lambda rows: [r["Name"] for r in rows]
    assert names(selection["selected"]) == ["Forecast orders demand 1", "Forecast items demand 1"]
    assert names(selection["strategic"]) == ["Forecast items demand 2"]
    assert names(selection["left_out"]) == ["Forecast orders demand 2"] and selection["left_out"][0]["reason"] == "merged"
    assert len(selection["long_list"]) == 4
    final = obj.recorded["tracking"][-1]
    assert sorted(u["Name"] for u in final) == sorted(names(selection["selected"]) + names(selection["strategic"])), \
        "the left-out use case never reaches the catalog writers; it stays in the long list"
    final_no = {u["Name"]: u["No"] for u in final}
    for row in selection["selected"] + selection["strategic"]:
        assert row["No"] == final_no[row["Name"]], "the selection rows carry the catalog's final numbers"
    shipped = {u["Name"]: u for u in final}
    assert shipped["Forecast orders demand 1"]["selection_section"] == "selected"
    assert shipped["Forecast items demand 2"]["selection_section"] == "strategic"


def test_15_selection_rides_in_the_json_catalog(agent_ns, tmp_path, quiet_root_logger):
    cls = agent_ns["DatabricksInspire"]
    assert "value_selection" in cls._V130_CATALOG_KEYS, "the JSON catalog does not carry the selection"
    obj, _ = _run(agent_ns, tmp_path)
    keys = obj._v130_results_keys()
    assert isinstance(keys.get("value_selection"), dict) and keys["value_selection"]["left_out"], sorted(keys)
    json.dumps(keys["value_selection"])
