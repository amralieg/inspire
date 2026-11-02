"""v1.3.0 strategy-blind discovery and grading: generation, combined scoring, Best-of-Best and Elite never
see goals, priorities, the strategy tree, KPIs, key results or sponsors; Value and Priority come from the
sub-scores through one deterministic helper."""
import json
import string

import pytest

from v120_artifacts_support import make_inspire
from v120_run_offline_smoke_test import _build

BLIND_PROMPTS = ("BASE_USE_CASE_GEN_PROMPT", "COMBINED_VALUE_QUALITY_SCORE_PROMPT", "BEST_OF_BEST_SCORING_PROMPT",
                 "ULTRA_HIGH_ELITE_JUDGE_PROMPT")
STRATEGY_FIELDS = {"strategic_goals", "business_priorities", "strategy", "strategy_tree", "kpis", "key_results",
                   "sponsors", "priorities"}
SENTINEL = "ZEBRA PILLAR NINE"


def _fields(template):
    return {f.split(".")[0].split("[")[0] for _, f, _, _ in string.Formatter().parse(template) if f}


@pytest.mark.parametrize("name", BLIND_PROMPTS)
def test_blind_prompts_have_no_strategy_placeholders_or_wording(agent_ns, name):
    template = agent_ns["PROMPT_TEMPLATES"][name]
    assert not _fields(template) & STRATEGY_FIELDS, _fields(template) & STRATEGY_FIELDS
    for phrase in ("Strategic Goals", "Business Priorities", "stated Business Priority", "Strategic Goal,",
                   "business_priority_alignment", "strategic_goals_alignment", "STRATEGIC ALIGNMENT**: Aligns"):
        assert phrase not in template, (name, phrase)


def test_generation_criteria_anchor_on_the_business_model_and_add_no_risk_criterion(agent_ns):
    template = agent_ns["PROMPT_TEMPLATES"]["BASE_USE_CASE_GEN_PROMPT"]
    criteria = template.split("meet at least one of these criteria:", 1)[1].split("STRICTLY PROHIBITED", 1)[0]
    names = [line.split("**")[1] for line in criteria.splitlines() if line.strip()[:2] in ("1.", "2.", "3.", "4.")]
    assert names == ["DIRECT FINANCIAL IMPACT", "BUSINESS MODEL FIT", "PRODUCTIVITY & AUTOMATION"]
    assert "a line of the Revenue Model, a Value Chain step or the Strategic Initiative" in criteria
    assert "RISK REDUCTION" not in template


def test_grading_context_drops_strategy_and_unknown_keys(agent_ns):
    obj = make_inspire(agent_ns)
    context = {"business_context": "B", "industry": "I", "strategic_initiative": "S", "value_chain": "V",
               "revenue_model": "R", "strategic_goals": [SENTINEL], "business_priorities": [SENTINEL],
               "strategy_tree": {"x": SENTINEL}, "anything_else": 1}
    graded = obj._grading_context(context)
    assert graded == {"business_context": "B", "industry": "I", "strategic_initiative": "S", "value_chain": "V",
                      "revenue_model": "R"}
    assert obj._grading_context(None) == {key: "" for key in graded}


def test_end_to_end_no_generation_or_grading_prompt_sees_the_strategy(agent_ns, tmp_path):
    def scorer(uc_id):
        return {"use_case_id": uc_id, "quality_label": "High", "quality_score": 4.0, "priority_score": 7.0,
                "roi": 4.0, "time_to_value": 3.0, "reusability": 3.0, "data_availability": 4.0,
                "quality_summary": "Columns `id` and `amount` aggregated by store give the KPI that drives the outcome."}

    obj = _build(agent_ns, tmp_path, "Good", {"Medium", "High", "Very High", "Ultra High"}, scorer)
    raw = obj._get_business_context_from_llm()
    obj._get_business_context_from_llm = lambda: dict(raw, strategic_goals=SENTINEL, business_priorities=SENTINEL)
    obj.user_business_priorities = [SENTINEL]
    obj.customer_strategy = agent_ns["parse_strategic_context"](json.dumps(
        {"schema_version": 1, "strategy": [{"name": SENTINEL, "kpis": [{"name": SENTINEL + " KPI"}]}],
         "priorities": [SENTINEL], "sponsors": [{"role": SENTINEL + " Officer"}]}))
    obj.run()
    for kwargs in obj.recorded["gen_kwargs"]:
        assert SENTINEL not in json.dumps(kwargs, default=str), kwargs
    graded = [vars_ for prompt, vars_, _skip in obj.ai_agent.calls if prompt in BLIND_PROMPTS]
    assert graded, "combined scoring ran"
    for vars_ in graded:
        assert SENTINEL not in json.dumps(vars_, default=str)
    assert obj.strategy_tree["strategy"][0]["name"] == SENTINEL, "the strategy is kept for the alignment step"
    aligned = [vars_ for prompt, vars_, _skip in obj.ai_agent.calls if prompt == "STRATEGY_ALIGNMENT_PROMPT"]
    assert aligned and SENTINEL in aligned[0]["strategy_entries"], "the strategy reaches the alignment step only"
    prompts = [prompt for prompt, _vars, _skip in obj.ai_agent.calls]
    assert prompts.index("STRATEGY_ALIGNMENT_PROMPT") > max(i for i, p in enumerate(prompts) if p in BLIND_PROMPTS)


