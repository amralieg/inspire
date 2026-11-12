"""v1.2.0 INTEGRATION-2B: cross-lane fixes after merging ARTIFACTS into the ELITE + MODES dev line.

1. One rank contract for scores: `_final_rank_key` and every other score rank key coerce through the one
   `_finite_or` / `_score_rank_part` pair, so a label-like, missing, non-finite or oversized value sorts
   as unscored, never raises and never outranks a scored use case.
2. One quality-mode parser: the session row, the step payload and the tracking row canonicalize through
   `canonical_use_cases_quality()`; an unknown value raises the same ValueError as `__init__`.
3. Translation sends only the seven human-readable `elite_assessment` fields and stores their translation beside the
   assessment, which stays English; verification (incl.
   `repairable`), evidence repair, scores, verdict codes, column lists and the second opinion are never
   sent to the model and never overwritten, even when the model answers with columns named after them.
4. The run() banner, the JSON-mode banner and the final pipeline status report `failed_steps` and
   `translation_gaps`: no clean success banner and no `ended_success` final step when an artifact
   step failed.
5. One text-technique family set, `_TEXT_FAMILIES`, beside `_TEMPORAL_FAMILIES`: the registry labels
   "Document Processing" and "Extraction" (including G2 relabels to them) resolve to text families, so
   Q3 R14 and the elite evidence verification require a free-text column for every text technique.
6. `_tracking_table_name` is assigned quoted, so every statement that embeds it (including the Generate
   mode reads) is safe for catalog and schema names that need quoting; the staging table name of the
   atomic session replace is derived from the unquoted parts. The docs describe `failed_steps`,
   `translation_gaps`, the ISO language codes, "Not scored" cells, the tracking columns and the
   atomic replace.

Every behavioural fix has a case that fails on dev 018e620 and a must-exclude case.
"""
import ast
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import agent_ast, load_agent_namespace, method_node  # noqa: E402
from v120_artifacts_support import make_inspire  # noqa: E402


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


# ---------------------------------------------------------------- 1. one rank contract for scores


UNSCORED = [None, "", "High", "Very High", "N/A", "not scored", True, False, [], {}, [7.0], float("nan"),
            float("inf"), "-inf", 10 ** 400, object()]


def _case_id(value):
    return "object()" if type(value) is object else repr(value)


@pytest.mark.parametrize("bad", UNSCORED, ids=_case_id)
def test_final_rank_key_ranks_an_unscored_value_after_a_scored_zero(ns, bad):
    key = ns["DatabricksInspire"]._final_rank_key
    scored = {"No": "Z", "Inspire Score": 0.0}
    unscored = {"No": "A", "Inspire Score": bad, "bob_score": 9.9, "Priority": 9.5}
    assert [u["No"] for u in sorted([unscored, scored], key=key)] == ["Z", "A"]


@pytest.mark.parametrize("field", ["bob_score", "Priority"])
@pytest.mark.parametrize("bad", ["High", None, 10 ** 400, float("nan")], ids=repr)
def test_final_rank_key_tie_breakers_rank_unscored_after_scored(ns, field, bad):
    key = ns["DatabricksInspire"]._final_rank_key
    label = {"No": "A", "Inspire Score": 7.0, field: bad}
    numeric = {"No": "B", "Inspire Score": 7.0, field: 0.0}
    assert [u["No"] for u in sorted([label, numeric], key=key)] == ["B", "A"]


def test_final_rank_key_never_lets_unscored_outrank_a_negative_score(ns):
    key = ns["DatabricksInspire"]._final_rank_key
    ucs = [{"No": "A", "Inspire Score": "High", "bob_score": 9.0}, {"No": "B", "Inspire Score": -1.0}]
    assert [u["No"] for u in sorted(ucs, key=key)] == ["B", "A"]


def test_final_rank_key_orders_numeric_strings_by_value_and_falls_back_from_a_label_elite_score(ns):
    key = ns["DatabricksInspire"]._final_rank_key
    ucs = [{"No": "A", "Inspire Score": 8.0}, {"No": "B", "Inspire Score": "8.5"},
           {"No": "C", "elite_score": "High", "Inspire Score": 9.0}, {"No": "D", "elite_score": "9.5"}]
    assert [u["No"] for u in sorted(ucs, key=key)] == ["D", "C", "B", "A"]


def test_final_rank_key_treats_an_empty_elite_status_as_unlabelled(ns):
    key = ns["DatabricksInspire"]._final_rank_key
    ucs = [{"No": "P", "elite_status": "DOMAIN_COVERAGE_PICK", "Inspire Score": 9.9},
           {"No": "U", "elite_status": "", "Inspire Score": 6.0},
           {"No": "E", "elite_status": "ELITE", "elite_score": 8.0}]
    assert [u["No"] for u in sorted(ucs, key=key)] == ["E", "U", "P"]


def test_coverage_picks_stay_after_scored_and_unscored_selected_use_cases(ns):
    key = ns["DatabricksInspire"]._final_rank_key
    ucs = [{"No": "P", "elite_status": "DOMAIN_COVERAGE_PICK", "Inspire Score": 9.9},
           {"No": "U", "Inspire Score": "High"}, {"No": "S", "Inspire Score": 1.0}]
    assert [u["No"] for u in sorted(ucs, key=key)] == ["S", "U", "P"]


@pytest.mark.parametrize("value,expected", [(10 ** 400, None), ("7.25", 7.25), (3, 3.0), (True, None),
                                            ("High", None), (float("-inf"), None)], ids=repr)
