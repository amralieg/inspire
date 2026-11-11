import os
import sys

import pytest

TESTS = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(os.path.dirname(os.path.dirname(TESTS)), "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)
if TESTS not in sys.path:
    sys.path.insert(0, TESTS)

import shell_agent  # noqa: E402
from v141_app_shell_test import call  # noqa: E402
from v211_genie_agent_test import AgentWorkspace, FakeLLM, agent_shell, ask, said, tool_call, topic_of  # noqa: E402

EAST = {"filters": {"region": ["East"]}}
ITEMS_SCOPE = "the current rows of the runs it picked; from the latest run; Region: East"
GENIE_SQL = "SELECT COUNT(*) AS items FROM main.ops.items WHERE status = 'open'"


class GenieCounts(AgentWorkspace):
    def __init__(self, counted, sql=GENIE_SQL, **kwargs):
        super().__init__(**kwargs)
        self.counted, self.counted_sql = counted, sql

    def genie_message(self, space, conversation, message, row_limit=50):
        self.genie.append((space, conversation, message, row_limit))
        return {"state": "done", "text": f"There are {self.counted} items.", "sql": self.counted_sql,
                "columns": [{"name": "items", "type": "BIGINT"}], "rows": [{"items": self.counted}], "truncated": False}


def turn_for(tmp_path, script, question="How many items are on the list?", ws_class=AgentWorkspace, **ws_args):
    llm = FakeLLM(script, related=topic_of)
    s, ws, _made = agent_shell(tmp_path, ws=ws_class(llm=llm, **ws_args))
    return ask(s, question, view=EAST), ws


def test_an_answer_that_states_a_page_kpi_gets_the_rows_it_counts_attached(tmp_path):
    turn, _ws = turn_for(tmp_path, [said("The page shows 120 items on the list.")])
    assert turn["answer"] == f"The page shows 120 items on the list.\n\nItems on the list 120 counts {ITEMS_SCOPE}."


def test_a_genie_count_that_disagrees_with_the_page_kpi_shows_the_page_value_and_what_genie_counted(tmp_path):
    script = [tool_call("ask_genie", {"question": "How many items are on the list?"}), said("Genie found 95 items on the list.")]
    turn, ws = turn_for(tmp_path, script, ws_class=GenieCounts, counted=95)
    assert ws.genie, "Genie was asked"
    assert turn["answer"] == (f"The page shows Items on the list 120 for {ITEMS_SCOPE}; Genie counted 95 for every row of every run, "
                              "where status = 'open'.\n\nGenie found 95 items on the list.")


def test_a_genie_count_that_agrees_with_the_page_is_no_clash_and_only_gets_its_scope(tmp_path):
    script = [tool_call("ask_genie", {"question": "How many items are on the list?"}), said("Genie found 120 items on the list.")]
    turn, _ws = turn_for(tmp_path, script, ws_class=GenieCounts, counted=120)
    assert turn["answer"] == f"Genie found 120 items on the list.\n\nItems on the list 120 counts {ITEMS_SCOPE}."


def test_a_genie_number_about_another_subject_raises_no_clash_and_gets_what_genie_counted(tmp_path):
    script = [tool_call("ask_genie", {"question": "Which region lost the most?"}), said("East lost the most: 95.")]
    turn, _ws = turn_for(tmp_path, script, question="Which region loses the most?", ws_class=GenieCounts, counted=95)
    assert turn["answer"] == "East lost the most: 95.\n\nGenie counted 95 for every row of every run, where status = 'open'."


def test_a_genie_number_the_answer_does_not_state_gets_nothing_attached(tmp_path):
    script = [tool_call("ask_genie", {"question": "Which region lost the most?"}), said("East lost the most.")]
    turn, _ws = turn_for(tmp_path, script, question="Which region loses the most?", ws_class=GenieCounts, counted=95)
    assert turn["answer"] == "East lost the most."


def test_a_genie_agent_answer_passed_through_names_what_genie_counted(tmp_path):
    s, _ws, _made = agent_shell(tmp_path, ws=GenieCounts(95))
    status, msg = call(s, "GET", "genie/message", query={"page": "n01_u05", "conversation_id": "c1", "message_id": "m1"})
    assert status == 200 and msg["text"] == "There are 95 items.\n\nGenie counted 95 for every row of every run, where status = 'open'."
    (tmp_path / "rows").mkdir()
    s, _ws, _made = agent_shell(tmp_path / "rows", ws=AgentWorkspace(genie_text="East lost the most: 120."))
    status, msg = call(s, "GET", "genie/message", query={"page": "n01_u05", "conversation_id": "c1", "message_id": "m1"})
    assert status == 200 and msg["text"] == "East lost the most: 120.", "a result of rows, not one number, gets no count line"


def test_an_answer_without_a_page_number_gets_nothing_attached(tmp_path):
    turn, _ws = turn_for(tmp_path, [said("Start with the 3 oldest items in East.")])
    assert turn["answer"] == "Start with the 3 oldest items in East."


def test_a_number_held_by_several_kpis_is_attached_only_to_the_one_the_answer_names():
    numbers = [{"label": "Loss to discounts", "value": 120.0, "counts": "every row of every run", "scope": "Region: East"},
               {"label": "Items on the list", "value": 120.0, "counts": "the current rows", "scope": "Region: East"}]
    assert shell_agent.number_scopes("There are 120 of them.", "", numbers, []) == ([], [])
    assert shell_agent.number_scopes("120 items on the list.", "", numbers, []) == (
        [], ["Items on the list 120 counts the current rows; Region: East."])
    assert shell_agent.number_scopes("There are 120 of them.", "", numbers[1:], []) == (
        [], ["Items on the list 120 counts the current rows; Region: East."])


def test_a_short_number_counts_only_when_the_answer_names_the_kpi():
    numbers = [{"label": "Open bills", "value": 7, "scope": "Region: East"}]
    assert shell_agent.number_scopes("Call 7 people.", "", numbers, []) == ([], [])
    assert shell_agent.number_scopes("There are 7 open bills.", "", numbers, [])[1] == [
        "Open bills 7 counts every row of every run; Region: East."]


def test_a_scope_the_answer_already_states_is_not_repeated():
    numbers = [{"label": "Open bills", "value": 1204, "counts": "the current rows", "scope": "Region: East"}]
    assert shell_agent.number_scopes("Open bills 1,204 counts the current rows; Region: East.", "", numbers, []) == ([], [])


@pytest.mark.parametrize("sql, scope", [
    ("SELECT region, SUM(loss) FROM t GROUP BY region", "every row of every run, with no filter"),
    ("SELECT COUNT(*) FROM o WHERE `is_current` AND change_source <> 'delete' AND status = 'open' AND region IN ('East','West')",
     "the current rows, where status = 'open', region in ('East','West')"),
    ("SELECT COUNT(*) FROM x WHERE run_id = (SELECT MAX(run_id) FROM x) AND tier = 'High'", "the latest run, where tier = 'High'"),
    ("SELECT COUNT(*) FROM x WHERE `_inspire_run` = 'latest' AND o.is_current", "the current rows of the latest run, with no filter"),
    ("SELECT COUNT(*) FROM x WHERE as_of_date >= '2026-01-01'", "the runs it picked, with no filter"),
    ("SELECT COUNT(*) FROM x WHERE is_current = false", "every row of every run, with no filter"),
    ("SELECT COUNT(*) FROM x WHERE a = 1 AND b = 2 AND c = 3 AND d = 4", "every row of every run, where a = 1, b = 2, c = 3"),
    ("SELECT MAX(as_of_date), COUNT(*) FROM o JOIN r ON o.run_id = r.run_id GROUP BY 1", "every row of every run, with no filter"),
    ("SELECT COUNT(*) FROM o JOIN r ON o.run_id = r.run_id WHERE r.run_id = (SELECT MAX(run_id) FROM r)", "the latest run, with no filter"),
])
def test_the_scope_of_a_query_names_its_run_its_rows_and_its_filters(sql, scope):
    assert shell_agent.sql_scope(sql) == scope


def test_the_page_value_is_shown_in_the_kpi_format():
    assert shell_agent.kpi_shown({"format": "percent"}, 0.1234) == "12.34%"
    assert shell_agent.kpi_shown({"format": "currency", "currency": "USD"}, 1820.244) == "USD 1,820.24"
    assert shell_agent.kpi_shown({"format": "integer"}, 1204.0) == "1,204"


def test_a_genie_result_counts_as_one_number_only_when_it_is_one_row_with_one_number():
    assert shell_agent.genie_value({"rows": [{"items": 95}]}) == 95
    assert shell_agent.genie_value({"rows": [{"region": "East", "items": 95}]}) == 95
    assert shell_agent.genie_value({"rows": [{"items": 95}, {"items": 3}]}) is None
    assert shell_agent.genie_value({"rows": [{"a": 1, "b": 2}]}) is None
    assert shell_agent.genie_value({"rows": [{"ok": True}]}) is None
    assert shell_agent.genie_value({}) is None


def test_the_kpi_carries_the_rows_its_query_counts(tmp_path):
    llm = FakeLLM([said("Here.")], related=topic_of)
    s, ws, _made = agent_shell(tmp_path, ws=AgentWorkspace(llm=llm))
    ask(s, "How many items are on the list?", view=EAST)
    context = llm.main_calls()[0]["messages"][1]["content"]
    assert '"counts":"the current rows of the runs it picked"' in context and '"counts":"the runs it picked"' in context


def test_the_draft_and_the_answer_replace_every_dash_the_same_way():
    subject, body = shell_agent.draft_parse('{"subject": "Bill 1133 -- short", "body": "Hi [name],\\n\\nIt is short -- by 836 \\u2014 today."}')
    assert subject == "Bill 1133, short" and body == "Hi [name],\n\nIt is short, by 836, today."
    assert shell_agent.shape_answer("It is short -- by 836 \u2014 today.") == "It is short, by 836, today."


def test_the_draft_counts_sentences_the_way_the_answer_does():
    body = "Hi [name],\n\nBill 1133 is short, e.g. by a few dollars. " + " ".join(f"Line {w} is here." for w in "abcdefg")
    assert len(shell_agent.sentences_of(body[len("Hi [name],"):])) == 8
    assert shell_agent.draft_problem("Bill 1133", body, "bill 1133", [1133], False) == ""
    assert "sentences" in shell_agent.draft_problem("Bill 1133", body + " One more.", "bill 1133", [1133], False)


@pytest.mark.parametrize("filler", ["Please do not hesitate to ask.", "Feel free to open the record.", "We can circle back on this tomorrow."])
def test_filler_wording_is_flagged_in_the_answer_as_in_the_draft(filler):
    problems, _far = shell_agent.answer_problems(f"Bill 1133 is short. {filler}")
    assert "filler wording such as feel free or do not hesitate" in problems
    assert shell_agent.draft_problem("Bill 1133", f"Hi [name],\n\nBill 1133 is short. Assign it. {filler}", "bill 1133", [1133],
                                     False) == "used filler wording"
    assert shell_agent.answer_problems("Bill 1133 is short.")[0] == []
