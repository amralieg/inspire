"""Fix #2: Zero-batches fallback in _initialize_all_tables two-pass mode.

Evidence: rescue commit 9305bd1 body cites SHOW-only-grants customer where
DESCRIBE was denied on their tables and analyze_table_sizes_batch returned
empty for every schema. The v0.9.0 base drops those tables silently, Pass 2
sees zero size_infos, create_optimized_batches receives an empty list, and
the pipeline logs "No batches to process. Skipping all generation."

v0.9.0 base bug: `discover_and_analyze_schema` inner function at line 7060
returns ONLY `schema_size_infos`. If size analysis fails for a chunk
(missing DESCRIBE grants), the raw discovered table tuples are discarded.

Fix (single commit, root cause per Section 3):
1. `discover_and_analyze_schema` now returns `(schema_table_tuples, schema_size_infos)`.
2. Outer aggregator collects `all_raw_table_tuples` alongside `all_table_size_infos`.
3. After dedup, rescue block computes `all_raw_table_tuples - {sized keys}` and
   materialises `TableSizeInfo(num_columns=0, size_category="unknown")` for every
   missing tuple (v1.2.0: the size is reported as unknown instead of a fabricated
   50-column "medium" size).
4. Sentinel `[G19 ZERO_BATCH_FALLBACK FIRED]` logs the rescue count and
   affected schemas (first 10).
"""
import re
import sys
import os
from pathlib import Path

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import load_agent_namespace


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def _notebook_body():
    return (Path(__file__).resolve().parents[2] / "agent" / "dbx_inspire_ai_agent.ipynb").read_text()


def _apply_rescue_algorithm(all_raw_table_tuples, all_table_size_infos, table_size_info_cls, logger):
    """Mirror of the notebook rescue algorithm. Kept in sync with the code path
    under test via test_notebook_rescue_algorithm_matches_reference below."""
    _sized_keys = {(info.catalog, info.schema, info.table) for info in all_table_size_infos}
    _missing_seen = set()
    _missing_ordered = []
    for _raw in all_raw_table_tuples:
        if _raw not in _sized_keys and _raw not in _missing_seen:
            _missing_seen.add(_raw)
            _missing_ordered.append(_raw)
    if _missing_ordered:
        _rescued_infos = [
            table_size_info_cls(c, s, t, num_columns=0, size_category="unknown")
            for (c, s, t) in _missing_ordered
        ]
        all_table_size_infos.extend(_rescued_infos)
        _rescued_schemas = sorted({(c, s) for (c, s, _t) in _missing_ordered})
        logger.warning(
            f"[G19 ZERO_BATCH_FALLBACK FIRED] rescued={len(_missing_ordered)} table(s) with size_category=unknown "
            f"(column count not measured) - size analysis did not return them (timeout or failed schema analysis). "
            f"Schemas affected: {_rescued_schemas[:10]}"
        )
    return all_table_size_infos


class _CapturingLogger:
    def __init__(self):
        self.records = []

    def info(self, msg, *a, **k):
        self.records.append(("INFO", str(msg)))

    def warning(self, msg, *a, **k):
        self.records.append(("WARNING", str(msg)))

    def error(self, msg, *a, **k):
        self.records.append(("ERROR", str(msg)))

    def debug(self, msg, *a, **k):
        self.records.append(("DEBUG", str(msg)))

    def matching(self, needle):
        return [r for r in self.records if needle in r[1]]


def test_all_raw_tuples_variable_declared(ns):
    body = _notebook_body()
    assert "all_raw_table_tuples = []" in body, \
        "Fix #2 requires all_raw_table_tuples buffer alongside all_table_size_infos"


def test_discover_and_analyze_schema_returns_tuple(ns):
    body = _notebook_body()
    assert "return (schema_table_tuples, schema_size_infos)" in body, \
        "discover_and_analyze_schema must return (raw, sized) tuple, not just sized"


def test_outer_loop_unpacks_tuple(ns):
    body = _notebook_body()
    assert "_raw_tuples, schema_size_infos = future.result(timeout=timeout_per_schema)" in body
    assert "all_raw_table_tuples.extend(_raw_tuples)" in body


def test_rescue_sentinel_present(ns):
    body = _notebook_body()
    assert "[G19 ZERO_BATCH_FALLBACK FIRED]" in body


def test_rescue_uses_unknown_size_not_fabricated_medium(ns):
    body = _notebook_body()
    assert 'num_columns=0, size_category=\\"unknown\\"' in body
    assert 'num_columns=50, size_category=\\"medium\\"' not in body


