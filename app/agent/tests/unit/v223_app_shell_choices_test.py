import copy
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_facts
import shell_sql
from v147_app_ai_test import _sqlite_run, _version
from v222_app_shell_work_tabs_test import _context, _page

OWN = [{"id": "reprice", "label": "Reprice", "status": "In progress"}, {"id": "keep", "label": "Keep the price", "status": "Done"},
       {"id": "drop", "label": "Drop the item", "status": "Done"},
       {"id": "wrong", "label": "Wrong flag", "status": "Dismissed", "reasons": ["Data error", "Seasonal"]}]


def _own(choices=OWN):
    page = _page()
    page["records"] = dict(page["records"], choices=copy.deepcopy(choices))
    return page


def _choice_problems(choices, stored=None):
    return shell_sql.choice_problems(_own(choices), stored)


def test_a_page_with_its_own_valid_choices_and_a_page_without_any_pass():
    assert _choice_problems(OWN) == []
    assert shell_sql.choice_problems(_page()) == []
    assert not [p for p in shell_sql.spec_problems(_own()) if "choice" in p]
    assert [c["id"] for c in shell_sql.status_choices(_own())] == ["reprice", "keep", "drop", "wrong"]
    assert [c["id"] for c in shell_sql.status_choices(_page())] == ["new", "in-progress", "done", "not-an-issue", "could-not-fix"]


@pytest.mark.parametrize("count, bad", [(1, True), (2, False), (8, False), (9, True)])
def test_a_page_holds_2_to_8_choices(count, bad):
    choices = [{"id": "work", "label": "Work on it", "status": "New"}, {"id": "fixed", "label": "Fixed", "status": "Done"}]
    choices += [{"id": f"more-{i}", "label": f"More {i}", "status": "In progress"} for i in range(count - 2)]
    problems = _choice_problems(choices[:count] if count < 2 else choices)
    assert any("2 to 8 choices" in p for p in problems) is bad, problems


def test_each_choice_id_appears_once():
    twice = OWN + [dict(OWN[0], label="Reprice again")]
    assert any("name each id once" in p for p in _choice_problems(twice))
    assert not any("name each id once" in p for p in _choice_problems(OWN))


@pytest.mark.parametrize("ident", ["Bad Id", "-lead", "", "open", "mine", "all", 7])
def test_a_choice_id_is_a_short_slug_that_names_no_fixed_tab(ident):
    problems = _choice_problems([dict(OWN[0], id=ident)] + OWN[1:])
    assert any("needs an id" in p or "names the" in p for p in problems), problems


def test_a_label_takes_at_most_40_characters_and_each_label_once():
    long = _choice_problems([dict(OWN[0], label="x" * 41)] + OWN[1:])
    assert any("label of 1 to 40 characters" in p for p in long)
    assert not any("label" in p for p in _choice_problems([dict(OWN[0], label="x" * 40)] + OWN[1:]))
    same = _choice_problems([dict(OWN[0], label="keep the PRICE")] + OWN[1:])
    assert any("each label once" in p for p in same)


def test_a_page_with_no_open_choice_is_rejected():
    closed = [c for c in OWN if c["status"] != "In progress"]
    assert any("open status" in p for p in _choice_problems(closed))
    assert not any("open status" in p for p in _choice_problems(OWN))


def test_a_page_with_no_done_choice_is_rejected():
    undone = [c for c in OWN if c["status"] != "Done"] + [{"id": "gave-up", "label": "Gave up", "status": "Could not fix"}]
    assert any("Done status" in p for p in _choice_problems(undone))
    assert not any("Done status" in p for p in _choice_problems(OWN))


def test_a_dismissed_choice_carries_the_reasons_a_person_picks_from():
    bare = [dict(c) for c in OWN]
    bare[3].pop("reasons")
    assert any("needs reasons" in p for p in _choice_problems(bare))
    empty = [dict(c) for c in OWN]
    empty[3]["reasons"] = []
    assert any("needs reasons" in p for p in _choice_problems(empty))
    twice = [dict(c) for c in OWN]
    twice[3]["reasons"] = ["Data error", "data error"]
    assert any("reasons must be a list" in p for p in _choice_problems(twice))


