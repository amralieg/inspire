import ast
import json
import os

import pytest

from _agentload import agent_source
from v120_artifacts_support import FakeSpark
from v120_genie_support import build_inspire, make_uc
from v140_implement_test import VALID, _inspire, _spec
from v143_vibes_test import ALL, BUILT, LIVE, VIBES, _left_by, _locked, _run

PAGE = {"id": "n01_u01", "title": "Churn desk", "question": "Who is about to leave?",
        "filters": [{"id": "region", "type": "multi_select", "label": "Region", "columns": {"records": "region"}}],
        "kpis": [{"id": "at_risk", "label": "Customers at risk", "dataset": "records", "expression": "COUNT(*)", "format": "integer"}],
        "charts": [{"id": "by_region", "type": "bar", "x": "region", "y": "value", "dataset": "records", "sort": "value_desc",
                    "title": "Customers by region", "hint": "Where the customers at risk are"}],
        "records": {"key": "entity_id", "rank": "rank", "columns": ["entity_label", "value_at_stake"]}}
WIDGET_VIBES = "Make it a horizontal bar chart and keep the biggest regions first"
PAGE_VIBES = "  Keep the region filter and add a count of customers at risk\n"
SPLITS = {
    WIDGET_VIBES: [{"ask": "Make it a horizontal bar chart", "check": {"kind": "chart_type", "value": "horizontal bar"}, "keep": False,
                    "where": ""},
                   {"ask": "Keep the biggest regions first", "check": {"kind": "sort", "value": "value", "direction": "desc"},
                    "keep": True, "where": ""}],
    PAGE_VIBES: [{"ask": "Keep the region filter", "check": {"kind": "filter", "value": "region"}, "keep": True, "where": ""},
                 {"ask": "Add a count of customers at risk", "check": None, "keep": False, "where": ""}],
}
PARTS = {"app:page:n01_u01": {"state": "ready", "spec_version": 2, "title": "Churn desk"},
         "dashboard:by_region": {"state": "ready", "spec_version": 2, "title": "Customers by region"}}


def _llm(inst, splits=SPLITS, verdict=("done", "Customers at risk")):
    seen = []

    def llm(kind, prompt, schema):
        seen.append((kind, prompt))
        if kind == "split":
            text = prompt.split('"""\n', 1)[1].rsplit('\n"""', 1)[0]
            return {"asks": splits[text]}
        count = prompt.split("The asks:\n", 1)[1].split("\n\n", 1)[0].count("\n") + 1
        return {"checks": [{"n": n, "status": verdict[0], "evidence": verdict[1]} for n in range(1, count + 1)]}

    inst._implement_vibes_llm = llm
    return seen


def _built(name, page):
    def build(context, runner):
        context.setdefault("artifacts", {})[name] = json.loads(json.dumps(page))
        return {"dashboard_id": "d1", "dashboard_url": "https://h/d"} if name == "dashboard" else {"app_name": "churn-desk",
                                                                                                    "app_url": "https://a"}
    return build


def _carrying(inst, parts=PARTS, **outputs):
    status = _left_by(2, json.loads(json.dumps(LIVE)))
    status.update(json.loads(json.dumps(parts)))
    for name, record in outputs.items():
        status[name] = dict(status[name], **record)
    inst._implement_carried = lambda target: (dict(BUILT), json.loads(json.dumps(status)))


def _vibed(previous, retry=(), **vibes):
    return dict(previous, outputs={**previous["outputs"], **vibes}, retry_outputs=list(retry))


def test_part_vibes_are_kept_word_for_word_under_their_own_keys_like_the_wizard_keeps_them(agent_ns):
    spec, errors = _spec(agent_ns, outputs={**VALID["outputs"], "app:page:n01_u01_vibes": PAGE_VIBES, "dashboard:by_region_vibes": WIDGET_VIBES,
                                             "ai_reasoning_vibes": "Answer in Arabic", "value_formula_vibes": "Count the weeks left",
                                             "dashboard:kpi_vibes": " ", "pdf:page_vibes": "x", "notebook_vibes": "y",
                                             "app:page:Bad Id_vibes": "z"})
    assert errors == []
    out = spec["outputs"]
    assert out["app:page:n01_u01_vibes"] == PAGE_VIBES, "the user's text is stored exactly as typed, never trimmed"
    assert not {"dashboard:kpi_vibes", "pdf:page_vibes", "notebook_vibes", "app:page:Bad Id_vibes"} & set(out), \
        "blank, unknown and malformed keys are left out without an error, as the wizard leaves them out"
    assert agent_ns["implement_asset_vibes"](out) == {"ai_reasoning": "Answer in Arabic", "app:page:n01_u01": PAGE_VIBES,
                                                      "dashboard:by_region": WIDGET_VIBES, "value_formula": "Count the weeks left"}
    assert agent_ns["implement_vibed_assets"](dict(out, dashboard_vibes="Put the top 10 first"), "dashboard") == {
        "dashboard": "Put the top 10 first", "dashboard:by_region": WIDGET_VIBES}
    dropped, errors = _spec(agent_ns, outputs={**VALID["outputs"], "app": False, "app:page:n01_u01_vibes": "x"})
    assert errors == [] and "app:page:n01_u01_vibes" not in dropped["outputs"], "a part of an unticked output is dropped"
    assert _spec(agent_ns, outputs={**VALID["outputs"], "dashboard:by_region_vibes": "v" * 2001})[1] == [
        "the dashboard chart by_region vibes are 2001 characters; at most 2000 are allowed"]
    assert _spec(agent_ns, outputs={**VALID["outputs"], "app:page:n01_u01_vibes": 5})[1] == ["outputs.app:page:n01_u01_vibes must be text, not 5"]
    assert agent_ns["IMPLEMENT_PART_RE"].pattern == "^(app:page|dashboard):([A-Za-z0-9_-]{1,64})$"
    assert [agent_ns["implement_part"](a) for a in ("app:page:decisions", "dashboard:by_region", "ai_reasoning", "value_formula",
                                                     "dashboard", "app:page:", "notebook")] == [
        ("app", "App page decisions"), ("dashboard", "dashboard chart by_region"), ("notebook", "AI reasoning"),
        ("notebook", "amount at stake formula"), None, None, None]


