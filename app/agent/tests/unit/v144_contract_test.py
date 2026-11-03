import datetime
import json
import re
import types

import pytest

from v120_artifacts_support import CapturingLogger, FakeSpark
from v140_implement_test import (CHURN_UC, OURS_APP, READS, SHELL_FILES, VALID, _app_flow, _churn_page, _deploy_inspire, _inspire,
                                 _NotebookWorkspace, _notebook_inspire, _output_context, _spec, sdk_stub)  # noqa: F401
from v141_app_shell_test import PAGE
from v142_merge_test import OWN_SOURCE, _host_files, _host_page, _merge_flow, _restyle_inspire
from v142_scd_test import (CORE, FACTS_LINE, HISTORY, LAYOUT_LINE, LOGGED, NOW, OUTCOME_LINE, QUOTED, QUOTED_STAGE, RUN_LOG_LINE, TABLE, VERSION, _describe,
                           _Tables)
import shell_sql

ACTIONS = [("action_owner", "string"), ("action_status", "string"), ("action_due", "date"), ("action_note", "string"),
           ("dismiss_reason", "string"), ("action_outcome", "string"), ("realized_value", "double"), ("realized_note", "string"),
           ("snooze_until", "date"), ("action_batch", "string"), ("action_batch_note", "string"), ("action_batch_values", "string"),
           ("joined_at", "timestamp")]
ACTION_LIST = ("action_owner, action_status, action_due, action_note, dismiss_reason, action_outcome, realized_value, realized_note, "
               "snooze_until, action_batch, action_batch_note, action_batch_values, joined_at")
REPLACEABLE = "change_source IN ('run', 'action')"
UNEDITED = " AND NOT COALESCE({a}.edited_by_person, FALSE)"
LATEST = (f"FROM {QUOTED} AS r WHERE r.use_case_id = 'N01-U01' QUALIFY ROW_NUMBER() OVER (PARTITION BY r.record_key ORDER BY "
          "r.is_current DESC, r.valid_from DESC) = 1")
CARRIED_VALUES = ("u.`action_owner`, u.`action_status`, u.`action_due`, u.`action_note`, u.`dismiss_reason`, CASE WHEN "
                  "u.`action_status` IN ('Done', 'Could not fix') AND u.`priority_tier` IN ('Act now', 'Review') THEN 'Still flagged' "
                  "WHEN u.`action_status` IN ('Done', 'Could not fix') THEN 'Resolved' ELSE u.`action_outcome` END, u.`realized_value`, "
                  "u.`realized_note`, u.`snooze_until`, CAST(NULL AS STRING), CAST(NULL AS STRING), CAST(NULL AS STRING), CASE WHEN "
                  f"u._inspire_was_source IS NULL THEN {NOW} ELSE u.`joined_at` END, u._inspire_record_key")
DISMISSED_TIER = "CASE WHEN u.`action_status` = 'Dismissed' THEN 'Monitor' ELSE u.`priority_tier` END"
COUNTS = "SELECT COUNT_IF(t.action_status = 'Dismissed') AS dismissed"
WAREHOUSE = {"name": "sql-warehouse", "sql_warehouse": {"id": "wh1", "permission": "CAN_USE"}}
OWN_JOB = {"name": "job-n01-u01", "job": {"id": "77", "permission": "CAN_MANAGE_RUN"}}
ME = "SELECT current_user() AS me"
NB = "/W/acme_implemented/Sales/N01-U01"


def _merge(ns, target=None, stage=CORE, properties=None, counts=None):
    tables = _Tables(ns, stage=stage, target=CORE + HISTORY + ACTIONS if target is None else target,
                     properties=dict(LOGGED, **(properties or {})))
    if counts is not None:
        tables.spark.responder = lambda s: (counts(s) if callable(counts) else counts) if s.startswith(COUNTS) else tables.respond(s)
    _rows, printed = tables.run()
    merge = tables.index("MERGE INTO")
    return tables, (tables.spark.statements[merge] if merge is not None else ""), printed


def test_an_action_version_is_replaceable_unless_a_person_edited_the_record_and_an_edit_only_when_the_use_case_allows(agent_ns):
    _tables, sql, _printed = _merge(agent_ns)
    assert f"COALESCE(p.is_current AND p.{REPLACEABLE}{UNEDITED.format(a='p')}, FALSE) AS _inspire_was_open" in sql
    assert f"WHEN MATCHED AND t.{REPLACEABLE}{UNEDITED.format(a='t')} THEN UPDATE SET valid_to = {NOW}, is_current = FALSE" in sql
    assert f"t.use_case_id = 'N01-U01' AND t.is_current AND t.{REPLACEABLE}{UNEDITED.format(a='t')} THEN UPDATE" in sql
    assert "change_source = 'run'" not in sql and sql.count("q._inspire_was_source = 'run'") == 1, \
        "an unedited action version is replaced by the run, never kept like an edit; only a run version is kept as it was"
    assert agent_ns["inspire_replaceable_sql"]("c", False) == f"c.{REPLACEABLE}{UNEDITED.format(a='c')}"
    assert agent_ns["inspire_replaceable_sql"]("c", True) == "TRUE"
    kept = agent_ns["inspire_kept_edits_sql"](TABLE, "N01-U01")
    assert kept.endswith(f"AND t.is_current AND NOT (t.{REPLACEABLE}{UNEDITED.format(a='t')})"), "an unedited action version is not a kept edit"
    assert agent_ns["INSPIRE_REPLACEABLE_SOURCES"] == ("run", "action")


def test_every_new_run_version_carries_the_actions_from_the_record_s_latest_version(agent_ns):
    _tables, sql, _printed = _merge(agent_ns)
    assert sql.count(LATEST) == 1, "the record's latest version is read once, for the comparison and for the new version"
    assert f"FROM {QUOTED_STAGE} AS s LEFT JOIN (SELECT * {LATEST}) AS p ON p.record_key = CAST(s.`entity_id` AS STRING)" in sql
    assert ("p.`action_owner`, p.`action_status`, p.`action_due`, p.`action_note`, p.`dismiss_reason`, p.`action_outcome`, "
            "p.`realized_value`, p.`realized_note`, p.`snooze_until`, p.`action_batch`, p.`action_batch_note`, p.`action_batch_values`, "
            "p.`joined_at`, COALESCE(p.is_current, FALSE) AS _inspire_was_current") in sql
    insert = sql.split("WHEN NOT MATCHED THEN INSERT (", 1)[1]
    assert insert.startswith("`as_of_date`, `entity_id`, `entity_label`, `segment_or_item`, `rank`, `priority_tier`, `top_reasons`, "
                             "`explanation`, `run_id`, `use_case_id`, `action_owner`, `action_status`, `action_due`, `action_note`, "
                             "`dismiss_reason`, `action_outcome`, `realized_value`, `realized_note`, `snooze_until`, `action_batch`, "
                             "`action_batch_note`, `action_batch_values`, `joined_at`, record_key, valid_from")
    assert f"u.`rank`, {DISMISSED_TIER}, u.`top_reasons`" in insert, "a dismissed record is written as Monitor"
    assert CARRIED_VALUES in insert
    assert "s.`action_status`" not in sql, "the run's rows never set an action column"


def test_a_use_case_that_lets_runs_replace_edits_still_carries_the_actions(agent_ns):
    tables, sql, printed = _merge(agent_ns, properties={"inspire.replace_edits": "true"})
    assert "COALESCE(p.is_current AND TRUE, FALSE) AS _inspire_was_open" in sql and "WHEN MATCHED AND TRUE" in sql
    assert REPLACEABLE not in sql
    assert CARRIED_VALUES in sql and DISMISSED_TIER in sql
    assert tables.index("SELECT COUNT(*) AS kept") is None
    assert "runs replace the records people changed in the App" in printed[-5]
    assert printed[-4:] == [OUTCOME_LINE, RUN_LOG_LINE, FACTS_LINE, LAYOUT_LINE]


def test_a_run_without_a_priority_tier_still_carries_the_actions_and_writes_no_tier(agent_ns):
    _tables, sql, _printed = _merge(agent_ns, stage=[c for c in CORE if c[0] != "priority_tier"])
    insert = sql.split("WHEN NOT MATCHED THEN INSERT (", 1)[1]
    assert "'Monitor'" not in sql and "`priority_tier`" not in insert, "a run without a tier writes none"
    assert "p.`priority_tier` AS _inspire_kept_0" in sql and "q._inspire_kept_0 IS NULL" in sql, \
        "a record whose current version holds a tier gets a new version without it, as before"
    assert ("CASE WHEN u.`action_status` IN ('Done', 'Could not fix') AND NULL IN ('Act now', 'Review') THEN 'Still flagged' WHEN "
            "u.`action_status` IN ('Done', 'Could not fix') THEN 'Resolved' ELSE u.`action_outcome` END") in sql
    counts = agent_ns["inspire_action_counts_sql"](TABLE, "main.inspire.churn_out_inspire_stage", ["entity_id"], ("entity_id",))
    assert "COUNT_IF(FALSE) AS kept_out" in counts


def test_a_run_never_adds_the_action_columns_every_table_this_version_builds_has(agent_ns):
    for target in (CORE + HISTORY, CORE + HISTORY + [("action_status", "string")], CORE + HISTORY + ACTIONS[:6]):
        tables, _sql, printed = _merge(agent_ns, target=target)
        assert not any(s.startswith(f"ALTER TABLE {QUOTED} ADD COLUMNS") for s in tables.spark.statements), target
        assert not any(p.startswith("Actions: added") for p in printed)
        assert not any("kept action_" in p or "kept dismiss_reason" in p for p in printed), "the action columns are not unwritten columns"


def test_a_first_run_creates_the_action_columns_with_their_types(agent_ns):
    first = _Tables(agent_ns, target=None)
    first.run()
    create = [s for s in first.spark.statements if s.startswith("CREATE TABLE")][0]
    assert ("s.`use_case_id`, CAST(NULL AS STRING) AS `action_owner`, CAST(NULL AS STRING) AS `action_status`, CAST(NULL AS DATE) AS "
            "`action_due`, CAST(NULL AS STRING) AS `action_note`, CAST(NULL AS STRING) AS `dismiss_reason`, CAST(NULL AS STRING) AS "
            "`action_outcome`, CAST(NULL AS DOUBLE) AS `realized_value`, CAST(NULL AS STRING) AS `realized_note`, CAST(NULL AS DATE) AS "
            "`snooze_until`, CAST(NULL AS STRING) AS `action_batch`, CAST(NULL AS STRING) AS `action_batch_note`, CAST(NULL AS STRING) AS "
            f"`action_batch_values`, {NOW} AS `joined_at`, CAST(NULL AS BOOLEAN) AS `edited_by_person`, CAST(NULL AS TIMESTAMP) AS "
            "`not_listed_since`, CAST(s.`entity_id` AS STRING) AS record_key") in create


