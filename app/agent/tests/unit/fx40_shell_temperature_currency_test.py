"""FX-40: the App shell's model calls survive models that reject `temperature`, and the value sentence reads clean (D4)."""
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_agent  # noqa: E402
import shell_db  # noqa: E402
from v120_artifacts_support import make_uc  # noqa: E402


class _Client:
    """A workspace whose chat models answer HTTP 400 for any body that carries `temperature`."""

    def __init__(self):
        self.bodies = []

    def call(self, method, path, body=None, timeout=None):
        if method == "GET":
            return {"data": [{"id": "claude-new-1"}]} if path == shell_agent.GATEWAY_MODELS else {}
        self.bodies.append(dict(body or {}))
        if "temperature" in (body or {}):
            raise shell_db.QueryError("POST /serving-endpoints/chat/completions answered HTTP 400: temperature is not supported for this model")
        return {"choices": [{"message": {"role": "assistant", "content": "OK"}}], "usage": {"total_tokens": 1}}


class _Shell:
    settings = {"agent": {"models": []}}

    def service(self):
        raise shell_agent.HttpError(503, "no service")


@pytest.fixture
def agent():
    return shell_agent.Agent(_Shell())


@pytest.mark.parametrize("body", [
    {"messages": [], "max_tokens": 2, "temperature": 0},
    {"messages": [], "max_tokens": 900, "temperature": 0.2},
    {"messages": [], "max_tokens": 900, "temperature": 0.7},
])
def test_a_call_that_gets_a_temperature_400_is_retried_once_without_it(agent, body):
    client = _Client()
    turn = shell_agent.Turn("u", "")
    message = agent.complete(client, "u", turn, dict(body))
    assert message["content"] == "OK"
    assert len(client.bodies) == 2, client.bodies
    assert "temperature" not in client.bodies[1]


def test_an_endpoint_that_rejected_temperature_is_remembered(agent):
    client = _Client()
    agent.complete(client, "u", shell_agent.Turn("u", ""), {"messages": [], "temperature": 0})
    client.bodies.clear()
    agent.complete(client, "u", shell_agent.Turn("u", ""), {"messages": [], "temperature": 0.7})
    assert len(client.bodies) == 1 and "temperature" not in client.bodies[0]


# ---- D4: the value sentence ----

@pytest.fixture
def ns(agent_ns):
    return agent_ns


def _kpi(ns, value, window=365):
    baseline = {"value": value, "window_days": window, "measured_on": "2026-11-01", "window_anchor": ns["KPI_WINDOW_ANCHOR"]}
    return {"name": "Weekly sales value", "unit": "", "direction": "increase", "aggregation": "SUM", "table": "c.s.orders",
            "column": "amount", "computable": True, "query": "SELECT 1", "window_days": window, "baseline": baseline}


def _short(ns, monkeypatch, value, **widgets):
    monkeypatch.setitem(ns, "INSPIRE_SETTINGS_APPLIED", widgets)
    uc = make_uc("N01-U01", KPIs=[_kpi(ns, value)], use_case_kind="forecast")
    return ns["inspire_value_estimate"](uc, "", "predict", ns["inspire_use_case_kind"](uc))["short"]


def test_a_default_reporting_currency_has_no_nested_parentheses(ns, monkeypatch):
    short = _short(ns, monkeypatch, 29589.0 * 4, currency="USD", currency_default="true")
    assert "((" not in short and "))" not in short and "(default))" not in short, short
    assert short.endswith("(currency USD, default)"), short


def test_an_assumed_reporting_currency_has_no_nested_parentheses(ns, monkeypatch):
    short = _short(ns, monkeypatch, 29589.0 * 4, currency="AED", currency_default="false")
    assert "((" not in short and "))" not in short, short


def test_both_ends_of_a_range_use_the_same_precision(ns, monkeypatch):
    short = _short(ns, monkeypatch, 5_150_000.0, currency="USD", currency_default="true")
    assert short.startswith("USD 103K-"), short
    assert "." not in short.split(" a year")[0], short
