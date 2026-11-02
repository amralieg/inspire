"""v1.2.0 INTEGRATION-6: one shared row guard for every LLM CSV answer, honest truncation, well-formed repo CSVs.

G1 An LLM can write the values of a row in an old column order under a new header (the field count matches and
   the values shift), drop a column, or overflow one. Every LLM CSV parser now runs the one row guard
   (`CSVParser.misaligned_row` / `CSVParser.aligned_rows`): a short row, unexplained extra values, a misplaced
   honesty value, or a verbatim-copied anchor value (id, table name, technique, quality label, enum value) that
   sits in another column is rejected, counted per reason and treated as missing, so the caller retries it.
G2 Honesty columns are stripped only where the row shape proves their position, so stripping never hides a
   shifted row and never invents one from an unquoted justification.
T1 A translation answer is truncated only when it ends inside an open quoted field, its final row stops
   mid-row, or the closing rows the prompt required never started. A complete answer that lacks a row is
   retried once and split only if the retry is incomplete too. A dedup keep-list that was cut off is refused.
R1 Every CSV under rules/ and every repo CSV the code or the tests read has the header's field count.

Each behavioural test is built from a shifted, short, cut or complete-but-short answer and fails on the
integrated build before this change.
"""
import ast
import csv
import io
import json
import logging
import os
import re
import sys
import types

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _agentload import ROOT, agent_ast, agent_source  # noqa: E402
from v120_artifacts_support import make_inspire as docs_inspire, make_uc  # noqa: E402
from v120_docs_design_test import docs, labels  # noqa: E402,F401
from v120_docs_final3_test import TRANSLATE_HEADER, _ja_row, _service, _translation_csv  # noqa: E402
from v120_funnel_integrity_test import HEADER, _goal_ids, _goal_obj, make_inspire as core_inspire  # noqa: E402
from v120_integration_test import _ClusterAgent, _inspire, _rendering_agent, _uc, _user_domain_obj  # noqa: E402

GEN_FIELDS = ["No", "Name", "usecase", "type", "Analytics Technique", "Statement", "Solution", "Business Value",
              "Beneficiary", "Sponsor", "Tables Involved", "High Level Design"]
FILTER_HEADER = '"Table Name","Classification","Data Category","Business Score","Reason"'
FILTER_LINES = {"c.s.alpha": "- `c`.`s`.`alpha` | columns (1): id bigint"}


def _quoted(values):
    return ",".join('"' + str(v).replace('"', '""') + '"' for v in values)


def _gen_line(no, order=GEN_FIELDS, drop=()):
    values = {"No": no, "Name": f"Forecast orders {no}", "usecase": "Forecast Orders", "type": "Opportunity",
              "Analytics Technique": "Forecasting", "Statement": "Orders drop", "Solution": "Model",
              "Business Value": "Value", "Beneficiary": "Ops", "Sponsor": "COO", "Tables Involved": "c.s.orders",
              "High Level Design": "Aggregate `amount` by `order_date`"}
    return _quoted([values[f] for f in order if f not in drop])


def _swapped(first, second):
    order = list(GEN_FIELDS)
    i, j = order.index(first), order.index(second)
    order[i], order[j] = order[j], order[i]
    return order


@pytest.mark.parametrize("row, required, anchors, reason", [
    ({"a": "x", "b": None}, ("a", "b"), {}, "short_row"),
    ({"a": "x", "b": "y", None: ["z"]}, ("a", "b"), {}, "extra_values"),
    ({"id": "U1", "v": "Sales", "honesty_score": "faithful"}, ("id", "v"), {}, "honesty_misplaced"),
    ({"id": "U1", "v": "90"}, ("id", "v"), {}, "honesty_misplaced"),
    ({"id": "Sales", "v": "U1"}, ("id", "v"), {"id": ("U1",)}, "anchor_shifted"),
])
def test_the_guard_rejects_short_long_misplaced_and_shifted_rows(agent_ns, row, required, anchors, reason):
    guard = agent_ns["CSVParser"]
    built = {k: guard.one_of(v) for k, v in anchors.items()}
    assert guard.misaligned_row(row, required, built)[0] == reason


