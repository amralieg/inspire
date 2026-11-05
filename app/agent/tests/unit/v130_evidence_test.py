"""v1.3.0 evidence layer: Discovery Type Standard never reads customer data; Deep reads aggregates
only, inside DeepEvidence, with PII exclusion, budgets, per-table fallback and Q3 Deep checks."""
import re
import types

import pytest

from v120_artifacts_support import FakeSpark, make_inspire, make_uc


class Row(dict):
    def __getattr__(self, name):
        try:
            return self[name]
        except KeyError as error:
            raise AttributeError(name) from error

    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self.values())[key]
        return dict.__getitem__(self, key)


BUSINESS_DETAILS = [
    ("main", "s", "orders", "order_id", "bigint"),
    ("main", "s", "orders", "customer_id", "bigint"),
    ("main", "s", "orders", "status", "string"),
    ("main", "s", "orders", "order_date", "date"),
    ("main", "s", "customers", "customer_id", "bigint"),
    ("main", "s", "customers", "Email", "string"),
    ("main", "s", "customers", "Segment_Code", "string"),
    ("main", "s", "customers", "tier", "string"),
]


def _loader(tags=None):
    graph = {("main", "s", "orders"): [("main", "s", "orders", "customer_id", "main", "s", "customers", "customer_id")]}
    return types.SimpleNamespace(foreign_key_graph=graph, _column_tags=tags or {},
                                 _lkey=lambda c, s, t: (c.lower(), s.lower(), t.lower()),
                                 metadata_unavailable_report=lambda: {"count": 0, "tables": []})


def _deep_responder(statement):
    if "information_schema" in statement:
        return []
    if "system.access.table_lineage" in statement:
        raise RuntimeError("TABLE_OR_VIEW_NOT_FOUND: system.access.table_lineage")
    if "system.query.history" in statement:
        return [Row(statement_text="SELECT * FROM main.s.orders o JOIN main.s.customers c ON o.customer_id = c.customer_id")]
    if statement.startswith("SELECT COUNT(*) AS n FROM `main`.`s`.`orders`"):
        return [Row(n=1000)]
    if statement.startswith("SELECT COUNT(*) AS n FROM `main`.`s`.`customers`"):
        return [Row(n=50)]
    if statement.startswith("SELECT COUNT(*) AS `__n`"):
        names = re.findall(r"COUNT\(`([^`]+)`\) AS `nn(\d+)`", statement)
        row = Row(__n=100)
        for name, index in names:
            row[f"nn{index}"] = 2 if name == "status" else 100
            row[f"dc{index}"] = 3 if name in ("status", "Segment_Code", "tier", "Email") else 100
        return [row]
    if statement.startswith("SELECT MIN("):
        row = Row()
        for index in re.findall(r"AS `lo(\d+)`", statement):
            row[f"lo{index}"], row[f"hi{index}"] = "2026-01-01", "2026-01-20"
        return [row]
    if " AS v, COUNT(*) AS c FROM " in statement:
        return [Row(v="gold", c=30), Row(v="silver", c=20)]
    if "LEFT JOIN (SELECT DISTINCT" in statement:
        return [Row(n=100, m=2)]
    return []


def _obj(agent_ns, discovery_type, responder, tags=None):
    spark = FakeSpark(responder=responder)
    return make_inspire(agent_ns, spark=spark, discovery_type=discovery_type, data_loader=_loader(tags)), spark


def test_discovery_type_is_canonical_and_defaults_to_standard_discovery(agent_ns):
    canonical = agent_ns["canonical_discovery_type"]
    assert canonical(None) == canonical("") == canonical("  ") == "Standard Discovery"
    assert canonical("standard") == canonical(" STANDARD ") == "Standard Discovery"
    assert canonical("deep") == canonical("AI ENHANCED discovery") == "AI Enhanced Discovery"
    with pytest.raises(ValueError, match="Valid options: 'Standard Discovery', 'AI Enhanced Discovery'"):
        canonical("Shallow")


def test_deep_evidence_reads_in_both_modes_and_its_query_text_needs_no_instance(agent_ns):
    assert agent_ns["DeepEvidence"](FakeSpark(), "Standard", None).discovery_type == "Standard Discovery"
    assert agent_ns["DeepEvidence"](FakeSpark(), "Deep", None).discovery_type == "AI Enhanced Discovery"
    assert agent_ns["DeepEvidence"].kpi_sql({"aggregation": "COUNT", "table": "main.s.orders"}) == \
        "SELECT COUNT(*) AS v FROM `main`.`s`.`orders`", "building the query text needs no instance and reads nothing"


