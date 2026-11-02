"""v1.2.0 GATES lane: domain/subdomain clustering never loses, fabricates or silently
mis-assigns a use case, and user-specified domains are immutable inside merge/split/rename.

Register items covered: E-01 (empty-domain UCs vanished), E-04 (batched path ran subdomain
detection sequentially), E-07 (Domain1..5 / Sub DomainN round-robin fabrication and soft-accepted
HARD violations), E-08 (placeholder rename only on the batched path), E-09 (batch-majority
assignment for UCs the LLM skipped), E-13 (LLM-call cost per clustering stage), E-17 (user domains
renamed/merged/split), E-18 (mega-split left unmapped UCs under the mega name).

The fake agent answers each prompt from the UC ids actually present in the prompt, so a test can
make the LLM "forget" a specific use case and observe what the pipeline does with it.
"""
import csv
import io
import json
import logging
import os
import sys
import threading
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import load_agent_namespace  # noqa: E402


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def ids_in_csv(text):
    rows = list(csv.DictReader(io.StringIO(text or "")))
    return [r.get("No", "").strip() for r in rows if r.get("No", "").strip()]


def domain_csv(mapping):
    lines = ["use_case_id,domain"] + [f"{k},{v}" for k, v in mapping.items()]
    return "\n".join(lines)


def subdomain_csv(mapping):
    lines = ["use_case_id,subdomain"] + [f"{k},{v}" for k, v in mapping.items()]
    return "\n".join(lines)


def wrapped(data):
    return json.dumps({"honesty_score": 90, "honesty_justification": "test", "data": data})


class FakeAgent:
    def __init__(self, ns_obj=None, domain=None, subdomain=None, merge=None, split=None, rename=None,
                 sub_merge=None, delay=0.0, domain_template="DOMAIN {use_cases_csv}"):
        self.prompt_templates = {"DOMAIN_FINDER_PROMPT": domain_template,
                                 "SUBDOMAIN_DETECTOR_PROMPT": "SUB {use_cases_csv}"}
        self.domain = domain
        self.subdomain = subdomain
        self.merge = merge
        self.split = split
        self.rename = rename
        self.sub_merge = sub_merge
        self.delay = delay
        self.calls = []
        self.lock = threading.Lock()
        self.active = 0
        self.max_active = 0
        self.ns_obj = ns_obj

    def _count(self):
        if self.ns_obj is not None:
            self.ns_obj["AIAgent"]._total_ai_calls += 1

    def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema, **kw):
        with self.lock:
            self.calls.append({"path": worker_prompt_path, "step": step_name, "vars": dict(prompt_vars),
                               "kw": dict(kw), "template": self.prompt_templates.get(worker_prompt_path, "")})
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        try:
            if self.delay:
                time.sleep(self.delay)
            handler = {"DOMAIN_FINDER_PROMPT": self.domain, "SUBDOMAIN_DETECTOR_PROMPT": self.subdomain,
                       "DOMAINS_MERGER_PROMPT": self.merge, "DOMAIN_SPLITTER_PROMPT": self.split,
                       "SUBDOMAINS_MERGER_PROMPT": self.sub_merge}.get(worker_prompt_path)
            if handler is None:
                raise RuntimeError(f"no fake handler for {worker_prompt_path}")
            out = handler(prompt_vars, step_name, kw, self.prompt_templates.get(worker_prompt_path, ""))
            self._count()
            return out
        finally:
            with self.lock:
                self.active -= 1

    def _call_ai_query(self, prompt, prompt_name, response_schema=None, display_name=None, **kw):
        with self.lock:
            self.calls.append({"path": prompt_name, "step": display_name, "prompt": prompt, "kw": dict(kw)})
        if prompt_name == "PlaceholderDomainRename" and self.rename:
            out = self.rename(prompt)
            self._count()
            return out
        raise RuntimeError(f"no fake handler for {prompt_name}")

    def paths(self):
        return [c["path"] for c in self.calls]


