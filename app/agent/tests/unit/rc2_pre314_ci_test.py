"""CI must provision the interpreter required by the fail-closed Serverless guard."""
from pathlib import Path

import yaml


def test_python_shards_provision_the_pre314_runtime_before_the_primary_runtime():
    workflow = Path(__file__).resolve().parents[4] / ".github" / "workflows" / "ci.yml"
    job = yaml.safe_load(workflow.read_text())["jobs"]["python-unit"]
    steps = job["steps"]
    compatible = [step for step in steps if step.get("uses") == "actions/setup-python@v5"
                  and str(step.get("with", {}).get("python-version")) == "3.13"]
    assert len(compatible) == 1, "the fail-closed Turn guard needs an explicitly installed Python 3.13"
    compat = compatible[0]
    primary = next(step for step in steps if step.get("uses") == "actions/setup-python@v5"
                   and step.get("with", {}).get("python-version") == "${{ env.PYTHON_VERSION }}")
    assert steps.index(compat) < steps.index(primary), "the main tests must still run on the primary interpreter"
    shard = next(step for step in steps if step.get("name") == "run shard")
    expected = "${{ steps." + compat["id"] + ".outputs.python-path }}"
    assert shard["env"]["INSPIRE_PRE_314_PYTHON"] == expected