@pytest.mark.parametrize("row, anchors", [
    ({"id": "U1", "v": "Sales"}, {}),
    ({"id": "U1", "v": "Sales", "honesty_score": "90", "honesty_justification": "based on tables", None: [" columns"]}, {}),
    ({"id": "U1", "v": "Sales", None: ["90", "based on tables", " columns"]}, {}),
    ({"id": "U1", "Aligned": "YES", None: ["because it serves the goal"]}, {"Aligned": ("YES", "NO")}),
    ({"\ufeff\"Use Case ID\"": "U1", "Honesty Score": "90"}, {}),
    ({"id": "U1", "v": "Sales", "honesty_score": "95/100", "honesty_justification": ""}, {}),
])
def test_the_guard_keeps_aligned_rows_and_honesty_or_appendix_overflow(agent_ns, row, anchors):
    guard = agent_ns["CSVParser"]
    built = {k: guard.one_of(v) for k, v in anchors.items()}
    assert guard.misaligned_row(row, ("id", "v"), built) == ("", "")


@pytest.mark.parametrize("first, second", [("usecase", "type"), ("Analytics Technique", "Statement"),
                                           ("Tables Involved", "High Level Design")])
def test_generation_drops_a_row_written_in_an_old_column_order(agent_ns, caplog, first, second):
    obj = core_inspire(agent_ns, global_table_names={"c.s.orders"})
    response = "\n".join([HEADER, _gen_line("N1-1"), _gen_line("N1-2", _swapped(first, second))])
    with caplog.at_level(logging.INFO):
        rows = obj._parse_llm_csv_response(response, "[t]")
    assert [r["No"] for r in rows] == ["N1-1"]
    assert "Dropped 1 non-use-case row: anchor_shifted=1" in caplog.text
    assert "[CSV-ROW misaligned] [t] Skipping row N1-2" in caplog.text


def test_generation_drops_a_row_missing_its_last_column(agent_ns, caplog):
    obj = core_inspire(agent_ns)
    response = "\n".join([HEADER, _gen_line("N1-1"), _gen_line("N1-2", drop=("High Level Design",))])
    with caplog.at_level(logging.INFO):
        rows = obj._parse_llm_csv_response(response, "[t]")
    assert [r["No"] for r in rows] == ["N1-1"] and rows[0]["High Level Design"].startswith("Aggregate")
    assert "short_row=1" in caplog.text


def test_generation_drops_a_final_row_cut_inside_a_quoted_field(agent_ns, caplog):
    obj = core_inspire(agent_ns)
    response = "\n".join([HEADER, _gen_line("N1-1"), _gen_line("N1-2")[:-1] + " grouped by"])
    with caplog.at_level(logging.INFO):
        rows = obj._parse_llm_csv_response(response, "[t]")
    assert [r["No"] for r in rows] == ["N1-1"]
    assert "cut_final_row=1" in caplog.text


def test_generation_tolerant_fallback_no_longer_pads_or_cuts_rows(fresh_ns, caplog):
    fresh_ns["CSVParser"].parse_csv_string = staticmethod(lambda *a, **k: [])
    obj = core_inspire(fresh_ns)
    long_row = _gen_line("N1-3")[:-1] + '","extra prose","more"'
    response = "\n".join([HEADER, _gen_line("N1-1"), _gen_line("N1-2", drop=("Solution", "High Level Design")), long_row])
    with caplog.at_level(logging.INFO):
        rows = obj._parse_llm_csv_response(response, "[t]")
    assert [r["No"] for r in rows] == ["N1-1"]
    assert "extra_values=1" in caplog.text and "short_row=1" in caplog.text


