"""v1.4.0 UI-6 and UI-7: a workspace where no AI model can be called stops the run at once with one message naming
what was tried, Unity Gateway and provisioned chat endpoints are found and used, and a Discover run that ends with
no use case fails with its reason instead of finishing green.
"""
import logging
import os
import sys
import types
from unittest.mock import patch

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from conftest import FakeServingEndpoint, FakeWorkspaceClient  # noqa: E402
from v120_runtime_reliability_test import FakeConnectSpark, RecordingLogger  # noqa: E402
from v120_run_offline_smoke_test import _build, quiet_root_logger  # noqa: E402,F401

GATEWAY_REFUSAL = ("[INTERNAL_ERROR] Remote session creation failed: PERMISSION_DENIED: PERMISSION_DENIED: Querying "
                   "pay-per-token foundation model endpoint '{ep}' is disabled for this workspace. Please use Unity "
                   "Gateway. SQLSTATE: XX000")


def refuse_pay_per_token(op):
    if op["endpoint"].startswith("databricks-"):
        raise RuntimeError(GATEWAY_REFUSAL.format(ep=op["endpoint"]))
    return "OK"


class GatewayWorkspace(FakeWorkspaceClient):
    def __init__(self, listing, slugs=None, gateway_error=None):
        super().__init__(listing)
        calls = self.gateway_calls = []

        class _Api:
            @staticmethod
            def do(method, path, **kwargs):
                calls.append((method, path))
                if gateway_error is not None:
                    raise gateway_error
                return {"models": [{"slug": s, "display_name": s} for s in (slugs or [])]}

        self.api_client = _Api()


def workspace(*args, **kwargs):
    client = GatewayWorkspace(*args, **kwargs)
    return client, (lambda *a, **k: client)


def roster(ns):
    return [m["llm_endpoint_name"] for m in ns["TECHNICAL_CONTEXT"]["models"]]


# ---------------------------------------------------------------- UI-6 no usable model


def test_no_callable_model_names_every_model_tried_and_what_the_admin_must_enable(fresh_ns):
    spark, log = FakeConnectSpark(refuse_pay_per_token), RecordingLogger()
    _client, factory = workspace([], slugs=[])
    with patch("databricks.sdk.WorkspaceClient", factory):
        assert fresh_ns["_apply_auto_detected_endpoints"](log, spark_session=spark) is False
    enabled = roster(fresh_ns)
    assert enabled and all(not fresh_ns["LLM_ENDPOINT_HEALTH"].is_usable(ep) for ep in enabled)
    message = fresh_ns["no_usable_model_message"]()
    assert message.startswith("No AI model can be called from this workspace, so the run stopped")
    for ep in enabled:
        assert ep in message
    assert "Please use Unity Gateway" in message and "Unity Gateway or a provisioned throughput endpoint" in message
    with pytest.raises(fresh_ns["NoUsableModelError"]) as err:
        fresh_ns["raise_if_no_usable_model"](log, "business context")
    assert str(err.value) == message
    assert log.matching("[NO_USABLE_MODEL FIRED] at business context", "ERROR")


def test_one_callable_model_keeps_the_run_going(fresh_ns):
    spark, log = FakeConnectSpark(lambda op: "OK"), RecordingLogger()
    _client, factory = workspace([], slugs=[])
    with patch("databricks.sdk.WorkspaceClient", factory):
        fresh_ns["_apply_auto_detected_endpoints"](log, spark_session=spark)
    assert fresh_ns["no_usable_model_message"]() == ""
    fresh_ns["raise_if_no_usable_model"](log, "business context")


def test_an_inconclusive_probe_is_not_a_stop(fresh_ns):
    health = fresh_ns["LLM_ENDPOINT_HEALTH"]
    models = [{"llm_endpoint_name": "databricks-a", "enabled": True}, {"llm_endpoint_name": "databricks-b", "enabled": True}]
    health.mark_unusable("databricks-a", "refused")
    health.record_probe_outcome("databricks-b", "inconclusive")
    assert fresh_ns["no_usable_model_message"](models) == ""
    health.mark_unusable("databricks-b", "refused too")
    assert "databricks-a: refused; databricks-b: refused too" in fresh_ns["no_usable_model_message"](models)


def test_a_disabled_model_does_not_count_as_callable(fresh_ns):
    health = fresh_ns["LLM_ENDPOINT_HEALTH"]
    health.mark_unusable("databricks-a", "refused")
    models = [{"llm_endpoint_name": "databricks-a", "enabled": True}, {"llm_endpoint_name": "databricks-off", "enabled": False}]
    assert "databricks-a" in fresh_ns["no_usable_model_message"](models)
    assert "databricks-off" not in fresh_ns["no_usable_model_message"](models)


