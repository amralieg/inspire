import json

from v120_artifacts_support import FakeSpark
from v140_implement_test import _app_shell, _churn_page, _dashboard, _inspire, _space, sdk_stub  # noqa: F401
from v142_scd_test import CORE, FACTS_LINE, HISTORY, QUOTED, QUOTED_LOG, TABLE, _describe, _Tables
from v148_app_hub_test import hub_page

import shell_alerts  # noqa: E402
import shell_sql  # noqa: E402

LOG_PROPS = {"inspire.run_log": f"{TABLE}_run_log", "inspire.run_log_tier": "priority_tier"}
LOG = f"{TABLE}_run_log"
LOG_SCHEMA = [{"col_name": n, "data_type": "string", "comment": None} for n in ("use_case_id", "run_id", "record_key", "tier")]


def _with_log(tables):
    respond = tables.respond

    def held(statement):
        if statement == f"DESCRIBE TABLE {QUOTED_LOG}":
            return LOG_SCHEMA
        return respond(statement)

    tables.spark.responder = held
    return tables


def _merge(tables):
    return tables.spark.statements[tables.index(f"MERGE INTO {QUOTED} ")]


def test_a_run_on_a_table_with_no_run_log_writes_a_version_of_every_record_and_starts_no_log(agent_ns):
    tables = _Tables(agent_ns, target=CORE + HISTORY)
    _rows, printed = tables.run()
    merge = _merge(tables)
    assert "u._inspire_same THEN UPDATE SET" not in merge and "FALSE AS _inspire_same" in merge, \
        "until Inspire moves the table to its run log, every run writes a version of every record, as every query baked from it expects"
    assert not [s for s in tables.spark.statements if QUOTED_LOG in s and not s.startswith("DESCRIBE")]
    assert tables.index(f"ALTER TABLE {QUOTED} SET TBLPROPERTIES") is None
    assert FACTS_LINE not in printed


def test_a_run_lists_its_records_in_a_run_log_that_exists_and_stamps_unchanged_records_only_once_the_table_points_at_it(agent_ns):
    tables = _with_log(_Tables(agent_ns, target=CORE + HISTORY))
    tables.run()
    assert "FALSE AS _inspire_same" in _merge(tables), "a log Inspire made ahead of the switch does not change how runs version records"
    assert tables.index(f"INSERT INTO {QUOTED_LOG} SELECT n.*") > tables.index(f"MERGE INTO {QUOTED} "), \
        "the log Inspire made ahead of the switch lists every run, so queries baked to read it stay right"
    switched = _with_log(_Tables(agent_ns, target=CORE + HISTORY, properties=LOG_PROPS))
    switched.run()
    assert "u._inspire_same THEN UPDATE SET" in _merge(switched)
    assert switched.index(f"INSERT INTO {QUOTED_LOG} SELECT n.*") > switched.index(f"MERGE INTO {QUOTED} ")


def test_a_run_whose_tier_column_is_not_the_logs_keeps_the_log_and_updates_only_the_tier_it_names(agent_ns):
    tables = _with_log(_Tables(agent_ns, target=CORE + HISTORY, properties=dict(LOG_PROPS, **{"inspire.run_log_tier": ""})))
    tables.run()
    assert tables.index(f"CREATE OR REPLACE TABLE {QUOTED_LOG} ") is None and tables.index(f"INSERT INTO {QUOTED_LOG} SELECT t.") is None, \
        "a table that versions only changed records cannot rebuild its log from its versions"
    assert f"ALTER TABLE {QUOTED} SET TBLPROPERTIES ('inspire.run_log_tier' = 'priority_tier')" in tables.spark.statements
    assert "u._inspire_same THEN UPDATE SET" in _merge(tables)


KEY = (5150, "N01-U01", 2)
FOLDER = "/Workspace/Users/owner@example.com/acme_implemented/Sales/alerts/churn-desk"
SCHEMA = CORE + HISTORY + [("category", "string"), ("value_at_stake", "double")]


