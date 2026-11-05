"""v1.4.0 money value: a use case shows a money range only where Deep discovery measured a money baseline, with the
currency and the assumption next to it; otherwise it says value not measured yet and what to measure. User directives
name the currency, the value metric and the uplift range first. Proposed key results carry the measured target range."""
import csv
import io
import json
import re
import threading
import types

import pytest

from v120_artifacts_support import CapturingLogger, make_inspire, make_uc


@pytest.fixture
def ns(agent_ns, monkeypatch):
    monkeypatch.setattr(agent_ns["workspace"], "ImportFormat", types.SimpleNamespace(AUTO="AUTO"), raising=False)
    monkeypatch.setattr(agent_ns["workspace"], "ExportFormat", types.SimpleNamespace(AUTO="AUTO"), raising=False)
    monkeypatch.setattr(agent_ns["DatabricksInspire"], "_DOC_FONT_FILES", {}, raising=False)
    return agent_ns


def kpi(ns, name="Weekly sales value", unit="AED", aggregation="SUM", column="amount", value=29589.0, window=90, **extra):
    baseline = None if value is None else {"value": value, "window_days": window, "measured_on": "2026-11-01",
                                           "window_anchor": ns["KPI_WINDOW_ANCHOR"]}
    spec = {"name": name, "unit": unit, "direction": "increase", "aggregation": aggregation, "table": "c.s.orders",
            "column": column, "computable": True, "query": "SELECT 1", "window_days": window, "baseline": baseline}
    spec.update(extra)
    return spec


def money_uc(ns, *kpis, **extra):
    return make_uc("N01-U01", KPIs=list(kpis), **extra)


def test_a_measured_money_baseline_gives_a_range_with_its_assumption_and_source(ns):
    estimate = ns["inspire_value_estimate"](money_uc(ns, kpi(ns)), "", "predict")
    yearly = 29589.0 * 365 / 90
    assert estimate["status"] == "measured"
    assert estimate["value_low"] == round(yearly * 0.02, 2) and estimate["value_high"] == round(yearly * 0.05, 2)
    assert estimate["currency"] == "AED" and estimate["currency_source"] == "KPI unit" and estimate["period"] == "year"
    assert estimate["measured_from"] == {"table": "c.s.orders", "column": "amount", "window_days": 90,
                                         "measured_on": "2026-11-01", "baseline": 29589.0}
    assert estimate["text"].startswith("AED 2.4K-6K a year, if weekly sales value rises 2-5% (measured: 29,589 AED")
    assert "last 90 days" in estimate["text"] and "an assumption" in estimate["text"]
    assert "rises 2-5%" in estimate["assumption"] and estimate["uplift_source"] == "kind default"


def test_no_measured_baseline_says_not_measured_yet_and_never_shows_a_number(ns):
    for uc in (money_uc(ns, kpi(ns, value=None)), money_uc(ns), money_uc(ns, kpi(ns, name="Late orders", unit="orders"))):
        estimate = ns["inspire_value_estimate"](uc, "", "predict")
        assert estimate["status"] == "not measured yet" and "value_low" not in estimate and "value_high" not in estimate
        assert estimate["text"].startswith("Value not measured yet: measure ")
        assert not re.search(r"\d", estimate["text"]), estimate["text"]
    assert "Weekly sales value with its KPI query" in ns["inspire_value_estimate"](money_uc(ns, kpi(ns, value=None)))["text"]
    assert "sum of a revenue or cost column in c.s.orders" in ns["inspire_value_estimate"](money_uc(ns, kpi(ns, name="Late orders", unit="orders")))["text"]
    assert "money value per unit of order count" in ns["inspire_value_estimate"](money_uc(ns, kpi(ns, name="Order count", unit="orders", aggregation="COUNT")))["text"]


