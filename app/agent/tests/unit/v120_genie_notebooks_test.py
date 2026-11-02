"""v1.2.0 GENIE lane: one notebook path per use case (G-06), skeleton how-to that matches the skeleton (G-12),
notebook write failures raise or record a hard failed status (G-16), and the elite metadata card."""
import os
import sys
import types
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _agentload import agent_source, top_level_defs
from v120_genie_support import ORDERS, StatusRecorder, build_inspire, make_uc, schema_details


def _capture_writes(inst):
    writes = []

    def _write(notebook_dir, notebook_full_path, notebook_obj, use_case_id):
        writes.append({"dir": notebook_dir, "path": notebook_full_path, "obj": notebook_obj, "id": use_case_id})
        return notebook_full_path

    inst._write_notebook_to_workspace = _write
    return writes


def _cell_text(cell):
    return "".join(cell["source"]) if isinstance(cell["source"], list) else cell["source"]


def test_batch_writer_skeleton_genie_writers_and_url_resolver_share_one_path(agent_ns):
    inst = build_inspire(agent_ns)
    writes = _capture_writes(inst)
    with_instruction = make_uc("N01-U01", genie_instruction="instruction " + "x" * 200)
    without = make_uc("N01-U02")
    inst.assemble_use_case_notebooks([with_instruction, without], translations={})
    expected = {uc["No"]: inst._build_notebook_workspace_paths(uc)[1] for uc in (with_instruction, without)}
    assert {w["id"]: w["path"] for w in writes} == expected
    assert with_instruction["notebook_path"] == expected["N01-U01"] and without["notebook_path"] == expected["N01-U02"]

    resolver = build_inspire(agent_ns)
    resolver.w_client.workspace.get_status = MagicMock(return_value=types.SimpleNamespace(object_id=77))
    resolver.w_client.config.host = "https://host.example"
    assert resolver._get_use_case_notebook_url(with_instruction) == "https://host.example/editor/notebooks/77"
    assert resolver.w_client.workspace.get_status.call_args_list[0].args[0] == expected["N01-U01"][:-len(".ipynb")]


def test_batch_writer_writes_genie_notebooks_and_marker_skeletons(agent_ns):
    inst = build_inspire(agent_ns)
    writes = _capture_writes(inst)
    inst.assemble_use_case_notebooks([make_uc("N01-U01", genie_instruction="instruction " + "x" * 200), make_uc("N01-U02")], translations={})
    by_id = {w["id"]: "".join(_cell_text(c) for c in w["obj"]["cells"]) for w in writes}
    assert "Copy the cell below into Genie Code without the surrounding quotes" in by_id["N01-U01"] and 'r"""\ninstruction xxx' in by_id["N01-U01"]
    assert "run_contract_check(" not in by_id["N01-U01"]
    assert "generate_genie_code_instruction = False" not in by_id["N01-U01"]
    assert "generate_genie_code_instruction = False" in by_id["N01-U02"]


def test_skeleton_how_to_matches_a_notebook_without_an_instruction(agent_ns):
    inst = build_inspire(agent_ns)
    writes = _capture_writes(inst)
    inst._assemble_skeleton_notebook(make_uc())
    cell0 = _cell_text(writes[0]["obj"]["cells"][0])
    assert "print(genie_instruction)" not in cell0
    assert "Next step: generate the Genie Code instruction" in cell0 and "this one does not have it yet" in cell0
    assert "Operation = Generate Use Cases" in cell0
    all_text = "".join(_cell_text(c) for c in writes[0]["obj"]["cells"])
    assert "genie_instruction = " not in all_text


def test_write_notebook_raises_after_the_final_attempt(agent_ns, monkeypatch):
    import databricks.sdk.service.workspace as ws
    if not hasattr(ws, "ImportFormat"):
        monkeypatch.setattr(ws, "ImportFormat", types.SimpleNamespace(JUPYTER="JUPYTER"), raising=False)
    inst = build_inspire(agent_ns)
    inst.w_client.workspace.import_ = MagicMock(side_effect=RuntimeError("workspace quota exceeded"))
    with pytest.raises(RuntimeError, match="quota"):
        inst._write_notebook_to_workspace("/nb/d", "/nb/d/x.ipynb", {"cells": []}, "N01-U01")


def test_write_notebook_records_the_object_id(agent_ns, monkeypatch):
    import databricks.sdk.service.workspace as ws
    if not hasattr(ws, "ImportFormat"):
        monkeypatch.setattr(ws, "ImportFormat", types.SimpleNamespace(JUPYTER="JUPYTER"), raising=False)
    inst = build_inspire(agent_ns)
    inst.w_client.workspace.get_status = MagicMock(return_value=types.SimpleNamespace(path="/nb/d/x", object_id=99))
    assert inst._write_notebook_to_workspace("/nb/d", "/nb/d/x.ipynb", {"cells": []}, "N01-U01") == "/nb/d/x"
    assert inst._notebook_object_ids["N01-U01"] == 99


