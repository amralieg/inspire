import ast
import re
import types

import pytest

from v120_artifacts_support import FakeSpark
from v120_genie_support import build_inspire, make_uc
from v142_scd_test import CORE, GOOD_PROFILE, HISTORY, QUOTED, QUOTED_STAGE, STAGE, TABLE, _describe, _Frame

CATEGORIES = {"ai_cat_driver": {"meaning": "what moved the record most", "values": ["Price", "Volume", "Mix"]}}
FLAGGED = [("use_case_id", "string"), ("record_key", "string"), ("priority_tier", "string"), ("rank", "int"),
           ("ai_facts", "string"), ("confidence_level", "string"), ("is_current", "boolean"), ("change_source", "string"),
           ("ai_explanation", "string"), ("ai_confidence_reason", "string"), ("ai_facts_hash", "string"),
           ("ai_cat_driver", "string")]
WORK = re.compile(r"^`main`\.`inspire`\.`churn_out_inspire_ai_[0-9a-f]{12}_(work|reply|checked)`$")


def _ai(ns, endpoint="databricks-fast-a"):
    return ns["inspire_ai_config"](CATEGORIES, endpoint, "Business: Acme")


class _Explain:
    def __init__(self, needed, tallies=None, fail=None, schema=FLAGGED, status=None):
        self.needed, self.tallies, self.fail, self.schema = needed, list(tallies or []), fail, schema
        self.status = status or {"records": needed, "explained": needed, "levels": 3, "level": "High"}
        self.spark = FakeSpark(responder=self.respond)

    def respond(self, statement):
        if self.fail and statement.startswith(self.fail):
            raise RuntimeError("[REMOTE_FUNCTION_HTTP_FAILED_ERROR] the endpoint is unavailable")
        if statement == f"DESCRIBE TABLE {QUOTED}":
            return _describe(self.schema)
        if statement.startswith("SELECT COUNT(*) AS n FROM ("):
            return [{"n": self.needed}]
        if statement.startswith("SELECT coalesce(ai_problem_kind, '') AS kind"):
            return self.tallies.pop(0) if self.tallies else [{"kind": "", "n": 1}]
        if statement.startswith("SELECT COUNT(*) AS records"):
            return [self.status]
        return []

    def run(self, ns, cap):
        printed = []
        report = ns["inspire_ai_explain"](self.spark, TABLE, "N01-U01", _ai(ns), cap, out=printed.append)
        return report, printed

    def created(self, part):
        return [s for s in self.spark.statements if re.match(rf"^CREATE (?:OR REPLACE )?TABLE `[^ ]*_{part}` AS ", s)]

    def drops(self):
        return [s.split("DROP TABLE IF EXISTS ", 1)[1] for s in self.spark.statements if s.startswith("DROP TABLE IF EXISTS")]


def test_only_current_act_now_and_review_records_with_facts_are_explained(agent_ns):
    need = agent_ns["inspire_ai_need_sql"](TABLE, "N01-U01", _ai(agent_ns), "priority_tier")
    assert "t.`priority_tier` IN ('Act now', 'Review')" in need and "Monitor" not in need, \
        "the AI explained every current row; only the flagged ones are worth a model call"
    assert "t.is_current AND t.change_source <> 'delete'" in need and "t.use_case_id = 'N01-U01'" in need
    assert "nullif(trim(t.ai_facts), '') IS NOT NULL" in need, "a record without facts has nothing to explain"
    assert "t.ai_facts_hash IS NULL OR t.ai_facts_hash <> sha2(" in need, "a record whose facts and level did not change keeps its reasoning"
    plain = _Explain(needed=5, schema=[c for c in FLAGGED if c[0] != "priority_tier"])
    report, printed = plain.run(agent_ns, cap=4000)
    assert report["needed"] == 0 and not plain.created("work") and "has no priority_tier column" in printed[0]


