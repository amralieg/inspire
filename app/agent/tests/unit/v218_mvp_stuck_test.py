"""v2.1.8 MVPs that got stuck after the build started.

1. A leading-indicators use case needs weeks of history to test a lead. Discovery used the group-comparison check, which
   counts distinct days, so 17 days of sales passed it and the build later held the App on "too few transactions".
   Discovery now runs a lead check on weeks of history, and the build counts it again before Genie starts and refuses
   with the choices the person has, even when discovery recorded the old check.
2. A dashboard and a Genie Agent run with each viewer's own credentials. Sharing granted the result table only, so the
   people the use case is shared with hit a privilege error on the source tables. Sharing now grants what Inspire can
   on those tables and names the missing grant and its owner for the rest.
3. A privilege the build identity lacks on the use case's own data is not sent back to Genie round after round: the
   output stops at once with the grant to ask for and who owns it, and the rest of the MVP builds.
"""
import contextlib
import os
import sys
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v120_artifacts_support import CapturingLogger, FakeSpark  # noqa: E402
from v140_implement_test import _inspire, _spec  # noqa: E402
from v200_kinds_signal_test import LEDGER, ORDERS, answer, deep_inspire, responder, standard_inspire, uc  # noqa: E402

LEAD = {"time": "event_time", "measure": "units"}
SHORT_LEAD = {"periods": 17, "median_gap": 1, "first_period": "2024-05-01", "last_period": "2024-05-17", "lag1": 0.3, "lag7": 0.2}
LONG_LEAD = {"periods": 140, "median_gap": 1, "first_period": "2024-01-01", "last_period": "2024-05-19", "lag1": 0.3, "lag7": 0.4}
SHORT_FAIL = ("History covers 2.4 weeks of daily totals; at least 8 are needed to test whether a measure moves ahead of the "
              "outcome by a week or more.")


def lead_uc(uc_id, **extra):
    return uc(uc_id, "Correlation Analysis", "leading_indicators", **extra)


def test_a_leading_indicators_use_case_runs_the_lead_check(agent_ns):
    inst, _agent, _spark = deep_inspire(agent_ns, [], {})
    assert inst._signal_check_of(lead_uc("N01-U01")) == ("F", "lead")
    assert inst._signal_check_of(uc("N01-U01", "Trend Analysis")) == ("F", "lead"), "the technique's own kind is leading indicators"
    assert inst._signal_check_of({"No": "N01-U01", "Analytics Technique": "Correlation Analysis",
                                  "Use Case Kind": "leading_indicators"}) == ("F", "lead")


def test_other_kinds_of_the_same_family_keep_their_check(agent_ns):
    inst, _agent, _spark = deep_inspire(agent_ns, [], {})
    assert inst._signal_check_of(uc("N01-U01", "Regression Analysis", "driver_breakdown")) == ("F", "groups")
    assert inst._signal_check_of(uc("N01-U01", "Forecasting")) == ("E", "series")
    assert inst._signal_check_of(uc("N01-U01", "Simulation", "driver_scenarios")) == ("H", "scenario")
    assert inst._signal_check_of(uc("N01-U01", "Simulation", "capacity_planning")) == ("H", "scenario")


def test_a_trend_use_case_with_no_time_column_is_kept_unchecked_and_reads_nothing(agent_ns):
    ucs = [uc("N01-U01", "Trend Analysis")]
    inst, _agent, spark = deep_inspire(agent_ns, [{"results": [answer("N01-U01", {"group": "region"})]}], {})
    kept, dropped = inst._check_data_signal(ucs, [])
    assert dropped == [] and len(kept) == 1 and spark.statements == []
    assert ucs[0]["data_signal"] == {"status": "not_checked", "check": "lead", "family": "F",
                                     "reason": "Not checked: no time column was named for it."}