def test_skeleton_phase_records_a_hard_failed_status_when_a_write_fails(agent_ns):
    def skeleton(uc):
        if uc["No"] == "N01-U02":
            raise RuntimeError("import failed")
        return "/nb/ok.ipynb"

    recorder = StatusRecorder()
    inst = build_inspire(agent_ns, generate_genie_code_for="0", _assemble_skeleton_notebook=skeleton,
                         _emit_pipeline_status=recorder, _final_rank_key=lambda uc: (uc["No"],))
    ucs = [make_uc("N01-U01"), make_uc("N01-U02")]
    inst._run_discover_skeleton_phase(ucs, schema_details())
    assert ucs[0]["notebook_status"] == "skeleton" and ucs[0]["notebook_path"] == "/nb/ok.ipynb"
    assert ucs[1]["notebook_status"] == "write_failed" and "import failed" in ucs[1]["notebook_error"]
    complete = recorder.find("Generation")[0]
    assert complete["result_json"]["failed"] == 1 and complete["result_json"]["write_failed_ids"] == ["N01-U02"]
    assert complete["status"] == "ended_warning"


def test_skeleton_phase_never_downgrades_a_use_case_that_already_carries_an_instruction(agent_ns):
    written = {"genie": [], "skeleton": []}
    inst = build_inspire(agent_ns, generate_genie_code_for="0", _final_rank_key=lambda uc: (uc["No"],),
                         _assemble_genie_code_notebook=lambda uc, t: written["genie"].append(uc["No"]) or "/nb/genie.ipynb",
                         _assemble_skeleton_notebook=lambda uc: written["skeleton"].append(uc["No"]) or "/nb/skeleton.ipynb")
    reloaded = make_uc("N01-U01", genie_instruction="instruction from an earlier run " + "x" * 200, has_genie_code="Y")
    fresh = make_uc("N01-U02")
    inst._run_discover_skeleton_phase([reloaded, fresh], schema_details())
    assert written == {"genie": ["N01-U01"], "skeleton": ["N01-U02"]}
    assert reloaded["has_genie_code"] == "Y" and reloaded["notebook_status"] == "written"
    assert fresh["has_genie_code"] == "N" and fresh["notebook_status"] == "skeleton"


def test_genie_notebook_write_failure_keeps_the_skeleton_and_has_genie_code_n(agent_ns):
    inst = build_inspire(agent_ns, _assemble_genie_code_notebook=MagicMock(side_effect=RuntimeError("boom")))
    uc = make_uc(genie_instruction="instruction " + "x" * 200, genie_instruction_status="success",
                 notebook_path="/nb/skeleton.ipynb", has_genie_code="N")
    assert inst._deliver_genie_notebook(uc, {}) is False
    assert uc["notebook_status"] == "write_failed" and uc["notebook_path"] == "/nb/skeleton.ipynb" and uc["has_genie_code"] == "N"


def test_genie_notebook_is_never_delivered_for_a_failed_instruction(agent_ns):
    inst = build_inspire(agent_ns, _assemble_genie_code_notebook=MagicMock(return_value="/nb/g.ipynb"))
    uc = make_uc(genie_instruction="", genie_instruction_status="failed_validation")
    assert inst._deliver_genie_notebook(uc, {}) is False
    inst._assemble_genie_code_notebook.assert_not_called()


def test_metadata_card_shows_elite_fields_when_present(agent_ns):
    inst = build_inspire(agent_ns)
    uc = make_uc(quality_mode="Ultra High", elite_status="ELITE", elite_score=8.76, elite_assessment={
        "decision": "Which at-risk customers get a retention offer each week",
        "decision_owner": "Retention lead", "cadence": "weekly", "kpi": "90-day churn rate", "kpi_direction": "down",
        "value_driver": "`orders.amount` lost when `customers.segment` churns", "value_tier": "Material",
        "signal_columns": [f"{ORDERS}.amount", f"{ORDERS}.order_ts"], "time_column": f"{ORDERS}.order_ts",
        "entity_key_column": f"{ORDERS}.customer_id", "join_path": [ORDERS, "main.sales.customers"],
        "build_path": "Lakeflow job + MLflow model", "blockers": [], "red_team": "Offers may cannibalise margin",
        "red_team_verdict": "survives", "scores": {"business_value": 9, "evidence_strength": 8},
        "verdict": "ELITE", "verification": {"passed": True, "failures": []},
    })
    card = "".join(inst._build_use_case_details_markdown_source(uc))
    for expected in ("| **Quality Mode** | Ultra High |", "| **Elite Status** | Elite: met the Ultra High bar |",
                     "| **Elite Score** | 8.8 / 10 |", "| **Decision Changed** | Which at-risk customers get a retention offer each week |",
                     "| **KPI** | 90-day churn rate |", f"| **Signal Columns** | {ORDERS}.amount, {ORDERS}.order_ts |",
                     f"| **Join Path** | {ORDERS} -> main.sales.customers |", "| **Red Team Verdict** | survives |",
                     "| **Elite Dimension Scores** | business_value: 9; evidence_strength: 8 |",
                     "| **Metadata Verification** | passed |"):
        assert expected in card, expected
    assert "**Blockers**" not in card

    plain = "".join(inst._build_use_case_details_markdown_source(make_uc()))
    assert "Elite" not in plain and "Quality Mode" not in plain


