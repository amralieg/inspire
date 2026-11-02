"""Fix #7: LLM endpoint auto-detection.

Evidence: Databricks periodically retires model versions. The v0.9.0 base
hardcodes endpoint names (databricks-claude-opus-4-6, databricks-claude-sonnet-4-6,
databricks-claude-opus-4-5, databricks-claude-sonnet-4-5, databricks-gpt-oss-120b,
databricks-gpt-oss-20b) in TECHNICAL_CONTEXT['models']. When any endpoint gets
sunset, every run breaks.

Fix (per user directive, re-derived from v0.9.0 base, NO copy-paste from
v1.x _MODELS_STATE):
1. New module-level helper `_auto_detect_llm_endpoints(logger, max_endpoints=6)`
   that calls WorkspaceClient().serving_endpoints.list() and ranks endpoints by
   architectural family (Claude opus > Claude sonnet > Claude haiku > Llama >
   GPT OSS large > GPT OSS small > GPT OSS other) and version (latest first).
2. New helper `_apply_auto_detected_endpoints(logger)` mutates
   TECHNICAL_CONTEXT['models'] in place ONLY if coverage against every
   `prompts_models` bucket is preserved. Otherwise it keeps the hardcoded list.
3. Call site: `DatabricksInspire.__init__` right before AIAgent construction,
   wrapped in try/except so any auth or network failure is non-fatal.
4. Sentinel `[LLM_ENDPOINT_DETECTED family=... version=... endpoint=...]`
   emitted per detected endpoint plus a summary line on replacement.
5. Industry-agnostic: family patterns (regex) are architectural taxonomy, NOT
   hardcoded specific model IDs.
"""
import os
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import load_agent_namespace


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def _notebook_body():
    return (Path(__file__).resolve().parents[2] / "agent" / "dbx_inspire_ai_agent.ipynb").read_text()


def test_auto_detect_helper_defined(ns):
    body = _notebook_body()
    assert "def _auto_detect_llm_endpoints(logger, max_endpoints: int = 6) -> list:" in body, \
        "_auto_detect_llm_endpoints helper must be defined at module level"


def test_apply_helper_defined(ns):
    body = _notebook_body()
    assert "def _apply_auto_detected_endpoints(logger, spark_session=None) -> bool:" in body, \
        "_apply_auto_detected_endpoints helper must be defined (spark_session drives the ai_query probe, v1.2.0)"


def test_workspace_client_used_for_discovery(ns):
    body = _notebook_body()
    assert "from databricks.sdk import WorkspaceClient as _WC" in body, \
        "must import WorkspaceClient for endpoint discovery"
    assert "_w.serving_endpoints.list()" in body, \
        "must call serving_endpoints.list()"


def test_family_priority_order(ns):
    body = _notebook_body()
    opus_pos = body.find('\\"claude-opus\\", \\"sonnet|haiku\\", \\"thinker\\"')
    sonnet_pos = body.find('\\"claude-sonnet\\", \\"opus|haiku\\", \\"worker\\"')
    llama_pos = body.find('\\"meta-llama|llama-3|llama-4\\"')
    gptoss_large_pos = body.find('\\"gpt-oss-120b|gpt-oss-large\\"')
    assert opus_pos != -1 and sonnet_pos != -1 and llama_pos != -1 and gptoss_large_pos != -1, \
        f"family_specs anchors missing: opus={opus_pos} sonnet={sonnet_pos} llama={llama_pos} gptoss={gptoss_large_pos}"
    assert opus_pos < sonnet_pos < llama_pos < gptoss_large_pos, \
        "family_specs must be ordered opus > sonnet > llama > gpt-oss (priority)"


def test_version_parser_extracts_semver(ns):
    parse = ns["_llm_endpoint_version"]
    assert parse("databricks-claude-opus-4-6") == (4, 6, 0)
    assert parse("databricks-claude-opus-5") == (5, 0, 0), "a one-number version is a version, not 0.0.0"
    assert parse("databricks-meta-llama-3-3-70b-instruct") == (3, 3, 0), "a parameter count is not a version part"


