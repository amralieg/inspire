import copy
import json
import os

import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import _churn_page, _inspire
from v142_dash_test import _flow, _runner
import shell_sql

FIXTURE = json.load(open(os.path.join(os.path.dirname(__file__), "..", "fixtures", "implement_vibe_audit_round10.json")))
U09, U01, U02 = FIXTURE["n03_u09_v3"], FIXTURE["n02_u01_v4"], FIXTURE["n03_u02_v2"]
U09_ASSET, U01_ASSET = "app:page:n03_u09", "app:page:n02_u01"
ALL_COLUMNS, ACT_NOW = U09["split"][0], U09["split"][1]
GLOBE = U01["split"][0]
RAINFALL, BESIDE = U02["split"][0], U02["split"][1]
GENIE = {"space_id": "g1", "title": "Return loss questions"}


def _page(record, **changes):
    return dict(copy.deepcopy(record["page"]), **changes)


def _judge(inst, splits, verdicts):
    prompts = []

    def llm(kind, prompt, schema):
        prompts.append((kind, prompt))
        if kind == "split":
            return {"asks": splits[prompt.split('"""\n', 1)[1].rsplit('\n"""', 1)[0]]}
        return {"checks": [dict({"n": n, "where": ""}, **verdict) for n, verdict in enumerate(verdicts, 1)]}

    inst._implement_vibes_llm = llm
    return prompts


def _round(agent_ns, asset, text, split, artifact, verdicts=(), before=None, tools=None, chart_types=()):
    inst = _inspire(agent_ns, FakeSpark())
    prompts = _judge(inst, {text: split}, list(verdicts))
    item = {"asset": asset, "text": text, "artifact": artifact, "built_before": before, "tools": tools or {}, "chart_types": chart_types}
    found = inst._implement_vibes_round({}, [item], "round 10 replay")
    return found["checks"][asset], [p for kind, p in prompts if kind == "judge"]


def _without_tier_filter(page):
    records = dict(page["records"], column_filters=[f for f in page["records"]["column_filters"] if f["column"] != "priority_tier"]
                   + [{"column": "priority_tier", "off": True}])
    return dict(page, records=records, genie=GENIE)


def test_round10_the_act_now_ask_is_met_only_by_the_root_cause_table_it_names(agent_ns):
    page = _page(U09, genie=GENIE)
    checks, judged = _round(agent_ns, U09_ASSET, U09["text"], [ACT_NOW], page)
    assert checks[0]["status"] == "done" and "column filter: priority tier: Act now, Review, Monitor" in checks[0]["evidence"], checks
    assert not judged, "the text check decides on the table it names, so no judge is asked"
    assert U09["checks"][1]["evidence"].startswith("turn-reason mix differ"), "round 10 met it on the page's Genie questions"
    lacking = _without_tier_filter(page)
    seen = agent_ns["implement_vibes_seen"](U09_ASSET, lacking)
    assert any("Act now" in line for line in seen["filters"]["lines"]) and any("Act now" in q for q in seen["genie"]["lines"]), \
        "the page filter bar and the Ask Genie questions still show Act now"
    checks, _judged = _round(agent_ns, U09_ASSET, U09["text"], [ACT_NOW], lacking)
    assert (checks[0]["status"], checks[0]["evidence"], checks[0]["checks"]) == (
        "missing", "the built Root-cause action plan table on the App page n03_u09 never shows the words 'Act Now'",
        [{"name": "text: Act Now", "passed": False}]), checks


def test_round10_a_judge_quote_from_the_genie_questions_is_not_the_named_table(agent_ns):
    lacking = _without_tier_filter(_page(U09))
    ask = dict(ACT_NOW, check=None)
    checks, _judged = _round(agent_ns, U09_ASSET, U09["text"], [ask], lacking,
                             [{"status": "done", "evidence": "Which Act now combinations have the highest loss at stake?", "where": "genie"}])
    assert checks[0]["status"] == "missing"
    assert checks[0]["evidence"] == "it was added to the Ask Genie panel, not to the Root-cause action plan table", checks


