import copy
import json
import os
import re
import sys
import threading

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_core
import shell_db
import shell_facts
import shell_sql
from v141_app_shell_test import PAGE, SETTINGS, FakeWorkspace, app_dir, call
from v142_edits_test import COLUMNS, edit_page

PERSON = "@".join(["pat.lee", "example.com"])
OTHER = "@".join(["sam.roe", "example.com"])
EDITOR = {"x-forwarded-email": PERSON}
CONTRACT = {"action_owner": "STRING", "action_status": "STRING", "action_choice": "STRING", "action_due": "DATE", "action_note": "STRING", "dismiss_reason": "STRING",
            "action_outcome": "STRING", "snooze_until": "DATE", "action_batch": "STRING", "action_batch_note": "STRING",
            "action_batch_values": "STRING", "joined_at": "TIMESTAMP"}
ACTION_COLUMNS = [{"name": n, "type": t, "type_text": t} for n, t in CONTRACT.items()]
TRACKED = COLUMNS + ACTION_COLUMNS + [{"name": n, "type": t, "type_text": t} for n, t in {**shell_sql.CLOSE_TYPES, **shell_sql.KEPT_TYPES}.items()]
DECIDE = dict(SETTINGS, options=dict(SETTINGS["options"], decisions=True))
MODIFY = dict(SETTINGS, options=dict(SETTINGS["options"], modify=True))
LISTED = [{"name": n, "type": "STRING"} for n in ("record_key", "entity_id", "entity_label", "priority_tier", "rank", "category", "value",
                                                  "as_of_date")]
SLOW = ("page n01_u05: {} took {} s at the default filters; read fewer rows: filter on the result table's clustered columns or aggregate "
        "in the dataset")
THIS_BATCH = "this act"


class Clock:
    def __init__(self):
        self.at = {}

    def __call__(self):
        return self.at.get(threading.get_ident(), 0.0)

    def spend(self, seconds):
        ident = threading.get_ident()
        self.at[ident] = self.at.get(ident, 0.0) + seconds


class DataWorkspace(FakeWorkspace):
    def __init__(self, columns=None, listed=None, rows=None, total=0, inserted=None, current=None, impact=None, left=0, owners=(),
                 options=None, fail=None, clock=None, slow=None, barrier=None):
        super().__init__()
        self.columns = TRACKED if columns is None else columns
        self.listed = LISTED if listed is None else listed
        self.rows = [{"record_key": "k1", "entity_label": "Item 1"}] if rows is None else rows
        self.total, self.inserted, self.current = total, inserted, current or []
        self.impact = impact or {"open_n": 0, "done_n": 0, "resolved_n": 0}
        self.left, self.owners, self.options, self.fail = left, list(owners), options, fail or {}
        self.clock, self.slow, self.barrier = clock, slow, barrier

    def answer(self, sql, params):
        if sql.endswith("AS d LIMIT 0"):
            return {"columns": self.listed, "rows": [], "truncated": False}
        if sql.endswith("LIMIT 0"):
            return {"columns": self.columns, "rows": [], "truncated": False}
        if sql.startswith("MERGE INTO"):
            self.batch = next((p["value"] for p in params if re.fullmatch(r"[0-9a-f]{32}", str(p["value"]))), None)
            if "merge" in self.fail:
                raise self.fail["merge"]
            inserted = len(json.loads(params[-1]["value"])) if self.inserted is None else self.inserted
            return {"columns": [], "rows": [{"num_inserted_rows": inserted, "num_updated_rows": inserted}], "truncated": False}
        if "SELECT explode(from_json(" in sql:
            rows = [dict(r, action_batch=getattr(self, "batch", None)) if r.get("action_batch") == THIS_BATCH else r for r in self.current]
            return {"columns": [], "rows": rows, "truncated": False}
        for marker, name, value in (("AS total FROM (SELECT 1 FROM f LIMIT", "total", lambda: [{"total": self.total}]),
                                    ("AS open_n", "impact", lambda: [self.impact]),
                                    ("AS left_n", "left", lambda: [{"left_n": self.left}]),
                                    ("`action_owner` AS v", "owners", lambda: [{"v": v} for v in self.owners]),
                                    (" OFFSET ", "rows", lambda: self.rows)):
            if marker in sql:
                if self.barrier and name in ("rows", "total"):
                    self.barrier.wait()
                if name in self.fail:
                    raise self.fail[name]
                return {"columns": [], "rows": value(), "truncated": False}
        if self.options is not None and sql.startswith("SELECT v FROM"):
            return {"columns": [], "rows": [{"v": v} for v in self.options], "truncated": False}
        return None

    def run_sql(self, warehouse, sql, params, limit=5000):
        if self.clock:
            self.clock.spend(self.slow(sql) if self.slow else 0.5)
        out = self.answer(sql, params)
        if out is None:
            return super().run_sql(warehouse, sql, params, limit)
        self.sql.append((sql, params, limit))
        return out

    def queries(self, marker):
        return [(sql, params) for sql, params, _limit in self.sql if marker in sql]


def shell(tmp_path, settings=None, pages=None, ws=None, timer=None):
    ws = ws or DataWorkspace()
    made = {"user": []}

    def user_factory(host, token):
        made["user"].append(token)
        return ws

    extra = {"timer": timer} if timer else {}
    s = shell_core.Shell(app_dir(tmp_path, settings or DECIDE, pages or [edit_page()]),
                         env={"DATABRICKS_WAREHOUSE_ID": "wh1", "DATABRICKS_HOST": "dbc-1.example.com"},
                         sp_factory=lambda: ws, user_factory=user_factory, **extra)
    return s, ws, made


def records(s, headers=None, **body):
    return call(s, "POST", "records", headers=EDITOR if headers is None else headers, body=dict({"page": "n01_u05"}, **body))


