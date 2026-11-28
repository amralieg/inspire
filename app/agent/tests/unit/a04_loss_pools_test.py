"""REQ-573 R10.4, R10.5, R9.3: the SQL loss-pool enumerator and its candidate-or-reason step.

- R10.4: a SQL enumerator runs alongside generation and never blocks it. It splits each money column by the status and outcome
  values of its table (cancelled, returned, refunded, late, discounted, written-off, penalty) and adds the dedicated discount,
  penalty, overtime and scrap columns as pools of their own.
- R10.5: every material pool gets a candidate, or a recorded reason why not.
- R9.3: a missing measure is unknown, never zero; order, invoice and payment flows are never added together; amounts in
  different currencies are never added together.

Industry-agnostic: money, status and currency columns come from metadata (DatabricksInspire._column_roles), values and generic word
lists only. The fixtures use generic table names and a non-English value set that no word list maps.

The surface (brief: ~/claude/inspire/briefs/a04_loss_pools.md):
- inspire_loss_pool_plan(metadata) -> list of per-table plans (pure; metadata is the _kind_metadata_from_details shape);
- DeepEvidence.measure_loss_pools(plan, scopes=None) -> {"pools": [...], "skipped": [...]} (reads through _read only);
- inspire_loss_pool_totals(pools) -> totals per (flow, currency, unit), never across them (pure);
- inspire_loss_pool_coverage(pools, use_cases) -> one row per pool: candidates or a reason (pure);
- DatabricksInspire._start_loss_pools(details), _loss_pools_collect(wait_seconds), _loss_pool_candidates(pools, use_cases);
- INSPIRE_LOSS_POOL_MATERIAL_SHARE = 0.01.

The SQL fake is the repo's usual one: a DeepEvidence stub whose _read runs each statement on sqlite through sqlglot's transpile,
so the numbers are exact without pinning the SQL text. The LLM fake is the c33 one: run_worker records the call and answers JSON."""
import json
import re
import sqlite3
import threading
import time
import types

import sqlglot

from _nbload import AGENT_NB, code_cells
from v120_artifacts_support import CapturingLogger, make_inspire, make_uc
from v201_money_value_test import ns  # noqa: F401  (the shared fixture)

ORDERS, PAYMENTS, SHIPMENTS, REGISTRO, REQUESTS, JOBS = (f"c.s.{name}" for name in
                                                         ("orders", "payments", "shipments", "registro", "requests", "jobs"))

SCHEMA = {
    "orders": [("order_id", "STRING"), ("order_status", "STRING"), ("currency_code", "STRING"), ("order_amount", "DOUBLE"),
               ("discount_amount", "DOUBLE"), ("order_date", "DATE")],
    "payments": [("payment_id", "STRING"), ("payment_status", "STRING"), ("currency_code", "STRING"), ("paid_amount", "DOUBLE")],
    "shipments": [("shipment_id", "STRING"), ("ship_status", "STRING"), ("freight_cost", "DOUBLE")],
    "registro": [("registro_id", "STRING"), ("status", "STRING"), ("amount", "DOUBLE")],
    "requests": [("request_id", "STRING"), ("request_status", "STRING"), ("request_amount", "DOUBLE")],
    "jobs": [("job_id", "STRING"), ("job_status", "STRING"), ("labour_cost", "DOUBLE"), ("penalty_fee", "DOUBLE"),
             ("overtime_hours", "DOUBLE"), ("scrap_qty", "INT")],
}
ROWS = {
    # EUR: total 3800, cancelled 500 (two spellings), returned 300, discount 160. USD: total 5720, cancelled 700, refunded 20 (0.35%).
    "orders": [("o1", "delivered", "EUR", 1000.0, 50.0, "2026-10-01"), ("o2", "cancelled", "EUR", 400.0, 0.0, "2026-10-02"),
               ("o3", "Canceled", "EUR", 100.0, 0.0, "2026-10-03"), ("o4", "returned", "EUR", 300.0, 10.0, "2026-10-04"),
               ("o5", "delivered", "EUR", 2000.0, 100.0, "2026-10-05"), ("o6", "delivered", "USD", 5000.0, 0.0, "2026-10-06"),
               ("o7", "cancelled", "USD", 700.0, 0.0, "2026-10-07"), ("o8", "refunded", "USD", 20.0, 0.0, "2026-10-08")],
    "payments": [("p1", "settled", "EUR", 3000.0), ("p2", "refunded", "EUR", 300.0), ("p3", "settled", "EUR", 200.0)],
    "shipments": [("s1", "delivered", 40.0), ("s2", "in_transit", 25.0), ("s3", "pending", 10.0)],
    "registro": [("r1", "estado_a", 100.0), ("r2", "estado_b", 250.0), ("r3", "estado_c", 75.0), ("r4", "estado_a", 60.0)],
    # Every cancelled request has no amount: the cancelled pool is unknown, never 0.
    "requests": [("q1", "cancelled", None), ("q2", "cancelled", None), ("q3", "open", 500.0), ("q4", "open", 700.0)],
    "jobs": [("j1", "done", 900.0, 30.0, 4.0, 2), ("j2", "done", 1100.0, 0.0, 6.0, 1)],
}
LOSS_KINDS = {"cancelled", "returned", "refunded", "late", "discounted", "written_off", "penalty", "overtime", "scrap"}


