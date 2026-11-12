"""v2.1.8 one helper asks an LLM check twice.

The R13 invented-column judge, the vibe judge, the vibe split and the signal check each asked the model, asked once more
without the cache when the answer failed or left something unanswered, and gave up with a log line after the second try.
They now share `_llm_ask_twice`, so the retry, the cache bypass, the redaction of the error and the give-up log are one
code path. A vibe judge that answered part of the asks on the first try could never merge the second answer
(`dict(new, **answers)` refuses number keys), so the retry it logged always failed; the shared merge keeps both answers.
"""
import ast
import types

from _agentload import agent_source
from v120_artifacts_support import FakeSpark
from v140_implement_test import _inspire

TOKEN = "dapi" + "ab" * 16
HOST = "adb-zqv.example.net"


class _Log:
    def __init__(self):
        self.records = []

    def warning(self, msg, *a, **k):
        self.records.append(("WARNING", str(msg)))

    def error(self, msg, *a, **k):
        self.records.append(("ERROR", str(msg)))

    def info(self, msg, *a, **k):
        self.records.append(("INFO", str(msg)))

    def debug(self, msg, *a, **k):
        self.records.append(("DEBUG", str(msg)))

    def matching(self, needle):
        return [r for r in self.records if needle in r[1]]


def _twice(agent_ns, replies, unanswered=None, max_chars=300, empty=None):
    owner = types.SimpleNamespace(logger=_Log())
    asked, state, logged = [], {"done": False}, []

    def ask(skip_cache):
        asked.append(skip_cache)
        reply = replies[len(asked) - 1]
        if isinstance(reply, Exception):
            raise reply
        state["done"] = reply

    left = agent_ns["DatabricksInspire"]._llm_ask_twice(
        owner, ask, lambda: [] if state["done"] else ["x"],
        lambda problem, missing: logged.append(("retry", problem, list(missing))),
        lambda problem, missing: logged.append(("give_up", problem, list(missing))),
        unanswered=unanswered, empty=empty, max_chars=max_chars)
    return left, asked, logged


def test_an_answer_on_the_first_try_is_asked_once_with_the_cache_and_logs_nothing(agent_ns):
    left, asked, logged = _twice(agent_ns, [True], empty=lambda: True)
    assert (left, asked, logged) == ([], [False], [])


def test_a_failed_first_try_is_asked_once_more_without_the_cache_and_returns_the_second_answer(agent_ns):
    error = RuntimeError("serving endpoint unavailable")
    left, asked, logged = _twice(agent_ns, [error, True], empty=lambda: False)
    assert asked == [False, True] and left == []
    assert logged == [("retry", "serving endpoint unavailable", ["x"])]


def test_two_failures_log_the_retry_then_the_give_up_and_return_what_is_left(agent_ns):
    first, second = RuntimeError("busy"), RuntimeError("still busy")
    left, asked, logged = _twice(agent_ns, [first, second])
    assert asked == [False, True] and left == ["x"]
    assert logged == [("retry", "busy", ["x"]), ("give_up", "still busy", ["x"])]


def test_a_failure_is_raised_only_when_the_caller_got_no_answer_at_all(agent_ns):
    first, second = RuntimeError("busy"), RuntimeError("still busy")
    try:
        _twice(agent_ns, [first, second], empty=lambda: True)
    except RuntimeError as error:
        assert error is second
    else:
        raise AssertionError("a caller that got nothing is given the error")
    try:
        _twice(agent_ns, [first, False], empty=lambda: True)
    except RuntimeError as error:
        assert error is first
    else:
        raise AssertionError("an empty second answer after a failed first one still gives the caller the error")
    left, asked, _logged = _twice(agent_ns, [first, second], empty=lambda: False)
    assert left == ["x"] and asked == [False, True]


def test_an_unusable_answer_is_retried_with_the_caller_s_words_and_silent_without_them(agent_ns):
    _left, asked, logged = _twice(agent_ns, [False, False], unanswered=lambda missing: f"{len(missing)} unanswered")
    assert asked == [False, True] and logged == [("retry", "1 unanswered", ["x"]), ("give_up", "1 unanswered", ["x"])]
    left, asked, logged = _twice(agent_ns, [False, False], empty=lambda: True)
    assert asked == [False, True] and logged == [] and left == ["x"]


def test_the_error_reaches_the_log_through_the_one_redaction_and_is_cut(agent_ns):
    error = RuntimeError(f"[CAST_INVALID_INPUT] The value 'ZQV9101QZ' cannot be cast at https://{HOST}/api with {TOKEN} " + "x" * 400)
    _left, _asked, logged = _twice(agent_ns, [error, True], max_chars=200)
    problem = logged[0][1]
    assert problem == agent_ns["redact_error"](error, max_chars=200)
    assert TOKEN not in problem and "ZQV9101QZ" not in problem and len(problem) <= 200


def _parts(agent_ns, asks):
    return [{"asset": agent_ns["IMPLEMENT_NOTEBOOK"], "seen": {}, "asks": [{"ask": a} for a in asks]}]


