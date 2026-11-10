"""A use case name the user edits after the run is the name every notebook step reads back from the tracking row, and a rename
after the first implement keeps the result table the implement already wrote."""
import json

from v120_genie_support import RESULT, build_inspire, tracking_row

RENAMED = "Churn early warning"
ORIGINAL = "Predict churn risk"


def _row(**columns):
    return tracking_row(description=ORIGINAL, use_case=ORIGINAL, **columns)


def _renamed_row(**columns):
    return _row(user_use_case_name=RENAMED, **columns)


def test_the_stored_name_is_the_use_case_name_and_the_catalogue_name_is_kept(agent_ns):
    inst = build_inspire(agent_ns)
    uc = inst._row_to_uc(_renamed_row())
    assert uc["Name"] == RENAMED
    assert uc["usecase"] == RENAMED
    assert uc["user_named"] == RENAMED
    assert uc["original_name"] == ORIGINAL
    assert agent_ns["DatabricksInspire"]._user_named(uc) == RENAMED


def test_without_a_stored_name_the_catalogue_name_stands(agent_ns):
    inst = build_inspire(agent_ns)
    uc = inst._row_to_uc(_row(user_use_case_name=None))
    assert uc["Name"] == ORIGINAL
    assert "original_name" not in uc


def test_a_blank_stored_name_is_ignored(agent_ns):
    inst = build_inspire(agent_ns)
    uc = inst._row_to_uc(_row(user_use_case_name="   "))
    assert uc["Name"] == ORIGINAL


def test_a_rename_after_implement_keeps_the_result_table(agent_ns):
    inst = build_inspire(agent_ns)
    uc = inst._row_to_uc(_renamed_row())
    assert inst._genie_result_table(uc) == RESULT
    assert agent_ns["compute_result_table_name"](uc["No"], uc["Name"], "", "main.inspire", session_id=7) != RESULT


def test_the_genie_code_notebook_shows_the_renamed_use_case_and_the_stored_table(agent_ns):
    inst = build_inspire(agent_ns)
    uc = inst._row_to_uc(_renamed_row(genie_instruction="x", genie_instruction_status="success"))
    cells, spec = inst._genie_notebook_cells(uc, "Flag customers whose churn risk rose this week.")
    text = json.dumps(cells, default=str)
    assert f"# {uc['No']}: {RENAMED}" in text
    assert ORIGINAL not in text
    assert RESULT in json.dumps(spec, default=str)
