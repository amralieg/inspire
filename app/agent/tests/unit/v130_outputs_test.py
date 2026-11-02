"""v1.3.0 outputs: the strategy path, KPIs with measured baselines, expected key results, measures of success,
financial and non-financial benefits and shared data foundations reach Excel, CSV, PDF, PPTX, Markdown, Genie
notebooks and the step payload; customer terminology renames what people read and never what machines parse;
the data-access statement follows the discovery type (and keeps the old wording for catalogs written before
v1.3.0); Inspire-written KPI names and proposed key results are translated, the customer's own wording is not;
catalogs written before v1.3.0 render exactly as before."""
import base64
import datetime
import decimal
import io
import json
import os
import re
import sys
import types

import pytest

from v120_artifacts_support import CapturingLogger, make_inspire, make_uc

NEW_LABELS = ("strategy_path", "kpis", "expected_key_results", "measures_of_success", "financial_benefits",
              "non_financial_benefits", "foundations", "doc_foundations_title", "doc_foundations_lead",
              "doc_foundation_tables", "doc_foundation_unlocks", "doc_data_access_standard", "doc_data_access_deep",
              "doc_method_1_deep", "doc_guide_lead_deep", "value_not_aligned", "kpi_baseline", "kpi_baseline_newest",
              "kpi_baseline_undated")

TREE = {
    "levels": ["Strategic Pillar", "Business Objective"],
    "strategy": [
        {"name": "Customer", "children": [
            {"name": "Grow repeat purchases",
             "kpis": [{"name": "Repeat purchase rate", "unit": "%", "direction": "increase"}],
             "key_results": [{"statement": "Raise repeat purchase rate from 18% to 24%", "kpi": "Repeat purchase rate"}]}]},
        {"name": "Operations", "children": ["Cut stockouts"]},
    ],
    "labels": {"kpi": "Measures", "sponsor": "Executive Owner"},
}


@pytest.fixture
def docs(agent_ns, monkeypatch):
    cls = agent_ns["DatabricksInspire"]
    monkeypatch.setattr(agent_ns["workspace"], "ImportFormat", types.SimpleNamespace(AUTO="AUTO"), raising=False)
    monkeypatch.setattr(cls, "_DOC_FONT_FILES", {}, raising=False)
    return agent_ns


@pytest.fixture
def captured_html(monkeypatch):
    captured = []

    class HTML:
        def __init__(self, string=None, **kwargs):
            captured.append(string)

        def write_pdf(self, path, font_config=None):
            with open(path, "wb") as handle:
                handle.write(b"%PDF-1.4 fake")
    monkeypatch.setitem(sys.modules, "weasyprint", types.SimpleNamespace(HTML=HTML))
    return captured


def labels(ns, language="English"):
    ts = ns["TranslationService"]
    t = dict(ts.ENGLISH_TRANSLATIONS)
    if language != "English":
        t.update(ts.TRANSLATION_FALLBACKS[language])
    return t


def customer_tree(ns):
    return ns["parse_strategic_context"](json.loads(json.dumps(TREE)))


def kpi(name, kpi_id=None, baseline=None, query=None, direction="increase", unit="%"):
    return {"name": name, "kpi_id": kpi_id, "direction": direction, "unit": unit, "metric_view": None, "measure": None,
            "aggregation": "AVG", "table": "main.s.sales", "column": "units_sold", "filter_column": None,
            "filter_value": None, "time_column": "sale_date", "window_days": 90, "computable": bool(query),
            "query": query, "baseline": baseline}


def value_uc(no="N01-U01", domain="Sales", aligned=("S1.1",), **extra):
    fields = {
        "Strategy Alignment": [{"id": sid, "path": {"S1.1": "Customer > Grow repeat purchases",
                                                     "S2.1": "Operations > Cut stockouts"}[sid],
                                "evidence": "`units_sold` per customer"} for sid in aligned],
        "Strategy Path": "; ".join({"S1.1": "Customer > Grow repeat purchases",
                                    "S2.1": "Operations > Cut stockouts"}[sid] for sid in aligned),
        "Strategic Goals Alignment": ", ".join({"S1.1": "Customer > Grow repeat purchases",
                                                "S2.1": "Operations > Cut stockouts"}[sid] for sid in aligned),
        "KPIs": [kpi("Repeat purchase rate", kpi_id="K1",
                     baseline={"value": 23.4, "window_days": 90, "measured_on": "2026-10-21"},
                     query="SELECT AVG(`units_sold`) AS v FROM `main`.`s`.`sales`"),
                 kpi("Basket size", baseline=None, direction="increase", unit="")],
        "Expected Key Results": [{"id": "KR1", "statement": "Raise repeat purchase rate from 18% to 24%", "kpi_id": "K1",
                                  "source": "strategy"},
                                 {"id": None, "statement": "Lift basket size on repeat visits", "kpi_id": None,
                                  "source": "proposed"}],
        "Measures of Success": ["Planners use the weekly list"],
        "Financial Benefits": ["Margin from repeat orders driven by `units_sold`"],
        "Non-Financial Benefits": ["Fewer manual reorders"],
        "Foundations": ["F1"],
        "use_case_key": f"{no} title|main.s.sales",
    }
    fields.update(extra)
    return make_uc(no, domain, **fields)


def foundations():
    return [{"id": "F1", "rank": 1, "name": "customers + sales", "tables": ["main.s.customers", "main.s.sales"],
             "joins": [{"left": "main.s.sales.customer_id", "right": "main.s.customers.customer_id", "source": "foreign key"}],
             "use_cases": ["N01-U01", "N01-U02"], "use_case_count": 2, "summed_inspire_score": 15.3}]


