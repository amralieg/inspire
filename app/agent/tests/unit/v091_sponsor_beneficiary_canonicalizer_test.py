"""Fix #6: LLM-driven Sponsor + Beneficiary canonical dedupe.

Evidence: user has reported seeing sponsor/beneficiary duplicates like
'CFO' vs 'Chief Financial Officer' in past runs, making the catalog look
inconsistent across use cases.

Fix (per Section 3c reinforcement 8/9 1:16 PM — LLM-driven, NOT regex):
1. New pass `_canonicalize_sponsor_beneficiary_roles(use_cases)` in
   `DatabricksInspire` that:
   a. Collects all unique Sponsor + Beneficiary field values.
   b. Filters out entries already in the per-run cache.
   c. Calls the LLM once (batched) with an industry-agnostic role-taxonomy
      prompt to produce {input: canonical} mappings.
   d. Applies the canonical mapping back to the use cases, updating Sponsor
      and Beneficiary field values in place.
2. Cache is `self._sponsor_role_cache: dict[str, str]` keyed by normalized
   input (lower+strip); persists for the duration of the run.
3. Called from `_phaseQ_run_integrity_gates` AFTER Q5 (so dedup keys are
   preserved intact; only the free-form label fields get canonicalized).
4. Industry-agnostic — no hardcoded corpus tokens (grep blacklist enforced).
5. Sentinel `[SPONSOR_CANONICAL FIRED]` emitted when the LLM completes
   and again when field values are actually rewritten.
"""
import json
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import load_agent_namespace


BLACKLIST_TOKENS = [
    "bakehouse", "nyctaxi", "healthverity", "tpcds", "patient", "provider",
    "dough", "taxi", "hospital", "retail", "bakery", "healthcare",
    "snowflake", "databricks", "dbfs", "glue", "redshift",
]


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def _notebook_body():
    return (Path(__file__).resolve().parents[2] / "agent" / "dbx_inspire_ai_agent.ipynb").read_text()


def _canonicalizer_source_block():
    body = _notebook_body()
    start = body.find("def _canonicalize_sponsor_beneficiary_roles")
    assert start != -1, "canonicalizer method must be defined"
    end_anchor = body.find("def _phaseL_final_gate", start)
    assert end_anchor != -1, "block end anchor missing"
    return body[start:end_anchor]


def test_canonicalizer_method_defined(ns):
    body = _notebook_body()
    assert "def _canonicalize_sponsor_beneficiary_roles(self, use_cases: list) -> list:" in body, \
        "canonicalizer method must be defined with the correct signature"


def test_canonicalizer_wired_into_phaseQ_pipeline(ns):
    body = _notebook_body()
    assert "kept = self._canonicalize_sponsor_beneficiary_roles(kept)" in body, \
        "canonicalizer must be invoked inside _phaseQ_run_integrity_gates"
    # canonicalizer runs AFTER Q5 (post-dedup) so dedup keys aren't perturbed
    q5_pos = body.find("kept, q5_dropped = self._phaseQ5_decision_readiness")
    q6_pos = body.find("kept = self._canonicalize_sponsor_beneficiary_roles(kept)")
    assert q5_pos != -1 and q6_pos != -1
    assert q6_pos > q5_pos, "canonicalizer must run AFTER Q5 (post-dedup)"


def test_canonicalizer_uses_llm_not_regex(ns):
    src = _canonicalizer_source_block()
    assert "self.ai_agent._call_ai_query" in src, \
        "canonicalizer must dispatch to the LLM per Section 3c reinforcement"
    assert "role_canonicalization" in src, "must pass a structured response schema"


def test_canonicalizer_has_per_run_cache(ns):
    src = _canonicalizer_source_block()
    assert "self._sponsor_role_cache" in src, \
        "canonicalizer must cache results per-run in self._sponsor_role_cache"
    assert 'hasattr(self, \\"_sponsor_role_cache\\")' in src, \
        "cache initialisation must be lazy-guarded"


def test_canonicalizer_only_llm_calls_uncached_inputs(ns):
    src = _canonicalizer_source_block()
    assert "to_canonicalize = sorted(r for r in unique_raw if _norm(r) not in self._sponsor_role_cache)" in src, \
        "only uncached inputs should be sent to the LLM"