def test_round10_the_globe_ask_names_a_chart_so_an_html_block_never_stands_in_for_it(agent_ns):
    page = _page(U01)
    assert [b["id"] for b in page["blocks"]] == ["takings_outlook"] and "takings_outlook" not in [c["id"] for c in page["charts"]]
    verdict = {"status": "done", "evidence": U01["checks"][0]["evidence"], "where": "takings_outlook"}
    checks, _judged = _round(agent_ns, U01_ASSET, U01["text"], [GLOBE], page, [verdict])
    assert U01["checks"][0]["status"] == "done", "round 10 met it on the hand-written html block"
    assert checks[0]["status"] == "missing"
    assert checks[0]["evidence"] == "the built App page n02_u01 has no Fourteen-day takings outlook chart", checks


def test_round10_the_globe_version_is_held_and_never_published_with_its_stand_in(agent_ns, tmp_path):
    from v143_vibes_test import _locked, _run
    from v148_asset_vibes_test import _built, _carrying, _vibed
    inst, previous = _locked(agent_ns)
    inst.local_log_output_dir = str(tmp_path)
    _carrying(inst)
    inst._implement_runner = lambda uc: "genie"
    inst._implement_app = _built("app", _page(U01, id="n01_u01", use_case_id="N01-U01"))
    _judge(inst, {U01["text"]: [GLOBE]}, [{"status": "done", "evidence": U01["checks"][0]["evidence"], "where": "takings_outlook"}])
    status = _run(inst, _vibed(previous, ["app:page:n01_u01"], **{"app:page:n01_u01_vibes": U01["text"]}))
    final = inst.updates[-1]["asset_status"]
    assert status == "ready_with_warnings", "round 10 published this version with the html stand-in"
    [entry] = [e for e in final["checklist"] if e["requirement"] == GLOBE["ask"]]
    assert entry["status"] == "not_met" and entry["evidence"] == "the built App page n01_u01 has no Fourteen-day takings outlook chart"
    assert "has no Fourteen-day takings outlook chart" in inst.updates[-1]["status_message"], \
        "the unmet ask is named in the published sentence"


OUTLOOK = {"id": "takings_outlook", "title": "Fourteen-day takings outlook", "type": "line", "dataset": "records", "span": 2,
           "hint": "Expected fare takings for each forecast day.", "x": {"column": "forecast_date", "kind": "time", "label": "Forecast date"},
           "y": [{"expression": "SUM(value)", "label": "Expected takings", "format": "currency", "currency": "USD"}]}


def test_run_4b_a_targeted_chart_turned_into_an_html_block_of_invented_bar_heights_under_its_own_id_is_not_met(agent_ns, tmp_path):
    import re
    built = _page(U01)
    [block] = built["blocks"]
    heights = re.findall(r"--h:(\d+)px", block["content"])
    assert (block["id"], block["kind"], len(heights)) == ("takings_outlook", "html", 14), "Genie hand-drew 14 bars in html"
    assert "takings_outlook" not in [c["id"] for c in built["charts"]] and GLOBE["where"] == "the Fourteen-day takings outlook chart"
    before = dict(built, charts=[OUTLOOK] + built["charts"], blocks=[])
    verdict = {"status": "done", "evidence": U01["checks"][0]["evidence"], "where": "takings_outlook"}
    checks, _judged = _round(agent_ns, U01_ASSET, U01["text"], [GLOBE], built, [verdict], before=before)
    assert (checks[0]["status"], checks[0]["evidence"]) == ("missing", "the built App page n02_u01 has no Fourteen-day takings outlook chart")
    inst = _inspire(agent_ns, FakeSpark(), local_log_output_dir=str(tmp_path))
    inst.updates = []
    inst._implement_update = lambda key, **fields: inst.updates.append(fields)
    inst._implement_snapshot = lambda key, name, version: {"artifact": copy.deepcopy(before), "spec_version": version}
    inst._implement_input_has_dates = lambda context: False
    inst._implement_app_prompt = lambda context, shell_sql, example, event_date, name: "Write page.json."
    inst._implement_page_file = lambda context, name, work, shell_sql, event_date, fresh=False: (
        json.load(open(os.path.join(work, "page.json"), encoding="utf-8")), [])
    _judge(inst, {U01["text"]: [GLOBE]}, [verdict])
    context = {"uc_id": "N02-U01", "key": (5150, "N02-U01", 4), "use_case": {"No": "N02-U01"},
               "spec": {"outputs": {"app": True, f"{U01_ASSET}_vibes": U01["text"]}, "retry_asks": {}},
               "asset_status": {"app": {"state": "ready", "spec_version": 3, "snapshot": True},
                                U01_ASSET: {"state": "ready", "spec_version": 3, "title": built["title"]}},
               "vibes_split": {}, "vibes_asks": {}}
    prompts, deployed = [], []

    class Runner:
        def run(self, prompt, work, schema, label=""):
            prompts.append(prompt)
            json.dump(built, open(os.path.join(work, "page.json"), "w", encoding="utf-8"))
            return {"exit": 0}

    def deploy(work, page, gate=lambda: None):
        gate()
        deployed.append(copy.deepcopy(page))
        return {"app_name": "inspire-hub", "app_url": "https://example.com/app"}

    inst._implement_page_spec(context, Runner(), "app", deploy)
    assert len(prompts) == 3, "the stand-in goes back to Genie for its rounds instead of being published as met"
    assert all("the built App page n02_u01 has no Fourteen-day takings outlook chart" in p for p in prompts[1:])
    [missed] = context["round_vibes"]["app"]["checks"][U01_ASSET]
    assert missed["status"] == "missing" and "takings_outlook html" not in missed["evidence"]


