import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v120_genie_support import ORDERS, FakeAgent, FakeLoader, build_inspire, long_instruction, make_uc
from v140_implement_test import _NB_SPEC, VALID, _FakeRunner, _fill, _flow_inspire, _probe_inspire, sdk_stub  # noqa: F401

TECHNIQUES = {"A": "Predictive Modeling", "B": "Anomaly Detection", "C": "Clustering", "D": "Recommendation",
              "E": "Forecasting", "F": "Cohort Analysis", "G": "Sentiment Analysis", "H": "Optimization"}
TITLE = "## Acceptance and Stop Rule\n"

N01_U01 = "\n".join([
    "## 1. Persona",
    "STOP RULE: when any readiness check fails or no candidate passes acceptance, the notebook prints the failed check with measured "
    "and required values, writes nothing, and stops; it never lowers a threshold, fabricates data, drops a check or switches tables.",
    "## 5. Build Steps",
    "9. **Acceptance**: cap alerts at `max_alerts_per_run`; take the alert set as scores at or above `alert_quantile`. Compute top-k "
    "agreement between the two seeds (overlap of top alerts) and require >= `min_topk_stability`. Where known below-cost cases exist "
    "(r3 < 1), precision must not fall below the baseline's.",
    "14. **Summary cell** (section 8). A readiness or acceptance stop skips steps 10-13 but no step is removed or stubbed.",
    "## 6. Method and Acceptance",
    "Baseline: robust median/MAD z-score on r1-r5. Candidate: per-category Isolation Forest, the simplest unsupervised scorer that beats "
    "a univariate z-score by capturing multivariate price inconsistency. Acceptance rule, exactly as given: at most `max_alerts_per_run` "
    "alerts per run, and top-k agreement between the two seeds at or above `min_topk_stability` (0.6); where known below-cost cases "
    "exist, precision not below baseline. No criterion is added. Report both candidate and baseline alert counts and agreement; "
    "acceptance is decided only by this rule.",
    "## 8. Definition of Done",
    "- Accepted method beat the baseline by the acceptance rule (alert cap and top-k agreement, precision not below baseline on known "
    "below-cost cases); model registered with alias champion when accepted.",
    "- STOP RULE: when a readiness check fails or no candidate passes acceptance, the notebook prints the failed check or \"No approved "
    "model yet\" with metrics, writes nothing, and stops.",
])

CONFLICTING = long_instruction(f"Use `{ORDERS}.amount` from `{ORDERS}`.\n9. **Acceptance**: require top-k agreement of at least "
                               "`min_topk_stability`; precision must not fall below the baseline's.")
AGREEING = long_instruction(f"Use `{ORDERS}.amount` from `{ORDERS}`.\n9. **Acceptance**: at most `max_alerts_per_run` alerts and "
                            "top-k agreement of at least `min_topk_stability`; precision against the baseline is printed in the summary.")


def _spec(agent_ns, family, **attrs):
    inst = build_inspire(agent_ns, loader=FakeLoader(), inspire_database="cat._inspire", **attrs)
    uc = make_uc(**{"Analytics Technique": TECHNIQUES[family]})
    spec = inst._genie_notebook_spec(uc)
    assert spec["family"] == family
    return inst, uc, spec


@pytest.mark.parametrize("family", sorted(TECHNIQUES))
def test_every_family_gets_inspires_acceptance_section_just_before_the_platform_rules(agent_ns, family):
    inst, _uc, spec = _spec(agent_ns, family)
    drafted = "## 1. Persona\nYou build it.\n- STOP RULE: when readiness fails or no candidate passes acceptance, write nothing and stop.\n"
    out = inst._genie_with_platform_rules(drafted, spec)
    assert out.count(TITLE) == 1 and out.index(TITLE) < out.index("## Platform Rules\n")
    assert out.endswith("\n\n## Platform Rules\n" + inst._genie_platform_rules(spec) + "\n")
    section = out[out.index(TITLE):out.index("## Platform Rules\n")]
    assert agent_ns["GENIE_READINESS_STOP_RULE"] in section and agent_ns["GENIE_NO_FORCED_PASS_RULE"] in section
    assert "- Acceptance outcome: " + inst._genie_acceptance_stop_rule(spec) in section
    assert "This is the whole acceptance rule: a criterion it does not name is printed in the summary and never decides acceptance." in section
    for key in re.findall(r"\{(\w+)\}", inst._GENIE_ACCEPTANCE_TEXT[family]):
        assert f"`{key}` (" in section, (family, key)
    flag_only = any(agent_ns["INSPIRE_FLAG_ONLY_READINESS"].get(rule[1])
                    for rule in agent_ns["INSPIRE_READINESS_RULES"]["common"] + agent_ns["INSPIRE_READINESS_RULES"][family])
    assert ("only sets data_quality_flag" in section) is flag_only
    assert "- " + agent_ns["GENIE_STOP_RULE_POINTER"] + "\n" in out and "write nothing and stop" not in out
    assert inst._genie_with_platform_rules(out, spec) == out, "rendering twice changes nothing"


