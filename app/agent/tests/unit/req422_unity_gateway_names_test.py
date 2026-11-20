"""REQ-422: a workspace with Enforce Unity Gateway on refuses the Databricks-provided pay-per-token endpoints
(databricks-<model>). Under enforcement the callable name of a Databricks-hosted model is its Unity Gateway model
service, system.ai.<model>, which ai_query routes through Unity Gateway. The roster probes that name first, keeps
the databricks- name only where the workspace has no model service, and the stop message names the grants, not
pay-per-token. An endpoint or model name in an error is not a data value and stays visible.

Cited in the REQ-422 commit and report (Unity Gateway migration and ai_query pages).
"""
import logging
import types

import pytest

CUSTOMER_REFUSAL = ("[INTERNAL_ERROR] Remote session creation failed: PERMISSION_DENIED: PERMISSION_DENIED: Querying "
                    "pay-per-token foundation model endpoint '{name}' is disabled for this workspace. Please use Unity Gateway.")
SERVICE_DENIED = ("[INTERNAL_ERROR] PERMISSION_DENIED: User does not have EXECUTE on model service 'system.ai.{model}'.")
DETECTED = [
    {"name": "claude-sonnet-4-6", "order": 1, "type": "worker", "size": "large", "enabled": True,
     "llm_endpoint_name": "databricks-claude-sonnet-4-6", "llm_input_context_tokens_count": 200000,
     "llm_output_context_tokens_count": 64000, "family": "claude-sonnet", "version": "4.6"},
    {"name": "gpt-oss-20b", "order": 2, "type": "worker", "size": "tiny", "enabled": True,
     "llm_endpoint_name": "databricks-gpt-oss-20b", "llm_input_context_tokens_count": 131072,
     "llm_output_context_tokens_count": 25000, "family": "gpt-oss-20b", "version": "unknown"},
]


class RecordingLogger:
    def __init__(self):
        self.messages = []

    def _add(self, level, message, *args, **kwargs):
        self.messages.append((level, str(message)))

    def info(self, message, *a, **k):
        self._add("info", message)

    def warning(self, message, *a, **k):
        self._add("warning", message)

    def error(self, message, *a, **k):
        self._add("error", message)

    def debug(self, message, *a, **k):
        self._add("debug", message)


class GatewaySpark:
    """Fake Spark. `refuse_foundation` makes every databricks- name fail with the customer's enforcement refusal.
    `services` says whether the system.ai model services answer. Every ai_query statement is recorded."""

    def __init__(self, refuse_foundation=True, services=True, service_refusal=None):
        self.calls = []
        self.refuse_foundation = refuse_foundation
        self.services = services
        self.service_refusal = service_refusal

    def _endpoint(self, query):
        marker = "ai_query('"
        start = query.find(marker)
        return query[start + len(marker):query.find("'", start + len(marker))] if start >= 0 else ""

    def sql(self, query, args=None):
        self.calls.append((query, dict(args or {})))
        name = self._endpoint(query)
        if name.startswith("databricks-") and self.refuse_foundation:
            raise RuntimeError(CUSTOMER_REFUSAL.format(name=name))
        if name.startswith("system.ai."):
            if self.service_refusal:
                raise RuntimeError(self.service_refusal.format(model=name[len("system.ai."):]))
            if not self.services:
                raise RuntimeError(f"[TABLE_OR_VIEW_NOT_FOUND] The table or view '{name}' cannot be found.")
        return types.SimpleNamespace(collect=lambda: [types.SimpleNamespace(ai_response="OK")])

    def names_queried(self):
        return [self._endpoint(q) for q, _ in self.calls]


