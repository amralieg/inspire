"""Merge a use case into an existing Inspire App, dashboard or Genie Agent, keep the host's settings, and change only an App's look
without Genie, offline."""
import json

import pytest

from v120_artifacts_support import FakeSpark
from v142_genie_test import COLUMNS as GENIE_COLUMNS, _definition, _rich_space
from v140_implement_test import (FIXTURE, OURS_APP, READS, SHELL_FILES, TRUTH, VALID, _app_flow, _app_shell, _churn_page, _contract, _dashboard,
                                 _deploy_inspire, _FileRunner, _inspire, _left_by, _NB_SPEC, _not_access_reads, _output_context,
                                 _without_feedback,
                                 _output_inspire, _space, _spec, _without_requirements, sdk_stub)
from v142_look_test import DEPLOYED, VALUE_LEDGER

HOST_UC = "N01-U07"
SOURCE = "/Workspace/Users/someone/sales/apps/sales-desk"
OWN_SOURCE = "/W/acme_implemented/Sales/apps/churn-desk"
HOST_APP = {"name": "sales-desk", "description": "Inspire use case N01-U07 (session 777): Sales desk", "url": "https://sales-desk.example/",
            "active_deployment": {"source_code_path": SOURCE}, "compute_status": {"state": "ACTIVE"},
            "service_principal_client_id": "sp-7"}
HOST_BOARD = {"datasets": [{"name": "sales", "queryLines": ["SELECT * FROM main.inspire.sales_out"]}],
              "pages": [{"name": "home", "displayName": "Sales", "layout": [
                  {"widget": {"name": "w1", "queries": [{"name": "q", "query": {"datasetName": "sales"}}]},
                   "position": {"x": 0, "y": 0, "width": 6, "height": 4}}]},
                  {"name": "filters", "displayName": "Filters", "pageType": "PAGE_TYPE_GLOBAL_FILTERS", "layout": [
                      {"widget": {"name": "gf", "queries": [{"name": "q", "query": {"datasetName": "sales"}}]},
                       "position": {"x": 0, "y": 0, "width": 2, "height": 3}}]}]}
DASH = {"dashboard_id": "dA", "display_name": "Sales board", "serialized_dashboard": json.dumps(HOST_BOARD), "etag": "e1",
        "warehouse_id": "whA", "lifecycle_state": "ACTIVE"}


def _blocked(ns):
    return ns["ImplementBlocked"]


def _host_page(ns, uc_id=HOST_UC, title="Sales desk"):
    page = _churn_page(ns, title=title)
    for dataset in page["datasets"]:
        dataset["sql"] = dataset["sql"].replace("main.inspire.churn_out", "main.inspire.sales_out").replace("main.s.orders", "main.s.stores")
    return ns["implement_app_page"](page, uc_id, {})


def _host_files(ns, tmp_path, source=SOURCE, pages=None, title="N01-U07 Sales desk", genie="gA", **settings_changes):
    core = _app_shell(ns, tmp_path)[1]["shell_core"]
    pages = pages if pages is not None else [_host_page(ns)]
    settings = ns["implement_app_settings"](core.SETTINGS_VERSION, title, [p["id"] for p in pages],
                                            {"space_id": genie, "title": "Sales questions"} if genie else None, "Ask Genie is off",
                                            "2026-10-01T00:00:00Z", {"app_access": "sp"})
    settings.update({"style": "b", "layout": "tabs", "palette": "ocean", "theme": "dark", **settings_changes})
    files = {f"{source}/inspire_app.json": json.dumps(settings)}
    files.update({f"{source}/pages/{p['id']}.json": json.dumps(p) for p in pages})
    return files


def _serve_files(ns, monkeypatch, files):
    read = []

    def reader(path, w_client=None):
        read.append(path)
        if path not in files:
            raise RuntimeError(f"RESOURCE_DOES_NOT_EXIST: {path} does not exist")
        return files[path]

    monkeypatch.setitem(ns, "read_user_text_file", reader)
    return read


def _router(routes):
    calls = []

    def api(method, path, body=None, query=None):
        calls.append((method, path, body, query))
        answer = routes.get((method, path))
        if isinstance(answer, list):
            answer = answer.pop(0) if len(answer) > 1 else answer[0]
        if isinstance(answer, Exception):
            raise answer
        if answer is None:
            raise AssertionError(f"unexpected call {method} {path}")
        return answer

    return api, calls


def _merge_flow(ns, tmp_path, monkeypatch, app=HOST_APP, files=None, outputs=None, assets=None, routes=None, **stubs):
    work = tmp_path / f"flow{len(list(tmp_path.glob('flow*')))}"
    inst, context, seen = _app_flow(ns, work, outputs={"merge": {"app": "sales-desk"}, **(outputs or {})},
                                    assets={"genie_space": "gA"} if assets is None else assets, **stubs)
    del inst._implement_app_host
    _serve_files(ns, monkeypatch, _host_files(ns, tmp_path) if files is None else files)
    apps = {("GET", "/api/2.0/apps/sales-desk"): RuntimeError("RESOURCE_DOES_NOT_EXIST: app sales-desk") if app is None else app}
    inst._implement_api, calls = _router({**apps, **(routes or {})})
    inst.work = work / "work"
    inst._implement_notebook_paths = lambda uc, key: ("/W/acme_implemented/Sales", "/W/acme_implemented/Sales/N01-U01")
    return inst, context, seen, calls


def _straight_loop(inst):
    inst._implement_genie_loop = lambda context, runner, label, prompt, deploy, tools=None: deploy(str(inst.work))


def test_merge_targets_access_and_look_normalize_and_bad_ones_are_rejected(agent_ns):
    spec, errors = _spec(agent_ns, outputs={**VALID["outputs"], "merge": {"app": " Sales-Desk ", "dashboard": "dA", "genie_space": "gA"},
                                            "app_access": "USER", "app_look": {"layout": "tabs", "palette": "ocean"}})
    assert errors == []
    out = spec["outputs"]
    assert out["merge"] == {"dashboard": "dA", "genie_space": "gA", "app": "sales-desk"} and out["app_name"] == "sales-desk"
    assert out["app_access"] == "user" and out["app_look"] == {"style": "a", "layout": "tabs", "theme": "light", "palette": "ocean"}
    off = _spec(agent_ns, outputs={"dashboard": False, "app": False, "merge": {"dashboard": "dA", "app": "sales-desk"},
                                   "app_look": {"layout": "grid"}, "app_access": "everyone"})
    assert off[1] == [] and off[0]["outputs"]["merge"] == {"dashboard": "", "genie_space": "", "app": ""}, \
        "an unticked output merges into nothing and its App choices are not checked"
    assert off[0]["outputs"]["app_access"] == "" and off[0]["outputs"]["app_look"] == {}
    for changes, needle in (({"merge": {"alert": "x"}}, "outputs.merge.alert is not one of dashboard, genie_space, app"),
                            ({"merge": {"dashboard": "a/b?c"}}, "outputs.merge.dashboard 'a/b?c' must name an existing Inspire dashboard"),
                            ({"merge": {"genie_space": "x" * 65}}, "must name an existing Inspire Genie Agent"),
                            ({"merge": {"app": "Bad_App"}}, "outputs.merge.app 'Bad_App' must name an existing Inspire App"),
                            ({"merge": "sales-desk"}, "outputs.merge must be an object"),
                            ({"app_access": "everyone"}, "choose who the App reads its data as"),
                            ({"app_look": {"layout": "grid"}}, "the App layout 'grid' is not one Inspire offers; pick one of sidebar, tabs, home")):
        errors = _spec(agent_ns, outputs={**VALID["outputs"], **changes})[1]
        assert any(needle in e for e in errors), (changes, errors)


def test_round_50_a_merge_target_that_is_not_text_is_refused_even_when_it_reads_as_an_id(agent_ns):
    for name, label in (("dashboard", "dashboard"), ("genie_space", "Genie Agent"), ("app", "App")):
        for value in (5, True, ["dA"]):
            errors = _spec(agent_ns, outputs={**VALID["outputs"], "merge": {name: value}})[1]
            assert f'outputs.merge.{name} must be text: the {label} to add to, or "" for a new one' in errors, (name, value, errors)
    spec, errors = _spec(agent_ns, outputs={**VALID["outputs"], "merge": {"dashboard": None, "app": ""}})
    assert errors == [] and spec["outputs"]["merge"] == {"dashboard": "", "genie_space": "", "app": ""}