def test_a_money_kpi_that_is_not_a_total_is_not_turned_into_money(ns):
    for spec in (kpi(ns, name="Average order value", aggregation="AVG"),
                 kpi(ns, name="Revenue share", unit="AED", denominator={"aggregation": "SUM", "column": "amount"}),
                 kpi(ns, value=0.0), kpi(ns, value=-5.0)):
        estimate = ns["inspire_value_estimate"](money_uc(ns, spec), "", "predict")
        assert estimate["status"] == "not measured yet", spec
    assert "the total of amount over a time window" in ns["inspire_value_estimate"](money_uc(ns, kpi(ns, aggregation="AVG")))["text"]


def test_an_unknown_currency_is_said_and_never_assumed(ns):
    estimate = ns["inspire_value_estimate"](money_uc(ns, kpi(ns, name="Revenue", unit="")), "Cover ALL domains", "predict")
    assert estimate["status"] == "measured" and estimate["currency"] is None
    assert "(currency not known)" in estimate["text"] and "USD" not in estimate["text"] and "$" not in estimate["text"]
    assert ns["inspire_value_estimate"](money_uc(ns, kpi(ns, name="Revenue", unit="", column="amount_eur")))["currency"] == "EUR"


def test_the_instructions_name_the_currency_the_metric_and_the_uplift_range_first(ns):
    other = kpi(ns, name="Refund cost", unit="USD", value=1000.0)
    text = "Report value in SAR. Focus on weekly sales value; assume an uplift of 4-6% for every use case."
    estimate = ns["inspire_value_estimate"](money_uc(ns, other, kpi(ns, unit="USD")), text, "predict")
    assert estimate["kpi"] == "Weekly sales value" and estimate["currency"] == "SAR" and estimate["currency_source"] == "instructions"
    assert (estimate["uplift_low"], estimate["uplift_high"], estimate["uplift_source"]) == (0.04, 0.06, "instructions")
    assert "the range comes from the instructions" in estimate["assumption"]
    assert ns["inspire_text_currency"]("Cover ALL domains and TOP products") == ""
    assert ns["inspire_text_currency"]("budget is $40,000") == "USD"
    assert ns["inspire_text_currency"]("in AED or USD 100") == ""
    assert ns["inspire_text_currency"]("report value in AED") == "AED" and ns["inspire_text_currency"]("value 100EUR") == "EUR"
    for text in ("report value in aed", "report value in Aed", "report value in AEDX", "report value in XAED", "100 AEDs value"):
        assert ns["inspire_text_currency"](text) == "", text


def test_a_cost_kpi_falls_and_the_kind_family_sets_the_default_range(ns):
    spec = kpi(ns, name="Refund cost", direction="reduce")
    estimate = ns["inspire_value_estimate"](money_uc(ns, spec), "", "detect_protect")
    assert "refund cost falls 5-15%" in estimate["text"]
    assert ns["inspire_value_estimate"](money_uc(ns, spec), "", "")["uplift_low"] == ns["INSPIRE_VALUE_UPLIFT_DEFAULT"][0]


def test_proposed_key_results_get_the_measured_target_range_or_say_not_measured_yet(ns):
    measured = money_uc(ns, kpi(ns, value=1000.0), **{"Expected Key Results": [
        {"statement": "Raise weekly sales value from 1,000 to [TARGET] within [WINDOW]", "source": "proposed"},
        {"statement": "Keep [TARGET] as the sponsor wrote it", "source": "strategy"}]})
    estimate = ns["inspire_value_estimate"](measured, "", "predict")
    ns["inspire_fill_key_result_targets"](measured, estimate)
    shown = ns["inspire_placeholder_words"](measured["Expected Key Results"][0]["statement"])
    assert shown == "Raise weekly sales value from 1,000 to between 1,020 and 1,050 (assumed 2-5% higher) within 12 months, assumed"
    assert measured["Expected Key Results"][1]["statement"] == "Keep [TARGET] as the sponsor wrote it"
    unmeasured = money_uc(ns, kpi(ns, value=None), **{"Expected Key Results": [
        {"statement": "Raise weekly sales value from [BASELINE] to [TARGET] within [WINDOW]", "source": "proposed"}]})
    ns["inspire_fill_key_result_targets"](unmeasured, ns["inspire_value_estimate"](unmeasured))
    shown = ns["inspire_placeholder_words"](unmeasured["Expected Key Results"][0]["statement"])
    assert "sponsor sets" not in shown and "not measured yet" in shown and not re.search(r"\d", shown)


