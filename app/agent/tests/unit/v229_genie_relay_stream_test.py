"""Genie Code's relay on a serverless sandbox that refuses connections to 127.0.0.1: the relay listens on the IPv6 loopback first,
falls back to 127.0.0.1, and every stream that breaks on either side is logged with its class, bytes, time and upstream status
instead of being swallowed."""
import http.server
import io
import json
import os
import socket
import threading
import time
import tomllib
import types

import pytest

from v120_artifacts_support import CapturingLogger, FakeWorkspaceApi, make_inspire
from v220_genie_crash_test import USER, AnthropicRoute, _post, _runner, _scripted_genie

RESPONSES = "/ai-gateway/mlflow/v1/responses"


class SlowRoute:
    """A fake Unity Gateway that streams SSE chunks with a pause before each one, and can drop the connection mid-stream."""

    def __init__(self, chunks=3, pause_s=0.0, die_after=None, pauses=None):
        route = self
        pauses = list(pauses) if pauses is not None else [pause_s] * chunks
        chunks = len(pauses)

        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args):
                pass

            def do_GET(self):
                data = b'{"data": []}'
                self.send_response(200)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_POST(self):
                self.rfile.read(int(self.headers.get("Content-Length") or 0))
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Transfer-Encoding", "chunked")
                self.end_headers()
                for index in range(chunks):
                    time.sleep(pauses[index])
                    if die_after is not None and index == die_after:
                        self.connection.shutdown(socket.SHUT_RDWR)
                        self.connection.close()
                        return
                    event = f"event: response.output_text.delta\ndata: {json.dumps({'n': index, 'pad': 'x' * 200})}\n\n".encode()
                    self.wfile.write(f"{len(event):x}\r\n".encode() + event + b"\r\n")
                    self.wfile.flush()
                done = b'event: response.completed\ndata: {"type": "response.completed"}\n\n'
                self.wfile.write(f"{len(done):x}\r\n".encode() + done + b"\r\n0\r\n\r\n")
                self.wfile.flush()

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def close(self):
        self.server.shutdown()
        self.server.server_close()


def _relay(ns, upstream, logger, **kw):
    relay = ns["GenieCodeRelay"](upstream, logger, **kw)
    relay.start()
    return relay


def _fired(logger):
    return [line for _level, line in logger.records if "[GENIE-RELAY FIRED]" in line]


def test_the_relay_listens_on_the_ipv6_loopback_first_and_its_base_is_a_valid_url(agent_ns):
    assert agent_ns["GENIE_RELAY_LOOPBACKS"][0] == "::1" and "127.0.0.1" in agent_ns["GENIE_RELAY_LOOPBACKS"]
    route = AnthropicRoute()
    relay = _relay(agent_ns, route.base, CapturingLogger(), loopback="::1")
    try:
        assert relay.base.startswith("http://[::1]:")
        assert _post(relay.base + RESPONSES, {"model": "m", "input": [USER]})[0] == 200
    finally:
        relay.stop()
        route.close()


class _RefusedV4:
    """What the serverless sandbox does to 127.0.0.1: the relay listens, but a process connecting to it is refused."""

    def __init__(self, ns):
        self.ns, self.made = ns, []

    def __call__(self, host, logger, loopback):
        self.made.append(loopback)
        if loopback == "127.0.0.1":
            probe = socket.socket()
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
            probe.close()
            return types.SimpleNamespace(base=f"http://127.0.0.1:{port}", stop=lambda: None)
        return self.ns["GenieCodeRelay"].shared(host, logger, loopback)


def test_a_sandbox_that_refuses_127_0_0_1_still_gets_genie_code_through_the_relay_on_the_ipv6_loopback(agent_ns, tmp_path):
    route = AnthropicRoute()
    factory = _RefusedV4(agent_ns)
    runner = _runner(agent_ns, tmp_path, route.base, _scripted_genie([(0, "")], []))
    runner.relay_factory = factory
    try:
        assert runner.run("build it", str(tmp_path / "w"))["exit"] == 0
        assert runner.relay is not None and not runner.relay_off
        base = tomllib.loads(runner.config_toml())["model_providers"]["databricks"]["base_url"]
        assert base.startswith("http://[::1]:") and base.endswith(agent_ns["UNITY_GATEWAY_MLFLOW_PATH"])
        assert factory.made == ["::1"]
        assert _post(base + "/responses", {"model": "m", "input": [USER]})[0] == 200, "a child process reaches the relay"
    finally:
        runner.relay.stop()
        route.close()


