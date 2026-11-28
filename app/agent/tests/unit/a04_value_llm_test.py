"""R12 U7b (R12.2, the rest of R12.1, R12.9): the LLM proposes the value spec, code writes every number.

The LLM answers INSPIRE_VALUE_PROPOSAL_SCHEMA: the mechanism, flow or stock, a read-only baseline SQL, the columns it reads and
which assumption entries apply (by id). It never writes a number: any number in its answer rejects the proposal. Code builds the
one value spec with inspire_value_spec_from_proposal, taking the measured numbers from code-run SQL and the sourced ranges from
the assumption entries, and prices it with the one calculator, inspire_value_calculate. The card estimate (inspire_value_estimate)
and the per-record template path (inspire_value_formula, through inspire_value_formula_spec) build their spec the same way.
An offline model result such as AUC never promotes a benefit to proven (inspire_value_benefit_status).
The LLM is faked offline the way other tests fake ai_agent._call_ai_query: a callable taking the same keyword arguments."""
import ast
import copy
import json
import math
import os

import pytest

from _agentload import agent_ast
from v201_money_value_test import estimate_of, kpi, money_uc, ns  # noqa: F401  (ns is the shared fixture)

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES = os.path.normpath(os.path.join(HERE, "..", "..", "..", "shared", "value_spec_fixtures.json"))
CASES = {case["id"]: case for case in json.load(open(FIXTURES, encoding="utf-8"))["cases"]}
MECHANISMS = {"revenue", "cost", "working_capital", "capacity", "risk", "non_financial"}
TEXT_KEYS = {"mechanism", "flow_or_stock", "baseline_sql", "columns", "unit", "assumptions", "rationale"}
COLUMNS = ["c.s.orders.amount", "c.s.orders.order_date", "c.s.orders.customer_id"]
ENTRIES = {"effect_small": {"label": "a small effect on a measured flow", "low": 0.013, "base": 0.021, "high": 0.037, "source": "library"},
           "adoption_partial": {"label": "partial adoption by the people who act", "low": 0.41, "base": 0.53, "high": 0.67, "source": "library"}}
VALID = {"mechanism": "cost", "flow_or_stock": "flow",
         "baseline_sql": "SELECT SUM(amount) AS exposure FROM c.s.orders WHERE order_date >= date_sub(current_date(), 90)",
         "columns": {"exposure": "c.s.orders.amount", "period": "c.s.orders.order_date", "population": "c.s.orders.customer_id"},
         "unit": None, "assumptions": [{"slot": "effect", "entry": "effect_small"}, {"slot": "adoption", "entry": "adoption_partial"}],
         "rationale": "Acting on the flagged records lowers the cost they carry."}
UC = {"No": "N01-U01", "Name": "Lower the cost of late orders", "Primary Table": "c.s.orders", "Tables Involved": "c.s.orders"}


class FakeModel:
    """Stands in for ai_agent._call_ai_query: records each call's keyword arguments and returns a canned answer."""

    def __init__(self, answer):
        self.answer, self.calls = answer, []

    def __call__(self, **kwargs):
        self.calls.append(kwargs)
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer if isinstance(self.answer, str) else json.dumps(self.answer)


def fn(ns, name):
    found = ns.get(name)
    assert callable(found), f"R12.2/R12.9: the notebook defines no {name}"
    return found


def propose(ns, answer):
    model = FakeModel(answer)
    proposal, problems = fn(ns, "inspire_value_propose")(copy.deepcopy(UC), model, list(COLUMNS), copy.deepcopy(ENTRIES))
    return proposal, problems, model


def numbers_in(value):
    if isinstance(value, bool):
        return []
    if isinstance(value, (int, float)):
        return [float(value)]
    if isinstance(value, dict):
        return [n for inner in value.values() for n in numbers_in(inner)]
    if isinstance(value, list):
        return [n for inner in value for n in numbers_in(inner)]
    return []


# --- the LLM answer schema and the proposal call (fake model) ---

