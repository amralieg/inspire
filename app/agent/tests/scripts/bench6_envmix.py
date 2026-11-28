#!/usr/bin/env python3
"""bench6 envmix: planted dev/prod scope and grader for the App table labels (REQ-583, contract U8 v2).

  bench6_envmix.py sql   --catalog C --prefix P            Serverless-safe SQL (CREATE SCHEMA IF NOT EXISTS, CREATE TABLE, INSERT INTO)
  bench6_envmix.py key   --catalog C --prefix P --out K    answer key {"scope","schemas":[{fqn,env}],"tables":[{fqn,env,role}]}
  bench6_envmix.py grade --key K --labels L [--min-dev-recall X] [--min-role-accuracy Y] [--out R]

Only writes inside catalog C, schemas P_<name>; never creates catalogs, never drops or deletes. Names are generic on purpose.
Grading: dev_recall = dev tables excluded / all dev tables; a table is excluded when its own label row has env dev, or its
schema row has env dev (top-down). role_accuracy = prod tables whose label equals the key role / all prod tables.
Exit 1 when a given minimum is not met.

Planted hard cases (the columns, not the name, tell them apart):
  sales.activity_feed       transactional (amount + customer ref + event date) although the name sounds like a log
  sales.rate_card           reference (code + effective dates, few rows) although the name sounds like a master
  ops.audit_trail           technical (run id, step, status) next to business tables
  ops.stock_moves           transactional (quantity + date), not a master
  *.orders_bkp_2023, test_customers, tmp_orders_load   dev-looking tables inside prod schemas (copies, test, temp loads)
  sales_dev.orders / customers   dev schema holding tables with prod-looking names
  sandbox.region_codes      dev schema holding a reference-looking table
"""
import argparse
import json
import random
import sys

SEED = 20261128
ROLES = ("transactional", "master", "reference", "technical")

# (schema suffix, env, [(table, env, role, kind, rows)])
PLAN = [
    ("sales", "prod", [
        ("orders", "prod", "transactional", "txn", 30),
        ("order_lines", "prod", "transactional", "txn", 40),
        ("activity_feed", "prod", "transactional", "txn", 25),
        ("customers", "prod", "master", "master", 20),
        ("products", "prod", "master", "master", 15),
        ("status_codes", "prod", "reference", "ref", 10),
        ("rate_card", "prod", "reference", "ref", 12),
        ("etl_run_log", "prod", "technical", "tech", 20),
        ("orders_bkp_2023", "dev", None, "txn", 15),
        ("test_customers", "dev", None, "master", 10),
        ("tmp_orders_load", "dev", None, "txn", 12),
    ]),
    ("ops", "prod", [
        ("stock_moves", "prod", "transactional", "txn", 30),
        ("shipments", "prod", "transactional", "txn", 25),
        ("sites", "prod", "master", "master", 12),
        ("carriers", "prod", "master", "master", 10),
        ("country_lookup", "prod", "reference", "ref", 15),
        ("unit_codes", "prod", "reference", "ref", 10),
        ("audit_trail", "prod", "technical", "tech", 25),
        ("job_state", "prod", "technical", "tech", 10),
        ("sites_copy_old", "dev", None, "master", 10),
        ("tmp_shipments_load", "dev", None, "txn", 12),
    ]),
    ("sales_dev", "dev", [
        ("orders", "dev", None, "txn", 15),
        ("customers", "dev", None, "master", 10),
        ("etl_run_log", "dev", None, "tech", 10),
    ]),
    ("sandbox", "dev", [
        ("scratch_orders", "dev", None, "txn", 12),
        ("region_codes", "dev", None, "ref", 10),
        ("staging_sites", "dev", None, "master", 10),
    ]),
]

COLS = {
    "txn": [("id", "INT"), ("ref_id", "INT"), ("amount", "DECIMAL(12,2)"), ("event_date", "DATE")],
    "master": [("id", "INT"), ("name", "STRING"), ("status", "STRING"), ("created_on", "DATE")],
    "ref": [("code", "STRING"), ("description", "STRING"), ("effective_from", "DATE")],
    "tech": [("run_id", "INT"), ("step", "STRING"), ("state", "STRING"), ("logged_at", "TIMESTAMP")],
}