def test_a_run_explains_the_best_ranked_records_first_up_to_its_cap_and_names_the_rest(agent_ns):
    big = _Explain(needed=4100, tallies=[[{"kind": "", "n": 2000}], [{"kind": "", "n": 2000}]])
    report, printed = big.run(agent_ns, cap=agent_ns["INSPIRE_AI_AUTO_ROWS"])
    work = big.created("work")
    assert len(work) == 1 and "LIMIT 4000)" in work[0] and report["later"] == 100
    assert "ORDER BY CASE n.`priority_tier` WHEN 'Act now' THEN 0 WHEN 'Review' THEN 1 END, n.`rank` ASC NULLS LAST, " \
           "n.record_key" in work[0], "Act now before Review, then by rank"
    assert [s.count("WHERE ai_chunk = ") for s in big.created("reply")] == [1, 1]
    assert "WHERE ai_chunk = 0" in big.created("reply")[0] and "WHERE ai_chunk = 1" in big.created("reply")[1]
    assert "the next runs explain the other 100, at most 4000 per run like this one" in printed[0]
    preview = _Explain(needed=4100, tallies=[[{"kind": "", "n": 40}]])
    report, printed = preview.run(agent_ns, cap=agent_ns["INSPIRE_AI_PREVIEW_ROWS"])
    assert "LIMIT 40)" in preview.created("work")[0] and report["later"] == 4060 and len(preview.created("reply")) == 1
    small = _Explain(needed=7, schema=[c for c in FLAGGED if c[0] != "rank"])
    small.run(agent_ns, cap=4000)
    assert "ASC NULLS LAST" not in small.created("work")[0] and "LIMIT 7)" in small.created("work")[0]


def test_a_rejected_reply_is_asked_again_once_with_its_problem_and_the_rest_are_counted(agent_ns):
    retried = _Explain(needed=7, tallies=[[{"kind": "", "n": 5}, {"kind": "hedged explanation", "n": 2}],
                                          [{"kind": "", "n": 1}, {"kind": "hedged explanation", "n": 1}]])
    report, printed = retried.run(agent_ns, cap=4000)
    first, again = retried.created("reply")
    assert "Your last reply was rejected" not in first and "Your last reply was rejected (" in again and "w.ai_problem" in again
    assert re.search(r"FROM \(SELECT \* FROM `main`\.`inspire`\.`churn_out_inspire_ai_[0-9a-f]{12}_checked` "
                     r"WHERE ai_problem_kind IS NOT NULL\) AS w", again), "only the rejected records are asked again"
    assert report["explained"] == 6 and report["without"] == 1 and report["kinds"] == {"hedged explanation": 1}
    assert "1 flagged in ai_check, with no AI reasoning shown, after failing Inspire's checks twice (1 hedged explanation)" in printed[-2]


def test_the_work_tables_are_named_after_the_result_table_and_dropped_even_when_the_endpoint_fails(agent_ns):
    assert agent_ns["inspire_ai_work_table"](TABLE, "_inspire_ai_0123456789ab", "reply") == \
        "`main`.`inspire`.`churn_out_inspire_ai_0123456789ab_reply`"
    assert agent_ns["inspire_ai_summary_table"](QUOTED) == "main.inspire.churn_out_summary"
    done = _Explain(needed=3)
    done.run(agent_ns, cap=4000)
    assert sorted(re.sub(r"_[0-9a-f]{12}_", "_", d) for d in done.drops()) == [
        "`main`.`inspire`.`churn_out_inspire_ai_checked`", "`main`.`inspire`.`churn_out_inspire_ai_reply`",
        "`main`.`inspire`.`churn_out_inspire_ai_work`"]
    assert all(WORK.match(d) for d in done.drops()) and len({d.rsplit("_", 1)[0] for d in done.drops()}) == 1
    broken = _Explain(needed=3, fail="CREATE OR REPLACE TABLE")
    printed = []
    assert agent_ns["inspire_ai_after_merge"](broken.spark, TABLE, "N01-U01", "r-2", _ai(agent_ns), 4000, out=printed.append) is None
    assert len(broken.drops()) == 3 and all(WORK.match(d) for d in broken.drops()), "a failed run leaves no work table behind"
    assert any("wrote its rows, but Inspire could not explain them with databricks-fast-a" in p for p in printed)


