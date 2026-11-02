"""v1.2.0 INTEGRATION-4 (FINAL-INTEGRATION-A): the GENIE-REDESIGN merge and its cross-lane items.

0. Merge resolution: the ARTIFACTS tracking-row backfill builds code_structure_mandate through the Genie
   redesign's spec-based builder (`_build_code_structure_mandate(spec)`); the pre-redesign two-argument call
   raised TypeError on every tracking write of a use case without a mandate.
1. Result-table naming: compute_result_table_name returns a backtick-quoted three-level name, so every name the
   Genie spec, card, prompt and harness derive from it (smoke table, run log, latest view, explanation staging,
   Unity Catalog model, experiment leaf) is built from the parsed parts instead of appending a suffix to the
   quoted string; the reference validator keeps stripping backticks and now reads identifiers that need quotes
   (a hyphenated catalog was cut to its last segment, so real tables were rejected and invented ones misnamed).
2. Genie follow-ups: top-N follows the final rank; every Ultra High check goes through _is_ultra_high_mode and Ultra
   High generates Genie Code only for ELITE use cases (Discover and the JSON Generate path, where a non-elite keeps an
   instruction it already carries); _row_to_uc inverts _uc_to_row; Generate mode records a contended or
   unverifiable lock, ends with the shared completion banner and uploads the log; notebook URL lookups are cached;
   the Genie prompt carries ASSUMED_CONTEXT_RULE; the notebook's default AI endpoint skips unusable endpoints.
3. One technique registry: the gate and elite family sets are derived from TECHNIQUE_EXECUTION_FAMILY (supervised =
   family A, model families = A-D, text = family G plus two free-text detections, temporal = TEMPORAL_TECHNIQUES)
   and a family label outside the registry fails at import.
4. The duplicate-flag channel is removed end to end: the dedup prompt asked for per-row flags inside the honesty
   column, which the shared honesty extractor strips, so the parser never saw them and nothing read them.
5. LLM-inferred business priorities are one labelled assumption (user priorities are never labelled); the
   uncalled event-stream scaffold (_EventsEmitter, EVENTS) is removed.
6. A pipeline step that ends with a warning or an error shows its cause (for example the lost tables) in its
   visible message, and the story message no longer reads "completed inspire is working on ...".
7. readme, integration guide, design guide and cells[0] describe the redesigned Genie path: selection, notebook
   sections 0-12, GENIE SLOT cells, contract check, the persistent per-notebook job and the family table, which
   must match TECHNIQUE_EXECUTION_FAMILY.

Every behavioural fix has a case that fails on the naive merge of dev dc932d4 with v120-genie-redesign-final
40d8824 and a must-exclude case.
"""
import os
import re
import sys
import threading
import types

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import load_agent_namespace  # noqa: E402
from v120_artifacts_support import FakeSpark, make_inspire, make_uc  # noqa: E402
from v120_genie_support import build_inspire, make_uc as make_genie_uc  # noqa: E402
from v120_run_offline_smoke_test import _build, quiet_root_logger  # noqa: E402,F401

QUOTED3 = re.compile(r"`[^`.]+`\.`[^`.]+`\.`[^`.]+`")


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


@pytest.fixture
def functions_stub(monkeypatch):
    monkeypatch.setattr(sys.modules["pyspark.sql.functions"], "current_timestamp", lambda: "now", raising=False)


# ---------------------------------------------------------------- 0. merge resolution


def test_tracking_row_backfills_the_mandate_with_the_redesign_builder(ns):
    obj = make_inspire(ns, inspire_database="main.inspire")
    uc = make_uc("N01-U01")
    del uc["result_table"]
    row = obj._tracking_row_source(uc)
    assert row["code_structure_mandate"].startswith("Execution pattern: family E, ")
    assert "Run pattern: every run refits the forecaster" in row["code_structure_mandate"]
    assert "GENIE SLOT" not in row["code_structure_mandate"]
    assert "result_table" not in row and "result_table" not in uc
    assert "code_structure_mandate" not in uc


def test_tracking_row_keeps_the_use_case_own_mandate(ns):
    obj = make_inspire(ns, inspire_database="main.inspire")
    obj._build_code_structure_mandate = lambda spec: pytest.fail("a use case with its own mandate is not rebuilt")
    row = obj._tracking_row_source(make_uc("N01-U02", code_structure_mandate="own mandate"))
    assert row["code_structure_mandate"] == "own mandate"


def test_tracking_replace_session_stages_rows_with_the_real_mandate_builder(ns, functions_stub):
    spark = FakeSpark()
    obj = make_inspire(ns, spark=spark, inspire_database="main.inspire", session_id=99,
                       _tracking_table_name="`main`.`inspire`.`__inspire_usecases`", _tracking_table_created=True)
    obj._tracking_lock = threading.Lock()
    obj._tracking_replace_session([make_uc("N01-U01"), make_uc("N01-U02", **{"Analytics Technique": "Classification"})])
    names = [f.name for f in ns["DatabricksInspire"]._get_tracking_full_schema().fields]
    staged = [dict(zip(names, row)) for w in spark.writes if w["table"].endswith("_stage_99`") for row in w["rows"]]
    mandates = {row["id"]: row["code_structure_mandate"] for row in staged}
    assert mandates["N01-U01"].startswith("Execution pattern: family E, ")
    assert mandates["N01-U02"].startswith("Execution pattern: family A, ")
    assert not obj.logger.matching("[ARTIFACT STEP FAILED]")


# ---------------------------------------------------------------- 1. result-table naming from parsed parts

HYPHEN_DB = "dev-cat.team-01"
RESERVED_DB = "main.order"


