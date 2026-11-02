import json
import os
import sys
import threading
import time
import types

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from v120_funnel_integrity_test import make_inspire, make_uc  # noqa: E402
from v120_runtime_reliability_test import FakeConnectSpark, RecordingLogger, make_agent, use_roster  # noqa: E402

FIRST = "databricks-claude-opus-4-8"
LAST = "databricks-claude-opus-4-7"
SHIFTED = "use_case_id,name\nA,Forecast\nForecast demand,C\n"
CLEAN = "use_case_id\nA\nC\n"


def scorer(ns, floor=None):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = RecordingLogger()
    if floor is not None:
        obj._STRAGGLER_FLOOR_SECONDS = floor
    return obj


def ucs_n(n):
    return [{"No": f"U{i}"} for i in range(n)]


def ids(batch):
    return [u["No"] for u in batch]


def wait_or_cancel(ns, seconds):
    end = time.time() + seconds
    while time.time() < end:
        if ns["_is_thread_cancelled"]():
            raise RuntimeError("cancelled")
        time.sleep(0.01)


def test_a_batch_slower_than_the_straggler_budget_is_scored_on_retry_with_the_full_timeout(agent_ns):
    obj = scorer(agent_ns, floor=0.2)
    attempts, lock = {}, threading.Lock()

    def score(label, batch, skip_cache):
        if {"U8", "U9"} & set(ids(batch)):
            with lock:
                for i in ids(batch):
                    attempts[i] = attempts.get(i, 0) + 1
            wait_or_cancel(agent_ns, 0.5)
        else:
            time.sleep(0.02)
        return {i: {"ok": True} for i in ids(batch)}

    scores, unscored = obj._score_with_split_retry(ucs_n(10), score, 2, "Test", per_task_timeout=5)
    assert unscored == {} and set(scores) == {f"U{i}" for i in range(10)}
    assert attempts == {"U8": 2, "U9": 2}


def test_a_timed_out_batch_is_retried_in_halves(agent_ns):
    obj = scorer(agent_ns)
    sizes, lock = [], threading.Lock()

    def score(label, batch, skip_cache):
        with lock:
            sizes.append((skip_cache, len(batch)))
        if not skip_cache:
            wait_or_cancel(agent_ns, 5)
        return {i: {"ok": True} for i in ids(batch)}

    scores, unscored = obj._score_with_split_retry(ucs_n(4), score, 4, "Test", per_task_timeout=0.3)
    assert unscored == {} and len(scores) == 4
    assert sorted(size for retried, size in sizes if retried) == [2, 2]


def test_a_batch_that_never_answers_stops_after_the_configured_rounds(agent_ns):
    obj = scorer(agent_ns)
    rounds = agent_ns["TECHNICAL_CONTEXT"]["runtime"]["scoring_split_retry_rounds"]
    attempts, lock = {}, threading.Lock()

    def score(label, batch, skip_cache):
        with lock:
            for i in ids(batch):
                attempts[i] = attempts.get(i, 0) + 1
        wait_or_cancel(agent_ns, 5)
        return {}

    start = time.time()
    scores, unscored = obj._score_with_split_retry(ucs_n(4), score, 4, "Test", per_task_timeout=0.2)
    assert scores == {} and set(unscored) == {"U0", "U1", "U2", "U3"}
    assert all("TimeoutError" in reason for reason in unscored.values())
    assert set(attempts.values()) == {rounds + 1}
    assert time.time() - start < (rounds + 1) * 0.2 + 2.0


def test_an_unusable_answer_after_a_timeout_still_gets_its_one_corrective_retry(agent_ns):
    obj = scorer(agent_ns)
    attempts, lock = {}, threading.Lock()

    def score(label, batch, skip_cache):
        with lock:
            for i in ids(batch):
                attempts[i] = attempts.get(i, 0) + 1
            seen = attempts[ids(batch)[0]]
        if seen == 1:
            wait_or_cancel(agent_ns, 5)
        if seen == 2:
            return {}
        return {i: {"ok": True} for i in ids(batch)}

    scores, unscored = obj._score_with_split_retry(ucs_n(4), score, 4, "Test", per_task_timeout=0.3)
    assert unscored == {} and len(scores) == 4
    assert set(attempts.values()) == {3}


def test_an_invalid_answer_still_stops_after_one_empty_retry_and_is_not_split(agent_ns):
    obj = scorer(agent_ns)
    calls = []

    def score(label, batch, skip_cache):
        calls.append((len(batch), skip_cache))
        return {}

    scores, unscored = obj._score_with_split_retry(ucs_n(4), score, 4, "Test", per_task_timeout=30)
    assert scores == {} and set(unscored) == {"U0", "U1", "U2", "U3"}
    assert calls == [(4, False), (4, True)]


