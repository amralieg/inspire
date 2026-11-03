import json
import re
import types

import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import (CHURN_UC, VALID, _FakeRunner, _NotebookWorkspace, _cell, _fill, _flow_inspire, _inspire,
                                 _notebook_inspire, sdk_stub)  # noqa: F401
from v145_acceptance_test import _recovering, _spec
from v149_ai_output_checks_test import CHECKED, CHECKS_SQL, _preview

SUMMARY_CELL = '''def summarize(scored, window, candidate_metrics, baseline_metrics):
    print("Summary facts: " + "; ".join(keep_reasons([("Repurchase window: " + fmt_count(window, "day"), [window])])))
    prompt = ("Write exactly three plain-text sentences for the decision owner. State that the run scored "
              + fmt_count(len(scored), "customer") + ".")
    try:
        summary = spark.sql("SELECT ai_query(:endpoint, :prompt, failOnError => false).result AS result",
                            args={"endpoint": ai_endpoint, "prompt": prompt}).first()["result"]
        print(summary or "AI summary was unavailable.")
    except Exception as error:
        print(f"AI summary was unavailable: {error}")
'''
FIXED_SUMMARY_CELL = '''def summarize(scored, window, run_id, as_of_date):
    facts = "; ".join(keep_reasons([("Repurchase window: " + fmt_count(window, "day"), [window])]))
    print(inspire_write_summary(facts, result_table, run_id, as_of_date) or "No AI summary for this run")
'''
METHOD_AI_CELL = '''def label_tickets(tickets_sdf):
    return tickets_sdf.selectExpr("ticket_id", "ai_query('ep', concat('Label: ', body), failOnError => false).result AS label")
'''
EVIDENCE_SENTENCE = ("Last cell prints readiness values, candidate-vs-baseline metrics, rows written per priority tier, the ten "
                     "top-ranked rows, and a three-sentence `ai_query` summary for the Head of Campaigns.")
EVIDENCE_EXPLANATION = ("**explanation:** from `ai_query` for up to `explanation_top_k` (200) top-ranked 'Act now'/'Review' rows; "
                        "NULL otherwise.")

GROUPBY_LOOP = '''def build_features(purchases_pdf):
    rows = []
    for customer_sk, history_pdf in purchases_pdf.groupby("customer_sk"):
        rows.append({"customer_sk": customer_sk, "mean_gap": history_pdf["gap_days"].mean()})
    return pd.DataFrame(rows, columns=["customer_sk", "mean_gap"])
'''
UNIQUE_LOOP = '''def build_spend(purchases_pdf):
    spend = {}
    for customer_sk in purchases_pdf["customer_sk"].unique():
        own_pdf = purchases_pdf[purchases_pdf["customer_sk"] == customer_sk]
        spend[customer_sk] = own_pdf["day_spend"].sum()
    return spend
'''
COMPREHENSION_LOOP = '''def build_history(purchases_pdf):
    return pd.concat([history_features(g) for _, g in purchases_pdf.groupby("customer_sk")], ignore_index=True)
'''
WRAPPED_UNIQUE_LOOP = '''def build_last(purchases_pdf):
    last = []
    for customer_sk in sorted(np.unique(purchases_pdf["customer_sk"])):
        last.append(purchases_pdf.loc[purchases_pdf["customer_sk"] == customer_sk, "d_date"].max())
    return last
'''
EVIDENCE_ENRICH_AND_VALIDATE = '''def score_population(scored):
    def enrich(row):
        reasons = keep_reasons([(fmt_count(row["recency"], "day") + " since the last purchase", [row["recency"]])])
        return pd.Series([reasons, "Act in this cycle"])
    scored[["top_reasons", "recommended_action"]] = scored.apply(enrich, axis=1)
    return scored


def validate_and_write(scored):
    bad_key = re.compile(r"\\b(?:None|nan|NaT)\\b|<NA>")
    for index, row in scored.iterrows():
        for field in ("entity_id", "entity_label", "segment_or_item"):
            text = str(row[field])
            if bad_key.search(text):
                raise ValueError(f"Invalid {field} on row {index}: {text}")
'''
VECTORIZED_SPELLS = '''def build_spells(purchases_pdf, checks):
    groups = purchases_pdf.groupby("customer_sk", sort=False)
    purchases_pdf["gap_days"] = groups["d_date"].diff().dt.days
    purchases_pdf["purchase_count"] = groups.cumcount() + 1
    for name, measured, required in checks:
        print(f"Readiness {name}: measured={measured}, required={required}")
    for segment, segment_pdf in purchases_pdf.groupby("segment"):
        print(segment, len(segment_pdf))
    return purchases_pdf
'''


