import json
import os

import pytest

from v140_implement_test import _app_flow, _churn_page
from v197_genie_question_rows_test import _logged

TOUR = json.load(open(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "agent", "app_shell", "kinds.json"), encoding="utf-8"))["tour"]

STEPS = [
    {"anchor": "decision", "title": "Keep the customers who are about to leave", "text": "This desk lists the customers most likely to leave next month. {open_count} wait for a call."},
    {"anchor": "todo", "title": "Work the call list", "text": "This box counts the customers still waiting for a call, and lists the next steps in order."},
    {"anchor": "kpis", "title": "How much is at risk", "text": "The first tile is the revenue at risk, {kpi:total_loss} today."},
    {"anchor": "value", "title": "The revenue this protects", "text": "This line shows the revenue retention should keep, and where it stands after today's calls."},
    {"anchor": "saved", "title": "Saved since go-live", "text": "This line adds up the revenue the calls have kept since the App went live."},
    {"anchor": "view", "title": "Where the risk sits", "text": "This view shows which customer groups carry the most revenue at risk. Click a group to see its customers."},
    {"anchor": "filters", "title": "Narrow the call list", "text": "Use Region and Segment to see only the customers you call."},
    {"anchor": "records", "title": "Your call list", "text": "Each customer here needs a retention call or a reason to skip it."},
    {"anchor": "top_record", "title": "Call this one first", "text": "Start with {top_record}, the most likely to leave."},
    {"anchor": "actions", "title": "Log each call", "text": "Open a customer to see the side panel and pick a choice: call made, retained or not reachable."},
    {"anchor": "bulk", "title": "Log many calls at once", "text": "Select several customers and log the same outcome for all of them in one step."},
    {"anchor": "genie", "title": "Ask why they leave", "text": "Ask Genie why a customer is likely to leave, in your own words."},
    {"anchor": "performance", "title": "See what the calls saved", "text": "Performance shows the revenue the retention calls promised and the revenue they kept."},
    {"anchor": "runs", "title": "Each run", "text": "Every refresh of this use case is a run. Open Runs to see what each one found."},
    {"anchor": "settings", "title": "Settings", "text": "Settings hold the target, how the value is measured and the rules that flag customers."},
]


def _tour_flow(ns, tmp_path, replies, page=None, languages=("English",)):
    inst, context, seen = _app_flow(ns, tmp_path, page=page, assets={"genie_space": "g1"})
    inst.output_languages = list(languages)
    asked = []

    def llm(prompt_name, display_name, prompt, schema, skip_cache=False):
        asked.append({"name": prompt_name, "prompt": prompt, "schema": schema, "skip_cache": skip_cache})
        reply = replies[min(len(asked), len(replies)) - 1]
        if isinstance(reply, Exception):
            raise reply
        return reply(prompt) if callable(reply) else reply

    inst._implement_llm_object = llm
    return inst, context, seen, asked


def _deployed(seen):
    return json.loads(seen["deployed"][0][1]["pages/n01_u01.json"])


def _core(inst):
    return inst._implement_app_shell()[1]["shell_core"]


def test_the_shipped_shell_carries_the_tour_check_and_the_lazy_engine(agent_ns):
    payload = agent_ns["implement_app_shell_payload"](agent_ns["inspire_notebook_asset"]("app_shell"))
    names = set(payload["files"])
    assert any(n.endswith("assets/Tour.js") for n in names), sorted(n for n in names if "assets" in n)
    assert "def fit_tour(" in next(v for k, v in payload["files"].items() if k.endswith("shell_core.py"))
    assert json.loads(agent_ns["inspire_notebook_asset"]("kinds"))["tour"]["languages"]["Arabic"]["code"] == "ar"


def test_the_prompt_carries_the_user_vibes_preamble_the_use_case_words_the_page_parts_and_every_output_language(agent_ns, tmp_path):
    inst, context, _seen, _asked = _tour_flow(agent_ns, tmp_path, [{"tours": []}])
    core, page = _core(inst), _churn_page(agent_ns)
    context["spec"]["data"]["notes"] = "Our reps call customers on Mondays"
    prompt = agent_ns["implement_app_tour_prompt"](context["use_case"], context["spec"], page, core.tour_registry(),
                                                   core.tour_anchors(page), ["English", "Arabic"])
    assert prompt.startswith(agent_ns["USER_DIRECTIVE_SUPREMACY_PREAMBLE"])
    assert "Name: Predict churn" in prompt and "Our reps call customers on Mondays" in prompt
    assert "the user's words win over every rule below" in prompt
    for anchor in core.tour_anchors(page):
        assert f"- `{anchor}`: " in prompt
    assert "- `view`: " not in prompt or "view" in core.tour_anchors(page)
    for kpi in page["kpis"]:
        assert f"`{{kpi:{kpi['id']}}}`" in prompt
    assert "{open_count}" in prompt and "{top_record}" in prompt
    assert f"{TOUR['least']} to {TOUR['most']} steps" in prompt and "at most 60 characters" in prompt and "at most 220 characters" in prompt
    assert "English, Arabic." in prompt
    assert agent_ns["NO_EM_DASH_RULE"] in prompt


