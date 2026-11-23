"""REQ-502: an admin installs the App and every workspace user can open it, with no manual share step.

Before this fix the installer never set the App's permissions, so only the installer (the App's creator) could open it and every other
person saw "You do not have permission to access this app" until an admin shared it by hand.
"""
import unittest

import test_setup

setup = test_setup.setup
Resp = test_setup.Resp
SHARE = ("PATCH", "/api/2.0/permissions/apps/inspire-ai",
         {"access_control_list": [{"group_name": "users", "permission_level": "CAN_USE"}]})
DONE = "CAN_USE on the App inspire-ai for the users group, so every workspace user can open it: ✅"


class AppUsersAccessTest(unittest.TestCase):
    def test_the_users_group_gets_can_use_on_the_app(self):
        api, calls = test_setup.recording(lambda m, p, b: Resp(200, {}))
        said = setup._app_users_access(api, "inspire-ai")
        self.assertEqual(calls, [SHARE], "PATCH adds to the App's permissions and never drops the owner's Can Manage")
        self.assertEqual(said, DONE)

    def test_a_refused_share_names_the_manual_step_and_never_reads_as_done(self):
        api, calls = test_setup.recording(lambda m, p, b: Resp(403, {}, '{"error_code":"PERMISSION_DENIED","message":"no CAN_MANAGE"}'))
        said = setup._app_users_access(api, "inspire-ai")
        self.assertEqual(calls, [SHARE])
        self.assertTrue(said.startswith("⚠️ Workspace users cannot open the App inspire-ai yet (PERMISSION_DENIED"), said)
        self.assertIn("Compute → Apps → inspire-ai → Permissions", said)
        self.assertIn("users", said)
        self.assertNotIn("✅", said)

    def test_every_install_shares_the_app_after_it_exists_and_prints_the_result(self):
        harness = test_setup.DeployedSettingsTest("run")
        calls, _deployed, said, error = harness.deploy([test_setup.WANTED_YAML], defaults=[(200, {"envSkipsSetupWizard": True})])
        self.assertIsNone(error)
        self.assertEqual([c for c in calls if c[1].startswith("/api/2.0/permissions/apps/")], [SHARE], "shared exactly once per install")
        posted = [i for i, c in enumerate(calls) if c[:2] == ("POST", "/api/2.0/apps")]
        self.assertTrue(posted and posted[0] < calls.index(SHARE), "the share runs after the App exists")
        self.assertIn(DONE, said)

    def test_a_refused_share_does_not_stop_the_install(self):
        harness = test_setup.DeployedSettingsTest("run")
        saved = setup._app_users_access
        setup._app_users_access = lambda api, name: "⚠️ Workspace users cannot open the App inspire-ai yet (x)"
        try:
            _calls, deployed, said, error = harness.deploy([test_setup.WANTED_YAML], defaults=[(200, {"envSkipsSetupWizard": True})])
        finally:
            setup._app_users_access = saved
        self.assertIsNone(error)
        self.assertTrue(deployed, "the deploy still runs")
        self.assertIn("⚠️ Workspace users cannot open the App inspire-ai yet (x)", said)


if __name__ == "__main__":
    unittest.main()
