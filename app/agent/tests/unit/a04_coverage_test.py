"""a04_coverage (REQ-573 R11.1, R11.3, R10.8; T-COVERAGE-01): one coverage ledger gives every in-scope item one disposition.

R11.1: every business table and table group, every value driver and owner goal (strategy entry and business priority), every
pattern x data-shape cell that applies (a detected kind: family x kind) and every material pool gets exactly one disposition.
R11.3: "no miss" = tested recall within the declared scope + 100% of dispositions recorded; the 100% check is recomputed from
the expected item keys, never read from a stored flag. R10.8: the ledger lists the empty cells, the only targets gap
generation may take. R11.2 (already built): a budget-hit run is partial; its unreached items are not_reached, never no_signal.

Vocabulary (brief D1): covered_by:<uc No> | merged:<uc No> | excluded:<reason> | uncovered | no_signal | not_reached.
Pools come from the sibling lane a04_loss_pools as a plain list of dicts on DatabricksInspire.loss_pools, in that lane's pool
contract (pool_id, table, money_column, split_column, split_values, loss_kind, material, ...). A pool row is keyed
pool:<pool_id>, and whether a use case covers a pool is decided only by that lane's inspire_loss_pool_coverage (KPI on the
pool's table + money column + split filter, or loss_pool_id; never free text: loss_pools brief D6). One matcher, no second one.

Pure tests call inspire_coverage_ledger / inspire_coverage_expected / inspire_coverage_check. Run tests drive the real run()
through the offline smoke harness (v120_run_offline_smoke_test._build) and read results["coverage_ledger"].
"""
import copy
import logging
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v120_run_offline_smoke_test import _build  # noqa: E402

ACCEPT_ALL = {"Low", "Medium", "High", "Very High", "Ultra High"}
VOCAB = re.compile(r"^(covered_by:\S+|merged:\S+|excluded:[a-z_]+|uncovered|no_signal|not_reached)$")
KINDS = [
    {"kind": "forecast", "family": "predict", "anchor": "cat.sch.orders", "tables": ["cat.sch.orders"], "columns": {},
     "strength": 0.9, "signal": "strong", "label": "Forecast"},
    {"kind": "variance_to_plan", "family": "measure_explain", "anchor": "cat.sch.items", "tables": ["cat.sch.items"],
     "columns": {}, "strength": 0.6, "signal": "medium", "label": "Variance to plan"},
    {"kind": "anomaly", "family": "detect_protect", "anchor": "cat.sch.orders", "tables": ["cat.sch.orders"], "columns": {},
     "strength": 0.6, "signal": "medium", "label": "Anomaly"},
]


def _fn(ns, name):
    fn = ns.get(name)
    assert callable(fn), f"R11.1/R11.3: the notebook defines no {name}() (the coverage ledger is not built yet)"
    return fn


def _scorer(uc_id):
    return {"use_case_id": uc_id, "quality_label": "High", "quality_score": 4.0, "priority_score": 7.0,
            "quality_summary": "Columns `id` and `amount` aggregated by store give the KPI that drives the outcome."}


@pytest.fixture
def quiet_root_logger():
    root = logging.getLogger()
    saved = (list(root.handlers), root.level)
    yield
    root.handlers[:] = saved[0]
    root.setLevel(saved[1])


@pytest.fixture
def budget(agent_ns):
    runtime = agent_ns["TECHNICAL_CONTEXT"]["runtime"]
    saved = runtime.get("discover_time_budget_minutes")
    yield runtime
    runtime["discover_time_budget_minutes"] = saved if saved is not None else 0