def act(s, keys=("k1",), values=None, seen=None, headers=None):
    body = {"page": "n01_u05", "record_keys": list(keys), "values": {"action_status": "In progress"} if values is None else values,
            "seen": {k: "101" for k in keys} if seen is None else seen}
    return call(s, "POST", "records/act", headers=EDITOR if headers is None else headers, body=body)


def test_the_list_pages_in_sql_by_the_sort_column_then_record_key_with_the_count_in_parallel(tmp_path):
    ws = DataWorkspace(rows=[{"record_key": f"k{i}", "rank": 50 + i} for i in range(50)], total=2341882, barrier=threading.Barrier(2, timeout=5))
    s, ws, _made = shell(tmp_path, ws=ws)
    status, out = records(s, offset=50, limit=50, filters={"run_date": {"from": "2026-01-01", "to": "2026-10-15"}})
    assert status == 200, out
    assert (out["total"], out["total_more"], out["offset"], out["limit"], len(out["rows"])) == (shell_sql.CAPS["count_cap"], True, 50, 50, 50), \
        "a filtered list counts up to the cap and says there are more, never a count of millions per request"
    assert out["sort"] == {"key": "rank", "dir": "asc"}
    (rows_sql, params), = ws.queries(" OFFSET ")
    assert "s AS (SELECT * FROM f ORDER BY `rank` ASC NULLS LAST, `record_key` ASC LIMIT 50 OFFSET 50)" in rows_sql
    assert rows_sql.endswith("ORDER BY `rank` ASC NULLS LAST, `record_key` ASC")
    (total_sql, total_params), = ws.queries("AS total FROM (SELECT 1 FROM f LIMIT")
    assert total_sql.endswith(f"SELECT COUNT(*) AS total FROM (SELECT 1 FROM f LIMIT {shell_sql.CAPS['count_cap'] + 1}) AS z") and " OFFSET " not in total_sql
    assert params == total_params == [{"name": "p0", "value": "2026-01-01", "type": "DATE"}, {"name": "p1", "value": "2026-10-15", "type": "DATE"}]
    status, out = records(s, sort={"key": "value", "dir": "desc"}, limit=100)
    assert status == 200 and "ORDER BY `value` DESC NULLS LAST, `record_key` ASC LIMIT 100 OFFSET 0" in ws.queries(" OFFSET ")[-1][0]


@pytest.mark.parametrize("sort, fragment", [
    ({"key": "valid_from"}, "cannot sort by 'valid_from'"),
    ({"key": "rank` DESC; DROP TABLE t; --"}, "cannot sort by"),
    ({"key": "action_owner"}, "cannot sort by 'action_owner'"),
    ({"key": ["rank"]}, "cannot sort by"),
    ({"key": "rank", "dir": "up"}, "sort dir must be asc or desc"),
    ("rank", "sort takes an object"),
])
def test_a_sort_key_not_in_the_list_is_refused_before_any_list_query(tmp_path, sort, fragment):
    s, ws, _made = shell(tmp_path, settings=SETTINGS)
    status, out = records(s, sort=sort)
    assert status == 400 and fragment in out["error"], out
    assert "sort by one of its columns: rank, entity_label, priority_tier, entity_id, category, value" in out["error"] or "dir" in fragment \
        or "object" in fragment
    assert ws.queries(" OFFSET ") == [] and ws.queries("AS total FROM (SELECT 1 FROM f LIMIT") == []


@pytest.mark.parametrize("field, value, ok", [("limit", 100, True), ("limit", 1, True), ("limit", 101, False), ("limit", 0, False),
                                              ("limit", "50", False), ("limit", True, False), ("offset", 0, True), ("offset", -1, False),
                                              ("offset", 2.5, False), ("offset", 10 ** 9 + 1, False)])
def test_the_list_takes_at_most_100_rows_from_a_whole_offset(tmp_path, field, value, ok):
    s, ws, _made = shell(tmp_path)
    status, out = records(s, **{field: value})
    assert (status == 200) is ok, out
    if not ok:
        assert field in out["error"] and ws.queries(" OFFSET ") == []


def test_an_offset_past_the_end_and_an_empty_table_return_no_rows_with_the_true_total(tmp_path):
    s, ws, _made = shell(tmp_path, ws=DataWorkspace(rows=[], total=30))
    status, out = records(s, offset=1000)
    assert status == 200 and out["rows"] == [] and out["total"] == 30 and out["offset"] == 1000
    (tmp_path / "empty").mkdir()
    s, ws, _made = shell(tmp_path / "empty", ws=DataWorkspace(rows=[], total=0))
    status, out = records(s)
    assert status == 200 and (out["rows"], out["total"]) == ([], 0)


@pytest.mark.parametrize("text, pattern", [("50%_off", "%50!%!_off%"), ("o'brien", "%o'brien%"), ("a!b", "%a!!b%"),
                                           ('"; DROP TABLE t; --', '%"; DROP TABLE t; --%')])
def test_search_is_one_escaped_parameter_across_the_label_key_and_segment(tmp_path, text, pattern):
    s, ws, _made = shell(tmp_path)
    status, out = records(s, search=f"  {text} ")
    assert status == 200, out
    for sql, params in ws.queries(" OFFSET ") + ws.queries("AS total FROM (SELECT 1 FROM f LIMIT"):
        assert text not in sql
        assert [p["value"] for p in params] == [pattern]
        assert ("(CAST(d.`entity_label` AS STRING) ILIKE :p0 ESCAPE '!' OR CAST(d.`entity_id` AS STRING) ILIKE :p0 ESCAPE '!' OR "
                "CAST(d.`category` AS STRING) ILIKE :p0 ESCAPE '!')") in sql