def v130_obj(ns, tree=True, **attrs):
    obj = make_inspire(ns, **attrs)
    obj.strategy_tree = customer_tree(ns) if tree else None
    obj.data_foundations = foundations()
    obj.delivery_order = ["N01-U01", "N01-U02"]
    obj.discovery_type = "Deep"
    obj.deep_evidence = types.SimpleNamespace(summary=lambda: {"tables_read_count": 7})
    return obj


def v130_portfolio():
    return {"Sales": [value_uc("N01-U01", **{"Inspire Score": 9.0}),
                      value_uc("N01-U02", aligned=("S2.1",), **{"Inspire Score": 6.3})]}


def test_new_labels_exist_in_all_23_languages_with_placeholders_and_no_em_dash(agent_ns):
    ts = agent_ns["TranslationService"]
    dictionaries = {"English": ts.ENGLISH_TRANSLATIONS, **ts.TRANSLATION_FALLBACKS}
    assert len(dictionaries) == 23
    for key in NEW_LABELS:
        english = set(re.findall(r"\{(\w+)\}", ts.ENGLISH_TRANSLATIONS[key]))
        for language, table in dictionaries.items():
            value = table.get(key)
            assert isinstance(value, str) and value.strip(), (language, key)
            assert set(re.findall(r"\{(\w+)\}", value)) == english, (language, key, value)
            assert "\u2014" not in value and "\u2013" not in value, (language, key)


STALE_ZERO = {"value": 0.0, "window_days": 7, "measured_on": "2026-10-29"}
STALE_NOTE = "0 (Weekly trips served, last 7 days, measured 2026-10-29)"
KEPT_NOTE = "0 (Weekly fare revenue, last 7 days, measured 2026-10-29)"


def stale_kpis():
    return [kpi("Weekly trips served", baseline=dict(STALE_ZERO), unit=""),
            kpi("Weekly fare revenue", baseline=dict(STALE_ZERO, window_anchor="newest data"), unit="USD"),
            kpi("Zones served", baseline={"value": 120.0, "window_days": 7, "measured_on": "2026-10-29"}, unit=""),
            kpi("Open tickets", baseline={"value": 0, "window_days": None, "measured_on": "2026-10-29"}, unit="")]


def test_a_kpi_baseline_of_0_counted_back_from_today_before_the_window_was_anchored_is_never_shown(agent_ns):
    shown = agent_ns["kpi_baseline_shown"]
    assert shown(dict(STALE_ZERO)) is None and shown(dict(STALE_ZERO, value="0")) is None
    for kept in (dict(STALE_ZERO, window_anchor="newest data"), {"value": 120.0, "window_days": 7, "measured_on": "d"},
                 {"value": 0, "window_days": None, "measured_on": "d"}, {"value": None, "window_days": 7, "measured_on": "d"}):
        assert shown(kept) == kept
    for empty in (None, {}, [], "x", 0):
        assert shown(empty) is None
    obj = make_inspire(agent_ns)
    trips, fares, zones, tickets = stale_kpis()
    assert obj._kpi_text(trips, None, {}, "English") == "Weekly trips served (\u2191)"
    assert obj._kpi_text(fares, None, {}, "English") == \
        "Weekly fare revenue (\u2191 USD): baseline 0, last 7 days to the newest data, measured 2026-10-29"
    assert obj._kpi_text(zones, None, {}, "English") == "Zones served (\u2191): baseline 120, last 7 days, measured 2026-10-29"
    assert obj._kpi_text(tickets, None, {}, "English") == "Open tickets (\u2191): baseline 0, all data, measured 2026-10-29"


def test_the_stale_0_baked_into_key_results_and_benefits_reads_as_measured_by_the_kpi_query_and_nothing_else_changes(agent_ns):
    obj = make_inspire(agent_ns)
    pending = agent_ns["DatabricksInspire"]._BASELINE_PENDING
    uc = value_uc(**{
        "KPIs": stale_kpis(),
        "Expected Key Results": [{"id": None, "statement": f"Raise weekly trips served from {STALE_NOTE} to [TARGET]", "source": "proposed"},
                                 {"id": None, "statement": f"Raise weekly fare revenue from {KEPT_NOTE} to [TARGET]", "source": "proposed"}],
        "Measures of Success": [f"Trips up from {STALE_NOTE}, twice: {STALE_NOTE}"],
        "Financial Benefits": [f"Fares grow from {KEPT_NOTE}"],
        "Non-Financial Benefits": [f"Riders wait less than at {STALE_NOTE}"],
        "Foundations": [f"F1 {STALE_NOTE}"]})
    items = lambda source, kind: obj._use_case_items(uc, source, kind, {}, "English")[0]
    assert items("Expected Key Results", "key_results") == [f"Raise weekly trips served from {pending} to [TARGET]",
                                                            f"Raise weekly fare revenue from {KEPT_NOTE} to [TARGET]"]
    assert items("Measures of Success", "lines") == [f"Trips up from {pending}, twice: {pending}"]
    assert items("Financial Benefits", "lines") == [f"Fares grow from {KEPT_NOTE}"]
    assert items("Non-Financial Benefits", "lines") == [f"Riders wait less than at {pending}"]
    assert items("Foundations", "list") == [f"F1 {STALE_NOTE}"], "only the fields Inspire fills with a baseline are cleared"
    source = obj._genie_kpi_source(uc)
    assert STALE_NOTE not in source and f"Raise weekly trips served from {pending} to [TARGET]" in source
    assert "  - Weekly trips served (\u2191)\n" in source and KEPT_NOTE in source


