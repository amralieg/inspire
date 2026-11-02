"""v1.3.0 feedback: the agent reads __inspire_feedback (its own table, allowed in Standard), excludes
rejected use cases by stable key, labels accepted/planned/implemented history, lists rejected use cases
to the dedup review, and tracks the value of implemented use cases (Deep measures, Standard emits SQL)."""
import json
import types

import pytest

from v120_artifacts_support import FakeSpark, make_inspire
from v130_evidence_test import Row


def obj_with(agent_ns, rows=(), tracking_rows=(), deep=None):
    def responder(statement):
        if "__inspire_feedback" in statement and statement.startswith("SELECT"):
            return list(rows)
        if "__inspire_usecases" in statement and statement.startswith("SELECT use_case_key, kpis"):
            return list(tracking_rows)
        return []
    spark = FakeSpark(responder=responder)
    obj = make_inspire(agent_ns, spark=spark, inspire_database="main.inspire", business_name="Acme",
                       _tracking_table_name="`main`.`inspire`.`__inspire_usecases`")
    obj.deep_evidence = deep
    obj.data_loader = types.SimpleNamespace(metadata_unavailable_report=lambda: {"count": 0, "tables": []},
                                            foreign_key_graph={})
    return obj, spark


def fb(key, status, title="t", updated="2026-10-01", reason=""):
    return Row(use_case_key=key, use_case_title=title, status=status, reason=reason, session_id=1, updated_at=updated)


def test_use_case_key_is_stable_and_normalized(agent_ns):
    key = agent_ns["use_case_key"]
    a = {"Name": "Forecast Weekly Demand!", "Tables Involved": "`C`.`S`.`Orders`, c.s.items"}
    b = {"Name": "forecast   weekly demand", "Tables Involved": "c . s . orders"}
    assert key(a) == key(b) == "forecast weekly demand|c.s.orders"
    assert key({"Name": "x"}) == "x|"


def test_feedback_is_read_from_the_own_table_with_a_bound_business_name(agent_ns):
    obj, spark = obj_with(agent_ns, rows=[fb("a|c.s.t", "rejected", updated="2026-10-02"),
                                          fb("a|c.s.t", "accepted", updated="2026-10-01"),
                                          fb("b|c.s.t", "implemented"), fb("c|c.s.t", "planned"), fb("d|c.s.t", "bogus")])
    obj._load_feedback()
    create = next(s for s in spark.statements if s.startswith("CREATE TABLE IF NOT EXISTS `main`.`inspire`.`__inspire_feedback`"))
    assert "`use_case_key` STRING" in create and "`status` STRING" in create
    select = next(s for s in spark.statements if s.startswith("SELECT use_case_key"))
    assert "lower(business_name) = lower(:business)" in select and "Acme" not in select
    assert list(obj.feedback_rejected) == ["a|c.s.t"], "the latest feedback for a key wins"
    assert sorted(obj.feedback_history) == ["b|c.s.t", "c|c.s.t"]


def test_rejected_use_cases_are_excluded_and_history_is_labelled_not_removed(agent_ns):
    obj, _spark = obj_with(agent_ns, rows=[fb("forecast demand|c.s.orders", "rejected", title="Forecast demand"),
                                           fb("cut waste|c.s.stock", "implemented")])
    obj._load_feedback()
    ucs = [{"No": "U1", "Name": "Forecast Demand", "Tables Involved": "c.s.orders"},
           {"No": "U2", "Name": "Cut Waste", "Tables Involved": "c.s.stock"},
           {"No": "U3", "Name": "New idea", "Tables Involved": "c.s.orders"}]
    kept = obj._apply_feedback_exclusions(ucs)
    assert [u["No"] for u in kept] == ["U2", "U3"]
    assert kept[0]["Feedback Status"] == "implemented" and "Feedback Status" not in kept[1]
    assert obj.excluded_by_feedback[0]["use_case_id"] == "U1" and obj.excluded_by_feedback[0]["title"] == "Forecast demand"
    assert obj.funnel_ledger[-1] == {"stage": "feedback_exclusion", "in": 3, "out": 2, "drops": {"rejected_by_user": 1}}
    results = obj._merge_run_outcome_into_results()
    assert results["excluded_by_feedback"][0]["use_case_key"] == "forecast demand|c.s.orders"
    assert results["portfolio_history"][0]["status"] == "implemented"


