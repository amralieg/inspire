"""Uninstalling an App, a dashboard or a Genie Agent that other use cases share takes only this use case's part out of it, keeps it
live for them, and never deletes it, with the sharing checked again when the job runs, offline."""
import json

import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import OURS_APP, _app_shell, _churn_page, _dashboard, _inspire, _left_by
from v142_merge_test import DASH, HOST_APP, HOST_BOARD, SOURCE, _genie_answer, _host_files, _host_page, _normalized, _serve_files
from v143_vibes_test import BUILT, LIVE, _locked, _run

KEY = (5150, "N01-U01", 3)
HOST = {"session_id": 777, "use_case_id": "N01-U07", "joining": False, "name": "Sales desk", "status": {}}
OURS_PREFIX = "s5150_n01_u01_"
LABEL = "For use case N01-U01 Predict churn, whose results are in `main.inspire.churn_out`:"
APP_RESOURCES = [{"name": "sql-warehouse", "sql_warehouse": {"id": "whA", "permission": "CAN_USE"}},
                 {"name": "job-n07", "job": {"id": "70", "permission": "CAN_MANAGE_RUN"}},
                 {"name": "job-n01-u01-s5150", "job": {"id": "77", "permission": "CAN_MANAGE_RUN"}}]


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


def _sharing(inst, rows, carried):
    inst.selected = []
    inst._implement_select = lambda where, args, order=None: inst.selected.append((where, args)) or [dict(r) for r in rows]
    inst._implement_carried = lambda target: carried.get(target["use_case_id"], ({}, {}))


def _taker(ns, routes, rows=(), carried=None, tmp_path=None):
    inst = _inspire(ns, FakeSpark())
    inst.updates = []
    inst._implement_update = lambda key, **f: inst.updates.append(f)
    inst._implement_api, inst.calls = _router(routes)
    _sharing(inst, rows, carried or {})
    if tmp_path is not None:
        inst.local_log_output_dir = str(tmp_path)
    return inst


def _deleted(calls):
    return [c[1] for c in calls if c[0] == "DELETE"]


def test_a_joiner_takes_only_its_own_dashboard_pages_widgets_and_datasets_out(agent_ns):
    ours = json.loads(_dashboard())
    ours["pages"].append({"name": "gf", "pageType": "PAGE_TYPE_GLOBAL_FILTERS", "layout": [
        {"widget": {"name": "f", "queries": [{"name": "q", "query": {"datasetName": "decision_list"}}]},
         "position": {"x": 0, "y": 0, "width": 2, "height": 2}}]})
    merged, problems = agent_ns["implement_merge_dashboard"](HOST_BOARD, ours, OURS_PREFIX, "N01-U01")
    assert problems == [] and len(merged["pages"]) == 3
    board, problems = agent_ns["implement_dashboard_take_out"](merged, prefix=OURS_PREFIX)
    assert problems == []
    assert board["pages"] == HOST_BOARD["pages"] and board["datasets"] == HOST_BOARD["datasets"], \
        "the host's pages, filters and datasets come back exactly as they were"
    again, problems = agent_ns["implement_dashboard_take_out"](board, prefix=OURS_PREFIX)
    assert (again, problems) == (board, []), "taking out a part that is no longer there changes nothing"


def test_a_host_leaving_its_dashboard_keeps_only_the_pages_of_the_use_cases_that_still_hold_it(agent_ns):
    theirs = json.loads(_dashboard(("main.inspire.sales_out",)))
    theirs["pages"].append({"name": "gf", "pageType": "PAGE_TYPE_GLOBAL_FILTERS", "layout": [
        {"widget": {"name": "f", "queries": [{"name": "q", "query": {"datasetName": "decision_list"}}]},
         "position": {"x": 0, "y": 1, "width": 2, "height": 2}}]})
    board, _p = agent_ns["implement_merge_dashboard"](HOST_BOARD, theirs, "s777_n01_u07_", "N01-U07")
    left, problems = agent_ns["implement_dashboard_take_out"](board, keep_prefixes=["s777_n01_u07_"])
    assert problems == []
    assert [p["name"] for p in left["pages"]] == ["filters", "s777_n01_u07_p"], "the shared filters page stays for their filter"
    assert [i["widget"]["name"] for i in left["pages"][0]["layout"]] == ["s777_n01_u07_f"]
    assert left["pages"][0]["layout"][0]["position"]["y"] == 0, "their filter moves up into the space the host's filter left"
    assert [d["name"] for d in left["datasets"]] == ["s777_n01_u07_decision_list"]
    empty, problems = agent_ns["implement_dashboard_take_out"](HOST_BOARD, keep_prefixes=["s777_n01_u07_"])
    assert problems == ["no page of the other use cases would be left in it"]


