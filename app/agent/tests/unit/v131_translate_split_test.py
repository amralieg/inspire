"""An empty LLM answer splits the batch down to single rows instead of resending the same batch.

Before: gpt-oss-20b spent its whole output budget reasoning on a 3-row Ultra High translation batch and
returned an empty answer; `_translate_batch` resent the same 3 rows once, got another empty answer and left
all 3 in English. The scoring, clustering and table-filter batches had the same same-size retry. A Good
quality CSV also named Ultra High fields in its untranslated notice although the file has no such column.
"""
import json
import os
import sys
import threading
import types
from collections import Counter

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v120_artifacts_support import make_inspire as docs_inspire, make_uc  # noqa: E402
from v120_docs_design_test import docs  # noqa: E402,F401
from v120_docs_final3_test import _ja_row, _translation_csv  # noqa: E402

IDS = ["N01-U01", "N01-U02", "N01-U03"]


def _translator(docs, respond):
    calls, lock = [], threading.Lock()

    def run_worker(step_name, worker_prompt_path, prompt_vars, response_schema=None, skip_cache=False, **kw):
        ids = [item["No"] for item in json.loads(prompt_vars["json_payload"])]
        with lock:
            calls.append((tuple(ids), skip_cache))
        return respond(ids, skip_cache)
    service = docs["TranslationService"](types.SimpleNamespace(run_worker=run_worker), docs_inspire(docs).logger)
    return service, calls


def _batch(ids=IDS):
    return [make_uc(i) for i in ids]


def test_an_empty_answer_splits_the_batch_and_every_row_is_translated(docs):
    def respond(ids, skip_cache):
        return "" if len(ids) > 1 else _translation_csv([_ja_row(i) for i in ids])
    service, calls = _translator(docs, respond)
    out = service._translate_batch(_batch(), "Japanese", 0)
    assert calls[0] == (tuple(IDS), False)
    assert sorted(calls[1:]) == [((i,), True) for i in IDS]
    assert [uc["_translation_status"] for uc in out] == ["translated"] * 3
    assert [uc["No"] for uc in out] == IDS


def test_a_row_that_stays_empty_after_the_split_is_flagged_and_the_others_are_translated(docs):
    def respond(ids, skip_cache):
        return "" if len(ids) > 1 or ids == ["N01-U02"] else _translation_csv([_ja_row(i) for i in ids])
    service, calls = _translator(docs, respond)
    out = service._translate_batch(_batch(), "Japanese", 0)
    assert Counter(calls) == Counter({(tuple(IDS), False): 1, (("N01-U01",), True): 1,
                                      (("N01-U02",), True): 2, (("N01-U03",), True): 1})
    by_id = {uc["No"]: uc for uc in out}
    assert by_id["N01-U01"]["_translation_status"] == by_id["N01-U03"]["_translation_status"] == "translated"
    assert by_id["N01-U02"]["_translation_status"] == "untranslated"
    assert by_id["N01-U02"]["_untranslated_fields"]
    assert service.logger.matching("Batch #0b: all retry attempts of this request failed", level="WARNING")
    assert not service.logger.matching("", level="ERROR")


def test_the_top_batch_names_only_the_row_still_in_english_in_one_error(docs):
    def respond(ids, skip_cache):
        return "" if len(ids) > 1 or ids == ["N01-U02"] else _translation_csv([_ja_row(i) for i in ids])
    service, _calls = _translator(docs, respond)
    out = service._translate_top_batch(_batch(), "Japanese", 0)
    assert [uc["_translation_status"] for uc in out] == ["translated", "untranslated", "translated"]
    assert [m for _lvl, m in service.logger.matching("", level="ERROR")] == [
        "All retry attempts exhausted for batch #0: N01-U02 (all fields) stays in English and is flagged."]


def test_a_batch_whose_rows_are_all_recovered_after_a_failed_split_piece_logs_no_error(docs):
    seen = Counter()

    def respond(ids, skip_cache):
        seen[tuple(ids)] += 1
        if len(ids) > 1 or (ids == ["N01-U02"] and seen[tuple(ids)] == 1):
            return ""
        return _translation_csv([_ja_row(i) for i in ids])
    service, _calls = _translator(docs, respond)
    out = service.translate_use_case_list(_batch(), "Japanese", enable_parallelization=False)
    assert [uc["_translation_status"] for uc in out] == ["translated"] * 3
    assert not service.logger.matching("", level="ERROR")
    assert not service.logger.matching("stays in English")


def _logger_levels(class_name, method_name):
    import ast
    from _agentload import method_node
    return {c.func.attr for c in ast.walk(method_node(class_name, method_name)) if isinstance(c, ast.Call)
            and isinstance(c.func, ast.Attribute) and isinstance(c.func.value, ast.Attribute) and c.func.value.attr == "logger"}


