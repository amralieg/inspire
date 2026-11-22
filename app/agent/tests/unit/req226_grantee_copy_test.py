"""REQ-226: the Permission Required entry for the App audience says who runs the grant and who receives it.

The grant targets the audience group itself (a user-authorization App reads with each opener's own access), so the principal
stays; only the copy changed. Fail-pre: the old text said '<group> opens this App ... Ask your workspace admin to run them'.
"""


def test_the_audience_entry_names_who_runs_and_who_receives_the_grant(agent_ns):
    why = agent_ns["implement_audience_grant_why"]("admins")
    assert why.startswith("These commands give admins read access"), why
    assert "opens this App" not in why and "so it needs" not in why


def test_the_audience_entry_is_built_with_that_copy_and_the_audience_principal(agent_ns):
    # The audience path is exact (its viewers get views only, never a schema grant), so it is built with exact=True as in production.
    entry = agent_ns["implement_permission_entry"]("admins", ["GRANT SELECT ON TABLE `c`.`s`.`t` TO `admins`"],
                                                   agent_ns["implement_audience_grant_why"]("admins"), exact=True)
    assert entry["principal"] == "admins" and entry["statements"] == ["GRANT SELECT ON TABLE `c`.`s`.`t` TO `admins`"]
    assert entry["why"].endswith("with each person's own access.")
