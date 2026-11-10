import json

import pytest

from v140_implement_test import VALID, _FileRunner, _NB_SPEC, _alert_inspire, _left_by, _output_context
from v143_vibes_test import ALL, GOOD, _raising, _run, _verdicts

ASK = "Put the top 10 first"
EVIDENCE = "the chart sorts by name"
BLOCKED = {"key": "charts:churn", "label": "Churn chart", "what": "removed the Churn chart", "reason": "an ask reads its dataset",
           "was": {"id": "churn"}}
TRIED = ["round 1: the chart sorts by name", "round 2: the chart sorts by name"]
MAP_ASK = "Add a map of the regions"


def _ask_entry(rounds, tried):
    return {"n": 1, "requirement": ASK, "part": "dashboard", "where": "", "status": "not_met", "evidence": EVIDENCE,
            "rounds": rounds, "tried": list(TRIED) if tried else [], "checks": [], "published_anyway": None}


def _unrequested_entry(agent_ns, rounds, tried):
    [entry] = agent_ns["implement_untargeted_entries"]({"dashboard": {"version": 2, "restored": [], "blocked": [BLOCKED],
                                                                      "rounds": rounds}}, 3)
    return dict(entry, n=1, tried=list(TRIED) if tried else [])


def _count_words(rounds):
    return "1 build round" if rounds == 1 else f"{rounds} build rounds"


@pytest.mark.parametrize("tried", [True, False], ids=["tried_set", "tried_not_set"])
@pytest.mark.parametrize("rounds", [0, 1, 3])
@pytest.mark.parametrize("kind", ["vibe_ask", "unrequested_change"])
def test_the_unmet_sentence_states_the_round_count_once_in_one_sentence_with_a_real_plural(agent_ns, kind, rounds, tried):
    entry = _ask_entry(rounds, tried) if kind == "vibe_ask" else _unrequested_entry(agent_ns, rounds, tried)
    assert "round" not in entry["evidence"].lower(), "the entry's evidence never carries the round count; its rounds field does"
    reason = agent_ns["implement_unmet_published_text"]([entry], 3)
    assert reason.startswith("v3 is published with 1 unmet ask (not met or could not be checked), the rest of the vibe is in place: Dashboard"
                             + (": " if kind == "vibe_ask" else " (the Churn chart): "))
    assert "(s)" not in reason and "not even after" not in reason and "after the last Genie round" not in reason
    assert "Try again" not in reason and "Publish anyway" not in reason and "Rephrase" not in reason
    assert not any(line in reason for line in TRIED), "what Genie tried per round is the checklist's list, never the reason"
    if rounds:
        sentence = f"Genie could not do it in {_count_words(rounds)}: {entry['evidence']}"
        assert sentence in reason and reason.lower().count("round") == 1
    else:
        assert "round" not in reason.lower() and f"{entry['requirement']}: {entry['evidence']}" in reason


def test_a_sentence_for_several_asks_uses_plurals_and_states_each_count_once(agent_ns):
    one, three = _ask_entry(1, True), dict(_ask_entry(3, False), n=2, requirement="Show the region", part="app")
    unchecked = dict(_ask_entry(3, False), n=3, requirement="Name the owner", unchecked=True,
                     evidence=f"{agent_ns['IMPLEMENT_VIBES_UNCHECKED']}: the judge did not answer")
    text = agent_ns["implement_unmet_published_text"]
    both = text([one, three], 4)
    assert both.startswith("v4 is published with 2 unmet asks (not met or could not be checked), the rest of the vibe is in place: ")
    assert both.count("Genie could not do it in 1 build round: ") == 1 and both.count("Genie could not do it in 3 build rounds: ") == 1
    assert both.lower().count("round") == 2
    assert text([unchecked], 4).startswith("v4 is published with 1 unmet ask (not met or could not be checked)")


@pytest.mark.parametrize("rounds,words", [(0, ""), (1, "Genie could not do it in 1 build round: "),
                                          (3, "Genie could not do it in 3 build rounds: ")])
def test_vibe_warnings_state_the_rounds_the_part_ran_once_whether_or_not_the_ask_went_back_to_genie(agent_ns, rounds, words):
    unchecked = f"{agent_ns['IMPLEMENT_VIBES_UNCHECKED']}: the judge did not answer"
    checks = [{"ask": ASK, "status": "missing", "evidence": EVIDENCE}, {"ask": "Name the owner", "status": "missing", "evidence": unchecked},
              {"ask": "Show the region", "status": "done", "evidence": "it shows the region"}]
    assert agent_ns["implement_vibes_warnings"]("dashboard", checks, rounds) == [
        f"Dashboard vibe not done: {ASK}: {words}{EVIDENCE}", f"Dashboard vibe not done: Name the owner: {unchecked}"]


