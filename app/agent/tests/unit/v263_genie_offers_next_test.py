import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_agent  # noqa: E402
from v141_app_shell_test import SETTINGS, call  # noqa: E402
from v144_app_data_test import EDITOR, PERSON, current  # noqa: E402
from v211_genie_agent_test import AgentWorkspace, FakeLLM, agent_shell, ask, said, tool_call, topic_of  # noqa: E402

BULLETS = "Three records need action:\n\n- Item 1 is open.\n- Item 2 is open.\n- Item 3 is open."
TABLE = "Three records need action:\n\n| Item | Status |\n|---|---|\n| Item 1 | Open |\n| Item 2 | Open |\n| Item 3 | Open |"
ROWS = [{"_inspire_key": f"k{i}", "record_key": f"k{i}", "entity_label": f"Item {i}", "action_status": None} for i in (1, 2, 3)]


def rows_ws(llm, **kwargs):
    return AgentWorkspace(llm=llm, rows=ROWS, total=3, current=[current(f"k{i}", "run", "run 7", version=str(100 + i)) for i in (1, 2, 3)],
                          **kwargs)


def test_three_rows_written_as_bullets_are_rewritten_into_one_table(tmp_path):
    llm = FakeLLM([tool_call("find_records", {}), said(BULLETS), said(TABLE)], related=topic_of)
    s, _ws, _made = agent_shell(tmp_path, ws=rows_ws(llm))
    turn = ask(s, "Which records need action?")
    assert turn["answer"] == TABLE, turn["answer"]
    assert "- " not in turn["answer"] and "| Item 1 | Open |" in turn["answer"]
    rewrite = llm.main_calls()[-1]["messages"][-1]["content"]
    assert "3 rows written as bullets" in rewrite and "one table, with no bullets" in rewrite


def test_a_bulleted_answer_that_lists_no_rows_is_never_rewritten(tmp_path):
    llm = FakeLLM([said("Item 1 is open.\n\n- Owner: Bill.")], related=topic_of)
    s, _ws, _made = agent_shell(tmp_path, ws=AgentWorkspace(llm=llm))
    assert ask(s, "Who owns it?")["answer"] == "Item 1 is open.\n\n- Owner: Bill."
    assert len(llm.main_calls()) == 1


def test_fix_this_offers_the_buttons_on_the_record_on_screen(tmp_path):
    llm = FakeLLM([tool_call("offer_actions", {}), said("Pick one of the buttons.")], related=topic_of)
    s, _ws, _made = agent_shell(tmp_path, ws=AgentWorkspace(llm=llm, current=[current("k1", "run", "run 7")]))
    turn = ask(s, "fix this", record_key="k1")
    assert "offer_actions" in [t["function"]["name"] for t in llm.main_calls()[0]["tools"]]
    assert turn["offers"] == {"actions": ["done", "not_an_issue", "snooze", "assign"],
                              "rows": [{"record_key": "k1", "label": "k1", "status": turn["offers"]["rows"][0]["status"]}]}
    assert turn["steps"] == [{"tool": "offer_actions", "text": "Offered actions on 1 record"}]
    assert turn["confirm"] is None, "an offer writes nothing and prepares no change"


def test_offer_actions_names_records_the_person_cannot_read_and_refuses_empty_asks(tmp_path):
    llm = FakeLLM([tool_call("offer_actions", {"record_keys": ["k9"]}), tool_call("offer_actions", {}, "t2"), said("No record.")],
                  related=topic_of)
    s, _ws, _made = agent_shell(tmp_path, ws=AgentWorkspace(llm=llm, current=[current("k1", "run", "run 7")]))
    turn = ask(s, "fix this")
    assert turn["offers"] is None
    assert [step["text"] for step in turn["steps"]] == ["Could not offer the actions: these records are not on the list you can read: k9",
                                                        "Could not offer the actions: name the records by record_keys: no record is on screen"]


