"""Three samples.tpch Discover runs ended with up to 55.6% of their themes holding one use case: the theme prompt named one theme
per question with no size for the portfolio (32 use cases -> 18 themes, 10 alone), the regroup call let the model name new
themes again so it left all 10 alone, and the data signal check then dropped 5 to 7 use cases after the themes were named,
leaving more themes alone with nothing regrouping them."""
from _agentload import agent_source
from v130_theme_assignment_test import grouped, inst_with, logged, portfolio


def test_the_prompt_sizes_the_themes_to_the_portfolio(agent_ns):
    template = agent_ns["PROMPT_TEMPLATES"]["THEME_ASSIGNMENT_PROMPT"]
    assert "Name {theme_budget}, so most themes hold 2 to 6 use cases" in template
    assert "merge the closest questions of one kind of method into one theme" in template
    budget = agent_ns["DatabricksInspire"]._theme_budget
    assert [budget(n) for n in (12, 24, 29, 32, 100, 177)] == [3, 6, 8, 8, 25, 45]
    ucs = portfolio(29)
    inst, agent = inst_with(agent_ns, [grouped(ucs, 7)])
    inst._assign_idea_themes(ucs)
    assert agent.calls[0]["vars"]["theme_budget"] == "at most 8 themes for the 29 use cases of the portfolio"
    agent_ns["PROMPT_TEMPLATES"]["THEME_ASSIGNMENT_PROMPT"].format(**agent.calls[0]["vars"])


def test_the_regroup_call_keeps_the_portfolio_budget_and_asks_for_a_listed_theme_of_the_same_method(agent_ns):
    ucs = portfolio(30)
    first = grouped(ucs[:20], 4) + [{"No": uc["No"], "idea_theme": f"Lonely {i}"} for i, uc in enumerate(ucs[20:])]
    again = [{"No": uc["No"], "idea_theme": f"Idea {i % 4}"} for i, uc in enumerate(ucs[20:])]
    inst, agent = inst_with(agent_ns, [first, again])
    report = inst._assign_idea_themes(ucs)
    regroup = agent.calls[1]["vars"]
    assert regroup["theme_budget"] == "at most 8 themes for the 30 use cases of the portfolio", "the budget is the whole portfolio's"
    section = regroup["existing_themes_section"]
    assert "Name a new theme only when no listed theme uses its kind of method" in section
    assert "share such a kind of method one new theme together" in section
    assert "name a new theme only when none does" not in section
    assert report["singletons"] == 0 and report["themes"] == 4


def _themed(n_shared, n_lonely):
    ucs = portfolio(n_shared + n_lonely)
    for i, uc in enumerate(ucs):
        uc["idea_theme"] = f"Idea {i % 4}" if i < n_shared else f"Lonely {i}"
    return ucs


def test_themes_left_alone_by_the_last_drops_are_placed_again(agent_ns):
    ucs = _themed(16, 8)
    lonely = [uc["No"] for uc in ucs[16:]]
    inst, agent = inst_with(agent_ns, [[{"No": no, "idea_theme": "idea 1"} for no in lonely]])
    inst._regroup_themes_after_drops(ucs)
    [call] = agent.calls
    assert [line.split(" | ")[0][2:] for line in call["vars"]["use_cases_listing"].splitlines()] == lonely
    assert {uc["idea_theme"] for uc in ucs} == {"Idea 0", "Idea 1", "Idea 2", "Idea 3"}, "the first spelling of a theme wins"
    assert "[THEME-AFTER-DROPS FIRED] the 24 use cases left after selection hold 4 themes, 0 with one use case" in logged(inst)


def test_a_small_or_healthy_portfolio_after_the_drops_is_not_asked_again(agent_ns):
    small = _themed(10, 8)
    inst, agent = inst_with(agent_ns, [])
    inst._regroup_themes_after_drops(small)
    assert agent.calls == [] and {uc["idea_theme"] for uc in small[10:]} == {f"Lonely {i}" for i in range(10, 18)}
    healthy = _themed(24, 0)
    inst, agent = inst_with(agent_ns, [])
    inst._regroup_themes_after_drops(healthy)
    assert agent.calls == [], "4 themes of 6 use cases each fit the budget of 6 and none is alone"
    failed = _themed(16, 8)
    inst, agent = inst_with(agent_ns, [RuntimeError("endpoint unavailable")])
    inst._regroup_themes_after_drops(failed)
    assert len(agent.calls) == 1 and sum(1 for uc in failed if uc["idea_theme"].startswith("Lonely")) == 8
    assert "[THEME-AFTER-DROPS FIRED]" not in logged(inst)


def test_the_pipeline_regroups_after_the_data_signal_drops():
    source = agent_source()
    signal = source.index("final_consolidated_use_cases, _signal_drops = self._check_data_signal(")
    regroup = source.index("self._regroup_themes_after_drops(final_consolidated_use_cases)")
    assert 0 < regroup - signal < 200
