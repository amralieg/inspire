"""v1.2.0 GENIE lane: strict validation with up to three repair rounds for Ultra High (5A, G-03, G-09), Genie for every
elite Ultra High use case (domain coverage picks keep skeleton notebooks, owner decision 5A of GENIE-REDESIGN),
final-rank top-N (G-05), one parallelism setting (G-15), cancellable executors and success-only Genie notebooks (G-10)."""
import ast
import concurrent.futures
import os
import sys
import threading
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _agentload import method_node
from v120_genie_support import (CUSTOMERS, ORDERS, FakeAgent, FakeLoader, StatusRecorder, build_inspire,
                                long_instruction, make_uc, schema_details, tracking_row)

BAD = long_instruction(f"Use `{ORDERS}.amount` and `{ORDERS}.discount_pct` from `{ORDERS}`.")
GOOD = long_instruction(f"Use `{ORDERS}.amount` and `{CUSTOMERS}.segment` from `{ORDERS}`.")


def _generate(inst, uc=None):
    return inst._generate_genie_instruction_for_use_case(uc or make_uc(), [], "", schema_index=None)


def test_ultra_high_repairs_bad_references_once_without_cache_and_with_feedback(agent_ns):
    agent = FakeAgent([BAD, GOOD])
    inst = build_inspire(agent_ns, loader=FakeLoader(), quality="Ultra High", agent=agent)
    uc = _generate(inst)
    assert uc["genie_instruction_status"] == "success"
    assert len(agent.calls) == 2
    assert agent.calls[0]["skip_cache"] is False and agent.calls[1]["skip_cache"] is True
    repair_schema = agent.calls[1]["vars"]["directly_involved_schema"]
    assert "REPAIR REQUIRED" in repair_schema and f"`{ORDERS}.discount_pct`" in repair_schema
    assert "REPAIR REQUIRED" not in agent.calls[0]["vars"]["directly_involved_schema"]
    assert uc["genie_validation_errors"] == []
    assert "discount_pct" not in uc["genie_instruction"]


def test_ultra_high_reports_failed_validation_after_every_repair_round(agent_ns):
    agent = FakeAgent([BAD] * 6)
    inst = build_inspire(agent_ns, loader=FakeLoader(), quality="Ultra High", agent=agent)
    uc = _generate(inst)
    rounds = agent_ns["GENIE_INSTRUCTION_REPAIR_ROUNDS"]
    assert rounds == 3 and len(agent.calls) == 1 + rounds
    assert [c["step"] for c in agent.calls] == ["Genie_Instruction_N01-U01", "Genie_Instruction_N01-U01_repair",
                                                "Genie_Instruction_N01-U01_repair2", "Genie_Instruction_N01-U01_repair3"]
    assert [c["skip_cache"] for c in agent.calls] == [False, True, True, True]
    for call in agent.calls[1:]:
        feedback = call["vars"]["directly_involved_schema"]
        assert f"`{ORDERS}.discount_pct`" in feedback and "<<<PREVIOUS DRAFT\n" + BAD.strip() + "\nPREVIOUS DRAFT>>>" in feedback
    assert uc["genie_instruction_status"] == "failed_validation"
    assert uc["genie_instruction"] == ""
    assert uc["genie_validation_errors"] == [f"{ORDERS}.discount_pct"]


def test_ultra_high_recovers_on_a_later_repair_round(agent_ns):
    agent = FakeAgent([BAD, BAD, GOOD])
    inst = build_inspire(agent_ns, loader=FakeLoader(), quality="Ultra High", agent=agent)
    uc = _generate(inst)
    assert len(agent.calls) == 3 and agent.calls[2]["step"] == "Genie_Instruction_N01-U01_repair2"
    assert uc["genie_instruction_status"] == "success" and uc["genie_validation_errors"] == []
    assert "discount_pct" not in uc["genie_instruction"]