def test_a_genie_joiner_takes_out_its_questions_instructions_and_the_tables_only_it_needs(agent_ns):
    merge = agent_ns["implement_merge_genie_space"]
    host = _normalized(agent_ns, ("main.inspire.sales_out", "main.s.stores"), "Which stores lag?", "Sales are in dollars.")
    ours = _normalized(agent_ns, ("main.inspire.churn_out", "main.s.orders", "main.s.stores"), "Who leaves next?", "Churn is monthly.")
    merged, record, _p = merge(host, ours, {}, LABEL)
    assert sorted(record["tables"]) == ["main.inspire.churn_out", "main.s.orders"]
    space, problems = agent_ns["implement_genie_take_out"](merged, record=record)
    assert problems == []
    assert [t["identifier"] for t in space["data_sources"]["tables"]] == ["main.inspire.sales_out", "main.s.stores"]
    assert ["".join(q["question"]) for q in space["config"]["sample_questions"]] == ["Which stores lag?"]
    assert "".join(space["instructions"]["text_instructions"][0]["content"]) == "Sales are in dollars."
    assert [e["question"] for e in space["instructions"]["example_question_sqls"]] == [["Which stores lag?"]]
    kept = json.loads(json.dumps(merged))
    for item in kept["instructions"]["example_question_sqls"]:
        if item["question"] == ["Which stores lag?"]:
            item["sql"] = ["SELECT * FROM main.s.orders JOIN main.inspire.sales_out USING (id)"]
    still, _p = agent_ns["implement_genie_take_out"](kept, record=record)
    assert "main.s.orders" in [t["identifier"] for t in still["data_sources"]["tables"]], \
        "a table this use case added that another use case's SQL still reads stays"
    used, _p = agent_ns["implement_genie_take_out"](merged, record=record, keep_records=[{"space_id": "gA", "uses": ["main.inspire.churn_out"]}])
    assert "main.inspire.churn_out" in [t["identifier"] for t in used["data_sources"]["tables"]], \
        "a table this use case added that another use case that joined later also uses stays"
    assert agent_ns["implement_genie_take_out"](space, record=record) == (space, []), "a part already gone changes nothing"


def test_a_genie_host_leaving_keeps_only_what_the_use_cases_that_still_hold_it_added(agent_ns):
    merge = agent_ns["implement_merge_genie_space"]
    label = "For use case N01-U07 Sales, whose results are in `main.inspire.sales_out`:"
    ours = _normalized(agent_ns, ("main.inspire.churn_out", "main.s.orders"), "Who leaves next?", "Churn is monthly.")
    theirs = _normalized(agent_ns, ("main.inspire.sales_out", "main.s.orders"), "Which stores lag?", "Sales are in dollars.")
    merged, record, _p = merge(ours, theirs, {}, label)
    assert record["tables"] == ["main.inspire.sales_out"] and record["uses"] == ["main.inspire.sales_out", "main.s.orders"]
    space, problems = agent_ns["implement_genie_take_out"](merged, keep_records=[record])
    assert problems == []
    assert [t["identifier"] for t in space["data_sources"]["tables"]] == ["main.inspire.sales_out", "main.s.orders"], \
        "a table the host added first stays when a use case that stays uses it too"
    assert ["".join(q["question"]) for q in space["config"]["sample_questions"]] == ["Which stores lag?"]
    assert "".join(space["instructions"]["text_instructions"][0]["content"]) == f"{label}\nSales are in dollars."
    empty, problems = agent_ns["implement_genie_take_out"](ours, keep_records=[{"tables": [], "text": ""}])
    assert problems == ["no table of the other use cases would be left in it"]