def test_the_instruction_prompt_says_every_pattern_writes_its_summary_through_inspire_write_summary(agent_ns):
    template = agent_ns["PROMPT_TEMPLATES"]["USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT"]
    assert ("for AI text processing, Databricks AI functions are the core method; for other patterns, the notebook never calls "
            "`ai_query`; in every pattern, `inspire_write_result` explains rows and `inspire_write_summary` writes the summary.") in template
    assert len(re.findall(r"\S+", template)) <= 1800, "the prompt keeps its word budget"
    assert "passes its facts to `inspire_write_summary`. End with the STOP RULE." in template


@pytest.mark.parametrize("family", ["A", "B", "C", "D", "E", "F", "G", "H"])
def test_the_platform_rules_say_the_summary_never_calls_ai_query_and_win_over_an_older_section(agent_ns, family):
    rule = agent_ns["GENIE_EXPLANATION_FACTS_RULE"]
    sentence = ("The summary step never calls ai_query itself: inspire_write_summary runs the ai_query that writes the summary and "
                "returns its text, which the summary step prints, so where another section of this instruction asks for a summary "
                "or an explanation written with ai_query, such as a three-sentence ai_query summary for the decision owner, the "
                "notebook passes the summary step's facts to inspire_write_summary and each row's ai_facts to inspire_write_result "
                "instead, and this rule wins over that section; only an explicit user directive, such as the user's Implementation "
                "Choices, wins over this rule.")
    assert rule.endswith(sentence)
    inst, _uc, spec = _spec(agent_ns, family)
    assert sentence in inst._genie_platform_rules(spec)


@pytest.mark.parametrize("family,sentence,needle", [
    ("A", EVIDENCE_SENTENCE, "has the notebook write the run's summary with ai_query"),
    ("A", EVIDENCE_EXPLANATION, "has the notebook explain rows with ai_query"),
    ("B", "**Summary cell**: print the metrics and an ai_query summary of the run for the owner.",
     "has the notebook write the run's summary with ai_query"),
    ("G", "The last cell prints the error rate and a three-sentence summary for the support lead written with ai_query.",
     "has the notebook write the run's summary with ai_query"),
])
def test_a_sentence_that_has_the_notebook_write_the_summary_or_explain_rows_with_ai_query_is_flagged(agent_ns, family, sentence, needle):
    inst, _uc, spec = _spec(agent_ns, family)
    conflicts = inst._genie_contract_conflicts("## 8. Definition of Done\n- " + sentence, spec)
    assert len(conflicts) == 1 and needle in conflicts[0], conflicts
    assert conflicts[0].startswith('"' + sentence + '"')
    assert "inspire_write_summary" in conflicts[0] or "inspire_write_result" in conflicts[0]


@pytest.mark.parametrize("family,sentence", [
    ("A", "The summary step prints the metrics and passes its facts to `inspire_write_summary`, which runs the `ai_query`."),
    ("A", "The notebook never calls `ai_query`; the summary step prints the ten top-ranked rows."),
    ("A", "**AI function:** `ai_query` with endpoint `ep`, `failOnError => false`, no temperature, no `responseFormat`."),
    ("A", "14. **Summary cell** (section 8)."),
    ("G", "Classify each ticket with `ai_query` and summarize it in one sentence, stored per ticket."),
    ("G", "Use `ai_query` to extract the issue and an explanation field for each review."),
    ("B", "| `ai_endpoint` | text | `ep` | any | AI endpoint inspire_write_summary uses for the summary with ai_query |"),
])
def test_a_sentence_that_leaves_the_summary_and_explanations_to_inspire_is_never_flagged(agent_ns, family, sentence):
    inst, _uc, spec = _spec(agent_ns, family)
    assert inst._genie_contract_conflicts("## 8. Definition of Done\n- " + sentence, spec) == []