def test_a_timeout_raised_by_the_scorer_is_retried_in_halves(agent_ns):
    obj = scorer(agent_ns)
    sizes, lock = [], threading.Lock()

    def score(label, batch, skip_cache):
        with lock:
            sizes.append(len(batch))
        if len(batch) > 1:
            raise Exception("LLM call timed out after 600 seconds (model: claude-opus-4-8)")
        return {batch[0]["No"]: {"ok": True}}

    scores, unscored = obj._score_with_split_retry(ucs_n(4), score, 4, "Test", per_task_timeout=30)
    assert unscored == {} and len(scores) == 4
    assert sorted(sizes) == [1, 1, 1, 1, 2, 2, 4]


def test_a_scorer_failure_that_is_not_a_timeout_still_stops_after_one_empty_retry(agent_ns):
    obj = scorer(agent_ns)
    sizes = []

    def score(label, batch, skip_cache):
        sizes.append(len(batch))
        raise RuntimeError("endpoint returned 500")

    scores, unscored = obj._score_with_split_retry(ucs_n(4), score, 4, "Test", per_task_timeout=30)
    assert scores == {} and len(unscored) == 4
    assert sizes == [4, 4]


def worker_agent(ns, log, failure):
    agent = make_agent(ns, FakeConnectSpark(lambda op: "ok"), log)
    statuses = []
    agent._emit_status = lambda **kw: statuses.append(kw["status"])
    agent._build_started_status = lambda *a, **k: ("started", {})
    agent._load_and_format_prompt = lambda *a, **k: "prompt"

    def fail(*a, **k):
        raise failure

    agent._call_ai_query = fail
    return agent, statuses


def test_a_worker_its_parent_cancelled_is_a_warning_and_not_a_failed_step(fresh_ns):
    log = RecordingLogger()
    agent, statuses = worker_agent(fresh_ns, log, Exception("[P] Cascade aborted: parent task was cancelled/timed out"))
    cancel, raised = threading.Event(), []
    cancel.set()

    def run():
        fresh_ns["_register_thread_cancel"](cancel)
        try:
            agent.run_worker("BoB_R0B1", "BEST_OF_BEST_SCORING_PROMPT", {}, None)
        except Exception as exc:
            raised.append(exc)
        finally:
            fresh_ns["_unregister_thread_cancel"]()

    thread = threading.Thread(target=run)
    thread.start()
    thread.join(5)
    assert raised, "the cancellation still reaches the caller"
    assert not log.matching("BoB_R0B1", "ERROR")
    assert log.matching("BoB_R0B1", "WARNING")
    assert statuses == ["started", "ended_warning"]


def test_a_worker_that_really_fails_is_still_an_error_and_a_failed_step(fresh_ns):
    log = RecordingLogger()
    agent, statuses = worker_agent(fresh_ns, log, RuntimeError("endpoint returned 500"))
    with pytest.raises(RuntimeError):
        agent.run_worker("BoB_R0B1", "BEST_OF_BEST_SCORING_PROMPT", {}, None)
    assert log.matching("AI Worker process failed for BoB_R0B1", "ERROR")
    assert statuses == ["started", "ended_error"]


def test_an_llm_attempt_timeout_is_a_warning_and_only_the_exhausted_cascade_is_an_error(fresh_ns):
    use_roster(fresh_ns, FIRST, LAST)

    def timed_out(spark, fn, timeout_seconds=None, tag_prefix=None, label=None, on_wait=None, logger=None):
        raise fresh_ns["SparkWorkTimeout"](label, 2.0, timeout_seconds, "t")

    fresh_ns["_run_tagged_spark_work"] = timed_out
    fresh_ns["_cancellable_sleep"] = lambda seconds, poll_interval=1.0: False
    log = RecordingLogger()
    agent = make_agent(fresh_ns, FakeConnectSpark(lambda op: "ok"), log)
    with pytest.raises(Exception):
        agent._call_ai_query("prompt", "BASE_USE_CASE_GEN_PROMPT")
    attempts = [m for m in log.matching("LLM call timed out after") if m.startswith("⏱️")]
    assert any("claude-opus-4-8" in m for m in attempts) and any("claude-opus-4-7" in m for m in attempts)
    assert attempts == [m for m in log.matching("LLM call timed out after", "WARNING") if m.startswith("⏱️")]
    errors = log.matching("timed out", "ERROR")
    assert errors and not [m for m in errors if m.startswith("⏱️")]
    assert any("last in cascade" in m and "claude-opus-4-7" in m for m in errors)


