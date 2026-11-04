import base64
import json

import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import _inspire
from v161_app_column_filters_test import returns_page

ASSET = "app:page:n01_u01"
FILE = "blocks/" + "a" * 64 + ".png"
MICKEY = "Put Mickey Mouse in the middle of the page"
PAGE = {"id": "n01_u01", "title": "Loss desk", "question": "Which stores lose the most?", "hue": "teal",
        "records": {"title": "Fix plan", "key": "record_key", "label": "entity_label", "rank": "rank", "tier": "priority_tier",
                    "columns": [{"column": "channel", "label": "Channel"}]},
        "blocks": [{"id": "hero", "kind": "image", "place": {"where": "top"}, "width": "half", "align": "left",
                    "content": {"file": FILE, "alt": "Mickey Mouse", "caption": "Our mascot"}}]}
CENTERED = dict(PAGE, blocks=[dict(PAGE["blocks"][0], align="center")])
SIX = {"cron": "0 0 6 * * ?", "timezone": "Asia/Dubai", "enabled": True}
SEVEN = dict(SIX, cron="0 0 7 * * ?")
ALERT = {"alert": True, "alert_tiers": "act_now", "alert_operator": ">=", "alert_threshold": 1.0, "alert_threshold_basis": "fixed",
         "alert_condition_text": "", "alert_recipients": ["owner@example.com"], "alert_destinations": []}


def _judge(inst, splits, verdicts):
    prompts = []

    def llm(kind, prompt, schema):
        prompts.append((kind, prompt, schema))
        if kind == "split":
            return {"asks": splits[prompt.split('"""\n', 1)[1].rsplit('\n"""', 1)[0]]}
        return {"checks": [dict({"n": n, "where": ""}, **verdict) for n, verdict in enumerate(verdicts, 1)]}

    inst._implement_vibes_llm = llm
    return prompts


def _ask(text, check=None, where="", keep=False):
    return {"ask": text, "check": check, "keep": keep, "where": where}


def _vision(inst, replies):
    calls = []

    def api(method, path, body=None, query=None):
        calls.append((method, path, body))
        verdict = replies.pop(0) if replies else RuntimeError("no more replies")
        if isinstance(verdict, Exception):
            raise verdict
        return {"choices": [{"message": {"content": [{"type": "reasoning", "summary": [{"type": "summary_text", "text": "looking"}]},
                                                     {"type": "text", "text": json.dumps(verdict)}]}}]}

    inst._implement_api = api
    inst._implement_app_block_images = lambda context, page: [
        {"block": "hero", "file": FILE, "alt": "Mickey Mouse", "caption": "Our mascot", "url": "https://example.com/m.png",
         "media_type": "image/png", "bytes": b"\x89PNG-picture", "error": ""}]
    return calls


def _gate_context(ask_text, round_no=1):
    return {"uc_id": "N01-U01", "key": (5150, "N01-U01", 3), "spec": {"outputs": {"app": True, f"{ASSET}_vibes": ask_text}},
            "asset_status": {}, "genie_round": {"name": "app", "round": round_no, "rounds": 3}}


