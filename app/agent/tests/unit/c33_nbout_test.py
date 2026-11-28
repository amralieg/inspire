"""c33_nbout (REQ-578): the Genie code notebook rewrite moved from Generate Use Cases to Implement Use Cases, output "notebook".

An Implement build of one use case with outputs {"notebook": True} calls the same Genie code notebook writer Generate used
(_regenerate_genie_for_flagged_rows, then the one MERGE), for that use case only, and builds no other output. The Generate
orchestrator and its Route 1 / Route 2 flag scans no longer exist."""
import json

import pytest

from v140_implement_test import _probe_inspire

NOTEBOOK_SPEC = {"use_case_id": "N01-U01", "outputs": {"notebook": True}}
WRITTEN = {"No": "N01-U01", "genie_instruction": "Build", "notebook_path": "/W/notebooks/N01-U01", "_source_session_id": "5150"}


def _writer_inspire(ns):
    inst = _probe_inspire(ns, None, {})
    inst._implement_use_case_row = lambda sid, uc: {"No": "N01-U01", "Name": "Predict churn", "session_id": 5150}
    inst._implement_notebooks_dir = lambda sid: "/W/notebooks"
    inst.writer_calls, inst.merged = [], []
    inst._regenerate_genie_for_flagged_rows = lambda rows, label, skip_cache=False, notebook_root="": (
        inst.writer_calls.append((list(rows), label, notebook_root)) or [dict(WRITTEN)])
    inst._merge_regenerated_ucs_into_tracking = lambda ucs: inst.merged.append(list(ucs)) or len(ucs)
    for name in ("_implement_fill_and_preview", "_implement_dashboard", "_implement_genie_space", "_implement_app", "_implement_alert",
                 "_implement_write_notebook", "_implement_runner"):
        setattr(inst, name, lambda *a, _n=name, **k: pytest.fail(f"a notebook-only build must not run {_n}"))
    return inst


def test_notebook_is_an_implement_output_labelled_notebook(agent_ns):
    assert agent_ns["IMPLEMENT_OUTPUT_LABELS"]["notebook"] == "Notebook"
    spec, errors = agent_ns["validate_implement_spec"](json.loads(json.dumps(NOTEBOOK_SPEC)))
    assert errors == [], errors
    assert spec["outputs"]["notebook"] is True
    assert not any(spec["outputs"][name] for name in ("dashboard", "genie_space", "app", "alert"))


def test_the_notebook_is_written_on_its_own_not_beside_other_outputs(agent_ns):
    _spec, errors = agent_ns["validate_implement_spec"]({"use_case_id": "N01-U01", "outputs": {"notebook": True, "dashboard": True}})
    assert any("Notebook" in e and "on its own" in e for e in errors), errors


def test_a_notebook_build_calls_the_genie_code_writer_for_its_use_case_only_and_builds_nothing_else(agent_ns):
    inst = _writer_inspire(agent_ns)
    got = inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": dict(NOTEBOOK_SPEC)},
                                     (5150, "N01-U01", 3), {})
    assert got == "ready"
    assert len(inst.writer_calls) == 1 and [r["No"] for r in inst.writer_calls[0][0]] == ["N01-U01"]
    assert inst.writer_calls[0][2] == "/W/notebooks"
    assert len(inst.merged) == 1 and inst.merged[0][0]["No"] == "N01-U01", "the writer's result is saved by the one MERGE Generate used"
    assert inst.updates[-1]["status"] == "ready"


def test_the_generate_orchestrator_and_its_flag_scans_are_gone(agent_ns):
    cls = agent_ns["DatabricksInspire"]
    for name in ("_run_generate_mode", "_run_route2_fallback", "_nothing_to_regenerate_message", "_fetch_flagged_use_cases_route1",
                 "_fetch_flagged_use_cases_route2", "_scan_notebooks_for_generation_flag"):
        assert not hasattr(cls, name), name
