"""v1.2.0 LIVE-FIX: the defects the first live runs of the integrated build exposed (smoke S1-S14).

A1 the elite judge returns structured fatal flaws; the red-team verdict is derived from them and a
   self-contradictory record is discarded.
A2 a supervised use case whose outcome is a rule over its own signal columns in the same period is
   rejected deterministically (label leakage or tautology).
A3 data shapes metadata cannot prove are runtime assumptions the Genie notebook checks before it
   builds anything; a central grain assumption the table's own keys contradict is fatal.
A4 the elite overlap pass collapses same-decision twins across channel tables.
B5 a temporal technique accepts a date key that joins a dated table ("time via join").
B6 one key-name rule: *_number, *_no, *_num, *_code, *_key, *_sk, *_id, declared keys and natural keys.
C7 the Genie harness retries ai_query without temperature on endpoints that reject it.
C8 AI-function use cases run as the AI text family, not supervised training.
D9-D15 clustering of the final elite set, the generation CSV parser, the pipelined split retry, the
   funnel ledger drop reasons, Pass 2 seeds, the log duplicate filter and customer-visible em dashes.

Every behavioural case has a must-exclude and a must-include side. Table and column names are
generic; none comes from a sample corpus.
"""
import copy
import json
import logging
import os
import sys
import threading
import time
import types

import pytest

os.environ.setdefault("MPLBACKEND", "Agg")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _agentload import agent_source, method_node  # noqa: E402
from v120_funnel_integrity_test import HEADER, _gen_harness, _gen_row, make_inspire  # noqa: E402
from v120_genie_support import build_inspire, make_uc as genie_uc  # noqa: E402
from v120_elite_run_smoke_test import combined_scorer  # noqa: E402
from v120_run_offline_smoke_test import _build, quiet_root_logger  # noqa: E402,F401

EM = "\u2014"
DIMS = ("business_value", "evidence_strength", "implementability", "actionability")


def col(name, dtype, comment=""):
    return {"name": name, "type": dtype, "comment": comment, "nullable": True, "tags": {}}


def table(columns, pk=(), fks=()):
    return {"comment": "", "table_type": "MANAGED", "tags": {}, "last_altered": None,
            "columns": {c["name"].lower(): c for c in columns}, "primary_key": list(pk),
            "foreign_keys": [{"column": c, "ref_table": r, "ref_column": rc, "source": "inferred", "confidence": 0.8}
                             for c, r, rc in fks]}


EVIDENCE = {
    "c.s.channel_lines": table([col("ln_order_number", "BIGINT"), col("ln_item_key", "BIGINT"), col("ln_party_key", "BIGINT"),
                              col("ln_sold_date_key", "INT"), col("ln_ship_date_key", "INT"), col("ln_quantity", "INT"),
                              col("ln_net_gain", "DECIMAL(12,2)"), col("ln_ext_price", "DECIMAL(12,2)"),
                              col("ln_ext_cost", "DECIMAL(12,2)"), col("ln_discount", "DECIMAL(12,2)")],
                             fks=[("ln_item_key", "c.s.item_dim", "it_item_key"), ("ln_party_key", "c.s.party", "pa_party_key"),
                                  ("ln_sold_date_key", "c.s.date_dim", "dt_date_key"),
                                  ("ln_ship_date_key", "c.s.date_dim", "dt_date_key")]),
    "c.s.item_dim": table([col("it_item_key", "BIGINT"), col("it_category", "STRING"), col("it_label", "STRING")]),
    "c.s.party": table([col("pa_party_key", "BIGINT"), col("pa_segment", "STRING")]),
    "c.s.date_dim": table([col("dt_date_key", "INT"), col("dt_date", "DATE"), col("dt_year", "INT")]),
    "c.s.visits": table([col("visitID", "BIGINT"), col("partyID", "BIGINT"), col("siteID", "BIGINT"),
                         col("visitTime", "TIMESTAMP"), col("offering", "STRING"), col("units", "BIGINT"),
                         col("charge", "BIGINT"), col("channel", "STRING")]),
    "c.s.visit_lines": table([col("visit_id", "BIGINT"), col("line_no", "INT"), col("offering", "STRING"),
                              col("units", "BIGINT")]),
    "c.s.notes": table([col("note_text", "STRING"), col("siteID", "BIGINT"), col("note_time", "TIMESTAMP")]),
}


def inspire(ns, connected=True):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = logging.getLogger("v120_livefix")
    obj._find_join_path = lambda tables: {"connected": connected, "path": [], "strength": "inferred" if connected else "none"}
    return obj


def verify(ns, uc, a, evidence=None):
    return inspire(ns)._verify_elite_evidence(uc, a, copy.deepcopy(EVIDENCE if evidence is None else evidence))


def uc(technique, tables, **extra):
    out = {"No": "U1", "Name": "A use case", "usecase": "Act on the decision", "Analytics Technique": technique,
           "Tables Involved": tables, "Solution": "sol", "High Level Design": "hld"}
    out.update(extra)
    return out


def tier_classifier(**over):
    a = {"decision": "Which items to prune or reprice", "signal_columns": [
        "c.s.channel_lines.ln_net_gain", "c.s.channel_lines.ln_quantity", "c.s.channel_lines.ln_ext_cost"],
         "time_column": None, "entity_key_column": "c.s.item_dim.it_item_key",
         "join_path": ["c.s.channel_lines.ln_item_key = c.s.item_dim.it_item_key"],
         "outcome_definition": {"column": None, "derived_from": ["c.s.channel_lines.ln_net_gain", "c.s.channel_lines.ln_quantity"],
                                "rule": "tier from total gain and volume", "label_timing": "same_window"},
         "value_driver": "Ranking `c.s.channel_lines.ln_net_gain` per `c.s.item_dim.it_item_key` moves margin",
         "build_path": "A classifier tracked in MLflow"}
    a.update(over)
    return a


# ---------------------------------------------------------------- A1 structured fatal flaws


def judge_item(**over):
    item = {"No": "U1", "decision": "d", "kpi": "k", "value_tier": "Material", "verdict": "ELITE",
            "scores": {d: 9 for d in DIMS}, "fatal_flaws": [], "runtime_assumptions": [],
            "red_team": "Late data", "red_team_category": "RESIDUAL_RISK"}
    item.update(over)
    return item


def normalize(ns, item):
    problems = []
    obj = ns["DatabricksInspire"].__new__(ns["DatabricksInspire"])
    return obj._normalize_elite_assessment(item, problems), problems


def test_a_fatal_flaw_derives_a_fatal_red_team_verdict_and_rejects(agent_ns):
    flaw = {"category": "OUTCOME_DERIVED_FROM_INPUTS", "explanation": "The tier is a threshold over its own margin columns"}
    a, problems = normalize(agent_ns, judge_item(verdict="REJECT", fatal_flaws=[flaw],
                                                 red_team_category="OUTCOME_DERIVED_FROM_INPUTS"))
    assert problems == [] and a["red_team_verdict"] == "fatal" and a["fatal_flaws"] == [flaw]
    verdict, failed = agent_ns["DatabricksInspire"]._elite_decision(
        a, {"passed": True}, agent_ns["TECHNICAL_CONTEXT"]["runtime"])
    assert verdict == "REJECT" and failed[0] == "red_team"


def test_no_fatal_flaw_derives_survives(agent_ns):
    a, problems = normalize(agent_ns, judge_item())
    assert problems == [] and a["red_team_verdict"] == "survives"


