"""v1.4.0 WP1: one use-case kind registry, `app_shell/kinds.json`. The notebook pins its sha256 through the App shell
packer, reads it from the Inspire assets only through `_inspire_kinds()`; the App shell web code and the Inspire App frontend import the
same file, and no other file holds a copy of the kind list."""
import copy
import importlib.util
import json
import os
import re
import shutil
import subprocess

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REPO = os.path.dirname(os.path.dirname(ROOT))
SHELL = os.path.join(ROOT, "agent", "app_shell")
KINDS_FILE = os.path.join(SHELL, "kinds.json")
AGENT_NB = os.path.join(ROOT, "agent", "dbx_inspire_ai_agent.ipynb")
BUNDLED_NB = os.path.join(REPO, "app", "dbx_inspire_ai_agent.ipynb")

FAMILIES = ["measure_explain", "predict", "decide_optimize", "simulate_plan", "measure_impact", "detect_protect", "know_entities",
            "run_processes", "place_relationships", "text_agents"]
LAYOUTS = ["decision_queue", "monitor_triage", "forecast_cockpit", "scenario_lab", "planner", "segment_explorer", "recommendation_desk",
           "performance_explainer", "lift_readout", "process_flow", "location_view", "network_explorer", "agent_chat", "dashboard"]
ROLES = ["money", "quantity", "price", "cost", "budget_target", "capacity_limit", "rate_probability", "event_time", "status_activity",
         "case_id", "latitude", "longitude", "region_code", "edge_pair", "treatment", "spec_limit", "approver_creator", "score_limit",
         "free_text"]
CONTRACTS = {
    "forecast": {"__series": ["series_id", "period", "actual", "forecast", "lower", "upper", "is_future", "method", "backtest_mase"]},
    "scenario": {"__scenarios": ["scenario_id", "lever_values", "outcome", "p10", "p50", "p90", "prob_target"],
                 "__sensitivity": ["lever", "low", "high", "delta"], "__scenario_model": ["driver", "coefficient"]},
    "plan": {"__plan": ["entity", "decision", "current_value", "recommended_value", "delta", "objective_contribution"],
             "__constraints": ["name", "limit", "used", "slack", "shadow_price"]},
    "segments": {"__segments": ["segment_id", "label", "size", "value", "profile"], "__assign": ["entity", "segment", "x", "y"],
                 "__migration": ["from_segment", "to_segment", "count"]},
    "recommendations": {"__recs": ["entity", "rank", "item", "score", "reason"]},
    "explainer": {"__variance": ["unit", "period", "actual", "plan", "variance", "tolerance"], "__bridge": ["step", "label", "value", "step_type"],
                  "__peers": ["unit", "peer_group", "metric", "peer_median", "gap"]},
    "impact": {"__effect": ["intervention", "metric", "effect", "lower", "upper", "p_value", "incremental_value", "cost", "roi"],
               "__effect_series": ["period", "actual", "counterfactual", "lower", "upper"]},
    "process": {"__transitions": ["from_step", "to_step", "cases", "median_hours", "p90_hours", "rework"],
                "__cases": ["case_id", "step", "age_hours", "breach_risk"]},
    "location": {"__geo": ["entity", "lat", "lon", "region_code", "metric"]},
    "network": {"__nodes": ["node", "label", "community", "centrality", "metric"], "__edges": ["src", "dst", "weight"]},
    "monitor": {"__signal": ["series", "period", "value", "expected", "lower", "upper", "is_anomaly", "rule"]},
    "decision_queue": {"__score_bins": ["bin", "count", "cutoff"], "__lift": ["decile", "captured_share", "cost_at_cutoff"]},
}
INFORMATIONAL = {2: "performance_explainer", 4: "forecast_cockpit", 33: "process_flow", 37: "location_view", 39: "performance_explainer",
                 40: None}
PLAN_LAYOUT = {1: "performance_explainer", 3: "performance_explainer", 5: "forecast_cockpit", 6: "decision_queue", 7: "decision_queue",
               8: "recommendation_desk", 9: "planner", 10: "planner", 11: "planner", 12: "planner", 13: "location_view", 14: "decision_queue",
               15: "planner", 16: "scenario_lab", 17: "scenario_lab", 18: "forecast_cockpit", 19: "lift_readout", 20: "lift_readout",
               21: "lift_readout", 22: "decision_queue", 23: "monitor_triage", 24: "monitor_triage", 25: "monitor_triage",
               26: "monitor_triage", 27: "network_explorer", 28: "segment_explorer", 29: "segment_explorer", 30: "segment_explorer",
               31: "recommendation_desk", 32: "network_explorer", 34: "process_flow", 35: "monitor_triage", 36: "decision_queue",
               38: "network_explorer"}
