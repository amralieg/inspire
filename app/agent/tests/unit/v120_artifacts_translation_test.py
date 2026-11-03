"""v1.2.0 ARTIFACTS lane: translation keeps every use case whole and flags what stays English.

D1-01 translated text is merged onto a copy of the original, so scores, BoB, elite fields and flags
survive in every language; D1-15 Quality (and identifiers) stay canonical English; D1-16 order is
kept under parallel translation; D1-17 IDs compare as text; D1-10 column-shift repair never forces a
Quality; the elite text fields are translated or flagged (CLAUDE.md §3c); the JSON payloads are no
longer brace-doubled; the CSV is cleaned through `clean_csv_response`; a failed UI translation
falls back to the curated labels instead of English.
"""
import csv
import io
import json
import threading
import time

import pytest

from v120_artifacts_support import CapturingLogger, elite_assessment, make_inspire, make_uc

BASE = ["No", "Name", "Business Domain", "Subdomain", "type", "Analytics Technique",
        "Statement", "Solution",
        "Business Value", "Beneficiary", "Sponsor", "Business Priority Alignment", "Strategic Goals Alignment",
        "Tables Involved", "Quality", "Headline", "Technique Label", "Measures of Success", "Financial Benefits",
        "Non-Financial Benefits", "KPI Names", "Proposed Key Results"]
ELITE_TEXT = {"Elite Verdict Reason": "verdict_reason", "Elite Decision": "decision", "Elite Decision Owner": "decision_owner",
              "Elite KPI": "kpi", "Elite Value Driver": "value_driver", "Elite Build Path": "build_path", "Elite Red Team": "red_team"}
OPTIONAL = ["Coverage Pick Reason", "Below Bar Reason", "Priority Reasons", "Quality Reasons", "Best of Best Reason"] + list(ELITE_TEXT)
TEXT = ["Name", "Business Domain", "Subdomain", "type", "Statement", "Solution",
        "Business Value", "Beneficiary",
        "Sponsor", "Business Priority Alignment", "Strategic Goals Alignment", "Headline", "Technique Label",
        "Measures of Success", "Financial Benefits", "Non-Financial Benefits", "KPI Names", "Proposed Key Results"]


def csv_text(rows, header):
    out = io.StringIO()
    writer = csv.writer(out, quoting=csv.QUOTE_ALL)
    writer.writerow(header + ["honesty_score", "honesty_justification"])
    for row in rows:
        writer.writerow([row.get(h, "") for h in header] + ["90", "faithful"])
    return out.getvalue()


def french(item, with_optional=True):
    row = {f: (f"FR {item[f]}" if f in TEXT and item.get(f) else item.get(f, "")) for f in BASE}
    row["Quality"] = "Élevé"
    row["Tables Involved"] = "wrong.schema.table"
    row["Analytics Technique"] = "Prévision"
    if with_optional:
        for column in OPTIONAL:
            if item.get(column):
                row[column] = f"FR {item[column]}"
    return row


class FakeAgent:
    def __init__(self, respond):
        self.respond = respond
        self.calls = []
        self._lock = threading.Lock()

    def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema=None, skip_cache=False, **kw):
        with self._lock:
            self.calls.append({"step": step_name, "prompt": worker_prompt_path, "vars": dict(prompt_vars), "skip_cache": skip_cache})
        return self.respond(json.loads(prompt_vars["json_payload"]), prompt_vars)


def service(ns, respond):
    return ns["TranslationService"](FakeAgent(respond), CapturingLogger())


def default_respond(payload, prompt_vars, with_optional=True):
    header = BASE + (OPTIONAL if any(any(item.get(c) for c in OPTIONAL) for item in payload) else [])
    return csv_text([french(item, with_optional) for item in payload], header)


def rich_uc(no, **extra):
    uc = make_uc(no, **{"Inspire Score": 8.4, "bob_score": 7.9, "bob_tier1_score": 8.0, "elite_status": "ELITE",
                        "elite_score": 8.8, "elite_assessment": elite_assessment(), "gate_flags": ["Q3_R5"],
                        "genie_instruction": "Build {result_table} weekly", "Quality": "Ultra High"})
    uc.update(extra)
    return uc


def test_translated_use_cases_keep_every_non_text_field(agent_ns):
    originals = [rich_uc("N01-U01"), rich_uc("N01-U02", Quality="High")]
    out = service(agent_ns, default_respond).translate_use_case_list(originals, "French", enable_parallelization=False)
    assert [uc["No"] for uc in out] == ["N01-U01", "N01-U02"]
    for original, merged in zip(originals, out):
        for key in ("Inspire Score", "bob_score", "bob_tier1_score", "elite_status", "elite_score", "gate_flags",
                    "scoring_status", "genie_instruction", "result_table", "Priority", "Quality Score"):
            assert merged[key] == original[key], key
        assert merged["Statement"] == f"FR {original['Statement']}" and merged["_translation_status"] == "translated"
        assert merged["elite_assessment"]["scores"] == original["elite_assessment"]["scores"]
    assert originals[0]["Statement"] == "Statement for N01-U01", "the English use case must not be mutated"
    assert originals[0]["elite_assessment"]["decision"] == elite_assessment()["decision"]


