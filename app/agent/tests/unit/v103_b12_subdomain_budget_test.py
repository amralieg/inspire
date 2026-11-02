"""v1.0.3 B12 — scale-adaptive per-call budget for SUBDOMAIN_DETECTOR_PROMPT.

Prior v1.0.2 bug (<internal-cli-profile>:tpcds session 1234567890000000018, RUNAWAY at 141 min):
  * `_detect_subdomains_for_domain` passed `timeout_override=self.llm_timeout_seconds`
    (300s) into `run_worker`.
  * `_call_ai_query` sliced attempt-1 timeout to `max(60, timeout*0.5+30)` = 180s.
  * At 13-domain scale (tpcds) with concurrent workers plus B11 temperature-rejection
    cascades, LLM latency exceeded 180s before any attempt succeeded. All attempts
    across all cascade models timed out. Pipeline produced 0 UCs before being
    cancelled at the 2h ship-gate cap.

v1.0.3 root-cause fix (§8.5 industry-agnostic — no hardcoded corpus lists):
  * New staticmethod `DatabricksInspire._compute_subdomain_call_budget(n_domains)`
    returns `max(300, 60 * n_domains)`.
  * `_detect_subdomains_for_domain` grows an optional
    `timeout_seconds_override` parameter that is forwarded to
    `run_worker(timeout_override=...)`.
  * Every dispatch site computes the budget from the LIVE domain count and passes it through.
    v1.2.0 E-04 folded the batched-sequential, progressive-parallel and sequential-fallback
    paths into one shared dispatcher, `_detect_subdomains_all_domains`, D2-16 removed the
    user-domain round-robin fallback distribution, and the user-domain path now delegates to the
    same dispatcher, so one dispatch site remains (parallel submit plus its sequential
    completion loop).
  * `[G34 SUBDOMAIN_BUDGET_ADAPTIVE FIRED]` sentinel logs the computed budget in the dispatcher.

Tests: pure formula unit tests + source-level wiring verification for every
call site (§8.4 anti-dead-code).
"""
import ast
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import agent_source, load_agent_namespace, method_node


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def test_helper_is_staticmethod_of_DatabricksInspire(ns):
    """`_compute_subdomain_call_budget` MUST be a staticmethod so unit tests can call it directly."""
    cls = ns["DatabricksInspire"]
    assert hasattr(cls, "_compute_subdomain_call_budget"), \
        "v1.0.3 B12: _compute_subdomain_call_budget helper must exist"
    # Staticmethod descriptor exposes __func__ on the class dict, and calling on class
    # (without instance) must work.
    raw = cls.__dict__.get("_compute_subdomain_call_budget")
    assert isinstance(raw, staticmethod), \
        "_compute_subdomain_call_budget must be a @staticmethod for direct-call testability"


def test_A_small_scale_floor(ns):
    """Test A: 4 domains -> 300s (floor). Small corpora unchanged."""
    fn = ns["DatabricksInspire"]._compute_subdomain_call_budget
    assert fn(4) == 300, f"expected 300s floor for n_domains=4, got {fn(4)}"


def test_B_large_scale_scales_linearly(ns):
    """Test B: 13 domains (tpcds scale) -> 780s (13 * 60)."""
    fn = ns["DatabricksInspire"]._compute_subdomain_call_budget
    assert fn(13) == 780, f"expected 780s for n_domains=13, got {fn(13)}"


def test_C_empty_input_tautology_probe(ns):
    """Test C (tautology probe per §8.3): 0 domains -> 300s (still floor, no crash)."""
    fn = ns["DatabricksInspire"]._compute_subdomain_call_budget
    assert fn(0) == 300, f"expected 300s floor for n_domains=0, got {fn(0)}"


def test_D_single_domain_stays_at_floor(ns):
    """Test D: 1 domain (60s naive) -> 300s (floor governs)."""
    fn = ns["DatabricksInspire"]._compute_subdomain_call_budget
    assert fn(1) == 300, f"expected 300s floor for n_domains=1, got {fn(1)}"