@pytest.mark.parametrize("method", ["_translate_batch", "_split_translate_batch", "_parse_translation_rows",
                                    "_retry_partial_translations", "_untranslated_attempt"])
def test_no_intermediate_translation_round_logs_an_error(method):
    levels = _logger_levels("TranslationService", method)
    assert levels and not levels & {"error", "exception", "critical"}, levels


def test_only_the_last_round_of_a_top_batch_logs_the_error():
    assert "error" in _logger_levels("TranslationService", "_translate_top_batch")


def test_an_endpoint_failure_is_still_retried_once_at_the_same_size(docs):
    def respond(ids, skip_cache):
        raise RuntimeError("endpoint unavailable")
    service, calls = _translator(docs, respond)
    out = service._translate_batch(_batch(), "Japanese", 0)
    assert calls == [(tuple(IDS), False), (tuple(IDS), True)]
    assert [uc["_translation_status"] for uc in out] == ["untranslated"] * 3


def test_an_empty_answer_is_never_classified_as_a_timeout(agent_ns):
    with pytest.raises(agent_ns["TruncatedResponseError"]) as caught:
        agent_ns["inspire_llm_answer"]("  \n", "Batch #1")
    assert agent_ns["_classify_runtime_error"](caught.value) != "timeout"
    assert agent_ns["inspire_llm_answer"]("rows", "Batch #1") == "rows"


def _scorer(ns):
    from v121_retry_and_dedup_test import scorer
    return scorer(ns)


def test_the_shared_scoring_retry_splits_an_empty_answer_down_to_single_use_cases(agent_ns):
    obj = _scorer(agent_ns)
    calls, lock = [], threading.Lock()

    def score(label, batch, skip_cache):
        with lock:
            calls.append((len(batch), skip_cache))
        if len(batch) > 1:
            agent_ns["inspire_llm_answer"]("", label)
        return {uc["No"]: {"ok": True} for uc in batch}

    scores, unscored = obj._score_with_split_retry([{"No": f"U{i}"} for i in range(4)], score, 4, "Test", per_task_timeout=30)
    assert unscored == {} and set(scores) == {"U0", "U1", "U2", "U3"}
    assert sorted(calls) == [(1, True)] * 4 + [(2, True)] * 2 + [(4, False)]


def test_a_use_case_that_stays_empty_alone_stops_and_is_unscored(agent_ns):
    obj = _scorer(agent_ns)
    calls, lock = [], threading.Lock()

    def score(label, batch, skip_cache):
        with lock:
            calls.append(tuple(uc["No"] for uc in batch))
        if len(batch) > 1 or batch[0]["No"] == "U1":
            agent_ns["inspire_llm_answer"]("", label)
        return {uc["No"]: {"ok": True} for uc in batch}

    scores, unscored = obj._score_with_split_retry([{"No": f"U{i}"} for i in range(4)], score, 4, "Test", per_task_timeout=30)
    assert set(scores) == {"U0", "U2", "U3"} and set(unscored) == {"U1"}
    assert "TruncatedResponseError" in unscored["U1"]
    assert Counter(calls)[("U1",)] == 1 and len(calls) == 7


@pytest.mark.parametrize("stage", ["combined", "bob"])
def test_a_scoring_stage_turns_an_empty_answer_into_a_split(agent_ns, stage):
    from v120_funnel_integrity_test import bob_rec, combined_rec, ids_in, make_inspire, make_uc as core_uc

    def responder(prompt_name, prompt_vars, skip_cache):
        if "use_cases_to_validate" not in prompt_vars:
            return "[]"
        ids = ids_in(prompt_vars["use_cases_to_validate"])
        if len(ids) > 1:
            return ""
        return json.dumps([combined_rec(i) if stage == "combined" else bob_rec(i) for i in ids])

    obj = make_inspire(agent_ns, responder)
    ucs = [core_uc(f"U{i}") for i in range(1, 5)]
    if stage == "combined":
        obj._score_combined_value_and_quality(ucs, [])
        assert [uc["scoring_status"] for uc in ucs] == ["scored"] * 4
    else:
        obj._score_best_of_best(ucs, [])
        assert [uc["bob_status"] for uc in ucs] == ["scored"] * 4
    sizes = [len(ids_in(c["vars"]["use_cases_to_validate"])) for c in obj.ai_agent.calls if "use_cases_to_validate" in c["vars"]]
    assert sizes[0] == 4 and sizes.count(1) == 4


def _clusterer(ns, domain=None, subdomain=None):
    from v120_clustering_test import FakeAgent, make, no_merge, one_subdomain_per_domain
    agent = FakeAgent(domain=domain, subdomain=subdomain or one_subdomain_per_domain, merge=no_merge)
    return make(ns, agent), agent


