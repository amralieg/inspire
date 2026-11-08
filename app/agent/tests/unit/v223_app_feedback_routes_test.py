import sqlite3

import pytest

from v141_app_shell_test import SETTINGS, call
from v148_app_hub_test import PERSON, SqliteWorkspace, hub_shell, to_sqlite
import shell_db
import shell_sql

OWNER = "@".join(["owner", "example.com"])
SAM = "@".join(["sam.ortiz", "example.com"])
FEEDBACK = ("feedback_id", "use_case_id", "section", "record_key", "text", "reported_by", "reported_at", "status", "vibe_text", "handled_by",
            "handled_at", "filters")
OWNED = dict(SETTINGS, use_case_owners={"n01_u05": [OWNER]})


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class FeedbackWorkspace(SqliteWorkspace):
    def run_sql(self, warehouse, sql, params, limit=5000):
        if not sql.startswith("INSERT INTO"):
            return super().run_sql(warehouse, sql, params, limit)
        with self.lock:
            self.sql.append((sql, params, limit))
        for marker, error in self.fail.items():
            if marker in sql:
                raise error
        with self.lock:
            try:
                self.db.execute(to_sqlite(sql), {p["name"]: p["value"] for p in params})
            except sqlite3.OperationalError as error:
                raise shell_db.QueryError(f"[TABLE_OR_VIEW_NOT_FOUND] {error}") from error
        return {"columns": [], "rows": [{"num_affected_rows": 1, "num_inserted_rows": 1}], "truncated": False}


def _shell(tmp_path, settings=OWNED, table=True):
    ws = FeedbackWorkspace()
    if table:
        ws.db.execute(f'CREATE TABLE "loss_desk_out_feedback" ({", ".join(chr(34) + c + chr(34) for c in FEEDBACK)})')
    s, ws, _made = hub_shell(tmp_path, settings=settings, ws=ws)
    s.timer = Clock()
    return s, ws


def _report(s, who=PERSON, **body):
    return call(s, "POST", "feedback", headers={"x-forwarded-email": who} if who else {},
                body=dict({"page": "n01_u05", "section": "work", "text": "The due date is wrong on this row"}, **body))


def _stored(ws):
    cursor = ws.db.execute('SELECT * FROM "loss_desk_out_feedback"')
    names = [c[0] for c in cursor.description]
    return [dict(zip(names, row)) for row in cursor.fetchall()]


def test_a_report_is_stored_with_its_context_through_bound_parameters(tmp_path):
    s, ws = _shell(tmp_path)
    status, out = _report(s, record_key="k1", filters="Category: A")
    assert status == 200 and len(out["sent"]) == 32 and out["everyone"] is False
    rows = _stored(ws)
    assert len(rows) == 1
    row = rows[0]
    assert (row["use_case_id"], row["section"], row["record_key"], row["text"], row["reported_by"], row["status"], row["filters"]) == (
        "N01-U05", "work", "k1", "The due date is wrong on this row", PERSON, "new", "Category: A")
    assert row["reported_at"] and row["vibe_text"] is None
    sql, params = ws.queries("INSERT INTO")[0]
    assert "The due date" not in sql and PERSON not in sql
    assert [p["value"] for p in params if p["value"] == "The due date is wrong on this row"]
    assert [i["feedback_id"] for i in out["items"]] == [row["feedback_id"]]


def test_sql_injection_text_is_stored_verbatim_and_runs_nothing(tmp_path):
    s, ws = _shell(tmp_path)
    attack = "x'); DROP TABLE loss_desk_out; -- `` \\' \" ${p0} :p1"
    status, _out = _report(s, text=attack, record_key="k1' OR '1'='1", filters="'; DELETE FROM loss_desk_out_feedback; --")
    assert status == 200
    row = _stored(ws)[0]
    assert row["text"] == attack and row["record_key"] == "k1' OR '1'='1" and row["filters"].startswith("'; DELETE")
    assert ws.db.execute('SELECT COUNT(*) FROM "loss_desk_out"').fetchone()[0] > 0
    sql, _params = ws.queries("INSERT INTO")[0]
    assert "DROP" not in sql and "DELETE" not in sql


@pytest.mark.parametrize("body,said", [
    ({"text": "x" * 2001}, "keep the report to 2,000 characters; it has 2,001"),
    ({"text": "   "}, "say what is wrong or what you would change"),
    ({"text": 7}, "say what is wrong or what you would change"),
    ({"section": "admin"}, "send section as one of: dashboard, work, performance, runs, alerts, settings"),
    ({"record_key": "k" * 513}, "send record_key as text of at most 512 characters"),
    ({"filters": "f" * 1001}, "send filters as text of at most 1,000 characters")])
