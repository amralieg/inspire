"""REQ-573 R8.1-R8.4 (lane a04_domain_graph): tables grouped into domains over one join graph, hubs, bridges, challenger pairs.

- R8.1 one join graph with provenance: DatabricksInspire._join_edges builds every edge from the FK graph (declared -> fk),
  query-history joins (co_join), lineage co-use (lineage) and name matches (name), each with its source and the fixed weight
  INSPIRE_DOMAIN_EDGE_WEIGHTS; a name match is an edge only when a measured key overlap backs it. _join_adjacency (REQ-413)
  is a projection of the same edges, never a second implementation.
- R8.2 hubs are found by structure (share of the other tables joined), never by name, are downweighted during detection and
  re-attached afterwards as shared hubs of every domain they touch; a transactional table is never a hub.
- R8.3 a master, reference or bridge table can belong to several domains; a transactional table has exactly one primary
  domain (where its value is counted) plus context memberships.
- R8.4 inspire_table_domains emits challenger pairs (domain pairs that share a hub or a bridge table); _join_group_plan turns
  each into a cross-domain generation batch, which _elect_generation_batches sends down the existing generation path.
- R9.5 hint: one coherent group (or no edges at all) sets skip_domain_step.

All metadata is synthetic and generic (c.s.a_*, c.s.b_*). Pure functions under test: _join_edges (classmethod) and
inspire_table_domains(tables, edges, categories); wiring: _join_group_plan and _elect_generation_batches."""
import ast
import json
import logging
import os
import random
import re
import textwrap
import time

WEIGHTS = {"fk": 1.0, "co_join": 0.8, "lineage": 0.6, "name": 0.4}
HUB = "c.s.h"
NOTEBOOK = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "agent",
                        "dbx_inspire_ai_agent.ipynb")


def _domains_fn(ns):
    fn = ns.get("inspire_table_domains")
    assert callable(fn), "R8.1: the notebook defines no inspire_table_domains(tables, edges, categories), the table-domain graph"
    return fn


def _edges_fn(ns):
    fn = getattr(ns["DatabricksInspire"], "_join_edges", None)
    assert callable(fn), "R8.1: DatabricksInspire has no _join_edges classmethod, the one join graph with edge provenance"
    return fn


def _e(a, b, source="fk"):
    return {"left": a, "right": b, "source": source, "weight": WEIGHTS[source]}


def _scope(extra=(), extra_tables=()):
    """Two domains A and B (a transactional table, three masters, one reference each, FK + co-join links), a hub h joined to
    10 of the 12 other tables (83%), an unlabelled bridge x linking a_m1 and b_m1, and a master m_shared both transactions use."""
    edges, categories = [], {}
    for p in "ab":
        t = f"c.s.{p}_txn"
        categories[t] = "TRANSACTIONAL"
        for m in ("m1", "m2", "m3", "ref"):
            edges.append(_e(t, f"c.s.{p}_{m}"))
            categories[f"c.s.{p}_{m}"] = "REFERENCE" if m == "ref" else "MASTER"
        for u, v in (("m1", "m2"), ("m2", "m3"), ("m1", "m3"), ("m3", "ref")):
            edges.append(_e(f"c.s.{p}_{u}", f"c.s.{p}_{v}", "co_join"))
        for m in ("txn", "m1", "m2", "m3", "ref"):
            edges.append(_e(f"c.s.{p}_{m}", HUB))
    categories[HUB] = "MASTER"
    categories["c.s.m_shared"] = "MASTER"
    edges += [_e("c.s.x", "c.s.a_m1"), _e("c.s.x", "c.s.b_m1"), _e("c.s.a_txn", "c.s.m_shared"), _e("c.s.b_txn", "c.s.m_shared")]
    edges += list(extra)
    tables = sorted({t for e in edges for t in (e["left"], e["right"])} | set(extra_tables))
    return tables, edges, categories


def _roles(result, table):
    return [(m["domain"], m["role"]) for m in result["memberships"].get(table, [])]


def _home(result, table):
    homes = [d for d, role in _roles(result, table) if role in ("primary", "member")]
    assert len(homes) == 1, f"{table} must have exactly one home domain, got {_roles(result, table)}"
    return homes[0]


def _domain_ids(result, table):
    return {d for d, _role in _roles(result, table)}


