"""Every column a person reads in the CSV, Excel and JSON catalogs is in each requested language, or flagged.

Before: the Arabic CSV and Excel kept "Priority Reasons", "Quality Reasons" and "Best of Best Reason" in English
on every row (the translator never received them, so the gap warning never counted them), four headers and the
Genie Code and elite status values stayed English, the Excel sheet names and the foundations headers were English,
and the JSON catalog was written in English only with no gap flag.
"""
import csv
import io
import json
import threading
import types

import pytest

from v120_artifacts_support import CapturingLogger, elite_assessment, make_inspire, make_uc

REASONS = (("Priority Reasons", "Justification"), ("Quality Reasons", "Quality Summary"),
           ("Best of Best Reason", "best_of_best_reason"))
ENGLISH_REASONS = {"Justification": "Strategic alignment is high because weekly planning depends on it",
                   "Quality Summary": "Grounded in the sales and stores tables with clean join keys",
                   "best_of_best_reason": "passed every elite test; outside the top 5 by elite score"}
ARABIC_REASONS = {"Justification": "التوافق الاستراتيجي مرتفع لأن التخطيط الأسبوعي يعتمد عليه",
                  "Quality Summary": "مبني على جداول المبيعات والمتاجر بمفاتيح ربط نظيفة",
                  "best_of_best_reason": "اجتاز كل اختبارات النخبة وخارج أفضل خمس حالات"}
ARABIC_TITLE = "توقع الطلب اليومي لتقليل نفاد المخزون"
BUILT_IN_ENGLISH_HEADERS = ("ID", "Business Domain", "Subdomain", "Use Case", "Description", "Primary Table",
                            "Priority Reasons", "Quality Reasons", "Result Database", "Has Genie Code",
                            "Best of Best Reason", "Elite Status", "Coverage Pick Reason", "Below Bar Reason")


@pytest.fixture
def ns(agent_ns, monkeypatch):
    monkeypatch.setattr(agent_ns["workspace"], "ImportFormat", types.SimpleNamespace(AUTO="AUTO"), raising=False)
    monkeypatch.setattr(agent_ns["workspace"], "ExportFormat", types.SimpleNamespace(AUTO="AUTO"), raising=False)
    return agent_ns


def arabic_labels(ns):
    ts = ns["TranslationService"]
    labels = dict(ts.ENGLISH_TRANSLATIONS)
    labels.update(ts.TRANSLATION_FALLBACKS["Arabic"])
    return labels


def english_portfolio():
    first = make_uc("N01-U01", "Sales", has_genie_code="Y", elite_status="ELITE", elite_score=8.8, **ENGLISH_REASONS)
    second = make_uc("N01-U02", "Sales", elite_status="DOMAIN_COVERAGE_PICK", Priority=5.0, **{"Inspire Score": 5.1},
                     coverage_pick_reason="Domain coverage pick, below bar: keeps Sales represented", **ENGLISH_REASONS)
    return [first, second]


def arabic_portfolio():
    first = make_uc("N01-U01", "المبيعات", Name="توقع الطلب على المنتجات", usecase=ARABIC_TITLE, Subdomain="التخطيط",
                    has_genie_code="Y", elite_status="ELITE", elite_score=8.8, **ARABIC_REASONS)
    second = make_uc("N01-U02", "المبيعات", Name="تغطية المجال", usecase="تغطية مجال المبيعات", Subdomain="التخطيط",
                     elite_status="DOMAIN_COVERAGE_PICK", Priority=5.0, **{"Inspire Score": 5.1},
                     coverage_pick_reason="اختيار لتغطية المجال يبقي المبيعات ممثلة", **ARABIC_REASONS)
    for uc in (first, second):
        uc["_translation_status"], uc["_untranslated_fields"] = "translated", []
    return {"المبيعات": [first, second]}


def written(obj, suffix):
    files = {path: data for path, data in obj.w_client.workspace.files.items() if path.endswith(suffix)}
    assert len(files) == 1, (suffix, sorted(obj.w_client.workspace.files))
    return next(iter(files.items()))


def bilingual(ns, **attrs):
    obj = make_inspire(ns, output_languages=["English", "Arabic"], **attrs)
    obj._normalize_usecase = lambda usecase, name: usecase
    return obj


def csv_rows(obj):
    _path, data = written(obj, ".csv")
    rows = list(csv.reader(io.StringIO(data.decode("utf-8-sig"))))
    return rows[0], [dict(zip(rows[0], row)) for row in rows[1:]]


def test_arabic_csv_reason_columns_headers_and_values_are_arabic(ns):
    obj = bilingual(ns)
    labels = arabic_labels(ns)
    obj._generate_csv_catalog("Arabic", "ar", arabic_portfolio(), translations=labels)
    header, rows = csv_rows(obj)
    for english in BUILT_IN_ENGLISH_HEADERS:
        assert english not in header, english
    by_id = {row[labels["sum_id"]]: row for row in rows}
    elite, pick = by_id["N01-U01"], by_id["N01-U02"]
    assert elite[labels["priority_reasons"]] == ARABIC_REASONS["Justification"]
    assert elite[labels["quality_reasons"]] == ARABIC_REASONS["Quality Summary"]
    assert elite[labels["doc_best_of_best_reason"]] == ARABIC_REASONS["best_of_best_reason"]
    assert elite[labels["doc_has_genie_code"]] == labels["value_yes"] != "Y"
    assert pick[labels["doc_has_genie_code"]] == labels["value_no"] != "N"
    assert elite[labels["doc_elite_status"]] == labels["doc_elite_status_elite"] != "ELITE"
    assert pick[labels["doc_elite_status"]] == labels["elite_coverage_pick"]
    assert pick[labels["doc_coverage_pick_reason"]] == "اختيار لتغطية المجال يبقي المبيعات ممثلة"
    assert elite[labels["doc_result_database"]] == "main.s.r_N01-U01"


def test_arabic_csv_below_bar_status_reads_the_arabic_label_with_its_bar(ns):
    obj = bilingual(ns)
    labels = arabic_labels(ns)
    portfolio = arabic_portfolio()
    below = portfolio["المبيعات"][1]
    below.update(elite_status="FALLBACK_BELOW_BAR", fallback_kind="tier", fallback_bar="High", fallback_reason="أقرب حالة للمعيار")
    obj._generate_csv_catalog("Arabic", "ar", portfolio, translations=labels)
    _header, rows = csv_rows(obj)
    row = {r[labels["sum_id"]]: r for r in rows}["N01-U02"]
    expected = labels["elite_fallback_pick"].replace("{mode}", labels["value_mode_high"])
    assert row[labels["doc_elite_status"]] == expected and "{mode}" not in expected
    assert row[labels["doc_below_bar_reason"]] == "أقرب حالة للمعيار"


