import json

import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import _inspire
from v203_vibe_judge_data_test import CLEAN, SOURCES, USE_CASE, VALID, _held
from v218_keep_rest_live_test import GENIE, KEEP, SPLIT, V4, V5, VIBE, _copy, _shell

WEATHER = "Add a bar chart of late lines by weather"
LACKING = "Add a KPI tile of each supplier's ESG score"
UNSURE = "Add a KPI tile that flags suppliers with poor ESG ratings"
DONE_QUOTE = "late_rate = late_lines / total_lines"
NO_ANSWER = {"checks": []}


def _split(asks):
    return {"asks": [a if isinstance(a, dict) else {"ask": a, "check": None, "keep": False, "where": "", "draws": "chart"}
                     for a in asks]}


def _llm(asks, judge_replies=(), split_failures=0):
    calls, replies = [], list(judge_replies)

    def llm(kind, prompt, schema, skip_cache=False):
        calls.append((kind, skip_cache))
        if kind == "split":
            if sum(1 for k, _s in calls if k == "split") <= split_failures:
                raise ValueError("the model replied with no JSON object: <html>")
            return _split(asks)
        reply = replies[min(sum(1 for k, _s in calls if k == "judge"), len(replies)) - 1] if replies else NO_ANSWER
        if isinstance(reply, Exception):
            raise reply
        return json.loads(json.dumps(reply))

    return llm, calls


def _judged(calls):
    return [k for k, _s in calls if k == "judge"]


def _hold(agent_ns, asks, replies=(), sources=SOURCES, use_case=USE_CASE, spark=None, real_sources=False):
    inst = _inspire(agent_ns, spark or FakeSpark())
    inst._implement_vibes_llm, calls = _llm(asks, replies)
    if real_sources:
        inst._genie_involved_tables = lambda uc: list(sources)
    else:
        inst._implement_vibes_sources = lambda spec, uc: sources
    texts = [a if isinstance(a, str) else a["ask"] for a in asks]
    held = inst._implement_vibes_hold("N02-U05", dict(use_case), {"data": {"notes": " ".join(texts)}, "outputs": {}}, {})
    return held, _judged(calls), inst


def _verdict(status, evidence, n=1):
    return {"checks": [{"n": n, "status": status, "evidence": evidence, "where": ""}]}


def _describe(columns):
    return [{"col_name": name, "data_type": "string", "comment": comment} for name, comment in columns]


def _spark(tables, fail=()):
    def respond(statement):
        if not statement.startswith("DESCRIBE TABLE"):
            return []
        for table, columns in tables.items():
            if all(f"`{part}`" in statement for part in table.split(".")):
                if table in fail:
                    raise RuntimeError("[INSUFFICIENT_PERMISSIONS] User does not have SELECT on table")
                return _describe(columns)
        raise RuntimeError("[TABLE_OR_VIEW_NOT_FOUND] The table cannot be found")
    return FakeSpark(responder=respond)


DESCRIBED = {"samples.tpch.lineitem": [(c, "") for c in SOURCES["samples.tpch.lineitem"]],
             "samples.tpch.supplier": [("s_suppkey", ""), ("s_name", "Vendor name as printed on invoices"),
                                       ("s_nationkey", ""), ("s_acctbal", "")],
             "samples.tpch.nation": [(c, "") for c in SOURCES["samples.tpch.nation"]]}


def test_an_ask_grouped_by_data_no_table_holds_is_held_before_genie_when_the_check_agrees(agent_ns):
    held, judged, inst = _hold(agent_ns, [WEATHER], [_verdict("no_data", "no column holds the weather")])
    reason = held[agent_ns["IMPLEMENT_NOTEBOOK"]][WEATHER]
    assert reason.startswith(agent_ns["IMPLEMENT_VIBES_NO_DATA"]) and "weather" in reason
    assert all(table in reason for table in SOURCES), reason
    assert judged == ["judge"]
    assert inst.logger.matching("[IMPLEMENT-VIBES-NO-COLUMN FIRED] N02-U05")
    shown = agent_ns["implement_checklist_texts"](reason)
    assert shown["evidence"].endswith(agent_ns["IMPLEMENT_NO_DATA_CHOICES"])
    text = agent_ns["implement_choices_markdown"]({"data": {"notes": WEATHER}, "config": {}, "outputs": {}}, held=held)
    assert f"1. {WEATHER} ({reason[len(agent_ns['IMPLEMENT_VIBES_NO_DATA']):]})" in text and "Never build them" in text


