import ast

from _agentload import method_node
from v120_artifacts_support import make_inspire

NAMED = "Predict late deliveries by region."
KIND = {"id": "R1", "ask": "forecasting use cases", "minimum": 3}
ASK = {"id": "R2", "ask": "late delivery prediction by region", "minimum": 1, "name": f"  {NAMED.replace(' ', '   ', 1)} "}


def _inspire(agent_ns, requests=(KIND, ASK), **attrs):
    parsed = {"use_case_requests": list(requests), "per_prompt_instructions": {}, "interpretation_status": "ok"}
    inst = make_inspire(agent_ns, parsed_generation_instructions=parsed, user_business_domains=[], **attrs)
    inst._emit_pipeline_status = lambda **_kw: None
    return inst


def _uc(no, name, score, request="", domain="Operations"):
    uc = {"No": no, "Name": name, "usecase": name, "Business Domain": domain, "Analytics Technique": "Classification",
          "Inspire Score": score, "Priority": 7.0, "Quality": "High", "scoring_status": "scored"}
    if request:
        uc["user_request"] = request
    return uc


def _messages(inst, level=None):
    return [msg for lvl, msg in inst.logger.records if level is None or lvl == level]


def test_the_parser_keeps_the_name_word_for_word_and_a_kind_request_has_no_name(agent_ns):
    requests = agent_ns["parse_use_case_requests"]([KIND, ASK, {"ask": "a churn model", "name": "x" * 300}])
    assert requests["R1"]["name"] == ""
    assert requests["R2"]["name"] == NAMED
    assert requests["R3"]["name"] == "x" * 200
    assert set(requests["R2"]) == {"id", "ask", "minimum", "name"}


def test_the_interpreter_asks_for_the_name_of_one_named_use_case(agent_ns):
    prompt = agent_ns["PROMPT_TEMPLATES"]["GENERAL_INSTRUCTION_INTERPRETER_PROMPT"]
    section = prompt.split("**10. Requested Use Cases**", 1)[1].split("**11.", 1)[0]
    assert '"name"' in section and "word for word" in section
    example = prompt.split('"use_case_requests": [', 1)[1].split("]", 1)[0]
    assert '"name": ""' in example and '"name": "' in example.replace('"name": ""', "", 1)


def test_the_scorer_sees_the_name_the_user_gives(agent_ns):
    section = _inspire(agent_ns)._get_generation_instruction_for_prompt("COMBINED_VALUE_QUALITY_SCORE_PROMPT")
    assert f'REQUESTED USE CASES R2: late delivery prediction by region (at least 1), the use case named "{NAMED}"' in section
    assert "REQUESTED USE CASES R1: forecasting use cases (at least 3);" in section


def test_the_strongest_member_takes_the_user_name_at_the_pin(agent_ns):
    inst = _inspire(agent_ns)
    weak = _uc("U2", "Flag shipments at risk of running late", 7.0, "R2")
    strong = _uc("U1", "Cut late deliveries to raise on-time rate", 9.0, "R2")
    kind = _uc("U3", "Forecast weekly demand by store", 8.5, "R1")
    other = _uc("U4", "Rank suppliers by defect cost", 8.0)
    use_cases = [weak, strong, kind, other]
    assert inst._pin_user_named_use_cases(use_cases) is use_cases
    assert strong["Name"] == NAMED and strong["usecase"] == NAMED and strong["user_named"] == NAMED
    assert weak["Name"] == "Flag shipments at risk of running late" and "user_named" not in weak
    assert kind["Name"] == "Forecast weekly demand by store" and other["Name"] == "Rank suppliers by defect cost"
    assert any("[NAMED-REQUEST FIRED]" in m and "Cut late deliveries to raise on-time rate" in m for m in _messages(inst, "INFO"))
    assert not inst.unserved_use_case_requests and not inst._run_outcome_warnings()