def test_table_filter_retries_a_row_written_in_an_old_column_order(agent_ns):
    shifted = '"c.s.alpha","BUSINESS","87","TRANSACTIONAL","Orders"'
    good = '"c.s.alpha","BUSINESS","TRANSACTIONAL","87","Orders"'
    agent = _rendering_agent(agent_ns, lambda path, pv, skip: FILTER_HEADER + "\n" + (good if skip else shifted))
    obj = _inspire(agent_ns, ai_agent=agent)
    result = obj._process_filter_batch_recursive(["c.s.alpha"], 1, 1, "Acme", "I", "B", "Medium", "R", "", 0, 10,
                                                 FILTER_LINES)
    assert result == {"c.s.alpha": ("BUSINESS", 87, "TRANSACTIONAL")}
    assert [c["skip_cache"] for c in agent.calls] == [False, True]


def test_table_filter_never_turns_a_short_row_into_a_default_score(agent_ns):
    cut = '"c.s.alpha","BUSINESS","MASTER"'
    good = '"c.s.alpha","BUSINESS","MASTER","72","Customers"'
    agent = _rendering_agent(agent_ns, lambda path, pv, skip: FILTER_HEADER + "\n" + (good if skip else cut))
    obj = _inspire(agent_ns, ai_agent=agent)
    result = obj._process_filter_batch_recursive(["c.s.alpha"], 1, 1, "Acme", "I", "B", "Medium", "R", "", 0, 10,
                                                 FILTER_LINES)
    assert result == {"c.s.alpha": ("BUSINESS", 72, "MASTER")}


def test_translation_row_short_of_a_column_is_rejected_after_honesty_stripping(docs):
    raw = _translation_csv([_ja_row("N01-U01"), _ja_row("N01-U02", drop="Technique Label")])
    _score, _just, cleaned = docs["extract_honesty_score"](raw)
    service = _service(docs)
    rows = service._parse_translation_csv(cleaned, [make_uc("N01-U01"), make_uc("N01-U02")], 1, "Japanese")
    assert rows == []
    assert service.logger.matching("[TRANSLATE-ROW malformed]")
    assert service.logger.matching("[CSV-ROW misaligned] Translation batch #1: rejected 1 of 2 rows (extra_values=1)")


def test_dedup_refuses_a_keep_list_with_a_shifted_row(agent_ns):
    obj = _inspire(agent_ns)
    with pytest.raises(ValueError, match="outside the id column"):
        obj._parse_dedup_response("use_case_id,name\nU1,Forecast\nForecast demand,U3\n",
                                  [_uc("U1"), _uc("U2"), _uc("U3")], "t")


@pytest.mark.parametrize("response", ["use_case_id\nU1\nU", 'use_case_id\n"U1"\n"U3'])
def test_dedup_refuses_a_keep_list_that_was_cut_off(agent_ns, response):
    obj = _inspire(agent_ns)
    with pytest.raises(ValueError, match="cut off"):
        obj._parse_dedup_response(response, [_uc("U1"), _uc("U2"), _uc("U3")], "t")


def test_dedup_still_reads_a_complete_keep_list_with_removals_and_appended_names(agent_ns):
    obj = _inspire(agent_ns)
    kept = obj._parse_dedup_response("use_case_id\nU1,Forecast demand\nU3\n", [_uc("U1"), _uc("U2"), _uc("U3")], "t")
    assert [u["No"] for u in kept] == ["U1", "U3"]


def test_assignment_rejects_a_row_with_the_id_in_the_value_column(agent_ns):
    obj = _inspire(agent_ns)
    response = "use_case_id,domain\nU1,Sales\nOps,U2\n"
    mapping = obj._parse_assignment_csv(response, "domain", "t", [_uc("U1"), _uc("U2")])
    assert mapping == {"U1": "Sales"}
    assert "U2" not in obj._canonicalize_domain_names(mapping).values()


def test_assignment_honesty_justification_with_unquoted_commas_keeps_every_row(agent_ns):
    obj = _inspire(agent_ns)
    raw = ("use_case_id,domain,honesty_score,honesty_justification\n"
           "U1,Sales,90,grouped by tables, statements and sponsors\nU2,Ops,90,ok\n")
    _score, _just, cleaned = agent_ns["extract_honesty_score"](raw)
    assert [len(row) for row in csv.reader(io.StringIO(cleaned))] == [2, 2, 2]
    assert obj._parse_assignment_csv(cleaned, "domain", "t", [_uc("U1"), _uc("U2")]) == {"U1": "Sales", "U2": "Ops"}


