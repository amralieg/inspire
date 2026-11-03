import pytest

from v143_vibes_test import _locked, _run
from v163_hold_gate_test import _asked, _dashboard

ACTIONS = ("Try again", "Publish anyway", "Rephrase", "send the vibe again", "Vibe/Add/Remove Features")
ASKS = ["Put the top 10 first", "Show the region", "Name the owner"]


def _counts(text):
    return {action: str(text).count(action) for action in ACTIONS}


def _once(text):
    assert all(n <= 1 for n in _counts(text).values()), (_counts(text), text)


def _unchecked(agent_ns, n):
    evidence = agent_ns["implement_checklist_unchecked"](f"{agent_ns['IMPLEMENT_VIBES_UNCHECKED']}: the judge did not answer")
    return [{"n": i + 1, "requirement": ASKS[i], "part": "dashboard", "where": "", "status": "not_met", "evidence": evidence,
             "rounds": 0, "tried": [], "checks": [], "published_anyway": None, "unchecked": True} for i in range(n)]


def _missed(n):
    return [{"n": i + 1, "requirement": ASKS[i], "part": "dashboard", "where": "", "status": "not_met", "evidence": "the chart sorts by name",
             "rounds": 3, "tried": [], "checks": [], "published_anyway": None} for i in range(n)]


@pytest.mark.parametrize("n", [1, 2, 3])
@pytest.mark.parametrize("kind", ["unchecked", "missed", "mixed"])
def test_the_held_reason_names_each_action_once_at_one_two_and_three_entries(agent_ns, kind, n):
    entries = (_unchecked(agent_ns, n) if kind == "unchecked" else _missed(n) if kind == "missed" else
               _unchecked(agent_ns, 1) + [dict(e, n=e["n"] + 1) for e in _missed(n)])
    reason = agent_ns["implement_held_reason"](entries, 3, 2)
    _once(reason)
    assert reason.count("Publish anyway") == 1
    assert reason.count("Try again") == 1 and reason.count("Rephrase") == (0 if kind == "unchecked" else 1)
    assert reason.count("Nothing shows the ask was missed") == (n if kind == "unchecked" else 1 if kind == "mixed" else 0), \
        "each entry keeps its fact; only the action moves to the composer"


@pytest.mark.parametrize("n", [1, 2, 3])
def test_a_status_message_joins_warnings_and_names_each_action_once(agent_ns, n):
    unfixed = agent_ns["implement_unfixed_text"]
    warnings = [f"Notebook: {unfixed(f'problem {i}', 0)}" for i in range(n)] + [f"AI reasoning: {unfixed('the summary is empty', 0)}"]
    unchecked = _unchecked(agent_ns, 1)[0]["evidence"]
    message = agent_ns["implement_compose"](warnings + [f"Dashboard: {unchecked}"] * n)
    _once(message)
    assert message.count("Vibe/Add/Remove Features") == 1 and message.count("Try again") == 1
    assert all(f"problem {i}" in message for i in range(n)) and "the summary is empty" in message


@pytest.mark.parametrize("n", [1, 2, 3])
def test_the_not_decided_text_names_its_action_once(agent_ns, n):
    reason = "the vibe router failed 3 times, the last with: timed out"
    entries = agent_ns["implement_not_decided_entries"](ASKS[:n], reason, 3)
    composed = agent_ns["implement_compose"]([agent_ns["implement_not_decided_text"](reason, 3)] + [e["evidence"] for e in entries])
    _once(composed)
    _once(agent_ns["implement_not_decided_text"](reason, 3))


def test_a_single_standalone_entry_still_carries_its_action(agent_ns):
    [entry] = _unchecked(agent_ns, 1)
    assert entry["evidence"].endswith(": press Try again to check it again"), "a checklist row shown alone says what to do"
    assert agent_ns["implement_unfixed_text"]("x", 0) == "x; build the notebook again with Vibe/Add/Remove Features on the Build page"
    assert agent_ns["implement_not_decided_text"]("the router failed", 3).endswith("send the vibe again from the vibe box on the Build page")
    assert agent_ns["implement_held_reason"]([entry], 3, 2).count("Try again") == 1
    assert agent_ns["implement_compose"](["Notebook: x; build the notebook again with Vibe/Add/Remove Features on the Build page"]) == \
        "Notebook: x; build the notebook again with Vibe/Add/Remove Features on the Build page"
    assert agent_ns["implement_compose"](["Plain fact"]) == "Plain fact"


def held_unchecked_run(agent_ns, asks):
    inst, previous = _locked(agent_ns)
    inst._implement_runner = lambda uc: "genie"
    inst._implement_dashboard = _dashboard(inst, [])

    def busy(kind, prompt, schema):
        if kind == "split":
            return {"asks": [{"ask": ask, "check": None} for ask in asks]}
        raise RuntimeError("[REQUEST_LIMIT_EXCEEDED] the endpoint is busy")

    inst._implement_vibes_llm = busy
    assert _run(inst, _asked(previous, dashboard_vibes=". ".join(asks))) == "vibe_not_met"
    return inst.updates[-1]


def test_a_held_version_with_two_asks_inspire_could_not_check_says_try_again_once(agent_ns):
    final = held_unchecked_run(agent_ns, ASKS[:2])
    entries = final["asset_status"]["checklist"]
    assert len(entries) == 2 and all(e["unchecked"] for e in entries)
    assert all(e["evidence"].endswith(": press Try again to check it again") for e in entries), "each row shown alone keeps its action"
    reason = final["asset_status"]["held"]["reason"]
    assert reason.count("Try again") == 1 and reason.endswith("Press Try again to check them again, or press Publish anyway")
    _once(final["status_message"])