def _cols(table, names, typ="bigint"):
    c, s, t = table.split(".")
    return [(c, s, t, n, typ, "") for n in names]


# --- R8.1: one join graph, every edge with its source ---

def test_edge_weights_are_the_fixed_coordinator_weights(agent_ns):
    assert agent_ns.get("INSPIRE_DOMAIN_EDGE_WEIGHTS") == WEIGHTS, \
        "R8.1: INSPIRE_DOMAIN_EDGE_WEIGHTS must be fixed at FK 1.0, co-join 0.8, lineage 0.6, name 0.4"


def test_declared_fk_is_an_fk_edge_with_its_columns(agent_ns):
    fqtns = ["c.s.p_one", "c.s.p_two"]
    columns = {"c.s.p_one": _cols("c.s.p_one", ["one_id", "two_id"]), "c.s.p_two": _cols("c.s.p_two", ["two_id"])}
    fk_graph = {"c.s.p_one": [("two_id", "c.s.p_two", "two_id", "declared")]}
    edges = _edges_fn(agent_ns)(fqtns, columns, fk_graph, evidence={})
    fk = [e for e in edges if {e["left"], e["right"]} == set(fqtns)]
    assert [(e["source"], e["weight"]) for e in fk] == [("fk", 1.0)], edges
    assert fk[0]["columns"] and "two_id" in " ".join(fk[0]["columns"])


def test_history_join_is_co_join_and_co_use_is_lineage(agent_ns):
    fqtns = ["c.s.p_one", "c.s.p_two", "c.s.p_three"]
    columns = {f: _cols(f, ["note_text"], "string") for f in fqtns}
    evidence = {"history_joins": [{"left": "c.s.p_one.ref_no", "right": "c.s.p_two.ref_no", "count": 3}],
                "usage": {"available": True, "co_used": [{"left": "c.s.p_one", "right": "c.s.p_three", "runs": 4}]}}
    edges = _edges_fn(agent_ns)(fqtns, columns, {}, evidence=evidence)
    got = {(frozenset((e["left"], e["right"])), e["source"], e["weight"]) for e in edges}
    assert (frozenset(("c.s.p_one", "c.s.p_two")), "co_join", 0.8) in got, edges
    assert (frozenset(("c.s.p_one", "c.s.p_three")), "lineage", 0.6) in got, edges


def test_name_match_backed_by_key_overlap_is_a_name_edge(agent_ns):
    fqtns = ["c.s.p_one", "c.s.p_two"]
    columns = {f: _cols(f, ["part_id"]) for f in fqtns}
    evidence = {"join_matches": [{"child_table": "c.s.p_one", "child_column": "part_id", "parent_table": "c.s.p_two",
                                  "parent_column": "part_id", "rate": 0.9}]}
    edges = _edges_fn(agent_ns)(fqtns, columns, {}, evidence=evidence)
    assert [(e["source"], e["weight"]) for e in edges if {e["left"], e["right"]} == set(fqtns)] == [("name", 0.4)], edges


def test_name_match_without_key_overlap_gives_no_edge(agent_ns):
    fqtns = ["c.s.p_one", "c.s.p_two"]
    columns = {"c.s.p_one": _cols("c.s.p_one", ["part_id", "lot_id"]), "c.s.p_two": _cols("c.s.p_two", ["part_id", "lot_id"])}
    inferred = {"c.s.p_one": [("lot_id", "c.s.p_two", "lot_id", "inferred")]}
    low = {"join_matches": [{"child_table": "c.s.p_one", "child_column": "part_id", "parent_table": "c.s.p_two",
                             "parent_column": "part_id", "rate": 0.1}]}
    for fk_graph, evidence in (({}, {}), (inferred, {}), ({}, low)):
        edges = _edges_fn(agent_ns)(fqtns, columns, fk_graph, evidence=evidence)
        assert not [e for e in edges if {e["left"], e["right"]} == set(fqtns)], \
            f"R8.1: a name match with no measured key overlap is no edge ({fk_graph}, {evidence}): {edges}"
        result = _domains_fn(agent_ns)(fqtns, edges, {})
        assert sorted(result["unattached"]) == fqtns and result["domains"] == []


