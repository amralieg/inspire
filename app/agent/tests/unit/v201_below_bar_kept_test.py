import ast
import json

import pytest

from _agentload import method_node
from v120_artifacts_support import make_inspire

HIGH = {"High", "Very High", "Ultra High"}
EMPTY = [f"airline_std.passenger.table_{i:02d}" for i in range(12)]


def _bob(obj):
    def score(use_cases, _schema, **_kw):
        for i, uc in enumerate(use_cases):
            uc.update({"bob_status": "scored", "bob_score": round(9.0 - i * 0.05, 3), "bob_hard_veto_gate": None,
                       "idea_theme": f"T{i % 6}"})
        return use_cases
    obj._score_best_of_best = score
    obj._emit_pipeline_status = lambda **kw: obj.emitted.append(kw)
    obj.emitted = []
    return obj


def _inspire(agent_ns, mode="High", acceptable=HIGH, count=None, empty=(), full=(), **attrs):
    parsed = {"use_case_count": count, "use_case_requests": [], "per_prompt_instructions": {}, "interpretation_status": "ok"}
    obj = make_inspire(agent_ns, use_cases_quality=mode, quality_filter_acceptable=set(acceptable),
                       parsed_generation_instructions=parsed, user_business_domains=[],
                       discovery_evidence={"profiles": {**{fqn: {"rows": 0} for fqn in empty},
                                                        **{fqn: {"rows": 40} for fqn in full}}}, **attrs)
    return _bob(obj)


def _uc(no, quality="High", inspire=7.0, domain="Passenger", **extra):
    uc = {"No": no, "Name": f"Use case {no}", "Business Domain": domain, "scoring_status": "scored",
          "Quality": quality, "Inspire Score": inspire, "Priority": 7.0, "Primary Table": EMPTY[0]}
    uc.update(extra)
    return uc


def _q3_drop_all(obj, ucs):
    dropped = [(uc, f"Q3_R20_EMPTY_PRIMARY_TABLE:{uc['Primary Table']}") for uc in ucs]
    kept, removed, below = obj._keep_below_bar("Q3", list(ucs), [], dropped)
    return kept, removed, below


def test_q3_empty_table_drops_stay_below_the_bar_with_a_plain_reason(agent_ns):
    obj = _inspire(agent_ns)
    ucs = [_uc(f"U{i:02d}") for i in range(48)]
    kept, removed, below = _q3_drop_all(obj, ucs)
    assert [u["No"] for u in kept] == [u["No"] for u in ucs] and removed == [] and len(below) == 48
    assert all(u["below_bar_gate"].startswith("Q3_R20_EMPTY_PRIMARY_TABLE") for u in kept)
    assert EMPTY[0] in kept[0]["below_bar_reason"] and "no rows yet" in kept[0]["below_bar_reason"]
    assert any("[BELOW-BAR FIRED] Q3: 48 use cases stay below the bar" in m for _lvl, m in obj.logger.records)


def test_invented_columns_rule_stays_removed(agent_ns):
    obj = _inspire(agent_ns)
    bad, empty = _uc("U1"), _uc("U2")
    kept, removed, below = obj._keep_below_bar(
        "Q3", [bad, empty], [], [(bad, "UC_NOT_RELEVANT:R13_INVENTED_COLUMNS"), (empty, "Q3_R20_EMPTY_PRIMARY_TABLE:x")])
    assert [u["No"] for u in kept] == ["U2"] and [u["No"] for u, _r in removed] == ["U1"] and below == [empty]
    assert "below_bar_gate" not in bad


def test_only_q3_and_q5_route_drops_below_the_bar_while_q1_and_q2_still_remove():
    src = ast.unparse(method_node("DatabricksInspire", "_phaseQ_run_integrity_gates"))
    gates = [line.split("_keep_below_bar(")[1].split(",")[0] for line in src.splitlines() if "_keep_below_bar(" in line]
    assert gates == ["'Q3'", "'Q5'"]
    q1 = src.index("_phaseQ1_validate_grounding")
    q2 = src.index("_phaseQ2_canonical_dedup")
    first_keep = src.index("_keep_below_bar(")
    assert q1 < first_keep and q2 < first_keep


@pytest.mark.parametrize("method,gate", [("_phaseQ3_validate_relevance", "Q3 RELEVANCE"),
                                         ("_phaseQ5_decision_readiness", "Q5 DECISION_READINESS")])
def test_the_gates_whose_failures_stay_below_the_bar_never_log_them_as_dropped(method, gate):
    src = ast.unparse(method_node("DatabricksInspire", method))
    assert f"{gate}: dropped" not in src and "'  dropped " not in src and '"  dropped ' not in src, \
        "the run kept 49 of 49 below the bar while this gate logged 'dropped 49 of 49'"
    assert f"{gate} failed for" in src and "gate ledger" in src