def test_round10_a_chart_kind_the_app_cannot_draw_is_not_met(agent_ns):
    page = _page(U01)
    ask = {"ask": "Draw the takings as a 3D globe chart", "check": {"kind": "chart_type", "value": "3d globe"}, "keep": False, "where": ""}
    checks, judged = _round(agent_ns, U01_ASSET, "x", [ask], page, [{"status": "done", "evidence": "Fourteen-day takings outlook"}],
                            chart_types=shell_sql.CHART_TYPES)
    assert checks[0]["status"] == "missing" and not judged, "the chart kind check decides, so no judge can accept a stand-in"
    assert {"bar", "line", "heatmap"} <= set(shell_sql.CHART_TYPES) and "3d globe" not in shell_sql.CHART_TYPES
    assert checks[0]["evidence"] == (f"the App page n02_u01 cannot draw a 3d globe chart: it draws {', '.join(shell_sql.CHART_TYPES)} "
                                     f"charts"), checks


@pytest.mark.parametrize("evidence", [
    "Fourteen forecast days orbit the cash-planning globe; taller amber markers indicate stronger expected takings.",
    "Fourteen-day takings outlook"])
def test_round10_a_data_ask_is_never_met_by_the_words_of_an_html_block(agent_ns, evidence):
    page = _page(U01)
    ask = {"ask": "Show the expected takings for each of the fourteen forecast days", "check": None, "keep": False, "where": "",
           "draws": "data"}
    checks, _judged = _round(agent_ns, U01_ASSET, "x", [ask], page, [{"status": "done", "evidence": evidence, "where": ""}])
    assert checks[0]["status"] == "missing"
    assert "from the takings_outlook html block, which draws nothing from the data" in checks[0]["evidence"], checks
    checks, _judged = _round(agent_ns, U01_ASSET, "x", [ask], page,
                             [{"status": "done", "evidence": "Expected takings", "where": "takings_by_direction"}])
    assert checks[0]["status"] == "done", "a chart drawn from the records is evidence for a data ask"
    checks, _judged = _round(agent_ns, U01_ASSET, "x", [ask], page, [{"status": "done", "evidence": "Weekly direction", "where": "filters"}])
    assert checks[0]["status"] == "missing" and "from the page filter bar, which draws nothing from the data" in checks[0]["evidence"], \
        "a filter's label shows no takings"


def _dashboard_round(agent_ns, text, split, page, verdicts, drawn=None):
    inst = _inspire(agent_ns, FakeSpark())
    prompts = _judge(inst, {text: split}, verdicts)
    context = {"uc_id": "N03-U02", "key": (5150, "N03-U02", 2), "spec": {"outputs": {"dashboard": True, "dashboard_vibes": text}},
               "asset_status": {}, "result_table": "main.inspire.n03_u02_out", "drawn": drawn or {}}
    items = inst._implement_output_vibe_items(context, "dashboard", {"dashboard": text}, page, [])
    found = inst._implement_vibes_round({}, items, "round 10 replay")
    return found["checks"]["dashboard"], [p for kind, p in prompts if kind == "judge"]