def test_action_columns_in_the_run_s_rows_are_left_out_and_said_so(agent_ns):
    stage = CORE + [("action_status", "string"), ("Dismiss_Reason", "string")]
    tables, sql, printed = _merge(agent_ns, stage=stage)
    assert "s.`action_status`" not in sql and "s.`Dismiss_Reason`" not in sql and CARRIED_VALUES in sql
    assert ("Business output: left out action_status, Dismiss_Reason from the run's rows: people set them in the App, and each run "
            "carries them forward from the record's current version") in printed
    first = _Tables(agent_ns, stage=stage, target=None)
    first.run()
    create = [s for s in first.spark.statements if s.startswith("CREATE TABLE")][0]
    assert "s.`action_status`" not in create and create.count("AS `action_status`") == 1


def test_the_run_line_reports_the_dismissed_records_kept_out_of_act_now_and_the_outcomes_written(agent_ns):
    tables, _sql, printed = _merge(agent_ns, counts=[{"dismissed": 4, "kept_out": 3, "resolved": 2, "still_flagged": 1}])
    assert ("; kept 4 dismissed records in Monitor (3 out of Act now), and wrote 3 outcomes for records people marked Done "
            f"(2 Resolved, 1 Still flagged); the table as it was before this run is its version {VERSION}, which RESTORE TABLE {TABLE} TO "
            f"VERSION AS OF {VERSION} brings back") in printed[-5]
    assert printed[-4:] == [OUTCOME_LINE, RUN_LOG_LINE, FACTS_LINE, LAYOUT_LINE]
    counted = [s for s in tables.spark.statements if s.startswith(COUNTS)]
    assert counted == [agent_ns["inspire_action_counts_sql"](TABLE, "main.inspire.churn_out_inspire_stage",
                                                             [n for n, _k in CORE], ("entity_id",))]
    assert tables.spark.statements.index(counted[0]) > tables.index("MERGE INTO"), "the counts read what the merge wrote"
    assert (f"FROM {QUOTED} AS t JOIN {QUOTED_STAGE} AS s ON t.use_case_id = s.use_case_id AND t.run_id = s.run_id AND t.record_key = "
            "CAST(s.`entity_id` AS STRING) WHERE t.is_current AND t.change_source = 'run'") in counted[0]
    assert "COUNT_IF(t.action_status = 'Dismissed' AND s.`priority_tier` = 'Act now') AS kept_out" in counted[0]

    def broken(statement):
        raise RuntimeError("PERMISSION_DENIED: no SELECT")

    _tables, _sql, failed = _merge(agent_ns, counts=broken)
    assert ("the actions people took in the App were carried forward, but Inspire could not count them: PERMISSION_DENIED: no "
            "SELECT") in failed[-5], "a count that fails never fails the run that already merged"
    assert failed[-4:] == [OUTCOME_LINE, RUN_LOG_LINE, FACTS_LINE, LAYOUT_LINE], \
        "the run goes on to write its outcome, its run log, its facts and its layout"


def test_the_build_records_only_the_edit_choice_and_never_adds_a_column(agent_ns):
    for target in (CORE, CORE + HISTORY):
        inst = _inspire(agent_ns, FakeSpark(responder=lambda s, t=target: _describe(t) if s.startswith("DESCRIBE") else []))
        inst._implement_result_history("N01-U01", TABLE, _spec(agent_ns)[0], [])
        assert inst.spark.statements == [f"DESCRIBE TABLE {QUOTED}",
                                         f"ALTER TABLE {QUOTED} SET TBLPROPERTIES ('inspire.replace_edits' = 'false')"], target
    missing = _inspire(agent_ns, FakeSpark(responder=lambda s: (_ for _ in ()).throw(RuntimeError("[TABLE_OR_VIEW_NOT_FOUND] x"))))
    missing._implement_result_history("N01-U01", TABLE, _spec(agent_ns)[0], [])
    assert not any(s.startswith("ALTER") for s in missing.spark.statements), "a table no run made yet is left alone"


def test_genie_is_told_the_action_columns_belong_to_the_app(agent_ns):
    rule = agent_ns["GENIE_RESULT_HISTORY_RULE"]
    assert (f"The columns {ACTION_LIST} hold what people do "
            "about each record in the App, and inspire_write_result carries them to each new version, so the run's rows never set "
            "them; a record people dismissed stays Monitor, so never put it back in Act now.") in rule


class _Frame:
    def __init__(self, rows):
        self.rows = rows

    def collect(self):
        return self.rows


class _EngineSpark:
    KINDS = {"VARCHAR": "string", "TIMESTAMP WITH TIME ZONE": "timestamp", "TIMESTAMP": "timestamp", "INTEGER": "int", "DATE": "date",
             "BOOLEAN": "boolean"}
    TYPES = {"STRING": "VARCHAR", "DATE": "DATE", "TIMESTAMP": "TIMESTAMPTZ", "BOOLEAN": "BOOLEAN", "DOUBLE": "DOUBLE"}

    def __init__(self, duckdb, sqlglot):
        self.duckdb, self.sqlglot = duckdb, sqlglot
        self.db = duckdb.connect()
        self.db.execute("ATTACH ':memory:' AS m")
        self.db.execute("CREATE SCHEMA m.inspire")
        self.props = {}

    def rows(self, sql, params=None):
        cursor = self.db.execute(sql, params or [])
        if cursor.description is None:
            return []
        names = [d[0] for d in cursor.description]
        return [dict(zip(names, row)) for row in cursor.fetchall()]

    def sql(self, statement, args=None):
        text = " ".join(str(statement).split())
        if text.startswith("DESCRIBE TABLE "):
            try:
                found = self.rows(f"DESCRIBE {text[len('DESCRIBE TABLE '):]}".replace("`", '"'))
            except self.duckdb.CatalogException:
                raise RuntimeError("[TABLE_OR_VIEW_NOT_FOUND] the table cannot be found")
            return _Frame([{"col_name": r["column_name"], "data_type": self.KINDS.get(r["column_type"], r["column_type"].lower())}
                           for r in found])
        if text.startswith("SHOW TBLPROPERTIES"):
            return _Frame([{"key": k, "value": v} for k, v in self.props.items()])
        clone = re.match(r"CREATE OR REPLACE TABLE (\S+) DEEP CLONE (\S+)$", text)
        if clone:
            return _Frame(self.rows(f"CREATE OR REPLACE TABLE {clone.group(1)} AS SELECT * FROM {clone.group(2)}".replace("`", '"')))
        add = re.match(r"ALTER TABLE (\S+) ADD COLUMNS \((.*)\)$", text)
        if add:
            for part in add.group(2).split(", "):
                name, kind = part.split(" ")
                self.rows(f"ALTER TABLE {add.group(1)} ADD COLUMN {name} {self.TYPES[kind]}".replace("`", '"'))
            return _Frame([])
        return _Frame(self.rows(self.sqlglot.transpile(text, read="databricks", write="duckdb")[0]))


STAGE_TABLE = "m.inspire.churn_out_inspire_stage"
RESULT_TABLE = "m.inspire.churn_out"


def _engine():
    return _EngineSpark(pytest.importorskip("duckdb"), pytest.importorskip("sqlglot"))


def _stage(spark, run, tiers):
    spark.rows(f"CREATE OR REPLACE TABLE {STAGE_TABLE} (as_of_date DATE, entity_id VARCHAR, entity_label VARCHAR, priority_tier VARCHAR, "
               "rank INTEGER, run_id VARCHAR, use_case_id VARCHAR)")
    for rank, (entity, tier) in enumerate(tiers, 1):
        spark.rows(f"INSERT INTO {STAGE_TABLE} VALUES (DATE '2026-10-0{run}', ?, ?, ?, ?, ?, 'N01-U01')",
                   [entity, f"Customer {entity}", tier, rank, f"r-{run}"])


def _app_change(spark, entity, source, **values):
    row = spark.rows(f"SELECT * EXCLUDE (valid_from, valid_to) FROM {RESULT_TABLE} WHERE entity_id = ? AND is_current", [entity])[0]
    spark.rows(f"UPDATE {RESULT_TABLE} SET is_current = FALSE, valid_to = current_timestamp WHERE entity_id = ? AND is_current", [entity])
    row.update(values, change_source=source, changed_by="someone@example.com", is_current=True)
    spark.rows(f"INSERT INTO {RESULT_TABLE} ({', '.join(row)}, valid_from) VALUES ({', '.join('?' for _ in row)}, current_timestamp)",
               list(row.values()))


def _run(ns, spark):
    printed = []
    ns["inspire_merge_run"](spark, RESULT_TABLE, STAGE_TABLE, out=printed.append)
    return printed


def _current(spark):
    return {r["entity_id"]: r for r in spark.rows(f"SELECT * FROM {RESULT_TABLE} WHERE is_current AND change_source <> 'delete'")}


def test_the_merge_carries_actions_on_a_sql_engine(agent_ns):
    spark = _engine()
    _stage(spark, 1, [("a", "Act now"), ("b", "Act now"), ("c", "Review"), ("d", "Review"), ("e", "Monitor"), ("h", "Act now")])
    _run(agent_ns, spark)
    _app_change(spark, "a", "action", action_status="Dismissed", dismiss_reason="already called", action_owner="ana@example.com",
                action_note="called twice", action_due=datetime.date(2026, 11, 1))
    _app_change(spark, "b", "edit", entity_label="Customer B, renamed", action_status="In progress")
    _app_change(spark, "c", "action", action_status="Done")
    _app_change(spark, "d", "action", action_status="Done")
    _app_change(spark, "e", "action", action_status="In progress", action_owner="eve@example.com")
    _app_change(spark, "h", "action", action_status="Dismissed", dismiss_reason="duplicate")
    _stage(spark, 2, [("a", "Act now"), ("b", "Act now"), ("c", "Monitor"), ("d", "Act now"), ("e", "Review"), ("g", "Act now")])
    printed = _run(agent_ns, spark)
    now = _current(spark)
    a, b, c, d, e, g = (now[k] for k in "abcdeg")
    assert (a["change_source"], a["run_id"], a["priority_tier"]) == ("run", "r-2", "Monitor"), "a dismissed record stays out of Act now"
    assert (a["action_status"], a["dismiss_reason"], a["action_owner"], a["action_note"], str(a["action_due"])) == (
        "Dismissed", "already called", "ana@example.com", "called twice", "2026-11-01")
    assert (b["change_source"], b["run_id"], b["entity_label"]) == ("edit", "r-1", "Customer B, renamed"), "an edit is kept"
    assert (c["priority_tier"], c["action_status"], c["action_outcome"]) == ("Monitor", "Done", "Resolved")
    assert (d["priority_tier"], d["action_status"], d["action_outcome"]) == ("Act now", "Done", "Still flagged")
    assert (e["action_owner"], e["action_status"], e["action_outcome"], e["priority_tier"]) == ("eve@example.com", "In progress", None,
                                                                                                 "Review")
    assert (g["action_status"], g["action_outcome"], g["priority_tier"]) == (None, None, "Act now")
    assert "h" not in now, "a record the run left out is closed, its action version too"
    assert spark.rows(f"SELECT COUNT(*) AS n FROM {RESULT_TABLE} WHERE entity_id = 'a' AND change_source = 'action' AND is_current")[0][
        "n"] == 0, "the action version of a record the run wrote again is closed"
    assert ("kept 1 dismissed record in Monitor (1 out of Act now), and wrote 2 outcomes for records people marked Done "
            "(1 Resolved, 1 Still flagged)") in "\n".join(printed)
    spark.props = {"inspire.replace_edits": "true"}
    _stage(spark, 3, [("a", "Act now"), ("b", "Act now"), ("h", "Act now")])
    printed = _run(agent_ns, spark)
    now = _current(spark)
    assert (now["b"]["change_source"], now["b"]["entity_label"], now["b"]["action_status"]) == ("run", "Customer b", "In progress"), \
        "a run that replaces edits still carries the edit version's actions"
    assert (now["h"]["priority_tier"], now["h"]["action_status"], now["h"]["dismiss_reason"]) == ("Monitor", "Dismissed", "duplicate"), \
        "a dismissed record that comes back after a run left it out still never returns to Act now"
    assert "kept 2 dismissed records in Monitor (2 out of Act now)" in "\n".join(printed)


