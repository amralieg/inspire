import copy
import datetime
import json
import re

import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import VALID, _FakeRunner, _fill, _flow_inspire
from v142_scd_test import QUOTED, TABLE
from v143_vibes_test import _run
from v146_ai_reasoning_test import CATEGORIES, FLAGGED, _ai, _Explain
from v147_app_ai_test import RUN, AiWorkspace
from v148_asset_vibes_test import PARTS, _carrying, _llm, _locked, _vibed
from v141_app_shell_test import call
from v144_app_data_test import shell
from v144_app_chrome_test import RECORD, AskWorkspace, asked
from v148_app_hub_test import HISTORY_TYPES
import shell_core
import shell_sql

SUMMARY_QUOTED = "`main`.`inspire`.`churn_out_summary`"
CHECKS_SQL = f"SELECT summary, ai_checks FROM {SUMMARY_QUOTED} WHERE use_case_id = :uc AND run_id = :rid"
BRIEF = 'Use case N01-U05: Cut price loss\nThe user\'s directives for this use case, word for word: """Answer in plain words"""'
CHECKED = {"records": 12, "current": 9, "flagged": 3, "later": 0, "missing": 0, "one_level": None, "error": None,
           "kinds": {"hedged explanation": 2, "ai_cat_driver outside its values": 1}}


def _hedged(ns, text):
    return re.search(ns["INSPIRE_AI_HEDGE"], text) is not None


@pytest.mark.parametrize("text", [
    "It seems the deeper discount drove the margin loss.", "Sales appear to have dropped after the markdown.",
    "The shipping cost seems to be far too high.", "Apparently the price moved twice this week.",
    "Reply with one JSON object that follows every rule above.", "In the same style, the store lost 1,400 USD a week.",
    "As the person who acts on it, call the store manager.", "Your last reply was rejected, so here is the explanation.",
    "This shoe order has a shipping cost that seems far too high.", "The facts at the end show a drop, which the facts end with."])
def test_hedged_and_prompt_echo_text_is_rejected(agent_ns, text):
    assert _hedged(agent_ns, text), text


@pytest.mark.parametrize("text", [
    "Order 12 in Shoes has a shipping cost of 686, which looks far out of proportion for a light item.",
    "The item appears in 3 of 5 stores and lost 1,400 USD a week since the markdown.",
    "Call the store manager today and cut the discount to 20%.", "Margin fell 12.5% in 6 weeks, which could point to a pricing error.",
    "Confidence is High because 6 weeks of sales back the drop."])
def test_plain_business_text_passes_the_hedge_check(agent_ns, text):
    assert not _hedged(agent_ns, text), text


def _named_level(ns, text, level):
    found = re.search(ns["INSPIRE_AI_LEVEL_NAMED"], text)
    said = re.search(r"(?i)(high|medium|low)", found.group(0)).group(1).lower() if found else ""
    return said not in ("", level.lower())


@pytest.mark.parametrize("text,level,rejected", [
    ("Confidence is high because six weeks of sales back the drop.", "Medium", True),
    ("Low confidence, since only 2 weeks of sales exist.", "High", True),
    ("The confidence level is medium: 3 weeks of data.", "Low", True),
    ("Confidence is High because 6 weeks of sales back the drop.", "High", False),
    ("Medium confidence: the drop is clear but only 3 weeks old.", "Medium", False),
    ("The discount is high and the stock is low after 6 weeks.", "Medium", False),
    ("High because 40% of the weeks show the same loss.", "Low", False)])
def test_a_reason_that_names_another_level_is_rejected_and_the_record_s_own_level_passes(agent_ns, text, level, rejected):
    assert _named_level(agent_ns, text, level) is rejected, text


@pytest.mark.parametrize("text,rejected", [
    ("We are 80% confident the markdown drove it.", True), ("Confidence of 90% from 6 weeks of sales.", True),
    ("The confidence score is 0.82.", True), ("Confidence is 7 out of 10 after the drop.", True),
    ("Confidence is High because 40% of weeks show the loss.", False), ("Sales fell 12.5% in 6 weeks.", False)])
def test_a_confidence_given_as_a_number_is_rejected(agent_ns, text, rejected):
    assert (re.search(agent_ns["INSPIRE_AI_LEVEL_NUMBER"], text) is not None) is rejected, text


def test_every_ai_text_is_checked_for_another_level_and_a_numeric_confidence_in_sql(agent_ns):
    ai = _ai(agent_ns)
    checks = {label: (test, detail) for label, test, detail in agent_ns["inspire_ai_checks"](ai)}
    for key, column in agent_ns["INSPIRE_AI_TEXTS"]:
        label = key.replace("_", " ")
        test, detail = checks[f"{label} names another confidence level"]
        assert f"regexp_extract(coalesce(c.`{column}`, ''), " in test and "NOT IN ('', lower(coalesce(c.`confidence_level`, '')))" in test
        assert detail.startswith(f"regexp_extract(coalesce(c.`{column}`, ''), ")
        assert f"coalesce(c.`{column}`, '') RLIKE " in checks[f"{label} gives the confidence as a number"][0]
    labels = list(checks)
    assert labels[-1] == "ai_cat_driver outside its values" and labels.index("other option gives the confidence as a number") == len(labels) - 2
    sqlglot = pytest.importorskip("sqlglot")
    sqlglot.parse_one(agent_ns["inspire_ai_checked_sql"](TABLE, "_s", ai), read="databricks")


