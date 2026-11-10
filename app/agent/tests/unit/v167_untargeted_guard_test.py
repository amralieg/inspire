import json
import os

import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import VALID, _inspire, _left_by, _spec
from v143_vibes_test import _run
from v152_mvp_vibe_test import _llm
from v162_one_vibe_box_test import APP_ASK, CARRIED, FIELDS, REBUILT, _rebuild

PART = "app:page:n02_u01"
GLOBE_ASK = "Show the Fourteen-day takings outlook chart on the App page as a 3D globe chart"
OUTLOOK = "the Fourteen-day takings outlook chart"
RECORDS_SQL = "SELECT * FROM main.inspire.n02_u01_out WHERE run_id = (SELECT MAX(run_id) FROM main.inspire.n02_u01_out)"
OUTLOOK_SQL = "SELECT forecast_date, SUM(value) AS expected_takings, SUM(value_at_stake) AS cash_buffer FROM main.inspire.n02_u01_out GROUP BY 1"
DIRECTION_SQL = "SELECT forecast_direction, SUM(value) AS takings FROM main.inspire.n02_u01_out GROUP BY 1"
BUFFER_SQL = "SELECT forecast_date, priority_tier, SUM(value_at_stake) AS cash_buffer FROM main.inspire.n02_u01_out GROUP BY 1, 2"
GLOBE_LINE = "Fourteen forecast days orbit the cash-planning globe; taller amber markers indicate stronger expected takings."
GLOBE = {"id": "takings_outlook", "kind": "html", "place": {"where": "before", "of": "charts"}, "width": "full", "align": "center",
         "content": f"<section class=\"globe-card\"><h2>Fourteen-day takings outlook</h2><p>{GLOBE_LINE}</p>"
                    "<div class=\"globe\"><i class=\"bar\" style=\"--a:0deg;--h:58px\"></i></div></section>"}
OUTLOOK_CHART = {"id": "takings_outlook", "title": "Fourteen-day takings outlook", "type": "line", "dataset": "outlook", "span": 2,
                 "hint": "Expected fare takings and the low-to-expected cash buffer for each forecast day.",
                 "x": {"column": "forecast_date", "kind": "time", "label": "Forecast date"},
                 "y": [{"expression": "SUM(expected_takings)", "label": "Expected takings", "format": "currency", "currency": "USD"},
                       {"expression": "SUM(cash_buffer)", "label": "Cash buffer", "format": "currency", "currency": "USD"}]}
DIRECTION_CHART = {"id": "takings_by_direction", "title": "Takings by weekly direction", "type": "horizontal_bar", "dataset": "direction",
                   "x": {"column": "forecast_direction", "label": "Weekly direction"},
                   "y": [{"expression": "SUM(takings)", "label": "Expected takings", "format": "currency", "currency": "USD"}]}
PRIORITY_CHART = {"id": "buffer_priority", "title": "Cash buffer concentration", "type": "pareto", "dataset": "records",
                  "x": {"column": "entity_label", "label": "Forecast date"},
                  "y": [{"expression": "SUM(value_at_stake)", "label": "Cash buffer", "format": "currency", "currency": "USD"}]}
TIER_CHART = {"id": "buffer_by_tier", "title": "Cash buffer by action tier", "type": "stacked_bar", "dataset": "buffer", "sort": "value_desc",
              "hint": "Daily cash buffer split by the action tier assigned to each forecast date.",
              "x": {"column": "forecast_date", "kind": "time", "label": "Forecast date"}, "series": {"column": "priority_tier", "top": 3},
              "y": [{"expression": "SUM(cash_buffer)", "label": "Cash buffer", "format": "currency", "currency": "USD"}]}