@pytest.mark.parametrize("over, reason", [
    ({"red_team_category": "OUTCOME_DERIVED_FROM_INPUTS"}, "red team names OUTCOME_DERIVED_FROM_INPUTS"),
    ({"red_team_category": "DUPLICATE_OF_ANOTHER_USE_CASE"}, "red team names DUPLICATE_OF_ANOTHER_USE_CASE"),
    ({"red_team_category": "DATA_SHAPE_ASSUMPTION_UNVERIFIABLE"}, "neither fatal nor a runtime assumption"),
    ({"verdict": "ELITE", "fatal_flaws": [{"category": "NO_DECISION_CHANGED", "explanation": "reports only"}],
      "red_team_category": "NO_DECISION_CHANGED"}, "verdict ELITE with fatal flaws"),
    ({"verdict": "NEAR_MISS", "fatal_flaws": [{"category": "VALUE_OVERCLAIMED", "explanation": "visibility only"}],
      "red_team_category": "VALUE_OVERCLAIMED"}, "verdict NEAR_MISS with fatal flaws"),
    ({"red_team_verdict": "survives", "verdict": "REJECT", "red_team_category": "NO_DECISION_CHANGED",
      "fatal_flaws": [{"category": "NO_DECISION_CHANGED", "explanation": "reports only"}]}, "red_team_verdict disagrees"),
    ({"red_team_verdict": "fatal"}, "red_team_verdict disagrees"),
    ({"scores": dict({d: 9 for d in DIMS}, implementability=7)}, "verdict ELITE while its own scores"),
    ({"value_tier": "Incremental"}, "verdict ELITE while its own scores and value tier support REJECT"),
    ({"outcome_definition": {"column": None, "derived_from": ["c.s.t.a"], "rule": "r"}}, "without a valid label_timing"),
    ({"outcome_definition": {"column": None, "derived_from": ["c.s.t.a"], "rule": "r", "label_timing": "later"}},
     "without a valid label_timing"),
])
def test_a_self_contradictory_record_is_discarded(agent_ns, over, reason):
    a, problems = normalize(agent_ns, judge_item(**over))
    assert a is None and len(problems) == 1 and reason in problems[0], problems


def test_an_unverifiable_central_data_shape_listed_as_a_runtime_assumption_is_valid(agent_ns):
    assumption = {"kind": "KEY_HAS_SINGLE_ROWS", "table": "c.s.visits", "column": "c.s.visits.partyID",
                  "statement": "some parties visit once", "central": True}
    a, problems = normalize(agent_ns, judge_item(red_team_category="DATA_SHAPE_ASSUMPTION_UNVERIFIABLE",
                                                 runtime_assumptions=[assumption]))
    assert problems == [] and a["runtime_assumptions"] == [assumption] and a["red_team_verdict"] == "survives"


def test_a_near_miss_verdict_below_its_scores_is_kept(agent_ns):
    a, problems = normalize(agent_ns, judge_item(verdict="NEAR_MISS"))
    assert problems == [] and a["verdict"] == "NEAR_MISS"


def test_an_outcome_with_its_label_timing_normalizes(agent_ns):
    outcome = {"column": None, "derived_from": ["c.s.t.a"], "rule": "r", "label_timing": "Future_Window"}
    a, problems = normalize(agent_ns, judge_item(outcome_definition=outcome))
    assert problems == [] and a["outcome_definition"]["label_timing"] == "future_window"


def test_the_parser_logs_why_items_were_discarded(agent_ns, caplog):
    obj = ns_inspire(agent_ns)
    raw = json.dumps([judge_item(No="U1"), judge_item(No="U2", red_team_category="OUTCOME_DERIVED_FROM_INPUTS")])
    with caplog.at_level(logging.WARNING):
        records = obj._parse_elite_judge_response(raw, [{"No": "U1"}, {"No": "U2"}])
    assert set(records) == {"U1"}
    assert "self-contradiction: red team names OUTCOME_DERIVED_FROM_INPUTS but fatal_flaws does not x1" in caplog.text


def ns_inspire(ns):
    obj = ns["DatabricksInspire"].__new__(ns["DatabricksInspire"])
    obj.logger = logging.getLogger("v120_livefix")
    return obj


def test_the_drop_reason_names_the_fatal_flaws(agent_ns):
    reason = agent_ns["DatabricksInspire"]._elite_drop_reason({
        "failed_gates": ["red_team", "judge_verdict"], "verification": {"failures": []},
        "fatal_flaws": [{"category": "NO_DECISION_CHANGED", "explanation": "The output only reports"}]})
    assert reason == ("below the Ultra High bar: red team review (red_team), judge verdict (judge_verdict); "
                      "fatal flaws: no decision changed (NO_DECISION_CHANGED): The output only reports")


# ---------------------------------------------------------------- A2 label leakage and tautology


def test_a_tier_label_computed_from_its_own_signals_is_rejected_and_not_repairable(agent_ns):
    v = verify(agent_ns, uc("Classification", "c.s.channel_lines, c.s.item_dim"), tier_classifier())
    assert v["passed"] is False and v["repairable"] is False
    assert any("predicts an outcome computed from its own signal columns in the same period" in f
               and "c.s.channel_lines.ln_net_gain" in f for f in v["failures"])


def test_a_count_label_over_a_key_that_is_also_a_signal_is_rejected(agent_ns):
    a = tier_classifier(signal_columns=["c.s.channel_lines.ln_order_number", "c.s.channel_lines.ln_ext_price"],
                        entity_key_column="c.s.party.pa_party_key",
                        join_path=["c.s.channel_lines.ln_party_key = c.s.party.pa_party_key"],
                        outcome_definition={"column": None, "derived_from": ["c.s.channel_lines.ln_order_number",
                                                                               "c.s.channel_lines.ln_party_key"],
                                            "rule": "a party with at least one event number is a buyer"},
                        value_driver="`c.s.channel_lines.ln_ext_price` per `c.s.party.pa_party_key`")
    v = verify(agent_ns, uc("Classification", "c.s.channel_lines, c.s.party"), a)
    assert v["passed"] is False
    assert any("(c.s.channel_lines.ln_order_number)" in f for f in v["failures"]), v["failures"]


def test_a_repeat_label_counted_from_the_time_column_in_the_same_window_is_rejected(agent_ns):
    a = {"decision": "Which parties get a return offer", "signal_columns": ["c.s.visits.charge", "c.s.visits.visitTime"],
         "time_column": "c.s.visits.visitTime", "entity_key_column": "c.s.visits.partyID", "join_path": [],
         "outcome_definition": {"column": None, "derived_from": ["c.s.visits.partyID", "c.s.visits.visitTime"],
                                "rule": "a party with visits on two distinct times is a repeat party"},
         "value_driver": "`c.s.visits.charge` per `c.s.visits.partyID`"}
    v = verify(agent_ns, uc("Classification", "c.s.visits"), a)
    assert any("(c.s.visits.visittime)" in f for f in v["failures"]), v["failures"]


def test_a_future_window_label_with_a_dated_time_column_is_a_real_prediction(agent_ns):
    a = {"decision": "Which parties get a return offer", "signal_columns": ["c.s.visits.charge", "c.s.visits.visitTime"],
         "time_column": "c.s.visits.visitTime", "entity_key_column": "c.s.visits.partyID", "join_path": [],
         "outcome_definition": {"column": None, "derived_from": ["c.s.visits.partyID", "c.s.visits.visitTime"],
                                "rule": "a visit within 30 days after the cutoff", "label_timing": "future_window"},
         "value_driver": "`c.s.visits.charge` per `c.s.visits.partyID`"}
    v = verify(agent_ns, uc("Classification", "c.s.visits"), a)
    assert v["passed"] is True, v["failures"]


def test_an_outcome_from_a_column_that_is_not_a_signal_passes(agent_ns):
    a = tier_classifier(outcome_definition={"column": None, "derived_from": ["c.s.channel_lines.ln_discount"],
                                            "rule": "a discount above the list threshold"})
    assert verify(agent_ns, uc("Classification", "c.s.channel_lines, c.s.item_dim"), a)["passed"] is True


def test_an_ai_function_text_classification_is_not_a_supervised_label(agent_ns):
    a = {"decision": "Which sites get coaching", "signal_columns": ["c.s.notes.note_text"], "time_column": "c.s.notes.note_time",
         "entity_key_column": "c.s.notes.siteID", "join_path": [],
         "outcome_definition": {"column": None, "derived_from": ["c.s.notes.note_text"], "rule": "ai_classify assigns a theme"},
         "value_driver": "Themes of `c.s.notes.note_text` per `c.s.notes.siteID`",
         "build_path": "An ai_classify batch job over the note text feeding a dashboard"}
    assert verify(agent_ns, uc("Classification", "c.s.notes"), a)["passed"] is True
    a_no_text = dict(a, signal_columns=["c.s.notes.siteID"], outcome_definition=None,
                     value_driver="`c.s.notes.siteID` per `c.s.notes.siteID`")
    assert any("needs a free-text column" in f for f in verify(agent_ns, uc("Classification", "c.s.notes"), a_no_text)["failures"])


