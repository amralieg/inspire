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
            "tables": sorted({short_table(t) for t in tables}), "score": score, "bob": bob}


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


def score(gold: dict, use_cases: list, ask=None, cache: dict | None = None) -> dict:
    """Recall report. `ask` is None for the pre-filter alone; `cache` maps prompt SHA-256 to an answer."""
    ranked = rank([normalize_uc(u) for u in use_cases])
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
        rows.append({"id": entry["id"], "title": entry["title"], "candidates": [u["id"] for u in pool],
                     "matches": matched, "in_top": [m for m in matched if m in top], "error": error})
    total = len(rows) or 1
    found = sum(1 for r in rows if r["matches"])
    found_top = sum(1 for r in rows if r["in_top"])
    return {"corpus": gold.get("corpus"), "judge": "none" if ask is None else "llm", "use_cases": len(ranked),
            "gold": len(rows), "found": found, "recall": round(found / total, 4), "found_top": found_top,
            "recall_top": round(found_top / total, 4), "top_n": TOP_N, "judge_errors": errors,
            "missed": [r["id"] for r in rows if not r["matches"]], "entries": rows}


def load_catalog_use_cases(path: Path) -> list:
    data = json.loads(path.read_text(encoding="utf-8"))
    return [uc for domain in data.get("domains") or [] for uc in domain.get("use_cases") or []]


def release_gate(gold: dict, report: dict, catalog: dict | None) -> tuple:
    gate = gold.get("release_gate") or {}
    baseline = gate.get("baseline") or {}
    if not baseline:
        return False, ["the gold set has no release_gate baseline"]
    reasons = []
    strategy = (catalog or {}).get("strategic_context")
    if catalog is None:
        reasons.append("the gate needs --catalog-json to confirm the run had no customer strategy")
    elif isinstance(strategy, dict) and strategy.get("source") == "customer":
        reasons.append("the run used a customer strategy; measure the gate on a run without one")
    if report["judge_errors"]:
        reasons.append(f"{report['judge_errors']} judge error(s)")
    if report["found"] < baseline["found"]:
        reasons.append(f"found {report['found']} is below the {baseline['version']} baseline of {baseline['found']}")
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
    args = parser.parse_args(argv)
    gold = json.loads(args.gold.read_text(encoding="utf-8"))
    use_cases = (pull_uc_dump.fetch_ucs(args.session_id) if args.session_id
                 else load_catalog_use_cases(args.catalog_json))
    ask = None if args.judge == "none" else sql_judge(args.endpoint)
    cache = json.loads(args.cache.read_text(encoding="utf-8")) if args.cache and args.cache.exists() else {}
    report = score(gold, use_cases, ask, cache)
    if args.cache:
        args.cache.write_text(json.dumps(cache, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    text = json.dumps(report, indent=1)
    if args.out:
        args.out.write_text(text + "\n", encoding="utf-8")
    print(f"[recall] {report['found']}/{report['gold']} = {report['recall']:.0%} found; "
          f"{report['found_top']}/{report['gold']} = {report['recall_top']:.0%} in the top {TOP_N}; "
          f"judge errors {report['judge_errors']}; missed {report['missed']}")
    if not args.gate:
        return 0
    catalog = json.loads(args.catalog_json.read_text(encoding="utf-8")) if args.catalog_json else None
    passed, reasons = release_gate(gold, report, catalog)
    print("[RECALL GATE] PASS" if passed else f"[RECALL GATE] FAIL: {'; '.join(reasons)}")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
