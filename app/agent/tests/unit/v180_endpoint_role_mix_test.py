"""Discover runs on samples.tpch ran every prompt on Claude Opus: the version parser read a one-number name such as
databricks-claude-opus-5 as 0.0.0 and the roster took the six newest endpoints of the first family, so every slot was
Opus and the worker roles (Sonnet, Haiku, GPT OSS) were served only by fallback. The listing below is the shape of a
real workspace serving list (names only)."""
from unittest.mock import MagicMock, patch

import pytest

WORKSPACE = [
    "databricks-gpt-6-1-terra", "databricks-gpt-6-1-sol", "databricks-gpt-5-6-sol", "databricks-gpt-6-astra", "databricks-gpt-5-5",
    "databricks-glm-5-3-flash", "databricks-glm-5-2", "databricks-kimi-k3", "databricks-claude-fable-5", "databricks-claude-fable-5-1",
    "databricks-claude-opus-4-7", "databricks-claude-opus-4-8", "databricks-claude-opus-5", "databricks-claude-opus-5-5",
    "databricks-gemini-3-5-flash", "databricks-gemini-3-5-flash-lite", "databricks-gemini-4-argon", "databricks-gpt-5-4",
    "databricks-gpt-5-5-pro", "databricks-gpt-5-4-mini", "databricks-claude-opus-4-6", "databricks-gpt-oss-120b",
    "databricks-claude-sonnet-5", "databricks-claude-sonnet-5-5", "databricks-claude-sonnet-4-6", "databricks-claude-sonnet-4-5",
    "databricks-claude-haiku-5-5", "databricks-claude-haiku-4-5", "databricks-gpt-oss-20b", "databricks-qwen3-next-80b-a3b-instruct",
    "databricks-qwen35-122b-a10b", "databricks-gemma-3-12b", "databricks-meta-llama-3-1-8b-instruct",
    "databricks-meta-llama-3-3-70b-instruct", "databricks-claude-opus-4-5", "databricks-claude-opus-4-1",
    "databricks-deepseek-v4-1-flash", "databricks-llama-4-maverick", "databricks-deepseek-v4-flash-0731", "my-team-opus-proxy",
]


class _Endpoint:
    def __init__(self, name):
        self.name = name


def _client(names):
    listing = [_Endpoint(n) for n in names]
    return lambda: MagicMock(serving_endpoints=MagicMock(list=lambda: iter(listing)))


def _detect(ns, names, max_endpoints=6):
    logger = MagicMock()
    with patch("databricks.sdk.WorkspaceClient", _client(names)):
        roster = ns["_auto_detect_llm_endpoints"](logger, max_endpoints=max_endpoints)
    return roster, " ".join(str(c) for c in logger.info.call_args_list)


@pytest.mark.parametrize("name,version", [
    ("databricks-claude-opus-5", (5, 0, 0)), ("databricks-claude-opus-5-5", (5, 5, 0)), ("databricks-claude-opus-4-8", (4, 8, 0)),
    ("databricks-meta-llama-3-3-70b-instruct", (3, 3, 0)), ("databricks-meta-llama-3-1-8b-instruct", (3, 1, 0)),
    ("databricks-gemma-3-12b", (3, 0, 0)), ("databricks-deepseek-v4-1-flash", (4, 1, 0)),
    ("databricks-deepseek-v4-flash-0731", (4, 0, 0)), ("databricks-gpt-5-5-pro", (5, 5, 0)), ("databricks-gpt-oss-120b", (0, 0, 0)),
    ("databricks-claude-3-7-sonnet", (3, 7, 0)), ("databricks-llama-4-maverick", (4, 0, 0)),
    ("databricks-claude-opus-4-20250514", (4, 0, 0)), ("databricks-gpt-6-1-terra", (6, 1, 0)), ("databricks-kimi-k3", (0, 0, 0)),
])
def test_the_version_parser_reads_every_name_shape_of_a_serving_list(agent_ns, name, version):
    assert agent_ns["_llm_endpoint_version"](name) == version


def test_a_one_number_version_ranks_between_the_older_and_newer_two_part_versions(agent_ns):
    parse = agent_ns["_llm_endpoint_version"]
    assert parse("databricks-claude-opus-4-8") < parse("databricks-claude-opus-5") < parse("databricks-claude-opus-5-5")
    assert parse("databricks-meta-llama-3-1-8b-instruct") < parse("databricks-meta-llama-3-3-70b-instruct"), \
        "a parameter count (8b, 70b) is never read as a version part"


def test_the_roster_serves_every_role_and_keeps_the_calibrated_judge(agent_ns):
    roster, logged = _detect(agent_ns, WORKSPACE)
    names = [m["llm_endpoint_name"] for m in roster]
    assert names == ["databricks-claude-opus-5-5", "databricks-claude-opus-4-8", "databricks-claude-sonnet-5-5",
                     "databricks-claude-sonnet-5", "databricks-claude-haiku-5-5", "databricks-gpt-oss-20b"]
    assert [(m["type"], m["size"]) for m in roster] == [("thinker", "large"), ("thinker", "large"), ("worker", "large"),
                                                        ("worker", "large"), ("worker", "small"), ("worker", "tiny")]
    assert [m["order"] for m in roster] == [1, 2, 3, 4, 5, 6]
    assert sum(1 for m in roster if m["family"] == "claude-opus") == 2, "never an all-Opus roster when other families serve"
    prompt_roles = {(p["model_type"], p["model_size"]) for p in agent_ns["TECHNICAL_CONTEXT"]["prompts_models"]}
    assert prompt_roles <= {(m["type"], m["size"]) for m in roster}, "every prompt role has its own endpoint"
    assert "version=5.5 endpoint=databricks-claude-opus-5-5" in logged
    assert ("[LLM_ENDPOINT_ROLE_MIX FIRED] thinker/large: databricks-claude-opus-5-5, databricks-claude-opus-4-8; worker/large: "
            "databricks-claude-sonnet-5-5, databricks-claude-sonnet-5; worker/small: databricks-claude-haiku-5-5; "
            "worker/tiny: databricks-gpt-oss-20b") in logged


def test_without_the_calibrated_judge_the_two_newest_opus_lead(agent_ns):
    roster, logged = _detect(agent_ns, [n for n in WORKSPACE if n != "databricks-claude-opus-4-8"])
    assert "family=claude-opus version=5 endpoint=databricks-claude-opus-5 " in logged
    assert [m["llm_endpoint_name"] for m in roster] == [
        "databricks-claude-opus-5-5", "databricks-claude-opus-5", "databricks-claude-sonnet-5-5", "databricks-claude-sonnet-5",
        "databricks-claude-haiku-5-5", "databricks-gpt-oss-20b"]


def test_two_slots_give_one_thinker_and_one_worker(agent_ns):
    roster, _ = _detect(agent_ns, ["databricks-claude-opus-4-6", "databricks-claude-opus-4-5", "databricks-claude-sonnet-4-6",
                                   "databricks-claude-sonnet-4-5"], max_endpoints=2)
    assert [m["llm_endpoint_name"] for m in roster] == ["databricks-claude-opus-4-6", "databricks-claude-sonnet-4-6"]


def test_a_workspace_with_one_family_still_fills_the_roster_from_it(agent_ns):
    roster, _ = _detect(agent_ns, ["databricks-claude-opus-4-5", "databricks-claude-opus-5", "databricks-claude-opus-4-6",
                                   "databricks-gemini-3-5-flash"])
    assert [m["llm_endpoint_name"] for m in roster] == ["databricks-claude-opus-5", "databricks-claude-opus-4-6",
                                                        "databricks-claude-opus-4-5"]
