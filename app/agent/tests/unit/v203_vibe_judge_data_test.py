import ast
import json
import re
from pathlib import Path

from v120_artifacts_support import FakeSpark
from v140_implement_test import _inspire, sdk_stub

NOTEBOOK = Path(__file__).resolve().parents[2] / "agent" / "dbx_inspire_ai_agent.ipynb"
SOURCES = {"samples.tpch.lineitem": ["l_orderkey", "l_suppkey", "l_quantity", "l_shipdate", "l_commitdate", "l_receiptdate"],
           "samples.tpch.supplier": ["s_suppkey", "s_name", "s_nationkey", "s_acctbal"],
           "samples.tpch.nation": ["n_nationkey", "n_name"]}
USE_CASE = {"use_case": "Review suppliers that deliver late more often than similar size peers",
            "statement": "Find suppliers whose late-line rate is above their peer group"}
ASK = "Add a chart of each supplier's carbon emissions and ESG score next to the late-line rate"
MADE_UP = "\n".join([
    "CARBON_KG_PER_QUANTITY_UNIT = 0.5",
    "late_rate = late_lines / total_lines",
    "carbon_emissions_kg = quantity_total * CARBON_KG_PER_QUANTITY_UNIT",
    "esg_score = (1 - late_rate) * 100",
    "late_pct = late_rate * 100"])
CLEAN = "\n".join(["late_rate = late_lines / total_lines", "late_pct = late_rate * 100", "peer_gap = late_rate - peer_rate"])


def _held(agent_ns):
    return agent_ns["implement_vibes_held_terms"](SOURCES, USE_CASE)


def test_an_ask_for_data_the_sources_lack_names_only_the_missing_quantity(agent_ns):
    absent = agent_ns["implement_vibes_absent_terms"](ASK, _held(agent_ns))
    assert {"carbon", "emission", "esg"} <= set(absent)
    assert not {"supplier", "late", "rate", "score", "chart"} & set(absent)
    assert agent_ns["implement_vibes_absent_terms"]("Add a bar chart of the late-line rate by nation", _held(agent_ns)) == []
    assert agent_ns["implement_vibes_absent_terms"](ASK, frozenset()) == []


def test_the_guard_rejects_measures_made_up_from_constants_and_keeps_real_ones(agent_ns):
    absent = agent_ns["implement_vibes_absent_terms"](ASK, _held(agent_ns))
    found = agent_ns["implement_invented_measures"](MADE_UP, absent)
    assert [f["name"] for f in found] == ["CARBON_KG_PER_QUANTITY_UNIT", "carbon_emissions_kg", "esg_score"]
    assert agent_ns["implement_invented_measures"](CLEAN, absent) == []
    assert agent_ns["implement_invented_measures"]("esg_score = row.esg_score", absent) == []
    assert agent_ns["implement_invented_measures"](MADE_UP, []) == []


def _round(agent_ns, artifact, verdicts, ask=ASK):
    inst = _inspire(agent_ns, FakeSpark())
    asked = []

    def llm(kind, prompt, schema):
        asked.append((kind, prompt))
        if kind == "split":
            return {"asks": [{"ask": ask, "check": None, "keep": False, "where": ""}]}
        return {"checks": [dict({"n": n}, **v) for n, v in enumerate(verdicts, 1)]}

    inst._implement_vibes_llm = llm
    item = {"asset": agent_ns["IMPLEMENT_NOTEBOOK"], "text": ask, "artifact": artifact, "sources": SOURCES,
            "held_terms": _held(agent_ns)}
    return inst._implement_vibes_round({}, [item], "N02-U05 notebook round 1/3"), asked


