import ast
import concurrent.futures
import json
import logging
import os
import re
import symtable
import sys
import threading
import time
import types

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import agent_ast, agent_source, method_node  # noqa: E402
from v120_run_offline_smoke_test import _build as smoke_build, quiet_root_logger  # noqa: E402,F401

LOGGER = "v120_integration"
GEN_HEADER = ('"No","Name","usecase","type","Analytics Technique","Statement","Solution","Business Value",'
              '"Beneficiary","Sponsor","Tables Involved","High Level Design"')


class _ListHandler(logging.Handler):
    def __init__(self):
        super().__init__(logging.DEBUG)
        self.records = []

    def emit(self, record):
        self.records.append(record)


def _capture(name):
    logger = logging.getLogger(name)
    handler = _ListHandler()
    previous = logger.level
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)
    return logger, handler, previous


@pytest.fixture
def records():
    logger, handler, previous = _capture(LOGGER)
    yield handler.records
    logger.removeHandler(handler)
    logger.setLevel(previous)


def _messages(recs, level=None):
    return [r.getMessage() for r in recs if level is None or r.levelno == level]


def _callee(call):
    func = call.func
    return func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", "")


def _uc(no, table="c.s.orders", **extra):
    uc = {"No": no, "Name": f"Forecast demand {no}", "type": "AI", "Analytics Technique": "Forecasting",
          "Statement": f"Statement for {no}", "Solution": "Aggregate `amount` by `order_date` and fit a forecast.",
          "Business Value": "Value", "Beneficiary": "Head of Sales", "Sponsor": "CFO", "Tables Involved": table,
          "High Level Design": "Aggregate", "Business Domain": "", "Subdomain": "", "Priority": 0.0}
    uc.update(extra)
    return uc


def _inspire(ns, **attrs):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = logging.getLogger(LOGGER)
    obj.processing_honesty = {}
    obj.funnel_ledger = []
    obj.parsed_generation_instructions = {}
    obj.user_generation_instructions = ""
    obj.user_business_domains = []
    obj.business_name = "Acme"
    obj.industries = []
    obj.llm_timeout_seconds = 30
    obj.max_parallelism = 4
    obj.max_retry_attempts = 1
    obj.data_loader = None
    obj.global_table_names = set()
    obj.data_category_map = {}
    obj.merged_business_context = {}
    obj.use_cases_quality = "Good"
    obj.registry_lock = threading.Lock()
    for key, value in attrs.items():
        setattr(obj, key, value)
    return obj


def _real_agent(ns, respond):
    AIAgent = ns["AIAgent"]
    agent = AIAgent.__new__(AIAgent)
    agent.logger = logging.getLogger(LOGGER)
    agent.prompt_templates = dict(ns["PROMPT_TEMPLATES"])
    agent._manager = types.SimpleNamespace(acquire=lambda: None, release=lambda: None)
    agent.sent = []
    lock = threading.Lock()

    def impl(prompt, prompt_name, *args):
        with lock:
            agent.sent.append((prompt_name, prompt))
        return respond(prompt_name, prompt)

    agent._call_ai_query_impl = impl
    agent._build_started_status = lambda *a, **k: ("", {})
    agent._build_success_status = lambda *a, **k: ("", {})
    agent._emit_status = lambda **k: None
    return agent


def _rendering_agent(ns, respond):
    AIAgent = ns["AIAgent"]
    agent = AIAgent.__new__(AIAgent)
    agent.logger = logging.getLogger(LOGGER)
    agent.prompt_templates = dict(ns["PROMPT_TEMPLATES"])
    agent.calls = []
    lock = threading.Lock()

    def run_worker(step_name, worker_prompt_path, prompt_vars, response_schema=None, **kw):
        prompt = agent._load_and_format_prompt(worker_prompt_path, prompt_vars)
        with lock:
            agent.calls.append({"path": worker_prompt_path, "vars": dict(prompt_vars), "prompt": prompt,
                                "skip_cache": kw.get("skip_cache", False),
                                "cancelled": ns["_is_thread_cancelled"]()})
        return respond(worker_prompt_path, prompt_vars, kw.get("skip_cache", False))

    agent.run_worker = run_worker
    return agent


class _ClusterAgent:
    def __init__(self, assign, repair=None):
        self.assign = assign
        self.repair = repair
        self.calls = []
        self.prompt_templates = {}
        self._lock = threading.Lock()

    def _call_ai_query(self, prompt, prompt_name, response_schema=None, **kw):
        with self._lock:
            self.calls.append({"path": prompt_name, "skip_cache": kw.get("skip_cache", False), "prompt": prompt})
        ids = re.findall(r"^(U\d+),", prompt, re.M)
        return "use_case_id,domain\n" + "\n".join(f"{i},{d}" for i, d in self.assign(ids, kw.get("skip_cache", False)).items())

    def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema=None, **kw):
        with self._lock:
            self.calls.append({"path": worker_prompt_path, "skip_cache": kw.get("skip_cache", False),
                               "vars": dict(prompt_vars)})
        if worker_prompt_path == "DOMAIN_FINDER_PROMPT" and self.repair is not None:
            ids = re.findall(r"^(U\d+),", prompt_vars["use_cases_csv"], re.M)
            return "use_case_id,domain\n" + "\n".join(f"{i},{d}" for i, d in self.repair(ids).items())
        raise RuntimeError(f"endpoint down for {worker_prompt_path}")


