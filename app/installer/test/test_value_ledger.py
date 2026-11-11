import importlib.util
import pathlib
import unittest
from unittest import mock

import support

setup = support.load_setup()
_FACTS = pathlib.Path(__file__).resolve().parents[2] / "agent" / "agent" / "app_shell" / "server" / "shell_facts.py"
_spec = importlib.util.spec_from_file_location("shell_facts_under_test", _FACTS)
SHELL_FACTS = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(SHELL_FACTS)
TABLE = "`main`.`inspire`.`__inspire_value_ledger`"


class ValueLedgerTest(unittest.TestCase):
    def test_the_grants_are_select_and_modify_on_that_one_table_and_never_catalog_or_schema(self):
        grants = setup._value_ledger_grants("sp-123", "main", "inspire")
        self.assertEqual(grants, [f"GRANT SELECT ON TABLE {TABLE} TO `sp-123`", f"GRANT MODIFY ON TABLE {TABLE} TO `sp-123`"])
        for sql in grants:
            self.assertNotIn("CATALOG", sql)
            self.assertNotIn("SCHEMA", sql)

    def test_the_installer_column_list_matches_the_App_and_job_schema(self):
        self.assertEqual(setup.VALUE_LEDGER_COLUMNS, SHELL_FACTS.LEDGER_COLUMNS)
        self.assertEqual(setup.VALUE_LEDGER_TABLE, SHELL_FACTS.LEDGER_TABLE)

    def test_the_ledger_is_created_with_the_same_statement_the_job_and_the_App_use(self):
        sent = []
        with mock.patch.object(setup, "_grant_error", side_effect=lambda w, wh, sql: sent.append(sql) or ""):
            setup._ensure_value_ledger(None, "wh1", "main", "inspire")
        self.assertEqual(sent, [SHELL_FACTS.ledger_create_sql(TABLE)])

    def test_a_failed_create_blocks_the_install_and_names_the_table(self):
        with mock.patch.object(setup, "_grant_error", return_value="PERMISSION_DENIED: no CREATE TABLE"):
            with self.assertRaises(RuntimeError) as raised:
                setup._ensure_value_ledger(None, "wh1", "main", "inspire")
        self.assertIn("`main`.`inspire`.`__inspire_value_ledger`", str(raised.exception))
        self.assertIn("PERMISSION_DENIED", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
