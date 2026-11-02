import copy
import json
import re

import pytest

from v141_app_shell_test import SETTINGS, call
from v148_app_hub_test import COLUMNS, PERSON, ROWS, TABLE, TYPES, SqliteWorkspace, hub_page, hub_shell, overview, to_sqlite
import shell_core
import shell_facts
import shell_pg
import shell_sql

sqlglot = pytest.importorskip("sqlglot")

OWNER = "@".join(["owner", "example.com"])
SAM = "@".join(["sam.ortiz", "example.com"])
MONEY_COLUMNS = COLUMNS + ("units",)
SUMMARY_COLUMNS = ("use_case_id", "run_id", "currency", "decision_basis", "act_now_amount", "review_amount", "nothing_to_act",
                   "value_formula", "value_expression", "value_assumptions", "updated_at")
FORMULA = "{units:number} units lost x {PRICE:money} a unit x {KEEP:percent} kept"
EXPRESSION = "greatest(0, units * PRICE * KEEP)"
ASSUMPTIONS = json.dumps([{"name": "PRICE", "value": 20.0, "kind": "money"}, {"name": "KEEP", "value": 0.5, "kind": "percent"}])
FIELD_TYPES = {"units": "DOUBLE", "rank": "INT", "value_at_stake": "DOUBLE"}


def _fields(names=MONEY_COLUMNS):
    return shell_sql.change_fields([{"name": n, "type": dict(TYPES, **FIELD_TYPES).get(n, "STRING")} for n in names])


def _summary(**changes):
    return dict({"use_case_id": "N01-U05", "run_id": "r4", "currency": "USD", "decision_basis": "measured", "act_now_amount": 800.0,
                 "review_amount": 200.0, "nothing_to_act": None, "value_formula": FORMULA, "value_expression": EXPRESSION,
                 "value_assumptions": ASSUMPTIONS, "updated_at": "2026-10-20 07:00:00"}, **changes)


class MoneyWorkspace(SqliteWorkspace):
    def __init__(self, summary=None, edits=None, assumptions=True):
        super().__init__(tables={})
        rows = [dict(r, units=(r["value_at_stake"] or 0) / 10) for r in ROWS]
        self.db.execute(f'CREATE TABLE "loss_desk_out" ({", ".join(chr(34) + c + chr(34) for c in MONEY_COLUMNS)})')
        self.db.executemany(f'INSERT INTO "loss_desk_out" VALUES ({", ".join("?" for _ in MONEY_COLUMNS)})',
                            [tuple(r[c] for c in MONEY_COLUMNS) for r in rows])
        self.db.execute(f'CREATE TABLE "loss_desk_out_summary" ({", ".join(chr(34) + c + chr(34) for c in SUMMARY_COLUMNS)})')
        if summary is not False:
            row = summary or _summary()
            self.db.execute(f'INSERT INTO "loss_desk_out_summary" VALUES ({", ".join("?" for _ in SUMMARY_COLUMNS)})',
                            tuple(row[c] for c in SUMMARY_COLUMNS))
        if assumptions:
            self.db.execute('CREATE TABLE "loss_desk_out_assumptions" (use_case_id, name, value, changed_by, changed_at, note)')
            self.db.executemany('INSERT INTO "loss_desk_out_assumptions" VALUES (?, ?, ?, ?, ?, ?)', edits or [])

    def run_sql(self, warehouse, sql, params, limit=5000):
        if sql.startswith("INSERT INTO"):
            with self.lock:
                self.sql.append((sql, params, limit))
                self.db.execute(to_sqlite(sql), {p["name"]: p["value"] for p in params})
            return {"columns": [], "rows": [{"num_affected_rows": 1, "num_inserted_rows": 1}], "truncated": False}
        out = super().run_sql(warehouse, sql, params, limit)
        for column in out["columns"]:
            if column["name"] in FIELD_TYPES:
                column["type"] = column["type_text"] = FIELD_TYPES[column["name"]]
        return out


def _shell(tmp_path, ws=None, settings=None):
    page = hub_page(records={"title": "Things to fix", "key": "entity_id", "label": "entity_label", "rank": "rank", "tier": "priority_tier",
                             "columns": [{"column": "value_at_stake", "label": "Could save", "format": "currency", "currency": "USD"}]})
    return hub_shell(tmp_path, settings=settings or dict(SETTINGS, options={"modify": False, "replace_edits": False, "decisions": True},
                                                        use_case_owners={"n01_u05": [OWNER]}),
                     pages=[page], ws=ws or MoneyWorkspace())