def test_search_refuses_long_or_non_text_input_and_ignores_blank_input(tmp_path):
    s, ws, _made = shell(tmp_path)
    assert records(s, search="x" * 201)[0] == 400
    assert records(s, search=["x"])[0] == 400
    assert records(s, search="x" * 200)[0] == 200
    assert records(s, search="   ")[0] == 200
    assert "ILIKE" not in ws.queries(" OFFSET ")[-1][0]


def test_a_page_without_a_result_table_reads_only_its_dataset(tmp_path):
    listed = [c for c in LISTED if c["name"] != "record_key"]
    s, ws, _made = shell(tmp_path, settings=DECIDE, pages=[copy.deepcopy(PAGE)], ws=DataWorkspace(listed=listed))
    status, out = records(s)
    assert status == 200 and (out["actions"], out["changes"], out["summary"]) == (False, False, None)
    (sql, _params), = ws.queries(" OFFSET ")
    assert "_inspire_" not in sql and "loss_desk_out`" not in sql
    assert sql.endswith("SELECT s.* FROM s ORDER BY `rank` ASC NULLS LAST, `entity_id` ASC")
    assert ws.queries("LIMIT 0") == [(shell_sql.dataset_columns_query(PAGE, "records")[0], [])]
    assert records(s, mine=True)[0] == 400 and records(s, changed=True)[0] == 400


def test_the_table_join_decorates_only_the_page_of_rows(tmp_path):
    s, ws, _made = shell(tmp_path)
    assert records(s)[0] == 200
    (sql, _params), = ws.queries(" OFFSET ")
    assert ("k AS (SELECT s.*, c.`_inspire_key`, c.`_inspire_version`, c.`_inspire_owner`, c.`_inspire_status`, c.`_inspire_choice`, c.`_inspire_missing` FROM s "
            "LEFT JOIN c ON c.`_inspire_key` = s.`record_key`)") in sql
    assert sql.count("t.`record_key` IN (SELECT `record_key` FROM s)") == 3 and "FROM k)" not in sql
    assert sql.count(" FROM k") == 1, "the joined page is read once, so the warehouse does not scan the list and the table again per change"
    assert "f AS (SELECT d.* FROM d)" in sql
    (total, _p), = ws.queries("AS total FROM (SELECT 1 FROM f LIMIT")
    assert "c AS (" not in total and "_inspire_latest" not in total


def test_a_dataset_without_record_key_joins_the_table_on_the_list_key(tmp_path):
    listed = [c for c in LISTED if c["name"] != "record_key"]
    s, ws, _made = shell(tmp_path, ws=DataWorkspace(listed=listed))
    assert records(s)[0] == 200
    (sql, _params), = ws.queries(" OFFSET ")
    assert "CAST(`entity_id` AS STRING) AS `_inspire_join`" in sql
    assert "LEFT JOIN c ON c.`_inspire_join` = CAST(s.`entity_id` AS STRING)" in sql
    assert sql.count("t.`record_key` IN (SELECT `_inspire_key` FROM k)") == 3 and "FROM s)" not in sql, \
        "a list keyed on another column finds its change rows by the table key the join brought in"
    assert "ORDER BY `rank` ASC NULLS LAST, `entity_id` ASC" in sql


def test_per_user_apps_read_the_list_as_the_signed_in_person_and_offer_actions_only_with_decisions_on(tmp_path):
    settings = dict(SETTINGS, auth="user")
    s, ws, made = shell(tmp_path, settings=settings)
    assert records(s, headers={})[0] == 401
    headers = dict(EDITOR, **{"x-forwarded-access-token": "tok-a"})
    status, out = records(s, headers=headers)
    assert status == 200 and made["user"] == ["tok-a"] and out["actions"] is False and out["changes"] is True
    assert "action_owner" not in ws.queries(" OFFSET ")[0][0]
    status, out = records(s, headers=headers, mine=True)
    assert status == 400 and "cannot show your actions" in out["error"]
    (tmp_path / "on").mkdir()
    s, ws, made = shell(tmp_path / "on", settings=dict(DECIDE, auth="user"))
    status, out = records(s, headers=headers)
    assert status == 200 and out["actions"] is True and made["user"] == ["tok-a"]
    assert call(s, "GET", "app", headers=headers)[1]["options"]["decisions"] is True
    assert "action_owner" in ws.queries(" OFFSET ")[0][0]


TOKEN = {"x-forwarded-access-token": "tok-a"}


class Unreadable(DataWorkspace):
    def answer(self, sql, params):
        if "SELECT explode(from_json(" in sql and not sql.startswith("MERGE INTO"):
            raise shell_db.QueryError("[INSUFFICIENT_PERMISSIONS] User does not have SELECT on Table 'main.pricing.loss_desk_out'")
        return super().answer(sql, params)


def person_shell(tmp_path, reader, writer, settings=None):
    made = {"user": [], "sp": 0}

    def user_factory(host, token):
        made["user"].append(token)
        return reader

    def sp_factory():
        made["sp"] += 1
        return writer

    s = shell_core.Shell(app_dir(tmp_path, settings or dict(DECIDE, auth="user"), [edit_page()]),
                         env={"DATABRICKS_WAREHOUSE_ID": "wh1", "DATABRICKS_HOST": "dbc-1.example.com"},
                         sp_factory=sp_factory, user_factory=user_factory)
    return s, made


