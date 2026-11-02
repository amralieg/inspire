"""v1.2.0 ELITE lane: dedup keeps the stronger twin (D2-11) and the fallback no longer needs domains.

The review prompt returns only the ids to keep. When the caller has scores (`rank`), every removed
use case is paired with its closest kept twin under the shared `_uc_dedup_signature`, and the
better-ranked member of the pair survives. Without `rank` the LLM decision is unchanged. The
fallback groups by Business Domain when every use case has one (Good/High) and otherwise dedups the
whole set, split into context-sized chunks ordered by tables (Ultra High dedups before clustering).
"""
import logging
import os
import re
import sys
import threading

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import load_agent_namespace  # noqa: E402


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


class Agent:
    def __init__(self, keep=None):
        self.keep = keep
        self.calls = []
        self.lock = threading.Lock()
        self.prompt_templates = {}

    def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema=None, model_override=None, **kw):
        with self.lock:
            self.calls.append({"step": step_name, "vars": dict(prompt_vars), "model_override": model_override,
                               "start_from_model": kw.get("start_from_model")})
        rows = [r for r in re.findall(r"^\| (\S+) \|", prompt_vars["use_case_markdown"], re.MULTILINE) if r not in ("ID", "---")]
        kept = [r for r in rows if self.keep is None or r in self.keep]
        return "use_case_id,honesty_score,honesty_justification\n" + "\n".join(f"{r},90,keep" for r in kept)