def test_a_saved_instruction_that_asks_for_an_ai_query_summary_is_written_again_before_the_build(agent_ns):
    stored = "## 7. Business Output\n- " + EVIDENCE_EXPLANATION + "\n## 8. Definition of Done\n- " + EVIDENCE_SENTENCE + "\n"
    fresh = "## 8. Definition of Done\n- The summary step passes its facts to `inspire_write_summary`.\n"
    inst, uc, calls = _recovering(agent_ns, stored, fresh=fresh)
    warnings = []
    got = inst._implement_recover_instruction({"id": "N01-U01"}, "N01-U01", uc, warnings)
    assert got["genie_instruction"] == fresh and warnings == [] and len(calls) == 1
    assert calls[0][2].startswith("the saved Genie Code instruction words acceptance, a stop or Inspire's AI steps differently from "
                                  "Inspire's Acceptance and Stop Rule and Platform Rules in 2 sentences, so Inspire writes it again: ")
    assert "three-sentence `ai_query` summary" in calls[0][2] and "explanation_top_k" in calls[0][2]


def test_a_notebook_whose_summary_step_calls_ai_query_instead_of_inspire_write_summary_is_flagged_with_the_cell_and_line(agent_ns):
    check = agent_ns["implement_summary_call_problems"]
    rule = agent_ns["IMPLEMENT_SUMMARY_RULE"]
    assert rule == ("the summary step passes its facts to inspire_write_summary(facts, result_table, run_id, as_of_date), which runs "
                    "the ai_query that writes the summary, and never calls ai_query for the summary itself")
    assert check([("cell 4", "x = fmt_num(3)"), ("cell 9", SUMMARY_CELL)]) == [
        f"no cell calls inspire_write_summary, so the run writes no AI summary for the App, and cell 9 line 6 calls ai_query to "
        f"write the summary itself: {rule}"]
    assert check([("cell 9", "def summarize(scored):\n    print(len(scored))\n")]) == [
        f"no cell calls inspire_write_summary, so the run writes no AI summary for the App: {rule}"]


def test_a_notebook_that_passes_its_summary_facts_to_inspire_write_summary_is_never_flagged(agent_ns):
    check = agent_ns["implement_summary_call_problems"]
    assert check([("cell 9", FIXED_SUMMARY_CELL)]) == []
    assert check([("cell 5", METHOD_AI_CELL), ("cell 9", FIXED_SUMMARY_CELL)]) == [], "a method that calls ai_query is not the summary"
    assert check([("cell 5", "def broken(:\n"), ("cell 6", "")]) == [], "no cell Inspire can read is no evidence of a missing call"
    assert check([]) == []


def test_the_cell_check_after_each_genie_round_reports_the_summary_step_that_skips_inspire_write_summary(agent_ns, sdk_stub):
    notebook = {"cells": [_cell("Genie Code instruction", "# instruction"), _cell(None, "z = fmt_num(3)"), _cell(None, SUMMARY_CELL),
                          _cell(agent_ns["GENIE_NUMBER_HELPERS_TITLE"], agent_ns["GENIE_NUMBER_TEXT_SOURCE"]),
                          _cell("Run controls (Inspire, do not edit)", "def main():\n    inspire_write_summary('f', 't', 'r', 'd')\n")]}
    inst = _notebook_inspire(agent_ns, _NotebookWorkspace(notebook, modified_at=5))
    problems = inst._implement_cell_problems("/W/nb")
    assert problems == [f"no cell calls inspire_write_summary, so the run writes no AI summary for the App, and cell 3 line 6 calls "
                        f"ai_query to write the summary itself: {agent_ns['IMPLEMENT_SUMMARY_RULE']}"], \
        "Inspire's own Run controls cell never counts as the notebook's summary step"
    notebook["cells"][2] = _cell(None, FIXED_SUMMARY_CELL)
    inst = _notebook_inspire(agent_ns, _NotebookWorkspace(notebook, modified_at=5))
    assert inst._implement_cell_problems("/W/nb") == []


@pytest.mark.parametrize("source,line,what", [
    (GROUPBY_LOOP, 3, "the groups of a groupby"), (UNIQUE_LOOP, 3, "the unique values of a column"),
    (COMPREHENSION_LOOP, 2, "the groups of a groupby"), (WRAPPED_UNIQUE_LOOP, 3, "the unique values of a column")])
def test_a_python_loop_per_entity_that_builds_features_is_found(agent_ns, source, line, what):
    assert agent_ns["implement_entity_loop_spots"]([("cell 6", source)]) == [f"cell 6 line {line} loops over {what}"]


