"""c33_match2 (REQ-578, REQ-579): Match reads every table of the scan, shows the pieces breakdown, writes step rows and scores like Discover.

Phase 1 breaks each typed use case into pieces once (MATCH_BREAKDOWN_PROMPT), then asks MATCH_PIECES_PROMPT for each piece against each
metadata batch, so no table is left out when the scan is bigger than one prompt. Phase 2 sends the accepted use cases through the same
domain, score and value steps a Discover use case goes through."""
import json
import os
import re
import sys

import pytest

TESTS = os.path.dirname(os.path.abspath(__file__))
if TESTS not in sys.path:
    sys.path.insert(0, TESTS)

from c33_match_test import (SCAN, _inputs, _inst, _Loader, _piece, _report, _Spark, _stored_report,  # noqa: E402,F401
                            restore_root_logger)

BATCH_TABLES = ("main.sales.orders", "main.sales.customers", "main.sales.shipments")
BIG = "x" * 12000
THREE_TABLES = [("main", "sales", "orders", "order_id", "bigint", BIG), ("main", "sales", "orders", "amount", "double", ""),
                ("main", "sales", "customers", "customer_id", "bigint", BIG), ("main", "sales", "customers", "region", "string", ""),
                ("main", "sales", "shipments", "shipment_id", "bigint", BIG), ("main", "sales", "shipments", "shipped_at", "timestamp", "")]
BREAKDOWN = "MATCH_BREAKDOWN_PROMPT"
PIECES = "MATCH_PIECES_PROMPT"


def _ev(table, column):
    return [{"table": table, "columns": [column], "why": f"we can answer this using {table} because it has {column}"}]


class _Llm2:
    """A fake model. The breakdown answers two pieces for every input; the pieces answer depends on which tables the batch shows."""

    def __init__(self, by_table, fail_on=None):
        self.by_table = by_table
        self.fail_on = fail_on or set()
        self.calls = []

    def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema, **kwargs):
        self.calls.append((worker_prompt_path, dict(prompt_vars)))
        if prompt_vars["use_case_name"] in self.fail_on:
            raise RuntimeError("model unavailable")
        if worker_prompt_path == BREAKDOWN:
            return json.dumps({"pieces": [{"piece_no": 1, "requirement": "first need"}, {"piece_no": 2, "requirement": "second need"}]})
        shown = [t for t in self.by_table if t in prompt_vars["schema_markdown"]]
        pieces = []
        for number in (1, 2):
            best = None
            for table in shown:
                found = self.by_table[table].get(number)
                if found and (best is None or found["confidence"] > best["confidence"]):
                    best = found
            pieces.append(dict(best or {"status": "missing", "confidence": 0, "evidence": [], "gap": "not in these tables",
                                        "known_data_option": None}, piece_no=number, requirement=f"need {number}"))
        return json.dumps({"pieces": pieces})

    def of(self, path):
        return [v for p, v in self.calls if p == path]


def _p(status, confidence, evidence=None, gap=""):
    return {"status": status, "confidence": confidence, "evidence": evidence or [], "gap": gap, "known_data_option": None}


def _stored(spark, no):
    rows = [a for _, a in spark.inserts("__inspire_match") if a["n"] == no]
    assert len(rows) == 1
    return json.loads(rows[0]["report"])


def _small_context(agent_ns, monkeypatch):
    monkeypatch.setitem(agent_ns, "get_safe_context_limit", lambda *a, **k: 25000)


# ---------------------------------------------------------------- a. every batch is matched


