import copy
import json

import pytest

from v140_implement_test import _FileRunner, _app_flow, _churn_page, _output_context
from v142_genie_test import RESULT, _definition, _deploy_inspire, _posted_space, _rich_space
from v142_merge_test import _genie_answer, _genie_body

ACT = "Which customers act now?"
REASONS = "Which reason codes account for the customers requiring attention?"
REASONS_SQL = f"SELECT explanation, COUNT(*) AS n FROM {RESULT} WHERE priority_tier = 'Act now' GROUP BY explanation"
SPREAD = "How do the reasons spread across the latest run?"
SPREAD_SQL = f"SELECT explanation, COUNT(*) AS n FROM {RESULT} GROUP BY explanation"
MIX = {"Act now": 0, "Review": 0, "Monitor": 120}


def _space(*pairs):
    space = _rich_space()
    for key, (question, sql) in zip("cde", pairs):
        space["config"]["sample_questions"].append({"id": key * 32, "question": [question]})
        space["instructions"]["example_question_sqls"].append({"id": key * 32, "question": [question], "sql": [sql]})
    return space


def _questions(space):
    return ["".join(q["question"]) for q in space["config"]["sample_questions"]]


def _examples(space):
    return ["".join(e["question"]) for e in space["instructions"]["example_question_sqls"]]


def _answers(inst, ran, empty=(), failing=(), once=()):
    def check(sql, require_rows=False, limit=20):
        ran.append(sql)
        if any(f in sql for f in failing):
            raise RuntimeError("[UNRESOLVED_COLUMN] reason_code cannot be resolved")
        if any(f in sql for f in once) and ran.count(sql) == 1:
            return []
        return [] if "HAVING COUNT(*) > 1" in sql or any(f in sql for f in empty) else [{"n": 1}]

    inst._implement_run_query_check = check
    inst._implement_tier_counts = lambda table: dict(MIX)


class _DirRunner(_FileRunner):
    def run(self, prompt, work_dir, schema=None, label=""):
        self.dirs = getattr(self, "dirs", []) + [work_dir]
        return super().run(prompt, work_dir, schema, label)


def _build(ns, tmp_path, spaces, context=None, **answers):
    inst, calls, ran = _deploy_inspire(ns, tmp_path)
    _answers(inst, ran, **answers)
    runner = _DirRunner([{"exit": 0}] * len(spaces), [{"genie_space.json": _definition(s)} for s in spaces])
    fields = inst._implement_genie_space(context or _output_context(ns), runner)
    return inst, calls, ran, runner, fields


def _logged(inst, level, needle):
    return [m for lv, m in inst.logger.records if lv == level and needle in m]


def test_a_sample_question_whose_example_sql_returns_rows_is_kept(agent_ns, tmp_path):
    inst, calls, ran, runner, fields = _build(agent_ns, tmp_path, [_space((REASONS, REASONS_SQL))])
    assert len(runner.prompts) == 1 and _questions(_posted_space(calls)) == [ACT, REASONS]
    assert fields["_asset"]["sample_questions"] == [ACT, REASONS] and fields["_warnings"] == []
    assert REASONS_SQL in ran
    assert _logged(inst, "INFO", "[IMPLEMENT-GENIE-QUESTIONS] N01-U01: 2 of 2 sample questions have an example SQL that returns rows")


def test_a_sample_question_with_no_rows_goes_back_to_genie_with_the_tier_mix_and_its_replacement_ships(agent_ns, tmp_path):
    first, second = _space((REASONS, REASONS_SQL)), _space((SPREAD, SPREAD_SQL))
    inst, calls, ran, runner, fields = _build(agent_ns, tmp_path, [first, second], empty=("priority_tier = 'Act now' GROUP BY",))
    assert len(runner.prompts) == 2
    told = runner.prompts[1]
    assert (f"the example SQL for {REASONS!r} returned no rows on the real tables, so that sample question promises an answer the data "
            "does not hold: ask about what the rows hold now (the latest run has 0 rows at Act now, 0 rows at Review, 120 rows at "
            "Monitor), and test that its example SQL returns rows") in told
    posted = _posted_space(calls)
    assert _questions(posted) == [ACT, SPREAD] and REASONS not in _examples(posted)
    assert fields["_asset"]["sample_questions"] == [ACT, SPREAD]
    assert [c[:2] for c in calls].count(("POST", "/api/2.0/genie/spaces")) == 1, "no space is saved until each sample question has rows"