def test_rows_that_fail_after_the_repair_round_are_flagged_and_their_ai_text_is_cleared(agent_ns):
    ai = _ai(agent_ns)
    flag = agent_ns["inspire_ai_flag_sql"](TABLE, "_s", ai)
    assert "WHERE ai_problem_kind IS NOT NULL) AS c" in flag and "WHERE ai_problem_kind IS NULL)" not in flag
    for name in ("ai_explanation", "ai_confidence_reason", "ai_next_action", "ai_expected_result", "ai_other_option", "ai_evidence",
                 "ai_cat_driver"):
        assert f"`{name}` = NULL" in flag, name
    assert flag.endswith("`ai_check` = c.ai_problem_kind, ai_facts_hash = NULL")
    assert "t.ai_facts <=> c.ai_facts AND t.confidence_level <=> c.confidence_level" in flag
    update = agent_ns["inspire_ai_update_sql"](TABLE, "_s", ai)
    assert "WHERE ai_problem_kind IS NULL) AS c" in update and "`ai_check` = NULL, ai_facts_hash = sha2(" in update
    assert "`ai_check` = c.`ai_check`" not in update and "`ai_facts_hash` = c." not in update
    assert [n for n, _k in agent_ns["inspire_ai_columns"](ai)][-2:] == ["ai_check", "ai_cat_driver"]
    assert "ai_check" in agent_ns["INSPIRE_AI_NAMES"] and agent_ns["inspire_ai_owned"]("ai_check")


def test_the_run_flags_what_still_fails_after_one_retry_and_counts_it(agent_ns):
    retried = _Explain(needed=7, tallies=[[{"kind": "", "n": 5}, {"kind": "hedged explanation", "n": 2}],
                                          [{"kind": "", "n": 1}, {"kind": "hedged explanation", "n": 1}]],
                       status={"records": 7, "explained": 6, "flagged": 1, "levels": 2, "level": "High"})
    report, printed = retried.run(agent_ns, cap=4000)
    flags = [s for s in retried.spark.statements if s.startswith(f"MERGE INTO {QUOTED} ") and "ai_problem_kind IS NOT NULL" in s]
    assert len(flags) == 1, "one flag write, after the retry, for the rows that failed twice"
    assert report["kinds"] == {"hedged explanation": 1} and report["flagged"] == 1 and report["missing"] == 0
    assert "1 flagged in ai_check, with no AI reasoning shown, after failing Inspire's checks twice (1 hedged explanation)" in printed[-2]
    assert printed[-1] == ("AI reasoning: of the 7 current records flagged 'Act now' or 'Review' with facts, 6 hold AI reasoning, "
                           "1 flagged in ai_check")
    clean = _Explain(needed=3, tallies=[[{"kind": "", "n": 3}]])
    clean.run(agent_ns, cap=4000)
    assert not [s for s in clean.spark.statements if "ai_problem_kind IS NOT NULL) AS c" in s], "nothing is flagged when every reply passes"


def test_the_tally_names_one_level_on_every_record_and_records_left_with_nothing(agent_ns):
    flat = _Explain(needed=0, status={"records": 12, "explained": 12, "flagged": 0, "levels": 1, "level": "Medium"})
    report, printed = flat.run(agent_ns, cap=4000)
    assert report["one_level"] == "Medium" and report["records"] == 12 and not flat.created("work")
    assert printed[-1].startswith("AI reasoning: warning: all 12 'Act now' and 'Review' records have the confidence_level 'Medium'")
    few = _Explain(needed=0, status={"records": 9, "explained": 9, "flagged": 0, "levels": 1, "level": "High"})
    assert few.run(agent_ns, cap=4000)[0]["one_level"] is None, "nine records can share a level honestly"
    capped = _Explain(needed=50, tallies=[[{"kind": "", "n": 40}]], status={"records": 60, "explained": 45, "flagged": 0, "levels": 3})
    report, printed = capped.run(agent_ns, cap=40)
    assert (report["later"], report["missing"]) == (10, 5) and printed[-1].endswith(", 10 wait for the next runs, 5 hold neither")


def _after(ns, explain, endpoint="databricks-fast-a"):
    printed = []
    report = ns["inspire_ai_after_merge"](explain.spark, TABLE, "N01-U01", "r-2", ns["inspire_ai_config"](CATEGORIES, endpoint, "B"),
                                          4000, out=printed.append)
    saved = [s for s in explain.spark.statements if s.startswith(f"MERGE INTO {SUMMARY_QUOTED} ") and "`ai_checks` =" in s]
    return report, saved, printed


