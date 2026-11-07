from v120_artifacts_support import FakeSpark
from v140_implement_test import _inspire
from v203_vibe_judge_data_test import ASK, CLEAN, REASON, SOURCES, USE_CASE, VALID, _held

LACKING = "Add a KPI tile of each supplier's ESG score"


def _judge_llm(asks, failures, verdicts):
    calls = []

    def llm(kind, prompt, schema):
        calls.append((kind, prompt))
        if kind == "split":
            return {"asks": [{"ask": a, "check": None, "keep": False, "where": ""} for a in asks]}
        if sum(1 for k, _p in calls if k == "judge") <= failures:
            raise RuntimeError("endpoint timed out")
        return {"checks": [dict({"n": n}, **v) for n, v in enumerate(verdicts, 1)]}

    return llm, calls


def _hold(agent_ns, asks, failures, verdicts=()):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_vibes_llm, calls = _judge_llm(asks, failures, list(verdicts))
    inst._implement_vibes_sources = lambda spec, use_case: SOURCES
    held = inst._implement_vibes_hold("N02-U05", dict(USE_CASE), {"data": {"notes": " ".join(asks)}, "outputs": {}}, {})
    return held, [p for k, p in calls if k == "judge"]


def test_a_judge_that_fails_once_is_asked_again_with_the_same_prompt_and_its_verdict_holds(agent_ns):
    held, judged = _hold(agent_ns, [ASK, VALID], 1, [{"status": "no_data", "evidence": REASON, "where": ""}])
    assert len(judged) == 2 and judged[0] == judged[1]
    assert held == {agent_ns["IMPLEMENT_NOTEBOOK"]: {ASK: agent_ns["IMPLEMENT_VIBES_NO_DATA"] + REASON}}


def test_a_judge_that_fails_twice_holds_nothing_so_genie_builds_every_ask(agent_ns):
    held, judged = _hold(agent_ns, [ASK, LACKING, VALID], 2)
    assert len(judged) == 2 and held == {}, "a hold needs the check to say the data is missing, and a failed check says nothing"
    text = agent_ns["implement_choices_markdown"]({"data": {"notes": ASK}, "config": {}, "outputs": {}}, held=held)
    assert ASK in text and "Never build them" not in text


def test_an_ask_whose_words_the_source_holds_is_never_held_when_the_judge_fails(agent_ns):
    held, judged = _hold(agent_ns, [VALID], 2)
    assert held == {} and judged == []


def test_a_held_unchecked_ask_shows_as_could_not_be_checked_and_is_never_resent(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_vibes_llm, calls = _judge_llm([ASK], 0, [])
    unchecked = f"{agent_ns['IMPLEMENT_VIBES_UNCHECKED']} against the source data before the build"
    item = {"asset": agent_ns["IMPLEMENT_NOTEBOOK"], "text": ASK, "artifact": CLEAN, "sources": SOURCES,
            "held_terms": _held(agent_ns), "held_asks": {ASK: unchecked}}
    found = inst._implement_vibes_round({}, [item], "N02-U05 notebook round 1/3")
    [check] = found["checks"][agent_ns["IMPLEMENT_NOTEBOOK"]]
    assert (check["status"], check["evidence"]) == ("missing", unchecked)
    assert found["resend"] == {} and "judge" not in [k for k, _p in calls]
    shown = agent_ns["implement_checklist_texts"](unchecked, True)
    assert shown["evidence"].startswith(unchecked) and shown["evidence"].endswith(agent_ns["implement_check_again"](1))


def _round(agent_ns, failures, verdicts=()):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_vibes_llm, calls = _judge_llm([VALID], failures, list(verdicts))
    item = {"asset": agent_ns["IMPLEMENT_NOTEBOOK"], "text": VALID, "artifact": CLEAN, "sources": SOURCES,
            "held_terms": _held(agent_ns)}
    found = inst._implement_vibes_round({}, [item], "N02-U05 notebook round 1/3")
    return found["checks"][agent_ns["IMPLEMENT_NOTEBOOK"]], [k for k, _p in calls if k == "judge"]


def test_the_check_after_a_build_asks_a_failed_judge_once_more(agent_ns):
    checks, judged = _round(agent_ns, 1, [{"status": "missing", "evidence": "the notebook shows no chart by nation", "where": ""}])
    assert judged == ["judge", "judge"]
    assert [(c["status"], c["evidence"]) for c in checks] == [("missing", "the notebook shows no chart by nation")]


def test_the_check_after_a_build_never_passes_an_ask_when_the_judge_fails_twice(agent_ns):
    checks, judged = _round(agent_ns, 2)
    assert judged == ["judge", "judge"]
    [check] = checks
    assert check["status"] == "missing" and check["evidence"].startswith(agent_ns["IMPLEMENT_VIBES_UNCHECKED"])


def test_a_no_data_ask_offers_the_user_a_source_table_or_taking_the_ask_out(agent_ns):
    reason = agent_ns["IMPLEMENT_VIBES_NO_DATA"] + REASON
    shown = agent_ns["implement_checklist_texts"](reason)
    choices = agent_ns["IMPLEMENT_NO_DATA_CHOICES"]
    assert shown["evidence"] == f"{reason}: {choices}"
    assert shown["fact"] == reason
    assert agent_ns["implement_checklist_texts"](shown["evidence"])["evidence"] == shown["evidence"]
    other = agent_ns["implement_checklist_texts"]("the notebook shows no chart by nation")
    assert choices not in other["evidence"]
    assert "add a source table" in choices and "take the ask out" in choices and "\u2014" not in choices