def test_good_mode_repairs_references_against_live_metadata(agent_ns):
    agent = FakeAgent([BAD, GOOD])
    inst = build_inspire(agent_ns, loader=FakeLoader(), quality="Good", agent=agent)
    uc = _generate(inst)
    assert len(agent.calls) == 2 and agent.calls[1]["skip_cache"] is True
    assert uc["genie_instruction_status"] == "success" and "discount_pct" not in uc["genie_instruction"]


def test_good_mode_keeps_the_instruction_but_never_marks_it_success_with_errors(agent_ns):
    agent = FakeAgent([BAD] * 6)
    inst = build_inspire(agent_ns, loader=FakeLoader(), quality="Good", agent=agent)
    uc = _generate(inst)
    assert len(agent.calls) == 1 + agent_ns["GENIE_INSTRUCTION_REPAIR_ROUNDS"]
    assert uc["genie_instruction_status"] == "validation_errors"
    assert "discount_pct" in uc["genie_instruction"]
    assert uc["genie_instruction"].startswith(BAD.strip()) and "Job Launcher" not in uc["genie_instruction"]
    assert "## Parameters" in uc["genie_instruction"] and "## Platform Rules" in uc["genie_instruction"]
    assert uc["genie_validation_errors"] == [f"{ORDERS}.discount_pct"]


def test_clean_instruction_validated_against_live_metadata_is_success(agent_ns):
    inst = build_inspire(agent_ns, loader=FakeLoader(), quality="High", agent=FakeAgent([GOOD]))
    assert _generate(inst)["genie_instruction_status"] == "success"


def test_strict_mode_without_live_metadata_is_not_success(agent_ns):
    agent = FakeAgent([GOOD])
    inst = build_inspire(agent_ns, loader=None, quality="Ultra High", agent=agent)
    uc = _generate(inst)
    assert uc["genie_instruction_status"] == "failed_validation"
    assert "no live Unity Catalog metadata" in uc["genie_validation_errors"][0]
    assert len(agent.calls) == 1


def test_soft_mode_without_live_metadata_is_unverified(agent_ns):
    inst = build_inspire(agent_ns, loader=None, quality="Good", agent=FakeAgent([GOOD]))
    uc = _generate(inst)
    assert uc["genie_instruction_status"] == "unverified"
    assert uc["genie_instruction"]


def test_env_off_marks_good_mode_unverified_not_success(agent_ns, monkeypatch):
    monkeypatch.setenv("INSPIRE_GENIE_HALLUCINATION_MODE", "off")
    inst = build_inspire(agent_ns, loader=FakeLoader(), quality="Good", agent=FakeAgent([BAD]))
    uc = _generate(inst)
    assert uc["genie_instruction_status"] == "unverified"
    assert uc["genie_validation_basis"] == "disabled"


def test_env_strict_gives_good_mode_the_repair_attempt(agent_ns, monkeypatch):
    monkeypatch.setenv("INSPIRE_GENIE_HALLUCINATION_MODE", "strict")
    agent = FakeAgent([BAD, GOOD])
    inst = build_inspire(agent_ns, loader=FakeLoader(), quality="Good", agent=agent)
    assert _generate(inst)["genie_instruction_status"] == "success"
    assert len(agent.calls) == 2


def test_ultra_high_cannot_be_weakened_by_the_env_switch(agent_ns, monkeypatch):
    monkeypatch.setenv("INSPIRE_GENIE_HALLUCINATION_MODE", "off")
    agent = FakeAgent([BAD] * 6)
    inst = build_inspire(agent_ns, loader=FakeLoader(), quality="Ultra High", agent=agent)
    assert _generate(inst)["genie_instruction_status"] == "failed_validation"
    assert len(agent.calls) == 1 + agent_ns["GENIE_INSTRUCTION_REPAIR_ROUNDS"]


def _rank(uc):
    return (-float(uc.get("elite_score") or 0), str(uc.get("No")))