def test_english_csv_keeps_its_headers_and_status_codes(ns):
    obj = make_inspire(ns)
    obj._normalize_usecase = lambda usecase, name: usecase
    obj._generate_csv_catalog("English", "en", {"Sales": english_portfolio()})
    header, rows = csv_rows(obj)
    for english in BUILT_IN_ENGLISH_HEADERS:
        assert english in header, english
    by_id = {row["ID"]: row for row in rows}
    assert by_id["N01-U01"]["Has Genie Code"] == "Y" and by_id["N01-U02"]["Has Genie Code"] == "N"
    assert by_id["N01-U01"]["Elite Status"] == "ELITE" and by_id["N01-U02"]["Elite Status"] == "DOMAIN_COVERAGE_PICK"
    assert by_id["N01-U01"]["Priority Reasons"] == ENGLISH_REASONS["Justification"]


def test_every_built_in_export_header_has_a_translated_label(ns):
    obj = make_inspire(ns)
    labels = arabic_labels(ns)
    english = [header for header, _get, _numeric in obj._export_columns(True, True)]
    arabic = [header for header, _get, _numeric in obj._export_columns(True, True, labels, "Arabic")]
    assert len(english) == len(arabic)
    same = [en for en, ar in zip(english, arabic) if en == ar]
    assert same == [], same


def foundations():
    return [{"id": "F1", "tables": ["main.s.sales", "main.s.stores"],
             "joins": [{"left": "main.s.sales.store_id", "right": "main.s.stores.store_id", "source": "fk"}],
             "use_case_count": 2, "use_cases": ["N01-U01", "N01-U02"], "summed_inspire_score": 12.7}]


def test_arabic_excel_sheet_names_foundations_headers_and_reasons_are_arabic(ns):
    import openpyxl
    obj = bilingual(ns, data_foundations=foundations())
    labels = arabic_labels(ns)
    obj._generate_use_case_excel("Arabic", "ar", arabic_portfolio(), translations=labels)
    _path, data = written(obj, ".xlsx")
    book = openpyxl.load_workbook(io.BytesIO(data))
    assert book.sheetnames == [labels["doc_use_cases"], labels["doc_foundations_title"]]
    sheet = book[labels["doc_use_cases"]]
    header = [c.value for c in sheet[1]]
    for english in BUILT_IN_ENGLISH_HEADERS:
        assert english not in header, english
    row = dict(zip(header, [c.value for c in sheet[2]]))
    assert row[labels["priority_reasons"]] == ARABIC_REASONS["Justification"]
    assert row[labels["doc_best_of_best_reason"]] == ARABIC_REASONS["best_of_best_reason"]
    found = [c.value for c in book[labels["doc_foundations_title"]][1]]
    assert found == [labels["sum_id"], labels["doc_foundation_tables"], labels["doc_foundation_joins"],
                     labels["doc_foundation_unlocks"], labels["doc_foundation_use_case_ids"], labels["doc_foundation_summed_score"]]


def test_english_excel_keeps_its_sheet_names_and_foundation_headers(ns):
    import openpyxl
    obj = make_inspire(ns, data_foundations=foundations())
    obj._normalize_usecase = lambda usecase, name: usecase
    obj._generate_use_case_excel("English", "en", {"Sales": english_portfolio()})
    _path, data = written(obj, ".xlsx")
    book = openpyxl.load_workbook(io.BytesIO(data))
    assert book.sheetnames == ["Use Cases", "Foundations"]
    assert [c.value for c in book["Foundations"][1]] == ["ID", "Tables", "Joins", "Use cases unlocked", "Use Case IDs", "Summed Inspire Score"]


def test_sheet_names_drop_characters_excel_forbids_and_stay_within_31_characters(ns):
    obj = make_inspire(ns)
    assert obj._excel_sheet_name("a/b\\c?d*e[f]g:h", "Use Cases") == "abcdefgh"
    assert len(obj._excel_sheet_name("x" * 40, "Use Cases")) == 31
    assert obj._excel_sheet_name("[]:*?/\\", "Use Cases") == "Use Cases"


class FakeAgent:
    def __init__(self, respond):
        self.respond = respond
        self.calls = []
        self._lock = threading.Lock()

    def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema=None, skip_cache=False, **kw):
        with self._lock:
            self.calls.append(dict(prompt_vars))
        return self.respond(json.loads(prompt_vars["json_payload"]))


def french_responder(left_in_english=(), translate=lambda value: f"FR {value}"):
    copied = {"No", "Tables Involved", "Analytics Technique", "Quality"}

    def respond(payload):
        header = list(payload[0])
        out = io.StringIO()
        writer = csv.writer(out, quoting=csv.QUOTE_ALL)
        writer.writerow(header + ["honesty_score", "honesty_justification"])
        for item in payload:
            writer.writerow([item.get(h, "") if h in copied or h in left_in_english else (translate(item[h]) if item.get(h) else "")
                             for h in header] + ["90", "faithful"])
        return out.getvalue()
    return respond


def reason_use_case(no="N01-U01"):
    return make_uc(no, **ENGLISH_REASONS)


def test_the_translator_receives_and_translates_the_three_reason_columns(ns):
    svc = ns["TranslationService"](FakeAgent(french_responder()), CapturingLogger())
    original = reason_use_case()
    out = svc.translate_use_case_list([original], "French", enable_parallelization=False)
    payload = json.loads(svc.ai_agent.calls[0]["json_payload"])[0]
    for column, key in REASONS:
        assert payload[column] == ENGLISH_REASONS[key], column
        assert out[0][key] == f"FR {ENGLISH_REASONS[key]}", key
    assert out[0]["_translation_status"] == "translated" and out[0]["_untranslated_fields"] == []
    assert original["Justification"] == ENGLISH_REASONS["Justification"]


def test_a_reason_left_in_english_is_flagged_and_counted_by_the_gap_summary(ns):
    svc = ns["TranslationService"](FakeAgent(french_responder(left_in_english={"Best of Best Reason"})), CapturingLogger())
    out = svc.translate_use_case_list([reason_use_case()], "French", enable_parallelization=False)
    assert out[0]["_translation_status"] == "partial" and out[0]["_untranslated_fields"] == ["Best of Best Reason"]
    gaps = ns["DatabricksInspire"]._translation_gap_summary({"Ventes": out})
    assert gaps["use_cases"] == 1 and gaps["fields"] == {"Best of Best Reason": 1}


def test_an_untranslated_use_case_lists_the_reason_columns_as_gaps(ns):
    fields = ns["TranslationService"].untranslated_copy(reason_use_case())["_untranslated_fields"]
    assert {"Priority Reasons", "Quality Reasons", "Best of Best Reason"} <= set(fields)


