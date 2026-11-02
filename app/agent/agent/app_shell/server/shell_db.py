import datetime
import json
import random
import re
import time
import urllib.parse

NUMBER_TYPES = ("BYTE", "SHORT", "INT", "LONG", "FLOAT", "DOUBLE", "DECIMAL")
WHOLE_TYPES = ("BYTE", "SHORT", "INT", "LONG")
BROWSER_SAFE_WHOLE = 2 ** 53 - 1
NESTED_TYPES = ("ARRAY", "MAP", "STRUCT")
TERMINAL = ("SUCCEEDED", "FAILED", "CANCELED", "CLOSED")
QUERY_DEADLINE_S = 240
GENIE_DONE = ("COMPLETED",)
GENIE_FAILED = ("FAILED", "CANCELLED", "QUERY_RESULT_EXPIRED")
GENIE_STEPS = {"SUBMITTED": "Reading your question", "FILTERING_CONTEXT": "Finding the tables that answer it",
               "FETCHING_METADATA": "Finding the tables that answer it", "ASKING_AI": "Writing the SQL",
               "PENDING_WAREHOUSE": "Waiting for the SQL warehouse", "EXECUTING_QUERY": "Running the query"}
JOB_RUNS_PAGE = 25
TABLE_HISTORY_ROWS = 20
CONCURRENT = re.compile(r"DELTA_CONCURRENT_\w+|DELTA_(METADATA|PROTOCOL)_CHANGED|CONCURRENT_(APPEND|DELETE|TRANSACTION|WRITE)|"
                        r"Concurrent\w*Exception|(Metadata|Protocol)ChangedException", re.I)
CONFLICT_ATTEMPTS = 6
CONFLICT_BASE_DELAY_S = 0.1


class QueryError(RuntimeError):
    pass


