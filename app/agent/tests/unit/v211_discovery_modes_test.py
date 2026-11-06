"""Standard Discovery and AI Enhanced Discovery.

1. Both modes read aggregates of the data to decide each use case; the old values Standard and Deep map to the new names.
2. Under Standard Discovery no measured value reaches an AI prompt: evidence passes the gate and every prompt is masked,
   and the reply gets the measured numbers back.
3. A use case short of a hard minimum is dropped with its measured shortfall, and a use case the instructions ask for is
   kept with the reason.
4. A build counts first: a shortfall goes to Genie with the measured numbers before it starts, a minimum the user set is
   never changed, and the user is told in plain words.
5. A decision use case must name a measurable outcome it moves; informational kinds are exempt and labelled.
"""
import json
import os
import sys
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v120_artifacts_support import FakeSpark, make_inspire, make_uc  # noqa: E402
from v120_genie_support import StatusRecorder, build_inspire  # noqa: E402
from v153_signal_check_test import SALES, Agent, Loader, answer, uc  # noqa: E402
from v206_genie_self_repair_test import SHORT_A, _family, _FakeRunner, _fill, _flow_inspire, _spec, _stopped  # noqa: E402
from v120_modes_widgets_test import FakeWidgets, run_cells  # noqa: E402

KEY = (5150, "N01-U01", 3)
FEW = {"n": 1000, "outcome_values": 2, "positives": 11, "sd0": 2.0, "p0": 5.0, "q0": 3.0}
MANY = {"n": 5000, "outcome_values": 2, "positives": 900, "sd0": 2.0, "p0": 5.0, "q0": 3.0}
FEW_TEXT = "History holds too few past examples of the outcome (11); at least 200 are needed to learn from."
PROFILE = {SALES: {"rows": 48213, "sampled": False,
                   "columns": {"sales_price": {"min": "2021-03-04", "max": "2026-09-30", "null_share": 0.97,
                                               "top_values": [{"value": "Gold", "share": 0.37}]}}}}
JOIN = {"child_table": SALES, "child_column": "item_sk", "parent_table": SALES, "parent_column": "ticket_number", "rate": 0.43}


def churn(uc_id="N01-U01", **extra):
    return dict(uc(uc_id, "Classification"), **extra)


def roles(*ids):
    return {"results": [answer(i, {"outcome": "is_return", "signals": ["net_profit"]}) for i in ids]}


def outcome_rows(*rows):
    pending = list(rows)

    def respond(statement):
        if "AS outcome_values" in statement:
            return [pending.pop(0)]
        if statement.startswith("SELECT COUNT(*) AS n FROM"):
            return [{"n": 5000}]
        raise AssertionError(f"unexpected statement: {statement}")
    return respond


def inspire(agent_ns, mode, answers=(), responder=None, **attrs):
    spark = FakeSpark(responder=responder or (lambda s: (_ for _ in ()).throw(AssertionError(s))))
    agent = Agent(list(answers))
    inst = build_inspire(agent_ns, loader=Loader(), agent=agent, spark=spark, discovery_type=mode, deep_evidence=None)
    inst.logger = MagicMock()
    inst.discovery_evidence = {"profiles": {SALES: {"rows": 5000, "sampled": False, "columns": {}}}, "join_matches": [],
                               "data_access": {}}
    inst._emit_pipeline_status = StatusRecorder()
    inst.user_business_domains = []
    inst._implement_update = MagicMock()
    inst._implement_emit = MagicMock()
    for key, value in attrs.items():
        setattr(inst, key, value)
    return inst, agent, spark


def gated_agent(agent_ns, gate, replies):
    agent = agent_ns["AIAgent"].__new__(agent_ns["AIAgent"])
    agent.logger = MagicMock()
    agent._manager = MagicMock()
    agent._release_recovery_row = lambda *a, **k: None
    agent.ai_gate = gate
    sent = []
    agent._call_ai_query_impl = lambda prompt, *a: sent.append(prompt) or replies.pop(0)
    return agent, sent


