"""v1.0.1 vs demos-baseline quality compare + v100 delta (measurement-only).

Adapted from v100_compare_vs_demos.py per section 3d (reuse-first).

Loads `run_logs/v101_swarm/<corpus>_v101.json` (produced by v101_pull_ucs.py)
and `demos/<corpus>/docs/Samples <corpus>-dbx_inspire.json` (baseline shipped
with the repo), runs the semantic_compare TF-IDF+cosine matcher, and writes
`run_logs/v101_swarm/<corpus>_v101_vs_demos.json` plus a top-level
`run_logs/v101_swarm/summary.json` with per-corpus and aggregate metrics.

Also loads `run_logs/v100_swarm/<corpus>_v100.json` if present and computes
v100→v101 delta (matched, envelope, priority, bob).

Metrics reported per corpus:
- matched: baseline UCs with a v101 counterpart at cosine >= high (0.55)
- weak:    baseline UCs with only cosine in [low, high) = 0.40..0.55
- missed:  baseline UCs not covered by any v101 UC (cosine < low)
- novel:   v101 UCs with no baseline pair above low
- envelope: v101 UC count / baseline UC count.
- v100_delta: {matched_delta, envelope_delta, priority_delta, bob_delta}
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
V101_ROOT = REPO / "run_logs" / "v101_swarm"
V100_ROOT = REPO / "run_logs" / "v100_swarm"
DEMOS_ROOT = REPO / "demos"

sys.path.insert(0, str(REPO / "tests" / "scripts"))
from semantic_compare import semantic_match, summarise  # noqa: E402


def _load(path: Path) -> list[dict]:
    d = json.loads(path.read_text())
    if isinstance(d, list):
        return d
    if "use_cases" in d and isinstance(d["use_cases"], list):
        return d["use_cases"]
    ucs = []
    for dom in d.get("domains", []) or []:
        for uc in dom.get("use_cases", []) or []:
            merged = dict(uc)
            merged.setdefault("business_domain", dom.get("domain_name"))
            ucs.append(merged)
    return ucs


def _first(uc: dict, *keys: str, default=""):
    for k in keys:
        v = uc.get(k)
        if v not in (None, ""):
            return v
    return default


def _canonicalize_fields(ucs: list[dict]) -> list[dict]:
    out = []
    for uc in ucs:
        name = _first(uc, "use_case", "Use Case", "usecase", "Name", "name")
        out.append(
            {
                "id": _first(uc, "id", "ID", "No", "no"),
                "use_case": name,
                "statement": _first(uc, "statement", "Statement"),
                "solution": _first(uc, "solution", "Solution"),
                "business_domain": _first(uc, "business_domain", "Business Domain", "domain"),
                "subdomain": _first(uc, "subdomain", "Subdomain"),
                "sponsor": _first(uc, "sponsor", "Sponsor"),
                "beneficiary": _first(uc, "beneficiary", "Beneficiary"),
                "primary_table": _first(uc, "primary_table", "Primary Table"),
                "tables_involved": _first(uc, "tables_involved", "Tables Involved"),
                "analytics_technique": _first(uc, "analytics_technique", "Analytics Technique"),
                "priority_score": float(_first(uc, "priority_score", "Priority Score", default=0) or 0),
                "bob_score": float(_first(uc, "bob_score", "BoB Score", default=0) or 0),
                "idea_theme": _first(uc, "idea_theme", "Idea Theme"),
                "has_genie_code": _first(uc, "has_genie_code", "Has Genie Code", default="N"),
            }
        )
    return out


def _avg(values: list[float]) -> float:
    xs = [v for v in values if v not in (None, "", 0) and v == v]
    return round(sum(xs) / len(xs), 2) if xs else 0.0


def compare_corpus(corpus: str) -> dict:
    v101_path = V101_ROOT / f"{corpus}_v101.json"
    demos_path = DEMOS_ROOT / corpus / "docs" / f"Samples {corpus}-dbx_inspire.json"
    v100_path = V100_ROOT / f"{corpus}_v100.json"

    if not v101_path.exists():
        return {"corpus": corpus, "error": f"missing v101 dump: {v101_path}"}
    if not demos_path.exists():
        return {"corpus": corpus, "error": f"missing demos baseline: {demos_path}"}

    v101 = _canonicalize_fields(_load(v101_path))
    demos = _canonicalize_fields(_load(demos_path))
    v100 = _canonicalize_fields(_load(v100_path)) if v100_path.exists() else []

    matched, weak, novel, missing = semantic_match(
        current=v101, baseline=demos, high=0.55, low=0.40
    )

    v101_avg_priority = _avg([uc["priority_score"] for uc in v101])
    v101_avg_bob = _avg([uc["bob_score"] for uc in v101])
    v100_avg_priority = _avg([uc["priority_score"] for uc in v100])
    v100_avg_bob = _avg([uc["bob_score"] for uc in v100])

    v100_delta = {
        "n_v100": len(v100),
        "n_v101": len(v101),
        "envelope_delta": round(len(v101) - len(v100), 0),
        "priority_delta": round(v101_avg_priority - v100_avg_priority, 2),
        "bob_delta": round(v101_avg_bob - v100_avg_bob, 2),
    } if v100 else {"note": "v100 dump absent — v100 initial swarm failed to persist UCs"}

    stats = summarise(v101, demos, matched, weak, novel, missing)

    v101_by_id = {u.get("id"): u for u in v101}

    hard_veto = [uc for uc in v101 if 0 < uc["bob_score"] <= 2.01]

    novel_hi = [
        n for n in novel
        if (v101_by_id.get(n.get("current_id")) or {}).get("priority_score", 0) >= 7.5
    ]
    lost_hi = [m for m in missing if (m.get("baseline_priority") or 0) >= 7.5]

    n_match_or_weak = len(matched) + len(weak)
    match_or_weak_rate = round(n_match_or_weak / max(1, len(demos)), 3)

    return {
        "corpus": corpus,
        "n_v101": len(v101),
        "n_baseline": len(demos),
        "matched_count": len(matched),
        "weak_count": len(weak),
        "novel_count": len(novel),
        "missed_count": len(missing),
        "match_rate_of_baseline": round(len(matched) / max(1, len(demos)), 3),
        "match_or_weak_rate": match_or_weak_rate,
        "envelope_ratio": round(len(v101) / max(1, len(demos)), 3),
        "v101_avg_priority": v101_avg_priority,
        "v101_avg_bob": v101_avg_bob,
        "retained_better": stats["retained_better"],
        "retained_same": stats["retained_same"],
        "matched_worse": stats["matched_worse"],
        "retained_worse_pct": round(stats["matched_worse"] / max(1, len(matched)), 3),
        "retained_not_worse_pct": round((stats["retained_better"] + stats["retained_same"]) / max(1, len(matched)), 3),
        "lost_high_priority_count": len(lost_hi),
        "novel_high_priority_count": len(novel_hi),
        "hard_veto_survivors": len(hard_veto),
        "matched_top10": sorted(matched, key=lambda m: -(m.get("similarity") or 0))[:10],
        "novel_high_priority_top10": sorted(
            novel_hi,
            key=lambda n: -(v101_by_id.get(n.get("current_id"), {}).get("priority_score") or 0),
        )[:10],
        "lost_high_priority_top10": sorted(
            lost_hi, key=lambda m: -(m.get("baseline_priority") or 0)
        )[:10],
        "hard_veto_details": [
            {"id": uc["id"], "use_case": uc["use_case"], "bob_score": uc["bob_score"]}
            for uc in hard_veto
        ],
        "v100_delta": v100_delta,
    }


def main() -> int:
    corpora = ["bakehouse", "nyctaxi", "healthverity", "tpcds_sf1"]
    summary = {"per_corpus": [], "aggregate": {}}
    for corpus in corpora:
        result = compare_corpus(corpus)
        detail_path = V101_ROOT / f"{corpus}_v101_vs_demos.json"
        detail_path.parent.mkdir(parents=True, exist_ok=True)
        detail_path.write_text(json.dumps(result, indent=2))
        summary["per_corpus"].append(result)
        print(json.dumps(result, indent=2))

    ok = [p for p in summary["per_corpus"] if "error" not in p and p.get("n_v101", 0) > 0]
    if ok:
        summary["aggregate"] = {
            "avg_match_rate": round(sum(p["match_rate_of_baseline"] for p in ok) / len(ok), 3),
            "avg_match_or_weak_rate": round(sum(p["match_or_weak_rate"] for p in ok) / len(ok), 3),
            "avg_envelope_ratio": round(sum(p["envelope_ratio"] for p in ok) / len(ok), 3),
            "total_missed": sum(p["missed_count"] for p in ok),
            "total_novel": sum(p["novel_count"] for p in ok),
            "total_hard_veto_survivors": sum(p["hard_veto_survivors"] for p in ok),
            "total_retained_worse": sum(p["matched_worse"] for p in ok),
            "n_v101_total": sum(p["n_v101"] for p in ok),
            "n_baseline_total": sum(p["n_baseline"] for p in ok),
        }
    (V101_ROOT / "summary.json").write_text(json.dumps(summary, indent=2))
    print(f"[summary] wrote {V101_ROOT / 'summary.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