def test_kpi_text_shows_direction_unit_and_the_measured_baseline(agent_ns):
    obj = make_inspire(agent_ns)
    dated = kpi("Repeat purchase rate", baseline={"value": 23.4, "window_days": 90, "measured_on": "2026-10-21"})
    assert obj._kpi_text(dated, None, {}, "English") == \
        "Repeat purchase rate (\u2191 %): baseline 23.40, last 90 days, measured 2026-10-21"
    undated = kpi("Orders", unit="", baseline={"value": 12000, "window_days": None, "measured_on": "2026-10-21"})
    assert obj._kpi_text(undated, None, {}, "English") == "Orders (\u2191): baseline 12,000, all data, measured 2026-10-21"
    assert obj._kpi_text(kpi("Orders", direction="", unit=""), None, {}, "English") == "Orders"
    nan = kpi("Orders", unit="", baseline={"value": float("nan"), "window_days": 30, "measured_on": "2026-10-21"})
    assert obj._kpi_text(nan, None, {}, "English") == "Orders (\u2191)", "a non-finite baseline is never printed"
    french = obj._kpi_text(dated, "Taux de réachat", labels(agent_ns, "French"), "French")
    assert french.startswith("Taux de réachat (\u2191 %): ") and "90" in french and "2026-10-21" in french
    assert "last" not in french


def test_every_kpi_baseline_states_its_window_in_every_language(agent_ns):
    obj = make_inspire(agent_ns)
    measured = {"value": 1500, "window_days": 30, "measured_on": "2026-10-29"}
    newest = kpi("Fare revenue", unit="USD", baseline=dict(measured, window_anchor="newest data"))
    today = kpi("Fare revenue", unit="USD", baseline=dict(measured))
    undated = kpi("Fare revenue", unit="USD", baseline=dict(measured, window_days=None))
    assert obj._kpi_text(newest, None, {}, "English") == \
        "Fare revenue (\u2191 USD): baseline 1,500, last 30 days to the newest data, measured 2026-10-29"
    assert obj._kpi_text(today, None, {}, "English") == "Fare revenue (\u2191 USD): baseline 1,500, last 30 days, measured 2026-10-29", \
        "a window counted back from today, measured before windows ended at the newest data, keeps its own words"
    assert obj._kpi_text(undated, None, {}, "English") == "Fare revenue (\u2191 USD): baseline 1,500, all data, measured 2026-10-29"
    assert obj._kpi_baseline_note(newest, newest["baseline"]) == \
        "1,500 (Fare revenue, last 30 days to the newest data, measured 2026-10-29)"
    assert obj._kpi_baseline_note(today, today["baseline"]) == "1,500 (Fare revenue, last 30 days, measured 2026-10-29)"
    assert obj._kpi_baseline_note(undated, undated["baseline"]) == "1,500 (Fare revenue, all data, measured 2026-10-29)"
    english = agent_ns["TranslationService"].ENGLISH_TRANSLATIONS
    for language in agent_ns["TranslationService"].TRANSLATION_FALLBACKS:
        t = labels(agent_ns, language)
        texts = [obj._kpi_text(spec, "X", t, language) for spec in (newest, today, undated)]
        assert len(set(texts)) == 3, (language, texts)
        assert "30" in texts[0] and "30" in texts[1] and "30" not in texts[2], (language, texts)
        assert all("2026-10-29" in text and "1,500" in text for text in texts), (language, texts)
        assert t["kpi_baseline_newest"] != english["kpi_baseline_newest"], language
        assert t["kpi_baseline_undated"] != english["kpi_baseline_undated"], language


def test_derived_translation_columns_carry_only_inspire_written_items(agent_ns):
    cls = agent_ns["TranslationService"]
    sources = cls._derived_sources(value_uc())
    assert sources["KPI Names"] == "Basket size", "the customer's KPI keeps its own wording"
    assert sources["Proposed Key Results"] == "Lift basket size on repeat visits"
    legacy = cls._derived_sources(make_uc("N01-U09"))
    assert legacy["KPI Names"] == "" and legacy["Proposed Key Results"] == ""
    assert ("KPI Names", "_kpi_names_translated") in cls._DERIVED_TRANSLATION_FIELDS
    assert ("Proposed Key Results", "_key_results_translated") in cls._DERIVED_TRANSLATION_FIELDS


def test_translated_items_are_used_only_when_the_count_matches(agent_ns):
    obj = make_inspire(agent_ns)
    t = labels(agent_ns, "French")
    uc = value_uc(_kpi_names_translated="Taille du panier", _key_results_translated="Augmenter le panier")
    items, gap = obj._use_case_items(uc, "KPIs", "kpis", t, "French")
    assert items[0].startswith("Repeat purchase rate"), "the customer KPI is verbatim"
    assert items[1].startswith("Taille du panier") and gap is False
    results, gap = obj._use_case_items(uc, "Expected Key Results", "key_results", t, "French")
    assert results == ["Raise repeat purchase rate from 18% to 24%", "Augmenter le panier"] and gap is False
    wrong = value_uc(_kpi_names_translated="Taille | Panier | Extra")
    items, gap = obj._use_case_items(wrong, "KPIs", "kpis", t, "French")
    assert items[1].startswith("Basket size") and gap is True, "a count mismatch shows English and is flagged"
    missing = value_uc()
    assert obj._use_case_items(missing, "KPIs", "kpis", t, "French")[1] is True
    known = value_uc(_translation_status="untranslated")
    assert obj._use_case_items(known, "KPIs", "kpis", t, "French")[1] is False, "an untranslated copy is flagged once"
    assert obj._use_case_items(missing, "KPIs", "kpis", {}, "English")[1] is False