def test_1_the_proposal_schema_lets_the_llm_name_things_but_never_write_a_number(ns):
    schema = ns.get("INSPIRE_VALUE_PROPOSAL_SCHEMA")
    assert isinstance(schema, dict), "R12.2: the notebook defines no INSPIRE_VALUE_PROPOSAL_SCHEMA, the LLM's answer schema"
    types_seen, enums = set(), []

    def walk(node):
        if isinstance(node, dict):
            kind = node.get("type")
            types_seen.update(kind if isinstance(kind, list) else [kind] if kind else [])
            if "enum" in node:
                enums.append(node["enum"])
            for inner in node.values():
                walk(inner)
        elif isinstance(node, list):
            for inner in node:
                walk(inner)

    walk(schema)
    assert not types_seen & {"number", "integer", "boolean"}, f"the LLM answer schema has a numeric field: {types_seen}"
    assert all(isinstance(item, str) or item is None for enum in enums for item in enum), enums
    assert set(schema.get("properties") or {}) <= TEXT_KEYS and {"mechanism", "flow_or_stock", "baseline_sql", "assumptions"} <= set(schema["properties"])
    assert set(schema["properties"]["mechanism"]["enum"]) == MECHANISMS


def test_2_a_valid_fake_llm_answer_is_accepted_and_the_prompt_lists_entries_by_id_never_by_number(ns):
    proposal, problems, model = propose(ns, VALID)
    assert problems == [] and proposal is not None and proposal["mechanism"] == "cost", (proposal, problems)
    assert len(model.calls) == 1, "one model call per proposal"
    call = model.calls[0]
    assert call.get("response_schema") == ns["INSPIRE_VALUE_PROPOSAL_SCHEMA"], "the call must pass the proposal schema"
    assert isinstance(call.get("prompt_name"), str) and call["prompt_name"].strip()
    prompt = call["prompt"]
    for word in sorted(MECHANISMS) + sorted(ENTRIES) + COLUMNS:
        assert word in prompt, f"the prompt must name {word!r}"
    for entry in ENTRIES.values():
        for key in ("low", "base", "high"):
            assert str(entry[key]) not in prompt, f"the prompt shows the entry number {entry[key]}: the LLM picks the entry, never the number"


@pytest.mark.parametrize("answer, code", [
    ({**VALID, "effect": 0.35}, "llm_number:effect"),
    ({**VALID, "columns": {**VALID["columns"], "exposure": 1200000}}, "llm_number:columns.exposure"),
    ({**VALID, "assumptions": [{"slot": "effect", "entry": 0.2}]}, "llm_number:assumptions.0.entry"),
], ids=["top_level_effect", "exposure_as_number", "entry_as_number"])
def test_3_adversarial_any_number_in_the_llm_answer_rejects_the_proposal(ns, answer, code):
    proposal, problems, _model = propose(ns, answer)
    assert proposal is None, f"a proposal with an LLM-written number must never be used: {proposal}"
    assert code in problems, problems


def test_4_adversarial_an_unknown_mechanism_or_flow_and_a_unitless_capacity_are_refused(ns):
    for answer, code in (({**VALID, "mechanism": "synergy"}, "mechanism_unknown"),
                         ({**VALID, "flow_or_stock": "both"}, "flow_or_stock_unknown"),
                         ({**VALID, "mechanism": "capacity", "unit": None}, "unit_missing")):
        proposal, problems, _model = propose(ns, answer)
        assert proposal is None and code in problems, (answer, problems)
    proposal, problems, _model = propose(ns, {**VALID, "mechanism": "capacity", "unit": "hours"})
    assert problems == [] and proposal["unit"] == "hours", problems


