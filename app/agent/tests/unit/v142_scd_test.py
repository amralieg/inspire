import ast
import json
import os
import re
import types

import pytest

import v120_metadata_only_guard_test as guard
from _agentload import agent_source
from v120_artifacts_support import FakeSpark
from v140_implement_test import (ALERT, SHELL_SQL, VALID, _inspire, _left_by, _notebook_inspire, _NotebookWorkspace, _probe_inspire,
                                 _spec, sdk_stub)  # noqa: F401

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TABLE = "main.inspire.churn_out"
QUOTED = "`main`.`inspire`.`churn_out`"
STAGE = "main.inspire.churn_out_inspire_stage"
QUOTED_STAGE = "`main`.`inspire`.`churn_out_inspire_stage`"
HISTORY = [("record_key", "string"), ("valid_from", "timestamp"), ("valid_to", "timestamp"), ("is_current", "boolean"),
           ("change_source", "string"), ("changed_by", "string")]
CORE = [("as_of_date", "date"), ("entity_id", "string"), ("entity_label", "string"), ("segment_or_item", "string"), ("rank", "int"),
        ("priority_tier", "string"), ("top_reasons", "array<string>"), ("explanation", "string"), ("run_id", "string"),
        ("use_case_id", "string")]
LEGACY = [(n, "struct<result:string,errorMessage:string>" if n == "explanation" else t) for n, t in CORE] + [("legacy_note", "string")]
CURRENT = "is_current AND change_source <> 'delete'"
GOOD_PROFILE = {"row_count": 3, "use_cases": 1, "use_case_id": "N01-U01", "runs": 1, "run_id": "r-2", "undated": 0, "no_use_case": 0,
                "no_run": 0, "id_unique": True, "label_unique": True}
QUOTED_SUMMARY = "`main`.`inspire`.`churn_out_summary`"
SUMMARY = [("use_case_id", "string"), ("run_id", "string"), ("as_of_date", "date"), ("summary", "string"), ("ai_endpoint", "string"),
           ("ai_config", "string"), ("act_now_records", "bigint"), ("review_records", "bigint"), ("records", "bigint"),
           ("value_at_stake", "double"), ("currency", "string"), ("decision_basis", "string"), ("act_now_amount", "double"),
           ("review_amount", "double"), ("nothing_to_act", "string"), ("run_started_at", "timestamp"), ("run_ended_at", "timestamp"),
           ("run_trigger", "string"), ("run_segments", "string"), ("run_tables", "string"), ("run_stages", "string"),
           ("run_grouping", "string"), ("ai_checks", "string"),
           ("value_formula", "string"), ("value_expression", "string"), ("value_assumptions", "string"), ("accepted", "boolean"),
           ("preview_sample_entities", "bigint"), ("passing_records", "bigint"), ("act_now_share", "double"), ("review_share", "double"),
           ("impact_kind", "string"), ("impact_unit", "string"), ("kpi_name", "string"),
           ("kpi_source", "string"), ("kpi_direction", "string"), ("kpi_unit", "string"), ("kpi_baseline", "double"),
           ("kpi_baseline_on", "string"), ("kpi_latest", "double"), ("kpi_target", "double"), ("kpi_target_text", "string"),
           ("kpi_status", "string"), ("kpi_reason", "string"), ("kpi_measured_at", "timestamp"), ("kpi_query", "string"),
           ("act_now_capacity", "bigint"), ("over_capacity_records", "bigint"), ("not_reliable", "string"), ("run_facts", "string"),
           ("updated_at", "timestamp")]
OUTCOME = {"act_now_records": 1, "review_records": 1, "records": 3}
OUTCOME_LINE = "Business output: 1 Act now and 1 Review of 3 current records"
RUN_LOG_LINE = "Run log: run r-2 was started by the build and read 0 tables with all their data"
FACTS_LINE = ("Run facts: kept the counts of run r-2 for the App (0 run and tier rows, 0 current records, 0 left since the run before, "
              "and 0 versions of the records people acted on in main.inspire.churn_out_acted)")
LOG_READY_LINE = (f"Run log: {TABLE}_run_log now lists the records of every run of {TABLE}, so a run writes a new version of a record "
                  "only when its values change")
LAYOUT_LINE = f"Layout: clustered the versions this run wrote to {TABLE}, so the App's first records read only the files that hold them"
NOW_US = 1_793_000_000_000_000
NOW = f"timestamp_micros({NOW_US})"
QUOTED_LOG = "`main`.`inspire`.`churn_out_run_log`"
VERSION = 7
LOGGED = {"inspire.run_log": f"{TABLE}_run_log", "inspire.run_log_tier": "priority_tier"}


def _describe(schema):
    return [{"col_name": name, "data_type": kind, "comment": None} for name, kind in schema]


class _Tables:
    def __init__(self, ns, stage=CORE, target=None, profile=None, properties=None, kept=0, repeats=None, merged=None,
                 fail=None, outcome=None):
        self.ns, self.stage, self.target, self.kept = ns, stage, target, kept
        self.outcome = OUTCOME if outcome is None else outcome
        self.profile = dict(GOOD_PROFILE, **(profile or {}))
        self.properties = properties or {}
        self.repeats, self.merged, self.fail = repeats or [], merged or [{"num_inserted_rows": 3, "num_updated_rows": 2}], fail
        self.spark = FakeSpark(responder=self.respond)

    def respond(self, statement):
        if self.fail and statement.startswith(self.fail):
            raise RuntimeError(f"PERMISSION_DENIED: {self.fail}")
        if statement == f"DESCRIBE TABLE {QUOTED_STAGE}":
            return _describe(self.stage)
        if statement == f"DESCRIBE TABLE {QUOTED}":
            if self.target is None:
                raise RuntimeError(f"[TABLE_OR_VIEW_NOT_FOUND] The table or view {QUOTED} cannot be found.")
            return _describe(self.target)
        if statement == f"DESCRIBE TABLE {QUOTED_SUMMARY}":
            return _describe(SUMMARY)
        if statement.startswith("SELECT COUNT_IF(t.`priority_tier` = 'Act now') AS act_now_records"):
            return [self.outcome]
        if statement.startswith("SELECT COUNT(*) AS row_count, COUNT(DISTINCT use_case_id)"):
            return [self.profile]
        if statement.startswith("SHOW TBLPROPERTIES"):
            return [{"key": k, "value": v} for k, v in self.properties.items()]
        if statement == "SELECT unix_micros(current_timestamp()) AS now":
            return [{"now": NOW_US}]
        if statement.startswith("DESCRIBE HISTORY"):
            return [{"version": VERSION}]
        if statement.startswith(f"INSERT INTO {QUOTED_LOG} SELECT n.*"):
            return [{"num_inserted_rows": 3}]
        if statement.startswith("SELECT COUNT(*) AS kept"):
            return [{"kept": self.kept}]
        if statement.startswith("SELECT k AS record_key"):
            return self.repeats
        if statement.startswith("MERGE INTO"):
            return self.merged
        return []

    def run(self):
        printed = []
        rows = self.ns["inspire_merge_run"](self.spark, TABLE, STAGE, out=printed.append)
        return rows, printed

    def index(self, prefix):
        hits = [i for i, s in enumerate(self.spark.statements) if s.startswith(prefix)]
        return hits[0] if hits else None


def test_the_current_rows_are_the_change_history_view_and_never_the_newest_as_of_date(agent_ns):
    assert agent_ns["implement_latest_run_filter"](TABLE) == CURRENT
    assert agent_ns["implement_latest_run_filter"]("other.s.t") == CURRENT == agent_ns["INSPIRE_CURRENT_ROWS"]
    source = agent_source()
    assert "(SELECT MAX(as_of_date)" not in source, "no reader finds the latest run by its newest as_of_date"
    example = json.load(open(os.path.join(ROOT, "agent", "app_shell", "example_page.json")))
    records = next(d["sql"] for d in example["datasets"] if d["name"] == "records")
    assert "MAX(as_of_date)" not in records and "o.is_current AND o.change_source <> 'delete'" in records, \
        "the App example Genie copies reads the current rows"


def test_every_output_and_check_reads_the_current_rows(agent_ns):
    outputs = _spec(agent_ns, outputs={**VALID["outputs"], **ALERT})[0]["outputs"]
    query = agent_ns["implement_alert_query"](SHELL_SQL, TABLE, outputs)["query"]
    assert f"SELECT * FROM {QUOTED} WHERE {CURRENT}" in query and "SELECT MAX(as_of_date)" not in query
    truth = [{"entity_id": "c1", "entity_label": "Acme", "priority_tier": "Monitor", "rank": 1}]
    missing = agent_ns["implement_decision_list_problems"]([{"entity_id": "c9", "priority_tier": "Monitor"}], truth)
    assert len(missing) == 1 and f"list every row WHERE {CURRENT} ordered by rank" in missing[0]
    assert "never the newest as_of_date instead" in missing[0]
    empty = agent_ns["implement_decision_list_problems"]([], truth)[0]
    assert f"1 current row (WHERE {CURRENT})" in empty
    view = agent_ns["implement_reasons_view_sql"](TABLE)
    for name in agent_ns["IMPLEMENT_REASONS_HISTORY_COLUMNS"]:
        assert f" {name}," in view and name in agent_ns["IMPLEMENT_REASONS_VIEW_COLUMNS"], name
    assert "changed_by" not in view, "the reasons view carries no editor email"
    controls = agent_ns["GENIE_RUN_CONTROLS_RULE"]
    assert agent_ns["GENIE_RESULT_HISTORY_RULE"] in controls and f"the current rows are `WHERE {CURRENT}`" in controls
    assert "never create, write, update or delete the business output table yourself" in controls
    assert "inspire_write_result(frame, result_table)" in agent_ns["GENIE_AGENTS_FILE_TEMPLATE"]


