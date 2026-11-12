"""v1.4.0 rc.4: the stated kind survives, logs name the use case, empty tables give no baseline.

1. When a stated kind does not list its technique, the use case's own text decides: a technique of the stated kind
   that the text names replaces the label; a text that names the stated technique instead moves the use case to that
   technique's kind, unless the instructions ask for the stated kind; a text that names neither keeps both and flags
   the mismatch. No technique is invented. A stated kind that is not in the catalog takes its technique's kind.
2. The KIND-MATCH, VALUE-SHARE and SIGNAL-CHECK lines name each use case next to its id, because ids are renumbered
   after them, and VALUE-SHARE states the final selected count.
3. A KPI measured on a table with no rows in scope is not measured (no data), never a measured zero.
4. A signal check skipped for want of a table says whether a column must be derived, the columns sit in several
   tables, or a role has no column, instead of always "no single table holds the columns".
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _agentload  # noqa: E402
from v120_artifacts_support import make_inspire  # noqa: E402

REGISTRY = {
    "version": 1,
    "families": [{"id": "measure_explain", "label": "Measure and explain"}, {"id": "decide", "label": "Decide"},
                 {"id": "predict", "label": "Predict"}],
    "layouts": [{"id": "decision_queue", "min_items": {"decision_list": 20}}, {"id": "dashboard", "min_items": {"charts": 2}}],
    "technique_kind": {"Pareto Analysis": "driver_breakdown", "Regression Analysis": "driver_breakdown",
                       "Optimization": "allocation", "Classification": "risk_propensity", "Survival Analysis": "time_to_event",
                       "Queueing": "staffing_queueing", "Simulation": "driver_scenarios", "Forecasting": "forecast"},
    "kinds": [
        {"id": "driver_breakdown", "num": 2, "family": "measure_explain", "label": "Driver breakdown", "informational": True,
         "layout": "dashboard", "techniques": ["Pareto Analysis", "Regression Analysis", "Decomposition"]},
        {"id": "assortment", "num": 12, "family": "decide", "label": "Assortment", "informational": True,
         "layout": "dashboard", "techniques": ["Optimization", "Regression Analysis", "Correlation Analysis"]},
        {"id": "allocation", "num": 13, "family": "decide", "label": "Allocation", "informational": True,
         "layout": "dashboard", "techniques": ["Optimization"]},
        {"id": "risk_propensity", "num": 6, "family": "predict", "label": "Risk and propensity", "informational": True,
         "layout": "decision_queue", "techniques": ["Classification"]},
        {"id": "inventory_replenishment", "num": 14, "family": "decide", "label": "Inventory replenishment", "informational": True,
         "layout": "dashboard", "techniques": ["Optimization", "Forecasting", "Simulation"]},
        {"id": "time_to_event", "num": 7, "family": "predict", "label": "Time to event", "informational": True,
         "layout": "dashboard", "techniques": ["Survival Analysis"]},
        {"id": "staffing_queueing", "num": 15, "family": "decide", "label": "Staffing and queueing", "informational": True,
         "layout": "dashboard", "techniques": ["Queueing"]},
    ],
}
SCHEMA = [("main", "s", "sales", "item_id", "bigint", ""), ("main", "s", "sales", "amount", "double", "")]


@pytest.fixture(scope="module")
def ns():
    namespace = _agentload.fresh_agent_namespace()
    namespace["_inspire_kinds"] = lambda: REGISTRY
    return namespace


def _inst(ns, parsed=None, **attrs):
    inst = make_inspire(ns, parsed_generation_instructions=parsed or {}, user_business_domains=[], detected_kinds=[], **attrs)
    inst._kind_floor_reasons = {}
    return inst


def _messages(inst, tag):
    return [msg for _lvl, msg in inst.logger.records if tag in msg]


def _uc(no, kind, technique, name="Choose the Item Range per Store", design="Rank items per store each week.", **extra):
    uc = {"No": no, "Name": name, "Use Case Kind": kind, "Analytics Technique": technique, "Business Domain": "Sales",
          "Statement": "Shelves hold slow items.", "Solution": "Rank each item per store weekly for the category buyer.",
          "High Level Design": design, "Beneficiary": "Category buyer", "Tables Involved": "main.s.sales"}
    uc.update(extra)
    return uc


def _q5(ns, ucs, parsed=None):
    inst = _inst(ns, parsed=parsed)
    kept, dropped = inst._phaseQ5_decision_readiness(ucs, SCHEMA)
    return inst, [uc["No"] for uc in kept], {uc["No"]: reason for uc, reason in dropped}


def test_a_catalog_kind_whose_design_names_no_technique_keeps_its_kind_and_technique_and_is_flagged(ns):
    uc = _uc("N01-U10", "assortment", "Pareto Analysis")
    inst, kept, dropped = _q5(ns, [uc])
    assert kept == ["N01-U10"] and dropped == {}
    assert uc["Use Case Kind"] == "assortment" and "use_case_kind" not in uc and "kind_relabelled_from" not in uc
    assert uc["Analytics Technique"] == "Pareto Analysis" and "technique_replaced_from" not in uc
    assert "Q5_D5_KIND_TECHNIQUE_MISMATCH:assortment" in uc["gate_flags"]
    assert not _messages(inst, "[KIND-MATCH FIRED]")


def test_the_replacement_technique_is_one_the_use_case_names_when_the_kind_lists_it(ns):
    uc = _uc("N01-U11", "assortment", "Pareto Analysis", design="Fit a regression of units on shelf space per item.")
    inst, _kept, _dropped = _q5(ns, [uc])
    assert (uc["Use Case Kind"], uc["Analytics Technique"], uc["technique_replaced_from"]) == (
        "assortment", "Regression Analysis", "Pareto Analysis")
    assert _messages(inst, '[KIND-MATCH FIRED] 1 use case kept the stated kind and took a technique that kind lists: '
                           'N01-U11 "Choose the Item Range per Store" assortment: Pareto Analysis -> Regression Analysis')


TPCDS_INVENTORY = [("samples", "tpcds_sf1", "inventory", column, kind, "") for column, kind in (
    ("inv_date_sk", "int"), ("inv_item_sk", "int"), ("inv_warehouse_sk", "int"), ("inv_quantity_on_hand", "int"))]
INVENTORY = {"Tables Involved": "samples.tpcds_sf1.inventory, samples.tpcds_sf1.date_dim", "Beneficiary": "Inventory planner"}


def test_an_inventory_card_whose_design_is_another_technique_takes_that_technique_kind(ns):
    stockout = _uc("N13-U04", "inventory_replenishment", "Survival Analysis", name="Predict Days to Stockout per Item and Warehouse",
                   design="Fit a survival model of days until inv_quantity_on_hand reaches zero, censoring items still in stock.",
                   **INVENTORY)
    desk = _uc("N12-U09", "inventory_replenishment", "Queueing", name="Schedule Returns Desk Shifts by Arrival Hour",
               design="Size the returns desk per hour with an Erlang C model of arrivals and handling time.", **INVENTORY)
    reorder = _uc("N11-U04", "inventory_replenishment", "Simulation", name="Set Order Quantities per Item and Warehouse",
                  design="Simulate weekly demand and lead time to set an order quantity per item at a 95% service level.",
                  **INVENTORY)
    inst = _inst(ns)
    kept, dropped = inst._phaseQ5_decision_readiness([stockout, desk, reorder], TPCDS_INVENTORY)
    assert [uc["No"] for uc in kept] == ["N13-U04", "N12-U09", "N11-U04"] and dropped == []
    assert (stockout["use_case_kind"], stockout["kind_relabelled_from"]) == ("time_to_event", "inventory_replenishment")
    assert (desk["use_case_kind"], desk["kind_relabelled_from"]) == ("staffing_queueing", "inventory_replenishment")
    assert stockout["Analytics Technique"] == "Survival Analysis" and desk["Analytics Technique"] == "Queueing"
    assert (reorder["Use Case Kind"], reorder["Analytics Technique"]) == ("inventory_replenishment", "Simulation")
    assert not any(uc.get("Analytics Technique") == "Optimization" for uc in (stockout, desk, reorder))
    assert _messages(inst, 'N13-U04 "Predict Days to Stockout per Item and Warehouse" inventory_replenishment -> time_to_event '
                           '(its design names Survival Analysis, none of Optimization, Forecasting, Simulation '
                           'inventory_replenishment lists)')


def test_an_asked_kind_is_not_relabelled_even_when_its_design_names_another_technique(ns):
    stockout = _uc("N13-U04", "inventory_replenishment", "Survival Analysis", name="Predict Days to Stockout per Item",
                   design="Fit a survival model of days until stock reaches zero.", **INVENTORY)
    _q5(ns, [stockout], parsed={"use_case_kinds": {"asked": ["inventory_replenishment"], "excluded": []}})
    assert (stockout["Use Case Kind"], stockout["Analytics Technique"]) == ("inventory_replenishment", "Survival Analysis")
    assert "Q5_D5_KIND_TECHNIQUE_MISMATCH:inventory_replenishment" in stockout["gate_flags"]


def test_standard_discovery_reads_aggregates_but_never_stores_a_kpi_baseline(ns):
    assert "StandardModeDataReadError" not in ns
    deep = ns["DeepEvidence"](None, "Standard", make_inspire(ns).logger)
    assert deep.discovery_type == "Standard Discovery" and deep.summary()["aggregates_sent_to_ai"] is False
    inst = _inst(ns, discovery_type="Standard Discovery")
    inst.deep_evidence = deep
    ucs = [{"KPIs": [{"name": "Units on hand", "computable": True, "query": "SELECT 1"}]}]
    assert inst._measure_kpi_baselines(ucs) == {"computable": 1, "measured": 0, "unmeasured": 0, "skipped": 0}
    assert "baseline" not in ucs[0]["KPIs"][0] and not _messages(inst, "no rows")


def test_a_stated_kind_not_in_the_catalog_is_relabelled_to_its_technique_kind(ns):
    uc = _uc("N01-U12", "shelf_planning", "Pareto Analysis")
    inst, kept, _dropped = _q5(ns, [uc])
    assert kept == ["N01-U12"]
    assert (uc["use_case_kind"], uc["kind_relabelled_from"]) == ("driver_breakdown", "shelf_planning")
    assert "Use Case Kind" not in uc and uc["Analytics Technique"] == "Pareto Analysis"
    assert _messages(inst, '[KIND-MATCH FIRED] 1 use case relabelled to the kind of the technique each one uses: '
                           'N01-U12 "Choose the Item Range per Store" shelf_planning -> driver_breakdown '
                           '(shelf_planning is not a kind in the catalog; Pareto Analysis belongs to driver_breakdown)')


def test_asked_kinds_and_requested_use_cases_keep_their_kind(ns):
    asked = _uc("N01-U13", "assortment", "Classification")
    requested = _uc("N01-U14", "assortment", "Classification", user_request="R1")
    _q5(ns, [asked, requested], parsed={"use_case_kinds": {"asked": ["assortment"], "excluded": []}})
    assert (asked["Use Case Kind"], asked["Analytics Technique"]) == ("assortment", "Classification")
    assert (requested["Use Case Kind"], requested["Analytics Technique"]) == ("assortment", "Classification")
    assert "kind_relabelled_from" not in asked and "kind_relabelled_from" not in requested


def test_a_listed_technique_and_a_catch_all_technique_change_nothing(ns):
    listed, catch_all = _uc("N01-U15", "assortment", "Regression Analysis"), _uc("N01-U16", "assortment", "Advanced Analytics")
    inst, _kept, _dropped = _q5(ns, [listed, catch_all])
    assert (listed["Analytics Technique"], catch_all["Analytics Technique"]) == ("Regression Analysis", "Advanced Analytics")
    assert not _messages(inst, "[KIND-MATCH FIRED]")


class _Totals:
    def measure_kpi(self, spec):
        return 1000.0


def _stake_uc(no, name, in_scope):
    spec = {"name": "Revenue", "table": "main.s.sales", "aggregation": "SUM", "column": "amount", "computable": True,
            "query": f"q{no}", "baseline": {"value": in_scope}, "filter_column": "region", "filter_value": "West"}
    return {"No": no, "Name": name, "KPIs": [spec], "Business Domain": "Sales", "bob_score": 7.0}


def test_value_share_names_each_use_case_and_states_the_final_count(ns):
    inst = _inst(ns, deep_evidence=_Totals())
    ucs = [_stake_uc("N01-U01", "Cut West Returns", 5.0), _stake_uc("N01-U02", "Grow West Basket", 500.0),
           _stake_uc("N01-U03", "Price West Bundles", 600.0)]
    kept = inst._drop_low_stake_use_cases(ucs)
    assert [uc["No"] for uc in kept] == ["N01-U02", "N01-U03"]
    assert _messages(inst, '[VALUE-SHARE FIRED] 1 use case dropped because the value in scope is below 1% of the business '
                           'total: N01-U01 "Cut West Returns" 0.50%; the final selection holds 2 use cases')


def test_signal_check_lines_name_each_use_case(ns):
    source = _agentload.agent_source()
    assert 'f"[SIGNAL-CHECK] dropped {uc.get(\'No\')} \\"{self._uc_title(uc)}\\"' in source
    assert 'log(f"[SIGNAL-CHECK] {record[\'status\']} {uc.get(\'No\')} \\"{self._uc_title(uc)}\\"' in source


class _Rows:
    def __init__(self, answer):
        self.answer, self.statements = answer, []

    def __call__(self, kind, table, sql, args=None, budget="evidence", scopes=None):
        self.statements.append(sql)
        return [self.answer]


def _deep(ns, answer):
    cls = ns["DeepEvidence"]
    deep = cls.__new__(cls)
    deep._read = _Rows(answer)
    return deep


def test_a_kpi_on_a_table_with_no_rows_is_not_measured(ns):
    spec = {"name": "Late orders", "table": "main.s.orders", "aggregation": "COUNT", "column": None,
            "filter_column": "status", "filter_value": "late", "time_column": "order_date", "window_days": 30}
    empty = _deep(ns, {"v": 0, "n": 0})
    with pytest.raises(ns["DeepEvidenceNoRows"], match="holds no rows in the KPI window"):
        empty.measure_kpi(spec)
    assert _deep(ns, {"v": 0, "n": 12}).measure_kpi(spec) == 0.0, "a zero over real rows is a measured zero"
    sql = empty._read.statements[0]
    rows_part = sql.split(") AS v, (")[1]
    assert rows_part.startswith("SELECT COUNT(*) AS v FROM `main`.`s`.`orders` WHERE `order_date` >=")
    assert "status" not in rows_part, "the row count ignores the KPI filter, so a filtered zero stays measured"
    view = _deep(ns, {"v": 3.0})
    assert view.measure_kpi({"metric_view": "main.s.mv", "measure": "orders"}) == 3.0
    assert " AS n" not in view._read.statements[0]


def test_baselines_on_empty_tables_stay_unmeasured_and_are_logged_once(ns):
    import types
    inst = _inst(ns, discovery_type="AI Enhanced Discovery")

    def measure(spec):
        if spec["query"] != "SELECT 3":
            raise ns["DeepEvidenceNoRows"]("main.s.orders holds no rows")
        return 0.0
    inst.deep_evidence = types.SimpleNamespace(max_kpi_baselines=10, measure_kpi=measure)
    ucs = [{"KPIs": [{"name": f"K{i}", "computable": True, "query": f"SELECT {i}"}]} for i in (1, 2, 3)]
    stats = inst._measure_kpi_baselines(ucs)
    assert stats == {"computable": 3, "measured": 1, "unmeasured": 2, "skipped": 0}
    assert [uc["KPIs"][0]["baseline"] for uc in ucs[:2]] == [None, None]
    assert ucs[2]["KPIs"][0]["baseline"]["value"] == 0.0
    assert _messages(inst, "2 KPI baselines were not measured: their tables hold no rows, so there is no data to measure")
    assert not _messages(inst, "unavailable")


def _signal(ns, item, tables="main.s.trips"):
    inst = _inst(ns)
    uc = {"No": "N03-U01", "Name": "Flag Slow Trips", "Analytics Technique": "Anomaly Detection", "Tables Involved": tables}
    return inst._signal_spec(uc, item, {})[1]


def test_the_skip_reason_says_why_no_table_was_named(ns):
    note = "Speed has to be computed from the pickup and dropoff timestamps."
    assert _signal(ns, {"table": "", "reason": "derived", "note": note}) == (
        f"a column it needs has to be derived from other columns: {note}")
    assert _signal(ns, {"table": "", "reason": "missing"}) == "its tables hold no column for a role it needs"
    assert _signal(ns, {"table": "", "reason": "cross_table"}) == "its table does not hold every column it needs as it stands"
    assert _signal(ns, {"table": "", "note": ""}) == "its table does not hold every column it needs as it stands"
    assert _signal(ns, {"table": "", "reason": "Cross-table"}, tables="main.s.trips, main.s.zones") == (
        "no single table holds the columns it needs")
    prompt = ns["PROMPT_TEMPLATES"]["SIGNAL_CHECK_PROMPT"]
    assert '"reason" is "derived" when a role would have to be computed from other columns' in prompt
    assert '"reason": "", "note": ""' in prompt
