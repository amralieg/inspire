import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import (ACCESS_TABLE, GRANT_REASONS, GRANT_SELECT, GRANT_SUMMARY, LIVE_ACCESS, VALID, _access_spark, _inspire,
                                 _not_access_reads, _probe_inspire, _spec)

ASSUMPTIONS_DESCRIBE = "DESCRIBE TABLE `main`.`inspire`.`churn_out_assumptions`"
GRANT_ASSUMPTIONS = "GRANT SELECT ON TABLE `main`.`inspire`.`churn_out_assumptions` TO `{}`"
ASSUMPTIONS_TABLE = "main.inspire.churn_out_assumptions"


def _refresh_only(ns, describe, sharing=None):
    def responder(statement):
        if statement == ASSUMPTIONS_DESCRIBE:
            return describe(statement)
        return None

    inst = _probe_inspire(ns, responder, {"dashboard": {"state": "ready", "spec_version": 2}})
    inst._implement_runner = lambda uc: "runner"
    inst._implement_fill_and_preview = lambda *a: pytest.fail("a dashboard retry runs no preview")
    inst._implement_dashboard = lambda c, r: {"dashboard_id": "d1", "dashboard_url": "https://h/d1"}
    inst._implement_genie_space = inst._implement_app = lambda c, r: pytest.fail("only the dashboard is retried")
    inst._implement_share = lambda *a, **k: pytest.fail("a retry shares the outputs with nobody new, so the outputs' permissions are left alone")
    previous = inst._implement_previous(None)["spec_json"]
    if sharing is not None:
        previous = dict(previous, sharing=sharing)
        inst._implement_previous = lambda t: {"spec_version": 2, "spec_json": previous}
    spec = dict(previous, retry_outputs=["dashboard"])
    status = inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": spec},
                                        (5150, "N01-U01", 3))
    return inst, status


def _grants(inst):
    return [s for s in inst.spark.statements if s.startswith("GRANT ")]


def test_a_version_that_only_refreshes_lets_each_person_it_is_shared_with_read_every_table_its_outputs_read(agent_ns):
    inst, status = _refresh_only(agent_ns, lambda s: [{"col_name": "name", "data_type": "string"}])
    assert status == "ready", inst.updates[-1]
    assert _grants(inst) == [GRANT_REASONS.format("planners"), GRANT_SUMMARY.format("planners"), GRANT_ASSUMPTIONS.format("planners")], \
        "a table created or replaced after the use case was first shared is readable by the people it is shared with"


def test_no_assumptions_table_means_no_grant_on_it(agent_ns):
    inst, status = _refresh_only(agent_ns, lambda s: (_ for _ in ()).throw(RuntimeError(
        "[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`inspire`.`churn_out_assumptions` cannot be found.")))
    assert status == "ready", inst.updates[-1]
    assert _grants(inst) == [GRANT_REASONS.format("planners"), GRANT_SUMMARY.format("planners")]


def test_an_assumptions_table_inspire_cannot_check_is_a_warning_and_the_other_tables_are_still_shared(agent_ns):
    inst, status = _refresh_only(agent_ns, lambda s: (_ for _ in ()).throw(RuntimeError("PERMISSION_DENIED: no USE SCHEMA")))
    assert status == "ready_with_warnings"
    assert inst.updates[-1]["status_message"] == (
        f"Sharing: Inspire could not check {ASSUMPTIONS_TABLE}, so the people you share with may not see how the money at stake is "
        "worked out: PERMISSION_DENIED: no USE SCHEMA")
    assert _grants(inst) == [GRANT_REASONS.format("planners"), GRANT_SUMMARY.format("planners")]


def test_a_failed_grant_on_a_refresh_is_a_warning_naming_the_statement(agent_ns):
    def responder(statement):
        if statement == ASSUMPTIONS_DESCRIBE:
            return [{"col_name": "name", "data_type": "string"}]
        if statement == GRANT_SUMMARY.format("planners"):
            raise RuntimeError("PERMISSION_DENIED: not the owner of churn_out_summary")
        return None

    inst = _probe_inspire(agent_ns, responder, {"dashboard": {"state": "ready", "spec_version": 2}})
    inst._implement_runner = lambda uc: "runner"
    inst._implement_dashboard = lambda c, r: {"dashboard_id": "d1", "dashboard_url": "https://h/d1"}
    inst._implement_share = lambda *a, **k: pytest.fail("a retry does not share the outputs again")
    previous = inst._implement_previous(None)["spec_json"]
    status = inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3,
                                         "spec_json": dict(previous, retry_outputs=["dashboard"])}, (5150, "N01-U01", 3))
    assert status == "ready_with_warnings"
    assert inst.updates[-1]["status_message"] == (f"Sharing: {GRANT_SUMMARY.format('planners')} failed: PERMISSION_DENIED: not the owner "
                                                  "of churn_out_summary")
    assert _grants(inst)[-1] == GRANT_ASSUMPTIONS.format("planners"), "one failed grant does not stop the others"


