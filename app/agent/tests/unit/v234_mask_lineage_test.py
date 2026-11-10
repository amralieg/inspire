import types

from v120_artifacts_support import CapturingLogger, make_inspire
from v232_protected_sources_test import OWN, RESULT, SOURCE, _protection

HIDE = "main.sec.hide_email"


def _sources(ns, filters=()):
    return {SOURCE: _protection(ns, ["owner", "email", "amount"], filters=filters, masks=[("email", HIDE, None)])}


def _result(ns, columns, masks=()):
    return {RESULT: _protection(ns, columns, masks=masks)}


def _mask_on(column):
    return f"ALTER TABLE `main`.`inspire`.`churn_out` ALTER COLUMN `{column}` SET MASK {HIDE}"


def _plan(ns, columns, cells, masks=()):
    return ns["implement_protection_plan"](_sources(ns), _result(ns, columns, masks), (), "\n\n".join(cells), cells,
                                           owned_schema="main.inspire")


def test_a_renamed_masked_column_in_python_carries_the_mask(agent_ns):
    cells = ["df = spark.table('main.s.orders_v2').select(F.col('email').alias('contact'), 'owner', 'amount')\n"
             "df.write.saveAsTable('main.inspire.churn_out')"]
    plan = _plan(agent_ns, ["owner", "contact", "amount"], cells)
    assert plan["refuse"] == []
    assert plan["apply"] == [_mask_on("contact")]
    assert plan["traced"] == ["main.inspire.churn_out.contact"]


def test_sql_alias_concat_and_cast_carry_the_mask_and_a_count_does_not(agent_ns):
    cells = ["%sql\nCREATE OR REPLACE TABLE main.inspire.churn_out AS SELECT owner, CONCAT(email, '-', owner) AS contact_key, "
             "CAST(email AS STRING) AS e2, COUNT(email) AS n_emails, SUM(amount) AS amount FROM main.s.orders_v2 GROUP BY owner, email"]
    plan = _plan(agent_ns, ["owner", "contact_key", "e2", "n_emails", "amount"], cells)
    assert plan["refuse"] == []
    assert sorted(plan["apply"]) == sorted([_mask_on("contact_key"), _mask_on("e2")])
    assert _mask_on("n_emails") not in plan["apply"] and _mask_on("amount") not in plan["apply"], "counts and plain columns stay"


def test_lineage_follows_chained_python_steps_and_spark_sql_strings(agent_ns):
    cells = ["a = src.withColumn('contact', F.concat(F.col('email'), F.lit('x')))",
             "b = a.withColumnRenamed('contact', 'c2')",
             "spark.sql(f\"CREATE OR REPLACE TABLE {OUT} AS SELECT upper(c2) AS shown, owner FROM b\")"]
    lineage, unknown = agent_ns["implement_column_lineage"](cells, ["email"])
    assert unknown == []
    assert {name for name, roots in lineage.items() if "email" in roots} == {"email", "contact", "c2", "shown"}
    plan = _plan(agent_ns, ["shown", "owner"], cells)
    assert plan["apply"] == [_mask_on("shown")] and plan["refuse"] == []


def test_unknown_lineage_over_a_masked_column_refuses_the_publish(agent_ns):
    for cells in (["%sql\nSELECT email AS FROM WHERE ((("],
                  ["df = spark.table('main.s.orders_v2').select('email', 'owner').toDF('who', 'owner')"],
                  ["df = spark.table('main.s.orders_v2'\nprint('email'"]):
        plan = _plan(agent_ns, ["owner", "who"], cells)
        assert any(r.startswith("Inspire could not trace where the notebook puts email") for r in plan["refuse"]), cells
        assert "Make each result a view over its sources" in agent_ns["implement_protection_refusal"](plan)


def test_a_traced_column_already_masked_differently_is_refused_and_one_without_masked_lineage_is_left_alone(agent_ns):
    cells = ["df = src.select(F.col('email').alias('contact'), F.col('owner').alias('who'))"]
    other = _plan(agent_ns, ["who", "contact"], cells, masks=[("contact", "main.sec.other_mask", None)])
    assert other["refuse"] == ["main.inspire.churn_out.contact already has the mask main.sec.other_mask, not main.sec.hide_email of "
                               "main.s.orders_v2, so it does not hide the value the way its source does"]
    kept = _plan(agent_ns, ["who", "contact"], cells, masks=[("contact", HIDE, None)])
    assert kept["apply"] == [] and kept["refuse"] == []
    lineage, _unknown = agent_ns["implement_column_lineage"](cells, ["email"])
    assert "who" not in lineage, "a column from an unmasked source never takes a mask"