def test_a_per_user_app_checks_the_person_can_read_the_record_then_records_the_decision_as_the_app_in_their_name(tmp_path):
    reader = DataWorkspace(current=[current("k1", "run", "run 7")])
    writer = DataWorkspace()
    s, made = person_shell(tmp_path, reader, writer)
    status, out = act(s, values={"action_status": "Done", "action_owner": OTHER}, headers=dict(EDITOR, **TOKEN))
    assert status == 200 and out == {"written": ["k1"], "conflicts": [], "conflicts_count": 0, "left_out": 0, "batch_id": writer.batch}
    (check, check_params), = reader.queries("SELECT explode(from_json(")
    assert json.loads(check_params[0]["value"]) == ["k1"] and "`is_current`" in check
    assert reader.queries("MERGE INTO") == [], "the person's token never writes the decision"
    (sql, params), = writer.queries("MERGE INTO")
    by_value = {p["value"]: p for p in params}
    assert by_value["action"]["type"] == "STRING" and PERSON in by_value and OTHER in by_value
    assert re.search(r":p\d+ AS `changed_by`", sql) and json.loads(params[-1]["value"]) == [{"k": "k1", "v": 101}]
    assert made["sp"] == 1 and set(made["user"]) == {"tok-a"}
    assert [q.split(" ", 2)[:2] for q, _p, _l in writer.sql] == [["MERGE", "INTO"]], "the App's identity runs only the write"


def test_a_per_user_viewer_who_cannot_read_the_record_is_refused_and_nothing_is_written(tmp_path):
    reader, writer = DataWorkspace(current=[]), DataWorkspace()
    s, made = person_shell(tmp_path, reader, writer)
    status, out = act(s, headers=dict(EDITOR, **TOKEN))
    assert status == 403 and out["error"] == ("Nothing was saved: you cannot read this record in Unity Catalog, or it is no longer in the "
                                              "result table, so the App records no decision on it")
    assert (out["written"], out["left_out"], out["batch_id"]) == ([], 1, None)
    assert writer.sql == [] and reader.queries("MERGE INTO") == []
    status, out = act(s, keys=["k1", "k2"], headers=dict(EDITOR, **TOKEN))
    assert status == 403 and "you cannot read these 2 records" in out["error"] and out["left_out"] == 2 and writer.sql == []
    (tmp_path / "denied").mkdir()
    s, _made = person_shell(tmp_path / "denied", Unreadable(), writer)
    status, out = act(s, headers=dict(EDITOR, **TOKEN))
    assert status == 403 and out["error"].startswith("Nothing was saved: you cannot read `main`.`pricing`.`loss_desk_out` in Unity Catalog")
    assert writer.sql == []


def test_a_per_user_bulk_act_writes_only_the_records_the_person_can_read_and_counts_the_rest(tmp_path):
    reader = DataWorkspace(current=[current("k1", "run", "run 7"), current("k3", "run", "run 7")])
    writer = DataWorkspace()
    s, _made = person_shell(tmp_path, reader, writer)
    status, out = act(s, keys=["k1", "k2", "k3"], values={"action_owner": OTHER}, headers=dict(EDITOR, **TOKEN))
    assert status == 200 and out["written"] == ["k1", "k3"] and out["left_out"] == 1 and out["conflicts"] == []
    (_sql, params), = writer.queries("MERGE INTO")
    assert [r["k"] for r in json.loads(params[-1]["value"])] == ["k1", "k3"]
    assert "k2" not in json.dumps(params)


def test_a_per_user_decision_the_app_may_not_write_names_the_app_identity_not_the_person(tmp_path):
    reader = DataWorkspace(current=[current("k1", "run", "run 7")])
    writer = DataWorkspace(fail={"merge": shell_db.QueryError("PERMISSION_DENIED: no MODIFY")})
    s, _made = person_shell(tmp_path, reader, writer)
    status, out = act(s, headers=dict(EDITOR, **TOKEN))
    assert status == 403 and out["error"] == "Nothing was saved: this App cannot write this change. Ask the App owner to check its access."


def test_a_failed_list_query_is_a_502_and_a_failed_summary_query_is_reported_without_failing_the_list(tmp_path):
    s, _ws, _made = shell(tmp_path, ws=DataWorkspace(fail={"rows": shell_db.QueryError("TABLE_OR_VIEW_NOT_FOUND")}))
    status, out = records(s)
    assert status == 502 and out == {"error": "TABLE_OR_VIEW_NOT_FOUND"}
    (tmp_path / "summary").mkdir()
    s, _ws, _made = shell(tmp_path / "summary", ws=DataWorkspace(fail={"impact": shell_db.QueryError("PERMISSION_DENIED")}))
    status, out = records(s)
    assert status == 200 and out["errors"] == {"impact": "PERMISSION_DENIED"} and "open" not in out["summary"]


def test_filters_with_500_choices_are_marked_searchable(tmp_path):
    s, _ws, _made = shell(tmp_path, ws=DataWorkspace(options=[f"v{i:03}" for i in range(500)]))
    status, out = call(s, "GET", "filters", query={"page": "n01_u05"}, headers=EDITOR)
    assert status == 200
    by = {f["id"]: f for f in out["filters"]}
    assert by["category"]["searchable"] is True and "searchable" not in by["run_date"]
    (tmp_path / "few").mkdir()
    s, _ws, _made = shell(tmp_path / "few", ws=DataWorkspace(options=[f"v{i}" for i in range(499)]))
    assert {f["id"]: f.get("searchable") for f in call(s, "GET", "filters", query={"page": "n01_u05"})[1]["filters"]}["category"] is False


