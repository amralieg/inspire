"""FX-87 (REQ-485): a below-bar reason reads as plain words: no underscore, no "=N" list, no gate name."""
import re


def test_the_r22_code_has_no_underscore_equals_or_gate_name(agent_ns):
    text = agent_ns["DatabricksInspire"]._gate_code_text("Q3_R22:arrival_delay_minutes=10,haul_type=10")
    assert text and "_" not in text and "=" not in text and "check" not in text, text
    assert "too few values" in text and "2 columns" in text and "arrival delay minutes" in text, text


def test_the_full_below_bar_reason_does_not_end_with_the_gate_name(agent_ns):
    cls = agent_ns["DatabricksInspire"]
    for gate, code in (("Q3", "Q3_R22:arrival_delay_minutes=10,haul_type=10"), ("Q5", "Q5_T4_ONE_OFF"), ("Q3", "Q3_R19_GENERIC_TITLE")):
        text = cls._below_bar_gate_text(gate, code)
        assert text and not re.search(r"[;:]\s*[a-z ]*check\s*$", text) and "=" not in text and "_" not in text, text
