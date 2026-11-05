import json
import os

import pytest

TARGETS = {"app": "App (Billing breaks)", "dashboard": "Dashboard", "genie_space": "Genie Agent", "alert": "Alert",
           "notebook": "the analysis notebook that computes the results (columns, model, time windows, scoring)"}
CLERK = ("Add a bar chart of under-billing leakage by clerk for the top 10 clerks, titled Leakage by clerk, next to Current billing "
         "breaks by order month")
HOUR = "Add a bar chart of trips by hour of day (0-23) to the App page, under Key numbers, titled Trips by pickup hour"


def _route(agent_ns, asks, routes, targets=TARGETS):
    reply = {"routes": [{"ask": n, "asset": asset, "words": words} for n, asset, words in routes]}
    return agent_ns["implement_vibe_routes"](reply, targets, asks)


def test_a_chart_ask_the_router_splits_into_a_notebook_top_10_keeps_every_row(agent_ns):
    routes, fallback = _route(agent_ns, [CLERK], [(1, "app", CLERK), (1, "notebook", "under-billing leakage by clerk for the top 10 clerks")])
    assert routes["app"] == CLERK
    assert routes["notebook"] == "under-billing leakage by clerk"
    assert "top 10" not in routes["notebook"].lower()
    assert [f["asset"] for f in fallback] == ["app"] and "the notebook keeps every row" in fallback[0]["reason"]


def test_a_chart_ask_the_router_sent_to_the_notebook_alone_goes_to_the_app(agent_ns):
    routes, fallback = _route(agent_ns, [CLERK], [(1, "notebook", CLERK)])
    assert routes["app"] == CLERK
    assert "top 10" not in routes["notebook"].lower() and "leakage by clerk" in routes["notebook"]
    assert len(fallback) == 1


def test_a_chart_ask_goes_to_the_dashboard_when_no_app_is_ticked(agent_ns):
    targets = {k: v for k, v in TARGETS.items() if k != "app"}
    routes, _fallback = _route(agent_ns, [CLERK], [(1, "notebook", "the top 10 clerks")], targets)
    assert routes == {"dashboard": CLERK}


@pytest.mark.parametrize("ask, sent, expected", [
    (CLERK, [(1, "app", CLERK)], {"app": CLERK}),
    (HOUR, [(1, "app", HOUR)], {"app": HOUR}),
    ("Show a KPI tile of total leakage in Key numbers", [(1, "notebook", "total leakage")],
     {"notebook": "total leakage", "app": "Show a KPI tile of total leakage in Key numbers"}),
    ("Add a line chart of the forecast for the next 12 weeks", [(1, "notebook", "the forecast for the next 12 weeks"),
                                                                 (1, "app", "Add a line chart of the forecast for the next 12 weeks")],
     {"notebook": "the forecast for the next 12 weeks", "app": "Add a line chart of the forecast for the next 12 weeks"}),
    ("Limit the decision list to the top 10 clerks", [(1, "notebook", "Limit the decision list to the top 10 clerks")],
     {"notebook": "Limit the decision list to the top 10 clerks"}),
    ("Add a churn score column computed by a model", [(1, "notebook", "Add a churn score column computed by a model")],
     {"notebook": "Add a churn score column computed by a model"}),
    ("Remove the Monthly deviation chart from the App page", [(1, "app", "Remove the Monthly deviation chart from the App page")],
     {"app": "Remove the Monthly deviation chart from the App page"}),
    ("Alert me when the KPI drops below 5", [(1, "alert", "Alert me when the KPI drops below 5")],
     {"alert": "Alert me when the KPI drops below 5"}),
    ("Add a Genie question that charts leakage by clerk", [(1, "genie_space", "Add a Genie question that charts leakage by clerk")],
     {"genie_space": "Add a Genie question that charts leakage by clerk"}),
    ("Rename the What to do now section to Investigation priorities", [(1, "app", "Rename the What to do now section to Investigation priorities")],
     {"app": "Rename the What to do now section to Investigation priorities"}),
])
def test_sample_asks_reach_the_parts_they_change(agent_ns, ask, sent, expected):
    routes, _fallback = _route(agent_ns, [ask], sent)
    assert routes == expected


