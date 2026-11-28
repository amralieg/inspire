"""REQ-573 R13.1, R13.2: deep calculation on the shortlist, one shared GROUPING SETS scan per pool table.

- R13.1: for each shortlisted use case Discover measures the pool by month over 12-24 months (trend, seasonality, annualisation);
  the eligible population, deciles and the top-10% share; the pool split by 2-3 master attributes; the outcome rate and how much it
  varies by segment and month; the internal benchmark gap (worse segments vs the median or best quartile), labelled descriptive;
  the assumption that moves the result most; row-level overlap with the other shortlisted use cases; readiness (history length,
  nulls in key columns, freshness).
- R13.2: one GROUPING SETS scan per pool table serves every use case built on that table; cards are delivered as each finishes.
- R9.3: a missing measure is unknown, never zero; amounts in different currencies are never added together.
- R12.8: a timed-out scan is missing evidence, never a sample.

Industry-agnostic: neutral table and column names; segment, currency and entity columns come from metadata.

The surface (brief: ~/claude/inspire/briefs/a04_deep_calc.md):
- inspire_deep_scan_plan(use_cases, metadata) -> {"plans": [one per pool table], "unplanned": [{"No", "reason"}]} (pure);
- inspire_deep_scan_sql(plan, scopes=None) -> ONE read-only statement with GROUPING SETS that reads the table once (pure);
- inspire_deep_scan_parse(plan, rows, today) -> {No: card} from the scan's long-format rows (pure);
- inspire_deep_sensitivity(value_spec) -> the assumption that moves inspire_value_calculate most (pure);
- DeepEvidence.deep_calculate(plans, on_card, today, scopes=None, concurrency=None) -> {"cards", "skipped"} (reads via _read only);
- DatabricksInspire._deep_calculate_shortlist(use_cases, details) and its run() call site after Selection;
- the measured value estimate keeps the spec it priced as "value_spec"; runtime key deep_scan_concurrency = 4.

GROUPING SETS has no sqlite form, so the SQL is checked on its parsed structure (sqlglot, databricks dialect) and the parser runs
on canned rows in the contract's long format (SCAN_COLUMNS). The SQL fake is the loss-pools one: a DeepEvidence stub whose _read
records each statement and answers canned rows per table."""
import datetime
import statistics
import threading
import time
import types

import sqlglot
from sqlglot import exp

from _nbload import AGENT_NB, code_cells
from v120_artifacts_support import CapturingLogger, make_inspire, make_uc
from v201_money_value_test import estimate_of, kpi, money_uc, ns  # noqa: F401  (the shared fixture)

ORDERS, TICKETS = "c.s.orders", "c.s.tickets"
TODAY = datetime.date(2026, 11, 28)
# The long-format row contract of one scan (every key the parser reads; the SQL's output columns).
SCAN_COLUMNS = ("grouping_set", "uc", "other_uc", "currency", "month", "segment_column", "segment_value", "decile", "rows",
                "outcome_rows", "measured_rows", "pool", "entities", "first_day", "last_day", "null_entity")
GROUPING_SET_NAMES = ("total", "month", "segment", "decile", "overlap")

SCHEMA = {
    "orders": [("order_id", "STRING"), ("customer_id", "STRING"), ("order_date", "DATE"), ("currency_code", "STRING"),
               ("order_status", "STRING"), ("region", "STRING"), ("channel", "STRING"), ("notes_text", "STRING"),
               ("order_amount", "DOUBLE"), ("discount_amount", "DOUBLE")],
    "tickets": [("ticket_id", "STRING"), ("account_id", "STRING"), ("opened_at", "TIMESTAMP"), ("queue", "STRING"),
                ("priority", "STRING"), ("severity", "STRING"), ("handling_cost", "DOUBLE")],
}


def _metadata(*names):
    return {f"c.s.{name}": {"columns": {col: {"type": typ, "comment": ""} for col, typ in SCHEMA[name]}} for name in names}


def _details(*names):
    return [("c", "s", name, col, typ, "") for name in names for col, typ in SCHEMA[name]]


def _kpi(name, table, column, **extra):
    spec = {"name": name, "unit": "EUR", "direction": "decrease", "aggregation": "SUM", "table": table, "column": column,
            "computable": True, "query": f"SELECT SUM({column}) FROM {table}", "window_days": 365}
    spec.update(extra)
    return spec