def _lit(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def _date(rng):
    return "%d-%02d-%02d" % (2024 + rng.randint(0, 1), rng.randint(1, 12), rng.randint(1, 28))


def _row(kind, i, rng):
    if kind == "txn":
        return (i, rng.randint(1, 20), round(rng.uniform(1, 900), 2), _date(rng))
    if kind == "master":
        return (i, "Name %03d" % i, rng.choice(["active", "inactive"]), _date(rng))
    if kind == "ref":
        return ("C%02d" % i, "Description %d" % i, _date(rng))
    return (i, rng.choice(["extract", "load", "check"]), rng.choice(["ok", "retry", "failed"]),
            _date(rng) + " %02d:00:00" % rng.randint(0, 23))


def _fqn(catalog, prefix, schema, table=None):
    base = "%s.%s_%s" % (catalog, prefix, schema)
    return base if table is None else base + "." + table


def generate_sql(catalog, prefix):
    rng = random.Random(SEED)
    out = []
    for schema, _env, tables in PLAN:
        out.append("CREATE SCHEMA IF NOT EXISTS %s" % _fqn(catalog, prefix, schema))
        for name, _e, _r, kind, n in tables:
            fq = _fqn(catalog, prefix, schema, name)
            out.append("CREATE TABLE %s (%s)" % (fq, ", ".join("%s %s" % c for c in COLS[kind])))
            vals = ", ".join("(" + ", ".join(_lit(v) for v in _row(kind, i, rng)) + ")" for i in range(1, n + 1))
            out.append("INSERT INTO %s VALUES %s" % (fq, vals))
    return ";\n".join(out) + ";\n"


def build_key(catalog, prefix):
    schemas = [{"fqn": _fqn(catalog, prefix, s), "env": env} for s, env, _ in PLAN]
    tables = [{"fqn": _fqn(catalog, prefix, s, t), "env": e, "role": r}
              for s, _env, ts in PLAN for t, e, r, _k, _n in ts]
    return {"scope": "bench6_envmix", "schemas": schemas, "tables": tables}


def grade(key, labels):
    schema_env = {r["object_fqn"]: r.get("env") for r in labels if r.get("level") == "schema"}
    table_row = {r["object_fqn"]: r for r in labels if r.get("level") == "table"}
    dev_total = dev_hit = prod_total = prod_hit = 0
    misses = []
    for t in key["tables"]:
        row = table_row.get(t["fqn"])
        if t["env"] == "dev":
            dev_total += 1
            schema = t["fqn"].rsplit(".", 1)[0]
            excluded = schema_env.get(schema) == "dev" or (row is not None and row.get("env") == "dev")
            if excluded:
                dev_hit += 1
            else:
                misses.append({"fqn": t["fqn"], "expected": "dev", "got": (row or {}).get("env")})
        else:
            prod_total += 1
            got = (row or {}).get("label")
            if schema_env.get(t["fqn"].rsplit(".", 1)[0]) == "dev" or (row or {}).get("env") == "dev":
                got = "excluded as dev"
            if got == t["role"]:
                prod_hit += 1
            else:
                misses.append({"fqn": t["fqn"], "expected": t["role"], "got": got})
    return {"dev_recall": dev_hit / dev_total if dev_total else 1.0,
            "role_accuracy": prod_hit / prod_total if prod_total else 1.0,
            "dev_tables": dev_total, "prod_tables": prod_total, "misses": misses}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("sql", "key"):
        p = sub.add_parser(name)
        p.add_argument("--catalog", required=True)
        p.add_argument("--prefix", required=True)
        if name == "key":
            p.add_argument("--out")
    g = sub.add_parser("grade")
    g.add_argument("--key", required=True)
    g.add_argument("--labels", required=True)
    g.add_argument("--min-dev-recall", type=float)
    g.add_argument("--min-role-accuracy", type=float)
    g.add_argument("--out")
    a = ap.parse_args(argv)
    if a.cmd == "sql":
        sys.stdout.write(generate_sql(a.catalog, a.prefix))
        return 0
    if a.cmd == "key":
        text = json.dumps(build_key(a.catalog, a.prefix), indent=2)
        if a.out:
            with open(a.out, "w") as f:
                f.write(text)
        else:
            print(text)
        return 0
    with open(a.key) as f:
        key = json.load(f)
    with open(a.labels) as f:
        labels = json.load(f)
    report = grade(key, labels)
    text = json.dumps(report, indent=2)
    if a.out:
        with open(a.out, "w") as f:
            f.write(text)
    print(text)
    if a.min_dev_recall is not None and report["dev_recall"] < a.min_dev_recall:
        return 1
    if a.min_role_accuracy is not None and report["role_accuracy"] < a.min_role_accuracy:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