def _genie_spec(ns, technique="Classification", inspire_database=HYPHEN_DB, **uc_fields):
    inst = build_inspire(ns, inspire_database=inspire_database)
    uc = make_genie_uc(**{"Analytics Technique": technique, **uc_fields})
    uc.pop("result_table", None) if "result_table" not in uc_fields else None
    return inst, uc, inst._genie_notebook_spec(uc)


def test_spec_names_are_built_from_the_quoted_result_table_parts(ns):
    _inst, uc, spec = _genie_spec(ns)
    base = "_inspire_n01_u01_use_case_n01_u01_s4242"
    assert uc["result_table"] == f"`dev-cat`.`team-01`.`{base}`"
    assert spec["result_table"] == f"`dev-cat`.`team-01`.`{base}`"
    assert spec["model_name"] == f"dev-cat.team-01.{base}_model"
    assert "`" not in spec["model_name"] and "experiment_leaf" not in spec


def test_an_unquoted_or_legacy_result_table_is_normalized_and_an_invalid_one_recomputed(ns):
    _inst, uc, spec = _genie_spec(ns, result_table="main.inspire.n01_u01_churn_out")
    assert spec["result_table"] == "`main`.`inspire`.`n01_u01_churn_out`"
    assert spec["model_name"] == "main.inspire.n01_u01_churn_out_model"
    _inst, uc, spec = _genie_spec(ns, result_table="not_three_levels")
    assert spec["result_table"] == "`dev-cat`.`team-01`.`_inspire_n01_u01_use_case_n01_u01_s4242`"
    assert uc["result_table"] == spec["result_table"]


def test_harness_name_helpers_agree_with_the_agent_parse_and_build_helpers(ns):
    for name in ("`dev-cat`.`team-01`.`_inspire_x`", "main.order._inspire_y", "`a b`.`c`.`d_e`"):
        parts = ns["parse_three_level_name"](name)
        assert ns["inspire_table_name"](name) == ns["build_fqn"](*parts)
        assert ns["inspire_table_name"](name, "_runs") == ns["build_fqn"](parts[0], parts[1], parts[2] + "_runs")
    for bad in ("", "cat.table", "a.b.c.d", "a..c"):
        with pytest.raises(ValueError, match="three-level"):
            ns["inspire_table_name"](bad)


def test_the_brief_shows_the_quoted_output_table_and_the_plain_model_name(ns):
    inst, uc, spec = _genie_spec(ns)
    mandate = inst._build_code_structure_mandate(spec)
    assert "Business output table `dev-cat`.`team-01`.`_inspire_n01_u01_use_case_n01_u01_s4242` (Delta" in mandate
    assert "Unity Catalog as `dev-cat.team-01._inspire_n01_u01_use_case_n01_u01_s4242_model` with the alias champion" in mandate
    assert "``" not in mandate and "_latest" not in mandate and "_runs" not in mandate


def test_genie_prompt_gets_the_normalized_result_table_and_the_mlflow_model_name(ns):
    from v120_genie_support import FakeAgent
    agent = FakeAgent(["## 1. Decision and Owner\n" + "x " * 80])
    inst = build_inspire(ns, inspire_database=HYPHEN_DB, agent=agent)
    inst._genie_validation_mode = lambda: "off"
    uc = make_genie_uc()
    uc.pop("result_table")
    inst._generate_genie_instruction_for_use_case(uc, [], "", schema_index={})
    sent = agent.calls[0]["vars"]
    assert sent["result_table"] == "`dev-cat`.`team-01`.`_inspire_n01_u01_use_case_n01_u01_s4242`"
    assert sent["model_name"] == "dev-cat.team-01._inspire_n01_u01_use_case_n01_u01_s4242_model"


def test_validator_strips_backticks_from_quoted_derived_names(ns):
    obj = make_inspire(ns)
    result_table = ns["compute_result_table_name"]("N01-U01", "Churn risk", "", RESERVED_DB)
    assert result_table == "`main`.`order`.`_inspire_n01_u01_churn_risk`"
    uc = {"No": "N01-U01", "Tables Involved": "main.sales.orders", "Primary Table": "main.sales.orders",
          "result_table": result_table}
    derived = [ns["inspire_table_name"](result_table, s) for s in ("", "_runs", "_latest", "_smoke", "_smoke_runs")]
    text = "Read main.sales.orders. " + " ".join(f"Write {name}." for name in derived) + \
           " Register main.order._inspire_n01_u01_churn_risk_model."
    ok, unresolved = obj._validate_genie_instruction_references(uc, text, schema_index=None)
    assert ok and unresolved == []
    ok, unresolved = obj._validate_genie_instruction_references(uc, "Write `main`.`order`.`other_table`.", schema_index=None)
    assert not ok and unresolved == ["main.order.other_table"]


# ---------------------------------------------------------------- 2. Genie follow-ups

def _ranked_ucs():
    return [{"No": "A", "Inspire Score": 3.0, "Priority": 9.9, "Name": "a"},
            {"No": "B", "Inspire Score": 4.5, "Priority": 1.0, "Name": "b"},
            {"No": "C", "Inspire Score": 4.0, "Priority": 5.0, "Name": "c"}]


def test_top_n_auto_genie_follows_the_final_rank_not_priority(ns):
    inst = build_inspire(ns, quality="Good", generate_genie_code_for="2")
    targets, selection = inst._select_genie_targets(_ranked_ucs())
    assert [uc["No"] for uc in targets] == ["B", "C"]
    assert "final rank" in selection
    from _agentload import agent_source
    assert "_ag_pri" not in agent_source()


