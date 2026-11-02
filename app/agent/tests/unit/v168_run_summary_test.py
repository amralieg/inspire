"""v1.6.8 RUN SUMMARY: results_json is the one place the Inspire App reads a run's executive summary.

The agent records the English executive summary the moment it exists: into the results it composes
for the session row, and straight onto a session row it owns, so the progressive Review sees it
while the run is still going. Every completion writes it again, whichever path the run took: the
Discover pipeline, a pipeline that fails after the summary, and a docs-only run, which also keeps
the catalog it was given. A run attached to an existing session never writes results at all.
"""
import ast
import json
import re

from v120_artifacts_support import FakeSpark, make_inspire
from v120_artifacts_session_test import _atomic_writer, _session_writes

import _agentload

SUMMARY = "<p>Acme can keep its best customers and stock the right products.</p><p>Start with churn: it pays back first.</p>"


def _results_writes(spark):
    return [s for s in _session_writes(spark) if "SET results_json = parse_json(" in s]


def _discover_writer(ns, tmp_path, monkeypatch):
    spark = FakeSpark(responder=lambda s: [])
    writer = _atomic_writer(ns, spark, tmp_path, monkeypatch, operation="Discover Use Cases", business="Acme")
    writer.initialize_session()
    assert writer.attached_to_existing_session is False
    return spark, writer


def test_the_summary_reaches_the_session_row_the_moment_it_exists(agent_ns, tmp_path, monkeypatch):
    spark, writer = _discover_writer(agent_ns, tmp_path, monkeypatch)
    try:
        obj = make_inspire(agent_ns, atomic_writer=writer)
        assert obj._record_executive_summary({"Executive": f"  {SUMMARY}\n", "Sales": "<p>Sales</p>"}) == SUMMARY
    finally:
        writer._session_writer.stop(drain_timeout=5.0)
    writes = _results_writes(spark)
    assert len(writes) == 1, writes
    assert writes[0].startswith("UPDATE `my-cat`.`inspire`.__inspire_session SET results_json = parse_json(")
    assert writes[0].endswith("WHERE session_id = 5150")
    assert "executive_summary" in writes[0] and "Start with churn: it pays back first." in writes[0]
    for column in ("completed_on", "completed_percent", "processing_status"):
        assert column not in writes[0], "the early write never marks the run complete"
    assert obj._merge_run_outcome_into_results()["executive_summary"] == SUMMARY
    assert obj.logger.matching("[EXECUTIVE-SUMMARY FIRED]")


def test_the_same_summary_is_written_once(agent_ns, tmp_path, monkeypatch):
    spark, writer = _discover_writer(agent_ns, tmp_path, monkeypatch)
    try:
        obj = make_inspire(agent_ns, atomic_writer=writer)
        obj._record_executive_summary({"Executive": SUMMARY})
        obj._record_executive_summary({"Executive": f"{SUMMARY} "})
        obj._record_executive_summary({"Executive": "<p>A new summary</p>"})
    finally:
        writer._session_writer.stop(drain_timeout=5.0)
    writes = _results_writes(spark)
    assert len(writes) == 2, "a repeat of the same text is not written again, a new text is"
    assert "A new summary" in writes[1]
    assert obj._merge_run_outcome_into_results()["executive_summary"] == "<p>A new summary</p>"


def test_an_empty_summary_writes_nothing_and_adds_no_field(agent_ns, tmp_path, monkeypatch):
    spark, writer = _discover_writer(agent_ns, tmp_path, monkeypatch)
    try:
        obj = make_inspire(agent_ns, atomic_writer=writer)
        for empty in (None, {}, {"Executive": ""}, {"Executive": "   "}, {"Sales": "<p>only a domain</p>"}):
            assert obj._record_executive_summary(empty) == ""
    finally:
        writer._session_writer.stop(drain_timeout=5.0)
    assert _results_writes(spark) == []
    assert "executive_summary" not in obj._merge_run_outcome_into_results()