@pytest.mark.parametrize("family", sorted(TECHNIQUES))
def test_the_section_that_wins_says_staleness_runs_to_the_as_of_date_so_an_older_instruction_measuring_to_today_is_overruled(agent_ns, family):
    inst, _uc, spec = _spec(agent_ns, family)
    older = ("## 4. Readiness Check\n| `staleness_cadences` | (today minus newest pickup date) in days / (`horizon` / 24) | "
             "<= `max_staleness_cadences` | \"The newest data is <measured> decision cycle(s) older than today\" |\n")
    out = inst._genie_with_platform_rules(older, spec)
    section = out[out.index(TITLE):out.index("## Platform Rules\n")]
    rule = "`staleness_cadences` is " + agent_ns["GENIE_FLAG_ONLY_MEASURE_RULE"] + "."
    keys = {rule[1] for rule in agent_ns["INSPIRE_READINESS_RULES"]["common"] + agent_ns["INSPIRE_READINESS_RULES"][family]}
    assert (rule in section) is ("staleness_cadences" in keys)
    assert ("never to today" in section) is (family == "E")
    if family == "E":
        assert "a check that never stops the run, " + agent_ns["GENIE_FLAG_ONLY_MEASURE_RULE"] + ": " in inst._genie_threshold_text(spec)


def test_a_threshold_changed_in_the_wizard_shows_in_the_section(agent_ns):
    inst, _uc, spec = _spec(agent_ns, "B")
    spec["thresholds"]["max_alerts_per_run"] = 7
    out = inst._genie_with_platform_rules("## 1. Persona\nx\n", spec)
    assert "at most `max_alerts_per_run` (7) alerts per run" in out


def test_the_prompt_points_at_the_section_instead_of_restating_the_rules(agent_ns):
    template = agent_ns["PROMPT_TEMPLATES"]["USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT"]
    pointer = agent_ns["GENIE_STOP_RULE_POINTER"]
    assert pointer == "STOP RULE: see Acceptance and Stop Rule."
    assert f"Inspire appends both rules verbatim: never restate them; where a section asks for them, write `{pointer}`." in template
    assert "STOP RULE in one sentence" not in template and "Then the STOP RULE." in template and "End with the STOP RULE." in template
    assert "the acceptance rule in plain words" not in template, "the instruction never rewords the acceptance rule"
    assert "the accepted method beat the baseline" not in template, "a baseline comparison is a criterion only where the rule names it"


def test_the_failed_n01_u01_instruction_is_caught_sentence_by_sentence(agent_ns):
    inst, _uc, spec = _spec(agent_ns, "B")
    conflicts = inst._genie_contract_conflicts(N01_U01, spec)
    assert len(conflicts) == 4, conflicts
    assert conflicts[0].startswith('"Where known below-cost cases exist (r3 < 1), precision must not fall below the baseline\'s." makes '
                                   "precision and a comparison with the baseline part of acceptance, but the acceptance rule is only: at most ")
    assert conflicts[1] == ('"A readiness or acceptance stop skips steps 10-13 but no step is removed or stubbed." says a failed acceptance '
                            'stops the run, skips steps or writes nothing, but for this use case: When no candidate passes the acceptance '
                            'rule, the notebook prints "No approved model yet" with the metrics of the candidates and the baseline, '
                            "registers no model, and writes the baseline's rows, each with the tier its value_at_stake gives.")
    assert conflicts[2].startswith('"Acceptance rule, exactly as given: ') and "precision not below baseline.\" makes precision" in conflicts[2]
    assert conflicts[3].startswith('"Accepted method beat the baseline') and "report them in the summary instead" in conflicts[3]
    assert all("STOP RULE:" not in c for c in conflicts), "Inspire replaces the drafted STOP RULE lines, so they are never repaired"
    assert inst._genie_contract_conflicts(inst._genie_with_platform_rules(N01_U01, spec), spec) == conflicts


@pytest.mark.parametrize("family,sentence", [
    ("B", 'When no candidate passes the acceptance rule, the notebook prints "No approved model yet" with the metrics of the candidates '
          "and the baseline, registers no model, and writes the baseline's rows."),
    ("B", "Acceptance does not use precision; precision against the baseline is printed in the summary."),
    ("B", "Report both candidate and baseline alert counts and agreement; acceptance is decided only by this rule."),
    ("B", "9. **Acceptance**: at most `max_alerts_per_run` alerts per run and top-k agreement of at least `min_topk_stability`."),
    ("B", "When a readiness check fails, the notebook prints the check, writes nothing and stops."),
    ("B", "| `max_alerts_per_run` | text | `50` | any | Accept at most this many alerts, precision must exceed the baseline |"),
    ("B", "Precision must not fall below the baseline's when the candidate is scored."),
    ("A", "Accept the candidate when its out-of-time AUC is at least `min_auc` and at least `min_auc_gain` above the baseline's AUC."),
    ("D", "Accept when out-of-time precision@K is at least `min_precision_lift` times the popularity baseline."),
    ("E", "Acceptance never stops this run: when MASE is not below `max_mase` against the seasonal naive forecast, it is published."),
    ("F", "Acceptance never stops this run; findings with a q-value above `fdr_alpha` are still written as Monitor."),
    ("G", "When the AI error rate is above `max_ai_error_rate`, acceptance fails: the notebook prints the rate, writes nothing and stops."),
    ("H", "When no feasible plan beats the current plan, acceptance fails and the notebook writes the current plan's rows and stops."),
    ("C", "There is no acceptance stop: a silhouette below `min_silhouette` is reported."),
    ("B", "Report, without using it for acceptance: the precision of each method's alerts on rule-confirmed breaks."),
    ("A", "Data risks: class imbalance is handled by class weights and PR-AUC acceptance rather than accuracy."),
    ("B", "- `status`: stop or acceptance status"),
    ("E", "[ ] A failed readiness check prints its measured and required values, writes nothing and stops; "
          "a failed acceptance publishes the flagged seasonal naive forecast instead."),
    ("H", "If no feasible plan beats the current plan, the notebook falls back to the current plan and stops searching."),
], ids=lambda value: value if len(value) == 1 else None)
def test_sentences_that_agree_with_the_rule_are_never_flagged(agent_ns, family, sentence):
    inst, _uc, spec = _spec(agent_ns, family)
    assert inst._genie_contract_conflicts("## 5. Build Steps\n" + sentence, spec) == []