def _saved_checks(statement):
    return json.loads(re.search(r"THEN UPDATE SET `ai_checks` = '(\{.*?\})', updated_at", statement).group(1)
                      .replace("\\'", "'").replace("\\\\", "\\"))


def test_every_run_records_its_ai_checks_in_the_summary_table(agent_ns):
    report, saved, _printed = _after(agent_ns, _Explain(needed=7, tallies=[[{"kind": "", "n": 6}, {"kind": "hedged explanation", "n": 1}],
                                                                          [{"kind": "hedged explanation", "n": 1}]],
                                                        status={"records": 7, "explained": 6, "flagged": 1, "levels": 2}))
    assert len(saved) == 1 and _saved_checks(saved[0]) == {"records": 7, "current": 6, "flagged": 1, "later": 0, "missing": 0,
                                                           "one_level": None, "error": None, "kinds": {"hedged explanation": 1}}
    assert report["flagged"] == 1
    off = _Explain(needed=3)
    assert _after(agent_ns, off, endpoint="")[0] is None
    _r, saved, _p = _after(agent_ns, off, endpoint="")
    assert _saved_checks(saved[0])["error"] == "the ai_endpoint widget is empty"
    broken = _Explain(needed=3, fail="CREATE OR REPLACE TABLE")
    report, saved, printed = _after(agent_ns, broken)
    assert report is None and _saved_checks(saved[0])["error"].startswith("Inspire could not explain the records with databricks-fast-a: ")
    assert any("could not explain them with databricks-fast-a" in p for p in printed)


def test_the_summary_table_holds_the_ai_checks(agent_ns):
    created = agent_ns["inspire_ai_summary_create_sql"](TABLE)
    assert ", ai_checks STRING, " in created and created.endswith(", updated_at TIMESTAMP)")


def test_the_shared_summary_fixture_is_the_summary_table_the_runs_create(agent_ns):
    from v142_scd_test import SUMMARY
    created = agent_ns["inspire_ai_summary_create_sql"](TABLE).split(" (", 1)[1].rstrip(")")
    assert [tuple(part.rsplit(" ", 1)) for part in created.split(", ")] == [(n, k.upper()) for n, k in SUMMARY], \
        "a test copy of the summary schema that drifts from the runs makes every 'no ALTER' check lie"


def test_a_new_check_contract_explains_every_record_again_and_the_config_carries_the_user_s_directives(agent_ns):
    ai = agent_ns["inspire_ai_config"](CATEGORIES, "databricks-fast-a", "Use case N01-U01", "Treat enterprise accounts first")
    assert ai["version"] == agent_ns["INSPIRE_AI_PROMPT_VERSION"] == "4"
    assert ai["context"] == "Use case N01-U01\nTreat enterprise accounts first"
    assert ai["prompt"].index(agent_ns["INSPIRE_AI_USER_WINS"]) > ai["prompt"].index("Treat enterprise accounts first")
    assert agent_ns["INSPIRE_AI_USER_WINS"] in agent_ns["inspire_ai_summary_prompt"]("Use case N01-U01")
    assert agent_ns["inspire_ai_fingerprint"]("databricks-fast-a", ai["prompt"]) == ai["fingerprint"]


@pytest.mark.parametrize("checks,summary,expected", [
    (None, None, []),
    (dict(CHECKED, flagged=0, kinds={}), "Six records need action.", []),
    (CHECKED, "Six records need action.",
     ["3 of the 12 records flagged 'Act now' or 'Review' with facts failed Inspire's AI checks after one repair round, so they are flagged in "
      "ai_check and show no AI reasoning (2 hedged explanation, 1 ai_cat_driver outside its values)"]),
    (dict(CHECKED, flagged=0, kinds={}, missing=4), "s", ["4 records flagged 'Act now' or 'Review' with facts hold neither AI reasoning nor a flag"]),
    (dict(CHECKED, flagged=0, kinds={}, one_level="High"), "s",
     ["all 12 'Act now' and 'Review' records have the confidence_level 'High', so the rule that sets it reads too little evidence to "
      "tell them apart, such as the distance from the threshold or baseline, the history length or the data completeness"]),
    (dict(CHECKED, flagged=0, kinds={}, one_level="Low"), "s",
     ["all 12 'Act now' and 'Review' records have the confidence_level 'Low': either the evidence is weak for every one of them, such "
      "as a model that tests poorly or a short history, or the rule that sets it reads too little evidence to tell them apart, so "
      "read their facts to see which"]),
    ({"error": "the ai_endpoint widget is empty"}, None,
     ["the AI step of the run failed: the ai_endpoint widget is empty",
      "the run wrote no AI summary, so the App has no AI summary for it: the summary step passes its facts to "
      "inspire_write_summary(facts, result_table, run_id, as_of_date), which runs the ai_query that writes the summary, and never "
      "calls ai_query for the summary itself"]),
    (dict(CHECKED, flagged=0, kinds={}), "   ", ["the run wrote no AI summary, so the App has no AI summary for it: the summary step "
                                                 "passes its facts to inspire_write_summary(facts, result_table, run_id, as_of_date), "
                                                 "which runs the ai_query that writes the summary, and never calls ai_query for the "
                                                 "summary itself"])])
