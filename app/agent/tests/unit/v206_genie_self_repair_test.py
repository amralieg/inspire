"""A build Genie stops on a data shortfall, a declared setting the counts fail or a defect goes back to Genie as a repair round with
the measured facts, and the user is told what Genie changed."""
import ast

from _agentload import method_node
from v120_artifacts_support import FakeSpark
from v140_implement_test import VALID, _FakeRunner, _fill, _flow_inspire, _NB_SPEC

UC, KEY, PATH, NAMES = "N01-U01", (5150, "N01-U01", 1), "/W/nb", ["result_table", "run_profile"]
SHORT_D = "There are too few past interactions (743); at least 1,000 are needed to learn preferences."
SHORT_A = "History holds too few past examples of the outcome (11); at least 200 are needed to learn from."
NOTE_D = ("Genie found 743 past interactions, fewer than the 1,000 the first method needs, so it used item co-occurrence shrunk toward "
          "popularity instead. Results will be less precise; Rebuild once the data meets that minimum to use matrix factorization.")


def _family(inst, family):
    inst._genie_notebook_spec = lambda uc: dict(_NB_SPEC, family=family)
    return inst


def _spec(ns, **widgets):
    config = dict(VALID["config"], widgets=dict(VALID["config"]["widgets"], **widgets))
    return ns["validate_implement_spec"](dict(VALID, config=config))[0]


def _stopped(reason):
    return dict(_fill(), status="stopped", stop_reason=reason)


def _adapted(**change):
    base = {name: "" for name in ("what", "why", "method_was", "method_now", "setting", "value_was", "value_now")}
    return dict(_fill(), changes=[dict(base, **change)])


def _run(ns, inst, runner, spec=None):
    return inst._implement_fill_and_preview(UC, KEY, {}, spec or _spec(ns), None, PATH, NAMES, runner, True)


def test_a_743_of_1000_interactions_stop_goes_back_with_the_counts_and_builds_an_adapted_method(agent_ns):
    inst = _family(_flow_inspire(agent_ns, [({"status": "written", "rows_written": 40}, 11, 101)]), "D")
    runner = _FakeRunner([{"exit": 0, "final": _stopped(SHORT_D)},
                          {"exit": 0, "final": _adapted(method_was="matrix factorization",
                                                        method_now="item co-occurrence shrunk toward popularity",
                                                        why="743 interactions are too few to learn preferences",
                                                        cause="data_shortfall")}])
    outcome, job_id, _fill_out = _run(agent_ns, inst, runner)
    assert outcome == {"status": "written", "rows_written": 40, "genie_changes": [NOTE_D]} and job_id == 11
    assert len(runner.prompts) == 2
    sent = runner.prompts[1]
    assert SHORT_D in sent and "valid at 743 past interactions" in sent and "item co-occurrence shrunk toward popularity" in sent
    assert "lower `min_interactions` within its allowed range (whole number, at least 1)" in sent and "Never fabricate data" in sent
    build = [e for e in inst.emitted if e["step_name"] == "Genie build"]
    assert build[1]["message"].startswith("round 1 of up to 6: Genie stopped, sent back to repair it: There are too few past interactions (743)")
    assert inst.logger.matching("[GENIE-SELF-REPAIR FIRED] N01-U01: data shortfall interactions = 743 against 1,000")


def test_a_data_repair_does_not_use_the_rounds_the_heavy_steps_need(agent_ns):
    failed = ({"status": "failed", "error": "boom"}, 11, 1)
    inst = _family(_flow_inspire(agent_ns, [failed, failed, failed]), "D")
    runner = _FakeRunner([{"exit": 0, "final": _stopped(SHORT_D)}] + [{"exit": 0, "final": _fill()}] * 3)
    outcome, _job, _f = _run(agent_ns, inst, runner)
    assert outcome["status"] == "failed" and len(runner.prompts) == 4


def test_an_11_outcome_stop_with_no_valid_method_builds_the_simplest_method_marked_not_reliable_yet(agent_ns):
    inst = _family(_flow_inspire(agent_ns, [({"status": "written", "rows_written": 40}, 11, 101)]), "A")
    runner = _FakeRunner([{"exit": 0, "final": _stopped(SHORT_A)}, {"exit": 0, "final": _stopped(SHORT_A)}, {"exit": 0, "final": _fill()}])
    outcome, _job, _f = _run(agent_ns, inst, runner, _spec(agent_ns))
    assert len(runner.prompts) == 3 and "valid at 11 past examples of the outcome" in runner.prompts[1]
    assert agent_ns["implement_unreliable_note"](SHORT_A, "A") in runner.prompts[2]
    assert "accepted=False" in runner.prompts[2] and "Not reliable yet" in runner.prompts[2]
    assert outcome == {"status": "written", "rows_written": 40}
    assert any("[NOT-RELIABLE-FALLBACK FIRED]" in m for _level, m in inst.logger.records)
    rounds = {e["result_json"].get("rounds") for e in inst.emitted if e["step_name"] == "Genie build" and e["result_json"].get("rounds")}
    assert rounds == {6}, "the round counter keeps one total while the data rounds are spent"