def test_5_adversarial_entries_columns_and_sql_must_be_real_read_only_and_read_a_table(ns):
    cases = (({**VALID, "assumptions": [{"slot": "effect", "entry": "0.25"}]}, "assumption_unknown:0.25"),
             ({**VALID, "assumptions": [{"slot": "discount", "entry": "effect_small"}]}, "slot_unknown:discount"),
             ({**VALID, "columns": {**VALID["columns"], "exposure": "c.s.other.amount"}}, "column_unknown:exposure"),
             ({**VALID, "baseline_sql": "DELETE FROM c.s.orders"}, "baseline_sql_not_select"),
             ({**VALID, "baseline_sql": "SELECT SUM(amount) FROM c.s.orders; DROP TABLE c.s.orders"}, "baseline_sql_not_select"),
             ({**VALID, "baseline_sql": "SELECT 5000000 AS exposure"}, "baseline_sql_no_table"))
    for answer, code in cases:
        proposal, problems, _model = propose(ns, answer)
        assert proposal is None and code in problems, (answer, problems)


def test_6_a_broken_answer_or_a_failed_call_gives_problems_and_never_raises(ns):
    for answer, code in (("the spec is cost, effect about 5%", "answer_not_json"),
                         ([VALID], "proposal_not_object"),
                         (RuntimeError("endpoint unavailable"), "call_failed")):
        proposal, problems, _model = propose(ns, answer)
        assert proposal is None and code in problems, (answer, problems)


# --- code builds the one spec; no LLM number reaches the money math ---

def _revenue_proposal():
    return {"mechanism": "revenue", "flow_or_stock": "flow", "baseline_sql": "SELECT SUM(amount) FROM c.s.orders",
            "columns": {"exposure": "c.s.orders.amount"}, "unit": None,
            "assumptions": [{"slot": "effect", "entry": "e"}, {"slot": "adoption", "entry": "a"},
                            {"slot": "realization", "entry": "r"}, {"slot": "margin", "entry": "m"}]}


def _revenue_inputs():
    spec = CASES["revenue_at_margin"]["spec"]
    entries = {key: {"label": f"entry {key}", **spec["sourced"][slot]}
               for key, slot in (("e", "effect"), ("a", "adoption"), ("r", "realization"), ("m", "margin"))}
    return spec, copy.deepcopy(spec["measured"]), entries


def test_7_the_spec_built_from_a_proposal_is_the_shared_fixture_spec_and_prices_the_same(ns):
    spec, measured, entries = _revenue_inputs()
    built = fn(ns, "inspire_value_spec_from_proposal")(_revenue_proposal(), measured, entries, "USD", 3, copy.deepcopy(spec["cost"]))
    assert built == spec, f"the built spec must be exactly the fixture spec:\n{built}\n!=\n{spec}"
    out = ns["inspire_value_calculate"](built)
    expected = CASES["revenue_at_margin"]["expected"]
    assert out["ok"] and out["flags"] == expected["flags"], out
    assert math.isclose(out["scenarios"]["base"]["gross_annual"], expected["scenarios"]["base"]["gross_annual"], rel_tol=1e-9)


def test_8_adversarial_numbers_smuggled_into_a_proposal_never_reach_the_spec_or_the_calculator(ns):
    spec, measured, entries = _revenue_inputs()
    build = fn(ns, "inspire_value_spec_from_proposal")
    clean = build(_revenue_proposal(), copy.deepcopy(measured), entries, "USD", 3, copy.deepcopy(spec["cost"]))
    # sentinels are values the fixture spec never holds (it holds 0.9 and 1.0 itself), so any hit is a leak
    dirty_proposal = {**_revenue_proposal(), "exposure": 9e12, "effect": 0.913, "margin": 0.991, "horizon_years": 10, "currency": "XXX",
                      "measured": {"exposure": 1.0, "period_days": 1}, "sourced": {"effect": {"low": 0.913, "base": 0.957, "high": 0.977, "source": "measured"}},
                      "cost": {"source": "owner", "tiers": {t: {"implementation": 0, "recurring_per_year": 0} for t in "SML"}},
                      "columns": {"exposure": "c.s.orders.amount", "value": 777777.0}}
    dirty = build(dirty_proposal, copy.deepcopy(measured), entries, "USD", 3, copy.deepcopy(spec["cost"]))
    assert dirty == clean, "only text keys of the proposal may shape the spec"
    sentinels = {9e12, 0.913, 0.957, 0.977, 0.991, 777777.0}
    assert not sentinels & set(numbers_in(spec)), "the sentinels must not collide with the fixture"
    assert not sentinels & set(numbers_in(dirty)), dirty
    assert ns["inspire_value_calculate"](dirty) == ns["inspire_value_calculate"](clean)


