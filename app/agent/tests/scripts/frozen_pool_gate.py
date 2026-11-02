from __future__ import annotations

import argparse
import json
import logging
import string
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(REPO / "tests"))
import pull_uc_dump  # noqa: E402
import recall_benchmark  # noqa: E402

PROMPT = "COMBINED_VALUE_QUALITY_SCORE_PROMPT"
GOOD_LABELS = frozenset({"Medium", "High", "Very High", "Ultra High"})
GRADE_SQL = "SELECT ai_query('{endpoint}', :prompt, modelParameters => named_struct('max_tokens', 64000)) AS answer"
NOTEBOOK = "agent/dbx_inspire_ai_agent.ipynb"


def load_namespace(notebook: Path) -> dict:
    import _agentload
    return _agentload.fresh_agent_namespace(str(notebook))


def reference_notebook(tag: str) -> Path:
    import _agentload
    return _agentload.reference_notebook(tag)


def _instance(ns: dict):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = logging.getLogger("frozen_pool_gate")
    return cls, obj


def build_requests(ns: dict, pool: dict, use_cases: list = None, size: int = None) -> list:
    cls, obj = _instance(ns)
    template = ns["PROMPT_TEMPLATES"][PROMPT]
    fields = {field for _literal, field, _spec, _conv in string.Formatter().parse(template) if field}
    values = dict(pool["grading_context"])
    values.update({key: value for key, value in pool["strategy_inputs"].items() if key in fields})
    missing = fields - set(values) - {"use_cases_to_validate"}
    if missing:
        raise ValueError(f"the frozen pool has no value for the template field(s) {sorted(missing)}")
    use_cases = pool["use_cases"] if use_cases is None else use_cases
    size = int(size or pool["batch_size"])
    requests = []
    for start in range(0, len(use_cases), size):
        batch = [dict(uc) for uc in use_cases[start:start + size]]
        cards = cls._build_use_cases_markdown_for_validation(obj, batch)
        prompt = ns["with_user_directive_preamble"](template.format(**values, use_cases_to_validate=cards))
        requests.append((batch, prompt))
    return requests


def score_answers(ns: dict, requests: list, answers: list) -> tuple:
    cls, obj = _instance(ns)
    apply = getattr(cls, "_apply_combined_score", None)
    scored, unscored = [], []
    for (batch, _prompt), answer in zip(requests, answers):
        scores = cls._parse_combined_score_response(obj, answer or "", batch)
        for uc in batch:
            s = scores.get(str(uc["No"]))
            if s is None:
                unscored.append(uc)
                continue
            if apply is not None:
                apply(uc, s)
            else:
                uc.update({"Quality": s["quality_label"], "Quality Score": s["quality_score"],
                           "Priority": s["priority_score"], "Priority Score": s["priority_score"],
                           "scoring_status": "scored"})
            uc["Inspire Score"] = cls._compute_inspire_score(obj, uc)
            scored.append(uc)
    return scored, unscored


def top_hits(ns: dict, scored: list, gold_matches: dict) -> list:
    cls = ns["DatabricksInspire"]
    kept = [uc for uc in scored if uc.get("Quality") in GOOD_LABELS and uc.get("Inspire Score") is not None]
    top = {str(uc["No"]) for uc in sorted(kept, key=cls._final_rank_key)[:recall_benchmark.TOP_N]}
    return sorted(gold for gold, ids in gold_matches.items() if set(ids) & top)


def sql_grader(endpoint: str):
    if not recall_benchmark.ENDPOINT_RE.match(endpoint or ""):
        raise ValueError(f"invalid serving endpoint name {endpoint!r}")

    def ask(prompt: str) -> str:
        _columns, rows = pull_uc_dump.query(GRADE_SQL.format(endpoint=endpoint),
                                            parameters=[{"name": "prompt", "value": prompt, "type": "STRING"}])
        return rows[0][0] if rows else ""
    return ask


