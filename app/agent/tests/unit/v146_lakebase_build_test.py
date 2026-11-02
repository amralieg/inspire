import json

import pytest

from v120_artifacts_support import CapturingLogger, FakeSpark
from v140_implement_test import (READS, SHELL_FILES, VALID, _app_flow, _app_shell, _churn_page, _deploy_inspire, _inspire,
                                 _output_context, _spec, sdk_stub)
from v145_lakebase_test import shell_pg, shell_sql

VENDORED = {"psycopg/__init__.py": b"psycopg", "psycopg_binary/_psycopg.cpython-311-aarch64-linux-gnu.so": b"\x7fELF",
            "sqlglot/__init__.py": b"sqlglot"}
PACKAGES = ["psycopg==3.3.6", "psycopg-binary==3.3.6", "sqlglot==30.11.0"]
LAKEBASE_FILES = dict(SHELL_FILES, **VENDORED, **{"requirements.txt": ""})
DELTA_FILES = dict(SHELL_FILES, **{"requirements.txt": ""})
PG = "churn_desk.n01_u01__t_aaaa1111"
BACKEND = {"kind": "lakebase", "pipeline_id": "pipe-1", "datasets": {},
           "tables": {"main.inspire.churn_out": {"pg": PG, "columns": [{"name": "value", "type": "DOUBLE", "type_text": "DOUBLE"}]}}}
ENV = {"PGHOST": "pg.example", "PGPORT": "5432", "PGDATABASE": "databricks_postgres", "PGUSER": "builder"}
LAKEBASE_ENDPOINT = "projects/inspire-apps/branches/production/endpoints/primary"
APPS_POSTGRES_ENV = {"PGAPPNAME", "PGDATABASE", "PGHOST", "PGPORT", "PGSSLMODE", "PGUSER"}
CHOICE_ERROR = ("choose where the App reads its data: 'lakebase' (its pages load instantly) or 'delta' (Delta tables, its pages take a "
                "few seconds to load), not {}")
FALLBACK = ("App: it reads Delta tables, so its pages take a few seconds to load, because Inspire could not set up Lakebase: {}. Build the "
            "App again with Edit MVP on the Build page, or pick Lakebase again in the wizard, to switch it to Lakebase")
SP_NOTE = ("App: it reads Delta tables, not Lakebase, because each viewer signs in as themselves and Lakebase does not carry Unity "
           "Catalog row filters, column masks or grants to each viewer")


def _lines(inst, level):
    return [message for kind, message in inst.logger.records if kind == level]


def _outputs(**changes):
    return dict(VALID["outputs"], **changes)


def _lakebase(**changes):
    return dict({"kind": "lakebase", "files": LAKEBASE_FILES, "delta_files": DELTA_FILES, "warnings": [], "held": {},
                 "backend": BACKEND, "env": ENV, "schema": "churn_desk", "packages": list(PACKAGES),
                  "vendored": sorted(VENDORED)},
                **changes)


def test_the_notebook_and_the_app_shell_name_the_same_backends_in_the_same_order(agent_ns):
    assert agent_ns["IMPLEMENT_APP_BACKENDS"] == shell_pg.KINDS


@pytest.mark.parametrize("raw,kind", [(None, "delta"), ("", "delta"), ("  ", "delta"), (" Lakebase ", "lakebase"), ("DELTA", "delta")])
def test_the_app_reads_delta_tables_unless_the_spec_picks_lakebase(agent_ns, raw, kind):
    outputs = {"app_access": "sp", **({} if raw is None else {"app_backend": raw})}
    choices, errors = agent_ns["implement_app_choices"](outputs)
    assert errors == [] and choices["app_backend"] == kind


@pytest.mark.parametrize("raw,shown", [("postgres", "'postgres'"), (3, "3")])
def test_a_backend_inspire_does_not_offer_is_refused_naming_both_choices(agent_ns, raw, shown):
    choices, errors = agent_ns["implement_app_choices"]({"app_access": "sp", "app_backend": raw})
    assert errors == [CHOICE_ERROR.format(shown)] and choices["app_backend"] == "delta"


def test_the_spec_carries_the_backend_and_an_app_that_is_not_built_has_none(agent_ns):
    spec, errors = _spec(agent_ns, outputs=_outputs(app_backend="lakebase"))
    assert errors == [] and spec["outputs"]["app_backend"] == "lakebase"
    assert _spec(agent_ns)[0]["outputs"]["app_backend"] == "delta", "a spec from before Lakebase keeps the App on Delta tables"
    bad = _spec(agent_ns, outputs=_outputs(app_backend="postgres"))[1]
    assert CHOICE_ERROR.format("'postgres'") in bad, bad
    off, errors = _spec(agent_ns, outputs={"dashboard": True, "app_backend": "postgres", "inspire_url": VALID["outputs"]["inspire_url"]})
    assert errors == [] and off["outputs"]["app_backend"] == "", "an App that is not built has no backend to check"


def test_switching_only_the_backend_redeploys_the_app_without_asking_genie(agent_ns):
    validate, plan_fn = agent_ns["validate_implement_spec"], agent_ns["implement_plan"]
    before = validate(VALID)[0]
    assets = {"dashboard": "d1", "genie_space": "g1", "app": "churn-desk", "preview_run_id": 7}
    after = validate(dict(VALID, outputs=_outputs(app_backend="lakebase")))[0]
    assert agent_ns["classify_implement_change"](before, after) == ["outputs"]
    plan = plan_fn(before, after, assets, has_built_notebook=True)
    assert plan["refresh"] == ["app"] and plan["restyle"] == ["app"] and plan["build"] == [] and plan["refill"] is False
    both = validate(dict(VALID, outputs=_outputs(app_backend="lakebase", app_access="user")))[0]
    assert plan_fn(before, both, assets, has_built_notebook=True)["restyle"] == [], "an access change makes Genie rebuild the App"
    same = validate(dict(VALID, outputs=_outputs(app_backend="delta")))[0]
    assert agent_ns["classify_implement_change"](before, same) == [], "spelling out the default is no change"


@pytest.mark.parametrize("outputs,host,kind,note", [
    ({"app_backend": "lakebase", "app_access": "sp"}, {}, "lakebase", ""),
    ({"app_backend": "delta", "app_access": "sp"}, {}, "delta", ""),
    ({"app_backend": "lakebase", "app_access": "user"}, {}, "delta", SP_NOTE),
    ({"app_backend": "delta", "app_access": "sp"}, {"merged": True, "settings": {"auth": "sp", "backend": BACKEND}}, "lakebase", ""),
    ({"app_backend": "lakebase", "app_access": "sp"}, {"merged": True, "settings": {"auth": "sp", "backend": {"kind": "delta"}}},
     "delta", ""),
    ({"app_backend": "lakebase", "app_access": "sp"}, {"merged": True, "settings": {"auth": "user", "backend": BACKEND}}, "delta",
     SP_NOTE),
    ({"app_backend": "lakebase", "app_access": "sp"}, {"merged": True, "settings": {"auth": "sp"}}, "delta", ""),
], ids=["sp_lakebase", "sp_delta", "per_user", "merged_keeps_host_lakebase", "merged_keeps_host_delta", "merged_per_user_host",
        "merged_host_before_lakebase"])
def test_the_backend_follows_the_wizard_and_a_merged_app_keeps_its_hosts(agent_ns, outputs, host, kind, note):
    assert agent_ns["implement_app_wanted_backend"](outputs, host) == (kind, note)


def test_each_page_copies_its_result_table_and_every_dataset_through_a_view_with_a_row_key(agent_ns):
    page = {"id": "n01_u01", "result_table": "main.inspire.churn_out",
            "datasets": [{"name": "trend", "sql": "SELECT region, SUM(value) AS v FROM main.inspire.churn_out GROUP BY region;\n"}]}
    copies = agent_ns["implement_lakebase_copies"]([page], "_inspire_row", shell_sql, {})
    assert [(c["key"], c["view"], c["dataset"]) for c in copies] == [
        ("main.inspire.churn_out__lb", "main.inspire.churn_out__lb", ""),
        ("main.inspire.churn_out__lb_trend", "main.inspire.churn_out__lb_trend", "trend")]
    assert copies[0]["sql"] == ("CREATE OR REPLACE VIEW `main`.`inspire`.`churn_out__lb` AS SELECT d.*, monotonically_increasing_id() AS "
                                "`_inspire_row` FROM (SELECT * FROM `main`.`inspire`.`churn_out` WHERE is_current AND change_source <> "
                                "'delete') AS d"), "Lakebase holds the current rows only, so its copy stays the size of the list"
    assert copies[1]["sql"].endswith("FROM (SELECT region, SUM(value) AS v FROM main.inspire.churn_out GROUP BY region) AS d"), \
        "the dataset's trailing semicolon is dropped so the view parses"


