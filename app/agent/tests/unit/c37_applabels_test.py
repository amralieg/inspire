"""c37_applabels (REQ-582 / REQ-583, contract U8 v2): `_filter_business_tables` consumes the table labels the App wrote.

Flag TECHNICAL_CONTEXT.runtime.app_table_labels (default False). On, and rows exist for this session in
<inspire_db>.__inspire_table_labels (session_id, level catalog|schema|table, object_fqn, env prod|dev, label, confidence, source,
labelled_at): the user's ignore rules still win first; anything under a dev catalog or dev schema, any dev table and any prod technical
table is technical; prod transactional / master tables are business with data_category_map set; prod reference tables are join context
only (reference set, never the business set); in-scope tables with no row go to FILTER_BUSINESS_TABLES_PROMPT. Output tuple unchanged;
classification_status is "app" for labelled tables and "llm" for tables the prompt classified (flag off: "verified" as before)."""
import os
import re
import sys
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from v120_metadata_evidence_test import (FILTER_DETAILS, classifier, details_for, make_inspire,  # noqa: E402,F401
                                         fast_polling, unpack)

LABELS = "__inspire_table_labels"
ORDERS, CUSTOMERS, LOGS, TMP = "main.sales.orders", "main.sales.customers", "main.ops.job_logs", "main.ops.tmp_scratch"
SESSION = 77


def row(level, fqn, env="prod", label=None, session=SESSION):
    return SimpleNamespace(session_id=session, level=level, object_fqn=fqn, env=env, label=label, confidence=0.9, source="app_fast:test",
                           labelled_at=None)


class FakeSpark:
    """Answers the labels read for the asking session only; records every statement."""

    def __init__(self, rows):
        self.rows, self.statements = rows, []

    def sql(self, query, *a, **k):
        self.statements.append(str(query))
        match = re.search(r"session_id\s*=\s*(\d+)", str(query))
        rows = [r for r in self.rows if match and r.session_id == int(match.group(1))] if LABELS in str(query) else []
        return SimpleNamespace(collect=lambda: list(rows))

    def label_reads(self):
        return [q for q in self.statements if LABELS in q]


def build(ns, rows, flag=True, responder=None, ignores=None, details=None):
    ns["TECHNICAL_CONTEXT"]["runtime"]["app_table_labels"] = flag
    spark = FakeSpark(rows)
    obj = make_inspire(ns, responder=responder or classifier({}), session_id=SESSION,
                       atomic_writer=SimpleNamespace(spark=spark, inspire_database="cat.db", enabled=True))
    if ignores:
        obj.parsed_generation_instructions = {"table_ignores": ignores}
    return obj, spark


def prompted(obj):
    """Tables that reached FILTER_BUSINESS_TABLES_PROMPT."""
    return {f"{c}.{s}.{t}" for call in obj.ai_agent.calls for c, s, t in re.findall(r"`([^`]+)`\.`([^`]+)`\.`([^`]+)`", call["vars"]["tables_markdown"])}


def warnings(obj):
    return [msg for level, msg in obj.logger.records if level == "WARNING"]


def test_1_flag_off_reads_no_labels_and_prompts_as_today(agent_ns):
    assert agent_ns["TECHNICAL_CONTEXT"]["runtime"]["app_table_labels"] is False
    obj, spark = build(agent_ns, [row("table", ORDERS, label="technical")], flag=False)
    out = unpack(obj._filter_business_tables(FILTER_DETAILS))
    assert spark.label_reads() == []
    assert prompted(obj) == {ORDERS, CUSTOMERS, LOGS, TMP}
    assert ORDERS in out["business"]
    assert set(obj.table_classification_status.values()) == {"verified"}


def test_2_all_tables_labelled_makes_zero_prompt_calls(agent_ns):
    rows = [row("table", ORDERS, label="transactional"), row("table", CUSTOMERS, label="master"),
            row("table", LOGS, label="technical"), row("table", TMP, env="dev", label="technical")]
    obj, spark = build(agent_ns, rows)
    out = unpack(obj._filter_business_tables(FILTER_DETAILS))
    assert len(spark.label_reads()) == 1 and f"cat.db.`{LABELS}`" in spark.label_reads()[0].replace("`cat`.`db`", "cat.db")
    assert obj.ai_agent.calls == []
    assert out["business"] == {ORDERS, CUSTOMERS} and out["technical"] == {LOGS, TMP}
    assert out["transactional"] == {ORDERS} and out["master"] == {CUSTOMERS} and out["reference"] == set()
    assert out["category"][ORDERS] == "TRANSACTIONAL" and out["category"][CUSTOMERS] == "MASTER"
    assert {d[2] for d in out["business_details"]} == {"orders", "customers"}
    assert set(obj.table_classification_status.values()) == {"app"}


def test_3_only_unlabelled_tables_reach_the_prompt(agent_ns):
    rows = [row("table", ORDERS, label="transactional"), row("table", TMP, label="technical"),
            row("table", CUSTOMERS, label="master", session=SESSION + 1)]
    obj, _ = build(agent_ns, rows, responder=classifier({LOGS: ("TECHNICAL", "TECHNICAL")}))
    out = unpack(obj._filter_business_tables(FILTER_DETAILS))
    assert prompted(obj) == {CUSTOMERS, LOGS}
    status = obj.table_classification_status
    assert (status[ORDERS], status[TMP], status[CUSTOMERS], status[LOGS]) == ("app", "app", "llm", "llm")
    assert out["business"] == {ORDERS, CUSTOMERS} and out["technical"] == {LOGS, TMP}


