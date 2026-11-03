"""Recall benchmark: how many of a corpus's must-find use cases one Inspire run produced.

Usage:
    python3 tests/scripts/recall_benchmark.py --gold tests/regression/tpcds_sf1_gold.json \\
        (--session-id <sid> | --catalog-json <path>) [--endpoint <serving endpoint> | --judge none] \\
        [--cache <answers.json>] [--out <report.json>]

A produced use case is a candidate for a gold entry only when its tables include every table the
entry requires (deterministic pre-filter). An LLM judge then says which candidates support the
same business decision. Recall is reported overall and within the top 25 by Inspire Score.
`--judge none` reports the pre-filter alone, an upper bound. Judge answers are cached by the
SHA-256 of the prompt, so a re-score with the same cache makes no new LLM call.

Every gold entry names its use-case kind by its label in app_shell/kinds.json. A use case's kind is its labeled
use_case_kind (id, label or number), else the kind of its Analytics Technique. Kind recall counts the gold
entries matched by a use case of the entry's kind or one of its also_kinds. A must-reject entry is selected
when a use case covers its tables and its name or statement matches one of its patterns and none of its
unless patterns. `--gate` also needs 80% kind recall, 6 families among the families with a must-find entry
(fewer when fewer have one, and only detected ones when --detected-kinds is given), no must-reject entry
selected, and kind-floor picks averaging no more than 0.5 Best-of-Best below the portfolio.

Environment: DATABRICKS_CONFIG_PROFILE, INSPIRE_WAREHOUSE and INSPIRE_DB, as in pull_uc_dump.py.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pull_uc_dump  # noqa: E402

TOP_N = 25
MAX_CANDIDATES = 12
KIND_RECALL_MIN = 0.8
MIN_FAMILIES = 6
FLOOR_MAX_AVG_GAP = 0.5
KINDS_PATH = Path(__file__).resolve().parents[2] / "agent" / "app_shell" / "kinds.json"
AGENT_TESTS = Path(__file__).resolve().parents[1]
_AGENT = {}
ENDPOINT_RE = re.compile(r"^[A-Za-z0-9._-]+$")
JUDGE_SQL = ("SELECT ai_query('{endpoint}', :prompt, "
             "modelParameters => named_struct('temperature', CAST(0.0 AS DOUBLE))) AS answer")


def short_table(ref) -> str:
    return str(ref or "").replace("`", "").strip().lower().rsplit(".", 1)[-1]


def _first(row: dict, *keys):
    for key in keys:
        value = row.get(key)
        if value not in (None, ""):
            return value
    return ""


def normalize_uc(row: dict) -> dict:
    """One shape for an __inspire_usecases row and a JSON catalog use case."""
    tables = [t for t in str(_first(row, "tables_involved", "Tables Involved")).split(",") if t.strip()]
    try:
        score = float(_first(row, "inspire_score", "Inspire Score"))
    except (TypeError, ValueError):
        score = None
    try:
        bob = float(_first(row, "bob_score"))
    except (TypeError, ValueError):
        bob = None
    return {"id": str(_first(row, "id", "No")), "name": str(_first(row, "use_case", "Name", "usecase")),
            "statement": str(_first(row, "statement", "Statement")), "solution": str(_first(row, "solution", "Solution")),
            "tables": sorted({short_table(t) for t in tables}), "score": score, "bob": bob,
            "kind_label": str(_first(row, "use_case_kind", "Use Case Kind")),
            "technique": str(_first(row, "analytics_technique", "Analytics Technique")),
            "basis": str(_first(row, "selection_basis", "Selection Basis")).strip().lower()}


def load_registry(path: Path = KINDS_PATH) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def notebook_kind_resolver():
    if "kind" not in _AGENT:
        sys.path.insert(0, str(AGENT_TESTS))
        import _agentload
        _AGENT["kind"] = _agentload.load_agent_namespace()["inspire_use_case_kind"]
    return _AGENT["kind"]


def resolve_kind(uc: dict) -> tuple:
    """(kind id, "labeled" | "technique" | "") for one normalized use case, decided by the agent notebook's resolver."""
    resolve = notebook_kind_resolver()
    labeled = resolve({"use_case_kind": uc.get("kind_label")}) if str(uc.get("kind_label") or "").strip() else None
    if labeled:
        return labeled["id"], "labeled"
    by_technique = resolve({"Analytics Technique": uc.get("technique")})
    return (by_technique["id"], "technique") if by_technique else ("", "")


