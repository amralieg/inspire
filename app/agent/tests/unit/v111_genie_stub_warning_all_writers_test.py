"""v1.1.2 P33 -- the customer-appropriate Genie Code how-to applies to the skeleton writer and the batch path.

v1.1.0 landed the "prominent blockquote" how-to in the Genie writer; v1.1.1 extended it to the other writers and v1.1.2
stripped Databricks-internal jargon (``consumption dashboard``, ``billing attribution``, ``self-registers``) from all of
them. v1.3.0 reduces the Genie notebook to a title cell and the instruction (guarded in the v1.1.0 test file), so the
how-to block now lives only in the skeleton writer, and the batch fallback writes the two-cell Genie notebook.
"""
import os
import sys
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import agent_source, load_agent_namespace


POSITIVE_ANCHORS = (
    "Genie Code",
    "\u2318K",
    "Next step",
    "Operation = Generate Use Cases",
)

NEGATIVE_ANCHORS = (
    "\u26a0",
    "stub",
    "runnable",
    "Warning",
    "error",
    "failed",
    "consumption dashboard",
    "dashboard",
    "billing",
    "attribution",
    "self-registers",
    "dbx_inspire_ai_usecase",
)

WRITER_FUNCTIONS = (
    "_assemble_skeleton_notebook",
)

GENIE_NOTEBOOK_ANCHORS = (
    "Genie Code",
    "Copy the cell below into Genie Code without the surrounding quotes",
    "Disclaimer",
)


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def _fn_body(src, fn_name):
    fn_signature_prefix = f"def {fn_name}(self"
    fn_idx = src.find(fn_signature_prefix)
    assert fn_idx != -1, f"{fn_name!r} must remain a method of DatabricksInspire"
    body_end = src.find("\n    def ", fn_idx + 1)
    return src[fn_idx:body_end if body_end != -1 else None]


def _how_to_run_slice(body):
    start = body.find("how_to_run_source = [")
    assert start != -1, "how_to_run_source list missing"
    end = body.find("\n        ]", start)
    assert end != -1, "how_to_run_source list closing bracket missing"
    return body[start:end]


def test_A_all_three_writers_define_how_to_run_source():
    src = agent_source()
    for fn_name in WRITER_FUNCTIONS:
        body = _fn_body(src, fn_name)
        assert "how_to_run_source = [" in body, (
            f"v1.1.2 P33: {fn_name} MUST define how_to_run_source = [ ... ] "
            f"(customer-facing round-trip warning cell)"
        )
        idx_how = body.find("how_to_run_source = [")
        idx_title = body.find("title_source = [")
        assert 0 <= idx_how < idx_title, (
            f"v1.1.2 P33: in {fn_name}, how_to_run_source must precede title_source "
            f"(got how_to_run @{idx_how}, title @{idx_title})"
        )


def test_B_all_three_writers_carry_positive_anchors():
    src = agent_source()
    for fn_name in WRITER_FUNCTIONS:
        body = _fn_body(src, fn_name)
        htr = _how_to_run_slice(body)
        missing = [a for a in POSITIVE_ANCHORS if a not in htr]
        assert not missing, (
            f"v1.1.2 P33: in {fn_name}, how_to_run_source is missing positive anchors "
            f"{missing!r}. The how-to MUST name the next step, Genie Code, ⌘K and the Generate operation."
        )


def test_B2_a_healthy_skeleton_never_reads_as_a_failure():
    released = "> ## \u26a0\ufe0f This notebook is a Genie Code stub, not a runnable pipeline\n"
    assert {"\u26a0", "stub", "runnable"} <= {n for n in NEGATIVE_ANCHORS if n in released}
    for fn_name in WRITER_FUNCTIONS:
        htr = _how_to_run_slice(_fn_body(agent_source(), fn_name))
        assert "\u26a0" not in htr and "stub" not in htr.lower(), fn_name


def test_C_no_writer_leaks_internal_jargon():
    src = agent_source()
    for fn_name in WRITER_FUNCTIONS:
        body = _fn_body(src, fn_name)
        htr = _how_to_run_slice(body)
        present = [n for n in NEGATIVE_ANCHORS if n in htr]
        assert not present, (
            f"v1.1.2 P33: in {fn_name}, how_to_run_source leaks Databricks-internal jargon "
            f"{present!r}. Cell 0 is customer-facing; internal telemetry / dashboard / "
            f"billing / attribution language must not appear."
        )


def test_D_no_writer_uses_em_dash_in_warning():
    src = agent_source()
    for fn_name in WRITER_FUNCTIONS:
        body = _fn_body(src, fn_name)
        htr = _how_to_run_slice(body)
        assert "\u2014" not in htr, (
            f"v1.1.2 P33: in {fn_name}, how_to_run_source contains an em dash (U+2014). "
            f"Per §10 style rules the customer-facing warning must not use em dashes."
        )


