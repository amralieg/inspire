"""A use case output that Inspire saved and then could not finish is put back as it was, and a notebook that did not build is put
back so the job keeps running the last built version, offline."""
import base64
import json
import types

import pytest

from v120_artifacts_support import CapturingLogger, FakeSpark
from v140_implement_test import (GENIE_CHECKED, OURS_APP, READS, SHELL_FILES, VALID, _alert_inspire, _churn_page, _deploy_inspire,
                                 _FileRunner, _output_context, _output_inspire, _probe_inspire, _space, sdk_stub)
from v142_merge_test import DASH, HOST_BOARD, _dashboard_inspire, _genie_answer, _merge_flow, _normalized, _straight_loop

APP_DIR = "/W/acme_implemented/Sales/apps/churn-desk"
FAILED_DEPLOY = {"deployment_id": "dep1", "status": {"state": "FAILED", "message": "boom"}}


def _undo_lines(inst, level="WARNING"):
    return [m for lvl, m in inst.logger.records if lvl == level and m.startswith("[IMPLEMENT-UNDO")]


def _rounds_runner(ns, name, text, rounds=2):
    return _FileRunner([{"exit": 0}] * rounds, [{name: text}] * rounds)


def _page_rounds(ns, rounds=2):
    return _rounds_runner(ns, "page.json", json.dumps(_churn_page(ns)), rounds)


def test_a_dashboard_that_saved_but_did_not_publish_is_put_back_and_the_next_round_builds_it(agent_ns, tmp_path):
    routes = {("GET", "/api/2.0/lakeview/dashboards/d1"): DASH, ("PATCH", "/api/2.0/lakeview/dashboards/d1"): {},
              ("POST", "/api/2.0/lakeview/dashboards/d1/published"): [RuntimeError("INTERNAL_ERROR: publish failed"), {}]}
    inst, calls = _dashboard_inspire(agent_ns, tmp_path, routes)
    inst.logger = CapturingLogger()
    context = _output_context(agent_ns)
    context["assets"] = {"dashboard": "d1"}
    fields = inst._implement_dashboard(context, _page_rounds(agent_ns))
    assert fields["dashboard_id"] == "d1"
    assert [c[:2] for c in calls] == [("GET", "/api/2.0/lakeview/dashboards/d1"), ("PATCH", "/api/2.0/lakeview/dashboards/d1"),
                                      ("POST", "/api/2.0/lakeview/dashboards/d1/published"), ("PATCH", "/api/2.0/lakeview/dashboards/d1"),
                                      ("GET", "/api/2.0/lakeview/dashboards/d1"), ("PATCH", "/api/2.0/lakeview/dashboards/d1"),
                                      ("POST", "/api/2.0/lakeview/dashboards/d1/published")]
    assert calls[3][2] == {"display_name": "Sales board", "serialized_dashboard": json.dumps(HOST_BOARD), "warehouse_id": "whA"}, \
        "the undo writes back the definition, name and warehouse the dashboard had before this round"
    assert _undo_lines(inst) == ["[IMPLEMENT-UNDO] N01-U01: the Dashboard build failed after Inspire had saved changes, so Inspire put "
                                 "the Dashboard d1 back as it was: INTERNAL_ERROR: publish failed"]


def test_a_new_dashboard_that_did_not_publish_goes_to_the_trash(agent_ns, tmp_path):
    routes = {("POST", "/api/2.0/lakeview/dashboards"): [{"dashboard_id": "d9"}, {"dashboard_id": "d10"}],
              ("POST", "/api/2.0/lakeview/dashboards/d9/published"): RuntimeError("INTERNAL_ERROR: publish failed"),
              ("DELETE", "/api/2.0/lakeview/dashboards/d9"): {}, ("POST", "/api/2.0/lakeview/dashboards/d10/published"): {}}
    inst, calls = _dashboard_inspire(agent_ns, tmp_path, routes)
    inst.logger = CapturingLogger()
    fields = inst._implement_dashboard(_output_context(agent_ns), _page_rounds(agent_ns))
    assert fields["dashboard_id"] == "d10"
    assert ("DELETE", "/api/2.0/lakeview/dashboards/d9") in [c[:2] for c in calls]
    assert not any(c[:2] == ("DELETE", "/api/2.0/lakeview/dashboards/d10") for c in calls), "the dashboard that published stays"
    assert "moved the new Dashboard d9 to the trash" in _undo_lines(inst)[0]


