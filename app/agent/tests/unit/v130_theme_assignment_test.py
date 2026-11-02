"""v1.3.0 idea themes: one call names the themes of the whole scored portfolio after Best-of-Best scoring,
instead of every scoring batch naming its own, so one idea carries one name and the trim's one-per-theme
floor no longer protects almost every use case."""
import json
import os
import sys
from unittest.mock import MagicMock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v120_genie_support import build_inspire


class ThemeAgent:
    def __init__(self, answers):
        self.answers = list(answers)
        self.calls = []

    def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema=None, timeout_override=None, skip_cache=False, **_kw):
        self.calls.append({"prompt": worker_prompt_path, "vars": dict(prompt_vars), "skip_cache": skip_cache})
        answer = self.answers.pop(0) if self.answers else ""
        if isinstance(answer, Exception):
            raise answer
        return answer if isinstance(answer, str) else json.dumps(answer)


def portfolio(n, subdomain="Store Operations"):
    return [{"No": f"N01-U{i:02d}", "Name": f"Use case {i}", "Analytics Technique": "Gradient boosting classifier",
             "Tables Involved": "c.s.orders, c.s.customers", "Subdomain": subdomain, "Business Domain": "Sales"}
            for i in range(1, n + 1)]


def grouped(ucs, groups):
    return [{"No": uc["No"], "idea_theme": f"Idea {i % groups}"} for i, uc in enumerate(ucs)]


def inst_with(agent_ns, answers):
    agent = ThemeAgent(answers)
    inst = build_inspire(agent_ns, agent=agent)
    inst.logger = MagicMock()
    return inst, agent


def logged(inst, level="info"):
    return " ".join(str(c) for c in getattr(inst.logger, level).call_args_list)


def ids_in(listing):
    return [line.split(" | ")[0][2:] for line in listing.splitlines() if line.startswith("- ")]


def test_one_call_names_the_themes_of_the_whole_portfolio(agent_ns):
    ucs = portfolio(30)
    inst, agent = inst_with(agent_ns, [grouped(ucs, 6)])
    report = inst._assign_idea_themes(ucs)
    [call] = agent.calls
    assert call["prompt"] == "THEME_ASSIGNMENT_PROMPT" and call["skip_cache"] is False
    assert ids_in(call["vars"]["use_cases_listing"]) == [uc["No"] for uc in ucs], "every use case is listed once, in order"
    assert "technique: Gradient boosting classifier | main table: orders" in call["vars"]["use_cases_listing"]
    assert call["vars"]["existing_themes_section"] == ""
    assert sorted({uc["idea_theme"] for uc in ucs}) == [f"Idea {i}" for i in range(6)]
    assert report == {"use_cases": 30, "themes": 6, "singletons": 0, "second_call": 0, "regrouped": 0, "fallback": 0, "source": "model"}
    assert "[THEME-ASSIGN FIRED] 30 use cases -> 6 themes (0 with one use case" in logged(inst)
    assert "over-fragmented" not in logged(inst, "warning")


def test_spellings_merge_by_case_and_unknown_ids_or_bad_names_are_never_applied(agent_ns):
    ucs = portfolio(12)
    first = grouped(ucs, 3)
    first[1]["idea_theme"] = "idea  1"
    first[4]["idea_theme"] = "A theme name that is far too long to be a theme"
    first.append({"No": "N99-U99", "idea_theme": "Idea 0"})
    second = [{"No": ucs[4]["No"], "idea_theme": "Idea 1"}]
    inst, agent = inst_with(agent_ns, [first, second])
    inst._assign_idea_themes(ucs)
    assert ucs[1]["idea_theme"] == "idea 1" and ucs[4]["idea_theme"] == "idea 1", "the first spelling of a theme wins"
    assert {uc["idea_theme"] for uc in ucs} == {"Idea 0", "idea 1", "Idea 2"}
    assert ids_in(agent.calls[1]["vars"]["use_cases_listing"]) == [ucs[4]["No"]], "only the use case with a bad name is asked again"


