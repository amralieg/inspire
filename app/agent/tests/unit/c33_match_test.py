"""c33_match (REQ-578): the Match Use Cases operation replaces Generate Use Cases.

Phase 1 ('match') breaks each use case the user typed into pieces and, for each piece, names the table and columns that answer it, the gap
and a known-data option, with a confidence. Phase 2 ('accept') applies the user's keep / drop / use_known_data decisions and writes the
rest as normal use cases (AIx-UCx ids, same session). The verdict and the confidence come from code, never from the model."""
import datetime
import json
import logging
import os
import re
import sys
import types

import pytest

TESTS = os.path.dirname(os.path.abspath(__file__))
if TESTS not in sys.path:
    sys.path.insert(0, TESTS)

from v120_modes_quality_test import _cleanup, _construct  # noqa: E402

COLUMNS = {
    "main.sales.orders": {"order_id", "customer_id", "amount", "ordered_at"},
    "main.sales.customers": {"customer_id", "region", "segment"},
}


@pytest.fixture
def restore_root_logger():
    root = logging.getLogger()
    saved = (list(root.handlers), root.level, list(root.filters))
    yield
    root.handlers[:] = saved[0]
    root.setLevel(saved[1])
    root.filters[:] = saved[2]


def _piece(no, status="matched", confidence=90, evidence=None, gap="", known=None, requirement=None):
    return {"piece_no": no, "requirement": requirement or f"requirement {no}", "status": status, "confidence": confidence,
            "evidence": evidence if evidence is not None else [{"table": "main.sales.orders", "columns": ["amount"],
                                                                "why": "we can answer this using main.sales.orders because it has amount"}],
            "gap": gap, "known_data_option": known}


def _report(*pieces, input_no=1, name="Churn watch"):
    return {"input_no": input_no, "name": name, "verdict": "full", "confidence": 100, "pieces": list(pieces)}


# ---------------------------------------------------------------- a. the operation list


def test_the_operations_are_discover_match_implement(agent_ns):
    assert agent_ns["INSPIRE_OPERATIONS"] == ("Discover Use Cases", "Match Use Cases", "Implement Use Cases")


def test_generate_use_cases_is_refused_as_an_unknown_operation(fresh_ns, tmp_path, restore_root_logger):
    with pytest.raises(ValueError) as exc:
        _construct(fresh_ns, tmp_path, operation="Generate Use Cases")
    assert "is not supported" in str(exc.value) and "'Match Use Cases'" in str(exc.value)


def test_match_use_cases_is_accepted_as_an_operation(fresh_ns, tmp_path, restore_root_logger):
    obj = _construct(fresh_ns, tmp_path, operation="Match Use Cases")
    try:
        assert obj.operation == "Match Use Cases"
    finally:
        _cleanup(obj)


# ---------------------------------------------------------------- b. inspire_match_validate


def test_evidence_with_an_unknown_table_or_column_is_dropped_and_the_piece_is_no_longer_matched(agent_ns):
    validate = agent_ns["inspire_match_validate"]
    report = _report(
        _piece(1, evidence=[{"table": "main.sales.invented", "columns": ["amount"], "why": "x"}]),
        _piece(2, evidence=[{"table": "main.sales.orders", "columns": ["amount", "invented_col"], "why": "x"}]),
        _piece(3, evidence=[{"table": "main.sales.orders", "columns": ["amount"], "why": "real"},
                            {"table": "main.sales.customers", "columns": ["nope"], "why": "invented"}]))
    out = validate(report, COLUMNS)
    one, two, three = out["pieces"]
    assert one["evidence"] == [] and one["status"] == "missing" and one["confidence"] == 0 and one["gap"]
    assert two["evidence"] == [] and two["status"] == "missing"
    assert [e["table"] for e in three["evidence"]] == ["main.sales.orders"] and three["status"] == "matched"
    assert out["verdict"] == "partial"


def test_table_and_column_names_match_without_regard_to_case_and_keep_the_scanned_spelling(agent_ns):
    out = agent_ns["inspire_match_validate"](
        _report(_piece(1, evidence=[{"table": "MAIN.Sales.Orders", "columns": ["AMOUNT"], "why": "w"}])), COLUMNS)
    assert out["pieces"][0]["evidence"][0]["table"] == "main.sales.orders"
    assert out["pieces"][0]["evidence"][0]["columns"] == ["amount"]