def test_metadata_in_three_batches_is_matched_batch_by_batch_and_the_evidence_comes_from_batch_3(agent_ns, monkeypatch):
    _small_context(agent_ns, monkeypatch)
    llm = _Llm2({"main.sales.orders": {1: _p("matched", 90, _ev("main.sales.orders", "amount"))},
                 "main.sales.customers": {1: _p("partial", 60, _ev("main.sales.customers", "region"), "no dates")},
                 "main.sales.shipments": {2: _p("matched", 85, _ev("main.sales.shipments", "shipped_at"))}})
    spark = _Spark({"__inspire_match_input": _inputs()})
    _inst(agent_ns, spark, "match", llm, _Loader(THREE_TABLES))._run_match_mode()
    assert len(llm.of(BREAKDOWN)) == 2
    pieces_calls = llm.of(PIECES)
    assert len(pieces_calls) == 6
    for name in ("Churn watch", "Order value by region"):
        shown = [tuple(t for t in BATCH_TABLES if t in v["schema_markdown"]) for v in pieces_calls if v["use_case_name"] == name]
        assert sorted(shown) == sorted((t,) for t in BATCH_TABLES), shown
    report = _stored(spark, 1)
    one, two = report["pieces"]
    assert [e["table"] for e in one["evidence"]] == ["main.sales.orders"] and one["confidence"] == 90
    assert [e["table"] for e in two["evidence"]] == ["main.sales.shipments"] and two["status"] == "matched"
    assert report["verdict"] == "full" and report["confidence"] == 88


# ---------------------------------------------------------------- b. breakdown, then pieces; the merge keeps the best batch


def test_the_breakdown_comes_first_its_pieces_go_to_every_pieces_call_and_the_requirement_is_the_breakdowns(agent_ns, monkeypatch):
    _small_context(agent_ns, monkeypatch)
    llm = _Llm2({})
    spark = _Spark({"__inspire_match_input": _inputs()[:1]})
    _inst(agent_ns, spark, "match", llm, _Loader(THREE_TABLES))._run_match_mode()
    assert [p for p, _ in llm.calls] == [BREAKDOWN] + [PIECES] * 3
    for variables in llm.of(PIECES):
        sent = json.loads(variables["pieces_json"])
        assert [(p["piece_no"], p["requirement"]) for p in sent] == [(1, "first need"), (2, "second need")]
    assert [p["requirement"] for p in _stored(spark, 1)["pieces"]] == ["first need", "second need"]


def test_the_merge_keeps_the_highest_confidence_and_drops_evidence_that_is_not_in_that_batch(agent_ns, monkeypatch):
    _small_context(agent_ns, monkeypatch)
    llm = _Llm2({"main.sales.orders": {1: _p("matched", 95, _ev("main.sales.customers", "region"))},
                 "main.sales.customers": {1: _p("partial", 70, _ev("main.sales.customers", "region"), "no dates"),
                                          2: _p("matched", 99, _ev("main.sales.invented", "x"))},
                 "main.sales.shipments": {1: _p("matched", 92, _ev("main.sales.shipments", "no_such_column"))}})
    spark = _Spark({"__inspire_match_input": _inputs()[:1]})
    _inst(agent_ns, spark, "match", llm, _Loader(THREE_TABLES))._run_match_mode()
    one, two = _stored(spark, 1)["pieces"]
    assert one["confidence"] == 70 and one["status"] == "partial" and [e["table"] for e in one["evidence"]] == ["main.sales.customers"]
    assert two["status"] == "missing" and two["evidence"] == [] and two["gap"]


# ---------------------------------------------------------------- c. step rows


def _rows(inst, no):
    return [kw for kw in inst.emitted if kw.get("stage_name") == "Match Use Cases" and kw.get("step_name") == f"Match {no}"]


def test_each_input_has_a_started_row_and_a_complete_row_with_its_verdict(agent_ns):
    llm = _Llm2({"main.sales.orders": {1: _p("matched", 90, _ev("main.sales.orders", "amount")),
                                       2: _p("partial", 50, _ev("main.sales.orders", "order_id"), "no key")}})
    spark = _Spark({"__inspire_match_input": _inputs()})
    inst = _inst(agent_ns, spark, "match", llm, _Loader(SCAN))
    inst._run_match_mode()
    for no, name in ((1, "Churn watch"), (2, "Order value by region")):
        started, complete = _rows(inst, no)
        assert (started["sub_step_name"], started["status"]) == ("Started", "started")
        assert started["result_json"] == {"input_no": no, "name": name, "status": "matching"}
        assert (complete["sub_step_name"], complete["status"]) == ("Complete", "ended_success")
        assert complete["result_json"] == {"input_no": no, "name": name, "status": "partly matched", "verdict": "partial", "confidence": 70}
        assert complete["step_id"] == started["step_id"] or started["step_id"] is None