def test_standard_mode_reads_aggregates_and_shares_none_with_the_ai(agent_ns):
    obj, spark = _obj(agent_ns, "Standard", _deep_responder)
    evidence = obj._collect_discovery_evidence(BUSINESS_DETAILS)
    assert obj.deep_evidence is not None and evidence["profiles"]["main.s.orders"]["rows"] == 1000
    access = evidence["data_access"]
    assert access["tables_read_count"] == 2 and access["rows_sent_to_ai"] == 0
    assert access["aggregates_sent_to_ai"] is False
    assert obj._evidence_prompt_block(["main.s.orders"])[0].count("1000") == 0
    results = obj._merge_run_outcome_into_results()
    assert results["discovery_type"] == "Standard Discovery"


def test_deep_mode_profiles_aggregates_and_excludes_pii_values(agent_ns):
    tags = {("main", "s", "customers"): {"Segment_Code": {"class": "PII"}}}
    obj, spark = _obj(agent_ns, "Deep", _deep_responder, tags=tags)
    evidence = obj._collect_discovery_evidence(BUSINESS_DETAILS)
    orders = evidence["profiles"]["main.s.orders"]
    customers = evidence["profiles"]["main.s.customers"]
    assert orders["rows"] == 1000 and orders["columns"]["status"]["null_share"] == pytest.approx(0.98)
    assert orders["columns"]["order_date"]["min"] == "2026-01-01"
    assert "top_values" in customers["columns"]["tier"]
    assert "top_values" not in customers["columns"]["Email"], "name-matched PII never has values read"
    assert "top_values" not in customers["columns"]["Segment_Code"], "tag-matched PII (mixed-case key) is excluded"
    top_value_reads = [s for s in spark.statements if " AS v, COUNT(*) AS c FROM " in s]
    assert not any("`Email`" in s or "`Segment_Code`" in s for s in top_value_reads)
    assert evidence["join_matches"] == [{"child_table": "main.s.orders", "child_column": "customer_id",
                                         "parent_table": "main.s.customers", "parent_column": "customer_id", "rate": 0.02}]
    assert evidence["history_joins"][0]["left"] == "main.s.customers.customer_id"
    access = evidence["data_access"]
    assert access["tables_read"] == ["main.s.customers", "main.s.orders"] and access["rows_sent_to_ai"] == 0
    assert access["pii_columns_excluded"] == 2
    history = next(s for s in spark.statements if "system.query.history" in s)
    assert "LIKE :c0" in history and "ORDER BY start_time DESC" in history
    assert obj.logger.matching("[EVIDENCE FIRED] discovery_type=AI Enhanced Discovery")


def test_deep_mode_never_reads_the_date_range_of_a_personal_column(agent_ns):
    details = BUSINESS_DETAILS + [("main", "s", "customers", "birth_date", "date"),
                                  ("main", "s", "customers", "visit_day", "date")]
    tags = {("main", "s", "customers"): {"visit_day": {"class": "PII"}}}
    obj, spark = _obj(agent_ns, "Deep", _deep_responder, tags=tags)
    evidence = obj._collect_discovery_evidence(details)
    customers = evidence["profiles"]["main.s.customers"]["columns"]
    assert "min" not in customers["birth_date"] and "max" not in customers["birth_date"]
    assert "min" not in customers["visit_day"], "a tag-matched personal date is excluded too"
    assert customers["birth_date"]["null_share"] is not None, "counts are still taken"
    ranges = [s for s in spark.statements if s.startswith("SELECT MIN(")]
    assert not any("`birth_date`" in s or "`visit_day`" in s for s in ranges)
    assert evidence["profiles"]["main.s.orders"]["columns"]["order_date"]["min"] == "2026-01-01"
    assert evidence["data_access"]["pii_columns_excluded"] == 3