def _ultra_ucs():
    return [{"No": "E1", "elite_status": "ELITE", "elite_score": 8.0, "Inspire Score": 3.0, "Name": "e1"},
            {"No": "P", "elite_status": "DOMAIN_COVERAGE_PICK", "Inspire Score": 5.0, "Name": "p"},
            {"No": "E2", "elite_status": "ELITE", "elite_score": 9.0, "Inspire Score": 2.0, "Name": "e2"},
            {"No": "N", "Inspire Score": 4.9, "Name": "n"}]


@pytest.mark.parametrize("mode", ["Ultra High", "  ultra HIGH "])
def test_ultra_high_generates_genie_only_for_elite_use_cases_whatever_the_top_n(ns, mode):
    inst = build_inspire(ns, quality=mode, generate_genie_code_for="1")
    targets, selection = inst._select_genie_targets(_ultra_ucs())
    assert [uc["No"] for uc in targets] == ["E2", "E1"]
    assert "elite" in selection
    assert inst._genie_validation_mode() == "strict"


@pytest.mark.parametrize("quality", ["Good", "Ultra High"])
def test_widget_13_zero_selects_no_genie_target_during_discover(ns, quality):
    inst = build_inspire(ns, quality=quality, generate_genie_code_for="0")
    targets, selection = inst._select_genie_targets(_ultra_ucs())
    assert targets == [] and "widget 13 = 0" in selection


def test_the_generate_operation_is_not_limited_by_the_discover_count(ns):
    inst = build_inspire(ns, quality="Ultra High", generate_genie_code_for="0")
    targets, _ = inst._select_genie_targets(_ultra_ucs(), during_discover=False)
    assert [uc["No"] for uc in targets] == ["E2", "E1"]
    inst = build_inspire(ns, quality="Good", generate_genie_code_for="0")
    targets, selection = inst._select_genie_targets(_ranked_ucs(), during_discover=False)
    assert [uc["No"] for uc in targets] == ["B", "C", "A"] and selection == "all use cases (Generate Use Cases)"


def test_no_raw_ultra_high_comparison_remains_outside_the_mode_helper():
    import ast
    from _agentload import agent_ast
    owners = set()

    def visit(node, owner):
        for child in ast.iter_child_nodes(node):
            name = child.name if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)) else owner
            if isinstance(child, ast.Compare) and any(isinstance(c, ast.Constant) and c.value == "Ultra High"
                                                      for c in [child.left] + list(child.comparators)):
                owners.add(owner)
            visit(child, name)

    visit(agent_ast(), "<module>")
    assert owners == {"_is_ultra_high_mode"}


def _genie_batch_inst(ns, quality):
    inst = build_inspire(ns, quality=quality)
    seen = {"waves": [], "skeletons": []}
    inst._ensure_genie_metadata_loader = lambda: None
    inst._build_genie_schema_index = lambda details: {}
    inst._emit_pipeline_status = lambda **kw: 1
    inst._write_skeleton_notebook = lambda uc: seen["skeletons"].append(uc["No"]) or uc.update(notebook_status="skeleton") or True

    def waves(ucs, *a, **kw):
        seen["waves"].append([uc["No"] for uc in ucs])
        for uc in ucs:
            uc.update(genie_instruction_status="success", notebook_status="written")
        return {"emitted": list(ucs), "failed": []}

    inst._run_genie_waves = waves
    return inst, seen


def test_generate_path_in_ultra_high_runs_genie_only_for_elites_and_skeletons_the_rest(ns):
    inst, seen = _genie_batch_inst(ns, "Ultra High")
    out = inst._generate_genie_instructions_and_notebooks(_ultra_ucs(), [], "", {})
    assert seen["waves"] == [["E2", "E1"]]
    assert sorted(seen["skeletons"]) == ["N", "P"]
    assert len(out) == 4


def test_generate_path_in_ultra_high_keeps_the_instruction_a_non_elite_already_carries(ns):
    inst, seen = _genie_batch_inst(ns, "Ultra High")
    written = []
    inst._assemble_genie_code_notebook = lambda uc, translations: written.append(uc["No"]) or f"/nb/{uc['No']}"
    ucs = _ultra_ucs()
    ucs[1]["genie_instruction"] = "## 1. Decision and Owner\nReuse the instruction loaded from the JSON catalog."
    inst._generate_genie_instructions_and_notebooks(ucs, [], "", {})
    assert seen["waves"] == [["E2", "E1"]]
    assert written == ["P"] and seen["skeletons"] == ["N"]
    assert ucs[1]["notebook_status"] == "written" and ucs[1]["has_genie_code"] == "Y"


def test_generate_path_runs_genie_for_elites_and_fallback_picks_even_when_widget_13_is_zero(ns):
    inst, seen = _genie_batch_inst(ns, "Ultra High")
    inst.generate_genie_code_for = "0"
    inst._generate_genie_instructions_and_notebooks(_ultra_ucs(), [], "", {})
    assert seen["waves"] == [["E2", "E1"]] and sorted(seen["skeletons"]) == ["N", "P"]
    inst, seen = _genie_batch_inst(ns, "Good")
    inst.generate_genie_code_for = "0"
    inst._selection_is_fallback = True
    picks = [{"No": "F1", "elite_status": "FALLBACK_BELOW_BAR", "Inspire Score": 3.0, "Name": "f1"},
             {"No": "F2", "elite_status": "FALLBACK_BELOW_BAR", "Inspire Score": 4.0, "Name": "f2"}]
    inst._generate_genie_instructions_and_notebooks(picks, [], "", {})
    assert seen["waves"] == [["F2", "F1"]] and seen["skeletons"] == []