def test_round10_the_dashboard_rainfall_asks_read_the_published_dashboard_which_never_drew_the_html_block(agent_ns):
    page = _page(U02)
    verdicts = [{"status": "done", "evidence": c["evidence"], "where": "hourly_rainfall"} for c in U02["checks"]]
    assert [c["status"] for c in U02["checks"]] == ["done", "done"], "round 10 met both on the stored page spec"
    published = {"dashboard": (json.dumps(page, ensure_ascii=False, sort_keys=True, default=str), None)}
    checks, judged = _dashboard_round(agent_ns, U02["text"], [RAINFALL, BESIDE], page, verdicts)
    assert [c["status"] for c in checks] == ["missing", "missing"], checks
    assert "Rainfall by planning hour" not in judged[0] and "hourly_rainfall" not in judged[0]
    assert [b["kind"] for b in page["blocks"]] == ["html"]
    widgets = [item["widget"]["name"] for board in U02["published"]["pages"] if board["name"] == "overview" for item in board["layout"]]
    assert "block_hourly_rainfall" not in widgets, "the published dashboard has no widget for the html block"
    drawn = agent_ns["implement_dashboard_drawn"](page, U02["published"])
    assert drawn["blocks"] == [] and [c["type"] for c in drawn["charts"]] == ["line", "bar", "pie", "bar", "scatter"]
    published = {"dashboard": (published["dashboard"][0], drawn)}
    checks, judged = _dashboard_round(agent_ns, U02["text"], [RAINFALL, BESIDE], page, verdicts, published)
    assert [c["status"] for c in checks] == ["missing", "missing"] and "Rainfall by planning hour" not in judged[0], checks


def test_the_dashboard_view_draws_what_the_dashboard_builder_draws(agent_ns):
    page = _page(U02)
    ask = {"ask": "Make the confidence chart a horizontal bar chart", "check": {"kind": "chart_type", "value": "horizontal bar"},
           "keep": False, "where": "the confidence chart"}
    assert [c["type"] for c in page["charts"]][1] == "horizontal_bar", "the stored page spec says horizontal bar"
    checks, _judged = _dashboard_round(agent_ns, "h", [ask], page, [])
    assert (checks[0]["status"], checks[0]["evidence"]) == ("done", "chart fare_by_confidence: type horizontal_bar"), checks
    view = agent_ns["implement_dashboard_drawn"](page)
    assert view["blocks"] == [] and "questions" not in view and "story" not in view
    assert view["records"]["column_filters"] is False and shell_sql.list_column_filters(view) == []
    assert all(t["column_filters"] is False for t in view["tables"])
    assert [c["type"] for c in view["charts"]] == ["line", "horizontal_bar", "pie", "pareto", "scatter"], \
        "horizontal bars and paretos are drawn as the dashboard draws them, and a donut as the dashboard's pie"
    assert [c["type"] for c in agent_ns["implement_dashboard_drawn"](page, U02["published"])["charts"]] == [
        "line", "bar", "pie", "bar", "scatter"], "the dashboard round 10 published drew them as vertical bars and a pie"
    seen = agent_ns["implement_vibes_seen"]("dashboard", view)
    assert "hourly_rainfall" not in seen and not any("rainfall" in " ".join(e["lines"]).lower() for e in seen.values())
    fact = agent_ns["implement_vibes_fact"]
    target = agent_ns["implement_vibes_target"]("dashboard:fare_by_confidence", view)[0]
    kinds = agent_ns["IMPLEMENT_DASHBOARD_RENDERED_KINDS"]
    assert fact({"kind": "chart_type", "value": "pie"}, target, "dashboard chart fare_by_confidence", kinds) == (
        "missing", "the built dashboard chart fare_by_confidence has no pie chart; its charts are horizontal_bar (fare_by_confidence)")
    assert fact({"kind": "chart_type", "value": "3d globe"}, target, "dashboard chart fare_by_confidence", kinds) == (
        "missing", "the dashboard chart fare_by_confidence cannot draw a 3d globe chart: it draws bar, horizontal_bar, stacked_bar, "
                   "grouped_bar, line, area, stacked_area, pareto, donut, pie, scatter, heatmap charts")


