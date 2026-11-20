"""A page inside Inspire runs the same App source with no service principal at all: its settings say host inspire, and on every route
it reads and acts only as the signed-in viewer, with the job features it cannot do as the viewer off and a plain reason. A per-user
App of its own has its own service principal, which keeps reading and starting the use case's job for the person who built it,
offline."""
import inspect
import io
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
from v141_app_shell_test import app_dir, call  # noqa: E402
from v142_edits_test import edit_page  # noqa: E402
from v144_app_data_test import DECIDE, DataWorkspace, current  # noqa: E402
from v144_app_ops_test import ASKED, DANA, HOST, JOB, LEE, OWNER, WEEKLY, JobsWorkspace, job_run, ops_settings, signed  # noqa: E402

PAGE = "n01_u05"
OFF = ("This page runs inside Inspire with no service principal of its own, so it never reads or starts the use case's job: it shows "
       "the runs the use case recorded, and Refresh now is off; the job's schedule still refreshes it")


class SpUsed(Exception):
    pass


class AnyWorkspace:
    def __init__(self):
        self.calls = []

    def run_sql(self, warehouse, sql, params, limit=5000):
        self.calls.append(("run_sql", sql))
        return {"columns": [], "rows": [], "truncated": False}

    def __getattr__(self, name):
        def answer(*args, **kwargs):
            self.calls.append((name, args))
            return {}
        return answer


def _routes() -> list:
    handle = inspect.getsource(shell_core.Shell.handle)
    assert "self.dispatch(method, path, query, headers, body)" in handle, "every route is answered through dispatch"
    handle = inspect.getsource(shell_core.Shell.dispatch)
    assert "self.answer(method, path, query, headers, body)" in handle and "shell_sql.plain_answer(answer)" in handle, \
        "every route answers through the one plain-error boundary"
    source = inspect.getsource(shell_core.Shell.answer) + inspect.getsource(shell_core.Shell.answer_request)
    named = re.findall(r'route == \("(GET|POST)", "([a-z/]+)"\)', source)
    named += [("POST", path) for path in shell_core.WRITE_SOURCES] + [("POST", path) for path in shell_core.ALERT_ROUTES]
    assert "WRITE_SOURCES" in source and "ALERT_ROUTES" in source and len(named) >= 27
    return named


QUERY = {"page": PAGE, "filter": "region", "column": "region", "record_key": "k1", "conversation_id": "c1", "message_id": "m1",
         "offset": "0"}
BODY = (b'{"page": "n01_u05", "filters": {}, "record_key": "k1", "record_keys": ["k1"], "seen": {"k1": "1"}, "values": {}, '
        b'"question": "why", "kind": "chart", "title": "t", "context": {}, "id": "a1", "paused": true, "watch": {}, "name": "x"}')


def _inside(**changes):
    return ops_settings(auth="user", host="inspire", **changes)


def _shell(tmp_path, settings, sp_factory, user):
    return shell_core.Shell(app_dir(tmp_path, settings, [edit_page()]), env={"DATABRICKS_WAREHOUSE_ID": "wh1", "DATABRICKS_HOST": HOST},
                            sp_factory=sp_factory, user_factory=lambda host, token: user)


def test_every_route_of_a_page_inside_inspire_reads_as_the_app_and_never_as_the_viewer(tmp_path):
    # REQ-418 (D-SL-10B): data routes read through the App's service principal; the viewer is only the recorded actor.
    sp_calls, user, used = [], AnyWorkspace(), []
    sp = AnyWorkspace()

    def make_sp():
        sp_calls.append("sp")
        return sp

    s = _shell(tmp_path, _inside(options={"modify": True, "replace_edits": False, "decisions": False, "alerts": False}), make_sp, user)
    assert s.inside is True
    for method, path in _routes():
        for headers in (signed(OWNER, "tok-owner"), signed(DANA, "tok-dana")):
            try:
                s.handle(method, path, dict(QUERY), dict(headers, **{"content-type": "application/json"}),
                         BODY if method == "POST" else b"")
            except Exception:  # noqa: BLE001 - a route may refuse for its own reason; only the workspace used is asserted
                pass
            used.append((method, path))
    assert user.calls == [], f"no route reads as the viewer: {user.calls[:3]}"
    assert sp_calls and sp.calls, "data routes read through the App's service principal"
    assert s.service() is sp, "the App's service principal is the one every read uses"

def test_a_page_inside_inspire_shows_the_recorded_runs_and_says_why_its_job_is_not_read_or_started(tmp_path):
    sp, user = JobsWorkspace(runs=WEEKLY), JobsWorkspace()
    s = _shell(tmp_path, _inside(), lambda: sp, user)
    out = call(s, "GET", "freshness", query={"page": PAGE}, headers=signed(OWNER, "tok-o"))[1]
    assert (out["has_job"], out["can_refresh"], out["reason"], out["source"]) == (True, False, OFF, "table")
    assert out["data_through"] == "2026-10-25" and out["last_success"]["run_id"] == "u3", "the recorded runs still show freshness"
    assert call(s, "POST", "refresh", headers=signed(OWNER, "tok-o"), body={"page": PAGE}) == (403, {"error": OFF})
    runs = call(s, "GET", "runs", query={"page": PAGE}, headers=signed(DANA, "tok-d"))[1]
    assert runs["job"]["error"] == OFF and runs["total"] == 3, "the runs the result table recorded are listed"
    assert user.calls == [], "the viewer's workspace is never used: reads run as the App (D-SL-10B)"
    assert shell_core.USER_JOBS == OFF


