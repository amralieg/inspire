"""REQ-414 part B: the build paths for the AI-native kinds, planned here and run by the agent job.

Three paths: an AI Search index (vector_search) for lookalikes and taxonomy mapping, a Supervisor Agent over the domain Genie spaces
for the cross-domain assistant, and a scheduled agent job for watch-and-act, exception and outreach agents (Lakebase write-back, then
an approval step: nothing is acted on until its row is approved). Every path reads the probe status (TECHNICAL_CONTEXT
["ai_function_status"]) and falls back to ai_query or to the orchestrator job when the function is not available.

This module is pure: it builds request bodies and decides which path runs. The notebook makes the calls, through an `api` object
with a `do(method, path, body=None, query=None)` method (the SDK's api_client), so the tests drive it with a stub.
"""

import re
SUPERVISOR_AGENTS_PATH = "/api/2.1/supervisor-agents"
SUPERVISOR_TOOL_PATH = "/api/2.1/supervisor-agents/{supervisor_id}/tools"
SUPERVISOR_AGENT_PATH = "/api/2.1/supervisor-agents/{supervisor_id}"
SUPERVISOR_TOOL_ITEM_PATH = "/api/2.1/supervisor-agents/{supervisor_id}/tools/{tool_id}"
VECTOR_INDEXES_PATH = "/api/2.0/vector-search/indexes"
VECTOR_ENDPOINTS_PATH = "/api/2.0/vector-search/endpoints"
NO_ENDPOINT_LINE = ("No vector search endpoint is ready, so this use case matches with ai_query. "
                  "A workspace admin can create one to switch to AI Search.")
DEFAULT_CRON = "0 0 7 * * ?"
DEFAULT_TIMEZONE = "UTC"
JOBS_CREATE_PATH = "/api/2.2/jobs/create"
JOBS_DELETE_PATH = "/api/2.2/jobs/delete"
PROBE_STATUSES = ("available", "unavailable", "unknown")

# kind id -> the build path that serves it
BUILD_PATH_FOR_KIND = {
    "lookalikes": "vector_index",
    "taxonomy_mapping": "vector_index",
    "cross_domain_assistant": "supervisor",
    "watch_act_agent": "agent_job",
    "exception_workflow_agent": "agent_job",
    "outreach_agent": "agent_job",
}

# Approval columns the agent job writes beside its rows. They are not action statuses, so the shell's status set is unchanged.
APPROVAL_COLUMN = "approval_status"
APPROVAL_NOTE_COLUMN = "approval_note"
PENDING = "awaiting approval"
APPROVED = "approved"
REJECTED = "rejected"


def classify_supervisor_probe(status, text="") -> str:
    """The cheap list call: 200 = available; 404 = unavailable; 403 that says the feature is not enabled = unavailable; anything
    else (a 5xx, a timeout, a permission problem that is not 'not enabled') = unknown, which is never cached."""
    low = str(text or "").lower()
    if status == 200:
        return "available"
    if status == 404:
        return "unavailable"
    if status == 403 and ("not enabled" in low or "preview" in low):
        return "unavailable"
    return "unknown"


def probe_supervisor(api) -> str:
    """One GET on the supervisor list path. `api.do` raises on a non-2xx answer; its status code and message are read here."""
    try:
        api.do("GET", SUPERVISOR_AGENTS_PATH)
        return classify_supervisor_probe(200)
    except Exception as exc:
        status = getattr(exc, "status_code", None)
        if status is None:
            status = getattr(getattr(exc, "response", None), "status_code", None)
        return classify_supervisor_probe(status, str(exc))


def choose_path(kind_id: str, supervisor_status: str, index_status: str = "unknown") -> str:
    """The build path for a kind, and whether it uses the function or the fallback.

    The supervisor is used only when the probe says it is available; otherwise the orchestrator job runs over the same Genie spaces.
    A vector index is built only when vector_search is available; otherwise lookalikes and taxonomy use ai_query."""
    path = BUILD_PATH_FOR_KIND.get(kind_id)
    if path is None:
        return "none"
    if path == "supervisor":
        return "supervisor" if supervisor_status == "available" else "orchestrator_job"
    if path == "vector_index":
        return "vector_index" if index_status == "available" else "ai_query"
    return "agent_job"