def test_a_dashboard_sort_is_met_only_when_the_published_dashboard_orders_the_chart(agent_ns):
    page = _page(U02)
    ask = {"ask": "Sort the confidence chart from the smallest fare up", "check": {"kind": "sort", "value": "value", "direction": "asc"},
           "keep": False, "where": "the confidence chart"}
    ascending = dict(page, charts=[dict(c, sort="value_asc") if c["id"] == "fare_by_confidence" else c for c in page["charts"]])
    checks, _judged = _dashboard_round(agent_ns, "s", [ask], ascending, [])
    assert checks[0]["status"] == "done" and checks[0]["evidence"].startswith("sort: value_asc by"), checks
    checks, _judged = _dashboard_round(agent_ns, "s", [ask], page, [])
    assert checks[0]["status"] == "missing", "the page ranks it largest first, so a smallest first ask is not met"
    ranked = agent_ns["implement_dashboard_drawn"](page)["charts"][1]
    assert (ranked["id"], ranked.get("sort")) == ("fare_by_confidence", "value_desc"), "a ranked bar chart is drawn largest first"


def test_the_dashboard_round_gate_runs_on_the_dashboard_it_will_publish(agent_ns, tmp_path):
    ask = "Show the rainfall card above the charts"
    inst, context, seen = _flow(agent_ns, tmp_path, outputs={"dashboard_vibes": ask})
    block = {"id": "rainfall", "kind": "html", "place": {"where": "top"}, "content": "<b>Rainfall card</b> 3.0 2.0 1.0 mm"}
    pages = [_churn_page(agent_ns, blocks=[block]) for _ in range(3)]
    prompts = _judge(inst, {ask: [{"ask": ask, "check": None, "keep": False, "where": ""}]},
                     [{"status": "done", "evidence": "Rainfall card 3.0 2.0 1.0 mm", "where": "rainfall"}])
    runner = _runner(*pages)
    with pytest.raises(agent_ns["ImplementGenieExhausted"], match="block rainfall is html, which a dashboard text widget cannot draw"):
        inst._implement_dashboard(context, runner)
    assert not [p for kind, p in prompts if kind == "judge" and "Rainfall card" in p], "the judge never sees what the dashboard cannot draw"
    assert len(runner.prompts) == 3 and all("block rainfall is html" in p for p in runner.prompts[1:]), \
        "each later round tells Genie why the html block cannot be published"


def test_round10_a_filter_on_all_columns_lists_every_column_it_checked(agent_ns):
    tools = {"shell_sql": shell_sql}
    checks, judged = _round(agent_ns, U09_ASSET, U09["text"], [ALL_COLUMNS], _page(U09), tools=tools,
                            verdicts=[{"status": "done", "evidence": "column filter: Channel", "where": "records"}])
    assert U09["checks"][0]["evidence"] == "column filter: Channel", "round 10 met it on one column filter"
    assert not judged and checks[0]["status"] == "done", checks
    assert checks[0]["checks"] == [{"name": "column_filter: all", "passed": True}]
    assert checks[0]["evidence"] == ("the Root-cause action plan table has a column filter on each of its 7 columns: Rank, Item, "
                                     "Category, Tier, Channel, Return reason, Loss at stake"), checks
    page = _page(U09)
    page["records"]["column_filters"] = [f for f in page["records"]["column_filters"] if f["column"] != "value_at_stake"] + [
        {"column": "value_at_stake", "off": True}]
    checks, _judged = _round(agent_ns, U09_ASSET, U09["text"], [ALL_COLUMNS], page, tools=tools,
                             verdicts=[{"status": "done", "evidence": "column filter: Channel", "where": "records"}])
    assert checks[0]["status"] == "missing" and "the Root-cause action plan table has no column filter on value_at_stake" in \
        checks[0]["evidence"], checks


def test_an_ask_about_every_item_is_never_met_by_one_quoted_line(agent_ns):
    ask = {"ask": "Give every chart a hint that names its measure", "check": None, "keep": False, "where": ""}
    checks, _judged = _round(agent_ns, U09_ASSET, "x", [ask], _page(U09), [{"status": "done", "evidence": "Return loss over time"}])
    assert checks[0]["status"] == "missing" and checks[0]["evidence"].startswith(
        "the ask asks this of every chart, and the check quoted one line, which shows one"), checks