def _run(agent_ns, tmp_path, kinds=None, excluded_kinds=(), pools=None, goals=None, priorities=None, reference=(),
         empty_tables=(), spent_after=None, budget_rt=None):
    obj = _build(agent_ns, tmp_path, "Good", ACCEPT_ALL, _scorer)
    if goals is not None:
        obj.user_strategic_goals = list(goals)
    if priorities is not None:
        obj.user_business_priorities = list(priorities)
    if pools is not None:
        obj.loss_pools = copy.deepcopy(pools)
    if kinds is not None:
        def detect(details):
            obj.detected_kinds = copy.deepcopy(kinds)
            return obj.detected_kinds
        obj._detect_kinds_for_generation = detect
        obj._user_kind_directives = lambda *a, **k: ([], set(excluded_kinds))
    if reference:
        def filter_tables(cols, business_context="", industry="", exclusion_strategy=""):
            fqtns = {f"{c[0]}.{c[1]}.{c[2]}" for c in cols}
            ref = {t for t in fqtns if t in set(reference)}
            cats = {t: ("REFERENCE" if t in ref else "TRANSACTIONAL") for t in fqtns}
            return (cols, [], set(fqtns), set(), {t: 90 for t in fqtns}, cats, set(), fqtns - ref, ref)
        obj._filter_business_tables = filter_tables
    if empty_tables:
        generate = obj._process_batch_with_retry

        def quiet(column_details, batch_id, **kw):
            if column_details and f"{column_details[0][0]}.{column_details[0][1]}.{column_details[0][2]}" in empty_tables:
                return []
            return generate(column_details, batch_id, **kw)
        obj._process_batch_with_retry = quiet
    if spent_after is not None:
        budget_rt["discover_time_budget_minutes"] = 30
        calls = []

        def spent():
            calls.append(1)
            return len(calls) > spent_after
        obj._discover_budget_spent = spent
    obj.run()
    return obj


def _ledger(obj):
    results = obj._merge_run_outcome_into_results()
    ledger = results.get("coverage_ledger")
    assert isinstance(ledger, dict), ("R11.1: run() publishes no results['coverage_ledger']; keys are "
                                      f"{sorted(results)}")
    return ledger


def _by_item(ledger):
    return {row["item"]: row for row in ledger["rows"]}


# ---------------------------------------------------------------- pure ledger


SCOPE = {
    "tables": {"cat.sch.orders": "TRANSACTIONAL", "cat.sch.items": "MASTER", "cat.sch.codes": "REFERENCE",
               "cat.ops.etl_log": "TECHNICAL", "cat.ops.shifts": "TRANSACTIONAL"},
    "strategy_coverage": {"entries": [{"id": "S1", "path": "Lower spoilage", "level": "Strategic Goal"},
                                      {"id": "S2", "path": "Grow margin", "level": "Strategic Goal"}],
                          "priorities": [{"priority": "Grow loyalty"}, {"priority": "Cut waste"}]},
    "kinds": [{"kind": "forecast", "family": "predict", "anchor": "cat.sch.orders"},
              {"kind": "segmentation", "family": "know_entities", "anchor": "cat.sch.items"},
              {"kind": "anomaly", "family": "detect_protect", "anchor": "cat.sch.orders"}],
    "excluded_kinds": ["anomaly"],
}
def _pool(pool_id, table, money_column, loss_kind, split_column=None, split_values=(), amount=100.0, material=True):
    return {"pool_id": pool_id, "table": table, "money_column": money_column, "split_column": split_column,
            "split_values": list(split_values), "loss_kind": loss_kind,
            "source": "status_split" if split_column else "loss_column", "flow": "other", "currency": "USD", "unit": "money",
            "amount": amount, "rows": 10, "measured_rows": 10, "share": 0.2, "material": material, "flags": []}


POOLS = [_pool("lp01", "cat.sch.orders", "amount", "cancelled", "status", ["cancelled", "Canceled"], 1200.0),
         _pool("lp02", "cat.ops.shifts", "overtime_cost", "overtime", amount=300.0),
         _pool("lp03", "cat.sch.items", "list_price", "discounted", amount=5.0, material=False)]
CANCELLED_KPI = {"name": "Cancelled order value", "table": "cat.sch.orders", "column": "amount", "aggregation": "SUM",
                 "filter_column": "status", "filter_op": "=", "filter_value": "cancelled", "filter_type": "text"}


def _uc(no, tables, technique="Forecasting", goals=(), priorities=(), text=""):
    return {"No": no, "Name": f"Plan {no}", "Tables Involved": tables, "Analytics Technique": technique,
            "Statement": text, "Strategy Alignment": [{"id": g, "path": p} for g, p in goals],
            "Business Priority Alignment": ", ".join(priorities) or "General Improvement"}


SELECTED = [dict(_uc("AI01-UC01", "cat.sch.orders", goals=[("S1", "Lower spoilage")], priorities=["Cut waste"],
                     text="Cancelled `amount` on orders is the loss."), KPIs=[dict(CANCELLED_KPI)])]