def test_assignment_row_that_lost_its_value_column_is_not_read_as_the_honesty_score(agent_ns):
    obj = _inspire(agent_ns)
    raw = "use_case_id,domain,honesty_score,honesty_justification\nU1,Sales,90,ok\nU2,90,ok\n"
    _score, _just, cleaned = agent_ns["extract_honesty_score"](raw)
    assert obj._parse_assignment_csv(cleaned, "domain", "t", [_uc("U1"), _uc("U2")]) == {"U1": "Sales"}


def test_assignment_drops_a_final_row_cut_inside_its_value(agent_ns):
    obj = _inspire(agent_ns)
    response = 'use_case_id,domain\nU1,Sales\nU2,"Reven'
    assert obj._parse_assignment_csv(response, "domain", "t", [_uc("U1"), _uc("U2")]) == {"U1": "Sales"}


def test_honesty_columns_that_are_not_trailing_are_removed_by_position(agent_ns):
    strip = agent_ns["CSVParser"].strip_honesty
    assert strip(["90", "ok", "U1", "Sales"], 4, 0, 1) == ["U1", "Sales"]
    assert strip(["90", "ok", "U1"], 4, 0, 1) == ["U1"]
    assert strip(["U1", "90", "Sales"], 3, 1, None) == ["U1", "Sales"]


def test_an_answer_cut_inside_a_quoted_field_is_not_rewritten_closed(agent_ns):
    raw = 'use_case_id,domain,honesty_score,honesty_justification\nU1,Sales,90,ok\nU2,Ops,90,"cut inside the justif'
    score, _just, cleaned = agent_ns["extract_honesty_score"](raw)
    assert score == 90 and cleaned == raw
    assert _inspire(agent_ns)._parse_assignment_csv(cleaned, "domain", "t", [_uc("U1"), _uc("U2")]) == {
        "U1": "Sales", "U2": "Ops"}


class _ShiftingUserDomainAgent(_ClusterAgent):
    def _call_ai_query(self, prompt, prompt_name, response_schema=None, **kw):
        with self._lock:
            self.calls.append({"path": prompt_name, "skip_cache": kw.get("skip_cache", False), "prompt": prompt})
        ids = re.findall(r"^(U\d+),", prompt, re.M)
        rows = [f"{i},Sales" if i == "U1" else (f"{i},Ops" if kw.get("skip_cache") else f"Ops,{i}") for i in ids]
        return "use_case_id,domain\n" + "\n".join(rows)


def test_user_domain_row_with_swapped_columns_is_counted_and_retried(agent_ns, caplog):
    agent = _ShiftingUserDomainAgent(lambda ids, skip: {})
    obj = _user_domain_obj(agent_ns, agent, ["Sales", "Ops"])
    with caplog.at_level(logging.INFO):
        out = obj._assign_to_user_domains([_uc("U1"), _uc("U2")], ["Sales", "Ops"], "English")
    assert {u["No"]: u["Business Domain"] for u in out} == {"U1": "Sales", "U2": "Ops"}
    assert [c["skip_cache"] for c in agent.calls] == [False, True]
    assert "(anchor_shifted=1)" in caplog.text and "[CSV-ROW misaligned] User domain assignment" in caplog.text


def test_goal_filter_row_with_swapped_columns_is_counted_and_retried(agent_ns, caplog):
    def responder(prompt_name, prompt_vars, skip_cache):
        return "\n".join(f"{i},YES" if skip_cache else f"YES,{i}" for i in _goal_ids(prompt_vars))
    obj = _goal_obj(agent_ns, responder)
    with caplog.at_level(logging.INFO):
        out = obj._filter_use_cases_by_goal_alignment([make_uc("U1")])
    assert [u["No"] for u in out] == ["U1"]
    assert [c["skip_cache"] for c in obj.ai_agent.calls] == [False, True]
    assert "[CSV-ROW misaligned] Goal filter" in caplog.text and "(anchor_shifted=1)" in caplog.text


