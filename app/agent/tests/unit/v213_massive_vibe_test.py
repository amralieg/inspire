import copy
import json
import os

import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import _inspire
from v143_vibes_test import _locked, _run

PAGE = os.path.join(os.path.dirname(__file__), "..", "..", "agent", "app_shell", "example_page.json")
ADD_CHART = "Add a line chart of loss by region titled Loss by region"
REMOVE_CHART = "Remove the How concentrated the loss is chart"
RENAME_PAGE = "Rename the page to Discount watch"
FILTER_DEFAULT = "Set the Run date filter default to the last 3 months"
ADD_KPI = "Add a KPI tile of the discount count titled Discount count"
THEME = "Change the color theme to teal"
ASKS = [ADD_CHART, REMOVE_CHART, RENAME_PAGE, FILTER_DEFAULT, ADD_KPI, THEME]
VIBE = f"{ADD_CHART}. {REMOVE_CHART}.\n{RENAME_PAGE}. {FILTER_DEFAULT}.\n{ADD_KPI}. {THEME}."
WHERE = {REMOVE_CHART: "How concentrated the loss is"}
JUDGED = {ADD_CHART: ("done", "Loss by region", "loss_by_region"), RENAME_PAGE: ("done", "Discount watch", "page"),
          FILTER_DEFAULT: ("missing", "the page filter bar shows no default of the last 3 months for Run date", ""),
          ADD_KPI: ("done", "Discount count", "discount_count"), THEME: ("done", "teal", "page"),
          REMOVE_CHART: ("done", "How concentrated the loss is", "pareto")}


def _before():
    with open(PAGE, encoding="utf-8") as handle:
        return json.load(handle)


def _after(removed=True):
    page = copy.deepcopy(_before())
    page["title"] = "Discount watch"
    page["charts"] = [c for c in page["charts"] if not (removed and c["id"] == "pareto")]
    page["charts"].append(dict(copy.deepcopy(_before()["charts"][0]), id="loss_by_region", title="Loss by region",
                               hint="Monthly loss split by region."))
    page["kpis"].append(dict(copy.deepcopy(_before()["kpis"][0]), id="discount_count", label="Discount count"))
    return page


def _asks_in(prompt):
    block = prompt.split("The asks:\n", 1)[1].split("\n\n", 1)[0]
    return [line.split(". ", 1)[1].split(" [", 1)[0] for line in block.splitlines() if ". " in line]


def _judge_llm(calls):
    def llm(kind, prompt, schema):
        calls.append((kind, prompt))
        if kind == "split":
            return {"asks": [dict({"ask": a, "check": None, "keep": False}, where=WHERE.get(a, "")) for a in ASKS]}
        return {"checks": [{"n": n, "status": JUDGED[a][0], "evidence": JUDGED[a][1], "where": JUDGED[a][2]}
                           for n, a in enumerate(_asks_in(prompt), 1)]}

    return llm


def _round(agent_ns, after):
    inst = _inspire(agent_ns, FakeSpark())
    calls = []
    inst._implement_vibes_llm = _judge_llm(calls)
    item = {"asset": "app", "text": VIBE, "artifact": after, "built_before": _before(), "reported": (), "chart_types": ()}
    found = inst._implement_vibes_round({}, [item], "N01-U05 App round 1/3")
    return found, calls


def test_one_vibe_with_six_mixed_asks_splits_into_six_asks_in_the_users_words(agent_ns):
    asks = [a.rstrip(".") for a in agent_ns["implement_vibe_asks"](VIBE)]
    assert asks == ASKS


def test_every_one_of_the_six_asks_is_routed_and_none_is_dropped(agent_ns):
    asks = agent_ns["implement_vibe_asks"](VIBE)
    targets = {"app": "App (Price-loss decision desk)", "dashboard": "Dashboard", "notebook": agent_ns["IMPLEMENT_VIBE_NOTEBOOK_TARGET"]}
    reply = {"routes": [{"ask": n, "asset": "app", "words": ask} for n, ask in enumerate(asks, 1)]}
    routes, fallback = agent_ns["implement_vibe_routes"](reply, targets, asks)
    assert list(routes) == ["app"] and fallback == []
    assert [line for line in routes["app"].splitlines()] == asks
    spec = {"outputs": {"app": True, "dashboard": True}, "data": {}, "retry_outputs": []}
    routed, changed, problems = agent_ns["implement_apply_vibe_routes"](spec, routes)
    assert problems == [] and routed["retry_outputs"] == ["app"]
    assert [a for a in ASKS if a not in routed["outputs"]["app_vibes"]] == []


