"""c35_abgrade (R16.3-R16.6): the grade half of the A/B harness reads a Contract 3 results dir and writes the verdict.

Offline, fixture dirs only. Gates: recall (a) >= 90% and expert high-value 100%, grounding (b) NEW fully-matched rate >= OLD and zero
shortlisted "not matched", answer-key recall over Match-supported items only, blind pairwise packet that hides agent labels with a
cross-family judge, spot sheet with 0 FAIL, Jaccard stability, and a missing input is FAIL "missing evidence", never PASS."""
import json
import os
import sys

import pytest

TESTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for sub in ("", "scripts"):
    path = os.path.join(TESTS, sub) if sub else TESTS
    if path not in sys.path:
        sys.path.insert(0, path)

import discover_ab_grade as g  # noqa: E402

CRITERIA = ("business_value", "credibility", "data_grounding", "actionability", "specificity", "clarity")


def uc(i, statement="Original statement"):
    return {"No": f"AI{i}", "Name": f"Reduce churn cost for segment{i}", "Statement": statement,
            "Tables Involved": f"c.s.t{i}a, c.s.t{i}b"}


def report(rows):
    out = []
    for k, (u, verdict) in enumerate(rows):
        pieces = [{"piece_no": 1, "requirement": "r", "status": "matched" if verdict == "full" else "missing",
                   "confidence": 90, "evidence": [], "gap": "" if verdict == "full" else "no data", "known_data_option": None}]
        out.append({"input_no": k + 1, "verdict": verdict, "confidence": 90,
                    "report_json": json.dumps({"input_no": k + 1, "name": u["Name"], "verdict": verdict, "pieces": pieces})})
    return out