def test_a_member_already_named_by_the_user_keeps_it_and_no_name_is_doubled(agent_ns):
    inst = _inspire(agent_ns)
    strong = _uc("U1", "Cut late deliveries to raise on-time rate", 9.0, "R2")
    named = _uc("U2", NAMED.lower(), 6.0, "R2")
    inst._pin_user_named_use_cases([strong, named])
    assert named["Name"] == NAMED and strong["Name"] == "Cut late deliveries to raise on-time rate"
    assert sum(uc["Name"] == NAMED for uc in (strong, named)) == 1


def test_rewrite_steps_keep_a_pinned_name_word_for_word(agent_ns):
    inst = _inspire(agent_ns)
    uc = _uc("U1", "Cut late deliveries with route planning", 9.0, "R2")
    inst._pin_user_named_use_cases([uc])
    title_cased = inst._normalize_usecase(uc["usecase"], uc["Name"])
    assert title_cased != NAMED
    assert inst._doc_use_case_title(uc, "English") == NAMED
    assert agent_ns["TranslationService"]._derived_sources(uc)["Headline"] == NAMED
    row = agent_ns["DatabricksInspire"]._uc_to_row(uc, 4242, inst._normalize_usecase)
    assert row[4] == NAMED and row[5] == NAMED
    assert inst._selection_flags(uc)["user_named"] == NAMED
    translated = dict(uc, Name="Translated name", usecase="Translated headline")
    assert inst._doc_use_case_title(translated, "English") != NAMED


def test_no_member_warns_and_the_run_summary_names_the_missing_use_case(agent_ns):
    inst = _inspire(agent_ns)
    use_cases = [_uc("U1", "Forecast weekly demand by store", 8.5, "R1"), _uc("U2", "Rank suppliers by defect cost", 8.0)]
    inst._pin_user_named_use_cases(use_cases)
    assert [uc["Name"] for uc in use_cases] == ["Forecast weekly demand by store", "Rank suppliers by defect cost"]
    warned = [m for m in _messages(inst, "WARNING") if "[NAMED-REQUEST]" in m]
    assert len(warned) == 1 and "R2" in warned[0] and NAMED in warned[0]
    assert inst.unserved_use_case_requests == [{"id": "R2", "ask": "late delivery prediction by region", "name": NAMED}]
    assert any(NAMED in w for w in inst._run_outcome_warnings())


def test_a_kind_request_alone_renames_nothing(agent_ns):
    inst = _inspire(agent_ns, requests=(KIND,))
    uc = _uc("U1", "Forecast weekly demand by store", 8.5, "R1")
    inst._pin_user_named_use_cases([uc])
    assert uc["Name"] == "Forecast weekly demand by store" and "user_named" not in uc
    assert not [m for m in _messages(inst, "WARNING") if "[NAMED-REQUEST]" in m]


def test_signature_dedup_keeps_the_request_tag_on_the_survivor(agent_ns):
    inst = _inspire(agent_ns)
    loser = _uc("U2", "Flag shipments at risk of running late", 6.0, "R2")
    winner = _uc("U1", "Cut late deliveries to raise on-time rate", 9.0)
    for uc in (loser, winner):
        uc.update({"Tables Involved": "cat.sch.shipments", "Solution": "Score each shipment."})
    inst._uc_dedup_signature = lambda uc: ("decision", frozenset(), frozenset({"cat.sch.shipments"}), "classification")
    kept, merged = inst._dedup_by_signature([loser, winner], "duplicate decision", rank=inst._final_rank_key)
    assert kept == [winner] and merged and winner["user_request"] == "R2"


def test_the_review_keep_list_never_drops_the_last_member_of_a_request(agent_ns):
    inst = _inspire(agent_ns)
    member = _uc("U2", "Flag shipments at risk of running late", 6.0, "R2")
    other = _uc("U1", "Rank suppliers by defect cost", 9.0)
    kept = inst._parse_dedup_response("No\nU1\n", [other, member], "test review")
    assert kept == [other, member]
    assert any("[DEDUP-REQUEST]" in m and "R2" in m for m in _messages(inst))


