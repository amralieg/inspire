"""v1.4.0 use-case kinds: the "Kinds this data supports" checklist in the generation prompt and the `Use Case Kind` column.

The checklist lists only the kinds detected on the batch's tables, never a kind the user excluded, and always a kind the
user asked for. It is a checklist, not a quota. The parser reads `Use Case Kind` as an id or a label and takes the kind
from the technique when the value is missing or unknown; a reply without the column still parses.
"""
import logging
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _agentload import method_node, agent_source  # noqa: E402
from v120_funnel_integrity_test import HEADER, _gen_harness, make_inspire  # noqa: E402

KIND_HEADER = HEADER + ',"Use Case Kind"'
HONESTY = ',"honesty_score","honesty_justification"'


def meta(**tables):
    return {f"c.s.{name}": {"columns": {col: {"type": dtype, "comment": ""} for col, dtype in cols.items()}}
            for name, cols in tables.items()}


SALES = {"order_id": "BIGINT", "order_date": "DATE", "quantity": "INT", "net_amount": "DECIMAL(12,2)"}
TICKETS = {"ticket_id": "BIGINT", "notes": "STRING"}


def inspire(ns, metadata=None, graph=None, parsed=None):
    obj = make_inspire(ns, parsed_generation_instructions=parsed or {})
    obj.logger = logging.getLogger("v200_kinds_prompt")
    metadata = metadata if metadata is not None else meta(sales=SALES, tickets=TICKETS)
    obj._kind_metadata, obj._kind_fk_graph, obj._kind_llm_roles = metadata, graph or {}, {}
    obj.detected_kinds = obj.detect_supported_kinds(metadata, graph or {}, {}, log=False)
    return obj


def kind_lines(section):
    return {re.match(r"- `([a-z_]+)`", line).group(1): line for line in section.splitlines() if line.startswith("- `")}


def test_checklist_lists_only_the_detected_kinds_with_their_evidence_columns(agent_ns):
    obj = inspire(agent_ns)
    detected = {k["kind"] for k in obj.detected_kinds}
    lines = kind_lines(obj._kinds_checklist_section())
    assert "forecast" in detected and set(lines) == detected
    assert "process_mining" not in lines and "location_intelligence" not in lines
    assert "`sales` (" in lines["forecast"] and "order_date" in lines["forecast"] and "quantity" in lines["forecast"]


def test_checklist_wording_is_a_checklist_not_a_quota(agent_ns):
    section = inspire(agent_ns)._kinds_checklist_section()
    assert section.startswith("##### 1c. Kinds this data supports (a checklist, not a quota)\n")
    for phrase in ("skipping is a correct answer", "Never weaken a use case to fit a kind",
                   "a user directive always wins over this list", "`Use Case Kind` column"):
        assert phrase in section, phrase
    for phrase in ("at least one", "MUST propose", "every kind", "one per kind"):
        assert phrase not in section, phrase


def test_an_excluded_kind_is_never_listed_and_the_rest_stay(agent_ns):
    kept = kind_lines(inspire(agent_ns)._kinds_checklist_section())
    excluded = kind_lines(inspire(agent_ns, parsed={"use_case_kinds": {"asked": [], "excluded": ["Forecast"]}})._kinds_checklist_section())
    assert "forecast" in kept and "forecast" not in excluded
    assert set(kept) - {"forecast"} == set(excluded)


def test_a_kind_the_user_asked_for_is_listed_even_when_no_column_shows_it(agent_ns):
    parsed = {"use_case_kinds": {"asked": ["process_mining", "forecast"], "excluded": []}}
    lines = kind_lines(inspire(agent_ns, parsed=parsed)._kinds_checklist_section())
    assert "the user asked for this kind; no column shows its signal" in lines["process_mining"]
    assert lines["forecast"].endswith("(the user asked for this kind)") and "`sales` (" in lines["forecast"]


def test_an_exclusion_wins_over_a_request_for_the_same_kind(agent_ns):
    parsed = {"use_case_kinds": {"asked": ["forecast"], "excluded": ["forecast"]}}
    assert "forecast" not in kind_lines(inspire(agent_ns, parsed=parsed)._kinds_checklist_section())


def test_no_detected_or_requested_kind_leaves_the_block_out(agent_ns):
    obj = inspire(agent_ns, metadata=meta(lookup={"code": "STRING"}))
    assert obj.detected_kinds == [] and obj._kinds_checklist_section() == ""
    bare = make_inspire(agent_ns)
    assert bare._kinds_checklist_section(["c.s.x"]) == ""