def test_a_genie_round_sent_back_runs_every_example_sql_again_instead_of_reusing_the_last_round(agent_ns, tmp_path):
    space = _space((REASONS, REASONS_SQL))
    inst, calls, ran, runner, fields = _build(agent_ns, tmp_path, [space, space], once=(REASONS_SQL,))
    assert len(runner.prompts) == 2 and "returned no rows on the real tables" in runner.prompts[1]
    assert ran.count(REASONS_SQL) == 2, "the second round queries the tables again, so rows that arrived since count"
    assert _questions(_posted_space(calls)) == [ACT, REASONS]
    assert [d.rsplit("/", 1)[1] for d in runner.dirs] == ["genie_agent_1", "genie_agent_2"], \
        "each round is its own Genie run in a fresh work folder with the failure appended, never a cached answer"
    assert runner.prompts[1].startswith(runner.prompts[0])


def test_a_sample_question_whose_example_sql_fails_on_the_last_round_is_dropped_and_the_drop_is_logged(agent_ns, tmp_path):
    space = _space((REASONS, f"SELECT reason_code FROM {RESULT}"))
    inst, calls, ran, runner, fields = _build(agent_ns, tmp_path, [space] * 3, failing=("reason_code",))
    assert len(runner.prompts) == 3
    assert f"the example SQL for {REASONS!r} failed: [UNRESOLVED_COLUMN] reason_code cannot be resolved" in runner.prompts[1]
    posted = _posted_space(calls)
    assert _questions(posted) == [ACT] and _examples(posted) == [ACT], "the failing question and its example SQL both leave the space"
    assert fields["_asset"]["sample_questions"] == [ACT] and fields["_warnings"] == []
    (dropped,) = _logged(inst, "WARNING", "[IMPLEMENT-GENIE-QUESTIONS] N01-U01: dropped 1 sample question of 2")
    assert f"{REASONS!r} (its example SQL failed: [UNRESOLVED_COLUMN] reason_code cannot be resolved)" in dropped
    assert _logged(inst, "INFO", "1 of 1 sample question has an example SQL that returns rows")


def test_a_genie_agent_whose_every_sample_question_has_no_rows_is_never_saved(agent_ns, tmp_path):
    inst, calls, ran = _deploy_inspire(agent_ns, tmp_path)
    _answers(inst, ran, empty=("WHERE priority_tier = 'Act now'",))
    runner = _FileRunner([{"exit": 0}] * 3, [{"genie_space.json": _definition(_rich_space())}] * 3)
    with pytest.raises(Exception) as raised:
        inst._implement_genie_space(_output_context(agent_ns), runner)
    assert f"the example SQL for {ACT!r} returned no rows on the real tables" in str(raised.value)
    assert ("POST", "/api/2.0/genie/spaces") not in [c[:2] for c in calls]


def test_a_users_question_with_no_rows_stays_word_for_word_with_a_warning(agent_ns, tmp_path):
    context = _output_context(agent_ns, genie_questions=[REASONS])
    inst, calls, ran, runner, fields = _build(agent_ns, tmp_path, [_space((REASONS, REASONS_SQL))], context=context,
                                              empty=("priority_tier = 'Act now' GROUP BY",))
    assert len(runner.prompts) == 1, "a question the user asked for is never sent back for having no rows"
    assert _questions(_posted_space(calls)) == [ACT, REASONS]
    warning = agent_ns["implement_unproven_question_warning"]("Genie Agent", REASONS, agent_ns["IMPLEMENT_QUESTION_NO_ROWS"])
    assert fields["_warnings"] == [warning]
    assert warning == (f"Genie Agent: your question {REASONS!r} stays as you asked it, but its example SQL returned no rows on the real "
                       "tables, so its answer may say there is no data; ask it about what the results hold")
    assert _logged(inst, "WARNING", f"the user's question {REASONS!r} stays in the Genie Agent, but its example SQL returned no rows")


def test_the_genie_prompt_asks_for_sample_questions_whose_example_sql_returns_rows(agent_ns, tmp_path):
    inst, calls, ran, runner, fields = _build(agent_ns, tmp_path, [_space()])
    assert ("an example question SQL that answers each one and returns rows on the tables as they are now: a question about the records "
            "of a tier, such as Act now, needs such records in the latest run") in runner.prompts[0]
    assert "sends back, or drops, a question whose SQL returns no rows" in runner.prompts[0]