def test_the_two_modes_and_the_legacy_values(agent_ns):
    canonical, sees = agent_ns["canonical_discovery_type"], agent_ns["discovery_ai_sees_aggregates"]
    assert agent_ns["DISCOVERY_TYPE_VALID"] == ("Standard Discovery", "AI Enhanced Discovery")
    assert agent_ns["DISCOVERY_TYPE_DEFAULT"] == "Standard Discovery"
    assert [canonical(v) for v in ("Standard", "deep", "Deep Discovery", "AI Enhanced", "", None, "standard discovery")] == [
        "Standard Discovery", "AI Enhanced Discovery", "AI Enhanced Discovery", "AI Enhanced Discovery", "Standard Discovery",
        "Standard Discovery", "Standard Discovery"]
    assert sees("Deep") and sees("AI Enhanced Discovery") and not sees("Standard") and not sees("")
    with pytest.raises(ValueError) as raised:
        canonical("Shallow")
    assert "'Standard Discovery', 'AI Enhanced Discovery'" in str(raised.value) and "'Deep' (mapped to 'AI Enhanced Discovery')" in str(raised.value)


@pytest.mark.parametrize("mode", ["Standard", "Standard Discovery", "Deep", "AI Enhanced Discovery"])
def test_both_modes_read_the_outcome_history_and_drop_the_11_outcome_use_case(agent_ns, mode):
    ucs = [churn("N01-U01"), churn("N01-U02")]
    inst, agent, spark = inspire(agent_ns, mode, [roles("N01-U01", "N01-U02")], outcome_rows(FEW, MANY))
    kept, dropped = inst._check_data_signal(ucs, [])
    assert [u["No"] for u in kept] == ["N01-U02"] and [u["No"] for u in dropped] == ["N01-U01"]
    assert dropped[0]["selection_drop_reason"] == f"the data shows no signal: {FEW_TEXT}"
    assert any("AS outcome_values" in s for s in spark.statements)
    assert inst.deep_evidence.summary()["aggregates_sent_to_ai"] is agent_ns["discovery_ai_sees_aggregates"](mode)
    assert "(11)" not in str(agent.calls[0]["vars"])


FEW_PAIRS = {"baskets": 300, "interactions": 743, "items": 150, "multi_item_baskets": 200, "supported_pairs": 30, "pair_lift": 1.9}
MANY_PAIRS = {"baskets": 2000, "interactions": 9000, "items": 300, "multi_item_baskets": 1800, "supported_pairs": 40, "pair_lift": 1.9}


def basket_rows(*rows):
    pending = list(rows)

    def respond(statement):
        if "AS pair_lift" in statement:
            return [pending.pop(0)]
        raise AssertionError(f"unexpected statement: {statement}")
    return respond


@pytest.mark.parametrize("mode", ["Standard", "Standard Discovery", "Deep", "AI Enhanced Discovery"])
def test_both_modes_drop_the_743_of_1000_interactions_use_case_at_discovery(agent_ns, mode):
    ucs = [uc("N01-U01", "Recommendation"), uc("N01-U02", "Recommendation")]
    answers = [{"results": [answer(i, {"basket": "ticket_number", "item": "item_sk"}) for i in ("N01-U01", "N01-U02")]}]
    inst, agent, _spark = inspire(agent_ns, mode, answers, basket_rows(FEW_PAIRS, MANY_PAIRS))
    kept, dropped = inst._check_data_signal(ucs, [])
    assert [u["No"] for u in kept] == ["N01-U02"] and [u["No"] for u in dropped] == ["N01-U01"]
    assert dropped[0]["selection_drop_reason"] == ("the data shows no signal: There are too few past interactions (743); at least "
                                                   "1000 are needed to learn preferences.")
    assert "743" not in str(agent.calls[0]["vars"])


def test_standard_keeps_a_must_have_use_case_short_of_the_minimum_with_its_reason(agent_ns):
    ucs = [churn("N01-U01", user_request="R1"), churn("N01-U02")]
    inst, _agent, _spark = inspire(agent_ns, "Standard Discovery", [roles("N01-U01", "N01-U02")], outcome_rows(FEW, FEW))
    inst._user_use_case_requests = lambda: {"R1": {"id": "R1", "ask": "a churn model", "minimum": 1}}
    kept, dropped = inst._check_data_signal(ucs, [])
    assert [u["No"] for u in kept] == ["N01-U01"] and [u["No"] for u in dropped] == ["N01-U02"]
    record = ucs[0]["data_signal"]
    assert record["status"] == "no_signal" and record["data_reason"] == FEW_TEXT
    assert record["reason"] == (f"The data shows no signal: {FEW_TEXT} Inspire kept it because the instructions ask for a churn "
                                "model (at least 1) and only 0 of 1 such use case are kept on the data, so it ships with thin data.")


