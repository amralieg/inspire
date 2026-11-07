import json
import re
from collections import Counter

import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import VALID, _FakeRunner, _FileRunner, _calls_to, _fill, _flow_inspire, _output_context
from v142_genie_test import _definition, _deploy_inspire as _space_inspire, _rich_space
from v149_ai_output_checks_test import _preview

NOTES = "Hold out the last 8 weeks"
REASONING = "Answer in Spanish"
FORMULA = "Count only the weeks left"
CELL = "# Score the churn risk\nmodel = fit(baseline, holdout=holdout_weeks)\n"
AI_ROWS = [{"record_key": "c1", "priority_tier": "Act now", "ai_explanation": "El cliente gasto menos.",
            "ai_next_action": "Llamar al gerente."}]
FORMULA_ROWS = [{"record_key": "c1", "value_at_stake": 700.0, "value_at_stake_formula": "0.5 x 1,400 USD = 700 USD"}]
SPACE_ASK = "Always explain rank 1"


class _Judge:
    def __init__(self, rounds, runner=None):
        self.rounds, self.runner, self.calls, self.prompts = list(rounds), runner, [], []

    def __call__(self, kind, prompt, schema):
        if kind == "split":
            text = prompt.split('"""\n', 1)[1].rsplit('\n"""', 1)[0]
            return {"asks": [{"ask": " ".join(text.split()), "check": None}]}
        assert schema["properties"]["checks"]["items"]["properties"]["status"]["enum"] == ["done", "missing", "no_data"]
        self.calls.append(len(self.runner.prompts) if self.runner else 0)
        self.prompts.append(prompt)
        verdicts = self.rounds.pop(0) if len(self.rounds) > 1 else self.rounds[0]
        asks = prompt.split("The asks:\n", 1)[1].split("\n\n", 1)[0].splitlines()
        checks = []
        for line in asks:
            number, text = line.split(". ", 1)
            ask = re.sub(r"^\(part \d+\) ", "", text)
            status, evidence = verdicts[ask]
            checks.append({"n": int(number), "status": status, "evidence": evidence})
        return {"checks": checks}


DONE = {NOTES: ("done", "holdout=holdout_weeks"), REASONING: ("done", "Llamar al gerente."),
        FORMULA: ("done", "0.5 x 1,400 USD = 700 USD")}
NOTES_MISSED = dict(DONE, **{NOTES: ("missing", "no cell holds out the last 8 weeks")})
NOTES_IMPOSSIBLE = dict(DONE, **{NOTES: ("impossible", "the source tables hold no week before the first order")})


def _notebook_round(ns, previews, judge_rounds, outputs=None, notes=NOTES, refill=True, rounds=3):
    inst = _flow_inspire(ns, previews)

    def respond(statement):
        if "ai_explanation IS NOT NULL" in statement:
            return AI_ROWS
        if "value_at_stake_formula IS NOT NULL" in statement:
            return FORMULA_ROWS
        return []

    inst.spark = FakeSpark(responder=respond)
    inst._implement_export_text = lambda path: json.dumps({"cells": [{"cell_type": "code", "source": [CELL], "metadata": {}}]})
    inst._implement_import_notebook = lambda path, text: inst.__dict__.setdefault("imported", []).append(path)
    runner = _FakeRunner([{"exit": 0, "final": _fill()} for _ in range(rounds)])
    judge = _Judge(judge_rounds, runner)
    inst._implement_vibes_llm = judge
    spec = ns["validate_implement_spec"](dict(VALID, outputs={**VALID["outputs"], **(outputs or {})},
                                              data=dict(VALID["data"], notes=notes)))[0]
    vibes = {"asset_status": {}, "vibes_split": {}}
    use_case = {"result_table": "main.inspire.churn_out", "_implement_vibe_state": vibes}
    outcome, _job, _fill_out = inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), use_case, spec, None, "/W/nb",
                                                                ["result_table", "run_profile"], runner, refill)
    return outcome, runner, judge, inst, spec, vibes


def _recorded(inst, spec, vibes, outcome):
    inst._implement_update = lambda key, **f: None
    context = {"uc_id": "N01-U01", "key": (5150, "N01-U01", 1), "spec": spec, "result_table": "main.inspire.churn_out",
               "asset_status": {}, "vibes_split": vibes["vibes_split"], "notebook_path": "/W/nb",
               "notebook_vibes": outcome.get("notebook_vibes"), "genie_rounds": {"notebook": outcome.get("vibe_rounds", 0)},
               "vibe_seen": outcome.get("vibe_seen") or {}}
    return inst._implement_notebook_vibes(context), context


