import json

import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import _inspire, sdk_stub
from v143_vibes_test import _locked, _run
from v148_asset_vibes_test import PARTS, _built, _carrying, _vibed

SQL = ("WITH runs AS (SELECT as_of_date FROM main.inspire.loss_out) SELECT o.channel, o.reason, "
       "CASE WHEN o.priority_tier = 'Act now' THEN 1 ELSE 0 END AS act_now_row FROM runs o")
V1 = {"id": "n01_u01", "title": "Costliest loss reasons and fixes", "question": "Which reason, category and channel lose the most?",
      "questions": ["Which Act now rows lose the most?"], "datasets": [{"name": "records", "sql": SQL}],
      "filters": [{"id": "channel", "type": "multi_select", "label": "Channel", "columns": {"records": "channel"}},
                  {"id": "reason", "type": "multi_select", "label": "Loss reason", "columns": {"records": "reason"}},
                  {"id": "category", "type": "multi_select", "label": "Category", "columns": {"records": "category"}}],
      "kpis": [{"id": "act_now_count", "label": "Act now rows", "dataset": "records", "expression": "SUM(act_now_row)",
                "format": "integer"}],
      "charts": [{"id": "loss_trend", "type": "line", "title": "Loss trend by month", "hint": "Loss over time", "dataset": "records",
                  "x": {"column": "event_date", "label": "Month"}, "y": [{"expression": "SUM(loss)", "label": "Loss"}]}],
      "records": {"title": "Fix plan", "hint": "Combinations ranked by loss", "key": "record_key", "label": "entity_label",
                  "rank": "rank", "tier": "priority_tier", "column_filters": False,
                  "columns": [{"column": "channel", "label": "Channel"}, {"column": "value_at_stake", "label": "Loss at stake"}]}}
V2 = dict(V1, filters=V1["filters"] + [{"id": "priority_tier", "type": "multi_select", "label": "Priority tier",
                                        "columns": {"records": "priority_tier"}}])
V3 = dict(V2, records=dict(V1["records"], column_filters=[{"column": "priority_tier"}, {"column": "channel"}]))
VIBE = "the Fix plan table needs some filter for example a filter on all columns to allow me to select Act Now"
ALL_COLUMNS = "The Fix plan table needs some filter, for example a filter on all columns"
ACT_NOW = "The filter on the Fix plan table allows me to select Act Now"
TABLE = "the Fix plan table"
SPLIT = [{"ask": ALL_COLUMNS, "check": None, "keep": False, "where": TABLE},
         {"ask": ACT_NOW, "check": {"kind": "text", "value": "Act Now"}, "keep": False, "where": TABLE}]
LIVE_QUOTE = ('{"columns": {"records": "channel"}, "id": "channel", "label": "Channel", "type": "multi_select"}, '
              '{"columns": {"records": "priority_tier"}, "id": "priority_tier", "label": "Priority tier", "type": "multi_select')
ALREADY = "already there in the version before, so nothing needed to change for it: "


def _old_quote(text):
    return f"the check quoted '{text}', which the version before already showed, so nothing shows this ask was met"
PAGE = "app:page:n01_u01"
GENIE_V1 = {"title": "Loss Genie", "description": "Ask about losses by reason",
            "serialized_space": {"config": {"sample_questions": [{"id": "q1", "question": ["Which channel lost the most?"]}]},
                                 "instructions": {"text_instructions": [{"id": "i1", "content": ["Answer in USD."]}],
                                                  "example_question_sqls": [{"id": "e1", "question": ["Top stores by loss"],
                                                                             "sql": ["SELECT store, SUM(loss) FROM t GROUP BY store"]}]}}}
STORES = "Which stores lost the most last month?"
GENIE_V2 = json.loads(json.dumps(GENIE_V1))
GENIE_V2["serialized_space"]["config"]["sample_questions"].append({"id": "q2", "question": [STORES]})


def _judge(inst, splits, verdicts):
    prompts = []

    def llm(kind, prompt, schema):
        prompts.append((kind, prompt, schema))
        if kind == "split":
            return {"asks": splits[prompt.split('"""\n', 1)[1].rsplit('\n"""', 1)[0]]}
        return {"checks": [dict({"n": n}, **verdict) for n, verdict in enumerate(verdicts, 1)]}

    inst._implement_vibes_llm = llm
    return prompts


def _checks(agent_ns, asset, text, splits, verdicts, artifact, before, reported=()):
    inst = _inspire(agent_ns, FakeSpark())
    prompts = _judge(inst, splits, verdicts)
    found = inst._implement_vibes_checks({}, asset, text, artifact, reported, built_before=before)
    return found, [p for p in prompts if p[0] == "judge"]


@pytest.mark.parametrize("verdict,reason", [
    ({"status": "done", "evidence": LIVE_QUOTE, "where": ""},
     "the check gave no words of the built App page n01_u01 that show this ask"),
    ({"status": "done", "evidence": "Priority tier", "where": "filters"},
     "it was added to the page filter bar, not to the Fix plan table"),
    ({"status": "done", "evidence": "Channel", "where": "filters"}, "it was added to the page filter bar, not to the Fix plan table"),
    ({"status": "done", "evidence": "Channel", "where": "records"}, _old_quote("Channel")),
    ({"status": "done", "evidence": "Priority tier", "where": "records"},
     "the check quoted 'Priority tier', which the Fix plan table does not show"),
], ids=["live_quote", "filter_bar", "old_filter_bar", "old_on_table", "wrong_element"])
def test_the_live_case_a_page_filter_added_for_a_table_ask_is_not_done(agent_ns, verdict, reason):
    found, judged = _checks(agent_ns, PAGE, VIBE, {VIBE: SPLIT}, [verdict], V2, V1)
    assert [c["status"] for c in found] == ["missing", "missing"], found
    assert found[0]["evidence"].startswith(reason), found[0]
    assert found[1]["evidence"] == "the built Fix plan table on the App page n01_u01 never shows the words 'Act Now'"
    assert len(judged) == 1 and SQL not in judged[0][1] and "act_now_row" not in judged[0][1]