def _discover_inst(agent_ns, quality, statuses=None, top_n="5", **attrs):
    calls = {"generated": [], "genie_notebooks": [], "skeletons": []}
    statuses = statuses or {}

    def generate(uc, full_schema_details, document_context, schema_index=None):
        calls["generated"].append((uc["No"], schema_index))
        status = statuses.get(uc["No"], "success")
        uc["genie_instruction_status"] = status
        uc["genie_instruction"] = "" if status not in ("success", "validation_errors", "unverified") else "instruction " + "x" * 200
        if status in ("failed_validation", "validation_errors"):
            uc["genie_validation_errors"] = [f"{ORDERS}.ghost_col"]
        return uc

    def skeleton(uc):
        calls["skeletons"].append(uc["No"])
        return f"/nb/{uc['No']} - skeleton.ipynb"

    def genie_notebook(uc, translations):
        calls["genie_notebooks"].append(uc["No"])
        return f"/nb/{uc['No']} - genie.ipynb"

    recorder = StatusRecorder()
    inst = build_inspire(agent_ns, loader=FakeLoader(), quality=quality, generate_genie_code_for=top_n,
                         _generate_genie_instruction_for_use_case=generate, _assemble_skeleton_notebook=skeleton,
                         _assemble_genie_code_notebook=genie_notebook, _final_rank_key=_rank,
                         _emit_pipeline_status=recorder, **attrs)
    return inst, calls, recorder


def _ucs(coverage_pick=None):
    ucs = [make_uc("N01-U01", Priority=9.5, elite_score=6.0), make_uc("N01-U02", Priority=1.0, elite_score=9.0),
           make_uc("N02-U01", Priority=8.0, elite_score=7.5), make_uc("N02-U02", Priority=2.0, elite_score=8.5)]
    for uc in ucs:
        uc["elite_status"] = "DOMAIN_COVERAGE_PICK" if uc["No"] == coverage_pick else "ELITE"
    return ucs


def test_good_mode_auto_genie_picks_top_n_by_final_rank_not_priority(agent_ns, capsys):
    inst, calls, _ = _discover_inst(agent_ns, "Good", top_n="2")
    ucs = _ucs()
    inst._run_discover_skeleton_phase(ucs, schema_details())
    assert sorted(no for no, _ in calls["generated"]) == ["N01-U02", "N02-U02"]
    out = capsys.readouterr().out
    assert "top 2 by final rank" in out and "by Inspire Score" not in out


@pytest.mark.parametrize("value", [None, "", "many"])
def test_good_mode_discover_writes_skeleton_notebooks_only_unless_widget_15_asks(agent_ns, value):
    inst, calls, _ = _discover_inst(agent_ns, "Good", top_n=value)
    if value is None:
        del inst.generate_genie_code_for
    ucs = _ucs()
    inst._run_discover_skeleton_phase(ucs, schema_details())
    assert calls["generated"] == [] and calls["genie_notebooks"] == []
    assert sorted(calls["skeletons"]) == sorted(uc["No"] for uc in ucs)
    warned = [str(c) for c in inst.logger.warning.call_args_list if "13_generate_genie_code_for" in str(c)]
    assert warned == (["call(\"13_generate_genie_code_for='many' is not 'all' or an integer; using 0\")"] if value == "many" else [])


@pytest.mark.parametrize("quality", ["Good", "High", "Ultra High"])
@pytest.mark.parametrize("value", [None, "0"])
def test_discover_writes_no_genie_code_in_any_mode_when_widget_15_is_zero(agent_ns, capsys, quality, value):
    inst, calls, _ = _discover_inst(agent_ns, quality, top_n=value)
    if value is None:
        del inst.generate_genie_code_for
    ucs = _ucs(coverage_pick="N02-U01")
    inst._run_discover_skeleton_phase(ucs, schema_details())
    assert calls["generated"] == [] and calls["genie_notebooks"] == []
    assert sorted(calls["skeletons"]) == sorted(uc["No"] for uc in ucs)
    assert all(uc["has_genie_code"] == "N" for uc in ucs)
    assert "Discover Auto-Genie: Genie Code for no use case (widget 13 = 0)" in capsys.readouterr().out


