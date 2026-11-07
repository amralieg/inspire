import copy
import datetime
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
from v141_app_shell_test import PAGE, SETTINGS, FakeWorkspace, app_dir, call  # noqa: E402

TABLE = "main.pricing.loss_desk_out"
EDITOR = {"x-forwarded-email": "pat.lee"}
MODIFY = dict(SETTINGS, options=dict(SETTINGS["options"], modify=True))
COLUMNS = [{"name": n, "type": t, "type_text": x} for n, t, x in (
    ("entity_id", "LONG", "BIGINT"), ("entity_label", "STRING", "STRING"), ("priority_tier", "STRING", "STRING"), ("rank", "INT", "INT"),
    ("top_reasons", "ARRAY", "ARRAY<STRING>"), ("recommended_action", "STRING", "STRING"), ("value", "DECIMAL", "DECIMAL(18,2)"),
    ("flagged", "BOOLEAN", "BOOLEAN"), ("due", "DATE", "DATE"), ("seen_at", "TIMESTAMP", "TIMESTAMP"), ("notes", "MAP", "MAP<STRING,STRING>"),
    ("as_of_date", "DATE", "DATE"), ("run_id", "LONG", "BIGINT"), ("use_case_id", "STRING", "STRING"), ("record_key", "STRING", "STRING"),
    ("valid_from", "TIMESTAMP", "TIMESTAMP"), ("valid_to", "TIMESTAMP", "TIMESTAMP"), ("is_current", "BOOLEAN", "BOOLEAN"),
    ("change_source", "STRING", "STRING"), ("changed_by", "STRING", "STRING"))]
VERSION = "_inspire_version"
HISTORY_ONLY = {"record_key", "valid_from", "valid_to", "is_current", "change_source", "changed_by"}


def edit_page(**changes):
    out = copy.deepcopy(PAGE)
    out["result_table"] = TABLE
    out.update(changes)
    return out


def version(n, source, by, at, current=False, **values):
    row = {"entity_id": 42, "entity_label": "Item 42", "priority_tier": "Review", "rank": 3, "top_reasons": ["deep discount"],
           "recommended_action": "Cut the discount", "value": 100.0, "flagged": False, "due": None, "seen_at": None, "notes": None,
           "as_of_date": "2026-10-15", "run_id": 77, "use_case_id": "N01-U05", "record_key": "42", "valid_from": at,
           "valid_to": None if current else "2026-10-20T09:00:00.000Z", "is_current": current, "change_source": source, "changed_by": by,
           VERSION: str(100 + n)}
    row.update(values)
    return row


V1 = version(1, "run", "run 77", "2026-10-15T06:00:00.000Z")
V2 = version(2, "edit", "pat.lee", "2026-10-20T09:00:00.000Z", current=True, priority_tier="Act now")


class TableWorkspace(FakeWorkspace):
    def __init__(self, columns=None, versions=None, written=1, fail=None, runs=None):
        super().__init__()
        self.columns = COLUMNS if columns is None else columns
        self.history = [V1, V2] if versions is None else versions
        self.written, self.fail = written, fail
        self.runs = runs or []

    def run_sql(self, warehouse, sql, params, limit=5000):
        if sql.endswith("LIMIT 0"):
            self.sql.append((sql, params, limit))
            return {"columns": self.columns, "rows": [], "truncated": False}
        if sql.startswith("MERGE INTO"):
            self.sql.append((sql, params, limit))
            if self.fail:
                raise self.fail
            return {"columns": [], "truncated": False, "rows": [
                {"num_affected_rows": 2 * self.written, "num_updated_rows": self.written, "num_deleted_rows": 0,
                 "num_inserted_rows": self.written}]}
        if VERSION in sql:
            self.sql.append((sql, params, limit))
            return {"columns": [], "rows": list(reversed(self.history)), "truncated": False}
        if "QUALIFY" in sql:
            self.sql.append((sql, params, limit))
            return {"columns": [], "rows": [], "truncated": False}
        if "AS ran_at" in sql:
            self.sql.append((sql, params, limit))
            return {"columns": [], "rows": self.runs, "truncated": False}
        return super().run_sql(warehouse, sql, params, limit)

    def merges(self):
        return [(sql, params) for sql, params, _limit in self.sql if sql.startswith("MERGE INTO")]