@pytest.mark.parametrize("family,sentence,needle", [
    ("B", "Accept the run only when precision is at least 0.4.", "makes precision part of acceptance"),
    ("B", "Acceptance: the candidate must beat the baseline on recall.", "makes recall and a comparison with the baseline part"),
    ("C", "Accept the segmentation only if accuracy exceeds the baseline.", "makes accuracy and a comparison with the baseline part"),
    ("E", "Accept the candidate only when RMSE is below the naive forecast's.", "makes RMSE part of acceptance"),
    ("A", "Accept the model when its AUC is at least `min_auc` and its F1 is at least 0.5.", "makes F1 part of acceptance"),
    ("G", "Accept the run when accuracy against the labels is at least 0.9.", "makes accuracy part of acceptance"),
    ("B", "If no candidate passes acceptance, the notebook writes nothing and stops.", "says a failed acceptance stops the run"),
    ("E", "When the candidate is not accepted, the notebook stops without writing rows.", "the notebook publishes the seasonal naive"),
    ("F", "When acceptance fails, the notebook writes nothing.", "Acceptance never stops this run"),
    ("H", "When no candidate passes acceptance, the notebook halts.", 'prints "No better plan found"'),
    ("B", 'When satisfied, register the champion; otherwise print "No approved model yet" and write nothing.', "says a failed acceptance stops"),
    ("B", "Report recall without using it for acceptance; accept only when precision beats the baseline.",
     "makes precision and a comparison with the baseline part"),
    ("A", "Use precision rather than recall: accept only when precision is at least 0.5.", "makes precision part of acceptance"),
    ("B", "[ ] If a readiness check or acceptance fails, the notebook writes nothing.", "says a failed acceptance stops"),
    ("A", "All steps are fully written; a stop at readiness or acceptance skips the write but never removes a step.",
     "says a failed acceptance stops"),
])
def test_sentences_that_change_the_rule_are_flagged(agent_ns, family, sentence, needle):
    inst, _uc, spec = _spec(agent_ns, family)
    conflicts = inst._genie_contract_conflicts("## 5. Build Steps\n" + sentence, spec)
    assert len(conflicts) == 1 and needle in conflicts[0], conflicts
    assert conflicts[0].startswith('"' + re.sub(r"^\[[ xX]\] ", "", sentence) + '"'), conflicts


def test_a_checklist_stop_rule_line_becomes_the_pointer(agent_ns):
    inst, _uc, spec = _spec(agent_ns, "B")
    pointer = agent_ns["GENIE_STOP_RULE_POINTER"]
    drafted = ("## 8. Definition of Done\n- [ ] STOP RULE: if acceptance fails, write nothing and stop.\n"
               "[x] **STOP RULE:** when readiness fails, stop.\n")
    out = inst._genie_with_platform_rules(drafted, spec)
    assert "- [ ] " + pointer + "\n" in out and "\n[x] " + pointer + "\n" in out
    assert "write nothing and stop" not in out and "when readiness fails, stop" not in out
    assert inst._genie_contract_conflicts(drafted, spec) == []


def test_the_run_summary_names_conflicts_left_after_repair(agent_ns, monkeypatch):
    inst, _uc, _spec_b = _spec(agent_ns, "B")
    lines = []
    monkeypatch.setitem(inst._report_genie_outcome.__func__.__globals__, "log_print", lambda message, level="INFO": lines.append((level, message)))
    conflict = '"Accept only when precision beats the baseline." makes precision part of acceptance'
    outcome = inst._report_genie_outcome("Discover", [
        {"No": "N01-U01", "genie_instruction_status": "validation_errors", "genie_contract_conflicts": [conflict], "notebook_status": "written"},
        {"No": "N01-U02", "genie_instruction_status": "success", "notebook_status": "written"}])
    assert outcome["validation_errors"] == {"N01-U01": [conflict]} and outcome["validated_ids"] == ["N01-U02"]
    assert ("WARNING", f"   ⚠️ Discover N01-U01: instruction emitted with problems left after repair: {[conflict]}") in lines


def test_a_long_sentence_is_quoted_clipped(agent_ns):
    inst, _uc, spec = _spec(agent_ns, "B")
    sentence = "Accept the run only when precision is at least 0.4 " + "and the detail holds " * 30 + "."
    conflict = inst._genie_contract_conflicts("## 5. Build Steps\n" + sentence, spec)[0]
    assert conflict.startswith('"' + sentence[:297] + '..."')


