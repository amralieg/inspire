"""The Use Case App's look, access mode and options: the wizard spec C1 contract in the notebook, the per-user authorization
scopes on the deployed App, the shell's server-side gates, and the shell vocabularies staying in step, offline."""
import base64
import copy
import json
import os
import re

import pytest

from v140_implement_test import (GRANT_SELECT, INSPIRE_OWNS, OURS_APP, READS, SHELL_FILES, VALID, _access_spark, _app_flow, _app_shell,
                                 _churn_page, _deploy_inspire, _feedback_refused, _inspire, _not_access_reads, _spec, _without_feedback,
                                 sdk_stub)
from v141_app_shell_test import PAGE, SETTINGS, call, shell
from v120_artifacts_support import CapturingLogger
import shell_core

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WEB = os.path.join(ROOT, "agent", "app_shell", "web", "src")
USER_LOOK = {"style": "c", "layout": "tabs", "palette": "ocean", "theme": "dark"}


def _outputs(**changes):
    return dict(VALID["outputs"], **changes)


def test_choices_default_to_the_c1_look_with_decisions_on_and_every_other_option_off(agent_ns):
    choices, errors = agent_ns["implement_app_choices"]({"app_access": "sp"})
    assert errors == []
    assert choices == {"app_access": "sp", "app_look": {"style": "a", "layout": "sidebar", "palette": "default", "theme": "light"},
                       "app_options": {"modify": False, "replace_edits": False, "decisions": True, "alerts": False},
                       "app_backend": "delta", "app_charts": [], "app_pages": {"runs": True, "impact": True}, "app_placement": ""}
    choices, errors = agent_ns["implement_app_choices"]({"app_access": " SP ", "app_look": {"palette": "Berry", "theme": None, "style": ""},
                                                          "app_options": {"modify": True}})
    assert errors == [] and choices["app_access"] == "sp" and choices["app_options"]["modify"] is True
    assert choices["app_look"] == {"style": "a", "layout": "sidebar", "palette": "berry", "theme": "light"}
    for access in ("sp", "user"):
        kept = agent_ns["implement_app_choices"]({"app_access": access, "app_look": USER_LOOK, "app_options": {"decisions": False}})[0]
        assert kept["app_options"]["decisions"] is False, "a spec that turned decisions off keeps them off"
        unset = agent_ns["implement_app_choices"]({"app_access": access, "app_look": USER_LOOK, "app_options": {"decisions": None}})[0]
        assert unset["app_options"]["decisions"] is True, "an option left unset takes its default"


def test_a_per_user_app_records_decisions_when_asked_but_never_sends_alerts(agent_ns):
    asked = {"modify": True, "replace_edits": True, "decisions": True, "alerts": True}
    choices, errors = agent_ns["implement_app_choices"]({"app_access": "user", "app_look": USER_LOOK, "app_options": asked})
    assert errors == []
    assert choices["app_options"] == {"modify": True, "replace_edits": True, "decisions": True, "alerts": False}
    assert choices["app_look"] == USER_LOOK
    shared, _ = agent_ns["implement_app_choices"]({"app_access": "sp", "app_options": asked})
    assert shared["app_options"] == asked, "a shared-view App keeps every option the user ticked"