def make(ns, agent, **attrs):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = logging.getLogger("v120_cluster")
    obj.processing_honesty = {}
    obj.user_business_domains = []
    obj.ai_agent = agent
    obj.business_name = "Acme"
    obj.industries = []
    obj.max_retry_attempts = 1
    obj.max_parallelism = 8
    obj.llm_timeout_seconds = 30
    obj.data_loader = None
    for k, v in attrs.items():
        setattr(obj, k, v)
    return obj


def ucs_on(spec):
    out = []
    for no, table in spec:
        out.append({"No": no, "Name": f"Use case {no}", "type": "Problem", "Analytics Technique": "Forecasting",
                    "Statement": f"Statement {no}", "Solution": f"Solution {no}", "Business Value": "bv",
                    "Beneficiary": "Head of Sales", "Sponsor": "Chief Operating Officer",
                    "Tables Involved": table, "Business Domain": "", "Subdomain": ""})
    return out


def one_subdomain_per_domain(prompt_vars, step, kw, template):
    dom = prompt_vars.get("domain_name", "X")
    return subdomain_csv({i: f"{dom} Core" for i in ids_in_csv(prompt_vars["use_cases_csv"])})


def no_merge(prompt_vars, step, kw, template):
    return wrapped({})


class TestNoUseCaseIsLost:
    def test_e01_uc_skipped_by_llm_is_repaired_not_dropped(self, ns):
        assignment = {"U1": "Sales", "U2": "Sales", "U3": "Sales", "U4": "Finance", "U5": "Finance",
                      "U6": "Logistics", "U7": "Logistics", "U8": "Logistics"}

        def domain(prompt_vars, step, kw, template):
            sent = ids_in_csv(prompt_vars["use_cases_csv"])
            if sent == ["U8"]:
                return domain_csv({"U8": "Logistics"})
            return domain_csv({i: assignment[i] for i in sent if i != "U8"})
        agent = FakeAgent(domain=domain, subdomain=one_subdomain_per_domain, merge=no_merge)
        o = make(ns, agent)
        ucs = ucs_on([(f"U{i}", "main.shop.orders") for i in range(1, 9)])
        out = o._cluster_domains_and_subdomains(ucs, "English")
        assert sorted(u["No"] for u in out) == [f"U{i}" for i in range(1, 9)]
        by_id = {u["No"]: u for u in out}
        assert by_id["U8"]["Business Domain"] == "Logistics"
        assert all(u["Business Domain"] and u["Subdomain"] for u in out)
        repair_calls = [c for c in agent.calls if c["path"] == "DOMAIN_FINDER_PROMPT"
                        and ids_in_csv(c["vars"]["use_cases_csv"]) == ["U8"]]
        assert repair_calls and repair_calls[0]["kw"].get("skip_cache") is True

    def test_e09_batched_detection_never_assigns_batch_majority(self, ns):
        def domain(prompt_vars, step, kw, template):
            sent = ids_in_csv(prompt_vars["use_cases_csv"])
            if sent == ["U3"]:
                raise RuntimeError("repair call failed too")
            return domain_csv({"U1": "Sales", "U2": "Sales", "U4": "Finance", "U5": "Sales"})
        agent = FakeAgent(domain=domain)
        o = make(ns, agent)
        ucs = ucs_on([("U1", "main.shop.orders"), ("U2", "main.shop.orders"), ("U3", "main.shop.ledger"),
                      ("U4", "main.shop.ledger"), ("U5", "main.shop.orders")])
        fieldnames = ["No", "Name", "Tables Involved"]
        out = o._run_domain_detection_batched(ucs, fieldnames, "English", "T", 10 ** 9)
        by_id = {u["No"]: u for u in out}
        assert by_id["U3"]["Business Domain"] == "Finance"
        assert by_id["U3"]["clustering_fallback"] == "domain:table_evidence"
        assert "clustering_fallback" not in by_id["U1"]
        assert all(u["Business Domain"] != "Uncategorized" for u in out)

    def test_e09_batched_group_failure_goes_to_repair_then_placeholder(self, ns):
        def domain(prompt_vars, step, kw, template):
            raise RuntimeError("endpoint down")
        agent = FakeAgent(domain=domain)
        o = make(ns, agent)
        ucs = ucs_on([("U1", "a.x.t1"), ("U2", "a.x.t2"), ("U3", "b.y.t3")])
        out = o._run_domain_detection_batched(ucs, ["No", "Name", "Tables Involved"], "English", "T", 10 ** 9)
        assert len(out) == 3
        assert all(u["Business Domain"] != "Uncategorized" for u in out)
        assert all(u["clustering_fallback"] == "domain:placeholder" for u in out)
        doms = {u["No"]: u["Business Domain"] for u in out}
        assert doms["U1"] == doms["U2"] != doms["U3"]

    def test_subdomain_gap_is_filled_from_evidence_not_left_empty(self, ns):
        def subdomain(prompt_vars, step, kw, template):
            return subdomain_csv({i: "Demand Planning" for i in ids_in_csv(prompt_vars["use_cases_csv"]) if i != "U2"})
        agent = FakeAgent(subdomain=subdomain)
        o = make(ns, agent)
        ucs = ucs_on([("U1", "main.shop.orders"), ("U2", "main.shop.orders"), ("U3", "main.shop.orders")])
        for u in ucs:
            u["Business Domain"] = "Sales"
        out = o._detect_subdomains_for_domain("Sales", ucs, "English")
        by_id = {u["No"]: u for u in out}
        assert by_id["U2"]["Subdomain"] == "Demand Planning"
        assert by_id["U2"]["clustering_fallback"] == "subdomain:table_evidence"
        retry = [c for c in agent.calls if c["path"] == "SUBDOMAIN_DETECTOR_PROMPT"]
        assert len(retry) == 2 and "U2" in retry[1]["vars"]["previous_violations"]

    def test_context_split_failure_uses_table_evidence_not_general_bucket(self, ns):
        def subdomain(prompt_vars, step, kw, template):
            raise RuntimeError("down")
        agent = FakeAgent(subdomain=subdomain)
        o = make(ns, agent)
        ucs = ucs_on([("U1", "main.shop.store_sales"), ("U2", "main.shop.store_sales"), ("U3", "main.shop.customer")])
        out = o._detect_subdomains_with_context_splitting("Sales", ucs, "English", "T", 10 ** 6)
        subs = {u["No"]: u["Subdomain"] for u in out}
        assert subs == {"U1": "Store Sales", "U2": "Store Sales", "U3": "Customer Analytics"}
        assert not any(s.startswith("General ") for s in subs.values())