def test_a_copys_postgres_name_is_short_stable_and_changes_with_its_columns(agent_ns):
    name, column = agent_ns["implement_lakebase_pg_table"], agent_ns["implement_lakebase_column"]
    copy = {"page": "n01_u01", "dataset": "trend"}
    first = name(copy, [column("region", "string"), column("v", "decimal(38,2)")])
    assert first == name(copy, [column("region", "STRING"), column("v", "DECIMAL(38,2)")])
    assert first.startswith("n01_u01__d_trend_") and len(first) == len("n01_u01__d_trend_") + 8
    assert first != name(copy, [column("region", "string"), column("v", "double")]), "a changed column type gets a new copy"
    assert name({"page": "n01_u01", "dataset": ""}, []).startswith("n01_u01__t_")
    assert len(name({"page": "p" * 80, "dataset": "Trend-Ä"}, [])) == 63, "a Postgres name never passes 63 characters"
    assert column("id", "bigint") == {"name": "id", "type": "LONG", "type_text": "BIGINT"}
    assert column("tags", "array<string>")["type"] == "ARRAY" and column("c", "varchar(10)")["type"] == "STRING"


def test_columns_lakebase_cannot_hold_are_named_with_their_dataset(agent_ns):
    problems, column = agent_ns["implement_lakebase_type_problems"], agent_ns["implement_lakebase_column"]
    columns = [column("site", "geography(4326)"), column("v", "double"), column("x", "void")]
    assert problems({"page": "n01_u01", "dataset": "map", "key": "k"}, columns) == [
        "dataset map of page n01_u01 has columns Lakebase cannot hold: site, x"]
    assert problems({"page": "n01_u01", "dataset": "", "key": "main.inspire.churn_out"}, columns[1:2]) == []


def test_the_app_gets_its_lakebase_database_as_a_resource_only_when_it_reads_lakebase(agent_ns):
    resources, holds, wanted = (agent_ns["implement_app_resources"], agent_ns["implement_app_holds_postgres"],
                                agent_ns["implement_app_postgres_resource"]())
    warehouse = {"name": "sql-warehouse", "sql_warehouse": {"id": "wh1", "permission": "CAN_USE"}}
    assert resources([warehouse], {}) == [warehouse]
    assert resources([warehouse], {}, True) == [warehouse, wanted] and holds([warehouse, wanted])
    stale = {"name": "postgres", "postgres": {"branch": "projects/other/branches/production", "database": "x", "permission": "CAN_CONNECT_AND_CREATE"}}
    assert resources([warehouse, stale], {}, True) == [warehouse, wanted], "a postgres resource on another project is replaced"
    assert resources([warehouse, stale], {}) == [warehouse, stale], "a Delta App leaves the resources it holds alone"
    assert not holds([warehouse, stale]) and not holds([]) and not holds(None)
    assert wanted == {"name": "postgres", "postgres": {"branch": "projects/inspire-apps/branches/production",
                                                       "database": "projects/inspire-apps/branches/production/databases/databricks-postgres",
                                                       "permission": "CAN_CONNECT_AND_CREATE"}}


@pytest.mark.parametrize("error,reason", [
    (type("PermissionDenied", (Exception,), {})("no"), "the identity Inspire runs as has no permission to use Lakebase in this workspace"),
    (RuntimeError("ENDPOINT_NOT_FOUND: Not Found"), "Lakebase is not available in this workspace"),
    (type("E", (Exception,), {"error_code": "FEATURE_DISABLED"})("off"), "Lakebase is not available in this workspace"),
    (RuntimeError("TEMPORARILY_UNAVAILABLE: busy"), "Lakebase did not answer: TEMPORARILY_UNAVAILABLE: busy"),
])
def test_the_lakebase_probe_says_why_lakebase_cannot_be_used(agent_ns, error, reason):
    assert agent_ns["implement_lakebase_unavailable"](error) == reason


def test_only_a_lakebase_backend_names_postgres_copies(agent_ns):
    names = agent_ns["implement_lakebase_pg_names"]
    assert names(BACKEND) == {PG}
    assert names({"kind": "delta", "tables": BACKEND["tables"]}) == set() and names(None) == set() and names({}) == set()
    assert names({"kind": "lakebase", "tables": {"a": {"pg": ""}, "b": "x", "c": {"pg": "s.t"}}}) == {"s.t"}


def _lakebase_deploy(ns, answers, grant=""):
    inst, context, calls, imported = _deploy_inspire(ns, answers)
    inst.logger = CapturingLogger()
    inst.lakebase_grants = []
    inst._implement_lakebase_grant = lambda lakebase, client_id: inst.lakebase_grants.append(client_id) or grant
    return inst, context, calls, imported


def _uploaded(inst):
    return {path.rsplit("/apps/churn-desk/", 1)[-1]: text for path, (text, _overwrite) in inst.uploads.items()}


def _as_uploaded(files: dict) -> dict:
    return {name: body.decode("utf-8") if isinstance(body, bytes) else body for name, body in files.items()}


NEW_APP = RuntimeError("RESOURCE_DOES_NOT_EXIST: app churn-desk")
WAREHOUSE = {"name": "sql-warehouse", "sql_warehouse": {"id": "wh1", "permission": "CAN_USE"}}
LIVE = [{"deployment_id": "dep1", "status": {"state": "SUCCEEDED"}}, {"url": "https://churn-desk.example/"}]


def _created(ns, postgres=True):
    resources = [WAREHOUSE] + ([ns["implement_app_postgres_resource"]()] if postgres else [])
    return {"compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-1", "resources": resources}


def test_a_lakebase_app_is_created_with_its_database_grants_its_service_principal_and_deploys_the_lakebase_files(agent_ns, sdk_stub):
    inst, context, calls, _imported = _lakebase_deploy(agent_ns, [NEW_APP, _created(agent_ns)] + LIVE)
    fields = inst._implement_deploy_app(context, "churn-desk", LAKEBASE_FILES, READS, poll_s=0, lakebase=_lakebase())
    assert fields["_asset"] == {"backend": "lakebase"} and "_warnings" not in fields
    assert calls[1][2]["resources"] == [WAREHOUSE, agent_ns["implement_app_postgres_resource"]()]
    assert inst.lakebase_grants == ["sp-1"]
    assert _uploaded(inst) == _as_uploaded(LAKEBASE_FILES)
    assert not any(c[0] == "PATCH" for c in calls), "an App created with its database needs no second update"


def test_a_lakebase_app_may_read_on_delta_every_dataset_view_its_pages_fall_back_to(agent_ns, sdk_stub):
    inst, context, _calls, _imported = _lakebase_deploy(agent_ns, [NEW_APP, _created(agent_ns)] + LIVE)
    view = "main.inspire.churn_out__lb_trend"
    inst._implement_deploy_app(context, "churn-desk", LAKEBASE_FILES, READS, poll_s=0,
                               lakebase=_lakebase(reads=["main.inspire.churn_out", view]))
    assert "GRANT SELECT ON TABLE `main`.`inspire`.`churn_out__lb_trend` TO `sp-1`" in inst.spark.statements, \
        "when Lakebase is behind or down the App reads this view on Delta as its service principal"
    assert sum(s == "GRANT SELECT ON TABLE `main`.`inspire`.`churn_out` TO `sp-1`" for s in inst.spark.statements) <= 1


def test_a_delta_app_is_created_without_a_database_and_reports_delta(agent_ns, sdk_stub):
    inst, context, calls, _imported = _lakebase_deploy(agent_ns, [NEW_APP, _created(agent_ns, postgres=False)] + LIVE)
    fields = inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert {k: v for k, v in fields.items() if k != "_grants"} == {
        "app_name": "churn-desk", "app_url": "https://churn-desk.example",
        "app_health": "passed churn-desk dep1 https://churn-desk.example/health", "_asset": {"backend": "delta"}}
    assert calls[1][2]["resources"] == [WAREHOUSE] and inst.lakebase_grants == []


def test_an_app_whose_service_principal_cannot_read_lakebase_deploys_on_delta_and_says_why(agent_ns, sdk_stub):
    inst, context, _calls, _imported = _lakebase_deploy(agent_ns, [NEW_APP, _created(agent_ns)] + LIVE,
                                                        grant="PERMISSION_DENIED: role is missing")
    fields = inst._implement_deploy_app(context, "churn-desk", LAKEBASE_FILES, READS, poll_s=0, lakebase=_lakebase())
    reason = "the App's service principal could not be given access to its Lakebase tables: PERMISSION_DENIED: role is missing"
    assert fields["_asset"] == {"backend": "delta"} and fields["_warnings"] == [FALLBACK.format(reason)]
    assert _uploaded(inst) == DELTA_FILES, "the App never deploys files that read Lakebase it cannot open"
    assert _lines(inst, "WARNING") and "[IMPLEMENT-LAKEBASE] N01-U01: App: it reads Delta tables" in _lines(inst, "WARNING")[0]


def test_an_app_the_workspace_will_not_give_a_database_deploys_on_delta_and_says_why(agent_ns, sdk_stub):
    inst, context, calls, _imported = _lakebase_deploy(
        agent_ns, [NEW_APP, _created(agent_ns, postgres=False), RuntimeError("INVALID_PARAMETER_VALUE: postgres is not enabled")] + LIVE)
    fields = inst._implement_deploy_app(context, "churn-desk", LAKEBASE_FILES, READS, poll_s=0, lakebase=_lakebase())
    assert [c[0] for c in calls].count("PATCH") == 1 and calls[2][2]["resources"][-1]["name"] == "postgres"
    assert fields["_asset"] == {"backend": "delta"} and inst.lakebase_grants == []
    assert fields["_warnings"] == [FALLBACK.format("Inspire could not give the App its Lakebase database as a resource")]
    assert _uploaded(inst) == DELTA_FILES