@pytest.mark.parametrize("retry,asks,rollback,errors", [
    (["app:page:n01_u01", "dashboard:by_region", "ai_reasoning", "value_formula", "app:page:n01_u01"], None, None, []),
    (["app:page:n01_u01"], {"app:page:n01_u01": ["Keep the region filter"]}, None, []),
    (["pdf:page"], None, None, ["retry output 'pdf:page' is not one of notebook, genie_space, dashboard, app, alert"]),
    (["app:page:Bad Id"], None, None, ["retry output 'app:page:Bad Id' is not one of notebook, genie_space, dashboard, app, alert"]),
    ([], {"app": ["x"]}, None, ["retry_asks names 'app', which this version does not rebuild; list it in retry_outputs too"]),
    (["app"], {"app": []}, None, ["retry_asks.app must list at least one ask to try again"]),
    (["app"], {"app": [" ", ""]}, None, ["retry_asks.app must list at least one ask to try again"]),
    (["app"], {"app": "x"}, None, ["retry_asks.app must be a list"]),
    (["app"], {"app": [5]}, None, ["each item of retry_asks.app must be text, not 5"]),
    (["dashboard:by_region"], {"dashboard:by_region": ["v" * 2001]}, None,
     ["each ask to try again on the dashboard chart by_region must be at most 2000 characters"]),
    (["app"], "x", None, ["retry_asks must be an object"]),
    (["dashboard:by_region"], None, {"dashboard": 1}, ["the Dashboard cannot be retried and rolled back in the same version"]),
])
def test_part_retries_and_their_asks_are_checked_with_the_wizard_s_own_words(agent_ns, retry, asks, rollback, errors):
    changes = {"retry_outputs": retry, **({"retry_asks": asks} if asks is not None else {}),
               **({"rollback_outputs": rollback} if rollback else {})}
    spec, found = _spec(agent_ns, outputs={**VALID["outputs"], "alert": True, "alert_recipients": ["owner@example.com"]}, **changes)
    assert found == errors
    if not errors:
        assert spec["retry_outputs"] == list(dict.fromkeys(retry))
        assert spec.get("retry_asks") == asks
    unticked = _spec(agent_ns, outputs={**VALID["outputs"], "dashboard": False}, retry_outputs=["dashboard:by_region"])[1]
    assert unticked == ["the dashboard chart by_region cannot be rebuilt: the Dashboard is not selected"]


def test_rebuilding_a_part_rebuilds_only_its_parent_and_a_notebook_part_reruns_the_notebook(agent_ns):
    plan = agent_ns["implement_plan"]
    assets = {"genie_space": "g1", "dashboard": "d1", "app": "churn-desk", "preview_run_id": 5}
    before = _spec(agent_ns, outputs=ALL)[0]

    def after(retry=(), **vibes):
        return _spec(agent_ns, outputs={**ALL, **vibes}, retry_outputs=list(retry))[0]

    page = plan(before, after(["app:page:n01_u01"], **{"app:page:n01_u01_vibes": PAGE_VIBES}), assets, has_built_notebook=True)
    assert (page["refresh"], page["refill"], page["preview"]) == (["app"], False, False)
    chart = plan(before, after(["dashboard:by_region"]), assets, has_built_notebook=True)
    assert (chart["refresh"], chart["refill"]) == (["dashboard"], False), "a chart rebuilt without new vibes still rebuilds"
    assert plan(before, after(["value_formula"]), assets, has_built_notebook=True)["refill"] is True
    reasoning = plan(before, after(["ai_reasoning"]), assets, has_built_notebook=True)
    assert (reasoning["refill"], reasoning["preview"], reasoning["refresh"]) == (False, True, [])
    look = _spec(agent_ns, outputs={**ALL, "app_look": {"palette": "ocean"}}, retry_outputs=["app:page:n01_u01"])[0]
    assert plan(before, look, assets, has_built_notebook=True)["restyle"] == [], "a rebuilt page goes through Genie, never a restyle"
    same = after(ai_reasoning_vibes="Answer in Arabic")
    padded = after(ai_reasoning_vibes="  Answer in Arabic \n")
    assert plan(same, padded, assets, has_built_notebook=True)["classes"] == [], "spaces around the vibes change nothing"


def test_an_unbuilt_part_or_new_part_vibes_without_a_rebuild_keep_the_wizard_s_refusal(agent_ns):
    problems = agent_ns["implement_part_problems"]
    before = _spec(agent_ns, outputs=ALL)[0]
    status = dict(PARTS, ai_reasoning={"state": "ready"}, **{"dashboard:gone": {"state": "deleted"}})
    vibed = _spec(agent_ns, outputs={**ALL, "app:page:n01_u01_vibes": PAGE_VIBES}, retry_outputs=["app:page:n01_u01"])[0]
    assert problems(status, before, vibed) == []
    unlisted = _spec(agent_ns, outputs={**ALL, "app:page:n01_u01_vibes": PAGE_VIBES})[0]
    assert problems(status, before, unlisted) == []
    assert agent_ns["implement_with_vibed_parts"](status, before, unlisted)["retry_outputs"] == ["app:page:n01_u01"]
    unbuilt = _spec(agent_ns, outputs={**ALL, "dashboard:by_store_vibes": "Red"})[0]
    assert agent_ns["implement_with_vibed_parts"](status, before, unbuilt) is unbuilt, "a part this MVP never built is not added"
    for part in ("dashboard:gone", "dashboard:by_store", "value_formula"):
        retried = _spec(agent_ns, outputs=ALL, retry_outputs=[part])[0]
        assert problems(status, before, retried) == [
            f"Inspire has not built the {agent_ns['implement_part'](part)[1]} on this MVP, so it cannot rebuild it with your vibes; "
            "pick one this MVP built"], part
    rolled = _spec(agent_ns, outputs={**ALL, "dashboard:by_store_vibes": "x"}, rollback_outputs={"dashboard": 1})[0]
    assert problems(status, before, rolled) == [], "a rolled back output takes its saved vibes, as the wizard does"
    inst, previous = _locked(agent_ns)
    with pytest.raises(agent_ns["ImplementBlocked"], match="^Inspire has not built the dashboard chart by_store on this MVP"):
        _run(inst, _vibed(previous, ["dashboard:by_store"], **{"dashboard:by_store_vibes": "Red"}))


