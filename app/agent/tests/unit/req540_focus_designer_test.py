"""REQ-540 lane W-2: the agent designs a focus spec for each App page (G1 prompt, G2 validator gate, G3 variety, G4 judge, G5 fallback).

No live model call: `_implement_llm_object` is replaced by canned replies. Fixtures are neutral (entity, period, amount, score).
"""
import copy
import json
import os
import re
import sys

from v140_implement_test import _app_flow, _churn_page
from v197_genie_question_rows_test import _logged

HERE = os.path.dirname(os.path.abspath(__file__))
SHELL = os.path.join(HERE, "..", "..", "agent", "app_shell")
for folder in (os.path.join(SHELL, "server"), SHELL):
    if folder not in sys.path:
        sys.path.insert(0, folder)

import embed  # noqa: E402
import focus_spec  # noqa: E402

DEFAULTS = json.load(open(os.path.join(SHELL, "focus_defaults.json"), encoding="utf-8"))
KIND_OF = {"driver_breakdown": "Decomposition", "risk_propensity": "Classification", "forecast": "Forecasting"}
COLUMNS = {"entity": "string", "segment": "string", "region": "string", "period": "date", "amount": "number", "score": "number"}
SEQ_A = ["bridge", "ranked_bars", "strip"]
SEQ_B = ["histogram", "share_shift", "cohort_cards"]
SEQ_C = ["trend_band", "timeline", "strip"]


def _page(with_date=True):
    names = [n for n in COLUMNS if with_date or n != "period"]
    columns = [{"column": "amount", "label": "Amount", "format": "currency", "currency": "USD"},
               {"column": "score", "label": "Score", "format": "number"}]
    if with_date:
        columns.append({"column": "period", "label": "Period", "format": "month"})
    return {"id": "p1", "title": "Review entities", "question": "Which entity needs attention first?", "kpis": [],
            "datasets": [{"name": "records", "sql": f"SELECT {', '.join(names)} FROM t.s.x"}],
            "records": {"title": "Entities", "key": "entity", "label": "entity", "columns": columns}}


def _design(kind, blocks, questions=None, columns=COLUMNS, bad_column=None):
    spec = copy.deepcopy(DEFAULTS["defaults"]["driver_breakdown"])
    spec["technique_kind"] = kind
    used, steps = {}, []
    for i, block in enumerate(blocks):
        bind = {}
        for role, want in focus_spec.BLOCK_ROLES[block].items():
            pool = [n for n, t in columns.items() if t == want]
            bind[role] = pool[used.get(want, 0) % len(pool)]
            used[want] = used.get(want, 0) + 1
        if bad_column and i == 0:
            bind[next(iter(bind))] = bad_column
        last = i == len(blocks) - 1
        steps.append({"id": f"s{i + 1}", "question": (questions or [f"Question {kind} {i} here?"] * 9)[i],
                      "kind": "decide" if last else "show", "visual": {"block": block, "bind": bind},
                      "answer_template": "{record} shows {value} compared with {reference}.", "terms": [],
                      "motion": "reveal" if last else "build", "ask": ["Why is this one flagged?", "Which ones look the same?"]})
    spec["steps"] = steps
    spec["queue"]["order"]["column"] = "amount"
    spec["queue"]["cohort_column"] = "segment"
    return spec


def _judge(*scores):
    return {"steps": [{"id": f"s{i + 1}", "score": s, "reason": "R-unclear-step" if s < 4 else "clear"} for i, s in enumerate(scores)]}


GOOD = _judge(5, 5, 5)


def _flow(ns, tmp_path, designs, judges=(GOOD,), page=None):
    inst, context, seen = _app_flow(ns, tmp_path)
    payload = inst._implement_app_shell()[0]
    payload["files"].update({k: v for k, v in embed.payload(static=False)["files"].items() if k not in payload["files"]})
    asked = []

    def llm(prompt_name, display_name, prompt, schema, skip_cache=False):
        asked.append({"name": prompt_name, "prompt": prompt, "skip_cache": skip_cache})
        if prompt_name == "implement_app_tour":
            return {"tours": []}
        queue = [r for r in (designs if prompt_name == "implement_app_focus" else judges)]
        done = len([a for a in asked if a["name"] == prompt_name])
        reply = queue[min(done, len(queue)) - 1]
        if isinstance(reply, Exception):
            raise reply
        return reply

    inst._implement_llm_object = llm
    return inst, context, seen, asked, page or _page()


def _run(inst, context, page, uc_id, kind):
    context["uc_id"] = uc_id
    context["use_case"] = dict(context["use_case"], Name=f"Case {uc_id}", **{"Analytics Technique": KIND_OF[kind]})
    return inst._implement_app_focus(context, page)


def _calls(asked, name):
    return [a for a in asked if a["name"] == name]


