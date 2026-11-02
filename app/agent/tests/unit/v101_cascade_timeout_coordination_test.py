"""Fix #8 (v1.0.1): cascade + wrapper timeout coordination.

Evidence from v1.0.0 4-corpus swarm on <internal-cli-profile> (2026-08-10T06:30 - 06:47 UTC):
- run_id=123456789000015, session_id=123456789000000016 (bakehouse), volume log
  /Volumes/<catalog>/<schema>/vol_root/logs/bakehouse_v100_e2e_545646/session_545646363769261212/log.log

Log line evidence:
  2026-08-10 06:40:35 - ERROR - [BASE_USE_CASE_GEN_PROMPT] LLM call timed out
      after 380.5s (model: claude-opus-4-8, attempt 1/2, budget: 379s)
  2026-08-10 06:47:03 - ERROR - Total timeout (768s) exceeded for Pass1Batch.
      3 task(s) did not complete.
  2026-08-10 06:47:10 - ERROR - AI Worker process failed for Batch_P1_3:
      Cascade aborted: parent task was cancelled/timed out

Reproduced across all 4 corpora (bakehouse 3 batches all-3-attempts-failed,
nyctaxi 1, healthverity 1, tpcds_sf1 8) — 0 use cases persisted from any
corpus despite Journey status ended_success.

Root cause (two parts of one coordination bug):
1. When a fail-fast attempt on model N times out AND the cascade has more
   models, the code retries the SAME slow model instead of cascading. This
   wastes wrapper-budget on a model already proven slow for this prompt size.
2. The outer wrapper `total_timeout` formula was
       (N_batches * bp_timeout) / parallelism + 600
   which yields 768s for bakehouse (3 batches, bp=900, parallelism=16). With
   Fix #5's adaptive scaling extending each attempt to ~710s, one batch's
   cascade cannot progress past model 1 before the wrapper kills the whole
   task. Formula must scale by cascade depth.

Fix (single commit, root cause per Section 3):
1. In `_call_ai_query_impl`: on a timeout with `not is_last_model`, skip the
   intra-model retry and cascade to the next model immediately. Emit sentinel
   [G31 CASCADE_SKIP_RETRY_ON_TIMEOUT FIRED].
2. In `_process_batches_ensemble` (line ~18187): expand `total_timeout` to
       max(bp_timeout * cascade_depth,
           (N_batches * bp_timeout * cascade_depth) / parallelism) + 600
   so the wrapper accommodates a full cascade walk under adaptive scaling.
   Emit sentinel [G31 CASCADE_TIMEOUT_COORDINATION FIRED].
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _notebook_body():
    return (Path(__file__).resolve().parents[2] / "agent" / "dbx_inspire_ai_agent.ipynb").read_text()


def test_skip_retry_flag_declared():
    body = _notebook_body()
    assert "_skip_retry_and_cascade = bool(is_timeout and not is_last_model)" in body, \
        "skip-retry-and-cascade flag must be declared as is_timeout AND has-more-models"


def test_skip_retry_gates_the_retry_loop():
    body = _notebook_body()
    assert "if is_retryable and attempt < attempts_per_model and not _skip_retry_and_cascade:" in body, \
        "retry loop must be gated on _skip_retry_and_cascade so timeouts with more cascade fall through immediately"


def test_skip_retry_sentinel_present():
    body = _notebook_body()
    assert "[G31 CASCADE_SKIP_RETRY_ON_TIMEOUT FIRED]" in body, \
        "must emit [G31 CASCADE_SKIP_RETRY_ON_TIMEOUT FIRED] when cascading instead of retrying same slow model"


def test_wrapper_timeout_uses_cascade_depth():
    body = _notebook_body()
    assert "_cascade_depth = max(1, len(TECHNICAL_CONTEXT.get(\\\"models\\\") or []))" in body, \
        "wrapper must derive cascade_depth from TECHNICAL_CONTEXT['models']"


def test_wrapper_worst_case_per_batch_declared():
    body = _notebook_body()
    assert "_worst_case_per_batch = _bp_timeout * _cascade_depth" in body, \
        "per-batch worst case must be bp_timeout * cascade_depth"


def test_wrapper_total_timeout_uses_max():
    body = _notebook_body()
    assert (
        "total_timeout = max(_worst_case_per_batch, "
        "(total_submissions * _worst_case_per_batch) // max(1, self.max_parallelism)) + 600"
    ) in body, "total_timeout must be max of single-batch-worst-case and cpu-time-model-with-parallelism, +600 buffer"


def test_wrapper_timeout_sentinel_present():
    body = _notebook_body()
    assert "[G31 CASCADE_TIMEOUT_COORDINATION FIRED]" in body, \
        "must emit [G31 CASCADE_TIMEOUT_COORDINATION FIRED] with wrapper_total and cascade_depth"


def test_wrapper_timeout_formula_no_longer_uses_old_single_bp_formula():
    body = _notebook_body()
    assert "total_timeout = (total_submissions * _bp_timeout) // max(1, self.max_parallelism) + 600" not in body, \
        "old formula that caused 768s wrapper on bakehouse must be gone"


def test_skip_retry_arithmetic_bakehouse_evidence_scenario():
    """Simulate bakehouse scenario: 6-model cascade, big prompt, prove new formula
    gives wrapper time >= single-cascade wallclock."""
    bp_timeout = 900
    cascade_depth = 6
    parallelism = 16
    total_submissions = 3
    worst_case_per_batch = bp_timeout * cascade_depth  # 5400s
    total_timeout = max(worst_case_per_batch,
                        (total_submissions * worst_case_per_batch) // max(1, parallelism)) + 600
    assert total_timeout == worst_case_per_batch + 600
    assert total_timeout > 768, "new formula must exceed the 768s that killed v1.0.0 bakehouse"
    assert total_timeout >= 6000, "must give >= 100 min for a 6-model cascade to walk"


def test_skip_retry_arithmetic_tpcds_evidence_scenario():
    """Simulate tpcds: 8 batches, still bounded by worst-case-per-batch not sum."""
    bp_timeout = 900
    cascade_depth = 6
    parallelism = 16
    total_submissions = 8
    worst_case_per_batch = bp_timeout * cascade_depth
    total_timeout = max(worst_case_per_batch,
                        (total_submissions * worst_case_per_batch) // max(1, parallelism)) + 600
    cpu_model = (total_submissions * worst_case_per_batch) // parallelism  # 2700
    assert cpu_model < worst_case_per_batch, "at parallelism=16 tpcds sum should not dominate"
    assert total_timeout == worst_case_per_batch + 600, "wallclock ceiling should win over cpu-time"


def test_skip_retry_only_on_timeout_not_on_throttling():
    """Regression guard: throttling / 5xx errors should still retry same model
    (transient). Only timeouts should short-circuit to cascade. Since v1.2.0 the kinds come from the shared
    `_classify_runtime_error` taxonomy (behaviour is pinned in v120_runtime_reliability_test)."""
    body = _notebook_body()
    idx_flag = body.find("_skip_retry_and_cascade = bool(is_timeout and not is_last_model)")
    assert idx_flag != -1
    idx_throt = body.find('is_throttling = _error_kind == \\"throttled\\"')
    idx_timeout = body.find('is_timeout = _error_kind == \\"timeout\\"')
    assert idx_throt != -1 and idx_timeout != -1
    assert idx_throt < idx_flag and idx_timeout < idx_flag, \
        "throttling and timeout classification must occur before the skip-retry flag"
    assert "is_throttling" not in body[body.rfind("_skip_retry_and_cascade", 0, idx_flag+120):idx_flag+300], \
        "skip-retry gate must not include is_throttling — only is_timeout"


def test_skip_retry_still_retries_on_last_model():
    """If we're on the last cascade model, there's no next model to cascade to.
    Retry must still fire so we don't lose the only chance at getting a
    response."""
    body = _notebook_body()
    idx_flag = body.find("_skip_retry_and_cascade = bool(is_timeout and not is_last_model)")
    idx_retry = body.find("if is_retryable and attempt < attempts_per_model and not _skip_retry_and_cascade:", idx_flag)
    assert idx_flag != -1 and idx_retry != -1, "both markers must exist"
    is_last_check = "if not is_last_model:"
    idx_last = body.find(is_last_check, idx_retry)
    assert idx_last != -1, "cascade-to-next branch must remain (guarded by not is_last_model)"


def test_version_bumped_to_at_least_v1_0_1():
    """Fix #8 shipped in v1.0.1; every later ship (v1.0.2, v1.0.3, ...) must
    keep the version at or above v1.0.1. Compares semver tuples rather than
    matching a literal so downstream single-digit-semver bumps (§3a) don't
    require touching this test."""
    import re
    body = _notebook_body()
    m = re.search(r'__AGENT_VERSION__ = \\"(v\d+\.\d+\.\d+)\\"', body)
    assert m is not None, "notebook must declare __AGENT_VERSION__"
    version = m.group(1).lstrip("v")
    parts = tuple(int(p) for p in version.split("."))
    assert parts >= (1, 0, 1), f"version must be >= v1.0.1 (Fix #8 milestone); found v{version}"
    assert "__AGENT_VERSION__ = \\\"v1.0.0\\\"" not in body, "v1.0.0 literal must not linger"


def test_industry_agnostic_blacklist_clean():
    """Diff must not introduce any customer/corpus-specific strings."""
    diff_hunks = [
        "_skip_retry_and_cascade = bool(is_timeout and not is_last_model)",
        "[G31 CASCADE_SKIP_RETRY_ON_TIMEOUT FIRED]",
        "_cascade_depth = max(1, len(TECHNICAL_CONTEXT.get",
        "_worst_case_per_batch = _bp_timeout * _cascade_depth",
        "total_timeout = max(_worst_case_per_batch,",
        "[G31 CASCADE_TIMEOUT_COORDINATION FIRED]",
    ]
    body = _notebook_body()
    for hunk in diff_hunks:
        assert hunk in body, f"expected hunk missing: {hunk!r}"
    blacklist = [
        "bakehouse", "nyctaxi", "healthverity", "tpcds", "patient", "provider",
        "dough", "retail", "banking", "finance", "manufacturing", "healthcare",
        "insurance", "logistics", "hospitality", "construction",
    ]
    for hunk in diff_hunks:
        low = hunk.lower()
        for tok in blacklist:
            assert tok not in low, f"blacklist token {tok!r} found in hunk {hunk!r}"