def test_the_lead_check_reads_the_series_and_counts_weeks_of_history(agent_ns):
    sql, measures = agent_ns["DeepEvidence"].signal_sql, agent_ns["deep_signal_measures"]
    lead, _ = sql("lead", "`t`", {"roles": LEAD})
    series, _ = sql("series", "`t`", {"roles": LEAD})
    assert lead == series and "MIN(d) AS first_period, MAX(d) AS last_period" in lead
    short = measures("lead", SHORT_LEAD, {"roles": LEAD})
    assert short["lead_weeks"] == 2.4 and short["cadence"] == "daily" and short["periods"] == 17
    assert measures("lead", LONG_LEAD, {"roles": LEAD})["lead_weeks"] == 20.0
    assert "lead_weeks" not in measures("series", SHORT_LEAD, {"roles": LEAD}), "a forecast keeps its own measures"


def test_too_short_a_history_fails_the_lead_check_and_enough_weeks_pass_it(agent_ns):
    verdict, measures = agent_ns["deep_signal_verdict"], agent_ns["deep_signal_measures"]
    passed, text = verdict("F", measures("lead", SHORT_LEAD, {"roles": LEAD}), {"measure": "units"}, check="lead")
    assert passed is False and text == SHORT_FAIL
    passed, text = verdict("F", measures("lead", LONG_LEAD, {"roles": LEAD}), {"measure": "units"}, check="lead")
    assert passed is True and text == ("History covers 20.0 weeks of daily totals, enough to test whether a measure moves ahead "
                                       "of the outcome.")


def test_the_lead_minimum_is_a_runtime_parameter(agent_ns, monkeypatch):
    runtime = agent_ns["TECHNICAL_CONTEXT"]["runtime"]
    assert runtime["signal_min_lead_weeks"] == 8
    monkeypatch.setitem(runtime, "signal_min_lead_weeks", 521)
    with pytest.raises(ValueError, match=r"signal_min_lead_weeks'\]=521 out of bounds \[1, 520\]"):
        agent_ns["_validate_runtime_config"]()
    short = agent_ns["deep_signal_measures"]("lead", SHORT_LEAD, {"roles": LEAD})
    monkeypatch.setitem(runtime, "signal_min_lead_weeks", 2)
    assert agent_ns["deep_signal_verdict"]("F", short, {}, check="lead")[0] is True


def test_discovery_drops_a_leading_indicators_use_case_whose_history_is_too_short(agent_ns):
    ucs = [lead_uc("N02-U01"), lead_uc("N02-U02", **{"Tables Involved": ORDERS})]
    answers = [{"results": [answer("N02-U01", LEAD), answer("N02-U02", LEAD)]}]
    inst, agent, spark = deep_inspire(agent_ns, answers, {"AS median_gap": SHORT_LEAD})
    kept, dropped = inst._check_data_signal(ucs, [])
    assert "check: lead" in agent.calls[0]["vars"]["use_cases_listing"]
    assert kept == [] and [u["No"] for u in dropped] == ["N02-U01", "N02-U02"]
    assert dropped[0]["selection_drop_reason"] == f"the data shows no signal: {SHORT_FAIL}"
    assert not any("AS reportable_groups" in s for s in spark.statements), "the group check no longer decides a lead"


def test_discovery_keeps_a_leading_indicators_use_case_with_enough_weeks(agent_ns):
    ucs = [lead_uc("N02-U01")]
    inst, _agent, _spark = deep_inspire(agent_ns, [{"results": [answer("N02-U01", LEAD)]}], {"AS median_gap": LONG_LEAD})
    kept, dropped = inst._check_data_signal(ucs, [])
    assert [u["No"] for u in kept] == ["N02-U01"] and dropped == []
    assert ucs[0]["data_signal"]["status"] == "passed" and ucs[0]["data_signal"]["check"] == "lead"


