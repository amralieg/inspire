"""c35_abgrade (R16.3-R16.6): grade half of the Discover A/B harness.

Input: a Contract 3 results dir written by c35_abrun (see briefs/c35_plan.md). Output: <out>/grade/*.json and <out>/grade/verdict.md.
Extra inputs the expert or a later step supplies (all missing inputs make the gate FAIL "missing evidence", never PASS):
  <out>/answer_key/<scope>.json         Contract 2 answer key of the scope (copied by the runner)
  <out>/expert_high_value.json          {"<scope>": ["<OLD item No>", ...]}
  <out>/blind/answers/<scope>.json      {"preferred": "A"|"B"|"tie", "scores": {"A": {criterion: 1-5}, "B": {...}}}
  <out>/spot/answers.json               {"<scope>": {"<item id>": "PASS"|"PARTIAL"|"FAIL"}}
  <out>/sql_results.json                {"<scope>/<item No>/<n>": true|false} for grade/sql_to_rerun.json
Matching reuses the notebook's _uc_dedup_signature (via _agentload) and semantic_compare's text similarity; there is no second matcher.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
from html import escape
from pathlib import Path

HERE = Path(__file__).resolve().parent
AGENT_TESTS = HERE.parent
sys.path.insert(0, str(HERE))

RECALL_MIN = 90.0
KEY_MIN = 90.0
DISPOSITIONS = ("merged", "overlapping", "lower_marginal", "no_evidence")
CRITERIA = {
    "business_value": "How much money or risk the use case moves, stated in terms a business owner accepts.",
    "credibility": "Whether the claim is believable and traceable to the named data.",
    "data_grounding": "Whether the named tables and columns really support the use case.",
    "actionability": "Whether a team could act on it next week.",
    "specificity": "Whether it names a concrete decision, entity and outcome rather than a generic theme.",
    "clarity": "Whether the statement is short, plain and unambiguous.",
}
PACKET_FIELDS = ("Name", "Statement", "Solution", "Tables Involved", "Business Value", "Expected Key Results")
INFO_GATES = ("rubric_mean", "business_or_credibility")
SIMILAR = 0.6
_CACHE = {}


def read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=1, sort_keys=True, default=str)


def gate(status, detail=""):
    return {"status": status, "detail": detail}


def missing(what):
    return gate("FAIL", f"missing evidence: {what}")


# ---------------------------------------------------------------- matching

def _namespace():
    if "ns" not in _CACHE:
        sys.path.insert(0, str(AGENT_TESTS))
        import _agentload
        _CACHE["ns"] = _agentload.load_agent_namespace()
    return _CACHE["ns"]


def notebook_signature(uc):
    if "agent" not in _CACHE:
        _CACHE["agent"] = object.__new__(_namespace()["DatabricksInspire"])
    return _CACHE["agent"]._uc_dedup_signature(uc)


def notebook_value(uc):
    """Today's calculator, inspire_value_estimate; the R12 calculator replaces it at this one call site."""
    est = _namespace()["inspire_value_estimate"](uc, "", "")
    if isinstance(est, dict) and est.get("status") == "measured":
        return (float(est.get("value_low") or 0) + float(est.get("value_high") or 0)) / 2
    return 0.0


def _text(uc):
    return f"{uc.get('Name', '')} {uc.get('Statement', '')}"


class Matcher:
    """One use case matches another when the notebook signature is equal, or when verb family and main tables are equal
    and the text (name + statement) is close by semantic_compare's char-3gram cosine."""

    def __init__(self, signature_fn=None):
        self.sig = signature_fn or notebook_signature
        self._memo = {}

    def signature(self, uc):
        key = json.dumps(uc, sort_keys=True, default=str)
        if key not in self._memo:
            self._memo[key] = self.sig(uc)
        return self._memo[key]

    def same(self, a, b):
        sa, sb = self.signature(a), self.signature(b)
        if sa == sb:
            return True
        if sa[0] != sb[0] or sa[2] != sb[2]:
            return False
        import semantic_compare
        return semantic_compare._rc45_char3gram_cosine(_text(a), _text(b)) >= SIMILAR

    def find(self, uc, pool):
        return next((row for row in pool if self.same(uc, row)), None)


