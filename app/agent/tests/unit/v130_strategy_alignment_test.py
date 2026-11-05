"""v1.3.0 post-selection strategy alignment: verbatim paths from ids, evidence on the use case's own
columns, structured KPIs built only by DeepEvidence.kpi_sql, figures only from the user or a measured
baseline, re-rank without membership change, gap report, roster-aware sponsors."""
import json
import re
import types

import pytest

from v120_modes_context_test import make_obj

SCHEMA = [("c", "s", "orders", "order_id", "bigint", ""), ("c", "s", "orders", "customer_id", "bigint", ""),
          ("c", "s", "orders", "amount", "double", ""), ("c", "s", "orders", "status", "string", ""),
          ("c", "s", "orders", "order_date", "date", ""), ("c", "s", "stock", "sku", "string", ""),
          ("c", "s", "stock", "on_hand", "int", "")]
TREE = {"schema_version": 1, "levels": ["Pillar", "Objective"],
        "strategy": [{"name": "Customer", "children": [
            {"name": "Grow repeat purchases",
             "kpis": [{"name": "Repeat purchase rate", "unit": "%", "direction": "increase"}],
             "key_results": [{"statement": "Raise repeat purchase rate from 18% to 24% by Q4", "kpi": "Repeat purchase rate"}]},
            {"name": "Lift satisfaction"}]},
            {"name": "Operations", "children": ["Cut stockouts"]}],
        "priorities": ["Grow revenue", "Protect margin"],
        "sponsors": [{"role": "Chief Executive Officer"},
                     {"role": "Chief Customer Officer", "reports_to": "Chief Executive Officer", "owns": ["Customer"]},
                     {"role": "Head of Supply", "reports_to": "Chief Executive Officer", "owns": ["Supply"]}]}


def uc(no, tables="c.s.orders", **extra):
    base = {"No": no, "Name": f"Use case {no}", "Statement": "s", "Solution": "Model it", "Business Value": "v",
            "Tables Involved": tables, "Business Domain": "Sales", "Analytics Technique": "Forecasting",
            "Sponsor": "Chief Operating Officer", "scoring_status": "scored", "Quality Score": 4.0, "Priority": 7.0,
            "Return on Investment": 4.0, "Time to Value": 3.0, "Reusability": 3.0, "Feasibility": 4.0}
    base.update(extra)
    return base


def answer(no, **extra):
    item = {"use_case_id": no, "alignments": [{"id": "S1.1", "evidence": "Repeat orders per `customer_id` move it"}],
            "priority_alignment": ["grow revenue"], "strategic_alignment": 4.6,
            "kpis": [{"name": "Repeat buyers", "kpi_id": "K1", "direction": "increase", "unit": "%", "aggregation": "COUNT_DISTINCT",
                      "table": "c.s.orders", "column": "customer_id", "filter_column": "status", "filter_value": "shipped",
                      "denominator": {"aggregation": "COUNT_DISTINCT", "column": "customer_id"},
                      "time_column": "order_date", "window_days": 90}],
            "key_result_ids": ["R1"], "proposed_key_results": ["Raise repeat buyers from [BASELINE] to [TARGET] within [WINDOW]"],
            "measures_of_success": ["Weekly repeat-buyer report is used in the trading meeting"],
            "financial_benefits": ["Repeat revenue driven by `amount` from [BASELINE:K1], [ASSUMPTION: uplift to be agreed with the sponsor]"],
            "non_financial_benefits": ["Better loyalty insight"], "sponsor_id": None}
    item.update(extra)
    return item


def harness(agent_ns, answers=None, tree=TREE, deep=None, responder=None):
    def default_responder(prompt_name, prompt_vars, skip_cache):
        assert prompt_name == "STRATEGY_ALIGNMENT_PROMPT"
        ids = [p["use_case_id"] for p in json.loads(prompt_vars["use_cases_json"])]
        if answers is None:
            return "not json"
        return json.dumps([answers[i] for i in ids if i in answers] + [answer("GHOST-1")])
    obj = make_obj(agent_ns, responder or default_responder)
    obj._gate_schema_index(SCHEMA)
    obj.strategy_tree = tree if tree.get("source") else agent_ns["parse_strategic_context"](json.dumps(tree))
    obj.merged_business_context = {"business_context": "A retailer", "business_priorities": []}
    obj.deep_evidence = deep
    obj.discovery_evidence = {"metric_views": [{"fqn": "c.s.mv_orders", "source": "c.s.orders",
                                                "measures": [{"name": "revenue", "expr": "SUM(amount)"}]}],
                              "profiles": {"c.s.orders": {"rows": 100, "columns": {"status": {
                                  "distinct": 2, "top_values": [{"value": "shipped", "share": 0.7},
                                                                {"value": "pending", "share": 0.3}]}}}},
                              "join_matches": []}
    return obj


def context(agent_ns, obj):
    return obj._alignment_context(obj.strategy_tree)


def test_catalog_and_prompt_lines_carry_verbatim_paths_and_ids(agent_ns):
    tree = agent_ns["parse_strategic_context"](json.dumps(TREE))
    catalog = agent_ns["strategy_catalog"](tree)
    assert catalog["entries"]["S1.1"]["path"] == "Customer > Grow repeat purchases"
    assert catalog["entries"]["S2.1"]["ancestors"] == ["S2"]
    assert catalog["kpis"]["K1"]["entry_id"] == "S1.1" and catalog["key_results"]["R1"]["kpi_id"] == "K1"
    lines = agent_ns["strategy_prompt_lines"](tree)
    assert "S1.1 [Objective] Grow repeat purchases" in lines and "K1 KPI: Repeat purchase rate (increase, %)" in lines
    assert "R1 Key result: Raise repeat purchase rate from 18% to 24% by Q4 (KPI K1)" in lines
    assert agent_ns["strategy_prompt_lines"]({}) == "(no strategy entries: every use case is Not aligned)"