def test_confidence_79_is_partial_and_80_is_matched(agent_ns):
    validate = agent_ns["inspire_match_validate"]
    out = validate(_report(_piece(1, status="matched", confidence=79, gap="date range unknown"),
                           _piece(2, status="partial", confidence=80)), COLUMNS)
    assert [p["status"] for p in out["pieces"]] == ["partial", "matched"]
    assert [p["confidence"] for p in out["pieces"]] == [79, 80]


def test_confidence_is_clamped_to_0_100_and_a_bad_value_counts_as_0(agent_ns):
    out = agent_ns["inspire_match_validate"](
        _report(_piece(1, confidence=140), _piece(2, confidence="high"), _piece(3, confidence=-5)), COLUMNS)
    assert [p["confidence"] for p in out["pieces"]] == [100, 0, 0]


def test_full_verdict_when_every_piece_is_matched(agent_ns):
    out = agent_ns["inspire_match_validate"](_report(_piece(1, confidence=90), _piece(2, confidence=100)), COLUMNS)
    assert out["verdict"] == "full" and out["confidence"] == 95


def test_partial_verdict_when_some_piece_is_matched_or_partial_and_another_is_not(agent_ns):
    validate = agent_ns["inspire_match_validate"]
    out = validate(_report(_piece(1, confidence=90), _piece(2, status="missing", confidence=0, evidence=[], gap="no data")), COLUMNS)
    assert out["verdict"] == "partial" and out["confidence"] == 45
    only_partial = validate(_report(_piece(1, status="partial", confidence=60, gap="no dates"),
                                    _piece(2, status="missing", confidence=0, evidence=[], gap="none")), COLUMNS)
    assert only_partial["verdict"] == "partial" and only_partial["confidence"] == 30


def test_none_verdict_when_no_piece_is_matched_or_partial_and_a_report_with_no_piece_is_none(agent_ns):
    validate = agent_ns["inspire_match_validate"]
    out = validate(_report(_piece(1, status="missing", confidence=0, evidence=[], gap="a"),
                           _piece(2, status="missing", confidence=10, evidence=[], gap="b")), COLUMNS)
    assert out["verdict"] == "none" and out["confidence"] == 0
    empty = validate(_report(), COLUMNS)
    assert empty["verdict"] == "none" and empty["confidence"] == 0 and empty["pieces"] == []


def test_the_model_cannot_claim_a_verdict_or_confidence_the_pieces_do_not_carry(agent_ns):
    report = _report(_piece(1, confidence=50, status="matched", gap="half"))
    report.update(verdict="full", confidence=99)
    out = agent_ns["inspire_match_validate"](report, COLUMNS)
    assert out["verdict"] == "partial" and out["confidence"] == 50
    assert out["input_no"] == 1 and out["name"] == "Churn watch"


def test_a_known_data_option_with_an_invented_table_or_column_becomes_null(agent_ns):
    validate = agent_ns["inspire_match_validate"]
    good = {"table": "main.sales.customers", "columns": ["region"], "why": "w"}
    bad = {"table": "main.sales.customers", "columns": ["planet"], "why": "w"}
    out = validate(_report(_piece(1, known=good), _piece(2, known=bad), _piece(3, known=None)), COLUMNS)
    assert out["pieces"][0]["known_data_option"] == good
    assert out["pieces"][1]["known_data_option"] is None and out["pieces"][2]["known_data_option"] is None


def test_validate_does_not_change_its_input_and_accepts_columns_as_lists(agent_ns):
    report = _report(_piece(1, evidence=[{"table": "main.sales.invented", "columns": ["a"], "why": "x"}]))
    before = json.dumps(report, sort_keys=True)
    agent_ns["inspire_match_validate"](report, {"main.sales.orders": ["amount"]})
    assert json.dumps(report, sort_keys=True) == before


# ---------------------------------------------------------------- c. inspire_match_accept


def _ts(minute):
    return datetime.datetime(2026, 11, 28, 10, minute, 0)


def _decision(piece_no, decision, minute, input_no=1):
    return {"input_no": input_no, "piece_no": piece_no, "decision": decision, "event_at": _ts(minute)}


def _accept_report():
    known = {"table": "main.sales.customers", "columns": ["region", "segment"], "why": "closest data we know"}
    return _report(
        _piece(1, confidence=90),
        _piece(2, status="missing", confidence=0, evidence=[], gap="no churn flag", known=known),
        _piece(3, status="partial", confidence=60, gap="no dates",
               evidence=[{"table": "main.sales.customers", "columns": ["segment"], "why": "w"}]))