def _agent(ns, properties=None, log=False):
    def respond(statement):
        if statement == f"SHOW TBLPROPERTIES {QUOTED}":
            return [{"key": k, "value": v} for k, v in (properties or {}).items()]
        if statement == f"DESCRIBE TABLE {QUOTED}":
            return _describe(SCHEMA)
        if statement == f"DESCRIBE TABLE {QUOTED_LOG}":
            if log:
                return LOG_SCHEMA
            raise RuntimeError("[TABLE_OR_VIEW_NOT_FOUND] not found")
        return []

    inst = _inspire(ns, FakeSpark(responder=respond))
    inst._implement_result_table_sharers = lambda key, table: []
    return inst


def _switches(inst):
    return [s for s in inst.spark.statements if s.startswith(f"ALTER TABLE {QUOTED} SET TBLPROPERTIES ('inspire.run_log'")]


def test_implement_lists_every_run_in_the_run_log_before_it_bakes_a_query_and_never_for_a_shared_table_or_an_old_writer(agent_ns):
    inst, warnings = _agent(agent_ns), []
    assert inst._implement_run_log_prepare("N01-U01", KEY, TABLE, True, warnings) == LOG
    made = [s for s in inst.spark.statements if s.startswith(f"CREATE OR REPLACE TABLE {QUOTED_LOG} ")]
    filled = [s for s in inst.spark.statements if s.startswith(f"INSERT INTO {QUOTED_LOG} ")]
    assert len(made) == 1 and len(filled) == 1 and warnings == []
    assert "LAG(run_id) OVER (ORDER BY MIN(ran_at))" in filled[0] and "THEN 'moved' END AS change" in filled[0], \
        "the latest run listed from the versions knows which records are new or moved, as one the run listed itself"
    assert _switches(inst) == [], "the table keeps a version of every record each run until every query baked from it reads the log"
    stale, shared = _agent(agent_ns), _agent(agent_ns)
    shared._implement_result_table_sharers = lambda key, table: [("77", "N02-U01")]
    assert stale._implement_run_log_prepare("N01-U01", KEY, TABLE, False, []) == ""
    assert shared._implement_run_log_prepare("N01-U01", KEY, TABLE, True, []) == ""
    for refused in (stale, shared):
        assert not [s for s in refused.spark.statements if QUOTED_LOG in s and not s.startswith("DESCRIBE")], \
            "a notebook that still writes the old way, or another use case's notebook, would leave runs out of the log"
    held = _agent(agent_ns, log=True)
    assert held._implement_run_log_prepare("N01-U01", KEY, TABLE, True, []) == LOG
    assert not [s for s in held.spark.statements if s.startswith(("CREATE", "INSERT"))]


def test_the_queries_implement_bakes_read_the_run_log_as_soon_as_it_exists_before_the_table_switches(agent_ns):
    fields = [{"name": n, "type": "STRING"} for n, _k in SCHEMA]
    assert _agent(agent_ns)._implement_history_layout(TABLE, shell_sql) is None
    layout = _agent(agent_ns, log=True)._implement_history_layout(TABLE, shell_sql)
    assert layout is not None and layout["log"] == shell_sql.table_name(LOG) and layout["tier"] == "priority_tier"
    assert layout["columns"] == [f["name"] for f in fields]


def test_the_table_switches_to_change_only_versions_once_every_output_it_has_was_rebuilt_to_read_the_run_log(agent_ns):
    context = {"uc_id": "N01-U01", "key": KEY, "result_table": TABLE, "run_log": LOG, "writer_current": True}
    assets, status = {"dashboard": "d1", "alert": "a1"}, {"dashboard": {"reads_run_log": True}, "alert": {"state": "ready"}}
    inst = _agent(agent_ns, log=True)
    assert inst._implement_run_log_finish(context, assets, status) == []
    assert _switches(inst) == [], "the alert was baked before the log existed and still counts runs from the versions"
    status["alert"]["reads_run_log"] = True
    assert inst._implement_run_log_finish(context, assets, status) == []
    assert _switches(inst) == [f"ALTER TABLE {QUOTED} SET TBLPROPERTIES ('inspire.run_log' = '{LOG}', 'inspire.run_log_tier' = 'priority_tier')"]
    stale = _agent(agent_ns, log=True)
    stale._implement_run_log_finish(dict(context, writer_current=False), assets, status)
    assert _switches(stale) == []
    done = _agent(agent_ns, properties=LOG_PROPS, log=True)
    done._implement_run_log_finish(context, assets, status)
    assert _switches(done) == []