def test_an_llm_attempt_timeout_recovered_by_the_next_model_logs_no_error(fresh_ns):
    use_roster(fresh_ns, FIRST, LAST)
    real = fresh_ns["_run_tagged_spark_work"]
    fired = []

    def first_call_times_out(spark, fn, timeout_seconds=None, tag_prefix=None, label=None, on_wait=None, logger=None):
        if not fired:
            fired.append(label)
            raise fresh_ns["SparkWorkTimeout"](label, 2.0, timeout_seconds, "t")
        return real(spark, fn, timeout_seconds=timeout_seconds, tag_prefix=tag_prefix, label=label, on_wait=on_wait,
                    logger=logger)

    fresh_ns["_run_tagged_spark_work"] = first_call_times_out
    log = RecordingLogger()
    agent = make_agent(fresh_ns, FakeConnectSpark(lambda op: "ok"), log)
    assert agent._call_ai_query("prompt", "BASE_USE_CASE_GEN_PROMPT") == "ok"
    assert fired and log.matching("LLM call timed out after", "WARNING")
    assert [m for lvl, m in log.records if lvl == "ERROR"] == []


def test_a_use_case_lost_after_every_retry_is_an_error(agent_ns):
    obj = scorer(agent_ns)
    obj._log_unscored("BoB", {"U1": "TimeoutError: exceeded the straggler budget of 158s"})
    assert obj.logger.matching("[BoB] 1 UC unscored after retries and excluded from selection", "ERROR")


def elite_judge(ns, records, unjudged):
    obj = scorer(ns)
    obj.llm_timeout_seconds = 30
    obj.ai_agent = types.SimpleNamespace(prompt_templates={})
    obj._get_generation_instruction_for_prompt = lambda name: ""
    obj._grounding_schema_markdown = lambda *a, **k: "schema"
    obj._build_elite_judge_markdown = lambda *a, **k: "use cases"
    obj._score_with_split_retry = lambda use_cases, fn, size, label, timeout: (dict(records), dict(unjudged))
    rt = ns["TECHNICAL_CONTEXT"]["runtime"]
    return obj, obj._run_elite_judge([{"No": "U1"}], [], {}, {"business_context": "ctx"}, rt, "EliteJudge")


def test_elite_candidates_left_unjudged_after_every_retry_are_an_error(agent_ns):
    lost = {"U1": "TimeoutError: exceeded the per-task timeout of 600s"}
    obj, (records, unjudged) = elite_judge(agent_ns, {}, lost)
    assert records == {} and unjudged == lost
    assert obj.logger.matching("[EliteJudge] 1 UC unscored after retries and excluded from selection", "ERROR")


def test_elite_judge_logs_nothing_when_every_candidate_was_judged(agent_ns):
    obj, (records, unjudged) = elite_judge(agent_ns, {"U1": {"ok": True}}, {})
    assert records == {"U1": {"ok": True}} and unjudged == {}
    assert not obj.logger.matching("unscored after retries")


def elite_retry_judge(ns, first_verdict):
    from v120_livefix_test import judge_item
    obj = scorer(ns)
    obj.llm_timeout_seconds = 30
    obj._get_generation_instruction_for_prompt = lambda name: ""
    obj._grounding_schema_markdown = lambda *a, **k: "schema"
    obj._build_use_cases_markdown_for_validation = lambda ucs: "| U1 |\n"
    obj._elite_evidence_summary = lambda uc, evidence: "none"
    prompts = []

    def run_worker(step_name, worker_prompt_path, prompt_vars, response_schema=None, **kw):
        text = prompt_vars["use_cases_to_judge"]
        prompts.append(text)
        corrected = f"was discarded (invalid verdict '{first_verdict}')" in text
        return json.dumps([judge_item(No="U1", verdict="REJECT" if corrected else first_verdict)])

    obj.ai_agent = types.SimpleNamespace(prompt_templates={}, run_worker=run_worker)
    rt = ns["TECHNICAL_CONTEXT"]["runtime"]
    records, unjudged = obj._run_elite_judge([{"No": "U1"}], [], {}, {"business_context": "ctx"}, rt, "EliteJudge")
    return obj, prompts, records, unjudged


def test_an_elite_answer_with_an_invalid_verdict_is_re_asked_with_the_reason(agent_ns):
    obj, prompts, records, unjudged = elite_retry_judge(agent_ns, "REJECTED")
    assert set(records) == {"U1"} and records["U1"]["verdict"] == "REJECT" and unjudged == {}
    assert len(prompts) == 2 and "was discarded" not in prompts[0]
    assert "return every required key and a verdict of exactly ELITE, NEAR_MISS or REJECT" in prompts[1]
    assert obj.logger.matching("invalid verdict 'REJECTED' x1", "WARNING")