def shell(tmp_path, settings=None, pages=None, ws=None, clock=None):
    ws = ws or TableWorkspace()
    made = {"sp": 0, "user": []}

    def sp_factory():
        made["sp"] += 1
        return ws

    def user_factory(host, token):
        made["user"].append(token)
        return ws

    s = shell_core.Shell(app_dir(tmp_path, settings or MODIFY, pages or [edit_page()]),
                         env={"DATABRICKS_WAREHOUSE_ID": "wh1", "DATABRICKS_HOST": "dbc-1.example.com"},
                         sp_factory=sp_factory, user_factory=user_factory, **({"clock": clock} if clock else {}))
    return s, ws, made


def edit_body(**changes):
    body = {"page": "n01_u05", "record_key": "42", "valid_from_us": V2[VERSION],
            "values": {"recommended_action": "Hold the price for a month"}}
    body.update(changes)
    return body


def test_every_write_is_refused_with_403_while_modify_is_off(tmp_path):
    s, ws, _made = shell(tmp_path, settings=SETTINGS)
    for path, body in (("records/edit", edit_body()), ("records/add", {"page": "n01_u05", "values": {"entity_id": "9"}}),
                       ("records/delete", edit_body(values=None))):
        status, out = call(s, "POST", path, headers=EDITOR, body=body)
        assert status == 403, (path, out)
        assert out == {"error": "this App does not let people change its data"}
    assert ws.sql == []
    status, info = call(s, "GET", "app", headers=EDITOR)
    assert info["options"]["modify"] is False


def test_an_edit_closes_the_current_version_and_inserts_the_new_one_in_one_merge(tmp_path):
    s, ws, made = shell(tmp_path)
    assert call(s, "POST", "page", headers=EDITOR, body={"page": "n01_u05"})[0] == 200
    reads = len(ws.sql)
    status, out = call(s, "POST", "records/edit", headers=EDITOR, body=edit_body(values={
        "recommended_action": "Hold the price for a month", "value": "12.50", "top_reasons": ["late", " ", "price rise"], "flagged": True}))
    assert status == 200, out
    merges = ws.merges()
    assert len(merges) == 1
    sql, params = merges[0]
    assert sql.startswith("MERGE INTO `main`.`pricing`.`loss_desk_out` AS tgt USING (")
    assert "WHEN MATCHED THEN UPDATE SET tgt.`valid_to` = src.`valid_from`, tgt.`is_current` = false" in sql
    assert "WHEN NOT MATCHED AND src.`_inspire_merge` IS NULL THEN INSERT (" in sql
    assert "JOIN (SELECT inline(from_json(:p" in sql and "unix_micros(b.`valid_from`) = w.`v`" in sql
    assert "b.`record_key` = w.`k`" in sql and "b.`change_source` <> 'delete'" in sql
    for carried in ("run_id", "as_of_date", "use_case_id", "entity_id", "entity_label", "priority_tier"):
        assert f"b.`{carried}` AS `{carried}`" in sql
    assert "current_timestamp() AS `valid_from`" in sql and "CAST(NULL AS TIMESTAMP) AS `valid_to`" in sql
    assert re.search(r"CAST\(:p\d+ AS DECIMAL\(18,2\)\) AS `value`", sql)
    assert re.search(r"from_json\(:p\d+, 'ARRAY<STRING>'\) AS `top_reasons`", sql)
    assert "true AS `flagged`" in sql
    by_value = {p["value"]: p for p in params}
    assert by_value["edit"]["type"] == "STRING" and by_value["pat.lee"]["type"] == "STRING"
    assert json.loads(params[-1]["value"]) == [{"k": "42", "v": int(V2[VERSION])}]
    assert by_value['["late", "price rise"]']["type"] == "STRING"
    assert by_value["12.50"]["type"] == "STRING"
    assert out["record_key"] == "42" and out["current"]["valid_from_us"] == V2[VERSION]
    assert [v["change_source"] for v in out["versions"]] == ["run", "edit"]
    assert made["sp"] == 1
    call(s, "POST", "page", headers=EDITOR, body={"page": "n01_u05"})
    page_reads = [q for q, _p, _l in ws.sql[reads:] if "'now' AS period" in q]
    assert page_reads, "the page data must be read again after a write, not served from the cache"