def test_the_build_turns_the_run_s_ai_checks_into_plain_problems(agent_ns, checks, summary, expected):
    assert agent_ns["implement_ai_check_problems"](checks, summary) == expected


def _checks_spark(rows=None, error=None):
    def respond(statement):
        if statement == CHECKS_SQL:
            if error:
                raise error
            return rows if rows is not None else []
        return []
    return FakeSpark(responder=respond)


def test_the_build_reads_the_ai_checks_of_the_run_it_previewed(agent_ns):
    inst = _flow_inspire(agent_ns, [])
    use_case, outcome = {"result_table": "main.inspire.churn_out"}, {"status": "written", "run_id": "r-1"}
    inst.spark = _checks_spark([{"summary": "ok", "ai_checks": json.dumps(CHECKED)}])
    assert inst._implement_ai_problems("N01-U01", use_case, outcome)[0].startswith("3 of the 12 records flagged 'Act now' or 'Review'")
    assert inst.spark.statements == [CHECKS_SQL]
    inst.spark = _checks_spark([{"summary": "ok", "ai_checks": "{oops"}])
    assert inst._implement_ai_problems("N01-U01", use_case, outcome) == [
        "the AI step of the run failed: the run recorded 5 characters in column ai_checks of "
        f"{agent_ns['inspire_ai_summary_table']('main.inspire.churn_out')}, and that value is not JSON, so Inspire cannot read its AI "
        "checks"]
    for spark in (_checks_spark([]), _checks_spark([{"summary": None, "ai_checks": None}]),
                  _checks_spark(error=RuntimeError("[UNRESOLVED_COLUMN] ai_checks"))):
        inst.spark = spark
        assert inst._implement_ai_problems("N01-U01", use_case, outcome) == [], "a notebook without the AI contract is not judged by it"
    assert inst.logger.matching("[IMPLEMENT-AI] N01-U01: could not read the AI checks of run r-1")
    inst.spark = _checks_spark([{"summary": "ok", "ai_checks": json.dumps(CHECKED)}])
    assert inst._implement_ai_problems("N01-U01", {}, outcome) == [] and inst._implement_ai_problems("N01-U01", use_case, {}) == []


def _preview(run_id):
    return ({"status": "written", "rows_written": 40, "run_id": run_id}, 11, 100)


def _fill_preview(ns, previews, checks_by_run, refill=True, rounds=3):
    inst = _flow_inspire(ns, previews)
    runs = {}

    def respond(statement):
        if statement == CHECKS_SQL:
            return [checks_by_run[runs["last"]]]
        return []

    real = inst._implement_ai_findings
    inst._implement_ai_findings = lambda uc_id, use_case, outcome: runs.update(last=outcome.get("run_id")) or real(uc_id, use_case, outcome)
    inst.spark = FakeSpark(responder=respond)
    runner = _FakeRunner([{"exit": 0, "final": _fill()} for _ in range(rounds)])
    spec = ns["validate_implement_spec"](VALID)[0]
    outcome, _job, _fill_out = inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), {"result_table": "main.inspire.churn_out"},
                                                                spec, None, "/W/nb", ["result_table", "run_profile"], runner, refill)
    return outcome, runner, inst


BAD = {"summary": "ok", "ai_checks": json.dumps(CHECKED)}
GOOD = {"summary": "ok", "ai_checks": json.dumps(dict(CHECKED, flagged=0, kinds={}))}


def test_a_preview_whose_ai_output_fails_goes_back_to_genie_once_and_a_clean_retry_ships_without_warnings(agent_ns):
    outcome, runner, inst = _fill_preview(agent_ns, [_preview("r-1"), _preview("r-2")], {"r-1": BAD, "r-2": GOOD})
    assert outcome == {"status": "written", "rows_written": 40, "run_id": "r-2"} and len(runner.prompts) == 2
    assert "the run's AI output failed Inspire's checks: 3 of the 12 records flagged 'Act now' or 'Review'" in runner.prompts[1]
    assert "The user's Implementation Choices still win over this." in runner.prompts[1]
    assert "Inspire checked your last attempt" not in runner.prompts[1]
    assert any("sent back to Genie" in str(e.get("message")) for e in inst.emitted)