def test_merge_translation_writes_the_derived_columns_into_a_per_language_copy(agent_ns):
    cls = agent_ns["TranslationService"]
    obj = cls.__new__(cls)
    obj.logger = CapturingLogger()
    original = value_uc()
    row = {"No": "N01-U01", "Name": "Prévoir la demande", "KPI Names": "Taille du panier",
           "Proposed Key Results": "Augmenter le panier lors des visites répétées",
           "Measures of Success": "Les planificateurs utilisent la liste hebdomadaire"}
    merged = obj._merge_translation(original, row, "French")
    assert merged["_kpi_names_translated"] == "Taille du panier"
    assert merged["_key_results_translated"] == "Augmenter le panier lors des visites répétées"
    assert "_kpi_names_translated" not in original, "the English use case is never modified"
    assert merged["KPIs"] is not original["KPIs"]


def test_translate_prompt_header_and_counts_match_the_payload(agent_ns):
    prompt = agent_ns["PROMPT_TEMPLATES"]["USE_CASE_TRANSLATE_PROMPT"]
    header = re.search(r'\*\*CSV HEADER \(MUST BE EXACTLY THIS\)\*\*:\n(.+)\n', prompt).group(1)
    columns = re.findall(r'"([^"]+)"', header)
    assert len(columns) == 22 and columns[-2:] == ["KPI Names", "Proposed Key Results"]
    cls = agent_ns["TranslationService"]
    for field in cls._TRANSLATION_FIELDS + cls._TRANSLATION_COPY_FIELDS:
        assert field in columns, field
    for column, _key in cls._DERIVED_TRANSLATION_FIELDS:
        assert column in columns, column
    assert "the 22 column names below" in prompt and "24 fields" in prompt
    assert "translate these 18 fields" in prompt and "ALL 18 designated fields" in prompt
    assert "ALL 13" not in prompt and "16 translatable" not in prompt
    assert '"Below Bar Reason"' in prompt, "both optional reason columns are described"


def test_the_widest_translation_header_survives_preamble_stripping(agent_ns):
    prompt = agent_ns["PROMPT_TEMPLATES"]["USE_CASE_TRANSLATE_PROMPT"]
    columns = re.findall(r'"([^"]+)"', re.search(r'\*\*CSV HEADER \(MUST BE EXACTLY THIS\)\*\*:\n(.+)\n', prompt).group(1))
    columns += ["Coverage Pick Reason", "Below Bar Reason", "honesty_score", "honesty_justification"]
    header = ",".join(f'"{c}"' for c in columns)
    row = ",".join(f'"v{i}"' for i in range(len(columns)))
    assert len(header) > 400
    clean = agent_ns["clean_csv_response"]
    assert clean(header + "\n" + row).split("\n")[0] == header
    prose = ("This catalog translation keeps every identifier exactly as written, and the column order is unchanged from "
             "the input you gave me, so you can parse it directly without any further cleanup or post-processing steps at "
             "all, which should make the downstream merge simple and reliable for every language that you asked for in "
             "this batch of use cases today and tomorrow too, and it also explains why some values were left exactly as "
             "they were in the source rows.")
    assert len(prose) > 400 and not agent_ns["CSVParser"].header_like(prose)
    assert clean(prose + "\n" + header + "\n" + row).split("\n")[0] == header, "long prose before the CSV is still stripped"


def test_export_adds_level_and_value_columns_with_customer_terms(agent_ns):
    obj = v130_obj(agent_ns)
    headers, rows, _numeric = obj._catalog_export_table(v130_portfolio())
    at = headers.index("Strategic Goals Alignment")
    assert headers[at + 1:at + 3] == ["Strategic Pillar", "Business Objective"]
    first = dict(zip(headers, rows[0]))
    assert first["Strategic Pillar"] == "Customer" and first["Business Objective"] == "Grow repeat purchases"
    second = dict(zip(headers, rows[1]))
    assert second["Strategic Pillar"] == "Operations" and second["Business Objective"] == "Cut stockouts"
    assert "Measures" in headers and "KPIs" not in headers, "the customer's KPI label renames the column"
    assert "Executive Owner" in headers and "Sponsor" not in headers
    assert first["Measures"].startswith("Repeat purchase rate (\u2191 %): baseline 23.40") and "; Basket size" in first["Measures"]
    assert first["Expected Key Results"] == "Raise repeat purchase rate from 18% to 24%; Lift basket size on repeat visits"
    assert first["Financial Benefits"] == "Margin from repeat orders driven by `units_sold`"
    assert first["Data Foundations"] == "F1"
    assert len(headers) == len(set(h.casefold() for h in headers))


def test_export_without_v130_fields_or_customer_tree_is_unchanged(agent_ns):
    obj = make_inspire(agent_ns)
    legacy = {"Sales": [make_uc("N01-U01"), make_uc("N01-U02")]}
    headers, _rows, _numeric = obj._catalog_export_table(legacy)
    assert headers == [h for h, _get, _numeric in obj._export_columns(False)]
    for header in ("KPIs", "Expected Key Results", "Measures of Success", "Data Foundations", "Strategic Pillar"):
        assert header not in headers, header
    builtin = v130_obj(agent_ns, tree=False)
    builtin.strategy_tree = agent_ns["build_builtin_strategy"]("Reduce Cost, Increase Revenue")
    headers, _rows, _numeric = builtin._catalog_export_table(v130_portfolio())
    assert "KPIs" in headers and "Strategic Goal" not in headers, "a built-in tree adds no level columns"


