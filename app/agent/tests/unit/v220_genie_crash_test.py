"""Genie Code survives a dropped stream on the Anthropic route: the conversation it resends never ends in a thinking block or an
assistant prefill, a lost connection runs Genie again from what it wrote, and Inspire calls that a platform error it retries
without using a repair round, never a person error."""
import http.server
import io
import json
import os
import threading
import time
import tomllib
import types
import urllib.error
import urllib.request

import pytest

from v120_artifacts_support import CapturingLogger, make_inspire

THINKING_FINAL = "messages.77: The final block in an assistant message cannot be `thinking`."
PREFILL = "This model does not support assistant message prefill. The conversation must end with a user message."
DROPPED = "stream disconnected before completion: Incomplete response returned, reason: max_output_tokens"
LIVE_REFUSAL = ('unexpected status 400 Bad Request: {"error_code":"BAD_REQUEST","message":"{\\"message\\":\\"' + THINKING_FINAL
                + '\\"}"}')
USER = {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "build the notebook"}]}
REASONING = {"type": "reasoning", "summary": [], "encrypted_content": "abc"}
CALL = {"type": "function_call", "name": "shell", "arguments": "{\"command\": [\"ls\"]}", "call_id": "c1"}
OUTPUT = {"type": "function_call_output", "call_id": "c1", "output": "notebook.py"}
SAID = {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "I will now"}]}


class AnthropicRoute:
    """A fake Unity Gateway route that refuses a conversation ending in the model's own turn the way the Claude route does."""

    def __init__(self):
        route = self
        self.seen = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)))
                route.seen.append((self.path, self.headers.get("Authorization"), body))
                last = (body.get("input") or [{}])[-1]
                refused = (THINKING_FINAL if last.get("type") == "reasoning" else
                           PREFILL if last.get("role") == "assistant" else "")
                if refused:
                    data = json.dumps({"error_code": "BAD_REQUEST", "message": refused}).encode()
                    self.send_response(400)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                    return
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                for event in ("response.created", "response.completed"):
                    self.wfile.write(f"event: {event}\ndata: {json.dumps({'type': event})}\n\n".encode())
                    self.wfile.flush()

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def close(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def route():
    served = AnthropicRoute()
    yield served
    served.close()


def _post(url, body):
    request = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                     headers={"Content-Type": "application/json", "Authorization": "Bearer tok-123"})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(request, timeout=10) as answer:
            return answer.status, answer.read().decode()
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()


class _Proc:
    def __init__(self, lines, code):
        self.stdout = io.StringIO("".join(json.dumps(line) + "\n" for line in lines))
        self.stderr = io.StringIO("")
        self.code = code
        self.pid = 0

    def wait(self):
        return self.code

    def kill(self):
        pass


def _resuming_genie(resent):
    """Genie Code after a dropped stream: it resends the conversation so far to the base_url its config.toml names."""
    def popen(command, env=None, **kw):
        config = tomllib.loads(open(os.path.join(env["GENIE_HOME"], "config.toml"), encoding="utf-8").read())
        base = config["model_providers"]["databricks"]["base_url"]
        status, text = _post(base + "/responses", {"model": config["model"], "input": resent, "stream": True})
        if status == 200:
            return _Proc([{"type": "turn.completed"}], 0)
        return _Proc([{"type": "error", "message": f"unexpected status {status} Bad Request: {text}"}], 1)
    return popen


def _runner(ns, tmp_path, host, popen, route_obj=None):
    runner = ns["GenieCodeRunner"](host, "tok-123", CapturingLogger(), root=str(tmp_path), popen=popen,
                                   route=route_obj or ns["GenieCodeRoute"]("system.ai.claude-opus-5-5", ns["GENIE_CODE_GATEWAYS"][1]))
    runner.genie_path, runner.cli_dir = "/bin/genie", str(tmp_path / "cli")
    os.makedirs(tmp_path / "home", exist_ok=True)
    runner.sleep = lambda s: None
    return runner


@pytest.mark.parametrize("resent,refusal", [([USER, CALL, OUTPUT, REASONING], THINKING_FINAL),
                                            ([USER, REASONING, SAID], PREFILL)])
def test_the_route_refuses_the_conversation_genie_code_resends_after_a_dropped_stream(agent_ns, route, resent, refusal):
    status, text = _post(f"{route.base}{agent_ns['UNITY_GATEWAY_MLFLOW_PATH']}/responses", {"model": "m", "input": resent})
    assert status == 400 and refusal in text, "the fake route refuses what the Claude route refused in 11 of 12 build rounds"