def test_filter_options_search_the_server_with_one_escaped_parameter_and_return_at_most_50(tmp_path):
    s, ws, _made = shell(tmp_path, ws=DataWorkspace(options=["50% off", "50_off"]))
    status, out = call(s, "GET", "filters/options", query={"page": "n01_u05", "filter": "category", "q": " 50%_ "}, headers=EDITOR)
    assert status == 200 and out == {"filter": "category", "q": "50%_", "options": ["50% off", "50_off"]}
    sql, params, limit = ws.sql[-1]
    assert sql.startswith("SELECT v FROM (") and sql.endswith("AS o WHERE v IS NOT NULL AND v ILIKE :p0 ESCAPE '!' ORDER BY v LIMIT 50")
    assert params == [{"name": "p0", "value": "%50!%!_%", "type": "STRING"}] and limit == 50 and "50%" not in sql
    status, out = call(s, "GET", "filters/options", query={"page": "n01_u05", "filter": "category"})
    assert status == 200 and "ILIKE" not in ws.sql[-1][0] and ws.sql[-1][0].endswith("LIMIT 50")
    for query, code in (({"filter": "run_date"}, 404), ({"filter": "nope"}, 404), ({"filter": "category", "q": "x" * 301}, 400)):
        assert call(s, "GET", "filters/options", query=dict({"page": "n01_u05"}, **query))[0] == code, query


def test_check_names_every_query_slower_than_20_seconds_with_the_cache_bypassed(tmp_path):
    clock = Clock()
    spent = {"GROUP BY `category` ORDER BY 2 DESC": 34.0, "`region` AS STRING) AS v": 21.4, " OFFSET ": 25.0, "SUM(y0) OVER": 20.0,
             "`channel` AS STRING) AS v": 19.6, "AS total FROM (SELECT 1 FROM f LIMIT": 20.4}
    ws = DataWorkspace(clock=clock, slow=lambda sql: next((v for k, v in spent.items() if k in sql), 0.5))
    s, ws, _made = shell(tmp_path, settings=SETTINGS, pages=[copy.deepcopy(PAGE)], ws=ws, timer=clock)
    problems = s.check(EDITOR)
    assert sorted(problems) == sorted([SLOW.format("chart by_category", 34), SLOW.format("filter region", 22),
                                       SLOW.format("the decision list", 25), SLOW.format("the decision list count", 21)]), problems
    first = len(ws.sql)
    assert sorted(s.check(EDITOR)) == sorted(problems)
    assert len(ws.sql) == 2 * first, "every check run reads fresh, never from the shell cache"
    call(s, "POST", "page", headers=EDITOR, body={"page": "n01_u05"})
    served = len(ws.sql)
    call(s, "POST", "page", headers=EDITOR, body={"page": "n01_u05"})
    assert len(ws.sql) == served, "people still get cached answers"


def test_check_reports_an_empty_list_and_a_failed_summary_once(tmp_path):
    ws = DataWorkspace(rows=[], fail={"left": shell_db.QueryError("PERMISSION_DENIED")})
    s, _ws, _made = shell(tmp_path, settings=DECIDE, ws=ws)
    problems = s.check(EDITOR)
    assert "page n01_u05: the decision list returned no rows at the default filters" in problems
    assert "page n01_u05: the count of records that left the list failed: PERMISSION_DENIED" in problems


def test_check_finds_nothing_to_flag_on_decisions_for_a_result_table_the_app_can_read(tmp_path):
    s, _ws, _made = shell(tmp_path, settings=DECIDE)
    assert [p for p in s.check(EDITOR) if "record decisions" in p] == []


def test_the_action_columns_match_the_contract_with_the_runs():
    assert shell_sql.ACTION_TYPES == CONTRACT
    assert shell_sql.ACTION_EDITABLE == ("action_owner", "action_status", "action_choice", "action_due", "action_note", "dismiss_reason", "snooze_until",
                                         "realized_value", "realized_note")
    assert shell_sql.ACTION_STATUSES == ("New", "In progress", "Done", "Dismissed", "Could not fix")
    assert "action" in shell_sql.CHANGE_SOURCES


def test_action_columns_have_their_own_role_and_the_edit_form_cannot_change_them(tmp_path):
    fields = {f["name"]: f for f in shell_sql.change_fields(TRACKED)}
    assert {fields[n]["role"] for n in CONTRACT} == {"action"}
    assert not any(fields[n]["editable"] for n in CONTRACT)
    s, ws, _made = shell(tmp_path, settings=MODIFY)
    for name in ("action_status", "action_outcome"):
        status, out = call(s, "POST", "records/edit", headers=EDITOR,
                           body={"page": "n01_u05", "record_key": "42", "valid_from_us": "101", "values": {name: "Done"}})
        assert status == 400 and out["error"] == f"{name} cannot be changed in the App"
    assert ws.queries("MERGE INTO") == []


def test_records_fields_mark_which_action_columns_exist_and_the_list_says_whether_people_can_act(tmp_path):
    s, _ws, _made = shell(tmp_path)
    status, out = call(s, "GET", "records/fields", headers=EDITOR, query={"page": "n01_u05"})
    assert status == 200 and {f["name"] for f in out["fields"] if f["role"] == "action"} == set(CONTRACT) | set(shell_sql.CLOSE_TYPES)
    assert not any(f["editable"] for f in out["fields"] if f["role"] == "action")
    assert records(s)[1]["actions"] is True
    (tmp_path / "off").mkdir()
    s, _ws, _made = shell(tmp_path / "off", settings=SETTINGS)
    assert records(s)[1]["actions"] is False


def test_acting_is_refused_while_decisions_are_off_in_shared_and_per_user_apps(tmp_path):
    s, ws, _made = shell(tmp_path, settings=MODIFY)
    status, out = act(s)
    assert status == 403 and out == {"error": "this App does not let people record decisions on its records"}
    (tmp_path / "user").mkdir()
    s, ws2, _made = shell(tmp_path / "user", settings=dict(MODIFY, auth="user"))
    assert act(s, headers=dict(EDITOR, **{"x-forwarded-access-token": "tok"}))[0] == 403
    assert ws.sql == [] and ws2.sql == []