def test_valid_answer_resolves_paths_priorities_kpis_and_key_results(agent_ns):
    obj = harness(agent_ns)
    record = obj._validate_alignment_record(answer("U1"), uc("U1"), context(agent_ns, obj))
    assert record["alignments"] == [{"id": "S1.1", "path": "Customer > Grow repeat purchases",
                                     "evidence": "Repeat orders per `customer_id` move it"}]
    assert record["priorities"] == ["Grow revenue"] and record["strategic_alignment"] == 4.6
    kpi = record["kpis"][0]
    assert kpi["computable"] and kpi["table"] == "c.s.orders" and kpi["window_days"] == 90
    assert kpi["query"] == ("SELECT CAST(COUNT(DISTINCT `customer_id`) FILTER (WHERE `status` = 'shipped') AS DOUBLE) / "
                            "NULLIF(CAST(COUNT(DISTINCT `customer_id`) AS DOUBLE), 0) * 100 AS v FROM `c`.`s`.`orders` "
                            "WHERE `order_date` >= LEAST(current_date(), (SELECT CAST(MAX(`order_date`) AS DATE) FROM `c`.`s`.`orders`)) - INTERVAL 90 DAYS")
    assert record["key_results"][0] == {"id": "R1", "statement": "Raise repeat purchase rate from 18% to 24% by Q4",
                                        "kpi_id": "K1", "source": "strategy"}
    assert record["key_results"][1]["source"] == "proposed"


def test_alignment_without_column_evidence_is_dropped_to_not_aligned(agent_ns):
    obj = harness(agent_ns)
    item = answer("U1", alignments=[{"id": "S1.1", "evidence": "Customers love it"},
                                    {"id": "S9.9", "evidence": "`amount` matters"}])
    record = obj._validate_alignment_record(item, uc("U1"), context(agent_ns, obj))
    assert record["alignments"] == [] and record["strategic_alignment"] == 1.0
    assert record["key_results"][0]["source"] == "proposed", "R1 sits on an entry the use case is not aligned to"
    assert any("cites none of the use case's columns" in n for n in record["notes"])
    assert any("unknown strategy id 'S9.9'" in n for n in record["notes"])


def test_min_or_max_of_a_personal_column_is_never_measured(agent_ns):
    obj = harness(agent_ns)
    obj._gate_schema_index(SCHEMA + [("c", "s", "orders", "store_latitude", "double", ""),
                                     ("c", "s", "orders", "loyalty_code", "string", "")])
    obj.data_loader = types.SimpleNamespace(_column_tags={("c", "s", "orders"): {"Loyalty_Code": {"class": "PII"}}},
                                            _lkey=lambda c, s, t: (c.lower(), s.lower(), t.lower()))
    item = answer("U1", kpis=[{"name": "Northmost store", "aggregation": "MAX", "table": "c.s.orders", "column": "store_latitude"},
                              {"name": "Lowest code", "aggregation": "MIN", "table": "c.s.orders", "column": "loyalty_code"},
                              {"name": "Stores", "aggregation": "COUNT_DISTINCT", "table": "c.s.orders", "column": "store_latitude"}])
    record = obj._validate_alignment_record(item, uc("U1"), context(agent_ns, obj))
    by_name = {k["name"]: k for k in record["kpis"]}
    assert not by_name["Northmost store"]["computable"] and by_name["Northmost store"]["query"] is None
    assert not by_name["Lowest code"]["computable"], "a tag-matched personal column is refused too"
    assert by_name["Stores"]["computable"], "counting a personal column reads no value"
    assert any("MAX of the personal column 'store_latitude' is never measured" in n for n in record["notes"])


def test_kpi_on_a_foreign_table_or_invented_column_is_not_computable(agent_ns):
    obj = harness(agent_ns)
    ctx = context(agent_ns, obj)
    item = answer("U1", kpis=[{"name": "Stock", "aggregation": "SUM", "table": "c.s.stock", "column": "on_hand"},
                              {"name": "Ghost", "aggregation": "SUM", "table": "c.s.orders", "column": "margin"},
                              {"name": "Revenue", "metric_view": "c.s.mv_orders", "measure": "REVENUE"},
                              {"name": "Shipped", "aggregation": "COUNT", "table": "c.s.orders",
                               "filter_column": "status", "filter_value": "returned"}])
    record = obj._validate_alignment_record(item, uc("U1"), ctx)
    by_name = {k["name"]: k for k in record["kpis"]}
    assert len(record["kpis"]) == 3, "at most 3 KPIs are kept"
    assert not by_name["Stock"]["computable"] and by_name["Stock"]["query"] is None
    assert not by_name["Ghost"]["computable"]
    assert by_name["Revenue"]["query"] == "SELECT CAST(MEASURE(`revenue`) AS DOUBLE) AS v FROM `c`.`s`.`mv_orders`"
    absent = obj._validate_alignment_record(answer("U1", kpis=[item["kpis"][3]]), uc("U1"), ctx)
    assert not absent["kpis"][0]["computable"] and absent["kpis"][0]["query"] is None, \
        "a filter value the data does not have never turns into a count of every row"
    assert any("matches none of the values" in note for note in absent["notes"])
    kept = obj._validate_alignment_record(answer("U1", kpis=[dict(item["kpis"][3], filter_value="SHIPPED")]),
                                          uc("U1"), ctx)["kpis"][0]
    assert kept["query"] == "SELECT COUNT(*) AS v FROM `c`.`s`.`orders` WHERE `status` = 'shipped'", \
        "the data's own spelling of the value is used"


def test_invented_figures_are_replaced_and_user_figures_are_kept(agent_ns):
    obj = harness(agent_ns)
    item = answer("U1", financial_benefits=["Cuts cost by 25% and adds $2 million, toward the 24% target"],
                  measures_of_success=["Adoption reaches 3x"])
    record = obj._validate_alignment_record(item, uc("U1"), context(agent_ns, obj))
    text = record["financial"][0]
    assert "25%" not in text and "$2 million" not in text and "24%" in text
    assert text.count("[ESTIMATE: depends on c.s.orders.customer_id]") == 2
    assert record["measures"] == ["Adoption reaches [ESTIMATE: depends on c.s.orders.customer_id]"]
    assert record["scrubbed"] == 3


@pytest.mark.parametrize("change", [{"financial_benefits": []}, {"non_financial_benefits": [""]}, {"kpis": []},
                                    {"strategic_alignment": None}])
def test_incomplete_answers_are_rejected_for_retry(agent_ns, change):
    obj = harness(agent_ns)
    assert obj._validate_alignment_record(answer("U1", **change), uc("U1"), context(agent_ns, obj)) is None


