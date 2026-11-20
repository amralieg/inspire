"""REQ-424 / D-UGW-4A: the App checks itself and the installer reads the result. Every setup in
app/backend/test/support/modelAccessWorlds.json is played by a fake App that reports what the fixture expects, on the route the
fixture names ("route"); the backend test modelSelfCheck.test.js holds the real route handler to the same keys."""
import contextlib
import io
import json
import pathlib
import types
import unittest

import support
import test_setup

setup = support.load_setup()
ROOT = pathlib.Path(support.INSTALLER_DIR).parent
FIXTURE = json.loads((ROOT / "backend" / "test" / "support" / "modelAccessWorlds.json").read_text(encoding="utf-8"))
ROUTE = FIXTURE["route"]
SP = "SPNEW"
WIZARD_OK = {"envSkipsSetupWizard": True}


def record_for(world, principal=SP):
    expected = world["expected"]
    return {"state": "checked", "blocked": expected["blocked"], "callable": expected["callable"], "setup": world["setup"],
            "steps": [s.replace("<principal>", principal) for s in expected["steps"]], "limited": [], "principal": principal,
            "checkedAt": "2026-11-20T12:00:00.000Z"}


def body(record):
    return (200, dict(WIZARD_OK, **({} if record is None else {ROUTE["field"]: record})))


class AppModelCheckTest(unittest.TestCase):
    def run_install(self, bodies):
        """step_create_app_and_find_sp then step_deploy_source against a fake App that answers the bodies in order (the last repeats)."""
        driver = test_setup.DeployedSettingsTest("test_the_app_yaml_is_saved_through_the_workspace_before_the_deploy_copies_it")
        _calls, _deployed, said, error = test_setup.DeployedSettingsTest.deploy(driver, [test_setup.WANTED_YAML], defaults=bodies)
        return said, error

    def test_the_route_the_installer_reads_is_the_route_the_fixture_names(self):
        self.assertEqual(setup.APP_DEFAULTS_ROUTE, ROUTE["path"])
        self.assertEqual(setup.MODEL_CHECK_FIELD, ROUTE["field"])
        for world in FIXTURE["worlds"]:
            self.assertEqual(sorted(record_for(world)), sorted(ROUTE["keys"]), "the fake App reports exactly the keys the real route serves")

    def test_a_blocked_app_ends_the_install_red_with_the_exact_steps(self):
        for world in [w for w in FIXTURE["worlds"] if w["expected"]["blocked"]]:
            with self.subTest(world=world["id"]):
                said, error = self.run_install([body(record_for(world))])
                self.assertIsNotNone(error, "the install ends red")
                self.assertIn(f"setup {world['setup']}", error)
                for step in record_for(world)["steps"]:
                    self.assertIn(step, error)
                self.assertNotIn("model check: ✅", said)

    def test_a_working_setup_passes_and_names_what_the_app_calls(self):
        for world in [w for w in FIXTURE["worlds"] if not w["expected"]["blocked"] and w["setup"] != "rate limit"]:
            with self.subTest(world=world["id"]):
                said, error = self.run_install([body(record_for(world))])
                self.assertIsNone(error)
                self.assertIn(f"App model check: ✅ setup {world['setup']}; the App calls {world['expected']['callable']}", said)

    def test_a_rate_limit_finishes_with_a_warning_naming_the_model_and_the_gateway_rate_limit_page(self):
        world = next(w for w in FIXTURE["worlds"] if w["id"] == "rate-limit-0")
        for limited, named in (([], "the model list"), (["databricks-claude-sonnet-4-6"], "databricks-claude-sonnet-4-6")):
            with self.subTest(limited=limited):
                said, error = self.run_install([body(dict(record_for(world), limited=limited))])
                self.assertIsNone(error)
                self.assertIn(f"{named} answered a rate limit (429)", said)
                self.assertIn("AI Gateway > Rate limits", said)
                self.assertIn("Start checks again before each run", said)
                self.assertNotIn("model check: ✅", said)

    def test_the_app_waits_until_pending_ends(self):
        world = next(w for w in FIXTURE["worlds"] if w["id"] == "legacy")
        said, error = self.run_install([body({"state": "pending"})] * 4 + [body(record_for(world))])
        self.assertIsNone(error)
        self.assertIn("App model check: ✅ setup legacy", said)

    def test_an_app_that_never_reports_says_so_and_claims_nothing(self):
        said, error = self.run_install([body({"state": "pending"})])
        self.assertIsNone(error)
        self.assertIn("did not report within 3 minutes (180s). Models are NOT confirmed", said)
        self.assertNotIn("model check: ✅", said)

    def test_an_app_without_the_field_or_that_could_not_check_claims_nothing(self):
        for reported, words in ((None, "the App did not report one"), ({"state": "unchecked", "reason": "no token"}, "not made (no token)"),
                                ({"state": "error", "reason": "The check failed: boom"}, "not made (The check failed: boom)")):
            with self.subTest(reported=reported):
                said, error = self.run_install([body(reported)])
                self.assertIsNone(error)
                self.assertIn(words, said)
                self.assertNotIn("model check: ✅", said)

    def test_the_dead_pre_create_gate_is_gone(self):
        for name in ("model_access_gate", "_app_sp_call", "model_permission_fallback", "model_access_plan", "MODEL_STOP_STEPS"):
            self.assertFalse(hasattr(setup, name), name)
        self.assertNotIn("Live model check", self.run_install([body(None)])[0])