def capping_judge(ns, verdict, tier):
    from v120_livefix_test import judge_item
    obj = scorer(ns)
    obj.llm_timeout_seconds = 30
    obj._get_generation_instruction_for_prompt = lambda name: ""
    obj._grounding_schema_markdown = lambda *a, **k: "schema"
    obj._build_use_cases_markdown_for_validation = lambda ucs: "| U1 |\n"
    obj._elite_evidence_summary = lambda uc, evidence: "none"
    prompts = []

    def run_worker(step_name, worker_prompt_path, prompt_vars, response_schema=None, **kw):
        prompts.append(prompt_vars["use_cases_to_judge"])
        return json.dumps([judge_item(No="U1", verdict=verdict, value_tier=tier)])

    obj.ai_agent = types.SimpleNamespace(prompt_templates={}, run_worker=run_worker)
    rt = ns["TECHNICAL_CONTEXT"]["runtime"]
    records, unjudged = obj._run_elite_judge([{"No": "U1"}], [], {}, {"business_context": "ctx"}, rt, "EliteJudge")
    return obj, prompts, records, unjudged


def test_a_verdict_still_above_its_scores_after_the_corrective_retry_is_capped_not_dropped(agent_ns):
    obj, prompts, records, unjudged = capping_judge(agent_ns, "NEAR_MISS", "Incremental")
    assert unjudged == {} and records["U1"]["verdict"] == "REJECT" and records["U1"]["verdict_capped_from"] == "NEAR_MISS"
    assert len(prompts) == 2 and "support REJECT" in prompts[1] and "support REJECT" not in prompts[0]
    assert obj.logger.matching("[VERDICT-CAP FIRED]", "WARNING")
    assert not obj.logger.matching("unscored after retries")


def test_only_a_repeated_verdict_above_its_scores_is_capped(agent_ns):
    from v120_livefix_test import judge_item
    obj = scorer(agent_ns)
    problems = []
    assert obj._normalize_elite_assessment(judge_item(verdict="ELITE", value_tier="Incremental"), problems) is None
    assert problems == ["self-contradiction: verdict ELITE while its own scores and value tier support REJECT"]
    capped = obj._normalize_elite_assessment(judge_item(verdict="ELITE", value_tier="Incremental"), [], cap_verdict=True)
    assert capped["verdict"] == "REJECT" and capped["verdict_capped_from"] == "ELITE"
    consistent = obj._normalize_elite_assessment(judge_item(verdict="ELITE"), [], cap_verdict=True)
    assert consistent["verdict"] == "ELITE" and consistent["verdict_capped_from"] is None


def test_the_elite_judge_prompt_declares_every_key_the_parser_reads(agent_ns):
    import re
    from _agentload import agent_source
    src = agent_source()
    start = src.index("    def _normalize_elite_assessment(")
    body = src[start:src.index("\n    def ", start + 10)]
    keys = set(re.findall(r'item(?:\.get)?\(\s*"([a-z_]+)"', body) + re.findall(r'item\["([a-z_]+)"\]', body))
    prompt = agent_ns["PROMPT_TEMPLATES"]["ULTRA_HIGH_ELITE_JUDGE_PROMPT"]
    output = prompt[prompt.index("## Output"):]
    assert {"verdict", "scores", "value_tier", "fatal_flaws"} <= keys
    assert [k for k in sorted(keys - {"red_team_verdict"}) if f"`{k}`" not in output] == []
    assert "Never return `red_team_verdict`" in output and "`No` (the use case id)" in output
    assert "`verdict` is exactly one of:" in prompt


def test_a_valid_elite_answer_is_asked_once_without_a_correction(agent_ns):
    obj, prompts, records, unjudged = elite_retry_judge(agent_ns, "ELITE")
    assert set(records) == {"U1"} and records["U1"]["verdict"] == "ELITE" and unjudged == {}
    assert len(prompts) == 1 and "was discarded" not in prompts[0]


def test_goal_filter_drops_of_unverified_use_cases_are_an_error(agent_ns):
    obj = make_inspire(agent_ns, lambda name, prompt_vars, skip_cache: "", parsed_generation_instructions={
        "goal_setting": {"has_goal": True, "goal_description": "Reduce fraud losses"}})
    obj.logger = RecordingLogger()
    assert obj._filter_use_cases_by_goal_alignment([make_uc("U1")]) == []
    assert obj.logger.matching("received no YES/NO verdict after retries, so the filter removed", "ERROR")