def _user_domain_obj(ns, agent, user_domains):
    obj = _inspire(ns, ai_agent=agent, user_business_domains=list(user_domains))
    obj._detect_subdomains_for_domain = (
        lambda name, ucs, lang, timeout_seconds_override=None: [dict(u, Subdomain=f"{name} Core") for u in ucs])
    obj._merge_duplicate_subdomains = lambda ucs: ucs
    obj._rename_placeholder_domains_from_subdomains = lambda ucs: ucs
    return obj


def test_r1_run_reaches_g_and_q_gates_when_the_validation_schema_is_empty(agent_ns, tmp_path, quiet_root_logger):
    def scorer(uc_id):
        return {"use_case_id": uc_id, "quality_label": "High", "quality_score": 4.0, "priority_score": 7.0,
                "quality_summary": "Columns `id` and `amount` aggregated by store give the KPI that drives the outcome."}

    obj = smoke_build(agent_ns, tmp_path, "Good", {"Medium", "High", "Very High", "Ultra High"}, scorer)
    real_load = obj.storage_manager.load_schema_details
    obj.storage_manager.load_schema_details = (
        lambda name="all_columns_for_sql": [] if name == "all_columns_for_sql" else real_load(name))
    seen = []
    obj._phaseG_run_quality_gates = lambda ucs, schema: seen.append(("G", len(ucs), list(schema))) or ucs
    obj._phaseQ_run_integrity_gates = lambda ucs, schema: seen.append(("Q", len(ucs), list(schema))) or []
    logger, handler, previous = _capture("v120_smoke")
    try:
        obj.run()
    finally:
        logger.removeHandler(handler)
        logger.setLevel(previous)
    assert [s[0] for s in seen] == ["G", "Q"], seen
    assert all(n > 0 and schema == [] for _, n, schema in seen)
    errors = _messages(handler.records, logging.ERROR)
    assert any("all_columns_for_sql" in m and "is empty" in m for m in errors), errors
    assert obj.recorded["tracking"] == []


def test_r2_call_ai_query_prefixes_the_preamble_exactly_once(agent_ns):
    pre = agent_ns["USER_DIRECTIVE_SUPREMACY_PREAMBLE"]
    agent = _real_agent(agent_ns, lambda name, prompt: "ok")
    agent._call_ai_query("Rename this placeholder domain.", "Inline")
    agent._call_ai_query(pre + "Already carries the preamble.", "InlinePrefixed")
    agent.run_worker(step_name="t", worker_prompt_path="GOAL_ALIGNMENT_FILTER_PROMPT",
                     prompt_vars={"goal_description": "g", "use_cases_table": "| ID |"}, response_schema=None)
    assert [name for name, _ in agent.sent] == ["Inline", "InlinePrefixed", "GOAL_ALIGNMENT_FILTER_PROMPT"]
    for name, prompt in agent.sent:
        assert prompt.startswith(pre) and prompt.count(pre) == 1, name


def test_r2_formatter_leaves_an_empty_render_empty_so_run_worker_still_refuses_it(agent_ns):
    agent = _real_agent(agent_ns, lambda name, prompt: "ok")
    agent.prompt_templates = {"EMPTY": ""}
    assert agent._load_and_format_prompt("EMPTY", {}) == ""
    with pytest.raises(ValueError):
        agent.run_worker(step_name="t", worker_prompt_path="EMPTY", prompt_vars={}, response_schema=None)
    assert agent.sent == []


def test_r2_the_three_inline_prompts_carry_the_preamble_exactly_once(agent_ns):
    pre = agent_ns["USER_DIRECTIVE_SUPREMACY_PREAMBLE"]

    def respond(name, prompt):
        if name.startswith("Assign_User_Domains"):
            ids = re.findall(r"^(U\d+),", prompt, re.M)
            return "use_case_id,domain\n" + "\n".join(f"{i},Sales" for i in ids)
        if name == "canonicalize_sponsor_beneficiary_roles":
            return json.dumps({"roles": [{"input": "CFO", "canonical": "Chief Financial Officer"}]})
        if name == "PlaceholderDomainRename":
            return "Revenue"
        raise AssertionError(name)

    agent = _real_agent(agent_ns, respond)
    obj = _user_domain_obj(agent_ns, agent, ["Sales", "Ops"])
    obj._detect_subdomains_all_domains = lambda ucs, lang, label: [dict(u, Subdomain="Core Sales") for u in ucs]
    obj._assign_to_user_domains([_uc("U1"), _uc("U2")], ["Sales", "Ops"], "English")
    obj._canonicalize_sponsor_beneficiary_roles([_uc("U3")])
    renamer = _inspire(agent_ns, ai_agent=agent)
    out = renamer._rename_placeholder_domains_from_subdomains(
        [_uc("U4", **{"Business Domain": "Domain1", "Subdomain": "Revenue Pricing"})])
    assert out[0]["Business Domain"] == "Revenue"
    by_name = {}
    for name, prompt in agent.sent:
        by_name.setdefault(name, []).append(prompt)
    assert set(by_name) == {"Assign_User_Domains", "canonicalize_sponsor_beneficiary_roles",
                            "PlaceholderDomainRename"}
    for name, prompts in by_name.items():
        for prompt in prompts:
            assert prompt.startswith(pre) and prompt.count(pre) == 1, name