def test_a_table_from_before_the_action_columns_gets_them_on_a_sql_engine(agent_ns):
    spark = _engine()
    _stage(spark, 1, [("a", "Act now"), ("b", "Review")])
    _run(agent_ns, spark)
    for name, _kind in ACTIONS:
        spark.rows(f"ALTER TABLE {RESULT_TABLE} DROP COLUMN {name}")
    _stage(spark, 2, [("a", "Act now"), ("b", "Act now")])
    printed = _run(agent_ns, spark)
    assert any(p.startswith("Actions: added action_owner, action_status, action_due") for p in printed)
    now = _current(spark)
    assert {k: (r["run_id"], r["action_status"]) for k, r in now.items()} == {"a": ("r-2", None), "b": ("r-2", None)}


def test_the_job_parameters_say_who_asked_for_a_run_with_schedule_as_the_default(agent_ns):
    spec = _spec(agent_ns)[0]
    for profile in ("full", "preview"):
        params = agent_ns["implement_job_parameters"](["result_table", "run_profile"], spec, profile)
        assert params["refresh_requested_by"] == "schedule" and params["run_profile"] == profile
    asked = dict(spec, config=dict(spec["config"], widgets={"refresh_requested_by": "someone@example.com"}))
    assert agent_ns["implement_job_parameters"](["refresh_requested_by"], asked, "full")["refresh_requested_by"] == "schedule", \
        "only the App's Refresh now names a person, at run time"


def test_the_preview_job_keeps_one_run_at_a_time_its_queue_and_the_refresh_default(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_update = lambda key, **f: None
    seen = {}

    class Launcher(agent_ns["JobLauncher"]):
        def launch(self, **kwargs):
            seen.update(kwargs, base=dict(self.widget_key_values))
            return {"success": True, "job_id": 77, "run_id": 5, "job_url": "u"}

        def wait_for_run(self, run_id, timeout_s=0, poll_s=0, out=None):
            return {"status": "FAILED", "error": "stopped for the test"}

    inst._job_launcher_cls = Launcher
    inst._implement_preview("N01-U01", (5150, "N01-U01", 1), CHURN_UC, _spec(agent_ns)[0],
                            {"job_tags": {}, "job_slug": "churn", "schedule_cron": None}, "/W/nb", ["result_table", "run_profile"])
    assert seen["max_concurrent_runs"] == 1 and seen["queue"] is True
    assert seen["base"]["refresh_requested_by"] == "schedule" and seen["run_parameters"]["refresh_requested_by"] == "build", \
        "the job keeps the schedule default and the preview run says the build asked for it"


def test_a_run_started_from_the_notebook_keeps_the_refresh_default_on_the_job(agent_ns):
    from v120_genie_support import build_inspire, make_uc
    inst = build_inspire(agent_ns)
    uc = make_uc()
    spec = inst._genie_notebook_spec(uc)
    source = inst._genie_run_controls_source(uc, spec, str(uc.get("genie_instruction") or ""))
    assert "'scheduled_overrides': {'as_of_date': 'latest', 'refresh_requested_by': 'schedule'}" in source


def test_app_settings_name_this_page_s_job_and_the_admin(agent_ns):
    settings = agent_ns["implement_app_settings"]
    built = settings(1, "N01-U01 Predict churn", ["n01_u01"], None, "off", "t", {"app_access": "sp"}, jobs={"n01_u01": 77},
                     admin="  builder@example.com ")
    assert built["jobs"] == {"n01_u01": "77"} and built["admin"] == "builder@example.com"
    for job_id in (None, "", "abc", True, -5, "7 7", 1.5):
        assert settings(1, "t", ["n01_u01"], None, "off", "t", {"app_access": "sp"}, jobs={"n01_u01": job_id})["jobs"] == {}, job_id
    other = settings(1, "t", ["n01_u01"], None, "off", "t", {"app_access": "sp"}, jobs={"n01_u09": "12"})
    assert other["jobs"] == {}, "a job is named only for a page the App holds"
    assert settings(1, "t", ["n01_u01"], None, "off", "t", {"app_access": "sp"})["jobs"] == {}
    once = settings(1, "t", (p for p in ["n01_u01"]), None, "off", "t", {"app_access": "sp"}, jobs={"n01_u01": "77"})
    assert (once["pages"], once["jobs"]) == (["n01_u01"], {"n01_u01": "77"}), "page ids given once still name the job"


def _held(ns, **changes):
    base = ns["implement_app_settings"](1, "N01-U07 Sales desk", ["n01_u07"], {"space_id": "gA", "title": "Sales"}, "", "t0",
                                        {"app_access": "sp"})
    held = dict(base, options={"download": True, "modify": True, "replace_edits": False, "decisions": False},
                jobs={"n01_u07": "555", "gone_page": "9"}, admin="owner@example.com")
    held.update(changes)
    return ns["implement_app_held_settings"](held)


def _host(ns, held, merged=True, pages=None):
    host = ns["implement_app_host"]("sales-desk")
    host.update(merged=merged, owner=("N01-U07", "777"), settings=held, pages=pages or [{"id": "n01_u07", "use_case_id": "N01-U07"}])
    return host


def test_a_merged_app_keeps_the_held_jobs_and_admin_adds_this_page_s_job_and_drops_downloads(agent_ns):
    ours = agent_ns["implement_app_settings"](1, "N01-U01 Predict churn", ["n01_u01"], None, "off", "t1", {"app_access": "sp"},
                                              jobs={"n01_u01": "77"}, admin="builder@example.com")
    merged, pages, page = agent_ns["implement_app_merge"](_host(agent_ns, _held(agent_ns)), ours, {"id": "n01_u01", "use_case_id": "N01-U01"},
                                                         5150, {})
    assert page["id"] == "n01_u01_s5150" and [p["id"] for p in pages] == ["n01_u07", "n01_u01_s5150"]
    assert merged["jobs"] == {"n01_u07": "555", "n01_u01_s5150": "77"}, "the held page keeps its job and this page adds its own"
    assert merged["admin"] == "owner@example.com", "a merged App keeps its admin"
    assert merged["options"] == {"modify": True, "replace_edits": False, "decisions": False}, "downloads are dropped"
    unnamed, _pages, _page = agent_ns["implement_app_merge"](_host(agent_ns, _held(agent_ns, admin="")), ours,
                                                            {"id": "n01_u01", "use_case_id": "N01-U01"}, 5150, {})
    assert unnamed["admin"] == "builder@example.com", "an App that named no admin gets the person who builds it"


def test_a_merged_app_is_checked_as_inspire_will_write_it(agent_ns, tmp_path, monkeypatch):
    files = _host_files(agent_ns, tmp_path, options={"download": True, "modify": False, "replace_edits": False, "decisions": False},
                        jobs={"n01_u07": "555", "gone_page": "9", "bad": "x1"}, admin="")
    inst, context, _seen, _calls = _merge_flow(agent_ns, tmp_path, monkeypatch, files=files)
    inst.spark = FakeSpark(responder=lambda s: [{"me": "builder@example.com"}] if s == ME else [])
    checked = []
    core = types.SimpleNamespace(SETTINGS_FILE="inspire_app.json", PAGES_DIR="pages", SETTINGS_VERSION=7,
                                 settings_problems=lambda settings, pages: checked.append(settings) or [])
    host = inst._implement_app_host(context, core)
    assert host["merged"] is True and len(checked) == 1
    assert checked[0]["options"] == {"modify": False, "replace_edits": False, "decisions": False}
    assert (checked[0]["jobs"], checked[0]["admin"], checked[0]["version"]) == ({"n01_u07": "555"}, "builder@example.com", 7)
    assert "download" not in host["settings"]["options"], "the host's settings are read without the option the App no longer offers"


def test_rebuilding_an_app_this_use_case_owns_keeps_the_jobs_of_the_pages_merged_into_it(agent_ns):
    ours = agent_ns["implement_app_settings"](1, "N01-U01 Predict churn", ["n01_u01"], None, "off", "t1", {"app_access": "sp"},
                                              jobs={"n01_u01": "88"}, admin="builder@example.com")
    held = _held(agent_ns, jobs={"n01_u01": "77", "n01_u02": "66"}, pages=["n01_u01", "n01_u02"])
    host = _host(agent_ns, held, merged=False, pages=[{"id": "n01_u01"}, {"id": "n01_u02"}])
    settings, _pages, _page = agent_ns["implement_app_merge"](host, ours, {"id": "n01_u01", "use_case_id": "N01-U01"}, 5150, {})
    assert settings["jobs"] == {"n01_u01": "88", "n01_u02": "66"} and settings["admin"] == "builder@example.com"
    assert "download" not in settings["options"]
    fresh, _pages, _page = agent_ns["implement_app_merge"](agent_ns["implement_app_host"]("churn-desk"), ours,
                                                          {"id": "n01_u01", "use_case_id": "N01-U01"}, 5150, {})
    assert fresh["jobs"] == {"n01_u01": "88"}


def test_the_built_app_settings_carry_the_job_and_the_builder(agent_ns, tmp_path):
    inst, context, seen = _app_flow(agent_ns, tmp_path)
    inst.spark = FakeSpark(responder=lambda s: [{"me": "builder@example.com"}] if s == ME else [])
    inst._implement_app(context, None)
    assert seen["errors"] == []
    settings = json.loads(seen["deployed"][0][1]["inspire_app.json"])
    assert settings["jobs"] == {"n01_u01": "77"} and settings["admin"] == "builder@example.com"
    assert context["app_jobs"] == {"n01_u01": "77"}, "the deploy step gives the App a resource for this job"


def test_a_per_user_app_built_without_an_admin_still_lets_the_owners_of_its_use_case_refresh_it(agent_ns, tmp_path):
    assert "implement_app_admin_warnings" not in agent_ns
    inst, context, seen = _app_flow(agent_ns, tmp_path / "user", outputs={"app_access": "user", "app_owners": ["lee@example.com"]})
    fields = inst._implement_app(context, None)
    settings = json.loads(seen["deployed"][0][1]["inspire_app.json"])
    assert seen["errors"] == [] and settings["admin"] == "" and settings["use_case_owners"] == {"n01_u01": ["lee@example.com"]}
    assert not any("Refresh" in w for w in fields.get("_warnings") or []), "Refresh is for the owners of the use case, not the builder"


def test_a_look_only_edit_keeps_the_held_admin_when_the_builder_cannot_be_read(agent_ns, tmp_path, monkeypatch):
    own = _host_page(agent_ns, "N01-U01", "Churn desk")
    files = _host_files(agent_ns, tmp_path, source=OWN_SOURCE, pages=[own], title="N01-U01 Predict churn", genie="g1",
                        options={"modify": False, "replace_edits": False, "decisions": False}, jobs={}, admin="owner@example.com")
    inst = _restyle_inspire(agent_ns, tmp_path, monkeypatch, files)
    inst._implement_builder_name = ""
    previous = json.loads(json.dumps(VALID))
    inst._implement_previous = lambda t: {"spec_version": 2, "spec_json": previous}
    current = dict(previous, outputs={**previous["outputs"], "app_look": {"palette": "ocean"}})
    assert inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": current},
                                      (5150, "N01-U01", 3)) == "ready"
    assert json.loads(inst.deployed[0][1]["inspire_app.json"])["admin"] == "owner@example.com"