def test_a_chart_kind_asked_of_every_chart_is_checked_on_each_chart(agent_ns):
    page = _page(U09)
    ask = {"ask": "Make every chart a line chart", "check": {"kind": "chart_type", "value": "line"}, "keep": False, "where": ""}
    checks, _judged = _round(agent_ns, U09_ASSET, "x", [ask], page, chart_types=shell_sql.CHART_TYPES)
    assert checks[0]["status"] == "missing" and "reason_loss" in checks[0]["evidence"], checks
    lines = dict(page, charts=[dict(c, type="line") for c in page["charts"]])
    checks, _judged = _round(agent_ns, U09_ASSET, "x", [ask], lines, chart_types=shell_sql.CHART_TYPES)
    assert checks[0]["status"] == "done" and checks[0]["evidence"].count("type line") == 5, checks


def test_keeping_every_filter_is_checked_against_each_filter_of_the_version_before(agent_ns):
    page = _page(U09)
    ask = {"ask": "Keep all the filters", "check": None, "keep": True, "where": ""}
    checks, _judged = _round(agent_ns, U09_ASSET, "x", [ask], page, [{"status": "done", "evidence": "Channel"}], before=page)
    assert checks[0]["status"] == "done" and checks[0]["evidence"].startswith("each of the 6 filters of the version before"), checks
    fewer = dict(page, filters=[f for f in page["filters"] if f["id"] != "channel"])
    checks, _judged = _round(agent_ns, U09_ASSET, "x", [ask], fewer, [{"status": "done", "evidence": "Category"}], before=page)
    assert checks[0]["status"] == "missing" and "no longer shows Channel" in checks[0]["evidence"], checks


def test_the_split_names_the_element_what_the_ask_draws_and_asks_about_every_item(agent_ns):
    prompt = agent_ns["implement_vibes_split_prompt"](U09_ASSET, U09["text"])
    assert "never leave it out when the ask names one" in prompt and '"of" and never in "where"' in prompt
    assert '{"kind": "column_filter", "value": "all"}' in prompt and '"all": true' in prompt and '"draws": ""' in prompt
    assert "or the customer's own words for a type that is none of these" in prompt
    schema = agent_ns["IMPLEMENT_VIBES_SPLIT_SCHEMA"]["properties"]["asks"]["items"]["properties"]
    assert schema["draws"] == {"type": "string"}
    asks = agent_ns["implement_vibes_asks"]({"asks": [{"ask": "Chart the rain", "draws": " Chart "}, {"ask": "Say hi", "draws": "music"}]})
    assert asks == [{"ask": "Chart the rain", "check": None, "keep": False, "where": "", "draws": "chart"},
                    {"ask": "Say hi", "check": None, "keep": False, "where": ""}]


def test_an_element_named_only_as_a_position_is_not_where_the_ask_is_checked(agent_ns):
    note = {"id": "trend_note", "kind": "text", "place": {"where": "after", "of": "records"}, "content": "Loss trend note for this week"}
    page = _page(U09, blocks=[note])
    ask = {"ask": "Place a loss trend note next to the Root-cause action plan table", "check": None, "keep": False,
           "where": "the Root-cause action plan table"}
    checks, _judged = _round(agent_ns, U09_ASSET, "x", [ask], page,
                             [{"status": "done", "evidence": "Loss trend note for this week", "where": "trend_note"}])
    assert checks[0]["status"] == "done", "the note sits next to the table it names as a position, so the note is the evidence"
    named = agent_ns["implement_vibes_named"]
    assert named(BESIDE) == "the hourly rainfall chart", "the deployment schedule is where the chart sits, not what shows it"
    assert named(ACT_NOW) == "the Root-cause action plan table"
    assert named(GLOBE) == "the Fourteen-day takings outlook chart"
    assert named({"ask": "Put Mickey Mouse in the middle of the page", "where": "the middle of the page"}) == "the middle of the page"
    scope = agent_ns["implement_vibes_scope"]
    seen = agent_ns["implement_vibes_seen"](U09_ASSET, _page(U09))
    assert scope(seen, {"ask": "Put Mickey Mouse in the middle of the page", "where": "the middle of the page"}, "App page") == (None, ""), \
        "a place on the page names no element, so the whole page is checked"
    assert scope(seen, {"ask": "Show a text block above the loss trend chart", "where": ""}, "App page") == (None, "")
    assert scope(seen, {"ask": "Add the weather chart", "where": ""}, "App page n03_u09") == (
        [], "the built App page n03_u09 has no weather chart")