def test_auto_genie_passes_the_live_schema_index_into_generation(agent_ns):
    inst, calls, _ = _discover_inst(agent_ns, "Good", top_n="1")
    inst._run_discover_skeleton_phase(_ucs(), schema_details())
    _, index = calls["generated"][0]
    assert index and ORDERS in index and CUSTOMERS in index


def test_ultra_high_generates_genie_for_every_elite_use_case_ignoring_the_widget(agent_ns):
    inst, calls, recorder = _discover_inst(agent_ns, "Ultra High", top_n="1")
    ucs = _ucs(coverage_pick="N02-U01")
    inst._run_discover_skeleton_phase(ucs, schema_details())
    elite = sorted(uc["No"] for uc in ucs if uc["elite_status"] == "ELITE")
    assert sorted(no for no, _ in calls["generated"]) == elite == ["N01-U01", "N01-U02", "N02-U02"]
    assert sorted(calls["genie_notebooks"]) == elite
    pick = next(uc for uc in ucs if uc["No"] == "N02-U01")
    assert pick["has_genie_code"] == "N" and pick["notebook_status"] == "skeleton" and "N02-U01" in calls["skeletons"]
    assert recorder.find("Auto-Genie (Elite Use Cases)")


def test_failed_validation_keeps_the_skeleton_and_is_reported(agent_ns):
    inst, calls, recorder = _discover_inst(agent_ns, "Ultra High", statuses={"N01-U02": "failed_validation"})
    ucs = _ucs()
    inst._run_discover_skeleton_phase(ucs, schema_details())
    failed = next(uc for uc in ucs if uc["No"] == "N01-U02")
    assert "N01-U02" not in calls["genie_notebooks"]
    assert failed["has_genie_code"] == "N" and failed["notebook_path"].endswith("skeleton.ipynb")
    result = recorder.find("Auto-Genie (Elite Use Cases)")[0]["result_json"]
    assert result["failed_validation"] == {"N01-U02": [f"{ORDERS}.ghost_col"]}
    assert "N01-U02" not in result["ids"] and result["success"] == 3
    assert recorder.find("Auto-Genie (Elite Use Cases)")[0]["status"] == "ended_warning"


def test_soft_validation_errors_are_emitted_but_never_counted_as_validated(agent_ns):
    inst, calls, recorder = _discover_inst(agent_ns, "Good", statuses={"N01-U02": "validation_errors"}, top_n="1")
    ucs = _ucs()
    inst._run_discover_skeleton_phase(ucs, schema_details())
    uc = next(u for u in ucs if u["No"] == "N01-U02")
    assert calls["genie_notebooks"] == ["N01-U02"] and uc["has_genie_code"] == "Y"
    result = recorder.find("Auto-Genie (Top-N)")[0]["result_json"]
    assert result["statuses"] == {"validation_errors": 1}
    assert result["success"] == 0 and result["validation_errors"] == {"N01-U02": [f"{ORDERS}.ghost_col"]}


def test_per_use_case_genie_steps_only_move_progress_on_the_streaming_path(agent_ns):
    inst, _, recorder = _discover_inst(agent_ns, "Ultra High")
    inst._run_discover_skeleton_phase(_ucs(), schema_details())
    discover_steps = [e for e in recorder.events if str(e.get("step_name", "")).startswith("Wave ")]
    assert len(discover_steps) == 4 and all(e["progress_increment"] == 0.0 for e in discover_steps)

    recorder.events.clear()
    inst._generate_genie_instructions_and_notebooks(_ucs(), schema_details(), "", {})
    streaming_steps = [e for e in recorder.events if str(e.get("step_name", "")).startswith("Wave ")]
    assert len(streaming_steps) == 4 and all(e["progress_increment"] == 1.0 for e in streaming_steps)


def test_skeleton_phase_claims_notebook_ownership_so_the_batch_writer_cannot_duplicate(agent_ns):
    inst, _, _ = _discover_inst(agent_ns, "Good", top_n="0")
    inst._run_discover_skeleton_phase(_ucs(), schema_details())
    assert inst._notebooks_generated_inline is True


