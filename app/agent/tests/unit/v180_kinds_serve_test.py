"""v1.4.0 kinds, lane K5: every use case carries its kind, family and layout plus 3 plain lines (what we serve, how it
works, where the value comes from) built from the registry templates and the elite-assessment fields with no extra
LLM call. __inspire_usecases stores them (migration safe to run twice), older rows and catalogs derive them from the
technique when read, every catalog writer shows them, and translation goes through the existing optional columns."""
import json
import re
import threading
import types

import pytest

from v120_artifacts_support import CapturingLogger, FakeSpark, elite_assessment, make_inspire, make_uc
from v196_reason_columns_every_language_test import FakeAgent, arabic_labels, bilingual, csv_rows, french_responder, written

KIND_COLUMNS = ["use_case_kind", "kind_family", "app_layout", "serving_summary", "method_summary", "value_source", "selection_basis"]
LINE_FIELDS = ("serving_summary", "method_summary", "value_source")


@pytest.fixture
def ns(agent_ns, monkeypatch):
    monkeypatch.setattr(agent_ns["workspace"], "ImportFormat", types.SimpleNamespace(AUTO="AUTO"), raising=False)
    monkeypatch.setattr(agent_ns["workspace"], "ExportFormat", types.SimpleNamespace(AUTO="AUTO"), raising=False)
    monkeypatch.setattr(agent_ns["DatabricksInspire"], "_DOC_FONT_FILES", {}, raising=False)
    return agent_ns


def forecast_uc(no="N01-U01", **extra):
    return make_uc(no, elite_assessment=elite_assessment(entity_key_column="main.s.sales.store_id"), **extra)


def kinded(ns, uc):
    assert ns["inspire_apply_use_case_kind"](uc) is True
    return uc


def test_lines_fill_the_registry_templates_from_the_elite_assessment(ns):
    uc = kinded(ns, forecast_uc())
    assert (uc["use_case_kind"], uc["kind_family"], uc["app_layout"]) == ("forecast", "predict", "forecast_cockpit")
    assert (uc["kind_label"], uc["kind_family_label"]) == ("Forecast", "Predict")
    assert uc["serving_summary"] == ("A forecast cockpit for Regional supply planner that shows the expected Stock-out rate per store "
                                     "with its range, and flags the ones at risk: app, dashboard, Genie room, alert.")
    assert uc["method_summary"].startswith("Forecasting: past values of Stock-out rate in `units_sold`, `sale_date` project")
    assert uc["value_source"].startswith("Better orders or staffing") and "`units_sold`, `sale_date`" in uc["value_source"]
    assert "current estimate" not in uc["value_source"], "no value at stake yet, so the estimate clause is left out"


def test_every_kind_gives_3_complete_lines_with_no_field_at_all(ns):
    for kind in ns["_inspire_kinds"]()["kinds"]:
        uc = kinded(ns, {"Use Case Kind": kind["id"]})
        for field in LINE_FIELDS:
            assert uc[field] and "{" not in uc[field] and "  " not in uc[field], (kind["id"], field, uc[field])
            assert not re.search(r"\b(the the|each each)\b", uc[field], re.I), (kind["id"], uc[field])
            assert uc[field][0].isupper() and uc[field][-1] in ".!?", (kind["id"], uc[field])


def test_missing_fields_fall_back_to_plain_words_and_a_value_at_stake_is_kept(ns):
    lines = ns["inspire_kind_lines"]({"Analytics Technique": "Classification"})
    assert "for the decision owner that says which records to act on first each cycle" in lines["serving_summary"]
    assert "the source columns" in lines["method_summary"]
    staked = ns["inspire_kind_lines"]({"Analytics Technique": "Forecasting", "value_at_stake": "USD 1.2M"})
    assert staked["value_source"].endswith("current estimate USD 1.2M.")
    weekly = ns["inspire_kind_lines"]({"Analytics Technique": "Classification", "elite_assessment": {"cadence": "Weekly"}})
    assert "act on first each week:" in weekly["serving_summary"]
    custom = ns["inspire_kind_lines"]({"Analytics Technique": "Classification", "elite_assessment": {"cadence": "Per shift"}})
    assert "act on first per shift:" in custom["serving_summary"]