V3 = {"version": 1, "id": "n02_u01", "use_case_id": "N02-U01", "title": "Daily Fare Revenue Cash Flow Plan",
      "question": "How much fare revenue should we plan for each day, what cash buffer is prudent, and what is driving the shifts?",
      "icon": "calendar", "hue": "teal", "story": "Expected takings are {expected_takings}, with a recommended cash buffer of {cash_buffer}.",
      "questions": ["Which forecast dates need the largest cash buffers?"],
      "datasets": [{"name": "records", "sql": RECORDS_SQL}, {"name": "outlook", "sql": OUTLOOK_SQL},
                   {"name": "direction", "sql": DIRECTION_SQL}, {"name": "buffer", "sql": BUFFER_SQL}],
      "filters": [{"id": "run_date", "type": "date_range", "label": "Run date", "grain": "day", "default": "12m",
                   "columns": {"records": "as_of_date"}},
                  {"id": "priority_tier", "type": "multi_select", "label": "Action tier", "columns": {"records": "priority_tier"}}],
      "kpis": [{"id": "expected_takings", "label": "Expected takings", "dataset": "records", "expression": "SUM(value)",
                "format": "currency", "currency": "USD", "good": "up", "compare": True},
               {"id": "cash_buffer", "label": "Recommended cash buffer", "dataset": "records", "expression": "SUM(value_at_stake)",
                "format": "currency", "currency": "USD", "good": "down", "compare": True}],
      "charts": [OUTLOOK_CHART, DIRECTION_CHART, PRIORITY_CHART, TIER_CHART],
      "records": {"title": "Cash flow planning brief", "key": "record_key", "label": "entity_label", "rank": "rank",
                  "tier": "priority_tier", "columns": [{"column": "forecast_date", "label": "Forecast date", "format": "date"}]}}
V4 = dict(json.loads(json.dumps(V3)), charts=[DIRECTION_CHART, PRIORITY_CHART, dict(TIER_CHART, type="stacked_area")], blocks=[GLOBE])
GLOBE_SPLIT = [{"ask": GLOBE_ASK, "check": None, "keep": False, "where": OUTLOOK}]


def _copy(value):
    return json.loads(json.dumps(value))


def _types(page):
    return [(c["id"], c["type"]) for c in page["charts"]]


def _judge_llm(inst, splits, verdict_line=GLOBE_LINE, where="takings_outlook"):
    seen = []

    def llm(kind, prompt, schema):
        seen.append((kind, prompt))
        if kind == "split":
            return {"asks": _copy(splits[prompt.split('"""\n', 1)[1].rsplit('\n"""', 1)[0]])}
        count = prompt.split("The asks:\n", 1)[1].split("\n\n", 1)[0].count("\n") + 1
        return {"checks": [{"n": n, "status": "done", "evidence": verdict_line, "where": where} for n in range(1, count + 1)]}

    inst._implement_vibes_llm = llm
    return seen


class _Runner:
    def __init__(self, pages):
        self.pages, self.prompts = list(pages), []

    def run(self, prompt, work, schema, label=""):
        self.prompts.append(prompt)
        page = self.pages.pop(0) if len(self.pages) > 1 else self.pages[0]
        with open(os.path.join(work, "page.json"), "w", encoding="utf-8") as handle:
            json.dump(page, handle)
        return {"exit": 0}


def _page_inspire(agent_ns, tmp_path, prior=V3, ask_text=GLOBE_ASK, splits=None, guarded=("app",)):
    inst = _inspire(agent_ns, FakeSpark(), local_log_output_dir=str(tmp_path))
    inst.updates = []
    inst._implement_update = lambda key, **fields: inst.updates.append(fields)
    inst._implement_snapshot = lambda key, name, version: {"artifact": _copy(prior), "spec_version": version}
    inst._implement_input_has_dates = lambda context: False
    inst._implement_app_prompt = lambda context, shell_sql, example, event_date, name: "Write page.json."
    inst._implement_page_file = lambda context, name, work, shell_sql, event_date, fresh=False: (
        json.load(open(os.path.join(work, "page.json"), encoding="utf-8")), [])
    _judge_llm(inst, splits or {ask_text: GLOBE_SPLIT})
    context = {"uc_id": "N02-U01", "key": (5150, "N02-U01", 4), "use_case": {"No": "N02-U01"}, "guarded": list(guarded),
               "spec": {"outputs": {"app": True, f"{PART}_vibes": ask_text}, "retry_asks": {}},
               "asset_status": {"app": {"state": "ready", "spec_version": 3, "snapshot": True},
                                PART: {"state": "ready", "spec_version": 3, "title": "Daily Fare Revenue Cash Flow Plan"}},
               "vibes_split": {}, "vibes_asks": {}}
    deployed = []

    def deploy(work, page, gate=lambda: None):
        gate()
        deployed.append(_copy(page))
        return {"app_name": "inspire-hub", "app_url": "https://example.com/app"}

    return inst, context, deployed, deploy