def test_a_rejected_use_case_reworded_by_the_next_run_is_excluded_and_a_different_decision_is_kept(agent_ns):
    store, catalog = "samples.tpcds_sf1.store_sales", "samples.tpcds_sf1.catalog_sales"
    obj, _spark = obj_with(agent_ns, rows=[
        fb(f"predict high value customer churn with prioritized retention outreach queue|{store}", "rejected",
           title="Predict High-Value Customer Churn with Prioritized Retention Outreach Queue", reason="We already run a churn model"),
        fb(f"detect margin erosion from discounting with pricing recalibration recommendations|{catalog}", "rejected",
           title="Detect Margin Erosion from Discounting with Pricing Recalibration Recommendations"),
        fb(f"forecast store sales demand with inventory replenishment recommendations|{store}", "rejected",
           title="Forecast Store Sales Demand with Inventory Replenishment Recommendations")])
    obj._load_feedback()
    proposed = [("R1", "Predict High-Value Customer Churn with Retention Outreach Queue", store),
                ("R2", "Detect Margin Erosion from Discounting with Pricing Correction Actions", catalog),
                ("R3", "Detect Margin Erosion from Discounts and Coupons with Pricing Recalibration Recommendations", catalog),
                ("R4", "Reveal Margin Erosion from Discounting with Pricing Recalibration Recommendations", catalog),
                ("R5", "Forecast Store Sales Demand with Inventory Replenishment Plan", store),
                ("E1", "Predict High-Value Customer Churn with Prioritized Retention Outreach Queue", store),
                ("K1", "Predict Customer Lifetime Value with Prioritized Outreach Queue", store),
                ("K2", "Forecast Store Sales Revenue with Budget Planning Actions", store),
                ("K3", "Detect Margin Erosion from Discounting with Pricing Recalibration Recommendations", store)]
    ucs = [{"No": no, "Name": name, "Tables Involved": f"{table},samples.tpcds_sf1.item"} for no, name, table in proposed]
    kept = obj._apply_feedback_exclusions(ucs)
    assert [u["No"] for u in kept] == ["K1", "K2", "K3"], "a different decision, or the same one on another table, stays"
    by_id = {e["use_case_id"]: e for e in obj.excluded_by_feedback}
    assert sorted(by_id) == ["E1", "R1", "R2", "R3", "R4", "R5"]
    assert by_id["E1"]["match"] == "exact" and "similarity" not in by_id["E1"]
    assert all(by_id[i]["match"] == "reworded" and by_id[i]["subject_similarity"] >= 0.6 and by_id[i]["similarity"] >= 0.5
               for i in ("R1", "R2", "R3", "R4", "R5"))
    assert by_id["R1"]["proposed_title"] == "Predict High-Value Customer Churn with Retention Outreach Queue"
    assert by_id["R1"]["title"] == "Predict High-Value Customer Churn with Prioritized Retention Outreach Queue"
    assert by_id["R1"]["reason"] == "We already run a churn model"
    assert obj.funnel_ledger[-1]["drops"] == {"rejected_by_user": 6}
    messages = [msg for _level, msg in obj.logger.records]
    assert any(m.startswith("[FEEDBACK-REJECT FIRED] excluded 6 use cases the user rejected (1 exact, 5 reworded)") for m in messages)
    is_rewording = agent_ns["feedback_is_rewording"]
    assert not is_rewording("predict customer lifetime value with prioritized outreach queue",
                            "predict high value customer churn with prioritized retention outreach queue"), \
        "a shared deliverable and one shared word never make two decisions the same"
    assert agent_ns["feedback_rewording_similarity"]("", "") == (0.0, 0.0) and not is_rewording("", "")


def test_without_a_database_no_feedback_is_read(agent_ns):
    obj, spark = obj_with(agent_ns)
    obj.inspire_database = ""
    assert obj._load_feedback() == {} and spark.statements == []
    ucs = [{"No": "U1", "Name": "A", "Tables Involved": "c.s.t"}]
    assert obj._apply_feedback_exclusions(ucs) == ucs


def test_unreadable_feedback_table_degrades_to_no_feedback(agent_ns):
    obj, spark = obj_with(agent_ns)

    def broken(statement):
        raise RuntimeError("PERMISSION_DENIED: no SELECT on __inspire_feedback")
    spark.responder = broken
    assert obj._load_feedback() == {} and obj.feedback_rejected == {}