def test_a_first_run_creates_the_table_with_its_change_history_and_no_backup(agent_ns):
    tables = _Tables(agent_ns, target=None)
    rows, printed = tables.run()
    assert rows == 3
    create = [s for s in tables.spark.statements if s.startswith(f"CREATE TABLE {QUOTED} ")]
    assert len(create) == 1 and create[0].startswith(f"CREATE TABLE {QUOTED} AS SELECT s.`as_of_date`, s.`entity_id`")
    assert (f"CAST(s.`entity_id` AS STRING) AS record_key, {NOW} AS valid_from, CAST(NULL AS TIMESTAMP) AS valid_to, "
            "TRUE AS is_current, 'run' AS change_source, concat('run ', s.run_id) AS changed_by FROM " + QUOTED_STAGE) in create[0]
    assert tables.index(f"CREATE OR REPLACE TABLE {QUOTED} ") is None and tables.index(f"MERGE INTO {QUOTED} ") is None, \
        "a new table needs no copy and no merge"
    assert tables.index(f"INSERT INTO {QUOTED_LOG} SELECT n.*") > tables.index(f"CREATE TABLE {QUOTED} "), "the run log lists the first run"
    assert printed == [LOG_READY_LINE, f"Business output: created {TABLE} with the 3 rows of run r-2 as the current version of each "
                       "record, keyed by entity_id", OUTCOME_LINE, RUN_LOG_LINE, FACTS_LINE, LAYOUT_LINE]
    outcome, log, facts = [s for s in tables.spark.statements if s.startswith(f"MERGE INTO {QUOTED_SUMMARY} ")]
    assert "UPDATE SET `run_facts` = '" in facts and tables.spark.statements[-2:] == [facts, f"OPTIMIZE {QUOTED}"], \
        "the run clusters what it wrote last, after the App's counts are kept"
    assert outcome.startswith(f"MERGE INTO {QUOTED_SUMMARY} AS s USING (SELECT 'N01-U01' AS use_case_id, 'r-2' AS run_id)")
    assert ("UPDATE SET `act_now_records` = 1, `review_records` = 1, `records` = 3, `nothing_to_act` = NULL, updated_at"
            in outcome), "an old notebook's run records its counts and no money fields"
    assert ("UPDATE SET `run_started_at` = NULL, `run_trigger` = 'build', `run_segments` = '[]', `run_tables` = '[]', "
            "`run_grouping` = NULL, updated_at"
            in log)


def test_a_run_writes_a_new_version_only_for_a_changed_record_and_keeps_the_table_s_version_before_it(agent_ns):
    tables = _Tables(agent_ns, target=CORE + HISTORY, kept=2, properties=LOGGED)
    rows, printed = tables.run()
    assert rows == 3
    before, merge = tables.index(f"DESCRIBE HISTORY {QUOTED}"), tables.index(f"MERGE INTO {QUOTED} ")
    assert before < merge and tables.index("SELECT COUNT_IF(is_current IS NULL)") is None, \
        "the version before the run is read first, and a run never backfills a change history"
    assert "DEEP CLONE" not in " ".join(tables.spark.statements), "no copy of the whole table is taken"
    sql = tables.spark.statements[merge]
    assert sql.startswith(f"MERGE INTO {QUOTED} AS t USING (WITH z AS (SELECT q.*, COALESCE(q._inspire_was_current AND "
                          "q._inspire_was_source = 'run' AND ")
    assert (f"FROM {QUOTED} AS r WHERE r.use_case_id = 'N01-U01' QUALIFY ROW_NUMBER() OVER (PARTITION BY r.record_key ORDER BY "
            "r.is_current DESC, r.valid_from DESC) = 1) AS p ON p.record_key = CAST(s.`entity_id` AS STRING)") in sql
    assert ("COALESCE(p.is_current AND p.change_source IN ('run', 'action') AND NOT COALESCE(p.edited_by_person, FALSE), FALSE) "
            "AS _inspire_was_open" in sql), \
        "only a current version a run may replace is closed"
    assert ("CASE WHEN q.`action_status` = 'Dismissed' THEN 'Monitor' ELSE q.`priority_tier` END <=> q._inspire_was_" in sql), \
        "a record is unchanged only when every value the run would write equals its current version"
    for stamp in ("run_id", "as_of_date", "rank"):
        assert f"q.`{stamp}` <=>" not in sql, f"{stamp} changes every run, so it never makes a record changed"
    assert ("SELECT z._inspire_record_key AS _inspire_key, z.* FROM z UNION ALL SELECT NULL AS _inspire_key, z.* FROM z WHERE "
            "z._inspire_was_open AND NOT z._inspire_same) AS u") in sql
    unedited = "t.change_source IN ('run', 'action') AND NOT COALESCE(t.edited_by_person, FALSE)"
    assert (f"WHEN MATCHED AND {unedited} AND u._inspire_same THEN UPDATE SET `rank` = u.`run_id`" not in sql)
    assert (f"WHEN MATCHED AND {unedited} AND u._inspire_same THEN UPDATE SET `as_of_date` = u.`as_of_date`, "
            f"`rank` = u.`rank`, `run_id` = u.`run_id`, valid_from = {NOW}, changed_by = concat('run ', u.run_id) "
            f"WHEN MATCHED AND {unedited} THEN UPDATE SET valid_to = {NOW}, is_current = FALSE") in sql
    assert (f"u._inspire_record_key, {NOW}, NULL, TRUE, 'run', concat('run ', u.run_id)) WHEN NOT MATCHED BY SOURCE AND "
            f"t.use_case_id = 'N01-U01' AND t.is_current AND {unedited} THEN UPDATE SET valid_to = {NOW}, is_current = FALSE") in sql
    log = tables.spark.statements[tables.index(f"INSERT INTO {QUOTED_LOG} SELECT n.*")]
    assert tables.index(f"INSERT INTO {QUOTED_LOG} SELECT n.*") > merge
    assert (f"FROM {QUOTED} AS t WHERE t.use_case_id = 'N01-U01' AND t.is_current AND t.change_source = 'run' AND "
            f"CAST(t.run_id AS STRING) = 'r-2' AND t.valid_from = {NOW})") in log, "the log lists every record the run wrote or kept"
    statements = " ".join(tables.spark.statements)
    assert "INSERT OVERWRITE" not in statements and "DELETE FROM" not in statements and not tables.spark.writes, \
        "a run never overwrites or deletes the table's rows"
    assert printed[-4:] == [OUTCOME_LINE, RUN_LOG_LINE, FACTS_LINE, LAYOUT_LINE]
    assert tables.spark.statements[-1] == f"OPTIMIZE {QUOTED}", "the versions this run wrote are clustered before the next read"
    assert printed[-5] == (f"Business output: run r-2 wrote 3 new versions to {TABLE} for the records that are new or changed and kept "
                           f"0 records unchanged, closing 2 earlier ones, keyed by entity_id; kept 2 records people "
                           "changed in the App, since runs keep those changes; kept 0 dismissed records in Monitor (0 out of "
                           "Act now), and wrote 0 outcomes for records people marked Done (0 Resolved, 0 Still flagged); the table as it "
                           f"was before this run is its version {VERSION}, which RESTORE TABLE {TABLE} TO VERSION AS OF {VERSION} brings back")


def test_a_run_that_cannot_cluster_what_it_wrote_says_so_and_still_writes_its_rows(agent_ns):
    tables = _Tables(agent_ns, target=CORE + HISTORY, properties=LOGGED, fail="OPTIMIZE")
    rows, printed = tables.run()
    assert rows == 3 and printed[-2] == FACTS_LINE
    assert printed[-1] == (f"Layout: Inspire could not cluster the versions this run wrote to {TABLE}, so the App's first records read more "
                           "files until a later run clusters them: PERMISSION_DENIED: OPTIMIZE")


@pytest.mark.parametrize("properties,replace", [({}, False), ({"inspire.replace_edits": "false"}, False),
                                               ({"inspire.replace_edits": "TRUE"}, True)])