def test_the_model_writes_only_the_reason_for_the_level_the_notebook_set(agent_ns):
    ai = _ai(agent_ns)
    prompt = ai["prompt"]
    assert '"confidence":' not in prompt and '"confidence_reason":' in prompt
    assert "naming the facts behind the record's confidence level, which the facts end with" in prompt
    assert "never change the level or give another one" in prompt
    reply = agent_ns["inspire_ai_reply_sql"]("SELECT 1", ai)
    assert agent_ns["inspire_ai_facts_sql"]("w") in reply and "'\nConfidence level: '" in reply
    assert "failOnError => false" in reply and "temperature" not in reply
    checked = agent_ns["inspire_ai_checked_sql"](TABLE, "_s", ai)
    assert ("'explanation STRING, confidence_reason STRING, next_action STRING, expected_result STRING, other_option STRING, "
            "ai_cat_driver STRING, evidence ARRAY<STRING>'") in checked
    assert "ai_confidence " not in checked and "AS ai_confidence," not in checked
    labels = [label for label, _test, _detail in agent_ns["inspire_ai_checks"](ai)]
    assert labels[:5] == ["endpoint error", "unreadable reply", "hedged explanation", "no confidence reason",
                          "hedged confidence reason"] and labels[-1] == "ai_cat_driver outside its values"
    hashed = agent_ns["inspire_ai_hash_sql"](ai["fingerprint"], "t")
    assert "coalesce(t.`confidence_level`, '')" in hashed and "coalesce(t.`ai_facts`, '')" in hashed, \
        "a record whose level changes is explained again"
    update = agent_ns["inspire_ai_update_sql"](TABLE, "_s", ai)
    assert "t.ai_facts <=> c.ai_facts AND t.confidence_level <=> c.confidence_level" in update
    assert "ai_confidence =" not in update and "`ai_confidence_reason` = c.`ai_confidence_reason`" in update
    assert [name for name, _kind in agent_ns["inspire_ai_columns"](ai)] == [
        "ai_explanation", "ai_confidence_reason", "ai_next_action", "ai_expected_result", "ai_other_option", "ai_evidence",
        "ai_facts_hash", "ai_check", "ai_cat_driver"]


def test_one_level_on_every_flagged_record_is_reported_as_a_rule_that_reads_too_little(agent_ns):
    flat = _Explain(needed=12, status={"records": 12, "explained": 12, "levels": 1, "level": "Medium"})
    _report, printed = flat.run(agent_ns, cap=4000)
    assert "warning: all 12 'Act now' and 'Review' records have the confidence_level 'Medium', so the rule that sets it" in printed[-1]
    low = _Explain(needed=12, status={"records": 12, "explained": 12, "levels": 1, "level": "Low"})
    said = low.run(agent_ns, cap=4000)[1][-1]
    assert "the confidence_level 'Low': either the evidence is weak for every one of them" in said
    assert ", so the rule that sets it" not in said, "an all-Low run may be a weak model, not a weak rule"
    varied = _Explain(needed=12, status={"records": 12, "explained": 12, "levels": 2, "level": "High"})
    assert "warning" not in varied.run(agent_ns, cap=4000)[1][-1]
    few = _Explain(needed=4, status={"records": 4, "explained": 4, "levels": 1, "level": "High"})
    assert "warning" not in few.run(agent_ns, cap=4000)[1][-1], "four records can share a level honestly"


def test_the_genie_rule_keeps_an_honest_all_low_and_never_moves_a_cut_off_only_to_spread_records(agent_ns):
    rule = agent_ns["GENIE_EXPLANATION_FACTS_RULE"]
    assert "check that the rule reads the evidence that differs between records" in rule
    assert "keep 'Low' and never move a cut-off only to spread the records" in rule
    assert "so fix it before the write" not in rule