def test_finite_score_is_the_shared_finite_or_coercion(ns, value, expected):
    cls = ns["DatabricksInspire"]
    assert cls._finite_score(value) == expected
    assert cls._finite_or(value, None) == expected
    src = ast.unparse(method_node("DatabricksInspire", "_finite_score"))
    assert "_finite_or(" in src and "float(" not in src


def test_post_bob_dedup_rank_ranks_a_label_priority_after_a_scored_zero(ns):
    rank = ns["DatabricksInspire"]._post_bob_dedup_rank
    assert rank({"bob_score": 7.0, "Priority": "High"}) > rank({"bob_score": 7.0, "Priority": 0.0})
    assert rank({"bob_score": None, "Priority": 9.0}) > rank({"bob_score": 0.0, "Priority": 0.0})
    assert rank({"bob_score": "8.5"}) < rank({"bob_score": 8.0})


def test_signature_dedup_ranks_by_inspire_score_and_never_by_a_priority_without_one(ns):
    obj = make_inspire(ns)
    twin = {"Name": "Forecast weekly store demand to cut stock-outs", "Analytics Technique": "Forecasting",
            "Tables Involved": "main.s.sales", "Solution": "Prophet on `units_sold` by `sale_date`."}
    a = dict(twin, No="A", **{"Inspire Score": None, "Priority": 9.0})
    b = dict(twin, No="B", **{"Inspire Score": 5.0})
    kept, merge_log = obj._dedup_by_signature([a, b], "duplicate decision")
    assert [u["No"] for u in kept] == ["B"] and merge_log[0]["kept"] == "B"
    c = dict(twin, No="C", **{"Inspire Score": "High", "Priority": "High"})
    kept, _ = obj._dedup_by_signature([c, b], "duplicate decision")
    assert [u["No"] for u in kept] == ["B"]


class _SummaryAgent:
    def __init__(self):
        self.vars = None

    def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema=None, **kw):
        self.vars = dict(prompt_vars)
        return '"Type","Summary","TransliteratedBusinessName"\n"Executive","Summary text","Acme"\n'


def test_summary_highlights_follow_the_shared_final_rank_key(ns):
    obj = make_inspire(ns)
    obj.ai_agent = _SummaryAgent()
    obj._get_generation_instruction_for_prompt = lambda prompt: ""
    ucs = [{"No": "P", "Name": "Pick", "elite_status": "DOMAIN_COVERAGE_PICK", "Inspire Score": 9.9},
           {"No": "L", "Name": "Label", "Inspire Score": "High"},
           {"No": "E", "Name": "Elite", "elite_status": "ELITE", "elite_score": 9.0, "Inspire Score": 1.0},
           {"No": "A", "Name": "Eight", "Inspire Score": 8.0}, {"No": "B", "Name": "Seven", "Inspire Score": 7.0}]
    obj._get_salesy_summary({"Sales": ucs}, "Acme", "English", dict(ns["TranslationService"].ENGLISH_TRANSLATIONS))
    highlights = obj.ai_agent.vars["domain_use_case_highlights"]
    names = [line.strip()[2:] for line in highlights.splitlines() if line.strip().startswith("- ")]
    assert names == ["Elite", "Eight", "Seven"]
    src = ast.unparse(method_node("DatabricksInspire", "_get_salesy_summary"))
    assert "self._final_rank_key" in src and "_highlight_rank" not in src


def _trim_ucs(bobs):
    return [{"No": f"U{i}", "idea_theme": theme, "bob_score": bob} for i, (theme, bob) in enumerate(bobs)]


def test_stratified_trim_ranks_numeric_strings_and_never_raises_on_mixed_bob_types(ns):
    obj = make_inspire(ns)
    ucs = _trim_ucs([("T1", "8.5"), ("T1", 8.0), ("T2", 7.0), ("T2", None), ("T3", 6.0), ("T3", "High")])
    out = obj._stratified_trim_by_theme(ucs, target_max=2)
    assert [u["No"] for u in out] == ["U0", "U2"]


def test_stratified_trim_keeps_a_scored_zero_over_an_unscored_twin_in_a_theme(ns):
    obj = make_inspire(ns)
    ucs = _trim_ucs([("T1", None), ("T1", 0.0)] + [(f"T{i}", 5.0) for i in range(2, 5)] + [("T1", 4.0)])
    out = obj._stratified_trim_by_theme(ucs, target_max=5, theme_max_share=0.4)
    t1 = [u["No"] for u in out if u["idea_theme"] == "T1"]
    assert t1 == ["U5", "U1"]


def test_stratified_trim_fills_leftover_slots_with_the_strongest_use_cases_not_the_biggest_theme(ns):
    obj = make_inspire(ns)
    ucs = _trim_ucs([("Big", 5.0), ("Big", 4.0), ("Big", 3.9), ("Big", 3.8), ("S1", 9.0), ("S1", 8.9),
                     ("S2", 8.0), ("S2", 7.9), ("S3", 7.0)])
    out = obj._stratified_trim_by_theme(ucs, target_max=6, theme_max_share=0.5)
    assert sorted(u["bob_score"] for u in out) == [5.0, 7.0, 7.9, 8.0, 8.9, 9.0]
    assert [u["No"] for u in out if u["idea_theme"] == "Big"] == ["U0"]


