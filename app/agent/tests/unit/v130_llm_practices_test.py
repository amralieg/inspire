"""v1.3.0 LLM-calling practices adopted from Semunity: AIMD concurrency on throttles, a context budget
before sending, temperature 0 for grading prompts, strict JSON response format only where the probe
proved it, and offline record and replay from _ailogs."""
import json
import logging
import re
import threading
import time

import pytest

from replay import MissingRecording, ReplaySpark, load_ailogs
from v120_runtime_llm_client_test import FakeSpark as LlmSpark, _agent
from v120_runtime_reliability_test import FakeConnectSpark, RecordingLogger, make_agent, use_roster

SLOW, NEXT = "databricks-claude-opus-5-5", "databricks-claude-opus-4-8"

GRADING = ("COMBINED_VALUE_QUALITY_SCORE_PROMPT", "BEST_OF_BEST_SCORING_PROMPT", "ULTRA_HIGH_ELITE_JUDGE_PROMPT",
           "REVIEW_USE_CASES_PROMPT", "GOAL_ALIGNMENT_FILTER_PROMPT", "GENERAL_INSTRUCTION_INTERPRETER_PROMPT",
           "Assign_User_Domains", "STRATEGY_ALIGNMENT_PROMPT")


def test_aimd_halves_once_per_burst_and_recovers_one_slot_per_ten_successes(agent_ns):
    limit = agent_ns["AdaptiveConcurrencyLimit"](20, 4)
    epoch = limit.epoch
    assert limit.on_throttle(epoch) is True and limit.limit == 10
    assert limit.on_throttle(epoch) is False and limit.limit == 10, "a second throttle of the same burst is ignored"
    assert limit.on_throttle(limit.epoch) is True and limit.limit == 5
    limit.on_throttle(limit.epoch)
    limit.on_throttle(limit.epoch)
    assert limit.limit == 4, "never below the floor"
    for _ in range(9):
        limit.on_success()
    assert limit.limit == 4
    limit.on_success()
    assert limit.limit == 5
    full = agent_ns["AdaptiveConcurrencyLimit"](3, 4)
    assert full.floor == 3 and full.limit == 3


def test_aimd_limit_gates_acquire_like_a_bounded_semaphore(agent_ns):
    limit = agent_ns["AdaptiveConcurrencyLimit"](2, 1)
    assert limit.acquire(blocking=False) and limit.acquire(blocking=False)
    assert not limit.acquire(blocking=False)
    assert limit.acquire(timeout=0.05) is False
    limit.release()
    assert limit.acquire(timeout=0.5) is True
    limit.release()
    limit.release()
    with pytest.raises(ValueError):
        limit.release()
    limit.on_throttle(limit.epoch)
    assert limit.limit == 1 and limit.acquire(blocking=False) and not limit.acquire(blocking=False)


