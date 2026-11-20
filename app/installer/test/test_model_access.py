"""REQ-405: the installer grants the App's service principal CAN_QUERY on the chat model the agent would pick."""
import pathlib
import types
import unittest

import support

setup = support.load_setup()
NOTEBOOK = pathlib.Path(support.INSTALLER_DIR).parent / "agent" / "agent" / "dbx_inspire_ai_agent.ipynb"
SP = "11111111-2222-3333-4444-555555555555"


def endpoint(name, eid, task="llm/v1/chat"):
    return types.SimpleNamespace(name=name, id=eid, task=task, state=None, config=None)


def resp(status=200, text=""):
    return types.SimpleNamespace(status_code=status, text=text)


def workspace(endpoints=None, listing_error=None):
    def listed():
        if listing_error:
            raise listing_error
        return iter(endpoints or [])
    return types.SimpleNamespace(serving_endpoints=types.SimpleNamespace(list=listed))


def recording(status=200):
    calls = []

    def api(method, path, body=None):
        calls.append((method, path, body))
        return resp(status)
    return api, calls


class ModelAccessTest(unittest.TestCase):
    def setUp(self):
        self.notebook = NOTEBOOK.read_text(encoding="utf-8")
        self.endpoints = [
            endpoint("databricks-claude-sonnet-4-5", "id-sonnet-45"),
            endpoint("databricks-claude-sonnet-4-6", "id-sonnet-46"),
            endpoint("databricks-gpt-oss-120b", "id-gpt-120"),
            endpoint("databricks-bge-large-en", "id-embed", task="llm/v1/embeddings"),
            endpoint("my-custom-model", "id-custom", task="llm/v1/chat"),
        ]

    def test_every_chat_model_of_each_family_is_granted_newest_first_and_nothing_else(self):
        api, calls = recording()
        lines = setup.grant_model_access(api, workspace(self.endpoints), SP, self.notebook)
        granted = [path for _method, path, _body in calls]
        self.assertEqual(granted, ["/api/2.0/permissions/serving-endpoints/id-sonnet-46", "/api/2.0/permissions/serving-endpoints/id-sonnet-45",
                                   "/api/2.0/permissions/serving-endpoints/id-gpt-120"],
                         "both Claude Sonnet versions (newest first) and the GPT OSS 120b endpoint, and no embeddings or custom endpoint")
        for _method, _path, body in calls:
            self.assertEqual(body, {"access_control_list": [{"service_principal_name": SP, "permission_level": "CAN_QUERY"}]})
        self.assertTrue(any("CAN_QUERY for the App's service principal" in line for line in lines))

    def test_an_endpoint_the_installer_cannot_manage_is_logged_and_the_install_goes_on(self):
        api, calls = recording(status=403)
        lines = setup.grant_model_access(api, workspace(self.endpoints), SP, self.notebook)
        self.assertEqual(len(calls), 3, "every pick is still attempted")
        self.assertTrue(any("CAN_QUERY not granted (403" in line and "Permission Required" in line for line in lines), lines)

    def test_a_family_with_one_member_is_granted_and_an_endpoint_outside_the_families_is_not(self):
        api, calls = recording()
        only = [endpoint("databricks-claude-haiku-4-5", "id-haiku"), endpoint("unrelated-serving", "id-other")]
        setup.grant_model_access(api, workspace(only), SP, self.notebook)
        self.assertEqual([path for _m, path, _b in calls], ["/api/2.0/permissions/serving-endpoints/id-haiku"])

    def test_a_failed_listing_is_logged_not_raised(self):
        api, calls = recording()
        lines = setup.grant_model_access(api, workspace(listing_error=RuntimeError("PERMISSION_DENIED")), SP, self.notebook)
        self.assertEqual(calls, [], "nothing is granted when the endpoints cannot be listed")
        self.assertTrue(lines and lines[0].startswith("⚠️ not granted: the installer could not list"), lines)

    def test_a_workspace_with_no_chat_model_says_so_and_grants_nothing(self):
        api, calls = recording()
        lines = setup.grant_model_access(api, workspace([endpoint("databricks-bge-large-en", "id-embed", task="llm/v1/embeddings")]), SP,
                                         self.notebook)
        self.assertEqual(calls, [])
        self.assertTrue(lines[0].startswith("⚠️ not granted: no chat model endpoint is listed"), lines)

    def test_a_foundation_endpoint_with_no_id_is_granted_execute_on_its_system_model_service(self):
        # Live shape (2026-11-19, one workspace): databricks-* pay-per-token endpoints have id None; the access object is system.ai.<model>.
        api, calls = recording()
        only = [endpoint("databricks-claude-sonnet-4-6", None)]
        lines = setup.grant_model_access(api, workspace(only), SP, self.notebook)
        self.assertEqual(calls, [
            ("PATCH", "/api/2.1/unity-catalog/permissions/model_service/system.ai.claude-sonnet-4-6",
             {"changes": [{"principal": SP, "add": ["EXECUTE"]}]}),
            ("PATCH", "/api/2.1/unity-catalog/permissions/catalog/system", {"changes": [{"principal": SP, "add": ["USE_CATALOG"]}]}),
            ("PATCH", "/api/2.1/unity-catalog/permissions/schema/system.ai", {"changes": [{"principal": SP, "add": ["USE_SCHEMA"]}]}),
        ])
        self.assertTrue(any("EXECUTE on system.ai.claude-sonnet-4-6 for the App's service principal" in line for line in lines), lines)
        self.assertFalse(any("has no id" in line for line in lines), "no endpoint is reported as ungrantable when a system model service exists")

    def test_a_refused_system_model_grant_names_the_exact_admin_command_and_the_summary_says_so(self):
        api, calls = recording(status=403)
        only = [endpoint("databricks-claude-sonnet-4-6", None)]
        lines = setup.grant_model_access(api, workspace(only), SP, self.notebook)
        command = ("databricks grants update model_service system.ai.claude-sonnet-4-6 --json "
                   f"'{{\"changes\": [{{\"principal\": \"{SP}\", \"add\": [\"EXECUTE\"]}}]}}'")
        self.assertTrue(any("not granted (403" in line and command in line for line in lines), lines)
        self.assertTrue(lines[-1].startswith("⚠️ admin action:") and "Permission Required" in lines[-1], lines)

    def test_a_no_id_endpoint_with_no_known_system_model_is_logged_as_having_no_grant_path(self):
        api, calls = recording()
        odd = [endpoint("claude-sonnet-4-6", None)]
        lines = setup.grant_model_access(api, workspace(odd), SP, self.notebook)
        self.assertEqual(calls, [], "nothing is sent for an endpoint with no model service name")
        self.assertTrue(any("not granted (the endpoint has no id and no system model service" in line for line in lines), lines)

    def test_the_family_matching_is_the_notebook_own_and_a_missing_definition_is_named(self):
        matching = setup.agent_model_matching(self.notebook)
        self.assertEqual(setup.model_endpoints_to_grant(self.endpoints, matching),
                         ["databricks-claude-sonnet-4-6", "databricks-claude-sonnet-4-5", "databricks-gpt-oss-120b"])
        broken = self.notebook.replace("def _family_endpoints(", "def _renamed_family_endpoints(")
        lines = setup.grant_model_access(recording()[0], workspace(self.endpoints), SP, broken)
        self.assertTrue(lines[0].startswith("⚠️ not granted: the bundled agent notebook does not say which models"), lines)