def test_the_trim_target_is_drawn_from_the_session_id(ns):
    rt = {"target_max_use_cases": 90, "target_max_jitter": 20}
    first, again = make_inspire(ns, session_id=4242), make_inspire(ns, session_id=4242)
    assert first._trim_target(rt) == again._trim_target(rt) == first._trim_target(rt)
    sizes = {make_inspire(ns, session_id=sid)._trim_target(rt) for sid in range(1000, 1040)}
    assert sizes <= set(range(91, 111)) and len(sizes) > 5, "new sessions still vary across 91-110"
    assert make_inspire(ns, session_id=1)._trim_target({"target_max_use_cases": 90, "target_max_jitter": 0}) == 91


def test_stratified_trim_fill_never_passes_the_theme_cap(ns):
    obj = make_inspire(ns)
    ucs = _trim_ucs([("A", 9.9), ("A", 9.8), ("A", 9.7), ("A", 9.6), ("B", 1.0)])
    out = obj._stratified_trim_by_theme(ucs, target_max=4, theme_max_share=0.5)
    assert [u["No"] for u in out] == ["U0", "U1", "U4"]


SCORE_FIELDS = {"bob_score", "Priority", "Inspire Score", "elite_score"}


def _key_reads_a_score(node):
    for sub in ast.walk(node):
        if (isinstance(sub, ast.Call) and isinstance(sub.func, ast.Attribute) and sub.func.attr == "get"
                and sub.args and isinstance(sub.args[0], ast.Constant) and sub.args[0].value in SCORE_FIELDS):
            return True
    return False


def _uses_shared_coercion(node):
    return any(isinstance(sub, ast.Attribute) and sub.attr in ("_score_rank_part", "_finite_or", "_final_rank_key",
                                                               "_elite_value_score")
               for sub in ast.walk(node))


def test_every_score_rank_key_uses_the_shared_coercion():
    tree = agent_ast()
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "DatabricksInspire")
    offenders = []
    for method in (n for n in cls.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))):
        local_defs = {n.name: n for n in ast.walk(method) if isinstance(n, ast.FunctionDef) and n is not method}
        for call in (n for n in ast.walk(method) if isinstance(n, ast.Call)):
            name = call.func.attr if isinstance(call.func, ast.Attribute) else getattr(call.func, "id", "")
            if name not in ("sorted", "sort", "min", "max"):
                continue
            for kw in (k for k in call.keywords if k.arg == "key"):
                target = kw.value
                if isinstance(target, ast.Name) and target.id in local_defs:
                    target = local_defs[target.id]
                if _key_reads_a_score(target) and not _uses_shared_coercion(target):
                    offenders.append((method.name, getattr(target, "lineno", 0)))
    assert offenders == []


# ---------------------------------------------------------------- 2. one quality-mode parser


def _alias_readers():
    tree = agent_ast()
    readers = set()

    def visit(node, owner):
        for child in ast.iter_child_nodes(node):
            name = owner
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                name = f"{owner}.{child.name}" if owner else child.name
            if isinstance(child, ast.Name) and child.id in ("USE_CASES_QUALITY_ALIASES",) and owner:
                readers.add(owner)
            visit(child, name)

    visit(tree, "")
    return readers


def test_only_the_canonical_parser_reads_the_quality_alias_table(ns):
    assert _alias_readers() == {"canonical_use_cases_quality"}
    assert not hasattr(ns["AtomicWriter"], "canonical_quality_mode")
    for owner, method in (("AtomicWriter", "_widget_to_columns_map"),
                          ("DatabricksInspire", "_build_use_case_step_payload"),
                          ("DatabricksInspire", "_tracking_row_source")):
        assert "canonical_use_cases_quality(" in ast.unparse(method_node(owner, method)), method


def _session_writer(ns, tmp_path, monkeypatch, **widget_values):
    from v120_artifacts_support import CapturingLogger, FakeSpark
    monkeypatch.setattr(ns["tempfile"], "tempdir", str(tmp_path), raising=False)
    return ns["AtomicWriter"](FakeSpark(), CapturingLogger(), "cat.inspire", 77, widget_values=widget_values)


@pytest.mark.parametrize("value,expected", [("  strict quality ", "High"), ("Balanced", "Good"),
                                            ("ULTRA HIGH", "Ultra High"), ("", "Good")])
def test_session_row_stores_the_canonical_mode(ns, tmp_path, monkeypatch, value, expected):
    writer = _session_writer(ns, tmp_path, monkeypatch, use_cases_quality=value)
    try:
        assert writer._widget_to_columns_map()["use_cases_quality"] == expected
    finally:
        writer._session_writer.stop(drain_timeout=5.0)


def test_session_row_rejects_an_unknown_mode_like_init(ns, tmp_path, monkeypatch):
    writer = _session_writer(ns, tmp_path, monkeypatch, use_cases_quality="Platinum")
    try:
        with pytest.raises(ValueError) as from_writer:
            writer._widget_to_columns_map()
        with pytest.raises(ValueError) as from_parser:
            ns["canonical_use_cases_quality"]("Platinum")
        assert str(from_writer.value) == str(from_parser.value)
    finally:
        writer._session_writer.stop(drain_timeout=5.0)


def test_step_payload_and_tracking_row_store_the_canonical_mode(ns):
    obj = make_inspire(ns, use_cases_quality="High")
    obj._build_code_structure_mandate = lambda spec: "mandate"
    legacy = {"No": "N01-U01", "Name": "x", "quality_mode": "Very High Quality"}
    assert obj._build_use_case_step_payload(legacy)["quality_mode"] == "High"
    assert obj._tracking_row_source(legacy)["quality_mode"] == "High"
    assert legacy["quality_mode"] == "Very High Quality", "the use case itself is not rewritten"
    assert obj._build_use_case_step_payload({"No": "N01-U02"})["quality_mode"] == "High"
    assert obj._tracking_row_source({"No": "N01-U02"})["quality_mode"] == "High"
    own = {"No": "N01-U03", "quality_mode": "ultra high"}
    assert obj._tracking_row_source(own)["quality_mode"] == "Ultra High"