def _metadata(*names):
    return {f"c.s.{name}": {"columns": {col: {"type": typ, "comment": ""} for col, typ in SCHEMA[name]}} for name in names}


def _details(*names):
    return [("c", "s", name, col, typ, "") for name in names for col, typ in SCHEMA[name]]


def _sqlite(sql):
    db = sqlite3.connect(":memory:")
    for name, cols in SCHEMA.items():
        db.execute(f"CREATE TABLE {name} ({', '.join(col for col, _ in cols)})")
        db.executemany(f"INSERT INTO {name} VALUES ({', '.join('?' for _ in cols)})", ROWS[name])
    text = sqlglot.transpile(sql, read="databricks", write="sqlite")[0]
    text = re.sub(r'"c"\."s"\."(\w+)"', r"\1", text)
    cursor = db.execute(text)
    names = [column[0] for column in cursor.description]
    return [dict(zip(names, row)) for row in cursor.fetchall()]


class _Deep:
    """The DeepEvidence SQL stub: _read records each statement and answers it from sqlite (or raises for the tables in `errors`)."""

    def __init__(self, errors=None, policied=(), gate=None):
        self.errors, self.policied, self.gate = errors or {}, set(policied), gate
        self.metric_views, self.reads = set(), []
        self.logger = CapturingLogger()
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
        self.reads.append((kind, table, sql))
        if self.gate is not None:
            self.gate.wait(10)
        for name in table if isinstance(table, (list, tuple)) else [table]:
            if name in self.errors:
                raise self.errors[name]
        return _sqlite(sql)


class _Llm:
    """The c33 fake model: records every call and answers one fixed JSON (or raises)."""

    def __init__(self, answer=None, error=None):
        self.answer, self.error, self.calls = answer or {"candidates": [], "declined": []}, error, []

    def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema, **kwargs):
        self.calls.append((worker_prompt_path, dict(prompt_vars)))
        if self.error is not None:
            raise self.error
        return json.dumps(self.answer)


def fn(ns, name):
    found = ns.get(name)
    assert callable(found), f"R10.4/R10.5: the notebook defines no {name}"
    return found


def deep_fn(ns, name):
    found = getattr(ns["DeepEvidence"], name, None)
    assert callable(found), f"R10.4: DeepEvidence has no {name}"
    return found


def inspire_fn(ns, name):
    found = getattr(ns["DatabricksInspire"], name, None)
    assert callable(found), f"R10.4/R10.5: DatabricksInspire has no {name}"
    return found