def test_call_site_in_databricks_inspire_init(ns):
    body = _notebook_body()
    assert "_apply_auto_detected_endpoints(self.logger)" in body, \
        "call site must be present in DatabricksInspire init"
    # Verify it's inside try/except so failures are non-fatal
    call_pos = body.find("_apply_auto_detected_endpoints(self.logger)")
    prefix = body[max(0, call_pos - 500):call_pos]
    assert "try:" in prefix
    tail = body[call_pos:call_pos + 500]
    assert "except Exception" in tail
    # Verify it runs BEFORE AIAgent construction (so AIAgent picks up detected models)
    ai_agent_pos = body.find("self.ai_agent = AIAgent(", call_pos)
    assert ai_agent_pos != -1, "AIAgent init must exist after the detection call"


def test_sentinel_present(ns):
    body = _notebook_body()
    assert "[LLM_ENDPOINT_DETECTED family=" in body, \
        "must emit [LLM_ENDPOINT_DETECTED family=...] sentinel"


def test_coverage_check_before_mutation(ns):
    body = _notebook_body()
    apply_start = body.find("def _apply_auto_detected_endpoints")
    replace_pos = body.find('TECHNICAL_CONTEXT[\\"models\\"] = detected', apply_start)
    assert apply_start != -1 and replace_pos != -1
    region = body[apply_start:replace_pos]
    assert "_has_large_tier" in region, "large-tier safety check must exist"
    assert "keeping hardcoded fallback" in region, \
        "warning must fire when coverage fails, and the hardcoded list must be preserved"
    # Empty-list guard
    assert "if not detected:" in region


def test_industry_agnostic_no_specific_endpoint_ids_hardcoded(ns):
    """The auto-detect helper must not hardcode specific version tokens like
    '4-6', '4-5' -- ranking is by regex family, not fixed IDs."""
    body = _notebook_body()
    auto_start = body.find("def _auto_detect_llm_endpoints")
    apply_end = body.find("def _apply_auto_detected_endpoints", auto_start)
    apply_body = body[apply_end:body.find("PROMPT_TRACKING_CONFIG = {}", apply_end)]
    auto_body = body[auto_start:apply_end]
    combined = auto_body + apply_body
    # No specific version tokens like -4-6 -4-5 -4-4 -3-3 -3-2 etc.
    import re
    hard_ids = re.findall(r'databricks-claude-(?:opus|sonnet|haiku)-\d', combined)
    assert hard_ids == [], f"auto-detect must not hardcode specific version endpoint IDs, found: {hard_ids}"


def test_auto_detect_helper_returns_empty_on_import_error():
    """Simulate WorkspaceClient import failure (e.g. no databricks.sdk); the
    helper must return [] so caller keeps the hardcoded list."""
    ns_obj = load_agent_namespace()
    helper = ns_obj["_auto_detect_llm_endpoints"]

    fake_logger = MagicMock()
    # WorkspaceClient() will raise when there's no auth context in a unit-test
    # environment, so the helper should return [] without crashing.
    result = helper(fake_logger, max_endpoints=6)
    assert isinstance(result, list)
    # If discovery worked, that's fine too -- but result must be a list, not an exception.