class NoSpark:
    def __getattr__(self, name):
        raise AssertionError(f"the value estimate read data through spark.{name}")


def test_the_pipeline_step_reads_no_data_and_feeds_the_kind_value_line(ns):
    obj = make_inspire(ns, spark=NoSpark(), user_generation_instructions="", user_business_priorities=["Increase Revenue"])
    ucs = [money_uc(ns, kpi(ns)), make_uc("N01-U02", KPIs=[kpi(ns, value=None)])]
    obj._apply_value_estimates(ucs)
    assert ucs[0]["Value Estimate"]["status"] == "measured" and ucs[0]["value_at_stake"].startswith("AED ")
    assert "value_at_stake" not in ucs[1] and ucs[1]["value_estimate_text"].startswith("Value not measured yet")
    assert any("[VALUE-ESTIMATE FIRED]" in line for _level, line in obj.logger.records)
    assert ns["inspire_apply_use_case_kind"](ucs[0]) and ucs[0]["value_source"].endswith(f"current estimate {ucs[0]['value_at_stake']}.")


def test_tracking_row_and_every_export_carry_the_value_fields(ns):
    obj = make_inspire(ns)
    fields = {column: (key, kind) for column, key, kind in obj._V130_TRACKING_FIELDS}
    assert fields["value_estimate"] == ("Value Estimate", "json") and fields["value_estimate_text"] == ("value_estimate_text", "text")
    assert ("value_estimate", "STRING") in obj._TRACKING_MIGRATION_COLUMNS
    uc = money_uc(ns, kpi(ns))
    obj._apply_value_estimates([uc])
    stored = json.loads(obj._v130_tracking_value(uc, "Value Estimate", "json"))
    assert stored["value_low"] == uc["Value Estimate"]["value_low"] and stored["currency"] == "AED"
    assert stored["measured_from"]["table"] == "c.s.orders"
    grouped = {"Sales": [uc]}
    obj._generate_csv_catalog("English", "en", grouped)
    obj._generate_markdown_catalog("English", "en", grouped, {"Executive": "<p>x</p>"}, "Acme")
    obj._generate_json_catalog("English", "en", grouped, {"Executive": "x"}, "Acme")
    files = obj.w_client.workspace.files
    text = {suffix: next(data for path, data in files.items() if path.endswith(suffix)) for suffix in (".csv", ".md", ".json")}
    decoded = {suffix: data.decode("utf-8-sig") if isinstance(data, bytes) else str(data) for suffix, data in text.items()}
    assert "Value estimate" in decoded[".csv"] and "AED 2.4K-6K a year" in decoded[".csv"]
    assert "AED 2.4K-6K a year" in decoded[".md"]
    catalog = json.loads(decoded[".json"])
    shown = [u for d in catalog["domains"] for u in d["use_cases"]][0]
    assert shown["Value Estimate"]["value_high"] == uc["Value Estimate"]["value_high"]


def count_kpi(ns, value=1200.0, aggregation="COUNT", table="c.s.orders", **extra):
    spec = kpi(ns, name="Order count", unit="orders", aggregation=aggregation, column="order_id", value=value, **extra)
    spec["table"] = table
    return spec


def per_unit_kpi(ns, value=85.5, table="c.s.orders", window=0, **extra):
    spec = kpi(ns, name="Average order value", unit="AED", aggregation="AVG", column="amount", value=value, window=window, **extra)
    spec["table"] = table
    return spec


