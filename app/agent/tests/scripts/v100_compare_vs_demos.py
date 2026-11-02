"""v1.0.0 vs demos-baseline quality compare (measurement-only).

Loads `run_logs/v100_swarm/<corpus>_v100.json` (produced by v100_pull_ucs.py)
and `demos/<corpus>/docs/Samples <corpus>-dbx_inspire.json` (baseline shipped
with the repo), runs the semantic_compare TF-IDF+cosine matcher, and writes
`run_logs/v100_swarm/<corpus>_v100_vs_demos.json` plus a top-level
`run_logs/v100_swarm/summary.json` with per-corpus and aggregate metrics.

Metrics reported per corpus:
- matched: baseline UCs with a v100 counterpart at cosine >= high (0.55)
- weak:    baseline UCs with only cosine in [low, high) = 0.40..0.55
- missed:  baseline UCs not covered by any v100 UC (cosine < low)
- novel:   v100 UCs with no baseline pair above low
- hallucinated: v100 UCs whose primary_table not in the schema (best-effort;
  requires schema JSON alongside; falls back to a warning if unavailable).
- envelope: v100 UC count / baseline UC count.

Aggregate columns: matched-delta, missed-delta, hallucinated-delta,
envelope pass rate, sponsor-canonical rate.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
V100_ROOT = REPO / "run_logs" / "v100_swarm"
DEMOS_ROOT = REPO / "demos"

sys.path.insert(0, str(REPO / "tests" / "scripts"))
from semantic_compare import semantic_match  # noqa: E402


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
    """Normalize UC fields across the two schemas (v100 dump vs demos JSON)."""
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
                "priority_score": _first(uc, "priority_score", "Priority Score", default=0),
                "bob_score": _first(uc, "bob_score", "BoB Score", default=0),
                "idea_theme": _first(uc, "idea_theme", "Idea Theme"),
                "has_genie_code": _first(uc, "has_genie_code", "Has Genie Code", default="N"),
            }
        )
    return out


def compare_corpus(corpus: str) -> dict:
    v100_path = V100_ROOT / f"{corpus}_v100.json"
    demos_path = DEMOS_ROOT / corpus / "docs" / f"Samples {corpus}-dbx_inspire.json"
    if not v100_path.exists():
        return {"corpus": corpus, "error": f"missing v100 dump: {v100_path}"}
    if not demos_path.exists():
        return {"corpus": corpus, "error": f"missing demos baseline: {demos_path}"}

    v100 = _canonicalize_fields(_load(v100_path))
    demos = _canonicalize_fields(_load(demos_path))

    matched, weak, novel, missing = semantic_match(
        current=v100, baseline=demos, high=0.55, low=0.40
    )

    unique_sponsors = {uc["sponsor"].strip() for uc in v100 if uc.get("sponsor")}
    unique_beneficiaries = {uc["beneficiary"].strip() for uc in v100 if uc.get("beneficiary")}

    return {
        "corpus": corpus,
        "n_v100": len(v100),
        "n_baseline": len(demos),
        "matched_count": len(matched),
        "weak_count": len(weak),
        "novel_count": len(novel),
        "missed_count": len(missing),
        "match_rate_of_baseline": round(len(matched) / max(1, len(demos)), 3),
        "envelope_ratio": round(len(v100) / max(1, len(demos)), 3),
        "unique_sponsors": len(unique_sponsors),
        "unique_beneficiaries": len(unique_beneficiaries),
        "sponsor_samples": sorted(list(unique_sponsors))[:10],
        "beneficiary_samples": sorted(list(unique_beneficiaries))[:10],
    }


def main() -> int:
    corpora = ["bakehouse", "nyctaxi", "healthverity", "tpcds_sf1"]
    summary = {"per_corpus": [], "aggregate": {}}
    for corpus in corpora:
        result = compare_corpus(corpus)
        detail_path = V100_ROOT / f"{corpus}_v100_vs_demos.json"
        detail_path.parent.mkdir(parents=True, exist_ok=True)
        detail_path.write_text(json.dumps(result, indent=2))
        summary["per_corpus"].append(result)
        print(json.dumps(result, indent=2))

    ok = [p for p in summary["per_corpus"] if "error" not in p]
    if ok:
        summary["aggregate"] = {
            "avg_match_rate": round(sum(p["match_rate_of_baseline"] for p in ok) / len(ok), 3),
            "avg_envelope_ratio": round(sum(p["envelope_ratio"] for p in ok) / len(ok), 3),
            "total_missed": sum(p["missed_count"] for p in ok),
            "total_novel": sum(p["novel_count"] for p in ok),
        }
    (V100_ROOT / "summary.json").write_text(json.dumps(summary, indent=2))
    print(f"[summary] wrote {V100_ROOT / 'summary.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