class TestFallbacksAreEvidenceBased:
    def test_default_domains_group_by_source_schema_not_round_robin(self, ns):
        o = make(ns, FakeAgent())
        ucs = ucs_on([(f"U{i}", "main.sales.orders") for i in range(1, 7)] + [("U7", "main.hr.staff")])
        out = o._assign_default_domains(ucs)
        doms = {u["No"]: u["Business Domain"] for u in out}
        assert len({doms[f"U{i}"] for i in range(1, 7)}) == 1
        assert doms["U7"] != doms["U1"]
        assert all(u["clustering_fallback"] == "domain:placeholder" for u in out)

    def test_default_subdomains_derive_from_primary_table_not_sub_domain_n(self, ns):
        o = make(ns, FakeAgent())
        ucs = ucs_on([("U1", "main.shop.store_sales, main.shop.item"), ("U2", "main.shop.store_sales"),
                      ("U3", "main.shop.customer"), ("U4", "main.shop.fact_web_returns")])
        out = o._assign_default_subdomains(ucs, "Sales")
        subs = {u["No"]: u["Subdomain"] for u in out}
        assert subs == {"U1": "Store Sales", "U2": "Store Sales", "U3": "Customer Analytics", "U4": "Web Returns"}
        assert all(len(s.split()) == 2 for s in subs.values())
        assert all(u["clustering_fallback"] == "subdomain:table_evidence" for u in out)

    def test_e07_e08_total_llm_failure_renames_placeholders_on_non_batched_path(self, ns):
        def domain(prompt_vars, step, kw, template):
            raise RuntimeError("endpoint down")

        def subdomain(prompt_vars, step, kw, template):
            raise RuntimeError("endpoint down")
        names = iter(["Revenue", "Workforce"])

        def rename(prompt):
            return next(names)
        agent = FakeAgent(domain=domain, subdomain=subdomain, merge=no_merge, rename=rename)
        o = make(ns, agent)
        ucs = ucs_on([("U1", "main.sales.store_sales"), ("U2", "main.sales.store_sales"),
                      ("U3", "main.sales.customer"), ("U4", "main.hr.staff_roster"), ("U5", "main.hr.staff_roster")])
        out = o._cluster_domains_and_subdomains(ucs, "English")
        assert len(out) == 5
        doms = {u["No"]: u["Business Domain"] for u in out}
        assert {doms["U1"], doms["U4"]} == {"Revenue", "Workforce"}
        assert doms["U1"] == doms["U2"] == doms["U3"]
        assert not any(u["Subdomain"].startswith("Sub Domain") for u in out)
        assert "PlaceholderDomainRename" in agent.paths()

    def test_e07_hard_violations_keep_the_best_attempt_and_are_recorded(self, ns):
        good = {"U1": "Sales", "U2": "Sales", "U3": "Finance", "U4": "Finance", "U5": "Customer Care", "U6": "Customer Care"}
        worse = {"U1": "Supply Chain", "U2": "Supply Chain", "U3": "Supply Chain", "U4": "Customer Care",
                 "U5": "Customer Care", "U6": "Customer Care"}

        def domain(prompt_vars, step, kw, template):
            sent = ids_in_csv(prompt_vars["use_cases_csv"])
            src = good if step.endswith("Attempt1") else worse
            return domain_csv({i: src[i] for i in sent})
        agent = FakeAgent(domain=domain, subdomain=one_subdomain_per_domain, merge=no_merge)
        o = make(ns, agent)
        out = o._cluster_domains_and_subdomains(ucs_on([(f"U{i}", "main.shop.orders") for i in range(1, 7)]), "English")
        assert {u["Business Domain"] for u in out} == {"Sales", "Finance", "Customer Care"}
        recorded = o.processing_honesty["domain_hard_violations"]
        assert len(recorded) == 1 and "Customer Care" in recorded[0]
        snap = [a for a in ns["NEXT_ACTIONS"].snapshot()
                if a["rule_id"] == "DOMAIN_HARD_VIOLATIONS_ACCEPTED" and "Customer Care" in a["evidence"]]
        assert snap

    def test_single_call_path_passes_the_adaptive_budget_to_every_domain(self, ns):
        def domain(prompt_vars, step, kw, template):
            m = {"U1": "Sales", "U2": "Sales", "U3": "Finance", "U4": "Finance", "U5": "Logistics", "U6": "Logistics"}
            return domain_csv({i: m[i] for i in ids_in_csv(prompt_vars["use_cases_csv"])})
        agent = FakeAgent(domain=domain, subdomain=one_subdomain_per_domain, merge=no_merge)
        o = make(ns, agent)
        o._cluster_domains_and_subdomains(ucs_on([(f"U{i}", "main.shop.orders") for i in range(1, 7)]), "English")
        sub_calls = [c for c in agent.calls if c["path"] == "SUBDOMAIN_DETECTOR_PROMPT"]
        budget = ns["DatabricksInspire"]._compute_subdomain_call_budget(3)
        assert len(sub_calls) == 3 and all(c["kw"]["timeout_override"] == budget for c in sub_calls)

    def test_case_variant_domains_are_canonicalized_not_retried(self, ns):
        def domain(prompt_vars, step, kw, template):
            sent = ids_in_csv(prompt_vars["use_cases_csv"])
            m = {"U1": "Sales", "U2": "sales", "U3": "Sales", "U4": "Finance", "U5": "Finance", "U6": "Logistics"}
            return domain_csv({i: m[i] for i in sent})
        agent = FakeAgent(domain=domain, subdomain=one_subdomain_per_domain, merge=no_merge)
        o = make(ns, agent)
        out = o._cluster_domains_and_subdomains(ucs_on([(f"U{i}", "main.shop.orders") for i in range(1, 7)]), "English")
        assert {u["Business Domain"] for u in out} == {"Sales", "Finance", "Logistics"}
        assert len([c for c in agent.calls if c["path"] == "DOMAIN_FINDER_PROMPT"]) == 1