def test_standard_keeps_the_strongest_use_case_of_a_user_named_domain(agent_ns):
    ucs = [churn("N01-U01"), churn("N01-U02")]
    inst, _agent, _spark = inspire(agent_ns, "Standard Discovery", [roles("N01-U01", "N01-U02")], outcome_rows(FEW, FEW),
                                   user_business_domains=["Sales"])
    kept, dropped = inst._check_data_signal(ucs, [])
    assert len(kept) == 1 and len(dropped) == 1
    assert kept[0]["data_signal"]["reason"].endswith("Inspire kept it because it is the strongest use case of the business domain "
                                                     "Sales, which the business domains name.")


def test_no_measured_value_reaches_a_prompt_in_standard_and_the_reply_gets_it_back(agent_ns):
    ucs = [churn("N01-U01")]
    inst, _agent, _spark = inspire(agent_ns, "Standard Discovery", [roles("N01-U01")], outcome_rows(FEW))
    inst._check_data_signal(ucs, [])
    gate = inst._ai_gate()
    reason = ucs[0]["selection_drop_reason"]
    agent, sent = gated_agent(agent_ns, gate, ["La historia tiene muy pocos ejemplos (\u27e6M1\u27e7); se necesitan \u27e6M2\u27e7."])
    reply = agent._call_ai_query(f"Translate this reason:\n{reason}\nAnd as JSON: {{\"r\": {json.dumps(reason)}}}",
                                 "TRANSLATE_TEST")
    assert len(sent) == 1
    assert "11" not in sent[0] and "200" not in sent[0], "a measured number reached the prompt"
    assert "\u27e6M1\u27e7" in sent[0] and "Copy every placeholder exactly as written" in sent[0]
    assert reply == "La historia tiene muy pocos ejemplos (11); se necesitan 200."
    assert any(str(c.args[0]).startswith("[AI-GATE FIRED] TRANSLATE_TEST: 2 measured numbers withheld from the AI")
               for c in agent.logger.info.call_args_list)


def test_ai_enhanced_shares_the_measured_values_with_the_ai(agent_ns):
    ucs = [churn("N01-U01")]
    inst, _agent, _spark = inspire(agent_ns, "AI Enhanced Discovery", [roles("N01-U01")], outcome_rows(FEW))
    inst._check_data_signal(ucs, [])
    agent, sent = gated_agent(agent_ns, inst._ai_gate(), ["ok"])
    agent._call_ai_query(f"Reason: {ucs[0]['selection_drop_reason']}", "TRANSLATE_TEST")
    assert "(11); at least 200" in sent[0] and "\u27e6M" not in sent[0]


def test_the_gate_leaves_a_prompt_without_measured_text_untouched(agent_ns):
    gate = agent_ns["InspireAIGate"]("Standard Discovery")
    gate.register(FEW_TEXT, "no number here")
    assert gate.mask("Name the outcome column of N01-U01 in 2 words.") == ("Name the outcome column of N01-U01 in 2 words.", {})
    masked, values = gate.mask(f"x {FEW_TEXT} y")
    assert values == {"\u27e6M1\u27e7": "11", "\u27e6M2\u27e7": "200"} and "11" not in masked
    assert gate.measured() == [FEW_TEXT]


@pytest.mark.parametrize("mode,shared", [("Standard Discovery", False), ("AI Enhanced Discovery", True)])
def test_the_evidence_block_carries_profiles_only_in_ai_enhanced(agent_ns, mode, shared):
    inst, _agent, _spark = inspire(agent_ns, mode)
    inst.discovery_evidence = {"profiles": PROFILE, "join_matches": [JOIN], "history_joins": [], "data_access": {},
                               "metric_views": [{"fqn": "main.s.mv", "source": SALES, "measures": [{"name": "revenue", "expr": "SUM(x)"}]}],
                               "usage": {}}
    block, joins = inst._evidence_prompt_block([SALES])
    for measured in ("48213", "2021-03-04", "is 97% null", "Gold 37%", "43%"):
        assert (measured in block + " ".join(joins)) is shared, measured
    assert "metric view `main.s.mv`" in block
    context = inst._alignment_context({})
    assert context["profiles"] == PROFILE, "the KPI checks read the profiles in both modes; only the prompt is gated"