def test_a_sandbox_without_an_ipv6_loopback_falls_back_to_127_0_0_1_and_logs_why(agent_ns, tmp_path):
    route = AnthropicRoute()
    made = []

    def factory(host, logger, loopback):
        made.append(loopback)
        if loopback == "::1":
            raise OSError("Address family not supported by protocol")
        return agent_ns["GenieCodeRelay"].shared(host, logger, loopback)

    runner = _runner(agent_ns, tmp_path, route.base, _scripted_genie([(0, "")], []))
    runner.relay_factory = factory
    try:
        assert runner.run("build it", str(tmp_path / "w"))["exit"] == 0
        assert made == ["::1", "127.0.0.1"] and runner.relay.base.startswith("http://127.0.0.1:")
        said = [line for _level, line in runner.logger.records if line.startswith("[GENIE-RELAY] Genie Code calls")]
        assert len(said) == 1 and "Address family not supported" in said[0]
        assert not _fired(runner.logger), "a relay that works on 127.0.0.1 is not a failure"
    finally:
        runner.relay.stop()
        route.close()


def test_genie_code_and_the_relay_skip_any_proxy_for_both_loopbacks(agent_ns, tmp_path):
    env = _runner(agent_ns, tmp_path, "https://workspace.example.com", _scripted_genie([], [])).env()
    for key in ("NO_PROXY", "no_proxy"):
        assert {"::1", "127.0.0.1", "localhost"} <= set(env[key].split(","))


def test_a_slow_stream_inside_the_relay_timeout_reaches_genie_code_whole_and_logs_nothing(agent_ns):
    route = SlowRoute(chunks=3, pause_s=0.3)
    logger = CapturingLogger()
    relay = _relay(agent_ns, route.base, logger, timeout_s=5)
    try:
        status, text = _post(relay.base + RESPONSES, {"model": "m", "input": [USER]})
    finally:
        relay.stop()
        route.close()
    assert status == 200 and text.count("response.output_text.delta") == 3 and "response.completed" in text
    assert _fired(logger) == [], "a stream that completed is not logged as broken (must-exclude)"


def test_a_stream_that_pauses_past_the_relay_timeout_is_logged_with_class_bytes_time_and_status(agent_ns):
    route = SlowRoute(pauses=[0.0, 2.5])
    logger = CapturingLogger()
    relay = _relay(agent_ns, route.base, logger, timeout_s=1)
    try:
        status, text = _post(relay.base + RESPONSES, {"model": "m", "input": [USER]})
    finally:
        relay.stop()
        route.close()
    assert status == 200 and text.count("response.output_text.delta") == 1 and "response.completed" not in text
    fired = _fired(logger)
    assert len(fired) == 1, fired
    line = fired[0]
    assert "Unity Gateway side" in line and "(Unity Gateway status 200)" in line and "TimeoutError" in line
    relayed = int(line.split(" after ", 1)[1].split(" bytes", 1)[0])
    seconds = float(line.split(" bytes in ", 1)[1].split("s ", 1)[0])
    assert relayed > 200 and 0.9 <= seconds < 2.4, line


def test_an_upstream_that_drops_mid_stream_is_logged_on_the_gateway_side_with_the_bytes_already_relayed(agent_ns):
    route = SlowRoute(chunks=3, pause_s=0.05, die_after=2)
    logger = CapturingLogger()
    relay = _relay(agent_ns, route.base, logger)
    try:
        status, text = _post(relay.base + RESPONSES, {"model": "m", "input": [USER]})
    finally:
        relay.stop()
        route.close()
    assert status == 200 and text.count("response.output_text.delta") == 2 and "response.completed" not in text
    fired = _fired(logger)
    assert len(fired) == 1, fired
    line = fired[0]
    assert RESPONSES in line and "Unity Gateway side" in line and "status 200" in line
    relayed = int(line.split(" after ", 1)[1].split(" bytes", 1)[0])
    assert relayed >= 400, line
    assert "IncompleteRead" in line, line
    assert "stopped before Unity Gateway answered" not in " ".join(line for _l, line in logger.records)


def test_genie_code_hanging_up_mid_stream_is_logged_on_the_genie_code_side(agent_ns):
    route = SlowRoute(chunks=40, pause_s=0.05)
    logger = CapturingLogger()
    relay = _relay(agent_ns, route.base, logger)
    try:
        host, port = relay.base.rsplit(":", 1)
        family = socket.AF_INET6 if "[" in host else socket.AF_INET
        client = socket.socket(family, socket.SOCK_STREAM)
        client.connect((host.split("//", 1)[1].strip("[]"), int(port)))
        body = json.dumps({"model": "m", "input": [USER]}).encode()
        client.sendall(f"POST {RESPONSES} HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\n\r\n".encode()
                       + body)
        client.recv(512)
        client.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, b"\x01\x00\x00\x00\x00\x00\x00\x00")
        client.close()
        deadline = time.time() + 10
        while not _fired(logger) and time.time() < deadline:
            time.sleep(0.1)
    finally:
        relay.stop()
        route.close()
    fired = _fired(logger)
    assert len(fired) == 1 and "Genie Code side" in fired[0] and "status 200" in fired[0], fired