def test_pass_keeps_membership_and_order_and_ignores_ghost_ids(agent_ns):
    obj = harness(agent_ns, answers={"U1": answer("U1"), "U2": answer("U2", alignments=[])})
    ucs = [uc("U1"), uc("U2")]
    ids_before = [id(u) for u in ucs]
    out = obj._run_strategy_alignment(ucs)
    assert out is ucs and [id(u) for u in out] == ids_before
    assert out[0]["Strategy Path"] == "Customer > Grow repeat purchases" and out[1]["Strategy Path"] == "Not aligned"
    assert out[1]["Strategic Goals Alignment"] == "Not aligned"
    assert out[0]["Business Priority Alignment"] == "Grow revenue"
    assert out[1]["Business Priority Alignment"] == "Grow revenue"


def test_rerank_uses_strategic_alignment_at_25_percent(agent_ns):
    obj = harness(agent_ns, answers={"U1": answer("U1"), "U2": answer("U2", alignments=[])})
    ucs = [uc("U1"), uc("U2")]
    obj._run_strategy_alignment(ucs)
    aligned, not_aligned = ucs
    assert aligned["Strategic Alignment"] == 4.85 and not_aligned["Strategic Alignment"] == 1.25, "1 matched priority adds 0.25"
    assert aligned["Value"] == round(4.0 * 0.60 + 4.85 * 0.25 + 3.0 * 0.075 + 3.0 * 0.075, 2)
    assert not_aligned["Value"] == round(4.0 * 0.60 + 1.25 * 0.25 + 3.0 * 0.075 + 3.0 * 0.075, 2)
    assert aligned["Priority"] > not_aligned["Priority"] and aligned["Inspire Score"] > not_aligned["Inspire Score"]


def test_failed_answers_fall_back_to_labelled_placeholders_and_a_failed_step(agent_ns):
    obj = harness(agent_ns, answers=None)
    ucs = [uc("U1", elite_assessment={"kpi": "Stock-out rate", "kpi_direction": "decrease"})]
    obj._run_strategy_alignment(ucs)
    only = ucs[0]
    assert only["KPIs"][0]["name"] == "Stock-out rate" and only["KPIs"][0]["direction"] == "decrease"
    assert only["Financial Benefits"] == ["[ESTIMATE: depends on c.s.orders]"]
    assert only["Strategy Alignment"] == [] and only["Strategic Alignment"] == 1.0
    assert [f["step"] for f in obj.failed_steps] == ["Strategy Alignment"]


def flaky_alignment(failures):
    calls = []

    def responder(prompt_name, prompt_vars, skip_cache):
        calls.append(skip_cache)
        if len(calls) <= failures:
            raise RuntimeError("endpoint returned 500")
        return json.dumps([answer(p["use_case_id"]) for p in json.loads(prompt_vars["use_cases_json"])])
    return responder, calls


def recorded_errors(obj):
    return [line for level, line in obj.logger.records if level == "ERROR"]


def test_a_strategy_alignment_call_that_fails_then_succeeds_on_retry_logs_no_error(agent_ns):
    from v120_runtime_reliability_test import RecordingLogger
    responder, calls = flaky_alignment(failures=1)
    obj = harness(agent_ns, responder=responder)
    obj.logger = RecordingLogger()
    ucs = [uc("U1")]
    obj._run_strategy_alignment(ucs)
    assert calls == [False, True] and ucs[0]["Strategy Alignment"]
    assert recorded_errors(obj) == []


def test_a_strategy_alignment_call_that_fails_every_attempt_logs_exactly_one_error_naming_the_call(agent_ns):
    from v120_runtime_reliability_test import RecordingLogger
    responder, calls = flaky_alignment(failures=99)
    obj = harness(agent_ns, responder=responder)
    obj.logger = RecordingLogger()
    ucs = [uc("U1")]
    obj._run_strategy_alignment(ucs)
    errors = recorded_errors(obj)
    assert len(calls) >= 2 and ucs[0]["Strategy Alignment"] == []
    assert len(errors) == 1 and errors[0].startswith("[StrategyAlign]") and "placeholder KPIs" in errors[0], errors
    assert "U1: RuntimeError: endpoint returned 500" in errors[0]


def test_builtin_goals_reproduce_the_legacy_alignment_values(agent_ns):
    builtin = agent_ns["build_builtin_strategy"]("Reduce Cost (automate manual work), Increase Revenue")
    obj = harness(agent_ns, answers={
        "U1": answer("U1", alignments=[{"id": "S1", "evidence": "Fewer manual touches on `order_id`"}],
                     key_result_ids=[], priority_alignment=[]),
        "U2": answer("U2", alignments=[], key_result_ids=[], priority_alignment=[])}, tree=builtin)
    ucs = [uc("U1"), uc("U2")]
    obj._run_strategy_alignment(ucs)
    assert ucs[0]["Strategic Goals Alignment"] == "Reduce Cost"
    assert ucs[1]["Strategic Goals Alignment"] == "General Improvement"
    assert ucs[0]["Business Priority Alignment"] == "General Improvement"
    assert ucs[1]["Strategy Path"] == ""


def test_standard_emits_the_kpi_query_and_deep_measures_the_baseline(agent_ns):
    standard = harness(agent_ns, answers={"U1": answer("U1")})
    ucs = [uc("U1")]
    standard._run_strategy_alignment(ucs)
    kpi = ucs[0]["KPIs"][0]
    assert kpi["query"] and kpi["baseline"] is None
    assert "[BASELINE: measured by the KPI query]" in ucs[0]["Financial Benefits"][0]

    from v120_artifacts_support import FakeSpark
    from v130_evidence_test import Row
    spark = FakeSpark(responder=lambda statement: [Row(v=4200)])
    deep = agent_ns["DeepEvidence"](spark, "Deep", standard.logger)
    obj = harness(agent_ns, answers={"U1": answer("U1"), "U2": answer("U2")}, deep=deep)
    obj.discovery_type = "AI Enhanced Discovery"
    ucs = [uc("U1"), uc("U2")]
    obj._run_strategy_alignment(ucs)
    assert ucs[0]["KPIs"][0]["baseline"]["value"] == 4200.0 and ucs[0]["KPIs"][0]["baseline"]["window_days"] == 90
    assert ucs[0]["KPIs"][0]["baseline"]["window_anchor"] == "newest data", "a new baseline says its window ends at the newest data"
    assert "LEAST(current_date(), (SELECT CAST(MAX(`order_date`) AS DATE) FROM `c`.`s`.`orders`)) - INTERVAL 90 DAYS" in spark.statements[0]
    assert len(spark.statements) == 1, "identical KPI queries are measured once"
    assert re.search(r"from 4,200 \(Repeat purchase rate, last 90 days to the newest data, measured \d{4}-\d{2}-\d{2}\)",
                     ucs[0]["Financial Benefits"][0])
    assert "[TARGET]" in ucs[0]["Expected Key Results"][1]["statement"]
    assert "4,200" in ucs[0]["Expected Key Results"][1]["statement"]
    assert ucs[0]["Data Evidence"] == {"tables": {"c.s.orders": {"rows": 100, "sampled": False, "date_ranges": {}}},
                                       "joins": []}