def test_a_shared_dashboard_is_never_deleted_its_own_pages_come_out_and_it_is_published_again(agent_ns):
    ours = json.loads(_dashboard())
    merged, _p = agent_ns["implement_merge_dashboard"](HOST_BOARD, ours, OURS_PREFIX, "N01-U01")
    current = dict(DASH, serialized_dashboard=json.dumps(merged))
    routes = {("GET", "/api/2.0/lakeview/dashboards/dA"): current, ("PATCH", "/api/2.0/lakeview/dashboards/dA"): {"etag": "e2"},
              ("POST", "/api/2.0/lakeview/dashboards/dA/published"): {}}
    rows = [{"session_id": 777, "use_case_id": "N01-U07"}]
    inst = _taker(agent_ns, routes, rows, {"N01-U07": ({"dashboard_id": "dA"}, {})})
    outcome = inst._implement_delete_output("dashboard", "dA", KEY, status={"state": "ready", "merged_into": "dA"})
    assert _deleted(inst.calls) == [], "a dashboard another use case still holds is never deleted"
    patched = json.loads(next(c[2] for c in inst.calls if c[0] == "PATCH")["serialized_dashboard"])
    assert patched["pages"] == HOST_BOARD["pages"] and patched["datasets"] == HOST_BOARD["datasets"]
    assert next(c[2] for c in inst.calls if c[1].endswith("/published")) == {"warehouse_id": "whA", "embed_credentials": False}
    assert outcome == {"state": "released", "warnings": [], "refused": False, "taken_out_of": "dA", "stays_for": ["N01-U07"],
                       "note": "this use case's pages were taken out of the dashboard Sales board (dA), which Inspire published again; "
                               "it stays for use case N01-U07", "grants_left": None}, \
        "with no access on record and no one this use case shared with, nothing is left to take back"
    assert inst.updates == [{"dashboard_id": None, "dashboard_url": None}], "this version no longer holds the dashboard"
    ended = [e for e in inst.emitted if e.get("step_name") == "Dashboard"]
    assert ended[-1]["status"] == "ended_success" and ended[-1]["message"] == outcome["note"]
    assert ended[0]["status"] == "started" and ended[0]["message"].startswith("use case N01-U07 also uses the dashboard dA")


def test_a_failed_republish_puts_the_dashboard_back_and_fails_the_version_without_deleting(agent_ns):
    ours = json.loads(_dashboard())
    merged, _p = agent_ns["implement_merge_dashboard"](HOST_BOARD, ours, OURS_PREFIX, "N01-U01")
    current = dict(DASH, serialized_dashboard=json.dumps(merged))
    routes = {("GET", "/api/2.0/lakeview/dashboards/dA"): current, ("PATCH", "/api/2.0/lakeview/dashboards/dA"): {},
              ("POST", "/api/2.0/lakeview/dashboards/dA/published"): RuntimeError("the warehouse is stopped")}
    inst = _taker(agent_ns, routes, [{"session_id": 777, "use_case_id": "N01-U07"}], {"N01-U07": ({"dashboard_id": "dA"}, {})})
    with pytest.raises(agent_ns["ImplementBlocked"], match=r"could not be published again without this use case's pages \(the warehouse "
                                                           r"is stopped\), so Inspire put its pages back as they were"):
        inst._implement_delete_output("dashboard", "dA", KEY, status={"merged_into": "dA"})
    patches = [c[2] for c in inst.calls if c[0] == "PATCH"]
    assert len(patches) == 2 and patches[1]["serialized_dashboard"] == json.dumps(merged) and _deleted(inst.calls) == []


def test_a_shared_dashboard_inspire_may_not_change_says_how_to_take_this_use_case_out_of_it(agent_ns):
    ours = json.loads(_dashboard())
    merged, _p = agent_ns["implement_merge_dashboard"](HOST_BOARD, ours, OURS_PREFIX, "N01-U01")
    routes = {("GET", "/api/2.0/lakeview/dashboards/dA"): dict(DASH, serialized_dashboard=json.dumps(merged)),
              ("PATCH", "/api/2.0/lakeview/dashboards/dA"): RuntimeError("PERMISSION_DENIED: you cannot edit dA")}
    inst = _taker(agent_ns, routes, [{"session_id": 777, "use_case_id": "N01-U07"}], {"N01-U07": ({"dashboard_id": "dA"}, {})})
    inst._implement_builder_label = lambda: "Inspire Runner"
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        inst._implement_delete_output("dashboard", "dA", KEY, status={"merged_into": "dA"})
    assert str(raised.value) == ("Inspire builds as Inspire Runner, which can open the dashboard dA that use case N01-U07 also uses but "
                                 "cannot change it, so Inspire did not take this use case's part out of it: ask its owner in the workspace to "
                                 "give Inspire Runner Can manage on it, then uninstall it again")
    assert _deleted(inst.calls) == []


