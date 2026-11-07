import json

import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import ALERT, _FileRunner, _alert_inspire, _inspire, _output_context

SENTINEL = "ZQV7001QZ"
OTHER = "ZQV7002QZ"
DATE = "1911-04-02"
LATER = "1911-04-03"
PLACEHOLDER = "a data value"
TABLE = "main.inspire.churn_out"


def _clean(*texts, extra=()):
    joined = "\n".join(t if isinstance(t, str) else json.dumps(t, default=str) for t in texts)
    found = [token for token in (SENTINEL, OTHER, DATE, LATER, *extra) if token in joined]
    return found + ([PLACEHOLDER] if PLACEHOLDER in joined else [])


def _respond(profile=None, methods=None, facts=None, tiers=None):
    def respond(statement):
        if "GROUP BY priority_tier" in statement:
            return tiers or [{"priority_tier": "Monitor", "tier_rows": 7200}]
        if "AS distinct_values" in statement and "flag_kinds" in statement:
            return [profile or {"n": 7200, "valued": 7200, "distinct_values": 412, "span": 0.415, "flagged": 30, "flag_kinds": 1}]
        if "GROUP BY method" in statement:
            return methods or [{"method": SENTINEL, "method_rows": 7000, "versioned_rows": 0},
                               {"method": OTHER, "method_rows": 200, "versioned_rows": 0}]
        if statement.startswith("SELECT nothing_to_act"):
            return [facts or {"nothing_to_act": "", "not_reliable": ""}]
        return []
    return respond


def test_ai_checks_the_run_wrote_as_text_inspire_cannot_read_are_described_by_their_size(agent_ns):
    raw = f"{{not json {SENTINEL}"
    inst = _inspire(agent_ns, FakeSpark(responder=lambda s: [{"summary": "s", "ai_checks": raw}] if "ai_checks FROM" in s else []))
    findings = inst._implement_ai_findings("N01-U01", {"result_table": TABLE}, {"run_id": "r-1"})
    summary = agent_ns["inspire_ai_summary_table"](TABLE)
    assert findings["problems"][0] == (f"the AI step of the run failed: the run recorded {len(raw)} characters in column ai_checks of "
                                       f"{summary}, and that value is not JSON, so Inspire cannot read its AI checks"), findings
    assert _clean(findings, *[m for _l, m in inst.logger.records]) == []


def test_the_tier_warning_is_built_from_counts_and_names_the_columns(agent_ns):
    inst = _inspire(agent_ns, FakeSpark(responder=_respond()))
    warning = inst._implement_tier_warning("N05-U01", TABLE, "https://h/r/9", "r-1")
    share = agent_ns["implement_share_text"]
    assert warning == ("Decision list: no row of the latest run reached Act now or Review (7,200 Monitor), so it has nobody to act on yet; "
                       f"its rows come from 2 methods in column method, the largest on {share(7000, 7200)} of them, with no registered "
                       f"model; column value holds 412 distinct values spanning {agent_ns['implement_number_text'](0.415)}; 30 of 7,200 "
                       f"rows ({share(30, 7200)}) carry a data_quality_flag other than ok, in 1 kind; run: https://h/r/9"), warning
    assert _clean(warning, *[m for _l, m in inst.logger.records]) == []
    profile_sql = next(s for s in inst.spark.statements if "flag_kinds" in s)
    assert "MIN(value) AS" not in profile_sql and "GROUP BY" not in profile_sql, "the profile reads no value, only aggregates"