def test_the_genie_prompt_scopes_each_part_s_vibes_word_for_word_and_lists_its_asks(agent_ns):
    outputs = _spec(agent_ns, outputs={**ALL, "dashboard_vibes": VIBES, "dashboard:by_region_vibes": WIDGET_VIBES})[0]["outputs"]
    asks = {"dashboard:by_region": ["Make it a horizontal bar chart", "Keep the biggest regions first"]}
    block = agent_ns["implement_vibes_block"](outputs, "dashboard", "x", asks)
    preamble = agent_ns["USER_DIRECTIVE_SUPREMACY_PREAMBLE"]
    assert block.startswith(preamble) and block.count(preamble) == 1
    assert f"The customer's asks for this Dashboard, word for word:\n\"\"\"\n{VIBES}\n\"\"\"\n" in block
    assert ("The customer's asks for the chart by_region of the dashboard alone (the chart, KPI, table, filter or records list with "
            f"that id), word for word:\n\"\"\"\n{WIDGET_VIBES}\n\"\"\"\nInspire split them into these asks and checks each one in what "
            "you write:\n1. Make it a horizontal bar chart\n2. Keep the biggest regions first\n") in block
    assert agent_ns["implement_vibes_block"](outputs, "app", "x", asks) == "", "a chart's asks never reach the App"
    page = _spec(agent_ns, outputs={**ALL, "app:page:n01_u01_vibes": PAGE_VIBES})[0]["outputs"]
    assert f'"""\n{PAGE_VIBES}\n"""' in agent_ns["implement_vibes_block"](page, "app", "x"), "the part's vibes reach Genie verbatim"


def test_try_again_rebuilds_only_the_missed_asks_on_top_of_the_built_part_and_keeps_the_done_ones(agent_ns, tmp_path):
    saved = {"app": {"artifact": PAGE, "vibes": "", "spec_version": 2, "merged_into": ""}}
    inst, previous = _locked(agent_ns, {"app:page:n01_u01_vibes": PAGE_VIBES},
                             lambda s: [{"asset_snapshots": json.dumps(saved)}] if s.startswith("SELECT asset_snapshots") else [])
    inst.local_log_output_dir = str(tmp_path)
    done = {"ask": "Keep the region filter", "status": "done", "evidence": "filter region"}
    missed = {"ask": "Add a count of customers at risk", "status": "missing", "evidence": "no KPI counts them"}
    split = {"text": PAGE_VIBES, "asks": SPLITS[PAGE_VIBES]}
    _carrying(inst, dict(PARTS, **{"app:page:n01_u01": dict(PARTS["app:page:n01_u01"], state="ready_with_warnings",
                                                            vibes_checks=[done, missed], vibes_split=split)}),
              app={"snapshot": True})
    built = {}

    def app(context, runner):
        built["rebuild"], built["bases"] = context["rebuild"]["app"], dict(context["bases"])
        built["block"] = agent_ns["implement_vibes_block"](context["spec"]["outputs"], "app", "x", context["vibes_asks"],
                                                           context["rebuild"]["app"])
        return _built("app", dict(PAGE, kpis=PAGE["kpis"] + [{"id": "risk_count", "label": "Customers at risk now"}]))(context, runner)

    inst._implement_app = app
    inst._implement_runner = lambda uc: "genie"
    seen = _llm(inst, verdict=("done", "Customers at risk now"))
    spec = dict(previous, retry_outputs=["app:page:n01_u01"], retry_asks={"app:page:n01_u01": ["Add a count of customers at risk"]})
    assert _run(inst, spec) == "ready"
    assert built["rebuild"] == {"parts": ["app:page:n01_u01"], "again": {"app:page:n01_u01": ["Add a count of customers at risk"]},
                                "kept": {"app:page:n01_u01": ["Keep the region filter"]}, "file": "page.json", "based": True}
    assert json.loads(built["bases"]["app"]["page.json"]) == PAGE, "Genie starts from the page as it is now"
    block = built["block"]
    assert ("This time Inspire rebuilds only part of this App: the page n01_u01 of the App alone.\nThe page.json in your working folder "
            "is the App as it is now: start from it, change only what the parts and asks named here need, and keep everything else in "
            "it as it is.") in block
    assert "try again on only these asks, which the last build missed:\n1. Add a count of customers at risk" in block
    assert "These asks of it are already done; keep them as they are:\n1. Keep the region filter" in block
    assert f'"""\n{PAGE_VIBES}\n"""' in block and "Inspire split them into these asks" not in block
    assert [k for k, _p in seen] == ["judge"], "the split is reused and only the retried ask is judged"
    assert "1. Add a count of customers at risk" in seen[0][1] and "Keep the region filter" not in seen[0][1]
    record = inst.updates[-1]["asset_status"]["app:page:n01_u01"]
    assert record["vibes_checks"][1] == {"ask": "Add a count of customers at risk", "status": "done", "evidence": "Customers at risk now"}
    kept = record["vibes_checks"][0]
    assert (kept["ask"], kept["status"], kept["checks"]) == ("Keep the region filter", "done", [{"name": "filter: region", "passed": True}])
    assert kept["evidence"] != done["evidence"], "the done ask is checked again on the rebuilt page, never copied from before"
    assert record["state"] == "ready" and "warnings" not in record and record["vibes_split"]["text"] == PAGE_VIBES
    assert inst.updates[-1]["asset_status"]["app"]["state"] == "ready"