def test_an_unparseable_combined_score_batch_is_a_warning_because_the_engine_retries_it(agent_ns):
    obj = make_inspire(agent_ns)
    obj.logger = RecordingLogger()
    assert obj._parse_combined_score_response("not json", [make_uc("U1")]) == {}
    assert obj.logger.matching("Failed to parse combined score JSON", "WARNING")
    assert not obj.logger.matching("Failed to parse combined score JSON", "ERROR")


def scripted(answers):
    calls = []

    def run_worker(step_name, worker_prompt_path, prompt_vars, response_schema=None, skip_cache=False, **kw):
        calls.append(skip_cache)
        answer = answers[min(len(calls), len(answers)) - 1]
        if isinstance(answer, Exception):
            raise answer
        return answer

    return run_worker, calls


def errors_of(logger):
    return [m for lvl, m in logger.records if lvl == "ERROR"]


def ui_translator(ns, answers):
    run_worker, calls = scripted(answers)
    service = ns["TranslationService"](types.SimpleNamespace(run_worker=run_worker), RecordingLogger())
    service._validate_translations = lambda translations, language: True
    return service, calls


def test_a_ui_translation_attempt_that_is_retried_is_a_warning(agent_ns):
    service, calls = ui_translator(agent_ns, [RuntimeError("endpoint returned 500"), "{}"])
    assert service.get_translations("Japanese")
    assert calls == [False, True]
    assert service.logger.matching("Failed to get UI translations for Japanese (Attempt 1/2)", "WARNING")
    assert errors_of(service.logger) == []


def test_ui_translations_that_fail_every_attempt_are_one_error(agent_ns):
    service, calls = ui_translator(agent_ns, [RuntimeError("endpoint returned 500")])
    assert service.get_translations("Japanese")
    assert len(calls) == 2
    assert errors_of(service.logger) == ["All retry attempts exhausted for UI translations of Japanese."]


def use_case_translator(ns, answers):
    run_worker, calls = scripted(answers)
    service = ns["TranslationService"](types.SimpleNamespace(run_worker=run_worker), RecordingLogger())
    service._translation_payload = lambda uc: {"No": uc["No"]}
    service._parse_translation_rows = lambda raw, batch, num, language: ({"U1": {"No": "U1"}}, [], "")
    service._merge_translated_batch = lambda batch, rows, language: [dict(uc, translated=True) for uc in batch]
    return service, calls


def test_a_use_case_translation_attempt_that_is_retried_is_a_warning(agent_ns):
    service, calls = use_case_translator(agent_ns, [RuntimeError("endpoint returned 500"), "rows"])
    out = service._translate_batch([{"No": "U1"}], "Japanese", 1)
    assert calls == [False, True] and out[0]["translated"]
    assert service.logger.matching("Failed to translate use case batch #1 (Attempt 1/2", "WARNING")
    assert errors_of(service.logger) == []


def test_a_use_case_batch_left_in_english_after_every_attempt_is_one_error(agent_ns):
    service, calls = use_case_translator(agent_ns, [RuntimeError("endpoint returned 500")])
    out = service._translate_batch([{"No": "U1"}], "Japanese", 1)
    assert len(calls) == 2 and not out[0].get("translated")
    assert errors_of(service.logger) == ["All retry attempts exhausted for batch #1. It stays in English and is flagged."]


def test_a_use_case_batch_still_incomplete_after_the_retry_is_one_error(agent_ns):
    service, calls = use_case_translator(agent_ns, ["rows"])
    service._parse_translation_rows = lambda raw, batch, num, language: ({}, ["U1"], "")
    out = service._translate_batch([{"No": "U1"}], "Japanese", 1)
    assert len(calls) == 2 and not out[0].get("translated")
    assert errors_of(service.logger) == ["All retry attempts exhausted for batch #1. It stays in English and is flagged."]


def domain_clusterer(ns, handler):
    from v120_clustering_test import FakeAgent, make, no_merge, one_subdomain_per_domain, ucs_on
    obj = make(ns, FakeAgent(domain=handler, subdomain=one_subdomain_per_domain, merge=no_merge))
    obj.logger = RecordingLogger()
    return obj, ucs_on([(f"U{i}", "main.shop.orders") for i in range(1, 9)])