def test_an_existing_delta_app_switched_to_lakebase_gets_its_database_before_it_deploys(agent_ns, sdk_stub):
    held = {"description": "Inspire use case N01-U01 (session 5150): Predict churn", "compute_status": {"state": "ACTIVE"},
            "service_principal_client_id": "sp-2", "active_deployment": {"deployment_id": "dep0"}, "resources": [WAREHOUSE]}
    inst, context, calls, _imported = _lakebase_deploy(agent_ns, [held, dict(held, resources=_created(agent_ns)["resources"])] + LIVE)
    fields = inst._implement_deploy_app(context, "churn-desk", LAKEBASE_FILES, READS, poll_s=0, lakebase=_lakebase())
    assert [c[:2] for c in calls][1] == ("PATCH", "/api/2.0/apps/churn-desk")
    assert calls[1][2]["resources"] == [WAREHOUSE, agent_ns["implement_app_postgres_resource"]()]
    assert fields["_asset"] == {"backend": "lakebase"} and inst.lakebase_grants == ["sp-2"]


def test_an_app_that_does_not_start_with_the_lakebase_packages_is_deployed_again_on_delta(agent_ns, sdk_stub):
    failed = {"deployment_id": "dep1", "status": {"state": "FAILED", "message": "pip could not install psycopg"}}
    inst, context, calls, _imported = _lakebase_deploy(agent_ns, [NEW_APP, _created(agent_ns), failed,
                                                                  {"deployment_id": "dep2", "status": {"state": "SUCCEEDED"}},
                                                                  {"url": "https://churn-desk.example/"}])
    fields = inst._implement_deploy_app(context, "churn-desk", LAKEBASE_FILES, READS, poll_s=0, lakebase=_lakebase())
    assert sum(c[:2] == ("POST", "/api/2.0/apps/churn-desk/deployments") for c in calls) == 2
    assert fields["_asset"] == {"backend": "delta"} and fields["app_health"].startswith("passed churn-desk dep2")
    assert _uploaded(inst) == dict(_as_uploaded(VENDORED), **DELTA_FILES), \
        "the packages the first attempt copied stay in the folder, and the App on Delta never imports them"
    assert len(fields["_warnings"]) == 1 and fields["_warnings"][0].startswith(FALLBACK.format(
        "the App did not start with the Lakebase packages psycopg==3.3.6, psycopg-binary==3.3.6, sqlglot==30.11.0: ")[:150])
    assert "pip could not install psycopg" in fields["_warnings"][0]


def test_a_delta_app_that_does_not_start_is_not_deployed_twice(agent_ns, sdk_stub):
    failed = {"deployment_id": "dep1", "status": {"state": "FAILED", "message": "boom"}}
    inst, context, calls, _imported = _lakebase_deploy(agent_ns, [NEW_APP, _created(agent_ns, postgres=False), failed, {}])
    with pytest.raises(RuntimeError, match="FAILED"):
        inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert sum(c[:2] == ("POST", "/api/2.0/apps/churn-desk/deployments") for c in calls) == 1


def test_an_app_that_fails_on_delta_after_falling_back_raises_the_delta_error(agent_ns, sdk_stub):
    first = {"deployment_id": "dep1", "status": {"state": "FAILED", "message": "pip could not install psycopg"}}
    second = {"deployment_id": "dep2", "status": {"state": "FAILED", "message": "out of quota"}}
    inst, context, calls, _imported = _lakebase_deploy(agent_ns, [NEW_APP, _created(agent_ns), first, second, _created(agent_ns), {}])
    with pytest.raises(RuntimeError, match="out of quota") as raised:
        inst._implement_deploy_app(context, "churn-desk", LAKEBASE_FILES, READS, poll_s=0, lakebase=_lakebase())
    assert "could not undo" not in str(raised.value)
    assert [c[:2] for c in calls][-1] == ("POST", "/api/2.0/apps/churn-desk/stop"), "a new App that never started is stopped"


def test_lakebase_notes_made_before_the_deploy_reach_the_build_warnings(agent_ns, sdk_stub):
    inst, context, _calls, _imported = _lakebase_deploy(agent_ns, [NEW_APP, _created(agent_ns, postgres=False)] + LIVE)
    fields = inst._implement_deploy_app(context, "churn-desk", DELTA_FILES, READS, poll_s=0,
                                        lakebase=_lakebase(kind="delta", files=DELTA_FILES, notes=[SP_NOTE]))
    assert fields["_notes"] == [SP_NOTE] and "_warnings" not in fields and fields["_asset"] == {"backend": "delta"}


TABLES = "/api/2.1/unity-catalog/tables"
OLD = "churn_desk.n01_u01__t_0ld00000"


def _after(ns, held=None, backend=BACKEND, on=True, job_id=77, answers=None, tables=None, started_ms=None):
    inst = _inspire(ns, FakeSpark())
    inst.logger = CapturingLogger()
    inst.listed = []
    calls, queue, pages = [], list(answers or []), list(tables or [{}])

    def api(method, path, body=None, query=None):
        if (method, path) == ("GET", TABLES):
            inst.listed.append(query)
            answer = pages.pop(0)
        else:
            calls.append((method, path, body))
            answer = queue.pop(0) if queue else {}
        if isinstance(answer, Exception):
            raise answer
        return answer

    inst._implement_api = api
    fields = {"app_name": "churn-desk", "_asset": {"backend": "lakebase" if on else "delta"}}
    context = {"uc_id": "N01-U01", "job_id": job_id}
    lakebase = {"held": held or {}, "backend": backend, **({} if started_ms is None else {"started_ms": started_ms})}
    inst._implement_lakebase_after(context, fields, lakebase)
    return inst, fields, calls


def test_a_lakebase_app_adds_the_sync_to_its_job_after_the_run_task(agent_ns):
    _inst, fields, calls = _after(agent_ns)
    assert len(calls) == 1 and calls[0][:2] == ("POST", "/api/2.2/jobs/update")
    task = calls[0][2]["new_settings"]["tasks"][0]
    assert calls[0][2]["job_id"] == 77 and task["task_key"] == "inspire_lakebase_sync"
    assert task["pipeline_task"] == {"pipeline_id": "pipe-1"} and task["run_if"] == "ALL_SUCCESS"
    assert task["depends_on"] == [{"task_key": agent_ns["JobLauncher"].TASK_KEY}]
    assert "_warnings" not in fields


def test_a_delta_app_that_never_read_lakebase_only_looks_for_copies_and_finds_none_quietly(agent_ns):
    inst, fields, calls = _after(agent_ns, backend=None, on=False)
    assert calls == [] and "_warnings" not in fields
    assert inst.listed == [{"catalog_name": "inspire_lakebase", "schema_name": "churn_desk"}]
    for missing in (NOT_FOUND, RuntimeError("PERMISSION_DENIED: no USE CATALOG inspire_lakebase")):
        inst, fields, calls = _after(agent_ns, backend=None, on=False, tables=[missing])
        assert calls == [] and "_warnings" not in fields and _lines(inst, "WARNING") == [], \
            "a workspace without Lakebase copies is never warned about them"


def test_an_app_moved_back_to_delta_drops_the_sync_task_and_retires_every_copy_it_held(agent_ns):
    job = {"settings": {"tasks": [{"task_key": "inspire_task"},
                                  {"task_key": "inspire_lakebase_sync", "pipeline_task": {"pipeline_id": "pipe-1"}}]}}
    inst, fields, calls = _after(agent_ns, held=BACKEND, backend=None, on=False, answers=[job, {}, {"name": "x"}, {}])
    assert [c[:2] for c in calls] == [("GET", "/api/2.2/jobs/get"), ("POST", "/api/2.2/jobs/update"),
                                      ("GET", f"/api/2.0/postgres/synced_tables/inspire_lakebase.{PG}"),
                                      ("DELETE", f"/api/2.0/postgres/synced_tables/inspire_lakebase.{PG}")]
    assert calls[1][2] == {"job_id": 77, "fields_to_remove": ["tasks/inspire_lakebase_sync"]}
    assert f"removed the Lakebase copy {PG}, which the App no longer reads" in " ".join(_lines(inst, "INFO"))


def test_a_rebuild_retires_only_the_copies_the_app_no_longer_reads(agent_ns):
    old = json.loads(json.dumps(BACKEND))
    old["tables"]["main.inspire.churn_out__lb_trend"] = {"pg": "churn_desk.n01_u01__d_trend_bbbb2222", "columns": []}
    _inst, _fields, calls = _after(agent_ns, held=old, answers=[{}, {"name": "x"}, {}])
    assert [c[:2] for c in calls] == [("POST", "/api/2.2/jobs/update"),
                                      ("GET", "/api/2.0/postgres/synced_tables/inspire_lakebase.churn_desk.n01_u01__d_trend_bbbb2222"),
                                      ("DELETE", "/api/2.0/postgres/synced_tables/inspire_lakebase.churn_desk.n01_u01__d_trend_bbbb2222")]


def test_copies_built_for_an_app_that_fell_back_to_delta_are_retired(agent_ns):
    _inst, _fields, calls = _after(agent_ns, on=False, answers=[RuntimeError("RESOURCE_DOES_NOT_EXIST: gone")])
    assert [c[:2] for c in calls] == [("GET", f"/api/2.0/postgres/synced_tables/inspire_lakebase.{PG}")], \
        "a copy that is already gone is not deleted again, and the job never had the sync task"