def test_the_run_records_a_failed_step_and_stops_before_any_work(fresh_ns):
    emitted = []
    cls = fresh_ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = logging.getLogger("v140_model_stop")
    obj.no_usable_model = "No AI model can be called from this workspace, so the run stopped before it used any. Tried 1 model"
    obj._emit_pipeline_status = lambda **kw: emitted.append(kw)
    with pytest.raises(fresh_ns["NoUsableModelError"]):
        obj._stop_without_usable_model()
    assert [(e["step_name"], e["status"], e["message"]) for e in emitted] == [
        ("AI model check", "ended_error", obj.no_usable_model)]
    obj.no_usable_model = ""
    emitted.clear()
    obj._stop_without_usable_model()
    assert emitted == []


def agent_source():
    import json
    from _nbload import AGENT_NB
    with open(AGENT_NB, encoding="utf-8") as fh:
        return "".join(json.load(fh)["cells"][1]["source"])


def test_the_stop_runs_right_after_the_pipeline_start_step():
    src = agent_source()
    start = src.index('message="Inspire pipeline started"')
    assert src.index("self._stop_without_usable_model()", start) < src.index("_db_setup_step_id = ", start)
    assert "self.no_usable_model = no_usable_model_message()" in src


# ---------------------------------------------------------------- UI-6 gateway and provisioned endpoints


def test_a_unity_gateway_model_is_found_and_used_when_pay_per_token_is_off(fresh_ns):
    spark, log = FakeConnectSpark(refuse_pay_per_token), RecordingLogger()
    client, factory = workspace([], slugs=["system.ai.claude-opus-4-6", "system.ai.claude-sonnet-4-5", "system.ai.glm-5-3"])
    with patch("databricks.sdk.WorkspaceClient", factory):
        assert fresh_ns["_apply_auto_detected_endpoints"](log, spark_session=spark) is True
    assert ("GET", "/ai-gateway/codex/v1/models") in client.gateway_calls
    assert roster(fresh_ns)[:2] == ["system.ai.claude-opus-4-6", "system.ai.claude-sonnet-4-5"]
    assert "system.ai.glm-5-3" not in roster(fresh_ns), "a gateway model outside every known family stays out"
    assert fresh_ns["no_usable_model_message"]() == ""
    assert fresh_ns["get_model_endpoint_for_prompt"]("BASE_USE_CASE_GEN_PROMPT").startswith("system.ai.claude-")
    assert spark.ops_for("system.ai.claude-opus-4-6")


def test_a_provisioned_chat_endpoint_is_named_by_the_model_it_serves(fresh_ns):
    listing = [
        FakeServingEndpoint("acme-reasoning-pt", entity_kind="custom"),
        FakeServingEndpoint("acme-batch-scorer", task=None, entity_kind="custom"),
        FakeServingEndpoint("acme-embeddings", task="llm/v1/embeddings", entity_kind="custom"),
    ]
    listing[0].config.served_entities = [{"external_model": {"name": "claude-opus-4-6"}}]
    listing[1].config.served_entities = [{"entity_name": "claude-opus-4-7"}]
    listing[2].config.served_entities = [{"foundation_model": {"name": "claude-opus-4-8"}}]
    spark, log = FakeConnectSpark(lambda op: "OK"), RecordingLogger()
    _client, factory = workspace(listing, slugs=[])
    with patch("databricks.sdk.WorkspaceClient", factory):
        assert fresh_ns["_apply_auto_detected_endpoints"](log, spark_session=spark) is True
    assert roster(fresh_ns) == ["acme-reasoning-pt"]
    assert fresh_ns["TECHNICAL_CONTEXT"]["models"][0]["version"] == "4.6"


def test_a_workspace_without_a_gateway_still_detects_hosted_endpoints(fresh_ns):
    spark, log = FakeConnectSpark(lambda op: "OK"), RecordingLogger()
    _client, factory = workspace([FakeServingEndpoint("databricks-claude-opus-4-6")],
                                 gateway_error=RuntimeError("Not Found"))
    with patch("databricks.sdk.WorkspaceClient", factory):
        assert fresh_ns["_apply_auto_detected_endpoints"](log, spark_session=spark) is True
    assert roster(fresh_ns) == ["databricks-claude-opus-4-6"]
    assert log.matching("[LLM_ENDPOINT_GATEWAY] Unity Gateway model list unavailable")


def test_a_client_without_an_api_client_lists_no_gateway_route(fresh_ns):
    assert fresh_ns["_unity_gateway_routes"](types.SimpleNamespace(), RecordingLogger()) == []


def test_genie_code_and_detection_share_one_gateway_path():
    src = agent_source()
    assert src.count('"/ai-gateway/codex/v1"') == 1
    assert "{UNITY_GATEWAY_CODEX_PATH}" in src


# ---------------------------------------------------------------- UI-7 zero use cases


def _scorer(uc_id):
    return {"use_case_id": uc_id, "quality_label": "High", "quality_score": 4.0, "priority_score": 7.0}


def test_a_discover_run_whose_generation_returns_nothing_fails_with_its_reason(fresh_ns, tmp_path, quiet_root_logger):
    obj = _build(fresh_ns, tmp_path, "Good", {"High", "Very High"}, _scorer)
    obj._process_batch_with_retry = lambda *a, **kw: []
    with pytest.raises(fresh_ns["NoUseCasesError"]) as err:
        obj.run()
    assert str(err.value).startswith("Discovery read the tables but produced no use cases: every use case generation "
                                     "call failed or returned nothing")
    assert fresh_ns["inspire_failure_kind"](err.value) == "no_use_cases"
    assert obj.recorded["docs"] == [] and obj.recorded["tracking"] == []