def test_a_dashboard_merge_that_did_not_publish_gives_the_host_back_its_own_pages(agent_ns, tmp_path):
    routes = {("GET", "/api/2.0/lakeview/dashboards/dA"): DASH, ("PATCH", "/api/2.0/lakeview/dashboards/dA"): {"etag": "e2"},
              ("POST", "/api/2.0/lakeview/dashboards/dA/published"): RuntimeError("INTERNAL_ERROR: publish failed")}
    inst, calls = _dashboard_inspire(agent_ns, tmp_path, routes)
    inst.logger = CapturingLogger()
    context = _output_context(agent_ns, merge={"dashboard": "dA"})
    with pytest.raises(RuntimeError, match="still failed after"):
        inst._implement_dashboard(context, _page_rounds(agent_ns, rounds=3))
    patches = [c[2] for c in calls if c[:2] == ("PATCH", "/api/2.0/lakeview/dashboards/dA")]
    assert len(patches) == 6, "each of the three rounds merges once and is undone once"
    assert all(p == {"display_name": "Sales board", "serialized_dashboard": json.dumps(HOST_BOARD), "warehouse_id": "whA"}
               for p in patches[1::2])
    assert all("s5150_n01_u01_overview" in p["serialized_dashboard"] for p in patches[0::2])
    assert len(_undo_lines(inst)) == 3


def test_an_undo_that_fails_stops_the_build_and_names_both_errors(agent_ns, tmp_path):
    routes = {("GET", "/api/2.0/lakeview/dashboards/d1"): DASH,
              ("PATCH", "/api/2.0/lakeview/dashboards/d1"): [{}, RuntimeError("PERMISSION_DENIED: no CAN EDIT")],
              ("POST", "/api/2.0/lakeview/dashboards/d1/published"): RuntimeError("INTERNAL_ERROR: publish failed")}
    inst, calls = _dashboard_inspire(agent_ns, tmp_path, routes)
    context = _output_context(agent_ns)
    context["assets"] = {"dashboard": "d1"}
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        inst._implement_dashboard(context, _page_rounds(agent_ns))
    assert str(raised.value) == ("the Dashboard build failed after Inspire had saved changes (INTERNAL_ERROR: publish failed), and "
                                 "Inspire could not undo them: PERMISSION_DENIED: no CAN EDIT")
    assert sum(c[:2] == ("POST", "/api/2.0/lakeview/dashboards/d1/published") for c in calls) == 1, \
        "a dashboard left half changed is never handed back to Genie for another round"


def _genie_flow(ns, tmp_path, routes, smoke):
    inst, calls = _output_inspire(ns, tmp_path, {**GENIE_CHECKED, **routes})
    inst.logger = CapturingLogger()
    inst._implement_run_query_check = lambda sql, require_rows=False, limit=20: [{"n": 1}]
    answers = list(smoke)

    def smoked(space_id, question, **kw):
        answer = answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer

    inst._implement_genie_smoke = smoked
    return inst, calls


OK_SMOKE = {"attachments": [{"query": {"query": "SELECT COUNT(*) FROM main.inspire.churn_out"}}]}
NO_ANSWER = RuntimeError("the Genie Agent could not answer 'Which customers act now?': FAILED")


def test_a_new_genie_agent_that_could_not_answer_goes_to_the_trash_before_the_next_round(agent_ns, tmp_path):
    inst, calls = _genie_flow(agent_ns, tmp_path, {("POST", "/api/2.0/genie/spaces"): {"space_id": "s9"}}, [NO_ANSWER, OK_SMOKE])
    fields = inst._implement_genie_space(_output_context(agent_ns), _rounds_runner(agent_ns, "genie_space.json", _space(grounded=True)))
    assert fields["genie_space_id"] == "s9"
    assert [c[:2] for c in calls] == [("POST", "/api/2.0/genie/spaces"), ("DELETE", "/api/2.0/genie/spaces/s9"),
                                      ("POST", "/api/2.0/genie/spaces")]
    assert "moved the new Genie Agent s9 to the trash" in _undo_lines(inst)[0]


def test_this_use_cases_genie_agent_that_could_not_answer_is_put_back_as_it_was(agent_ns, tmp_path):
    before = _normalized(agent_ns, ("main.inspire.churn_out",), "Which customers left?", "Old instructions.")
    routes = {("GET", "/api/2.0/genie/spaces/g1"): {"title": "Old churn desk", "description": "old", "warehouse_id": "whOld",
                                                    "serialized_space": json.dumps(before)},
              ("PATCH", "/api/2.0/genie/spaces/g1"): {"space_id": "g1"}}
    inst, calls = _genie_flow(agent_ns, tmp_path, routes, [NO_ANSWER, OK_SMOKE])
    context = _output_context(agent_ns)
    context["assets"] = {"genie_space": "g1"}
    fields = inst._implement_genie_space(context, _rounds_runner(agent_ns, "genie_space.json", _space(grounded=True)))
    assert fields["genie_space_id"] == "g1"
    patches = [(c[2], c[3]) for c in calls if c[:2] == ("PATCH", "/api/2.0/genie/spaces/g1")]
    assert len(patches) == 3
    assert patches[1] == ({"title": "Old churn desk", "description": "old", "warehouse_id": "whOld",
                           "serialized_space": json.dumps(before)}, None)
    assert json.loads(patches[0][0]["serialized_space"]) != before and patches[0][0]["title"] != "Old churn desk"
    assert "put the Genie Agent g1 back as it was" in _undo_lines(inst)[0]