DROPPED = [_uc("AI02-UC01", "cat.sch.items", technique="Clustering")]


def _pure(agent_ns, partial=False, selected=SELECTED, candidates=None, merged=None, pools=POOLS, scope=SCOPE):
    build = _fn(agent_ns, "inspire_coverage_ledger")
    return build(copy.deepcopy(scope), copy.deepcopy(selected),
                 candidates=copy.deepcopy(SELECTED + DROPPED if candidates is None else candidates),
                 merged=dict(merged or {}), pools=copy.deepcopy(pools), partial=partial)


def test_1_vocabulary_is_declared(agent_ns):
    vocab = agent_ns.get("INSPIRE_COVERAGE_DISPOSITIONS")
    assert vocab == ("covered_by", "merged", "excluded", "uncovered", "no_signal", "not_reached"), vocab
    types = agent_ns.get("INSPIRE_COVERAGE_ITEM_TYPES")
    assert types == ("table", "table_group", "goal", "priority", "cell", "pool"), types


def test_2_every_scope_item_gets_exactly_one_disposition(agent_ns):
    ledger = _pure(agent_ns)
    expected = _fn(agent_ns, "inspire_coverage_expected")(copy.deepcopy(SCOPE), copy.deepcopy(POOLS))
    want = {"table:cat.sch.orders", "table:cat.sch.items", "table:cat.sch.codes", "table:cat.ops.etl_log",
            "table:cat.ops.shifts", "table_group:cat.sch", "table_group:cat.ops", "goal:S1", "goal:S2",
            "priority:Grow loyalty", "priority:Cut waste", "cell:predict x forecast",
            "cell:know_entities x segmentation", "cell:detect_protect x anomaly",
            "pool:lp01", "pool:lp02", "pool:lp03"}
    assert set(expected) == want, sorted(set(expected) ^ want)
    items = [row["item"] for row in ledger["rows"]]
    assert sorted(items) == sorted(want), "each expected item needs exactly one row"
    bad = [row for row in ledger["rows"] if not VOCAB.match(row["disposition"])]
    assert not bad, bad
    assert all(row["type"] in agent_ns["INSPIRE_COVERAGE_ITEM_TYPES"] for row in ledger["rows"])


def test_3_dispositions_follow_precedence(agent_ns):
    rows = _by_item(_pure(agent_ns))
    got = {item: row["disposition"] for item, row in rows.items()}
    assert got["table:cat.sch.orders"] == "covered_by:AI01-UC01"
    assert got["table:cat.sch.codes"] == "excluded:reference"
    assert got["table:cat.ops.etl_log"] == "excluded:technical"
    assert got["table:cat.sch.items"] == "uncovered", "a table with a dropped candidate is uncovered, not no_signal"
    assert got["table:cat.ops.shifts"] == "no_signal", "a table no candidate used, in a complete run, is no_signal"
    assert got["table_group:cat.sch"] == "covered_by:AI01-UC01"
    assert got["goal:S1"] == "covered_by:AI01-UC01" and got["priority:Cut waste"] == "covered_by:AI01-UC01"
    assert got["cell:predict x forecast"] == "covered_by:AI01-UC01"
    assert got["cell:detect_protect x anomaly"] == "excluded:owner"
    assert got["pool:lp01"] == "covered_by:AI01-UC01", "a KPI on the pool's table, money column and split value covers it"
    assert got["pool:lp02"] == "no_signal"
    assert got["pool:lp03"] == "excluded:immaterial"
    assert rows["table:cat.sch.items"]["use_cases"] == [] and "AI02-UC01" in rows["table:cat.sch.items"]["reason"]
    for row in rows.values():
        if not row["disposition"].startswith("covered_by:"):
            assert str(row.get("reason") or "").strip(), f"{row['item']} has no reason"


def test_4_owner_goal_with_no_use_case_is_uncovered(agent_ns):
    rows = _by_item(_pure(agent_ns))
    assert rows["goal:S2"]["disposition"] == "uncovered", rows["goal:S2"]
    assert rows["priority:Grow loyalty"]["disposition"] == "uncovered", rows["priority:Grow loyalty"]
    assert "Grow margin" in rows["goal:S2"]["reason"]