def test_the_genie_round_starts_from_the_saved_part_when_one_is_given(agent_ns, tmp_path):
    inst = _inspire(agent_ns, FakeSpark(), local_log_output_dir=str(tmp_path))
    inst.updates = []
    inst._implement_update = lambda key, **f: inst.updates.append(f)
    found = []

    class Runner:
        def run(self, prompt, work, schema, label=""):
            found.append(sorted(os.listdir(work)))
            return {"exit": 0}

    context = {"uc_id": "N01-U01", "key": (5150, "N01-U01", 3), "bases": {"app": {"page.json": json.dumps(PAGE)}}}
    inst._implement_genie_loop(context, Runner(), "App", "p", lambda work: {"app_name": "a"}, tools={"check.py": "x"})
    inst._implement_genie_loop(dict(context, bases={}), Runner(), "App", "p", lambda work: {"app_name": "a"}, tools={"check.py": "x"})
    assert found == [["check.py", "page.json"], ["check.py"]]


def test_every_built_output_and_part_gets_its_own_record_and_only_a_missed_ask_warns_it(agent_ns, tmp_path):
    inst, previous = _locked(agent_ns)
    inst.local_log_output_dir = str(tmp_path)
    _carrying(inst, dict(PARTS, **{"dashboard:old_chart": {"state": "ready", "spec_version": 2, "title": "Gone now"}}))
    inst._implement_runner = lambda uc: "genie"
    inst._implement_dashboard, inst._implement_app = _built("dashboard", PAGE), _built("app", PAGE)
    seen = _llm(inst)
    spec = _vibed(previous, ["dashboard:by_region", "app:page:n01_u01"], **{"dashboard:by_region_vibes": WIDGET_VIBES,
                                                                            "app:page:n01_u01_vibes": PAGE_VIBES})
    assert _run(inst, spec) == "vibe_not_met"
    status_of = inst.updates[-1]["asset_status"]
    chart = status_of["dashboard:by_region"]
    assert chart["vibes_checks"] == [
        {"ask": "Make it a horizontal bar chart", "status": "missing",
         "evidence": "the built Customers by region bar chart on the dashboard chart by_region has no horizontal_bar chart; its charts are "
                     "bar (by_region)",
         "checks": [{"name": "chart_type: horizontal bar", "passed": False}]},
        {"ask": "Keep the biggest regions first", "status": "done", "evidence": "sort: value_desc by value",
         "checks": [{"name": "sort: value", "passed": True}]}]
    assert (chart["state"], chart["spec_version"], chart["title"], chart["what"]) == (
        "ready_with_warnings", 3, "Customers by region", "Where the customers at risk are")
    page = status_of["app:page:n01_u01"]
    assert (page["state"], page["title"], page["what"]) == ("ready", "Churn desk", "Who is about to leave?")
    assert [c["status"] for c in page["vibes_checks"]] == ["done", "done"]
    assert "dashboard:old_chart" not in status_of, "a chart the new build no longer has leaves the list"
    assert (status_of["dashboard"]["state"], status_of["app"]["state"]) == ("ready", "ready"), "a part's miss never flags its parent"
    assert status_of["dashboard"]["title"] == "N01-U01 Predict churn" and status_of["app"]["title"] == "churn-desk"
    assert ("Dashboard (widget by_region): Make it a horizontal bar chart: the built Customers by region bar chart on the dashboard chart "
            "by_region has no horizontal_bar chart") in status_of["held"]["reason"], \
        "the held list is the checklist's, which names the output and the widget on it"
    assert [k for k, _p in seen] == ["split", "split", "judge"]
    whole, previous = _locked(agent_ns)
    whole.local_log_output_dir = str(tmp_path)
    _carrying(whole)
    whole._implement_runner = lambda uc: "genie"
    whole._implement_dashboard = _built("dashboard", PAGE)
    _llm(whole, splits={VIBES: [{"ask": "Always show the region", "check": {"kind": "column", "value": "region"}},
                                {"ask": "Show a map", "check": {"kind": "chart_type", "value": "heatmap"}}]})
    assert _run(whole, _vibed(previous, dashboard_vibes=VIBES)) == "vibe_not_met"
    board = whole.updates[-1]["asset_status"]["dashboard"]
    assert board["state"] == "ready_with_warnings" and [c["status"] for c in board["vibes_checks"]] == ["done", "missing"]
    assert whole.updates[-1]["asset_status"]["dashboard:by_region"]["state"] == "ready", "the whole output's miss never flags its parts"


def test_the_version_reads_checking_while_it_checks_the_asks_and_building_again_after(agent_ns, tmp_path):
    inst, previous = _locked(agent_ns)
    inst.local_log_output_dir = str(tmp_path)
    _carrying(inst)
    inst._implement_runner = lambda uc: "genie"
    inst._implement_dashboard, inst._implement_app = _built("dashboard", PAGE), _built("app", PAGE)
    order = []
    original = inst._implement_vibes_round

    def checks(*args, **kwargs):
        order.append(("check", [u.get("status") for u in inst.updates if u.get("status")][-1]))
        return original(*args, **kwargs)

    inst._implement_vibes_round = checks
    _llm(inst)
    _run(inst, _vibed(previous, ["dashboard:by_region"], **{"dashboard:by_region_vibes": WIDGET_VIBES}, app_vibes="x"))
    statuses = [u["status"] for u in inst.updates if "status" in u]
    assert order == [("check", "checking"), ("check", "checking")]
    assert statuses[statuses.index("checking") + 1] == "building_outputs", "the next output builds after the check"
    assert statuses[-1] == "vibe_not_met" and "checking" in agent_ns["IMPLEMENT_STATUSES"]
    plain, previous = _locked(agent_ns)
    plain._implement_dashboard = _built("dashboard", PAGE)
    plain._implement_runner = lambda uc: "genie"
    plain.local_log_output_dir = str(tmp_path)
    _run(plain, dict(previous, outputs={**previous["outputs"], "dashboard_name": "New name"}))
    assert "checking" not in [u.get("status") for u in plain.updates], "a build without vibes has nothing to check"