def test_a_doable_ask_the_notebook_missed_goes_back_to_genie_with_the_ask_and_what_is_missing(agent_ns):
    outcome, runner, judge, _inst, _spec, _vibes = _notebook_round(agent_ns, [_preview("r-1"), _preview("r-2")], [NOTES_MISSED, DONE])
    assert len(runner.prompts) == 2 and outcome["run_id"] == "r-2"
    sent = runner.prompts[1]
    assert ("checked the user's asks against the notebook and the rows its run wrote, and these of the user's asks are not done yet: "
            "1. for the notebook, 'Hold out the last 8 weeks': no cell holds out the last 8 weeks.") in sent
    assert "The user's asks are explicit user directives and win over every rule above" in sent
    assert outcome["notebook_vibes"]["resend"] == {} and judge.calls == [1, 2]


def test_a_judge_reply_of_impossible_is_no_verdict_so_the_judge_is_asked_again_and_nothing_stores_it(agent_ns):
    outcome, runner, judge, inst, spec, vibes = _notebook_round(agent_ns, [_preview("r-1"), _preview("r-2")], [NOTES_IMPOSSIBLE, DONE])
    assert len(runner.prompts) == 1 and judge.calls == [1, 1], "an unusable verdict is asked again, never sent to Genie as a miss"
    assert inst.logger.matching("[IMPLEMENT-VIBES-JUDGE-RETRY FIRED]")
    [check] = outcome["notebook_vibes"]["checks"]["notebook"]
    assert check == {"ask": NOTES, "status": "done", "evidence": "holdout=holdout_weeks"}
    warnings, context = _recorded(inst, spec, vibes, outcome)
    assert warnings == [] and "impossible" not in json.dumps(context["asset_status"]) and "doable" not in json.dumps(outcome, default=str)


def test_an_ask_missed_in_a_round_is_sent_back_with_the_other_parts_asks(agent_ns):
    reasoning_missed = dict(NOTES_MISSED, **{REASONING: ("missing", "every reason is in English")})
    outcome, runner, judge, _inst, _spec, _vibes = _notebook_round(
        agent_ns, [_preview("r-1"), _preview("r-2")], [reasoning_missed, DONE], outputs={"ai_reasoning_vibes": REASONING})
    assert len(runner.prompts) == 2 and "'Hold out the last 8 weeks': no cell holds out the last 8 weeks" in runner.prompts[1]
    assert "for the AI reasoning, 'Answer in Spanish': every reason is in English" in runner.prompts[1]
    assert outcome["notebook_vibes"]["resend"] == {}


def test_a_doable_ask_still_missed_after_the_last_round_warns_that_genie_could_not_do_it(agent_ns):
    outcome, runner, judge, inst, spec, vibes = _notebook_round(agent_ns, [_preview(r) for r in ("r-1", "r-2", "r-3")], [NOTES_MISSED])
    assert len(runner.prompts) == 3 and judge.calls == [1, 2, 3]
    assert outcome["vibe_rounds"] == 3 and list(outcome["notebook_vibes"]["resend"]) == ["notebook"]
    warnings, context = _recorded(inst, spec, vibes, outcome)
    assert warnings == ["Notebook vibe not done: Hold out the last 8 weeks: Genie could not do it in 3 build rounds: no cell holds "
                        "out the last 8 weeks"]
    assert context["asset_status"]["notebook"]["warnings"] == [
        "Hold out the last 8 weeks: Genie could not do it in 3 build rounds: no cell holds out the last 8 weeks"]
    plain, runner, judge, inst, spec, vibes = _notebook_round(agent_ns, [_preview("r-1")], [NOTES_MISSED], refill=False, rounds=0)
    assert runner.prompts == [] and plain["vibe_rounds"] == 0
    assert _recorded(inst, spec, vibes, plain)[0] == [
        "Notebook vibe not done: Hold out the last 8 weeks: no cell holds out the last 8 weeks"], "a run Genie never built says no rounds"