def test_the_look_and_access_choices_and_the_owner_tag_match_the_app_shell_and_the_shared_fixture(agent_ns, tmp_path):
    core = _app_shell(agent_ns, tmp_path)[1]["shell_core"]
    choices = agent_ns["IMPLEMENT_APP_LOOK_CHOICES"]
    assert (choices["style"], choices["layout"], choices["theme"], choices["palette"]) == (core.STYLES, core.LAYOUTS, core.THEMES,
                                                                                            core.PALETTES)
    assert agent_ns["IMPLEMENT_APP_ACCESS"] == core.AUTHS
    for case in json.load(open(FIXTURE))["app_owner_tags"]:
        assert agent_ns["implement_app_owner"]({"description": case["tag"] + ": x"}) == (case["use_case_id"], case["session_id"])
    inst = _inspire(agent_ns, FakeSpark())
    assert inst._implement_owns_app(None, {"description": OURS_APP.replace("N01-U01", "N09-U02")}) is True
    assert inst._implement_owns_app("N01-U01", {"description": OURS_APP.replace("N01-U01", "N09-U02")}) is False
    for description in ("Finance team tool", "Built for Inspire use case N01-U01 (session 5150)", ""):
        assert inst._implement_owns_app(None, {"description": description}) is False, description
    assert inst._implement_owns_app(None, None) is False


def test_a_new_merge_target_builds_that_output_and_a_look_only_edit_restyles_the_app(agent_ns):
    validate, plan_fn = agent_ns["validate_implement_spec"], agent_ns["implement_plan"]
    assets = {"dashboard": "d1", "genie_space": "g1", "app": "churn-desk", "preview_run_id": 5}
    before = validate(VALID)[0]
    moved = validate(dict(VALID, outputs={**VALID["outputs"], "merge": {"dashboard": "dA"}}))[0]
    plan = plan_fn(before, moved, assets, has_built_notebook=True)
    assert plan["classes"] == ["outputs"] and plan["build"] == ["dashboard"] and plan["refresh"] == [] and plan["restyle"] == []
    assert agent_ns["classify_implement_change"](moved, moved) == []
    look = validate(dict(VALID, outputs={**VALID["outputs"], "app_look": {"layout": "tabs"}}))[0]
    plan = plan_fn(before, look, assets, has_built_notebook=True)
    assert plan["classes"] == ["outputs"] and plan["refresh"] == ["app"] and plan["restyle"] == ["app"] and not plan["refill"]
    for name, current, refill in (
            ("purpose too", dict(VALID, outputs={**VALID["outputs"], "app_look": {"layout": "tabs"}, "app_purpose": "x"}), True),
            ("access too", dict(VALID, outputs={**VALID["outputs"], "app_look": {"layout": "tabs"}, "app_access": "user"}), True),
            ("data too", dict(VALID, outputs={**VALID["outputs"], "app_look": {"layout": "tabs"}},
                              data=dict(VALID["data"], run_profile="full")), True),
            ("retried", dict(VALID, outputs={**VALID["outputs"], "app_look": {"layout": "tabs"}}, retry_outputs=["app"]), True),
            ("lost notebook", dict(VALID, outputs={**VALID["outputs"], "app_look": {"layout": "tabs"}}), False)):
        plan = plan_fn(before, validate(current)[0], assets, has_built_notebook=refill)
        assert "app" in plan["refresh"] + plan["build"] and plan["restyle"] == [], name


def _own_genie_route(space_id, question="Which customers act now?"):
    return {("GET", f"/api/2.0/genie/spaces/{space_id}"): _genie_answer(space_id, _genie_body(["main.inspire.churn_out"], question, "t"))}


def test_a_merged_app_adds_this_page_keeps_the_other_pages_and_the_hosts_access_and_look(agent_ns, tmp_path, monkeypatch):
    inst, context, seen, calls = _merge_flow(agent_ns, tmp_path, monkeypatch, routes=_own_genie_route("gA"))
    fields = inst._implement_app(context, None)
    assert seen["errors"] == []
    name, files, reads, space_id = seen["deployed"][0]
    settings = json.loads(files["inspire_app.json"])
    assert name == "sales-desk" and settings["pages"] == ["n01_u07", "n01_u01_s5150"], \
        "another session's use case gets a page id of its own, so it never replaces a page of the same id"
    assert (settings["style"], settings["layout"], settings["palette"], settings["theme"], settings["auth"]) == ("b", "tabs", "ocean",
                                                                                                                  "dark", "sp")
    assert settings["title"] == "N01-U07 Sales desk" and settings["genie"] == {"space_id": "gA", "title": "Sales questions"}
    assert json.loads(files["pages/n01_u07.json"]) == _host_page(agent_ns), "the host's page is deployed unchanged"
    ours = json.loads(files["pages/n01_u01_s5150.json"])
    assert ours["use_case_id"] == "N01-U01" and ours["title"] == "Price-loss decision desk"
    assert seen["checked"] == [(_without_requirements(files), "wh1")], "one App check runs over every page before the deploy"
    assert files["requirements.txt"] == ""
    assert {"main.inspire.sales_out", "main.s.stores", "main.inspire.churn_out", "main.s.orders"} <= set(reads)
    assert space_id == "gA"
    note = "App: this page uses the style, layout, palette and mode of the App sales-desk"
    assert fields["_notes"] == [note] and fields["_asset"] == {"merged_into": "sales-desk", "page": "n01_u01_s5150"}
    assert "_warnings" not in fields, "the host's own look is a fact of the join, never a warning"
    assert ours["genie"]["space_id"] == "gA" and ours["genie_note"] == "", "the joining page names its own Genie Agent"
    assert ("INFO", "[IMPLEMENT-APP-MERGE] N01-U01: " + note) in inst.logger.records
    assert not [m for level, m in inst.logger.records if level == "WARNING" and "IMPLEMENT-APP-MERGE" in m]
    assert [c[:2] for c in calls] == [("GET", "/api/2.0/apps/sales-desk"), ("GET", "/api/2.0/genie/spaces/gA"),
                                      ("GET", "/api/2.1/unity-catalog/tables")], \
        "a Delta App reads its own Genie Agent's sample questions and only looks for Lakebase copies left in its schema, and finds none"
    assert ours["questions"] == ["Which customers act now?"], \
        "Ask Genie suggests only the Genie Agent's sample questions whose example SQL returns rows"


def test_merging_again_replaces_only_this_use_cases_page_in_place(agent_ns, tmp_path, monkeypatch):
    old = dict(_host_page(agent_ns, "N01-U01", "Old churn page"), id="n01_u01_s5150")
    third = _host_page(agent_ns, "N02-U03", "Stock desk")
    files = _host_files(agent_ns, tmp_path, pages=[_host_page(agent_ns), old, third])
    inst, context, seen, _calls = _merge_flow(agent_ns, tmp_path, monkeypatch, files=files)
    inst._implement_app(context, None)
    files = seen["deployed"][0][1]
    assert json.loads(files["inspire_app.json"])["pages"] == ["n01_u07", "n01_u01_s5150", "n02_u03"]
    assert json.loads(files["pages/n01_u01_s5150.json"])["title"] == "Price-loss decision desk"
    assert json.loads(files["pages/n02_u03.json"]) == third


def test_a_use_case_of_the_hosts_own_session_keeps_its_plain_page_id(agent_ns, tmp_path, monkeypatch):
    app = dict(HOST_APP, description="Inspire use case N01-U07 (session 5150): Sales desk")
    inst, context, seen, _calls = _merge_flow(agent_ns, tmp_path, monkeypatch, app=app)
    fields = inst._implement_app(context, None)
    assert json.loads(seen["deployed"][0][1]["inspire_app.json"])["pages"] == ["n01_u07", "n01_u01"]
    assert fields["_notes"] == ["App: this page uses the style, layout, palette and mode of the App sales-desk"] and "_warnings" not in fields


@pytest.mark.parametrize("app,needle", [
    (dict(HOST_APP, description="Finance team tool"), "the App sales-desk you chose to add this use case to was not built by Inspire, so "
                                                      "Inspire does not change it; pick another Inspire App or build a new App"),
    (None, "the App sales-desk you chose to add this use case to no longer exists"),
])
def test_an_app_that_is_not_inspires_is_never_a_merge_target(agent_ns, tmp_path, monkeypatch, app, needle):
    inst, context, seen, calls = _merge_flow(agent_ns, tmp_path, monkeypatch, app=app)
    with pytest.raises(_blocked(agent_ns), match=needle):
        inst._implement_app(context, None)
    assert "label" not in seen and seen["deployed"] == [], "Genie is never asked for a page of an App Inspire may not change"
    assert [c[:2] for c in calls] == [("GET", "/api/2.0/apps/sales-desk")]


def test_a_merge_target_whose_pages_cannot_be_read_or_do_not_hold_together_is_refused(agent_ns, tmp_path, monkeypatch):
    inst, context, seen, _calls = _merge_flow(agent_ns, tmp_path, monkeypatch, files={})
    with pytest.raises(_blocked(agent_ns), match=f"the pages of the App sales-desk could not be read from {SOURCE}"):
        inst._implement_app(context, None)
    broken = _host_files(agent_ns, tmp_path, layout="grid")
    inst, context, seen, _calls = _merge_flow(agent_ns, tmp_path, monkeypatch, files=broken)
    with pytest.raises(_blocked(agent_ns), match="the App sales-desk does not hold together, so Inspire did not change it: the App "
                                                 "layout must be one of sidebar, tabs, home"):
        inst._implement_app(context, None)
    assert "label" not in seen