def test_the_complete_row_says_matched_for_a_full_verdict_and_not_matched_for_none(agent_ns):
    full = {"main.sales.orders": {1: _p("matched", 90, _ev("main.sales.orders", "amount")), 2: _p("matched", 80, _ev("main.sales.orders", "amount"))}}
    inst = _inst(agent_ns, _Spark({"__inspire_match_input": _inputs()[:1]}), "match", _Llm2(full), _Loader(SCAN))
    inst._run_match_mode()
    assert _rows(inst, 1)[-1]["result_json"]["status"] == "matched" and _rows(inst, 1)[-1]["result_json"]["verdict"] == "full"
    inst = _inst(agent_ns, _Spark({"__inspire_match_input": _inputs()[:1]}), "match", _Llm2({}), _Loader(SCAN))
    inst._run_match_mode()
    assert _rows(inst, 1)[-1]["result_json"]["status"] == "not matched" and _rows(inst, 1)[-1]["result_json"]["verdict"] == "none"


def test_a_model_error_gives_an_error_row_and_the_run_continues_with_the_next_input(agent_ns):
    llm = _Llm2({"main.sales.orders": {1: _p("matched", 90, _ev("main.sales.orders", "amount")), 2: _p("matched", 90, _ev("main.sales.orders", "amount"))}},
                fail_on={"Churn watch"})
    spark = _Spark({"__inspire_match_input": _inputs()})
    inst = _inst(agent_ns, spark, "match", llm, _Loader(SCAN))
    inst._run_match_mode()
    started, error = _rows(inst, 1)
    assert (error["sub_step_name"], error["status"]) == ("Error", "ended_error")
    assert error["result_json"]["status"] == "not matched" and error["result_json"]["input_no"] == 1 and error["result_json"]["name"] == "Churn watch"
    assert _rows(inst, 2)[-1]["result_json"]["status"] == "matched"
    assert _stored(spark, 1)["verdict"] == "none" and _stored(spark, 2)["verdict"] == "full"


def test_accept_writes_an_accept_step_with_the_accepted_count_and_the_dropped_inputs(agent_ns):
    churn = _stored_report(1, "Churn watch", _piece(1, confidence=92))
    region = _stored_report(2, "Order value by region", _piece(1, confidence=88))
    decisions = [{"input_no": 1, "piece_no": 1, "decision": "drop", "event_at": _ts_(3)}]
    spark = _Spark({"__inspire_match": [churn, region], "__inspire_match_input": _inputs(), "__inspire_match_decision": decisions})
    inst = _inst(agent_ns, spark, "accept")
    inst._tracking_replace_session = lambda use_cases, chunk_size=500: None
    inst._run_match_mode()
    rows = [kw for kw in inst.emitted if kw.get("stage_name") == "Match Use Cases" and kw.get("step_name") == "Accept"]
    assert [kw["sub_step_name"] for kw in rows] == ["Started", "Complete"]
    assert rows[-1]["status"] == "ended_success" and rows[-1]["result_json"] == {"accepted": 1, "dropped_inputs": [1]}


def _ts_(minute):
    import datetime
    return datetime.datetime(2026, 11, 28, 10, minute, 0)


# ---------------------------------------------------------------- d. accepted use cases go through the normal steps