def test_no_masked_source_means_no_lineage_work(agent_ns):
    assert agent_ns["implement_column_lineage"](["df.select(F.col('email').alias('x'))"], []) == ({}, [])
    plan = agent_ns["implement_protection_plan"]({SOURCE: _protection(agent_ns, ["owner"], filters=[(OWN, "owner")])},
                                                 _result(agent_ns, ["owner", "x"]), (), "", ["df.select('owner')"],
                                                 owned_schema="main.inspire")
    assert plan["traced"] == []


def _discover(ns, protections):
    obj = make_inspire(ns)
    obj.logger = CapturingLogger()
    reads = []

    def read(tables, warnings, *args):
        reads.extend(tables)
        return {t: protections[t] for t in tables}
    obj._implement_protections = read
    return obj, reads


def test_a_kpi_over_a_row_filtered_table_or_metric_view_is_not_measured_and_shows_withheld(agent_ns):
    ns = agent_ns
    filtered = _protection(ns, ["owner", "amount"], filters=[(OWN, "owner")])
    plain = _protection(ns, ["owner", "amount"])
    unread = ns["implement_protection_unread"]("PERMISSION_DENIED")
    obj, reads = _discover(ns, {"main.s.orders": filtered, "main.s.plain": plain, "main.s.sales_mv": unread})
    measured = []
    obj.deep_evidence = types.SimpleNamespace(max_kpi_baselines=10, measure_kpi=lambda spec: measured.append(spec["query"]) or 5.0)
    obj._ai_gate = lambda: types.SimpleNamespace(share_measures=True)
    ucs = [{"KPIs": [{"name": "Revenue", "computable": True, "query": "SELECT 1", "table": "main.s.orders"},
                     {"name": "Margin", "computable": True, "query": "SELECT 2", "metric_view": "main.s.sales_mv"},
                     {"name": "Units", "computable": True, "query": "SELECT 3", "table": "main.s.plain"}],
            "Expected Key Results": [{"statement": "Grow Revenue from [BASELINE] to [TARGET]", "source": "proposed"}]}]
    stats = obj._measure_kpi_baselines(ucs)
    assert measured == ["SELECT 3"], "only the KPI over an unprotected table is measured"
    assert stats == {"computable": 3, "measured": 1, "unmeasured": 2, "skipped": 0}
    kpis = ucs[0]["KPIs"]
    assert [k["baseline"] for k in kpis[:2]] == [None, None] and kpis[2]["baseline"]["value"] == 5.0
    assert kpis[0]["baseline_withheld"].startswith("main.s.orders has a row filter, and Discover reads it as one person")
    assert kpis[1]["baseline_withheld"].startswith("main.s.sales_mv has row filters, column masks or ABAC policies Inspire could not read")
    obj._fill_baseline_placeholders(ucs[0])
    assert ucs[0]["Expected Key Results"][0]["statement"] == f"Grow Revenue from {ns['KPI_BASELINE_WITHHELD']} to [TARGET]"
    assert sorted(set(reads)) == ["main.s.orders", "main.s.plain", "main.s.sales_mv"] and len(reads) == 3, "read once per table"
    assert any("[KPI-WITHHELD FIRED]" in m for _l, m in obj.logger.records)


def test_the_value_share_skips_a_protected_kpi_and_a_failed_protection_read_withholds(agent_ns):
    ns = agent_ns
    obj, _reads = _discover(ns, {"main.s.orders": _protection(ns, ["owner"], masks=[("owner", HIDE, None)])})
    deep = types.SimpleNamespace(max_kpi_baselines=10, measure_kpi=lambda spec: (_ for _ in ()).throw(AssertionError("measured")))
    spec = {"name": "Revenue", "computable": True, "table": "main.s.orders", "aggregation": "SUM", "column": "amount",
            "filter_column": "owner", "filter_value": "x", "baseline": {"value": 3.0}}
    assert obj._kpi_scope_share(deep, spec, {}) is None
    broken = make_inspire(ns)
    broken.logger = CapturingLogger()
    broken._implement_protections = lambda tables, warnings, *a: (_ for _ in ()).throw(RuntimeError("INTERNAL_ERROR: boom"))
    assert broken._kpi_withheld({"table": "main.s.x"}).startswith("main.s.x has row filters, column masks or ABAC policies")
    assert broken._kpi_withheld({"name": "no table"}) == ""