def test_the_named_kind_wins_over_the_technique_and_a_bad_name_falls_back(ns):
    for named in ("forecast", "Forecast", "5", "5. Forecast", "FORECAST"):
        uc = kinded(ns, make_uc("N01-U01", **{"Analytics Technique": "Classification", "Use Case Kind": named}))
        assert uc["use_case_kind"] == "forecast", named
    fallback = kinded(ns, make_uc("N01-U01", **{"Analytics Technique": "Classification", "Use Case Kind": "Basket magic"}))
    assert fallback["use_case_kind"] == "risk_propensity"


def test_a_use_case_with_no_kind_is_left_untouched(ns):
    uc = make_uc("N01-U01", **{"Analytics Technique": "Basket magic"})
    before = dict(uc)
    assert ns["inspire_apply_use_case_kind"](uc) is False
    assert uc == before


def test_applying_twice_keeps_the_stored_lines_and_a_stale_kind_is_rebuilt(ns):
    uc = kinded(ns, forecast_uc())
    uc["serving_summary"] = "Kept as stored"
    kinded(ns, uc)
    assert uc["serving_summary"] == "Kept as stored" and uc["use_case_kind"] == "forecast"
    stale = kinded(ns, forecast_uc(use_case_kind="no_such_kind", serving_summary="Old line", app_layout="planner"))
    assert stale["use_case_kind"] == "forecast" and stale["serving_summary"] != "Old line"
    assert stale["app_layout"] == "forecast_cockpit"


def _describe_state(columns):
    present = list(columns)

    def responder(statement):
        if statement.upper().startswith("DESCRIBE TABLE"):
            return [{"col_name": c} for c in present]
        match = re.match(r"^ALTER TABLE \S+ ADD COLUMN (\S+) ", statement, re.I)
        if match:
            present.append(match.group(1).strip("`"))
        return []
    return responder


def _tracking_obj(ns, spark):
    obj = make_inspire(ns, spark=spark, inspire_database="main.inspire", session_id=99,
                       _tracking_table_name="main.inspire.__inspire_usecases", _tracking_table_created=True)
    obj._tracking_lock = threading.Lock()
    obj._build_code_structure_mandate = lambda spec: "mandate"
    return obj


def test_migration_adds_the_kind_columns_once_and_a_second_run_adds_nothing(ns):
    cls = ns["DatabricksInspire"]
    existing = ["session_id", "id"] + [c for c, _ in cls._TRACKING_MIGRATION_COLUMNS if c not in KIND_COLUMNS]
    spark = FakeSpark(responder=_describe_state(existing))
    obj = _tracking_obj(ns, spark)
    assert obj._migrate_tracking_table_schema() == KIND_COLUMNS
    assert [s for s in spark.statements if s.upper().startswith("ALTER TABLE")] == [
        f"ALTER TABLE `main`.`inspire`.`__inspire_usecases` ADD COLUMN {c} STRING" for c in KIND_COLUMNS]
    spark.statements.clear()
    assert obj._migrate_tracking_table_schema() == []
    assert not [s for s in spark.statements if s.upper().startswith("ALTER TABLE")]


def test_create_table_declares_the_kind_columns(ns):
    cls = ns["DatabricksInspire"]
    spark = FakeSpark(responder=_describe_state(["session_id", "id"] + [c for c, _ in cls._TRACKING_MIGRATION_COLUMNS]))
    obj = _tracking_obj(ns, spark)
    obj._tracking_table_created = False
    obj._create_tracking_table()
    create = next(s for s in spark.statements if s.upper().startswith("CREATE TABLE"))
    assert all(f"{column} STRING" in create for column in KIND_COLUMNS)


