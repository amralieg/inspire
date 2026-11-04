"""v1.4.0 money value: a use case shows a money range only where Deep discovery measured a money baseline, with the
currency and the assumption next to it; otherwise it says value not measured yet and what to measure. User directives
name the currency, the value metric and the uplift range first. Proposed key results carry the measured target range."""
import json
import re
import types

import pytest

from v120_artifacts_support import make_inspire, make_uc


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
    assert estimate["text"].startswith("AED 2.4K\u20136K a year, if weekly sales value rises 2\u20135% (measured: 29,589 AED")
    assert "last 90 days" in estimate["text"] and "an assumption" in estimate["text"]
    assert "rises 2\u20135%" in estimate["assumption"] and estimate["uplift_source"] == "kind default"


def test_no_measured_baseline_says_not_measured_yet_and_never_shows_a_number(ns):
    for uc in (money_uc(ns, kpi(ns, value=None)), money_uc(ns), money_uc(ns, kpi(ns, name="Late orders", unit="orders"))):
        estimate = ns["inspire_value_estimate"](uc, "", "predict")
        assert estimate["status"] == "not measured yet" and "value_low" not in estimate and "value_high" not in estimate
        assert estimate["text"].startswith("Value not measured yet: measure ")
        assert not re.search(r"\d", estimate["text"]), estimate["text"]
    assert "Weekly sales value with its KPI query" in ns["inspire_value_estimate"](money_uc(ns, kpi(ns, value=None)))["text"]
    assert "sum of a revenue or cost column in c.s.orders" in ns["inspire_value_estimate"](money_uc(ns, kpi(ns, name="Late orders", unit="orders")))["text"]


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


def test_a_cost_kpi_falls_and_the_kind_family_sets_the_default_range(ns):
    spec = kpi(ns, name="Refund cost", direction="reduce")
    estimate = ns["inspire_value_estimate"](money_uc(ns, spec), "", "detect_protect")
    assert "refund cost falls 5\u201315%" in estimate["text"]
    assert ns["inspire_value_estimate"](money_uc(ns, spec), "", "")["uplift_low"] == ns["INSPIRE_VALUE_UPLIFT_DEFAULT"][0]


def test_proposed_key_results_get_the_measured_target_range_or_say_not_measured_yet(ns):
    measured = money_uc(ns, kpi(ns, value=1000.0), **{"Expected Key Results": [
        {"statement": "Raise weekly sales value from 1,000 to [TARGET] within [WINDOW]", "source": "proposed"},
        {"statement": "Keep [TARGET] as the sponsor wrote it", "source": "strategy"}]})
    estimate = ns["inspire_value_estimate"](measured, "", "predict")
    ns["inspire_fill_key_result_targets"](measured, estimate)
    shown = ns["inspire_placeholder_words"](measured["Expected Key Results"][0]["statement"])
    assert shown == "Raise weekly sales value from 1,000 to between 1,020 and 1,050 (assumed 2\u20135% higher) within 12 months, assumed"
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
    assert "Value estimate" in decoded[".csv"] and "AED 2.4K\u20136K a year" in decoded[".csv"]
    assert "AED 2.4K\u20136K a year" in decoded[".md"]
    catalog = json.loads(decoded[".json"])
    shown = [u for d in catalog["domains"] for u in d["use_cases"]][0]
    assert shown["Value Estimate"]["value_high"] == uc["Value Estimate"]["value_high"]