@pytest.mark.parametrize("modify,held", [(False, ["sql:restricted-query", "genie"]), (True, ["sql", "genie"])])
def test_a_shared_view_use_case_merged_into_a_per_user_app_keeps_the_hosts_scopes_and_grants_its_identity_nothing(agent_ns, sdk_stub,
                                                                                                                   modify, held):
    host = dict(HOST_APP, user_api_scopes=held)
    inst, context, calls, _imported = _deploy_inspire(agent_ns, [host] + DEPLOYED, access=[])
    context["app_host"] = dict(agent_ns["implement_app_host"]("sales-desk"), app=host, merged=True, source=SOURCE, settings={
        "auth": "user", "options": {"modify": modify, "decisions": False}})
    assert context["spec"]["outputs"]["app_access"] == "sp"
    fields = inst._implement_deploy_app(context, "sales-desk", SHELL_FILES, READS, "gA", poll_s=0)
    assert [c[0] for c in calls].count("PATCH") == 0, "the host keeps the user scopes its viewers sign in with"
    assert not any("could not remove" in w for w in fields.get("_warnings") or [])
    ledger_creates = [s for s in inst.spark.statements if VALUE_LEDGER in s and s.startswith("CREATE TABLE")]
    assert _without_feedback(_not_access_reads(inst.spark.statements)) == ledger_creates and len(ledger_creates) == 1 and inst.genie_grants == [], \
        "each viewer of the per-user host reads with their own grants, so its identity gets none beyond the feedback table (the job identity creates the value ledger)"
    assert [s for s in inst.spark.statements if VALUE_LEDGER in s and s.startswith("GRANT")] == []
    assert inst.tagged == [], "the host keeps its own owner tag"

def test_a_sensitive_use_case_is_never_merged_into_a_service_principal_app(agent_ns, tmp_path, monkeypatch):
    inst, context, seen, _calls = _merge_flow(agent_ns, tmp_path, monkeypatch, outputs={"app_access": "user"})
    with pytest.raises(_blocked(agent_ns)) as raised:
        inst._implement_app(context, None)
    assert str(raised.value) == ("this use case shows each viewer only their own data, but the App sales-desk shows everyone the same data "
                                 "through its service principal, so every viewer of the App would see all of this use case's data. Add "
                                 "it to an App where each viewer signs in as themselves, or build a new App for it")
    assert "label" not in seen and seen["deployed"] == []
    per_user = _host_files(agent_ns, tmp_path, auth="user")
    inst, context, seen, _calls = _merge_flow(agent_ns, tmp_path, monkeypatch, files=per_user, outputs={"app_access": "user"})
    fields = inst._implement_app(context, None)
    assert json.loads(seen["deployed"][0][1]["inspire_app.json"])["auth"] == "user"
    assert "sign-in" not in fields["_notes"][0] and not any("of the App sales-desk" in w for w in fields.get("_warnings") or [])
    inst, context, seen, _calls = _merge_flow(agent_ns, tmp_path, monkeypatch, files=per_user)
    fields = inst._implement_app(context, None)
    assert json.loads(seen["deployed"][0][1]["inspire_app.json"])["auth"] == "user", "a per-user App stays per-user"
    assert fields["_notes"][0] == "App: this page uses the sign-in, style, layout, palette and mode of the App sales-desk"
    assert not any("of the App sales-desk" in w for w in fields.get("_warnings") or [])


def test_an_old_page_that_now_fails_blocks_the_merge_and_names_it_while_this_pages_failure_goes_back_to_genie(agent_ns, tmp_path,
                                                                                                               monkeypatch):
    failing = ["page n01_u07: chart:by_category failed: TABLE_OR_VIEW_NOT_FOUND"]
    inst, context, seen, _calls = _merge_flow(agent_ns, tmp_path, monkeypatch,
                                              _implement_app_check=lambda work, files, modules, warehouse: list(failing))
    _straight_loop(inst)
    with pytest.raises(_blocked(agent_ns)) as raised:
        inst._implement_app(context, None)
    assert str(raised.value) == ("the App sales-desk was not updated because its page 'Sales desk' of use case N01-U07 no longer works at "
                                 "the default filters (page n01_u07: chart:by_category failed: TABLE_OR_VIEW_NOT_FOUND). Inspire "
                                 "rebuilds only this use case's page: build that use case again with Vibe/Add/Remove Features on the Build page or remove the page, then submit again")
    assert seen["deployed"] == []
    failing[:] = ["page n01_u01_s5150: kpi:revenue failed: DIVIDE_BY_ZERO"]
    with pytest.raises(RuntimeError) as raised:
        inst._implement_app(context, None)
    assert type(raised.value) is RuntimeError, "a failure of this use case's own page is Genie's to fix"
    assert str(raised.value) == "the App was run at its default filters and page n01_u01_s5150: kpi:revenue failed: DIVIDE_BY_ZERO"


def test_rebuilding_a_use_cases_own_app_keeps_the_pages_merged_into_it(agent_ns, tmp_path, monkeypatch):
    merged_page = _host_page(agent_ns, "N01-U02", "Stock desk")
    own = _host_files(agent_ns, tmp_path, source=OWN_SOURCE, pages=[_host_page(agent_ns, "N01-U01", "Old"), merged_page],
                      title="N01-U01 Predict churn", genie="g1")
    inst, context, seen = _app_flow(agent_ns, tmp_path, assets={"genie_space": "g1"},
                                    outputs={"app_look": {"layout": "home", "theme": "dark"}})
    del inst._implement_app_host
    _serve_files(agent_ns, monkeypatch, own)
    inst._implement_api, calls = _router({("GET", "/api/2.0/apps/churn-desk"): {"description": OURS_APP}})
    inst._implement_notebook_paths = lambda uc, key: ("/W/acme_implemented/Sales", "/W/acme_implemented/Sales/N01-U01")
    fields = inst._implement_app(context, None)
    name, files, reads, space_id = seen["deployed"][0]
    settings = json.loads(files["inspire_app.json"])
    assert name == "churn-desk" and settings["pages"] == ["n01_u01", "n01_u02"]
    assert json.loads(files["pages/n01_u02.json"]) == merged_page, "a use case's own rebuild never drops another use case's page"
    assert "genie" not in merged_page, "a page that joined before each page had its own Genie Agent keeps none until it is rebuilt"
    own_page = json.loads(files["pages/n01_u01.json"])
    assert own_page["title"] == "Price-loss decision desk" and own_page["genie"]["space_id"] == "g1" and own_page["genie_note"] == ""
    assert settings["genie"]["space_id"] == "g1" and space_id == "g1"
    assert (settings["style"], settings["layout"], settings["theme"], settings["title"]) == ("a", "home", "dark", "N01-U01 Predict churn")
    assert {"main.inspire.sales_out", "main.s.stores"} <= set(reads) and "_warnings" not in fields
    assert fields["_asset"] == {"page": "n01_u01"}, "every App deploy records the page of this use case, its own App as well as a joined one"


def test_an_own_app_without_inspire_pages_is_built_afresh_but_an_unreadable_one_is_left_alone(agent_ns, tmp_path, monkeypatch):
    inst, context, seen = _app_flow(agent_ns, tmp_path, assets={"genie_space": "g1"})
    del inst._implement_app_host
    _serve_files(agent_ns, monkeypatch, {})
    inst._implement_api, _calls = _router({("GET", "/api/2.0/apps/churn-desk"): {"description": OURS_APP}})
    inst._implement_notebook_paths = lambda uc, key: ("/W/acme_implemented/Sales", "/W/acme_implemented/Sales/N01-U01")
    inst._implement_app(context, None)
    assert json.loads(seen["deployed"][0][1]["inspire_app.json"])["pages"] == ["n01_u01"]

    def denied(path, w_client=None):
        raise RuntimeError("PERMISSION_DENIED: cannot read the folder")

    monkeypatch.setitem(agent_ns, "read_user_text_file", denied)
    inst, context, seen = _app_flow(agent_ns, tmp_path / "denied", assets={"genie_space": "g1"})
    del inst._implement_app_host
    inst._implement_api, _calls = _router({("GET", "/api/2.0/apps/churn-desk"): {"description": OURS_APP}})
    inst._implement_notebook_paths = lambda uc, key: ("/W/acme_implemented/Sales", "/W/acme_implemented/Sales/N01-U01")
    with pytest.raises(_blocked(agent_ns), match="the pages of the App churn-desk could not be read .* PERMISSION_DENIED"):
        inst._implement_app(context, None)
    assert seen["deployed"] == [], "an App whose pages cannot be read is never overwritten with one page"