def inspire(namespace, keep=None):
    cls = namespace["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = logging.getLogger("v120_elite_dedup")
    obj.ai_agent = Agent(keep)
    obj.parsed_generation_instructions = {}
    obj.max_parallelism = 4
    obj.llm_timeout_seconds = 300
    obj.atomic_writer = None
    return obj


def uc(no, name, tables="c.s.orders", domain="", score=None, technique="Forecasting"):
    d = {"No": no, "Name": name, "Analytics Technique": technique, "Tables Involved": tables,
         "Statement": f"Statement for {name}", "Business Domain": domain}
    if score is not None:
        d["elite_score"] = score
        d["elite_status"] = "ELITE"
    return d


def rank(ns):
    return ns["DatabricksInspire"]._final_rank_key


def nos(ucs):
    return [u["No"] for u in ucs]


# ---------------------------------------------------------------- D2-11 twin resolution


def test_removed_stronger_twin_replaces_the_weaker_kept_one(ns):
    obj = inspire(ns)
    weak, strong = uc("W", "Forecast weekly store demand", score=8.2), uc("S", "Predict weekly store demand", score=9.1)
    other = uc("O", "Detect late deliveries", tables="c.s.shipments", score=8.0)
    kept = obj._keep_stronger_dedup_twins([weak, other], [strong], rank(ns), "t")
    assert nos(kept) == ["S", "O"]


def test_weaker_removed_twin_keeps_the_llm_choice(ns):
    obj = inspire(ns)
    strong, weak = uc("S", "Predict weekly store demand", score=9.1), uc("W", "Forecast weekly store demand", score=8.2)
    assert nos(obj._keep_stronger_dedup_twins([strong], [weak], rank(ns), "t")) == ["S"]


def test_equal_rank_keeps_the_llm_choice(ns):
    obj = inspire(ns)
    a, b = uc("A", "Predict weekly store demand", score=8.5), uc("A", "Forecast weekly store demand", score=8.5)
    kept = obj._keep_stronger_dedup_twins([a], [b], rank(ns), "t")
    assert kept[0] is a


def test_unrelated_removed_use_case_never_displaces_a_kept_one(ns):
    obj = inspire(ns)
    kept = [uc("K", "Forecast weekly store demand", score=7.0)]
    dropped = [uc("D", "Rank suppliers by defect rate", tables="c.s.suppliers", score=9.9)]
    assert nos(obj._keep_stronger_dedup_twins(kept, dropped, rank(ns), "t")) == ["K"]


def test_ambiguous_twin_keeps_the_llm_decision(ns):
    obj = inspire(ns)
    k1, k2 = uc("K1", "Forecast store demand", score=7.0), uc("K2", "Forecast store demand", score=7.1)
    dropped = [uc("D", "Predict store demand", score=9.9)]
    assert nos(obj._keep_stronger_dedup_twins([k1, k2], dropped, rank(ns), "t")) == ["K1", "K2"]


def test_best_of_several_removed_twins_wins_the_slot(ns):
    obj = inspire(ns)
    kept = [uc("K", "Forecast weekly store demand", score=7.0)]
    dropped = [uc("D1", "Predict weekly store demand", score=8.0), uc("D2", "Project weekly store demand", score=9.0)]
    assert nos(obj._keep_stronger_dedup_twins(kept, dropped, rank(ns), "t")) == ["D2"]


def test_parse_without_rank_is_unchanged_and_with_rank_keeps_the_stronger(ns):
    obj = inspire(ns)
    ucs = [uc("W", "Forecast weekly store demand", score=8.0), uc("S", "Predict weekly store demand", score=9.0)]
    response = "use_case_id,honesty_score,honesty_justification\nW,90,keep\n"
    assert nos(obj._parse_dedup_response(response, ucs, "t")) == ["W"]
    assert nos(obj._parse_dedup_response(response, ucs, "t", rank=rank(ns))) == ["S"]


def test_global_dedup_threads_rank_through_and_uses_the_thinker(ns):
    obj = inspire(ns, keep={"W", "O"})
    ucs = [uc("W", "Forecast weekly store demand", score=8.0), uc("S", "Predict weekly store demand", score=9.0),
           uc("O", "Detect late deliveries", tables="c.s.shipments", score=8.5)]
    assert nos(obj._deduplicate_use_cases(ucs, rank=rank(ns))) == ["S", "O"]
    assert obj.ai_agent.calls[0]["start_from_model"] == ns["get_models_by_type"]("thinker")[0]["llm_endpoint_name"]
    assert obj.ai_agent.calls[0]["model_override"] is None
    assert nos(inspire(ns, keep={"W", "O"})._deduplicate_use_cases(ucs)) == ["W", "O"]


# ---------------------------------------------------------------- fallback groups and chunking


def test_groups_follow_domains_when_every_use_case_has_one(ns):
    obj = inspire(ns)
    ucs = [uc("A", "a", domain="Sales"), uc("B", "b", domain="Ops"), uc("C", "c", domain="Sales")]
    groups = obj._dedup_groups(ucs)
    assert {k: nos(v) for k, v in groups.items()} == {"Sales": ["A", "C"], "Ops": ["B"]}


def test_use_cases_without_domains_form_one_group(ns):
    obj = inspire(ns)
    ucs = [uc("A", "a", domain="Sales"), uc("B", "b"), uc("C", "c", domain="Ops")]
    groups = obj._dedup_groups(ucs)
    assert {k: nos(v) for k, v in groups.items()} == {"All use cases": ["A", "B", "C"]}


def test_oversized_group_is_split_into_context_sized_chunks_ordered_by_tables(fresh_ns):
    obj = inspire(fresh_ns)
    ucs = [uc(f"U{i:02d}", f"Use case {i}", tables=f"c.s.t{i % 3}") for i in range(12)]
    header = len(obj._build_dedup_markdown([]))
    row = max(len(obj._build_dedup_markdown([u])) - header for u in ucs)
    overhead = obj._prompt_overhead_chars("REVIEW_USE_CASES_PROMPT") + 1000
    fresh_ns["get_max_context_chars"] = lambda language="English", prompt_name=None: overhead + header + row * 4
    groups = obj._dedup_groups(ucs)
    assert list(groups) == [f"All use cases chunk {i} of 3" for i in (1, 2, 3)]
    sizes = [len(v) for v in groups.values()]
    assert sum(sizes) == 12 and max(sizes) <= 4
    for chunk in groups.values():
        assert len({u["Tables Involved"] for u in chunk}) == 1
    flat = [u for chunk in groups.values() for u in chunk]
    assert sorted(nos(flat)) == sorted(nos(ucs))


def test_domain_free_fallback_dedups_instead_of_keeping_everything(fresh_ns):
    obj = inspire(fresh_ns, keep={"U00", "U01", "U02", "U04"})
    ucs = [uc(f"U{i:02d}", f"Use case {i}", tables=f"c.s.t{i % 2}") for i in range(6)]
    header = len(obj._build_dedup_markdown([]))
    row = max(len(obj._build_dedup_markdown([u])) - header for u in ucs)
    overhead = obj._prompt_overhead_chars("REVIEW_USE_CASES_PROMPT") + 1000
    fresh_ns["get_max_context_chars"] = lambda language="English", prompt_name=None: overhead + header + row * 3
    kept = obj._deduplicate_use_cases_by_domain_parallel(ucs)
    assert sorted(nos(kept)) == ["U00", "U01", "U02", "U04"]
    assert len(obj.ai_agent.calls) == 2


def test_good_and_high_fallback_still_dedups_per_domain(ns):
    obj = inspire(ns, keep={"A", "B"})
    ucs = [uc("A", "a", domain="Sales"), uc("C", "c", domain="Sales"), uc("B", "b", domain="Ops")]
    kept = obj._deduplicate_use_cases_by_domain_parallel(ucs)
    assert sorted(nos(kept)) == ["A", "B"]
    steps = sorted(c["step"] for c in obj.ai_agent.calls)
    assert steps == ["Deduplicate_Domain_Sales"], "a one-use-case domain is not sent to the LLM"