def _gen_row(no, technique, table="c.s.orders"):
    return (f'"{no}","Forecast orders {no}","Forecast orders","AI","{technique}","Orders drop",'
            f'"Model `amount` by `order_date`","Value","Ops","COO","{table}","Aggregate"')


def test_r3_parse_never_defaults_a_technique_to_ai_analysis(agent_ns, records):
    obj = _inspire(agent_ns)
    response = "\n".join([GEN_HEADER, _gen_row("N1-1", "forecasting"), _gen_row("N1-2", "Prophet Forecasting"),
                          _gen_row("N1-3", ""), _gen_row("N1-4", "N/A"), _gen_row("N1-5", "Anomaly Detection")])
    rows = obj._parse_llm_csv_response(response, "[t]")
    techniques = {r["No"]: r["Analytics Technique"] for r in rows}
    assert techniques == {"N1-1": "Forecasting", "N1-2": "Prophet Forecasting", "N1-3": "", "N1-4": "",
                          "N1-5": "Anomaly Detection"}
    unknown = [m for m in _messages(records) if "[TECHNIQUE_UNKNOWN]" in m]
    assert len(unknown) == 1 and "'Prophet Forecasting'" in unknown[0] and "N1-2" in unknown[0]
    empty = [r for r in rows if r["No"] in ("N1-3", "N1-4")]
    assert obj._phaseG_validate_schema_completeness(empty) == []


def test_r3_run_final_pass_canonicalizes_and_never_substitutes_ai_analysis(agent_ns, tmp_path, quiet_root_logger):
    def scorer(uc_id):
        return {"use_case_id": uc_id, "quality_label": "High", "quality_score": 4.0, "priority_score": 7.0,
                "quality_summary": "Columns `id` and `amount` aggregated by store give the KPI that drives the outcome."}

    obj = smoke_build(agent_ns, tmp_path, "Good", {"Medium", "High", "Very High", "Ultra High"}, scorer)
    labels = iter(["forecasting", "", "Prophet Forecasting", "N/A"])
    generate = obj._process_batch_with_retry

    def relabel(column_details, batch_id, **kw):
        out = generate(column_details, batch_id, **kw)
        for uc in out:
            uc["Analytics Technique"] = next(labels, "Forecasting")
        return out

    obj._process_batch_with_retry = relabel
    obj._phaseQ_run_integrity_gates = lambda ucs, schema: ucs
    obj.run()
    final = obj.recorded["tracking"][-1]
    techniques = sorted(u["Analytics Technique"] for u in final)
    assert "AI Analysis" not in techniques
    assert techniques.count("") == 2 and "Forecasting" in techniques and "Prophet Forecasting" in techniques


def test_r3_no_ai_analysis_default_remains_in_run_or_the_generation_parser():
    for method in ("run", "_parse_llm_csv_response"):
        node = method_node("DatabricksInspire", method)
        consts = [n.value for n in ast.walk(node) if isinstance(n, ast.Constant) and n.value == "AI Analysis"]
        assert consts == [], method


def test_r4_no_csv_response_is_cleaned_with_a_json_cleaner():
    violations = []
    for cls in (n for n in agent_ast().body if isinstance(n, ast.ClassDef)):
        for fn in (m for m in cls.body if isinstance(m, ast.FunctionDef)):
            json_cleaned = set()
            for node in ast.walk(fn):
                if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call) \
                        and _callee(node.value) == "clean_json_response":
                    json_cleaned.update(t.id for t in node.targets if isinstance(t, ast.Name))
            for node in ast.walk(fn):
                if isinstance(node, ast.Call) and _callee(node) == "parse_csv_string" and node.args:
                    arg = node.args[0]
                    if (isinstance(arg, ast.Call) and _callee(arg) == "clean_json_response") \
                            or (isinstance(arg, ast.Name) and arg.id in json_cleaned):
                        violations.append(f"{cls.name}.{fn.name}")
    assert violations == []