def test_metadata_card_labels_domain_coverage_picks(agent_ns):
    inst = build_inspire(agent_ns)
    uc = make_uc(elite_status="DOMAIN_COVERAGE_PICK", coverage_pick_reason="Keeps user domain Sales represented")
    card = "".join(inst._build_use_case_details_markdown_source(uc))
    assert "| **Elite Status** | Domain coverage pick, below bar |" in card
    assert "| **Coverage Pick Reason** | Keeps user domain Sales represented |" in card


def test_metadata_card_rows_survive_pipes_newlines_and_zero_scores(agent_ns):
    inst = build_inspire(agent_ns)
    card = inst._build_use_case_details_markdown_source(make_uc(Statement="first line\nsecond | part", Priority=0))
    statement = next(row for row in card if row.startswith("| **Statement**"))
    assert statement == "| **Statement** | first line second / part |\n"
    assert "| **Priority** | 0 |\n" in card


def test_genie_notebook_warns_about_unverified_references(agent_ns):
    inst = build_inspire(agent_ns)
    writes = _capture_writes(inst)
    inst._assemble_genie_code_notebook(make_uc(genie_instruction="instruction " + "x" * 200, genie_instruction_status="validation_errors",
                                               genie_validation_errors=[f"{ORDERS}.ghost_col"]), {})
    texts = [_cell_text(c) for c in writes[0]["obj"]["cells"]]
    assert len(texts) == 4 and texts[2] == agent_ns["GENIE_NUMBER_TEXT_SOURCE"]
    note = texts[1].index("Before you build: Inspire could not find these tables or columns")
    assert f"{ORDERS}.ghost_col. Check each one with DESCRIBE TABLE" in texts[1] and note < texts[1].index("instruction xxx")

    clean = build_inspire(agent_ns)
    clean_writes = _capture_writes(clean)
    clean._assemble_genie_code_notebook(make_uc(genie_instruction="instruction " + "x" * 200, genie_instruction_status="success"), {})
    clean_texts = [_cell_text(c) for c in clean_writes[0]["obj"]["cells"]]
    controls = [t for t in clean_texts if t.startswith("# Run controls (Inspire, do not edit")]
    assert len(controls) == 1 and "Inspire could not count them" in controls[0], "the run controls carry their own runtime messages"
    assert not any("Before you build" in t for t in clean_texts)
    assert not any("Inspire could not" in t for t in clean_texts if t not in controls)
    unverified = build_inspire(agent_ns)
    unverified_writes = _capture_writes(unverified)
    unverified._assemble_genie_code_notebook(make_uc(genie_instruction="instruction " + "x" * 200, genie_instruction_status="unverified"), {})
    assert "Inspire could not check the tables and columns in this instruction" in _cell_text(unverified_writes[0]["obj"]["cells"][1])


def test_genie_notebook_uses_the_current_instruction_not_a_stale_escaped_copy(agent_ns):
    inst = build_inspire(agent_ns)
    writes = _capture_writes(inst)
    inst._assemble_genie_code_notebook(make_uc(genie_instruction="NEW instruction " + "x" * 200,
                                               genie_instruction_escaped="OLD instruction " + "y" * 200), {})
    text = "".join(_cell_text(c) for c in writes[0]["obj"]["cells"])
    assert "NEW instruction" in text and "OLD instruction" not in text


def test_retired_duplicate_notebook_writers_are_gone():
    defs = top_level_defs()["DatabricksInspire"]
    names = {n.name for n in defs.body if hasattr(n, "name")}
    assert "_assemble_single_use_case_notebook" not in names
    assert "_assemble_notebook_for_db" not in names
    src = agent_source()
    assert src.count("workspace.import_(\n                    path=notebook_full_path") == 1