def _alerts_agent(ns, alerts, page):
    inst, calls = _agent(ns, log=True), []
    store = {a["id"]: dict(a) for a in alerts}

    def api(method, path, body=None, query=None):
        calls.append((method, path, body, query))
        if path == "/api/2.0/workspace/list":
            assert query == {"path": FOLDER}
            return {"objects": [{"object_type": "ALERT", "object_id": int(i)} for i in store] + [{"object_type": "FILE", "object_id": 1}]}
        if method == "GET" and path.startswith("/api/2.0/alerts/"):
            return store[path.rsplit("/", 1)[1]]
        if method == "PATCH":
            store[path.rsplit("/", 1)[1]].update(body)
            return store[path.rsplit("/", 1)[1]]
        raise AssertionError((method, path))

    inst._implement_api = api
    inst._implement_app_shell = lambda: (None, {"shell_sql": shell_sql, "shell_alerts": shell_alerts, "shell_core": object()})
    inst._implement_app_host = lambda context, core, name="": {
        "settings": {"options": {"alerts": True}, "alert_folder": FOLDER}, "pages": [page, hub_page(ident="other", table="main.x.other")]}
    return inst, calls, store


def test_implement_moves_an_app_alert_to_the_run_log_only_when_its_query_is_the_one_the_app_wrote(agent_ns):
    page = hub_page(table=TABLE)
    names = {n for n, _k in SCHEMA}
    layout = shell_sql.history_layout(LOG_PROPS, [{"name": n, "type": "STRING"} for n, _k in SCHEMA])
    watch = {"what": "records", "filters": {"category": ["A"]}, "operator": ">", "threshold": 3, "basis": "baseline"}

    def saved(ident, name, history=None, kind="watch", page_id=page["id"], **changes):
        meta = {"v": 1, "kind": kind, "page": page_id, "by": "pat@example.com", "name": name, "watch": dict(watch, **changes),
                "schedule": "daily", "token": ident[-6:]}
        query = shell_sql.watch_query(page, meta["watch"], names, history)["query"]
        return {"id": ident, "display_name": name, "query_text": shell_alerts.write_meta(meta, query)}

    old, edited, current = saved("9001", "Spike"), saved("9002", "Edited"), saved("9003", "Current", layout)
    edited["query_text"] += "\n-- tuned by hand"
    fixed, elsewhere = saved("9004", "Fixed", basis="fixed"), saved("9005", "Elsewhere", page_id="other")
    inst, calls, store = _alerts_agent(agent_ns, [old, edited, current, fixed, elsewhere], page)
    warnings, unread = inst._implement_app_alerts_reread({"uc_id": "N01-U01", "key": KEY, "result_table": TABLE}, {"app": "churn-desk"})
    patched = [c for c in calls if c[0] == "PATCH"]
    assert [c[1] for c in patched] == ["/api/2.0/alerts/9001"] and patched[0][3] == {"update_mask": "query_text"}
    assert store["9001"]["query_text"] == current["query_text"].replace(current["query_text"].split("\n", 1)[0],
                                                                        old["query_text"].split("\n", 1)[0])
    assert f"FROM {shell_sql.table_name(LOG)}" in store["9001"]["query_text"]
    assert unread is False and len(warnings) == 1 and "'Edited'" in warnings[0] and "pat@example.com" in warnings[0], warnings
    assert store["9002"]["query_text"] == edited["query_text"] and store["9004"]["query_text"] == fixed["query_text"]


def test_an_app_whose_alerts_cannot_be_read_keeps_the_table_on_a_version_of_every_record_each_run(agent_ns):
    inst, _calls, _store = _alerts_agent(agent_ns, [], hub_page(table=TABLE))

    def broken(method, path, body=None, query=None):
        raise RuntimeError("PERMISSION_DENIED: the folder is not shared")

    inst._implement_api = broken
    context = {"uc_id": "N01-U01", "key": KEY, "result_table": TABLE, "run_log": LOG, "writer_current": True}
    warnings = inst._implement_run_log_finish(context, {"app": "churn-desk"}, {"app": {"reads_run_log": True}})
    assert _switches(inst) == [] and len(warnings) == 1 and "PERMISSION_DENIED" in warnings[0]