def gold_with_kind_ids(gold: dict, registry: dict) -> dict:
    by_label = {kind["label"]: kind["id"] for kind in registry["kinds"]}
    entries = []
    for entry in gold["entries"]:
        if any(label not in by_label for label in [entry.get("kind")] + list(entry.get("also_kinds") or [])):
            raise ValueError(f"gold entry {entry['id']} has no kind from the registry: {entry.get('kind')!r}")
        entries.append({**entry, "kind": by_label[entry["kind"]], "also_kinds": [by_label[label] for label in entry.get("also_kinds") or []]})
    return {**gold, "entries": entries}


def entry_kinds(entry: dict) -> list:
    return [entry["kind"]] + [k for k in entry.get("also_kinds") or [] if k != entry["kind"]]


def rank(use_cases: list) -> list:
    """Final-rank order: Inspire Score, then BoB score, then id."""
    return sorted(use_cases, key=lambda u: (-(u["score"] if u["score"] is not None else -1.0),
                                            -(u["bob"] if u["bob"] is not None else -1.0), u["id"]))


def covers(entry: dict, tables: set) -> bool:
    """Every required table, and at least one table of each any_of group."""
    required = {short_table(t) for t in entry.get("required_tables") or []}
    groups = [{short_table(t) for t in group} for group in entry.get("any_of") or []]
    return required <= tables and all(group & tables for group in groups)


def candidates(entry: dict, use_cases: list) -> list:
    """Use cases whose tables cover the entry, those citing more signal columns first."""
    signals = [ref.split(".")[-1].lower() for ref in entry.get("signal_columns") or []]
    pool = [u for u in use_cases if covers(entry, set(u["tables"]))]
    text = lambda u: f"{u['name']} {u['statement']} {u['solution']}".lower()
    order = {u["id"]: index for index, u in enumerate(use_cases)}
    pool.sort(key=lambda u: (-sum(1 for s in signals if s in text(u)), order[u["id"]]))
    return pool[:MAX_CANDIDATES]


def _data_text(entry: dict) -> str:
    parts = [", ".join(entry.get("required_tables") or [])]
    parts += [f"one of {' / '.join(group)}" for group in entry.get("any_of") or []]
    return "; ".join(part for part in parts if part)


def judge_prompt(entry: dict, pool: list) -> str:
    listing = "\n".join(json.dumps({"id": u["id"], "name": u["name"], "statement": u["statement"][:600],
                                    "solution": u["solution"][:600], "tables": u["tables"]}, ensure_ascii=False)
                        for u in pool)
    return ("You check whether generated analytics use cases cover one reference use case.\n\n"
            f"REFERENCE\nDecision: {entry['decision']}\nOwner: {entry['owner']}\nWhy it matters: {entry['why']}\n"
            f"Data: {_data_text(entry)}\n\n"
            f"CANDIDATES (one JSON object per line)\n{listing}\n\n"
            "A candidate matches when it supports the same business decision from the same data. A narrower or "
            "broader version of the same decision still matches; a different decision on the same tables does not.\n"
            'Answer with JSON only: {"matches": ["<candidate id>", ...], "reason": "<one sentence>"}. '
            'Use an empty list when no candidate matches.')


def parse_judge(answer: str, pool: list) -> tuple:
    """(matched candidate ids, error). Ids the judge invents are ignored; unreadable answers match nothing."""
    allowed = {u["id"] for u in pool}
    match = re.search(r"\{.*\}", str(answer or ""), re.S)
    if not match:
        return [], "no JSON object in the judge answer"
    try:
        data = json.loads(match.group(0))
    except ValueError:
        return [], "judge answer is not valid JSON"
    ids = data.get("matches") if isinstance(data, dict) else None
    if not isinstance(ids, list):
        return [], "judge answer has no matches list"
    return [str(i) for i in ids if str(i) in allowed], None


def sql_judge(endpoint: str):
    if not ENDPOINT_RE.match(endpoint or ""):
        raise ValueError(f"invalid serving endpoint name {endpoint!r}")

    def ask(prompt: str) -> str:
        _columns, rows = pull_uc_dump.query(JUDGE_SQL.format(endpoint=endpoint),
                                            parameters=[{"name": "prompt", "value": prompt, "type": "STRING"}])
        return rows[0][0] if rows else ""
    return ask


def must_reject_hits(gold: dict, use_cases: list) -> list:
    """The must-reject entries a portfolio selected, each with the use cases that restate it (T7)."""
    hits = []
    for entry in gold.get("must_reject") or []:
        patterns = [re.compile(p, re.I) for p in entry.get("patterns") or []]
        unless = [re.compile(p, re.I) for p in entry.get("unless") or []]
        chosen = []
        for u in use_cases:
            text = f"{u['name']}. {u['statement']}"
            if covers(entry, set(u["tables"])) and any(p.search(text) for p in patterns) and not any(p.search(text) for p in unless):
                chosen.append(u["id"])
        if chosen:
            hits.append({"id": entry["id"], "title": entry["title"], "selected": chosen})
    return hits