def test_a_genie_agent_that_is_gone_is_built_new_and_a_failed_new_one_goes_to_the_trash(agent_ns, tmp_path):
    routes = {("GET", "/api/2.0/genie/spaces/g1"): RuntimeError("RESOURCE_DOES_NOT_EXIST: space g1"),
              ("POST", "/api/2.0/genie/spaces"): {"space_id": "s9"}}
    rounds = agent_ns["IMPLEMENT_MAX_GENIE_ROUNDS"]
    inst, calls = _genie_flow(agent_ns, tmp_path, routes, [NO_ANSWER] * rounds)
    context = _output_context(agent_ns)
    context["assets"] = {"genie_space": "g1"}
    with pytest.raises(RuntimeError, match=f"still failed after {rounds} Genie rounds"):
        inst._implement_genie_space(context, _rounds_runner(agent_ns, "genie_space.json", _space(grounded=True), rounds))
    assert not any(c[0] == "PATCH" for c in calls), "a Genie Agent that is gone is never patched"
    assert [c[:2] for c in calls].count(("DELETE", "/api/2.0/genie/spaces/s9")) == rounds


def test_a_genie_agent_merge_that_could_not_answer_gives_the_host_back_its_own_definition(agent_ns, tmp_path):
    host = _normalized(agent_ns, ("main.inspire.sales_out", "main.s.stores"), "Which stores lag?", "Sales are in dollars.")
    routes = {("GET", "/api/2.0/genie/spaces/gA"): dict(_genie_answer("gA", host), description="sales", warehouse_id="whA"),
              ("PATCH", "/api/2.0/genie/spaces/gA"): {}, ("POST", "/api/2.0/genie/spaces/gA/start-conversation"): {}}
    inst, calls = _dashboard_inspire(agent_ns, tmp_path, routes, recorded=("gA",))
    inst.logger = CapturingLogger()
    inst._implement_run_query_check = lambda sql, require_rows=False, limit=20: [{"n": 1}]
    answers = [NO_ANSWER, OK_SMOKE]
    inst._implement_genie_smoke = lambda space_id, question, **kw: (_ for _ in ()).throw(answers.pop(0)) if isinstance(
        answers[0], Exception) else answers.pop(0)
    context = _output_context(agent_ns, merge={"genie_space": "gA"})
    fields = inst._implement_genie_space(context, _rounds_runner(agent_ns, "genie_space.json", _space(grounded=True)))
    assert fields["genie_space_id"] == "gA"
    patches = [c[2] for c in calls if c[:2] == ("PATCH", "/api/2.0/genie/spaces/gA")]
    assert len(patches) == 3
    assert patches[1] == {"title": "Sales questions", "description": "sales", "warehouse_id": "whA", "serialized_space": json.dumps(host)}
    assert "main.inspire.churn_out" in patches[0]["serialized_space"] and "main.inspire.churn_out" in patches[2]["serialized_space"]