def test_deep_mode_denied_table_stays_standard(agent_ns):
    def responder(statement):
        if statement.startswith("SELECT COUNT(*) AS n FROM `main`.`s`.`customers`"):
            raise RuntimeError("PERMISSION_DENIED: User does not have SELECT on Table 'main.s.customers'")
        return _deep_responder(statement)
    obj, _spark = _obj(agent_ns, "Deep", responder)
    evidence = obj._collect_discovery_evidence(BUSINESS_DETAILS)
    assert "main.s.customers" not in evidence["profiles"] and "main.s.orders" in evidence["profiles"]
    assert evidence["data_access"]["tables_skipped"] == {"main.s.customers": "denied"}
    assert obj.logger.matching("[DEEP-EVIDENCE SKIPPED] main.s.customers: denied", level="WARNING")


def test_deep_budget_spent_stops_reading(agent_ns):
    obj, spark = _obj(agent_ns, "Deep", _deep_responder)
    runtime = dict(agent_ns["TECHNICAL_CONTEXT"]["runtime"], deep_evidence_budget_seconds=0)
    deep = agent_ns["DeepEvidence"](spark, "Deep", obj.logger, runtime=runtime)
    with pytest.raises(agent_ns["DeepEvidenceBudgetSpent"]):
        deep.profile_table("`main`.`s`.`orders`", "main.s.orders", [("status", "string")])
    assert spark.statements == []


def test_kpi_sql_builder_accepts_only_whitelisted_aggregates_and_quotes_everything(agent_ns):
    build = agent_ns["DeepEvidence"].kpi_sql
    spec = {"aggregation": "avg", "table": "main.s.orders", "column": "amount"}
    assert build(spec) == "SELECT CAST(AVG(`amount`) AS DOUBLE) AS v FROM `main`.`s`.`orders`"
    assert build(dict(spec, aggregation="count distinct", column="customer_id")) == \
        "SELECT COUNT(DISTINCT `customer_id`) AS v FROM `main`.`s`.`orders`"
    assert build(dict(spec, aggregation="SUM", column="x` FROM secret.t --")) == \
        "SELECT CAST(SUM(`x`` FROM secret.t --`) AS DOUBLE) AS v FROM `main`.`s`.`orders`"
    assert build(dict(spec, filter_column="status", filter_value="it's", time_column="order_date", window_days=90)) == \
        ("SELECT CAST(AVG(`amount`) AS DOUBLE) AS v FROM `main`.`s`.`orders` WHERE `status` = 'it\\'s' AND "
         "`order_date` >= LEAST(current_date(), (SELECT CAST(MAX(`order_date`) AS DATE) FROM `main`.`s`.`orders`)) - INTERVAL 90 DAYS")
    assert build({"aggregation": "COUNT", "table": "main.s.orders"}) == "SELECT COUNT(*) AS v FROM `main`.`s`.`orders`"
    assert build({"metric_view": "main.s.mv_sales", "measure": "Total Revenue"}) == \
        "SELECT CAST(MEASURE(`Total Revenue`) AS DOUBLE) AS v FROM `main`.`s`.`mv_sales`"
    for bad in ("DROP", "SUM(1); DROP TABLE x", ""):
        with pytest.raises(ValueError):
            build(dict(spec, aggregation=bad))
    for aggregate, column in (("MAX", "birth_date"), ("MIN", "customer_email"), ("max", "store_latitude")):
        with pytest.raises(ValueError, match="personal column"):
            build(dict(spec, aggregation=aggregate, column=column))
    assert build(dict(spec, aggregation="COUNT_DISTINCT", column="customer_email")) == \
        "SELECT COUNT(DISTINCT `customer_email`) AS v FROM `main`.`s`.`orders`"
    with pytest.raises(ValueError, match="needs a column"):
        build({"aggregation": "SUM", "table": "main.s.orders"})
    ratio = dict(spec, aggregation="SUM", column="amount", filter_column="status", filter_value="it's",
                 denominator={"aggregation": "count", "column": None, "filter_column": None, "filter_value": None},
                 time_column="order_date", window_days=30)
    assert build(ratio) == ("SELECT CAST(SUM(`amount`) FILTER (WHERE `status` = 'it\\'s') AS DOUBLE) / "
                            "NULLIF(CAST(COUNT(*) AS DOUBLE), 0) AS v FROM `main`.`s`.`orders` "
                            "WHERE `order_date` >= LEAST(current_date(), (SELECT CAST(MAX(`order_date`) AS DATE) FROM `main`.`s`.`orders`)) - INTERVAL 30 DAYS")
    assert build(dict(ratio, unit="%")).endswith("0) * 100 AS v FROM `main`.`s`.`orders` WHERE `order_date` >= LEAST(current_date(), (SELECT CAST(MAX(`order_date`) AS DATE) FROM `main`.`s`.`orders`)) - INTERVAL 30 DAYS")
    for denominator in ({"aggregation": "MAX", "column": "birth_date"}, {"aggregation": "DROP", "column": "amount"},
                        {"aggregation": "SUM", "column": None}):
        with pytest.raises(ValueError):
            build(dict(ratio, denominator=denominator))