def stamp_of(value):
    try:
        stamp = datetime.datetime.fromisoformat(str(value or "").strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return stamp.astimezone(datetime.timezone.utc) if stamp.tzinfo else stamp.replace(tzinfo=datetime.timezone.utc)


class HttpError(Exception):
    def __init__(self, status: int, message: str, extra=None, code: str = ""):
        super().__init__(message)
        self.status, self.message, self.extra, self.code = status, message, dict(extra or {}), code


def error_body(message: str, code: str = "", extra=None) -> dict:
    return dict(extra or {}, error=message, **({"code": code} if code else {}))


def normalize_host(host: str) -> str:
    text = str(host or "").strip().rstrip("/")
    if text and not text.startswith(("https://", "http://")):
        text = f"https://{text}"
    return text


def browser_whole(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value if -BROWSER_SAFE_WHOLE <= value <= BROWSER_SAFE_WHOLE else str(value)
    if isinstance(value, list):
        return [browser_whole(item) for item in value]
    if isinstance(value, dict):
        return {key: browser_whole(item) for key, item in value.items()}
    return value


def _whole_text(text: str):
    digits = text[1:] if text[:1] in ("+", "-") else text
    return int(text) if digits.isascii() and digits.isdigit() else None


def cell_value(value, kind: str):
    if value is None:
        return None
    kind = str(kind or "").upper()
    if kind in NUMBER_TYPES:
        whole = _whole_text(str(value).strip())
        if whole is not None and (kind in WHOLE_TYPES or abs(whole) > BROWSER_SAFE_WHOLE):
            return browser_whole(whole)
        try:
            number = float(value)
        except (TypeError, ValueError):
            return value
        return int(number) if kind in WHOLE_TYPES else number
    if kind == "BOOLEAN":
        return str(value).lower() == "true"
    if kind in NESTED_TYPES:
        try:
            return json.loads(value, parse_int=lambda text: browser_whole(int(text)))
        except (TypeError, ValueError):
            return value
    return value


def rows_of(manifest: dict, chunks: list, limit: int) -> dict:
    columns = [{"name": c.get("name"), "type": str(c.get("type_name") or "STRING").upper(),
                "type_text": str(c.get("type_text") or c.get("type_name") or "STRING").upper()}
               for c in ((manifest or {}).get("schema") or {}).get("columns") or []]
    rows = []
    for chunk in chunks:
        for raw in chunk or []:
            if len(rows) >= limit:
                break
            rows.append({c["name"]: cell_value(v, c["type"]) for c, v in zip(columns, raw)})
    total = (manifest or {}).get("total_row_count")
    truncated = bool((manifest or {}).get("truncated")) or (total is not None and int(total) > len(rows))
    return {"columns": columns, "rows": rows, "truncated": truncated}


class Workspace:
    def __init__(self, host: str, auth_headers, session=None, sleep=time.sleep, clock=time.time):
        self.host = normalize_host(host)
        self.auth_headers = auth_headers
        self.sleep, self.clock = sleep, clock
        if session is None:
            import requests
            session = requests.Session()
        self.session = session

    def call(self, method: str, path: str, body=None, params=None, timeout: int = 60) -> dict:
        headers = dict(self.auth_headers())
        headers["Content-Type"] = "application/json"
        try:
            response = self.session.request(method, f"{self.host}{path}", headers=headers, params=params,
                                            data=None if body is None else json.dumps(body), timeout=timeout)
        except OSError as error:
            raise QueryError(f"{method} {path.split('?')[0]} did not answer: {error}") from error
        if response.status_code >= 400:
            try:
                detail = response.json()
                message = detail.get("message") or detail.get("error") or json.dumps(detail)[:400]
            except ValueError:
                message = response.text[:400]
            raise QueryError(f"{method} {path.split('?')[0]} answered HTTP {response.status_code}: {message}")
        if not response.content:
            return {}
        try:
            return response.json()
        except ValueError as error:
            raise QueryError(f"{method} {path.split('?')[0]} answered with something other than JSON") from error

    def run_sql(self, warehouse_id: str, statement: str, parameters=None, limit: int = 5000,
                deadline_s: int = QUERY_DEADLINE_S) -> dict:
        started = self.clock()
        for attempt in range(1, CONFLICT_ATTEMPTS + 1):
            try:
                return self._run_once(warehouse_id, statement, parameters, limit, deadline_s, started)
            except QueryError as error:
                if attempt >= CONFLICT_ATTEMPTS or not CONCURRENT.search(str(error)) or self.clock() - started > deadline_s:
                    raise
                self.sleep(CONFLICT_BASE_DELAY_S * attempt + random.random() * CONFLICT_BASE_DELAY_S)

    def _run_once(self, warehouse_id: str, statement: str, parameters, limit: int, deadline_s: int, started: float) -> dict:
        response = self.call("POST", "/api/2.0/sql/statements", {
            "statement": statement, "warehouse_id": warehouse_id, "parameters": parameters or [], "wait_timeout": "30s",
            "on_wait_timeout": "CONTINUE", "disposition": "INLINE", "format": "JSON_ARRAY", "row_limit": limit + 1})
        statement_id = response.get("statement_id")
        while str((response.get("status") or {}).get("state")) not in TERMINAL:
            if self.clock() - started > deadline_s:
                self.call("POST", f"/api/2.0/sql/statements/{statement_id}/cancel")
                raise QueryError(f"the query ran longer than {deadline_s} seconds and was stopped")
            self.sleep(1.5)
            response = self.call("GET", f"/api/2.0/sql/statements/{statement_id}")
        status = response.get("status") or {}
        if status.get("state") != "SUCCEEDED":
            error = status.get("error") or {}
            raise QueryError(error.get("message") or f"the query ended {status.get('state')}")
        return self._collect(response, limit)

    def _collect(self, response: dict, limit: int) -> dict:
        result = response.get("result") or {}
        chunks = [result.get("data_array") or []]
        seen = len(chunks[0])
        link = result.get("next_chunk_internal_link")
        while link and seen <= limit:
            nxt = self.call("GET", link)
            chunks.append(nxt.get("data_array") or [])
            seen += len(chunks[-1])
            link = nxt.get("next_chunk_internal_link")
        out = rows_of(response.get("manifest") or {}, chunks, limit)
        out["truncated"] = out["truncated"] or seen > limit
        return out

    def genie_ask(self, space_id: str, question: str, conversation_id: str = "") -> dict:
        if conversation_id:
            message = self.call("POST", f"/api/2.0/genie/spaces/{space_id}/conversations/{conversation_id}/messages",
                                {"content": question})
            return {"conversation_id": conversation_id, "message_id": message.get("message_id") or message.get("id")}
        started = self.call("POST", f"/api/2.0/genie/spaces/{space_id}/start-conversation", {"content": question})
        return {"conversation_id": started.get("conversation_id") or (started.get("conversation") or {}).get("id"),
                "message_id": started.get("message_id") or (started.get("message") or {}).get("id")}

    def genie_message(self, space_id: str, conversation_id: str, message_id: str, row_limit: int = 50) -> dict:
        base = f"/api/2.0/genie/spaces/{space_id}/conversations/{conversation_id}/messages/{message_id}"
        message = self.call("GET", base)
        status = str(message.get("status") or "")
        if status in GENIE_FAILED:
            return {"state": "failed", "error": (message.get("error") or {}).get("error") or f"Genie ended {status.lower()}"}
        if status not in GENIE_DONE:
            return {"state": "running", "step": GENIE_STEPS.get(status, "Working on it")}
        texts, sql, description, attachment = [], "", "", ""
        for item in message.get("attachments") or []:
            if (item.get("text") or {}).get("content"):
                texts.append(item["text"]["content"])
            query = item.get("query") or {}
            if query.get("query") and not sql:
                sql, description = query["query"], query.get("description") or ""
                attachment = item.get("attachment_id") or item.get("id") or ""
        out = {"state": "done", "text": "\n\n".join(texts) or description, "sql": sql, "description": description,
               "columns": [], "rows": [], "truncated": False}
        if sql and attachment:
            try:
                result = self.call("GET", f"{base}/attachments/{attachment}/query-result")
            except QueryError as error:
                out["result_error"] = str(error)
            else:
                statement = result.get("statement_response") or result
                out.update(rows_of(statement.get("manifest") or {}, [(statement.get("result") or {}).get("data_array") or []], row_limit))
        if not out["text"] and sql:
            out["text"] = "Here is what the data shows."
        return out

    def table_history(self, warehouse: str, name: str, limit: int = TABLE_HISTORY_ROWS) -> list:
        quoted = ".".join(f"`{part.strip().strip('`')}`" for part in str(name).split("."))
        rows = self.run_sql(warehouse, f"DESCRIBE HISTORY {quoted} LIMIT {int(limit)}", [], limit=limit)["rows"]
        return [{"version": int(r["version"]), "operation": str(r.get("operation") or ""), "timestamp": r.get("timestamp")}
                for r in rows if r.get("version") is not None]

    def table_properties(self, name: str) -> dict:
        found = self.call("GET", f"/api/2.1/unity-catalog/tables/{urllib.parse.quote(str(name))}")
        return dict(found.get("properties") or {})

    def job(self, job_id: str) -> dict:
        return self.call("GET", "/api/2.2/jobs/get", params={"job_id": job_id})

    def job_runs(self, job_id: str, active_only: bool = False, limit: int = JOB_RUNS_PAGE) -> dict:
        runs, token = [], ""
        while True:
            params = {"job_id": job_id, "active_only": "true" if active_only else "false",
                      "limit": min(JOB_RUNS_PAGE, limit - len(runs)), "expand_tasks": "false"}
            if token:
                params["page_token"] = token
            page = self.call("GET", "/api/2.2/jobs/runs/list", params=params)
            runs += page.get("runs") or []
            token = "" if page.get("has_more") is False else str(page.get("next_page_token") or "")
            if not token or len(runs) >= limit:
                return {"runs": runs[:limit], "more": bool(token) or len(runs) > limit}

    def job_run(self, run_id: str) -> dict:
        return self.call("GET", "/api/2.2/jobs/runs/get", params={"run_id": run_id})

    def run_now(self, job_id: str, parameters=None, kind: str = "job_parameters") -> dict:
        if kind not in ("job_parameters", "notebook_params"):
            raise ValueError(f"a run is started with job_parameters or notebook_params, not {kind}")
        body = {"job_id": int(job_id)}
        if parameters:
            body[kind] = dict(parameters)
        return self.call("POST", "/api/2.2/jobs/run-now", body)