def test_E_batch_fallback_writer_produces_customer_appropriate_cell_zero(ns):
    Klass = ns["DatabricksInspire"]
    inst = Klass.__new__(Klass)
    inst.logger = MagicMock()
    inst.notebook_output_dir = "/tmp/inspire_test_out"
    inst.business_name = "test-biz"
    inst.max_retry_attempts = 0
    inst.max_parallelism = 2
    inst.w_client = MagicMock()
    inst._notebook_object_ids = {}

    captured = []

    def _capture_write(notebook_dir, notebook_full_path, notebook_obj, use_case_id):
        captured.append(notebook_obj)
        return notebook_full_path

    inst._write_notebook_to_workspace = _capture_write

    uc = {
        "No": "T-U01", "Name": "test", "usecase": "test",
        "Business Domain": "d", "Subdomain": "s", "type": "test",
        "Analytics Technique": "AI Analysis", "Priority": "Medium",
        "Primary Table": "cat.sch.tab", "Tables Involved": "cat.sch.tab",
        "Statement": "s", "Solution": "sol", "Business Value": "v", "Quality": "q",
        "genie_instruction": "genie body " + "x" * 200,
    }
    inst.assemble_use_case_notebooks([uc], translations={}, summary_dict={})
    assert len(captured) == 1, "the batch fallback did not reach the shared notebook writer"
    cells = captured[0]["cells"]
    assert cells[0]["cell_type"] == "markdown", f"cell[0] type={cells[0]['cell_type']!r}"
    cell0_text = "".join(cells[0]["source"]) if isinstance(cells[0]["source"], list) else cells[0]["source"]
    assert len(cells) == 4 and cells[1]["cell_type"] == "code" and "genie body" in "".join(cells[1]["source"])
    assert "".join(cells[2]["source"]) == ns["GENIE_NUMBER_TEXT_SOURCE"]
    assert cells[3]["cell_type"] == "code" and "".join(cells[3]["source"]).rstrip().endswith("\ninspire_main()")
    missing_pos = [a for a in GENIE_NOTEBOOK_ANCHORS if a not in cell0_text]
    assert not missing_pos, (
        f"v1.1.2 P33: the batch fallback notebook cell[0] must carry all "
        f"positive anchors; missing {missing_pos!r}. cell[0] source was:\n{cell0_text}"
    )
    present_neg = [n for n in NEGATIVE_ANCHORS if n in cell0_text]
    assert not present_neg, (
        f"v1.1.2 P33: the batch fallback notebook cell[0] leaked internal "
        f"jargon {present_neg!r}. cell[0] source was:\n{cell0_text}"
    )


def test_F_skeleton_writer_produces_customer_appropriate_cell_zero(ns):
    Klass = ns["DatabricksInspire"]
    inst = Klass.__new__(Klass)
    inst.logger = MagicMock()
    inst.notebook_output_dir = "/tmp/inspire_test_out"
    inst.max_retry_attempts = 0
    inst.w_client = MagicMock()
    inst._sanitize_name = lambda s: (s or "unknown").replace(" ", "_").replace("/", "_")
    inst.session_id = 1
    inst._build_notebook_workspace_paths = lambda uc: ("/tmp/dir", "/tmp/out.ipynb", "out.ipynb")
    inst._build_use_case_details_markdown_source = lambda uc: ["details\n"]

    captured = {}

    def _capture_write(notebook_dir, notebook_full_path, notebook_obj, use_case_id):
        captured["obj"] = notebook_obj
        return notebook_full_path

    inst._write_notebook_to_workspace = _capture_write

    uc = {
        "No": "T-U02", "Name": "skel", "Business Domain": "d", "Subdomain": "s",
        "type": "test", "Analytics Technique": "AI Analysis", "Priority": "Medium",
        "Primary Table": "cat.sch.tab", "Tables Involved": "cat.sch.tab",
        "Statement": "s", "Solution": "sol", "Business Value": "v", "Quality": "q",
        "result_table": "cat.sch.tab_out",
    }
    inst._assemble_skeleton_notebook(uc)
    assert "obj" in captured, "assembly did not reach _write_notebook_to_workspace"
    nb = captured["obj"]
    cells = nb["cells"]
    assert cells[0]["cell_type"] == "markdown", f"cell[0] type={cells[0]['cell_type']!r}"
    cell0_text = "".join(cells[0]["source"]) if isinstance(cells[0]["source"], list) else cells[0]["source"]
    missing_pos = [a for a in POSITIVE_ANCHORS if a not in cell0_text]
    assert not missing_pos, (
        f"v1.1.2 P33: `_assemble_skeleton_notebook` emitted cell[0] must carry all "
        f"positive anchors; missing {missing_pos!r}. cell[0] source was:\n{cell0_text}"
    )
    present_neg = [n for n in NEGATIVE_ANCHORS if n in cell0_text]
    assert not present_neg, (
        f"v1.1.2 P33: `_assemble_skeleton_notebook` emitted cell[0] leaked internal jargon "
        f"{present_neg!r}. cell[0] source was:\n{cell0_text}"
    )


def test_G_version_constant_reflects_v1_1_2():
    """§3a single-digit semver — version rolls forward. Assert v1.1.2 or later
    so subsequent bumps (v1.1.3, v1.1.4, ...) don't regress this suite."""
    import re as _re

    src = agent_source()
    m = _re.search(r'__AGENT_VERSION__\s*=\s*"v(\d+)\.(\d+)\.(\d+)"', src)
    assert m, "__AGENT_VERSION__ must be declared once with the v<major>.<minor>.<patch> pattern"
    major, minor, patch = int(m.group(1)), int(m.group(2)), int(m.group(3))
    assert (major, minor, patch) >= (1, 1, 2), (
        f"__AGENT_VERSION__ must be at least v1.1.2 (the customer-jargon-strip fix); "
        f"got v{major}.{minor}.{patch}"
    )