def test_incident_replay_keeps_all_48_below_the_high_bar_and_warns(agent_ns):
    obj = _inspire(agent_ns, empty=EMPTY, full=["airline_std.passenger.bookings"])
    ucs = [_uc(f"U{i:02d}", inspire=8.0 - i / 100) for i in range(48)]
    kept, _removed, _below = _q3_drop_all(obj, ucs)
    final, rejected = obj._select_scored_use_cases(kept, [], {})
    assert len(final) == 48 and rejected is not None
    assert all(u["meets_quality_bar"] == "N" and u["elite_status"] == "FALLBACK_BELOW_BAR" for u in final)
    assert all("no rows yet" in u["fallback_reason"] for u in final)
    outcome = obj.quality_bar_outcome
    assert (outcome["found"], outcome["meets"], outcome["below"]) == (48, 0, 48)
    assert outcome["message"].startswith("None of the 48 use cases found meets your High bar. Here is what we found")
    assert outcome["empty_tables"] == sorted(EMPTY) and outcome["all_tables_empty"] is False
    assert "grounded in rows" not in outcome["message"]
    assert "Generate data page" in outcome["message"] and EMPTY[0] in outcome["message"]
    warning = obj._quality_bar_warning()
    assert warning.startswith("0 of 48 use cases meet your High bar; 12 tables have no rows yet: ")
    assert "and 2 more" in warning
    steps = [e for e in obj.emitted if e.get("step_name") == "Quality Bar"]
    assert steps and steps[-1]["status"] == "ended_warning"
    assert obj._selection_is_fallback is True


def test_incident_replay_exit_value_and_results_carry_the_warning(agent_ns):
    obj = _inspire(agent_ns, empty=EMPTY[:2], full=["airline_std.passenger.bookings"])
    kept, _r, _b = _q3_drop_all(obj, [_uc(f"U{i:02d}") for i in range(48)])
    obj._select_scored_use_cases(kept, [], {})
    obj.failed_steps, obj.translation_gaps = [], {}
    obj._metadata_unavailable_report = lambda: {"tables": []}
    exit_value = obj.run_exit_value()
    assert exit_value.startswith("Completed: 0 of 48 use cases meet your High bar; 2 tables have no rows yet")
    results = obj._merge_run_outcome_into_results()
    assert results["run_status"] == "warning" and results["run_message"] == exit_value
    assert obj._v130_results_keys()["quality_bar"]["meets"] == 0


@pytest.mark.parametrize("empty, note", [
    (EMPTY[:1], f"the only selected table, {EMPTY[0]}, is empty, so no use case can be grounded in rows"),
    (EMPTY[:3], f"every selected table is empty ({', '.join(EMPTY[:3])}), so no use case can be grounded in rows"),
])
def test_every_selected_table_empty_still_warns_and_says_no_use_case_can_be_grounded(agent_ns, empty, note):
    obj = _inspire(agent_ns, empty=empty)
    kept, _r, _b = _q3_drop_all(obj, [_uc(f"U{i:02d}") for i in range(6)])
    final, _rejected = obj._select_scored_use_cases(kept, [], {})
    assert len(final) == 6, "an all-empty run still keeps its use cases below the bar instead of stopping"
    outcome = obj.quality_bar_outcome
    assert outcome["all_tables_empty"] is True
    assert f". {note[:1].upper()}{note[1:]}. Add sample rows on the Generate data page" in outcome["message"]
    warning = obj._quality_bar_warning()
    assert warning == f"0 of 6 use cases meet your High bar; {note}; add sample rows on the Generate data page of the Inspire App, then run again"
    assert "no rows yet" not in warning
    steps = [e for e in obj.emitted if e.get("step_name") == "Quality Bar"]
    assert steps and steps[-1]["status"] == "ended_warning"


def test_no_empty_table_is_never_called_all_empty(agent_ns):
    obj = _inspire(agent_ns, full=["airline_std.passenger.bookings"])
    assert obj._all_scanned_tables_empty([]) is False
    obj = _inspire(agent_ns)
    assert obj._all_scanned_tables_empty([]) is False