def test_standard_never_stores_kpi_baselines(agent_ns):
    inst, _agent, spark = inspire(agent_ns, "Standard Discovery", responder=lambda s: [{"v": 1.0}])
    inst.deep_evidence = agent_ns["DeepEvidence"](spark, "Standard Discovery", MagicMock())
    spec = {"computable": True, "query": "SELECT SUM(x) AS v FROM t", "name": "revenue"}
    stats = inst._measure_kpi_baselines([{"KPIs": [spec]}])
    assert stats["measured"] == 0 and spark.statements == [] and "baseline" not in spec


class _Stakes:
    max_kpi_baselines = 10

    def __init__(self, in_scope, total=1000.0):
        self.in_scope, self.total, self.calls = in_scope, total, []

    def measure_kpi(self, spec):
        self.calls.append(dict(spec))
        return self.in_scope[spec["filter_value"]] if spec.get("filter_value") else self.total


def _stake(no, region, **extra):
    return {"No": no, "Name": f"Grow {region} revenue", "Business Domain": "Sales", "bob_score": 7.0,
            "KPIs": [dict({"name": "Revenue", "table": "main.ops.orders", "aggregation": "SUM", "column": "amount",
                           "computable": True, "query": f"q{no}", "filter_column": "region", "filter_value": region}, **extra)]}


def _stake_inspire(agent_ns, mode, deep):
    inst = make_inspire(agent_ns, parsed_generation_instructions={}, user_business_domains=[], detected_kinds=[],
                        deep_evidence=deep, discovery_type=mode)
    inst._kind_floor_reasons = {}
    inst.logger = MagicMock()
    return inst


def test_standard_drops_a_use_case_the_data_shows_too_small_without_storing_or_sending_its_value(agent_ns):
    deep = _Stakes({"West": 5.0, "East": 500.0})
    inst = _stake_inspire(agent_ns, "Standard Discovery", deep)
    tiny, big = _stake("N01-U01", "West"), _stake("N01-U02", "East")
    kept = inst._drop_low_stake_use_cases([tiny, big])
    assert [u["No"] for u in kept] == ["N01-U02"]
    assert tiny["selection_drop_reason"].startswith("the value in scope is 0.50% of the business total")
    assert all("baseline" not in u["KPIs"][0] for u in (tiny, big))
    agent, sent = gated_agent(agent_ns, inst._ai_gate(), ["ok"])
    agent._call_ai_query(f"Explain: {tiny['selection_drop_reason']}", "TRANSLATE_TEST")
    assert "0.50%" not in sent[0] and "\u27e6M1\u27e7" in sent[0]


def test_standard_keeps_every_use_case_whose_share_clears_the_floor_or_cannot_be_measured(agent_ns):
    deep = _Stakes({"West": 50.0, "East": 500.0})
    inst = _stake_inspire(agent_ns, "Standard Discovery", deep)
    ucs = [_stake("N01-U01", "West"), _stake("N01-U02", "East"), _stake("N01-U03", "North", computable=False)]
    assert inst._drop_low_stake_use_cases(ucs) == ucs
    assert not any(call.get("filter_value") == "North" for call in deep.calls)


def test_standard_measures_at_most_the_kpi_baseline_cap_for_the_value_gate(agent_ns):
    deep = _Stakes({"West": 5.0, "East": 5.0})
    deep.max_kpi_baselines = 1
    inst = _stake_inspire(agent_ns, "Standard Discovery", deep)
    kept = inst._drop_low_stake_use_cases([_stake("N01-U01", "West"), _stake("N01-U02", "East"), _stake("N01-U03", "West")])
    assert [u["No"] for u in kept] == ["N01-U02", "N01-U03"]
    assert len([call for call in deep.calls if call.get("filter_value")]) == 1