def test_discover_ultra_high_end_to_end_with_real_generation_validation_and_writers(agent_ns):
    def respond(prompt_vars, skip_cache):
        uc_id = prompt_vars["use_case_id"]
        repairing = "REPAIR REQUIRED" in prompt_vars["directly_involved_schema"]
        if uc_id == "N01-U01":
            return GOOD
        if uc_id == "N01-U02":
            return GOOD if repairing else BAD
        return BAD

    agent = FakeAgent(respond)
    recorder = StatusRecorder()
    inst = build_inspire(agent_ns, loader=FakeLoader(), quality="Ultra High", agent=agent, generate_genie_code_for="1",
                         _final_rank_key=lambda uc: (uc["No"],), _emit_pipeline_status=recorder)
    writes = []
    inst._write_notebook_to_workspace = lambda d, p, obj, uid: writes.append((uid, obj)) or p
    ucs = [make_uc("N01-U01", elite_status="ELITE"), make_uc("N01-U02", elite_status="ELITE"), make_uc("N01-U03", elite_status="ELITE")]
    inst._run_discover_skeleton_phase(ucs, schema_details())
    by_id = {uc["No"]: uc for uc in ucs}
    assert [by_id[i]["genie_instruction_status"] for i in ("N01-U01", "N01-U02", "N01-U03")] == ["success", "success", "failed_validation"]
    assert [by_id[i]["has_genie_code"] for i in ("N01-U01", "N01-U02", "N01-U03")] == ["Y", "Y", "N"]
    assert by_id["N01-U03"]["notebook_path"] == inst._build_notebook_workspace_paths(by_id["N01-U03"])[1]
    assert sum(1 for uid, _ in writes if uid == "N01-U03") == 1
    genie_cells = ["".join("".join(c["source"]) for c in obj["cells"]) for uid, obj in writes if uid == "N01-U02"]
    assert "Copy the cell below into Genie Code without the surrounding quotes" in genie_cells[-1] and "discount_pct" not in genie_cells[-1]
    assert GOOD.strip().splitlines()[0] in genie_cells[-1]
    assert sorted(c["step"] for c in agent.calls) == sorted(["Genie_Instruction_N01-U01", "Genie_Instruction_N01-U02",
                                                            "Genie_Instruction_N01-U02_repair", "Genie_Instruction_N01-U03",
                                                            "Genie_Instruction_N01-U03_repair", "Genie_Instruction_N01-U03_repair2",
                                                            "Genie_Instruction_N01-U03_repair3"])
    result = recorder.find("Auto-Genie (Elite Use Cases)")[0]["result_json"]
    assert sorted(result["validated_ids"]) == ["N01-U01", "N01-U02"]
    assert result["failed_validation"] == {"N01-U03": [f"{ORDERS}.discount_pct"]}


def test_genie_paths_share_one_parallelism_setting(fresh_ns):
    fresh_ns["TECHNICAL_CONTEXT"]["runtime"]["genie_regen_parallelism"] = 3
    seen = []

    def fake_wave(wave_id, backlog, full_schema_details, document_context, schema_by_table, translations, wave_workers):
        seen.append(wave_workers)
        for uc in backlog:
            uc["genie_instruction_status"] = "success"
            uc["notebook_status"] = "written"
        return list(backlog), []

    inst = build_inspire(fresh_ns, loader=FakeLoader(), _run_genie_wave=fake_wave,
                         _assemble_skeleton_notebook=lambda uc: "/nb/x.ipynb", _final_rank_key=_rank)
    assert inst._genie_parallelism(10) == 3 and inst._genie_parallelism(2) == 2
    inst._generate_genie_instructions_and_notebooks([make_uc(f"N01-U0{i}") for i in range(1, 7)], schema_details(), "", {})
    inst.generate_genie_code_for = "all"
    inst._run_discover_skeleton_phase([make_uc(f"N02-U0{i}") for i in range(1, 7)], schema_details())
    inst._regenerate_genie_for_flagged_rows([tracking_row(f"N03-U0{i}") for i in range(1, 7)], "Route 1 — DB flag")
    assert seen == [3, 3, 3]


