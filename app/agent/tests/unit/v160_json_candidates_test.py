"""clean_json_response skips a bracketed phrase in the prose before the JSON.

A live rc.4 build (N02-U01 v6) held a vibe as "could not be checked" because the judge
answered with prose that echoed "[asked in an earlier version]" before its JSON object: the first
bracket was taken as the JSON, and json.loads failed with "Expecting value: line 1 column 2 (char 1)"
on both attempts.
"""
import json
import os
import sys
import types

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v140_implement_test import _inspire  # noqa: E402

JUDGE_REPLY = ('Ask 1 [asked in an earlier version] is on the page.\n'
               '{"checks": [{"n": 1, "status": "done", "evidence": "Expected main breaks by pipe material", "where": "chart"}]}')


def test_bracketed_prose_before_the_object_is_skipped(agent_ns):
    clean = agent_ns["clean_json_response"]
    assert json.loads(clean(JUDGE_REPLY))["checks"][0]["status"] == "done"


def test_the_live_failure_reproduces_on_the_first_bracket_alone(agent_ns):
    with pytest.raises(json.JSONDecodeError, match=r"line 1 column 2 \(char 1\)"):
        json.loads("[asked in an earlier version]")


def test_want_dict_skips_an_array_that_parses(agent_ns):
    clean = agent_ns["clean_json_response"]
    raw = 'See rows [1, 2] then {"checks": []}'
    assert clean(raw) == "[1, 2]"
    assert json.loads(clean(raw, want=dict)) == {"checks": []}


def test_want_list_skips_an_object_that_parses(agent_ns):
    clean = agent_ns["clean_json_response"]
    assert json.loads(clean('meta {"a": 1} data [{"b": 2}]', want=list)) == [{"b": 2}]


def test_unclosed_bracket_in_prose_is_skipped(agent_ns):
    clean = agent_ns["clean_json_response"]
    assert json.loads(clean('Note [unclosed. {"checks": [{"n": 1}]}')) == {"checks": [{"n": 1}]}


def test_valid_first_candidate_is_returned_unchanged(agent_ns):
    clean = agent_ns["clean_json_response"]
    raw = 'Result: {"a": [1, {"b": "]"}]} and later [9]'
    assert clean(raw) == '{"a": [1, {"b": "]"}]}'


def test_nothing_parses_keeps_the_first_fragment_for_the_repair_strategies(agent_ns):
    clean = agent_ns["clean_json_response"]
    raw = "{'a': [1, 2]}"
    assert clean(raw) == raw
    assert clean("prose [x and {y") == "prose [x and {y"


def test_no_json_at_all_returns_the_text(agent_ns):
    assert agent_ns["clean_json_response"]("no json here") == "no json here"


def test_candidate_scan_is_bounded(agent_ns):
    clean = agent_ns["clean_json_response"]
    limit = agent_ns["JSON_CANDIDATES_MAX"]
    raw = " ".join(["[x]"] * (limit + 5)) + ' {"ok": true}'
    assert clean(raw) == "[x]"
    raw = " ".join(["[x]"] * (limit - 1)) + ' {"ok": true}'
    assert json.loads(clean(raw)) == {"ok": True}


def test_implement_llm_object_reads_the_object_after_bracketed_prose(agent_ns):
    inst = _inspire(agent_ns, types.SimpleNamespace(sql=lambda *a, **k: None))
    inst.ai_agent = types.SimpleNamespace(_call_ai_query=lambda **kw: JUDGE_REPLY)
    parsed = inst._implement_llm_object("implement_vibes_judge", "Implement_Vibes_Judge", "p",
                                        agent_ns["IMPLEMENT_VIBES_JUDGE_SCHEMA"], skip_cache=True)
    answers = agent_ns["implement_vibes_answers"](parsed)
    assert answers[1]["status"] == "done"


def test_implement_llm_object_still_refuses_a_reply_with_no_object(agent_ns):
    inst = _inspire(agent_ns, types.SimpleNamespace(sql=lambda *a, **k: None))
    inst.ai_agent = types.SimpleNamespace(_call_ai_query=lambda **kw: "Only [1, 2] here")
    with pytest.raises(ValueError, match="no JSON object"):
        inst._implement_llm_object("implement_vibes_judge", "Implement_Vibes_Judge", "p",
                                   agent_ns["IMPLEMENT_VIBES_JUDGE_SCHEMA"], skip_cache=True)