def test_a_stale_version_gets_409_saying_who_changed_it_and_when(tmp_path):
    newer = version(3, "edit", "sam.roe", "2026-10-27T03:01:02.123456Z", current=True)
    s, ws, _made = shell(tmp_path, ws=TableWorkspace(versions=[V1, V2, newer], written=0))
    status, out = call(s, "POST", "records/edit", headers=EDITOR, body=edit_body())
    assert status == 409
    assert out["error"] == ("sam.roe changed this record on Oct 27, 2026 at 03:01 UTC, after you opened it. "
                            "Reload it to see that change, then make yours again")
    run = version(3, "run", "run 78", "2026-10-22T06:00:00.000Z", current=True)
    (tmp_path / "run").mkdir()
    s, _ws, _made = shell(tmp_path / "run", ws=TableWorkspace(versions=[V1, run], written=0))
    status, out = call(s, "POST", "records/edit", headers=EDITOR, body=edit_body())
    assert status == 409 and out["error"].startswith("The job (run 78) changed this record on Oct 22, 2026 at 06:00 UTC")
    gone = version(3, "delete", "sam.roe", "2026-10-26T12:00:00.000Z", current=True)
    (tmp_path / "gone").mkdir()
    s, _ws, _made = shell(tmp_path / "gone", ws=TableWorkspace(versions=[V1, gone], written=0))
    status, out = call(s, "POST", "records/delete", headers=EDITOR, body=edit_body(values=None))
    assert status == 409 and out["error"].startswith("sam.roe deleted this record on Oct 26, 2026 at 12:00 UTC")


def test_the_conflict_time_reads_every_warehouse_timestamp_form_as_utc():
    for text in ("2026-10-27 03:01:02.123", "2026-10-27T03:01:02.123456Z", "2026-10-27T08:31:02+05:30"):
        assert shell_core.when_changed({"valid_from": text}) == "Oct 27, 2026 at 03:01 UTC", text
    assert shell_core.when_changed({"valid_from": "soon"}) == "soon"
    assert shell_core.when_changed({}) == "an unknown time"
    assert shell_core.who_changed({"changed_by": " run 9 "}) == "The job (run 9)" and shell_core.who_changed({}) == "Someone"


def test_a_concurrent_delta_conflict_is_a_409_and_other_failures_stay_502(tmp_path):
    conflict = shell_db.QueryError("[DELTA_CONCURRENT_APPEND] ConcurrentAppendException: Files were added by a concurrent update")
    s, _ws, _made = shell(tmp_path, ws=TableWorkspace(fail=conflict))
    status, out = call(s, "POST", "records/edit", headers=EDITOR, body=edit_body())
    assert status == 409 and "changed this record" in out["error"]
    (tmp_path / "other").mkdir()
    s, _ws, _made = shell(tmp_path / "other", ws=TableWorkspace(fail=shell_db.QueryError("INTERNAL_ERROR: the warehouse stopped")))
    status, out = call(s, "POST", "records/edit", headers=EDITOR, body=edit_body())
    assert status == 502 and "INTERNAL_ERROR" in out["error"]
    (tmp_path / "denied").mkdir()
    s, _ws, _made = shell(tmp_path / "denied", ws=TableWorkspace(fail=shell_db.QueryError("PERMISSION_DENIED: no MODIFY")))
    status, out = call(s, "POST", "records/edit", headers=EDITOR, body=edit_body())
    assert status == 403 and out["error"].startswith("Nothing was saved: this App's service principal may not change "
                                                     f"{shell_sql.table_name(TABLE)} in Unity Catalog (PERMISSION_DENIED")


@pytest.mark.parametrize("column", ["valid_from", "valid_to", "is_current", "change_source", "changed_by", "record_key", "run_id",
                                    "use_case_id", "as_of_date", "entity_id", "notes", "no_such_column", "rank` = 1; --"])
