"""v1.0.9 P30 -- generation-time hallucination validator.

The `_validate_genie_instruction_references` helper cross-checks every 3-part
`catalog.schema.table` reference in a generated Genie instruction against the
run's known-good UC metadata (union of `Tables Involved`, `Primary Table`,
`result_table`, and any per-run `_genie_schema_index_cache`).

Modes (controlled by env var `INSPIRE_GENIE_HALLUCINATION_MODE`):
  - `strict`  (default at Discover-mode call site) -- refuse to emit; UC's
    `genie_instruction_status` becomes 'failed_validation' and the raw list is
    persisted on `use_case['genie_validation_errors']`.
  - `soft`  -- log warnings, keep the instruction, still persist the raw list.
  - `off` / `disabled` -- skip the check entirely.

§8.3 non-tautology: the validator MUST have a case that returns False
(hallucinated ref detected) and a case that returns True (all clean), both
observable via the returned tuple.
"""
import os
import sys
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import agent_source, load_agent_namespace


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def _mk(ns):
    Klass = ns["DatabricksInspire"]
    inst = Klass.__new__(Klass)
    inst.logger = MagicMock()
    return inst


def test_A_source_defines_validator_method_and_call_site():
    """§8.7 grep test: the impl cell must define `_validate_genie_instruction_references`
    AND wire it into `_generate_genie_instruction_for_use_case` via a call site that reads
    `INSPIRE_GENIE_HALLUCINATION_MODE` from the environment."""
    src = agent_source()
    assert "def _validate_genie_instruction_references" in src, (
        "v1.0.9 P30: helper `_validate_genie_instruction_references` MUST be defined"
    )
    assert "INSPIRE_GENIE_HALLUCINATION_MODE" in src, (
        "v1.0.9 P30: env-var-based config knob missing -- call site not wired"
    )
    assert "[GENIE-VALIDATE]" in src, (
        "v1.0.9 P30: [GENIE-VALIDATE] log tag missing -- validator body not shipped"
    )
    # Cache line in _generate_skeletons_and_capture_fields:
    assert "self._genie_schema_index_cache = dict(schema_by_table)" in src, (
        "v1.0.9 P30: schema index cache missing from Discover-mode field-capture path"
    )


def test_B_all_references_known_returns_ok(ns):
    """Zero hallucination: every referenced 3-part identifier is in the known-good set."""
    inst = _mk(ns)
    uc = {
        "No": "T-U01",
        "Tables Involved": "cat.sch.orders, cat.sch.customers",
        "Primary Table": "cat.sch.orders",
        "available_tables_listing": "cat.sch.orders\n- cat.sch.customers\n- cat.sch.products",
        "result_table": "cat.inspire.t_u01_out",
    }
    instr = "Use cat.sch.orders joined with cat.sch.customers and cat.sch.products. Write to cat.inspire.t_u01_out."
    ok, hallucinated = inst._validate_genie_instruction_references(uc, instr, schema_index=None)
    assert ok is True
    assert hallucinated == []


def test_C_unknown_reference_returns_not_ok(ns):
    """Positive detection: an unknown 3-part reference is flagged.
    §8.3 non-tautology: the returned list MUST be non-empty; the boolean MUST be False."""
    inst = _mk(ns)
    uc = {
        "No": "T-U02",
        "Tables Involved": "cat.sch.orders",
        "Primary Table": "cat.sch.orders",
        "available_tables_listing": "- cat.sch.orders",
        "result_table": "cat.inspire.t_u02_out",
    }
    instr = "Use cat.sch.orders joined with bogus_cat.bogus_sch.hallucinated_table to compute something."
    ok, hallucinated = inst._validate_genie_instruction_references(uc, instr, schema_index=None)
    assert ok is False, "hallucinated reference MUST cause ok=False"
    assert "bogus_cat.bogus_sch.hallucinated_table" in hallucinated, (
        f"expected hallucinated ref in list, got {hallucinated}"
    )


