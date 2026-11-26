"""REQ-414 part B, run hook and uninstall: a use case's build creates its assets during the run, the records stay on its asset status,
and Uninstall all deletes each one (a missing asset is silent; any other failure is reported). Stubs stand in for the workspace.
"""
import logging
import os
import sys

import pytest

from _agentload import load_agent_namespace

SERVER = os.path.join(os.path.dirname(__file__), "..", "..", "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_build  # noqa: E402

NOTEBOOK = "/Workspace/Inspire/agent/dbx_inspire_ai_agent"
ONLINE = {"endpoints": [{"name": "vs-main", "endpoint_status": {"state": "ONLINE"}}]}
PERMISSION = "[PERMISSION_DENIED] User does not have permission to delete this index"


class NotFound(Exception):
    pass


class Recorder:
    """A workspace stub: records every call; answers from a script (a body, or an exception to raise)."""

    def __init__(self, script=None):
        self.script = script or {}
        self.calls = []
        self.tools = []

    def __call__(self, method, path, body=None, query=None):
        self.calls.append((method, path, body, query))
        for (m, prefix), outcome in self.script.items():
            if m == method and path.startswith(prefix):
                if isinstance(outcome, Exception):
                    raise outcome
                return outcome
        if method == "GET" and path.endswith("/tools"):
            return {"tools": [{"tool_id": t} for t in self.tools]}
        if method == "POST" and path.endswith("/tools"):
            self.tools.append((query or {}).get("tool_id"))
            return {}
        if method == "POST" and path == shell_build.SUPERVISOR_AGENTS_PATH:
            return {"id": "sup-1"}
        if method == "POST" and path == shell_build.JOBS_CREATE_PATH:
            return {"job_id": 77}
        if method == "GET" and path == shell_build.VECTOR_ENDPOINTS_PATH:
            return ONLINE
        return {}

    def paths(self, method=None):
        return [p for m, p, _b, _q in self.calls if method is None or m == method]


def build(rec, kind, status, uc="uc-1", space="", result_table="c.s.t", columns=None, text_column="", notebook=NOTEBOOK,
          domains=None, run_sql=None, ask=None, lines=None, pg_schema="app_schema", records_table=None, run=None):
    context = {"uc_id": uc, "kind_spec": {"kind": {"id": kind, "label": kind, "question": "How did it go?"},
                                          "columns": columns or {}},
               "asset_status": {"genie_space": {"id": space}} if space else {}, "result_table": result_table,
               "notebook_path": notebook, "text_column": text_column,
               "records_table": records_table if records_table is not None else result_table.split(".")[-1]}
    run = run if run is not None else {"domains": domains if domains is not None else {}, "records": []}
    out = shell_build.build_for_context(shell_build.BuildApi(rec), context, status, ask or (lambda s, q: f"{s} answered"),
                                        (lines if lines is not None else []).append, lambda n: f'"{n}"', run_sql, run, pg_schema)
    return out, context, run["domains"]


# --- the dispatch ----------------------------------------------------------------------------------------------------------

def test_a_supervisor_build_attaches_its_domain_space_and_keeps_the_records():
    rec = Recorder()
    out, context, _d = build(rec, "cross_domain_assistant", {"supervisor_agents": "available"}, space="space-a")
    assert out["path"] == "supervisor"
    assert {"asset": "supervisor", "supervisor_id": "sup-1"} in context["asset_status"]["build_records"]


def test_early_and_late_spaces_are_both_attached_once_and_uninstalling_one_use_case_removes_only_its_tool():
    """The run's state is read from the persisted rows of its use cases each time: the cross-domain use case creates the supervisor;
    a later use case attaches its own space to it; a repeated space is not posted again; uninstalling one use case deletes only its tool."""
    rec, rows = Recorder(), []

    def go(**kw):
        out, ctx, _d = build(rec, run=shell_build.run_state(rows), **kw)
        rows.append(ctx["asset_status"])
        return out, ctx
    go(kind="cross_domain_assistant", status={"supervisor_agents": "available"}, uc="uc-1", space="space-a")
    late, late_ctx = go(kind="lookalikes", status={"vector_search": "unavailable"}, uc="uc-2", space="space-b")
    go(kind="lookalikes", status={"vector_search": "unavailable"}, uc="uc-3", space="space-a")
    assert rec.tools == ["space_space_a", "space_space_b"], "each space is one tool, and the repeat is not posted again"
    assert [r for r in late["records"] if r["asset"] == "supervisor_tool"] == [{"asset": "supervisor_tool", "supervisor_id": "sup-1",
                                                                               "tool_id": "space_space_b"}]
    deleter = Recorder()
    shell_build.delete_records(shell_build.BuildApi(deleter), late["records"], lambda e: False, str)
    assert deleter.calls == [("DELETE", "/api/2.1/supervisor-agents/sup-1/tools/space_space_b", None, None)]


def test_an_unavailable_supervisor_runs_the_orchestrator_through_the_ask_and_creates_nothing():
    rec, seen = Recorder(), []
    out, context, _d = build(rec, "cross_domain_assistant", {"supervisor_agents": "unavailable"}, space="space-a",
                             ask=lambda s, q: seen.append((s, q)) or "ok")
    assert out["path"] == "orchestrator_job" and out["records"] == []
    assert seen == [] and rec.calls == [], "the orchestrator answers before the App page is written, not in the build"


def test_an_index_is_built_on_an_online_endpoint_with_its_detected_inputs():
    rec = Recorder()
    columns = {"entity_name": ["c.s.customers.customer_name"], "case_id": ["c.s.customers.customer_id"]}
    out, context, _d = build(rec, "lookalikes", {"vector_search": "available"}, result_table="c.s.customers", columns=columns)
    assert out["path"] == "vector_index"
    assert ("POST", "/api/2.0/vector-search/indexes") in [(m, p) for m, p, _b, _q in rec.calls]
    index_body = next(b for m, p, b, _q in rec.calls if p == "/api/2.0/vector-search/indexes")
    assert index_body["endpoint_name"] == "vs-main" and index_body["delta_sync_index_spec"]["source_table"] == "c.s.customers"
    assert index_body["primary_key"] == "customer_id"


def test_without_an_online_endpoint_the_index_is_not_created_and_the_match_uses_ai_query():
    rec, lines = Recorder({("GET", "/api/2.0/vector-search/endpoints"): {"endpoints": []}}), []
    out, _ctx, _d = build(rec, "lookalikes", {"vector_search": "available"}, result_table="c.s.t", text_column="n", lines=lines)
    assert out["path"] == "ai_query" and out["records"] == [] and not rec.paths("POST")
    assert any("ai_query" in line for line in lines)


def test_an_agent_build_creates_its_job_in_the_jobs_format_after_the_approval_columns_on_its_result_table():
    rec, statements = Recorder(), []
    out, context, _d = build(rec, "watch_act_agent", {}, result_table="c.s.orders", run_sql=statements.extend)
    assert out["path"] == "agent_job" and {"asset": "job", "job_id": 77} in context["asset_status"]["build_records"]
    job = next(b for m, p, b, _q in rec.calls if p == "/api/2.2/jobs/create")
    assert job["schedule"]["quartz_cron_expression"] == shell_build.DEFAULT_CRON and job["tasks"][0]["notebook_task"]["notebook_path"] == NOTEBOOK
    assert statements[0] == 'CREATE TABLE IF NOT EXISTS "app_schema"."orders" ("approval_status" TEXT, "approval_note" TEXT)'
    assert statements[1].startswith('ALTER TABLE "app_schema"."orders" ADD COLUMN IF NOT EXISTS "approval_status" TEXT')


def test_an_agent_build_without_a_lakebase_connection_says_the_columns_were_not_added():
    lines = []
    build(Recorder(), "watch_act_agent", {}, result_table="c.s.orders", lines=lines)
    assert any("were not added" in line for line in lines)


def test_an_agent_build_with_no_notebook_is_skipped_and_nothing_is_created():
    rec, lines = Recorder(), []
    out, _ctx, _d = build(rec, "watch_act_agent", {}, result_table="c.s.orders", notebook="", lines=lines)
    assert out["records"] == [] and not rec.paths("POST") and any("no notebook" in line for line in lines)


def test_the_ai_query_path_creates_nothing():
    rec = Recorder()
    out, _ctx, _d = build(rec, "lookalikes", {"vector_search": "unavailable"}, result_table="c.s.t")
    assert out["path"] == "ai_query" and out["records"] == [] and rec.calls == []


# --- REQ-354: Uninstall all removes what a build created, and leaves nothing behind -----------------------------------

def test_a_build_with_an_index_a_supervisor_and_a_job_leaves_nothing_behind_on_uninstall():
    rec, domains, records = Recorder(), {}, []
    records += build(rec, "cross_domain_assistant", {"supervisor_agents": "available"}, space="space-a", domains=domains)[1][
        "asset_status"]["build_records"]
    columns = {"entity_name": ["c.s.customers.customer_name"], "case_id": ["c.s.customers.customer_id"]}
    records += build(rec, "lookalikes", {"vector_search": "available"}, result_table="c.s.customers", columns=columns,
                     domains=domains)[1]["asset_status"]["build_records"]
    records += build(rec, "watch_act_agent", {}, result_table="c.s.orders", run_sql=lambda s: None, domains=domains)[1][
        "asset_status"]["build_records"]
    assert {r["asset"] for r in records} == {"supervisor", "supervisor_tool", "vector_index", "job"}

    deleter = Recorder()
    assert shell_build.delete_records(shell_build.BuildApi(deleter), records, lambda e: False, str) == []
    deleted = set(deleter.paths("DELETE")) | set(deleter.paths("POST"))
    assert "/api/2.0/vector-search/indexes/inspire_uc_1" in deleted
    assert "/api/2.1/supervisor-agents/sup-1" in deleted and "/api/2.2/jobs/delete" in deleted


def test_a_missing_asset_is_silent_on_uninstall_and_a_permission_error_is_reported():
    rec = Recorder({("DELETE", "/api/2.0/vector-search/indexes/"): NotFound("does not exist"),
                    ("POST", "/api/2.2/jobs/delete"): RuntimeError(PERMISSION)})
    warnings = shell_build.delete_records(shell_build.BuildApi(rec), [{"asset": "vector_index", "name": "i"}, {"asset": "job", "job_id": 77}],
                                          lambda e: type(e).__name__ == "NotFound", str)
    assert len(warnings) == 1 and "/api/2.2/jobs/delete" in warnings[0] and "PERMISSION_DENIED" in warnings[0]


# --- the notebook's own methods: the run hook and the uninstall call ------------------------------------------------------

@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def Stub(cls, rec):
    """A real DatabricksInspire instance (no constructor) whose workspace calls are the recorder and two stubs."""
    obj = cls.__new__(cls)
    obj.logger = logging.getLogger("req414c")
    obj.lakebase_calls = []
    obj._implement_api = rec
    obj._implement_genie_smoke = lambda space, question: {"content": f"{space} says {question}"}
    obj._implement_lakebase_sql = lambda env, statements: obj.lakebase_calls.append((env, list(statements)))
    return obj


def test_the_run_hook_keeps_a_supervisor_build_on_the_asset_status(ns):
    cls, rec = ns["DatabricksInspire"], Recorder()
    context = {"uc_id": "UC-1", "kind_spec": {"kind": {"id": "cross_domain_assistant", "label": "Cross", "question": "q"}},
               "asset_status": {"genie_space": {"id": "space-a"}}, "result_table": "c.s.sales", "lakebase": {}}
    previous = dict(ns["TECHNICAL_CONTEXT"].get("ai_function_status") or {})
    ns["TECHNICAL_CONTEXT"]["ai_function_status"] = {"supervisor_agents": "available"}
    try:
        cls._implement_build_paths(Stub(cls, rec), context)
    finally:
        ns["TECHNICAL_CONTEXT"]["ai_function_status"] = previous
    assert {"asset": "supervisor", "supervisor_id": "sup-1"} in context["asset_status"]["build_records"]


def test_a_use_case_without_a_kind_runs_no_build(ns):
    cls, rec = ns["DatabricksInspire"], Recorder()
    context = {"uc_id": "UC-2", "kind_spec": None, "asset_status": {}}
    cls._implement_build_paths(Stub(cls, rec), context)
    assert rec.calls == [] and context["asset_status"].get("build_records", []) == []


def test_the_uninstall_method_reads_the_records_and_treats_a_missing_asset_as_silent(ns):
    cls = ns["DatabricksInspire"]
    rec = Recorder({("DELETE", "/api/2.0/vector-search/indexes/"): NotFound("does not exist")})
    asset_status = {"build_records": [{"asset": "vector_index", "name": "inspire_uc_1"}, {"asset": "job", "job_id": 77}]}
    assert cls._implement_delete_build_records(Stub(cls, rec), asset_status) == []
    assert rec.paths() == ["/api/2.0/vector-search/indexes/inspire_uc_1", "/api/2.2/jobs/delete"]


def test_the_orchestrator_step_reaches_the_genie_helper_for_each_domain_space_of_the_run(ns):
    cls = ns["DatabricksInspire"]
    stub = Stub(cls, Recorder())
    asked = []
    stub._implement_genie_smoke = lambda space, question: (asked.append((space, question)) or {"content": f"{space} answered"})
    stub._implement_run_asset_rows = lambda session: [{"genie_space": {"id": "space-a"}}, {"genie_space": {"id": "space-b"}}]
    previous = dict(ns["TECHNICAL_CONTEXT"].get("ai_function_status") or {})
    ns["TECHNICAL_CONTEXT"]["ai_function_status"] = {"supervisor_agents": "unavailable"}
    try:
        context = {"uc_id": "UC-4", "key": (7, "UC-4", 1), "kind_spec": {"kind": {"id": "cross_domain_assistant", "question": "How?"}},
                   "asset_status": {}}
        cls._implement_orchestrator_answers(stub, context)
    finally:
        ns["TECHNICAL_CONTEXT"]["ai_function_status"] = previous
    assert asked == [("space-a", "How?"), ("space-b", "How?")]

def test_without_an_online_endpoint_the_build_result_and_the_asset_status_carry_the_plain_line():
    rec, lines = Recorder({("GET", "/api/2.0/vector-search/endpoints"): {"endpoints": []}}), []
    out, context, _d = build(rec, "lookalikes", {"vector_search": "available"}, result_table="c.s.t", text_column="n", lines=lines)
    assert out["note"] == shell_build.NO_ENDPOINT_LINE
    assert context["asset_status"]["build_note"] == shell_build.NO_ENDPOINT_LINE
    assert not rec.paths("POST"), "no endpoint is created, and no index is posted without one"


def test_a_build_with_no_lakebase_schema_does_not_run_the_approval_ddl():
    statements, lines = [], []
    build(Recorder(), "watch_act_agent", {}, result_table="c.s.orders", run_sql=statements.extend, pg_schema="", lines=lines)
    assert statements == [] and any("were not added" in line for line in lines)


def test_the_approval_ddl_is_idempotent_on_a_table_that_is_missing_and_one_that_exists():
    """The DDL is safe to run first or second: CREATE ... IF NOT EXISTS creates the missing table with the columns, and the ALTER adds
    them to an existing table that lacks them. Run twice, nothing fails."""
    statements = []
    build(Recorder(), "watch_act_agent", {}, result_table="c.s.orders", run_sql=statements.extend)
    build(Recorder(), "watch_act_agent", {}, result_table="c.s.orders", run_sql=statements.extend)
    assert len(statements) == 4 and all("IF NOT EXISTS" in stmt for stmt in statements)


def test_the_orchestrator_answers_are_stored_before_the_app_page_is_written(ns):
    """(b): the cross-domain kind's orchestrator runs before the App page writer, on the run's domain spaces read from the rows."""
    cls = ns["DatabricksInspire"]
    stub = Stub(cls, Recorder())
    stub._implement_run_asset_rows = lambda session: [{"genie_space": {"id": "space-a"}, "domain_label": "Sales"}]
    previous = dict(ns["TECHNICAL_CONTEXT"].get("ai_function_status") or {})
    ns["TECHNICAL_CONTEXT"]["ai_function_status"] = {"supervisor_agents": "unavailable"}
    try:
        context = {"uc_id": "UC-9", "key": (7, "UC-9", 1), "kind_spec": {"kind": {"id": "cross_domain_assistant", "question": "How?"}},
                   "asset_status": {}}
        cls._implement_orchestrator_answers(stub, context)
    finally:
        ns["TECHNICAL_CONTEXT"]["ai_function_status"] = previous
    assert context["asset_status"]["orchestrator_answers"] == {"space-a": {"answer": "space-a says How?", "error": ""}}


def test_the_approval_ddl_targets_the_records_table_the_page_spec_names_not_the_result_table_name():
    """(d): the Lakebase table is the one the App reads records from (the page spec's records table). The result table's name is not used."""
    statements = []
    build(Recorder(), "watch_act_agent", {}, result_table="c.s.orders", records_table="loss_desk_out", run_sql=statements.extend)
    assert statements and all('"app_schema"."loss_desk_out"' in stmt for stmt in statements)
    assert all("orders" not in stmt for stmt in statements)


def test_no_approval_ddl_runs_when_the_page_spec_names_no_records_table():
    statements, lines = [], []
    build(Recorder(), "watch_act_agent", {}, result_table="c.s.orders", records_table="", run_sql=statements.extend, lines=lines)
    assert statements == [] and any("were not added" in line for line in lines)


def test_two_processes_that_share_only_the_tracking_table_see_the_same_supervisor(ns):
    """(a): a use case built in one process creates the run's supervisor; a use case of the same run built in a fresh process attaches
    its space to it, found through the rows of the shared table, not through any in-process state."""
    cls = ns["DatabricksInspire"]
    table, rec = {}, Recorder()

    def process():
        obj = Stub(cls, rec)
        obj._tracking_table_name = "tracking"
        obj._implement_run_asset_rows = lambda session: [row["asset_status"] for row in table.values() if row["session"] == session and "asset_status" in row]
        obj._implement_update = lambda key, **fields: table.setdefault(key[1], {"session": key[0]}).update(fields)
        return obj
    context_a = {"uc_id": "UC-1", "key": (7, "UC-1", 1), "kind_spec": {"kind": {"id": "cross_domain_assistant", "label": "Cross", "question": "q"}},
                 "asset_status": {"genie_space": {"id": "space-a"}}, "result_table": "c.s.a"}
    context_b = {"uc_id": "UC-2", "key": (7, "UC-2", 1), "kind_spec": {"kind": {"id": "lookalikes", "label": "Lookalikes", "question": "q"}},
                 "asset_status": {"genie_space": {"id": "space-b"}}, "result_table": "c.s.b"}
    previous = dict(ns["TECHNICAL_CONTEXT"].get("ai_function_status") or {})
    ns["TECHNICAL_CONTEXT"]["ai_function_status"] = {"supervisor_agents": "available", "vector_search": "unavailable"}
    try:
        process()._implement_build_paths(context_a)
        process()._implement_build_paths(context_b)
    finally:
        ns["TECHNICAL_CONTEXT"]["ai_function_status"] = previous
    tools = [(m, p, q) for m, p, b, q in rec.calls if p.endswith("/tools") and m == "POST"]
    assert [q["tool_id"] for m, p, q in tools] == ["space_space_a", "space_space_b"]
    assert all(p == "/api/2.1/supervisor-agents/sup-1/tools" for m, p, q in tools), "one supervisor, found through the shared rows"
    assert [r["asset"] for r in table["UC-2"]["asset_status"]["build_records"]] == ["supervisor_tool"]


def test_the_page_shape_check_accepts_the_orchestrator_answers_key():
    """(b): the page validator takes the cross-domain answers as a page key; a page with them passes the same shape check as one without."""
    import json
    server = os.path.join(os.path.dirname(__file__), "..", "..", "agent", "app_shell", "server")
    if server not in sys.path:
        sys.path.insert(0, server)
    import shell_sql
    page = json.load(open(os.path.join(os.path.dirname(__file__), "..", "..", "agent", "app_shell", "example_page.json"), encoding="utf-8"))
    base = shell_sql.shape_problems(page)
    with_answers = dict(page, orchestrator_answers=[{"space": "space-a", "answer": "Sales rose."}])
    assert shell_sql.shape_problems(with_answers) == base


class _Row(dict):
    def asDict(self):
        return dict(self)


class _Spark:
    """Records the SQL; answers with one implement row whose asset_status holds a supervisor record."""

    def __init__(self):
        self.sql_text = []

    def sql(self, text, args=None):
        self.sql_text.append((text, args))
        spark = self

        class _Result:
            def collect(self_inner):
                return [_Row(session_id=7, use_case_id="N01-U01", spec_version=1,
                             asset_status='{"records": [{"kind": "supervisor", "id": "sup-1"}]}')]
        return _Result()


def test_the_run_reader_reads_asset_status_from_the_implement_table_not_the_use_case_table(ns):
    """Live W1 rc.2-d (11-19 14:27): every App publish failed with UNRESOLVED_COLUMN asset_status, because the reader
    queried the use-case tracking table, which has no asset_status. The reader must use the implement table, through _implement_select."""
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.spark = _Spark()
    obj.inspire_database = "cat.db"
    obj._tracking_table_name = "cat.db.__inspire_usecases"
    rows = obj._implement_run_asset_rows(7)
    assert rows == [{"records": [{"kind": "supervisor", "id": "sup-1"}]}]
    text, args = obj.spark.sql_text[0]
    assert "__inspire_implement" in text and "__inspire_usecases" not in text
    assert args == {"sid": 7}