def test_review_prompt_lists_rejected_use_cases(agent_ns):
    obj, _spark = obj_with(agent_ns, rows=[fb("forecast demand|c.s.orders", "rejected", title="Forecast demand")])
    obj.parsed_generation_instructions = {}
    obj.user_generation_instructions = ""
    obj._load_feedback()
    section = obj._get_generation_instruction_for_prompt("REVIEW_USE_CASES_PROMPT")
    assert "rejected in earlier runs" in section and "- Forecast demand on `c.s.orders`" in section
    assert "Forecast demand" not in obj._get_generation_instruction_for_prompt("BASE_USE_CASE_GEN_PROMPT")


def _stored_kpis(**overrides):
    spec = {"name": "Repeat buyers", "computable": True, "aggregation": "COUNT_DISTINCT", "table": "c.s.orders",
            "column": "customer_id", "query": "DROP TABLE c.s.orders", "baseline": {"value": 100.0, "measured_on": "2026-01-01"}}
    spec.update(overrides)
    return json.dumps([spec])


def test_value_tracking_rebuilds_sql_and_measures_in_deep(agent_ns):
    measured = FakeSpark(responder=lambda statement: [Row(v=130)])
    deep = agent_ns["DeepEvidence"](measured, "Deep", make_inspire(agent_ns).logger)
    obj, spark = obj_with(agent_ns, rows=[fb("repeat|c.s.orders", "implemented", title="Repeat")],
                          tracking_rows=[Row(use_case_key="repeat|c.s.orders", kpis=_stored_kpis(), session_id=1)],
                          deep=deep)
    obj._gate_schema_index([("c", "s", "orders", "customer_id", "bigint", "")])
    obj._load_feedback()
    tracked = obj._track_implemented_value()
    assert len(tracked) == 1
    entry = tracked[0]
    assert entry["query"] == "SELECT COUNT(DISTINCT `customer_id`) AS v FROM `c`.`s`.`orders`"
    assert measured.statements == [entry["query"]], "the stored query text is never executed"
    assert entry["current"]["value"] == 130.0 and entry["change"] == 30.0 and entry["status"] == "measured"
    select = next(s for s in spark.statements if s.startswith("SELECT use_case_key, kpis"))
    assert "IN (:k0)" in select


@pytest.mark.parametrize("baseline, shown, change", [
    ({"value": 0.0, "window_days": 7, "measured_on": "2026-10-29"}, False, None),
    ({"value": 0.0, "window_days": 7, "measured_on": "2026-10-29", "window_anchor": "newest data"}, True, 130.0),
    ({"value": 100.0, "window_days": 7, "measured_on": "2026-10-29"}, True, 30.0),
])
def test_value_tracking_never_reports_a_change_from_a_0_counted_back_from_today(agent_ns, baseline, shown, change):
    measured = FakeSpark(responder=lambda statement: [Row(v=130)])
    deep = agent_ns["DeepEvidence"](measured, "Deep", make_inspire(agent_ns).logger)
    stored = _stored_kpis(time_column="order_date", window_days=7, baseline=baseline)
    obj, _spark = obj_with(agent_ns, rows=[fb("repeat|c.s.orders", "implemented", title="Repeat")],
                           tracking_rows=[Row(use_case_key="repeat|c.s.orders", kpis=stored, session_id=1)], deep=deep)
    obj._gate_schema_index([("c", "s", "orders", "customer_id", "bigint", ""), ("c", "s", "orders", "order_date", "date", "")])
    obj._load_feedback()
    entry = obj._track_implemented_value()[0]
    assert entry["current"]["value"] == 130.0 and entry["change"] == change
    assert entry["baseline"] == (baseline if shown else None)
    assert measured.statements == [entry["query"]] and "LEAST(current_date(), (SELECT CAST(MAX(`order_date`) AS DATE)" in entry["query"]


def test_value_tracking_in_standard_emits_the_query_only_and_skips_specs_off_the_metadata(agent_ns):
    obj, _spark = obj_with(agent_ns, rows=[fb("repeat|c.s.orders", "implemented")],
                           tracking_rows=[Row(use_case_key="repeat|c.s.orders",
                                              kpis=json.dumps(json.loads(_stored_kpis())
                                                              + json.loads(_stored_kpis(table="c.s.secret_payroll"))),
                                              session_id=1)])
    obj._gate_schema_index([("c", "s", "orders", "customer_id", "bigint", "")])
    obj._load_feedback()
    tracked = obj._track_implemented_value()
    assert len(tracked) == 1, "a stored spec on a table outside the scanned metadata is never measured"
    assert tracked[0]["status"] == "query_only" and tracked[0]["current"] is None and tracked[0]["query"]
