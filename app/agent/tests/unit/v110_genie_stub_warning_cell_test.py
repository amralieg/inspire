"""v1.1.2 P33 -- the first cell of a Genie Code notebook is customer-appropriate.

v1.1.0 put a Genie Code round-trip warning in cell[0] of the Genie notebook and v1.1.2 stripped
Databricks-internal jargon from it. v1.3.0 reduces the notebook to two cells, so cell[0] is the
only text the user reads besides the instruction:
    cell[0]  markdown  "# <id>: <name>", a short card, a one-line disclaimer, then the copy line
    cell[1]  code      the self-contained Genie Code instruction as a raw string

Regression coverage:
    A. The writer emits exactly those two cells, title first.
    B. Positive anchors are present in cell[0].
    C. Databricks-internal jargon never appears in cell[0].
    D. cell[0] has no em dash and cell[1] carries the instruction verbatim, with no harness left.
    E. Non-tautology probe for the negative-anchor check.
    F. Version guard: `__AGENT_VERSION__` is at least v1.1.2.
"""
import os
import sys
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import agent_source, load_agent_namespace


POSITIVE_ANCHORS = (
    "Genie Code",
    "Copy the cell below into Genie Code without the surrounding quotes",
    "Disclaimer",
)

NEGATIVE_ANCHORS = (
    "consumption dashboard",
    "dashboard",
    "billing",
    "attribution",
    "self-registers",
    "dbx_inspire_ai_usecase",
)


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def _assemble(ns):
    Klass = ns["DatabricksInspire"]
    inst = Klass.__new__(Klass)
    inst.logger = MagicMock()
    inst.notebook_output_dir = "/tmp/inspire_test_out"
    inst.max_retry_attempts = 0
    inst.w_client = MagicMock()
    inst._sanitize_name = lambda s: (s or "unknown").replace(" ", "_").replace("/", "_")
    captured = {}

    def _capture_write(notebook_dir, notebook_full_path, notebook_obj, use_case_id):
        captured["obj"] = notebook_obj
        return notebook_full_path

    inst._write_notebook_to_workspace = _capture_write
    uc = {
        "No": "T-U01", "Name": "Test use case for cell-0 warning assertion", "Business Domain": "TestDomain",
        "Subdomain": "TestSub", "type": "test", "Analytics Technique": "AI Analysis", "Priority": "Medium",
        "Primary Table": "cat.sch.tab", "Tables Involved": "cat.sch.tab", "Statement": "test", "Solution": "test",
        "Business Value": "test", "Quality": "test", "result_table": "cat.sch.tab_out",
        "genie_instruction": "genie_instruction body -- non-empty long enough > 100 chars " + "x" * 100,
    }
    inst._assemble_genie_code_notebook(uc, translations={})
    assert "obj" in captured, "assembly did not reach _write_notebook_to_workspace"
    return [("".join(c["source"]) if isinstance(c["source"], list) else c["source"], c["cell_type"]) for c in captured["obj"]["cells"]]


def test_A_the_writer_emits_four_cells_title_first(ns):
    cells = _assemble(ns)
    assert [kind for _text, kind in cells] == ["markdown", "code", "code", "code"]
    assert cells[0][0].startswith("# T-U01: Test use case for cell-0 warning assertion\n")


def test_B_positive_anchors_present_in_cell_zero(ns):
    cell0 = _assemble(ns)[0][0]
    missing = [a for a in POSITIVE_ANCHORS if a not in cell0]
    assert not missing, f"cell[0] must contain all positive anchors; missing {missing!r}. cell[0] was:\n{cell0}"


def test_C_negative_anchors_absent_in_cell_zero(ns):
    cell0 = _assemble(ns)[0][0]
    present = [n for n in NEGATIVE_ANCHORS if n in cell0]
    assert not present, f"cell[0] must NOT contain Databricks-internal jargon; found {present!r}"


def test_D_cell_zero_has_no_em_dash_and_cell_one_is_the_instruction(ns):
    cells = _assemble(ns)
    assert "\u2014" not in cells[0][0]
    assert cells[1][0].startswith('r"""\n') and "genie_instruction body -- non-empty" in cells[1][0]
    every = "".join(text for text, _kind in cells)
    for gone in ("print(genie_instruction)", "run_contract_check(", "GENIE SLOT", "## 0. Use-case card"):
        assert gone not in every, gone


def test_E_negative_anchor_check_is_not_a_tautology():
    """§8.3 probe: the negative-anchor check MUST reject a text that contains internal
    jargon. Construct a poisoned cell-0 and confirm every negative anchor would fire.
    Without this probe, the negative-anchor test could pass on an empty string."""
    poisoned = (
        "> ## Warning: this notebook is a stub that self-registers with the Inspire "
        "consumption dashboard for billing attribution. Tag dbx_inspire_ai_usecase.\n"
    )
    caught = [n for n in NEGATIVE_ANCHORS if n in poisoned]
    assert set(caught) == set(NEGATIVE_ANCHORS), (
        f"§8.3 probe: every negative anchor must be catchable. Poisoned text contained "
        f"only {caught!r}; missing {set(NEGATIVE_ANCHORS) - set(caught)!r}. "
        f"If the NEGATIVE_ANCHORS list grows, extend this poisoned string too."
    )


def test_F_version_constant_at_least_v1_1_2():
    """Post v1.1.2 the version rolls forward per §3a single-digit semver. The
    ratchet is that the v1.1.2 fix must remain in a released version, i.e.
    __AGENT_VERSION__ must be at least v1.1.2 (the version that bundled the
    customer-jargon strip). Later single-digit versions (v1.1.3, v1.1.4, ...)
    satisfy this contract."""
    import re as _re

    src = agent_source()
    m = _re.search(r'__AGENT_VERSION__\s*=\s*"v(\d+)\.(\d+)\.(\d+)"', src)
    assert m, "__AGENT_VERSION__ must be declared once with the v<major>.<minor>.<patch> pattern"
    major, minor, patch = int(m.group(1)), int(m.group(2)), int(m.group(3))
    assert (major, minor, patch) >= (1, 1, 2), (
        f"__AGENT_VERSION__ must be at least v1.1.2 (the customer-jargon-strip fix); "
        f"got v{major}.{minor}.{patch}"
    )
