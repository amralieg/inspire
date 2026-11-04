"""v1.2.0 ARTIFACTS lane: __inspire_usecases persistence.

D1-05 Quality label persisted, the Ultra High fields (quality_mode, elite_status, elite_score,
elite_assessment JSON) and selection_flags JSON; D1-06 code_structure_mandate persisted; D1-04 the
session replace is one Delta transaction with surfaced failure; D1-18 identifiers quoted; D1-20
migration failures surfaced; the step payload carries the same fields and never fabricates 0 scores.
Every behavioural test fails on the base notebook (3e2543e).
"""
import json
import sys

import pytest

from v120_artifacts_support import FakeSpark, elite_assessment, make_inspire, make_uc

NEW_COLUMNS = ["code_structure_mandate", "quality", "quality_mode", "elite_status", "elite_score",
               "elite_assessment", "selection_flags"]
V130_COLUMNS = ["strategy_alignment", "strategy_path", "kpis", "expected_key_results", "measures_of_success",
                "financial_benefits", "non_financial_benefits", "data_evidence", "foundation_ids", "use_case_key",
                "best_of_best", "best_of_best_rank", "best_of_best_score", "best_of_best_reason", "table_joins",
                "use_case_kind", "kind_family", "app_layout", "serving_summary", "method_summary", "value_source", "selection_basis",
                "selection_replaced", "selection_score_gap", "name_with_technique", "suggested_group_by", "record_level",
                "meets_quality_bar", "below_bar_reason"]


@pytest.fixture
def functions_stub(monkeypatch):
    monkeypatch.setattr(sys.modules["pyspark.sql.functions"], "current_timestamp", lambda: "now", raising=False)


def _schema_names(ns):
    return [f.name for f in ns["DatabricksInspire"]._get_tracking_full_schema().fields]


def _row(ns, uc, session_id=7):
    cls = ns["DatabricksInspire"]
    return dict(zip(_schema_names(ns), cls._uc_to_row(uc, session_id, lambda usecase, name: name)))


def test_row_tuple_matches_the_schema_and_carries_every_new_column(agent_ns):
    names = _schema_names(agent_ns)
    assert names[-len(NEW_COLUMNS + V130_COLUMNS):] == NEW_COLUMNS + V130_COLUMNS
    cls = agent_ns["DatabricksInspire"]
    assert len(cls._uc_to_row(make_uc("N01-U01"), 7, lambda u, n: n)) == len(names)


def test_quality_label_and_elite_fields_are_persisted(agent_ns):
    uc = make_uc("N01-U01", Quality="Ultra High", quality_mode="Ultra High", elite_status="ELITE",
                 elite_score=8.65, elite_assessment=elite_assessment(), code_structure_mandate="- mandate")
    row = _row(agent_ns, uc)
    assert row["quality"] == "Ultra High"
    assert row["quality_mode"] == "Ultra High"
    assert row["elite_status"] == "ELITE"
    assert row["elite_score"] == pytest.approx(8.65)
    assert json.loads(row["elite_assessment"])["decision_owner"] == "Regional supply planner"
    assert row["code_structure_mandate"] == "- mandate"


def test_selection_flags_json_holds_the_phase1_flags_and_coverage_reason(agent_ns):
    uc = make_uc("N02-U01", bob_status="scored", gate_unverified=["Q3"], gate_flags={"Q3_R5"},
                 decision_verb_flag=True, clustering_fallback="domain:placeholder",
                 elite_status="DOMAIN_COVERAGE_PICK", coverage_pick_reason="Domain coverage pick, below bar: x",
                 selection_drop_reason="quality 'Medium' is below the High bar", bob_hard_veto_gate=None)
    flags = json.loads(_row(agent_ns, uc)["selection_flags"])
    assert flags == {"scoring_status": "scored", "bob_status": "scored", "gate_unverified": ["Q3"],
                     "gate_flags": ["Q3_R5"], "decision_verb_flag": True,
                     "clustering_fallback": "domain:placeholder",
                     "selection_drop_reason": "quality 'Medium' is below the High bar",
                     "coverage_pick_reason": "Domain coverage pick, below bar: x"}