def test_a_run_with_a_bad_level_or_a_flagged_row_without_facts_is_refused(agent_ns):
    columns = [name for name, _kind in FLAGGED]
    profile = agent_ns["inspire_run_profile_sql"](STAGE, columns)
    assert "COUNT_IF(`confidence_level` IS NULL OR `confidence_level` NOT IN ('High', 'Medium', 'Low')) AS bad_levels" in profile
    assert ("COUNT_IF(`priority_tier` IN ('Act now', 'Review') AND (`ai_facts` IS NULL OR TRIM(`ai_facts`) = '')) "
            "AS bare_flagged") in profile
    plain = agent_ns["inspire_run_profile_sql"](STAGE, [name for name, _kind in CORE])
    assert "bad_levels" not in plain and "bare_flagged" not in plain, "a notebook without AI facts is profiled as before"
    problems = agent_ns["inspire_run_problems"](dict(GOOD_PROFILE, bad_levels=2, bare_flagged=3))
    assert problems == ["2 rows have a confidence_level other than 'High', 'Medium', 'Low'; set it on every row with the "
                        "evidence rule",
                        "3 rows are 'Act now' or 'Review' with no ai_facts, the facts Inspire explains each flagged record from; "
                        "build the facts on every row"]
    assert agent_ns["inspire_run_problems"](dict(GOOD_PROFILE, bad_levels=0, bare_flagged=0)) == []
    staged = [c for c in CORE if c[0] != "explanation"] + [("ai_facts", "string")]
    spark = FakeSpark(responder=lambda s: _describe(staged) if s == f"DESCRIBE TABLE {QUOTED_STAGE}" else [])
    with pytest.raises(ValueError, match="the rows have no confidence_level column, and every row needs it"):
        agent_ns["inspire_merge_run"](spark, TABLE, STAGE, out=lambda *_a: None, ai=_ai(agent_ns))
    responses = {f"DESCRIBE TABLE {QUOTED_STAGE}": _describe(staged)}
    quiet = FakeSpark(responder=lambda s: responses.get(s) or ([dict(GOOD_PROFILE, row_count=0)] if s.startswith("SELECT COUNT(*)") else []))
    assert agent_ns["inspire_merge_run"](quiet, TABLE, STAGE, out=lambda *_a: None, ai=None) == 0, \
        "without AI the level is not required"


def test_a_preview_run_explains_at_most_its_preview_records_and_a_full_run_its_full_cap(fresh_ns):
    is_preview = fresh_ns["inspire_is_preview"]
    assert is_preview("preview") and is_preview(" Preview ")
    assert not is_preview("full") and not is_preview(" FULL ") and not is_preview("")
    caps = []
    fresh_ns["inspire_merge_run"] = lambda spark, table, stage, out=print, ai=None, ai_cap=None, value=None, nothing_to_act=None, accepted=None: \
        caps.append((ai, ai_cap)) or 3
    fresh_ns["AI_CATEGORIES"] = CATEGORIES
    fresh_ns["INSPIRE_RUN"] = {"ai_context": "Business: Acme"}
    for profile, expected in (("preview", fresh_ns["INSPIRE_AI_PREVIEW_ROWS"]), ("full", fresh_ns["INSPIRE_AI_AUTO_ROWS"])):
        widgets = {"run_profile": profile, "ai_endpoint": "databricks-fast-a"}
        fresh_ns["dbutils"] = types.SimpleNamespace(widgets=types.SimpleNamespace(get=widgets.__getitem__))
        frame = _Frame([("entity_id", "string"), ("ai_facts", "string"), ("confidence_level", "string")])
        assert fresh_ns["inspire_write_result"](frame, TABLE, spark_session=FakeSpark(), out=lambda *_a: None) == 3
        ai, cap = caps[-1]
        assert cap == expected and ai["endpoint"] == "databricks-fast-a" and ai["categories"] == CATEGORIES, profile
    fresh_ns["inspire_write_result"](_Frame([("entity_id", "string")]), TABLE, spark_session=FakeSpark(), out=lambda *_a: None)
    assert caps[-1][0] is None, "a notebook without ai_facts gets no AI step"
    template = fresh_ns["GENIE_RUN_CONTROLS_TEMPLATE"]
    assert 'preview = inspire_is_preview(parameters.get("run_profile", "full"))' in template
    assert "not in (\"\", \"full\")" not in template and fresh_ns["IMPLEMENT_RESULT_HISTORY_SOURCE"].count('not in ("", "full")') == 1


