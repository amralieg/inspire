import importlib.util
import os
import random
import re
import subprocess
import sys
import time

import pytest

from _agentload import agent_source

SHELL_REDACT = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                            "agent", "app_shell", "server", "shell_redact.py")
LIMIT_SECONDS = 1.0
SIZE = 200000


def _redact():
    spec = importlib.util.spec_from_file_location("v234_shell_redact", SHELL_REDACT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _old_in_text(value, text):
    return bool(re.search(rf"(?<!\w){re.escape(value)}(?!\w)", text))


@pytest.mark.parametrize("arguments,refusal", [("", "cannot configure default credentials"), ("profile='DEFAULT'", "has no DEFAULT profile")])
def test_no_test_can_read_a_real_databricks_config_or_credentials(arguments, refusal):
    path = os.environ["DATABRICKS_CONFIG_FILE"]
    assert path != os.path.expanduser("~/.databrickscfg") and os.path.getsize(path) == 0
    assert [name for name in os.environ if name.startswith("DATABRICKS_")] == ["DATABRICKS_CONFIG_FILE"]
    made = subprocess.run([sys.executable, "-c", f"from databricks.sdk import WorkspaceClient\nWorkspaceClient({arguments})"],
                          env=dict(os.environ), capture_output=True, text=True, timeout=120)
    assert made.returncode != 0 and refusal in made.stderr, made.stderr[-2000:]


def test_many_redactions_against_the_same_large_known_text_index_it_once():
    redact = _redact()
    known = "\n".join(f"word{i} 'phrase {i}' text" for i in range(150000))
    redact.inspire_redact_text("warm", set(), known)
    began = time.perf_counter()
    for i in range(200):
        redact.inspire_redact_text(f"Traceback: File \"x{i}.py\", line 1\nValueError: 'value {i}' and 'word{i}'", set(), known)
    assert time.perf_counter() - began < LIMIT_SECONDS


def test_the_redaction_the_agent_runs_is_the_one_the_app_shell_runs():
    source = agent_source()
    start = source.index("REDACT_SOURCE = r'''") + len("REDACT_SOURCE = r'''")
    assert source[start:source.index("'''", start)] == open(SHELL_REDACT, encoding="utf-8").read()


@pytest.mark.parametrize("shape", [
    "".join(f"'v{i}' " for i in range(SIZE)),
    "".join(f'"v{i}" ' for i in range(SIZE)),
    "does not have " * SIZE,
    "User 'a' does not have " + "A" * SIZE,
    "a" * SIZE,
    "'" + "a b " * SIZE,
    "[CAST_INVALID_INPUT] The value 'x' of the type " * SIZE,
])
def test_redaction_of_a_200k_character_text_takes_under_a_second(shape):
    redact = _redact()
    known = "\n".join(f"word{i} 'phrase {i}' text" for i in range(40000))
    redact.inspire_redact_text("warm", set(), known)
    began = time.perf_counter()
    redact.inspire_redact_text(shape[:SIZE], {"v7", "secret-value"}, known)
    assert time.perf_counter() - began < LIMIT_SECONDS


def test_a_known_word_check_matches_the_word_bounded_search_it_replaces():
    redact = _redact()
    chooser = random.Random(234)
    alphabet = "ab _.-'é1"
    for _ in range(3000):
        text = "".join(chooser.choice(alphabet) for _ in range(chooser.randint(0, 30)))
        value = "".join(chooser.choice(alphabet) for _ in range(chooser.randint(0, 5)))
        index = redact._redact_word_index(text)
        assert redact._redact_in_text(value, text, index) == _old_in_text(value, text), (value, text)
        assert redact._redact_in_text(value, text) == _old_in_text(value, text), (value, text)


def test_a_value_inside_a_longer_word_is_not_known_but_a_bounded_one_is():
    redact = _redact()
    known = "the orders_v2 table, and 'Acme Corp' too"
    index = redact._redact_word_index(known)
    assert redact._redact_in_text("orders_v2", known, index) and redact._redact_in_text("Acme Corp", known, index)
    assert not redact._redact_in_text("orders", known, index) and not redact._redact_in_text("cme Corp", known, index)
    assert not redact._redact_in_text("Acme Cor", known, index)


def test_a_write_conflict_retry_waits_through_the_sleeper_it_is_given(agent_ns):
    calls, waits = [], []

    def write():
        calls.append(1)
        if len(calls) < 3:
            raise RuntimeError("[DELTA_CONCURRENT_APPEND] ConcurrentAppendException: files were added by a concurrent update")
        return "written"

    began = time.perf_counter()
    assert agent_ns["inspire_retry_write_conflicts"](write, "the test row", sleep=waits.append) == "written"
    assert len(calls) == 3 and len(waits) == 2 and all(0.5 <= w <= 2.0 for w in waits[:1]) and waits[1] >= 1.0
    assert time.perf_counter() - began < LIMIT_SECONDS