K_CANCELLED = _kpi("Cancelled order value", ORDERS, "order_amount", filter_column="order_status", filter_value="cancelled",
                   time_column="order_date", grain_key="order_id")
K_DISCOUNT = _kpi("Discount given", ORDERS, "discount_amount", time_column="order_date", grain_key="order_id")
K_HANDLING = _kpi("Ticket handling cost", TICKETS, "handling_cost", time_column="opened_at", grain_key="ticket_id")


def _uc(no, *kpis, **extra):
    return make_uc(no, KPIs=list(kpis), **{"Tables Involved": ", ".join(sorted({k["table"] for k in kpis})) or "c.s.orders", **extra})


def _plan(table=ORDERS, ucs=None, entity="customer_id", currency="currency_code", segments=("region", "channel")):
    ucs = ucs if ucs is not None else [("U1", K_CANCELLED, None), ("U2", K_DISCOUNT, None)]
    return {"table": table, "scan_id": f"ds_{table.split('.')[-1]}", "time_column": "order_date", "currency_column": currency,
            "entity_column": entity, "segment_columns": list(segments), "window_days": 730,
            "use_cases": [{"No": no, "kpi": spec, "direction": spec.get("direction", "decrease"), "value_spec": vspec}
                          for no, spec, vspec in ucs]}


def r(grouping_set, uc, **values):
    row = dict.fromkeys(SCAN_COLUMNS)
    row.update(grouping_set=grouping_set, uc=uc, **values)
    return row


def months(n, last=(2026, 10)):
    year, month = last
    out = []
    for _ in range(n):
        out.append(f"{year:04d}-{month:02d}-01")
        year, month = (year, month - 1) if month > 1 else (year - 1, 12)
    return list(reversed(out))


def month_rows(uc, pools, currency="EUR", rows=100, outcome_rows=None, last=(2026, 10)):
    return [r("month", uc, currency=currency, month=m, pool=p, rows=rows, outcome_rows=rows if outcome_rows is None else outcome_rows,
              measured_rows=0 if p is None else (rows if outcome_rows is None else outcome_rows))
            for m, p in zip(months(len(pools), last), pools)]


def total_row(uc, pool, currency="EUR", rows=400, outcome_rows=400, measured_rows=400, entities=40, first_day="2025-10-03",
              last_day="2026-10-31", null_entity=0):
    return r("total", uc, currency=currency, pool=pool, rows=rows, outcome_rows=outcome_rows, measured_rows=measured_rows,
             entities=entities, first_day=first_day, last_day=last_day, null_entity=null_entity)


def fn(ns, name):
    found = ns.get(name)
    assert callable(found), f"R13.1/R13.2: the notebook defines no {name}"
    return found


def deep_fn(ns, name):
    found = getattr(ns["DeepEvidence"], name, None)
    assert callable(found), f"R13.2: DeepEvidence has no {name}"
    return found


def parse(ns, plan, rows, today=TODAY):
    return fn(ns, "inspire_deep_scan_parse")(plan, rows, today)


def block(card, currency="EUR"):
    found = [item for item in card["currencies"] if item["currency"] == currency]
    assert len(found) == 1, f"one block per currency, got {[item['currency'] for item in card['currencies']]}"
    return found[0]