def test_generate_path_in_good_still_runs_genie_for_every_use_case(ns):
    inst, seen = _genie_batch_inst(ns, "Good")
    inst._generate_genie_instructions_and_notebooks(_ranked_ucs(), [], "", {})
    assert seen["waves"] == [["A", "B", "C"]] and seen["skeletons"] == []


def test_tracking_row_round_trips_every_new_column_and_the_selection_flags(ns):
    cls = ns["DatabricksInspire"]
    uc = make_uc("N01-U01", Quality="Ultra High", quality_mode="Ultra High", elite_status="ELITE", elite_score=8.65,
                 elite_assessment={"decision": "Reorder weekly", "join_path": ["a.b.c.x = a.b.d.x"]},
                 scoring_status="scored", bob_status="scored", gate_flags={"Q3_R5"}, decision_verb_flag=True,
                 coverage_pick_reason="keeps Sales", bob_score=7.5, bob_tier1_score=7.0, bob_tier2_score=8.0,
                 bob_tier3_score=7.5, idea_theme="Demand", has_genie_code="Y", code_structure_mandate="mandate")
    names = [f.name for f in cls._get_tracking_full_schema().fields]
    row = dict(zip(names, cls._uc_to_row(uc, 7, lambda usecase, name: name)))
    back = build_inspire(ns)._row_to_uc(row)
    assert back["Quality"] == "Ultra High" and back["quality_mode"] == "Ultra High" and back["elite_status"] == "ELITE"
    assert back["elite_score"] == pytest.approx(8.65)
    assert back["elite_assessment"] == {"decision": "Reorder weekly", "join_path": ["a.b.c.x = a.b.d.x"]}
    assert cls._selection_flags(back) == cls._selection_flags(uc)
    assert back["gate_flags"] == ["Q3_R5"] and back["coverage_pick_reason"] == "keeps Sales"
    for key in ("bob_score", "bob_tier1_score", "bob_tier2_score", "bob_tier3_score", "idea_theme", "has_genie_code",
                "code_structure_mandate"):
        assert back[key] == uc[key], key
    assert "selection_flags" not in back


def test_tracking_row_with_broken_json_columns_drops_only_those_fields(ns):
    from v120_genie_support import tracking_row
    back = build_inspire(ns)._row_to_uc(tracking_row(elite_assessment="{not json", selection_flags="[1, 2",
                                                     quality="High", elite_score=7.1))
    assert "elite_assessment" not in back and "selection_flags" not in back
    assert back["Quality"] == "High" and back["elite_score"] == 7.1


class _LockWriter:
    def __init__(self, outcome):
        self.outcome = outcome
        self.released = []
        self.enabled = True

    def acquire_lock(self, business_name, ttl_seconds=7200, holder_note=""):
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome

    def release_lock(self, business_name):
        self.released.append(business_name)


def _generate_mode_inst(ns, lock_outcome):
    from v120_artifacts_support import CapturingLogger
    inst = build_inspire(ns, operation="Generate Use Cases", _tracking_table_name="`c`.`s`.`__inspire_usecases`")
    inst.logger = CapturingLogger()
    inst.atomic_writer = _LockWriter(lock_outcome)
    inst._phaseE0_catalog_drift_check = lambda sid: []
    inst._fetch_flagged_use_cases_route1 = lambda: []
    inst._run_route2_fallback = lambda label, persist_tracking: None
    return inst


def test_generate_mode_records_a_lock_infrastructure_failure_and_still_releases(ns):
    inst = _generate_mode_inst(ns, RuntimeError("lock table unreadable: PERMISSION_DENIED"))
    inst._run_generate_mode()
    assert [f["step"] for f in inst.failed_steps] == ["Generate Lock"]
    assert "PERMISSION_DENIED" in inst.failed_steps[0]["error"]
    assert inst.logger.matching("[G15 LOCK_UNVERIFIED]", "WARNING")
    assert inst.atomic_writer.released == ["Acme"]
    assert any("Generate Lock" in w for w in inst._run_outcome_warnings())


def test_generate_mode_releases_the_lock_under_the_business_it_locked(ns):
    inst = _generate_mode_inst(ns, True)
    inst._fetch_flagged_use_cases_route1 = lambda: [{"session_id": 11, "id": "N01-U01"}]

    def regenerate(rows, label):
        inst.business_name = "Other Corp"
        return []

    inst._regenerate_genie_for_flagged_rows = regenerate
    inst._run_generate_mode()
    assert inst.atomic_writer.released == ["Acme"], "a context change during the run never moves the lock it releases"


def test_regeneration_restores_the_run_context_after_every_session(ns):
    inst = build_inspire(ns, operation="Generate Use Cases")
    contexts = {"11": {"business_name": "Acme"}, "22": {"business_name": "Other Corp", "enriched_business_context": "theirs"}}
    inst._row_to_uc = lambda row: {"No": row["id"], "_source_session_id": row["session_id"], "notebook_status": "written"}
    inst._load_session_context = lambda sid: contexts[sid]
    inst._build_schema_details_from_use_cases = lambda ucs: []
    inst._build_genie_schema_index = lambda details: {}
    inst._ensure_genie_metadata_loader = lambda: None
    inst._emit_pipeline_status = lambda **kw: 1
    inst._report_genie_outcome = lambda label, processed: {"validated_ids": [uc["No"] for uc in processed]}
    seen = []
    inst._run_genie_waves = lambda ucs, *args, **kwargs: seen.append(inst.business_name)
    before = (inst.business_name, inst.merged_business_context, inst.parsed_generation_instructions)
    rows = [{"session_id": 11, "id": "N01-U01"}, {"session_id": 22, "id": "N02-U01"}]
    assert len(inst._regenerate_genie_for_flagged_rows(rows, "Route 1 (DB flag)")) == 2
    assert seen == ["Acme", "Other Corp"], "each session is regenerated with its own context"
    assert (inst.business_name, inst.merged_business_context, inst.parsed_generation_instructions) == before

    def boom(ucs, *args, **kwargs):
        raise RuntimeError("wave failed")

    inst._run_genie_waves = boom
    with pytest.raises(RuntimeError, match="wave failed"):
        inst._regenerate_genie_for_flagged_rows([{"session_id": 22, "id": "N02-U01"}], "Route 1 (DB flag)")
    assert inst.business_name == "Acme" and inst.merged_business_context == before[1]