def test_the_translate_prompt_declares_every_optional_reason_column(ns):
    prompt = ns["PROMPT_TEMPLATES"]["USE_CASE_TRANSLATE_PROMPT"]
    for column, _key in ns["TranslationService"]._BELOW_BAR_TRANSLATION_FIELDS:
        assert f'"{column}"' in prompt, column
    for column, _key in REASONS + ns["TranslationService"]._ELITE_OPTIONAL_TRANSLATION_FIELDS:
        assert f'"{column}"' in prompt, column


def test_pdf_and_markdown_notices_skip_reason_columns_they_never_show(ns):
    obj = make_inspire(ns)
    labels = arabic_labels(ns)
    uc = make_uc("N01-U01", _translation_status="partial", _untranslated_fields=["Best of Best Reason", "Priority Reasons"])
    assert obj._untranslated_notice(uc, labels, "Arabic") == ""
    uc["_untranslated_fields"] = ["Statement", "Quality Reasons"]
    assert obj._untranslated_notice(uc, labels, "Arabic") == f"{labels['untranslated_notice']}: {labels['statement']}"


def catalog_obj(ns, **attrs):
    obj = bilingual(ns, **attrs)
    obj.column_id_map = {"main.s.sales.units": "1"}
    obj.id_column_map = {"1": {"fqn": "main.s.sales.units", "description": "INT"}}
    obj.table_id_map, obj.id_table_map = {"main.s.sales": "1"}, {"1": "main.s.sales"}
    obj.catalogs_str, obj.schemas_str, obj.generation_path = "main", "", "/Workspace/out"
    return obj


def arabic_pack(ns):
    return ("Arabic", "ar", arabic_labels(ns), arabic_portfolio(), {"Executive": "<p>ملخص تنفيذي</p>",
                                                                  "المبيعات": "<p>ملخص المبيعات</p>"}, "أكمي")


def run_documents(ns, obj, pack):
    statuses = []
    obj._emit_pipeline_status = lambda **kw: statuses.append(kw) or len(statuses)
    obj._python_package_status = {"weasyprint": (True, ""), "xlsxwriter": (True, ""), "pptx": (True, "")}
    obj.translation_service = types.SimpleNamespace(get_translations=lambda lang: dict(ns["TranslationService"].ENGLISH_TRANSLATIONS))
    obj.generate_catalog_pdf = lambda *a, **k: None
    obj.generate_presentation_pptx = lambda *a, **k: None
    obj._translate_and_prepare_language_pack = pack
    english = english_portfolio()
    obj._generate_documents_for_all_languages(english, english_grouped_data={"Sales": english},
                                              summary_dict={"Executive": "x"}, languages=["English", "Arabic"],
                                              skip_excel_langs=["English"])
    return statuses


def test_document_generation_writes_an_arabic_json_catalog_with_arabic_fields(ns):
    obj = catalog_obj(ns, generate_choices=[])
    run_documents(ns, obj, lambda *a, **k: arabic_pack(ns))
    path, data = written(obj, ".json")
    assert path == "/Workspace/out/docs/Acme-dbx_inspire_ar.json"
    payload = json.loads(data)
    labels = arabic_labels(ns)
    assert payload["language"] == "Arabic" and payload["translation_gaps"] == {}
    assert payload["title"] == f"أكمي {labels['doc_catalog_kicker']}"
    assert payload["executive_summary"] == "<p>ملخص تنفيذي</p>"
    domain = payload["domains"][0]
    assert domain["domain_name"] == "المبيعات" and domain["summary"] == "<p>ملخص المبيعات</p>"
    uc = domain["use_cases"][0]
    assert uc["usecase"] == ARABIC_TITLE and uc["Justification"] == ARABIC_REASONS["Justification"]
    assert payload["table_registry"] == {"1": "main.s.sales"}
    assert obj.final_inspire_results_json.get("title") is None, "the App's English results_json is never overwritten"
    assert obj.logger.matching("[VIBE-LANG all-artifacts-produced] language=Arabic", level="INFO")


def test_a_missing_arabic_pack_records_the_json_catalog_gap(ns):
    obj = catalog_obj(ns, generate_choices=[])
    run_documents(ns, obj, lambda lang, *a, **k: (lang, "ar", None, None, None, None))
    assert ("JSON Catalog", "Arabic") in {(f["step"], f["language"]) for f in obj.failed_steps}
    assert "JSON Catalog (Arabic)" in obj.run_exit_value()


def test_a_partly_translated_arabic_json_carries_its_gaps(ns):
    obj = catalog_obj(ns, generate_choices=[])

    def pack(*a, **k):
        result = list(arabic_pack(ns))
        uc = result[3]["المبيعات"][0]
        uc["_translation_status"], uc["_untranslated_fields"] = "partial", ["Priority Reasons"]
        uc["Justification"] = ENGLISH_REASONS["Justification"]
        return tuple(result)
    run_documents(ns, obj, pack)
    payload = json.loads(written(obj, ".json")[1])
    assert payload["translation_gaps"] == {"use_cases": 1, "untranslated_use_cases": 0, "fields": {"Priority Reasons": 1},
                                           "by_use_case": {"N01-U01": ["Priority Reasons"]}}
    assert payload["domains"][0]["use_cases"][0]["_untranslated_fields"] == ["Priority Reasons"]


def test_saving_the_english_json_keeps_its_name_and_shape_and_refreshes_the_arabic_one(ns):
    obj = catalog_obj(ns)
    obj._language_packs = {"Arabic": ("ar", arabic_labels(ns), arabic_portfolio(), {"Executive": "<p>ملخص</p>"}, "أكمي")}
    final = english_portfolio()
    final[0]["notebook_path"] = "/Workspace/out/notebooks/N01-U01"
    final[0]["has_genie_code"] = "Y"
    obj._save_usecases_catalog_json(final, {}, summary_dict={"Executive": "Exec"})
    english = json.loads(obj.w_client.workspace.files["/Workspace/out/docs/Acme-dbx_inspire.json"])
    assert "language" not in english and "translation_gaps" not in english
    assert {"business_name", "title", "executive_summary", "domains_summary", "column_registry", "table_registry",
            "metadata", "domains"} <= set(english)
    assert english["title"] == "Acme Use Cases Catalog" and english["domains_summary"] == "Sales: 2 use cases"
    assert obj.final_inspire_results_json["title"] == "Acme Use Cases Catalog"
    arabic = json.loads(obj.w_client.workspace.files["/Workspace/out/docs/Acme-dbx_inspire_ar.json"])
    uc = arabic["domains"][0]["use_cases"][0]
    assert uc["notebook_path"] == "/Workspace/out/notebooks/N01-U01", "the Arabic JSON follows the final English use cases"
    assert uc["Justification"] == ARABIC_REASONS["Justification"] and uc["usecase"] == ARABIC_TITLE
    assert arabic["language"] == "Arabic" and set(english) <= set(arabic)