def test_measure_kpi_runs_only_the_builder_sql_in_deep(agent_ns):
    spark = FakeSpark(responder=lambda statement: [Row(v=12.5)])
    deep = agent_ns["DeepEvidence"](spark, "Deep", make_inspire(agent_ns).logger)
    assert deep.measure_kpi({"aggregation": "AVG", "table": "main.s.orders", "column": "amount"}) == 12.5
    assert spark.statements == ["SELECT (SELECT CAST(AVG(`amount`) AS DOUBLE) AS v FROM `main`.`s`.`orders`) AS v, "
                                "(SELECT COUNT(*) AS v FROM `main`.`s`.`orders`) AS n"]
    assert deep.summary()["tables_read"] == ["main.s.orders"]


def test_deep_budget_counts_read_time_not_wall_time(agent_ns, monkeypatch):
    spark = FakeSpark(responder=lambda statement: [Row(v=1)])
    deep = agent_ns["DeepEvidence"](spark, "Deep", make_inspire(agent_ns).logger)
    real_time = agent_ns["time"].time
    monkeypatch.setattr(agent_ns["time"], "time", lambda: real_time() + 86400)
    assert deep.budget_left() == deep.budget_seconds, "a day later the unspent budget is still all there"
    monkeypatch.undo()
    deep.measure_kpi({"aggregation": "COUNT", "table": "main.s.orders"})
    assert 0 <= deep.spent_seconds < 5 and deep.budget_left() == deep.budget_seconds - deep.spent_seconds
    deep.spent_seconds = deep.budget_seconds
    with pytest.raises(agent_ns["DeepEvidenceBudgetSpent"]):
        deep.measure_kpi({"aggregation": "COUNT", "table": "main.s.orders"})


def test_quote_identifier_escapes_inner_backticks(agent_ns):
    quote = agent_ns["quote_identifier"]
    assert quote("my-schema") == quote("`my-schema`") == "`my-schema`"
    assert quote("a`b") == "`a``b`"
    assert agent_ns["quote_qualified_name"]("`a`.b.__c") == "`a`.`b`.`__c`"


def test_history_join_mining_returns_edges_only_between_known_tables(agent_ns):
    mine = agent_ns["mine_history_join_edges"]
    statements = [
        "SELECT * FROM main.s.orders AS o JOIN main.s.customers c ON o.customer_id = c.customer_id",
        "select 1 from `main`.`s`.`orders` o join main.s.customers cu on cu.customer_id = o.customer_id where o.x = 'secret'",
        "SELECT * FROM main.s.orders o JOIN other.x.unknown u ON o.id = u.id",
        "SELECT * FROM main.s.orders o WHERE o.a = o.b",
    ]
    edges = mine(statements, ["main.s.orders", "main.s.customers"])
    assert edges == [{"left": "main.s.customers.customer_id", "right": "main.s.orders.customer_id", "count": 2}]
    assert "secret" not in repr(edges)
    assert mine([], ["main.s.orders"]) == []


def test_usage_signals_report_unavailable_with_reason(agent_ns):
    def responder(statement):
        raise RuntimeError("TABLE_OR_VIEW_NOT_FOUND: system.access.table_lineage")
    obj = make_inspire(agent_ns)
    usage = agent_ns["collect_usage_signals"](FakeSpark(responder=responder), ["main.s.orders"], obj.logger)
    assert usage["available"] is False and "TABLE_OR_VIEW_NOT_FOUND" in usage["reason"]
    assert agent_ns["collect_usage_signals"](FakeSpark(), [], obj.logger)["reason"] == "no tables"


