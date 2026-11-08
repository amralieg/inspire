import json
import types

import pytest

from v120_artifacts_support import FakeSpark, make_inspire
from v140_implement_test import sdk_stub  # noqa: F401
from v144_undo_test import REFILL, _Notebooks, _refill

TARGET = {"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 2}
KEY = (5150, "N01-U01", 2)


class PermissionDenied(Exception):
    error_code = "PERMISSION_DENIED"


def _inspire(agent_ns, monkeypatch, outcomes, picks=None):
    inst = make_inspire(agent_ns, spark=FakeSpark(), session_id=5150, inspire_database="main.inspire")
    inst._implement_params = {}
    inst._implement_builder_name = "inspire-sp"
    inst.emitted, inst.updates, inst.locked_targets, inst.prompts, inst.waits, inst.undone = [], [], [], [], [], []
    inst._emit_pipeline_status = lambda **kw: inst.emitted.append(kw) or len(inst.emitted)
    inst.atomic_writer = types.SimpleNamespace(acquire_lock=lambda k, **kw: inst.undone.append("lock") or True,
                                               release_lock=lambda k: inst.undone.append("unlock"))
    inst._implement_update = lambda key, **f: inst.updates.append(json.loads(json.dumps(f)))
    inst._implement_notebook_modified_at = lambda path: None
    inst._implement_notebook_undo = lambda uc_id, inflight: inst.undone.append("undo")
    monkeypatch.setattr(agent_ns["time"], "sleep", inst.waits.append)
    queue = list(outcomes)

    def locked(target, key, inflight):
        inst.locked_targets.append(dict(target))
        result = queue.pop(0)
        if isinstance(result, BaseException):
            raise result
        return result

    inst._implement_one_locked = locked
    answers = list(picks or [])

    def llm(kind, prompt, schema):
        inst.prompts.append((kind, prompt, schema))
        answer = answers.pop(0)
        if isinstance(answer, BaseException):
            raise answer
        return answer

    inst._implement_vibes_llm = llm
    return inst


def _repairs(inst):
    return [e for e in inst.emitted if e.get("step_name") == "Self-repair"]


@pytest.mark.parametrize("message, kind, wait_s", [
    ("Error: the token has expired, sign in again", "retry", 0),
    ("INVALID_STATE: warehouse 0ece is starting, try again shortly", "retry", 60),
    ("java.lang.OutOfMemoryError: out of memory while collecting the result", "smaller_query", 0),
    ("the App compute did not become ACTIVE within 600s (state STARTING)", "retry", 30),
    ("the App churn-desk was still deploying after 10 minutes, so Inspire stopped waiting", "retry", 30),
    ("503 Service Unavailable from the Jobs API", "retry", 30),
    ("the one-time alert check run 99 did not finish within 900s", "retry", 30),
    ("TEMPORARILY_UNAVAILABLE: the preview job could not be submitted", "retry", 30),
    ("REQUEST_LIMIT_EXCEEDED: too many calls to the Genie API", "retry", 30),
    ("RESOURCE_EXHAUSTED: workspace rate limit", "retry", 30),
    ("DEADLINE_EXCEEDED while waiting for the statement", "retry", 30),
])
def test_known_errors_get_their_fixed_repair(agent_ns, message, kind, wait_s):
    repair = agent_ns["implement_known_repair"](RuntimeError(message), message)
    assert (repair["kind"], repair["wait_s"]) == (kind, wait_s)
    assert repair["why"] and "error" not in repair


@pytest.mark.parametrize("make", [
    lambda ns: ns["ImplementStopped"]("Genie stopped the build: the history holds 3 days, the use case needs 28"),
    lambda ns: ns["ImplementBlocked"]("widget values are out of range: top_k is 0"),
    lambda ns: ns["ImplementBlocked"]("the App churn-desk exists but is not this use case's App, so Inspire neither deploys to it"),
    lambda ns: PermissionDenied("User does not have USE CATALOG privilege on catalog `main`"),
    lambda ns: RuntimeError("abc does not have Manage permissions on 1234567890123456. Please contact the owner"),
    lambda ns: RuntimeError("User does not have USE CATALOG privilege on catalog `main`"),
    lambda ns: RuntimeError("[INSUFFICIENT_PERMISSIONS] Insufficient privileges: User does not have SELECT on Table 'main.s.returns'. "
                            "The statement timed out waiting for the grant"),
])
def test_errors_only_a_person_can_fix_stop_at_once(agent_ns, make):
    error = make(agent_ns)
    assert agent_ns["implement_known_repair"](error, str(error))["kind"] == "stop"


def test_a_genie_stop_that_mentions_a_timeout_is_still_a_stop(agent_ns):
    error = agent_ns["ImplementStopped"]("Genie stopped the build: the source query timed out on every try")
    assert agent_ns["implement_known_repair"](error, str(error))["kind"] == "stop"


@pytest.mark.parametrize("message", [
    "NameError: name 'df2' is not defined",
    "the preview run wrote 401 rows but the result table has 400",
    "AnalysisException: [UNRESOLVED_COLUMN] churn_flag cannot be resolved",
])
def test_an_error_with_no_fixed_repair_goes_to_the_model(agent_ns, message):
    assert agent_ns["implement_known_repair"](RuntimeError(message), message) is None


def test_a_timed_out_build_is_tried_again_and_succeeds_on_attempt_2(agent_ns, monkeypatch):
    inst = _inspire(agent_ns, monkeypatch, [RuntimeError("the App deployment did not finish within 600s (state PENDING)"), "ready"])
    assert inst._implement_one(TARGET) == "ready"
    assert inst.waits == [30]
    assert inst.undone == ["lock", "undo", "unlock"], "the half-built notebook is put back before attempt 2, and the lock is held once"
    [step] = _repairs(inst)
    assert step["message"] == ("Attempt 2 of 3: Inspire is fixing it: a Databricks call timed out or was busy, so Inspire tries it again")
    assert step["status"] == "started" and step["result_json"]["attempt"] == 2 and step["result_json"]["attempts"] == 3
    assert inst.updates == [{"status_message": step["message"]}], "the card shows the attempt, and nothing marks the use case failed"
    assert inst.locked_targets[1]["_implement_repair"]["kind"] == "retry"
    assert inst.prompts == [], "a known error never asks the model"


def test_a_build_that_fails_three_times_fails_with_every_reason(agent_ns, monkeypatch):
    errors = [RuntimeError(f"Jobs API returned 503 Service Unavailable on call {n}") for n in (1, 2, 3)]
    inst = _inspire(agent_ns, monkeypatch, errors)
    assert inst._implement_one(TARGET) == "failed"
    assert len(inst.locked_targets) == 3 and [s["result_json"]["attempt"] for s in _repairs(inst)] == [2, 3]
    final = inst.updates[-1]
    assert final["status"] == "failed"
    assert final["status_message"] == ("Inspire tried 3 times and could not build it: "
                                       "attempt 1: Jobs API returned 503 Service Unavailable on call 1; "
                                       "attempt 2: Jobs API returned 503 Service Unavailable on call 2; "
                                       "attempt 3: Jobs API returned 503 Service Unavailable on call 3")
    assert inst.undone.count("undo") == 3 and inst.undone[-1] == "unlock"


def test_a_block_a_person_must_fix_fails_on_attempt_1_with_its_own_words(agent_ns, monkeypatch):
    blocked = agent_ns["ImplementBlocked"]("widget values are out of range: top_k is 0")
    inst = _inspire(agent_ns, monkeypatch, [blocked, "ready"])
    assert inst._implement_one(TARGET) == "failed"
    assert len(inst.locked_targets) == 1 and _repairs(inst) == [] and inst.waits == [] and inst.prompts == []
    assert inst.updates[-1]["status_message"] == "widget values are out of range: top_k is 0"


def test_an_unknown_error_follows_the_repair_the_model_picks_and_hands_it_the_error(agent_ns, monkeypatch):
    error = agent_ns["ImplementNotebookFailed"]("the preview run did not write usable rows: NameError: name 'df2' is not defined")
    inst = _inspire(agent_ns, monkeypatch, [error, "ready_with_warnings"],
                    picks=[{"repair": "rebuild_with_error", "why": "  Genie fixes the notebook code that failed  "}])
    assert inst._implement_one(TARGET) == "ready_with_warnings"
    [(kind, prompt, schema)] = inst.prompts
    assert kind == "repair" and "NameError: name 'df2' is not defined" in prompt
    assert "the user directive wins without exception" in prompt and "Attempt: 1 of 3" in prompt
    assert schema["properties"]["repair"]["enum"] == ["retry", "rebuild_with_error", "smaller_query", "stop"]
    repair = inst.locked_targets[1]["_implement_repair"]
    assert repair["kind"] == "rebuild_with_error" and repair["error"] == str(error)
    assert _repairs(inst)[0]["message"] == "Attempt 2 of 3: Inspire is fixing it: Genie fixes the notebook code that failed"
    assert inst.waits == []


def test_the_model_sees_what_earlier_attempts_tried(agent_ns, monkeypatch):
    failed = agent_ns["ImplementNotebookFailed"]
    inst = _inspire(agent_ns, monkeypatch, [failed("KeyError: 'segment'"), failed("KeyError: 'region'"), "ready"],
                    picks=[{"repair": "rebuild_with_error", "why": "a"}, {"repair": "rebuild_with_error", "why": "b"}])
    assert inst._implement_one(TARGET) == "ready"
    second = inst.prompts[1][1]
    assert "- attempt 1: KeyError: 'segment' (repair: rebuild_with_error)" in second and "Attempt: 2 of 3" in second


@pytest.mark.parametrize("pick", [{"repair": "delete_the_table", "why": "x"}, {"why": "no repair named"}, {"repair": "stop", "why": ""}])
def test_a_pick_outside_the_list_or_a_stop_fails_with_the_error_s_own_words(agent_ns, monkeypatch, pick):
    inst = _inspire(agent_ns, monkeypatch, [RuntimeError("KeyError: 'segment'"), "ready"], picks=[pick])
    assert inst._implement_one(TARGET) == "failed"
    assert len(inst.locked_targets) == 1 and inst.updates[-1]["status_message"] == "KeyError: 'segment'"


def test_without_the_model_an_unknown_error_fails_with_its_own_words(agent_ns, monkeypatch):
    inst = _inspire(agent_ns, monkeypatch, [RuntimeError("KeyError: 'segment'"), "ready"], picks=[TimeoutError("endpoint down")])
    assert inst._implement_one(TARGET) == "failed"
    assert len(inst.locked_targets) == 1 and inst.updates[-1]["status_message"] == "KeyError: 'segment'"
    assert any(level == "WARNING" and "could not pick a repair" in line for level, line in inst.logger.records)


def test_the_repair_note_tells_genie_the_error_only_for_a_notebook_repair(agent_ns):
    note = agent_ns["implement_repair_note"]
    assert "failed with: KeyError: 'x'. Build the notebook so this does not happen again" in note({"kind": "rebuild_with_error",
                                                                                                    "error": "KeyError: 'x'"})
    assert "Aggregate in SQL" in note({"kind": "smaller_query", "error": "out of memory"})
    assert note({"kind": "retry", "error": "timed out"}) == "" and note({}) == ""


def _part_inspire(agent_ns, monkeypatch, results, picks=None):
    inst = _inspire(agent_ns, monkeypatch, [], picks)
    queue = list(results)

    def build():
        result = queue.pop(0)
        if isinstance(result, BaseException):
            raise result
        return result

    return inst, build


def test_a_part_that_timed_out_is_built_again_and_its_fields_come_back(agent_ns, monkeypatch):
    inst, build = _part_inspire(agent_ns, monkeypatch, [agent_ns["ImplementBlocked"]("the App compute did not become ACTIVE within "
                                                                                     "600s (state STARTING)"), {"app_name": "churn-desk"}])
    assert inst._implement_part_attempts("N01-U01", KEY, "app", build) == {"app_name": "churn-desk"}
    [step] = _repairs(inst)
    assert step["result_json"]["step"] == "the App" and step["message"].startswith("Attempt 2 of 3: Inspire is fixing it: ")
    assert inst.waits == [30]


def test_a_part_never_rebuilds_the_notebook_so_a_notebook_repair_becomes_a_retry(agent_ns, monkeypatch):
    inst, build = _part_inspire(agent_ns, monkeypatch, [RuntimeError("out of memory in the dashboard query"), {"dashboard_id": "d1"}])
    assert inst._implement_part_attempts("N01-U01", KEY, "dashboard", build) == {"dashboard_id": "d1"}
    assert _repairs(inst)[0]["result_json"]["repair"] == "retry"


def test_the_model_offers_a_part_only_a_retry_or_a_stop(agent_ns, monkeypatch):
    inst, build = _part_inspire(agent_ns, monkeypatch, [RuntimeError("KeyError: 'tile'"), {"dashboard_id": "d1"}],
                                picks=[{"repair": "retry", "why": "Genie writes the dashboard again"}])
    assert inst._implement_part_attempts("N01-U01", KEY, "dashboard", build) == {"dashboard_id": "d1"}
    assert inst.prompts[0][2]["properties"]["repair"]["enum"] == ["retry", "stop"]


def test_a_part_a_person_must_fix_raises_its_own_error_once(agent_ns, monkeypatch):
    blocked = agent_ns["ImplementBlocked"]("pick another App name")
    inst, build = _part_inspire(agent_ns, monkeypatch, [blocked, {"app_name": "x"}])
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        inst._implement_part_attempts("N01-U01", KEY, "app", build)
    assert raised.value is blocked and _repairs(inst) == []


def test_a_part_that_fails_three_times_says_every_reason(agent_ns, monkeypatch):
    inst, build = _part_inspire(agent_ns, monkeypatch, [RuntimeError(f"Bad Gateway {n}") for n in (1, 2, 3)])
    with pytest.raises(RuntimeError, match=r"^Inspire tried 3 times and could not build it: attempt 1: Bad Gateway 1; attempt 2: Bad "
                                           r"Gateway 2; attempt 3: Bad Gateway 3$"):
        inst._implement_part_attempts("N01-U01", KEY, "dashboard", build)


def _stored(inst):
    rows = {2: {"spec_version": 2, "notebook_path": "/W/nb", "job_id": 77, "result_rows": 40, "dashboard_id": "d1",
                "asset_status": {"notebook": {"modified_at": 1000, "spec_version": 2}}},
            3: {"spec_version": 3}}

    def select(where, args, order=""):
        own = "<=" in where
        return [json.loads(json.dumps(rows[v])) for v in sorted(rows, reverse=True) if v < args["v"] or (own and v == args["v"])]

    def update(key, **fields):
        inst.updates.append(fields)
        rows.setdefault(key[2], {"spec_version": key[2]}).update(json.loads(json.dumps(fields, default=str)))

    del inst._implement_carried
    inst._implement_select, inst._implement_update = select, update
    return rows


def _capture_fill(inst, outcomes):
    seen = []

    def fill(uc_id, key, use_case, spec, basis, path, widgets, runner, refill):
        seen.append({"note": use_case.get("_implement_repair_note"), "refill": refill})
        result = outcomes.pop(0)
        if isinstance(result, BaseException):
            raise result
        return result, 77, {}

    inst._implement_fill_and_preview = fill
    return seen


def test_a_notebook_repair_rebuilds_the_notebook_and_hands_genie_the_error(agent_ns, sdk_stub, monkeypatch):
    inst = _refill(agent_ns, monkeypatch, _Notebooks("built notebook v2"), None)
    _stored(inst)
    seen = _capture_fill(inst, [{"status": "written", "rows_written": 3}])
    error = "the preview run did not write usable rows: NameError: name 'df2' is not defined"
    inst._implement_one_locked(dict(REFILL, _implement_repair={"kind": "rebuild_with_error", "error": error}),
                               (5150, "N01-U01", 3), {})
    assert seen[0]["refill"] is True and error in seen[0]["note"]


def test_a_retry_hands_genie_no_note(agent_ns, sdk_stub, monkeypatch):
    inst = _refill(agent_ns, monkeypatch, _Notebooks("built notebook v2"), None)
    _stored(inst)
    seen = _capture_fill(inst, [{"status": "written", "rows_written": 3}])
    inst._implement_one_locked(dict(REFILL, _implement_repair={"kind": "retry", "error": "timed out"}), (5150, "N01-U01", 3), {})
    assert seen[0]["note"] == ""


def test_a_transient_preview_failure_is_rebuilt_from_the_notebook_put_back(agent_ns, sdk_stub, monkeypatch):
    notebooks = _Notebooks("built notebook v2")
    inst = _refill(agent_ns, monkeypatch, notebooks, None)
    rows = _stored(inst)
    waits = []
    monkeypatch.setattr(agent_ns["time"], "sleep", waits.append)
    seen = _capture_fill(inst, [RuntimeError("TEMPORARILY_UNAVAILABLE: the preview job could not be submitted"),
                                {"status": "written", "rows_written": 3}])
    assert inst._implement_one(REFILL) in ("ready", "ready_with_warnings")
    assert len(seen) == 2 and waits == [30]
    assert [text for _p, _f, text in notebooks.imported] == ["half-built notebook", "built notebook v2", "half-built notebook"], \
        "attempt 1's half-built notebook is put back before attempt 2 builds it again"
    assert not [line for _level, line in inst.logger.records if "was edited after Inspire last built it" in line], \
        "putting the notebook back is Inspire's own write, never a person's edit"
    assert rows[3]["asset_status"]["notebook"]["spec_version"] == 3 and rows[3]["status"] in ("ready", "ready_with_warnings")


def test_a_build_tried_again_after_its_parts_were_built_updates_them_instead_of_building_new_ones(agent_ns, sdk_stub, monkeypatch):
    notebooks = _Notebooks("built notebook v2")
    inst = _refill(agent_ns, monkeypatch, notebooks, None)
    rows = _stored(inst)
    monkeypatch.setattr(agent_ns["time"], "sleep", lambda s: None)
    _capture_fill(inst, [{"status": "written", "rows_written": 3}, {"status": "written", "rows_written": 3}])
    given = []

    def genie(context, runner):
        given.append(context["assets"].get("genie_space"))
        return {"genie_space_id": given[-1] or "g-new", "genie_space_url": "https://h/genie/rooms/g-new"}

    inst._implement_genie_space = genie
    failures = [RuntimeError("Jobs API returned 503 Service Unavailable")]
    keep_side = inst._implement_keep_side

    def flaky_keep_side(*a):
        if failures:
            raise failures.pop()
        return keep_side(*a)

    inst._implement_keep_side = flaky_keep_side
    assert inst._implement_one(REFILL) in ("ready", "ready_with_warnings")
    assert given == [None, "g-new"], "attempt 2 updates the Genie space attempt 1 built instead of building a second one"
    assert rows[3]["genie_space_id"] == "g-new"
    assert not [line for _level, line in inst.logger.records if "was edited after Inspire last built it" in line], \
        "the notebook attempt 1 built is Inspire's own, never a person's edit"


def test_attempts_that_failed_the_same_way_say_the_reason_once(agent_ns):
    told = agent_ns["implement_attempts_message"]
    assert told(["the warehouse is stopped"] * 3) == "Inspire tried 3 times and could not build it: the warehouse is stopped"
    assert told(["A", "B", "B"]) == "Inspire tried 3 times and could not build it: attempt 1: A; attempts 2 to 3: B"
    assert told(["A", "A", "B"]) == "Inspire tried 3 times and could not build it: attempts 1 to 2: A; attempt 3: B"
    assert told(["A", "B", "A"]) == "Inspire tried 3 times and could not build it: attempt 1: A; attempt 2: B; attempt 3: A"
    assert told(["A"]) == "A" and told([]) == ""


HOST_URL = "https://adb-42.example.net/api/2.2/jobs/get"
TOKEN = "dapi" + "ab" * 16


def _picks(inst, pick):
    asked = []
    inst._implement_vibes_llm = lambda kind, prompt, schema: asked.append(schema["properties"]["repair"]["enum"]) or dict(pick)
    return asked


def test_an_inspire_step_that_crashes_is_tried_once_more_with_no_genie_rebuild_and_its_traceback_is_logged(agent_ns, sdk_stub,
                                                                                                          monkeypatch):
    inst = _refill(agent_ns, monkeypatch, _Notebooks("built notebook v2"), None)
    _stored(inst)
    asked = _picks(inst, {"repair": "rebuild_with_error", "why": "Genie fixes the notebook"})
    seen = _capture_fill(inst, [{"status": "written", "rows_written": 3}] * 3)

    def broken(target, through_own=False):
        raise AttributeError(f"'list' object has no attribute 'get' while reading {HOST_URL} with {TOKEN}")

    inst._implement_carried_rows = broken
    assert inst._implement_one(REFILL) == "failed"
    assert asked == [], "an Inspire bug never goes to the repair picker, so no Genie rebuild can be chosen"
    assert seen == [], "the crash comes before any Genie round, and the retry crashes the same way"
    repairs = [e for e in inst.emitted if e.get("step_name") == "Self-repair"]
    assert [e["result_json"]["repair"] for e in repairs] == ["retry"], "one plain retry, then the build stops"
    final = next(u for u in reversed(inst.updates) if u.get("status") == "failed")
    assert "an Inspire step failed: _implement_carried: AttributeError: 'list' object has no attribute 'get'" in final["status_message"]
    assert "not in the notebook" in final["status_message"] and "coding mistake" not in final["status_message"]
    logged = [line for level, line in inst.logger.records if level == "WARNING" and "[IMPLEMENT-ERROR]" in line]
    assert len(logged) == 2, "each caught exception is logged once"
    errors = [line for level, line in inst.logger.records if level == "ERROR"]
    assert len(errors) == 1 and errors[0].startswith("[IMPLEMENT-FAILED]"), errors
    assert "Inspire tried 2 times and could not build it" in errors[0]
    assert [line for level, line in inst.logger.records if level == "WARNING" and "· Implement: Inspire tried 2 times" in line], \
        "the step status still carries the give-up text, as a warning"
    assert "Traceback (most recent call last)" in logged[0] and "in _implement_carried" in logged[0] and "failed with an Inspire error" in logged[0]
    assert TOKEN not in logged[0] and "adb-42.example.net" not in logged[0], "the traceback never carries a token or a host"
    assert "<redacted>" in logged[0] and "https://<host>/api/2.2/jobs/get" in logged[0]


@pytest.mark.parametrize("outcome", [
    {"status": "failed", "error": "the job run failed: NameError: name 'df2' is not defined"},
    {"status": "failed", "error": "Genie's notebook failed Inspire's checks: cell 3 reads main.s.unknown, which the use case does not use"},
], ids=["notebook_run_failure", "genie_output_failed_validation"])
def test_a_failure_of_what_genie_built_still_gets_the_repair_picker_with_its_rebuilds(agent_ns, sdk_stub, monkeypatch, outcome):
    inst = _refill(agent_ns, monkeypatch, _Notebooks("built notebook v2"), None)
    _stored(inst)
    asked = _picks(inst, {"repair": "rebuild_with_error", "why": "Genie fixes the notebook"})
    seen = _capture_fill(inst, [outcome, {"status": "written", "rows_written": 3}])
    assert inst._implement_one(REFILL) in ("ready", "ready_with_warnings")
    assert asked == [["retry", "rebuild_with_error", "smaller_query", "stop"]], "a notebook failure is offered every repair"
    assert len(seen) == 2 and outcome["error"] in seen[1]["note"], "Genie rebuilds the notebook with the error in its instructions"
    logged = [line for level, line in inst.logger.records if level == "WARNING" and "[IMPLEMENT-ERROR]" in line]
    assert len(logged) == 1 and "failed in the notebook" in logged[0] and "ImplementNotebookFailed" in logged[0]
    assert [line for level, line in inst.logger.records if level == "ERROR"] == [], "a build that recovers logs no error"


def test_each_exception_the_build_loop_sees_has_one_origin(agent_ns):
    origin = agent_ns["implement_failure_origin"]
    assert origin(agent_ns["ImplementBlocked"]("widget values are out of range")) == "refusal"
    assert origin(agent_ns["ImplementStopped"]("Genie stopped the build")) == "refusal"
    assert origin(agent_ns["ImplementNotebookFailed"]("the preview run did not write usable rows")) == "notebook"
    for error in (AttributeError("x"), KeyError("segment"), TypeError("x"), IndexError("x"), NameError("x"),
                  agent_ns["ImplementCandidate"]("app", {}), agent_ns["ImplementAsksMissed"]("feedback", "missed")):
        assert origin(error) == "internal", type(error).__name__
    for error in (RuntimeError("Jobs API returned 503 Service Unavailable"), ConnectionError("reset"), TimeoutError("slow"),
                  agent_ns["AnalysisException"]("TABLE_OR_VIEW_NOT_FOUND")):
        assert origin(error) == "platform", type(error).__name__


def test_a_platform_error_with_no_fixed_repair_is_offered_only_a_retry_or_a_stop(agent_ns, monkeypatch):
    inst = _inspire(agent_ns, monkeypatch, [RuntimeError("the Jobs API returned no run for job 77"), "ready"],
                    picks=[{"repair": "retry", "why": "try again"}])
    assert inst._implement_one(TARGET) == "ready"
    [(_kind, _prompt, schema)] = inst.prompts
    assert schema["properties"]["repair"]["enum"] == ["retry", "stop"], "a rebuild of the notebook cannot fix a Databricks call"


def test_the_log_redaction_drops_tokens_and_hosts_and_keeps_the_rest(agent_ns):
    redact = agent_ns["inspire_redact_secrets"]
    text = f"call {HOST_URL} with {TOKEN} and Bearer abcdefghijklmnop for the secret s3cret-value"
    assert redact(text, ("s3cret-value",)) == ("call https://<host>/api/2.2/jobs/get with <redacted> and Bearer <redacted> for the secret "
                                                "<redacted>")
    assert redact("nothing to hide", (None, "", "abc")) == "nothing to hide"
