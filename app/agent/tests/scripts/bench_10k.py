#!/usr/bin/env python3
"""bench_10k: deterministic SQL for the 10,000-table P0 scope (R15 milestones).

  bench_10k.py sql --catalog-prefix P [--catalogs 20 --schemas 10 --tables 50] [--create-catalogs] [--out F]

Catalogs P_c01.., schemas s01.. in each, empty tables per schema in a fixed role mix (20 transactional, 15 master, 8 reference,
7 technical for 50 tables; scaled proportionally for other sizes). Serverless-safe: CREATE ... IF NOT EXISTS only, never DROP,
DELETE, TRUNCATE or INSERT. Catalogs are created only with --create-catalogs. Names are generic; the suffix tells the role.
"""
import argparse
import sys

# role -> (share of 50, name suffix, column defs)
ROLE_SPEC = {
    "transactional": (20, "events", [("event_id", "BIGINT", "unique event id"), ("account_id", "BIGINT", "owning account"),
                                     ("amount", "DECIMAL(18,2)", "event amount"), ("event_ts", "TIMESTAMP", "when the event happened")]),
    "master": (15, "accounts", [("account_id", "BIGINT", "unique account id"), ("account_name", "STRING", "display name"),
                                ("segment", "STRING", "account segment"), ("created_date", "DATE", "creation date")]),
    "reference": (8, "codes", [("code", "STRING", "lookup code"), ("description", "STRING", "code meaning"),
                               ("valid_from", "DATE", "effective from"), ("valid_to", "DATE", "effective to")]),
    "technical": (7, "log", [("run_id", "STRING", "job run id"), ("step", "STRING", "step name"),
                             ("status", "STRING", "step status"), ("logged_at", "TIMESTAMP", "log time")]),
}
STEMS = ["orders", "items", "rates", "visits", "claims", "assets", "cases", "plans", "units", "tasks"]


def _counts(tables):
    """Role counts for `tables` per schema; exactly 20/15/8/7 at 50."""
    out, used = {}, 0
    roles = list(ROLE_SPEC)
    for r in roles[:-1]:
        out[r] = ROLE_SPEC[r][0] * tables // 50
        used += out[r]
    out[roles[-1]] = tables - used
    return out


def _schema_tables(tables):
    names = []
    for role, n in _counts(tables).items():
        suffix = ROLE_SPEC[role][1]
        for i in range(n):
            stem = STEMS[i % len(STEMS)]
            pre = "tmp_" if role == "technical" and i % 2 else ""
            names.append((f"{pre}{stem}_{i:02d}_{suffix}", role))
    return names


def _scope(prefix, catalogs, schemas, tables):
    for c in range(1, catalogs + 1):
        cat = f"{prefix}_c{c:02d}"
        for s in range(1, schemas + 1):
            yield cat, f"s{s:02d}"


def table_roles(catalog_prefix, catalogs=20, schemas=10, tables=50):
    spec = _schema_tables(tables)
    return {f"{cat}.{sch}.{n}": role for cat, sch in _scope(catalog_prefix, catalogs, schemas, tables) for n, role in spec}


def generate_sql(catalog_prefix, catalogs=20, schemas=10, tables=50, create_catalogs=False):
    stmts = []
    if create_catalogs:
        stmts += [f"CREATE CATALOG IF NOT EXISTS {catalog_prefix}_c{c:02d}" for c in range(1, catalogs + 1)]
    spec = _schema_tables(tables)
    for cat, sch in _scope(catalog_prefix, catalogs, schemas, tables):
        stmts.append(f"CREATE SCHEMA IF NOT EXISTS {cat}.{sch}")
        for name, role in spec:
            cols = ", ".join(f"{n} {t} COMMENT '{d}'" for n, t, d in ROLE_SPEC[role][2])
            stmts.append(f"CREATE TABLE IF NOT EXISTS {cat}.{sch}.{name} ({cols}) COMMENT '{role} table'")
    return stmts


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("sql")
    p.add_argument("--catalog-prefix", required=True)
    p.add_argument("--catalogs", type=int, default=20)
    p.add_argument("--schemas", type=int, default=10)
    p.add_argument("--tables", type=int, default=50)
    p.add_argument("--create-catalogs", action="store_true")
    p.add_argument("--out")
    a = ap.parse_args(argv)
    text = ";\n".join(generate_sql(a.catalog_prefix, a.catalogs, a.schemas, a.tables, a.create_catalogs)) + ";\n"
    if a.out:
        with open(a.out, "w") as f:
            f.write(text)
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