def test_run_4b_the_globe_ask_changes_only_its_chart_and_genie_s_bar_to_area_change_is_put_back(agent_ns, tmp_path):
    inst, context, deployed, deploy = _page_inspire(agent_ns, tmp_path)
    runner = _Runner([V4])
    inst._implement_page_spec(context, runner, "app", deploy)
    [page] = deployed
    assert dict(_types(page))["buffer_by_tier"] == "stacked_bar", "no ask targets the cash buffer chart, so it stays a stacked bar"
    assert _types(page) == [("takings_by_direction", "horizontal_bar"), ("buffer_priority", "pareto"), ("buffer_by_tier", "stacked_bar")]
    assert page["blocks"] == [GLOBE], "the ask targets the takings outlook chart, so Genie's globe in its place stays"
    assert len(runner.prompts) == 3, "the globe stands in for the chart the ask names, so the vibe gate sends it back for its rounds"
    assert all("the built App page n02_u01 has no Fourteen-day takings outlook chart" in p for p in runner.prompts[1:])
    assert not any("putting them back would undo an ask" in p for p in runner.prompts), \
        "a restore that undoes no ask needs no Genie round of its own"
    [fixed] = context["untargeted"]["app"]["restored"]
    assert (fixed["key"], fixed["change"]) == ("charts:buffer_by_tier", "changed")
    assert fixed["what"] == "changed the Cash buffer by action tier chart: its type from stacked_bar to stacked_area"
    assert context["untargeted"]["app"]["blocked"] == []
    assert inst.logger.matching("[IMPLEMENT-UNTARGETED] N02-U01 App: put back the Cash buffer by action tier chart as v3 built it: no ask "
                                "targets it, and Genie changed the Cash buffer by action tier chart: its type from stacked_bar to "
                                "stacked_area", "INFO")


def test_run_4b_the_checklist_shows_the_put_back_chart_as_a_self_fix_that_counts_as_no_ask(agent_ns, tmp_path):
    inst, context, _deployed, deploy = _page_inspire(agent_ns, tmp_path)
    inst._implement_page_spec(context, _Runner([V4]), "app", deploy)
    entries = inst._implement_vibe_checklist(context)
    fixed = [e for e in entries if e.get("kind") == "self_fix"]
    assert fixed == [{"n": 2, "requirement": "Keep the Cash buffer by action tier chart as v3 built it: no ask of v4 targets it",
                      "part": "app", "where": "the Cash buffer by action tier chart", "status": "met", "kind": "self_fix",
                      "evidence": "Genie changed the Cash buffer by action tier chart: its type from stacked_bar to stacked_area; Inspire "
                                  "put it back as v3 built it",
                      "fact": "Genie changed the Cash buffer by action tier chart: its type from stacked_bar to stacked_area; Inspire "
                              "put it back as v3 built it", "rounds": 0, "tried": [], "checks": [], "published_anyway": None}]
    assert context["asset_status"]["checklist_summary"] == {"met": 0, "total": 1, "self_fixed": 1}, "the self-fix is no ask of the user"
    steps = [e for e in inst.emitted if e["step_name"] == "Self-fix"]
    assert len(steps) == 1 and steps[0]["status"] == "ended_success" and steps[0]["result_json"]["self_fixed"] == fixed
    checklist = [e for e in inst.emitted if e["step_name"] == "Vibe checklist"][-1]
    assert checklist["message"] == "0 of 1 vibe requirement met; Inspire put back 1 element no ask targets"
    assert agent_ns["implement_unmet_asks"](context["asset_status"]) and all(
        e.get("kind") != "self_fix" for e in agent_ns["implement_unmet_asks"](context["asset_status"]))


def test_an_untargeted_chart_genie_deletes_is_put_back_where_it_was(agent_ns, tmp_path):
    deleted = dict(_copy(V4), charts=[DIRECTION_CHART, dict(TIER_CHART, type="stacked_area")])
    inst, context, deployed, deploy = _page_inspire(agent_ns, tmp_path)
    inst._implement_page_spec(context, _Runner([deleted]), "app", deploy)
    assert _types(deployed[0]) == [("takings_by_direction", "horizontal_bar"), ("buffer_priority", "pareto"), ("buffer_by_tier", "stacked_bar")]
    assert {(c["key"], c["change"]) for c in context["untargeted"]["app"]["restored"]} == {
        ("charts:buffer_priority", "removed"), ("charts:buffer_by_tier", "changed")}


