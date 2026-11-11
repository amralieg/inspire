"""REQ-076 and REQ-077 (rc.7 fix-docs): a documents-only run reads the session's saved catalog, writes only the
picked documents beside the session, and never rewrites the session row. The Excel workbook carries one column per
customer strategy level. A model known to refuse temperature or structured output is never sent either."""
import io
import types

import openpyxl
import pytest

from v120_artifacts_session_test import _atomic_writer
from v120_artifacts_support import FakeSpark, make_inspire
from v130_outputs_test import docs, foundations, labels, value_uc  # noqa: F401
from v211_strategy_directives_test import four_level_tree, portfolio

CATALOG = "/Workspace/out/acme/docs/Acme-dbx_inspire.json"
NEVER_IN_A_DOCUMENTS_RUN = ("assemble_use_case_notebooks", "_run_discover_skeleton_phase", "_generate_genie_instructions_and_notebooks",
                            "_refresh_english_summary", "_record_executive_summary", "_generate_markdown_catalog", "_generate_csv_catalog",
                            "_run_generate_mode")


def documents_only_run(ns, monkeypatch, generate_choices):
    grouped = portfolio()
    ucs = [uc for group in grouped.values() for uc in group]
    obj = make_inspire(ns, generate_choices=generate_choices, output_languages=["English"], json_file_path=CATALOG,
                       operation="Discover Use Cases", operation_mode="Discover Use Cases", generate_genie_instructions=False, no_usable_model="", auto_parallelism=False, max_parallelism=2,
                       strategy_tree=four_level_tree(ns), data_foundations=foundations(),
                       delivery_order=[uc["No"] for uc in ucs], generation_path="/Workspace/out", session_output_dir="/Workspace/out/acme")
    obj.translation_service = types.SimpleNamespace(get_translations=lambda lang: dict(ns["TranslationService"].ENGLISH_TRANSLATIONS))
    obj.ai_agent = types.SimpleNamespace(get_manager_stats_report=lambda: None)
    for name in ("_ensure_inspire_database_exists", "_load_feedback", "_attach_ailogs", "_start_live_log_flush_thread",
                 "_stop_without_usable_model", "_record_genie_code_verdict", "_upload_log_file", "_plan_progress_use_cases",
                 "_report_table_statistics"):
        monkeypatch.setattr(obj, name, lambda *a, **k: None)
    for name in NEVER_IN_A_DOCUMENTS_RUN:
        assert hasattr(obj, name), name
        monkeypatch.setattr(obj, name, lambda *a, _name=name, **k: pytest.fail(f"{_name} runs in a documents-only job"))
    monkeypatch.setattr(obj, "_load_usecases_catalog_json", lambda path: (ucs, {"Executive": "Saved summary"}, grouped))
    monkeypatch.setitem(ns, "AIAgent", types.SimpleNamespace(get_summary_report=lambda: None))
    return obj


def written_names(obj):
    return [str(p).rsplit("/", 1)[-1] for p in obj.w_client.workspace.files]


def test_a_documents_only_run_writes_the_picked_excel_and_no_use_case_work(docs, monkeypatch):
    obj = documents_only_run(docs, monkeypatch, ["Excel"])
    obj.run()
    names = written_names(obj)
    assert [n for n in names if n.endswith(".xlsx")] == ["Acme-dbx_inspire.xlsx"], names
    assert not [n for n in names if n.endswith((".md", ".csv", ".pdf", ".pptx", ".ipynb"))], names


def test_a_documents_only_run_writes_no_format_it_was_not_asked_for(docs, monkeypatch):
    obj = documents_only_run(docs, monkeypatch, ["Excel"])
    monkeypatch.setattr(obj, "generate_catalog_pdf", lambda *a: pytest.fail("the PDF was not picked"))
    monkeypatch.setattr(obj, "generate_presentation_pptx", lambda *a: pytest.fail("the presentation was not picked"))
    obj.run()
    assert not [n for n in written_names(obj) if n.endswith(".pdf")]


def test_the_excel_workbook_has_one_column_per_customer_strategy_level(docs):
    obj = make_inspire(docs, strategy_tree=four_level_tree(docs), data_foundations=foundations(), delivery_order=["N01-U01", "N01-U02"],
                       docs_output_dir="/Workspace/out/docs")
    obj._generate_use_case_excel("English", "en", portfolio())
    path = next(p for p in obj.w_client.workspace.files if str(p).endswith(".xlsx"))
    headers = [cell.value for cell in openpyxl.load_workbook(io.BytesIO(obj.w_client.workspace.files[path]))["Use Cases"][1]]
    for level in obj._strategy_level_columns():
        assert level[0] in headers, (level[0], headers)
    assert {"Theme", "Ambition", "Outcome", "Focus Area"} <= set(headers), headers


def test_a_model_that_refuses_temperature_or_structured_output_is_never_sent_either(docs):
    health = docs["LLM_ENDPOINT_HEALTH"]
    for endpoint in ("databricks-claude-haiku-5-5", "databricks-claude-opus-5-5"):
        assert health.accepts_temperature(endpoint) is False, endpoint
        assert health.accepts_json_format(endpoint) is False, endpoint
    assert health.accepts_temperature("databricks-claude-sonnet-4-6") is True
    assert health.accepts_temperature("databricks-claude-haiku-5-55") is True, "a version that only starts like a refusing one is not refused"
    obj = make_inspire(docs)
    _, temperature, response_format, _ = docs["AIAgent"]._llm_request_params(None, {"llm_endpoint_name": "databricks-claude-haiku-5-5"}, "BEST_OF_BEST_SCORING_PROMPT")
    assert temperature is None and response_format == ""
    assert docs["_probe_json_format"](None, "databricks-claude-opus-5-5", obj.logger) is False, "the probe returns before any request"


def test_a_documents_only_run_attaches_to_the_session_row_and_never_rewrites_it(docs, tmp_path, monkeypatch):
    def responder(statement):
        if statement.startswith("SELECT session_id"):
            return [{"session_id": 5150}]
        return []
    spark = FakeSpark(responder=responder)
    writer = _atomic_writer(docs, spark, tmp_path, monkeypatch, operation="Discover Use Cases", json_file_path=CATALOG,
                            generation_path="/Workspace/out", business="Acme")
    try:
        writer.initialize_session()
        session_writes = [s for s in spark.statements if "__inspire_session" in s and s.startswith(("MERGE", "UPDATE", "INSERT"))]
        assert session_writes and all(s.startswith("UPDATE") for s in session_writes), session_writes
        assert not any("generation_path" in s for s in session_writes)
    finally:
        writer._session_writer.stop(drain_timeout=5.0)
