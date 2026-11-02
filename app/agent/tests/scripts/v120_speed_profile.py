"""Offline LLM-call and prompt-size profile of DatabricksInspire.run() on a synthetic ~350 use case run.

The real AIAgent sends every prompt through a fake Spark Connect session that answers ai_query; the
value pass, global dedup, combined scoring, Best-of-Best and the elite judge run for real. Context
extraction, generation, clustering, the G/Q gates, Phase L, Genie and the writers are doubles, so
their calls are not counted. Usage:

    python3 tests/scripts/v120_speed_profile.py --notebook <path-or-git-ref> [--mode Good] [--json]
"""
import argparse
import hashlib
import json
import logging
import os
import re
import subprocess
import sys
import tempfile
import threading
import types
from collections import OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
TESTS = os.path.dirname(HERE)
ROOT = os.path.dirname(TESTS)
sys.path.insert(0, TESTS)
sys.path.insert(0, os.path.join(TESTS, "unit"))

import _agentload  # noqa: E402

N_TABLES = 60
N_COLUMNS = 25
UCS_PER_TABLE = 6
N_DOMAINS = 8
ACCEPTABLE = {"Good": {"Medium", "High", "Very High", "Ultra High"}, "High": {"High", "Very High", "Ultra High"},
              "Ultra High": {"High", "Very High", "Ultra High"}}
PROMPT_MARKERS = OrderedDict([
    ("USE_CASE_VALUE_SCORE_PROMPT", "Chief Investment Officer & Strategic Value Architect"),
    ("REVIEW_USE_CASES_PROMPT", "**Deduplication Specialist**"),
    ("COMBINED_VALUE_QUALITY_SCORE_PROMPT", "# COMBINED VALUE & QUALITY SCORER"),
    ("BEST_OF_BEST_SCORING_PROMPT", "# BEST-OF-BEST SCORING"),
    ("ULTRA_HIGH_ELITE_JUDGE_PROMPT", "# ULTRA HIGH ELITE JUDGE"),
])
ID_ROW = r"^\| ((?:AI-[A-Za-z0-9_]+-U\d+)|(?:N\d+-U\d+)) \|"
VALUE_FACTORS = ("Strategic Alignment", "Return on Investment", "Reusability", "Time to Value", "Data Availability",
                 "Data Accessibility", "Architecture Fitness", "Team Skills", "Domain Knowledge", "People Allocation",
                 "Budget Allocation", "Time to Production")


def table(i):
    return f"t{i:02d}"


def schema_columns():
    cols = []
    for i in range(N_TABLES):
        t = table(i)
        cols.append(("cat", "sch", t, "id", "bigint", f"Surrogate key of one {t} record"))
        cols.append(("cat", "sch", t, f"{table((i + 1) % N_TABLES)}_id", "bigint",
                     f"Foreign key to {table((i + 1) % N_TABLES)}"))
        cols.append(("cat", "sch", t, "event_ts", "timestamp", f"Time the {t} event happened"))
        for c in range(N_COLUMNS - 3):
            cols.append(("cat", "sch", t, f"metric_{c:02d}", "decimal(12,2)",
                         f"Business measure {c} of {t}, aggregated daily by the operations team"))
    return cols


def stable(uc_id, lo, hi):
    h = int(hashlib.sha256(str(uc_id).encode()).hexdigest()[:8], 16)
    return lo + (h % 1000) / 1000.0 * (hi - lo)


