#!/usr/bin/env python3
"""bench6 gold-label tool for two labellers (R2.2, R6.3). Never fills labels itself.

  sheet     --tables tables.json --out sheet.csv          (blank structure + roles columns)
  reconcile --a a.csv --b b.csv [--settled s.csv]         (lists disagreements; exit 1 if any open)
  gold      --a a.csv --b b.csv --settled s.csv --out gold.json  (refuses while any is open)

tables.json: list of {"table": "cat.schema.name", "columns": [...]} (from information_schema).
Structure: master, transaction, reference, snapshot/aggregate, mixed, unknown, technical.
Roles (several allowed, ';' separated): price, cost, entitlement, constraint, outcome, mapping.
"""
import argparse
import csv
import json
import sys

FIELDS = ["table", "structure", "roles"]
STRUCTURES = {"master", "transaction", "reference", "snapshot/aggregate", "mixed", "unknown", "technical"}
ROLES = {"price", "cost", "entitlement", "constraint", "outcome", "mapping"}


def _name(t):
    return t.get("table") or t.get("table_name") or t.get("full_name")


def write_sheet(tables_json, out_csv):
    with open(tables_json) as f:
        tables = json.load(f)
    with open(out_csv, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        for t in tables:
            w.writerow({"table": _name(t), "structure": "", "roles": ""})


def _norm(row):
    structure = (row.get("structure") or "").strip().lower()
    roles = sorted({r.strip().lower() for r in (row.get("roles") or "").split(";") if r.strip()})
    return structure, roles


def _read(path):
    with open(path, newline="") as f:
        return {r["table"]: _norm(r) for r in csv.DictReader(f)}


def _validate(label, where):
    structure, roles = label
    if structure not in STRUCTURES:
        raise ValueError("%s: structure %r is not one of %s" % (where, structure, sorted(STRUCTURES)))
    bad = [r for r in roles if r not in ROLES]
    if bad:
        raise ValueError("%s: unknown roles %s" % (where, bad))


def reconcile(a_csv, b_csv, settled_csv=None):
    """Return the disagreements that are still open (empty list when every one is settled)."""
    a, b = _read(a_csv), _read(b_csv)
    settled = _read(settled_csv) if settled_csv else {}
    open_ = []
    for table in sorted(set(a) | set(b)):
        la, lb = a.get(table), b.get(table)
        if la is not None and la == lb and la[0]:
            continue
        if table in settled and settled[table][0]:
            continue
        open_.append({"table": table, "a": la, "b": lb})
    return open_


def write_gold(a_csv, b_csv, out_json, settled_csv=None):
    open_ = reconcile(a_csv, b_csv, settled_csv)
    if open_:
        raise ValueError("%d unsettled disagreement(s): %s" % (len(open_), [d["table"] for d in open_]))
    a, b = _read(a_csv), _read(b_csv)
    settled = _read(settled_csv) if settled_csv else {}
    labels = []
    for table in sorted(set(a) | set(b)):
        label = settled.get(table) or a[table]
        _validate(label, table)
        labels.append({"table": table, "structure": label[0], "roles": label[1],
                       "settled": table in settled})
    with open(out_json, "w") as f:
        json.dump({"version": 1, "labels": labels}, f, indent=2)
        f.write("\n")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sheet")
    s.add_argument("--tables", required=True)
    s.add_argument("--out", required=True)
    for name in ("reconcile", "gold"):
        p = sub.add_parser(name)
        p.add_argument("--a", required=True)
        p.add_argument("--b", required=True)
        p.add_argument("--settled")
        if name == "gold":
            p.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    if a.cmd == "sheet":
        write_sheet(a.tables, a.out)
        return 0
    if a.cmd == "reconcile":
        open_ = reconcile(a.a, a.b, a.settled)
        for d in open_:
            print(json.dumps(d))
        print("%d open disagreement(s)" % len(open_))
        return 1 if open_ else 0
    try:
        write_gold(a.a, a.b, a.out, a.settled)
    except ValueError as e:
        print("refused: %s" % e, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