def _genie_body(tables, question, text, sql_table=None):
    return {"config": {"sample_questions": [{"question": [question]}]}, "data_sources": {"tables": [{"identifier": t} for t in tables]},
            "instructions": {"text_instructions": [{"content": [text]}],
                             "example_question_sqls": [{"question": [question], "sql": [f"SELECT * FROM {sql_table or tables[0]}"]}]}}


def _normalized(ns, tables, question, text):
    return ns["normalize_genie_space"](json.dumps({"title": "t", "serialized_space": _genie_body(tables, question, text)}), list(tables))[2]


def _genie_answer(space_id, space, title="Sales questions"):
    return {"space_id": space_id, "title": title, "serialized_space": json.dumps(space)}


def test_a_page_genie_writes_never_names_a_genie_agent_because_inspire_sets_it(agent_ns):
    page = agent_ns["implement_app_page"](dict(_churn_page(agent_ns), genie={"space_id": "gX", "title": "x"}, genie_note="x"), "N01-U01", {})
    assert "genie" not in page and "genie_note" not in page


def test_a_page_joining_a_hub_keeps_its_own_genie_agent_and_never_changes_the_hubs(agent_ns, tmp_path, monkeypatch):
    inst, context, seen, calls = _merge_flow(agent_ns, tmp_path, monkeypatch, assets={"genie_space": "gB"}, routes=_own_genie_route("gB"))
    smoked = []
    inst._implement_genie_smoke = lambda space_id, question, **kw: smoked.append(space_id) or {}
    fields = inst._implement_app(context, None)
    _name, files, _reads, space_id = seen["deployed"][0]
    settings = json.loads(files["inspire_app.json"])
    ours = json.loads(files["pages/n01_u01_s5150.json"])
    assert settings["genie"] == {"space_id": "gA", "title": "Sales questions"}, "the hub keeps the Genie Agent of its first page"
    assert ours["genie"]["space_id"] == "gB" and ours["genie_note"] == ""
    assert "genie" not in json.loads(files["pages/n01_u07.json"])
    assert space_id == "gB", "the App's service principal gets CAN RUN on this page's own Genie Agent"
    assert [c[:2] for c in calls if "/genie/" in c[1]] == [("GET", "/api/2.0/genie/spaces/gB")] and smoked == [], \
        "no other use case's tables go into any Genie Agent: the page only reads its own for the questions Ask Genie suggests"
    assert fields["_asset"] == {"merged_into": "sales-desk", "page": "n01_u01_s5150"}


def test_a_hub_without_a_genie_agent_stays_without_one_and_the_joining_page_answers_with_its_own(agent_ns, tmp_path, monkeypatch):
    files = _host_files(agent_ns, tmp_path, genie=None)
    inst, context, seen, calls = _merge_flow(agent_ns, tmp_path, monkeypatch, files=files, assets={"genie_space": "gB"},
                                             routes=_own_genie_route("gB"))
    inst._implement_app(context, None)
    deployed = seen["deployed"][0]
    settings = json.loads(deployed[1]["inspire_app.json"])
    assert settings["genie"] is None and settings["genie_note"] == "Ask Genie is off"
    assert json.loads(deployed[1]["pages/n01_u01_s5150.json"])["genie"]["space_id"] == "gB" and deployed[3] == "gB"
    assert [c[:2] for c in calls if "/genie/" in c[1]] == [("GET", "/api/2.0/genie/spaces/gB")]


def test_a_joining_page_whose_genie_agent_did_not_build_is_off_with_the_reason_and_the_hub_keeps_its_own(agent_ns, tmp_path,
                                                                                                          monkeypatch):
    inst, context, seen, calls = _merge_flow(agent_ns, tmp_path, monkeypatch, assets={}, outputs={"genie_space": False})
    fields = inst._implement_app(context, None)
    deployed = seen["deployed"][0]
    ours = json.loads(deployed[1]["pages/n01_u01_s5150.json"])
    assert ours["genie"] is None and ours["genie_note"].startswith("The Genie Agent is not ready")
    assert json.loads(deployed[1]["inspire_app.json"])["genie"]["space_id"] == "gA" and deployed[3] == ""
    assert f"App: {ours['genie_note']}" in fields["_warnings"]


def test_a_merged_app_deploys_into_the_hosts_folder_without_retagging_it_and_grants_every_pages_tables(agent_ns, sdk_stub):
    answers = [dict(HOST_APP), {"deployment_id": "dep1", "status": {"state": "SUCCEEDED"}}, {"url": "https://sales-desk.example/"}]
    inst, context, calls, imported = _deploy_inspire(agent_ns, answers)
    context["app_host"] = dict(agent_ns["implement_app_host"]("sales-desk"), merged=True, source=SOURCE)
    reads = ["main.inspire.churn_out", "main.inspire.sales_out"]
    inst._implement_deploy_app(context, "sales-desk", {"inspire_app.json": "{}\n", "pages/n01_u01_s5150.json": "{}\n"}, reads, "gA",
                               poll_s=0)
    assert sorted(imported) == [f"{SOURCE}/inspire_app.json", f"{SOURCE}/pages/n01_u01_s5150.json"]
    assert [c[:2] for c in calls] == [("GET", "/api/2.0/apps/sales-desk"), ("POST", "/api/2.0/apps/sales-desk/deployments"),
                                      ("GET", "/api/2.0/apps/sales-desk")]
    assert calls[1][2]["source_code_path"] == SOURCE and inst.tagged == [], "the App keeps the tags of the use case that built it"
    grants = _not_access_reads(inst.spark.statements)
    assert any(g.endswith("`sales_out` TO `sp-7`") for g in grants) and any(g.endswith("`churn_out` TO `sp-7`") for g in grants)
    assert inst.genie_grants == [("genie", "gA", [{"type": "service_principal", "name": "sp-7"}], "CAN_RUN")]


@pytest.mark.parametrize("answer,needle", [
    (RuntimeError("RESOURCE_DOES_NOT_EXIST: app sales-desk"), "the App sales-desk this use case is added to was deleted while Inspire "
                                                              "built its page"),
    (dict(HOST_APP, description="Finance team tool"), "the App sales-desk exists but is not this use case's App"),
])
def test_a_merged_app_that_vanished_or_changed_hands_gets_no_files_no_new_app_and_no_grant(agent_ns, sdk_stub, answer, needle):
    inst, context, calls, imported = _deploy_inspire(agent_ns, [answer])
    context["app_host"] = dict(agent_ns["implement_app_host"]("sales-desk"), merged=True, source=SOURCE)
    with pytest.raises(_blocked(agent_ns), match=needle):
        inst._implement_deploy_app(context, "sales-desk", {"inspire_app.json": "{}\n"}, ["main.inspire.churn_out"], poll_s=0)
    assert calls == [("GET", "/api/2.0/apps/sales-desk", None)] and imported == [] and _not_access_reads(inst.spark.statements) == []


def _restyle_inspire(ns, tmp_path, monkeypatch, files, app=None):
    inst = _inspire(ns, FakeSpark())
    inst.local_log_output_dir = str(tmp_path)
    inst._implement_carried = lambda t: ({"notebook_path": "/W/nb", "job_id": 77, "last_preview_run_id": 5, "result_rows": 40,
                                          "dashboard_id": "d1", "genie_space_id": "g1", "app_name": "churn-desk",
                                          "app_url": "https://churn-desk.example", "genie_widgets": [{"name": "top_k", "default": "25"}]},
                                         _left_by(2))
    inst.updates = []
    inst._implement_update = lambda key, **f: inst.updates.append(f)
    inst._implement_use_case_row = lambda sid, uc: {"No": "N01-U01", "Name": "Predict churn", "genie_instruction": "Build"}
    inst._row_to_uc = lambda row: dict(row)
    inst._genie_notebook_spec = lambda uc: dict(_NB_SPEC)
    inst._genie_widget_names = lambda instruction, spec: ["result_table"]
    inst._genie_involved_tables = lambda uc: ["main.s.orders"]
    inst._implement_runner = lambda uc: pytest.fail("a look-only edit installs no Genie Code")
    inst._implement_genie_loop = lambda *a: pytest.fail("a look-only edit never asks Genie")
    inst._implement_fill_and_preview = lambda *a: pytest.fail("a look-only edit never re-runs the notebook")
    inst._implement_schedule = lambda *a: pytest.fail("a look-only edit leaves the schedule alone")
    inst._implement_dashboard = inst._implement_genie_space = inst._implement_alert = lambda c, r: pytest.fail("only the App changes")
    inst._implement_share = lambda *a, **k: []
    _serve_files(ns, monkeypatch, files)
    inst._implement_api, inst.calls = _router({("GET", "/api/2.0/apps/churn-desk"): app or {"description": OURS_APP,
                                                                                              "url": "https://churn-desk.example/"}})
    inst._implement_notebook_paths = lambda uc, key: ("/W/acme_implemented/Sales", "/W/acme_implemented/Sales/N01-U01")
    inst.checked, inst.deployed = [], []
    inst._implement_app_check = lambda work, files, modules, warehouse: setattr(inst, "_implement_app_speeds", {}) or inst.checked.append(files) or []
    inst._implement_deploy_app = (lambda context, name, files, reads, space_id="", lakebase=None, page_tables=(): inst.deployed.append((name, files, reads, space_id))
                                  or {"app_name": name, "app_url": "https://churn-desk.example", "app_health": "passed"})
    return inst