@pytest.mark.parametrize("outputs,needle", [
    ({}, "choose who the App reads its data as: 'user'"),
    ({"app_access": "everyone"}, "not 'everyone'"),
    ({"app_access": "sp", "app_look": {"palette": "rainbow"}}, "the App palette 'rainbow' is not one Inspire offers; pick one of default, muted"),
    ({"app_access": "sp", "app_look": {"style": "z"}}, "the App style 'z' is not one Inspire offers; pick one of a, b, c"),
    ({"app_access": "sp", "app_look": {"layout": "grid"}}, "the App layout 'grid' is not one Inspire offers; pick one of sidebar, tabs, home"),
    ({"app_access": "sp", "app_look": {"theme": "sepia"}}, "the App theme 'sepia' is not one Inspire offers; pick one of light, dark"),
    ({"app_access": "sp", "app_look": {"pallete": "ocean"}}, "the App look has no setting 'pallete'; it sets only style, layout, palette, theme"),
    ({"app_access": "sp", "app_look": "dark"}, "outputs.app_look must be an object"),
    ({"app_access": "sp", "app_options": {"export": True}}, "the App has no option 'export'; its options are modify, replace_edits, decisions, alerts"),
    ({"app_access": "sp", "app_options": {"modify": "yes"}}, "the App option modify must be true or false, not 'yes'"),
    ({"app_access": "sp", "app_options": {"download": False}}, "the App has no option 'download'; its options are modify, replace_edits, decisions, alerts"),
])
def test_unknown_look_access_or_options_are_refused_with_the_reason(agent_ns, outputs, needle):
    _choices, errors = agent_ns["implement_app_choices"](outputs)
    assert any(needle in e for e in errors), errors
    with pytest.raises(agent_ns["ImplementBlocked"], match=re.escape(needle)) as raised:
        agent_ns["implement_app_settings"](1, "N01-U01 Predict churn", ["n01_u01"], None, "off", "t", outputs)
    assert str(raised.value).startswith("the App cannot be built with the look and access chosen in the wizard: ")


def test_round_50_a_missing_access_asks_for_the_choice_without_showing_an_empty_value(agent_ns):
    for outputs in ({}, {"app_access": None}, {"app_access": "  "}):
        errors = agent_ns["implement_app_choices"](outputs)[1]
        assert len(errors) == 1 and errors[0].endswith("through the App's service principal)"), (outputs, errors)
    assert agent_ns["implement_app_choices"]({"app_access": 3})[1][0].endswith("service principal), not 3")
    assert agent_ns["implement_app_choices"]({"app_access": "everyone"})[1][0].endswith("service principal), not 'everyone'")


def test_the_spec_carries_the_app_choices_and_refuses_bad_ones_before_anything_builds(agent_ns):
    spec, errors = _spec(agent_ns, outputs=_outputs(app_access="user", app_look=USER_LOOK, app_options={"modify": True, "decisions": True}))
    assert errors == []
    assert spec["outputs"]["app_access"] == "user" and spec["outputs"]["app_look"] == USER_LOOK
    assert spec["outputs"]["app_options"] == {"modify": True, "replace_edits": False, "decisions": True, "alerts": False}
    no_access = _spec(agent_ns, outputs={k: v for k, v in VALID["outputs"].items() if k != "app_access"})[1]
    assert any("choose who the App reads its data as" in e for e in no_access), no_access
    bad = _spec(agent_ns, outputs=_outputs(app_look={"palette": "rainbow"}))[1]
    assert any("the App palette 'rainbow'" in e for e in bad), bad
    off, errors = _spec(agent_ns, outputs={"dashboard": True, "app_access": "everyone", "app_look": {"palette": "rainbow"},
                                          "inspire_url": VALID["outputs"]["inspire_url"]})
    assert errors == [], "an App that is not built has no look to check"
    assert (off["outputs"]["app_access"], off["outputs"]["app_look"], off["outputs"]["app_options"]) == ("", {}, {})


