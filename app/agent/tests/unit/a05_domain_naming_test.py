"""REQ-573 R8.5, R8.6 (lane a05_domain_naming): the graph domains get names from small batched LLM calls, and the domain
agreement (adjusted Rand index) is a logged diagnostic that never gates or changes the partition.

- R8.5 DatabricksInspire._name_table_domains(table_domains, table_columns=None) names the domains of inspire_table_domains
  in batches of INSPIRE_DOMAIN_NAME_BATCH domains per call, at most INSPIRE_DOMAIN_NAME_PARALLELISM calls at once, through
  ai_agent._call_ai_query(prompt_name="name_table_domains", ...). Each prompt holds only its own domains and their member
  tables. A failed, malformed, missing or duplicate answer gets inspire_domain_fallback_name(domain), built from the
  domain's member tables. It never raises. One domain (or none) needs no call.
- R8.6 inspire_adjusted_rand_index(first, second) compares two {item: label} partitions over their shared items.
  _join_group_plan stores it in table_domains["diagnostics"] (graph domains vs the join groups) and logs it; its value,
  or its failure, never changes the domains or the batches.

All metadata is synthetic and generic (c.s.g01_t0, c.s.a_txn). The LLM is a fake call function; no network, no Spark."""
import json
import logging
import math
import os
import re
import sys
import threading
import time
import types

UNIT = os.path.dirname(os.path.abspath(__file__))
if UNIT not in sys.path:
    sys.path.insert(0, UNIT)

from a04_domain_graph_test import HUB, _cols, _scope  # noqa: E402

PROMPT_NAME = "name_table_domains"
ID_RE = re.compile(r"\bD\d+\b")


def _fn(ns, name):
    fn = ns.get(name)
    assert callable(fn), f"R8.5/R8.6: the notebook defines no {name}"
    return fn


def _const(ns, name):
    assert name in ns, f"R8.5: the notebook defines no {name} constant"
    return ns[name]


def _domains(n, size=3):
    """n graph domains shaped like inspire_table_domains output: D1..Dn, each with its own tables and one primary."""
    return {"domains": [{"id": f"D{i}", "tables": [f"c.s.g{i:02d}_t{j}" for j in range(size)],
                         "primaries": [f"c.s.g{i:02d}_t0"]} for i in range(1, n + 1)]}


class FakeAI:
    """Answers each naming call with "Name <id>" for every domain id in its prompt; records prompts and concurrency."""

    def __init__(self, delay=0.0, fail_if=None, answer=None):
        self.calls, self.lock, self.active, self.max_active = [], threading.Lock(), 0, 0
        self.delay, self.fail_if, self.answer = delay, fail_if, answer

    def _call_ai_query(self, prompt=None, prompt_name=None, response_schema=None, display_name=None, **_kw):
        with self.lock:
            self.calls.append({"prompt": prompt, "prompt_name": prompt_name, "schema": response_schema})
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        try:
            if self.delay:
                time.sleep(self.delay)
            ids = sorted(set(ID_RE.findall(prompt or "")), key=lambda d: int(d[1:]))
            if self.fail_if and self.fail_if(ids):
                raise RuntimeError("endpoint busy")
            if self.answer is not None:
                return self.answer(ids)
            return json.dumps({"domains": [{"id": d, "name": f"Name {d}"} for d in ids]})
        finally:
            with self.lock:
                self.active -= 1


def _obj(ns, ai=None, parallelism=16):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = logging.getLogger("a05_domain_naming")
    obj.processing_honesty = {}
    obj.max_parallelism = parallelism
    if ai is not None:
        obj.ai_agent = ai
    return obj


def _ids_of(call):
    return set(ID_RE.findall(call["prompt"] or ""))


# --- R8.5: batched, bounded-parallel naming ---

def test_naming_constants_are_small_bounded_batches(agent_ns):
    batch, parallel = _const(agent_ns, "INSPIRE_DOMAIN_NAME_BATCH"), _const(agent_ns, "INSPIRE_DOMAIN_NAME_PARALLELISM")
    assert batch == 8 and parallel == 4, (batch, parallel)


