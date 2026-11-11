import itertools
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _agentload import load_agent_namespace  # noqa: E402
from v120_genie_support import build_inspire, make_uc  # noqa: E402
from v120_launcher_fix_test import cap_sdk  # noqa: E402,F401
from v192_job_asset_tags_test import JOB_TAG_VALUE, VERSION_KEY, _Api, _TagJobs, _launch, _tagger  # noqa: E402

REPORT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "docs", "inspire_usage_report.sql")
APPS = {
    "none": None,
    "delta": {"state": "ready", "backend": "delta", "app_id": "app-d"},
    "lakebase": {"state": "ready", "backend": "lakebase", "app_id": "app-l"},
    "hosted": {"state": "ready", "placement": "inspire", "backend": "lakebase", "app_id": "app-h"},
}
COMBOS = list(itertools.product(APPS, (False, True), (False, True), (False, True), (False, True)))


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def _case(app_name, dashboard, genie, alert, endpoint):
    assets, status = {}, {}
    app = APPS[app_name]
    if app:
        assets["app"] = "churn-desk"
        status["app"] = dict(app)
    if dashboard:
        assets["dashboard"], status["dashboard"] = "d1", {"state": "ready"}
    if genie:
        assets["genie_space"], status["genie_space"] = "g1", {"state": "ready"}
    if alert:
        assets["alert"], status["alert"] = "a1", {"state": "ready", "digest_id": "dg1"}
    if endpoint:
        status["ai_reasoning"] = {"state": "ready"}
    return assets, status, ("databricks-claude-sonnet" if endpoint else "")


def _expected(app_name, dashboard, genie, alert, endpoint):
    app = APPS[app_name]
    kinds = []
    if app and app.get("placement") != "inspire":
        kinds.append("app")
    if genie:
        kinds.append("genie")
    if dashboard:
        kinds.append("dashboard")
    if alert:
        kinds.append("alert")
    if endpoint:
        kinds.append("agent_endpoint")
    if app and app["backend"] == "lakebase":
        kinds.append("lakebase")
    warehouses = (["wh-app"] if app else []) + (["wh-cfg"] if dashboard or genie or alert else [])
    return {
        "assets": set(kinds),
        "warehouses": warehouses,
        "backend": app["backend"] if app else None,
    }


@pytest.mark.parametrize("app_name,dashboard,genie,alert,endpoint", COMBOS)
def test_every_asset_combination_names_its_assets_warehouses_and_backend(ns, app_name, dashboard, genie, alert, endpoint):
    assets, status, endpoint_name = _case(app_name, dashboard, genie, alert, endpoint)
    tags = ns["implement_asset_tags"](assets, status, endpoint_name, warehouse="wh-cfg", app_warehouse="wh-app")
    want = _expected(app_name, dashboard, genie, alert, endpoint)
    assert set(tags) <= set(ns["JobLauncher"].ASSET_TAG_KEYS)
    assert set(tags.get("dbx_inspire_ai_assets", "").split(",")) - {""} == want["assets"]
    assert tags.get("dbx_inspire_ai_warehouse_id", "").split(",") == want["warehouses"] if want["warehouses"] else "dbx_inspire_ai_warehouse_id" not in tags
    assert tags.get("dbx_inspire_ai_backend") == want["backend"]
    assert all(JOB_TAG_VALUE.fullmatch(v) and len(v) <= 255 for v in tags.values())


@pytest.mark.parametrize("app_name,dashboard,genie,alert,endpoint", COMBOS)
def test_the_update_payload_carries_the_same_tags_for_every_combination(ns, app_name, dashboard, genie, alert, endpoint):
    assets, status, endpoint_name = _case(app_name, dashboard, genie, alert, endpoint)
    api = _Api({"team": "growth"}, app={"id": "app-x"})
    _tagger(ns, api)._implement_tag_job_assets("N01-U01", 77, assets, status, endpoint_name, "wh-cfg", "wh-app")
    want = _expected(app_name, dashboard, genie, alert, endpoint)
    updates = api.updates()
    if not (want["assets"] or want["warehouses"] or want["backend"]):
        assert updates == []
        return
    [update] = updates
    tags = update["new_settings"]["tags"]
    assert tags["team"] == "growth"
    assert set(tags.get("dbx_inspire_ai_assets", "").split(",")) - {""} == want["assets"]
    assert tags.get("dbx_inspire_ai_backend") == want["backend"]
    assert ("dbx_inspire_ai_warehouse_id" in tags) == bool(want["warehouses"])