RUNS = {"table": TABLE, "log": LOG}


def test_a_query_that_counts_or_compares_runs_from_the_versions_is_refused_once_the_table_has_a_run_log(agent_ns):
    problems = agent_ns["implement_run_version_problems"]
    counted = f"SELECT run_id, COUNT(*) AS n FROM {TABLE} WHERE change_source = 'run' GROUP BY run_id"
    assert problems([counted], "x", None) == [], "a table written one version per run answers from its versions"
    assert problems([counted], "an example SQL of the Genie Agent", RUNS) == [
        f"an example SQL of the Genie Agent reads the versions of {TABLE} run by run, but a run writes a new version of a record only "
        f"when its values change: read the current rows with is_current, or count and compare runs from {LOG}, which lists every "
        "record of every run"]
    for good in (f"SELECT COUNT(*) FROM {TABLE} WHERE is_current AND change_source <> 'delete' AND as_of_date >= '2026-01-01'",
                 f"SELECT run_id, COUNT(*) FROM {LOG} GROUP BY run_id",
                 f"SELECT date(valid_from) AS d, COUNT(*) FROM {TABLE} WHERE change_source = 'action' GROUP BY 1",
                 f"WITH c AS (SELECT * FROM `main`.`inspire`.`churn_out` AS t WHERE t.`is_current`) SELECT as_of_date, COUNT(*) FROM c GROUP BY 1",
                 f"SELECT * FROM {TABLE} WHERE is_current = TRUE AND run_id = 'r1'"):
        assert problems([good], "x", RUNS) == [], good
    for bad in (f"WITH c AS (SELECT * FROM {TABLE} WHERE is_current), h AS (SELECT run_id, rank FROM {TABLE}) SELECT * FROM h",
                f"SELECT as_of_date, SUM(value_at_stake) FROM {TABLE} GROUP BY as_of_date",
                f"SELECT * FROM {TABLE} WHERE NOT is_current AND run_id = 'r1'",
                f"SELECT * FROM {TABLE} WHERE is_current = FALSE AND as_of_date > '2026-01-01'"):
        assert problems([bad], "x", RUNS), bad
    reasons, viewed = f"{TABLE}_reasons", dict(RUNS, views=[f"{TABLE}_reasons"])
    by_run = f"SELECT run_id, reason, COUNT(*) FROM {reasons} GROUP BY run_id, reason"
    assert problems([by_run], "x", RUNS) == [] and problems([by_run], "x", viewed) == [
        f"x reads the versions of {reasons} run by run, but a run writes a new version of a record only when its values change: read "
        f"the current rows with is_current, or count and compare runs from {LOG}, which lists every record of every run"], \
        "the reasons view lists every version of each record too"
    assert problems([f"SELECT reason, COUNT(*) FROM {reasons} WHERE is_current GROUP BY reason, as_of_date"], "x", viewed) == []


def test_every_output_checker_refuses_sql_that_reads_runs_from_the_versions_of_a_table_with_a_run_log(agent_ns, tmp_path):
    allowed = [TABLE, "main.s.orders", LOG]
    trend = f"SELECT as_of_date, COUNT(*) AS n FROM {TABLE} GROUP BY as_of_date"
    board = json.loads(_dashboard())
    board["datasets"].append({"name": "trend", "queryLines": [trend]})
    lead = f"reads the versions of {TABLE} run by run"
    assert not any(lead in e for e in agent_ns["check_dashboard_definition"](json.dumps(board), allowed)[1])
    assert any(lead in e for e in agent_ns["check_dashboard_definition"](json.dumps(board), allowed, run_versions=RUNS)[1])
    assert any(lead in e for e in agent_ns["normalize_genie_space"](_space(sql=trend), allowed, run_versions=RUNS)[3])
    assert not any(lead in e for e in agent_ns["normalize_genie_space"](_space(sql=trend), allowed)[3])
    shell = _app_shell(agent_ns, tmp_path)[1]["shell_sql"]
    page = _churn_page(agent_ns)
    page["datasets"].append({"name": "by_run", "sql": trend})
    found = agent_ns["implement_app_page_problems"](page, shell, allowed, False, run_versions=RUNS)
    assert any(lead in e for e in found), found
    condition = f"SELECT COUNT(DISTINCT run_id) > 3 AS triggered FROM {TABLE}"
    assert any(lead in e for e in agent_ns["check_alert_condition_sql"](condition, allowed, run_versions=RUNS))
    assert not agent_ns["check_alert_condition_sql"](condition, allowed)


