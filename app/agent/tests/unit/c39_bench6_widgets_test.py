"""c39_bench6: the bench6 benchmark launches Discover with the notebook's real widgets and values. Before this fix the manifest used
"All Tables" (no classifier since REQ-580, so the bench did not measure Let Inspire Decides), quality "Balanced" (not a quality the
notebook accepts), business_context mapped to 06_business_domains (a domain list, not the strategic context text), and the base widgets
sent 09_generation_options, which the notebook no longer declares."""
import importlib.util
import json
import re
from pathlib import Path

TESTS = Path(__file__).resolve().parents[1]
MANIFEST = TESTS / "regression" / "bench6" / "manifest.json"
NOTEBOOK = TESTS.parent / "agent" / "dbx_inspire_ai_agent.ipynb"


def _module(name):
    spec = importlib.util.spec_from_file_location(name, TESTS / "scripts" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _declared_widgets():
    source = "".join("".join(cell.get("source", [])) for cell in json.load(open(NOTEBOOK))["cells"])
    return set(re.findall(r'dbutils\.widgets\.(?:text|dropdown|multiselect|combobox)\(\s*"(\d{2}_[a-z_]+)"', source))


def _launch_params(scope):
    run = _module("discover_ab_run")
    return {**run.BASE_WIDGETS, **run._scope_widgets(scope)}


def test_1_every_launch_widget_is_one_the_notebook_declares():
    declared = _declared_widgets()
    assert "04_table_election" in declared and "10_strategic_context" in declared
    for scope in json.load(open(MANIFEST))["scopes"]:
        unknown = set(_launch_params(scope)) - declared
        assert not unknown, (scope["id"], sorted(unknown))


def test_2_business_context_is_the_strategic_context_text():
    assert _module("discover_ab_run").ALIASES["business_context"] == "10_strategic_context"


def test_3_every_scope_runs_let_inspire_decides_with_a_valid_quality(agent_ns):
    valid_quality = set(agent_ns["USE_CASES_QUALITY_VALID"])
    for scope in json.load(open(MANIFEST))["scopes"]:
        params = _launch_params(scope)
        assert params["04_table_election"] == "Let Inspire Decides", scope["id"]
        assert params["05_use_cases_quality"] in valid_quality, (scope["id"], params["05_use_cases_quality"])