def test_use_cases_the_answer_leaves_out_go_to_a_second_call_with_the_themes_already_used(agent_ns):
    ucs = portfolio(30)
    first = grouped(ucs, 6)[:26]
    second = [{"No": ucs[26]["No"], "idea_theme": "Idea 2"}, {"No": ucs[27]["No"], "idea_theme": "Basket Affinity"},
              {"No": ucs[28]["No"], "idea_theme": "Idea 4"}, {"No": ucs[29]["No"], "idea_theme": "Idea 5"}]
    inst, agent = inst_with(agent_ns, [first, second])
    report = inst._assign_idea_themes(ucs)
    assert len(agent.calls) == 3 and agent.calls[1]["skip_cache"] is True
    assert ids_in(agent.calls[1]["vars"]["use_cases_listing"]) == [uc["No"] for uc in ucs[26:]]
    assert ids_in(agent.calls[2]["vars"]["use_cases_listing"]) == [ucs[27]["No"]], "the one lonely theme is asked again"
    section = agent.calls[1]["vars"]["existing_themes_section"]
    assert "## THEMES ALREADY USED" in section and all(f"- Idea {i}" in section for i in range(6))
    assert [uc["idea_theme"] for uc in ucs[26:]] == ["Idea 2", "Basket Affinity", "Idea 4", "Idea 5"]
    assert report["second_call"] == 4 and report["fallback"] == 0 and report["themes"] == 7


def test_a_degenerate_answer_is_retried_without_cache_then_falls_back_to_subdomains(agent_ns):
    ucs = portfolio(30)
    for i, uc in enumerate(ucs):
        uc["Subdomain"] = f"Subdomain {i % 7}"
    one_bucket = [{"No": uc["No"], "idea_theme": "Analytics"} for uc in ucs]
    inst, agent = inst_with(agent_ns, [one_bucket, one_bucket])
    report = inst._assign_idea_themes(ucs)
    assert [c["skip_cache"] for c in agent.calls] == [False, True]
    assert report["source"] == "fallback" and report["fallback"] == 30 and report["themes"] == 7
    assert {uc["idea_theme"] for uc in ucs} == {f"Subdomain {i}" for i in range(7)}
    assert "[THEME-ASSIGN FALLBACK] the answer put 30 use cases in 1 theme, fewer than 5" in logged(inst, "warning")
    assert "[THEME-ASSIGN FIRED]" not in logged(inst)


def test_a_failed_call_falls_back_to_subdomains_never_to_one_bucket(agent_ns):
    ucs = portfolio(4)
    ucs[0]["Subdomain"], ucs[1]["Subdomain"] = "Pricing", "pricing"
    ucs[2]["Subdomain"] = ""
    ucs[3]["Subdomain"], ucs[3]["Business Domain"] = "", ""
    inst, agent = inst_with(agent_ns, [RuntimeError("endpoint unavailable")])
    report = inst._assign_idea_themes(ucs)
    assert len(agent.calls) == 1, "a raised call has already been through the model cascade"
    assert [uc["idea_theme"] for uc in ucs] == ["Pricing", "Pricing", "Sales", "Unclassified"]
    assert report["source"] == "fallback" and "the theme call failed (endpoint unavailable)" in logged(inst, "warning")


def test_over_fragmentation_is_flagged_and_a_healthy_portfolio_is_not(agent_ns):
    ucs = portfolio(24)
    inst, _agent = inst_with(agent_ns, [[{"No": uc["No"], "idea_theme": f"Idea {i}"} for i, uc in enumerate(ucs)]])
    inst._assign_idea_themes(ucs)
    assert "[THEME-ASSIGN] 24 of 24 themes hold one use case; the portfolio may be over-fragmented" in logged(inst, "warning")
    healthy = portfolio(24)
    inst, _agent = inst_with(agent_ns, [grouped(healthy, 6)])
    inst._assign_idea_themes(healthy)
    assert "over-fragmented" not in logged(inst, "warning")