def test_5_merged_candidate_names_the_selected_use_case(agent_ns):
    rows = _by_item(_pure(agent_ns, merged={"AI02-UC01": "AI01-UC01"}))
    assert rows["table:cat.sch.items"]["disposition"] == "merged:AI01-UC01", rows["table:cat.sch.items"]
    assert rows["cell:know_entities x segmentation"]["disposition"] == "merged:AI01-UC01"


def test_6_empty_cells_are_listed_for_gap_generation(agent_ns):
    ledger = _pure(agent_ns)
    empty = ledger.get("empty_cells")
    assert isinstance(empty, list), "R10.8: the ledger exposes no empty_cells list"
    assert [cell["item"] for cell in empty] == ["cell:know_entities x segmentation"], empty
    cell = empty[0]
    assert (cell["family"], cell["kind"], cell["anchor"]) == ("know_entities", "segmentation", "cat.sch.items")
    merged = _pure(agent_ns, merged={"AI02-UC01": "AI01-UC01"})
    assert merged["empty_cells"] == [], "a merged cell is not empty: gap generation must not target it"


def test_7_partial_run_gives_not_reached_never_no_signal(agent_ns):
    ledger = _pure(agent_ns, partial=True)
    rows = _by_item(ledger)
    assert ledger["status"] == "partial"
    assert rows["table:cat.ops.shifts"]["disposition"] == "not_reached"
    assert rows["pool:lp02"]["disposition"] == "not_reached"
    assert rows["goal:S2"]["disposition"] == "not_reached"
    assert rows["table:cat.sch.items"]["disposition"] == "uncovered", "a reached table with a dropped candidate stays uncovered"
    assert not [r for r in ledger["rows"] if r["disposition"] == "no_signal"]
    assert "cell:know_entities x segmentation" in [c["item"] for c in ledger["empty_cells"]]
    assert "partial" in ledger["summary"] and "not reached" in ledger["summary"]
    assert _pure(agent_ns)["status"] == "complete"


def test_8_check_is_100_percent_on_a_full_ledger(agent_ns):
    check = _fn(agent_ns, "inspire_coverage_check")
    ledger = _pure(agent_ns)
    out = check(ledger)
    assert out["complete"] is True and out["percent"] == 100.0, out
    assert out["expected"] == out["recorded"] == 17 and out["missing"] == [] and out["invalid"] == [] and out["duplicates"] == []
    assert ledger["check"] == out
    assert ledger["summary"].startswith("Coverage: 100% of 17 dispositions recorded"), ledger["summary"]


def test_9_check_fails_when_one_disposition_is_missing(agent_ns):
    check = _fn(agent_ns, "inspire_coverage_check")
    ledger = _pure(agent_ns)
    ledger["rows"] = [r for r in ledger["rows"] if r["item"] != "goal:S2"]
    ledger["check"] = {"complete": True, "percent": 100.0}
    out = check(ledger)
    assert out["complete"] is False and out["missing"] == ["goal:S2"], out
    assert out["recorded"] == 16 and out["expected"] == 17 and out["percent"] < 100.0
    expected = _fn(agent_ns, "inspire_coverage_expected")(copy.deepcopy(SCOPE), copy.deepcopy(POOLS))
    whole = _pure(agent_ns)
    assert check(whole, expected=[k for k in expected] + ["table:cat.sch.late"])["missing"] == ["table:cat.sch.late"]


def test_10_check_rejects_a_bad_or_doubled_disposition(agent_ns):
    check = _fn(agent_ns, "inspire_coverage_check")
    ledger = _pure(agent_ns)
    ledger["rows"][0] = dict(ledger["rows"][0], disposition="probably_fine")
    ledger["rows"].append(dict(ledger["rows"][1]))
    out = check(ledger)
    assert out["complete"] is False
    assert out["invalid"] == [ledger["rows"][0]["item"]] and out["duplicates"] == [ledger["rows"][1]["item"]], out


def test_11_pure_builder_does_not_touch_its_inputs(agent_ns):
    build = _fn(agent_ns, "inspire_coverage_ledger")
    scope, selected, pools = copy.deepcopy(SCOPE), copy.deepcopy(SELECTED), copy.deepcopy(POOLS)
    build(scope, selected, candidates=selected + copy.deepcopy(DROPPED), merged={}, pools=pools, partial=False)
    assert scope == SCOPE and selected == SELECTED and pools == POOLS


