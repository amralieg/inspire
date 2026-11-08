import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from _agentload import agent_source  # noqa: E402

FLAG = re.compile(r"""_add_gate_flag\(\w+, f?"([^"]+)"\)""")


def _emitted_flags():
    return sorted({re.sub(r"\{[^}]*\}", "sample_value", flag) for flag in FLAG.findall(agent_source())})


def test_every_gate_flag_the_agent_emits_is_found():
    flags = _emitted_flags()
    assert len(flags) >= 10 and "Q5_D5_COMPANION_DATA:sample_value" in flags, flags


def test_every_gate_flag_the_agent_emits_reads_as_plain_words(agent_ns):
    text = agent_ns["DatabricksInspire"]._gate_code_text
    missing = [flag for flag in _emitted_flags() if not text(flag)]
    assert missing == [], missing


def test_a_kind_flag_names_the_kind_in_plain_words(agent_ns):
    text = agent_ns["DatabricksInspire"]._gate_code_text
    assert text("Q5_D5_COMPANION_DATA:process_mining") == "its kind (process mining) needs data its tables do not have"
    assert text("Q5_D5_KIND_TECHNIQUE_MISMATCH:forecasting") == "its technique is not one its kind (forecasting) uses"


def test_an_unknown_flag_still_reads_as_nothing(agent_ns):
    assert agent_ns["DatabricksInspire"]._gate_code_text("Q7_ZZ_UNKNOWN") == ""