def test_coverage_rolls_up_and_reports_the_highest_uncovered_entries(agent_ns):
    obj = harness(agent_ns, answers={"U1": answer("U1"), "U2": answer("U2")})
    obj._run_strategy_alignment([uc("U1"), uc("U2")])
    coverage = obj.strategy_coverage
    counts = {e["id"]: e["use_cases"] for e in coverage["entries"]}
    assert counts == {"S1": 2, "S1.1": 2, "S1.2": 0, "S2": 0, "S2.1": 0}
    assert [g["id"] for g in coverage["gaps"]] == ["S1.2", "S2"]
    assert coverage["gaps"][0]["reason"] == "No data-backed use case found in the scanned data"
    assert coverage["priorities"] == [{"priority": "Grow revenue", "use_cases": 2}, {"priority": "Protect margin", "use_cases": 0}]
    assert coverage["priority_gaps"] == ["Protect margin"]
    results = obj._merge_run_outcome_into_results()
    assert results["strategy_coverage"]["aligned"] == 2 and results["strategic_context"]["levels"] == ["Pillar", "Objective"]


def test_roster_keeps_roster_roles_maps_owners_and_never_leaves_the_roster(agent_ns):
    answers = {"U1": answer("U1"),
               "U2": answer("U2", alignments=[]),
               "U3": answer("U3", alignments=[], sponsor_id="SP3"),
               "U4": answer("U4", alignments=[], sponsor_id="SP99"),
               "U5": answer("U5", alignments=[])}
    obj = harness(agent_ns, answers=answers)
    ucs = [uc("U1"), uc("U2", **{"Business Domain": "Supply"}), uc("U3"), uc("U4"),
           uc("U5", Sponsor="chief executive officer")]
    obj._run_strategy_alignment(ucs)
    assert [u["Sponsor"] for u in ucs] == ["Chief Customer Officer", "Head of Supply", "Head of Supply",
                                           "Chief Executive Officer", "Chief Executive Officer"]
    roster_roles = {s["role"] for s in obj.strategy_tree["sponsors"]}
    assert all(u["Sponsor"] in roster_roles for u in ucs)


def test_alignment_warns_when_almost_everything_is_aligned(agent_ns, caplog):
    answers = {f"U{i}": answer(f"U{i}") for i in range(1, 7)}
    obj = harness(agent_ns, answers=answers)
    import logging
    with caplog.at_level(logging.INFO):
        obj._run_strategy_alignment([uc(f"U{i}") for i in range(1, 7)])
    text = caplog.text
    assert "[STRATEGY-ALIGN FIRED] source=customer aligned 6/6" in text
    assert "[STRATEGY-ALIGN WARN]" in text and "[SPONSOR_ROSTER FIRED]" in text and "[STRATEGY-ENRICH FIRED]" in text


DECOY_TREE = {"schema_version": 1, "levels": ["Pillar", "Objective"],
              "strategy": [{"name": "Customer", "children": [
                  {"name": "Grow repeat purchases",
                   "kpis": [{"name": "Repeat purchase rate", "unit": "%", "direction": "increase"}]}]},
                  {"name": "Operations", "children": [
                      {"name": "Cut stockouts"},
                      {"name": "Cut carbon emissions per delivery",
                       "kpis": [{"name": "CO2 per delivery", "unit": "kg", "direction": "decrease"}]}]}]}
LINKED_KPI = {"name": "Repeat purchase rate", "kpi_id": "K1", "direction": "increase", "aggregation": "COUNT_DISTINCT",
              "table": "c.s.orders", "column": "customer_id", "time_column": "order_date", "window_days": 90}


def decoy_responder(first, realign, calls):
    def responder(prompt_name, prompt_vars, skip_cache):
        assert prompt_name == "STRATEGY_ALIGNMENT_PROMPT"
        ids = [p["use_case_id"] for p in json.loads(prompt_vars["use_cases_json"])]
        decoy_listed = "Cut carbon emissions per delivery" in prompt_vars["strategy_entries"]
        calls.append({"ids": ids, "decoy_listed": decoy_listed})
        answers = first if decoy_listed else realign
        if answers is None:
            return "not json"
        return json.dumps([answers[i] for i in ids if i in answers])
    return responder


def decoy_answer(no, entry, kpis=None, **extra):
    return answer(no, alignments=[{"id": entry, "evidence": "Orders per `customer_id` move it"}], key_result_ids=[],
                  kpis=kpis or answer(no)["kpis"], **extra)


def test_an_entry_no_aligned_use_case_can_measure_is_dropped_reported_as_a_gap_and_realigned(agent_ns, caplog):
    calls = []
    first = {"U1": decoy_answer("U1", "S2.2"), "U2": decoy_answer("U2", "S1.1", kpis=[LINKED_KPI]),
             "U3": decoy_answer("U3", "S2.1")}
    realign = {"U1": decoy_answer("U1", "S2.1",
                                  non_financial_benefits=["Fewer empty shelves for store managers"])}
    obj = harness(agent_ns, tree=DECOY_TREE, responder=decoy_responder(first, realign, calls))
    import logging
    ucs = [uc("U1"), uc("U2"), uc("U3")]
    with caplog.at_level(logging.INFO):
        obj._run_strategy_alignment(ucs)
    assert "[STRATEGY-MEASURABLE FIRED] 1 entry" in caplog.text
    assert "Operations > Cut carbon emissions per delivery" in caplog.text
    assert [c["ids"] for c in calls if not c["decoy_listed"]] == [["U1"]]
    by_id = {u["No"]: u for u in ucs}
    assert [a["id"] for a in by_id["U1"]["Strategy Alignment"]] == ["S2.1"]
    assert by_id["U1"]["Non-Financial Benefits"] == ["Fewer empty shelves for store managers"]
    assert [a["id"] for a in by_id["U2"]["Strategy Alignment"]] == ["S1.1"]
    assert not any(a["id"] == "S2.2" for u in ucs for a in u["Strategy Alignment"])
    gaps = [g["path"] for g in obj.strategy_coverage["gaps"]]
    assert "Operations > Cut carbon emissions per delivery" in gaps


