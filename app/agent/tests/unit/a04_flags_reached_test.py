"""a04_flags_reached (R5.1, U2 follow-up; T-FLAGS-01): a switched-off step gets a "skipped" step-ledger row only when the run reaches it.

StepLedger.record_switched_off_steps() today writes a skipped row for every off flag, so the Monitor shows steps the run never had.
The rule is checked against the run itself, not a hardcoded table: a flag-off run may write a skipped row for a (stage, step) only
when the same run with the flag on reaches that (stage, step) in its ledger; a reached step that is off still gets its skipped row;
flags_json still lists every off flag on every row.

Design note (test writer, recommended option): the elite judge prompt also runs in Good and High mode, inside Best of Best
(_mark_best_of_best -> _judge_elite_candidates(stage="best_of_best")), but those calls are listed under the Best of Best title.
The "Elite Selection" (stage, step) of ULTRA_HIGH_ELITE_JUDGE_PROMPT is reached only in Ultra High, so that is the row these tests
key on. The second goal filter is reached only with a goal (it returns before any AI call without one), and Assign_User_Domains
only with user domains. Goal presence is known only after run() interprets the instructions, after StepLedger.start, so the
builder may have to record these skipped rows where the run skips the step rather than at ledger start.

Known conflict for the coordinator: c36_flags_test.py::test_4 runs OFF_ALL in Good mode and expects an elite judge skipped row;
with this rule that expectation no longer holds (Elite Selection is not reached in Good mode).

Harness: c36_flags_test.offline_run (offline DatabricksInspire.run() with a LedgerSpark step ledger).
"""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import c36_flags_test as c36  # noqa: E402

NO_GOAL = {"goal_setting": {"has_goal": False, "goal_description": ""}}


def _elite_key(ns):
    return tuple(ns["step_ledger_labels"]("ULTRA_HIGH_ELITE_JUDGE_PROMPT"))


def _goal2_key(ns):
    return (ns["step_ledger_labels"]("GOAL_ALIGNMENT_FILTER_PROMPT")[0], "goal_alignment_post_catchall")


def _user_domains_key(ns):
    label = tuple(ns["step_ledger_labels"]("Assign_User_Domains_PROMPT"))
    return label if label != tuple(ns["STEP_LEDGER_UNATTRIBUTED"]) else ("Domain Mapping", "Assign_User_Domains")


def _keys(run, status=None):
    return {(r["stage"], r["step"]) for r in run.rows if status is None or r.get("status") == status}


def _run(ns, tmp, name, mode, flags, goal=True, user_domains=None, monkeypatch=None):
    if not goal:
        monkeypatch.setattr(c36, "GOAL", NO_GOAL)
    run = c36.offline_run(ns, tmp / name, mode=mode, flags=flags, user_domains=user_domains)
    assert run.rows, "precondition: the step ledger wrote rows"
    return run


# (case id, flag settings for the off run, key fn, mode, goal present, user domains)
UNREACHED = [
    ("elite_judge-good", {"discover_elite_judge": False}, _elite_key, "Good", True, None),
    ("elite_judge-high", {"discover_elite_judge": False}, _elite_key, "High", True, None),
    ("goal_filter_second-no_goal", {"discover_goal_filter_second": False}, _goal2_key, "Good", False, None),
    ("assign_user_domains-no_user_domains",
     {"discover_domain_steps": [s for s in c36.DOMAIN_STEPS if s != "Assign_User_Domains"]}, _user_domains_key, "Good", True, None),
]


@pytest.mark.parametrize("case,flags,key_fn,mode,goal,user_domains", UNREACHED, ids=[c[0] for c in UNREACHED])
def test_1_unreached_step_that_is_off_has_no_skipped_row(agent_ns, tmp_path, monkeypatch, case, flags, key_fn, mode, goal, user_domains):
    key = key_fn(agent_ns)
    on = _run(agent_ns, tmp_path, "on", mode, {}, goal=goal, user_domains=user_domains, monkeypatch=monkeypatch)
    assert key not in _keys(on), f"precondition: {key} must be unreached in this {mode} run with the flag on"
    off = _run(agent_ns, tmp_path, "off", mode, flags, goal=goal, user_domains=user_domains, monkeypatch=monkeypatch)
    assert key not in _keys(off, "skipped"), (
        f"{case}: skipped row for {key}, a step this {mode} run never reaches; skipped rows: {sorted(_keys(off, 'skipped'))}")


REACHED = [
    ("elite_judge-ultra_high", {"discover_elite_judge": False}, _elite_key, "Ultra High", None),
    ("goal_filter_second-with_goal", {"discover_goal_filter_second": False}, _goal2_key, "Good", None),
]


@pytest.mark.parametrize("case,flags,key_fn,mode,user_domains", REACHED, ids=[c[0] for c in REACHED])
def test_2_guard_reached_step_that_is_off_keeps_its_skipped_row(agent_ns, tmp_path, case, flags, key_fn, mode, user_domains):
    key = key_fn(agent_ns)
    off = _run(agent_ns, tmp_path, "off", mode, flags, user_domains=user_domains)
    assert key in _keys(off, "skipped"), f"{case}: no skipped row for {key}; skipped rows: {sorted(_keys(off, 'skipped'))}"


def test_3_guard_best_of_best_off_is_skipped_in_a_good_run(agent_ns, tmp_path):
    off = _run(agent_ns, tmp_path, "off", "Good", {"discover_best_of_best": False})
    assert tuple(agent_ns["BEST_OF_BEST_STORY_TITLE"]) in _keys(off, "skipped")


def test_4_guard_flags_json_lists_every_off_flag_on_every_row(agent_ns, tmp_path):
    flags = {"discover_elite_judge": False, "discover_review_dedup": False}
    off = _run(agent_ns, tmp_path, "off", "Good", flags)
    for row in off.rows:
        got = json.loads(row.get("flags_json") or "{}")
        for flag, value in flags.items():
            assert got.get(flag) == value, f"flags_json of {row['stage']}/{row['step']} lacks {flag}={value!r}: {got}"
