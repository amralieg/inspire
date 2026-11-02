"""v1.3.0: a key column is never a free-text column.

`_column_signals` decides which columns are free text for the AI text detection, the execution family, the
elite verification and the Q3 relevance gate. A text word inside a key name (`rt_reason_sk`, `reason_code`,
`review_id`) made a numeric use case that only asks ai_query to annotate its result look like AI text processing,
so the elite verification then rejected it for citing no free-text column. Each case has a must-exclude and a
must-keep side (CLAUDE.md 8.3).
"""
import copy
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def col(name, dtype):
    return {"name": name, "type": dtype, "comment": "", "nullable": True, "tags": {}}


def table(columns, pk=()):
    return {"comment": "", "table_type": "MANAGED", "tags": {}, "last_altered": None,
            "columns": {c["name"].lower(): c for c in columns}, "primary_key": list(pk), "foreign_keys": []}


EVIDENCE = {
    "c.s.returns": table([col("rt_item_sk", "INT"), col("rt_reason_sk", "INT"), col("rt_returned_date", "DATE"),
                          col("rt_return_quantity", "INT"), col("rt_net_loss", "DECIMAL(7,2)")]),
    "c.s.reviews": table([col("rv_review_id", "BIGINT"), col("rv_item_sk", "INT"), col("rv_review_text", "STRING"),
                          col("rv_review_date", "DATE")]),
}
ANNOTATED_TREND = {
    "decision": "Which item classes get a returns review this month",
    "signal_columns": ["c.s.returns.rt_return_quantity", "c.s.returns.rt_reason_sk", "c.s.returns.rt_net_loss"],
    "time_column": "c.s.returns.rt_returned_date", "entity_key_column": "c.s.returns.rt_item_sk", "join_path": [],
    "outcome_definition": None,
    "value_driver": "A rising `c.s.returns.rt_net_loss` share per `c.s.returns.rt_item_sk` sends the item to review",
    "build_path": ("A scheduled SQL and Python job computing monthly reason-share series per item, running a change-point "
                   "test, writing an alert queue that ai_query annotates"),
}


def inspire(ns):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = logging.getLogger("v130_text_keys")
    obj._find_join_path = lambda tables: {"connected": True, "path": [], "strength": "inferred"}
    return obj


def uc(technique, tables, **extra):
    out = {"No": "U1", "Name": "A use case", "usecase": "Act on the decision", "Analytics Technique": technique,
           "Tables Involved": tables, "Solution": "sol", "High Level Design": "hld"}
    out.update(extra)
    return out


def test_a_key_column_is_never_a_free_text_column(agent_ns):
    signals = agent_ns["DatabricksInspire"]._column_signals
    untyped = {"rt_reason_sk": "", "review_id": "", "reason_code": "", "rs_reason_desc": "", "rv_review_text": ""}
    assert signals(untyped)["text_cols"] == ["rs_reason_desc", "rv_review_text"]
    typed = {"rt_reason_sk": "INT", "reason_code": "STRING", "note_id": "STRING", "comment_count": "INT", "rv_review_text": "STRING"}
    assert signals(typed)["text_cols"] == ["rv_review_text"]


def test_ai_query_that_annotates_a_numeric_result_is_not_ai_text_processing(agent_ns):
    obj = inspire(agent_ns)
    assert obj._uc_ai_text_function(uc("Trend Analysis", "c.s.returns"), ANNOTATED_TREND) is None
    on_text = dict(ANNOTATED_TREND, signal_columns=["c.s.reviews.rv_review_text", "c.s.reviews.rv_item_sk"],
                   build_path="A weekly job where ai_query groups each review into a complaint theme")
    assert obj._uc_ai_text_function(uc("Trend Analysis", "c.s.reviews"), on_text) == "ai_query"


def test_a_model_use_case_citing_a_reason_key_keeps_its_model_family(agent_ns):
    obj = inspire(agent_ns)
    keyed = uc("Classification", "c.s.returns", elite_assessment={
        "build_path": "Scores each open return and ai_query writes the outreach note for the top returns",
        "signal_columns": ["c.s.returns.rt_reason_sk", "c.s.returns.rt_net_loss"]})
    assert obj._uc_execution_family(keyed) == "A"
    texted = uc("Classification", "c.s.reviews", elite_assessment={
        "build_path": "ai_query labels each review with its complaint type",
        "signal_columns": ["c.s.reviews.rv_review_text"]})
    assert obj._uc_execution_family(texted) == "G"


def test_the_elite_verification_keeps_a_trend_whose_result_ai_query_annotates(agent_ns):
    obj = inspire(agent_ns)
    verdict = obj._verify_elite_evidence(uc("Trend Analysis", "c.s.returns"), copy.deepcopy(ANNOTATED_TREND), copy.deepcopy(EVIDENCE))
    assert verdict["passed"] is True, verdict["failures"]
    sentiment = dict(ANNOTATED_TREND, build_path="ai_analyze_sentiment per return reason, then a monthly trend test")
    verdict = obj._verify_elite_evidence(uc("Sentiment Analysis", "c.s.returns"), copy.deepcopy(sentiment), copy.deepcopy(EVIDENCE))
    assert any("needs a free-text column" in f for f in verdict["failures"]), verdict["failures"]