def test_the_run_summary_says_how_old_the_data_is_so_no_row_carries_it(fresh_ns):
    import datetime
    age, today = fresh_ns["inspire_data_age_fact"], datetime.date(2026, 10, 29)
    assert age("2016-06-30", today) == "The run is as of 2016-06-30, 3773 days before the day it ran."
    assert age(datetime.date(2026, 10, 28), today) == "The run is as of 2026-10-28, 1 day before the day it ran."
    assert age("2026-10-28 00:00:00", today) == "The run is as of 2026-10-28, 1 day before the day it ran."
    for fresh in ("2026-10-29", "2026-11-02", "latest", "", None, "2026-13-01", "soon"):
        assert age(fresh, today) == "", fresh
    asked = []

    def reply(statement):
        if "ai_query(" in statement:
            asked.append(statement)
            return [{"r": {"result": "Twelve zones need drivers now.", "errorMessage": None}}]
        return []

    printed = []
    summary = fresh_ns["inspire_write_summary"]({"act_now": "12 zones"}, TABLE, "r-1", "2016-06-30", spark_session=FakeSpark(responder=reply),
                                                endpoint="databricks-fast-a", context="", out=printed.append)
    assert summary == "Twelve zones need drivers now." and len(asked) == 1
    assert "The run is as of 2016-06-30, " in asked[0] and " days before the day it ran." in asked[0]
    fresh_ns["inspire_write_summary"]({"act_now": "12 zones"}, TABLE, "r-2", datetime.date.today().isoformat(),
                                      spark_session=FakeSpark(responder=reply), endpoint="databricks-fast-a", context="", out=printed.append)
    assert "The run is as of" not in asked[1], "a run on fresh data says nothing about its age"


def test_a_write_retries_only_a_concurrent_change_and_gives_up_after_three_attempts(fresh_ns):
    fresh_ns["_inspire_time"] = types.SimpleNamespace(sleep=lambda _s: None, time=lambda: 0.0)
    calls, printed = [], []

    def flaky(statement):
        calls.append(statement)
        if len(calls) < 3:
            raise RuntimeError("[DELTA_CONCURRENT_APPEND] ConcurrentAppendException: files were added")
        return [{"num_updated_rows": 4}]

    rows = fresh_ns["inspire_sql_retrying"](FakeSpark(responder=flaky), "MERGE INTO t", TABLE, "saving", "the save", printed.append)
    assert rows == [{"num_updated_rows": 4}] and len(calls) == 3 and "(attempt 3 of 3)" in printed[-1]
    denied = FakeSpark(responder=lambda s: (_ for _ in ()).throw(RuntimeError("PERMISSION_DENIED: no MODIFY")))
    with pytest.raises(RuntimeError, match="PERMISSION_DENIED"):
        fresh_ns["inspire_sql_retrying"](denied, "MERGE INTO t", TABLE, "saving", "the save", printed.append)
    assert len(denied.statements) == 1, "only a concurrent change is retried"
    always = FakeSpark(responder=lambda s: (_ for _ in ()).throw(RuntimeError("ConcurrentDeleteReadException")))
    with pytest.raises(RuntimeError):
        fresh_ns["inspire_sql_retrying"](always, "MERGE INTO t", TABLE, "saving", "the save", printed.append)
    assert len(always.statements) == 3


