"""Every refusal or unread sentence keeps table, view and owner ids out of the sentence itself; the ids sit under Details."""
import re

import pytest

ID = re.compile(r"\b[\w`]+\.[\w`]+\.[\w`]+\b")          # catalog.schema.table, backticks allowed
LEAD = re.compile(r"\b(ask|to run:|run:)\b", re.I)        # grants and asks start after this point


def main_sentence(text: str) -> str:
    return LEAD.split(text, maxsplit=1)[0]


def assert_no_ids(text: str):
    assert not ID.search(main_sentence(text)), f"id in the sentence: {main_sentence(text)!r}"


def test_missing_and_unreadable_tables_name_counts_not_ids(agent_ns):
    missing = [{"table": "main.s.orders", "reason": "not found", "primary": True},
               {"table": "main.s.returns", "reason": "not found"}]
    assert_no_ids(agent_ns["implement_missing_tables_message"](missing))
    assert_no_ids(agent_ns["implement_dropped_tables_note"](missing))
    assert_no_ids(agent_ns["implement_dropped_tables_note"](missing[1:]))
    unread = agent_ns["inspire_unreadable_text"](["main.s.orders", "main.s.returns"], "app-x1y2z3 sample-app")
    assert_no_ids(unread)
    assert "2 source tables" in unread


def test_access_gap_and_app_warnings_name_no_ids_or_owners(agent_ns):
    gaps = [{"privilege": "SELECT", "level": "table", "object": "main.s.orders", "owner": "owner@example.com"}]
    assert_no_ids(agent_ns["implement_gap_reason"]("app-x1y2z3 sample-app", gaps))
    assert_no_ids(agent_ns["implement_access_gap_message"]("app-x1y2z3 sample-app", gaps))
    assert_no_ids(agent_ns["implement_app_write_warning"]("the App cannot write", "app-x1y2z3", "reason"))
    unread = {"main.s.orders": {"grants": ["GRANT SELECT ON TABLE `main`.`s`.`orders` TO `app-x1y2z3`"], "owner": "owner@example.com"}}
    warning = agent_ns["implement_app_unread_warning"]("app-x1y2z3", unread)
    assert_no_ids(warning)
    assert "owner@example.com" not in warning


def test_protection_sentences_name_result_and_source_tables_generically(agent_ns):
    protected = {"main.s.orders": "a row filter and a column mask on ssn", "main.s.returns": "a row filter"}
    assert_no_ids(agent_ns["implement_protected_access_refusal"](protected, {"app": True, "app_access": "sp"}))
    refusal = agent_ns["implement_protection_refusal"]({"refuse": [], "unread": [
        "the tables the view reads could not be read", "the view reads views more than 3 deep or reads itself"]})
    assert "main." not in refusal and "the view reads" in refusal


@pytest.mark.parametrize("sentence", [
    "The result table has no column owner, so it cannot keep the row filter main.sec.own_rows of a source table",
    "A source table is guarded by the ABAC policy pii_hide, which does not cover the result table",
])
def test_plan_sentences_keep_function_names_but_no_table_ids(agent_ns, sentence):
    assert_no_ids(sentence.replace("main.sec.own_rows", "own_rows"))