def test_an_entry_measured_by_one_aligned_use_case_keeps_every_alignment(agent_ns, caplog):
    calls = []
    first = {"U1": decoy_answer("U1", "S1.1"), "U2": decoy_answer("U2", "S1.1", kpis=[LINKED_KPI])}
    obj = harness(agent_ns, tree=DECOY_TREE, responder=decoy_responder(first, None, calls))
    import logging
    ucs = [uc("U1"), uc("U2")]
    with caplog.at_level(logging.INFO):
        obj._run_strategy_alignment(ucs)
    assert "[STRATEGY-MEASURABLE FIRED]" not in caplog.text
    assert all(not c["ids"] or c["decoy_listed"] for c in calls)
    assert [a["id"] for u in ucs for a in u["Strategy Alignment"]] == ["S1.1", "S1.1"]


def test_a_failed_realignment_removes_only_the_unmeasurable_alignments(agent_ns, caplog):
    calls = []
    two = answer("U1", alignments=[{"id": "S2.2", "evidence": "Orders per `customer_id` move it"},
                                   {"id": "S2.1", "evidence": "Orders per `customer_id` move it"}], key_result_ids=[])
    first = {"U1": two, "U2": decoy_answer("U2", "S1.1", kpis=[LINKED_KPI])}
    obj = harness(agent_ns, tree=DECOY_TREE, responder=decoy_responder(first, None, calls))
    import logging
    ucs = [uc("U1"), uc("U2")]
    with caplog.at_level(logging.INFO):
        obj._run_strategy_alignment(ucs)
    assert [a["id"] for a in ucs[0]["Strategy Alignment"]] == ["S2.1"]
    assert "alignments to entries the data cannot measure were removed" in caplog.text
    assert "1 alignment removed" in caplog.text


def test_a_physical_strategy_kpi_is_linked_only_to_a_column_that_measures_that_quantity(agent_ns):
    obj = harness(agent_ns, tree=DECOY_TREE)
    ctx = context(agent_ns, obj)
    tables = {"c.s.orders": {"customer_id": "BIGINT", "amount": "DOUBLE", "order_date": "DATE"},
              "c.s.fleet": {"co2_kg": "DOUBLE", "program_id": "BIGINT"}}

    def resolve(**raw):
        notes = []
        return obj._resolve_kpi_spec(dict({"direction": "decrease"}, **raw), tables, ctx, notes), notes
    relabeled, notes = resolve(name="CO2 per delivery", kpi_id="K2", unit="kg", aggregation="AVG", table="c.s.orders", column="amount")
    assert relabeled["kpi_id"] is None and relabeled["name"] == "avg of amount" and relabeled["unit"] == ""
    assert relabeled["computable"] and any("K2 unlinked" in note for note in notes)
    measured, notes = resolve(name="CO2 per delivery", kpi_id="K2", unit="kg", aggregation="SUM", table="c.s.fleet", column="co2_kg",
                              denominator={"aggregation": "COUNT"})
    assert measured["kpi_id"] == "K2" and measured["name"] == "CO2 per delivery" and not notes
    substring, _ = resolve(name="CO2 per delivery", kpi_id="K2", unit="kg", aggregation="AVG", table="c.s.fleet", column="program_id")
    assert substring["kpi_id"] is None, "a token inside another word (gram in program) is no evidence"
    business, notes = resolve(name="Repeat buyers", kpi_id="K1", direction="increase", unit="%", aggregation="COUNT_DISTINCT",
                              table="c.s.orders", column="customer_id",
                              denominator={"aggregation": "COUNT", "column": None})
    assert business["kpi_id"] == "K1" and business["name"] == "Repeat purchase rate" and not notes


def test_a_relabeled_physical_kpi_does_not_make_the_decoy_measurable(agent_ns, caplog):
    calls = []
    relabeled = {"name": "CO2 per delivery", "kpi_id": "K2", "direction": "decrease", "unit": "kg", "aggregation": "AVG",
                 "table": "c.s.orders", "column": "amount"}
    first = {"U1": decoy_answer("U1", "S2.2", kpis=[relabeled]), "U2": decoy_answer("U2", "S1.1", kpis=[LINKED_KPI])}
    realign = {"U1": decoy_answer("U1", "S2.1")}
    obj = harness(agent_ns, tree=DECOY_TREE, responder=decoy_responder(first, realign, calls))
    import logging
    ucs = [uc("U1"), uc("U2")]
    with caplog.at_level(logging.INFO):
        obj._run_strategy_alignment(ucs)
    assert "[STRATEGY-MEASURABLE FIRED] 1 entry" in caplog.text
    assert [a["id"] for a in ucs[0]["Strategy Alignment"]] == ["S2.1"]
    assert "Operations > Cut carbon emissions per delivery" in [g["path"] for g in obj.strategy_coverage["gaps"]]
    assert not any(k.get("name") == "CO2 per delivery" for u in ucs for k in u["KPIs"])


def test_priorities_raise_strategic_alignment_by_a_quarter_each_up_to_two_and_never_past_five(agent_ns):
    tree = dict(TREE, priorities=["Grow revenue", "Protect margin", "Lift loyalty"])
    answers = {"U0": answer("U0", priority_alignment=[]), "U1": answer("U1", priority_alignment=["grow revenue"]),
               "U2": answer("U2", priority_alignment=["grow revenue", "protect margin"]),
               "U3": answer("U3", priority_alignment=["grow revenue", "protect margin", "lift loyalty"]),
               "U4": answer("U4", strategic_alignment=4.9, priority_alignment=["grow revenue", "protect margin"])}
    obj = harness(agent_ns, answers=answers, tree=tree)
    ucs = [uc(f"U{i}") for i in range(5)]
    obj._run_strategy_alignment(ucs)
    assert [u["Strategic Alignment"] for u in ucs] == [4.6, 4.85, 5.0, 5.0, 5.0]
    assert ucs[2]["Inspire Score"] > ucs[1]["Inspire Score"] > ucs[0]["Inspire Score"], "a matched priority must move the order"