def test_a_layout_without_a_list_never_offers_the_list_anchors(agent_ns, tmp_path):
    inst, _context, _seen, _asked = _tour_flow(agent_ns, tmp_path, [{"tours": []}])
    core = _core(inst)
    page = dict(_churn_page(agent_ns), layout="agent_chat")
    prompt = agent_ns["implement_app_tour_prompt"]({"Name": "Ask the data"}, {}, page, core.tour_registry(), core.tour_anchors(page),
                                                   ["English"])
    assert "- `records`: " not in prompt and "- `top_record`: " not in prompt and "- `decision`: " in prompt


def test_the_written_tour_keeps_only_the_output_languages_and_refuses_an_empty_reply(agent_ns):
    written = agent_ns["implement_app_tour_written"]
    reply = {"tours": [{"language": "english", "steps": STEPS}, {"language": "French", "steps": STEPS},
                       {"language": "English", "steps": []}, "bad"]}
    assert written(reply, ["English", "Arabic"]) == {"languages": ["English", "Arabic"], "steps": {"English": STEPS}}
    with pytest.raises(ValueError, match="no tour in any output language"):
        written({"tours": [{"language": "French", "steps": STEPS}]}, ["Arabic"])
    with pytest.raises(ValueError):
        written({}, ["English"])


def test_the_app_ships_the_tour_written_for_its_use_case(agent_ns, tmp_path):
    inst, context, seen, asked = _tour_flow(agent_ns, tmp_path, [{"tours": [{"language": "English", "steps": STEPS}]}])
    fields = inst._implement_app(context, None)
    assert seen["errors"] == [] and fields["app_name"] == "churn-desk"
    assert [a["name"] for a in asked] == ["implement_app_tour"] and asked[0]["skip_cache"] is False
    page = _deployed(seen)
    assert page["tour"] == {"languages": ["English"], "steps": {"English": STEPS}}
    assert not _logged(inst, "WARNING", "[IMPLEMENT-APP-TOUR FIXED]")
    assert _logged(inst, "INFO", "[IMPLEMENT-APP-TOUR] N01-U01: the App tour has 15 steps in English")
    assert context["artifacts"]["app"]["tour"] == page["tour"]


def test_a_bad_step_is_replaced_by_the_template_step_and_logged_and_the_app_still_ships(agent_ns, tmp_path):
    bad = [dict(s, text="The tile sums SELECT SUM(revenue_at_risk) FROM churn_out.") if s["anchor"] == "kpis" else dict(s) for s in STEPS]
    inst, context, seen, _asked = _tour_flow(agent_ns, tmp_path, [{"tours": [{"language": "English", "steps": bad}]}])
    inst._implement_app(context, None)
    shipped = _deployed(seen)["tour"]["steps"]["English"]
    kpis = next(s for s in shipped if s["anchor"] == "kpis")
    template = _core(inst).tour_template("kpis", "English", _deployed(seen))
    assert kpis == template and "SELECT" not in json.dumps(shipped)
    fixed = _logged(inst, "WARNING", "[IMPLEMENT-APP-TOUR FIXED] N01-U01:")
    assert len(fixed) == 1 and "raw column id or SQL" in fixed[0] and "replaced by the template step for kpis" in fixed[0]


def test_a_too_long_step_is_replaced_alone_and_the_rest_of_the_model_tour_still_ships(agent_ns, tmp_path):
    long = [dict(s, text="word " * 46) if s["anchor"] == "settings" else dict(s) for s in STEPS]
    inst, context, seen, asked = _tour_flow(agent_ns, tmp_path, [{"tours": [{"language": "English", "steps": long}]}])
    inst._implement_app(context, None)
    assert [a["name"] for a in asked] == ["implement_app_tour"], "a too-long step is not a reason to ask again"
    shipped = _deployed(seen)["tour"]["steps"]["English"]
    assert len(shipped) == len(STEPS)
    assert [s for s in shipped if s["anchor"] != "settings"] == [s for s in STEPS if s["anchor"] != "settings"]
    assert next(s for s in shipped if s["anchor"] == "settings") == _core(inst).tour_template("settings", "English", _deployed(seen))
    fixed = _logged(inst, "WARNING", "[IMPLEMENT-APP-TOUR FIXED] N01-U01:")
    assert len(fixed) == 1 and "more than 220" in fixed[0] and "replaced by the template step for settings" in fixed[0]