def test_accepted_use_cases_go_through_domain_scores_and_value_and_keep_no_placeholder_domain(agent_ns):
    churn = _stored_report(1, "Churn watch", _piece(1, confidence=92))
    region = _stored_report(2, "Order value by region", _piece(1, confidence=88))
    spark = _Spark({"__inspire_match": [churn, region], "__inspire_match_input": _inputs(), "__inspire_match_decision": []})
    inst = _inst(agent_ns, spark, "accept", None, _Loader(SCAN))
    order, written = [], []

    def cluster(use_cases, language, merge_small_domains=True):
        order.append("domain")
        assert all(uc["Business Domain"] == "" for uc in use_cases)
        return [dict(uc, **{"Business Domain": "Sales", "Subdomain": "Orders"}) for uc in use_cases]

    def score(use_cases, full_schema_details, **context):
        order.append("score")
        assert {"main.sales.orders", "main.sales.customers"} <= {f"{c}.{s}.{t}" for c, s, t, *_ in full_schema_details}
        assert set(context) == {"business_context", "industry", "strategic_initiative", "value_chain", "revenue_model"}
        for uc in use_cases:
            uc.update({"scoring_status": "scored", "Quality Score": 4, "Priority": 7})
        return use_cases

    inst._cluster_domains_and_subdomains = cluster
    inst._score_combined_value_and_quality = score
    inst._apply_inspire_scores = lambda use_cases: order.append("inspire_score") or [uc.update({"Inspire Score": 7.1}) for uc in use_cases]
    inst._apply_value_estimates = lambda use_cases: order.append("value") or [uc.update({"value_estimate_text": "v"}) for uc in use_cases]
    inst._tracking_replace_session = lambda use_cases, chunk_size=500: written.append([dict(u) for u in use_cases])
    inst._run_match_mode()
    assert order == ["domain", "score", "inspire_score", "value"]
    assert len(written) == 1 and [u["Name"] for u in written[0]] == ["Churn watch", "Order value by region"]
    assert all(u["Business Domain"] == "Sales" and u["Inspire Score"] == 7.1 and u["value_estimate_text"] == "v" for u in written[0])
    assert "Matched Use Cases" not in json.dumps(written, default=str)
    assert "MATCH_DOMAIN" not in agent_ns


def test_a_failing_normal_step_does_not_lose_the_accepted_use_cases(agent_ns):
    spark = _Spark({"__inspire_match": [_stored_report(1, "Churn watch", _piece(1, confidence=92))], "__inspire_match_input": _inputs()[:1],
                    "__inspire_match_decision": []})
    inst = _inst(agent_ns, spark, "accept", None, _Loader(SCAN))
    written = []

    def broken(*args, **kwargs):
        raise RuntimeError("domain model down")

    inst._cluster_domains_and_subdomains = broken
    inst._tracking_replace_session = lambda use_cases, chunk_size=500: written.append(use_cases)
    inst._run_match_mode()
    assert len(written) == 1 and written[0][0]["Name"] == "Churn watch" and written[0][0]["Business Domain"] != "Matched Use Cases"


# ---------------------------------------------------------------- e. must-keep: one batch is one call of each


def test_a_scan_that_fits_one_batch_makes_one_breakdown_and_one_pieces_call_per_input(agent_ns):
    llm = _Llm2({"main.sales.orders": {1: _p("matched", 90, _ev("main.sales.orders", "amount"))}})
    spark = _Spark({"__inspire_match_input": _inputs()})
    _inst(agent_ns, spark, "match", llm, _Loader(SCAN))._run_match_mode()
    assert [p for p, _ in llm.calls] == [BREAKDOWN, PIECES, BREAKDOWN, PIECES]


# ---------------------------------------------------------------- the prompts


def test_the_two_new_prompts_exist_cite_only_the_scan_and_the_old_one_is_gone(agent_ns):
    templates = agent_ns["PROMPT_TEMPLATES"]
    assert "MATCH_USE_CASE_PROMPT" not in templates
    assert set(re.findall(r"\{(\w+)\}", templates[BREAKDOWN])) == {"use_case_name", "use_case_description", "business_name",
                                                                  "generation_instructions_section"}
    assert set(re.findall(r"\{(\w+)\}", templates[PIECES])) == {"use_case_name", "use_case_description", "business_name",
                                                               "generation_instructions_section", "pieces_json", "schema_markdown"}
    for key in (BREAKDOWN, PIECES):
        assert "wins" in templates[key].lower() and "user" in templates[key].lower()
    assert "80" in templates[PIECES] and "column" in templates[PIECES].lower()