def test_three_kinds_get_valid_specs_with_three_different_block_sequences(agent_ns, tmp_path):
    designs = [_design("driver_breakdown", SEQ_A), _design("risk_propensity", SEQ_B), _design("forecast", SEQ_C)]
    inst, context, _seen, asked, page = _flow(agent_ns, tmp_path, designs)
    sequences = []
    for uc, kind in (("U1", "driver_breakdown"), ("U2", "risk_propensity"), ("U3", "forecast")):
        out = _run(inst, context, page, uc, kind)
        assert focus_spec.validate(out["focus_spec"], COLUMNS)["ok"], uc
        assert out["focus_spec_source"] == "designed", uc
        sequences.append(tuple(s["visual"]["block"] for s in out["focus_spec"]["steps"]))
    assert len(set(sequences)) == 3
    assert len(_calls(asked, "implement_app_focus")) == 3


def test_the_prompt_holds_the_inputs_asks_questions_first_and_has_no_proper_noun(agent_ns, tmp_path):
    designs = [_design("driver_breakdown", SEQ_A), _design("risk_propensity", SEQ_B), _design("forecast", SEQ_C)]
    inst, context, _seen, asked, page = _flow(agent_ns, tmp_path, designs)
    for uc, kind in (("U1", "driver_breakdown"), ("U2", "risk_propensity"), ("U3", "forecast")):
        _run(inst, context, page, uc, kind)
    prompts = [a["prompt"] for a in _calls(asked, "implement_app_focus")]
    assert len(prompts) == 3
    for prompt, kind in zip(prompts, ("driver_breakdown", "risk_propensity", "forecast")):
        assert f"Technique kind: {kind}" in prompt
        assert all(f"`{name}`" in prompt for name in COLUMNS)
        assert all(f"`{b}`" in prompt for b in focus_spec.BLOCKS) and len(focus_spec.BLOCKS) == 14
        assert all(f"`{m}`" in prompt for m in focus_spec.MOTIONS) and len(focus_spec.MOTIONS) == 10
        example_kinds = re.findall(r"^Example kind: (\w+)$", prompt, flags=re.M)
        assert len(example_kinds) == 3 and len(set(example_kinds)) == 3 and kind not in example_kinds
        assert set(example_kinds) <= set(DEFAULTS["defaults"])
        assert prompt.index("QUESTIONS FIRST") < prompt.index("PICK A BLOCK AND A MOTION") < prompt.index("DECIDE LAST")
        assert "explicit input wins" in prompt
        fixed = prompt
        for name in sorted([*COLUMNS, *focus_spec.BLOCKS, *focus_spec.MOTIONS, *DEFAULTS["defaults"]], key=len, reverse=True):
            fixed = fixed.replace(name, "")
        skipped = ("Example spec:", "Name:", "Statement:", "Solution:", "Business value:", "Title:", "Question it answers:", "Each record is:")
        proper = []
        for line in fixed.splitlines():
            if not line.startswith(skipped):
                proper += re.findall(r"\b[A-Z][a-z]+\b", re.sub(r"(^|[.:?!] )[A-Z][a-z]*", "", line.lstrip("-0123456789. ")))
        assert proper == [], proper


def test_a_reply_binding_a_missing_column_is_rejected_then_the_redesign_is_used(agent_ns, tmp_path):
    bad = _design("driver_breakdown", SEQ_A, bad_column="missing_col")
    good = _design("driver_breakdown", SEQ_B)
    inst, context, _seen, asked, page = _flow(agent_ns, tmp_path, [bad, good])
    out = _run(inst, context, page, "U1", "driver_breakdown")
    design_calls = _calls(asked, "implement_app_focus")
    assert len(design_calls) == 2 and design_calls[1]["skip_cache"] is True and "missing_col" in design_calls[1]["prompt"]
    assert out["focus_spec"] == good and out["focus_spec_source"] == "redesigned"


def test_a_judge_step_below_four_triggers_one_redesign_then_the_default_with_the_reason_logged(agent_ns, tmp_path):
    inst, context, _seen, asked, page = _flow(agent_ns, tmp_path, [_design("driver_breakdown", SEQ_A), _design("driver_breakdown", SEQ_B)],
                                              judges=[_judge(5, 3, 5), _judge(5, 3, 5)])
    out = _run(inst, context, page, "U1", "driver_breakdown")
    design_calls = _calls(asked, "implement_app_focus")
    assert len(design_calls) == 2 and "R-unclear-step" in design_calls[1]["prompt"] and len(_calls(asked, "implement_app_focus_judge")) == 2
    expected = copy.deepcopy(DEFAULTS["defaults"]["driver_breakdown"])
    for step in expected["steps"]:
        step["visual"]["bind"] = {"label": "entity", "value": "amount"}
    expected["queue"]["order"]["column"] = "amount"
    expected["queue"]["cohort_column"] = "segment"
    assert out["focus_spec_source"] == "default" and out["focus_spec"] == expected
    assert "R-unclear-step" in out["focus_spec_reason"]
    lines = _logged(inst, "WARNING", "[IMPLEMENT-APP-FOCUS] U1:")
    assert any("falls back to the default for driver_breakdown" in m and "R-unclear-step" in m for m in lines), lines