def respond(op):
    text = op["args"]["prompt_text"]
    if PROMPT_MARKERS["USE_CASE_VALUE_SCORE_PROMPT"] in text:
        ids = re.findall(ID_ROW, text, re.M)
        header = '"No",' + ",".join(f'"{k}"' for k in VALUE_FACTORS) + ',"Justification"'
        rows = [f'"{i}",' + ",".join(f"{stable(i + k, 2.5, 5.0):.2f}" for k in VALUE_FACTORS) + ',"ok"' for i in ids]
        return "\n".join([header] + rows)
    if PROMPT_MARKERS["REVIEW_USE_CASES_PROMPT"] in text:
        ids = re.findall(ID_ROW, text, re.M)
        kept = [i for i in ids if stable(i, 0, 1) >= 0.05]
        return "use_case_id,honesty_score,honesty_justification\n" + "\n".join(f"{i},90,keep" for i in kept)
    if PROMPT_MARKERS["COMBINED_VALUE_QUALITY_SCORE_PROMPT"] in text:
        ids = re.findall(r"### Use Case: (\S+) - ", text)
        return json.dumps([{"use_case_id": i, "quality_label": "High", "quality_score": 4.0,
                            "priority_score": round(stable(i, 5.0, 9.5), 2), "value_score": 4.0,
                            "feasibility_score": 3.5, "quality_summary": "Columns `id` and `metric_00` give the KPI."}
                           for i in ids])
    if PROMPT_MARKERS["BEST_OF_BEST_SCORING_PROMPT"] in text:
        ids = re.findall(r"### Use Case: (\S+) - ", text)
        return json.dumps([{"No": i, "bob_scores": {f"D{g}": int(stable(f"{i}{g}", 6, 9.99)) for g in range(1, 20)},
                            "idea_theme": f"Theme {int(stable(i, 0, 19.99))}", "bob_justification_short": "ok"}
                           for i in ids])
    if PROMPT_MARKERS["ULTRA_HIGH_ELITE_JUDGE_PROMPT"] in text:
        out = []
        for uc_id, tables in re.findall(r"### Use Case: (\S+) - .*?\*\*Tables Involved:\*\*\s*`?([^`\n]+)", text, re.S):
            t = tables.split(",")[0].strip()
            out.append({"No": uc_id, "decision": f"Which {t} to prioritise", "decision_owner": "Ops lead",
                        "cadence": "weekly", "kpi": "Cost", "kpi_direction": "decrease",
                        "value_driver": f"`{t}.metric_00` per `{t}.id` drives the weekly decision",
                        "value_tier": "Material", "signal_columns": [f"{t}.metric_00", f"{t}.event_ts"],
                        "outcome_definition": None, "time_column": f"{t}.event_ts", "entity_key_column": f"{t}.id",
                        "join_path": [], "build_path": "SQL feature table and a forecast job", "blockers": [],
                        "red_team": "Late events", "red_team_verdict": "survives",
                        "scores": {"business_value": 9, "evidence_strength": 9, "implementability": 8,
                                   "actionability": 8},
                        "verdict": "ELITE" if stable(uc_id, 0, 1) > 0.7 else "REJECT", "verdict_reason": "x"})
        return json.dumps(out)
    raise AssertionError("unexpected prompt in the speed profile: " + text[:200])


def prompt_name(text):
    for name, marker in PROMPT_MARKERS.items():
        if marker in text:
            return name
    return "OTHER"


def notebook_path(ref):
    if os.path.exists(ref):
        return os.path.abspath(ref)
    blob = subprocess.run(["git", "show", f"{ref}:./agent/dbx_inspire_ai_agent.ipynb"], cwd=ROOT,
                          capture_output=True, check=True).stdout
    path = os.path.join(tempfile.mkdtemp(prefix="inspire_speed_"), "agent.ipynb")
    with open(path, "wb") as fh:
        fh.write(blob)
    return path


class Loader:
    def __init__(self, columns):
        self._batches = [columns]
        self.foreign_key_graph = {}
        for i in range(N_TABLES):
            target = table((i + 1) % N_TABLES)
            self.foreign_key_graph[("cat", "sch", table(i))] = [
                ("cat", "sch", table(i), f"{target}_id", "cat", "sch", target, "id")]

    def getNextTables(self, n):
        return self._batches.pop(0) if self._batches else None

    def merge_inferred_foreign_keys(self, cols):
        return 0

    def get_table_comment(self, catalog, schema, table_name):
        return f"One row per {table_name} business event"

    def get_primary_key(self, catalog, schema, table_name):
        return ["id"]

    def get_table_relations(self, catalog, schema, table_name):
        return []

    def get_sampling_info(self, catalog, schema, table_name):
        return None

    def metadata_unavailable_report(self):
        return {"count": 0, "tables": []}

    def get_metadata_evidence(self, tables):
        evidence = {}
        for fqn in tables:
            t = fqn.split(".")[-1]
            cols = {"id": {"name": "id", "type": "BIGINT", "comment": "Key", "nullable": True, "tags": {}},
                    "metric_00": {"name": "metric_00", "type": "DECIMAL(12,2)", "comment": "Measure",
                                  "nullable": True, "tags": {}},
                    "event_ts": {"name": "event_ts", "type": "TIMESTAMP", "comment": "Time", "nullable": True,
                                 "tags": {}}}
            evidence[fqn] = {"comment": f"One row per {t}", "table_type": "MANAGED", "tags": {}, "last_altered": None,
                             "primary_key": ["id"], "foreign_keys": [], "columns": cols}
        return evidence


