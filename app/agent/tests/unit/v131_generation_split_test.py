"""An empty use case generation answer is resent once at the same size, then split into two requests that together
cover the same tables, down to one table or one user-joined group, which gives up with exactly one ERROR.

Before: `_process_batch_with_retry` resent the same request at the same size on every attempt when the model
returned an empty answer, so a batch too large for the model's output budget stayed empty and added no use case.
"""
import logging
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v120_funnel_integrity_test import HEADER, _gen_harness, _gen_row  # noqa: E402
from v120_genie_support import FakeAgent, FakeLoader, build_inspire, make_uc  # noqa: E402
from v120_genie_generation_test import GOOD, _generate  # noqa: E402

TX = ["orders", "payments", "returns", "shipments"]
CATEGORIES = dict({f"c.s.{t}": "TRANSACTIONAL" for t in TX}, **{"c.s.region": "REFERENCE"})
COLS = [("c", "s", t, f"{t}_id", "bigint", "") for t in TX] + [("c", "s", "region", "region_id", "bigint", "")]


def _tables(call):
    return re.findall(r"^\| (\w+) \| ", call["vars"]["schema_markdown"], flags=re.M)


def _subjects(call):
    return [t for t in _tables(call) if t in TX]


def _answer(tables):
    return HEADER + "\n" + "\n".join(_gen_row(f"N1-{i + 1}", f"c.s.{t}") for i, t in enumerate(tables))


def _harness(agent_ns, respond, **attrs):
    obj = _gen_harness(agent_ns, [])
    obj.data_category_map = dict(CATEGORIES)
    obj.global_table_names = set(CATEGORIES)
    obj._business_column_details_global = list(COLS)
    for key, value in attrs.items():
        setattr(obj, key, value)
    obj.ai_agent.responder = lambda name, prompt_vars, skip_cache: respond(
        [t for t in re.findall(r"^\| (\w+) \| ", prompt_vars["schema_markdown"], flags=re.M) if t in TX])
    return obj


def _errors(caplog):
    return [r.getMessage() for r in caplog.records if r.levelno >= logging.ERROR]


def test_an_empty_answer_is_resent_once_at_the_same_size_and_not_split(agent_ns, caplog):
    seen = []

    def respond(subjects):
        seen.append(subjects)
        return "" if len(seen) == 1 else _answer(subjects)
    obj = _harness(agent_ns, respond)
    with caplog.at_level(logging.WARNING):
        out = obj._process_batch_with_retry(COLS, 1, max_attempts=3)
    assert seen == [TX, TX]
    assert [c["skip_cache"] for c in obj.ai_agent.calls] == [False, True]
    assert sorted(r["Tables Involved"] for r in out) == sorted(f"c.s.{t}" for t in TX)
    assert obj.processing_honesty["total_batch_splits"] == 0
    assert not any("EMPTY-ANSWER SPLIT FIRED" in r.getMessage() for r in caplog.records)
    assert _errors(caplog) == []


def test_two_empty_answers_split_into_halves_that_together_ask_for_the_same_tables(agent_ns, caplog):
    def respond(subjects):
        return "" if len(subjects) > 2 else _answer(subjects)
    obj = _harness(agent_ns, respond)
    with caplog.at_level(logging.WARNING):
        out = obj._process_batch_with_retry(COLS, 1, max_attempts=3)
    calls = obj.ai_agent.calls
    assert [_subjects(c) for c in calls[:2]] == [TX, TX]
    halves = [_subjects(c) for c in calls[2:]]
    assert len(halves) == 2
    assert halves[0] + halves[1] == TX
    assert not set(halves[0]) & set(halves[1])
    assert sum(len(h) for h in halves) == len(_subjects(calls[0]))
    assert all("region" in _tables(c) for c in calls)
    assert [c["step"] for c in calls[2:]] == ["Batch_1_H1", "Batch_1_H2"]
    for key in ("additional_context_section", "previous_use_cases_feedback", "generation_instructions_section",
                "focus_areas_instruction", "business_context"):
        assert len({c["vars"][key] for c in calls}) == 1, key
    assert sorted(r["Tables Involved"] for r in out) == sorted(f"c.s.{t}" for t in TX)
    assert len({r["No"] for r in out}) == len(out) == len(TX)
    assert obj.processing_honesty["total_batch_splits"] == 1
    assert obj.processing_honesty["batch_split_history"][0]["reason"] == "Empty LLM answer"
    assert sum("EMPTY-ANSWER SPLIT FIRED" in r.getMessage() for r in caplog.records) == 1
    assert _errors(caplog) == []


def test_every_retry_and_every_split_request_bypasses_the_llm_cache(agent_ns):
    def respond(subjects):
        return "" if len(subjects) > 1 else _answer(subjects)
    obj = _harness(agent_ns, respond)
    out = obj._process_batch_with_retry(COLS, 1, max_attempts=3)
    skips = [c["skip_cache"] for c in obj.ai_agent.calls]
    assert skips[0] is False and all(skips[1:])
    assert sorted(r["Tables Involved"] for r in out) == sorted(f"c.s.{t}" for t in TX)
    assert sorted(tuple(_subjects(c)) for c in obj.ai_agent.calls if len(_subjects(c)) == 1) == [(t,) for t in sorted(TX)]