def test_the_disclaimer_names_each_mode_and_what_the_ai_saw(agent_ns):
    ts = agent_ns["TranslationService"]
    inst, _agent, _spark = inspire(agent_ns, "Standard Discovery")
    t = dict(ts.ENGLISH_TRANSLATIONS)
    texts = {}
    for mode, read in (("Standard Discovery", 4), ("AI Enhanced Discovery", 4), ("Standard", 0), ("", 0)):
        _title, items = inst._doc_disclaimer({"discovery_type": mode, "tables_read": read, "language": "English", "tiers": {}}, t)
        texts[(mode, read)] = items[0]
    assert texts[("Standard Discovery", 4)].startswith("Standard Discovery: Inspire read aggregates from the tables in scope, 4 in")
    assert texts[("Standard Discovery", 4)].endswith("none of them was sent to the AI, which saw metadata only.")
    assert texts[("AI Enhanced Discovery", 4)].startswith("AI Enhanced Discovery: Inspire read aggregates")
    assert texts[("AI Enhanced Discovery", 4)].endswith("The AI also saw these aggregates, to sharpen each use case.")
    assert texts[("Standard", 0)] == t["doc_data_access_none"] and "read no customer data" in texts[("Standard", 0)]
    assert texts[("", 0)] == t["doc_method_1"]
    for language, fallback in ts.TRANSLATION_FALLBACKS.items():
        for key in ("doc_discovery_standard", "doc_discovery_ai_enhanced", "doc_data_access_mode", "doc_data_access_none",
                    "doc_data_access_read", "doc_data_access_kept", "doc_data_access_shared", "doc_kind_informational"):
            assert fallback.get(key), (language, key)
        assert "{mode}" in fallback["doc_data_access_mode"] and "{tables}" in fallback["doc_data_access_read"], language
    assert all("Deep" not in text for text in ts.ENGLISH_TRANSLATIONS.values() if isinstance(text, str))


def test_a_legacy_catalog_reads_back_under_the_new_names(agent_ns):
    inst, _agent, _spark = inspire(agent_ns, "Standard Discovery")
    inst._loaded_catalog_meta = {"discovery_type": "Deep", "data_access": {"tables_read_count": 3}}
    assert inst._doc_data_access() == ("AI Enhanced Discovery", 3)
    assert inst._v130_results_keys()["discovery_type"] == "AI Enhanced Discovery"
    inst._loaded_catalog_meta = {"discovery_type": "Standard", "data_access": {}}
    assert inst._doc_data_access() == ("Standard Discovery", 0)
    inst._loaded_catalog_meta = {"data_access": {}}
    assert inst._doc_data_access() == ("", 0)


@pytest.mark.parametrize("old,new", [("Deep", "AI Enhanced Discovery"), ("Standard", "Standard Discovery")])
def test_a_legacy_widget_value_is_migrated_to_its_new_name(agent_ns, monkeypatch, old, new):
    widgets = FakeWidgets({"03_discovery_type": ("dropdown", old, ["Deep", "Standard"])})
    deferred, after_cell_1 = run_cells(agent_ns, monkeypatch, widgets)
    assert "03_discovery_type" not in after_cell_1
    assert widgets.state["03_discovery_type"]["value"] == new
    assert widgets.state["03_discovery_type"]["choices"] == ["Standard Discovery", "AI Enhanced Discovery"]


def test_a_fresh_widget_defaults_to_standard_discovery(agent_ns, monkeypatch):
    widgets = FakeWidgets()
    run_cells(agent_ns, monkeypatch, widgets)
    assert widgets.state["03_discovery_type"]["value"] == "Standard Discovery"


SPEC_A = {"family": "A", "check": "outcome", "table": SALES, "roles": {"outcome": "is_return", "signals": ["net_profit"]},
          "outcome_kind": "boolean"}
CHOICES = ("Your choices: lower Minimum positive outcomes in the build settings so Genie builds a simpler method, Rebuild once the "
           "data has at least 200 past examples of the outcome, or build another use case the data supports.")