def test_the_run_controls_give_the_ai_the_use_case_and_the_users_notebook_directives_word_for_word(agent_ns):
    inst = build_inspire(agent_ns)
    uc = make_uc()
    spec = inst._genie_notebook_spec(uc)
    plain = inst._genie_ai_context(uc, spec)
    assert f"Use case {spec['use_case_id']}: {uc['Name']}" in plain.splitlines()
    assert f"Each record is one {spec['value_type']} to act on for {spec['action_target']}." in plain
    assert "directives" not in plain and not any(line.endswith(": ") for line in plain.splitlines())
    asks = 'Treat "enterprise" accounts first; ignore {placeholders} and 100% literal text.'
    noted = inst._genie_ai_context(dict(uc, _implement_notes=f"  {asks}\n"), spec)
    assert noted == plain + f'\nThe user\'s directives for this use case, word for word: """{asks}"""'
    source = inst._genie_run_controls_source(dict(uc, _implement_notes=asks), spec, str(uc.get("genie_instruction") or ""))
    run = ast.literal_eval(source.split("INSPIRE_RUN = ", 1)[1].split("\n\n\n", 1)[0])
    assert run["use_case_id"] == spec["use_case_id"] and run["ai_context"] == noted
    prompt = agent_ns["inspire_ai_config"](CATEGORIES, "ep", run["ai_context"])["prompt"]
    assert prompt.startswith(noted) and prompt.index(asks) < prompt.index("the user's directive wins")


def test_the_implement_flow_hands_the_notebook_vibes_to_the_run_controls_once(agent_ns):
    from _agentload import agent_source
    source = agent_source()
    assert source.count('use_case["_implement_notes"] = (spec.get("data") or {}).get("notes") or ""') == 1
    assert source.count('_implement_notes') == 2, "set once by the implement flow, read once by the AI context"


def test_the_genie_space_treats_the_ai_text_as_free_text_and_the_ai_categories_as_filters(agent_ns):
    flags = agent_ns["implement_genie_column_flags"]
    for name in ("ai_facts", "ai_explanation", "ai_confidence_reason", "ai_facts_hash"):
        assert flags(name, "string") == (False, False), name
    assert flags("ai_cat_driver", "string") == (True, True), "an AI category is a value people filter on"
    assert flags("confidence_level", "string") == (True, True)


def test_genie_writes_the_facts_and_the_level_and_never_explains_rows_itself(agent_ns):
    rule = agent_ns["GENIE_EXPLANATION_FACTS_RULE"]
    assert "so never call ai_query to explain rows and never write those columns" in rule
    assert "at most 4000 per run and 40 per preview run" in rule
    assert "ai_explanation, ai_confidence_reason, ai_next_action, ai_expected_result, ai_other_option, ai_evidence, ai_facts_hash" in rule
    assert "Define `AI_CATEGORIES` at top level, after the Parameters cell" in rule
    columns = [name for name, _kind in agent_ns["INSPIRE_CORE_COLUMNS"]]
    assert "ai_facts" in columns and "confidence_level" in columns and "explanation" not in columns
    history = agent_ns["GENIE_RESULT_HISTORY_RULE"]
    assert "hold Inspire's AI reasoning, which inspire_write_result writes" in history and "so the run's rows never set them" in history
    inst = build_inspire(agent_ns)
    spec = inst._genie_notebook_spec(make_uc())
    mandate = inst._build_code_structure_mandate(dict(spec, ai_endpoint="databricks-fast-a"))
    assert ("AI endpoint: `databricks-fast-a`. It is the default of the `ai_endpoint` widget, which inspire_write_result and "
            "inspire_write_summary use; a step of the method that calls ai_query itself calls it with failOnError => false and "
            "does not set a temperature.") in mandate
    assert "explanation_top_k" not in mandate and "explanation_top_k" not in agent_ns["GENIE_WIDGET_LABELS"]
    assert not {"inspire_filter_sql", "inspire_explain_request", "INSPIRE_EXPLANATION_TOP_K"} & set(agent_ns)