def test_the_money_model_reads_the_formula_its_arithmetic_and_the_latest_value_of_each_assumption():
    edits = [{"name": "PRICE", "value": "25", "changed_by": SAM, "changed_at": "2026-10-23 09:00:00", "note": "new list price"},
             {"name": "PRICE", "value": 22.0, "changed_by": OWNER, "changed_at": "2026-10-22 09:00:00", "note": ""},
             {"name": "GONE", "value": 3.0, "changed_by": OWNER, "changed_at": "2026-10-22 09:00:00", "note": ""}]
    model = shell_sql.money_model(_summary(), _fields(), edits)
    assert model["recomputes"] is True and model["changed"] is True and model["problem"] == ""
    assert model["parts"] == [{"column": "units", "kind": "number"}, {"text": " units lost x "}, {"assumption": "PRICE", "kind": "money"},
                              {"text": " a unit x "}, {"assumption": "KEEP", "kind": "percent"}, {"text": " kept"}]
    assert [(a["name"], a["value"], a["run_value"], a["changed_by"], a["note"]) for a in model["assumptions"]] == [
        ("PRICE", 25.0, 20.0, SAM, "new list price"), ("KEEP", 0.5, 0.5, "", "")], "the newest edit wins and an unknown name is dropped"
    assert (model["columns"], model["inputs"], model["currency"], model["act_now_amount"]) == (["units"], "columns", "USD", 800.0)
    shown = shell_sql.public_money(model)
    assert "_tree" not in shown and "_numeric" not in shown and json.dumps(shown)
    assert shell_sql.money_sql(model) == ("CASE WHEN `value_at_stake` IS NULL THEN NULL ELSE GREATEST(0.0, ((CAST(`units` AS DOUBLE) * 25.0) "
                                          "* 0.5)) END")
    assert shell_sql.money_inputs_sql(model) == "concat_ws('|', COALESCE(CAST(`units` AS STRING), ''))"
    unchanged = shell_sql.money_model(_summary(), _fields(), [])
    assert unchanged["changed"] is False and shell_sql.money_sql(unchanged) == "CAST(`value_at_stake` AS DOUBLE)", \
        "with no change the App shows exactly the money the run wrote"


@pytest.mark.parametrize("changes,problem", [
    ({"value_assumptions": None}, "the money at stake formula of this use case names no assumption"),
    ({"value_assumptions": "not json"}, "the money at stake formula of this use case names no assumption"),
    ({"value_expression": None}, "the notebook was built before the App could work out the money again; build its money at stake formula again with Edit MVP on Inspire's Build page"),
    ({"value_expression": "units * PRICE * KEEP; DROP TABLE x"}, "the money at stake arithmetic cannot be read: '; DROP TABLE x' is not a number"),
    ({"value_expression": "units * PRICE * KEEP * secret_column"}, "the money at stake arithmetic names secret_column, which is neither"),
    ({"value_expression": "entity_label * PRICE * KEEP"}, "the money at stake arithmetic names entity_label, which is neither"),
    ({"value_expression": "sleep(units) * PRICE"}, "the money at stake arithmetic cannot be read: sleep( ) is not greatest( ) or least( )"),
])
def test_arithmetic_the_app_cannot_trust_keeps_the_money_the_run_wrote(changes, problem):
    model = shell_sql.money_model(_summary(**changes), _fields(), [{"name": "PRICE", "value": 99.0}])
    assert model["recomputes"] is False and model["problem"].startswith(problem), model["problem"]
    assert shell_sql.money_sql(model) == "CAST(`value_at_stake` AS DOUBLE)"


def test_an_old_notebook_shows_the_formula_text_it_wrote_on_each_record():
    names = MONEY_COLUMNS + ("value_at_stake_formula",)
    model = shell_sql.money_model(_summary(value_formula=None, value_expression=None, value_assumptions=None), _fields(names), [])
    assert (model["inputs"], model["parts"]) == ("said", [])
    assert shell_sql.money_inputs_sql(model, "t") == "CAST(t.`value_at_stake_formula` AS STRING)"
    assert shell_sql.money_inputs_sql(shell_sql.money_model(None, _fields(), [])) == "CAST(NULL AS STRING)"
    assert shell_sql.money_columns(None) == []