def test_a_missing_decision_means_keep_and_the_name_stays_verbatim(agent_ns):
    out = agent_ns["inspire_match_accept"](_accept_report(), [])
    assert out["name"] == "Churn watch" and out["input_no"] == 1
    assert [p["piece_no"] for p in out["pieces"]] == [1, 2, 3]
    assert out["tables"] == ["main.sales.customers", "main.sales.orders"]


def test_drop_leaves_the_piece_out_and_its_tables_with_it(agent_ns):
    out = agent_ns["inspire_match_accept"](_accept_report(), [_decision(1, "drop", 1), _decision(3, "drop", 2)])
    assert [p["piece_no"] for p in out["pieces"]] == [2]
    assert out["tables"] == []


def test_use_known_data_rewrites_the_piece_to_the_known_data_table_and_columns(agent_ns):
    out = agent_ns["inspire_match_accept"](_accept_report(), [_decision(2, "use_known_data", 1)])
    piece = next(p for p in out["pieces"] if p["piece_no"] == 2)
    assert piece["evidence"] == [{"table": "main.sales.customers", "columns": ["region", "segment"], "why": "closest data we know"}]
    assert piece["status"] == "matched" and piece["decision"] == "use_known_data"
    assert "main.sales.customers" in out["tables"]


def test_use_known_data_on_a_piece_without_a_known_data_option_keeps_the_piece_as_it_is(agent_ns):
    out = agent_ns["inspire_match_accept"](_accept_report(), [_decision(1, "use_known_data", 1)])
    piece = next(p for p in out["pieces"] if p["piece_no"] == 1)
    assert [e["table"] for e in piece["evidence"]] == ["main.sales.orders"] and piece["decision"] == "keep"


def test_the_latest_event_at_wins_whatever_the_order_of_the_rows(agent_ns):
    accept = agent_ns["inspire_match_accept"]
    rows = [_decision(1, "keep", 5), _decision(1, "drop", 9), _decision(1, "keep", 2)]
    assert 1 not in [p["piece_no"] for p in accept(_accept_report(), rows)["pieces"]]
    rows = [_decision(1, "drop", 2), _decision(1, "keep", 9)]
    assert 1 in [p["piece_no"] for p in accept(_accept_report(), rows)["pieces"]]


def test_decisions_of_another_input_do_not_apply(agent_ns):
    out = agent_ns["inspire_match_accept"](_accept_report(), [_decision(1, "drop", 1, input_no=2)])
    assert [p["piece_no"] for p in out["pieces"]] == [1, 2, 3]


def test_an_input_with_every_piece_dropped_returns_none(agent_ns):
    rows = [_decision(n, "drop", 1) for n in (1, 2, 3)]
    assert agent_ns["inspire_match_accept"](_accept_report(), rows) is None


def test_a_report_with_no_piece_returns_none(agent_ns):
    assert agent_ns["inspire_match_accept"](_report(), []) is None


# ---------------------------------------------------------------- d, e. orchestration on fakes


class _Spark:
    """Records (statement, args); a SELECT answers with the rows of the most specific table name in it."""

    def __init__(self, tables=None):
        self.calls = []
        self.tables = tables or {}

    def sql(self, statement, args=None):
        text = " ".join(str(statement).split())
        self.calls.append((text, dict(args or {})))
        rows = []
        if text.startswith("SELECT"):
            for name in ("__inspire_match_decision", "__inspire_match_input", "__inspire_match"):
                if name in text:
                    rows = list(self.tables.get(name, []))
                    break
        return types.SimpleNamespace(collect=lambda rows=rows: rows)

    def inserts(self, table):
        return [(t, a) for t, a in self.calls if t.startswith("INSERT INTO") and re.search(rf"{table}`?\s*\(", t)]


class _Loader:
    def __init__(self, columns):
        self.columns = columns
        self.sent = False

    def getNextTables(self, size=None):
        if self.sent:
            return None
        self.sent = True
        return list(self.columns)


SCAN = [("main", "sales", "orders", "order_id", "bigint", ""), ("main", "sales", "orders", "amount", "double", "order value"),
        ("main", "sales", "customers", "customer_id", "bigint", ""), ("main", "sales", "customers", "region", "string", "")]


class _Llm:
    """A fake model: one JSON report per use case name; records every call."""

    def __init__(self, answers):
        self.answers = answers
        self.calls = []

    def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema, **kwargs):
        self.calls.append((worker_prompt_path, dict(prompt_vars)))
        return json.dumps(self.answers[prompt_vars["use_case_name"]])