def is_disposed(row):
    return str(row.get("disposition") or "").strip().lower() not in ("", "kept", "shortlisted")


# ---------------------------------------------------------------- readers

def run_dir(out, agent, scope, rep="1"):
    return os.path.join(out, "runs", agent, scope, str(rep))


def reps_of(out, agent, scope):
    base = os.path.join(out, "runs", agent, scope)
    return sorted(d for d in os.listdir(base) if os.path.isdir(os.path.join(base, d))) if os.path.isdir(base) else []


def match_rows(out, feed, scope):
    """{input_no: row} with report_json decoded; None when the feed is absent."""
    rows = read_json(os.path.join(out, "match", feed, scope, "report.json"))
    if rows is None:
        return None
    result = {}
    for row in rows:
        rj = row.get("report_json")
        rj = json.loads(rj) if isinstance(rj, str) else (rj or {})
        result[int(row.get("input_no"))] = {**row, "report": rj, "verdict": str(row.get("verdict") or rj.get("verdict") or "").lower()}
    return result


def key_as_uc(item):
    return {"No": item.get("id"), "Name": item.get("name"), "Statement": item.get("statement"),
            "Tables Involved": ", ".join(item.get("tables") or [])}


# ---------------------------------------------------------------- gates

def grade_recall(out, scope, matcher):
    old = read_json(os.path.join(run_dir(out, "OLD", scope), "shortlist.json"))
    new_long = read_json(os.path.join(run_dir(out, "NEW", scope), "usecases.json"))
    report = match_rows(out, "old_top20", scope)
    high = (read_json(os.path.join(out, "expert_high_value.json")) or {}).get(scope)
    if old is None or new_long is None or report is None:
        return {"pct": None}, {"recall": missing("OLD shortlist, NEW long list or old_top20 Match report"),
                               "recall_high_value": missing("recall inputs")}
    kept = [r for r in new_long if not is_disposed(r)]
    disposed = [r for r in new_long if is_disposed(r)]
    rows = []
    for k, item in enumerate(old[:20]):
        if report.get(k + 1, {}).get("verdict") not in ("full", "partial"):
            continue
        if matcher.find(item, kept):
            state, reason = "found", ""
        else:
            hit = matcher.find(item, disposed)
            reason = str((hit or {}).get("disposition_reason") or "").strip()
            disp = str((hit or {}).get("disposition") or "").lower()
            state = "disposed" if hit and disp in DISPOSITIONS and reason else "missing"
        rows.append({"id": item.get("No"), "name": item.get("Name"), "state": state, "reason": reason})
    total = len(rows)
    if not total:
        return {"pct": None, "items": []}, {"recall": missing("no OLD top-20 item is data-supported in the Match report"),
                                           "recall_high_value": missing("no data-supported OLD item")}
    ok = sum(r["state"] != "missing" for r in rows)
    pct = round(100.0 * ok / total, 1)
    gates = {"recall": gate("PASS" if pct >= RECALL_MIN else "FAIL", f"{ok}/{total} = {pct}% (gate {RECALL_MIN}%)")}
    if high is None:
        gates["recall_high_value"] = missing("expert_high_value.json for this scope")
    else:
        lost = [r["id"] for r in rows if r["id"] in high and r["state"] != "found"]
        lost += [i for i in high if i not in [r["id"] for r in rows]]
        gates["recall_high_value"] = gate("FAIL" if lost else "PASS", f"not found: {lost}" if lost else f"{len(high)} high-value items found")
    return {"pct": pct, "found": ok, "supported": total, "items": rows}, gates