def _verdicts(*numbers):
    return {"checks": [{"n": n, "status": "done", "evidence": f"cell {n}", "where": ""} for n in numbers]}


def test_a_vibe_judge_that_answers_part_of_the_asks_keeps_both_answers_after_the_retry(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    replies = [_verdicts(1), _verdicts(1, 2)]
    inst._implement_vibes_llm = lambda kind, prompt, schema: replies.pop(0)
    judged = inst._implement_vibes_judge(_parts(agent_ns, ["Show the region", "Hold out 8 weeks"]), "N02-U05 before the build")
    assert sorted(c["n"] for c in judged["checks"]) == [1, 2] and replies == []
    assert inst.logger.matching("[IMPLEMENT-VIBES-JUDGE-RETRY FIRED] N02-U05 before the build")
    assert not inst.logger.matching("[IMPLEMENT-VIBES-UNCHECKED FIRED]")


def test_a_vibe_judge_that_fails_twice_raises_the_error_and_logs_the_unchecked_asks(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    calls = []

    def broken(kind, prompt, schema):
        calls.append(kind)
        raise RuntimeError("serving endpoint unavailable")

    inst._implement_vibes_llm = broken
    try:
        inst._implement_vibes_judge(_parts(agent_ns, ["Show the region"]), "N02-U05 before the build")
    except RuntimeError as error:
        assert str(error) == "serving endpoint unavailable"
    else:
        raise AssertionError("a judge that never answered raises its error")
    assert calls == ["judge", "judge"]
    [(_level, line)] = inst.logger.matching("[IMPLEMENT-VIBES-UNCHECKED FIRED]")
    assert "1 ask could not be checked: serving endpoint unavailable" in line


def _signal(agent_ns, building, failures):
    inst = _inspire(agent_ns, FakeSpark())
    inst.logger = _Log()
    planned, asked = [], []
    inst._plan_progress_batches = lambda label, n: planned.append((label, n))
    inst._load_elite_evidence = lambda fresh: {}
    inst._signal_spec = lambda uc, answer, evidence: ({"check": "none", "family": "none"}, str(answer))
    inst._uc_table_refs = lambda uc: []
    inst._signal_record = lambda deep, spec, reason, profiles, use_case=None: reason

    def ask(pending, schema_details, skip_cache, evidence):
        asked.append(([uc["No"] for uc in pending], skip_cache))
        if len(asked) <= failures:
            raise RuntimeError("serving endpoint unavailable")
        return {uc["No"]: "ok" for uc in pending}

    inst._ask_signal_roles = ask
    records = inst._signal_fresh_records([{"No": "N01-U01"}, {"No": "N01-U02"}], [], None, building=building)
    return inst, records, planned, asked


def test_the_signal_check_retries_once_without_the_cache_and_counts_the_extra_batch(agent_ns):
    inst, records, planned, asked = _signal(agent_ns, False, 1)
    assert asked == [(["N01-U01", "N01-U02"], False), (["N01-U01", "N01-U02"], True)]
    assert planned[1:] == [("SignalCheck", 1)] and sorted(records.values()) == ["ok", "ok"]
    [(level, line)] = inst.logger.matching("[SIGNAL-CHECK]")
    assert level == "WARNING" and line.endswith("failed on attempt 1 of 2: serving endpoint unavailable; retrying with the cache bypassed")


def test_the_signal_check_gives_up_as_an_error_and_as_a_warning_while_building(agent_ns):
    inst, _records, _planned, asked = _signal(agent_ns, False, 2)
    assert [s for _ids, s in asked] == [False, True]
    assert [r[0] for r in inst.logger.matching("[SIGNAL-CHECK]")] == ["WARNING", "ERROR"]
    assert inst.logger.matching("failed on attempt 2 of 2: serving endpoint unavailable; no further retry")[0][1].endswith("no further retry")
    inst, _records, planned, _asked = _signal(agent_ns, True, 2)
    assert planned == [] and [r[0] for r in inst.logger.matching("[SIGNAL-CHECK]")] == ["WARNING", "WARNING"]
    assert inst.logger.matching("no further retry, so the build goes on and Genie checks the data minimum")


FOLDED = ("_r13_judge_invented", "_implement_vibes_judge", "_implement_vibes_asks", "_signal_fresh_records")


def test_every_folded_check_asks_through_the_one_helper_and_keeps_no_retry_loop_of_its_own():
    tree = ast.parse(agent_source())
    found = {}
    for fn in ast.walk(tree):
        if isinstance(fn, ast.FunctionDef) and fn.name in FOLDED:
            calls = {getattr(n.func, "attr", "") for n in ast.walk(fn) if isinstance(n, ast.Call)}
            loops = [ast.unparse(n.iter) for n in ast.walk(fn) if isinstance(n, ast.For)]
            found[fn.name] = ("_llm_ask_twice" in calls, "(1, 2)" in loops, "range(1, 3)" in loops)
    assert found == {name: (True, False, False) for name in FOLDED}