def test_quality_and_identifiers_stay_canonical_english(agent_ns):
    uc = make_uc("N01-U01", Quality="Ultra High")
    item = {f: str(uc.get(f, "")) for f in BASE}

    class Agent:
        def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema=None, skip_cache=False, **kw):
            return csv_text([french(item)], BASE)
    svc = agent_ns["TranslationService"](Agent(), CapturingLogger())
    out = svc.translate_use_case_list([uc], "French", enable_parallelization=False)
    assert out[0]["Name"] == "FR Forecast demand N01-U01", "the batch must have been translated, not reverted"
    assert out[0]["Quality"] == "Ultra High"
    assert out[0]["Tables Involved"] == "main.s.sales" and out[0]["Analytics Technique"] == "Forecasting"


def test_parallel_translation_keeps_input_order(agent_ns):
    class SlowFirstBatchAgent(FakeAgent):
        def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema=None, skip_cache=False, **kw):
            if "_Batch_0_" in step_name:
                time.sleep(0.3)
            return super().run_worker(step_name, worker_prompt_path, prompt_vars, response_schema, skip_cache, **kw)
    originals = [make_uc(f"N01-U{i:02d}") for i in range(1, 11)]
    svc = agent_ns["TranslationService"](SlowFirstBatchAgent(default_respond), CapturingLogger())
    out = svc.translate_use_case_list(originals, "French", max_parallelism=4, enable_parallelization=True)
    assert [uc["No"] for uc in out] == [uc["No"] for uc in originals]
    assert all(uc["_translation_status"] == "translated" for uc in out)


def test_integer_ids_are_matched_as_text(agent_ns):
    out = service(agent_ns, default_respond).translate_use_case_list([make_uc(7), make_uc(8)], "French", enable_parallelization=False)
    assert [uc["No"] for uc in out] == [7, 8] and all(uc["_translation_status"] == "translated" for uc in out)


def test_column_shift_repair_realigns_and_never_forces_a_quality(agent_ns):
    def respond(payload, prompt_vars):
        rows = []
        for item in payload:
            translated = french(item)
            shifted = {"No": "No"}
            for left, right in zip(BASE[1:], BASE[:-1]):
                shifted[left] = translated[right]
            rows.append(shifted)
        return csv_text(rows, BASE)
    out = service(agent_ns, respond).translate_use_case_list([make_uc("N01-U01", Quality="Medium")], "French", enable_parallelization=False)
    assert out[0]["Quality"] == "Medium"
    assert out[0]["Name"] == "FR Forecast demand N01-U01" and out[0]["_translation_status"] == "translated"


def test_the_elite_assessment_is_never_rewritten_and_its_text_and_the_coverage_reason_are_translated(agent_ns):
    ts = agent_ns["TranslationService"]
    uc = rich_uc("N01-U01", coverage_pick_reason="Domain coverage pick, below bar: quality 'Medium'")
    out = service(agent_ns, default_respond).translate_use_case_list([uc], "French", enable_parallelization=False)
    assert out[0]["elite_assessment"] == elite_assessment()
    assert out[0]["coverage_pick_reason"].startswith("FR Domain coverage pick")
    for field in ELITE_TEXT.values():
        assert out[0][ts.elite_translation_key(field)] == f"FR {elite_assessment()[field]}", field
    assert out[0]["_untranslated_fields"] == []


def test_an_untranslated_coverage_reason_and_elite_text_are_flagged(agent_ns):
    respond = lambda payload, prompt_vars: csv_text([french(item, with_optional=False) for item in payload], BASE)
    uc = rich_uc("N01-U01", coverage_pick_reason="Domain coverage pick, below bar: quality 'Medium'")
    out = service(agent_ns, respond).translate_use_case_list([uc], "French", enable_parallelization=False)
    assert out[0]["_translation_status"] == "partial"
    assert out[0]["_untranslated_fields"] == ["Coverage Pick Reason"] + list(ELITE_TEXT)
    assert out[0]["coverage_pick_reason"] == "Domain coverage pick, below bar: quality 'Medium'"