def test_ai_output_that_still_fails_goes_back_while_a_round_is_left_and_the_last_round_ships_it_as_unfixed(agent_ns):
    outcome, runner, _inst = _fill_preview(agent_ns, [_preview("r-1"), _preview("r-2"), _preview("r-3")],
                                           {"r-1": BAD, "r-2": BAD, "r-3": BAD})
    assert len(runner.prompts) == 3, "every round Genie has left gets the AI output to fix"
    assert outcome["run_id"] == "r-3" and outcome["ai_problems"][0].startswith("3 of the 12 records flagged 'Act now' or 'Review' with facts")
    assert outcome["ai_fixable"] is True and outcome["gate_rounds"] == 3
    plain, runner, _inst = _fill_preview(agent_ns, [_preview("r-1")], {"r-1": BAD}, refill=False, rounds=0)
    assert runner.prompts == [] and plain["ai_problems"] and plain["gate_rounds"] == 0, \
        "a preview with no Genie build ships its AI problems as warnings that ask for a new build"
    last, runner, _inst = _fill_preview(agent_ns, [_preview("r-1"), _preview("r-2"), _preview("r-3")],
                                        {"r-1": {"summary": "ok", "ai_checks": None}, "r-2": {"summary": "ok", "ai_checks": None},
                                         "r-3": BAD}, rounds=3)
    assert len(runner.prompts) == 1 and "ai_problems" not in last, "a run without recorded checks is not sent back"
    late, runner, _inst = _fill_preview(agent_ns, [({"status": "failed", "error": "AnalysisException: x"}, 11, 100), _preview("r-2"),
                                                   _preview("r-3")], {"r-2": BAD, "r-3": dict(GOOD, summary="ok")}, rounds=3)
    assert len(runner.prompts) == 3 and "ai_problems" not in late, \
        "round 3 is never left unused: the AI output that failed on round 2 goes back to Genie"


REASON_SQL = re.compile(r"^SELECT nothing_to_act, not_reliable FROM `main`\.`inspire`\.`churn_out_summary` WHERE use_case_id = 'N01-U01' "
                        r"AND run_id = '([^']+)'$")
GIVEN = "the price response is not significant in any category (q-value 0.31 to 0.92), and a significant one would change that"


def _reason_preview(ns, previews, reasons, refill=True, rounds=3):
    inst = _flow_inspire(ns, previews)
    asked = []

    def respond(statement):
        found = REASON_SQL.match(" ".join(statement.split()))
        if not found:
            return []
        asked.append(found.group(1))
        return [{"nothing_to_act": reasons[found.group(1)]}] if found.group(1) in reasons else []

    inst.spark = FakeSpark(responder=respond)
    runner = _FakeRunner([{"exit": 0, "final": _fill()} for _ in range(rounds)])
    spec = ns["validate_implement_spec"](VALID)[0]
    outcome, _job, _fill_out = inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), {"result_table": "main.inspire.churn_out"},
                                                                spec, None, "/W/nb", ["result_table", "run_profile"], runner, refill)
    return outcome, runner, inst, asked


def test_a_preview_that_puts_every_record_in_monitor_without_its_reason_goes_back_to_genie_and_the_reason_ships_without_a_caution(agent_ns):
    untested = agent_ns["INSPIRE_NOTHING_TO_ACT_UNTESTED"]
    outcome, runner, inst, asked = _reason_preview(agent_ns, [_preview("r-1"), _preview("r-2")], {"r-1": untested, "r-2": GIVEN})
    assert outcome == {"status": "written", "rows_written": 40, "run_id": "r-2"} and len(runner.prompts) == 2 and asked == ["r-1", "r-2"]
    assert "no row of run r-1 reached 'Act now' or 'Review', and the run gave no nothing_to_act" in runner.prompts[1]
    assert "Keep the decision test and its thresholds as they are" in runner.prompts[1], "Genie never loosens the test to pass"
    assert "The user's Implementation Choices still win over this." in runner.prompts[1]
    assert any(e.get("message") == "the preview run put every record in Monitor without saying why, sent back to Genie to give the reason"
               for e in inst.emitted)


@pytest.mark.parametrize("reason", ["<flagged>", "<empty>", GIVEN, None])
def test_a_run_that_gave_its_reason_or_whose_reason_is_inspires_own_is_never_sent_back(agent_ns, reason):
    text = {"<flagged>": agent_ns["INSPIRE_NOTHING_TO_ACT_FLAGGED"] + ", most often: too few sales rows.",
            "<empty>": agent_ns["INSPIRE_NOTHING_TO_ACT_EMPTY"]}.get(reason, reason)
    outcome, runner, _inst, asked = _reason_preview(agent_ns, [_preview("r-1")], {"r-1": text})
    assert outcome["run_id"] == "r-1" and len(runner.prompts) == 1 and asked == ["r-1"]


def test_the_reason_is_asked_for_only_while_genie_has_a_round_left_and_never_without_a_genie_build(agent_ns):
    untested = agent_ns["INSPIRE_NOTHING_TO_ACT_UNTESTED"]
    last, runner, _inst, asked = _reason_preview(agent_ns, [_preview("r-1"), _preview("r-2"), _preview("r-3")],
                                                 {run: untested for run in ("r-1", "r-2", "r-3")})
    assert last["run_id"] == "r-3" and len(runner.prompts) == 3 and asked == ["r-1", "r-2", "r-3"], \
        "the last round still ships its run, with the missing reason as a defect Genie could not fix"
    assert last["gate_rounds"] == 3 and last["gate_problems"][0].startswith("no row of run r-3 reached 'Act now' or 'Review'")
    plain, runner, _inst, asked = _reason_preview(agent_ns, [_preview("r-1")], {"r-1": untested}, refill=False, rounds=0)
    assert plain["run_id"] == "r-1" and runner.prompts == [] and asked == ["r-1"] and plain["gate_rounds"] == 0
    nameless, runner, _inst, asked = _reason_preview(agent_ns, [({"status": "written", "rows_written": 40}, 11, 100)], {})
    assert len(runner.prompts) == 1 and asked == [], "a run that returned no run_id is never looked up"


