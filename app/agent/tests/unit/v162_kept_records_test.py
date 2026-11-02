import json
import os
import re
import sqlite3
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_sql
from _agentload import agent_source
from v141_app_shell_test import call
from v142_scd_test import CORE, HISTORY, QUOTED, _Tables
from v149_impact_test import COLUMNS as IMPACT_COLUMNS, PERSON, ROWS as IMPACT_ROWS, Workspace, impact, shell, v

sqlglot = pytest.importorskip("sqlglot")
exp = sqlglot.exp

FIXTURE = os.path.join(ROOT, "tests", "fixtures", "kept_records_cases.json")
CASES = json.load(open(FIXTURE, encoding="utf-8"))["cases"]
TABLE, STAGE = "main.inspire.kept_out", "main.inspire.kept_out_inspire_stage"
UC = "N01-U01"
STAGED = ["use_case_id", "run_id", "as_of_date", "entity_id", "entity_label", "priority_tier"]
TYPES = {"as_of_date": "DATE", "valid_from": "TIMESTAMP", "valid_to": "TIMESTAMP", "is_current": "BOOLEAN", "action_due": "DATE",
         "realized_value": "DOUBLE", "edited_by_person": "BOOLEAN", "not_listed_since": "TIMESTAMP"}
CLOCK = {"r-1": "2026-10-13 06:00:00", "r-2": "2026-10-20 06:00:00", "r-3": "2026-10-27 06:00:00"}
PERSON_AT = "2026-10-15 09:00:00"
EDITED_TIER = "Review"
KEPT = ("edited_by_person", "not_listed_since")


class Lite:
    def __init__(self):
        self.db = sqlite3.connect(":memory:")
        self.db.row_factory = sqlite3.Row
        self.now = CLOCK["r-1"]

    def rows(self, sql, args=()):
        return [dict(r) for r in self.db.execute(sql, args).fetchall()]

    def lite(self, node):
        return node.sql(dialect="sqlite").replace("CURRENT_TIMESTAMP", f"'{self.now}'")

    def run(self, sql):
        tree = sqlglot.parse_one(sql, read="databricks")
        for table in tree.find_all(exp.Table):
            table.set("catalog", None)
            table.set("db", None)
        if isinstance(tree, exp.Merge):
            return self.merge(tree)
        return self.rows(self.lite(tree))

    def holds(self, when, source, args):
        condition = when.args.get("condition")
        return condition is None or self.rows(f"SELECT CASE WHEN {self.lite(condition)} THEN 1 ELSE 0 END AS ok FROM {source}", args)[0]["ok"] == 1

    def merge(self, tree):
        target, t = tree.this.name, tree.this.alias
        using, u = tree.args["using"], tree.args["using"].alias
        self.db.execute("DROP TABLE IF EXISTS _src")
        self.db.execute(f"CREATE TEMP TABLE _src AS SELECT * FROM ({self.lite(using.this)})")
        pairs = self.rows(f"SELECT {t}.rowid AS tid, {u}.rowid AS sid FROM {target} AS {t} JOIN _src AS {u} ON {self.lite(tree.args['on'])}")
        assert len({p["tid"] for p in pairs}) == len(pairs), "Delta refuses a merge where two source rows match one target row"
        whens = tree.args["whens"].expressions
        plan = []
        for p in pairs:
            source = (f"{target} AS {t}, _src AS {u} WHERE {t}.rowid = ? AND {u}.rowid = ?", (p["tid"], p["sid"]))
            plan.append((next((w for w in whens if w.args.get("matched") and self.holds(w, *source)), None), p["tid"], source))
        hit = {p["tid"] for p in pairs}
        for (tid,) in self.db.execute(f"SELECT rowid FROM {target}").fetchall():
            if tid not in hit:
                source = (f"{target} AS {t} WHERE {t}.rowid = ?", (tid,))
                plan.append((next((w for w in whens if not w.args.get("matched") and w.args.get("source") and self.holds(w, *source)), None),
                             tid, source))
        used = {p["sid"] for p in pairs}
        for (sid,) in self.db.execute("SELECT rowid FROM _src").fetchall():
            if sid not in used:
                source = (f"_src AS {u} WHERE {u}.rowid = ?", (sid,))
                plan.append((next((w for w in whens if not w.args.get("matched") and not w.args.get("source") and self.holds(w, *source)),
                                  None), None, source))
        writes = []
        for when, tid, (source, args) in plan:
            if when is None:
                continue
            then = when.args["then"]
            if isinstance(then, exp.Insert):
                names, values = [c.name for c in then.this.expressions], then.expression.expressions
            else:
                names, values = [s.this.name for s in then.expressions], [s.expression for s in then.expressions]
            picked = ", ".join(f"{self.lite(x)} AS c{i}" for i, x in enumerate(values))
            got = self.rows(f"SELECT {picked} FROM {source}", args)[0]
            writes.append((tid, dict(zip(names, (got[f"c{i}"] for i in range(len(names)))))))
        for tid, values in writes:
            if tid is None:
                self.db.execute(f"INSERT INTO {target} ({', '.join(values)}) VALUES ({', '.join('?' for _ in values)})", list(values.values()))
            else:
                self.db.execute(f"UPDATE {target} SET {', '.join(f'{n} = ?' for n in values)} WHERE rowid = ?", [*values.values(), tid])
        return [{"num_affected_rows": len(writes)}]

    def columns(self, table):
        return [r["name"] for r in self.rows(f"PRAGMA table_info({table})")]