def measure(ns, *names, deep=None):
    deep = deep or _Deep()
    plan = fn(ns, "inspire_loss_pool_plan")(_metadata(*names))
    return deep_fn(ns, "measure_loss_pools")(deep, plan), deep


def pools_of(out, table=None, kind=None, currency="any"):
    return [pool for pool in out["pools"] if (table is None or pool["table"] == table) and (kind is None or pool["loss_kind"] == kind)
            and (currency == "any" or pool["currency"] == currency)]


def _timeout(ns):
    return ns["SparkWorkTimeout"]("DeepEvidence loss_pool", 120.0, 120.0, "deep_evidence_1")


def pool(**over):
    base = {"pool_id": "lp_a", "table": ORDERS, "money_column": "order_amount", "split_column": "order_status",
            "split_values": ["cancelled"], "loss_kind": "cancelled", "source": "status_split", "flow": "order", "currency": "EUR",
            "unit": "money", "amount": 500.0, "rows": 2, "measured_rows": 2, "share": 0.1316, "material": True, "flags": []}
    base.update(over)
    return base


def _candidate_inspire(ns, llm, share=True):
    inst = make_inspire(ns)
    inst.ai_agent = llm
    inst._ai_gate = lambda: types.SimpleNamespace(share_measures=share)
    return inst


# --- R10.4: what is split and what is added ---

def test_1_the_plan_finds_money_status_currency_and_loss_columns_from_metadata_only(ns):
    plans = {plan["table"]: plan for plan in fn(ns, "inspire_loss_pool_plan")(_metadata("orders", "jobs"))}
    orders, jobs = plans[ORDERS], plans[JOBS]
    assert "order_amount" in orders["money_columns"] and "order_status" in orders["status_columns"], orders
    assert orders["currency_column"] == "currency_code", orders
    assert "order_id" not in orders["money_columns"] and "currency_code" not in orders["status_columns"], orders
    loss = {item["column"]: (item["kind"], item["unit"]) for item in orders["loss_columns"]}
    assert loss == {"discount_amount": ("discounted", "money")}, orders["loss_columns"]
    assert "discount_amount" not in orders["money_columns"], "a loss column is a pool of its own, never split again by status"
    jobs_loss = {item["column"]: (item["kind"], item["unit"]) for item in jobs["loss_columns"]}
    assert jobs_loss == {"penalty_fee": ("penalty", "money"), "overtime_hours": ("overtime", "quantity"),
                         "scrap_qty": ("scrap", "quantity")}, jobs["loss_columns"]
    assert orders["flow"] == "order", orders


def test_2_each_money_column_is_split_by_its_loss_status_values_per_currency(ns):
    out, _deep = measure(ns, "orders")
    got = {(p["loss_kind"], p["currency"]): p for p in pools_of(out, ORDERS) if p["source"] == "status_split"}
    assert set(got) == {("cancelled", "EUR"), ("returned", "EUR"), ("cancelled", "USD"), ("refunded", "USD")}, sorted(got)
    cancelled = got[("cancelled", "EUR")]
    assert cancelled["money_column"] == "order_amount" and cancelled["split_column"] == "order_status", cancelled
    assert abs(cancelled["amount"] - 500.0) < 1e-6 and cancelled["rows"] == 2, cancelled
    assert sorted(v.casefold() for v in cancelled["split_values"]) == ["canceled", "cancelled"], cancelled["split_values"]
    assert abs(got[("returned", "EUR")]["amount"] - 300.0) < 1e-6 and abs(got[("cancelled", "USD")]["amount"] - 700.0) < 1e-6, got
    assert all(p["loss_kind"] in LOSS_KINDS for p in out["pools"]), out["pools"]