def test_the_per_row_text_building_and_the_validation_pass_are_never_taken_for_a_per_entity_loop(agent_ns):
    find = agent_ns["implement_entity_loop_spots"]
    assert find([("cell 7", EVIDENCE_ENRICH_AND_VALIDATE)]) == []
    assert find([("cell 5", VECTORIZED_SPELLS)]) == [], "vectorized group operations and loops that build nothing are fine"
    assert find([("cell 5", "def broken(:\n")]) == []


def test_the_preview_budget_is_a_named_constant_from_healthy_previews_and_inspire_waits_twice_as_long(agent_ns):
    assert agent_ns["IMPLEMENT_PREVIEW_BUDGET_MINUTES"] == 20
    assert agent_ns["IMPLEMENT_PREVIEW_WAIT_S"] == 2 * 20 * 60
    assert agent_ns["IMPLEMENT_PREVIEW_WAIT_S"] < agent_ns["GENIE_CODE_TIMEOUT_S"]


def test_the_instruction_tells_genie_to_cancel_a_preview_test_at_the_budget_and_the_user_s_words_still_win(agent_ns):
    spec = agent_ns["validate_implement_spec"](dict(VALID, data=dict(VALID["data"], notes="Train on the full history")))[0]
    text = agent_ns["implement_choices_markdown"](spec)
    rule = agent_ns["implement_preview_budget_rule"](True)
    assert rule == ("- A run with `run_profile` set to `preview` finishes within 20 minutes, training included. When your preview test "
                    "run is still running at that budget, cancel it, find the slow step from the step times it printed, make that "
                    "step fast and run the test again, never wait for the run to finish. Build features from history with Spark "
                    "aggregations or vectorized pandas group operations, never a Python loop per entity or per transaction.")
    assert text.count(rule) == 1 and text.index(rule) < text.index("The customer's asks for this notebook, word for word")
    plain = agent_ns["implement_choices_markdown"](agent_ns["validate_implement_spec"](VALID)[0], trains_model=False)
    untrained = agent_ns["implement_preview_budget_rule"](False)
    assert plain.count(untrained) == 1 and "train" not in untrained and untrained == rule.replace(", training included", "")


class _Overrun:
    def __init__(self, ns, waited, cancel_error=None):
        self.cancels, self.waits = [], []
        outer = self

        class Launcher(ns["JobLauncher"]):
            def launch(self, **kwargs):
                return {"success": True, "job_id": 77, "run_id": 5, "job_url": "u"}

            def wait_for_run(self, run_id, timeout_s=0, poll_s=0, out=None):
                outer.waits.append(timeout_s)
                return dict(waited)

        self.launcher = Launcher

        def api(method, path, body=None, query=None):
            outer.cancels.append((method, path, body))
            if cancel_error:
                raise cancel_error
            return {}

        self.api = api


def _overrun_preview(ns, waited, cancel_error=None):
    inst = _inspire(ns, FakeSpark())
    inst.updates = []
    inst._implement_update = lambda key, **f: inst.updates.append(f)
    fake = _Overrun(ns, waited, cancel_error)
    inst._job_launcher_cls = fake.launcher
    inst._implement_api = fake.api
    spec = ns["validate_implement_spec"](VALID)[0]
    outcome, job_id, run_id = inst._implement_preview("N01-U01", (5150, "N01-U01", 1), CHURN_UC,
                                                      spec, {"job_tags": {}, "job_slug": "churn", "schedule_cron": None}, "/W/nb",
                                                      ["result_table", "run_profile"])
    return outcome, fake, inst


def test_a_preview_still_running_at_twice_the_budget_is_canceled_and_fails_with_why(agent_ns):
    outcome, fake, inst = _overrun_preview(agent_ns, {"status": "RUNNING"})
    assert fake.waits == [agent_ns["IMPLEMENT_PREVIEW_WAIT_S"]]
    assert fake.cancels == [("POST", "/api/2.2/jobs/runs/cancel", {"run_id": 5})]
    assert outcome["status"] == "failed" and outcome["overran"] is True
    assert outcome["error"] == ("the preview run 5 was still running after 40 minutes, twice the 20-minute preview budget, so "
                                "Inspire canceled it")
    ended = [e for e in inst.emitted if e["step_name"] == "Preview run" and e["status"] != "started"]
    assert ended[0]["status"] == "ended_error" and ended[0]["message"] == outcome["error"]


