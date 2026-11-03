"""v1.3.1 live round 2 (TPC-DS, English + Arabic): 3 of 87 use cases kept their proposed key results in English.

The translator answered one batch with a CSV header of 22 columns and data rows that started with an extra
"No" cell. The column-shift repair rebuilt the row from the header names only, so the value in the overflow
cell (the last column, "Proposed Key Results") was dropped, the field fell back to English, and the partial
row was accepted with no retry. These tests pin: the repair keeps every cell, a partial row is re-requested
with the cache skipped, a row still partial after the retries is named in a WARNING and marked in the CSV
and XLSX export, and a list column with a different item count is treated as untranslated.
"""
import csv
import io
import json
import threading

from v120_artifacts_support import CapturingLogger, make_inspire, make_uc

BASE = ["No", "Name", "Business Domain", "Subdomain", "type", "Analytics Technique",
        "Statement", "Solution",
        "Business Value", "Beneficiary", "Sponsor", "Business Priority Alignment", "Strategic Goals Alignment",
        "Tables Involved", "Quality", "Headline", "Technique Label", "Measures of Success", "Financial Benefits",
        "Non-Financial Benefits", "KPI Names", "Proposed Key Results"]
COPY = {"No", "Analytics Technique", "Tables Involved", "Quality"}
ARABIC = "ترجمة عربية كاملة لهذا الحقل"


def arabic(item):
    row = {}
    for field in BASE:
        value = item.get(field, "")
        if field in COPY or not value:
            row[field] = value
        else:
            row[field] = " | ".join(f"{ARABIC} {i}" for i, _part in enumerate(value.split(" | ")))
    return row


def kpi(name):
    return {"name": name, "direction": "increase", "unit": "orders", "baseline": None, "query": "SELECT 1 AS v"}


def live_uc(no):
    return make_uc(no, **{
        "Statement": f"Online orders ship late for {no} and raise return exposure across lanes",
        "Solution": "Ridge regression on ship mode, carrier and warehouse ranks lanes for rerouting",
        "Business Value": "The fulfilment manager reroutes the slowest lanes every week to cut shipping delay",
        "KPIs": [kpi("Average web shipping cost per order line"), kpi("Distinct web orders in scope")],
        "Expected Key Results": [{"id": None, "kpi_id": None, "source": "proposed",
                                  "statement": "Hold average web shipping cost per order line at the current value"}],
    })


def render(header, rows, extra_leading_no=False):
    out = io.StringIO()
    writer = csv.writer(out, quoting=csv.QUOTE_ALL)
    writer.writerow(header)
    for row in rows:
        cells = [row.get(h, "") for h in BASE] + ["95", "faithful"]
        writer.writerow((["No"] if extra_leading_no else []) + cells)
    return out.getvalue()


class ScriptedAgent:
    def __init__(self, respond):
        self.respond = respond
        self.calls = []
        self._lock = threading.Lock()

    def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema=None, skip_cache=False, **kw):
        with self._lock:
            self.calls.append({"step": step_name, "skip_cache": skip_cache})
            call_no = len(self.calls)
        return self.respond(json.loads(prompt_vars["json_payload"]), skip_cache, call_no)


def service(ns, respond):
    return ns["TranslationService"](ScriptedAgent(respond), CapturingLogger())


def translate(ns, respond, use_cases):
    svc = service(ns, respond)
    return svc, svc.translate_use_case_list(use_cases, "Arabic", enable_parallelization=False)


def test_live_shift_with_a_short_header_keeps_the_proposed_key_results_translated(agent_ns):
    respond = lambda payload, skip_cache, n: render(BASE, [arabic(item) for item in payload], extra_leading_no=True)
    svc, out = translate(agent_ns, respond, [live_uc(f"N07-U0{i}") for i in (4, 5, 6)])
    assert [uc["No"] for uc in out] == ["N07-U04", "N07-U05", "N07-U06"]
    for uc in out:
        assert uc["_translation_status"] == "translated", (uc["No"], uc["_untranslated_fields"])
        assert uc["_key_results_translated"].startswith(ARABIC)
        assert uc["_kpi_names_translated"].count(" | ") == 1
    assert svc.logger.matching("realigned a column-shifted row for N07-U04", level="WARNING")
    assert not svc.logger.matching("[TRANSLATION GAP]")
    assert len(svc.ai_agent.calls) == 1


def test_a_partial_row_is_retried_with_the_cache_skipped_and_the_retry_fills_the_gap(agent_ns):
    def respond(payload, skip_cache, n):
        rows = [arabic(item) for item in payload]
        if not skip_cache:
            for row in rows:
                row["Proposed Key Results"] = ""
        return render(BASE + ["honesty_score", "honesty_justification"], rows)
    svc, out = translate(agent_ns, respond, [live_uc("N07-U04"), live_uc("N07-U05")])
    assert all(uc["_translation_status"] == "translated" for uc in out), [uc["_untranslated_fields"] for uc in out]
    assert all(uc["_key_results_translated"].startswith(ARABIC) for uc in out)
    assert [c["skip_cache"] for c in svc.ai_agent.calls] == [False, True]
    assert "_Batch_0p1_" in svc.ai_agent.calls[1]["step"]
    assert svc.logger.matching("[TRANSLATION PARTIAL] Batch #0: 2 use cases came back partly in English "
                               "(N07-U04 (Proposed Key Results); N07-U05 (Proposed Key Results))", level="WARNING")
    assert not svc.logger.matching("[TRANSLATION GAP]")


