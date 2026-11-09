"""A working Genie Code relay and a working AI model call leave a line in the run's log: where the relay listens (or that Genie
Code calls Unity Gateway directly), one line per finished stream with its status, bytes and seconds, and one line per answered
ai_query, none of them carrying the token, a URL query or the prompt."""
import http.server
import threading
import time
import types

from v120_artifacts_support import CapturingLogger
from v120_runtime_reliability_test import FakeConnectSpark, RecordingLogger, make_agent, use_roster
from v220_genie_crash_test import USER, AnthropicRoute, _post, _runner, _scripted_genie
from v229_genie_relay_stream_test import RESPONSES, SlowRoute, _fired, _relay

TOKEN = "tok-123"
PROMPT = "PROMPT-SENTINEL rank the renewals by risk"


def _relay_lines(logger, level=None):
    return [line for lvl, line in logger.records
            if line.startswith("[GENIE-RELAY]") and (level is None or lvl == level)]


def _started(logger):
    return [line for line in _relay_lines(logger) if "Genie Code calls Unity Gateway" in line]


def _finished(logger):
    return [line for line in _relay_lines(logger) if "bytes from Genie Code and" in line]


def _private(lines):
    return [line for line in lines if TOKEN in line or "PROMPT-SENTINEL" in line or "?" in line or "secret" in line]


def test_a_relay_that_works_logs_once_where_it_listens_and_that_its_probe_stream_finished(agent_ns, tmp_path):
    route = SlowRoute()
    runner = _runner(agent_ns, tmp_path, route.base, _scripted_genie([(0, ""), (0, "")], []))
    try:
        assert runner.run("build it", str(tmp_path / "w"))["exit"] == 0
        assert runner.run("build it again", str(tmp_path / "w"))["exit"] == 0
        started = _started(runner.logger)
        assert len(started) == 1, started
        assert f"through the relay on {runner.relay.base}, bound to ::1" in started[0] and runner.relay.base.startswith("http://[::1]:")
        finished = _finished(runner.logger)
        assert len(finished) == 1 and finished[0].startswith(f"[GENIE-RELAY] GET {agent_ns['UNITY_GATEWAY_MLFLOW_PATH']}/models: "
                                                             "Unity Gateway status 200, 0 bytes from Genie Code and 12 bytes back in ")
        assert not _fired(runner.logger) and not _private(_relay_lines(runner.logger))
    finally:
        runner.relay.stop()
        route.close()


def test_a_relay_that_falls_back_to_127_0_0_1_names_the_address_it_bound_and_why(agent_ns, tmp_path):
    route = SlowRoute()

    def factory(host, logger, loopback):
        if loopback == "::1":
            raise OSError("Address family not supported by protocol")
        return agent_ns["GenieCodeRelay"].shared(host, logger, loopback)

    runner = _runner(agent_ns, tmp_path, route.base, _scripted_genie([(0, "")], []))
    runner.relay_factory = factory
    try:
        runner.run("build it", str(tmp_path / "w"))
        started = _started(runner.logger)
        assert len(started) == 1 and "bound to 127.0.0.1; ::1: the relay could not start" in started[0], started
    finally:
        runner.relay.stop()
        route.close()


def test_genie_code_on_a_route_without_the_relay_logs_once_that_it_calls_unity_gateway_directly(agent_ns, tmp_path):
    made = []
    codex = agent_ns["GenieCodeRoute"]("databricks-gpt-5-5", agent_ns["GENIE_CODE_GATEWAYS"][0])
    runner = _runner(agent_ns, tmp_path, "https://workspace.example.com", _scripted_genie([(0, ""), (0, "")], []), route_obj=codex)
    runner.relay_factory = lambda host, logger, loopback: made.append(loopback)
    runner.run("build it", str(tmp_path / "w"))
    runner.run("build it again", str(tmp_path / "w"))
    assert made == [] and runner.relay is None
    assert _relay_lines(runner.logger) == [
        "[GENIE-RELAY] Genie Code calls Unity Gateway directly: databricks-gpt-5-5 through the Codex route needs no relay"]