def numbers(value):
    if isinstance(value, bool):
        return
    if isinstance(value, (int, float)):
        yield float(value)
    elif isinstance(value, dict):
        for item in value.values():
            yield from numbers(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            yield from numbers(item)


class _Deep:
    """The DeepEvidence SQL stub: _read records each statement and answers canned rows per table (or raises for `errors`)."""

    def __init__(self, answers, errors=None, policied=(), before_read=None):
        self.answers, self.errors, self.policied, self.before_read = answers, errors or {}, set(policied), before_read
        self.metric_views, self.reads, self.statements = set(), [], []
        self.logger = CapturingLogger()
        self._lock = threading.Lock()
        self.statement_timeout_seconds, self.budget_seconds, self.signal_budget_seconds = 120.0, 600.0, 600.0
        self.spent_seconds = self.signal_spent_seconds = 0.0

    def budget_left(self, budget="evidence"):
        return 600.0

    def is_policied(self, table):
        return str(table).replace("`", "").lower() in self.policied

    def is_metric_view(self, table):
        return False

    def _plain_table(self, table):
        return None

    def _read(self, kind, table, sql, args=None, budget="evidence", scopes=None):
        with self._lock:
            self.reads.append((kind, table, sql))
        if self.before_read is not None:
            self.before_read(table)
        if table in self.errors:
            raise self.errors[table]
        return [dict(row) for row in self.answers.get(table, [])]


def _timeout(ns):
    return ns["SparkWorkTimeout"]("DeepEvidence deep_scan", 120.0, 120.0, "deep_evidence_1")


def _std_rows(no, pool=1000.0, currency="EUR"):
    return [total_row(no, pool, currency=currency)] + month_rows(no, [pool / 13] * 13, currency)


def _deep_calculate(ns, deep, plans, **kwargs):
    delivered = []
    out = deep_fn(ns, "deep_calculate")(deep, plans, delivered.append, today=TODAY, **kwargs)
    return out, delivered


def _sensitivity_spec(effect=(0.01, 0.02, 0.03), adoption=(0.2, 0.5, 0.9)):
    return {"mechanism": "cost", "currency": "EUR", "flow_or_stock": "flow", "horizon_years": 1,
            "measured": {"exposure": 1_000_000.0, "period_days": 365},
            "sourced": {"effect": dict(zip(("low", "base", "high"), effect), source="exploratory"),
                        "adoption": dict(zip(("low", "base", "high"), adoption), source="exploratory")}}


# --- R13.2: one scan per pool table ---

def test_1_one_plan_per_pool_table_serves_every_shortlisted_use_case(ns):
    ucs = [_uc("U1", K_CANCELLED), _uc("U2", K_DISCOUNT), _uc("U3", K_HANDLING), _uc("U4")]
    out = fn(ns, "inspire_deep_scan_plan")(ucs, _metadata("orders", "tickets"))
    plans = {plan["table"]: plan for plan in out["plans"]}
    assert set(plans) == {ORDERS, TICKETS}, "one plan per pool table, never one per use case"
    orders = plans[ORDERS]
    assert [item["No"] for item in orders["use_cases"]] == ["U1", "U2"], orders["use_cases"]
    assert orders["use_cases"][0]["kpi"]["column"] == "order_amount", "the plan keeps each use case's pool KPI"
    assert [item["No"] for item in plans[TICKETS]["use_cases"]] == ["U3"]
    assert orders["time_column"] == "order_date" and orders["currency_column"] == "currency_code", orders
    assert orders["entity_column"] == "customer_id", "the entity is the first key-like column that is not the grain key or the row id"
    assert set(orders["segment_columns"]) == {"region", "channel"}, \
        f"2-3 master attributes, never a key, the currency, the outcome filter column or free text: {orders['segment_columns']}"
    assert 2 <= len(plans[TICKETS]["segment_columns"]) <= 3, plans[TICKETS]["segment_columns"]
    assert orders["window_days"] == 730, "the pool by month reaches back up to 24 months"
    assert plans[TICKETS]["currency_column"] is None, "a table with no currency column has none; the currency is never assumed"
    assert out["unplanned"] == [{"No": "U4", "reason": "no_pool_kpi"}], out["unplanned"]


def test_2_the_scan_is_one_read_only_grouping_sets_statement_that_reads_the_table_once(ns):
    sql = fn(ns, "inspire_deep_scan_sql")(_plan())
    trees = sqlglot.parse(sql, read="databricks")
    assert len(trees) == 1, "R13.2: one statement per pool table"
    tree = trees[0]
    assert isinstance(tree, (exp.Select, exp.Union)), f"read-only: a SELECT, got {type(tree).__name__}"
    for kind in (exp.Insert, exp.Update, exp.Delete, exp.Merge, exp.Create, exp.Drop):
        assert tree.find(kind) is None, f"read-only: no {kind.__name__}"
    assert tree.find(exp.GroupingSets) is not None, "R13.2: the measures come from one GROUPING SETS aggregate"
    ctes = {cte.alias_or_name.lower() for cte in tree.find_all(exp.CTE)}
    scans, anchors = [], []
    for table in tree.find_all(exp.Table):
        name = ".".join(part for part in (table.catalog, table.db, table.name) if part).lower()
        if name in ctes:
            continue
        owner = table.find_ancestor(exp.Select)
        anchor = owner is not None and len(owner.expressions) == 1 and owner.expressions[0].find(exp.Max) is not None \
            and owner.find(exp.GroupingSets) is None
        (anchors if anchor else scans).append(name)
    assert scans == [ORDERS], f"the pool table is scanned exactly once and nothing else is read: {scans}"
    assert anchors in ([], [ORDERS]), f"at most the one MAX(date) window anchor of _kpi_window_conditions: {anchors}"
    assert tree.find(exp.Limit) is None and tree.find(exp.TableSample) is None, "R12.8: never LIMIT or a sample"


def test_3_the_one_scan_carries_every_use_case_on_the_table_and_the_contract_columns(ns):
    plan = _plan()
    sql = fn(ns, "inspire_deep_scan_sql")(plan)
    tree = sqlglot.parse_one(sql, read="databricks")
    literals = {lit.this for lit in tree.find_all(exp.Literal) if lit.is_string}
    assert {"U1", "U2"} <= literals, "every shortlisted use case on the table is served by this one scan"
    assert set(GROUPING_SET_NAMES) <= literals, f"grouping_set labels: {sorted(set(GROUPING_SET_NAMES) - literals)} missing"
    assert ns["kpi_filter_sql"](K_CANCELLED) in sql, "each use case's own rows are its KPI filter, reused from kpi_filter_sql"
    assert set(SCAN_COLUMNS) <= set(tree.named_selects), f"missing output columns: {sorted(set(SCAN_COLUMNS) - set(tree.named_selects))}"
    window = ns["DeepEvidence"]._kpi_window_conditions({"time_column": "order_date", "window_days": 730},
                                                       ns["inspire_scoped_read_source"](ORDERS, None))[0]
    assert window in sql, "the 24-month window reuses DeepEvidence._kpi_window_conditions"
    assert "NTILE(10)" in sql.upper().replace(" ", ""), "deciles of the per-entity pool come from NTILE(10)"


def test_4_n_use_cases_on_one_table_cost_one_read(ns):
    plans = [_plan(), _plan(TICKETS, [("U3", K_HANDLING, None)], entity="account_id", currency=None, segments=("queue", "priority"))]
    deep = _Deep({ORDERS: _std_rows("U1") + _std_rows("U2"), TICKETS: _std_rows("U3", currency=None)})
    out, delivered = _deep_calculate(ns, deep, plans)
    assert sorted(table for _kind, table, _sql in deep.reads) == [ORDERS, TICKETS], "one read per pool table"
    assert all(kind == "deep_scan" for kind, _table, _sql in deep.reads), [kind for kind, _t, _s in deep.reads]
    assert sorted(card["No"] for card in delivered) == ["U1", "U2", "U3"], "one card per use case"
    assert all(card["status"] == "ok" for card in delivered), [(c["No"], c["status"]) for c in delivered]
    assert [card["No"] for card in out["cards"]] == [card["No"] for card in delivered] and out["skipped"] == []


# --- R9.3: unknown is not zero, currencies never added ---

def test_5_a_measure_with_only_nulls_is_unknown_never_zero(ns):
    rows = [total_row("U1", 0.0, measured_rows=0, outcome_rows=40), total_row("U2", 0.0, measured_rows=12, outcome_rows=400)]
    rows += month_rows("U1", [None] * 13) + month_rows("U2", [0.0] * 13)
    cards = parse(ns, _plan(), rows)
    missing = block(cards["U1"])
    assert missing["pool"] is None and missing["annualised"] is None, "R9.3: SUM over no measured row is unknown, never 0"
    assert "measure_missing" in missing["flags"], missing["flags"]
    kept = block(cards["U2"])
    assert kept["pool"] == 0.0, "a measured zero stays 0"
    assert "measure_partly_missing" in kept["flags"], "12 of 400 rows measured is partly missing"


def test_6_amounts_in_different_currencies_are_never_added(ns):
    rows = [total_row("U1", 500.0, currency="EUR"), total_row("U1", 700.0, currency="USD"),
            total_row("U2", 10.0, currency="EUR"), total_row("U2", 20.0, currency="USD")]
    rows += month_rows("U1", [500.0 / 13] * 13, "EUR") + month_rows("U1", [700.0 / 13] * 13, "USD")
    card = parse(ns, _plan(), rows)["U1"]
    assert block(card, "EUR")["pool"] == 500.0 and block(card, "USD")["pool"] == 700.0
    assert len(block(card, "EUR")["by_month"]) == 13 and len(block(card, "USD")["by_month"]) == 13
    assert all(abs(number - 1200.0) > 1e-6 for number in numbers(card)), "R9.3: no figure adds EUR and USD"
    no_currency = parse(ns, _plan(currency=None), [r("total", "U1", pool=50.0, rows=10, outcome_rows=10, measured_rows=10)])
    assert [item["currency"] for item in no_currency["U1"]["currencies"]] == [None], "no currency column: the currency is unknown"


# --- R13.1: pool by month, trend, seasonality, annualisation ---

def test_7_under_12_months_is_flagged_short_history_and_makes_no_annual_claim(ns):
    short = block(parse(ns, _plan(), [total_row("U1", 600.0)] + month_rows("U1", [100.0] * 6))["U1"])
    assert short["history_months"] == 6 and short["short_history"] is True and "short_history" in short["flags"]
    assert short["annualised"] is None, "under 12 months there is no annualisation claim"
    pools = [100.0 + 10 * step for step in range(13)]
    full = block(parse(ns, _plan(), [total_row("U1", sum(pools))] + month_rows("U1", pools))["U1"])
    assert full["short_history"] is False and "short_history" not in full["flags"]
    assert full["annualised"] == sum(pools[-12:]), "the annual pool is the last 12 measured months, never an extrapolation"
    assert [item["month"] for item in full["by_month"]] == [m[:7] for m in months(13)], "months in order, as YYYY-MM"
    assert full["trend"]["direction"] == "rising" and full["trend"]["slope_per_month"] > 0, full["trend"]


def test_8_seasonality_needs_24_months_and_a_repeating_peak(ns):
    peaked = [300.0 if m.endswith("-12-01") else 100.0 for m in months(24)]
    assert block(parse(ns, _plan(), [total_row("U1", sum(peaked))] + month_rows("U1", peaked))["U1"])["seasonality"] is True
    flat = [100.0] * 24
    assert block(parse(ns, _plan(), [total_row("U1", 2400.0)] + month_rows("U1", flat))["U1"])["seasonality"] is False
    year = [100.0] * 13
    assert block(parse(ns, _plan(), [total_row("U1", 1300.0)] + month_rows("U1", year))["U1"])["seasonality"] is None, \
        "under 24 months seasonality is unknown, never False"


# --- R13.1: population, deciles, top 10% ---

def test_9_deciles_and_the_top_10_percent_share_are_of_the_pool(ns):
    pools = [50.0, 10.0, 10.0, 5.0, 5.0, 5.0, 5.0, 4.0, 3.0, 3.0]
    deciles = [r("decile", "U1", currency="EUR", decile=d, pool=p, entities=4) for d, p in zip(range(1, 11), pools)]
    deciles = deciles[5:] + deciles[:5]  # the rows come in any order
    out = block(parse(ns, _plan(), [total_row("U1", 100.0, entities=40)] + deciles)["U1"])
    assert out["population"] == 40, "the eligible population is the distinct entities in the use case's rows"
    assert out["deciles"] == [p / 100.0 for p in pools], "decile 1 holds the largest entities"
    assert out["top10_share"] == 0.5, out["top10_share"]
    none = block(parse(ns, _plan(entity=None), [total_row("U1", 100.0, entities=None)])["U1"])
    assert none["population"] is None and none["deciles"] is None and none["top10_share"] is None
    assert "no_entity_column" in none["flags"], none["flags"]


# --- R13.1: segments, outcome rate, benchmark gap ---

def _segment_rows(uc="U1", pools=(100.0, 200.0, 300.0, 600.0), outcome=(5, 10, 10, 15)):
    rows = [r("segment", uc, currency="EUR", segment_column="region", segment_value=v, rows=100, outcome_rows=o, measured_rows=o,
              pool=p) for v, p, o in zip("ABCD", pools, outcome)]
    rows += [r("segment", uc, currency="EUR", segment_column="channel", segment_value=v, rows=200, outcome_rows=20, measured_rows=20,
               pool=600.0) for v in ("web", "store")]
    return rows


def test_10_the_outcome_rate_and_its_spread_by_segment_and_month(ns):
    rows = [total_row("U1", 1200.0, outcome_rows=40, measured_rows=40)] + _segment_rows()
    rows += month_rows("U1", [600.0, 600.0], rows=200, outcome_rows=10)
    rows[-1]["outcome_rows"] = 30
    out = block(parse(ns, _plan(), rows)["U1"])
    assert out["outcome_rate"] == 0.1, "40 of 400 rows are the use case's outcome"
    region = {item["value"]: item for item in out["by_segment"]["region"]}
    assert set(region) == set("ABCD") and region["D"]["outcome_rate"] == 0.15 and region["D"]["pool"] == 600.0
    assert abs(out["outcome_rate_spread"]["segment"]["region"] - 0.10) < 1e-9, out["outcome_rate_spread"]
    assert abs(out["outcome_rate_spread"]["month"] - 0.10) < 1e-9, out["outcome_rate_spread"]
    unfiltered = block(parse(ns, _plan(), [total_row("U2", 50.0)] + _segment_rows("U2"))["U2"])
    assert unfiltered["outcome_rate"] is None, "a use case with no outcome filter has no outcome rate (never 100%)"


def test_11_the_benchmark_gap_is_labelled_descriptive_and_follows_the_kpi_direction(ns):
    rows = [total_row("U1", 1200.0, outcome_rows=40, measured_rows=40)] + _segment_rows()
    region = block(parse(ns, _plan(), rows)["U1"])["benchmark"]["region"]
    per_row = [1.0, 2.0, 3.0, 6.0]
    assert region["label"] == "descriptive", "R13.1: the internal benchmark gap is descriptive, never causal"
    assert region["median"] == statistics.median(per_row) == 2.5
    assert region["best_quartile"] == statistics.quantiles(per_row, n=4, method="inclusive")[0] == 1.75
    assert region["worse_segments"] == ["C", "D"], "lower is better for a decrease KPI: C and D are above the median"
    assert region["gap_to_median"] == 400.0 and region["gap_to_best_quartile"] == 575.0, region
    up = _plan(ucs=[("U1", dict(K_CANCELLED, direction="increase"), None)])
    up["use_cases"][0]["direction"] = "increase"
    rising = block(parse(ns, up, rows)["U1"])["benchmark"]["region"]
    assert rising["worse_segments"] == ["A", "B"] and rising["gap_to_median"] == 200.0 and rising["gap_to_best_quartile"] == 525.0
    channel = block(parse(ns, _plan(), rows)["U1"])["benchmark"]["channel"]
    assert channel == {"label": "descriptive", "reason": "too_few_segments"}, "2 values are too few for a median benchmark"


# --- R13.1: overlap, readiness, sensitivity ---

def test_12_row_level_overlap_between_two_use_cases_on_the_same_rows(ns):
    rows = [total_row("U1", 500.0, outcome_rows=40, measured_rows=40), total_row("U2", 90.0, outcome_rows=400, measured_rows=400),
            r("overlap", "U1", other_uc="U2", outcome_rows=30)]
    cards = parse(ns, _plan(), rows)
    assert cards["U1"]["overlap"] == [{"No": "U2", "rows": 30, "share": 0.75}], cards["U1"]["overlap"]
    assert cards["U2"]["overlap"] == [{"No": "U1", "rows": 30, "share": 0.075}], "overlap is symmetric from one pair row"


def test_13_use_cases_on_other_tables_get_an_overlap_entry_with_its_reason(ns):
    plans = [_plan(), _plan(TICKETS, [("U3", K_HANDLING, None)], entity="account_id", currency=None, segments=("queue", "priority"))]
    deep = _Deep({ORDERS: _std_rows("U1") + _std_rows("U2") + [r("overlap", "U1", other_uc="U2", outcome_rows=5)],
                  TICKETS: _std_rows("U3", currency=None)})
    _out, delivered = _deep_calculate(ns, deep, plans)
    cards = {card["No"]: card for card in delivered}
    assert {"No": "U3", "rows": None, "share": None, "reason": "different_table"} in cards["U1"]["overlap"], cards["U1"]["overlap"]
    assert [item["No"] for item in cards["U3"]["overlap"]] == ["U1", "U2"], cards["U3"]["overlap"]


def test_14_readiness_reports_history_key_column_nulls_and_freshness(ns):
    rows = [total_row("U1", 900.0, outcome_rows=40, measured_rows=36, null_entity=2, first_day="2025-10-03", last_day="2026-10-31")]
    rows += month_rows("U1", [70.0] * 13)
    rows.append(r("segment", "U1", currency="EUR", segment_column="region", segment_value=None, rows=50, outcome_rows=8,
                  measured_rows=8, pool=40.0))
    readiness = parse(ns, _plan(), rows)["U1"]["readiness"]
    assert readiness["history_months"] == 13 and readiness["first_day"] == "2025-10-03" and readiness["last_day"] == "2026-10-31"
    assert readiness["freshness_days"] == 28, "freshness is the days from the last row to today"
    assert readiness["key_column_nulls"] == {"order_amount": 0.1, "customer_id": 0.05, "region": 0.2, "channel": 0.0}, \
        readiness["key_column_nulls"]


def test_15_the_most_sensitive_assumption_is_the_input_that_moves_the_value_most(ns):
    sensitivity = fn(ns, "inspire_deep_sensitivity")
    adoption = sensitivity(_sensitivity_spec())
    assert adoption["assumption"] == "adoption" and abs(adoption["swing"] - 14000.0) < 1e-6, adoption
    effect = sensitivity(_sensitivity_spec(effect=(0.005, 0.02, 0.06)))
    assert effect["assumption"] == "effect" and abs(effect["swing"] - 27500.0) < 1e-6, effect
    assert sensitivity({"mechanism": "cost"}) is None, "an incomplete spec has no sensitivity"
    spec = _sensitivity_spec()
    card = parse(ns, _plan(ucs=[("U1", K_CANCELLED, spec)]), [total_row("U1", 100.0)])["U1"]
    assert card["sensitivity"] == adoption, "each card names the assumption that moves its value most"
    assert parse(ns, _plan(), [total_row("U1", 100.0)])["U1"]["sensitivity"] is None


def test_16_a_measured_value_estimate_keeps_the_spec_it_priced(ns):
    estimate = estimate_of(ns, money_uc(ns, kpi(ns)), "", "predict")
    assert estimate["status"] == "measured", estimate.get("text")
    spec = estimate.get("value_spec")
    assert isinstance(spec, dict), "the deep card reads the value spec the estimate priced"
    assert spec["mechanism"] == "revenue" and spec["measured"]["exposure"] == 29589.0 and "effect" in spec["sourced"], spec
    uc = _uc("U1", K_CANCELLED, **{"Value Estimate": estimate})
    plan = fn(ns, "inspire_deep_scan_plan")([uc], _metadata("orders"))["plans"][0]
    assert plan["use_cases"][0]["value_spec"] == spec, "the plan carries the estimate's value spec to the card"


# --- R13.2: delivery, concurrency, failures ---

def test_17_cards_are_delivered_as_each_table_finishes(ns):
    fast_done = threading.Event()
    plans = [_plan(), _plan(TICKETS, [("U3", K_HANDLING, None)], entity="account_id", currency=None, segments=("queue", "priority"))]

    def before_read(table):
        if table == ORDERS:
            fast_done.wait(5)
    deep = _Deep({ORDERS: _std_rows("U1") + _std_rows("U2"), TICKETS: _std_rows("U3", currency=None)}, before_read=before_read)
    delivered = []

    def on_card(card):
        delivered.append(card["No"])
        if card["No"] == "U3":
            fast_done.set()
    deep_fn(ns, "deep_calculate")(deep, plans, on_card, today=TODAY)
    assert delivered == ["U3", "U1", "U2"], f"the fast table's card arrives first, never held for the slow one: {delivered}"


def test_18_the_scans_run_four_at_a_time(ns):
    assert ns["TECHNICAL_CONTEXT"]["runtime"].get("deep_scan_concurrency") == 4, "concurrency starts at 4 SQL queries"
    active, peak, lock = [0], [0], threading.Lock()
    tables = [f"c.s.t{index}" for index in range(6)]

    def before_read(_table):
        with lock:
            active[0] += 1
            peak[0] = max(peak[0], active[0])
        time.sleep(0.3)
        with lock:
            active[0] -= 1
    plans = [_plan(table, [(f"U{index}", dict(K_DISCOUNT, table=table), None)]) for index, table in enumerate(tables)]
    deep = _Deep({table: _std_rows(f"U{index}") for index, table in enumerate(tables)}, before_read=before_read)
    _out, delivered = _deep_calculate(ns, deep, plans)
    assert len(delivered) == 6 and peak[0] == 4, f"6 scans with at most 4 at once (peak {peak[0]})"


def test_19_a_timeout_on_one_table_leaves_the_others_delivered_and_records_why(ns):
    plans = [_plan(), _plan(TICKETS, [("U3", K_HANDLING, None)], entity="account_id", currency=None, segments=("queue", "priority"))]
    deep = _Deep({ORDERS: _std_rows("U1") + _std_rows("U2"), TICKETS: _std_rows("U3", currency=None)}, errors={ORDERS: _timeout(ns)})
    out, delivered = _deep_calculate(ns, deep, plans)
    cards = {card["No"]: card for card in delivered}
    assert cards["U3"]["status"] == "ok", "the other table's card is still delivered"
    assert cards["U1"]["status"] == "timeout" and cards["U2"]["status"] == "timeout", "R12.8: a timed-out scan is missing evidence"
    assert cards["U1"]["currencies"] == [], "no number from a timed-out scan, never a sampled guess"
    assert {"table": ORDERS, "reason": "timeout", "use_cases": ["U1", "U2"]} in out["skipped"], out["skipped"]
    held = _Deep({ORDERS: _std_rows("U1") + _std_rows("U2"), TICKETS: _std_rows("U3", currency=None)}, policied={ORDERS})
    out, _delivered = _deep_calculate(ns, held, plans)
    assert [table for _kind, table, _sql in held.reads] == [TICKETS], "a policied table is never read"
    assert {"table": ORDERS, "reason": "policied", "use_cases": ["U1", "U2"]} in out["skipped"], out["skipped"]
    third = _plan("c.s.t9", [("U9", dict(K_DISCOUNT, table="c.s.t9"), None)])
    spent = _Deep({ORDERS: _std_rows("U1") + _std_rows("U2")}, errors={TICKETS: ns["DeepEvidenceBudgetSpent"]("spent")})
    out, delivered = _deep_calculate(ns, spent, plans + [third], concurrency=1)
    assert [table for _kind, table, _sql in spent.reads] == [ORDERS, TICKETS], "a spent budget stops the scans not yet started"
    assert {item["table"]: item["reason"] for item in out["skipped"]} == {TICKETS: "budget_spent", "c.s.t9": "budget_spent"}
    assert sorted(card["No"] for card in delivered) == ["U1", "U2", "U3", "U9"], "every use case still gets a card"


# --- the run site ---

def test_20_the_shortlist_step_attaches_each_card_logs_and_never_raises(ns):
    inst = make_inspire(ns)
    deep = _Deep({ORDERS: _std_rows("U1") + _std_rows("U2"), TICKETS: _std_rows("U3", currency=None)})
    deep.deep_calculate = types.MethodType(deep_fn(ns, "deep_calculate"), deep)
    inst.deep_evidence = deep
    ucs = [_uc("U1", K_CANCELLED), _uc("U2", K_DISCOUNT), _uc("U3", K_HANDLING), _uc("U4")]
    assert callable(getattr(inst, "_deep_calculate_shortlist", None)), "R13.1: DatabricksInspire has no _deep_calculate_shortlist"
    inst._deep_calculate_shortlist(ucs, _details("orders", "tickets"))
    assert [uc["Deep Calculation"]["status"] for uc in ucs] == ["ok", "ok", "ok", "no_pool_kpi"], [uc.get("Deep Calculation") for uc in ucs]
    assert sorted(card["No"] for card in inst.deep_cards) == ["U1", "U2", "U3", "U4"]
    assert any("[DEEP-CALC FIRED]" in message for _level, message in inst.logger.records), "the step logs its counts"
    broken = make_inspire(ns)
    broken.deep_evidence = types.SimpleNamespace(deep_calculate=lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    broken._deep_calculate_shortlist([_uc("U1", K_CANCELLED)], _details("orders"))  # never raises
    off = make_inspire(ns)
    off.deep_evidence = None
    one = _uc("U1", K_CANCELLED)
    off._deep_calculate_shortlist([one], _details("orders"))
    assert "Deep Calculation" not in one, "no DeepEvidence: the step is off and adds nothing"


def test_21_the_run_calculates_the_shortlist_right_after_selection(ns):
    source = "\n".join(code_cells(AGENT_NB))
    body = next(chunk for chunk in source.split("\n    def run(self):")[1:] if "PASS 1: Generating initial use cases" in chunk)
    body = body.split("\n    def ")[0]
    selection = body.find('InspireCandidateLedger.at(self, "advance", "Selection"')
    deep = body.find("self._deep_calculate_shortlist(final_consolidated_use_cases, _schema_for_quality)")
    dropped = body.find("del _schema_for_quality")
    assert 0 <= selection < deep < dropped, "the shortlist is known after Selection; the deep step runs there, before the schema is freed"