def test_a_merged_app_that_did_not_deploy_leaves_every_genie_agent_as_it_was(agent_ns, tmp_path, monkeypatch):
    host_space = _normalized(agent_ns, ("main.inspire.sales_out", "main.s.stores"), "Which stores lag?", "Sales are in dollars.")
    ours = _normalized(agent_ns, ("main.inspire.churn_out", "main.s.orders"), "Which customers act now?", "Churn is monthly.")
    routes = {("GET", "/api/2.0/genie/spaces/gB"): _genie_answer("gB", ours, "Churn questions"),
              ("GET", "/api/2.0/genie/spaces/gA"): _genie_answer("gA", host_space), ("PATCH", "/api/2.0/genie/spaces/gA"): {},
              ("PATCH", "/api/2.0/genie/spaces/gB"): {}}
    inst, context, seen, calls = _merge_flow(agent_ns, tmp_path, monkeypatch, assets={"genie_space": "gB"}, routes=routes)
    inst.logger = CapturingLogger()
    inst._implement_genie_smoke = lambda space_id, question, **kw: {}
    _straight_loop(inst)
    deployed = []

    def deploy(*a, **k):
        deployed.append(a[2])
        raise RuntimeError("the App deployment FAILED: boom")

    inst._implement_deploy_app = deploy
    with pytest.raises(agent_ns["ImplementBlocked"], match="the page passed every check, then the App could not be deployed"):
        inst._implement_app(context, None)
    assert not any(c[0] == "PATCH" and "/genie/spaces/" in c[1] for c in calls), \
        "a merged App never writes the host's Genie Agent or this use case's, so a failed deploy has none to put back"
    assert _undo_lines(inst) == []
    pages = {json.loads(text)["use_case_id"]: json.loads(text) for path, text in deployed[0].items() if path.startswith("pages/")}
    assert set(pages) == {"N01-U07", "N01-U01"}
    assert pages["N01-U01"]["genie"]["space_id"] == "gB" and pages["N01-U01"]["genie_note"] == "", \
        "this use case's page asks its own Genie Agent"
    assert not pages["N01-U07"].get("genie"), "the host's own page is not handed this use case's Genie Agent"
    assert json.loads(deployed[0]["inspire_app.json"])["genie"]["space_id"] == "gA", "the host keeps its own Genie Agent"


def test_a_merged_app_whose_genie_agent_was_never_touched_has_nothing_to_undo(agent_ns, tmp_path, monkeypatch):
    inst, context, seen, calls = _merge_flow(agent_ns, tmp_path, monkeypatch, assets={"genie_space": "gA"})
    inst.logger = CapturingLogger()
    _straight_loop(inst)
    inst._implement_deploy_app = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("the App deployment FAILED: boom"))
    with pytest.raises(agent_ns["ImplementBlocked"]):
        inst._implement_app(context, None)
    assert not any(c[0] == "PATCH" for c in calls) and _undo_lines(inst) == []


def _old_app(**changes):
    return dict({"description": OURS_APP, "compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-2",
                 "active_deployment": {"deployment_id": "dep0"}}, **changes)


def _seed(inst, **texts):
    for relative, text in texts.items():
        inst.uploads[f"{APP_DIR}/{relative}"] = (text, True)


def test_an_existing_app_whose_deployment_failed_gets_its_files_back_and_keeps_running_its_earlier_deployment(agent_ns, sdk_stub):
    inst, context, calls, _imported = _deploy_inspire(agent_ns, [_old_app(), FAILED_DEPLOY, {}, {}, _old_app()])
    inst.logger = CapturingLogger()
    _seed(inst, **{"app.py": "old app\n", "app.yaml": "old yaml\n", "static/index.html": "<old/>\n"})
    with pytest.raises(RuntimeError, match="the App deployment FAILED: boom"):
        inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert {k[len(APP_DIR) + 1:]: v[0] for k, v in inst.uploads.items() if k.rsplit("/", 1)[-1] in ("app.py", "app.yaml", "index.html")} == \
        {"app.py": "old app\n", "app.yaml": "old yaml\n", "static/index.html": "<old/>\n"}
    assert [c[2] for c in calls if c[:2] == ("POST", "/api/2.0/workspace/delete")] == [
        {"path": f"{APP_DIR}/inspire_app.json"}, {"path": f"{APP_DIR}/pages/n01_u01.json"}], "files this build added are removed"
    assert [c[:2] for c in calls][-1] == ("GET", "/api/2.0/apps/churn-desk"), "no second deployment while the earlier one still runs"
    assert _undo_lines(inst) == ["[IMPLEMENT-UNDO] N01-U01: the App build failed after Inspire had saved changes, so Inspire put the "
                                 "App churn-desk's files back as they were; its earlier deployment kept running: the App deployment "
                                 "FAILED: boom"]


def test_a_partial_file_write_is_undone_too(agent_ns, sdk_stub):
    inst, context, calls, _imported = _deploy_inspire(agent_ns, [_old_app(), {}, {}, _old_app()])
    inst.logger = CapturingLogger()
    _seed(inst, **{"app.py": "old app\n", "app.yaml": "old yaml\n", "static/index.html": "<old/>\n"})
    real = inst._implement_api
    seen = []

    def api(method, path, body=None, query=None):
        if (method, path) == ("POST", "/api/2.0/workspace/import"):
            seen.append(body["path"])
            if len(seen) == 3:
                raise RuntimeError("TEMPORARILY_UNAVAILABLE: import failed")
        return real(method, path, body, query)

    inst._implement_api = api
    with pytest.raises(RuntimeError, match="import failed"):
        inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert inst.uploads[f"{APP_DIR}/app.py"][0] == "old app\n" and inst.uploads[f"{APP_DIR}/app.yaml"][0] == "old yaml\n"
    assert not any(c[1].endswith("/deployments") for c in calls), "nothing deploys from half-written files"
    assert "put the App churn-desk's files back as they were" in _undo_lines(inst)[0]