def test_3_amounts_in_different_currencies_are_never_added(ns):
    out, _deep = measure(ns, "orders")
    assert all(p["currency"] in ("EUR", "USD") for p in pools_of(out, ORDERS)), "each pool is in one currency, read per row"
    assert not any(p["amount"] is not None and abs(p["amount"] - 1200.0) < 1e-6 for p in out["pools"]), \
        "R9.3: EUR 500 and USD 700 cancelled are never one pool of 1200"
    totals = fn(ns, "inspire_loss_pool_totals")(out["pools"])
    cancelled_totals = {(t["flow"], t["currency"]) for t in totals}
    assert {("order", "EUR"), ("order", "USD")} <= cancelled_totals, totals
    assert all(t["currency"] in ("EUR", "USD") for t in totals if t["unit"] == "money"), totals


def test_4_a_discount_column_is_added_as_its_own_pool_and_its_share_is_of_the_table_flow(ns):
    out, _deep = measure(ns, "orders")
    discount = [p for p in pools_of(out, ORDERS, "discounted", "EUR") if p["source"] == "loss_column"]
    assert len(discount) == 1, out["pools"]
    found = discount[0]
    assert found["money_column"] == "discount_amount" and found["split_column"] is None and found["unit"] == "money", found
    assert abs(found["amount"] - 160.0) < 1e-6, found
    assert abs(found["share"] - 160.0 / 3800.0) < 1e-6 and found["material"] is True, found


def test_5_a_status_column_with_no_loss_values_gives_no_pool_and_is_recorded(ns):
    out, _deep = measure(ns, "shipments")
    assert pools_of(out, SHIPMENTS) == [], out["pools"]
    recorded = [s for s in out["skipped"] if s["table"] == SHIPMENTS and s.get("column") == "ship_status"]
    assert len(recorded) == 1 and recorded[0]["reason"] == "no_loss_values", out["skipped"]


def test_6_a_non_english_value_set_is_recorded_as_unmapped_never_read_as_no_loss(ns):
    out, _deep = measure(ns, "registro")
    assert pools_of(out, REGISTRO) == [], "values no word list knows are never guessed into a loss kind"
    recorded = [s for s in out["skipped"] if s["table"] == REGISTRO and s.get("column") == "status"]
    assert len(recorded) == 1 and recorded[0]["reason"] == "status_values_unmapped", out["skipped"]
    assert recorded[0].get("distinct_values") == 3, recorded[0]


def test_7_a_null_measure_is_unknown_never_zero(ns):
    out, _deep = measure(ns, "requests")
    cancelled = pools_of(out, REQUESTS, "cancelled")
    assert len(cancelled) == 1, out["pools"]
    found = cancelled[0]
    assert found["amount"] is None and found["rows"] == 2 and found["measured_rows"] == 0, found
    assert found["share"] is None and found["material"] is None, "R9.3: unknown, so it must still be covered or explained"
    totals = [t for t in fn(ns, "inspire_loss_pool_totals")(out["pools"]) if t["unit"] == "money"]
    assert totals and all(t["amount"] is None and t["unknown_pools"] >= 1 for t in totals if t["flow"] == found["flow"]), \
        f"a total of only unknown pools is unknown, never 0: {totals}"


def test_8_order_and_payment_flows_are_never_added_together(ns):
    out, _deep = measure(ns, "orders", "payments")
    refunded = pools_of(out, PAYMENTS, "refunded", "EUR")
    assert len(refunded) == 1 and refunded[0]["flow"] == "payment" and abs(refunded[0]["amount"] - 300.0) < 1e-6, out["pools"]
    totals = {(t["flow"], t["currency"], t["unit"]): t for t in fn(ns, "inspire_loss_pool_totals")(out["pools"])}
    assert ("order", "EUR", "money") in totals and ("payment", "EUR", "money") in totals, sorted(totals)
    assert abs(totals[("payment", "EUR", "money")]["amount"] - 300.0) < 1e-6, totals[("payment", "EUR", "money")]
    assert not any(t["amount"] is not None and abs(t["amount"] - (500.0 + 300.0 + 160.0 + 300.0)) < 1e-6 for t in totals.values()), \
        "R9.3: an order loss and the payment refund of the same money are never one total"


