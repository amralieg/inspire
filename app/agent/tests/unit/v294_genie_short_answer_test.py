import os
import sys

TESTS = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(os.path.dirname(os.path.dirname(TESTS)), "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)
if TESTS not in sys.path:
    sys.path.insert(0, TESTS)

import shell_agent  # noqa: E402
import shell_sql  # noqa: E402
from _agentload import load_agent_namespace  # noqa: E402
from v141_app_shell_test import call  # noqa: E402
from v211_genie_agent_test import AgentWorkspace, FakeLLM, agent_shell, ask, said, topic_of  # noqa: E402

EAST = {"filters": {"region": ["East"]}}
TWO_KPIS = "Items on the list are 120, and open bills are 7."
KPIS = [{"label": "Items on the list", "value": 120.0, "counts": "the current rows", "scope": "Region: East"},
        {"label": "Open bills", "value": 7.0, "counts": "the current rows", "scope": "Region: East"}]
PROFILES = "Two profiles are open, and both sit in East."
BULLETS = "- Staffing fell there.\n- Stock is oldest there.\n- The pair has a consent conflict."
TABLE = "| Profile 1 | Profile 2 | Match |\n|---|---|--:|\n| 2707 | 4183 | 0.4 |\n| 2708 | 4184 | 0.5 |\n| 2709 | 4185 | 0.6 |"


class ThreeRows(AgentWorkspace):
    def __init__(self, text, **kwargs):
        super().__init__(**kwargs)
        self.text = text

    def genie_message(self, space, conversation, message, row_limit=50):
        self.genie.append((space, conversation, message, row_limit))
        return {"state": "done", "text": self.text, "sql": "SELECT profile_1, profile_2, match FROM pairs",
                "columns": [{"name": "profile_1", "type": "STRING"}], "rows": [{"profile_1": n} for n in (1, 2, 3)], "truncated": False}


def lines_of(text):
    return [line for line in text.split("\n") if line.strip()]


def test_a_scope_line_is_one_sentence_however_many_page_numbers_the_answer_states():
    clashes, notes = shell_agent.number_scopes(TWO_KPIS, "", KPIS, [])
    assert len(clashes) + len(notes) <= 1, (clashes, notes)


def test_a_scope_line_still_names_the_one_number_the_answer_states_first():
    clashes, notes = shell_agent.number_scopes(TWO_KPIS, "", KPIS, [])
    assert clashes == [] and notes == ["Items on the list 120 counts the current rows; Region: East."]


def test_a_genie_agent_answer_that_lists_three_rows_is_a_table_on_the_genie_path_too(tmp_path):
    s, _ws, _made = agent_shell(tmp_path, ws=ThreeRows(text=f"{PROFILES}\n\n{BULLETS}"))
    status, msg = call(s, "GET", "genie/message", query={"page": "n01_u05", "conversation_id": "c1", "message_id": "m1"})
    assert status == 200
    assert not [line for line in lines_of(msg["text"]) if line.startswith("- ")], msg["text"]
    assert any(line.startswith("| ") for line in lines_of(msg["text"])), msg["text"]


def test_the_chat_answer_and_the_genie_answer_share_one_shaping_step(tmp_path):
    answer = f"{PROFILES}\n\n{TABLE}"
    llm = FakeLLM([said(answer)], related=topic_of)
    (tmp_path / "chat").mkdir()
    (tmp_path / "genie").mkdir()
    s, _ws, _made = agent_shell(tmp_path / "chat", ws=AgentWorkspace(llm=llm))
    chat = ask(s, "Which profile source creates the most duplicates?")["answer"]
    s, _ws, _made = agent_shell(tmp_path / "genie", ws=ThreeRows(text=answer))
    status, msg = call(s, "GET", "genie/message", query={"page": "n01_u05", "conversation_id": "c1", "message_id": "m1"})
    assert status == 200 and msg["text"] == chat, (msg["text"], chat)


def test_a_chat_answer_with_bullets_beside_a_table_is_shaped_to_the_lead_and_one_scope_line(tmp_path):
    llm = FakeLLM([said(f"{PROFILES}\n\n{BULLETS}\n\n{TABLE}")], related=topic_of)
    s, _ws, _made = agent_shell(tmp_path, ws=AgentWorkspace(llm=llm))
    answer = ask(s, "Which profile source creates the most duplicates?", view=EAST)["answer"]
    assert PROFILES in answer and "| 2707 | 4183 | 0.4 |" in answer
    assert answer.count("counts") <= 1, answer


PROFILE_KPI = [{"label": "Duplicate active passenger profiles", "value": 2.0, "counts": "the current rows of the runs it picked", "scope": "Region: East"}]


def test_a_listed_pair_count_that_differs_from_the_page_profile_kpi_names_both_units():
    answer = shell_agent.finish_text("There is 1 duplicate pair to act on.", key_numbers=PROFILE_KPI, listed=1,
                                     nouns=shell_agent.unit_nouns({"kind": "entity_matching"}))
    assert answer == ("There is 1 duplicate pair to act on.\n\n1 pair listed here; the page KPI Duplicate active passenger profiles "
                      "counts 2 profiles.")


def test_the_entity_matching_kind_declares_pairs_for_its_list_and_profiles_for_its_kpi():
    nouns = shell_agent.unit_nouns({"kind": "entity_matching"})
    assert nouns == {"record": ["pair", "pairs"], "kpi": ["profile", "profiles"]}
    assert shell_agent.unit_nouns({"kind": "no_such_kind"}) == shell_agent.DEFAULT_NOUNS


def test_every_kind_in_the_registry_declares_a_singular_and_plural_noun_for_its_list_and_its_kpi():
    kinds = shell_sql.kinds_registry()["kinds"]
    assert len(kinds) == 40
    for kind in kinds:
        for key in ("record", "kpi"):
            singular, plural = kind["nouns"][key]
            assert singular and plural.startswith(singular) and plural.endswith("s"), (kind["id"], key)


def test_a_count_of_one_uses_the_singular_noun_and_other_counts_the_plural():
    assert shell_agent.counted(1, ["pair", "pairs"]) == "1 pair"
    assert shell_agent.counted(2, ["profile", "profiles"]) == "2 profiles"
    assert shell_agent.counted(0, ["pair", "pairs"]) == "0 pairs"


def test_a_listed_count_that_agrees_with_the_page_kpi_gets_no_different_count_note():
    answer = shell_agent.finish_text("There are 2 duplicate active passenger profiles.", key_numbers=PROFILE_KPI, listed=2)
    assert "different count" not in answer and answer.startswith("There are 2 duplicate active passenger profiles.")


def test_a_listed_count_the_answer_does_not_state_gets_no_note():
    assert shell_agent.finish_text("Start with the east list.", key_numbers=PROFILE_KPI, listed=1) == "Start with the east list."


def test_a_page_without_a_kind_id_reads_its_layout_when_the_kinds_on_it_agree_and_the_defaults_otherwise():
    kinds = shell_sql.kinds_registry()["kinds"]
    entity = next(k for k in kinds if k["id"] == "entity_matching")
    same = [k["nouns"] for k in kinds if k["layout"] == entity["layout"]]
    expected = same[0] if all(n == same[0] for n in same) else shell_agent.DEFAULT_NOUNS
    assert shell_agent.unit_nouns({"layout": entity["layout"]}) == expected
    assert shell_agent.unit_nouns({"layout": "no_such_layout"}) == shell_agent.DEFAULT_NOUNS
    assert shell_agent.unit_nouns({}) == shell_agent.DEFAULT_NOUNS


def test_a_built_page_spec_carries_its_kind_id_and_the_answer_reads_one_pair_and_two_profiles():
    ns = load_agent_namespace()
    page = ns["implement_app_page"]({"title": "Merge passenger profiles"}, "uc1", {"use_case_kind": "entity_matching"}, "")
    assert page["kind"] == "entity_matching"
    answer = shell_agent.finish_text("There is 1 duplicate pair to act on.", key_numbers=PROFILE_KPI, listed=1,
                                     nouns=shell_agent.unit_nouns(page))
    assert answer.endswith("1 pair listed here; the page KPI Duplicate active passenger profiles counts 2 profiles.")
