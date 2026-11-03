"""v1.4.0 use-case kinds: kind recall gold sets and release gates.

Every gold entry names a kind from app_shell/kinds.json. The benchmark reads a use case's labeled kind, else the kind
of its technique, and gates a release on kind recall (80%), families (6, or fewer when fewer have a must-find entry),
must-reject entries (T7) and the kind-floor Best-of-Best gap (D7). Each gate has a case it must pass and one it must
fail (CLAUDE.md 8.3).
"""
import json
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "tests", "scripts"))

import recall_benchmark as rb  # noqa: E402

REGRESSION = os.path.join(ROOT, "tests", "regression")
CORPORA = ("tpcds_sf1", "tpch", "bakehouse", "nyctaxi")
DEMOS = {"tpcds_sf1": "tpcds_sf1/docs/tpcds_sf1-dbx_inspire.json",
         "bakehouse": "bakehouse/docs/Samples bakehouse-dbx_inspire.json",
         "nyctaxi": "nyctaxi/docs/Samples nyctaxi-dbx_inspire.json"}
REGISTRY = rb.load_registry()
FAMILY = {k["id"]: k["family"] for k in REGISTRY["kinds"]}


def load(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def gold_of(corpus):
    return load(os.path.join(REGRESSION, f"{corpus}_gold.json"))


def uc(uc_id, name, tables, kind="", technique="", bob=None, basis="", score=8.0, statement=""):
    return {"id": uc_id, "use_case": name, "statement": statement, "solution": "", "tables_involved": tables,
            "inspire_score": score, "bob_score": bob, "use_case_kind": kind, "analytics_technique": technique,
            "selection_basis": basis}


def fixture_gold(kinds, rejects=()):
    return {"corpus": "fixture", "release_gate": {"rule": "fixture"},
            "entries": [{"id": f"G{i}", "title": f"Entry {i}", "decision": "d", "owner": "o", "why": "w", "kind": k,
                         "required_tables": [f"t{i}"], "any_of": [], "signal_columns": []} for i, k in enumerate(kinds)],
            "must_reject": list(rejects)}


SIX = ["forecast", "allocation", "driver_breakdown", "anomaly", "segmentation", "process_mining"]


def portfolio(kinds, basis="earned", bob=7.0):
    return [uc(f"U{i}", f"Use case {i}", f"c.s.t{i}", kind=k, bob=bob, basis=basis) for i, k in enumerate(kinds)]


@pytest.mark.parametrize("corpus", CORPORA)
def test_every_gold_set_cites_real_tables_and_registry_kinds(corpus):
    gold = gold_of(corpus)
    schema = load(os.path.join(REGRESSION, f"{corpus}_schema.json"))["tables"]
    assert gold["corpus"] == f"samples.{corpus}" and gold["schema_version"] == 3
    ids = [e["id"] for e in gold["entries"]] + [r["id"] for r in gold["must_reject"]]
    assert len(ids) == len(set(ids)) and len(gold["must_reject"]) >= 3
    for entry in gold["entries"]:
        assert entry["kind"] in FAMILY, (entry["id"], entry["kind"])
        assert all(k in FAMILY and k != entry["kind"] for k in entry.get("also_kinds", [])), entry["id"]
        allowed = set(entry["required_tables"]) | {t for group in entry["any_of"] for t in group}
        assert allowed and all(t in schema for t in allowed), entry["id"]
        for ref in entry["signal_columns"]:
            table, column = ref.split(".")
            assert table in allowed and column in schema[table], (entry["id"], ref)
    for entry in gold["must_reject"]:
        allowed = set(entry["required_tables"]) | {t for group in entry["any_of"] for t in group}
        assert allowed and all(t in schema for t in allowed) and entry["patterns"], entry["id"]
    families = {FAMILY[e["kind"]] for e in gold["entries"]}
    assert len(families) >= 6, (corpus, sorted(families))
    text = json.dumps(gold).lower()
    for customer in ("alshaya", "asabe", "shahid"):
        assert customer not in text


def test_the_new_gold_sets_cover_the_columns_the_plan_names():
    cited = {c: {s for e in gold_of(c)["entries"] for s in e["signal_columns"]} for c in ("tpch", "bakehouse", "nyctaxi")}
    assert {"lineitem.l_shipdate", "lineitem.l_commitdate", "lineitem.l_receiptdate"} <= cited["tpch"]
    assert {"lineitem.l_extendedprice", "lineitem.l_discount"} <= cited["tpch"]
    assert {"sales_franchises.latitude", "sales_franchises.longitude", "media_customer_reviews.review",
            "sales_suppliers.supplierID"} <= cited["bakehouse"]
    assert {"trips.pickup_zip", "trips.dropoff_zip", "trips.tpep_dropoff_datetime", "trips.fare_amount"} <= cited["nyctaxi"]
    kinds = {e["kind"] for e in gold_of("tpch")["entries"]}
    assert {"process_mining", "sla_aging", "driver_breakdown"} <= kinds


def test_tpcds_keeps_its_25_entries_and_gates_21_found():
    gold = gold_of("tpcds_sf1")
    assert len(gold["entries"]) == 25 and gold["release_gate"]["min_found"] == 21
    assert gold["release_gate"]["baseline"]["found"] == 18


@pytest.mark.parametrize("corpus", CORPORA)
def test_each_must_reject_fires_on_its_trivial_idea_and_spares_every_must_find(corpus):
    gold = gold_of(corpus)

    def tables(entry):
        return ", ".join(f"c.s.{t}" for t in entry["required_tables"] + [g[0] for g in entry["any_of"]])
    trivial = [rb.normalize_uc(uc(r["id"], r["title"], tables(r))) for r in gold["must_reject"]]
    assert [h["id"] for h in rb.must_reject_hits(gold, trivial)] == [r["id"] for r in gold["must_reject"]]
    findings = [rb.normalize_uc(uc(e["id"], e["title"], tables(e), statement=e["decision"])) for e in gold["entries"]]
    assert rb.must_reject_hits(gold, findings) == []


@pytest.mark.parametrize("corpus", sorted(DEMOS))
def test_the_shipped_demo_catalogs_select_no_must_reject_entry(corpus):
    use_cases = rb.load_catalog_use_cases(rb.Path(ROOT, "demos", DEMOS[corpus]))
    ranked = [rb.normalize_uc(u) for u in use_cases]
    assert len(ranked) >= 9 and rb.must_reject_hits(gold_of(corpus), ranked) == []


def test_must_reject_needs_the_tables_and_honors_unless():
    reject = {"id": "R1", "title": "Total sales by store", "required_tables": ["store_sales", "store"], "any_of": [],
              "patterns": [r"\btotal sales by store\b"], "unless": [r"\bforecast"]}
    gold = fixture_gold([], [reject])
    ucs = [rb.normalize_uc(u) for u in (uc("A", "Total sales by store", "c.s.store_sales, c.s.store"),
                                         uc("B", "Total sales by store", "c.s.store_sales"),
                                         uc("C", "Forecast total sales by store", "c.s.store_sales, c.s.store"))]
    assert rb.must_reject_hits(gold, ucs) == [{"id": "R1", "title": "Total sales by store", "selected": ["A"]}]


def test_kind_resolution_reads_the_label_then_the_technique():
    norm = lambda **kw: rb.normalize_uc(uc("X", "n", "c.s.t", **kw))
    assert rb.resolve_kind(norm(kind="process_mining"), REGISTRY) == ("process_mining", "labeled")
    assert rb.resolve_kind(norm(kind="Process mining"), REGISTRY) == ("process_mining", "labeled")
    assert rb.resolve_kind(norm(kind="34"), REGISTRY) == ("process_mining", "labeled")
    assert rb.resolve_kind(norm(kind="34. Process mining"), REGISTRY) == ("process_mining", "labeled")
    assert rb.resolve_kind(norm(kind="", technique="Forecasting"), REGISTRY) == ("forecast", "technique")
    assert rb.resolve_kind(norm(kind="nonsense", technique="Statistical Process Control"), REGISTRY) == ("process_control", "technique")
    assert rb.resolve_kind(norm(kind="", technique="Astrology"), REGISTRY) == ("", "")
    catalog = rb.normalize_uc({"No": "N01", "Name": "n", "Use Case Kind": "Forecast", "Analytics Technique": "Clustering",
                               "selection_basis": "Kind_Floor"})
    assert rb.resolve_kind(catalog, REGISTRY) == ("forecast", "labeled") and catalog["basis"] == "kind_floor"


def test_a_gold_entry_without_a_kind_is_refused():
    gold = fixture_gold(["forecast"])
    del gold["entries"][0]["kind"]
    with pytest.raises(ValueError, match="gold entry G0 has no kind from the registry"):
        rb.score(gold, [], registry=REGISTRY)
    gold["entries"][0]["kind"] = "astrology"
    with pytest.raises(ValueError, match="gold entry G0 has no kind from the registry"):
        rb.score(gold, [], registry=REGISTRY)


def test_kind_recall_counts_only_matches_of_the_entry_kind_or_its_also_kinds():
    gold = fixture_gold(["forecast", "anomaly"])
    gold["entries"][1]["also_kinds"] = ["controls_testing"]
    ucs = [uc("A", "a", "c.s.t0", kind="segmentation"), uc("B", "b", "c.s.t1", kind="controls_testing")]
    report = rb.score(gold, ucs, registry=REGISTRY)
    rows = {r["id"]: r for r in report["entries"]}
    assert rows["G0"]["matches"] == ["A"] and rows["G0"]["kind_matches"] == [], "found, but as the wrong kind"
    assert rows["G1"]["kind_matches"] == ["B"], "an also_kind counts"
    assert report["kinds"]["kind_recall"] == 0.5 and report["kinds"]["kind_missed"] == ["G0"]


def test_the_kind_recall_gate_passes_at_80_percent_and_fails_below():
    gold = fixture_gold(["forecast"] * 5)
    good = portfolio(["forecast"] * 4 + ["anomaly"])
    kinds = rb.score(gold, good, registry=REGISTRY)["kinds"]
    assert kinds["kind_recall"] == 0.8 and not any("kind recall" in r for r in rb.kind_gate(kinds))
    bad = portfolio(["forecast"] * 3 + ["anomaly"] * 2)
    kinds = rb.score(gold, bad, registry=REGISTRY)["kinds"]
    assert any(r.startswith("kind recall 60% is below 80%") for r in rb.kind_gate(kinds))


def test_the_family_gate_needs_six_families_when_six_have_a_must_find():
    gold = fixture_gold(SIX)
    kinds = rb.score(gold, portfolio(SIX), registry=REGISTRY)["kinds"]
    assert kinds["families_required"] == 6 and len(kinds["families_hit"]) == 6 and rb.kind_gate(kinds) == []
    five = SIX[:5] + ["forecast"]
    kinds = rb.score(gold, portfolio(five), registry=REGISTRY)["kinds"]
    assert any("5 of the 6 required families" in r for r in rb.kind_gate(kinds))


def test_the_family_gate_asks_only_for_families_with_a_must_find_or_detected():
    gold = fixture_gold(["forecast", "anomaly", "segmentation"])
    kinds = rb.score(gold, portfolio(["forecast", "anomaly", "segmentation"]), registry=REGISTRY)["kinds"]
    assert kinds["families_required"] == 3 and not any("families" in r for r in rb.kind_gate(kinds))
    kinds = rb.score(fixture_gold(SIX), portfolio(SIX[:4] + ["forecast", "forecast"]), registry=REGISTRY,
                     detected=SIX[:4])["kinds"]
    assert kinds["families_required"] == 4 and not any("families" in r for r in rb.kind_gate(kinds))
    kinds = rb.score(fixture_gold(SIX), portfolio(SIX[:4] + ["forecast", "forecast"]), registry=REGISTRY)["kinds"]
    assert any("4 of the 6 required families" in r for r in rb.kind_gate(kinds))


def test_a_selected_must_reject_fails_the_gate():
    reject = {"id": "R1", "title": "Count of rows", "required_tables": ["t0"], "any_of": [], "patterns": [r"^count of rows\b"]}
    ucs = portfolio(SIX)
    ucs.append(uc("BAD", "Count of rows", "c.s.t0", kind="driver_breakdown", bob=7.0, basis="earned"))
    kinds = rb.score(fixture_gold(SIX, [reject]), ucs, registry=REGISTRY)["kinds"]
    assert rb.kind_gate(kinds) == ["must-reject R1 (Count of rows) selected as ['BAD']"]
    kinds = rb.score(fixture_gold(SIX, [reject]), portfolio(SIX), registry=REGISTRY)["kinds"]
    assert rb.kind_gate(kinds) == []


def test_the_floor_gate_measures_kind_floor_picks_against_the_portfolio():
    def with_floor(floor_bob):
        ucs = portfolio(SIX, bob=8.0)
        ucs[0]["selection_basis"], ucs[0]["bob_score"] = "kind_floor", floor_bob
        return rb.score(fixture_gold(SIX), ucs, registry=REGISTRY)["kinds"]
    passing = with_floor(7.6)
    assert passing["floor"]["picks"] == 1 and passing["floor"]["gap"] == pytest.approx(0.333, abs=1e-3)
    assert rb.kind_gate(passing) == []
    failing = with_floor(7.3)
    assert failing["floor"]["gap"] == pytest.approx(0.583, abs=1e-3)
    assert rb.kind_gate(failing) == ["kind-floor picks average 0.58 Best-of-Best below the portfolio, above 0.5"]
    none = rb.score(fixture_gold(SIX), portfolio(SIX), registry=REGISTRY)["kinds"]
    assert none["floor"] == {"recorded": True, "picks": 0, "portfolio_bob": 7.0, "floor_bob": None, "gap": None}
    unrecorded = rb.score(fixture_gold(SIX), portfolio(SIX, basis=""), registry=REGISTRY)["kinds"]
    assert rb.kind_gate(unrecorded) == ["no use case records selection_basis; measure the floor gate on a v1.4.0 run"]


def test_the_release_gate_combines_found_kinds_and_strategy():
    gold = fixture_gold(SIX)
    gold["release_gate"]["min_found"] = 6
    builtin = {"strategic_context": {"source": "builtin"}}
    report = rb.score(gold, portfolio(SIX), registry=REGISTRY)
    assert rb.release_gate(gold, report, builtin) == (True, [])
    report = rb.score(gold, portfolio(SIX[:5]), registry=REGISTRY)
    passed, reasons = rb.release_gate(gold, report, builtin)
    assert not passed and reasons[0] == "found 5 of 6 is below the gate of 6"
    assert rb.release_gate({"entries": []}, report, builtin) == (False, ["the gold set has no release_gate"])
    assert "the report has no kind measures" in rb.release_gate(gold, {"found": 6, "gold": 6, "judge_errors": 0}, builtin)[1]


@pytest.mark.parametrize("corpus", sorted(DEMOS))
def test_the_command_runs_offline_on_each_shipped_demo_and_names_the_failing_gates(corpus, tmp_path, capsys):
    out = tmp_path / "report.json"
    demo = os.path.join(ROOT, "demos", DEMOS[corpus])
    gold = os.path.join(REGRESSION, f"{corpus}_gold.json")
    assert rb.main(["--gold", gold, "--catalog-json", demo, "--judge", "none", "--out", str(out)]) == 0
    report = load(out)
    assert report["use_cases"] >= 9 and report["kinds"]["kind_unknown"] == 0
    assert report["kinds"]["kind_from_technique"] == report["use_cases"], "the shipped demos predate kind labels"
    assert all("kind_matches" in row for row in report["entries"])
    assert "[KIND RECALL]" in capsys.readouterr().out
    assert rb.main(["--gold", gold, "--catalog-json", demo, "--judge", "none", "--gate"]) == 1
    assert "no use case records selection_basis" in capsys.readouterr().out


def test_detected_kinds_flag_limits_the_required_families(tmp_path, capsys):
    demo = os.path.join(ROOT, "demos", DEMOS["nyctaxi"])
    gold = os.path.join(REGRESSION, "nyctaxi_gold.json")
    out = tmp_path / "r.json"
    rb.main(["--gold", gold, "--catalog-json", demo, "--judge", "none", "--out", str(out), "--detected-kinds", "forecast,anomaly"])
    assert load(out)["kinds"]["families_eligible"] == ["detect_protect", "predict"]