def test_missing_values_stay_null_and_alignment_is_not_fabricated(agent_ns):
    uc = {"No": "N01-U09", "Name": "Bare"}
    row = _row(agent_ns, uc)
    for column in ("quality", "quality_mode", "elite_status", "elite_score", "elite_assessment",
                   "selection_flags", "inspire_score", "bob_score", "quality_score"):
        assert row[column] is None, column
    assert row["business_priority_alignment"] == "" and row["strategic_goals_alignment"] == ""


def test_row_source_fills_mode_and_mandate_without_overriding_the_uc(agent_ns):
    obj = make_inspire(agent_ns, use_cases_quality="Strict Quality")
    obj._build_code_structure_mandate = lambda spec: f"mandate:{spec['family']}:{spec['use_case_id']}"
    filled = obj._tracking_row_source(make_uc("N01-U01"))
    assert filled["code_structure_mandate"] == "mandate:E:N01-U01"
    assert filled["quality_mode"] == agent_ns["canonical_use_cases_quality"]("Strict Quality") == "High"
    kept = obj._tracking_row_source(make_uc("N01-U02", quality_mode="Ultra High", code_structure_mandate="own"))
    assert kept["quality_mode"] == "Ultra High" and kept["code_structure_mandate"] == "own"


def _tracking_obj(ns, spark, **attrs):
    settings = {"spark": spark, "inspire_database": "main.inspire", "session_id": 99,
                "_tracking_table_name": "main.inspire.__inspire_usecases", "_tracking_table_created": True}
    settings.update(attrs)
    obj = make_inspire(ns, **settings)
    import threading
    obj._tracking_lock = threading.Lock()
    obj._build_code_structure_mandate = lambda spec: "mandate"
    return obj


def test_replace_session_is_a_single_replace_where_swap_with_no_delete(agent_ns, functions_stub):
    spark = FakeSpark()
    obj = _tracking_obj(agent_ns, spark)
    use_cases = [make_uc(f"N01-U{i:02d}") for i in range(1, 8)]
    obj._tracking_replace_session(use_cases, chunk_size=3)
    assert not any(s.upper().startswith("DELETE") for s in spark.statements), spark.statements
    stage = "`main`.`inspire`.`__inspire_usecases_stage_99`"
    staged = [w for w in spark.writes if w["table"] == stage]
    assert [len(w["rows"]) for w in staged] == [3, 3, 1] and all(w["mode"] == "append" for w in staged)
    swaps = [w for w in spark.writes if w["table"] == "`main`.`inspire`.`__inspire_usecases`"]
    assert len(swaps) == 1
    assert swaps[0]["mode"] == "overwrite" and swaps[0]["options"] == {"replaceWhere": "session_id = 99"}
    assert swaps[0]["source"] == stage
    assert spark.statements[0] == f"DROP TABLE IF EXISTS {stage}" and spark.statements[-1] == f"DROP TABLE IF EXISTS {stage}"


def test_replace_session_failure_keeps_previous_rows_and_is_surfaced(agent_ns, functions_stub):
    spark = FakeSpark(fail_write=lambda w: w["mode"] == "overwrite")
    obj = _tracking_obj(agent_ns, spark)
    with pytest.raises(RuntimeError, match="previous rows are unchanged"):
        obj._tracking_replace_session([make_uc("N01-U01")])
    assert [s for s in spark.statements if "DELETE" in s.upper()] == []
    assert obj.failed_steps[0]["step"] == "Tracking Table"
    assert obj.final_inspire_results_json["failed_steps"][0]["step"] == "Tracking Table"
    assert spark.statements[-1].startswith("DROP TABLE IF EXISTS `main`.`inspire`.`__inspire_usecases_stage_99`")


def test_replace_session_retries_a_concurrent_swap_conflict(agent_ns, functions_stub, monkeypatch):
    import time as time_module
    conflicts = ["ConcurrentAppendException: files were added by a concurrent update"]

    def fail_write(record):
        if record["mode"] == "overwrite" and conflicts:
            raise RuntimeError(conflicts.pop())
        return False
    monkeypatch.setattr(time_module, "sleep", lambda seconds: None)
    spark = FakeSpark(fail_write=fail_write)
    obj = _tracking_obj(agent_ns, spark)
    obj._tracking_replace_session([make_uc("N01-U01")])
    assert len([w for w in spark.writes if w["mode"] == "overwrite"]) == 1
    assert obj.logger.matching("concurrent update (attempt 1/3)", level="WARNING")
    assert not getattr(obj, "failed_steps", None)


