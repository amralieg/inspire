"""c34 / REQ-580: Table Election "All Tables" trusts the scope it is given and skips the LLM table classifier.

The user (or an upstream picker) chose the scope in `01_uc_metadata`. In this mode every table in scope is business, except the
tables the user's own ignore rules name. master / transactional / reference and `data_category_map` come from deterministic rules
(each entry carries `label_source == "rules"`); `table_classification_status` marks them "rules". The other election modes keep
calling the classifier exactly as before.
"""
import logging
import os
import re
from types import SimpleNamespace

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
NOTEBOOK = os.path.join(ROOT, "agent", "dbx_inspire_ai_agent.ipynb")
PHRASE = "no classification; every table in scope is used; labels from rules"

COLUMNS = {
    "fact_orders": [("order_id", "bigint"), ("customer_id", "bigint"), ("status_id", "bigint"),
                    ("order_ts", "timestamp"), ("total_amount", "decimal(18,2)")],
    "dim_customer": [("customer_id", "bigint"), ("customer_name", "string"), ("email", "string"), ("city", "string")],
    "ref_status_code": [("status_code", "string"), ("status_label", "string")],
    "orders_tmp": [("id", "bigint"), ("payload", "string")],
    "audit_log": [("id", "bigint"), ("message", "string"), ("created_by", "string")],
}
FQ = {t: f"main.shop.{t}" for t in COLUMNS}


class _NoLLM:
    """Any use of the agent's LLM client is a failure: this mode must not classify."""
    calls = 0

    def __getattr__(self, name):
        raise AssertionError(f"the LLM client was used ({name}) in All Tables mode")


def _details(tables=None):
    return [("main", "shop", t, c, ty, "") for t, cols in COLUMNS.items() if tables is None or t in tables for c, ty in cols]


def _fk(child, col, parent, pcol):
    return ("main", "shop", child, col, "main", "shop", parent, pcol)


def _inspire(ns, mode, ignores=None):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = logging.getLogger("c34_alltables")
    obj.table_election_mode = mode
    obj.parsed_generation_instructions = {"table_ignores": ignores or []}
    obj.additional_context = ""
    obj.ai_agent = _NoLLM()
    obj.data_loader = SimpleNamespace(foreign_key_graph={
        "fact_orders": [_fk("fact_orders", "customer_id", "dim_customer", "customer_id"),
                        _fk("fact_orders", "status_id", "ref_status_code", "status_code")]})
    obj.classifier_calls = 0

    def _classifier(*_a, **_k):
        obj.classifier_calls += 1
        raise AssertionError("the table classifier ran")

    obj._filter_business_tables = _classifier
    obj._filter_business_tables_with_batching = _classifier
    return obj


def _scope(obj, details):
    return obj._resolve_table_scope(details, business_context="", industry="")


def _names(rows):
    return {f"{r[0]}.{r[1]}.{r[2]}" for r in rows}


def test_1_all_tables_never_calls_the_classifier_and_keeps_every_table(agent_ns):
    obj = _inspire(agent_ns, "All Tables")
    business_details, technical_details, business_tables, technical_tables, *_ = _scope(obj, _details())
    assert obj.classifier_calls == 0
    assert _names(business_details) == set(FQ.values())
    assert set(business_tables) == set(FQ.values())
    assert not technical_details and not technical_tables


def test_2_roles_come_from_rules_and_every_entry_says_so(agent_ns):
    obj = _inspire(agent_ns, "All Tables")
    (_bd, _td, _bt, _tt, _scores, category_map, master, transactional, reference) = _scope(obj, _details())
    assert FQ["fact_orders"] in transactional
    assert FQ["dim_customer"] in master
    assert FQ["ref_status_code"] in reference
    assert set(category_map) == set(FQ.values())
    assert category_map[FQ["fact_orders"]] == "TRANSACTIONAL"
    assert category_map[FQ["dim_customer"]] == "MASTER"
    assert category_map[FQ["ref_status_code"]] == "REFERENCE"
    assert all(getattr(v, "label_source", None) == "rules" for v in category_map.values())
    assert set(obj.table_classification_status.values()) == {"rules"}


def test_3_user_ignore_rule_still_excludes_deterministically(agent_ns):
    obj = _inspire(agent_ns, "All Tables", ignores=[{"pattern": "*_tmp", "type": "suffix"}])
    business_details, technical_details, business_tables, technical_tables, *_ = _scope(obj, _details())
    assert obj.classifier_calls == 0
    assert _names(business_details) == set(FQ.values()) - {FQ["orders_tmp"]}
    assert _names(technical_details) == {FQ["orders_tmp"]}
    assert obj.table_classification_status[FQ["orders_tmp"]] == "user_ignored"


def test_4_empty_scope_fails_before_any_llm_call_with_a_clear_error(agent_ns):
    obj = _inspire(agent_ns, "All Tables")
    with pytest.raises(ValueError, match="(?i)no tables in scope"):
        _scope(obj, [])
    assert obj.classifier_calls == 0


@pytest.mark.parametrize("mode", ["Let Inspire Decides", "Transactional Only"])
def test_5_other_modes_still_call_the_classifier(agent_ns, mode):
    """Must-keep: passes on the base and after."""
    obj = _inspire(agent_ns, mode)
    canned = ([], [], set(), set(), {}, {}, set(), set(), set())
    seen = []

    def _classifier(db_details, business_context="", industry="", exclusion_strategy=None):
        seen.append(len(db_details))
        return canned

    obj._filter_business_tables = _classifier
    entry = getattr(obj, "_resolve_table_scope", None)
    result = entry(_details(), business_context="", industry="") if entry else obj._filter_business_tables(_details())
    assert seen == [len(_details())]
    assert result == canned


def test_6_one_function_builds_the_all_tables_category_sets():
    with open(NOTEBOOK, encoding="utf-8") as handle:
        text = handle.read()
    assert len(re.findall(r"def _all_tables_scope\(", text)) == 1
    assert len(re.findall(r"self\._all_tables_scope\(", text)) == 1


@pytest.mark.parametrize("path", ["readme.md", os.path.join("docs", "design-guide.md")])
def test_7_docs_state_the_all_tables_contract(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as handle:
        rows = [line for line in handle if line.lstrip().startswith("| `All Tables`")]
    assert len(rows) == 1
    assert PHRASE in rows[0]
