"""R12 U7d (REQ-573 R12.7, R12.8): the value guards U7a left out, all in code.

- grain and join fan-out: a duplicated grain key or a join that repeats rows never inflates a measured value;
- sign and refunds: negative rows are refunds or reversals, netted and shown, never silently dropped or flipped;
- missing periods: a gap in the monthly series is flagged, a history shorter than the window is annualised over what it covers;
- effective-date joins: each row is priced at the rate valid on its own date (the money rule's rate table, as-of its date);
- dev data: tiny, stale or synthetic-looking data flags the card;
- R12.8: a read that times out is missing evidence, never a sampled guess; no guard read is capped with LIMIT or a sample.

The pure guard is inspire_value_guards(facts, spec, today); the facts come from DeepEvidence.measure_kpi_guards (one aggregate,
kpi_guard_sql, plus kpi_rate_guard_sql when the KPI is priced through a rate table). The SQL fakes are the repo's usual ones: a
DeepEvidence stub whose _read returns rows, and sqlite over sqlglot's transpile for the statements that must give exact numbers.
U7a's currency, stock-vs-flow and negative-exposure guards are not repeated here (a04_value_spec_test, a04_value_sign_test)."""
import copy
import json
import re
import sqlite3
from unittest.mock import MagicMock

import sqlglot
from sqlglot import exp

from v120_artifacts_support import make_inspire, make_uc
from v201_money_value_test import estimate_of, kpi, money_uc, ns  # noqa: F401  (ns is the shared fixture)

TODAY = "2026-11-28"
TABLE = "c.s.orders"
RATES = "c.s.fx_rates"
RATE_TABLE = {"table": RATES, "currency_column": "code", "base_column": "base", "date_column": "rate_date", "rate_column": "rate"}


def guards(ns):
    fn = ns.get("inspire_value_guards")
    assert callable(fn), "R12.7: the notebook defines no inspire_value_guards(facts, spec, today), the pure value guard"
    return fn


def deep_method(ns, name):
    fn = getattr(ns["DeepEvidence"], name, None)
    assert callable(fn), f"R12.7: DeepEvidence has no {name}"
    return fn


def facts(**over):
    """Clean facts: 5,000 rows, one per order, no refunds, four months present out of four, fresh, varied."""
    base = {"status": "ok", "rows": 5000, "grain_keys": 5000, "negative_rows": 0, "negative_total": 0.0, "positive_total": 250000.0,
            "first_day": "2026-08-31", "last_day": "2026-11-27", "months": 4, "distinct_values": 3100,
            "joined_rows": None, "unpriced_rows": None}
    base.update(over)
    return base


def spec_of(ns, **extra):
    return kpi(ns, time_column="order_date", grain_key="order_id", **extra)


class _Deep:
    """The DeepEvidence SQL stub: _read records each statement and answers with the given rows (or raises the given error)."""

    def __init__(self, rows=None, error=None):
        self.rows, self.error, self.reads = rows or [], error, []
        self.metric_views, self.policied = set(), set()

    def is_policied(self, table):
        return False

    def is_metric_view(self, table):
        return False

    def _plain_table(self, table):
        return None

    def _read(self, kind, table, sql, args=None, budget="evidence", scopes=None):
        self.reads.append((kind, table, sql))
        if self.error is not None:
            raise self.error
        return self.rows


def _timeout(ns):
    return ns["SparkWorkTimeout"]("DeepEvidence kpi_guard", 120.0, 120.0, "deep_evidence_1")


def _sqlite(sql, orders, rates):
    db = sqlite3.connect(":memory:")
    db.execute("CREATE TABLE orders (order_id TEXT, amount REAL, currency TEXT, order_date TEXT)")
    db.execute("CREATE TABLE fx_rates (code TEXT, base TEXT, rate_date TEXT, rate REAL)")
    db.executemany("INSERT INTO orders VALUES (?, ?, ?, ?)", orders)
    db.executemany("INSERT INTO fx_rates VALUES (?, ?, ?, ?)", rates)
    text = sqlglot.transpile(sql, read="databricks", write="sqlite")[0]
    text = text.replace('"c"."s"."orders"', "orders").replace('"c"."s"."fx_rates"', "fx_rates")
    cursor = db.execute(text)
    names = [column[0] for column in cursor.description]
    return [dict(zip(names, row)) for row in cursor.fetchall()]