def test_only_business_columns_can_change(tmp_path, column):
    s, ws, _made = shell(tmp_path)
    status, out = call(s, "POST", "records/edit", headers=EDITOR, body=edit_body(values={column: "1"}))
    assert status == 400 and out["error"] == f"{column} cannot be changed in the App"
    assert ws.merges() == []


def test_field_classification_marks_only_business_columns_editable():
    fields = {f["name"]: f for f in shell_sql.change_fields(COLUMNS)}
    editable = sorted(n for n, f in fields.items() if f["editable"])
    assert editable == sorted(["entity_label", "priority_tier", "rank", "top_reasons", "recommended_action", "value", "flagged", "due",
                               "seen_at"])
    assert fields["notes"]["kind"] is None and fields["entity_id"]["role"] == "id" and fields["as_of_date"]["role"] == "run"
    assert all(fields[n]["role"] == "history" for n in HISTORY_ONLY)
    assert {fields[n]["kind"] for n in ("rank", "value", "flagged", "due", "seen_at", "top_reasons")} == {
        "integer", "decimal", "boolean", "date", "timestamp", "lines"}


def test_hostile_values_and_keys_reach_sql_only_as_parameters(tmp_path):
    hostile = "x'); DROP TABLE main.pricing.loss_desk_out; --"
    s, ws, _made = shell(tmp_path)
    headers = {"x-forwarded-email": "a'b.editor"}
    status, _out = call(s, "POST", "records/edit", headers=headers,
                        body=edit_body(record_key=hostile, values={"recommended_action": hostile, "entity_label": "`; DROP"}))
    assert status == 200
    sql, params = ws.merges()[0]
    assert hostile not in sql and "a'b.editor" not in sql and "`; DROP" not in sql
    assert {hostile, "a'b.editor", "`; DROP"} <= {p["value"] for p in params}
    status, _out = call(s, "GET", "records/history", headers=EDITOR, query={"page": "n01_u05", "key": hostile})
    history_sql = [q for q, _p, _l in ws.sql if VERSION in q][-1]
    assert hostile not in history_sql and "CAST(`entity_id` AS STRING) = :p0" in history_sql
    assert call(s, "POST", "records/edit", headers=EDITOR, body=edit_body(valid_from_us="1 OR 1=1"))[0] == 400
    assert call(s, "POST", "records/edit", headers=EDITOR, body=edit_body(values=["a"]))[0] == 400


@pytest.mark.parametrize("name, raw, fragment", [
    ("rank", "abc", "takes a whole number"),
    ("rank", str(2 ** 31), "too large"),
    ("value", "1e999", "takes a number"),
    ("value", "12,5", "takes a number"),
    ("due", "2026-13-01", "not a YYYY-MM-DD date"),
    ("seen_at", "yesterday", "YYYY-MM-DD HH:MM"),
    ("seen_at", "2026-10-27T25:00", "YYYY-MM-DD HH:MM"),
    ("flagged", "maybe", "true or false"),
    ("recommended_action", "x" * 4001, "at most 4,000"),
    ("recommended_action", 12, "takes text"),
    ("top_reasons", ["a"] * 51, "at most 50 lines"),
    ("rank", ["1"], "single value"),
], ids=lambda v: str(v)[:24])
def test_values_are_checked_against_the_column_type(tmp_path, name, raw, fragment):
    s, ws, _made = shell(tmp_path)
    status, out = call(s, "POST", "records/edit", headers=EDITOR, body=edit_body(values={name: raw}))
    assert status == 400 and fragment in out["error"], out
    assert ws.merges() == []