def _row(ns, uc):
    cls = ns["DatabricksInspire"]
    names = [f.name for f in cls._get_tracking_full_schema().fields]
    values = cls._uc_to_row(uc, 7, lambda usecase, name: name)
    assert len(values) == len(names)
    return dict(zip(names, values))


@pytest.mark.parametrize("basis", ["earned", {"basis": "kind floor", "replaced": "N02-U04", "score_gap": 0.4}])
def test_kind_fields_round_trip_through_the_tracking_row(ns, basis):
    uc = kinded(ns, forecast_uc(selection_basis=basis))
    row = _row(ns, uc)
    assert [row[c] for c in KIND_COLUMNS[:-1]] == [uc[c] for c in KIND_COLUMNS[:-1]]
    assert row["selection_basis"] == (basis if isinstance(basis, str) else json.dumps(basis, sort_keys=True))
    back = make_inspire(ns)._row_to_uc(row)
    assert back["selection_basis"] == basis
    assert [back[c] for c in KIND_COLUMNS[:-1]] == [uc[c] for c in KIND_COLUMNS[:-1]]
    assert back["kind_label"] == "Forecast"


def test_an_older_row_derives_its_kind_from_the_technique_when_read(ns):
    row = {"id": "N01-U03", "analytics_technique": "Anomaly Detection", "use_case": "Flag odd refunds"}
    uc = make_inspire(ns)._row_to_uc(row)
    assert (uc["use_case_kind"], uc["kind_family"], uc["app_layout"]) == ("anomaly", "detect_protect", "monitor_triage")
    assert all(uc[field] for field in LINE_FIELDS)
    unknown = make_inspire(ns)._row_to_uc({"id": "N01-U04", "analytics_technique": "Basket magic"})
    assert "use_case_kind" not in unknown and "serving_summary" not in unknown


def test_an_older_json_catalog_derives_the_kind_in_docs_only_mode(ns):
    obj = make_inspire(ns)
    old = make_uc("N01-U01")
    obj.w_client.workspace.files["/Workspace/out/docs/old.json"] = json.dumps(
        {"business_name": "Acme", "domains": [{"domain_name": "Sales", "summary": "", "use_cases": [old]}]}).encode()
    use_cases, _summary, _grouped = obj._load_usecases_catalog_json("/Workspace/out/docs/old.json")
    assert use_cases[0]["use_case_kind"] == "forecast" and use_cases[0]["value_source"]


def test_csv_and_excel_columns_carry_the_kind_family_and_lines_in_english(ns):
    obj = make_inspire(ns)
    columns = obj._export_columns(False)
    headers = [header for header, _get, _numeric in columns]
    wanted = ["Use Case Kind", "Kind Family", "What we serve", "How it works", "Where the value comes from"]
    assert headers[headers.index("Business Value") + 1:headers.index("Business Value") + 6] == wanted
    uc = kinded(ns, forecast_uc())
    values = {header: get(uc, 1) for header, get, _numeric in columns}
    assert values["Use Case Kind"] == "Forecast" and values["Kind Family"] == "Predict"
    assert values["What we serve"] == uc["serving_summary"]
    assert values["Where the value comes from"] == obj._doc_display(uc["value_source"]) and "units_sold, sale_date" in values["Where the value comes from"]
    bare = {header: get(make_uc("N01-U02", **{"Analytics Technique": "Basket magic"}), 1) for header, get, _numeric in columns}
    assert bare["Use Case Kind"] == "" and bare["What we serve"] == ""


