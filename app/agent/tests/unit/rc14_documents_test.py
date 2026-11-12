"""rc.14 (rc.11 lane L4): REQ-076 the exported Excel has a column for every strategy level, also when the workbook is
rebuilt on demand from the saved English catalog (docs-only mode, a fresh run object that never saw the strategy tree)."""
import io
import json

import openpyxl

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


def test_a_docs_only_rebuild_writes_an_excel_column_for_every_declared_strategy_level(docs, monkeypatch):
    path = saved_catalog(docs, monkeypatch)
    obj = make_inspire(docs)
    _ucs, _summary, grouped = obj._load_usecases_catalog_json(path)
    assert [level for level in obj.strategy_tree["levels"]] == LEVELS, "the saved catalog restores every declared level"
    obj.delivery_order = ["N01-U01", "N01-U02"]
    obj._generate_use_case_excel("English", "en", grouped)
    xlsx = next(p for p in obj.w_client.workspace.files if str(p).endswith(".xlsx"))
    sheet = openpyxl.load_workbook(io.BytesIO(obj.w_client.workspace.files[xlsx])).worksheets[0]
    headers = [cell.value for cell in next(sheet.iter_rows())]
    at = headers.index("Strategic Goals Alignment")
    assert headers[at + 1:at + 1 + len(LEVELS)] == LEVELS, headers


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