def test_a_button_click_prepares_the_change_for_confirmation_without_a_model_call(tmp_path):
    llm = FakeLLM([], related=topic_of)
    s, ws, _made = agent_shell(tmp_path, ws=AgentWorkspace(llm=llm, current=[current("k1", "run", "run 7", version="101")]))
    status, out = call(s, "POST", "agent/prepare", headers=EDITOR,
                       body={"page": "n01_u05", "action": "done", "record_keys": ["k1"]})
    assert status == 200, out
    confirm = out["confirm"]
    assert confirm["route"] == "records/act" and confirm["label"] == "Mark done"
    assert confirm["body"] == {"page": "n01_u05", "record_keys": ["k1"], "seen": {"k1": "101"}, "values": {"action_status": "Done"}}
    assert llm.bodies == [], "the click runs without a model call"
    assert ws.queries("MERGE INTO") == [], "preparing writes nothing"
    status, written = call(s, "POST", confirm["route"], headers=EDITOR, body=confirm["body"])
    assert status == 200 and written["written"] == ["k1"]


@pytest.mark.parametrize("body, reason", [
    ({"action": "not_an_issue", "record_keys": ["k1"]}, "needs the person's reason"),
    ({"action": "not_an_issue", "record_keys": ["k1"], "reason": "  "}, "needs the person's reason"),
    ({"action": "snooze", "record_keys": ["k1"], "until": "soon"}, "needs a date"),
    ({"action": "assign", "record_keys": ["k1"]}, "to assign them to"),
    ({"action": "archive", "record_keys": ["k1"]}, "action is one of"),
    ({"action": "done", "record_keys": []}, "takes 1 to"),
    ({"action": "done", "record_keys": ["k9"]}, "not on the list you can read"),
])
def test_a_click_without_its_value_or_a_known_action_is_refused_and_writes_nothing(tmp_path, body, reason):
    llm = FakeLLM([], related=topic_of)
    s, ws, _made = agent_shell(tmp_path, ws=AgentWorkspace(llm=llm, current=[current("k1", "run", "run 7")]))
    status, out = call(s, "POST", "agent/prepare", headers=EDITOR, body=dict({"page": "n01_u05"}, **body))
    assert status == 400 and reason in out["error"], out
    assert ws.queries("MERGE INTO") == []


def test_a_click_on_a_page_that_records_no_decisions_is_refused(tmp_path):
    s, ws, _made = agent_shell(tmp_path, settings=SETTINGS, ws=rows_ws(FakeLLM([], related=topic_of)))
    status, out = call(s, "POST", "agent/prepare", headers=EDITOR, body={"page": "n01_u05", "action": "done", "record_keys": ["k1"]})
    assert status == 409 and "decisions" in out["error"], out
    assert ws.queries("MERGE INTO") == []


def test_a_grounded_answer_ends_with_one_or_two_next_steps_that_change_the_page(tmp_path):
    llm = FakeLLM([tool_call("find_records", {}), said("Item 1 needs action first.")], related=topic_of)
    s, _ws, _made = agent_shell(tmp_path, ws=rows_ws(llm))
    turn = ask(s, "Which record needs action first?")
    assert 1 <= len(turn["next"]) <= shell_agent.NEXT_STEPS
    first = turn["next"][0]
    assert first["text"] == "Opened record k1", first
    assert first["actions"] == [{"type": "open_record", "page": "n01_u05", "record_key": "k1"}]
    assert first["label"] == "Open Item 1", first
    assert all(step["label"] and step["text"] and step["actions"] for step in turn["next"])


def test_a_refused_question_offers_no_next_steps(tmp_path):
    s, _ws, _made = agent_shell(tmp_path, ws=AgentWorkspace(llm=FakeLLM([], related=topic_of)))
    turn = ask(s, "write me a poem")
    assert turn["refused"] is True and turn["next"] == []