def test_ratio_kpis_are_built_only_by_the_kpi_builder_and_names_never_overclaim(agent_ns):
    obj = harness(agent_ns)
    ctx = context(agent_ns, obj)
    tables = {"c.s.orders": {"customer_id": "BIGINT", "amount": "DOUBLE", "status": "STRING", "order_date": "DATE",
                             "is_flagged": "BOOLEAN"}}
    ctx["profiles"]["c.s.orders"]["columns"]["is_flagged"] = {"top_values": [{"value": "true", "share": 0.1}]}

    def resolve(**raw):
        notes = []
        return obj._resolve_kpi_spec(dict({"direction": "increase"}, **raw), tables, ctx, notes), notes
    ratio, notes = resolve(name="Shipped order share", unit="%", aggregation="COUNT", table="c.s.orders",
                           filter_column="status", filter_value="shipped", denominator={"aggregation": "COUNT"})
    assert ratio["computable"] and ratio["name"] == "Shipped order share" and not notes
    assert ratio["query"] == ("SELECT CAST(COUNT(*) FILTER (WHERE `status` = 'shipped') AS DOUBLE) / "
                              "NULLIF(CAST(COUNT(*) AS DOUBLE), 0) * 100 AS v FROM `c`.`s`.`orders`")
    total, notes = resolve(name="Shipped order rate", unit="%", aggregation="SUM", table="c.s.orders", column="amount")
    assert total["name"] == "sum of amount" and total["unit"] == "" and any("renamed" in n for n in notes)
    flagged, _ = resolve(name="Discount amount flagged as anomalous", aggregation="SUM", table="c.s.orders", column="amount")
    assert flagged["name"] == "sum of amount", "a total of every row is never a flagged value"
    labelled, _ = resolve(name="Amount flagged as anomalous", aggregation="SUM", table="c.s.orders", column="amount",
                          filter_column="is_flagged", filter_value="true")
    assert labelled["name"] == "Amount flagged as anomalous", "a filter on a label column produces the flagged value"
    average, _ = resolve(name="Average order value per order", aggregation="AVG", table="c.s.orders", column="amount")
    assert average["name"] == "Average order value per order"
    proxy, notes = resolve(name="Repeat buyers", kpi_id="K1", unit="%", aggregation="COUNT_DISTINCT", table="c.s.orders",
                           column="customer_id")
    assert proxy["kpi_id"] == "K1" and proxy["name"] == "Repeat purchase rate (proxy: count_distinct of customer_id)"
    assert proxy["unit"] == "" and any("kept as a proxy" in n for n in notes)
    bad_denominator, notes = resolve(name="Shipped share", unit="%", aggregation="COUNT", table="c.s.orders",
                                     denominator={"aggregation": "SUM", "column": "missing_column"})
    assert not bad_denominator["computable"] and bad_denominator["query"] is None
    assert any("denominator column" in n for n in notes)


def test_a_kpi_named_for_a_period_is_measured_over_that_period_or_renamed_for_what_it_computes(agent_ns):
    obj = harness(agent_ns)
    ctx = context(agent_ns, obj)
    tables = {"c.s.orders": {"customer_id": "BIGINT", "amount": "DOUBLE", "daily_amount": "DOUBLE", "order_date": "DATE"}}

    def resolve(name, aggregation="SUM", column="amount", **raw):
        notes = []
        spec = obj._resolve_kpi_spec(dict({"direction": "increase", "name": name, "aggregation": aggregation,
                                           "table": "c.s.orders", "column": column}, **raw), tables, ctx, notes)
        return spec, notes
    every_row, notes = resolve("Daily Fare Revenue")
    assert every_row["computable"] and every_row["name"] == "sum of amount", "a total of every row is never a daily value"
    assert any("Daily Fare Revenue" in note and "renamed" in note for note in notes)
    assert "WHERE" not in every_row["query"]
    for name, days in (("Daily Fare Revenue", 1), ("Weekly orders", 7), ("Monthly revenue", 30), ("Monthly revenue", 31),
                       ("Monthly revenue", 28), ("Quarterly revenue", 91), ("Annual revenue", 365), ("yearly revenue", 366)):
        kept, notes = resolve(name, aggregation="COUNT" if "orders" in name else "SUM",
                              column=None if "orders" in name else "amount", time_column="order_date", window_days=days)
        assert kept["name"] == name and kept["window_days"] == days and not notes, (name, days, notes)
        assert f"INTERVAL {days} DAYS" in kept["query"], (name, days)
    for name, days in (("Daily Fare Revenue", 30), ("Weekly orders", 30), ("Monthly revenue", 90), ("Quarterly revenue", 30),
                       ("Annual revenue", 90), ("Revenue YTD", 365), ("Revenue year-to-date", 365), ("MTD revenue", 30)):
        renamed, notes = resolve(name, time_column="order_date", window_days=days)
        assert renamed["name"] == "sum of amount" and any("renamed" in note for note in notes), (name, days)
    average, notes = resolve("Average daily amount", aggregation="AVG", column="daily_amount")
    assert average["name"] == "Average daily amount" and not notes, "an average of a column that is already per day is a daily value"
    summed, _ = resolve("Daily amount", column="daily_amount")
    assert summed["name"] == "sum of daily_amount", "a total of a daily column over every row is not a daily value"
    no_period, notes = resolve("Fare revenue")
    assert no_period["name"] == "Fare revenue" and not notes, "a name with no period word needs no window"
    dayparts, notes = resolve("Day trips revenue")
    assert dayparts["name"] == "Day trips revenue" and not notes, "only a period word asks for a window, not any word about days"