class TestUserDomainsAreImmutable:
    def test_merge_never_renames_or_merges_away_a_user_domain(self, ns):
        def merge(prompt_vars, step, kw, template):
            return wrapped({"Claims": "Policy", "Fraud": "claims"})
        agent = FakeAgent(merge=merge)
        o = make(ns, agent, user_business_domains=["Claims", "Billing"])
        ucs = ucs_on([("U1", "t")] + [(f"B{i}", "t") for i in range(5)] + [("F1", "t")] + [(f"P{i}", "t") for i in range(2)])
        for u in ucs:
            u["Business Domain"] = {"U": "Claims", "B": "Billing", "F": "Fraud", "P": "Policy"}[u["No"][0]]
        out = o._merge_small_domains(ucs)
        doms = {u["No"]: u["Business Domain"] for u in out}
        assert doms["U1"] == "Claims"
        assert doms["F1"] == "Claims"
        tmpl = [c for c in agent.calls if c["path"] == "DOMAINS_MERGER_PROMPT"][0]["template"]
        assert "Claims" in tmpl and "Billing" in tmpl and "USER-SPECIFIED" in tmpl

    def test_split_never_splits_a_user_domain(self, ns):
        def split(prompt_vars, step, kw, template):
            raise AssertionError("a user domain must never be sent to the splitter")
        agent = FakeAgent(split=split)
        o = make(ns, agent, user_business_domains=["Claims"])
        ucs = ucs_on([(f"C{i}", "t") for i in range(20)] + [(f"O{i}", "t") for i in range(3)])
        for u in ucs:
            u["Business Domain"] = "Claims" if u["No"].startswith("C") else "Other"
        out = o._split_mega_domains(ucs)
        assert {u["Business Domain"] for u in out} == {"Claims", "Other"}
        assert "DOMAIN_SPLITTER_PROMPT" not in agent.paths()

    def test_placeholder_rename_skips_user_domains(self, ns):
        agent = FakeAgent(rename=lambda p: "Revenue")
        o = make(ns, agent, user_business_domains=["Domain1"])
        ucs = ucs_on([("U1", "t"), ("U2", "t")])
        for u in ucs:
            u["Business Domain"] = "Domain1"
            u["Subdomain"] = "Core Planning"
        out = o._rename_placeholder_domains_from_subdomains(ucs)
        assert {u["Business Domain"] for u in out} == {"Domain1"}
        assert "PlaceholderDomainRename" not in agent.paths()

    def test_merge_rejects_empty_target_names(self, ns):
        agent = FakeAgent(merge=lambda *a: wrapped({"Tiny": "   "}))
        o = make(ns, agent)
        ucs = ucs_on([("T1", "t")] + [(f"S{i}", "t") for i in range(6)])
        for u in ucs:
            u["Business Domain"] = "Tiny" if u["No"] == "T1" else "Sales"
        out = o._merge_small_domains(ucs)
        assert {u["No"]: u["Business Domain"] for u in out}["T1"] == "Tiny"


