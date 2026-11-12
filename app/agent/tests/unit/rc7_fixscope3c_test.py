"""rc7 fix-scope3c (REQ-022): the Implement wizard's Table Scope reaches every KPI read of an implemented use case.

The value tracking of an implemented use case measures its KPI through the scope the person chose in the wizard, a
KPI whose wizard scope cannot be read is not measured at all, a table the wizard removed is not read, the target
KPI's query reads the scope, the measure gate refuses a base-table read of a scoped table, a signal join reads the
scoped joined table, and a table the person left unscoped is read whole."""
import json

import pytest

from v120_artifacts_support import FakeSpark, make_inspire
from v130_evidence_test import Row
from v130_feedback_test import fb, obj_with
from v153_signal_check_test import FLAT_PRICE, SALES, deep_inspire, responder_for, uc

TABLE = "main.s.orders"
OTHER = "main.s.customers"
BASE = "`main`.`s`.`orders`"
GOLD = "WHERE `status` = 'gold'"
DATABASE = "main.insp"
KEY = "revenue|main.s.orders"


def _gold(table=TABLE):
    return {"tables": {}, "removed_tables": [], "column_roles": {"entity_id": f"{table}.order_id", "measure": f"{table}.total_price"},
            "filters": [{"table": table, "column": "status", "op": "=", "values": ["gold"]}], "window": {}, "run_profile": "preview",
            "notes": ""}


def _stored_revenue():
    return [{"name": "Revenue", "computable": True, "aggregation": "SUM", "table": TABLE, "column": "total_price", "unit": "",
             "direction": "up", "kpi_id": "k1"}]


def _tracking(agent_ns, deep, data=None, implement_error=None):
    obj, spark = obj_with(agent_ns, rows=[fb(KEY, "implemented", title="Revenue")],
                          tracking_rows=[Row(use_case_key=KEY, kpis=json.dumps(_stored_revenue()), session_id=1, id="N01-U03")], deep=deep)
    prior = spark.responder

    def responder(statement):
        if "__inspire_implement" in statement:
            if implement_error is not None:
                raise implement_error
            return [Row(spec_json=json.dumps({"data": data}))]
        return prior(statement)
    spark.responder = responder
    obj._gate_schema_index([("main", "s", "orders", "order_id", "bigint", ""), ("main", "s", "orders", "total_price", "double", ""),
                            ("main", "s", "orders", "status", "string", "")])
    obj._load_feedback()
    return obj._track_implemented_value()


@pytest.fixture
def clean(agent_ns):
    agent_ns["INSPIRE_TABLE_SCOPES"].clear()
    agent_ns["SCOPE_BYPASSES"].clear()
    yield agent_ns
    agent_ns["INSPIRE_TABLE_SCOPES"].clear()
    agent_ns["SCOPE_BYPASSES"].clear()


def test_value_tracking_measures_an_implemented_kpi_through_its_wizard_scope(clean):
    measured = FakeSpark(responder=lambda statement: [Row(v=130)])
    deep = clean["DeepEvidence"](measured, "Deep", make_inspire(clean).logger)
    entry = _tracking(clean, deep, data=_gold())[0]
    assert GOLD in entry["query"] and "(SELECT" in entry["query"], entry["query"]
    assert measured.statements and all(s.count(GOLD) == 2 for s in measured.statements), measured.statements
    assert entry["current"]["value"] == 130.0 and entry["status"] == "measured"


def test_a_tracked_kpi_is_not_measured_when_its_wizard_scope_cannot_be_read(clean):
    measured = FakeSpark(responder=lambda statement: [Row(v=130)])
    deep = clean["DeepEvidence"](measured, "Deep", make_inspire(clean).logger)
    tracked = _tracking(clean, deep, implement_error=RuntimeError("PERMISSION_DENIED: no SELECT on __inspire_implement"))
    assert tracked == [], tracked
    assert measured.statements == [], "no unscoped read of the base table is made"


def test_a_tracked_kpi_on_a_table_the_wizard_removed_is_not_measured(clean):
    measured = FakeSpark(responder=lambda statement: [Row(v=130)])
    deep = clean["DeepEvidence"](measured, "Deep", make_inspire(clean).logger)
    data = dict(_gold(), removed_tables=[TABLE])
    assert _tracking(clean, deep, data=data) == []
    assert measured.statements == []


