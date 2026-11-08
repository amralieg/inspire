"""v2.2.0 Generate data picks a chat model this workspace serves.

The demo generator posted to one hard-coded model name, so it failed on every run of a workspace that did not serve it.
It now lists the ready chat endpoints, tries a named preference first and then the best listed model, moves on when a
model is not usable, waits out a rate limit with backoff and Retry-After, and says plainly when no chat model is served.
"""
import json
import pathlib

import pytest

APP = pathlib.Path(__file__).resolve().parents[3]
DEMO = APP / "dbx_generate_demo_data.py"


def _cell():
    cells = DEMO.read_text().split("# COMMAND ----------")
    found = [c for c in cells if "def _complete_with_chat_model(" in c]
    assert len(found) == 1
    return found[0]


@pytest.fixture
def gen():
    ns = {}
    exec(compile(_cell(), str(DEMO), "exec"), ns)
    return ns


class _Resp:
    def __init__(self, status, payload=None, text="", retry_after=None):
        self.status_code, self._payload, self.text = status, payload or {}, text or json.dumps(payload or {})
        self.headers = {"Retry-After": retry_after} if retry_after is not None else {}

    def json(self):
        return self._payload


def _answer(text):
    return _Resp(200, {"choices": [{"message": {"content": text}}]})


class _Http:
    def __init__(self, endpoints, replies):
        self.endpoints, self.replies, self.posted = endpoints, replies, []

    def get(self, url, headers=None, timeout=None):
        return _Resp(200, {"endpoints": self.endpoints})

    def post(self, url, headers=None, data=None, timeout=None):
        body = json.loads(data)
        self.posted.append((body["model"], body["max_tokens"]))
        queue = self.replies.get(body["model"]) or [_Resp(404, text="ENDPOINT_NOT_FOUND")]
        return queue.pop(0) if len(queue) > 1 else queue[0]


def _ep(name, task="llm/v1/chat", ready="READY"):
    return {"name": name, "task": task, "state": {"ready": ready}}


ENDPOINTS = [_ep("databricks-gpt-oss-20b"), _ep("databricks-claude-haiku-5-5"), _ep("databricks-claude-sonnet-5-5"),
             _ep("databricks-claude-opus-5-5"), _ep("databricks-gte-large-en", task="llm/v1/embeddings"),
             _ep("databricks-claude-sonnet-9", ready="NOT_READY")]


def test_the_newest_listed_claude_writes_the_data_and_no_model_name_is_hard_coded(gen):
    http = _Http(ENDPOINTS, {"databricks-claude-sonnet-5-5": [_answer('{"ok": 1}')]})
    assert gen["_complete_with_chat_model"]("https://h", "t", "p", http=http, sleep=lambda s: None) == '{"ok": 1}'
    assert http.posted == [("databricks-claude-sonnet-5-5", 65536)]
    assert "databricks-claude-sonnet-4" not in DEMO.read_text()


def test_the_listing_skips_embeddings_and_endpoints_that_are_not_ready(gen):
    listed = gen["_listed_chat_models"]("https://h", "t", _Http(ENDPOINTS, {}))
    assert listed[:3] == ["databricks-claude-sonnet-5-5", "databricks-claude-opus-5-5", "databricks-claude-haiku-5-5"]
    assert "databricks-gte-large-en" not in listed and "databricks-claude-sonnet-9" not in listed
    assert listed[-1] == "databricks-gpt-oss-20b"


def test_a_named_model_goes_first_and_an_unusable_one_falls_through(gen):
    http = _Http(ENDPOINTS, {"my-endpoint": [_Resp(403, text="PERMISSION_DENIED")],
                             "databricks-claude-sonnet-5-5": [_answer("x")]})
    assert gen["_complete_with_chat_model"]("https://h", "t", "p", preferred="my-endpoint", http=http,
                                            sleep=lambda s: None) == "x"
    assert [m for m, _ in http.posted] == ["my-endpoint", "databricks-claude-sonnet-5-5"]


def test_a_rate_limit_waits_with_retry_after_and_asks_the_same_model_again(gen):
    waits = []
    http = _Http(ENDPOINTS, {"databricks-claude-sonnet-5-5": [_Resp(429, retry_after="9"), _Resp(429), _answer("y")]})
    assert gen["_complete_with_chat_model"]("https://h", "t", "p", http=http, sleep=waits.append) == "y"
    assert waits[0] == 9.0 and 20.0 <= waits[1] <= 25.0
    assert [m for m, _ in http.posted] == ["databricks-claude-sonnet-5-5"] * 3


def test_a_model_that_refuses_the_output_size_is_asked_with_a_smaller_one(gen):
    http = _Http(ENDPOINTS, {"databricks-claude-sonnet-5-5": [_Resp(400, text="max_tokens is too large"), _answer("z")]})
    assert gen["_complete_with_chat_model"]("https://h", "t", "p", http=http, sleep=lambda s: None) == "z"
    assert http.posted == [("databricks-claude-sonnet-5-5", 65536), ("databricks-claude-sonnet-5-5", 32768)]


def test_no_served_chat_model_says_so(gen):
    with pytest.raises(RuntimeError, match="No chat model is served to this run"):
        gen["_complete_with_chat_model"]("https://h", "t", "p", http=_Http([_ep("e", task="llm/v1/embeddings")], {}),
                                         sleep=lambda s: None)


def test_every_model_failing_names_each_one_tried(gen):
    http = _Http([_ep("databricks-claude-sonnet-5-5"), _ep("databricks-gpt-oss-20b")], {})
    with pytest.raises(RuntimeError) as raised:
        gen["_complete_with_chat_model"]("https://h", "t", "p", http=http, sleep=lambda s: None)
    assert "databricks-claude-sonnet-5-5 (HTTP 404" in str(raised.value) and "databricks-gpt-oss-20b (HTTP 404" in str(raised.value)


def test_the_generator_routes_its_one_call_through_the_chooser():
    text = DEMO.read_text()
    assert "raw = _complete_with_chat_model(host, token, prompt, chat_model)" in text
    assert text.count("/serving-endpoints/chat/completions") == 1
