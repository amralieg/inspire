"""c38_joins (REQ-584, contract U9 in ~/claude/inspire/briefs/c35_ui_interface.md): the wizard suggests joins by name and the person
can remove one. A removed suggestion arrives in 18_table_relationships with the same {from, to} shape plus "removed": true
("removed": false is never sent). A removed entry means "do not use this join": it is never read as a join, and the notebook's own
name inference and declared keys never put that exact join (child table+column -> parent table+column, case-insensitive) back into
foreign_key_graph. Entries with no "removed" key keep today's REQ-373 behaviour.

API fixed by these tests:
* parse_person_relationships(text) returns only the joins to use (removed entries skipped).
* parse_person_removed_relationships(text) returns the removed joins as 8-tuples, same shape as parse_person_relationships.
* DataLoader.set_person_relationships(joins, removed=()) stores both; _apply_person_relationships and merge_inferred_foreign_keys
  drop/skip the removed joins.
"""
import json
import os
import threading
from collections import defaultdict

from v120_artifacts_support import CapturingLogger

CHILD = ("main", "sales", "orders")
PARENT = ("main", "sales", "customers")
OTHER = ("main", "sales", "regions")
REMOVED = (*CHILD, "customer_id", *PARENT, "customer_id")
KEPT = (*CHILD, "region_id", *OTHER, "region_id")


def _join(child, column, parent, parent_column, removed=None):
    entry = {"from": {"table": ".".join(child), "column": column}, "to": {"table": ".".join(parent), "column": parent_column}}
    if removed is not None:
        entry["removed"] = removed
    return entry


def _loader(ns, entries=()):
    cls = ns["DataLoader"]
    dl = cls.__new__(cls)
    dl.logger = CapturingLogger()
    dl._metadata_lock = threading.RLock()
    dl.foreign_key_graph = defaultdict(list)
    dl._inferred_fk = {}
    dl._person_relations = []
    dl._person_fk = set()
    dl._join_inferred_schemas = set()
    text = json.dumps(list(entries))
    dl.set_person_relationships(ns["parse_person_relationships"](text), ns["parse_person_removed_relationships"](text))
    return dl


def test_1_a_removed_entry_is_never_read_as_a_join_to_use(agent_ns):
    text = json.dumps([_join(CHILD, "customer_id", PARENT, "customer_id", removed=True), _join(CHILD, "region_id", OTHER, "region_id")])
    assert agent_ns["parse_person_relationships"](text) == [KEPT]
    assert agent_ns["parse_person_removed_relationships"](text) == [REMOVED]


def test_2_removed_parse_skips_what_is_not_a_removed_join(agent_ns):
    parse = agent_ns["parse_person_removed_relationships"]
    text = json.dumps([_join(CHILD, "customer_id", PARENT, "customer_id"), _join(CHILD, "a", PARENT, "b", removed="yes"),
                       {"from": {"table": "orders", "column": "x"}, "to": {"table": "main.sales.customers", "column": "id"}, "removed": True},
                       _join(CHILD, "customer_id", PARENT, "customer_id", removed=True),
                       _join(CHILD, "customer_id", PARENT, "customer_id", removed=True)])
    assert parse(text) == [REMOVED], "only real joins with removed exactly true, once"
    assert parse("") == [] and parse("{nope") == [] and parse('{"from": 1}') == []


def test_3_a_removed_join_is_not_name_inferred_back_and_a_kept_one_is(agent_ns):
    dl = _loader(agent_ns, [_join(CHILD, "customer_id", PARENT, "customer_id", removed=True)])
    dl._infer_foreign_keys = lambda details: {CHILD: [(REMOVED, 0.9), (KEPT, 0.8)]}
    added = dl.merge_inferred_foreign_keys([])
    assert REMOVED not in dl.foreign_key_graph[CHILD]
    assert KEPT in dl.foreign_key_graph[CHILD]
    assert added == 1


def test_4_the_removed_match_is_case_insensitive(agent_ns):
    dl = _loader(agent_ns, [_join(("Main", "Sales", "Orders"), "Customer_ID", ("MAIN", "sales", "Customers"), "CUSTOMER_ID", removed=True)])
    dl._infer_foreign_keys = lambda details: {CHILD: [(REMOVED, 0.9)]}
    assert dl.merge_inferred_foreign_keys([]) == 0
    assert REMOVED not in dl.foreign_key_graph[CHILD]


def test_5_a_removed_declared_key_is_dropped_and_stays_dropped_after_a_constraint_load(agent_ns):
    dl = _loader(agent_ns, [_join(CHILD, "customer_id", PARENT, "customer_id", removed=True)])
    dl.foreign_key_graph[CHILD] = [REMOVED, KEPT]  # _load_constraints rewrites the list from information_schema
    dl._apply_person_relationships()
    assert dl.foreign_key_graph[CHILD] == [KEPT]
    dl.foreign_key_graph[CHILD] = [REMOVED, KEPT]
    dl._apply_person_relationships()
    assert dl.foreign_key_graph[CHILD] == [KEPT]


def test_6_only_the_removed_column_join_goes_another_join_on_the_same_pair_stays(agent_ns):
    other_column = (*CHILD, "billing_customer_id", *PARENT, "customer_id")
    dl = _loader(agent_ns, [_join(CHILD, "customer_id", PARENT, "customer_id", removed=True)])
    dl._infer_foreign_keys = lambda details: {CHILD: [(other_column, 0.9), (REMOVED, 0.8)]}
    dl.merge_inferred_foreign_keys([])
    assert other_column in dl.foreign_key_graph[CHILD] and REMOVED not in dl.foreign_key_graph[CHILD]


def test_7_without_removed_entries_the_graph_is_as_today(agent_ns):
    plain = [_join(CHILD, "customer_id", PARENT, "customer_id")]
    dl = _loader(agent_ns, plain)
    dl.foreign_key_graph[CHILD] = [(*CHILD, "cust_ref", *PARENT, "id"), KEPT]
    dl._apply_person_relationships()
    assert dl.foreign_key_graph[CHILD] == [KEPT, REMOVED], "REQ-373: the person join replaces the declared key on its pair"
    assert agent_ns["parse_person_removed_relationships"](json.dumps(plain)) == []


def test_8_the_run_passes_the_removed_joins_to_the_loader(agent_ns):
    notebook = os.path.join(os.path.dirname(__file__), "..", "..", "agent", "dbx_inspire_ai_agent.ipynb")
    source = "".join("".join(cell.get("source", [])) for cell in json.load(open(notebook))["cells"])
    calls = [line for line in source.splitlines() if "set_person_relationships(" in line and "def " not in line]
    assert calls, "the run must hand the person's joins to the DataLoader"
    assert all("parse_person_removed_relationships(" in line for line in calls), calls


def test_9_graph_joins_spelled_in_mixed_case_are_still_removed(agent_ns):
    """Declared keys and name-inferred joins keep the case information_schema returns; the removed joins are stored lower-cased."""
    mixed = ("Main", "Sales", "Orders", "Customer_ID", "Main", "Sales", "Customers", "CUSTOMER_ID")
    dl = _loader(agent_ns, [_join(CHILD, "customer_id", PARENT, "customer_id", removed=True)])
    dl._infer_foreign_keys = lambda details: {mixed[:3]: [(mixed, 0.9)]}
    assert dl.merge_inferred_foreign_keys([]) == 0
    assert mixed not in dl.foreign_key_graph[mixed[:3]]
    dl.foreign_key_graph[mixed[:3]] = [mixed, KEPT]
    dl._apply_person_relationships()
    assert dl.foreign_key_graph[mixed[:3]] == [KEPT]