def test_a_shared_genie_agent_loses_only_this_use_cases_part_and_is_never_deleted(agent_ns):
    host = _normalized(agent_ns, ("main.inspire.sales_out",), "Which stores lag?", "Sales are in dollars.")
    ours = _normalized(agent_ns, ("main.inspire.churn_out",), "Who leaves next?", "Churn is monthly.")
    merged, record, _p = agent_ns["implement_merge_genie_space"](host, ours, {}, LABEL)
    routes = {("GET", "/api/2.0/genie/spaces/gA"): _genie_answer("gA", merged), ("PATCH", "/api/2.0/genie/spaces/gA"): {}}
    inst = _taker(agent_ns, routes, [{"session_id": 777, "use_case_id": "N01-U07"}], {"N01-U07": ({"genie_space_id": "gA"}, {})})
    outcome = inst._implement_delete_output("genie_space", "gA", KEY,
                                            status={"merged_into": "gA", "merged": dict(record, space_id="gA")})
    assert _deleted(inst.calls) == []
    space = json.loads(next(c[2] for c in inst.calls if c[0] == "PATCH")["serialized_space"])
    assert [t["identifier"] for t in space["data_sources"]["tables"]] == ["main.inspire.sales_out"]
    assert ["".join(q["question"]) for q in space["config"]["sample_questions"]] == ["Which stores lag?"]
    assert outcome["note"] == ("this use case's tables, instructions and sample questions were taken out of the Genie Agent Sales "
                               "questions (gA); it stays for use case N01-U07") and outcome["taken_out_of"] == "gA"


def test_a_genie_agent_whose_parts_inspire_cannot_tell_apart_is_left_as_it_is_with_a_warning(agent_ns):
    host = _normalized(agent_ns, ("main.inspire.sales_out",), "Which stores lag?", "Sales are in dollars.")
    routes = {("GET", "/api/2.0/genie/spaces/gA"): _genie_answer("gA", host)}
    joined = dict(HOST, use_case_id="N01-U08", status={"merged_into": "gA"})
    inst = _taker(agent_ns, routes)
    inst._implement_output_holders = lambda name, asset, key: [joined]
    outcome = inst._implement_delete_output("genie_space", "gA", KEY, status={})
    assert outcome["refused"] is True and not [c for c in inst.calls if c[0] in ("PATCH", "DELETE")]
    assert outcome["warnings"] == ["Genie Agent: Inspire has no record of which tables, instructions and sample questions use case N01-U08 "
                                   "added to Sales questions (gA), so it cannot tell this use case's part from theirs and left it as it "
                                   "is; it stays for use case N01-U08"]


def _hub(ns, tmp_path, monkeypatch, owner="Inspire use case N01-U07 (session 777): Sales desk", ours_id="n01_u01_s5150", extra=()):
    core = _app_shell(ns, tmp_path)[1]["shell_core"]
    ours = dict(_host_page(ns, "N01-U01", "Churn desk"), id=ours_id)
    pages = [_host_page(ns)] + [ours] + list(extra)
    files = _host_files(ns, tmp_path, pages=pages)
    settings = json.loads(files[f"{SOURCE}/inspire_app.json"])
    settings["jobs"] = {"n01_u07": "70", ours_id: "77"}
    files[f"{SOURCE}/inspire_app.json"] = json.dumps(settings)
    _serve_files(ns, monkeypatch, files)
    app = dict(HOST_APP, description=owner, resources=list(APP_RESOURCES), user_api_scopes=[])
    return core, app


def _app_taker(ns, tmp_path, monkeypatch, app, holders, extra_routes=None):
    routes = {("GET", "/api/2.0/apps/sales-desk"): app, ("PATCH", "/api/2.0/apps/sales-desk"): {},
              ("POST", "/api/2.0/workspace/delete"): {}, **(extra_routes or {})}
    inst = _taker(ns, routes, tmp_path=tmp_path)
    inst._implement_output_holders = lambda name, asset, key: [dict(h) for h in holders]
    inst._implement_api_items = lambda path, key, query=None: []
    inst._implement_root_dir = "/W/inspire"
    inst.business_name = "Acme"
    inst.deployed = []
    inst._implement_deploy_app = (lambda context, name, files, reads, space_id="", lakebase=None, page_tables=():
                                  inst.deployed.append((name, files, reads, space_id, context["app_host"]["source"]))
                                  or {"app_name": name, "app_url": "https://sales-desk.example", "app_health": "passed"})
    return inst