def test_a_scheduled_run_keeps_app_edits_unless_the_use_case_lets_runs_replace_them(agent_ns, properties, replace):
    tables = _Tables(agent_ns, target=CORE + HISTORY, properties=dict(properties, **{"delta.minReaderVersion": "3"}))
    _rows, printed = tables.run()
    sql = tables.spark.statements[tables.index(f"MERGE INTO {QUOTED} ")]
    guarded = ["COALESCE(p.is_current AND p.change_source IN ('run', 'action') AND NOT COALESCE(p.edited_by_person, FALSE), FALSE)",
               "WHEN MATCHED AND t.change_source IN ('run', 'action') AND NOT COALESCE(t.edited_by_person, FALSE)",
               "t.is_current AND t.change_source IN ('run', 'action') AND NOT COALESCE(t.edited_by_person, FALSE) THEN"]
    for guard in guarded:
        assert (guard in sql) is (not replace), guard
    line = next(p for p in printed if p.startswith("Business output: run r-2 wrote"))
    if replace:
        assert "p.is_current AND TRUE" in sql and "WHEN MATCHED AND TRUE" in sql and "t.is_current AND TRUE THEN" in sql
        assert tables.index("SELECT COUNT(*) AS kept") is None
        assert "runs replace the records people changed in the App" in line
    else:
        assert "kept 0 records people changed in the App" in line


def test_a_run_never_migrates_a_table_built_without_the_change_history(agent_ns):
    for name in ("inspire_ensure_history", "inspire_ensure_actions", "inspire_history_backfill_sql", "inspire_history_pending_sql"):
        assert name not in agent_ns, name
    tables = _Tables(agent_ns, target=CORE)
    rows, printed = tables.run()
    statements = " ".join(tables.spark.statements)
    assert rows == 3 and tables.index(f"MERGE INTO {QUOTED} ") is not None, "the run merges as into any table this version built"
    for migration in ("ADD COLUMNS (record_key", "ADD COLUMNS (action_", "INSERT OVERWRITE", "is_current IS NULL"):
        assert migration not in statements, migration
    assert not any(p.startswith(("Change history:", "Actions: added")) for p in printed)


def test_a_merge_that_meets_a_concurrent_app_edit_runs_again_and_any_other_failure_stops(fresh_ns, monkeypatch):
    import time
    waits = []
    monkeypatch.setattr(time, "sleep", waits.append)
    tables = _Tables(fresh_ns, target=CORE + HISTORY)
    errors = [RuntimeError("[DELTA_CONCURRENT_APPEND] ConcurrentAppendException: Files were added by a concurrent update.")]
    respond = tables.respond

    def concurrent(statement):
        if statement.startswith("MERGE INTO") and errors:
            raise errors.pop(0)
        return respond(statement)

    tables.spark.responder = concurrent
    rows, printed = tables.run()
    merges = [s for s in tables.spark.statements if s.startswith(f"MERGE INTO {QUOTED} ") and "WHEN NOT MATCHED THEN INSERT" in s]
    assert rows == 3 and len(waits) == 1 and 0.5 <= waits[0] <= 1.0 and len(merges) == 2
    assert any("changed while run r-2 merged into it, such as an edit in the App, so the merge runs again (attempt 2 of " in p
               for p in printed)
    stuck = _Tables(fresh_ns, target=CORE + HISTORY, fail="MERGE INTO")
    with pytest.raises(RuntimeError, match="PERMISSION_DENIED"):
        stuck.run()
    assert len([s for s in stuck.spark.statements if s.startswith(f"MERGE INTO {QUOTED} ")]) == 1, "only a concurrent change is retried"
    always = _Tables(fresh_ns, target=CORE + HISTORY)
    always.spark.responder = lambda s: (_ for _ in ()).throw(RuntimeError("[DELTA_CONCURRENT_APPEND] concurrent update")) if s.startswith("MERGE") else \
        always.respond(s)
    with pytest.raises(RuntimeError, match="concurrent update"):
        always.run()
    assert len([s for s in always.spark.statements if s.startswith(f"MERGE INTO {QUOTED} ")]) == fresh_ns["inspire_write_conflict_attempts"]()


@pytest.mark.parametrize("stage,profile,repeats,needle", [
    ([c for c in CORE if c[0] != "use_case_id"], {}, [], "the rows have no use_case_id column"),
    (CORE, {"use_cases": 2}, [], "every row must carry this use case's id in use_case_id, and only that id"),
    (CORE, {"no_run": 4}, [], "every row must carry this run's one run_id"),
    (CORE, {"undated": 7}, [], "7 rows have no as_of_date"),
    (CORE, {"id_unique": False, "label_unique": False}, [{"record_key": "c1 | ", "row_count": 2}],
     "rows share the record key entity_id with segment_or_item or leave it empty ('c1 | ' (2 rows))"),
])
def test_a_run_whose_rows_break_the_contract_writes_nothing(agent_ns, stage, profile, repeats, needle):
    tables = _Tables(agent_ns, stage=stage, target=CORE + HISTORY, profile=profile, repeats=repeats)
    with pytest.raises(ValueError, match="Inspire did not write the business output") as raised:
        tables.run()
    assert needle in str(raised.value)
    for verb in ("CREATE", "MERGE", "ALTER", "INSERT"):
        assert tables.index(verb) is None, verb


def test_a_run_with_no_rows_leaves_the_table_as_it_was(agent_ns):
    tables = _Tables(agent_ns, target=CORE + HISTORY, profile={"row_count": 0, "use_cases": 0, "runs": 0})
    assert tables.run() == (0, [f"Business output: the run produced no rows, so {TABLE} was left as it was"])
    assert tables.index("MERGE") is None and tables.index("CREATE") is None


def test_the_record_key_follows_the_contract_rule_and_its_fallback(agent_ns):
    rule, key = agent_ns["inspire_record_key_rule"], agent_ns["inspire_record_key_sql"]
    names = [n for n, _k in CORE]
    assert rule(names, True, True) == ("entity_id",)
    assert rule(names, False, True) == ("entity_label",), "entity_label when entity_id repeats or is missing"
    assert rule(names, False, False) == ("entity_id", "segment_or_item"), "the row's unique grain when both repeat"
    assert rule([n for n in names if n != "segment_or_item"], False, False) == ("entity_id",)
    assert rule([n for n in names if n != "entity_label"], False, True) == ("entity_id", "segment_or_item")
    assert key(("entity_id", "segment_or_item"), "s") == "concat_ws(' | ', CAST(s.`entity_id` AS STRING), CAST(s.`segment_or_item` AS STRING))"
    tables = _Tables(agent_ns, target=CORE + HISTORY, profile={"id_unique": False, "label_unique": True})
    tables.run()
    assert tables.index("SELECT k AS record_key") is None, "a key the profile proved unique needs no second check"
    assert "AS p ON p.record_key = CAST(s.`entity_label` AS STRING)" in tables.spark.statements[tables.index("MERGE INTO")]
    fallback = _Tables(agent_ns, target=CORE + HISTORY, profile={"id_unique": False, "label_unique": False})
    fallback.run()
    assert fallback.spark.statements[fallback.index("SELECT k AS record_key")] == (
        "SELECT k AS record_key, COUNT(*) AS row_count FROM (SELECT concat_ws(' | ', CAST(`entity_id` AS STRING), "
        f"CAST(`segment_or_item` AS STRING)) AS k FROM {QUOTED_STAGE}) GROUP BY k HAVING COUNT(*) > 1 OR k IS NULL OR TRIM(k) = '' "
        "LIMIT 3")


def test_an_older_table_follows_the_run_s_types_and_keeps_its_other_columns(agent_ns):
    stage = CORE + [("lift", "double")]
    tables = _Tables(agent_ns, stage=stage, target=LEGACY + HISTORY, properties={"inspire.replace_edits": "true"})
    _rows, printed = tables.run()
    retype = [s for s in tables.spark.statements if s.startswith(f"CREATE OR REPLACE TABLE {QUOTED}")]
    assert len(retype) == 1 and retype[0].startswith(
        f"CREATE OR REPLACE TABLE {QUOTED} TBLPROPERTIES ('inspire.replace_edits' = 'true') AS SELECT ")
    assert "CAST(r.`explanation`.result AS STRING) AS `explanation`" in retype[0], "a struct explanation becomes its result text"
    assert retype[0].endswith(f"FROM {QUOTED} AS r") and "r.`legacy_note`" in retype[0] and "r.`is_current`" in retype[0]
    added = [s for s in tables.spark.statements if "ADD COLUMN `lift`" in s]
    assert added == [f"ALTER TABLE {QUOTED} ADD COLUMN `lift` double"]
    assert tables.index(f"DESCRIBE HISTORY {QUOTED}") < tables.spark.statements.index(retype[0])
    assert any("converted explanation (struct<result:string,errorMessage:string> to string)" in p for p in printed)
    assert any(p == f"Business output: kept legacy_note in {TABLE}, which this run does not write, so its rows hold NULL there"
               for p in printed)
    change = agent_ns["inspire_type_change_sql"]
    sql, changed = change(TABLE, [("top_reasons", "string"), ("rank", "bigint"), ("same", "string")],
                          [("top_reasons", "array<string>"), ("rank", "int"), ("same", "STRING")], False)
    assert "IF(r.`top_reasons` IS NULL, NULL, array(r.`top_reasons`)) AS `top_reasons`" in sql
    assert "TRY_CAST(r.`rank` AS int) AS `rank`" in sql and "r.`same`" in sql and "'inspire.replace_edits' = 'false'" in sql
    assert changed == ["top_reasons (string to array<string>)", "rank (bigint to int)"]
    assert change(TABLE, [("a", "string")], [("a", "string")], False) == ("", [])