def test_mixed_run_puts_meets_first_and_marks_the_rest(agent_ns):
    obj = _inspire(agent_ns)
    ucs = [_uc("M1", "Medium", 9.0), _uc("H1", "High", 7.0), _uc("M2", "Medium", 8.0), _uc("H2", "Very High", 8.5),
           _uc("L1", "Low", 9.5)]
    final, _rejected = obj._select_scored_use_cases(ucs, [], {})
    flags = [(u["No"], u["meets_quality_bar"]) for u in final]
    assert [f for f in flags if f[1] == "Y"] == flags[:2] and {n for n, _ in flags[:2]} == {"H1", "H2"}
    assert {n for n, m in flags if m == "N"} == {"M1", "M2", "L1"}
    below = {u["No"]: u for u in final if u["meets_quality_bar"] == "N"}
    assert below["M1"]["fallback_reason"] == "scored Medium, below the High bar"
    outcome = obj.quality_bar_outcome
    assert outcome["message"] == "2 of 5 use cases found meet your High bar"
    assert obj._quality_bar_warning() == "" and obj._selection_is_fallback is False
    assert [e for e in obj.emitted if e.get("step_name") == "Quality Bar"][-1]["status"] == "ended_success"


def test_all_meet_means_no_notice_and_no_warning(agent_ns):
    obj = _inspire(agent_ns)
    final, _ = obj._select_scored_use_cases([_uc("H1"), _uc("H2", "Very High")], [], {})
    assert all(u["meets_quality_bar"] == "Y" for u in final)
    assert obj._quality_bar_warning() == "" and obj._quality_bar_notice(final, {}, "English") == ""


def test_unscored_and_duplicates_stay_removed(agent_ns):
    obj = _inspire(agent_ns)
    unscored = _uc("X1", scoring_status="unscored")
    twin = dict(Name="Forecast passenger demand by route", **{"Analytics Technique": "Forecasting"})
    keep, dup = _uc("H1", **twin), _uc("X2", "Medium", **twin)
    final, rejected = obj._select_scored_use_cases([keep, _uc("M1", "Medium"), unscored, dup], [], {})
    assert {u["No"] for u in final} == {"H1", "M1"}
    assert {"X1", "X2"} <= {u["No"] for u in rejected}
    assert dup["selection_removed"] == "duplicate" and "Forecast passenger demand by route" in dup["selection_drop_reason"]


def test_duplicate_fatal_flaw_is_removed_not_below_bar(agent_ns):
    cls = agent_ns["DatabricksInspire"]
    dup = _uc("D1", elite_assessment={"fatal_flaws": [{"category": "DUPLICATE_OF_ANOTHER_USE_CASE"}]})
    assert cls._is_removed_not_below_bar(dup) is True
    assert cls._is_removed_not_below_bar(_uc("K1")) is False
    assert cls._is_removed_not_below_bar(_uc("K2", selection_removed="user_count")) is True


def test_user_count_is_never_undercut_and_a_requested_use_case_is_kept(agent_ns):
    obj = _inspire(agent_ns, count={"count": 3, "mode": "at most"})
    ucs = [_uc("H1"), _uc("M1", "Medium", 9.0), _uc("M2", "Medium", 8.0), _uc("M3", "Medium", 7.0),
           _uc("M4", "Medium", 1.0, user_request="R1")]
    final, _ = obj._select_scored_use_cases(ucs, [], {})
    names = [u["No"] for u in final]
    assert len(final) == 3 and names[0] == "H1" and "M4" in names
    assert any("[USE-CASE-COUNT FIRED]" in m for _lvl, m in obj.logger.records)


def test_no_user_count_keeps_every_below_bar_use_case(agent_ns):
    obj = _inspire(agent_ns)
    final, _ = obj._select_scored_use_cases([_uc(f"M{i}", "Medium") for i in range(30)], [], {})
    assert len(final) == 30 and all(u["meets_quality_bar"] == "N" for u in final)


def test_best_of_best_never_marks_a_below_bar_use_case(agent_ns):
    src = ast.unparse(method_node("DatabricksInspire", "_mark_best_of_best"))
    assert "meets_quality_bar" in src


def test_tracking_table_and_json_carry_the_flag_and_reason(agent_ns):
    fields = {name: (source, kind) for name, source, kind in agent_ns["DatabricksInspire"]._V130_TRACKING_FIELDS}
    assert fields["meets_quality_bar"] == ("meets_quality_bar", "text")
    assert fields["below_bar_reason"] == ("fallback_reason", "text")
    assert "quality_bar" in agent_ns["DatabricksInspire"]._V130_CATALOG_KEYS


def test_document_notice_reads_none_of_n_and_k_of_n(agent_ns):
    obj = _inspire(agent_ns)
    below = [_uc(f"M{i}", "Medium", elite_status="FALLBACK_BELOW_BAR", quality_mode="High") for i in range(48)]
    notice = obj._quality_bar_notice(below, {}, "English")
    assert notice.startswith("None of the 48 use cases found meets your") and "Here is what we found" in notice
    mixed = [_uc("H1", quality_mode="High")] + below[:3]
    assert obj._quality_bar_notice(mixed, {}, "English").startswith("1 of 4 use cases found meet")