def test_unique_headers_suffix_a_customer_level_that_repeats_a_built_in_header(agent_ns):
    cls = agent_ns["DatabricksInspire"]
    getter = lambda uc, rank: ""
    columns = cls._unique_headers([("Sponsor", getter, False), ("Beneficiary", getter, False), ("sponsor", getter, False)])
    assert [h for h, _g, _n in columns] == ["Sponsor", "Beneficiary", "sponsor (2)"]


def test_use_case_view_shows_the_path_value_facts_and_foundations(agent_ns):
    obj = v130_obj(agent_ns)
    t = labels(agent_ns)
    model = obj._document_model("English", t, {}, v130_portfolio(), "Acme")
    view = obj._use_case_view(model["ranked"][0], model, t)
    facts = {key: (label, value) for key, label, value in view["facts"]}
    assert facts["strategic_goals_alignment"] == ("Strategy Path", "Customer > Grow repeat purchases")
    assert facts["foundations"] == ("Data Foundations", "F1")
    assert facts["sponsor"][0] == "Executive Owner"
    value = {key: (label, items) for key, label, items in view["value_facts"]}
    assert value["kpis"][0] == "Measures" and value["kpis"][1][0].startswith("Repeat purchase rate (\u2191 %)")
    assert value["non_financial_benefits"] == ("Non-Financial Benefits", ["Fewer manual reorders"])
    assert view["untranslated"] == []


def test_legacy_use_case_view_has_no_new_facts(agent_ns):
    obj = make_inspire(agent_ns)
    t = labels(agent_ns)
    model = obj._document_model("English", t, {}, {"Sales": [make_uc("N01-U01")]}, "Acme")
    view = obj._use_case_view(model["ranked"][0], model, t)
    assert [key for key, _l, _v in view["facts"]] == ["sponsor", "beneficiary", "business_priority_alignment",
                                                      "strategic_goals_alignment", "analytics_technique", "type",
                                                      "aspect_tables"]
    assert view["value_facts"] == [] and model["foundations"] == []
    assert dict((k, l) for k, l, _v in view["facts"])["strategic_goals_alignment"] == "Strategic Goals Alignment"


def test_data_access_statement_follows_the_discovery_type(agent_ns):
    t = labels(agent_ns)
    deep = v130_obj(agent_ns)
    model = deep._document_model("English", t, {}, v130_portfolio(), "Acme")
    _title, items = deep._doc_disclaimer(model, t)
    assert "aggregates from the tables in scope, 7 in total" in items[0] and "No data rows were sent to the AI" in items[0]
    assert model["method_steps"][0] == t["doc_method_1_deep"] and model["guide_lead_key"] == "doc_guide_lead_deep"
    standard = make_inspire(agent_ns, discovery_type="Standard", deep_evidence=None)
    model = standard._document_model("English", t, {}, {"Sales": [make_uc("N01-U01")]}, "Acme")
    _title, items = standard._doc_disclaimer(model, t)
    assert items[0] == t["doc_data_access_standard"] and "aggregates" not in " ".join(items)
    assert model["method_steps"][0] == t["doc_method_1"] and model["guide_lead_key"] == "doc_guide_lead"
    nothing_read = make_inspire(agent_ns, discovery_type="Deep",
                                deep_evidence=types.SimpleNamespace(summary=lambda: {"tables_read_count": 0}))
    model = nothing_read._document_model("English", t, {}, {"Sales": [make_uc("N01-U01")]}, "Acme")
    assert model["method_steps"][0] == t["doc_method_1"], "Deep wording only when a table was actually read"
    legacy = make_inspire(agent_ns, discovery_type="Deep", deep_evidence=None)
    legacy._loaded_catalog_meta = {key: None for key in legacy._V130_CATALOG_KEYS}
    model = legacy._document_model("English", t, {}, {"Sales": [make_uc("N01-U01")]}, "Acme")
    _title, items = legacy._doc_disclaimer(model, t)
    assert items[0] == t["doc_method_1"], "a catalog written before v1.3.0 keeps the original statement"


def test_results_keys_of_a_loaded_catalog_never_take_the_widget_discovery_type(agent_ns):
    obj = make_inspire(agent_ns, discovery_type="Deep", deep_evidence=None)
    obj._loaded_catalog_meta = {key: None for key in obj._V130_CATALOG_KEYS}
    keys = obj._v130_results_keys()
    assert keys["discovery_type"] == "Standard" and keys["data_access"]["tables_read_count"] == 0
    obj._loaded_catalog_meta = {"discovery_type": "Deep", "data_access": {"tables_read_count": 5}}
    keys = obj._v130_results_keys()
    assert keys["discovery_type"] == "Deep" and keys["data_access"] == {"tables_read_count": 5}
    live = v130_obj(agent_ns)
    assert live._v130_results_keys()["foundations"] == foundations()


def test_docs_only_load_restores_the_run_level_metadata(fresh_ns):
    catalog = {"business_name": "Acme", "executive_summary": "", "column_registry": {}, "table_registry": {},
               "domains": [{"domain_name": "Sales", "summary": "", "use_cases": [value_uc()]}],
               "discovery_type": "Deep", "data_access": {"tables_read_count": 3}, "strategic_context": TREE,
               "strategy_coverage": {"entries": []}, "foundations": foundations(), "delivery_order": ["N01-U01"]}
    fresh_ns["read_user_text_file"] = lambda path, w_client=None: json.dumps(catalog)
    obj = make_inspire(fresh_ns, discovery_type="Standard")
    obj._load_usecases_catalog_json("/Workspace/out/catalog.json")
    assert obj._doc_data_access() == ("Deep", 3)
    assert obj.data_foundations == foundations() and obj.delivery_order == ["N01-U01"]
    assert obj.strategy_tree == TREE and obj.strategy_coverage == {"entries": []}


