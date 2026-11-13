"""REQ-148 (on REQ-147 chokepoint): every Genie space the agent sends is in the order the Genie API demands (id-keyed arrays by id, data_sources.tables
and metric_views by identifier, column_configs by column_name), whatever a model round or a Data Filters scope rewrite did
to the order before the send. Offline: the REST client is a recording fake."""
import copy
import json
import types

import pytest

from rc14_space_sql_scope_test import TABLE, _scopes
from v120_artifacts_support import FakeSpark, make_inspire

KEY = (4242, "N01-U02", 1)
ORDERS, CUSTOMERS = "main.s.orders", "main.s.customers"


def _ids(*letters):
    return [letter * 32 for letter in letters]


def _unsorted_space():
    a, b, c, d = _ids("a", "b", "c", "d")
    return {
        "version": 2,
        "config": {"sample_questions": [{"id": c, "question": ["Third?"]}, {"id": a, "question": ["First?"]}]},
        "data_sources": {
            "tables": [
                {"identifier": "main.z.last", "column_configs": [{"column_name": "y"}, {"column_name": "b"}]},
                {"identifier": "main.a.first"},
            ],
            "metric_views": [{"identifier": "main.m.views_z"}, {"identifier": "main.m.views_a"}],
        },
        "instructions": {
            "text_instructions": [{"id": b, "content": ["Rules."]}],
            "example_question_sqls": [{"id": d, "question": ["Two?"], "sql": ["SELECT 2"]},
                                      {"id": a, "question": ["One?"], "sql": ["SELECT 1"]}],
            "join_specs": [{"id": d, "sql": ["x"]}, {"id": a, "sql": ["y"]}],
            "sql_snippets": {"measures": [{"id": d, "sql": ["SUM(x)"]}, {"id": a, "sql": ["COUNT(x)"]}],
                             "filters": [{"id": c, "sql": ["f = 1"]}, {"id": b, "sql": ["g = 1"]}]},
        },
        "benchmarks": {"questions": [{"id": d, "question": ["Gold 2?"]}, {"id": a, "question": ["Gold 1?"]}]},
    }


def _sorted_space():
    space = _unsorted_space()
    space["config"]["sample_questions"].sort(key=lambda q: q["id"])
    space["data_sources"]["tables"] = [{"identifier": "main.a.first"},
                                       {"identifier": "main.z.last", "column_configs": [{"column_name": "b"},
                                                                                       {"column_name": "y"}]}]
    space["data_sources"]["metric_views"].sort(key=lambda m: m["identifier"])
    space["instructions"]["example_question_sqls"].sort(key=lambda q: q["id"])
    space["instructions"]["join_specs"].sort(key=lambda q: q["id"])
    space["instructions"]["sql_snippets"]["measures"].sort(key=lambda q: q["id"])
    space["instructions"]["sql_snippets"]["filters"].sort(key=lambda q: q["id"])
    space["benchmarks"]["questions"].sort(key=lambda q: q["id"])
    return space


class _Client:
    """Records every REST call the agent makes; answers each with an empty body."""

    def __init__(self):
        self.calls = []

    def do(self, method, path, body=None, query=None):
        self.calls.append((method, path, body))
        return {"space_id": "g1"}


@pytest.fixture
def sent(agent_ns):
    client = _Client()
    inst = make_inspire(agent_ns)
    inst.w_client = types.SimpleNamespace(api_client=client)
    inst.calls = client.calls
    return inst


def _space_sent(call):
    return json.loads(call[2]["serialized_space"])


def test_the_order_function_sorts_every_array_the_genie_api_requires(agent_ns):
    space = _unsorted_space()
    agent_ns["genie_sorted_tables"](space)
    assert space == _sorted_space(), "every id-keyed array sorted by id, tables and metric views by identifier, column configs by name"


def test_a_space_already_in_api_order_comes_back_unchanged(agent_ns):
    space = _sorted_space()
    agent_ns["genie_sorted_tables"](space)
    assert space == _sorted_space(), "applying the order to a sorted space changes nothing"


def test_a_space_renamed_by_the_data_filters_scope_is_sent_with_its_tables_in_identifier_order(agent_ns, sent):
    agent_ns["INSPIRE_TABLE_SCOPES"].clear()
    try:
        scopes = _scopes(agent_ns)
        space = {"data_sources": {"tables": [{"identifier": CUSTOMERS}, {"identifier": TABLE}]},
                 "config": {"sample_questions": []}, "instructions": {}, "benchmarks": {"questions": []}}
        normalized = agent_ns["normalize_genie_space"](json.dumps(dict(space, title="Orders")), [CUSTOMERS, TABLE])[2]
        scoped = agent_ns["scope_genie_space"](normalized, FakeSpark(), scopes)
        identifiers = [t["identifier"] for t in scoped["data_sources"]["tables"]]
        assert TABLE not in identifiers, "the Data Filters scope renamed the orders table to its view"
        assert identifiers == sorted(identifiers), "the scope rewrite leaves the tables sorted by identifier"
        sent._implement_api("POST", "/api/2.0/genie/spaces", {"title": "Orders", "warehouse_id": "wh1",
                                                              "serialized_space": json.dumps(scoped), "parent_path": "/W"})
    finally:
        agent_ns["INSPIRE_TABLE_SCOPES"].clear()
    listed = [t["identifier"] for t in _space_sent(sent.calls[0])["data_sources"]["tables"]]
    assert listed == sorted(listed), "the space the agent sends lists its tables sorted by identifier"


@pytest.mark.parametrize("site", ["create", "patch", "restore"])
def test_every_genie_space_send_site_sends_the_space_in_api_order(agent_ns, sent, site):
    unsorted = json.dumps(_unsorted_space())
    if site == "create":
        sent._implement_api("POST", "/api/2.0/genie/spaces", {"title": "N01-U02", "warehouse_id": "wh1", "serialized_space": unsorted,
                                                              "parent_path": "/W"})
    elif site == "patch":
        sent._implement_patch_asset("genie_space", "g1", {"serialized_space": unsorted}, joined=True, key=KEY)
    else:
        sent._implement_restore_asset("genie_space", "g1", {"body": {"serialized_space": unsorted}})
    method, path, _body = sent.calls[0]
    assert (method, path.startswith("/api/2.0/genie/spaces")) in (("POST", True), ("PATCH", True))
    assert _space_sent(sent.calls[0]) == _sorted_space()


def test_a_send_that_carries_no_genie_space_is_not_touched(agent_ns, sent):
    sent._implement_api("PATCH", "/api/2.0/alerts/a1", {"custom_description": "x"})
    assert sent.calls[0][2] == {"custom_description": "x"}