def test_a_new_app_that_failed_is_stopped(agent_ns, sdk_stub):
    inst, context, calls, _imported = _deploy_inspire(agent_ns, [
        RuntimeError("RESOURCE_DOES_NOT_EXIST: app churn-desk"), {"compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-1"},
        FAILED_DEPLOY, {"compute_status": {"state": "ACTIVE"}}, {}])
    inst.logger = CapturingLogger()
    with pytest.raises(RuntimeError, match="FAILED: boom"):
        inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert [c[:2] for c in calls][-2:] == [("GET", "/api/2.0/apps/churn-desk"), ("POST", "/api/2.0/apps/churn-desk/stop")]
    assert "stopped the new App churn-desk" in _undo_lines(inst)[0]


def test_an_app_whose_new_deployment_went_live_then_failed_is_deployed_again_from_its_old_files(agent_ns, sdk_stub):
    inst, context, calls, _imported = _deploy_inspire(agent_ns, [
        _old_app(), {"deployment_id": "dep1", "status": {"state": "SUCCEEDED"}}, {"url": "https://churn-desk.example/"},
        {}, {}, _old_app(active_deployment={"deployment_id": "dep1"}), {"deployment_id": "dep2", "status": {"state": "SUCCEEDED"}}])
    inst.logger = CapturingLogger()
    inst._implement_app_health = lambda *a: (_ for _ in ()).throw(RuntimeError("the App did not answer /health"))
    _seed(inst, **{"app.py": "old app\n", "app.yaml": "old yaml\n", "static/index.html": "<old/>\n"})
    with pytest.raises(RuntimeError, match="did not answer /health"):
        inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    deploys = [c[2] for c in calls if c[:2] == ("POST", "/api/2.0/apps/churn-desk/deployments")]
    assert deploys == [{"source_code_path": APP_DIR, "mode": "SNAPSHOT"}] * 2
    assert inst.uploads[f"{APP_DIR}/app.py"][0] == "old app\n", "the second deployment is made from the files put back"
    assert "put the App churn-desk's files back as they were and deployed them again" in _undo_lines(inst)[0]


@pytest.mark.parametrize("live,needle,stop", [
    ({"deployment_id": "dep1"}, "put the App churn-desk's files back as they were and stopped it, since it had no deployment before", True),
    ({}, "put the App churn-desk's files back as they were; it had no deployment before and still has none", False),
], ids=["went_live", "never_deployed"])
def test_an_app_that_had_no_deployment_before_is_never_left_running_the_failed_build(agent_ns, sdk_stub, live, needle, stop):
    answers = [_old_app(active_deployment={}), {"deployment_id": "dep1", "status": {"state": "SUCCEEDED"}},
               {"url": "https://churn-desk.example/"}, {}, {}, {}, {}, {}, _old_app(active_deployment=live), {}]
    inst, context, calls, _imported = _deploy_inspire(agent_ns, answers)
    inst.logger = CapturingLogger()
    inst._implement_app_health = lambda *a: (_ for _ in ()).throw(RuntimeError("the App did not answer /health"))
    with pytest.raises(RuntimeError, match="did not answer /health"):
        inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert (("POST", "/api/2.0/apps/churn-desk/stop") in [c[:2] for c in calls]) is stop
    assert sum(c[:2] == ("POST", "/api/2.0/apps/churn-desk/deployments") for c in calls) == 1
    assert needle in _undo_lines(inst)[0]


@pytest.mark.parametrize("deployed,needle", [
    ([FAILED_DEPLOY], "put the App churn-desk's files back as they were and stopped it again, as it was stopped before"),
    ([{"deployment_id": "dep1", "status": {"state": "SUCCEEDED"}}, {"url": "https://churn-desk.example/"}],
     "put the App churn-desk's files back as they were, deployed them again and stopped it again, as it was stopped before"),
], ids=["deploy_failed", "went_live"])
def test_a_stopped_app_that_this_build_started_is_stopped_again(agent_ns, sdk_stub, deployed, needle):
    stopped = _old_app(compute_status={"state": "STOPPED"})
    live = deployed[0]["status"]["state"] == "SUCCEEDED"
    answers = ([stopped, {}, _old_app()] + deployed + [{}, {}, _old_app(active_deployment={"deployment_id": "dep1"} if live else
                                                                       {"deployment_id": "dep0"})]
               + ([{"deployment_id": "dep2", "status": {"state": "SUCCEEDED"}}] if live else []) + [{}])
    inst, context, calls, _imported = _deploy_inspire(agent_ns, answers)
    inst.logger = CapturingLogger()
    inst._implement_app_health = lambda *a: (_ for _ in ()).throw(RuntimeError("the App did not answer /health"))
    _seed(inst, **{"app.py": "old app\n", "app.yaml": "old yaml\n", "static/index.html": "<old/>\n"})
    with pytest.raises(RuntimeError):
        inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    paths = [c[:2] for c in calls]
    assert paths[1] == ("POST", "/api/2.0/apps/churn-desk/start") and paths[-1] == ("POST", "/api/2.0/apps/churn-desk/stop")
    assert sum(p == ("POST", "/api/2.0/apps/churn-desk/deployments") for p in paths) == (2 if live else 1), \
        "an App that went live on the failed build gets its earlier files deployed before it is stopped, so a later start runs them"
    assert needle in _undo_lines(inst)[0]