def _tree():
    """The agent notebook plus the run-side source it execs and inlines into every generated notebook
    (IMPLEMENT_RESULT_HISTORY_SOURCE): a function defined in that string is agent code too."""
    tree = agent_ast()
    held = [n.value.value for n in ast.walk(tree) if isinstance(n, ast.Assign) and isinstance(n.value, ast.Constant)
            and isinstance(n.value.value, str) and any(getattr(t, "id", "") == "IMPLEMENT_RESULT_HISTORY_SOURCE" for t in n.targets)]
    assert len(held) == 1, "the notebook defines IMPLEMENT_RESULT_HISTORY_SOURCE once, as a string"
    tree.body.extend(ast.parse(held[0]).body)
    return tree


def _violations(tree, exempt=("inspire_value_proposal_problems",)):
    """Every place an LLM value proposal can feed a number into the money math, in the value functions (name holds "value") and
    inspire_merge_run. The LLM value proposal variable is always named `proposal` there."""
    found = []
    mentions = lambda node: any(isinstance(n, ast.Name) and n.id == "proposal" for n in ast.walk(node))
    for func in (n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))):
        if func.name in exempt or "value" not in func.name.lower() and func.name != "inspire_merge_run" or not mentions(func):
            continue
        for node in ast.walk(func):
            where = f"{func.name}:{getattr(node, 'lineno', '?')}"
            if isinstance(node, ast.Subscript) and isinstance(node.value, ast.Name) and node.value.id == "proposal":
                key = node.slice.value if isinstance(node.slice, ast.Constant) else None
                if key not in TEXT_KEYS:
                    found.append(f"{where} reads proposal[{key!r}]")
            elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name) \
                    and node.func.value.id == "proposal":
                key = node.args[0].value if node.func.attr == "get" and node.args and isinstance(node.args[0], ast.Constant) else None
                if node.func.attr != "get" or key not in TEXT_KEYS:
                    found.append(f"{where} calls proposal.{node.func.attr}({key!r})")
            elif isinstance(node, ast.Call):
                name = node.func.id if isinstance(node.func, ast.Name) else node.func.attr if isinstance(node.func, ast.Attribute) else ""
                args = list(node.args) + [k.value for k in node.keywords]
                if name in {"float", "int", "Decimal", "round", "abs", "sum", "inspire_value_calculate"} and any(mentions(a) for a in args):
                    found.append(f"{where} passes the proposal to {name}()")
                if name in {"dict", "deepcopy", "copy", "update"} and any(isinstance(a, ast.Name) and a.id == "proposal" for a in args):
                    found.append(f"{where} copies the whole proposal with {name}()")
                if any(k.arg is None and mentions(k.value) for k in node.keywords):
                    found.append(f"{where} splats the proposal into a call")
            elif isinstance(node, ast.Dict) and any(k is None and mentions(v) for k, v in zip(node.keys, node.values)):
                found.append(f"{where} splats the proposal into a dict")
            elif isinstance(node, ast.BinOp) and (mentions(node.left) or mentions(node.right)):
                found.append(f"{where} does arithmetic on the proposal")
    return found