def test_a_leading_indicators_use_case_the_instructions_ask_for_stays_and_says_why(agent_ns):
    ucs = [lead_uc("N02-U01", user_request="R1"), lead_uc("N02-U02")]
    answers = [{"results": [answer("N02-U01", LEAD), answer("N02-U02", LEAD)]}]
    inst, _agent, _spark = deep_inspire(agent_ns, answers, {"AS median_gap": SHORT_LEAD}, parsed_generation_instructions={
        "use_case_requests": [{"id": "R1", "ask": "early warning of a revenue shortfall", "minimum": 1}]})
    kept, dropped = inst._check_data_signal(ucs, [])
    assert [u["No"] for u in kept] == ["N02-U01"] and [u["No"] for u in dropped] == ["N02-U02"]
    assert ucs[0]["data_signal"]["status"] == "no_signal" and SHORT_FAIL in ucs[0]["data_signal"]["reason"]


def test_standard_discovery_drops_a_lead_with_no_date_from_the_column_types(agent_ns):
    ucs = [lead_uc("N02-U01", **{"Tables Involved": LEDGER})]
    inst, _agent, spark = standard_inspire(agent_ns, [{"results": [answer("N02-U01", {"time": "", "measure": "amount"}, LEDGER)]}])
    kept, dropped = inst._check_data_signal(ucs, [])
    assert spark.statements == [] and kept == []
    assert dropped[0]["selection_drop_reason"] == (
        "the data shows no signal: From the column types alone: none of its tables (main.s.ledger) has a date or timestamp "
        "column, or a key that joins to one, so there is no history to test whether a measure moves ahead of the outcome.")


def test_the_prompt_names_the_roles_of_the_lead_check(agent_ns):
    prompt = agent_ns["PROMPT_TEMPLATES"]["SIGNAL_CHECK_PROMPT"]
    assert ('- lead: "time" is the DATE or TIMESTAMP column of the rows, a text column whose values are dates, or a date key the '
            'use case\'s line lists under "date keys"; "measure" is the numeric outcome the indicators should move ahead of') in prompt


GROUPS_PASSED = {"status": "passed", "family": "F", "check": "groups", "reason": "48 groups hold enough rows to compare.",
                 "spec": {"family": "F", "check": "groups", "table": ORDERS, "roles": {"group": "store", "time": "event_time"}},
                 "measures": {"row_count": 3333, "reportable_groups": 48, "periods": 17}, "columns": {"group": "store"}}


def build_inspire(agent_ns):
    inst, _agent, spark = deep_inspire(agent_ns, [], {})
    inst.spark = spark
    inst.logger = CapturingLogger()
    inst.updates, inst.counted = [], []
    inst._implement_update = lambda key, **fields: inst.updates.append(fields)
    inst._implement_emit = lambda *a, **k: None
    inst._signal_record = lambda deep, spec, *_a, **_k: inst.counted.append(spec["check"]) or dict(GROUPS_PASSED)

    def measure(use_case, record):
        inst.counted.append("fresh")
        return {"status": "failed", "family": "F", "check": "lead", "reason": "",
                "measures": agent_ns["deep_signal_measures"]("lead", SHORT_LEAD, {"roles": LEAD}), "columns": {"measure": "units"}}

    inst._implement_measure_signal = measure
    inst._implement_stop_repair = lambda *a, **k: pytest.fail("a lead too short for its kind is not sent to Genie")
    return inst


def test_the_build_counts_the_lead_again_when_discovery_recorded_the_group_check(agent_ns):
    inst = build_inspire(agent_ns)
    use_case = dict(lead_uc("N02-U01"), data_signal=dict(GROUPS_PASSED))
    status = {}
    inst._implement_data_minimum((5150, "N02-U01", 3), {"config": {"widgets": {}}}, use_case, status)
    assert inst.counted == ["fresh"], "the stored group count is not reused for a lead"
    assert status["data"]["state"] == "unreliable" and status["data"]["data_minimum"] == SHORT_FAIL
    told = use_case["_implement_measured_short"]
    assert told["feedback"] == agent_ns["implement_unreliable_note"](SHORT_FAIL, "F") and told["repaired"]["unreliable"] == 1
    assert any("[NOT-RELIABLE-FALLBACK FIRED]" in line for _level, line in inst.logger.records)