def test_type_aware_values_convert_to_typed_sql():
    fields = {f["name"]: f for f in shell_sql.change_fields(COLUMNS)}
    params = shell_sql._Params()
    assert shell_sql.field_value(fields["rank"], "+7", params) == "CAST(:p0 AS INT)" and params.items[0]["value"] == "7"
    assert shell_sql.field_value(fields["due"], "2026-10-01", params) == ":p1" and params.items[1]["type"] == "DATE"
    assert shell_sql.field_value(fields["seen_at"], "2026-10-01T10:30", params) == "CAST(:p2 AS TIMESTAMP)"
    assert params.items[2]["value"] == "2026-10-01 10:30:00"
    assert shell_sql.field_value(fields["flagged"], "FALSE", params) == "false"
    assert shell_sql.field_value(fields["recommended_action"], "   ", params) == "NULL"
    assert shell_sql.field_value(fields["value"], "", params) == "NULL"
    assert shell_sql.field_value(fields["top_reasons"], "late\n\nprice rise\n", params) == "from_json(:p3, 'ARRAY<STRING>')"
    assert json.loads(params.items[3]["value"]) == ["late", "price rise"]
    assert shell_sql.field_value(fields["top_reasons"], [], params) == "NULL"
    plain = dict(fields["value"], type_text="DECIMAL")
    assert shell_sql.sql_type(plain) == "DECIMAL(38,18)"


def test_add_keys_the_record_by_its_entity_id_and_carries_the_latest_run(tmp_path):
    added = version(1, "add", "pat.lee", "2026-10-27T08:00:00.000Z", current=True, entity_id=43, record_key="43")
    s, ws, _made = shell(tmp_path, ws=TableWorkspace(versions=[added]))
    status, out = call(s, "POST", "records/add", headers=EDITOR, body={"page": "n01_u05", "values": {"entity_label": "New item"}})
    assert status == 400 and out["error"] == "a new record needs its entity_id"
    status, out = call(s, "POST", "records/add", headers=EDITOR,
                       body={"page": "n01_u05", "values": {"entity_id": " 043 ", "entity_label": "New item", "priority_tier": "Review"}})
    assert status == 200, out
    sql, params = ws.merges()[-1]
    by_value = {p["value"]: p for p in params}
    assert "43" in by_value and "add" in by_value
    assert ("FROM (SELECT * FROM `main`.`pricing`.`loss_desk_out` WHERE `is_current` ORDER BY `as_of_date` DESC NULLS LAST, "
            "`valid_from` DESC LIMIT 1) AS b WHERE NOT EXISTS") in sql
    assert "c.`change_source` <> 'delete'" in sql
    assert "CAST(:p3 AS BIGINT) AS `entity_id`" in sql
    assert "NULL AS `recommended_action`" in sql and "b.`run_id` AS `run_id`" in sql and "b.`as_of_date` AS `as_of_date`" in sql
    assert out["record_key"] == "43"
    assert call(s, "POST", "records/add", headers=EDITOR, body={"page": "n01_u05", "values": {"entity_id": "4x"}})[0] == 400


def test_add_conflicts_name_a_duplicate_or_an_empty_table(tmp_path):
    taken = version(1, "run", "run 77", "2026-10-15T06:00:00.000Z", current=True, entity_id=43, record_key="43")
    s, _ws, _made = shell(tmp_path, ws=TableWorkspace(versions=[taken], written=0))
    status, out = call(s, "POST", "records/add", headers=EDITOR, body={"page": "n01_u05", "values": {"entity_id": "43"}})
    assert status == 409 and out["error"] == "a record with the key 43 is already on the list; open it to change it"
    (tmp_path / "empty").mkdir()
    s, _ws, _made = shell(tmp_path / "empty", ws=TableWorkspace(versions=[], written=0))
    status, out = call(s, "POST", "records/add", headers=EDITOR, body={"page": "n01_u05", "values": {"entity_id": "43"}})
    assert status == 409 and "no records yet" in out["error"]


def test_add_without_an_entity_id_column_makes_a_uuid_key(tmp_path):
    columns = [c for c in COLUMNS if c["name"] != "entity_id"]
    added = version(1, "add", "pat.lee", "2026-10-27T08:00:00.000Z", current=True, record_key="app-x")
    s, ws, _made = shell(tmp_path, ws=TableWorkspace(columns=columns, versions=[added]),
                         pages=[edit_page(records=dict(PAGE["records"], key="record_key"))])
    status, _out = call(s, "POST", "records/add", headers=EDITOR, body={"page": "n01_u05", "values": {"entity_label": "Walk-in"}})
    assert status == 200
    keys = [p["value"] for p in ws.merges()[0][1] if re.match(r"^app-[0-9a-f]{32}$", str(p["value"]))]
    assert len(keys) == 1