def test_the_router_prompt_keeps_chart_limits_with_the_part(agent_ns):
    prompt = agent_ns["implement_vibe_route_prompt"]([CLERK], TARGETS)
    assert "the notebook never filters, ranks or cuts its rows for it" in prompt
    assert prompt.startswith(agent_ns["USER_DIRECTIVE_SUPREMACY_PREAMBLE"])


def _spec(app_vibes="", notes="", app=True, **extra):
    outputs = {"app": app, "dashboard": True}
    if app_vibes:
        outputs["app_vibes"] = app_vibes
    return dict({"outputs": outputs, "data": {"notes": notes} if notes else {}}, **extra)


def test_a_built_ask_taken_out_becomes_an_undo_ask_for_its_part(agent_ns):
    kept = "Rename the What to do now section to Investigation priorities"
    before, after = _spec(f"{HOUR}\n{kept}"), _spec(kept, retry_outputs=["app"])
    removed = agent_ns["implement_removed_asks"](before, after)
    assert removed == {"app": [HOUR]}
    undo = agent_ns["implement_undo_routes"](removed)
    assert undo["app"].startswith("Undo this earlier ask on the App") and HOUR in undo["app"]
    spec, changed, problems = agent_ns["implement_apply_vibe_routes"](after, undo)
    assert problems == [] and "app" in spec["retry_outputs"]
    assert agent_ns["implement_vibe_asks"](changed["app_vibes"]) == [kept, undo["app"]]
    assert agent_ns["implement_version_asks"](spec), "the undo is an ask of this version, so the version is judged on it"
    plan = agent_ns["implement_plan"](before, spec, {"app": "a1", "dashboard": "d1", "preview_run_id": 1}, has_built_notebook=True)
    assert "app" in plan["refresh"]


def test_nothing_taken_out_sends_no_undo(agent_ns):
    same = _spec(HOUR)
    assert agent_ns["implement_removed_asks"](same, _spec(HOUR)) == {}
    assert agent_ns["implement_removed_asks"](None, _spec(HOUR)) == {}
    assert agent_ns["implement_removed_asks"](_spec(HOUR), _spec(f"{HOUR}\nAdd a KPI tile of trips")) == {}


def test_no_undo_for_an_unticked_part_a_rollback_or_an_earlier_undo(agent_ns):
    before = _spec(HOUR)
    assert agent_ns["implement_removed_asks"](before, _spec("", app=False)) == {}
    assert agent_ns["implement_removed_asks"](before, _spec("", rollback_outputs={"app": 3})) == {}
    undo = agent_ns["implement_undo_routes"]({"app": [HOUR]})["app"]
    assert agent_ns["implement_removed_asks"](_spec(undo), _spec("")) == {}


def test_a_notebook_ask_taken_out_is_undone_in_the_notebook(agent_ns):
    ask = "Score orders over the last 90 days only"
    removed = agent_ns["implement_removed_asks"](_spec(notes=ask), _spec())
    assert removed == {"notebook": [ask]}
    spec, _changed, problems = agent_ns["implement_apply_vibe_routes"](_spec(), agent_ns["implement_undo_routes"](removed))
    assert problems == [] and ask in spec["data"]["notes"] and spec["data"]["notes"].startswith("Undo this earlier ask")


SEEN_WITH = {"trips_by_pickup_hour": {"name": "Trips by pickup hour", "kind": "chart", "aliases": ["Trips by pickup hour", "trips_by_pickup_hour"],
                                      "node": {}},
             "key_numbers": {"name": "Key numbers", "kind": "kpi", "aliases": ["Key numbers"], "node": {}}}