def test_9_static_no_llm_returned_number_reaches_the_money_math_zero_violations():
    probe = ast.parse("def bad_value(proposal):\n    x = float(proposal['exposure'])\n    return inspire_value_calculate({**proposal, 'e': x * 2})\n")
    assert len(_violations(probe)) >= 3, "the static check must catch a planted leak (harder probe)"
    tree = _tree()
    defs = {n.name: n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)}
    needed = {"inspire_value_propose", "inspire_value_proposal_problems", "inspire_value_spec_from_proposal", "inspire_value_formula_spec"}
    assert needed <= set(defs), f"R12.2: missing {sorted(needed - set(defs))}"
    assert "proposal" in [a.arg for a in defs["inspire_value_spec_from_proposal"].args.args], "the spec builder takes the proposal as `proposal`"
    violations = _violations(tree)
    assert violations == [], "LLM-returned values reach the money math:\n" + "\n".join(violations)


def test_10_static_there_is_one_spec_builder():
    tree = _tree()
    builders = sorted({func.name for func in ast.walk(tree) if isinstance(func, (ast.FunctionDef, ast.AsyncFunctionDef))
                       for node in ast.walk(func) if isinstance(node, ast.Dict)
                       and {"mechanism", "sourced"} <= {k.value for k in node.keys if isinstance(k, ast.Constant)}})
    assert builders == ["inspire_value_spec_from_proposal"], f"R12.1: value specs are built in more than one place: {builders}"


# --- the card estimate goes through the one builder and takes the LLM's mechanism when it is valid ---

def _spy(ns, monkeypatch, name):
    real, seen = fn(ns, name), []

    def spy(*args, **kwargs):
        out = real(*args, **kwargs)
        seen.append(copy.deepcopy(out))
        return out

    monkeypatch.setitem(ns, name, spy)
    return seen


def test_11_the_card_estimate_builds_its_spec_with_the_one_builder_and_is_never_proven(ns, monkeypatch):
    built = _spy(ns, monkeypatch, "inspire_value_spec_from_proposal")
    priced = _spy(ns, monkeypatch, "inspire_value_calculate")
    estimate = estimate_of(ns, money_uc(ns, kpi(ns, unit="USD")), "", "predict")
    assert len(built) == 1, "inspire_value_estimate must build its spec with inspire_value_spec_from_proposal, once"
    assert priced and built[0]["mechanism"] == "revenue" and built[0]["sourced"]["effect"]["source"] == "exploratory", built
    assert estimate["status"] == "measured" and estimate.get("benefit_status") == "exploratory", estimate
    owner = estimate_of(ns, money_uc(ns, kpi(ns, unit="USD")), "assume an uplift of 4-6% for every use case", "predict")
    assert owner.get("benefit_status") == "estimated", owner


def test_12_a_valid_llm_proposal_on_the_use_case_sets_the_mechanism(ns, monkeypatch):
    priced = _spy(ns, monkeypatch, "inspire_value_spec_from_proposal")
    proposal = {"mechanism": "risk", "flow_or_stock": "flow", "baseline_sql": "SELECT SUM(amount) FROM c.s.orders",
                "columns": {"exposure": "c.s.orders.amount"}, "unit": None, "assumptions": [], "rationale": "expected loss avoided"}
    estimate = estimate_of(ns, money_uc(ns, kpi(ns, unit="USD"), **{"Value Proposal": proposal}), "", "predict")
    assert priced and priced[-1]["mechanism"] == "risk", "the LLM's valid mechanism must be used, not the code default"
    assert estimate["status"] == "measured" and not estimate.get("value_proposal_problems"), estimate


def test_13_adversarial_an_invalid_llm_proposal_on_the_use_case_is_ignored_and_said(ns, monkeypatch):
    priced = _spy(ns, monkeypatch, "inspire_value_spec_from_proposal")
    for proposal, code in (({"mechanism": "synergy", "flow_or_stock": "flow"}, "mechanism_unknown"),
                           ({"mechanism": "cost", "flow_or_stock": "flow", "effect": 0.5}, "llm_number:effect")):
        estimate = estimate_of(ns, money_uc(ns, kpi(ns, unit="USD"), **{"Value Proposal": proposal}), "", "predict")
        spec = priced[-1]
        assert spec["mechanism"] == "revenue", f"an invalid proposal must fall back to the code default: {spec}"
        effect = spec["sourced"]["effect"]
        assert (effect["low"], effect["high"]) == (0.02, 0.05), "an LLM number never replaces the sourced effect"
        assert code in (estimate.get("value_proposal_problems") or []), estimate