def test_a_bad_report_is_refused_and_writes_nothing(tmp_path, body, said):
    s, ws = _shell(tmp_path)
    status, out = _report(s, **body)
    assert status == 400 and out["error"] == said
    assert not ws.queries("INSERT INTO") and not _stored(ws)


def test_exactly_two_thousand_characters_is_accepted(tmp_path):
    s, ws = _shell(tmp_path)
    assert _report(s, text="é" * 2000)[0] == 200
    assert len(_stored(ws)[0]["text"]) == 2000


def test_a_report_needs_a_signed_in_person(tmp_path):
    s, ws = _shell(tmp_path)
    status, out = _report(s, who="")
    assert status == 401 and not _stored(ws)


def test_one_person_is_limited_per_hour_and_others_are_not(tmp_path):
    s, ws = _shell(tmp_path)
    cap = shell_sql.CAPS["feedback_per_hour"]
    for _ in range(cap):
        assert _report(s)[0] == 200
    status, out = _report(s)
    assert status == 429 and out["error"].startswith(f"you reported {cap} issues in the last hour")
    assert out["error"].endswith("try again in 60 minutes")
    assert _report(s, who=SAM)[0] == 200
    s.timer.now += 3600.5
    assert _report(s)[0] == 200
    assert len(_stored(ws)) == cap + 2


def test_a_refused_report_does_not_use_up_the_limit(tmp_path):
    s, _ws = _shell(tmp_path)
    for _ in range(shell_sql.CAPS["feedback_per_hour"] + 3):
        assert _report(s, text="x" * 2001)[0] == 400
    assert _report(s)[0] == 200


def test_a_person_sees_only_their_own_reports_and_an_owner_sees_every_one(tmp_path):
    s, _ws = _shell(tmp_path)
    _report(s, text="mine")
    _report(s, who=SAM, text="sam's")
    status, mine = call(s, "GET", "feedback", query={"page": "n01_u05"}, headers={"x-forwarded-email": PERSON})
    assert status == 200 and [i["text"] for i in mine["items"]] == ["mine"] and mine["everyone"] is False
    status, owner = call(s, "GET", "feedback", query={"page": "n01_u05"}, headers={"x-forwarded-email": OWNER})
    assert status == 200 and sorted(i["text"] for i in owner["items"]) == ["mine", "sam's"] and owner["everyone"] is True
    assert owner["limit"] == 2000


def test_an_app_built_before_the_feedback_table_says_to_rebuild(tmp_path):
    s, _ws = _shell(tmp_path, table=False)
    status, out = _report(s)
    assert status == 409 and "loss_desk_out_feedback` does not exist yet" in out["error"]
    assert "so Inspire creates it" in out["error"]
    status, listed = call(s, "GET", "feedback", query={"page": "n01_u05"}, headers={"x-forwarded-email": PERSON})
    assert status == 200 and listed["missing"] is True and listed["items"] == []


def test_a_service_principal_without_modify_says_who_must_grant_it(tmp_path):
    s, ws = _shell(tmp_path)
    ws.fail["INSERT INTO `main`.`pricing`.`loss_desk_out_feedback`"] = shell_db.QueryError("[INSUFFICIENT_PERMISSIONS] no MODIFY")
    status, out = _report(s)
    assert status == 403 and "service principal may not change `main`.`pricing`.`loss_desk_out_feedback`" in out["error"]


def test_the_feedback_queries_bind_every_value():
    page = {"result_table": "main.pricing.loss_desk_out", "use_case_id": "N01-U05"}
    sql, params = shell_sql.feedback_query(page, SAM.upper(), 50)
    assert sql.endswith("WHERE `use_case_id` = :p1 AND lower(`reported_by`) = :p0 ORDER BY `reported_at` DESC LIMIT 50")
    assert ":p0" in sql and ":p1" in sql and SAM not in sql and {p["value"] for p in params} == {SAM, "N01-U05"}
    with pytest.raises(ValueError):
        shell_sql.feedback_table({"result_table": "main.pricing.x` ; DROP TABLE y; --"})
    assert shell_sql.feedback_table({"result_table": "main.pricing.x; DROP TABLE y"}) == "`main`.`pricing`.`x; DROP TABLE y_feedback`"


def test_the_feedback_table_belongs_to_its_page_like_every_other_inspire_table(tmp_path):
    s, _ws = _shell(tmp_path)
    for suffix in ("_plans", "_scenarios", "_feedback"):
        assert suffix in shell_sql.INSPIRE_SUFFIXES, suffix
        assert s.owned_by(f"main.pricing.loss_desk_out{suffix}") == {"n01_u05"}, suffix
    assert s.owned_by("main.pricing.loss_desk_out_feedbacks") == set()