def test_a_failed_build_says_why_for_each_ask_and_fails_only_its_own_part(agent_ns):
    inst, previous = _locked(agent_ns)
    _carrying(inst)
    inst._implement_runner = lambda uc: "genie"

    def denied(context, runner):
        raise RuntimeError("PERMISSION_DENIED: User does not have CAN MANAGE on app churn-desk")

    inst._implement_app = denied
    _llm(inst)
    assert _run(inst, _vibed(previous, ["app:page:n01_u01"], **{"app:page:n01_u01_vibes": PAGE_VIBES})) == "vibe_not_met"
    final = inst.updates[-1]
    assert "App: PERMISSION_DENIED: User does not have CAN MANAGE on app churn-desk" in final["status_message"]
    page = final["asset_status"]["app:page:n01_u01"]
    assert page["state"] == "failed" and [c["evidence"] for c in page["vibes_checks"]] == [
        "the App page n01_u01 was not built: PERMISSION_DENIED: User does not have CAN MANAGE on app churn-desk"] * 2
    assert final["asset_status"]["dashboard:by_region"] == PARTS["dashboard:by_region"], "another output's part is left as it was"


def test_a_look_only_change_keeps_the_checks_of_the_page_it_did_not_rebuild(agent_ns):
    inst, previous = _locked(agent_ns, {"app_vibes": "Show a map", "app:page:n01_u01_vibes": PAGE_VIBES})
    missing = [{"ask": "Show a map", "status": "missing", "evidence": "no table holds a location"}]
    _carrying(inst, dict(PARTS, **{"app:page:n01_u01": dict(PARTS["app:page:n01_u01"], vibes_split={"text": PAGE_VIBES, "asks": SPLITS[PAGE_VIBES]},
                                                            vibes_checks=[{"ask": "Keep the region filter", "status": "done",
                                                                           "evidence": "filter region"}])}),
              app={"vibes_checks": missing, "vibes_split": {"text": "Show a map", "asks": [{"ask": "Show a map"}]}})
    asked = []
    inst._implement_runner = lambda uc: asked.append(uc) or "genie"
    inst._implement_app = lambda context, runner: {"app_name": "churn-desk", "app_url": "https://a"}
    _llm(inst)
    assert _run(inst, dict(previous, outputs={**previous["outputs"], "app_look": {"palette": "ocean"}})) == "vibe_not_met", \
        "a look-only change whose App still has an unmet ask is held"
    assert asked == ["N01-U01"], "the App's unmet ask gets a Genie round instead of a restyle with no round"
    final = inst.updates[-1]
    assert final["asset_status"]["held"]["parts"] == [] and "App: Show a map" in final["asset_status"]["held"]["reason"]


def test_a_split_or_a_judge_that_fails_checks_the_vibes_as_one_ask_and_warns(agent_ns):
    inst, previous = _locked(agent_ns)
    _carrying(inst)
    inst._implement_runner = lambda uc: "genie"
    inst._implement_app = _built("app", PAGE)

    def broken(kind, prompt, schema):
        raise RuntimeError("[REQUEST_LIMIT_EXCEEDED] the endpoint is busy")

    inst._implement_vibes_llm = broken
    assert _run(inst, _vibed(previous, ["app:page:n01_u01"], **{"app:page:n01_u01_vibes": PAGE_VIBES})) == "vibe_not_met", \
        "an ask Inspire could not check is not shown as met"
    assert inst.updates[-1]["asset_status"]["app:page:n01_u01"]["vibes_checks"] == [
        {"ask": " ".join(PAGE_VIBES.split()), "status": "missing",
         "evidence": "Inspire could not check this ask: [REQUEST_LIMIT_EXCEEDED] the endpoint is busy"}]


def test_the_split_keeps_every_ask_and_only_checks_it_can_trust(agent_ns):
    take = agent_ns["implement_vibes_asks"]
    asks = take({"asks": [{"ask": " Show  the region ", "check": {"kind": "column", "value": "region"}},
                          {"ask": "show the region", "check": None}, {"ask": "Use red", "check": {"kind": "colour", "value": "red"}},
                          {"ask": "Only above 5000", "check": {"kind": "threshold", "value": 5000}},
                          {"ask": "Big", "check": {"kind": "text", "value": True}}, {"ask": "", "check": None}, "junk"]})
    plain = {"keep": False, "where": ""}
    assert asks == [dict(plain, ask="Show the region", check={"kind": "column", "value": "region"}), dict(plain, ask="Use red", check=None),
                    dict(plain, ask="Only above 5000", check={"kind": "threshold", "value": 5000}), dict(plain, ask="Big", check=None)]
    for bad in ({"asks": []}, {}, None, {"asks": "x"}):
        with pytest.raises(ValueError, match="no ask"):
            take(bad)
    prompt = agent_ns["implement_vibes_split_prompt"]("dashboard:by_region", WIDGET_VIBES)
    assert "explicit user directives: keep every ask they make, in their own words, and never drop, merge away, soften or add one" in prompt
    assert f'"""\n{WIDGET_VIBES}\n"""' in prompt and "dashboard chart by_region" in prompt