def _generate(inst, uc):
    return inst._generate_genie_instruction_for_use_case(uc, [], "", schema_index=None)


@pytest.mark.parametrize("quality", ["Good", "Ultra High"])
def test_a_draft_against_the_rule_is_read_back_and_repaired_without_cache(agent_ns, quality):
    agent = FakeAgent([CONFLICTING, AGREEING])
    inst, uc, _spec_b = _spec(agent_ns, "B", quality=quality, agent=agent)
    uc = _generate(inst, uc)
    assert [c["step"] for c in agent.calls] == ["Genie_Instruction_N01-U01", "Genie_Instruction_N01-U01_repair"]
    assert [c["skip_cache"] for c in agent.calls] == [False, True]
    feedback = agent.calls[1]["vars"]["directly_involved_schema"]
    assert ("words acceptance, a stop or Inspire's AI steps differently from Inspire's Acceptance and Stop Rule and Platform Rules, "
            "which Inspire appends word for word") in feedback
    assert "precision must not fall below the baseline's.\" makes precision and a comparison with the baseline part of acceptance" in feedback
    assert "<<<PREVIOUS DRAFT\n" + CONFLICTING.strip() + "\nPREVIOUS DRAFT>>>" in feedback
    assert uc["genie_instruction_status"] == "success" and uc["genie_contract_conflicts"] == []
    assert "must not fall below" not in uc["genie_instruction"] and uc["genie_instruction"].count(TITLE) == 1


@pytest.mark.parametrize("quality", ["Good", "Ultra High"])
def test_a_draft_that_keeps_contradicting_the_rule_is_emitted_with_inspires_section_winning(agent_ns, quality):
    agent = FakeAgent([CONFLICTING] * 6)
    inst, uc, _spec_b = _spec(agent_ns, "B", quality=quality, agent=agent)
    uc = _generate(inst, uc)
    assert len(agent.calls) == 1 + agent_ns["GENIE_INSTRUCTION_REPAIR_ROUNDS"]
    assert uc["genie_instruction_status"] == "validation_errors" and len(uc["genie_contract_conflicts"]) == 1
    assert uc["genie_validation_errors"] == [] and TITLE in uc["genie_instruction"]
    cell = inst._genie_instruction_cell_source(uc, uc["genie_instruction"])
    assert "Inspire's Acceptance and Stop Rule and Platform Rules below win over these sentences of the instruction: " in cell
    assert uc["genie_contract_conflicts"][0] in cell


def test_off_mode_still_repairs_a_draft_against_the_rule(agent_ns, monkeypatch):
    monkeypatch.setenv("INSPIRE_GENIE_HALLUCINATION_MODE", "off")
    agent = FakeAgent([CONFLICTING, AGREEING])
    inst, uc, _spec_b = _spec(agent_ns, "B", quality="Good", agent=agent)
    uc = _generate(inst, uc)
    assert len(agent.calls) == 2 and uc["genie_instruction_status"] == "unverified" and uc["genie_contract_conflicts"] == []


def test_a_repair_round_without_a_draft_keeps_the_last_one(agent_ns):
    agent = FakeAgent([CONFLICTING, ""])
    inst, uc, _spec_b = _spec(agent_ns, "B", quality="Good", agent=agent)
    uc = _generate(inst, uc)
    assert len(agent.calls) == 2 and uc["genie_instruction_status"] == "validation_errors"
    assert "precision must not fall below" in uc["genie_instruction"]


def test_the_repair_text_asks_for_as_many_sections_as_the_prompt(agent_ns):
    template = agent_ns["PROMPT_TEMPLATES"]["USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT"]
    sections = re.search(r"EXACTLY these (\d+) sections", template).group(1)
    assert len(re.findall(r"^## \d+\. ", template, re.M)) == int(sections)
    feedback = agent_ns["DatabricksInspire"]._genie_repair_feedback(["x.y"], [], 0, ["c"], "draft")
    assert f"Rewrite the complete {sections}-section instruction." in feedback


def _recovering(agent_ns, stored, fresh=None, error=None):
    inst, uc, _spec_b = _spec(agent_ns, "B")
    uc["genie_instruction"] = stored
    calls = []

    def write(row, uc_id, reason=""):
        calls.append((row, uc_id, reason))
        if error:
            raise error
        return dict(uc, genie_instruction=fresh)

    inst._implement_write_instruction = write
    return inst, uc, calls


def test_a_saved_instruction_against_the_rule_is_written_again_before_the_build(agent_ns):
    inst, uc, calls = _recovering(agent_ns, CONFLICTING, fresh=AGREEING)
    warnings = []
    got = inst._implement_recover_instruction({"id": "N01-U01"}, "N01-U01", uc, warnings)
    assert got["genie_instruction"] == AGREEING and warnings == []
    assert len(calls) == 1 and calls[0][1] == "N01-U01"
    assert calls[0][2].startswith("the saved Genie Code instruction words acceptance, a stop or Inspire's AI steps differently from "
                                  "Inspire's Acceptance and Stop Rule and Platform Rules in 1 sentence, so Inspire writes it again: "
                                  "\"**Acceptance**: require top-k agreement")