@pytest.mark.parametrize("dropped", range(1, 7))
def test_a_router_reply_that_leaves_any_one_of_the_six_asks_out_is_refused(agent_ns, dropped):
    asks = agent_ns["implement_vibe_asks"](VIBE)
    reply = {"routes": [{"ask": n, "asset": "app", "words": ask} for n, ask in enumerate(asks, 1) if n != dropped]}
    with pytest.raises(agent_ns["ImplementVibeRouteError"]) as refused:
        agent_ns["implement_vibe_routes"](reply, {"app": "App"}, asks)
    assert f"sent ask {dropped} ('{asks[dropped - 1]}') to no part" in str(refused.value)


def test_a_router_that_never_places_the_remove_ask_builds_nothing_and_lists_all_six_as_not_decided(agent_ns, monkeypatch):
    monkeypatch.setitem(agent_ns, "IMPLEMENT_ROUTER_BACKOFF_S", 0)
    inst, previous = _locked(agent_ns)
    inst._implement_runner = lambda uc: pytest.fail("a vibe whose remove ask reached no part never reaches Genie")
    seen = []

    def llm(kind, prompt, schema):
        seen.append(kind)
        block = prompt.split("by number:\n", 1)[1].split("\n\n", 1)[0]
        asks = [line.split(". ", 1)[1] for line in block.splitlines() if ". " in line]
        return {"routes": [{"ask": n, "asset": "app", "words": ask} for n, ask in enumerate(asks, 1)
                           if not ask.startswith("Remove")]}

    inst._implement_vibes_llm = llm
    with pytest.raises(agent_ns["ImplementBlocked"]) as blocked:
        _run(inst, dict(previous, vibes=VIBE, vibe_previous="remove"))
    assert "to no part" in str(blocked.value) and REMOVE_CHART in str(blocked.value)
    assert seen == ["route"] * 3
    status = [u["asset_status"] for u in inst.updates if "checklist" in (u.get("asset_status") or {})][-1]
    assert [e["requirement"].rstrip(".") for e in status["checklist"]] == ASKS
    assert {e["status"] for e in status["checklist"]} == {"not_decided"}
    assert status["checklist_summary"] == {"met": 0, "total": 6, "not_decided": 6}
    assert not any(u.get("status") == "ready" for u in inst.updates)


def test_each_of_the_six_asks_is_reported_done_or_not_done_with_its_reason_and_the_remove_is_checked_on_the_page(agent_ns):
    found, calls = _round(agent_ns, _after())
    checks = found["checks"]["app"]
    assert [c["ask"] for c in checks] == ASKS
    assert all(c["status"] in ("done", "missing") and c["evidence"].strip() for c in checks)
    verdict = {c["ask"]: (c["status"], c["evidence"]) for c in checks}
    assert verdict[REMOVE_CHART] == ("done", "the built App no longer has the How concentrated the loss is pareto chart")
    assert verdict[ADD_CHART] == ("done", "Loss by region")
    assert verdict[RENAME_PAGE] == ("done", "Discount watch")
    assert verdict[ADD_KPI] == ("done", "Discount count")
    assert verdict[FILTER_DEFAULT] == ("missing", JUDGED[FILTER_DEFAULT][1])
    assert verdict[THEME][0] == "missing" and "'teal'" in verdict[THEME][1], "a done with no shown words is never taken as done"
    [judge] = [p for k, p in calls if k == "judge"]
    assert _asks_in(judge) == [ADD_CHART, RENAME_PAGE, FILTER_DEFAULT, ADD_KPI, THEME], "the remove is decided from the page itself"
    assert [c["ask"] for c in found["resend"]["app"]] == [FILTER_DEFAULT, THEME], "every ask not done goes back to Genie"
    warnings = agent_ns["implement_vibes_warnings"]("app", checks)
    assert len(warnings) == 2 and all(w.startswith("App vibe not done: ") for w in warnings)


def test_a_remove_ask_whose_chart_is_still_on_the_page_is_not_done_even_when_the_judge_says_done(agent_ns):
    found, calls = _round(agent_ns, _after(removed=False))
    verdict = {c["ask"]: (c["status"], c["evidence"]) for c in found["checks"]["app"]}
    assert verdict[REMOVE_CHART] == ("missing", "the built App still has the How concentrated the loss is pareto chart, which the ask "
                                                "takes out")
    assert REMOVE_CHART in [c["ask"] for c in found["resend"]["app"]]
    assert REMOVE_CHART not in _asks_in([p for k, p in calls if k == "judge"][0])
    warnings = agent_ns["implement_vibes_warnings"]("app", found["checks"]["app"])
    assert any(REMOVE_CHART in w for w in warnings), "the build cannot read ready while the removed chart stays"


def test_a_judge_that_quotes_a_new_line_elsewhere_never_makes_a_remove_done_while_the_chart_stays(agent_ns, monkeypatch):
    monkeypatch.setitem(JUDGED, REMOVE_CHART, ("done", "Discount watch", "page"))
    found, _calls = _round(agent_ns, _after(removed=False))
    verdict = {c["ask"]: c["status"] for c in found["checks"]["app"]}
    assert verdict[REMOVE_CHART] == "missing" and verdict[RENAME_PAGE] == "done"