def run_state(asset_rows) -> dict:
    """The run's state, read from the persisted asset status of every use case of the run: the domain spaces built so far (space ->
    description) and the run's supervisor id, if a use case of the run created one. Two processes that read the same rows agree."""
    domains, supervisor_id = {}, None
    for asset in asset_rows or []:
        asset = asset or {}
        space = str((asset.get("genie_space") or {}).get("id") or "")
        if space:
            domains.setdefault(space, str(asset.get("domain_label") or space))
        for record in asset.get("build_records") or []:
            if record.get("asset") == "supervisor" and supervisor_id is None:
                supervisor_id = record.get("supervisor_id")
    return {"domains": domains, "supervisor_id": supervisor_id}


def tool_id_for(space: str) -> str:
    """A stable tool id per Genie space, so attaching the same space twice is the same tool, never a second one."""
    return "space_" + re.sub(r"[^a-z0-9_]+", "_", str(space or "").lower()).strip("_")[:60]


def supervisor_spec(name: str, domains) -> dict:
    """Request bodies for a Supervisor Agent over the domain Genie spaces. `domains` is a list of (space id, description); a plain
    space id is accepted with the space's own id as its description. One genie_space tool per space, with its description."""
    rows = []
    for item in domains or []:
        space, description = (item if isinstance(item, (tuple, list)) else (item, item))
        space = str(space or "").strip()
        if space and space not in [r[0] for r in rows]:
            rows.append((space, str(description or space).strip() or space))
    if not rows:
        raise ValueError("a supervisor needs at least one Genie space to route to")
    tools = [{"tool_id": tool_id_for(space), "description": desc,
              "body": {"tool_type": "genie_space", "genie_space": {"id": space}, "description": desc}}
             for space, desc in rows]
    return {"agent": {"name": str(name)}, "tools": tools}


class SupervisorIdMissing(ValueError):
    """The supervisor create answer carries no id under a field we read. Nothing is attached to it; the caller logs the keys."""


def parse_supervisor_id(created) -> str:
    """The id of a created supervisor: its `id` field, else the last segment of its `name` (supervisor-agents/{id}). Otherwise raises
    SupervisorIdMissing with the answer's keys, so the run can log them and stop."""
    if isinstance(created, dict):
        for key in ("id", "supervisor_agent_id"):
            value = str(created.get(key) or "").strip()
            if value:
                return value
        name = str(created.get("name") or "").strip()
        if name.startswith("supervisor-agents/") and name.split("/", 1)[1].strip():
            return name.split("/", 1)[1].strip()
        raise SupervisorIdMissing(f"no id in the supervisor answer; its keys are {sorted(created)}")
    raise SupervisorIdMissing(f"the supervisor answer is a {type(created).__name__}, not an object")


def create_supervisor(api, name: str, domains) -> dict:
    """POST the supervisor, then one tool per domain Genie space. Returns the supervisor id and the records of what was created."""
    spec = supervisor_spec(name, domains)
    supervisor_id = parse_supervisor_id(api.do("POST", SUPERVISOR_AGENTS_PATH, body=spec["agent"]))
    records = [{"asset": "supervisor", "supervisor_id": supervisor_id}]
    for tool in spec["tools"]:
        api.do("POST", SUPERVISOR_TOOL_PATH.format(supervisor_id=supervisor_id), body=tool["body"], query={"tool_id": tool["tool_id"]})
        records.append({"asset": "supervisor_tool", "supervisor_id": supervisor_id, "tool_id": tool["tool_id"]})
    return {"supervisor_id": supervisor_id, "tools": [t["tool_id"] for t in spec["tools"]], "records": records}