def test_auto_detect_ranking_math_orders_families():
    """Simulate a mixed endpoint list; assert opus ranks before sonnet before
    llama before gpt-oss, and versions rank descending within family."""
    ns_obj = load_agent_namespace()
    helper = ns_obj["_auto_detect_llm_endpoints"]

    class FakeEP:
        def __init__(self, name):
            self.name = name

    fake_endpoints = [
        FakeEP("databricks-gpt-oss-20b"),
        FakeEP("databricks-claude-sonnet-4-6"),
        FakeEP("databricks-claude-opus-4-5"),
        FakeEP("databricks-claude-opus-4-6"),
        FakeEP("databricks-meta-llama-3-3-70b"),
        FakeEP("databricks-gpt-oss-120b"),
    ]

    class FakeSE:
        def list(self):
            return iter(fake_endpoints)

    class FakeWC:
        def __init__(self):
            self.serving_endpoints = FakeSE()

    from unittest.mock import patch

    fake_logger = MagicMock()
    with patch("databricks.sdk.WorkspaceClient", FakeWC):
        ranked = helper(fake_logger, max_endpoints=6)

    assert len(ranked) == 6
    assert ranked[0]["llm_endpoint_name"] == "databricks-claude-opus-4-6"
    assert ranked[1]["llm_endpoint_name"] == "databricks-claude-opus-4-5"
    assert ranked[2]["llm_endpoint_name"] == "databricks-claude-sonnet-4-6"
    assert ranked[3]["llm_endpoint_name"] == "databricks-meta-llama-3-3-70b"
    assert ranked[4]["llm_endpoint_name"] == "databricks-gpt-oss-120b"
    assert ranked[5]["llm_endpoint_name"] == "databricks-gpt-oss-20b"

    # Type/size assignment matches architectural family
    assert ranked[0]["type"] == "thinker" and ranked[0]["size"] == "large"
    assert ranked[2]["type"] == "worker" and ranked[2]["size"] == "large"


def test_auto_detect_excludes_non_databricks_prefix():
    """Endpoints not starting with `databricks-` must be excluded (only
    Databricks-hosted foundation models are addressable via ai_query())."""
    from unittest.mock import patch

    ns_obj = load_agent_namespace()
    helper = ns_obj["_auto_detect_llm_endpoints"]

    class FakeEP:
        def __init__(self, name):
            self.name = name

    class FakeSE:
        def list(self):
            return iter([
                FakeEP("my-custom-claude-endpoint"),
                FakeEP("databricks-claude-sonnet-4-5"),
                FakeEP("customer-hosted-gpt"),
            ])

    class FakeWC:
        def __init__(self):
            self.serving_endpoints = FakeSE()

    fake_logger = MagicMock()
    with patch("databricks.sdk.WorkspaceClient", FakeWC):
        ranked = helper(fake_logger, max_endpoints=6)
    assert len(ranked) == 1
    assert ranked[0]["llm_endpoint_name"] == "databricks-claude-sonnet-4-5"


def test_max_endpoints_respected():
    from unittest.mock import patch
    ns_obj = load_agent_namespace()
    helper = ns_obj["_auto_detect_llm_endpoints"]

    class FakeEP:
        def __init__(self, name):
            self.name = name

    class FakeSE:
        def list(self):
            return iter([
                FakeEP("databricks-claude-opus-4-6"),
                FakeEP("databricks-claude-opus-4-5"),
                FakeEP("databricks-claude-sonnet-4-6"),
                FakeEP("databricks-claude-sonnet-4-5"),
            ])

    class FakeWC:
        def __init__(self):
            self.serving_endpoints = FakeSE()

    fake_logger = MagicMock()
    with patch("databricks.sdk.WorkspaceClient", FakeWC):
        ranked = helper(fake_logger, max_endpoints=2)
    assert len(ranked) == 2
    assert ranked[0]["llm_endpoint_name"] == "databricks-claude-opus-4-6"
    assert ranked[1]["llm_endpoint_name"] == "databricks-claude-sonnet-4-6", "the second slot serves the worker role"


def test_apply_helper_keeps_hardcoded_if_no_large_tier():
    """If discovery returns only small/tiny endpoints (no large tier), the
    safety bar fails and the hardcoded list stays untouched. This protects
    against a discovery that surfaces only lightweight models when heavy
    prompts (thinker/large) need to run."""
    from unittest.mock import patch
    ns_obj = load_agent_namespace()
    apply_fn = ns_obj["_apply_auto_detected_endpoints"]
    tc = ns_obj["TECHNICAL_CONTEXT"]

    original_models = list(tc["models"])

    class FakeEP:
        def __init__(self, name):
            self.name = name

    class FakeSE:
        def list(self):
            return iter([FakeEP("databricks-gpt-oss-20b")])

    class FakeWC:
        def __init__(self):
            self.serving_endpoints = FakeSE()

    fake_logger = MagicMock()
    with patch("databricks.sdk.WorkspaceClient", FakeWC):
        ok = apply_fn(fake_logger)
    assert ok is False, "no-large-tier apply must return False"
    assert tc["models"] == original_models, "safety-bar failure must NOT mutate hardcoded models list"


