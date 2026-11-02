"""The retail bank Discover run kept 2 of its 26 themes with one use case after the drops, and a T1 run kept 46 themes for 138
use cases (the budget is 35): the regroup asked again only when more than a quarter of the themes held one use case, so
neither run was regrouped and the trim floor protected every small theme. The regroup now asks again whenever a theme holds
one use case or the portfolio has more themes than its budget, listing the use cases of the smallest themes."""
from v130_theme_assignment_test import grouped, inst_with, logged, portfolio


def _listed(call):
    return [line.split(" | ")[0][2:] for line in call["vars"]["use_cases_listing"].splitlines() if line.startswith("- ")]


def _bank_shape():
    ucs = portfolio(93)
    first = grouped(ucs[:91], 24) + [{"No": ucs[91]["No"], "idea_theme": "Lonely A"}, {"No": ucs[92]["No"], "idea_theme": "Lonely B"}]
    return ucs, first


def test_two_lonely_themes_of_26_are_placed_again(agent_ns):
    ucs, first = _bank_shape()
    again = [{"No": ucs[91]["No"], "idea_theme": "Idea 3"}, {"No": ucs[92]["No"], "idea_theme": "idea 7"}]
    inst, agent = inst_with(agent_ns, [first, again])
    report = inst._assign_idea_themes(ucs)
    assert len(agent.calls) == 2 and _listed(agent.calls[1]) == [ucs[91]["No"], ucs[92]["No"]]
    section = agent.calls[1]["vars"]["existing_themes_section"]
    assert all(f"- Idea {i}" in section for i in range(24)) and "Lonely" not in section
    assert report["themes"] == 24 and report["singletons"] == 0 and report["regrouped"] == 2
    assert {ucs[91]["idea_theme"], ucs[92]["idea_theme"]} == {"Idea 3", "Idea 7"}, "the first spelling of a theme wins"
    assert ("[THEME-REGROUP FIRED] 2 of 26 themes held one use case and the theme count is over the budget of 24; placed again with the "
            "24 shared themes listed, 0 are still alone and the portfolio has 24 themes") in logged(inst)


def test_a_portfolio_over_its_theme_budget_merges_its_smallest_themes(agent_ns):
    ucs = portfolio(138)
    first = grouped(ucs, 46)
    sizes = {}
    for row in first:
        sizes[row["idea_theme"]] = sizes.get(row["idea_theme"], 0) + 1
    smallest = sorted(sizes, key=lambda theme: (sizes[theme], theme.casefold()))[:11]
    asked = [row["No"] for row in first if row["idea_theme"] in smallest]
    keep = [theme for theme in sizes if theme not in smallest]
    again = [{"No": no, "idea_theme": keep[i % len(keep)]} for i, no in enumerate(asked)]
    inst, agent = inst_with(agent_ns, [first, again])
    report = inst._assign_idea_themes(ucs)
    assert len(agent.calls) == 2 and sorted(_listed(agent.calls[1])) == sorted(asked) and len(asked) == 33
    assert report["themes"] == 35 and report["singletons"] == 0 and report["regrouped"] == 33
    assert "0 of 46 themes held one use case and the theme count is over the budget of 35" in logged(inst)


def test_a_regroup_that_neither_merges_nor_places_keeps_the_first_answer(agent_ns):
    ucs = portfolio(138)
    first = grouped(ucs, 46)
    inst, agent = inst_with(agent_ns, [first, [{"No": row["No"], "idea_theme": row["idea_theme"]} for row in first[:33]]])
    report = inst._assign_idea_themes(ucs)
    assert len(agent.calls) == 2 and report["themes"] == 46 and report["regrouped"] == 0
    assert "again gave 46 themes and left 0 alone; the first answer is kept" in logged(inst, "warning")


def test_lonely_themes_left_by_the_drops_are_placed_again_even_when_few(agent_ns):
    ucs = portfolio(93)
    for row, uc in zip(grouped(ucs[:91], 24), ucs):
        uc["idea_theme"] = row["idea_theme"]
    ucs[91]["idea_theme"], ucs[92]["idea_theme"] = "Lonely A", "Lonely B"
    inst, agent = inst_with(agent_ns, [[{"No": ucs[91]["No"], "idea_theme": "Idea 1"}, {"No": ucs[92]["No"], "idea_theme": "Idea 2"}]])
    inst._regroup_themes_after_drops(ucs)
    assert len(agent.calls) == 1 and _listed(agent.calls[0]) == [ucs[91]["No"], ucs[92]["No"]]
    assert "[THEME-AFTER-DROPS FIRED] the 93 use cases left after selection hold 24 themes, 0 with one use case" in logged(inst)


def test_a_portfolio_within_its_budget_and_no_lonely_theme_is_not_asked_again(agent_ns):
    ucs = portfolio(30)
    inst, agent = inst_with(agent_ns, [grouped(ucs, 7)])
    report = inst._assign_idea_themes(ucs)
    assert len(agent.calls) == 1 and report["themes"] == 7 and report["regrouped"] == 0