def test_the_build_reuses_the_discovery_spec_when_the_check_has_not_changed(agent_ns):
    inst = build_inspire(agent_ns)
    use_case = dict(uc("N02-U01", "Regression Analysis", "driver_breakdown"), data_signal=dict(GROUPS_PASSED))
    inst._implement_data_minimum((5150, "N02-U01", 3), {"config": {"widgets": {}}}, use_case, {})
    assert inst.counted == ["groups"]


DENIED = ("dataset records failed: [INSUFFICIENT_PERMISSIONS] Insufficient privileges: User does not have SELECT on table "
          "`main`.`s`.`customers`.")
OWNER_ROWS = [{"level": "table", "privilege": "OWNER", "principal": "data-team", "mine": False, "me": "inspire-sp"}]


class Writer:
    def __init__(self):
        self.prompts = []

    def run(self, prompt, work, schema, label=None):
        self.prompts.append(prompt)
        os.makedirs(work, exist_ok=True)
        return {}


def loop_inspire(agent_ns, tmp_path):
    inst = _inspire(agent_ns, FakeSpark(), local_log_output_dir=str(tmp_path))
    inst.logger = CapturingLogger()
    inst._implement_builder_name = "inspire-sp"
    inst.looked = []
    inst._implement_access_rows = lambda table, warnings=None: inst.looked.append(table) or OWNER_ROWS
    spec = _spec(agent_ns, data={"tables": {}, "filters": [], "run_profile": "preview"})[0]
    context = {"uc_id": "N01-U01", "key": (5150, "N01-U01", 3), "spec": spec,
               "use_case": {"Tables Involved": "main.s.customers, main.s.orders"}}
    return inst, context


def test_a_privilege_the_build_lacks_on_its_own_data_stops_the_output_at_once_and_names_the_grant(agent_ns, tmp_path):
    inst, context = loop_inspire(agent_ns, tmp_path)
    writer = Writer()

    def deploy(work):
        raise RuntimeError(DENIED)

    with pytest.raises(agent_ns["ImplementBlocked"]) as stopped:
        inst._implement_genie_loop(context, writer, "Dashboard", "Build the dashboard.", deploy)
    assert len(writer.prompts) == 1, "Genie cannot grant a privilege, so no second round"
    assert str(stopped.value) == (
        "inspire-sp does not have SELECT on table main.s.customers, and no change to the Dashboard can grant it: ask data-team, "
        "its owner, to run GRANT SELECT ON TABLE `main`.`s`.`customers` TO `inspire-sp`, then build again")
    assert inst.looked == ["main.s.customers"]
    assert inst.logger.matching("[IMPLEMENT-DENIED FIRED] N01-U01: the Dashboard is not sent back to Genie")


def test_a_denial_with_no_owner_found_asks_the_owner_or_a_metastore_admin(agent_ns, tmp_path):
    inst, context = loop_inspire(agent_ns, tmp_path)
    inst._implement_access_rows = lambda table, warnings=None: None

    def deploy(work):
        raise RuntimeError(DENIED)

    with pytest.raises(agent_ns["ImplementBlocked"]) as stopped:
        inst._implement_genie_loop(context, Writer(), "Genie Agent", "Build the Genie Agent.", deploy)
    assert "ask the owner of table main.s.customers or a metastore admin to run GRANT SELECT ON TABLE `main`.`s`.`customers` " \
           "TO `inspire-sp`" in str(stopped.value)