@pytest.mark.parametrize("profile,fact", [
    ({"n": 40, "valued": 0, "distinct_values": 0, "span": None, "flagged": 0, "flag_kinds": 0}, "column value is empty on every row"),
    ({"n": 40, "valued": 40, "distinct_values": 1, "span": 0.0, "flagged": 40, "flag_kinds": 1},
     "every row has the same value in column value; 40 of 40 rows (100%) carry a data_quality_flag other than ok, in 1 kind"),
    ({"n": 40, "valued": 40, "distinct_values": 9, "span": None, "flagged": 0, "flag_kinds": 0},
     "column value holds 9 distinct values; no row is flagged"),
])
def test_the_value_and_flag_facts_are_described_by_kind(agent_ns, profile, fact):
    methods = [{"method": SENTINEL, "method_rows": 40, "versioned_rows": 40}]
    inst = _inspire(agent_ns, FakeSpark(responder=_respond(profile, methods, tiers=[{"priority_tier": "Monitor", "tier_rows": 40}])))
    warning = inst._implement_tier_warning("N05-U01", TABLE, "", "r-1")
    assert "every row comes from one method in column method; " + fact in warning, warning
    assert _clean(warning) == []


def test_a_canned_reason_is_named_without_the_tail_the_run_added(agent_ns):
    reason = f"{agent_ns['INSPIRE_NOTHING_TO_ACT_FLAGGED']}, most often: {SENTINEL}."
    inst = _inspire(agent_ns, FakeSpark(responder=_respond(facts={"nothing_to_act": reason, "not_reliable": ""})))
    warning = inst._implement_tier_warning("N05-U01", TABLE, "", "r-1")
    assert f"the run's reason: {agent_ns['INSPIRE_NOTHING_TO_ACT_FLAGGED']}" in warning and _clean(warning) == []


def test_a_reason_of_the_run_own_is_pointed_to_not_copied(agent_ns):
    inst = _inspire(agent_ns, FakeSpark(responder=_respond(facts={"nothing_to_act": f"no item lost more than {SENTINEL}", "not_reliable": ""})))
    assert inst._implement_tier_warning("N05-U01", TABLE, "", "r-1") == ""
    [step] = [e for e in inst.emitted if e["step_name"] == "Decision list"]
    assert step["message"] == ("no row of the latest run reached Act now or Review, and the App shows the reason the run wrote in "
                               "nothing_to_act")
    assert _clean(step, *[m for _l, m in inst.logger.records]) == []
    words = agent_ns["implement_tier_mix_warning"]({"Monitor": 4}, "", None, None, f"no item lost more than {SENTINEL}")
    assert "the run gave a reason of its own in nothing_to_act" in words and _clean(words) == []


def test_not_reliable_yet_points_to_the_column_that_says_why(agent_ns):
    inst = _inspire(agent_ns, FakeSpark(responder=_respond(facts={"nothing_to_act": "", "not_reliable": f"AUC {SENTINEL} is low"})))
    warning = inst._implement_tier_warning("N05-U01", TABLE, "", "r-1")
    assert warning == ("Not reliable yet: the latest run marked its results not reliable and wrote why in not_reliable of "
                       f"{agent_ns['inspire_ai_summary_table'](TABLE)}, which the App shows")
    assert _clean(warning, *[m for _l, m in inst.logger.records]) == []


def _gates(agent_ns, stale=None, shared=None):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_ai_findings = lambda uc, use_case, outcome: {"problems": [], "fixable": False}
    inst._implement_run_stale_flags = lambda uc, use_case, outcome: stale or {}
    inst._implement_run_shared_flag = lambda uc, use_case, outcome: shared or {}
    inst._implement_run_untested = lambda uc, use_case, outcome: False
    return inst._implement_preview_gates("N01-U01", {"result_table": TABLE}, {"run_id": "r-1"}, None)


def test_the_stale_flag_gate_names_the_columns_and_no_date(agent_ns):
    [gate] = _gates(agent_ns, stale={"n": 3, "ends": DATE, "as_of": LATER})
    assert gate["problems"] == ["run r-1 wrote 3 rows with a data_quality_flag that starts with data ends and is dated on or after "
                                "the as_of_date of its row, so the staleness check measured to today, not to the as_of_date"]
    assert "a data_quality_flag that starts with data ends and is dated on or after the as_of_date of " in gate["feedback"]
    assert "its row, so the staleness check measured to today" in gate["feedback"]
    assert gate["event"].startswith("the preview run flagged 3 rows with a data ends flag dated on or after the as_of_date of its row")
    assert _clean(gate) == []