def test_a_saved_instruction_that_agrees_is_kept(agent_ns):
    inst, uc, calls = _recovering(agent_ns, AGREEING)
    assert inst._implement_recover_instruction({"id": "N01-U01"}, "N01-U01", uc, []) is uc and calls == []


def test_a_rewrite_that_fails_keeps_the_saved_instruction_and_warns(agent_ns):
    inst, uc, _calls = _recovering(agent_ns, CONFLICTING, error=RuntimeError("the LLM timed out"))
    warnings = []
    assert inst._implement_recover_instruction({"id": "N01-U01"}, "N01-U01", uc, warnings) is uc
    assert warnings == ["Instruction: 1 sentence of the saved instruction words acceptance, a stop or Inspire's AI steps differently "
                        "from Inspire's Acceptance and Stop Rule and Platform Rules, and writing it again failed (the LLM timed out); "
                        "those sections win over it"]


def test_a_rewrite_that_still_disagrees_warns(agent_ns):
    inst, uc, _calls = _recovering(agent_ns, CONFLICTING, fresh=CONFLICTING)
    warnings = []
    inst._implement_recover_instruction({"id": "N01-U01"}, "N01-U01", uc, warnings)
    assert warnings == ["Instruction: 1 sentence still words acceptance, a stop or Inspire's AI steps differently after 3 repair "
                        "rounds; Inspire's Acceptance and Stop Rule and Platform Rules win over it"]


def test_the_rewrite_for_the_build_skips_the_llm_cache(agent_ns):
    inst, uc, _spec_b = _spec(agent_ns, "B")
    seen = []
    inst._row_to_uc = lambda row: dict(row)
    inst._load_session_context = lambda sid: {}
    inst._apply_session_context = lambda ctx: None
    inst._build_schema_details_from_use_cases = lambda ucs: []
    inst._build_genie_schema_index = lambda details: {}
    inst._run_genie_waves = lambda ucs, *a: seen.extend(dict(u) for u in ucs)
    with pytest.raises(RuntimeError, match="wrote 0 of 1"):
        inst._regenerate_genie_for_flagged_rows([dict(uc, _source_session_id=7)], "Implement", skip_cache=True)
    with pytest.raises(RuntimeError, match="wrote 0 of 1"):
        inst._regenerate_genie_for_flagged_rows([dict(uc, _source_session_id=7)], "Implement")
    assert [u.get("_skip_llm_cache") for u in seen] == [True, None]


def _build_flow(agent_ns, sdk_stub_calls, written_by):
    inst = _probe_inspire(agent_ns, None, {"notebook": {"modified_at": 1000, "spec_version": written_by, "result_history": 1},
                                           "dashboard": {"state": "ready", "spec_version": 2}})
    inst._implement_notebook_modified_at = lambda path: 1000
    inst._implement_claim_notebook = lambda use_case, spec, key, asset_status, current="": "/W/nb"
    inst._implement_runner = lambda uc: "runner"
    inst._implement_write_notebook = lambda uc, spec, previous, key, current="": sdk_stub_calls.append(("write", uc["genie_instruction"])) or "/W/nb"
    inst._implement_refresh_run_controls = lambda uc_id, key, use_case, spec_nb, path, status, warnings: sdk_stub_calls.append(("controls",))
    inst._implement_fill_and_preview = lambda *a: sdk_stub_calls.append(("fill",)) or ({"status": "written", "rows_written": 12}, 77, {})
    inst._implement_dashboard = lambda c, r: {"dashboard_id": "d1", "dashboard_url": "https://h/d"}
    inst._implement_genie_space = lambda c, r: {"genie_space_id": "g1", "genie_space_url": "https://h/genie/rooms/g1"}
    inst._implement_app = lambda c, r: {"app_name": "churn-desk", "app_url": "https://churn-desk.example", "app_health": "running"}
    return inst


@pytest.mark.parametrize("written_by,refilled", [(3, True), (2, False)], ids=["rebuilt", "kept"])
def test_the_build_writes_the_instruction_again_only_when_it_rebuilds_the_notebook(agent_ns, sdk_stub, written_by, refilled):
    calls = []
    inst = _build_flow(agent_ns, calls, written_by)
    inst._implement_recover_instruction = lambda row, uc_id, use_case, warnings: (
        calls.append(("recover", use_case["genie_instruction"])) or dict(use_case, genie_instruction="Build v2"))
    inst._implement_fallback_warning = lambda *a: ""
    got = inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 4, "spec_json": dict(VALID)},
                                     (5150, "N01-U01", 4))
    assert got == "ready"
    if refilled:
        assert calls[:2] == [("recover", "Build"), ("write", "Build v2")]
    else:
        assert [c[0] for c in calls] == ["controls", "fill"]


def test_a_build_whose_outputs_show_the_baseline_ends_ready_with_that_warning(agent_ns, sdk_stub):
    calls = []
    inst = _build_flow(agent_ns, calls, 3)
    warning = "Notebook: no model passed acceptance on the latest run, so no model is registered and its rows are the baseline's (z)"
    seen = []
    inst._implement_fallback_warning = lambda uc_id, table, use_case, spec_nb: seen.append((uc_id, table)) or warning
    got = inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 4, "spec_json": dict(VALID)},
                                     (5150, "N01-U01", 4))
    assert got == "ready_with_warnings" and seen == [("N01-U01", "main.inspire.churn_out")]
    assert warning in inst.updates[-1]["status_message"]