def test_a_denial_keeps_the_owner_and_the_denied_user_and_masks_any_other_email_in_the_error(agent_ns, tmp_path):
    inst, context = loop_inspire(agent_ns, tmp_path)
    inst._implement_access_rows = lambda table, warnings=None: [dict(OWNER_ROWS[0], principal="owner.one@example.com")]
    failure = ("[INSUFFICIENT_PERMISSIONS] Insufficient privileges: User 'builder.two@example.com' does not have SELECT on "
               "Table 'main.s.customers'. Contact other.three@example.com")

    def deploy(work):
        raise RuntimeError(failure)

    with pytest.raises(agent_ns["ImplementBlocked"]) as stopped:
        inst._implement_genie_loop(context, Writer(), "Dashboard", "Build the dashboard.", deploy)
    assert str(stopped.value) == (
        "builder.two@example.com does not have SELECT on table main.s.customers, and no change to the Dashboard can grant it: "
        "ask owner.one@example.com, its owner, to run GRANT SELECT ON TABLE `main`.`s`.`customers` TO `builder.two@example.com`, "
        "then build again")
    assert "other.three" not in str(stopped.value)


@pytest.mark.parametrize("failure", [
    DENIED.replace("`main`.`s`.`customers`", "`main`.`scratch`.`notes`"),
    "dataset records failed: [UNRESOLVED_COLUMN] A column named `churn_band` cannot be resolved.",
])
def test_a_failure_genie_can_fix_still_goes_back_to_genie(agent_ns, tmp_path, failure):
    inst, context = loop_inspire(agent_ns, tmp_path)
    writer, calls = Writer(), []

    def deploy(work):
        calls.append(work)
        if len(calls) == 1:
            raise RuntimeError(failure)
        return {"dashboard_id": "d1"}

    assert inst._implement_genie_loop(context, writer, "Dashboard", "Build the dashboard.", deploy) == {"dashboard_id": "d1"}
    assert len(writer.prompts) == 2