def test_canonicalizer_fires_sentinel(ns):
    body = _notebook_body()
    assert "[SPONSOR_CANONICAL FIRED]" in body, \
        "sentinel [SPONSOR_CANONICAL FIRED] must be logged"


def test_canonicalizer_updates_only_sponsor_and_beneficiary(ns):
    src = _canonicalizer_source_block()
    # Fields iterated for both collection and rewrite
    field_iters = src.count('for field in (\\"Sponsor\\", \\"Beneficiary\\"):')
    assert field_iters >= 2, "must iterate Sponsor+Beneficiary tuple during collect AND apply"
    # No other UC field should be touched
    for other_field in ("Name", "Statement", "Solution", "Analytics Technique", "Business Value"):
        assert f'uc[\\"{other_field}\\"]' not in src, f"must not touch {other_field} field"


def test_canonicalizer_is_industry_agnostic_no_corpus_tokens(ns):
    src = _canonicalizer_source_block()
    src_lower = src.lower()
    for token in BLACKLIST_TOKENS:
        assert token not in src_lower, \
            f"industry-agnostic violation: canonicalizer contains blacklisted token '{token}'"


def test_canonicalizer_non_fatal_on_llm_failure(ns):
    src = _canonicalizer_source_block()
    assert "canonicalizer failed non-fatally" in src or "canonicalizer LLM step failed non-fatally" in src, \
        "LLM failures must not crash the pipeline"
    assert "self._sponsor_role_cache.setdefault(_norm(r), r)" in src, \
        "on LLM failure, roles must be cached with identity map so subsequent calls don't retry"


def test_canonicalizer_phaseQ_call_wrapped_in_try_except(ns):
    body = _notebook_body()
    q_start = body.find("def _phaseQ_run_integrity_gates")
    canon_call = body.find("kept = self._canonicalize_sponsor_beneficiary_roles(kept)", q_start)
    assert canon_call != -1
    prefix = body[q_start:canon_call]
    assert prefix.rfind("try:") != -1
    # Ensure the try:/except:/warning pattern is used
    tail = body[canon_call:canon_call + 400]
    assert "except Exception" in tail, "call site must be wrapped in try/except so failures are non-fatal"


def test_canonicalizer_llm_prompt_uses_llm_taxonomy_not_regex():
    """Behavioral test: simulate the mapping via a mocked LLM contract to
    verify that CFO -> Chief Financial Officer is applied to use cases."""
    from unittest.mock import MagicMock

    # Build a minimal DatabricksInspire-like object with just the pieces we need
    class Fake:
        pass

    fake = Fake()
    fake.logger = MagicMock()

    class FakeAgent:
        def __init__(self, mapping):
            self.mapping = mapping
            self.calls = 0

        def _call_ai_query(self, prompt, prompt_name, response_schema=None, display_name=None):
            self.calls += 1
            entries = [{"input": k, "canonical": v} for k, v in self.mapping.items()]
            return json.dumps({"roles": entries})

    canonicalize_map = {
        "CFO": "Chief Financial Officer",
        "Chief Financial Officer": "Chief Financial Officer",
        "Head of Ops": "Head of Operations",
        "VP of Operations": "Head of Operations",
    }
    fake.ai_agent = FakeAgent(canonicalize_map)

    ns_obj = load_agent_namespace()
    method = ns_obj["DatabricksInspire"]._canonicalize_sponsor_beneficiary_roles

    ucs = [
        {"No": "N01-U01", "Sponsor": "CFO", "Beneficiary": "VP of Operations"},
        {"No": "N01-U02", "Sponsor": "Chief Financial Officer", "Beneficiary": "Head of Ops"},
        {"No": "N01-U03", "Sponsor": "Head of Ops", "Beneficiary": "CFO"},
    ]
    method(fake, ucs)

    for uc in ucs:
        assert uc["Sponsor"] in ("Chief Financial Officer", "Head of Operations"), \
            f"Sponsor not canonicalized: {uc}"
        assert uc["Beneficiary"] in ("Chief Financial Officer", "Head of Operations"), \
            f"Beneficiary not canonicalized: {uc}"

    # After canonicalization, both CFO and Chief Financial Officer converge
    sponsors = {uc["Sponsor"] for uc in ucs}
    beneficiaries = {uc["Beneficiary"] for uc in ucs}
    assert "CFO" not in sponsors and "CFO" not in beneficiaries, \
        "CFO must be replaced with canonical form"
    assert "Head of Ops" not in sponsors and "Head of Ops" not in beneficiaries, \
        "Head of Ops must be replaced with canonical form (Head of Operations)"
    assert "VP of Operations" not in beneficiaries, \
        "VP of Operations must be replaced with canonical form"