def test_step_payload_and_tracking_row_reject_an_unknown_mode(ns):
    obj = make_inspire(ns, use_cases_quality="Good")
    obj._build_code_structure_mandate = lambda spec: "mandate"
    junk = {"No": "N01-U01", "quality_mode": "Platinum"}
    with pytest.raises(ValueError, match="Valid options"):
        obj._build_use_case_step_payload(junk)
    with pytest.raises(ValueError, match="Valid options"):
        obj._tracking_row_source(junk)


# ---------------------------------------------------------------- 3. translation never touches machine fields


HUMAN_ELITE_FIELDS = {"decision": "Elite Decision", "value_driver": "Elite Value Driver",
                      "build_path": "Elite Build Path", "red_team": "Elite Red Team",
                      "verdict_reason": "Elite Verdict Reason", "decision_owner": "Elite Decision Owner",
                      "kpi": "Elite KPI"}
BASE_TRANSLATION_COLUMNS = ["No", "Name", "Business Domain", "Subdomain", "type", "Analytics Technique",
                            "Statement",
                            "Solution", "Business Value", "Beneficiary", "Sponsor", "Business Priority Alignment",
                            "Strategic Goals Alignment", "Tables Involved", "Quality", "Headline", "Technique Label",
                            "Measures of Success", "Financial Benefits", "Non-Financial Benefits", "KPI Names",
                            "Proposed Key Results"]
ELITE_TRANSLATION_COLUMNS = ["Coverage Pick Reason", "Below Bar Reason"] + list(HUMAN_ELITE_FIELDS.values())
HOSTILE_COLUMNS = ["verification", "repairable", "evidence_repair", "scores", "verdict", "red_team_verdict",
                   "value_tier", "kpi_direction", "cadence", "blockers", "signal_columns", "join_path",
                   "time_column", "entity_key_column", "outcome_definition", "failed_gates", "second_opinion",
                   "Elite Verdict", "Elite Value Tier", "Elite Scores", "Elite Signal Columns"]


def machine_assessment():
    from v120_artifacts_support import elite_assessment
    a = elite_assessment()
    a.update({
        "verification": {"passed": False, "failures": ["sentinel failure: time column not cited"], "repairable": True,
                         "canonical_columns": {"signal_columns": ["main.s.sales.units_sold"]},
                         "comment_coverage": 0.5, "documented_columns": 1, "cited_columns": 2,
                         "documented_tables": 1, "tables": 1, "join_strength": "none", "join_path": []},
        "evidence_repair": {"failures": ["sentinel repair failure"], "outcome": "passed"},
        "time_column": "main.s.sales.sale_date", "entity_key_column": "main.s.sales.store_id",
        "outcome_definition": {"column": None, "derived_from": ["main.s.sales.units_sold"], "rule": "sentinel rule"},
        "failed_gates": ["score:evidence_strength"],
        "second_opinion": {"decision": "Sentinel second decision", "verdict_reason": "Sentinel second reason",
                           "scores": {"business_value": 8, "evidence_strength": 8, "implementability": 8,
                                      "actionability": 8}, "verdict": "ELITE", "model": "second-model"},
        "blockers": ["Sentinel blocker"],
    })
    return a


class _HostileTranslator:
    def __init__(self):
        self.payloads = []

    def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema=None, skip_cache=False, **kw):
        import csv
        import io
        import json as _json
        payload = _json.loads(prompt_vars["json_payload"])
        self.payloads.append(prompt_vars["json_payload"])
        header = BASE_TRANSLATION_COLUMNS + ELITE_TRANSLATION_COLUMNS + HOSTILE_COLUMNS + ["honesty_score",
                                                                                            "honesty_justification"]
        out = io.StringIO()
        writer = csv.writer(out, quoting=csv.QUOTE_ALL)
        writer.writerow(header)
        for item in payload:
            row = []
            for column in header:
                if column == "No":
                    row.append(item["No"])
                elif column in item and item[column]:
                    row.append(f"FR {item[column]}")
                elif column in HOSTILE_COLUMNS:
                    row.append(f"FR injected {column}")
                elif column == "honesty_score":
                    row.append("90")
                else:
                    row.append("")
            writer.writerow(row)
        return out.getvalue()


def _translate_elite(ns):
    import copy
    from v120_artifacts_support import CapturingLogger, make_uc
    original = make_uc("N01-U01", elite_status="ELITE", elite_score=8.8, elite_assessment=machine_assessment())
    agent = _HostileTranslator()
    service = ns["TranslationService"](agent, CapturingLogger())
    snapshot = copy.deepcopy(original)
    out = service.translate_use_case_list([original], "French", enable_parallelization=False)
    return snapshot, original, out[0], agent


def test_translation_never_overwrites_a_machine_field_even_when_the_model_returns_one(ns):
    snapshot, original, translated, _ = _translate_elite(ns)
    assert original == snapshot, "the English use case must not be mutated"
    before, after = snapshot["elite_assessment"], translated["elite_assessment"]
    machine_keys = set(before)
    assert set(HUMAN_ELITE_FIELDS) <= machine_keys and {"verification", "evidence_repair", "scores", "verdict", "red_team_verdict", "value_tier",
            "kpi_direction", "cadence", "blockers", "signal_columns", "join_path", "time_column",
            "entity_key_column", "outcome_definition", "failed_gates", "second_opinion"} <= machine_keys
    for key in machine_keys:
        assert after[key] == before[key], key
    assert set(after) == set(before)
    assert after["verification"]["repairable"] is True and after["evidence_repair"]["outcome"] == "passed"
    for key in ("elite_status", "elite_score"):
        assert translated[key] == snapshot[key]