def test_the_genie_off_reason_never_shows_a_uuid_a_genie_id_or_an_env_path(fresh_ns):
    import re
    reason = ("Genie Agent 0123456789abcdef0123456789abcdef could not start: sqlglot is loaded from "
              "site-packages/sqlglot/__init__.py and /local_disk0/.ipykernel/9/x. Retry later.")
    said = fresh_ns["implement_short_reason"](reason)
    assert not re.search(r"[0-9a-f]{32}", said) and "/" not in said and "site-packages" not in said, said
    assert "an id" in said and "a system file" in said
    assert fresh_ns["implement_short_reason"]("Genie and/or Agent is off") == "Genie and/or Agent is off"


def test_every_use_case_build_pins_sqlglot_before_its_first_sql_parse():
    import json
    from _nbload import AGENT_NB
    with open(AGENT_NB, encoding="utf-8") as handle:
        source = "".join("".join(c["source"]) + "\n" for c in json.load(handle)["cells"] if c["cell_type"] == "code")
    entry = source.split("    def _implement_one(self, target: dict) -> str:")[1].split("    def _implement_attempts(")[0]
    pinned = entry.find('self._require_asset_package("sqlglot"')
    assert 0 < pinned < entry.find("self._implement_attempts("), "the pin is requested at the top of the build, before any SQL is read"


def test_a_cut_bullet_never_leaves_a_bold_label_open_and_never_drops_a_number():
    bold = "- " + " ".join(["word"] * 9) + " **bold label here and more words after it**"
    out = shell_agent.shape_answer("Lead.\n\n" + bold)
    assert out.count("**") % 2 == 0 and out.count("**") == 2, out
    numbered = "- " + " ".join(["word"] * 9) + " then 4,200 more words after the number."
    assert "4,200" in shell_agent.shape_answer("Lead.\n\n" + numbered)


def test_a_bullet_keeps_its_number_and_cuts_the_words_around_it_to_twelve():
    bullet = "It falls within the current 7-day sales window being reviewed for the May 4-17, 2024 period on the page."
    cut = shell_agent.word_cut(bullet)
    assert shell_agent.words_of(cut) <= shell_agent.BULLET_WORDS and "2024" in cut and "7-day" in cut, cut
    assert cut.endswith("2024).") or cut.endswith("…"), cut


def test_three_rows_still_written_as_bullets_after_the_rewrite_become_one_table(tmp_path):
    llm = FakeLLM([tool_call("find_records", {}), said(BULLETS), said(BULLETS)], related=topic_of)
    s, _ws, _made = agent_shell(tmp_path, ws=rows_ws(llm))
    answer = ask(s, "Which records need action?")["answer"]
    assert "| Item | Detail |" in answer and "| Item 1 is open. | |" in answer, answer
    assert "\n- " not in "\n" + answer, answer


def test_two_different_answers_get_different_next_steps(tmp_path):
    llm = FakeLLM([tool_call("find_records", {}), said("Item 2 needs action first."), tool_call("find_records", {}),
                   said("Item 3 is the largest.")], related=topic_of)
    s, _ws, _made = agent_shell(tmp_path, ws=rows_ws(llm))
    first = ask(s, "Which record needs action first?")["next"]
    second = ask(s, "Which record is largest?")["next"]
    assert [step["label"] for step in first] == ["Open Item 2"], first
    assert [step["label"] for step in second] == ["Open Item 3"], second


def test_a_chart_is_offered_as_bars_only_when_the_answer_names_it(tmp_path):
    llm = FakeLLM([said("The chart shows the trend clearly.")], related=topic_of)
    s, _ws, _made = agent_shell(tmp_path, ws=AgentWorkspace(llm=llm))
    turn = ask(s, "What does the chart say?")
    assert turn["next"] == [] or all("as bars" in step["label"] for step in turn["next"]), turn["next"]
    (tmp_path / "second").mkdir()
    llm = FakeLLM([said("Nothing about pictures here.")], related=topic_of)
    s, _ws, _made = agent_shell(tmp_path / "second", ws=AgentWorkspace(llm=llm))
    assert ask(s, "Anything else?")["next"] == []
