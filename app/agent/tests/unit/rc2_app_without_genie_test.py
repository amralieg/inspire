"""rc.2 (REQ-152): the App's own agent answers Ask, so an App is built without a Genie Agent. The notebook validates the spec
and builds no Genie Agent stage when it is unticked."""
import json

from v140_implement_test import VALID


def _spec(agent_ns, outputs):
    spec = json.loads(json.dumps(VALID))
    spec["outputs"] = {**spec["outputs"], **outputs}
    return agent_ns["validate_implement_spec"](spec)


def test_an_app_without_a_genie_agent_validates_and_builds_no_genie_space(agent_ns):
    out, errors = _spec(agent_ns, {"app": True, "genie_space": False})
    assert errors == [], errors
    assert out["outputs"]["app"] is True
    assert out["outputs"]["genie_space"] is False, "the App no longer forces a Genie Agent on"
    assert out["outputs"]["genie_questions"] == [] and out["outputs"]["genie_space_name"] == ""


def test_the_genie_space_stage_is_planned_only_when_the_genie_agent_is_ticked(agent_ns):
    out, _ = _spec(agent_ns, {"app": True, "genie_space": False})
    plan = agent_ns["implement_plan"]({}, out)
    assert "genie_space" not in plan["build"], plan["build"]
    assert "app" in plan["build"], plan["build"]
    both, _ = _spec(agent_ns, {"app": True, "genie_space": True})
    assert "genie_space" in agent_ns["implement_plan"]({}, both)["build"]