def _b_flow(agent_ns, previews, family="B"):
    inst = _flow_inspire(agent_ns, previews)
    inst._genie_notebook_spec = lambda uc: dict(_NB_SPEC, family=family, decision_basis=agent_ns["GENIE_FAMILY_DECISION_BASIS"][family])
    return inst


NO_MODEL = "No approved model yet: candidate precision 0.455 was below baseline precision 0.527."


def test_a_genie_stop_on_a_failed_acceptance_goes_back_to_genie_to_write_the_baselines_rows(agent_ns):
    inst = _b_flow(agent_ns, [({"status": "written", "rows_written": 40}, 11, 101)])
    runner = _FakeRunner([{"exit": 0, "final": dict(_fill(), status="stopped", stop_reason=NO_MODEL)}, {"exit": 0, "final": _fill()}])
    outcome, _job, fill = inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), {}, agent_ns["validate_implement_spec"](VALID)[0],
                                                           None, "/W/nb", ["result_table", "run_profile"], runner, True)
    assert outcome == {"status": "written", "rows_written": 40} and fill["status"] == "built" and len(runner.prompts) == 2
    assert ('the run stopped with "No approved model yet", but that is not a stop for this use case: When no candidate passes the '
            "acceptance rule") in runner.prompts[1]
    assert "writes the baseline's rows" in runner.prompts[1] and "return status 'written'" in runner.prompts[1]
    sent = [e for e in inst.emitted if e["step_name"] == "Genie build" and (e.get("result_json") or {}).get("failure")]
    assert len(sent) == 1 and sent[0]["status"] == "started" and sent[0]["message"].startswith("round 1/3: the run stopped with")


def test_a_genie_that_keeps_stopping_on_acceptance_ends_the_build_with_the_reason(agent_ns):
    inst = _b_flow(agent_ns, [])
    stopped = {"exit": 0, "final": dict(_fill(), status="stopped", stop_reason=NO_MODEL)}
    runner = _FakeRunner([stopped] * 3)
    spec = agent_ns["validate_implement_spec"](VALID)[0]
    outcome, _job, _f = inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), {}, spec, None, "/W/nb",
                                                         ["result_table", "run_profile"], runner, True)
    assert len(runner.prompts) == 3 and outcome["status"] == "stopped" and outcome["sent_back"] is True
    message = agent_ns["implement_stop_message"](outcome, spec)
    assert message.startswith("Genie stopped the build: No approved model yet: candidate precision 0.455 was below baseline precision "
                              "0.527. Inspire sent it back to Genie, and it still stopped: the run "
                              'stopped with "No approved model yet", but that is not a stop for this use case')


def test_a_preview_that_stops_on_acceptance_goes_back_to_genie(agent_ns):
    inst = _b_flow(agent_ns, [({"status": "stopped", "stop_reason": NO_MODEL}, 11, 101), ({"status": "written", "rows_written": 9}, 11, 102)])
    runner = _FakeRunner([{"exit": 0, "final": _fill()}, {"exit": 0, "final": _fill()}])
    outcome, _job, _f = inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), {}, agent_ns["validate_implement_spec"](VALID)[0],
                                                         None, "/W/nb", ["result_table", "run_profile"], runner, True)
    assert outcome == {"status": "written", "rows_written": 9} and len(runner.prompts) == 2
    assert "run_profile=preview after your last attempt, and the run stopped with \"No approved model yet\"" in runner.prompts[1]


def test_a_preview_only_rerun_that_stops_on_acceptance_says_to_build_again(agent_ns):
    inst = _b_flow(agent_ns, [({"status": "stopped", "stop_reason": NO_MODEL}, 11, 101)])
    spec = agent_ns["validate_implement_spec"](VALID)[0]
    outcome, _job, _f = inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 2), {}, spec, None, "/W/nb", ["run_profile"],
                                                         None, False)
    assert outcome["status"] == "stopped" and outcome["sent_back"] is False and outcome["not_a_stop"]
    assert ". Build the notebook again with Edit MVP on the Build page: the run stopped with" in agent_ns["implement_stop_message"](outcome, spec)


@pytest.mark.parametrize("family,reason", [("B", "row_count 10 is below the 1000 this use case needs"),
                                           ("G", "AI processing failed the error-rate check: 0.4 of rows failed"),
                                           ("F", "History covers 1 closed outcome window")])
def test_a_real_stop_still_ends_the_build_at_once(agent_ns, family, reason):
    inst = _b_flow(agent_ns, [], family=family)
    runner = _FakeRunner([{"exit": 0, "final": dict(_fill(), status="stopped", stop_reason=reason)}])
    outcome, _job, _f = inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), {}, agent_ns["validate_implement_spec"](VALID)[0],
                                                         None, "/W/nb", ["result_table", "run_profile"], runner, True)
    assert outcome == {"status": "stopped", "stop_reason": reason, "stopped_by": "genie"} and len(runner.prompts) == 1