def stored(status="failed", positives=11, reason=FEW_TEXT, spec=SPEC_A):
    record = {"status": status, "check": "outcome", "family": "A", "reason": reason, "table": SALES,
              "measures": {"row_count": 1000, "positives": positives, "class_rate": positives / 1000},
              "columns": {"outcome": "is_return", "signals": ["net_profit"]}}
    return dict(record, spec=dict(spec)) if spec else record


def count_statements(spark):
    return [s for s in spark.statements if "AS outcome_values" in s]


def test_a_build_short_of_the_minimum_counts_again_and_sends_the_measured_numbers_to_genie_first(agent_ns):
    discovered = churn(data_signal=stored())
    inst, agent, spark = inspire(agent_ns, "Standard Discovery", responder=outcome_rows(FEW))
    status = {}
    inst._implement_data_minimum(KEY, {}, discovered, status)
    short = discovered["_implement_measured_short"]
    assert short["feedback"].startswith("\n\nInspire measured the data before you started: History holds too few past examples of "
                                        "the outcome (11); at least 200")
    assert "never one the measured 11 past examples of the outcome cannot meet" in short["feedback"]
    assert short["short"]["observed"] == "11" and short["repaired"]
    assert status["data"]["state"] == "short" and len(count_statements(spark)) == 1 and agent.calls == []
    told = inst._implement_emit.call_args.args
    assert told[1] == "Data minimum" and told[3] == "ended_warning"
    assert told[2].startswith(f"Inspire counted the data before Genie started: {FEW_TEXT} Genie builds with a method that is valid "
                              "at 11 past examples of the outcome instead of stopping")


def test_a_use_case_that_passed_discovery_is_caught_at_build_when_the_data_no_longer_meets_the_minimum(agent_ns):
    ucs = [churn("N01-U01")]
    inst, _agent, _spark = inspire(agent_ns, "Standard Discovery", [roles("N01-U01")], outcome_rows(MANY))
    kept, _dropped = inst._check_data_signal(ucs, [])
    assert kept and ucs[0]["data_signal"]["status"] == "passed"
    from_db = {k: v for k, v in json.loads(json.dumps(ucs[0])).items() if k != "data_signal"}
    assert from_db["Data Evidence"]["signal"]["spec"]["roles"] == SPEC_A["roles"]
    builder, agent, spark = inspire(agent_ns, "Standard Discovery", responder=outcome_rows(FEW))
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        builder._implement_data_minimum(KEY, {}, from_db, {}, adapt=False)
    assert str(raised.value) == f"{agent_ns['IMPLEMENT_DATA_MINIMUM_LEAD']}: {FEW_TEXT} {CHOICES}"
    assert len(count_statements(spark)) == 1 and agent.calls == []
    assert any("[DATA-MINIMUM RECOUNT] N01-U01: counted the data again before Genie started (outcome): failed, changed since "
               "discovery:" in str(c.args[0]) and "positives 900 -> 11" in str(c.args[0]) for c in builder.logger.info.call_args_list)


def test_a_use_case_short_at_discovery_builds_when_the_data_has_grown(agent_ns):
    discovered = churn(data_signal=stored())
    inst, agent, spark = inspire(agent_ns, "Standard Discovery", responder=outcome_rows(MANY))
    status = {}
    inst._implement_data_minimum(KEY, {}, discovered, status, adapt=False)
    assert status == {} and "_implement_measured_short" not in discovered and len(count_statements(spark)) == 1
    inst._implement_emit.assert_not_called()


def test_a_legacy_record_without_its_columns_asks_for_the_roles_and_counts_before_genie(agent_ns):
    discovered = churn(data_signal=stored(spec=None))
    inst, agent, spark = inspire(agent_ns, "Standard Discovery", [roles("N01-U01")], outcome_rows(MANY))
    inst._build_schema_details_from_use_cases = lambda use_cases: []
    status = {}
    inst._implement_data_minimum(KEY, {}, discovered, status, adapt=False)
    assert [c["prompt"] for c in agent.calls] == ["SIGNAL_CHECK_PROMPT"] and len(count_statements(spark)) == 1
    assert status == {}