def test_a_joining_use_case_leaves_a_hub_app_by_taking_out_its_page_and_deploying_the_rest(agent_ns, tmp_path, monkeypatch):
    _core, app = _hub(agent_ns, tmp_path, monkeypatch)
    inst = _app_taker(agent_ns, tmp_path, monkeypatch, app, [dict(HOST, status={})])
    outcome = inst._implement_delete_output("app", "sales-desk", KEY,
                                            status={"state": "ready", "merged_into": "sales-desk", "page": "n01_u01_s5150"})
    assert _deleted(inst.calls) == [], "an App another use case still holds is never deleted"
    name, files, reads, _space, source = inst.deployed[0]
    settings = json.loads(files["inspire_app.json"])
    assert name == "sales-desk" and source == SOURCE and settings["pages"] == ["n01_u07"] and "pages/n01_u01_s5150.json" not in files
    assert settings["jobs"] == {"n01_u07": "70"} and settings["title"] == "N01-U07 Sales desk", "a joiner leaving keeps the host's App"
    patch = next(c[2] for c in inst.calls if c[0] == "PATCH")
    assert patch["description"] == app["description"], "the host keeps owning it"
    assert [r["name"] for r in patch["resources"]] == ["sql-warehouse", "job-n07"], "the App can no longer start runs of this use case's job"
    assert outcome["note"] == ("this use case's pages were taken out of the App sales-desk, which Inspire deployed again; it stays for use "
                               "case N01-U07") and outcome["taken_out_of"] == "sales-desk"
    assert not [c for c in inst.calls if c[1] == "/api/2.0/workspace/delete"], "the host's source folder is left where it is"


def test_the_owner_leaving_a_shared_app_hands_it_to_a_use_case_that_stays_and_moves_its_source_out_of_its_own_folder(
        agent_ns, tmp_path, monkeypatch):
    joiner = dict(_host_page(agent_ns, "N01-U08", "Stock desk"), id="n01_u08_s5150")
    _core, app = _hub(agent_ns, tmp_path, monkeypatch, owner=OURS_APP, ours_id="n01_u01", extra=[joiner])
    files = {k: v for k, v in _host_files(agent_ns, tmp_path, pages=[_host_page(agent_ns, "N01-U01", "Churn desk"),
                                                                        _host_page(agent_ns, "N01-U07", "Sales desk"), joiner],
                                           title="N01-U01 Predict churn").items()}
    _serve_files(agent_ns, monkeypatch, files)
    heirs = [dict(HOST, session_id=5150, use_case_id="N01-U08", name="Stock desk", status={"merged_into": "sales-desk", "page": "n01_u08_s5150"}),
             dict(HOST, session_id=5150, use_case_id="N01-U07", name="Sales desk", status={"merged_into": "sales-desk", "page": "n01_u07"})]
    inst = _app_taker(agent_ns, tmp_path, monkeypatch, app, heirs)
    outcome = inst._implement_delete_output("app", "sales-desk", KEY, status={"state": "ready"})
    assert _deleted(inst.calls) == []
    _name, deployed, _reads, _space, source = inst.deployed[0]
    settings = json.loads(deployed["inspire_app.json"])
    assert settings["pages"] == ["n01_u07", "n01_u08_s5150"]
    assert settings["title"] == "N01-U07 Sales desk", "the use case whose page now comes first owns the App"
    assert source == "/W/inspire/acme/apps/sales-desk", "its source moves out of the leaving use case's folder, which an uninstall deletes"
    patch = next(c[2] for c in inst.calls if c[0] == "PATCH")
    assert patch["description"] == "Inspire use case N01-U07 (session 5150): Sales desk"
    assert agent_ns["implement_app_owner"]({"description": patch["description"]}) == ("N01-U07", "5150")
    assert ("POST", "/api/2.0/workspace/delete", {"path": SOURCE, "recursive": True}, None) in inst.calls, "the old source folder goes"
    assert outcome["note"].startswith("this use case's pages were taken out of the App sales-desk, which Inspire deployed again; use case "
                                      "N01-U07 now owns it and its source is in /W/inspire/acme/apps/sales-desk")


def test_a_shared_app_with_no_page_of_the_others_is_refused_and_never_deleted(agent_ns, tmp_path, monkeypatch):
    _core, app = _hub(agent_ns, tmp_path, monkeypatch, owner=OURS_APP, ours_id="n01_u01")
    files = _host_files(agent_ns, tmp_path, pages=[_host_page(agent_ns, "N01-U01", "Churn desk")], title="N01-U01 Predict churn")
    _serve_files(agent_ns, monkeypatch, files)
    inst = _app_taker(agent_ns, tmp_path, monkeypatch, app, [dict(HOST, joining=True)])
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        inst._implement_delete_output("app", "sales-desk", KEY, status={})
    assert str(raised.value) == ("the App sales-desk holds no page of use case N01-U07, which also uses it, so Inspire neither deleted it nor "
                                 "deployed it again without this use case's pages; use case N01-U07 is adding itself to it right now, so "
                                 "uninstall it again once its build ends")
    assert _deleted(inst.calls) == [] and inst.deployed == []
    _serve_files(agent_ns, monkeypatch, files)
    held = _app_taker(agent_ns, tmp_path, monkeypatch, app, [dict(HOST, status={})])
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        held._implement_delete_output("app", "sales-desk", KEY, status={})
    assert str(raised.value).endswith("without this use case's pages; build use case N01-U07 again, which adds its page, then uninstall it "
                                      "again")