def test_docs_only_mode_refuses_a_translated_json_and_restores_the_id_maps_from_english(ns):
    obj = catalog_obj(ns)
    obj._language_packs = {"Arabic": ("ar", arabic_labels(ns), arabic_portfolio(), {"Executive": "<p>ملخص</p>"}, "أكمي")}
    obj._save_usecases_catalog_json(english_portfolio(), {}, summary_dict={"Executive": "Exec"})
    files = dict(obj.w_client.workspace.files)
    fresh = make_inspire(ns)
    fresh.column_id_map, fresh.id_column_map, fresh.table_id_map, fresh.id_table_map = {}, {}, {}, {}
    fresh.w_client.workspace.files.update(files)
    with pytest.raises(ValueError, match="Acme-dbx_inspire.json"):
        fresh._load_usecases_catalog_json("/Workspace/out/docs/Acme-dbx_inspire_ar.json")
    fresh._load_usecases_catalog_json("/Workspace/out/docs/Acme-dbx_inspire.json")
    assert fresh.id_table_map == {"1": "main.s.sales"} and fresh.table_id_map == {"main.s.sales": "1"}
    assert fresh.id_column_map == {"1": {"fqn": "main.s.sales.units", "description": "INT"}}
    assert fresh.column_id_map == {"main.s.sales.units": "1"}


def test_english_only_notebooks_are_flagged_for_every_other_requested_language(ns):
    obj = bilingual(ns)
    obj._flag_english_only_notebooks([make_uc("N01-U01", notebook_path="/Workspace/out/notebooks/n1"), make_uc("N01-U02")])
    assert obj.translation_gaps == {"Arabic": {"artifacts_in_english": ["Genie Code notebooks"]}}
    assert "translation gaps: Arabic (written in English only: Genie Code notebooks)" in obj.run_exit_value()
    obj._record_translation_gaps("Arabic", {"use_cases": 1, "untranslated_use_cases": 0, "fields": {"Priority Reasons": 1}})
    assert obj.translation_gaps["Arabic"]["artifacts_in_english"] == ["Genie Code notebooks"]
    assert "Arabic (1 use case with text shown in English; written in English only: Genie Code notebooks)" in obj.run_exit_value()
    assert obj.logger.matching("[VIBE-LANG english-only-notebooks]", level="WARNING")


def test_english_only_runs_and_runs_without_notebooks_are_not_flagged(ns):
    english = make_inspire(ns)
    english._flag_english_only_notebooks([make_uc("N01-U01", notebook_path="/Workspace/out/notebooks/n1")])
    no_notebooks = bilingual(ns)
    no_notebooks._flag_english_only_notebooks([make_uc("N01-U01")])
    for obj in (english, no_notebooks):
        assert not getattr(obj, "translation_gaps", None) and obj.run_exit_value() == ""


def test_the_run_flags_notebooks_after_they_are_written():
    from _agentload import agent_source
    source = agent_source()
    call = "        self._flag_english_only_notebooks(final_consolidated_use_cases)\n"
    assert source.count(call) == 1
    flag = source.index(call)
    batch = source.index("self.assemble_use_case_notebooks(final_consolidated_use_cases, english_translations, summary_dict)")
    assert batch < flag
    assert source[flag + len(call):].lstrip().startswith(
        'if final_consolidated_use_cases:\n            self.logger.info("Generating English Excel (post-notebook, with hyperlinks)...")')


ELITE_PROSE = ("verdict_reason", "decision", "decision_owner", "kpi", "value_driver", "build_path", "red_team")
NON_LATIN = ("Arabic", "Chinese (Mandarin)", "Japanese", "Korean", "Hindi", "Russian", "Ukrainian", "Tamil")


def export_label_keys(ns):
    di = ns["DatabricksInspire"]
    keys = set(di._EXPORT_HEADER_KEYS.values()) | {key for key, _source in di._USE_CASE_VIEW_ELITE}
    keys |= set(di._FIELD_LABEL_KEYS.values()) | set(di._DOC_CADENCE_KEYS.values()) | set(di._EXPORT_YES_NO_KEYS.values())
    keys |= {"doc_use_cases", "doc_foundations_title", "doc_foundation_tables", "doc_foundation_joins", "doc_foundation_unlocks",
             "doc_foundation_use_case_ids", "doc_foundation_summed_score", "doc_elite_status_elite", "untranslated_notice",
             "elite_red_team_note"}
    return sorted(keys)


def test_every_export_label_exists_in_all_22_fallback_languages(ns):
    ts = ns["TranslationService"]
    keys = export_label_keys(ns)
    assert len(ts.TRANSLATION_FALLBACKS) == 22 and len(keys) >= 70
    assert [k for k in keys if k not in ts.ENGLISH_TRANSLATIONS] == []
    for language, fallbacks in ts.TRANSLATION_FALLBACKS.items():
        assert [k for k in keys if not str(fallbacks.get(k) or "").strip()] == [], language
    for language in NON_LATIN:
        fallbacks = ts.TRANSLATION_FALLBACKS[language]
        same = [k for k in keys if fallbacks[k] == ts.ENGLISH_TRANSLATIONS[k] and k not in ("sum_id", "elite_kpi")]
        assert same == [], (language, same)


@pytest.mark.parametrize("language", NON_LATIN)
def test_no_english_built_in_header_in_a_non_latin_export(ns, language):
    ts = ns["TranslationService"]
    labels = dict(ts.ENGLISH_TRANSLATIONS)
    labels.update(ts.TRANSLATION_FALLBACKS[language])
    obj = make_inspire(ns)
    english = [header for header, _get, _numeric in obj._export_columns(True, True)]
    translated = [header for header, _get, _numeric in obj._export_columns(True, True, labels, language)]
    assert [en for en, other in zip(english, translated) if en == other and en != "ID"] == []


def elite_use_case(no="N01-U01"):
    return make_uc(no, elite_status="ELITE", elite_score=8.8, elite_assessment=elite_assessment(),
                   **ENGLISH_REASONS)


def test_the_translator_receives_translates_and_stores_the_elite_assessment_text(ns):
    ts = ns["TranslationService"]
    svc = ts(FakeAgent(french_responder()), CapturingLogger())
    original = elite_use_case()
    out = svc.translate_use_case_list([original], "French", enable_parallelization=False)[0]
    payload = json.loads(svc.ai_agent.calls[0]["json_payload"])[0]
    for column, field in ts._ELITE_TRANSLATION_FIELDS:
        assert payload[column] == original["elite_assessment"][field], column
        assert out[ts.elite_translation_key(field)] == f"FR {original['elite_assessment'][field]}", field
    assert out["_translation_status"] == "translated" and out["_untranslated_fields"] == []
    assert out["elite_assessment"] == original["elite_assessment"], "the English assessment the gates read is never rewritten"