def test_r4_assignment_csv_with_brackets_in_the_justification_is_parsed(agent_ns):
    obj = _inspire(agent_ns)
    response = ("use_case_id,domain,honesty_score,honesty_justification\n"
                'U1,Sales,90,"grouped [U1, U2] by the shared {order} tables"\n'
                "U2,Finance,88,ok\n")
    assert obj._parse_assignment_csv(response, "domain", "t", [_uc("U1"), _uc("U2")]) == {"U1": "Sales", "U2": "Finance"}


class _ScoringAgent:
    def __init__(self, respond):
        self.respond = respond
        self.calls = []
        self.prompt_templates = {}
        self._lock = threading.Lock()

    def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema=None, **kw):
        with self._lock:
            self.calls.append({"path": worker_prompt_path, "vars": dict(prompt_vars),
                               "skip_cache": kw.get("skip_cache", False)})
        return self.respond(worker_prompt_path, prompt_vars, kw.get("skip_cache", False))


def test_r4_dedup_response_with_a_prose_preamble_is_parsed(agent_ns):
    obj = _inspire(agent_ns)
    response = ("Here are the use cases to keep after removing duplicates:\n"
                "use_case_id,honesty_score,honesty_justification\nU1,90,keep\nU3,90,keep\n")
    kept = obj._parse_dedup_response(response, [_uc("U1"), _uc("U2"), _uc("U3")], "t")
    assert [u["No"] for u in kept] == ["U1", "U3"]


def test_r6_user_domain_path_delegates_to_the_shared_dispatcher_and_repair():
    node = method_node("DatabricksInspire", "_assign_to_user_domains")
    calls = {_callee(n) for n in ast.walk(node) if isinstance(n, ast.Call)}
    assert {"_detect_subdomains_all_domains", "_repair_unassigned_domains"} <= calls
    assert not calls & {"_detect_subdomains_for_domain", "_SafeExecutorContext", "safe_as_completed",
                        "_assign_default_subdomains"}


def test_r6_invalid_answer_is_repaired_never_dropped_or_dumped_into_the_first_user_domain(agent_ns):
    def assign(ids, skip_cache):
        answers = {"U1": "sales", "U2": "Marketing", "U3": "Ops"}
        return {i: answers[i] for i in ids}

    agent = _ClusterAgent(assign, repair=lambda ids: {i: "Marketing" for i in ids})
    obj = _user_domain_obj(agent_ns, agent, ["Sales", "Ops"])
    ucs = [_uc("U1"), _uc("U2", table="c.s.campaigns"), _uc("U3")]
    out = obj._assign_to_user_domains(ucs, ["Sales", "Ops"], "English")
    by = {u["No"]: u["Business Domain"] for u in out}
    assert by == {"U1": "Sales", "U2": "Marketing", "U3": "Ops"}
    repair = [c for c in agent.calls if c["path"] == "DOMAIN_FINDER_PROMPT"]
    assert len(repair) == 1 and repair[0]["skip_cache"] is True
    assert "Sales" in repair[0]["vars"]["business_context"] and "Ops" in repair[0]["vars"]["business_context"]
    ledger = [e for e in obj.funnel_ledger if e["stage"] == "user_domain_assignment"]
    assert ledger == [{"stage": "user_domain_assignment", "in": 3, "out": 3, "drops": {}}]


def test_r6_failed_repair_falls_back_to_table_evidence_then_placeholder_never_a_user_domain(agent_ns):
    def assign(ids, skip_cache):
        answers = {"U1": "Sales", "U2": "Unknown", "U3": "Ops", "U4": "Ops", "U5": "Nonsense"}
        return {i: answers[i] for i in ids}

    agent = _ClusterAgent(assign)
    obj = _user_domain_obj(agent_ns, agent, ["Sales", "Ops"])
    ucs = [_uc("U1"), _uc("U2", table="c.s.events"), _uc("U3"), _uc("U4", table="c.s.events"),
           _uc("U5", table="x.y.ledger")]
    out = obj._assign_to_user_domains(ucs, ["Sales", "Ops"], "English")
    by = {u["No"]: u for u in out}
    assert sorted(by) == ["U1", "U2", "U3", "U4", "U5"]
    assert by["U2"]["Business Domain"] == "Ops" and "domain:table_evidence" in by["U2"]["clustering_fallback"]
    assert by["U5"]["Business Domain"] not in ("Sales", "Ops")
    assert "domain:placeholder" in by["U5"]["clustering_fallback"]


def test_r6_case_variant_answers_keep_the_user_spelling(agent_ns):
    agent = _ClusterAgent(lambda ids, skip: {i: "sales" for i in ids})
    obj = _user_domain_obj(agent_ns, agent, ["Sales"])
    out = obj._assign_to_user_domains([_uc("U1"), _uc("U2")], ["Sales"], "English")
    assert {u["Business Domain"] for u in out} == {"Sales"}
    assert not [c for c in agent.calls if c["path"] == "DOMAIN_FINDER_PROMPT"]