def test_an_11_outcome_stop_with_no_valid_method_ends_with_what_data_would_make_it_buildable(agent_ns):
    inst = _family(_flow_inspire(agent_ns, []), "A")
    runner = _FakeRunner([{"exit": 0, "final": _stopped(SHORT_A)}] * 3)
    spec = _spec(agent_ns)
    outcome, _job, _f = _run(agent_ns, inst, runner, spec)
    assert len(runner.prompts) == 3 and "valid at 11 past examples of the outcome" in runner.prompts[1]
    assert outcome["status"] == "stopped" and outcome["stopped_by"] == "genie" and "genie_changes" not in outcome
    assert outcome["buildable"] == ("Genie found no method that is valid at 11 past examples of the outcome, so this use case becomes "
                                    "buildable once the data has at least 200 past examples of the outcome")
    message = agent_ns["implement_stop_message"](outcome, spec)
    assert message.startswith("Genie stopped the build: " + SHORT_A.rstrip(".") + ". Genie found no method that is valid at 11")


def test_a_minimum_the_user_set_is_not_changed_and_the_user_is_asked(agent_ns):
    inst = _family(_flow_inspire(agent_ns, []), "D")
    runner = _FakeRunner([{"exit": 0, "final": _stopped(SHORT_D)}])
    spec = _spec(agent_ns, min_interactions=1000)
    outcome, _job, _f = _run(agent_ns, inst, runner, spec)
    assert len(runner.prompts) == 1 and outcome["status"] == "stopped"
    assert outcome["ask_user"] == ("Minimum interactions is set to 1,000 in the wizard and the data has 743 past interactions, so Inspire "
                                   "kept your setting. Lower it in the settings, or rebuild once the data reaches it")
    assert outcome["ask_user"] in agent_ns["implement_stop_message"](outcome, spec)


def test_a_declared_minimum_above_the_measured_count_is_sent_back_before_the_preview_run(agent_ns):
    previews = []
    inst = _family(_flow_inspire(agent_ns, [({"status": "written", "rows_written": 40}, 11, 101)]), "D")
    queued = inst._implement_preview
    inst._implement_preview = lambda *a: previews.append(len(runner.prompts)) or queued(*a)
    blind = dict(_fill(), widgets=_fill()["widgets"] + [{"name": "min_interactions", "type": "text", "default": "1000", "choices": [],
                                                         "allowed": "at least 1", "label": "Minimum interactions"}],
                 readiness=[{"check": "interactions", "measured": "743"}, {"check": "users", "measured": "120"}])
    fixed = dict(blind, widgets=_fill()["widgets"], readiness=blind["readiness"])
    runner = _FakeRunner([{"exit": 0, "final": blind}, {"exit": 0, "final": fixed}])
    outcome, _job, _f = _run(agent_ns, inst, runner)
    assert outcome == {"status": "written", "rows_written": 40} and previews == [2]
    assert ("you declared `min_interactions` = 1000, and the readiness step measured `interactions` = 743, so the run would stop at "
            "that check") in runner.prompts[1]
    build = [e for e in inst.emitted if e["step_name"] == "Genie build"]
    assert build[1]["message"].startswith("round 1 of up to 6 failed, sent back to Genie: you declared `min_interactions` = 1000")


def test_declared_settings_the_counts_support_or_the_user_set_are_not_sent_back(agent_ns):
    check = agent_ns["implement_declared_setting_problems"]
    widgets = [{"name": "min_interactions", "default": "500"}, {"name": "min_join_coverage", "default": "0.8"}]
    fill = {"widgets": widgets, "readiness": [{"check": "interactions", "measured": "743"}, {"check": "join_coverage", "measured": "92%"}]}
    assert check(fill, "D") == []
    assert check(dict(fill, widgets=[{"name": "min_interactions", "default": "1000"}]), "D", {"min_interactions": 1000}) == []
    assert check(dict(fill, readiness=[]), "D") == []
    assert len(check(dict(fill, readiness=[{"check": "join_coverage", "measured": "61%"}]), "D")) == 1