class TestMegaSplitCoverage:
    def _mega(self):
        ucs = ucs_on([(f"U{i}", "main.shop.t_a") for i in range(1, 6)] + [(f"U{i}", "main.shop.t_b") for i in range(6, 11)]
                     + [("X1", "main.shop.t_c"), ("X2", "main.shop.t_c")])
        for u in ucs:
            u["Business Domain"] = "Other" if u["No"].startswith("X") else "Sales"
        return ucs

    def test_e18_unmapped_ucs_follow_table_evidence_after_failed_retry(self, ns):
        calls = []

        def split(prompt_vars, step, kw, template):
            calls.append(template)
            if len(calls) > 1:
                return wrapped({})
            m = {f"U{i}": "Revenue" for i in range(1, 5)}
            m.update({f"U{i}": "Pricing" for i in range(6, 10)})
            m["X1"] = "Pricing"
            return wrapped(m)
        agent = FakeAgent(split=split)
        o = make(ns, agent)
        out = o._split_mega_domains(self._mega())
        doms = {u["No"]: u for u in out}
        assert doms["U5"]["Business Domain"] == "Revenue"
        assert doms["U10"]["Business Domain"] == "Pricing"
        assert doms["U5"]["clustering_fallback"] == "domain:table_evidence"
        assert doms["X1"]["Business Domain"] == "Other"
        assert not any(u["Business Domain"] == "Sales" for u in out)
        assert len(calls) == 2 and "U5" in calls[1] and "U10" in calls[1]

    def test_e18_retry_assignment_is_used_when_llm_answers(self, ns):
        calls = []

        def split(prompt_vars, step, kw, template):
            calls.append(template)
            if len(calls) > 1:
                return wrapped({"U5": "Pricing", "U10": "Revenue"})
            m = {f"U{i}": "Revenue" for i in range(1, 5)}
            m.update({f"U{i}": "Pricing" for i in range(6, 10)})
            return wrapped(m)
        agent = FakeAgent(split=split)
        o = make(ns, agent)
        out = o._split_mega_domains(self._mega())
        doms = {u["No"]: u for u in out}
        assert doms["U5"]["Business Domain"] == "Pricing" and "clustering_fallback" not in doms["U5"]
        assert doms["U10"]["Business Domain"] == "Revenue"