def test_an_ask_by_a_column_the_sources_hold_is_never_held_and_needs_no_judge(agent_ns):
    held, judged, _inst = _hold(agent_ns, [VALID, "Add a table of late lines per supplier"])
    assert held == {} and judged == []


def test_an_ask_by_a_name_only_a_column_description_holds_is_never_held(agent_ns):
    ask = "Add a bar chart of late lines by vendor"
    held, judged, _inst = _hold(agent_ns, [ask], [_verdict("missing", "the chart is not built yet")],
                                spark=_spark(DESCRIBED), real_sources=True)
    assert held == {} and judged == []


def test_an_ask_by_a_word_the_use_case_itself_uses_is_left_to_the_judge(agent_ns):
    use_case = dict(USE_CASE, statement=USE_CASE["statement"] + " and how weather delays shift it")
    held, judged, _inst = _hold(agent_ns, [WEATHER], [_verdict("missing", "the chart is not built yet")], use_case=use_case)
    assert held == {} and judged == []


@pytest.mark.parametrize("ask", ["Add a bar chart of late lines by delay band", "Add a chart of late lines by risk tier",
                                 "Add a chart of late lines by weekday", "Add a table of late lines by the largest gap"])
def test_a_grouping_inspire_can_work_out_from_the_data_is_never_held_by_the_pre_check(agent_ns, ask):
    held, _judged_calls, inst = _hold(agent_ns, [ask], [_verdict("missing", "the chart is not built yet")])
    assert held == {} and not inst.logger.matching("[IMPLEMENT-VIBES-NO-COLUMN FIRED]")


def test_an_ask_whose_grouping_another_ask_adds_is_left_to_genie(agent_ns):
    adds = {"ask": "Add a weather column from the supplier nation", "check": {"kind": "column", "value": "weather"}, "keep": False,
            "where": "", "draws": ""}
    held, _judged_calls, inst = _hold(agent_ns, [adds, WEATHER], [{"checks": [
        {"n": 1, "status": "missing", "evidence": "not built yet", "where": ""},
        {"n": 2, "status": "missing", "evidence": "not built yet", "where": ""}]}])
    assert held == {} and not inst.logger.matching("[IMPLEMENT-VIBES-NO-COLUMN FIRED]")


def test_the_pre_check_never_holds_when_a_source_table_could_not_be_read(agent_ns):
    sources = dict(SOURCES, **{"samples.tpch.orders": []})
    held, judged, _inst = _hold(agent_ns, [WEATHER], sources=sources)
    assert held == {} and judged == []


def test_a_grouping_the_latest_results_hold_is_never_held(agent_ns):
    tables = dict(DESCRIBED, **{"main.inspire.n02_u05_out": [("supplier_key", ""), ("weather_flag", "")]})
    use_case = dict(USE_CASE, result_table="main.inspire.n02_u05_out")
    held, _judged_calls, inst = _hold(agent_ns, [WEATHER], [_verdict("missing", "the chart is not built yet")], use_case=use_case,
                                      spark=_spark(tables), real_sources=True)
    assert held == {} and not inst.logger.matching("[IMPLEMENT-VIBES-NO-COLUMN FIRED]")