def test_an_app_that_fails_before_any_change_is_left_alone(agent_ns, sdk_stub):
    inst, context, calls, imported = _deploy_inspire(agent_ns, [_old_app()])
    inst.logger = CapturingLogger()
    inst._implement_tag_app = lambda context, app_name: (_ for _ in ()).throw(RuntimeError("PERMISSION_DENIED: cannot tag"))
    with pytest.raises(RuntimeError, match="cannot tag"):
        inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert [c[:2] for c in calls] == [("GET", "/api/2.0/apps/churn-desk")] and imported == []
    assert _undo_lines(inst) == []


def _job_with(task=None):
    return {"settings": {"tasks": [{"task_key": "inspire_task"}] + ([task] if task else [])}}


def _alert_flow(ns, tmp_path, jobs, answers=None, check=None):
    inst, calls, _queries = _alert_inspire(ns, tmp_path, answers, check=check)
    inst.logger = CapturingLogger()
    real, served = inst._implement_api, list(jobs)

    def api(method, path, body=None, query=None):
        if (method, path) == ("GET", "/api/2.2/jobs/get"):
            calls.append((method, path, body, query))
            return served.pop(0) if len(served) > 1 else served[0]
        return real(method, path, body, query)

    inst._implement_api = api
    return inst, calls


def test_a_new_alert_whose_check_did_not_finish_goes_to_the_trash_and_off_the_job(agent_ns, tmp_path):
    task = {"task_key": "inspire_alert", "alert_task": {"alert_id": "al-1"}}
    inst, calls = _alert_flow(agent_ns, tmp_path, [_job_with(), _job_with(task)], check={"status": "RUNNING"})
    with pytest.raises(agent_ns["ImplementBlocked"], match="did not finish"):
        inst._implement_alert(_output_context(agent_ns, alert=True, alert_recipients=["owner@example.com"]), None)
    paths = [c[:2] for c in calls]
    assert ("DELETE", "/api/2.0/alerts/al-1") in paths
    updates = [c[2] for c in calls if c[:2] == ("POST", "/api/2.2/jobs/update")]
    assert updates[-1] == {"job_id": 77, "fields_to_remove": ["tasks/inspire_alert"]}
    assert ("moved the new Alert al-1 to the trash, and took the alert task off the job") in _undo_lines(inst)[0]


def test_an_existing_alert_and_its_task_are_put_back_when_the_check_could_not_start(agent_ns, tmp_path):
    old = {"id": "al-0", "display_name": "Old alert", "query_text": "SELECT 1 AS tier_rows", "warehouse_id": "whOld",
           "custom_summary": "s", "custom_description": "d", "evaluation": {"comparison_operator": "GREATER_THAN"},
           "schedule": {"pause_status": "PAUSED"}, "lifecycle_state": "ACTIVE", "owner_user_name": "someone"}
    task = {"task_key": "inspire_alert", "alert_task": {"alert_id": "al-0", "subscribers": [{"user_name": "old@example.com"}]}}
    answers = {("GET", "/api/2.0/alerts/al-0"): old, ("PATCH", "/api/2.0/alerts/al-0"): {"id": "al-0"},
               ("POST", "/api/2.2/jobs/runs/submit"): RuntimeError("QUOTA_EXCEEDED: too many runs")}
    inst, calls = _alert_flow(agent_ns, tmp_path, [_job_with(task)], answers)
    context = _output_context(agent_ns, alert=True, alert_recipients=["owner@example.com"])
    context["assets"] = {"alert": "al-0"}
    with pytest.raises(agent_ns["ImplementBlocked"], match="the one-time alert check could not start"):
        inst._implement_alert(context, None)
    patches = [(c[2], c[3]) for c in calls if c[:2] == ("PATCH", "/api/2.0/alerts/al-0")]
    assert len(patches) == 2
    fields = agent_ns["IMPLEMENT_ALERT_FIELDS"]
    assert patches[1] == ({k: old[k] for k in fields}, {"update_mask": ",".join(fields)})
    updates = [c[2] for c in calls if c[:2] == ("POST", "/api/2.2/jobs/update")]
    assert updates[-1] == {"job_id": 77, "new_settings": {"tasks": [task]}}
    assert not any(c[0] == "DELETE" for c in calls), "an alert that existed before is never trashed"
    assert "put the Alert al-0 back as it was, and set the job's alert task back" in _undo_lines(inst)[0]