def test_an_app_built_from_the_inspire_app_names_the_person_who_asked_for_it_not_the_identity_inspire_runs_as(agent_ns, tmp_path,
                                                                                                             monkeypatch):
    own = _host_page(agent_ns, "N01-U01", "Churn desk")
    files = _host_files(agent_ns, tmp_path / "restyle", source=OWN_SOURCE, pages=[own], title="N01-U01 Predict churn", genie="g1",
                        options={"modify": False, "replace_edits": False, "decisions": False}, jobs={}, admin="owner@example.com")
    inst = _restyle_inspire(agent_ns, tmp_path / "restyle", monkeypatch, files)
    inst._implement_builder_name = "sp-app-id"
    grants = []
    inst.w_client.workspace.get_status = lambda path: types.SimpleNamespace(path=path, object_id=42)
    inst._implement_grant = lambda kind, object_id, principals, level: grants.append((kind, object_id, principals, level))
    previous = json.loads(json.dumps(VALID))
    inst._implement_previous = lambda t: {"spec_version": 2, "spec_json": previous}
    current = dict(previous, outputs={**previous["outputs"], "app_look": {"palette": "ocean"}})
    target = {"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": current, "created_by": " person@example.com "}
    assert inst._implement_one_locked(target, (5150, "N01-U01", 3)) == "ready"
    assert json.loads(inst.deployed[0][1]["inspire_app.json"])["admin"] == "person@example.com"
    assert grants == [("directories", 42, [{"type": "user", "name": "person@example.com"}], "CAN_MANAGE")], \
        "the person who asked, not the identity Inspire runs as, can manage the MVP folder"
    for asked, admin in (("person@example.com", "person@example.com"), ("", "sp-app-id"), (None, "sp-app-id")):
        inst, context, seen = _app_flow(agent_ns, tmp_path / f"build_{admin}_{asked}", outputs={"app_access": "user"})
        inst.spark = FakeSpark(responder=lambda s: [{"me": "sp-app-id"}] if s == ME else [])
        context["requested_by"] = asked
        fields = inst._implement_app(context, None)
        assert seen["errors"] == [] and json.loads(seen["deployed"][0][1]["inspire_app.json"])["admin"] == admin, asked
        assert not any("Refresh now" in w for w in fields.get("_warnings") or [])
    files = _host_files(agent_ns, tmp_path / "merge", options={"modify": False, "replace_edits": False, "decisions": False}, jobs={}, admin="")
    inst, context, _seen, _calls = _merge_flow(agent_ns, tmp_path / "merge", monkeypatch, files=files)
    inst.spark = FakeSpark(responder=lambda s: [{"me": "sp-app-id"}] if s == ME else [])
    context["requested_by"] = "person@example.com"
    checked = []
    core = types.SimpleNamespace(SETTINGS_FILE="inspire_app.json", PAGES_DIR="pages", SETTINGS_VERSION=7,
                                 settings_problems=lambda settings, pages: checked.append(settings) or [])
    assert inst._implement_app_host(context, core)["merged"] is True and checked[0]["admin"] == "person@example.com"
    merge = agent_ns["implement_app_merge"]
    for held, ours, admin in (("sp-app-id", "person@example.com", "person@example.com"), ("owner@example.com", "person@example.com", "owner@example.com"),
                              ("sp-app-id", "sp-app-id", "sp-app-id"), ("", "person@example.com", "person@example.com")):
        built = agent_ns["implement_app_settings"](1, "N01-U01 Predict churn", ["n01_u01"], None, "off", "t1", {"app_access": "sp"},
                                                   jobs={"n01_u01": "77"}, admin=ours)
        merged, _pages, _page = merge(_host(agent_ns, _held(agent_ns, admin=held)), built, {"id": "n01_u01", "use_case_id": "N01-U01"},
                                      5150, {}, " sp-app-id ")
        assert merged["admin"] == admin, (held, ours)


def test_the_builder_is_the_identity_inspire_runs_as_and_an_unreadable_one_names_no_admin(agent_ns):
    inst = _inspire(agent_ns, FakeSpark(responder=lambda s: [{"me": " builder@example.com "}] if s == ME else []))
    assert inst._implement_builder() == "builder@example.com" and inst._implement_builder() == "builder@example.com"
    assert inst.spark.statements.count(ME) == 1, "the identity is read once"
    broken = _inspire(agent_ns, FakeSpark(responder=lambda s: (_ for _ in ()).throw(RuntimeError("INTERNAL_ERROR: no session"))))
    broken.logger = CapturingLogger()
    assert broken._implement_builder() == ""
    assert any("could not be read, so the App names no admin" in m for _lvl, m in broken.logger.records)


def test_the_resources_keep_every_held_one_and_add_each_page_s_job(agent_ns):
    resources = agent_ns["implement_app_resources"]
    other = {"name": "job-n01-u07", "job": {"id": "555", "permission": "CAN_MANAGE_RUN"}}
    assert resources([WAREHOUSE], {"n01_u01": "77"}) == [WAREHOUSE, OWN_JOB]
    assert resources([WAREHOUSE, other], {"n01_u01": "77", "n01_u07": "555"}) == [WAREHOUSE, other, OWN_JOB]
    stale = {"name": "job-n01-u01", "job": {"id": "70", "permission": "CAN_VIEW"}}
    assert resources([WAREHOUSE, stale, other], {"n01_u01": "77"}) == [WAREHOUSE, OWN_JOB, other], "this page's resource is updated"
    held = dict(OWN_JOB, description="set by hand")
    assert resources([held], {"n01_u01": "77"}) == [held], "a resource that already grants the run is left as it is"
    assert agent_ns["implement_app_missing_jobs"]([WAREHOUSE, other], {"n01_u01": "77", "n01_u07": "555"}) == ["77"]
    assert agent_ns["implement_app_missing_jobs"]([WAREHOUSE, OWN_JOB], {"n01_u01": "77"}) == []
    assert agent_ns["implement_app_job_resource"]("p_9x_y", "5") == {"name": "job-p-9x-y", "job": {"id": "5", "permission": "CAN_MANAGE_RUN"}}


def test_a_page_another_session_adds_to_a_hub_gets_a_job_resource_name_of_at_most_30_characters(agent_ns):
    page_id, resource = agent_ns["implement_app_page_id"], agent_ns["implement_app_job_resource"]
    mine, theirs = page_id("N01-U01_s" + "7" * 19), page_id("N01-U01_s" + "7" * 18 + "8")
    assert len(f"job-{mine}") > 30, "the page id alone is longer than an App resource name may be"
    names = [resource(p, "5")["name"] for p in (mine, theirs)]
    assert all(2 <= len(n) <= 30 and n.startswith("job-n01-u01-s") for n in names), names
    assert names[0] != names[1], "the pages of two sessions never share a resource"
    assert resource(mine, "5") == resource(mine, "5")
    jobs = {"n01_u01": "77", mine: "88"}
    held = agent_ns["implement_app_resources"]([WAREHOUSE, OWN_JOB], jobs)
    assert [r["name"] for r in held][:2] == [WAREHOUSE["name"], OWN_JOB["name"]], "the short names stay as they are"
    assert all(len(r["name"]) <= 30 for r in held)
    assert agent_ns["implement_app_missing_jobs"](held, jobs) == []


def _deploy(ns, answers, jobs=None, **context_changes):
    inst, context, calls, imported = _deploy_inspire(ns, answers)
    context.update(app_jobs={"n01_u01": "77"} if jobs is None else jobs, **context_changes)
    return inst, context, calls


DEPLOYED = [{"deployment_id": "dep1", "status": {"state": "SUCCEEDED"}}, {"url": "https://churn-desk.example/"}]


def test_a_new_app_is_created_with_a_resource_to_run_this_use_case_s_job(agent_ns, sdk_stub):
    inst, context, calls = _deploy(agent_ns, [RuntimeError("RESOURCE_DOES_NOT_EXIST: app churn-desk"),
                                              {"compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-1",
                                               "resources": [WAREHOUSE, OWN_JOB]}] + DEPLOYED)
    fields = inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert "_warnings" not in fields
    assert calls[1][:2] == ("POST", "/api/2.0/apps") and calls[1][2]["resources"] == [WAREHOUSE, OWN_JOB]
    assert not any(c[0] == "PATCH" for c in calls), "the created App already holds the job resource"


def test_an_existing_app_gets_this_job_s_resource_and_keeps_every_other_one(agent_ns, sdk_stub):
    other = {"name": "serving", "serving_endpoint": {"name": "ep", "permission": "CAN_QUERY"}}
    app = {"description": OURS_APP, "compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-2",
           "resources": [WAREHOUSE, other]}
    inst, context, calls = _deploy(agent_ns, [app, dict(app, resources=[WAREHOUSE, other, OWN_JOB])] + DEPLOYED)
    fields = inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert "_warnings" not in fields
    patch = [c for c in calls if c[0] == "PATCH"]
    assert patch == [("PATCH", "/api/2.0/apps/churn-desk", {"name": "churn-desk", "description": OURS_APP,
                                                             "resources": [WAREHOUSE, other, OWN_JOB], "user_api_scopes": []})]
    held = dict(app, resources=[WAREHOUSE, OWN_JOB])
    again, context, calls = _deploy(agent_ns, [held] + DEPLOYED)
    again._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert not any(c[0] == "PATCH" for c in calls), "an App that holds the resource is not changed"
    none, context, calls = _deploy(agent_ns, [held] + DEPLOYED, jobs={})
    none._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert not any(c[0] == "PATCH" for c in calls)