def test_the_list_and_the_overview_show_the_money_an_assumption_change_gives(tmp_path):
    ws = MoneyWorkspace(edits=[("N01-U05", "PRICE", 30.0, SAM, "2026-10-23 09:00:00", "")])
    s, ws, _made = _shell(tmp_path, ws)
    status, out = call(s, "POST", "records", headers={"x-forwarded-email": PERSON}, body={"page": "n01_u05", "limit": 25})
    assert status == 200, out
    by_key = {r["record_key"]: r for r in out["rows"]}
    assert by_key["k2"]["value_at_stake"] == 5000.0 and by_key["k2"]["_inspire_money"] == 7500.0, "500 units x 30 x 0.5"
    assert by_key["k2"]["_inspire_fx"] == "500.0"
    assert out["money"]["assumptions"][0]["value"] == 30.0 and out["money"]["recomputes"] is True
    status, hub = overview(s)
    page = hub["pages"]["n01_u05"]
    assert [(i["key"], i["money"], i["fx"]) for i in page["items"]][:2] == [("k2", 7500.0, "500.0"), ("k1", 1350.0, "90.0")]
    assert page["money_model"]["assumptions"][0]["changed_by"] == SAM
    _, sorted_out = call(s, "POST", "records", headers={"x-forwarded-email": PERSON},
                         body={"page": "n01_u05", "limit": 3, "sort": {"key": "value_at_stake", "dir": "desc"}})
    assert [r["record_key"] for r in sorted_out["rows"]] == ["k2", "k6", "k1"], "7,500 then 3,000 then 1,350 after the change"
    sorts = [sql for sql, _p in ws.queries("ORDER BY `_inspire_money` DESC")]
    assert sorts, "sorting by the money sorts by the money the App shows"


def test_after_an_assumption_change_the_money_order_joins_only_the_top_records_and_reads_every_record_when_they_leave_the_page_short(
        tmp_path, monkeypatch):
    ws = MoneyWorkspace(edits=[("N01-U05", "PRICE", 30.0, SAM, "2026-10-23 09:00:00", "")])
    s, ws, _made = _shell(tmp_path, ws)
    headers, body = {"x-forwarded-email": PERSON}, {"page": "n01_u05", "limit": 3, "sort": {"key": "value_at_stake", "dir": "desc"}}
    status, out = call(s, "POST", "records", headers=headers, body=body)
    assert status == 200 and [r["record_key"] for r in out["rows"]] == ["k2", "k6", "k1"], out
    cut = "AS c0 ORDER BY `_inspire_money` DESC NULLS LAST, `_inspire_key` ASC LIMIT 1000)"
    listed = [sql for sql, _p in ws.queries(" OFFSET 0)")]
    assert len(listed) == 1 and cut in listed[0] and " FROM d JOIN c ON " in listed[0], \
        "the list joins only the top thousand current records by the money it shows, never every record"
    monkeypatch.setattr(shell_facts, "FLOOR_DEPTHS", (3,))
    monkeypatch.setattr(shell_facts, "FLOOR_MARGIN", 1)
    ws.sql.clear()
    status, out = call(s, "POST", "records", headers=headers, body=dict(body, filters={"run_date": {"from": "2026-10-01", "to": "2026-10-31"}}))
    assert status == 200 and [r["record_key"] for r in out["rows"]] == ["k2", "k1", "k9"], out
    listed = [sql for sql, _p in ws.queries(" OFFSET 0)")]
    assert len(listed) == 2 and "AS c0 ORDER BY `_inspire_money` DESC NULLS LAST, `_inspire_key` ASC LIMIT 3)" in listed[0] and " AS c0 " not in listed[1], \
        "k6 is in the top three but outside the dates, so the page is short and the App reads every record once more"


@pytest.mark.parametrize("route", ["filters", "defaults"])
def test_opening_a_page_reads_what_its_list_needs_so_the_first_records_wait_on_no_schema_or_assumption_read(tmp_path, route):
    from v165_scale_test import Recorder
    s, ws, _made = _shell(tmp_path)
    s.stamp_pool = Recorder()
    headers = {"x-forwarded-email": PERSON}
    assert call(s, "GET", route, query={"page": "n01_u05"}, headers=headers)[0] == 200
    assert len(ws.queries("LIMIT 0")) == 2 and len(ws.queries("`loss_desk_out_assumptions`")) == 1, ws.sql
    ws.sql.clear()
    status, out = call(s, "POST", "records", headers=headers, body={"page": "n01_u05", "limit": 25})
    assert status == 200 and out["rows"], out
    assert not ws.queries("LIMIT 0") and not ws.queries("`loss_desk_out_assumptions`"), \
        "the page open already read the list's columns, the table's columns and the assumptions"