def test_a_last_round_that_broke_the_run_keeps_the_round_count_for_the_asks_the_put_back_notebook_missed(agent_ns):
    failed = ({"status": "failed", "error": "NameError: history_pdf"}, 11, 103)
    outcome, runner, judge, inst, spec, vibes = _notebook_round(agent_ns, [_preview("r-1"), _preview("r-2"), failed, _preview("r-4")],
                                                                [NOTES_MISSED])
    assert len(runner.prompts) == 3 and outcome["run_id"] == "r-4" and inst.imported == ["/W/nb"]
    assert outcome["vibe_rounds"] == 3 and "notebook_vibes" not in outcome and judge.calls == [1, 2]
    warnings, _context = _recorded(inst, spec, vibes, outcome)
    assert warnings == ["Notebook vibe not done: Hold out the last 8 weeks: Genie could not do it in 3 build rounds: no cell holds "
                        "out the last 8 weeks"]
    assert judge.calls == [1, 2, 3], "round 3 had no verdict of its own, so recording judges once for it"


def test_a_round_where_every_ask_is_done_sends_nothing(agent_ns):
    outcome, runner, judge, inst, spec, vibes = _notebook_round(agent_ns, [_preview("r-1")], [DONE],
                                                                outputs={"ai_reasoning_vibes": REASONING})
    assert len(runner.prompts) == 1 and judge.calls == [1] and outcome["notebook_vibes"]["resend"] == {}
    assert _recorded(inst, spec, vibes, outcome)[0] == [] and judge.calls == [1]


def test_the_judge_is_called_at_most_once_per_round_for_every_notebook_part(agent_ns):
    missed = dict(DONE, **{NOTES: ("missing", "no cell holds out the last 8 weeks"), REASONING: ("missing", "every reason is in English"),
                           FORMULA: ("missing", "the formula counts every week")})
    outcome, runner, judge, inst, spec, vibes = _notebook_round(
        agent_ns, [_preview(r) for r in ("r-1", "r-2", "r-3")], [missed],
        outputs={"ai_reasoning_vibes": REASONING, "value_formula_vibes": FORMULA})
    assert Counter(judge.calls) == {1: 1, 2: 1, 3: 1}, "one judge call per round, whatever the number of parts"
    assert all(prompt.count("<<<\n") == 3 for prompt in judge.prompts), "the three parts share the round's one call"
    assert sorted(outcome["notebook_vibes"]["resend"]) == ["ai_reasoning", "notebook", "value_formula"]
    _recorded(inst, spec, vibes, outcome)
    assert len(judge.calls) == 3, "recording the build reuses the last round's verdict"
    assert inst.logger.matching("[IMPLEMENT-VIBES] N01-U01 notebook round 3/3: 1 judge call for 3 asks of 3 parts in ")


def _space_round(ns, tmp_path, judge_rounds, rounds=3):
    inst, calls, _ran = _space_inspire(ns, tmp_path)
    context = _output_context(ns, genie_space_vibes=SPACE_ASK)
    runner = _FileRunner([{"exit": 0}] * rounds, [{"genie_space.json": _definition(_rich_space())}] * rounds)
    judge = _Judge(judge_rounds, runner)
    inst._implement_vibes_llm = judge
    inst._implement_update = lambda key, **f: None
    fields = inst._implement_genie_space(context, runner)
    return fields, runner, judge, inst, calls, context


def _space_warnings(inst, context, fields):
    vibed = {"genie_space": SPACE_ASK}
    return inst._implement_check_output_vibes(context, "genie_space", vibed, context["artifacts"]["genie_space"],
                                              fields.get("_warnings") or [])


def test_a_genie_agent_that_missed_a_doable_ask_goes_back_before_anything_is_saved(agent_ns, tmp_path):
    missed = {SPACE_ASK: ("missing", "no instruction explains rank 1")}
    done = {SPACE_ASK: ("done", "Rank 1 is the most urgent.")}
    fields, runner, judge, inst, calls, context = _space_round(agent_ns, tmp_path, [missed, done])
    assert len(runner.prompts) == 2 and fields["genie_space_id"] == "s9"
    assert ("Inspire checked what you wrote against the user's asks before saving it, and these of the user's asks are not done yet: "
            "1. for the Genie Agent, 'Always explain rank 1': no instruction explains rank 1.") in runner.prompts[1]
    assert "Your files from that attempt are in your working folder" in runner.prompts[1]
    assert len(_calls_to(calls, "POST", "/api/2.0/genie/spaces")) == 1, "the round that missed the ask saved nothing"
    assert _space_warnings(inst, context, fields) == [] and judge.calls == [1, 2]