def test_9_materiality_is_one_percent_of_the_same_column_and_currency(ns):
    assert ns.get("INSPIRE_LOSS_POOL_MATERIAL_SHARE") == 0.01, "D1: material = at least 1% of the same column's total, same currency"
    out, _deep = measure(ns, "orders")
    refunded = pools_of(out, ORDERS, "refunded", "USD")
    assert len(refunded) == 1 and abs(refunded[0]["share"] - 20.0 / 5720.0) < 1e-6 and refunded[0]["material"] is False, refunded
    cancelled = pools_of(out, ORDERS, "cancelled", "USD")[0]
    assert abs(cancelled["share"] - 700.0 / 5720.0) < 1e-6 and cancelled["material"] is True, cancelled


def test_10_a_timed_out_or_failed_table_is_recorded_and_the_other_tables_still_give_pools(ns):
    deep = _Deep(errors={REQUESTS: _timeout(ns), SHIPMENTS: RuntimeError("warehouse went away")})
    out, _deep = measure(ns, "orders", "requests", "shipments", deep=deep)
    assert pools_of(out, ORDERS), "one table timing out never empties the others"
    assert pools_of(out, REQUESTS) == [] and pools_of(out, SHIPMENTS) == [], "a table that was not read has no pool, never a 0 pool"
    reasons = {s["table"]: s["reason"] for s in out["skipped"] if s["table"] in (REQUESTS, SHIPMENTS)}
    assert reasons == {REQUESTS: "timeout", SHIPMENTS: "failed"}, out["skipped"]


def test_11_reads_are_aggregates_never_capped_or_sampled_and_a_policied_table_is_not_read(ns):
    deep = _Deep(policied={PAYMENTS})
    out, deep = measure(ns, "orders", "payments", deep=deep)
    assert deep.reads and all(kind == "loss_pool" for kind, _table, _sql in deep.reads), deep.reads
    assert all(table != PAYMENTS and PAYMENTS not in (table if isinstance(table, (list, tuple)) else [table])
               for _kind, table, _sql in deep.reads), "a policied table is never read"
    assert {s["table"]: s["reason"] for s in out["skipped"] if s["table"] == PAYMENTS} == {PAYMENTS: "policied"}, out["skipped"]
    for _kind, _table, sql in deep.reads:
        assert not re.search(r"\blimit\b|tablesample|rand\(|xxhash64", sql, re.I), f"R12.8: a pool is never measured on a sample: {sql}"
        assert re.search(r"\bgroup\s+by\b|\bsum\s*\(", sql, re.I), f"aggregates only: {sql}"


def test_12_pool_ids_are_stable_and_unique(ns):
    first, _ = measure(ns, "orders", "payments", "jobs")
    second, _ = measure(ns, "orders", "payments", "jobs")
    ids = [p["pool_id"] for p in first["pools"]]
    assert ids and len(ids) == len(set(ids)), ids
    assert sorted(ids) == sorted(p["pool_id"] for p in second["pools"]), "a rerun over the same data gives the same pool ids"


# --- R10.4: it runs alongside generation and never blocks it ---

def test_13_starting_the_enumerator_returns_at_once_and_a_slow_read_leaves_generation_free(ns):
    gate = threading.Event()
    inst = make_inspire(ns, deep_evidence=_Deep(gate=gate))
    try:
        started = time.monotonic()
        inspire_fn(ns, "_start_loss_pools")(inst, _details("orders"))
        assert time.monotonic() - started < 1.0, "R10.4: starting the enumerator never waits on a read"
        waited = time.monotonic()
        early = inspire_fn(ns, "_loss_pools_collect")(inst, 0.2)
        assert time.monotonic() - waited < 2.0, "collect waits at most its bound"
        assert early["status"] == "pending" and early["pools"] == [], f"not read yet is unknown, never an empty answer: {early}"
    finally:
        gate.set()
    done = inspire_fn(ns, "_loss_pools_collect")(inst, 10.0)
    assert done["status"] == "ok" and pools_of(done, ORDERS), done
    assert inst.loss_pools == done["pools"], "the pools are exposed as a plain list of dicts for the coverage lane"