def test_a_choice_takes_a_real_status_and_no_other_keys():
    assert any("status must be one of" in p for p in _choice_problems([dict(OWN[0], status="Parked")] + OWN[1:]))
    assert any("takes only" in p for p in _choice_problems([dict(OWN[0], colour="red")] + OWN[1:]))
    assert any("must be a list of objects" in p for p in shell_sql.choice_problems(_own(["keep"])))


def test_no_choice_id_records_already_carry_is_dropped():
    assert any("drop drop" in p for p in _choice_problems(OWN[:2] + OWN[3:], stored=["keep", "drop"]))
    assert _choice_problems(OWN, stored=["keep", "drop"]) == []
    plain = shell_sql.choice_problems(_page(), stored=["keep"])
    assert plain and "keep" in plain[0], "a page that goes back to the default statuses still keeps the ids its records carry"
    assert shell_sql.choice_problems(_page(), stored=["done", "not-an-issue"]) == []
    assert any("keep" in p for p in shell_sql.spec_problems(_page(), ["keep"]))


def test_the_notebook_page_check_passes_the_stored_choices_to_the_validator():
    import json
    nb = json.load(open(os.path.join(ROOT, "agent", "dbx_inspire_ai_agent.ipynb"), encoding="utf-8"))
    text = "".join(nb["cells"][1]["source"])
    assert "shell_sql.spec_problems(page, stored)" in text
    assert "stored = self._implement_stored_choices(context[\"result_table\"], shell_sql, real)" in text
    assert "many=many, real=real, stored=stored)" in text
    assert "+ implement_choices_rule(shell_sql)" in text


def _row(key, status, choice=None, note=None, reason=None, current=True):
    return dict(_version(key, None, current=current), action_owner=None, action_status=status, action_choice=choice,
                action_batch_note=note, dismiss_reason=reason, valid_to=None, changed_by="run", run_id="r1")


def _tables():
    return {"loss_desk_out": [_row("k1", "Done", choice="keep"), _row("k2", "Done", note="Drop the item: too slow"),
                              _row("k3", "Done", note="Drop the item"), _row("k4", "In progress"), _row("k5", None),
                              _row("k6", "Dismissed", reason="Data error"), _row("k7", "Done", choice="gone"),
                              _row("k8", "Done", choice="keep", current=False)]}


def _counts(page, body=None):
    context = _context(page)
    request = shell_sql.list_request(page, body or {}, context)
    return shell_sql.status_counts_of(_sqlite_run(*shell_sql.status_counts_query(page, {}, request, context, ""), _tables()),
                                      shell_sql.status_choices(page))


def test_the_counts_read_the_stored_choice_then_the_note_then_the_only_choice_of_a_status():
    got = _counts(_own())
    assert got["choices"] == {"reprice": 1, "keep": 1, "drop": 2, "wrong": 1}, got
    assert got["statuses"]["Done"] == 4 and got["open"] == 2 and got["all"] == 7


def test_a_choice_tab_lists_exactly_the_records_its_count_says():
    page = _own()
    context = _context(page)
    counts = _counts(page)
    for ident in ("keep", "drop", "wrong", "reprice"):
        listed = shell_sql.list_queries(page, {}, shell_sql.list_request(page, {"choice": ident}, context), context)
        assert _sqlite_run(*listed["total"], _tables()) == [{"total": counts["choices"][ident]}], ident


def test_a_tab_for_an_unknown_choice_is_refused():
    page = _own()
    with pytest.raises(ValueError):
        shell_sql.list_request(page, {"choice": "not-an-issue"}, _context(page))


def test_an_action_saves_a_valid_choice_and_refuses_a_wrong_one():
    choices = shell_sql.status_choices(_own())
    assert shell_sql.action_values({"action_status": "Done", "action_choice": "drop"}, None, choices)["action_choice"] == "drop"
    with pytest.raises(ValueError, match="action_choice must be one of"):
        shell_sql.action_values({"action_status": "Done", "action_choice": "done"}, None, choices)
    with pytest.raises(ValueError, match="sets the status Done"):
        shell_sql.action_values({"action_status": "In progress", "action_choice": "keep"}, None, choices)
    assert shell_sql.action_values({"action_status": "In progress"}, None, choices)["action_choice"] is None, \
        "a status sent without a choice clears the stored choice, so the record never keeps a choice of another status"