def test_the_job_checks_sharing_again_and_counts_a_use_case_joining_right_now(agent_ns):
    rows = [{"session_id": 9, "use_case_id": "N02-U01", "spec_version": 4, "status": "building_outputs",
             "spec_json": {"use_case_name": "Forecast demand", "outputs": {"merge": {"dashboard": "dA"}}}},
            {"session_id": 9, "use_case_id": "N02-U02", "spec_version": 1, "status": "failed",
             "spec_json": {"outputs": {"merge": {"dashboard": "dA"}}}},
            {"session_id": 777, "use_case_id": "N01-U07", "spec_version": 2, "status": "ready", "spec_json": {"use_case_name": "Sales"}}]
    inst = _taker(agent_ns, {}, rows, {"N01-U07": ({"dashboard_id": "dA"}, {"dashboard": {"state": "ready"}})})
    holders = inst._implement_output_holders("dashboard", "dA", KEY)
    assert inst.selected == [("(`dashboard_id` = :asset OR CAST(spec_json:outputs.merge.dashboard AS STRING) = :asset) "
                              "AND NOT (session_id = :sid AND use_case_id = :uc)", {"asset": "dA", "sid": 5150, "uc": "N01-U01"})]
    assert [(h["session_id"], h["use_case_id"], h["joining"], h["name"]) for h in holders] == [
        (9, "N02-U01", True, "Forecast demand"), (777, "N01-U07", False, "Sales")], \
        "a use case whose build is adding itself now holds it; one whose join failed does not"
    assert holders[1]["status"] == {"state": "ready"}


def test_a_build_still_running_is_every_status_before_a_version_is_ready(agent_ns):
    statuses = agent_ns["IMPLEMENT_STATUSES"]
    assert agent_ns["IMPLEMENT_ACTIVE_STATUSES"] == statuses[:statuses.index("ready")]


def test_an_asset_shared_when_the_page_read_it_but_alone_when_the_job_runs_is_deleted(agent_ns):
    routes = {("DELETE", "/api/2.0/lakeview/dashboards/dA"): {}}
    inst = _taker(agent_ns, routes, [{"session_id": 777, "use_case_id": "N01-U07", "status": "ready"}],
                  {"N01-U07": ({"dashboard_id": "dB"}, {})})
    outcome = inst._implement_delete_output("dashboard", "dA", KEY, status={"merged_into": "dA"})
    assert _deleted(inst.calls) == ["/api/2.0/lakeview/dashboards/dA"] and outcome["state"] == "deleted"


def test_when_sharing_cannot_be_checked_nothing_is_deleted_or_changed_and_the_version_says_why(agent_ns):
    inst = _taker(agent_ns, {})

    def broken(where, args, order=None):
        raise RuntimeError("TABLE_OR_VIEW_NOT_FOUND: __inspire_implement")

    inst._implement_select = broken
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        inst._implement_delete_output("app", "sales-desk", KEY)
    assert str(raised.value) == ("App: Inspire could not check whether other use cases share sales-desk, so it neither deleted it nor took "
                                 "this use case's pages out of it: TABLE_OR_VIEW_NOT_FOUND: __inspire_implement; submit again")
    assert inst.calls == [] and inst.updates == []


def test_the_last_use_case_of_a_hub_whose_owner_already_left_may_delete_it(agent_ns):
    app = dict(HOST_APP, description="Inspire use case N01-U07 (session 777): Sales desk")
    routes = {("GET", "/api/2.0/apps/sales-desk"): app, ("DELETE", "/api/2.0/apps/sales-desk"): {}}
    inst = _taker(agent_ns, routes)
    inst._implement_app_leftovers = lambda name, dirs: []
    outcome = inst._implement_delete_output("app", "sales-desk", KEY, status={"merged_into": "sales-desk"})
    assert _deleted(inst.calls) == ["/api/2.0/apps/sales-desk"] and outcome["refused"] is False
    stranger = _taker(agent_ns, routes)
    refused = stranger._implement_delete_output("app", "sales-desk", KEY, status={})
    assert _deleted(stranger.calls) == [] and refused["refused"] is True, "an App this use case never joined is never deleted"