# ---------------------------------------------------------------- A3 runtime assumptions and the grain rule


@pytest.mark.parametrize("table_name, column, pk, columns, expected", [
    ("c.s.visits", "visitID", (), ("visitID", "partyID"), True),
    ("c.s.order_rows", "order_row_id", (), ("order_row_id",), True),
    ("c.s.orders", "orderid", (), ("orderid",), True),
    ("c.s.date_dim", "dt_date_key", (), ("dt_date_key",), True),
    ("c.s.events", "id", (), ("id",), True),
    ("c.s.visits", "partyID", (), ("visitID", "partyID"), False),
    ("c.s.visit_lines", "visit_id", (), ("visit_id", "line_no"), False),
    ("c.s.visits", "visitID", (), ("visitID", "line_seq"), False),
    ("c.s.visits", "visitID", ("visitID", "item"), ("visitID", "item"), False),
    ("c.s.anything", "ref_code", ("ref_code",), ("ref_code",), True),
    ("c.s.channel_lines", "ln_order_number", (), ("ln_order_number",), False),
    ("c.s.order_lines", "order_id", (), ("order_id", "item_key"), False),
])
def test_own_row_key_rule(agent_ns, table_name, column, pk, columns, expected):
    assert agent_ns["_is_own_row_key"](table_name, column, pk, columns) is expected


def basket(entity_key, tables="c.s.visits", **over):
    t = tables.split(",")[0].strip()
    a = {"decision": "Which offerings to bundle", "signal_columns": [f"{t}.offering", f"{t}.units"], "time_column": None,
         "entity_key_column": entity_key, "join_path": [], "outcome_definition": None,
         "value_driver": f"Co-occurring `{t}.offering` raise `{t}.units`"}
    a.update(over)
    return a


def test_co_occurrence_on_the_tables_own_row_key_is_fatal(agent_ns):
    v = verify(agent_ns, uc("Recommendation", "c.s.visits"), basket("c.s.visits.visitID"))
    assert v["passed"] is False and v["repairable"] is False
    assert any("needs several rows per c.s.visits.visitid" in f and "row key of c.s.visits" in f for f in v["failures"])


def test_co_occurrence_on_a_line_table_passes_and_is_checked_at_run_time(agent_ns):
    v = verify(agent_ns, uc("Recommendation", "c.s.visit_lines"), basket("c.s.visit_lines.visit_id", "c.s.visit_lines"))
    assert v["passed"] is True, v["failures"]
    assert v["canonical_columns"]["runtime_assumptions"] == [{
        "kind": "KEY_HAS_REPEATED_ROWS", "table": "c.s.visit_lines", "column": "c.s.visit_lines.visit_id",
        "statement": "each visit_id value covers more than one row, so items can occur together", "central": True}]


def test_a_central_repeated_rows_assumption_on_a_row_key_is_fatal(agent_ns):
    a = basket("c.s.visits.partyID", runtime_assumptions=[{"kind": "KEY_HAS_REPEATED_ROWS", "table": "c.s.visits",
                                                           "column": "visits.visitID", "statement": "visits hold several lines",
                                                           "central": True}])
    v = verify(agent_ns, uc("Clustering", "c.s.visits"), a)
    assert any("central runtime assumption contradicted by the metadata: c.s.visits.visitid is the row key" in f
               for f in v["failures"]), v["failures"]
    assert v["repairable"] is False


def test_a_non_central_or_parent_key_assumption_is_kept_for_the_notebook(agent_ns):
    a = basket("c.s.visits.partyID", runtime_assumptions=[
        {"kind": "KEY_HAS_SINGLE_ROWS", "table": "c.s.visits", "column": "partyID", "statement": "some parties visit once",
         "central": True},
        {"kind": "KEY_HAS_REPEATED_ROWS", "table": "c.s.visits", "column": "c.s.visits.visitID",
         "statement": "nice to have", "central": False}])
    v = verify(agent_ns, uc("Clustering", "c.s.visits"), a)
    assert v["passed"] is True, v["failures"]
    assert [x["column"] for x in v["canonical_columns"]["runtime_assumptions"]] == ["c.s.visits.partyid", "c.s.visits.visitid"]


def test_an_assumption_on_a_missing_column_is_a_repairable_failure(agent_ns):
    a = basket("c.s.visits.partyID", runtime_assumptions=[{"kind": "COLUMN_HAS_VALUES", "table": "c.s.visits",
                                                           "column": "c.s.visits.ghost", "statement": "x", "central": False}])
    v = verify(agent_ns, uc("Clustering", "c.s.visits"), a)
    assert v["failures"] == ["runtime assumption column not found in the use case's tables: c.s.visits.ghost"]
    assert v["repairable"] is True


def test_the_spec_and_the_readiness_text_carry_the_runtime_assumptions(agent_ns):
    inst = build_inspire(agent_ns)
    assumption = {"kind": "COLUMN_HAS_TWO_VALUES", "table": "main.sales.orders", "column": "main.sales.orders.status",
                  "statement": "both outcomes occur", "central": True}
    spec = inst._genie_notebook_spec(genie_uc(elite_assessment={"cadence": "weekly", "runtime_assumptions": [assumption]}))
    assert spec["runtime_assumptions"] == [{key: assumption[key] for key in ("kind", "table", "column", "statement")}]
    text = inst._genie_threshold_text(spec)
    assert ("- readiness assumption: the number of distinct values of `main.sales.orders.status` in `main.sales.orders` must be at least 2; "
            "measure it on the rows its statement is about: when the statement is about order lines, transactions or events, count them "
            "in the fact table that holds them, through the join path, never in a dimension table where each key appears once; "
            "otherwise stop and say: both outcomes occur") in text
    assert text.index("readiness assumption") < text.index("- acceptance:")
    plain = inst._genie_notebook_spec(genie_uc())
    assert plain["runtime_assumptions"] == [] and "readiness assumption" not in inst._genie_threshold_text(plain)
    unknown = inst._genie_notebook_spec(genie_uc(elite_assessment={"runtime_assumptions": [dict(assumption, kind="NOT_A_RULE")]}))
    assert "readiness assumption" not in inst._genie_threshold_text(unknown)


# ---------------------------------------------------------------- A4 elite decision twins


def elite(no, title, name, tables, score, technique="Classification"):
    return {"No": no, "usecase": title, "Name": name, "Tables Involved": tables, "Analytics Technique": technique,
            "elite_status": "ELITE", "elite_score": score, "bob_score": 7.0, "Priority": 7.0}


def test_same_decision_twins_across_channel_tables_collapse_to_the_stronger(agent_ns):
    obj = ns_inspire(agent_ns)
    obj.funnel_ledger = []
    obj._deduplicate_use_cases = lambda ucs, rank=None: list(ucs)
    weak = elite("A", "Classify Offering Profitability to Improve Margins", "Classify Offerings by Profitability Tier with Pruning Actions",
                 "c.s.channel_a_lines, c.s.item_dim", 8.0)
    strong = elite("B", "Classify Offering Profitability to Improve Margins", "Classify Offerings by Profitability Health with Markdown Actions",
                   "c.s.channel_b_lines, c.s.item_dim", 8.4)
    other = elite("C", "Detect Discount Leakage to Protect Margins", "Detect Margin Erosion from Discounting with Review Queue",
                  "c.s.channel_b_lines, c.s.item_dim", 8.1, "Anomaly Detection")
    kept = obj._dedup_elite_overlap([weak, strong, other])
    assert [u["No"] for u in kept] == ["B", "C"]
    assert "elite_status" not in weak and weak["selection_drop_reason"] == (
        'same decision as the stronger elite use case "Classify Offerings by Profitability Health with Markdown Actions" '
        "(the higher elite score is kept)"), "the kept twin is named by title, which renumbering never changes"
    assert obj.funnel_ledger[-1] == {"stage": "elite_overlap", "in": 3, "out": 2, "drops": {"decision_twin": 1}}