def _bobbed(no, name, bob, priority=7.0, table="c.s.orders"):
    return _uc(no, table=table, Name=name, bob_score=bob, Priority=priority)


def test_r7_post_bob_dedup_decides_duplicates_with_the_shared_signature(agent_ns):
    obj = _inspire(agent_ns)
    first = _bobbed("N1", "Forecast Weekly Store Demand", 9.0)
    synonym = _bobbed("N2", "Predict Store Weekly Demand", 8.0)
    other_tables = _bobbed("N3", "Forecast Weekly Store Demand", 6.0, table="c.s.web_events")
    kept = obj._dedup_canonical_titles([first, synonym, other_tables])
    assert [u["No"] for u in kept] == ["N1", "N3"]
    assert synonym["selection_drop_reason"] == 'duplicate decision of "Forecast Weekly Store Demand"'
    obj._number_by_domain([other_tables, first])
    assert first["No"] != "N1" and "N1" not in synonym["selection_drop_reason"], "renumbering never makes the reason point elsewhere"
    assert obj.funnel_ledger[-1] == {"stage": "canonical_title_dedup", "in": 3, "out": 2,
                                     "drops": {"duplicate_decision": 1}}


def test_r7_post_bob_dedup_keeps_higher_bob_then_higher_priority(agent_ns):
    obj = _inspire(agent_ns)
    low_priority = _bobbed("N1", "Predict Customer Churn", 8.0, priority=5.0)
    high_priority = _bobbed("N2", "Customer Churn Prediction", 8.0, priority=9.0)
    unscored_bob = _bobbed("N3", "Forecast Customer Churn", None, priority=9.9)
    kept = obj._dedup_canonical_titles([low_priority, high_priority, unscored_bob])
    assert [u["No"] for u in kept] == ["N2"]


class _EvidenceLoader:
    def get_table_comment(self, catalog, schema, table):
        return "One row per order"

    def get_primary_key(self, catalog, schema, table):
        return ["order_id"]

    def get_table_relations(self, catalog, schema, table):
        return [(("c", "s", "orders", "customer_id", "c", "s", "customers", "customer_id"), "declared", 1.0),
                (("c", "s", "orders", "store_id", "c", "s", "stores", "store_id"), "inferred", 0.85)]

    def get_sampling_info(self, catalog, schema, table):
        return (2, 40)


def _base_input_format(ns):
    base = ns["PROMPT_TEMPLATES"]["BASE_USE_CASE_GEN_PROMPT"]
    return base[base.index("#### INPUT DATA FORMAT"):base.index("{schema_markdown}")]


def test_r8_generation_prompt_describes_every_evidence_line_the_schema_renderer_emits(agent_ns):
    obj = _inspire(agent_ns, data_loader=_EvidenceLoader(), data_category_map={"c.s.orders": "TRANSACTIONAL"},
                   table_classification_status={"c.s.orders": "unverified"})
    md = obj._format_schema_for_prompt([("c", "s", "orders", "order_id", "bigint", ""),
                                        ("c", "s", "orders", "amount", "decimal", "Order total")])
    labels = re.findall(r"^([A-Z][A-Za-z ]+): ", md, re.M)
    assert set(labels) == {"Table comment", "Data category", "Primary key", "Foreign keys", "Columns shown"}
    assert "(inferred)" in md and "unverified default" in md
    section = _base_input_format(agent_ns)
    for label in labels:
        assert f"`{label}:" in section, label
    assert "`(inferred)`" in section and "unverified default" in section and "X of Y" in section


def test_r8_generation_prompt_carries_the_industry_the_call_site_passes(agent_ns):
    template = agent_ns["PROMPT_TEMPLATES"]["BASE_USE_CASE_GEN_PROMPT"]
    assert "**Industry:** {industry}" in template


def test_r8_domain_and_subdomain_prompts_require_exactly_one_row_per_input_id(agent_ns):
    for key in ("DOMAIN_FINDER_PROMPT", "SUBDOMAIN_DETECTOR_PROMPT"):
        body = agent_ns["PROMPT_TEMPLATES"][key]
        assert "EXACTLY ONE row per input use case" in body, key
        assert "appears exactly once as `use_case_id`" in body, key
        assert "Never omit, duplicate or invent a use case id" in body, key


def _generation_obj(ns, agent, instructions):
    obj = _inspire(ns, ai_agent=agent, table_id_map={}, id_table_map={}, column_id_map={}, id_column_map={},
                   next_table_id=1, next_column_id=1, user_strategic_goals=[],
                   data_category_map={"c.s.orders": "TRANSACTIONAL"}, global_table_names={"c.s.orders"},
                   _known_hallucinated_tables=set(),
                   processing_honesty={"total_batch_splits": 0, "batch_split_history": [],
                                       "tables_with_columns_dropped": []},
                   parsed_generation_instructions={"per_prompt_instructions": {"BASE_USE_CASE_GEN_PROMPT": instructions},
                                                   "interpretation_status": "ok"},
                   _business_column_details_global=[("c", "s", "orders", "amount", "decimal", "")])
    obj._format_schema_for_prompt = lambda cols: "### `c`.`s`.`orders`\n| amount | decimal | Order total |\n"
    obj._estimate_schema_markdown_size = lambda cols: len(obj._format_schema_for_prompt(cols))
    return obj