def test_a_regular_per_user_app_keeps_runs_freshness_and_refresh_through_its_own_service_principal(tmp_path):
    sp = JobsWorkspace(job_runs=[job_run(1, "2026-10-25T06:00:00Z", "2026-10-25T06:05:00Z")])
    user = JobsWorkspace(runs=WEEKLY)
    s = _shell(tmp_path, ops_settings(auth="user"), lambda: sp, user)
    assert s.inside is False
    out = call(s, "GET", "freshness", query={"page": PAGE}, headers=signed(OWNER, "tok-o"))[1]
    assert out["can_refresh"] is True and out["reason"] == "" and out["source"] == "job", out
    assert sp.jobs_calls("list"), "the App's own service principal reads the job"
    runs = call(s, "GET", "runs", query={"page": PAGE}, headers=signed(DANA, "tok-d"))[1]
    assert runs["job"]["error"] == "" and any(r.get("job_run_id") == "1" for r in runs["runs"]), "the job's run joins the recorded one"
    status, out = call(s, "POST", "refresh", headers=signed(LEE, "tok-l"), body={"page": PAGE})
    assert status == 403 and out == {"error": s.requester(signed(LEE, "tok-l"), s.page(PAGE))[2]} and out["error"], "only its owners refresh it"
    assert sp.jobs_calls("run-now") == []
    assert call(s, "POST", "refresh", headers=signed(OWNER, "tok-o"), body={"page": PAGE})[0] == 200
    assert sp.jobs_calls("run-now") == [("run-now", JOB, {ASKED: OWNER})]


def test_a_shared_view_app_still_reads_and_refreshes_its_job_through_its_service_principal(tmp_path):
    sp = JobsWorkspace(runs=WEEKLY)
    s = _shell(tmp_path, ops_settings(), lambda: sp, sp)
    assert call(s, "GET", "freshness", query={"page": PAGE}, headers=signed(DANA))[1]["can_refresh"] is True
    assert call(s, "POST", "refresh", headers=signed(DANA), body={"page": PAGE})[0] == 200
    assert sp.jobs_calls("run-now") and sp.jobs_calls("list")


def test_a_page_inside_inspire_with_decisions_on_refuses_them_without_inspire_s_writer_and_writes_nothing(tmp_path):
    # REQ-418 (D-SL-10B): reads run as the App; a decision with no Inspire writer is refused and no write reaches any workspace.
    sp, user = AnyWorkspace(), AnyWorkspace()
    s = _shell(tmp_path, _inside(options=dict(DECIDE["options"])), lambda: sp, user)
    for path in ("records/act", "records/undo"):
        body = json.dumps({"page": PAGE, "record_keys": ["k1"], "seen": {"k1": "1"}, "values": {"action_status": "Done"}} if path ==
                          "records/act" else {"page": PAGE, "batch_id": "a" * 32}).encode("utf-8")
        status, out = s.handle("POST", path, {}, dict(signed(DANA, "tok-dana"), **{"content-type": "application/json"}), body)
        assert (status, out) == (403, {"error": shell_core.INSIDE_DECISIONS}), path
    assert not any("MERGE INTO" in str(c) for c in sp.calls + user.calls)


class Warehoused(DataWorkspace):
    def __init__(self, **kw):
        super().__init__(**kw)
        self.warehouses = []

    def run_sql(self, warehouse, statement, parameters=None, limit=5000):
        self.warehouses.append(warehouse)
        return super().run_sql(warehouse, statement, parameters, limit=limit)


TABLE = edit_page()["result_table"]


def _step(root, **changes):
    request = {"v": shell_core.CLI_VERSION, "route": "records/act", "root": root, "host": HOST, "warehouse": "wh1", "result_table": TABLE,
               "writer": {"token": "tok-inspire", "warehouse": "wh-inspire"}, "headers": {"X-Forwarded-Email": DANA,
                                                                                         "X-Forwarded-Access-Token": "tok-dana"},
               "body": {"page": PAGE, "record_keys": ["k1"], "seen": {"k1": "101"}, "values": {"action_status": "Done"}}}
    request.update(changes)
    return request


def _factory(reader, writer, asked):
    def make(host, token):
        asked.append((host, token))
        return {"tok-dana": reader, "tok-inspire": writer}[token]
    return make


