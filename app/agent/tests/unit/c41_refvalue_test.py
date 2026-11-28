"""c41_refvalue (REQ-583 / REQ-585 item 7, R6.4): a prod reference table the App labelled is never a use-case subject, but stays
available as join context for grounding and for value lookups in Combined Scoring (the value calculator)."""
import ast
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from c37_applabels_test import CUSTOMERS, LOGS, ORDERS, TMP, build, row  # noqa: E402
from v120_metadata_evidence_test import FILTER_DETAILS, unpack  # noqa: E402,F401
from v120_funnel_integrity_test import _call_nodes, method_node  # noqa: E402

REF_ROWS = [row("table", ORDERS, label="transactional"), row("table", CUSTOMERS, label="reference"),
            row("table", LOGS, label="technical"), row("table", TMP, env="dev", label="technical")]


def fqns(details):
    return {f"{d[0]}.{d[1]}.{d[2]}" for d in details}


def test_1_app_reference_table_is_not_a_subject_but_is_kept_as_reference(agent_ns):
    obj, _ = build(agent_ns, REF_ROWS)
    out = unpack(obj._filter_business_tables(FILTER_DETAILS))
    assert CUSTOMERS not in out["business"] and CUSTOMERS not in fqns(out["business_details"])
    assert CUSTOMERS in out["reference"] and out["category"][CUSTOMERS] == "REFERENCE"
    assert CUSTOMERS not in out["technical"] and CUSTOMERS not in fqns(out["technical_details"])
    assert fqns(obj._reference_details_last) == {CUSTOMERS}


def test_2_reference_table_joins_the_known_universe_for_grounding(agent_ns):
    obj, _ = build(agent_ns, REF_ROWS)
    out = unpack(obj._filter_business_tables(FILTER_DETAILS))
    obj._set_known_business_universe(out["business_details"])
    assert CUSTOMERS in obj.global_table_names
    assert {d[3] for d in obj._business_column_details_global if f"{d[0]}.{d[1]}.{d[2]}" == CUSTOMERS} == {"customer_id", "name"}


def test_3_reference_columns_reach_the_scoring_schema_in_run():
    """run(): _reference_details_last is merged into all_columns_for_sql, that list is saved as "all_columns_for_sql", and the
    Combined Scoring call (value calculator) reads its full_schema_details from that saved schema."""
    run = method_node("DatabricksInspire", "run")
    src = ast.unparse(run)
    assert "_reference_details_last" in src
    merge_loops = [n for n in ast.walk(run) if isinstance(n, ast.For) and "_reference_details_last" in ast.unparse(n.iter)
                   or isinstance(n, ast.For) and isinstance(n.iter, ast.Name) and n.iter.id == "_ref_details_for_merge"]
    assert any("all_columns_for_sql" in ast.unparse(n.body[0]) for n in merge_loops), "reference columns must be merged into all_columns_for_sql"
    saves = [ast.unparse(c) for c in _call_nodes(run, "save_schema_details")]
    assert any(s.startswith("self.storage_manager.save_schema_details(all_columns_for_sql") for s in saves)
    scoring = _call_nodes(run, "_score_combined_value_and_quality")
    assert scoring
    for call in scoring:
        kw = {k.arg: ast.unparse(k.value) for k in call.keywords}
        assert kw.get("full_schema_details") == "_schema_for_quality"
    assert "_schema_for_quality = self.storage_manager.load_schema_details('all_columns_for_sql')" in src


def test_4_prod_reference_table_reaches_scoring_schema_markdown(agent_ns):
    """The value calculator's schema markdown lists the reference table, so a price / rate lookup join through it is not flagged."""
    obj, _ = build(agent_ns, REF_ROWS)
    out = unpack(obj._filter_business_tables(FILTER_DETAILS))
    schema = list(out["business_details"]) + list(obj._reference_details_last)
    md = obj._build_schema_markdown_for_validation(schema)
    assert "customers" in md and "customer_id" in md


# --- R6.4: generation sees a prod reference table as join context (prices, rates, lookups), never as a primary subject ---

from req413_table_coverage_test import BAKE_TX, _bakehouse, _fqtn, _obj, _split  # noqa: E402

REF = "sales_customers"