def test_a_ratio_measures_part_of_its_denominator_and_a_percent_is_always_a_share(agent_ns):
    obj = harness(agent_ns)
    ctx = context(agent_ns, obj)
    tables = {"c.s.orders": {"order_id": "BIGINT", "customer_id": "BIGINT", "amount": "DOUBLE", "status": "STRING",
                             "order_date": "DATE"},
              "c.s.stock": {"sku": "STRING", "on_hand": "INT"}}

    def resolve(context_=ctx, **raw):
        notes = []
        return obj._resolve_kpi_spec(dict({"direction": "decrease"}, **raw), tables, context_, notes), notes
    constant, notes = resolve(name="Stockout rate", unit="%", aggregation="COUNT", table="c.s.orders",
                              denominator={"aggregation": "COUNT"})
    assert not constant["computable"] and constant["query"] is None and constant["baseline"] is None
    assert any("the numerator equals the denominator (count of rows)" in note for note in notes)
    same_sum, _ = resolve(name="Return rate", unit="%", aggregation="SUM", table="c.s.orders", column="amount",
                          denominator={"aggregation": "SUM", "column": "amount"})
    assert not same_sum["computable"], "SUM of a column over the same SUM is constant too"
    stockout, notes = resolve(name="Stockout rate", unit="%", aggregation="COUNT", table="c.s.stock",
                              filter_column="on_hand", filter_value=0, denominator={"aggregation": "COUNT"})
    assert stockout["computable"] and not notes, "a number filter is kept although the evidence lists no values for it"
    assert stockout["query"] == ("SELECT CAST(COUNT(*) FILTER (WHERE `on_hand` = 0) AS DOUBLE) / "
                                 "NULLIF(CAST(COUNT(*) AS DOUBLE), 0) * 100 AS v FROM `c`.`s`.`stock`")
    standard, _ = resolve(context_=dict(ctx, profiles={}), name="Returned orders", aggregation="COUNT", table="c.s.orders",
                          filter_column="status", filter_value="returned")
    assert standard["query"] == "SELECT COUNT(*) AS v FROM `c`.`s`.`orders` WHERE `status` = 'returned'", \
        "without data evidence a filter value cannot be disproved, so it is kept"
    ghost, notes = resolve(name="Late orders", aggregation="COUNT", table="c.s.orders", filter_column="is_late", filter_value="true")
    assert not ghost["computable"] and any("filter column 'is_late' does not exist" in note for note in notes)

    per_row, notes = resolve(name="Return rate", unit="%", aggregation="SUM", table="c.s.orders", column="amount",
                             denominator={"aggregation": "COUNT"})
    assert per_row["name"] == "sum of amount per count of rows" and per_row["unit"] == ""
    assert per_row["query"] == ("SELECT CAST(SUM(`amount`) AS DOUBLE) / NULLIF(CAST(COUNT(*) AS DOUBLE), 0) AS v "
                                "FROM `c`.`s`.`orders`"), "a value per row is never multiplied into a percent"
    linked, notes = resolve(name="Repeat buyers", kpi_id="K1", unit="%", aggregation="SUM", table="c.s.orders", column="amount",
                            denominator={"aggregation": "COUNT_DISTINCT", "column": "order_id"})
    assert linked["kpi_id"] == "K1" and linked["unit"] == ""
    assert linked["name"] == "Repeat purchase rate (proxy: sum of amount per count_distinct of order_id)"
    share, notes = resolve(name="Shipped amount share", unit="%", aggregation="SUM", table="c.s.orders", column="amount",
                           filter_column="status", filter_value="shipped", denominator={"aggregation": "SUM", "column": "amount"})
    assert share["computable"] and share["name"] == "Shipped amount share" and share["query"].endswith("* 100 AS v FROM `c`.`s`.`orders`")
    per_order, _ = resolve(name="Amount per order", unit="USD", aggregation="SUM", table="c.s.orders", column="amount",
                           denominator={"aggregation": "COUNT_DISTINCT", "column": "order_id"})
    assert per_order["name"] == "Amount per order" and per_order["unit"] == "USD" and "* 100" not in per_order["query"]


def test_built_in_goals_never_warn_about_stretched_alignment(agent_ns, caplog):
    tree = agent_ns["build_builtin_strategy"]("Increase Revenue, Reduce Cost")
    answers = {f"U{i}": answer(f"U{i}", alignments=[{"id": "S1", "evidence": "Repeat orders per `customer_id` move it"}],
                               key_result_ids=[]) for i in range(1, 7)}
    obj = harness(agent_ns, answers=answers, tree=tree)
    import logging
    with caplog.at_level(logging.INFO):
        obj._run_strategy_alignment([uc(f"U{i}") for i in range(1, 7)])
    text = caplog.text
    assert "[STRATEGY-ALIGN FIRED] source=builtin aligned 6/6" in text
    assert "[STRATEGY-ALIGN WARN]" not in text


def test_alignment_prompt_is_registered_and_renders(agent_ns):
    template = agent_ns["PROMPT_TEMPLATES"]["STRATEGY_ALIGNMENT_PROMPT"]
    names = {p["prompt_name"]: p for p in agent_ns["TECHNICAL_CONTEXT"]["prompts_models"]}
    assert names["STRATEGY_ALIGNMENT_PROMPT"]["temperature"] == 0.0
    fields = {"business_name", "business_context", "generation_instructions_section", "strategy_source", "strategy_levels",
              "strategy_entries", "business_priorities", "sponsor_roster", "metric_views", "use_cases_json"}
    import string
    assert {f for _, f, _, _ in string.Formatter().parse(template) if f} == fields
    rendered = template.format(**{f: f"<{f}>" for f in fields})
    assert "Not aligned" in rendered and "never as SQL" in rendered and "\u2014" not in rendered
    assert ("A KPI named for a period (daily, weekly, monthly, quarterly or yearly) is measured over that period: give it "
            "`time_column` and `window_days` of 1, 7, 30, 91 or 365") in rendered


def _measured(value):
    return {"value": value, "window_days": None, "measured_on": "2026-10-22"}