def test_a_kept_or_removed_grouping_is_never_held(agent_ns):
    keep = {"ask": "Keep the chart by weather", "check": None, "keep": True, "where": "the chart by weather", "draws": "chart"}
    remove = {"ask": "Remove the chart by weather", "check": None, "keep": False, "where": "the chart by weather", "draws": "chart"}
    held, _judged_calls, inst = _hold(agent_ns, [keep, remove], [{"checks": [
        {"n": 1, "status": "missing", "evidence": "not built yet", "where": ""},
        {"n": 2, "status": "missing", "evidence": "not built yet", "where": ""}]}])
    assert held == {} and not inst.logger.matching("[IMPLEMENT-VIBES-NO-COLUMN FIRED]")


def test_a_column_read_that_failed_is_read_again_and_its_descriptions_count(agent_ns):
    inst = _inspire(agent_ns, _spark(DESCRIBED, fail={"samples.tpch.supplier"}))
    inst._genie_involved_tables = lambda uc: list(SOURCES)
    first = inst._implement_vibes_sources({}, USE_CASE)
    assert first["samples.tpch.supplier"] == []
    inst.spark = _spark(DESCRIBED)
    again = inst._implement_vibes_sources({}, USE_CASE)
    assert again["samples.tpch.supplier"] == SOURCES["samples.tpch.supplier"]
    assert "vendor" in agent_ns["implement_vibes_held_terms"](again, USE_CASE, inst._implement_vibes_notes(again))


def test_a_judge_reply_that_answers_no_ask_is_asked_again_and_never_lets_the_ask_reach_genie_as_missed(agent_ns):
    found, calls = _round(agent_ns, [NO_ANSWER, NO_ANSWER])
    [check] = found["checks"][agent_ns["IMPLEMENT_NOTEBOOK"]]
    assert check["status"] == "missing" and check["evidence"].startswith(agent_ns["IMPLEMENT_VIBES_UNCHECKED"])
    assert "gave no usable answer" in check["evidence"]
    assert found["resend"] == {} and _judged(calls) == ["judge", "judge"]


def test_a_judge_reply_that_answers_no_ask_takes_the_answer_of_the_second_call(agent_ns):
    found, calls = _round(agent_ns, [NO_ANSWER, _verdict("done", DONE_QUOTE)])
    [check] = found["checks"][agent_ns["IMPLEMENT_NOTEBOOK"]]
    assert (check["status"], check["evidence"]) == ("done", DONE_QUOTE)
    assert _judged(calls) == ["judge", "judge"]


@pytest.mark.parametrize("reply", [_verdict("impossible", "a chart cannot be drawn"), _verdict("done", ""), {"verdicts": []},
                                   {"checks": [{"n": 7, "status": "done", "evidence": DONE_QUOTE, "where": ""}]}],
                         ids=["unknown_status", "done_without_evidence", "no_checks_key", "wrong_number"])
def test_a_judge_reply_with_no_usable_verdict_is_could_not_check_never_done_or_missed(agent_ns, reply):
    found, calls = _round(agent_ns, [reply, reply])
    [check] = found["checks"][agent_ns["IMPLEMENT_NOTEBOOK"]]
    assert check["status"] == "missing" and check["evidence"].startswith(agent_ns["IMPLEMENT_VIBES_UNCHECKED"]), check
    assert found["resend"] == {} and _judged(calls) == ["judge", "judge"]


def test_a_met_ask_stays_done_with_one_judge_call(agent_ns):
    found, calls = _round(agent_ns, [_verdict("done", DONE_QUOTE)])
    [check] = found["checks"][agent_ns["IMPLEMENT_NOTEBOOK"]]
    assert (check["status"], check["evidence"]) == ("done", DONE_QUOTE)
    assert _judged(calls) == ["judge"] and found["resend"] == {}


def test_a_missed_ask_still_goes_back_to_genie(agent_ns):
    found, calls = _round(agent_ns, [_verdict("missing", "the notebook shows no chart by nation")])
    [check] = found["checks"][agent_ns["IMPLEMENT_NOTEBOOK"]]
    assert (check["status"], check["evidence"]) == ("missing", "the notebook shows no chart by nation")
    assert agent_ns["IMPLEMENT_NOTEBOOK"] in found["resend"] and _judged(calls) == ["judge"]