def test_the_judge_says_done_but_a_failing_block_gate_leaves_the_ask_not_met(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    split = {MICKEY: [_ask(MICKEY, [{"kind": "block", "value": {"kind": "image", "align": "center"}}])]}
    _judge(inst, split, [{"status": "done", "evidence": "image: Mickey Mouse"}])
    found = inst._implement_vibes_checks({}, ASSET, MICKEY, PAGE)
    assert found == [{"ask": MICKEY, "status": "missing",
                      "evidence": "no block on the built App page n01_u01 is kind image, align center; its blocks are block hero: image "
                                  "at the page top, half width, aligned left",
                      "checks": [{"name": "block: kind image, align center", "passed": False}]}]
    _judge(inst, split, [{"status": "done", "evidence": "image: Mickey Mouse"}])
    assert inst._implement_vibes_checks({}, ASSET, MICKEY, CENTERED)[0]["status"] == "done", "the centered block passes the same gate"


@pytest.mark.parametrize("kind,value,page,passed", [
    ("color", "teal", PAGE, True), ("color", "rose", PAGE, False),
    ("block", {"width": "half", "place": "top"}, PAGE, True), ("block", {"width": "full"}, PAGE, False),
    ("text", "Our mascot", PAGE, True), ("text", "Minnie", PAGE, False)])
def test_each_page_gate_decides_from_the_built_page_and_records_its_name_and_result(agent_ns, kind, value, page, passed):
    inst = _inspire(agent_ns, FakeSpark())
    ask = f"Ask about {kind}"
    prompts = _judge(inst, {ask: [_ask(ask, {"kind": kind, "value": value})]}, [{"status": "done", "evidence": "Loss desk"}])
    [check] = inst._implement_vibes_checks({}, ASSET, ask, page)
    assert check["status"] == ("done" if passed else "missing") and check["checks"][0]["passed"] is passed
    assert not [p for p in prompts if p[0] == "judge"], "a gate that decides needs no judge"


def test_a_table_column_filter_gate_uses_the_shell_s_own_filter_reading(agent_ns):
    import shell_sql
    gate = agent_ns["implement_column_filter_gate"]
    with_filter, without = returns_page(column_filters=[{"column": "channel"}]), returns_page(column_filters=[{"column": "channel", "off": True}])
    assert "channel" in {f["column"] for f in shell_sql.list_column_filters(with_filter)}
    assert "channel" not in {f["column"] for f in shell_sql.list_column_filters(without)}
    assert gate("channel", returns_page(column_filters=[]), "App page n09_u03", shell_sql, "records")[0] is True, \
        "a table filters every column it shows unless its column_filters turns one off"
    assert gate("channel", returns_page(column_filters=False), "App page n09_u03", shell_sql, "records")[0] is False
    assert gate("channel", with_filter, "App page n09_u03", shell_sql, "records")[0] is True
    assert gate("Channel", without, "App page n09_u03", shell_sql, "records")[0] is False
    assert gate("channel", with_filter, "App page n09_u03", None, "records") is None, "with no shell the judge decides"


def test_an_alert_schedule_and_recipient_gate_read_the_alert_a_person_sees(agent_ns):
    shown = lambda cadence, **outputs: dict({"condition_text": "", "condition_sql": "SELECT TRUE AS triggered"},
                                            **agent_ns["implement_alert_shown"]("N01-U01 Loss alert", dict(ALERT, **outputs), cadence))
    schedule, recipient = agent_ns["implement_schedule_gate"], agent_ns["implement_recipient_gate"]
    assert schedule("7am", shown(SEVEN), "Alert") == (True, "Runs at 07:00 every day (Asia/Dubai)")
    assert schedule("07:00", shown(SIX), "Alert")[0] is False and schedule("7 pm", shown(SEVEN), "Alert")[0] is False
    assert recipient("owner@example.com", shown(SIX), "Alert") == (True, "Sent to owner@example.com")
    assert recipient("ops@example.com", shown(SIX), "Alert") == (False, "the built Alert is sent to owner@example.com, not ops@example.com")
    inst = _inspire(agent_ns, FakeSpark())
    _judge(inst, {"Send it at 7am": [_ask("Send it at 7am", {"kind": "schedule", "value": "07:00"})]}, [])
    assert inst._implement_vibes_checks({}, "alert", "Send it at 7am", shown(SEVEN), built_before=shown(SIX))[0]["status"] == "done"
    _judge(inst, {"Send it at 7am": [_ask("Send it at 7am", {"kind": "schedule", "value": "07:00"})]}, [])
    unchanged = inst._implement_vibes_checks({}, "alert", "Send it at 7am", shown(SEVEN), built_before=shown(SEVEN))[0]
    assert unchanged["status"] == "done" and unchanged["evidence"] == f"{ALREADY}Runs at 07:00 every day (Asia/Dubai)", \
        "a run time the version before already had is met: the built Alert runs at 7am, so nothing needed to change"


def test_an_image_of_the_wrong_subject_goes_back_to_genie_with_the_reason_and_the_right_one_passes(agent_ns, monkeypatch):
    monkeypatch.setitem(agent_ns["TECHNICAL_CONTEXT"], "models", [{"name": "v", "llm_endpoint_name": "ep-vision", "type": "thinker",
                                                                   "size": "large", "order": 1, "enabled": True}])
    inst = _inspire(agent_ns, FakeSpark())
    ask = "Put Mickey Mouse at the top of the page"
    _judge(inst, {ask: [_ask(ask, [{"kind": "block", "value": {"kind": "image", "place": "top"}},
                                   {"kind": "image", "value": "Mickey Mouse himself, standing"}])]}, [])
    calls = _vision(inst, [{"subject": False, "look": True, "reason": "it shows a cartoon cat"},
                           {"subject": True, "look": True, "reason": "it shows Mickey Mouse standing"}])
    context = _gate_context(ask)
    with pytest.raises(agent_ns["ImplementAsksMissed"]) as missed:
        inst._implement_output_vibes_gate(context, "app", PAGE)
    assert f"'{ask}': block hero: it shows a cartoon cat" in missed.value.missed
    method, path, body = calls[0]
    assert (method, path) == ("POST", "/serving-endpoints/ep-vision/invocations")
    text, image = body["messages"][0]["content"]
    assert image == {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(b"\x89PNG-picture").decode()}}
    assert '"Mickey Mouse himself, standing"' in text["text"] and "### USER DIRECTIVES ARE THE SUPREME AUTHORITY" in text["text"]
    assert "the subject itself and never a similar or generic one" in text["text"] and "where it sits in the picture" not in text["text"]
    context["genie_round"] = {"name": "app", "round": 2, "rounds": 3}
    inst._implement_output_vibes_gate(context, "app", PAGE)
    [check] = context["round_vibes"]["app"]["checks"][ASSET]
    assert check["status"] == "done" and check["evidence"].endswith("block hero: it shows Mickey Mouse standing")
    assert check["checks"] == [{"name": "block: kind image, place top", "passed": True},
                               {"name": "image: Mickey Mouse himself, standing", "passed": True}]
    assert context["vibe_tried"][ASSET]["asks"][agent_ns["implement_ask_identity"](ASSET, "", ask)] == [
        "round 1: block hero: it shows a cartoon cat"], "the rounds Genie tried are kept per ask identity, its part, element and text"


