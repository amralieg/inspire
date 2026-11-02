import json
import logging
import os
import subprocess
import sys
import types

TESTS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TABLES = [("c", "s", "a"), ("c", "s", "b"), ("c", "s", "c"), ("c", "s", "d")]
RELATIONS = {
    ("c", "s", "b"): [("c", "s", "b", "a_id", "c", "s", "a", "id"), ("c", "s", "b", "d_id", "c", "s", "d", "id")],
    ("c", "s", "c"): [("c", "s", "c", "a_id", "c", "s", "a", "id"), ("c", "s", "c", "d_id", "c", "s", "d", "id")],
}
ROWS = [("c", "s", "a", "id", "BIGINT", ""),
        ("c", "s", "b", "id", "BIGINT", ""), ("c", "s", "b", "a_id", "BIGINT", ""), ("c", "s", "b", "d_id", "BIGINT", ""),
        ("c", "s", "c", "id", "BIGINT", ""), ("c", "s", "c", "a_id", "BIGINT", ""), ("c", "s", "c", "d_id", "BIGINT", ""),
        ("c", "s", "d", "id", "BIGINT", "")]
VIA_B = ["c.s.b.a_id -> c.s.a.id", "c.s.b.d_id -> c.s.d.id"]


def _loader(ns):
    dl = ns["DataLoader"]("", "", "", logging.getLogger("v161_join_order"), enable_two_pass=False,
                          enable_column_sampling=False)
    for source, rels in RELATIONS.items():
        dl.foreign_key_graph[source] = list(rels)
    dl._constraints_loaded.update(dl._lkey(*t) for t in TABLES)
    dl.all_table_tuples = sorted(TABLES)
    return dl


def _inspire(ns, loader):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = logging.getLogger("v161_join_order")
    obj.data_loader = loader
    obj.storage_manager = types.SimpleNamespace(load_schema_details=lambda name="all_columns_for_sql": list(ROWS))
    return obj


def test_foreign_key_relations_do_not_depend_on_the_table_iteration_order(agent_ns):
    dl = _loader(agent_ns)
    forward = dl.get_foreign_key_relations(list(TABLES))
    backward = dl.get_foreign_key_relations(list(reversed(TABLES)))
    assert forward == backward == RELATIONS[("c", "s", "b")] + RELATIONS[("c", "s", "c")]


def _diamond(first, second):
    edges = {"b": "c.s.b.a_id -> c.s.a.id", "c": "c.s.c.a_id -> c.s.a.id"}
    down = {"b": "c.s.b.d_id -> c.s.d.id", "c": "c.s.c.d_id -> c.s.d.id"}
    adjacency = {"c.s.a": [(f"c.s.{first}", edges[first]), (f"c.s.{second}", edges[second])],
                 "c.s.b": [("c.s.a", edges["b"]), ("c.s.d", down["b"])],
                 "c.s.c": [("c.s.a", edges["c"]), ("c.s.d", down["c"])],
                 "c.s.d": [(f"c.s.{first}", down[first]), (f"c.s.{second}", down[second])]}
    return {"fk": {"declared": adjacency, "inferred": {}}, "shared": {}, "shared_by_table": {},
            "allowed": {"c.s.a", "c.s.b", "c.s.c", "c.s.d"}}


def test_join_path_search_breaks_ties_by_a_stable_key(agent_ns):
    bfs = agent_ns["DatabricksInspire"]._join_path_bfs
    assert bfs(_diamond("b", "c"), ["c.s.a", "c.s.d"], "declared") == VIA_B
    assert bfs(_diamond("c", "b"), ["c.s.a", "c.s.d"], "declared") == VIA_B


def test_find_join_path_picks_the_same_tie_when_relations_arrive_in_another_order(agent_ns):
    dl = _loader(agent_ns)
    dl.get_foreign_key_relations = lambda tables: RELATIONS[("c", "s", "c")] + RELATIONS[("c", "s", "b")]
    out = _inspire(agent_ns, dl)._find_join_path(["c.s.a", "c.s.d"])
    assert out == {"connected": True, "path": VIA_B, "strength": "declared"}


SCRIPT = """
import json, logging, sys, types
sys.path.insert(0, {tests!r})
import _agentload
sys.path.insert(0, {unit!r})
import v161_join_path_order_test as t
ns = _agentload.load_agent_namespace()
print("RESULT:" + json.dumps(t._inspire(ns, t._loader(ns))._find_join_path(["c.s.a", "c.s.d"])))
"""


def _run_with_hash_seed(seed):
    env = dict(os.environ, PYTHONHASHSEED=str(seed))
    script = SCRIPT.format(tests=TESTS_DIR, unit=os.path.dirname(os.path.abspath(__file__)))
    return subprocess.Popen([sys.executable, "-c", script], cwd=TESTS_DIR, env=env, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True)


def test_find_join_path_is_the_same_under_different_hash_seeds():
    procs = {seed: _run_with_hash_seed(seed) for seed in (0, 2)}
    results = {}
    for seed, proc in procs.items():
        out, err = proc.communicate(timeout=600)
        assert proc.returncode == 0, err[-2000:]
        line = next(l for l in out.splitlines() if l.startswith("RESULT:"))
        results[seed] = json.loads(line[len("RESULT:"):])
    assert results[0] == results[2] == {"connected": True, "path": VIA_B, "strength": "declared"}