class _Frame:
    def __init__(self, fields):
        self.schema = types.SimpleNamespace(fields=[types.SimpleNamespace(name=n, dataType=types.SimpleNamespace(typeName=lambda t=t: t))
                                                    for n, t in fields])
        self.saved, self.cast = [], []
        frame = self

        class _Writer:
            def mode(self, value):
                frame.saved.append(("mode", value))
                return self

            def option(self, key, value):
                frame.saved.append(("option", key, value))
                return self

            def saveAsTable(self, name):
                frame.saved.append(("saveAsTable", name))

        self.write = _Writer()

    def withColumn(self, name, value):
        self.cast.append((name, value))
        return self

    def __getitem__(self, name):
        return types.SimpleNamespace(cast=lambda kind: f"{name}::{kind}")


def test_write_result_stages_the_rows_and_always_drops_the_stage(fresh_ns):
    fresh_ns["dbutils"] = types.SimpleNamespace(widgets=types.SimpleNamespace(get={}.__getitem__))
    tables = _Tables(fresh_ns, target=None)
    frame = _Frame([("entity_id", "string"), ("note", "void")])
    printed = []
    assert fresh_ns["inspire_write_result"](frame, "`main`.`inspire`.`churn_out`", spark_session=tables.spark, out=printed.append) == 3
    assert frame.saved == [("mode", "overwrite"), ("option", "overwriteSchema", "true"), ("saveAsTable", QUOTED_STAGE)]
    assert frame.cast == [("note", "note::string")], "a column of only NULLs is staged as text, since Delta stores no void column"
    assert tables.spark.statements[-1] == f"DROP TABLE IF EXISTS {QUOTED_STAGE}"
    broken = _Tables(fresh_ns, target=CORE + HISTORY, profile={"use_cases": 2})
    with pytest.raises(ValueError):
        fresh_ns["inspire_write_result"](_Frame([("entity_id", "string")]), TABLE, spark_session=broken.spark, out=printed.append)
    assert broken.spark.statements[-1] == f"DROP TABLE IF EXISTS {QUOTED_STAGE}", "a refused run leaves no stage table behind"
    fresh_ns["dbutils"] = types.SimpleNamespace(widgets=types.SimpleNamespace(get={"currency": "USD"}.__getitem__))
    unpriced = _Tables(fresh_ns, target=None)
    with pytest.raises(ValueError, match="value_at_stake"):
        fresh_ns["inspire_write_result"](_Frame([("entity_id", "string")]), TABLE, spark_session=unpriced.spark, out=printed.append)
    assert unpriced.spark.statements[-1] == f"DROP TABLE IF EXISTS {QUOTED_STAGE}", \
        "a notebook built for the money at stake that writes no value_at_stake is refused"


def test_every_notebook_run_controls_cell_carries_the_writer(agent_ns):
    from v120_genie_support import build_inspire, make_uc
    inst = build_inspire(agent_ns)
    uc = make_uc()
    spec = inst._genie_notebook_spec(uc)
    source = inst._genie_run_controls_source(uc, spec, str(uc.get("genie_instruction") or ""))
    assert agent_ns["IMPLEMENT_RESULT_HISTORY_SOURCE"].strip() in source and "@@" not in source
    assert source.index("def inspire_write_result(") < source.index("\ninspire_main()")
    ns = {}
    exec(compile(source.rsplit("\ninspire_main()", 1)[0], "run_controls", "exec"), ns)
    for name in ("inspire_write_result", "inspire_merge_run", "inspire_mark_kept", "inspire_table_name", "inspire_main"):
        assert callable(ns[name]), name
    assert "inspire_ensure_history" not in ns and "inspire_ensure_actions" not in ns, "the run controls carry no migration"
    assert ns["INSPIRE_REPLACE_EDITS_PROPERTY"] == "inspire.replace_edits"
    rules = inst._genie_platform_rules(spec)
    assert agent_ns["GENIE_RESULT_HISTORY_RULE"] in rules and "rewrite the table once" not in rules
    mandate = inst._build_code_structure_mandate(spec)
    assert "written only with inspire_write_result" in mandate and "each run replaces only" not in mandate


def test_a_preview_whose_rows_are_not_current_versions_goes_back_to_genie(agent_ns):
    problems = agent_ns["implement_written_key_problems"](
        {"rows_written": 12, "as_of_date": "2026-10-01", "run_id": "r-1"}, "N01-U01",
        {"row_count": 12, "dated_rows": 12, "own_rows": 12, "current_rows": 0}, TABLE)
    assert problems == [f"of the 12 rows of run r-1, 12 are not the current version of the record in {TABLE}, so no output would show "
                        "such a row: write the business output only with inspire_write_result(frame, result_table) from the Run controls "
                        "cell, never with your own write"]
    ok = agent_ns["implement_written_key_problems"]({"rows_written": 12, "as_of_date": "2026-10-01", "run_id": "r-1"}, "N01-U01",
                                                    {"row_count": 12, "dated_rows": 12, "own_rows": 12, "current_rows": 12}, TABLE)
    assert ok == []


def test_the_read_back_counts_current_versions_only_on_a_table_that_keeps_history(agent_ns):
    plain = _inspire(agent_ns, FakeSpark(responder=lambda s: _describe(CORE) if s.startswith("DESCRIBE") else
                                         [{"row_count": 5, "dated_rows": 5, "own_rows": 5, "current_rows": 0}]))
    assert plain._implement_written_key_counts("N01-U01", TABLE, "r-1")["current_rows"] == 0
    assert "0 AS current_rows" in plain.spark.statements[-1], "a table Genie wrote itself has no current versions to count"
    kept = _inspire(agent_ns, FakeSpark(responder=lambda s: _describe(CORE + HISTORY) if s.startswith("DESCRIBE") else
                                        [{"row_count": 5, "dated_rows": 5, "own_rows": 5, "current_rows": 5}]))
    assert kept._implement_written_key_counts("N01-U01", TABLE, "r-1") == {"row_count": 5, "dated_rows": 5, "own_rows": 5,
                                                                            "current_rows": 5}
    assert "COUNT_IF(is_current AND change_source = 'run') AS current_rows" in kept.spark.statements[-1]


def _upgrade_flow(agent_ns, record, extra_status=None):
    inst = _probe_inspire(agent_ns, None, dict({"dashboard": {"state": "ready", "spec_version": 2}}, **(extra_status or {})))
    inst._implement_carried = lambda t: ({"notebook_path": "/W/nb", "job_id": 77, "result_rows": 40, "dashboard_id": "d1"},
                                         {"notebook": record, "dashboard": {"state": "ready", "spec_version": 2}})
    calls = []
    inst._implement_notebook_modified_at = lambda path: 1000
    inst._implement_claim_notebook = lambda use_case, spec, key, asset_status, current="": "/W/nb"
    inst._implement_runner = lambda uc: "runner"
    inst._implement_write_notebook = lambda uc, spec, previous, key, current="": calls.append(("write", uc.get("_history_upgrade"), previous)) or "/W/nb"
    inst._implement_refresh_run_controls = lambda uc_id, key, use_case, spec_nb, path, status, warnings: calls.append(("controls", path))
    inst._implement_fill_and_preview = lambda uc_id, key, use_case, spec, previous, path, names, runner, refill: (
        calls.append(("fill", previous is not None, refill)) or ({"status": "written", "rows_written": 12}, 77, {}))
    inst._implement_dashboard = lambda c, r: {"dashboard_id": "d1", "dashboard_url": "https://h/d"}
    inst._implement_genie_space = lambda c, r: {"genie_space_id": "g1", "genie_space_url": "https://h/genie/rooms/g1"}
    inst._implement_app = lambda c, r: {"app_name": "churn-desk", "app_url": "https://churn-desk.example", "app_health": "running"}
    got = inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": dict(VALID)},
                                     (5150, "N01-U01", 3))
    return inst, calls, got


def test_a_notebook_built_before_the_change_history_is_rebuilt_on_its_own_cells(agent_ns, sdk_stub):
    inst, calls, got = _upgrade_flow(agent_ns, {"modified_at": 1000, "spec_version": 2})
    assert got == "ready", inst.updates[-1]
    assert calls[0][0] == "write" and calls[0][1] is True and calls[0][2] is not None, \
        "Genie keeps its cells and is told to move its write step to inspire_write_result"
    assert calls[1] == ("fill", True, True)
    assert any(e.get("step_name") == "Plan" and "so Genie updates its write step" in e.get("message", "") for e in inst.emitted)
    assert inst.updates[-1]["asset_status"]["notebook"]["result_history"] == agent_ns["IMPLEMENT_RESULT_HISTORY"]
    _inst, kept_calls, kept = _upgrade_flow(agent_ns, {"modified_at": 1000, "spec_version": 2,
                                                       "result_history": agent_ns["IMPLEMENT_RESULT_HISTORY"]})
    assert kept == "ready" and kept_calls == [("controls", "/W/nb"), ("fill", True, False)], \
        "a notebook that already writes through inspire_write_result is kept when only the outputs change"