def test_the_measure_gate_refuses_a_base_table_read_of_a_wizard_scoped_table(clean):
    scopes = clean["implement_table_scopes"](_gold(), [TABLE], DATABASE, "N01-U03")
    spark = FakeSpark()
    deep = clean["DeepEvidence"](spark, "Deep", make_inspire(clean).logger)
    with pytest.raises(clean["ScopeBypassError"], match="kpi_baseline on main.s.orders reads main.s.orders without its Table Scope"):
        deep._read("kpi_baseline", TABLE, f"SELECT COUNT(*) AS n FROM {BASE}", scopes=scopes)
    assert spark.statements == [], "the unscoped read is refused before it reaches the warehouse"


def test_the_target_kpi_query_reads_the_wizard_scope(clean):
    scopes = clean["implement_use_case_scopes"]({"No": "N01-U03", "_implement_data": _gold()}, [TABLE], DATABASE)
    obj, _spark = obj_with(clean)
    uc_tables = {TABLE: {"order_id": "BIGINT", "total_price": "DOUBLE", "status": "STRING"}}
    context = {"catalog": {"kpis": {}}, "metric_views": {}, "profiles": {}, "originals": {TABLE: ("main", "s", "orders")}}
    spec = obj._resolve_kpi_spec(_stored_revenue()[0], uc_tables, context, [], scopes)
    assert spec["computable"] is True, spec
    assert GOLD in spec["query"] and "(SELECT" in spec["query"], spec["query"]
    assert clean["assert_scoped_reads"](spec["query"], "the target KPI", scopes) == spec["query"]


def test_a_signal_join_reads_the_wizard_scope_of_the_joined_table(clean):
    scopes = clean["implement_table_scopes"](_gold(OTHER), [OTHER], DATABASE, "N01-U03")
    spec = {"roles": {"entity_key": "customer_id"}, "date_joins": {"when": {"table": OTHER, "key": "customer_id",
                                                                       "ref_column": "customer_id", "date": "signup_date",
                                                                       "alias": "signup"}}}
    sql, _args = clean["DeepEvidence"].signal_sql("features", "(SELECT * FROM main.s.orders) AS f", spec, None, 10, scopes)
    joined = sql[sql.index("LEFT JOIN"):]
    assert "LEFT JOIN (SELECT" in joined and GOLD in joined, joined


def test_a_table_the_person_left_unscoped_is_read_whole(clean):
    data = _gold()
    assert clean["implement_scope_text"](data, [TABLE, OTHER]) == {TABLE: {"columns": ["order_id", "total_price"],
                                                                         "rows": [{"column": "status", "op": "=", "values": ["gold"]}]}}
    scopes = clean["implement_table_scopes"](data, [TABLE, OTHER], DATABASE, "N01-U03")
    assert set(scopes) == {clean["inspire_table_scope_key"](TABLE)}
    sql = clean["DeepEvidence"].kpi_sql({"table": OTHER, "aggregation": "COUNT", "column": "customer_id"}, scopes)
    assert "FROM `main`.`s`.`customers`" in sql and "(SELECT" not in sql, sql


def test_the_implement_recount_counts_only_the_rows_the_wizard_scope_keeps(agent_ns):
    use_case = uc("N01-U02", "Optimization")
    use_case["_implement_data"] = {"tables": {}, "removed_tables": [], "window": {}, "run_profile": "preview", "notes": "",
                                   "column_roles": {"lever": f"{SALES}.sales_price", "outcome": f"{SALES}.quantity"},
                                   "filters": [{"table": SALES, "column": "churned", "op": "=", "values": ["no"]}]}
    inst, _agent, spark = deep_inspire(agent_ns, [], responder_for({"lever": FLAT_PRICE, "rows": 1000}))
    inst.spark = spark
    spec = {"check": "lever", "family": "H", "table": SALES, "roles": {"lever": "sales_price", "outcome": "quantity"}}
    record = {"status": "passed", "check": "lever", "family": "H", "spec": spec, "measures": {"row_count": 1000}}
    fresh = inst._implement_recount_signal(("k", "N01-U02"), use_case, record)
    assert fresh.get("table") == SALES, fresh
    reads = [s for s in spark.statements if "store_sales" in s]
    assert len(reads) >= 2, spark.statements
    assert all("WHERE `churned` = 'no'" in s for s in reads), reads


def test_the_source_value_check_compares_against_the_wizard_scope_not_the_whole_table(clean):
    scopes = clean["implement_table_scopes"](_gold(), [TABLE], DATABASE, "N01-U03")
    sql = clean["implement_aggregate_probe_sql"]("main.inspire.churn_out", TABLE, "order_id", scopes)
    assert GOLD in sql and "(SELECT" in sql, sql
    assert "LEFT ANTI JOIN `main`.`s`.`orders` AS s" not in sql, sql
