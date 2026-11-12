"""REQ-118 gaps (rc14 L5): a swap rewrites the KPI name with the title and statement; the card shows the key-measure note
on a swapped use case only; the key measure is the KPI the generator's picker chooses; a zero-row check that did not run
says so in the log."""
from unittest.mock import MagicMock

from v120_artifacts_support import make_inspire
from v120_docs_design_test import labels, portfolio, summary

SWAPPED_KPI = {"name": "open first-time buyers", "computable": True, "swapped_from": "first-time buyers",
               "filter_column": "customer_segment", "filter_value": "first time buyers"}
NOTE = "measured on first time buyers because first-time buyers has no rows"


def _uc(name="Follow up with first-time buyers", kpis=None, **extra):
    return dict({"No": "N03-U03", "Name": name, "usecase": name, "Statement": "Reach first-time buyers.",
                 "KPIs": kpis or [dict(SWAPPED_KPI)]}, **extra)


def test_a_swap_rewrites_the_kpi_name_with_the_title_and_statement(agent_ns):
    inst = make_inspire(agent_ns)
    uc = _uc()
    inst._apply_measure_swap_text([uc])
    assert uc["Name"] == "Follow up with first time buyers"
    assert uc["Statement"] == "Reach first time buyers."
    assert uc["KPIs"][0]["name"] == "open first time buyers", "the KPI says the measure that is used"


def test_the_card_shows_the_key_measure_note_on_a_swapped_use_case_only(agent_ns):
    inst = make_inspire(agent_ns)
    grouped = portfolio()
    swapped = grouped["Sales"][0]
    swapped.update(_uc(name=swapped.get("Name") or "Follow up with first-time buyers", KPIs=[dict(SWAPPED_KPI)]))
    inst._apply_measure_swap_text([swapped])
    plain = grouped["Sales"][1]
    plain.pop("key_measure_note", None)
    model = inst._document_model("English", labels(agent_ns), summary(), grouped, "Acme")
    shown = inst._use_case_view(swapped, model, labels(agent_ns))
    rows = [fact for fact in shown["facts"] if fact[0] == "key_measure_note"]
    assert len(rows) == 1 and rows[0][2] == NOTE, "the card renders the note as a fact row"
    assert [fact for fact in inst._use_case_view(plain, model, labels(agent_ns))["facts"] if fact[0] == "key_measure_note"] == []


def test_the_key_measure_is_the_kpi_the_generator_picker_chooses_so_a_strategy_linked_kpi_is_the_key(agent_ns):
    inst = make_inspire(agent_ns)
    inst._ai_gate = lambda: MagicMock()
    inst._user_protected_use_cases = lambda use_cases: {}
    linked = _uc(kpis=[{"name": "lapsed passengers", "computable": True},
                       {"name": "open first-time buyers", "computable": False, "kpi_id": "k9",
                        "unmeasurable_reason": "customer_segment = 'first-time buyers' matches no rows and no value close to it has rows"}])
    assert inst._drop_unmeasurable_use_cases([linked]) == [], "the strategy-linked KPI is the key measure, and it has no rows"


def test_the_zero_row_check_says_in_the_log_when_the_kpi_baseline_stage_did_not_run(agent_ns):
    inst = make_inspire(agent_ns)
    inst.deep_evidence = None
    inst.logger = MagicMock()
    inst._measure_kpi_baselines([{"No": "N01-U01", "KPIs": [{"name": "x", "computable": True, "query": "q"}]}])
    warnings = [c.args[0] for c in inst.logger.warning.call_args_list]
    assert any("[KEY-MEASURE CHECK SKIPPED]" in w and "zero-row check did not run" in w for w in warnings), warnings


def test_the_spreadsheet_has_a_key_measure_column_that_holds_the_note_on_a_swapped_use_case_only(agent_ns):
    inst = make_inspire(agent_ns)
    grouped = portfolio()
    swapped = grouped["Sales"][0]
    swapped.update(_uc(name=swapped.get("Name") or "Follow up with first-time buyers", KPIs=[dict(SWAPPED_KPI)]))
    inst._apply_measure_swap_text([swapped])
    columns = {header: get for header, get, _numeric in inst._export_columns(False)}
    assert "Key Measure" in columns
    assert columns["Key Measure"](swapped, 1) == NOTE
    assert columns["Key Measure"](grouped["Sales"][1], 2) == ""


def test_the_key_measure_column_header_is_translated_in_a_non_english_export(agent_ns):
    inst = make_inspire(agent_ns)
    headers = [header for header, _get, _numeric in inst._export_columns(False, False, labels(agent_ns, "Arabic"), "Arabic")]
    assert "المقياس الرئيسي" in headers and "Key Measure" not in headers