class TestSubdomainDedup:
    def test_llm_rename_that_is_not_two_words_falls_back_to_deterministic(self, ns):
        agent = FakeAgent(sub_merge=lambda *a: wrapped({"Credit:::Risk Review": "Credit Risk Review Board"}))
        o = make(ns, agent)
        ucs = ucs_on([("A1", "t"), ("A2", "t"), ("B1", "t"), ("B2", "t")])
        for u in ucs:
            u["Business Domain"] = "Fraud" if u["No"].startswith("A") else "Credit"
            u["Subdomain"] = "Risk Review"
        out = o._merge_duplicate_subdomains(ucs)
        subs = {(u["Business Domain"], u["Subdomain"]) for u in out}
        names = {s for _, s in subs}
        assert len(names) == 2
        assert all(len(s.split()) == 2 for s in names)


class TestParallelBatchedPathAndCost:
    def _batched_inspire(self, fresh_ns, delay):
        def limit(language="English", prompt_name=None):
            return 400 if prompt_name == "DOMAIN_FINDER_PROMPT" else 10 ** 7
        fresh_ns["get_max_context_chars"] = limit

        def domain(prompt_vars, step, kw, template):
            sent = ids_in_csv(prompt_vars["use_cases_csv"])
            m = {"U1": "Sales", "U2": "Sales", "U3": "Finance", "U4": "Finance", "U5": "Logistics",
                 "U6": "Logistics", "U7": "Workforce", "U8": "Workforce"}
            return domain_csv({i: m[i] for i in sent})
        agent = FakeAgent(ns_obj=fresh_ns, domain=domain, subdomain=one_subdomain_per_domain, merge=no_merge,
                          delay=delay, domain_template="DOMAIN " + "x" * 600 + " {use_cases_csv}")
        o = make(fresh_ns, agent)
        return o, agent

    def test_e04_batched_path_detects_subdomains_in_parallel_with_budget(self, fresh_ns):
        o, agent = self._batched_inspire(fresh_ns, delay=0.4)
        ucs = ucs_on([(f"U{i}", f"main.s{i % 2}.orders") for i in range(1, 9)])
        out = o._cluster_domains_and_subdomains(ucs, "English")
        assert len(out) == 8
        sub_calls = [c for c in agent.calls if c["path"] == "SUBDOMAIN_DETECTOR_PROMPT"]
        assert len(sub_calls) == 4
        assert all(c["kw"].get("timeout_override", 0) >= 300 for c in sub_calls)
        assert agent.max_active >= 2

    def test_e13_clustering_llm_cost_is_reported_per_stage(self, fresh_ns, caplog):
        o, agent = self._batched_inspire(fresh_ns, delay=0.0)
        ucs = ucs_on([(f"U{i}", f"main.s{i % 2}.orders") for i in range(1, 9)])
        with caplog.at_level(logging.INFO, logger="v120_cluster"):
            o._cluster_domains_and_subdomains(ucs, "English")
        cost = o.processing_honesty["clustering_llm_cost"]
        for stage in ("domain_detection", "merge_small_domains", "split_mega_domains", "subdomain_detection",
                      "subdomain_dedup", "placeholder_rename"):
            assert stage in cost, stage
        assert cost["domain_detection"]["calls"] == len([c for c in agent.calls if c["path"] == "DOMAIN_FINDER_PROMPT"])
        assert cost["subdomain_detection"]["calls"] == 4
        assert sum(v["calls"] for v in cost.values()) == len(agent.calls)
        assert any("[CLUSTERING_LLM_COST]" in r.getMessage() for r in caplog.records)