def test_the_live_case_names_its_table_in_its_words_so_a_split_without_where_still_checks_only_that_table(agent_ns):
    loose = [dict(a, where="") for a in SPLIT]
    for before in (V1, V2):
        found, _judged = _checks(agent_ns, PAGE, VIBE, {VIBE: loose}, [{"status": "done", "evidence": "Channel", "where": "filters"}], V2,
                                 before)
        assert found[0] == {"ask": ALL_COLUMNS, "status": "missing",
                            "evidence": "it was added to the page filter bar, not to the Fix plan table"}, \
            "the ask's own words name the Fix plan table, so the page filter bar is another element"
        assert found[1]["status"] == "missing" and found[1]["evidence"] == \
            "the built Fix plan table on the App page n01_u01 never shows the words 'Act Now'", \
            "the tiers in the page filter bar are not on the table the ask names"


def test_sql_and_code_never_count_as_evidence(agent_ns):
    plain = dict(V2, kpis=[dict(V2["kpis"][0], label="Rows to act on")], questions=[])
    fact = agent_ns["implement_vibes_fact"]
    for words in ("Act now", "act_now_row", "CASE WHEN", "main.inspire.loss_out", "SUM(loss)"):
        assert fact({"kind": "text", "value": words}, plain, "App page n01_u01")[0] == "missing", words
    assert fact({"kind": "column", "value": "act_now_row"}, plain, "App page n01_u01")[0] == "missing"
    asks = {"x": [{"ask": "Pick the Act now rows", "check": None, "keep": False, "where": ""}]}
    found, judged = _checks(agent_ns, PAGE, "x", asks, [{"status": "done", "evidence": "CASE WHEN o.priority_tier = 'Act now' THEN 1",
                                                         "where": ""}], plain, None)
    assert found[0]["status"] == "missing" and "SUM(act_now_row)" not in judged[0][1] and "CASE WHEN" not in judged[0][1]
    alert = {"condition_text": "More than ten rows to act on", "condition_sql": "SELECT COUNT(*) > 10 FROM main.inspire.loss_out"}
    assert fact({"kind": "threshold", "value": 10}, alert, "Alert")[0] == "missing"
    found, judged = _checks(agent_ns, "alert", "y", {"y": [{"ask": "Alert above 10", "check": None, "keep": False, "where": ""}]},
                            [{"status": "done", "evidence": "COUNT(*) > 10", "where": "alert"}], alert, None)
    assert found[0]["status"] == "missing" and "COUNT(*)" not in judged[0][1]
    assert fact({"kind": "threshold", "value": 10}, dict(alert, condition_text="More than 10 rows to act on"), "Alert")[0] == "done"


def test_a_real_new_filter_on_the_named_table_is_done(agent_ns):
    found, judged = _checks(agent_ns, PAGE, VIBE, {VIBE: SPLIT}, [{"status": "done", "evidence": "column filter: priority tier",
                                                                   "where": "records"}], V3, V2)
    assert found[0] == {"ask": ALL_COLUMNS, "status": "missing", "where": TABLE,
                        "evidence": "the ask asks this of every column, and the check quoted one line, which shows one; Inspire proves an "
                                    "ask about every column only with a check on each column"}, \
        "one new column filter is no proof of a filter on all columns, and the check records the element its ask points to"
    assert "[records] Fix plan table:\n" in judged[0][1] and "- column filter: priority tier" in judged[0][1]
    checked = agent_ns["implement_vibes_checked"]
    ask = {"ask": "Filter the Fix plan table by tier", "check": {"kind": "filter", "value": "priority_tier"}, "keep": False, "where": TABLE}
    seen, before = agent_ns["implement_vibes_seen"](PAGE, V3), agent_ns["implement_vibes_seen"](PAGE, V2)
    assert checked(ask, PAGE, V3, seen, V2, before, "App page n01_u01")[0] == "done"
    assert checked(ask, PAGE, V2, before, V1, agent_ns["implement_vibes_seen"](PAGE, V1), "App page n01_u01") == (
        "missing", "the built Fix plan table on the App page n01_u01 has no filter on priority_tier; its filters are none"), \
        "a table with no column filter of its own is not met, and the page filter bar never stands in for it"


def test_a_keep_ask_is_done_on_what_was_already_there_and_a_change_ask_is_not(agent_ns):
    keep = {"k": [{"ask": "Keep the channel filter", "check": None, "keep": True, "where": "the page filter bar"}]}
    verdict = [{"status": "done", "evidence": "Channel", "where": "filters"}]
    assert _checks(agent_ns, PAGE, "k", keep, verdict, V2, V1)[0][0]["status"] == "done"
    change = {"k": [dict(keep["k"][0], ask="Add a channel filter", keep=False)]}
    assert _checks(agent_ns, PAGE, "k", change, verdict, V2, V1)[0][0] == {"ask": "Add a channel filter", "status": "missing",
                                                                            "evidence": _old_quote("Channel"),
                                                                            "where": "the page filter bar"}, \
        "a judge quote the version before already showed is no proof of a change ask"
    checked = agent_ns["implement_vibes_checked"]
    kept = {"ask": "Keep it a line chart", "check": {"kind": "chart_type", "value": "line"}, "keep": True, "where": ""}
    seen = agent_ns["implement_vibes_seen"]
    assert checked(kept, "dashboard:loss_trend", V2["charts"][0], seen("dashboard:loss_trend", V2), V1,
                   seen("dashboard:loss_trend", V1), "dashboard chart loss_trend", ("line", "bar"))[0] == "done"


def test_a_dashboard_chart_ask_needs_a_change_the_chart_did_not_have(agent_ns):
    weekly = dict(V2, charts=[dict(V2["charts"][0], title="Weekly loss trend", type="bar")])
    asks = {"w": [{"ask": "Call the trend chart Weekly loss trend", "check": None, "keep": False, "where": "the trend chart"}]}
    old = [{"status": "done", "evidence": "Loss trend by month", "where": "loss_trend"}]
    assert _checks(agent_ns, "dashboard:loss_trend", "w", asks, old, V2, V1)[0][0]["evidence"] == _old_quote("Loss trend by month")
    new = [{"status": "done", "evidence": "Weekly loss trend", "where": "loss_trend"}]
    assert _checks(agent_ns, "dashboard:loss_trend", "w", asks, new, weekly, V1)[0][0]["status"] == "done"
    checked, seen = agent_ns["implement_vibes_checked"], agent_ns["implement_vibes_seen"]
    bar = {"ask": "Make the trend chart a bar chart", "check": {"kind": "chart_type", "value": "bar"}, "keep": False, "where": ""}
    chart = "dashboard:loss_trend"
    assert checked(bar, chart, weekly["charts"][0], seen(chart, weekly), V1, seen(chart, V1), "c", ("line", "bar"))[0] == "done"
    again = checked(bar, chart, weekly["charts"][0], seen(chart, weekly), weekly, seen(chart, weekly), "c", ("line", "bar"))
    assert again[0] == "done" and again[1].startswith(ALREADY), \
        "the chart kind check proves the built chart is a bar chart, so the ask is met even though it already was one"