def test_pdf_has_the_value_block_and_a_linked_foundations_section(docs, captured_html):
    obj = v130_obj(docs)
    obj.generate_catalog_pdf("English", "en", labels(docs), {"Executive": "<p>Exec</p>"}, v130_portfolio(), "Acme")
    html = captured_html[-1]
    assert '<div class="val">' in html and "Repeat purchase rate (\u2191 %): baseline 23.40" in html
    assert 'id="sec-foundations"' in html and '<a href="#uc-N01-U02">N01-U02</a>' in html
    assert "sales.customer_id = customers.customer_id" in html
    assert html.index('id="sec-foundations"') < html.index('id="sec-roadmap"')
    assert 'href="#sec-foundations"' in html, "the contents page lists the section"


def test_legacy_pdf_has_no_value_block_or_foundations_section(docs, captured_html):
    obj = make_inspire(docs)
    obj.generate_catalog_pdf("English", "en", labels(docs), {"Executive": "<p>Exec</p>"}, {"Sales": [make_uc("N01-U01")]}, "Acme")
    html = captured_html[-1]
    assert '<div class="val">' not in html and "sec-foundations" not in html


def test_deck_adds_a_value_slide_per_card_and_a_foundations_slide(docs):
    from v120_docs_geometry_support import pptx_geometry_violations
    obj = v130_obj(docs)
    t = labels(docs)
    model = obj._document_model("English", t, {"Executive": "<p>Exec</p>"}, v130_portfolio(), "Acme")
    prs, archetypes = obj._build_presentation_deck(model, t)
    cards = [i for i, kind in enumerate(archetypes) if kind == "uc_card"]
    assert cards and all(archetypes[i + 1] == "uc_value" for i in cards)
    assert archetypes.index("foundations") == archetypes.index("roadmap") - 1
    assert all(archetypes[i] != archetypes[i - 1] or archetypes[i] in obj._DOC_PPTX_SERIES for i in range(1, len(archetypes)))
    assert pptx_geometry_violations(prs) == []
    texts = [" ".join(s.text_frame.text for s in slide.shapes if s.has_text_frame) for slide in prs.slides]
    value_slide = texts[cards[0] + 1]
    assert "Lift basket size on repeat visits" in value_slide and "Fewer manual reorders" in value_slide
    legacy = make_inspire(docs)
    model = legacy._document_model("English", t, {}, {"Sales": [make_uc("N01-U01")]}, "Acme")
    _prs, archetypes = legacy._build_presentation_deck(model, t)
    assert "uc_value" not in archetypes and "foundations" not in archetypes


@pytest.mark.parametrize("language", ["Arabic", "Japanese", "Hindi", "Tamil", "French"])
def test_value_and_foundation_slides_hold_their_geometry_in_long_and_rtl_scripts(docs, language):
    from v120_docs_geometry_support import pptx_geometry_violations
    obj = v130_obj(docs)
    t = labels(docs, language)
    written = value_uc("N01-U01", **{"Inspire Score": 9.0})
    translated = dict(written, _translation_status="partial", _untranslated_fields=[],
                      _key_results_translated="Lift basket size on repeat visits " * 3)
    grouped = {"Sales": [translated, value_uc("N01-U02", aligned=("S2.1",), **{"Inspire Score": 6.3})]}
    model = obj._document_model(language, t, {"Executive": "<p>Exec</p>"}, grouped, "Acme")
    prs, archetypes = obj._build_presentation_deck(model, t)
    assert pptx_geometry_violations(prs) == []
    assert "uc_value" in archetypes and "foundations" in archetypes
    texts = [shape.text_frame.text for slide in prs.slides for shape in slide.shapes if shape.has_text_frame]
    assert not [text for text in texts if re.search(r"\{(value|days|date|tables)\}", text)]
    view = obj._use_case_view(model["ranked"][0], model, t)
    assert "kpis" in view["untranslated"], "the Inspire-written KPI name without a translation is flagged"
    assert "expected_key_results" not in view["untranslated"]
    assert t["kpis"] in view["notice"]


def test_markdown_lists_value_facts_and_the_foundations_table(docs):
    obj = v130_obj(docs)
    obj._generate_markdown_catalog("English", "en", v130_portfolio(), {"Executive": "Exec"}, "Acme")
    files = obj.w_client.workspace.files
    text = next(iter(files.values()))
    text = text.decode("utf-8") if isinstance(text, bytes) else str(text)
    assert "**Measures:**\n- Repeat purchase rate" in text
    assert "## Shared data foundations" in text and "| F1 | customers, sales" in text
    assert "2: N01-U01, N01-U02 |" in text


def test_foundations_sheet_rows(agent_ns):
    obj = v130_obj(agent_ns)
    headers, rows = obj._foundations_export_table()
    assert headers == ["ID", "Tables", "Joins", "Use cases unlocked", "Use Case IDs", "Summed Inspire Score"]
    assert rows == [["F1", "main.s.customers, main.s.sales",
                     "main.s.sales.customer_id = main.s.customers.customer_id (foreign key)", 2, "N01-U01, N01-U02", 15.3]]
    obj.data_foundations = []
    assert obj._foundations_export_table() == ([], [])


