"""v1.2.0 SCHEMA-FIX lane: every grounding-sensitive prompt sees every column of every table it
reasons about. The combined value+quality scorer, the Best-of-Best prescreen, the Ultra High elite
judge (and its evidence repair / second opinion) and the Genie SPEC must never drop a column of a
referenced table to save prompt size; per-batch table subsets bound the size instead."""
import os
import sys

from unittest.mock import MagicMock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v120_genie_support import build_inspire as genie_inspire, FakeLoader as GenieLoader, make_uc as genie_uc

WIDE_CAT, WIDE_SCH = "main", "wide"
WIDE_TABLES = [f"{WIDE_CAT}.{WIDE_SCH}.t{t:02d}" for t in range(12)] + [f"{WIDE_CAT}.{WIDE_SCH}.codes"]


def wide_details():
    rows = []
    for t in range(12):
        cols = [("region_label", "string", "")]
        cols += [(f"measure_{i:02d}", "double", "") for i in range(30)]
        cols += [(f"dim_{i:02d}", "string", "") for i in range(10)]
        cols += [("event_ts", "timestamp", "")]
        rows += [(WIDE_CAT, WIDE_SCH, f"t{t:02d}", c, ty, cm) for c, ty, cm in cols]
    codes = [(f"amount_{i:02d}", "double", "") for i in range(25)] + [(f"code_{i:02d}", "string", "") for i in range(10)]
    rows += [(WIDE_CAT, WIDE_SCH, "codes", c, ty, cm) for c, ty, cm in codes]
    return rows


class WideLoader:
    foreign_key_graph = {}

    def get_table_comment(self, *a):
        return ""

    def get_primary_key(self, *a):
        return []

    def get_table_relations(self, *a):
        return []

    def get_sampling_info(self, *a):
        return None


class WideStorage:
    def __init__(self):
        self.saved = {}

    def load_schema_markdown(self, tag="schema_markdown"):
        return self.saved.get(tag)

    def save_schema_markdown(self, markdown, tag="schema_markdown"):
        self.saved[tag] = markdown


def wide_inspire(agent_ns):
    DI = agent_ns["DatabricksInspire"]
    inst = DI.__new__(DI)
    inst.logger = MagicMock()
    inst.data_loader = WideLoader()
    inst.storage_manager = WideStorage()
    return inst


def uc_over(tables):
    return {"No": "U1", "Tables Involved": ", ".join(tables)}


def test_batch_schema_markdown_keeps_every_column_of_referenced_wide_tables(agent_ns):
    inst = wide_inspire(agent_ns)
    details = wide_details()
    full_markdown = inst._build_schema_markdown_for_validation(details)
    md = inst._batch_schema_markdown(details, [uc_over(WIDE_TABLES)], full_markdown)
    assert inst._schema_markdown_missing_columns(md, details, WIDE_TABLES) == []
    assert "| region_label | string |" in md
    for i in range(10):
        assert f"| dim_{i:02d} | string |" in md
        assert f"| code_{i:02d} | string |" in md
    assert "| measure_29 | double |" in md
    assert "| region_label | string |" not in full_markdown
    assert inst._schema_markdown_missing_columns(full_markdown, details, WIDE_TABLES)
    assert len(md) > len(full_markdown)


def test_batch_schema_markdown_excludes_unreferenced_tables(agent_ns):
    inst = wide_inspire(agent_ns)
    details = wide_details()
    full_markdown = inst._build_schema_markdown_for_validation(details)
    referenced = ["main.wide.t00", "main.wide.t01", "main.wide.t02"]
    md = inst._batch_schema_markdown(details, [uc_over(referenced)], full_markdown)
    assert "`main`.`wide`.`t00`" in md and "`main`.`wide`.`t02`" in md
    assert "`main`.`wide`.`t05`" not in md and "`main`.`wide`.`codes`" not in md
    assert inst._schema_markdown_missing_columns(md, details, referenced) == []


