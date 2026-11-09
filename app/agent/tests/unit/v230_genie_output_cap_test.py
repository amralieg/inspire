"""Unity Gateway's Anthropic route stops a Claude answer at its own default output limit when the request names none, and ends the
stream with response.incomplete and no reason; Genie Code sends no limit, so one long file write was cut off about 60 s in and
resent again and again. The relay now asks for the model family's own limit, and every Genie Code run is told to write long
files in parts."""
import http.server
import json
import threading
import time

from v120_artifacts_support import CapturingLogger
from v220_genie_crash_test import USER, _post, _runner, _scripted_genie

RESPONSES = "/ai-gateway/mlflow/v1/responses"
GATEWAY_DEFAULT = 8192
OPUS = "system.ai.claude-opus-5-5"
WRITE_CALL = {"type": "function_call", "name": "write_file", "call_id": "c1"}


class CappingGateway:
    """A fake Unity Gateway that writes one long tool call in buffered argument deltas with gaps between them, and stops it at
    GATEWAY_DEFAULT output tokens with response.incomplete and incomplete_details null when the request names no
    max_output_tokens, as the real Anthropic route does."""

    def __init__(self, needed_tokens=13446, deltas=3, gap_s=0.05, end=None):
        gateway = self
        self.bodies = []

        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
                gateway.bodies.append(body)
                limit = body.get("max_output_tokens")
                written = min(needed_tokens, limit or GATEWAY_DEFAULT)
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Transfer-Encoding", "chunked")
                self.end_headers()
                events = [{"type": "response.created"}, {"type": "response.output_item.added", "item": WRITE_CALL}]
                for _ in range(deltas):
                    events.append({"type": "response.function_call_arguments.delta", "delta": "x" * 2000})
                if end == "none":
                    pass
                elif end:
                    events.append(end)
                elif written < needed_tokens:
                    events.append({"type": "response.incomplete", "response": {
                        "status": "incomplete", "incomplete_details": None, "max_output_tokens": limit,
                        "usage": {"output_tokens": written}}})
                else:
                    events.append({"type": "response.completed", "response": {
                        "status": "completed", "max_output_tokens": limit, "usage": {"output_tokens": written}}})
                for event in events:
                    time.sleep(gap_s)
                    data = f"event: {event['type']}\ndata: {json.dumps(event)}\n\n".encode()
                    self.wfile.write(f"{len(data):x}\r\n".encode() + data + b"\r\n")
                    self.wfile.flush()
                self.wfile.write(b"0\r\n\r\n")
                self.wfile.flush()

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def close(self):
        self.server.shutdown()
        self.server.server_close()


def _through_relay(ns, gateway, payload):
    logger = CapturingLogger()
    relay = ns["GenieCodeRelay"](gateway.base, logger)
    relay.start()
    try:
        status, text = _post(relay.base + RESPONSES, payload)
    finally:
        relay.stop()
        gateway.close()
    return status, text, logger


def _fired(logger):
    return [line for _level, line in logger.records if "[GENIE-RELAY FIRED]" in line]


def test_a_long_tool_call_through_the_relay_completes_instead_of_stopping_at_the_gateway_default(agent_ns):
    gateway = CappingGateway()
    status, text, logger = _through_relay(agent_ns, gateway, {"model": OPUS, "input": [USER], "stream": True})
    assert status == 200 and "response.completed" in text and "response.incomplete" not in text, text[-400:]
    assert gateway.bodies[0]["max_output_tokens"] == 128000
    assert gateway.bodies[0]["input"] == [USER] and gateway.bodies[0]["model"] == OPUS
    assert _fired(logger) == [], "a stream that completed is not logged as broken (must-exclude)"
    said = [line for _level, line in logger.records if "output tokens instead" in line]
    assert len(said) == 1 and said[0].startswith("[GENIE-RELAY]") and "128,000" in said[0]


def test_the_output_limit_is_logged_once_per_relay_not_on_every_request(agent_ns):
    logger = CapturingLogger()
    gateway = CappingGateway()
    relay = agent_ns["GenieCodeRelay"](gateway.base, logger)
    relay.start()
    try:
        for _ in range(3):
            assert _post(relay.base + RESPONSES, {"model": OPUS, "input": [USER]})[0] == 200
    finally:
        relay.stop()
        gateway.close()
    assert sum("output tokens instead" in line for _level, line in logger.records) == 1
    assert [body["max_output_tokens"] for body in gateway.bodies] == [128000] * 3