@pytest.mark.parametrize("asset,check,status,evidence", [
    ("dashboard:by_region", {"kind": "chart_type", "value": "Bar chart"}, "done", "chart by_region: type bar"),
    ("dashboard:by_region", {"kind": "chart_type", "value": "horizontal bar"}, "missing",
     "the built dashboard chart by_region has no horizontal_bar chart; its charts are bar (by_region)"),
    ("dashboard:by_region", {"kind": "sort", "value": "value", "direction": "desc"}, "done", "sort: value_desc"),
    ("dashboard:by_region", {"kind": "sort", "value": "region", "direction": "asc"}, "missing",
     "the built dashboard chart by_region orders by sort value_desc by value, never by region"),
    ("app:page:n01_u01", {"kind": "filter", "value": "region"}, "done", "filter region:"),
    ("app:page:n01_u01", {"kind": "filter", "value": "channel"}, "missing",
     "the built App page n01_u01 has no filter on channel; its filters are region"),
    ("app:page:n01_u01", {"kind": "column", "value": "value_at_stake"}, "done", "value_at_stake"),
    ("app:page:n01_u01", {"kind": "column", "value": "margin"}, "missing", "the built App page n01_u01 names no column margin"),
    ("app:page:n01_u01", {"kind": "page", "value": "churn desk"}, "done", "page n01_u01: Churn desk"),
    ("app:page:n01_u01", {"kind": "text", "value": "customers  AT risk"}, "done", "Where the customers at risk are"),
    ("app:page:n01_u01", {"kind": "threshold", "value": 5000}, "missing", "the built App page n01_u01 uses no 5000"),
    ("dashboard:records", {"kind": "sort", "value": "rank", "direction": "asc"}, "done", "rank: rank"),
])
def test_a_checkable_ask_is_checked_against_exactly_what_was_built(agent_ns, asset, check, status, evidence):
    target, reason = agent_ns["implement_vibes_target"](asset, PAGE)
    assert reason == ""
    found = agent_ns["implement_vibes_fact"](check, target, agent_ns["implement_asset_label"](asset), ("bar", "horizontal_bar", "line"))
    assert found[0] == status and evidence in found[1], found


def test_an_ask_for_a_part_this_build_does_not_have_says_exactly_why(agent_ns):
    target = agent_ns["implement_vibes_target"]
    assert target("dashboard:by_store", PAGE) == (None, "the built dashboard has no widget by_store; its widgets are at_risk, by_region, "
                                                        "region, records")
    assert target("app:page:n02_u07", PAGE) == (None, "this use case builds the App page n01_u01, so the page n02_u07 is not one "
                                                      "Inspire builds here; open the use case that owns that page and give it these vibes")
    fact = agent_ns["implement_vibes_fact"]
    assert fact({"kind": "chart_type", "value": "map"}, PAGE, "App", ("bar",)) == (
        "missing", "the App cannot draw a map chart: it draws bar charts"), \
        "a chart type the App cannot draw is not met, so no judge can accept a stand-in for it"
    assert fact({"kind": "filter", "value": "x"}, {"title": "t"}, "Alert", ()) is None
    assert fact(None, PAGE, "App", ()) is None


def test_the_judge_must_quote_the_build_and_every_ask_gets_an_answer(agent_ns):
    judged = agent_ns["implement_vibes_judged"]
    seen = agent_ns["implement_vibes_seen"]("app:page:n01_u01", PAGE)
    asks = [{"ask": ask, "check": None, "keep": False, "where": ""} for ask in ("Count them", "Add a map", "Name it", "Say why")]
    parsed = {"checks": [{"n": 1, "status": "done", "evidence": "Customers  at RISK"}, {"n": "2", "status": "done", "evidence": "a map"},
                         {"n": 2, "status": "missing", "evidence": "x"}, {"n": 9, "status": "done", "evidence": "Churn desk"},
                         {"n": 3, "status": "maybe", "evidence": "Churn desk"}]}
    assert judged(parsed, asks, seen, "App page n01_u01") == {
        1: ("done", "Customers at RISK"),
        2: ("missing", "the check gave no words of the built App page n01_u01 that show this ask (it quoted 'a map', which the built "
                       "App page n01_u01 does not hold)"),
        3: ("missing", "the check gave no answer for this ask"), 4: ("missing", "the check gave no answer for this ask")}
    prompt = agent_ns["implement_vibes_judge_prompt"]("app:page:n01_u01", asks[1:2], seen, ["Add a map: no table holds a location"])
    assert "The customer's asks are explicit user directives" in prompt
    assert "<<<\n[page] Churn desk page:\n- Churn desk\n- Who is about to leave?\n[filters] page filter bar:\n- Region\n" in prompt
    assert "The builder said it could not do these asks:\n- Add a map: no table holds a location" in prompt