def test_the_rewritten_instruction_tells_genie_to_move_its_write_step(agent_ns, sdk_stub):
    spec = agent_ns["validate_implement_spec"](VALID)[0]
    choice = agent_ns["IMPLEMENT_HISTORY_UPGRADE_CHOICE"]
    for upgrade in (True, False):
        workspace = _NotebookWorkspace(None, modified_at=None)
        _notebook_inspire(agent_ns, workspace)._implement_write_notebook(
            {"No": "N01-U01", "genie_instruction": "Build", "_history_upgrade": upgrade}, spec, None, (5150, "N01-U01", 1))
        text = workspace.imported[-1]["cells"][1]["source"][0]
        assert (choice in text) is upgrade
        if upgrade:
            assert text.index("## Implementation Choices") < text.index(choice)


def test_app_options_parse_with_decisions_on_by_default_and_drive_the_edit_setting(agent_ns):
    spec, errors = _spec(agent_ns)
    assert errors == [] and spec["outputs"]["app_options"] == {"modify": False, "replace_edits": False, "decisions": True, "alerts": False}
    assert agent_ns["implement_replace_edits"](spec) is False
    chosen = _spec(agent_ns, outputs={**VALID["outputs"], "app_options": {"replace_edits": True, "modify": True}})[0]
    assert chosen["outputs"]["app_options"] == {"modify": True, "replace_edits": True, "decisions": True, "alerts": False}
    off = _spec(agent_ns, outputs={**VALID["outputs"], "app_options": {"decisions": False}})[0]
    assert off["outputs"]["app_options"]["decisions"] is False, "a saved spec that turned decisions off keeps them off"
    assert "the App option modify must be true or false, not 'true'" in " ".join(
        _spec(agent_ns, outputs={**VALID["outputs"], "app_options": {"modify": "true"}})[1])
    assert agent_ns["implement_replace_edits"](chosen) is True
    assert "outputs.app_options must be an object" in _spec(agent_ns, outputs={**VALID["outputs"], "app_options": ["x"]})[1]
    assert agent_ns["implement_replace_edits_sql"](TABLE, True) == (
        f"ALTER TABLE {QUOTED} SET TBLPROPERTIES ('inspire.replace_edits' = 'true')")
    assert agent_ns["implement_replace_edits_sql"](TABLE, False).endswith("('inspire.replace_edits' = 'false')")


def test_the_build_records_the_edit_choice_on_the_table_and_warns_when_it_cannot(agent_ns):
    spec = _spec(agent_ns, outputs={**VALID["outputs"], "app_options": {"modify": True, "replace_edits": True}})[0]
    inst = _inspire(agent_ns, FakeSpark(responder=lambda s: _describe(CORE + HISTORY) if s.startswith("DESCRIBE") else []))
    warnings = []
    inst._implement_result_history("N01-U01", TABLE, spec, warnings)
    assert warnings == [] and inst.spark.statements[-1] == f"ALTER TABLE {QUOTED} SET TBLPROPERTIES ('inspire.replace_edits' = 'true')"
    missing = _inspire(agent_ns, FakeSpark(responder=lambda s: (_ for _ in ()).throw(RuntimeError("[TABLE_OR_VIEW_NOT_FOUND] x cannot be found"))))
    missing._implement_keep_edits_setting("N01-U01", TABLE, spec, warnings)
    assert warnings == [] and not any(s.startswith("ALTER") for s in missing.spark.statements), "a table no run made yet is left alone"

    def refuse(statement):
        if statement.startswith("ALTER TABLE"):
            raise RuntimeError("PERMISSION_DENIED: User is not an owner of Table main.inspire.churn_out")
        return _describe(CORE + HISTORY)

    denied = _inspire(agent_ns, FakeSpark(responder=refuse))
    denied._implement_keep_edits_setting("N01-U01", TABLE, spec, warnings)
    assert len(warnings) == 1 and warnings[0].startswith(
        "Result table: runs may not replace the records people changed in the App, as this use case asks: Inspire could not record "
        f"that choice on {TABLE}: PERMISSION_DENIED")


def test_the_build_keeps_the_history_before_any_output_reads_the_table(agent_ns, sdk_stub):
    events = []
    inst = _probe_inspire(agent_ns, None, {"dashboard": {"state": "ready", "spec_version": 2}})
    inst._implement_runner = lambda uc: "runner"
    inst._implement_claim_notebook = lambda use_case, spec, key, asset_status, current="": "/W/nb"
    inst._implement_notebook_modified_at = lambda path: 1000
    inst._implement_write_notebook = lambda uc, spec, previous, key, current="": "/W/nb"
    inst._implement_keep_edits_setting = lambda uc, table, spec, warnings, exists=None: events.append(("edit choice", table))
    inst._implement_fill_and_preview = lambda *a: events.append(("preview",)) or ({"status": "written", "rows_written": 12}, 77, {})
    inst._implement_result_history = lambda uc, table, spec, warnings: events.append(("history", table))
    inst._implement_reasons_view = lambda table, warnings: events.append(("reasons view", table)) or ""
    inst._implement_tier_warning = lambda uc, table, url, run_id=None: events.append(("tiers", table)) or ""
    inst._implement_dashboard = lambda c, r: events.append(("dashboard",)) or {"dashboard_id": "d1", "dashboard_url": "https://h/d"}
    inst._implement_genie_space = lambda c, r: {"genie_space_id": "g1", "genie_space_url": "https://h/genie/rooms/g1"}
    inst._implement_app = lambda c, r: {"app_name": "churn-desk", "app_url": "https://churn-desk.example", "app_health": "running"}
    spec = dict(VALID, config={**VALID["config"], "widgets": {"top_k": 30}})
    assert inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": spec},
                                      (5150, "N01-U01", 3)) == "ready"
    order = [e[0] for e in events]
    assert order[:5] == ["edit choice", "preview", "history", "reasons view", "tiers"], order
    assert ("history", TABLE) in events and order.index("history") < order.index("dashboard")


def test_moving_the_result_table_is_found_against_the_last_ready_version(agent_ns):
    move = agent_ns["implement_result_table_move"]
    default = "`main`.`inspire`.`_inspire_n01_u01_predict_churn`"
    before = _spec(agent_ns)[0]
    moved = _spec(agent_ns, config={**VALID["config"], "result_table": "main.sales.churn_v2"})[0]
    unset = _spec(agent_ns, config={**VALID["config"], "result_table": ""})[0]
    assert move(before, moved, default) == (TABLE, "main.sales.churn_v2")
    assert move(unset, moved, default) == ("main.inspire._inspire_n01_u01_predict_churn", "main.sales.churn_v2")
    assert move(moved, unset, default) == ("main.sales.churn_v2", "main.inspire._inspire_n01_u01_predict_churn")
    assert move(before, _spec(agent_ns, config={**VALID["config"], "result_table": "`MAIN`.`inspire`.`CHURN_OUT`"})[0], default) is None
    assert move(None, moved, default) is None, "a first build moves nothing"
    assert agent_ns["implement_result_copy_sql"](TABLE, "main.sales.churn_v2") == (
        f"CREATE TABLE `main`.`sales`.`churn_v2` DEEP CLONE {QUOTED}")


def test_a_moved_result_table_is_shared_again(agent_ns):
    plan = agent_ns["implement_plan"]
    assets = {"dashboard": "d1", "genie_space": "g1", "app": "churn-desk", "preview_run_id": 5}
    before = _spec(agent_ns)[0]
    moved = _spec(agent_ns, config={**VALID["config"], "result_table": "main.sales.churn_v2"})[0]
    widgets = _spec(agent_ns, config={**VALID["config"], "widgets": {"top_k": 30}})[0]
    same = _spec(agent_ns, config={**VALID["config"], "result_table": "`main`.`inspire`.`CHURN_OUT`"})[0]
    assert plan(before, moved, assets, has_built_notebook=True)["sharing"] is True, \
        "the people the use case is shared with keep access when its results move"
    assert plan(before, widgets, assets, has_built_notebook=True)["sharing"] is False, "another config change shares nothing again"
    assert plan(before, same, assets, has_built_notebook=True)["sharing"] is False


