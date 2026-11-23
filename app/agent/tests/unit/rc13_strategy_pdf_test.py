"""rc13 strategy PDF (REQ-121), rewritten for FX-116 (REQ-503): the agent has no PDF Catalog or Excel option any more. The generation
option helpers, the default and the PDF and Excel writers are gone, and a failing catalog writer is still recorded without stopping the others."""
import json
import pathlib


def test_the_generation_option_helpers_and_default_are_gone(agent_ns):
    for name in ("generation_choices_text", "DEFAULT_GENERATION_OPTIONS"):
        assert name not in agent_ns, f"{name} is still defined"
    for name in ("_pdf_requested", "_excel_requested", "_documents_requested"):
        assert not hasattr(agent_ns["DatabricksInspire"], name), name


def test_a_failing_catalog_writer_is_recorded_and_neither_stops_the_other():
    """Structural, read from the notebook cells: the artifact loop catches each future on its own. A run is not executed here."""
    notebook = json.loads((pathlib.Path(__file__).resolve().parents[2] / "agent" / "dbx_inspire_ai_agent.ipynb").read_text(encoding="utf-8"))
    source = "\n".join("".join(cell["source"]) for cell in notebook["cells"] if cell["cell_type"] == "code")
    assert "for future, job_name, start_step_id, step_name, lang in writing_futures:" in source
    assert "self._record_failed_step(step_name, lang, e)" in source, "a failing writer future is recorded and the loop goes on"
    assert 'self._record_failed_step("Use Case Excel"' not in source, "there is no Excel writer to record"