def test_the_arabic_csv_has_arabic_headers_and_the_translated_lines(ns):
    labels = arabic_labels(ns)
    uc = kinded(ns, forecast_uc())
    arabic = dict(uc, kind_label="توقع", kind_family_label="تنبؤ", serving_summary="ما نقدمه بالعربية",
                  method_summary="طريقة العمل بالعربية", value_source="مصدر القيمة بالعربية")
    obj = bilingual(ns)
    obj._generate_csv_catalog("Arabic", "ar", {"المبيعات": [arabic]}, translations=labels)
    header, rows = csv_rows(obj)
    for english in ("Use Case Kind", "Kind Family", "What we serve", "How it works", "Where the value comes from"):
        assert english not in header
    row = rows[0]
    assert row[labels["doc_kind"]] == "توقع" and row[labels["doc_kind_family"]] == "تنبؤ"
    assert row[labels["doc_what_we_serve"]] == "ما نقدمه بالعربية"
    assert row[labels["doc_value_source"]] == "مصدر القيمة بالعربية"


def _labels(ns, language="English"):
    ts = ns["TranslationService"]
    t = dict(ts.ENGLISH_TRANSLATIONS)
    if language != "English":
        t.update(ts.TRANSLATION_FALLBACKS[language])
    return t


def test_the_document_view_has_the_kind_fact_and_a_what_you_get_block_first(ns):
    obj = make_inspire(ns)
    t = _labels(ns)
    model = obj._document_model("English", t, {}, {"Sales": [kinded(ns, forecast_uc())]}, "Acme")
    view = obj._use_case_view(model["ranked"][0], model, t)
    keys = [key for key, _label, _value in view["facts"]]
    assert keys[keys.index("analytics_technique") + 1] == "kind"
    assert dict((k, v) for k, _l, v in view["facts"])["kind"] == "Forecast \u00b7 Predict"
    key, label, items = view["value_facts"][0]
    assert (key, label) == ("what_you_get", "What you get")
    assert [item.split(":")[0] for item in items] == ["What we serve", "How it works", "Where the value comes from"]
    legacy = obj._document_model("English", t, {}, {"Sales": [make_uc("N01-U01")]}, "Acme")
    plain = obj._use_case_view(legacy["ranked"][0], legacy, t)
    assert "kind" not in [k for k, _l, _v in plain["facts"]] and plain["value_facts"] == []


def test_pdf_markdown_and_deck_show_the_3_lines(ns, monkeypatch):
    import sys
    from v120_docs_geometry_support import pptx_geometry_violations
    captured = []

    class HTML:
        def __init__(self, string=None, **kwargs):
            captured.append(string)

        def write_pdf(self, path, font_config=None):
            with open(path, "wb") as handle:
                handle.write(b"%PDF-1.4 fake")
    monkeypatch.setitem(sys.modules, "weasyprint", types.SimpleNamespace(HTML=HTML))
    obj = make_inspire(ns)
    t = _labels(ns)
    uc = kinded(ns, forecast_uc())
    obj.generate_catalog_pdf("English", "en", t, {"Executive": "<p>Exec</p>"}, {"Sales": [uc]}, "Acme")
    assert "<h5>What you get</h5>" in captured[-1] and "A forecast cockpit for Regional supply planner" in captured[-1]
    obj._generate_markdown_catalog("English", "en", {"Sales": [uc]}, {"Executive": "Exec"}, "Acme")
    text = next(data for path, data in obj.w_client.workspace.files.items() if path.endswith(".md"))
    text = text.decode("utf-8") if isinstance(text, bytes) else str(text)
    assert "**What you get:**" in text and "- What we serve: A forecast cockpit" in text
    assert "**Use Case Kind:** Forecast \u00b7 Predict" in text
    model = obj._document_model("English", t, {"Executive": "<p>Exec</p>"}, {"Sales": [uc]}, "Acme")
    prs, archetypes = obj._build_presentation_deck(model, t)
    assert "uc_value" in archetypes and pptx_geometry_violations(prs) == []
    texts = " ".join(s.text_frame.text for slide in prs.slides for s in slide.shapes if s.has_text_frame)
    assert "How it works: Forecasting: past values" in texts