def test_the_batch_tables_limit_the_checklist(agent_ns):
    obj = inspire(agent_ns)
    assert "forecast" in kind_lines(obj._kinds_checklist_section(["c.s.sales"]))
    only_tickets = kind_lines(obj._kinds_checklist_section(["C.S.TICKETS"]))
    assert "forecast" not in only_tickets and all("`sales`" not in line for line in only_tickets.values())


def test_generation_sends_the_checklist_for_the_batch_tables_after_the_preamble(agent_ns):
    obj = _gen_harness(agent_ns, [HEADER + "\n" + '"N1-1","Forecast orders","Forecast orders","Risk","Forecasting","S","M","V","Ops","COO","c.s.orders","A"'])
    obj._kind_metadata = meta(orders=SALES)
    obj._kind_fk_graph, obj._kind_llm_roles = {}, {}
    assert "anomaly" in {k["kind"] for k in obj.detect_supported_kinds(obj._kind_metadata, {}, {}, log=False)}
    obj.parsed_generation_instructions = {"use_case_kinds": {"asked": [], "excluded": ["anomaly"]}}
    obj._process_batch_with_retry([("c", "s", "orders", "order_date", "date", "")], 1, max_attempts=1)
    sent = obj.ai_agent.calls[0]["vars"]["kinds_checklist_section"]
    assert "`forecast` Forecast: `orders` (" in sent and "`anomaly`" not in sent
    AIAgent = agent_ns["AIAgent"]
    agent = AIAgent.__new__(AIAgent)
    agent.logger = obj.logger
    agent.prompt_templates = dict(agent_ns["PROMPT_TEMPLATES"])
    rendered = agent._load_and_format_prompt("BASE_USE_CASE_GEN_PROMPT", obj.ai_agent.calls[0]["vars"])
    assert rendered.startswith(agent_ns["USER_DIRECTIVE_SUPREMACY_PREAMBLE"])
    assert rendered.index("##### 1b.") < rendered.index("##### 1c. Kinds this data supports") < rendered.index("### 4. CSV ROW PATTERN")


def test_the_size_check_counts_the_checklist():
    src = "\n".join(agent_source().split("\n")[method_node("DatabricksInspire", "_process_batch_with_retry").lineno - 1:
                                               method_node("DatabricksInspire", "_process_batch_with_retry").end_lineno])
    assert '"kinds_checklist_section": self._kinds_checklist_section(all_allowed_tables)' in src
    assert 'len(prompt_vars["kinds_checklist_section"])' in src


def test_user_excluded_kinds_reach_the_generation_directives_and_no_other_prompt(agent_ns):
    obj = make_inspire(agent_ns, parsed_generation_instructions={"use_case_kinds": {"asked": ["anomaly"], "excluded": ["forecast", "pricing"]},
                                                                 "interpretation_status": "ok"})
    obj.user_generation_instructions = "no forecasting, no pricing"
    base = obj._get_generation_instruction_for_prompt("BASE_USE_CASE_GEN_PROMPT")
    assert "- EXCLUDED USE CASE KINDS (never propose a use case of these kinds): forecast; pricing" in base
    assert "EXCLUDED USE CASE KINDS" not in obj._get_generation_instruction_for_prompt("SUMMARY_GEN_PROMPT")
    obj.parsed_generation_instructions = {"use_case_kinds": {"asked": ["anomaly"], "excluded": []}, "interpretation_status": "ok"}
    assert "EXCLUDED USE CASE KINDS" not in obj._get_generation_instruction_for_prompt("BASE_USE_CASE_GEN_PROMPT")


def _row(no, technique, kind=None, honesty=False):
    cells = [no, f"Plan orders {no}", "Plan orders", "Risk", technique, "S", "M", "V", "Ops", "COO", "c.s.orders", "A"]
    cells += [] if kind is None else [kind]
    cells += ["82", "honest"] if honesty else []
    return ",".join(f'"{cell}"' for cell in cells)


def _parse(ns, text):
    obj = make_inspire(ns, global_table_names={"c.s.orders"})
    return obj._parse_llm_csv_response(text, "[t]")