def test_replace_session_refuses_when_the_table_is_unavailable(agent_ns, functions_stub):
    spark = FakeSpark()
    obj = _tracking_obj(agent_ns, spark, _tracking_table_created=False)
    obj._create_tracking_table = lambda: None
    with pytest.raises(RuntimeError, match="unavailable"):
        obj._tracking_replace_session([make_uc("N01-U01")])
    assert spark.writes == []


def _describe(columns):
    def responder(statement):
        if statement.upper().startswith("DESCRIBE TABLE"):
            return [{"col_name": c} for c in columns]
        return []
    return responder


def test_create_table_ddl_is_quoted_and_declares_the_new_columns(agent_ns):
    spark = FakeSpark(responder=_describe(["session_id", "id"] + [c for c, _ in agent_ns["DatabricksInspire"]._TRACKING_MIGRATION_COLUMNS]))
    obj = _tracking_obj(agent_ns, spark, _tracking_table_created=False, _tracking_table_name="my-cat.my_sch.__inspire_usecases")
    obj._create_tracking_table()
    create = next(s for s in spark.statements if s.upper().startswith("CREATE TABLE"))
    assert create.startswith("CREATE TABLE IF NOT EXISTS `my-cat`.`my_sch`.`__inspire_usecases` (")
    for column, column_type in (("quality", "STRING"), ("quality_mode", "STRING"), ("elite_status", "STRING"),
                                ("elite_score", "DOUBLE"), ("elite_assessment", "STRING"), ("selection_flags", "STRING")):
        assert f"{column} {column_type}" in create
    assert obj._tracking_table_created is True


def test_migration_adds_only_missing_columns_with_quoted_alters(agent_ns):
    existing = ["session_id", "id"] + [c for c, _ in agent_ns["DatabricksInspire"]._TRACKING_MIGRATION_COLUMNS if c not in NEW_COLUMNS]
    spark = FakeSpark(responder=_describe(existing))
    obj = _tracking_obj(agent_ns, spark)
    added = obj._migrate_tracking_table_schema()
    assert added == NEW_COLUMNS
    alters = [s for s in spark.statements if s.upper().startswith("ALTER TABLE")]
    assert alters == [f"ALTER TABLE `main`.`inspire`.`__inspire_usecases` ADD COLUMN {c} {t}"
                      for c, t in agent_ns["DatabricksInspire"]._TRACKING_MIGRATION_COLUMNS if c in NEW_COLUMNS]


def test_migration_failure_is_raised_and_recorded_not_swallowed(agent_ns):
    def responder(statement):
        if statement.upper().startswith("DESCRIBE TABLE"):
            return [{"col_name": "session_id"}]
        if "ADD COLUMN elite_assessment" in statement:
            raise RuntimeError("PERMISSION_DENIED: ALTER on table")
        return []
    spark = FakeSpark(responder=responder)
    obj = _tracking_obj(agent_ns, spark)
    with pytest.raises(RuntimeError, match="elite_assessment: PERMISSION_DENIED"):
        obj._migrate_tracking_table_schema()
    obj._tracking_table_created = False
    obj._create_tracking_table()
    assert obj._tracking_table_created is True
    assert obj.failed_steps[0]["step"] == "Tracking Table Migration"
    assert obj.logger.matching("could not be fully migrated", level="ERROR")


def test_create_failure_is_recorded_and_leaves_the_table_unavailable(agent_ns):
    def responder(statement):
        if statement.upper().startswith("CREATE TABLE"):
            raise RuntimeError("PERMISSION_DENIED: CREATE TABLE on schema")
        return []
    obj = _tracking_obj(agent_ns, FakeSpark(responder=responder), _tracking_table_created=False)
    obj._create_tracking_table()
    assert obj._tracking_table_created is False
    assert obj.failed_steps[0]["step"] == "Tracking Table Setup"