def test_a_request_the_relay_cannot_parse_is_logged_not_dropped_silently(agent_ns):
    logger = CapturingLogger()
    relay = _relay(agent_ns, "http://127.0.0.1:1", logger)
    try:
        host, port = relay.base.rsplit(":", 1)
        client = socket.create_connection((host.split("//", 1)[1].strip("[]"), int(port)), timeout=5)
        client.sendall(b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n")
        answer = client.recv(512)
        client.close()
    finally:
        relay.stop()
    assert b"505" in answer or b"400" in answer
    fired = _fired(logger)
    assert len(fired) == 1 and "HTTP/2.0" in fired[0], fired


def test_a_request_genie_code_cannot_send_to_the_relay_rechecks_it_and_goes_direct(agent_ns, tmp_path):
    lost = "stream disconnected before completion: error sending request for url (http://127.0.0.1:9/ai-gateway/mlflow/v1/responses)"
    prompts, probes = [], []
    runner = _runner(agent_ns, tmp_path, "https://workspace.example.com", _scripted_genie([(1, lost), (0, "")], prompts))
    runner.relay_factory = lambda host, logger, loopback: types.SimpleNamespace(base="http://127.0.0.1:9", stop=lambda: None)
    runner.relay_probe = lambda url, token, env: probes.append(url) or ("" if len(probes) == 1 else "Connection refused")
    assert runner.run("build it", str(tmp_path / "w"))["exit"] == 0
    assert len(probes) == 2 and runner.relay is None and runner.relay_off == "Connection refused"
    base = tomllib.loads(runner.config_toml())["model_providers"]["databricks"]["base_url"]
    assert base == "https://workspace.example.com" + agent_ns["UNITY_GATEWAY_MLFLOW_PATH"]
    fired = _fired(runner.logger)
    assert len(fired) == 1 and "directly from now on" in fired[0]


def test_a_stream_that_closed_for_another_reason_keeps_the_relay(agent_ns, tmp_path):
    other = "stream disconnected before completion: stream closed before response.completed"
    probes = []
    runner = _runner(agent_ns, tmp_path, "https://workspace.example.com", _scripted_genie([(1, other), (0, "")], []))
    runner.relay_factory = lambda host, logger, loopback: types.SimpleNamespace(base="http://127.0.0.1:9", stop=lambda: None)
    runner.relay_probe = lambda url, token, env: probes.append(url) or ""
    assert runner.run("build it", str(tmp_path / "w"))["exit"] == 0
    assert len(probes) == 1 and runner.relay is not None and not _fired(runner.logger), "must-exclude: no recheck, no switch"


class _BrokenStderr:
    def __iter__(self):
        yield "first line\n"
        raise OSError("Bad file descriptor")


def test_genie_code_error_output_that_stops_being_readable_is_logged(agent_ns, tmp_path):
    class Proc:
        def __init__(self):
            self.stdout = io.StringIO(json.dumps({"type": "turn.completed"}) + "\n")
            self.stderr = _BrokenStderr()
            self.pid = 0

        def wait(self):
            return 0

        def kill(self):
            pass

    runner = _runner(agent_ns, tmp_path, "https://workspace.example.com", lambda command, env=None, **kw: Proc())
    runner.relay_factory = lambda host, logger, loopback: None
    runner._run_once("build it", str(tmp_path / "w"), label="build")
    said = [line for _level, line in runner.logger.records if "reading Genie Code's error output stopped" in line]
    assert len(said) == 1 and "OSError" in said[0] and "after 1 line:" in said[0]


def test_a_final_live_log_flush_that_fails_is_logged(agent_ns, tmp_path):
    obj = make_inspire(agent_ns, inspire_database="", base_output_dir="/Shared/demos/tpcds_retail",
                       w_client=types.SimpleNamespace(workspace=FakeWorkspaceApi(), config=types.SimpleNamespace(host="")),
                       local_log_output_dir=str(tmp_path))
    calls = []

    def flush(src, dst, kind, state):
        calls.append(dst)
        raise OSError("quota exceeded")

    obj._flush_live_log_once = flush
    obj._start_live_log_flush_thread()
    obj._volume_log_stop.set()
    obj._volume_log_thread.join(timeout=15)
    final = [line for level, line in obj.logger.records if level == "WARNING" and "Live log final flush" in line]
    assert calls and len(final) >= 1 and "OSError" in final[0] and "quota exceeded" in final[0]