def test_the_parser_reads_a_kind_id_and_a_kind_label(agent_ns):
    rows = _parse(agent_ns, KIND_HEADER + HONESTY + "\n" + _row("N1-1", "Forecasting", "forecast", True) + "\n"
                  + _row("N1-2", "Classification", "Risk or propensity", True) + "\n" + _row("N1-3", "Classification", "`Anomaly`", True))
    assert [r["Use Case Kind"] for r in rows] == ["forecast", "risk_propensity", "anomaly"]


def test_an_unknown_or_missing_kind_comes_from_the_technique(agent_ns):
    rows = _parse(agent_ns, KIND_HEADER + "\n" + _row("N1-1", "Forecasting", "weather magic") + "\n"
                  + _row("N1-2", "Anomaly Detection", "") + "\n" + _row("N1-3", "Heuristic Scoring", "nonsense"))
    assert [r["Use Case Kind"] for r in rows] == ["forecast", "anomaly", ""]


def test_a_reply_without_the_kind_column_still_parses_with_the_kind_from_the_technique(agent_ns):
    rows = _parse(agent_ns, HEADER + HONESTY + "\n" + _row("N1-1", "Forecasting", None, True) + "\n" + _row("N1-2", "Clustering", None, True))
    assert [(r["No"], r["Use Case Kind"]) for r in rows] == [("N1-1", "forecast"), ("N1-2", "segmentation")]


def test_a_row_that_skips_the_kind_value_keeps_its_honesty_columns(agent_ns):
    obj = make_inspire(agent_ns)
    row = dict(zip(["High Level Design", "Use Case Kind", "honesty_score", "honesty_justification"], ["A", "82", "honest", None]))
    assert obj._shift_skipped_kind(row) is True
    assert row == {"High Level Design": "A", "Use Case Kind": "", "honesty_score": "82", "honesty_justification": "honest"}
    aligned = dict(zip(["High Level Design", "Use Case Kind", "honesty_score", "honesty_justification"], ["A", "forecast", "82", "honest"]))
    assert obj._shift_skipped_kind(dict(aligned)) is False
    short = _row("N1-1", "Forecasting", None, True)
    rows = _parse(agent_ns, KIND_HEADER + HONESTY + "\n" + short)
    assert [(r["No"], r["Use Case Kind"]) for r in rows] == [("N1-1", "forecast")]


def test_a_renamed_kind_header_is_remapped_and_read(agent_ns):
    renamed = HEADER.replace('"Statement"', '"Problem"') + ',"Kind"' + HONESTY
    rows = _parse(agent_ns, renamed + "\n" + _row("N1-1", "Classification", "segmentation", True))
    assert [r["Use Case Kind"] for r in rows] == ["segmentation"]


def test_the_parser_logs_where_each_kind_came_from(agent_ns, caplog):
    with caplog.at_level(logging.INFO):
        _parse(agent_ns, KIND_HEADER + "\n" + _row("N1-1", "Forecasting", "forecast") + "\n" + _row("N1-2", "Clustering", "")
               + "\n" + _row("N1-3", "Heuristic Scoring", ""))
    assert any("[KIND-PARSE FIRED] [t] 3 use cases: 1 with the kind written, 1 with the kind taken from the technique, "
               "1 without a kind" in r.getMessage() for r in caplog.records)


def test_a_failing_checklist_leaves_the_block_out_and_never_stops_generation(agent_ns, caplog):
    obj = inspire(agent_ns)

    def broken(*args, **kwargs):
        raise ValueError("bad metadata")
    obj.detect_supported_kinds = broken
    with caplog.at_level(logging.WARNING):
        assert obj._kinds_checklist_section(["c.s.sales"]) == ""
    assert any("[KIND-DETECT FIRED] the kind checklist is left out of this prompt" in r.getMessage() for r in caplog.records)
    assert "forecast" in kind_lines(obj._kinds_checklist_section())


def test_a_missing_kind_registry_keeps_every_parsed_row(agent_ns, monkeypatch):
    monkeypatch.setitem(agent_ns, "_INSPIRE_KINDS_REGISTRY", None)
    monkeypatch.setitem(agent_ns["_INSPIRE_NOTEBOOK_ASSET_TEXT"], "kinds", "{}")
    rows = _parse(agent_ns, KIND_HEADER + "\n" + _row("N1-1", "Forecasting", "forecast") + "\n" + _row("N1-2", "Clustering", ""))
    assert [(r["No"], r["Use Case Kind"]) for r in rows] == [("N1-1", ""), ("N1-2", "")]