def test_inspire_records_a_decision_for_a_page_inside_it_as_the_app_and_records_the_viewer_as_actor(tmp_path):
    # REQ-418 (D-SL-10B): the App reads and writes; the viewer is the recorded actor, never the identity the SQL runs as.
    reader, writer, asked = Warehoused(), Warehoused(current=[current("k1", "run", "run 7")]), []
    root = app_dir(tmp_path, _inside(options=dict(DECIDE["options"])), [edit_page()])
    status, out = shell_core.cli_answer(_step(root), user_factory=_factory(reader, writer, asked))
    assert status == 200 and out["written"] == ["k1"] and out["left_out"] == 0, out
    assert set(asked) == {(HOST, "tok-inspire")} and reader.sql == [], "every read and the write run on the App's token"
    (sql, params), = writer.queries("MERGE INTO")
    assert writer.warehouses[-1] == "wh-inspire" and DANA in [p["value"] for p in params] and re.search(r":p\d+ AS `changed_by`", sql)
    writer.current = []
    writer.sql.clear()
    status, out = shell_core.cli_answer(_step(root), user_factory=_factory(reader, writer, asked))
    assert status == 403 and out["left_out"] == 1 and writer.queries("MERGE INTO") == [], "a record the App cannot read gets no decision"


@pytest.mark.parametrize("changes, status, fragment", [
    ({"result_table": "main.pricing.other_out"}, 409, "names a result table Inspire did not build for it"),
    ({"v": 2}, 400, "send a decision step of version 1"),
    ({"route": "records"}, 404, "there is no decision step 'records'"),
    ({"writer": {"token": "", "warehouse": "wh-inspire"}}, 400, "send token as text"),
    ({"writer": "tok"}, 400, "send writer with the token"),
    ({"headers": []}, 400, "send body and headers as objects"),
    ({"host": " "}, 400, "send host as text"),
], ids=["other_table", "version", "route", "token", "writer", "headers", "host"])
def test_the_decision_step_refuses_a_request_it_cannot_trust_before_any_sql(tmp_path, changes, status, fragment):
    reader, writer, asked = Warehoused(current=[current("k1", "run", "run 7")]), Warehoused(), []
    root = app_dir(tmp_path, _inside(options=dict(DECIDE["options"])), [edit_page()])
    got = shell_core.cli_answer(_step(root, **changes), user_factory=_factory(reader, writer, asked))
    assert got[0] == status and fragment in got[1]["error"], got
    assert reader.sql == [] and writer.sql == []


def test_a_decision_on_an_sp_page_inside_inspire_is_written_as_the_app_token_with_the_viewer_recorded_as_actor(tmp_path):
    # REQ-418 ruling 3 (D-SL-10B): the viewer's read runs on the viewer's token; the write runs on the App's token (writer.token);
    # the viewer is the recorded actor. Fails before the fix: the CLI answered 403 "has no service principal".
    reader, writer, asked = Warehoused(), Warehoused(current=[current("k1", "run", "run 7")]), []
    own = app_dir(tmp_path, dict(_inside(options=dict(DECIDE["options"])), auth="sp"), [edit_page()])
    status, body = shell_core.cli_answer(_step(own), user_factory=_factory(reader, writer, asked))
    assert status == 200 and body["written"] == ["k1"], (status, body)
    assert set(asked) == {(HOST, "tok-inspire")} and reader.sql == [], "the read and the one write both run on the App's token, never the viewer's"
    (_sql, params), = writer.queries("MERGE INTO")
    assert DANA in [p.get("value") if isinstance(p, dict) else p for p in params], "the viewer is the recorded actor"
    out = io.StringIO()
    assert shell_core.cli(io.StringIO("not json"), out) == 0
    assert json.loads(out.getvalue())["status"] == 400


def test_the_decision_step_refuses_an_empty_app_token_before_any_read_or_write(tmp_path):
    # Deterministic identity: no App token means no decision, never a write with an empty bearer (must-exclude).
    reader, writer, asked = Warehoused(current=[current("k1", "run", "run 7")]), Warehoused(), []
    own = app_dir(tmp_path, dict(_inside(options=dict(DECIDE["options"])), auth="sp"), [edit_page()])
    request = _step(own, writer={"token": "", "warehouse": "wh-inspire"})
    status, body = shell_core.cli_answer(request, user_factory=_factory(reader, writer, asked))
    assert (status, body) == (400, {"error": "send token as text"}), (status, body)
    assert asked == [] and writer.sql == []


@pytest.mark.parametrize("changes,problem", [
    ({"host": "elsewhere"}, "the App host must be inspire when it is set, for a page inside Inspire"),
    ({"host": "inspire", "auth": "user", "backend": {"kind": "lakebase", "pipeline_id": "p", "tables": {}, "datasets": {}}},
     "a page inside Inspire reads Delta tables, so its backend must be delta"),
], ids=["another_host", "lakebase"])
def test_settings_that_place_a_page_inside_inspire_must_hold_together(changes, problem):
    settings = dict(ops_settings(), **changes)
    assert problem in shell_core.settings_problems(settings, [edit_page()])
    assert not any("host" in p or "inside Inspire" in p for p in shell_core.settings_problems(_inside(), [edit_page()]))
    assert not any("inside Inspire" in p for p in shell_core.settings_problems(ops_settings(auth="user"), [edit_page()]))