def test_a_merged_app_keeps_another_page_s_job_and_adds_this_page_s(agent_ns, sdk_stub):
    host_job = {"name": "job-n01-u07", "job": {"id": "555", "permission": "CAN_MANAGE_RUN"}}
    ours = {"name": "job-n01-u01-s5150", "job": {"id": "77", "permission": "CAN_MANAGE_RUN"}}
    app = {"description": "Inspire use case N01-U07 (session 777): Sales desk", "compute_status": {"state": "ACTIVE"},
           "service_principal_client_id": "sp-7", "resources": [WAREHOUSE, host_job]}
    inst, context, calls = _deploy(agent_ns, [app, dict(app, resources=[WAREHOUSE, host_job, ours])] + DEPLOYED,
                                   jobs={"n01_u07": "555", "n01_u01_s5150": "77"},
                                   app_host={"merged": True, "settings": {"auth": "sp", "options": {}}, "source": "/W/sales"})
    inst._implement_deploy_app(context, "sales-desk", SHELL_FILES, READS, poll_s=0)
    [patch] = [c for c in calls if c[0] == "PATCH"]
    assert patch[2]["resources"] == [WAREHOUSE, host_job, ours]


def test_a_job_resource_the_app_cannot_get_is_a_warning_and_the_app_still_deploys(agent_ns, sdk_stub):
    app = {"description": OURS_APP, "compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-2", "resources": [WAREHOUSE]}
    inst, context, calls = _deploy(agent_ns, [app, RuntimeError("PERMISSION_DENIED: no CAN MANAGE on job 77")] + DEPLOYED)
    fields = inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert fields["app_url"] == "https://churn-desk.example"
    assert fields["_warnings"] == ["App: Refresh now cannot start a run of job 77, because Inspire could not give the App's service "
                                   "principal CAN MANAGE RUN on it: PERMISSION_DENIED: no CAN MANAGE on job 77. Give it CAN MANAGE RUN on "
                                   "the job, or build the App again with Vibe/Add/Remove Features on the Build page"]


def test_a_failed_build_gives_the_app_back_the_resources_it_held(agent_ns, sdk_stub):
    app = {"description": OURS_APP, "compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-2",
           "active_deployment": {"deployment_id": "dep0"}, "resources": [WAREHOUSE]}
    grown = dict(app, resources=[WAREHOUSE, OWN_JOB])
    answers = [app, grown, {"deployment_id": "dep1", "status": {"state": "FAILED", "message": "boom"}}] + [{}] * len(SHELL_FILES)
    inst, context, calls = _deploy(agent_ns, answers + [grown, app])
    inst.logger = CapturingLogger()
    with pytest.raises(RuntimeError, match="FAILED: boom"):
        inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    patches = [c[2]["resources"] for c in calls if c[0] == "PATCH"]
    assert patches == [[WAREHOUSE, OWN_JOB], [WAREHOUSE]], "the job resource this build added is taken off again"
    assert any("gave the App churn-desk back the resources it held before" in m for _lvl, m in inst.logger.records)


def test_a_look_only_edit_keeps_the_jobs_names_the_builder_and_drops_downloads(agent_ns, tmp_path, monkeypatch):
    own = _host_page(agent_ns, "N01-U01", "Churn desk")
    merged = _host_page(agent_ns, "N01-U02", "Stock desk")
    files = _host_files(agent_ns, tmp_path, source=OWN_SOURCE, pages=[own, merged], title="N01-U01 Predict churn", genie="g1",
                        options={"download": True, "modify": False, "replace_edits": False, "decisions": False},
                        jobs={"n01_u02": "66"}, admin="")
    inst = _restyle_inspire(agent_ns, tmp_path, monkeypatch, files)
    inst.spark = FakeSpark(responder=lambda s: [{"me": "builder@example.com"}] if s == ME else [])
    previous = json.loads(json.dumps(VALID))
    inst._implement_previous = lambda t: {"spec_version": 2, "spec_json": previous}
    current = dict(previous, outputs={**previous["outputs"], "app_look": {"palette": "ocean"}})
    assert inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": current},
                                      (5150, "N01-U01", 3)) == "ready"
    settings = json.loads(inst.deployed[0][1]["inspire_app.json"])
    assert settings["options"] == {"modify": False, "replace_edits": False, "decisions": False}
    assert settings["jobs"] == {"n01_u01": "77", "n01_u02": "66"} and settings["admin"] == "builder@example.com"


@pytest.mark.parametrize("options", [{"download": True}, {"download": False}, {"modify": True, "download": False}])
def test_a_spec_that_names_a_data_download_is_refused(agent_ns, options):
    errors = _spec(agent_ns, outputs={**VALID["outputs"], "app_options": options})[1]
    assert "the App has no option 'download'; its options are modify, replace_edits, decisions, alerts" in errors
    assert agent_ns["IMPLEMENT_APP_OPTIONS"] == {"modify": False, "replace_edits": False, "decisions": False, "alerts": False}
    assert agent_ns["IMPLEMENT_APP_USER_OFF"] == ("decisions", "alerts")
    with pytest.raises(agent_ns["ImplementBlocked"], match="the App has no option 'download'"):
        agent_ns["implement_app_settings"](1, "t", ["n01_u01"], None, "off", "t", {"app_access": "sp", "app_options": options})


def test_no_app_prompt_or_message_offers_a_data_download(agent_ns, tmp_path):
    inst, context, seen = _app_flow(agent_ns, tmp_path)
    inst._implement_app(context, None)
    assert "download" not in seen["prompt"].lower() and "export" not in seen["prompt"].lower()
    assert "download" not in json.dumps(agent_ns["IMPLEMENT_APP_OPTIONS"])
    assert agent_ns["implement_app_held_settings"]({"options": {"download": True, "modify": True}}) == {"options": {"modify": True}}


def _charts(n):
    return [dict(c, id=f"c{i}") for i, c in enumerate((PAGE["charts"] * 3)[:n])]


@pytest.mark.parametrize("count,fewer,problem", [
    (2, None, "the page has 2 charts; it needs 3 to 8"),
    (0, None, "the page has 0 charts; it needs 3 to 8"),
    (2, "  ", "the page has 2 charts; it needs 3 to 8"),
    (2, 7, "the page has 2 charts; it needs 3 to 8"),
    (0, "only the decision list", "the page has 0 charts; it needs 1 to 8"),
    (9, "fewer charts", "the page has 9 charts; it needs 1 to 8"),
    (3, None, ""),
    (1, "just one chart please", ""),
])
def test_a_page_needs_three_charts_unless_it_quotes_vibes_that_ask_for_fewer(count, fewer, problem):
    page = dict(json.loads(json.dumps(PAGE)), charts=_charts(count), tables=[])
    if fewer is not None:
        page["fewer_charts"] = fewer
    found = [p for p in shell_sql.spec_problems(page) if "charts;" in p]
    assert found == ([problem] if problem else [])
    assert shell_sql.CAPS["charts"] == (3, 8)


def test_the_example_page_has_at_least_three_charts_and_passes():
    example = json.load(open(shell_sql.__file__.rsplit("/server/", 1)[0] + "/example_page.json"))
    assert len(example["charts"]) >= 3 and "fewer_charts" not in example
    assert shell_sql.spec_problems(example) == []


@pytest.mark.parametrize("quote,vibes,needle", [
    ("JUST ONE   chart", "Keep it simple: just one chart, then the list.", ""),
    ("", "Keep it simple", ""),
    (None, "", ""),
    ("only one chart", "Keep it simple: just one chart, then the list.", "which is not in the customer's asks for this App word for word"),
    ("one chart", "", "but the customer gave no asks for this App"),
    (["one chart"], "one chart", "fewer_charts must be text"),
])
def test_a_fewer_charts_quote_must_be_word_for_word_in_the_vibes(agent_ns, quote, vibes, needle):
    page = {} if quote is None else {"fewer_charts": quote}
    problems = agent_ns["implement_fewer_charts_problems"](page, vibes, "App", 3)
    assert (problems == []) if not needle else (len(problems) == 1 and needle in problems[0]), problems


def _small_page(ns, **changes):
    page = _churn_page(ns, **changes)
    page["charts"] = page["charts"][:2]
    return page


def test_the_pre_deploy_check_sends_a_page_with_too_few_charts_back_to_genie(agent_ns, tmp_path):
    inst, context, seen = _app_flow(agent_ns, tmp_path, page=_small_page(agent_ns))
    inst._implement_app(context, None)
    assert seen["deployed"] == [] and len(seen["errors"]) == 1
    assert "the page has 2 charts; it needs 3 to 8" in seen["errors"][0]
    vibed = {"app_vibes": "Keep it simple: two charts are enough."}
    inst, context, seen = _app_flow(agent_ns, tmp_path / "bad", page=_small_page(agent_ns, fewer_charts="three charts are enough"),
                                    outputs=vibed)
    inst._implement_app(context, None)
    assert seen["deployed"] == [] and "which is not in the customer's asks for this App word for word" in seen["errors"][0]
    inst, context, seen = _app_flow(agent_ns, tmp_path / "good", page=_small_page(agent_ns, fewer_charts="two  CHARTS are enough"),
                                    outputs=vibed)
    inst._implement_app(context, None)
    assert seen["errors"] == [] and len(seen["deployed"]) == 1


def test_the_app_prompt_asks_for_three_different_charts_and_aggregates_in_sql(agent_ns, tmp_path):
    inst, context, seen = _app_flow(agent_ns, tmp_path)
    inst._implement_app(context, None)
    prompt = seen["prompt"]
    assert "- charts: 3 to 8 of type" in prompt
    assert "each chart compares something the others do not, such as another measure, another split or another time grain" in prompt
    assert ("Only when the customer's asks for this App ask for fewer than 3 charts, write fewer and set the top-level field "
            "fewer_charts to the words of those asks that say so, word for word; otherwise leave fewer_charts out.") in prompt
    assert ("The App pages through the decision list with SQL, one page of rows at a time, so the records dataset never limits its "
            "rows itself. Every KPI and every chart aggregates in SQL on the warehouse, with an aggregate expression over its dataset, "
            "so no chart selects or plots the raw rows of a table.") in prompt


FILTERED = {"filters": [{"id": "run_date", "type": "date_range", "columns": {"records": "as_of_date"}},
                        {"id": "region", "type": "multi_select", "columns": {"records": "Region", "trend": "store_region"}},
                        {"id": "reasons", "type": "multi_select", "columns": {"records": "top_reasons"}},
                        {"id": "segment", "type": "multi_select", "columns": {"records": "segment_or_item"}},
                        {"id": "channel", "type": "multi_select", "columns": {"records": "channel"}},
                        {"id": "size", "type": "multi_select", "columns": {"records": "basket_size"}}]}