def test_the_status_text_names_the_picked_choice_or_the_only_choice_of_a_status():
    page = _own()
    assert shell_sql.status_text(page, {"action_status": "Done", "action_choice": "drop"}) == "Drop the item"
    assert shell_sql.status_text(page, {"action_status": "Done"}) == "Done"
    assert shell_sql.status_text(page, {"action_status": "Dismissed"}) == "Wrong flag"
    assert shell_sql.status_text(_page(), {"action_status": "Dismissed"}) == "Not an issue"
    assert shell_sql.status_text(_page(), {}) == "New"


def test_the_public_page_carries_its_statuses():
    assert [c["id"] for c in shell_sql.public_parts(_own())["statuses"]] == ["reprice", "keep", "drop", "wrong"]
    assert len(shell_sql.public_parts(_page())["statuses"]) == len(shell_facts.DEFAULT_CHOICES)


def test_no_fixed_five_status_list_is_left_in_the_server_or_the_web_source():
    import re
    fixed = re.compile(r"""['"]New['"]\s*,\s*['"]In progress['"]\s*,\s*['"]Done['"]""")
    shell = os.path.join(ROOT, "agent", "app_shell")
    found = []
    for folder in ("server", os.path.join("web", "src")):
        for name in os.listdir(os.path.join(shell, folder)):
            if name.endswith((".py", ".js", ".jsx")):
                if fixed.search(open(os.path.join(shell, folder, name), encoding="utf-8").read()):
                    found.append(name)
    assert found == []


class _Rows:
    def __init__(self, rows):
        self.rows = rows

    def collect(self):
        return self.rows


def _reader(agent_ns, tmp_path, columns, rows=()):
    from v140_implement_test import _output_inspire
    inst, _calls = _output_inspire(agent_ns, tmp_path)
    asked = []
    inst._implement_space_columns = lambda tables: asked.append(list(tables)) or {t.lower(): columns for t in tables}
    inst.spark.sql = lambda statement: asked.append(statement) or _Rows([(r,) for r in rows])
    return inst, asked


def test_the_page_build_reads_the_choice_ids_records_carry_only_when_the_table_has_the_column(agent_ns, tmp_path):
    table = "main.inspire.churn_out"
    inst, asked = _reader(agent_ns, tmp_path, [("record_key", "string", ""), ("action_choice", "string", "")], ["keep", "drop"])
    assert inst._implement_stored_choices(table, shell_sql) == ["drop", "keep"]
    assert asked[0] == [table] and asked[1].startswith("SELECT DISTINCT action_choice FROM `main`.`inspire`.`churn_out`")
    old, asked_old = _reader(agent_ns, tmp_path, [("record_key", "string", "")], ["keep"])
    assert old._implement_stored_choices(table, shell_sql) == [] and len(asked_old) == 1, "a table from before the column reads nothing"
    known, asked_known = _reader(agent_ns, tmp_path, [], ["keep"])
    assert known._implement_stored_choices(table, shell_sql, {table: {"record_key", "action_choice"}}) == ["keep"]
    assert not [a for a in asked_known if isinstance(a, list)], "columns the page check already read are not read again"
    missing, _asked = _reader(agent_ns, tmp_path, [])
    missing._implement_space_columns = lambda tables: (_ for _ in ()).throw(RuntimeError("no table yet"))
    assert missing._implement_stored_choices(table, shell_sql) == [], "a first build has no table and no stored choices"


def test_the_notebook_page_check_rejects_a_page_that_drops_a_stored_choice(agent_ns, tmp_path):
    from v140_implement_test import _app_shell, _churn_page
    shell = _app_shell(agent_ns, tmp_path)[1]["shell_sql"]
    page = _churn_page(agent_ns)
    allowed = ["main.inspire.churn_out", "main.inspire.churn_out_reasons"]
    check = agent_ns["implement_app_page_problems"]
    assert not [p for p in check(page, shell, allowed, False) if "records already carry" in p]
    dropped = [p for p in check(page, shell, allowed, False, stored=["keep"]) if "records already carry" in p]
    assert dropped and "keep" in dropped[0]


