"""REQ-431 (F-064): a Build that stops because the App's service principal cannot be given read access names the grants.

Before the fix the status line read "the App's service principal an id could not be given read access to 2 source tables ... TO `an id`":
the id was redacted to "an id", the short-reason trim cut the statement mid-way, and no Permission Required entry carried the grants.
"""
import pytest

from v140_implement_test import READS, SHELL_FILES, _deploy_inspire, sdk_stub  # noqa: F401
from v150_app_owners_access_test import NEW_APP

APP_ID = "3f2c9a1e-7b4d-4c8a-9e21-5d6f0a8b1c33"
UNREAD = {
    "main.s.orders": {"grants": [f"GRANT USE CATALOG ON CATALOG `main` TO `{APP_ID}`", f"GRANT SELECT ON TABLE `main`.`s`.`orders` TO `{APP_ID}`"],
                      "refused": "", "owner": "owner@example.com"},
    "main.s.returns": {"grants": [f"GRANT SELECT ON TABLE `main`.`s`.`returns` TO `{APP_ID}`"], "refused": "", "owner": "owner@example.com"},
}
CREATED = {"compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-1"}
DEPLOYED = [{"deployment_id": "dep1", "status": {"state": "SUCCEEDED"}}, {"url": "https://churn-desk.example/"}]


def test_the_status_line_of_a_blocked_app_is_plain_and_points_to_permission_required(agent_ns):
    message = agent_ns["implement_app_unread_block"](APP_ID, UNREAD)
    status = agent_ns["implement_status_error"](message)
    assert "an id" not in status and "TO `" not in status and "..." not in status
    assert "2 source tables" in status
    assert "Permission Required" in status
    assert status.rstrip().endswith("Permission Required") or status.rstrip().endswith("again")


def test_a_blocked_app_lists_its_grants_in_the_builds_permission_required_entries(agent_ns, sdk_stub):
    inst, context, _calls, _imported = _deploy_inspire(agent_ns, NEW_APP + [CREATED] + DEPLOYED)
    inst._implement_app_read_grants = lambda tables, access, client_id, ran, sources=(): {
        "main.s.orders": {"grants": ["GRANT SELECT ON TABLE `main`.`s`.`orders` TO `sp-1`"], "refused": "", "owner": "owner@example.com"}}
    with pytest.raises(agent_ns["ImplementBlocked"]):
        inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, "g1", poll_s=0)
    entries = context.get("permissions") or []
    statements = [s for entry in entries for s in entry["statements"]]
    assert statements, "the dialog's payload carries the exact grants"
    assert all("TO `sp-1`" in s and s.startswith("GRANT ") for s in statements)
    assert any("`main`.`s`" in s for s in statements)
    assert {entry["principal"] for entry in entries} == {"sp-1"}


def test_a_service_principal_id_in_a_short_reason_is_dropped_not_turned_into_an_id(agent_ns):
    reason = agent_ns["implement_short_reason"](
        f"the App's service principal {APP_ID} could not be given read and report access to main.s.reports, "
        "so Inspire did not deploy the App, because people could not report issues")
    assert "an id" not in reason
    assert reason.startswith("the App's service principal could not be given read and report access")