def _inst(ns, spark, phase, llm=None, loader=None):
    cls = ns["DatabricksInspire"]
    inst = cls.__new__(cls)
    inst.logger = logging.getLogger("c33_match")
    inst.spark = spark
    inst.session_id = 5150
    inst.inspire_database = "main.inspire"
    inst.operation = "Match Use Cases"
    inst.match_phase = phase
    inst.business_name = "Acme"
    inst.ai_agent = llm
    inst.data_loader = loader
    inst.scan_parallelism = 2
    inst.emitted = []
    inst._emit_pipeline_status = lambda **kw: inst.emitted.append(kw) or kw.get("step_id") or len(inst.emitted)
    inst._report_metadata_unavailable = lambda: []
    inst._augment_columns_with_foreign_keys = lambda columns: columns
    inst.atomic_writer = None
    return inst


def _inputs():
    return [{"input_no": 1, "name": "Churn watch", "description": "Find customers who stop buying", "event_at": _ts(1)},
            {"input_no": 2, "name": "Order value by region", "description": "Order value per region", "event_at": _ts(1)}]


def _answers():
    return {
        "Churn watch": _report(_piece(1, confidence=92), _piece(2, status="missing", confidence=0, evidence=[], gap="no churn flag"),
                               name="Churn watch"),
        "Order value by region": _report(
            _piece(1, confidence=88, evidence=[{"table": "main.sales.orders", "columns": ["amount"], "why": "w"},
                                               {"table": "main.sales.invented", "columns": ["x"], "why": "invented"}]),
            input_no=2, name="Order value by region"),
    }


def test_phase_1_writes_one_validated_match_row_per_input_and_no_use_case(agent_ns):
    spark = _Spark({"__inspire_match_input": _inputs()})
    llm = _Llm(_answers())
    inst = _inst(agent_ns, spark, "match", llm, _Loader(SCAN))
    inst._run_match_mode()
    rows = spark.inserts("__inspire_match")
    assert len(rows) == 2, [t for t, _ in spark.calls]
    by_no = {a["n"]: a for _, a in rows}
    assert set(by_no) == {1, 2} and all(a["sid"] == "5150" for a in by_no.values())
    for no, row in by_no.items():
        report = json.loads(row["report"])
        assert report["input_no"] == no and report["verdict"] == row["verdict"] and report["confidence"] == row["conf"]
    churn = json.loads(by_no[1]["report"])
    assert churn["verdict"] == "partial" and churn["confidence"] == 46
    region = json.loads(by_no[2]["report"])
    assert region["verdict"] == "full" and [e["table"] for e in region["pieces"][0]["evidence"]] == ["main.sales.orders"]
    assert not [t for t, _ in spark.calls if "__inspire_usecases" in t and not t.startswith(("CREATE", "SELECT"))]
    assert not [t for t, _ in spark.calls if t.startswith(("INSERT", "MERGE", "UPDATE")) and "__inspire_usecases" in t]


def test_phase_1_sends_the_scanned_metadata_and_the_users_words_to_the_match_prompt(agent_ns):
    spark = _Spark({"__inspire_match_input": _inputs()})
    llm = _Llm(_answers())
    _inst(agent_ns, spark, "match", llm, _Loader(SCAN))._run_match_mode()
    assert [path for path, _ in llm.calls] == ["MATCH_USE_CASE_PROMPT"] * 2
    sent = {v["use_case_name"]: v for _, v in llm.calls}
    assert sent["Churn watch"]["use_case_description"] == "Find customers who stop buying"
    assert "main.sales.orders" in sent["Churn watch"]["schema_markdown"] and "region" in sent["Churn watch"]["schema_markdown"]
    prompt = agent_ns["PROMPT_TEMPLATES"]["MATCH_USE_CASE_PROMPT"]
    assert {"use_case_name", "use_case_description", "schema_markdown"} <= set(re.findall(r"\{(\w+)\}", prompt))


def test_phase_1_replaces_the_rows_of_an_earlier_match_of_the_same_input(agent_ns):
    spark = _Spark({"__inspire_match_input": _inputs()})
    _inst(agent_ns, spark, "match", _Llm(_answers()), _Loader(SCAN))._run_match_mode()
    deletes = [(t, a) for t, a in spark.calls if t.startswith("DELETE FROM") and re.search(r"__inspire_match`?\s+WHERE", t)]
    assert sorted(a["n"] for _, a in deletes) == [1, 2]


