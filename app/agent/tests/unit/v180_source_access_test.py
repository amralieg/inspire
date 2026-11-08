"""A source table that is gone and one the run cannot read get different reasons: a gone table asks for a swap, an
unreadable one names the identity the run reads as and lists the GRANT statements, in the Implement preview and in
Discover's Deep evidence, and Discover keeps going for the readable tables."""
import pytest

from v120_artifacts_support import FakeSpark, make_inspire
from v130_evidence_test import BUSINESS_DETAILS, _deep_responder, _obj

APP_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
GRANTS_B = (f"GRANT USE CATALOG ON CATALOG `main` TO `{APP_ID}`; GRANT USE SCHEMA ON SCHEMA `main`.`s` TO `{APP_ID}`; "
            f"GRANT SELECT ON TABLE `main`.`s`.`b` TO `{APP_ID}`")
DENIED = "[INSUFFICIENT_PERMISSIONS] Insufficient privileges: User does not have SELECT on Table 'main.s.customers'."


def test_a_gone_table_asks_for_a_swap_in_the_singular_and_the_plural(agent_ns):
    message = agent_ns["implement_missing_tables_message"]
    assert message([{"table": "main.s.a", "reason": "not found"}]) == (
        "the preview cannot run because this source table is missing: main.s.a, so open Edit, Data step, and swap it for a "
        "table with the same role or remove it")
    assert message([{"table": "main.s.a", "reason": "not found"}, {"table": "main.s.c", "reason": "not found"}]) == (
        "the preview cannot run because these source tables are missing: main.s.a, main.s.c, so open Edit, Data step, and swap "
        "each for a table with the same role or remove it")


def test_an_unreadable_table_names_the_service_principal_and_its_grants_and_never_asks_for_a_swap(agent_ns):
    text = agent_ns["implement_missing_tables_message"]([{"table": "main.s.b", "reason": "no read access"}], APP_ID, "inspire-app")
    assert text == ("the preview cannot run because this run reads source tables as the service principal inspire-app "
                    f"(application id {APP_ID}), which cannot read main.s.b. Ask the owner of that table to run: {GRANTS_B}")
    assert "swap" not in text and "missing" not in text


def test_gone_and_unreadable_tables_each_get_their_own_reason(agent_ns):
    text = agent_ns["implement_missing_tables_message"]([{"table": "main.s.a", "reason": "not found"},
                                                         {"table": "main.s.b", "reason": "no read access"},
                                                         {"table": "main.s.d", "reason": "no read access"}], APP_ID, "inspire-app")
    assert text.startswith("the preview cannot run because this source table is missing: main.s.a, so open Edit, Data step, "
                           "and swap it for a table with the same role or remove it, and this run reads source tables as the "
                           f"service principal inspire-app (application id {APP_ID}), which cannot read main.s.b, main.s.d. "
                           "Ask the owner of those tables to run: ")
    assert text.endswith(f"GRANT SELECT ON TABLE `main`.`s`.`b` TO `{APP_ID}`; GRANT SELECT ON TABLE `main`.`s`.`d` TO `{APP_ID}`")
    assert text.count("GRANT USE CATALOG") == 1 and text.count("GRANT USE SCHEMA") == 1, "a shared catalog and schema are granted once"


@pytest.mark.parametrize("who,label,named", [
    ("someone@example.com", "Some One", "someone@example.com"),
    (APP_ID, APP_ID, f"the service principal with application id {APP_ID}"),
    (APP_ID, "", f"the service principal with application id {APP_ID}"),
    (APP_ID.upper(), "inspire-app", f"the service principal inspire-app (application id {APP_ID.upper()})"),
    ("not-an-application-id", "x", "not-an-application-id"),
])
def test_the_identity_is_named_the_way_it_runs(agent_ns, who, label, named):
    assert agent_ns["inspire_identity_text"](who, label) == named
    assert f"as {named}, which cannot read main.s.b." in agent_ns["inspire_unreadable_text"](["main.s.b"], who, label)


def test_without_a_known_identity_the_reason_still_names_the_grants_needed_and_no_statement(agent_ns):
    text = agent_ns["inspire_unreadable_text"](["main.s.b"], "", "")
    assert text == ("this run reads source tables as an identity Inspire could not read, which cannot read main.s.b. Ask the owner of "
                    "that table to grant USE CATALOG, USE SCHEMA and SELECT on it to that identity")
    assert "GRANT " not in text
    assert agent_ns["inspire_read_grants"](["main.s.b"], "") == []
    assert agent_ns["inspire_read_grants"](["not_three_parts"], APP_ID) == []