DRIVER_ASK = "each driver's name and license number next to every flagged trip"
DRIVER_STOP = "The review queue cannot show each driver's name because the source table has no driver columns; no rows were written."


def _vibed(agent_ns, notes=DRIVER_ASK, state="ready", **outputs):
    spec = agent_ns["validate_implement_spec"](dict(VALID, data=dict(VALID["data"], notes=notes),
                                                    outputs=dict(VALID["outputs"], **outputs)))[0]
    built = {"notebook": {"state": state, "spec_version": 1}} if state else {}
    return spec, {"_implement_vibe_state": {"asset_status": built, "vibes_split": {}, "notebook_before": None}}


def _vibe_flow(agent_ns, previews, fills):
    inst = _b_flow(agent_ns, previews, family="F")
    inst._implement_notebook_round_vibes = lambda *a: None
    return inst, _FakeRunner(fills)


def _fill_and_preview(inst, spec, use_case, runner, refill=True):
    return inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 2), use_case, spec, None, "/W/nb",
                                            ["result_table", "run_profile"], runner, refill)


def test_a_genie_stop_on_an_ask_of_a_notebook_that_wrote_rows_goes_back_to_genie_to_do_the_other_asks(agent_ns):
    spec, use_case = _vibed(agent_ns)
    inst, runner = _vibe_flow(agent_ns, [({"status": "written", "rows_written": 40}, 11, 101)],
                              [{"exit": 0, "final": dict(_fill(), status="stopped", stop_reason=DRIVER_STOP)}, {"exit": 0, "final": _fill()}])
    outcome, _job, fill = _fill_and_preview(inst, spec, use_case, runner)
    assert outcome["status"] == "written" and outcome["rows_written"] == 40 and len(runner.prompts) == 2
    assert agent_ns["IMPLEMENT_ASK_STOP_REPAIR"] in runner.prompts[1]
    assert "an ask that cannot be done is never a reason to stop the run or write nothing" in runner.prompts[1]
    sent = [e for e in inst.emitted if e["step_name"] == "Genie build" and (e.get("result_json") or {}).get("failure")]
    assert len(sent) == 1 and sent[0]["message"].startswith("round 1/3: the run stopped, but this notebook ran and wrote its rows")


@pytest.mark.parametrize("notes,state,outputs", [
    ("", "ready", {}),
    ("   ", "ready", {}),
    (DRIVER_ASK, None, {}),
    (DRIVER_ASK, "failed", {}),
], ids=["no_asks", "blank_notes", "first_build", "never_wrote"])
def test_a_stop_without_a_notebook_ask_or_a_notebook_that_wrote_rows_still_ends_the_build_at_once(agent_ns, notes, state, outputs):
    spec, use_case = _vibed(agent_ns, notes=notes, state=state, **outputs)
    inst, runner = _vibe_flow(agent_ns, [], [{"exit": 0, "final": dict(_fill(), status="stopped", stop_reason=DRIVER_STOP)}])
    outcome, _job, _f = _fill_and_preview(inst, spec, use_case, runner)
    assert outcome == {"status": "stopped", "stop_reason": DRIVER_STOP, "stopped_by": "genie"} and len(runner.prompts) == 1


def test_an_ai_reasoning_ask_alone_also_counts_as_a_notebook_ask(agent_ns):
    spec, use_case = _vibed(agent_ns, notes="", ai_reasoning_vibes="Name the driver in every reason")
    assert agent_ns["implement_notebook_asks"](spec) == {"ai_reasoning": "Name the driver in every reason"}
    inst, runner = _vibe_flow(agent_ns, [({"status": "written", "rows_written": 5}, 11, 101)],
                              [{"exit": 0, "final": dict(_fill(), status="stopped", stop_reason=DRIVER_STOP)}, {"exit": 0, "final": _fill()}])
    outcome, _job, _f = _fill_and_preview(inst, spec, use_case, runner)
    assert outcome["status"] == "written" and len(runner.prompts) == 2


def test_a_genie_that_keeps_stopping_on_an_ask_ends_the_build_saying_it_was_sent_back(agent_ns):
    spec, use_case = _vibed(agent_ns)
    inst, runner = _vibe_flow(agent_ns, [], [{"exit": 0, "final": dict(_fill(), status="stopped", stop_reason=DRIVER_STOP)}] * 3)
    outcome, _job, _f = _fill_and_preview(inst, spec, use_case, runner)
    assert len(runner.prompts) == 3 and outcome["status"] == "stopped" and outcome["sent_back"] is True
    assert agent_ns["implement_stop_message"](outcome, spec) == (
        "Genie stopped the build: " + DRIVER_STOP.rstrip(".") + ". Inspire sent it back to Genie, and it still stopped: "
        + agent_ns["IMPLEMENT_ASK_STOP_REPAIR"])