def test_batch_schema_markdown_falls_back_only_when_no_table_resolves(agent_ns):
    inst = wide_inspire(agent_ns)
    details = wide_details()
    full_markdown = inst._build_schema_markdown_for_validation(details)
    md = inst._batch_schema_markdown(details, [uc_over(["main.unknown.ghost"])], full_markdown)
    assert md == full_markdown


def test_elite_judge_schema_build_includes_every_column(agent_ns):
    inst = wide_inspire(agent_ns)
    details = wide_details()
    md = inst._grounding_schema_markdown(details, WIDE_TABLES)
    assert inst._schema_markdown_missing_columns(md, details, WIDE_TABLES) == []
    assert "| region_label | string |" in md
    assert inst._grounding_schema_markdown(details, ["main.unknown.ghost"]) is None


def test_superset_gate_fires_and_repairs_truncated_markdown(agent_ns):
    inst = wide_inspire(agent_ns)
    details = wide_details()
    truncated = inst._build_schema_markdown_for_validation(details)
    assert inst._schema_markdown_missing_columns(truncated, details, WIDE_TABLES)
    repaired = inst._enforce_schema_superset(details, WIDE_TABLES, truncated)
    assert repaired is not truncated
    assert inst._schema_markdown_missing_columns(repaired, details, WIDE_TABLES) == []
    assert any("[SCHEMA-SUPERSET FIRED]" in str(c) for c in inst.logger.warning.call_args_list)


def test_superset_gate_does_not_fire_on_a_full_column_markdown(agent_ns):
    inst = wide_inspire(agent_ns)
    details = wide_details()
    good = inst._grounding_schema_markdown(details, WIDE_TABLES)
    inst.logger.warning.reset_mock()
    assert inst._enforce_schema_superset(details, WIDE_TABLES, good) is good
    assert not inst.logger.warning.call_args_list


def test_rendered_columns_parser_and_missing_detector(agent_ns):
    inst = wide_inspire(agent_ns)
    details = wide_details()
    md = inst._build_schema_markdown_for_validation(details, tables=["main.wide.codes"])
    rendered = inst._schema_markdown_rendered_columns(md)
    assert rendered["main.wide.codes"] == {c[3] for c in details if c[2] == "codes"}
    assert inst._schema_markdown_missing_columns(md, details, ["main.wide.codes"]) == []
    broken = "\n".join(line for line in md.splitlines() if not line.startswith("| code_09 |"))
    assert inst._schema_markdown_missing_columns(broken, details, ["main.wide.codes"]) == ["main.wide.codes.code_09"]


def test_genie_spec_includes_trailing_string_codes_on_wide_table(agent_ns):
    cols = [(f"amount_{i:02d}", "DOUBLE", "") for i in range(25)] + [(f"code_{i:02d}", "STRING", "") for i in range(10)]
    inst = genie_inspire(agent_ns, loader=GenieLoader(tables={"main.wide.codes": cols}, relations={}))
    uc = genie_uc(**{"Tables Involved": "main.wide.codes", "Primary Table": "main.wide.codes"})
    schema = inst._compute_per_uc_genie_fields(uc, [], None)["directly_involved_schema"]
    for i in range(10):
        assert f"| code_{i:02d} | STRING |" in schema
    for i in range(25):
        assert f"| amount_{i:02d} | DOUBLE |" in schema
    assert "more columns not shown" not in schema


def test_no_grounding_sensitive_path_truncates_columns(agent_ns):
    from _agentload import agent_source
    src = agent_source()
    assert "_GENIE_SCHEMA_MAX_COLUMNS" not in src
    assert src.count("max_columns=") == 1
    assert "ordered, max_columns=30, max_column_comment=50, max_table_comment=200" in src
    assert "md = self._grounding_schema_markdown(full_schema_details, self._uc_batch_tables(uc_batch))" in src
    assert "self._grounding_schema_markdown(schema_details, self._uc_batch_tables(uc_batch))" in src
    assert "directly_involved_schema = self._enforce_schema_superset(" in src