def grade_grounding(out, scope):
    old, new = match_rows(out, "old_top20", scope), match_rows(out, "new_top20", scope)
    if old is None or new is None:
        return {}, [], gate("FAIL", "missing evidence: old_top20 / new_top20 Match reports")

    def rate(rows):
        return round(100.0 * sum(r["verdict"] == "full" for r in rows.values()) / max(len(rows), 1), 1)

    not_matched = sum(r["verdict"] == "none" for r in new.values())
    gaps = [{"input_no": no, "name": row["report"].get("name"), "piece_no": p.get("piece_no"), "requirement": p.get("requirement"),
             "gap": p.get("gap")} for no, row in sorted(new.items()) for p in row["report"].get("pieces") or [] if p.get("gap")]
    info = {"old_full_pct": rate(old), "new_full_pct": rate(new), "new_not_matched": not_matched}
    bad = []
    if info["new_full_pct"] < info["old_full_pct"]:
        bad.append(f"NEW fully matched {info['new_full_pct']}% < OLD {info['old_full_pct']}%")
    if not_matched:
        bad.append(f"{not_matched} shortlisted use cases are 'not matched'")
    return info, gaps, gate("FAIL" if bad else "PASS", "; ".join(bad) or f"NEW {info['new_full_pct']}% >= OLD {info['old_full_pct']}%, 0 not matched")


def grade_answer_key(out, scope, matcher):
    key = read_json(os.path.join(out, "answer_key", f"{scope}.json"))
    report = match_rows(out, "answer_key", scope)
    new_long = read_json(os.path.join(run_dir(out, "NEW", scope), "usecases.json"))
    if key is None or report is None or new_long is None:
        return {}, missing("answer key, its Match report or NEW long list")
    kept = [r for r in new_long if not is_disposed(r)]
    supported = [key_as_uc(it) for k, it in enumerate(key.get("items") or []) if report.get(k + 1, {}).get("verdict") in ("full", "partial")]
    if not supported:
        return {"denominator": 0, "pct": None}, missing("no answer-key item is supported by the data per Match")
    found = [u["No"] for u in supported if matcher.find(u, kept)]
    pct = round(100.0 * len(found) / len(supported), 1)
    return ({"denominator": len(supported), "found": len(found), "pct": pct},
            gate("PASS" if pct >= KEY_MIN else "FAIL", f"{len(found)}/{len(supported)} = {pct}% (gate {KEY_MIN}%)"))


def family(endpoint):
    name = str(endpoint or "").lower()
    for fam in ("claude", "gpt", "gemini", "llama", "mistral", "gemma", "qwen"):
        if fam in name:
            return fam
    return name


def check_judge(generator_endpoint, judge_endpoint):
    if judge_endpoint and generator_endpoint and family(judge_endpoint) == family(generator_endpoint):
        raise ValueError(f"judge endpoint {judge_endpoint} is the same model family ({family(judge_endpoint)}) as the generator; "
                         "pick a different family")


