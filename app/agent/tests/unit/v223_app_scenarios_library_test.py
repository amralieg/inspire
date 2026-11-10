"""Saved scenarios in the App: the <result_table>_scenarios library, its parameterized SQL and the save, share and choose routes."""
import copy
import json
import os
import re
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_core  # noqa: E402
import shell_db  # noqa: E402
import shell_sql  # noqa: E402
from v141_app_shell_test import PAGE, SETTINGS, call  # noqa: E402
from v144_app_data_test import EDITOR, PERSON, shell  # noqa: E402
from v198_kind_layouts_test import SCENARIO, ScenarioWorkspace  # noqa: E402

PAGE_ID = "n01_u05"
OTHER = {"x-forwarded-email": "@".join(["sam.roe", "example.com"])}
INJECTION = "Plan'); DROP TABLE main.finance.margin_out; --"


def page():
    return dict(copy.deepcopy(SCENARIO), id=PAGE_ID)


def row(ident, action, by=PERSON, at="2026-11-01T10:00:00", **extra):
    return dict({"event_id": f"{at}-{action}-{ident}", "use_case_id": SCENARIO["use_case_id"], "scenario_id": ident, "action": action,
                 "changed_by": by, "changed_at": at}, **extra)


class LibraryWorkspace(ScenarioWorkspace):
    def __init__(self, events=None, missing=False, refuse=False):
        super().__init__()
        self.events, self.missing, self.refuse = list(events or []), missing, refuse

    def answer(self, sql, params):
        if "margin_out_scenarios" in sql and sql.startswith("SELECT"):
            if self.missing:
                raise shell_db.QueryError("[TABLE_OR_VIEW_NOT_FOUND] margin_out_scenarios")
            return {"columns": [], "rows": sorted(self.events, key=lambda r: r["changed_at"], reverse=True), "truncated": False}
        if "margin_out_scenarios" in sql and sql.startswith("INSERT"):
            if self.refuse:
                raise shell_db.QueryError("PERMISSION_DENIED: no MODIFY")
            cells = re.search(r"VALUES \((.*)\)$", sql).group(1).split(", ")
            by_name = {f":{p['name']}": p["value"] for p in params}
            made = {c: by_name.get(cell) for c, cell in zip(shell_sql.SCENARIO_COLUMNS, cells)}
            made["changed_at"] = f"2026-11-02T00:00:{len(self.events):02d}"
            self.events.append(made)
            return {"columns": [], "rows": [{"num_affected_rows": 1, "num_inserted_rows": 1}], "truncated": False}
        return super().answer(sql, params)


def started(tmp_path, **kwargs):
    tmp_path.mkdir(exist_ok=True)
    ws = LibraryWorkspace(**kwargs)
    s, _ws, _made = shell(tmp_path, settings=SETTINGS, pages=[page()], ws=ws)
    return s, ws


def test_the_scenarios_table_sits_next_to_the_result_table_and_its_reads_and_writes_carry_every_value_as_a_parameter():
    assert shell_sql.scenarios_table(page()).replace("`", "") == "main.finance.margin_out_scenarios"
    sql, params = shell_sql.scenario_events_query(page())
    assert "WHERE `use_case_id` = :p0" in sql and params == [{"name": "p0", "value": "N04-U01", "type": "STRING"}]
    assert sql.endswith(f"LIMIT {shell_sql.CAPS['scenario_events']}")
    sql, params = shell_sql.scenario_event_write(page(), {"event_id": "e" * 32, "scenario_id": "a" * 32, "action": "save", "name": INJECTION,
                                                          "lever_values": json.dumps({"price": 13}), "p50": 5.4e6, "changed_by": PERSON})
    assert INJECTION not in sql and "DROP" not in sql
    assert {"name": "p4", "value": INJECTION, "type": "STRING"} in params
    assert "CAST(NULL AS DOUBLE)" in sql and "CAST(NULL AS STRING)" in sql and "current_timestamp()" in sql
    assert any(p["type"] == "DOUBLE" and float(p["value"]) == 5.4e6 for p in params)
    assert len(re.search(r"VALUES \((.*)\)$", sql).group(1).split(", ")) == len(shell_sql.SCENARIO_COLUMNS)
    with pytest.raises(ValueError, match="one of save, share, unshare, choose"):
        shell_sql.scenario_event_write(page(), {"action": "delete"})


def test_the_scenario_statements_parse_as_databricks_sql():
    sqlglot = pytest.importorskip("sqlglot")
    for statement, _params in (shell_sql.scenario_events_query(page()),
                               shell_sql.scenario_event_write(page(), {"action": "choose", "scenario_id": "a" * 32, "note": "go"})):
        sqlglot.parse_one(re.sub(r":p\d+", "'x'", statement), read="databricks")


