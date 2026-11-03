"""v1.3.0 recall benchmark: the tpcds_sf1 gold set cites real tables and columns, the table pre-filter
excludes use cases missing a required table, the judge's answers are parsed strictly and cached, and
recall is reported overall and within the top 25 by Inspire Score."""
import json
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "tests", "scripts"))

import pull_uc_dump  # noqa: E402
import recall_benchmark as rb  # noqa: E402

GOLD_PATH = os.path.join(ROOT, "tests", "regression", "tpcds_sf1_gold.json")
SCHEMA_PATH = os.path.join(ROOT, "tests", "regression", "tpcds_sf1_schema.json")


def load(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def row(uc_id, name, tables, score, statement="", bob=None):
    return {"id": uc_id, "use_case": name, "statement": statement, "solution": "", "tables_involved": tables,
            "inspire_score": score, "bob_score": bob}


GOLD = {"corpus": "fixture", "entries": [
    {"id": "G1", "title": "Demand", "decision": "Set weekly orders", "owner": "Planner", "why": "Stock", "kind": "Forecast",
     "required_tables": ["store_sales", "date_dim"], "signal_columns": ["store_sales.ss_quantity"]},
    {"id": "G2", "title": "Returns", "decision": "Fix returned items", "owner": "Category manager", "why": "Margin", "kind": "Driver breakdown",
     "required_tables": ["store_returns"], "signal_columns": ["store_returns.sr_return_quantity"]},
    {"id": "G3", "title": "Payroll", "decision": "Plan payroll", "owner": "HR", "why": "Cost", "kind": "Allocation",
     "required_tables": ["payroll"], "signal_columns": []},
]}


def test_the_gold_set_cites_only_real_tables_and_columns():
    gold, schema = load(GOLD_PATH), load(SCHEMA_PATH)["tables"]
    entries = gold["entries"]
    assert gold["corpus"] == "samples.tpcds_sf1" and len(entries) == 25
    assert len({e["id"] for e in entries}) == 25 and gold["status"].startswith("approved:")
    for entry in entries:
        assert entry["decision"] and entry["owner"] and entry["why"], entry["id"]
        allowed = set(entry["required_tables"]) | {t for group in entry["any_of"] for t in group}
        assert allowed and all(t in schema for t in allowed), entry["id"]
        assert all(len(group) >= 2 for group in entry["any_of"]), entry["id"]
        for ref in entry["signal_columns"]:
            table, column = ref.split(".")
            assert table in allowed and column in schema[table], (entry["id"], ref)
    text = json.dumps(gold).lower()
    for customer in ("alshaya", "asabe", "shahid"):
        assert customer not in text


def test_normalize_reads_tracking_rows_and_catalog_use_cases():
    tracked = rb.normalize_uc(row("N01-U01", "Forecast demand", "`samples`.`tpcds_sf1`.`store_sales`, samples.tpcds_sf1.Date_Dim", "8.5"))
    assert tracked["tables"] == ["date_dim", "store_sales"] and tracked["score"] == 8.5
    catalog = rb.normalize_uc({"No": "N02-U01", "Name": "Return reasons", "Tables Involved": "samples.tpcds_sf1.store_returns",
                               "Inspire Score": 7.0})
    assert catalog["id"] == "N02-U01" and catalog["name"] == "Return reasons" and catalog["tables"] == ["store_returns"]
    assert rb.normalize_uc({"id": "X", "inspire_score": "not scored"})["score"] is None


def test_the_prefilter_needs_every_required_table_and_ranks_by_signal_columns():
    ucs = rb.rank([rb.normalize_uc(r) for r in (
        row("A", "Sales report", "c.s.store_sales, c.s.date_dim", 9.0),
        row("B", "Weekly orders from ss_quantity", "c.s.store_sales, c.s.date_dim, c.s.item", 6.0),
        row("C", "Sales only", "c.s.store_sales", 9.9))])
    pool = rb.candidates(GOLD["entries"][0], ucs)
    assert [u["id"] for u in pool] == ["B", "A"], "C lacks date_dim; B cites a signal column"
    assert rb.candidates(GOLD["entries"][2], ucs) == []


def test_any_of_accepts_any_channel_but_needs_one():
    entry = {"id": "G8", "required_tables": ["promotion"], "any_of": [["store_sales", "web_sales", "catalog_sales"]],
             "signal_columns": []}
    assert rb.covers(entry, {"promotion", "web_sales"})
    assert rb.covers(entry, {"promotion", "catalog_sales", "item"})
    assert not rb.covers(entry, {"promotion", "item"}), "a promotion use case with no sales table is not a candidate"
    assert not rb.covers(entry, {"web_sales"}), "the required table is still required"
    assert "one of store_sales / web_sales / catalog_sales" in rb.judge_prompt(dict(entry, decision="d", owner="o", why="w"), [])


def test_rank_orders_by_inspire_score_then_bob_then_id():
    ucs = [rb.normalize_uc(r) for r in (row("B", "b", "t", 7.0, bob=5.0), row("A", "a", "t", 7.0, bob=5.0),
                                        row("C", "c", "t", 7.0, bob=6.0), row("D", "d", "t", None))]
    assert [u["id"] for u in rb.rank(ucs)] == ["C", "A", "B", "D"]


def test_judge_answers_are_parsed_strictly():
    pool = [{"id": "A"}, {"id": "B"}]
    assert rb.parse_judge('Sure: {"matches": ["B", "Z"], "reason": "same decision"}', pool) == (["B"], None)
    assert rb.parse_judge('{"matches": [], "reason": "no"}', pool) == ([], None)
    assert rb.parse_judge("no idea", pool)[1] == "no JSON object in the judge answer"
    assert rb.parse_judge('{"matches": "A"}', pool) == ([], "judge answer has no matches list")
    assert rb.parse_judge("{matches: [A]}", pool)[1] == "judge answer is not valid JSON"


def test_recall_overall_and_in_the_top_25_with_a_cached_judge():
    ucs = [row(f"P{i:02d}", f"Filler {i}", "c.s.store_sales, c.s.date_dim", 9.0 - i * 0.01) for i in range(30)]
    ucs.append(row("RET", "Return reasons per item", "c.s.store_returns", 1.0))
    calls = []

    def ask(prompt):
        calls.append(prompt)
        if "Fix returned items" in prompt:
            return '{"matches": ["RET"], "reason": "same decision"}'
        return '{"matches": ["P05", "P29"], "reason": "P05 sets weekly orders; P29 was not a candidate"}'
    cache = {}
    report = rb.score(GOLD, ucs, ask, cache)
    assert (report["found"], report["gold"], report["recall"]) == (2, 3, 0.6667)
    assert report["found_top"] == 1, "RET ranks below the top 25"
    g1 = next(e for e in report["entries"] if e["id"] == "G1")
    assert g1["matches"] == ["P05"], "an id that was not offered as a candidate is ignored"
    assert report["missed"] == ["G3"] and report["judge_errors"] == 0 and len(calls) == 2
    again = rb.score(GOLD, ucs, ask, cache)
    assert len(calls) == 2 and again["recall"] == report["recall"], "a cached prompt is never asked twice"
    assert len(g1["candidates"]) == rb.MAX_CANDIDATES


def test_without_a_judge_the_prefilter_gives_the_upper_bound():
    ucs = [row("A", "Sales", "c.s.store_sales, c.s.date_dim", 9.0), row("B", "Returns", "c.s.store_returns", 8.0)]
    report = rb.score(GOLD, ucs)
    assert report["judge"] == "none" and report["found"] == 2 and report["found_top"] == 2


def test_the_sql_judge_refuses_an_unsafe_endpoint_name():
    for bad in ("x'); DROP TABLE t; --", "", "end point"):
        with pytest.raises(ValueError):
            rb.sql_judge(bad)
    assert callable(rb.sql_judge("databricks-claude-sonnet-4-5"))


def test_the_sql_judge_binds_the_prompt_as_a_parameter(monkeypatch):
    seen = {}

    def query(sql, parameters=None, timeout_s=300.0):
        seen.update(sql=sql, parameters=parameters)
        return ["answer"], [['{"matches": []}']]
    monkeypatch.setattr(pull_uc_dump, "query", query)
    assert rb.sql_judge("my-endpoint")("it's a prompt") == '{"matches": []}'
    assert "it's a prompt" not in seen["sql"] and seen["parameters"][0]["value"] == "it's a prompt"
    assert "ai_query('my-endpoint', :prompt" in seen["sql"] and "CAST(0.0 AS DOUBLE)" in seen["sql"]


def test_query_waits_while_the_statement_is_still_running(monkeypatch):
    done = {"status": {"state": "SUCCEEDED"}, "manifest": {"schema": {"columns": [{"name": "v"}]}},
            "result": {"data_array": [["1"]]}}
    monkeypatch.setattr(pull_uc_dump, "_run_sql", lambda sql, wait_s="45s", parameters=None:
                        {"status": {"state": "RUNNING"}, "statement_id": "s1"})
    monkeypatch.setattr(pull_uc_dump, "_wait_for_completion", lambda statement_id, timeout_s=300.0: done)
    assert pull_uc_dump.query("SELECT 1") == (["v"], [["1"]])
    monkeypatch.setattr(pull_uc_dump, "_wait_for_completion",
                        lambda statement_id, timeout_s=300.0: {"status": {"state": "FAILED"}})
    with pytest.raises(RuntimeError):
        pull_uc_dump.query("SELECT 1")


PASSING_KINDS = {"kind_recall": 0.84, "kind_missed": [], "families_hit": ["a", "b", "c", "d", "e", "f"], "families_required": 6,
                 "families_eligible": [], "families_produced": [], "must_reject_selected": [],
                 "floor": {"recorded": True, "picks": 0, "gap": None}}


def _gate_report(found, found_top, errors=0):
    return {"found": found, "found_top": found_top, "judge_errors": errors, "gold": 25, "kinds": PASSING_KINDS}


def test_the_live_gate_holds_total_recall_and_only_reports_the_noisy_single_run_top_25():
    gold = load(GOLD_PATH)
    baseline = gold["release_gate"]["baseline"]
    assert baseline["version"] == "v1.2.1" and "top_tolerance" not in gold["release_gate"]
    assert gold["release_gate"]["frozen_pool"]["reference_tag"] == "v1.2.1"
    builtin = {"strategic_context": {"source": "builtin"}}
    floor = gold["release_gate"]["min_found"]
    assert floor == 21 and floor > baseline["found"]
    assert rb.release_gate(gold, _gate_report(floor, baseline["found_top"] - 1), builtin) == (True, [])
    assert rb.release_gate(gold, _gate_report(floor, 0), {}) == (True, []), "the frozen pool gates the top 25"
    passed, reasons = rb.release_gate(gold, _gate_report(floor - 1, baseline["found_top"]), builtin)
    assert not passed and reasons == ["found 20 of 25 is below the gate of 21"]
    passed, reasons = rb.release_gate(gold, _gate_report(baseline["found"] - 1, baseline["found_top"]), builtin)
    assert not passed and "below the v1.2.1 baseline" in reasons[0]
    passed, reasons = rb.release_gate(gold, _gate_report(25, 25), {"strategic_context": {"source": "customer"}})
    assert not passed and "customer strategy" in reasons[0]
    assert not rb.release_gate(gold, _gate_report(25, 25), None)[0], "the gate cannot confirm the run without the catalog"
    assert not rb.release_gate(gold, _gate_report(25, 25, errors=1), builtin)[0]
    assert rb.release_gate({"entries": []}, _gate_report(25, 25), builtin) == (False, ["the gold set has no release_gate"])


def test_the_gate_flag_makes_the_command_exit_non_zero_on_failure(tmp_path, capsys):
    catalog = tmp_path / "catalog.json"
    catalog.write_text(json.dumps({"strategic_context": {"source": "builtin"}, "domains": []}), encoding="utf-8")
    code = rb.main(["--gold", GOLD_PATH, "--catalog-json", str(catalog), "--judge", "none", "--gate"])
    assert code == 1 and "[RECALL GATE] FAIL" in capsys.readouterr().out
    assert rb.main(["--gold", GOLD_PATH, "--catalog-json", str(catalog), "--judge", "none"]) == 0