def test_a_rebuild_that_deletes_the_dashboard_removes_its_tag_and_the_warehouse_it_alone_used(ns):
    api = _Api({"team": "growth"}, app={"id": "app-x"})
    inst = _tagger(ns, api)
    first = ({"dashboard": "d1", "app": "churn-desk"}, {"dashboard": {"state": "ready"}, "app": {"state": "ready", "backend": "delta"}})
    inst._implement_tag_job_assets("N01-U01", 77, first[0], first[1], "", "wh-cfg", "wh-app")
    [built] = api.updates()
    assert built["new_settings"]["tags"]["dbx_inspire_ai_dashboard_id"] == "d1"
    assert built["new_settings"]["tags"]["dbx_inspire_ai_warehouse_id"] == "wh-app,wh-cfg"
    api.tags = dict(built["new_settings"]["tags"])
    rebuilt = ({"app": "churn-desk"}, {"app": {"state": "ready", "backend": "delta"}})
    _tagger(ns, api)._implement_tag_job_assets("N01-U01", 77, rebuilt[0], rebuilt[1], "", "wh-cfg", "wh-app")
    [after] = api.updates()[1:]
    assert "dbx_inspire_ai_dashboard_id" not in after["new_settings"]["tags"]
    assert after["new_settings"]["tags"]["dbx_inspire_ai_warehouse_id"] == "wh-app"
    assert after["fields_to_remove"] == ["tags"]


def test_the_mvp_job_is_created_with_the_identity_and_run_tags_of_its_build(ns, cap_sdk):
    inst = build_inspire(ns)
    spec = inst._genie_notebook_spec(make_uc())
    run_tags = inst._implement_tags(spec, (4242, "N01-U01", 2), "/Workspace/nb/dbx_inspire_ai_agent")
    cap_sdk["jobs"] = jobs = _TagJobs({})
    jobs.existing_job_id = None
    assert _launch(ns, run_tags)["success"] is True
    [created] = jobs.settings
    assert created.tags["dbx_inspire_ai_business"] == "Acme"
    assert created.tags["dbx_inspire_ai_session_id"] == "4242" and created.tags["dbx_inspire_ai_usecase_id"] == "N01-U01"
    assert created.tags["dbx_inspire_ai_run_type"] == "implement" and created.tags[VERSION_KEY] == ns["__AGENT_VERSION__"]
    assert not set(created.tags) & set(ns["JobLauncher"].ASSET_TAG_KEYS)


def test_discovery_and_mvp_identity_tags_come_from_one_builder(ns):
    version = ns["__AGENT_VERSION__"]
    identity = ns["inspire_identity_tags"]("Acme", 4242, "Inspire App")
    assert identity == {"dbx_inspire_ai_business": "Acme", "dbx_inspire_ai_session": "4242", "dbx_inspire_ai_session_id": "4242",
                        "dbx_inspire_ai_launcher_source": "Inspire App", VERSION_KEY: version, "inspire_version": version}
    spec = build_inspire(ns)._genie_notebook_spec(make_uc())
    assert spec["job_tags"].items() >= ns["inspire_identity_tags"]("Acme", 4242, "Inspire Notebook").items()


def test_the_report_reads_only_tag_keys_the_job_writer_sets(ns):
    sql = open(REPORT, encoding="utf-8").read()
    read_keys = set(re.findall(r"dbx_inspire_ai_[a-z_]+", sql))
    produced = set(ns["JobLauncher"].ASSET_TAG_KEYS) | set(ns["JobLauncher"].TAG_PRIORITY) | {VERSION_KEY}
    assert read_keys and read_keys <= produced, read_keys - produced


def test_the_report_reads_the_centralized_tables_by_the_ids_inspire_tags_and_says_what_is_not_attributable():
    sql = open(REPORT, encoding="utf-8").read()
    for table in ("main.centralized_system_tables.lakeflow_jobs", "main.centralized_system_tables.billing_usage", "main.certified.workspaces_latest"):
        assert table in sql
    assert "usage_metadata.project_id" in sql and "usage_metadata.app_id" in sql and "usage_metadata.warehouse_id" in sql
    assert "EXACT" in sql and "NOT ATTRIBUTABLE" in sql and "system.query.history" not in sql.split("NOT ATTRIBUTABLE")[0]
    assert "tags[" not in sql, "a missing map key must read as NULL through try_element_at, never raise"