def test_delete_closes_the_record_and_writes_a_delete_version(tmp_path):
    gone = version(3, "delete", "pat.lee", "2026-10-27T08:00:00.000Z", current=True)
    s, ws, _made = shell(tmp_path, ws=TableWorkspace(versions=[V1, V2, gone]))
    assert call(s, "POST", "records/delete", headers=EDITOR, body=edit_body())[0] == 400
    status, out = call(s, "POST", "records/delete", headers=EDITOR, body=edit_body(values=None))
    assert status == 200 and out["deleted"] is True
    sql, params = ws.merges()[0]
    assert "delete" in [p["value"] for p in params]
    assert "b.`recommended_action` AS `recommended_action`" in sql and "WHEN MATCHED THEN UPDATE SET" in sql


@pytest.mark.parametrize("path", ["records/edit", "records/add", "records/delete", "page", "genie/ask", "genie/explain"])
def test_a_post_that_is_not_json_is_refused_so_another_site_cannot_forge_it(tmp_path, path):
    s, ws, _made = shell(tmp_path)
    for kind in ("text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"):
        status, out = call(s, "POST", path, headers=dict(EDITOR, **{"content-type": kind}), body=edit_body())
        assert status == 415 and out == {"error": "send the request as JSON"}, (path, kind)
    assert ws.sql == [] and ws.genie == []
    status, _out = call(s, "POST", "records/edit", headers=dict(EDITOR, **{"content-type": "application/json; charset=utf-8"}), body=edit_body())
    assert status == 200


def test_writes_need_the_editor_identity(tmp_path):
    s, ws, _made = shell(tmp_path)
    status, out = call(s, "POST", "records/edit", body=edit_body())
    assert status == 401 and "who made the change" in out["error"]
    assert ws.sql == []


def test_per_user_apps_write_as_the_signed_in_user(tmp_path):
    s, ws, made = shell(tmp_path, settings=dict(MODIFY, auth="user"))
    headers = dict(EDITOR, **{"x-forwarded-access-token": "tok-user"})
    assert call(s, "POST", "records/edit", headers=headers, body=edit_body())[0] == 200
    assert made["sp"] == 0 and made["user"] and set(made["user"]) == {"tok-user"}
    assert "pat.lee" in [p["value"] for p in ws.merges()[0][1]]


def test_history_lists_every_version_oldest_first(tmp_path):
    s, ws, _made = shell(tmp_path)
    status, out = call(s, "GET", "records/history", headers=EDITOR, query={"page": "n01_u05", "key": "42"})
    assert status == 200
    assert [v["change_source"] for v in out["versions"]] == ["run", "edit"]
    assert out["current"]["changed_by"] == "pat.lee" and out["deleted"] is False
    assert all(VERSION not in v for v in out["versions"])
    assert {f["name"]: f["editable"] for f in out["fields"]}["recommended_action"] is True
    sql = [q for q, _p, _l in ws.sql if VERSION in q][-1]
    assert sql.endswith("ORDER BY `valid_from` DESC LIMIT 500")
    status, _out = call(s, "GET", "records/history", headers=EDITOR, query={"page": "n01_u05", "record_key": "42"})
    assert status == 200 and [q for q, _p, _l in ws.sql if VERSION in q][-1].count("`record_key` = :p0") == 1


def test_history_refuses_ambiguous_missing_and_unversioned_records(tmp_path):
    other = version(5, "run", "run 77", "2026-10-15T06:00:00.000Z", current=True, record_key="42-b")
    s, _ws, _made = shell(tmp_path, ws=TableWorkspace(versions=[V2, other]))
    status, out = call(s, "GET", "records/history", headers=EDITOR, query={"page": "n01_u05", "key": "42"})
    assert status == 409 and out["error"].startswith("2 records share the key 42")
    (tmp_path / "none").mkdir()
    s, _ws, _made = shell(tmp_path / "none", ws=TableWorkspace(versions=[]))
    assert call(s, "GET", "records/history", headers=EDITOR, query={"page": "n01_u05", "key": "42"})[0] == 404
    assert call(s, "GET", "records/history", headers=EDITOR, query={"page": "n01_u05"})[0] == 400
    (tmp_path / "nokey").mkdir()
    s, _ws, _made = shell(tmp_path / "nokey", pages=[edit_page(records=dict(PAGE["records"], key="item_code"))])
    status, out = call(s, "GET", "records/history", headers=EDITOR, query={"page": "n01_u05", "key": "A1"})
    assert status == 409 and "key item_code is not a column of the result table" in out["error"]