def test_the_build_prompt_teaches_the_choices_with_the_validator_limits(agent_ns, tmp_path):
    from v140_implement_test import _app_shell
    shell = _app_shell(agent_ns, tmp_path)[1]["shell_sql"]
    rule = agent_ns["implement_choices_rule"](shell)
    for fragment in ("\"choices\"", "2 to 8", "at most 40 characters", "open, mine, all", "one the Done status", "carries reasons",
                     "Keep every choice id"):
        assert fragment in rule, fragment


def _impact_records(tmp_path, rows, columns, page=None):
    from v149_impact_test import Workspace, impact, shell
    status, out = impact(shell(tmp_path, Workspace(rows, columns), page=page))
    assert status == 200, out
    return {r["key"]: r for r in out["records"]}


def _chosen_rows():
    from v149_impact_test import ROWS
    picked = {"f1": "drop", "f2": "keep", "d1": "wrong"}
    return [dict(r, action_choice=picked.get(r["record_key"]) if r.get("action_status") else None) for r in ROWS]


def test_impact_closed_rows_carry_the_choice_people_picked(tmp_path):
    from v149_impact_test import COLUMNS
    records = _impact_records(tmp_path, _chosen_rows(), COLUMNS + ("action_choice",))
    assert {k: records[k]["choice"] for k in ("f1", "f2", "d1", "d2", "c1")} == {"f1": "drop", "f2": "keep", "d1": "wrong", "d2": None, "c1": None}
    assert records["f1"]["status"] == "Done" and records["d1"]["status"] == "Dismissed"


def test_impact_reads_a_table_from_before_the_choice_column_with_no_choice(tmp_path):
    from v149_impact_test import COLUMNS, ROWS
    assert "action_choice" not in COLUMNS
    records = _impact_records(tmp_path, ROWS, COLUMNS)
    assert set(records) == {"f1", "f2", "f3", "f4", "c1", "d1", "d2", "d3"}
    assert all(r["choice"] is None for r in records.values()), "a row with no stored choice falls back to its status label in the browser"


def test_the_default_five_statuses_close_exactly_as_before_with_the_choice_column(tmp_path):
    from v149_impact_test import COLUMNS, ROWS
    before = _impact_records(tmp_path / "old", ROWS, COLUMNS)
    after = _impact_records(tmp_path / "new", [dict(r, action_choice=None) for r in ROWS], COLUMNS + ("action_choice",))
    assert {k: dict(r, choice=None) for k, r in after.items()} == before
    assert {k: r["status"] for k, r in after.items()} == {"f1": "Done", "f2": "Done", "f3": "Done", "f4": "Done", "c1": "Could not fix",
                                                          "d1": "Dismissed", "d2": "Dismissed", "d3": "Dismissed"}


def test_the_closed_facts_keep_the_choice_and_older_facts_are_rebuilt_not_read():
    assert ("_inspire_choice", "STRING") in shell_facts.CLOSED_COLUMNS
    assert [n for n, _k in shell_facts.CLOSED_COLUMNS][:4] == ["_inspire_k", "_inspire_label", "_inspire_status", "_inspire_choice"]
    assert shell_facts.CHOICE_COLUMN in shell_facts.ACTED_COLUMNS
    assert shell_facts.FACTS_VERSION == 5
    old = {"v": 4, "log": "l", "acted": "a", "closed": "c", "changes": None, "actions": {}, "stamp_us": 0, "people": [], "numbers": {},
           "runs": [], "names": [], "columns": []}
    assert shell_facts.facts_problem(old) == "the latest run kept its counts in an older shape", \
        "a run's counts from before the choice column send the App to the live tables until the next run rebuilds them"
    sql = shell_facts.closed_rows_sql("main.s.t_acted", {"record_key", "action_status", "valid_from", "change_source"}, None)
    assert "CAST(NULL AS STRING) AS `_inspire_choice`" in sql, "an acted table without the column closes with no choice"
    assert "CAST(`action_choice` AS STRING) AS `_inspire_choice`" in shell_facts.closed_rows_sql(
        "main.s.t_acted", {"record_key", "action_status", "action_choice", "valid_from", "change_source"}, None)