def attach_domain(api, supervisor_id: str, space: str, description: str) -> list:
    """Idempotent upsert of one domain space as a tool of the run's supervisor: a tool already listed is not posted again."""
    listed = api.do("GET", SUPERVISOR_TOOL_PATH.format(supervisor_id=supervisor_id)) or {}
    present = {str((t or {}).get("tool_id") or (t or {}).get("name", "").rsplit("/", 1)[-1]) for t in listed.get("tools") or []}
    tool_id = tool_id_for(space)
    if tool_id in present:
        return []
    body = {"tool_type": "genie_space", "genie_space": {"id": space}, "description": description or space}
    api.do("POST", SUPERVISOR_TOOL_PATH.format(supervisor_id=supervisor_id), body=body, query={"tool_id": tool_id})
    return [{"asset": "supervisor_tool", "supervisor_id": supervisor_id, "tool_id": tool_id}]


def build_index(api, spec: dict) -> dict:
    """Create the AI Search index. The record names it so the uninstall can delete it."""
    api.do("POST", VECTOR_INDEXES_PATH, body=spec)
    return {"asset": "vector_index", "name": spec["name"]}


def build_agent_job(api, spec: dict) -> dict:
    """Create the scheduled agent job from its Jobs 2.2 spec. The record holds the job id the service returns."""
    created = api.do("POST", JOBS_CREATE_PATH, body=spec)
    job_id = (created or {}).get("job_id")
    if job_id is None:
        raise ValueError(f"the job create answer has no job_id; its keys are {sorted(created or {})}")
    return {"asset": "job", "job_id": int(job_id)}


def uninstall_requests(records) -> list:
    """The delete calls that remove what a build created, in reverse order: tools, then the supervisor, then the index, then the job."""
    order = {"supervisor_tool": 0, "supervisor": 1, "vector_index": 2, "job": 3}
    out = []
    for record in sorted(records or [], key=lambda r: order.get(r.get("asset"), 9)):
        asset = record.get("asset")
        if asset == "supervisor_tool":
            out.append(("DELETE", SUPERVISOR_TOOL_ITEM_PATH.format(supervisor_id=record["supervisor_id"], tool_id=record["tool_id"]), None))
        elif asset == "supervisor":
            out.append(("DELETE", SUPERVISOR_AGENT_PATH.format(supervisor_id=record["supervisor_id"]), None))
        elif asset == "vector_index":
            out.append(("DELETE", f"{VECTOR_INDEXES_PATH}/{record['name']}", None))
        elif asset == "job":
            out.append(("POST", JOBS_DELETE_PATH, {"job_id": int(record["job_id"])}))
        else:
            raise ValueError(f"no uninstall call for asset {asset!r}")
    return out


def orchestrator_job_spec(name: str, genie_space_ids, cron: str = "") -> dict:
    """The fallback when no supervisor is available: one question task per domain Genie space, then a summary task over their answers."""
    spaces = [str(s).strip() for s in genie_space_ids if str(s or "").strip()]
    if not spaces:
        raise ValueError("the orchestrator job needs at least one Genie space")
    tasks = [{"task_key": f"ask_{i}", "genie_space_id": space} for i, space in enumerate(spaces, start=1)]
    tasks.append({"task_key": "summary", "depends_on": [t["task_key"] for t in tasks]})
    return {"name": str(name), "schedule": str(cron or ""), "tasks": tasks}


def orchestrate(ask, genie_space_ids, question: str, redact_error=str) -> dict:
    """Run the orchestrator's question against each domain Genie space and collect the answers. `ask(space_id, question)` is the
    notebook's existing Genie conversation helper, passed in so this module makes no Genie call of its own. A space that fails keeps
    its error next to its answer; nothing is dropped silently. `redact_error` is the notebook's one redaction (REQ-169 rule: no error
    becomes text any other way)."""
    spaces = [str(s).strip() for s in genie_space_ids if str(s or "").strip()]
    if not spaces:
        raise ValueError("the orchestrator needs at least one Genie space")
    if not str(question or "").strip():
        raise ValueError("the orchestrator needs a question to ask each space")
    answers = {}
    for space in spaces:
        try:
            answers[space] = {"answer": str(ask(space, question)), "error": ""}
        except Exception as exc:
            answers[space] = {"answer": "", "error": redact_error(exc)[:300]}
    return {"answers": answers, "failed": sorted(s for s, a in answers.items() if a["error"])}