def test_usage_election_keeps_heavily_read_master_tables_only(agent_ns):
    obj = make_inspire(agent_ns)
    business = [("main", "s", t, "c", "string") for t in ("a", "b", "c", "d")]
    master = [("main", "s", "c", "c", "string"), ("main", "s", "d", "c", "string")]
    obj.discovery_evidence = {"usage": {"available": True, "reads": {"main.s.a": 5, "main.s.b": 1, "main.s.c": 90,
                                                                      "main.s.d": 0}}}
    assert obj._usage_kept_master_details(master, business) == [("main", "s", "c", "c", "string")]
    assert obj.logger.matching("[USAGE-ELECTION FIRED] kept 1")
    obj.discovery_evidence = {"usage": {"available": False, "reads": {}}}
    assert obj._usage_kept_master_details(master, business) == []


def test_evidence_prompt_block_is_scoped_to_the_batch(agent_ns):
    obj = make_inspire(agent_ns, discovery_type="AI Enhanced Discovery")
    assert obj._evidence_prompt_block(["main.s.orders"]) == ("", [])
    obj.discovery_evidence = {
        "usage": {"reads": {"main.s.orders": 40}, "readers": {"main.s.orders": 3},
                  "co_used": [{"left": "main.s.customers", "right": "main.s.orders", "runs": 7}]},
        "profiles": {"main.s.orders": {"rows": 1000, "columns": {
            "order_date": {"null_share": 0.0, "min": "2025-01-01", "max": "2026-01-01"},
            "promo_code": {"null_share": 0.99},
            "status": {"null_share": 0.0, "top_values": [{"value": "shipped", "share": 0.7}]}}},
            "main.s.hidden": {"rows": 5, "columns": {}}},
        "join_matches": [{"child_table": "main.s.orders", "child_column": "customer_id", "parent_table": "main.s.customers",
                          "parent_column": "customer_id", "rate": 0.97}],
        "history_joins": [{"left": "main.s.orders.customer_id", "right": "main.s.customers.customer_id", "count": 4}],
        "metric_views": [{"fqn": "main.s.mv", "source": "main.s.orders", "measures": [{"name": "revenue", "expr": "SUM(x)"}]}],
    }
    block, joins = obj._evidence_prompt_block(["main.s.orders", "main.s.customers"])
    assert "### DATA EVIDENCE" in block and "read 40 times by 3 principals" in block
    assert "`order_date` spans 2025-01-01 to 2026-01-01" in block and "`promo_code` is 99% null" in block
    assert "`status` values: shipped 70%" in block and "measures: revenue" in block
    assert "main.s.hidden" not in block, "tables outside the batch never leak into the prompt"
    assert any(j.startswith("[MEASURED JOIN]") and "97%" in j for j in joins)
    assert any(j.startswith("[OBSERVED JOIN]") for j in joins) and any(j.startswith("[OBSERVED CO-USE]") for j in joins)
    block_only_orders, joins_only_orders = obj._evidence_prompt_block(["main.s.orders"])
    assert joins_only_orders == []


def _q3_obj(agent_ns, profiles, join_matches=()):
    obj = make_inspire(agent_ns)
    obj.discovery_evidence = {"profiles": profiles, "join_matches": list(join_matches)}
    obj._grounded_column_mentions = lambda text, cols: [c for c in ("amount", "promo_code", "order_date")
                                                        if c in str(text)]
    return obj


def test_q3_deep_drops_empty_primary_and_broken_joins(agent_ns):
    obj = _q3_obj(agent_ns, {"main.s.orders": {"rows": 0, "columns": {}}})
    uc = make_uc("N01-U01")
    assert obj._q3_deep_evidence_reason(uc, ["main.s.orders"], "Forecasting", "amount", {}) == \
        "Q3_R20_EMPTY_PRIMARY_TABLE:main.s.orders"
    match = {"child_table": "main.s.orders", "child_column": "customer_id", "parent_table": "main.s.customers",
             "parent_column": "customer_id", "rate": 0.01}
    obj = _q3_obj(agent_ns, {"main.s.orders": {"rows": 10, "columns": {}}}, [match])
    reason = obj._q3_deep_evidence_reason(uc, ["main.s.orders", "main.s.customers"], "Segmentation",
                                          "join on customer_id", {})
    assert reason.startswith("Q3_R21_JOIN_MATCH_TOO_LOW:main.s.orders.customer_id")
    healthy = dict(match, rate=0.9)
    obj = _q3_obj(agent_ns, {"main.s.orders": {"rows": 10, "columns": {}}}, [healthy])
    assert obj._q3_deep_evidence_reason(uc, ["main.s.orders", "main.s.customers"], "Segmentation",
                                        "join on customer_id", {}) is None