def test_a_notebook_that_makes_up_the_missing_data_is_held_with_the_plain_reason_and_never_asked_to_do_it_again(agent_ns):
    found, asked = _round(agent_ns, MADE_UP, [])
    [check] = found["checks"][agent_ns["IMPLEMENT_NOTEBOOK"]]
    assert check["status"] == "missing" and check["evidence"].startswith(agent_ns["IMPLEMENT_VIBES_NO_DATA"])
    assert "carbon_emissions_kg" in check["evidence"] and "esg_score" in check["evidence"]
    assert found["resend"] == {}
    assert [f["name"] for f in found["invented"][agent_ns["IMPLEMENT_NOTEBOOK"]]] == [
        "CARBON_KG_PER_QUANTITY_UNIT", "carbon_emissions_kg", "esg_score"]
    assert [k for k, _p in asked if k == "judge"] == []
    warning = agent_ns["implement_vibes_warnings"](agent_ns["IMPLEMENT_NOTEBOOK"], [check], 3)[0]
    assert "Genie could not" not in warning and "the source data holds no carbon" in warning


def test_the_judge_holds_a_missing_data_ask_and_its_prompt_lists_the_source_columns(agent_ns):
    reason = "No table holds carbon emissions or ESG scores; a supplier emissions table would make this possible"
    found, asked = _round(agent_ns, CLEAN, [{"status": "no_data", "evidence": reason, "where": ""}])
    [check] = found["checks"][agent_ns["IMPLEMENT_NOTEBOOK"]]
    assert check["evidence"] == agent_ns["IMPLEMENT_VIBES_NO_DATA"] + reason and found["resend"] == {}
    [prompt] = [p for k, p in asked if k == "judge"]
    assert "samples.tpch.supplier: s_suppkey, s_name, s_nationkey, s_acctbal" in prompt and '"no_data"' in prompt
    assert "every ask can be built" not in prompt


def test_a_no_data_verdict_on_an_ask_the_sources_can_answer_is_sent_back_not_held(agent_ns):
    ask = "Add a bar chart of the late-line rate by nation"
    found, _asked = _round(agent_ns, CLEAN, [{"status": "no_data", "evidence": "no rate", "where": ""}], ask)
    [check] = found["checks"][agent_ns["IMPLEMENT_NOTEBOOK"]]
    assert check["evidence"] == "no rate" and agent_ns["IMPLEMENT_NOTEBOOK"] in found["resend"]


def test_genie_is_told_never_to_make_up_data(agent_ns):
    assert "Never make up data" in agent_ns["IMPLEMENT_VIBES_EXPERT"]
    assert "never stand in for it" in agent_ns["IMPLEMENT_INVENTED_REPAIR"]


PAGE = {"id": "n02_u01", "title": "Pickup demand", "question": "Where to cover first?",
        "kpis": [{"id": "trips", "label": "Trips", "dataset": "records", "expression": "COUNT(*)"}],
        "charts": [{"id": "trips_by_pickup_hour", "type": "bar", "title": "Trips by pickup hour", "dataset": "hourly",
                    "x": {"column": "pickup_hour", "label": "Hour"}, "y": [{"expression": "SUM(trips)", "label": "Trips"}]}]}


def test_the_judge_finds_the_asked_bar_chart_by_its_type_and_its_synonyms(agent_ns):
    seen = agent_ns["implement_page_seen"](PAGE)
    scope = agent_ns["implement_vibes_scope"]
    for ask in ('Title the bar chart "Trips by pickup hour"', "Place the bar chart under Key numbers", "Sort the column chart by hour"):
        keys, problem = scope(seen, {"ask": ask, "where": ""}, "App page n02_u01", drawn=False)
        assert problem == "" and keys == ["trips_by_pickup_hour"], ask
    assert "bar chart" in seen["trips_by_pickup_hour"]["name"]
    line = json.loads(json.dumps(PAGE))
    line["charts"][0]["type"] = "line"
    keys, problem = scope(agent_ns["implement_page_seen"](line), {"ask": "Title the bar chart", "where": ""}, "App page n02_u01",
                          drawn=False)
    assert keys == [] and problem == "the built App page n02_u01 has no bar chart"


class _Agent:
    def __init__(self):
        self.calls = []

    def _call_ai_query(self, **kwargs):
        self.calls.append((kwargs["prompt_name"], kwargs.get("skip_cache")))
        return json.dumps({"checks": [], "asks": []})