STALE_SQL = re.compile(r"^SELECT COUNT\(\*\) AS n, .* FROM `main`\.`inspire`\.`churn_out` WHERE use_case_id = 'N01-U01' "
                       r"AND run_id = '([^']+)' AND as_of_date <= TRY_CAST\(regexp_extract\(data_quality_flag, 'data ends \(")
DATA_END = datetime.date(2016, 2, 29)


def _stale_preview(ns, previews, stale, refill=True, rounds=3, fail=False):
    inst = _flow_inspire(ns, previews)
    asked = []

    def respond(statement):
        found = STALE_SQL.match(statement)
        if not found:
            return []
        asked.append(found.group(1))
        if fail:
            raise RuntimeError("TABLE_OR_VIEW_NOT_FOUND")
        return [stale[found.group(1)]] if found.group(1) in stale else []

    inst.spark = FakeSpark(responder=respond)
    runner = _FakeRunner([{"exit": 0, "final": _fill()} for _ in range(rounds)])
    spec = ns["validate_implement_spec"](VALID)[0]
    outcome, _job, _fill_out = inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), {"result_table": "main.inspire.churn_out"},
                                                                spec, None, "/W/nb", ["result_table", "run_profile"], runner, refill)
    return outcome, runner, inst, asked


def test_a_preview_that_flags_rows_data_ends_on_data_that_runs_to_their_as_of_date_goes_back_to_genie_with_the_numbers(agent_ns):
    flagged = {"n": 21504, "ends": DATA_END, "as_of": DATA_END}
    outcome, runner, inst, asked = _stale_preview(agent_ns, [_preview("r-1"), _preview("r-2")], {"r-1": flagged})
    assert outcome == {"status": "written", "rows_written": 40, "run_id": "r-2"} and len(runner.prompts) == 2 and asked == ["r-1", "r-2"]
    sent = runner.prompts[1]
    assert ("run r-1 wrote 21504 rows with a data_quality_flag that starts with data ends and is dated on or after the as_of_date "
            "of its row, so the staleness check measured to today") in sent
    assert str(DATA_END) not in sent and not any(str(DATA_END) in str(e) for e in inst.emitted), "the dates the rows hold never leave the agent"
    assert ("Measure staleness_cadences from the newest data to the run's as_of_date and never to today, as the Acceptance and Stop "
            "Rule section says") in sent
    assert "Keep every other check, threshold and step as it is." in sent, "Genie never drops a check to clear the flag"
    assert "The user's Implementation Choices still win over this." in sent
    assert any(e.get("message", "").startswith("the preview run flagged 21504 rows with a data ends flag dated on or after the "
                                                "as_of_date of its row") for e in inst.emitted)


@pytest.mark.parametrize("found", [{"n": 0, "ends": None, "as_of": None}, None])
def test_a_run_whose_rows_carry_no_contradicting_data_ends_flag_is_never_sent_back(agent_ns, found):
    outcome, runner, _inst, asked = _stale_preview(agent_ns, [_preview("r-1")], {"r-1": found} if found else {})
    assert outcome["run_id"] == "r-1" and len(runner.prompts) == 1 and asked == ["r-1"]


def test_the_staleness_check_runs_only_while_genie_has_a_round_left_and_a_failed_read_never_breaks_the_build(agent_ns):
    flagged = {"n": 3, "ends": DATA_END, "as_of": DATA_END}
    last, runner, _inst, asked = _stale_preview(agent_ns, [_preview("r-1"), _preview("r-2"), _preview("r-3")],
                                                {run: flagged for run in ("r-1", "r-2", "r-3")})
    assert last["run_id"] == "r-3" and len(runner.prompts) == 3 and asked == ["r-1", "r-2", "r-3"]
    assert last["gate_problems"] == ["run r-3 wrote 3 rows with a data_quality_flag that starts with data ends and is dated on or after "
                                     "the as_of_date of its row, so the staleness check measured to today, not to the as_of_date"]
    plain, runner, _inst, asked = _stale_preview(agent_ns, [_preview("r-1")], {"r-1": flagged}, refill=False, rounds=0)
    assert plain["run_id"] == "r-1" and runner.prompts == [] and asked == ["r-1"] and plain["gate_rounds"] == 0
    nameless, runner, _inst, asked = _stale_preview(agent_ns, [({"status": "written", "rows_written": 40}, 11, 100)], {})
    assert len(runner.prompts) == 1 and asked == []
    broken, runner, inst, asked = _stale_preview(agent_ns, [_preview("r-1")], {}, fail=True)
    assert broken["run_id"] == "r-1" and len(runner.prompts) == 1 and asked == ["r-1"]
    assert any(level == "WARNING" and "[IMPLEMENT-STALE-FLAG] N01-U01: could not read the data_quality_flag of run r-1" in message
               for level, message in inst.logger.records)