def test_summary_with_swapped_executive_columns_does_not_print_the_label_as_the_summary(docs):
    response = ('"Type","Summary","TransliteratedBusinessName"\n"<p>Acme leads its region.</p>","Executive","Acme"\n'
                '"Sales","<p>Sales converts demand into revenue.</p>",""\n')
    obj = docs_inspire(docs, ai_agent=types.SimpleNamespace(run_worker=lambda *a, **k: response))
    obj._get_generation_instruction_for_prompt = lambda name: ""
    summary, _name = obj._get_salesy_summary({"Sales": [make_uc("N01-U01", "Sales")]}, "Acme", "English", labels(docs))
    assert summary["Executive"] != "Executive" and summary["Executive"].startswith("<p>")
    assert obj.logger.matching("[CSV-ROW misaligned] Domain summary English")


def test_status_payload_counts_only_rows_with_the_header_shape(agent_ns):
    agent = agent_ns["AIAgent"].__new__(agent_ns["AIAgent"])
    rows, total, capped = agent._extract_csv_rows("No,Name,usecase\nN1,Forecast,Forecast Orders\nN2,Short\n"
                                                  "N3,Long,Forecast,extra\n")
    assert [r["No"] for r in rows] == ["N1"] and total == 1 and capped is False


def _batch():
    return [make_uc("N01-U01"), make_uc("N01-U02"), make_uc("N01-U03")]


COMPLETE_BUT_SHORT = {
    "quoted_middle_row_missing": lambda: _translation_csv([_ja_row("N01-U01"), _ja_row("N01-U03")]),
    "stripped_middle_row_missing": lambda: None,
    "middle_row_in_another_column_order": lambda: _translation_csv([
        _ja_row("N01-U01"),
        ["N01-U02", "名前", "見出し", "営業", "計画", "Opportunity", "Forecasting", "", "ステートメント", "解決策", "価値",
         "担当", "役員", "", "", "main.s.sales", "High"],
        _ja_row("N01-U03")]),
    "trailing_prose_line": lambda: _translation_csv([_ja_row("N01-U01"), _ja_row("N01-U03")]) + "All rows translated.\n",
    "rows_out_of_order": lambda: _translation_csv([_ja_row("N01-U03"), _ja_row("N01-U01")]),
}


def _complete_but_short(docs, shape):
    if shape == "stripped_middle_row_missing":
        return docs["extract_honesty_score"](COMPLETE_BUT_SHORT["quoted_middle_row_missing"]())[2]
    return COMPLETE_BUT_SHORT[shape]()


@pytest.mark.parametrize("shape", sorted(COMPLETE_BUT_SHORT))
def test_a_complete_answer_that_lacks_a_row_is_not_called_truncated(docs, shape):
    service = _service(docs)
    rows = service._parse_translation_csv(_complete_but_short(docs, shape), _batch(), 1, "Japanese")
    assert rows == []
    assert service.logger.matching("Missing translations for IDs: ['N01-U02']")
    assert not service.logger.matching("TRUNCATED")


CUT_OFF = {
    "open_quoted_field": '"N01-U03","名前","営業","計',
    "final_row_stops_at_a_field_boundary": '"N01-U03","名前","営業",',
    "final_row_cut_inside_its_id": "N01-U0",
    "closing_row_never_started": "",
}


@pytest.mark.parametrize("shape", sorted(CUT_OFF))
def test_a_cut_off_answer_is_called_truncated(docs, shape):
    service = _service(docs)
    response = _translation_csv([_ja_row("N01-U01"), _ja_row("N01-U02")]) + CUT_OFF[shape]
    with pytest.raises(ValueError, match="TRUNCATED"):
        service._parse_translation_csv(response, _batch(), 1, "Japanese")


def _translator(docs, respond):
    ts = docs["TranslationService"]
    calls = []

    def run_worker(step_name, worker_prompt_path, prompt_vars, response_schema=None, skip_cache=False, **kw):
        ids = [item["No"] for item in json.loads(prompt_vars["json_payload"])]
        calls.append((len(ids), skip_cache))
        return respond(ids, len(calls), skip_cache)
    return ts(types.SimpleNamespace(run_worker=run_worker), docs_inspire(docs).logger), calls