@pytest.mark.parametrize("order", [(26.0, 30.0), (30.0, 26.0)])
def test_two_edits_of_one_assumption_at_the_same_instant_give_one_value_in_the_panel_and_the_money(tmp_path, order):
    ws = MoneyWorkspace(edits=[("N01-U05", "PRICE", value, who, "2026-10-23 09:00:00", "") for value, who in zip(order, (SAM, OWNER))])
    s, ws, _made = _shell(tmp_path, ws)
    status, out = call(s, "POST", "records", headers={"x-forwarded-email": PERSON}, body={"page": "n01_u05", "limit": 25})
    assert status == 200, out
    assert out["money"]["assumptions"][0]["value"] == 30.0, "the same value whichever edit was written first"
    assert {r["record_key"]: r["_inspire_money"] for r in out["rows"]}["k2"] == 7500.0, "the money uses the value the panel shows: 500 x 30 x 0.5"
    assert shell_sql.assumption_order("a") == "a.`changed_at` DESC, a.`value` DESC"


def test_a_second_look_reads_the_cached_money_model(tmp_path):
    s, ws, _made = _shell(tmp_path, MoneyWorkspace(summary=False))
    overview(s)
    first = len(ws.sql)
    assert len(ws.queries("`loss_desk_out_summary`")) == 1
    overview(s)
    assert len(ws.sql) == first, "a missing summary is not read again within a minute"


def test_the_owner_sees_and_changes_an_assumption_with_its_history(tmp_path):
    s, ws, _made = _shell(tmp_path)
    status, out = call(s, "GET", "money", query={"page": "n01_u05"}, headers={"x-forwarded-email": OWNER})
    assert status == 200 and out["editable"] is True and out["why"] == "" and out["history"] == []
    status, out = call(s, "POST", "money/assumption", headers={"x-forwarded-email": OWNER},
                       body={"page": "n01_u05", "name": "PRICE", "value": 24, "was": 20, "note": "  list price went up  "})
    assert status == 200, out
    (sql, params), = ws.queries("INSERT INTO `main`.`pricing`.`loss_desk_out_assumptions`")
    assert [p["value"] for p in params] == ["N01-U05", "PRICE", "24.0", OWNER, "list price went up"]
    assert out["model"]["assumptions"][0]["value"] == 24.0 and out["model"]["changed"] is True
    assert [(h["name"], h["value"], h["changed_by"], h["note"], h["kind"]) for h in out["history"]] == [
        ("PRICE", 24.0, OWNER, "list price went up", "money")]
    _, rows = call(s, "POST", "records", headers={"x-forwarded-email": PERSON}, body={"page": "n01_u05", "limit": 25})
    assert {r["record_key"]: r["_inspire_money"] for r in rows["rows"]}["k2"] == 6000.0, "the change clears the cache, so the list follows it"


@pytest.mark.parametrize("who,body,status,error", [
    (SAM, {"name": "PRICE", "value": 24, "was": 20}, 403, "Only the owners of this use case can change its assumptions"),
    (None, {"name": "PRICE", "value": 24, "was": 20}, 401, "sign in so the App can record who made the change"),
    (OWNER, {"name": "PRICE", "value": 24, "was": 21}, 409, "PRICE changed to 20 since you opened it; check it and save again"),
    (OWNER, {"name": "KEEP", "value": 1.5, "was": 0.5}, 400, "KEEP is a share, so it takes a number from 0 to 1, such as 0.25 for 25%"),
    (OWNER, {"name": "RATE", "value": 1, "was": 1}, 400, "this use case has no assumption 'RATE'; its assumptions: PRICE, KEEP"),
    (OWNER, {"name": "PRICE", "value": "24", "was": 20}, 400, "send value as a number"),
    (OWNER, {"name": "PRICE", "value": True, "was": 20}, 400, "send value as a number"),
    (OWNER, {"name": "PRICE", "value": 24}, 400, "send was, the value you saw before your change"),
    (OWNER, {"name": "PRICE", "value": 20, "was": 20}, 400, "PRICE is already 20"),
    (OWNER, {"name": "PRICE", "value": 24, "was": 20, "note": "x" * 301}, 400, "keep the note to 300 characters"),
    (OWNER, {"name": "PRICE", "value": 1e16, "was": 20}, 400, "the value is too large"),
])
def test_a_change_that_is_not_allowed_or_not_valid_writes_nothing(tmp_path, who, body, status, error):
    s, ws, _made = _shell(tmp_path)
    headers = {"x-forwarded-email": who} if who else {}
    assert call(s, "POST", "money/assumption", headers=headers, body=dict(body, page="n01_u05")) == (status, {"error": error})
    assert not ws.queries("INSERT INTO")