NEW_TECHNIQUES = ["Decomposition", "Peer Benchmarking", "Process Mining", "Sequence Analysis", "Causal Impact", "Uplift Modeling",
                  "Marketing Mix Modeling", "Threshold Optimization", "Queueing", "Controls Testing", "Statistical Process Control",
                  "Entity Matching", "Lifetime Value", "Data Agent"]
PLACEHOLDER = re.compile(r"\{([a-z_]+)\}")
SUFFIX = re.compile(r"__[a-z_]+")
COPY_MARKERS = 10
SKIPPED_PARTS = {"node_modules", "dist", ".git", "__pycache__"}


def _registry():
    with open(KINDS_FILE, encoding="utf-8") as handle:
        return json.load(handle)


def _embed():
    spec = importlib.util.spec_from_file_location("inspire_app_shell_embed_kinds", os.path.join(SHELL, "embed.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from _strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item)


def registry_problems(doc: dict) -> list:
    out = []
    families = [f["id"] for f in doc.get("families", [])]
    layouts = {l["id"]: l for l in doc.get("layouts", [])}
    contracts = doc.get("contracts", {})
    roles = [r["id"] for r in doc.get("roles", [])]
    placeholders = set(doc.get("placeholders", []))
    kinds = doc.get("kinds", [])
    ids = [k.get("id") for k in kinds]
    if len(set(ids)) != len(ids):
        out.append("kind ids are not unique")
    if sorted(k.get("num") for k in kinds) != list(range(1, 41)):
        out.append("kind nums are not 1..40")
    for layout in layouts.values():
        if layout["contract"] is not None and layout["contract"] not in contracts:
            out.append(f"layout {layout['id']} names a missing contract {layout['contract']}")
        if not layout["sections"] or set(layout["min_items"]) - set(layout["sections"]):
            out.append(f"layout {layout['id']} has min_items outside its sections")
    for kind in kinds:
        name = kind.get("id")
        if kind.get("family") not in families:
            out.append(f"{name}: unknown family {kind.get('family')}")
        if kind.get("layout") not in layouts:
            out.append(f"{name}: unknown layout {kind.get('layout')}")
            continue
        decision = kind.get("decision_layout")
        if kind.get("informational"):
            own = decision is None and kind["layout"] != "dashboard" and layouts[kind["layout"]].get("informational") is True
            if not own and (kind["layout"] != "dashboard" or decision not in layouts or decision == "dashboard"):
                out.append(f"{name}: an informational kind is served as a dashboard with a decision layout")
        elif decision is not None or kind["layout"] == "dashboard":
            out.append(f"{name}: a decision kind has its own decision layout and no alternative")
        served = layouts[decision or kind["layout"]]
        if kind.get("contract") != served["contract"]:
            out.append(f"{name}: contract {kind.get('contract')} is not the one of layout {served['id']}")
        if kind.get("contract") is not None and kind["contract"] not in contracts:
            out.append(f"{name}: contract {kind['contract']} does not exist")
        techniques = kind.get("techniques") or []
        if not techniques or set(kind.get("method_plain", {})) != set(techniques):
            out.append(f"{name}: needs techniques, each with a plain method line")
        if kind.get("value_lever") not in ("revenue", "cost", "risk", "capital", "time"):
            out.append(f"{name}: unknown value lever")
        signature = kind.get("signature", {})
        used = signature.get("roles_all", []) + signature.get("roles_any", []) + list(signature.get("min_counts", {}))
        if set(used) - set(roles) or not used:
            out.append(f"{name}: signature roles {sorted(set(used) - set(roles))} are unknown or none are named")
        if signature.get("fk_pattern") not in (None, "edge_pair", "fact_to_dim"):
            out.append(f"{name}: unknown foreign-key pattern")
        if signature.get("fk_pattern") == "edge_pair" and "edge_pair" not in signature.get("roles_all", []):
            out.append(f"{name}: the edge_pair pattern needs the edge_pair role")
        genie = kind.get("genie", {})
        if len(genie.get("questions", [])) < 5 or not genie.get("measures") or not kind.get("alerts") or not kind.get("dashboard", {}).get("widgets"):
            out.append(f"{name}: needs 5 Genie questions, measures, alerts and dashboard widgets")
        for field in ("label", "question", "value_formula", "serving_template", "strip_must_remain", "demo_signal"):
            if not str(kind.get(field) or "").strip():
                out.append(f"{name}: {field} is empty")
        stray = {p for text in _strings(kind) for p in PLACEHOLDER.findall(text)} - placeholders
        if stray:
            out.append(f"{name}: unknown placeholders {sorted(stray)}")
        suffixes = set(contracts.get(kind.get("contract"), {}).get("suffixes", {}))
        sources = {w["source"] for w in kind["dashboard"]["widgets"]}
        if sources - suffixes - {"decision"}:
            out.append(f"{name}: dashboard reads tables outside its contract {sorted(sources - suffixes - {'decision'})}")
        named = {s for alert in kind["alerts"] for s in SUFFIX.findall(alert["rule"])}
        if named - suffixes:
            out.append(f"{name}: alerts read tables outside its contract {sorted(named - suffixes)}")
    mapping = doc.get("technique_kind", {})
    by_id = {k.get("id"): k for k in kinds}
    for technique, kind_id in mapping.items():
        if kind_id not in by_id or technique not in by_id[kind_id]["techniques"]:
            out.append(f"technique {technique} maps to {kind_id}, which does not allow it")
    for technique in sorted({t for k in kinds for t in k.get("techniques", [])} - set(mapping)):
        out.append(f"technique {technique} has no kind for old rows")
    return out


def copies_of_kind_list(text: str, ids) -> bool:
    return sum(1 for kind_id in ids if re.search(rf"(?<![A-Za-z0-9_]){re.escape(kind_id)}(?![A-Za-z0-9_])", text)) >= COPY_MARKERS


def _distinctive_ids(doc):
    return [k["id"] for k in doc["kinds"] if "_" in k["id"]]


def _repo_files():
    listed = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard"], cwd=REPO, capture_output=True, text=True,
                            check=True).stdout.split("\n")
    for relative in filter(None, listed):
        if not set(relative.split("/")) & SKIPPED_PARTS and os.path.isfile(os.path.join(REPO, relative)):
            yield relative


def test_the_registry_holds_the_40_kinds_14_layouts_and_the_plan_contracts():
    doc = _registry()
    assert doc["version"] == 1
    assert [f["id"] for f in doc["families"]] == FAMILIES
    assert [l["id"] for l in doc["layouts"]] == LAYOUTS
    assert [r["id"] for r in doc["roles"]] == ROLES
    assert {cid: c["suffixes"] for cid, c in doc["contracts"].items()} == CONTRACTS
    assert [l["id"] for l in doc["layouts"] if l["enabled"]] == ["decision_queue", "monitor_triage", "forecast_cockpit", "scenario_lab", "planner",
                                                                 "segment_explorer", "recommendation_desk", "performance_explainer", "lift_readout",
                                                                 "process_flow", "location_view", "network_explorer", "agent_chat", "dashboard"]
    assert {l["id"] for l in doc["layouts"] if l["contract"] is None} == {"agent_chat", "dashboard"}
    assert {l["contract"] for l in doc["layouts"]} - {None} == set(CONTRACTS)
    assert {f["id"] for f in doc["families"]} == {k["family"] for k in doc["kinds"]}
    nums = {k["num"]: k for k in doc["kinds"]}
    assert {n: k["decision_layout"] for n, k in nums.items() if k["informational"]} == INFORMATIONAL
    assert {n: k["layout"] for n, k in nums.items() if not k["informational"]} == PLAN_LAYOUT
    assert [k["id"] for k in doc["kinds"] if k["contract"] is None] == ["data_agent"]
    assert set(NEW_TECHNIQUES) <= {t for k in doc["kinds"] for t in k["techniques"]}
    assert registry_problems(doc) == []


@pytest.mark.parametrize("breaks, expected", [
    (lambda d: d["kinds"][0].update(family="nowhere"), "unknown family"),
    (lambda d: d["kinds"][0].update(layout="nowhere"), "unknown layout"),
    (lambda d: d["kinds"][4].update(contract="plan"), "is not the one of layout"),
    (lambda d: d["kinds"][1].update(decision_layout=None), "informational kind"),
    (lambda d: d["kinds"][0].update(decision_layout="planner"), "a decision kind"),
    (lambda d: d["kinds"][0].update(techniques=[], method_plain={}), "needs techniques"),
    (lambda d: d["kinds"][0]["genie"].update(questions=[]), "needs 5 Genie questions"),
    (lambda d: d["kinds"][0].update(alerts=[]), "needs 5 Genie questions"),
    (lambda d: d["kinds"][0]["dashboard"].update(widgets=[]), "needs 5 Genie questions"),
    (lambda d: d["kinds"][1].update(id=d["kinds"][0]["id"]), "not unique"),
    (lambda d: d["kinds"][1].update(num=1), "not 1..40"),
    (lambda d: d["kinds"][0]["signature"].update(roles_all=["shoe_size"]), "signature roles"),
    (lambda d: d["kinds"][0].update(value_formula="saved {dollars}"), "unknown placeholders"),
    (lambda d: d["kinds"][0]["dashboard"]["widgets"].append({"widget": "table", "source": "__series", "title": "x"}), "dashboard reads"),
    (lambda d: d["kinds"][0]["alerts"].append({"name": "x", "rule": "any {result_table}__nodes row"}), "alerts read"),
    (lambda d: d["layouts"][1].update(contract="nowhere"), "missing contract"),
    (lambda d: d["technique_kind"].update(Forecasting="anomaly"), "does not allow it"),
    (lambda d: d["technique_kind"].pop("Queueing"), "has no kind for old rows"),
])
def test_the_consistency_check_rejects_each_broken_registry_must_reject(breaks, expected):
    doc = copy.deepcopy(_registry())
    breaks(doc)
    assert any(expected in problem for problem in registry_problems(doc)), registry_problems(doc)


def test_no_file_but_kinds_json_holds_a_copy_of_the_kind_list():
    doc = _registry()
    ids = _distinctive_ids(doc)
    assert len(ids) >= 30
    holders = []
    for relative in _repo_files():
        if relative == "app/agent/agent/app_shell/kinds.json":
            continue
        try:
            with open(os.path.join(REPO, relative), encoding="utf-8") as handle:
                text = handle.read()
        except (UnicodeDecodeError, OSError):
            continue
        if copies_of_kind_list(text, ids):
            holders.append(relative)
    assert holders == []


def test_the_copy_detector_flags_a_pasted_kind_list_and_keeps_ordinary_code():
    ids = _distinctive_ids(_registry())
    assert copies_of_kind_list(json.dumps({"kinds": ids[:COPY_MARKERS]}), ids)
    assert copies_of_kind_list("\n".join(f"- {kind_id} -> layout" for kind_id in ids[-COPY_MARKERS:]), ids)
    assert not copies_of_kind_list("kind = _inspire_kind('variance_to_plan'); other = _inspire_kind('process_mining')", ids)
    assert not copies_of_kind_list("my_variance_to_plan_x and process_mining_rate", ids)


def test_the_notebook_and_its_bundled_copy_pin_kinds_json_and_hold_no_copy_of_it():
    embed = _embed()
    for notebook in (AGENT_NB, BUNDLED_NB):
        assert embed.notebook_pins(notebook)["kinds"] == embed.pins()["kinds"]
        assert embed.legacy_lines(notebook) == []
        with open(notebook, encoding="utf-8") as handle:
            assert "_INSPIRE_KINDS = " not in handle.read()
    assert embed.pins()["kinds"]["repo"] == "agent/app_shell/kinds.json"


def test_embed_write_pins_a_changed_registry_on_its_own_line_and_refuses_a_notebook_without_the_pin_line(tmp_path):
    embed = _embed()
    copy_nb, kinds = tmp_path / "agent.ipynb", tmp_path / "kinds.json"
    shutil.copyfile(AGENT_NB, copy_nb)
    kinds.write_text(json.dumps(dict(_registry(), note="changed")), encoding="utf-8")
    assets = dict(embed.ASSETS, kinds=("notebook/kinds.json", str(kinds)))
    assert embed.write_pins(str(copy_nb)) is False
    assert embed.write_pins(str(copy_nb), assets) is True
    assert embed.notebook_pins(str(copy_nb))["kinds"]["sha256"] != embed.pins()["kinds"]["sha256"]
    assert embed.notebook_pins(str(copy_nb))["app_shell"] == embed.pins()["app_shell"]
    assert embed.write_pins(str(copy_nb), assets) is False
    nb = json.loads(copy_nb.read_text(encoding="utf-8"))
    nb["cells"][1]["source"] = [line for line in nb["cells"][1]["source"] if not line.startswith(embed.CONSTANT)]
    copy_nb.write_text(json.dumps(nb, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    with pytest.raises(SystemExit, match="INSPIRE_NOTEBOOK_ASSETS"):
        embed.write_pins(str(copy_nb))


def test_inspire_kinds_reads_the_embedded_registry_once(agent_ns):
    doc = agent_ns["_inspire_kinds"]()
    assert doc == _registry()
    assert agent_ns["_inspire_kinds"]() is doc
    assert agent_ns["_inspire_kind"]("forecast")["layout"] == "forecast_cockpit"
    assert agent_ns["_inspire_kind"]("driver_breakdown")["decision_layout"] == "performance_explainer"
    assert agent_ns["_inspire_kind"]("no_such_kind") is None


def test_inspire_kinds_refuses_a_missing_or_foreign_registry_with_a_plain_error(fresh_ns):
    held = fresh_ns["_INSPIRE_NOTEBOOK_ASSET_TEXT"]
    fresh_ns["_INSPIRE_KINDS_REGISTRY"] = None
    held["kinds"] = ""
    with pytest.raises(RuntimeError, match="kind registry in the Inspire assets does not decode"):
        fresh_ns["_inspire_kinds"]()
    held["kinds"] = "not json at all!"
    with pytest.raises(RuntimeError, match="kind registry in the Inspire assets does not decode"):
        fresh_ns["_inspire_kinds"]()
    held["kinds"] = json.dumps(dict(_registry(), version=2))
    with pytest.raises(RuntimeError, match="no usable kind registry"):
        fresh_ns["_inspire_kinds"]()
    held["kinds"] = json.dumps(_registry())
    assert len(fresh_ns["_inspire_kinds"]()["kinds"]) == 40


def test_every_technique_the_notebook_knows_today_derives_a_kind_for_old_rows(agent_ns):
    known = agent_ns["TECHNIQUE_EXECUTION_FAMILY"]
    for technique in known:
        kind = agent_ns["_inspire_kind_for_technique"](technique)
        assert kind is not None, technique
        assert technique in kind["techniques"], technique
    assert agent_ns["_inspire_kind_for_technique"]("  survival   analysis ")["id"] == "time_to_event"
    assert agent_ns["_inspire_kind_for_technique"]("Process Mining")["id"] == "process_mining"
    assert agent_ns["_inspire_kind_for_technique"]("Crystal Ball Gazing") is None
    assert agent_ns["_inspire_kind_for_technique"](None) is None
    assert agent_ns["_technique_registry_key"]("forecasting") == "Forecasting"


def test_the_run_banner_logs_the_registry(agent_ns, capsys):
    agent_ns["print_ascii_banner"]()
    assert "[KINDS FIRED] registry v1: 40 kinds, 14 layouts" in capsys.readouterr().out


def test_the_shell_web_and_the_frontend_import_kinds_json_by_path():
    with open(os.path.join(SHELL, "web", "src", "kinds.js"), encoding="utf-8") as handle:
        shell = handle.read()
    with open(os.path.join(REPO, "app", "frontend", "src", "lib", "kinds.js"), encoding="utf-8") as handle:
        frontend = handle.read()
    assert "from '../../kinds.json'" in shell
    assert "from '../../../agent/agent/app_shell/web/src/kinds.js'" in frontend
    assert os.path.normpath(os.path.join(SHELL, "web", "src", "../../kinds.json")) == KINDS_FILE


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_the_shell_web_kind_helpers_read_the_same_registry():
    script = ("import { KINDS, kindOf, familyOf, kindForTechnique } from './src/kinds.js';"
              "console.log(JSON.stringify({n: KINDS.kinds.length, f: kindOf('forecast').layout, l: KINDS.layouts.find((x) => x.id === 'planner').contract,"
              "fam: familyOf('predict').label, t: kindForTechnique('  CLASSIFICATION ').id, none: kindForTechnique('nope'), miss: kindOf('nope'),"
              "same: (await import('../../../../frontend/src/lib/kinds.js')).kindOf === kindOf}));")
    out = subprocess.run(["node", "--input-type=module", "-e", script], cwd=os.path.join(SHELL, "web"), capture_output=True, text=True, check=True)
    assert json.loads(out.stdout) == {"n": 40, "f": "forecast_cockpit", "l": "plan", "fam": "Predict", "t": "risk_propensity", "none": None,
                                      "miss": None, "same": True}