def test_switching_from_the_direct_route_to_the_relayed_route_logs_both_starts(agent_ns, tmp_path):
    route = SlowRoute()
    codex = agent_ns["GenieCodeRoute"]("databricks-gpt-5-5", agent_ns["GENIE_CODE_GATEWAYS"][0])
    claude = agent_ns["GenieCodeRoute"]("system.ai.claude-opus-5-5", agent_ns["GENIE_CODE_GATEWAYS"][1])
    runner = _runner(agent_ns, tmp_path, route.base, _scripted_genie([(0, ""), (0, "")], []), route_obj=codex)
    runner.relay_probe = lambda url, token, env: ""
    try:
        runner.run("build it", str(tmp_path / "w"))
        runner.use_route(claude)
        runner.run("build it again", str(tmp_path / "w"))
        started = _started(runner.logger)
        assert len(started) == 2 and "directly" in started[0] and "bound to ::1" in started[1], started
    finally:
        runner.relay.stop()
        route.close()


def test_a_finished_stream_logs_its_status_bytes_and_seconds_without_token_query_or_prompt(agent_ns):
    route = SlowRoute(chunks=3, pause_s=0.2)
    logger = CapturingLogger()
    relay = _relay(agent_ns, route.base, logger)
    try:
        asked = {"model": "m", "input": [dict(USER, content=[{"type": "input_text", "text": PROMPT}])]}
        status, text = _post(relay.base + RESPONSES + "?api-version=secret", asked)
    finally:
        relay.stop()
        route.close()
    assert status == 200 and "response.completed" in text
    finished = _finished(logger)
    assert len(finished) == 1 and [lvl for lvl, line in logger.records if line == finished[0]] == ["INFO"], logger.records
    line = finished[0]
    assert line.startswith(f"[GENIE-RELAY] POST {RESPONSES}: Unity Gateway status 200, ")
    assert line.endswith("s, ended with response.completed"), line
    sent = int(line.split("status 200, ", 1)[1].split(" bytes from", 1)[0])
    back = int(line.split(" and ", 1)[1].split(" bytes back", 1)[0])
    seconds = float(line.split(" back in ", 1)[1].split("s,", 1)[0])
    assert sent > len(PROMPT) and back == len(text.encode()) and 0.5 <= seconds < 5, line
    assert not _private(_relay_lines(logger)) and not _fired(logger)


class CleanCutRoute:
    """A fake Unity Gateway that sends its SSE writes with a pause between them and closes the stream cleanly, with or without
    a final event, the way a gateway that gives up on a long tool call ends it."""

    def __init__(self, writes, pause_s=0.2):
        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args):
                pass

            def do_POST(self):
                self.rfile.read(int(self.headers.get("Content-Length") or 0))
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                self.send_header("Transfer-Encoding", "chunked")
                self.end_headers()
                for data in writes:
                    self.wfile.write(f"{len(data):x}\r\n".encode() + data + b"\r\n")
                    self.wfile.flush()
                    time.sleep(pause_s)
                self.wfile.write(b"0\r\n\r\n")
                self.wfile.flush()

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def close(self):
        self.server.shutdown()
        self.server.server_close()


DELTA = b'event: response.output_text.delta\ndata: {"delta": "working"}\n\n'


def _through_relay(agent_ns, writes):
    route = CleanCutRoute(writes)
    logger = CapturingLogger()
    relay = _relay(agent_ns, route.base, logger)
    try:
        status, text = _post(relay.base + RESPONSES, {"model": "m", "input": [USER]})
    finally:
        relay.stop()
        route.close()
    return status, text, logger


def test_a_stream_that_ends_cleanly_without_a_completion_event_is_logged_as_broken_with_its_bytes_and_seconds(agent_ns):
    status, text, logger = _through_relay(agent_ns, [DELTA, DELTA])
    assert status == 200 and text.count("working") == 2
    fired = _fired(logger)
    assert len(fired) == 1 and "the stream ended without a completion event" in fired[0], logger.records
    back = int(fired[0].split(" and ", 1)[1].split(" bytes back", 1)[0])
    seconds = float(fired[0].split(" back in ", 1)[1].split("s:", 1)[0])
    assert back == len(text.encode()) and seconds >= 0.3, fired[0]
    assert [line for _lvl, line in logger.records if line.startswith("[GENIE-RELAY] ")] == [], "no finished line for a cut stream"