def _ref_plan(agent_ns):
    details = _bakehouse()
    reference = [d for d in details if d[2] == REF]
    business = [d for d in details if d[2] != REF]
    tx, masters = _split(business, BAKE_TX, "bakehouse")
    obj = _obj(agent_ns, _reference_details_last=reference)
    return obj._join_group_plan(tx, masters, business)


def test_5_reference_table_rides_along_as_join_context_in_generation(agent_ns):
    plan = _ref_plan(agent_ns)
    ref = _fqtn("bakehouse", REF)
    context = {c for g in plan["groups"] for c in g["context"]}
    assert ref in context, "a prod reference table that joins a primary (customerID) must reach generation as join context"
    holder = next(g for g in plan["groups"] if ref in g["context"])
    assert {d[3] for d in holder["columns"] if d[2] == REF} >= {"customerID"}, "its columns must be in the batch"


def test_6_reference_table_is_never_a_primary_or_a_coverage_target(agent_ns):
    plan = _ref_plan(agent_ns)
    ref = _fqtn("bakehouse", REF)
    assert ref not in {p for g in plan["groups"] for p in g["primaries"]}
    assert ref not in plan["unattached"], "the coverage gate must not chase a use case for a reference table"


def test_7_no_reference_tables_leaves_the_plan_unchanged(agent_ns):
    details = _bakehouse()
    tx, masters = _split(details, BAKE_TX, "bakehouse")
    with_attr = _obj(agent_ns, _reference_details_last=[])._join_group_plan(tx, masters, details)
    without = _obj(agent_ns)._join_group_plan(tx, masters, details)
    assert with_attr == without


# --- the guard: a reference table that now reaches generation as context is never a use case's subject (Primary Table) ---

def _guard_obj(agent_ns):
    ref = _fqtn("bakehouse", REF)
    obj = _obj(agent_ns, _reference_details_last=[d for d in _bakehouse() if d[2] == REF],
               data_category_map={ref: "REFERENCE", _fqtn("bakehouse", "sales_transactions"): "TRANSACTIONAL"})
    return obj, ref


def test_8_reference_table_named_first_is_moved_behind_the_subject(agent_ns):
    obj, ref = _guard_obj(agent_ns)
    tx = _fqtn("bakehouse", "sales_transactions")
    ucs = [{"No": "AI01-UC01", "Name": "Spend by customer segment", "Tables Involved": f"{ref}, {tx}"}]
    out = obj._keep_reference_out_of_subject(ucs)
    assert [uc["No"] for uc in out] == ["AI01-UC01"]
    assert out[0]["Tables Involved"] == f"{tx}, {ref}", "the reference table stays as join context, after the subject"
    assert obj._extract_primary_table(out[0]["Tables Involved"]) == tx


def test_9_use_case_on_reference_tables_only_is_dropped_and_logged(agent_ns, caplog):
    obj, ref = _guard_obj(agent_ns)
    keep = {"No": "AI01-UC02", "Name": "Basket size", "Tables Involved": _fqtn("bakehouse", "sales_transactions")}
    only_ref = {"No": "AI01-UC03", "Name": "Customer list", "Tables Involved": f"`{ref.upper()}`"}
    with caplog.at_level("INFO"):
        out = obj._keep_reference_out_of_subject([keep, only_ref])
    assert [uc["No"] for uc in out] == ["AI01-UC02"], "case and backticks do not hide a reference table"
    assert any("AI01-UC03" in r.getMessage() for r in caplog.records)


def test_10_no_reference_tables_changes_nothing(agent_ns):
    obj = _obj(agent_ns, _reference_details_last=[], data_category_map={})
    ucs = [{"No": "AI01-UC01", "Tables Involved": "a.b.c, a.b.d"}]
    assert obj._keep_reference_out_of_subject([dict(u) for u in ucs]) == ucs


def test_11_run_applies_the_guard_before_scoring():
    run = method_node("DatabricksInspire", "run")
    guard = _call_nodes(run, "_keep_reference_out_of_subject")
    scoring = _call_nodes(run, "_score_combined_value_and_quality")
    assert guard and scoring
    assert min(n.lineno for n in guard) < min(n.lineno for n in scoring)