def test_payload_is_plain_json_and_carries_only_the_elite_text_fields(agent_ns):
    svc = service(agent_ns, default_respond)
    svc.translate_use_case_list([make_uc("N01-U01", Statement="Rank {region} weekly")], "French", enable_parallelization=False)
    payload = json.loads(svc.ai_agent.calls[0]["vars"]["json_payload"])
    assert payload[0]["Statement"] == "Rank {region} weekly"
    assert "{{" not in svc.ai_agent.calls[0]["vars"]["json_payload"]
    svc.translate_use_case_list([rich_uc("N01-U02", coverage_pick_reason="Below bar")], "French", enable_parallelization=False)
    raw = svc.ai_agent.calls[-1]["vars"]["json_payload"]
    elite_payload = json.loads(raw)
    assert set(elite_payload[0]) <= {"No"} | set(BASE) | set(OPTIONAL)
    assert elite_payload[0]["Coverage Pick Reason"] == "Below bar"
    for column, field in ELITE_TEXT.items():
        assert elite_payload[0][column] == elite_assessment()[field], column
    for key in ("cadence", "value_tier", "verdict", "scores", "verification", "signal_columns", "join_path", "kpi_direction"):
        assert f'"{key}"' not in raw, key
    assert "main.s.sales.units_sold" not in raw and "survives" not in raw


def test_payload_keys_follow_the_csv_header_order_so_values_never_shift(agent_ns):
    svc = service(agent_ns, default_respond)
    uc = rich_uc("N01-U01", coverage_pick_reason="Below bar", fallback_reason="Kept for coverage",
                 Justification="Strategic fit is high", best_of_best_reason="passed every elite test",
                 **{"Measures of Success": ["Weekly report is used"], "Financial Benefits": ["Revenue up"],
                    "Non-Financial Benefits": ["Loyalty"], "Quality Summary": "Grounded in the sales table"})
    svc.translate_use_case_list([uc], "French", enable_parallelization=False)
    payload = json.loads(svc.ai_agent.calls[-1]["vars"]["json_payload"])[0]
    assert list(payload) == BASE + OPTIONAL
    svc.translate_use_case_list([make_uc("N01-U02")], "French", enable_parallelization=False)
    assert list(json.loads(svc.ai_agent.calls[-1]["vars"]["json_payload"])[0]) == BASE


def test_the_payload_column_order_is_the_prompt_csv_header(agent_ns):
    prompt = agent_ns["PROMPT_TEMPLATES"]["USE_CASE_TRANSLATE_PROMPT"]
    header_line = prompt.split("**CSV HEADER (MUST BE EXACTLY THIS)**:", 1)[1].strip().splitlines()[0]
    assert next(csv.reader(io.StringIO(header_line))) == list(agent_ns["TranslationService"]._TRANSLATION_COLUMN_ORDER) == BASE


def test_ui_label_payload_is_not_brace_doubled(agent_ns):
    captured = {}

    class Agent:
        def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema=None, skip_cache=False, **kw):
            captured.update(prompt_vars)
            raise RuntimeError("endpoint unavailable")
    svc = agent_ns["TranslationService"](Agent(), CapturingLogger())
    labels = svc.get_translations("Arabic")
    assert json.loads(captured["json_payload"])["more_use_cases"] == "...and {count} more use cases."
    assert labels["elite_reason"] == agent_ns["TranslationService"].TRANSLATION_FALLBACKS["Arabic"]["elite_reason"] != "Reason"
    assert labels["pdf_detailed_view"] != agent_ns["TranslationService"].ENGLISH_TRANSLATIONS["pdf_detailed_view"]
    assert svc.logger.matching("[TRANSLATION GAP] UI labels for Arabic use the curated fallback", level="WARNING")


def test_fenced_csv_with_a_prose_preamble_is_parsed(agent_ns):
    respond = lambda payload, prompt_vars: "Here is the translation you asked for:\n```csv\n" + default_respond(payload, prompt_vars) + "```\n"
    out = service(agent_ns, respond).translate_use_case_list([make_uc("N01-U01")], "French", enable_parallelization=False)
    assert out[0]["_translation_status"] == "translated" and out[0]["Solution"] == "FR Model it"


def test_failed_batches_return_complete_flagged_copies(agent_ns):
    def respond(payload, prompt_vars):
        raise RuntimeError("model unavailable")
    svc = service(agent_ns, respond)
    out = svc.translate_use_case_list([rich_uc("N01-U01")], "Arabic", enable_parallelization=False)
    assert out[0]["_translation_status"] == "untranslated" and out[0]["elite_score"] == 8.8
    assert "Statement" in out[0]["_untranslated_fields"]
    assert set(ELITE_TEXT) <= set(out[0]["_untranslated_fields"])
    assert [c["skip_cache"] for c in svc.ai_agent.calls] == [False, True]
    assert svc.logger.matching("[TRANSLATION GAP] Arabic: 1 use case untranslated", level="WARNING")