def test_excel_workbook_gets_a_foundations_sheet(agent_ns, monkeypatch):
    openpyxl = pytest.importorskip("openpyxl")
    obj = v130_obj(agent_ns)
    saved = {}

    def save(self, local_path, workspace_path, logger, language):
        with open(local_path, "rb") as handle:
            saved["data"] = handle.read()
    monkeypatch.setattr(agent_ns["DatabricksInspire"], "_save_excel", save, raising=False)
    obj._generate_use_case_excel("English", "en", v130_portfolio())
    book = openpyxl.load_workbook(io.BytesIO(saved["data"]))
    assert book.sheetnames == ["Use Cases", "Foundations"]
    assert [c.value for c in next(book["Foundations"].iter_rows(max_row=1))][:2] == ["ID", "Tables"]


def test_genie_objective_lists_kpis_key_results_and_the_kpi_queries(agent_ns):
    obj = make_inspire(agent_ns)
    source = obj._genie_kpi_source(value_uc())
    assert "- **KPIs:**\n  - Repeat purchase rate (\u2191 %): baseline 23.40, last 90 days, measured 2026-10-21\n" in source
    assert "- **Expected key results:**\n  - Raise repeat purchase rate from 18% to 24%\n" in source
    assert ("```sql\nSELECT CAST(AVG(`units_sold`) AS DOUBLE) AS v FROM `main`.`s`.`sales` "
            "WHERE `sale_date` >= LEAST(current_date(), (SELECT CAST(MAX(`sale_date`) AS DATE) FROM `main`.`s`.`sales`)) - INTERVAL 90 DAYS\n```") in source
    assert source.count("```sql") == 1, "a KPI without a computable query gets no query block"
    assert obj._genie_kpi_source(make_uc("N01-U01")) == ""


def test_the_genie_instruction_cell_carries_the_kpis_key_results_and_queries(agent_ns):
    import ast
    obj = make_inspire(agent_ns)
    instruction = "## 1. Goal\nRaise repeat purchases. " + "x " * 60
    cell = obj._genie_instruction_cell_source(value_uc(genie_instruction=instruction, genie_instruction_status="success"), instruction)
    text = ast.literal_eval(ast.parse(cell).body[0].value)
    assert text.index("## 1. Goal") < text.index("## KPIs and Key Results") < text.index("### KPI queries")
    assert "  - Repeat purchase rate (\u2191 %): baseline 23.40, last 90 days, measured 2026-10-21\n" in text
    assert "  - Raise repeat purchase rate from 18% to 24%\n" in text
    assert ("```sql\nSELECT CAST(AVG(`units_sold`) AS DOUBLE) AS v FROM `main`.`s`.`sales` "
            "WHERE `sale_date` >= LEAST(current_date(), (SELECT CAST(MAX(`sale_date`) AS DATE) FROM `main`.`s`.`sales`)) - INTERVAL 90 DAYS\n```") in text
    plain = obj._genie_instruction_cell_source(make_uc("N01-U02"), instruction)
    assert "## KPIs and Key Results" not in plain and ast.literal_eval(ast.parse(plain).body[0].value).strip() == instruction.strip()


def test_step_payload_carries_the_v130_fields_as_json_values(agent_ns):
    obj = make_inspire(agent_ns)
    payload = obj._build_use_case_step_payload(value_uc())
    assert payload["kpis"][0]["baseline"]["value"] == 23.4
    assert payload["measures_of_success"] == ["Planners use the weekly list"]
    assert payload["foundation_ids"] == ["F1"] and payload["strategy_path"] == "Customer > Grow repeat purchases"
    assert payload["strategy_alignment"][0]["id"] == "S1.1"
    json.dumps(payload)
    legacy = obj._build_use_case_step_payload(make_uc("N01-U01"))
    assert all(legacy[column] is None for column, _key, _kind in obj._V130_TRACKING_FIELDS)


def test_a_non_json_value_no_longer_erases_the_whole_payload(agent_ns):
    writer = types.SimpleNamespace(logger=CapturingLogger())
    text = agent_ns["AtomicWriter"]._safe_json_str(writer, {"keep": 1, "when": datetime.date(2026, 10, 21)})
    assert json.loads(text) == {"keep": 1, "when": "2026-10-21"}

    class Loop(dict):
        pass
    looped = Loop()
    looped["self"] = looped
    assert agent_ns["AtomicWriter"]._safe_json_str(writer, looped) == "{}"
    assert writer.logger.matching("[STEP-PAYLOAD]")


def test_measured_kpi_baselines_reject_non_finite_values(agent_ns):
    cls = agent_ns["DeepEvidence"]
    spec = kpi("Orders", query="SELECT 1 AS v")
    for answer, expected in ((float("nan"), None), (float("inf"), None), (decimal.Decimal("12.5"), 12.5), (None, None), (7, 7.0)):
        deep = cls.__new__(cls)
        deep._read = lambda kind, table, sql, args=None, answer=answer: [{"v": answer}]
        assert deep.measure_kpi(spec) == expected, answer