def test_a_deleted_app_whose_source_was_moved_out_of_a_use_case_folder_takes_that_folder_with_it(agent_ns):
    app = dict(json.loads(json.dumps(HOST_APP)), description=OURS_APP, active_deployment={"source_code_path": "/W/inspire/Acme/apps/sales-desk"})
    routes = {("GET", "/api/2.0/apps/sales-desk"): app, ("DELETE", "/api/2.0/apps/sales-desk"): {}}
    inst = _taker(agent_ns, routes)
    swept = []
    inst._implement_app_leftovers = lambda name, dirs: swept.append(list(dirs)) or []
    inst._implement_delete_output("app", "sales-desk", KEY, dirs=["/W/impl/N01/mvp"])
    assert swept == [["/W/impl/N01/mvp", "/W/inspire/Acme"]]


def test_uninstall_all_takes_this_use_case_out_of_every_shared_output_and_deletes_only_what_it_held_alone(agent_ns):
    inst, previous = _locked(agent_ns)
    inst._implement_notebook_paths = lambda uc, key: ("/W/impl/N01", "/W/impl/N01/nb")
    calls = []

    def api(method, path, body=None, query=None):
        calls.append((method, path))
        if method == "GET" and path.startswith("/api/2.0/apps/"):
            return {"description": OURS_APP}
        return {}

    inst._implement_api = api
    inst._implement_api_items = lambda path, key, query=None: []
    inst._implement_delete_digest = lambda uc, digest: []
    shared = dict(HOST, use_case_id="N02-U01", session_id=9)
    inst._implement_output_holders = lambda name, asset, key: [shared] if name == "dashboard" else []
    assert _run(inst, dict(previous, uninstall=True)) == "uninstalled"
    deleted = [p for m, p in calls if m == "DELETE"]
    assert "/api/2.0/lakeview/dashboards/d1" not in deleted
    assert {"/api/2.0/genie/spaces/g1", "/api/2.0/apps/churn-desk", "/api/2.0/alerts/al-1"} <= set(deleted)
    final = inst.updates[-1]
    assert final["status"] == "uninstalled" and final["asset_status"]["dashboard"]["state"] == "released"
    assert final["asset_status"]["dashboard"]["taken_out_of"] == "d1" and final["asset_status"]["dashboard"]["stays_for"] == ["N02-U01"]
    done = [e for e in inst.emitted if e.get("step_name") == "Done"][-1]
    assert done["message"] == ("uninstalled: the notebook, job and every output only this use case held are deleted; this use case's part "
                               "is taken out of the dashboard d1, which other use cases share and keep; the result tables and the history "
                               "are kept")


def test_a_cross_session_joiner_finds_its_own_page_and_never_the_hosts_page_of_the_same_use_case_id(agent_ns):
    pages = [_host_page(agent_ns, "N01-U01", "Host churn"), dict(_host_page(agent_ns, "N01-U01", "Our churn"), id="n01_u01_s5150")]
    own = agent_ns["implement_app_own_page_id"]
    assert own(pages, "N01-U01", 5150, "777") == "n01_u01_s5150"
    assert own(pages[:1], "N01-U01", 5150, "777") == "", "the host's page of the same use case id is never this use case's"
    assert own(pages[:1], "N01-U01", 777, "777") == "n01_u01"
    inst = _inspire(agent_ns, FakeSpark())
    host = dict(agent_ns["implement_app_host"]("sales-desk"), owner=("N01-U01", "777"), pages=pages, settings={})
    context = {"uc_id": "N01-U01", "asset_status": {}}
    assert inst._implement_app_own_page(context, host) == "n01_u01_s5150", "a repoint changes this use case's page, not the host's"