@pytest.mark.parametrize("resent", [[USER, CALL, OUTPUT, REASONING], [USER, REASONING, SAID], [USER, CALL, OUTPUT, REASONING, SAID]])
def test_a_resumed_genie_code_session_reaches_the_model_through_the_runner(agent_ns, tmp_path, route, resent):
    runner = _runner(agent_ns, tmp_path, route.base, _resuming_genie(resent))
    result = runner.run("build it", str(tmp_path / "w"), label="build")
    assert result["exit"] == 0, result["errors"]
    path, auth, body = route.seen[-1]
    assert path == agent_ns["UNITY_GATEWAY_MLFLOW_PATH"] + "/responses" and auth == "Bearer tok-123"
    assert body["input"][-1]["type"] not in ("reasoning",) and body["input"][-1].get("role") != "assistant"
    assert body["input"][:3] == resent[:3] if resent[1] is CALL else body["input"] == [USER]
    assert any("[GENIE-RESUME FIRED]" in line for _level, line in runner.logger.records)
    config = tomllib.loads(runner.config_toml())["model_providers"]["databricks"]
    assert config["base_url"].startswith("http://[::1]:") and config["base_url"].endswith(agent_ns["UNITY_GATEWAY_MLFLOW_PATH"])
    assert config["stream_max_retries"] == agent_ns["GENIE_CODE_REQUEST_RETRIES"]
    assert config["request_max_retries"] == agent_ns["GENIE_CODE_REQUEST_RETRIES"]


def test_the_relay_changes_nothing_a_valid_conversation_sends_and_passes_other_calls_through(agent_ns, route):
    relay = agent_ns["GenieCodeRelay"](route.base, CapturingLogger())
    relay.start()
    try:
        whole = [USER, REASONING, CALL, OUTPUT]
        assert _post(f"{relay.base}/ai-gateway/mlflow/v1/responses", {"model": "m", "input": whole})[0] == 200
        assert route.seen[-1][2]["input"] == whole, "a reasoning item an answer follows stays, so the model keeps its own thinking"
        assert relay.fixed == 0
    finally:
        relay.stop()


def test_the_resend_sanitizer_drops_only_the_unanswered_tail_of_the_model_s_turn(agent_ns):
    clean = agent_ns["genie_resumable_input"]
    assert clean([USER, CALL, OUTPUT, REASONING]) == ([USER, CALL, OUTPUT], ["reasoning"])
    assert clean([USER, REASONING, SAID]) == ([USER], ["reasoning", "assistant message"])
    assert clean([USER, REASONING, CALL, OUTPUT, REASONING, CALL]) == ([USER, REASONING, CALL, OUTPUT], ["reasoning", "function_call"])
    assert clean([USER, REASONING, CALL, OUTPUT]) == ([USER, REASONING, CALL, OUTPUT], [])
    assert clean([USER, REASONING, USER]) == ([USER, USER], ["reasoning"]), "a thinking block no answer follows never stays mid-way"
    assert clean([REASONING, SAID]) == ([REASONING, SAID], []), "a conversation of nothing but the model's turn is left as it is"
    assert clean("text input") == ("text input", [])
    body, dropped, cap = agent_ns["genie_relay_body"]("POST", "/ai-gateway/mlflow/v1/responses?x=1", "",
                                                      json.dumps({"input": [USER, REASONING], "model": "m"}).encode())
    assert json.loads(body) == {"input": [USER], "model": "m"} and dropped == ["reasoning"] and cap == 0
    raw = json.dumps({"input": [USER, REASONING]}).encode()
    assert agent_ns["genie_relay_body"]("GET", "/ai-gateway/mlflow/v1/responses", "", raw) == (raw, [], 0)
    assert agent_ns["genie_relay_body"]("POST", "/ai-gateway/mlflow/v1/models", "", raw) == (raw, [], 0)
    assert agent_ns["genie_relay_body"]("POST", "/ai-gateway/mlflow/v1/responses", "zstd", raw) == (raw, [], 0)
    assert agent_ns["genie_relay_body"]("POST", "/ai-gateway/mlflow/v1/responses", "", b"{not json") == (b"{not json", [], 0)