def test_twins_by_name_collapse_and_distinct_decisions_stay(agent_ns):
    obj = ns_inspire(agent_ns)
    same_name = [elite("A", "Detect Leakage to Protect Margins", "Detect Margin Erosion from Discounting", "c.s.a", 8.0, "Anomaly Detection"),
                 elite("B", "Reveal Discount Abuse to Protect Margins", "Detect Margin Erosion from Discounting", "c.s.b", 8.3, "Anomaly Detection")]
    kept, twins = obj._collapse_elite_decision_twins(same_name)
    assert [u["No"] for u in kept] == ["B"] and [w["No"] for w in twins.values()] == ["B"]
    distinct = [elite("A", "Classify Offering Profitability to Improve Margins", "x", "c.s.a", 8.0),
                elite("B", "Classify Party Value to Grow Revenue", "y", "c.s.a", 8.0),
                elite("C", "Classify Offering Profitability to Improve Margins", "z", "c.s.a", 8.0, "Forecasting")]
    kept, twins = obj._collapse_elite_decision_twins(distinct[:2])
    assert len(kept) == 2 and twins == {}
    kept, twins = obj._collapse_elite_decision_twins(distinct)
    assert [u["No"] for u in kept] == ["A", "B"], "the same canonical title is the same decision whatever the technique"


def elite_a(no, title, domain, owner, decision, kpi, tables, score, technique="Classification"):
    return {"No": no, "usecase": title, "Name": title, "Business Domain": domain,
            "Analytics Technique": technique, "Tables Involved": tables,
            "elite_status": "ELITE", "elite_score": score, "bob_score": 7.0, "Priority": 7.0,
            "elite_assessment": {"decision_owner": owner, "decision": decision, "kpi": kpi}}


def test_same_owner_decision_different_framing_and_technique_collapse(agent_ns):
    obj = ns_inspire(agent_ns)
    a = elite_a("A", "Reduce Member Attrition to Protect Fees", "Loyalty", "Retention Lead",
                "Which high-fee members receive retention outreach each week",
                "Repeat visit rate and recovered member fees", "c.s.channel_a_lines, c.s.party", 8.6)
    b = elite_a("B", "Recover Dormant Members to Protect Fees", "Loyalty", "Retention Lead",
                "Which lapsing high-fee members enter the win-back outreach queue each cycle",
                "Recovered member fees from reactivation", "c.s.channel_a_lines, c.s.party", 8.0, "Survival Analysis")
    kept, twins = obj._collapse_elite_decision_twins([a, b])
    assert [u["No"] for u in kept] == ["A"] and [w["No"] for w in twins.values()] == ["A"]
    assert kept[0]["decision_twins_collapsed"][0]["No"] == "B"


def test_channel_split_same_owner_forecast_collapses_to_the_stronger(agent_ns):
    obj = ns_inspire(agent_ns)
    a = elite_a("A", "Forecast Channel-A Demand to Reduce Stockouts", "Inventory", "Demand Planner",
                "How much to replenish per item category ahead of forecast demand", "Stockout lost sales",
                "c.s.channel_a_lines, c.s.item_dim", 8.4, "Forecasting")
    b = elite_a("B", "Forecast Channel-B Demand to Reduce Stockouts", "Inventory", "Demand Planner",
                "How much stock of each item category to pre-position ahead of forecast demand",
                "Fill rate and lost sales", "c.s.channel_b_lines, c.s.item_dim", 8.25, "Forecasting")
    kept, twins = obj._collapse_elite_decision_twins([a, b])
    assert [u["No"] for u in kept] == ["A"] and [w["No"] for w in twins.values()] == ["A"]


def test_different_owner_channel_variants_stay_separate(agent_ns):
    obj = ns_inspire(agent_ns)
    a = elite_a("A", "Forecast Channel-A Demand to Reduce Stockouts", "Inventory", "Demand Planner",
                "How much to replenish per item category ahead of forecast demand", "Stockout lost sales",
                "c.s.channel_a_lines, c.s.item_dim", 8.4, "Forecasting")
    b = elite_a("B", "Forecast Stock Levels to Prevent Stockouts", "Inventory", "Inventory Planner",
                "When to schedule replenishment for each item from on-hand depletion", "Projected stockout days",
                "c.s.stock_snapshot, c.s.item_dim", 8.0, "Forecasting")
    kept, twins = obj._collapse_elite_decision_twins([a, b])
    assert len(kept) == 2 and twins == {}


def test_same_owner_different_action_stays_separate(agent_ns):
    obj = ns_inspire(agent_ns)
    a = elite_a("A", "Forecast Account Demand to Plan Budget", "Finance", "FP&A Lead",
                "What revenue target to set per division", "Budget variance", "c.s.channel_a_lines", 8.2, "Forecasting")
    b = elite_a("B", "Detect Account Anomalies to Protect Budget", "Finance", "FP&A Lead",
                "Which account entries to surface for review", "Recovered leakage", "c.s.channel_a_lines", 8.1,
                "Anomaly Detection")
    kept, twins = obj._collapse_elite_decision_twins([a, b])
    assert len(kept) == 2 and twins == {}


def test_same_owner_same_action_disjoint_objects_stay_separate(agent_ns):
    obj = ns_inspire(agent_ns)
    a = elite_a("A", "Reduce Machine Downtime to Cut Cost", "Operations", "Plant Manager",
                "Which machines to service first", "Unplanned downtime hours", "c.s.machine_log", 8.0)
    b = elite_a("B", "Reduce Staff Turnover to Cut Cost", "Operations", "Plant Manager",
                "Which staff to prioritise for retention", "Voluntary attrition ratio", "c.s.staff_log", 8.0)
    kept, twins = obj._collapse_elite_decision_twins([a, b])
    assert len(kept) == 2 and twins == {}


def test_same_owner_action_and_object_but_disjoint_kpi_stays_separate(agent_ns):
    obj = ns_inspire(agent_ns)
    a = elite_a("A", "Grow Member Fees via Premium Tiering", "Loyalty", "Growth Lead",
                "Which members to enrol in the premium tier", "Average member fee uplift", "c.s.party_core", 8.0)
    b = elite_a("B", "Lift Member Worth via Self-Service Routing", "Loyalty", "Growth Lead",
                "Which members to enrol in self-service", "Contact centre handle minutes", "c.s.party_web", 8.0)
    kept, twins = obj._collapse_elite_decision_twins([a, b])
    assert len(kept) == 2 and twins == {}


# ---------------------------------------------------------------- B5 time via join


def forecast(time_column, **over):
    a = {"decision": "How many units to plan per item each week", "signal_columns": ["c.s.channel_lines.ln_quantity"],
         "time_column": time_column, "entity_key_column": "c.s.item_dim.it_item_key",
         "join_path": ["c.s.channel_lines.ln_item_key = c.s.item_dim.it_item_key"], "outcome_definition": None,
         "value_driver": "Weekly `c.s.channel_lines.ln_quantity` per `c.s.item_dim.it_item_key`"}
    a.update(over)
    return a


def test_a_date_key_joined_to_a_dated_table_is_time_via_join(agent_ns):
    v = verify(agent_ns, uc("Forecasting", "c.s.channel_lines, c.s.item_dim"), forecast("c.s.channel_lines.ln_sold_date_key"))
    assert v["passed"] is True, v["failures"]
    assert v["time_via_join"] == {"key": "c.s.channel_lines.ln_sold_date_key", "table": "c.s.date_dim",
                                  "column": "c.s.date_dim.dt_date", "join": "c.s.channel_lines.ln_sold_date_key = c.s.date_dim.dt_date_key"}
    assert v["canonical_columns"]["time_via_join"] == v["time_via_join"]