def test_a_preview_whose_cancel_fails_or_whose_state_cannot_be_read_says_so(agent_ns):
    outcome, fake, _inst = _overrun_preview(agent_ns, {"status": "RUNNING"}, cancel_error=RuntimeError("RESOURCE_CONFLICT"))
    assert outcome["error"] == ("the preview run 5 was still running after 40 minutes, twice the 20-minute preview budget, and "
                                "Inspire could not cancel it: RESOURCE_CONFLICT")
    outcome, fake, _inst = _overrun_preview(agent_ns, {"status": "RUNNING", "note": "run state unreadable: 503"})
    assert outcome == {"status": "failed", "error": "Inspire could not read the state of the preview run 5 (run state unreadable: "
                                                    "503), so it canceled the run", "job_url": "u"}
    assert fake.cancels == [("POST", "/api/2.2/jobs/runs/cancel", {"run_id": 5})]


def _gated(ns, previews, checks_seq, refill=True, rounds=3, fills=None, reasons=None, workspace=None, runner_results=None):
    inst = _flow_inspire(ns, previews)
    served = list(checks_seq)
    reason_sql = re.compile(r"^SELECT nothing_to_act, not_reliable FROM `main`\.`inspire`\.`churn_out_summary` "
                            r"WHERE use_case_id = 'N01-U01' AND run_id = '([^']+)'$")

    def respond(statement):
        if statement == CHECKS_SQL:
            found = served.pop(0) if served else None
            return [found] if found else []
        matched = reason_sql.match(statement)
        if matched and matched.group(1) in (reasons or {}):
            return [{"nothing_to_act": reasons[matched.group(1)], "not_reliable": ""}]
        return []

    inst.spark = FakeSpark(responder=respond)
    if workspace is not None:
        inst.w_client = types.SimpleNamespace(workspace=workspace, config=types.SimpleNamespace(host=""))
    results = runner_results or [{"exit": 0, "final": (fills or {}).get(n, _fill())} for n in range(rounds)]
    runner = _FakeRunner(results)
    spec = ns["validate_implement_spec"](VALID)[0]
    outcome, _job, _fill_out = inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), {"result_table": "main.inspire.churn_out"},
                                                                spec, None, "/W/nb", ["result_table", "run_profile"], runner, refill)
    return outcome, runner, inst


NO_SUMMARY = {"summary": None, "ai_checks": json.dumps(dict(CHECKED, flagged=0, kinds={}))}
GOOD = {"summary": "Six records need action.", "ai_checks": json.dumps(dict(CHECKED, flagged=0, kinds={}))}
ENDPOINT_DOWN = {"summary": None, "ai_checks": json.dumps({"error": "the ai_endpoint widget is empty"})}


def test_a_missing_ai_summary_on_round_2_goes_back_to_genie_for_round_3_instead_of_shipping_a_warning(agent_ns):
    results = [{"exit": -9, "timed_out": True}, {"exit": 0, "final": _fill()}, {"exit": 0, "final": _fill()}]
    outcome, runner, inst = _gated(agent_ns, [_preview("r-2"), _preview("r-3")], [NO_SUMMARY, GOOD],
                                   runner_results=results)
    assert len(runner.prompts) == 3 and outcome == {"status": "written", "rows_written": 40, "run_id": "r-3"}
    assert "the run wrote no AI summary, so the App has no AI summary for it: " + agent_ns["IMPLEMENT_SUMMARY_RULE"] in runner.prompts[2]
    assert any("the preview run's AI output failed Inspire's checks, sent back to Genie" in str(e.get("message")) for e in inst.emitted)


def test_ai_output_genie_cannot_fix_in_every_round_ships_saying_genie_could_not_fix_it(agent_ns):
    outcome, runner, _inst = _gated(agent_ns, [_preview("r-1"), _preview("r-2"), _preview("r-3")],
                                    [NO_SUMMARY, NO_SUMMARY, NO_SUMMARY])
    assert len(runner.prompts) == 3 and outcome["run_id"] == "r-3"
    assert outcome["ai_fixable"] is True and outcome["gate_rounds"] == 3 and outcome["ai_problems"][0].startswith("the run wrote no AI")
    assert agent_ns["implement_unfixed_text"]("x", 3) == "Genie could not fix this in 3 build rounds: x"
    assert agent_ns["implement_unfixed_text"]("x", 1) == "Genie could not fix this in 1 build round: x"
    assert agent_ns["implement_unfixed_text"]("x", 0) == "x; build the notebook again with Vibe/Add/Remove Features on the Build page"