def test_a_genie_agent_ask_counts_only_the_questions_and_instructions_a_person_sees(agent_ns):
    asks = {"g": [{"ask": "Genie should answer which stores lost the most last month", "check": None, "keep": False, "where": ""}]}
    new = [{"status": "done", "evidence": STORES, "where": "questions"}]
    assert _checks(agent_ns, "genie_space", "g", asks, new, GENIE_V2, GENIE_V1)[0][0]["status"] == "done"
    assert _checks(agent_ns, "genie_space", "g", asks, new, GENIE_V2, GENIE_V2)[0][0]["evidence"] == _old_quote(STORES)
    found, judged = _checks(agent_ns, "genie_space", "g", asks, [{"status": "done", "evidence": "SELECT store, SUM(loss)",
                                                                  "where": "instructions"}], GENIE_V2, GENIE_V1)
    assert found[0]["status"] == "missing" and "SELECT store" not in judged[0][1] and "- Top stores by loss" in judged[0][1]


def test_an_ask_the_builder_could_not_do_is_never_a_silent_done(agent_ns):
    asks = {"s": [{"ask": "Add a slider on the loss", "check": None, "keep": False, "where": ""}]}
    found, _judged = _checks(agent_ns, PAGE, "s", asks, [{"status": "done", "evidence": "column filter: priority tier", "where": "records"}],
                             V3, V2, ["Add a slider on the loss: the App shell has no slider filter"])
    assert found == [{"ask": "Add a slider on the loss", "status": "missing", "evidence": "the App shell has no slider filter"}]
    assert agent_ns["implement_vibes_warnings"](PAGE, found) == [
        "App page n01_u01 vibe not done: Add a slider on the loss: the App shell has no slider filter"]


def test_the_split_marks_keep_asks_and_the_element_an_ask_names(agent_ns):
    take = agent_ns["implement_vibes_asks"]
    assert take({"asks": [{"ask": "Keep the bar chart", "check": None, "keep": True, "where": " the  trend chart "},
                          {"ask": "Add a filter", "keep": "yes", "where": 3}]}) == [
        {"ask": "Keep the bar chart", "check": None, "keep": True, "where": "the trend chart"},
        {"ask": "Add a filter", "check": None, "keep": False, "where": ""}]
    prompt = agent_ns["implement_vibes_split_prompt"](PAGE, VIBE)
    assert '"keep": true' in prompt and '"where"' in prompt and "the Root-cause action plan table" not in prompt
    schema = agent_ns["IMPLEMENT_VIBES_SPLIT_SCHEMA"]["properties"]["asks"]["items"]["properties"]
    assert schema["keep"] == {"type": "boolean"} and schema["where"] == {"type": "string"}
    seed = agent_ns["implement_vibes_seed"]
    old = {PAGE: {"vibes_split": {"text": VIBE, "asks": [{"ask": ALL_COLUMNS, "check": None}]}}}
    assert seed(old) == {(PAGE, VIBE): [{"ask": ALL_COLUMNS, "check": None, "keep": None, "where": ""}]}, \
        "a split from before asks were marked does not know which asks keep things"
    assert seed({PAGE: {"vibes_split": {"text": VIBE, "asks": SPLIT}}}) == {(PAGE, VIBE): SPLIT}


def test_a_split_stored_before_asks_were_marked_is_kept_word_for_word_even_against_the_version_before(agent_ns):
    unknown = agent_ns["implement_vibes_seed"]({PAGE: {"vibes_split": {"text": VIBE, "asks": [{"ask": ALL_COLUMNS, "check": None}]}}})
    verdict = [{"status": "done", "evidence": "column filter: priority tier", "where": "records"}]
    inst = _inspire(agent_ns, FakeSpark())
    prompts = _judge(inst, {VIBE: SPLIT}, verdict)
    found = inst._implement_vibes_checks(dict(unknown), PAGE, VIBE, V3, built_before=V2)
    assert [p[0] for p in prompts] == ["judge"] and [c["ask"] for c in found] == [ALL_COLUMNS], \
        "unchanged words keep their stored asks, so a carried ask never changes its wording"
    prompts.clear()
    found = inst._implement_vibes_checks(dict(unknown), PAGE, VIBE, V3)
    assert [p[0] for p in prompts] == ["judge"] and [c["ask"] for c in found] == [ALL_COLUMNS], \
        "with no version before to compare, the stored split is kept and no model splits it"


def test_the_judge_sees_what_a_person_sees_now_and_before_and_names_where(agent_ns):
    seen = agent_ns["implement_vibes_seen"]
    prompt = agent_ns["implement_vibes_judge_prompt"](PAGE, SPLIT, seen(PAGE, V2), ["Add a map: no table holds a location"],
                                                      seen(PAGE, V1))
    now, before = prompt.split("What a person saw in it in the version before", 1)
    assert "- Priority tier" in now and "- Priority tier" not in before and "[filters] page filter bar:" in before
    assert f"1. {ALL_COLUMNS} [names {TABLE}]" in prompt and SQL not in prompt and "SUM(act_now_row)" not in prompt
    assert "The builder said it could not do these asks:\n- Add a map: no table holds a location" in prompt
    assert "The customer's asks are explicit user directives" in prompt and '"where": "<element id>"' in prompt
    schema = agent_ns["IMPLEMENT_VIBES_JUDGE_SCHEMA"]["properties"]["checks"]["items"]
    assert schema["properties"]["where"] == {"type": "string"} and "where" in schema["required"]
    keep = agent_ns["implement_vibes_judge_prompt"](PAGE, [dict(SPLIT[0], keep=True)], seen(PAGE, V2))
    assert "[asks to keep it as it is]" in keep and "version before" not in keep