def test_a_failed_count_at_build_falls_back_to_the_discovery_count_and_says_so(agent_ns):
    discovered = churn(data_signal=stored())
    inst, _agent, _spark = inspire(agent_ns, "Standard Discovery",
                                   responder=lambda s: (_ for _ in ()).throw(RuntimeError("PERMISSION_DENIED: no SELECT")))
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        inst._implement_data_minimum(KEY, {}, discovered, {}, adapt=False)
    assert str(raised.value) == f"{agent_ns['IMPLEMENT_DATA_MINIMUM_LEAD']}: {FEW_TEXT} {CHOICES}"
    assert any(str(c.args[0]).startswith("[DATA-MINIMUM RECOUNT] N01-U01: the count before Genie could not run, so the build uses "
                                         "the count from discovery") for c in inst.logger.warning.call_args_list)


def test_the_count_runs_once_per_spec_version(agent_ns):
    discovered = churn(data_signal=stored(status="passed", positives=900, reason="ok"))
    inst, _agent, spark = inspire(agent_ns, "Standard Discovery", responder=outcome_rows(MANY))
    inst._implement_data_minimum(KEY, {}, discovered, {})
    inst._implement_data_minimum(KEY, {}, discovered, {})
    assert len(count_statements(spark)) == 1


def test_a_build_without_a_genie_round_is_refused_with_the_choices_when_short(agent_ns):
    discovered = churn(data_signal=stored())
    inst, _agent, _spark = inspire(agent_ns, "Standard Discovery", responder=outcome_rows(FEW))
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        inst._implement_data_minimum(KEY, {}, discovered, {}, adapt=False)
    assert str(raised.value) == f"{agent_ns['IMPLEMENT_DATA_MINIMUM_LEAD']}: {FEW_TEXT} {CHOICES}"
    assert "_implement_measured_short" not in discovered


def test_the_choices_name_no_setting_when_the_shortfall_has_none(agent_ns):
    choices = agent_ns["implement_data_minimum_choices"]
    assert choices({}, "A") == ("Your choices: Rebuild once the data has the minimum above, or build another use case the data "
                                "supports.")
    short = agent_ns["implement_readiness_shortfall"]("There are too few past interactions (743); at least 1000 are needed to learn "
                                                      "preferences.", "D")
    assert choices(short, "D").startswith("Your choices: lower Minimum interactions in the build settings")
    assert "at least 1,000 past interactions" in choices(short, "D")
    assert not choices(short, "A").startswith("Your choices: lower")


def test_a_minimum_the_user_set_is_never_lowered_before_the_build(agent_ns):
    discovered = churn(data_signal=stored())
    inst, _agent, _spark = inspire(agent_ns, "Standard Discovery", responder=outcome_rows(FEW))
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        inst._implement_data_minimum(KEY, {"config": {"widgets": {"min_positives": "200"}}}, discovered, {})
    assert "(11); at least 200" in str(raised.value) and "so Inspire kept your setting" in str(raised.value)
    assert "Your choices" not in str(raised.value)
    assert "_implement_measured_short" not in discovered


def test_the_build_starts_with_the_measured_shortfall_and_ends_buildable_when_genie_cannot_adapt(agent_ns):
    inst = _family(_flow_inspire(agent_ns, []), "A")
    runner = _FakeRunner([{"exit": 0, "final": _stopped(SHORT_A)}, {"exit": 0, "final": _stopped(SHORT_A)}])
    spec = _spec(agent_ns)
    repaired = {}
    first = inst._implement_stop_repair("N01-U01", {}, spec, {"family": "A"}, SHORT_A, None, repaired,
                                        agent_ns["IMPLEMENT_DATA_REPAIR_BEFORE"])
    use_case = {"_implement_measured_short": {"feedback": first["feedback"], "short": first["short"], "repaired": repaired}}
    outcome, _job, _f = inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), use_case, spec, None, "/W/nb",
                                                         ["result_table", "run_profile"], runner, True)
    assert "Inspire measured the data before you started: History holds too few past examples of the outcome (11)" in runner.prompts[0]
    assert len(runner.prompts) == 1 and outcome["status"] == "stopped"
    assert outcome["buildable"].startswith("Genie found no method that is valid at 11 past examples of the outcome")
    assert "_implement_measured_short" not in use_case