def test_an_alert_that_passed_its_check_has_nothing_undone(agent_ns, tmp_path):
    inst, calls = _alert_flow(agent_ns, tmp_path, [_job_with()])
    fields = inst._implement_alert(_output_context(agent_ns, alert=True, alert_recipients=["owner@example.com"]), None)
    assert fields["alert_id"] == "al-1"
    assert not any(c[0] in ("DELETE", "PATCH") for c in calls) and _undo_lines(inst) == []


class _Notebooks:
    def __init__(self, text, modified_at=1000, fail_import=()):
        self.text, self.modified_at, self.imported, self.fail_import = text, modified_at, [], list(fail_import)

    def export(self, path, format=None):
        if self.text is None:
            raise RuntimeError(f"RESOURCE_DOES_NOT_EXIST: {path}")
        if self.text is Exception:
            raise RuntimeError("PERMISSION_DENIED: cannot read")
        return types.SimpleNamespace(content=base64.b64encode(self.text.encode("utf-8")).decode())

    def import_(self, path, overwrite, format, content):
        if self.fail_import and self.fail_import.pop(0):
            raise RuntimeError("TEMPORARILY_UNAVAILABLE: import failed")
        self.text = base64.b64decode(content).decode("utf-8")
        self.imported.append((path, format, self.text))
        self.modified_at += 1000

    def mkdirs(self, path):
        pass


def _refill(ns, monkeypatch, notebooks, outcome, record=None):
    monkeypatch.setitem(ns, "current_job_run_id", lambda: "1234567890000031")
    inst = _probe_inspire(ns, None, {"notebook": record or {"modified_at": 1000, "spec_version": 2}})
    inst.logger = CapturingLogger()
    inst.atomic_writer = types.SimpleNamespace(acquire_lock=lambda k, **kw: True, release_lock=lambda k: None)
    inst.w_client = types.SimpleNamespace(workspace=notebooks, config=types.SimpleNamespace(host="https://h"))
    inst._implement_notebook_paths = lambda uc, key: ("/W", "/W/nb")
    inst._implement_notebook_modified_at = lambda path: None if notebooks.text is None else notebooks.modified_at
    inst._implement_runner = lambda uc: "runner"

    def write(uc, spec, previous, key, current=""):
        notebooks.import_(path="/W/nb", overwrite=True, format="JUPYTER",
                          content=base64.b64encode(b"half-built notebook").decode())
        return "/W/nb"

    inst._implement_write_notebook = write

    def fill(*a):
        if isinstance(outcome, Exception):
            raise outcome
        return outcome, 77, {}

    inst._implement_fill_and_preview = fill
    inst._implement_genie_space = lambda c, r: {"genie_space_id": "g1", "genie_space_url": "https://h/genie/rooms/g1"}
    inst._implement_app = lambda c, r: {"app_name": "churn-desk", "app_url": "https://churn-desk.example", "app_health": "running"}
    inst._implement_dashboard = lambda c, r: {"dashboard_id": "d1", "dashboard_url": "https://h/d"}
    return inst


REFILL = {"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3,
          "spec_json": dict(VALID, config={**VALID["config"], "widgets": {"top_k": 30}})}