def test_the_dated_tables_date_column_is_accepted_only_with_one_linking_key(agent_ns):
    evidence = copy.deepcopy(EVIDENCE)
    evidence["c.s.channel_lines"]["foreign_keys"] = [fk for fk in evidence["c.s.channel_lines"]["foreign_keys"]
                                                    if fk["column"] != "ln_ship_date_key"]
    v = verify(agent_ns, uc("Trend Analysis", "c.s.channel_lines, c.s.item_dim"), forecast("c.s.date_dim.dt_date"), evidence)
    assert v["passed"] is True and v["time_via_join"]["key"] == "c.s.channel_lines.ln_sold_date_key"
    v2 = verify(agent_ns, uc("Trend Analysis", "c.s.channel_lines, c.s.item_dim"), forecast("c.s.date_dim.dt_date"))
    assert any("joins the use case's tables through 2 date keys" in f for f in v2["failures"])


def test_an_integer_time_column_without_a_dated_join_is_still_rejected(agent_ns):
    evidence = copy.deepcopy(EVIDENCE)
    evidence["c.s.channel_lines"]["foreign_keys"] = []
    v = verify(agent_ns, uc("Forecasting", "c.s.channel_lines, c.s.item_dim"), forecast("c.s.channel_lines.ln_sold_date_key"), evidence)
    assert "time column c.s.channel_lines.ln_sold_date_key is INT, not DATE or TIMESTAMP" in v["failures"]


def test_the_judge_evidence_lists_date_keys_and_loads_joined_tables(agent_ns):
    obj = ns_inspire(agent_ns)
    text = obj._elite_evidence_summary(uc("Forecasting", "c.s.channel_lines"), copy.deepcopy(EVIDENCE))
    assert ("date keys joined to a dated table: `ln_ship_date_key` -> `c.s.date_dim.dt_date`, "
            "`ln_sold_date_key` -> `c.s.date_dim.dt_date`") in text

    class Loader:
        def __init__(self):
            self.requests = []

        def get_metadata_evidence(self, tables):
            self.requests.append(sorted(tables))
            return {t: copy.deepcopy(EVIDENCE[t]) for t in tables if t in EVIDENCE}

    obj.data_loader = Loader()
    evidence = obj._load_elite_evidence([uc("Forecasting", "c.s.channel_lines")])
    assert obj.data_loader.requests == [["c.s.channel_lines"], ["c.s.date_dim", "c.s.item_dim", "c.s.party"]]
    assert set(evidence) == {"c.s.channel_lines", "c.s.date_dim", "c.s.item_dim", "c.s.party"}


def test_dimension_affixed_tables_are_foreign_key_targets(agent_ns):
    loader = agent_ns["DataLoader"].__new__(agent_ns["DataLoader"])
    loader.logger = logging.getLogger("v120_livefix")
    loader.primary_keys = {}
    rows = [("c", "s", "channel_lines", "ln_sold_date_key", "INT", ""), ("c", "s", "channel_lines", "ln_sold_time_key", "INT", ""),
            ("c", "s", "date_dim", "dt_date_key", "INT", ""), ("c", "s", "date_dim", "dt_date", "DATE", ""),
            ("c", "s", "dim_time", "tm_time_key", "INT", "")]
    inferred = {rel[3]: (rel[6], rel[7]) for scored in loader._infer_foreign_keys(rows).values() for rel, _c in scored}
    assert inferred == {"ln_sold_date_key": ("date_dim", "dt_date_key"), "ln_sold_time_key": ("dim_time", "tm_time_key")}
    forms = agent_ns["DataLoader"]._table_name_forms
    assert forms("date_dim") == {"date_dim", "date"} and forms("dim_parties") == {"dim_parties", "dim_party", "parties", "party"}
    assert forms("orders") == {"orders", "order"}
    assert forms("dim_parties", strip_affixes=False) == {"dim_parties", "dim_party"}


def test_role_words_ending_in_ed_or_ing_are_stripped_but_compound_entity_names_are_not(agent_ns):
    loader = agent_ns["DataLoader"].__new__(agent_ns["DataLoader"])
    loader.logger = logging.getLogger("v120_livefix")
    loader.primary_keys = {}
    rows = [("c", "s", "web_returns", "wr_returned_date_sk", "INT", ""), ("c", "s", "web_returns", "wr_item_sk", "INT", ""),
            ("c", "s", "catalog_returns", "cr_returning_customer_sk", "INT", ""),
            ("c", "s", "catalog_returns", "cr_refunded_customer_sk", "INT", ""),
            ("c", "s", "web_sales", "ws_sold_date_sk", "INT", ""), ("c", "s", "order_lines", "order_item_id", "INT", ""),
            ("c", "s", "date_dim", "d_date_sk", "INT", ""), ("c", "s", "date_dim", "d_date", "DATE", ""),
            ("c", "s", "customer", "c_customer_sk", "INT", ""), ("c", "s", "item", "i_item_sk", "INT", ""),
            ("c", "s", "item", "item_id", "INT", "")]
    inferred = {(rel[2], rel[3]): (rel[6], rel[7]) for scored in loader._infer_foreign_keys(rows).values() for rel, _c in scored}
    assert inferred[("web_returns", "wr_returned_date_sk")] == ("date_dim", "d_date_sk")
    assert inferred[("catalog_returns", "cr_returning_customer_sk")] == ("customer", "c_customer_sk")
    assert inferred[("catalog_returns", "cr_refunded_customer_sk")] == ("customer", "c_customer_sk")
    assert inferred[("web_sales", "ws_sold_date_sk")] == ("date_dim", "d_date_sk")
    assert inferred[("web_returns", "wr_item_sk")] == ("item", "i_item_sk")
    assert ("order_lines", "order_item_id") not in inferred, "a compound entity name is not a role word, so item is never assumed"


def test_an_exact_table_name_outranks_its_dimension_twin(agent_ns):
    loader = agent_ns["DataLoader"].__new__(agent_ns["DataLoader"])
    loader.logger = logging.getLogger("v120_livefix")
    loader.primary_keys = {}
    rows = [("c", "s", "visits", "party_id", "INT", ""), ("c", "s", "visits", "visit_date_key", "INT", ""),
            ("c", "s", "party", "party_id", "INT", ""), ("c", "s", "dim_party", "party_id", "INT", ""),
            ("c", "s", "dim_visit_date", "visit_date_key", "INT", "")]
    inferred = {(rel[2], rel[3]): (rel[6], rel[7]) for scored in loader._infer_foreign_keys(rows).values()
                for rel, _c in scored}
    assert inferred == {("visits", "party_id"): ("party", "party_id"),
                        ("dim_party", "party_id"): ("party", "party_id"),
                        ("visits", "visit_date_key"): ("dim_visit_date", "visit_date_key")}


def test_time_via_join_reaches_the_prompt_time_column_and_join_path(agent_ns):
    inst = build_inspire(agent_ns)
    via = {"key": "main.sales.orders.order_date_key", "table": "main.sales.date_dim", "column": "main.sales.date_dim.cal_date",
           "join": "main.sales.orders.order_date_key = main.sales.date_dim.date_key"}

    def decision(**assessment):
        return {key: text for key, _label, text in inst._genie_decision_contract(genie_uc(elite_assessment=assessment))}

    joined = decision(cadence="weekly", time_via_join=via, join_path=["main.sales.orders.customer_id = main.sales.customers.customer_id"])
    assert joined["time_column"] == ("main.sales.date_dim.cal_date (reached through main.sales.date_dim along "
                                     "main.sales.orders.order_date_key = main.sales.date_dim.date_key)")
    assert joined["join_path"] == "main.sales.orders.customer_id = main.sales.customers.customer_id -> " + via["join"]
    assert decision(time_via_join=via)["join_path"] == via["join"]
    assert decision(time_via_join=via, join_path=[via["join"]])["join_path"] == via["join"]
    plain = decision(cadence="weekly")
    assert plain["time_column"] == inst._GENIE_NOT_ASSESSED and plain["join_path"] == inst._GENIE_NOT_ASSESSED