@pytest.fixture
def roster(agent_ns, monkeypatch):
    """A fresh health tracker and roster per test, with the endpoint listing stubbed to DETECTED."""
    monkeypatch.setitem(agent_ns, "LLM_ENDPOINT_HEALTH", agent_ns["_LLMEndpointHealth"]())
    monkeypatch.setitem(agent_ns, "_auto_detect_llm_endpoints", lambda logger, max_endpoints=6: [dict(m) for m in DETECTED])
    monkeypatch.setitem(agent_ns, "_list_fast_chat_endpoints", lambda logger: [])
    monkeypatch.setitem(agent_ns["TECHNICAL_CONTEXT"], "models", [dict(m) for m in DETECTED])
    monkeypatch.setitem(agent_ns["TECHNICAL_CONTEXT"], "prompts_models", [])
    return agent_ns


def _names(models):
    return [m["llm_endpoint_name"] for m in models]


def test_system_model_service_name_maps_only_databricks_hosted_names(agent_ns):
    fn = agent_ns["system_model_service_name"]
    assert fn("databricks-claude-sonnet-4-6") == "system.ai.claude-sonnet-4-6"
    assert fn("databricks-gpt-oss-120b") == "system.ai.gpt-oss-120b"
    assert fn("system.ai.claude-sonnet-4-6") == "", "a name already on the model service is not rewritten"
    assert fn("databricks-") == "", "a bare prefix names no model"
    assert fn("my-team-sonnet-proxy") == "", "a workspace endpoint has no model service"


def test_roster_uses_the_system_ai_name_when_the_workspace_enforces_unity_gateway(roster):
    """Fail-pre: the roster kept databricks- names, every one was refused, and the run stopped with no model."""
    spark = GatewaySpark(refuse_foundation=True, services=True)
    roster["_apply_auto_detected_endpoints"](logging.getLogger("req422"), spark)
    assert _names(roster["TECHNICAL_CONTEXT"]["models"]) == ["system.ai.claude-sonnet-4-6", "system.ai.gpt-oss-20b"]
    assert roster["no_usable_model_message"]() == "", "a usable model means no stop message"
    assert not any(n.startswith("databricks-") for n in spark.names_queried()[-2:]), \
        "after the system.ai name answers, the databricks- name is not called again"


def test_the_model_service_is_probed_before_the_refused_pay_per_token_name_and_the_refusal_reason_is_kept(roster):
    """Fail-pre: nothing probed system.ai, so the refused databricks- name was the only candidate."""
    spark = GatewaySpark(refuse_foundation=True, services=True, service_refusal=SERVICE_DENIED)
    roster["_apply_auto_detected_endpoints"](logging.getLogger("req422"), spark)
    assert spark.names_queried()[:2] == ["system.ai.claude-sonnet-4-6", "system.ai.gpt-oss-20b"], "the model service is probed first"
    selectable = [m for m in roster["TECHNICAL_CONTEXT"]["models"] if roster["_model_is_selectable"](m)]
    assert selectable == [], "neither name answered, so no model is selectable"
    spark2 = GatewaySpark(refuse_foundation=True, services=False)
    roster["LLM_ENDPOINT_HEALTH"] = roster["_LLMEndpointHealth"]()
    roster["_apply_auto_detected_endpoints"](logging.getLogger("req422"), spark2)
    reason = roster["LLM_ENDPOINT_HEALTH"].unusable_reason("databricks-claude-sonnet-4-6")
    assert reason and "disabled for this workspace" in reason and "Unity Gateway" in reason, reason


def test_a_workspace_without_unity_gateway_still_runs_on_the_databricks_names(roster):
    """Must-keep: no model service answers, so the databricks- name stays in the roster and is used."""
    spark = GatewaySpark(refuse_foundation=False, services=False)
    roster["_apply_auto_detected_endpoints"](logging.getLogger("req422"), spark)
    assert _names(roster["TECHNICAL_CONTEXT"]["models"]) == ["databricks-claude-sonnet-4-6", "databricks-gpt-oss-20b"]
    assert roster["no_usable_model_message"]() == ""


