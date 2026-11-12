"""REQ-039: a new App service principal gets every read grant on deploy, or the deploy blocks. A live App never answers with unread sources."""
import pytest

from v140_implement_test import READS, SHELL_FILES, _deploy_inspire, sdk_stub  # noqa: F401
from v150_app_owners_access_test import NEW_APP

CREATED = {"compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-1"}
DEPLOYED = [{"deployment_id": "dep1", "status": {"state": "SUCCEEDED"}}, {"url": "https://churn-desk.example/"}]
UNREAD = {"main.s.orders": {"grants": ["GRANT SELECT ON TABLE `main`.`s`.`orders` TO `sp-1`"], "refused": "", "owner": "owner@example.com"}}


def test_a_source_the_new_app_cannot_be_granted_blocks_the_deploy_and_the_app_is_never_deployed(agent_ns, sdk_stub):
    inst, context, calls, _imported = _deploy_inspire(agent_ns, NEW_APP + [CREATED] + DEPLOYED)
    inst._implement_app_read_grants = lambda tables, access, client_id, ran, sources=(): UNREAD
    with pytest.raises(agent_ns["ImplementBlocked"]) as blocked:
        inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, "g1", poll_s=0)
    text = str(blocked.value)
    assert text.startswith("the App's service principal sp-1 could not be given read access to 1 source table")
    assert "GRANT SELECT ON TABLE `main`.`s`.`orders` TO `sp-1`" in text
    assert "owner@example.com" not in text, "an email owner is shown as your data owner"
    assert not any(method == "POST" and path.endswith("/deployments") for method, path, _body in calls), \
        "the App is not deployed while a source is unread, so no live App answers with 502"


def test_a_fully_granted_new_app_deploys_with_no_block(agent_ns, sdk_stub):
    inst, context, calls, _imported = _deploy_inspire(agent_ns, NEW_APP + [CREATED] + DEPLOYED)
    inst._implement_app_read_grants = lambda tables, access, client_id, ran, sources=(): {}
    fields = inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, "g1", poll_s=0)
    assert fields["app_url"] == "https://churn-desk.example"
    assert any(method == "POST" and path.endswith("/deployments") for method, path, _body in calls)


def test_the_build_policy_sentence_is_the_one_the_preflight_shows_for_the_same_identity_and_table(agent_ns):
    denial = {"table": "main.s.orders", "principal": "amr@x", "label": "Amr", "statement": "", "owner": ""}
    assert agent_ns["implement_abac_denied_sentence"](denial) == (
        "Amr cannot read the access policies of the source table, so Inspire cannot tell whether the results keep them")


def test_the_build_app_principal_sentence_is_the_one_the_App_side_refusal_shows(agent_ns):
    denial = {"table": "main.s.orders", "principal": "app-sp-2", "label": "riverside-assets", "statement": "", "owner": ""}
    assert agent_ns["implement_abac_denied_sentence"](denial) == (
        "The App's service principal riverside-assets cannot read the access policies of the source table, so Inspire cannot tell whether the results keep them")


def test_a_blocked_app_keeps_its_unread_sources_on_the_context_so_the_build_saves_them_for_the_access_card(agent_ns, sdk_stub):
    inst, context, calls, _imported = _deploy_inspire(agent_ns, NEW_APP + [CREATED] + DEPLOYED)
    inst._implement_app_read_grants = lambda tables, access, client_id, ran, sources=(): UNREAD
    with pytest.raises(agent_ns["ImplementBlocked"]):
        inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, "g1", poll_s=0)
    assert context["app_unread"] == {"app": "sp-1", "tables": [{
        "table": "main.s.orders", "owner": "your data owner", "grants": ["GRANT SELECT ON TABLE `main`.`s`.`orders` TO `sp-1`"]}]}
