"""v2.3.0 QUALITY GATE DROPS: a hard-vetoed use case is kept for Review in the session results, never in the catalog.

Both places that drop a hard-vetoed use case record its gate, the gate's plain name, the gate score and the
best-of-best score in `quality_gate_drops`, which the run merges into results_json. A use case a later fallback
brings back into the catalog is not listed as dropped, and a run with no drop carries no field at all.
"""
import json

from v120_artifacts_support import make_inspire

import _agentload


def _vetoed(no, gate, score, name=None, domain="Sales"):
    scores = {f"D{i}": 7 for i in range(1, 20)}
    scores[gate] = score
    return {"No": no, "Name": name or f"Forecast demand {no}", "Business Domain": domain, "Subdomain": "Demand",
            "bob_scores": scores, "bob_score": 2.0, "bob_hard_veto_gate": gate}


def _healthy(no):
    return {"No": no, "Name": f"Reduce churn {no}", "Business Domain": "Sales", "Subdomain": "Retention",
            "bob_scores": {f"D{i}": 8 for i in range(1, 20)}, "bob_score": 8.0, "bob_hard_veto_gate": None}


def test_a_hard_vetoed_use_case_is_recorded_for_review_with_its_gate_and_score_and_never_kept(agent_ns):
    obj = make_inspire(agent_ns)
    obj.final_inspire_results_json = {"domains": [{"domain_name": "Sales", "use_cases": [{"No": "N01-U02", "Name": "Reduce churn N01-U02"}]}]}
    kept = obj._drop_hard_veto_ucs([_vetoed("N01-U01", "D5", 2), _healthy("N01-U02")])
    assert [uc["No"] for uc in kept] == ["N01-U02"]
    drops = obj._merge_run_outcome_into_results()["quality_gate_drops"]
    assert drops == [{"no": "N01-U01", "name": "Forecast demand N01-U01", "domain": "Sales", "subdomain": "Demand", "gate": "D5",
                      "gate_name": agent_ns["inspire_gate_label"]("D5"), "gate_score": 2.0, "bob_score": 2.0}]
    assert drops[0]["gate_name"] and drops[0]["gate_name"] != "D5", "the gate reads in plain words"
    catalog = json.dumps(obj.final_inspire_results_json["domains"])
    assert "N01-U01" not in catalog, "the dropped use case never enters the catalog (must-exclude)"


def test_the_trim_records_the_hard_vetoed_use_cases_it_drops(agent_ns):
    obj = make_inspire(agent_ns)
    obj.final_inspire_results_json = {}
    kept = obj._stratified_trim_by_theme([_vetoed("N02-U01", "D14", 1), _healthy("N02-U02")], target_max=10, drops={})
    assert [uc["No"] for uc in kept] == ["N02-U02"]
    drops = obj._merge_run_outcome_into_results()["quality_gate_drops"]
    assert [(d["no"], d["gate"], d["gate_score"]) for d in drops] == [("N02-U01", "D14", 1.0)]


def test_a_use_case_a_fallback_brought_back_is_not_listed_as_dropped_and_a_run_with_no_drop_has_no_field(agent_ns):
    obj = make_inspire(agent_ns)
    obj._drop_hard_veto_ucs([_vetoed("N03-U01", "D2", 2), _vetoed("N03-U02", "D9", 2.5, name="Price  check")])
    obj.final_inspire_results_json = {"domains": [{"use_cases": [{"No": "N03-U01"}, {"No": "N09-U09", "Name": "price check"}]}]}
    assert "quality_gate_drops" not in obj._merge_run_outcome_into_results(), "both came back into the catalog (must-exclude)"
    clean = make_inspire(agent_ns)
    clean.final_inspire_results_json = {}
    clean._drop_hard_veto_ucs([_healthy("N04-U01")])
    assert "quality_gate_drops" not in clean._merge_run_outcome_into_results()


def test_the_json_catalog_file_is_written_before_the_run_outcome_joins_the_results():
    source = _agentload.agent_source()
    start = source.index('self.logger.info("Generating JSON Catalog...")')
    body = source[start:source.index("def ", start)]
    assert body.index("json_content = json.dumps(catalog_json") < body.index("self._merge_run_outcome_into_results()"), \
        "the JSON Catalog export never carries quality_gate_drops"