def test_the_library_shows_my_scenarios_and_shared_ones_and_only_the_saver_can_share():
    a, b, c = "a" * 32, "b" * 32, "c" * 32
    rows = [row(a, "save", name="Mine", lever_values=json.dumps({"price": 13, "flag": True}), p50=5.4e6, at="2026-11-01T10:00:01"),
            row(b, "save", by=OTHER["x-forwarded-email"], name="Theirs", at="2026-11-01T10:00:02"),
            row(c, "save", by=OTHER["x-forwarded-email"], name="Hidden", at="2026-11-01T10:00:03"),
            row(b, "share", by=OTHER["x-forwarded-email"], at="2026-11-01T10:00:04"),
            row(c, "share", by=PERSON, at="2026-11-01T10:00:05"),
            row(a, "share", at="2026-11-01T10:00:06"), row(a, "unshare", at="2026-11-01T10:00:07"),
            row(b, "choose", note="Go with it", at="2026-11-01T10:00:08"), row("z" * 32, "choose", at="2026-11-01T10:00:09")]
    library = shell_sql.scenario_library(rows, PERSON.upper())
    assert [s["name"] for s in library["scenarios"]] == ["Theirs", "Mine"], "a share by someone who did not save it does not count"
    mine = library["scenarios"][1]
    assert mine["mine"] and not mine["shared"] and mine["levers"] == {"price": 13} and mine["outcome"]["p50"] == 5.4e6
    assert library["mine"] == 1
    assert [(d["name"], d["note"]) for d in library["decisions"]] == [("Theirs", "Go with it")], "a choice of an unknown scenario is dropped"
    assert shell_sql.scenario_library([], PERSON) == {"scenarios": [], "decisions": [], "mine": 0}
    assert shell_sql.scenario_library([row(a, "save", lever_values="not json")], PERSON)["scenarios"][0]["levers"] == {}


def test_saving_a_scenario_re_evaluates_it_on_the_server_and_keeps_the_name_as_typed(tmp_path, capsys):
    s, ws = started(tmp_path)
    status, out = call(s, "POST", "scenario/save", headers=EDITOR,
                       body={"page": PAGE_ID, "name": f"  {INJECTION}  ", "note": "upside", "values": {"price": 13}})
    assert status == 200, out
    saved = out["scenarios"][0]
    assert saved["name"] == INJECTION and saved["mine"] and saved["outcome"]["p50"] == pytest.approx(5400000)
    assert saved["levers"]["price"] == 13
    assert len(ws.events) == 1 and ws.events[0]["changed_by"] == PERSON and re.fullmatch(r"[0-9a-f]{32}", ws.events[0]["scenario_id"])
    assert "[SCENARIO-SAVE FIRED] page=n01_u05 levers=3" in capsys.readouterr().out
    insert = next(sql for sql, _p in ws.queries("INSERT INTO"))
    assert "DROP" not in insert


@pytest.mark.parametrize("body, fragment", [
    ({"name": ""}, "name the scenario"),
    ({"name": "   "}, "name the scenario"),
    ({"name": 7}, "name the scenario"),
    ({"name": "x" * (shell_sql.SCENARIO_NAME_CHARS + 1)}, f"{shell_sql.SCENARIO_NAME_CHARS} characters"),
    ({"note": "n" * 301}, "note to 300 characters"),
    ({"note": ["list"]}, "note to 300 characters"),
    ({"values": [13]}, "object of at most"),
    ({"values": {f"l{i}": 1 for i in range(shell_sql.SCENARIO_LEVERS[1] + 1)}}, "object of at most"),
    ({"values": {"price": True}}, "finite number"),
    ({"values": {"price": "13"}}, "finite number"),
    ({"values": {"price": float("inf")}}, "finite number"),
    ({"values": {"price": 1e300}}, "finite number"),
])
def test_saving_refuses_a_bad_name_note_or_value_before_it_reads_or_writes_anything(tmp_path, body, fragment):
    s, ws = started(tmp_path)
    status, out = call(s, "POST", "scenario/save", headers=EDITOR, body=dict({"page": PAGE_ID, "name": "Plan", "values": {"price": 13}}, **body))
    assert status == 400 and fragment in out["error"], out
    assert ws.events == [] and ws.queries("margin_out_scenarios") == []


def test_saving_refuses_a_duplicate_name_and_more_than_the_cap_per_person(tmp_path):
    s, ws = started(tmp_path, events=[row("a" * 32, "save", name="Plan")])
    status, out = call(s, "POST", "scenario/save", headers=EDITOR, body={"page": PAGE_ID, "name": "plan", "values": {}})
    assert status == 409 and "already saved a scenario named" in out["error"]
    cap = shell_sql.CAPS["scenarios_per_person"]
    full = [row(f"{i:032x}", "save", name=f"S{i}", at=f"2026-10-01T00:{i // 60:02d}:{i % 60:02d}") for i in range(cap)]
    s, ws = started(tmp_path / "full", events=full)
    status, out = call(s, "POST", "scenario/save", headers=EDITOR, body={"page": PAGE_ID, "name": "One more", "values": {}})
    assert status == 409 and f"you saved {cap} scenarios" in out["error"]
    assert len(ws.events) == cap