def test_acting_needs_the_person_who_acts(tmp_path):
    s, ws, _made = shell(tmp_path)
    status, out = act(s, headers={})
    assert status == 401 and "who made the change" in out["error"] and ws.sql == []


@pytest.mark.parametrize("keys, seen, values, fragment", [
    ([], None, None, "name 1 to 200 record_keys"),
    ([f"k{i}" for i in range(201)], None, None, "name 1 to 200 record_keys"),
    (["k1", "k1"], None, None, "each record_key once"),
    ([7], {"7": "1"}, None, "each record_key is text"),
    (["k" * 513], None, None, "each record_key is text of at most 512"),
    (["k1"], {}, None, "send seen"),
    (["k1"], {"k1": "1 OR 1=1"}, None, "send seen"),
    (["k1"], None, {"priority_tier": "Act now"}, "priority_tier cannot be changed by an action"),
    (["k1"], None, {"action_outcome": "Resolved"}, "action_outcome cannot be changed by an action"),
    (["k1"], None, {"record_key": "x", "action_note": "n"}, "record_key cannot be changed by an action"),
    (["k1"], None, {}, "send the action values"),
    (["k1"], None, {"action_status": "Closed"}, "action_status must be one of New, In progress, Done, Dismissed"),
    (["k1"], None, {"action_status": None}, "action_status must be one of"),
    (["k1"], None, {"action_status": "Dismissed"}, "dismissing a record needs a dismiss_reason"),
    (["k1"], None, {"action_status": "Dismissed", "dismiss_reason": "   "}, "dismissing a record needs a dismiss_reason"),
    (["k1"], None, {"action_status": "Dismissed", "dismiss_reason": "x" * 301}, "at most 300 characters"),
    (["k1"], None, {"action_status": "Done", "dismiss_reason": "wrong item"}, "goes only with the Dismissed status"),
    (["k1"], None, {"dismiss_reason": "wrong item"}, "goes only with the Dismissed status"),
    (["k1"], None, {"dismiss_reason": ["x"], "action_status": "Dismissed"}, "dismiss_reason takes text"),
    (["k1"], None, {"action_owner": "x" * 255}, "at most 254 characters"),
    (["k1"], None, {"action_due": "next week"}, "not a YYYY-MM-DD date"),
    (["k1"], None, {"action_note": "x" * 4001}, "at most 4,000"),
], ids=lambda v: str(v)[:30])
def test_an_act_validates_its_keys_versions_and_values_before_writing(tmp_path, keys, seen, values, fragment):
    s, ws, _made = shell(tmp_path)
    status, out = act(s, keys=keys, values=values, seen=seen)
    assert status == 400 and fragment in out["error"], out
    assert ws.queries("MERGE INTO") == []


def test_an_act_writes_every_record_as_an_action_version_in_one_merge(tmp_path):
    keys = [f"k{i}" for i in range(200)]
    s, ws, _made = shell(tmp_path)
    status, out = act(s, keys=keys, values={"action_owner": f" {OTHER} ", "action_status": "Done", "action_due": "2026-11-01",
                                            "action_note": "Called the store"}, seen={k: str(1000 + i) for i, k in enumerate(keys)})
    assert status == 200 and out == {"written": keys, "conflicts": [], "conflicts_count": 0, "left_out": 0, "batch_id": ws.batch}
    assert re.fullmatch(r"[0-9a-f]{32}", out["batch_id"])
    (sql, params), = ws.queries("MERGE INTO")
    assert f":p2 AS `action_batch`" in sql and "CAST(NULL AS STRING) AS `action_batch_note`" in sql
    by_value = {p["value"]: p for p in params}
    assert by_value["action"]["type"] == "STRING" and by_value[PERSON]["type"] == "STRING" and OTHER in by_value
    assert by_value["2026-11-01"]["type"] == "DATE" and by_value["Called the store"]["type"] == "STRING"
    assert json.loads(params[-1]["value"]) == [{"k": k, "v": 1000 + i} for i, k in enumerate(keys)]
    assert "NULL AS `dismiss_reason`" in sql, "leaving Dismissed clears the reason"
    for carried in ("priority_tier", "rank", "entity_label", "run_id", "as_of_date", "record_key", "action_outcome"):
        assert f"b.`{carried}` AS `{carried}`" in sql
    assert "JOIN (SELECT inline(from_json(:p" in sql and "WHEN MATCHED THEN UPDATE SET tgt.`valid_to` = src.`valid_from`" in sql
    assert ws.queries("explode(from_json(") == [], "a full write needs no read-back"


def test_dismissing_a_recommendation_keeps_the_reason(tmp_path):
    s, ws, _made = shell(tmp_path)
    reason = "The store closed in May; it's not \"ours\" anymore"
    status, _out = act(s, values={"action_status": "Dismissed", "dismiss_reason": f"  {reason} "})
    assert status == 200
    (sql, params), = ws.queries("MERGE INTO")
    assert reason in [p["value"] for p in params] and reason not in sql
    assert re.search(r":p\d+ AS `dismiss_reason`", sql)


def current(key, source, by, values=None, version="999"):
    row = {"record_key": key, "change_source": source, "changed_by": by, "valid_from": "2026-10-27T03:01:02.000Z", "is_current": True,
           "action_owner": None, "action_status": None, "action_due": None, "action_note": None, "dismiss_reason": None}
    row.update(values or {})
    row["_inspire_version"] = version
    return row


