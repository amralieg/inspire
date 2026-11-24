"""SEC-01 W1 (reverses REQ-478, REQ-469): the installer never gives Inspire's service principal MANAGE on customer data.

Read access comes from table-level requests at use time. The installer's own write set stays on the Inspire catalog and schema.
"""
import json
import unittest

import support
import test_setup as ts

setup = support.load_setup()


class NoDataManageTest(unittest.TestCase):
    def test_the_install_never_patches_manage_onto_a_picked_data_catalog(self):
        api, calls = ts.lakebase_api(catalog=((200, ts.BOUND),), make_catalog=ts.REFUSED_CATALOG)
        ts.GrantPlanTest.grant(self, ["sales", "finance"], api=api)
        for method, path, body in calls:
            if method == "PATCH" and "/unity-catalog/permissions/" in path:
                self.assertNotIn("MANAGE", json.dumps(body), (path, body))
                self.assertNotIn("/permissions/table/", path)
                for catalog in ("sales", "finance"):
                    self.assertNotEqual(path.rsplit("/", 1)[-1], catalog, path)

    def test_the_manage_on_data_step_is_gone(self):
        self.assertFalse(hasattr(setup, "_grant_data_manage"))


if __name__ == "__main__":
    unittest.main()