# ---------------------------------------------------------------- run integration (offline smoke harness)


def test_12_run_gives_every_business_table_one_disposition(agent_ns, tmp_path, quiet_root_logger):
    obj = _run(agent_ns, tmp_path)
    ledger = _ledger(obj)
    tables = [r for r in ledger["rows"] if r["type"] == "table"]
    assert sorted(r["item"] for r in tables) == ["table:cat.sch.items", "table:cat.sch.orders", "table:cat.sch.stores"]
    got = {r["item"]: r["disposition"] for r in tables}
    assert got["table:cat.sch.orders"] == "covered_by:AI01-UC01"
    assert got["table:cat.sch.items"].startswith("covered_by:AI02-")
    assert got["table:cat.sch.stores"] == "uncovered", "stores candidates were dropped by the gates"
    assert ledger["check"]["complete"] is True and ledger["status"] == "complete"
    assert "coverage_ledger" in agent_ns["DatabricksInspire"]._V130_CATALOG_KEYS, \
        "the ledger must ride in the JSON catalog too, so a docs-only reload keeps it"


def test_13_run_excludes_a_reference_table_with_a_reason(agent_ns, tmp_path, quiet_root_logger):
    obj = _run(agent_ns, tmp_path, reference=("cat.sch.stores",))
    row = _by_item(_ledger(obj))["table:cat.sch.stores"]
    assert row["disposition"] == "excluded:reference", row
    assert "reference" in row["reason"].lower()


def test_14_run_records_an_uncovered_owner_goal_and_priority(agent_ns, tmp_path, quiet_root_logger):
    obj = _run(agent_ns, tmp_path, goals=["Lower spoilage"], priorities=["Grow loyalty"])
    rows = _by_item(_ledger(obj))
    goals = [r for r in rows.values() if r["type"] == "goal"]
    assert len(goals) == 1 and goals[0]["disposition"] == "uncovered" and "Lower spoilage" in goals[0]["reason"], goals
    assert rows["priority:Grow loyalty"]["disposition"] == "uncovered"


def test_15_run_lists_empty_pattern_cells_and_owner_exclusions(agent_ns, tmp_path, quiet_root_logger):
    obj = _run(agent_ns, tmp_path, kinds=KINDS, excluded_kinds={"anomaly"}, empty_tables=("cat.sch.items",))
    ledger = _ledger(obj)
    rows = _by_item(ledger)
    assert rows["cell:predict x forecast"]["disposition"] == "covered_by:AI01-UC01"
    assert rows["cell:detect_protect x anomaly"]["disposition"] == "excluded:owner"
    assert rows["cell:measure_explain x variance_to_plan"]["disposition"] == "no_signal"
    assert rows["table:cat.sch.items"]["disposition"] == "no_signal", "no candidate came from items"
    assert [c["item"] for c in ledger["empty_cells"]] == ["cell:measure_explain x variance_to_plan"]


def test_16_run_takes_pools_in_the_loss_pools_contract(agent_ns, tmp_path, quiet_root_logger):
    pools = [_pool("lpA", "cat.sch.orders", "amount", "cancelled", "status", ["cancelled"], 1200.0),
             _pool("lpB", "cat.sch.stores", "amount", "penalty", amount=40.0),
             _pool("lpC", "cat.sch.orders", "scrap_qty", "scrap", amount=9.0, material=False)]
    obj = _run(agent_ns, tmp_path, pools=pools)
    ledger = _ledger(obj)
    rows = _by_item(ledger)
    assert {"pool:lpA", "pool:lpB", "pool:lpC"} <= set(rows), sorted(k for k in rows if k.startswith("pool:"))
    assert rows["pool:lpC"]["disposition"] == "excluded:immaterial", rows["pool:lpC"]
    for key in ("pool:lpA", "pool:lpB"):
        assert rows[key]["disposition"] in ("uncovered", "no_signal"), \
            f"{key}: the smoke run's use cases carry no pool KPI or loss_pool_id, so nothing covers the pool: {rows[key]}"
    assert ledger["check"]["complete"], ledger["check"]