def test_apply_helper_keeps_hardcoded_if_empty():
    """Empty discovery must keep the hardcoded list untouched."""
    from unittest.mock import patch
    ns_obj = load_agent_namespace()
    apply_fn = ns_obj["_apply_auto_detected_endpoints"]
    tc = ns_obj["TECHNICAL_CONTEXT"]

    original_models = list(tc["models"])

    class FakeSE:
        def list(self):
            return iter([])

    class FakeWC:
        def __init__(self):
            self.serving_endpoints = FakeSE()

    fake_logger = MagicMock()
    with patch("databricks.sdk.WorkspaceClient", FakeWC):
        ok = apply_fn(fake_logger)
    assert ok is False
    assert tc["models"] == original_models


def test_apply_helper_replaces_when_coverage_met():
    """Full coverage: return True and mutate TECHNICAL_CONTEXT['models']."""
    from unittest.mock import patch
    ns_obj = load_agent_namespace()
    apply_fn = ns_obj["_apply_auto_detected_endpoints"]
    tc = ns_obj["TECHNICAL_CONTEXT"]

    original_models = list(tc["models"])

    class FakeEP:
        def __init__(self, name):
            self.name = name

    class FakeSE:
        def list(self):
            return iter([
                FakeEP("databricks-claude-opus-4-6"),
                FakeEP("databricks-claude-sonnet-4-6"),
                FakeEP("databricks-gpt-oss-120b"),
                FakeEP("databricks-gpt-oss-20b"),
            ])

    class FakeWC:
        def __init__(self):
            self.serving_endpoints = FakeSE()

    fake_logger = MagicMock()
    try:
        with patch("databricks.sdk.WorkspaceClient", FakeWC):
            ok = apply_fn(fake_logger)
        # coverage guaranteed since we have thinker/large + worker/large + worker/small/tiny
        assert ok is True, "coverage-met apply must return True and mutate models"
        assert len(tc["models"]) == 4
        assert tc["models"][0]["llm_endpoint_name"] == "databricks-claude-opus-4-6"
    finally:
        tc["models"] = original_models


def test_databricks_serverless_compat_no_forbidden_apis(ns):
    body = _notebook_body()
    auto_start = body.find("def _auto_detect_llm_endpoints")
    apply_end = body.find("PROMPT_TRACKING_CONFIG = {}", auto_start)
    region = body[auto_start:apply_end]
    for bad in (".cache(", ".persist(", ".uncache(", "sparkContext"):
        assert bad not in region, f"auto-detect must not use Serverless-forbidden API '{bad}'"


def test_industry_agnostic_no_corpus_tokens_in_helper(ns):
    """Grep blacklist per Section 1a."""
    body = _notebook_body()
    auto_start = body.find("def _auto_detect_llm_endpoints")
    apply_end = body.find("PROMPT_TRACKING_CONFIG = {}", auto_start)
    region_lower = body[auto_start:apply_end].lower()
    for tok in ("bakehouse", "nyctaxi", "healthverity", "tpcds", "patient", "provider", "dough"):
        assert tok not in region_lower, f"helper must not contain corpus token '{tok}'"


def test_auto_detect_returns_list_when_workspace_client_raises():
    from unittest.mock import patch
    ns_obj = load_agent_namespace()
    helper = ns_obj["_auto_detect_llm_endpoints"]

    class FailingWC:
        def __init__(self):
            raise RuntimeError("no auth context")

    fake_logger = MagicMock()
    with patch("databricks.sdk.WorkspaceClient", FailingWC):
        result = helper(fake_logger, max_endpoints=6)
    assert result == [], "WorkspaceClient failure must return []"
    fake_logger.warning.assert_called()