def test_an_ai_step_that_failed_on_the_endpoint_is_never_sent_back_to_genie(agent_ns):
    outcome, runner, _inst = _gated(agent_ns, [_preview("r-1")], [ENDPOINT_DOWN])
    assert len(runner.prompts) == 1 and outcome["run_id"] == "r-1"
    assert outcome["ai_problems"][0] == "the AI step of the run failed: the ai_endpoint widget is empty"
    assert "ai_fixable" not in outcome, "an empty endpoint is no defect Genie can fix in the notebook"


def test_a_written_preview_whose_genie_reply_left_widgets_out_goes_back_while_a_round_is_left(agent_ns):
    outcome, runner, _inst = _gated(agent_ns, [_preview("r-1"), _preview("r-2")], [], fills={0: _fill(widgets=())})
    assert len(runner.prompts) == 2 and outcome == {"status": "written", "rows_written": 40, "run_id": "r-2"}
    assert "Inspire checked your last attempt and found: widgets missing from the result: result_table" in runner.prompts[1]
    assert runner.prompts[1].count("widgets missing from the result: result_table") == 1


def test_a_notebook_defect_left_after_the_last_round_or_by_a_refresh_says_so(agent_ns):
    untested = agent_ns["INSPIRE_NOTHING_TO_ACT_UNTESTED"]
    outcome, runner, _inst = _gated(agent_ns, [_preview(r) for r in ("r-1", "r-2", "r-3")], [],
                                    reasons={r: untested for r in ("r-1", "r-2", "r-3")})
    assert len(runner.prompts) == 3 and outcome["gate_rounds"] == 3
    assert outcome["gate_problems"] == ["no row of run r-3 reached 'Act now' or 'Review', and the run gave no nothing_to_act, so the "
                                        "App can only say that no record passed this use case's decision test"]
    plain, runner, _inst = _gated(agent_ns, [_preview("r-1")], [], refill=False, rounds=0, reasons={"r-1": untested})
    assert runner.prompts == [] and plain["gate_rounds"] == 0 and plain["gate_problems"][0].startswith("no row of run r-1 reached")


class _Checkpointed:
    def __init__(self, text):
        self.files = {"/W/nb": text.encode()}
        self.imported = []

    def export(self, path, format=None):
        import base64
        return types.SimpleNamespace(content=base64.b64encode(self.files[path]).decode())

    def import_(self, path, content, format=None, overwrite=True):
        import base64
        self.imported.append((path, base64.b64decode(content).decode()))
        self.files[path] = base64.b64decode(content)

    def get_status(self, path):
        return types.SimpleNamespace(path=path, object_id=None, modified_at=1)

    def mkdirs(self, path):
        return None


def test_a_last_round_that_breaks_the_run_puts_back_the_notebook_that_wrote_rows_and_runs_it_again(agent_ns, sdk_stub):
    workspace = _Checkpointed('{"cells": ["round 2 notebook"]}')
    failed = ({"status": "failed", "error": "NameError: history_pdf"}, 11, 103)
    outcome, runner, inst = _gated(agent_ns, [_preview("r-1"), _preview("r-2"), failed, _preview("r-4")],
                                   [NO_SUMMARY, NO_SUMMARY, NO_SUMMARY], workspace=workspace)
    assert len(runner.prompts) == 3 and outcome["run_id"] == "r-4"
    assert workspace.imported == [("/W/nb", '{"cells": ["round 2 notebook"]}')]
    assert outcome["checkpoint_note"] == ("Genie's last round left the notebook unable to write rows (NameError: history_pdf), so "
                                          "Inspire put back the notebook of round 2, which wrote run r-2, and ran it again")
    assert outcome["ai_fixable"] is True and outcome["gate_rounds"] == 3