def _scripted_genie(answers, prompts):
    def popen(command, env=None, **kw):
        prompts.append(command[-1])
        code, said = answers.pop(0)
        return _Proc([{"type": "error", "message": said}] if said else [{"type": "turn.completed"}], code)
    return popen


def test_a_lost_connection_runs_genie_again_from_what_it_wrote_with_backoff(agent_ns, tmp_path):
    prompts, slept = [], []
    runner = _runner(agent_ns, tmp_path, "https://workspace.example.com", _scripted_genie([(1, DROPPED), (1, LIVE_REFUSAL), (0, "")], prompts))
    runner.relay_factory = lambda host, logger, loopback: None
    runner.sleep = slept.append
    result = runner.run("build it", str(tmp_path / "w"), label="build")
    assert result["exit"] == 0 and len(prompts) == 3
    assert agent_ns["GENIE_RESUME_NOTE"] not in prompts[0] and all(agent_ns["GENIE_RESUME_NOTE"] in p for p in prompts[1:])
    assert slept == list(agent_ns["GENIE_CODE_TRANSPORT_BACKOFF_S"][:2])
    assert sum("[GENIE-TRANSPORT FIRED]" in line for _level, line in runner.logger.records) == 2


def test_a_connection_that_keeps_failing_raises_a_platform_error_after_the_retries(agent_ns, tmp_path):
    tries = agent_ns["GENIE_CODE_TRANSPORT_RETRIES"] + 1
    prompts = []
    runner = _runner(agent_ns, tmp_path, "https://workspace.example.com", _scripted_genie([(1, DROPPED)] * tries, prompts))
    runner.relay_factory = lambda host, logger, loopback: None
    with pytest.raises(agent_ns["ImplementTransportFailed"]) as raised:
        runner.run("build it", str(tmp_path / "w"), label="build")
    assert len(prompts) == tries and raised.value.cause == DROPPED
    assert agent_ns["implement_failure_origin"](raised.value) == "platform"


GENERIC_400 = 'unexpected status 400 Bad Request: {"error_code":"BAD_REQUEST","message":"Invalid parameter: max_tokens must be at most 500"}'


@pytest.mark.parametrize("said", [LIVE_REFUSAL, PREFILL, DROPPED, "error sending request for url: connection reset by peer"])
def test_only_the_known_transport_signatures_are_a_lost_connection(agent_ns, said):
    assert agent_ns["genie_transport_failure"]({"exit": 1, "errors": [f"Genie error: {said}"]})
    assert agent_ns["genie_transport_failure"]({"exit": 1, "stderr": f"note: starting\nERROR: {said}\n"}), "the reason only on stderr"


@pytest.mark.parametrize("said,kind", [(GENERIC_400, "other"), ("unexpected status 503 Service Unavailable", "server"),
                                       ("unexpected status 429 Too Many Requests", "throttled"), ("HTTP 502 from the gateway", "server")])
def test_a_rate_limit_or_server_error_is_busy_and_a_request_error_naming_500_is_not(agent_ns, said, kind):
    assert agent_ns["genie_transport_failure"]({"exit": 1, "errors": [f"Genie error: {said}"]}) == ""
    assert agent_ns["_classify_runtime_error"](said) == kind


@pytest.mark.parametrize("said", ["the notebook has no Run controls cell", "Error: input is too long for requested model",
                                  "Genie gave no reason", GENERIC_400,
                                  'unexpected status 400 Bad Request: {"error_code":"INVALID_REQUEST","message":"unknown field tools"}'])
def test_a_run_that_failed_for_another_reason_is_not_rerun(agent_ns, tmp_path, said):
    prompts = []
    runner = _runner(agent_ns, tmp_path, "https://workspace.example.com", _scripted_genie([(1, said), (0, "")], prompts))
    runner.relay_factory = lambda host, logger, loopback: None
    assert runner.run("build it", str(tmp_path / "w"), label="build")["exit"] == 1 and len(prompts) == 1
    assert agent_ns["genie_transport_failure"]({"exit": 1, "timed_out": True, "errors": [f"Genie error: {DROPPED}"]}) == "", (
        "a run stopped at the time limit is not a lost connection (must-exclude)")