def test_reordered_keys_and_empty_defaults_are_never_a_change_but_a_moved_chart_is(agent_ns):
    changes, targets = agent_ns["implement_untargeted_changes"], {"keys": set(), "adds": False, "groups": set()}
    shuffled = dict(reversed(list(TIER_CHART.items())), limit=None, click_filter=None, hint=f"  {TIER_CHART['hint']}  ")
    again = dict(_copy(V3), charts=[OUTLOOK_CHART, DIRECTION_CHART, PRIORITY_CHART, shuffled], blocks=[])
    assert changes("app", V3, again, targets, "records") == [], "the same element written in another key order is the same element"
    swapped = dict(_copy(V3), charts=[DIRECTION_CHART, OUTLOOK_CHART, PRIORITY_CHART, TIER_CHART])
    assert [(c["key"], c["change"]) for c in changes("app", V3, swapped, targets, "records")] == [
        ("charts:takings_outlook", "moved"), ("charts:takings_by_direction", "moved")]
    merged, restored, blocked = agent_ns["implement_restore_untargeted"]("app", V3, swapped, changes("app", V3, swapped, targets,
                                                                                                    "records"), targets, "records")
    assert [c["id"] for c in merged["charts"]] == [c["id"] for c in V3["charts"]] and blocked == [] and len(restored) == 2


def test_a_targeted_element_may_change_and_a_whole_page_ask_may_change_everything(agent_ns, tmp_path):
    tier_ask = "Show the cash buffer by action tier as a stacked area chart"
    split = {tier_ask: [{"ask": tier_ask, "check": {"kind": "chart_type", "value": "stacked_area"}, "keep": False,
                         "where": "the Cash buffer by action tier chart"}]}
    tiered = dict(_copy(V3), charts=[OUTLOOK_CHART, DIRECTION_CHART, PRIORITY_CHART, dict(TIER_CHART, type="stacked_area")])
    inst, context, deployed, deploy = _page_inspire(agent_ns, tmp_path, ask_text=tier_ask, splits=split)
    _judge_llm(inst, split, verdict_line="Cash buffer by action tier", where="buffer_by_tier")
    inst._implement_page_spec(context, _Runner([tiered]), "app", deploy)
    assert dict(_types(deployed[0]))["buffer_by_tier"] == "stacked_area" and "app" not in context["untargeted"]
    targets = agent_ns["implement_untargeted_targets"]
    for where in ("", "the page", "the Daily Fare Revenue Cash Flow Plan page"):
        assert targets("app", [(PART, {"ask": "Make it calmer", "keep": False, "where": where})], V3, V4, "records") is None, where
    assert agent_ns["implement_untargeted_changes"]("app", V3, V4, None, "records") == []


def test_a_keep_ask_never_lets_its_element_change(agent_ns):
    asks = [(PART, {"ask": GLOBE_ASK, "keep": False, "where": OUTLOOK}),
            (PART, {"ask": "Keep the Cash buffer by action tier chart", "keep": True, "where": "the Cash buffer by action tier chart"})]
    targets = agent_ns["implement_untargeted_targets"]("app", asks, V3, V4, "records")
    assert targets["keys"] == {"charts:takings_outlook", "blocks:takings_outlook"} and targets["adds"] is False
    assert [c["key"] for c in agent_ns["implement_untargeted_changes"]("app", V3, V4, targets, "records")] == ["charts:buffer_by_tier"]