# --- the per-record template path joins the same spec and calculator ---

def test_14_the_formula_path_builds_the_same_spec_and_its_constants_never_become_spec_numbers(ns, monkeypatch):
    value = {"basis": "measured", "currency": "USD", "kind": "money", "unit": "USD", "constants": {"WEEKS_LEFT": 13.0},
             "formula": "{margin_lost_week:money} lost a week x {WEEKS_LEFT:number} weeks left",
             "proposal": {**VALID, "columns": {"exposure": "value_at_stake"}}}
    formula, problems = ns["inspire_value_formula"](value, [("margin_lost_week", "DOUBLE"), ("value_at_stake", "DOUBLE")])
    assert formula and not problems, problems
    built = _spy(ns, monkeypatch, "inspire_value_spec_from_proposal")
    spec = fn(ns, "inspire_value_formula_spec")(value, formula, {"exposure": 50000.0, "period_days": 30}, copy.deepcopy(ENTRIES))
    assert len(built) == 1 and spec == built[0], "the formula path must build its spec with inspire_value_spec_from_proposal"
    assert spec["mechanism"] == "cost" and spec["currency"] == "USD" and spec["measured"]["exposure"] == 50000.0, spec
    assert 13.0 not in numbers_in(spec), "a formula constant stays in the per-record expression, never in the spec"
    out = ns["inspire_value_calculate"](spec)
    assert out["ok"] and math.isclose(out["annual_exposure"], 50000.0 * 365 / 30, rel_tol=1e-9), out
    assert fn(ns, "inspire_value_formula_spec")({**value, "proposal": {"mechanism": "synergy"}}, formula, {"exposure": 1.0}, ENTRIES) is None
    assert fn(ns, "inspire_value_formula_spec")({k: v for k, v in value.items() if k != "proposal"}, formula, {"exposure": 1.0}, ENTRIES) is None


def test_15_the_run_profile_measures_the_total_at_stake_for_the_formula_spec(ns):
    value = {"basis": "measured", "currency": "USD", "kind": "money", "amounts": {"act_now_amount": "100", "review_amount": "10"}}
    sql = ns["inspire_run_profile_sql"]("c.s.stage", ["use_case_id", "run_id", "as_of_date", "entity_id", "value_at_stake"], value)
    assert "AS stake_total" in sql and "SUM(" in sql.upper(), "the profile must measure SUM(value_at_stake) AS stake_total (code-measured exposure)"


def test_16_static_the_new_paths_have_call_sites():
    tree = _tree()
    defs = {n.name: n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)}
    calls = lambda name: {(n.func.id if isinstance(n.func, ast.Name) else getattr(n.func, "attr", "")) for n in ast.walk(defs[name])
                          if isinstance(n, ast.Call)}
    assert "inspire_value_propose" in calls("_apply_value_estimates"), "Discover must ask the LLM for the value proposal"
    assert {"inspire_value_formula_spec", "inspire_value_calculate"} <= calls("inspire_merge_run"), \
        "the run must price its per-record template through the one spec and calculator"
    assert any(isinstance(n, ast.Constant) and n.value == "value_proposal" for n in ast.walk(defs["inspire_value_run_config"])), \
        "the run's value config must carry INSPIRE_RUN['value_proposal']"


# --- R12.9: an offline model result never promotes a benefit to proven ---

def _measured_effect_spec():
    spec = copy.deepcopy(CASES["cost_saving"]["spec"])
    spec["sourced"]["effect"]["source"] = "measured"
    return spec