def test_generate_mode_stops_when_another_run_holds_the_lock(ns):
    inst = _generate_mode_inst(ns, False)
    with pytest.raises(RuntimeError, match="Another Genie regeneration is running for business Acme"):
        inst._run_generate_mode()
    assert [f["step"] for f in inst.failed_steps] == ["Generate Lock"]
    assert "another run holds the Generate lock" in inst.failed_steps[0]["error"]
    assert inst.atomic_writer.released == [], "a run that never held the lock releases nothing"


def test_generate_mode_with_the_lock_held_records_nothing(ns):
    inst = _generate_mode_inst(ns, True)
    inst._run_generate_mode()
    assert not getattr(inst, "failed_steps", None)
    assert inst.atomic_writer.released == ["Acme"]


class _StatusApi:
    def __init__(self, ids=None):
        self.ids = dict(ids or {})
        self.calls = []

    def get_status(self, path):
        self.calls.append(path)
        if path in self.ids:
            return types.SimpleNamespace(path=path, object_id=self.ids[path])
        raise RuntimeError("RESOURCE_DOES_NOT_EXIST")


def test_notebook_url_lookups_are_cached_for_hits_and_misses(ns):
    inst = build_inspire(ns)
    inst.w_client = types.SimpleNamespace(workspace=_StatusApi(), config=types.SimpleNamespace(host="https://h"))
    inst._build_notebook_url = lambda object_id: f"https://h/editor/notebooks/{object_id}"
    uc = make_genie_uc()
    for _ in range(4):
        assert inst._get_use_case_notebook_url(uc) == ""
    assert len(inst.w_client.workspace.calls) == 2
    inst._notebook_object_ids[uc["No"]] = 77
    assert inst._get_use_case_notebook_url(uc) == "https://h/editor/notebooks/77"
    assert len(inst.w_client.workspace.calls) == 2


def test_a_stale_miss_never_overwrites_an_id_stored_by_the_notebook_writer(ns):
    inst = build_inspire(ns)
    uc = make_genie_uc()

    class Racing(_StatusApi):
        def get_status(self, path):
            inst._notebook_object_ids[uc["No"]] = 91
            return super().get_status(path)

    inst.w_client = types.SimpleNamespace(workspace=Racing(), config=types.SimpleNamespace(host="https://h"))
    inst._build_notebook_url = lambda object_id: f"url:{object_id}"
    assert inst._get_use_case_notebook_url(uc) == "url:91"
    assert inst._notebook_object_ids[uc["No"]] == 91


def test_genie_prompt_carries_the_shared_assumed_context_rule_after_the_context_block(ns):
    template = ns["PROMPT_TEMPLATES"]["USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT"]
    rule = ns["ASSUMED_CONTEXT_RULE"]
    assert template.count(rule) == 1
    assert template.index("{enriched_revenue_model}") < template.index(rule) < template.index("{generation_instructions_section}")
    entry = ns["smoke_render_all_prompts"]()["USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT"]
    assert entry["ok"] and entry["error"] is None


def _generate_run(ns, tmp_path, monkeypatch, failed=None):
    obj = _build(ns, tmp_path, "Good", {"Medium", "High", "Very High", "Ultra High"}, lambda uc_id: None)
    obj.operation = "Generate Use Cases"
    obj.operation_mode = "Generate Use Cases"
    uploads = []
    obj._upload_log_file = lambda: uploads.append(True)
    obj._run_generate_mode = lambda: obj._record_failed_step("Generate Lock", "", failed) if failed else None
    printed = []
    monkeypatch.setitem(ns["DatabricksInspire"].run.__globals__, "log_print",
                        lambda message, level="INFO", flush=True: printed.append((level, str(message))))
    obj.run()
    return obj, printed, uploads


def test_generate_mode_ends_with_the_shared_completion_banner_and_uploads_the_log(fresh_ns, tmp_path, monkeypatch):
    _obj, printed, uploads = _generate_run(fresh_ns, tmp_path, monkeypatch)
    banners = [m for level, m in printed if "Genie Code regeneration" in m]
    assert banners and banners[-1].startswith("✅ SUCCESS") and uploads == [True]


def test_generate_mode_banner_reports_warnings(fresh_ns, tmp_path, monkeypatch):
    obj, printed, uploads = _generate_run(fresh_ns, tmp_path, monkeypatch, failed=RuntimeError("lock unreadable"))
    warnings = [m for level, m in printed if level == "WARNING" and "COMPLETED WITH WARNINGS" in m]
    assert len(warnings) == 1 and "Generate Lock" in warnings[0]
    assert obj.final_inspire_results_json["failed_steps"][0]["step"] == "Generate Lock"
    assert not [m for _, m in printed if m.startswith("✅ SUCCESS")] and uploads == [True]


# ---------------------------------------------------------------- 3. one technique registry

def _keys_whose_label(ns, predicate):
    families = ns["DatabricksInspire"]._TECHNIQUE_FAMILIES
    return frozenset(key for key, label, _a, _m in families if predicate(label))