def test_the_retry_keeps_fields_the_first_answer_translated_and_fills_the_rest(agent_ns):
    def respond(payload, skip_cache, n):
        rows = [arabic(item) for item in payload]
        for row, item in zip(rows, payload):
            if skip_cache:
                row["Statement"] = item["Statement"]
            else:
                row["Proposed Key Results"] = ""
        return render(BASE + ["honesty_score", "honesty_justification"], rows)
    svc, out = translate(agent_ns, respond, [live_uc("N07-U06")])
    assert out[0]["_translation_status"] == "translated" and out[0]["_untranslated_fields"] == []
    assert out[0]["Statement"].startswith(ARABIC) and out[0]["_key_results_translated"].startswith(ARABIC)
    assert [c["skip_cache"] for c in svc.ai_agent.calls] == [False, True]


def test_a_row_still_partial_after_the_retries_is_named_in_a_warning_and_marked(agent_ns):
    def respond(payload, skip_cache, n):
        rows = [arabic(item) for item in payload]
        for row in rows:
            if row["No"] == "N07-U05":
                row["Proposed Key Results"] = ""
        return render(BASE + ["honesty_score", "honesty_justification"], rows)
    svc, out = translate(agent_ns, respond, [live_uc("N07-U04"), live_uc("N07-U05"), live_uc("N07-U06")])
    by_id = {uc["No"]: uc for uc in out}
    assert by_id["N07-U04"]["_translation_status"] == by_id["N07-U06"]["_translation_status"] == "translated"
    partial = by_id["N07-U05"]
    assert partial["_translation_status"] == "partial" and partial["_untranslated_fields"] == ["Proposed Key Results"]
    assert "_key_results_translated" not in partial
    rounds = agent_ns["TranslationService"]._PARTIAL_RETRY_ROUNDS
    assert rounds >= 2 and [c["skip_cache"] for c in svc.ai_agent.calls] == [False] + [True] * rounds
    assert svc.logger.matching("[TRANSLATION GAP] Arabic: 0 use cases untranslated and 1 partially translated out of 3 "
                               "after the retries with the cache skipped", level="WARNING")
    gap = svc.logger.matching("[TRANSLATION GAP]", level="WARNING")[0][1]
    assert gap.endswith(": N07-U05 (Proposed Key Results)") and "N07-U04" not in gap and "N07-U06" not in gap

    obj = make_inspire(agent_ns)
    labels = agent_ns["TranslationService"].TRANSLATION_FALLBACKS["Arabic"]
    gaps = obj._translation_gap_summary({"Shipping": out})
    assert gaps["use_cases"] == 1 and gaps["by_use_case"] == {"N07-U05": ["Proposed Key Results"]}
    obj._record_translation_gaps("Arabic", gaps)
    assert "Arabic (1 use case with text shown in English: N07-U05 (Proposed Key Results))" in " ".join(obj._run_outcome_warnings())
    headers, rows, _ = obj._catalog_export_table({"Shipping": out}, labels, "Arabic")
    column = headers.index(labels["untranslated_notice"])
    marks = {row[0]: row[column] for row in rows}
    assert marks["N07-U04"] == "" and marks["N07-U06"] == ""
    assert marks["N07-U05"].startswith(labels["untranslated_notice"] + ": ")
    english_headers, _rows, _ = obj._catalog_export_table({"Shipping": [live_uc("N07-U05")]}, None, "English")
    assert labels["untranslated_notice"] not in english_headers
    clean_headers, _rows, _ = obj._catalog_export_table({"Shipping": [by_id["N07-U04"]]}, labels, "Arabic")
    assert labels["untranslated_notice"] not in clean_headers


def test_a_list_column_with_a_different_item_count_is_untranslated_and_retried(agent_ns):
    def respond(payload, skip_cache, n):
        rows = [arabic(item) for item in payload]
        if not skip_cache:
            rows[0]["KPI Names"] = ARABIC
        return render(BASE + ["honesty_score", "honesty_justification"], rows)
    svc, out = translate(agent_ns, respond, [live_uc("N07-U04")])
    assert out[0]["_translation_status"] == "translated"
    assert out[0]["_kpi_names_translated"].count(" | ") == 1
    assert [c["skip_cache"] for c in svc.ai_agent.calls] == [False, True]
    cls = agent_ns["TranslationService"]
    first = cls._merge_translation(svc, live_uc("N07-U04"), dict(arabic(cls._translation_payload(live_uc("N07-U04"))),
                                                                  **{"KPI Names": ARABIC}), "Arabic")
    assert first["_untranslated_fields"] == ["KPI Names"]


def test_a_failed_retry_never_replaces_the_translated_fields_of_the_first_answer(agent_ns):
    def respond(payload, skip_cache, n):
        if skip_cache:
            raise RuntimeError("endpoint unavailable")
        rows = [arabic(item) for item in payload]
        rows[0]["Proposed Key Results"] = ""
        return render(BASE + ["honesty_score", "honesty_justification"], rows)
    svc, out = translate(agent_ns, respond, [live_uc("N07-U04")])
    assert out[0]["_translation_status"] == "partial" and out[0]["_untranslated_fields"] == ["Proposed Key Results"]
    assert out[0]["Statement"].startswith(ARABIC)
    assert all(c["skip_cache"] for c in svc.ai_agent.calls[1:])