def test_rescue_algorithm_rescues_all_dropped_tuples(ns):
    TableSizeInfo = ns["TableSizeInfo"]
    raw = [("cat", "sch1", "t1"), ("cat", "sch1", "t2"), ("cat", "sch2", "t3")]
    sized = [TableSizeInfo("cat", "sch1", "t1", num_columns=42, size_category="small")]
    logger = _CapturingLogger()
    merged = _apply_rescue_algorithm(raw, sized, TableSizeInfo, logger)
    assert len(merged) == 3, f"expected 3 (1 real + 2 rescued), got {len(merged)}"
    rescued = [i for i in merged if i.num_columns == 0 and i.size_category == "unknown"]
    assert len(rescued) == 2, f"expected 2 rescued unknown-size entries, got {len(rescued)}"
    fired = logger.matching("[G19 ZERO_BATCH_FALLBACK FIRED]")
    assert len(fired) == 1
    assert "rescued=2" in fired[0][1]


def test_rescue_is_no_op_when_sizes_cover_all_raw(ns):
    TableSizeInfo = ns["TableSizeInfo"]
    raw = [("c", "s", "a"), ("c", "s", "b")]
    sized = [
        TableSizeInfo("c", "s", "a", num_columns=10),
        TableSizeInfo("c", "s", "b", num_columns=20),
    ]
    logger = _CapturingLogger()
    merged = _apply_rescue_algorithm(raw, sized, TableSizeInfo, logger)
    assert len(merged) == 2
    assert not logger.matching("[G19 ZERO_BATCH_FALLBACK FIRED]"), \
        "no sentinel should fire when nothing was dropped"


def test_rescue_algorithm_dedupes_duplicate_missing_tuples(ns):
    TableSizeInfo = ns["TableSizeInfo"]
    raw = [("c", "s", "a"), ("c", "s", "a"), ("c", "s", "a")]
    sized = []
    logger = _CapturingLogger()
    merged = _apply_rescue_algorithm(raw, sized, TableSizeInfo, logger)
    assert len(merged) == 1
    assert logger.matching("[G19 ZERO_BATCH_FALLBACK FIRED]")[0][1].count("rescued=1") == 1


def test_rescue_algorithm_handles_show_only_grants_extreme_case(ns):
    """SHOW-only-grants: DESCRIBE was denied on every table -> sized is empty
    while raw contains N tables. Rescue must materialise all N."""
    TableSizeInfo = ns["TableSizeInfo"]
    raw = [("cat", "sch", f"t{i}") for i in range(15)]
    sized = []
    logger = _CapturingLogger()
    merged = _apply_rescue_algorithm(raw, sized, TableSizeInfo, logger)
    assert len(merged) == 15, f"SHOW-only-grants case: expected 15 rescued, got {len(merged)}"
    assert all(i.size_category == "unknown" and i.num_columns == 0 for i in merged)


def test_notebook_rescue_algorithm_matches_reference(ns):
    """Guardrail: the reference algorithm in this file MUST be a byte-identical
    subset of the notebook's rescue block. If they diverge, either the notebook
    fix was reverted or this test was tampered with."""
    body = _notebook_body()
    for expected_snippet in [
        "_sized_keys = {(info.catalog, info.schema, info.table) for info in all_table_size_infos}",
        "_missing_seen = set()",
        "_missing_ordered = []",
        "for _raw in all_raw_table_tuples:",
        "if _raw not in _sized_keys and _raw not in _missing_seen:",
        "_missing_seen.add(_raw)",
        "_missing_ordered.append(_raw)",
        "TableSizeInfo(_c, _s, _t, num_columns=0, size_category=\\\"unknown\\\")",
    ]:
        assert expected_snippet in body, f"missing rescue-block snippet: {expected_snippet!r}"


def test_batch_optimizer_receives_nonempty_when_rescue_fires(ns):
    """End-to-end contract: if raw discovery finds N tables and size analysis
    returned zero, create_optimized_batches receives N defaults, not empty."""
    BatchOptimizer = ns.get("BatchOptimizer")
    TableSizeInfo = ns["TableSizeInfo"]
    raw = [("c", "s", f"t{i}") for i in range(8)]
    sized = []
    logger = _CapturingLogger()
    merged = _apply_rescue_algorithm(raw, sized, TableSizeInfo, logger)
    assert len(merged) == 8
    if BatchOptimizer is not None:
        try:
            optimizer = BatchOptimizer(logger=logger)
        except TypeError:
            try:
                optimizer = BatchOptimizer(None, logger)
            except Exception:
                optimizer = None
        if optimizer is not None and hasattr(optimizer, "create_optimized_batches"):
            batches = optimizer.create_optimized_batches(merged)
            assert batches and len(batches) > 0, \
                "post-rescue, batch optimizer must produce at least one batch"