def test_r9_generation_never_sends_a_prompt_larger_than_the_safe_limit(fresh_ns):
    instructions = "Prefer use cases that join the order tables on their declared keys. " * 450
    response = GEN_HEADER + "\n" + _gen_row("N1-1", "Forecasting")
    columns = [("c", "s", "orders", "amount", "decimal", "")]
    fresh_ns["get_safe_context_limit"] = lambda *a, **k: 10 ** 9
    probe_agent = _rendering_agent(fresh_ns, lambda path, pv, skip: response)
    assert _generation_obj(fresh_ns, probe_agent, instructions)._process_batch_with_retry(columns, 1)
    true_size = len(probe_agent.calls[0]["prompt"])
    limit = true_size - 1
    fresh_ns["get_safe_context_limit"] = lambda *a, **k: limit
    agent = _rendering_agent(fresh_ns, lambda path, pv, skip: response)
    _generation_obj(fresh_ns, agent, instructions)._process_batch_with_retry(columns, 1)
    assert [len(c["prompt"]) for c in agent.calls if len(c["prompt"]) > limit] == []


def test_r9_every_prompt_size_estimate_counts_the_preamble_and_instructions(agent_ns):
    bare = []
    for cls in (n for n in agent_ast().body if isinstance(n, ast.ClassDef)):
        for fn in (m for m in cls.body if isinstance(m, ast.FunctionDef)):
            if fn.name == "_prompt_overhead_chars":
                continue
            for node in ast.walk(fn):
                if not (isinstance(node, ast.Call) and _callee(node) == "len" and node.args):
                    continue
                arg = node.args[0]
                if (isinstance(arg, ast.Name) and arg.id in ("prompt_template", "prompt_template_text")) or \
                        (isinstance(arg, ast.Call) and _callee(arg) == "get" and isinstance(arg.func, ast.Attribute)
                         and ast.unparse(arg.func.value).endswith(("prompt_templates", "PROMPT_TEMPLATES"))):
                    bare.append(f"{cls.name}.{fn.name}:{node.lineno}")
    assert bare == []
    for method in ("run", "_process_batch_with_retry"):
        assert "self._generation_prompt_base_size(" in ast.unparse(method_node("DatabricksInspire", method)), method
    obj = _inspire(agent_ns, ai_agent=types.SimpleNamespace(prompt_templates=dict(agent_ns["PROMPT_TEMPLATES"])),
                   parsed_generation_instructions={"per_prompt_instructions": {"DOMAIN_FINDER_PROMPT": "Z" * 3000},
                                                   "interpretation_status": "ok"})
    template = agent_ns["PROMPT_TEMPLATES"]["DOMAIN_FINDER_PROMPT"]
    overhead = obj._prompt_overhead_chars("DOMAIN_FINDER_PROMPT")
    assert overhead >= len(agent_ns["USER_DIRECTIVE_SUPREMACY_PREAMBLE"]) + len(template) + 3000
    assert obj._prompt_overhead_chars("GOAL_ALIGNMENT_FILTER_PROMPT") == (
        len(agent_ns["USER_DIRECTIVE_SUPREMACY_PREAMBLE"]) + len(agent_ns["PROMPT_TEMPLATES"]["GOAL_ALIGNMENT_FILTER_PROMPT"]))


def test_r10_table_filter_uses_only_the_shared_instruction_renderer():
    src = ast.unparse(method_node("DatabricksInspire", "_filter_business_tables"))
    assert "user_generation_instructions" not in src
    assert "Ignore tables matching" not in src
    recursive = ast.unparse(method_node("DatabricksInspire", "_process_filter_batch_recursive"))
    assert "self._get_generation_instruction_for_prompt('FILTER_BUSINESS_TABLES_PROMPT')" in recursive


def _filter_csv(tables):
    lines = ['"Table Name","Classification","Data Category","Business Score","Reason"']
    lines += [f'"{t}","BUSINESS","MASTER","80","ok"' for t in tables]
    return "\n".join(lines)


def _filter_tables_in(prompt_vars):
    return re.findall(r"`([^`]+)`\.`([^`]+)`\.`([^`]+)`", prompt_vars["tables_markdown"])