def test_a_proposed_key_result_takes_the_baseline_of_the_kpi_it_names(agent_ns):
    obj = harness(agent_ns, answers={})
    case = {"KPIs": [{"name": "Catalog Return Net Loss", "baseline": _measured(106483398.39)},
                     {"name": "Catalog Returned Lines", "baseline": _measured(144067)},
                     {"name": "Catalog Return Shipping Cost", "baseline": None}],
            "Expected Key Results": [
                {"statement": "Reduce Catalog Returned Lines from [BASELINE] to [TARGET] within [WINDOW]", "source": "proposed"},
                {"statement": "Reduce Catalog Return Net Loss from [BASELINE] to [TARGET] within [WINDOW]", "source": "proposed"},
                {"statement": "Reduce Catalog Return Shipping Cost from [BASELINE] to [TARGET] within [WINDOW]", "source": "proposed"},
                {"statement": "Lower the return rate from [BASELINE] to [TARGET] within [WINDOW]", "source": "proposed"},
                {"statement": "Reduce Catalog Return Net Loss from [BASELINE:K2] to [TARGET] within [WINDOW]", "source": "proposed"},
                {"statement": "Keep [BASELINE] as written", "source": "strategy"}],
            "Financial Benefits": ["Less loss than [BASELINE]", "Fewer Catalog Returned Lines than [BASELINE]"]}
    obj._fill_baseline_placeholders(case)
    statements = [kr["statement"] for kr in case["Expected Key Results"]]
    assert statements[0] == \
        "Reduce Catalog Returned Lines from 144,067 (Catalog Returned Lines, all data, measured 2026-10-22) to [TARGET] within [WINDOW]"
    assert statements[1].startswith("Reduce Catalog Return Net Loss from 106,483,398 (Catalog Return Net Loss, all data, measured 2026-10-22)")
    assert statements[2] == "Reduce Catalog Return Shipping Cost from [BASELINE: measured by the KPI query] to [TARGET] within [WINDOW]"
    assert statements[3] == "Lower the return rate from [BASELINE: measured by the KPI query] to [TARGET] within [WINDOW]", \
        "a key result that names no KPI never borrows another KPI's baseline"
    assert statements[4].startswith("Reduce Catalog Return Net Loss from 144,067 (Catalog Returned Lines"), "an explicit K index wins"
    assert statements[5] == "Keep [BASELINE] as written"
    assert case["Financial Benefits"][0].startswith("Less loss than 106,483,398 (Catalog Return Net Loss")
    assert case["Financial Benefits"][1].startswith("Fewer Catalog Returned Lines than 144,067 (Catalog Returned Lines")

    single = {"KPIs": [{"name": "Repeat purchase rate", "baseline": _measured(23.4)}],
              "Expected Key Results": [{"statement": "Raise it from [BASELINE] to [TARGET] within [WINDOW]", "source": "proposed"}]}
    obj._fill_baseline_placeholders(single)
    assert single["Expected Key Results"][0]["statement"].startswith("Raise it from 23.40 (Repeat purchase rate")


def test_kpi_baselines_are_measured_round_robin_and_a_capped_skip_is_logged(agent_ns):
    from unittest.mock import MagicMock
    obj = harness(agent_ns, answers={})
    obj.discovery_type = "AI Enhanced Discovery"
    calls = []
    obj.deep_evidence = types.SimpleNamespace(max_kpi_baselines=3, measure_kpi=lambda spec: calls.append(spec["query"]) or 7.0)
    obj.logger = MagicMock()
    ucs = [{"KPIs": [{"name": f"K{i}{j}", "computable": True, "query": f"SELECT {i}{j}"} for j in (1, 2)]} for i in (1, 2, 3)]
    stats = obj._measure_kpi_baselines(ucs)
    assert calls == ["SELECT 11", "SELECT 21", "SELECT 31"], "every use case's first KPI is measured before any second KPI"
    assert stats == {"computable": 6, "measured": 3, "unmeasured": 0, "skipped": 3}
    assert [case["KPIs"][0]["baseline"]["value"] for case in ucs] == [7.0, 7.0, 7.0]
    assert all(case["KPIs"][1].get("baseline") is None for case in ucs)
    warnings = " ".join(str(c) for c in obj.logger.warning.call_args_list)
    assert "3 KPI baselines were not measured: the cap on distinct KPI queries (3) was reached" in warnings
    roomy = harness(agent_ns, answers={})
    roomy.deep_evidence = types.SimpleNamespace(max_kpi_baselines=10, measure_kpi=lambda spec: 1.0)
    roomy.logger = MagicMock()
    assert roomy._measure_kpi_baselines([{"KPIs": [{"name": "A", "computable": True, "query": "SELECT 1"}]}])["skipped"] == 0
    assert not roomy.logger.warning.call_args_list
    assert agent_ns["TECHNICAL_CONTEXT"]["runtime"]["deep_max_kpi_baselines"] == 300


def test_round_48_a_value_aggregate_over_a_column_that_is_not_a_number_is_not_computable(agent_ns):
    obj = harness(agent_ns)
    ctx = context(agent_ns, obj)
    item = answer("U1", kpis=[{"name": "Status total", "aggregation": "SUM", "table": "c.s.orders", "column": "status"},
                              {"name": "Latest order", "aggregation": "MAX", "table": "c.s.orders", "column": "order_date"},
                              {"name": "Order value", "aggregation": "SUM", "table": "c.s.orders", "column": "amount"}])
    record = obj._validate_alignment_record(item, uc("U1"), ctx)
    by_name = {k["name"]: k for k in record["kpis"]}
    assert not by_name["Status total"]["computable"] and by_name["Status total"]["query"] is None
    assert not by_name["Latest order"]["computable"] and by_name["Latest order"]["query"] is None, \
        "CAST of a DATE to DOUBLE stops the query, so a date is never a KPI value"
    assert any("SUM of the STRING column 'status' is not a number" in note for note in record["notes"])
    assert any("MAX of the DATE column 'order_date' is not a number" in note for note in record["notes"])
    assert by_name["Order value"]["computable"] and \
        by_name["Order value"]["query"] == "SELECT CAST(SUM(`amount`) AS DOUBLE) AS v FROM `c`.`s`.`orders`"
    ratio = answer("U1", kpis=[{"name": "Amount per status", "aggregation": "SUM", "table": "c.s.orders", "column": "amount",
                                "denominator": {"aggregation": "AVG", "column": "status"}},
                               {"name": "Distinct statuses", "aggregation": "COUNT_DISTINCT", "table": "c.s.orders",
                                "column": "status"}])
    checked = obj._validate_alignment_record(ratio, uc("U1"), ctx)
    kept = {k["name"]: k for k in checked["kpis"]}
    assert not kept["Amount per status"]["computable"]
    assert any("denominator AVG of the STRING column 'status' is not a number" in note for note in checked["notes"])
    assert kept["Distinct statuses"]["computable"], "counting a string column reads no value"