def test_failed_ai_checks_make_the_build_ready_with_warnings_and_mark_the_ai_reasoning_part(agent_ns):
    columns = [{"col_name": n, "data_type": "string"} for n in ("entity_id", "ai_explanation", "ai_check")]
    sample = [{"record_key": "c1", "ai_explanation": "The store lost 1,400 USD a week."}]
    inst, previous = _locked(agent_ns, None, lambda s: sample if "ai_explanation IS NOT NULL" in s else columns
                             if s == "DESCRIBE TABLE `main`.`inspire`.`churn_out`" else [])
    _carrying(inst, dict(PARTS, ai_reasoning={"state": "ready", "spec_version": 2, "title": "AI reasoning"}))
    inst._implement_refresh_run_controls = lambda *a: None
    inst._implement_keep_edits_setting = lambda *a, **k: None
    inst._implement_missing_tables = lambda tables: []
    inst._implement_role_problems = lambda spec, uc: []
    problems = ["3 of the 12 records flagged 'Act now' or 'Review' with facts failed Inspire's AI checks after one repair round"]
    inst._implement_fill_and_preview = lambda *a: ({"status": "written", "rows_written": 40, "run_id": "r-9", "ai_problems": problems}, 77, {})
    inst._implement_result_history = lambda *a: None
    inst._implement_fallback_warning = lambda *a: ""
    inst._implement_tier_warning = lambda *a: ""
    _llm(inst)
    assert _run(inst, _vibed(previous, ["ai_reasoning"])) == "ready_with_warnings"
    last = inst.updates[-1]
    assert f"AI reasoning: {problems[0]}" in last["status_message"]
    assert last["asset_status"]["ai_reasoning"]["state"] == "ready_with_warnings"
    assert last["asset_status"]["ai_reasoning"]["warnings"] == problems


def test_the_app_and_the_notebook_share_the_ai_contract(agent_ns):
    assert "ai_check" in shell_sql.AI_COLUMNS
    assert shell_core.USER_WINS == agent_ns["INSPIRE_AI_USER_WINS"]
    assert shell_core.CONFIDENCE_LEVELS == agent_ns["INSPIRE_CONFIDENCE_LEVELS"]
    fields = {f["name"]: f for f in shell_sql.change_fields([{"name": "ai_check", "type": "STRING"}])}
    assert (fields["ai_check"]["role"], fields["ai_check"]["editable"]) == ("ai", False)


def _record_context(**changes):
    return dict(copy.deepcopy(RECORD), **changes)


def test_a_record_explain_carries_the_notebook_s_level_and_asks_only_for_its_reason():
    text = shell_core.explain_question("Pricing desk", {"title": "T"}, "record", "Item 1",
                                       _record_context(confidence="Low", facts="weeks of sales: 2\nloss a week: 1,400 USD"))
    assert ("Recommended action: Cut the discount to 10%.\nConfidence level: Low, set by the use case's evidence rule from the record's "
            "facts.\nFacts behind it: weeks of sales: 2; loss a week: 1,400 USD\n" + shell_core.LEVEL_ASK + "\nIts fields:") in text
    for odd in ("Very high", "", None, 3):
        assert "Confidence level" not in shell_core.explain_question("Pricing desk", {"title": "T"}, "record", "Item 1",
                                                                     _record_context(confidence=odd, facts="x: 1")), odd
    bare = shell_core.explain_question("Pricing desk", {"title": "T"}, "record", "Item 1", _record_context(confidence="High"))
    assert "Facts behind it" not in bare and "Confidence level: High," in bare and shell_core.LEVEL_ASK in bare


def _ai_shell(tmp_path, config):
    return shell(tmp_path, ws=AiWorkspace(summary=dict(RUN, ai_config=json.dumps(config))))


def test_every_app_question_to_genie_carries_the_user_s_directives_first(tmp_path):
    s, ws, _made = _ai_shell(tmp_path, {"categories": {}, "context": BRIEF})
    status, out = call(s, "POST", "genie/explain", body={"kind": "record", "page": "n01_u05", "title": "Item 1",
                                                         "context": _record_context(confidence="Medium", facts="weeks: 3")})
    assert status == 200
    head, rest = out["question"].split(shell_core.USER_WINS + "\n", 1)
    assert head.endswith(BRIEF + "\n") and head.startswith('Explain a record from the App "Pricing desk"')
    assert rest.startswith(shell_core.DATA_NOTE + '\nThe record "Item 1".') and "Confidence level: Medium," in rest
    assert ws.genie[-1][1] == out["question"]
    status, out = call(s, "POST", "genie/explain", body={"kind": "chart", "page": "n01_u05", "title": "Loss", "context": {"rows": []}})
    assert status == 200 and BRIEF + "\n" + shell_core.USER_WINS + "\n" in out["question"]
    (tmp_path / "plain").mkdir()
    s, _ws, _made = _ai_shell(tmp_path / "plain", {"categories": {}})
    status, out = call(s, "POST", "genie/explain", body={"kind": "chart", "page": "n01_u05", "title": "Loss", "context": {"rows": []}})
    assert status == 200 and shell_core.USER_WINS not in out["question"], "no directives, no preamble"