def test_non_latin_text_still_in_english_is_flagged_but_identifiers_are_ignored(agent_ns):
    cls = agent_ns["TranslationService"]
    assert cls._looks_untranslated("Reduce weekly stock-outs", "Reduce weekly stock-outs now", "Arabic") is True
    assert cls._looks_untranslated("Use `units_sold` and `sale_date`", "استخدم `units_sold_by_store_day` و`sale_date_local`", "Arabic") is False
    assert cls._looks_untranslated("A long English sentence here", "A long English sentence here", "French") is True
    assert cls._looks_untranslated("CFO", "CFO", "French") is False


def test_alignment_keeps_colliding_domains_and_flags_missing_use_cases(agent_ns):
    obj = make_inspire(agent_ns)
    master = {"Sales": [make_uc("N01-U01", "Sales")], "Retail Sales": [make_uc("N02-U01", "Retail Sales")]}
    translated = [dict(make_uc("N01-U01", "Ventes"), _translation_status="translated", _untranslated_fields=[]),
                  dict(make_uc("N02-U01", "Ventes"), _translation_status="translated", _untranslated_fields=[])]
    aligned = obj._align_translated_data(master, translated)
    assert list(aligned) == ["Ventes", "Ventes (Retail Sales)"]
    aligned = obj._align_translated_data(master, translated[:1])
    missing = aligned["Retail Sales"][0]
    assert missing["_translation_status"] == "untranslated" and missing["No"] == "N02-U01"


def test_language_pack_records_the_translation_gaps(agent_ns):
    obj = make_inspire(agent_ns)
    obj.ai_agent = type("A", (), {"set_language": lambda self, lang: None})()
    respond = lambda payload, prompt_vars: csv_text([french(item, with_optional=False) for item in payload], BASE)
    obj.translation_service = service(agent_ns, respond)
    obj.translation_service.get_translations = lambda lang: {}
    obj._get_salesy_summary = lambda grouped, name, lang, t: ({}, name)
    english = [rich_uc("N01-U01", coverage_pick_reason="Below bar"), make_uc("N01-U02")]
    result = obj._translate_and_prepare_language_pack("French", english, {"Sales": english}, "Acme")
    assert result[1] == "fr" and result[3]
    gaps = obj.final_inspire_results_json["translation_gaps"]["French"]
    assert gaps["use_cases"] == 1 and gaps["fields"] == {"Coverage Pick Reason": 1, **{column: 1 for column in ELITE_TEXT}}


def test_a_language_pack_translates_its_batches_in_parallel_with_its_share(agent_ns):
    obj = make_inspire(agent_ns)
    obj.ai_agent = type("A", (), {"set_language": lambda self, lang: None})()
    respond = lambda payload, prompt_vars: csv_text([french(item, with_optional=False) for item in payload], BASE)
    svc = service(agent_ns, respond)
    svc.get_translations = lambda lang: {}
    real, calls = svc.translate_use_case_list, []

    def spy(ucs, lang, max_parallelism=20, enable_parallelization=True):
        calls.append((max_parallelism, enable_parallelization))
        return real(ucs, lang, max_parallelism=max_parallelism, enable_parallelization=enable_parallelization)
    svc.translate_use_case_list = spy
    obj.translation_service = svc
    obj._get_salesy_summary = lambda grouped, name, lang, t: ({}, name)
    english = [make_uc(f"N01-U{i:02d}") for i in range(1, 8)]
    result = obj._translate_and_prepare_language_pack("French", english, {"Sales": english}, "Acme", batch_parallelism=4)
    assert calls == [(4, True)] and result[3]
    translated = [uc for ucs in result[3].values() for uc in ucs]
    assert len(translated) == 7 and all(uc["_translation_status"] == "translated" for uc in translated)
    obj._translate_and_prepare_language_pack("French", english, {"Sales": english}, "Acme")
    assert calls[-1] == (1, False), "without a share the pack keeps translating one batch at a time"


def test_every_fallback_language_covers_every_label(agent_ns):
    cls = agent_ns["TranslationService"]
    english_keys = set(cls.ENGLISH_TRANSLATIONS)
    for language, labels in cls.TRANSLATION_FALLBACKS.items():
        assert set(labels) == english_keys, (language, english_keys ^ set(labels))
        assert "{count}" in labels["more_use_cases"], language


def test_translate_prompt_declares_only_the_optional_reason_columns(agent_ns):
    prompt = agent_ns["PROMPT_TEMPLATES"]["USE_CASE_TRANSLATE_PROMPT"]
    for column in OPTIONAL:
        assert f'"{column}"' in prompt, column
    assert "exactly 24 fields: the 22 fields of the header above plus the 2 honesty fields" in prompt
    assert "a row has 25 fields with one of them and 37 with all thirteen" in prompt and "ELITE" not in prompt
    keywords = agent_ns["PROMPT_TEMPLATES"]["KEYWORDS_TRANSLATE_PROMPT"].format(json_payload="{}", target_language="French")
    assert "{count}" in keywords and "Keep every placeholder exactly as written" in keywords