def test_a_count_kpi_turns_into_money_only_through_a_measured_per_unit_money_kpi_on_the_same_table(ns):
    estimate = ns["inspire_value_estimate"](money_uc(ns, count_kpi(ns), per_unit_kpi(ns)), "", "run_processes")
    yearly = 1200.0 * 365 / 90 * 85.5
    assert estimate["status"] == "measured" and estimate["currency"] == "AED" and estimate["kpi"] == "Order count"
    assert estimate["value_low"] == round(yearly * 0.03, 2) and estimate["value_high"] == round(yearly * 0.08, 2)
    assert estimate["measured_from"]["per_unit"] == {"kpi": "Average order value", "table": "c.s.orders", "column": "amount",
                                                     "value": 85.5, "measured_on": "2026-11-01"}
    assert "order count rises 3-8%" in estimate["text"] and "each worth 85.50 AED Average order value across all data" in estimate["text"]
    assert "each order count is worth the measured average order value" in estimate["assumption"]
    for aggregation in ("COUNT_DISTINCT", "SUM"):
        other = ns["inspire_value_estimate"](money_uc(ns, count_kpi(ns, aggregation=aggregation), per_unit_kpi(ns)))
        assert other["status"] == "not measured yet" and not re.search(r"\d", other["text"]), aggregation


def test_a_count_kpi_without_a_measured_per_unit_money_column_gets_no_number(ns):
    for uc in (money_uc(ns, count_kpi(ns)),
               money_uc(ns, count_kpi(ns), per_unit_kpi(ns, value=None)),
               money_uc(ns, count_kpi(ns), per_unit_kpi(ns, table="c.s.returns")),
               money_uc(ns, count_kpi(ns), per_unit_kpi(ns, value=0.0)),
               money_uc(ns, count_kpi(ns), per_unit_kpi(ns, denominator={"aggregation": "COUNT", "column": "order_id"})),
               money_uc(ns, count_kpi(ns, denominator={"aggregation": "COUNT", "column": "order_id"}), per_unit_kpi(ns)),
               money_uc(ns, count_kpi(ns, value=None), per_unit_kpi(ns))):
        estimate = ns["inspire_value_estimate"](uc, "", "run_processes")
        assert estimate["status"] == "not measured yet" and "value_low" not in estimate, uc["KPIs"]
        assert not re.search(r"\d", estimate["text"]), estimate["text"]
    shown = ns["inspire_value_estimate"](money_uc(ns, count_kpi(ns)))["text"]
    assert shown == ("Value not measured yet: measure the money value per unit of order count, for example the average "
                     "of a price or amount column in c.s.orders over the same rows.")


ARABIC_VALUE = "\u0642\u064a\u0645\u0629 \u0645\u0642\u062f\u0631\u0629 AED 2.4K-6K \u0641\u064a \u0627\u0644\u0633\u0646\u0629"


class ArabicAgent:
    def __init__(self):
        self.calls = []
        self._lock = threading.Lock()

    def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema=None, skip_cache=False, **kw):
        with self._lock:
            self.calls.append(dict(prompt_vars))
        payload = json.loads(prompt_vars["json_payload"])
        header = list(payload[0])
        out = io.StringIO()
        writer = csv.writer(out, quoting=csv.QUOTE_ALL)
        writer.writerow(header + ["honesty_score", "honesty_justification"])
        copied = {"No", "Tables Involved", "Analytics Technique", "Quality"}
        for item in payload:
            writer.writerow([item.get(h, "") if h in copied else ARABIC_VALUE if h == "Value Estimate Text"
                             else ("\u0639\u0631\u0628\u064a " + str(item[h]) if item.get(h) else "") for h in header] + ["90", "faithful"])
        return out.getvalue()