def test_an_ask_that_could_not_be_checked_holds_the_version_and_says_the_check_could_not_run(agent_ns):
    found, _calls = _round(agent_ns, [NO_ANSWER, NO_ANSWER])
    inst = _inspire(agent_ns, FakeSpark())
    notebook = agent_ns["IMPLEMENT_NOTEBOOK"]
    asks = [{"ask": VALID, "check": None, "keep": False, "where": ""}]
    context = {"uc_id": "N02-U05", "key": (5150, "N02-U05", 2), "spec": {"data": {"notes": VALID}, "outputs": {}},
               "asset_status": {notebook: {"vibes_checks": found["checks"][notebook]}}, "vibes_split": {(notebook, VALID): asks},
               "vibes_checked": {notebook: VALID}}
    [entry] = inst._implement_vibe_checklist(context)
    assert entry["status"] == "not_met" and entry["unchecked"] is True
    unmet = agent_ns["implement_unmet_asks"](context["asset_status"])
    reason = agent_ns["implement_unmet_published_text"](unmet, 2)
    assert reason.startswith("v2 is published with 1 unmet ask (not met or could not be checked)")
    assert "gave no usable answer" in reason


def test_a_pre_build_judge_reply_that_answers_no_ask_lets_genie_try_and_logs_it(agent_ns):
    held, judged, inst = _hold(agent_ns, [UNSURE, VALID], [NO_ANSWER, NO_ANSWER])
    assert held == {} and judged == ["judge", "judge"]
    assert inst.logger.matching("[IMPLEMENT-VIBES-HOLD-SKIPPED FIRED] N02-U05")


def test_a_pre_build_judge_that_says_the_data_exists_lets_the_ask_reach_genie(agent_ns):
    held, judged, _inst = _hold(agent_ns, [UNSURE], [_verdict("missing", "the chart is not built yet")])
    assert held == {} and judged == ["judge"]


def _round(agent_ns, replies, asks=(VALID,), artifact=CLEAN, item=None):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_vibes_llm, calls = _llm(list(asks), replies)
    item = item or {"asset": agent_ns["IMPLEMENT_NOTEBOOK"], "text": " ".join(asks), "artifact": artifact, "sources": SOURCES,
                    "held_terms": _held(agent_ns)}
    return inst._implement_vibes_round({}, [item], "N02-U05 notebook round 1/3"), calls