def _stage(lite, run, keys):
    lite.db.execute("DROP TABLE IF EXISTS kept_out_inspire_stage")
    lite.db.execute(f"CREATE TABLE kept_out_inspire_stage ({', '.join(STAGED)})")
    lite.db.executemany("INSERT INTO kept_out_inspire_stage VALUES (?, ?, ?, ?, ?, 'Act now')",
                        [(UC, run, CLOCK[run][:10], k, f"Item {k}") for k in keys])


def _first_run(ns, lite, keys):
    _stage(lite, "r-1", keys)
    lite.run(ns["inspire_history_create_sql"](TABLE, STAGE, STAGED, ("entity_id",)))


def _run(ns, lite, run, keys, replace):
    lite.now = CLOCK[run]
    _stage(lite, run, keys)
    lite.run(ns["inspire_history_merge_sql"](TABLE, STAGE, STAGED, ("entity_id",), UC, replace))
    if not replace:
        lite.run(ns["inspire_kept_marks_sql"](TABLE, STAGE, ("entity_id",), UC))


def _fields(lite):
    return shell_sql.change_fields([{"name": n, "type": TYPES.get(n, "STRING")} for n in lite.columns("kept_out")])


def _written(fields, source):
    records = [("k1", None)] if source == "add" else [("k1", "1")]
    values = {"edit": {"priority_tier": EDITED_TIER}, "add": {"entity_id": "k1"}, "action": {"action_status": "In progress"}, "delete": {}}
    sql, _params = shell_sql.version_write(TABLE, fields, source, records, PERSON, values[source])
    out = {}
    for name in KEPT:
        found = re.search(rf"(\S+) AS `{name}`", sql)
        assert found and found.group(1) in ("true", "NULL", f"b.`{name}`"), (source, name, sql[:400])
        out[name] = found.group(1)
    return out, values[source]


def _person(lite, key, source):
    rule, values = _written(_fields(lite), source)
    current = lite.rows("SELECT * FROM kept_out WHERE record_key = ? AND is_current", (key,))
    if source == "add":
        base = lite.rows("SELECT * FROM kept_out WHERE is_current ORDER BY as_of_date DESC LIMIT 1")[0]
        row = {n: (base[n] if n in shell_sql.RUN_COLUMNS else None) for n in base}
        row.update(entity_id=key, entity_label=f"Item {key}", priority_tier=EDITED_TIER)
    else:
        row = dict(current[0])
        lite.db.execute("UPDATE kept_out SET is_current = 0, valid_to = ? WHERE record_key = ? AND is_current", (PERSON_AT, key))
        row.update({k: x for k, x in values.items() if k != "entity_id"})
    for name, expr in rule.items():
        row[name] = 1 if expr == "true" else None if expr == "NULL" else row.get(name)
    row.update(record_key=key, valid_from=PERSON_AT, valid_to=None, is_current=1, change_source=source, changed_by=PERSON)
    lite.db.execute(f"INSERT INTO kept_out ({', '.join(row)}) VALUES ({', '.join('?' for _ in row)})", list(row.values()))


