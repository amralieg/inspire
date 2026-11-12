import copy
import json
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SHELL = os.path.join(ROOT, "agent", "app_shell")
SERVER = os.path.join(SHELL, "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_core
import shell_sql
from v141_app_shell_test import SETTINGS

REGISTRY = json.load(open(os.path.join(SHELL, "kinds.json"), encoding="utf-8"))
TOUR = REGISTRY["tour"]
TRANSLATED = list(json.load(open(os.path.join(SHELL, "translations.json"), encoding="utf-8")))


def example(layout):
    path = os.path.join(SHELL, "examples", f"{layout}.json")
    return json.load(open(path if os.path.isfile(path) else os.path.join(SHELL, "example_page.json"), encoding="utf-8"))


def queue_page(**changes):
    page = example("decision_queue")
    page.update(changes)
    return page


def step(anchor, title="Where the loss is", text="These numbers show how much price loss is still open on the list."):
    return {"anchor": anchor, "title": title, "text": text}


GOOD = [step("decision", "Decide which discounts to stop", "This desk shows the discounts that lose the most margin, so you stop the worst ones first."),
        step("kpis", "Margin lost to discounts", "The first tile is the margin lost this week, {kpi:total_loss} so far. Lower is better."),
        step("records", "Your discount list", "Each discount here needs a keep or stop decision. {open_count} wait for you now."),
        step("top_record", "Start with the worst", "Start with {top_record}: it loses the most margin per sale."),
        step("actions", "Keep or stop it", "Open a discount to stop it, keep it with a reason, give it to a buyer or snooze it."),
        step("genie", "Ask about a discount", "Ask Genie why a discount loses margin, in your own words.")]


def test_every_layout_names_known_anchors_and_every_language_has_every_template():
    assert set(TOUR["layouts"]) == {l["id"] for l in REGISTRY["layouts"]}
    anchors = set(TOUR["anchors"])
    assert all(set(a) <= anchors and len(set(a)) == len(a) for a in TOUR["layouts"].values())
    assert set(TOUR["languages"]) == {"English", *TRANSLATED}
    for name, words in TOUR["languages"].items():
        assert set(words["steps"]) == anchors, name
        assert set(words["ui"]) == {"skip", "back", "next", "done", "label"}, name
        assert words["code"] and all(words["ui"].values()), name
    assert TOUR["rtl"] == ["Arabic"]


@pytest.mark.parametrize("kind", [k["id"] for k in REGISTRY["kinds"]])
def test_every_kind_gets_a_valid_tour_in_every_language(kind):
    entry = next(k for k in REGISTRY["kinds"] if k["id"] == kind)
    for layout in filter(None, {entry["layout"], entry.get("decision_layout")}):
        page = dict(example(layout), layout=layout)
        anchors = shell_core.tour_anchors(page)
        assert anchors == TOUR["layouts"][layout]
        tour, _ = shell_core.fit_tour(page, list(TOUR["languages"]))
        kpi_ids = {k["id"] for k in page["kpis"]}
        for language, steps in tour["steps"].items():
            assert TOUR["least"] <= len(steps) <= TOUR["most"], (kind, layout, language)
            assert len({s["anchor"] for s in steps}) == len(steps)
            for s in steps:
                assert shell_core.tour_step_problems(s, anchors, kpi_ids) == [], (kind, layout, language, s)
        again, notes = shell_core.fit_tour(dict(page, tour=tour))
        assert again == tour and notes == []


def test_a_written_tour_that_passes_is_kept_word_for_word():
    page = queue_page(tour={"languages": ["English"], "steps": {"English": GOOD}})
    tour, notes = shell_core.fit_tour(page)
    assert notes == []
    assert tour["steps"]["English"] == sorted(GOOD, key=lambda s: TOUR["layouts"]["decision_queue"].index(s["anchor"]))


BAD = [
    ("an anchor the page does not show", lambda s: s.update(anchor="nowhere"), "is not a part this page shows", None),
    ("a records anchor on a dashboard", None, "is not a part this page shows", "dashboard"),
    ("a title over 60", lambda s: s.update(title="T" * 61), "more than 60", None),
    ("a text over 220", lambda s: s.update(text="word " * 45), "more than 220", None),
    ("an empty title", lambda s: s.update(title="  "), "the title is empty", None),
    ("a raw column id", lambda s: s.update(text="Sort by price_loss_amt to see the worst first."), "raw column id or SQL", None),
    ("a dotted table name", lambda s: s.update(text="The list reads main.pricing to find each loss."), "raw column id or SQL", None),
    ("camel case column", lambda s: s.update(text="Sort by lossAmount to see the worst first."), "raw column id or SQL", None),
    ("SQL keywords", lambda s: s.update(text="It runs SELECT loss FROM the list every day."), "raw column id or SQL", None),
    ("a SQL function", lambda s: s.update(text="The tile is sum(loss) over the week."), "raw column id or SQL", None),
    ("a comparison", lambda s: s.update(text="Rows where tier = 1 come first."), "raw column id or SQL", None),
    ("backticks", lambda s: s.update(text="The `loss` tile is the margin lost."), "raw column id or SQL", None),
    ("an unknown placeholder", lambda s: s.update(text="You could save {dollars} this week."), "unknown placeholder {dollars}", None),
    ("a kpi placeholder for a missing kpi", lambda s: s.update(text="The loss is {kpi:nope} now."), "unknown placeholder {kpi:nope}", None),
    ("a placeholder in the title", lambda s: s.update(title="{open_count} to decide"), "only the text may", None),
]


@pytest.mark.parametrize("label, breaks, expected, layout", BAD, ids=[b[0] for b in BAD])
def test_the_check_refuses_each_bad_step_and_puts_the_template_in_its_place_must_refuse(label, breaks, expected, layout):
    page = dict(example(layout), layout=layout) if layout else queue_page()
    bad = step("records")
    if breaks:
        breaks(bad)
    anchors = shell_core.tour_anchors(page)
    problems = shell_core.tour_step_problems(bad, anchors, {k["id"] for k in page["kpis"]})
    assert any(expected in p for p in problems), problems
    written = [s for s in GOOD if s["anchor"] in anchors and s["anchor"] != "records"][:4] + [bad]
    tour, notes = shell_core.fit_tour(dict(page, tour={"languages": ["English"], "steps": {"English": written}}))
    steps = tour["steps"]["English"]
    assert bad not in steps
    assert any(expected in n and "replaced by the template step for" in n for n in notes), notes
    replaced = next(n for n in notes if expected in n).rsplit(" ", 1)[1]
    template = shell_core.tour_template(replaced, "English", page)
    assert template in steps and template["title"] == TOUR["languages"]["English"]["steps"][replaced]["title"]
    assert all(shell_core.tour_step_problems(s, anchors, {k["id"] for k in page["kpis"]}) == [] for s in steps)


def test_a_repeated_anchor_and_a_non_object_step_are_refused_too_must_refuse():
    page = queue_page()
    anchors = shell_core.tour_anchors(page)
    assert "already has a step" in shell_core.tour_step_problems(step("kpis"), anchors, set(), {"kpis"})[0]
    assert shell_core.tour_step_problems("kpis", anchors, set()) == ["the step is not an object of anchor, title and text"]
    tour, notes = shell_core.fit_tour(dict(page, tour={"steps": {"English": GOOD + [dict(GOOD[1], title="Again")], "French": GOOD}}), ["English"])
    assert [s["anchor"] for s in tour["steps"]["English"]].count("kpis") == 1
    assert any("already has a step" in n for n in notes)
    assert "French" not in tour["steps"] and any("tour French: not an output language" in n for n in notes)


def test_too_many_steps_are_cut_and_too_few_are_filled_from_templates():
    page = queue_page()
    many = [step(a) for a in TOUR["layouts"]["decision_queue"]] + [step("kpis")]
    tour, notes = shell_core.fit_tour(dict(page, tour={"steps": {"English": many}}))
    assert len(tour["steps"]["English"]) == TOUR["most"] and any(f"more than {TOUR['most']}" in n for n in notes)
    tour, notes = shell_core.fit_tour(dict(page, tour={"steps": {"English": GOOD[:2]}}))
    assert len(tour["steps"]["English"]) == TOUR["least"]
    assert sum("fewer than 5 steps" in n for n in notes) == 3


def test_every_output_language_gets_its_own_steps_and_a_missing_one_is_filled_in_that_language():
    page = queue_page(tour={"steps": {"English": GOOD}})
    tour, notes = shell_core.fit_tour(page, ["English", "Arabic"])
    assert tour["languages"] == ["English", "Arabic"]
    arabic = tour["steps"]["Arabic"]
    assert len(arabic) == TOUR["most"]
    assert arabic[0]["title"] == TOUR["languages"]["Arabic"]["steps"]["decision"]["title"]
    assert any("tour Arabic: no steps were written" in n for n in notes)
    shown = shell_core.public_tour(dict(page, tour=tour))
    assert [(l["language"], l["dir"], l["code"]) for l in shown["languages"]] == [("English", "ltr", "en"), ("Arabic", "rtl", "ar")]
    assert shown["languages"][1]["ui"]["next"] == TOUR["languages"]["Arabic"]["ui"]["next"]


def test_a_language_without_template_words_falls_back_to_english_templates_and_says_so():
    tour, notes = shell_core.fit_tour(queue_page(), ["Klingon"])
    assert tour["steps"]["Klingon"][0]["title"] == TOUR["languages"]["English"]["steps"]["decision"]["title"]
    assert any("tour Klingon: no template words" in n for n in notes)


def test_templates_are_filled_from_the_use_case_and_fall_back_to_plain_words():
    page = queue_page(title="Stop margin-losing discounts")
    filled = shell_core.tour_template("decision", "English", page)
    assert "Stop margin-losing discounts" in filled["text"]
    kpis = shell_core.tour_template("kpis", "English", page)
    assert all(k["label"] in kpis["text"] for k in page["kpis"][:3])
    assert "{" not in kpis["text"]
    long = shell_core.tour_template("decision", "English", dict(page, title="A" * 200))
    assert "this use case" in long["text"] and len(long["text"]) <= TOUR["text_chars"]
    raw = shell_core.tour_template("decision", "English", dict(page, title="price_loss_desk"))
    assert "price_loss_desk" not in raw["text"]
    noun = shell_core.tour_template("records", "English", dict(page, records=dict(page["records"], label_title="Discount")))
    assert "Each discount on this list" in noun["text"] and "{open_count}" in noun["text"]


def test_two_use_cases_get_different_tours():
    one = shell_core.public_tour(queue_page(tour={"steps": {"English": GOOD}}))
    two = shell_core.public_tour(dict(example("monitor_triage"), title="Catch leaking water mains"))
    assert one["version"] != two["version"]
    assert [s["text"] for s in one["languages"][0]["steps"]] != [s["text"] for s in two["languages"][0]["steps"]]
    assert "Catch leaking water mains" in two["languages"][0]["steps"][0]["text"]


def test_the_public_page_carries_the_tour_and_its_version_follows_the_words():
    page = queue_page(tour={"steps": {"English": GOOD}})
    shown = shell_core.public_page(page)["tour"]
    assert shown["rail"] == TOUR["rail"] and shown["records"] == TOUR["records"]
    assert shown["languages"][0]["steps"][0]["title"] == GOOD[0]["title"]
    changed = copy.deepcopy(GOOD)
    changed[0]["title"] = "Decide which discounts to end"
    assert shell_core.public_page(queue_page(tour={"steps": {"English": changed}}))["tour"]["version"] != shown["version"]
    assert shell_core.public_page(queue_page(tour={"steps": {"English": GOOD}}))["tour"]["version"] == shown["version"]


def test_load_app_fits_the_tour_never_blocks_and_logs_each_replacement(tmp_path, capsys):
    page = queue_page(tour={"steps": {"English": GOOD[:4] + [step("actions", text="Sort by price_loss_amt first.")]}})
    os.makedirs(tmp_path / shell_core.PAGES_DIR)
    (tmp_path / shell_core.PAGES_DIR / f"{page['id']}.json").write_text(json.dumps(page), encoding="utf-8")
    (tmp_path / shell_core.SETTINGS_FILE).write_text(json.dumps(dict(SETTINGS, pages=[page["id"]])), encoding="utf-8")
    _, pages = shell_core.load_app(str(tmp_path))
    said = capsys.readouterr().err
    assert f"[APP-TOUR FIXED] page={page['id']} tour English step 5: the text shows a raw column id or SQL; replaced by the template step for actions" in said
    assert shell_core.tour_template("actions", "English", page) in pages[0]["tour"]["steps"]["English"]


def test_without_a_tour_registry_the_page_has_no_tour_and_nothing_breaks(monkeypatch):
    monkeypatch.setitem(shell_sql._REGISTRY, "data", {k: v for k, v in REGISTRY.items() if k != "tour"})
    assert shell_core.fit_tour(queue_page()) == (None, [])
    assert shell_core.public_page(queue_page())["tour"] is None


def test_the_tour_cap_is_the_most_parts_any_layout_shows_and_every_settings_step_names_feedback_and_reported_issues():
    assert TOUR["most"] == max(len(parts) for parts in TOUR["layouts"].values())
    for name, words in TOUR["languages"].items():
        text = words["steps"]["settings"]["text"]
        assert "Feedback" in text and "Reported issues" in text, name
        assert len(text) <= TOUR["text_chars"], name
