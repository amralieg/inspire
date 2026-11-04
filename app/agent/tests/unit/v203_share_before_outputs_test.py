import pytest

from v140_implement_test import GRANT_CATALOG, GRANT_SCHEMA, GRANT_SELECT, INSPIRE_OWNS, VALID, _probe_inspire

GRANT_REASONS = "GRANT SELECT ON TABLE `main`.`inspire`.`churn_out_reasons` TO `{}`"
GRANT_SUMMARY = "GRANT SELECT ON TABLE `main`.`inspire`.`churn_out_summary` TO `{}`"
GRANT_ASSUMPTIONS = "GRANT SELECT ON TABLE `main`.`inspire`.`churn_out_assumptions` TO `{}`"
ASSUMPTIONS_DESCRIBE = "DESCRIBE TABLE `main`.`inspire`.`churn_out_assumptions`"
SHARED = {"principals": [{"type": "user", "name": "amr@x"}, {"type": "group", "name": "planners"}]}


def _grants(statements):
    return [s for s in statements if s.startswith("GRANT ")]


def _build(ns, responder=None, sharing=SHARED):
    def respond(statement):
        if statement.startswith("SELECT level, privilege, principal"):
            return INSPIRE_OWNS
        return responder(statement) if responder else None

    inst = _probe_inspire(ns, respond, {"dashboard": {"state": "ready", "spec_version": 2}})
    del inst._implement_share
    inst._implement_owns_app = lambda uc, app: True
    inst._implement_api = lambda method, path, body=None, query=None: {}
    inst._implement_emit = lambda *a, **k: None
    inst._implement_runner = lambda uc: "runner"
    inst._implement_fill_and_preview = lambda *a: ({"status": "written", "rows_written": 12}, 77, {})
    seen = {}
    inst._implement_dashboard = lambda c, r: pytest.fail("the dashboard did not change")
    inst._implement_genie_space = lambda c, r: (seen.setdefault("genie_space", _grants(inst.spark.statements)), {
        "genie_space_id": "g1", "genie_space_url": "https://h/genie/rooms/g1"})[1]
    inst._implement_app = lambda c, r: (seen.setdefault("app", _grants(inst.spark.statements)), {
        "app_name": "churn-desk", "app_url": "https://churn-desk.example", "app_health": "running"})[1]
    status = inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3,
                                         "spec_json": dict(VALID, sharing=sharing)}, (5150, "N01-U01", 3))
    return inst, status, seen


def test_the_people_a_build_is_shared_with_can_read_its_tables_before_the_genie_agent_and_app_are_built(agent_ns):
    inst, status, seen = _build(agent_ns, lambda s: [{"col_name": "name", "data_type": "string"}] if s == ASSUMPTIONS_DESCRIBE else None)
    assert status == "ready", inst.updates[-1].get("status_message")
    early = [grant.format(name) for name in ("amr@x", "planners")
             for grant in (GRANT_CATALOG, GRANT_SCHEMA, GRANT_SELECT, GRANT_REASONS, GRANT_SUMMARY)]
    assert seen["genie_space"] == early, "the Genie Agent's sample questions read the result table as the people it is shared with"
    assert seen["app"] == early
    shared = [grant.format(name) for name in ("amr@x", "planners")
              for grant in (GRANT_CATALOG, GRANT_SCHEMA, GRANT_SELECT, GRANT_REASONS, GRANT_SUMMARY, GRANT_ASSUMPTIONS)]
    assert _grants(inst.spark.statements) == early + shared, "the Sharing step still grants every table, the assumptions table too"


def test_a_grant_that_fails_before_the_outputs_is_a_warning_once_and_the_outputs_still_build(agent_ns):
    def responder(statement):
        if statement == GRANT_SELECT.format("planners"):
            raise RuntimeError("PERMISSION_DENIED: not the owner of churn_out")
        return None

    inst, status, seen = _build(agent_ns, responder)
    assert status == "ready_with_warnings"
    message = inst.updates[-1]["status_message"]
    assert message.count(f"Sharing: {GRANT_SELECT.format('planners')} failed: PERMISSION_DENIED: not the owner of churn_out") == 1
    assert "genie_space" in seen and "app" in seen


def test_a_build_shared_with_no_one_grants_nothing_before_the_outputs(agent_ns):
    inst, status, seen = _build(agent_ns, sharing={"principals": []})
    assert status == "ready", inst.updates[-1]
    assert seen["genie_space"] == [] and _grants(inst.spark.statements) == []
