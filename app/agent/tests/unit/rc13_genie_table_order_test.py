"""REQ-147: the Genie export rejects data_sources.tables that are not sorted by identifier ("Invalid export proto:
data_sources.tables must be sorted by identifier"). A Data Filter renames a base table to its scope view, which can
move it past a table that sorted after the base name, so the Genie Agent of the rehearsal build failed three rounds.
Every writer that renames, appends or posts a Genie space must leave the tables sorted."""
import json

from v263_table_scope_test import SCOPE_JSON, _RecordingSpark, viewed  # noqa: F401  (viewed is a fixture)


def _identifiers(space):
    return [t["identifier"] for t in space["data_sources"]["tables"]]


def test_a_scope_rename_that_moves_a_table_keeps_the_genie_tables_sorted(viewed):
    # main.insp.z sorts after the scope view main.insp.main_s_orders__scope, so the rename breaks the order
    space = {"data_sources": {"tables": [{"identifier": "main.insp.z"}, {"identifier": "main.s.orders"}]}}
    assert _identifiers(space) == sorted(_identifiers(space))
    rewritten = viewed["scope_genie_space"](space, _RecordingSpark())
    assert _identifiers(rewritten) == ["main.insp.main_s_orders__scope", "main.insp.z"]
    assert _identifiers(rewritten) == sorted(_identifiers(rewritten))


def test_the_genie_sorter_orders_tables_and_keeps_non_table_entries_out_of_the_way(agent_ns):
    space = {"data_sources": {"tables": [{"identifier": "main.s.b"}, {"identifier": "main.s.a"}], "metric_views": []}}
    assert agent_ns["genie_sorted_tables"](space)["data_sources"]["tables"] == [{"identifier": "main.s.a"}, {"identifier": "main.s.b"}]
    assert agent_ns["genie_sorted_tables"]({"instructions": {}}) == {"instructions": {}}
    assert agent_ns["genie_sorted_tables"]({"data_sources": {"tables": [{"identifier": "main.s.z"}, "junk"]}})["data_sources"]["tables"][0] == "junk"


def test_a_serialized_space_posted_to_genie_is_sorted_on_the_way_out(agent_ns):
    body = json.dumps({"data_sources": {"tables": [{"identifier": "main.s.b"}, {"identifier": "main.s.a"}]}})
    out = json.loads(agent_ns["implement_sorted_serialized_space"](body))
    assert [t["identifier"] for t in out["data_sources"]["tables"]] == ["main.s.a", "main.s.b"]
    assert agent_ns["implement_sorted_serialized_space"]("not json") == "not json"
