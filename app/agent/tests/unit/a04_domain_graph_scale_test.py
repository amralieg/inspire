"""REQ-573 R8.4 + R15 (lane a04_domain_graph, review of c2dae9bb7): the challenger stays bounded and detection scales.

- A universal hub touches every domain, so "every pair that shares a hub" is n*(n-1)/2 pairs: 100 domains gave 4,950 challenger
  generation batches (one LLM call each). The challenger keeps at most INSPIRE_DOMAIN_MAX_CHALLENGERS pairs, ranked so a pair
  that shares a bridge table (a specific cross-domain signal) beats a pair that only shares a universal hub; every other pair is
  recorded in `challenger_dropped` with reason "challenger_cap" (no silent miss, R11).
- Detection on 10,000 tables (one connected scope) took about a minute with the O(V*E) agglomeration scan; it must finish in
  seconds on the driver.
Synthetic, generic metadata only (c.s.g###_t##)."""
import itertools
import random
import time

WEIGHTS = {"fk": 1.0, "co_join": 0.8, "lineage": 0.6, "name": 0.4}
HUB = "c.s.zz_hub"


def _e(a, b, source="fk"):
    return {"left": a, "right": b, "source": source, "weight": WEIGHTS[source]}


def _hub_scope(groups=40, size=6, bridge=(5, 17)):
    """`groups` tight groups (a clique of co-joins each), one universal hub joined to every table, and one bridge table with
    one name-matched link into each of the `bridge` groups."""
    tables, edges = [], []
    for g in range(groups):
        group = [f"c.s.g{g:03d}_t{i:02d}" for i in range(size)]
        tables += group
        edges += [_e(a, b, "co_join") for a, b in itertools.combinations(group, 2)]
    edges += [_e(HUB, t) for t in tables]
    if bridge:
        for g in bridge:
            edges.append(_e("c.s.g_bridge", f"c.s.g{g:03d}_t00", "name"))
        tables.append("c.s.g_bridge")
    return tables + [HUB], edges


def _home(result, table):
    homes = [m["domain"] for m in result["memberships"].get(table, []) if m["role"] in ("primary", "member")]
    assert len(homes) == 1, result["memberships"].get(table)
    return homes[0]


def test_a_universal_hub_never_turns_into_one_challenger_batch_per_domain_pair(agent_ns):
    cap = agent_ns.get("INSPIRE_DOMAIN_MAX_CHALLENGERS")
    assert isinstance(cap, int) and 1 <= cap <= 20, "R8.4: the notebook defines no INSPIRE_DOMAIN_MAX_CHALLENGERS (1-20)"
    tables, edges = _hub_scope()
    result = agent_ns["inspire_table_domains"](tables, edges, {})
    assert len(result["domains"]) == 40 and [h["table"] for h in result["hubs"]] == [HUB], len(result["domains"])
    kept, dropped = result["challenger_pairs"], result.get("challenger_dropped")
    assert len(kept) <= cap, f"R8.4: {len(kept)} challenger pairs, each one an LLM generation batch; the cap is {cap}"
    assert isinstance(dropped, list) and len(kept) + len(dropped) == 40 * 39 // 2, "every pair is kept or recorded as dropped"
    assert all(d.get("reason") == "challenger_cap" and len(d.get("domains") or []) == 2 and d.get("via") for d in dropped), dropped[:2]
    assert not {tuple(p["domains"]) for p in kept} & {tuple(d["domains"]) for d in dropped}


def test_a_pair_sharing_a_bridge_table_is_kept_before_pairs_sharing_only_the_hub(agent_ns):
    tables, edges = _hub_scope()
    result = agent_ns["inspire_table_domains"](tables, edges, {})
    pair = {_home(result, "c.s.g005_t00"), _home(result, "c.s.g017_t00")}
    assert len(pair) == 2
    assert result["challenger_pairs"] and set(result["challenger_pairs"][0]["domains"]) == pair, \
        f"R8.4: the bridge pair {sorted(pair)} must rank first: {result['challenger_pairs'][:3]}"
    assert "c.s.g_bridge" in result["challenger_pairs"][0]["via"]


def test_must_keep_a_small_scope_keeps_every_challenger_pair_and_drops_none(agent_ns):
    tables, edges = _hub_scope(groups=4, size=6, bridge=None)
    result = agent_ns["inspire_table_domains"](tables, edges, {})
    assert len(result["domains"]) == 4 and len(result["challenger_pairs"]) == 6 and result.get("challenger_dropped") == []


def test_the_join_plan_sends_at_most_the_cap_of_challenger_batches(agent_ns):
    cap = agent_ns.get("INSPIRE_DOMAIN_MAX_CHALLENGERS")
    assert isinstance(cap, int), "R8.4: no INSPIRE_DOMAIN_MAX_CHALLENGERS"
    tables, edges = _hub_scope()
    cls = agent_ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    import logging
    obj.logger = logging.getLogger("a04_domain_graph_scale")
    obj._kind_fk_graph = {}
    obj.data_category_map = {}
    obj.discovery_evidence = {"history_joins": [{"left": f"{e['left']}.k", "right": f"{e['right']}.k"} for e in edges]}
    columns = {t: [tuple(t.split(".")) + ("k", "bigint", "")] for t in tables}
    batches = obj._challenger_batches(tables, columns, 10_000, 8)
    assert 1 <= len(batches) <= cap, f"R8.4: {len(batches)} challenger batches for a scope with one universal hub"


def test_ten_thousand_tables_in_one_connected_scope_are_grouped_in_seconds(agent_ns):
    rnd, tables, edges = random.Random(1), [], []
    for g in range(400):
        group = [f"c.s.g{g:03d}_t{i:02d}" for i in range(25)]
        tables += group
        edges += [_e(group[i], group[rnd.randrange(i)]) for i in range(1, 25)]
        edges += [_e(*rnd.sample(group, 2), "name") for _ in range(10)]
    edges += [_e(f"c.s.g{g:03d}_t00", f"c.s.g{g + 1:03d}_t00", "lineage") for g in range(399)]
    start = time.monotonic()
    first = agent_ns["inspire_table_domains"](tables, edges, {})
    elapsed = time.monotonic() - start
    assert elapsed < 20, f"R15: 10,000 tables took {elapsed:.1f}s to group into domains"
    assert len(first["domains"]) >= 2 and sum(len(d["home"]) for d in first["domains"]) == len(tables)
    rnd.shuffle(edges)
    assert agent_ns["inspire_table_domains"](list(reversed(tables)), edges, {})["domains"] == first["domains"]