def test_a_generic_sql_error_stop_gets_a_repair_round_with_the_exact_error(agent_ns):
    error = "AnalysisException: [UNRESOLVED_COLUMN] A column `churn_flag` cannot be resolved"
    inst = _flow_inspire(agent_ns, [({"status": "written", "rows_written": 40}, 11, 101)])
    runner = _FakeRunner([{"exit": 0, "final": _stopped(error)},
                          {"exit": 0, "final": _adapted(what="the outcome column", why="churn_flag does not exist; the label is is_churned")}])
    outcome, _job, _f = _run(agent_ns, inst, runner)
    assert outcome["status"] == "written" and outcome["genie_changes"] == [
        "Genie changed the outcome column: churn_flag does not exist; the label is is_churned."]
    assert error in runner.prompts[1] and "such as a SQL error or a missing column, fix its cause" in runner.prompts[1]


def test_a_stop_after_every_repair_round_says_it_was_sent_back(agent_ns):
    inst = _flow_inspire(agent_ns, [])
    runner = _FakeRunner([{"exit": 0, "final": _stopped("the sample query failed")}] * 3)
    spec = _spec(agent_ns)
    outcome, _job, _f = _run(agent_ns, inst, runner, spec)
    assert len(runner.prompts) == 3 and outcome["status"] == "stopped"
    assert agent_ns["implement_stop_message"](outcome, spec) == (
        "Genie stopped the build: the sample query failed. Inspire sent it back to Genie 2 times with the error, and it still stopped")


def test_a_privilege_denial_stop_is_not_sent_back(agent_ns):
    denial = ("RestException: PERMISSION_DENIED: Principal 'app-x inspire-ai-implement' does not have CREATE MODEL on Schema "
              "'main.inspire'.")
    inst = _flow_inspire(agent_ns, [])
    runner = _FakeRunner([{"exit": 0, "final": _stopped(denial)}])
    outcome, _job, _f = _run(agent_ns, inst, runner)
    assert len(runner.prompts) == 1 and outcome == {"status": "stopped", "stop_reason": denial, "stopped_by": "genie"}


def test_a_preview_run_that_stops_on_a_data_shortfall_goes_back_to_genie(agent_ns):
    inst = _family(_flow_inspire(agent_ns, [({"status": "stopped", "stop_reason": SHORT_D}, 11, 101),
                                            ({"status": "written", "rows_written": 40}, 11, 102)]), "D")
    runner = _FakeRunner([{"exit": 0, "final": _fill()},
                          {"exit": 0, "final": _adapted(setting="min_interactions", value_was="1000", value_now="700",
                                                        why="co-occurrence with shrinkage holds at 700 interactions")}])
    outcome, _job, _f = _run(agent_ns, inst, runner)
    assert outcome["status"] == "written" and len(runner.prompts) == 2
    assert outcome["genie_changes"] == [
        "Genie found 743 past interactions, fewer than the 1,000 the setting asked for, so it set Minimum interactions to 700, not 1000: "
        "co-occurrence with shrinkage holds at 700 interactions."]
    assert "and it stopped." in runner.prompts[1] and SHORT_D in runner.prompts[1]


def test_the_shortfall_reader_reads_readiness_stops_and_nothing_else(agent_ns):
    read = agent_ns["implement_readiness_shortfall"]
    assert {k: read(SHORT_D, "D")[k] for k in ("check", "setting", "observed", "required")} == {
        "check": "interactions", "setting": "min_interactions", "observed": "743", "required": "1,000"}
    assert read(SHORT_A, "A")["check"] == "positives"
    assert read("Only 61% of rows match along the verified join path; at least 80% must match.")["check"] == "join_coverage"
    assert read("There were too few cases (12), at least 30 are needed")["observed"] == "12"
    assert read("AnalysisException: [UNRESOLVED_COLUMN] churn_flag") == {}
    assert read("") == {} and read(None) == {}


def test_settings_genie_changed_are_saved_with_their_reason(agent_ns):
    spark = FakeSpark()
    inst = _flow_inspire(agent_ns, [])
    inst.spark = spark
    fill = _adapted(setting="min_interactions", value_was="1000", value_now="700", why="shrinkage holds at 700")
    assert inst._implement_record_genie_settings(UC, "main.inspire.churn_out", fill) == 1
    inserts = [q for q in spark.statements if q.lstrip().upper().startswith("INSERT INTO")]
    assert len(inserts) == 1 and "'min_interactions'" in inserts[0] and "'Genie'" in inserts[0] and "'shrinkage holds at 700'" in inserts[0]
    assert inst._implement_record_genie_settings(UC, "main.inspire.churn_out", _adapted(what="x", why="y")) == 0


def test_the_build_shows_genie_changes_in_the_summary_and_the_version_history():
    source = ast.unparse(method_node("DatabricksInspire", "_implement_one_locked"))
    assert "warnings += [f'Notebook: {note}'[:1500] for note in outcome['genie_changes']]" in source
    assert "**({'notes': outcome['genie_changes']} if outcome.get('genie_changes') else {})" in source
    assert "self._implement_record_genie_settings(uc_id, result_table, fill)" in source