if __name__ == "__main__":
    unittest.main()


class UsageGrantTest(unittest.TestCase):
    """REQ-422: a model service is queried by EXECUTE on it plus USE CATALOG on system and USE SCHEMA on system.ai (docs:
    Unity Gateway migration docs, AWS). The installer grants both usage privileges with the
    EXECUTE grant, or prints the exact GRANT SQL as an admin step when the usage grant is refused."""

    def setUp(self):
        self.notebook = NOTEBOOK.read_text(encoding="utf-8")

    @staticmethod
    def by_path(status_by_path):
        calls = []

        def api(method, path, body=None):
            calls.append((method, path, body))
            return resp(status_by_path.get(path, 200))
        return api, calls

    def test_a_granted_system_model_also_gets_usage_on_system_and_system_ai(self):
        # Fail-pre: only the EXECUTE grant was sent, so the usage privileges were never granted.
        api, calls = recording()
        lines = setup.grant_model_access(api, workspace([endpoint("databricks-claude-sonnet-4-6", None)]), SP, self.notebook)
        paths = [path for _, path, _ in calls]
        self.assertIn("/api/2.1/unity-catalog/permissions/catalog/system", paths)
        self.assertIn("/api/2.1/unity-catalog/permissions/schema/system.ai", paths)
        self.assertIn(("PATCH", "/api/2.1/unity-catalog/permissions/schema/system.ai",
                       {"changes": [{"principal": SP, "add": ["USE_SCHEMA"]}]}), calls)
        self.assertTrue(any("USE CATALOG on system and USE SCHEMA on system.ai" in line for line in lines), lines)

    def test_a_refused_usage_grant_prints_the_exact_grant_sql_as_a_permission_required_admin_step(self):
        # Fail-pre: a refused usage grant printed nothing and the admin had no SQL to run.
        api, _calls = self.by_path({"/api/2.1/unity-catalog/permissions/catalog/system": 403})
        lines = setup.grant_model_access(api, workspace([endpoint("databricks-claude-sonnet-4-6", None)]), SP, self.notebook)
        joined = "\n".join(lines)
        self.assertIn(f"GRANT USE CATALOG ON CATALOG system TO `{SP}`;", joined, joined)
        self.assertIn("Permission Required", joined, joined)
        self.assertTrue(lines[-1].startswith("⚠️ admin action:"), lines)