def test_the_build_adapts_and_tells_the_user_what_changed(agent_ns):
    inst = _family(_flow_inspire(agent_ns, [({"status": "written", "rows_written": 40}, 11, 101)]), "A")
    changed = dict(_fill(), changes=[{"what": "", "why": "11 outcomes are too few for a gradient boosted model",
                                      "method_was": "gradient boosted trees", "method_now": "a rules-based score",
                                      "setting": "", "value_was": "", "value_now": "", "cause": "data_shortfall"}])
    runner = _FakeRunner([{"exit": 0, "final": changed}])
    repaired = {}
    first = inst._implement_stop_repair("N01-U01", {}, _spec(agent_ns), {"family": "A"}, SHORT_A, None, repaired,
                                        agent_ns["IMPLEMENT_DATA_REPAIR_BEFORE"])
    use_case = {"_implement_measured_short": {"feedback": first["feedback"], "short": first["short"], "repaired": repaired}}
    outcome, _job, _f = inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), use_case, _spec(agent_ns), None, "/W/nb",
                                                         ["result_table", "run_profile"], runner, True)
    assert outcome["status"] == "written"
    assert outcome["genie_changes"] == [
        "Genie found 11 past examples of the outcome, fewer than the 200 the first method needs, so it used a rules-based score "
        "instead. Results will be less precise; Rebuild after more history arrives to use gradient boosted trees."]


def decision(value, **extra):
    return dict({"No": "N01-U01", "Name": "Rank stores for the weekly restock list", "Analytics Technique": "Ranking",
                 "Statement": "Store managers decide which stores to restock each week.", "Business Value": value,
                 "Beneficiary": "Store Operations Manager", "Sponsor": "VP Retail Operations",
                 "Solution": "Score each store weekly and list the top stores per region.", "Tables Involved": SALES}, **extra)


def test_a_decision_use_case_with_no_measurable_outcome_is_dropped(agent_ns):
    inst, _agent, _spark = inspire(agent_ns, "Standard Discovery")
    miss = lambda u: inst._q5_decision_test_miss(u, u["Name"], u["Statement"], u["Solution"], None)
    assert miss(decision("Gives managers a clearer picture of their stores.")) == "Q5_T4_NO_MEASURABLE_OUTCOME"
    assert miss(decision("Better insight for the team.", Name="Understand stores", Statement="Managers want insight.")) == \
        "Q5_T4_NO_MEASURABLE_OUTCOME"
    assert miss(decision("Reduce stockouts by 15% across the region.")) == ""
    assert miss(decision("Cut lost sales from empty shelves each week.")) == ""


def test_informational_kinds_skip_the_outcome_test_and_are_labelled(agent_ns):
    kinds = agent_ns["_inspire_kinds"]()["kinds"]
    informational = {k["id"] for k in kinds if k.get("informational")}
    assert {"driver_breakdown", "leading_indicators", "journey_path", "location_intelligence", "reason_codes"} <= informational
    inst, _agent, _spark = inspire(agent_ns, "Standard Discovery")
    dropped_ids = []
    for kind_id in ("driver_breakdown", None):
        u = decision("Gives managers a clearer picture of their stores.", No=f"N0{len(dropped_ids) + 1}-U01",
                     **({"use_case_kind": kind_id} if kind_id else {}))
        kept, dropped = inst._phaseQ5_decision_readiness([u], [])
        dropped_ids.append([d.get("No") if isinstance(d, dict) else d[0].get("No") for d in dropped])
    assert dropped_ids[0] == [] and dropped_ids[1] != []


@pytest.mark.parametrize("kind_id,informational", [("driver_breakdown", True), ("forecast", False)])
def test_the_catalog_labels_an_informational_kind_and_never_a_decision_kind(agent_ns, kind_id, informational):
    obj = make_inspire(agent_ns)
    t = dict(agent_ns["TranslationService"].ENGLISH_TRANSLATIONS)
    use_case = make_uc("N01-U01", use_case_kind=kind_id, kind_label="Kind", kind_family_label="Family")
    model = obj._document_model("English", t, {}, {"Sales": [use_case]}, "Acme")
    facts = {key: value for key, _label, value in obj._use_case_view(model["ranked"][0], model, t)["facts"]}
    assert facts["kind"] == "Kind \u00b7 Family" + (" \u00b7 Informational" if informational else "")
