"""Every plan line a page suggests can be accepted or overridden with a reason: the App check refuses a decision list the App cannot
save a decision on, a plan decision closes its line with the note of what was chosen, and the page author and the run notebook are told
how to keep each line linked to its record, offline."""
import copy
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_sql  # noqa: E402
from v141_app_shell_test import SETTINGS  # noqa: E402
from v144_app_data_test import DECIDE, EDITOR, LISTED, MODIFY, DataWorkspace, shell  # noqa: E402
from v142_edits_test import edit_page  # noqa: E402
from v198_kind_layouts_test import PLANNER, _modules  # noqa: E402

UNLINKED = "people cannot record a decision on any row of the decision list"
LOOSE = [c for c in LISTED if c["name"] not in ("record_key", "entity_id")]


def unlinked(problems):
    return [p for p in problems if UNLINKED in p]


def test_the_app_check_refuses_a_decision_list_that_selects_no_record_key_while_decisions_are_on(tmp_path, capsys):
    s, _ws, _made = shell(tmp_path, settings=DECIDE, ws=DataWorkspace(listed=LOOSE))
    found = unlinked(s.check(EDITOR))
    assert len(found) == 1, found
    assert "selects neither record_key nor its key" in found[0] and "select record_key from" in found[0]
    assert "[DECIDABLE-CHECK FIRED] page=n01_u05" in capsys.readouterr().out


def test_the_app_check_keeps_a_decision_list_joined_to_the_result_table(tmp_path, capsys):
    s, _ws, _made = shell(tmp_path, settings=DECIDE)
    assert unlinked(s.check(EDITOR)) == []
    assert "DECIDABLE-CHECK FIRED" not in capsys.readouterr().out


def test_the_app_check_asks_for_no_link_when_the_app_records_no_decisions(tmp_path):
    s, _ws, _made = shell(tmp_path, settings=SETTINGS, ws=DataWorkspace(listed=LOOSE))
    assert unlinked(s.check(EDITOR)) == []


def test_an_editable_plan_needs_its_lines_linked_even_with_decisions_off(tmp_path):
    page = edit_page(plan={"title": "Order plan", "current": "rank", "recommended": "value", "override": "value"})
    s, _ws, _made = shell(tmp_path, settings=MODIFY, pages=[page], ws=DataWorkspace(listed=LOOSE))
    assert len(unlinked(s.check(EDITOR))) == 1
    plain = copy.deepcopy(page)
    plain["plan"].pop("override")
    (tmp_path / "plain").mkdir()
    s, _ws, _made = shell(tmp_path / "plain", settings=MODIFY, pages=[plain], ws=DataWorkspace(listed=LOOSE))
    assert unlinked(s.check(EDITOR)) == []


def test_a_plan_decision_closes_its_line_with_a_note_people_read_after_a_reload():
    accepted = shell_sql.plan_decision(PLANNER["plan"], "accept", "", None, 300)
    overridden = shell_sql.plan_decision(PLANNER["plan"], "override", "Truck slots are short", 250, 300)
    assert accepted["action_status"] in shell_sql.CLOSED_STATUSES and overridden["action_status"] in shell_sql.CLOSED_STATUSES
    assert accepted["note"] == "Accepted the recommended 300"
    assert overridden["note"] == "Override to 250 instead of 300: Truck slots are short"
    assert shell_sql.action_values(accepted)["action_status"] == shell_sql.PLAN_DECIDED


def test_the_layout_brief_tells_the_author_to_keep_record_key_on_every_layout_whose_decision_list_reads_a_companion(agent_ns, tmp_path):
    nb_sql = _modules(agent_ns, tmp_path)[1]["shell_sql"]
    brief, tables_of = agent_ns["implement_layout_brief"], agent_ns["implement_layout_tables"]
    told = "so it selects record_key from the current rows of the result table"
    for name in nb_sql.enabled_layouts():
        tables = tables_of("main.s.thing_out", name)
        text = brief(name, tables, nb_sql)
        decides = nb_sql.decision_section({"layout": name}) is not None
        assert (told in text) is (decides and bool(tables) and name != nb_sql.DEFAULT_LAYOUT), name
        assert ("leave out the records dataset" in text) is (not decides), name
    assert told in brief("planner", tables_of("main.s.thing_out", "planner"), nb_sql)
    assert told not in brief("dashboard", {}, nb_sql) and told not in brief("decision_queue", {}, nb_sql)


def test_the_run_notebook_writes_each_plan_line_with_the_entity_id_of_its_record(agent_ns):
    meaning = agent_ns["INSPIRE_COMPANION_MEANINGS"]["__plan"]
    assert "entity = the entity_id of that line's row in the result table" in meaning
    lines = agent_ns["genie_companion_lines"]({"result_table": "main.s.thing_out",
                                               "companions": {"__plan": ["entity", "current_value", "recommended_value"]}})
    assert any(line.startswith("* main.s.thing_out__plan: entity, current_value, recommended_value; one row per plan line") for line in lines)