def test_only_the_seven_elite_text_fields_are_sent_and_cadence_stays_a_label(ns):
    ts = ns["TranslationService"]
    svc = ts(FakeAgent(french_responder()), CapturingLogger())
    uc = make_uc("N01-U01", elite_status="ELITE", elite_assessment=elite_assessment())
    svc.translate_use_case_list([uc], "French", enable_parallelization=False)
    raw = svc.ai_agent.calls[0]["json_payload"]
    assert [field for _column, field in ts._ELITE_TRANSLATION_FIELDS] == list(ELITE_PROSE)
    for key in ("cadence", "value_tier", "verdict", "scores", "verification", "signal_columns", "join_path"):
        assert f'"{key}"' not in raw, key
    assert "main.s.sales.units_sold" not in raw and "Material" not in raw


def test_an_elite_field_left_in_english_is_flagged_counted_and_named_on_its_export_row(ns):
    ts = ns["TranslationService"]
    svc = ts(FakeAgent(french_responder(left_in_english={"Elite Decision", "Priority Reasons"})), CapturingLogger())
    out = svc.translate_use_case_list([elite_use_case()], "French", enable_parallelization=False)
    assert out[0]["_translation_status"] == "partial"
    assert sorted(out[0]["_untranslated_fields"]) == ["Elite Decision", "Priority Reasons"]
    gaps = ns["DatabricksInspire"]._translation_gap_summary({"Ventes": out})
    assert gaps["fields"] == {"Elite Decision": 1, "Priority Reasons": 1}
    assert svc.logger.matching("[TRANSLATION GAP] French", level="WARNING")


def test_a_reason_or_elite_field_left_in_english_is_retried_with_the_cache_skipped(ns):
    ts = ns["TranslationService"]
    first, later = french_responder(left_in_english={"Elite Decision", "Best of Best Reason"}), french_responder()

    class RetryAgent(FakeAgent):
        def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema=None, skip_cache=False, **kw):
            self.calls.append({"skip_cache": skip_cache})
            return (first if len(self.calls) == 1 else later)(json.loads(prompt_vars["json_payload"]))

    svc = ts(RetryAgent(None), CapturingLogger())
    out = svc.translate_use_case_list([elite_use_case()], "French", enable_parallelization=False)[0]
    assert [call["skip_cache"] for call in svc.ai_agent.calls] == [False, True]
    assert out["_translation_status"] == "translated" and out["_untranslated_fields"] == []
    assert out[ts.elite_translation_key("decision")].startswith("FR ")
    assert out["best_of_best_reason"].startswith("FR ")


def arabic_elite_portfolio(ns):
    ts = ns["TranslationService"]
    portfolio = arabic_portfolio()
    uc = portfolio["المبيعات"][0]
    uc["elite_assessment"] = elite_assessment()
    for field in ELITE_PROSE:
        uc[ts.elite_translation_key(field)] = f"نص عربي {field}"
    return portfolio


def test_arabic_csv_elite_columns_and_cadence_are_arabic(ns):
    obj = bilingual(ns)
    labels = arabic_labels(ns)
    obj._generate_csv_catalog("Arabic", "ar", arabic_elite_portfolio(ns), translations=labels)
    _header, rows = csv_rows(obj)
    row = {r[labels["sum_id"]]: r for r in rows}["N01-U01"]
    for key, field in (("elite_verdict", "verdict_reason"), ("elite_decision", "decision"), ("elite_decision_owner", "decision_owner"),
                       ("elite_kpi", "kpi"), ("elite_value_driver", "value_driver"), ("elite_build_path", "build_path"),
                       ("elite_red_team_note", "red_team")):
        assert row[labels[key]].startswith(f"نص عربي {field}"), key
    assert row[labels["elite_cadence"]] == labels["value_cadence_weekly"] != "Weekly"
    assert row[labels["elite_evidence_columns"]] == "main.s.sales.units_sold, main.s.sales.sale_date"


def test_english_csv_elite_columns_keep_the_english_assessment(ns):
    obj = make_inspire(ns)
    obj._normalize_usecase = lambda usecase, name: usecase
    uc = make_uc("N01-U01", elite_status="ELITE", elite_assessment=elite_assessment(), _elite_decision_translated="ignored")
    obj._generate_csv_catalog("English", "en", {"Sales": [uc]})
    _header, rows = csv_rows(obj)
    assert rows[0]["Decision"] == "Reorder stock for each store every Monday" and rows[0]["Decision Cadence"] == "Weekly"


def test_arabic_csv_and_excel_rows_name_a_reason_left_in_english(ns):
    import openpyxl
    labels = arabic_labels(ns)
    portfolio = arabic_portfolio()
    uc = portfolio["المبيعات"][0]
    uc["_translation_status"], uc["_untranslated_fields"] = "partial", ["Priority Reasons", "Elite Decision"]
    expected = f"{labels['untranslated_notice']}: {labels['priority_reasons']}, {labels['elite_decision']}"
    obj = bilingual(ns)
    obj._generate_csv_catalog("Arabic", "ar", portfolio, translations=labels)
    _header, rows = csv_rows(obj)
    assert {r[labels["sum_id"]]: r for r in rows}["N01-U01"][labels["untranslated_notice"]] == expected
    obj = bilingual(ns)
    obj._generate_use_case_excel("Arabic", "ar", portfolio, translations=labels)
    sheet = openpyxl.load_workbook(io.BytesIO(written(obj, ".xlsx")[1]))[labels["doc_use_cases"]]
    header = [c.value for c in sheet[1]]
    assert dict(zip(header, [c.value for c in sheet[2]]))[labels["untranslated_notice"]] == expected


def test_the_arabic_json_carries_the_translated_elite_assessment(ns):
    ts = ns["TranslationService"]
    obj = catalog_obj(ns, generate_choices=[])

    def pack(*a, **k):
        result = list(arabic_pack(ns))
        result[3] = arabic_elite_portfolio(ns)
        return tuple(result)
    run_documents(ns, obj, pack)
    uc = json.loads(written(obj, ".json")[1])["domains"][0]["use_cases"][0]
    for field in ELITE_PROSE:
        assert uc["elite_assessment"][field] == f"نص عربي {field}", field
        assert ts.elite_translation_key(field) not in uc
    assert uc["elite_assessment"]["cadence"] == "weekly"


def test_the_english_json_keeps_the_english_assessment_and_no_translation_keys(ns):
    obj = catalog_obj(ns)
    final = english_portfolio()
    final[0]["elite_assessment"] = elite_assessment()
    obj._save_usecases_catalog_json(final, {}, summary_dict={"Executive": "Exec"})
    english = json.loads(obj.w_client.workspace.files["/Workspace/out/docs/Acme-dbx_inspire.json"])
    uc = english["domains"][0]["use_cases"][0]
    assert uc["elite_assessment"]["decision"] == "Reorder stock for each store every Monday"
    assert not [key for key in uc if key.startswith("_elite_")]


