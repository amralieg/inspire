"""c35_loadgw: the endpoint load test must call models through Unity Gateway by default."""
import inspect
import os
import sys

SCRIPTS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts")
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)

import endpoint_load_test as elt  # noqa: E402

MODEL = "system.ai.claude-sonnet-4-6"


class _Api:
    def __init__(self, exc=None):
        self.calls, self.exc = [], exc

    def do(self, method, path, body=None, **kw):
        self.calls.append((method, path, body))
        if self.exc:
            raise self.exc
        return {}


class _Serving:
    def __init__(self):
        self.calls = []

    def query(self, **kw):
        self.calls.append(kw)


class _Ws:
    def __init__(self, exc=None):
        self.api_client = _Api(exc)
        self.serving_endpoints = _Serving()


def test_gateway_route_posts_messages_with_model_id():
    ws = _Ws()
    elt.make_call(ws, MODEL, "gateway")()
    method, path, body = ws.api_client.calls[0]
    assert (method, path) == ("POST", "/ai-gateway/anthropic/v1/messages")
    assert body["model"] == MODEL and body["max_tokens"] == 8
    assert body["messages"] == [{"role": "user", "content": elt.PROMPT}]
    assert ws.serving_endpoints.calls == []


def test_gateway_429_counts_as_rate_limited():
    assert elt._is_rate_limited(Exception("429 Too Many Requests"))
    assert elt._is_rate_limited(Exception("REQUEST_LIMIT_EXCEEDED: slow down"))
    ws = _Ws(exc=Exception("REQUEST_LIMIT_EXCEEDED"))
    stats = elt.run_level(elt.make_call(ws, MODEL, "gateway"), 1, 5, max_calls=3)
    assert stats["rate_limit_errors"] == 3 and stats["other_errors"] == 0


def test_default_route_is_gateway():
    assert inspect.signature(elt.make_call).parameters["route"].default == "gateway"
    assert inspect.signature(elt.run_load).parameters["route"].default == "gateway"
    ws = _Ws()
    elt.make_call(ws, MODEL)()
    assert ws.api_client.calls and not ws.serving_endpoints.calls


def test_serving_route_still_uses_serving_endpoints_query():
    ws = _Ws()
    elt.make_call(ws, "ep", "serving")()
    assert ws.serving_endpoints.calls[0]["name"] == "ep"
    assert ws.api_client.calls == []