def test_every_vibes_call_but_the_split_skips_the_llm_cache(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst.ai_agent = _Agent()
    for kind in ("judge", "judge", "repair", "route", "split"):
        inst._implement_vibes_llm(kind, "same prompt", {})
    assert inst.ai_agent.calls == [("implement_vibes_judge", True), ("implement_vibes_judge", True), ("implement_vibes_repair", True),
                                   ("implement_vibes_route", True), ("implement_vibes_split", False)]


LLM_CALLS = {"run_worker", "_call_ai_query", "_call_ai_query_impl", "_implement_llm_object"}
RETRY = re.compile(r"attempt|retr|round|tries")
RETRY_ARG = re.compile(r"^(?:attempt|round_no|retry|try_no)$")


def _cell():
    return "".join(json.loads(NOTEBOOK.read_text())["cells"][1]["source"])


def test_no_llm_call_inside_a_retry_or_round_loop_can_hit_the_cache():
    tree, parents, bad = ast.parse(_cell()), {}, []
    for node in ast.walk(tree):
        for child in ast.iter_child_nodes(node):
            parents[child] = node
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        name = getattr(node.func, "attr", getattr(node.func, "id", ""))
        if name not in LLM_CALLS:
            continue
        loop, up = None, node
        while up in parents and not isinstance(up, (ast.FunctionDef, ast.AsyncFunctionDef)):
            up = parents[up]
            if isinstance(up, (ast.For, ast.While)):
                head = ast.unparse(up.target if isinstance(up, ast.For) else up.test)
                if RETRY.search(head):
                    loop = head
                    break
        func = up if isinstance(up, (ast.FunctionDef, ast.AsyncFunctionDef)) else None
        retried = loop or (func and any(RETRY_ARG.match(a.arg) for a in func.args.args))
        skip = next((k.value for k in node.keywords if k.arg == "skip_cache"), None)
        if retried and (skip is None or (isinstance(skip, ast.Constant) and skip.value is False)):
            bad.append((node.lineno, name, loop))
    assert bad == []
    [vibes] = [n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "_implement_vibes_llm"]
    assert "skip_cache=kind not in IMPLEMENT_VIBES_CACHED_KINDS" in ast.unparse(vibes)


VALID = "Add a bar chart of the late-line rate by nation"
DERIVED = "Show the revenue lost to late lines by nation"
REASON = "No table holds carbon emissions or ESG scores; a supplier emissions table would make this possible"


def _hold(agent_ns, asks, verdicts=None, fails=False):
    inst = _inspire(agent_ns, FakeSpark())
    asked = []

    def llm(kind, prompt, schema):
        asked.append((kind, prompt))
        if kind == "split":
            return {"asks": [{"ask": a, "check": None, "keep": False, "where": ""} for a in asks]}
        if fails:
            raise RuntimeError("endpoint timed out")
        return {"checks": [dict({"n": n}, **v) for n, v in enumerate(verdicts or [], 1)]}

    inst._implement_vibes_llm = llm
    inst._implement_vibes_sources = lambda spec, use_case: SOURCES
    spec = {"data": {"notes": " ".join(asks)}, "outputs": {}}
    return inst._implement_vibes_hold("N02-U05", dict(USE_CASE), spec, {}), asked


def test_an_ask_for_data_the_sources_lack_is_held_before_genie_builds(agent_ns):
    held, asked = _hold(agent_ns, [ASK, VALID], [{"status": "no_data", "evidence": REASON, "where": ""}])
    assert held == {agent_ns["IMPLEMENT_NOTEBOOK"]: {ASK: agent_ns["IMPLEMENT_VIBES_NO_DATA"] + REASON}}
    [prompt] = [p for k, p in asked if k == "judge"]
    assert "Nothing is built for the part yet" in prompt and "s_acctbal" in prompt
    assert ASK in prompt and VALID not in prompt


def test_an_ask_whose_data_exists_still_goes_to_genie(agent_ns):
    held, asked = _hold(agent_ns, [VALID])
    assert held == {} and [k for k, _p in asked if k == "judge"] == []
    held, asked = _hold(agent_ns, [DERIVED], [{"status": "missing", "evidence": "nothing is built yet", "where": ""}])
    assert held == {} and [k for k, _p in asked if k == "judge"] == ["judge"]
    held, _asked = _hold(agent_ns, [VALID, ASK], [{"status": "no_data", "evidence": REASON, "where": ""}])
    assert VALID not in held.get(agent_ns["IMPLEMENT_NOTEBOOK"], {})
    held, _asked = _hold(agent_ns, [ASK], fails=True)
    assert held == {}


def test_genie_is_told_to_leave_a_held_ask_out_and_nothing_when_none_is_held(agent_ns):
    held = {agent_ns["IMPLEMENT_NOTEBOOK"]: {ASK: agent_ns["IMPLEMENT_VIBES_NO_DATA"] + REASON}}
    text = agent_ns["implement_choices_markdown"]({"data": {}, "config": {}, "outputs": {}}, held=held)
    assert f"Inspire holds these of the customer's asks" in text and f"1. {ASK} ({REASON})" in text
    assert "never stand in for them with other columns or fixed numbers" in text
    assert "Inspire holds" not in agent_ns["implement_choices_markdown"]({"data": {}, "config": {}, "outputs": {}})


def test_a_held_ask_is_reported_with_its_reason_and_never_judged_or_resent(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    asked = []

    def llm(kind, prompt, schema):
        asked.append(kind)
        return {"asks": [{"ask": ASK, "check": None, "keep": False, "where": ""}]} if kind == "split" else {"checks": []}

    inst._implement_vibes_llm = llm
    reason = agent_ns["IMPLEMENT_VIBES_NO_DATA"] + REASON
    item = {"asset": agent_ns["IMPLEMENT_NOTEBOOK"], "text": ASK, "artifact": CLEAN, "sources": SOURCES,
            "held_terms": _held(agent_ns), "held_asks": {ASK: reason}}
    found = inst._implement_vibes_round({}, [item], "N02-U05 notebook round 1/3")
    [check] = found["checks"][agent_ns["IMPLEMENT_NOTEBOOK"]]
    assert (check["status"], check["evidence"]) == ("missing", reason)
    assert found["resend"] == {} and "judge" not in asked


def test_the_hold_runs_before_the_notebook_is_written_and_reaches_its_instruction():
    source = "".join(json.loads(NOTEBOOK.read_text())["cells"][1]["source"])
    hold = source.index('use_case["_implement_held"] = self._implement_vibes_hold(uc_id, use_case, spec, vibes_split)')
    assert hold < source.index("notebook_path = self._implement_write_notebook(use_case, spec, basis, key")
    assert 'held=use_case.get("_implement_held"))' in source
    assert '"held_asks": ((use_case or {}).get("_implement_held") or {}).get(asset) or {}' in source


LIVE_ASK = "each supplier's carbon emissions and ESG score"


def test_the_live_carbon_ask_is_held_although_the_use_case_carries_its_own_notes(agent_ns):
    live = dict(USE_CASE, _implement_notes=f"Add {LIVE_ASK}.", _implement_repair_note=LIVE_ASK, _implement_job_name="N02-U05 v4")
    assert {"carbon", "emission", "esg"} <= set(agent_ns["implement_vibes_absent_terms"](
        LIVE_ASK, agent_ns["implement_vibes_held_terms"](SOURCES, live)))
    inst = _inspire(agent_ns, FakeSpark())
    asked = []

    def llm(kind, prompt, schema):
        asked.append(kind)
        if kind == "split":
            return {"asks": [{"ask": LIVE_ASK, "check": None, "keep": False, "where": ""}]}
        return {"checks": [{"n": 1, "status": "no_data", "evidence": REASON, "where": ""}]}

    inst._implement_vibes_llm = llm
    inst._implement_vibes_sources = lambda spec, use_case: SOURCES
    held = inst._implement_vibes_hold("N02-U05", live, {"data": {"notes": f"Add {LIVE_ASK}."}, "outputs": {}}, {})
    assert held == {agent_ns["IMPLEMENT_NOTEBOOK"]: {LIVE_ASK: agent_ns["IMPLEMENT_VIBES_NO_DATA"] + REASON}}
    assert asked.count("judge") == 1
    assert agent_ns["implement_vibes_absent_terms"]("the late-line rate by nation", agent_ns["implement_vibes_held_terms"](SOURCES, live)) == []