def test_docs_only_mode_names_the_english_file_to_use_instead(ns):
    obj = catalog_obj(ns)
    obj._language_packs = {"Arabic": ("ar", arabic_labels(ns), arabic_portfolio(), {"Executive": "<p>ملخص</p>"}, "أكمي")}
    obj._save_usecases_catalog_json(english_portfolio(), {}, summary_dict={"Executive": "Exec"})
    files = dict(obj.w_client.workspace.files)
    fresh = make_inspire(ns)
    fresh.w_client.workspace.files.update(files)
    with pytest.raises(ValueError) as error:
        fresh._load_usecases_catalog_json("/Workspace/out/docs/Acme-dbx_inspire_ar.json")
    assert "set the JSON file path to /Workspace/out/docs/Acme-dbx_inspire.json" in str(error.value)
    fresh.w_client.workspace.files["/Workspace/out/docs/renamed.json"] = files["/Workspace/out/docs/Acme-dbx_inspire_ar.json"]
    with pytest.raises(ValueError, match="the file name without a language code"):
        fresh._load_usecases_catalog_json("/Workspace/out/docs/renamed.json")


NON_STANDARD_CADENCE = "Per shift"
ARABIC_TEXT = "نص عربي مترجم"


def cadence_use_case(cadence, no="N01-U01"):
    assessment = elite_assessment()
    assessment["cadence"] = cadence
    return make_uc(no, elite_status="ELITE", elite_score=8.8, elite_assessment=assessment, **ENGLISH_REASONS)


class SkipCacheAgent(FakeAgent):
    def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema=None, skip_cache=False, **kw):
        self.calls.append({"skip_cache": skip_cache, "json_payload": prompt_vars["json_payload"]})
        return self.respond(json.loads(prompt_vars["json_payload"]))


def test_a_non_standard_cadence_is_sent_and_translated(ns):
    ts = ns["TranslationService"]
    svc = ts(FakeAgent(french_responder(translate=lambda value: ARABIC_TEXT)), CapturingLogger())
    original = cadence_use_case(NON_STANDARD_CADENCE)
    out = svc.translate_use_case_list([original], "Arabic", enable_parallelization=False)[0]
    payload = json.loads(svc.ai_agent.calls[0]["json_payload"])[0]
    assert payload["Elite Decision Cadence"] == NON_STANDARD_CADENCE
    assert out[ts.elite_translation_key("cadence")] == ARABIC_TEXT
    assert out["_translation_status"] == "translated" and out["_untranslated_fields"] == []
    assert out["elite_assessment"]["cadence"] == NON_STANDARD_CADENCE


def test_a_translated_non_standard_cadence_reaches_the_arabic_csv_and_json(ns):
    ts = ns["TranslationService"]
    labels = arabic_labels(ns)

    def portfolio():
        result = arabic_elite_portfolio(ns)
        uc = result["المبيعات"][0]
        uc["elite_assessment"]["cadence"] = NON_STANDARD_CADENCE
        uc[ts.elite_translation_key("cadence")] = "كل وردية"
        return result
    obj = bilingual(ns)
    obj._generate_csv_catalog("Arabic", "ar", portfolio(), translations=labels)
    _header, rows = csv_rows(obj)
    assert {r[labels["sum_id"]]: r for r in rows}["N01-U01"][labels["elite_cadence"]] == "كل وردية"
    obj = catalog_obj(ns, generate_choices=[])

    def pack(*a, **k):
        result = list(arabic_pack(ns))
        result[3] = portfolio()
        return tuple(result)
    run_documents(ns, obj, pack)
    uc = json.loads(written(obj, ".json")[1])["domains"][0]["use_cases"][0]
    assert uc["elite_assessment"]["cadence"] == "كل وردية"
    assert ts.elite_translation_key("cadence") not in uc


@pytest.mark.parametrize("language,translate", [("French", lambda value: f"FR {value}"), ("Arabic", lambda value: ARABIC_TEXT)])
def test_a_non_standard_cadence_the_model_leaves_in_english_is_retried_flagged_and_counted(ns, language, translate):
    ts = ns["TranslationService"]
    svc = ts(SkipCacheAgent(french_responder(left_in_english={"Elite Decision Cadence"}, translate=translate)), CapturingLogger())
    out = svc.translate_use_case_list([cadence_use_case(NON_STANDARD_CADENCE)], language, enable_parallelization=False)[0]
    assert [call["skip_cache"] for call in svc.ai_agent.calls] == [False] + [True] * ts._PARTIAL_RETRY_ROUNDS
    assert all(json.loads(call["json_payload"])[0]["Elite Decision Cadence"] == NON_STANDARD_CADENCE for call in svc.ai_agent.calls)
    assert out["_translation_status"] == "partial" and out["_untranslated_fields"] == ["Elite Decision Cadence"]
    gaps = ns["DatabricksInspire"]._translation_gap_summary({"Domain": [out]})
    assert gaps["use_cases"] == 1 and gaps["fields"] == {"Elite Decision Cadence": 1}
    assert svc.logger.matching(f"[TRANSLATION GAP] {language}", level="WARNING")


def test_a_cadence_left_in_english_is_named_on_the_arabic_export_row_and_not_in_documents(ns):
    import openpyxl
    labels = arabic_labels(ns)
    portfolio = arabic_portfolio()
    uc = portfolio["المبيعات"][0]
    uc["elite_assessment"] = dict(elite_assessment(), cadence=NON_STANDARD_CADENCE)
    uc["_translation_status"], uc["_untranslated_fields"] = "partial", ["Elite Decision Cadence"]
    expected = f"{labels['untranslated_notice']}: {labels['elite_cadence']}"
    obj = bilingual(ns)
    obj._generate_csv_catalog("Arabic", "ar", portfolio, translations=labels)
    _header, rows = csv_rows(obj)
    row = {r[labels["sum_id"]]: r for r in rows}["N01-U01"]
    assert row[labels["untranslated_notice"]] == expected and row[labels["elite_cadence"]] == NON_STANDARD_CADENCE
    obj = bilingual(ns)
    obj._generate_use_case_excel("Arabic", "ar", portfolio, translations=labels)
    sheet = openpyxl.load_workbook(io.BytesIO(written(obj, ".xlsx")[1]))[labels["doc_use_cases"]]
    header = [c.value for c in sheet[1]]
    assert dict(zip(header, [c.value for c in sheet[2]]))[labels["untranslated_notice"]] == expected
    assert make_inspire(ns)._untranslated_notice(uc, labels, "Arabic") == ""