def test_an_owner_the_app_records_for_the_use_case_may_change_and_an_old_notebook_may_not(tmp_path):
    s, _ws, _made = _shell(tmp_path / "a", settings=dict(SETTINGS, use_case_owners={"n01_u05": [SAM.upper()]},
                                                          options={"modify": False, "replace_edits": False, "decisions": True}))
    assert call(s, "GET", "money", query={"page": "n01_u05"}, headers={"x-forwarded-email": SAM})[1]["editable"] is True
    assert call(s, "GET", "money", query={"page": "n01_u05"}, headers={"x-forwarded-email": OWNER})[1]["why"] == (
        "Only the owners of this use case can change its assumptions"), "the person who built the App is not an owner by that alone"
    old = MoneyWorkspace(summary=_summary(value_expression=None))
    s, ws, _made = _shell(tmp_path / "b", old)
    out = call(s, "GET", "money", query={"page": "n01_u05"}, headers={"x-forwarded-email": OWNER})[1]
    assert out["editable"] is False and out["why"].startswith("the notebook was built before the App could work out the money again")
    status, body = call(s, "POST", "money/assumption", headers={"x-forwarded-email": OWNER},
                        body={"page": "n01_u05", "name": "PRICE", "value": 24, "was": 20})
    assert status == 409 and body["error"] == out["why"] and not ws.queries("INSERT INTO")
    nobody = dict(SETTINGS, use_case_owners={}, options={"modify": False, "replace_edits": False, "decisions": True})
    s, _ws, _made = _shell(tmp_path / "c", settings=nobody)
    assert call(s, "GET", "money", query={"page": "n01_u05"}, headers={"x-forwarded-email": OWNER})[1]["why"] == (
        "No one can change the assumptions of this use case, because the App names no owner of it; build it again with Edit MVP on Inspire's Build page")


def test_the_money_queries_parse_as_databricks_sql_and_render_for_lakebase():
    page, fields = hub_page(), _fields()
    model = shell_sql.money_model(_summary(), fields, [{"name": "PRICE", "value": 30.0}])
    context = dict(shell_sql.list_context(page, set(MONEY_COLUMNS), fields, True), money=shell_sql.money_columns(model))
    request = shell_sql.list_request(page, {"sort": {"key": "value_at_stake", "dir": "desc"}}, context)
    plan = shell_sql.list_queries(page, {}, request, context)
    overview_sql, overview_params = shell_sql.overview_query(page, {}, {}, context, fields, "2026-10-01", "2026-08-03", model)
    held = {TABLE: {"pg": "app.loss_desk_out", "columns": [{"name": c} for c in MONEY_COLUMNS]},
            TABLE + "_assumptions": {"pg": "app.loss_desk_out_assumptions", "columns": [{"name": c} for c in
                                                                                        ("use_case_id", "name", "value", "changed_by", "changed_at", "note")]}}
    for sql, params in (plan["rows"], plan["total"], (overview_sql, overview_params), shell_sql.assumptions_query(page)):
        sqlglot.parse_one(re.sub(r":p\d+", "'x'", sql), read="databricks")
        text, _values, _read = shell_pg.render(sql, params, held)
        assert ("GREATEST(" in text or "assumptions" in text) is (sql != plan["total"][0]), \
            "every money statement carries the money the App shows, and the count of a list sorted by the money carries none"
    sql, params = shell_sql.assumption_write(page, "PRICE", 30.0, OWNER, "")
    sqlglot.parse_one(re.sub(r":p\d+", "'x'", sql), read="databricks")
    assert params[2] == {"name": "p2", "value": "30.0", "type": "DOUBLE"}