def test_translation_leaves_the_elite_assessment_in_english_and_stores_its_text_beside_it(ns):
    snapshot, _, translated, _ = _translate_elite(ns)
    assert translated["elite_assessment"] == snapshot["elite_assessment"]
    assert translated["_translation_status"] == "translated" and translated["_untranslated_fields"] == []
    for key in HUMAN_ELITE_FIELDS:
        assert translated[ns["TranslationService"].elite_translation_key(key)] == f"FR {snapshot['elite_assessment'][key]}", key
    assert not [key for key in translated if key.startswith("_elite_") and key.endswith("_translated")
                and key[len("_elite_"):-len("_translated")] not in HUMAN_ELITE_FIELDS]


def test_machine_fields_are_never_sent_to_the_translation_model(ns):
    import json as _json
    _, _, _, agent = _translate_elite(ns)
    sent = agent.payloads[0]
    payload = _json.loads(sent)
    assert set(payload[0]) <= set(BASE_TRANSLATION_COLUMNS) | set(ELITE_TRANSLATION_COLUMNS)
    for sentinel in ("sentinel failure", "sentinel repair failure", "Sentinel second decision", "Sentinel second reason",
                     "sentinel rule", "Sentinel blocker", "repairable", "survives", "Material", "second-model",
                     "main.s.sales.store_id", "score:evidence_strength"):
        assert sentinel not in sent, sentinel
    for key, column in HUMAN_ELITE_FIELDS.items():
        assert payload[0][column] == machine_assessment()[key], key


def test_only_the_seven_elite_text_fields_are_translatable(ns):
    from v120_artifacts_support import make_uc
    uc = make_uc("N01-U01", elite_status="ELITE", elite_score=8.8, elite_assessment=machine_assessment())
    fields = ns["TranslationService"]._translatable_fields_present(uc)
    assert set(HUMAN_ELITE_FIELDS.values()) <= set(fields) and "Statement" in fields
    assert not [f for f in fields if f.startswith("Elite ") and f not in HUMAN_ELITE_FIELDS.values()]


# ---------------------------------------------------------------- 4. banners and final status report the run outcome


from v120_run_offline_smoke_test import _build, quiet_root_logger  # noqa: E402,F401

GOOD = {"Medium", "High", "Very High", "Ultra High"}


def _scored(uc_id):
    return {"use_case_id": uc_id, "quality_label": "High", "quality_score": 4.0, "priority_score": 7.0,
            "quality_summary": "Columns `id` and `amount` aggregated by store give the KPI that drives the outcome."}


def _capture_log_print(agent_ns, monkeypatch):
    printed = []
    monkeypatch.setitem(agent_ns["DatabricksInspire"].run.__globals__, "log_print",
                        lambda message, level="INFO", flush=True: printed.append((level, str(message))))
    return printed


def test_run_banner_reports_failed_steps_and_translation_gaps(agent_ns, tmp_path, quiet_root_logger, monkeypatch):
    printed = _capture_log_print(agent_ns, monkeypatch)
    obj = _build(agent_ns, tmp_path, "Good", GOOD, _scored)
    obj._generate_csv_catalog = lambda lang, abbr, grouped: obj._record_failed_step(
        "CSV Catalog", lang, RuntimeError("workspace import limit exceeded"))
    obj._record_translation_gaps("French", {"use_cases": 2, "untranslated_use_cases": 1, "fields": {"Statement": 2}})
    obj.run()
    warnings = [m for level, m in printed if level == "WARNING" and "COMPLETED WITH WARNINGS" in m]
    assert len(warnings) == 1
    assert "1 artifact step failed: CSV Catalog (English)" in warnings[0]
    assert "translation gaps: French (2 use cases with text shown in English)" in warnings[0]
    assert not [m for _, m in printed if "generated successfully" in m]


def test_run_banner_stays_a_success_when_nothing_failed(agent_ns, tmp_path, quiet_root_logger, monkeypatch):
    printed = _capture_log_print(agent_ns, monkeypatch)
    obj = _build(agent_ns, tmp_path, "Good", GOOD, _scored)
    obj.run()
    n = len(obj.recorded["tracking"][-1])
    assert n == 4
    assert ("INFO", f"✅ All Use cases for SmokeCo generated successfully ({n} use cases)") in printed
    assert not [m for _, m in printed if "with warnings" in m]


def _json_mode(agent_ns, tmp_path, fail):
    obj = _build(agent_ns, tmp_path, "Good", GOOD, _scored)
    ucs = [{"No": "N01-U01", "Name": "Forecast demand", "Business Domain": "Sales", "Inspire Score": 7.0}]
    obj.json_file_path = "/Workspace/Users/someone/catalog.json"
    obj._load_usecases_catalog_json = lambda path: (list(ucs), {"Executive": "x"}, {"Sales": list(ucs)})
    obj._build_schema_details_from_use_cases = lambda use_cases: []

    def documents(*a, **kw):
        if fail:
            obj._record_failed_step("PDF Catalog", "French", RuntimeError("weasyprint missing"))

    obj._generate_documents_for_all_languages = documents
    return obj