def test_the_live_case_ends_the_version_with_vibe_not_done(agent_ns, tmp_path):
    saved = {"app": {"artifact": V1, "vibes": "", "spec_version": 2, "merged_into": ""}}
    inst, previous = _locked(agent_ns, None, lambda s: [{"asset_snapshots": json.dumps(saved)}] if s.startswith("SELECT asset_snapshots")
                             else [])
    inst.local_log_output_dir = str(tmp_path)
    _carrying(inst, PARTS, app={"snapshot": True})
    inst._implement_runner = lambda uc: "genie"
    inst._implement_app = _built("app", V2)
    _judge(inst, {VIBE: SPLIT}, [{"status": "done", "evidence": "Priority tier", "where": "filters"}])
    assert _run(inst, _vibed(previous, [PAGE], **{f"{PAGE}_vibes": VIBE})) == "vibe_not_met", "missed asks hold the version"
    final = inst.updates[-1]
    assert final["asset_status"]["held"]["reason"].startswith("2 asks are not met, so nothing of v3 is "
                                                              "published and v2 stays live: App (page n01_u01"), \
        "the held list is the checklist's, which names the output and the page on it"
    page = final["asset_status"][PAGE]
    assert [c["status"] for c in page["vibes_checks"]] == ["missing", "missing"] and page["state"] == "ready_with_warnings"
    missed = (f"{ALL_COLUMNS}: no table on the built App page n01_u01 has a column filter on all; "
              "the Fix plan table has no column filter on rank, entity_label, priority_tier, channel, value_at_stake")
    assert missed in final["asset_status"]["held"]["reason"] and final["status_message"].count(missed) == 1, \
        "the held message names each unmet ask once, in the reason, and never again as a vibe warning"
    assert "vibe not done" not in final["status_message"] and page["warnings"][0].startswith(ALL_COLUMNS), \
        "the page record keeps its own warning for the App"


ALERT_OUTPUTS = {"alert": True, "alert_tiers": "act_now", "alert_operator": ">=", "alert_threshold": 1.0, "alert_threshold_basis": "fixed",
                 "alert_condition_text": "", "alert_recipients": ["owner@example.com"],
                 "alert_destinations": [{"id": "dest-00000001", "name": "Ops channel"}]}
SIX = {"cron": "0 0 6 * * ?", "timezone": "Asia/Dubai", "enabled": True}
SEVEN = dict(SIX, cron="0 0 7 * * ?")
ALERT_SQL = "SELECT COUNT_IF(priority_tier = 'Act now') > 10 AS triggered FROM main.inspire.loss_out"


def _alert(agent_ns, cadence=SIX, **outputs):
    shown = agent_ns["implement_alert_shown"]("N01-U01 Loss alert", dict(ALERT_OUTPUTS, **outputs), cadence)
    return dict({"condition_text": outputs.get("alert_condition_text", ""), "condition_sql": ALERT_SQL}, **shown)


@pytest.mark.parametrize("cron,words", [
    ("0 0 7 * * ?", "at 07:00 every day"), ("0 30 6 ? * MON-FRI", "at 06:30 every Monday to Friday"),
    ("0 0 7 ? * MON", "at 07:00 every Monday"), ("0 0 7 ? * 2,4", "at 07:00 every Monday and Wednesday"),
    ("0 0 9 1 * ?", "at 09:00 on day 1 of every month"), ("15 0 7 * * ?", "at 07:00:15 every day"),
    ("0 */15 * * * ?", "on the schedule 0 */15 * * * ?"), ("0 0 7 ? 1 MON", "on the schedule 0 0 7 ? 1 MON"),
    ("0 0 7 L * ?", "on the schedule 0 0 7 L * ?"), ("0 0 7 ? * MON#2", "on the schedule 0 0 7 ? * MON#2")])
def test_a_job_schedule_reads_in_plain_words_and_anything_else_says_its_schedule(agent_ns, cron, words):
    assert agent_ns["implement_cron_words"](cron) == words


def test_an_alert_shows_its_name_schedule_recipients_and_condition_in_plain_words_never_its_sql(agent_ns):
    seen = agent_ns["implement_vibes_seen"]("alert", _alert(agent_ns))
    assert {key: element["lines"] for key, element in seen.items()} == {
        "alert": ["Alert name: N01-U01 Loss alert", "Fires when Act now rows in the latest run >= 1"],
        "schedule": ["Checked after each scheduled run of the job (0 0 6 * * ?, Asia/Dubai), once its notebook task has written the results",
                     "Runs at 06:00 every day (Asia/Dubai)"],
        "recipients": ["Sent to owner@example.com", "Sent to the destination Ops channel"],
        "clears": ["Sends one more email when it returns to OK"]}
    worded = agent_ns["implement_vibes_seen"]("alert", _alert(agent_ns, alert_condition_text="more than 5 stores lose money"))
    assert worded["alert"]["lines"][1:] == ["Fires when Act now rows in the latest run >= 1, or more than 5 stores lose money",
                                            "more than 5 stores lose money"]
    paused = agent_ns["implement_alert_shown"]("a", ALERT_OUTPUTS, dict(SIX, enabled=False))["schedule"]
    assert paused[-1] == "Its schedule, at 06:00 every day (Asia/Dubai), is paused"
    assert agent_ns["implement_alert_shown"]("a", ALERT_OUTPUTS, {})["schedule"] == [
        "Checked after each run of the job; the job has no schedule, so only when someone runs it"]


def test_an_alert_timing_ask_is_done_only_when_the_schedule_changed(agent_ns):
    asks = {"t": [{"ask": "Send it at 7am", "check": None, "keep": False, "where": ""}]}
    verdict = [{"status": "done", "evidence": "Runs at 07:00 every day (Asia/Dubai)", "where": "schedule"}]
    assert _checks(agent_ns, "alert", "t", asks, verdict, _alert(agent_ns, SEVEN), _alert(agent_ns, SIX))[0][0]["status"] == "done"
    assert _checks(agent_ns, "alert", "t", asks, verdict, _alert(agent_ns, SEVEN), _alert(agent_ns, SEVEN))[0][0]["evidence"] == (
        _old_quote("Runs at 07:00 every day (Asia/Dubai)"))
    found, judged = _checks(agent_ns, "alert", "t", asks, verdict, _alert(agent_ns, SIX), _alert(agent_ns, SIX))
    assert found[0]["status"] == "missing" and "- Runs at 06:00 every day (Asia/Dubai)" in judged[0][1]
    people = {"p": [{"ask": "Also send it to ops@example.com", "check": None, "keep": False, "where": ""}]}
    sent = [{"status": "done", "evidence": "Sent to ops@example.com", "where": "recipients"}]
    more = _alert(agent_ns, alert_recipients=["owner@example.com", "ops@example.com"])
    assert _checks(agent_ns, "alert", "p", people, sent, more, _alert(agent_ns))[0][0]["status"] == "done"
    assert _checks(agent_ns, "alert", "p", people, sent, _alert(agent_ns), _alert(agent_ns))[0][0]["status"] == "missing"


