"""v1.4.0 rc.4: the stated kind survives, logs name the use case, empty tables give no baseline.

1. A stated kind that is in the catalog is never relabelled for its technique: a technique the kind does not list
   is replaced by one it lists, preferring one the use case's text names. Only a stated kind that is not in the
   catalog is relabelled to the kind of its technique, and the KIND-MATCH lines say which of the two happened.
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
                       "Optimization": "allocation", "Classification": "risk_propensity"},
    "kinds": [
        {"id": "driver_breakdown", "num": 2, "family": "measure_explain", "label": "Driver breakdown", "informational": True,
         "layout": "dashboard", "techniques": ["Pareto Analysis", "Regression Analysis", "Decomposition"]},
        {"id": "assortment", "num": 12, "family": "decide", "label": "Assortment", "informational": True,
         "layout": "dashboard", "techniques": ["Optimization", "Regression Analysis", "Correlation Analysis"]},
        {"id": "allocation", "num": 13, "family": "decide", "label": "Allocation", "informational": True,
         "layout": "dashboard", "techniques": ["Optimization"]},
        {"id": "risk_propensity", "num": 6, "family": "predict", "label": "Risk and propensity", "informational": True,
         "layout": "decision_queue", "techniques": ["Classification"]},
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


def test_a_catalog_kind_with_an_unlisted_technique_keeps_its_kind_and_takes_its_first_technique(ns):
    uc = _uc("N01-U10", "assortment", "Pareto Analysis")
    inst, kept, dropped = _q5(ns, [uc])
    assert kept == ["N01-U10"] and dropped == {}
    assert uc["Use Case Kind"] == "assortment" and "use_case_kind" not in uc and "kind_relabelled_from" not in uc
    assert (uc["Analytics Technique"], uc["technique_replaced_from"]) == ("Optimization", "Pareto Analysis")
    assert _messages(inst, '[KIND-MATCH FIRED] 1 use case kept the stated kind and took a technique that kind lists: '
                           'N01-U10 "Choose the Item Range per Store" assortment: Pareto Analysis -> Optimization')
    assert not _messages(inst, "relabelled")


def test_the_replacement_technique_is_one_the_use_case_names_when_the_kind_lists_it(ns):
    uc = _uc("N01-U11", "assortment", "Pareto Analysis", design="Fit a regression of units on shelf space per item.")
    _q5(ns, [uc])
    assert (uc["Use Case Kind"], uc["Analytics Technique"]) == ("assortment", "Regression Analysis")


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
    assert (asked["Use Case Kind"], asked["Analytics Technique"]) == ("assortment", "Optimization")
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

    def __call__(self, kind, table, sql, args=None):
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
    inst = _inst(ns)

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