def test_replace_session_writes_the_existing_columns_when_alter_is_denied(agent_ns, functions_stub):
    base_columns = ["session_id", "id", "updated_at"] + [n for n in _schema_names(agent_ns) if n not in NEW_COLUMNS]

    def responder(statement):
        if statement.upper().startswith("DESCRIBE TABLE"):
            return [{"col_name": c} for c in base_columns]
        if "ADD COLUMN" in statement:
            raise RuntimeError("PERMISSION_DENIED: user is not the owner of the table")
        return []
    spark = FakeSpark(responder=responder)
    obj = _tracking_obj(agent_ns, spark, _tracking_table_created=False)
    obj._create_tracking_table()
    obj._tracking_replace_session([make_uc("N01-U01", elite_status="ELITE")])
    swap_select = next(s for s in spark.statements if s.startswith("SELECT ") and "__inspire_usecases_stage_99" in s)
    assert "`elite_status`" not in swap_select and "`quality_mode`" not in swap_select
    assert "`inspire_score`" in swap_select and "`updated_at`" in swap_select
    assert len([w for w in spark.writes if w["mode"] == "overwrite"]) == 1
    assert [f["step"] for f in obj.failed_steps] == ["Tracking Table Migration"]
    assert obj.logger.matching("this session is written without them", level="WARNING")


def test_legacy_rename_runs_only_when_needed_and_falls_back_to_add(agent_ns):
    def responder(statement):
        if statement.upper().startswith("DESCRIBE TABLE"):
            return [{"col_name": "session_id"}, {"col_name": "generated_sql"}, {"col_name": "generated"},
                    {"col_name": "# Partition Information"}]
        if "RENAME COLUMN" in statement:
            raise RuntimeError("column mapping is not enabled")
        return []
    spark = FakeSpark(responder=responder)
    obj = _tracking_obj(agent_ns, spark)
    added = obj._migrate_tracking_table_schema()
    renames = [s for s in spark.statements if "RENAME COLUMN" in s]
    assert renames == ["ALTER TABLE `main`.`inspire`.`__inspire_usecases` RENAME COLUMN generated_sql TO notebook_path"]
    assert "notebook_path" in added and "generated" not in added
    assert obj.logger.matching("could not be renamed", level="WARNING")


def test_inspire_database_identifier_is_quoted(agent_ns):
    spark = FakeSpark()
    obj = make_inspire(agent_ns, spark=spark, inspire_database="my-cat.my-schema")
    obj._ensure_inspire_database_exists()
    assert spark.statements == ["CREATE DATABASE IF NOT EXISTS `my-cat`.`my-schema`"]
    assert agent_ns["quote_qualified_name"]("`a`.b.__c") == "`a`.`b`.`__c`"
    assert agent_ns["quote_qualified_name"]("") == ""


def test_step_payload_carries_quality_scores_and_elite_fields(agent_ns):
    obj = make_inspire(agent_ns, use_cases_quality="Ultra High")
    obj._normalize_usecase = lambda usecase, name: name
    uc = make_uc("N01-U01", bob_score=8.4, elite_status="ELITE", elite_score=8.9,
                 elite_assessment=elite_assessment(blockers={"none"}), coverage_pick_reason=None)
    payload = obj._build_use_case_step_payload(uc)
    assert payload["quality"] == "High" and payload["quality_score"] == 4.0
    assert payload["inspire_score"] == pytest.approx(7.65) and payload["bob_score"] == pytest.approx(8.4)
    assert payload["elite_status"] == "ELITE" and payload["elite_score"] == pytest.approx(8.9)
    assert payload["elite_assessment"]["decision_owner"] == "Regional supply planner"
    assert payload["quality_mode"] == "Ultra High"
    assert payload["selection_flags"] == {"scoring_status": "scored"}
    json.dumps(payload)


def test_step_payload_never_fabricates_zero_scores(agent_ns):
    obj = make_inspire(agent_ns)
    obj._normalize_usecase = lambda usecase, name: name
    payload = obj._build_use_case_step_payload({"No": "N01-U01", "Name": "x", "Value": "not a number"})
    for key in ("strategic_alignment", "return_on_investment", "value_score", "priority_score",
                "quality_score", "inspire_score", "bob_score", "elite_score"):
        assert payload[key] is None, key