def index_spec(name: str, endpoint: str, source_table: str, primary_key: str, text_column: str) -> dict:
    """A Delta Sync AI Search index over a source table, embedding one text column."""
    for field, value in (("name", name), ("endpoint", endpoint), ("source_table", source_table), ("primary_key", primary_key),
                         ("text_column", text_column)):
        if not str(value or "").strip():
            raise ValueError(f"an AI Search index needs its {field}")
    return {
        "name": str(name), "endpoint_name": str(endpoint), "primary_key": str(primary_key),
        "index_type": "DELTA_SYNC",
        "delta_sync_index_spec": {"source_table": str(source_table), "pipeline_type": "TRIGGERED",
                                  "embedding_source_columns": [{"name": str(text_column)}]},
    }


def agent_job_spec(name: str, cron: str, detect_sql: str, lakebase_table: str, notebook_path: str, timezone: str = DEFAULT_TIMEZONE) -> dict:
    """The scheduled agent job in the Jobs 2.2 create format (the launcher's shape): notebook tasks with task_key, a quartz cron
    schedule with its timezone (created paused, so nothing runs before a person resumes it), and tags. The tasks run detect, then
    write-back of the flagged rows as awaiting approval, then act, which reads only approved rows (the task parameters name the step)."""
    if not str(detect_sql or "").strip() or not str(lakebase_table or "").strip() or not str(notebook_path or "").strip():
        raise ValueError("the agent job needs its detect query, its Lakebase table and the notebook it runs")
    if not str(cron or "").strip():
        cron = DEFAULT_CRON
    def task(key, step, depends=()):
        out = {"task_key": key, "notebook_task": {"notebook_path": str(notebook_path),
                                                  "base_parameters": {"step": step, "sql": detect_sql, "table": str(lakebase_table),
                                                                      "approval_column": APPROVAL_COLUMN, "approved_value": APPROVED}}}
        if depends:
            out["depends_on"] = [{"task_key": d} for d in depends]
        return out
    return {"name": str(name), "tags": {"inspire": "agent_job"},
            "tasks": [task("detect", "detect"), task("write_back", "write_back", ("detect",)), task("act", "act", ("write_back",))],
            "schedule": {"quartz_cron_expression": str(cron), "timezone_id": str(timezone or DEFAULT_TIMEZONE), "pause_status": "PAUSED"}}


def rows_ready_to_act(rows) -> list:
    """Only rows an approver has approved. Pending and rejected rows are never acted on."""
    return [row for row in rows or [] if str(row.get(APPROVAL_COLUMN) or "").strip() == APPROVED]


def postgres_table(schema: str, result_table: str, quote) -> str:
    """The Lakebase (Postgres) name of a use case's result table: each part quoted, schema.table. The Unity Catalog name's catalog
    is not used; the table keeps its own name in the App's Lakebase schema."""
    table = str(result_table or "").split(".")[-1].strip()
    if not str(schema or "").strip() or not table:
        raise ValueError("the approval columns need the Lakebase schema and the result table name")
    return f"{quote(str(schema).strip())}.{quote(table)}"


def approval_ddl(schema: str, result_table: str, quote) -> list:
    """Idempotent DDL for the approval columns on the result table's Lakebase copy. CREATE TABLE IF NOT EXISTS creates the table with
    the approval columns when it is missing; ADD COLUMN IF NOT EXISTS adds them when it exists without them. Either way no statement
    fails on a missing or already-complete table, and the table name is quoted part by part."""
    target = postgres_table(schema, result_table, quote)
    status, note = quote(APPROVAL_COLUMN), quote(APPROVAL_NOTE_COLUMN)
    return [f"CREATE TABLE IF NOT EXISTS {target} ({status} TEXT, {note} TEXT)",
            f"ALTER TABLE {target} ADD COLUMN IF NOT EXISTS {status} TEXT, ADD COLUMN IF NOT EXISTS {note} TEXT"]


