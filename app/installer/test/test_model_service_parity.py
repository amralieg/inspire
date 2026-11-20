"""REQ-422: the installer copy of the databricks-<model> -> system.ai.<model> rule matches the shared cases file that the notebook
and the App backend are also checked against (app/backend/test/support/modelServiceCases.json)."""
import json
import pathlib
import unittest

import support

setup = support.load_setup()
CASES = json.loads((pathlib.Path(support.INSTALLER_DIR).parent / "backend" / "test" / "support" / "modelServiceCases.json")
                   .read_text(encoding="utf-8"))["cases"]


class ModelServiceParityTest(unittest.TestCase):
    def test_the_installer_maps_every_shared_case_to_the_same_model_service(self):
        for case in CASES:
            self.assertEqual(setup.system_model_service(case["endpoint"]), case["service"], case)
