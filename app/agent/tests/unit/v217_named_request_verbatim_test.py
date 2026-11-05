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