def test_throttled_call_halves_the_manager_limit(agent_ns, monkeypatch):
    monkeypatch.setitem(agent_ns, "_cancellable_sleep", lambda seconds: False)
    state = {"n": 0}

    def responder(query, args):
        state["n"] += 1
        if state["n"] == 1:
            raise RuntimeError("429 Too Many Requests: REQUEST_LIMIT_EXCEEDED")
        return "ok"
    agent = agent_ns["AIAgent"](spark=LlmSpark(responder=responder), logger=logging.getLogger("v130_aimd"),
                                prompt_templates={"T": "{x}"},
                                default_timeout_seconds=30, max_retry_attempts=1)
    before = agent._manager._semaphore.limit
    assert agent._call_ai_query("hi", "T") == "ok"
    assert agent._manager._semaphore.limit == max(agent._manager._semaphore.floor, before // 2)


def test_context_budget_caps_batches_and_the_send(agent_ns):
    get_for_model = agent_ns["get_context_limit_chars_for_model"]
    budget = agent_ns["context_budget_chars"]
    model = {"llm_input_context_tokens_count": 200000}
    assert budget(200000) == int(200000 * 0.45 * 3.2) == get_for_model(model)
    assert agent_ns["get_max_context_chars"]("English", "BASE_USE_CASE_GEN_PROMPT") <= budget(200000)


def test_a_prompt_over_the_budget_is_never_sent(agent_ns):
    spark = LlmSpark(responder=lambda q, a: "ok")
    agent = _agent(agent_ns, spark)
    smallest = min(m["llm_input_context_tokens_count"] for m in agent_ns["TECHNICAL_CONTEXT"]["models"])
    huge = "x" * int(agent_ns["context_budget_chars"](max(m["llm_input_context_tokens_count"]
                                                          for m in agent_ns["TECHNICAL_CONTEXT"]["models"])) + 100)
    with pytest.raises(agent_ns["InputTooLongError"]):
        agent._call_ai_query(huge, "T")
    assert spark.calls == [] and smallest > 0


def test_grading_and_classification_prompts_run_at_temperature_zero(agent_ns):
    temperature = agent_ns["_get_prompt_temperature"]
    for name in GRADING:
        assert temperature(name) == 0.0, name
    assert temperature("BASE_USE_CASE_GEN_PROMPT") == 0.25 and temperature("SUMMARY_GEN_PROMPT") == 0.5


def test_json_format_is_sent_only_where_the_probe_proved_it(fresh_ns):
    health = fresh_ns["LLM_ENDPOINT_HEALTH"]
    agent = _agent(fresh_ns, LlmSpark())
    model = {"llm_endpoint_name": "databricks-json", "llm_output_context_tokens_count": 1000}
    params = agent._llm_request_params(model, "COMBINED_VALUE_QUALITY_SCORE_PROMPT")
    assert params[2] == "", "no strict format before the endpoint passed the probe"
    calls = []

    def responder(query, args):
        calls.append(query)
        return '[{"ok": true}]' if "responseFormat" in query else "OK"
    assert fresh_ns["_probe_llm_endpoint"](LlmSpark(responder=responder), "databricks-json", logging.getLogger("p")) == "usable"
    assert health.accepts_json_format("databricks-json") and len(calls) == 2
    fmt = json.loads(agent._llm_request_params(model, "COMBINED_VALUE_QUALITY_SCORE_PROMPT")[2])
    assert fmt == {"type": "json_schema", "json_schema": {"name": "json_array", "schema": {
        "type": "object", "properties": {"results": {"type": "array", "items": {"type": "object"}}}, "required": ["results"]}}}
    assert agent._llm_request_params(model, "BASE_USE_CASE_GEN_PROMPT")[2] == "", "CSV prompts never get it"
    assert "json_format" in health.snapshot()

    def prose(query, args):
        return "Sure! Here is the array: [ ok ]" if "responseFormat" in query else "OK"
    fresh_ns["_probe_llm_endpoint"](LlmSpark(responder=prose), "databricks-prose", logging.getLogger("p"))
    assert not health.accepts_json_format("databricks-prose")


def test_a_runtime_format_rejection_falls_back_to_todays_request(fresh_ns):
    health = fresh_ns["LLM_ENDPOINT_HEALTH"]
    sent = []

    def responder(query, args):
        sent.append("responseFormat" in query)
        if "responseFormat" in query:
            raise RuntimeError("INVALID_PARAMETER_VALUE: response_format json_schema is not supported by this model")
        return '[{"use_case_id": "U1"}]'
    agent = _agent(fresh_ns, LlmSpark(responder=responder))
    first = agent._manager.build_full_cascade("COMBINED_VALUE_QUALITY_SCORE_PROMPT")[0]["llm_endpoint_name"]
    health.mark_json_format(first, True)
    out = agent._call_ai_query("score these", "COMBINED_VALUE_QUALITY_SCORE_PROMPT")
    assert out == '[{"use_case_id": "U1"}]' and sent == [True, False]
    assert not health.accepts_json_format(first)


def _claude_like(answer):
    def responder(query, args):
        if "responseFormat" in query:
            schema = json.loads(args["resp_fmt"])["json_schema"]["schema"]
            if schema.get("type") != "object":
                raise RuntimeError('BAD_REQUEST: {"message":"tools.0.custom.input_schema.type: Input should be \'object\'"}')
            return answer
        return "OK"
    return responder


def test_claude_endpoints_pass_the_probe_and_their_wrapped_arrays_are_unwrapped(fresh_ns):
    health = fresh_ns["LLM_ENDPOINT_HEALTH"]
    probe = _claude_like('{"results": [{"ok": true}]}')
    assert fresh_ns["_probe_llm_endpoint"](LlmSpark(responder=probe), "databricks-claude-x", logging.getLogger("p")) == "usable"
    assert health.accepts_json_format("databricks-claude-x"), "an object-rooted schema is accepted where an array root was refused"
    spark = LlmSpark(responder=_claude_like('{"results": [{"use_case_id": "U1", "score": 4}]}'))
    agent = _agent(fresh_ns, spark)
    first = agent._manager.build_full_cascade("COMBINED_VALUE_QUALITY_SCORE_PROMPT")[0]["llm_endpoint_name"]
    health.mark_json_format(first, True)
    out = agent._call_ai_query("score these", "COMBINED_VALUE_QUALITY_SCORE_PROMPT")
    assert json.loads(out) == [{"use_case_id": "U1", "score": 4}]
    [(query, args)] = spark.calls
    assert "responseFormat" in query and json.loads(args["resp_fmt"])["json_schema"]["schema"]["type"] == "object"
    unwrap = fresh_ns["unwrap_json_array_response"]
    for text in ('[{"a": 1}]', '{"other": [1]}', '{"results": "not a list"}', "not json", ""):
        assert unwrap(text) == text, text


def _max_tokens(query):
    return int(re.search(r"named_struct\('max_tokens', (\d+)", query).group(1))


def test_the_json_probe_leaves_claude_room_to_write_the_object(fresh_ns):
    health = fresh_ns["LLM_ENDPOINT_HEALTH"]

    def responder(query, args):
        if "responseFormat" in query:
            return "{}" if _max_tokens(query) < 64 else '{"results": [{"ok": true}]}'
        return "OK"
    spark = LlmSpark(responder=responder)
    assert fresh_ns["_probe_llm_endpoint"](spark, "databricks-claude-y", logging.getLogger("p")) == "usable"
    assert health.accepts_json_format("databricks-claude-y"), "with 16 tokens Claude returns {} and the probe wrongly fails"
    sent = {("json" if "responseFormat" in q else "plain"): _max_tokens(q) for q, _a in spark.calls}
    assert sent == {"plain": 16, "json": 128}


def _probe_row(text):
    return [type("Row", (), {"ai_response": text})()]


def test_the_json_check_waits_at_most_twenty_seconds_and_logs_every_first_decision(fresh_ns, monkeypatch, caplog):
    health = fresh_ns["LLM_ENDPOINT_HEALTH"]
    waits = {}

    def send(spark, endpoint, logger, prompt_text, response_format=None, timeout_seconds=None, max_output_tokens=16):
        if response_format is None:
            return _probe_row("OK")
        waits[endpoint] = timeout_seconds
        if endpoint == "ep-refused":
            raise RuntimeError(STRUCTURED_OUTPUT_REFUSED)
        if endpoint == "ep-slow":
            raise fresh_ns["SparkWorkTimeout"]("probe ep-slow", 20.4, timeout_seconds, "inspire_probe_x")
        if endpoint == "ep-prose":
            return _probe_row("Sure, here it is")
        return _probe_row('{"results": [{"ok": true}]}')

    monkeypatch.setitem(fresh_ns, "_probe_send", send)
    endpoints = ("ep-refused", "ep-slow", "ep-prose", "ep-json")
    with caplog.at_level(logging.INFO):
        for endpoint in endpoints:
            assert fresh_ns["_probe_llm_endpoint"](object(), endpoint, logging.getLogger("p")) == "usable"
    assert waits == dict.fromkeys(endpoints, 20), "the JSON check runs on a warm endpoint and never waits 60 s"
    lines = [r.getMessage() for r in caplog.records if "[JSON_FORMAT" in r.getMessage()]
    assert len(lines) == 4, lines
    assert lines[0].startswith("[JSON_FORMAT DISABLED] endpoint=ep-refused source=startup probe")
    assert "(the endpoint refused it: " in lines[0] and "Structured output is not supported for this model" in lines[0]
    assert lines[1].startswith("[JSON_FORMAT DISABLED] endpoint=ep-slow") and lines[1].endswith("(no answer within 20 s)")
    assert lines[2].startswith("[JSON_FORMAT DISABLED] endpoint=ep-prose") and lines[2].endswith("(its answer was not a JSON array)")
    assert lines[3].startswith("[JSON_FORMAT ENABLED] endpoint=ep-json") and lines[3].endswith("format there")
    assert [ep for ep in endpoints if health.accepts_json_format(ep)] == ["ep-json"]
    caplog.clear()
    with caplog.at_level(logging.INFO):
        health.mark_json_format("ep-refused", False, logging.getLogger("p"), source="later call", reason="again")
        health.mark_json_format("ep-json", True, logging.getLogger("p"), source="later call")
    assert "[JSON_FORMAT" not in caplog.text, "a decision that does not change is logged only the first time"
    with caplog.at_level(logging.INFO):
        health.mark_json_format("ep-json", False, logging.getLogger("p"), source="STRATEGY_ALIGNMENT_PROMPT call")
    assert "[JSON_FORMAT DISABLED] endpoint=ep-json source=STRATEGY_ALIGNMENT_PROMPT call" in caplog.text


def test_an_endpoint_whose_check_did_not_finish_says_strict_json_is_off(fresh_ns, monkeypatch, caplog):
    def send(spark, endpoint, logger, prompt_text, response_format=None, timeout_seconds=None, max_output_tokens=16):
        raise fresh_ns["SparkWorkTimeout"]("probe ep-cold", 60.2, 60, "inspire_probe_y")

    monkeypatch.setitem(fresh_ns, "_probe_send", send)
    with caplog.at_level(logging.INFO):
        assert fresh_ns["_probe_llm_endpoint"](object(), "ep-cold", logging.getLogger("p")) == "inconclusive"
    assert ("[JSON_FORMAT DISABLED] endpoint=ep-cold source=startup probe: the JSON prompts do not use a strict JSON "
            "response format there (its endpoint check did not finish)") in caplog.text
    assert not fresh_ns["LLM_ENDPOINT_HEALTH"].accepts_json_format("ep-cold")


def test_a_strict_answer_without_the_array_is_sent_again_without_the_format(fresh_ns):
    health = fresh_ns["LLM_ENDPOINT_HEALTH"]
    sent = []

    def responder(query, args):
        sent.append("responseFormat" in query)
        return "{}" if "responseFormat" in query else '[{"use_case_id": "U1", "score": 3}]'
    agent = _agent(fresh_ns, LlmSpark(responder=responder))
    first = agent._manager.build_full_cascade("STRATEGY_ALIGNMENT_PROMPT")[0]["llm_endpoint_name"]
    health.mark_json_format(first, True)
    assert json.loads(agent._call_ai_query("align these", "STRATEGY_ALIGNMENT_PROMPT")) == [{"use_case_id": "U1", "score": 3}]
    assert sent == [True, False] and not health.accepts_json_format(first)
    is_array = fresh_ns["is_json_array_text"]
    assert is_array('[{"a": 1}]') and is_array("```json\n[]\n```") and not is_array("{}") and not is_array("") and not is_array(None)


def test_only_real_context_overflows_are_treated_as_too_long(agent_ns):
    overflow = agent_ns["is_context_overflow_error"]
    for message in ("BAD_REQUEST: prompt is too long: 213000 tokens > 200000 maximum",
                    "BAD_REQUEST: Input is too long for requested model.",
                    "This model's maximum context length is 128000 tokens",
                    '{"error": {"code": "context_length_exceeded"}}',
                    "[BAD_REQUEST] 400 the input exceeds what this model accepts"):
        assert overflow(message), message
    for message in ('BAD_REQUEST: {"message":"tools.0.custom.input_schema.type: Input should be \'object\'"}',
                    "[BAD_REQUEST] Invalid parameter: max_tokens (22500) cannot exceed 8192 for this model.",
                    "BAD_REQUEST: The model does not support the parameter(s): temperature.",
                    "INVALID_PARAMETER_VALUE: response_format json_schema is not supported by this model",
                    STRUCTURED_OUTPUT_REFUSED.replace("Job aborted", "[BAD_REQUEST] 400 Job aborted"),
                    "PERMISSION_DENIED: user cannot query this endpoint", "", None):
        assert not overflow(message), message


STRUCTURED_OUTPUT_REFUSED = ("Job aborted due to stage failure: org.apache.spark.SparkException: INVALID_PARAMETER_VALUE: "
                             "INVALID_PARAMETER_VALUE: Structured output is not supported for this model because its "
                             "translation requires forced tool use")
ROLE_SCHEMA = {"name": "role_canonicalization", "schema": {"type": "object", "properties": {"roles": {"type": "array"}},
                                                           "required": ["roles"]}}


def test_an_endpoint_that_times_out_three_times_follows_the_others_for_the_rest_of_the_run(fresh_ns):
    use_roster(fresh_ns, SLOW, NEXT)
    health, log = fresh_ns["LLM_ENDPOINT_HEALTH"], RecordingLogger()
    full = lambda: fresh_ns["get_full_fallback_cascade"]("BASE_USE_CASE_GEN_PROMPT")
    names = lambda models: [m["llm_endpoint_name"] for m in models]
    assert fresh_ns["TECHNICAL_CONTEXT"]["runtime"]["llm_endpoint_demote_after_timeouts"] == 3
    assert names(full()) == [SLOW, NEXT]
    assert health.record_timeout(SLOW, log, source="BASE_USE_CASE_GEN_PROMPT") is False
    assert health.record_timeout(SLOW, log, source="BASE_USE_CASE_GEN_PROMPT") is False
    assert names(full()) == [SLOW, NEXT], "two timeouts leave the order alone"
    assert health.record_timeout(SLOW, log, source="BASE_USE_CASE_GEN_PROMPT") is True
    assert names(full()) == [NEXT, SLOW], "the demoted endpoint stays in the cascade, last"
    assert health.record_timeout(SLOW, log, source="SUMMARY_GEN_PROMPT") is False
    fired = log.matching("[LLM_ENDPOINT_DEMOTED FIRED]", "WARNING")
    assert len(fired) == 1 and SLOW in fired[0] and "3 times" in fired[0]
    assert names(fresh_ns["cascade_from_model"](full(), SLOW)) == [SLOW], "an explicit start model is honored"
    assert health.snapshot()["demoted"] == [SLOW]
    assert health.record_timeout(NEXT, log) is False and names(full()) == [NEXT, SLOW]


def test_after_three_timeouts_new_calls_start_on_the_next_endpoint_and_never_wait_on_the_slow_one(fresh_ns):
    use_roster(fresh_ns, SLOW, NEXT)
    real, tried = fresh_ns["_run_tagged_spark_work"], []

    def slow_endpoint_times_out(spark, fn, timeout_seconds=None, tag_prefix=None, label=None, on_wait=None, logger=None):
        endpoint = fn.__defaults__[0]
        tried.append(endpoint)
        if endpoint == SLOW:
            raise fresh_ns["SparkWorkTimeout"](label, 2.0, timeout_seconds, "t")
        return real(spark, fn, timeout_seconds=timeout_seconds, tag_prefix=tag_prefix, label=label, on_wait=on_wait,
                    logger=logger)
    fresh_ns["_run_tagged_spark_work"] = slow_endpoint_times_out
    log = RecordingLogger()
    agent = make_agent(fresh_ns, FakeConnectSpark(lambda op: "ok"), log)
    for i in range(3):
        assert agent._call_ai_query(f"generate batch {i}", "BASE_USE_CASE_GEN_PROMPT") == "ok"
    assert tried == [SLOW, NEXT] * 3
    assert agent._call_ai_query("score batch", "COMBINED_VALUE_QUALITY_SCORE_PROMPT") == "ok"
    assert tried[6:] == [NEXT], "later calls of any prompt start on the next endpoint"
    assert len(log.matching("[LLM_ENDPOINT_DEMOTED FIRED]", "WARNING")) == 1


def test_an_explicit_response_schema_is_sent_only_where_the_probe_proved_json_format(fresh_ns):
    health = fresh_ns["LLM_ENDPOINT_HEALTH"]
    agent = _agent(fresh_ns, LlmSpark())
    model = {"llm_endpoint_name": "databricks-no-json", "llm_output_context_tokens_count": 1000}
    params = agent._llm_request_params(model, "canonicalize_sponsor_beneficiary_roles", ROLE_SCHEMA)
    assert params[2] == "", "an endpoint the probe did not clear gets the plain request, whatever the caller's schema"
    assert "response_format=|" not in params[3] and params[3].endswith("response_format=")
    health.mark_json_format("databricks-no-json", True)
    fmt = json.loads(agent._llm_request_params(model, "canonicalize_sponsor_beneficiary_roles", ROLE_SCHEMA)[2])
    assert fmt == {"type": "json_schema", "json_schema": ROLE_SCHEMA}, "a cleared endpoint gets the caller's own schema"


def test_a_structured_output_refusal_with_an_explicit_schema_is_sent_again_on_the_same_endpoint(fresh_ns):
    health = fresh_ns["LLM_ENDPOINT_HEALTH"]
    sent = []

    def responder(query, args):
        sent.append((re.search(r"ai_query\('([^']+)'", query).group(1), "responseFormat" in query))
        if "responseFormat" in query:
            raise RuntimeError(STRUCTURED_OUTPUT_REFUSED)
        return '{"roles": [{"input": "CFO", "canonical": "Chief Financial Officer"}]}'
    agent = _agent(fresh_ns, LlmSpark(responder=responder))
    first = agent._manager.build_full_cascade("canonicalize_sponsor_beneficiary_roles")[0]["llm_endpoint_name"]
    health.mark_json_format(first, True)
    out = agent._call_ai_query("normalize these roles", "canonicalize_sponsor_beneficiary_roles", response_schema=ROLE_SCHEMA)
    assert json.loads(out)["roles"][0]["canonical"] == "Chief Financial Officer"
    assert sent == [(first, True), (first, False)], "the refusal is retried without the format, not cascaded"
    assert not health.accepts_json_format(first)


def test_a_runtime_input_schema_rejection_also_falls_back_to_todays_request(fresh_ns, caplog):
    health = fresh_ns["LLM_ENDPOINT_HEALTH"]
    sent = []

    def responder(query, args):
        sent.append("responseFormat" in query)
        if "responseFormat" in query:
            raise RuntimeError('BAD_REQUEST: {"message":"tools.0.custom.input_schema.properties: Field required"}')
        return '[{"use_case_id": "U1"}]'
    agent = _agent(fresh_ns, LlmSpark(responder=responder))
    first = agent._manager.build_full_cascade("BEST_OF_BEST_SCORING_PROMPT")[0]["llm_endpoint_name"]
    health.mark_json_format(first, True)
    with caplog.at_level(logging.DEBUG):
        assert agent._call_ai_query("rank these", "BEST_OF_BEST_SCORING_PROMPT") == '[{"use_case_id": "U1"}]'
    assert sent == [True, False] and not health.accepts_json_format(first)
    assert not any("Input too long" in record.getMessage() for record in caplog.records)


def test_an_endpoint_whose_probe_did_not_finish_follows_the_probed_ones_in_every_cascade(fresh_ns, caplog):
    health = fresh_ns["LLM_ENDPOINT_HEALTH"]
    models = [{"llm_endpoint_name": "ep-new", "order": 1}, {"llm_endpoint_name": "ep-a", "order": 2},
              {"llm_endpoint_name": "ep-b", "order": 3}, {"llm_endpoint_name": "ep-unprobed", "order": 4}]
    for endpoint, outcome in (("ep-new", "inconclusive"), ("ep-a", "usable"), ("ep-b", "usable")):
        health.record_probe_outcome(endpoint, outcome)
    with caplog.at_level(logging.INFO):
        ranked = fresh_ns["_order_models_by_probe"](models, logging.getLogger("p"))
    assert [(m["llm_endpoint_name"], m["order"]) for m in ranked] == [
        ("ep-a", 1), ("ep-b", 2), ("ep-unprobed", 3), ("ep-new", 4)]
    assert "before the 1 endpoint whose startup probe did not finish" in caplog.text and "ep-new" in caplog.text
    steady = [{"llm_endpoint_name": "ep-a", "order": 5}, {"llm_endpoint_name": "ep-b", "order": 7}]
    assert fresh_ns["_order_models_by_probe"](steady, logging.getLogger("p")) is steady
    assert [m["order"] for m in steady] == [5, 7], "no inconclusive probe, so the roster is left as it was"


def test_the_probe_pass_records_each_outcome_and_the_roster_setup_orders_by_it(fresh_ns, monkeypatch):
    import ast
    from _agentload import top_level_defs

    outcomes = {"ep-slow": "inconclusive", "ep-ok": "usable", "ep-denied": "unusable"}
    monkeypatch.setitem(fresh_ns, "_probe_llm_endpoint", lambda spark, endpoint, logger: outcomes[endpoint])
    fresh_ns["_probe_llm_endpoints"](object(), list(outcomes), logging.getLogger("p"))
    health = fresh_ns["LLM_ENDPOINT_HEALTH"]
    assert {ep: health.probe_outcome(ep) for ep in outcomes} == outcomes
    setup = top_level_defs()["_apply_auto_detected_endpoints"]
    calls = [n for n in ast.walk(setup) if isinstance(n, ast.Call) and getattr(n.func, "id", "") == "_order_models_by_probe"]
    assert calls, "the roster setup must order the cascade by probe outcome"


def test_record_and_replay_serves_recorded_responses_by_request_hash(agent_ns, monkeypatch):
    recorder = agent_ns["AILogRecorder"]()
    rows = []
    recorder.attach(1, rows.append)
    monkeypatch.setitem(agent_ns, "AILOG_RECORDER", recorder)
    live = _agent(agent_ns, LlmSpark(responder=lambda q, a: f"answer to {a['prompt_text'][-5:]}"))
    recorded = [live._call_ai_query(f"question {i}", "T") for i in range(3)]
    replay_spark = ReplaySpark(load_ailogs(rows))
    replayed = _agent(agent_ns, replay_spark)
    assert [replayed._call_ai_query(f"question {i}", "T") for i in range(3)] == recorded
    assert len(replay_spark.served) == 3 and replay_spark.missing == []
    with pytest.raises(Exception):
        replayed._call_ai_query("never asked", "T")
    assert replay_spark.missing, "an unrecorded request is refused, never sent anywhere"
    assert isinstance(MissingRecording("x"), LookupError)