def fragmented(ucs):
    first = [{"No": uc["No"], "idea_theme": f"Idea {i % 3}"} for i, uc in enumerate(ucs[:12])]
    return first + [{"No": uc["No"], "idea_theme": f"Lonely {i}"} for i, uc in enumerate(ucs[12:])]


def test_a_fragmented_answer_places_its_lonely_use_cases_again_with_the_shared_themes_listed(agent_ns):
    ucs = portfolio(30)
    again = [{"No": uc["No"], "idea_theme": f"idea {i % 3}"} for i, uc in enumerate(ucs[12:26])]
    again += [{"No": uc["No"], "idea_theme": f"Still Lonely {i}"} for i, uc in enumerate(ucs[26:])]
    inst, agent = inst_with(agent_ns, [fragmented(ucs), again])
    report = inst._assign_idea_themes(ucs)
    assert len(agent.calls) == 2 and agent.calls[1]["skip_cache"] is True
    assert ids_in(agent.calls[1]["vars"]["use_cases_listing"]) == [uc["No"] for uc in ucs[12:]], "only the lonely use cases"
    section = agent.calls[1]["vars"]["existing_themes_section"]
    assert all(f"- Idea {i}" in section for i in range(3)) and "Lonely" not in section, "only themes shared by 2 or more are listed"
    assert {uc["idea_theme"] for uc in ucs[12:26]} == {"Idea 0", "Idea 1", "Idea 2"}, "the first spelling of a shared theme wins"
    assert report["regrouped"] == 14 and report["singletons"] == 4 and report["themes"] == 7
    assert ("[THEME-REGROUP FIRED] 18 of 21 themes held one use case and the theme count is over the budget of 8; placed again with the "
            "3 shared themes listed, 4 are still alone") in logged(inst), \
        "U19 put 177 use cases in 95 themes, 53 of them alone, so the trim floor kept all 53 whatever their score"


def test_a_regroup_that_leaves_as_many_alone_or_fails_keeps_the_first_answer(agent_ns):
    ucs = portfolio(30)
    renamed = [{"No": uc["No"], "idea_theme": f"Other {i}"} for i, uc in enumerate(ucs[12:])]
    inst, agent = inst_with(agent_ns, [fragmented(ucs), renamed])
    report = inst._assign_idea_themes(ucs)
    assert len(agent.calls) == 2 and report["regrouped"] == 0 and report["singletons"] == 18
    assert [uc["idea_theme"] for uc in ucs[12:]] == [f"Lonely {i}" for i in range(18)]
    assert "left 18 alone; the first answer is kept" in logged(inst, "warning")
    ucs = portfolio(30)
    inst, agent = inst_with(agent_ns, [fragmented(ucs), RuntimeError("endpoint unavailable")])
    report = inst._assign_idea_themes(ucs)
    assert report["source"] == "model" and report["regrouped"] == 0 and report["singletons"] == 18
    assert "18 use cases of the 18 smallest themes failed (endpoint unavailable); the first answer is kept" in logged(inst, "warning")


def test_a_portfolio_with_few_lonely_themes_is_asked_once_and_one_under_20_use_cases_is_not(agent_ns):
    ucs = portfolio(30)
    answer = grouped(ucs[:28], 7) + [{"No": ucs[28]["No"], "idea_theme": "Lonely A"}, {"No": ucs[29]["No"], "idea_theme": "Lonely B"}]
    inst, agent = inst_with(agent_ns, [answer])
    report = inst._assign_idea_themes(ucs)
    assert len(agent.calls) == 2 and ids_in(agent.calls[1]["vars"]["use_cases_listing"]) == [ucs[28]["No"], ucs[29]["No"]]
    assert report["singletons"] == 2 and report["regrouped"] == 0, "an empty second answer keeps the first"
    small = portfolio(12)
    inst, agent = inst_with(agent_ns, [[{"No": uc["No"], "idea_theme": f"Idea {i}"} for i, uc in enumerate(small)]])
    inst._assign_idea_themes(small)
    assert len(agent.calls) == 1