def test_a_page_without_a_result_table_keeps_no_history_and_says_so(tmp_path):
    s, ws, _made = shell(tmp_path, settings=SETTINGS, pages=[copy.deepcopy(PAGE)])
    for method, path, query, body in (("GET", "records/history", {"page": "n01_u05", "key": "42"}, None),
                                      ("GET", "records/fields", {"page": "n01_u05"}, None)):
        status, out = call(s, method, path, query=query, headers=EDITOR, body=body)
        assert status == 409 and "names no result table" in out["error"], path
    status, out = call(s, "GET", "runs", headers=EDITOR, query={"page": "n01_u05"})
    assert (status, out["runs"], out["total"], out["job"], out["errors"]) == (200, [], 0, None, {}), \
        "the Runs tab of a page with no job and no result table lists nothing and says why"
    assert ws.sql == []


def test_settings_and_spec_validate_the_result_table(tmp_path):
    assert any("page n01_u05 names no result_table" in p for p in shell_core.settings_problems(MODIFY, [PAGE]))
    assert shell_core.settings_problems(MODIFY, [edit_page()]) == []
    for bad in ("main.pricing", "main.pricing.t.x", "main.`pricing`.t", "main..t", "main.pricing.t\x00x"):
        assert any("result_table" in p for p in shell_sql.spec_problems(edit_page(result_table=bad))), bad
    assert shell_sql.table_name(" main . pricing-lab . loss out ") == "`main`.`pricing-lab`.`loss out`"
    s, _ws, _made = shell(tmp_path)
    status, info = call(s, "GET", "app", headers=EDITOR)
    assert info["pages"][0]["history"] is True and info["options"]["modify"] is True
    assert TABLE not in json.dumps(info) and "loss_desk_out" not in json.dumps(info)


def test_fields_name_the_id_column_for_the_add_form(tmp_path):
    s, _ws, _made = shell(tmp_path)
    status, out = call(s, "GET", "records/fields", headers=EDITOR, query={"page": "n01_u05"})
    assert status == 200 and out["key_field"] == "entity_id"
    assert {f["name"] for f in out["fields"] if f["editable"]} >= {"recommended_action", "priority_tier"}
    assert set(out["fields"][0]) == {"name", "type", "kind", "role", "editable"}


def test_the_trend_tab_is_gone_so_its_route_answers_404_and_reads_nothing(tmp_path):
    s, ws, _made = shell(tmp_path)
    status, out = call(s, "POST", "trend", headers=EDITOR, body={"page": "n01_u05", "filters": {"run_date": {"from": "2026-01-01", "to": "2026-10-31"}}})
    assert (status, out) == (404, {"error": "no API route POST /api/trend"})
    assert ws.sql == []
    assert "trend_rows" not in shell_sql.CAPS


def test_the_build_check_passes_when_editing_is_on_and_the_app_can_read_the_result_table(tmp_path):
    s, _ws, _made = shell(tmp_path)
    assert s.check(dict(EDITOR)) == []


def test_expression_columns_skip_functions_keywords_and_literals():
    assert shell_sql.expression_columns("SUM(CASE WHEN tier = 'Act now' THEN value ELSE 0 END) / NULLIF(COUNT(DISTINCT entity_id), 0)") == {
        "tier", "value", "entity_id"}
    assert shell_sql.expression_columns("COUNT(*)") == set()
    assert shell_sql.expression_columns("SUM(`loss amount`) * 1e3") == {"loss amount"}