@pytest.mark.parametrize("cadence", ["weekly", "Bi-weekly", "Real time", "ANNUALLY", " monthly ", "event-driven"])
def test_a_standard_cadence_is_never_sent_and_keeps_its_label(ns, cadence):
    ts = ns["TranslationService"]
    svc = ts(FakeAgent(french_responder()), CapturingLogger())
    out = svc.translate_use_case_list([cadence_use_case(cadence)], "French", enable_parallelization=False)[0]
    assert "Elite Decision Cadence" not in json.loads(svc.ai_agent.calls[0]["json_payload"])[0]
    assert ts.elite_translation_key("cadence") not in out
    assert out["_translation_status"] == "translated" and out["_untranslated_fields"] == []
    labels = arabic_labels(ns)
    obj = make_inspire(ns)
    key = obj._DOC_CADENCE_KEYS[cadence.strip().casefold()]
    assert obj._doc_cadence_label(cadence, labels, "Arabic") == labels[key] != cadence.strip()
    assert obj._doc_cadence_label(cadence, {}, "English") == ts.ENGLISH_TRANSLATIONS[key]


SHORT_COLUMNS = ("Business Domain", "Subdomain", "type", "Beneficiary", "Sponsor", "Business Priority Alignment",
                 "Strategic Goals Alignment", "Technique Label", "KPI Names", "Elite Decision Owner", "Elite KPI",
                 "Elite Decision Cadence")


def short_field_use_case(column, value):
    extra = {"elite_status": "ELITE", "elite_score": 8.8, "elite_assessment": elite_assessment()}
    if column == "Technique Label":
        extra["Analytics Technique"] = value
    elif column == "KPI Names":
        extra["KPIs"] = [{"name": value}]
    elif column.startswith("Elite "):
        field = {"Elite Decision Owner": "decision_owner", "Elite KPI": "kpi", "Elite Decision Cadence": "cadence"}[column]
        extra["elite_assessment"] = dict(elite_assessment(), **{field: value})
    else:
        extra[column] = value
    return make_uc("N01-U01", **extra)


def test_every_short_field_uses_the_short_text_check_and_prose_fields_do_not(ns):
    ts = ns["TranslationService"]
    assert ts._SHORT_TEXT_TRANSLATION_COLUMNS == frozenset(SHORT_COLUMNS)
    for prose in ("Name", "Statement", "Solution", "Business Value", "Headline", "Proposed Key Results", "Elite Decision"):
        assert prose not in ts._SHORT_TEXT_TRANSLATION_COLUMNS, prose


@pytest.mark.parametrize("source,value,language,flagged", [
    ("Store Manager", "Store Manager", "Arabic", True),
    ("Manager", "Manager", "Arabic", True),
    ("Store Manager", "مدير المتجر", "Arabic", False),
    ("CFO", "CFO", "Arabic", False),
    ("CFO", "CFO", "French", False),
    ("CFO, Finance team", "المدير المالي CFO، Finance team", "Arabic", True),
    ("CFO, Finance team", "CFO، فريق المالية", "Arabic", False),
    ("CFO, Finance team", "CFO, Finance team", "French", True),
    ("Store Manager", "Store Manager", "French", True),
    ("Store Manager", "store manager", "French", True),
    ("Manager", "Manager", "French", False),
    ("ML Engineer", "ML Engineer", "French", False),
    ("Marketing", "Marketing", "German", False),
    ("SKUs, P&L, KPI, COO, 24/7", "SKUs, P&L, KPI, COO, 24/7", "French", False),
    ("SKUs, P&L, KPI, COO, 24/7", "SKUs, P&L, KPI, COO, 24/7", "Arabic", False),
    ("Use `units_sold`", "استخدم `units_sold`", "Arabic", False),
    ("Store Manager", "Responsable de magasin", "French", False),
    ("Store Manager", "", "French", True),
])
def test_the_short_text_rule(ns, source, value, language, flagged):
    assert ns["TranslationService"]._looks_untranslated(source, value, language, short_text=True) is flagged


def test_long_prose_keeps_the_prose_rule_so_a_product_name_in_arabic_is_not_flagged(ns):
    ts = ns["TranslationService"]
    assert ts._looks_untranslated("Forecast demand with Databricks", "توقع الطلب الأسبوعي على المنتجات باستخدام Databricks", "Arabic") is False
    assert ts._looks_untranslated("Store Manager", "Store Manager", "French") is False


@pytest.mark.parametrize("column", [c for c in SHORT_COLUMNS if c != "Elite Decision Cadence"])
@pytest.mark.parametrize("language,value,translate", [("Arabic", "Manager", lambda value: ARABIC_TEXT),
                                                      ("French", "Store Manager", lambda value: f"FR {value}")])
def test_a_short_field_left_in_english_is_retried_flagged_and_counted(ns, column, language, value, translate):
    ts = ns["TranslationService"]
    svc = ts(SkipCacheAgent(french_responder(left_in_english={column}, translate=translate)), CapturingLogger())
    out = svc.translate_use_case_list([short_field_use_case(column, value)], language, enable_parallelization=False)[0]
    assert out["_untranslated_fields"] == [column] and out["_translation_status"] == "partial"
    assert [call["skip_cache"] for call in svc.ai_agent.calls] == [False] + [True] * ts._PARTIAL_RETRY_ROUNDS
    gaps = ns["DatabricksInspire"]._translation_gap_summary({"Domain": [out]})
    assert gaps["use_cases"] == 1 and gaps["fields"] == {column: 1}
    assert svc.logger.matching(f"[TRANSLATION GAP] {language}", level="WARNING")


@pytest.mark.parametrize("language,translate", [("Arabic", lambda value: ARABIC_TEXT), ("French", lambda value: f"FR {value}")])
def test_cfo_returned_as_is_is_not_flagged_or_retried(ns, language, translate):
    ts = ns["TranslationService"]
    svc = ts(SkipCacheAgent(french_responder(left_in_english={"Sponsor"}, translate=translate)), CapturingLogger())
    out = svc.translate_use_case_list([make_uc("N01-U01", Sponsor="CFO")], language, enable_parallelization=False)[0]
    assert out["Sponsor"] == "CFO"
    assert out["_translation_status"] == "translated" and out["_untranslated_fields"] == []
    assert [call["skip_cache"] for call in svc.ai_agent.calls] == [False]