def test_a_limit_genie_code_sets_itself_is_kept_and_a_stream_it_caps_is_logged_with_the_reason(agent_ns):
    gateway = CappingGateway()
    status, text, logger = _through_relay(agent_ns, gateway, {"model": OPUS, "input": [USER], "max_output_tokens": 500})
    assert gateway.bodies[0]["max_output_tokens"] == 500, "must-exclude: a limit already in the request is never replaced"
    assert status == 200 and "response.incomplete" in text
    warned = [line for level, line in logger.records if level == "WARNING" and "ended with response.incomplete" in line]
    assert len(warned) == 1, logger.records
    assert not any("output tokens instead" in line for _level, line in logger.records)


def test_a_model_of_no_known_family_gets_no_limit_it_might_refuse(agent_ns):
    gateway = CappingGateway(needed_tokens=100)
    status, _text, logger = _through_relay(agent_ns, gateway, {"model": "some-new-model", "input": [USER]})
    assert status == 200 and "max_output_tokens" not in gateway.bodies[0], "must-exclude: no guessed limit for an unknown model"
    assert _fired(logger) == []


def test_a_stream_that_ends_with_no_final_event_is_logged_as_cut_off(agent_ns):
    gateway = CappingGateway(end="none")
    status, text, logger = _through_relay(agent_ns, gateway, {"model": OPUS, "input": [USER]})
    assert status == 200 and "response.function_call_arguments.delta" in text
    fired = _fired(logger)
    assert len(fired) == 1 and "the stream ended without a completion event" in fired[0], fired
    assert RESPONSES in fired[0] and " bytes back in " in fired[0]


def test_a_failed_stream_is_logged_with_the_gateway_s_error(agent_ns):
    failed = {"type": "response.failed", "response": {"status": "failed", "error": {"message": "overloaded"}}}
    status, _text, logger = _through_relay(agent_ns, CappingGateway(end=failed), {"model": OPUS, "input": [USER]})
    warned = [line for level, line in logger.records if level == "WARNING" and "ended with response.failed" in line]
    assert status == 200 and len(warned) == 1, logger.records


def test_the_output_limit_follows_the_model_family_table(agent_ns):
    cap = agent_ns["genie_output_cap"]
    assert cap("system.ai.claude-opus-5-5") == 128000
    assert cap("databricks-claude-sonnet-5-5") == 64000
    assert cap("claude-haiku-4-5") == 32000
    assert cap("gpt-5.6-sol") == 0 and cap("") == 0 and cap(None) == 0


def test_a_request_that_is_not_a_responses_post_is_passed_on_untouched(agent_ns):
    body = agent_ns["genie_relay_body"]
    raw = json.dumps({"model": OPUS, "input": [USER]}).encode()
    assert body("GET", RESPONSES, "", raw) == (raw, [], 0)
    assert body("POST", "/ai-gateway/mlflow/v1/models", "", raw) == (raw, [], 0)
    assert body("POST", RESPONSES, "gzip", raw) == (raw, [], 0)
    changed, dropped, added = body("POST", RESPONSES + "?x=1", "", raw)
    assert json.loads(changed) == {"model": OPUS, "input": [USER], "max_output_tokens": 128000}
    assert dropped == [] and added == 128000


def test_every_genie_code_run_is_told_to_write_long_files_in_parts(agent_ns, tmp_path):
    prompts = []
    runner = _runner(agent_ns, tmp_path, "https://workspace.example.com", _scripted_genie([(0, "")], prompts))
    runner.relay_factory = lambda host, logger, loopback: None
    runner._run_once("build it", str(tmp_path / "w"), label="build")
    note = agent_ns["GENIE_CLI_WRITE_NOTE"]
    assert prompts and prompts[-1].startswith("build it") and note in prompts[-1]
    assert f"{agent_ns['GENIE_CLI_WRITE_LINES']} lines" in note


def test_genie_code_calling_unity_gateway_directly_logs_that_answers_stop_at_the_gateway_default(agent_ns, tmp_path):
    runner = _runner(agent_ns, tmp_path, "https://workspace.example.com", _scripted_genie([(0, "")], []))
    runner.relay_factory = lambda host, logger, loopback: None
    runner._ensure_relay()
    fired = _fired(runner.logger)
    assert runner.relay is None and len(fired) == 1 and "default output limit" in fired[0], fired