def test_a_put_back_notebook_whose_run_fails_again_ends_the_build_with_the_last_round_s_failure(agent_ns, sdk_stub):
    workspace = _Checkpointed('{"cells": ["round 2 notebook"]}')
    failed = ({"status": "failed", "error": "NameError: history_pdf"}, 11, 103)
    again = ({"status": "failed", "error": "the cluster went away"}, 11, 104)
    outcome, runner, inst = _gated(agent_ns, [_preview("r-1"), _preview("r-2"), failed, again],
                                   [NO_SUMMARY, NO_SUMMARY], workspace=workspace)
    assert outcome == {"status": "failed", "error": "NameError: history_pdf"} and len(workspace.imported) == 1
    assert inst.logger.matching("[IMPLEMENT-CHECKPOINT] N01-U01")


def test_a_genie_turn_cut_off_by_the_time_limit_is_told_which_loop_runs_one_step_per_entity(agent_ns, sdk_stub):
    notebook = {"cells": [_cell("Genie Code instruction", "# instruction"), _cell(None, GROUPBY_LOOP),
                          _cell(None, EVIDENCE_ENRICH_AND_VALIDATE)]}
    inst = _flow_inspire(agent_ns, [_preview("r-2")])
    inst.w_client = types.SimpleNamespace(workspace=_NotebookWorkspace(notebook, modified_at=5), config=types.SimpleNamespace(host=""))
    runner = _FakeRunner([{"exit": -9, "timed_out": True}, {"exit": 0, "final": _fill()}])
    spec = agent_ns["validate_implement_spec"](VALID)[0]
    outcome, _job, _f = inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), {}, spec, None, "/W/nb",
                                                         ["result_table", "run_profile"], runner, True)
    assert outcome["run_id"] == "r-2" and len(runner.prompts) == 2
    assert ("cell 2 line 3 loops over the groups of a groupby, one Python step per entity: build features from history with Spark "
            "aggregations or vectorized pandas group operations instead, never a Python loop per entity or per transaction") in runner.prompts[1]
    assert "cell 3" not in runner.prompts[1]


def test_inspire_s_own_preview_that_overran_goes_back_to_genie_with_the_budget(agent_ns):
    overran = ({"status": "failed", "overran": True, "error": "the preview run 5 was still running after 40 minutes"}, 11, 5)
    outcome, runner, _inst = _gated(agent_ns, [overran, _preview("r-2")], [])
    assert len(runner.prompts) == 2 and outcome["run_id"] == "r-2"
    assert ("the run failed: the preview run 5 was still running after 40 minutes. A preview run finishes within 20 minutes: make "
            "its slow step fast.") in runner.prompts[1]


def test_the_build_names_each_unfixed_defect_once_with_who_could_not_fix_it(agent_ns):
    from v148_asset_vibes_test import PARTS, _carrying, _llm, _locked, _vibed
    from v143_vibes_test import _run
    columns = [{"col_name": n, "data_type": "string"} for n in ("entity_id",)]
    inst, previous = _locked(agent_ns, None, lambda s: columns if s == "DESCRIBE TABLE `main`.`inspire`.`churn_out`" else [])
    _carrying(inst, dict(PARTS, ai_reasoning={"state": "ready", "spec_version": 2, "title": "AI reasoning"}))
    inst._implement_refresh_run_controls = lambda *a: None
    inst._implement_keep_edits_setting = lambda *a, **k: None
    inst._implement_missing_tables = lambda tables: []
    inst._implement_role_problems = lambda spec, uc: []
    summary = "the run wrote no AI summary, so the App has no AI summary for it: " + agent_ns["IMPLEMENT_SUMMARY_RULE"]
    gate = "no row of run r-9 reached 'Act now' or 'Review', and the run gave no nothing_to_act"
    inst._implement_fill_and_preview = lambda *a: ({"status": "written", "rows_written": 40, "run_id": "r-9", "ai_problems": [summary],
                                                    "ai_fixable": True, "gate_problems": [gate], "gate_rounds": 3}, 77, {})
    inst._implement_result_history = lambda *a: None
    inst._implement_fallback_warning = lambda *a: ""
    inst._implement_tier_warning = lambda *a: ""
    _llm(inst)
    assert _run(inst, _vibed(previous, ["ai_reasoning"])) == "ready_with_warnings"
    message = inst.updates[-1]["status_message"]
    assert f"AI reasoning: Genie could not fix this in 3 build rounds: {summary}" in message
    assert f"Notebook: Genie could not fix this in 3 build rounds: {gate}" in message