def test_elite_decision_twins_keep_the_request_tag_on_the_survivor(agent_ns):
    inst = _inspire(agent_ns)
    loser = _uc("U2", "Flag shipments at risk of running late", 6.0, "R2")
    winner = _uc("U1", "Cut late deliveries to raise on-time rate", 9.0)
    inst._elite_twin_keys = lambda uc: ["same"]
    inst._elite_decision_identity = lambda uc: ()
    inst._are_elite_decision_twins = lambda a, b: False
    kept, twins = inst._collapse_elite_decision_twins([loser, winner])
    assert kept == [winner] and twins[id(loser)] is winner and winner["user_request"] == "R2"


def test_the_pin_runs_after_the_last_drop_and_before_the_catalog_is_written(agent_ns):
    source = ast.unparse(method_node("DatabricksInspire", "run"))
    drop = source.index("final_consolidated_use_cases = self._drop_low_stake_use_cases(final_consolidated_use_cases)")
    pin = source.index("self._pin_user_named_use_cases(final_consolidated_use_cases)")
    order = source.index("final_consolidated_use_cases = self._finalize_portfolio_order(final_consolidated_use_cases)")
    csv = source.index("self._generate_csv_catalog('English', lang_abbr_en, english_grouped_data)")
    assert drop < pin < order < csv
    assert source.count("self._pin_user_named_use_cases(") == 1


SCHEMA = [("cat", "sch", "shipments", "delivery_date", "date", ""), ("cat", "sch", "shipments", "region_id", "bigint", ""),
          ("cat", "sch", "regions", "region_name", "string", ""), ("cat", "sch", "suppliers", "defect_cost", "double", "")]


def _generator(inst, generated=None, error=None):
    calls = []

    def generate(columns, batch_num, **kwargs):
        calls.append({"columns": columns, "batch_num": batch_num, **kwargs})
        if error is not None:
            raise error
        return [dict(uc) for uc in (generated or [])]

    inst._process_batch_with_retry = generate
    inst._phaseG_run_quality_gates = lambda ucs, _schema: list(ucs)
    inst._phaseQ_run_integrity_gates = lambda ucs, _schema: list(ucs)

    def score(use_cases, full_schema_details, **_kw):
        for uc in use_cases:
            uc.update({"scoring_status": "scored", "Quality": "Good", "Quality Score": 3.0, "Priority": 6.0})
            uc.pop("user_request", None)
        return use_cases

    inst._score_combined_value_and_quality = score
    return calls


def test_an_unserved_named_request_is_generated_scored_tagged_and_then_named(agent_ns):
    inst = _inspire(agent_ns, merged_business_context={"business_context": "We ship parcels.", "industry": "Logistics"})
    calls = _generator(inst, [{"No": "N1", "Name": "Cut late deliveries", "Business Domain": "",
                               "Tables Involved": "cat.sch.shipments, cat.sch.regions"}])
    existing = [_uc("U1", "Rank suppliers by defect cost", 8.0), _uc("U2", "Forecast weekly demand by store", 8.5, "R1")]
    for uc in existing:
        uc["Tables Involved"] = "cat.sch.shipments"
    out = inst._inject_unserved_named_requests(existing, SCHEMA, {})
    assert len(calls) == 1 and len(out) == 3 and out[:2] == existing
    injected = out[2]
    assert injected["user_request"] == "R2" and injected["injected_for_request"] == "R2" and injected["scoring_status"] == "scored"
    assert injected["Inspire Score"] is not None and injected["Business Domain"] == "Operations"
    call = calls[0]
    assert NAMED in call["previous_use_cases_feedback"] and "EXACTLY ONE" in call["previous_use_cases_feedback"]
    assert call["business_context"] == "We ship parcels." and call["industry"] == "Logistics"
    assert {c[2] for c in call["columns"][:3]} == {"shipments", "regions"}
    assert any("[NAMED-REQUEST-INJECT FIRED]" in m for m in _messages(inst, "INFO"))
    inst._pin_user_named_use_cases(out)
    assert injected["Name"] == NAMED and not inst.unserved_use_case_requests