# ---------------------------------------------------------------- B6 one key-name rule and natural keys


@pytest.mark.parametrize("name", ["ln_order_number", "ticket_no", "order_num", "region_code", "item_key", "item_sk", "party_id",
                                  "OrderNumber", "partyID", "visitid", "parent_ref", "id", "fk_party", "invoicenumber"])
def test_identifier_like_names_are_keys(agent_ns, name):
    assert agent_ns["_is_key_like_column"](name) is True


@pytest.mark.parametrize("name", ["amount", "quantity", "total_price", "paid", "valid", "units", "net_gain", "number_of_units", ""])
def test_measures_are_not_keys(agent_ns, name):
    assert agent_ns["_is_key_like_column"](name) is False


def test_there_is_one_key_vocabulary(agent_ns):
    cls = agent_ns["DatabricksInspire"]
    assert not hasattr(cls, "_JOIN_ID_SUFFIXES") and not hasattr(cls, "_JOIN_ID_GENERIC")
    assert cls._is_join_identifier("ln_order_number") and cls._is_join_identifier("partyid")
    assert not cls._is_join_identifier("id") and not cls._is_join_identifier("number")
    assert cls._column_signals({"ln_order_number": "BIGINT", "units": "BIGINT"})["id_cols"] == ["ln_order_number"]


def number_key(technique="Anomaly Detection", **over):
    a = {"decision": "Which events to review", "signal_columns": ["c.s.channel_lines.ln_discount", "c.s.channel_lines.ln_net_gain"],
         "time_column": None, "entity_key_column": "c.s.channel_lines.ln_order_number", "join_path": [], "outcome_definition": None,
         "value_driver": "`c.s.channel_lines.ln_discount` against `c.s.channel_lines.ln_net_gain`"}
    a.update(over)
    return a


def test_an_event_number_key_is_an_entity_key(agent_ns):
    v = verify(agent_ns, uc("Anomaly Detection", "c.s.channel_lines"), number_key())
    assert v["passed"] is True and v["entity_key_basis"] == "key"


def test_a_natural_key_named_by_the_decision_is_an_entity_key(agent_ns):
    a = {"decision": "How many units of each offering to prepare per site each day",
         "signal_columns": ["c.s.visits.units", "c.s.visits.visitTime"], "time_column": "c.s.visits.visitTime",
         "entity_key_column": "c.s.visits.offering", "join_path": [], "outcome_definition": None,
         "value_driver": "Daily `c.s.visits.units` per `c.s.visits.offering`"}
    v = verify(agent_ns, uc("Forecasting", "c.s.visits"), a)
    assert v["passed"] is True and v["entity_key_basis"] == "natural key named by the decision"
    other = dict(a, decision="How many units to prepare per site each day")
    assert any("is not a primary, foreign or key-like column" in f for f in verify(agent_ns, uc("Forecasting", "c.s.visits"), other)["failures"])
    text_key = dict(a, entity_key_column="c.s.notes.note_text", decision="Which note text to answer")
    assert agent_ns["DatabricksInspire"]._is_natural_entity_key("note_text", "STRING", text_key["decision"]) is False
    assert agent_ns["DatabricksInspire"]._is_natural_entity_key("units", "BIGINT", "units per offering") is False


# ---------------------------------------------------------------- C7 temperature on the notebook AI endpoint


class TemperatureSpark:
    def __init__(self, rejects=True):
        self.rejects = rejects
        self.statements = []
        self.staging_error = None

    def sql(self, text, args=None):
        self.statements.append(text)
        rejected = self.rejects and "'temperature'" in text
        error = "The model does not support the parameter(s): temperature. Please remove and retry." if rejected else None
        field = types.SimpleNamespace(dataType=types.SimpleNamespace(fieldNames=lambda: ["result", "errorMessage"]))
        if text.startswith("SELECT entity_id, segment_or_item, ai_query("):
            return types.SimpleNamespace(schema={"ai_response": field})
        if text.startswith("CREATE OR REPLACE TABLE") and "ai_query(" in text:
            self.staging_error = error
            return types.SimpleNamespace(collect=lambda: [])
        if text.startswith("SELECT FIRST(error, true)"):
            return types.SimpleNamespace(collect=lambda: [{"error": self.staging_error}] if self.staging_error else [])
        if text.startswith("SELECT COUNT(*) AS n"):
            errors = 3 if self.staging_error else 0
            return types.SimpleNamespace(collect=lambda: [{"n": 3, "errors": errors}])
        if text.startswith("SELECT ai_query("):
            return types.SimpleNamespace(schema={"r": field}, selectExpr=lambda *cols: types.SimpleNamespace(
                collect=lambda: [{"text": None if rejected else "A briefing.", "error": error}]))
        if "GROUP BY priority_tier" in text:
            return types.SimpleNamespace(collect=lambda: [{"priority_tier": "Act now", "n": 3}])
        return types.SimpleNamespace(collect=lambda: [])


def harness_ctx(ns, endpoint, unsupported=()):
    spec = build_inspire(ns)._genie_notebook_spec(genie_uc(**{"Analytics Technique": "Classification"}))
    spec["ai_endpoints_without_temperature"] = list(unsupported)
    values = {w[1]: w[2] for w in spec["widgets"]}
    values["ai_endpoint"] = endpoint
    return ns["build_run_context"](spec, values)


def test_the_agent_and_the_harness_share_one_temperature_rejection_rule(agent_ns):
    text = "The model does not support the parameter(s): temperature. Please remove and retry."
    assert agent_ns["inspire_temperature_rejected"](text) is True
    assert agent_ns["_classify_runtime_error"](Exception(text)) == "temperature_unsupported"
    assert agent_ns["inspire_temperature_rejected"]("The model does not support the parameter(s): top_k") is False


# ---------------------------------------------------------------- C8 execution family from the build path


@pytest.mark.parametrize("technique, build, signals, family", [
    ("Classification", "An ai_classify batch job over the note text feeding a dashboard", [], "G"),
    ("Classification", "ai_extract pulls the complaint fields from each note", [], "G"),
    ("Clustering", "ai_query with a JSON schema groups each note into a theme", ["c.s.notes.note_text"], "G"),
    ("Classification", "An XGBoost classifier tracked in MLflow, then ai_classify labels", [], "A"),
    ("Classification", "A Random Forest classifier scores parties, then ai_query writes the offer", ["c.s.notes.note_text"], "A"),
    ("Classification", "ai_query summarizes the scored parties", ["c.s.visits.charge"], "A"),
    ("Trend Analysis", "ai_analyze_sentiment per note, then a weekly trend test", [], "F"),
    ("Anomaly Detection", "An Isolation Forest in MLflow", [], "B"),
])
def test_execution_family_follows_the_build_path(agent_ns, technique, build, signals, family):
    obj = ns_inspire(agent_ns)
    case = uc(technique, "c.s.notes", elite_assessment={"build_path": build, "signal_columns": signals})
    assert obj._uc_execution_family(case) == family


def test_a_non_elite_solution_naming_an_ai_function_runs_as_text(agent_ns):
    obj = ns_inspire(agent_ns)
    assert obj._uc_execution_family(uc("Classification", "c.s.notes", Solution="Genie Code applies ai_classify to each note")) == "G"
    assert obj._uc_execution_family(uc("Classification", "c.s.notes", Solution="Genie Code trains a classifier")) == "A"


def test_the_genie_notebook_and_guidance_follow_the_ai_text_family(agent_ns):
    inst = build_inspire(agent_ns)
    case = genie_uc(**{"Analytics Technique": "Classification"},
                    elite_assessment={"cadence": "weekly", "build_path": "An ai_classify job over the order notes"})
    assert inst._genie_notebook_spec(case)["family"] == "G"
    assert inst._uc_guidance_technique(case) == "Document Processing"
    assert "ai_classify" in agent_ns["TECHNIQUE_IMPLEMENTATION_GUIDANCE"]["Document Processing"]
    plain = genie_uc(**{"Analytics Technique": "Classification"}, elite_assessment={"build_path": "A classifier in MLflow"})
    assert inst._genie_notebook_spec(plain)["family"] == "A" and inst._uc_guidance_technique(plain) == "Classification"


