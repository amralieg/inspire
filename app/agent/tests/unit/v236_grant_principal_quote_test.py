import re

import pytest

from _agentload import agent_source, load_agent_namespace


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def test_a_principal_is_quoted_with_backticks_and_its_own_backticks_doubled(ns):
    quote = ns["inspire_quote_principal"]
    assert quote("app-sp-id") == "`app-sp-id`"
    assert quote("odd`name") == "`odd``name`"
    assert quote("  spaced  ") == "`spaced`"


def test_every_grant_statement_quotes_its_principal_through_the_one_helper():
    bare = re.findall(r"TO `\{", agent_source())
    assert bare == []
    assert agent_source().count("TO {inspire_quote_principal(") >= 5