def test_question_triage_sends_back_before_the_last_round_and_drops_on_it(agent_ns):
    triage, user = agent_ns["implement_genie_question_triage"], agent_ns["implement_user_questions"]({}, ("genie_space",))
    proofs = [{"question": ACT, "rows": 1, "error": ""}, {"question": REASONS, "rows": 0, "error": ""},
              {"question": SPREAD, "rows": 0, "error": "boom"}]
    assert triage(proofs, user, False, " (mix)") == ([], [
        f"the example SQL for {REASONS!r} returned no rows on the real tables, so that sample question promises an answer the data does "
        "not hold: ask about what the rows hold now (mix), and test that its example SQL returns rows",
        f"the example SQL for {SPREAD!r} failed: boom"])
    assert triage(proofs, user, True) == (proofs[1:], [])
    assert triage(proofs[:1], user, False) == ([], []) and triage(proofs[:1], user, True) == ([], [])
    assert triage(proofs[1:], user, True) == (proofs[1:], [f"the example SQL for {REASONS!r} returned no rows on the real tables",
                                                            f"the example SQL for {SPREAD!r} failed: boom"])
    asked = agent_ns["implement_user_questions"]({"genie_questions": [f"  {REASONS.upper()} "]}, ("genie_space",))
    assert triage(proofs, asked, True) == ([proofs[2]], [])


def test_only_a_question_the_user_wrote_word_for_word_is_exempt(agent_ns):
    asked = agent_ns["implement_user_asked"]
    user = agent_ns["implement_user_questions"]({"genie_questions": [ACT], "genie_space_vibes": f"Add the question {SPREAD}"},
                                                ("genie_space",))
    assert asked(ACT, user) and asked(" ".join(SPREAD.lower().split()), user)
    assert not asked(REASONS, user), "a question the user never wrote is not exempt from the rows check"
    assert not asked("", user)
    app = agent_ns["implement_user_questions"]({"app_purpose": f"Let the team ask: {REASONS}"}, ("app",))
    assert asked(REASONS, app) and not asked(REASONS, agent_ns["implement_user_questions"]({"app_purpose": REASONS}, ("genie_space",)))


def test_the_tier_mix_names_every_tier_in_order_even_an_empty_one(agent_ns):
    mix = agent_ns["implement_tier_mix_text"]
    assert mix({"Monitor": 120}) == " (the latest run has 0 rows at Act now, 0 rows at Review, 120 rows at Monitor)"
    assert mix({"Act now": 1, "Review": 2, "Monitor": 3, "Other": 4}) == \
        " (the latest run has 1 row at Act now, 2 rows at Review, 3 rows at Monitor, 4 rows at Other)"
    assert mix({}) == "" and mix(None) == ""


def test_dropping_questions_removes_their_example_sql_and_keeps_the_rest(agent_ns):
    space = _space((REASONS, REASONS_SQL), (SPREAD, SPREAD_SQL))
    before = copy.deepcopy(space)
    agent_ns["implement_drop_genie_questions"](space, [{"question": f" {REASONS.lower()}"}])
    assert _questions(space) == [ACT, SPREAD] and _examples(space) == [ACT, SPREAD]
    assert space["instructions"]["text_instructions"] == before["instructions"]["text_instructions"]
    agent_ns["implement_drop_genie_questions"](space, [])
    assert _questions(space) == [ACT, SPREAD]


def test_ask_genie_keeps_proven_questions_drops_the_rest_and_fills_from_proven_ones(agent_ns):
    pick, user = agent_ns["implement_app_genie_questions"], agent_ns["implement_user_questions"]({}, ("app", "genie_space"))
    proofs = [{"question": ACT, "rows": 1, "error": ""}, {"question": REASONS, "rows": 0, "error": ""},
              {"question": SPREAD, "rows": 3, "error": ""}, {"question": "Who broke?", "rows": 0, "error": "boom"}]
    kept, dropped, unproven = pick(["Which store lost the most?", " which customers  ACT now? ", REASONS, "Who broke?"], proofs, [], user)
    assert kept == ["which customers ACT now?", SPREAD] and unproven == []
    assert dropped == [("Which store lost the most?", agent_ns["IMPLEMENT_QUESTION_NO_PROOF"]),
                       (REASONS, agent_ns["IMPLEMENT_QUESTION_NO_ROWS"]), ("Who broke?", "its example SQL failed: boom")]
    assert pick([], proofs, [SPREAD, ACT], user)[0] == [SPREAD, ACT], "the Genie Agent's recorded order fills Ask Genie"
    many = [{"question": f"q{i}", "rows": 1, "error": ""} for i in range(9)]
    assert pick([], many, [], user)[0] == ["q0", "q1", "q2", "q3"], "Ask Genie suggests at most IMPLEMENT_APP_GENIE_SUGGESTIONS"
    assert pick(None, [], [], user) == ([], [], [])
    told = agent_ns["implement_user_questions"]({"genie_questions": ["Which store lost the most?"]}, ("app", "genie_space"))
    kept, dropped, unproven = pick(["Which store lost the most?"], proofs, [], told)
    assert kept == ["Which store lost the most?", ACT, SPREAD] and dropped == []
    assert unproven == [("Which store lost the most?", agent_ns["IMPLEMENT_QUESTION_NO_PROOF"])]