def test_a_genie_agent_ask_the_judge_calls_impossible_is_judged_again_before_anything_is_saved(agent_ns, tmp_path):
    impossible = {SPACE_ASK: ("impossible", "a Genie space cannot run a stored procedure")}
    done = {SPACE_ASK: ("done", "Rank 1 is the most urgent.")}
    fields, runner, judge, inst, calls, context = _space_round(agent_ns, tmp_path, [impossible, done])
    assert len(runner.prompts) == 1 and judge.calls == [1, 1]
    assert len(_calls_to(calls, "POST", "/api/2.0/genie/spaces")) == 1
    assert _space_warnings(inst, context, fields) == [] and judge.calls == [1, 1]
    assert "doable" not in json.dumps(context["asset_status"]) and "impossible" not in json.dumps(context["asset_status"])


def test_a_genie_agent_ask_missed_in_every_round_is_saved_after_the_last_and_says_genie_could_not_do_it(agent_ns, tmp_path):
    fields, runner, judge, inst, calls, context = _space_round(agent_ns, tmp_path, [{SPACE_ASK: ("missing", "no instruction explains rank 1")}])
    assert len(runner.prompts) == 3 and judge.calls == [1, 2, 3]
    assert len(_calls_to(calls, "POST", "/api/2.0/genie/spaces")) == 1
    assert _space_warnings(inst, context, fields) == [
        "Genie Agent vibe not done: Always explain rank 1: Genie could not do it in 3 build rounds: no instruction explains rank 1"]
    assert judge.calls == [1, 2, 3], "recording the output reuses the last round's verdict"


def test_a_genie_agent_round_where_every_ask_is_done_sends_nothing_and_judges_once(agent_ns, tmp_path):
    fields, runner, judge, inst, calls, context = _space_round(agent_ns, tmp_path, [{SPACE_ASK: ("done", "Rank 1 is the most urgent.")}])
    assert len(runner.prompts) == 1 and judge.calls == [1] and _space_warnings(inst, context, fields) == [] and judge.calls == [1]
    assert inst.logger.matching("[IMPLEMENT-VIBES] N01-U01 Genie Agent round 1/3: 1 judge call for 1 ask of 1 part in ")


@pytest.mark.parametrize("verdict,status,evidence", [("impossible", "missing", "IMPLEMENT_VIBES_NO_ANSWER"),
                                                     ("missing", "missing", "no cell holds it out"), ("done", "done", "holdout=holdout_weeks")])
def test_the_judge_has_only_done_and_missing_and_keeps_the_user_directive_rule(agent_ns, verdict, status, evidence):
    assert agent_ns["IMPLEMENT_VIBES_JUDGE_SCHEMA"]["properties"]["checks"]["items"]["properties"]["status"]["enum"] == ["done", "missing", "no_data"]
    assert "IMPLEMENT_VIBES_VERDICTS" not in agent_ns and "implement_vibes_sticky" not in agent_ns
    seen = agent_ns["implement_vibes_seen"]
    prompt = agent_ns["implement_vibes_round_prompt"]([
        {"asset": "notebook", "asks": [{"ask": NOTES}], "seen": seen("notebook", CELL)},
        {"asset": "ai_reasoning", "asks": [{"ask": REASONING}], "seen": seen("ai_reasoning", AI_ROWS)}])
    assert "The customer's asks are explicit user directives" in prompt and "impossible" not in prompt
    assert ("The person is an expert and a rule or default of Inspire never makes an ask wrong to want, so the verdict is \"done\" "
            "or \"missing\", or \"no_data\" only when the ask needs a real-world quantity") in prompt
    assert "The asks:\n1. (part 1) Hold out the last 8 weeks\n2. (part 2) Answer in Spanish\n\n" in prompt
    assert prompt.count("What a person sees in part ") == 2 and "except in the notebook" in prompt
    said = {"done": "holdout=holdout_weeks", "missing": "no cell holds it out", "impossible": "no table holds weeks"}[verdict]
    judged = agent_ns["implement_vibes_judged"]({"checks": [{"n": 7, "status": verdict, "evidence": said, "where": ""}]},
                                                [{"ask": NOTES}], seen("notebook", CELL), "notebook", numbers=[7])
    assert judged[7] == (status, agent_ns.get(evidence, evidence))