# ---------------------------------------------------------------- D9 clustering the final elite set


def test_the_final_elite_set_is_clustered_without_small_domain_merging(agent_ns):
    obj = ns_inspire(agent_ns)
    obj.user_business_domains = []
    obj.funnel_ledger = []
    calls = []

    def cluster(ucs, language, merge_small_domains=True):
        calls.append(([u["No"] for u in ucs], merge_small_domains))
        return [dict(u, **{"Business Domain": "Pricing" if u["No"] != "N9" else "Service"}) for u in ucs]

    obj._cluster_domains_and_subdomains = cluster
    obj.elite_near_miss_ucs = [{"No": "N9", "Name": "near"}, {"No": "E1", "Name": "elite"}]
    obj.elite_near_miss = [{"No": "N9", "Business Domain": ""}]
    out = obj._cluster_elite_final_set([{"No": "E1", "Name": "elite"}])
    assert calls == [(["E1", "N9"], False)]
    assert [u["No"] for u in out] == ["E1"] and out[0]["Business Domain"] == "Pricing"
    assert obj.elite_near_miss == [{"No": "N9", "Business Domain": "Service"}]


def test_merge_small_domains_flag_skips_the_merge_step(agent_ns):
    obj = make_inspire(agent_ns)
    obj.user_business_domains = []
    obj.max_retry_attempts = 2
    merged = []
    obj._merge_small_domains = lambda ucs: merged.append(len(ucs)) or ucs
    obj._split_mega_domains = lambda ucs: ucs
    obj._detect_subdomains_all_domains = lambda ucs, language, path: ucs
    obj._merge_duplicate_subdomains = lambda ucs: ucs
    obj._rename_placeholder_domains_from_subdomains = lambda ucs: ucs
    obj._llm_cost_mark = lambda: 0
    obj._llm_cost_add = lambda cost, key, mark: 0
    obj._report_clustering_cost = lambda cost: None
    obj._domain_finder_vars = lambda csv_text, language: {}
    obj._prompt_overhead_chars = lambda name, template=None: 100
    calls = []

    def responder(prompt_name, prompt_vars, skip_cache):
        calls.append(prompt_name)
        return "use_case_id,domain,honesty_score,honesty_justification\nU1,Pricing,90,ok\nU2,Service,90,ok"

    obj.ai_agent.responder = responder
    ucs = [{"No": "U1", "Name": "a"}, {"No": "U2", "Name": "b"}]
    obj._cluster_domains_and_subdomains(ucs, "English", merge_small_domains=False)
    assert merged == [] and calls == ["DOMAIN_FINDER_PROMPT"], "two use cases in two domains need no retry and no merge"
    obj._cluster_domains_and_subdomains(ucs, "English")
    assert merged == [2]


# ---------------------------------------------------------------- D10 the generation CSV parser


SELF_CORRECTED = "\n".join([
    HEADER,
    _gen_row("1", "c.s.orders"), _gen_row("2", "c.s.orders"), _gen_row("3", "c.s.orders"),
    '"60","honesty_score duplicate guard not needed","placeholder","AI","Anomaly Detection","s","sol","v","b","sp","c.s.orders","h"',
    "I need to correct my output. The last row was an error. Here is the clean CSV:",
    HEADER,
    _gen_row("1", "c.s.orders"), _gen_row("2", "c.s.orders"), _gen_row("3", "c.s.orders"),
])


def test_a_self_corrected_response_yields_each_use_case_once(agent_ns, caplog):
    obj = make_inspire(agent_ns)
    with caplog.at_level(logging.INFO):
        rows = obj._parse_llm_csv_response(SELF_CORRECTED, "[Batch P2_1]")
    assert [r["No"] for r in rows] == ["1", "2", "3"]
    assert "Dropped 6 non-use-case rows: duplicate_id=3, meta_row=1, non_data_row=1, repeated_header=1" in caplog.text


def test_legitimate_rows_with_hyphenated_ids_are_kept(agent_ns):
    obj = make_inspire(agent_ns)
    rows = obj._parse_llm_csv_response("\n".join([HEADER, _gen_row("N01-U03", "c.s.orders"), _gen_row("AI-P1_2-U4", "c.s.orders"),
                                                  _gen_row("#5", "c.s.orders"), _gen_row("6.", "c.s.orders")]), "[t]")
    assert [r["No"] for r in rows] == ["N01-U03", "AI-P1_2-U4", "#5", "6."]


def test_batch_renumbering_never_creates_a_shared_id(agent_ns):
    obj = _gen_harness(agent_ns, [HEADER + "\n" + _gen_row("A-1", "c.s.orders") + "\n" + _gen_row("B-1", "c.s.orders")])
    out = obj._process_batch_with_retry([("c", "s", "orders", "id", "bigint", "")], 1, max_attempts=1)
    assert [r["No"] for r in out] == ["AI-01-U1", "AI-01-U1_2"]


def test_dedup_reports_the_real_reduction(agent_ns, caplog):
    obj = make_inspire(agent_ns)
    ucs = [{"No": "U1"}, {"No": "U1"}, {"No": "U2"}, {"No": "U3"}]
    with caplog.at_level(logging.INFO):
        kept = obj._parse_dedup_response("use_case_id,honesty_score,honesty_justification\nU1,90,k\nU2,90,k", ucs, "Global Deduplication")
    assert len(kept) == 3
    assert "Retained 3 use cases, removed 1 (25.0%)" in caplog.text
    assert "1 use case shares an id with another reviewed use case" in caplog.text


# ---------------------------------------------------------------- D11 the pipelined split retry


def scorer_inspire(ns, floor=None):
    obj = make_inspire(ns)
    if floor is not None:
        obj._STRAGGLER_FLOOR_SECONDS = floor
    return obj


def ucs_n(n):
    return [{"No": f"U{i}"} for i in range(n)]


def test_a_failed_batch_is_retried_before_a_slow_batch_finishes(agent_ns):
    obj = scorer_inspire(agent_ns)
    events = []

    def score(label, batch, skip_cache):
        ids = [u["No"] for u in batch]
        events.append((time.time(), label, tuple(ids), skip_cache))
        if "U0" in ids and not skip_cache:
            time.sleep(0.6)
        if "U2" in ids and not skip_cache:
            return {}
        return {i: {"ok": True} for i in ids}

    start = time.time()
    scores, unscored = obj._score_with_split_retry(ucs_n(4), score, 2, "Test", per_task_timeout=30)
    elapsed = time.time() - start
    assert set(scores) == {"U0", "U1", "U2", "U3"} and unscored == {}
    retry = [e for e in events if e[3]]
    assert retry and retry[0][2] == ("U2", "U3") and retry[0][0] - start < 0.5, "the retry starts while the slow batch runs"
    assert elapsed < 1.0, elapsed


def test_a_straggler_is_cancelled_and_retried_without_holding_the_stage(agent_ns):
    obj = scorer_inspire(agent_ns, floor=0.2)
    seen_cancel = threading.Event()

    def score(label, batch, skip_cache):
        ids = [u["No"] for u in batch]
        if "U8" in ids and not skip_cache:
            while not agent_ns["_is_thread_cancelled"]():
                time.sleep(0.01)
            seen_cancel.set()
            raise RuntimeError("cancelled")
        time.sleep(0.02)
        return {i: {"ok": True} for i in ids}

    start = time.time()
    scores, unscored = obj._score_with_split_retry(ucs_n(10), score, 2, "Test", per_task_timeout=30)
    assert set(scores) == {f"U{i}" for i in range(10)} and unscored == {}
    assert time.time() - start < 3.0
    assert seen_cancel.wait(2), "the straggler's own work is told to stop"