def _outcome(lite, key):
    rows = lite.rows("SELECT * FROM kept_out WHERE record_key = ? AND is_current", (key,))
    assert len(rows) <= 1, rows
    if not rows:
        return "closed", None
    row = rows[0]
    if row["change_source"] == "delete":
        return ("deleted" if row["not_listed_since"] is None else "deleted and tagged"), row
    if row["change_source"] == "run":
        return "rewritten", row
    return ("tagged" if row["not_listed_since"] else "kept"), row


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_what_a_run_does_to_a_record_people_touched_follows_one_rule_in_the_run_and_the_app(agent_ns, case):
    lite = Lite()
    first, *people = case["versions"]
    _first_run(agent_ns, lite, ["k1", "k2"] if first == "run" else ["k2"])
    for source in ([first] if first == "add" else []) + people:
        _person(lite, "k1", source)
    if case.get("left_before"):
        _run(agent_ns, lite, "r-2", ["k2"], case["replace_edits"])
        assert _outcome(lite, "k1")[0] == "tagged", "the run that left it out tags it"
    _run(agent_ns, lite, "r-3", ["k1", "k2"] if case["listed"] else ["k2"], case["replace_edits"])
    state, row = _outcome(lite, "k1")
    assert state == case["expect"], (case["name"], state, row)
    if state in ("kept", "tagged") and ("edit" in people or first == "add"):
        assert row["priority_tier"] == EDITED_TIER, "a kept record keeps the value the person gave it"
    if state == "tagged":
        assert row["not_listed_since"] == CLOCK["r-2" if case.get("left_before") else "r-3"], "the tag holds when the runs first left it out"
    if state == "rewritten" and "action" in people and not case["replace_edits"]:
        assert row["action_status"] == "In progress", "a run writes a record again with the action people recorded"
    other = _outcome(lite, "k2")
    assert other[0] == "rewritten" and other[1]["not_listed_since"] is None, "a record every run lists is never tagged"
    if not case["replace_edits"]:
        counted = lite.run(agent_ns["inspire_kept_edits_sql"](TABLE, UC))[0]
        assert int(counted["missing"] or 0) == (1 if state == "tagged" else 0)


def test_the_cases_cover_every_outcome_and_the_rule_each_side_owns():
    assert {c["expect"] for c in CASES} == {"closed", "tagged", "kept", "rewritten", "deleted"}
    unedited = [c for c in CASES if c["versions"][-1] in ("run", "action") and "edit" not in c["versions"] and not c["listed"]]
    assert unedited and all(c["expect"] == "closed" for c in unedited), "a record no person changed that left the list is closed, never tagged"


def test_a_person_s_edit_or_add_marks_the_record_and_an_action_or_delete_carries_the_mark():
    names = ["entity_id", "entity_label", "priority_tier", "use_case_id", "run_id", "as_of_date", "action_status", *shell_sql.HISTORY_COLUMNS, *KEPT]
    fields = shell_sql.change_fields([{"name": n, "type": TYPES.get(n, "STRING")} for n in names])
    assert {f["name"]: (f["role"], f["editable"]) for f in fields if f["name"] in KEPT} == {n: ("kept", False) for n in KEPT}
    written = {source: _written(fields, source)[0] for source in ("edit", "add", "action", "delete")}
    assert written["edit"] == {"edited_by_person": "true", "not_listed_since": "b.`not_listed_since`"}
    assert written["add"] == {"edited_by_person": "true", "not_listed_since": "NULL"}, "a new record is not tagged until a run leaves it out"
    assert written["action"] == {n: f"b.`{n}`" for n in KEPT}, "an action keeps what the record was: edited, and tagged or not"
    assert written["delete"] == {n: f"b.`{n}`" for n in KEPT}


def test_a_run_marks_the_records_it_keeps_after_its_merge_and_says_how_many_are_not_in_it(agent_ns):
    tables = _Tables(agent_ns, target=CORE + HISTORY + [(n, k.lower()) for n, k in agent_ns["INSPIRE_KEPT_COLUMNS"]])
    respond = tables.respond
    tables.spark.responder = lambda s: [{"kept": 3, "missing": 2}] if s.startswith("SELECT COUNT(*) AS kept") else respond(s)
    _rows, printed = tables.run()
    merges = [i for i, s in enumerate(tables.spark.statements) if s.startswith(f"MERGE INTO {QUOTED} ")]
    assert len(merges) == 2 and "u._inspire_key FROM `main`.`inspire`.`churn_out_inspire_stage`" not in tables.spark.statements[merges[0]]
    marks = tables.spark.statements[merges[1]]
    assert marks == agent_ns["inspire_kept_marks_sql"]("main.inspire.churn_out", "main.inspire.churn_out_inspire_stage", ("entity_id",), "N01-U01")
    counted = tables.index("SELECT COUNT(*) AS kept")
    assert counted > merges[1], "the counts are read after both merges, so they say what the table holds now"
    assert ("kept 3 records people changed in the App, since runs keep those changes; 2 of them are not in this run, so the App tags "
            "them 'Not in the latest run'") in printed[-3]


def test_a_run_that_replaces_edits_marks_nothing(agent_ns):
    tables = _Tables(agent_ns, target=CORE + HISTORY, properties={"inspire.replace_edits": "true"})
    _rows, printed = tables.run()
    assert len([s for s in tables.spark.statements if s.startswith(f"MERGE INTO {QUOTED} ")]) == 1
    assert tables.index("SELECT COUNT(*) AS kept") is None and "runs replace the records people changed in the App" in printed[-3]