def test_q3_deep_keeps_sparse_but_real_signals_and_drops_empty_ones(agent_ns):
    sparse = {"main.s.orders": {"rows": 1_000_000, "columns": {"promo_code": {"null_share": 0.97}}}}
    obj = _q3_obj(agent_ns, sparse)
    uc = make_uc("N01-U02")
    assert obj._q3_deep_evidence_reason(uc, ["main.s.orders"], "Classification", "uses promo_code", {}) is None
    assert "Q3_R22_MOSTLY_NULL_SIGNAL:promo_code" in uc.get("gate_flags", set())
    empty = {"main.s.orders": {"rows": 1000, "columns": {"promo_code": {"null_share": 0.99}}}}
    obj = _q3_obj(agent_ns, empty)
    assert obj._q3_deep_evidence_reason(make_uc("N01-U03"), ["main.s.orders"], "Classification",
                                        "uses promo_code", {}) == "Q3_R22_KEY_SIGNAL_EMPTY:promo_code=10"


def test_q3_deep_flags_thin_time_coverage_and_skips_without_evidence(agent_ns):
    profiles = {"main.s.orders": {"rows": 500, "columns": {"order_date": {"null_share": 0.0, "min": "2026-01-01",
                                                                           "max": "2026-01-20"}}}}
    obj = _q3_obj(agent_ns, profiles)
    uc = make_uc("N01-U04")
    temporal = next(iter(obj._TEMPORAL_FAMILIES))
    assert obj._q3_deep_evidence_reason(uc, ["main.s.orders"], temporal, "order_date", {}) is None
    assert "Q3_R23_THIN_TIME_COVERAGE:19_days" in uc.get("gate_flags", set())
    obj.discovery_evidence = {}
    assert obj._q3_deep_evidence_reason(make_uc("N01-U05"), ["main.s.orders"], temporal, "order_date", {}) is None


def test_q3_deep_drops_a_single_class_label_and_flags_constant_features(agent_ns):
    def obj_with(columns):
        obj = make_inspire(agent_ns)
        obj.discovery_evidence = {"profiles": {"main.s.customers": {"rows": 5000, "columns": columns}}}
        obj._grounded_column_mentions = lambda text, cols: list(columns)
        return obj
    single = {"loyalty_tier": {"null_share": 0.0, "distinct": 1, "type_family": "string"},
              "spend": {"null_share": 0.0, "distinct": 900, "type_family": "numeric"}}
    uc = make_uc("N02-U01", Name="Classify Customers by Loyalty Tier")
    assert obj_with(single)._q3_deep_evidence_reason(uc, ["main.s.customers"], "classification", "x", {}) == \
        "Q3_R24_SINGLE_CLASS_LABEL:loyalty_tier"
    two_classes = dict(single, loyalty_tier={"null_share": 0.0, "distinct": 2, "type_family": "string"})
    assert obj_with(two_classes)._q3_deep_evidence_reason(make_uc("N02-U02", Name="Classify Customers by Loyalty Tier"),
                                                          ["main.s.customers"], "classification", "x", {}) is None
    constant_feature = {"is_churned": {"null_share": 0.0, "distinct": 2, "type_family": "boolean"},
                        "region": {"null_share": 0.0, "distinct": 1, "type_family": "string"}}
    uc = make_uc("N02-U03", Name="Predict Churned Customers")
    assert obj_with(constant_feature)._q3_deep_evidence_reason(uc, ["main.s.customers"], "classification", "x", {}) is None
    assert uc["gate_flags"] == ["Q3_R24_CONSTANT_COLUMN:region"]
    uc = make_uc("N02-U04", Name="Classify Customers by Loyalty Tier")
    assert obj_with(single)._q3_deep_evidence_reason(uc, ["main.s.customers"], "clustering", "x", {}) is None


def test_deep_results_json_reports_the_live_summary(agent_ns):
    obj, _spark = _obj(agent_ns, "Deep", _deep_responder)
    obj._collect_discovery_evidence(BUSINESS_DETAILS)
    results = obj._merge_run_outcome_into_results()
    assert results["discovery_type"] == "AI Enhanced Discovery"
    assert results["data_access"]["tables_read_count"] == 2 and results["data_access"]["rows_sent_to_ai"] == 0
    assert results["usage_signals"]["available"] is False