def _uc(**scores):
    keys = {"roi": "Return on Investment", "ttv": "Time to Value", "reuse": "Reusability", "sa": "Strategic Alignment",
            "feas": "Feasibility"}
    return {keys[k]: v for k, v in scores.items()}


def test_value_priority_helper_blind_and_aligned_formulas(agent_ns):
    compute = agent_ns["compute_value_priority"]
    uc = _uc(roi=4.8, ttv=3.5, reuse=4.0)
    uc.update({k: v for k, v in zip(agent_ns["FEASIBILITY_FACTOR_KEYS"], (4.0, 4.0, 4.5, 4.0, 4.0, 4.5, 4.0, 3.5))})
    assert compute(uc) == (4.59, 4.06, round(4.59 * 1.5 + 4.06 * 0.5, 2))
    uc["Strategic Alignment"] = 2.0
    value, feasibility, priority = compute(uc, with_alignment=True)
    assert value == round(4.8 * 0.60 + 2.0 * 0.25 + 3.5 * 0.075 + 4.0 * 0.075, 2) == 3.94
    assert priority == round(3.94 * 1.5 + 4.06 * 0.5, 2)
    assert compute(uc) == (4.59, 4.06, round(4.59 * 1.5 + 4.06 * 0.5, 2)), "blind Value ignores Strategic Alignment"


def test_value_priority_helper_refuses_missing_or_out_of_range_inputs(agent_ns):
    compute = agent_ns["compute_value_priority"]
    assert compute(_uc(roi=4.0, ttv=3.0)) is None
    assert compute(_uc(roi=48, ttv=3.0, reuse=3.0, feas=4.0)) is None
    assert compute(_uc(roi=4.0, ttv=3.0, reuse=3.0)) is None, "no feasibility factor and no Feasibility"
    assert compute(_uc(roi=4.0, ttv=3.0, reuse=3.0, feas=4.0)) == (3.8, 4.0, 7.7)
    assert compute(_uc(roi=4.0, ttv=3.0, reuse=3.0, sa=None, feas=4.0), with_alignment=True) is None
    assert compute(_uc(roi=float("nan"), ttv=3.0, reuse=3.0, feas=4.0)) is None


def test_combined_scoring_overrides_the_llm_arithmetic_and_keeps_it_only_when_inputs_are_missing(agent_ns):
    from v120_modes_context_test import make_obj, make_uc, ids_in

    def responder(name, prompt_vars, skip_cache):
        out = []
        for uc_id in ids_in(prompt_vars["use_cases_to_validate"]):
            item = {"use_case_id": uc_id, "quality_label": "High", "quality_score": 4.0, "priority_score": 9.9,
                    "value_score": 5.0, "quality_summary": "Columns `a` and `b` aggregated monthly give a KPI."}
            if uc_id == "U1":
                item.update(roi=4.0, time_to_value=3.0, reusability=3.0, data_availability=4.0, team_skills=3.0,
                            strategic_alignment=5.0)
            out.append(item)
        return json.dumps(out)

    obj = make_obj(agent_ns, responder)
    computed, kept = obj._score_combined_value_and_quality([make_uc("U1"), make_uc("U2")], [])
    assert (computed["Value"], computed["Feasibility"], computed["Priority"]) == (3.8, 3.5, 7.45)
    assert computed["Priority Score"] == 7.45 and computed["Priority"] != 9.9, "the LLM's arithmetic must be replaced"
    assert computed["Strategic Alignment"] is None, "pre-selection scoring never records a strategic alignment"
    assert computed["Business Priority Alignment"] == "" and computed["Strategic Goals Alignment"] == ""
    assert kept["Priority"] == 9.9 and kept["Priority Score"] == 9.9