def run_build_paths(api, plan: dict, ask, log) -> dict:
    """Execute one kind's build path from its plan. The result lists every asset created (records) so the uninstall can remove each one.
    A supervisor whose id cannot be read stops here with its keys logged."""
    path = plan.get("path")
    domains = plan.get("domains") or []
    log(f"[BUILD-PATH FIRED] {plan.get('kind', '?')}: path={path}")
    if path == "supervisor":
        try:
            created = create_supervisor(api, plan["name"], domains)
        except SupervisorIdMissing as exc:
            log(f"[BUILD-PATH FIRED] supervisor stopped, nothing attached: {exc}")
            raise
        return {"path": path, "records": created["records"], "result": created}
    if path == "orchestrator_job":
        return {"path": path, "records": [], "result": orchestrate(ask, [d for d, _desc in domains], plan["question"])}
    if path == "vector_index":
        return {"path": path, "records": [build_index(api, plan["index_spec"])], "result": None}
    if path == "agent_job":
        return {"path": path, "records": [build_agent_job(api, plan["job_spec"])], "result": None}
    if path == "ai_query":
        return {"path": path, "records": [], "result": None}
    raise ValueError(f"no build path {path!r}")


def plan_for(path: str, kind: str, name: str, inputs: dict) -> tuple:
    """(plan, skip reason) for one build path. `inputs` carries what the path needs; a path without it is skipped with the reason named."""
    space_rows = inputs.get("domains") or []
    plan = {"path": path, "kind": kind, "name": name, "domains": space_rows, "question": inputs.get("question") or ""}
    if path == "supervisor" and not space_rows:
        return None, "the supervisor path is skipped: no domain Genie space was built in this run"
    if path == "orchestrator_job" and not space_rows:
        return None, "the orchestrator path is skipped: no domain Genie space was built in this run"
    if path == "vector_index":
        missing = [k for k in ("text_column", "source_table", "primary_key", "endpoint") if not str(inputs.get(k) or "").strip()]
        if missing:
            return None, f"the AI Search index is skipped, falling back to ai_query: no {', '.join(missing)} for this build"
        plan["index_spec"] = index_spec(name, inputs["endpoint"], inputs["source_table"], inputs["primary_key"], inputs["text_column"])
    if path == "agent_job":
        table = str(inputs.get("result_table") or "")
        if not table:
            return None, "the agent job is skipped: this build has no result table to write approvals to"
        if not str(inputs.get("notebook_path") or "").strip():
            return None, "the agent job is skipped: this build names no notebook for the job to run"
        plan["lakebase_table"] = table
        plan["job_spec"] = agent_job_spec(name, inputs.get("cron") or "", f"SELECT * FROM {table}", table, inputs["notebook_path"])
    return plan, ""


def index_inputs(kind_columns: dict, result_table: str) -> dict:
    """The index's inputs from the kind's detected roles: the text column is an entity name, else a free-text column, else a label; the
    source table is that column's table; the primary key is the table's id column. Anything missing stays empty and the path falls back."""
    for role in ("entity_name", "free_text", "label_column"):
        cols = [c for c in (kind_columns or {}).get(role) or [] if "." in str(c)]
        if cols:
            table, column = cols[0].rsplit(".", 1)
            ids = [c.rsplit(".", 1)[1] for c in (kind_columns or {}).get("case_id") or [] if c.rsplit(".", 1)[0] == table]
            ids = ids or [c.rsplit(".", 1)[1] for c in cols if c.rsplit(".", 1)[0] == table and c.rsplit(".", 1)[1].endswith("_id")]
            return {"text_column": column, "source_table": table, "primary_key": ids[0] if ids else ""}
    return {"text_column": "", "source_table": "", "primary_key": ""}