def test_genie_parallelism_has_no_hidden_per_path_caps(agent_ns):
    from _agentload import agent_source
    src = agent_source()
    assert "_genie_adaptive_cap" not in src
    assert src.count('TECHNICAL_CONTEXT["runtime"].get("genie_regen_parallelism"') == 1


GENIE_REGION_METHODS = ("_run_discover_skeleton_phase", "_regenerate_genie_for_flagged_rows",
                        "_generate_genie_instructions_and_notebooks", "_run_genie_wave", "_run_genie_waves",
                        "assemble_use_case_notebooks")


@pytest.mark.parametrize("name", GENIE_REGION_METHODS)
def test_genie_region_uses_no_raw_executor(name):
    node = method_node("DatabricksInspire", name)
    raw = []
    for call in ast.walk(node):
        if isinstance(call, ast.Call):
            callee = call.func.attr if isinstance(call.func, ast.Attribute) else getattr(call.func, "id", "")
            if callee in ("ThreadPoolExecutor", "as_completed"):
                raw.append(call.lineno)
    assert raw == [], f"{name} still builds a raw executor at lines {raw}"


def test_auto_genie_timeout_cancels_in_flight_generation(fresh_ns, monkeypatch):
    observed = []

    def slow_generate(uc, full_schema_details, document_context, schema_index=None):
        deadline = time.time() + 5
        while time.time() < deadline and not fresh_ns["_is_thread_cancelled"]():
            threading.Event().wait(0.01)
        observed.append(fresh_ns["_is_thread_cancelled"]())
        uc["genie_instruction_status"] = "timeout"
        uc["genie_instruction"] = ""
        return uc

    def instant_timeout(futures, timeout=None, **kwargs):
        threading.Event().wait(0.2)
        raise concurrent.futures.TimeoutError("forced")
        yield

    fresh_ns["safe_as_completed"] = instant_timeout
    monkeypatch.setattr(time, "sleep", lambda seconds: None)
    inst = build_inspire(fresh_ns, loader=FakeLoader(), quality="Good", generate_genie_code_for="1",
                         _generate_genie_instruction_for_use_case=slow_generate,
                         _assemble_skeleton_notebook=lambda uc: "/nb/x.ipynb", _final_rank_key=_rank)
    inst._run_genie_waves([make_uc()], schema_details(), "", {}, {})
    deadline = time.time() + 5
    while len(observed) < 1 and time.time() < deadline:
        threading.Event().wait(0.02)
    assert observed and observed[0] is True


def test_streaming_path_writes_a_genie_notebook_only_on_success_and_a_skeleton_otherwise(agent_ns):
    written = {"genie": [], "skeleton": []}

    def generate(uc, full_schema_details, document_context, schema_index=None):
        uc["genie_instruction_status"] = "success" if uc["No"] == "N01-U01" else "failed"
        uc["genie_instruction"] = "instruction " + "x" * 200 if uc["No"] == "N01-U01" else ""
        return uc

    inst = build_inspire(agent_ns, loader=FakeLoader(), _generate_genie_instruction_for_use_case=generate,
                         _assemble_genie_code_notebook=lambda uc, t: written["genie"].append(uc["No"]) or "/nb/g.ipynb",
                         _assemble_skeleton_notebook=lambda uc: written["skeleton"].append(uc["No"]) or "/nb/s.ipynb")
    ucs = [make_uc("N01-U01"), make_uc("N01-U02")]
    out = inst._generate_genie_instructions_and_notebooks(ucs, schema_details(), "", {})
    assert written == {"genie": ["N01-U01"], "skeleton": ["N01-U02"]}
    assert [uc["notebook_status"] for uc in out] == ["written", "skeleton"]
    assert inst._notebooks_generated_inline is True