def _rated_spec():
    return {"name": "Sales value", "table": TABLE, "aggregation": "SUM", "column": "amount", "time_column": "order_date",
            "currency_column": "currency", "rate": dict(RATE_TABLE, base="USD")}


ORDERS = [("o1", 100.0, "EUR", "2026-01-10"), ("o2", 100.0, "EUR", "2026-02-10"), ("o3", 50.0, "GBP", "2026-01-15"),
          ("o4", 70.0, "USD", "2026-02-20")]
RATE_ROWS = [("EUR", "USD", "2025-12-31", 1.10), ("EUR", "USD", "2026-02-01", 1.20), ("EUR", "USD", "2026-03-01", 1.50),
             ("EUR", "AED", "2026-01-05", 4.00), ("GBP", "USD", "2026-01-01", 1.30)]


def _uc_estimate(ns, spec):
    return estimate_of(ns, money_uc(ns, spec), "", "predict")


def _guarded_kpi(ns, **guard):
    spec = kpi(ns)
    spec["baseline"]["guards"] = {"ok": not guard.get("problems"), "problems": [], "flags": [], "period_days": 90,
                                  "refunds": None, "missing_months": 0, "dev_data": [], **guard}
    return spec


def _baseline_inspire(ns, deep):
    inst = make_inspire(ns)
    inst.deep_evidence = deep
    inst.logger = MagicMock()
    inst._ai_gate = lambda: MagicMock(share_measures=True)
    inst._kpi_withheld = lambda spec: ""
    inst._key_measure_swap = lambda spec, deep: None
    return inst


class _BaselineDeep:
    """measure_kpi and measure_kpi_guards stubbed at the method level, recording the specs they are asked to measure."""

    def __init__(self, ns, value=29589.0, error=None, guard_facts=None):
        self.ns, self.value, self.error, self.guard_facts = ns, value, error, guard_facts or facts()
        self.max_kpi_baselines, self.measured, self.guarded = 10, [], []

    def measure_kpi(self, spec, scopes=None):
        self.measured.append(copy.deepcopy(spec))
        if self.error is not None:
            raise self.error
        return self.value

    def measure_kpi_guards(self, spec, scopes=None):
        self.guarded.append(copy.deepcopy(spec))
        return dict(self.guard_facts)


# --- grain and join fan-out ---

def test_1_a_duplicated_grain_key_is_a_problem_so_the_inflated_sum_is_never_priced(ns):
    out = guards(ns)(facts(grain_keys=4100), spec_of(ns), TODAY)
    assert out["ok"] is False and "grain_duplicate" in out["problems"], out


def test_2_clean_data_raises_nothing_and_an_undeclared_grain_is_flagged_not_assumed(ns):
    clean = guards(ns)(facts(), spec_of(ns), TODAY)
    assert clean["ok"] is True and clean["problems"] == [] and clean["flags"] == [], clean
    assert clean["period_days"] == 90 and clean["dev_data"] == [] and clean["refunds"] is None, clean
    undeclared = kpi(ns, time_column="order_date")
    out = guards(ns)(facts(grain_keys=None), undeclared, TODAY)
    assert out["ok"] is True and "grain_unchecked" in out["flags"] and out["problems"] == [], out


