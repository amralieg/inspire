"""rc.14 (rc.11 lane L4): REQ-076, rewritten for FX-116 (REQ-503): a docs-only run restores every declared strategy level from the saved
English catalog (a fresh run object that never saw the strategy tree). The Excel workbook that used to show them is made by the App now."""
import json

from v120_artifacts_support import make_inspire
from v130_outputs_test import docs, foundations  # noqa: F401
from v211_strategy_directives_test import FOUR_LEVELS, portfolio

LEVELS = ["Theme", "Ambition", "Outcome", "Focus Area"]


def saved_catalog(docs_ns, monkeypatch):
    obj = make_inspire(docs_ns)
    obj.strategy_tree = docs_ns["parse_strategic_context"](json.dumps(FOUR_LEVELS))
    obj.docs_output_dir = "/Workspace/out/docs"
    obj.delivery_order = ["N01-U01", "N01-U02"]
    obj.data_foundations = foundations()
    grouped = portfolio()
    obj._save_usecases_catalog_json([uc for ucs in grouped.values() for uc in ucs], {}, {"Executive": "Exec"})
    path = next(p for p in obj.w_client.workspace.files if str(p).endswith("-dbx_inspire.json"))
    content = obj.w_client.workspace.files[path]
    monkeypatch.setitem(docs_ns, "read_user_file_bytes",
                        lambda text_path, w_client=None, limit=None: content if text_path == path else b"")
    return path


def test_a_docs_only_run_restores_every_declared_strategy_level_and_writes_no_excel(docs, monkeypatch):
    path = saved_catalog(docs, monkeypatch)
    obj = make_inspire(docs)
    _ucs, _summary, grouped = obj._load_usecases_catalog_json(path)
    assert [level for level in obj.strategy_tree["levels"]] == LEVELS, "the saved catalog restores every declared level"
    assert grouped, "the saved use cases come back grouped by domain"
    assert not hasattr(obj, "_generate_use_case_excel"), "the run writes no Excel workbook"
    assert not any(str(p).endswith(".xlsx") for p in obj.w_client.workspace.files)


def test_a_documents_only_run_writes_beside_the_catalog_it_reads_and_never_under_a_second_business_folder(agent_ns):
    fold = agent_ns["documents_base_folder"]
    assert fold("/Workspace/out", "acme", "/Workspace/out/acme/docs/Acme-dbx_inspire.json") == "/Workspace/out/acme"
    assert fold("/Workspace/out/acme", "acme", "/Workspace/out/acme/acme/docs/Acme-dbx_inspire.json") == "/Workspace/out/acme/acme", (
        "the folder Discover wrote is the one the documents join, however many business folders its path holds")


def test_a_renamed_business_still_writes_the_documents_beside_its_saved_catalog(agent_ns):
    fold = agent_ns["documents_base_folder"]
    assert fold("/Workspace/out", "acme renamed", "/Workspace/out/acme/docs/Acme-dbx_inspire.json") == "/Workspace/out/acme", (
        "the name typed now must not move the documents out of the folder that holds the catalog they are rebuilt from")


def test_a_fresh_discover_still_writes_under_the_session_folder_and_business_folder(agent_ns):
    fold = agent_ns["documents_base_folder"]
    assert fold("/Workspace/out", "acme") == "/Workspace/out/acme"
    assert fold("/Workspace/out", "acme", None) == "/Workspace/out/acme"


def test_the_initialiser_takes_its_output_folder_from_the_helper():
    import os
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "..", "..", "agent", "dbx_inspire_ai_agent.ipynb"), encoding="utf-8") as handle:
        notebook = json.load(handle)
    code = "".join("".join(cell["source"]) for cell in notebook["cells"] if cell["cell_type"] == "code")
    assert "self.base_output_dir = documents_base_folder(resolved_generation_path, _folder_name, self.json_file_path)" in code
    assert "self.base_output_dir = os.path.join(resolved_generation_path, _folder_name)" not in code


def test_a_regenerated_document_takes_the_business_name_typed_now_after_a_rename(docs, monkeypatch):
    path = saved_catalog(docs, monkeypatch)
    obj = make_inspire(docs)
    obj.business_name = "Acme Renamed"
    obj._load_usecases_catalog_json(path)
    assert obj.business_name == "Acme Renamed", "the name typed for this run names the documents, not the saved catalog's name"
    assert obj._catalog_file_name("English", "pdf") == "Acme Renamed-dbx_inspire.pdf"