def test_a_vision_call_that_fails_is_unchecked_and_never_resent(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    ask = "Show Mickey Mouse"
    _judge(inst, {ask: [_ask(ask, {"kind": "image", "value": "Mickey Mouse"})]}, [])
    _vision(inst, [RuntimeError("the endpoint timed out")])
    context = _gate_context(ask)
    inst._implement_output_vibes_gate(context, "app", PAGE)
    [check] = context["round_vibes"]["app"]["checks"][ASSET]
    assert check["status"] == "missing" and check["evidence"].startswith("Inspire could not check this ask: block hero:")
    assert context["round_vibes"]["app"]["resend"] == {}


def _carried(agent_ns, judged, artifact=PAGE, checked=None):
    inst = _inspire(agent_ns, FakeSpark())
    ask = "Show the Fix plan table"
    inst._implement_snapshot = lambda key, name, version: {"artifact": artifact}
    prompts = _judge(inst, {ask: [_ask(ask)]}, [judged])
    context = {"uc_id": "N01-U01", "key": (5150, "N01-U01", 4), "spec": {"outputs": {"app": True, f"{ASSET}_vibes": ask}, "data": {}},
               "asset_status": {"app": {"state": "ready", "spec_version": 2, "snapshot": True},
                                ASSET: {"state": "ready", "spec_version": 2, "vibes_split": {"text": ask, "asks": [_ask(ask)]},
                                        "vibes_checks": [{"ask": ask, "status": "done", "evidence": "Fix plan"}]}},
               "vibes_split": {}, **({"vibes_checked": checked} if checked else {})}
    return inst, context, prompts, ask


def test_a_carried_ask_on_an_output_this_version_did_not_build_is_checked_again_on_its_saved_copy(agent_ns):
    inst, context, prompts, ask = _carried(agent_ns, {"status": "missing", "evidence": "the page shows no table"})
    assert inst._implement_recheck_vibes(context, []) == [f"App page n01_u01 vibe not done: {ask}: the page shows no table"]
    assert context["asset_status"][ASSET]["vibes_checks"] == [{"ask": ask, "status": "missing", "evidence": "the page shows no table"}]
    [(_kind, prompt, _schema)] = [p for p in prompts if p[0] == "judge"]
    assert f"1. {ask} [asked in an earlier version]" in prompt and "version before" not in prompt
    inst, context, prompts, ask = _carried(agent_ns, {"status": "done", "evidence": "Fix plan"})
    assert inst._implement_recheck_vibes(context, []) == []
    assert context["asset_status"][ASSET]["vibes_checks"] == [{"ask": ask, "status": "done", "evidence": "Fix plan"}]
    inst, context, prompts, ask = _carried(agent_ns, {"status": "done", "evidence": "Fix plan"}, checked={ASSET: "Show the Fix plan table"})
    assert inst._implement_recheck_vibes(context, []) == [] and prompts == [], "an ask checked in this version is not checked twice"
    inst, context, prompts, ask = _carried(agent_ns, {"status": "missing", "evidence": "x"})
    context["asset_status"]["app"]["spec_version"] = 4
    assert inst._implement_recheck_vibes(context, []) == [] and prompts == [], "an output this version built is checked by its own build"


def test_a_version_that_builds_only_the_dashboard_still_checks_the_app_page_asks_and_lists_every_ask(agent_ns):
    from v143_vibes_test import _locked, _run
    from v148_asset_vibes_test import PAGE as BUILT_PAGE, PAGE_VIBES, PARTS, SPLITS, WIDGET_VIBES, _built, _carrying, _llm, _vibed
    inst, previous = _locked(agent_ns, {"app:page:n01_u01_vibes": PAGE_VIBES})
    checks = [{"ask": "Keep the region filter", "status": "done", "evidence": "filter region"},
              {"ask": "Add a count of customers at risk", "status": "done", "evidence": "Customers at risk"}]
    _carrying(inst, dict(PARTS, **{ASSET: dict(PARTS[ASSET], vibes_split={"text": PAGE_VIBES, "asks": SPLITS[PAGE_VIBES]},
                                               vibes_checks=checks)}), app={"snapshot": True})
    inst._implement_snapshot = lambda key, name, version: {"artifact": BUILT_PAGE}
    inst._implement_runner = lambda uc: "genie"
    inst._implement_dashboard = _built("dashboard", BUILT_PAGE)
    seen = _llm(inst)
    _run(inst, _vibed(previous, ["dashboard:by_region"], **{"dashboard:by_region_vibes": WIDGET_VIBES}))
    final = inst.updates[-1]["asset_status"]
    assert final[ASSET]["spec_version"] == 3 and [c["status"] for c in final[ASSET]["vibes_checks"]] == ["done", "done"]
    assert any(kind == "judge" and "App page n01_u01" in prompt and "[asked in an earlier version]" in prompt for kind, prompt in seen)
    assert [(e["requirement"], e["part"], e["where"]) for e in final["checklist"]] == [
        ("Make it a horizontal bar chart", "dashboard", "widget by_region"), ("Keep the biggest regions first", "dashboard", "widget by_region"),
        ("Keep the region filter", "app", "page n01_u01"), ("Add a count of customers at risk", "app", "page n01_u01")]
    assert final["checklist_summary"]["total"] == 4 and [e["status"] for e in final["checklist"][2:]] == ["met", "met"]


def _checklist_context(agent_ns, records):
    spec = {"outputs": {"app": True, f"{ASSET}_vibes": "Show the Fix plan table and add a map", "alert": True, "alert_vibes": "Send it at 7am"},
            "data": {"notes": "Hold out the last 8 weeks"}}
    split = {(ASSET, "Show the Fix plan table and add a map"): [_ask("Show the Fix plan table", where="the Fix plan table"),
                                                                 _ask("Add a map")],
             ("alert", "Send it at 7am"): [_ask("Send it at 7am", {"kind": "schedule", "value": "07:00"})],
             ("notebook", "Hold out the last 8 weeks"): [_ask("Hold out the last 8 weeks")]}
    checked = {asset: (record.get("vibes_split") or {}).get("text") for asset, record in records.items()}
    return {"uc_id": "N01-U01", "key": (5150, "N01-U01", 4), "spec": spec, "asset_status": records, "vibes_split": split,
            "vibes_checked": checked}


def _record(text, checks):
    return {"state": "ready", "vibes_split": {"text": text}, "vibes_checks": checks}


def test_the_checklist_is_written_and_shown_live_when_every_ask_is_met(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    emitted = []
    inst._implement_emit = lambda uc_id, step, message, status, payload=None, step_id=None: emitted.append((step, message, status, payload))
    done = lambda ask, evidence, **extra: dict({"ask": ask, "status": "done", "evidence": evidence}, **extra)
    context = _checklist_context(agent_ns, {
        "notebook": _record("Hold out the last 8 weeks", [done("Hold out the last 8 weeks", "holdout=8", rounds=2)]),
        ASSET: _record("Show the Fix plan table and add a map", [done("Show the Fix plan table", "Fix plan", where="the Fix plan table"),
                                                                 done("Add a map", "map")]),
        "alert": _record("Send it at 7am", [done("Send it at 7am", "Runs at 07:00 every day (UTC)",
                                                 checks=[{"name": "schedule: 07:00", "passed": True}])])})
    entries = inst._implement_vibe_checklist(context)
    assert context["asset_status"]["checklist_summary"] == {"met": 4, "total": 4}
    assert context["asset_status"]["checklist"] == entries and [e["n"] for e in entries] == [1, 2, 3, 4]
    assert entries[0] == {"n": 1, "requirement": "Hold out the last 8 weeks", "part": "notebook", "where": "", "status": "met",
                          "evidence": "holdout=8", "fact": "holdout=8", "rounds": 2, "tried": [], "checks": [], "published_anyway": None}
    assert entries[1]["part"] == "app" and entries[1]["where"] == "page n01_u01, the Fix plan table", \
        "the entry names the element its check records, as every check of a run now does"
    assert entries[3]["checks"] == [{"name": "schedule: 07:00", "passed": True}] and entries[3]["part"] == "alert"
    assert emitted == [("Vibe checklist", "4 of 4 vibe requirements met", "ended_success", {"checklist": entries, "met": 4, "total": 4})]


def test_no_held_ask_is_ever_dropped_from_the_checklist_even_one_nothing_checked(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    emitted = []
    inst._implement_emit = lambda uc_id, step, message, status, payload=None, step_id=None: emitted.append((step, message, status))
    missed = {"ask": "Add a map", "status": "missing", "evidence": "no map", "rounds": 3, "tried": ["round 1: no map", "round 2: no map",
                                                                                               "round 3: no map"]}
    context = _checklist_context(agent_ns, {
        ASSET: _record("Show the Fix plan table and add a map", [{"ask": "Show the Fix plan table", "status": "done", "evidence": "Fix"},
                                                               missed]),
        "alert": _record("Send it later", [{"ask": "Send it later", "status": "done", "evidence": "old"}])})
    entries = inst._implement_vibe_checklist(context)
    assert [(e["requirement"], e["status"]) for e in entries] == [
        ("Hold out the last 8 weeks", "not_met"), ("Show the Fix plan table", "met"), ("Add a map", "not_met"), ("Send it at 7am", "not_met")]
    assert entries[0]["evidence"] == entries[3]["evidence"] == ("Inspire could not check this ask: Inspire did not check it in this "
                                                                "version. Nothing shows the ask was missed: press Try again to check it again")
    assert entries[2]["tried"] == missed["tried"] and entries[2]["rounds"] == 3
    assert context["asset_status"]["checklist_summary"] == {"met": 1, "total": 4}
    assert emitted == [("Vibe checklist", "1 of 4 vibe requirements met", "ended_warning")]
    inst._implement_vibe_checklist(dict(context, spec={"outputs": {}, "data": {}}))
    assert "checklist" not in context["asset_status"] and "checklist_summary" not in context["asset_status"], "no asks, no stale list"


def test_impossible_can_no_longer_be_returned_or_stored(agent_ns):
    assert agent_ns["IMPLEMENT_VIBES_JUDGE_SCHEMA"]["properties"]["checks"]["items"]["properties"]["status"]["enum"] == ["done", "missing", "no_data"]
    inst = _inspire(agent_ns, FakeSpark())
    ask = "Show the Fix plan table"
    _judge(inst, {ask: [_ask(ask)]}, [{"status": "impossible", "evidence": "a page cannot show that"}])
    kept = [{"ask": "Add a map", "status": "missing", "evidence": "old", "doable": False}]
    found = inst._implement_vibes_round({}, [{"asset": ASSET, "text": ask, "artifact": PAGE, "previous": kept, "retry": ["Show the Fix plan table"]}],
                                        "test")
    assert found["checks"][ASSET] == [{"ask": ask, "status": "missing", "evidence": "the check gave no answer for this ask"}]
    assert found["resend"] == {ASSET: found["checks"][ASSET]}
    assert "doable" not in json.dumps(found) and "impossible" not in json.dumps(found)


def _facts_spark(agent_ns):
    def respond(statement):
        if statement.startswith("DESCRIBE TABLE"):
            return [{"col_name": "value_at_stake", "data_type": "double"}, {"col_name": "priority_tier", "data_type": "string"}]
        if "COUNT(DISTINCT" in statement:
            return [{"n": 40, "non_null": 40, "distinct_values": 38, "low": "12.5", "high": "9800.0"}]
        if statement.startswith("SELECT DISTINCT"):
            return [{"v": "9800.0"}, {"v": "12.5"}]
        return []

    return FakeSpark(responder=respond)


@pytest.mark.parametrize("value,status,evidence", [
    ({"column": "value_at_stake", "min": 0}, "done",
     "column value_at_stake: 40 rows in the latest run, 40 not empty, 38 distinct, spanning 9.79K"),
    ({"column": "value_at_stake", "min": 100}, "missing", "some values are below 100"),
    ({"column": "value_at_stake", "values": ["9800.0", "0"]}, "missing", "it never holds 0"),
    ({"column": "discount"}, "missing", "column discount: the result table has no such column")])
def test_a_notebook_ask_is_checked_on_the_facts_of_its_latest_run(agent_ns, value, status, evidence):
    spark = _facts_spark(agent_ns)
    inst = _inspire(agent_ns, spark)
    ask, other = "Every row carries the money at stake", "Explain the money at stake"
    prompts = _judge(inst, {f"{ask}. {other}": [_ask(ask, {"kind": "result", "value": value}), _ask(other)]},
                     [{"status": "missing", "evidence": "no cell explains it"}])
    found = inst._implement_vibes_round({}, [{"asset": "notebook", "text": f"{ask}. {other}", "artifact": "# Score\nx = 1\n",
                                              "result_table": "main.inspire.loss_out"}], "N01-U01 notebook")
    check = found["checks"]["notebook"][0]
    assert check["status"] == status and evidence in check["evidence"]
    latest = agent_ns["implement_latest_run_filter"]("main.inspire.loss_out")
    queries = [s for s in spark.statements if not s.startswith("DESCRIBE")]
    assert (len(queries) == 2) is (value["column"] == "value_at_stake"), "a column the table lacks is never queried"
    assert all(latest in s and "SELECT *" not in s for s in queries)
    assert all("COUNT(DISTINCT" in s or s.endswith(f"LIMIT {agent_ns['IMPLEMENT_VIBES_RESULT_VALUES']}") for s in queries)
    if value["column"] == "value_at_stake":
        [(_kind, prompt, _schema)] = [p for p in prompts if p[0] == "judge"]
        assert "column value_at_stake: 40 rows in the latest run" in prompt, "the judge reads the same facts"


ALREADY = "already there in the version before, so nothing needed to change for it: "


def _alert_shown(agent_ns, cadence, **outputs):
    return dict({"condition_text": "", "condition_sql": "SELECT TRUE AS triggered"},
                **agent_ns["implement_alert_shown"]("N01-U01 Loss alert", dict(ALERT, **outputs), cadence))


def _gated(agent_ns, checks, built, before):
    inst = _inspire(agent_ns, FakeSpark())
    _judge(inst, {"Send it at 7am to ops": [_ask("Send it at 7am to ops", checks)]}, [])
    return inst._implement_vibes_checks({}, "alert", "Send it at 7am to ops", built, built_before=before)[0]


def test_a_gate_the_version_before_already_passed_is_met_with_the_note_and_a_new_gate_drops_it(agent_ns):
    both = [{"kind": "schedule", "value": "07:00"}, {"kind": "recipient", "value": "ops@example.com"}]
    ops = _alert_shown(agent_ns, SEVEN, alert_recipients=["ops@example.com"])
    mixed = _gated(agent_ns, both, ops, _alert_shown(agent_ns, SEVEN))
    assert mixed["status"] == "done" and not mixed["evidence"].startswith(ALREADY), \
        "the recipient is new in this version, so the ask is met by new work and carries no already-there note"
    same = _gated(agent_ns, both, ops, ops)
    assert same["status"] == "done" and same["evidence"].startswith(ALREADY) and same["evidence"].count(ALREADY) == 1, \
        "every gate already passed before, so the ask is met and says so once"
    failing = _gated(agent_ns, both, _alert_shown(agent_ns, SIX, alert_recipients=["ops@example.com"]), ops)
    assert failing["status"] == "missing" and not failing["evidence"].startswith(ALREADY), \
        "a gate that fails on the built version is missing, whatever the version before had"