def test_a_domain_detection_attempt_that_is_retried_is_a_warning(agent_ns):
    from v120_clustering_test import domain_csv, ids_in_csv
    seen = []

    def handler(prompt_vars, step, kw, template):
        seen.append(step)
        if len(seen) == 1:
            raise RuntimeError("endpoint returned 500")
        return domain_csv({i: "Sales" if int(i[1:]) <= 4 else "Finance" for i in ids_in_csv(prompt_vars["use_cases_csv"])})

    obj, use_cases = domain_clusterer(agent_ns, handler)
    out = obj._cluster_domains_and_subdomains(use_cases, "English")
    assert {u["Business Domain"] for u in out} == {"Sales", "Finance"}
    assert obj.logger.matching("Domain detection attempt 1 failed", "WARNING")
    assert not obj.logger.matching("Domain detection attempt", "ERROR")
    assert not obj.logger.matching("Domain detection failed", "ERROR")


def test_a_domain_detection_that_fails_every_attempt_errors_on_the_fallback(agent_ns):
    def handler(prompt_vars, step, kw, template):
        raise RuntimeError("endpoint returned 500")

    obj, use_cases = domain_clusterer(agent_ns, handler)
    obj._cluster_domains_and_subdomains(use_cases, "English")
    assert not obj.logger.matching("Domain detection attempt", "ERROR")
    assert obj.logger.matching("Domain detection failed. Using evidence-based fallback domains", "ERROR")


INTERPRETED = '{"per_prompt_instructions": {"BASE_USE_CASE_GEN_PROMPT": "Focus on fraud"}}'


def interpreter(ns, answers):
    obj = make_inspire(ns, lambda name, prompt_vars, skip_cache: answers.pop(0) if answers else "not json",
                       user_generation_instructions="Focus on fraud")
    obj.logger = RecordingLogger()
    return obj


def test_an_interpreter_attempt_that_is_retried_is_a_warning(agent_ns):
    obj = interpreter(agent_ns, ["not json", INTERPRETED])
    parsed = obj._interpret_generation_instructions()
    assert parsed["per_prompt_instructions"]["BASE_USE_CASE_GEN_PROMPT"] == "Focus on fraud"
    assert obj.logger.matching("All JSON extraction strategies failed", "WARNING")
    assert errors_of(obj.logger) == []


def test_an_interpreter_that_fails_every_attempt_is_one_error(agent_ns):
    obj = interpreter(agent_ns, [])
    parsed = obj._interpret_generation_instructions()
    assert parsed["interpretation_status"] == "failed"
    assert errors_of(obj.logger) == [
        "All interpreter attempts failed - the raw Generation Instructions will be injected verbatim into every prompt."]


def test_a_business_context_attempt_that_is_retried_is_a_warning(agent_ns):
    answers = ["not json at all", '{"business_context": "A bakery chain"}']
    obj = make_inspire(agent_ns, lambda name, prompt_vars, skip_cache: answers.pop(0))
    obj.logger = RecordingLogger()
    assert obj._get_business_context_from_llm()["business_context"].endswith("A bakery chain")
    assert obj.logger.matching("All JSON strategies failed for business context (attempt 1/2)", "WARNING")
    assert errors_of(obj.logger) == []


def test_business_context_that_fails_every_attempt_is_one_error(agent_ns):
    obj = make_inspire(agent_ns, lambda name, prompt_vars, skip_cache: "not json at all")
    obj.logger = RecordingLogger()
    assert obj._get_business_context_from_llm() == {}
    assert errors_of(obj.logger) == [
        "Business context extraction failed after retries; continuing with an empty LLM business context."]


def subdomain_detector(ns, handler):
    from v120_clustering_test import FakeAgent, make, ucs_on
    agent = FakeAgent(subdomain=handler)
    obj = make(ns, agent)
    obj.logger = RecordingLogger()
    use_cases = ucs_on([("U1", "main.shop.orders"), ("U2", "main.shop.orders"), ("U3", "main.shop.orders")])
    for use_case in use_cases:
        use_case["Business Domain"] = "Sales"
    return obj, agent, use_cases


def test_a_subdomain_attempt_that_is_retried_is_a_warning(agent_ns):
    from v120_clustering_test import ids_in_csv, subdomain_csv
    seen = []

    def handler(prompt_vars, step, kw, template):
        seen.append(step)
        if len(seen) == 1:
            raise RuntimeError("endpoint returned 500")
        return subdomain_csv({i: "Demand Planning" for i in ids_in_csv(prompt_vars["use_cases_csv"])})

    obj, agent, use_cases = subdomain_detector(agent_ns, handler)
    out = obj._detect_subdomains_for_domain("Sales", use_cases, "English")
    assert {u["Subdomain"] for u in out} == {"Demand Planning"} and len(seen) == 2
    assert obj.logger.matching("Subdomain detection attempt 1 failed", "WARNING")
    assert not obj.logger.matching("Subdomain detection attempt", "ERROR")