def test_an_untargeted_addition_is_dropped_with_its_own_dataset_and_a_block_ask_may_add_its_block(agent_ns):
    extra = {"id": "tip_mix", "title": "Tip mix", "type": "donut", "dataset": "tips", "x": {"column": "tier"}, "y": []}
    added = dict(_copy(V4), charts=V4["charts"] + [extra], datasets=V4["datasets"] + [{"name": "tips", "sql": "SELECT 1 AS tier"}])
    asks = [(PART, {"ask": GLOBE_ASK, "keep": False, "where": OUTLOOK})]
    targets = agent_ns["implement_untargeted_targets"]("app", asks, V3, added, "records")
    changes = agent_ns["implement_untargeted_changes"]("app", V3, added, targets, "records")
    assert {(c["key"], c["change"]) for c in changes} == {("charts:tip_mix", "added"), ("charts:buffer_by_tier", "changed")}
    merged, restored, blocked = agent_ns["implement_restore_untargeted"]("app", V3, added, changes, targets, "records")
    assert "tip_mix" not in [c["id"] for c in merged["charts"]] and "tips" not in [d["name"] for d in merged["datasets"]]
    assert [d["name"] for d in merged["datasets"]] == [d["name"] for d in V3["datasets"]] and blocked == []
    banner = {"id": "note", "kind": "text", "place": {"where": "top"}, "content": "Cash plan"}
    asked = [(PART, {"ask": "Add a note at the top", "keep": False, "check": {"kind": "block", "value": {"place": "top"}},
                     "where": OUTLOOK})]
    noted = dict(_copy(V3), blocks=[banner])
    assert agent_ns["implement_untargeted_changes"]("app", V3, noted, agent_ns["implement_untargeted_targets"](
        "app", asked, V3, noted, "records"), "records") == [], "a block check asks for a new block, so the new block may come"


SHARED = dict(_copy(V3), datasets=[{"name": "records", "sql": RECORDS_SQL}, {"name": "outlook", "sql": OUTLOOK_SQL},
                                   {"name": "direction", "sql": DIRECTION_SQL}],
              charts=[OUTLOOK_CHART, DIRECTION_CHART, PRIORITY_CHART, dict(TIER_CHART, dataset="outlook")])
SHARED_GONE = dict(_copy(SHARED), datasets=[{"name": "records", "sql": RECORDS_SQL}, {"name": "direction", "sql": DIRECTION_SQL}],
                   charts=[DIRECTION_CHART, PRIORITY_CHART], blocks=[GLOBE])


def test_an_untargeted_chart_whose_dataset_a_targeted_change_removed_goes_to_repair_never_a_silent_restore(agent_ns, tmp_path):
    inst, context, deployed, deploy = _page_inspire(agent_ns, tmp_path, prior=SHARED)
    runner = _Runner([SHARED_GONE])
    inst._implement_page_spec(context, runner, "app", deploy)
    assert len(runner.prompts) == 3, "each round with a change Inspire cannot put back is sent back to Genie"
    assert ("- the Cash buffer by action tier chart: you removed the Cash buffer by action tier chart, and Inspire could not put it back "
            "because its dataset outlook is gone for the asks of the Fourteen-day takings outlook chart. As it was: ") in runner.prompts[1]
    assert OUTLOOK_SQL in runner.prompts[1] and "give the ask a dataset of its own" in runner.prompts[1]
    sent_back = [e for e in inst.emitted if "missed the user's asks, sent back to Genie" in e["message"]]
    assert len(sent_back) == 2 and "changed what no ask targets, and Inspire could not put it back" in sent_back[0]["message"]
    assert "buffer_by_tier" not in [c["id"] for c in deployed[0]["charts"]], "a restore that would undo an ask is never made silently"
    record = context["untargeted"]["app"]
    assert record["restored"] == [] and [c["key"] for c in record["blocked"]] == ["charts:buffer_by_tier"] and record["rounds"] == 3
    entries = inst._implement_vibe_checklist(context)
    [held] = [e for e in entries if e.get("kind") == "unrequested_change"]
    assert held["status"] == "not_met" and held["rounds"] == 3 and held["requirement"].startswith(
        "Keep the Cash buffer by action tier chart as v3 built it")
    assert held["evidence"].endswith("because its dataset outlook is gone for the asks of the Fourteen-day takings outlook chart")
    assert "round" not in held["evidence"].lower(), "the entry's rounds field carries the count, so the evidence never says it again"
    assert held in agent_ns["implement_unmet_asks"](context["asset_status"]), "an unrequested change holds the version"
    assert context["asset_status"]["checklist_summary"]["met"] == 0, "an unrequested change is never counted as met"
    assert inst.logger.matching("[IMPLEMENT-UNTARGETED] N02-U01 App: the Cash buffer by action tier chart stays as Genie changed it, so "
                                "this version is held", "WARNING")