def test_conflicting_versions_are_reported_per_record_and_the_rest_are_saved(tmp_path):
    rows = [current("k1", "action", PERSON, {"action_status": "In progress", "action_batch": THIS_BATCH}), current("k2", "edit", OTHER),
            current("k4", "delete", OTHER)]
    s, ws, _made = shell(tmp_path, ws=DataWorkspace(inserted=1, current=rows))
    status, out = act(s, keys=["k1", "k2", "k3", "k4"])
    assert status == 200 and out["written"] == ["k1"] and out["conflicts_count"] == 3 and out["batch_id"] == ws.batch
    assert out["conflicts"] == [
        {"record_key": "k2", "error": f"{OTHER} changed this record on Oct 27, 2026 at 03:01 UTC, after you opened it. Reload it to see "
                                      "that change, then make yours again"},
        {"record_key": "k3", "error": "this record is no longer in the result table; reload the page"},
        {"record_key": "k4", "error": f"{OTHER} deleted this record on Oct 27, 2026 at 03:01 UTC, after you opened it. Reload it to see "
                                      "that change, then make yours again"}]
    (sql, params), = ws.queries("explode(from_json(")
    assert json.loads(params[0]["value"]) == ["k1", "k2", "k3", "k4"] and "k2" not in sql


def test_an_act_that_saves_nothing_is_a_409_naming_every_conflict(tmp_path):
    rows = [current("k1", "run", "run 78"), current("k2", "edit", OTHER)]
    s, _ws, _made = shell(tmp_path, ws=DataWorkspace(inserted=0, current=rows))
    status, out = act(s, keys=["k1", "k2"])
    assert status == 409 and out["written"] == [] and [c["record_key"] for c in out["conflicts"]] == ["k1", "k2"]
    assert out["error"].startswith("none of the 2 records changed: The job (run 78) changed this record on Oct 27, 2026")
    status, out = act(s, keys=["k2"])
    assert status == 409 and out["error"] == out["conflicts"][0]["error"] and out["error"].startswith(f"{OTHER} changed this record")


def test_the_same_person_acting_from_another_window_is_not_mistaken_for_this_save(tmp_path):
    rows = [current("k1", "action", PERSON, {"action_status": "Done"}), current("k2", "action", PERSON, {"action_status": "In progress"},
                                                                               version="101")]
    s, _ws, _made = shell(tmp_path, ws=DataWorkspace(inserted=0, current=rows))
    status, out = act(s, keys=["k1", "k2"])
    assert status == 409 and out["written"] == [] and len(out["conflicts"]) == 2


def test_a_concurrent_delta_conflict_during_an_act_reads_back_each_record(tmp_path):
    conflict = shell_db.QueryError("[DELTA_CONCURRENT_APPEND] ConcurrentAppendException: Files were added")
    rows = [current("k1", "edit", OTHER)]
    s, ws, _made = shell(tmp_path, ws=DataWorkspace(current=rows, fail={"merge": conflict}))
    status, out = act(s)
    assert status == 409 and out["conflicts"][0]["record_key"] == "k1" and len(ws.queries("explode(from_json(")) == 1
    (tmp_path / "other").mkdir()
    s, _ws, _made = shell(tmp_path / "other", ws=DataWorkspace(fail={"merge": shell_db.QueryError("INTERNAL_ERROR: the warehouse stopped")}))
    assert act(s)[0] == 502
    (tmp_path / "denied").mkdir()
    s, _ws, _made = shell(tmp_path / "denied", ws=DataWorkspace(fail={"merge": shell_db.QueryError("PERMISSION_DENIED: no MODIFY")}))
    status, out = act(s)
    assert status == 403 and out["error"] == "Nothing was saved: this App cannot write this change. Ask the App owner to check its access."


def test_the_list_carries_owner_status_and_version_and_my_actions_filters_in_sql(tmp_path):
    s, ws, _made = shell(tmp_path, ws=DataWorkspace(owners=[OTHER, PERSON]))
    status, out = records(s)
    assert status == 200 and out["actions"] is True and out["summary"]["owners"] == [OTHER, PERSON]
    status, out = records(s, mine=True, sort={"key": "action_status", "dir": "desc"})
    assert status == 200
    (sql, params), (total, total_params) = ws.queries(" OFFSET ")[-1], ws.queries("AS total FROM (SELECT 1 FROM f LIMIT")[-1]
    for text in (sql, total):
        assert ("f AS (SELECT d.*, c.`_inspire_key`, c.`_inspire_version`, c.`_inspire_owner`, c.`_inspire_status`, c.`_inspire_choice`, c.`_inspire_missing` FROM d "
                "LEFT JOIN c") in text
        assert "lower(c.`_inspire_owner`) = lower(:p0)" in text and PERSON not in text
    assert params == total_params == [{"name": "p0", "value": PERSON, "type": "STRING"}]
    assert "ORDER BY `_inspire_status` DESC NULLS LAST, `record_key` ASC" in sql
    assert records(s, headers={}, mine=True)[0] == 401
    assert records(s, mine="yes")[0] == 400


def test_the_impact_line_counts_from_the_latest_version_of_each_record(tmp_path):
    s, ws, _made = shell(tmp_path, ws=DataWorkspace(impact={"open_n": 14, "done_n": 9, "resolved_n": 6}, left=12))
    status, out = records(s)
    assert status == 200 and {k: out["summary"][k] for k in ("open", "done", "resolved", "left")} == {
        "open": 14, "done": 9, "resolved": 6, "left": 12}
    (sql, params), = ws.queries("AS open_n")
    assert params == []
    assert sql == shell_facts.action_counts_sql("`main`.`pricing`.`loss_desk_out`"), \
        "the live count and the count a run keeps are one definition"
    assert ("COALESCE(SUM(CASE WHEN a.`change_source` <> 'delete' AND a.`is_current` AND a.`action_status` IN ('New', 'In progress') "
            "THEN 1 ELSE 0 END), 0) AS open_n") in sql
    assert ("COALESCE(SUM(CASE WHEN a.`change_source` <> 'delete' AND a.`action_status` = 'Done' AND (NOT a.`is_current` OR "
            "a.`action_outcome` = 'Resolved') THEN 1 ELSE 0 END), 0) AS resolved_n") in sql
    assert "QUALIFY ROW_NUMBER() OVER (PARTITION BY `record_key` ORDER BY `valid_from` DESC) = 1) AS a" in sql
    (tmp_path / "off").mkdir()
    s, ws, _made = shell(tmp_path / "off", settings=SETTINGS)
    status, out = records(s)
    assert status == 200 and out["actions"] is False and ws.queries("AS open_n") == [] and out["summary"] == {"left": 0, "kept": 0}


