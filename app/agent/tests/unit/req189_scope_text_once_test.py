"""REQ-189 (FX-68): a use case statement states its table scope once. An LLM-written scope sentence ("This covers only <table> rows where ...")
and the sentence ensure_scope_statements appends ("Covers only the columns ... of <table>.") were both kept, so the statement held the scope and
the column list twice. These tests fail on the base notebook."""
import re
import sys
import os

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v263_table_scope_test import SCOPE_JSON  # noqa: E402


@pytest.fixture
def viewed(agent_ns):
    agent_ns["INSPIRE_TABLE_SCOPES"].clear()
    agent_ns["INSPIRE_TABLE_SCOPES"].update(agent_ns["parse_table_scopes"](SCOPE_JSON, "main.insp"))
    yield agent_ns
    agent_ns["INSPIRE_TABLE_SCOPES"].clear()


def _uc(statement):
    return {"Primary Table": "main.s.orders", "Statement": statement}


def test_a_statement_with_the_model_written_scope_sentence_gets_one_scope_sentence_not_two(viewed):
    uc = _uc("Lift weekly sales. This covers only main.s.orders rows where `status` = gold, using `order_id`, `customer_id`, `order_date`.")
    viewed["ensure_scope_statements"]([uc])
    text = uc["Statement"]
    assert len(re.findall(r"[Cc]overs only", text)) == 1, text
    assert text.count("`order_id`") == 1, text
    assert text.startswith("Lift weekly sales."), text
    assert text.endswith(viewed["scope_sentence"](viewed["INSPIRE_TABLE_SCOPES"]["main.s.orders"])), text


def test_running_the_appender_twice_on_any_statement_changes_nothing_the_second_time(viewed):
    uc = _uc("Lift weekly sales. This covers only the rows of `main.s.orders` where `status` is gold.")
    viewed["ensure_scope_statements"]([uc])
    once = uc["Statement"]
    assert viewed["ensure_scope_statements"]([uc]) == []
    assert uc["Statement"] == once


def test_the_remove_then_append_path_also_leaves_one_scope_sentence(viewed):
    text = "Lift weekly sales. This covers only main.s.orders rows where `status` = gold."
    cleaned = viewed["without_scope_sentences"](text)
    assert cleaned == "Lift weekly sales.", cleaned
