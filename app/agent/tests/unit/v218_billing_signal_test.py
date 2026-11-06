"""A monitor use case's __signal table: Genie is told its grain and that the history before the scored window fills it, the run's
printed reason for skipping a companion table reaches the gate, the repair and the App fallback warning, and numbers are written
with thousands separators, never in Python's 'g' format, offline."""
import json
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SHELL = os.path.join(ROOT, "agent", "app_shell")
SERVER = os.path.join(SHELL, "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_alerts  # noqa: E402
import shell_core  # noqa: E402
import shell_sql  # noqa: E402

with open(os.path.join(SHELL, "kinds.json"), encoding="utf-8") as _handle:
    KINDS = json.load(_handle)

RESULT = "main.s.bills_out"
RUN_ID = "0123abcd-0218-4000-8000-00000000b111"
EXIT_TEXT = (f"wrote 30 rows for as_of_date 2025-06-30 with run_id {RUN_ID}\nPrinted log of this run:\nStep Write: 83.47 seconds\n"
             "The __signal table cannot be filled from this data: fewer than 2 bill months\nStep Companion: 1.23 seconds\n")


@pytest.fixture
def numbers(agent_ns):
    space = {}
    exec(agent_ns["GENIE_NUMBER_TEXT_SOURCE"], space)
    return space


def test_every_companion_table_of_every_kind_tells_genie_what_one_row_is(agent_ns):
    meanings = agent_ns["INSPIRE_COMPANION_MEANINGS"]
    suffixes = {s for contract in KINDS["contracts"].values() for s in (contract.get("suffixes") or {})}
    assert "__signal" in suffixes
    assert sorted(suffixes - set(meanings)) == []
    lines = agent_ns["genie_companion_lines"]({"result_table": RESULT, "companions": agent_ns["inspire_kind_companions"](
        {"use_case_kind": "anomaly"})})
    signal = next(line for line in lines if f"{RESULT}__signal:" in line)
    assert "one row per series per period" in signal and "the history before the scored window included" in signal


def test_a_table_of_periods_is_filled_from_the_history_before_the_scored_window(agent_ns):
    assert agent_ns["INSPIRE_COMPANION_DATA_NEEDS"]["__signal"] == "dates"
    assert "__signal" in agent_ns["INSPIRE_COMPANION_PERIOD_SUFFIXES"] and "__series" in agent_ns["INSPIRE_COMPANION_PERIOD_SUFFIXES"]
    assert "__geo" not in agent_ns["INSPIRE_COMPANION_PERIOD_SUFFIXES"]
    rule = agent_ns["INSPIRE_COMPANION_PERIOD_RULE"]
    assert "a preview run's, is never a reason to skip it" in rule
    assert rule in agent_ns["IMPLEMENT_COMPANION_REPAIR"]


def test_the_threshold_lines_give_the_period_rule_only_to_a_table_of_periods(agent_ns):
    from v130_genie_widgets_test import spec_for
    inst, spec = spec_for(agent_ns, "Anomaly Detection")
    spec = dict(spec, result_table=RESULT, companions={"__signal": ["series", "period", "value"], "__geo": ["lat", "lon"]})
    text = inst._genie_threshold_text(spec)
    signal = next(line for line in text.splitlines() if "companion `__signal`" in line)
    geo = next(line for line in text.splitlines() if "companion `__geo`" in line)
    assert agent_ns["INSPIRE_COMPANION_PERIOD_RULE"] in signal and agent_ns["INSPIRE_COMPANION_PERIOD_RULE"] not in geo
    assert '"The __signal table cannot be filled from this data: <why>"' in signal


def test_the_run_outcome_carries_the_reason_the_run_printed_for_a_skipped_table(agent_ns):
    outcome = agent_ns["parse_use_case_outcome"](EXIT_TEXT)
    assert outcome["status"] == "written" and outcome["run_id"] == RUN_ID
    assert outcome["companion_skips"] == {"__signal": "fewer than 2 bill months"}
    assert "companion_skips" not in agent_ns["parse_use_case_outcome"](EXIT_TEXT.replace("The __signal table cannot", "It cannot"))
    assert agent_ns["inspire_companion_skips"]("The __lift table cannot be filled from this data:   no   outcome column ") == \
        {"__lift": "no outcome column"}
    assert agent_ns["inspire_companion_skips"]("The table cannot be filled from this data: x") == {}


def test_a_missing_companion_names_the_reason_the_run_printed(agent_ns):
    skipped = agent_ns["implement_companion_skipped"]
    missing = {f"{RESULT}__signal": "does not exist", f"{RESULT}__other": "does not exist"}
    got = skipped(missing, RESULT, {"__signal": "fewer than 2 bill months"})
    assert got[f"{RESULT}__signal"] == "does not exist (the run printed: fewer than 2 bill months)"
    assert got[f"{RESULT}__other"] == "does not exist"
    assert skipped(missing, RESULT, None) == missing


def test_the_app_says_plainly_that_the_page_shows_only_the_decision_list_and_why(agent_ns, tmp_path, capsys):
    from v198_kind_layouts_test import _layout_inspire
    warnings = []
    inst = _layout_inspire(agent_ns, tmp_path, {})
    got = inst._implement_app_layout("N01-U01", {"use_case_kind": "anomaly"}, {}, RESULT, warnings, inst._implement_schema_reader(),
                                     {"__signal": "fewer than 2 bill months"})
    assert got == ("decision_queue", {})
    assert len(warnings) == 1 and f"{RESULT}__signal does not exist (the run printed: fewer than 2 bill months)" in warnings[0]
    assert "so the App page shows only the decision list, without the" in warnings[0]
    assert "[APP-LAYOUT FIRED] N01-U01: monitor_triage -> decision_queue, missing=1" in capsys.readouterr().out


def test_the_decision_queue_kind_keeps_its_companion_tables(agent_ns, tmp_path):
    from v198_kind_layouts_test import _layout_inspire
    companions = agent_ns["inspire_kind_companions"]({"Analytics Technique": "Classification"})
    assert set(companions) == {"__score_bins", "__lift"}
    lines = agent_ns["genie_companion_lines"]({"result_table": RESULT, "companions": companions})
    assert any(f"{RESULT}__score_bins:" in line for line in lines) and any(f"{RESULT}__lift:" in line for line in lines)
    warnings = []
    inst = _layout_inspire(agent_ns, tmp_path, {f"{RESULT}__score_bins": ["bin", "count", "cutoff"]})
    got = inst._implement_app_layout("N02-U01", {"Analytics Technique": "Classification"}, {}, RESULT, warnings,
                                     inst._implement_schema_reader(), {"__lift": "no outcome column"})
    assert got == ("decision_queue", {f"{RESULT}__score_bins": ["bin", "count", "cutoff"]}) and warnings == []


@pytest.mark.parametrize("value,text", [
    (1060, "1,060"), (1060.0, "1,060"), (104999, "104,999"), (250000000, "250,000,000"), (-1060, "-1,060"), (0, "0"),
    (1060.4, "1.06K"), (1611.96, "1.61K"), (109.96, "110"), (0.5, "0.5"), (2452642.37, "2.45M"), (float("nan"), "unknown"),
])
def test_fmt_num_writes_a_whole_number_in_full_and_a_decimal_at_three_significant_figures(numbers, value, text):
    assert numbers["fmt_num"](value) == text


def test_fmt_count_and_fmt_rank_group_thousands(numbers):
    assert numbers["fmt_count"](1060, "bill") == "1,060 bills"
    assert numbers["fmt_count"](1, "bill") == "1 bill"
    assert numbers["fmt_rank"](1010) == "1,010th"


def test_the_number_rule_shows_the_whole_number_examples(agent_ns):
    rule = agent_ns["GENIE_NUMBER_FORMAT_RULE"]
    assert "'1,060' for 1060" in rule and "'1.06K' for 1060.4" in rule and "'1.06K' for 1060," not in rule
    assert "1.01Kth" not in rule


def test_the_number_check_lets_a_g_format_parsed_back_to_a_number_pass_and_still_rejects_g_text(agent_ns):
    from v140_implement_test import _number_cells
    check = agent_ns["implement_number_text_problems"]
    assert check(_number_cells(agent_ns, "x = fmt_num(1)\nimpact = impact.map(lambda v: float(f'{v:.6g}'), na_action='ignore')")) == []
    assert any("cell 3 line 2 writes a number with Python's 'g' format" in p
               for p in check(_number_cells(agent_ns, "x = fmt_num(1)\ny = str(float(v)) + f'{v:.3g}'")))
    assert any("cell 3 line 2 writes a number with Python's 'g' format" in p
               for p in check(_number_cells(agent_ns, "x = fmt_num(1)\ny = float(v, f'{v:.3g}')")))


def test_a_percent_range_is_never_written_in_g_format(agent_ns):
    assert agent_ns["_inspire_percent"](12345.678) == "1234567.8"
    assert agent_ns["_inspire_percent"](0.05) == "5"


@pytest.mark.parametrize("value,text", [
    (1060, "1,060"), (1060.0, "1,060"), (1611.96, "1,611.96"), (2452642.37, "2,452,642.37"), (-1060.25, "-1,060.25"),
    (0.5, "0.5"), (0.001234, "0.001234"), (1.23456789e-07, "0.0000001235"), (12345678901234, "12,345,678,901,234"),
])
def test_the_app_shows_a_number_with_thousands_separators_and_no_exponent(value, text):
    assert shell_sql.shown_number(value) == text
    assert shell_core.explain_number(float(value)) == text.replace(",", "")
    assert "e" not in shell_alerts.number_text(value).lower()


def test_the_app_writes_a_decided_plan_line_with_thousands_separators(agent_ns):
    accepted = shell_sql.plan_decision({}, "accept", "", None, 1234567)
    assert accepted["note"] == "Accepted the recommended 1,234,567"
    overridden = shell_sql.plan_decision({}, "override", "Truck slots are short", 1060, 1611.96)
    assert overridden["note"] == "Override to 1,060 instead of 1,611.96: Truck slots are short"


def test_an_alert_threshold_is_shown_grouped(agent_ns):
    assert shell_alerts.number_text(1060) == "1,060" and shell_alerts.number_text(None) == "no value"
