"""v2.2.0 the generated App asks a rate-limited workspace again, and never guesses a chat model it was not shown.

Every call of the App shell goes through `Workspace.call`. A 429, and a 503 on a read, now waits with backoff, jitter and
the Retry-After the service names, then asks again. With no listed chat model the App used two hard-coded model names;
it now says no chat model is available, and an empty listing is not kept for ten minutes.
"""
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_agent  # noqa: E402
import shell_db  # noqa: E402


class _Response:
    def __init__(self, status, payload=None, retry_after=None):
        self.status_code = status
        self._payload = payload or {}
        self.headers = {"Retry-After": retry_after} if retry_after is not None else {}
        self.content = b"{}"
        self.text = "{}"

    def json(self):
        return self._payload if self.status_code < 400 else {"message": "REQUEST_LIMIT_EXCEEDED"}


class _Session:
    def __init__(self, responses):
        self.responses, self.sent = list(responses), []

    def request(self, method, url, **kw):
        self.sent.append((method, url))
        return self.responses.pop(0)


def _ws(responses):
    waits = []
    ws = shell_db.Workspace("dbc-1.example.com", lambda: {"Authorization": "Bearer x"}, session=_Session(responses),
                            sleep=waits.append)
    return ws, waits


def test_a_rate_limited_call_waits_what_the_service_asks_and_asks_again():
    ws, waits = _ws([_Response(429, retry_after="3"), _Response(429), _Response(200, {"ok": 1})])
    assert ws.call("POST", "/serving-endpoints/chat/completions", {"model": "m"}) == {"ok": 1}
    assert len(ws.session.sent) == 3 and waits[0] == 3.0 and 4.0 <= waits[1] <= 5.0


def test_a_busy_read_is_asked_again_but_a_busy_write_is_not():
    ws, waits = _ws([_Response(503), _Response(200, {"ok": 1})])
    assert ws.call("GET", "/api/2.0/serving-endpoints") == {"ok": 1} and len(waits) == 1
    ws, waits = _ws([_Response(503)])
    with pytest.raises(shell_db.QueryError, match="HTTP 503"):
        ws.call("POST", "/api/2.0/genie/spaces/s/start-conversation", {"content": "q"})
    assert waits == [] and len(ws.session.sent) == 1


def test_a_call_that_stays_rate_limited_ends_with_the_429_after_the_attempts():
    ws, waits = _ws([_Response(429) for _ in range(shell_db.BUSY_ATTEMPTS)])
    with pytest.raises(shell_db.QueryError, match="HTTP 429"):
        ws.call("GET", "/api/2.0/serving-endpoints")
    assert len(ws.session.sent) == shell_db.BUSY_ATTEMPTS and len(waits) == shell_db.BUSY_ATTEMPTS - 1
    assert all(w <= shell_db.BUSY_MAX_DELAY_S for w in waits)


def test_other_errors_are_not_asked_again():
    ws, waits = _ws([_Response(404)])
    with pytest.raises(shell_db.QueryError, match="HTTP 404"):
        ws.call("GET", "/api/2.0/serving-endpoints")
    assert waits == []


def test_busy_delay_honours_retry_after_and_caps_it():
    assert shell_db.busy_delay(1, "7") == 7.0
    assert shell_db.busy_delay(1, "999") == shell_db.BUSY_MAX_DELAY_S
    assert shell_db.busy_delay(2, "", rng=lambda: 0.0) == 4.0
    assert shell_db.busy_delay(2, "soon", rng=lambda: 1.0) == 5.0


class _NoModels:
    def __init__(self):
        self.calls = []

    def call(self, method, path, body=None, params=None, timeout=60):
        self.calls.append((method, path, (body or {}).get("model")))
        if path == shell_agent.GATEWAY_MODELS:
            return {"data": []}
        if path == shell_agent.SERVING_LIST:
            return {"endpoints": []}
        raise AssertionError(f"a chat call went to a model nobody listed: {body}")


class _Shell:
    settings = {}

    def service(self):
        raise shell_db.HttpError(503, "no service principal")


def test_with_no_listed_model_the_app_never_guesses_one_and_does_not_keep_the_empty_list():
    agent = shell_agent.Agent(_Shell(), executor=object())
    ws = _NoModels()
    with pytest.raises(shell_db.HttpError) as raised:
        agent.complete(ws, "user", shell_agent.Turn("user", ""), {"messages": []})
    assert raised.value.code == "no_model"
    assert not any(model for _m, _p, model in ws.calls)
    assert "user" not in agent.models_seen
    assert not hasattr(shell_agent, "DEFAULT_MODELS")