def pick_sides(scopes, seed):
    """Balanced and seeded: half the scopes show the NEW list as A, half as B, in shuffled order."""
    flags = [True] * math.ceil(len(scopes) / 2) + [False] * (len(scopes) // 2)
    random.Random(seed).shuffle(flags)
    return {s: ({"A": "NEW", "B": "OLD"} if f else {"A": "OLD", "B": "NEW"}) for s, f in zip(scopes, flags)}


def clean(uc):
    return {k: uc[k] for k in PACKET_FIELDS if k in uc}


def build_blind(out, scopes, seed, judge_endpoint=None):
    sides = pick_sides(sorted(scopes), seed)
    for scope, mapping in sides.items():
        lists = {agent: [clean(u) for u in (read_json(os.path.join(run_dir(out, agent, scope), "shortlist.json")) or [])[:10]]
                 for agent in ("OLD", "NEW")}
        packet = {"scope": scope, "A": lists[mapping["A"]], "B": lists[mapping["B"]],
                  "rubric": CRITERIA, "answer_format": {"preferred": "A | B | tie", "scores": {"A": "criterion -> 1-5", "B": "criterion -> 1-5"}}}
        write_json(os.path.join(out, "blind", "packets", f"{scope}.json"), packet)
        body = "".join(f"<h2>List {side}</h2><ol>" + "".join(
            f"<li><b>{escape(str(u.get('Name', '')))}</b><br>{escape(str(u.get('Statement', '')))}<br><i>{escape(str(u.get('Tables Involved', '')))}</i></li>"
            for u in packet[side]) + "</ol>" for side in ("A", "B"))
        crit = "".join(f"<li><b>{c}</b>: {escape(d)}</li>" for c, d in CRITERIA.items())
        Path(out, "blind", "packets", f"{scope}.html").write_text(
            f"<html><body><h1>Scope {escape(scope)}</h1>{body}<h2>Rubric (1-5)</h2><ul>{crit}</ul></body></html>", encoding="utf-8")
        write_json(os.path.join(out, "blind", "judge", f"{scope}.json"), {
            "endpoint": judge_endpoint, "rubric": CRITERIA, "packet": packet,
            "instructions": "Score each list A and B on every criterion 1-5 and name the preferred list. The user's explicit input wins."})
    write_json(os.path.join(out, "blind", "key.json"), {"seed": seed, "scopes": sides})
    return sides


def grade_blind(out, scope, sides):
    ans = read_json(os.path.join(out, "blind", "answers", f"{scope}.json"))
    if not ans:
        return {}, missing("blind answers for this scope")
    mapping = sides[scope]
    scores = ans.get("scores") or {}
    by_agent = {mapping[side]: scores.get(side) or {} for side in ("A", "B")}
    if not all(by_agent[a].get(c) is not None for a in by_agent for c in CRITERIA):
        return {}, missing("blind answers lack a score for every criterion")
    pref = str(ans.get("preferred") or "").strip()
    preferred = "tie" if pref.lower() == "tie" else mapping.get(pref)
    return {"preferred": preferred, "scores": by_agent}, gate("PASS", f"preferred {preferred}")


def spot_sheet(out, scopes, seed):
    sheet = {}
    for scope in scopes:
        items = read_json(os.path.join(run_dir(out, "NEW", scope), "shortlist.json")) or []
        pick = random.Random(f"{seed}:spot:{scope}").sample(range(len(items)), min(3, len(items)))
        sheet[scope] = [{"id": items[i].get("No") or str(i), "name": items[i].get("Name"), "statement": items[i].get("Statement"),
                         "verdict": None} for i in sorted(pick)]
    write_json(os.path.join(out, "grade", "spot_sheet.json"), sheet)
    return sheet


def grade_spot(out, scope, sheet):
    filled = (read_json(os.path.join(out, "spot", "answers.json")) or {}).get(scope) or {}
    ids = [row["id"] for row in sheet.get(scope, [])]
    if not ids:
        return missing("no NEW use cases to spot-check")
    todo = [i for i in ids if str(filled.get(i) or "").upper() not in ("PASS", "PARTIAL", "FAIL")]
    if todo:
        return missing(f"spot verdicts for {todo}")
    fails = [i for i in ids if str(filled[i]).upper() == "FAIL"]
    return gate("FAIL" if fails else "PASS", f"FAIL: {fails}" if fails else f"{len(ids)} spot checks, 0 FAIL")


def jaccard_mean(out, agent, scope, matcher):
    sets = []
    for rep in reps_of(out, agent, scope):
        items = read_json(os.path.join(run_dir(out, agent, scope, rep), "shortlist.json")) or []
        sets.append({matcher.signature(u) for u in items})
    if len(sets) < 2:
        return None
    pairs = [(a, b) for i, a in enumerate(sets) for b in sets[i + 1:]]
    return round(sum(len(a & b) / max(len(a | b), 1) for a, b in pairs) / len(pairs), 3)


def grade_stability(out, scope, matcher):
    old, new = jaccard_mean(out, "OLD", scope, matcher), jaccard_mean(out, "NEW", scope, matcher)
    if old is None or new is None:
        return {"old": old, "new": new}, missing("at least 2 reps per agent")
    return {"old": old, "new": new}, gate("PASS" if new >= old else "FAIL", f"Jaccard NEW {new} vs OLD {old}")


def value_captured(out, scope, value_fn):
    result = {}
    for agent in ("OLD", "NEW"):
        items = read_json(os.path.join(run_dir(out, agent, scope), "shortlist.json")) or []
        result[agent] = round(sum(float(value_fn(u) or 0) for u in items), 2)
    return result


def sql_to_rerun(out, scope):
    items = read_json(os.path.join(run_dir(out, "NEW", scope), "shortlist.json")) or []
    return [{"key": f"{scope}/{u.get('No')}/{n}", "sql": k.get("sql")} for u in items
            for n, k in enumerate(k for k in u.get("KPIs") or [] if isinstance(k, dict) and k.get("sql"))]


def grade_reproduce(out, scope, listed):
    if not listed:
        return gate("PASS", "no stored money-card SQL to re-run")
    results = read_json(os.path.join(out, "sql_results.json"))
    todo = [r["key"] for r in listed if results is None or r["key"] not in results]
    if todo:
        return missing(f"re-run results for {len(todo)} stored SQL statements")
    bad = [r["key"] for r in listed if not results[r["key"]]]
    return gate("FAIL" if bad else "PASS", f"did not reproduce: {bad}" if bad else f"{len(listed)} money cards reproduce")


def seconds(timing):
    from datetime import datetime
    try:
        return (datetime.fromisoformat(timing["first_valued_card_at"]) - datetime.fromisoformat(timing["submitted_at"])).total_seconds()
    except (KeyError, TypeError, ValueError):
        return None


def timing_cost(out, scope):
    res = {}
    for agent in ("OLD", "NEW"):
        base = run_dir(out, agent, scope)
        res[agent] = {"latency_s": seconds(read_json(os.path.join(base, "timing.json")) or {}),
                      "cost_usd": (read_json(os.path.join(base, "cost.json")) or {}).get("total_usd")}
    return res


# ---------------------------------------------------------------- orchestration

def rubric_means(blinds):
    means = {}
    for agent in ("OLD", "NEW"):
        rows = [b["scores"][agent] for b in blinds if b]
        means[agent] = {c: round(sum(float(r[c]) for r in rows) / len(rows), 2) for c in CRITERIA} if rows else {}
    return means


def business_gate(means):
    if not means["NEW"]:
        return missing("blind rubric scores")
    diff = [means["NEW"][c] - means["OLD"][c] for c in ("business_value", "credibility")]
    if any(d > 0 for d in diff):
        return gate("PASS", "NEW higher on business value or credibility")
    return gate("TIE" if all(d == 0 for d in diff) else "FAIL", f"NEW minus OLD (business value, credibility) = {diff}")


def rubric_gate(means):
    if not means["NEW"]:
        return missing("blind rubric scores")
    low = [c for c in CRITERIA if means["NEW"][c] < means["OLD"][c]]
    return gate("FAIL" if low else "PASS", f"NEW below OLD on {low}" if low else "NEW mean >= OLD on every criterion")


def scope_verdict(gates):
    hard = [g for n, g in gates.items() if n not in INFO_GATES]
    if any(g["status"] == "FAIL" for g in hard):
        return "FAIL"
    return "TIE" if any(g["status"] == "TIE" for g in gates.values()) else "PASS"


def run_grade(out, seed=0, generator_endpoint=None, judge_endpoint=None, value_fn=None, signature_fn=None):
    check_judge(generator_endpoint, judge_endpoint)
    matcher, value_fn = Matcher(signature_fn), value_fn or notebook_value
    manifest = read_json(os.path.join(out, "manifest.json")) or {}
    agents = manifest.get("agents") or {}
    aa = bool(agents.get("OLD", {}).get("sha")) and agents.get("OLD", {}).get("sha") == agents.get("NEW", {}).get("sha")
    scopes = sorted(os.listdir(os.path.join(out, "runs", "OLD")))
    sides = build_blind(out, scopes, seed, judge_endpoint)
    sheet = spot_sheet(out, scopes, seed)
    result = {"seed": seed, "aa": aa, "scopes": {}}
    blinds = []
    for scope in scopes:
        recall, gates = grade_recall(out, scope, matcher)
        grounding, gaps, gates["grounding"] = grade_grounding(out, scope)
        key, gates["answer_key"] = grade_answer_key(out, scope, matcher)
        blind, gates["blind"] = grade_blind(out, scope, sides)
        gates["spot"] = grade_spot(out, scope, sheet)
        stability, gates["stability"] = grade_stability(out, scope, matcher)
        listed = sql_to_rerun(out, scope)
        gates["reproduce"] = grade_reproduce(out, scope, listed)
        means = rubric_means([blind] if blind else [])
        gates["rubric_mean"], gates["business_or_credibility"] = rubric_gate(means), business_gate(means)
        blinds.append(blind or None)
        result["scopes"][scope] = {
            "recall": recall, "grounding": grounding, "gaps": gaps, "answer_key": key, "blind": blind, "stability": stability,
            "value": value_captured(out, scope, value_fn), "sql_to_rerun": listed, "timing_cost": timing_cost(out, scope),
            "gates": gates, "verdict": scope_verdict(gates)}
        write_json(os.path.join(out, "grade", f"{scope}.json"), result["scopes"][scope])
    answered = [b for b in blinds if b]
    needed = math.ceil(len(scopes) * 5 / 6)
    won = sum(b["preferred"] == "NEW" or (aa and b["preferred"] == "tie") for b in answered)
    means = rubric_means(answered)
    overall = {"preference": gate("PASS" if len(answered) == len(scopes) and won >= needed else "FAIL",
                                  f"NEW preferred in {won} of {len(scopes)} scopes (need {needed})" if len(answered) == len(scopes)
                                  else "missing evidence: blind answers for some scopes"),
               "rubric_mean": rubric_gate(means) if len(answered) == len(scopes) else missing("blind answers for all scopes"),
               "business_or_credibility": business_gate(means) if len(answered) == len(scopes) else missing("blind answers for all scopes")}
    result["rubric_means"], result["gates"] = means, overall
    verdicts = [s["verdict"] for s in result["scopes"].values()]
    if "FAIL" in verdicts or any(g["status"] == "FAIL" for g in overall.values()) or not scopes:
        result["verdict"] = "FAIL"
    else:
        result["verdict"] = "TIE" if "TIE" in [g["status"] for g in overall.values()] else "PASS"
    write_json(os.path.join(out, "grade", "overall.json"), result)
    write_verdict(out, result)
    return result


def write_verdict(out, result):
    def cell(g):
        return g["status"] if g["status"] != "FAIL" or "missing" not in g["detail"] else "FAIL missing evidence"

    lines = ["# R16.6 verdict", "", f"Overall: **{result['verdict']}** (seed {result['seed']}{', A/A run' if result['aa'] else ''})", "",
             "| scope | recall (a) | grounding (b) | answer key | preference | mean rubric NEW/OLD | value captured NEW/OLD | latency NEW/OLD s | cost NEW/OLD usd | verdict |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    for scope, s in result["scopes"].items():
        rub = {a: round(sum(s["blind"]["scores"][a].values()) / len(CRITERIA), 2) for a in ("NEW", "OLD")} if s["blind"] else None
        tc = s["timing_cost"]
        lines.append("| {} | {} | {} | {} | {} | {} | {} | {} | {} | {} |".format(
            scope, cell(s["gates"]["recall"]), cell(s["gates"]["grounding"]), cell(s["gates"]["answer_key"]), cell(s["gates"]["blind"]),
            f"{rub['NEW']}/{rub['OLD']}" if rub else "missing evidence", f"{s['value']['NEW']}/{s['value']['OLD']}",
            f"{tc['NEW']['latency_s']}/{tc['OLD']['latency_s']}", f"{tc['NEW']['cost_usd']}/{tc['OLD']['cost_usd']}", s["verdict"]))
    lines += ["", "## Gates", ""]
    for scope, s in result["scopes"].items():
        lines += [f"- {scope}: " + "; ".join(f"{n} {cell(g)} ({g['detail']})" for n, g in sorted(s["gates"].items()))]
    lines += [f"- overall: " + "; ".join(f"{n} {cell(g)} ({g['detail']})" for n, g in sorted(result["gates"].items()))]
    Path(out, "grade").mkdir(parents=True, exist_ok=True)
    Path(out, "grade", "verdict.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("out")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--generator-endpoint", default=None)
    ap.add_argument("--judge-endpoint", default=None)
    args = ap.parse_args(argv)
    try:
        result = run_grade(args.out, seed=args.seed, generator_endpoint=args.generator_endpoint, judge_endpoint=args.judge_endpoint)
    except ValueError as err:
        print(f"refused: {err}", file=sys.stderr)
        return 2
    print(f"verdict {result['verdict']}: {os.path.join(args.out, 'grade', 'verdict.md')}")
    return 0 if result["verdict"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