def test_a_job_that_cannot_take_the_sync_task_and_a_copy_that_cannot_be_removed_are_warnings(agent_ns):
    old = json.loads(json.dumps(BACKEND))
    old["tables"]["x"] = {"pg": "churn_desk.old_t", "columns": []}
    inst, fields, _calls = _after(agent_ns, held=old, answers=[RuntimeError("PERMISSION_DENIED: job 77"),
                                                                RuntimeError("TEMPORARILY_UNAVAILABLE: busy")])
    assert fields["_warnings"] == ["App: Lakebase copies the result only when someone saves a change in the App, because Inspire could "
                                   "not add the Lakebase sync to job 77: PERMISSION_DENIED: job 77. Build the App again with Edit MVP on the Build page to add it"]
    assert any("the Lakebase copy churn_desk.old_t, which the App no longer reads, could not be removed: TEMPORARILY_UNAVAILABLE"
               in w for w in _lines(inst, "WARNING"))


def test_a_rebuilt_app_whose_settings_were_lost_still_retires_every_older_copy_in_its_lakebase_schema(agent_ns):
    listed = {"tables": [{"name": PG.split(".")[1]}, {"name": OLD.split(".")[1]}], "next_page_token": "p2"}
    inst, _fields, calls = _after(agent_ns, answers=[{}, {"name": "x"}, {}, {"name": "y"}, {}],
                                  tables=[listed, {"tables": [{"name": "n01_u01__d_trend_cccc3333"}]}])
    gone = [c[1] for c in calls if c[0] == "DELETE"]
    assert gone == ["/api/2.0/postgres/synced_tables/inspire_lakebase.churn_desk.n01_u01__d_trend_cccc3333",
                    f"/api/2.0/postgres/synced_tables/inspire_lakebase.{OLD}"], "the copy the App reads now stays"
    assert inst.listed == [{"catalog_name": "inspire_lakebase", "schema_name": "churn_desk"},
                           {"catalog_name": "inspire_lakebase", "schema_name": "churn_desk", "page_token": "p2"}]


def test_a_per_user_app_rebuilt_after_its_lakebase_app_was_deleted_retires_the_copies_left_in_its_schema(agent_ns):
    inst, fields, calls = _after(agent_ns, backend=None, on=False, job_id=None, answers=[{"name": "x"}, {}],
                                 tables=[{"tables": [{"name": OLD.split(".")[1]}]}])
    assert [c[:2] for c in calls] == [("GET", f"/api/2.0/postgres/synced_tables/inspire_lakebase.{OLD}"),
                                      ("DELETE", f"/api/2.0/postgres/synced_tables/inspire_lakebase.{OLD}")]
    assert f"removed the Lakebase copy {OLD}, which the App no longer reads" in " ".join(_lines(inst, "INFO"))


def test_a_copy_made_after_this_build_started_belongs_to_another_build_and_stays(agent_ns):
    tables = [{"tables": [{"name": OLD.split(".")[1], "created_at": 1_000}, {"name": "n02_u01__t_new00000", "created_at": 5_000}]}]
    _inst, _fields, calls = _after(agent_ns, answers=[{}, {"name": "x"}, {}], tables=tables, started_ms=4_000)
    assert [c[1] for c in calls if c[0] == "DELETE"] == [f"/api/2.0/postgres/synced_tables/inspire_lakebase.{OLD}"]


def test_a_lakebase_schema_that_cannot_be_listed_still_retires_what_the_settings_name(agent_ns):
    old = json.loads(json.dumps(BACKEND))
    old["tables"]["x"] = {"pg": OLD, "columns": []}
    inst, _fields, calls = _after(agent_ns, held=old, answers=[{}, {"name": "x"}, {}],
                                  tables=[RuntimeError("PERMISSION_DENIED: no USE SCHEMA")])
    assert [c[0] for c in calls] == ["POST", "GET", "DELETE"]
    assert any("could not list the Lakebase copies in inspire_lakebase.churn_desk" in w for w in _lines(inst, "WARNING"))


