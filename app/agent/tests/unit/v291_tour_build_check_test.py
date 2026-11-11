import copy
import json
import os

from v140_implement_test import _churn_page
from v197_genie_question_rows_test import _logged
from v230_app_tour_build_test import STEPS, _core, _deployed, _tour_flow

GENERIC = "Pick a date range or a group to narrow the page."


def _complete(core, page, steps, language="English"):
    covered = {s["anchor"] for s in steps}
    return steps + [core.tour_template(a, language, page) for a in core.tour_anchors(page) if a not in covered]


def _with(steps, anchor, text):
    return [dict(s, text=text) if s["anchor"] == anchor else s for s in steps]


def test_a_complete_tour_that_names_the_use_case_passes_the_build_check(agent_ns, tmp_path):
    inst, _context, _seen, _asked = _tour_flow(agent_ns, tmp_path, [{"tours": []}], page=_churn_page(agent_ns))
    core, page = _core(inst), _churn_page(agent_ns)
    tour = {"languages": ["English"], "steps": {"English": _complete(core, page, STEPS)}}
    assert core.tour_build_problems(page, tour) == []


def test_a_generic_step_is_rejected_at_build_and_named_by_its_part(agent_ns, tmp_path):
    inst, _context, _seen, _asked = _tour_flow(agent_ns, tmp_path, [{"tours": []}], page=_churn_page(agent_ns))
    core, page = _core(inst), _churn_page(agent_ns)
    steps = _with(_complete(core, page, STEPS), "kpis", GENERIC)
    problems = core.tour_build_problems(page, {"steps": {"English": steps}})
    assert problems == ["English kpis: the text is generic ('pick a date range or a group') and names nothing of this use case"]


def test_a_tour_that_leaves_a_part_without_a_step_is_rejected_at_build(agent_ns, tmp_path):
    inst, _context, _seen, _asked = _tour_flow(agent_ns, tmp_path, [{"tours": []}], page=_churn_page(agent_ns))
    core, page = _core(inst), _churn_page(agent_ns)
    assert "kpis" in core.tour_anchors(page)
    steps = [s for s in _complete(core, page, STEPS) if s["anchor"] != "kpis"]
    problems = core.tour_build_problems(page, {"steps": {"English": steps}})
    assert problems == ["English: the part kpis has no step"]


def test_an_optional_alerts_part_never_blocks_a_tour(agent_ns, tmp_path):
    inst, _context, _seen, _asked = _tour_flow(agent_ns, tmp_path, [{"tours": []}], page=_churn_page(agent_ns))
    core, page = _core(inst), _churn_page(agent_ns)
    steps = [s for s in _complete(core, page, STEPS) if s["anchor"] != "alerts"]
    assert core.tour_build_problems(page, {"steps": {"English": steps}}) == []


def test_a_generic_first_answer_is_asked_again_and_the_shipped_tour_is_the_second_answer(agent_ns, tmp_path):
    holder = []
    generic = lambda prompt: {"tours": [{"language": "English", "steps": _with(_complete(_core(holder[0]), _churn_page(agent_ns), STEPS), "kpis", GENERIC)}]}
    good = lambda prompt: {"tours": [{"language": "English", "steps": _complete(_core(holder[0]), _churn_page(agent_ns), STEPS)}]}
    inst, context, seen, asked = _tour_flow(agent_ns, tmp_path, [generic, good], page=_churn_page(agent_ns))
    holder.append(inst)
    inst._implement_app(context, None)
    assert seen["errors"] == [] and [a["skip_cache"] for a in asked if a["name"] == "implement_app_tour"] == [False, True]
    shipped = _deployed(seen)["tour"]["steps"]["English"]
    assert next(s for s in shipped if s["anchor"] == "kpis")["text"] == STEPS[1]["text"]
    assert _logged(inst, "WARNING", "[IMPLEMENT-APP-TOUR-RETRY FIRED] N01-U01") and any("not fit to ship" in m for m in _logged(inst, "WARNING", "[IMPLEMENT-APP-TOUR-RETRY FIRED]"))


def test_a_tour_generic_twice_falls_back_to_the_template_steps(agent_ns, tmp_path):
    holder = []
    generic = lambda prompt: {"tours": [{"language": "English", "steps": _with(_complete(_core(holder[0]), _churn_page(agent_ns), STEPS), "kpis", GENERIC)}]}
    inst, context, seen, asked = _tour_flow(agent_ns, tmp_path, [generic, generic], page=_churn_page(agent_ns))
    holder.append(inst)
    inst._implement_app(context, None)
    shipped = _deployed(seen)["tour"]["steps"]["English"]
    kpis = next(s for s in shipped if s["anchor"] == "kpis")
    assert kpis == _core(inst).tour_template("kpis", "English", _deployed(seen))
    assert GENERIC not in json.dumps(shipped)
    assert _logged(inst, "WARNING", "[IMPLEMENT-APP-TOUR] N01-U01: the App tour was not written, so the App shows the template tour")


def test_an_actions_step_that_does_not_name_the_side_panel_and_the_choices_is_rejected_at_build(agent_ns, tmp_path):
    inst, _context, _seen, _asked = _tour_flow(agent_ns, tmp_path, [{"tours": []}], page=_churn_page(agent_ns))
    core, page = _core(inst), _churn_page(agent_ns)
    steps = _with(_complete(core, page, STEPS), "actions", "Open a customer and log what you did.")
    problems = core.tour_build_problems(page, {"steps": {"English": steps}})
    assert problems == ["English actions: the text does not name side panel, choice"]


EXAMPLES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "agent", "app_shell", "examples")


def test_the_template_fallback_steps_pass_the_generic_and_coverage_check_on_every_example_layout(agent_ns, tmp_path):
    inst, _context, _seen, _asked = _tour_flow(agent_ns, tmp_path, [{"tours": []}], page=_churn_page(agent_ns))
    core = _core(inst)
    names = sorted(n for n in os.listdir(EXAMPLES) if n.endswith(".json"))
    assert len(names) >= 5
    for name in names:
        with open(os.path.join(EXAMPLES, name), encoding="utf-8") as handle:
            page = json.load(handle)
        problems = core.tour_build_problems(page, {"steps": {"English": _complete(core, page, [])}})
        assert problems == [], f"{name}: {problems}"