def test_json_mode_banner_reports_failed_steps(agent_ns, tmp_path, quiet_root_logger, monkeypatch):
    printed = _capture_log_print(agent_ns, monkeypatch)
    _json_mode(agent_ns, tmp_path, fail=True).run()
    warnings = [m for level, m in printed if level == "WARNING" and "COMPLETED WITH WARNINGS" in m]
    assert len(warnings) == 1 and "1 artifact step failed: PDF Catalog (French)" in warnings[0]
    assert not [m for _, m in printed if "SUCCESS" in m]


def test_json_mode_banner_stays_a_success_when_nothing_failed(agent_ns, tmp_path, quiet_root_logger, monkeypatch):
    printed = _capture_log_print(agent_ns, monkeypatch)
    _json_mode(agent_ns, tmp_path, fail=False).run()
    assert ("INFO", "✅ SUCCESS: The documents for SmokeCo were rebuilt from the saved catalog") in printed


class _FinalizeRecorder:
    def __init__(self):
        self.calls = []

    def finalize_pipeline(self, **kw):
        self.calls.append(kw)


def test_final_pipeline_status_is_a_warning_when_artifact_steps_failed(ns):
    obj = make_inspire(ns)
    obj.atomic_writer = _FinalizeRecorder()
    obj._pipeline_start_step_id = 3
    obj._record_failed_step("Presentation", "French", "python-pptx missing")
    obj._record_translation_gaps("French", {"use_cases": 1, "untranslated_use_cases": 0, "fields": {"Name": 1}})
    obj.finalize_atomic_writer(success=True)
    call = obj.atomic_writer.calls[-1]
    assert call["status"] == "ended_warning"
    assert call["message"] == ("Completed with warnings: 1 artifact step failed: Presentation (French); "
                               "translation gaps: French (1 use case with text shown in English)")
    assert call["final_results_json"]["failed_steps"][0]["step"] == "Presentation"
    assert call["final_results_json"]["translation_gaps"]["French"]["use_cases"] == 1
    assert call["pipeline_start_step_id"] == 3


def test_final_pipeline_status_stays_a_success_when_nothing_failed(ns):
    obj = make_inspire(ns)
    obj.atomic_writer = _FinalizeRecorder()
    obj.finalize_atomic_writer(success=True)
    assert obj.atomic_writer.calls[-1]["status"] == "ended_success"
    assert obj.atomic_writer.calls[-1]["message"] == "Completed"


@pytest.mark.parametrize("kwargs,status,message", [
    ({}, "ended_success", "Completed"),
    ({"status": "ended_warning", "message": "Completed with warnings: 1 artifact step failed: CSV Catalog"},
     "ended_warning", "Completed with warnings: 1 artifact step failed: CSV Catalog"),
])
def test_finalize_pipeline_emits_the_final_status_and_message(ns, tmp_path, monkeypatch, kwargs, status, message):
    writer = _session_writer(ns, tmp_path, monkeypatch)
    steps = []
    writer.emit_step = lambda **kw: steps.append(kw) or 1
    writer.flush_pending = lambda **kw: 0
    writer.finalize_pipeline(pipeline_start_step_id=5, **kwargs)
    assert steps[-1]["status"] == status and steps[-1]["message"] == message
    assert steps[-1]["step_name"] == "Inspire pipeline completed" and steps[-1]["step_id"] == 5


# ---------------------------------------------------------------- 5. one text-technique family set


from v120_gate_recalibration_test import U, reasons  # noqa: E402
from v120_integration_2a_test import TEXT_SCHEMA, text_gates  # noqa: E402

TEXT_REGISTRY_LABELS = {"Sentiment Analysis", "Document Processing", "Extraction"}


def test_every_text_registry_label_resolves_to_a_text_family(ns):
    cls = ns["DatabricksInspire"]
    registry = ns["TECHNIQUE_IMPLEMENTATION_GUIDANCE"]
    keys = {key for key, _l, _a, _m in cls._TECHNIQUE_FAMILIES}
    assert cls._TEXT_FAMILIES <= keys
    text_labels = {label for label in registry if cls._technique_family(label) in cls._TEXT_FAMILIES}
    assert text_labels == TEXT_REGISTRY_LABELS
    for label in registry:
        family = cls._technique_family(label)
        assert family in keys or family == "catch_all", (label, family)


def test_relabelled_text_families_round_trip_to_a_text_family(ns):
    cls = ns["DatabricksInspire"]
    for family in ("text_sentiment", "text_summarization", "text_extraction", "text_analytics"):
        assert cls._technique_family(cls._technique_label(family)) in cls._TEXT_FAMILIES, family


def test_numeric_technique_labels_keep_their_families(ns):
    family = ns["DatabricksInspire"]._technique_family
    assert family("Clustering") == "clustering" and family("Classification") == "classification"
    assert family("Recommendation") == "recommendation" and family("Topic Modeling") == "text_topic"
    assert family("Feature Extraction Pipeline") == "feature extraction pipeline"


def _text_uc(no, tech, tables, solution):
    return U(no, "Route Complaint Causes from Ticket Text to Owning Teams", tech, tables, solution, hld=solution)


TEXT_TECHNIQUE_CASES = [
    ("AI Analysis", "ai_extract", "Extraction"),
    ("AI Analysis", "ai_summarize", "Document Processing"),
    ("Document Processing", "ai_summarize", "Document Processing"),
    ("Extraction", "ai_extract", "Extraction"),
]