def test_the_preview_stops_on_an_unreadable_table_naming_the_run_identity_and_keeps_the_reason_the_app_reads(agent_ns):
    def responder(statement):
        if statement == "SELECT * FROM `main`.`s`.`b` LIMIT 0":
            raise RuntimeError(DENIED.replace("main.s.customers", "main.s.b"))
        if statement == "SELECT * FROM `main`.`s`.`a` LIMIT 0":
            raise RuntimeError("[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`s`.`a` cannot be found.")

    inst = make_inspire(agent_ns, spark=FakeSpark(responder=responder))
    inst.updates = []
    inst._implement_update = lambda key, **fields: inst.updates.append(fields)
    inst._genie_involved_tables = lambda use_case: ["main.s.a", "main.s.b", "main.s.ok"]
    inst._implement_builder = lambda: APP_ID
    inst._implement_builder_label = lambda: "inspire-app"
    inst._implement_role_problems = lambda spec, use_case: pytest.fail("roles are not checked while a source table is lost")
    status = {}
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        inst._implement_source_checks((5150, "N01-U01", 3), {}, {}, status)
    assert str(raised.value) == agent_ns["implement_missing_tables_message"](
        [{"table": "main.s.a", "reason": "not found"}, {"table": "main.s.b", "reason": "no read access"}], APP_ID, "inspire-app")
    assert f"the service principal inspire-app (application id {APP_ID}), which cannot read main.s.b" in str(raised.value)
    assert [(m["table"], m["reason"]) for m in status["data"]["missing_tables"]] == [("main.s.a", "not found"),
                                                                                    ("main.s.b", "no read access")]


def test_a_gone_primary_table_asks_only_for_a_swap_because_the_data_step_cannot_remove_it(agent_ns):
    def responder(statement):
        for name in ("pax_gone", "c"):
            if statement == f"SELECT * FROM `main`.`s`.`{name}` LIMIT 0":
                raise RuntimeError(f"[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`s`.`{name}` cannot be found.")

    inst = make_inspire(agent_ns, spark=FakeSpark(responder=responder))
    inst.updates = []
    inst._implement_update = lambda key, **fields: inst.updates.append(fields)
    inst._genie_involved_tables = lambda use_case: ["main.s.pax", "main.s.c", "main.s.ok"]
    inst._implement_builder = lambda: APP_ID
    inst._implement_builder_label = lambda: "inspire-app"
    status = {}
    spec = {"data": {"tables": {"main.s.pax": "main.s.pax_gone"}}}
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        inst._implement_source_checks((5150, "N01-U01", 1), spec, {"primary_table": "main.s.pax"}, status)
    assert str(raised.value) == (
        "the preview cannot run because the primary table main.s.pax_gone is missing, so open Edit, Data step, and swap it for a table "
        "with the same role; the primary table can be swapped, not removed, and this source table is missing: main.s.c, so open Edit, "
        "Data step, and swap it for a table with the same role or remove it")
    assert [(m["table"], m.get("primary", False)) for m in status["data"]["missing_tables"]] == [("main.s.pax_gone", True), ("main.s.c", False)]
    alone = agent_ns["implement_missing_tables_message"]([{"table": "main.s.pax_gone", "reason": "not found", "primary": True}])
    assert "remove" not in alone.replace("swapped, not removed", "")


def test_discover_names_who_cannot_read_a_table_and_keeps_going_for_the_readable_ones(agent_ns):
    def responder(statement):
        if statement.startswith("SELECT COUNT(*) AS n FROM `main`.`s`.`customers`"):
            raise RuntimeError(DENIED)
        return _deep_responder(statement)

    obj, _spark = _obj(agent_ns, "Deep", responder)
    obj._implement_builder = lambda: APP_ID
    obj._implement_builder_label = lambda: "inspire-app"
    evidence = obj._collect_discovery_evidence(BUSINESS_DETAILS)
    assert "main.s.orders" in evidence["profiles"] and "main.s.customers" not in evidence["profiles"]
    grants = (f"GRANT USE CATALOG ON CATALOG `main` TO `{APP_ID}`; GRANT USE SCHEMA ON SCHEMA `main`.`s` TO `{APP_ID}`; "
              f"GRANT SELECT ON TABLE `main`.`s`.`customers` TO `{APP_ID}`")
    reason = (f"Discover reads source tables as the service principal inspire-app (application id {APP_ID}), which cannot read "
              f"main.s.customers. Ask the owner of that table to run: {grants}")
    access = evidence["data_access"]
    assert access["tables_skipped"] == {"main.s.customers": "denied"}
    assert access["tables_unreadable"] == ["main.s.customers"] and access["unreadable_reason"] == reason
    assert obj.logger.matching(f"this table stays Standard: {reason}", level="WARNING")
    assert any(reason in w and "the evidence covers only the 1 table it could read" in w for w in obj._run_outcome_warnings())


def test_discover_adds_no_reason_when_a_table_fails_for_another_cause(agent_ns):
    def responder(statement):
        if statement.startswith("SELECT COUNT(*) AS n FROM `main`.`s`.`customers`"):
            raise RuntimeError("Statement failed: division by zero")
        return _deep_responder(statement)

    obj, _spark = _obj(agent_ns, "Deep", responder)
    obj._implement_builder = lambda: pytest.fail("no identity is read when nothing was denied")
    evidence = obj._collect_discovery_evidence(BUSINESS_DETAILS)
    assert evidence["data_access"]["tables_skipped"] == {"main.s.customers": "failed"}
    assert "tables_unreadable" not in evidence["data_access"] and "unreadable_reason" not in evidence["data_access"]
    assert not any("cannot read" in w for w in obj._run_outcome_warnings())