def test_legacy_quote_cleaner_also_cleans_list_fields(agent_ns):
    obj = make_inspire(agent_ns)
    catalog = {"domains": [{"use_cases": [{"Financial Benefits": ["Store''s margin", 3], "Strategy Path": "Ops''s goal"}]}]}
    obj._clean_legacy_catalog_text(catalog)
    uc = catalog["domains"][0]["use_cases"][0]
    assert uc["Financial Benefits"] == ["Store's margin", 3] and uc["Strategy Path"] == "Ops's goal"


ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_v130_rules_name_code_that_exists():
    import csv
    from _agentload import agent_source
    source = agent_source()

    def names_code(place):
        name = re.escape(place.split(".")[-1])
        return bool(re.search(rf"\b(def|class) {name}\b", source) or re.search(rf"^(    )?{name} = ", source, re.MULTILINE))

    with open(os.path.join(ROOT, "rules", "inspire-ai-rules.csv"), encoding="utf-8", newline="") as handle:
        rules = [row for row in csv.DictReader(handle) if row["source_version"] == "v1.3.0"]
    ids = [r["rule_id"] for r in rules]
    assert ids == [f"R{n}" for n in range(61, 61 + len(ids))], "v1.3.0 rule ids run from R61 without a gap or a repeat"
    assert len(ids) >= 90, ids[-3:]
    assert names_code("GENIE_PER_UNIT_SAMPLE_RULE") and names_code("_genie_platform_rules")
    assert names_code("_GENIE_OUTPUT_COLUMN_MEANINGS") and not names_code("technique_guidance"), \
        "a class attribute is code a rule can name, a method's local variable is not"
    assert not names_code("GENIE_NO_SUCH_RULE") and not names_code("_no_such_helper") and not names_code("GENIE_PER_UNIT")
    for rule in rules:
        for place in (p.strip() for p in rule["where_enforced"].split(";")):
            if place.startswith("tests/"):
                assert os.path.exists(os.path.join(ROOT, place)), (rule["rule_id"], place)
            else:
                assert names_code(place), (rule["rule_id"], place)


def test_the_readme_strategic_context_example_parses(agent_ns):
    with open(os.path.join(ROOT, "readme.md"), encoding="utf-8") as handle:
        text = handle.read()
    block = text.split("**11. Strategic Context**", 1)[1].split("```json", 1)[1].split("```", 1)[0]
    tree = agent_ns["parse_strategic_context"](block)
    assert tree["levels"] == ["Strategic Pillar", "Business Objective"]
    assert tree["labels"] == {"kpi": "Measure", "key_result": "Target"} and tree["priorities"] == ["Grow revenue", "Protect margin"]


def test_untranslated_notice_names_every_translated_field_by_its_label(agent_ns):
    obj = make_inspire(agent_ns)
    t = labels(agent_ns, "French")
    uc = value_uc(_translation_status="partial",
                  _untranslated_fields=["Measures of Success", "KPI Names", "Headline", "Technique Label"])
    notice = obj._untranslated_notice(uc, t, "French")
    for key in ("measures_of_success", "kpis", "usecase", "analytics_technique"):
        assert t[key] in notice, key
    for raw in ("Measures of Success", "KPI Names", "Headline", "Technique Label"):
        assert raw not in notice, raw


def test_round_48_every_kpi_query_returns_a_number_the_summary_step_can_format(agent_ns):
    build = agent_ns["DeepEvidence"].kpi_sql
    spec = {"aggregation": "SUM", "table": "samples.tpcds_sf1.catalog_sales", "column": "cs_net_paid"}
    live = ("on the warehouse SELECT SUM(`cs_net_paid`) returned DECIMAL(17,2) '3286395842.38', which Spark Connect "
            "hands to Python as Decimal, and CAST(... AS DOUBLE) returned DOUBLE 3.28639584238E9")
    for aggregate in ("SUM", "AVG", "MIN", "MAX"):
        assert build(dict(spec, aggregation=aggregate)) == \
            f"SELECT CAST({aggregate}(`cs_net_paid`) AS DOUBLE) AS v FROM `samples`.`tpcds_sf1`.`catalog_sales`", live
    assert build(dict(spec, aggregation="COUNT_DISTINCT", column="cs_bill_customer_sk")) == \
        "SELECT COUNT(DISTINCT `cs_bill_customer_sk`) AS v FROM `samples`.`tpcds_sf1`.`catalog_sales`", \
        "a count stays an integer"
    assert build({"metric_view": "main.s.mv_sales", "measure": "total_paid"}) == \
        "SELECT CAST(MEASURE(`total_paid`) AS DOUBLE) AS v FROM `main`.`s`.`mv_sales`", \
        "a measure can be DECIMAL too; CAST(MEASURE(...) AS DOUBLE) ran on a live metric view"
    ratio = build(dict(spec, denominator={"aggregation": "COUNT", "column": None, "filter_column": None, "filter_value": None}))
    assert ratio.startswith("SELECT CAST(SUM(`cs_net_paid`) AS DOUBLE) / NULLIF(CAST(COUNT(*) AS DOUBLE), 0) AS v") and \
        ratio.count("CAST(") == 2, "a ratio is cast once per side, never twice"

    def fmt_num(value):
        return f"{value / 1e9:.2f}B"

    with pytest.raises(TypeError, match="unsupported operand"):
        fmt_num(decimal.Decimal("3286395842.38"))
    assert fmt_num(float(decimal.Decimal("3286395842.38"))) == "3.29B"

    obj = make_inspire(agent_ns)
    stored = kpi("Catalog net paid", baseline={"value": 3286395842.38, "measured_on": "2026-10-24"},
                 query="SELECT SUM(`cs_net_paid`) AS v FROM `samples`.`tpcds_sf1`.`catalog_sales`")
    stored.update(aggregation="SUM", table="samples.tpcds_sf1.catalog_sales", column="cs_net_paid",
                  time_column=None, window_days=None)
    source = obj._genie_kpi_source(value_uc(KPIs=[stored, kpi("Unbuildable", query="SELECT 1", unit="")
                                                  | {"aggregation": "MEDIAN"}]))
    assert "```sql\nSELECT CAST(SUM(`cs_net_paid`) AS DOUBLE) AS v FROM `samples`.`tpcds_sf1`.`catalog_sales`\n```" in source, \
        "a session selected before this build gets the builder's query, not the stored text"
    assert "SELECT SUM(" not in source and "SELECT 1" not in source and source.count("```sql") == 1, \
        "a spec the builder refuses gets no query block"