def test_every_curated_language_translates_the_new_labels_with_placeholders(agent_ns):
    cls = agent_ns["TranslationService"]
    languages = sorted(cls.TRANSLATION_FALLBACKS)
    assert len(languages) >= 22
    for language in languages:
        table = cls._curated_ui_translations(language)
        assert table is not None, language
        assert table["doc_meets_bar"].strip(), language
        for key, names in (("doc_fallback_notice", ("{total}", "{mode}")),
                           ("doc_bar_partial_notice", ("{meets}", "{total}", "{mode}"))):
            assert all(n in table[key] for n in names), (language, key)
    english = cls.ENGLISH_TRANSLATIONS
    assert english["doc_meets_bar"] == "Meets your quality bar"
    assert english["doc_fallback_notice"].startswith("None of the {total} use cases found meets your {mode} bar")


def test_export_columns_include_the_meets_bar_column():
    src = ast.unparse(method_node("DatabricksInspire", "_export_columns"))
    assert "label('doc_meets_bar')" in src and "_meets_quality_bar(uc)" in src


class _FinalWriter:
    def __init__(self):
        self.steps, self.finals = [], []

    def emit_step(self, **kw):
        self.steps.append(kw)
        return len(self.steps)

    def record_results(self, results):
        return True

    def finalize_pipeline(self, **kw):
        self.finals.append(kw)


def _offline_run(agent_ns, tmp_path, label, empty, full=()):
    from v120_run_offline_smoke_test import _build

    def scorer(uc_id):
        return {"use_case_id": uc_id, "quality_label": label, "quality_score": 3.0, "priority_score": 5.0,
                "quality_summary": "Columns `id` and `amount` aggregated by store give the KPI that drives the outcome."}

    obj = _build(agent_ns, tmp_path, "High", HIGH, scorer)
    obj._collect_discovery_evidence = lambda _details: setattr(
        obj, "discovery_evidence", {"profiles": {**{fqn: {"rows": 0} for fqn in empty}, **{fqn: {"rows": 9} for fqn in full}}})
    obj.run()
    obj.atomic_writer = _FinalWriter()
    obj.finalize_atomic_writer(success=True)
    return obj


@pytest.mark.parametrize("label, empty, status, meets", [
    ("Medium", ["cat.sch.orders", "cat.sch.items"], "ended_warning", 0),
    ("High", ["cat.sch.orders", "cat.sch.items"], "ended_success", 4),
    ("High", [], "ended_success", 4),
])
def test_run_ends_as_a_warning_naming_the_empty_tables_only_when_none_meets_the_bar(
        agent_ns, tmp_path, quiet_root_logger, label, empty, status, meets):
    obj = _offline_run(agent_ns, tmp_path, label, empty, full=["cat.sch.stores"])
    final = obj.recorded["tracking"][-1]
    assert len(final) == 4 and sum(u["meets_quality_bar"] == "Y" for u in final) == meets
    assert [f["status"] for f in obj.atomic_writer.finals] == [status]
    message = obj.atomic_writer.finals[0]["message"]
    results = obj.final_inspire_results_json
    if status == "ended_warning":
        assert message.startswith("Completed: 0 of 4 use cases meet your High bar; 2 tables have no rows yet: "
                                  "cat.sch.items, cat.sch.orders; add sample rows on the Generate data page")
        assert results["run_status"] == "warning" and results["run_message"] == message
        assert results["quality_bar"]["empty_tables"] == ["cat.sch.items", "cat.sch.orders"]
        assert all("below the High bar" in u["fallback_reason"] for u in final)
    else:
        assert message == "Completed" and results["run_status"] == "success" and results["run_message"] == ""
        assert results["quality_bar"]["meets"] == 4 and "no rows yet" not in results["quality_bar"]["message"]


@pytest.fixture
def quiet_root_logger():
    import logging
    root = logging.getLogger()
    saved = (list(root.handlers), root.level)
    yield
    root.handlers[:] = saved[0]
    root.setLevel(saved[1])


def test_results_json_round_trip_keeps_the_flag(agent_ns):
    obj = _inspire(agent_ns)
    final, _ = obj._select_scored_use_cases([_uc("H1"), _uc("M1", "Medium")], [], {})
    dumped = json.loads(json.dumps(final, default=str))
    assert {u["No"]: u["meets_quality_bar"] for u in dumped} == {"H1": "Y", "M1": "N"}
