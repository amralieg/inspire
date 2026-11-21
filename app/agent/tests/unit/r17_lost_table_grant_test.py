"""R17 round 3 (REQ-131, REQ-260): the lost-table refusal carries its GRANT statements as the Permission Required entry, and its
sentence names no GRANT. Before the fix the builder did not exist, so these tests failed."""


def test_the_unreadable_tables_grants_ride_a_permission_entry(agent_ns):
    missing = [{"table": "main.s.b", "reason": "no read access"}]
    entry = agent_ns["implement_missing_tables_permission"](missing, "runner@example.com")
    assert entry["principal"] == "runner@example.com"
    assert entry["statements"] == [
        "GRANT USE CATALOG ON CATALOG `main` TO `runner@example.com`",
        "GRANT USE SCHEMA ON SCHEMA `main`.`s` TO `runner@example.com`",
        "GRANT SELECT ON SCHEMA `main`.`s` TO `runner@example.com`"]  # REQ-408 (de113fe36): read grants are asked at schema level


def test_the_refusal_sentence_names_no_grant_and_a_gone_table_needs_no_entry(agent_ns):
    missing = [{"table": "main.s.b", "reason": "no read access"}]
    assert "GRANT" not in agent_ns["implement_missing_tables_message"](missing, "runner@example.com")
    assert agent_ns["implement_missing_tables_permission"]([{"table": "main.s.a", "reason": "not found"}], "runner@example.com") is None
    assert agent_ns["implement_missing_tables_permission"](missing, "") is None, "no identity, no grant to a placeholder"