def test_a_tour_the_model_never_writes_is_asked_again_without_the_cache_then_falls_back_to_the_template_tour(agent_ns, tmp_path):
    inst, context, seen, asked = _tour_flow(agent_ns, tmp_path, [ValueError("timed out"), {"tours": []}])
    fields = inst._implement_app(context, None)
    assert seen["errors"] == [] and fields["app_name"] == "churn-desk", "the tour never blocks a publish"
    assert [a["skip_cache"] for a in asked] == [False, True]
    assert _logged(inst, "WARNING", "[IMPLEMENT-APP-TOUR-RETRY FIRED] N01-U01: the App tour was not written")
    assert _logged(inst, "WARNING", "[IMPLEMENT-APP-TOUR] N01-U01: the App tour was not written, so the App shows the template tour")
    steps = _deployed(seen)["tour"]["steps"]["English"]
    assert len(steps) == TOUR["most"] and steps[0]["anchor"] == "decision"
    assert steps[0] == _core(inst).tour_template("decision", "English", _deployed(seen))


def test_a_page_that_already_holds_a_valid_tour_keeps_it_with_no_model_call(agent_ns, tmp_path):
    page = _churn_page(agent_ns, tour={"languages": ["English"], "steps": {"English": STEPS}})
    inst, context, seen, asked = _tour_flow(agent_ns, tmp_path, [AssertionError("no call expected")], page=page)
    inst._implement_app(context, None)
    assert asked == [] and _deployed(seen)["tour"]["steps"]["English"] == STEPS


def test_a_held_tour_ships_the_same_page_file_byte_for_byte_wherever_the_held_page_keeps_it(agent_ns, tmp_path):
    tour = {"languages": ["English"], "steps": {"English": STEPS}}
    inst, context, seen, _asked = _tour_flow(agent_ns, tmp_path / "first", [{"tours": [{"language": "English", "steps": STEPS}]}])
    inst._implement_app(context, None)
    first = seen["deployed"][0][1]["pages/n01_u01.json"]
    held = dict({"tour": tour}, **_churn_page(agent_ns))
    assert list(held)[0] == "tour"
    again, again_context, again_seen, asked = _tour_flow(agent_ns, tmp_path / "again", [AssertionError("no call expected")], page=held)
    again._implement_app(again_context, None)
    shipped = again_seen["deployed"][0][1]["pages/n01_u01.json"]
    assert asked == [] and shipped == first
    assert list(again_context["artifacts"]["app"])[-1] == "tour" and list(context["artifacts"]["app"])[-1] == "tour"


def test_a_held_tour_missing_an_output_language_is_written_again(agent_ns, tmp_path):
    page = _churn_page(agent_ns, tour={"languages": ["English"], "steps": {"English": STEPS}})
    arabic = [dict(s, title="خطوة", text="نص الخطوة.") for s in STEPS]
    reply = {"tours": [{"language": "English", "steps": STEPS}, {"language": "Arabic", "steps": arabic}]}
    inst, context, seen, asked = _tour_flow(agent_ns, tmp_path, [reply], page=page, languages=("English", "Arabic"))
    inst._implement_app(context, None)
    assert len(asked) == 1 and "English, Arabic." in asked[0]["prompt"]
    tour = _deployed(seen)["tour"]
    assert tour["languages"] == ["English", "Arabic"] and tour["steps"]["Arabic"] == arabic
    public = _core(inst).public_tour(_deployed(seen))
    assert [(l["language"], l["dir"]) for l in public["languages"]] == [("English", "ltr"), ("Arabic", "rtl")]


def test_two_use_cases_get_two_different_tours(agent_ns, tmp_path):
    def echo(prompt):
        name = prompt.split("Name: ", 1)[1].split("\n", 1)[0]
        return {"tours": [{"language": "English", "steps": [dict(s, text=f"{s['text'].split('.')[0]}. Built for {name}.") for s in STEPS]}]}

    tours = []
    for uc, name in (("a", "Predict churn"), ("b", "Cut late deliveries")):
        inst, context, seen, asked = _tour_flow(agent_ns, tmp_path / uc, [echo])
        context["use_case"] = dict(context["use_case"], Name=name)
        inst._implement_app(context, None)
        tours.append(_deployed(seen)["tour"])
        assert f"Name: {name}" in asked[0]["prompt"]
    assert tours[0] != tours[1] and "Cut late deliveries" in json.dumps(tours[1]) and "Cut late deliveries" not in json.dumps(tours[0])