def test_a_look_only_edit_rewrites_the_app_settings_and_redeploys_without_genie(agent_ns, tmp_path, monkeypatch):
    merged_page = _host_page(agent_ns, "N01-U02", "Stock desk")
    own_page = _host_page(agent_ns, "N01-U01", "Churn desk")
    files = _host_files(agent_ns, tmp_path, source=OWN_SOURCE, pages=[own_page, merged_page], title="N01-U01 Predict churn", genie="g1",
                        style="a", layout="sidebar", palette="default", theme="light")
    inst = _restyle_inspire(agent_ns, tmp_path, monkeypatch, files)
    previous = json.loads(json.dumps(VALID))
    inst._implement_previous = lambda t: {"spec_version": 2, "spec_json": previous}
    current = dict(previous, outputs={**previous["outputs"], "app_look": {"layout": "tabs", "palette": "ocean"}})
    status = inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": current},
                                        (5150, "N01-U01", 3))
    assert status == "ready", inst.updates[-1]
    name, deployed, reads, space_id = inst.deployed[0]
    settings = json.loads(deployed["inspire_app.json"])
    assert (name, settings["layout"], settings["palette"], settings["style"], settings["theme"]) == ("churn-desk", "tabs", "ocean", "a", "light")
    assert settings["pages"] == ["n01_u01", "n01_u02"] and settings["genie"]["space_id"] == "g1" and space_id == "g1"
    assert json.loads(deployed["pages/n01_u01.json"]) == dict(own_page, title="Predict churn"), (
        "the App's own page carries the use case name, as implement_app_renamed sets it (names lane, rc7_app_rename_test)")
    assert json.loads(deployed["pages/n01_u02.json"]) == merged_page
    assert inst.checked == [_without_requirements(deployed)] and deployed["requirements.txt"] == ""
    assert {"main.inspire.sales_out", "main.s.stores", "main.inspire.churn_out"} <= set(reads)
    messages = [e.get("message") for e in inst.emitted]
    assert ("only the look, data backend or SQL warehouse changed: Inspire rewrites the App settings and redeploys it, without Genie"
            in messages
            and "App look set to style a, layout tabs, palette ocean, theme light; it reads Delta tables" in messages)
    assert inst.updates[-1]["asset_status"]["app"]["state"] == "ready"
    assert inst.updates[-1]["asset_status"]["app"]["page"] == "n01_u01", "a look-only redeploy records the page too"


def test_a_look_only_edit_of_a_merged_app_changes_nothing_and_says_the_host_keeps_its_look(agent_ns, tmp_path, monkeypatch):
    inst, context, seen, calls = _merge_flow(agent_ns, tmp_path, monkeypatch, outputs={"app_look": {"layout": "home"}})
    inst._implement_runner = lambda uc: pytest.fail("no Genie Code for a look change")
    context["restyle"] = ["app"]
    fields = inst._implement_app(context, None)
    assert seen["deployed"] == [] and "label" not in seen
    assert fields["app_name"] == "sales-desk" and fields["app_url"] == "https://sales-desk.example"
    assert fields["_notes"] == ["App: this page uses the style, layout, palette and mode of the App sales-desk",
                                "App: this page uses the look, data backend and SQL warehouse of the App sales-desk, so nothing is "
                                "redeployed"]
    assert not fields["_warnings"], "a look edit of a page that joined an App is a fact, never a warning"
    assert not [e for e in inst.emitted if e.get("status") == "ended_warning"]
    assert [e for e in inst.emitted if e.get("status") == "ended_success"][-1]["result_json"]["notes"] == [
        "this page uses the look, data backend and SQL warehouse of the App sales-desk, so nothing is redeployed"]


def test_a_look_or_backend_edit_of_an_app_whose_pages_fail_todays_checks_is_rebuilt_by_genie_and_says_so(agent_ns, tmp_path, monkeypatch):
    files = _host_files(agent_ns, tmp_path, source=OWN_SOURCE, pages=[_host_page(agent_ns, "N01-U01")], title="N01-U01 Predict churn",
                        genie="g1")
    inst = _restyle_inspire(agent_ns, tmp_path, monkeypatch, files)
    failing = ["page n01_u01: the page has 2 charts; it needs 3 to 8", "page n01_u01: kpi:revenue failed: TABLE_OR_VIEW_NOT_FOUND"]
    checks, made, asked = [], [], []
    inst._implement_app_check = lambda work, files, modules, warehouse: setattr(inst, "_implement_app_speeds", {}) or checks.append(files) or (failing if len(checks) == 1 else [])
    inst._implement_runner = lambda uc: made.append(uc) or "runner"
    inst._genie_decision_contract = _contract
    inst._implement_input_has_dates = lambda context: False
    inst._implement_run_query_check = lambda sql, require_rows=False, limit=20: [dict(t) for t in TRUTH]
    inst._implement_latest_run_rows = lambda table: list(TRUTH)
    work = tmp_path / "genie_work"
    work.mkdir()
    (work / "page.json").write_text(json.dumps(_churn_page(agent_ns)))

    def loop(context, runner, label, prompt, deploy, tools=None):
        asked.append((runner, label))
        return deploy(str(work))

    inst._implement_genie_loop = loop
    context = dict(_output_context(agent_ns, app_look={"layout": "tabs"}), restyle=["app"], assets={"genie_space": "g1"}, asset_status={})
    fields = inst._implement_app(context, None)
    note = ("App: its pages no longer passed Inspire's checks (page n01_u01: the page has 2 charts; it needs 3 to 8; page n01_u01: "
            "kpi:revenue failed: TABLE_OR_VIEW_NOT_FOUND), so Genie rebuilt them with the new look and data backend")
    assert made == ["N01-U01"] and asked == [("runner", "App")], "Genie rebuilds the App instead of refusing the edit"
    assert len(checks) == 3 and len(inst.deployed) == 1, (
        "the restyled pages are checked, then the held pages as they are, which passed, so the restyle caused the problems; then the "
        "rebuilt App is checked and deployed")
    assert note in fields["_notes"] and note not in (fields.get("_warnings") or []), "a fix Genie made is a note, not a warning"
    assert not [e for e in inst.emitted if e.get("status") == "ended_warning"]
    assert note in [e["message"] for e in inst.emitted if e.get("status") == "ended_success"]
    assert not [e for e in inst.emitted if e.get("status") == "ended_error"]
    settings = json.loads(inst.deployed[0][1]["inspire_app.json"])
    assert settings["layout"] == "tabs" and settings["pages"] == ["n01_u01"]


def test_a_look_only_edit_of_an_app_inspire_cannot_read_is_rebuilt_by_genie(agent_ns, tmp_path, monkeypatch):
    inst, context, seen = _app_flow(agent_ns, tmp_path, assets={"genie_space": "g1"})
    del inst._implement_app_host
    inst._implement_api, _calls = _router({("GET", "/api/2.0/apps/churn-desk"): RuntimeError("RESOURCE_DOES_NOT_EXIST")})
    made = []
    inst._genie_runner_factory = lambda uc: made.append(uc) or "runner"
    context["restyle"] = ["app"]
    inst._implement_app(context, None)
    assert made == ["N01-U01"] and seen["label"] == "App" and len(seen["deployed"]) == 1


def _page_runner(ns):
    return _FileRunner([{"exit": 0}], [{"page.json": json.dumps(_churn_page(ns))}])


def _dashboard_inspire(ns, tmp_path, routes, recorded=("dA",)):
    inst, _calls = _output_inspire(ns, tmp_path)
    inst._implement_api, calls = _router(routes)
    inst._implement_input_has_dates = lambda context: False
    inst._implement_app_check = lambda work, files, modules, warehouse: setattr(inst, "_implement_app_speeds", {}) or []
    inst._implement_app_name = lambda context, name: name
    inst._implement_run_query_check = lambda sql, require_rows=False, limit=20: list(TRUTH)
    inst._implement_latest_run_rows = lambda table: list(TRUTH)
    inst.selected = []
    inst._implement_select = lambda where, args, order=None: inst.selected.append((where, args)) or (
        [{"session_id": 777, "use_case_id": HOST_UC}] if args.get("asset") in recorded else [])
    return inst, calls


