from v211_genie_agent_test import AgentWorkspace, FakeLLM, agent_shell, ask, said, tool_call, topic_of


def test_find_records_reads_every_record_the_page_counts_so_a_decided_record_is_found(tmp_path):
    rows = [{"_inspire_key": "2707", "record_key": "2707", "entity_label": "Passenger profile 2707"}]
    llm = FakeLLM([tool_call("find_records", {"search": "2707"}),
                   tool_call("offer_actions", {"record_keys": ["2707"]}, "t2"),
                   said("Choose an action for passenger profile 2707.")], related=topic_of)
    ws = AgentWorkspace(llm=llm, rows=rows, total=1)
    s, _ws, _made = agent_shell(tmp_path, ws=ws)
    turn = ask(s, "Fix this for passenger profile 2707: mark it as done")
    found = ws.queries(" OFFSET ")[0][0]
    assert "COALESCE(c.`_inspire_status`" not in found, "find_records must not narrow to open records and hold-backs"
    assert [t["function"]["name"] for t in llm.main_calls()[0]["tools"]].count("find_records") == 1
    assert turn["state"] == "done" and turn["answer"] == "Choose an action for passenger profile 2707."


def test_a_bulk_change_still_acts_only_on_open_records(tmp_path):
    rows = [{"_inspire_key": "k1", "record_key": "k1", "entity_label": "Item 1"}]
    llm = FakeLLM([tool_call("propose_action", {"action": "done", "match": {"filters": {}}}), said("Confirm below.")], related=topic_of)
    ws = AgentWorkspace(llm=llm, rows=rows, total=1)
    s, _ws, _made = agent_shell(tmp_path, ws=ws)
    ask(s, "Mark every record done")
    listed = ws.queries(" OFFSET ")[0][0]
    assert "COALESCE(c.`_inspire_status`" in listed