def test_the_value_sentence_is_translated_and_an_arabic_export_has_no_english_value_sentence(ns):
    obj = make_inspire(ns, output_languages=["English", "Arabic"])
    obj._normalize_usecase = lambda usecase, name: usecase
    uc = money_uc(ns, kpi(ns))
    obj._apply_value_estimates([uc])
    english = uc["value_estimate_text"]
    svc = ns["TranslationService"](ArabicAgent(), CapturingLogger())
    out = svc.translate_use_case_list([uc], "Arabic", enable_parallelization=False)
    payload = json.loads(svc.ai_agent.calls[0]["json_payload"])[0]
    assert payload["Value Estimate Text"] == english
    assert out[0]["value_estimate_text"] == ARABIC_VALUE and "Value Estimate Text" not in out[0]["_untranslated_fields"]
    assert isinstance(out[0]["Value Estimate"], dict) and uc["value_estimate_text"] == english
    ts = ns["TranslationService"]
    labels = dict(ts.ENGLISH_TRANSLATIONS)
    labels.update(ts.TRANSLATION_FALLBACKS["Arabic"])
    grouped = {"\u0627\u0644\u0645\u0628\u064a\u0639\u0627\u062a": out}
    obj._generate_csv_catalog("Arabic", "ar", grouped, translations=labels)
    obj._generate_markdown_catalog("Arabic", "ar", grouped, {"Executive": "<p>x</p>"}, "Acme", translations=labels)
    files = obj.w_client.workspace.files
    for suffix in (".csv", ".md"):
        data = next(data for path, data in files.items() if path.endswith(suffix))
        text = (data.decode("utf-8-sig") if isinstance(data, bytes) else str(data)).replace("\u2066", "").replace("\u2069", "")
        assert english not in text and "if weekly sales value rises" not in text and "the percentages are an assumption" not in text, suffix
        assert ARABIC_VALUE in text, suffix
    assert labels["value_estimate"] in next(data for path, data in files.items() if path.endswith(".csv")).decode("utf-8-sig")
    obj._generate_json_catalog("Arabic", "ar", grouped, {"Executive": "x"}, "Acme")
    catalog = next(data for path, data in files.items() if path.endswith(".json"))
    catalog = json.loads(catalog.decode("utf-8") if isinstance(catalog, bytes) else catalog)
    shown = [u for d in catalog["domains"] for u in d["use_cases"]][0]
    assert english not in json.dumps(catalog, ensure_ascii=False) and shown["Value Estimate"]["text"] == ARABIC_VALUE
    assert shown["Value Estimate"]["value_low"] == uc["Value Estimate"]["value_low"] and uc["Value Estimate"]["text"] == english


def test_a_value_sentence_left_in_english_is_flagged_as_a_translation_gap(ns):
    uc = money_uc(ns, kpi(ns))
    make_inspire(ns)._apply_value_estimates([uc])
    agent = ArabicAgent()
    agent_value = ARABIC_VALUE
    globals()["ARABIC_VALUE"] = uc["value_estimate_text"]
    try:
        out = ns["TranslationService"](agent, CapturingLogger()).translate_use_case_list([uc], "Arabic", enable_parallelization=False)
    finally:
        globals()["ARABIC_VALUE"] = agent_value
    assert "Value Estimate Text" in out[0]["_untranslated_fields"]
    assert ns["TranslationService"].untranslated_copy(uc)["_untranslated_fields"].count("Value Estimate Text") == 1


def test_the_mvp_app_page_promise_carries_the_same_value_line(ns):
    uc = money_uc(ns, kpi(ns), **{"Business Value": "Fewer stockouts"})
    make_inspire(ns)._apply_value_estimates([uc])
    promised = ns["implement_promised"](uc)
    assert promised["estimate"] == uc["value_estimate_text"] and promised["value"] == "Fewer stockouts"
    bare = ns["implement_promised"]({"Business Value": "", "Financial Benefits": [], "value_estimate_text": "Value not measured yet: measure x."})
    assert bare == {"value": "", "benefits": [], "estimate": "Value not measured yet: measure x."}
    assert "estimate" not in ns["implement_promised"]({"Business Value": "Fewer stockouts"})
    assert ns["implement_promised"]({}) == {}


def filtered(column, op, value, kind="text"):
    return {"filter_column": column, "filter_op": op, "filter_value": value, "filter_type": kind}