def test_14_a_failing_enumerator_never_raises_into_generation(ns, monkeypatch):
    def broken(metadata):
        raise RuntimeError("plan exploded")
    monkeypatch.setitem(ns, "inspire_loss_pool_plan", broken)
    inst = make_inspire(ns, deep_evidence=_Deep())
    inspire_fn(ns, "_start_loss_pools")(inst, _details("orders"))
    out = inspire_fn(ns, "_loss_pools_collect")(inst, 5.0)
    assert out["status"] == "failed" and out["pools"] == [], out
    monkeypatch.undo()
    off = make_inspire(ns, deep_evidence=None)
    inspire_fn(ns, "_start_loss_pools")(off, _details("orders"))
    assert inspire_fn(ns, "_loss_pools_collect")(off, 0.1)["status"] == "off", "no data reads, no pools, no error"


def test_15_the_run_starts_the_enumerator_before_pass_1_and_joins_it_only_after_generation(ns):
    source = "\n".join(code_cells(AGENT_NB))
    body = next(chunk for chunk in source.split("\n    def run(self):")[1:] if "PASS 1: Generating initial use cases" in chunk)
    body = body.split("\n    def ")[0]
    start, pass1 = body.find("_start_loss_pools("), body.find("PASS 1: Generating initial use cases")
    loaded, collect = body.find("load_all_use_cases()"), body.find("_loss_pools_collect(")
    candidates, propose = body.find("_loss_pool_candidates("), body.find('InspireCandidateLedger.at(self, "propose"')
    assert 0 <= start < pass1, "R10.4: the enumerator starts before Pass 1 so it runs alongside generation"
    assert pass1 < loaded < collect < candidates < propose, \
        "the pools are joined after generation, and their candidates join the use cases before the ledger proposes them"


# --- R10.5: every material pool gets a candidate or a reason ---

def test_16_coverage_matches_a_kpi_on_the_pool_and_never_a_generic_use_case_on_the_same_column(ns):
    covered = pool(pool_id="lp_cov")
    generic = pool(pool_id="lp_gen", loss_kind="returned", split_values=["returned"])
    small = pool(pool_id="lp_small", loss_kind="refunded", split_values=["refunded"], share=0.003, material=False)
    targeted = make_uc("N01-U01", KPIs=[{"name": "Cancelled order value", "table": ORDERS, "column": "order_amount",
                                         "aggregation": "SUM", "filter_column": "order_status", "filter_op": "=",
                                         "filter_value": "cancelled", "filter_type": "text"}])
    forecast = make_uc("N01-U02", KPIs=[{"name": "Order value", "table": ORDERS, "column": "order_amount", "aggregation": "SUM"}])
    rows = fn(ns, "inspire_loss_pool_coverage")([covered, generic, small], [targeted, forecast])
    assert [row["pool_id"] for row in rows] == ["lp_cov", "lp_gen", "lp_small"], "one row per pool, in pool order"
    by_id = {row["pool_id"]: row for row in rows}
    assert by_id["lp_cov"]["candidates"] == ["N01-U01"] and by_id["lp_cov"]["reason"] is None, by_id["lp_cov"]
    assert by_id["lp_gen"]["candidates"] == [] and by_id["lp_gen"]["reason"], "a total-order forecast is not a returns candidate"
    assert by_id["lp_small"]["candidates"] == [] and by_id["lp_small"]["reason"] == "not_material", by_id["lp_small"]