def test_D_information_schema_and_system_are_allowlisted(ns):
    """Any `system.*` reference (system.access.table_lineage, system.billing.usage, ...)
    and any `*.information_schema.*` reference is always allowed -- these are the standard
    Databricks metadata paths the prompt tells the LLM to use for discovery."""
    inst = _mk(ns)
    uc = {
        "No": "T-U03",
        "Tables Involved": "cat.sch.orders",
        "Primary Table": "cat.sch.orders",
        "available_tables_listing": "- cat.sch.orders",
        "result_table": "cat.inspire.t_u03_out",
    }
    instr = (
        "Query system.access.table_lineage and cat.information_schema.tables to enrich cat.sch.orders. "
        "Also join system.information_schema.columns for cross-catalog schema comparison."
    )
    ok, hallucinated = inst._validate_genie_instruction_references(uc, instr, schema_index=None)
    assert ok is True, f"system.* and information_schema.* must be allow-listed; got {hallucinated}"


def test_E_schema_index_expands_known_set(ns):
    """When `schema_index` is passed in (Discover-mode wave call), tables listed as keys
    MUST be treated as known-good even if the UC dict's Tables Involved didn't name them."""
    inst = _mk(ns)
    uc = {
        "No": "T-U04",
        "Tables Involved": "cat.sch.orders",
        "Primary Table": "cat.sch.orders",
        "available_tables_listing": "",
        "result_table": "cat.inspire.t_u04_out",
    }
    schema_index = {
        "cat.sch.orders": [],
        "cat.sch.products": [],
        "cat.enrich.geography": [],
    }
    instr = "Join cat.sch.orders with cat.sch.products and cat.enrich.geography."
    ok, hallucinated = inst._validate_genie_instruction_references(uc, instr, schema_index=schema_index)
    assert ok is True, f"schema_index-listed tables must be recognised; got {hallucinated}"


def test_F_cache_on_self_expands_known_set(ns):
    """When `schema_index=None`, the validator MUST fall back to `self._genie_schema_index_cache`
    populated by Discover mode. This is how auto-Genie regen paths get schema knowledge --
    they call with schema_index=None and rely on the cache."""
    inst = _mk(ns)
    inst._genie_schema_index_cache = {
        "cat.sch.orders": [],
        "cat.enrich.currency_rate": [],
    }
    uc = {
        "No": "T-U05",
        "Tables Involved": "cat.sch.orders",
        "Primary Table": "cat.sch.orders",
        "available_tables_listing": "",
        "result_table": "cat.inspire.t_u05_out",
    }
    instr = "Join cat.sch.orders with cat.enrich.currency_rate."
    ok, hallucinated = inst._validate_genie_instruction_references(uc, instr, schema_index=None)
    assert ok is True, f"cache lookup must expand known-good set; got {hallucinated}"


def test_G_no_baseline_no_verdict(ns):
    """When no known-good baseline is available (no schema_index, no cache, no Tables Involved
    on the UC), the validator MUST NOT flag anything -- it has nothing to compare against.
    Returning False in this case would be a §3d violation (invent verdicts from thin air)."""
    inst = _mk(ns)
    if hasattr(inst, "_genie_schema_index_cache"):
        del inst._genie_schema_index_cache
    uc = {
        "No": "T-U06",
        "Tables Involved": "",
        "Primary Table": "",
        "available_tables_listing": "",
        "result_table": "",
    }
    instr = "Query cat.sch.any_table."
    ok, hallucinated = inst._validate_genie_instruction_references(uc, instr, schema_index=None)
    assert ok is True and hallucinated == []


def test_H_two_part_or_bare_names_are_not_flagged(ns):
    """The validator MUST only flag 3-part `catalog.schema.table` references. A 2-part
    reference (`schema.table`) could be a column path or a valid short reference, and we
    do not have enough context to decide -- following §3d ("no false positives"), we skip."""
    inst = _mk(ns)
    uc = {
        "No": "T-U07",
        "Tables Involved": "cat.sch.orders",
        "Primary Table": "cat.sch.orders",
        "available_tables_listing": "- cat.sch.orders",
        "result_table": "cat.inspire.t_u07_out",
    }
    # `orders.customer_id` and `join.foo` look like 2-part; MUST NOT be flagged.
    instr = "Select orders.customer_id from cat.sch.orders. Group by items.category."
    ok, hallucinated = inst._validate_genie_instruction_references(uc, instr, schema_index=None)
    assert ok is True, f"2-part references must not be flagged; got {hallucinated}"


def test_I_empty_instruction_is_ok(ns):
    """An empty instruction has no references and should not be flagged."""
    inst = _mk(ns)
    uc = {"No": "T-U08", "Tables Involved": "cat.sch.t"}
    ok, hallucinated = inst._validate_genie_instruction_references(uc, "", schema_index=None)
    assert ok is True and hallucinated == []