def test_3_the_guard_read_covers_the_kpi_rows_counts_grain_and_refunds_and_is_never_capped(ns):
    spec = spec_of(ns, filter_column="status", filter_op="=", filter_value="paid", filter_type="text")
    guard_sql = deep_method(ns, "kpi_guard_sql")(spec)
    tree = sqlglot.parse_one(guard_sql, read="databricks")
    kpi_where = sqlglot.parse_one(ns["DeepEvidence"].kpi_sql(spec), read="databricks").args["where"].sql("databricks")
    assert any(where.sql("databricks") == kpi_where for where in tree.find_all(exp.Where)), \
        f"the guard read must count the same rows as the KPI (its filter and window): {guard_sql}"
    assert any(isinstance(count.this, exp.Distinct) and "order_id" in count.this.sql() for count in tree.find_all(exp.Count)), \
        "the grain check counts the distinct grain key"
    assert any(isinstance(lt.this, exp.Column) and lt.this.name == "amount" and lt.expression.sql() == "0" for lt in tree.find_all(exp.LT)), \
        "the refund check counts the rows whose amount is below zero"
    assert not list(tree.find_all(exp.Limit)) and not list(tree.find_all(exp.TableSample)), "R12.8: LIMIT or a sample is not a cost cap"
    assert not re.search(r"xxhash64|rand\(|tablesample", guard_sql, re.I), "R12.8: a guard is never measured on a sample"


def test_4_the_guard_facts_come_from_one_read_named_for_the_kpi_table(ns):
    row = {"n": 5000, "k": 4990, "neg_n": 12, "neg_v": -340.5, "pos_v": 250340.5, "first_day": "2026-08-31",
           "last_day": "2026-11-27", "months": 4, "distinct_v": 3100}
    deep = _Deep(rows=[row])
    got = deep_method(ns, "measure_kpi_guards")(deep, spec_of(ns))
    assert [(kind, table) for kind, table, _sql in deep.reads] == [("kpi_guard", TABLE)], deep.reads
    expected = {"status": "ok", "rows": 5000, "grain_keys": 4990, "negative_rows": 12, "negative_total": -340.5,
                "positive_total": 250340.5, "first_day": "2026-08-31", "last_day": "2026-11-27", "months": 4, "distinct_values": 3100}
    assert {key: got.get(key) for key in expected} == expected, got


# --- sign and refunds ---

def test_5_refund_rows_are_netted_and_shown_with_their_sign_never_dropped_or_flipped(ns):
    out = guards(ns)(facts(negative_rows=12, negative_total=-340.5, positive_total=250340.5), spec_of(ns), TODAY)
    assert out["ok"] is True and "refunds_netted" in out["flags"], out
    assert out["refunds"] == {"rows": 12, "amount": -340.5, "gross": 250340.5}, out["refunds"]


def test_6_a_kpi_filter_that_drops_the_negative_rows_of_its_own_measure_is_a_problem(ns):
    for op in (">", ">="):
        spec = spec_of(ns, filter_column="amount", filter_op=op, filter_value="0", filter_type="decimal")
        out = guards(ns)(facts(), spec, TODAY)
        assert out["ok"] is False and "refunds_excluded" in out["problems"], (op, out)
    other = spec_of(ns, filter_column="quantity", filter_op=">", filter_value="0", filter_type="decimal")
    assert "refunds_excluded" not in guards(ns)(facts(), other, TODAY)["problems"], "a filter on another column keeps refunds"


def test_7_a_net_negative_baseline_says_it_is_negative_instead_of_vanishing_as_no_value(ns):
    estimate = _uc_estimate(ns, kpi(ns, value=-1200.0))
    assert estimate["status"] == ns["INSPIRE_VALUE_NOT_MEASURED"], estimate
    assert "negative" in estimate["text"].lower() and "got no value" not in estimate["text"], estimate["text"]
    assert "value_low" not in estimate, estimate


# --- missing periods ---

def test_8_a_month_with_no_rows_inside_the_window_is_flagged_with_the_count(ns):
    spec = spec_of(ns, window=180)
    spec["baseline"]["window_days"] = 180
    out = guards(ns)(facts(first_day="2026-01-05", last_day="2026-06-28", months=4), spec, TODAY)
    assert "periods_missing" in out["flags"] and out["missing_months"] == 2, out
    assert out["problems"] == [] and out["period_days"] == 180, out


def test_9_a_history_shorter_than_the_window_is_annualised_over_the_days_it_covers(ns):
    short = spec_of(ns, window=365)
    short["baseline"]["window_days"] = 365
    out = guards(ns)(facts(first_day="2026-09-01", last_day="2026-11-20", months=3), short, TODAY)
    assert out["period_days"] == 81 and "history_shorter_than_window" in out["flags"], out
    full = guards(ns)(facts(first_day="2026-09-03", last_day="2026-11-27", months=3), spec_of(ns), TODAY)
    assert full["period_days"] == 90 and "history_shorter_than_window" not in full["flags"], \
        "a few quiet days at the start of the window are not a short history"