def test_every_edge_records_a_known_source_and_its_fixed_weight(agent_ns):
    fqtns = ["c.s.p_one", "c.s.p_two", "c.s.p_three", "c.s.p_four"]
    columns = {f: _cols(f, ["part_id", "four_id"]) for f in fqtns}
    fk_graph = {"c.s.p_one": [("four_id", "c.s.p_four", "four_id", "declared")]}
    evidence = {"history_joins": [{"left": "c.s.p_two.part_id", "right": "c.s.p_three.part_id", "count": 2}],
                "usage": {"available": True, "co_used": [{"left": "c.s.p_one", "right": "c.s.p_two", "runs": 5}]},
                "join_matches": [{"child_table": "c.s.p_three", "child_column": "part_id", "parent_table": "c.s.p_four",
                                  "parent_column": "part_id", "rate": 0.95}]}
    edges = _edges_fn(agent_ns)(fqtns, columns, fk_graph, evidence=evidence)
    assert {e["source"] for e in edges} == set(WEIGHTS), edges
    for edge in edges:
        assert edge["weight"] == WEIGHTS[edge["source"]], edge
        assert edge["left"] < edge["right"] and edge["left"] in fqtns and edge["right"] in fqtns, edge


def test_a_pair_with_two_sources_keeps_both_and_the_highest_weight(agent_ns):
    tables, edges, categories = _scope(extra=[_e("c.s.a_txn", "c.s.a_m1", "co_join")])
    result = _domains_fn(agent_ns)(tables, edges, categories)
    pair = [e for e in result["edges"] if {e["left"], e["right"]} == {"c.s.a_txn", "c.s.a_m1"}]
    assert len(pair) == 1 and sorted(pair[0]["sources"]) == ["co_join", "fk"] and pair[0]["weight"] == 1.0, pair


def test_join_adjacency_is_a_projection_of_join_edges(agent_ns, monkeypatch):
    cls = agent_ns["DatabricksInspire"]
    edge = {"left": "c.s.u", "right": "c.s.v", "source": "fk", "weight": 1.0, "columns": ["c.s.u.v_id = c.s.v.v_id"],
            "via": "fk_graph"}
    monkeypatch.setattr(cls, "_join_edges", classmethod(lambda _cls, *args, **kwargs: [dict(edge)]), raising=False)
    adjacency, sources = cls._join_adjacency(["c.s.u", "c.s.v"], {}, {})
    assert adjacency.get("c.s.u") == {"c.s.v"} and sources.get(frozenset(("c.s.u", "c.s.v"))) == "graph", \
        "R8.1: _join_adjacency must read its edges from _join_edges (one join graph), not build its own"


# --- R8.2: structural hubs, downweighted then re-attached ---

def test_hub_joined_to_most_tables_does_not_merge_two_domains(agent_ns):
    tables, edges, categories = _scope()
    result = _domains_fn(agent_ns)(tables, edges, categories)
    a, b = _home(result, "c.s.a_txn"), _home(result, "c.s.b_txn")
    assert a != b, f"R8.2: the hub merged two unrelated domains: {result['domains']}"
    for p, home in (("a", a), ("b", b)):
        assert {_home(result, f"c.s.{p}_{m}") for m in ("txn", "m1", "m2", "m3", "ref")} == {home}
    assert len(result["domains"]) == 2 and result["skip_domain_step"] is False


def test_hub_is_reattached_as_a_shared_hub_of_both_domains(agent_ns):
    tables, edges, categories = _scope()
    result = _domains_fn(agent_ns)(tables, edges, categories)
    a, b = _home(result, "c.s.a_txn"), _home(result, "c.s.b_txn")
    hubs = {h["table"]: h for h in result["hubs"]}
    assert set(hubs) == {HUB}, result["hubs"]
    assert set(hubs[HUB]["domains"]) == {a, b} and abs(hubs[HUB]["share"] - 10 / 12) < 1e-6, hubs[HUB]
    assert sorted(_roles(result, HUB)) == sorted([(a, "hub"), (b, "hub")])
    for domain in result["domains"]:
        assert HUB in domain["tables"], "R8.2: the hub must be re-attached to every domain it joins"


def test_hubs_are_found_by_structure_never_by_name(agent_ns):
    tables, edges, categories = _scope(extra=[_e("c.s.calendar", "c.s.b_ref")])
    categories["c.s.calendar"] = "REFERENCE"
    result = _domains_fn(agent_ns)(tables, edges, categories)
    assert [h["table"] for h in result["hubs"]] == [HUB], \
        f"R8.2: a hub is a table joined to most of the scope, whatever its name: {result['hubs']}"
    assert _home(result, "c.s.calendar") == _home(result, "c.s.b_txn")