def _llm_ids(prompt_vars):
    from v120_clustering_test import ids_in_csv
    return ids_in_csv(prompt_vars["use_cases_csv"])


def _sales_ucs(n):
    from v120_clustering_test import ucs_on
    ucs = ucs_on([(f"U{i}", "main.shop.orders") for i in range(1, n + 1)])
    for uc in ucs:
        uc["Business Domain"] = "Sales"
    return ucs


def _empty_unless_single_subdomain(prompt_vars, step, kw, template):
    from v120_clustering_test import subdomain_csv
    ids = _llm_ids(prompt_vars)
    return "" if len(ids) > 1 else subdomain_csv({i: "Demand Planning" for i in ids})


def test_an_empty_subdomain_answer_for_a_whole_domain_is_split_into_smaller_batches(agent_ns):
    obj, agent = _clusterer(agent_ns, subdomain=_empty_unless_single_subdomain)
    out = obj._detect_subdomains_for_domain("Sales", _sales_ucs(4), "English")
    assert {uc["No"]: uc["Subdomain"] for uc in out} == {f"U{i}": "Demand Planning" for i in range(1, 5)}
    assert not any(uc.get("clustering_fallback") for uc in out)
    assert sorted(len(_llm_ids(c["vars"])) for c in agent.calls)[:4] == [1, 1, 1, 1]


def test_an_empty_subdomain_answer_for_a_context_split_batch_is_split_in_halves(agent_ns):
    obj, agent = _clusterer(agent_ns, subdomain=_empty_unless_single_subdomain)
    out = obj._detect_subdomains_with_context_splitting("Sales", _sales_ucs(4), "English", "T", 10 ** 6)
    assert {uc["No"]: uc["Subdomain"] for uc in out} == {f"U{i}": "Demand Planning" for i in range(1, 5)}
    assert not any(uc.get("clustering_fallback") for uc in out)
    sizes = [len(_llm_ids(c["vars"])) for c in agent.calls]
    assert sizes.count(4) == 1 and sizes.count(2) == 2 and sizes.count(1) == 4


def test_an_empty_domain_answer_is_split_until_every_use_case_gets_a_domain_from_the_model(agent_ns):
    from v120_clustering_test import domain_csv

    def domain(prompt_vars, step, kw, template):
        ids = _llm_ids(prompt_vars)
        return "" if len(ids) > 1 else domain_csv({i: "Sales" for i in ids})
    obj, agent = _clusterer(agent_ns, domain=domain)
    from v120_clustering_test import ucs_on
    out = obj._cluster_domains_and_subdomains(ucs_on([(f"U{i}", "main.shop.orders") for i in range(1, 5)]), "English")
    assert {uc["No"]: uc["Business Domain"] for uc in out} == {f"U{i}": "Sales" for i in range(1, 5)}
    assert not any(str(uc.get("clustering_fallback", "")).startswith("domain:") for uc in out)
    singles = [c for c in agent.calls if c["path"] == "DOMAIN_FINDER_PROMPT" and len(_llm_ids(c["vars"])) == 1]
    assert len(singles) == 4


FILTER_HEADER = '"Table Name","Classification","Data Category","Business Score","Reason"'
FILTER_LINES = {"c.s.alpha": "- `c`.`s`.`alpha` | columns (1): id bigint",
                "c.s.beta": "- `c`.`s`.`beta` | columns (1): id bigint"}


def test_an_empty_table_filter_answer_is_split_into_single_tables(agent_ns):
    from v120_integration_test import _inspire, _rendering_agent

    def respond(path, prompt_vars, skip_cache):
        text = json.dumps(prompt_vars)
        tables = [t for t in FILTER_LINES if f"`{t.split('.')[-1]}`" in text]
        if len(tables) > 1:
            return ""
        return FILTER_HEADER + "\n" + "\n".join(f'"{t}","BUSINESS","TRANSACTIONAL","80","Orders"' for t in tables)
    agent = _rendering_agent(agent_ns, respond)
    obj = _inspire(agent_ns, ai_agent=agent)
    result = obj._process_filter_batch_recursive(list(FILTER_LINES), 1, 1, "Acme", "I", "B", "Medium", "R", "", 0, 10,
                                                 FILTER_LINES)
    assert result == {t: ("BUSINESS", 80, "TRANSACTIONAL") for t in FILTER_LINES}
    assert len(agent.calls) == 3


def _arabic(ns):
    ts = ns["TranslationService"]
    labels = dict(ts.ENGLISH_TRANSLATIONS)
    labels.update(ts.TRANSLATION_FALLBACKS["Arabic"])
    return labels