def test_a_missing_middle_row_is_recovered_by_re_requesting_only_it(docs):
    def respond(ids, call, skip_cache):
        return _translation_csv([_ja_row(i) for i in ids if skip_cache or i != "N01-U02"])
    service, calls = _translator(docs, respond)
    out = service._translate_batch(_batch(), "Japanese", 0)
    assert calls == [(3, False), (1, True)]
    assert [uc["_translation_status"] for uc in out] == ["translated"] * 3


def test_a_missing_last_row_is_recovered_by_one_re_request_not_a_split(docs):
    def respond(ids, call, skip_cache):
        return _translation_csv([_ja_row(i) for i in ids if skip_cache or i != "N01-U03"])
    service, calls = _translator(docs, respond)
    out = service._translate_batch(_batch(), "Japanese", 0)
    assert calls == [(3, False), (1, True)]
    assert [uc["_translation_status"] for uc in out] == ["translated"] * 3


def test_a_row_missing_on_every_call_is_flagged_after_one_re_request(docs):
    def respond(ids, call, skip_cache):
        return _translation_csv([_ja_row(i) for i in ids if i != "N01-U02"])
    service, calls = _translator(docs, respond)
    out = service._translate_batch(_batch(), "Japanese", 0)
    assert calls == [(3, False), (1, True)]
    assert [uc["No"] for uc in out] == ["N01-U01", "N01-U02", "N01-U03"]
    assert [uc["_translation_status"] for uc in out] == ["translated", "untranslated", "translated"]


def test_a_re_request_that_is_still_incomplete_splits_and_recovers(docs):
    def respond(ids, call, skip_cache):
        return _translation_csv([_ja_row(i) for i in ids if len(ids) == 1 or i not in ("N01-U02", "N01-U03")])
    service, calls = _translator(docs, respond)
    out = service._translate_batch(_batch(), "Japanese", 0)
    assert calls == [(3, False), (2, True), (1, True), (1, True)]
    assert [uc["_translation_status"] for uc in out] == ["translated"] * 3


def test_a_cut_off_answer_re_requests_the_cut_rows_once(docs):
    def respond(ids, call, skip_cache):
        if len(ids) > 1:
            return _translation_csv([_ja_row(i) for i in ids[:2]]) + '"N01-U03","名前","営'
        return _translation_csv([_ja_row(i) for i in ids])
    service, calls = _translator(docs, respond)
    out = service._translate_batch(_batch(), "Japanese", 0)
    assert calls == [(3, False), (1, True)]
    assert [uc["_translation_status"] for uc in out] == ["translated"] * 3


def test_a_cut_off_answer_whose_re_request_is_also_cut_splits(docs):
    def respond(ids, call, skip_cache):
        if len(ids) > 1:
            return _translation_csv([_ja_row(i) for i in ids if i == "N01-U01"]) + '"N01-U02","名前","営'
        return _translation_csv([_ja_row(i) for i in ids])
    service, calls = _translator(docs, respond)
    out = service._translate_batch(_batch(), "Japanese", 0)
    assert calls == [(3, False), (2, True), (1, True), (1, True)]
    assert [uc["_translation_status"] for uc in out] == ["translated"] * 3


def test_an_endpoint_failure_is_retried_once_and_never_split(docs):
    def respond(ids, call, skip_cache):
        raise RuntimeError("endpoint unavailable")
    service, calls = _translator(docs, respond)
    out = service._translate_batch(_batch(), "Japanese", 0)
    assert calls == [(3, False), (3, True)]
    assert [uc["_translation_status"] for uc in out] == ["untranslated"] * 3


GUARD_CALLS = {"aligned_rows", "misaligned_row", "_misaligned_translation_row", "strip_honesty"}
PARSE_CALLS = {"parse_csv_string", "parse_csv_list", "reader", "DictReader"}


def _called(node):
    for sub in ast.walk(node):
        if isinstance(sub, ast.Call):
            func = sub.func
            yield func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", None)