@pytest.mark.parametrize("language", ["Arabic", "Japanese", "French"])
def test_translated_lines_reach_the_documents_and_an_english_left_line_is_flagged(ns, language):
    obj = make_inspire(ns)
    t = _labels(ns, language)
    uc = kinded(ns, forecast_uc())
    translated = dict(uc, serving_summary="LINE ONE", method_summary="LINE TWO", value_source="LINE THREE",
                      _translation_status="partial", _untranslated_fields=["How It Works"])
    model = obj._document_model(language, t, {}, {"Sales": [translated]}, "Acme")
    view = obj._use_case_view(model["ranked"][0], model, t)
    _key, label, items = view["value_facts"][0]
    assert label == t["doc_what_you_get"] != "What you get"
    assert items == [f'{t["doc_what_we_serve"]}: LINE ONE', f'{t["doc_how_it_works"]}: LINE TWO', f'{t["doc_value_source"]}: LINE THREE']
    assert t["doc_how_it_works"] in view["notice"]


def test_translation_sends_the_5_kind_columns_and_writes_them_back_in_place(ns):
    ts = ns["TranslationService"]
    svc = ts(FakeAgent(french_responder()), CapturingLogger())
    out = svc.translate_use_case_list([kinded(ns, forecast_uc())], "French", enable_parallelization=False)[0]
    payload = json.loads(svc.ai_agent.calls[0]["json_payload"])[0]
    columns = ["Kind Label", "Kind Family Label", "What We Serve", "How It Works", "Where Value Comes From"]
    assert list(payload)[-5:] == columns
    assert out["kind_label"] == "FR Forecast" and out["serving_summary"].startswith("FR A forecast cockpit")
    assert out["use_case_kind"] == "forecast", "the id is never translated"
    assert out["_translation_status"] == "translated"
    left = ts(FakeAgent(french_responder(left_in_english={"What We Serve"})), CapturingLogger())
    flagged = left.translate_use_case_list([kinded(ns, forecast_uc())], "French", enable_parallelization=False)[0]
    assert "What We Serve" in flagged["_untranslated_fields"]
    bare = ts(FakeAgent(french_responder()), CapturingLogger())
    bare.translate_use_case_list([make_uc("N01-U01", **{"Analytics Technique": "Basket magic"})], "French", enable_parallelization=False)
    assert not set(columns) & set(json.loads(bare.ai_agent.calls[0]["json_payload"])[0])


def test_the_translate_prompt_lists_the_kind_columns_in_order(ns):
    prompt = ns["PROMPT_TEMPLATES"]["USE_CASE_TRANSLATE_PROMPT"]
    listed = re.search(r'Some input use cases carry the extra keys (.*?)\.\n', prompt).group(1)
    names = re.findall(r'"([^"]+)"', listed)
    assert names[-5:] == ["Kind Label", "Kind Family Label", "What We Serve", "How It Works", "Where Value Comes From"]
    assert f"{24 + len(names)} with all eighteen" in prompt and len(names) == 18


ABOUT_LABELS = ("What we serve", "How it works", "Where the value comes from")


def _about(ns, uc):
    return [f"{label}: {uc[field]}" for label, field in zip(ABOUT_LABELS, LINE_FIELDS)]


def test_the_about_lines_read_the_stored_lines_and_build_the_missing_ones(ns):
    uc = kinded(ns, forecast_uc())
    assert ns["inspire_kind_about"](uc) == _about(ns, uc)
    assert ns["inspire_kind_about"](dict(uc, serving_summary="A list of stores to restock."))[0] == "What we serve: A list of stores to restock."
    built = ns["inspire_kind_about"]({"Analytics Technique": "Forecasting", "serving_summary": "A cockpit."})
    assert [line.split(": ", 1)[0] for line in built] == list(ABOUT_LABELS) and built[0] == "What we serve: A cockpit."
    assert ns["inspire_kind_about"]({"Analytics Technique": "Basket magic"}) == [], "no kind and no lines: nothing to say"
    assert ns["inspire_kind_about"]({"Name": "Predict churn", "Statement": "Customers leave"}) == []