def test_after_a_hand_over_a_joiner_of_the_old_owners_session_rebuilds_its_own_page_in_place(agent_ns):
    old = dict(_host_page(agent_ns, "N01-U09", "Old"), id="n01_u09")
    host = dict(agent_ns["implement_app_host"]("sales-desk"), owner=("N01-U07", "5150"), merged=True, pages=[old], settings={
        "jobs": {}, "alerts": {}, "admin": ""})
    page = _host_page(agent_ns, "N01-U09", "New")
    settings = {"jobs": {"n01_u09": "90"}, "alerts": {}, "built_at": "t", "version": 2}
    merge = agent_ns["implement_app_merge"]
    _s, pages, mine = merge(host, settings, page, 777, {}, "", "n01_u09")
    assert [p["id"] for p in pages] == ["n01_u09"] and mine["title"] == "New", "the page it recorded is replaced, not doubled"
    _s, pages, mine = merge(host, settings, page, 777, {}, "")
    assert [p["id"] for p in pages] == ["n01_u09", "n01_u09_s777"], "without its record a page of another session is never taken as its own"


def test_the_hand_over_picks_the_first_page_a_holder_still_owns_and_names_it(agent_ns):
    pages = [_host_page(agent_ns, "N09-U09", "Orphan"), dict(_host_page(agent_ns, "N02-U01", "Demand"), id="n02_u01_s9"),
             _host_page(agent_ns, "N01-U08", "Stock")]
    holders = [dict(HOST, session_id=5150, use_case_id="N01-U08", name="Stock desk"), dict(HOST, session_id=9, use_case_id="N02-U01", name="")]
    nxt = agent_ns["implement_app_next_owner"](pages, holders, "5150")
    assert nxt == {"use_case_id": "N02-U01", "session_id": "9", "name": "Demand", "page_id": "n02_u01_s9", "created_by": ""}
    assert agent_ns["implement_app_next_owner"]([], holders, "5150")["use_case_id"] == "N01-U08"
    settings, kept = agent_ns["implement_app_take_out"]({"jobs": {"n02_u01_s9": "1"}, "alerts": {}, "title": "x", "genie": None,
                                                         "genie_note": "n"}, pages, "n09_u09", nxt)
    assert [p["id"] for p in kept] == ["n02_u01_s9", "n01_u08"] and settings["title"] == "N02-U01 Demand"
    assert settings["jobs"] == {"n02_u01_s9": "1"} and settings["pages"] == ["n02_u01_s9", "n01_u08"]


def test_the_owner_leaving_moves_an_empty_alerts_folder_out_of_its_folder_and_leaves_one_people_use_where_it_is(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    old = "/W/inspire/acme/session_5150/Sales/N01-U01/mvp/alerts/sales-desk"
    listed = {old: []}
    inst._implement_folder_objects = lambda folder: listed[folder]
    settings = {"options": {"alerts": True}, "alert_folder": old}
    assert inst._implement_app_alerts_move(settings, "/W/inspire/acme", "sales-desk") == []
    assert settings["alert_folder"] == "/W/inspire/acme/alerts/sales-desk"
    listed[old] = [{"object_type": "ALERT", "path": f"{old}/late stock"}]
    settings = {"options": {"alerts": True}, "alert_folder": old}
    assert inst._implement_app_alerts_move(settings, "/W/inspire/acme", "sales-desk") == [f"the alerts people set up in it stay in {old}"]
    assert settings["alert_folder"] == old, "alerts cannot be moved, so the folder that keeps them stays"
    off = {"options": {"alerts": False}, "alert_folder": ""}
    assert inst._implement_app_alerts_move(off, "/W/inspire/acme", "sales-desk") == [] and off["alert_folder"] == ""


def test_a_lakebase_app_drops_the_copies_only_the_leaving_page_read(agent_ns, tmp_path):
    pg = _app_shell(agent_ns, tmp_path)[1]["shell_pg"]
    pages = [{"id": "a", "result_table": "main.inspire.a_out"}, {"id": "b", "result_table": "main.inspire.b_out"}]
    backend = {"kind": "lakebase", "pipeline_id": "p1",
               "tables": {"main.inspire.a_out": {"pg": "s.a"}, "main.inspire.a_out__lb_rows": {"pg": "s.a_rows"},
                          "main.inspire.b_out": {"pg": "s.b"}, "main.inspire.b_out__lb_rows": {"pg": "s.b_rows"}},
               "datasets": {"a": {"rows": "main.inspire.a_out__lb_rows"}, "b": {"rows": "main.inspire.b_out__lb_rows"}}}
    kept = agent_ns["implement_app_kept_backend"](backend, pages[1:], pg)
    assert kept["datasets"] == {"b": {"rows": "main.inspire.b_out__lb_rows"}}
    assert sorted(kept["tables"]) == ["main.inspire.b_out", "main.inspire.b_out__lb_rows"]
    assert agent_ns["implement_app_kept_backend"]({"kind": "delta"}, pages, pg) == {"kind": "delta"}