def test_gate_and_elite_family_sets_are_derived_from_the_registry(ns):
    cls, registry = ns["DatabricksInspire"], ns["TECHNIQUE_EXECUTION_FAMILY"]
    assert cls._SUPERVISED_FAMILIES == _keys_whose_label(ns, lambda l: registry[l] == "A")
    assert cls._SUPERVISED_FAMILIES == {"classification", "predictive", "survival", "text_classification"}
    assert "regression" not in cls._SUPERVISED_FAMILIES
    assert cls._MODEL_FAMILIES == _keys_whose_label(ns, lambda l: l in ns["TRAIN_INFER_TECHNIQUES"])
    assert {"anomaly", "clustering", "recommendation", "association"} <= cls._MODEL_FAMILIES
    assert "regression" not in cls._MODEL_FAMILIES and "forecasting" not in cls._MODEL_FAMILIES
    assert cls._TEXT_FAMILIES == _keys_whose_label(ns, lambda l: registry[l] == "G") | {"text_topic", "text_classification"}
    assert cls._TEXT_FAMILIES == {"text_sentiment", "text_topic", "text_summarization", "text_extraction",
                                  "text_classification", "text_analytics"}
    assert cls._TEMPORAL_FAMILIES == _keys_whose_label(ns, lambda l: l in ns["TEMPORAL_TECHNIQUES"])
    assert cls._TEMPORAL_FAMILIES == {"forecasting", "trend", "cohort", "survival"}
    assert ns["TEMPORAL_TECHNIQUES"] <= set(registry)


def test_a_family_label_outside_the_registry_fails_at_import(fresh_ns):
    families = fresh_ns["DatabricksInspire"]._TECHNIQUE_FAMILIES + (("quantum", "Quantum Divination", ("quantum",), ()),)
    with pytest.raises(ValueError, match="Quantum Divination"):
        fresh_ns["_gate_family_sets"](families, ("text_topic",))
    with pytest.raises(ValueError, match="not_a_family"):
        fresh_ns["_gate_family_sets"](fresh_ns["DatabricksInspire"]._TECHNIQUE_FAMILIES, ("not_a_family",))
    from _agentload import agent_source
    assert re.search(r"(?m)^    _GATE_FAMILY_SETS = _gate_family_sets\(_TECHNIQUE_FAMILIES, _FREE_TEXT_DETECTIONS\)$", agent_source())


def test_temporal_techniques_outside_the_registry_fail_the_import_check(fresh_ns):
    fresh_ns["TEMPORAL_TECHNIQUES"] = fresh_ns["TEMPORAL_TECHNIQUES"] | {"Quantum Divination"}
    with pytest.raises(ValueError, match="TEMPORAL_TECHNIQUES.*Quantum Divination"):
        fresh_ns["_validate_technique_registry"]()


def test_no_hand_maintained_technique_family_set_remains(ns):
    import ast
    from _agentload import agent_ast
    gate_keys = {key for key, _l, _a, _m in ns["DatabricksInspire"]._TECHNIQUE_FAMILIES}
    tree = agent_ast()
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "DatabricksInspire")
    exceptions = next(n for n in cls.body if isinstance(n, ast.Assign)
                      and any(getattr(t, "id", None) == "_FREE_TEXT_DETECTIONS" for t in n.targets))
    allowed = {id(e) for e in ast.walk(exceptions)}
    offenders = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.Set, ast.List, ast.Tuple)) and len(node.elts) >= 2 and id(node) not in allowed:
            values = [e.value for e in node.elts if isinstance(e, ast.Constant) and isinstance(e.value, str)]
            if len(values) == len(node.elts) and set(values) <= gate_keys:
                offenders.append(node.lineno)
    assert offenders == []
    assert len(exceptions.value.elts) == 2


def test_survival_analysis_now_needs_an_outcome_and_regression_analysis_does_not(ns):
    from v120_elite_verification_test import failures_of, good, inspire as elite_inspire, uc as elite_uc, verify
    assert "needs an outcome column" in failures_of(ns, elite_uc(tech="Survival Analysis"), good(outcome_definition=None))
    regression = verify(elite_inspire(ns), elite_uc(tech="Regression Analysis"), good(outcome_definition=None))
    assert regression["passed"] is True and not [f for f in regression["failures"] if "outcome" in f]
    no_measure = verify(elite_inspire(ns), elite_uc(tech="Regression Analysis"),
                        good(outcome_definition=None, signal_columns=["c.s.orders.ordered_at"],
                             value_driver="Orders per `c.s.customers.customer_id` move the KPI"))
    assert any("the KPI has no numeric measure" in f for f in no_measure["failures"])


# ---------------------------------------------------------------- 4. dead duplicate-flag channel removed end to end

FLAG_TOKENS = ("_FLAG_DUPLICATE_SUSPECT", "_TRIVIAL_WRAPPER", "_TECH_ONLY")


def test_dedup_prompt_no_longer_asks_for_flags_in_the_honesty_column(ns):
    template = ns["PROMPT_TEMPLATES"]["REVIEW_USE_CASES_PROMPT"]
    for token in FLAG_TOKENS:
        assert token not in template, token
    assert "Your response must START with: use_case_id,honesty_score,honesty_justification" in template
    assert "When in doubt, KEEP both use cases" in template
    assert "SAME score and justification for all rows" in ns["HONESTY_CHECK_CSV"]