def pick_endpoint(listed) -> str:
    """The name of a vector search endpoint that is ONLINE, read from the endpoint list answer; "" when none is ready."""
    for endpoint in (listed or {}).get("endpoints") or []:
        state = str(((endpoint or {}).get("endpoint_status") or {}).get("state") or "").upper()
        if state == "ONLINE" and str((endpoint or {}).get("name") or "").strip():
            return str(endpoint["name"]).strip()
    return ""


def delete_records(api, records, is_not_found, redact_error) -> list:
    """REQ-354: deletes what a build path created. A missing asset is silent (as for the job deletes); any other failure is reported
    with its message, so the person can remove it by hand. Returns the warnings."""
    try:
        calls = uninstall_requests(records or [])
    except ValueError as error:
        return [f"Inspire could not list the build assets to delete: {redact_error(error)}"]
    failed = []
    for method, path, body in calls:
        try:
            api.do(method, path, body=body)
        except Exception as error:
            failed.append((method, path, error))
    return [f"{method} {path} could not be deleted: {redact_error(error)}" for method, path, error in failed if not is_not_found(error)]


class BuildApi:
    """The REST client the build paths call: `call(method, path, body, query)` is the App build's retried API helper."""

    def __init__(self, call):
        self.call = call

    def do(self, method, path, body=None, query=None):
        return self.call(method, path, body, query)


def build_for_context(api, context: dict, status: dict, ask, log, quote, run_sql, run: dict, pg_schema: str = "") -> dict:
    """One use case's build, from the App build's context. `run` is the run's state: {"domains": {space: description}, "records": [the
    persisted build records of every use case of the run so far]}. The supervisor is found through those records, so every domain space
    of the run is attached as one tool (an idempotent upsert), whichever use case builds it. The rest of the path comes from the probe
    status; the index takes its inputs from the kind's detected roles and an ONLINE endpoint, else ai_query with the plain line."""
    kind = (context.get("kind_spec") or {}).get("kind") or {}
    uc_id = str(context.get("uc_id") or "")
    asset = context.setdefault("asset_status", {})
    records = []
    space = str((asset.get("genie_space") or {}).get("id") or "")
    if space:
        label = f"{kind.get('label') or 'domain'} ({uc_id})"
        asset["domain_label"] = label
        run["domains"].setdefault(space, label)
    supervisor_id = run.get("supervisor_id")
    if space and supervisor_id:
        records += attach_domain(api, supervisor_id, space, run["domains"][space])
    path = choose_path(kind.get("id") or "", status.get("supervisor_agents"), status.get("vector_search"))
    if path == "supervisor" and supervisor_id is None and run["domains"]:
        out = run_build_paths(api, {"path": "supervisor", "kind": kind.get("id") or "", "name": "inspire_" + re.sub(r"[^a-z0-9_]+", "_", uc_id.lower()).strip("_"),
                                    "domains": sorted(run["domains"].items())}, ask, log)
        records += out["records"]
    elif path in ("vector_index", "agent_job"):
        inputs = {"domains": sorted(run["domains"].items()), "question": kind.get("question") or "", "result_table": context.get("result_table") or "",
                  "notebook_path": context.get("notebook_path") or ""}
        if path == "vector_index":
            inputs.update(index_inputs((context.get("kind_spec") or {}).get("columns") or {}, context.get("result_table") or ""))
            try:
                inputs["endpoint"] = pick_endpoint(api.do("GET", VECTOR_ENDPOINTS_PATH))
            except Exception:
                inputs["endpoint"] = ""
            if not inputs["endpoint"]:
                log(f"[BUILD-PATH FIRED] {uc_id}: {NO_ENDPOINT_LINE}")
                asset["build_note"] = NO_ENDPOINT_LINE
                path = "ai_query"
        if path != "ai_query":
            name = "inspire_" + re.sub(r"[^a-z0-9_]+", "_", uc_id.lower()).strip("_")
            plan, skipped = plan_for(path, kind.get("id") or "", name, inputs)
            if plan is None:
                log(f"[BUILD-PATH FIRED] {uc_id}: {skipped}")
            else:
                records += run_build_paths(api, plan, ask, log)["records"]
                if path == "agent_job":
                    records_table = str(context.get("records_table") or "").strip()
                    if not records_table or run_sql is None or not str(pg_schema or "").strip():
                        log(f"[BUILD-PATH FIRED] {uc_id}: the approval columns were not added: this build has no Lakebase connection or records table")
                    else:
                        run_sql(approval_ddl(pg_schema, records_table, quote))
    asset["build_records"] = list(records)
    return {"path": path, "records": records, "note": asset.get("build_note", "")}