def test_a_dashboard_merge_appends_this_use_cases_pages_keeps_the_others_and_publishes_on_the_hosts_warehouse(agent_ns, tmp_path):
    routes = {("GET", "/api/2.0/lakeview/dashboards/dA"): DASH, ("PATCH", "/api/2.0/lakeview/dashboards/dA"): {"etag": "e2"},
              ("POST", "/api/2.0/lakeview/dashboards/dA/published"): {}}
    inst, calls = _dashboard_inspire(agent_ns, tmp_path, routes)
    runner = _page_runner(agent_ns)
    context = _output_context(agent_ns, merge={"dashboard": "dA"})
    context["assets"] = {"dashboard": "d1"}
    fields = inst._implement_dashboard(context, runner)
    assert fields == {"dashboard_id": "dA", "dashboard_url": "https://h/dashboardsv3/dA/published", "_asset": {"merged_into": "dA"},
                      "_notes": ["Dashboard: this use case is now part of the dashboard dA; the dashboard d1 keeps what Inspire built "
                                 "there before and is no longer refreshed for it"]}
    assert [c[:2] for c in calls] == [("GET", "/api/2.0/lakeview/dashboards/dA"), ("GET", "/api/2.0/lakeview/dashboards/dA"),
                                      ("PATCH", "/api/2.0/lakeview/dashboards/dA"), ("POST", "/api/2.0/lakeview/dashboards/dA/published")]
    patch = calls[2][2]
    assert patch["etag"] == "e1" and set(patch) == {"serialized_dashboard", "etag"}, "only the definition changes, guarded by its etag"
    board = json.loads(patch["serialized_dashboard"])
    assert [p["name"] for p in board["pages"]] == ["home", "filters", "s5150_n01_u01_overview", "s5150_n01_u01_run_health"]
    assert board["pages"][:2] == HOST_BOARD["pages"], "the host's pages and its global filters stay as they were"
    assert [p["displayName"] for p in board["pages"][2:]] == ["N01-U01 Price-loss decision desk", "N01-U01 Run health"]
    assert [d["name"] for d in board["datasets"]] == ["sales", "s5150_n01_u01_trend", "s5150_n01_u01_records",
                                                       "s5150_n01_u01_run_health", "s5150_n01_u01_chart_3_parts"]
    ours = [item["widget"] for page in board["pages"][2:] for item in page["layout"]]
    reads = {q["query"]["datasetName"] for w in ours for q in w.get("queries") or [] if q["query"].get("datasetName")}
    assert all(w["name"].startswith("s5150_n01_u01_") for w in ours)
    assert reads == {"s5150_n01_u01_trend", "s5150_n01_u01_records", "s5150_n01_u01_run_health", "s5150_n01_u01_chart_3_parts"}, \
        "this use case's widgets read only its own renamed datasets, the pareto's part dataset and the filters bound to it too"
    assert calls[3][2] == {"warehouse_id": "whA", "embed_credentials": False}, "the host's viewers keep the warehouse they can use"
    assert inst.selected == [("`dashboard_id` = :asset", {"asset": "dA"})]


@pytest.mark.parametrize("recorded,dash,needle", [
    ((), DASH, "the dashboard dA you chose to add this use case to was not built by Inspire, so Inspire does not change it"),
    (("dA",), dict(DASH, lifecycle_state="TRASHED"), "the dashboard dA you chose to add this use case to is in the trash"),
    (("dA",), RuntimeError("RESOURCE_DOES_NOT_EXIST: dashboard dA"), "the dashboard dA you chose to add this use case to no longer exists"),
])
def test_a_dashboard_inspire_did_not_build_or_cannot_use_is_refused_before_genie(agent_ns, tmp_path, recorded, dash, needle):
    inst, calls = _dashboard_inspire(agent_ns, tmp_path, {("GET", "/api/2.0/lakeview/dashboards/dA"): dash}, recorded)
    runner = _page_runner(agent_ns)
    with pytest.raises(_blocked(agent_ns), match=needle):
        inst._implement_dashboard(_output_context(agent_ns, merge={"dashboard": "dA"}), runner)
    assert runner.prompts == [] and not any(c[0] in ("PATCH", "POST") for c in calls)


def test_merging_into_this_use_cases_own_dashboard_is_a_plain_refresh(agent_ns, tmp_path):
    routes = {("GET", "/api/2.0/lakeview/dashboards/d1"): DASH, ("PATCH", "/api/2.0/lakeview/dashboards/d1"): {},
              ("POST", "/api/2.0/lakeview/dashboards/d1/published"): {}}
    inst, calls = _dashboard_inspire(agent_ns, tmp_path, routes)
    context = _output_context(agent_ns, merge={"dashboard": "d1"})
    context["assets"] = {"dashboard": "d1"}
    fields = inst._implement_dashboard(context, _page_runner(agent_ns))
    assert fields == {"dashboard_id": "d1", "dashboard_url": "https://h/dashboardsv3/d1/published"}
    assert inst.selected == [("(`dashboard_id` = :asset OR CAST(spec_json:outputs.merge.dashboard AS STRING) = :asset) "
                              "AND NOT (session_id = :sid AND use_case_id = :uc)", {"asset": "d1", "sid": 5150, "uc": "N01-U01"})], \
        "no merge-target check, only the check of who else shares it, which finds no one"
    assert [c[:2] for c in calls] == [("GET", "/api/2.0/lakeview/dashboards/d1"), ("PATCH", "/api/2.0/lakeview/dashboards/d1"),
                                      ("POST", "/api/2.0/lakeview/dashboards/d1/published")]
    assert [d["name"] for d in json.loads(calls[1][2]["serialized_dashboard"])["datasets"]] == ["trend", "records", "run_health",
                                                                                         "chart_3_parts"], \
        "its own dashboard is not prefixed"


def test_a_use_case_taken_out_of_a_dashboard_or_genie_agent_builds_its_own_and_never_overwrites_the_host(agent_ns, tmp_path):
    routes = {("POST", "/api/2.0/lakeview/dashboards"): {"dashboard_id": "d9"}, ("POST", "/api/2.0/lakeview/dashboards/d9/published"): {}}
    inst, calls = _dashboard_inspire(agent_ns, tmp_path, routes)
    context = _output_context(agent_ns)
    context.update(assets={"dashboard": "dA"}, asset_status={"dashboard": {"state": "ready", "merged_into": "dA"}})
    fields = inst._implement_dashboard(context, _page_runner(agent_ns))
    assert [c[:2] for c in calls] == [("POST", "/api/2.0/lakeview/dashboards"), ("POST", "/api/2.0/lakeview/dashboards/d9/published")], \
        "the dashboard it was merged into is never patched with this use case's pages alone"
    assert fields["dashboard_id"] == "d9" and "_warnings" not in fields and fields["_notes"] == [
        "Dashboard: this use case is now part of the dashboard d9; the dashboard dA keeps what Inspire built there before and is no "
        "longer refreshed for it"]
    routes = {("POST", "/api/2.0/genie/spaces"): {"space_id": "g9"}}
    inst, calls = _dashboard_inspire(agent_ns, tmp_path, routes)
    inst._implement_run_query_check = lambda sql, require_rows=False, limit=20: [{"n": 1}]
    inst._implement_genie_smoke = lambda space_id, question, **kw: {"attachments": [{"query": {"query": "SELECT 1"}}]}
    context = _output_context(agent_ns)
    context.update(assets={"genie_space": "gA"}, asset_status={"genie_space": {"state": "ready", "merged_into": "gA"}})
    fields = inst._implement_genie_space(context, _FileRunner([{"exit": 0}], [{"genie_space.json": _space(grounded=True)}]))
    assert [c[:2] for c in calls] == [("POST", "/api/2.0/genie/spaces")] and fields["genie_space_id"] == "g9"
    assert fields["_notes"] == ["Genie Agent: this use case is now part of the Genie Agent g9; the Genie Agent gA keeps what Inspire "
                                "built there before and is no longer refreshed for it"]
    assert not fields["_warnings"], "moving a use case to its own Genie Agent is the user's choice, never a warning"


def test_a_use_case_taken_out_of_an_app_says_its_old_page_stays_there(agent_ns, tmp_path):
    inst, context, seen = _app_flow(agent_ns, tmp_path, assets={"app": "sales-desk"},
                                    asset_status={"app": {"state": "ready", "merged_into": "sales-desk"}})
    fields = inst._implement_app(context, None)
    assert seen["deployed"][0][0] == "churn-desk"
    assert "App: this use case is now part of the App churn-desk; the App sales-desk keeps what Inspire built there before" in \
        fields["_notes"][0]
    assert not any("is now part of" in w for w in fields.get("_warnings") or []), "the move is a note, not a warning"
    inst, context, seen = _app_flow(agent_ns, tmp_path / "own", assets={"app": "churn-desk-old"})
    fields = inst._implement_app(context, None)
    assert not any("is now part of" in w for w in (fields.get("_warnings") or []) + (fields.get("_notes") or [])), \
        "a use case moving between its own Apps (a rename) gets no merge note"