def test_a_build_hands_the_run_log_to_the_outputs_it_rebuilds_and_marks_only_those_as_reading_it(agent_ns):
    import pytest
    from v140_implement_test import VALID, _probe_inspire

    def respond(statement):
        if statement == f"DESCRIBE TABLE {QUOTED_LOG}":
            return LOG_SCHEMA
        if statement == f"DESCRIBE TABLE {QUOTED}":
            return _describe(SCHEMA)
        if statement.startswith("SELECT COUNT_IF(is_current IS NULL) AS pending"):
            return [{"pending": 0}]
        return None

    inst = _probe_inspire(agent_ns, respond, {"dashboard": {"state": "ready", "spec_version": 2}})
    inst._implement_runner = lambda uc: "runner"
    inst._implement_fill_and_preview = lambda *a: ({"status": "written", "rows_written": 12}, 77, {})
    inst._implement_app_alerts_reread = lambda context, assets: ([], False)
    seen = []
    inst._implement_dashboard = lambda c, r: pytest.fail("the dashboard did not change")
    inst._implement_genie_space = lambda c, r: seen.append(c) or {"genie_space_id": "g1", "genie_space_url": "https://h/genie/rooms/g1"}
    inst._implement_app = lambda c, r: seen.append(c) or {"app_name": "churn-desk", "app_url": "https://churn-desk.example",
                                                          "app_health": "running"}
    assert inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": dict(VALID)},
                                      (5150, "N01-U01", 3)) == "ready"
    assert len(seen) == 2 and all(c["run_log"] == LOG and LOG in c["allowed"] and c["run_versions"] == dict(RUNS, views=[f"{TABLE}_reasons"])
                                  for c in seen)
    status = inst.updates[-1]["asset_status"]
    assert status["genie_space"]["reads_run_log"] is True and status["app"]["reads_run_log"] is True
    assert "reads_run_log" not in status["dashboard"], "the dashboard Inspire did not rebuild may still count runs from the versions"
    assert _switches(inst) == []


GRANT_LOG = f"GRANT SELECT ON TABLE {QUOTED_LOG} TO `{{}}`"


def test_the_run_log_is_a_companion_of_the_result_table_wherever_people_or_the_app_read_it(agent_ns, sdk_stub):
    from v140_implement_test import (ACCESS_TABLE, LIVE_ACCESS, READS, REASONS_VIEW, SHELL_FILES, SUMMARY_TABLE, _access_spark,
                                     _deploy_inspire, _spec)
    assert LOG in agent_ns["implement_companion_tables"](TABLE)
    inst, context, _calls, _imported = _deploy_inspire(agent_ns, [
        RuntimeError("RESOURCE_DOES_NOT_EXIST: app churn-desk"),
        {"compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-1"},
        {"deployment_id": "dep1", "status": {"state": "SUCCEEDED"}}, {"url": "https://churn-desk.example/"}])
    context["run_log"] = LOG
    inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert GRANT_LOG.format("sp-1") in inst.spark.statements, "the App reads each run's records from the log"
    shared = _inspire(agent_ns, _access_spark(LIVE_ACCESS))
    shared._implement_api = lambda method, path, body=None, query=None: {}
    shared._implement_emit = lambda *a, **k: None
    spec = dict(_spec(agent_ns)[0], sharing={"principals": [{"type": "user", "name": "amr@x"}]})
    assert shared._implement_share("N01-U01", ACCESS_TABLE, spec, {}, None, REASONS_VIEW, SUMMARY_TABLE, run_log=LOG) == []
    assert GRANT_LOG.format("amr@x") in shared.spark.statements, "the people it is shared with read the runs the App lists"
