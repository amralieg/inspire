"""Keep the rest compares the App before and after with one Ask Genie rule.

A live rc.4 build (N01-U01 v9, ask "Add a KPI card ... Keep everything else exactly as it is") was held in
all 3 rounds: after v8 shipped, the Genie Agent lost the example SQL of 2 of its 5 sample questions, so Inspire dropped
those 2 suggestions from the new page while the v8 page still held them, and keep the rest blamed Genie for a change
Inspire made. Genie put the questions back each round and Inspire dropped them again.
"""
import json

from v197_genie_question_rows_test import ACT, REASONS, SPREAD, _app_genie, _logged
from v218_keep_rest_live_test import KEEP, LABEL, V4, _shell

PROOFS = [{"question": REASONS, "rows": 0, "error": ""}, {"question": ACT, "rows": 2, "error": ""},
          {"question": SPREAD, "rows": 3, "error": ""}]
SHIPPED = [REASONS, ACT, SPREAD]


def _prior_flow(ns, tmp_path, questions=SHIPPED, proofs=PROOFS):
    inst, context, _seen, _reads = _app_genie(ns, tmp_path, list(questions))
    context["genie_proofs"] = proofs
    prior = dict(json.loads(json.dumps(V4)), questions=list(questions))
    inst._implement_snapshot = lambda key, name, version: {"artifact": json.loads(json.dumps(prior))}
    return inst, context, prior


def _keep():
    return [("app", {"ask": "Add a KPI card that counts the bills in the Act now tier", "check": None, "draws": "kpi", "keep": False,
                     "where": ""}),
            ("app", {"ask": KEEP, "check": None, "keep": True, "where": ""})]


def test_the_version_before_is_read_with_the_suggestions_inspire_keeps_today(agent_ns, tmp_path):
    inst, context, _prior = _prior_flow(agent_ns, tmp_path)
    before = inst._implement_previous_artifact(context, "app", {"spec_version": 8, "snapshot": True})
    assert before["questions"] == [ACT, SPREAD]
    assert _logged(inst, "INFO", "[IMPLEMENT-PRIOR-QUESTIONS FIRED] N01-U01")
    assert inst._implement_previous_artifact(context, "app", {"spec_version": 8, "snapshot": True}) is before


def test_keep_the_rest_is_done_when_only_inspire_dropped_the_unproven_suggestion(agent_ns, tmp_path):
    inst, context, prior = _prior_flow(agent_ns, tmp_path)
    new, _warnings = inst._implement_app_questions(context, dict(prior))
    assert new["questions"] == [ACT, SPREAD]
    kept = agent_ns["implement_vibes_rest_kept"]
    raw = kept("app", _keep(), prior, new, LABEL, _shell())
    assert raw[0] == "missing" and "page header" in raw[1], "the shipped page against today's rule is the live false miss"
    before = inst._implement_previous_artifact(context, "app", {"spec_version": 8, "snapshot": True})
    assert kept("app", _keep(), before, new, LABEL, _shell())[0] == "done"


def test_a_header_question_genie_really_changed_still_leaves_keep_the_rest_missing(agent_ns, tmp_path):
    inst, context, prior = _prior_flow(agent_ns, tmp_path)
    before = inst._implement_previous_artifact(context, "app", {"spec_version": 8, "snapshot": True})
    proofs = PROOFS + [{"question": "How many bills are late?", "rows": 4, "error": ""}]
    context["genie_proofs"] = proofs
    new, _warnings = inst._implement_app_questions(context, dict(prior, questions=["How many bills are late?", SPREAD]))
    verdict = agent_ns["implement_vibes_rest_kept"]("app", _keep(), before, new, LABEL, _shell())
    assert verdict[0] == "missing" and "page header" in verdict[1]


def test_a_version_before_whose_suggestions_are_all_proven_is_left_as_it_was(agent_ns, tmp_path):
    inst, context, prior = _prior_flow(agent_ns, tmp_path, questions=[ACT, SPREAD])
    before = inst._implement_previous_artifact(context, "app", {"spec_version": 8, "snapshot": True})
    assert before == prior
    assert not _logged(inst, "INFO", "[IMPLEMENT-PRIOR-QUESTIONS FIRED]")


def test_other_outputs_and_a_missing_snapshot_are_untouched(agent_ns, tmp_path):
    inst, context, prior = _prior_flow(agent_ns, tmp_path)
    assert inst._implement_prior_questions(context, "dashboard", prior) is prior
    assert inst._implement_prior_questions(context, "app", None) is None
    assert inst._implement_previous_artifact(context, "genie_space", {"spec_version": 8}) is None


def test_an_app_with_no_genie_agent_keeps_the_version_before_as_it_was(agent_ns, tmp_path):
    inst, context, prior = _prior_flow(agent_ns, tmp_path)
    inst._implement_app_genie = lambda context: (None, "no Genie Agent")
    assert inst._implement_prior_questions(context, "app", prior) is prior