SWEEP = {"id": "n01_u01", "title": "Loss desk", "question": "Which stores lose the most?", "hue": "teal",
         "filters": [{"id": "region", "type": "multi_select", "label": "Region", "columns": {"records": "region"}}],
         "charts": [{"id": "trend", "type": "line", "title": "Loss trend", "hint": "Loss over time", "dataset": "records", "limit": 12,
                     "x": {"column": "event_date", "kind": "time", "label": "Month"}, "y": [{"expression": "SUM(loss)", "label": "Loss"}]}],
         "records": {"title": "Fix plan", "key": "record_key", "label": "entity_label", "rank": "rank", "tier": "priority_tier",
                     "columns": [{"column": "channel", "label": "Channel"}]},
         "blocks": [{"id": "note", "kind": "html", "place": {"where": "top"}, "content": "<p style='color:red'>Region notes</p>"},
                    {"id": "hero", "kind": "image", "place": {"where": "bottom"},
                     "content": {"file": "", "alt": "Mickey Mouse", "url": "https://example.com/m.png"}}]}


def test_a_column_check_reads_only_the_columns_an_element_shows(agent_ns):
    fact = agent_ns["implement_vibes_fact"]
    assert fact({"kind": "column", "value": "region"}, SWEEP, "App page n01_u01") == (
        "missing", "the built App page n01_u01 names no column region"), "a filter on region shows no region column"
    assert fact({"kind": "column", "value": "channel"}, SWEEP, "App page n01_u01")[0] == "done"


def test_a_threshold_check_reads_only_what_the_element_shows(agent_ns):
    fact = agent_ns["implement_vibes_fact"]
    assert fact({"kind": "threshold", "value": 12}, SWEEP, "App page n01_u01") == ("missing", "the built App page n01_u01 uses no 12"), \
        "the chart's row limit is a setting, never a number the page shows"
    shown = dict(SWEEP, charts=[dict(SWEEP["charts"][0], hint="Loss over the last 12 months")])
    assert fact({"kind": "threshold", "value": 12}, shown, "App page n01_u01")[0] == "done"