@pytest.mark.parametrize("evidence", [
    None, [],
    [{"kind": "offline_model", "metric": "auc", "value": 0.97}, {"kind": "offline_model", "metric": "pr_auc_lift", "value": 4.1}],
    [{"kind": "backtest", "metric": "mase", "value": 0.4}],
    [{"kind": "realized_outcome", "metric": "auc", "value": 0.99}],
], ids=["none", "empty", "offline_auc", "unknown_kind", "auc_dressed_as_outcome"])
def test_17_an_offline_model_result_never_promotes_a_benefit_to_proven(ns, evidence):
    status = fn(ns, "inspire_value_benefit_status")(_measured_effect_spec(), copy.deepcopy(evidence))
    assert status in ("estimated", "exploratory") and status != "proven", (evidence, status)


def test_18_only_a_realized_outcome_on_a_measured_effect_is_proven(ns):
    status = fn(ns, "inspire_value_benefit_status")
    realized = [{"kind": "realized_outcome", "metric": "held_back_difference", "value": 0.03}]
    assert status(_measured_effect_spec(), realized) == "proven"
    owner = _measured_effect_spec()
    owner["sourced"]["effect"]["source"] = "owner"
    assert status(owner, realized) == "estimated", "the number used is the owner's, not the measured one"
    exploratory = _measured_effect_spec()
    exploratory["sourced"]["effect"]["source"] = "exploratory"
    assert status(exploratory, realized) == "exploratory"


# --- R12.1: the generated notebook prices its run with the same calculator and spec builder as the agent ---

SHARED = ("inspire_value_calculate", "inspire_value_spec_from_proposal", "inspire_value_formula_spec")


def test_19_a_generated_notebook_has_the_one_calculator_and_spec_builder_the_agent_uses(ns):
    from v207_app_reads_after_build_test import _inlined
    generated = {"__name__": "generated"}
    exec(compile(_inlined(ns), "<generated>", "exec"), generated)
    for name in SHARED:
        assert callable(generated.get(name)), f"R12.1: a generated notebook has no {name}, so inspire_merge_run never prices the run"
        assert ns[name].__code__.co_filename == "<inspire_result_history>", \
            f"R12.1: the agent's {name} is defined outside IMPLEMENT_RESULT_HISTORY_SOURCE, a second copy of the run-side one"
    spec, measured, entries = _revenue_inputs()
    built = generated["inspire_value_spec_from_proposal"](_revenue_proposal(), measured, entries, "USD", 3, copy.deepcopy(spec["cost"]))
    assert built == spec and generated["inspire_value_calculate"](built) == ns["inspire_value_calculate"](built)


def test_19b_static_each_shared_value_function_is_defined_exactly_once():
    counts = {}
    for node in ast.walk(_tree()):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in SHARED:
            counts[node.name] = counts.get(node.name, 0) + 1
    assert counts == {name: 1 for name in SHARED}, f"R12.1: one definition each, agent and run side: {counts}"


# --- R12.3: a capacity or non-financial mechanism is never shown as money ---

@pytest.mark.parametrize("mechanism,unit", [("capacity", "hours"), ("non_financial", "complaints")])
def test_20_a_capacity_or_non_financial_proposal_card_never_reads_as_money(ns, mechanism, unit):
    proposal = {"mechanism": mechanism, "flow_or_stock": "flow", "baseline_sql": "SELECT SUM(amount) FROM c.s.orders",
                "columns": {"exposure": "c.s.orders.amount"}, "unit": unit, "assumptions": [], "rationale": "work the team no longer does"}
    estimate = estimate_of(ns, money_uc(ns, kpi(ns, unit="USD"), **{"Value Proposal": proposal}), "", "predict")
    shown = " ".join(str(estimate.get(key) or "") for key in ("text", "measure", "assumption"))
    assert not estimate.get("value_proposal_problems"), estimate
    assert estimate.get("currency") is None and estimate.get("net") is None and estimate.get("cost") is None, \
        f"R12.3: a {mechanism} card carries no currency, net or cost: {estimate}"
    assert "USD" not in shown and "$" not in shown, f"R12.3: a {mechanism} card reads as money: {shown}"
    assert unit in shown, f"R12.3: a {mechanism} card states its change in {unit}: {shown}"