def test_settings_follow_the_spec_and_pass_the_shell_check(agent_ns, tmp_path):
    _payload, modules = _app_shell(agent_ns, tmp_path)
    core = modules["shell_core"]
    page = agent_ns["implement_app_page"](_churn_page(agent_ns), "N01-U01", {}, "main.inspire.churn_out")
    settings = agent_ns["implement_app_settings"]
    outputs = {"app_access": "user", "app_look": USER_LOOK, "app_options": {"decisions": True, "modify": True}}
    mine = settings(core.SETTINGS_VERSION, "N01-U01 Predict churn", [page["id"]], None, "off", "t", outputs)
    assert (mine["style"], mine["layout"], mine["palette"], mine["theme"], mine["auth"]) == ("c", "tabs", "ocean", "dark", "user")
    assert mine["options"] == {"modify": True, "replace_edits": False, "decisions": True, "alerts": False}
    assert core.settings_problems(mine, [page]) == []
    shared = settings(core.SETTINGS_VERSION, "N01-U01 Predict churn", [page["id"]], None, "off", "t",
                      {"app_access": "sp", "app_options": {"modify": True, "decisions": True}})
    assert shared["auth"] == "sp" and shared["options"]["modify"] is True and shared["options"]["decisions"] is True
    assert "download" not in shared["options"]
    assert (shared["style"], shared["layout"], shared["palette"], shared["theme"]) == ("a", "sidebar", "default", "light")
    assert core.settings_problems(shared, [page]) == []
    with pytest.raises(agent_ns["ImplementBlocked"], match="choose who the App reads its data as"):
        settings(core.SETTINGS_VERSION, "N01-U01 Predict churn", [page["id"]], None, "off", "t")


def test_the_built_app_writes_the_wizard_choices_into_its_settings(agent_ns, tmp_path):
    inst, context, seen = _app_flow(agent_ns, tmp_path, outputs={"app_access": "user", "app_look": USER_LOOK,
                                                                 "app_options": {"modify": True, "decisions": True, "replace_edits": True}})
    inst._implement_app(context, None)
    assert seen["errors"] == []
    settings = json.loads(seen["deployed"][0][1]["inspire_app.json"])
    assert (settings["auth"], settings["style"], settings["layout"], settings["palette"], settings["theme"]) == ("user", "c", "tabs", "ocean", "dark")
    assert settings["options"] == {"modify": True, "replace_edits": True, "decisions": True, "alerts": False}


def test_a_look_or_access_change_rebuilds_the_app_and_nothing_else(agent_ns):
    validate, plan_fn = agent_ns["validate_implement_spec"], agent_ns["implement_plan"]
    before = validate(VALID)[0]
    assets = {"dashboard": "d1", "genie_space": "g1", "app": "churn-desk", "preview_run_id": 7}
    for change in ({"app_look": {"palette": "ocean"}}, {"app_access": "user"}, {"app_options": {"decisions": False}}):
        after = validate(dict(VALID, outputs=_outputs(**change)))[0]
        assert agent_ns["classify_implement_change"](before, after) == ["outputs"], change
        plan = plan_fn(before, after, assets, has_built_notebook=True)
        assert plan["refresh"] == ["app"] and plan["build"] == [] and plan["refill"] is False, change
    same = validate(dict(VALID, outputs=_outputs(app_look={"palette": "default"})))[0]
    assert agent_ns["classify_implement_change"](before, same) == [], "spelling out a default is no change"


def test_the_notebook_shell_and_web_name_the_same_looks_options_and_per_user_limits(agent_ns):
    choices = agent_ns["IMPLEMENT_APP_LOOK_CHOICES"]
    assert choices["style"] == shell_core.STYLES and choices["layout"] == shell_core.LAYOUTS
    assert choices["theme"] == shell_core.THEMES and choices["palette"] == shell_core.PALETTES
    assert agent_ns["IMPLEMENT_APP_ACCESS"] == shell_core.AUTHS
    assert tuple(agent_ns["IMPLEMENT_APP_OPTIONS"]) == shell_core.OPTIONS
    assert agent_ns["IMPLEMENT_APP_USER_OFF"] == shell_core.USER_OFF
    with open(os.path.join(WEB, "palettes.json"), encoding="utf-8") as handle:
        assert sorted(json.load(handle)) == sorted(shell_core.PALETTES)
    with open(os.path.join(WEB, "theme.js"), encoding="utf-8") as handle:
        order = re.search(r"PALETTE_ORDER = \[([^\]]+)\]", handle.read()).group(1)
    assert tuple(re.findall(r"'([a-z]+)'", order)) == shell_core.PALETTES
    assert agent_ns["IMPLEMENT_APP_LOOK"] == {"style": "a", "layout": "sidebar", "palette": "default", "theme": "light"}