def test_when_neither_name_answers_the_stop_message_names_the_grants_and_never_says_pay_per_token(roster):
    """Fail-pre: the advice said to turn on pay-per-token, which is the wrong fix under enforcement."""
    spark = GatewaySpark(refuse_foundation=True, services=True, service_refusal=SERVICE_DENIED)
    roster["_apply_auto_detected_endpoints"](logging.getLogger("req422"), spark)
    message = roster["no_usable_model_message"]()
    assert message, "no model can be called, so the run stops"
    assert "Enforce Unity Gateway" in message or "Unity Gateway" in message
    assert "EXECUTE on system.ai.claude-sonnet-4-6" in message
    assert "USE CATALOG on system" in message and "USE SCHEMA on system.ai" in message
    assert "grants update model_service system.ai.claude-sonnet-4-6" in message, "the CLI grant is named"
    assert "GRANT USE CATALOG ON CATALOG system" in message and "GRANT USE SCHEMA ON SCHEMA system.ai" in message, "the SQL grants are named"
    assert "turn on pay-per-token" not in message.lower()


def test_the_redactor_keeps_a_model_or_endpoint_name_in_an_error(agent_ns):
    """Fail-pre: the name came back as 'a data value', so the person could not see which endpoint was disabled."""
    err = RuntimeError(CUSTOMER_REFUSAL.format(name="databricks-claude-sonnet-4-6"))
    text = agent_ns["redact_error"](err)
    assert "databricks-claude-sonnet-4-6" in text, text
    assert "a data value" not in text.split("disabled")[0], text


def test_the_redactor_still_hides_a_real_data_value_quoted_next_to_the_word_endpoint(agent_ns):
    """Must-keep: a quoted data value is still redacted, even in an error that mentions an endpoint."""
    text = agent_ns["redact_error"](RuntimeError("the endpoint refused the value 'Acme Holdings Ltd' for this column"))
    assert "Acme Holdings Ltd" not in text, text
    text2 = agent_ns["redact_error"](RuntimeError("the endpoint 'customer_orders' is disabled for this workspace"))
    assert "customer_orders" not in text2, "a table-like value is not a model name and stays redacted"


def test_the_calibrated_elite_judge_pin_still_matches_the_resolved_system_ai_name(agent_ns, monkeypatch):
    """Fail-pre: the pin is configured as databricks-claude-opus-4-8, the roster holds its model service, and the equality
    check dropped the calibrated judge, so the pin fell to the first healthy model."""
    import threading
    monkeypatch.setitem(agent_ns, "LLM_ENDPOINT_HEALTH", agent_ns["_LLMEndpointHealth"]())
    monkeypatch.setitem(agent_ns["TECHNICAL_CONTEXT"], "models", [
        {"name": "claude-sonnet-4-6", "order": 1, "type": "thinker", "size": "large", "enabled": True,
         "llm_endpoint_name": "system.ai.claude-sonnet-4-6"},
        {"name": "claude-opus-4-8", "order": 2, "type": "thinker", "size": "large", "enabled": True,
         "llm_endpoint_name": "system.ai.claude-opus-4-8"},
    ])
    monkeypatch.setitem(agent_ns["TECHNICAL_CONTEXT"], "prompts_models", [
        {"prompt_name": "ULTRA_HIGH_ELITE_JUDGE_PROMPT", "model_type": "thinker", "model_size": "large"}])
    monkeypatch.setitem(agent_ns["TECHNICAL_CONTEXT"]["runtime"], "elite_judge_preferred_endpoints", ["databricks-claude-opus-4-8"])
    fake_agent = types.SimpleNamespace(_ELITE_JUDGE_PIN_LOCK=threading.Lock(), logger=logging.getLogger("req422"))
    picked = agent_ns["DatabricksInspire"]._pinned_elite_judge(fake_agent)
    assert picked == "system.ai.claude-opus-4-8", picked
    assert agent_ns["_model_names_match"]("databricks-claude-opus-4-8", "system.ai.claude-opus-4-8")
    assert not agent_ns["_model_names_match"]("databricks-claude-opus-4-8", "system.ai.claude-sonnet-4-6")
    assert not agent_ns["_model_names_match"]("databricks-claude-opus-4-8", "databricks-claude-opus-4-7")