def test_twenty_domains_are_named_in_three_batched_calls(agent_ns):
    ai, table_domains = FakeAI(), _domains(20)
    names = _obj(agent_ns, ai)._name_table_domains(table_domains)
    assert len(ai.calls) == math.ceil(20 / 8) == 3, [sorted(_ids_of(c)) for c in ai.calls]
    assert sorted(len(_ids_of(c)) for c in ai.calls) == [4, 8, 8], "R8.5: each call names at most 8 domains"
    assert all(c["prompt_name"] == PROMPT_NAME and isinstance(c["schema"], dict) for c in ai.calls), ai.calls[0]
    assert names == {f"D{i}": f"Name D{i}" for i in range(1, 21)}
    for domain in table_domains["domains"]:
        assert domain["name"] == f"Name {domain['id']}" and domain["name_source"] == "llm", domain


def test_each_prompt_holds_only_its_own_domains_and_their_member_tables(agent_ns):
    ai, table_domains = FakeAI(), _domains(12)
    _obj(agent_ns, ai)._name_table_domains(table_domains)
    by_id = {d["id"]: d for d in table_domains["domains"]}
    for call in ai.calls:
        mine = _ids_of(call)
        for did, domain in by_id.items():
            for table in domain["tables"]:
                if did in mine:
                    assert table in call["prompt"], f"R8.5: the prompt for {sorted(mine)} misses member table {table}"
                else:
                    assert table not in call["prompt"], f"R8.5: the prompt for {sorted(mine)} leaks {table} of {did}"


def test_calls_run_in_parallel_within_the_cap(agent_ns):
    ai = FakeAI(delay=0.4)
    started = time.time()
    _obj(agent_ns, ai, parallelism=16)._name_table_domains(_domains(40))
    cap = agent_ns["INSPIRE_DOMAIN_NAME_PARALLELISM"]
    assert len(ai.calls) == 5
    assert 2 <= ai.max_active <= cap, f"R8.5: {ai.max_active} calls ran at once; want parallel and at most {cap}"
    assert time.time() - started < 5 * 0.4 + 1.5, "R8.5: the naming calls ran one after another"


def test_parallelism_never_exceeds_the_run_max_parallelism(agent_ns):
    ai = FakeAI(delay=0.2)
    _obj(agent_ns, ai, parallelism=1)._name_table_domains(_domains(24))
    assert len(ai.calls) == 3 and ai.max_active == 1, ai.max_active


def test_a_failed_call_falls_back_for_its_batch_only_and_never_raises(agent_ns):
    ai, table_domains = FakeAI(fail_if=lambda ids: "D1" in ids), _domains(10)
    names = _obj(agent_ns, ai)._name_table_domains(table_domains)
    fallback = _fn(agent_ns, "inspire_domain_fallback_name")
    for domain in table_domains["domains"]:
        if int(domain["id"][1:]) <= 8:
            assert domain["name_source"] == "fallback" and domain["name"] == fallback(domain), domain
        else:
            assert domain["name_source"] == "llm" and domain["name"] == f"Name {domain['id']}", domain
    assert names == {d["id"]: d["name"] for d in table_domains["domains"]}


def test_malformed_missing_and_duplicate_answers_fall_back(agent_ns):
    def answer(ids):
        rows = [{"id": "D1", "name": "Shared Name"}, {"id": "D2", "name": "shared name"}, {"id": "D3", "name": "   "},
                {"id": "D4", "name": "x" * 61}, {"id": "D99", "name": "Unknown Domain"}, {"id": "D5", "name": "  Five  Name "}]
        return json.dumps({"domains": rows})

    table_domains = _domains(6)
    _obj(agent_ns, FakeAI(answer=answer))._name_table_domains(table_domains)
    got = {d["id"]: (d["name"], d["name_source"]) for d in table_domains["domains"]}
    fallback = _fn(agent_ns, "inspire_domain_fallback_name")
    by_id = {d["id"]: d for d in table_domains["domains"]}
    assert got["D1"] == ("Shared Name", "llm")
    assert got["D5"] == ("Five Name", "llm"), "R8.5: names are stripped and whitespace-collapsed"
    for did in ("D2", "D3", "D4", "D6"):
        assert got[did] == (fallback(by_id[did]), "fallback"), (did, got[did])
    assert "D99" not in got

    garbage = _domains(3)
    _obj(agent_ns, FakeAI(answer=lambda ids: "not json at all"))._name_table_domains(garbage)
    assert all(d["name_source"] == "fallback" for d in garbage["domains"])