def test_19_pool_coverage_is_decided_by_the_loss_pools_matcher_only(agent_ns, monkeypatch):
    real = _fn(agent_ns, "inspire_loss_pool_coverage")
    calls = []

    def spy(pools, use_cases):
        calls.append(([p.get("pool_id") for p in pools], [str(uc.get("No")) for uc in use_cases]))
        return real(pools, use_cases)

    monkeypatch.setitem(agent_ns, "inspire_loss_pool_coverage", spy)
    rows = _by_item(_pure(agent_ns))
    assert calls, "the coverage ledger must reuse inspire_loss_pool_coverage, not a second pool matcher (DRY, D6)"
    assert rows["pool:lp01"]["disposition"] == "covered_by:AI01-UC01"


def test_20_free_text_naming_the_pool_column_never_covers_it(agent_ns):
    text_only = [_uc("AI01-UC01", "cat.ops.shifts", text="Overtime `overtime_cost` on shifts is the loss we cut.")]
    rows = _by_item(_pure(agent_ns, selected=text_only, candidates=text_only))
    assert rows["pool:lp02"]["disposition"] == "no_signal", \
        f"free text on the same table and column is not a pool candidate (D6): {rows['pool:lp02']}"
    by_id = [dict(_uc("AI01-UC02", "cat.ops.shifts"), loss_pool_id="lp02")]
    rows = _by_item(_pure(agent_ns, selected=by_id, candidates=by_id))
    assert rows["pool:lp02"]["disposition"] == "covered_by:AI01-UC02", rows["pool:lp02"]


def test_21_a_dropped_pool_candidate_makes_the_pool_uncovered_with_its_name(agent_ns):
    dropped = dict(_uc("AI03-UC01", "cat.ops.shifts"), loss_pool_id="lp02")
    rows = _by_item(_pure(agent_ns, candidates=SELECTED + DROPPED + [dropped]))
    assert rows["pool:lp02"]["disposition"] == "uncovered", rows["pool:lp02"]
    assert "AI03-UC01" in rows["pool:lp02"]["reason"], rows["pool:lp02"]


def test_22_pool_rows_carry_the_pool_id_and_a_readable_label(agent_ns):
    rows = _by_item(_pure(agent_ns))
    row = rows["pool:lp01"]
    assert row.get("pool_id") == "lp01", row
    label = str(row.get("label") or "")
    assert "cat.sch.orders" in label and "amount" in label and "cancelled" in label, row


def test_17_budget_hit_run_is_partial_with_not_reached(agent_ns, tmp_path, budget, quiet_root_logger):
    obj = _run(agent_ns, tmp_path, spent_after=1, budget_rt=budget)
    assert obj.budget_partial, "precondition: the real Pass 1 skip path hit the budget"
    results = obj._merge_run_outcome_into_results()
    assert results.get("run_partial") is True
    ledger = results.get("coverage_ledger")
    assert isinstance(ledger, dict), "R11.1: a partial run publishes no coverage ledger"
    rows = _by_item(ledger)
    assert ledger["status"] == "partial"
    assert rows["table:cat.sch.orders"]["disposition"] == "covered_by:AI01-UC01"
    assert rows["table:cat.sch.items"]["disposition"] == "not_reached"
    assert rows["table:cat.sch.stores"]["disposition"] == "not_reached"
    assert ledger["check"]["complete"] is True, "partial is not missing: every item still has a disposition"
    assert "partial" in ledger["summary"]


def test_18_missing_disposition_after_the_run_is_a_warning_not_a_pass(agent_ns, tmp_path, quiet_root_logger):
    obj = _run(agent_ns, tmp_path)
    _ledger(obj)
    obj.coverage_ledger["rows"] = [r for r in obj.coverage_ledger["rows"] if r["item"] != "table:cat.sch.stores"]
    obj.coverage_ledger["check"] = {"complete": True, "percent": 100.0}
    results = obj._merge_run_outcome_into_results()
    check = results["coverage_ledger"]["check"]
    assert check["complete"] is False and check["missing"] == ["table:cat.sch.stores"], check
    warnings = [w for w in obj._run_outcome_warnings() if "disposition" in w.lower()]
    assert warnings and "1 of" in warnings[0], obj._run_outcome_warnings()