def build(ns, tmp, mode):
    from v120_run_offline_smoke_test import _build
    from v120_runtime_reliability_test import FakeConnectSpark
    obj = _build(ns, tmp, mode, ACCEPTABLE[mode], lambda uc_id: None)
    for name in ("_score_per_domain_parallel", "_deduplicate_use_cases"):
        if name in vars(obj):
            delattr(obj, name)
    obj.data_loader = Loader(schema_columns())
    obj._phaseQ_run_integrity_gates = lambda ucs, schema: ucs
    spark = FakeConnectSpark(respond)
    logger = logging.getLogger("v120_speed_profile")
    obj.ai_agent = ns["AIAgent"](spark=spark, logger=logger, worker_llm_config="x", judge_llm_config="x",
                                 prompt_templates=dict(ns["PROMPT_TEMPLATES"]), default_timeout_seconds=60,
                                 max_retry_attempts=1)
    obj.llm_timeout_seconds = 60

    def generate(column_details, batch_id, **kw):
        if str(batch_id).startswith("P2_"):
            return []
        t = column_details[0][2]
        nxt = table((int(t[1:]) + 1) % N_TABLES)
        return [{"No": f"AI-{batch_id}-U{i}", "Name": f"Forecast {t} metric {i} weekly", "usecase": "", "type": "AI",
                 "Analytics Technique": "Forecasting",
                 "Statement": f"Weekly {t} metric {i} drifts without warning and planners react late.",
                 "Solution": f"Forecast `metric_{i:02d}` of `{t}` from `event_ts` with seasonality.",
                 "Business Value": "Earlier plans cut expediting cost.", "Beneficiary": "Ops", "Sponsor": "COO",
                 "Tables Involved": f"cat.sch.{t}" + (f", cat.sch.{nxt}" if i % 2 else ""),
                 "High Level Design": "Aggregate daily, fit a forecast, publish weekly.", "Business Domain": "",
                 "Subdomain": "", "Quality": "Pending"} for i in range(UCS_PER_TABLE)]

    obj._process_batch_with_retry = generate

    def cluster(ucs, lang):
        for uc in ucs:
            first = uc["Tables Involved"].split(",")[0].strip().split(".")[-1]
            uc["Business Domain"] = f"Domain {int(first[1:]) % N_DOMAINS}"
            uc["Subdomain"] = "General"
        return ucs

    obj._cluster_domains_and_subdomains = cluster
    obj._assign_to_user_domains = lambda ucs, domains, language: cluster(ucs, language)
    return obj, spark


def profile(ref, mode):
    import random
    random.seed(0)
    ns = _agentload.fresh_agent_namespace(notebook_path(ref))
    root = logging.getLogger()
    saved = (list(root.handlers), root.level)
    logging.disable(logging.CRITICAL)
    try:
        with tempfile.TemporaryDirectory(prefix="inspire_speed_run_") as tmp:
            import pathlib
            obj, spark = build(ns, pathlib.Path(tmp), mode)
            obj.run()
            final = (obj.recorded["tracking"] or [[]])[-1]
    finally:
        logging.disable(logging.NOTSET)
        root.handlers[:] = saved[0]
        root.setLevel(saved[1])
    stats = OrderedDict((name, {"calls": 0, "prompt_chars": 0}) for name in PROMPT_MARKERS)
    for op in spark.ops:
        name = prompt_name(op["args"].get("prompt_text", ""))
        entry = stats.setdefault(name, {"calls": 0, "prompt_chars": 0})
        entry["calls"] += 1
        entry["prompt_chars"] += len(op["args"].get("prompt_text", ""))
    generated = N_TABLES * UCS_PER_TABLE
    return {"ref": ref, "mode": mode, "generated_use_cases": generated, "final_use_cases": len(final),
            "stages": stats, "total_calls": sum(s["calls"] for s in stats.values()),
            "total_prompt_chars": sum(s["prompt_chars"] for s in stats.values())}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--notebook", default=os.path.join(ROOT, "agent", "dbx_inspire_ai_agent.ipynb"))
    ap.add_argument("--mode", default="Good", choices=sorted(ACCEPTABLE))
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    result = profile(args.notebook, args.mode)
    if args.json:
        print(json.dumps(result))
        return
    print(f"{result['ref']} [{result['mode']}] generated={result['generated_use_cases']} final={result['final_use_cases']}")
    for name, s in result["stages"].items():
        avg = s["prompt_chars"] // s["calls"] if s["calls"] else 0
        print(f"  {name:<38} calls={s['calls']:>4} prompt_chars={s['prompt_chars']:>10,} avg={avg:>8,}")
    print(f"  {'TOTAL':<38} calls={result['total_calls']:>4} prompt_chars={result['total_prompt_chars']:>10,}")


if __name__ == "__main__":
    main()