def test_phase_1_uses_the_latest_row_of_each_input_number(agent_ns):
    older = {"input_no": 1, "name": "Old name", "description": "old", "event_at": _ts(1)}
    spark = _Spark({"__inspire_match_input": [older] + _inputs()[:1] and [dict(older)] + [dict(_inputs()[0], event_at=_ts(7))]})
    llm = _Llm({"Churn watch": _answers()["Churn watch"]})
    _inst(agent_ns, spark, "match", llm, _Loader(SCAN))._run_match_mode()
    assert [v["use_case_name"] for _, v in llm.calls] == ["Churn watch"]


def _stored_report(input_no, name, *pieces, minute=1):
    report = _report(*pieces, input_no=input_no, name=name)
    return {"input_no": input_no, "verdict": "full", "confidence": 90, "report_json": json.dumps(report), "event_at": _ts(minute)}


def test_phase_2_writes_the_accepted_inputs_as_use_cases_with_ai_uc_ids_in_the_same_session(agent_ns):
    churn = _stored_report(1, "Churn watch", _piece(1, confidence=92), _piece(2, status="missing", confidence=0, evidence=[], gap="g"))
    region = _stored_report(2, "Order value by region", _piece(1, confidence=88,
                            evidence=[{"table": "main.sales.customers", "columns": ["region"], "why": "w"}]))
    spark = _Spark({"__inspire_match": [churn, region], "__inspire_match_input": _inputs(),
                    "__inspire_match_decision": [{"input_no": 1, "piece_no": 2, "decision": "drop", "event_at": _ts(3)}]})
    inst = _inst(agent_ns, spark, "accept")
    written = []
    inst._tracking_replace_session = lambda use_cases, chunk_size=500: written.append([dict(u) for u in use_cases])
    inst._run_match_mode()
    assert len(written) == 1
    first, second = written[0]
    assert (first["No"], second["No"]) == (agent_ns["inspire_use_case_id"](1, 1), agent_ns["inspire_use_case_id"](1, 2))
    assert first["No"] == "AI01-UC01"
    assert (first["Name"], second["Name"]) == ("Churn watch", "Order value by region")
    assert first["Statement"] == "Find customers who stop buying"
    assert first["Tables Involved"] == "main.sales.orders" and second["Tables Involved"] == "main.sales.customers"
    assert first["Primary Table"] == "main.sales.orders"
    assert not spark.inserts("__inspire_match")


def test_phase_2_does_not_write_an_input_whose_pieces_are_all_dropped_and_writes_nothing_when_none_is_left(agent_ns):
    churn = _stored_report(1, "Churn watch", _piece(1, confidence=92))
    region = _stored_report(2, "Order value by region", _piece(1, confidence=88))
    decisions = [{"input_no": 1, "piece_no": 1, "decision": "drop", "event_at": _ts(3)}]
    spark = _Spark({"__inspire_match": [churn, region], "__inspire_match_input": _inputs(), "__inspire_match_decision": decisions})
    inst = _inst(agent_ns, spark, "accept")
    written = []
    inst._tracking_replace_session = lambda use_cases, chunk_size=500: written.append([u["Name"] for u in use_cases])
    inst._run_match_mode()
    assert written == [["Order value by region"]]
    assert written[0] and inst.__dict__.get("_match_accepted") == 1

    spark = _Spark({"__inspire_match": [churn], "__inspire_match_input": _inputs(), "__inspire_match_decision": decisions})
    inst = _inst(agent_ns, spark, "accept")
    written.clear()
    inst._tracking_replace_session = lambda use_cases, chunk_size=500: written.append(use_cases)
    inst._run_match_mode()
    assert written == []


def test_phase_2_reads_the_latest_report_of_an_input(agent_ns):
    old = _stored_report(1, "Churn watch", _piece(1, confidence=92), minute=1)
    new = _stored_report(1, "Churn watch", _piece(1, confidence=92), _piece(2, confidence=95), minute=8)
    spark = _Spark({"__inspire_match": [new, old], "__inspire_match_input": _inputs()[:1], "__inspire_match_decision": []})
    inst = _inst(agent_ns, spark, "accept")
    written = []
    inst._tracking_replace_session = lambda use_cases, chunk_size=500: written.append(use_cases)
    inst._run_match_mode()
    assert len(written) == 1 and len(written[0]) == 1