def test_4_ignore_rules_win_over_an_app_label(agent_ns):
    rows = [row("table", ORDERS, label="transactional"), row("table", CUSTOMERS, label="master"),
            row("table", LOGS, label="technical"), row("table", TMP, label="technical")]
    obj, _ = build(agent_ns, rows, ignores=[{"pattern": "orders", "type": "exact"}])
    out = unpack(obj._filter_business_tables(FILTER_DETAILS))
    assert ORDERS in out["technical"] and ORDERS not in out["business"]
    assert obj.table_classification_status[ORDERS] == "user_ignored"
    assert obj.ai_agent.calls == []


def test_5_flag_on_without_rows_warns_and_takes_todays_path(agent_ns):
    obj, spark = build(agent_ns, [row("table", ORDERS, label="technical", session=SESSION + 1)])
    out = unpack(obj._filter_business_tables(FILTER_DETAILS))
    assert len(spark.label_reads()) == 1
    assert any(LABELS in w for w in warnings(obj)), warnings(obj)
    assert prompted(obj) == {ORDERS, CUSTOMERS, LOGS, TMP}
    assert ORDERS in out["business"] and set(obj.table_classification_status.values()) == {"verified"}


def test_6_labels_for_tables_outside_the_scope_never_enter_the_result(agent_ns):
    ghost, ghost_dev = "main.sales.ghost", "other.sales.ghost_dev"
    rows = [row("table", ghost, label="transactional"), row("table", ghost_dev, env="dev", label="technical"),
            row("catalog", "elsewhere", env="dev"), row("table", ORDERS, label="transactional")]
    obj, _ = build(agent_ns, rows)
    result = obj._filter_business_tables(FILTER_DETAILS)
    out = unpack(result)
    everything = out["business"] | out["technical"] | out["reference"] | set(out["category"]) | set(out["scores"]) | set(obj.table_classification_status)
    assert not ({ghost, ghost_dev} & everything)
    assert prompted(obj) == {CUSTOMERS, LOGS, TMP} and ORDERS in out["business"]


def test_7_dev_catalog_row_excludes_its_tables_even_with_prod_table_rows(agent_ns):
    rows = [row("catalog", "main", env="dev"), row("table", ORDERS, label="transactional"), row("table", CUSTOMERS, label="master")]
    obj, _ = build(agent_ns, rows)
    out = unpack(obj._filter_business_tables(FILTER_DETAILS))
    assert out["technical"] == {ORDERS, CUSTOMERS, LOGS, TMP} and out["business"] == set()
    assert obj.ai_agent.calls == []
    assert set(obj.table_classification_status.values()) == {"app"}


def test_8_dev_schema_row_excludes_its_tables(agent_ns):
    rows = [row("catalog", "main"), row("schema", "main.ops", env="dev"), row("schema", "main.sales"),
            row("table", ORDERS, label="transactional"), row("table", CUSTOMERS, label="master")]
    obj, _ = build(agent_ns, rows)
    out = unpack(obj._filter_business_tables(FILTER_DETAILS))
    assert out["technical"] == {LOGS, TMP} and out["business"] == {ORDERS, CUSTOMERS}
    assert obj.ai_agent.calls == []


def test_9_prod_reference_tables_are_join_context_only(agent_ns):
    ref = "main.sales.ref_status"
    details = FILTER_DETAILS + details_for((ref, [("code", "string"), ("label", "string")]))
    rows = [row("table", ORDERS, label="transactional"), row("table", CUSTOMERS, label="master"), row("table", ref, label="reference"),
            row("table", LOGS, label="technical"), row("table", TMP, label="technical")]
    obj, _ = build(agent_ns, rows)
    out = unpack(obj._filter_business_tables(details))
    assert out["reference"] == {ref} and ref not in out["business"] and ref not in out["technical"]
    assert out["category"][ref] == "REFERENCE" and obj.table_classification_status[ref] == "app"
    assert ref not in {d[2] and f"{d[0]}.{d[1]}.{d[2]}" for d in out["business_details"]}
    assert {f"{d[0]}.{d[1]}.{d[2]}" for d in obj._reference_details_last} == {ref}


def test_10_prod_transactional_and_master_are_business_with_a_category(agent_ns):
    rows = [row("catalog", "main"), row("schema", "main.sales"), row("table", ORDERS, label="transactional"),
            row("table", CUSTOMERS, label="master"), row("table", LOGS, label="technical"), row("table", TMP, label="technical")]
    obj, _ = build(agent_ns, rows)
    out = unpack(obj._filter_business_tables(FILTER_DETAILS))
    assert out["business"] == {ORDERS, CUSTOMERS}
    assert (out["category"][ORDERS], out["category"][CUSTOMERS]) == ("TRANSACTIONAL", "MASTER")
    assert out["transactional"] == {ORDERS} and out["master"] == {CUSTOMERS}
    assert out["scores"][ORDERS] > 0 and out["scores"][LOGS] == 0


def test_11_flag_must_be_a_boolean(agent_ns):
    runtime = agent_ns["TECHNICAL_CONTEXT"]["runtime"]
    runtime["app_table_labels"] = True
    agent_ns["_validate_runtime_config"]()
    runtime["app_table_labels"] = "yes"
    with pytest.raises(TypeError, match="app_table_labels"):
        agent_ns["_validate_runtime_config"]()