def late_orders(ns, **extra):
    spec = count_kpi(ns, **{**filtered("status", "=", "late"), **extra})
    spec["name"] = "Late orders"
    return spec


def per_unit_estimate(ns, count, unit):
    return ns["inspire_value_estimate"](money_uc(ns, count, unit), "", "run_processes")


def test_late_orders_with_an_average_order_value_measured_only_on_premium_orders_gives_no_number(ns):
    estimate = per_unit_estimate(ns, late_orders(ns), per_unit_kpi(ns, **filtered("tier", "=", "premium")))
    assert estimate["status"] == "not measured yet" and "value_low" not in estimate and "measured_from" not in estimate
    assert not re.search(r"\d", estimate["text"]), estimate["text"]
    assert estimate["text"] == ("Value not measured yet: measure the money value per unit of late orders, for example the average "
                                "of a price or amount column in c.s.orders over the same rows.")


def test_the_average_converts_a_count_only_when_its_rows_cover_the_counted_rows(ns):
    covers = [
        (late_orders(ns), per_unit_kpi(ns)),
        (late_orders(ns), per_unit_kpi(ns, **filtered("status", "=", "late"))),
        (late_orders(ns), per_unit_kpi(ns, **filtered("status", "!=", "cancelled"))),
        (count_kpi(ns, **filtered("amount", ">", 100, "decimal")), per_unit_kpi(ns, **filtered("amount", ">=", 50, "decimal"))),
        (count_kpi(ns, **filtered("amount", ">=", 100, "decimal")), per_unit_kpi(ns, **filtered("amount", ">", 99, "decimal"))),
        (count_kpi(ns, **filtered("placed_on", "<", "2026-01-01", "date")), per_unit_kpi(ns, **filtered("placed_on", "<=", "2026-06-30", "date"))),
        (count_kpi(ns), per_unit_kpi(ns, window=180)),
    ]
    for count, unit in covers:
        assert per_unit_estimate(ns, count, unit)["status"] == "measured", (count.get("filter_column"), unit.get("filter_column"), unit["window_days"])
    rejects = [
        (count_kpi(ns), per_unit_kpi(ns, **filtered("status", "=", "late"))),
        (late_orders(ns), per_unit_kpi(ns, **filtered("status", "=", "open"))),
        (late_orders(ns), per_unit_kpi(ns, **filtered("status", "!=", "LATE"))),
        (late_orders(ns), per_unit_kpi(ns, **filtered("region", "!=", "north"))),
        (count_kpi(ns, **filtered("amount", ">", 100, "decimal")), per_unit_kpi(ns, **filtered("amount", ">", 200, "decimal"))),
        (count_kpi(ns, **filtered("amount", ">=", 100, "decimal")), per_unit_kpi(ns, **filtered("amount", ">", 100, "decimal"))),
        (count_kpi(ns, **filtered("amount", ">", 100, "decimal")), per_unit_kpi(ns, **filtered("amount", "<", 500, "decimal"))),
        (count_kpi(ns, **filtered("status", ">", "a")), per_unit_kpi(ns, **filtered("status", ">", "a"))),
        (count_kpi(ns, **filtered("amount", "=", 100, "decimal")), per_unit_kpi(ns, **filtered("amount", "=", 101, "integer"))),
        (late_orders(ns), per_unit_kpi(ns, **filtered("status", "~", "late"))),
        (count_kpi(ns), per_unit_kpi(ns, window=30)),
        (count_kpi(ns, window=0), per_unit_kpi(ns, window=90)),
        (count_kpi(ns), per_unit_kpi(ns, window=180, time_column="shipped_at")),
    ]
    for count, unit in rejects:
        estimate = per_unit_estimate(ns, count, unit)
        assert estimate["status"] == "not measured yet" and not re.search(r"\d", estimate["text"]), (
            count.get("filter_column"), count.get("filter_op"), unit.get("filter_column"), unit.get("filter_op"), unit["window_days"])