def test_a_relay_that_cannot_start_leaves_genie_calling_the_gateway_directly(agent_ns, tmp_path):
    runner = _runner(agent_ns, tmp_path, "https://workspace.example.com", _scripted_genie([(0, "")], []))
    runner.relay_factory = lambda host, logger, loopback: (_ for _ in ()).throw(OSError("no free port"))
    assert runner.run("build it", str(tmp_path / "w"))["exit"] == 0
    assert tomllib.loads(runner.config_toml())["model_providers"]["databricks"]["base_url"].startswith("https://workspace.example.com/")
    assert any("could not start" in line for _level, line in runner.logger.records)
    env = runner.env()
    assert "127.0.0.1" in env["NO_PROXY"] and "localhost" in env["no_proxy"]


def test_the_codex_route_calls_the_gateway_directly_and_never_starts_the_relay(agent_ns, tmp_path):
    codex = agent_ns["GenieCodeRoute"]("gpt-5.6-sol", agent_ns["GENIE_CODE_GATEWAYS"][0])
    runner = _runner(agent_ns, tmp_path, "https://workspace.example.com", _scripted_genie([(0, "")], []), route_obj=codex)
    started = []
    runner.relay_factory = lambda host, logger, loopback: started.append(host)
    assert runner.run("build it", str(tmp_path / "w"))["exit"] == 0
    assert started == [] and runner.relay is None
    base = tomllib.loads(runner.config_toml())["model_providers"]["databricks"]["base_url"]
    assert base == "https://workspace.example.com" + agent_ns["GENIE_CODE_GATEWAYS"][0]["base"]
    claude = _runner(agent_ns, tmp_path, "https://workspace.example.com", _scripted_genie([(0, "")], []))
    claude.relay_factory = lambda host, logger, loopback: types.SimpleNamespace(base="http://127.0.0.1:9", stop=lambda: None)
    claude.relay_probe = lambda url, token, env: ""
    claude.run("build it", str(tmp_path / "w"))
    assert tomllib.loads(claude.config_toml())["model_providers"]["databricks"]["base_url"].startswith("http://127.0.0.1:9/"), (
        "the Claude route still goes through the relay that repairs its resends (must-include)")


def _closed_port():
    import socket
    probe = socket.socket()
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
    probe.close()
    return port


@pytest.mark.parametrize("relay_of", [
    lambda ns: types.SimpleNamespace(base=f"http://127.0.0.1:{_closed_port()}", stop=lambda: None),
    lambda ns: ns["GenieCodeRelay"]("http://127.0.0.1:1", CapturingLogger()),
])
def test_a_relay_genie_code_cannot_get_an_answer_through_is_dropped_before_genie_runs(agent_ns, tmp_path, relay_of):
    relay = relay_of(agent_ns)
    if hasattr(relay, "start"):
        relay.start()
    made, popen = [], _scripted_genie([(0, ""), (0, "")], [])
    runner = _runner(agent_ns, tmp_path, "https://workspace.example.com", popen)
    runner.relay_factory = lambda host, logger, loopback: made.append(host) or relay
    try:
        assert runner.run("build it", str(tmp_path / "w"))["exit"] == 0
        assert runner.relay is None and runner.relay_off
        base = tomllib.loads(runner.config_toml())["model_providers"]["databricks"]["base_url"]
        assert base == "https://workspace.example.com" + agent_ns["UNITY_GATEWAY_MLFLOW_PATH"], "Genie Code calls the gateway directly"
        fired = [line for _level, line in runner.logger.records if "[GENIE-RELAY FIRED]" in line]
        assert len(fired) == 1 and runner.relay_off in fired[0]
        runner.run("build it again", str(tmp_path / "w"))
        assert made == ["https://workspace.example.com"] * len(agent_ns["GENIE_RELAY_LOOPBACKS"]), (
            "a relay found unreachable on every loopback is not started and checked again every round")
    finally:
        if hasattr(relay, "start"):
            relay.stop()


def test_a_relay_that_answers_a_process_started_from_the_notebook_is_kept(agent_ns, tmp_path, route):
    runner = _runner(agent_ns, tmp_path, route.base, _scripted_genie([(0, "")], []))
    assert runner.run("build it", str(tmp_path / "w"))["exit"] == 0
    assert runner.relay is not None and not runner.relay_off
    assert tomllib.loads(runner.config_toml())["model_providers"]["databricks"]["base_url"] == runner.relay.base + agent_ns["UNITY_GATEWAY_MLFLOW_PATH"]
    assert not any("[GENIE-RELAY FIRED]" in line for _level, line in runner.logger.records)


