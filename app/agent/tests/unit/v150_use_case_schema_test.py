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
                                                clash=case["clash"])
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


def test_the_own_schema_is_the_plain_name_a_clash_name_or_an_older_build_name_and_never_another_use_cases(agent_ns):
    own = agent_ns["implement_is_own_schema"]
    sid = 1234567848213
    for schema in ("_inspire_acme_bank_n01_u01", "_inspire_acme_bank_n01_u01__2", "_inspire_acme_bank_n01_u01__9",
                   "_inspire_acme_bank_n01_u01_48213", "_inspire_acme_bank_n01_u01_1234567848213"):
        assert own(("main", schema), "N01-U01", "Acme Bank", sid, "main.inspire"), schema
    for schema in ("_inspire_acme_bank_n01_u01__1", "_inspire_acme_bank_n01_u01__0", "_inspire_acme_bank_n01_u01_2",
                   "_inspire_acme_bank_n01_u01_99999", "_inspire_acme_bank_n01_u02", "_inspire_other_n01_u01", "inspire"):
        assert not own(("main", schema), "N01-U01", "Acme Bank", sid, "main.inspire"), schema
    assert not own(("sales", "_inspire_acme_bank_n01_u01"), "N01-U01", "Acme Bank", sid, "main.inspire"), "another catalog is not its own"
    assert own(("main", "_inspire_acme_bank_n01_u01_2"), "N01-U01-2", "Acme Bank", sid, "main.inspire")
    assert not own(("main", "_inspire_acme_bank_n01_u01_2"), "N01-U01", "Acme Bank", sid, "main.inspire"), \
        "use case N01-U01-2's plain schema is never N01-U01's clash schema"
    assert agent_ns["implement_in_own_schema"]("main._inspire_acme_bank_n01_u01.n01_u01_results_s1234567848213", "N01-U01", "Acme Bank", sid,
                                               "main.inspire"), "a re-run's session table in the reused schema is in its own schema"


def test_the_app_gets_schema_level_use_select_and_modify_on_its_own_schema_when_the_builder_manages_it(agent_ns):
    plan = agent_ns["implement_access_plan"]
    table = "main._inspire_acme_n01_u01_48213.n01_u01_results"
    owned = [{"level": "schema", "privilege": "OWNER", "principal": "builder@x", "mine": "true", "me": "builder@x"}]
    got = plan(table, owned, "app-sp", agent_ns["IMPLEMENT_OWN_SCHEMA_NEEDS"])
    obj_table = "`main`.`_inspire_acme_n01_u01_48213`.`n01_u01_results`"
    assert [(g["privilege"], g["level"], g["object"]) for g in got["grants"]] == [
        ("USE SCHEMA", "schema", "`main`.`_inspire_acme_n01_u01_48213`"), ("SELECT", "table", obj_table), ("MODIFY", "table", obj_table)]
    assert got["gaps"] == []
    other = [{"level": "schema", "privilege": "OWNER", "principal": "someone@x", "mine": "false", "me": "builder@x"}]
    refused = plan(table, other, "app-sp", agent_ns["IMPLEMENT_OWN_SCHEMA_NEEDS"])
    assert [g["privilege"] for g in refused["gaps"]] == ["USE SCHEMA"], "a schema the builder does not manage is a gap, never a silent grant"
    assert all(g["level"] == "table" for g in refused["grants"]), "SELECT and MODIFY are only ever planned on the table"


def test_the_own_schema_never_plans_select_or_modify_on_the_schema(agent_ns):
    needs = agent_ns["IMPLEMENT_OWN_SCHEMA_NEEDS"]
    assert [(p, lvl) for p, lvl, _ in needs if p in ("SELECT", "MODIFY")] == [("SELECT", "table"), ("MODIFY", "table")]


def test_the_build_grants_the_own_schema_through_the_existing_app_write_path():
    source = agent_source()
    at = source.index('written = [context["result_table"]]')
    block = source[at:at + 900]
    assert "implement_in_own_schema(" in block
    assert "self._implement_app_write_access(" in block and "IMPLEMENT_OWN_SCHEMA_NEEDS" in block