@pytest.mark.parametrize("plan,previous,current,expected", [
    ({"refill": True, "refresh": ["app"], "restyle": []}, VALID, dict(VALID, outputs={**VALID["outputs"], "app_vibes": APP_ASK}), []),
    ({"refill": False, "refresh": ["app"], "restyle": []}, VALID, dict(VALID, outputs={**VALID["outputs"], "app_vibes": APP_ASK}),
     ["app"]),
    ({"refill": False, "refresh": ["app"], "restyle": []}, VALID, dict(VALID, outputs={**VALID["outputs"], "app_vibes": APP_ASK,
                                                                                         "app_purpose": "A new purpose"}), []),
    ({"refill": False, "refresh": ["app"], "restyle": []}, VALID, dict(VALID, retry_outputs=["app"]), []),
    ({"refill": False, "refresh": ["app"], "restyle": []}, None, dict(VALID, outputs={**VALID["outputs"], "app_vibes": APP_ASK}), []),
    ({"refill": False, "refresh": ["app"], "restyle": ["app"]}, VALID, dict(VALID, outputs={**VALID["outputs"], "app_vibes": APP_ASK}),
     []),
    ({"refill": False, "refresh": ["app"], "restyle": []}, VALID, dict(VALID, retry_asks={PART: [GLOBE_ASK]}), ["app"]),
], ids=["core_vibe_rebuilds_everything", "asks_only", "another_option_changed", "rebuild_with_no_ask", "first_build", "look_only",
        "try_again_asks"])
def test_only_a_version_whose_asks_alone_rebuild_an_output_is_guarded(agent_ns, plan, previous, current, expected):
    assert agent_ns["implement_guarded_outputs"](previous, current, plan) == expected


def test_a_core_vibe_rebuild_skips_the_guard_even_when_genie_changes_every_chart(agent_ns, tmp_path):
    inst, context, deployed, deploy = _page_inspire(agent_ns, tmp_path, guarded=())
    inst._implement_page_spec(context, _Runner([V4]), "app", deploy)
    assert [{k: v for k, v in page.items() if k != "tour"} for page in deployed] == [V4] and "app" not in context["untargeted"]


SPACE = {"title": "Fare agent", "description": "Ask about daily fare takings",
         "serialized_space": {"version": 2, "config": {"sample_questions": [{"id": "a1", "question": ["Which days need the largest buffer?"]}]},
                              "data_sources": {"tables": [{"identifier": "main.inspire.n02_u01_out"}]},
                              "instructions": {"text_instructions": [{"id": "t1", "content": ["Answer in USD."]}],
                                               "example_question_sqls": [{"id": "e1", "question": ["Which days need the largest buffer?"],
                                                                          "sql": ["SELECT 1"]}],
                                               "join_specs": []}}}


def _space_context(agent_ns, inst, ask, where):
    inst._implement_snapshot = lambda key, name, version: {"artifact": _copy(SPACE)}
    inst._implement_vibes_llm = lambda kind, prompt, schema: {"asks": [{"ask": ask, "check": None, "keep": False, "where": where}]}
    return {"uc_id": "N02-U01", "key": (5150, "N02-U01", 4), "guarded": ["genie_space"], "vibes_split": {},
            "spec": {"outputs": {"genie_space": True, "genie_space_vibes": ask}, "retry_asks": {}},
            "asset_status": {"genie_space": {"state": "ready", "spec_version": 3, "snapshot": True}}}


