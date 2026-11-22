"""REQ-471, REQ-456: a gateway-only workspace gets model access, and a refused-grant stop names every GRANT."""
import contextlib
import io
import json
import pathlib
import types
import unittest
from unittest import mock

import support

setup = support.load_setup()
NOTEBOOK = pathlib.Path(support.INSTALLER_DIR).parent / "agent" / "agent" / "dbx_inspire_ai_agent.ipynb"
SP = "11111111-2222-3333-4444-555555555555"
READ = "GRANT USE CATALOG, USE SCHEMA, SELECT, BROWSE, READ METADATA ON CATALOG `{0}` TO `SP`"


def resp(status=200, payload=None):
    return types.SimpleNamespace(status_code=status, text=json.dumps(payload or {}), json=lambda: payload or {})


def gateway(models, grant_status=200):
    calls = []

    def api(method, path, body=None, timeout=None):
        calls.append((method, path, body))
        if method == "GET" and path == "/ai-gateway/anthropic/v1/models":
            return resp(200, {"data": [{"id": m} for m in models]})
        if method == "GET":
            return resp(200, {"models": []})
        return resp(grant_status)
    return api, calls


NO_ENDPOINTS = types.SimpleNamespace(serving_endpoints=types.SimpleNamespace(list=lambda: iter([])))


class GatewayModelGrantTest(unittest.TestCase):
    def setUp(self):
        self.notebook = NOTEBOOK.read_text(encoding="utf-8")

    def run_grant(self, models, grant_status=200):
        api, calls = gateway(models, grant_status)
        lines = setup.grant_model_access(api, NO_ENDPOINTS, SP, self.notebook, gateway_get=api)
        return lines, [c for c in calls if c[0] == "PATCH"]

    def test_a_gateway_only_workspace_grants_execute_and_the_usage_grants_to_the_app(self):
        lines, patches = self.run_grant(["system.ai.claude-sonnet-5-5"])
        self.assertNotIn("no chat model endpoint is listed", " ".join(lines))
        self.assertIn(("PATCH", "/api/2.1/unity-catalog/permissions/model_service/system.ai.claude-sonnet-5-5",
                       {"changes": [{"principal": SP, "add": ["EXECUTE"]}]}), patches)
        self.assertEqual(len(patches), 3, "EXECUTE, USE CATALOG system, USE SCHEMA system.ai")

    def test_a_refused_gateway_grant_names_the_exact_grant_statements(self):
        lines, _patches = self.run_grant(["system.ai.claude-sonnet-5-5"], grant_status=403)
        text = " ".join(lines)
        self.assertIn(f"GRANT EXECUTE ON MODEL system.ai.claude-sonnet-5-5 TO `{SP}`", text)
        self.assertIn(f"GRANT USE CATALOG ON CATALOG system TO `{SP}`", text)
        self.assertIn(f"GRANT USE SCHEMA ON SCHEMA system.ai TO `{SP}`", text)

    def test_both_lists_empty_keeps_the_old_line(self):
        lines, patches = self.run_grant([])
        self.assertEqual(patches, [])
        self.assertTrue(lines[0].startswith("⚠️ not granted: no chat model endpoint is listed"), lines)


class EveryGrantNamedTest(unittest.TestCase):
    def test_eight_refused_catalogs_stop_with_all_eight_grants(self):
        cats = [f"c{i}" for i in range(8)]
        ctx = {"w": object(), "WAREHOUSE_ID": "wh", "CATALOG": "ops", "DATA_CATALOGS": cats, "PREVIOUS_GRANTED_CATALOGS": []}

        def run_statement(_w, _wh, sql):
            raise RuntimeError("PERMISSION_DENIED: not the owner")
        with mock.patch.object(setup, "_run_statement", run_statement), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(RuntimeError) as caught:
                setup._grant_data_catalogs(ctx, "SP")
        message = str(caught.exception)
        for name in cats:
            self.assertIn(READ.format(name), message)
        self.assertNotIn("more", message.replace("before it deploys", ""))

    def test_eight_refused_account_grants_stop_with_all_eight_statements(self):
        failed = {f"GRANT USE CATALOG ON CATALOG `c{i}` TO `account users`": "denied" for i in range(8)}
        with self.assertRaises(RuntimeError) as caught:
            setup._stop_on_refused_account_grants(failed, {})
        message = str(caught.exception)
        for sql in failed:
            self.assertIn(sql, message)
        self.assertNotIn("more", message)