def test_a_dashboard_edited_during_the_merge_is_read_again_once_then_refused(agent_ns, tmp_path):
    stale = RuntimeError("Entity etag provided does not match currently stored etag. Please reload the entity")
    routes = {("GET", "/api/2.0/lakeview/dashboards/dA"): [DASH, DASH, dict(DASH, etag="e9")],
              ("PATCH", "/api/2.0/lakeview/dashboards/dA"): [stale, {}], ("POST", "/api/2.0/lakeview/dashboards/dA/published"): {}}
    inst, calls = _dashboard_inspire(agent_ns, tmp_path, routes)
    inst._implement_dashboard(_output_context(agent_ns, merge={"dashboard": "dA"}),
                              _page_runner(agent_ns))
    assert [c[2]["etag"] for c in calls if c[0] == "PATCH"] == ["e1", "e9"]
    routes[("PATCH", "/api/2.0/lakeview/dashboards/dA")] = [stale]
    routes[("GET", "/api/2.0/lakeview/dashboards/dA")] = [DASH]
    inst, calls = _dashboard_inspire(agent_ns, tmp_path, routes)
    with pytest.raises(_blocked(agent_ns), match="the dashboard Sales board kept changing while Inspire added this use case's pages"):
        inst._implement_merge_dashboard(_output_context(agent_ns), "dA", json.loads(_dashboard()))
    routes[("PATCH", "/api/2.0/lakeview/dashboards/dA")] = [RuntimeError("INVALID_PARAMETER_VALUE: bad widget")]
    inst, calls = _dashboard_inspire(agent_ns, tmp_path, routes)
    with pytest.raises(RuntimeError, match="bad widget"):
        inst._implement_merge_dashboard(_output_context(agent_ns), "dA", json.loads(_dashboard()))
    assert len([c for c in calls if c[0] == "PATCH"]) == 1, "only a stale etag is retried"


def test_merge_dashboard_offsets_shared_filters_replaces_its_own_part_and_catches_broken_boards(agent_ns):
    merge = agent_ns["implement_merge_dashboard"]
    ours = json.loads(_dashboard())
    ours["pages"].append({"name": "gf", "pageType": "PAGE_TYPE_GLOBAL_FILTERS", "layout": [
        {"widget": {"name": "f", "queries": [{"name": "q", "query": {"datasetName": "decision_list"}}]},
         "position": {"x": 0, "y": 1, "width": 2, "height": 2}}]})
    merged, problems = merge(HOST_BOARD, ours, "s1_n01_u01_", "N01-U01")
    assert problems == []
    filters = merged["pages"][1]["layout"]
    assert [i["widget"]["name"] for i in filters] == ["gf", "s1_n01_u01_f"] and filters[1]["position"]["y"] == 4
    assert [p["name"] for p in merged["pages"]] == ["home", "filters", "s1_n01_u01_p"], "one global filters page"
    again, problems = merge(merged, ours, "s1_n01_u01_", "N01-U01")
    assert problems == [] and again == merged, "merging the same use case again replaces its part, nothing is added twice"
    other, problems = merge(merged, ours, "s1_n01_u02_", "N01-U02")
    assert problems == [] and len(other["pages"]) == 4 and len(other["pages"][1]["layout"]) == 3
    assert HOST_BOARD["pages"][1]["layout"][0]["position"] == {"x": 0, "y": 0, "width": 2, "height": 3}, "the input is never changed"
    broken = dict(HOST_BOARD, datasets=HOST_BOARD["datasets"] * 2)
    assert merge(broken, ours, "s1_n01_u01_", "N01-U01")[1] == ["two datasets share the name sales"]
    dangling = json.loads(_dashboard(missing_dataset=True))
    assert merge(HOST_BOARD, dangling, "s1_n01_u01_", "N01-U01")[1] == ["widgets read datasets the dashboard does not define: nope"]
    two = dict(HOST_BOARD, pages=HOST_BOARD["pages"] + [dict(HOST_BOARD["pages"][1], name="filters2")])
    assert "the dashboard has more than one global filters page" in agent_ns["implement_dashboard_problems"](two)


def test_a_genie_agent_merge_adds_this_use_cases_tables_questions_and_instructions_and_keeps_the_hosts(agent_ns, tmp_path):
    host_space = _normalized(agent_ns, ("main.inspire.sales_out", "main.s.stores"), "Which stores lag?", "Sales are in dollars.")
    routes = {("GET", "/api/2.0/genie/spaces/gA"): _genie_answer("gA", host_space), ("PATCH", "/api/2.0/genie/spaces/gA"): {}}
    inst, calls = _dashboard_inspire(agent_ns, tmp_path, routes, recorded=("gA",))
    inst._implement_space_columns = lambda tables: {t.lower(): GENIE_COLUMNS.get(t.lower(), []) for t in tables}
    inst._implement_run_query_check = lambda sql, require_rows=False, limit=20: [] if "HAVING COUNT(*) > 1" in sql else [{"n": 1}]
    smoked = []
    inst._implement_genie_smoke = lambda space_id, question, **kw: smoked.append((space_id, question)) or {
        "attachments": [{"query": {"query": "SELECT 1"}}]}
    runner = _FileRunner([{"exit": 0}], [{"genie_space.json": _definition(_rich_space())}])
    context = _output_context(agent_ns, merge={"genie_space": "gA"})
    fields = inst._implement_genie_space(context, runner)
    assert fields["genie_space_id"] == "gA" and smoked == [("gA", "Which customers act now?")]
    assert [c[:2] for c in calls] == [("GET", "/api/2.0/genie/spaces/gA"), ("GET", "/api/2.0/genie/spaces/gA"),
                                      ("PATCH", "/api/2.0/genie/spaces/gA")]
    assert calls[1][3] == {"include_serialized_space": "true"} and set(calls[2][2]) == {"serialized_space"}
    merged = json.loads(calls[2][2]["serialized_space"])
    assert [t["identifier"] for t in merged["data_sources"]["tables"]] == ["main.inspire.churn_out", "main.inspire.sales_out", "main.s.orders",
                                                                           "main.s.stores"]
    assert sorted("".join(q["question"]) for q in merged["config"]["sample_questions"]) == ["Which customers act now?", "Which stores lag?"]
    assert len(merged["instructions"]["text_instructions"]) == 1
    assert fields["_asset"]["merged_into"] == "gA" and fields["_asset"]["merged"]["space_id"] == "gA"
    assert fields["_asset"]["merged"]["sample_questions"] == ["which customers act now?"]


def test_a_genie_agent_inspire_did_not_build_is_refused_before_genie(agent_ns, tmp_path):
    inst, calls = _dashboard_inspire(agent_ns, tmp_path, {}, recorded=())
    runner = _FileRunner([{"exit": 0}], [{"genie_space.json": _space()}])
    with pytest.raises(_blocked(agent_ns), match="the Genie Agent gX you chose to add this use case to was not built by Inspire"):
        inst._implement_genie_space(_output_context(agent_ns, merge={"genie_space": "gX"}), runner)
    assert runner.prompts == [] and calls == []


def test_genie_merge_replaces_its_own_part_never_duplicates_and_keeps_ids_unique(agent_ns):
    merge = agent_ns["implement_merge_genie_space"]
    label = "For use case N01-U01 Predict churn, whose results are in `main.inspire.churn_out`:"
    host = _normalized(agent_ns, ("main.inspire.sales_out",), "Which stores lag?", "Sales are in dollars.")
    host["instructions"]["sql_snippets"] = {"measures": [{"id": "a" * 32, "alias": "revenue", "sql": ["SUM(amount)"]}]}
    ours = _normalized(agent_ns, ("main.inspire.churn_out", "main.inspire.sales_out"), "  which STORES lag? ", "Churn is monthly.")
    ours["config"]["sample_questions"].append({"id": host["config"]["sample_questions"][0]["id"], "question": ["Who acts now?"]})
    ours["instructions"]["sql_snippets"] = {"measures": [{"id": "b" * 32, "alias": "revenue", "sql": ["SUM(amount)"]},
                                                         {"id": "c" * 32, "alias": "churned", "sql": ["COUNT_IF(churned)"]}]}
    first, record, problems = merge(host, ours, {}, label)
    assert problems == [] and record["tables"] == ["main.inspire.churn_out"]
    questions = ["".join(q["question"]) for q in first["config"]["sample_questions"]]
    assert sorted(questions) == ["Which stores lag?", "Who acts now?"], "the host's question is kept and the same question is not added"
    ids = [q["id"] for q in first["config"]["sample_questions"]]
    assert len(set(ids)) == 2 and ids == sorted(ids), "an id that clashes with the host's gets a new one, and items stay sorted by id"
    assert [m["alias"] for m in first["instructions"]["sql_snippets"]["measures"]] == ["revenue", "churned"]
    assert record["sample_questions"] == ["who acts now?"]
    text = "".join(first["instructions"]["text_instructions"][0]["content"])
    assert text == f"Sales are in dollars.\n\n{label}\nChurn is monthly."
    changed = json.loads(json.dumps(ours))
    changed["config"]["sample_questions"][-1]["question"] = ["Who leaves next?"]
    changed["instructions"]["text_instructions"][0]["content"] = ["Churn is weekly."]
    second, record2, problems = merge(first, changed, record, label)
    assert problems == []
    assert sorted("".join(q["question"]) for q in second["config"]["sample_questions"]) == ["Which stores lag?", "Who leaves next?"]
    assert "".join(second["instructions"]["text_instructions"][0]["content"]) == f"Sales are in dollars.\n\n{label}\nChurn is weekly."
    third, _r, _p = merge(second, changed, record2, label)
    assert third == second, "merging the same content again changes nothing"
    assert host["data_sources"]["tables"] == [{"identifier": "main.inspire.sales_out"}], "the host definition passed in is never changed"