def test_a_genie_agent_title_ask_puts_back_the_instructions_genie_also_changed_and_ignores_new_ids(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    context = _space_context(agent_ns, inst, "Call the agent Fare desk", "the Genie Agent title")
    new = _copy(SPACE)
    new["title"] = "Fare desk"
    new["serialized_space"]["config"]["sample_questions"][0]["id"] = "z9"
    new["serialized_space"]["instructions"]["text_instructions"] = [{"id": "t7", "content": ["Answer in EUR."]}]
    kept = inst._implement_keep_untargeted(context, "genie_space", new)
    assert kept["title"] == "Fare desk", "the asked title change stays"
    assert kept["serialized_space"]["instructions"]["text_instructions"] == SPACE["serialized_space"]["instructions"]["text_instructions"]
    assert [c["key"] for c in context["untargeted"]["genie_space"]["restored"]] == ["instructions"], "a new id alone changes nothing"
    question = _space_context(agent_ns, inst, "Add a question about tips", "the sample questions")
    asked = _copy(new)
    asked["title"] = SPACE["title"]
    asked["serialized_space"]["config"]["sample_questions"].append({"id": "a2", "question": ["How do tips vary?"]})
    kept = inst._implement_keep_untargeted(question, "genie_space", asked)
    assert len(kept["serialized_space"]["config"]["sample_questions"]) == 2 and kept["serialized_space"]["instructions"][
        "text_instructions"][0]["content"] == ["Answer in USD."], "a question ask may add questions and never changes the instructions"


def test_a_whole_output_vibe_on_a_rebuild_starts_genie_from_the_built_page(agent_ns):
    calls, seen = [], {}
    inst = _rebuild(agent_ns, calls)
    inst._implement_carried = lambda target: (dict(CARRIED), _left_by(2, dict(_copy(REBUILT), app=dict(REBUILT["app"], snapshot=True))))
    inst._implement_snapshot = lambda key, name, version: {"artifact": _copy(V3)}

    def app(context, runner):
        seen["rebuild"], seen["bases"] = (context.get("rebuild") or {}).get("app"), (context.get("bases") or {}).get("app")
        seen["guarded"] = list(context.get("guarded") or [])
        context.setdefault("artifacts", {})["app"] = {"id": "n01_u01", "title": "Churn desk"}
        return dict(FIELDS["app"])

    inst._implement_app = app
    _llm(inst, {"app": APP_ASK})
    assert _run(inst, dict(VALID, vibes=APP_ASK, vibe_previous="remove")) in ("ready", "ready_with_warnings"), inst.updates[-1]
    assert seen["guarded"] == ["app"]
    assert seen["rebuild"] == {"parts": [], "again": {}, "kept": {}, "file": "page.json", "based": True}
    assert json.loads(seen["bases"]["page.json"]) == V3, "Genie edits the page as it is built, so what no ask names stays as it is"


def test_the_records_list_and_page_header_are_elements_too(agent_ns):
    elements = agent_ns["implement_page_elements"](V3, "records")
    assert {"page", "records", "charts:buffer_by_tier", "filters:run_date", "kpis:cash_buffer"} <= set(elements)
    assert elements["charts:buffer_by_tier"]["datasets"] == {"buffer": BUFFER_SQL}
    assert elements["records"]["datasets"] == {"records": RECORDS_SQL} and "id" not in elements["page"]["definition"]
    renamed = dict(_copy(V3), title="A new title", records=dict(V3["records"], title="Another brief"), id="other", use_case_id="X")
    targets = {"keys": {"charts:takings_outlook"}, "adds": False, "groups": set()}
    changes = agent_ns["implement_untargeted_changes"]("app", V3, renamed, targets, "records")
    assert [c["key"] for c in changes] == ["page", "records"], "the ids Inspire sets on a page are never Genie's change"
    merged = agent_ns["implement_restore_untargeted"]("app", V3, renamed, changes, targets, "records")[0]
    assert merged["title"] == V3["title"] and merged["records"] == V3["records"] and merged["id"] == "other"


def test_the_split_element_finder_keeps_its_one_answer_and_lists_every_candidate(agent_ns):
    seen = agent_ns["implement_page_seen"](V3)
    assert agent_ns["implement_vibes_element"](seen, OUTLOOK) == "takings_outlook"
    assert agent_ns["implement_vibes_elements"](seen, OUTLOOK) == [["takings_outlook"]]
    assert agent_ns["implement_vibes_element"](seen, "the buffer") == ""
    listed = {key for ranked in agent_ns["implement_vibes_elements"](seen, "the buffer") for key in ranked}
    assert listed >= {"cash_buffer", "buffer_by_tier", "buffer_priority"}


def test_an_unrequested_change_records_the_genie_rounds_its_output_really_ran_not_the_cap(agent_ns, tmp_path):
    inst, context, _deployed, deploy = _page_inspire(agent_ns, tmp_path, prior=SHARED)
    context["genie_rounds"] = {"app": 3}
    runner = _Runner([SHARED_GONE])
    inst._implement_page_spec(context, runner, "app", deploy)
    assert len(runner.prompts) == 3 and context["genie_rounds"]["app"] == 6, "an earlier build attempt of this version ran 3 rounds"
    assert context["untargeted"]["app"]["rounds"] == 6
    [held] = [e for e in inst._implement_vibe_checklist(context) if e.get("kind") == "unrequested_change"]
    assert held["status"] == "not_met" and held["rounds"] == 6 and "round" not in held["evidence"].lower()
    assert "Genie could not do it in 6 build rounds: " in agent_ns["implement_unmet_published_text"]([held], 3)
