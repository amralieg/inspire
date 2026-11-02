import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests" / "scripts"))
import frozen_pool_gate as fpg  # noqa: E402

POOL = json.loads((ROOT / "tests" / "regression" / "tpcds_sf1_frozen_pool.json").read_text(encoding="utf-8"))
FEASIBILITY = ("data_availability", "data_accessibility", "architecture_fitness", "team_skills", "domain_knowledge",
               "people_allocation", "budget_allocation", "time_to_production")


@pytest.fixture(scope="module")
def v121_ns(tmp_path_factory):
    return fpg.load_namespace(fpg.notebook_at_tag("v1.2.1", tmp_path_factory.mktemp("reference")))


def _answer(prompt, priority=9.9, label="High"):
    ids = re.findall(r"^### Use Case: (\S+) - ", prompt, re.M)
    return json.dumps([dict({"use_case_id": uc_id, "quality_label": label, "quality_score": 4.0, "priority_score": priority,
                             "roi": 4.0, "time_to_value": 3.0, "reusability": 3.0}, **{key: 4.0 for key in FEASIBILITY})
                       for uc_id in ids])


def test_the_pool_rebuilds_the_recorded_batches_with_the_release_preamble(agent_ns):
    requests = fpg.build_requests(agent_ns, POOL)
    assert [len(batch) for batch, _prompt in requests] == [30, 30, 30, 30, 30, 30, 5]
    assert sum(len(batch) for batch, _prompt in requests) == len(POOL["use_cases"]) == 185
    for batch, prompt in requests:
        assert prompt.startswith(agent_ns["USER_DIRECTIVE_SUPREMACY_PREAMBLE"])
        assert re.findall(r"^### Use Case: (\S+) - ", prompt, re.M) == [uc["No"] for uc in batch]
    assert "**Business Priorities:**" not in requests[0][1], "the release grades blind"


def test_the_reference_template_receives_the_strategy_inputs_it_asks_for(v121_ns):
    assert v121_ns["__AGENT_VERSION__"] == "v1.2.1"
    prompt = fpg.build_requests(v121_ns, POOL)[0][1]
    assert "**Business Priorities:** Increase Revenue" in prompt
    assert "**Strategic Goals:** Increase Revenue, Protect Revenue, Reduce Cost" in prompt


def test_a_pool_missing_a_template_field_is_refused(agent_ns):
    broken = dict(POOL, grading_context={k: v for k, v in POOL["grading_context"].items() if k != "schema_details"})
    with pytest.raises(ValueError, match="schema_details"):
        fpg.build_requests(agent_ns, broken)


def test_each_version_scores_with_its_own_priority_rule(agent_ns, v121_ns):
    small = dict(POOL, use_cases=POOL["use_cases"][:3], batch_size=30)
    release_requests = fpg.build_requests(agent_ns, small)
    release, unscored = fpg.score_answers(agent_ns, release_requests, [_answer(p) for _b, p in release_requests])
    assert unscored == [] and {uc["Priority"] for uc in release} == {7.7}, "0.8 x ROI + 0.1 + 0.1, then x 1.5 + feasibility x 0.5"
    reference_requests = fpg.build_requests(v121_ns, small)
    reference, _ = fpg.score_answers(v121_ns, reference_requests, [_answer(p) for _b, p in reference_requests])
    assert {uc["Priority"] for uc in reference} == {9.9}, "v1.2.1 kept the scorer's own priority_score"
    assert all(uc["Inspire Score"] is not None for uc in release + reference)


def test_unparseable_answers_count_as_unscored(agent_ns):
    requests = fpg.build_requests(agent_ns, dict(POOL, use_cases=POOL["use_cases"][:4]))
    scored, unscored = fpg.score_answers(agent_ns, requests, ["not json"])
    assert scored == [] and [uc["No"] for uc in unscored] == [uc["No"] for uc in POOL["use_cases"][:4]]