def test_zero_use_cases_with_every_model_refused_fails_as_no_model(fresh_ns, tmp_path, quiet_root_logger):
    for model in fresh_ns["TECHNICAL_CONTEXT"]["models"]:
        fresh_ns["LLM_ENDPOINT_HEALTH"].mark_unusable(model["llm_endpoint_name"], "Please use Unity Gateway")
    obj = _build(fresh_ns, tmp_path, "Good", {"High", "Very High"}, _scorer)
    obj._process_batch_with_retry = lambda *a, **kw: []
    with pytest.raises(fresh_ns["NoUsableModelError"]) as err:
        obj.run()
    assert fresh_ns["inspire_failure_kind"](err.value) == "no_model"


def _finished(ns, use_cases=0, bar=None, operation="Discover Use Cases", json_path=None):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = logging.getLogger("v140_empty")
    obj.operation = operation
    obj.json_file_path = json_path
    obj.quality_bar_outcome = bar
    obj.final_inspire_results_json = {"domains": [{"domain_name": "Sales", "use_cases": [{"No": f"N01-U0{i}"} for i in range(use_cases)]}]}
    return obj


def test_the_end_of_run_guard_fails_a_discover_run_with_no_use_case(fresh_ns):
    with pytest.raises(fresh_ns["NoUseCasesError"]) as err:
        _finished(fresh_ns).raise_if_empty_discovery()
    assert "no use case survived generation and the checks after it" in str(err.value)


@pytest.mark.parametrize("kwargs", [
    {"use_cases": 1},
    {"bar": {"mode": "High", "found": 6, "meets": 0}},
    {"operation": "Generate Use Cases"},
    {"json_path": "/Volumes/c/s/v/catalog.json"},
])
def test_the_end_of_run_guard_lets_real_outcomes_through(fresh_ns, kwargs):
    _finished(fresh_ns, **kwargs).raise_if_empty_discovery()


def test_a_bar_that_found_nothing_is_still_a_failure(fresh_ns):
    with pytest.raises(fresh_ns["NoUseCasesError"]):
        _finished(fresh_ns, bar={"mode": "High", "found": 0, "meets": 0}).raise_if_empty_discovery()


def test_main_runs_the_guard_before_the_success_finalize():
    src = agent_source()
    run_at = src.index("        inspirer.run()\n")
    assert src.index("inspirer.raise_if_empty_discovery()", run_at) < src.index("inspirer.finalize_atomic_writer(success=True)", run_at)
    assert "failure_kind=inspire_failure_kind(e)" in src
    assert 'self.logger.warning("No use cases were generated from any batch. Skipping all generation.")' not in src


def _outcome_obj(ns):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = logging.getLogger("v140_outcome")
    obj.final_inspire_results_json = {}
    obj.failed_steps, obj.translation_gaps, obj.document_font_fallbacks = [], {}, {}
    obj.data_loader = None
    obj.processing_honesty = None
    obj.quality_bar_outcome = None
    obj.discovery_evidence = None
    obj.deep_evidence = None
    return obj


def test_a_failed_run_never_writes_run_status_success(fresh_ns):
    obj = _outcome_obj(fresh_ns)
    assert obj._merge_run_outcome_into_results()["run_status"] == "success"
    obj.run_failure = {"message": "Discovery found nothing to analyze in the UC metadata (schemas: c.s): no table with "
                                  "columns was found.", "kind": "no_tables"}
    results = obj._merge_run_outcome_into_results()
    assert results["run_status"] == "failed"
    assert results["run_failure_kind"] == "no_tables"
    assert results["run_message"].startswith("Discovery found nothing to analyze")


def test_finalize_on_failure_records_the_failure_before_merging(fresh_ns):
    obj = _outcome_obj(fresh_ns)
    obj._close_ailogs_safely = lambda: None
    obj.atomic_writer = None
    obj.finalize_atomic_writer(success=False, error_message="No AI model can be called", failure_kind="no_model")
    assert obj.run_failure == {"message": "No AI model can be called", "kind": "no_model"}
    assert obj._merge_run_outcome_into_results()["run_failure_kind"] == "no_model"


# ---------------------------------------------------------------- empty schema keeps its own outcome


def test_an_empty_schema_fails_as_no_tables_with_its_honest_message(fresh_ns, tmp_path, quiet_root_logger):
    from v130_empty_discovery_test import empty_run
    obj = empty_run(fresh_ns, tmp_path)
    with pytest.raises(fresh_ns["NothingToDiscoverError"]) as err:
        obj.run()
    assert "no table with columns was found" in str(err.value)
    assert fresh_ns["inspire_failure_kind"](err.value) == "no_tables"
    assert fresh_ns["inspire_failure_kind"](RuntimeError("other")) == "error"