def fallback_sentence(path: str) -> str:
    """Generated-code instruction for a build path that did not run its function."""
    if path == "orchestrator_job":
        return "The supervisor is not available in this workspace, so the orchestrator job asks each domain Genie space and summarises the answers."
    if path == "ai_query":
        return "The AI Search index is not available in this workspace, so the match uses ai_query over the text columns."
    return ""


# REQ-415: each Beta or preview function gets one minimal call from its documentation page. A DESCRIBE pre-check skips the call when the
# function does not exist. The call's result decides the status: it returned = available; a not-found, not-enabled or region answer =
# unavailable; a timeout or any other error = unknown, and unknown is never cached. Calls the page describes as model-backed cost one
# tiny request each; the rest are compute only. The one status record is TECHNICAL_CONTEXT["ai_function_status"].
AI_FUNCTION_PROBE_TIMEOUT_S = 30
AI_BETA_FUNCTIONS = ("ai_top_drivers", "ai_decide", "ai_predict_class", "ai_predict_value", "ai_detect_anomalies", "ai_enrich",
                     "ai_similarity", "ai_forecast", "vector_search")
# name -> (minimal call, True when the page says the function calls a model). ai_decide's call is built from its required arguments.
# No real index exists under this name: the expected answer is "index not found", which proves vector_search resolved and ran.
AI_PROBE_INDEX = "__inspire_probe_index__"
AI_FUNCTION_PROBE_CALLS = {
    "ai_similarity": ("SELECT ai_similarity('a', 'a')", True),
    "ai_decide": ("SELECT ai_decide('x', '{\"o\": {\"type\": \"noul\", \"instructions\": \"Is this an outage?\"}}')", True),
    "ai_enrich": ("SELECT ai_enrich('a', '[\"industry\"]')", True),
    "ai_top_drivers": ("SELECT * FROM ai_top_drivers(input => TABLE(SELECT 1.0 AS m, true AS t), metric => 'm', is_test => 't')", False),
    "ai_predict_class": ("SELECT * FROM ai_predict_class(input => TABLE(SELECT 1.0 AS x, 'a' AS y), target_col => 'y', feature_cols => ARRAY('x'))", False),
    "ai_predict_value": ("SELECT * FROM ai_predict_value(input => TABLE(SELECT 1.0 AS x, 1.0 AS y), target_col => 'y', feature_cols => ARRAY('x'))", False),
    "ai_detect_anomalies": ("SELECT * FROM ai_detect_anomalies(TABLE(SELECT DATE'2024-01-01' AS ds, 1.0 AS v), time_col => 'ds', value_col => 'v')", False),
    "ai_forecast": ("SELECT * FROM AI_FORECAST(TABLE(SELECT DATE'2024-01-01' AS ds, 1.0 AS v), horizon => '2024-01-02', time_col => 'ds', value_col => 'v')", False),
    "vector_search": (f"SELECT * FROM vector_search(index => '{AI_PROBE_INDEX}', query_text => 'a', num_results => 1)", False),
}
AI_FUNCTION_PROBE_CACHE = {}
_AI_FUNCTION_UNAVAILABLE_MARKERS = ("routine_not_found", "unresolved_routine", "cannot resolve routine", "not enabled",
                                    "not available on", "only available in some regions", "not available in this region")