def test_10_the_estimate_prices_over_the_guarded_period_and_carries_the_guard_flags(ns, monkeypatch):
    real, seen = ns["inspire_value_calculate"], []
    monkeypatch.setitem(ns, "inspire_value_calculate", lambda spec: seen.append(copy.deepcopy(spec)) or real(spec))
    spec = _guarded_kpi(ns, flags=["history_shorter_than_window", "periods_missing"], period_days=81, missing_months=1)
    estimate = _uc_estimate(ns, spec)
    assert estimate["status"] == "measured" and seen and seen[-1]["measured"]["period_days"] == 81, seen
    assert {"history_shorter_than_window", "periods_missing"} <= set(estimate.get("guard_flags") or []), estimate


# --- dev data ---

def test_11_tiny_data_flags_the_card_and_keeps_its_number(ns):
    out = guards(ns)(facts(rows=40, grain_keys=40, distinct_values=35, positive_total=2000.0), spec_of(ns), TODAY)
    assert "dev_data" in out["flags"] and "tiny" in out["dev_data"] and out["problems"] == [], out


def test_12_stale_and_synthetic_looking_data_flag_the_card(ns):
    stale = guards(ns)(facts(first_day="2023-10-15", last_day="2024-01-10"), spec_of(ns), TODAY)
    assert "dev_data" in stale["flags"] and "stale" in stale["dev_data"], stale
    one_day = guards(ns)(facts(first_day="2026-11-27", last_day="2026-11-27", months=1), spec_of(ns), TODAY)
    assert "synthetic" in one_day["dev_data"], "every row on one day across a 90-day window looks loaded, not lived"
    one_amount = guards(ns)(facts(distinct_values=1), spec_of(ns), TODAY)
    assert "synthetic" in one_amount["dev_data"], "every row with the same amount looks generated"


def test_13_a_dev_data_card_is_still_measured_and_says_so_in_its_text(ns):
    estimate = _uc_estimate(ns, _guarded_kpi(ns, flags=["dev_data"], dev_data=["stale"]))
    assert estimate["status"] == "measured" and estimate["value_low"] > 0, estimate
    assert "dev_data" in (estimate.get("guard_flags") or []), estimate
    assert "development data" in estimate["text"].lower(), estimate["text"]


def test_14_a_guard_problem_leaves_the_value_not_measured_with_its_reason(ns):
    estimate = _uc_estimate(ns, _guarded_kpi(ns, ok=False, problems=["grain_duplicate"]))
    assert estimate["status"] == ns["INSPIRE_VALUE_NOT_MEASURED"] and "value_low" not in estimate, estimate
    assert "duplicate" in estimate["text"].lower(), estimate["text"]


# --- effective-date joins ---

def test_15_each_row_is_priced_at_the_rate_valid_on_its_own_date(ns):
    sql = ns["DeepEvidence"].kpi_sql(_rated_spec())
    assert not list(sqlglot.parse_one(sql, read="databricks").find_all(exp.Limit)), "R12.8: no LIMIT in a value read"
    value = _sqlite(sql, ORDERS, RATE_ROWS)[0]["v"]
    # o1 at the 2025-12-31 rate, o2 at the 2026-02-01 rate, o3 at GBP's, o4 already USD; the AED rate and the March rate never apply
    assert abs(value - (100 * 1.10 + 100 * 1.20 + 50 * 1.30 + 70)) < 1e-9, value