CLUSTER_SCHEMA = CORE + HISTORY + [("region", "string"), ("channel", "string"), ("basket_size", "decimal(10,2)"), ("tags", "map<string,string>")]


def test_the_cluster_columns_are_the_filters_in_the_result_table_and_the_run_date_at_most_four(agent_ns):
    columns = agent_ns["implement_cluster_columns"]
    assert columns(FILTERED, CLUSTER_SCHEMA) == ["as_of_date", "region", "segment_or_item", "channel"], \
        "Delta clusters only on a column it keeps statistics on, which is_current, a BOOLEAN, never is"
    assert columns({"filters": FILTERED["filters"][:3]}, CLUSTER_SCHEMA) == ["as_of_date", "region"], \
        "a filter column the result table does not hold, or an array, is not a clustering key"
    assert columns({"filters": [{"id": "s", "columns": {"records": "basket_size"}}]}, CLUSTER_SCHEMA) == ["as_of_date", "basket_size"]
    assert columns({"filters": [{"id": "t", "columns": {"records": "tags"}}]}, CLUSTER_SCHEMA) == ["as_of_date"]
    assert columns({"filters": [{"id": "c", "columns": {"records": "is_current"}}]}, CLUSTER_SCHEMA) == ["as_of_date"]
    assert columns({}, CORE) == ["as_of_date"], "a table without its change history clusters on the run date alone"
    assert columns(FILTERED, None) == [] and columns({}, [("entity_id", "string")]) == []
    assert agent_ns["implement_cluster_sql"](TABLE, ["as_of_date", "region"]) == f"ALTER TABLE {QUOTED} CLUSTER BY (`as_of_date`, `region`)"
    assert agent_ns["implement_recluster_sql"](TABLE) == f"OPTIMIZE {QUOTED} FULL"


def test_a_table_with_money_at_stake_clusters_on_it_alone_so_the_first_records_read_one_file(agent_ns):
    columns = agent_ns["implement_cluster_columns"]
    staked = CLUSTER_SCHEMA + [("Value_At_Stake", "double")]
    assert columns(FILTERED, staked) == ["Value_At_Stake"], \
        "the list opens on the largest money at stake, and each extra key spreads those records over more files"
    assert columns(FILTERED, CLUSTER_SCHEMA + [("value_at_stake", "array<double>")]) == ["as_of_date", "region", "segment_or_item", "channel"], \
        "a stake Delta keeps no statistics on is no clustering key"


def _cluster_inspire(ns, detail, fail=None):
    def respond(statement):
        if fail and statement.startswith(fail):
            raise RuntimeError("PERMISSION_DENIED: not the owner of churn_out")
        if statement == f"DESCRIBE TABLE {QUOTED}":
            return _describe(CLUSTER_SCHEMA)
        if statement == f"DESCRIBE DETAIL {QUOTED}":
            return [detail]
        return []

    return _inspire(ns, FakeSpark(responder=respond))


CLUSTER_ALTER = f"ALTER TABLE {QUOTED} CLUSTER BY (`as_of_date`, `region`, `segment_or_item`, `channel`)"
CLUSTER_FAILED = ("App: Inspire could not cluster main.inspire.churn_out on as_of_date, region, segment_or_item, channel, so the App's "
                  f"queries may be slow on a large table: PERMISSION_DENIED: not the owner of churn_out. Run {CLUSTER_ALTER} to cluster it")


@pytest.mark.parametrize("detail,fail,altered,warning,note", [
    ({"clusteringColumns": [], "partitionColumns": []}, None, True, "", ""),
    ({"clusteringColumns": ["AS_OF_DATE", "region", "segment_or_item", "Channel"], "partitionColumns": []}, None, False, "", ""),
    ({"clusteringColumns": ["as_of_date", "region", "segment_or_item", "is_current"], "partitionColumns": []}, None, True, "", ""),
    ({"clusteringColumns": ["Channel", "AS_OF_DATE", "segment_or_item", "region"], "partitionColumns": []}, None, True, "", ""),
    ({"clusteringColumns": ["as_of_date"], "partitionColumns": []}, None, True, "", ""),
    ({"clusteringColumns": [], "partitionColumns": ["as_of_date"]}, None, False, "",
     "App: main.inspire.churn_out is partitioned by as_of_date, so Inspire did not cluster it on as_of_date, region, segment_or_item, "
     "channel for the App's filters; the App's queries may be slow on a large table"),
    ({"clusteringColumns": [], "partitionColumns": []}, "ALTER TABLE", True, CLUSTER_FAILED, ""),
    ({"clusteringColumns": [], "partitionColumns": []}, "DESCRIBE DETAIL", False, CLUSTER_FAILED, ""),
])
def test_the_result_table_is_clustered_for_the_app_unless_it_already_is_and_a_failure_only_warns(agent_ns, detail, fail, altered, warning,
                                                                                                   note):
    inst = _cluster_inspire(agent_ns, detail, fail)
    context = _output_context(agent_ns)
    assert inst._implement_cluster_result(context, FILTERED) == (([warning] if warning else []), ([note] if note else []))
    assert (CLUSTER_ALTER in inst.spark.statements) is altered
    recluster = f"OPTIMIZE {QUOTED} FULL"
    assert (recluster in inst.spark.statements) is (altered and fail is None), \
        "new clustering columns only order the files written from now on, so the build rewrites the versions already there once"
    if altered and fail is None:
        assert inst.spark.statements.index(recluster) == inst.spark.statements.index(CLUSTER_ALTER) + 1


def test_an_app_build_clusters_the_table_after_it_deploys_and_never_blocks_on_it(agent_ns, tmp_path):
    inst, context, seen = _app_flow(agent_ns, tmp_path)
    inst.spark = _cluster_inspire(agent_ns, {"clusteringColumns": [], "partitionColumns": []}, "ALTER TABLE").spark
    fields = inst._implement_app(context, None)
    assert len(seen["deployed"]) == 1 and fields["app_name"] == "churn-desk"
    assert any(w.startswith("App: Inspire could not cluster main.inspire.churn_out on as_of_date") for w in fields["_warnings"])
    clustered = [s for s in inst.spark.statements if "CLUSTER BY" in s]
    assert len(clustered) == 1 and clustered[0].startswith(f"ALTER TABLE {QUOTED} CLUSTER BY (`as_of_date`")


PADDING = [(f"pad_{n}", "double") for n in range(max(0, 33 - len(CORE + HISTORY)))]
WIDE_SCHEMA = CORE + HISTORY + PADDING + [("region", "string"), ("channel", "string"), ("basket_size", "decimal(10,2)")]
UNSKIPPED = ("array", "map", "boolean", "binary")
WIDE_FIRST_32 = [name for name, kind in WIDE_SCHEMA[:32] if not kind.startswith(UNSKIPPED)]


def test_a_column_counts_its_leaves_toward_the_columns_delta_keeps_statistics_on(agent_ns):
    leaves = agent_ns["implement_type_leaves"]
    for kind, n in [("string", 1), ("decimal(10,2)", 1), ("", 1), (None, 1), ("struct<a:int,b:decimal(10,2)>", 2),
                    ("struct<a: struct<x: int, y: int>, b: string>", 3), ("array<struct<a:int,b:int>>", 1), ("map<string,string>", 1),
                    ("struct<>", 1)]:
        assert leaves(kind) == n, kind


def test_the_columns_with_statistics_follow_the_table_properties_and_the_first_32_leaves_by_default(agent_ns):
    stats = agent_ns["implement_stats_columns"]
    names = [name for name, _kind in WIDE_SCHEMA]
    assert len(WIDE_SCHEMA) > 33 and names.index("region") >= 32, "the fixture puts the App's filter columns past the first 32"
    for properties in (None, {}, "not a map", {"delta.dataSkippingNumIndexedCols": "x"}):
        assert stats(WIDE_SCHEMA, properties) == WIDE_FIRST_32
    assert stats(WIDE_SCHEMA, {"delta.dataSkippingNumIndexedCols": "5"}) == names[:5]
    assert stats(WIDE_SCHEMA, {"delta.dataSkippingNumIndexedCols": "-1"}) == [n for n, k in WIDE_SCHEMA if not k.startswith(UNSKIPPED)]
    assert "top_reasons" not in WIDE_FIRST_32 and "is_current" not in WIDE_FIRST_32, \
        "Delta refuses a statistics list that names an array, a map, a BOOLEAN or a BINARY column"
    assert stats(WIDE_SCHEMA, {"delta.dataSkippingNumIndexedCols": "0"}) == []
    listed = {"delta.dataSkippingStatsColumns": " `Region` , as_of_date,channel.inner ", "delta.dataSkippingNumIndexedCols": "5"}
    assert stats(WIDE_SCHEMA, listed) == ["as_of_date", "region", "channel"], "a listed set wins over the count, in schema order"
    nested = [("s", "struct<a:int,b:int,c:int>")] + [(f"c{n}", "int") for n in range(31)]
    assert stats(nested, {}) == ["s"] + [f"c{n}" for n in range(29)], "a struct's leaves count toward the 32"
    assert stats(None, {}) == []
    assert agent_ns["implement_stats_columns_sql"](TABLE, ["as_of_date", "region"]) == \
        f"ALTER TABLE {QUOTED} SET TBLPROPERTIES ('delta.dataSkippingStatsColumns' = '`as_of_date`,`region`')"
    assert agent_ns["implement_stats_compute_sql"](TABLE) == f"ANALYZE TABLE {QUOTED} COMPUTE DELTA STATISTICS"


def _wide_cluster_inspire(ns, properties=None, fail=None):
    def respond(statement):
        if fail and statement.startswith(fail):
            raise RuntimeError("PERMISSION_DENIED: not the owner of churn_out")
        if statement == f"DESCRIBE TABLE {QUOTED}":
            return _describe(WIDE_SCHEMA)
        if statement == f"DESCRIBE DETAIL {QUOTED}":
            return [{"clusteringColumns": [], "partitionColumns": [], **({"properties": properties} if properties is not None else {})}]
        return []

    inst = _inspire(ns, FakeSpark(responder=respond))
    inst.logger = CapturingLogger()
    return inst


def test_filter_columns_past_the_32_with_statistics_get_statistics_before_the_table_is_clustered_on_them(agent_ns):
    inst = _wide_cluster_inspire(agent_ns)
    assert inst._implement_cluster_result(_output_context(agent_ns), FILTERED) == ([], [])
    listed = ",".join(f"`{name}`" for name in WIDE_FIRST_32 + ["region", "channel"])
    steps = [f"ALTER TABLE {QUOTED} SET TBLPROPERTIES ('delta.dataSkippingStatsColumns' = '{listed}')",
             f"ANALYZE TABLE {QUOTED} COMPUTE DELTA STATISTICS",
             f"ALTER TABLE {QUOTED} CLUSTER BY (`as_of_date`, `region`, `segment_or_item`, `channel`)"]
    assert [s for s in inst.spark.statements if s.startswith(("ALTER TABLE", "ANALYZE TABLE"))] == steps
    assert any(level == "INFO" and f"kept statistics on {len(WIDE_FIRST_32)} columns and not on region, channel, which the App filters on"
               in message for level, message in inst.logger.records)


