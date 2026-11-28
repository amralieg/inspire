"""c41_match100 (REQ-578 / REQ-585 item 3): after the person's decisions, "100% supports" means every piece the person KEPT is
backed by a named table and columns: a kept piece counts as supported only when it is matched with confidence >= 80 and has
evidence (or the person chose use_known_data and the option names a table and columns). Dropped pieces are listed, never counted
as matched. The accept step reports a verdict per input over the kept pieces only, plus its dropped pieces."""
import json
import os
import sys

TESTS = os.path.dirname(os.path.abspath(__file__))
if TESTS not in sys.path:
    sys.path.insert(0, TESTS)

from c33_match_test import _Spark, _decision, _inputs, _inst, _piece, _report, _stored_report, _ts  # noqa: E402,F401

ORDERS = [{"table": "main.sales.orders", "columns": ["amount"], "why": "w"}]


def accept(ns, report, decisions=()):
    return ns["inspire_match_accept"](report, list(decisions))


def test_1_dropped_pieces_are_listed_with_their_requirement(agent_ns):
    out = accept(agent_ns, _report(_piece(1), _piece(2, status="missing", confidence=0, evidence=[]), _piece(3)),
                 [_decision(2, "drop", 1), _decision(3, "drop", 2)])
    assert out["dropped"] == [{"piece_no": 2, "requirement": "requirement 2"}, {"piece_no": 3, "requirement": "requirement 3"}]
    assert [p["piece_no"] for p in out["pieces"]] == [1]


def test_2_every_kept_piece_matched_at_80_or_more_is_full(agent_ns):
    out = accept(agent_ns, _report(_piece(1, confidence=80), _piece(2, confidence=97)))
    assert out["verdict"] == "full" and out["confidence"] == 89 and out["dropped"] == []


def test_3_dropping_the_unsupported_piece_makes_the_rest_full_and_the_drop_is_not_counted(agent_ns):
    report = _report(_piece(1, confidence=90), _piece(2, status="partial", confidence=60, gap="no dates"))
    assert accept(agent_ns, report)["verdict"] == "partial"
    out = accept(agent_ns, report, [_decision(2, "drop", 1)])
    assert out["verdict"] == "full" and out["confidence"] == 90, "a dropped piece must not lower or raise the kept pieces' score"
    assert [d["piece_no"] for d in out["dropped"]] == [2]


def test_4_a_stored_matched_status_below_80_or_without_evidence_is_not_supported(agent_ns):
    """report_json is read back from a table: the accept step re-checks the rule, it does not trust the stored status."""
    low = accept(agent_ns, _report(_piece(1, confidence=95), _piece(2, status="matched", confidence=79)))
    assert low["verdict"] == "partial"
    bare = accept(agent_ns, _report(_piece(1, confidence=95), _piece(2, status="matched", confidence=95, evidence=[])))
    assert bare["verdict"] == "partial"
    bad = accept(agent_ns, _report(_piece(1, confidence=95), _piece(2, status="matched", confidence=95,
                                                                    evidence=[{"table": "main.sales.orders", "columns": []}])))
    assert bad["verdict"] == "partial"


def test_5_use_known_data_counts_as_supported_only_with_a_named_table_and_columns(agent_ns):
    known = {"table": "main.sales.customers", "columns": ["region"], "why": "closest data we know"}
    report = _report(_piece(1, confidence=90), _piece(2, status="missing", confidence=0, evidence=[], known=known))
    out = accept(agent_ns, report, [_decision(2, "use_known_data", 1)])
    assert out["verdict"] == "full"
    no_option = _report(_piece(1, confidence=90), _piece(2, status="missing", confidence=0, evidence=[]))
    out = accept(agent_ns, no_option, [_decision(2, "use_known_data", 1)])
    assert out["verdict"] == "partial", "use_known_data with no option keeps the piece unsupported"


def test_6_no_kept_piece_supported_or_partial_is_none(agent_ns):
    out = accept(agent_ns, _report(_piece(1, status="missing", confidence=0, evidence=[]), _piece(2)), [_decision(2, "drop", 1)])
    assert out["verdict"] == "none" and out["confidence"] == 0


def test_7_accept_step_reports_each_inputs_verdict_and_dropped_pieces(agent_ns):
    churn = _stored_report(1, "Churn watch", _piece(1, confidence=92), _piece(2, status="missing", confidence=0, evidence=[], gap="g"))
    region = _stored_report(2, "Order value by region", _piece(1, confidence=88), _piece(2, status="partial", confidence=50))
    spark = _Spark({"__inspire_match": [churn, region], "__inspire_match_input": _inputs(),
                    "__inspire_match_decision": [{"input_no": 1, "piece_no": 2, "decision": "drop", "event_at": _ts(3)}]})
    inst = _inst(agent_ns, spark, "accept")
    inst._tracking_replace_session = lambda use_cases, chunk_size=500: None
    inst._match_normal_steps = lambda use_cases: use_cases
    inst._run_match_mode()
    finals = [kw.get("result_json") for kw in inst.emitted if isinstance(kw.get("result_json"), (dict, str))]
    finals = [json.loads(r) if isinstance(r, str) else r for r in finals]
    final = next(r for r in reversed(finals) if "accepted" in r)
    by_input = {int(i["input_no"]): i for i in final["inputs"]}
    assert by_input[1]["verdict"] == "full" and by_input[1]["dropped_pieces"] == [{"piece_no": 2, "requirement": "requirement 2"}]
    assert by_input[2]["verdict"] == "partial" and by_input[2]["dropped_pieces"] == []


def test_8_accepted_use_case_carries_its_match_verdict(agent_ns):
    churn = _stored_report(1, "Churn watch", _piece(1, confidence=92), _piece(2, status="partial", confidence=40))
    spark = _Spark({"__inspire_match": [churn], "__inspire_match_input": _inputs(), "__inspire_match_decision": []})
    inst = _inst(agent_ns, spark, "accept")
    written = []
    inst._tracking_replace_session = lambda use_cases, chunk_size=500: written.extend(dict(u) for u in use_cases)
    inst._match_normal_steps = lambda use_cases: use_cases
    inst._run_match_mode()
    assert written and written[0]["match_verdict"] == "partial"