def test_a_retry_that_recovers_nothing_is_not_retried_again_and_scores_are_never_overwritten(agent_ns):
    obj = scorer_inspire(agent_ns)
    calls = []

    def score(label, batch, skip_cache):
        ids = [u["No"] for u in batch]
        calls.append((ids, skip_cache))
        if not skip_cache:
            return {"U0": {"first": True}, "U1": {"first": True}}
        return {"U0": {"second": True}}

    scores, unscored = obj._score_with_split_retry(ucs_n(4), score, 4, "Test", per_task_timeout=30)
    assert scores == {"U0": {"first": True}, "U1": {"first": True}}
    assert set(unscored) == {"U2", "U3"}
    assert calls[0] == (["U0", "U1", "U2", "U3"], False)
    assert sorted(c[0] for c in calls[1:]) == [["U2", "U3"]] and all(c[1] for c in calls[1:])


def test_a_per_task_timeout_retries_the_batch_individually(agent_ns):
    obj = scorer_inspire(agent_ns)

    def score(label, batch, skip_cache):
        if not skip_cache:
            while not agent_ns["_is_thread_cancelled"]():
                time.sleep(0.01)
            raise RuntimeError("cancelled")
        return {u["No"]: {"ok": True} for u in batch}

    start = time.time()
    scores, unscored = obj._score_with_split_retry(ucs_n(2), score, 2, "Test", per_task_timeout=0.3)
    assert set(scores) == {"U0", "U1"} and unscored == {} and time.time() - start < 2.0


# ---------------------------------------------------------------- D12 funnel ledger drop reasons


def test_gate_ledger_drops_name_every_gate_that_dropped(agent_ns):
    obj = make_inspire(agent_ns)
    obj.processing_honesty = {"gate_ledger": {
        "G2_schema_completeness": {"dropped": 0}, "G2_name_uniqueness": {"dropped": 3},
        "Q1": {"dropped": 1}, "Q2": {"dropped": 0}, "Q5": {"dropped": 2}}}
    assert obj._gate_ledger_drops("G") == {"G2_name_uniqueness": 3}
    assert obj._gate_ledger_drops("Q") == {"Q1": 1, "Q5": 2}


GOOD = {"Medium", "High", "Very High", "Ultra High"}


def test_the_run_ledger_names_dedup_and_gate_drops(agent_ns, tmp_path, quiet_root_logger):
    obj = _build(agent_ns, tmp_path, "Good", GOOD, combined_scorer)
    obj._deduplicate_use_cases = lambda ucs, **kw: ucs[1:]
    real_gates = obj._phaseG_run_quality_gates

    def gates(ucs, schema):
        out = real_gates(ucs, schema)
        obj._record_gate_ledger("G2_name_uniqueness", len(out), len(out) - 1)
        return out[1:]

    obj._phaseG_run_quality_gates = gates
    obj.run()
    ledger = {e["stage"]: e for e in obj.final_inspire_results_json["funnel_ledger"]}
    assert ledger["llm_dedup"]["drops"] == {"llm_duplicate": 1}
    assert ledger["llm_dedup"]["in"] - ledger["llm_dedup"]["out"] == 1
    assert ledger["phase_g_gates"]["drops"] == {"G2_name_uniqueness": 1}
    assert sum(ledger["phase_g_gates"]["drops"].values()) == ledger["phase_g_gates"]["in"] - ledger["phase_g_gates"]["out"]


# ---------------------------------------------------------------- D13 Pass 2 seeds and empty answers


def test_pass_2_seeds_only_tables_that_record_events(agent_ns, tmp_path, quiet_root_logger):
    obj = _build(agent_ns, tmp_path, "Good", GOOD, combined_scorer)
    original_filter, original_generate = obj._filter_business_tables, obj._process_batch_with_retry
    batches = []

    def filter_tables(cols, **kw):
        result = list(original_filter(cols, **kw))
        result[5] = {t: ("MASTER" if t.endswith(".stores") else "TRANSACTIONAL") for t in result[5]}
        obj.table_classification_status = {t: ("unverified" if t.endswith(".items") else "verified") for t in result[5]}
        result[5]["cat.sch.items"] = "MASTER"
        return tuple(result)

    def generate(column_details, batch_id, **kw):
        batches.append((str(batch_id), column_details[0][2]))
        return original_generate(column_details, batch_id, **kw)

    obj._filter_business_tables = filter_tables
    obj._process_batch_with_retry = generate
    obj.run()
    assert sorted(t for b, t in batches if b.startswith("P1_")) == ["items", "orders", "stores"]
    assert sorted(t for b, t in batches if b.startswith("P2_")) == ["items", "orders"], \
        "a verified master table seeds no Pass 2 batch; an unverified one keeps its seed"


def test_an_empty_answer_is_a_warning_not_a_hallucination_error(agent_ns, caplog):
    decline = HEADER + '\n"No valid use cases can be generated: the only table is static","","","","","","","","","","",""'
    obj = _gen_harness(agent_ns, [decline, decline])
    with caplog.at_level(logging.INFO):
        out = obj._process_batch_with_retry([("c", "s", "orders", "id", "bigint", "")], 1, max_attempts=2)
    assert out == []
    assert "hallucinated tables" not in caplog.text
    assert not [r for r in caplog.records if r.levelno >= logging.ERROR]
    assert "The model returned no use case for this batch in 2 attempts" in caplog.text
    assert [c["skip_cache"] for c in obj.ai_agent.calls] == [False, True]


# ---------------------------------------------------------------- D14 the log duplicate filter


def test_identical_lines_from_parallel_workers_are_all_logged(agent_ns):
    flt = agent_ns["DuplicateMessageFilter"](window_seconds=60)
    results = []

    def emit():
        results.append(flt.filter(logging.LogRecord("n", logging.INFO, __file__, 1, "Parsed combined scores for 30/30 use cases",
                                                    None, None)))

    workers = [threading.Thread(target=emit) for _ in range(2)]
    for w in workers:
        w.start()
    for w in workers:
        w.join()
    assert results == [True, True]
    same_thread = agent_ns["DuplicateMessageFilter"](window_seconds=60)
    record = logging.LogRecord("n", logging.INFO, __file__, 1, "repeat", None, None)
    assert same_thread.filter(record) is True and same_thread.filter(
        logging.LogRecord("n", logging.INFO, __file__, 1, "repeat", None, None)) is False


# ---------------------------------------------------------------- D15 customer-visible em dashes


LOG_CALLS = {"log_print", "print", "debug", "info", "warning", "error", "critical", "exception"}


def _runtime_text_constants(node):
    import ast
    docstring = node.body[0].value if node.body and isinstance(node.body[0], ast.Expr) else None
    parents = {child: parent for parent in ast.walk(node) for child in ast.iter_child_nodes(parent)}

    def in_log_call(n):
        while n in parents:
            n = parents[n]
            if isinstance(n, ast.Call):
                func = n.func
                name = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", "")
                if name in LOG_CALLS:
                    return True
        return False

    return [n.value for n in ast.walk(node) if isinstance(n, ast.Constant) and isinstance(n.value, str)
            and n is not docstring and not in_log_call(n)]


def test_customer_visible_runtime_text_has_no_em_dash():
    for name in ("_assemble_skeleton_notebook", "finalize_atomic_writer", "_run_generate_mode"):
        offenders = [c for c in _runtime_text_constants(method_node("DatabricksInspire", name)) if EM in c]
        assert offenders == [], (name, offenders)


def test_the_failed_run_closes_open_steps_with_a_plain_message(agent_ns):
    obj = ns_inspire(agent_ns)
    steps = []

    class Writer:
        def emit_step(self, **kw):
            steps.append(kw)
            return len(steps)

        def flush_pending(self, **kw):
            return None

        def finalize_session(self, **kw):
            return None

    obj.atomic_writer = Writer()
    obj._pipeline_start_step_id = 1
    obj._open_pipeline_step_ids = {"S|T|U": (7, "S", "T", "U")}
    obj._merge_run_outcome_into_results = lambda: {}
    obj._emit_pipeline_status = lambda **kw: steps.append(kw) or len(steps)
    try:
        obj.finalize_atomic_writer(success=False)
    except Exception:
        pass
    assert any(s.get("message") == "Pipeline failed: closing open step" for s in steps)
    assert not any(EM in str(s.get("message")) for s in steps)