def test_canonicalizer_caches_and_only_calls_llm_once_across_invocations():
    """Behavioral test: same input across two invocations should trigger the
    LLM only once (per-run cache reuse)."""
    import json as _json
    from unittest.mock import MagicMock

    class Fake:
        pass

    fake = Fake()
    fake.logger = MagicMock()

    class FakeAgent:
        def __init__(self):
            self.calls = 0

        def _call_ai_query(self, prompt, prompt_name, response_schema=None, display_name=None):
            self.calls += 1
            return _json.dumps({"roles": [{"input": "CFO", "canonical": "Chief Financial Officer"}]})

    fake.ai_agent = FakeAgent()

    ns_obj = load_agent_namespace()
    method = ns_obj["DatabricksInspire"]._canonicalize_sponsor_beneficiary_roles

    ucs = [{"No": "1", "Sponsor": "CFO", "Beneficiary": ""}]
    method(fake, ucs)
    assert fake.ai_agent.calls == 1

    ucs2 = [{"No": "2", "Sponsor": "CFO", "Beneficiary": ""}]
    method(fake, ucs2)
    assert fake.ai_agent.calls == 1, "second invocation must reuse cache, not call LLM again"
    assert ucs2[0]["Sponsor"] == "Chief Financial Officer"


def test_canonicalizer_preserves_unmapped_verbatim():
    """Contract test: if LLM returns a role verbatim (i.e. not a known
    C-suite pattern), the field value must not change."""
    import json as _json
    from unittest.mock import MagicMock

    class Fake:
        pass

    fake = Fake()
    fake.logger = MagicMock()

    class FakeAgent:
        def _call_ai_query(self, prompt, prompt_name, response_schema=None, display_name=None):
            return _json.dumps({"roles": [{"input": "Ops Manager Alice", "canonical": "Ops Manager Alice"}]})

    fake.ai_agent = FakeAgent()
    ns_obj = load_agent_namespace()
    method = ns_obj["DatabricksInspire"]._canonicalize_sponsor_beneficiary_roles

    ucs = [{"No": "1", "Sponsor": "Ops Manager Alice", "Beneficiary": ""}]
    method(fake, ucs)
    assert ucs[0]["Sponsor"] == "Ops Manager Alice", \
        "personal-name-shaped role must be preserved verbatim by the LLM"


def test_empty_use_cases_short_circuits():
    from unittest.mock import MagicMock

    class Fake:
        pass

    fake = Fake()
    fake.logger = MagicMock()

    fake.ai_agent = MagicMock()

    ns_obj = load_agent_namespace()
    method = ns_obj["DatabricksInspire"]._canonicalize_sponsor_beneficiary_roles

    method(fake, [])
    fake.ai_agent._call_ai_query.assert_not_called()


def test_no_ucs_with_only_missing_fields_dont_trigger_llm():
    from unittest.mock import MagicMock

    class Fake:
        pass

    fake = Fake()
    fake.logger = MagicMock()

    fake.ai_agent = MagicMock()

    ns_obj = load_agent_namespace()
    method = ns_obj["DatabricksInspire"]._canonicalize_sponsor_beneficiary_roles

    method(fake, [{"No": "1", "Sponsor": "", "Beneficiary": None}])
    fake.ai_agent._call_ai_query.assert_not_called()


def test_diff_industry_agnostic_grep_blacklist():
    """Grep the entire canonicalizer block for the 22-token blacklist per
    Section 1a. This is the enforcement of §8.5 (industry-agnostic)."""
    src = _canonicalizer_source_block().lower()
    for tok in BLACKLIST_TOKENS:
        assert tok not in src, f"canonicalizer must not contain corpus/industry token '{tok}'"


def test_databricks_serverless_compat_no_cache_persist():
    """§2 — Databricks Serverless has no support for cache/persist/uncache/sparkContext."""
    src = _canonicalizer_source_block()
    for bad in (".cache(", ".persist(", ".uncache(", "sparkContext"):
        assert bad not in src, f"canonicalizer must not use Serverless-incompatible API '{bad}'"