def test_16_overlapping_rates_are_a_fan_out_and_a_row_with_no_rate_is_never_priced_at_a_neighbour(ns):
    sql = deep_method(ns, "kpi_rate_guard_sql")(_rated_spec())
    clean = _sqlite(sql, ORDERS, RATE_ROWS)[0]
    assert (clean["n"], clean["j"], clean["u"]) == (4, 4, 0), clean
    dirty = _sqlite(sql, ORDERS + [("o5", 30.0, "EUR", "2025-11-01")], RATE_ROWS + [("EUR", "USD", "2026-02-01", 1.25)])[0]
    assert dirty["u"] == 1 and dirty["j"] > dirty["n"] - dirty["u"], dirty
    fan = guards(ns)(facts(rows=100, grain_keys=100, joined_rows=130, unpriced_rows=0), spec_of(ns), TODAY)
    assert fan["ok"] is False and "join_fanout" in fan["problems"], fan
    gap = guards(ns)(facts(rows=100, grain_keys=100, joined_rows=97, unpriced_rows=3), spec_of(ns), TODAY)
    assert "rate_missing" in gap["problems"] and "join_fanout" not in gap["problems"], gap


def test_17_a_rate_table_kpi_is_measured_per_row_and_never_converted_twice(ns, monkeypatch):
    feed = {"source": "table", "rates": {"EUR": 1.1}, "rate_table": RATE_TABLE}
    monkeypatch.setitem(ns, "INSPIRE_SETTINGS_APPLIED", {"currency": "USD", "currency_rates": json.dumps(feed)})
    deep = _BaselineDeep(ns, value=1000.0)
    spec = kpi(ns, unit="EUR", value=None, time_column="order_date", currency_column="currency")
    spec.pop("baseline")
    _baseline_inspire(ns, deep)._measure_kpi_baselines([{"No": "N01-U01", "KPIs": [spec]}])
    assert deep.measured and deep.measured[0].get("rate") == dict(RATE_TABLE, base="USD"), deep.measured
    estimate = _uc_estimate(ns, spec)
    yearly = 1000.0 * 365 / 90
    assert estimate["status"] == "measured" and estimate["currency"] == "USD", estimate
    assert estimate["value_low"] == round(yearly * 0.02, 2), "the rows were priced in SQL; the feed's EUR rate must not apply again"
    assert "each row's date" in estimate["text"], estimate["text"]


# --- R12.8 timeouts ---

def test_18_a_guard_read_that_times_out_is_missing_evidence_with_no_sampled_retry(ns):
    deep = _Deep(error=_timeout(ns))
    got = deep_method(ns, "measure_kpi_guards")(deep, spec_of(ns))
    assert got["status"] == "timeout" and len(deep.reads) == 1, (got, deep.reads)
    out = guards(ns)(got, spec_of(ns), TODAY)
    assert out["ok"] is False and out["problems"] == ["evidence_timeout"] and out["period_days"] is None, out


def test_19_a_baseline_that_times_out_is_recorded_as_missing_and_the_card_says_it_timed_out(ns):
    deep = _BaselineDeep(ns, error=_timeout(ns))
    spec = kpi(ns, value=None)
    spec.pop("baseline")
    _baseline_inspire(ns, deep)._measure_kpi_baselines([{"No": "N01-U01", "KPIs": [spec]}])
    assert len(deep.measured) == 1, "one read per KPI query: a timeout is never retried on a sample"
    assert spec["baseline"] is None and spec.get("baseline_missing") == "timeout", spec
    estimate = _uc_estimate(ns, spec)
    assert estimate["status"] == ns["INSPIRE_VALUE_NOT_MEASURED"], estimate
    assert "timed out" in estimate["text"] and "got no value" not in estimate["text"], estimate["text"]


def test_20_a_measured_baseline_keeps_its_guard_result(ns):
    deep = _BaselineDeep(ns, guard_facts=facts(negative_rows=12, negative_total=-340.5, positive_total=29929.5))
    spec = spec_of(ns, value=None)
    spec.pop("baseline")
    _baseline_inspire(ns, deep)._measure_kpi_baselines([{"No": "N01-U01", "KPIs": [spec]}])
    assert deep.guarded and deep.guarded[0]["query"] == spec["query"], "the guards run on the KPI that was measured"
    held = (spec.get("baseline") or {}).get("guards") or {}
    assert "refunds_netted" in held.get("flags", []) and held["refunds"]["amount"] == -340.5, spec.get("baseline")