def test_r10_filter_prompt_renders_the_user_instructions_once(agent_ns):
    raw = "Ignore scratch tables and the job logs."
    parsed = {"table_ignores": [{"pattern": "tmp_*", "type": "prefix"}]}
    agent = _rendering_agent(agent_ns, lambda path, pv, skip: _filter_csv(".".join(t) for t in _filter_tables_in(pv)))
    obj = _inspire(agent_ns, ai_agent=agent, parsed_generation_instructions=parsed, user_generation_instructions=raw)
    details = [("main", "sales", "orders", "order_id", "bigint", None), ("main", "ops", "tmp_scratch", "x", "string", None)]
    obj._filter_business_tables(details)
    call = agent.calls[0]
    assert call["prompt"].count(raw) == 1
    assert "IGNORE TABLES matching `tmp_*` (prefix)" in call["prompt"]
    assert raw not in call["vars"]["additional_context_section"]
    assert call["prompt"].count("Goals are not exclusions") == 1
    assert obj.table_classification_status["main.ops.tmp_scratch"] == "user_ignored"


def test_r11_unused_pyspark_col_import_is_gone():
    top = symtable.symtable(agent_source(), "agent", "exec")
    assert "col" not in {s.get_name() for s in top.get_symbols() if s.is_imported()}
    referenced = []

    def walk(table):
        for child in table.get_children():
            try:
                sym = child.lookup("col")
            except KeyError:
                sym = None
            if sym is not None and sym.is_referenced() and sym.is_global():
                referenced.append(child.get_name())
            walk(child)

    walk(top)
    assert referenced == []


_EXECUTOR_PRIMITIVES = {"_SafeExecutorContext.__init__", "ParallelExecutor.execute_parallel",
                        "TimeoutHandler.execute_with_timeout"}
_PHASE2_GENIE_NOTEBOOK = {"DatabricksInspire._run_discover_skeleton_phase",
                          "DatabricksInspire._regenerate_genie_for_flagged_rows",
                          "DatabricksInspire._generate_genie_instructions_and_notebooks"}


def test_r12_no_raw_executor_outside_the_primitives_and_the_phase2_genie_notebook_code():
    raw = []
    for top_node in agent_ast().body:
        members = top_node.body if isinstance(top_node, ast.ClassDef) else [top_node]
        for fn in members:
            if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            owner = f"{top_node.name}.{fn.name}" if isinstance(top_node, ast.ClassDef) else fn.name
            if owner in _EXECUTOR_PRIMITIVES | _PHASE2_GENIE_NOTEBOOK:
                continue
            for node in ast.walk(fn):
                if isinstance(node, ast.Call) and _callee(node) in ("ThreadPoolExecutor", "as_completed"):
                    raw.append(f"{owner}:{node.lineno}")
    assert raw == []


def test_r12_filter_split_sub_batches_inherit_the_parent_cancellation(fresh_ns):
    tables = ["c.s.alpha", "c.s.beta"]
    lines = {t: f"- `{t.replace('.', '`.`')}` | columns (1): " + "x" * 3000 for t in tables}
    agent = _rendering_agent(fresh_ns, lambda path, pv, skip: _filter_csv(".".join(t) for t in _filter_tables_in(pv)))
    obj = _inspire(fresh_ns, ai_agent=agent)
    probe_vars = {"business_name": "Acme", "industry": "I", "business_context": "B", "exclusion_strategy": "Medium",
                  "strategy_rules": "R", "additional_context_section": "", "tables_markdown": "",
                  "generation_instructions_section": obj._get_generation_instruction_for_prompt("FILTER_BUSINESS_TABLES_PROMPT")}
    base = len(agent._load_and_format_prompt("FILTER_BUSINESS_TABLES_PROMPT", probe_vars))
    fresh_ns["get_max_context_chars"] = lambda language="English", prompt_name=None: base + 4500
    parent = threading.Event()
    parent.set()
    fresh_ns["_register_thread_cancel"](parent)
    try:
        result = obj._process_filter_batch_recursive(tables, 1, 1, "Acme", "I", "B", "Medium", "R", "", 0, 10, lines)
    finally:
        fresh_ns["_unregister_thread_cancel"]()
    assert sorted(result) == tables
    assert len(agent.calls) == 2 and all(c["cancelled"] for c in agent.calls)


def test_r12_subdomain_dispatch_timeout_cancels_in_flight_detection(fresh_ns):
    observed = []

    def detect(name, ucs, lang, timeout_seconds_override=None):
        deadline = time.time() + 5
        while time.time() < deadline and not fresh_ns["_is_thread_cancelled"]():
            time.sleep(0.01)
        observed.append(fresh_ns["_is_thread_cancelled"]())
        return []

    def instant_timeout(futures, timeout=None, **kwargs):
        time.sleep(0.2)
        raise concurrent.futures.TimeoutError("forced")
        yield

    fresh_ns["safe_as_completed"] = instant_timeout
    obj = _inspire(fresh_ns)
    obj._detect_subdomains_for_domain = detect
    ucs = [_uc("U1", **{"Business Domain": "Sales"}), _uc("U2", **{"Business Domain": "Ops"})]
    out = obj._detect_subdomains_all_domains(ucs, "English", "user-domain")
    assert sorted(u["No"] for u in out) == ["U1", "U2"]
    deadline = time.time() + 5
    while len(observed) < 2 and time.time() < deadline:
        time.sleep(0.02)
    assert observed == [True, True]


