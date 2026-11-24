"""REQ-506 lane 3: Genie is fully agentic. New compare and resolve blocks, grounded on the record, and every record action offered in agentic turns."""
import os
import sys

SERVER = os.path.join(os.path.dirname(__file__), "..", "..", "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_agent  # noqa: E402
import shell_blocks  # noqa: E402
from v144_app_data_test import DECIDE, current  # noqa: E402
from v211_genie_agent_test import AgentWorkspace, FakeLLM, agent_shell, ask, said, tool_call, topic_of  # noqa: E402

CTX = {"keys": {"r1", "r2"}, "act_rows": 50, "charts": {"trend": "Loss trend"}, "kpis": {"loss"},
       "columns": ["category", "value"], "actions": {"done", "snooze", "assign"}}
OPTION = lambda i, **over: dict({"id": f"o{i}", "label": f"Option {i}", "detail": "why", "ask": f"Do option {i}",
                                 "facts": [{"label": "Value", "value": f"${i},000"}]}, **over)


def run(raw):
    return shell_blocks.validate(raw, dict(CTX))


def test_compare_and_resolve_are_blocks_of_the_catalog():
    assert "compare" in shell_blocks.BLOCK_TYPES and "resolve" in shell_blocks.BLOCK_TYPES
    enum = shell_agent.TOOLS["render_answer"]["parameters"]["properties"]["blocks"]["items"]["properties"]["type"]["enum"]
    assert "compare" in enum and "resolve" in enum


def test_a_compare_keeps_2_to_4_options_with_whitelisted_plain_fields():
    blocks, problems = run([{"type": "compare", "title": "<b>Two ways</b>", "evil": 1,
                             "options": [OPTION(1, label="<script>x</script>Cut", extra="drop"), OPTION(2)]}])
    assert len(blocks) == 1, problems
    b = blocks[0]
    assert b["type"] == "compare" and b["title"] == "Two ways" and "evil" not in b
    assert [o["id"] for o in b["options"]] == ["o1", "o2"]
    assert "<" not in b["options"][0]["label"] and "extra" not in b["options"][0]
    assert set(b["options"][0]) == {"id", "label", "detail", "ask", "facts"}
    assert b["options"][0]["facts"] == [{"label": "Value", "value": "$1,000"}]


def test_a_compare_with_one_option_is_left_out_and_more_than_4_are_cut():
    blocks, problems = run([{"type": "compare", "options": [OPTION(1)]}])
    assert blocks == [] and any("compare" in p for p in problems)
    blocks, problems = run([{"type": "compare", "options": [OPTION(i) for i in range(1, 7)]}])
    assert [o["id"] for o in blocks[0]["options"]] == ["o1", "o2", "o3", "o4"]
    assert any("at most 4" in p for p in problems)


def test_compare_facts_are_capped_and_only_label_value_pairs_are_kept():
    facts = [{"label": f"F{i}", "value": str(i)} for i in range(10)] + ["bare", {"label": "x"}]
    blocks, _ = run([{"type": "compare", "options": [OPTION(1, facts=facts), OPTION(2)]}])
    kept = blocks[0]["options"][0]["facts"]
    assert len(kept) <= 6 and all(set(f) == {"label", "value"} for f in kept)


def test_a_resolve_names_only_a_record_the_person_can_read():
    blocks, problems = run([{"type": "resolve", "record_key": "secret"}])
    assert blocks == [] and any("cannot see" in p for p in problems)
    blocks, _ = run([{"type": "resolve", "record_key": "r1", "label": "<i>Unit 7</i>", "value_at_stake": "$1", "evil": "x"}])
    assert blocks[0]["type"] == "resolve" and blocks[0]["record_key"] == "r1" and blocks[0]["label"] == "Unit 7"
    assert set(blocks[0]) == {"type", "record_key", "label", "value_at_stake", "status"}


def agentic_shell(tmp_path, llm, rows):
    settings = dict(DECIDE, options=dict(DECIDE["options"], experience="both"))
    return agent_shell(tmp_path, settings=settings, ws=AgentWorkspace(llm=llm, current=rows))


def test_an_agentic_resolve_shows_the_records_own_value_never_the_planners_number(tmp_path):
    llm = FakeLLM([tool_call("render_answer", {"blocks": [{"type": "resolve", "record_key": "k1", "value_at_stake": "$999,999", "label": "made up"}]}),
                   said("Resolve it.")], related=topic_of)
    s, _ws, _made = agentic_shell(tmp_path, llm, [current("k1", "run", "run 7", {"value_at_stake": 2340})])
    turn = ask(s, "fix this", record_key="k1", surface="agent")
    resolve = [b for b in turn["blocks"] if b["type"] == "resolve"]
    assert len(resolve) == 1, turn["blocks"]
    assert resolve[0]["value_at_stake"] == "2340" and resolve[0]["label"] != "made up"


def test_an_agentic_turn_offers_every_record_action_of_the_app(tmp_path):
    llm = FakeLLM([tool_call("offer_actions", {}), said("Pick one.")], related=topic_of)
    s, _ws, _made = agentic_shell(tmp_path, llm, [current("k1", "run", "run 7")])
    turn = ask(s, "fix this", record_key="k1", surface="agent")
    assert sorted(turn["offers"]["actions"]) == sorted(shell_agent.ACTIONS), "the agentic Genie may do anything a record allows"
    assert len(turn["offers"]["actions"]) > len(shell_agent.OFFER_ACTIONS)


def test_a_turn_that_is_not_agentic_keeps_the_four_offers(tmp_path):
    llm = FakeLLM([tool_call("offer_actions", {}), said("Pick one.")], related=topic_of)
    s, _ws, _made = agentic_shell(tmp_path, llm, [current("k1", "run", "run 7")])
    turn = ask(s, "fix this", record_key="k1")
    assert turn["offers"]["actions"] == ["done", "not_an_issue", "snooze", "assign"]