def test_a_use_case_shared_with_nobody_checks_and_grants_nothing(agent_ns):
    inst, status = _refresh_only(agent_ns, lambda s: pytest.fail("nobody to share with, so the assumptions table is not checked"),
                                 {"principals": []})
    assert status == "ready" and _grants(inst) == []


def test_a_schedule_change_grants_nothing(agent_ns):
    inst = _probe_inspire(agent_ns, lambda s: pytest.fail("a schedule change reads no table") if s == ASSUMPTIONS_DESCRIBE else None,
                          {"dashboard": {"state": "ready", "spec_version": 2}})
    inst._implement_share = lambda *a, **k: pytest.fail("a schedule change shares nothing")
    previous = inst._implement_previous(None)["spec_json"]
    spec = dict(previous, schedule={"enabled": True, "cron": "0 0 7 ? * MON", "timezone": "Asia/Dubai"})
    assert inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": spec},
                                      (5150, "N01-U01", 3)) == "ready"
    assert _grants(inst) == []


def test_a_version_that_shares_hands_the_assumptions_table_to_sharing_only_when_it_exists(agent_ns):
    for describe, handed in (([{"col_name": "name", "data_type": "string"}], ASSUMPTIONS_TABLE), ([], "")):
        inst = _probe_inspire(agent_ns, lambda s, d=describe: d if s == ASSUMPTIONS_DESCRIBE else None,
                              {"dashboard": {"state": "ready", "spec_version": 2}})
        inst._implement_runner = lambda uc: "runner"
        inst._implement_fill_and_preview = lambda *a: ({"status": "written", "rows_written": 12}, 77, {})
        inst._implement_dashboard = lambda c, r: pytest.fail("the dashboard did not change")
        inst._implement_genie_space = lambda c, r: {"genie_space_id": "g1", "genie_space_url": "https://h/genie/rooms/g1"}
        inst._implement_app = lambda c, r: {"app_name": "churn-desk", "app_url": "https://churn-desk.example", "app_health": "running"}
        shared = []
        inst._implement_share = lambda *a, assumptions_table="", run_log="": shared.append(assumptions_table) or []
        assert inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": dict(VALID)},
                                          (5150, "N01-U01", 3)) == "ready"
        assert shared == [handed]
        assert _grants(inst) == [], "sharing itself grants the tables, not a second pass"


def test_sharing_lets_each_principal_read_the_money_assumptions(agent_ns):
    inst = _inspire(agent_ns, _access_spark(LIVE_ACCESS))
    inst._implement_api = lambda method, path, body=None, query=None: {}
    inst._implement_emit = lambda *a, **k: None
    spec = dict(_spec(agent_ns)[0], sharing={"principals": [{"type": "user", "name": "amr@x"}, {"type": "group", "name": "bad`name"}]})
    assert inst._implement_share("N01-U01", ACCESS_TABLE, spec, {}, None, "main.inspire.churn_out_reasons", "main.inspire.churn_out_summary",
                                 assumptions_table=ASSUMPTIONS_TABLE) == []
    assert _not_access_reads(inst.spark.statements) == [GRANT_SELECT.format("amr@x"), GRANT_REASONS.format("amr@x"),
                                                         GRANT_SUMMARY.format("amr@x"), GRANT_ASSUMPTIONS.format("amr@x")]


def test_the_helper_skips_empty_tables_and_names_with_a_backtick(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    assert inst._implement_share_reads("bad`name", (ASSUMPTIONS_TABLE,)) == [] and inst.spark.statements == []
    assert inst._implement_share_reads("amr@x", ("", ASSUMPTIONS_TABLE, "")) == []
    assert inst.spark.statements == [GRANT_ASSUMPTIONS.format("amr@x")]