def test_an_alert_threshold_counts_only_when_the_alert_s_own_rule_holds_it_never_its_sql(agent_ns):
    checked, seen = agent_ns["implement_vibes_checked"], agent_ns["implement_vibes_seen"]
    ask = {"ask": "Fire at 10 Act now rows", "check": {"kind": "threshold", "value": 10}, "keep": False, "where": ""}
    ten, one = _alert(agent_ns, alert_threshold=10.0), _alert(agent_ns)
    assert checked(ask, "alert", ten, seen("alert", ten), one, seen("alert", one), "Alert")[0] == "done"
    again = checked(ask, "alert", ten, seen("alert", ten), ten, seen("alert", ten), "Alert")
    assert again[0] == "done" and again[1].startswith(ALREADY), \
        "the threshold check proves the built Alert fires at 10, so the ask is met and says the Alert already did"
    assert checked(ask, "alert", one, seen("alert", one), one, seen("alert", one), "Alert") == (
        "missing", "the built Alert uses no 10"), "only the condition SQL holds 10, so the ask is missing"
    found, judged = _checks(agent_ns, "alert", "q", {"q": [dict(ask, check=None)]},
                            [{"status": "done", "evidence": "COUNT_IF(priority_tier = 'Act now') > 10", "where": "alert"}], one, None)
    assert found[0]["status"] == "missing" and "COUNT_IF" not in judged[0][1]


@pytest.mark.parametrize("quoted", ["- Runs at 07:00 every day (Asia/Dubai)", '"Runs at 07:00 every day (Asia/Dubai)"',
                                    "-  - Runs at 07:00 every day (Asia/Dubai)"], ids=["bullet", "quotes", "two_bullets"])
def test_a_line_the_judge_quotes_with_its_bullet_or_quotes_still_counts(agent_ns, quoted):
    asks = {"t": [{"ask": "Send it at 7am", "check": None, "keep": False, "where": ""}]}
    found, judged = _checks(agent_ns, "alert", "t", asks, [{"status": "done", "evidence": quoted, "where": "schedule"}],
                            _alert(agent_ns, SEVEN), _alert(agent_ns, SIX))
    assert found[0] == {"ask": "Send it at 7am", "status": "done", "evidence": "Runs at 07:00 every day (Asia/Dubai)"}
    assert 'without the "- " that starts it' in judged[0][1]
    unchanged = _checks(agent_ns, "alert", "t", asks, [{"status": "done", "evidence": quoted, "where": "schedule"}],
                        _alert(agent_ns, SEVEN), _alert(agent_ns, SEVEN))[0]
    assert unchanged[0]["evidence"] == _old_quote("Runs at 07:00 every day (Asia/Dubai)"), "stripping the bullet never lets an unchanged line through as proof"


def test_a_filter_on_the_tier_column_shows_the_tiers_a_person_picks_from(agent_ns):
    seen = agent_ns["implement_vibes_seen"]
    assert "column filter: priority tier: Act now, Review, Monitor" in seen(PAGE, V3)["records"]["lines"]
    assert "column filter: Channel" in seen(PAGE, V3)["records"]["lines"], "a column with values from the data lists no choices"
    assert seen(PAGE, V2)["filters"]["lines"][-1] == "Priority tier: Act now, Review, Monitor"
    assert seen(PAGE, V1)["filters"]["lines"] == ["Channel", "Loss reason", "Category"]
    checked, ask = agent_ns["implement_vibes_checked"], SPLIT[1]
    assert checked(ask, PAGE, V3, seen(PAGE, V3), V2, seen(PAGE, V2), "App page n01_u01")[0] == "done"
    assert checked(ask, PAGE, V2, seen(PAGE, V2), V1, seen(PAGE, V1), "App page n01_u01") == (
        "missing", "the built Fix plan table on the App page n01_u01 never shows the words 'Act Now'"), \
        "the tiers in the page filter bar are not on the table the ask names"


def test_an_ask_that_names_no_element_is_done_where_this_version_shows_it_first(agent_ns):
    checked, seen = agent_ns["implement_vibes_checked"], agent_ns["implement_vibes_seen"]
    loose = dict(SPLIT[1], ask="Let me select Act Now", where="")
    found = checked(loose, PAGE, V2, seen(PAGE, V2), V1, seen(PAGE, V1), "App page n01_u01")
    assert found[0] == "done" and "Priority tier: Act now, Review, Monitor" in found[1], found
    again = checked(loose, PAGE, V2, seen(PAGE, V2), V2, seen(PAGE, V2), "App page n01_u01")
    assert again[0] == "done" and again[1].startswith(ALREADY), \
        "the text check proves the page shows the tiers, so the ask is met and says the page already did"


GENIE_ASK = "Add a sample question on stores"
HOLD_OUT = "Hold out the last 8 weeks"