def test_names_are_unique_across_domains(agent_ns):
    table_domains = _domains(9)
    _obj(agent_ns, FakeAI(answer=lambda ids: json.dumps({"domains": [{"id": d, "name": "Same"} for d in ids]})))\
        ._name_table_domains(table_domains)
    names = [d["name"].lower() for d in table_domains["domains"]]
    assert len(set(names)) == len(names), names


def test_one_domain_or_none_needs_no_call(agent_ns):
    ai, one = FakeAI(), _domains(1)
    names = _obj(agent_ns, ai)._name_table_domains(one)
    assert ai.calls == [], "R8.5: a single domain is named without an LLM call"
    assert names == {"D1": _fn(agent_ns, "inspire_domain_fallback_name")(one["domains"][0])}
    assert one["domains"][0]["name_source"] == "fallback"
    assert _obj(agent_ns, ai)._name_table_domains({"domains": []}) == {} and ai.calls == []


def test_no_ai_agent_gives_fallback_names_and_never_raises(agent_ns):
    table_domains = _domains(3)
    names = _obj(agent_ns, None)._name_table_domains(table_domains)
    assert set(names) == {"D1", "D2", "D3"} and all(d["name_source"] == "fallback" for d in table_domains["domains"])


def test_fallback_name_is_grounded_in_the_member_tables(agent_ns):
    fallback = _fn(agent_ns, "inspire_domain_fallback_name")
    assert fallback({"id": "D1", "tables": ["c.s.beta_ref", "c.s.alpha_event"], "primaries": ["c.s.alpha_event"]}) \
        == "Alpha Event"
    assert fallback({"id": "D2", "tables": ["c.s.gamma_item", "c.s.delta_code"], "primaries": []}) == "Delta Code", \
        "with no primary the first member table (sorted) names the domain"
    domain = {"id": "D3", "tables": ["c.s.zeta_log"], "primaries": ["c.s.zeta_log"]}
    assert fallback(domain) == fallback(dict(domain)) and domain == {"id": "D3", "tables": ["c.s.zeta_log"],
                                                                     "primaries": ["c.s.zeta_log"]}


def test_the_naming_call_is_a_registered_inline_prompt(agent_ns):
    registered = {p["prompt_name"]: p for p in agent_ns["TECHNICAL_CONTEXT"]["prompts_models"]}
    assert PROMPT_NAME in registered, "R8.5: name_table_domains is not in TECHNICAL_CONTEXT.prompts_models"
    assert registered[PROMPT_NAME]["model_type"] == "worker" and registered[PROMPT_NAME]["temperature"] == 0.0
    assert PROMPT_NAME in agent_ns["INLINE_PROMPT_NAMES"] and PROMPT_NAME not in agent_ns["PROMPT_TEMPLATES"]


# --- wiring: the join plan names its domains ---

def _plan(ns, ai=None):
    tables, edges, categories = _scope()
    fk_graph, columns = {}, {t: [f"{t.split('.')[-1]}_id"] for t in tables}
    for e in edges:
        fk_graph.setdefault(e["left"], []).append((f"{e['right'].split('.')[-1]}_id", e["right"],
                                                   f"{e['right'].split('.')[-1]}_id", "declared"))
        columns[e["left"]].append(f"{e['right'].split('.')[-1]}_id")
    details = [d for t in tables for d in _cols(t, columns[t])]
    tx = [d for d in details if categories.get(".".join(d[:3])) == "TRANSACTIONAL"]
    masters = [d for d in details if categories.get(".".join(d[:3])) != "TRANSACTIONAL"]
    obj = _obj(ns, ai, parallelism=2)
    obj._kind_fk_graph = fk_graph
    obj.data_category_map = dict(categories)
    obj.discovery_evidence = {}
    return obj, obj._join_group_plan(tx, masters, details)


def test_join_group_plan_names_every_domain_in_one_call_and_tags_challenger_batches(agent_ns, caplog):
    ai = FakeAI()
    with caplog.at_level(logging.INFO, logger="a05_domain_naming"):
        obj, plan = _plan(agent_ns, ai)
    domains = obj.table_domains["domains"]
    assert len(domains) == 2 and len(ai.calls) == 1, (len(domains), len(ai.calls))
    names = {d["id"]: d["name"] for d in domains}
    assert names == {d["id"]: f"Name {d['id']}" for d in domains}
    batches = [b for b in plan["challenger"] if HUB in b["via"]]
    assert batches and all(b["domain_names"] == [names[d] for d in b["domains"]] for b in plan["challenger"]), \
        "R8.5: each challenger batch carries the names of its two domains"
    assert "[DOMAIN-NAMING FIRED]" in caplog.text