def test_scopes_are_read_only_sql_and_genie_and_full_sql_only_when_people_edit_data(agent_ns):
    scopes = agent_ns["implement_app_user_scopes"]
    assert scopes({"app_access": "sp", "app_options": {"modify": True}}) == []
    assert scopes({"app_access": "user", "app_options": {"modify": False}}) == ["sql:restricted-query", "genie"]
    assert scopes({"app_access": "user", "app_options": {"modify": True}}) == ["sql", "genie"]
    assert scopes({}) == [] and scopes(None) == []


def _user_context(agent_ns, context, **options):
    context["spec"] = _spec(agent_ns, outputs=_outputs(app_access="user", app_options=options))[0]
    return context


NEW_APP = [RuntimeError("RESOURCE_DOES_NOT_EXIST: app churn-desk")]
DEPLOYED = [{"deployment_id": "dep1", "status": {"state": "SUCCEEDED"}}, {"url": "https://churn-desk.example/"}]


def test_a_per_user_app_is_created_with_its_scopes_and_its_service_principal_reads_nothing(agent_ns, sdk_stub):
    created = {"compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-1"}
    read = dict(created, user_api_scopes=["sql:restricted-query", "genie"])
    inst, context, calls, _imported = _deploy_inspire(agent_ns, NEW_APP + [created, read] + DEPLOYED, access=[])
    fields = inst._implement_deploy_app(_user_context(agent_ns, context, decisions=False), "churn-desk", SHELL_FILES, READS, "g1", poll_s=0)
    assert fields["app_url"] == "https://churn-desk.example"
    assert len(fields["_warnings"]) == 1 and _feedback_refused(fields["_warnings"]) == fields["_warnings"], \
        "Inspire holds nothing here, so the only gap is the feedback table it cannot grant"
    assert [c[:2] for c in calls] == [("GET", "/api/2.0/apps/churn-desk"), ("POST", "/api/2.0/apps"), ("GET", "/api/2.0/apps/churn-desk"),
                                      ("POST", "/api/2.0/apps/churn-desk/deployments"), ("GET", "/api/2.0/apps/churn-desk")]
    assert calls[1][2]["user_api_scopes"] == ["sql:restricted-query", "genie"]
    assert _without_feedback(_not_access_reads(inst.spark.statements)) == [s for s in inst.spark.statements if VALUE_LEDGER in s
                                                                              and s.startswith("CREATE TABLE")], \
        "each viewer reads with their own grants, so the App's identity gets none beyond the feedback table (the job identity creates the value ledger)"
    assert [s for s in inst.spark.statements if VALUE_LEDGER in s and s.startswith("GRANT")] == []
    assert inst.genie_grants == []


def test_a_per_user_app_where_people_edit_data_asks_for_full_sql(agent_ns, sdk_stub):
    created = {"compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-1"}
    inst, context, calls, _imported = _deploy_inspire(agent_ns, NEW_APP + [created, dict(created, user_api_scopes=["sql", "genie"])] + DEPLOYED)
    inst._implement_deploy_app(_user_context(agent_ns, context, modify=True), "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert calls[1][2]["user_api_scopes"] == ["sql", "genie"]


def test_a_shared_view_app_asks_for_no_user_scopes(agent_ns, sdk_stub):
    created = {"compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-1"}
    inst, context, calls, _imported = _deploy_inspire(agent_ns, NEW_APP + [created] + DEPLOYED)
    inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, "g1", poll_s=0)
    assert "user_api_scopes" not in calls[1][2] and [c[0] for c in calls].count("PATCH") == 0
    assert GRANT_SELECT.format("sp-1") in _not_access_reads(inst.spark.statements)
    assert inst.genie_grants == [("genie", "g1", [{"type": "service_principal", "name": "sp-1"}], "CAN_RUN")]