def test_run_health_reads_the_cadence_and_an_overdue_job_and_lists_each_run_with_only_what_the_app_shows():
    rows = []
    for run_id, day, ran in (("1", "2026-09-01", "2026-09-01T06:00:00Z"), ("2", "2026-09-08", "2026-09-08T06:00:00Z"),
                             ("3", "2026-09-15", "2026-09-15T06:00:00Z"), ("4", "2026-09-26", "2026-09-26T06:00:00Z"),
                             ("5", "2026-10-17", "2026-10-17T06:00:00Z"), ("6", "2026-10-17", "2026-10-17T09:00:00Z")):
        rows.append({"run_id": run_id, "tier": "Act now", "as_of_date": day, "ran_at": ran, "n": 2})
        rows.append({"run_id": run_id, "tier": "Review", "as_of_date": day, "ran_at": ran, "n": 3})
    health = shell_sql.run_health(rows, datetime.date(2026, 10, 27))
    by = {r["run_id"]: r for r in health["runs"]}
    assert [r["run_id"] for r in health["runs"]] == ["6", "5", "4", "3", "2", "1"]
    assert health["cadence_days"] == 7.0
    assert all(set(r) == {"run_id", "as_of_date", "ran_at", "rows", "tiers"} for r in health["runs"]), \
        "late and missing flags left the Runs tab, so no run carries them"
    assert set(shell_core.blank_run("u1")) == {"run_id", "as_of_date", "ran_at", "rows", "tiers"}
    assert by["1"] == {"run_id": "1", "as_of_date": "2026-09-01", "ran_at": "2026-09-01T06:00:00Z", "rows": 5, "tiers": {"Act now": 2, "Review": 3}}
    assert health["days_since"] == 10 and health["overdue"] is False and health["last_as_of_date"] == "2026-10-17"
    assert shell_sql.run_health(rows, datetime.date(2026, 11, 1))["overdue"] is True
    assert shell_sql.run_health([], datetime.date(2026, 11, 1)) == {"runs": [], "cadence_days": None, "last_as_of_date": None,
                                                                   "days_since": None, "overdue": False}


def test_runs_route_reads_run_versions_from_the_result_table(tmp_path):
    runs = [{"run_id": "77", "tier": "Review", "as_of_date": "2026-10-15", "ran_at": "2026-10-15T06:00:00.000Z", "n": 12}]
    clock = lambda: datetime.datetime(2026, 10, 27, tzinfo=datetime.timezone.utc).timestamp()
    s, ws, _made = shell(tmp_path, ws=TableWorkspace(runs=runs), clock=clock)
    status, out = call(s, "GET", "runs", headers=EDITOR, query={"page": "n01_u05"})
    assert status == 200 and out["total"] == 1
    assert {k: out["runs"][0][k] for k in ("run_id", "started", "records", "to_fix", "status")} == {
        "run_id": "77", "started": "2026-10-15T06:00:00.000Z", "records": 12, "to_fix": 12, "status": "done"}
    sql = [q for q, _p, _l in ws.sql if "AS ran_at" in q][0]
    assert "WHERE `change_source` = 'run' GROUP BY 1, 2" in sql


def test_the_notebook_stamps_the_result_table_on_every_app_page(agent_ns):
    import _agentload
    stamp = agent_ns["implement_app_page"]
    page = stamp(dict(copy.deepcopy(PAGE), result_table="genie.wrote.this"), "N01-U05", {}, TABLE)
    assert page["result_table"] == TABLE and shell_sql.spec_problems(page) == []
    assert "result_table" not in stamp(dict(copy.deepcopy(PAGE), result_table="genie.wrote.this"), "N01-U05", {})
    source = _agentload.agent_source()
    assert source.count('implement_app_page(raw, context["uc_id"], context["use_case"], context["result_table"],') == 1
    assert "Inspire sets id, use_case_id, result_table, review, domain, subdomain and sponsor." in source


def test_the_fastapi_adapter_returns_the_403_as_json(tmp_path, monkeypatch):
    pytest.importorskip("fastapi")
    pytest.importorskip("httpx")
    from v141_app_shell_http_test import client
    c = client(tmp_path, monkeypatch)
    r = c.post("/api/records/edit", json=edit_body(), headers=EDITOR)
    assert r.status_code == 403 and r.json() == {"error": "this App does not let people change its data"}
    assert r.headers["cache-control"] == "no-store"