def test_the_shared_flag_gate_names_the_column_and_not_the_flag(agent_ns):
    [gate] = _gates(agent_ns, shared={"n": 40, "flag": SENTINEL})
    assert gate["problems"] == ["all 40 rows of run r-1 carry the same data_quality_flag other than 'ok', and a value, so the flag "
                                "tells no row apart and holds every row at 'Monitor'"]
    assert "carry the same data_quality_flag other than 'ok', and a value" in gate["feedback"]
    assert gate["event"].startswith("the preview run gave all 40 rows the same data_quality_flag")
    assert _clean(gate) == []


@pytest.mark.parametrize("held,tail", [
    ({"low": "12.5", "high": "9800.0", "distinct": 38}, None),
    ({"low": DATE, "high": "1911-04-14", "distinct": 3}, ", over 12 days"),
    ({"low": SENTINEL, "high": OTHER, "distinct": 2}, ""),
    ({"low": SENTINEL, "high": SENTINEL, "distinct": 1}, ", every value the same"),
])
def test_the_result_facts_name_the_column_and_describe_its_values_by_kind(agent_ns, held, tail):
    facts = dict({"exists": True, "rows": 40, "non_null": 40, "values": [SENTINEL, OTHER, "9800.0"]}, **held)
    text = agent_ns["implement_result_fact_text"]("value_at_stake", facts)
    head = f"column value_at_stake: 40 rows in the latest run, 40 not empty, {held['distinct']} distinct"
    expected = head + (f", spanning {agent_ns['implement_number_text'](9787.5)}" if tail is None else tail)
    assert text == expected and _clean(text, extra=("9800.0", "12.5")) == []


def test_the_result_gate_names_only_the_values_the_ask_names(agent_ns):
    facts = {"region": {"exists": True, "rows": 10, "non_null": 10, "distinct": 3, "low": "APAC", "high": SENTINEL,
                        "values": ["APAC", "EMEA", SENTINEL]}}
    ok, evidence = agent_ns["implement_result_gate"]({"column": "region", "values": ["LATAM"]}, facts, "notebook")
    assert ok is False and evidence == "column region: 10 rows in the latest run, 10 not empty, 3 distinct: it never holds LATAM"
    assert _clean(evidence, extra=("APAC", "EMEA")) == []


def test_the_alert_check_names_the_type_of_triggered_not_its_value(agent_ns, tmp_path):
    inst, _calls, _q = _alert_inspire(agent_ns, tmp_path, rows=[{"triggered": SENTINEL}])
    good = "SELECT COUNT(*) > 10 AS triggered FROM main.s.orders WHERE status = 'refund'"
    runner = _FileRunner([{"exit": 0}] * 3, [{"alert_condition.sql": good}] * 3)
    with pytest.raises(RuntimeError) as raised:
        inst._implement_alert(_output_context(agent_ns, **ALERT, alert_condition_text="refunds above 10 today"), runner)
    assert "it returned 1 row whose triggered is a str, not a BOOLEAN" in str(raised.value)
    assert _clean(str(raised.value), *runner.prompts, *[json.dumps(e, default=str) for e in inst.emitted]) == []


def test_the_fallback_warning_counts_the_methods_and_names_the_column(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst._genie_acceptance_stop_rule = lambda spec: "If no candidate passes, it registers no model and writes the baseline's rows."
    inst._implement_trains_model = lambda use_case: True
    inst._implement_latest_run_methods = lambda table: {"methods": [(SENTINEL, 40)], "kinds": 1, "versioned_rows": 0}
    warning = inst._implement_fallback_warning("N01-U01", TABLE, {"Name": "Churn"}, {})
    assert warning == ("Notebook: no model passed acceptance on the latest run, so no model is registered and its rows are the "
                       "baseline's, from 1 method in column method; the run's summary gives the candidates' metrics against the "
                       "acceptance rule")
    assert _clean(warning, *[m for _l, m in inst.logger.records]) == []