@pytest.fixture
def export_ns(agent_ns, monkeypatch):
    monkeypatch.setattr(agent_ns["workspace"], "ImportFormat", types.SimpleNamespace(AUTO="AUTO"), raising=False)
    monkeypatch.setattr(agent_ns["workspace"], "ExportFormat", types.SimpleNamespace(AUTO="AUTO"), raising=False)
    return agent_ns


def _notice_rows(ns, **uc_fields):
    labels = _arabic(ns)
    uc = make_uc("N03-U03", "المبيعات", Name="توقع الطلب", Subdomain="التخطيط", **uc_fields)
    uc["_translation_status"] = "partial"
    uc["_untranslated_fields"] = ["Statement", "Elite Decision Cadence", "Elite Decision", "Below Bar Reason",
                                  "Measures of Success", "KPI Names"]
    obj = docs_inspire(ns, output_languages=["English", "Arabic"])
    obj._normalize_usecase = lambda usecase, name: usecase
    headers, rows, _numeric = obj._catalog_export_table({"المبيعات": [uc]}, labels, "Arabic")
    return labels, headers, dict(zip(headers, rows[0]))


def _notice_of(labels, row):
    return row.get(labels["untranslated_notice"], "")


def test_a_good_quality_export_names_only_untranslated_fields_it_has_a_column_for(export_ns):
    labels, headers, row = _notice_rows(export_ns)
    assert labels["elite_cadence"] not in headers
    assert _notice_of(labels, row) == f"{labels['untranslated_notice']}: {labels['statement']}"


def test_an_ultra_high_export_names_every_untranslated_field_it_shows(export_ns):
    from v120_artifacts_support import elite_assessment
    labels, headers, row = _notice_rows(export_ns, elite_status="ELITE", elite_score=8.8, elite_assessment=elite_assessment(),
                                        measures_of_success=["Stockouts fall"], kpis=["Stockout rate"])
    assert labels["elite_cadence"] in headers
    notice = _notice_of(labels, row)
    for key in ("statement", "elite_cadence", "elite_decision"):
        assert labels[key] in notice, key


def test_a_good_quality_csv_file_does_not_name_ultra_high_fields(export_ns):
    import csv
    import io
    labels = _arabic(export_ns)
    uc = make_uc("N03-U03", "المبيعات", Name="توقع الطلب", Subdomain="التخطيط")
    uc["_translation_status"], uc["_untranslated_fields"] = "partial", ["Elite Decision Cadence", "Elite Decision"]
    obj = docs_inspire(export_ns, output_languages=["English", "Arabic"])
    obj._normalize_usecase = lambda usecase, name: usecase
    obj._generate_csv_catalog("Arabic", "ar", {"المبيعات": [uc]}, translations=labels)
    data = next(d for p, d in obj.w_client.workspace.files.items() if p.endswith(".csv"))
    rows = list(csv.reader(io.StringIO(data.decode("utf-8-sig"))))
    row = dict(zip(rows[0], rows[1]))
    assert not row.get(labels["untranslated_notice"])
    assert labels["elite_cadence"] not in data.decode("utf-8-sig")


def test_a_context_overflow_that_the_next_model_serves_is_a_warning_not_an_error(fresh_ns):
    from v120_runtime_reliability_test import FakeConnectSpark, RecordingLogger, make_agent, use_roster
    big, small = "databricks-claude-opus-5-5", "databricks-claude-opus-4-8"
    use_roster(fresh_ns, big, small)

    def answer(op):
        if op["endpoint"] == big:
            raise RuntimeError("BAD_REQUEST: prompt is too long: 213000 tokens > 200000 maximum")
        return "ok"
    log = RecordingLogger()
    agent = make_agent(fresh_ns, FakeConnectSpark(answer), log)
    assert agent._call_ai_query("translate these rows", "USE_CASE_TRANSLATE_PROMPT") == "ok"
    assert [m for lvl, m in log.records if lvl == "ERROR"] == []
    assert log.matching("Input too long on model", "WARNING")


def test_every_log_line_before_a_cascade_rebatch_is_a_warning():
    import ast
    from _agentload import agent_ast
    tree = agent_ast()
    seen = 0
    for fn in [n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]:
        nodes = list(ast.walk(fn))
        for raised in [n for n in nodes if isinstance(n, ast.Raise) and isinstance(n.exc, ast.Call)
                       and getattr(n.exc.func, "id", "") == "CascadeRebatchError"]:
            logged = [n for n in nodes if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                      and isinstance(n.func.value, ast.Attribute) and n.func.value.attr == "logger"
                      and 0 < raised.lineno - n.lineno <= 6]
            assert logged and {c.func.attr for c in logged} == {"warning"}, (fn.name, raised.lineno)
            seen += 1
    assert seen == 2
