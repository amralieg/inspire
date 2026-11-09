"""v1.0.3 B10 — Hard-veto UCs are physically dropped after BoB scoring in ALL portfolio sizes.

Prior v1.0.2 bug (<internal-cli-profile>:nyctaxi session 1234567890000000017, UC N04-U31):
  * BoB scoring fires when portfolio >= bob_min_threshold (20).
  * Stratified trim fires only when portfolio > consolidation_trigger (75).
  * Hard-veto pre-filter lived INSIDE _stratified_trim_by_theme, so the
    20-75 UC band skipped it entirely and shipped bob_score=2.00 UCs.

v1.0.3 root-cause fix: new instance method `_drop_hard_veto_ucs`
called UNCONDITIONALLY in run() right after `_score_best_of_best`,
BEFORE the `_will_trim` branch. Emits `[G33 HARD_VETO_DROP FIRED]` when it fires.

Tests exercise the helper directly with a minimal instance harness.
"""
import ast
import logging
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import agent_source, load_agent_namespace, method_node


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


class _InstHarness:
    """Minimal harness that exposes `_drop_hard_veto_ucs` on an object with `.logger`."""

    def __init__(self, ns):
        self._logger = logging.getLogger("v103_b10_test")
        self._logger.setLevel(logging.INFO)
        # Bind the unbound method to this harness so `self.logger` resolves.
        self._impl = ns["DatabricksInspire"].__dict__["_drop_hard_veto_ucs"].__get__(self, self.__class__)
        cls = ns["DatabricksInspire"]
        self._record_gate_drops = cls.__dict__["_record_gate_drops"].__get__(self, self.__class__)
        self._RUN_OUTCOME_LOCK = cls._RUN_OUTCOME_LOCK
        self._finite_or = cls._finite_or

    @property
    def logger(self):
        return self._logger

    def drop(self, ucs):
        return self._impl(ucs)


def test_helper_exists_and_is_method_of_DatabricksInspire(ns):
    """B10 fix registered as a method on DatabricksInspire class."""
    cls = ns["DatabricksInspire"]
    assert hasattr(cls, "_drop_hard_veto_ucs"), \
        "v1.0.3 B10: _drop_hard_veto_ucs helper must exist on DatabricksInspire"
    assert callable(cls.__dict__["_drop_hard_veto_ucs"])


def test_A_must_drop_hard_veto_ucs(ns):
    """Test A (must-drop): UCs with bob_score capped at 2.0 AND bob_hard_veto_gate set MUST be dropped."""
    h = _InstHarness(ns)
    ucs = [
        {"No": "N01-U01", "bob_score": 2.00, "bob_hard_veto_gate": "D9", "use_case": "hard-veto floor"},
        {"No": "N01-U02", "bob_score": 2.01, "bob_hard_veto_gate": "D2", "use_case": "just above floor but veto set"},
        {"No": "N02-U01", "bob_score": 6.00, "bob_hard_veto_gate": None, "use_case": "healthy strong UC"},
    ]
    out = h.drop(ucs)
    assert len(out) == 1, f"expected 1 survivor, got {len(out)}"
    assert out[0]["No"] == "N02-U01", f"only bob_score=6.0 UC should survive, got {out[0]['No']}"


def test_B_tautology_probe_all_hard_veto(ns):
    """Test B (tautology probe per §8.3): if ALL UCs are hard-vetoed, output MUST be empty (not conservative-keep)."""
    h = _InstHarness(ns)
    ucs = [
        {"No": "N01-U01", "bob_score": 2.00, "bob_hard_veto_gate": "D5"},
        {"No": "N01-U02", "bob_score": 2.00, "bob_hard_veto_gate": "D10"},
        {"No": "N01-U03", "bob_score": 2.00, "bob_hard_veto_gate": "D14"},
    ]
    out = h.drop(ucs)
    assert out == [], f"all-hard-veto input MUST return empty list, got {out}"


def test_C_no_op_when_no_hard_veto(ns):
    """Test C: UCs without hard-veto gates pass through unchanged."""
    h = _InstHarness(ns)
    ucs = [
        {"No": "N01-U01", "bob_score": 7.5, "bob_hard_veto_gate": None},
        {"No": "N01-U02", "bob_score": 5.0, "bob_hard_veto_gate": ""},
        {"No": "N01-U03", "bob_score": 4.0, "bob_hard_veto_gate": "None"},
    ]
    out = h.drop(ucs)
    assert len(out) == 3, f"none should be dropped, got {len(out)}"
    assert [u["No"] for u in out] == ["N01-U01", "N01-U02", "N01-U03"]


def test_D_empty_input_no_crash(ns):
    """Test D: empty input returns empty list (no crash)."""
    h = _InstHarness(ns)
    assert h.drop([]) == []


def test_E_call_site_wired_in_run(ns):
    """§8.4 anti-dead-code: _drop_hard_veto_ucs must be reached from DatabricksInspire.run().
    v1.2.0 moved the post-scoring selection out of run() into _select_scored_use_cases, which
    calls _apply_best_of_best_selection, which calls _drop_hard_veto_ucs."""
    run_src = ast.unparse(method_node("DatabricksInspire", "run"))
    select_src = ast.unparse(method_node("DatabricksInspire", "_select_scored_use_cases"))
    bob_src = ast.unparse(method_node("DatabricksInspire", "_apply_best_of_best_selection"))
    assert "self._select_scored_use_cases(" in run_src, "run() must call _select_scored_use_cases"
    assert "self._apply_best_of_best_selection(" in select_src, \
        "_select_scored_use_cases must call _apply_best_of_best_selection"
    assert "self._drop_hard_veto_ucs(" in bob_src, \
        "v1.0.3 B10: _drop_hard_veto_ucs helper must be called on the run() selection path"


def test_F_call_site_after_score_best_of_best(ns):
    """The drop must happen AFTER _score_best_of_best in run() (bob fields must be populated first)."""
    src = agent_source()
    idx_bob = src.find("_score_best_of_best(")
    idx_drop = src.find("_drop_hard_veto_ucs(")
    assert idx_bob != -1, "_score_best_of_best call missing"
    assert idx_drop != -1, "_drop_hard_veto_ucs call missing"
    assert idx_drop > idx_bob, "_drop_hard_veto_ucs MUST be called after _score_best_of_best"


def test_G_sentinel_log_line_fires(ns, caplog):
    """G33 sentinel line fires when a hard-veto is dropped."""
    h = _InstHarness(ns)
    with caplog.at_level(logging.INFO, logger="v103_b10_test"):
        h.drop([
            {"No": "N01-U01", "bob_hard_veto_gate": "D9"},
            {"No": "N02-U01", "bob_hard_veto_gate": None},
        ])
    fired = [r for r in caplog.records if "[G33 HARD_VETO_DROP FIRED]" in r.getMessage()]
    assert fired, "sentinel `[G33 HARD_VETO_DROP FIRED]` must fire when hard-veto UCs are dropped"