def test_cfo_finance_team_returned_with_latin_finance_team_is_flagged_and_named_on_the_arabic_row(ns):
    ts = ns["TranslationService"]
    mixed = "المدير المالي CFO، Finance team"
    respond = french_responder(translate=lambda value: mixed if value == "CFO, Finance team" else ARABIC_TEXT)
    svc = ts(SkipCacheAgent(respond), CapturingLogger())
    out = svc.translate_use_case_list([make_uc("N01-U01", Sponsor="CFO, Finance team")], "Arabic", enable_parallelization=False)[0]
    assert out["Sponsor"] == mixed and out["_untranslated_fields"] == ["Sponsor"]
    assert len(svc.ai_agent.calls) == 1 + ts._PARTIAL_RETRY_ROUNDS
    labels = arabic_labels(ns)
    portfolio = arabic_portfolio()
    uc = portfolio["المبيعات"][0]
    uc["_translation_status"], uc["_untranslated_fields"] = "partial", ["Sponsor"]
    obj = bilingual(ns)
    obj._generate_csv_catalog("Arabic", "ar", portfolio, translations=labels)
    _header, rows = csv_rows(obj)
    notice = {r[labels["sum_id"]]: r for r in rows}["N01-U01"][labels["untranslated_notice"]]
    assert notice == f"{labels['untranslated_notice']}: {labels['sponsor']}"


def test_a_retry_that_translates_the_short_field_clears_the_flag(ns):
    ts = ns["TranslationService"]
    first = french_responder(left_in_english={"Beneficiary"}, translate=lambda value: ARABIC_TEXT)
    later = french_responder(translate=lambda value: ARABIC_TEXT)

    class RetryAgent(FakeAgent):
        def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema=None, skip_cache=False, **kw):
            self.calls.append({"skip_cache": skip_cache})
            return (first if len(self.calls) == 1 else later)(json.loads(prompt_vars["json_payload"]))

    svc = ts(RetryAgent(None), CapturingLogger())
    out = svc.translate_use_case_list([make_uc("N01-U01", Beneficiary="Store Manager")], "Arabic", enable_parallelization=False)[0]
    assert [call["skip_cache"] for call in svc.ai_agent.calls] == [False, True]
    assert out["Beneficiary"] == ARABIC_TEXT and out["_untranslated_fields"] == []


@pytest.mark.parametrize("source,value,flagged", [
    ("XGBoost", "XGBoost", False),
    ("Prophet", "Prophet", False),
    ("LightGBM", "LightGBM", False),
    ("PyTorch", "PyTorch", False),
    ("ARIMA", "ARIMA", False),
    ("Delta", "Delta", False),
    ("Genie", "Genie", False),
    ("Unity Catalog", "Unity Catalog", False),
    ("Holt-Winters", "Holt-Winters", False),
    ("k-means", "k-means", False),
    ("Prophet forecasting", "التنبؤ باستخدام Prophet", False),
    ("XGBoost model", "نموذج XGBoost", False),
    ("XGBoost model", "XGBoost model", True),
    ("Prophet forecast", "Prophet forecast", True),
    ("Store Manager", "Store Manager", True),
    ("Unity", "Unity", True),
    ("Random Forest", "Random Forest", True),
])
def test_product_and_technique_names_may_stay_in_latin_letters_but_a_plain_word_next_to_them_is_flagged(ns, source, value, flagged):
    assert ns["TranslationService"]._looks_untranslated(source, value, "Arabic", short_text=True) is flagged


def test_names_come_from_the_technique_catalog_and_the_product_list(ns):
    ts = ns["TranslationService"]
    for _key, _label, _aliases, methods in ns["DatabricksInspire"]._TECHNIQUE_FAMILIES:
        for method in methods:
            if " " not in method:
                assert ts._english_words(method) == [], method
    for product in ns["INSPIRE_PRODUCT_NAMES"]:
        assert ts._english_words(product) == [], product
    assert ts._english_words("isolation forest") == ["isolation", "forest"]


@pytest.mark.parametrize("column,key", [("Technique Label", "Analytics Technique Label"), ("Beneficiary", "Beneficiary")])
@pytest.mark.parametrize("left,flagged", [("XGBoost uplift", True), ("XGBoost", False), ("Prophet", False), ("LightGBM", False),
                                          ("XGBoost model", True), ("Store Manager", True)])
def test_an_arabic_short_field_left_in_latin_letters_is_flagged_only_for_plain_words(ns, column, key, left, flagged):
    ts = ns["TranslationService"]
    respond = french_responder(translate=lambda value: left if value == left else ARABIC_TEXT)
    svc = ts(SkipCacheAgent(respond), CapturingLogger())
    out = svc.translate_use_case_list([short_field_use_case(column, left)], "Arabic", enable_parallelization=False)[0]
    assert json.loads(svc.ai_agent.calls[0]["json_payload"])[0][column] == left
    assert out[key] == left
    assert out["_untranslated_fields"] == ([column] if flagged else [])
    assert len(svc.ai_agent.calls) == (1 + ts._PARTIAL_RETRY_ROUNDS if flagged else 1)


def widget_language_choices():
    import ast
    import pathlib
    import re as _re
    notebook = json.loads((pathlib.Path(__file__).resolve().parents[2] / "agent" / "dbx_inspire_ai_agent.ipynb").read_text())
    source = "".join(notebook["cells"][1]["source"])
    return ast.literal_eval(_re.search(r"lang_choices = (\[[^\]]*\])", source).group(1))


def written_in_latin_letters(text):
    import unicodedata
    letters = [c for c in text if c.isalpha()]
    return bool(letters) and all("LATIN" in unicodedata.name(c, "") for c in letters)


def test_one_non_latin_list_holds_every_non_latin_language_the_widget_offers(ns):
    ts = ns["TranslationService"]
    choices = widget_language_choices()
    assert len(choices) == 23 and "English" in choices
    non_latin = {lang for lang in choices if lang != "English"
                 and not written_in_latin_letters(ts.TRANSLATION_FALLBACKS[lang]["sponsor"] + ts.TRANSLATION_FALLBACKS[lang]["doc_use_cases"])}
    assert ns["INSPIRE_NON_LATIN_LANGUAGES"] == non_latin
    assert len(non_latin) == 8


def test_the_translator_and_the_document_writers_read_the_same_non_latin_list(ns, monkeypatch):
    ts = ns["TranslationService"]
    obj = make_inspire(ns)
    assert not hasattr(ts, "_NON_LATIN_LANGUAGES") and not hasattr(ns["DatabricksInspire"], "_DOC_NON_LATIN_LANGUAGES")
    for language in ns["INSPIRE_NON_LATIN_LANGUAGES"]:
        assert "display" not in obj._doc_font_keys(language, ())
        assert ts._looks_untranslated("Manager", "Manager", language, short_text=True) is True
    assert "display" in obj._doc_font_keys("French", ())
    assert ts._looks_untranslated("Manager", "Manager", "French", short_text=True) is False
    monkeypatch.setitem(ns, "INSPIRE_NON_LATIN_LANGUAGES", frozenset({"French"}))
    assert "display" not in obj._doc_font_keys("French", ())
    assert ts._looks_untranslated("Manager", "Manager", "French", short_text=True) is True
    assert "display" in obj._doc_font_keys("Arabic", ())