@pytest.mark.parametrize("old_exists,new_exists,fail,status,needle,warned", [
    (True, False, None, "ended_success", f"copied the full change history of {TABLE} to main.sales.churn_v2; {TABLE} is kept as it was",
     False),
    (False, False, None, "ended_success", f"{TABLE} holds no results yet, so there is no change history to copy to main.sales.churn_v2",
     False),
    (True, True, None, "ended_warning", f"main.sales.churn_v2 already exists, so Inspire left it as it is and copied no change history "
                                        f"from {TABLE} into it; {TABLE} is kept as it was", True),
    (True, False, "CREATE TABLE", "ended_warning", f"the change history of {TABLE} could not be copied to main.sales.churn_v2, so "
                                                   f"main.sales.churn_v2 starts with the next run; {TABLE} is kept as it was: "
                                                   "PERMISSION_DENIED", True),
])
def test_moving_the_result_table_copies_its_history_and_keeps_the_old_one(agent_ns, old_exists, new_exists, fail, status, needle,
                                                                         warned):
    def respond(statement):
        if fail and statement.startswith(fail):
            raise RuntimeError("PERMISSION_DENIED: no CREATE TABLE on main.sales")
        if statement == f"DESCRIBE TABLE {QUOTED}":
            return _describe(CORE + HISTORY) if old_exists else (_ for _ in ()).throw(RuntimeError("[TABLE_OR_VIEW_NOT_FOUND]"))
        if statement == "DESCRIBE TABLE `main`.`sales`.`churn_v2`":
            return _describe(CORE + HISTORY) if new_exists else (_ for _ in ()).throw(RuntimeError("[TABLE_OR_VIEW_NOT_FOUND]"))
        return []

    inst = _inspire(agent_ns, FakeSpark(responder=respond))
    warnings = []
    inst._implement_move_result_table("N01-U01", (5150, "N01-U01", 3), TABLE, "main.sales.churn_v2", warnings)
    copies = [s for s in inst.spark.statements if "DEEP CLONE" in s]
    assert copies == ([f"CREATE TABLE `main`.`sales`.`churn_v2` DEEP CLONE {QUOTED}"] if old_exists and not new_exists else [])
    assert not any(s.startswith(("DROP", "DELETE", "CREATE OR REPLACE")) for s in inst.spark.statements), "the old table is kept"
    ended = [e for e in inst.emitted if e["step_name"] == "Result table" and e["status"] != "started"]
    assert len(ended) == 1 and ended[0]["status"] == status and ended[0]["message"].startswith(needle)
    assert ended[0]["result_json"]["from"] == TABLE and ended[0]["result_json"]["to"] == "main.sales.churn_v2"
    assert any(level == "WARNING" and msg.startswith(f"[IMPLEMENT-RESULT-MOVE] N01-U01: {needle}") for level, msg in inst.logger.records), \
        "the move is logged as a warning naming both tables"
    assert bool(warnings) is warned and all(w.startswith("Result table: ") for w in warnings)


def test_moving_off_a_table_another_session_also_names_copies_none_of_its_rows(agent_ns):
    asked = []

    def respond(statement):
        if statement == f"DESCRIBE TABLE {QUOTED}":
            return _describe(CORE + HISTORY)
        if statement == "DESCRIBE TABLE `main`.`sales`.`churn_v2`":
            raise RuntimeError("[TABLE_OR_VIEW_NOT_FOUND]")
        if "spec_json:config.result_table" in statement:
            asked.append(statement)
            return [{"session_id": "2222222222222222222", "use_case_id": "N01-U01"}]
        return []

    inst = _inspire(agent_ns, FakeSpark(responder=respond))
    warnings = []
    inst._implement_move_result_table("N01-U01", (5150, "N01-U01", 3), TABLE, "main.sales.churn_v2", warnings)
    assert [s for s in inst.spark.statements if "DEEP CLONE" in s] == [], \
        "rows of the same use case id from another session would show in this use case's App, so nothing is copied"
    assert len(asked) == 1 and "FROM `main`.`inspire`.__inspire_implement" in asked[0] \
        and "AND NOT (session_id = :sid AND use_case_id = :uc)" in asked[0]
    ended = [e for e in inst.emitted if e["step_name"] == "Result table" and e["status"] != "started"]
    assert [(e["status"], e["message"]) for e in ended] == [(
        "ended_success",
        f"{TABLE} also holds the results of use case N01-U01 of session 2222222222222222222, so Inspire copied none of its rows to "
        f"main.sales.churn_v2; main.sales.churn_v2 starts with the next run, and {TABLE} is kept as it was")]
    assert warnings == [], "leaving a shared table is the fix, not a problem to warn about"
    assert not any(s.startswith(("DROP", "DELETE", "CREATE OR REPLACE")) for s in inst.spark.statements)

    alone = _inspire(agent_ns, FakeSpark(responder=lambda s: [] if "spec_json:config.result_table" in s else respond(s)))
    alone._implement_move_result_table("N01-U01", (5150, "N01-U01", 3), TABLE, "main.sales.churn_v2", [])
    assert [s for s in alone.spark.statements if "DEEP CLONE" in s] == [f"CREATE TABLE `main`.`sales`.`churn_v2` DEEP CLONE {QUOTED}"]


@pytest.mark.parametrize("old_summary,new_summary,fail,clones,status,tail", [
    (True, False, None, 2, "ended_success", "; copied the AI summaries of its runs to main.sales.churn_v2_summary"),
    (False, False, None, 1, "ended_success", ""),
    (True, True, None, 1, "ended_success", ""),
    (True, False, "CREATE TABLE `main`.`sales`.`churn_v2_summary`", 2, "ended_warning",
     "; the AI summaries of its earlier runs stay in main.inspire.churn_out_summary, and main.sales.churn_v2_summary starts with "
     "the next run: PERMISSION_DENIED: no CREATE TABLE on main.sales"),
])
def test_moving_the_result_table_carries_the_ai_summaries_of_its_runs(agent_ns, old_summary, new_summary, fail, clones, status, tail):
    present = {QUOTED: True, "`main`.`sales`.`churn_v2`": False, "`main`.`inspire`.`churn_out_summary`": old_summary,
               "`main`.`sales`.`churn_v2_summary`": new_summary}

    def respond(statement):
        if fail and statement.startswith(fail):
            raise RuntimeError("PERMISSION_DENIED: no CREATE TABLE on main.sales")
        for name, exists in present.items():
            if statement == f"DESCRIBE TABLE {name}":
                return _describe(CORE + HISTORY) if exists else (_ for _ in ()).throw(RuntimeError("[TABLE_OR_VIEW_NOT_FOUND]"))
        return []

    inst = _inspire(agent_ns, FakeSpark(responder=respond))
    warnings = []
    inst._implement_move_result_table("N01-U01", (5150, "N01-U01", 3), TABLE, "main.sales.churn_v2", warnings)
    copies = [s for s in inst.spark.statements if "DEEP CLONE" in s]
    assert copies == [f"CREATE TABLE `main`.`sales`.`churn_v2` DEEP CLONE {QUOTED}",
                      "CREATE TABLE `main`.`sales`.`churn_v2_summary` DEEP CLONE `main`.`inspire`.`churn_out_summary`"][:clones]
    ended = [e for e in inst.emitted if e["step_name"] == "Result table" and e["status"] != "started"][0]
    assert ended["status"] == status
    assert ended["message"] == f"copied the full change history of {TABLE} to main.sales.churn_v2; {TABLE} is kept as it was" + tail
    assert bool(warnings) is (status == "ended_warning")


def test_a_build_that_moves_the_result_table_copies_it_before_the_preview(agent_ns, sdk_stub):
    events = []
    inst = _probe_inspire(agent_ns, None, {"dashboard": {"state": "ready", "spec_version": 2}})
    inst._implement_runner = lambda uc: "runner"
    inst._implement_claim_notebook = lambda use_case, spec, key, asset_status, current="": "/W/nb"
    inst._implement_notebook_modified_at = lambda path: 1000
    inst._implement_write_notebook = lambda uc, spec, previous, key, current="": events.append(("write", uc["result_table"])) or "/W/nb"
    inst._implement_move_result_table = lambda uc, key, old, new, warnings: events.append(("move", old, new))
    inst._implement_keep_edits_setting = lambda uc, table, spec, warnings, exists=None: events.append(("edit choice", table))
    inst._implement_fill_and_preview = lambda *a: events.append(("preview",)) or ({"status": "written", "rows_written": 12}, 77, {})
    inst._implement_result_history = lambda uc, table, spec, warnings: events.append(("history", table))
    inst._implement_dashboard = lambda c, r: {"dashboard_id": "d1", "dashboard_url": "https://h/d"}
    inst._implement_genie_space = lambda c, r: {"genie_space_id": "g1", "genie_space_url": "https://h/genie/rooms/g1"}
    inst._implement_app = lambda c, r: {"app_name": "churn-desk", "app_url": "https://churn-desk.example", "app_health": "running"}
    spec = dict(VALID, config={**VALID["config"], "result_table": "main.sales.churn_v2"})
    assert inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": spec},
                                      (5150, "N01-U01", 3)) == "ready"
    assert events[:5] == [("move", TABLE, "main.sales.churn_v2"), ("write", "main.sales.churn_v2"),
                          ("edit choice", "main.sales.churn_v2"), ("preview",), ("history", "main.sales.churn_v2")]