def test_a_run_that_fails_after_the_summary_completes_with_it(agent_ns, tmp_path, monkeypatch):
    spark, writer = _discover_writer(agent_ns, tmp_path, monkeypatch)
    try:
        obj = make_inspire(agent_ns, atomic_writer=writer)
        obj._record_executive_summary({"Executive": SUMMARY})
        obj.final_inspire_results_json = {"funnel_ledger": []}
        payload = obj._merge_run_outcome_into_results()
        assert writer._finalize_session("2026-10-31 12:00:00", final_results_json=payload) is True
    finally:
        writer._session_writer.stop(drain_timeout=5.0)
    completion = [s for s in _session_writes(spark) if "completed_on = TIMESTAMP(" in s]
    assert len(completion) == 1 and "Start with churn: it pays back first." in completion[0], \
        "the completion carries the summary although the JSON catalog never replaced the results"


def test_the_catalog_and_the_results_carry_the_one_recorded_summary(agent_ns, monkeypatch):
    obj = make_inspire(agent_ns, column_id_map={}, id_column_map={}, table_id_map={}, id_table_map={},
                       catalogs_str="main", schemas_str="", generation_path="/Workspace/out")
    monkeypatch.setattr(agent_ns["workspace"], "ImportFormat", type("F", (), {"AUTO": "AUTO"}), raising=False)
    obj._save_usecases_catalog_json([{"No": "N01-U01", "Name": "Demo", "Business Domain": "Sales"}], {},
                                    summary_dict={"Executive": f"\n{SUMMARY}  "})
    saved = json.loads(next(iter(obj.w_client.workspace.files.values())))
    assert saved["executive_summary"] == SUMMARY
    assert obj.final_inspire_results_json["executive_summary"] == SUMMARY
    assert obj.executive_summary == SUMMARY


def test_a_catalog_saved_without_a_summary_records_the_one_it_makes(agent_ns, monkeypatch):
    obj = make_inspire(agent_ns, column_id_map={}, id_column_map={}, table_id_map={}, id_table_map={},
                       catalogs_str="main", schemas_str="", generation_path="/Workspace/out")
    monkeypatch.setattr(agent_ns["workspace"], "ImportFormat", type("F", (), {"AUTO": "AUTO"}), raising=False)
    obj._get_salesy_summary = lambda grouped, business, language, translations: ({"Executive": SUMMARY}, business)
    obj._save_usecases_catalog_json([{"No": "N01-U01", "Name": "Demo", "Business Domain": "Sales"}], {}, summary_dict=None)
    assert obj.executive_summary == SUMMARY
    assert obj.final_inspire_results_json["executive_summary"] == SUMMARY


def test_a_docs_only_run_completes_with_its_catalog_and_its_refreshed_summary(fresh_ns):
    catalog = {"business_name": "Acme", "title": "Acme Use Cases Catalog", "executive_summary": "<p>Stored</p>",
               "domains_summary": "Sales: 1 use cases", "column_registry": {"1": "main.s.orders.id, Order id"},
               "table_registry": {"7": "main.s.orders"},
               "domains": [{"domain_name": "Sales", "summary": "<p>Sales</p>",
                            "use_cases": [{"No": "N01-U01", "Name": "Demo", "Business Domain": "Sales", "Priority": "High",
                                           "Columns Involved": "1", "directly_involved_tables": "7"}]}]}
    fresh_ns["read_user_text_file"] = lambda path, w_client=None: json.dumps(catalog)
    obj = make_inspire(fresh_ns)
    use_cases, summary_dict, _grouped = obj._load_usecases_catalog_json("/Workspace/out/catalog.json")
    assert use_cases[0]["Columns Involved"] == "main.s.orders.id", "the run itself works with names"
    obj._record_executive_summary({**summary_dict, "Executive": "<p>Refreshed</p>"})
    results = obj._merge_run_outcome_into_results()
    assert results["executive_summary"] == "<p>Refreshed</p>"
    assert results["title"] == "Acme Use Cases Catalog" and results["domains_summary"] == "Sales: 1 use cases"
    assert [d["domain_name"] for d in results["domains"]] == ["Sales"]
    assert results["domains"][0]["use_cases"][0]["Columns Involved"] == "1", "results_json keeps the catalog's ids, as a Discover run writes them"
    assert results["table_registry"] == {"7": "main.s.orders"}


