import ast
import os
import re
import sys

import pytest

from _agentload import agent_source, load_agent_namespace, method_node

TESTS = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(os.path.dirname(os.path.dirname(TESTS)), "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_facts as F  # noqa: E402


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def ledger_statement_problems(function):
    text = ast.unparse(function)
    problems = [f"inline {verb}" for verb in re.findall(r"GRANT (?:SELECT|MODIFY)\b|CREATE TABLE IF NOT EXISTS", text)]
    for builder in ("ledger_create_sql", "ledger_grant_sqls"):
        if builder not in text:
            problems.append(f"no {builder} call")
    return problems


def test_a_principal_is_quoted_with_backticks_and_its_own_backticks_doubled(ns):
    quote = ns["inspire_quote_principal"]
    assert quote("app-sp-id") == "`app-sp-id`"
    assert quote("odd`name") == "`odd``name`"
    assert quote("  spaced  ") == "`spaced`"


def test_every_grant_statement_quotes_its_principal_through_the_one_helper():
    bare = re.findall(r"TO `\{", agent_source())
    assert bare == []
    assert agent_source().count("TO {inspire_quote_principal(") >= 5


def test_the_principal_quote_is_defined_once_in_shell_facts_and_the_notebook_only_delegates(ns):
    assert F.quote_principal("app-sp-id") == "`app-sp-id`"
    assert F.quote_principal("odd`name") == "`odd``name`"
    assert F.quote_principal("  spaced  ") == "`spaced`"
    assert ns["inspire_quote_principal"]("odd`name") == F.quote_principal("odd`name")
    body = top_level_function(ns["IMPLEMENT_RESULT_HISTORY_SOURCE"], "inspire_quote_principal").body
    assert [ast.unparse(statement) for statement in body] == ["return inspire_shell_facts.quote_principal(principal)"]


def top_level_function(source, name):
    return next(n for n in ast.walk(ast.parse(source)) if isinstance(n, ast.FunctionDef) and n.name == name)


def test_the_value_ledger_statements_come_only_from_the_shell_facts_builders():
    assert ledger_statement_problems(method_node("DatabricksInspire", "_implement_ledger_access")) == []


def test_an_inline_grant_in_the_ledger_access_fails_the_one_helper_check():
    inline = ("class DatabricksInspire:\n"
              "    def _implement_ledger_access(self, database, client_id):\n"
              "        self.spark.sql(inspire_shell_facts.ledger_create_sql(table))\n"
              "        self.spark.sql(f\"GRANT SELECT ON TABLE {table} TO {inspire_quote_principal(client_id)}\")\n")
    function = next(n for n in ast.walk(ast.parse(inline)) if isinstance(n, ast.FunctionDef))
    assert ledger_statement_problems(function) == ["inline GRANT SELECT", "no ledger_grant_sqls call"]


def test_an_inline_create_in_the_ledger_access_fails_the_one_helper_check():
    inline = ("class DatabricksInspire:\n"
              "    def _implement_ledger_access(self, database, client_id):\n"
              "        self.spark.sql(f\"CREATE TABLE IF NOT EXISTS {table} (x STRING)\")\n"
              "        self.spark.sql(inspire_shell_facts.ledger_grant_sqls(table, client_id))\n")
    function = next(n for n in ast.walk(ast.parse(inline)) if isinstance(n, ast.FunctionDef))
    assert ledger_statement_problems(function) == ["inline CREATE TABLE IF NOT EXISTS", "no ledger_create_sql call"]