def test_join_group_plan_without_an_ai_agent_still_names_by_fallback(agent_ns):
    obj, _plan_out = _plan(agent_ns, None)
    assert all(d.get("name") and d.get("name_source") == "fallback" for d in obj.table_domains["domains"])


# --- R8.6: adjusted Rand index, a diagnostic only ---

def test_ari_is_one_for_the_same_partition_under_relabelling(agent_ns):
    ari = _fn(agent_ns, "inspire_adjusted_rand_index")
    first = {"t1": "D1", "t2": "D1", "t3": "D2", "t4": "D2", "t5": "D3"}
    second = {"t1": 7, "t2": 7, "t3": 3, "t4": 3, "t5": 9}
    assert ari(first, second) == 1.0


def test_ari_matches_the_hand_computed_value_and_is_symmetric(agent_ns):
    ari = _fn(agent_ns, "inspire_adjusted_rand_index")
    first, second = {"a": 0, "b": 0, "c": 1, "d": 1}, {"a": 0, "b": 0, "c": 1, "d": 2}
    assert abs(ari(first, second) - 4 / 7) < 1e-9 and abs(ari(second, first) - 4 / 7) < 1e-9
    assert abs(ari({"a": 0, "b": 0, "c": 1, "d": 1}, {"a": 0, "b": 1, "c": 0, "d": 1}) - (-0.5)) < 1e-9


def test_ari_compares_shared_items_only_and_needs_two(agent_ns):
    ari = _fn(agent_ns, "inspire_adjusted_rand_index")
    first, second = {"a": 0, "b": 0, "c": 1, "d": 1, "e": 5}, {"a": 0, "b": 0, "c": 1, "d": 2, "z": 4}
    snapshot = (dict(first), dict(second))
    assert abs(ari(first, second) - 4 / 7) < 1e-9 and (first, second) == snapshot
    assert ari({"a": 1}, {"a": 1, "b": 2}) is None and ari({}, {}) is None
    assert ari({"a": 0, "b": 1}, {"a": 5, "b": 6}) == 1.0, "all-singleton on both sides is the same partition"


def test_join_group_plan_stores_and_logs_the_ari_as_a_diagnostic(agent_ns, caplog):
    with caplog.at_level(logging.INFO, logger="a05_domain_naming"):
        obj, _out = _plan(agent_ns, FakeAI())
    diag = obj.table_domains.get("diagnostics") or {}
    assert "ari_vs_join_groups" in diag and isinstance(diag.get("tables_compared"), int), diag
    assert diag["ari_vs_join_groups"] is None or -1.0 <= diag["ari_vs_join_groups"] <= 1.0
    line = [r.getMessage() for r in caplog.records if "[DOMAIN-ARI]" in r.getMessage()]
    assert line and "diagnostic" in line[0].lower(), "R8.6: the ARI is logged and labelled a diagnostic"


def test_ari_value_never_changes_the_domains_or_the_batches(agent_ns, monkeypatch):
    def run(value):
        seen = []

        def fake_ari(first, second):
            seen.append((dict(first), dict(second)))
            if isinstance(value, Exception):
                raise value
            return value

        monkeypatch.setitem(agent_ns, "inspire_adjusted_rand_index", fake_ari)
        obj, plan = _plan(agent_ns, FakeAI())
        assert seen, "R8.6: _join_group_plan never computes the ARI diagnostic"
        domains = [{k: v for k, v in d.items()} for d in obj.table_domains["domains"]]
        return domains, obj.table_domains["memberships"], plan, obj.table_domains["diagnostics"]["ari_vs_join_groups"]

    high, low, broken = run(1.0), run(-1.0), run(RuntimeError("diagnostic failed"))
    assert high[0] == low[0] == broken[0] and high[1] == low[1] == broken[1]
    assert high[2] == low[2] == broken[2], "R8.6: the ARI must never gate or change the generation batches"
    assert (high[3], low[3], broken[3]) == (1.0, -1.0, None)