@pytest.mark.parametrize("have,adds,refused", [(48, 2, False), (49, 2, True), (50, 0, False), (40, 11, True)])
def test_a_genie_agent_holds_at_most_fifty_tables(agent_ns, have, adds, refused):
    host = {"data_sources": {"tables": [{"identifier": f"main.s.h{i:02d}"} for i in range(have)]}}
    ours = {"data_sources": {"tables": [{"identifier": f"main.s.o{i:02d}"} for i in range(adds)]
                             + [{"identifier": "MAIN.S.H00"}] * bool(have)}}
    merged, record, problems = agent_ns["implement_merge_genie_space"](host, ours, {}, "x")
    assert bool(problems) is refused, problems
    if refused:
        assert problems[0].startswith(f"it would hold {have + adds} tables, above the 50 a Genie Agent can hold ({have} already, and this "
                                      f"use case adds {adds}: ")
        assert record == {}
    else:
        assert len(merged["data_sources"]["tables"]) == have + adds, "a table the host already has, in any case, is not added again"


def _holder_inspire(ns, rows, carried, select_error=None):
    inst = _inspire(ns, FakeSpark())
    inst.calls, inst.updates, inst.emitted = [], [], []

    def api(method, path, body=None, query=None):
        inst.calls.append((method, path))
        return {"description": OURS_APP} if method == "GET" else {}

    def select(where, args, order=None):
        if select_error:
            raise select_error
        return rows

    inst._implement_api = api
    inst._implement_select = select
    inst._implement_carried = lambda target: (carried.get(target["use_case_id"], {}), {})
    inst._implement_update = lambda key, **f: inst.updates.append(f)
    inst._implement_emit = lambda *a, **k: inst.emitted.append(a)
    return inst


@pytest.mark.parametrize("name,asset,path", [("dashboard", "dA", "/api/2.0/lakeview/dashboards/dA"),
                                             ("genie_space", "gA", "/api/2.0/genie/spaces/gA"), ("app", "churn-desk", "/api/2.0/apps/churn-desk")])
def test_an_output_another_use_case_still_holds_is_never_deleted(agent_ns, name, asset, path):
    column = agent_ns["IMPLEMENT_OUTPUT_ID_COLUMNS"][name]
    rows = [{"session_id": 777, "use_case_id": "N01-U07"}, {"session_id": 777, "use_case_id": "N01-U08"}]
    inst = _holder_inspire(agent_ns, rows, {"N01-U07": {column: asset}, "N01-U08": {}})
    taken = []
    setattr(inst, {"dashboard": "_implement_take_out_dashboard", "genie_space": "_implement_take_out_genie", "app": "_implement_take_out_app"}[name],
            lambda asset_id, key, holders, status: taken.append((asset_id, [h["use_case_id"] for h in holders])) or {
                "state": "released", "note": "its part is out"})
    outcome = inst._implement_delete_output(name, asset, (5150, "N01-U01", 3))
    label = {"dashboard": "Dashboard", "genie_space": "Genie Agent", "app": "App"}[name]
    assert taken == [(asset, ["N01-U07"])], "only this use case's part is taken out, and only the use case still holding it keeps it"
    assert outcome["state"] == "released" and outcome["stays_for"] == ["N01-U07"] and outcome["taken_out_of"] == asset
    assert ("DELETE", path) not in inst.calls and inst.emitted[-1][2:4] == ("its part is out; it stays for use case N01-U07", "ended_success")
    released = _holder_inspire(agent_ns, rows, {"N01-U07": {}, "N01-U08": {}})
    assert released._implement_delete_output(name, asset, (5150, "N01-U01", 3))["state"] == "deleted"
    assert ("DELETE", path) in released.calls, "an output no other use case holds any more is deleted as asked"
    blind = _holder_inspire(agent_ns, rows, {}, select_error=RuntimeError("TABLE_OR_VIEW_NOT_FOUND: __inspire_implement"))
    with pytest.raises(agent_ns["ImplementBlocked"], match=f"^{label}: Inspire could not check whether other use cases share {asset}, so it "
                                                           "neither deleted it nor took this use case's"):
        blind._implement_delete_output(name, asset, (5150, "N01-U01", 3))
    assert ("DELETE", path) not in blind.calls


def test_the_holder_check_reads_other_use_cases_rows_and_trusts_only_what_each_still_carries(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    asked, carried_for = [], []
    inst._implement_select = lambda where, args, order=None: asked.append((where, args)) or [
        {"session_id": 777, "use_case_id": "N01-U07"}, {"session_id": 777, "use_case_id": "N01-U07"}, {"session_id": 9, "use_case_id": "N01-U07"}]
    inst._implement_carried = lambda target: carried_for.append(target) or ({"dashboard_id": "dA"}, {})
    holders = inst._implement_output_holders("dashboard", "dA", (5150, "N01-U01", 3))
    assert [(h["session_id"], h["use_case_id"], h["joining"]) for h in holders] == [(9, "N01-U07", False), (777, "N01-U07", False)], \
        "the same use case id in two sessions is two use cases"
    assert asked == [("(`dashboard_id` = :asset OR CAST(spec_json:outputs.merge.dashboard AS STRING) = :asset) "
                      "AND NOT (session_id = :sid AND use_case_id = :uc)", {"asset": "dA", "sid": 5150, "uc": "N01-U01"})]
    assert [(t["session_id"], t["use_case_id"]) for t in carried_for] == [(9, "N01-U07"), (777, "N01-U07")]
    assert all(t["spec_version"] == 2 ** 31 - 1 for t in carried_for)


def test_sharing_a_merged_app_names_the_use_case_whose_sharing_decides(agent_ns):
    spec = _spec(agent_ns)[0]
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_api = lambda method, path, body=None, query=None: dict(HOST_APP) if method == "GET" else {}
    inst._implement_access_rows = lambda table, warnings=None: None
    inst._implement_grant = lambda *a: None
    warnings = inst._implement_share("N01-U01", "main.inspire.churn_out", spec, {"app": "sales-desk"}, None)
    assert ("Sharing App: sales-desk belongs to use case N01-U07, so Inspire did not share it with planners; that use case's sharing "
            "decides who opens it") in warnings
    moved = {"app": {"state": "ready", "merged_into": "other-desk"}}
    assert any(w.startswith("Sharing App: sales-desk belongs to use case N01-U07") for w in
               inst._implement_share("N01-U01", "main.inspire.churn_out", spec, {"app": "sales-desk"}, None, asset_status=moved)), \
        "pages that went to another App give no right to share this one"


def test_a_use_case_whose_pages_live_in_another_app_adds_its_people_to_it_and_removes_no_one(agent_ns):
    spec = _spec(agent_ns)[0]
    inst = _inspire(agent_ns, FakeSpark())
    calls = []

    def api(method, path, body=None, query=None):
        calls.append((method, path, body))
        if path == "/api/2.0/apps/sales-desk":
            return dict(HOST_APP)
        if path == "/api/2.0/permissions/apps/sales-desk":
            return {"access_control_list": [{"group_name": "sales", "all_permissions": [{"permission_level": "CAN_USE"}]}]}
        return {}

    inst._implement_api = api
    inst._implement_access_rows = lambda table, warnings=None: None
    hosted = {"app": {"state": "ready", "merged_into": "sales-desk", "page": "n01_u01"}}
    warnings = inst._implement_share("N01-U01", "main.inspire.churn_out", spec, {"app": "sales-desk"}, None, asset_status=hosted)
    assert not any(w.startswith("Sharing App") for w in warnings), warnings
    patched = [body for method, path, body in calls if method == "PATCH" and path == "/api/2.0/permissions/apps/sales-desk"]
    assert patched == [{"access_control_list": [{"group_name": "planners", "permission_level": "CAN_USE"}]}], \
        "only this use case's people are added; the App's other users are never part of the change"
    assert not any(method in ("PUT", "DELETE") and "permissions" in path for method, path, _b in calls)