def test_only_the_saver_shares_and_anyone_who_sees_a_scenario_can_choose_it(tmp_path, capsys):
    mine, theirs = "a" * 32, "b" * 32
    events = [row(mine, "save", name="Mine"), row(theirs, "save", by=OTHER["x-forwarded-email"], name="Theirs", at="2026-11-01T10:00:01"),
              row(theirs, "share", by=OTHER["x-forwarded-email"], at="2026-11-01T10:00:02")]
    s, ws = started(tmp_path, events=events)
    status, out = call(s, "POST", "scenario/share", headers=EDITOR, body={"page": PAGE_ID, "scenario_id": mine, "shared": True})
    assert status == 200 and next(x for x in out["scenarios"] if x["id"] == mine)["shared"] is True
    assert "[SCENARIO-SHARE FIRED]" in capsys.readouterr().out
    status, out = call(s, "POST", "scenario/share", headers=EDITOR, body={"page": PAGE_ID, "scenario_id": mine, "shared": True})
    assert status == 200 and len(ws.events) == 4, "sharing what is already shared writes nothing"
    status, out = call(s, "POST", "scenario/share", headers=EDITOR, body={"page": PAGE_ID, "scenario_id": theirs, "shared": False})
    assert status == 403 and "who saved the scenario" in out["error"]
    status, out = call(s, "POST", "scenario/share", headers=EDITOR, body={"page": PAGE_ID, "scenario_id": mine, "shared": "yes"})
    assert status == 400 and "shared as true or false" in out["error"]
    status, out = call(s, "POST", "scenario/choose", headers=EDITOR, body={"page": PAGE_ID, "scenario_id": theirs, "note": "Board agreed"})
    assert status == 200 and out["decisions"][0]["name"] == "Theirs" and out["decisions"][0]["note"] == "Board agreed"
    assert "[SCENARIO-CHOOSE FIRED]" in capsys.readouterr().out
    status, out = call(s, "GET", "scenario/saved", query={"page": PAGE_ID}, headers=OTHER)
    assert status == 200 and [x["name"] for x in out["scenarios"]] == ["Theirs", "Mine"] and out["note"] == ""


@pytest.mark.parametrize("ident, note, status_code, fragment", [
    ("not-an-id", "", 400, "scenario_id"),
    ("'; DROP TABLE x; --", "", 400, "scenario_id"),
    ("f" * 32, "", 404, "no saved scenario"),
    ("a" * 32, "n" * 301, 400, "note to 300"),
])
def test_marking_refuses_a_bad_id_an_unseen_scenario_and_a_long_note(tmp_path, ident, note, status_code, fragment):
    s, ws = started(tmp_path, events=[row("a" * 32, "save", name="Mine")])
    status, out = call(s, "POST", "scenario/choose", headers=EDITOR, body={"page": PAGE_ID, "scenario_id": ident, "note": note})
    assert status == status_code and fragment in out["error"], out
    assert len(ws.events) == 1


def test_a_missing_scenarios_table_reads_as_a_rebuild_note_and_a_save_says_nothing_was_saved(tmp_path):
    s, ws = started(tmp_path, missing=True)
    status, out = call(s, "GET", "scenario/saved", query={"page": PAGE_ID}, headers=EDITOR)
    assert status == 200 and out["scenarios"] == [] and "margin_out_scenarios" in out["note"] and "does not exist yet" in out["note"]
    status, out = call(s, "POST", "scenario/save", headers=EDITOR, body={"page": PAGE_ID, "name": "Plan", "values": {}})
    assert status == 409 and out["error"].startswith("Nothing was saved:")
    assert ws.events == []


def test_a_refused_write_names_the_scenarios_table_and_the_grant(tmp_path):
    s, _ws = started(tmp_path, refuse=True)
    status, out = call(s, "POST", "scenario/save", headers=EDITOR, body={"page": PAGE_ID, "name": "Plan", "values": {}})
    assert status == 403 and out["error"] == shell_core.REFUSED_WRITE
    assert "margin_out_scenarios" in out["details"] and "MODIFY" in out["details"]


def test_a_page_without_a_scenario_has_no_library(tmp_path):
    s, _ws, _made = shell(tmp_path, settings=SETTINGS, pages=[PAGE], ws=LibraryWorkspace())
    status, out = call(s, "GET", "scenario/saved", query={"page": PAGE_ID}, headers=EDITOR)
    assert status == 404 and "no scenario" in out["error"]
    assert shell_sql.SCENARIOS_SUFFIX == "_scenarios" and shell_sql.SCENARIO_ID.match("a" * 32) and not shell_sql.SCENARIO_ID.match("A" * 32)