def test_change_badges_compare_the_latest_run_with_the_previous_one_in_sql(tmp_path):
    s, ws, _made = shell(tmp_path)
    assert records(s)[0] == 200
    (sql, _params), = ws.queries(" OFFSET ")
    assert ("r AS (SELECT `run_id` AS `_inspire_run`, MIN(`valid_from`) AS `_inspire_ran`, MAX(`valid_from`) AS `_inspire_ended` FROM "
            "`main`.`pricing`.`loss_desk_out` WHERE `change_source` = 'run' GROUP BY `run_id`)") in sql
    assert "ROW_NUMBER() OVER (ORDER BY `_inspire_ran` DESC)" in sql
    assert "JOIN n ON t.`run_id` = n.`_inspire_latest` WHERE t.`change_source` = 'run' AND n.`_inspire_previous` IS NOT NULL" in sql
    assert "JOIN n ON t.`run_id` <> n.`_inspire_latest`" in sql and "JOIN n ON t.`run_id` = n.`_inspire_previous`" in sql
    assert "WHEN o.`_inspire_ok` IS NULL THEN 'new' WHEN p.`_inspire_pk` IS NOT NULL AND NOT (l.`_inspire_tier` <=> p.`_inspire_was`) THEN 'moved'" in sql
    assert "THEN l.`_inspire_tier` END AS `_inspire_moved_to`" in sql
    assert records(s, changed=True)[0] == 200
    sql, total = ws.queries(" OFFSET ")[-1][0], ws.queries("AS total FROM (SELECT 1 FROM f LIMIT")[-1][0]
    for text in (sql, total):
        assert "LEFT JOIN l0 AS l ON l.`_inspire_lk` = c.`_inspire_key`" in text
        assert "WHERE (l.`_inspire_lk` IS NOT NULL AND (o.`_inspire_ok` IS NULL OR p.`_inspire_pk` IS NOT NULL" in text
    (left, _p), = ws.queries("AS left_n")[:1]
    assert "JOIN n ON p.`run_id` = n.`_inspire_previous` LEFT ANTI JOIN (SELECT `record_key` FROM" in left


def test_a_table_without_a_tier_badges_only_new_records(tmp_path):
    s, ws, _made = shell(tmp_path, ws=DataWorkspace(columns=[c for c in TRACKED if c["name"] != "priority_tier"]))
    assert records(s)[0] == 200
    sql = ws.queries(" OFFSET ")[0][0]
    assert "CAST(NULL AS STRING) AS `_inspire_moved_to`" in sql and " p AS (" not in sql and "WHEN FALSE THEN 'moved'" in sql


def test_every_generated_list_and_action_statement_parses_as_databricks_sql():
    sqlglot = pytest.importorskip("sqlglot")
    page = edit_page()
    fields = shell_sql.change_fields(TRACKED)
    statements = []
    for listed in ({"record_key", "entity_id"}, {"entity_id"}):
        context = shell_sql.list_context(page, listed, fields, True)
        for data in ({}, {"search": "50%_off", "mine": True, "sort": {"key": "action_owner", "dir": "desc"}}, {"changed": True},
                     {"mine": True, "changed": True, "search": "o'brien", "offset": 75, "limit": 25}):
            plan = shell_sql.list_queries(page, {"category": ["Books"]}, shell_sql.list_request(page, data, context), context, PERSON)
            statements += [plan["rows"][0], plan["total"][0]]
        statements += [q for q, _p in shell_sql.list_summary_queries(context).values()]
    statements += [shell_sql.version_write(page["result_table"], fields, "action", [("a", "1"), ("b", "2")], PERSON,
                                           {"action_status": "Done", "action_due": "2026-11-01"})[0],
                   shell_sql.current_query(page["result_table"], ["a", "b"])[0], shell_sql.options_query(page, "category", "x%")[0],
                   shell_sql.list_keys_query(page, {}, {"record_key"})[0]]
    for statement in statements:
        sqlglot.parse_one(re.sub(r":p\d+", "'x'", statement), read="databricks")
    assert len(statements) == 28


@pytest.mark.parametrize("start,spent,said", [(42.9, 25.0, "25 s"), (12.2, 20.0, None), (12.7, 20.0004, None), (3.0, 20.0016, "21 s"),
                                              (0.0, 34.0, "34 s")])
def test_a_query_time_is_kept_to_the_millisecond_so_clock_noise_never_moves_its_second_or_the_slow_line(tmp_path, start, spent, said):
    s, _ws, _made = shell(tmp_path, settings=SETTINGS)
    ticks = iter([start, start + spent])
    probe = shell_core.Probe(None, lambda: next(ticks))
    s._timed(lambda: None, ("list", "rows"), probe)
    assert probe.seconds[("list", "rows")] == round(spent, 3)
    assert shell_core.slow_problems("page p", probe.seconds) == ([] if said is None else [
        f"page p: the decision list took {said} at the default filters; read fewer rows: filter on the result table's clustered "
        f"columns or aggregate in the dataset"])