# --- R8.3: shared masters and bridges; one primary domain per transaction table ---

def test_bridge_and_shared_master_belong_to_both_domains(agent_ns):
    tables, edges, categories = _scope()
    result = _domains_fn(agent_ns)(tables, edges, categories)
    a, b = _home(result, "c.s.a_txn"), _home(result, "c.s.b_txn")
    for table in ("c.s.x", "c.s.m_shared"):
        assert _domain_ids(result, table) == {a, b}, f"R8.3: {table} links both domains: {_roles(result, table)}"
    bridges = {br["table"]: set(br["domains"]) for br in result["bridges"]}
    assert bridges.get("c.s.x") == {a, b} and bridges.get("c.s.m_shared") == {a, b}, result["bridges"]
    assert "c.s.b_m1" not in bridges and "c.s.a_m1" not in bridges, result["bridges"]


def test_transaction_table_has_exactly_one_primary_domain_plus_context(agent_ns):
    tables, edges, categories = _scope(extra=[_e("c.s.a_txn", "c.s.b_m3")])
    result = _domains_fn(agent_ns)(tables, edges, categories)
    a, b = _home(result, "c.s.a_m1"), _home(result, "c.s.b_m1")
    for table, cat in categories.items():
        if cat == "TRANSACTIONAL":
            primaries = [d for d, role in _roles(result, table) if role == "primary"]
            assert len(primaries) == 1, f"R8.3: {table} must have one primary domain: {_roles(result, table)}"
    assert (a, "primary") in _roles(result, "c.s.a_txn") and (b, "context") in _roles(result, "c.s.a_txn")
    assert "c.s.a_txn" not in {br["table"] for br in result["bridges"]}


# --- R8.4: challenger pairs over domains that share a hub ---

def test_challenger_pairs_include_the_pair_sharing_the_hub(agent_ns):
    tables, edges, categories = _scope()
    result = _domains_fn(agent_ns)(tables, edges, categories)
    a, b = _home(result, "c.s.a_txn"), _home(result, "c.s.b_txn")
    pairs = [p for p in result["challenger_pairs"] if set(p["domains"]) == {a, b}]
    assert len(pairs) == 1 and HUB in pairs[0]["via"], result["challenger_pairs"]
    assert {"c.s.x", "c.s.m_shared"} <= set(pairs[0]["via"]), pairs


def test_join_group_plan_emits_a_challenger_batch_per_pair(agent_ns):
    tables, edges, categories = _scope()
    fk_graph, columns = {}, {t: [f"{t.split('.')[-1]}_id"] for t in tables}
    for e in edges:
        fk_graph.setdefault(e["left"], []).append((f"{e['right'].split('.')[-1]}_id", e["right"],
                                                   f"{e['right'].split('.')[-1]}_id", "declared"))
        columns[e["left"]].append(f"{e['right'].split('.')[-1]}_id")
    details = [d for t in tables for d in _cols(t, columns[t])]
    tx = [d for d in details if categories.get(".".join(d[:3])) == "TRANSACTIONAL"]
    masters = [d for d in details if categories.get(".".join(d[:3])) != "TRANSACTIONAL"]
    cls = agent_ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = logging.getLogger("a04_domain_graph")
    obj.processing_honesty = {}
    obj._kind_fk_graph = fk_graph
    obj.data_category_map = dict(categories)
    obj.discovery_evidence = {}
    obj.max_parallelism = 2
    plan = obj._join_group_plan(tx, masters, details)
    assert "challenger" in plan, "R8.4: _join_group_plan returns no challenger batches for domain pairs that share a hub"
    batches = [c for c in plan["challenger"] if HUB in c["via"]]
    assert len(batches) == 1 and len(set(batches[0]["domains"])) == 2, plan["challenger"]
    batch = batches[0]
    assert {"c.s.a_txn", "c.s.b_txn"} <= set(batch["primaries"]) and HUB in batch["context"], batch
    assert {".".join(d[:3]) for d in batch["columns"]} == set(batch["primaries"]) | set(batch["context"])
    assert len(obj.table_domains["domains"]) == 2


