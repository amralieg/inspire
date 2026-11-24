"""REQ-077, rewritten for FX-116 (REQ-503): a finished session's catalogs are rebuilt from its stored English catalog (docs-only mode). The
rebuild reads the same use cases a run wrote, and a use case the user renamed appears under its new name in the CSV, Markdown and JSON
catalogs. The agent writes no PDF, presentation or Excel."""

from v120_artifacts_support import make_inspire
from v130_outputs_test import docs, foundations, value_uc  # noqa: F401
from v211_strategy_directives_test import portfolio, written

RENAMED = "Renamed churn score"


def session_portfolio():
    grouped = portfolio()
    uc = grouped["Sales"][0]
    uc.update({"original_name": uc["Name"], "Name": RENAMED, "usecase": RENAMED, "user_named": RENAMED})
    return grouped


def stored_catalog(docs_ns):
    obj = make_inspire(docs_ns)
    obj.docs_output_dir = "/Workspace/out/docs"
    obj.delivery_order = ["N01-U01", "N01-U02"]
    obj.data_foundations = foundations()
    grouped = session_portfolio()
    obj._save_usecases_catalog_json([uc for ucs in grouped.values() for uc in ucs], {}, {"Executive": "Exec"})
    path = next(p for p in obj.w_client.workspace.files if str(p).endswith("-dbx_inspire.json"))
    return path, obj.w_client.workspace.files[path]


def rebuilt(docs_ns, monkeypatch):
    path, content = stored_catalog(docs_ns)
    monkeypatch.setitem(docs_ns, "read_user_file_bytes", lambda text_path, w_client=None, limit=None: content if text_path == path else b"")
    obj = make_inspire(docs_ns)
    obj.docs_output_dir = "/Workspace/out/docs"
    ucs, summary, grouped = obj._load_usecases_catalog_json(path)
    assert [uc.get("user_named") for uc in ucs if uc.get("user_named")] == [RENAMED]
    obj.delivery_order = [uc["No"] for uc in ucs]
    obj.data_foundations = foundations()
    obj._generate_csv_catalog("English", "en", grouped)
    obj._generate_markdown_catalog("English", "en", grouped, summary, "Acme")
    obj._save_usecases_catalog_json(ucs, {}, summary)
    return obj


def test_a_rebuild_from_the_stored_catalog_writes_each_catalog_with_the_same_use_cases(docs, monkeypatch):
    obj = rebuilt(docs, monkeypatch)
    names = sorted(str(p).rsplit("/", 1)[-1] for p in obj.w_client.workspace.files)
    assert {"Acme-dbx_inspire.csv", "Acme-dbx_inspire.json", "readme.md"} <= set(names), names
    assert not [n for n in names if n.endswith((".xlsx", ".pdf", ".pptx"))], names


def test_a_renamed_use_case_appears_renamed_in_csv_markdown_and_json(docs, monkeypatch):
    obj = rebuilt(docs, monkeypatch)
    csv_text = written(obj, ".csv").lstrip("﻿")
    assert RENAMED in csv_text
    assert RENAMED in written(obj, "readme.md")
    assert RENAMED in written(obj, ".json")


def test_the_pdf_and_presentation_writers_are_gone(docs):
    for name in ("generate_catalog_pdf", "generate_presentation_pptx", "_generate_use_case_excel"):
        assert not hasattr(docs["DatabricksInspire"], name), name