def test_one_judge_call_per_round_judges_every_part_on_what_a_person_sees_now_and_in_the_version_before(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    prompts = _judge(inst, {VIBE: SPLIT, GENIE_ASK: [{"ask": GENIE_ASK, "check": None, "keep": False, "where": ""}]},
                     [{"status": "done", "evidence": "Priority tier", "where": "filters"},
                      {"status": "done", "evidence": f"- {STORES}", "where": "questions"}])
    found = inst._implement_vibes_round({}, [{"asset": PAGE, "text": VIBE, "artifact": V2, "built_before": V1},
                                             {"asset": "genie_space", "text": GENIE_ASK, "artifact": GENIE_V2, "built_before": GENIE_V1}],
                                        "N01-U01 round 1/3")
    [(_kind, prompt, schema)] = [p for p in prompts if p[0] == "judge"]
    assert schema["properties"]["checks"]["items"]["properties"]["status"]["enum"] == ["done", "missing", "no_data"]
    assert "What a person sees in part 1 as Inspire built it now" in prompt and "What a person sees in part 2" in prompt
    assert prompt.count("What a person saw in it in the version before") == 2
    assert f"1. (part 1) {ALL_COLUMNS} [names {TABLE}]\n2. (part 2) {GENIE_ASK}\n" in prompt
    assert "SUM(act_now_row)" not in prompt and "SELECT store" not in prompt and "CASE WHEN" not in prompt
    assert found["checks"][PAGE] == [
        {"ask": ALL_COLUMNS, "status": "missing", "evidence": "it was added to the page filter bar, not to the Fix plan table",
         "where": TABLE},
        {"ask": ACT_NOW, "status": "missing", "evidence": "the built Fix plan table on the App page n01_u01 never shows the words 'Act Now'",
         "where": TABLE, "checks": [{"name": "text: Act Now", "passed": False}]}], \
        "each check records the element its ask points to"
    assert found["checks"]["genie_space"] == [{"ask": GENIE_ASK, "status": "done", "evidence": STORES}]
    assert list(found["resend"]) == [PAGE]
    assert "it was added to the page filter bar, not to the Fix plan table" in agent_ns["implement_vibes_missed_text"](found["resend"])


def test_the_before_save_gate_sends_a_table_filter_put_on_the_filter_bar_back_to_genie_and_saves_the_fixed_one(agent_ns):
    import shell_sql
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_snapshot = lambda key, name, version: {"artifact": V1}
    inst._implement_app_shell = lambda: ({}, {"shell_sql": shell_sql})
    _judge(inst, {VIBE: SPLIT}, [{"status": "done", "evidence": "Priority tier", "where": "filters"}])
    context = {"uc_id": "N01-U01", "key": (5150, "N01-U01", 3), "spec": {"outputs": {f"{PAGE}_vibes": VIBE}},
               "asset_status": {"app": {"state": "ready", "spec_version": 2, "snapshot": True}},
               "genie_round": {"name": "app", "round": 1, "rounds": 3}}
    with pytest.raises(agent_ns["ImplementAsksMissed"]) as missed:
        inst._implement_output_vibes_gate(context, "app", V2)
    assert missed.value.feedback.startswith("\n\nInspire checked what you wrote against the user's asks before saving it")
    assert "the Fix plan table has no column filter on rank, entity_label, priority_tier, channel, value_at_stake" in missed.value.feedback
    assert context["previous_artifacts"] == {"app": V1}, "the gate compares with the version before even with no before record"
    _judge(inst, {VIBE: SPLIT}, [{"status": "done", "evidence": "column filter: priority tier: Act now, Review, Monitor",
                                  "where": "records"}])
    context["genie_round"] = {"name": "app", "round": 2, "rounds": 3}
    every = [{"column": column} for column in ("rank", "entity_label", "priority_tier", "channel", "value_at_stake")]
    inst._implement_output_vibes_gate(context, "app", dict(V3, records=dict(V3["records"], column_filters=every)))
    assert [c["status"] for c in context["round_vibes"]["app"]["checks"][PAGE]] == ["done", "done"]
    assert context["round_vibes"]["app"]["resend"] == {}


def test_the_before_save_gate_sends_back_an_ask_the_version_before_already_showed(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_snapshot = lambda key, name, version: {"artifact": V1}
    ask = "Add a channel filter"
    _judge(inst, {ask: [{"ask": ask, "check": None, "keep": False, "where": ""}]}, [{"status": "done", "evidence": "Channel", "where": "filters"}])
    context = {"uc_id": "N01-U01", "key": (5150, "N01-U01", 3), "spec": {"outputs": {f"{PAGE}_vibes": ask}},
               "asset_status": {"app": {"state": "ready", "spec_version": 2, "snapshot": True}},
               "genie_round": {"name": "app", "round": 1, "rounds": 3}}
    with pytest.raises(agent_ns["ImplementAsksMissed"]) as missed:
        inst._implement_output_vibes_gate(context, "app", V2)
    assert f"'{ask}': {_old_quote('Channel')}" in missed.value.missed
    context["genie_round"] = {"name": "app", "round": 3, "rounds": 3}
    inst._implement_output_vibes_gate(context, "app", V2)
    assert context["round_vibes"]["app"]["checks"][PAGE] == [{"ask": ask, "status": "missing", "evidence": _old_quote("Channel")}]


@pytest.mark.parametrize("before,status", [("# Score the churn risk\nmodel = fit(baseline, holdout=holdout_weeks)\n", "missing"),
                                           ("# Score the churn risk\nmodel = fit(baseline)\n", "done"), (None, "done")],
                         ids=["already_there", "new_in_this_version", "no_version_before"])
def test_the_notebook_round_compares_each_ask_with_the_notebook_from_before_this_version(agent_ns, before, status):
    from v140_implement_test import VALID
    inst = _inspire(agent_ns, FakeSpark())
    exported = lambda text: json.dumps({"cells": [{"cell_type": "code", "source": [text], "metadata": {}}]})
    inst._implement_export_text = lambda path: exported("# Score the churn risk\nmodel = fit(baseline, holdout=holdout_weeks)\n")
    _judge(inst, {HOLD_OUT: [{"ask": HOLD_OUT, "check": None, "keep": False, "where": ""}]},
           [{"status": "done", "evidence": "model = fit(baseline, holdout=holdout_weeks)", "where": ""}])
    spec = agent_ns["validate_implement_spec"](dict(VALID, data=dict(VALID["data"], notes=HOLD_OUT)))[0]
    vibes = {"asset_status": {}, "vibes_split": {}, "notebook_before": exported(before) if before else None}
    found = inst._implement_notebook_round_vibes("N01-U01", {"result_table": "main.inspire.churn_out"}, spec, "/W/nb", vibes, {}, 1, 3)
    [check] = found["checks"]["notebook"]
    assert check["status"] == status
    assert (check["evidence"] == _old_quote("model = fit(baseline, holdout=holdout_weeks)")) is (status == "missing")
    assert ("notebook" in found["resend"]) is (status == "missing"), "an ask the notebook already did goes back to Genie"


def test_a_refill_hands_the_notebook_from_before_this_version_to_the_genie_rounds(agent_ns, sdk_stub):
    from v140_implement_test import VALID, _probe_inspire
    inst = _probe_inspire(agent_ns, None, {"notebook": {"modified_at": 1000, "spec_version": 3, "result_history": 1},
                                           "dashboard": {"state": "ready", "spec_version": 2}})
    inst._implement_notebook_modified_at = lambda path: 1000
    inst._implement_claim_notebook = lambda use_case, spec, key, asset_status, current="": "/W/nb"
    inst._implement_runner = lambda uc: "runner"
    inst._implement_notebook_before = lambda path: "the notebook as it was"
    inst._implement_write_notebook = lambda uc, spec, previous, key, current="": "/W/nb"
    handed = []
    inst._implement_fill_and_preview = lambda uc_id, key, use_case, *rest: (
        handed.append(dict(use_case["_implement_vibe_state"])) or ({"status": "written", "rows_written": 12}, 77, {}))
    inst._implement_dashboard = lambda c, r: {"dashboard_id": "d1", "dashboard_url": "https://h/d"}
    inst._implement_genie_space = lambda c, r: {"genie_space_id": "g1", "genie_space_url": "https://h/genie/rooms/g1"}
    inst._implement_app = lambda c, r: {"app_name": "churn-desk", "app_url": "https://churn-desk.example", "app_health": "running"}
    got = inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 4, "spec_json": dict(VALID)},
                                     (5150, "N01-U01", 4))
    assert got == "ready" and [state["notebook_before"] for state in handed] == ["the notebook as it was"]