def test_the_vibes_calls_go_through_the_agent_s_llm_with_the_supremacy_preamble(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    calls = []

    class Agent:
        def _call_ai_query(self, **kwargs):
            calls.append(kwargs)
            return '```json\n{"asks": [{"ask": "Show the region", "check": null}]}\n```'

    inst.ai_agent = Agent()
    assert inst._implement_vibes_asks({}, "dashboard:by_region", "Show the region") == [{"ask": "Show the region", "check": None,
                                                                                           "keep": False, "where": ""}]
    assert calls[0]["prompt_name"] == "implement_vibes_split" and calls[0]["response_schema"] == agent_ns["IMPLEMENT_VIBES_SPLIT_SCHEMA"]
    source = agent_source()
    body = source[source.index("    def _call_ai_query(self, prompt: str"):]
    assert body.split("\n", 2)[1].strip() == "prompt = with_user_directive_preamble(prompt)"


def test_the_reasoning_asks_reach_only_the_record_reasoning_and_the_formula_asks_only_the_notebook(agent_ns):
    inst = build_inspire(agent_ns)
    uc = make_uc()
    spec = inst._genie_notebook_spec(uc)
    built = dict(uc, _implement_vibes={"ai_reasoning": "Answer in Arabic and name the store manager"},
                 _implement_asks={"ai_reasoning": ["Answer in Arabic", "Name the store manager"]},
                 _implement_again={"ai_reasoning": ["Name the store manager"]})
    source = inst._genie_run_controls_source(built, spec, str(uc.get("genie_instruction") or ""))
    run = ast.literal_eval(source.split("INSPIRE_RUN = ", 1)[1].split("\n\n\n", 1)[0])
    asks = run["ai_asks"]
    assert asks == ('The user\'s asks for the AI reasoning, word for word: """Answer in Arabic and name the store manager"""\n'
                    "Inspire split them into these asks; follow each one in every key below it concerns, and never change the keys "
                    "or their format for one:\n1. Answer in Arabic\n2. Name the store manager\n"
                    "The last run missed these asks, so follow each one closely:\n1. Name the store manager")
    categories = {"ai_cat_driver": {"meaning": "what moved it", "values": ["Price", "Volume"]}}
    prompt = agent_ns["inspire_ai_config"](categories, "ep", run["ai_context"], asks)["prompt"]
    assert prompt.index("2. Name the store manager") < prompt.index("the user's directive wins") < prompt.index('"next_action"')
    assert agent_ns["inspire_ai_config"](categories, "ep", run["ai_context"])["prompt"] == prompt.replace(asks + "\n", "")
    assert "store manager" not in agent_ns["inspire_ai_summary_prompt"](run["ai_context"]), "the run summary keeps its own prompt"
    plain = ast.literal_eval(inst._genie_run_controls_source(uc, spec, "").split("INSPIRE_RUN = ", 1)[1].split("\n\n\n", 1)[0])
    assert plain["ai_asks"] == ""
    formula = _spec(agent_ns, outputs={**ALL, "value_formula_vibes": "Count only the weeks left in the season"},
                    retry_outputs=["value_formula"], retry_asks={"value_formula": ["Count only the weeks left in the season"]})[0]
    text = agent_ns["implement_choices_markdown"](formula, asks={"value_formula": ["Count only the weeks left in the season"]},
                                                  impact=agent_ns["INSPIRE_MONEY_IMPACT"])
    assert ('- The customer\'s asks for the money at stake formula, word for word: """Count only the weeks left in the season""" They '
            "are explicit user directives for `VALUE_AT_STAKE_FORMULA`") in text
    assert ("- Inspire split the asks for the money at stake formula into these, and checks each one in the value_at_stake_formula "
            "the run writes: 1. Count only the weeks left in the season") in text
    assert ("- Try again on only these asks for the money at stake formula, which the last build missed, and keep the rest of the "
            "formula as it is: 1. Count only the weeks left in the season") in text
    assert "money at stake formula" not in agent_ns["implement_choices_markdown"](_spec(agent_ns, outputs=ALL)[0])


def test_new_reasoning_asks_rerun_the_notebook_with_them_and_record_their_checks(agent_ns):
    sample = [{"record_key": "c1", "ai_explanation": "Le client a perdu 1 400 USD.", "ai_next_action": "Appeler le magasin."}]
    columns = [{"col_name": n, "data_type": "string"} for n in ("entity_id", "ai_explanation", "value_at_stake_formula")]
    inst, previous = _locked(agent_ns, None, lambda s: sample if "ai_explanation IS NOT NULL" in s else columns
                             if s == "DESCRIBE TABLE `main`.`inspire`.`churn_out`" else [])
    _carrying(inst, dict(PARTS, ai_reasoning={"state": "ready", "spec_version": 2, "title": "AI reasoning"}))
    seen = {}
    inst._implement_refresh_run_controls = lambda uc_id, key, use_case, spec_nb, path, status, warnings: seen.update(asks=dict(
        use_case["_implement_asks"]), vibes=dict(use_case["_implement_vibes"]))
    inst._implement_keep_edits_setting = lambda *a, **k: None
    inst._implement_missing_tables = lambda tables: []
    inst._implement_role_problems = lambda spec, uc: []
    inst._implement_fill_and_preview = lambda *a: ({"status": "written", "rows_written": 40, "run_id": "r-9"}, 77, {})
    inst._implement_result_history = lambda *a: None
    inst._implement_fallback_warning = lambda *a: ""
    inst._implement_tier_warning = lambda *a: ""
    _llm(inst, splits={"Answer in French": [{"ask": "Answer in French", "check": None}]}, verdict=("done", "Appeler le magasin."))
    assert _run(inst, _vibed(previous, ["ai_reasoning"], ai_reasoning_vibes="Answer in French")) == "ready"
    assert seen == {"asks": {"ai_reasoning": ["Answer in French"]}, "vibes": {"ai_reasoning": "Answer in French"}}
    status_of = inst.updates[-1]["asset_status"]
    assert status_of["ai_reasoning"]["vibes_checks"] == [{"ask": "Answer in French", "status": "done", "evidence": "Appeler le magasin."}]
    assert (status_of["ai_reasoning"]["state"], status_of["ai_reasoning"]["spec_version"]) == ("ready", 3)
    assert status_of["ai_reasoning"]["what"] == "Why each row is flagged, what to do, and how sure"
    assert status_of["value_formula"] == {"state": "ready", "spec_version": 3, "title": "Money at stake formula",
                                          "what": "How the money at stake on each row is counted"}


def test_the_notebook_and_its_parts_are_checked_against_what_the_run_and_genie_wrote(agent_ns):
    sample = [{"record_key": "c1", "priority_tier": "Act now", "ai_explanation": "El cliente gasto 1.400 USD menos.",
               "ai_next_action": "Llamar al gerente de la tienda."}]
    queries = []

    def respond(statement):
        queries.append(statement)
        return sample if "ai_explanation IS NOT NULL" in statement else []

    inst = _inspire(agent_ns, FakeSpark(responder=respond))
    inst._implement_update = lambda key, **f: None
    cell = {"cell_type": "code", "source": ["# Score the churn risk\nmodel = fit(baseline, holdout='last 8 weeks')\n"], "metadata": {}}
    inst._implement_export_text = lambda path: json.dumps({"cells": [cell]})
    _llm(inst, splits={"Answer in Spanish": [{"ask": "Answer in Spanish", "check": None}],
                       "Count only the weeks left": [{"ask": "Count only the weeks left", "check": None}],
                       "Hold out the last 8 weeks": [{"ask": "Hold out the last 8 weeks", "check": {"kind": "text", "value": "last 8 weeks"}}]},
         verdict=("done", "Llamar al gerente de la tienda."))
    spec = _spec(agent_ns, outputs={**ALL, "ai_reasoning_vibes": "Answer in Spanish", "value_formula_vibes": "Count only the weeks left"},
                 data=dict(VALID["data"], notes="Hold out the last 8 weeks"))[0]
    context = {"uc_id": "N01-U01", "key": (5150, "N01-U01", 3), "spec": spec, "result_table": "main.inspire.churn_out",
               "asset_status": {"notebook": {"spec_version": 3, "state": "ready"}}, "vibes_split": {}, "notebook_path": "/W/nb"}
    warnings = inst._implement_notebook_vibes(context)
    notebook = context["asset_status"]["notebook"]
    assert notebook["vibes_checks"] == [{"ask": "Hold out the last 8 weeks", "status": "done",
                                         "evidence": "# Score the churn risk model = fit(baseline, holdout='last 8 weeks')",
                                         "checks": [{"name": "text: last 8 weeks", "passed": True}]}]
    assert notebook["state"] == "ready" and notebook["spec_version"] == 3
    assert context["asset_status"]["ai_reasoning"]["vibes_checks"] == [
        {"ask": "Answer in Spanish", "status": "done", "evidence": "Llamar al gerente de la tienda."}]
    assert context["asset_status"]["value_formula"]["state"] == "failed"
    assert warnings == ["Money at stake formula vibe not done: Count only the weeks left: the latest run wrote no money at stake "
                        "formula on any record"]
    assert queries[0] == ("SELECT `record_key`, `priority_tier`, `ai_explanation`, `ai_confidence_reason`, `ai_next_action`, "
                          "`ai_expected_result`, `ai_other_option`, `ai_evidence` FROM `main`.`inspire`.`churn_out` WHERE use_case_id = "
                          ":uc AND is_current AND change_source <> 'delete' AND ai_explanation IS NOT NULL ORDER BY CASE priority_tier "
                          "WHEN 'Act now' THEN 0 ELSE 1 END, `rank` LIMIT 5")
    assert "`value_at_stake_formula` FROM `main`.`inspire`.`churn_out`" in queries[1] and "ORDER BY value_at_stake DESC" in queries[1]
    source = agent_source()
    assert source.count("warnings += self._implement_notebook_vibes(context)") == 1


def test_the_app_names_the_business_and_links_each_page_to_its_alert(agent_ns):
    settings = agent_ns["implement_app_settings"]
    built = settings(1, "N01-U01 Predict churn", ["n01_u01"], None, "off", "t", {"app_access": "sp"},
                     business="  Acme   Retail " + "x" * 90, alerts={"n01_u01": "https://h/sql/alerts-v2/al-1"})
    assert built["business"] == ("Acme Retail " + "x" * 90)[:80] and built["alerts"] == {"n01_u01": "https://h/sql/alerts-v2/al-1"}
    plain = settings(1, "t", ["n01_u01"], None, "off", "t", {"app_access": "sp"}, alerts={"n01_u01": "", "n02": "https://x"})
    assert "business" not in plain and plain["alerts"] == {}, "no business name and no alert leave nothing a check would refuse"
    merge = agent_ns["implement_app_merge"]
    host = {"merged": True, "owner": ("N01-U07", "5150"), "settings": {"version": 1, "pages": ["n01_u07", "n09"], "jobs": {},
                                                                       "alerts": {"n01_u07": "https://h/sql/alerts-v2/al-7",
                                                                                  "n09": "https://h/sql/alerts-v2/al-9"}},
            "pages": [{"id": "n01_u07", "use_case_id": "N01-U07"}]}
    mine = dict(built, jobs={"n01_u01": "77"})
    merged, pages, page = merge(host, mine, {"id": "n01_u01", "use_case_id": "N01-U01"}, 5150, {})
    assert merged["alerts"] == {"n01_u07": "https://h/sql/alerts-v2/al-7", "n01_u01": "https://h/sql/alerts-v2/al-1"}, \
        "the host's other alerts stay, a page the App no longer has loses its alert"
    assert merged["business"] == built["business"]
    other = dict(host, owner=("N01-U07", "4242"))
    renamed, _p, page = merge(other, mine, {"id": "n01_u01", "use_case_id": "N01-U01"}, 5150, {})
    assert page["id"] == "n01_u01_s5150" and renamed["alerts"]["n01_u01_s5150"] == "https://h/sql/alerts-v2/al-1"
    own, _p, _page = merge({"merged": False, "owner": None, "settings": None, "pages": []}, mine, {"id": "n01_u01", "use_case_id": "N01-U01"},
                           5150, {"theme": "light"})
    assert own["alerts"] == {"n01_u01": "https://h/sql/alerts-v2/al-1"} and own["business"] == built["business"]
    inst = build_inspire(agent_ns)
    inst.business_name = "Acme Retail"
    inst._implement_builder = lambda: "builder@example.com"
    context = {"uc_id": "N01-U01", "use_case": {"Name": "Predict churn"}, "job_id": 77, "spec": {"outputs": {"alert": True, "app_access": "sp"}},
               "urls": {"alert_url": "https://h/sql/alerts-v2/al-1"}}
    core = type("Core", (), {"SETTINGS_VERSION": 1})
    written = inst._implement_app_settings(context, {"shell_core": core}, {"id": "n01_u01"}, None, "off", context["spec"]["outputs"])
    assert (written["business"], written["alerts"]) == ("Acme Retail", {"n01_u01": "https://h/sql/alerts-v2/al-1"})
    context["spec"]["outputs"]["alert"] = False
    assert inst._implement_app_settings(context, {"shell_core": core}, {"id": "n01_u01"}, None, "off", context["spec"]["outputs"])["alerts"] == {}
    assert agent_ns["IMPLEMENT_BUILD_ORDER"].index("alert") < agent_ns["IMPLEMENT_BUILD_ORDER"].index("app"), \
        "the alert is built first, so the App links this version's alert"
    assert set(agent_ns["IMPLEMENT_BUILD_ORDER"]) == set(agent_ns["IMPLEMENT_OUTPUTS"])