def test_a_judge_pass_after_the_redesign_keeps_the_redesign(agent_ns, tmp_path):
    inst, context, _seen, asked, page = _flow(agent_ns, tmp_path, [_design("driver_breakdown", SEQ_A), _design("driver_breakdown", SEQ_B)],
                                              judges=[_judge(5, 3, 5), GOOD])
    out = _run(inst, context, page, "U1", "driver_breakdown")
    assert out["focus_spec_source"] == "redesigned" and len(_calls(asked, "implement_app_focus")) == 2


def test_two_kinds_with_one_block_sequence_trigger_one_redesign_naming_the_clash(agent_ns, tmp_path):
    designs = [_design("driver_breakdown", SEQ_A), _design("risk_propensity", SEQ_A), _design("risk_propensity", SEQ_B)]
    inst, context, _seen, asked, page = _flow(agent_ns, tmp_path, designs)
    first = _run(inst, context, page, "U1", "driver_breakdown")
    second = _run(inst, context, page, "U2", "risk_propensity")
    design_calls = _calls(asked, "implement_app_focus")
    assert len(design_calls) == 3 and first["focus_spec_source"] == "designed" and second["focus_spec_source"] == "redesigned"
    assert "clash" in design_calls[2]["prompt"] and "U1" in design_calls[2]["prompt"] and ", ".join(SEQ_A) in design_calls[2]["prompt"]


def test_the_same_kind_may_repeat_a_sequence_only_with_other_question_wording(agent_ns, tmp_path):
    first = _design("driver_breakdown", SEQ_A, ["What moved it?", "Which part matters?", "What will you do?"])
    other = _design("driver_breakdown", SEQ_A, ["What changed here?", "Which piece is biggest?", "What is your call?"])
    inst, context, _seen, asked, page = _flow(agent_ns, tmp_path, [first, other])
    _run(inst, context, page, "U1", "driver_breakdown")
    out = _run(inst, context, page, "U2", "driver_breakdown")
    assert out["focus_spec_source"] == "designed" and len(_calls(asked, "implement_app_focus")) == 2
    inst2, context2, _seen2, asked2, page2 = _flow(agent_ns, tmp_path / "again", [first, first, other])
    _run(inst2, context2, page2, "U1", "driver_breakdown")
    out2 = _run(inst2, context2, page2, "U2", "driver_breakdown")
    assert out2["focus_spec_source"] == "redesigned" and len(_calls(asked2, "implement_app_focus")) == 3


def test_a_default_that_cannot_bind_gives_no_focus_spec_and_no_exception(agent_ns, tmp_path):
    no_date = {n: t for n, t in COLUMNS.items() if n != "period"}
    bad = _design("forecast", SEQ_C)
    inst, context, _seen, asked, page = _flow(agent_ns, tmp_path, [bad, bad], page=_page(with_date=False))
    out = _run(inst, context, page, "U1", "forecast")
    assert "focus_spec" not in out and out["focus_spec_source"] == "none" and out["focus_spec_reason"]
    assert len(_calls(asked, "implement_app_focus")) == 2
    assert _logged(inst, "WARNING", "[IMPLEMENT-APP-FOCUS] U1:")
    assert focus_spec.validate(_design("driver_breakdown", SEQ_A, columns=no_date), no_date)["ok"]


def test_the_page_json_the_app_bundle_writes_holds_the_focus_spec(agent_ns, tmp_path):
    page = _churn_page(agent_ns)
    columns = {c["name"]: c["type"] for c in agent_ns["implement_focus_columns"](page)}
    design = _design("risk_propensity", SEQ_A, columns=columns)
    design["queue"]["order"]["column"] = next(n for n, t in columns.items() if t == "number")
    design["queue"]["cohort_column"] = next(n for n, t in columns.items() if t == "string")
    inst2, context2, seen2, asked2, _p = _flow(agent_ns, tmp_path / "bundle", [design], judges=[GOOD])
    inst2._implement_app_check = lambda *a, **k: []
    context2["use_case"] = dict(context2["use_case"], **{"Analytics Technique": "Classification"})
    inst2._implement_app(context2, None)
    written = json.loads(seen2["deployed"][0][1]["pages/n01_u01.json"])
    assert written["focus_spec"] == design and written["focus_spec_source"] == "designed", written.get("focus_spec_reason")
    assert context2["artifacts"]["app"]["focus_spec"] == design