def test_the_alert_gate_judges_the_alert_a_person_will_see_and_that_is_the_alert_saved(agent_ns, tmp_path):
    from v140_implement_test import ALERT, _FileRunner, _alert_inspire, _output_context
    inst, _calls, _queries = _alert_inspire(agent_ns, tmp_path, rows=[{"triggered": True}])
    gate, gated = inst._implement_output_vibes_gate, []
    inst._implement_output_vibes_gate = lambda context, name, artifact, reported=(): gated.append(artifact) or gate(context, name, artifact,
                                                                                                                  reported)
    ask = "Fire on any Act now row"
    _judge(inst, {ask: [{"ask": ask, "check": None, "keep": False, "where": ""}]},
           [{"status": "done", "evidence": "Fires when Act now rows in the latest run >= 1", "where": "alert"}])
    context = _output_context(agent_ns, **ALERT, alert_vibes=ask)
    inst._implement_alert(context, _FileRunner([{"exit": 0}], [{"alert_condition.sql": ALERT_SQL.replace("main.inspire.loss_out",
                                                                                                        "main.s.orders")}]))
    [artifact] = gated
    assert artifact is context["artifacts"]["alert"] and artifact["trigger"] == "Act now rows in the latest run >= 1"
    assert artifact["recipients"] == ["owner@example.com"] and artifact["schedule"]
    assert context["round_vibes"]["alert"]["checks"]["alert"] == [
        {"ask": ask, "status": "done", "evidence": "Fires when Act now rows in the latest run >= 1"}]


CHANNEL = "Add a channel filter"
FILTER_BAR = "the page filter bar"
CARRIED = "the version before recorded this ask met, and the check quoted only what it already showed: "


def _against_record(agent_ns, ask, record, verdict=("done", "Channel", "filters"), where=""):
    inst = _inspire(agent_ns, FakeSpark())
    cache = {}
    _judge(inst, {ask: [{"ask": ask, "check": None, "keep": False, "where": where}]},
           [{"status": verdict[0], "evidence": verdict[1], "where": verdict[2]}])
    item = {"asset": PAGE, "text": ask, "artifact": V2, "reported": (), "failure": "", "chart_types": (), "previous": None,
            "retry": None, "built_before": V1, "asked_before": agent_ns["implement_vibes_met"](record, PAGE)}
    [check] = inst._implement_vibes_round(cache, [item], "App page n01_u01")["checks"][PAGE]
    return inst, cache, check


def test_a_judge_only_ask_the_version_before_recorded_met_is_met_with_the_already_there_note(agent_ns):
    record = {"vibes_checks": [{"ask": CHANNEL, "status": "done", "evidence": "Channel"}]}
    inst, cache, check = _against_record(agent_ns, CHANNEL, record)
    assert check["status"] == "done" and check["evidence"] == f"{ALREADY}{CARRIED}Channel", \
        "the version before recorded this exact ask met, so the old text the check quotes carries that verdict, with the note"
    emitted = []
    inst._implement_emit = lambda *args, **kwargs: emitted.append(args)
    context = {"asset_status": {PAGE: {"vibes_checks": [check], "vibes_split": {"text": CHANNEL}}}, "uc_id": "N01-U01", "vibe": None,
               "spec": {"outputs": {"app": True, f"{PAGE}_vibes": CHANNEL}}, "vibes_split": cache, "vibes_checked": {PAGE: CHANNEL}}
    [entry] = inst._implement_vibe_checklist(context)
    assert (entry["status"], entry["already_there"]) == ("met", True) and entry["evidence"] == check["evidence"]


@pytest.mark.parametrize("ask,record,why", [
    (CHANNEL, {}, "the recorded live case: a new ask whose only proof is a label the version before already showed"),
    (CHANNEL, {"vibes_checks": [{"ask": CHANNEL, "status": "missing", "evidence": "no channel filter"}]},
     "the version before recorded the ask not met"),
    (CHANNEL, {"vibes_checks": [{"ask": CHANNEL, "status": "done", "evidence": f"{ALREADY}{CARRIED}Channel"}]},
     "the version before met it only by carrying an older judge verdict, and carries never chain"),
    ("Add a channel filter now", {"vibes_checks": [{"ask": CHANNEL, "status": "done", "evidence": "Channel"}]},
     "the ask was edited, so its text hash differs from the one the version before recorded met"),
], ids=["live_channel_case", "recorded_not_met", "recorded_met_by_a_carry", "edited_ask"])
def test_a_judge_quote_of_old_text_stays_not_met_without_a_fresh_recorded_met_verdict(agent_ns, ask, record, why):
    _inst, _cache, check = _against_record(agent_ns, ask, record)
    assert check["status"] == "missing" and check["evidence"] == _old_quote("Channel"), why