def test_regeneration_builds_a_live_schema_index_for_the_flagged_rows(agent_ns):
    seen = []

    def generate(uc, full_schema_details, document_context, schema_index=None):
        seen.append((list(full_schema_details), schema_index))
        uc["genie_instruction_status"] = "success"
        uc["genie_instruction"] = "instruction " + "x" * 200
        return uc

    inst = build_inspire(agent_ns, loader=FakeLoader(), _generate_genie_instruction_for_use_case=generate,
                         _assemble_genie_code_notebook=lambda uc, t: "/nb/g.ipynb")
    succeeded = inst._regenerate_genie_for_flagged_rows([tracking_row()], "Route 1 — DB flag")
    details, index = seen[0]
    assert details and index and ORDERS in index
    assert [uc["No"] for uc in succeeded] == ["N01-U01"]


def test_regeneration_handles_duplicate_tracking_rows_once(agent_ns):
    calls = []

    def generate(uc, full_schema_details, document_context, schema_index=None):
        calls.append(uc["No"])
        uc["genie_instruction_status"] = "success"
        uc["genie_instruction"] = "instruction " + "x" * 200
        return uc

    inst = build_inspire(agent_ns, loader=FakeLoader(), _generate_genie_instruction_for_use_case=generate,
                         _assemble_genie_code_notebook=lambda uc, t: "/nb/g.ipynb")
    succeeded = inst._regenerate_genie_for_flagged_rows([tracking_row(), tracking_row(), tracking_row("N01-U02")], "Route 1 — DB flag")
    assert sorted(calls) == ["N01-U01", "N01-U02"]
    assert sorted(uc["No"] for uc in succeeded) == ["N01-U01", "N01-U02"]


def test_regeneration_does_not_return_use_cases_without_a_written_genie_notebook(agent_ns):
    def generate(uc, full_schema_details, document_context, schema_index=None):
        uc["genie_instruction_status"] = "failed_validation"
        uc["genie_instruction"] = ""
        return uc

    inst = build_inspire(agent_ns, loader=FakeLoader(), _generate_genie_instruction_for_use_case=generate)
    with pytest.raises(RuntimeError, match="wrote 0 of 1 notebook"):
        inst._regenerate_genie_for_flagged_rows([tracking_row()], "Route 1 — DB flag")


def test_a_regeneration_that_writes_no_notebook_fails_and_a_partial_one_is_reported(agent_ns):
    def generate(uc, full_schema_details, document_context, schema_index=None):
        uc["genie_instruction_status"] = "success"
        uc["genie_instruction"] = "instruction " + "x" * 200
        return uc

    def assemble(uc, translations):
        if uc["No"] != "N01-U02":
            raise RuntimeError("The parent folder (/Workspace/Users/someone/out/notebooks/sales) does not exist.")
        return "/nb/g.ipynb"

    recorder = StatusRecorder()
    inst = build_inspire(agent_ns, loader=FakeLoader(), _generate_genie_instruction_for_use_case=generate,
                         _assemble_genie_code_notebook=assemble, _emit_pipeline_status=recorder)
    with pytest.raises(RuntimeError, match=r"wrote 0 of 1 notebook: .*parent folder .* does not exist"):
        inst._regenerate_genie_for_flagged_rows([tracking_row("N01-U01")], "Route 1 — DB flag")
    assert recorder.find("Regeneration")[-1]["status"] == "ended_error"
    assert inst.failed_steps[-1]["step"] == "Genie notebooks (Route 1 — DB flag)" and "1 of 1 not written" in inst.failed_steps[-1]["error"]

    partial = build_inspire(agent_ns, loader=FakeLoader(), _generate_genie_instruction_for_use_case=generate,
                            _assemble_genie_code_notebook=assemble, _emit_pipeline_status=recorder)
    succeeded = partial._regenerate_genie_for_flagged_rows([tracking_row("N01-U01"), tracking_row("N01-U02")], "Route 1 — DB flag")
    assert [uc["No"] for uc in succeeded] == ["N01-U02"]
    assert recorder.find("Regeneration")[-1]["status"] == "ended_warning"
    assert "1 of 2 not written" in partial.failed_steps[-1]["error"]
    assert any("Genie notebooks (Route 1 — DB flag)" in w for w in partial._run_outcome_warnings())