def test_unscored_use_cases_are_sent_again_in_smaller_batches_like_the_agent_does(agent_ns):
    pool = dict(POOL, use_cases=POOL["use_cases"][:40])
    calls = []

    def ask(prompt):
        calls.append(len(re.findall(r"^### Use Case: ", prompt, re.M)))
        return "cut off" if len(calls) == 1 else _answer(prompt)

    result = fpg.measure(agent_ns, pool, ask, workers=1)
    assert calls == [30, 10, 15, 15], "the failed batch of 30 is re-sent in batches of 15"
    assert (result["scored"], result["unscored"]) == (40, 0)
    assert [r["unread_answers"] for r in result["rounds"]] == [["cut off"], []]

    def never(prompt):
        return "cut off"

    stubborn = fpg.measure(agent_ns, dict(POOL, use_cases=POOL["use_cases"][:2]), never, workers=1)
    assert (stubborn["scored"], stubborn["unscored"], len(stubborn["rounds"])) == (0, 2, 3)


def test_the_top_25_counts_must_finds_among_good_mode_use_cases_by_the_final_rank(agent_ns):
    scored = [{"No": f"U{i:02d}", "Quality": "High", "Inspire Score": 9.0 - i * 0.1} for i in range(30)]
    scored[0]["Quality"] = "Low"
    gold = {"G1": ["U00"], "G2": ["U01"], "G3": ["U25"], "G4": ["U29", "U02"], "G5": []}
    assert fpg.top_hits(agent_ns, scored, gold) == ["G2", "G3", "G4"], "U00 is Low, so U25 moves into the top 25"


def test_the_gate_allows_the_tolerance_and_refuses_more_or_broken_scoring():
    reference = {"version": "v1.2.1", "top_hits": 9, "unscored": 0}
    assert fpg.frozen_pool_gate({"version": "v1.3.0", "top_hits": 8, "unscored": 0}, reference, 1, 185) == (True, [])
    passed, reasons = fpg.frozen_pool_gate({"version": "v1.3.0", "top_hits": 7, "unscored": 0}, reference, 1, 185)
    assert not passed and "more than 1 below v1.2.1's 9" in reasons[0]
    passed, reasons = fpg.frozen_pool_gate({"version": "v1.3.0", "top_hits": 12, "unscored": 40}, reference, 1, 185)
    assert not passed and "40 of 185 release use cases came back unscored" in reasons[0]


def test_the_command_grades_both_versions_on_one_endpoint_and_exits_on_the_verdict(agent_ns, monkeypatch, tmp_path, capsys):
    sent = []

    def grader(endpoint):
        assert endpoint == "databricks-claude-opus-4-8"
        return lambda prompt: sent.append(prompt) or _answer(prompt)

    monkeypatch.setattr(fpg, "sql_grader", grader)
    monkeypatch.setattr(fpg, "notebook_at_tag", lambda tag, folder: fpg.REPO / fpg.NOTEBOOK)
    monkeypatch.setattr(fpg, "load_namespace", lambda notebook: agent_ns)
    out = tmp_path / "report.json"
    assert fpg.main(["--endpoint", "databricks-claude-opus-4-8", "--out", str(out)]) == 0
    assert len(sent) == 14 and "[FROZEN POOL GATE] PASS" in capsys.readouterr().out
    report = json.loads(out.read_text(encoding="utf-8"))
    assert report["release"]["top_hits"] == report["reference"]["top_hits"] and report["passed"] is True


def test_the_command_refuses_a_gold_set_without_a_reference_tag(tmp_path, capsys):
    gold = tmp_path / "gold.json"
    gold.write_text(json.dumps({"release_gate": {"baseline": {"found": 1}}}), encoding="utf-8")
    assert fpg.main(["--gold", str(gold), "--endpoint", "databricks-claude-opus-4-8"]) == 1
    assert "no release_gate.frozen_pool.reference_tag" in capsys.readouterr().out


def test_the_good_mode_labels_match_the_release(agent_ns):
    from _agentload import agent_source
    good = re.search(r'"Good": (\{[^}]*\})', agent_source()).group(1)
    assert eval(good) == set(fpg.GOOD_LABELS)