def test_the_reasons_view_gains_the_history_columns_without_losing_its_grants(agent_ns):
    old = [("as_of_date", "date"), ("run_id", "string"), ("reason_position", "int"), ("reason", "string")]
    view = "DESCRIBE TABLE `main`.`inspire`.`churn_out_reasons`"
    legacy = _inspire(agent_ns, FakeSpark(responder=lambda s: _describe(old) if s == view else []))
    assert legacy._implement_reasons_view(TABLE, []) == "main.inspire.churn_out_reasons"
    assert legacy.spark.statements[-1] == agent_ns["implement_reasons_view_alter_sql"](TABLE)
    assert legacy.spark.statements[-1].startswith("ALTER VIEW `main`.`inspire`.`churn_out_reasons` AS SELECT ")
    assert not any("CREATE OR REPLACE VIEW" in s for s in legacy.spark.statements), "replacing the view would drop its grants"
    current = old[:2] + [(n, "string") for n in agent_ns["IMPLEMENT_REASONS_HISTORY_COLUMNS"]] + old[2:]
    fresh = _inspire(agent_ns, FakeSpark(responder=lambda s: _describe(current) if s == view else []))
    assert fresh._implement_reasons_view(TABLE, []) == "main.inspire.churn_out_reasons"
    assert not any(s.startswith("ALTER VIEW") for s in fresh.spark.statements)


def test_the_output_prompts_name_the_change_history(agent_ns, tmp_path):
    from v140_implement_test import _output_context, _output_inspire
    inst, _calls = _output_inspire(agent_ns, tmp_path)
    brief = inst._implement_use_case_brief(_output_context(agent_ns))
    assert ("Change history: the table keeps every version of each record in record_key, valid_from, valid_to, is_current, "
            "change_source, changed_by") in brief
    assert f"The current rows, which people act on, are WHERE {CURRENT}" in brief
    assert "Never take the newest as_of_date for the latest run." in brief


HISTORY_OBJECTS = {"{inspire_table_name(table)}", "{inspire_table_name(inspire_run_log_table(table))}", "{log}", "{inspire_table_name(stage)}",
                   "{target}",
                   "{source}", "{inspire_ai_work_table(table, suffix, 'work')}", "{inspire_ai_work_table(table, suffix, 'reply')}",
                   "{inspire_ai_work_table(table, suffix, 'checked')}", "{inspire_ai_work_table(table, suffix, part)}",
                   "{inspire_table_name(inspire_ai_summary_table(table))}", "{inspire_table_name(inspire_assumptions_table(table))}",
                   "{pinned}", "{inspire_table_name(inspire_acted_table(table))}", "{inspire_table_name(inspire_closed_table(table))}",
                   "{inspire_table_name(inspire_closes_table(table))}",
                   "{inspire_table_name(result_table)}", "{inspire_table_name(inspire_run_log_table(result_table))}",
                   "{inspire_table_name(inspire_ai_summary_table(result_table))}",
                   "{inspire_table_name(inspire_assumptions_table(result_table))}",
                   "{inspire_table_name(inspire_sibling_table(result_table, suffix))}",
                   "{inspire_table_name(inspire_scenarios_table(result_table))}",
                   "{inspire_table_name(inspire_changes_table(table))}"}
HISTORY_BOUND = {"target": "inspire_table_name(table)", "source": "inspire_table_name(stage)",
                 "log": "inspire_table_name(inspire_run_log_table(table))", "pinned": "f'{target} VERSION AS OF {int(version)}'"}
FACTS_TABLES = {"target": "inspire_table_name(table)", "pinned": "f'{target} VERSION AS OF {int(version)}'",
                "log": "inspire_run_log_table(table)", "ledger": "inspire_shell_facts.ledger_table(database)"}
FACTS_PLAIN = {"names", "tier", "scope", "version", "previous", "label", "history", "bool", "inspire_sql_literal", "inspire_table_name",
               "inspire_shell_facts", "floored", "int", "str", "table", "inspire_acted_table", "inspire_closed_table", "inspire_changes_table",
               "inspire_closes_table", "order", "row"}
HISTORY_COUNTED = "{inspire_table_name(read_table)}"
# REQ-022 L1: the scoped source of the First run and run-time reads is read through inspire_scoped_from (the Table Scope), not the bare table.
HISTORY_SCOPED = "{inspire_scoped_from(source_table)}"
HISTORY_SCOPED_READS = ("SELECT CAST(", "WITH dated AS (SELECT CAST(")
HISTORY_DATED = "{inspire_scoped_from(via['table'])}"  # REQ-022 L1: the via table of a run-time read is scoped too
HISTORY_DATED_READS = (f"SELECT CAST(r.{{inspire_column(via['date'])}} AS DATE) AS d FROM {HISTORY_SCOPED} m JOIN {HISTORY_DATED} r ON ",
                       f"SELECT DISTINCT CAST({{inspire_column(via['key'])}} AS STRING) AS k FROM {HISTORY_DATED} WHERE ")  # the via key read is scoped too (REQ-022 L1 rule)
HISTORY_JOINED = "{inspire_table_name(join['table'])}"
HISTORY_JOINED_READS = (f"SELECT {{key}}, MAX({{value}}) AS {{named}} FROM (SELECT CAST({{ref}} AS STRING) AS {{key}}, {{named}} AS {{value}} "
                        f"FROM {HISTORY_JOINED} WHERE ",)
KPI_READ = ("inspire_save_kpi", "spark.sql(query)", {"str(kpi.get('query') or '')"}, "_inspire_re.fullmatch(INSPIRE_KPI_QUERY, query)")
SHARE_GRANT = ("inspire_share_outputs", "spark.sql(statement)", "GRANT SELECT ON TABLE ")
HISTORY_CLONED = {"{inspire_table_name(table)}", "{inspire_table_name(result_table)}"}
CLONE_SOURCE = re.compile(rf"\bCLONE\s+({guard.TARGET})", re.I)
ENSURE = "def inspire_ensure_ai(spark, table, schema, ai, out=print):\n"
USER_TABLE = "{build_fqn(catalog, schema, name)}"


def _runtime_texts():
    found, unreadable = guard.runtime_sources(agent_source())
    assert not unreadable, f"the agent compiles a source the guard cannot read: {unreadable}"
    return {name: text for name, (text, _space) in found.items()}


def _bound(scope, name):
    found = set()
    for node in ast.walk(scope):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Tuple) and isinstance(node.value, ast.Tuple):
                    pairs = zip(target.elts, node.value.elts)
                else:
                    pairs = [(part, node.value) for part in (target.elts if isinstance(target, ast.Tuple) else [target])]
                found |= {ast.unparse(value) for part, value in pairs if isinstance(part, ast.Name) and part.id == name}
    return found


def _history_problems(history):
    tree = ast.parse(history)
    functions = {node.name: node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)}
    executed, unresolved, bad, frames = guard.audit(history)
    problems = [f"reads rows through the DataFrame API: {frame}" for frame in frames]
    share = functions.get(SHARE_GRANT[0])
    grant_lines = {node.lineno for node in ast.walk(share) if isinstance(node, ast.Call) and ast.unparse(node) == SHARE_GRANT[1]} \
        if share is not None else set()
    problems += [f"{SHARE_GRANT[0]} runs {' '.join(sql.split()[:4])}" for line, sql in executed
                 if line in grant_lines and not sql.startswith(SHARE_GRANT[2])]
    problems += [f"{kind} {target}" for _, kind, target, sql in bad if target not in HISTORY_OBJECTS
                 and not (kind == "read" and target == HISTORY_COUNTED and sql.startswith(f"SELECT COUNT(*) AS n FROM {HISTORY_COUNTED}"))
                 and not (kind == "read" and target == HISTORY_SCOPED and sql.startswith(HISTORY_SCOPED_READS))
                 and not (kind == "read" and target == HISTORY_DATED and sql.startswith(HISTORY_DATED_READS))
                 and not (kind == "read" and target == HISTORY_JOINED and sql.startswith(HISTORY_JOINED_READS))]
    for _, sql, _, function in guard.SqlIndex(tree).sql_literals():
        scope = functions.get(function, tree)
        problems += [f"{{{name}}} in {function} is {sorted(_bound(scope, name))}" for name, bound in HISTORY_BOUND.items()
                     if f"{{{name}}}" in sql and _bound(scope, name) != {bound}]
        problems += [f"clones {found}" for found in CLONE_SOURCE.findall(sql) if found not in HISTORY_CLONED]
    for line, function, call, _ in unresolved:
        if _facts_built(functions.get(function, tree), line):
            continue
        if (function, call) == KPI_READ[:2] and _bound(functions[function], "query") == KPI_READ[2] \
                and KPI_READ[3] in ast.unparse(functions[function]):
            continue
        name = re.fullmatch(r"spark\.sql\((\w+)\)", call)
        built = {node.targets[0].elts[0].id for node in ast.walk(functions.get(function, tree)) if isinstance(node, ast.Assign)
                 and isinstance(node.targets[0], ast.Tuple) and isinstance(node.targets[0].elts[0], ast.Name)
                 and isinstance(node.value, ast.Call) and getattr(node.value.func, "id", None) in functions}
        if not name or name.group(1) not in built:
            problems.append(f"untraced {call} in {function}")
    return sorted(set(problems))