def test_an_existing_app_switched_to_per_user_gets_its_scopes_before_it_deploys(agent_ns, sdk_stub):
    existing = {"description": OURS_APP, "compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-2",
                "resources": [{"name": "sql-warehouse", "sql_warehouse": {"id": "wh1", "permission": "CAN_USE"}}]}
    patched = dict(existing, user_api_scopes=["genie", "sql:restricted-query"])
    inst, context, calls, _imported = _deploy_inspire(agent_ns, [existing, patched] + DEPLOYED)
    fields = inst._implement_deploy_app(_user_context(agent_ns, context), "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert "_warnings" not in fields
    assert [c[:2] for c in calls][:3] == [("GET", "/api/2.0/apps/churn-desk"), ("PATCH", "/api/2.0/apps/churn-desk"),
                                          ("POST", "/api/2.0/apps/churn-desk/deployments")]
    assert calls[1][2] == {"name": "churn-desk", "description": OURS_APP, "resources": existing["resources"],
                           "user_api_scopes": ["sql:restricted-query", "genie"]}, "the update keeps the App's warehouse"


def test_an_existing_app_switched_back_to_a_shared_view_drops_its_scopes(agent_ns, sdk_stub):
    existing = {"description": OURS_APP, "compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-2",
                "user_api_scopes": ["sql:restricted-query", "genie"]}
    cleared = {k: v for k, v in existing.items() if k != "user_api_scopes"}
    inst, context, calls, _imported = _deploy_inspire(agent_ns, [existing, cleared] + DEPLOYED)
    fields = inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert "_warnings" not in fields and calls[1][:2] == ("PATCH", "/api/2.0/apps/churn-desk") and calls[1][2]["user_api_scopes"] == []
    left = dict(existing)
    inst, context, calls, _imported = _deploy_inspire(agent_ns, [existing, left] + DEPLOYED)
    fields = inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert fields["_warnings"][0].startswith("App: churn-desk reads data as its service principal now, but Inspire could not remove the "
                                             "user authorization scopes genie, sql:restricted-query it held before")


@pytest.mark.parametrize("patch_answer,needle,undo", [
    (RuntimeError("INVALID_PARAMETER_VALUE: scope sql:restricted-query is not allowed in this workspace"),
     "could not give it the user authorization scopes sql:restricted-query, genie: INVALID_PARAMETER_VALUE: scope sql:restricted-query", []),
    ({"description": OURS_APP, "compute_status": {"state": "ACTIVE"}, "user_api_scopes": ["genie"]},
     "could not give it the user authorization scopes sql:restricted-query, genie (it holds genie)",
     [{"description": OURS_APP, "compute_status": {"state": "ACTIVE"}}]),
])
def test_scopes_the_workspace_will_not_give_block_a_per_user_app(agent_ns, sdk_stub, patch_answer, needle, undo):
    existing = {"description": OURS_APP, "compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-2"}
    now = dict(existing, user_api_scopes=["genie"]) if undo else existing
    inst, context, calls, imported = _deploy_inspire(agent_ns, [existing, patch_answer, now] + undo)
    inst.logger = CapturingLogger()
    with pytest.raises(agent_ns["ImplementBlocked"], match=re.escape(needle)) as raised:
        inst._implement_deploy_app(_user_context(agent_ns, context), "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert "ask them to allow these scopes, or choose a shared view for the App" in str(raised.value)
    assert imported == [], "the App's files are not changed when it cannot act as its viewers"
    assert not any(c[1].endswith("/deployments") for c in calls), "nothing deploys when the App cannot act as its viewers"
    assert [c[0] for c in calls] == ["GET", "PATCH", "GET"] + ["PATCH"] * len(undo)
    undone = [m for lvl, m in inst.logger.records if m.startswith("[IMPLEMENT-UNDO]")]
    if undo:
        assert calls[-1][2]["user_api_scopes"] == []
        assert undone == ["[IMPLEMENT-UNDO] N01-U01: the App build failed after Inspire had saved changes, so Inspire gave the App "
                          f"churn-desk back its user authorization scopes (none): {str(raised.value)[:300]}"]
    else:
        assert undone == [], "a refused scope change leaves nothing to undo"


def test_scopes_that_cannot_be_given_back_stop_the_build_and_say_so(agent_ns, sdk_stub):
    existing = {"description": OURS_APP, "compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-2"}
    held = dict(existing, user_api_scopes=["genie"])
    inst, context, calls, imported = _deploy_inspire(agent_ns, [existing, held, held, RuntimeError("PERMISSION_DENIED: no CAN MANAGE")])
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        inst._implement_deploy_app(_user_context(agent_ns, context), "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert str(raised.value).startswith("the App build failed after Inspire had saved changes (the App churn-desk shows each person only")
    assert str(raised.value).endswith("and Inspire could not undo them: the App churn-desk still holds the user authorization scopes "
                                      "genie; before this build it held none: PERMISSION_DENIED: no CAN MANAGE")
    assert imported == [] and not any(c[1].endswith("/deployments") for c in calls)


class _Apps:
    def __init__(self, inst, app=None, starting_reads=2):
        self.inst, self.app, self.reads, self.calls = inst, copy.deepcopy(app), starting_reads, []

    def state(self):
        return ((self.app or {}).get("compute_status") or {}).get("state")

    def refused(self, verb):
        return RuntimeError(f"INVALID_PARAMETER_VALUE: Cannot {verb} app churn-desk as its compute is in {self.state()} state. "
                            f"App compute needs to be ACTIVE or STOPPED to {verb}.")

    def __call__(self, method, path, body=None, query=None):
        if (method, path) == ("POST", "/api/2.0/workspace/import"):
            self.inst.uploads[body["path"]] = (base64.b64decode(body["content"]).decode("utf-8"), body["overwrite"])
            return {}
        self.calls.append((method, path, self.state(), body))
        if (method, path) == ("GET", "/api/2.0/apps/churn-desk"):
            if self.app is None:
                raise RuntimeError("RESOURCE_DOES_NOT_EXIST: app churn-desk")
            seen = copy.deepcopy(self.app)
            if self.state() == "STARTING":
                self.reads -= 1
                if self.reads <= 0:
                    self.app["compute_status"] = {"state": "ACTIVE"}
            return seen
        if (method, path) == ("POST", "/api/2.0/apps"):
            self.app = {"name": body["name"], "description": body["description"], "resources": body.get("resources") or [],
                        "user_api_scopes": body.get("user_api_scopes"), "compute_status": {"state": "STARTING"},
                        "service_principal_client_id": "sp-1", "url": "https://churn-desk.example/"}
            return {k: v for k, v in self.app.items() if k != "user_api_scopes"}
        if (method, path) == ("PATCH", "/api/2.0/apps/churn-desk"):
            if self.state() not in ("ACTIVE", "STOPPED"):
                raise self.refused("update")
            self.app.update(resources=body["resources"], user_api_scopes=body["user_api_scopes"])
            return copy.deepcopy(self.app)
        if (method, path) == ("POST", "/api/2.0/apps/churn-desk/stop"):
            if self.state() not in ("ACTIVE", "STOPPED"):
                raise self.refused("stop")
            self.app["compute_status"] = {"state": "STOPPED"}
            return {}
        if (method, path) == ("POST", "/api/2.0/apps/churn-desk/deployments"):
            return {"deployment_id": "dep1", "status": {"state": "SUCCEEDED"}}
        raise AssertionError(f"unexpected call {method} {path}")


def _apps_inspire(agent_ns, app=None, starting_reads=2):
    inst, context, _calls, _imported = _deploy_inspire(agent_ns, [])
    inst.logger = CapturingLogger()
    fake = _Apps(inst, app, starting_reads)
    inst._implement_api = fake
    return inst, context, fake


def test_a_new_per_user_app_is_read_back_because_the_create_answer_leaves_out_its_scopes(agent_ns, sdk_stub):
    inst, context, fake = _apps_inspire(agent_ns)
    fields = inst._implement_deploy_app(_user_context(agent_ns, context), "churn-desk", SHELL_FILES, READS, "g1", poll_s=0)
    assert fields["app_url"] == "https://churn-desk.example" and "_warnings" not in fields
    assert [c[:2] for c in fake.calls][:3] == [("GET", "/api/2.0/apps/churn-desk"), ("POST", "/api/2.0/apps"),
                                              ("GET", "/api/2.0/apps/churn-desk")]
    assert not any(c[0] == "PATCH" for c in fake.calls), "the App already holds the scopes it was created with"
    assert fake.app["user_api_scopes"] == ["sql:restricted-query", "genie"]


def test_an_existing_app_that_is_still_starting_gets_its_scopes_once_its_compute_settles(agent_ns, sdk_stub):
    existing = {"description": OURS_APP, "compute_status": {"state": "STARTING"}, "service_principal_client_id": "sp-2",
                "resources": [{"name": "sql-warehouse", "sql_warehouse": {"id": "wh1", "permission": "CAN_USE"}}],
                "url": "https://churn-desk.example/"}
    inst, context, fake = _apps_inspire(agent_ns, existing, starting_reads=3)
    fields = inst._implement_deploy_app(_user_context(agent_ns, context), "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert "_warnings" not in fields
    patches = [c for c in fake.calls if c[0] == "PATCH"]
    assert len(patches) == 1 and patches[0][2] == "ACTIVE", "the scopes change waits until the compute can take an update"
    assert patches[0][3]["resources"] == existing["resources"] and fake.app["user_api_scopes"] == ["sql:restricted-query", "genie"]


def test_a_new_app_that_fails_while_it_starts_is_stopped_once_its_compute_settles(agent_ns, sdk_stub):
    inst, context, fake = _apps_inspire(agent_ns)
    inst._implement_tag_app = lambda context, app_name: (_ for _ in ()).throw(RuntimeError("PERMISSION_DENIED: cannot tag"))
    with pytest.raises(RuntimeError, match="cannot tag") as raised:
        inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert "could not undo" not in str(raised.value)
    assert fake.calls[-1][:3] == ("POST", "/api/2.0/apps/churn-desk/stop", "ACTIVE") and fake.state() == "STOPPED"
    assert [m for _lvl, m in inst.logger.records if m.startswith("[IMPLEMENT-UNDO]")][0].startswith(
        "[IMPLEMENT-UNDO] N01-U01: the App build failed after Inspire had saved changes, so Inspire stopped the new App churn-desk")


def test_an_app_that_stays_starting_past_the_wait_blocks_with_the_reason_and_no_scope_advice(agent_ns, sdk_stub):
    inst, _context, fake = _apps_inspire(agent_ns, {"description": OURS_APP, "compute_status": {"state": "STARTING"}}, starting_reads=99)
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        inst._implement_app_settled("churn-desk", fake.app, 0, 0)
    assert str(raised.value) == ("the App churn-desk was still starting after 1 minute, so Inspire could not change it; build again once "
                                 "it is running or stopped")
    assert inst._implement_app_settled("churn-desk", {"compute_status": {"state": "ERROR"}}, 0, 0) == {"compute_status": {"state": "ERROR"}}
    assert agent_ns["IMPLEMENT_APP_COMPUTE_SETTLING"] == ("STARTING", "STOPPING", "UPDATING")


def test_sharing_a_per_user_app_lets_people_use_the_warehouse(agent_ns):
    inst = _inspire(agent_ns, _access_spark(INSPIRE_OWNS))
    inst._implement_api = lambda method, path, body=None, query=None: {"description": OURS_APP}
    inst._implement_emit = lambda *a, **k: None
    grants = []
    inst._implement_grant = lambda kind, object_id, principals, level: grants.append((kind, object_id, level))
    principals = {"principals": [{"type": "group", "name": "planners"}]}
    per_user = dict(_spec(agent_ns, outputs={"app": True, "app_name": "churn-desk", "app_access": "user"})[0], sharing=principals)
    inst._implement_share("N01-U01", "main.inspire.churn_out", per_user, {"app": "churn-desk"}, None)
    assert ("sql/warehouses", "wh1", "CAN_USE") in grants and ("apps", "churn-desk", "CAN_USE") in grants
    grants.clear()
    shared = dict(_spec(agent_ns, outputs={"app": True, "app_name": "churn-desk", "app_access": "sp"})[0], sharing=principals)
    inst._implement_share("N01-U01", "main.inspire.churn_out", shared, {"app": "churn-desk"}, None)
    assert [g for g in grants if g[0] == "sql/warehouses"] == [], "a shared-view App reads with its own identity"


def test_the_shell_server_offers_decisions_and_has_no_download_for_a_per_user_app(tmp_path):
    user = dict(SETTINGS, auth="user")
    s, _sp, _user, _made = shell(tmp_path, user)
    headers = {"x-forwarded-access-token": "tok", "x-forwarded-email": "viewer-a"}
    status, out = call(s, "POST", "download", headers=headers, body={"page": "n01_u05", "kind": "records"})
    assert status == 404 and out == {"error": "no API route POST /api/download"}
    status, info = call(s, "GET", "app", headers=headers)
    assert "download" not in info["options"] and info["options"]["decisions"] is False and info["image_export"] is False
    s.settings["options"] = dict(s.settings["options"], decisions=True, alerts=True)
    assert s.option("decisions") is True and s.option("alerts") is False
    good = dict(user, options=dict(SETTINGS["options"], decisions=True))
    assert not any("decisions" in p for p in shell_core.settings_problems(good, [PAGE]))
    bad = dict(user, options=dict(SETTINGS["options"], alerts=True))
    assert any("cannot send alerts" in p for p in shell_core.settings_problems(bad, [PAGE]))


def test_the_shell_server_offers_decisions_only_when_the_option_is_on(tmp_path):
    s, _sp, _user, _made = shell(tmp_path)
    assert call(s, "GET", "app")[1]["options"]["decisions"] is False
    (tmp_path / "on").mkdir()
    on, _sp, _user, _made = shell(tmp_path / "on", dict(SETTINGS, options=dict(SETTINGS["options"], decisions=True)))
    info = call(on, "GET", "app")[1]
    assert info["options"]["decisions"] is True and "download" not in info["options"] and info["image_export"] is True


VALUE_LEDGER = "`main`.`inspire`.`__inspire_value_ledger`"


def test_a_per_user_build_grants_the_value_ledger_to_no_service_principal_and_a_shared_build_does(agent_ns, sdk_stub):
    created = {"compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-1"}
    inst, context, _calls, _imported = _deploy_inspire(agent_ns, NEW_APP + [created, dict(created, user_api_scopes=["sql:restricted-query", "genie"])] + DEPLOYED,
                                                       access=[])
    inst._implement_deploy_app(_user_context(agent_ns, context, decisions=False), "churn-desk", SHELL_FILES, READS, "g1", poll_s=0)
    created_ledger = [s for s in inst.spark.statements if VALUE_LEDGER in s and s.startswith("CREATE TABLE")]
    assert len(created_ledger) == 1, "the job identity creates Inspire's own value ledger for a per-user App too"
    assert [s for s in inst.spark.statements if VALUE_LEDGER in s and s.startswith("GRANT")] == [], (
        "a per-user App works as the signed-in person, so the build grants the value ledger to no service principal")

    inst, context, _calls, _imported = _deploy_inspire(agent_ns, NEW_APP + [created] + DEPLOYED)
    context["spec"]["outputs"]["app_options"]["decisions"] = False
    inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert [s for s in inst.spark.statements if VALUE_LEDGER in s and s.startswith("CREATE TABLE")], "the shared build creates the ledger too"
    assert {s for s in inst.spark.statements if VALUE_LEDGER in s and s.startswith("GRANT")} == {
        f"GRANT SELECT ON TABLE {VALUE_LEDGER} TO `sp-1`", f"GRANT MODIFY ON TABLE {VALUE_LEDGER} TO `sp-1`"}, (
        "a shared App's principal writes the value ledger, so the build grants it SELECT and MODIFY on that table only")