def test_the_trim_floor_protects_one_use_case_per_idea_not_every_use_case(agent_ns):
    ucs = portfolio(40)
    for i, uc in enumerate(ucs):
        uc["bob_score"] = 9.0 - i * 0.1
        uc["bob_hard_veto_gate"] = None
    inst, _agent = inst_with(agent_ns, [grouped(ucs, 8)])
    inst._assign_idea_themes(ucs)
    kept = inst._stratified_trim_by_theme(ucs, target_max=20, theme_max_share=0.15)
    assert len(kept) == 20 and len({uc["idea_theme"] for uc in kept}) == 8
    assert max(sum(1 for uc in kept if uc["idea_theme"] == t) for t in {uc["idea_theme"] for uc in kept}) <= 3
    weakest_kept = min(uc["bob_score"] for uc in kept)
    assert weakest_kept >= 9.0 - 39 * 0.1 and sum(1 for uc in kept if uc["bob_score"] < 6.0) == 0


def test_scoring_no_longer_asks_for_themes_and_names_them_once_for_the_scored_use_cases(agent_ns):
    template = agent_ns["PROMPT_TEMPLATES"]["BEST_OF_BEST_SCORING_PROMPT"]
    assert "idea_theme" not in template and "idea theme" not in template.casefold()
    inst, _agent = inst_with(agent_ns, [])
    ucs = portfolio(3)
    raw = json.dumps([{"No": uc["No"], "bob_scores": {f"D{g}": 8 for g in range(1, 20)}, "idea_theme": "Ignored",
                       "bob_justification_short": "`orders` gives the signal; weakest D17"} for uc in ucs])
    parsed = inst._parse_bob_response(raw, ucs)
    assert parsed and all("idea_theme" not in rec for rec in parsed), "a theme in a scoring answer is not read"
    records = {rec["No"]: rec for rec in parsed[:2]}
    inst._build_schema_markdown_for_validation = lambda details, tables=None: ""
    inst._batch_schema_markdown = lambda details, batch, full: ""
    inst._prompt_overhead_chars = lambda prompt_name: 0
    inst.llm_timeout_seconds = 300
    inst._score_with_split_retry = lambda use_cases, fn, batch_size, label, timeout: (records, {ucs[2]["No"]: "not scored"})
    seen = []
    inst._assign_idea_themes = lambda scored: seen.append([uc["No"] for uc in scored])
    inst._score_best_of_best(ucs, [])
    assert seen == [[ucs[0]["No"], ucs[1]["No"]]], "themes are named once, for the scored use cases only"
    assert ucs[2]["bob_status"] == "unscored"


def test_the_prompt_is_registered_everywhere_a_prompt_must_be_and_the_merge_pass_is_gone(agent_ns):
    name = "THEME_ASSIGNMENT_PROMPT"
    template = agent_ns["PROMPT_TEMPLATES"][name]
    for field in ("{use_cases_listing}", "{existing_themes_section}", "{method_families}", "{generation_instructions_section}"):
        assert field in template
    assert "Never make a catch-all theme" in template and "exactly once" in template
    assert name in agent_ns["LLM_JSON_FORMAT_PROMPTS"] and name in agent_ns["PROMPT_STORY_TITLES"]
    assert name in agent_ns["GENERATION_DIRECTIVE_CATEGORIES_BY_PROMPT"]
    configs = [m for m in agent_ns["TECHNICAL_CONTEXT"]["prompts_models"] if m.get("prompt_name") == name]
    assert len(configs) == 1 and configs[0]["temperature"] == 0.0 and configs[0]["progress_increment"] == 0.0
    assert "THEME_MERGE_PROMPT" not in agent_ns["PROMPT_TEMPLATES"]
    assert all(m.get("prompt_name") != "THEME_MERGE_PROMPT" for m in agent_ns["TECHNICAL_CONTEXT"]["prompts_models"])
    assert "bob_theme_merge_min_themes" not in agent_ns["TECHNICAL_CONTEXT"]["runtime"]
    assert not hasattr(agent_ns["DatabricksInspire"], "_merge_near_duplicate_themes")