def test_the_about_text_appends_the_lines_once(ns):
    uc = kinded(ns, forecast_uc())
    once = ns["inspire_kind_about_text"]("A room about stock.", uc)
    assert once.splitlines() == ["A room about stock."] + _about(ns, uc)
    assert ns["inspire_kind_about_text"](once, uc) == once, "a kept description that already says them is not repeated"
    assert ns["inspire_kind_about_text"]("", uc).splitlines() == _about(ns, uc)
    assert ns["inspire_kind_about_text"]("A room.", {"Analytics Technique": "Basket magic"}) == "A room."


def test_the_implement_brief_carries_the_3_lines_after_the_kpi(ns, tmp_path):
    from v140_implement_test import _output_context, _output_inspire
    inst, _calls = _output_inspire(ns, tmp_path)
    context = _output_context(ns)
    plain = inst._implement_use_case_brief(context)
    assert not any(label in plain for label in ABOUT_LABELS), "a use case with no kind keeps the brief it had"
    context["use_case"] = kinded(ns, forecast_uc())
    brief = inst._implement_use_case_brief(context)
    kpi = next(line for line in brief.splitlines() if line.startswith("KPI: "))
    assert brief.split(kpi + "\n", 1)[1].startswith("\n".join(_about(ns, context["use_case"])) + "\nBusiness output table: ")


def test_the_dashboard_header_carries_the_3_lines_and_moves_the_rest_down(ns, tmp_path):
    from v142_dash_test import _canvas, _page, _shell
    shell_sql, page = _shell(ns, tmp_path), _page(ns)
    plain = ns["implement_dashboard_from_page"](page, shell_sql, "main.inspire.churn_out", {})
    about = _about(ns, kinded(ns, forecast_uc()))
    doc = ns["implement_dashboard_from_page"](page, shell_sql, "main.inspire.churn_out", {}, about=about)
    before, after = _canvas(plain)[0]["layout"], _canvas(doc)[0]["layout"]
    box = next(item for item in after if item["widget"]["name"] == "about")
    height = ns["IMPLEMENT_DASHBOARD_HEIGHTS"]["about"]
    assert box["position"] == {"x": 0, "y": ns["IMPLEMENT_DASHBOARD_HEIGHTS"]["text"], "width": 12, "height": height}
    assert "".join(box["widget"]["multilineTextboxSpec"]["lines"]).split("\n") == [f"- {line}" for line in about]
    assert [i["widget"]["name"] for i in after if i is not box] == [i["widget"]["name"] for i in before]
    assert [i["position"]["y"] for i in after if i is not box][1:] == [i["position"]["y"] + height for i in before][1:]
    assert not any(i["widget"]["name"] == "about" for i in before), "no lines, no box"


def test_the_genie_room_description_and_the_alert_body_carry_the_3_lines(ns):
    from v149_app_alerts_test import shell_alerts
    from v140_implement_test import ALERT, _output_context
    from _agentload import agent_source
    uc = kinded(ns, dict(forecast_uc(), Name="Forecast stock", Statement="Shelves run empty"))
    outputs = _output_context(ns, **ALERT)["spec"]["outputs"]
    _summary, body = ns["implement_alert_texts"](shell_alerts, "N01-U01", uc, outputs, "https://h/d", "", None, False, "")
    for line in _about(ns, uc):
        assert line in body, line
    assert len(body) <= shell_alerts.RUNBOOK_LIMIT and body.index("Why it matters:") < body.index("What we serve:")
    _summary, plain = ns["implement_alert_texts"](shell_alerts, "N01-U01", {"Name": "Predict churn", "Statement": "Customers leave"},
                                                  outputs, "https://h/d", "", None, False, "")
    assert "What we serve:" not in plain
    source = agent_source()
    assert 'description = inspire_kind_about_text(description, context["use_case"])' in source
    assert 'schema, run_log, inspire_kind_about(context["use_case"]), context.get("kind_spec")),' in source