def test_an_app_name_that_names_no_schema_lists_nothing(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_api = lambda *a, **k: pytest.fail("no schema, no listing")
    assert inst._implement_lakebase_listed("", None, True) == set()


def test_an_app_without_an_inspire_job_still_retires_its_old_copies(agent_ns):
    _inst, _fields, calls = _after(agent_ns, held=BACKEND, backend=None, on=False, job_id=None, answers=[{"name": "x"}, {}])
    assert [c[0] for c in calls] == ["GET", "DELETE"]


class _Reader:
    def __init__(self, rounds):
        self.rounds, self.calls = list(rounds), 0

    def __call__(self, backend, env, service):
        self.backend, self.env = backend, env
        return self

    def sync_now(self):
        self.calls += 1
        return self.rounds.pop(0), 1800000000.0


def _app_lakebase(ns, tmp_path, outputs=None, host=None, rounds=("COMPLETED",), online=(True,), checks=(), ready=None, synced="pipe-1",
                  resync=True):
    inst = _inspire(ns, FakeSpark())
    inst.logger = CapturingLogger()
    payload, modules = _app_shell(ns, tmp_path)
    pg = modules["shell_pg"]
    reader = _Reader(rounds)
    seen = {"views": 0, "synced": [], "checks": [], "online": list(online), "waited": 0}
    inst._require_asset_package = lambda module, purpose: seen.setdefault("packages", []).append(module)
    inst._assets = type("Assets", (), {"app_files": staticmethod(lambda: dict(VENDORED))})()
    inst._implement_lakebase_ready = ready or (lambda deadline: dict(ENV))

    def views(pages, row, schema, shell_sql):
        seen["views"] += 1
        copies = ns["implement_lakebase_copies"](pages, row, shell_sql, {"main.inspire.churn_out": [*shell_sql.HISTORY_COLUMNS, "run_id"]})
        for copy in copies:
            copy.update(columns=[ns["implement_lakebase_column"]("value", "double")], pg=f"{schema}.{copy['page']}__t_x")
            copy["synced"] = f"inspire_lakebase.{copy['pg']}"
        return copies

    inst._implement_lakebase_views = views
    inst._implement_lakebase_synced = lambda copies, storage, held_pipeline, row, deadline: seen["synced"].append(
        (storage, held_pipeline)) or synced

    def is_online(names, deadline, wait=True):
        if wait:
            seen["waited"] += 1
            return True
        return seen["online"].pop(0)

    inst._implement_lakebase_online = is_online
    answers = list(checks)
    inst._implement_app_check = lambda work, files, modules, warehouse, env=None: seen["checks"].append((files, env)) or (
        answers.pop(0) if answers else [])
    page = ns["implement_app_page"](_churn_page(ns), "N01-U01", {}, "main.inspire.churn_out")
    settings = {"version": modules["shell_core"].SETTINGS_VERSION, "pages": [page["id"]]}
    context = _output_context(ns, **(outputs or {"app_backend": "lakebase"}))
    original = pg.Lakebase
    pg.Lakebase = reader
    try:
        out = inst._implement_app_lakebase(context, host or {"name": "churn-desk"}, settings, [page], payload, modules,
                                           str(tmp_path / "work"), resync=resync)
    finally:
        pg.Lakebase = original
    return inst, out, seen, reader, pg


def test_an_app_on_delta_gets_its_delta_files_and_lakebase_is_never_asked(agent_ns, tmp_path):
    inst, out, seen, reader, _pg = _app_lakebase(agent_ns, tmp_path, outputs={"app_backend": "delta"},
                                                 ready=lambda deadline: pytest.fail("Lakebase was asked"))
    assert out["kind"] == "delta" and out["files"] is out["delta_files"] and out["warnings"] == []
    assert json.loads(out["files"]["inspire_app.json"])["backend"] == {"kind": "delta"} and out["files"]["requirements.txt"] == ""
    assert seen["views"] == 0 and reader.calls == 0 and inst.emitted == []


def test_a_per_user_app_stays_on_delta_and_says_why(agent_ns, tmp_path):
    _inst, out, seen, _reader, _pg = _app_lakebase(agent_ns, tmp_path, outputs={"app_backend": "lakebase", "app_access": "user"})
    assert out["kind"] == "delta" and out["notes"] == [SP_NOTE] and out["warnings"] == [] and seen["views"] == 0


def test_a_lakebase_app_copies_its_data_syncs_it_checks_every_query_on_lakebase_and_returns_the_lakebase_files(agent_ns, tmp_path):
    inst, out, seen, reader, pg = _app_lakebase(agent_ns, tmp_path)
    assert out["kind"] == "lakebase" and out["env"] == ENV and out["schema"] == "churn_desk"
    assert out["packages"] == PACKAGES and seen["packages"] == ["psycopg", "sqlglot"], "the copy loads both from the Inspire assets"
    settings = json.loads(out["files"]["inspire_app.json"])
    assert settings["backend"] == out["backend"] and out["backend"]["pipeline_id"] == "pipe-1"
    assert set(out["backend"]["tables"]) == {"main.inspire.churn_out__lb", "main.inspire.churn_out__lbp_records"} | {
        f"main.inspire.churn_out__lb_{d['name']}" for d in _churn_page(agent_ns)["datasets"]}
    assert out["backend"]["current"] == {"main.inspire.churn_out": "main.inspire.churn_out__lb"} and out["backend"]["changes"] == {}
    assert out["backend"]["previous"] == {"n01_u01": {"records": "main.inspire.churn_out__lbp_records"}}, \
        "the compared KPI's dataset is copied as the previous run left it"
    assert out["reads"] == sorted({"main.inspire.churn_out", "main.inspire.churn_out__lb", "main.inspire.churn_out__lbp_records"}
                                  | set(out["backend"]["datasets"]["n01_u01"].values())), \
        "the App may read on Delta each view its pages read when Lakebase cannot answer"
    assert out["files"]["requirements.txt"] == "", "the Apps platform installs nothing"
    assert {name: out["files"][name] for name in VENDORED} == VENDORED, "the App carries the vendored packages as bytes"
    assert out["vendored"] == sorted(VENDORED), "the deploy leaves the vendored files out of the undo snapshot"
    assert json.loads(out["delta_files"]["inspire_app.json"])["backend"] == {"kind": "delta"}
    assert seen["synced"] == [(["main", "inspire"], "")] and reader.calls == 1 and seen["waited"] == 1
    assert seen["checks"] == [(out["files"], ENV)], "every query runs on Lakebase before the App deploys"
    assert [e["status"] for e in inst.emitted] == ["started", "ended_success"]
    assert {"name": "LAKEBASE_ENDPOINT", "valueFrom": "postgres"} in agent_ns["implement_app_yaml_env"](out["files"]["app.yaml"])
    assert "LAKEBASE_ENDPOINT" not in out["delta_files"]["app.yaml"]
    assert reader.env == dict(ENV, LAKEBASE_ENDPOINT=LAKEBASE_ENDPOINT), "the sync reads Lakebase with the env the App gets"


def test_a_copy_added_to_a_pipeline_whose_run_had_already_started_is_synced_once_more(agent_ns, tmp_path):
    _inst, out, seen, reader, _pg = _app_lakebase(agent_ns, tmp_path, rounds=("COMPLETED", "COMPLETED"), online=(False, True))
    assert out["kind"] == "lakebase" and reader.calls == 2 and seen["waited"] == 1


@pytest.mark.parametrize("stub,reason", [
    ({"ready": lambda deadline: (_ for _ in ()).throw(ImportError("x"))}, "x"),
    ({"rounds": ("FAILED",)}, "the Lakebase sync ended failed"),
    ({"checks": (["dataset trend: function unix_micros does not exist"],)},
     "these App queries did not run on Lakebase: dataset trend: function unix_micros does not exist"),
], ids=["unreachable", "sync_failed", "query_failed"])
def test_any_lakebase_step_that_fails_leaves_the_app_on_delta_with_the_reason(agent_ns, tmp_path, stub, reason):
    inst, out, _seen, _reader, _pg = _app_lakebase(agent_ns, tmp_path, **stub)
    assert out["kind"] == "delta" and out["files"] is out["delta_files"]
    assert out["warnings"] == [FALLBACK.format(reason)]
    assert [e["status"] for e in inst.emitted] == ["started", "ended_warning"]
    assert any(reason in w for w in _lines(inst, "WARNING"))


def test_a_restyle_of_an_app_already_on_lakebase_reuses_its_copies_without_a_sync(agent_ns, tmp_path):
    host = {"name": "churn-desk", "settings": {"backend": BACKEND}}
    _inst, out, seen, reader, _pg = _app_lakebase(agent_ns, tmp_path, host=host, resync=False)
    assert out["kind"] == "lakebase" and out["backend"] == BACKEND and out["held"] == BACKEND
    assert seen["views"] == 0 and reader.calls == 0 and len(seen["checks"]) == 1


def test_a_restyle_that_moves_a_delta_app_to_lakebase_copies_and_syncs_its_data(agent_ns, tmp_path):
    host = {"name": "churn-desk", "settings": {"backend": {"kind": "delta"}}}
    _inst, out, seen, reader, _pg = _app_lakebase(agent_ns, tmp_path, host=host, resync=False)
    assert out["kind"] == "lakebase" and seen["views"] == 1 and reader.calls == 1


def test_a_rebuild_of_a_lakebase_app_reuses_its_pipeline(agent_ns, tmp_path):
    host = {"name": "churn-desk", "settings": {"backend": BACKEND}}
    _inst, _out, seen, _reader, _pg = _app_lakebase(agent_ns, tmp_path, host=host)
    assert seen["synced"] == [(["main", "inspire"], "pipe-1")]


def test_the_app_build_passes_lakebase_through_to_the_deploy_and_the_job(agent_ns, tmp_path):
    seen_after = []
    inst, context, seen = _app_flow(agent_ns, tmp_path, assets={"genie_space": "g1"})
    inst._implement_deploy_app = (lambda context, name, files, reads, space_id="", lakebase=None, page_tables=():
                                  seen["deployed"].append((name, files, reads, space_id, lakebase))
                                  or {"app_name": name, "_asset": {"backend": lakebase["kind"]}})
    inst._implement_lakebase_after = lambda context, fields, lakebase: seen_after.append((fields, lakebase))
    fields = inst._implement_app(context, None)
    _name, files, _reads, _space_id, lakebase = seen["deployed"][0]
    assert lakebase["kind"] == "delta" and files is lakebase["files"] and files["requirements.txt"] == ""
    assert seen_after == [(fields, lakebase)] and fields == {"app_name": "churn-desk", "_asset": {"backend": "delta", "page": "n01_u01"}}, \
        "every App deploy records the page of this use case, its own App as well as a joined one"


NOT_FOUND = RuntimeError("RESOURCE_DOES_NOT_EXIST: not found")
BRANCH = "projects/inspire-apps/branches/production"
ROLES = f"/api/2.0/postgres/{BRANCH}/roles"


def _routed(ns, routes):
    inst = _inspire(ns, FakeSpark())
    inst.logger = CapturingLogger()
    calls = []

    def api(method, path, body=None, query=None):
        calls.append((method, path, body, query))
        answer = routes[(method, path)]
        if isinstance(answer, list):
            answer = answer.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer

    inst._implement_api = api
    return inst, calls


def _grant(ns, routes, sql_error=None, lakebase=None):
    inst, calls = _routed(ns, routes)
    statements, grants = [], []

    def run(env, batch):
        if sql_error:
            raise sql_error
        statements.extend(s.as_string(None) for s in batch)

    inst._implement_lakebase_sql = run
    inst._implement_grant = lambda kind, object_id, principals, level: grants.append((kind, object_id, principals, level))
    return inst._implement_lakebase_grant(lakebase or _lakebase(), "sp-1"), calls, statements, grants


SP_ROLE = {"status": {"postgres_role": "sp-1"}}
GRANTS = ['GRANT USAGE ON SCHEMA "churn_desk" TO "sp-1"', 'GRANT SELECT ON TABLE "churn_desk"."n01_u01__t_aaaa1111" TO "sp-1"']


def test_the_app_role_is_found_on_any_page_and_gets_read_access_to_its_schema_and_run_on_its_pipeline(agent_ns):
    problem, calls, statements, grants = _grant(agent_ns, {("GET", ROLES): [
        {"roles": [{"status": {"postgres_role": "someone"}}], "next_page_token": "t2"}, {"roles": [SP_ROLE]}]})
    assert problem == "" and [c[3] for c in calls] == [None, {"page_token": "t2"}]
    assert statements == GRANTS
    assert grants == [("pipelines", "pipe-1", [{"type": "service_principal", "name": "sp-1"}], "CAN_RUN")]


@pytest.mark.parametrize("post", [{}, RuntimeError("ALREADY_EXISTS: role sp-1 already exists")], ids=["created", "raced"])
def test_a_missing_app_role_is_created_for_its_service_principal(agent_ns, post):
    problem, calls, statements, _grants = _grant(agent_ns, {("GET", ROLES): [{"roles": []}, {"roles": [SP_ROLE]}], ("POST", ROLES): post})
    assert problem == "" and statements == GRANTS
    assert calls[1][2:] == ({"spec": {"identity_type": "SERVICE_PRINCIPAL", "postgres_role": "sp-1", "auth_method": "LAKEBASE_OAUTH_V1"}},
                            {"role_id": "sp-1"})


def test_the_app_role_reads_only_the_copies_its_app_lists_so_a_copy_another_build_drops_meanwhile_never_fails_the_grant(agent_ns):
    tables = {"main.inspire.b_out": {"pg": "churn_desk.n02_u01__t_bbbb2222"}, "main.inspire.a_out": {"pg": "churn_desk.n01_u01__t_aaaa1111"},
              "main.inspire.gone": {"pg": ""}}
    problem, _calls, statements, _grants = _grant(agent_ns, {("GET", ROLES): [{"roles": [SP_ROLE]}]},
                                                  lakebase=_lakebase(backend={**BACKEND, "tables": tables}))
    assert problem == "" and statements == [
        'GRANT USAGE ON SCHEMA "churn_desk" TO "sp-1"',
        'GRANT SELECT ON TABLE "churn_desk"."n01_u01__t_aaaa1111", "churn_desk"."n02_u01__t_bbbb2222" TO "sp-1"']
    assert not any("ALL TABLES" in s for s in statements)
    problem, _calls, statements, grants = _grant(agent_ns, {("GET", ROLES): [{"roles": [SP_ROLE]}]},
                                                 lakebase=_lakebase(backend={**BACKEND, "tables": {}}))
    assert problem == "" and statements == ['GRANT USAGE ON SCHEMA "churn_desk" TO "sp-1"'], "no copies, no table grant to break"
    assert grants == [("pipelines", "pipe-1", [{"type": "service_principal", "name": "sp-1"}], "CAN_RUN")]


def test_a_grant_that_fails_is_returned_as_the_reason_and_nothing_raises(agent_ns):
    problem, _calls, _statements, grants = _grant(agent_ns, {("GET", ROLES): [{"roles": [SP_ROLE]}]},
                                                  sql_error=RuntimeError("permission denied for schema churn_desk"))
    assert problem == "permission denied for schema churn_desk" and grants == []
    problem, _calls, _statements, _grants = _grant(agent_ns, {("GET", ROLES): [{"roles": []}],
                                                              ("POST", ROLES): RuntimeError("PERMISSION_DENIED: not a project owner")})
    assert problem == "PERMISSION_DENIED: not a project owner"


ENDPOINT = f"/api/2.0/postgres/{BRANCH}/endpoints/primary"
CATALOG = "/api/2.0/postgres/catalogs/inspire_lakebase"


def _ready_routes(changes=None):
    return {**{("GET", "/api/2.0/postgres/projects"): {"projects": []},
                 ("GET", "/api/2.0/postgres/projects/inspire-apps"): [NOT_FOUND], ("POST", "/api/2.0/postgres/projects"): {},
                 ("GET", ENDPOINT): [{"status": {"hosts": {"host": "pg.example"}}}],
                 ("GET", CATALOG): [NOT_FOUND, {"spec": {"branch": BRANCH, "postgres_database": "databricks_postgres"}}],
                 ("POST", "/api/2.0/postgres/catalogs"): {}}, **(changes or {})}


def test_the_first_lakebase_app_creates_the_inspire_project_and_catalog(agent_ns):
    import time
    inst, calls = _routed(agent_ns, _ready_routes())
    inst._implement_builder = lambda: "builder"
    assert inst._implement_lakebase_ready(time.time() + 60) == ENV
    assert set(ENV) <= APPS_POSTGRES_ENV, "the build reads Lakebase only with what the App's database resource gives it"
    posts = [c for c in calls if c[0] == "POST"]
    assert posts == [("POST", "/api/2.0/postgres/projects", {"spec": agent_ns["IMPLEMENT_LAKEBASE_PROJECT_SPEC"]}, {"project_id": "inspire-apps"}),
                     ("POST", "/api/2.0/postgres/catalogs", {"spec": {"branch": BRANCH, "postgres_database": "databricks_postgres"}},
                      {"catalog_id": "inspire_lakebase"})]
    assert agent_ns["IMPLEMENT_LAKEBASE_PROJECT_SPEC"]["default_endpoint_settings"] == {
        "autoscaling_limit_min_cu": 0.5, "autoscaling_limit_max_cu": 2, "suspend_timeout_duration": "300s"}


def test_a_later_lakebase_app_reuses_the_project_and_catalog(agent_ns):
    import time
    inst, calls = _routed(agent_ns, _ready_routes({("GET", "/api/2.0/postgres/projects/inspire-apps"): {"name": "projects/inspire-apps"},
                                                     ("GET", CATALOG): [{"status": {"branch": BRANCH,
                                                                                    "postgres_database": "databricks_postgres"}}]}))
    inst._implement_builder = lambda: "builder"
    assert inst._implement_lakebase_ready(time.time() + 60)["PGHOST"] == "pg.example"
    assert not any(c[0] == "POST" for c in calls)


@pytest.mark.parametrize("routes,needle", [
    ({("GET", "/api/2.0/postgres/projects"): type("PermissionDenied", (Exception,), {})("no")},
     "the identity Inspire runs as has no permission to use Lakebase in this workspace"),
    ({("GET", "/api/2.0/postgres/projects"): RuntimeError("ENDPOINT_NOT_FOUND: Not Found")}, "Lakebase is not available in this workspace"),
    ({("GET", CATALOG): [{"spec": {"branch": "projects/other/branches/main", "postgres_database": "other"}}]},
     "the catalog inspire_lakebase already holds another Lakebase database (projects/other/branches/main, other)"),
    ({("GET", "/api/2.0/postgres/projects/inspire-apps"): type("PermissionDenied", (Exception,), {})(
        "The user is not authorized to make the request. Config: host=https://ws.example, auth_type=runtime")},
     "the identity Inspire runs as has no Can Use or Can Manage on the Lakebase project inspire-apps; run the Inspire installer again, "
     "or ask a workspace admin to give it Can Manage on that project"),
    ({("GET", ENDPOINT): type("E", (Exception,), {"error_code": "PERMISSION_DENIED"})("no Can Use on the project")},
     "the identity Inspire runs as has no Can Use or Can Manage on the Lakebase project inspire-apps; run the Inspire installer again, "
     "or ask a workspace admin to give it Can Manage on that project"),
], ids=["forbidden", "absent", "catalog_taken", "project_forbidden", "endpoint_forbidden"])
def test_lakebase_that_cannot_be_used_says_why(agent_ns, routes, needle):
    import time
    inst, _calls = _routed(agent_ns, _ready_routes(routes))
    inst._implement_builder = lambda: "builder"
    with pytest.raises(agent_ns["ImplementLakebaseUnavailable"]) as raised:
        inst._implement_lakebase_ready(time.time() + 60)
    assert str(raised.value) == needle


DELETED_PROJECT = {"name": "projects/inspire-apps", "delete_time": "2026-11-02T09:37:40Z", "purge_time": "2026-11-09T09:37:40Z"}
DELETED_REASON = ("the Lakebase project inspire-apps was deleted on 2026-11-02 and keeps its name until it is purged on 2026-11-09; "
                  "restore it in Lakebase to build Apps on Lakebase again")


@pytest.mark.parametrize("project,reason", [
    (DELETED_PROJECT, DELETED_REASON),
    ({"name": "projects/inspire-apps", "delete_time": "2026-11-02T09:37:40Z"},
     "the Lakebase project inspire-apps was deleted on 2026-11-02 and keeps its name until it is purged; "
     "restore it in Lakebase to build Apps on Lakebase again"),
], ids=["purge_date", "no_purge_date"])
def test_a_deleted_lakebase_project_is_refused_at_once_instead_of_waiting_for_an_endpoint_it_will_never_get(agent_ns, project, reason):
    import time
    inst, calls = _routed(agent_ns, _ready_routes({("GET", "/api/2.0/postgres/projects/inspire-apps"): project,
                                                     ("GET", ENDPOINT): NOT_FOUND}))
    inst._implement_builder = lambda: "builder"
    with pytest.raises(agent_ns["ImplementLakebaseUnavailable"]) as raised:
        inst._implement_lakebase_ready(time.time() + 1)
    assert str(raised.value) == reason
    assert [c[:2] for c in calls] == [("GET", "/api/2.0/postgres/projects"), ("GET", "/api/2.0/postgres/projects/inspire-apps")], \
        "no create, no endpoint wait, no catalog"


def test_a_live_project_with_an_empty_delete_time_is_still_used(agent_ns):
    import time
    inst, _calls = _routed(agent_ns, _ready_routes({("GET", "/api/2.0/postgres/projects/inspire-apps"):
                                                        {"name": "projects/inspire-apps", "delete_time": ""},
                                                    ("GET", CATALOG): [{"status": {"branch": BRANCH,
                                                                                   "postgres_database": "databricks_postgres"}}]}))
    inst._implement_builder = lambda: "builder"
    assert inst._implement_lakebase_ready(time.time() + 60) == ENV


def test_taking_back_reads_on_a_deleted_project_says_why_at_once(agent_ns):
    inst, calls = _routed(agent_ns, {("GET", "/api/2.0/postgres/projects/inspire-apps"): DELETED_PROJECT})
    inst._require_asset_package = lambda *a: pytest.fail("a deleted project needs no Lakebase driver")
    gone, failed, warnings = inst._implement_lakebase_revoke(None, ["a", "b"], "sp-1")
    assert (gone, failed) == ([], ["a", "b"])
    assert warnings == [f"App: Inspire could not reach Lakebase, so the App's service principal sp-1 may still read the Lakebase copies "
                        f"a and b: {DELETED_REASON}"]
    assert len(calls) == 1


def test_taking_back_reads_on_a_purged_project_counts_every_copy_gone(agent_ns):
    inst, _calls = _routed(agent_ns, {("GET", "/api/2.0/postgres/projects/inspire-apps"): NOT_FOUND})
    assert inst._implement_lakebase_revoke(None, ["a", "b"], "sp-1") == (["a", "b"], [], [])


def test_waiting_for_lakebase_logs_a_heartbeat_every_minute_and_still_times_out(agent_ns, monkeypatch):
    import time
    inst, _calls = _routed(agent_ns, {})
    clock = [1000.0]
    monkeypatch.setattr(time, "time", lambda: clock[0])
    monkeypatch.setattr(time, "sleep", lambda s: clock.__setitem__(0, clock[0] + s))
    reads = iter(["", "", "", "", "", "", "", "pg.example"])
    assert inst._implement_lakebase_until(lambda: next(reads), "the endpoint", clock[0] + 600) == "pg.example"
    beats = [m for m in _lines(inst, "INFO") if m.startswith("[WAIT-HEARTBEAT]")]
    assert beats == ["[WAIT-HEARTBEAT] waiting for the endpoint: 0/1 done, 1 in progress, 60s elapsed of 600s"]
    clock[0] = 5000.0
    with pytest.raises(agent_ns["ImplementLakebaseUnavailable"]) as raised:
        inst._implement_lakebase_until(lambda: "", "the endpoint", clock[0] + 25)
    assert str(raised.value) == "the endpoint was not ready after 30 minutes"


COPIES = [{"synced": "inspire_lakebase.s.a", "view": "main.inspire.a__lb"}, {"synced": "inspire_lakebase.s.b", "view": "main.inspire.b__lb"}]
SYNCED = "/api/2.0/postgres/synced_tables"
UC_TABLES = "/api/2.1/unity-catalog/tables"


def _existing(synced, source, pipeline):
    status = {"message": "Synced table is currently pending setup of pipeline resources.",
              "detailed_state": "SYNCED_TABLE_PROVISIONING_PIPELINE_RESOURCES", "ongoing_sync_progress": {},
              "pipeline_id": pipeline, "unity_catalog_provisioning_state": "ACTIVE", "project": "projects/inspire-apps"}
    table = {"table_type": "FOREIGN", "data_source_format": "POSTGRESQL_FORMAT", "pipeline_id": pipeline,
             "properties": {"continuous": "false", "source_table": source} if source else {"continuous": "false"}}
    return {("GET", f"{SYNCED}/{synced}"): [{"name": f"synced_tables/{synced}", "status": status, "synced_table_id": synced}],
            ("GET", f"{UC_TABLES}/{synced}"): table}


def _synced(ns, routes, held=""):
    import time
    inst, calls = _routed(ns, {("POST", SYNCED): {}, **routes})
    return inst._implement_lakebase_synced(json.loads(json.dumps(COPIES)), ["main", "inspire"], held, "_inspire_row",
                                           time.time() + 60), calls


def test_the_first_copy_starts_a_pipeline_and_the_rest_join_it(agent_ns):
    pipeline, calls = _synced(agent_ns, {("GET", f"{SYNCED}/inspire_lakebase.s.a"): [NOT_FOUND, {"status": {"pipeline_id": "p-new"}}],
                                         ("GET", f"{SYNCED}/inspire_lakebase.s.b"): [NOT_FOUND]})
    posts = [c for c in calls if c[0] == "POST"]
    assert pipeline == "p-new" and [p[3] for p in posts] == [{"synced_table_id": "inspire_lakebase.s.a"},
                                                             {"synced_table_id": "inspire_lakebase.s.b"}]
    first, second = posts[0][2]["spec"], posts[1][2]["spec"]
    assert first["new_pipeline_spec"] == {"storage_catalog": "main", "storage_schema": "inspire"} and "existing_pipeline_id" not in first
    assert second["existing_pipeline_id"] == "p-new" and "new_pipeline_spec" not in second
    assert (first["scheduling_policy"], first["primary_key_columns"], first["source_table_full_name"]) == (
        "SNAPSHOT", ["_inspire_row"], "main.inspire.a__lb")


def test_a_rebuild_reuses_its_pipeline_and_only_creates_the_new_copy(agent_ns):
    pipeline, calls = _synced(agent_ns, {("GET", "/api/2.0/pipelines/p1"): {"pipeline_id": "p1"},
                                         **_existing("inspire_lakebase.s.a", "MAIN.inspire.a__lb", "p1"),
                                         ("GET", f"{SYNCED}/inspire_lakebase.s.b"): [NOT_FOUND]}, held="p1")
    posts = [c for c in calls if c[0] == "POST"]
    assert pipeline == "p1" and len(posts) == 1 and posts[0][2]["spec"]["existing_pipeline_id"] == "p1"


def test_a_rebuild_that_finds_every_copy_creates_none_and_keeps_its_pipeline(agent_ns):
    pipeline, calls = _synced(agent_ns, {("GET", "/api/2.0/pipelines/p1"): {"pipeline_id": "p1"},
                                         **_existing("inspire_lakebase.s.a", "main.inspire.a__lb", "p1"),
                                         **_existing("inspire_lakebase.s.b", "main.inspire.b__lb", "p1")}, held="p1")
    assert pipeline == "p1" and not [c for c in calls if c[0] in ("POST", "DELETE")]


def test_a_pipeline_that_was_deleted_is_replaced(agent_ns):
    pipeline, calls = _synced(agent_ns, {("GET", "/api/2.0/pipelines/p-gone"): NOT_FOUND,
                                         ("GET", f"{SYNCED}/inspire_lakebase.s.a"): [NOT_FOUND, {"status": {"pipeline_id": "p-new"}}],
                                         ("GET", f"{SYNCED}/inspire_lakebase.s.b"): [NOT_FOUND]}, held="p-gone")
    assert pipeline == "p-new" and "new_pipeline_spec" in [c for c in calls if c[0] == "POST"][0][2]["spec"]


@pytest.mark.parametrize("routes,needle", [
    (_existing("inspire_lakebase.s.a", "main.other.t", "p1"),
     "the Lakebase table inspire_lakebase.s.a already copies main.other.t"),
    ({**_existing("inspire_lakebase.s.a", "main.inspire.a__lb", "p1"), **_existing("inspire_lakebase.s.b", "main.inspire.b__lb", "p2")},
     "the App's Lakebase tables are synced by more than one pipeline (p1, p2)"),
    (_existing("inspire_lakebase.s.a", "", "p1"),
     "Inspire cannot tell which table the Lakebase table inspire_lakebase.s.a copies"),
    ({**_existing("inspire_lakebase.s.a", "main.inspire.a__lb", "p1"), ("GET", f"{UC_TABLES}/inspire_lakebase.s.a"): NOT_FOUND},
     "Inspire cannot tell which table the Lakebase table inspire_lakebase.s.a copies"),
    ({**_existing("inspire_lakebase.s.a", "main.inspire.a__lb", "p1"),
      ("GET", f"{UC_TABLES}/inspire_lakebase.s.a"): type("PermissionDenied", (Exception,), {})("no")},
     "Inspire cannot tell which table the Lakebase table inspire_lakebase.s.a copies, because the identity Inspire runs as may not read it"),
], ids=["taken", "split", "no_source", "not_in_uc", "uc_forbidden"])
def test_copies_inspire_does_not_own_or_split_pipelines_stop_lakebase_with_the_reason(agent_ns, routes, needle):
    with pytest.raises(agent_ns["ImplementLakebaseUnavailable"]) as raised:
        _synced(agent_ns, routes)
    assert str(raised.value) == needle


@pytest.mark.parametrize("builder,ask", [
    ("sp-app-id", "ask its owner to run GRANT ALL PRIVILEGES ON CATALOG `inspire_lakebase` TO `sp-app-id`"),
    ("", "ask its owner to give the identity Inspire runs as ALL PRIVILEGES on that catalog"),
], ids=["named", "unnamed"])
def test_a_lakebase_schema_inspire_may_not_add_tables_to_names_the_grant_that_lets_it(agent_ns, builder, ask):
    import time
    denied = type("PermissionDenied", (Exception,), {})(
        "Principal 'app-x inspire' does not have CREATE TABLE and USE SCHEMA on Schema 'inspire_lakebase.s'. Config: host=https://ws.example")
    inst, _calls = _routed(agent_ns, {("POST", SYNCED): denied, ("GET", f"{SYNCED}/inspire_lakebase.s.a"): [NOT_FOUND]})
    inst._implement_builder = lambda: builder
    with pytest.raises(agent_ns["ImplementLakebaseUnavailable"]) as raised:
        inst._implement_lakebase_synced(json.loads(json.dumps(COPIES)), ["main", "inspire"], "", "_inspire_row", time.time() + 60)
    assert str(raised.value) == ("the identity Inspire runs as cannot add tables to the Lakebase schema inspire_lakebase.s; run the "
                                 f"Inspire installer again as an owner of the catalog inspire_lakebase, or {ask}")


def test_a_synced_table_error_that_is_not_about_permission_is_not_reworded(agent_ns):
    import time
    broken = RuntimeError("INVALID_PARAMETER_VALUE: primary key column _inspire_row is missing")
    inst, _calls = _routed(agent_ns, {("POST", SYNCED): broken, ("GET", f"{SYNCED}/inspire_lakebase.s.a"): [NOT_FOUND]})
    inst._implement_builder = lambda: "sp-app-id"
    with pytest.raises(RuntimeError) as raised:
        inst._implement_lakebase_synced(json.loads(json.dumps(COPIES)), ["main", "inspire"], "", "_inspire_row", time.time() + 60)
    assert raised.value is broken


ENDPOINT_ENV = {"name": "LAKEBASE_ENDPOINT", "valueFrom": "postgres"}


def test_a_lakebase_app_yaml_declares_its_endpoint_once_from_its_database_resource_and_stays_valid_yaml(agent_ns, tmp_path):
    import yaml
    shell_yaml = _app_shell(agent_ns, tmp_path)[0]["files"]["app.yaml"]
    built = agent_ns["implement_app_yaml"](shell_yaml, True)
    assert yaml.safe_load(built) == dict(yaml.safe_load(shell_yaml), env=yaml.safe_load(shell_yaml)["env"] + [ENDPOINT_ENV])
    assert agent_ns["implement_app_yaml_env"](built) == yaml.safe_load(built)["env"]
    assert agent_ns["implement_app_yaml"](built, True) == built
    assert agent_ns["implement_app_yaml"](shell_yaml, False) == shell_yaml
    assert yaml.safe_load(agent_ns["implement_app_yaml"]('command: ["uvicorn", "app:app"]\n', True))["env"] == [ENDPOINT_ENV]


def test_the_app_env_holds_what_its_app_yaml_declares_and_resolves_and_nothing_it_cannot_resolve(agent_ns):
    text = ('env:\n  - name: DATABRICKS_WAREHOUSE_ID\n    valueFrom: sql-warehouse\n  - name: MODE\n    value: "fast"\n'
            '  - name: LAKEBASE_ENDPOINT\n    valueFrom: postgres\n')
    env = agent_ns["implement_app_runtime_env"](text, {"sql-warehouse": "wh1"}, {"PGHOST": "pg.example"})
    assert env == {"PGHOST": "pg.example", "DATABRICKS_WAREHOUSE_ID": "wh1", "MODE": "fast"}
    assert agent_ns["implement_app_runtime_env"](None, {"postgres": LAKEBASE_ENDPOINT}, {}) == {}


def test_every_variable_the_lakebase_shell_reads_comes_from_the_apps_platform_or_the_app_yaml_inspire_deploys(agent_ns, tmp_path):
    payload, modules = _app_shell(agent_ns, tmp_path)
    assert set(agent_ns["IMPLEMENT_APP_POSTGRES_ENV"]) == APPS_POSTGRES_ENV
    declared = agent_ns["implement_app_yaml_env"](agent_ns["implement_app_yaml"](payload["files"]["app.yaml"], True))
    assert set(modules["shell_pg"].ENV_KEYS) <= APPS_POSTGRES_ENV | {e["name"] for e in declared}
    attached = {agent_ns["IMPLEMENT_APP_WAREHOUSE_RESOURCE"], agent_ns["implement_app_postgres_resource"]()["name"]}
    assert {e["valueFrom"] for e in declared if "valueFrom" in e} <= attached


def _checked(ns, tmp_path, app_yaml, build_env=ENV):
    import types
    _inst, out, _seen, _reader, _pg = _app_lakebase(ns, tmp_path)
    modules = _app_shell(ns, tmp_path / "check")[1]
    inst = _inspire(ns, FakeSpark())
    inst._implement_host = lambda: "https://ws.example"
    inst.w_client = types.SimpleNamespace(config=types.SimpleNamespace(authenticate=lambda: {}))
    core, seen = modules["shell_core"], {}
    held = json.loads(out["files"][core.SETTINGS_FILE])
    settings = dict(ns["implement_app_settings"](held["version"], "Churn desk", held["pages"], None, "Ask Genie is off in this check",
                                                 "2026-10-28T00:00:00Z", {"app_access": "sp", "app_backend": "lakebase"},
                                                 admin="builder"), backend=held["backend"])
    files = dict(out["files"], **{"app.yaml": app_yaml, core.SETTINGS_FILE: json.dumps(settings)})
    original = core.Shell.check
    core.Shell.check = lambda shell, headers: seen.update(env=shell.env, endpoint=shell.lakebase.endpoint) or []
    try:
        problems = inst._implement_app_check(str(tmp_path / "work"), files, modules, "wh1", build_env)
    finally:
        core.Shell.check = original
    return problems, seen


def test_the_lakebase_check_refuses_an_app_whose_app_yaml_does_not_give_it_its_endpoint(agent_ns, tmp_path):
    shell_yaml = _app_shell(agent_ns, tmp_path)[0]["files"]["app.yaml"]
    wider = dict(ENV, LAKEBASE_ENDPOINT=LAKEBASE_ENDPOINT, EXTRA="build-only")
    problems, seen = _checked(agent_ns, tmp_path, shell_yaml, wider)
    assert problems == ["the App has no Lakebase database to read: LAKEBASE_ENDPOINT is not set, so add its postgres resource"], (
        "a value only the build has must not make the check pass for an App that will not have it")
    assert seen == {}
    problems, seen = _checked(agent_ns, tmp_path, agent_ns["implement_app_yaml"](shell_yaml, True))
    assert problems == [] and seen["endpoint"] == LAKEBASE_ENDPOINT
    assert seen["env"] == dict(ENV, DATABRICKS_HOST="https://ws.example", DATABRICKS_WAREHOUSE_ID="wh1", LAKEBASE_ENDPOINT=LAKEBASE_ENDPOINT)


def test_the_build_gets_its_lakebase_password_for_the_inspire_endpoint(agent_ns, monkeypatch):
    import sys
    import types
    made, calls = [], []

    class Conn:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def cursor(self):
            return self

        def execute(self, statement):
            made.append(("sql", statement))

    monkeypatch.setitem(sys.modules, "psycopg", types.SimpleNamespace(connect=lambda **kw: made.append(kw) or Conn()))
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_api = lambda method, path, body=None, query=None: calls.append((method, path, body)) or {"token": "t1"}
    inst._implement_lakebase_sql(ENV, ["SELECT 1"])
    assert calls == [("POST", "/api/2.0/postgres/credentials", {"endpoint": LAKEBASE_ENDPOINT})]
    assert made[0]["user"] == "builder" and made[0]["password"] == "t1" and made[-1] == ("sql", "SELECT 1")


def test_a_result_table_with_a_run_log_also_copies_the_latest_run_of_its_log_and_the_backend_names_both_copies(agent_ns):
    page = {"id": "n01_u01", "result_table": "main.inspire.churn_out", "datasets": [], "records": {"key": "entity_id", "rank": "rank"}}
    copies = agent_ns["implement_lakebase_copies"]([page], "_inspire_row", shell_sql, {},
                                                   {"main.inspire.churn_out": "main.inspire.churn_out_run_log"})
    assert [(c["key"], c["role"]) for c in copies] == [("main.inspire.churn_out__lb", "current"),
                                                        ("main.inspire.churn_out__lb_changes", "changes")]
    assert copies[1]["body"] == ("SELECT * FROM `main`.`inspire`.`churn_out_run_log` WHERE run_id = (SELECT run_id FROM "
                                 "`main`.`inspire`.`churn_out_run_log` GROUP BY run_id ORDER BY MIN(ran_at) DESC LIMIT 1)"), \
        "the copy holds one row per record of the latest run, which says what changed since the run before"
    for copy, pg in zip(copies, ("churn_desk.n01_u01__t_aaaa", "churn_desk.n01_u01__c_bbbb")):
        copy.update(pg=pg, columns=[{"name": "record_key", "type": "STRING", "type_text": "STRING"}])
    backend = agent_ns["implement_lakebase_backend"]("pipe-1", copies)
    assert backend["current"] == {"main.inspire.churn_out": "main.inspire.churn_out__lb"}
    assert backend["changes"] == {"main.inspire.churn_out": "main.inspire.churn_out__lb_changes"}
    assert agent_ns["implement_lakebase_pg_table"]({"page": "n01_u01", "dataset": "", "role": "changes"}, []).startswith("n01_u01__c_")


def test_the_copies_are_indexed_on_the_record_key_and_on_each_sort_of_the_decision_list(agent_ns):
    page = {"id": "n01_u01", "result_table": "main.inspire.churn_out", "records": {"key": "entity_id", "rank": "rank", "label": "entity_label",
                                                                                   "tier": "priority_tier", "columns": [{"column": "region"}]}}
    column = lambda n: {"name": n, "type": "STRING", "type_text": "STRING"}
    copies = [{"page": "n01_u01", "dataset": "", "role": "current", "pg": "churn_desk.n01_u01__t_a", "columns": [column("record_key")]},
              {"page": "n01_u01", "dataset": "records", "pg": "churn_desk.n01_u01__d_records_b",
               "columns": [column(n) for n in ("record_key", "rank", "entity_label", "region")]},
              {"page": "n01_u01", "dataset": "trend", "pg": "churn_desk.n01_u01__d_trend_c", "columns": [column("region")]}]
    texts = [s.as_string(None) if hasattr(s, "as_string") else str(s) for s in agent_ns["implement_lakebase_index_sql"](copies, [page])]
    on = [t.split(" ON ", 1)[1] for t in texts]
    assert on == ['"churn_desk"."n01_u01__t_a" ("record_key")', '"churn_desk"."n01_u01__d_records_b" ("record_key")',
                  '"churn_desk"."n01_u01__d_records_b" ("rank", "record_key")',
                  '"churn_desk"."n01_u01__d_records_b" ("entity_label", "record_key")',
                  '"churn_desk"."n01_u01__d_records_b" ("region", "record_key")'], "a tier the copy lacks is not indexed"
    assert all(t.startswith('CREATE INDEX IF NOT EXISTS "ix_') for t in texts), "an index a later sync kept is never built twice"
