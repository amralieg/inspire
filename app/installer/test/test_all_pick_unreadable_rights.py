"""FX-61 (REQ-456, REQ-458): the default All pick must not stop the install on a catalog whose rights cannot be read.

The person never picked that catalog, so All leaves it out and lists the GRANT its owner runs. An explicit pick of the same
catalog keeps the FX-47 stop before the deploy.
"""
import unittest

import test_read_catalogs as trc

READ = trc.READ

REFUSED = RuntimeError("PERMISSION_DENIED: not the owner")
# `x` is absent from `rights`, so reading its effective permissions raises PERMISSION_DENIED
RIGHTS = {"ops": ("MANAGE",), "sales": ("MANAGE",)}


class AllPickUnreadableRightsTest(unittest.TestCase):
    def test_all_pick_leaves_out_a_catalog_whose_rights_cannot_be_read_and_the_install_goes_on(self):
        grants, _, executed, said = trc.ConsentAndGrantTest.grant_read(
            self, ["x", "ops", "sales"], listed=("ops", "sales", "x"), rights=RIGHTS, fail={"CATALOG `x`": REFUSED}, data_all=True)
        self.assertNotIn("x", self.ctx["DATA_CATALOGS"])
        self.assertEqual(self.ctx["DATA_LEFT_OUT"], ["x"])
        self.assertEqual(said.count(READ.format("x")), 1, "listed once with the GRANT its owner runs")
        self.assertFalse([sql for sql, _ in executed if "`x`" in sql and sql.startswith("GRANT")], "nothing is attempted on it")

    def test_an_explicit_pick_of_the_same_catalog_still_stops_before_the_deploy(self):
        message, _said = trc.ConsentAndGrantTest.grant_stopped(
            self, ["x", "sales"], listed=("ops", "sales", "x"), rights=RIGHTS, fail={"CATALOG `x`": REFUSED}, data_all=False)
        self.assertIn(READ.format("x"), message)
        self.assertIn("stopped before it deploys", message)


if __name__ == "__main__":
    unittest.main()