def test_an_image_ask_on_a_named_block_never_passes_on_another_block_s_picture(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    item = {"asset": "app:page:n01_u01", "images": lambda: [{"block": "hero", "bytes": b"png", "alt": "Mickey Mouse", "media_type": "image/png",
                                                             "error": ""}]}
    inst._implement_vibes_image = lambda image, wanted, label: (True, "it shows Mickey Mouse")
    gate = inst._implement_vibes_image_gate
    assert gate(item, {"kind": "image", "value": "Mickey Mouse"}, "note", "App page n01_u01") == (
        False, "the note on the built App page n01_u01 shows no picture")
    assert gate(item, {"kind": "image", "value": "Mickey Mouse"}, "hero", "App page n01_u01")[0] is True


def test_a_color_ask_on_a_named_element_never_passes_on_another_element_s_html(agent_ns):
    gate = agent_ns["implement_vibes_gate"]
    assert gate({"kind": "color", "value": "red"}, SWEEP, "records", "App page n01_u01", {})[0] is False, \
        "the red is in the note block, not on the Fix plan table"
    assert gate({"kind": "color", "value": "red"}, SWEEP, "note", "App page n01_u01", {})[0] is True
    assert gate({"kind": "color", "value": "teal"}, SWEEP, "records", "App page n01_u01", {})[0] is True, "the page hue colors it"


def test_a_column_filter_ask_on_a_named_chart_is_not_met_by_a_table(agent_ns):
    gate = agent_ns["implement_vibes_gate"]
    page = dict(SWEEP, records=dict(SWEEP["records"], column_filters=[{"column": "channel"}]))
    tools = {"shell_sql": shell_sql}
    assert gate({"kind": "column_filter", "value": "channel"}, page, "trend", "App page n01_u01", tools)[0] is False
    assert gate({"kind": "column_filter", "value": "channel"}, page, "records", "App page n01_u01", tools)[0] is True


def test_a_filter_ask_on_a_named_table_with_no_filter_of_its_own_is_not_met(agent_ns):
    checked, seen = agent_ns["implement_vibes_checked"], agent_ns["implement_vibes_seen"]
    ask = {"ask": "Filter the Fix plan table by region", "check": {"kind": "filter", "value": "region"}, "keep": False,
           "where": "the Fix plan table"}
    assert checked(ask, "app:page:n01_u01", SWEEP, seen("app:page:n01_u01", SWEEP), None, None, "App page n01_u01") == (
        "missing", "the built Fix plan table on the App page n01_u01 has no filter on region; its filters are none"), \
        "the region filter in the page filter bar is another element"


@pytest.mark.parametrize("filters, status", [(None, "done"), ([{"column": "channel"}], "done"),
                                             ([{"column": "channel", "off": True}], "missing"), (False, "missing")])
def test_a_filter_ask_on_a_table_reads_the_filters_the_app_turns_on_from_its_columns(agent_ns, filters, status):
    checked, seen = agent_ns["implement_vibes_checked"], agent_ns["implement_vibes_seen"]
    ask = {"ask": "Filter the Fix plan table by channel", "check": {"kind": "filter", "value": "channel"}, "keep": False,
           "where": "the Fix plan table"}
    page = dict(SWEEP, records=SWEEP["records"] if filters is None else dict(SWEEP["records"], column_filters=filters))
    shown = seen("app:page:n01_u01", page, shell_sql)
    assert checked(ask, "app:page:n01_u01", page, shown, None, None, "App page n01_u01", (), shell_sql)[0] == status
    assert ("column filter: Channel" in shown["records"]["lines"]) is (status == "done"), shown["records"]["lines"]


def test_one_element_finder_ranks_every_candidate_and_the_vibe_check_reads_the_closest(agent_ns):
    from v167_untargeted_guard_test import V3
    seen = agent_ns["implement_page_seen"](V3)
    elements, closest, element = (agent_ns[n] for n in ("implement_vibes_elements", "implement_vibes_closest", "implement_vibes_element"))
    assert elements(seen, "the buffer") == [["cash_buffer", "buffer_priority"], ["buffer_by_tier"]]
    assert (closest(seen, "the buffer"), element(seen, "the buffer")) == (["cash_buffer", "buffer_priority"], ""), \
        "two elements tie as the closest, so no one element is the buffer"
    assert elements(seen, "the takings chart") == [["takings_outlook"], ["takings_by_direction"]]
    assert (closest(seen, "the takings chart"), element(seen, "the takings chart")) == (["takings_outlook"], "takings_outlook")
    assert elements(seen, "the cash buffer KPI") == [["cash_buffer"]], "a chart sharing the KPI's words is not a KPI"
    assert elements(seen, "the Expected takings chart") == [["expected_takings"]], "no chart has the name, so every element that does"
    assert (closest(seen, "the Expected takings chart"), element(seen, "the Expected takings chart")) == ([], ""), \
        "the check never reads a KPI as the chart an ask names"
    ask = {"ask": "Make the Expected takings chart a bar chart", "where": "the Expected takings chart"}
    assert agent_ns["implement_vibes_scope"](seen, ask, "App page n02_u01") == ([], "the built App page n02_u01 has no Expected takings chart")


def test_the_untargeted_guard_reads_every_candidate_the_finder_ranks(agent_ns):
    from v167_untargeted_guard_test import PART, V3, V4
    targets = agent_ns["implement_untargeted_targets"]

    def keys(where):
        return targets("app", [(PART, {"ask": "Change it", "where": where, "keep": False})], V3, V4, "records")["keys"]

    assert keys("the buffer") == {"kpis:cash_buffer", "charts:buffer_priority", "charts:buffer_by_tier"}, \
        "an ask that may mean any of three elements leaves all three to Genie, not only the closest two"
    assert keys("the Cash buffer by action tier chart") == {"charts:buffer_by_tier"}, \
        "the KPI and the filter bar sharing its words are not the chart the ask names, so a change to them is put back"
    assert keys("the Expected takings chart") == {"kpis:expected_takings"}, \
        "no chart has the name, so the KPI that does is the ask's target and its change stays"