def test_17_uncovered_material_pools_get_a_candidate_or_a_recorded_reason_in_one_call(ns):
    pools = [pool(pool_id="lp_1"), pool(pool_id="lp_2", loss_kind="returned", split_values=["returned"]),
             pool(pool_id="lp_3", table=REQUESTS, money_column="request_amount", split_column="request_status", amount=None,
                  share=None, material=None, flow="other"),
             pool(pool_id="lp_4", loss_kind="refunded", split_values=["refunded"], share=0.003, material=False)]
    answer = {"candidates": [{"pool_id": "lp_1", "Name": "Prevent cancelled orders", "Statement": "Flag orders likely to cancel"},
                             {"pool_id": "lp_bogus", "Name": "Invented pool", "Statement": "Not a pool"}],
              "declined": [{"pool_id": "lp_2", "reason": "returns carry no reason code to act on"}]}
    llm = _Llm(answer)
    existing = [make_uc("N01-U01")]
    new, coverage = inspire_fn(ns, "_loss_pool_candidates")(_candidate_inspire(ns, llm), pools, existing)
    assert [path for path, _vars in llm.calls] == ["LOSS_POOL_CANDIDATE_PROMPT"], "one batched call for the uncovered pools"
    sent = json.dumps(llm.calls[0][1])
    assert "lp_1" in sent and "lp_2" in sent and "lp_3" in sent and "lp_4" not in sent, \
        "uncovered material and unknown pools are asked about; a pool below materiality is not"
    assert len(new) == 1 and new[0]["loss_pool_id"] == "lp_1" and new[0]["Name"] == "Prevent cancelled orders", new
    assert ORDERS in str(new[0].get("Tables Involved")) and new[0]["No"] not in {uc["No"] for uc in existing}, new[0]
    by_id = {row["pool_id"]: row for row in coverage}
    assert set(by_id) == {"lp_1", "lp_2", "lp_3", "lp_4"}, "an invented pool id is dropped, never attributed"
    assert by_id["lp_1"]["candidates"] == [new[0]["No"]] and by_id["lp_1"]["reason"] is None, by_id["lp_1"]
    assert by_id["lp_2"]["candidates"] == [] and "reason code" in by_id["lp_2"]["reason"], by_id["lp_2"]
    assert by_id["lp_3"]["candidates"] == [] and by_id["lp_3"]["reason"] == "no_candidate_returned", by_id["lp_3"]
    assert by_id["lp_4"]["reason"] == "not_material", by_id["lp_4"]


def test_18_a_failed_candidate_call_records_a_reason_for_every_uncovered_pool_and_never_raises(ns):
    pools = [pool(pool_id="lp_1"), pool(pool_id="lp_2", loss_kind="returned", split_values=["returned"])]
    llm = _Llm(error=RuntimeError("model endpoint unavailable"))
    new, coverage = inspire_fn(ns, "_loss_pool_candidates")(_candidate_inspire(ns, llm), pools, [make_uc("N01-U01")])
    assert new == [], new
    assert [row["pool_id"] for row in coverage] == ["lp_1", "lp_2"], coverage
    assert all(row["candidates"] == [] and str(row["reason"]).startswith("candidate_generation_failed") for row in coverage), coverage


def test_19_amounts_reach_the_model_only_when_the_ai_may_see_aggregates(ns):
    pools = [pool(pool_id="lp_1", amount=123457.25, rows=4321, measured_rows=4321, share=0.0917, split_values=["estado_x"])]
    shared, hidden = _Llm(), _Llm()
    inspire_fn(ns, "_loss_pool_candidates")(_candidate_inspire(ns, shared, share=True), pools, [])
    inspire_fn(ns, "_loss_pool_candidates")(_candidate_inspire(ns, hidden, share=False), pools, [])
    assert shared.calls and hidden.calls, (shared.calls, hidden.calls)
    assert "123457" in json.dumps(shared.calls[0][1]), "with aggregates shared, the model sees the pool size"
    hidden_text = json.dumps(hidden.calls[0][1])
    assert "lp_1" in hidden_text and "order_amount" in hidden_text, hidden_text
    assert not re.search(r"123457|4321|0\.0917", hidden_text), f"discovery_ai_sees_aggregates off: no amount, row count or share: {hidden_text}"
    assert "estado_x" in json.dumps(shared.calls[0][1]) and "estado_x" not in hidden_text, \
        f"with aggregates hidden, the status values (row data) are not sent either, only the loss kind: {hidden_text}"