def measure(ns: dict, pool: dict, ask, workers: int = 8, retries: int = 2) -> dict:
    scored, pending, rounds = [], list(pool["use_cases"]), []
    size = int(pool["batch_size"])
    for attempt in range(retries + 1):
        if not pending:
            break
        requests = build_requests(ns, pool, pending, size)
        with ThreadPoolExecutor(max_workers=workers) as executor:
            answers = list(executor.map(lambda item: ask(item[1]), requests))
        done, pending = score_answers(ns, requests, answers)
        scored += done
        done_ids = {str(uc["No"]) for uc in done}
        unread = [str(answer or "")[:200] for (batch, _prompt), answer in zip(requests, answers)
                  if not any(str(uc["No"]) in done_ids for uc in batch)]
        rounds.append({"batch_size": size, "sent": sum(len(batch) for batch, _prompt in requests), "scored": len(done),
                       "unread_answers": unread})
        size = max(1, size // 2)
    hits = top_hits(ns, scored, pool["gold_matches"])
    return {"version": ns.get("__AGENT_VERSION__", "unknown"), "rounds": rounds, "scored": len(scored),
            "unscored": len(pending), "top_hits": len(hits), "found_in_top": hits}


def frozen_pool_gate(release: dict, reference: dict, tolerance: int, pool_size: int) -> tuple:
    reasons = []
    for label, result in (("release", release), ("reference", reference)):
        if result["unscored"] > pool_size // 10:
            reasons.append(f"{result['unscored']} of {pool_size} {label} use cases came back unscored")
    if release["top_hits"] < reference["top_hits"] - tolerance:
        reasons.append(f"top {recall_benchmark.TOP_N} holds {release['top_hits']} must-find use cases, more than "
                       f"{tolerance} below {reference['version']}'s {reference['top_hits']} on the same pool")
    return not reasons, reasons


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Rank one frozen candidate pool with the release and the reference "
                                                 "grading on the same endpoint and compare the must-finds in the top 25")
    parser.add_argument("--gold", type=Path, default=REPO / "tests" / "regression" / "tpcds_sf1_gold.json")
    parser.add_argument("--pool", type=Path, default=REPO / "tests" / "regression" / "tpcds_sf1_frozen_pool.json")
    parser.add_argument("--release", type=Path, default=REPO / NOTEBOOK)
    parser.add_argument("--endpoint", required=True)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args(argv)
    gate = json.loads(args.gold.read_text(encoding="utf-8")).get("release_gate") or {}
    frozen = gate.get("frozen_pool") or {}
    if not frozen.get("reference_tag"):
        print("[FROZEN POOL GATE] FAIL: the gold set has no release_gate.frozen_pool.reference_tag")
        return 1
    try:
        reference_path = reference_notebook(frozen["reference_tag"])
    except FileNotFoundError as exc:
        print(f"[FROZEN POOL GATE] FAIL: {exc}")
        return 1
    pool = json.loads(args.pool.read_text(encoding="utf-8"))
    ask = sql_grader(args.endpoint)
    reference = measure(load_namespace(reference_path), pool, ask)
    release = measure(load_namespace(args.release), pool, ask)
    passed, reasons = frozen_pool_gate(release, reference, int(frozen.get("top_tolerance", 1)), len(pool["use_cases"]))
    report = {"endpoint": args.endpoint, "release": release, "reference": reference, "passed": passed, "reasons": reasons}
    if args.out:
        args.out.write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8")
    print(f"[frozen pool] release {release['version']}: {release['top_hits']} must-finds in the top "
          f"{recall_benchmark.TOP_N} ({release['scored']} scored); reference {reference['version']}: "
          f"{reference['top_hits']} ({reference['scored']} scored)")
    print("[FROZEN POOL GATE] PASS" if passed else f"[FROZEN POOL GATE] FAIL: {'; '.join(reasons)}")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