class TestDomainSizeIsOwnedByTheMerge:
    def test_small_non_user_domain_on_a_large_corpus_is_soft_not_hard(self, ns):
        o = make(ns, None)
        du = {"Returns": list(range(30)), "Customers": list(range(27)), "Compliance": [1, 2, 3]}
        hard, soft, small = o._classify_domain_structure(du, 60)
        assert not any("Compliance" in h for h in hard)
        assert small == [("Compliance", 3)]
        assert any("Compliance" in s for s in soft)

    def test_user_named_small_domain_is_never_flagged(self, ns):
        o = make(ns, None, user_business_domains=["Compliance"])
        du = {"Returns": list(range(30)), "Customers": list(range(27)), "Compliance": [1, 2, 3]}
        hard, soft, small = o._classify_domain_structure(du, 60)
        assert hard == [] and small == [] and not any("Compliance" in s for s in soft)

    def test_structural_violations_still_block_hard(self, ns):
        o = make(ns, None)
        multi, _, _ = o._classify_domain_structure(
            {"Customer Care": list(range(5)), "Sales": list(range(5)), "Finance": list(range(5))}, 15)
        assert any("Customer Care" in h and "word" in h for h in multi)
        too_many, _, _ = o._classify_domain_structure({f"D{i}": [1, 2, 3, 4] for i in range(26)}, 104)
        assert any("MAXIMUM 25" in h for h in too_many)
        too_few, _, _ = o._classify_domain_structure({"Only": list(range(10))}, 10)
        assert any("minimum required: 3" in h for h in too_few)
        too_big, _, _ = o._classify_domain_structure(
            {"Mega": list(range(81)), "B": [1, 2, 3, 4], "C": [1, 2, 3, 4]}, 89)
        assert any("maximum allowed: 80" in h for h in too_big)