def test_every_llm_csv_parser_runs_the_shared_row_guard():
    parsers, unguarded = [], []
    for cls in agent_ast().body:
        scopes = [(f"{cls.name}.{fn.name}", fn) for fn in getattr(cls, "body", []) if isinstance(fn, ast.FunctionDef)] \
            if isinstance(cls, ast.ClassDef) else [(cls.name, cls)] if isinstance(cls, ast.FunctionDef) else []
        for name, fn in scopes:
            if name.startswith("CSVParser."):
                continue
            called = set(_called(fn))
            if called & PARSE_CALLS:
                parsers.append(name)
                if not called & GUARD_CALLS:
                    unguarded.append(name)
    assert unguarded == []
    assert {"extract_honesty_score", "AIAgent._extract_csv_rows", "TranslationService._parse_translation_rows",
            "DatabricksInspire._assign_to_user_domains", "DatabricksInspire._parse_dedup_response",
            "DatabricksInspire._get_salesy_summary", "DatabricksInspire._parse_assignment_csv",
            "DatabricksInspire._parse_llm_csv_response", "DatabricksInspire._process_filter_batch_recursive"} <= set(parsers)
    goal = ast.unparse(next(fn for cls in agent_ast().body if isinstance(cls, ast.ClassDef) and cls.name == "DatabricksInspire"
                            for fn in cls.body if isinstance(fn, ast.FunctionDef)
                            and fn.name == "_filter_use_cases_by_goal_alignment"))
    assert "CSVParser.aligned_rows(" in goal


def test_the_guard_has_one_implementation():
    src = agent_source()
    assert src.count("def misaligned_row(") == 1 and src.count("def aligned_rows(") == 1
    assert src.count("_HONESTY_SCORE_VALUE = re.compile(") == 1
    assert "last_100_chars" not in src


def _repo_csvs():
    found = []
    for base, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in (".git", "__pycache__", ".pytest_cache")]
        found += [os.path.relpath(os.path.join(base, f), ROOT) for f in files if f.lower().endswith(".csv")]
    return sorted(found)


def _readers_text():
    texts = [agent_source()]
    tests_dir = os.path.join(ROOT, "tests")
    for base, _dirs, files in os.walk(tests_dir):
        texts += [open(os.path.join(base, f), encoding="utf-8").read() for f in files
                  if f.endswith(".py") and f != os.path.basename(__file__)]
    return "\n".join(texts)


def _csvs_read_by_code_or_tests():
    text = _readers_text()
    return [p for p in _repo_csvs() if p.startswith("rules" + os.sep) or os.path.basename(p) in text or p in text]


@pytest.mark.parametrize("path", _csvs_read_by_code_or_tests())
def test_every_rules_csv_and_every_csv_the_code_or_tests_read_has_the_header_field_count(path):
    with open(os.path.join(ROOT, path), encoding="utf-8", newline="") as handle:
        rows = [row for row in csv.reader(handle) if row]
    assert rows, path
    assert [(n, len(row)) for n, row in enumerate(rows[1:], 2) if len(row) != len(rows[0])] == [], path


def test_the_quoted_rules_keep_their_text():
    with open(os.path.join(ROOT, "rules", "inspire-ai-rules.csv"), encoding="utf-8", newline="") as handle:
        rules = {row["rule_id"]: row for row in csv.DictReader(handle)}
    assert rules["R06"]["description"] == ("Full-portfolio signal coverage: date+measure, fact+dim FK, grouping id, "
                                           "status column each must produce >=1 UC.")
    assert rules["R10"]["where_enforced"] == "BASE_USE_CASE_GEN_PROMPT RULE 10"
    assert rules["R11"]["description"].endswith("cohort needs onboarding ts).")
    assert rules["R12"]["source_version"] == "v0.5.0"
    assert rules["R14"]["description"] == ("On 2+-table schemas, >=30% of UCs must span 2+ tables via "
                                           "column-name-inferred joins.")
    assert rules["R14"]["source_version"] == "v0.5.17"