@pytest.mark.parametrize("properties", [{"delta.dataSkippingStatsColumns": "change_source,record_key,valid_from,valid_to,as_of_date,"
                                                                          "region,segment_or_item,channel"},
                                        {"delta.dataSkippingNumIndexedCols": "-1"}, {"delta.dataSkippingNumIndexedCols": "60"}])
def test_a_table_that_already_keeps_statistics_on_the_filter_columns_is_clustered_without_changing_them(agent_ns, properties):
    inst = _wide_cluster_inspire(agent_ns, properties)
    assert inst._implement_cluster_result(_output_context(agent_ns), FILTERED) == ([], [])
    assert [s for s in inst.spark.statements if s.startswith(("ALTER TABLE", "ANALYZE TABLE"))] == \
        [f"ALTER TABLE {QUOTED} CLUSTER BY (`as_of_date`, `region`, `segment_or_item`, `channel`)"]


def test_a_table_without_statistics_on_its_change_history_gets_them_so_the_current_rows_are_skipped_to(agent_ns):
    inst = _wide_cluster_inspire(agent_ns, {"delta.dataSkippingStatsColumns": "as_of_date,region,segment_or_item"})
    assert inst._implement_cluster_result(_output_context(agent_ns), FILTERED) == ([], [])
    altered = [s for s in inst.spark.statements if s.startswith(("ALTER TABLE", "ANALYZE TABLE"))]
    assert altered[0] == (f"ALTER TABLE {QUOTED} SET TBLPROPERTIES ('delta.dataSkippingStatsColumns' = "
                          "'`as_of_date`,`segment_or_item`,`region`,`channel`,`change_source`,`record_key`,`valid_from`,`valid_to`')")
    assert altered[1:] == [f"ANALYZE TABLE {QUOTED} COMPUTE DELTA STATISTICS",
                           f"ALTER TABLE {QUOTED} CLUSTER BY (`as_of_date`, `region`, `segment_or_item`, `channel`)"]
    done = _wide_cluster_inspire(agent_ns, {"delta.dataSkippingStatsColumns": "as_of_date,region,segment_or_item,channel,change_source,"
                                                                              "record_key,valid_from,valid_to"})
    done.spark.responder = (lambda inner: lambda s: [dict(inner(s)[0], clusteringColumns=["as_of_date", "region", "segment_or_item",
                                                                                          "channel"])]
                            if s.startswith("DESCRIBE DETAIL") else inner(s))(done.spark.responder)
    assert done._implement_cluster_result(_output_context(agent_ns), FILTERED) == ([], [])
    assert not [s for s in done.spark.statements if s.startswith(("ALTER TABLE", "ANALYZE TABLE"))], "a table already set up is left alone"


def test_a_narrow_table_is_clustered_with_no_statistics_change(agent_ns):
    inst = _cluster_inspire(agent_ns, {"clusteringColumns": [], "partitionColumns": []})
    assert len(CLUSTER_SCHEMA) <= 32
    assert inst._implement_cluster_result(_output_context(agent_ns), FILTERED) == ([], [])
    assert not [s for s in inst.spark.statements if "TBLPROPERTIES" in s or s.startswith("ANALYZE")]


@pytest.mark.parametrize("fail", ["ALTER TABLE", "ANALYZE TABLE"])
def test_a_statistics_change_that_fails_only_warns_and_never_clusters_half_way(agent_ns, fail):
    inst = _wide_cluster_inspire(agent_ns, fail=fail)
    assert inst._implement_cluster_result(_output_context(agent_ns), FILTERED) == ([CLUSTER_FAILED], [])
    assert not [s for s in inst.spark.statements if "CLUSTER BY" in s]


DISMISSED_ROWS = [{"reason": "already called", "records": 5, "dismissed": 9}, {"reason": "wrong   customer\n type", "records": 3, "dismissed": 9},
                  {"reason": None, "records": 1, "dismissed": 9}]


def _feedback_inspire(ns, rows=DISMISSED_ROWS, schema=CORE + HISTORY + ACTIONS, fail=None):
    def respond(statement):
        if statement == f"DESCRIBE TABLE {QUOTED}":
            return _describe(schema)
        if statement.startswith("SELECT reason, records"):
            if fail:
                raise RuntimeError(fail)
            return rows
        return []

    workspace = _NotebookWorkspace(None, modified_at=None)
    inst = _notebook_inspire(ns, workspace)
    inst.spark = FakeSpark(responder=respond)
    inst.logger = CapturingLogger()
    return inst, workspace


def _written(ns, inst, workspace, use_case=None):
    inst._implement_write_notebook(dict({"No": "N01-U01", "genie_instruction": "Build", "result_table": TABLE}, **(use_case or {})),
                                   ns["validate_implement_spec"](VALID)[0], ns["validate_implement_spec"](VALID)[0], (5150, "N01-U01", 1))
    return workspace.imported[-1]["cells"][1]["source"][0]


def test_the_records_people_dismissed_reach_genie_s_notebook_prompt(agent_ns, sdk_stub):
    inst, workspace = _feedback_inspire(agent_ns)
    text = _written(agent_ns, inst, workspace)
    assert ("- The customer's feedback from the App: people dismissed 9 of the current records, most often because: \"already "
            "called\" (5); \"wrong customer type\" (3). Treat it as the customer's word on what the decision list gets wrong, and "
            "change the method where the data can tell such records apart. A dismissed record never goes back to Act now: "
            "inspire_write_result keeps it in Monitor on every run, so never work around that.") in text
    assert text.index("## Implementation Choices") < text.index("The customer's feedback from the App")
    [query] = [s for s in inst.spark.statements if s.startswith("SELECT reason, records")]
    assert query == agent_ns["implement_dismissals_sql"](TABLE)
    assert (f"FROM {QUOTED} WHERE use_case_id = :uc AND is_current AND change_source <> 'delete' AND action_status = 'Dismissed' "
            "GROUP BY 1) ORDER BY reason IS NULL, records DESC, reason LIMIT 11") in query


def test_at_most_ten_reasons_reach_genie(agent_ns, sdk_stub):
    rows = [{"reason": f"reason {i}", "records": 20 - i, "dismissed": 200} for i in range(11)]
    inst, workspace = _feedback_inspire(agent_ns, rows=rows)
    found = inst._implement_dismissals("N01-U01", TABLE)
    assert found["dismissed"] == 200 and len(found["reasons"]) == 10 and found["reasons"][-1] == ("reason 9", 11)
    text = _written(agent_ns, inst, workspace)
    assert '"reason 9" (11)' in text and "reason 10" not in text


@pytest.mark.parametrize("rows,schema,fail,use_case", [
    ([], CORE + HISTORY + ACTIONS, None, None),
    (DISMISSED_ROWS, CORE + HISTORY, None, None),
    (DISMISSED_ROWS, CORE + HISTORY + ACTIONS, "PERMISSION_DENIED: no SELECT", None),
    (DISMISSED_ROWS, CORE + HISTORY + ACTIONS, None, {"result_table": ""}),
])
def test_no_feedback_reaches_genie_when_nothing_was_dismissed_or_it_cannot_be_read(agent_ns, sdk_stub, rows, schema, fail, use_case):
    inst, workspace = _feedback_inspire(agent_ns, rows=rows, schema=schema, fail=fail)
    text = _written(agent_ns, inst, workspace, use_case)
    assert "The customer's feedback from the App" not in text
    warned = [m for _lvl, m in inst.logger.records if m.startswith("[IMPLEMENT-FEEDBACK]") and "could not be read" in m]
    assert bool(warned) is bool(fail)


def test_a_dismissal_without_a_reason_still_reaches_genie(agent_ns):
    lines = agent_ns["implement_dismissal_lines"]({"dismissed": 2, "reasons": []})
    assert lines[0].startswith("- The customer's feedback from the App: people dismissed 2 of the current records, without giving a "
                               "reason. ")
    assert agent_ns["implement_dismissal_lines"](None) == [] and agent_ns["implement_dismissal_lines"]({"dismissed": 0}) == []


class _StampedNotebook(_NotebookWorkspace):
    def __init__(self, notebook, modified_at, fail_export=False, fail_import=False):
        super().__init__(notebook, modified_at)
        self.fail_export, self.fail_import = fail_export, fail_import

    def export(self, path, format=None):
        if self.fail_export:
            raise RuntimeError("PERMISSION_DENIED: no CAN READ on the notebook")
        return super().export(path, format)

    def import_(self, path, overwrite, format, content):
        if self.fail_import:
            raise RuntimeError("PERMISSION_DENIED: no CAN EDIT on the notebook")
        super().import_(path, overwrite, format, content)
        self.notebook, self.modified_at = self.imported[-1], self.modified_at + 500


def _controls_case(agent_ns, cells=None, recorded_at=1000, modified_at=1000, **failures):
    from v120_genie_support import build_inspire, make_uc
    inst = build_inspire(agent_ns)
    inst.logger = CapturingLogger()
    uc = make_uc(genie_instruction="## Parameters\n| widget | type | default | allowed | label |\n| top_k | text | `25` |  | Top K |\n\nBuild it")
    spec_nb = inst._genie_notebook_spec(uc)
    instruction = inst._genie_cell("code", inst._genie_instruction_cell_source(uc, uc["genie_instruction"]), "Genie Code instruction")
    user = {"cell_type": "code", "metadata": {}, "source": ["def run_use_case():\n    return 'mine'\n"]}
    stale = {"cell_type": "code", "metadata": {"application/vnd.databricks.v1+cell": {"title": "Run controls (Inspire, do not edit)"}},
             "source": ["# Run controls built by an older Inspire\nmain()\n"]}
    header = {"cell_type": "markdown", "metadata": {}, "source": ["# N01-U01"]}
    notebook = {"cells": cells(header, instruction, user, stale) if cells else [header, instruction, user, stale], "metadata": {"k": 1}}
    workspace = _StampedNotebook(notebook, modified_at, **failures)
    inst.w_client = types.SimpleNamespace(workspace=workspace)
    inst.updates = []
    inst._implement_update = lambda key, **f: inst.updates.append(json.loads(json.dumps(f)))
    status = {"notebook": {"modified_at": recorded_at, "spec_version": 2, "result_history": 1}, "app": {"state": "ready"}}
    fresh = inst._genie_cell("code", inst._genie_run_controls_source(uc, spec_nb, ast_text(instruction)), "Run controls (Inspire, do not edit)")
    return inst, workspace, uc, spec_nb, status, (header, instruction, user, stale, fresh)


