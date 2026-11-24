"""SEC-01 W6 (Build side): an App that reads as its service principal still asks for the viewer scope, so the shell receives the viewer's token."""


def test_sp_mode_apps_request_only_the_restricted_query_viewer_scope(agent_ns):
    scopes = agent_ns["implement_app_user_scopes"]
    assert agent_ns["IMPLEMENT_APP_VIEWER_SCOPES"] == ("sql:restricted-query",)
    assert scopes({"app_access": "sp", "app_options": {"modify": True}}) == ["sql:restricted-query"]
    assert scopes({"app_access": "sp"}) == ["sql:restricted-query"]
    assert scopes({"app_access": "user", "app_options": {"modify": False}}) == ["sql:restricted-query", "genie"]
    assert scopes({}) == [] and scopes(None) == []
