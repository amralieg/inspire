"""v1.3.0: one elite judge model per run.

Every elite judge call of a run starts on the same endpoint: the first healthy endpoint of
elite_judge_preferred_endpoints (the model the elite bars were calibrated on), else the first healthy endpoint of the
judge cascade. Another model judges only after the pinned one is demoted or unusable, and the second opinion comes
from a model other than the pinned judge. U11 judged on Opus 4.8 (47 elite, 12 of 12 stars) while U12 judged most
batches on Opus 5.5 (4 elite, 5 of 12 stars), so stars depended on which model each batch happened to reach.
"""
import pytest

from v120_runtime_reliability_test import RecordingLogger, use_roster

NEW, CALIBRATED, OLDER = "databricks-claude-opus-5-5", "databricks-claude-opus-4-8", "databricks-claude-opus-4-7"


def judge(ns):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = RecordingLogger()
    return obj


def test_every_judge_call_starts_on_the_calibrated_model_even_when_a_newer_one_leads_the_cascade(fresh_ns):
    use_roster(fresh_ns, NEW, CALIBRATED, OLDER)
    assert fresh_ns["TECHNICAL_CONTEXT"]["runtime"]["elite_judge_preferred_endpoints"] == [CALIBRATED]
    assert fresh_ns["get_full_fallback_cascade"]("ULTRA_HIGH_ELITE_JUDGE_PROMPT")[0]["llm_endpoint_name"] == NEW
    obj = judge(fresh_ns)
    assert [obj._pinned_elite_judge() for _ in range(3)] == [CALIBRATED] * 3
    fired = obj.logger.matching("[ELITE-JUDGE-PINNED FIRED]", "INFO")
    assert len(fired) == 1 and f"starts on '{CALIBRATED}' (the calibrated judge)" in fired[0]
    assert obj._elite_second_opinion_model() == NEW, "the second opinion comes from a model other than the judge"


def test_without_a_calibrated_endpoint_the_first_healthy_one_judges(fresh_ns):
    use_roster(fresh_ns, NEW, OLDER)
    obj = judge(fresh_ns)
    assert obj._pinned_elite_judge() == NEW
    assert "no calibrated judge endpoint is healthy" in obj.logger.matching("[ELITE-JUDGE-PINNED FIRED]", "INFO")[0]
    assert obj._elite_second_opinion_model() == OLDER


def test_another_model_judges_only_after_the_pinned_one_is_demoted(fresh_ns):
    use_roster(fresh_ns, NEW, CALIBRATED, OLDER)
    health, obj = fresh_ns["LLM_ENDPOINT_HEALTH"], judge(fresh_ns)
    assert obj._pinned_elite_judge() == CALIBRATED
    health.record_timeout(CALIBRATED, obj.logger, source="ULTRA_HIGH_ELITE_JUDGE_PROMPT")
    assert obj._pinned_elite_judge() == CALIBRATED, "one timeout never moves the judge"
    for _ in range(2):
        health.record_timeout(CALIBRATED, obj.logger, source="ULTRA_HIGH_ELITE_JUDGE_PROMPT")
    assert obj._pinned_elite_judge() == NEW
    moved = obj.logger.matching("[ELITE-JUDGE-PINNED FIRED]", "WARNING")
    assert len(moved) == 1 and f"'{CALIBRATED}' is no longer healthy" in moved[0] and f"start on '{NEW}'" in moved[0]
    assert obj._pinned_elite_judge() == NEW and len(obj.logger.matching("[ELITE-JUDGE-PINNED FIRED]", "WARNING")) == 1


def test_judge_batches_start_on_the_pin_and_an_explicit_second_opinion_model_is_kept(fresh_ns):
    use_roster(fresh_ns, NEW, CALIBRATED, OLDER)
    obj = judge(fresh_ns)
    started = []

    class Agent:
        def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema=None, timeout_override=None,
                       start_from_model=None, skip_cache=False, **_kw):
            started.append((worker_prompt_path, start_from_model))
            return "[]"

    obj.ai_agent = Agent()
    obj.llm_timeout_seconds = 300
    obj._get_generation_instruction_for_prompt = lambda name: ""
    obj._grounding_schema_markdown = lambda details, tables: "schema"
    obj._uc_batch_tables = lambda batch: []
    obj._build_elite_judge_markdown = lambda batch, evidence, failures: "cards"
    obj._prompt_overhead_chars = lambda name: 0
    obj._scoring_task_timeout = lambda timeout, chars: timeout
    obj._log_unscored = lambda label, unjudged: None
    obj._parse_elite_judge_response = lambda raw, batch, problems, cap_ids: {}
    obj._score_with_split_retry = lambda use_cases, fn, batch_size, label, timeout: (fn("B1", use_cases, False), {})
    rt = fresh_ns["TECHNICAL_CONTEXT"]["runtime"]
    obj._run_elite_judge([{"No": "U1"}], [], {}, {"business_context": "retail"}, rt, "BestOfBest_Judge")
    obj._run_elite_judge([{"No": "U1"}], [], {}, {"business_context": "retail"}, rt, "BestOfBest_SecondOpinion",
                         start_from_model=OLDER)
    assert started == [("ULTRA_HIGH_ELITE_JUDGE_PROMPT", CALIBRATED), ("ULTRA_HIGH_ELITE_JUDGE_PROMPT", OLDER)]


@pytest.mark.parametrize("value", ["databricks-claude-opus-4-8", [""], [3], None])
def test_the_preferred_judge_list_is_validated(fresh_ns, value):
    fresh_ns["TECHNICAL_CONTEXT"]["runtime"]["elite_judge_preferred_endpoints"] = value
    with pytest.raises(ValueError, match="elite_judge_preferred_endpoints"):
        fresh_ns["_validate_runtime_config"]()