SEEN_WITHOUT = {k: v for k, v in SEEN_WITH.items() if k != "trips_by_pickup_hour"}


def _checked(agent_ns, ask, seen, earlier):
    return agent_ns["implement_vibes_checked"](ask, "app", {}, seen, None, earlier, "App page n02_u01")


def test_an_undo_of_a_chart_that_is_still_on_the_page_is_not_met(agent_ns):
    ask = {"ask": agent_ns["implement_undo_routes"]({"app": [HOUR]})["app"], "where": "Trips by pickup hour", "check": None}
    status, evidence = _checked(agent_ns, ask, SEEN_WITH, SEEN_WITH)
    assert status == "missing" and "still has the Trips by pickup hour" in evidence


def test_an_undo_of_a_chart_that_is_gone_is_met(agent_ns):
    ask = {"ask": agent_ns["implement_undo_routes"]({"app": [HOUR]})["app"], "where": "Trips by pickup hour", "check": None}
    status, evidence = _checked(agent_ns, ask, SEEN_WITHOUT, SEEN_WITH)
    assert status == "done" and "no longer has the Trips by pickup hour" in evidence


def test_a_remove_ask_is_met_when_the_chart_is_gone_and_not_met_while_it_stays(agent_ns):
    ask = {"ask": "Remove the Trips by pickup hour chart from the App page", "where": "the Trips by pickup hour chart",
           "check": {"kind": "chart_type", "value": "bar"}}
    assert _checked(agent_ns, ask, SEEN_WITHOUT, SEEN_WITH)[0] == "done"
    assert _checked(agent_ns, ask, SEEN_WITH, SEEN_WITH)[0] == "missing"


def test_an_add_ask_is_not_read_as_a_removal(agent_ns):
    removal, verdict = agent_ns["implement_vibes_taken_out"]({"ask": HOUR, "where": "Trips by pickup hour"}, SEEN_WITH, SEEN_WITHOUT,
                                                             "App page")
    assert removal is False and verdict is None
    undo_of_remove = agent_ns["implement_undo_routes"]({"app": ["Remove the Order year filter from the App page"]})["app"]
    removal, _verdict = agent_ns["implement_vibes_taken_out"]({"ask": undo_of_remove, "where": ""}, SEEN_WITH, SEEN_WITH, "App page")
    assert removal is False, "undoing a removal brings the element back, so it is checked like an add"


def test_the_run_turns_a_taken_out_ask_into_an_undo_before_it_plans():
    import ast

    import _agentload
    source = ast.unparse(_agentload.method_node("DatabricksInspire", "_implement_one_locked"))
    assert "implement_undo_routes(implement_removed_asks(previous_spec, spec)" in source
    assert source.index("implement_undo_routes(") < source.index("plan = implement_plan(")
    assert "[VIBE-UNDO FIRED]" in source


def test_a_built_part_whose_vibes_changed_is_rebuilt_with_them_and_an_unbuilt_one_is_refused_as_the_app_does(agent_ns):
    with open(os.path.join(os.path.dirname(__file__), "..", "fixtures", "implement_notebook_parity.json")) as handle:
        cases = json.load(handle)["part_problems"]
    assert len(cases) >= 6 and any(c["problems"] == [] for c in cases) and any(c["problems"] for c in cases)
    validate = agent_ns["validate_implement_spec"]
    for case in cases:
        impact = agent_ns["implement_notebook_impact"](case["asset_status"])
        previous, spec = validate(case["previous"], impact=impact)[0], validate(case["spec"], impact=impact)[0]
        rebuilt = agent_ns["implement_with_vibed_parts"](case["asset_status"], previous, spec)
        assert rebuilt["retry_outputs"] == case["retry"], case["name"]
        assert agent_ns["implement_part_problems"](case["asset_status"], previous, rebuilt) == case["problems"], case["name"]