@pytest.mark.parametrize("tech,method,label", TEXT_TECHNIQUE_CASES)
def test_text_technique_without_a_text_column_is_dropped_by_q3_r14(ns, tech, method, label):
    o = text_gates(ns)
    uc = _text_uc("N10-U01", tech, "c.s.visits",
                  f"Run {method} over `channel` and `visited_at` to route each weekly cause to its owning team.")
    relabelled = o._phaseG_validate_no_catchall_technique([uc])
    assert relabelled[0]["Analytics Technique"] == label
    kept, dropped = o._phaseQ3_validate_relevance(relabelled, TEXT_SCHEMA)
    assert kept == [] and reasons(dropped)["N10-U01"] == "Q3_R14_DATA_FIT_SCALE:R14_TEXT_NO_TEXT_COLUMN"


@pytest.mark.parametrize("tech,method,label", TEXT_TECHNIQUE_CASES)
def test_text_technique_with_a_text_column_survives_q3(ns, tech, method, label):
    o = text_gates(ns)
    uc = _text_uc("N10-U02", tech, "c.s.tickets",
                  f"Run {method} over `ticket_body` and group the causes by `opened_at` week for the owning team.")
    relabelled = o._phaseG_validate_no_catchall_technique([uc])
    assert relabelled[0]["Analytics Technique"] == label
    kept, dropped = o._phaseQ3_validate_relevance(relabelled, TEXT_SCHEMA)
    assert [u["No"] for u in kept] == ["N10-U02"] and dropped == []


@pytest.mark.parametrize("tables,kept_ids", [("c.s.tickets", ["N10-U03"]), ("c.s.visits", [])])
def test_sentiment_analysis_text_requirement_is_unchanged(ns, tables, kept_ids):
    o = text_gates(ns)
    cols = "`ticket_body` and `opened_at`" if tables == "c.s.tickets" else "`channel` and `visited_at`"
    uc = _text_uc("N10-U03", "Sentiment Analysis", tables, f"Score sentiment with ai_analyze_sentiment over {cols}.")
    kept, _ = o._phaseQ3_validate_relevance([uc], TEXT_SCHEMA)
    assert [u["No"] for u in kept] == kept_ids


def test_q3_and_elite_verification_read_the_shared_text_families():
    q3 = ast.unparse(method_node("DatabricksInspire", "_phaseQ3_validate_relevance"))
    assert "self._TEXT_FAMILIES" in q3 and "startswith('text_')" not in q3
    elite = ast.unparse(method_node("DatabricksInspire", "_verify_elite_evidence"))
    assert "self._TEXT_FAMILIES" in elite


def test_no_local_text_technique_set_remains():
    tree = agent_ast()
    text_keys = {"text_sentiment", "text_summarization", "text_extraction", "text_analytics", "text_topic",
                 "text_classification"}
    text_labels = {"sentiment analysis", "document processing", "extraction"}
    offenders = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.Set, ast.List, ast.Tuple)) and len(node.elts) >= 2:
            values = {str(e.value).lower() for e in node.elts if isinstance(e, ast.Constant) and isinstance(e.value, str)}
            if len(values & text_keys) >= 2 or len(values & text_labels) >= 2:
                offenders.append(node.lineno)
    tree_src = agent_ast()
    cls = next(n for n in tree_src.body if isinstance(n, ast.ClassDef) and n.name == "DatabricksInspire")
    shared = [n for n in cls.body if isinstance(n, ast.Assign)
              and any(getattr(t, "id", None) in ("_TEXT_FAMILIES", "_FREE_TEXT_DETECTIONS") for t in n.targets)]
    assert len(shared) == 2
    allowed = {e.lineno for node in shared for e in ast.walk(node) if isinstance(e, (ast.Set, ast.List, ast.Tuple))}
    assert [line for line in offenders if line not in allowed] == []


TICKETS = {"comment": "One row per support ticket", "table_type": "MANAGED", "tags": {}, "last_altered": None,
           "primary_key": ["ticket_id"], "foreign_keys": []}


def _tickets_evidence():
    from v120_elite_verification_test import col
    tickets = dict(TICKETS, columns={c["name"]: c for c in (
        col("ticket_id", "BIGINT", "Ticket key"), col("ticket_body", "STRING", "Free-text complaint"),
        col("reopen_count", "INT", "Times reopened"), col("opened_at", "TIMESTAMP"), col("queue_code", "STRING"))})
    return {"c.s.tickets": tickets}


def _ticket_assessment(signals, driver_column):
    return {"signal_columns": signals, "time_column": None, "entity_key_column": "c.s.tickets.ticket_id",
            "outcome_definition": None, "join_path": [],
            "value_driver": f"Causes found in `{driver_column}` explain rising `c.s.tickets.reopen_count`"}


@pytest.mark.parametrize("tech", ["Extraction", "Document Processing", "Sentiment Analysis"])
def test_elite_verification_requires_a_cited_free_text_column(ns, tech):
    from v120_elite_verification_test import inspire as verify_inspire
    obj = verify_inspire(ns)
    use_case = {"No": "T1", "Name": "Route complaint causes", "Analytics Technique": tech, "Tables Involved": "c.s.tickets"}
    without = obj._verify_elite_evidence(
        use_case, _ticket_assessment(["c.s.tickets.reopen_count", "c.s.tickets.queue_code"], "c.s.tickets.queue_code"),
        _tickets_evidence())
    assert f"{tech} needs a free-text column and none is cited" in without["failures"]
    assert without["passed"] is False and without["repairable"] is True
    cited = obj._verify_elite_evidence(
        use_case, _ticket_assessment(["c.s.tickets.ticket_body", "c.s.tickets.reopen_count"], "c.s.tickets.ticket_body"),
        _tickets_evidence())
    assert cited["passed"] is True and cited["failures"] == []