class _BriefAsk(AskWorkspace):
    def run_sql(self, warehouse, sql, params, limit=5000):
        if "_summary`" in sql:
            self.sql.append((sql, params, limit))
            return {"columns": [], "rows": [{"currency": "USD", "ai_config": json.dumps({"context": BRIEF})}], "truncated": False}
        return super().run_sql(warehouse, sql, params, limit)


def test_a_question_about_one_record_carries_the_user_s_directives_before_the_record(tmp_path):
    (status, out), ws, _made = asked(tmp_path, ws=_BriefAsk())
    assert status == 200
    head, rest = out["question"].split(shell_core.USER_WINS + "\n", 1)
    assert head.startswith("A question about one record of the App") and head.endswith(BRIEF + "\n")
    assert rest.startswith(shell_core.DATA_NOTE + '\nThe record "Item 42", as the App read it just now:')
    assert sum("_summary`" in sql and "AS `stamp_us`" not in sql for sql, _p, _l in ws.sql) == 1


def test_a_bad_explain_is_refused_before_any_warehouse_query(tmp_path):
    s, ws, _made = _ai_shell(tmp_path, {"categories": {}, "context": BRIEF})
    assert call(s, "POST", "genie/explain", body={"kind": "record", "page": "n01_u05", "title": "Item 1", "context": {"fields": ["a"]}}) == (
        400, {"error": "the context fields must be an object of label to value"})
    assert call(s, "POST", "genie/explain", body={"kind": "chart", "page": "n01_u05", "title": "Loss", "context": {},
                                                  "conversation_id": "../x"}) == (400, {"error": "the conversation_id is not one Genie returned"})
    assert not ws.queries("loss_desk_out_summary") and ws.genie == []


LISTED = {"record_key", "entity_id", "entity_label", "priority_tier", "rank"}
NAMES = ("record_key", "entity_id", "entity_label", "priority_tier", "rank", "ai_explanation", "confidence_level", "ai_cat_driver",
         "valid_from", "valid_to", "is_current", "change_source", "changed_by")


def _context(types, columns=LISTED, page=None):
    from v142_edits_test import edit_page
    fields = None if types is None else shell_sql.change_fields([{"name": n, "type": types(n)} for n in NAMES])
    return shell_sql.list_context(page or edit_page(), columns, fields, False)


def _ai_error(context):
    from v142_edits_test import edit_page
    with pytest.raises(ValueError) as refused:
        shell_sql.list_request(edit_page(), {"ai": {"ai_cat_driver": ["Price"]}}, context)
    return str(refused.value)


def test_an_ai_filter_on_a_list_that_reads_no_ai_reasoning_names_why_instead_of_none():
    contract = lambda n: HISTORY_TYPES.get(n, "STRING")
    assert _context(contract)["categories"] == ["ai_cat_driver"] and _context(contract)["unjoined"] == ""
    untyped = _context(lambda n: "STRING")
    assert (untyped["categories"], untyped["unjoined"]) == (["ai_cat_driver"], ""), \
        "the App reads the result table it built as it is and never checks the types of its history columns"
    assert _ai_error(_context(None)).endswith("since it reads no AI reasoning from the result table: the App could not read the result "
                                              "table's columns")
    assert _ai_error(_context(contract, columns={"entity_label"})).endswith(
        "the decision list selects neither record_key nor its key entity_id from the result table")
    from v142_edits_test import edit_page
    bare = edit_page()
    bare.pop("result_table")
    assert _ai_error(_context(contract, page=bare)).endswith("from the result table: the page names no result table")
    plain = shell_sql.change_fields([{"name": n, "type": HISTORY_TYPES.get(n, "STRING")} for n in NAMES if not n.startswith("ai_")])
    assert _ai_error(shell_sql.list_context(edit_page(), LISTED, plain, False)) == (
        "the decision list has no AI category 'ai_cat_driver'; its AI categories: none"), "a versioned table without AI columns has no reason to give"


def test_the_brief_is_cut_to_its_cap_and_kept_whole_below_it():
    assert shell_core.brief_lines("") == [] and shell_core.brief_lines("  ") == []
    assert shell_core.brief_lines("a" * shell_core.BRIEF_CHARS) == ["a" * shell_core.BRIEF_CHARS, shell_core.USER_WINS]
    cut = shell_core.brief_lines("b" * (shell_core.BRIEF_CHARS + 5))[0]
    assert len(cut) == shell_core.BRIEF_CHARS and cut.endswith("…")