def _facts_built(scope, line) -> bool:
    calls = [node for node in ast.walk(scope) if isinstance(node, ast.Call) and getattr(node, "lineno", None) == line
             and ast.unparse(node.func) == "spark.sql"]
    if len(calls) != 1:
        return False
    built = {node.targets[0].id: node.value for node in ast.walk(scope) if isinstance(node, ast.Assign) and len(node.targets) == 1
             and isinstance(node.targets[0], ast.Name)}
    argument = calls[0].args[0]
    if isinstance(argument, ast.Name) and argument.id in built:
        argument = built[argument.id]
    facts = [node for node in ast.walk(argument) if isinstance(node, ast.Call) and ast.unparse(node.func).startswith("inspire_shell_facts.")]
    if not facts:
        return False
    names = {node.id for node in ast.walk(argument) if isinstance(node, ast.Name)}
    tables = {name for name in names if name not in FACTS_PLAIN}
    return all(_bound(scope, name) == {FACTS_TABLES.get(name)} for name in tables) and all(name in FACTS_TABLES for name in tables)


def _clone_sources(tree):
    return {(function, found) for _, sql, _, function in guard.SqlIndex(tree).sql_literals() for found in CLONE_SOURCE.findall(sql)}


@pytest.fixture(scope="module")
def agent_tree():
    return ast.parse(agent_source())


@pytest.fixture(scope="module")
def history_source():
    return _runtime_texts()["IMPLEMENT_RESULT_HISTORY_SOURCE"]


def test_the_history_helpers_touch_only_the_result_table_its_run_log_and_its_stage(history_source):
    sources = _runtime_texts()
    assert {"IMPLEMENT_RESULT_HISTORY_SOURCE", "GENIE_NUMBER_TEXT_SOURCE", "_JOB_LAUNCHER_CLASS_SOURCE"} <= set(sources)
    hidden = {name: len(guard.audit(text)[0]) for name, text in sources.items() if name != "IMPLEMENT_RESULT_HISTORY_SOURCE"}
    assert not any(hidden.values()), f"exec'd source runs SQL the metadata guard does not check: {hidden}"
    assert len(guard.audit(history_source)[0]) >= 10, "the guard no longer extracts the history statements"
    assert _history_problems(history_source) == []
    write = next(node for node in ast.walk(ast.parse(history_source)) if isinstance(node, ast.FunctionDef)
                 and node.name == "inspire_write_result")
    assert _bound(write, "stage") == {"f'{catalog}.{schema}.{name}_inspire_stage'"}
    assert _bound(write, "table") == {"f'{catalog}.{schema}.{name}'"}
    assert _bound(write, "catalog") == {"inspire_table_parts(result_table)"}


@pytest.mark.parametrize("line,problem", [
    (f'    spark.sql(f"SELECT * FROM {USER_TABLE} LIMIT 5")\n', f"read {USER_TABLE}"),
    (f'    spark.sql(f"CREATE OR REPLACE TABLE {{inspire_table_name(table)}} DEEP CLONE {USER_TABLE}")\n', f"clones {USER_TABLE}"),
    (f'    target = {USER_TABLE[1:-1]}\n    spark.sql(f"SELECT COUNT(*) AS n FROM {{target}}")\n',
     "{target} in inspire_ensure_ai is ['build_fqn(catalog, schema, name)']"),
    ('    statement, _ = build_statement(table)\n    spark.sql(statement)\n', "untraced spark.sql(statement) in inspire_ensure_ai"),
    ('    name, query = "x", str(kpi.get("query") or "")\n    spark.sql(query)\n', "untraced spark.sql(query) in inspire_ensure_ai"),
    (f'    spark.sql(f"SELECT * FROM {{inspire_ai_work_table({USER_TABLE[1:-1]}, suffix, \'work\')}}")\n',
     f"read {{inspire_ai_work_table({USER_TABLE[1:-1]}, suffix, 'work')}}"),
    (f'    spark.sql(f"MERGE INTO {{inspire_table_name(inspire_ai_summary_table({USER_TABLE[1:-1]}))}} AS s USING '
     f'{{inspire_table_name(table)}} AS n ON 1 = 1")\n',
     f"write {{inspire_table_name(inspire_ai_summary_table({USER_TABLE[1:-1]}))}}"),
    (f'    spark.sql(f"SELECT * FROM {HISTORY_COUNTED} LIMIT 5")\n', f"read {HISTORY_COUNTED}"),
    (f'    spark.sql(f"INSERT INTO {HISTORY_COUNTED} SELECT 1")\n', f"write {HISTORY_COUNTED}"),
    (f'    spark.sql(f"SELECT * FROM {HISTORY_SCOPED} LIMIT 5")\n', f"read {HISTORY_SCOPED}"),
    (f'    spark.sql(f"INSERT INTO {HISTORY_SCOPED} SELECT 1")\n', f"write {HISTORY_SCOPED}"),
    (f'    spark.sql(f"SELECT * FROM {HISTORY_DATED} LIMIT 5")\n', f"read {HISTORY_DATED}"),
    (f'    spark.sql(f"INSERT INTO {HISTORY_DATED} SELECT 1")\n', f"write {HISTORY_DATED}"),
    (f'    spark.sql(f"SELECT * FROM {HISTORY_JOINED} LIMIT 5")\n', f"read {HISTORY_JOINED}"),
    (f'    spark.sql(f"INSERT INTO {HISTORY_JOINED} SELECT 1")\n', f"write {HISTORY_JOINED}"),
])
def test_the_history_guard_rejects_any_other_object(history_source, line, problem):
    assert history_source.count(ENSURE) == 1
    assert _history_problems(history_source.replace(ENSURE, ENSURE + line)) == [problem]


def test_the_agent_clones_only_the_result_table_it_built_before(agent_tree):
    assert _clone_sources(agent_tree) == {("implement_result_copy_sql", "{inspire_table_name(previous_result_table)}")}
    source = agent_source()
    old = "DEEP CLONE {inspire_table_name(previous_result_table)}"
    assert source.count(old) == 1
    injected = ast.parse(source.replace(old, f"DEEP CLONE {USER_TABLE}"))
    assert _clone_sources(injected) == {("implement_result_copy_sql", USER_TABLE)}


def test_the_first_run_reads_a_source_table_only_for_group_counts_newest_dates_and_through_the_one_read_helper(history_source):
    tree = ast.parse(history_source)
    functions = {node.name: node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)}
    scoped = sorted(name for name, node in functions.items() if HISTORY_SCOPED in ast.unparse(node))
    assert scoped == ["inspire_scope_groups_sql", "inspire_scope_recent_sql"], scoped
    frames = sorted({owner for owner, node in ((name, node) for name, function in functions.items() for node in ast.walk(function))
                     if isinstance(node, ast.Attribute) and node.attr in ("table", "read", "readStream") and ast.unparse(node.value) != "dbu.widgets"})
    assert frames == ["inspire_read_source"], frames


def test_the_share_step_only_grants_select_on_the_tables_its_plan_lists(history_source):
    assert _history_problems(history_source) == []
    granted = 'f"GRANT SELECT ON TABLE {inspire_table_name(name)} TO {inspire_quote_principal(p)}"'
    assert granted in history_source
    share = next(node for node in ast.walk(ast.parse(history_source)) if isinstance(node, ast.FunctionDef) and node.name == SHARE_GRANT[0])
    loop = next(node.lineno for node in ast.walk(share) if isinstance(node, ast.Call) and ast.unparse(node) == SHARE_GRANT[1])
    assert any(line == loop and sql.startswith(SHARE_GRANT[2]) for line, sql in guard.audit(history_source)[0])
    for bad, verb in (('f"GRANT MODIFY ON TABLE {inspire_table_name(name)} TO {inspire_quote_principal(p)}"', "GRANT MODIFY ON TABLE"),
                      ('f"DROP TABLE {inspire_table_name(name)}"', "DROP TABLE"), ('f"SELECT * FROM {inspire_table_name(name)}"', "SELECT * FROM")):
        assert any(problem.startswith(f"{SHARE_GRANT[0]} runs {verb}") for problem in _history_problems(history_source.replace(granted, bad))), bad
    rebound = history_source.replace("    plan = inspire_share_plan(table, existing, grants, reads)\n", "    plan = list(names)\n")
    assert rebound != history_source and _history_problems(rebound) == ["untraced spark.sql(statement) in inspire_share_outputs"]


def test_the_kpi_step_is_the_one_read_of_source_rows_and_only_after_its_query_is_one_select(history_source):
    tree = ast.parse(history_source)
    save = next(node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef) and node.name == "inspire_save_kpi")
    assert _bound(save, "query") == KPI_READ[2] and KPI_READ[3] in ast.unparse(save)
    unguarded = history_source.replace("if kpi.get(\"computable\") and _inspire_re.fullmatch(INSPIRE_KPI_QUERY, query):",
                                       "if kpi.get(\"computable\"):")
    assert unguarded != history_source
    assert _history_problems(unguarded) == ["untraced spark.sql(query) in inspire_save_kpi"], "a KPI query run without the SELECT check is refused"
    rebound = history_source.replace('name, query = " ".join(str(kpi["name"]).split()), str(kpi.get("query") or "")',
                                     'name, query = " ".join(str(kpi["name"]).split()), str(run.get("sql") or "")')
    assert rebound != history_source and _history_problems(rebound) == ["untraced spark.sql(query) in inspire_save_kpi"]