def test_elite_verification_does_not_ask_a_numeric_technique_for_text(ns):
    from v120_elite_verification_test import inspire as verify_inspire
    obj = verify_inspire(ns)
    use_case = {"No": "T2", "Name": "Rank queues", "Analytics Technique": "Anomaly Detection", "Tables Involved": "c.s.tickets"}
    v = obj._verify_elite_evidence(
        use_case, _ticket_assessment(["c.s.tickets.reopen_count", "c.s.tickets.queue_code"], "c.s.tickets.queue_code"),
        _tickets_evidence())
    assert not [f for f in v["failures"] if "free-text" in f]


@pytest.mark.parametrize("tech,solution", [
    ("Document Processing", "Summarize each ticket with ai_summarize over `ticket_body` per `opened_at` week."),
    ("Document Processing", "Text mining over `ticket_body` per `opened_at` week."),
    ("Extraction", "Run ai_extract over `ticket_body` per `opened_at` week."),
])
def test_text_labels_now_checked_by_r18_are_not_falsely_flagged(ns, tech, solution):
    o = text_gates(ns)
    uc = _text_uc("N10-U04", tech, "c.s.tickets", solution)
    kept, dropped = o._phaseQ5_decision_readiness([uc], TEXT_SCHEMA)
    assert dropped == [] and not [f for f in kept[0].get("gate_flags", []) if f.startswith("Q5_R18_")]


def test_elite_judge_prompt_asks_text_techniques_for_their_free_text_column(ns):
    text = ns["PROMPT_TEMPLATES"]["ULTRA_HIGH_ELITE_JUDGE_PROMPT"]
    assert "lists in `signal_columns` the free-text column its method takes as input" in text
    assert ns["audit_prompts_for_data_access_leak"]({"ULTRA_HIGH_ELITE_JUDGE_PROMPT": text}) == []


# ---------------------------------------------------------------- 6. quoted tracking table name and docs


from v120_modes_quality_test import _cleanup, _construct, restore_root_logger  # noqa: E402,F401


@pytest.mark.parametrize("database,expected", [("my-cat.my_sch", "`my-cat`.`my_sch`.`__inspire_usecases`"),
                                               ("main.inspire", "`main`.`inspire`.`__inspire_usecases`"),
                                               ("", "")])
def test_tracking_table_name_is_assigned_quoted(fresh_ns, tmp_path, restore_root_logger, database, expected):
    obj = _construct(fresh_ns, tmp_path, inspire_database=database)
    try:
        assert obj._tracking_table_name == expected
    finally:
        writer = getattr(obj.atomic_writer, "_session_writer", None)
        if writer is not None:
            writer.stop(drain_timeout=5.0)
        _cleanup(obj)


def test_atomic_replace_derives_the_staging_name_from_a_quoted_tracking_name(agent_ns, monkeypatch):
    from v120_artifacts_support import FakeSpark, make_uc
    from v120_artifacts_tracking_test import _tracking_obj
    monkeypatch.setattr(sys.modules["pyspark.sql.functions"], "current_timestamp", lambda: "now", raising=False)
    spark = FakeSpark()
    obj = _tracking_obj(agent_ns, spark, _tracking_table_name="`my-cat`.`my_sch`.`__inspire_usecases`")
    obj._tracking_replace_session([make_uc("N01-U01"), make_uc("N01-U02")])
    stage = "`my-cat`.`my_sch`.`__inspire_usecases_stage_99`"
    assert [w["table"] for w in spark.writes] == [stage, "`my-cat`.`my_sch`.`__inspire_usecases`"]
    assert spark.statements[0].startswith("SELECT id, user_use_case_name FROM `my-cat`.`my_sch`.`__inspire_usecases` WHERE session_id = 99")
    assert spark.statements[1] == f"DROP TABLE IF EXISTS {stage}" == spark.statements[-1]
    assert spark.writes[-1]["options"] == {"replaceWhere": "session_id = 99"}


def _doc(relative):
    from _agentload import ROOT
    with open(os.path.join(ROOT, relative), encoding="utf-8") as fh:
        return fh.read()


def test_docs_describe_run_outcome_language_codes_scores_columns_and_replace(ns):
    import re
    from _agentload import agent_source, notebook_cells
    integration, readme, cell0 = _doc("docs/integration-guide.md"), _doc("readme.md"), notebook_cells()[0][1]
    for name, text in (("integration-guide", integration), ("readme", readme), ("cells[0]", cell0)):
        for needle in ("failed_steps", "translation_gaps", "Not scored", "code_structure_mandate", "replaceWhere",
                       "ended_warning", "Completed with warnings"):
            assert needle in text, (name, needle)
        for old, new in (("sw", "sv"), ("po", "pl"), ("du", "nl"), ("in", "id"), ("ma", "ms"), ("ch", "zh")):
            assert f"`{old}`" in text and f"`{new}`" in text, (name, old, new)
    steps = set(re.findall(r'_record_failed_step\("([^"]+)"', agent_source()))
    assert {"PDF Catalog", "Presentation", "Tracking Table"} <= steps
    for step in steps:
        assert f"`{step}`" in integration and f"`{step}`" in readme, step
    for code in set(ns["DatabricksInspire"]._LANGUAGE_ABBREVIATIONS.values()):
        assert f"`{code}`" in integration, code
    assert integration.count("### 11.8 ") == 1 and integration.count("| `failed_steps` | array") == 1
    assert "single atomic `MERGE INTO`" not in integration