def test_E_linearity_above_floor(ns):
    """Test E: 10 domains -> 600, 20 domains -> 1200 (linear scaling above floor)."""
    fn = ns["DatabricksInspire"]._compute_subdomain_call_budget
    assert fn(10) == 600, f"expected 600s for n_domains=10, got {fn(10)}"
    assert fn(20) == 1200, f"expected 1200s for n_domains=20, got {fn(20)}"


def test_F_defensive_against_bad_input(ns):
    """§7.2 explicit error handling: `None` and non-numeric input MUST NOT crash."""
    fn = ns["DatabricksInspire"]._compute_subdomain_call_budget
    assert fn(None) == 300, "None input should still return the floor, not crash"
    assert fn("13") == 780, "string-numeric input should coerce and scale"
    assert fn(-5) == 300, "negative input should clamp to floor"


def test_G_signature_has_override_param(ns):
    """`_detect_subdomains_for_domain` MUST accept a `timeout_seconds_override` kwarg."""
    import inspect
    m = ns["DatabricksInspire"]._detect_subdomains_for_domain
    sig = inspect.signature(m)
    assert "timeout_seconds_override" in sig.parameters, \
        "v1.0.3 B12: _detect_subdomains_for_domain must accept timeout_seconds_override kwarg"
    param = sig.parameters["timeout_seconds_override"]
    assert param.default is None, \
        "timeout_seconds_override must default to None (fall back to self.llm_timeout_seconds)"


def test_H_run_worker_uses_effective_timeout(ns):
    """The run_worker call inside _detect_subdomains_for_domain must pass the effective timeout."""
    src = agent_source()
    # Verify effective timeout is computed as override-or-default
    assert re.search(
        r"_effective_timeout\s*=\s*timeout_seconds_override\s+if\s+timeout_seconds_override\s+is\s+not\s+None\s+else\s+self\.llm_timeout_seconds",
        src,
    ), "run_worker must be passed override-or-default via `_effective_timeout`"
    # And that it's actually used
    assert "timeout_override=_effective_timeout" in src, \
        "run_worker must use the computed _effective_timeout for its timeout_override"


def test_I_every_call_site_passes_budget(ns):
    """§8.4: every call site of _detect_subdomains_for_domain must pass the computed budget."""
    src = agent_source()
    direct_calls = re.findall(r"self\._detect_subdomains_for_domain\(", src)
    kw_call_sites = re.findall(
        r"_detect_subdomains_for_domain\([^)]*language[^)]*timeout_seconds_override=[^)]*\)",
        src,
    )
    assert direct_calls and len(kw_call_sites) == len(direct_calls), (
        f"every direct call must pass timeout_seconds_override: {len(direct_calls)} calls, "
        f"{len(kw_call_sites)} with the budget"
    )
    exec_submit_match = re.search(
        r"executor\.submit\(\s*[\S\s]*?self\._detect_subdomains_for_domain[\S\s]*?_subdomain_call_budget[\S\s]*?\)",
        src,
    )
    assert exec_submit_match is not None, \
        "executor.submit(..., self._detect_subdomains_for_domain, ...) must pass the budget as a positional arg"


def test_J_G34_sentinel_present_at_every_path(ns):
    """[G34 SUBDOMAIN_BUDGET_ADAPTIVE FIRED] sentinel must be emitted on every subdomain dispatch path:
    the shared dispatcher emits it, and both clustering paths reach subdomains only through it."""
    dispatcher = ast.unparse(method_node("DatabricksInspire", "_detect_subdomains_all_domains"))
    assert "[G34 SUBDOMAIN_BUDGET_ADAPTIVE FIRED]" in dispatcher
    for method in ("_assign_to_user_domains", "_cluster_domains_and_subdomains"):
        body = ast.unparse(method_node("DatabricksInspire", method))
        assert "_detect_subdomains_all_domains(" in body, method
        assert "self._detect_subdomains_for_domain(" not in body, method