def test_a_completion_event_split_across_two_reads_still_counts(agent_ns):
    status, text, logger = _through_relay(agent_ns, [DELTA, b"event: response.comp", b"leted\ndata: {}\n\n"])
    assert status == 200 and "response.completed" in text
    assert not _fired(logger) and _finished(logger)[0].endswith(", ended with response.completed"), logger.records


def test_a_model_answer_that_only_mentions_the_completion_event_is_still_a_cut_stream(agent_ns):
    quoted = b'event: response.output_text.delta\ndata: {"delta": "\\nevent: response.completed\\n"}\n\n'
    _status, _text, logger = _through_relay(agent_ns, [quoted])
    assert len(_fired(logger)) == 1 and "without a completion event" in _fired(logger)[0], logger.records


def test_an_anthropic_message_stop_counts_as_completed(agent_ns):
    _status, _text, logger = _through_relay(agent_ns, [b"event: message_start\ndata: {}\n\n", b"event: message_stop\ndata: {}\n\n"])
    finished = [(lvl, line) for lvl, line in logger.records if line in _finished(logger)]
    assert finished and finished[0][0] == "INFO" and finished[0][1].endswith("ended with message_stop") and not _fired(logger)


def test_a_stream_the_gateway_ends_as_failed_is_a_warning_naming_that_event(agent_ns):
    _status, _text, logger = _through_relay(agent_ns, [DELTA, b"event: response.failed\ndata: {}\n\n"])
    finished = [(lvl, line) for lvl, line in logger.records if line in _finished(logger)]
    assert finished and finished[0][0] == "WARNING" and finished[0][1].endswith("ended with response.failed")
    assert not _fired(logger)


def test_a_stream_that_breaks_logs_only_the_failure_not_a_finished_line(agent_ns):
    route = SlowRoute(chunks=3, pause_s=0.05, die_after=2)
    logger = CapturingLogger()
    relay = _relay(agent_ns, route.base, logger)
    try:
        _post(relay.base + RESPONSES, {"model": "m", "input": [USER]})
    finally:
        relay.stop()
        route.close()
    assert len(_fired(logger)) == 1 and _finished(logger) == [], logger.records


def test_a_gateway_that_refuses_logs_the_finished_stream_as_a_warning_with_its_status(agent_ns):
    route = AnthropicRoute()
    logger = CapturingLogger()
    relay = _relay(agent_ns, route.base, logger)
    try:
        status = agent_ns["genie_relay_unreachable"](relay.base + "/ai-gateway/mlflow/v1/models", TOKEN, {"NO_PROXY": "*"})
    finally:
        relay.stop()
        route.close()
    assert status == "", "a refusal other than 502 still means the relay answered"
    finished = [(lvl, line) for lvl, line in logger.records if "bytes from Genie Code and" in line]
    assert len(finished) == 1 and finished[0][0] == "WARNING", logger.records
    assert finished[0][1].startswith("[GENIE-RELAY] GET /ai-gateway/mlflow/v1/models: Unity Gateway status 501, 0 bytes from")
    assert not _private([finished[0][1]])


def test_an_answered_ai_query_logs_the_model_seconds_and_sizes_without_the_prompt(fresh_ns):
    use_roster(fresh_ns, "databricks-x")
    log = RecordingLogger()
    agent = make_agent(fresh_ns, FakeConnectSpark(lambda op: "the answer"), log)
    assert agent._call_ai_query(PROMPT, "SUMMARY_GEN_PROMPT") == "the answer"
    done = [(lvl, m) for lvl, m in log.records if m.startswith("[LLM_CALL]")]
    assert len(done) == 1 and done[0][0] == "INFO", log.records
    line = done[0][1]
    assert line.startswith("[LLM_CALL] [SUMMARY_GEN_PROMPT] 'x' answered in ") and "(attempt 1/" in line
    assert line.endswith(", 10 chars out") and "PROMPT-SENTINEL" not in line


def test_an_ai_query_that_fails_on_every_model_logs_no_answered_line(fresh_ns):
    use_roster(fresh_ns, "databricks-x")
    log = RecordingLogger()

    def refuse(op):
        raise RuntimeError("PERMISSION_DENIED: no access to databricks-x")

    agent = make_agent(fresh_ns, FakeConnectSpark(refuse), log)
    try:
        agent._call_ai_query(PROMPT, "SUMMARY_GEN_PROMPT")
    except Exception:
        pass
    assert log.matching("[LLM_CALL]") == [] and log.records