def _app_genie(ns, tmp_path, questions, outputs=None, space=None):
    page = _churn_page(ns, questions=questions)
    inst, context, seen = _app_flow(ns, tmp_path, page=page, outputs=outputs, assets={"genie_space": "g1"},
                                    asset_status={"genie_space": {"sample_questions": [SPREAD, ACT]}})
    plain, reads = inst._implement_api, []
    answer = _genie_answer("g1", space or _genie_body([RESULT], ACT, "t"))

    def api(method, path, body=None, query=None):
        if (method, path) == ("GET", "/api/2.0/genie/spaces/g1"):
            reads.append(query)
            return answer
        return plain(method, path, body, query)

    inst._implement_api = api
    return inst, context, seen, reads


def _page(seen):
    return json.loads(seen["deployed"][0][1]["pages/n01_u01.json"])


def test_the_app_suggests_only_genie_agent_questions_whose_example_sql_returns_rows(agent_ns, tmp_path):
    space = _genie_body([RESULT], ACT, "t")
    space["config"]["sample_questions"].append({"question": [SPREAD]})
    space["instructions"]["example_question_sqls"].append({"question": [SPREAD], "sql": [SPREAD_SQL]})
    inst, context, seen, reads = _app_genie(agent_ns, tmp_path, ["Which store lost the most?", ACT], space=space)
    fields = inst._implement_app(context, None)
    assert seen["errors"] == [] and reads == [{"include_serialized_space": "true"}]
    assert _page(seen)["questions"] == [ACT, SPREAD], "the AI's own question is dropped and a proven one of the Genie Agent fills in"
    assert "_warnings" not in fields
    (dropped,) = _logged(inst, "WARNING", "[IMPLEMENT-APP-QUESTIONS] N01-U01: dropped 1 Ask Genie suggestion")
    assert f"'Which store lost the most?' ({agent_ns['IMPLEMENT_QUESTION_NO_PROOF']})" in dropped
    assert _logged(inst, "INFO", "[IMPLEMENT-APP-QUESTIONS] N01-U01: Ask Genie suggests 2 questions, 2 with an example SQL")


def test_the_app_reuses_the_proofs_of_the_genie_agent_built_in_the_same_run(agent_ns, tmp_path):
    inst, context, seen, reads = _app_genie(agent_ns, tmp_path, [REASONS, SPREAD])
    context["genie_proofs"] = [{"question": REASONS, "rows": 0, "error": ""}, {"question": SPREAD, "rows": 2, "error": ""}]
    inst._implement_app(context, None)
    assert reads == [], "proofs from the same run are reused, so the Genie Agent is not read again"
    assert _page(seen)["questions"] == [SPREAD]


def test_the_app_keeps_a_users_question_with_no_rows_and_warns(agent_ns, tmp_path):
    inst, context, seen, reads = _app_genie(agent_ns, tmp_path, [REASONS], outputs={"genie_questions": [REASONS]})
    context["genie_proofs"] = [{"question": REASONS, "rows": 0, "error": ""}, {"question": ACT, "rows": 2, "error": ""}]
    fields = inst._implement_app(context, None)
    assert _page(seen)["questions"] == [REASONS, ACT]
    assert agent_ns["implement_unproven_question_warning"]("App", REASONS, agent_ns["IMPLEMENT_QUESTION_NO_ROWS"]) in fields["_warnings"]


def test_an_unreadable_genie_agent_leaves_ask_genie_with_no_unproven_suggestion(agent_ns, tmp_path):
    inst, context, seen, reads = _app_genie(agent_ns, tmp_path, [REASONS])
    inst._implement_genie_read = lambda space_id: (_ for _ in ()).throw(RuntimeError("PERMISSION_DENIED on g1"))
    inst._implement_app(context, None)
    assert _page(seen)["questions"] == []
    assert _logged(inst, "WARNING", "[IMPLEMENT-APP-QUESTIONS] N01-U01: the Genie Agent g1 could not be read")


def test_the_app_prompt_lists_the_proven_genie_agent_questions(agent_ns, tmp_path):
    inst, context, seen, reads = _app_genie(agent_ns, tmp_path, [ACT])
    context["genie_proofs"] = [{"question": REASONS, "rows": 0, "error": ""}, {"question": SPREAD, "rows": 2, "error": ""}]
    inst._implement_app(context, None)
    assert (f"2 to 5 questions people would ask Ask Genie about this page, word for word from these sample questions of the Genie "
            f"Agent, each with an example SQL that returns rows: {SPREAD!r}; Ask Genie suggests only") in seen["prompt"]
    assert REASONS not in seen["prompt"]
    assert "Ask Genie suggests only a question whose example SQL in the Genie Agent returns rows" in seen["prompt"]