def put(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        json.dump(data, fh)


def write_agent(out, agent, scope, shortlist, longlist, sha, reps=3, ts=0):
    for rep in range(1, reps + 1):
        base = os.path.join(out, "runs", agent, scope, str(rep))
        put(os.path.join(base, "usecases.json"), longlist)
        put(os.path.join(base, "shortlist.json"), shortlist)
        put(os.path.join(base, "timing.json"), {"submitted_at": "2026-11-28T10:00:00", "first_valued_card_at": "2026-11-28T10:10:00",
                                                  "ended_at": "2026-11-28T10:30:00"})
        put(os.path.join(base, "cost.json"), {"total_usd": 10.0})
    return {"sha": sha, "notebook_path": "nb"}


def build(out, scopes=("s1",), found=range(8), disposed=(9,), high_value=(), new_none=0, key_none=(), aa=False, old_sha="aaa", new_sha="bbb"):
    """OLD top 20: 10 data-supported (full) + 10 'none'. NEW long list holds `found`, plus `disposed` with a reason."""
    manifest = {"agents": {}, "runs": []}
    for scope in scopes:
        old = [uc(i) for i in range(20)]
        verdicts = ["full"] * 20 if aa else ["full"] * 10 + ["none"] * 10
        new_found = [uc(i, "Rewritten statement") for i in found]
        fillers = [uc(100 + k) for k in range(20 - len(new_found))]
        new_short = (new_found + fillers)[:20]
        new_long = new_short + [dict(uc(i), disposition="merged", disposition_reason="merged into a stronger case") for i in disposed]
        if aa:
            new_short, new_long = old, old
        manifest["agents"]["OLD"] = write_agent(out, "OLD", scope, old, old, old_sha)
        manifest["agents"]["NEW"] = write_agent(out, "NEW", scope, new_short, new_long, old_sha if aa else new_sha)
        put(os.path.join(out, "match", "old_top20", scope, "report.json"), report(list(zip(old, verdicts))))
        put(os.path.join(out, "match", "old_top20", scope, "input.json"),
            [{"input_no": k + 1, "name": u["Name"], "description": u["Statement"]} for k, u in enumerate(old)])
        new_verdicts = ["full"] * 20
        for k in range(new_none):
            new_verdicts[k] = "none"
        if aa:
            new_verdicts = verdicts
        put(os.path.join(out, "match", "new_top20", scope, "report.json"), report(list(zip(new_short, new_verdicts))))
        put(os.path.join(out, "match", "new_top20", scope, "input.json"),
            [{"input_no": k + 1, "name": u["Name"], "description": u["Statement"]} for k, u in enumerate(new_short)])
        key = [uc(i) for i in range(5)]
        put(os.path.join(out, "answer_key", f"{scope}.json"),
            {"scope": scope, "source": "planted", "items": [{"id": f"K{i}", "name": u["Name"], "statement": u["Statement"],
                                                            "tables": [t.strip() for t in u["Tables Involved"].split(",")],
                                                            "critical": False, "high_value": False} for i, u in enumerate(key)]})
        key_verdicts = ["none" if i in key_none else "full" for i in range(5)]
        put(os.path.join(out, "match", "answer_key", scope, "report.json"), report(list(zip(key, key_verdicts))))
        put(os.path.join(out, "match", "answer_key", scope, "input.json"),
            [{"input_no": k + 1, "name": u["Name"], "description": u["Statement"]} for k, u in enumerate(key)])
    put(os.path.join(out, "manifest.json"), manifest)
    put(os.path.join(out, "expert_high_value.json"), {scope: [f"AI{i}" for i in high_value] for scope in scopes})


def answers(out, new_better=True, tie=False, skip=()):
    key = json.load(open(os.path.join(out, "blind", "key.json")))
    for scope, mapping in key["scopes"].items():
        if scope in skip:
            continue
        new_side = [s for s, a in mapping.items() if a == "NEW"][0]
        old_side = "A" if new_side == "B" else "B"
        hi, lo = (4, 3) if new_better else (3, 4)
        if tie:
            hi = lo = 3
        put(os.path.join(out, "blind", "answers", f"{scope}.json"),
            {"preferred": "tie" if tie else (new_side if new_better else old_side),
             "scores": {new_side: {c: hi for c in CRITERIA}, old_side: {c: lo for c in CRITERIA}}})


def spot(out, verdict="PASS"):
    sheet = json.load(open(os.path.join(out, "grade", "spot_sheet.json")))
    filled = {scope: {row["id"]: verdict for row in rows} for scope, rows in sheet.items()}
    put(os.path.join(out, "spot", "answers.json"), filled)


def grade(out, **kw):
    kw.setdefault("value_fn", lambda u: 10.0)
    kw.setdefault("generator_endpoint", "databricks-gpt-5")
    kw.setdefault("judge_endpoint", "databricks-gemini-3")
    return g.run_grade(str(out), seed=7, **kw)


def full(out, **kw):
    """First pass writes the packets and the spot sheet; the expert fills them; second pass is the verdict."""
    build(str(out), **{k: v for k, v in kw.items() if k in ("scopes", "found", "disposed", "high_value", "new_none", "key_none", "aa")})
    grade(out)
    answers(str(out), tie=kw.get("aa", False))
    spot(str(out))
    return grade(out)


def test_recall_90_percent_passes_80_fails_and_high_value_is_absolute(tmp_path):
    ok = full(tmp_path / "a")
    assert ok["scopes"]["s1"]["recall"]["pct"] == 90.0
    assert ok["scopes"]["s1"]["gates"]["recall"]["status"] == "PASS"
    assert ok["scopes"]["s1"]["verdict"] == "PASS"
    no_disp = full(tmp_path / "b", disposed=())
    assert no_disp["scopes"]["s1"]["recall"]["pct"] == 80.0
    assert no_disp["scopes"]["s1"]["gates"]["recall"]["status"] == "FAIL"
    hv = full(tmp_path / "c", high_value=(3,), disposed=(), found=range(9))
    assert hv["scopes"]["s1"]["gates"]["recall"]["status"] == "PASS"
    assert hv["scopes"]["s1"]["gates"]["recall_high_value"]["status"] == "PASS"
    miss = full(tmp_path / "d", high_value=(9,))
    assert miss["scopes"]["s1"]["gates"]["recall"]["status"] == "PASS"
    assert miss["scopes"]["s1"]["gates"]["recall_high_value"]["status"] == "FAIL"
    assert miss["scopes"]["s1"]["verdict"] == "FAIL"


def test_grounding_fails_on_one_shortlisted_not_matched(tmp_path):
    ok = full(tmp_path / "a")
    assert ok["scopes"]["s1"]["gates"]["grounding"]["status"] == "PASS"
    bad = full(tmp_path / "b", new_none=1)
    assert bad["scopes"]["s1"]["gates"]["grounding"]["status"] == "FAIL"
    assert bad["scopes"]["s1"]["grounding"]["new_not_matched"] == 1
    assert bad["scopes"]["s1"]["gaps"], "per-piece gap list"


def test_answer_key_recall_excludes_items_match_marks_none(tmp_path):
    # key items 0-4; NEW finds 0-3 only (found=range(4)). Item 4 is none -> excluded; counted it would be 80%.
    res = full(tmp_path / "a", found=range(4), disposed=(), key_none=(4,))
    key = res["scopes"]["s1"]["answer_key"]
    assert key["denominator"] == 4 and key["pct"] == 100.0
    assert res["scopes"]["s1"]["gates"]["answer_key"]["status"] == "PASS"
    res2 = full(tmp_path / "b", found=range(4), disposed=())
    assert res2["scopes"]["s1"]["answer_key"]["denominator"] == 5
    assert res2["scopes"]["s1"]["gates"]["answer_key"]["status"] == "FAIL"


def test_blind_packet_hides_labels_and_order_differs_and_same_family_judge_refused(tmp_path):
    scopes = tuple(f"s{i}" for i in range(6))
    build(str(tmp_path), scopes=scopes, old_sha="1a2b3c4d5e6f", new_sha="9f8e7d6c5b4a")
    grade(tmp_path)
    packets = sorted(os.listdir(tmp_path / "blind" / "packets"))
    assert packets
    text = "".join(open(tmp_path / "blind" / "packets" / p).read() for p in packets)
    for banned in ("OLD", "NEW", "1a2b3c4d5e6f", "9f8e7d6c5b4a", "1a2b3c4", "9f8e7d6"):
        assert banned not in text
    key = json.load(open(tmp_path / "blind" / "key.json"))
    assert key["seed"] == 7
    sides = {tuple(sorted(m.items())) for m in key["scopes"].values()}
    assert len(sides) == 2, "A/B assignment must differ across scopes"
    assert os.listdir(tmp_path / "blind" / "judge")
    with pytest.raises(ValueError):
        grade(tmp_path, generator_endpoint="databricks-claude-opus-4", judge_endpoint="databricks-claude-sonnet-4")
    grade(tmp_path, generator_endpoint="databricks-claude-opus-4", judge_endpoint="databricks-gpt-5")


def test_verdict_missing_blind_answers_is_fail_and_threshold_inputs_pass(tmp_path):
    build(str(tmp_path / "a"))
    grade(tmp_path / "a")
    spot(str(tmp_path / "a"))
    res = grade(tmp_path / "a")
    assert res["scopes"]["s1"]["verdict"] == "FAIL"
    assert "missing evidence" in res["scopes"]["s1"]["gates"]["blind"]["detail"]
    assert "FAIL" in (tmp_path / "a" / "grade" / "verdict.md").read_text()
    ok = full(tmp_path / "b")
    assert ok["verdict"] == "PASS"
    md = (tmp_path / "b" / "grade" / "verdict.md").read_text()
    for col in ("recall", "grounding", "preference", "rubric", "value", "latency", "cost"):
        assert col in md.lower()


def test_spot_fail_and_unfilled_sheet(tmp_path):
    build(str(tmp_path))
    grade(tmp_path)
    answers(str(tmp_path))
    res = grade(tmp_path)
    assert res["scopes"]["s1"]["gates"]["spot"]["detail"].startswith("missing evidence")
    sheet = json.load(open(tmp_path / "grade" / "spot_sheet.json"))
    assert len(sheet["s1"]) == 3
    spot(str(tmp_path), verdict="FAIL")
    assert grade(tmp_path)["scopes"]["s1"]["gates"]["spot"]["status"] == "FAIL"


def test_aa_identical_dirs_pass_all_gates_but_business_value_is_a_tie(tmp_path):
    res = full(tmp_path, aa=True)
    gates = res["scopes"]["s1"]["gates"]
    assert gates["business_or_credibility"]["status"] == "TIE"
    for name, gate in gates.items():
        if name != "business_or_credibility":
            assert gate["status"] == "PASS", (name, gate)
    assert res["scopes"]["s1"]["verdict"] != "PASS"
