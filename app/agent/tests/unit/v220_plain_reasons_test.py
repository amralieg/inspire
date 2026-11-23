import re

import pytest

CODE = re.compile(r"\b(?:Q\d_[RT]\d+_[A-Z_]+|[DQ]\d{1,2}|score:[a-z_]+|[RT]\d+_[A-Z_]+)\b|\((?:red_team|judge_verdict|value_tier|verification)\)")

Q_CODES = [
    "Q5_T4_NO_OWNER", "Q5_T4_NO_MEASURABLE_OUTCOME", "Q5_T4_ONE_OFF", "Q5_T4_TOO_FEW_ITEMS:5<20", "Q5_T4_NO_PER_ITEM_ACTION",
    "Q5_T2_RESTATES_COLUMN:is_late", "Q5_T3_REBUILDS_OUTPUT:churn_score", "Q5_R19_GENERIC_TITLE", "Q5_R20_NAME_STYLE:verb",
    "Q5_R18_TECHNIQUE_LABEL_DRIFT:forecasting", "Q3_R20_EMPTY_PRIMARY_TABLE:main.s.orders", "Q3_R4_JOIN_PATH_UNEXECUTABLE",
    "Q3_R7_BV_UNGROUNDED_QUANTITIES:3", "Q3_R9_SIMULATED_INPUT:monte_carlo", "Q3_R11_COHORT_BIOGRAPHICAL_ANCHOR",
    "Q3_R22_KEY_SIGNAL_EMPTY:amount=0", "Q3_R24_SINGLE_CLASS_LABEL:yes", "Q3_R14_DATA_FIT_SCALE:R14_NO_EVENT_LOG",
    "Q3_R5_REFERENCE_AS_FACT", "Q3_R8_TARGET_LEAKAGE:churned", "Q3_R23_THIN_TIME_COVERAGE:20_days", "Q9_SOMETHING_NEW",
]


@pytest.mark.parametrize("code", Q_CODES)
def test_a_below_bar_reason_never_shows_an_internal_code(agent_ns, code):
    text = agent_ns["DatabricksInspire"]._below_bar_gate_text(code[:2], code)
    assert text and not CODE.search(text), text


def test_each_decision_readiness_miss_reads_as_its_own_plain_reason(agent_ns):
    text = agent_ns["DatabricksInspire"]._below_bar_gate_text
    assert text("Q5", "Q5_T4_NO_MEASURABLE_OUTCOME") == "it names no measurable outcome it would move; decision readiness check"
    assert text("Q5", "Q5_T4_ONE_OFF") == "it answers a one-off question, not a decision made again and again; decision readiness check"
    assert text("Q5", "Q5_T4_TOO_FEW_ITEMS:5<20") == "it leaves too few items to act on each cycle (5<20); decision readiness check"
    assert text("Q5", "Q5_T2_RESTATES_COLUMN:is_late") == "the answer it promises is already in a column (is late); decision readiness check"


def test_a_name_style_flag_is_not_read_as_an_empty_table(agent_ns):
    cls = agent_ns["DatabricksInspire"]
    assert cls._below_bar_gate_text("Q5", "Q5_R20_NAME_STYLE:verb") == "its name does not follow the naming rules; decision readiness check"
    assert "has no rows" in cls._below_bar_gate_text("Q3", "Q3_R20_EMPTY_PRIMARY_TABLE:main.s.orders")


def test_an_unknown_code_falls_back_to_the_check_name_without_the_code(agent_ns):
    assert agent_ns["DatabricksInspire"]._below_bar_gate_text("Q5", "Q5_T9_BRAND_NEW") == "failed the decision readiness check"


def test_the_kind_floor_reason_names_gates_and_flags_in_plain_words(agent_ns):
    cls = agent_ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    rt = {"kind_floor_min_value": 3}
    veto = obj._kind_floor_bar_miss({"bob_hard_veto_gate": "D9"}, 5.0, rt)
    assert veto == "hard veto on gate Analytical Depth"
    unverified = obj._kind_floor_bar_miss({"gate_unverified": ["D3", "D7"]}, 5.0, rt)
    assert unverified == "gate unverified (Data Granularity, Design-Schema Match)"
    flagged = obj._kind_floor_bar_miss({"gate_flags": ["Q3_R22_MOSTLY_NULL_SIGNAL:amount", "Q5_R19_GENERIC_TITLE", "Q7_ZZ"]}, 5.0, rt)
    assert flagged == "flagged: a column it needs is mostly empty (amount); its title is too generic to name a decision; a quality check flagged it"
    for text in (veto, unverified, flagged):
        assert not CODE.search(text), text