def test_a_regeneration_attached_to_its_session_never_writes_results(agent_ns, tmp_path, monkeypatch):
    spark = FakeSpark(responder=lambda s: [{"session_id": 5150}] if s.startswith("SELECT session_id FROM") else [])
    writer = _atomic_writer(agent_ns, spark, tmp_path, monkeypatch, operation="Generate Use Cases", business="Acme")
    try:
        writer.initialize_session()
        assert writer.attached_to_existing_session is True
        assert writer.record_results({"executive_summary": SUMMARY}) is False
        obj = make_inspire(agent_ns, atomic_writer=writer)
        assert obj._record_executive_summary({"Executive": SUMMARY}) == SUMMARY
        assert writer._finalize_session("2026-10-31 12:00:00", final_results_json=obj._merge_run_outcome_into_results()) is True
    finally:
        writer._session_writer.stop(drain_timeout=5.0)
    assert [s for s in _session_writes(spark) if "results_json" in s] == [], "the Discover run's results stay as they are"


def test_results_are_never_written_after_completion_and_a_failed_write_says_so(agent_ns, tmp_path, monkeypatch):
    spark, writer = _discover_writer(agent_ns, tmp_path, monkeypatch)
    try:
        assert writer._finalize_session("2026-10-31 12:00:00", final_results_json={"executive_summary": SUMMARY}) is True
        assert writer.record_results({"executive_summary": "<p>Late</p>"}) is False
    finally:
        writer._session_writer.stop(drain_timeout=5.0)
    assert not [s for s in _results_writes(spark) if "Late" in s]

    def refuse(statement):
        if "SET results_json = parse_json(" in statement:
            raise RuntimeError("PERMISSION_DENIED: MODIFY on __inspire_session")
        return []
    failing = FakeSpark(responder=refuse)
    writer = _atomic_writer(agent_ns, failing, tmp_path, monkeypatch, operation="Discover Use Cases", business="Acme")
    try:
        writer.initialize_session()
        assert writer.record_results({"executive_summary": SUMMARY}) is False
    finally:
        writer._session_writer.stop(drain_timeout=5.0)
    assert writer.logger.matching("the completion write carries them", level="WARNING")


def test_an_early_write_that_raises_never_breaks_the_run(agent_ns):
    class Raising:
        def record_results(self, results):
            raise RuntimeError("TEMPORARILY_UNAVAILABLE")
    obj = make_inspire(agent_ns, atomic_writer=Raising())
    assert obj._record_executive_summary({"Executive": SUMMARY}) == SUMMARY
    assert obj.logger.matching("the completion writes the summary", level="WARNING")
    assert obj._merge_run_outcome_into_results()["executive_summary"] == SUMMARY


def _run_source():
    node = _agentload.method_node("DatabricksInspire", "run")
    return ast.get_source_segment(_agentload.agent_source(), node)


def test_the_pipeline_and_the_docs_only_run_record_the_summary_where_they_make_it():
    src = _run_source()
    discover = re.search(r"if final_consolidated_use_cases and not self\.json_file_path:\n\s+if summary_dict is None:\n"
                         r"[^\n]*\n\s+\(summary_dict, _\) = self\._get_salesy_summary\(english_grouped_data[^\n]*\n"
                         r"(\s+)self\._record_executive_summary\(summary_dict\)\n", src)
    assert discover, "the pipeline records the summary right after Phase 2 makes it"
    docs = re.search(r"summary_dict = self\._refresh_english_summary\(english_grouped_data, summary_dict\)\n"
                     r"\s+self\._record_executive_summary\(summary_dict\)\n", src)
    assert docs, "a docs-only run records the summary it refreshed"


def test_results_json_has_exactly_three_writers():
    src = _agentload.agent_source()
    assert src.count("results_json = parse_json(") == 2, "the completion and the early record are the only UPDATEs"
    assert src.count("AS results_json") == 1, "the session MERGE starts each run with empty results"
    record = ast.get_source_segment(src, _agentload.method_node("AtomicWriter", "record_results"))
    assert "self.attached_to_existing_session" in record and "session_finalized" in record