def test_a_preview_stop_on_an_ask_goes_back_to_genie_only_when_genie_builds(agent_ns):
    spec, use_case = _vibed(agent_ns)
    inst, runner = _vibe_flow(agent_ns, [({"status": "stopped", "stop_reason": DRIVER_STOP}, 11, 101),
                                         ({"status": "written", "rows_written": 9}, 11, 102)],
                              [{"exit": 0, "final": _fill()}, {"exit": 0, "final": _fill()}])
    outcome, _job, _f = _fill_and_preview(inst, spec, use_case, runner)
    assert outcome["status"] == "written" and outcome["rows_written"] == 9 and len(runner.prompts) == 2
    assert "run_profile=preview after your last attempt, and the run stopped, but this notebook ran" in runner.prompts[1]
    inst, _runner = _vibe_flow(agent_ns, [({"status": "stopped", "stop_reason": DRIVER_STOP}, 11, 101)], [])
    outcome, _job, _f = _fill_and_preview(inst, spec, use_case, None, refill=False)
    assert outcome == {"status": "stopped", "stop_reason": DRIVER_STOP}, "a preview-only run has no Genie round to send it back to"


def test_the_notebook_asks_tell_genie_an_ask_it_cannot_do_is_never_a_stop(agent_ns):
    spec, _use_case = _vibed(agent_ns)
    text = agent_ns["implement_choices_markdown"](spec)
    assert f'- The customer\'s asks for this notebook, word for word: """{DRIVER_ASK}"""' in text
    assert ("Inspire's checks on the notebook still run, and an ask that cannot be done is never a reason to stop the run or write "
            "nothing: do every other ask, keep the notebook writing its rows and leave that ask undone, and Inspire tells the user "
            "which asks were not met.") in text
    assert "never a reason to stop" not in agent_ns["implement_choices_markdown"](_vibed(agent_ns, notes="")[0])


def test_only_the_stop_phrase_of_a_pattern_that_writes_rows_is_not_a_stop(agent_ns):
    inst, _uc, spec_b = _spec(agent_ns, "B")
    _inst, _uc, spec_h = _spec(agent_ns, "H")
    _inst, _uc, spec_g = _spec(agent_ns, "G")
    assert inst._implement_acceptance_stop_problem(spec_b, "no approved model yet: precision fell") != ""
    assert inst._implement_acceptance_stop_problem(spec_h, "No better plan found: 3 plans tried").startswith(
        'the run stopped with "No better plan found", but that is not a stop for this use case: When no feasible plan beats the current plan')
    assert inst._implement_acceptance_stop_problem(spec_g, "AI processing failed the error-rate check") == ""
    assert inst._implement_acceptance_stop_problem(spec_b, "row_count 10 below 1000") == ""
    assert inst._implement_acceptance_stop_problem(spec_b, None) == ""


def _fallback(agent_ns, family, methods=None, error=None):
    inst, uc, spec = _spec(agent_ns, family)
    calls = []

    def latest(table):
        calls.append(table)
        if error:
            raise error
        return methods

    inst._implement_latest_run_methods = latest
    return inst._implement_fallback_warning("N01-U01", "main.inspire.out", uc, spec), calls


def test_a_model_pattern_whose_latest_run_registered_no_model_warns_that_the_rows_are_the_baselines(agent_ns):
    warning, calls = _fallback(agent_ns, "B", {"methods": [("robust_z", 40)], "versioned_rows": 0})
    assert calls == ["main.inspire.out"]
    assert warning == ("Notebook: no model passed acceptance on the latest run, so no model is registered and its rows are the baseline's, "
                       "from 1 method in column method; the run's summary gives the candidates' metrics against the acceptance rule")
    assert "robust_z" not in warning, "the warning counts the methods and names none the run wrote"


@pytest.mark.parametrize("family,methods,expected", [
    ("A", {"methods": [("xgboost", 40)], "versioned_rows": 40}, ""),
    ("E", {"methods": [("seasonal_naive", 30)], "versioned_rows": 0},
     "Notebook: no candidate passed acceptance on the latest run, so every row comes from the fallback seasonal_naive; the run's "
     "summary gives the candidates' metrics against the acceptance rule"),
    ("E", {"methods": [("prophet", 30)], "versioned_rows": 0}, ""),
    ("E", {"methods": [("prophet", 20), ("seasonal_naive", 10)], "versioned_rows": 0}, ""),
    ("H", {"methods": [("current_plan", 5)], "versioned_rows": 0},
     "Notebook: no candidate passed acceptance on the latest run, so every row comes from the fallback current_plan; the run's "
     "summary gives the candidates' metrics against the acceptance rule"),
    ("H", {"methods": [("milp", 5)], "versioned_rows": 0}, ""),
    ("B", None, ""),
])
def test_the_fallback_warning_fires_only_when_the_rows_are_the_fallbacks(agent_ns, family, methods, expected):
    assert _fallback(agent_ns, family, methods)[0] == expected


@pytest.mark.parametrize("family", ["F", "G"])
def test_patterns_without_a_fallback_never_read_the_methods(agent_ns, family):
    warning, calls = _fallback(agent_ns, family, {"methods": [("x", 1)], "versioned_rows": 0})
    assert warning == "" and calls == []


def test_a_fallback_check_that_cannot_read_the_table_never_fails_the_build(agent_ns):
    assert _fallback(agent_ns, "B", error=RuntimeError("TABLE_OR_VIEW_NOT_FOUND"))[0] == ""


def test_a_stop_message_without_a_send_back_is_unchanged(agent_ns):
    outcome = {"status": "stopped", "stop_reason": "row_count 10 below 1000", "stopped_by": "genie"}
    assert agent_ns["implement_stop_message"](outcome, {}) == "Genie stopped the build: row_count 10 below 1000"