def floor_gap(use_cases: list) -> dict:
    """How far the kind-floor picks sit below the portfolio on Best-of-Best (D7)."""
    recorded = any(u.get("basis") for u in use_cases)
    portfolio = [u["bob"] for u in use_cases if u["bob"] is not None]
    floor = [u["bob"] for u in use_cases if u.get("basis") == "kind_floor" and u["bob"] is not None]
    gap = round(sum(portfolio) / len(portfolio) - sum(floor) / len(floor), 3) if floor and portfolio else None
    return {"recorded": recorded, "picks": sum(1 for u in use_cases if u.get("basis") == "kind_floor"),
            "portfolio_bob": round(sum(portfolio) / len(portfolio), 3) if portfolio else None,
            "floor_bob": round(sum(floor) / len(floor), 3) if floor else None, "gap": gap}


def kind_summary(gold: dict, ranked: list, rows: list, registry: dict, detected: list | None = None) -> dict:
    family = {kind["id"]: kind["family"] for kind in registry["kinds"]}
    total = len(rows) or 1
    kind_found = [r["id"] for r in rows if r["kind_matches"]]
    eligible = {family[e["kind"]] for e in gold["entries"]}
    if detected is not None:
        eligible &= {family[k] for k in detected if k in family}
    produced = {family[u["kind"]] for u in ranked if u["kind"] in family}
    hit = eligible & produced
    return {"kind_found": len(kind_found), "kind_recall": round(len(kind_found) / total, 4),
            "kind_missed": [r["id"] for r in rows if not r["kind_matches"]],
            "families_eligible": sorted(eligible), "families_produced": sorted(produced), "families_hit": sorted(hit),
            "families_required": min(MIN_FAMILIES, len(eligible)),
            "kinds_produced": sorted({u["kind"] for u in ranked if u["kind"]}),
            "kind_from_technique": sum(1 for u in ranked if u["kind_source"] == "technique"),
            "kind_unknown": sum(1 for u in ranked if not u["kind"]),
            "must_reject_selected": must_reject_hits(gold, ranked), "floor": floor_gap(ranked)}


def score(gold: dict, use_cases: list, ask=None, cache: dict | None = None, registry: dict | None = None,
          detected: list | None = None) -> dict:
    """Recall report. `ask` is None for the pre-filter alone; `cache` maps prompt SHA-256 to an answer."""
    registry = registry if registry is not None else load_registry()
    gold = gold_with_kind_ids(gold, registry)
    ranked = rank([normalize_uc(u) for u in use_cases])
    for u in ranked:
        u["kind"], u["kind_source"] = resolve_kind(u)
    kind_of = {u["id"]: u["kind"] for u in ranked}
    top = {u["id"] for u in ranked[:TOP_N]}
    cache = cache if cache is not None else {}
    rows, errors = [], 0
    for entry in gold["entries"]:
        pool = candidates(entry, ranked)
        matched, error = [], None
        if pool and ask is None:
            matched = [u["id"] for u in pool]
        elif pool:
            prompt = judge_prompt(entry, pool)
            key = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
            if key not in cache:
                cache[key] = ask(prompt)
            matched, error = parse_judge(cache[key], pool)
            errors += 1 if error else 0
        accepted = entry_kinds(entry)
        rows.append({"id": entry["id"], "title": entry["title"], "kind": entry["kind"], "candidates": [u["id"] for u in pool],
                     "matches": matched, "in_top": [m for m in matched if m in top],
                     "kind_matches": [m for m in matched if kind_of.get(m) in accepted], "error": error})
    total = len(rows) or 1
    found = sum(1 for r in rows if r["matches"])
    found_top = sum(1 for r in rows if r["in_top"])
    return {"corpus": gold.get("corpus"), "judge": "none" if ask is None else "llm", "use_cases": len(ranked),
            "gold": len(rows), "found": found, "recall": round(found / total, 4), "found_top": found_top,
            "recall_top": round(found_top / total, 4), "top_n": TOP_N, "judge_errors": errors,
            "missed": [r["id"] for r in rows if not r["matches"]],
            "kinds": kind_summary(gold, ranked, rows, registry, detected), "entries": rows}


def load_catalog_use_cases(path: Path) -> list:
    data = json.loads(path.read_text(encoding="utf-8"))
    return [uc for domain in data.get("domains") or [] for uc in domain.get("use_cases") or []]