def test_the_notebook_gate_text_shares_the_one_rounds_sentence(agent_ns):
    unfixed = agent_ns["implement_unfixed_text"]
    assert unfixed("x", 1) == "Genie could not fix this in 1 build round: x"
    assert unfixed("x", 3) == "Genie could not fix this in 3 build rounds: x"
    assert unfixed("x", 0) == "x; build the notebook again with Vibe/Add/Remove Features on the Build page"


@pytest.mark.parametrize("rounds,words", [(1, "1 Genie round"), (3, "3 Genie rounds")])
def test_rounds_that_ran_out_say_their_count_once_and_the_ask_evidence_keeps_only_the_reason(agent_ns, rounds, words):
    exhausted = agent_ns["ImplementGenieExhausted"]("Alert", rounds, "boom")
    assert str(exhausted) == f"the Alert still failed after {words}: boom"
    reason = agent_ns["implement_unbuilt_reason"]
    assert reason(exhausted) == "boom"
    try:
        raise RuntimeError(f"Inspire tried 2 times and could not build it: {exhausted}") from exhausted
    except RuntimeError as wrapped:
        assert reason(wrapped) == "boom", "the reason under an attempts message is the last Genie round's"
    assert reason(RuntimeError("the warehouse is stopped")) == "the warehouse is stopped"


@pytest.mark.parametrize("n,words", [(0, "0 asks"), (1, "1 ask"), (2, "2 asks"), (1.0, "1 ask"), (1.5, "1.5 asks"), (1234, "1,234 asks")])
def test_the_plural_helper_writes_the_count_and_the_noun_that_fits_it(agent_ns, n, words):
    assert agent_ns["inspire_plural"](n, "ask") == words
    assert agent_ns["inspire_plural"](1, "batch", "batches") == "1 batch" and agent_ns["inspire_plural"](2, "batch", "batches") == "2 batches"


def test_an_alert_genie_could_not_build_holds_with_each_round_count_said_once(agent_ns, tmp_path):
    inst, _calls, _queries = _alert_inspire(agent_ns, tmp_path, rows=[{"triggered": True}])
    previous = dict(VALID, outputs={**ALL, "genie_space": False, "app": False})
    inst._implement_previous = lambda target: {"spec_version": 2, "spec_json": previous}
    inst._implement_carried = lambda target: ({"notebook_path": "/W/nb", "job_id": 77, "result_rows": 40, "dashboard_id": "d1",
                                               "alert_id": "al-1"}, _left_by(2, {"alert": {"state": "ready", "spec_version": 2,
                                                                                           "condition_text": "", "condition_sql": ""}}))
    inst._implement_use_case_row = lambda sid, uc: {"No": "N01-U01", "Name": "Predict churn", "genie_instruction": "Build"}
    inst._row_to_uc = lambda row: dict(row)
    inst._genie_notebook_spec = lambda uc: dict(_NB_SPEC, **_output_context(agent_ns)["notebook_spec"])
    inst._genie_widget_names = lambda instruction, spec: ["result_table"]
    inst._genie_involved_tables = lambda uc: ["main.s.orders"]
    inst._implement_share = lambda *args, **kwargs: []
    inst._implement_repair = lambda *args, **kwargs: {"kind": "stop"}
    inst._implement_run_query_check = _raising("the warehouse is stopped")
    runner = _FileRunner([{"exit": 0}] * 3, [{"alert_condition.sql": GOOD.replace("main.s.orders", "main.s.orders_v2")}] * 3)
    inst._implement_runner = lambda uc: runner
    inst._implement_dashboard = lambda context, runner: pytest.fail("only the alert's vibes changed")
    _verdicts(inst, [MAP_ASK], status="missing", evidence="no table holds a location")
    status = _run(inst, dict(previous, outputs={**previous["outputs"], "alert_vibes": MAP_ASK}))
    assert status == "ready_with_warnings" and len(runner.prompts) == 3
    final = inst.updates[-1]
    [entry] = final["asset_status"]["checklist"]
    assert entry["status"] == "not_met" and entry["rounds"] == 3 and "round" not in entry["evidence"].lower()
    message = final["status_message"]
    sentence = ("v3 is published with 1 unmet ask (not met or could not be checked), the rest of the vibe is in place: Alert: Add a map of the regions: "
                "Genie could not do it in 3 build rounds: the Alert was not built: the warehouse is stopped.")
    assert message.count(sentence[:60]) == 1 and message.lower().count("build round") == 1, message
    assert json.dumps(final["asset_status"]["alert"]).count("3 Genie rounds") == 1, "the alert's own error states its rounds once"