def test_a_stopped_output_is_tried_once_and_the_build_goes_on(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst.logger = CapturingLogger()
    inst._implement_vibes_llm = lambda *a, **k: pytest.fail("a privilege stop is not handed to the repair model")
    tries = []

    def build():
        tries.append(1)
        raise agent_ns["ImplementBlocked"]("inspire-sp does not have SELECT on table main.s.customers")

    with pytest.raises(agent_ns["ImplementBlocked"]):
        inst._implement_part_attempts("N01-U01", (5150, "N01-U01", 3), "dashboard", build)
    assert tries == [1]


RESULT = "main.inspire.churn_out"
MANAGED = [{"level": "schema", "privilege": "OWNER", "principal": "inspire-sp", "mine": True, "me": "inspire-sp"},
           {"level": "catalog", "privilege": "USE CATALOG", "principal": "account users", "mine": True, "me": "inspire-sp"}]
FOREIGN = [{"level": "table", "privilege": "OWNER", "principal": "data-team", "mine": False, "me": "inspire-sp"},
           {"level": "schema", "privilege": "OWNER", "principal": "data-team", "mine": False, "me": "inspire-sp"},
           {"level": "catalog", "privilege": "USE CATALOG", "principal": "account users", "mine": True, "me": "inspire-sp"},
           {"level": "schema", "privilege": "USE SCHEMA", "principal": "account users", "mine": True, "me": "inspire-sp"}]
ACCESS = {RESULT: MANAGED, "main.s.orders_v2": MANAGED, "main.s.customers": FOREIGN}


def share_inspire(agent_ns):
    spark = FakeSpark()
    inst = _inspire(agent_ns, spark)
    inst.logger = MagicMock()
    inst.looked = []
    inst._implement_access_rows = lambda table, warnings=None: inst.looked.append(table) or ACCESS[table]
    inst._implement_share_reads = lambda result_table, names: []
    inst._implement_grant = lambda kind, object_id, principals, level: list(principals)
    inst._implement_unshare = lambda *a, **k: ([], [])
    inst._implement_shared_with = lambda *a, **k: []
    inst._implement_asset_lock = lambda *a, **k: contextlib.nullcontext()
    inst._implement_emit = lambda *a, **k: None
    return inst, spark


def shared_spec(agent_ns, **outputs):
    return _spec(agent_ns, sharing={"principals": [{"type": "group", "name": "planners"}]},
                 outputs=dict({"dashboard": True, "genie_space": True, "app": False}, **outputs))[0]


SOURCES = [RESULT, "main.s.orders_v2", "main.s.customers"]


def test_sharing_grants_the_source_tables_the_dashboard_reads_and_names_the_grant_it_cannot_give(agent_ns):
    inst, spark = share_inspire(agent_ns)
    warnings = inst._implement_share("N01-U01", RESULT, shared_spec(agent_ns), {"dashboard": "d1", "genie_space": "g1"}, None,
                                     sources=SOURCES)
    assert "GRANT SELECT ON TABLE `main`.`s`.`orders_v2` TO `planners`" in spark.statements
    assert "GRANT USE SCHEMA ON SCHEMA `main`.`s` TO `planners`" in spark.statements
    assert not any("customers" in s for s in spark.statements)
    assert warnings == [
        "Sharing: planners may not be able to read the result table, which the dashboard and the Genie Agent read with the "
        "credentials of each viewer: Inspire cannot grant this access, because it "
        "neither owns nor holds MANAGE on it. If planners does not have it yet, ask the owner to run: GRANT SELECT ON TABLE "
        "`main`.`s`.`customers` TO `planners`"]
    assert inst.looked.count(RESULT) == 1, "the result table is planned once"


def test_sharing_a_dashboard_only_names_the_dashboard(agent_ns):
    inst, _spark = share_inspire(agent_ns)
    warnings = inst._implement_share("N01-U01", RESULT, shared_spec(agent_ns, genie_space=False), {"dashboard": "d1"}, None,
                                     sources=SOURCES)
    assert "which the dashboard read with the credentials of each viewer" in warnings[0]


def test_sharing_with_no_dashboard_or_genie_agent_grants_no_source_table(agent_ns):
    inst, spark = share_inspire(agent_ns)
    warnings = inst._implement_share("N01-U01", RESULT, shared_spec(agent_ns, dashboard=False, genie_space=False), {}, None,
                                     sources=SOURCES)
    assert warnings == [] and inst.looked == [RESULT]
    assert not any("orders_v2" in s or "customers" in s for s in spark.statements)


def test_sharing_with_no_one_reads_no_access(agent_ns):
    inst, spark = share_inspire(agent_ns)
    spec = _spec(agent_ns, sharing={"principals": []}, outputs={"dashboard": True, "genie_space": True, "app": False})[0]
    assert inst._implement_share("N01-U01", RESULT, spec, {"dashboard": "d1", "genie_space": "g1"}, None, sources=SOURCES) == []
    assert inst.looked == [] and spark.statements == []


def test_a_grant_inspire_may_give_that_fails_is_named_with_what_needs_it(agent_ns):
    inst, _spark = share_inspire(agent_ns)

    def refuse(statement, *a, **k):
        if "orders_v2" in statement:
            raise RuntimeError("PERMISSION_DENIED: cannot grant")
        return FakeSpark().sql(statement)

    inst.spark = type("S", (), {"sql": staticmethod(refuse)})()
    warnings = inst._implement_share("N01-U01", RESULT, shared_spec(agent_ns), {"dashboard": "d1", "genie_space": "g1"}, None,
                                     sources=SOURCES)
    assert warnings[0].startswith("Sharing: GRANT SELECT ON TABLE `main`.`s`.`orders_v2` TO `planners` failed: ")
    assert warnings[0].endswith("; the dashboard and the Genie Agent read main.s.orders_v2 with the credentials of each viewer")


def test_the_build_passes_the_tables_its_outputs_read_to_sharing(agent_ns):
    import ast
    from _agentload import method_node
    body = ast.unparse(method_node("DatabricksInspire", "_implement_one_locked"))
    assert "self._implement_share(uc_id, result_table, spec, assets, job_id, asset_status, sources=allowed)" in body