def test_a_split_that_fails_is_asked_again_without_the_cache(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_vibes_llm, calls = _llm([VALID, LACKING], split_failures=1)
    asks = inst._implement_vibes_asks({}, agent_ns["IMPLEMENT_NOTEBOOK"], f"{VALID}. {LACKING}.")
    assert [a["ask"] for a in asks] == [VALID, LACKING] and not any(a.get("unsplit") for a in asks)
    assert calls == [("split", False), ("split", True)]
    assert inst.logger.matching("[IMPLEMENT-VIBES-SPLIT-RETRY FIRED]")


def test_a_split_that_fails_twice_checks_each_sentence_and_is_split_again_in_the_next_version(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_vibes_llm, calls = _llm([VALID, LACKING], split_failures=2)
    notebook = agent_ns["IMPLEMENT_NOTEBOOK"]
    text = f"{VALID}. {LACKING}."
    asks = inst._implement_vibes_asks({}, notebook, text)
    assert [a["ask"] for a in asks] == [f"{VALID}.", f"{LACKING}."] and all(a["unsplit"] for a in asks)
    assert calls == [("split", False), ("split", True)]
    seeded = agent_ns["implement_vibes_seed"]({notebook: {"vibes_split": {"text": text, "asks": asks}}})
    assert seeded == {}


def test_a_result_ask_whose_results_could_not_be_read_is_could_not_check_even_when_the_judge_says_done(agent_ns):
    ask = {"ask": "Keep every risk score between 0 and 1", "check": {"kind": "result", "value": {"column": "risk_score", "min": 0, "max": 1}},
           "keep": False, "where": ""}

    def respond(statement):
        raise RuntimeError("[INSUFFICIENT_PERMISSIONS] User does not have SELECT on table main.inspire.n02_u05_out")

    inst = _inspire(agent_ns, FakeSpark(responder=respond))
    inst._implement_vibes_llm, calls = _llm([ask], [_verdict("done", DONE_QUOTE)])
    item = {"asset": agent_ns["IMPLEMENT_NOTEBOOK"], "text": ask["ask"], "artifact": CLEAN, "result_table": "main.inspire.n02_u05_out"}
    found = inst._implement_vibes_round({}, [item], "N02-U05 notebook round 1/3")
    [check] = found["checks"][agent_ns["IMPLEMENT_NOTEBOOK"]]
    assert check["status"] == "missing" and check["evidence"].startswith(agent_ns["IMPLEMENT_VIBES_UNCHECKED"]), check
    assert "INSUFFICIENT_PERMISSIONS" in check["evidence"] and found["resend"] == {}


def _broken_shell():
    raise RuntimeError("the App shell assets could not be read")


def _app_items(agent_ns, inst, artifact, before, shell=_broken_shell):
    inst._implement_app_shell = shell
    context = {"uc_id": "N02-U01", "key": (5150, "N02-U01", 2), "spec": {"outputs": {"app": True, "app_vibes": VIBE}},
               "asset_status": {"app": {"state": "ready", "spec_version": 1}}, "previous_artifacts": {"app": before}}
    return inst._implement_output_vibe_items(context, "app", {"app": VIBE}, artifact, [])


def test_keep_the_rest_is_could_not_check_when_the_app_shell_could_not_load(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_vibes_llm, calls = _llm(SPLIT, [{"checks": [
        {"n": n, "status": "done", "evidence": "Expected faults by component type", "where": "expected_faults_by_component"}
        for n in (1, 2, 3)]}])
    items = _app_items(agent_ns, inst, dict(_copy(V5), **GENIE), dict(_copy(V4), **GENIE))
    found = inst._implement_vibes_round({}, items, "N02-U01 App round 1/3")
    checks = {c["ask"]: c for c in found["checks"]["app"]}
    assert checks[KEEP]["status"] == "missing" and checks[KEEP]["evidence"].startswith(agent_ns["IMPLEMENT_VIBES_UNCHECKED"])
    assert "the App shell assets could not be read" in checks[KEEP]["evidence"]
    assert found["resend"].get("app") is None or KEEP not in [c["ask"] for c in found["resend"]["app"]]


def test_a_column_filter_ask_is_could_not_check_when_the_app_shell_could_not_load(agent_ns):
    ask = {"ask": "Let me filter the queue table by district", "check": {"kind": "column_filter", "value": "district"}, "keep": False,
           "where": "the Monthly inspection priority queue"}
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_vibes_llm, calls = _llm([ask], [_verdict("done", "District")])
    items = _app_items(agent_ns, inst, dict(_copy(V5), **GENIE), dict(_copy(V4), **GENIE))
    found = inst._implement_vibes_round({}, items, "N02-U01 App round 1/3")
    [check] = found["checks"]["app"]
    assert check["status"] == "missing" and check["evidence"].startswith(agent_ns["IMPLEMENT_VIBES_UNCHECKED"]), check
    assert "the App shell assets could not be read" in check["evidence"]


def test_keep_the_rest_is_still_settled_by_the_shell_when_it_loads(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_vibes_llm, calls = _llm(SPLIT, [{"checks": [
        {"n": n, "status": "done", "evidence": "Expected faults by component type", "where": "expected_faults_by_component"}
        for n in (1, 2)]}])
    items = _app_items(agent_ns, inst, dict(_copy(V5), **GENIE), dict(_copy(V4), **GENIE), shell=lambda: (None, {"shell_sql": _shell()}))
    found = inst._implement_vibes_round({}, items, "N02-U01 App round 1/3")
    checks = {c["ask"]: c for c in found["checks"]["app"]}
    assert checks[KEEP]["status"] == "done"
