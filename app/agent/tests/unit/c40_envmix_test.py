"""c40_envmix (REQ-583 accuracy gate): a planted dev/prod scope and a grader for the App's table labels (U8 v2).

scripts/bench6_envmix.py
  sql   --catalog C --prefix P            deterministic Serverless-safe SQL: CREATE SCHEMA IF NOT EXISTS + CREATE TABLE + INSERT, only
                                          inside catalog C, schemas named P_<name>; never creates catalogs, never drops or deletes.
  key   --catalog C --prefix P --out K    answer key {"scope":"bench6_envmix","schemas":[{fqn,env}],"tables":[{fqn,env,role}]}
                                          env prod|dev; role transactional|master|reference|technical for prod tables, null for dev.
  grade --key K --labels L [--min-dev-recall X] [--min-role-accuracy Y] [--out R]
                                          L = JSON list of __inspire_table_labels rows {level, object_fqn, env, label, source}.
                                          Report: dev_recall (dev tables that end up excluded / all dev tables), role_accuracy (prod tables
                                          whose label matches / all prod tables), misses [{fqn, expected, got}]. A table under a schema
                                          labelled dev counts as excluded (top-down, U8 v2). Exit 1 when below a given minimum, else 0.
Python API used here: generate_sql(catalog, prefix), build_key(catalog, prefix), grade(key, labels) -> dict.
"""
import importlib.util
import json
import re
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "bench6_envmix.py"
BANNED = ["bakehouse", "nyctaxi", "healthverity", "tpcds", "patient", "provider", "dough", "retail",
          "banking", "finance", "manufacturing", "healthcare", "insurance", "logistics", "hospitality",
          "construction", "bank", "airline", "hospital", "telecom", "bakery", "loan", "sku"]
CAT, PFX = "benchcat", "envmix"


def _mod():
    spec = importlib.util.spec_from_file_location("bench6_envmix", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _perfect_labels(key):
    rows = [{"level": "schema", "object_fqn": s["fqn"], "env": s["env"], "label": None, "source": "app:test"} for s in key["schemas"]]
    rows += [{"level": "table", "object_fqn": t["fqn"], "env": t["env"], "label": t["role"] or "technical", "source": "app:test"}
             for t in key["tables"]]
    return rows


def test_1_sql_is_deterministic_and_stays_inside_the_catalog():
    m = _mod()
    sql = m.generate_sql(CAT, PFX)
    assert sql == m.generate_sql(CAT, PFX)
    statements = [s.strip() for s in sql.split(";") if s.strip()]
    assert statements and all(re.match(r"(CREATE SCHEMA IF NOT EXISTS|CREATE TABLE|INSERT INTO) ", s) for s in statements), statements[:3]
    targets = re.findall(r"(?:SCHEMA IF NOT EXISTS|TABLE|INSERT INTO) ([\w.`]+)", sql)
    assert targets and all(t.replace("`", "").startswith(f"{CAT}.{PFX}_") for t in targets), [t for t in targets if not t.startswith(CAT)][:3]
    assert not re.search(r"\b(DROP|DELETE|TRUNCATE|CREATE CATALOG)\b", sql, re.I)


def test_2_key_covers_every_planted_table_with_both_envs_and_all_roles():
    m = _mod()
    key = m.build_key(CAT, PFX)
    planted = {t.replace("`", "") for t in re.findall(r"CREATE TABLE ([\w.`]+)", m.generate_sql(CAT, PFX))}
    assert {t["fqn"] for t in key["tables"]} == planted
    assert {s["env"] for s in key["schemas"]} == {"prod", "dev"} and len(key["schemas"]) >= 4
    prod = [t for t in key["tables"] if t["env"] == "prod"]
    assert {t["role"] for t in prod} == {"transactional", "master", "reference", "technical"}
    assert all(t["role"] is None for t in key["tables"] if t["env"] == "dev")
    dev_in_prod_schema = [t for t in key["tables"] if t["env"] == "dev" and
                          next(s["env"] for s in key["schemas"] if t["fqn"].startswith(s["fqn"] + ".")) == "prod"]
    assert len(dev_in_prod_schema) >= 3, "dev-looking tables (copies, test, temp loads) must also sit inside prod schemas"


def test_3_perfect_labels_score_100_and_misses_are_listed():
    m = _mod()
    key = m.build_key(CAT, PFX)
    report = m.grade(key, _perfect_labels(key))
    assert (report["dev_recall"], report["role_accuracy"], report["misses"]) == (1.0, 1.0, [])
    leaked = next(t for t in key["tables"] if t["env"] == "dev" and not any(t["fqn"].startswith(s["fqn"] + ".") for s in key["schemas"] if s["env"] == "dev"))
    ref = next(t for t in key["tables"] if t["role"] == "reference")
    labels = [dict(r, env="prod", label="transactional") if r["object_fqn"] == leaked["fqn"] else
              dict(r, label="transactional") if r["object_fqn"] == ref["fqn"] else r for r in _perfect_labels(key)]
    report = m.grade(key, labels)
    assert report["dev_recall"] < 1.0 and report["role_accuracy"] < 1.0
    assert {miss["fqn"] for miss in report["misses"]} == {leaked["fqn"], ref["fqn"]}


def test_4_a_dev_schema_row_excludes_its_tables_without_table_rows():
    m = _mod()
    key = m.build_key(CAT, PFX)
    dev_schemas = {s["fqn"] for s in key["schemas"] if s["env"] == "dev"}
    labels = [r for r in _perfect_labels(key) if not (r["level"] == "table" and r["object_fqn"].rsplit(".", 1)[0] in dev_schemas)]
    assert m.grade(key, labels)["dev_recall"] == 1.0


def test_5_cli_gate_exits_1_below_the_minimum(tmp_path):
    m = _mod()
    key = m.build_key(CAT, PFX)
    (tmp_path / "k.json").write_text(json.dumps(key))
    (tmp_path / "good.json").write_text(json.dumps(_perfect_labels(key)))
    (tmp_path / "none.json").write_text("[]")
    base = ["grade", "--key", str(tmp_path / "k.json"), "--min-dev-recall", "1.0", "--min-role-accuracy", "0.9"]
    assert m.main(base + ["--labels", str(tmp_path / "good.json")]) == 0
    assert m.main(base + ["--labels", str(tmp_path / "none.json")]) == 1


def test_6_no_industry_words():
    text = SCRIPT.read_text().lower()
    assert not [w for w in BANNED if re.search(r"\b%s\b" % w, text)]
