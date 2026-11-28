#!/usr/bin/env python3
"""bench6 planted-case generator (R2.4).

Emits deterministic Serverless-safe SQL (CREATE TABLE + INSERT INTO) for two synthetic
schemas and the answer key for that scope (source "planted"). The generator only
writes into the --catalog/--schema it is given; it never creates catalogs and never
removes data. Table and column names are generic on purpose.

  python3 bench6_planted.py --scope adv_a --catalog <c> --schema <s> [--key-out key.json]

Scope adv_a: priced_by_reference, tiny_master, no_money_unit_cost, cross_domain, high_value_table.
Scope adv_b (traps): mixed_currency, wrong_grain, refunds_negative, stock_vs_flow,
overlapping_pools, dev_data.
"""
import argparse
import json
import random
import sys

SEED = 20261128


def _lit(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def _table(fq, cols, rows):
    """cols: [(name, sql_type)]; rows: list of tuples. Returns two statements."""
    ddl = "CREATE TABLE %s (%s)" % (fq, ", ".join("%s %s" % c for c in cols))
    out = [ddl]
    for i in range(0, len(rows), 50):
        chunk = rows[i:i + 50]
        vals = ", ".join("(" + ", ".join(_lit(v) for v in r) + ")" for r in chunk)
        out.append("INSERT INTO %s VALUES %s" % (fq, vals))
    return out


def _date(rng, base_year=2024):
    return "%d-%02d-%02d" % (base_year + rng.randint(0, 1), rng.randint(1, 12), rng.randint(1, 28))


def _adv_a(rng, fq):
    s = []
    n_codes, n_items, n_assets, n_hubs = 12, 40, 15, 25
    # tiny master: <=20 rows, many tables point at it
    s += _table(fq("code_master"), [("code_id", "INT"), ("label", "STRING"), ("group_label", "STRING"),
                                    ("description", "STRING")],
                [(i, "Code %02d" % i, "Group %d" % (i % 4), "Descriptive text for code %d" % i)
                 for i in range(1, n_codes + 1)])
    # reference with historical rates (effective dates)
    rates = []
    for item in range(1, n_items + 1):
        base = round(rng.uniform(1, 50), 2)
        for k, (a, b) in enumerate([("2023-01-01", "2023-12-31"), ("2024-01-01", "2024-12-31"),
                                    ("2025-01-01", "2099-12-31")]):
            rates.append((item, a, b, round(base * (1 + 0.07 * k), 2)))
    s += _table(fq("unit_rate_ref"), [("item_id", "INT"), ("effective_from", "DATE"),
                                      ("effective_to", "DATE"), ("rate", "DECIMAL(12,2)")], rates)
    # transactions with NO money column: priced by joining unit_rate_ref on date
    s += _table(fq("item_events"), [("event_id", "INT"), ("item_id", "INT"), ("code_id", "INT"),
                                    ("event_date", "DATE"), ("quantity", "INT")],
                [(i, rng.randint(1, n_items), rng.randint(1, n_codes), _date(rng), rng.randint(1, 20))
                 for i in range(1, 301)])
    # transactions with no money column + cost-per-unit reference
    s += _table(fq("cost_per_unit_ref"), [("asset_id", "INT"), ("cost_per_unit", "DECIMAL(10,4)")],
                [(a, round(rng.uniform(0.05, 4.0), 4)) for a in range(1, n_assets + 1)])
    s += _table(fq("usage_events"), [("usage_id", "INT"), ("asset_id", "INT"), ("code_id", "INT"),
                                     ("hub_id", "INT"), ("units_used", "DECIMAL(12,3)"),
                                     ("used_at", "TIMESTAMP")],
                [(i, rng.randint(1, n_assets), rng.randint(1, n_codes), rng.randint(1, n_hubs),
                  round(rng.uniform(1, 500), 3), _date(rng) + " %02d:00:00" % rng.randint(0, 23))
                 for i in range(1, 241)])
    s += _table(fq("asset_log"), [("log_id", "INT"), ("asset_id", "INT"), ("code_id", "INT"),
                                  ("logged_on", "DATE"), ("note", "STRING")],
                [(i, rng.randint(1, n_assets), rng.randint(1, n_codes), _date(rng), "note %d" % i)
                 for i in range(1, 81)])
    # cross-domain use case: two groups joined through a shared hub
    s += _table(fq("shared_hub"), [("hub_id", "INT"), ("hub_name", "STRING"), ("region_label", "STRING")],
                [(h, "Hub %02d" % h, "Region %d" % (h % 5)) for h in range(1, n_hubs + 1)])
    s += _table(fq("group_x_records"), [("rec_id", "INT"), ("hub_id", "INT"), ("measure_x", "DECIMAL(12,2)"),
                                        ("recorded_on", "DATE")],
                [(i, rng.randint(1, n_hubs), round(rng.uniform(10, 900), 2), _date(rng))
                 for i in range(1, 151)])
    s += _table(fq("group_y_records"), [("rec_id", "INT"), ("hub_id", "INT"), ("measure_y", "DECIMAL(12,2)"),
                                        ("recorded_on", "DATE")],
                [(i, rng.randint(1, n_hubs), round(rng.uniform(10, 900), 2), _date(rng))
                 for i in range(1, 151)])
    # one high-value table
    s += _table(fq("contract_values"), [("contract_id", "INT"), ("hub_id", "INT"),
                                        ("total_value", "DECIMAL(18,2)"), ("starts_on", "DATE")],
                [(i, rng.randint(1, n_hubs), round(rng.uniform(5e6, 9e7), 2), _date(rng))
                 for i in range(1, 31)])
    return s


def _adv_b(rng, fq):
    s = []
    currencies = ["USD", "EUR", "GBP", "JPY", "AED"]
    # mixed currencies in one amount column
    s += _table(fq("payments"), [("payment_id", "INT"), ("party_id", "INT"), ("amount", "DECIMAL(14,2)"),
                                 ("currency_code", "STRING"), ("paid_on", "DATE")],
                [(i, rng.randint(1, 60), round(rng.uniform(5, 5000), 2), rng.choice(currencies), _date(rng))
                 for i in range(1, 201)])
    # wrong grain: daily snapshot next to events
    s += _table(fq("entity_events"), [("event_id", "INT"), ("entity_id", "INT"), ("event_date", "DATE"),
                                      ("delta", "DECIMAL(12,2)")],
                [(i, rng.randint(1, 30), _date(rng), round(rng.uniform(-100, 300), 2))
                 for i in range(1, 251)])
    s += _table(fq("daily_snapshot"), [("snapshot_date", "DATE"), ("entity_id", "INT"),
                                       ("balance", "DECIMAL(14,2)")],
                [("2025-01-%02d" % d, e, round(rng.uniform(0, 9000), 2))
                 for d in range(1, 29) for e in range(1, 31)])
    # refunds as negative amounts
    s += _table(fq("sales_lines"), [("line_id", "INT"), ("party_id", "INT"), ("line_amount", "DECIMAL(12,2)"),
                                    ("line_type", "STRING"), ("line_date", "DATE")],
                [(i, rng.randint(1, 60), round(rng.uniform(5, 800), 2) * (-1 if i % 7 == 0 else 1),
                  "refund" if i % 7 == 0 else "sale", _date(rng)) for i in range(1, 281)])
    # stock balance column next to the flow that produced it
    s += _table(fq("stock_moves"), [("move_id", "INT"), ("place_id", "INT"), ("moved_on", "DATE"),
                                    ("qty_change", "INT")],
                [(i, rng.randint(1, 20), _date(rng), rng.randint(-30, 60)) for i in range(1, 221)])
    s += _table(fq("stock_balance"), [("place_id", "INT"), ("as_of", "DATE"), ("on_hand_qty", "INT")],
                [(p, "2025-06-30", rng.randint(0, 900)) for p in range(1, 21)])
    # two overlapping pools (same members, different names)
    members = list(range(1, 61))
    pool_one = rng.sample(members, 40)
    pool_two = rng.sample(pool_one, 30) + rng.sample([m for m in members if m not in pool_one], 5)
    s += _table(fq("pool_one"), [("member_id", "INT"), ("pool_value", "DECIMAL(12,2)")],
                [(m, round(rng.uniform(100, 9000), 2)) for m in sorted(pool_one)])
    s += _table(fq("pool_two"), [("member_id", "INT"), ("pool_value", "DECIMAL(12,2)")],
                [(m, round(rng.uniform(100, 9000), 2)) for m in sorted(pool_two)])
    # dev-data table: tiny, stale, synthetic-looking
    s += _table(fq("scratch_dev_data"), [("id", "INT"), ("name", "STRING"), ("value", "DECIMAL(10,2)"),
                                         ("updated_at", "TIMESTAMP")],
                [(i, "test_%d" % i, float(i * 10), "2019-01-01 00:00:00") for i in range(1, 6)])
    return s


SCOPES = {"adv_a": _adv_a, "adv_b": _adv_b}

# (id, name, statement, tables, critical, high_value) per scope
KEY_ITEMS = {
    "adv_a": [
        ("priced_by_reference", "Priced from a rate reference with history",
         "Event quantities carry no price; value needs the reference rate valid on each event date.",
         ["item_events", "unit_rate_ref"], True, False),
        ("tiny_master", "Tiny master with many inbound links",
         "A master of 20 rows or fewer that many tables point at is a business master, not noise.",
         ["code_master", "item_events", "usage_events", "asset_log"], True, False),
        ("no_money_unit_cost", "Usage without money, costed per unit",
         "Usage rows have no money column; cost needs the per-unit cost reference.",
         ["usage_events", "cost_per_unit_ref"], False, False),
        ("cross_domain", "Two groups joined through a shared hub",
         "Records of two groups only combine through the shared hub table.",
         ["group_x_records", "group_y_records", "shared_hub"], False, False),
        ("high_value_table", "One high-value table",
         "A small table whose values dominate the portfolio value must rank as high value.",
         ["contract_values"], False, True),
    ],
    "adv_b": [
        ("mixed_currency", "Amounts in mixed currencies",
         "One amount column holds several currencies; sums are wrong unless converted.",
         ["payments"], False, False),
        ("wrong_grain", "Daily snapshot next to events",
         "Snapshot rows and event rows have different grain; they must not be summed together.",
         ["daily_snapshot", "entity_events"], False, False),
        ("refunds_negative", "Refunds stored as negative amounts",
         "Negative lines are refunds; totals must net or separate them.",
         ["sales_lines"], False, False),
        ("stock_vs_flow", "Stock balance versus flow",
         "On-hand quantity is a point-in-time stock; moves are flow. Summing stock over time is wrong.",
         ["stock_balance", "stock_moves"], False, False),
        ("overlapping_pools", "Two overlapping pools",
         "The same members sit in both pools; adding the pools double counts.",
         ["pool_one", "pool_two"], False, False),
        ("dev_data", "Dev data table",
         "Tiny, stale, synthetic-looking rows are not business data and must be excluded.",
         ["scratch_dev_data"], False, False),
    ],
}


def generate_sql(scope, catalog, schema):
    if scope not in SCOPES:
        raise ValueError("unknown scope %r (use one of %s)" % (scope, sorted(SCOPES)))
    rng = random.Random("%s:%s" % (SEED, scope))

    def fq(name):
        return "%s.%s.%s" % (catalog, schema, name)

    return "".join(stmt + ";\n" for stmt in SCOPES[scope](rng, fq))


def build_key(scope):
    items = [{"id": i, "name": n, "statement": st, "tables": t, "critical": c, "high_value": h}
             for i, n, st, t, c, h in KEY_ITEMS[scope]]
    return {"scope": "bench6_" + scope, "source": "planted", "items": items}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--scope", required=True, choices=sorted(SCOPES))
    ap.add_argument("--catalog", required=True)
    ap.add_argument("--schema", required=True)
    ap.add_argument("--key-out", help="also write the scope's answer key to this path")
    a = ap.parse_args(argv)
    sys.stdout.write(generate_sql(a.scope, a.catalog, a.schema))
    if a.key_out:
        with open(a.key_out, "w") as f:
            json.dump(build_key(a.scope), f, indent=2)
            f.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