def kind_gate(kinds: dict | None) -> list:
    if not kinds:
        return ["the report has no kind measures"]
    reasons = []
    if kinds["kind_recall"] < KIND_RECALL_MIN:
        reasons.append(f"kind recall {kinds['kind_recall']:.0%} is below {KIND_RECALL_MIN:.0%} (missed {kinds['kind_missed']})")
    if len(kinds["families_hit"]) < kinds["families_required"]:
        reasons.append(f"{len(kinds['families_hit'])} of the {kinds['families_required']} required families appear "
                       f"(eligible {kinds['families_eligible']}, produced {kinds['families_produced']})")
    for hit in kinds["must_reject_selected"]:
        reasons.append(f"must-reject {hit['id']} ({hit['title']}) selected as {hit['selected']}")
    floor = kinds["floor"]
    if not floor["recorded"]:
        reasons.append("no use case records selection_basis; measure the floor gate on a v1.4.0 run")
    elif floor["gap"] is not None and floor["gap"] > FLOOR_MAX_AVG_GAP:
        reasons.append(f"kind-floor picks average {floor['gap']:.2f} Best-of-Best below the portfolio, above {FLOOR_MAX_AVG_GAP}")
    return reasons


def release_gate(gold: dict, report: dict, catalog: dict | None) -> tuple:
    gate = gold.get("release_gate") or {}
    if not gate:
        return False, ["the gold set has no release_gate"]
    baseline = gate.get("baseline") or {}
    reasons = []
    strategy = (catalog or {}).get("strategic_context")
    if catalog is None:
        reasons.append("the gate needs --catalog-json to confirm the run had no customer strategy")
    elif isinstance(strategy, dict) and strategy.get("source") == "customer":
        reasons.append("the run used a customer strategy; measure the gate on a run without one")
    if report["judge_errors"]:
        reasons.append(f"{report['judge_errors']} judge error(s)")
    if baseline and report["found"] < baseline["found"]:
        reasons.append(f"found {report['found']} is below the {baseline['version']} baseline of {baseline['found']}")
    if gate.get("min_found") is not None and report["found"] < gate["min_found"]:
        reasons.append(f"found {report['found']} of {report['gold']} is below the gate of {gate['min_found']}")
    reasons += kind_gate(report.get("kinds"))
    return not reasons, reasons


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--gold", required=True, type=Path)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--session-id")
    source.add_argument("--catalog-json", type=Path)
    parser.add_argument("--endpoint", default="")
    parser.add_argument("--judge", choices=("llm", "none"), default="llm")
    parser.add_argument("--cache", type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--gate", action="store_true")
    parser.add_argument("--registry", type=Path, default=KINDS_PATH)
    parser.add_argument("--detected-kinds", default=None,
                        help="comma-separated kind ids the run detected; families outside them are not required")
    args = parser.parse_args(argv)
    gold = json.loads(args.gold.read_text(encoding="utf-8"))
    use_cases = (pull_uc_dump.fetch_ucs(args.session_id) if args.session_id
                 else load_catalog_use_cases(args.catalog_json))
    ask = None if args.judge == "none" else sql_judge(args.endpoint)
    cache = json.loads(args.cache.read_text(encoding="utf-8")) if args.cache and args.cache.exists() else {}
    detected = [k.strip() for k in args.detected_kinds.split(",") if k.strip()] if args.detected_kinds is not None else None
    report = score(gold, use_cases, ask, cache, load_registry(args.registry), detected)
    if args.cache:
        args.cache.write_text(json.dumps(cache, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    text = json.dumps(report, indent=1)
    if args.out:
        args.out.write_text(text + "\n", encoding="utf-8")
    print(f"[recall] {report['found']}/{report['gold']} = {report['recall']:.0%} found; "
          f"{report['found_top']}/{report['gold']} = {report['recall_top']:.0%} in the top {TOP_N}; "
          f"judge errors {report['judge_errors']}; missed {report['missed']}")
    kinds = report["kinds"]
    print(f"[KIND RECALL] {kinds['kind_found']}/{report['gold']} = {kinds['kind_recall']:.0%} with their kind; "
          f"families {len(kinds['families_hit'])}/{kinds['families_required']} required {kinds['families_hit']}; "
          f"must-reject selected {[h['id'] for h in kinds['must_reject_selected']]}; floor {kinds['floor']}; "
          f"kind from technique {kinds['kind_from_technique']}, unknown {kinds['kind_unknown']}")
    if not args.gate:
        return 0
    catalog = json.loads(args.catalog_json.read_text(encoding="utf-8")) if args.catalog_json else None
    passed, reasons = release_gate(gold, report, catalog)
    print("[RECALL GATE] PASS" if passed else f"[RECALL GATE] FAIL: {'; '.join(reasons)}")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