def test_a_subdomain_detection_that_fails_every_attempt_errors_on_the_fallback(agent_ns):
    def handler(prompt_vars, step, kw, template):
        raise RuntimeError("endpoint returned 500")

    obj, agent, use_cases = subdomain_detector(agent_ns, handler)
    obj._detect_subdomains_for_domain("Sales", use_cases, "English")
    assert not obj.logger.matching("Subdomain detection attempt", "ERROR")
    assert any("Max attempts reached" in m for m in errors_of(obj.logger))


def test_the_v121_rules_cite_symbols_that_exist(agent_ns):
    import csv
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    with open(os.path.join(root, "rules", "inspire-ai-rules.csv"), encoding="utf-8", newline="") as handle:
        rules = {row["rule_id"]: row for row in csv.DictReader(handle)}
    for rule_id in ("R56", "R57", "R58", "R59", "R60"):
        assert rules[rule_id]["source_version"] == "v1.2.1"
        for symbol in rules[rule_id]["where_enforced"].split(";"):
            owner, _, name = symbol.strip().rpartition(".")
            assert hasattr(agent_ns[owner], name) if owner else name in agent_ns, (rule_id, symbol)


class DedupAgent:
    def __init__(self, answers):
        self.answers = list(answers)
        self.calls = []
        self.lock = threading.Lock()
        self.prompt_templates = {}

    def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema=None, model_override=None, **kw):
        with self.lock:
            self.calls.append({"step": step_name, "skip_cache": kw.get("skip_cache", False)})
            answer = self.answers[min(len(self.calls), len(self.answers)) - 1]
        if isinstance(answer, Exception):
            raise answer
        return answer


def dedup_inspire(ns, answers):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = RecordingLogger()
    obj.ai_agent = DedupAgent(answers)
    obj.parsed_generation_instructions = {}
    obj.max_parallelism = 4
    obj.llm_timeout_seconds = 300
    obj.atomic_writer = None
    return obj


def uc(no, domain="Sales"):
    return {"No": no, "Name": f"Use case {no}", "Analytics Technique": "Forecasting", "Tables Involved": "c.s.orders",
            "Statement": f"Statement {no}", "Business Domain": domain}


def nos(use_cases):
    return sorted(u["No"] for u in use_cases)


def test_domain_dedup_reasks_once_when_the_keep_list_is_unusable(agent_ns):
    obj = dedup_inspire(agent_ns, [SHIFTED, CLEAN])
    kept = obj._deduplicate_use_cases_by_domain_parallel([uc("A"), uc("B"), uc("C")])
    assert nos(kept) == ["A", "C"]
    assert [(c["step"], c["skip_cache"]) for c in obj.ai_agent.calls] == [
        ("Deduplicate_Domain_Sales", False), ("Deduplicate_Domain_Sales_Reask", True)]
    assert obj.logger.matching("[DEDUP-REASK FIRED]", "WARNING")
    assert not obj.logger.matching("Deduplication failed")


def test_domain_dedup_keeps_everything_after_two_unusable_keep_lists(agent_ns):
    obj = dedup_inspire(agent_ns, [SHIFTED, SHIFTED])
    kept = obj._deduplicate_use_cases_by_domain_parallel([uc("A"), uc("B"), uc("C")])
    assert nos(kept) == ["A", "B", "C"]
    assert len(obj.ai_agent.calls) == 2
    assert obj.logger.matching("Deduplication failed", "ERROR")


def test_domain_dedup_does_not_reask_when_the_llm_call_itself_failed(agent_ns):
    obj = dedup_inspire(agent_ns, [RuntimeError("every model in the cascade failed")])
    kept = obj._deduplicate_use_cases_by_domain_parallel([uc("A"), uc("B"), uc("C")])
    assert nos(kept) == ["A", "B", "C"]
    assert len(obj.ai_agent.calls) == 1
    assert obj.logger.matching("Deduplication failed", "ERROR")


def test_domain_dedup_with_a_clean_first_answer_asks_once(agent_ns):
    obj = dedup_inspire(agent_ns, [CLEAN])
    kept = obj._deduplicate_use_cases_by_domain_parallel([uc("A"), uc("B"), uc("C")])
    assert nos(kept) == ["A", "C"]
    assert len(obj.ai_agent.calls) == 1
    assert not obj.logger.matching("[DEDUP-REASK FIRED]")