def test_a_single_table_that_stays_empty_logs_exactly_one_error_naming_the_call(agent_ns, caplog):
    obj = _harness(agent_ns, lambda subjects: "")
    with caplog.at_level(logging.WARNING):
        out = obj._process_batch_with_retry([COLS[0], COLS[-1]], "P1_7", max_attempts=3)
    assert out == []
    assert len(obj.ai_agent.calls) == 2
    errors = _errors(caplog)
    assert len(errors) == 1
    assert errors[0].startswith("Use case generation [Batch P1_7] for c.s.orders, c.s.region: the model returned an empty answer 2 times")
    assert obj.processing_honesty["total_batch_splits"] == 0


def test_each_leaf_that_stays_empty_logs_one_error_and_the_others_keep_their_use_cases(agent_ns, caplog):
    def respond(subjects):
        return "" if len(subjects) > 1 or subjects == ["returns"] else _answer(subjects)
    obj = _harness(agent_ns, respond)
    with caplog.at_level(logging.WARNING):
        out = obj._process_batch_with_retry(COLS, 1, max_attempts=3)
    assert sorted(r["Tables Involved"] for r in out) == ["c.s.orders", "c.s.payments", "c.s.shipments"]
    errors = _errors(caplog)
    assert len(errors) == 1 and "[Batch 1_H2_H1] for c.s.region, c.s.returns" in errors[0]


def test_a_retry_budget_of_one_attempt_still_splits_instead_of_giving_up(agent_ns, caplog):
    def respond(subjects):
        return "" if len(subjects) > 2 else _answer(subjects)
    obj = _harness(agent_ns, respond)
    with caplog.at_level(logging.WARNING):
        out = obj._process_batch_with_retry(COLS, 1, max_attempts=1)
    assert [_subjects(c) for c in obj.ai_agent.calls] == [TX, TX[:2], TX[2:]]
    assert len(out) == len(TX)
    assert _errors(caplog) == []


def test_user_joined_tables_stay_in_one_request_when_the_request_is_split(agent_ns):
    joins = {"table_joins": [{"left_table": "C.S.Orders", "right_table": "c.s.returns", "join_columns": ["order_id"]}]}

    def respond(subjects):
        return "" if len(subjects) > 2 else _answer(subjects)
    obj = _harness(agent_ns, respond, parsed_generation_instructions=joins)
    out = obj._process_batch_with_retry(COLS, 1, max_attempts=3)
    halves = [_subjects(c) for c in obj.ai_agent.calls[2:]]
    assert halves == [["orders", "returns"], ["payments", "shipments"]]
    assert len(out) == len(TX)


def test_one_user_joined_group_is_the_smallest_request_and_is_never_split(agent_ns, caplog):
    joins = {"table_joins": [{"left_table": "c.s.orders", "right_table": "c.s.payments"}]}
    obj = _harness(agent_ns, lambda subjects: "", parsed_generation_instructions=joins)
    with caplog.at_level(logging.WARNING):
        out = obj._process_batch_with_retry([COLS[0], COLS[1]], 2, max_attempts=3)
    assert out == []
    assert [_subjects(c) for c in obj.ai_agent.calls] == [["orders", "payments"]] * 2
    assert len(_errors(caplog)) == 1


def test_context_tables_are_never_split_off_as_a_request_of_their_own(agent_ns):
    obj = _gen_harness(agent_ns, [])
    obj.data_category_map = dict(CATEGORIES)
    halves = obj._split_generation_request(COLS)
    assert [[c[2] for c in h] for h in halves] == [["orders", "payments", "region"], ["returns", "shipments", "region"]]
    assert obj._split_generation_request([COLS[0], COLS[-1]]) == []
    assert obj._split_generation_request([]) == []
    obj.data_category_map = {}
    assert [[c[2] for c in h] for h in obj._split_generation_request(COLS)] == [
        ["orders", "payments", "returns"], ["shipments", "region"]]


def test_a_non_empty_answer_with_no_use_case_keeps_the_same_size_retry(agent_ns):
    obj = _harness(agent_ns, lambda subjects: HEADER)
    assert obj._process_batch_with_retry(COLS, 1, max_attempts=3) == []
    assert [_subjects(c) for c in obj.ai_agent.calls] == [TX] * 3
    assert obj.processing_honesty["total_batch_splits"] == 0


def test_an_empty_genie_instruction_answer_is_resent_once_with_the_cache_skipped(agent_ns):
    agent = FakeAgent(["", GOOD])
    inst = build_inspire(agent_ns, loader=FakeLoader(), quality="Ultra High", agent=agent)
    uc = _generate(inst)
    assert uc["genie_instruction_status"] == "success"
    assert [c["step"] for c in agent.calls] == ["Genie_Instruction_N01-U01", "Genie_Instruction_N01-U01_EmptyRetry"]
    assert [c["skip_cache"] for c in agent.calls] == [False, True]
    assert inst.logger.error.call_count == 0


def test_a_genie_instruction_that_stays_empty_logs_exactly_one_error(agent_ns):
    agent = FakeAgent(["", "short"])
    inst = build_inspire(agent_ns, loader=FakeLoader(), quality="Ultra High", agent=agent)
    uc = _generate(inst, make_uc())
    assert uc["genie_instruction_status"] == "failed"
    assert len(agent.calls) == 2
    assert inst.logger.error.call_count == 1
    assert "N01-U01" in inst.logger.error.call_args[0][0]