def ast_text(cell):
    import ast
    return ast.literal_eval("".join(cell["source"]).strip())


def _no_ids(cells):
    out = json.loads(json.dumps(cells))
    for cell in out:
        ((cell.get("metadata") or {}).get("application/vnd.databricks.v1+cell") or {}).pop("nuid", None)
    return out


def test_a_kept_notebook_gets_the_run_controls_of_this_inspire_and_keeps_every_other_cell(agent_ns, sdk_stub):
    inst, workspace, uc, spec_nb, status, (header, instruction, user, stale, fresh) = _controls_case(agent_ns)
    warnings = []
    inst._implement_refresh_run_controls("N01-U01", (5150, "N01-U01", 3), uc, spec_nb, NB, status, warnings)
    assert warnings == [] and len(workspace.imported) == 1
    written = workspace.imported[0]
    assert _no_ids(written["cells"]) == _no_ids([header, instruction, user, fresh]) and written["metadata"] == {"k": 1}
    controls = "".join(written["cells"][-1]["source"])
    assert "inspire_action_summary" in controls and "'refresh_requested_by': 'schedule'" in controls and "'top_k'" in controls
    assert status["notebook"] == {"modified_at": 1500, "spec_version": 2, "result_history": 1}
    assert inst.updates == [{"asset_status": status}], "the new stamp is saved at once, so the next run does not see a user edit"
    assert any("brought the Run controls of" in m and "edited the 'Run controls (Inspire, do not edit)' cell" in m
               for _lvl, m in inst.logger.records)
    again = []
    inst._implement_refresh_run_controls("N01-U01", (5150, "N01-U01", 4), uc, spec_nb, NB, status, again)
    assert again == [] and len(workspace.imported) == 1 and len(inst.updates) == 1, "current Run controls are left alone"


def test_run_controls_moved_off_the_end_are_put_back_last(agent_ns, sdk_stub):
    inst, workspace, uc, spec_nb, status, (header, instruction, user, _stale, fresh) = _controls_case(
        agent_ns, cells=lambda h, i, u, s: [h, i, s, u])
    workspace.notebook["cells"][2] = fresh
    inst._implement_refresh_run_controls("N01-U01", (5150, "N01-U01", 3), uc, spec_nb, NB, status, [])
    assert _no_ids(workspace.imported[-1]["cells"]) == _no_ids([header, instruction, user, fresh])


def test_a_kept_notebook_with_the_number_helpers_gets_this_inspires_copy_above_the_run_controls(agent_ns, sdk_stub):
    title = agent_ns["GENIE_NUMBER_HELPERS_TITLE"]
    stale_helpers = {"cell_type": "code", "metadata": {"application/vnd.databricks.v1+cell": {"title": title}},
                     "source": ["def fmt_num(x):\n    return str(x)\n"]}
    inst, workspace, uc, spec_nb, status, (header, instruction, user, stale, fresh) = _controls_case(
        agent_ns, cells=lambda h, i, u, s: [h, i, u, stale_helpers, s])
    inst._implement_refresh_run_controls("N01-U01", (5150, "N01-U01", 3), uc, spec_nb, NB, status, [])
    written = workspace.imported[-1]["cells"]
    assert _no_ids([written[0], written[1], written[2], written[4]]) == _no_ids([header, instruction, user, fresh])
    assert written[3]["metadata"]["application/vnd.databricks.v1+cell"]["title"] == title
    assert "".join(written[3]["source"]) == agent_ns["GENIE_NUMBER_TEXT_SOURCE"], "the stale helpers are replaced, never kept"


def test_a_notebook_the_user_edited_gets_new_run_controls_and_stays_marked_as_edited(agent_ns, sdk_stub):
    inst, workspace, uc, spec_nb, status, cells = _controls_case(agent_ns, recorded_at=1000, modified_at=1200)
    edited = agent_ns["implement_notebook_edited"]
    inst._implement_refresh_run_controls("N01-U01", (5150, "N01-U01", 3), uc, spec_nb, NB, status, [])
    assert workspace.imported[-1]["cells"][2] == cells[2], "the user's cells are kept"
    assert status["notebook"]["modified_at"] == 1000 and inst.updates == []
    assert edited(workspace.modified_at, status["notebook"]), "a later rebuild still asks before it overwrites the user's edits"


@pytest.mark.parametrize("cells,reason", [
    (lambda h, i, u, s: [h, u, s], "it holds 0 'Genie Code instruction' cells, not one"),
    (lambda h, i, u, s: [h, i, i, u, s], "it holds 2 'Genie Code instruction' cells, not one"),
    (lambda h, i, u, s: [h, dict(i, source=["r'''unclosed"]), u, s], "unterminated"),
    (lambda h, i, u, s: [h, dict(i, source=["42"]), u, s], "its 'Genie Code instruction' cell is not the instruction text"),
    (lambda h, i, u, s: [h, dict(i, source=["run_use_case()"]), u, s], "malformed node"),
    (lambda h, i, u, s: [h, dict(i, source=["(" * 400 + ")" * 400]), u, s], "because"),
], ids=["no_instruction", "two_instructions", "unparseable", "not_text", "code_not_text", "deeply_nested"])
def test_run_controls_that_cannot_be_rebuilt_are_a_warning_and_the_notebook_is_left_as_it_is(agent_ns, sdk_stub, cells, reason):
    inst, workspace, uc, spec_nb, status, _cells = _controls_case(agent_ns, cells=cells)
    warnings = []
    inst._implement_refresh_run_controls("N01-U01", (5150, "N01-U01", 3), uc, spec_nb, NB, status, warnings)
    assert len(warnings) == 1 and warnings[0].startswith(f"Notebook: Inspire could not bring the Run controls of {NB} up to date")
    assert reason in warnings[0] and warnings[0].endswith("build the notebook again with Vibe/Add/Remove Features on the Build page")
    assert workspace.imported == [] and inst.updates == [] and status["notebook"]["modified_at"] == 1000


@pytest.mark.parametrize("failure,start", [
    ({"fail_export": True}, f"Notebook: Inspire could not read {NB} to bring its Run controls up to date"),
    ({"fail_import": True}, f"Notebook: Inspire could not write the up-to-date Run controls into {NB}"),
])
def test_a_notebook_that_cannot_be_read_or_written_is_a_warning(agent_ns, sdk_stub, failure, start):
    inst, workspace, uc, spec_nb, status, _cells = _controls_case(agent_ns, **failure)
    warnings = []
    inst._implement_refresh_run_controls("N01-U01", (5150, "N01-U01", 3), uc, spec_nb, NB, status, warnings)
    assert len(warnings) == 1 and warnings[0].startswith(start) and "PERMISSION_DENIED" in warnings[0]
    assert inst.updates == [] and status["notebook"]["modified_at"] == 1000


def test_a_notebook_that_is_gone_is_left_to_the_build_that_needs_it(agent_ns, sdk_stub):
    inst, workspace, uc, spec_nb, status, _cells = _controls_case(agent_ns)
    workspace.modified_at = None
    warnings = []
    inst._implement_refresh_run_controls("N01-U01", (5150, "N01-U01", 3), uc, spec_nb, NB, status, warnings)
    assert warnings == [] and workspace.imported == [] and inst.updates == []


def test_a_version_that_keeps_the_notebook_refreshes_its_run_controls_and_a_rebuild_does_not(agent_ns, tmp_path, monkeypatch):
    files = _host_files(agent_ns, tmp_path, source=OWN_SOURCE, pages=[_host_page(agent_ns, "N01-U01", "Churn desk")],
                        title="N01-U01 Predict churn", genie="g1")
    inst = _restyle_inspire(agent_ns, tmp_path, monkeypatch, files)
    seen = []
    inst._implement_refresh_run_controls = lambda uc_id, key, use_case, spec_nb, path, status, warnings: seen.append((uc_id, key, path))
    previous = json.loads(json.dumps(VALID))
    inst._implement_previous = lambda t: {"spec_version": 2, "spec_json": previous}
    current = dict(previous, outputs={**previous["outputs"], "app_look": {"palette": "ocean"}})
    assert inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": current},
                                      (5150, "N01-U01", 3)) == "ready"
    assert seen == [("N01-U01", (5150, "N01-U01", 3), "/W/nb")]
    source = open(__file__.replace("tests/unit/v144_contract_test.py", "agent/dbx_inspire_ai_agent.ipynb"), encoding="utf-8").read()
    assert source.count("self._implement_refresh_run_controls(") == 1


def test_a_holdout_only_edit_rewrites_the_run_controls_with_the_new_share_and_rebuilds_no_output(agent_ns, sdk_stub, tmp_path, monkeypatch):
    files = _host_files(agent_ns, tmp_path, source=OWN_SOURCE, pages=[_host_page(agent_ns, "N01-U01", "Churn desk")],
                        title="N01-U01 Predict churn", genie="g1")
    inst = _restyle_inspire(agent_ns, tmp_path, monkeypatch, files)
    inst._implement_app = lambda c, r: pytest.fail("a holdout edit leaves the App alone")
    _built, _ws, uc, spec_nb, _status, (header, instruction, user, stale, _fresh) = _controls_case(agent_ns)
    workspace = _StampedNotebook({"cells": [header, instruction, user, stale], "metadata": {"k": 1}}, 1700000000000)
    inst.w_client = types.SimpleNamespace(workspace=workspace)
    inst._implement_use_case_row = lambda sid, uc_id: dict(uc)
    inst._genie_notebook_spec = lambda use_case: dict(spec_nb)
    held = dict(VALID, holdout={"enabled": True, "share": 0.1})
    controls = []
    for version, spec in ((3, held), (4, dict(VALID, holdout={"enabled": True, "share": 0.2}))):
        inst._implement_previous = lambda t, built=version - 1: {"spec_version": built, "spec_json": held}
        workspace.modified_at = 1700000000000
        status = inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": version, "spec_json": spec},
                                            (5150, "N01-U01", version))
        assert status == "ready", inst.updates[-1]
        written = workspace.imported[-1]
        assert _no_ids(written["cells"][:3]) == _no_ids([header, instruction, user]) and written["metadata"] == {"k": 1}
        controls.append("".join(written["cells"][-1]["source"]).splitlines())
    assert len(workspace.imported) == 2 and len(controls[0]) == len(controls[1])
    assert [(a.strip(), b.strip()) for a, b in zip(*controls) if a != b] == [("'holdout_share': 0.1,", "'holdout_share': 0.2,")]
    assert inst.deployed == [] and inst.checked == []
    assert inst.updates[-1]["status_message"] == "ready: no new preview was needed; the last preview wrote 40 rows"
    assert [u["change_classes"] for u in inst.updates if "change_classes" in u] == ["", "holdout"]
    assert "spec v4: changes holdout; keep the built notebook" in [e.get("message") for e in inst.emitted]