@pytest.mark.parametrize("outcome", [
    {"status": "stopped", "stop_reason": "no row reached Act now"},
    RuntimeError("Genie exited with code 1: the preview run failed"),
], ids=["stopped", "fill_failed"])
def test_a_rebuild_that_did_not_end_written_puts_the_notebook_back_so_the_job_keeps_the_last_built_version(agent_ns, sdk_stub,
                                                                                                        monkeypatch, outcome):
    notebooks = _Notebooks("built notebook v2")
    inst = _refill(agent_ns, monkeypatch, notebooks, outcome)
    inst._implement_one_locked = inst._implement_one_locked
    assert inst._implement_one(REFILL) == "failed"
    assert [text for _p, _f, text in notebooks.imported] == ["half-built notebook", "built notebook v2"]
    assert notebooks.imported[-1][:2] == ("/W/nb", "JUPYTER")
    final = inst.updates[-1]
    assert final["status"] == "failed"
    assert final["asset_status"]["notebook"] == {"modified_at": 3000, "spec_version": 2}, \
        "the record says the notebook is v2's again, at the time Inspire put it back"
    assert not agent_ns["implement_notebook_edited"](notebooks.modified_at, final["asset_status"]["notebook"]), \
        "the next build does not mistake Inspire's own undo for an edit by the user"
    assert agent_ns["implement_reusable_notebook"]({"spec_version": 2}, final["asset_status"]["notebook"]), \
        "the next build edits the restored notebook instead of rewriting it"
    assert [m for lvl, m in inst.logger.records if "[IMPLEMENT-UNDO]" in m] == [
        "[IMPLEMENT-UNDO] N01-U01: this version did not build, so Inspire put the notebook /W/nb back as it was; the job keeps "
        "running the last built version"]


def test_a_rebuild_that_wrote_its_results_keeps_the_new_notebook_even_when_an_output_fails_later(agent_ns, sdk_stub, monkeypatch):
    notebooks = _Notebooks("built notebook v2")
    inst = _refill(agent_ns, monkeypatch, notebooks, {"status": "written", "rows_written": 12})
    inst._implement_dashboard = lambda c, r: (_ for _ in ()).throw(agent_ns["ImplementBlocked"]("the dashboard could not be saved"))
    assert inst._implement_one(REFILL) in ("failed", "ready_with_warnings")
    assert [text for _p, _f, text in notebooks.imported] == ["half-built notebook"], "a notebook that ran and wrote stays"
    assert not any("[IMPLEMENT-UNDO]" in m and "notebook" in m for _lvl, m in inst.logger.records)


def test_a_first_build_has_no_notebook_to_put_back_and_records_what_it_left(agent_ns, sdk_stub, monkeypatch):
    notebooks = _Notebooks(None)
    inst = _refill(agent_ns, monkeypatch, notebooks, RuntimeError("Genie exited with code 1"), record={})
    inst._implement_carried = lambda t: ({"job_id": 77, "result_rows": 0}, {})
    assert inst._implement_one(dict(REFILL, spec_version=1, spec_json=dict(VALID))) == "failed"
    assert [text for _p, _f, text in notebooks.imported] == ["half-built notebook"]
    assert inst.updates[-1]["asset_status"]["notebook"] == {"modified_at": 2000, "spec_version": 1, "result_history": 1}


def test_a_notebook_that_cannot_be_read_first_is_not_rebuilt(agent_ns, sdk_stub, monkeypatch):
    notebooks = _Notebooks(Exception)
    inst = _refill(agent_ns, monkeypatch, notebooks, {"status": "written"})
    assert inst._implement_one(REFILL) == "failed"
    assert notebooks.imported == [], "Inspire never overwrites a notebook it could not save a copy of"
    assert inst.updates[-1]["status_message"].startswith("the notebook /W/nb could not be read before Inspire rebuilt it, so Inspire did "
                                                         "not change it: PERMISSION_DENIED: cannot read")


def test_a_notebook_deleted_before_inspire_could_copy_it_is_written_new(agent_ns, sdk_stub, monkeypatch):
    notebooks = _Notebooks(None)
    inst = _refill(agent_ns, monkeypatch, notebooks, RuntimeError("Genie exited with code 1"))
    seen = iter([1000, 1000])
    inst._implement_notebook_modified_at = lambda path: next(seen, notebooks.modified_at)
    assert inst._implement_one(REFILL) == "failed"
    assert [text for _p, _f, text in notebooks.imported] == ["half-built notebook"], "there is no copy to put back, so none is written"
    assert inst.updates[-1]["asset_status"]["notebook"] == {"modified_at": 2000, "spec_version": 3, "result_history": 1}
    assert not inst.updates[-1]["status_message"].startswith("the notebook /W/nb could not be read")


def test_a_notebook_that_could_not_be_put_back_is_recorded_as_this_version_left_it_and_says_so(agent_ns, sdk_stub, monkeypatch):
    notebooks = _Notebooks("built notebook v2", fail_import=[False, True])
    inst = _refill(agent_ns, monkeypatch, notebooks, RuntimeError("Genie exited with code 1"))
    assert inst._implement_one(REFILL) == "failed"
    assert inst.updates[-1]["asset_status"]["notebook"] == {"modified_at": 2000, "spec_version": 3, "result_history": 1}
    assert any(lvl == "ERROR" and m.startswith("[IMPLEMENT-UNDO FAILED] N01-U01: this version did not build, and Inspire could not put "
                                               "the notebook /W/nb back as it was") for lvl, m in inst.logger.records)
