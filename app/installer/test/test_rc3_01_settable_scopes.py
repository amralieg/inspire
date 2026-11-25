"""RC3-01 acceptance (frozen): Inspire asks the Apps API only for user scopes it accepts.

The rc.3 install on my-aws was refused with "The specified scope iam.access-control:read is not a valid scope", which
dropped every user scope and installed Inspire without user authorization. iam.access-control:read and
iam.current-user:read are the default scopes every App gets; they are not in the list an App may ask for
(docs.databricks.com dev-tools/databricks-apps/auth, "Supported user authorization scopes").
"""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
import inspire_setup as setup  # noqa: E402

SETTABLE = {"ai-functions", "ai-gateway", "apps", "files", "genie", "model-serving", "postgres", "sandbox", "sql", "vector-search",
            "sql:read", "sql:restricted-query"} | {f"{s}{m}" for s in ("catalog.catalogs", "catalog.connections", "catalog.schemas",
                                                                       "catalog.tables", "workspace.workspace") for m in ("", ":read")}
DEFAULT = {"iam.access-control:read", "iam.current-user:read"}


class SettableScopesTest(unittest.TestCase):
    def test_every_scope_inspire_asks_for_is_settable(self):
        self.assertEqual(sorted(set(setup.INSPIRE_APP_OWN_SCOPES) - SETTABLE), [])

    def test_no_default_scope_is_asked_for(self):
        self.assertEqual(sorted(set(setup.INSPIRE_APP_OWN_SCOPES) & DEFAULT), [])
        self.assertEqual(sorted(set(setup._merged_scopes(["sql", "iam.access-control:read"], setup.INSPIRE_APP_OWN_SCOPES)) & DEFAULT), [])

    def test_the_person_data_scopes_stay(self):
        for scope in ("apps", "catalog.catalogs:read", "catalog.schemas:read", "catalog.tables:read", "files", "sql", "workspace.workspace"):
            self.assertIn(scope, setup.INSPIRE_APP_OWN_SCOPES)


if __name__ == "__main__":
    unittest.main()