def test_dedup_parser_has_no_flag_channel_and_reads_the_extractor_output(ns):
    from _agentload import agent_source
    src = agent_source()
    for token in FLAG_TOKENS + ("Dedup Flags",):
        assert token not in src, token
    raw = "use_case_id,honesty_score,honesty_justification\nU1,90,two near twins kept\nU3,90,two near twins kept\n"
    score, _just, cleaned = ns["extract_honesty_score"](raw)
    assert score == 90 and "honesty" not in cleaned
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    from v120_artifacts_support import CapturingLogger
    obj.logger = CapturingLogger()
    ucs = [{"No": "U1"}, {"No": "U2"}, {"No": "U3"}]
    kept = obj._parse_dedup_response(cleaned, ucs, "t")
    assert [u["No"] for u in kept] == ["U1", "U3"]
    assert all(set(u) == {"No"} for u in kept)
    assert cls._dedup_response_columns([["use_case_id", "honesty_justification"], ["U1", "x"]], {"u1": "U1"}) == (0, 1)


# ---------------------------------------------------------------- 5. inferred business priorities and the dead event stream

LABEL = "[ASSUMPTION inferred from the business name 'Contoso, Retail' only, not evidenced by the metadata] "


def test_llm_inferred_business_priorities_are_one_labelled_assumption(ns):
    label_fn = ns["label_inferred_business_context"]
    ctx = label_fn({"business_context": "Sells groceries", "business_priorities": "Cut shrink, grow loyalty by $2 million"},
                   "Contoso, Retail")
    unknown = ns["CONTEXT_NOT_PROVIDED_MARKER"]
    assert ctx["business_priorities"] == [LABEL + f"Cut shrink, grow loyalty by {unknown}"]
    assert label_fn(ctx, "Contoso, Retail") == ctx
    listed = label_fn({"business_priorities": ["Cut shrink", "Grow loyalty"]}, "Contoso, Retail")
    assert listed["business_priorities"] == [LABEL + "Cut shrink, Grow loyalty"]
    assert label_fn({"business_priorities": ""}, "x")["business_priorities"] == ""
    assert label_fn({"business_priorities": unknown}, "x")["business_priorities"] == unknown


def test_labelled_priorities_stay_one_intact_entry_and_never_reach_generation(ns, tmp_path, quiet_root_logger):
    obj = _build(ns, tmp_path, "Good", {"Medium", "High", "Very High", "Ultra High"}, lambda uc_id: None)
    raw = obj._get_business_context_from_llm()
    obj._get_business_context_from_llm = lambda: ns["label_inferred_business_context"](raw, "Contoso, Retail")
    obj.run()
    assert "business_priorities" not in obj.recorded["gen_kwargs"][0]
    assert obj.merged_business_context["business_priorities"] == [LABEL + "Grow basket size, Cut waste"]


def test_user_business_priorities_are_never_labelled(ns, tmp_path, quiet_root_logger):
    obj = _build(ns, tmp_path, "Good", {"Medium", "High", "Very High", "Ultra High"}, lambda uc_id: None)
    raw = obj._get_business_context_from_llm()
    obj._get_business_context_from_llm = lambda: ns["label_inferred_business_context"](raw, "Contoso, Retail")
    obj.user_business_priorities = ["Increase Revenue", "Reduce Cost"]
    obj.run()
    assert "business_priorities" not in obj.recorded["gen_kwargs"][0]
    assert obj.merged_business_context["business_priorities"] == ["Increase Revenue", "Reduce Cost"]


def test_the_uncalled_event_stream_scaffold_is_gone(ns):
    from _agentload import agent_source
    src = agent_source()
    assert "_EventsEmitter" not in src and "EVENTS.emit" not in src and "events.jsonl" not in src
    assert "EVENTS" not in ns and "_EventsEmitter" not in ns


# ---------------------------------------------------------------- 6. lost tables named in the visible step message

LOST = [{"table": "cat.sch.ledger", "reason": "timeout after 3 attempt(s): metadata query timed out"},
        {"table": "cat.sch.payroll", "reason": "DESCRIBE permission denied: PERMISSION_DENIED"}]


def test_lost_table_step_names_the_tables_in_its_visible_message(ns, tmp_path, quiet_root_logger):
    obj = _build(ns, tmp_path, "Good", {"Medium", "High", "Very High", "Ultra High"}, lambda uc_id: None)
    obj.data_loader.metadata_unavailable_report = lambda: {"count": 2, "tables": [dict(e) for e in LOST]}
    obj.run()
    steps = [s for s in obj.atomic_writer.steps if s["status"] == "ended_warning" and (s.get("result_json") or {}).get("tables") == LOST]
    assert len(steps) == 1
    assert "cat.sch.ledger (timeout after 3 attempt(s)" in steps[0]["message"]
    assert "cat.sch.payroll (DESCRIBE permission denied" in steps[0]["message"]


def test_pipeline_warning_and_error_steps_show_their_cause_and_prompt_steps_keep_internal_names_out(ns):
    obj = make_inspire(ns)
    recorded = []
    obj.atomic_writer = types.SimpleNamespace(emit_step=lambda **kw: recorded.append(kw) or len(recorded))
    obj._open_pipeline_step_ids = {}
    for status in ("ended_warning", "ended_error", "ended_success", "started"):
        obj._emit_pipeline_status(stage_name="Data Preparation", step_name="Metadata Load", sub_step_name="x",
                                  message="2 tables lost: a.b.c", status=status)
    by_status = {kw["status"]: kw["message"] for kw in recorded}
    assert by_status["ended_warning"] == "Inspire has completed metadata load with caution: 2 tables lost: a.b.c"
    assert by_status["ended_error"] == "Inspire needs attention while metadata load: 2 tables lost: a.b.c"
    assert by_status["ended_success"] == "Inspire has completed metadata load"
    assert by_status["started"] == "Inspire has started metadata load"
    recorded.clear()
    obj._prompt_progress_lock = threading.Lock()
    obj._prompt_entities_seen, obj._prompt_progress_emitted = {}, {}
    obj._emit_prompt_status("BEST_OF_BEST_SCORING_PROMPT", "batch 1", "ended_error",
                            message="BEST_OF_BEST_SCORING_PROMPT failed")
    assert "BEST_OF_BEST_SCORING_PROMPT" not in recorded[-1]["message"]