def test_a_new_result_table_keeps_the_marks_and_the_run_owns_them(agent_ns):
    created = agent_ns["inspire_history_create_sql"](TABLE, STAGE, STAGED, ("entity_id",))
    assert "CAST(NULL AS BOOLEAN) AS `edited_by_person`, CAST(NULL AS TIMESTAMP) AS `not_listed_since`" in created
    assert dict(agent_ns["INSPIRE_KEPT_COLUMNS"]) == {n: shell_sql.KEPT_TYPES[n] for n in KEPT}, "the run and the App name the marks alike"
    assert agent_ns["INSPIRE_KEPT_COLUMNS"][1][0] == shell_sql.KEPT_SINCE
    web = open(os.path.join(ROOT, "agent", "app_shell", "web", "src", "records.js"), encoding="utf-8").read()
    assert f"export const NOT_IN_RUN = '{agent_ns['INSPIRE_NOT_IN_RUN']}';" in web, "the run log and the App say the same tag"
    assert "and not_listed_since is when the runs stopped listing such a " in agent_source(), "the use case brief names the marks"


KEPT_ROWS = [
    v("e1", "Act now", 400.0, "r3", current=False, ends="2026-10-15 09:00:00", held_back=0, run_tier="Act now"),
    v("e1", "Review", 400.0, "r3", at="2026-10-15 09:00:00", source="edit", held_back=0, run_tier="Act now", edited_by_person=1,
      not_listed_since="2026-10-20 06:00:00"),
    v("g1", "Act now", 900.0, "r3", current=False, ends="2026-10-14 10:00:00", held_back=0, run_tier="Act now"),
    v("g1", "Act now", 900.0, "r3", at="2026-10-14 10:00:00", source="action", current=False, ends="2026-10-15 10:00:00",
      action_status="Done", held_back=0, run_tier="Act now"),
    v("g1", "Review", 900.0, "r3", at="2026-10-15 10:00:00", source="edit", action_status="Done", held_back=0, run_tier="Act now",
      edited_by_person=1, not_listed_since="2026-10-20 06:00:00"),
]


def _kept_workspace(rows=None):
    return Workspace(IMPACT_ROWS + KEPT_ROWS if rows is None else rows, IMPACT_COLUMNS)


def test_today_records_impact_and_the_record_panel_read_the_tag_of_a_kept_record_and_only_of_it(tmp_path):
    ws = _kept_workspace()
    s = shell(tmp_path, ws)
    status, out = call(s, "POST", "overview", headers={"x-forwarded-email": PERSON}, body={})
    items = {i["key"]: i for i in out["pages"]["n01_u05"]["items"]}
    assert status == 200 and items["e1"]["not_listed_since"] and items["a1"]["not_listed_since"] is None, "Today tags only the kept record"
    status, listed = call(s, "POST", "records", headers={"x-forwarded-email": PERSON},
                          body={"page": "n01_u05", "filters": {}, "limit": 50, "sort": {"key": "rank", "dir": "asc"}})
    rows = {r["record_key"]: r for r in listed["rows"]}
    assert status == 200, listed
    assert rows["e1"]["_inspire_missing"] and rows["a1"]["_inspire_missing"] is None and listed["summary"]["kept"] == 2
    assert "f2" not in rows, "an unedited record that left the list is closed, so the list never shows it"
    status, found = call(s, "GET", "records/history", query={"page": "n01_u05", "record_key": "e1"}, headers={"x-forwarded-email": PERSON})
    assert status == 200 and found["current"]["not_listed_since"], "the record panel reads the tag from the current version"
    status, out = impact(s)
    records = {r["key"]: r for r in out["records"]}
    assert status == 200 and records["g1"]["state"] == "missing" and records["f2"]["state"] == "left", \
        "a fixed record the runs stopped listing reads Not in the latest run; one that left unedited still reads Left the list"
    assert records["g1"]["now"] == 0 and records["g1"]["measured"] == 900.0, "no later run finds it, so the whole amount counts as measured"
    assert out["outcomes"]["missing"] == 1 and out["outcomes"]["left"] == 1


def test_a_table_with_no_record_left_out_reads_the_tag_column_and_finds_none(tmp_path):
    assert set(KEPT) <= set(IMPACT_COLUMNS), "every result table this version builds has the tag columns"
    status, out = impact(shell(tmp_path, Workspace()))
    assert status == 200 and out["outcomes"]["missing"] == 0
    status, listed = call(shell(tmp_path / "list", Workspace()), "POST", "records", headers={"x-forwarded-email": PERSON},
                          body={"page": "n01_u05", "filters": {}, "limit": 50, "sort": {"key": "rank", "dir": "asc"}})
    assert status == 200 and listed["rows"] and all(r["_inspire_missing"] is None for r in listed["rows"])
    assert listed["summary"]["kept"] == 0