def test_global_dedup_reasks_once_before_falling_back_per_domain(agent_ns):
    obj = dedup_inspire(agent_ns, [SHIFTED, CLEAN])
    kept = obj._deduplicate_use_cases([uc("A"), uc("B"), uc("C", domain="Ops")])
    assert nos(kept) == ["A", "C"]
    assert [(c["step"], c["skip_cache"]) for c in obj.ai_agent.calls] == [
        ("Deduplicate_Global", False), ("Deduplicate_Global_Reask", True)]
    assert not obj.logger.matching("Falling back to per-domain")


def test_a_trailing_note_with_a_comma_never_wipes_the_dedup_keep_list(agent_ns):
    obj = dedup_inspire(agent_ns, [])
    raw = ("use_case_id,honesty_score,honesty_justification\nU1,90,ok\nU2,90,ok\nU3,90,ok\nU5,90,ok\n"
           "U4, U6 merged into U5")
    cleaned = agent_ns["extract_honesty_score"](raw)[2]
    kept = nos(obj._parse_dedup_response(cleaned, [uc(f"U{i}") for i in range(1, 7)], "t"))
    assert {"U1", "U2", "U3", "U5"} <= set(kept) and "U6" not in kept


def test_bare_keep_ids_followed_by_a_pair_line_keep_every_listed_id(agent_ns):
    obj = dedup_inspire(agent_ns, [])
    kept = nos(obj._parse_dedup_response("use_case_id\nU1\nU2\nU3\nU5\nU4,U6", [uc(f"U{i}") for i in range(1, 7)], "t"))
    assert {"U1", "U2", "U3", "U5"} <= set(kept) and "U6" not in kept


def test_a_prose_preamble_before_a_single_column_keep_list_is_still_read(agent_ns):
    obj = dedup_inspire(agent_ns, [])
    kept = obj._parse_dedup_response("Here are the ids to keep:\nuse_case_id\nA\nC\n", [uc("A"), uc("B"), uc("C")], "t")
    assert nos(kept) == ["A", "C"]


def test_multi_column_answers_still_lose_their_prose_preamble(agent_ns):
    assert agent_ns["clean_csv_response"]("Here is the table:\nuse_case_id,domain\nU1,Sales") == "use_case_id,domain\nU1,Sales"


def test_a_commentary_first_line_does_not_hijack_the_dedup_id_column(agent_ns):
    obj = dedup_inspire(agent_ns, [])
    kept = obj._parse_dedup_response("Layer A - identical names:,A\nA\nC\n", [uc("A"), uc("B"), uc("C")], "t")
    assert nos(kept) == ["A", "C"]


def test_the_dedup_id_column_follows_the_majority_and_a_shifted_keep_row_is_still_refused(agent_ns):
    obj = dedup_inspire(agent_ns, [])
    with pytest.raises(ValueError, match="outside the id column"):
        obj._parse_dedup_response("A\nC\nForecast demand,B\n", [uc("A"), uc("B"), uc("C")], "t")


def test_a_failed_global_dedup_with_one_group_does_not_resend_the_same_request(agent_ns):
    obj = dedup_inspire(agent_ns, [SHIFTED, SHIFTED])
    kept = obj._deduplicate_use_cases([uc("A", domain=""), uc("B", domain=""), uc("C", domain="")])
    assert nos(kept) == ["A", "B", "C"]
    assert [c["step"] for c in obj.ai_agent.calls] == ["Deduplicate_Global", "Deduplicate_Global_Reask"]
    assert obj.logger.matching("Per-domain dedup would resend the same single group", "ERROR")


def test_the_dedup_prompt_forbids_the_layer_narration(agent_ns):
    prompt = agent_ns["PROMPT_TEMPLATES"]["REVIEW_USE_CASES_PROMPT"]
    rule = prompt.find("do not write the layer analysis, notes, bullet points or explanations of merged pairs")
    output = prompt.find("**OUTPUT**: CSV listing IDs to KEEP")
    start = prompt.find("Your response must START with: use_case_id,honesty_score,honesty_justification")
    assert -1 < output < rule < start


def test_global_dedup_falls_back_per_domain_as_a_warning_after_two_unusable_answers(agent_ns):
    obj = dedup_inspire(agent_ns, [SHIFTED, SHIFTED, "use_case_id\nA\n"])
    kept = obj._deduplicate_use_cases([uc("A"), uc("B"), uc("C", domain="Ops")])
    assert nos(kept) == ["A", "C"]
    assert obj.logger.matching("Falling back to per-domain", "WARNING")
    assert not obj.logger.matching("Falling back to per-domain", "ERROR")
    assert [c["step"] for c in obj.ai_agent.calls] == [
        "Deduplicate_Global", "Deduplicate_Global_Reask", "Deduplicate_Domain_Sales"]