def test_no_injection_when_a_member_already_serves_the_named_request(agent_ns):
    inst = _inspire(agent_ns)
    calls = _generator(inst, [{"No": "N1", "Name": "x", "Tables Involved": "cat.sch.shipments"}])
    existing = [_uc("U1", "Cut late deliveries", 8.0, "R2")]
    assert inst._inject_unserved_named_requests(existing, SCHEMA, {}) == existing
    assert calls == []


def test_a_kind_request_without_a_name_is_never_injected(agent_ns):
    inst = _inspire(agent_ns, requests=(KIND,))
    calls = _generator(inst, [{"No": "N1", "Name": "x", "Tables Involved": "cat.sch.shipments"}])
    assert inst._inject_unserved_named_requests([], SCHEMA, {}) == [] and calls == []


def test_a_failed_injection_warns_and_the_run_summary_still_names_the_missing_use_case(agent_ns):
    inst = _inspire(agent_ns)
    _generator(inst, error=RuntimeError("model endpoint unavailable"))
    existing = [_uc("U1", "Rank suppliers by defect cost", 8.0)]
    out = inst._inject_unserved_named_requests(existing, SCHEMA, {})
    assert out == existing
    failed = [m for m in _messages(inst, "WARNING") if "[NAMED-REQUEST-INJECT]" in m]
    assert len(failed) == 1 and NAMED in failed[0] and "model endpoint unavailable" in failed[0]
    inst._pin_user_named_use_cases(out)
    assert inst.unserved_use_case_requests[0]["id"] == "R2"
    assert any(NAMED in w for w in inst._run_outcome_warnings())


def test_an_injected_use_case_the_gates_remove_or_the_scorer_drops_is_a_failed_injection(agent_ns):
    inst = _inspire(agent_ns)
    _generator(inst, [{"No": "N1", "Name": "x", "Tables Involved": "cat.sch.shipments"}])
    inst._phaseQ_run_integrity_gates = lambda ucs, _schema: []
    assert inst._inject_unserved_named_requests([], SCHEMA, {}) == []
    inst._phaseQ_run_integrity_gates = lambda ucs, _schema: list(ucs)
    inst._score_combined_value_and_quality = lambda use_cases, full_schema_details, **_kw: [
        dict(uc, scoring_status="unscored") for uc in use_cases]
    assert inst._inject_unserved_named_requests([], SCHEMA, {}) == []
    assert len([m for m in _messages(inst, "WARNING") if "[NAMED-REQUEST-INJECT]" in m]) == 2


def test_a_generation_without_tables_is_a_failed_injection(agent_ns):
    inst = _inspire(agent_ns)
    _generator(inst, [{"No": "N1", "Name": "x", "Tables Involved": ""}])
    assert inst._inject_unserved_named_requests([], SCHEMA, {}) == []
    assert any("[NAMED-REQUEST-INJECT]" in m for m in _messages(inst, "WARNING"))


def test_the_injection_runs_after_scoring_and_before_selection(agent_ns):
    source = ast.unparse(method_node("DatabricksInspire", "run"))
    scores = source.index("self._apply_inspire_scores(final_consolidated_use_cases)")
    inject = source.index("final_consolidated_use_cases = self._inject_unserved_named_requests(final_consolidated_use_cases, "
                          "_schema_for_quality, scoring_context)")
    select = source.index("self._select_scored_use_cases(")
    assert scores < inject < select and source.count("self._inject_unserved_named_requests(") == 1


def test_the_catch_all_and_the_injection_share_one_generation_context(agent_ns):
    source = ast.unparse(method_node("DatabricksInspire", "_retry_missing_table_coverage"))
    assert "self._generation_context()" in source and "merged_business_context" not in source