def _own_returns(fn):
    out = []
    stack = list(fn.body)
    while stack:
        node = stack.pop()
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef)):
            continue
        if isinstance(node, ast.Return):
            out.append(node)
        stack.extend(ast.iter_child_nodes(node))
    return out


def test_r13_h1_every_table_filter_exit_returns_the_nine_tuple_run_unpacks():
    for method in ("_filter_business_tables", "_filter_business_tables_with_batching"):
        returns = _own_returns(method_node("DatabricksInspire", method))
        assert returns, method
        for ret in returns:
            value = ret.value
            assert (isinstance(value, ast.Tuple) and len(value.elts) == 9) or (
                isinstance(value, ast.Call) and _callee(value) == "_filter_business_tables_with_batching"), \
                (method, ast.unparse(ret))
    run = method_node("DatabricksInspire", "run")
    unpacks = [n for n in ast.walk(run) if isinstance(n, ast.Assign) and isinstance(n.value, ast.Call)
               and _callee(n.value) == "_filter_business_tables"]
    assert unpacks and all(isinstance(n.targets[0], ast.Tuple) and len(n.targets[0].elts) == 9 for n in unpacks)


def test_r13_h1_empty_input_returns_the_nine_tuple(agent_ns):
    assert _inspire(agent_ns)._filter_business_tables([]) == ([], [], set(), set(), {}, {}, set(), set(), set())


def test_r13_a4_an_empty_csv_parse_is_a_failure_for_every_csv_consumer(agent_ns):
    obj = _inspire(agent_ns)
    assert obj._parse_assignment_csv("I could not classify these use cases.", "domain", "t", [_uc("U1")]) == {}
    with pytest.raises(ValueError):
        obj._parse_dedup_response("I could not decide which ones to keep.", [_uc("U1")], "t")
    agent = _rendering_agent(agent_ns, lambda path, pv, skip: "Sorry, I cannot classify these tables.")
    filt = _inspire(agent_ns, ai_agent=agent)
    lines = {"c.s.alpha": "- `c`.`s`.`alpha` | columns (1): id bigint"}
    assert filt._process_filter_batch_recursive(["c.s.alpha"], 1, 1, "Acme", "I", "B", "Medium", "R", "", 0, 10, lines) == {}
    assert [c["skip_cache"] for c in agent.calls] == [False, True]
    agent2 = _rendering_agent(agent_ns, lambda path, pv, skip: "Sorry, I cannot classify these tables.")
    whole = _inspire(agent_ns, ai_agent=agent2)
    before = len(agent_ns["NEXT_ACTIONS"].snapshot())
    whole._filter_business_tables([("c", "s", "alpha", "id", "bigint", None)])
    assert whole.table_classification_status == {"c.s.alpha": "unverified"}
    assert any(a["rule_id"] == "TABLE_FILTER_PARSE_FAILED" for a in agent_ns["NEXT_ACTIONS"].snapshot()[before:])
    user = _user_domain_obj(agent_ns, _ClusterAgent(lambda ids, skip: {}), ["Sales"])
    kept = user._assign_to_user_domains([_uc("U1")], ["Sales"], "English")
    assert [u["No"] for u in kept] == ["U1"] and kept[0]["Business Domain"] != "Sales"


class _BobStorage:
    def load_schema_markdown(self, tag="schema_markdown"):
        return None

    def save_schema_markdown(self, markdown, tag="schema_markdown"):
        return None


def test_r13_d1_12_best_of_best_receives_its_rendered_generation_instructions(agent_ns):
    def respond(path, pv, skip):
        ids = re.findall(r"### Use Case: (\S+) - ", pv["use_cases_to_validate"])
        return json.dumps([{"No": i, "bob_scores": {f"D{n}": 7 for n in range(1, 20)}, "idea_theme": "Demand",
                            "bob_justification_short": "ok"} for i in ids])

    agent = _ScoringAgent(respond)
    parsed = {"per_prompt_instructions": {"BEST_OF_BEST_SCORING_PROMPT": "Never lower goal-aligned use cases on D12."},
              "interpretation_status": "ok"}
    obj = _inspire(agent_ns, ai_agent=agent, parsed_generation_instructions=parsed, storage_manager=_BobStorage())
    obj._score_best_of_best([_uc("U1")], [("c", "s", "orders", "amount", "decimal", "")], business_context="B")
    bob = [c for c in agent.calls if c["path"] == "BEST_OF_BEST_SCORING_PROMPT"]
    assert bob and "Never lower goal-aligned use cases on D12." in bob[0]["vars"]["generation_instructions_section"]
    assert bob[0]["vars"]["generation_instructions_section"] == obj._get_generation_instruction_for_prompt(
        "BEST_OF_BEST_SCORING_PROMPT")
