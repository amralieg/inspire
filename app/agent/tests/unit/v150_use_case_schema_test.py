"""Schema per use case: the notebook names each use case's own schema with the App wizard's rule, read from one shared case list,
and grants the use case's App USE SCHEMA, SELECT and MODIFY on that schema at build time."""
import json
import os

import pytest

from _agentload import agent_source

CASES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "backend", "test", "fixtures", "use_case_schema_names.json")


def _cases():
    with open(CASES, encoding="utf-8") as handle:
        return json.load(handle)


def _plain(name):
    return name.replace("`", "")


@pytest.mark.parametrize("case", _cases()["cases"], ids=lambda c: c["name"])
def test_python_names_every_shared_case_exactly_like_the_app(agent_ns, case):
    got = agent_ns["compute_result_table_name"](case["use_case_id"], "Predict churn", "", case["inspire_database"],
                                                session_id=case["session_id"], business_name=case["business_name"],
                                                whole_sid=case["whole_sid"])
    assert _plain(got) == case["table"]
    assert len(_plain(got).split(".")[1]) <= 255


@pytest.mark.parametrize("case", _cases()["errors"], ids=lambda c: c["name"])
def test_a_missing_or_bad_session_id_errors_rather_than_guessing(agent_ns, case):
    with pytest.raises(ValueError, match=case["error"]):
        agent_ns["compute_result_table_name"](case["use_case_id"], "Predict churn", "", case["inspire_database"],
                                              session_id=case["session_id"], business_name=case["business_name"])


def test_without_a_business_name_the_discover_name_is_unchanged(agent_ns):
    assert agent_ns["compute_result_table_name"]("N01-U01", "Predict churn", "", "main.inspire", session_id=5150) == \
        "`main`.`inspire`.`_inspire_n01_u01_predict_churn_s5150`"


def test_a_result_table_is_in_its_own_schema_only_when_it_carries_this_use_case_and_session(agent_ns):
    own = agent_ns["implement_in_own_schema"]
    assert own("main._inspire_acme_bank_n01_u01_48213.n01_u01_results", "N01-U01", "Acme Bank", 1234567848213, "main.inspire")
    assert own("`main`.`_inspire_acme_bank_n01_u01_1234567848213`.`n01_u01_results`", "N01-U01", "Acme Bank", 1234567848213, "main.inspire")
    assert not own("main.inspire.n01_u01_s1234567848213_out", "N01-U01", "Acme Bank", 1234567848213, "main.inspire")
    assert not own("main._inspire_acme_bank_n01_u02_48213.n01_u02_results", "N01-U01", "Acme Bank", 1234567848213, "main.inspire")
    assert not own("main._inspire_acme_bank_n01_u01_48213.n01_u01_results", "N01-U01", "Acme Bank", None, "main.inspire")
    assert not own("", "N01-U01", "Acme Bank", 1234567848213, "main.inspire")


def test_the_app_gets_schema_level_use_select_and_modify_on_its_own_schema_when_the_builder_manages_it(agent_ns):
    plan = agent_ns["implement_access_plan"]
    table = "main._inspire_acme_n01_u01_48213.n01_u01_results"
    owned = [{"level": "schema", "privilege": "OWNER", "principal": "builder@x", "mine": "true", "me": "builder@x"}]
    got = plan(table, owned, "app-sp", agent_ns["IMPLEMENT_OWN_SCHEMA_NEEDS"])
    assert [(g["privilege"], g["level"], g["object"]) for g in got["grants"]] == [
        (p, "schema", "`main`.`_inspire_acme_n01_u01_48213`") for p in ("USE SCHEMA", "SELECT", "MODIFY")]
    assert got["gaps"] == []
    other = [{"level": "schema", "privilege": "OWNER", "principal": "someone@x", "mine": "false", "me": "builder@x"}]
    refused = plan(table, other, "app-sp", agent_ns["IMPLEMENT_OWN_SCHEMA_NEEDS"])
    assert refused["grants"] == [] and len(refused["gaps"]) == 3, "a schema the builder does not manage is a gap, never a silent grant"


def test_the_build_grants_the_own_schema_through_the_existing_app_write_path():
    source = agent_source()
    at = source.index('written = [context["result_table"]]')
    block = source[at:at + 900]
    assert "implement_in_own_schema(" in block
    assert "self._implement_app_write_access(" in block and "IMPLEMENT_OWN_SCHEMA_NEEDS" in block
