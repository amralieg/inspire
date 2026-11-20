"""REQ-422: the notebook copy of the databricks-<model> -> system.ai.<model> rule matches the shared cases file that the App
backend and the installer are also checked against (app/backend/test/support/modelServiceCases.json)."""
import json
import os

from _nbload import ROOT

CASES = json.load(open(os.path.join(ROOT, "..", "backend", "test", "support", "modelServiceCases.json"), encoding="utf-8"))["cases"]


def test_the_notebook_maps_every_shared_case_to_the_same_model_service(agent_ns):
    for case in CASES:
        assert agent_ns["system_model_service_name"](case["endpoint"]) == case["service"], case
