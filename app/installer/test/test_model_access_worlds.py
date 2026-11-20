"""REQ-423 consumer (the installer's model plan) and REQ-424 gate, run against every setup in
app/backend/test/support/modelAccessWorlds.json. The fixture is the one expected outcome the notebook and the App also check."""
import json
import pathlib
import types
import unittest

import support

setup = support.load_setup()
ROOT = pathlib.Path(support.INSTALLER_DIR).parent
NOTEBOOK = ROOT / "agent" / "agent" / "dbx_inspire_ai_agent.ipynb"
FIXTURE = json.loads((ROOT / "backend" / "test" / "support" / "modelAccessWorlds.json").read_text(encoding="utf-8"))
SP = "11111111-2222-3333-4444-555555555555"
STATUS = {"answer": 200, "enforced": 403, "denied": 403, "ratelimit": 429, "missing": 404}


def resp(status, data=None):
    return types.SimpleNamespace(status_code=status, text=json.dumps(data or {}))


def call_for(world):
    """The REST answers one world gives. Every refusal text comes from the fixture."""
    def outcome_for(name):
        kind = world["outcomes"].get(name, "missing")
        if kind == "answer":
            return 200, {"choices": [{"message": {"content": "OK"}}]}
        return STATUS[kind], {"message": FIXTURE["texts"][kind].replace("{name}", name)}

    def call(method, path, body=None):
        if method == "GET" and path == "/api/2.0/serving-endpoints":
            if world["listing"] != "answer":
                return STATUS[world["listing"]], {"message": FIXTURE["texts"][world["listing"]].replace("{name}", "the serving endpoints")}
            return 200, {"endpoints": world["endpoints"]}
        if method == "GET" and path == "/ai-gateway/codex/v1/models":
            if world["gateway"] != "answer":
                return STATUS[world["gateway"]], {"message": FIXTURE["texts"][world["gateway"]].replace("{name}", "the gateway")}
            return 200, {"models": [{"slug": s} for s in world["gateway_models"]]}
        if method == "POST" and path == "/ai-gateway/mlflow/v1/chat/completions":
            return outcome_for(body["model"])
        if method == "POST" and path.startswith("/serving-endpoints/") and path.endswith("/invocations"):
            return outcome_for(path[len("/serving-endpoints/"):-len("/invocations")])
        raise AssertionError(f"unexpected call {method} {path}")
    return call


def steps_for(world):
    return [step.replace("<principal>", SP) for step in world["expected"]["steps"]]


class ModelPlanConsumerTest(unittest.TestCase):
    def test_every_setup_gives_the_blocked_state_callable_and_setup_label_the_fixture_expects(self):
        notebook = NOTEBOOK.read_text(encoding="utf-8")
        for world in FIXTURE["worlds"]:
            with self.subTest(world=world["id"]):
                plan = setup.model_access_plan(call_for(world), notebook, SP)
                self.assertEqual(plan["blocked"], world["expected"]["blocked"], plan)
                self.assertEqual(plan["callable"], world["expected"]["callable"], plan)
                self.assertEqual(plan["setup"], world["setup"], plan)
                self.assertEqual(plan["steps"], steps_for(world), plan)


class ModelGateTest(unittest.TestCase):
    """REQ-424: with a service-principal call, the gate stops the install only where no chat model answers and the run is blocked."""

    def gate_ctx(self, world):
        return {"APP_SP_CALL": call_for(world)}

    def test_the_gate_stops_before_the_app_is_replaced_exactly_where_the_fixture_says_the_run_is_blocked(self):
        notebook = NOTEBOOK.read_text(encoding="utf-8")
        for world in FIXTURE["worlds"]:
            with self.subTest(world=world["id"]):
                if world["expected"]["blocked"]:
                    with self.assertRaises(RuntimeError) as caught:
                        setup.model_access_gate(self.gate_ctx(world), SP, notebook)
                    message = str(caught.exception)
                    self.assertIn(f"setup {world['setup']}", message)
                    self.assertIn("The install stopped before the App was replaced", message)
                    for step in steps_for(world):
                        self.assertIn(step, message, "every admin step the fixture expects is printed")
                else:
                    lines = setup.model_access_gate(self.gate_ctx(world), SP, notebook)
                    if world["setup"] == "rate limit":
                        self.assertIn("The install continues", lines[0])
                    else:
                        self.assertIn(f"setup {world['setup']}; the run calls {world['expected']['callable']}", lines[0], lines)

    def test_without_a_service_principal_credential_the_gate_falls_back_to_permissions_and_never_stops(self):
        notebook = NOTEBOOK.read_text(encoding="utf-8")
        for world in FIXTURE["worlds"]:
            with self.subTest(world=world["id"]):
                api = lambda method, path, body=None: resp(403)
                listed = [types.SimpleNamespace(name=e["name"], id=e["id"], task=e["task"]) for e in world["endpoints"]]
                ctx = {"api": api, "w": types.SimpleNamespace(serving_endpoints=types.SimpleNamespace(list=lambda: listed))}
                lines = setup.model_access_gate(ctx, SP, notebook)
                self.assertTrue(lines[0].startswith("Live model check not possible: the installer holds no credential"), lines)
                self.assertTrue(any("USE_CATALOG" in line for line in lines), lines)

    def test_with_no_app_service_principal_yet_the_check_says_it_runs_once_the_app_exists(self):
        lines = setup.model_access_gate({"api": None}, None, NOTEBOOK.read_text(encoding="utf-8"))
        self.assertIn("The check runs once the App exists.", lines[0])


class StopBeforeAppReplacedTest(unittest.TestCase):
    """REQ-424: the install step stops before it creates or replaces the App, for every setup the fixture says blocks the run."""

    def test_the_create_step_raises_before_any_app_create_call_for_each_blocked_setup(self):
        notebook = NOTEBOOK.read_text(encoding="utf-8")
        for world in FIXTURE["worlds"]:
            if not world["expected"]["blocked"]:
                continue
            with self.subTest(world=world["id"]):
                calls = []

                def api(method, path, body=None):
                    calls.append((method, path))
                    return resp(200, {})

                def api_get(path):
                    return {"apps": []} if path.startswith("/api/2.0/apps") else {}

                ctx = {"api": api, "api_get": api_get, "SOURCE_FOLDER": "/Workspace/x", "INSPIRE_DB": "main._inspire",
                       "WAREHOUSE_ID": "wh", "NOTEBOOK_PATH": "/Shared/x", "SP_NAME": "sp", "APP_NAME": "inspire-ai", "CATALOG": "main",
                       "AGENT_NOTEBOOK_TEXT": notebook, "APP_SP_CALL": call_for(world)}
                with self.assertRaises(RuntimeError) as caught:
                    setup.step_create_app_and_find_sp(ctx)
                self.assertIn("The install stopped before the App was replaced", str(caught.exception))
                self.assertFalse(any(method == "POST" and path == "/api/2.0/apps" for method, path in calls), calls)