def test_the_ask_identity_hashes_the_asset_the_element_and_the_ask_text_ignoring_case_and_spacing(agent_ns):
    identity = agent_ns["implement_ask_identity"]
    assert identity(PAGE, " The Fix plan  table", "Add a  Channel filter ") == identity(PAGE, "the fix plan table", "add a channel filter")
    assert len(identity(PAGE, "", CHANNEL)) == 16
    assert identity(PAGE, "", CHANNEL) != identity(PAGE, "", "Add a channel filter to the Fix plan table"), "an edited ask differs"
    assert identity(PAGE, TABLE, CHANNEL) != identity(PAGE, FILTER_BAR, CHANNEL), "the same ask on another element differs"
    assert identity(PAGE, "", CHANNEL) != identity("dashboard", "", CHANNEL), "the same ask on another part differs"
    met = agent_ns["implement_vibes_met"]({"vibes_checks": [{"ask": CHANNEL, "status": "done", "evidence": "Channel", "where": TABLE},
                                                            {"ask": "Show the region", "status": "done",
                                                             "evidence": f"{ALREADY}{CARRIED}Region"},
                                                            {"ask": "Sort by value", "status": "done",
                                                             "evidence": f"{ALREADY}Sorted by value"}]}, PAGE)
    assert met == {identity(PAGE, TABLE, CHANNEL), identity(PAGE, "", "Sort by value")}, \
        "a judge carry never counts as met for the next version, while a check-proven already-there verdict does"


@pytest.mark.parametrize("recorded_where,why", [
    (TABLE, "the same ask text was met on the Fix plan table, another element, so it proves nothing for the page filter bar"),
    ("the filters", "the ask's where changed, so its identity differs from the one the version before recorded met"),
], ids=["same_text_on_another_element", "where_changed"])
def test_a_met_record_of_the_same_ask_text_for_another_element_never_carries(agent_ns, recorded_where, why):
    record = {"vibes_checks": [{"ask": CHANNEL, "status": "done", "evidence": "Channel", "where": recorded_where}]}
    _inst, _cache, check = _against_record(agent_ns, CHANNEL, record, where=FILTER_BAR)
    assert check["status"] == "missing" and check["evidence"] == _old_quote("Channel"), why


def test_the_same_ask_on_the_same_element_still_carries_and_its_checklist_entry_names_that_element(agent_ns):
    record = {"vibes_checks": [{"ask": CHANNEL, "status": "done", "evidence": "Channel", "where": FILTER_BAR}]}
    inst, cache, check = _against_record(agent_ns, CHANNEL, record, where=FILTER_BAR)
    assert (check["status"], check["evidence"], check["where"]) == ("done", f"{ALREADY}{CARRIED}Channel", FILTER_BAR)
    inst._implement_emit = lambda *args, **kwargs: None
    context = {"asset_status": {PAGE: {"vibes_checks": [check], "vibes_split": {"text": CHANNEL}}}, "uc_id": "N01-U01", "vibe": None,
               "spec": {"outputs": {"app": True, f"{PAGE}_vibes": CHANNEL}}, "vibes_split": cache, "vibes_checked": {PAGE: CHANNEL}}
    [entry] = inst._implement_vibe_checklist(context)
    assert entry["already_there"] is True and entry["where"].endswith(FILTER_BAR), "the entry names the element the ask points to"


def test_one_ask_text_for_two_elements_in_one_round_carries_only_where_the_record_met_it(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    text = f"{CHANNEL} to the Fix plan table and {CHANNEL.lower()} to the page filter bar"
    cache = {}
    _judge(inst, {text: [{"ask": CHANNEL, "check": None, "keep": False, "where": TABLE},
                         {"ask": CHANNEL, "check": None, "keep": False, "where": FILTER_BAR}]},
           [{"status": "done", "evidence": "Channel", "where": "records"}, {"status": "done", "evidence": "Channel", "where": "filters"}])
    record = {"vibes_checks": [{"ask": CHANNEL, "status": "done", "evidence": "Channel", "where": TABLE}]}
    item = {"asset": PAGE, "text": text, "artifact": V2, "reported": (), "failure": "", "chart_types": (), "previous": None,
            "retry": None, "built_before": V1, "asked_before": agent_ns["implement_vibes_met"](record, PAGE)}
    table, bar = inst._implement_vibes_round(cache, [item], "App page n01_u01")["checks"][PAGE]
    assert (table["where"], table["status"], table["evidence"]) == (TABLE, "done", f"{ALREADY}{CARRIED}Channel"), \
        "the record met the ask on the Fix plan table, so that ask carries"
    assert (bar["where"], bar["status"], bar["evidence"]) == (FILTER_BAR, "missing", _old_quote("Channel")), \
        "the same ask text on the page filter bar was never met, so the Fix plan table's record proves nothing for it"
    inst._implement_emit = lambda *args, **kwargs: None
    context = {"asset_status": {PAGE: {"vibes_checks": [table, bar], "vibes_split": {"text": text}}}, "uc_id": "N01-U01", "vibe": None,
               "spec": {"outputs": {"app": True, f"{PAGE}_vibes": text}}, "vibes_split": cache, "vibes_checked": {PAGE: text}}
    entries = inst._implement_vibe_checklist(context)
    assert [(e["where"].rsplit(", ", 1)[-1], e["status"], bool(e.get("already_there"))) for e in entries] == [
        (TABLE, "met", True), (FILTER_BAR, "not_met", False)]
    assert agent_ns["implement_vibes_met"]({"vibes_checks": [table, bar]}, PAGE) == set(), \
        "the carried verdict never chains into the next version and the unmet ask never counts, so neither element is met next time"


def test_the_split_keeps_one_ask_text_for_two_elements_and_drops_only_a_true_repeat(agent_ns):
    asks = agent_ns["implement_vibes_asks"]({"asks": [{"ask": "Make it a bar chart", "where": "the trend chart"},
                                                       {"ask": "make it a  bar chart", "where": "the region chart"},
                                                       {"ask": "Make it a bar chart", "where": "The trend  chart"}]})
    assert [(a["ask"], a["where"]) for a in asks] == [("Make it a bar chart", "the trend chart"),
                                                      ("make it a bar chart", "the region chart")], \
        "an ask for another element is its own ask, never folded into the first one"


def test_the_rounds_genie_tried_stay_apart_for_one_ask_text_on_two_elements(agent_ns):
    tried, identity = {}, agent_ns["implement_ask_identity"]
    found = {"checks": {"dashboard": [{"ask": "Make it a bar chart", "status": "missing", "evidence": "a line", "where": "the trend chart"},
                                      {"ask": "Make it a bar chart", "status": "missing", "evidence": "an area",
                                       "where": "the region chart"}]}}
    agent_ns["implement_vibes_tried"](found, tried, 1)
    assert tried["dashboard"]["asks"] == {identity("dashboard", "the trend chart", "Make it a bar chart"): ["round 1: a line"],
                                          identity("dashboard", "the region chart", "Make it a bar chart"): ["round 1: an area"]}