# REQ-415 rule: a routine that resolved and ran far enough to reject our arguments or data is available.
_AI_FUNCTION_RAN_MARKERS = ("ai_predict_invalid_parameter", "ai_predict_insufficient_training_data", "index not found",
                            "insufficient history", "not enough history")


def classify_ai_function_result(error=None) -> str:
    """available when the call returned, or failed with an error only a running function raises; unavailable for a not-found,
    not-enabled or region answer; unknown for anything else, including a timeout."""
    if error is None:
        return "available"
    low = str(error).lower()
    if any(marker in low for marker in _AI_FUNCTION_UNAVAILABLE_MARKERS):
        return "unavailable"
    if any(marker in low for marker in _AI_FUNCTION_RAN_MARKERS) or ("index" in low and "not found" in low):
        return "available"
    return "unknown"


def describe_says_missing(spark_session, name) -> bool:
    """True when DESCRIBE FUNCTION shows the function does not exist, so its call is skipped."""
    try:
        spark_session.sql(f"DESCRIBE FUNCTION {name}").collect()
        return False
    except Exception as exc:
        return classify_ai_function_result(exc) == "unavailable"


def _workspace_api_client():
    """REQ-414 part B: the SDK's REST client for the Supervisor Agents list call; None when the SDK or its credentials are missing."""
    try:
        from databricks.sdk import WorkspaceClient
        return WorkspaceClient().api_client
    except Exception:
        return None


def probe_ai_functions(spark_session, logger, workspace_key: str = "default", api=None, run_work=None, record=None) -> dict:
    """Status per function for one workspace: available, unavailable or unknown. Available and unavailable are cached per workspace."""
    record = {} if record is None else record
    results, calls, model_calls = {}, 0, 0
    for name in AI_BETA_FUNCTIONS:
        key = (workspace_key, name)
        if key in AI_FUNCTION_PROBE_CACHE:
            status = AI_FUNCTION_PROBE_CACHE[key]
        elif spark_session is None:
            status = "unknown"
        elif describe_says_missing(spark_session, name):
            status = "unavailable"
        else:
            sql, model_backed = AI_FUNCTION_PROBE_CALLS[name]
            calls += 1
            model_calls += 1 if model_backed else 0
            try:
                run_work(spark_session, lambda: spark_session.sql(sql).collect(),
                                       timeout_seconds=AI_FUNCTION_PROBE_TIMEOUT_S, tag_prefix="inspire_probe",
                                       label=f"function probe {name}", logger=logger)
                status = classify_ai_function_result(None)
            except Exception as exc:
                status = classify_ai_function_result(exc)
        if status != "unknown":
            AI_FUNCTION_PROBE_CACHE[key] = status
        results[name] = status
        record[name] = status
    # REQ-414 part B: the Supervisor Agents list call (a GET, no tokens). Unknown is not cached.
    sup_key = (workspace_key, "supervisor_agents")
    if sup_key in AI_FUNCTION_PROBE_CACHE:
        sup = AI_FUNCTION_PROBE_CACHE[sup_key]
    elif api is None:
        sup = "unknown"
    else:
        sup = probe_supervisor(api)
        if sup != "unknown":
            AI_FUNCTION_PROBE_CACHE[sup_key] = sup
    results["supervisor_agents"] = sup
    record["supervisor_agents"] = sup
    available = [n for n in AI_BETA_FUNCTIONS if results[n] == "available"]
    fallback = [n for n in AI_BETA_FUNCTIONS if results[n] != "available"]
    logger.info(f"[AI-FUNCTION-PROBE FIRED] workspace={workspace_key} supervisor_agents={sup} calls={calls} (model-backed, one tiny request each: {model_calls}; "
                f"the rest are compute only, no token cost); available: {', '.join(available) or 'none'}; "
                f"ai_query fallback: {', '.join(fallback) or 'none'}")
    return results
