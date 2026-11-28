"""c35_bench: frozen benchmark manifest, answer keys, planted generator, gold-label tool (R2.1, R2.2, R2.4)."""
import csv
import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

AGENT = Path(__file__).resolve().parents[2]
REG = AGENT / "tests" / "regression"
BENCH = REG / "bench6"
SCRIPTS = AGENT / "tests" / "scripts"

WIDGET_KEYS = {"01_uc_metadata", "business_context", "priorities",
               "generation_instructions", "04_table_election", "quality_mode"}
CASES_A = {"priced_by_reference", "tiny_master", "no_money_unit_cost", "cross_domain", "high_value_table"}
CASES_B = {"mixed_currency", "wrong_grain", "refunds_negative", "stock_vs_flow", "overlapping_pools", "dev_data"}
# Reused from v101_cascade_timeout_coordination_test.py and v120_prompt_contract_test.py
BANNED = ["bakehouse", "nyctaxi", "healthverity", "tpcds", "patient", "provider", "dough", "retail",
          "banking", "finance", "manufacturing", "healthcare", "insurance", "logistics", "hospitality",
          "construction", "bank", "airline", "hospital", "telecom", "bakery", "loan", "sku"]


def _load(name):
    path = SCRIPTS / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _manifest():
    return json.loads((BENCH / "manifest.json").read_text())


def _key(scope):
    return json.loads((BENCH / scope["answer_key"].split("bench6/", 1)[1]).read_text())


def test_manifest_has_six_scopes_with_widgets_and_keys():
    m = _manifest()
    scopes = m["scopes"]
    assert len(scopes) == 6
    assert [s["role"] for s in scopes].count("holdout") == 1
    assert [s["role"] for s in scopes].count("adversarial") == 2
    assert [s["role"] for s in scopes].count("standard") == 3
    for s in scopes:
        assert set(s["widgets"]) == WIDGET_KEYS, s["id"]
        key = _key(s)
        assert key["scope"] == s["id"]
        assert len(key["items"]) >= 5, s["id"]


def test_every_key_item_names_tables_and_planted_tables_exist_in_ddl():
    gen = _load("bench6_planted")
    for s in _manifest()["scopes"]:
        key = _key(s)
        assert key["source"] in {"planted", "expert", "existing_gold"}
        for it in key["items"]:
            assert it["tables"], (s["id"], it["id"])
            assert set(it) >= {"id", "name", "statement", "tables", "critical", "high_value"}
        if s["role"] == "adversarial":
            assert key["source"] == "planted"
            sql = gen.generate_sql(s["id"].split("_", 1)[1] if s["id"].startswith("bench6_") else s["id"],
                                   "cat", "sch")
            ddl = set(re.findall(r"CREATE TABLE cat\.sch\.(\w+)", sql))
            for it in key["items"]:
                assert set(it["tables"]) <= ddl, (it["id"], set(it["tables"]) - ddl)
        else:
            assert key["source"] == "existing_gold"


def test_existing_gold_keys_match_old_files():
    for sid in ("bakehouse", "nyctaxi", "tpcds_sf1", "tpch"):
        old = json.loads((REG / f"{sid}_gold.json").read_text())
        key = json.loads((BENCH / "keys" / f"{sid}.json").read_text())
        assert [i["id"] for i in key["items"]] == [e["id"] for e in old["entries"]]


def test_generator_is_deterministic_and_safe():
    gen = _load("bench6_planted")
    for scope in ("adv_a", "adv_b"):
        one = gen.generate_sql(scope, "cat", "sch")
        two = gen.generate_sql(scope, "cat", "sch")
        assert one == two and "CREATE TABLE" in one and "INSERT INTO" in one
        for bad in ("CREATE CATALOG", "DROP ", "DELETE"):
            assert bad not in one.upper()
    out = subprocess.run([sys.executable, str(SCRIPTS / "bench6_planted.py"), "--scope", "adv_a",
                          "--catalog", "cat", "--schema", "sch"], capture_output=True, text=True)
    assert out.returncode == 0, out.stderr
    assert out.stdout == gen.generate_sql("adv_a", "cat", "sch")


def test_planted_cases_each_in_exactly_one_adversarial_scope_and_criticals():
    adv = [s for s in _manifest()["scopes"] if s["role"] == "adversarial"]
    seen = [c for s in adv for c in s["planted"]]
    assert sorted(seen) == sorted(CASES_A | CASES_B)
    by_scope = {s["id"]: set(s["planted"]) for s in adv}
    assert sorted(map(sorted, by_scope.values())) == sorted(map(sorted, [CASES_A, CASES_B]))
    items = {it["id"]: it for s in adv for it in _key(s)["items"]}
    assert set(items) >= CASES_A | CASES_B
    assert items["priced_by_reference"]["critical"] is True
    assert items["tiny_master"]["critical"] is True
    assert items["high_value_table"]["high_value"] is True
    gen = _load("bench6_planted")
    for scope in ("adv_a", "adv_b"):
        assert gen.build_key(scope)["items"] == _key(
            next(s for s in adv if s["id"].endswith(scope)))["items"]


def _write_csv(path, rows):
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["table", "structure", "roles"])
        w.writeheader()
        w.writerows(rows)


def test_labels_reconcile_lists_exactly_the_disagreements_and_refuses_gold(tmp_path):
    lab = _load("bench6_labels")
    tables = tmp_path / "tables.json"
    tables.write_text(json.dumps([{"table": f"c.s.t{i}", "columns": ["a", "b"]} for i in range(4)]))
    sheet = tmp_path / "sheet.csv"
    lab.write_sheet(str(tables), str(sheet))
    rows = list(csv.DictReader(open(sheet)))
    assert [r["table"] for r in rows] == [f"c.s.t{i}" for i in range(4)]
    assert all(r["structure"] == "" and r["roles"] == "" for r in rows), "tool never fills labels"
    a = [{"table": f"c.s.t{i}", "structure": "master", "roles": "mapping"} for i in range(4)]
    b = [dict(r) for r in a]
    b[1]["structure"] = "reference"
    b[3]["roles"] = "price;cost"
    pa, pb = tmp_path / "a.csv", tmp_path / "b.csv"
    _write_csv(pa, a)
    _write_csv(pb, b)
    dis = lab.reconcile(str(pa), str(pb))
    assert sorted(d["table"] for d in dis) == ["c.s.t1", "c.s.t3"]
    gold = tmp_path / "gold.json"
    with pytest.raises(ValueError):
        lab.write_gold(str(pa), str(pb), str(gold))
    assert not gold.exists()
    settled = tmp_path / "settled.csv"
    _write_csv(settled, [{"table": "c.s.t1", "structure": "reference", "roles": "mapping"},
                         {"table": "c.s.t3", "structure": "master", "roles": "mapping;price"}])
    assert lab.reconcile(str(pa), str(pb), str(settled)) == []
    lab.write_gold(str(pa), str(pb), str(gold), str(settled))
    g = json.loads(gold.read_text())
    assert len(g["labels"]) == 4


def test_planted_generator_has_no_industry_words():
    text = (SCRIPTS / "bench6_planted.py").read_text().lower()
    hits = [w for w in BANNED if re.search(r"\b%s\b" % w, text)]
    assert hits == []