@pytest.mark.parametrize("upstream", ["workspace.example.com", "http://127.0.0.1:1"])
def test_a_relay_that_cannot_reach_the_gateway_answers_with_the_reason_and_logs_it(agent_ns, upstream):
    logger = CapturingLogger()
    relay = agent_ns["GenieCodeRelay"](upstream, logger)
    relay.start()
    try:
        status, text = _post(f"{relay.base}/ai-gateway/mlflow/v1/responses", {"model": "m", "input": [USER]})
    finally:
        relay.stop()
    assert status == 502 and "the relay could not reach Unity Gateway" in text
    assert any("[GENIE-RELAY FIRED]" in line and "/ai-gateway/mlflow/v1/responses" in line for _level, line in logger.records)


def _wrapped(ns):
    try:
        try:
            raise ns["ImplementTransportFailed"]("build", 4, DROPPED)
        except Exception as lost:
            raise ns["ImplementStopped"]("Genie's last build round did not finish") from lost
    except Exception as error:
        return error


def test_a_lost_connection_is_a_platform_error_inspire_retries_at_every_classification_site(agent_ns):
    error = _wrapped(agent_ns)
    assert isinstance(error, agent_ns["ImplementBlocked"]), "the stop the lost connection caused is a stop error"
    assert agent_ns["implement_failure_origin"](error) == "platform", "never a person error (must-exclude)"
    assert agent_ns["implement_known_repair"](error, str(error))["kind"] == "retry"
    assert agent_ns["implement_transient"](error) is True
    assert agent_ns["implement_failure_origin"](agent_ns["ImplementStopped"]("the readiness gate stopped the run")) == "refusal", (
        "a real stop is still a refusal")
    assert agent_ns["_classify_runtime_error"](DROPPED) == "server"
    assert agent_ns["implement_known_repair"](RuntimeError(DROPPED), DROPPED)["kind"] == "retry"


def test_a_lost_connection_is_built_again_without_using_one_of_the_build_attempts(fresh_ns, monkeypatch):
    monkeypatch.setattr(time, "sleep", lambda s: None)
    inst = make_inspire(fresh_ns)
    failures = [_wrapped(fresh_ns), _wrapped(fresh_ns)]
    emitted, failed = [], []

    def one(target, key, inflight):
        if failures:
            raise failures.pop(0)
        return "built"

    inst._implement_one_locked = one
    inst._implement_emit = lambda *a, **k: emitted.append(a)
    inst._implement_update = lambda key, **fields: None
    inst._implement_notebook_undo = lambda uc_id, inflight: None
    inst._implement_stopped_fields = lambda key, inflight: {}
    inst._implement_failure_message = lambda error, known: str(error)
    inst._implement_repair = lambda *a, **k: pytest.fail("a lost connection never asks for a repair")
    assert inst._implement_attempts({"use_case_id": "N01-U01"}, "N01-U01", (1, "N01-U01", 1)) == "built"
    assert [e[1] for e in emitted] == [fresh_ns["IMPLEMENT_REPAIR_PHASE"]] * 2
    assert all(fresh_ns["IMPLEMENT_TRANSPORT_WHY"] in e[2] and "without using one of its" in e[2] for e in emitted)
    assert sum("[IMPLEMENT-TRANSPORT FIRED]" in line for _level, line in inst.logger.records) == 2
    logged = [line for _level, line in inst.logger.records if line.startswith("[IMPLEMENT-ERROR]")]
    assert len(logged) == 2 and all(f"attempt 1 of {fresh_ns['IMPLEMENT_BUILD_ATTEMPTS']} failed with a platform error" in line for line in logged)
    failures[:] = [_wrapped(fresh_ns) for _ in range(fresh_ns["IMPLEMENT_TRANSPORT_ROUNDS"] + fresh_ns["IMPLEMENT_BUILD_ATTEMPTS"])]
    inst._implement_repair = lambda uc_id, step, error, message, attempt, history: {"kind": "retry", "why": "again"}
    inst._implement_failed = lambda uc_id, key, message, extra, fields: failed.append(extra) or "failed"
    assert inst._implement_attempts({"use_case_id": "N01-U01"}, "N01-U01", (1, "N01-U01", 1)) == "failed"
    assert failed[-1]["attempts"] <= fresh_ns["IMPLEMENT_BUILD_ATTEMPTS"], "the transport rounds are bounded, never an endless loop"