def _method_source(method_name):
    """The method's text, cut from the notebook cell that defines it (up to the next method at the same indent)."""
    with open(NOTEBOOK, encoding="utf-8") as handle:
        cells = json.load(handle)["cells"]
    head = f"\n    def {method_name}("
    for cell in cells:
        text = "".join(cell.get("source") or [])
        if cell.get("cell_type") == "code" and head in text:
            body = text[text.index(head) + 1:]
            end = re.search(r"\n    (?:def |@)", body[1:])
            return body[:end.start() + 1] if end else body
    raise AssertionError(f"{method_name} not found in the notebook")


def test_generation_batches_send_challenger_batches_down_the_existing_path(agent_ns):
    tree = ast.parse(textwrap.dedent(_method_source("_elect_generation_batches")))
    read = [n for n in ast.walk(tree) if isinstance(n, ast.Constant) and n.value == "challenger"]
    assert read, "R8.4: _elect_generation_batches never generates the challenger batches of the join plan"


# --- adversarial: one coherent group, no edges, determinism, scale ---

def test_one_coherent_group_is_one_domain_with_the_skip_hint(agent_ns):
    tables = ["c.s.f"] + [f"c.s.d{i}" for i in range(8)]
    edges = [_e("c.s.f", f"c.s.d{i}") for i in range(8)] + [_e("c.s.d0", "c.s.d1", "co_join")]
    categories = {"c.s.f": "TRANSACTIONAL", **{f"c.s.d{i}": "MASTER" for i in range(8)}}
    result = _domains_fn(agent_ns)(tables, edges, categories)
    assert len(result["domains"]) == 1 and sorted(result["domains"][0]["tables"]) == sorted(tables), result["domains"]
    assert result["skip_domain_step"] is True and result["hubs"] == [] and result["challenger_pairs"] == []
    assert _roles(result, "c.s.f") == [(result["domains"][0]["id"], "primary")], \
        "R8.2: a transactional table joined to every table is the domain's core, never a hub"


def test_no_edges_gives_no_domain_and_no_challenger(agent_ns):
    tables = ["c.s.p_one", "c.s.p_two", "c.s.p_three", "c.s.p_four"]
    result = _domains_fn(agent_ns)(tables, [], {"c.s.p_one": "TRANSACTIONAL"})
    assert result["domains"] == [] and result["hubs"] == [] and result["bridges"] == [] and result["challenger_pairs"] == []
    assert sorted(result["unattached"]) == sorted(tables) and result["skip_domain_step"] is True


def test_result_is_deterministic_under_input_order(agent_ns):
    tables, edges, categories = _scope(extra=[_e("c.s.a_txn", "c.s.b_m3")])
    first = _domains_fn(agent_ns)(tables, edges, categories)
    rng = random.Random(7)
    for _ in range(3):
        shuffled_edges = [dict(e, left=e["right"], right=e["left"]) if rng.random() < 0.5 else dict(e) for e in edges]
        rng.shuffle(shuffled_edges)
        shuffled_tables = list(tables)
        rng.shuffle(shuffled_tables)
        again = _domains_fn(agent_ns)(shuffled_tables, shuffled_edges, dict(categories))
        assert again["domains"] == first["domains"] and again["challenger_pairs"] == first["challenger_pairs"]


def test_twenty_linked_groups_of_ten_split_into_twenty_domains_fast(agent_ns):
    tables, edges = [], []
    for g in range(20):
        group = [f"c.s.g{g:02d}_t{i}" for i in range(10)]
        tables += group
        edges += [_e(group[i], group[j], "co_join") for i in range(10) for j in range(i + 1, 10)]
        edges.append(_e(group[0], f"c.s.g{(g + 1) % 20:02d}_t1", "lineage"))
    start = time.monotonic()
    result = _domains_fn(agent_ns)(tables, edges, {})
    elapsed = time.monotonic() - start
    assert elapsed < 10, f"200 tables took {elapsed:.1f}s"
    assert len(result["domains"]) == 20 and result["hubs"] == [], [d["tables"][:2] for d in result["domains"]]
    for domain in result["domains"]:
        homes = [t for t in domain["tables"] if (domain["id"], "member") in _roles(result, t)]
        assert len({t.split("_t")[0] for t in homes}) == 1, domain