# ---------------------------------------------------------------- 7. docs describe the redesigned Genie path

def _read(relative):
    with open(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), relative),
              encoding="utf-8") as fh:
        return fh.read()


def _family_rows(text, start_marker):
    section = text[text.index(start_marker):]
    rows = {}
    for line in section.splitlines():
        m = re.match(r"^\| ([A-H]) \| [^|]+ \| ([^|]+) \|$", line)
        if m:
            rows[m.group(1)] = {t.strip() for t in m.group(2).split(",")}
        elif rows and not line.startswith("|"):
            break
    return rows


def test_integration_guide_family_table_matches_the_technique_registry(ns):
    rows = _family_rows(_read("docs/integration-guide.md"), "**Execution families:**")
    expected = {}
    for technique, family in ns["TECHNIQUE_EXECUTION_FAMILY"].items():
        expected.setdefault(family, set()).add(technique)
    assert rows == expected


def test_docs_describe_the_genie_notebook_job_and_selection(ns):
    integration, design, readme = _read("docs/integration-guide.md"), _read("docs/design-guide.md"), _read("readme.md")
    from _agentload import notebook_cells
    cell0 = notebook_cells()[0][1]
    for name, text in (("integration", integration), ("design", design), ("readme", readme), ("cells[0]", cell0)):
        for needle in ("Copy the cell below into Genie Code without the surrounding quotes", "AGENTS.md", "four cells",
                       "Number helpers", "Run controls"):
            assert needle in text, (name, needle)
    for name, text in (("design", design), ("cells[0]", cell0)):
        for stale in ("Contract check PASSED", "GENIE SLOT cells", "Smoke test", "two cells"):
            assert stale not in text, (name, stale)
    for needle in ("13_generate_genie_code_for", "Auto-Genie (Elite Use Cases)", "Auto-Genie (Top-N)", "dbx_inspire_ai_child_run",
                   "<catalog>.<schema>.<table>_model", "creates none of them"):
        assert needle in integration, needle
    assert "| `discover_auto_genie_top_n`" not in integration
    sections = integration[integration.index("### 17.I"):integration.index("## 18)")]
    for row in ("| 1 | markdown |", "| 2 | code |", "| 3 | code |"):
        assert row in sections, row
    assert "| 12 |" not in sections and "| 3a |" not in sections
    for stale in ("UC##_<Use_Case_Name>.py", "UC01_*.py", "N{XX}_{Domain_Name}.py", "**except** Genie Code Instruction generation"):
        assert stale not in readme and stale not in design and stale not in cell0, stale
    assert "TECHNIQUE_EXECUTION_FAMILY" in design
    assert "Generate Genie Code Instruction For" in cell0


def test_genie_ai_endpoint_default_skips_unusable_endpoints_in_every_tier(fresh_ns):
    models = [{"name": "w1", "llm_endpoint_name": "ep-worker", "type": "worker", "order": 1, "enabled": True},
              {"name": "t1", "llm_endpoint_name": "ep-thinker-down", "type": "thinker", "order": 2, "enabled": True},
              {"name": "t2", "llm_endpoint_name": "ep-thinker-up", "type": "thinker", "order": 3, "enabled": True}]
    fresh_ns["TECHNICAL_CONTEXT"]["models"] = models
    default = fresh_ns["DatabricksInspire"]._genie_ai_endpoint_default
    assert default() == "ep-worker"
    health = fresh_ns["LLM_ENDPOINT_HEALTH"]
    health.mark_unusable("ep-worker", "PERMISSION_DENIED")
    health.mark_unusable("ep-thinker-down", "ENDPOINT_NOT_FOUND")
    assert default() == "ep-thinker-up"
    health.mark_unusable("ep-thinker-up", "ENDPOINT_NOT_FOUND")
    assert default() == ""


def _hyphen_uc(ns):
    return {"No": "N01-U01", "Tables Involved": "dev-cat.sales.orders", "Primary Table": "dev-cat.sales.orders",
            "result_table": ns["compute_result_table_name"]("N01-U01", "Churn", "", HYPHEN_DB)}


@pytest.mark.parametrize("text", ["Read `dev-cat`.`sales`.`orders` joined on `orders`.`customer_id`.",
                                  "Read dev-cat.sales.orders joined on customer_id.",
                                  "Read `dev-cat.sales.orders` joined on customer_id.",
                                  "MERGE INTO `dev-cat`.`team-01`.`_inspire_n01_u01_churn_runs`."])
def test_validator_resolves_real_tables_in_catalogs_that_need_quotes(ns, text):
    ok, unresolved = make_inspire(ns)._validate_genie_instruction_references(_hyphen_uc(ns), text, schema_index=None)
    assert ok and unresolved == [], unresolved


@pytest.mark.parametrize("text", ["Read `dev-cat`.`sales`.`invented_table`.", "Read dev-cat.sales.invented_table.",
                                  "Read `dev-cat.sales.invented_table` daily."])
def test_validator_names_an_invented_table_in_a_catalog_that_needs_quotes_in_full(ns, text):
    ok, unresolved = make_inspire(ns)._validate_genie_instruction_references(_hyphen_uc(ns), text, schema_index=None)
    assert not ok and unresolved == ["dev-cat.sales.invented_table"]