def test_a_lost_connection_in_an_output_is_built_again_without_using_an_attempt(fresh_ns, monkeypatch):
    monkeypatch.setattr(time, "sleep", lambda s: None)
    inst = make_inspire(fresh_ns)
    inst._implement_emit = lambda *a, **k: None
    inst._implement_update = lambda key, **fields: None
    failures = [_wrapped(fresh_ns)] * 2
    builds = []

    def build():
        builds.append(1)
        if failures:
            raise failures.pop(0)
        return {"ok": True}

    inst._implement_vibes_llm = lambda *a, **k: pytest.fail("a lost connection never asks the model for a repair")
    name = next(iter(fresh_ns["IMPLEMENT_OUTPUT_LABELS"]))
    assert inst._implement_part_attempts("N01-U01", (1, "N01-U01", 1), name, build) == {"ok": True}
    assert len(builds) == 3
    logged = [line for _level, line in inst.logger.records if line.startswith("[IMPLEMENT-ERROR]")]
    assert len(logged) == 2 and all(f"attempt 1 of {fresh_ns['IMPLEMENT_BUILD_ATTEMPTS']}" in line for line in logged)
    assert all("platform error" in line for line in logged), "never a person error (must-exclude)"


class _Frame:
    def __init__(self, columns, dtypes, steps):
        self.columns, self.dtypes, self.steps = columns, dtypes, steps

    def where(self, condition):
        self.steps.append(("where", condition))
        return self

    def orderBy(self, *by):
        self.steps.append(("orderBy",) + by)
        return self

    def limit(self, n):
        self.steps.append(("limit", n))
        return self

    def count(self):
        return 5000


def test_a_first_run_on_some_records_spreads_them_across_the_whole_table_not_the_first_by_key(fresh_ns):
    steps = []
    columns = ["job_id", "crew_type", "status", "attrs"]
    frame = _Frame(columns, [("job_id", "bigint"), ("crew_type", "string"), ("status", "string"), ("attrs", "map<string,string>")], steps)
    spark = types.SimpleNamespace(table=lambda name: frame)
    fresh_ns["_inspire_spread_expr"] = lambda spread: ("expr", spread)
    fresh_ns["INSPIRE_SCOPE"] = {"scope": "records", "records": 1000, "table": "main.ops.jobs", "key": "crew_type"}
    fresh_ns["inspire_read_source"]("main.ops.jobs", spark)
    ordered = [step for step in steps if step[0] == "orderBy"]
    assert ordered == [("orderBy", ("expr", "xxhash64(CAST(`job_id` AS STRING), CAST(`crew_type` AS STRING), CAST(`status` AS STRING))"))]
    assert ("orderBy", "crew_type") not in steps, "never the first records of the key's sort order (must-exclude)"
    assert steps[-1] == ("limit", 1000)
    steps.clear()
    fresh_ns["INSPIRE_SCOPE"] = {"scope": "records", "records": 1000, "table": "main.ops.other"}
    fresh_ns["inspire_read_source"]("main.ops.jobs", spark)
    assert not [step for step in steps if step[0] in ("orderBy", "limit")], "a table the records scope does not name is read whole"
    assert "spread across the table" in fresh_ns["GENIE_SOURCE_READ_RULE"]
    assert fresh_ns["INSPIRE_SPREAD_WORDS"] in fresh_ns["inspire_scope_text"](
        {"scope": "records", "records": 1000, "table": "main.ops.jobs"})


def test_a_full_catalog_quota_shows_the_whole_reason_and_the_real_next_step(agent_ns):
    said = ("Failed to create catalog: QUOTA_EXCEEDED: Cannot create 1 Catalog(s) in Metastore 0000 "
            "(estimated count: 1001, limit: 1000).")
    text = agent_ns["implement_lakebase_fallback"](said)
    assert "(estimated count: 1001, limit: 1000)" in text and "drops the catalogs no one uses" in text
    assert ".." not in text
    other = agent_ns["implement_lakebase_fallback"]("the instance did not start")
    assert "drops the catalogs" not in other, "only a quota reason names the quota step (must-exclude)"


def test_a_preview_picks_its_entities_spread_across_every_status_never_the_first_rows(agent_ns):
    from v161_preview_sample_test import _spec
    [profile] = [line for line in agent_ns["_implement_choice_lines"](_spec(agent_ns)) if "Add a dropdown widget `run_profile`" in line]
    assert agent_ns["IMPLEMENT_PREVIEW_SPREAD_RULE"] in profile and "lowest xxhash64 of the entity key" in profile
